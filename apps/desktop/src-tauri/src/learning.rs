//! The learning record (spec 2026-10-13 "Parked" P5; owner Q5 second half, PARK-FLAGS): for every point a human verified
//! or placed, each model's distance from the final point, the placing model included. Never fails a save.
use ceph_store::{CaseDoc, LandmarkRow, LearningRow, ModelPoints};

/// The model that placed an AI point: `placed_by` (schema 10), else the newest run whose point sits exactly where the AI
/// put it (§5.1, old cases), else none. A hand-placed point has no placer. `runs`: the case's run history, newest first.
pub fn placer_of(row: &LandmarkRow, runs: &[ModelPoints]) -> Option<String> {
    if row.source == "manual" { return None; }
    if let Some(m) = &row.placed_by { return Some(m.clone()); }
    let (ax, ay) = (row.ai_x?, row.ai_y?);
    runs.iter().find(|r| r.points.iter().any(|q| q.landmark_id.as_deref() == Some(row.id.as_str()) && q.x == ax && q.y == ay)).map(|r| r.model_id.clone())
}

/// The run that placed this point: the placing model's newest run with the case's `facing` (any age, from `history`,
/// newest first) whose point sits exactly on the stored AI position. A later re-run (Re-detect, another runtime, a new
/// model file) does not stand in for it (fix round 1, review I1), and a run made with the other facing never counts
/// (final review I-1): its guesses are tens of mm off.
fn placing_run<'a>(row: &LandmarkRow, placer: &str, facing: &str, history: &'a [ModelPoints]) -> Option<(&'a ModelPoints, &'a ceph_store::AiPoint)> {
    let (ax, ay) = (row.ai_x?, row.ai_y?);
    history.iter().filter(|r| r.model_id == placer && r.facing == facing).find_map(|r| r.points.iter()
        .find(|q| q.landmark_id.as_deref() == Some(row.id.as_str()) && q.x == ax && q.y == ay).map(|q| (r, q)))
}

/// One row per (verified or hand-placed point, model that found it with a finite guess). Every model is compared, the one
/// that placed the point included (its row is marked `placer`): the placer against the run that placed the point (its
/// distance, hash and runtime; no row if that run is not stored), every other model against its newest run made with
/// the case's facing (final review I-1: a stale pass made with the other facing is never compared; a model with no run
/// of this facing has no row). `history`: every stored run of the case, newest first. Distances are in film pixels for
/// both the point and the guesses, so a left-facing film needs no flip. Millimetres use the case's ruler, else the
/// assumed 0.1 mm per px (Q10, `mm_assumed`).
pub fn learning_rows_for(doc: &CaseDoc, history: &[ModelPoints], machine: Option<String>) -> Vec<LearningRow> {
    let (mm, assumed) = match doc.spacing_mm {
        Some(s) if ceph_infer::crosscheck::scale_ok(s) => (s, false),
        _ => (ceph_infer::crosscheck::params().assumed_mm_per_px, true),
    };
    let machine = machine.unwrap_or_else(|| "unknown".into());
    let mut out = Vec::new();
    for row in doc.landmarks.iter().filter(|r| r.verified || r.source == "manual") {
        let how = match row.source.as_str() { "manual" => "hand-placed", "ai-adjusted" => "moved", _ => "accepted-unmoved" };
        let placer = placer_of(row, history);
        let placed = placer.as_deref().and_then(|p| placing_run(row, p, &doc.facing, history));
        let mut seen = std::collections::BTreeSet::new();
        let others = history.iter().filter(|r| r.facing == doc.facing && Some(r.model_id.as_str()) != placer.as_deref())
            .filter(|r| seen.insert(r.model_id.as_str()))   // newest first: each model's newest run with this facing
            .filter_map(|r| r.points.iter().find(|q| q.landmark_id.as_deref() == Some(row.id.as_str())).map(|q| (r, q, false)));
        for (r, q, is_placer) in placed.map(|(r, q)| (r, q, true)).into_iter().chain(others) {
            if !(q.x.is_finite() && q.y.is_finite()) { continue; }
            let px = (q.x - row.x).hypot(q.y - row.y);
            out.push(LearningRow { landmark_id: row.id.clone(), model_id: r.model_id.clone(), model_sha256: r.model_sha256.clone(),
                execution_provider: r.execution_provider.clone(), dist_px: px, dist_mm: px * mm, mm_assumed: assumed, machine: machine.clone(),
                how: how.into(), placer: is_placer });
        }
    }
    out
}

/// The points in the record whose placing model is known but whose placing run (made with the case's facing) is not
/// stored, so they have no placer row.
pub fn missing_placer_rows(doc: &CaseDoc, rows: &[LearningRow], history: &[ModelPoints]) -> Vec<String> {
    doc.landmarks.iter().filter(|r| r.verified || r.source == "manual")
        .filter(|r| placer_of(r, history).is_some() && !rows.iter().any(|x| x.landmark_id == r.id && x.placer))
        .map(|r| r.id.clone()).collect()
}

/// Recomputes the case's learning rows and replaces them. Returns how many rows were written.
pub fn record_learning(l: &mut ceph_store::Library, case_id: &str, operator: &str) -> anyhow::Result<usize> {
    let (doc, history, machine) = (l.load(case_id)?, l.ai_run_history(case_id)?, l.machine_of(case_id)?);
    let rows = learning_rows_for(&doc, &history, machine);
    let missing = missing_placer_rows(&doc, &rows, &history);
    if !missing.is_empty() {
        eprintln!("learning record for {case_id}: no stored run made with this case's facing placed {} at its AI position; no placing-model row", missing.join(", "));
    }
    l.replace_learning(case_id, &rows, operator)?;
    Ok(rows.len())
}

/// The learning record never fails a save, a sign-off or a run that already committed (preflight c8). A failure is
/// logged once per call, and the next save tries again (rows are replaced as a whole).
pub fn learn_or_log(l: &mut ceph_store::Library, case_id: &str, operator: &str) {
    if let Err(e) = record_learning(l, case_id, operator) { eprintln!("learning record not written for {case_id}: {e:#}"); }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ceph_store::{AiPoint, CaseDoc, LandmarkRow, ModelPoints};
    const AZ: &str = "aariz-cepha29"; const GU: &str = "gu2net-isbi19"; const SR: &str = "srpose-cldet23"; const CW: &str = "cwlachap-hrnet-w32";
    fn run(m: &str, pts: &[(&str, f64, f64)]) -> ModelPoints {
        ModelPoints { model_id: m.into(), ran_at: "x".into(), facing: "right".into(), execution_provider: if m == GU { "coreml".into() } else { "cpu".into() },
            model_sha256: Some(format!("sha-{m}")),
            points: pts.iter().enumerate().map(|(i, (id, x, y))| AiPoint { channel: i as u32, landmark_id: Some(id.to_string()), x: *x, y: *y, peak: 1.0 }).collect() }
    }
    fn lm(id: &str, x: f64, y: f64, source: &str, verified: bool, ai: Option<(f64, f64)>, placed_by: Option<&str>) -> LandmarkRow {
        LandmarkRow { id: id.into(), x, y, source: source.into(), verified, ai_x: ai.map(|a| a.0), ai_y: ai.map(|a| a.1), confidence: None, placed_by: placed_by.map(String::from) }
    }
    fn doc(landmarks: Vec<LandmarkRow>, spacing: Option<f64>, facing: &str) -> CaseDoc {
        let mut d: CaseDoc = serde_json::from_value(serde_json::json!({ "id": "c", "patientName": "Demo Synthetic", "timepoint": "T1", "takenOn": null, "facing": facing,   // SYNTHETIC
            "patientKey": "", "identitySource": "manual", "identityChecked": true, "identityIssues": [], "learnedFields": [],
            "orientation": {}, "display": {}, "spacingMm": spacing, "verifiedAt": null, "verifiedBy": null, "createdAt": "x", "updatedAt": "x",
            "image": { "sha256": "s", "ext": "png", "width": 10, "height": 10, "originalName": "SYNTHETIC.png", "path": "/x" }, "landmarks": [] })).unwrap();
        d.landmarks = landmarks; d
    }
    fn find<'a>(rows: &'a [ceph_store::LearningRow], lm: &str, m: &str) -> Option<&'a ceph_store::LearningRow> { rows.iter().find(|r| r.landmark_id == lm && r.model_id == m) }

    #[test] fn one_row_per_model_that_found_the_point_and_the_placer_is_marked() {
        let runs = [run(AZ, &[("S", 0.0, 0.0), ("Go", 100.0, 100.0)]), run(GU, &[("S", 3.0, 4.0), ("Go", 130.0, 100.0)]), run(CW, &[("S", 0.0, 0.0)]), run(SR, &[("Go", 100.0, 110.0)])];
        let d = doc(vec![lm("S", 0.0, 0.0, "ai", true, Some((0.0, 0.0)), Some(AZ)), lm("Go", 130.0, 100.0, "ai-adjusted", true, Some((100.0, 100.0)), Some(AZ)),
            lm("N", 9.0, 9.0, "ai", false, Some((9.0, 9.0)), Some(AZ))], None, "right");
        let rows = learning_rows_for(&d, &runs, None);
        assert_eq!(rows.iter().filter(|r| r.landmark_id == "S").count(), 3, "every model that found S, voter or not; SRPose did not find it");
        let gu = find(&rows, "S", GU).unwrap();
        assert_eq!((gu.dist_px, gu.dist_mm, gu.mm_assumed, gu.how.as_str(), gu.machine.as_str(), gu.placer, gu.execution_provider.as_str()),
            (5.0, 0.5, true, "accepted-unmoved", "unknown", false, "coreml"));
        let az = find(&rows, "S", AZ).unwrap();
        assert_eq!((az.dist_px, az.placer, az.execution_provider.as_str()), (0.0, true, "cpu"), "accepted unmoved: the placing model is 0 by construction and marked (P6)");
        assert_eq!(find(&rows, "Go", AZ).map(|r| (r.how.as_str(), r.dist_px, r.placer)), Some(("moved", 30.0, true)), "the placer's own guess is in the record for a moved point too");
        assert_eq!(find(&rows, "Go", GU).map(|r| (r.dist_px, r.placer)), Some((0.0, false)));
        assert!(rows.iter().all(|r| r.landmark_id != "N"), "an unverified AI point has no final value yet");
        assert_eq!(az.model_sha256.as_deref(), Some("sha-aariz-cepha29"));
    }
    #[test] fn nothing_verified_gives_no_rows() {
        let runs = [run(AZ, &[("S", 0.0, 0.0)])];
        assert!(learning_rows_for(&doc(vec![lm("S", 0.0, 0.0, "ai", false, Some((0.0, 0.0)), Some(AZ))], None, "right"), &runs, None).is_empty());
        assert!(learning_rows_for(&doc(vec![], None, "right"), &runs, None).is_empty());
    }
    #[test] fn a_hand_placed_point_has_rows_but_no_placer_even_unverified() {
        let runs = [run(AZ, &[("Ba", 10.0, 0.0)]), run(SR, &[("Ba", 0.0, 0.0)])];
        let d = doc(vec![lm("Ba", 0.0, 0.0, "manual", false, None, None)], Some(0.2), "right");
        let rows = learning_rows_for(&d, &runs, Some("machine-7".into()));
        assert_eq!(rows.len(), 2);
        assert!(rows.iter().all(|r| r.how == "hand-placed" && !r.placer && !r.mm_assumed && r.machine == "machine-7"));
        assert_eq!(find(&rows, "Ba", AZ).unwrap().dist_mm, 2.0);
    }
    #[test] fn the_placer_comes_from_placed_by_else_the_exact_match_else_nobody() {
        let runs = [run(CW, &[("Go", 100.0, 100.0)]), run(AZ, &[("Go", 101.0, 100.0)])];
        let old = lm("Go", 100.0, 100.0, "ai", true, Some((100.0, 100.0)), None);
        assert_eq!(placer_of(&old, &runs).as_deref(), Some(CW), "an old case: the run whose point sits exactly on the AI position (§5.1)");
        assert_eq!(placer_of(&lm("Go", 100.0, 100.0, "ai", true, Some((100.0, 100.0)), Some(AZ)), &runs).as_deref(), Some(AZ), "placed_by wins");
        assert_eq!(placer_of(&lm("Go", 50.0, 50.0, "ai", true, Some((50.0, 50.0)), None), &runs), None, "no exact match: nobody");
        assert_eq!(placer_of(&lm("Go", 50.0, 50.0, "manual", true, Some((100.0, 100.0)), Some(CW)), &runs), None, "a hand-placed point has no placer");
    }
    #[test] fn a_placer_with_no_stored_run_writes_the_other_rows() {
        // Carried from Task 5's review: the placing model's own guess must be in the record when it exists; when its run
        // is missing, the point keeps placed_by and the other models' rows are still written.
        let runs = [run(SR, &[("S", 3.0, 4.0)])];
        let rows = learning_rows_for(&doc(vec![lm("S", 0.0, 0.0, "ai", true, Some((0.0, 0.0)), Some(AZ))], None, "right"), &runs, None);
        assert_eq!(rows.iter().map(|r| (r.model_id.as_str(), r.placer)).collect::<Vec<_>>(), [(SR, false)]);
    }
    /// Fix round 1 (review I1): the placing model's row is measured against the run that PLACED the point (its newest run
    /// whose point sits exactly on the stored AI position), with that run's hash and runtime, not against its newest run.
    #[test] fn the_placer_row_comes_from_the_run_that_placed_the_point_not_the_newest() {
        let placing = ModelPoints { execution_provider: "cpu".into(), model_sha256: Some("sha-old".into()), ..run(AZ, &[("S", 0.0, 0.0)]) };
        let newer = ModelPoints { execution_provider: "coreml".into(), model_sha256: Some("sha-new".into()), ..run(AZ, &[("S", 3.0, 4.0)]) };
        let history = [newer, run(SR, &[("S", 6.0, 8.0)]), placing];          // newest first, as the store gives it
        let d = doc(vec![lm("S", 0.0, 0.0, "ai", true, Some((0.0, 0.0)), Some(AZ))], None, "right");
        let rows = learning_rows_for(&d, &history, None);
        let az = find(&rows, "S", AZ).unwrap();
        assert_eq!((az.dist_px, az.placer, az.how.as_str(), az.model_sha256.as_deref(), az.execution_provider.as_str()),
            (0.0, true, "accepted-unmoved", Some("sha-old"), "cpu"), "accepted unmoved: 0 px against the run that placed it");
        assert_eq!(find(&rows, "S", SR).map(|r| (r.dist_px, r.placer)), Some((10.0, false)), "other models: their newest run");
        assert_eq!(rows.len(), 2, "one row per model: the placer's newest run gives no second row");
        // Moved after placing: still measured against the placing run.
        let moved = doc(vec![lm("S", 0.0, 5.0, "ai-adjusted", true, Some((0.0, 0.0)), Some(AZ))], None, "right");
        assert_eq!(find(&learning_rows_for(&moved, &history, None), "S", AZ).map(|r| (r.dist_px, r.model_sha256.clone())), Some((5.0, Some("sha-old".into()))));
    }
    #[test] fn no_run_sits_on_the_ai_position_so_no_placer_row_and_the_others_are_written() {
        let latest = [run(AZ, &[("S", 3.0, 4.0)]), run(SR, &[("S", 6.0, 8.0)])];
        let d = doc(vec![lm("S", 0.0, 0.0, "ai", true, Some((0.0, 0.0)), Some(AZ))], None, "right");
        let rows = learning_rows_for(&d, &latest, None);
        assert_eq!(rows.iter().map(|r| (r.model_id.as_str(), r.placer)).collect::<Vec<_>>(), [(SR, false)]);
        assert_eq!(missing_placer_rows(&d, &rows, &latest), ["S".to_string()], "named once in the log");
    }
    #[test] fn a_point_a_model_did_not_find_or_cannot_place_has_no_row() {
        let mut nan = run(GU, &[("S", f64::NAN, 0.0)]);
        nan.points.push(AiPoint { channel: 9, landmark_id: None, x: 0.0, y: 0.0, peak: 1.0 });
        let inf = run(SR, &[("S", 0.0, f64::INFINITY)]);
        let all = [run(AZ, &[("S", 0.0, 0.0)]), nan, inf, run(CW, &[("N", 1.0, 1.0)])];
        let rows = learning_rows_for(&doc(vec![lm("S", 0.0, 0.0, "ai", true, Some((0.0, 0.0)), Some(AZ))], None, "right"), &all, None);
        assert_eq!(rows.iter().map(|r| r.model_id.as_str()).collect::<Vec<_>>(), [AZ]);
    }
    #[test] fn a_bad_stored_scale_reads_as_no_ruler() {
        let runs = [run(AZ, &[("S", 10.0, 0.0)])];
        for bad in [0.0, -0.1, f64::NAN, f64::INFINITY] {
            let r = &learning_rows_for(&doc(vec![lm("S", 0.0, 0.0, "manual", true, None, None)], Some(bad), "right"), &runs, None)[0];
            assert_eq!((r.dist_mm, r.mm_assumed), (1.0, true), "scale {bad}");
        }
        let none = &learning_rows_for(&doc(vec![lm("S", 0.0, 0.0, "manual", true, None, None)], None, "right"), &runs, None)[0];
        assert_eq!((none.dist_mm, none.mm_assumed), (1.0, true), "no ruler: 0.1 mm per px, assumed (Q10)");
        let ruled = &learning_rows_for(&doc(vec![lm("S", 0.0, 0.0, "manual", true, None, None)], Some(0.25), "right"), &runs, None)[0];
        assert_eq!((ruled.dist_mm, ruled.mm_assumed), (2.5, false), "a ruler: its own scale");
    }
    /// A run made with this facing (the store records each run's facing).
    fn faced(f: &str, r: ModelPoints) -> ModelPoints { ModelPoints { facing: f.into(), ..r } }
    /// Final review I-1: the runs carry the case's own facing (a left-facing case is run left-facing), so the distances
    /// match a right-facing case's: points and guesses are both in film pixels, nothing is flipped.
    #[test] fn a_left_facing_film_gives_the_same_distances() {
        let rows = |f: &str| { let runs = [faced(f, run(AZ, &[("S", 3.0, 4.0)]))];
            learning_rows_for(&doc(vec![lm("S", 0.0, 0.0, "manual", true, None, None)], None, f), &runs, None) };
        assert_eq!(rows("left"), rows("right"), "points and guesses are both in film pixels; nothing is flipped");
        assert_eq!(rows("left").len(), 1);
        assert_eq!(rows("left")[0].dist_px, 5.0);
    }
    /// Final review I-1 (Task 10 M3): a case turned to face right keeps an old left-facing pass of a model that did not
    /// re-run (it timed out, say). That pass is tens of mm off (76-90 mm off when mirrored). It must never be
    /// recorded as the model's accuracy: each other model is measured against its newest run WITH THE CASE'S FACING.
    #[test] fn a_stale_run_made_with_the_other_facing_is_never_recorded() {
        let d = doc(vec![lm("S", 0.0, 0.0, "ai", true, Some((0.0, 0.0)), Some(AZ))], None, "right");
        let az = run(AZ, &[("S", 0.0, 0.0)]);
        let stale = faced("left", run(SR, &[("S", 50.0, 0.0)]));
        let history = [stale, az.clone(), run(SR, &[("S", 3.0, 4.0)])];   // newest first, as the store gives it
        let rows = learning_rows_for(&d, &history, None);
        assert_eq!(find(&rows, "S", SR).map(|r| r.dist_px), Some(5.0), "SRPose: its newest RIGHT-facing run, not the stale left pass");
        assert!(rows.iter().all(|r| r.dist_px != 50.0), "the other-facing run gives no row: {rows:?}");
        // Positive control: the same newest run made right-facing IS the one compared (age is not what excluded it).
        let history = [run(SR, &[("S", 50.0, 0.0)]), az, run(SR, &[("S", 3.0, 4.0)])];
        let rows = learning_rows_for(&d, &history, None);
        assert_eq!(find(&rows, "S", SR).map(|r| r.dist_px), Some(50.0));
    }
    /// Final review I-1: no stored run with the case's facing, so no row: not the other models', and not the placer's
    /// (its placing run was made with the other facing; the point is named in the log instead).
    #[test] fn no_run_with_the_cases_facing_gives_no_row() {
        let history = [faced("left", run(SR, &[("S", 3.0, 4.0)])), faced("left", run(AZ, &[("S", 0.0, 0.0)]))];
        let d = |f: &str| doc(vec![lm("S", 0.0, 0.0, "ai", true, Some((0.0, 0.0)), Some(AZ))], None, f);
        let rows = learning_rows_for(&d("right"), &history, None);
        assert!(rows.is_empty(), "right-facing case, only left-facing runs: {rows:?}");
        assert_eq!(missing_placer_rows(&d("right"), &rows, &history), ["S".to_string()], "the placer's missing row is named in the log");
        // Positive control: the same runs on a left-facing case give both rows.
        let rows = learning_rows_for(&d("left"), &history, None);
        assert_eq!(rows.iter().map(|r| (r.model_id.as_str(), r.placer, r.dist_px)).collect::<Vec<_>>(), [(AZ, true, 0.0), (SR, false, 5.0)]);
    }

    // ---- through the library (synthetic film in a temp folder; never the real library) ----
    fn new_lib() -> (tempfile::TempDir, ceph_store::Library, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = ceph_store::Library::open(t.path()).unwrap();
        let png = t.path().join("SYNTHETIC.png");
        image::GrayImage::new(64, 64).save(&png).unwrap();
        let id = l.import(&png).unwrap().case_id;
        (t, l, id)
    }
    fn az_run(l: &mut ceph_store::Library, id: &str, provider: &str) {
        l.record_ai_run(id, &ceph_store::AiRun { model_id: AZ.into(), execution_provider: provider.into(), facing: "right".into(), total_ms: 1.0, model_sha256: Some("a".into()) },
            &[AiPoint { channel: 0, landmark_id: Some("S".into()), x: 10.0, y: 20.0, peak: 1.0 }, AiPoint { channel: 1, landmark_id: Some("N".into()), x: 40.0, y: 20.0, peak: 1.0 }]).unwrap();
    }
    fn s_at(x: f64, verified: bool) -> LandmarkRow {
        LandmarkRow { id: "S".into(), x, y: 20.0, source: if x == 10.0 { "ai".into() } else { "ai-adjusted".into() }, verified,
            ai_x: Some(10.0), ai_y: Some(20.0), confidence: None, placed_by: Some(AZ.into()) }
    }
    fn edit(id: &str, landmarks: Vec<LandmarkRow>) -> ceph_store::CaseEdit {
        ceph_store::CaseEdit { id: id.into(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks }
    }
    fn px(l: &ceph_store::Library, id: &str) -> Vec<(String, String, f64)> {
        l.learning_rows(id).unwrap().into_iter().map(|r| (r.landmark_id, r.how, r.dist_px)).collect()
    }
    #[test] fn the_record_never_fails_a_save() {
        let (_t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        let e = |x: f64| edit(&id, vec![s_at(x, true)]);
        crate::library::save_and_learn(&mut l, &e(10.0), "Dr A").unwrap();
        assert_eq!(l.learning_rows(&id).unwrap().iter().map(|r| (r.how.as_str(), r.dist_px)).collect::<Vec<_>>(), [("accepted-unmoved", 0.0)]);
        crate::library::save_and_learn(&mut l, &e(13.0), "Dr A").unwrap();
        assert_eq!(l.learning_rows(&id).unwrap().iter().map(|r| (r.how.as_str(), r.dist_px)).collect::<Vec<_>>(), [("moved", 3.0)], "moved: updated, not added");
        crate::library::save_and_learn(&mut l, &e(16.0), "Dr A").unwrap();
        assert_eq!(l.learning_rows(&id).unwrap().iter().map(|r| (r.how.as_str(), r.dist_px)).collect::<Vec<_>>(), [("moved", 6.0)], "moved again: still one row, the new distance");
        l.conn_for_tests().execute_batch("DROP TABLE learning_record").unwrap();
        assert!(crate::library::save_and_learn(&mut l, &e(14.0), "Dr A").is_ok(), "the save succeeds without the record");
        assert_eq!(l.load(&id).unwrap().landmarks[0].x, 14.0);
    }
    /// Final review m10 (Task 10 M5): S is verified first, so the record really tries to insert and the library really
    /// refuses. This fails if `record_learning` swallowed the refusal (induced: `let _ = l.replace_learning(..)`, red),
    /// or if a verified point gave no row to insert.
    #[test] fn a_record_the_library_refuses_to_write_does_not_fail_the_save() {
        let (_t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        l.save(&edit(&id, vec![s_at(10.0, true)]), "Dr A").unwrap();      // S verified; no record written yet
        l.conn_for_tests().execute_batch("CREATE TRIGGER no_learning BEFORE INSERT ON learning_record BEGIN SELECT RAISE(ABORT, 'learning record locked'); END").unwrap();
        let e = record_learning(&mut l, &id, "Dr A").map(|n| format!("wrote {n} rows")).unwrap_or_else(|e| format!("refused: {e:#}"));
        assert!(e.starts_with("refused: ") && e.contains("learning record locked"), "the library must have refused a real insert: {e}");
        let s = crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(13.0, true)]), "Dr A");
        assert!(s.is_ok(), "the save itself succeeds: {s:?}");
        assert_eq!(l.load(&id).unwrap().landmarks[0].x, 13.0);
        assert!(l.learning_rows(&id).unwrap().is_empty());
    }
    #[test] fn a_read_only_library_refuses_the_save_as_today_and_nothing_panics() {
        let (_t, mut l, id) = new_lib();
        l.conn_for_tests().pragma_update(None, "query_only", 1).unwrap();
        assert!(crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(10.0, true)]), "Dr A").is_err());
        learn_or_log(&mut l, &id, "Dr A");   // logs, never panics
    }
    #[test] fn un_verify_delete_and_nothing_verified_remove_rows() {
        let (_t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        let n = LandmarkRow { id: "N".into(), x: 40.0, y: 20.0, source: "ai".into(), verified: true, ai_x: Some(40.0), ai_y: Some(20.0), confidence: None, placed_by: Some(AZ.into()) };
        crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(10.0, true), n.clone()]), "Dr A").unwrap();
        assert_eq!(px(&l, &id).len(), 2);
        crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(10.0, false), n.clone()]), "Dr A").unwrap();
        assert_eq!(px(&l, &id), [("N".to_string(), "accepted-unmoved".to_string(), 0.0)], "S un-verified: its row goes");
        crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(10.0, false)]), "Dr A").unwrap();
        assert!(px(&l, &id).is_empty(), "N deleted: its row goes; nothing verified left: no rows");
    }
    #[test] fn a_run_recorded_after_verifying_adds_its_row_with_its_provider() {
        let (_t, mut l, id) = new_lib();
        crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(13.0, true)]), "Dr A").unwrap();
        assert!(px(&l, &id).is_empty(), "no run yet: no rows");
        crate::library::record_ai_and_learn(&mut l, &id, &ceph_store::AiRun { model_id: GU.into(), execution_provider: "coreml".into(), facing: "right".into(), total_ms: 1.0, model_sha256: Some("g".into()) },
            &[AiPoint { channel: 0, landmark_id: Some("S".into()), x: 13.0, y: 24.0, peak: 1.0 }], "Dr A").unwrap();
        let r = &l.learning_rows(&id).unwrap()[0];
        assert_eq!((r.model_id.as_str(), r.execution_provider.as_str(), r.model_sha256.as_deref(), r.dist_px, r.placer), (GU, "coreml", Some("g"), 4.0, false));
        az_run(&mut l, &id, "cpu");
        crate::learning::learn_or_log(&mut l, &id, "Dr A");
        let az = l.learning_rows(&id).unwrap().into_iter().find(|r| r.model_id == AZ).unwrap();
        assert_eq!((az.execution_provider.as_str(), az.placer, az.dist_px), ("cpu", true, 3.0));
    }
    #[test] fn a_later_run_of_the_placing_model_does_not_change_its_row() {
        let (_t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(10.0, true)]), "Dr A").unwrap();
        crate::library::record_ai_and_learn(&mut l, &id, &ceph_store::AiRun { model_id: AZ.into(), execution_provider: "coreml".into(), facing: "right".into(),
            total_ms: 1.0, model_sha256: Some("b".into()) }, &[AiPoint { channel: 0, landmark_id: Some("S".into()), x: 13.0, y: 24.0, peak: 1.0 }], "Dr A").unwrap();
        let r = &l.learning_rows(&id).unwrap()[0];
        assert_eq!((r.dist_px, r.placer, r.model_sha256.as_deref(), r.execution_provider.as_str()), (0.0, true, Some("a"), "cpu"));
    }
    /// Final review I-1, through the library: a later left-facing pass of GU2Net on a right-facing case is not compared;
    /// GU2Net's earlier right-facing run is.
    #[test] fn through_the_library_a_run_with_the_other_facing_is_not_compared() {
        let (_t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        let gu = |l: &mut ceph_store::Library, facing: &str, x: f64| l.record_ai_run(&id, &ceph_store::AiRun { model_id: GU.into(), execution_provider: "cpu".into(),
            facing: facing.into(), total_ms: 1.0, model_sha256: Some("g".into()) }, &[AiPoint { channel: 0, landmark_id: Some("S".into()), x, y: 20.0, peak: 1.0 }]).unwrap();
        gu(&mut l, "right", 14.0);
        gu(&mut l, "left", 90.0);
        crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(10.0, true)]), "Dr A").unwrap();
        let rows = l.learning_rows(&id).unwrap();
        assert_eq!(rows.iter().find(|r| r.model_id == GU).map(|r| r.dist_px), Some(4.0), "GU2Net's right-facing run, not its newer left pass");
        assert_eq!(rows.len(), 2, "Aariz (placer) and GU2Net: {rows:?}");
    }
    #[test] fn a_ruler_drawn_later_rewrites_the_millimetres() {
        let (_t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(20.0, true)]), "Dr A").unwrap();
        let r = &l.learning_rows(&id).unwrap()[0];
        assert_eq!((r.dist_mm, r.mm_assumed), (1.0, true), "no ruler: 10 px at an assumed 0.1 mm");
        crate::library::calibrate_and_learn(&mut l, &id, (0.0, 0.0), (40.0, 0.0), 10.0, "Dr A").unwrap();
        let r = &l.learning_rows(&id).unwrap()[0];
        assert_eq!((r.dist_mm, r.mm_assumed), (2.5, false), "calibrated at 0.25 mm per px");
    }
    #[test] fn signing_off_records_and_a_case_in_recently_deleted_is_refused_and_logged() {
        let (_t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        l.save(&edit(&id, vec![s_at(10.0, true)]), "Dr A").unwrap();
        l.conn_for_tests().execute("DELETE FROM learning_record", []).unwrap();
        crate::library::set_verified_and_learn(&mut l, &id, true, "Dr A").unwrap();
        assert_eq!(px(&l, &id).len(), 1, "Mark tracing verified writes the record");
        l.delete(&id).unwrap();
        assert!(crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(12.0, true)]), "Dr A").is_err(), "the save itself is refused as today");
        let e = record_learning(&mut l, &id, "Dr A").unwrap_err().to_string();
        assert!(e.contains("Recently deleted"), "{e}");
        learn_or_log(&mut l, &id, "Dr A");
        assert_eq!(px(&l, &id).len(), 1, "kept while restorable");
    }
    #[test] fn a_batch_save_records_only_when_it_wrote() {
        let (_t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        let ai = LandmarkRow { verified: false, ..s_at(10.0, false) };
        assert!(crate::library::save_ai_if_untraced_and_learn(&mut l, &edit(&id, vec![ai.clone()]), "Dr A").unwrap());
        assert!(px(&l, &id).is_empty(), "AI points not yet verified: no rows");
        let manual = LandmarkRow { source: "manual".into(), x: 13.0, placed_by: None, ..s_at(13.0, false) };
        l.save(&edit(&id, vec![manual]), "Dr A").unwrap();
        assert!(!crate::library::save_ai_if_untraced_and_learn(&mut l, &edit(&id, vec![ai]), "Dr A").unwrap(), "already traced: nothing written");
        assert!(px(&l, &id).is_empty(), "and no record written either (the next save writes it)");
    }
    #[test] fn closed_and_reopened_the_record_and_placed_by_are_still_there() {
        let (t, mut l, id) = new_lib();
        az_run(&mut l, &id, "cpu");
        crate::library::save_and_learn(&mut l, &edit(&id, vec![s_at(13.0, true)]), "Dr A").unwrap();
        drop(l);
        let l = ceph_store::Library::open(t.path()).unwrap();
        assert_eq!(l.load(&id).unwrap().landmarks[0].placed_by.as_deref(), Some(AZ));
        assert_eq!(px(&l, &id), [("S".to_string(), "moved".to_string(), 3.0)]);
    }
}
