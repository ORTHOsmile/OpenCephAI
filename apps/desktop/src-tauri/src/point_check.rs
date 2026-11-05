//! Stage A′, the point check (spec §14.3, §14.5,
//! §14.13): each new model run is checked once, right after it is recorded, and the result stored (library format 19).
//! Flag-only: nothing here moves, accepts or changes a point, a run or a sign-off; it writes only the check's own rows.
//! A check that cannot run says why (`not-run`); a check that fails is logged and never fails the run.
use ceph_model::pointcheck::{score_run, Mark, ShapeScorer, RULE_VERSION};
use ceph_model::shape::Ring;
use ceph_store::{Library, PointCheckRecord};
use std::path::PathBuf;
use std::collections::HashSet;
use std::sync::{Arc, Mutex};

/// The starting knowledge, loaded: the scorer (fitted from the tracings' coordinates, as FT-2b did), the file's
/// SHA-256 and its film count.
pub type Loaded = (ShapeScorer, String, usize);

/// The point check's starting knowledge for this app run. Empty means "Point check not set up" (no tracings file, or
/// a file that was refused; the reason is logged). Loaded on first use (`ensure_loaded`), so a launch never waits on it
/// and never opens the library early. While empty, each use looks again (whole-branch review M2: a file placed, or a
/// model folder chosen, after the first run is found without a restart); once loaded it is never searched again.
/// A run made while it is empty is still recorded `not-set-up` for good (that run was not checked).
pub struct PointCheckState { slot: Mutex<Option<Arc<Loaded>>>, fixed: bool }
/// Empty and not yet loaded (the app's state at launch; in a test, a state that is not set up).
impl Default for PointCheckState { fn default() -> Self { PointCheckState { slot: Mutex::new(None), fixed: false } } }
impl PointCheckState {
    /// A state holding exactly this (for one closure's use, or a test). Never loads anything itself.
    pub fn with(loaded: Option<Arc<Loaded>>) -> Self { PointCheckState { slot: Mutex::new(loaded), fixed: true } }
    pub fn get(&self) -> Option<Arc<Loaded>> { self.slot.lock().unwrap_or_else(|p| p.into_inner()).clone() }
    /// Loads from the model folders while empty; a call made while another loads waits for it and sees its result. A
    /// load that panics (even the folder list) is caught, logged and leaves the state empty: it never poisons the state,
    /// so it never stops a later run from being recorded.
    pub fn ensure_loaded(&self, candidates: impl FnOnce() -> Vec<Option<PathBuf>>) {
        if self.fixed { return; }
        let mut g = self.slot.lock().unwrap_or_else(|p| p.into_inner());
        if g.is_some() { return; }
        *g = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| load(&candidates()))).unwrap_or_else(|_| {
            eprintln!("Point check not set up: loading the tracings file panicked"); None });
    }
}

/// The tracings file from the first candidate model folder that holds one (`model_dir::find_shape_prior`), read,
/// checked (`load_prior`) and turned into the scorer. An error says why it is not set up.
pub fn try_load(candidates: &[Option<PathBuf>]) -> Result<Loaded, String> {
    let searched: Vec<String> = candidates.iter().flatten().map(|d| d.display().to_string()).collect();
    let path = crate::model_dir::find_shape_prior(candidates).ok_or_else(|| format!(
        "Point check not set up: no shape tracings file ({}) in the model folders searched ({})",
        ceph_model::pointcheck::prior_path(std::path::Path::new("<models>")).display(), searched.join("; ")))?;
    let p = ceph_model::pointcheck::load_prior(&path).map_err(|e| format!("Point check not set up: the tracings file was refused: {e:#}"))?;
    let (sha, films) = (p.sha256.clone(), p.films);
    Ok((ShapeScorer::from_prior(&p), sha, films))
}
/// `try_load`, logging the result; None (not set up) on any failure. Never fails the app.
pub fn load(candidates: &[Option<PathBuf>]) -> Option<Arc<Loaded>> {
    match try_load(candidates) {
        Ok(l) => { eprintln!("point check set up: {} tracings, file sha256 {}", l.2, l.1); Some(Arc::new(l)) }
        Err(why) => { eprintln!("{why}"); None }
    }
}

/// Checks one new model run and stores the result; never fails the caller. Any error (a mark that is not a number,
/// a point given twice, a write the library refuses) is logged, and the run stays recorded with no check row.
pub(crate) fn check_run_or_log(l: &mut Library, case_id: &str, run_id: i64, model_id: &str, st: &PointCheckState) {
    check_run_or_log_fresh(l, case_id, run_id, model_id, st, &[])
}
/// `check_run_or_log`, with the pins the detection has just replaced (no look is carried to them, re-review N1).
pub(crate) fn check_run_or_log_fresh(l: &mut Library, case_id: &str, run_id: i64, model_id: &str, st: &PointCheckState, fresh: &[String]) {
    if let Err(e) = check_run_fresh(l, case_id, run_id, model_id, st, fresh) { eprintln!("point check not recorded for {model_id} run {run_id} on {case_id}: {e:#}"); }
}

/// The check itself. Returns whether a record was written (false: this run was already checked).
pub(crate) fn check_run(l: &mut Library, case_id: &str, run_id: i64, model_id: &str, st: &PointCheckState) -> anyhow::Result<bool> {
    check_run_fresh(l, case_id, run_id, model_id, st, &[])
}
pub(crate) fn check_run_fresh(l: &mut Library, case_id: &str, run_id: i64, model_id: &str, st: &PointCheckState, fresh: &[String]) -> anyhow::Result<bool> {
    let (film, run) = l.ai_run(run_id)?.ok_or_else(|| anyhow::anyhow!("no model run {run_id}"))?;
    anyhow::ensure!(film == case_id && run.model_id == model_id, "model run {run_id} is {} on {film}, not {model_id} on {case_id}", run.model_id);
    // An early exit only, to skip re-scoring: `point_check_runs` lists each model's LATEST run, so an older run is not
    // seen here. The guard that a run is checked once is the store's `ON CONFLICT (run_id) DO NOTHING`.
    if l.point_check_runs(case_id)?.iter().any(|(_, r)| r.run_id == run_id) { return Ok(false); }
    let Some(k) = st.get() else {
        return l.record_point_check(case_id, &PointCheckRecord { run_id, rule_version: RULE_VERSION.into(), prior_sha256: None, prior_films: None,
            outcome: "not-run".into(), not_run_reason: Some("not-set-up".into()), present: None, flags: vec![] });
    };
    let marks: Vec<Mark> = run.points.iter().filter_map(|p| p.landmark_id.as_ref().map(|id| Mark { landmark_id: id.clone(), x: p.x, y: p.y })).collect();
    let img_w = l.load(case_id)?.image.width;
    let t = std::time::Instant::now();
    // The library is locked while this runs: a panic in the scorer is caught here, so it never poisons the library's
    // lock (every later command, a save included, would then fail until a restart). It becomes an error: logged by
    // `check_run_or_log`, nothing written for this check, the run itself stays recorded.
    let rc = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        #[cfg(test)] tests::panic_if_injected();
        score_run(&k.0, &marks, run.facing == "left", img_w)
    }));
    eprintln!("point check {model_id} {} ms", t.elapsed().as_millis());
    let rc = rc.map_err(|p| anyhow::anyhow!("the point check panicked: {}",
        p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "(no message)".into())))??;
    // The one shared mapping (also what the acceptance on public films stores): `present` is counted there from `marks`.
    l.record_point_check_fresh(case_id, &ceph_store::point_check_record(run_id, &k.1, k.2 as i64, &marks, &rc), fresh)
}

/// One model's latest checked run on the film, for the screen.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RunView { pub model_id: String, pub outcome: String, pub not_run_reason: Option<String>, pub present: Option<i64> }
/// One stored flag, for the screen: a point (`landmarkId` set, `flagged`, with its ring centred on the expected
/// position, film px) or the film (`film-unusual`, `points` the ids out of keeping, no ring).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FlagView {
    pub id: i64, pub model_id: String, pub landmark_id: Option<String>, pub action: String, pub points: Option<String>, pub off_px: Option<f64>,
    pub expected_x: Option<f64>, pub expected_y: Option<f64>, pub ring: Option<Ring>, pub resolved: Option<String>,
}
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointCheckView { pub runs: Vec<RunView>, pub flags: Vec<FlagView> }

/// Each model's latest run on the film and its flags, as stored (read only).
pub fn view(l: &Library, case_id: &str) -> anyhow::Result<PointCheckView> {
    let runs = l.point_check_runs(case_id)?.into_iter()
        .map(|(model_id, r)| RunView { model_id, outcome: r.outcome, not_run_reason: r.not_run_reason, present: r.present }).collect();
    let flags = l.point_checks(case_id)?.into_iter().map(|r| {
        let f = r.flag;
        let ring = match (f.expected_x, f.expected_y, f.ring_rx, f.ring_ry, f.ring_angle_deg) {
            (Some(cx), Some(cy), Some(rx), Some(ry), Some(angle_deg)) => Some(Ring { cx, cy, rx, ry, angle_deg }),
            _ => None,
        };
        FlagView { id: r.id, model_id: r.model_id, landmark_id: f.landmark_id, action: f.action, points: f.points, off_px: f.off_px,
            expected_x: f.expected_x, expected_y: f.expected_y, ring, resolved: r.resolved }
    }).collect();
    Ok(PointCheckView { runs, flags })
}

/// After a save: every unresolved POINT flag (from every model's latest run) whose landmark is now verified, and was
/// not verified by a bulk accept, is resolved by how you looked at the point: `accepted` (a single Accept or a
/// double-click, `source` ai), `moved` (`ai-adjusted`) or `placed` (`manual`). Spec U4: a point flag is resolved when you
/// verify that point on its own; you have looked at the point itself, so every model's flag at it is resolved. A bulk
/// accept (`accept_kind` bulk) never resolves one. Only a point that went from NOT verified to verified in THIS save
/// (`was_verified`, read before the save) is resolved: a re-detect keeps verified points, and a fresh run's flag at one is
/// not a point you looked at now (spec §14.5 item 4). Film flags are never resolved here (only `film_checked`). Resolving is
/// once (the store keeps the first). Returns how many were resolved.
pub(crate) fn resolve_on_save(l: &mut Library, case_id: &str, op: &str, was_verified: &HashSet<String>) -> anyhow::Result<usize> {
    let rows: Vec<_> = l.point_checks(case_id)?.into_iter().filter(|r| r.resolved.is_none() && r.flag.landmark_id.is_some()).collect();
    if rows.is_empty() { return Ok(0); }
    let doc = l.load(case_id)?;
    let mut n = 0;
    for r in rows {
        let id = r.flag.landmark_id.as_deref().unwrap_or_default();
        let Some(lm) = doc.landmarks.iter().find(|x| x.id == id && x.verified && !was_verified.contains(&x.id) && x.accept_kind.as_deref() != Some("bulk")) else { continue };
        let how = match lm.source.as_str() { "manual" => "placed", "ai-adjusted" => "moved", _ => "accepted" };
        if l.resolve_point_check(r.id, how, op)? { n += 1; }
    }
    Ok(n)
}
/// The ids verified on the film right now, read BEFORE a save, when the film has an unresolved point flag (otherwise an
/// empty set: nothing could be resolved, so the extra read is skipped). None when it cannot be read: the save then
/// resolves nothing (the safe side), and the error is logged.
pub(crate) fn verified_before(l: &Library, case_id: &str) -> Option<HashSet<String>> {
    let open = match l.point_checks(case_id) { Ok(r) => r.iter().any(|r| r.resolved.is_none() && r.flag.landmark_id.is_some()), Err(e) => { eprintln!("point check state not read for {case_id}: {e:#}"); return None; } };
    if !open { return Some(HashSet::new()); }
    match l.load(case_id) {
        Ok(d) => Some(d.landmarks.into_iter().filter(|x| x.verified).map(|x| x.id).collect()),
        Err(e) => { eprintln!("verified points not read before the save of {case_id}: {e:#}"); None }
    }
}
/// `resolve_on_save`, logging any failure; a failed resolution never fails the save. `None` (the pre-save state could not
/// be read) resolves nothing.
pub(crate) fn resolve_on_save_or_log(l: &mut Library, case_id: &str, op: &str, was_verified: Option<&HashSet<String>>) {
    let Some(was) = was_verified else { return };
    if let Err(e) = resolve_on_save(l, case_id, op, was) { eprintln!("point check resolution not recorded for {case_id}: {e:#}"); }
}
/// "Checked" on the film note: resolves that film row, `film-checked`. Only a film row of this film's latest checked runs
/// (a point row, another film's row or an older run's row is refused). Returns false when it was already resolved.
pub(crate) fn film_checked(l: &mut Library, case_id: &str, check_id: i64, op: &str) -> anyhow::Result<bool> {
    let ok = l.point_checks(case_id)?.iter().any(|r| r.id == check_id && r.flag.landmark_id.is_none());
    anyhow::ensure!(ok, "point check {check_id} is not a film note on this film's latest check");
    l.resolve_point_check(check_id, "film-checked", op)
}
#[tauri::command] pub async fn point_check_film_checked(app: tauri::AppHandle, case_id: String, check_id: i64) -> Result<bool, String> {
    crate::library::with(&app, move |l, op| film_checked(l, &case_id, check_id, op)).await
}

#[tauri::command] pub async fn point_checks_for_case(app: tauri::AppHandle, case_id: String) -> Result<PointCheckView, String> {
    crate::library::with(&app, move |l, _| view(l, &case_id)).await
}
/// The app's starting knowledge, loaded on first use. The load (the library's lock for the remembered model folder,
/// then the file read and parse) runs on a blocking thread, never on the async runtime's.
pub(crate) async fn loaded(app: &tauri::AppHandle) -> Result<Option<Arc<Loaded>>, String> {
    let app = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let st = app.state::<PointCheckState>();
        st.ensure_loaded(|| crate::candidates(&app));
        st.get()
    }).await.map_err(|e| e.to_string())
}
/// Models… counts, one row per point (spec §14.5): how often the check flagged it and how often you left it as placed.
/// Information only; each model's latest run on each live film.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointCount { pub landmark_id: String, pub flagged: i64, pub left: i64 }
pub fn counts(l: &Library, op: &str) -> anyhow::Result<Vec<PointCount>> {
    Ok(l.point_check_counts(op)?.into_iter().map(|(landmark_id, flagged, left)| PointCount { landmark_id, flagged, left }).collect())
}
#[tauri::command] pub async fn point_check_counts(app: tauri::AppHandle) -> Result<Vec<PointCount>, String> {
    crate::library::with(&app, move |l, op| counts(l, op)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use ceph_model::pointcheck::{prior_json, prior_path, ShapeScorer, ORDER};
    use ceph_model::shape::Pt;
    use ceph_store::{AiPoint, AiRun, Library};
    use std::sync::{Arc, Mutex, OnceLock};

    const W: u32 = 2400;
    const SHA: &str = "0000000000000000000000000000000000000000000000000000000000000000";
    const AZ: &str = "aariz-cepha29";

    /// One scorer for every test (its fits are cached): SYNTHETIC faces only, the same 240 as Task 2's tests.
    fn loaded() -> Arc<Loaded> {
        static L: OnceLock<Arc<Loaded>> = OnceLock::new();
        L.get_or_init(|| Arc::new((ShapeScorer::new(ceph_model::shape::synthetic_faces(240, 4)), SHA.to_string(), 240))).clone()
    }
    fn set_up() -> PointCheckState { PointCheckState::with(Some(loaded())) }
    /// How many tracings a state holds (None: not set up).
    fn status(st: &PointCheckState) -> Option<usize> { st.get().map(|k| k.2) }
    fn face() -> Vec<Pt> { ceph_model::shape::synthetic_faces(1, 7).remove(0) }
    fn at(id: &str) -> usize { ORDER.iter().position(|x| *x == id).unwrap() }
    /// B 20 mm off (200 px at the assumed 0.1 mm/px), as in Task 2's tests.
    fn wild_b() -> Vec<Pt> { let mut f = face(); f[at("B")].0 += 200.0; f }
    fn mirror(f: &[Pt]) -> Vec<Pt> { f.iter().map(|p| ((W - 1) as f64 - p.0, p.1)).collect() }
    fn points(f: &[Pt], leave_out: &[&str]) -> Vec<AiPoint> {
        ORDER.iter().zip(f).enumerate().filter(|(_, (id, _))| !leave_out.contains(id))
            .map(|(i, (id, p))| AiPoint { channel: i as u32, landmark_id: Some(id.to_string()), x: p.0, y: p.1, peak: 1.0 }).collect()
    }
    fn ai_run(model: &str, facing: &str) -> AiRun {
        AiRun { model_id: model.into(), execution_provider: "cpu".into(), facing: facing.into(), total_ms: 1.0, model_sha256: None }
    }
    /// A new library with one SYNTHETIC film `W` px wide.
    fn lib() -> (tempfile::TempDir, Library, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        let id = film(&mut l, t.path(), "SYNTHETIC-a.png");
        (t, l, id)
    }
    fn film(l: &mut Library, dir: &std::path::Path, name: &str) -> String {
        let png = dir.join(name);
        let mut img = image::GrayImage::new(W, W);
        img.put_pixel(0, 0, image::Luma([name.bytes().fold(0u8, |a, b| a.wrapping_add(b))]));   // two films, two images (no de-duplication)
        img.save(&png).unwrap();
        l.import(&png).unwrap().case_id
    }
    /// Records a run (the store only) and returns its id; the check is then run by the test.
    fn run(l: &mut Library, case: &str, model: &str, facing: &str, pts: &[AiPoint]) -> i64 { l.record_ai_run(case, &ai_run(model, facing), pts).unwrap() }
    fn count(l: &Library, table: &str) -> i64 { l.conn_for_tests().query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap() }
    fn check_rows(l: &Library) -> [i64; 2] { [count(l, "point_check_runs"), count(l, "point_checks")] }
    fn only_run(l: &Library, case: &str) -> ceph_store::PointCheckRecord {
        let runs = l.point_check_runs(case).unwrap();
        assert_eq!(runs.len(), 1, "{runs:?}");
        runs.into_iter().next().unwrap().1
    }

    /// Test 1, through the hook: a new run is checked once; B 20 mm off gives one `flagged` row for B. Fails if the hook
    /// does not call the check (no row), or a second check of the same run writes again.
    #[test] fn a_new_run_is_checked_once_and_a_wild_point_is_flagged() {
        let (_t, mut l, a) = lib();
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), "Dr A").unwrap();
        let rec = only_run(&l, &a);
        println!("test 1: {rec:?}");
        assert_eq!((rec.outcome.as_str(), rec.not_run_reason.as_deref(), rec.present, rec.rule_version.as_str()), ("flagged", None, Some(19), "point-check/2"));
        assert_eq!((rec.prior_sha256.as_deref(), rec.prior_films), (Some(SHA), Some(240)));
        assert_eq!(rec.flags.iter().map(|f| (f.landmark_id.as_deref(), f.action.as_str())).collect::<Vec<_>>(), [(Some("B"), "flagged")]);
        let before = (check_rows(&l), l.point_check_runs(&a).unwrap());
        check_run_or_log(&mut l, &a, rec.run_id, AZ, &set_up());
        println!("test 1, checked again: runs, flags = {:?}", check_rows(&l));
        assert_eq!((check_rows(&l), l.point_check_runs(&a).unwrap()), before, "a second check of the same run writes nothing");
    }

    /// Task 8: the Models… command's rows are the store's counts, by point id, camelCase on the wire. Fails if `counts`
    /// swaps the two numbers (flagged and left) or the field names change.
    #[test] fn the_counts_command_rows_are_flagged_and_left_per_point() {
        let (_t, mut l, a) = lib();
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), "Dr A").unwrap();
        save_with(&mut l, &a, &wild_b(), "right", &[]);                     // Aariz's points on the film (only the placer's flag counts)
        let rows = counts(&l, "Dr A").unwrap();
        println!("counts: {rows:?}");
        assert_eq!(rows, [PointCount { landmark_id: "B".into(), flagged: 1, left: 0 }]);
        let id = l.point_checks(&a).unwrap()[0].id;
        l.resolve_point_check(id, "accepted", "Dr A").unwrap();
        let rows = counts(&l, "Dr A").unwrap();
        println!("after B is left as placed: {rows:?}; json {}", serde_json::to_string(&rows).unwrap());
        assert_eq!(rows, [PointCount { landmark_id: "B".into(), flagged: 1, left: 1 }]);
        assert_eq!(serde_json::to_string(&rows).unwrap(), r#"[{"landmarkId":"B","flagged":1,"left":1}]"#);
    }

    /// Every row of a table as text, sorted (a table with no rowid is still read whole).
    fn rows(l: &Library, table: &str) -> Vec<String> {
        let c = l.conn_for_tests();
        let mut st = c.prepare(&format!("SELECT * FROM {table}")).unwrap();
        let n = st.column_count();
        let mut v: Vec<String> = st.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|")))
            .unwrap().map(|r| r.unwrap()).collect();
        v.sort();
        v
    }
    const UNTOUCHED: [&str; 7] = ["landmarks", "landmark_events", "ai_points", "ai_runs", "learning_record", "point_choices", "auto_best_events"];
    fn snapshot(l: &Library) -> Vec<(&'static str, Vec<String>)> { UNTOUCHED.iter().map(|t| (*t, rows(l, t))).collect() }
    fn lm(id: &str, p: Pt, verified: bool) -> ceph_store::LandmarkRow {
        ceph_store::LandmarkRow { id: id.into(), x: p.0, y: p.1, source: "ai".into(), verified, ai_x: Some(p.0), ai_y: Some(p.1), confidence: None,
            placed_by: Some(AZ.into()), accept_kind: None, placed_via: None }
    }
    fn traced(l: &mut Library, case: &str, f: &[Pt], verified: bool) {
        let landmarks = ORDER.iter().zip(f).map(|(id, p)| lm(id, *p, verified)).collect();
        let e = ceph_store::CaseEdit { id: case.into(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks };
        crate::library::save_and_learn(l, &e, "Dr A").unwrap();
    }

    /// Test 2: nothing moves. Every row of the seven tables a check must never touch is the same before and after a check
    /// that flags. The instrument says how much it compared. Positive control (Step 4): make `check_run_or_log` run
    /// `UPDATE landmarks SET x = x + 1` → the landmarks rows differ and this fails.
    #[test] fn nothing_moves() {
        let (_t, mut l, a) = lib();
        run(&mut l, &a, AZ, "right", &points(&face(), &[]));
        traced(&mut l, &a, &face(), true);                                    // landmarks, their events, learning rows
        let r = run(&mut l, &a, AZ, "right", &points(&wild_b(), &[]));
        let before = snapshot(&l);
        check_run_or_log(&mut l, &a, r, AZ, &set_up());
        let after = snapshot(&l);
        assert_eq!(only_run(&l, &a).outcome, "flagged", "the check flagged, so it had something to write");
        let sizes: Vec<(&str, usize)> = before.iter().map(|(t, v)| (*t, v.len())).collect();
        println!("test 2: rows compared per table: {sizes:?}");
        assert!(sizes.iter().find(|(t, _)| *t == "landmarks").unwrap().1 > 0 && sizes.iter().find(|(t, _)| *t == "ai_points").unwrap().1 > 0,
            "the instrument compared nothing: {sizes:?}");
        for ((t, b), (_, a)) in before.iter().zip(&after) { assert_eq!(b, a, "{t} changed"); }
    }

    /// Test 3: a left-facing run (the marks as they sit on a left-facing film) is mirrored before scoring: B is flagged as
    /// on the right-facing copy, and the stored centre is in the left film's own px. Positive control (Step 4): pass
    /// `facing_left = false` always → the left run reads Clean (the known mirrored-face blind spot) and this fails.
    #[test] fn a_left_facing_run_is_mirrored() {
        let (t, mut l, a) = lib();
        let b = film(&mut l, t.path(), "SYNTHETIC-b.png");
        assert_ne!(a, b, "two films");
        let rr = run(&mut l, &a, AZ, "right", &points(&wild_b(), &[]));
        let rl = run(&mut l, &b, AZ, "left", &points(&mirror(&wild_b()), &[]));
        check_run_or_log(&mut l, &a, rr, AZ, &set_up());
        check_run_or_log(&mut l, &b, rl, AZ, &set_up());
        let (right, left) = (only_run(&l, &a), only_run(&l, &b));
        println!("test 3: right {:?}\n        left  {:?}", right.flags, left.flags);
        assert_eq!(left.outcome, "flagged");
        let ids = |r: &ceph_store::PointCheckRecord| r.flags.iter().map(|f| f.landmark_id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(&left), ids(&right));
        let close = |x: f64, y: f64| (x - y).abs() <= 1e-9 * x.abs().max(y.abs()).max(1.0);
        let (fr, fl) = (&right.flags[0], &left.flags[0]);
        let ex = fl.expected_x.unwrap();
        assert!(close(ex, (W - 1) as f64 - fr.expected_x.unwrap()), "left centre {ex} is the right centre mirrored into the left film's px");
        // The fixture can tell the two apart (89 px here), so the line above cannot pass with the centre left unmirrored.
        assert!((ex - fr.expected_x.unwrap()).abs() > 10.0, "the stored centre is not the facing-right one");
        assert!((ex - mirror(&wild_b())[at("B")].0).abs() < 400.0, "the centre sits near B on the left film");
        assert!(close(fl.expected_y.unwrap(), fr.expected_y.unwrap()) && close(fl.off_px.unwrap(), fr.off_px.unwrap()));
        assert!(close(fl.ring_angle_deg.unwrap(), -fr.ring_angle_deg.unwrap()) && close(fl.ring_rx.unwrap(), fr.ring_rx.unwrap()));
    }

    /// Test 4 (edge (c): no tracings file): the state is empty → one `not-run` / `not-set-up` row, no flag, no error.
    /// Fails if an empty state errors (no row) or is recorded as anything else.
    #[test] fn no_starting_knowledge_records_not_set_up() {
        let (_t, mut l, a) = lib();
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &PointCheckState::default(), "Dr A").unwrap();
        let rec = only_run(&l, &a);
        println!("test 4: {rec:?}");
        assert_eq!((rec.outcome.as_str(), rec.not_run_reason.as_deref(), rec.prior_sha256.as_deref(), rec.prior_films), ("not-run", Some("not-set-up"), None, None));
        assert!(rec.flags.is_empty());
        assert_eq!(count(&l, "ai_runs"), 1, "the run is recorded");
    }

    /// Test 5: 9 marks → `not-run` / `too-few-points`, present 9. Fails if the count is not stored or the check ran.
    #[test] fn too_few_points_records_how_many() {
        let (_t, mut l, a) = lib();
        let keep = &ORDER[..9];
        let leave: Vec<&str> = ORDER.iter().copied().filter(|x| !keep.contains(x)).collect();
        let r = run(&mut l, &a, AZ, "right", &points(&face(), &leave));
        check_run_or_log(&mut l, &a, r, AZ, &set_up());
        let rec = only_run(&l, &a);
        println!("test 5: {rec:?}");
        assert_eq!((rec.outcome.as_str(), rec.not_run_reason.as_deref(), rec.present, rec.prior_films), ("not-run", Some("too-few-points"), Some(9), Some(240)));
    }

    /// Test 6: a check that fails never fails the run. A mark that is not a number (stored as infinity: the library
    /// refuses a NaN outright, see the report) and a point given twice: the run is recorded, the error is logged, no
    /// check row. Fails if the hook passed the error up (`?`) instead of logging it.
    #[test] fn a_failed_check_never_fails_the_run() {
        let (_t, mut l, a) = lib();
        let mut bad = points(&face(), &[]); bad[3].x = f64::INFINITY;
        let mut twice = points(&face(), &[]); twice.push(AiPoint { channel: 99, ..twice[0].clone() });
        for (why, pts) in [("not a number", bad), ("twice", twice)] {
            let r = crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &pts, &set_up(), "Dr A");
            println!("test 6 ({why}): record_ai_and_learn = {r:?}; runs, checks = {}, {:?}", count(&l, "ai_runs"), check_rows(&l));
            assert!(r.is_ok());
            let id: i64 = l.conn_for_tests().query_row("SELECT MAX(id) FROM ai_runs", [], |r| r.get(0)).unwrap();
            let e = check_run(&mut l, &a, id, AZ, &set_up()).unwrap_err();
            println!("test 6 ({why}): the logged error: {e:#}");
            assert!(format!("{e:#}").contains(why));
            assert_eq!(check_rows(&l), [0, 0]);
        }
        assert_eq!(count(&l, "ai_runs"), 2);
        // Why infinity and not NaN: a NaN mark never reaches the check, because the library refuses the run itself.
        let mut nan = points(&face(), &[]); nan[3].x = f64::NAN;
        let e = crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &nan, &set_up(), "Dr A");
        println!("test 6 (NaN): record_ai_and_learn = {e:?}");
        assert!(e.is_err() && count(&l, "ai_runs") == 2 && check_rows(&l) == [0, 0]);
    }

    /// Test 7: what the screen reads is the same after closing and reopening the library. Fails if the view read
    /// anything held only in memory.
    #[test] fn closed_and_reopened_reads_the_same() {
        let (t, mut l, a) = lib();
        let r = run(&mut l, &a, AZ, "right", &points(&wild_b(), &[]));
        check_run_or_log(&mut l, &a, r, AZ, &set_up());
        let r2 = run(&mut l, &a, "srpose-cldet23", "right", &points(&face(), &["Po"]));
        check_run_or_log(&mut l, &a, r2, "srpose-cldet23", &set_up());
        let before = view(&l, &a).unwrap();
        drop(l);
        let l = Library::open(t.path()).unwrap();
        let after = view(&l, &a).unwrap();
        println!("test 7: {}", serde_json::to_string(&after).unwrap());
        assert_eq!(before, after);
        assert_eq!((after.runs.len(), after.flags.len()), (2, 1));
    }

    /// Test 8: a re-detect (a second run of the same model) replaces the first in the view. Fails if the view showed
    /// every run (B's flag from the first run would still be there).
    #[test] fn the_latest_run_per_model_is_shown() {
        let (_t, mut l, a) = lib();
        let r1 = run(&mut l, &a, AZ, "right", &points(&wild_b(), &[]));
        check_run_or_log(&mut l, &a, r1, AZ, &set_up());
        assert_eq!(view(&l, &a).unwrap().flags.len(), 1);
        let r2 = run(&mut l, &a, AZ, "right", &points(&face(), &[]));
        check_run_or_log(&mut l, &a, r2, AZ, &set_up());
        let v = view(&l, &a).unwrap();
        println!("test 8: {}", serde_json::to_string(&v).unwrap());
        assert_eq!(v.runs, [RunView { model_id: AZ.into(), outcome: "clean".into(), not_run_reason: None, present: Some(19) }]);
        assert!(v.flags.is_empty());
    }

    /// Test 9 (ruling F13): S, N, Po and L1T each 25 mm off → `film-unusual`, exactly one row for the film (no point, the
    /// four ids listed) and no `flagged` row. Fails if FilmUnusual were stored as point rows.
    #[test] fn four_wild_points_store_one_film_row_and_no_point_rows() {
        let (_t, mut l, a) = lib();
        let mut f = face();
        for id in ["S", "N", "Po", "L1T"] { f[at(id)].1 -= 250.0; }
        let r = run(&mut l, &a, AZ, "right", &points(&f, &[]));
        check_run_or_log(&mut l, &a, r, AZ, &set_up());
        let rec = only_run(&l, &a);
        println!("test 9: {rec:?}");
        assert_eq!(rec.outcome, "film-unusual");
        assert_eq!(rec.flags.len(), 1);
        let ff = &rec.flags[0];
        assert_eq!((ff.landmark_id.as_deref(), ff.action.as_str(), ff.tail, ff.off_px, ff.expected_x, ff.ring_rx), (None, "film-unusual", None, None, None, None));
        let mut named: Vec<&str> = ff.points.as_deref().unwrap().split(',').collect();
        named.sort();
        let mut want = vec!["S", "N", "Po", "L1T"]; want.sort();
        assert_eq!(named, want);
        let v = view(&l, &a).unwrap();
        assert_eq!(v.flags.iter().filter(|x| x.action == "flagged").count(), 0, "no mark on any pin");
        assert_eq!(v.flags[0].ring, None);
    }

    /// Test 10: the state comes from the tracings file in the first model folder that holds one. A SYNTHETIC file
    /// (`prior_json` of 300 SYNTHETIC faces: the file format takes exactly 300, see the report) → set up with 300
    /// films, and B 20 mm off is flagged. A refused file (wrong version) and a missing file → empty, with the reason.
    /// Fails if the loader skipped the file, read a different folder, or let a refused file through.
    #[test] fn the_state_is_loaded_from_the_tracings_file() {
        let films: Vec<(String, Vec<Pt>)> = ceph_model::shape::synthetic_faces(300, 4).into_iter().enumerate().map(|(i, f)| (format!("{:03}", i + 1), f)).collect();
        let text = prior_json(&films).unwrap();
        let (empty, good, bad) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        for (d, t) in [(&good, text.clone()), (&bad, text.replace("shape-prior/2", "shape-prior/1"))] {
            let p = prior_path(d.path());
            std::fs::create_dir_all(p.parent().unwrap()).unwrap();
            std::fs::write(&p, t).unwrap();
        }
        let cands = |v: &[&tempfile::TempDir]| -> Vec<Option<std::path::PathBuf>> { std::iter::once(None).chain(v.iter().map(|d| Some(d.path().to_path_buf()))).collect() };
        let got = try_load(&cands(&[&empty, &good, &bad])).unwrap();
        println!("test 10: set up from the first folder holding the file: {} films, sha {}", got.2, got.1);
        assert_eq!((got.2, got.0.films(), got.1.len()), (300, 300, 64));
        let st = PointCheckState::with(Some(Arc::new(got)));
        assert_eq!(status(&st), Some(300));
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, AZ, "right", &points(&wild_b(), &[]));
        check_run_or_log(&mut l, &a, r, AZ, &st);
        let rec = only_run(&l, &a);
        assert_eq!((rec.outcome.as_str(), rec.flags[0].landmark_id.as_deref(), rec.prior_films), ("flagged", Some("B"), Some(300)));
        for (why, c) in [("refused", cands(&[&empty, &bad, &good])), ("missing", cands(&[&empty]))] {
            let e = try_load(&c).err().unwrap();
            println!("test 10 ({why}): {e}");
            assert!(if why == "refused" { e.contains("shape-prior/1") } else { e.contains("Point check not set up") }, "{e}");
            let st = PointCheckState::with(load(&c));
            assert_eq!(status(&st), None);
        }
    }

    /// The app's state loads on first use: once loaded, a later call never looks at the folders again, and a state made
    /// with `with` never loads. Fails if `ensure_loaded` re-read the folders each time (the second closure
    /// panics) or a state made for one closure could load the file itself.
    #[test] fn the_app_state_loads_once_on_first_use() {
        let films: Vec<(String, Vec<Pt>)> = ceph_model::shape::synthetic_faces(300, 4).into_iter().enumerate().map(|(i, f)| (format!("{:03}", i + 1), f)).collect();
        let d = tempfile::tempdir().unwrap();
        let p = prior_path(d.path()); std::fs::create_dir_all(p.parent().unwrap()).unwrap(); std::fs::write(&p, prior_json(&films).unwrap()).unwrap();
        let st = PointCheckState::default();
        assert_eq!(status(&st), None, "nothing loaded before first use");
        st.ensure_loaded(|| vec![Some(d.path().to_path_buf())]);
        assert_eq!(status(&st), Some(300));
        st.ensure_loaded(|| panic!("the folders were searched a second time"));
        let fixed = PointCheckState::with(None);
        fixed.ensure_loaded(|| panic!("a state made with `with` loaded the file"));
        assert_eq!(status(&fixed), None);
    }

    /// Whole-branch review M2: while the state is empty (no tracings file yet), each use looks again, so a file placed
    /// (or a model folder chosen) after the first run is found without a restart; once loaded, it is never searched
    /// again. A load that panics leaves the state empty and usable (no poisoned `Once`). Fails today: `Once` never
    /// looks a second time, so the second call stays "not set up".
    #[test] fn an_empty_state_looks_again_until_the_file_is_there() {
        let films: Vec<(String, Vec<Pt>)> = ceph_model::shape::synthetic_faces(300, 4).into_iter().enumerate().map(|(i, f)| (format!("{:03}", i + 1), f)).collect();
        let d = tempfile::tempdir().unwrap();
        let st = PointCheckState::default();
        st.ensure_loaded(|| vec![Some(d.path().to_path_buf())]);            // no file yet
        assert!(st.get().is_none());
        let caught = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| st.ensure_loaded(|| panic!("SYNTHETIC: the folder list could not be read"))));
        println!("M2: a load that panicked: caught = {}, still usable = {}", caught.is_err(), st.get().is_none());
        let p = prior_path(d.path()); std::fs::create_dir_all(p.parent().unwrap()).unwrap(); std::fs::write(&p, prior_json(&films).unwrap()).unwrap();
        st.ensure_loaded(|| vec![Some(d.path().to_path_buf())]);            // the file is there now
        println!("M2: after the file is placed: set up = {}", st.get().is_some());
        assert_eq!(st.get().map(|k| k.2), Some(300));
        st.ensure_loaded(|| panic!("the folders were searched after it loaded"));
    }

    thread_local! { static PANIC_IN_SCORING: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
    /// The test seam: a scorer that panics, on this test's thread only.
    pub(super) fn panic_if_injected() { if PANIC_IN_SCORING.with(|p| p.get()) { panic!("injected panic in the scorer (test seam)"); } }

    /// Fix round 1: the check runs while the library is locked, so a panic in the scorer must be caught there. It is
    /// logged, nothing is written for that check, the run itself stays recorded, and the library's lock is NOT poisoned:
    /// a save made next works. Driven through the real lock (`with_at`). Fails if the scoring is not wrapped in
    /// `catch_unwind` (the panic escapes `with_at` and poisons the lock).
    #[test] fn a_panic_while_scoring_is_logged_and_never_poisons_the_library() {
        let (t, l, a) = lib();
        let lock = Mutex::new(Some(l));
        PANIC_IN_SCORING.with(|p| p.set(true));
        let r = crate::library::with_at(&lock, t.path(), |l, op| crate::library::record_ai_and_learn(l, &a, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), op));
        PANIC_IN_SCORING.with(|p| p.set(false));
        println!("fix 1: record_ai_and_learn under the lock with a panicking scorer = {r:?}; lock poisoned: {}", lock.is_poisoned());
        assert_eq!(r, Ok(()));
        assert!(!lock.is_poisoned(), "the library lock was poisoned");
        let next = crate::library::with_at(&lock, t.path(), |l, _| { traced(l, &a, &face(), true); Ok((count(l, "ai_runs"), check_rows(l), l.load(&a)?.landmarks.len())) });
        println!("fix 1: the next library command (a save) = {next:?}");
        assert_eq!(next, Ok((1, [0, 0], 19)), "the run recorded, no check row, and the save after it worked");
        // The error the log line carries.
        PANIC_IN_SCORING.with(|p| p.set(true));
        let e = { let mut g = lock.lock().unwrap(); let l = g.as_mut().unwrap(); let id = run(l, &a, AZ, "right", &points(&wild_b(), &[])); check_run(l, &a, id, AZ, &set_up()) };
        PANIC_IN_SCORING.with(|p| p.set(false));
        let e = format!("{:#}", e.unwrap_err());
        println!("fix 1: logged: {e}");
        assert!(e.contains("panicked") && e.contains("injected panic"), "{e}");
        assert!(!lock.is_poisoned());
    }

    // ---- Task 7: a flag is resolved by looking at the point on its own, or by Checked ----

    /// One landmark row for a save: `kind` is how it was accepted (None: not verified).
    fn lmk(id: &str, p: Pt, source: &str, kind: Option<&str>) -> ceph_store::LandmarkRow {
        ceph_store::LandmarkRow { id: id.into(), x: p.0, y: p.1, source: source.into(), verified: kind.is_some(), ai_x: Some(p.0), ai_y: Some(p.1), confidence: None,
            placed_by: Some(AZ.into()), accept_kind: kind.map(String::from), placed_via: None }
    }
    /// Saves the whole face with these overrides (id -> (source, accept kind)); every other point stays unverified AI.
    fn save_with(l: &mut Library, case: &str, f: &[Pt], facing: &str, over: &[(&str, &str, &str)]) {
        let landmarks = ORDER.iter().zip(f).map(|(id, p)| match over.iter().find(|o| o.0 == *id) {
            Some((_, src, kind)) => lmk(id, *p, src, Some(kind)), None => lmk(id, *p, "ai", None) }).collect();
        let e = ceph_store::CaseEdit { id: case.into(), facing: facing.into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks };
        crate::library::save_and_learn(l, &e, "Dr A").unwrap();
    }
    fn res(l: &Library) -> Vec<(String, String)> {
        let c = l.conn_for_tests();
        let mut st = c.prepare("SELECT c.landmark_id, r.how FROM point_check_resolutions r JOIN point_checks c ON c.id = r.check_id ORDER BY c.id").unwrap();
        st.query_map([], |r| Ok((r.get::<_, Option<String>>(0)?.unwrap_or_default(), r.get(1)?))).unwrap().map(|r| r.unwrap()).collect()
    }
    /// A library with B flagged (20 mm off) by AZ on one film.
    fn flagged_b() -> (tempfile::TempDir, Library, String) {
        let (t, mut l, a) = lib();
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), "Dr A").unwrap();
        assert_eq!(only_run(&l, &a).flags.len(), 1);
        (t, l, a)
    }

    /// A point verified by a bulk accept never resolves a flag. Only `resolve_on_save` prevents it (the store has no such
    /// rule), so this fails if the `bulk` test is removed from it. Prints the resolution rows compared.
    #[test] fn a_bulk_accept_never_resolves_a_flag() {
        let (_t, mut l, a) = flagged_b();
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai", "bulk"), ("N", "ai", "bulk")]);
        println!("task 7, bulk: resolutions = {:?}; flags read = {}", res(&l), l.point_checks(&a).unwrap().len());
        assert_eq!(l.point_checks(&a).unwrap().len(), 1, "the instrument saw the flag");
        assert!(res(&l).is_empty(), "no resolution row after a bulk accept");
        assert_eq!(l.unresolved_point_checks(&a, AZ).unwrap().len(), 1);
    }
    /// Single accept, double-click -> `accepted`; a drag -> `moved`; a hand placement -> `placed`. Fails if any maps to another word.
    #[test] fn each_way_of_looking_at_the_point_is_recorded_as_itself() {
        for (src, kind, want) in [("ai", "single", "accepted"), ("ai", "double-click", "accepted"), ("ai-adjusted", "drag", "moved"), ("manual", "hand", "placed")] {
            let (_t, mut l, a) = flagged_b();
            save_with(&mut l, &a, &wild_b(), "right", &[("B", src, kind)]);
            println!("task 7, {src}/{kind}: resolutions = {:?}", res(&l));
            assert_eq!(res(&l), [("B".to_string(), want.to_string())]);
            let who: String = l.conn_for_tests().query_row("SELECT operator FROM point_check_resolutions", [], |r| r.get(0)).unwrap();
            assert_eq!(who, "Dr A");
        }
    }
    /// A point that is not verified, or another point that is, resolves nothing.
    #[test] fn another_point_or_an_unverified_one_resolves_nothing() {
        let (_t, mut l, a) = flagged_b();
        save_with(&mut l, &a, &wild_b(), "right", &[("S", "ai", "single")]);
        assert!(res(&l).is_empty(), "S accepted, B still flagged");
        save_with(&mut l, &a, &wild_b(), "right", &[]);
        assert!(res(&l).is_empty());
    }
    /// Resolving twice writes once: a later save, or a later gesture, keeps the first resolution.
    #[test] fn resolving_twice_writes_once() {
        let (_t, mut l, a) = flagged_b();
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai", "single")]);
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai-adjusted", "drag")]);
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai-adjusted", "drag"), ("S", "ai", "single")]);
        println!("task 7, twice: resolutions = {:?}", res(&l));
        assert_eq!(res(&l), [("B".to_string(), "accepted".to_string())], "one row, the first way kept");
    }
    /// Fix round 1 (review important 2): only a point that went from NOT verified to verified in THIS save is resolved.
    /// A re-detect keeps verified points and the fresh run may flag one; the next save (here, accepting S) must not write
    /// `accepted` for a look that never happened. Fails if `resolve_on_save` ignores the pre-save verified set (the induced
    /// failure: pass an empty set). Control in the same test: the same flag IS resolved when B itself is verified in a save.
    #[test] fn a_flag_at_an_already_verified_point_is_not_resolved_by_a_later_save() {
        let (_t, mut l, a) = lib();
        run(&mut l, &a, AZ, "right", &points(&face(), &[]));
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai", "single")]);              // B verified before any flag exists
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), "Dr A").unwrap();   // the re-detect's run flags B
        assert_eq!(only_run(&l, &a).flags.len(), 1, "the fresh run flagged B");
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai", "single"), ("S", "ai", "single")]);   // a later save: S accepted
        println!("fix 1, flag at an already-verified B, then S accepted: resolutions = {:?}; flags read = {}", res(&l), l.point_checks(&a).unwrap().len());
        assert_eq!(l.point_checks(&a).unwrap().len(), 1, "the instrument saw the flag");
        assert!(res(&l).is_empty(), "no resolution for a look that never happened");
        // Control: a point that WAS unverified and is verified in this save still resolves.
        let (_t2, mut l2, a2) = flagged_b();
        save_with(&mut l2, &a2, &wild_b(), "right", &[("S", "ai", "single")]);
        save_with(&mut l2, &a2, &wild_b(), "right", &[("S", "ai", "single"), ("B", "ai", "single")]);
        assert_eq!(res(&l2), [("B".to_string(), "accepted".to_string())]);
    }
    /// Whole-branch review I3, through the app's own path: B flagged, B accepted on its own (resolved), then Re-detect with
    /// the same marks. The fresh run flags B again; B is verified, so nothing is drawn there and no later save could
    /// resolve it. The look is carried, so the habit offset's read stays empty. Fails today: the new run's B is a fresh
    /// unresolved row (`unresolved_point_checks` = [B]). Control in the same test: a B verified by a bulk accept is not
    /// carried (no look), and stays open.
    #[test] fn a_redetect_after_a_look_leaves_nothing_unresolved() {
        let (_t, mut l, a) = flagged_b();
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai", "single")]);
        assert_eq!(res(&l), [("B".to_string(), "accepted".to_string())]);
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), "Dr A").unwrap();   // Re-detect
        let rec = only_run(&l, &a);
        let open = l.unresolved_point_checks(&a, AZ).unwrap();
        println!("I3, after Re-detect: new run flags {:?}; resolutions {:?}; unresolved {}", rec.flags.iter().map(|f| &f.landmark_id).collect::<Vec<_>>(), res(&l), open.len());
        assert_eq!(rec.flags.len(), 1, "the fresh run flagged B again");
        assert!(open.is_empty(), "the look at B carries to the new run's flag");
        assert_eq!(res(&l), [("B".to_string(), "accepted".to_string()), ("B".to_string(), "accepted".to_string())]);
        let (_t2, mut l2, a2) = flagged_b();
        save_with(&mut l2, &a2, &wild_b(), "right", &[("B", "ai", "bulk")]);
        crate::library::record_ai_and_learn(&mut l2, &a2, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), "Dr A").unwrap();
        assert_eq!(l2.unresolved_point_checks(&a2, AZ).unwrap().len(), 1, "bulk: no look, nothing carried");
    }
    /// Re-review N1: Replace all puts a fresh, unverified pin at every point, but the run is stored before the autosave
    /// writes those pins, so the store still holds the OLD verified B. The detection names the pins it replaced
    /// (`fresh`), and no look is carried to them: the new run's flag at B stays unresolved until B itself is looked at.
    /// Fails today: the flag is carried as `accepted` (Dr A, the old time). Control: the same run without `fresh`
    /// (a Re-detect that keeps B) still carries.
    #[test] fn replace_all_never_carries_a_look_to_a_fresh_pin() {
        let (_t, mut l, a) = flagged_b();
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai", "single")]);          // the look at B
        let fresh: Vec<String> = ORDER.iter().map(|id| id.to_string()).collect();       // Replace all: every pin replaced
        crate::library::record_ai_and_learn_fresh(&mut l, &a, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), "Dr A", &fresh).unwrap();
        let open = l.unresolved_point_checks(&a, AZ).unwrap();
        println!("N1, Replace all after a look at B: resolutions {:?}; unresolved {:?}", res(&l), open.iter().map(|x| &x.flag.landmark_id).collect::<Vec<_>>());
        assert_eq!(only_run(&l, &a).flags.len(), 1, "the new run flagged B");
        assert_eq!(open.len(), 1, "B is a fresh pin nobody has looked at: its flag stays open");
        assert_eq!(res(&l), [("B".to_string(), "accepted".to_string())], "only the old run's look is recorded");
        let (_t2, mut l2, a2) = flagged_b();
        save_with(&mut l2, &a2, &wild_b(), "right", &[("B", "ai", "single")]);
        crate::library::record_ai_and_learn_fresh(&mut l2, &a2, &ai_run(AZ, "right"), &points(&wild_b(), &[]), &set_up(), "Dr A", &[]).unwrap();
        assert!(l2.unresolved_point_checks(&a2, AZ).unwrap().is_empty(), "control: a Re-detect that kept B carries the look");
    }
    /// Two models flagged B; B accepted on its own resolves both flags (every model's latest flag at that point).
    /// Fails if only the placing model's flag is resolved.
    #[test] fn two_models_flagged_the_same_point_both_are_resolved() {
        let (_t, mut l, a) = flagged_b();
        let r = run(&mut l, &a, "srpose-cldet23", "right", &points(&wild_b(), &[]));
        check_run_or_log(&mut l, &a, r, "srpose-cldet23", &set_up());
        assert_eq!(l.point_checks(&a).unwrap().len(), 2);
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai", "single")]);
        println!("task 7, two models: resolutions = {:?}", res(&l));
        assert_eq!(res(&l).len(), 2);
        assert!(l.unresolved_point_checks(&a, AZ).unwrap().is_empty() && l.unresolved_point_checks(&a, "srpose-cldet23").unwrap().is_empty());
    }
    /// Flipped film: resolution is by landmark id, whichever way the film faces.
    #[test] fn a_left_facing_film_resolves_by_landmark_id() {
        let (_t, mut l, a) = lib();
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "left"), &points(&mirror(&wild_b()), &[]), &set_up(), "Dr A").unwrap();
        assert_eq!(only_run(&l, &a).flags[0].landmark_id.as_deref(), Some("B"));
        save_with(&mut l, &a, &mirror(&wild_b()), "left", &[("B", "ai-adjusted", "drag")]);
        println!("task 7, left-facing: resolutions = {:?}", res(&l));
        assert_eq!(res(&l), [("B".to_string(), "moved".to_string())]);
    }
    /// No check at all (a film traced before format 19, or not set up): a save resolves nothing and does not fail.
    #[test] fn a_film_with_no_check_saves_as_before() {
        let (_t, mut l, a) = lib();
        run(&mut l, &a, AZ, "right", &points(&wild_b(), &[]));
        save_with(&mut l, &a, &wild_b(), "right", &[("B", "ai", "single")]);
        assert!(res(&l).is_empty());
        assert_eq!(count(&l, "landmarks"), 19);
    }
    /// A resolution failing never fails the save: the landmarks are saved either way.
    #[test] fn a_failed_resolution_never_fails_the_save() {
        let (_t, mut l, a) = flagged_b();
        l.conn_for_tests().execute_batch("DROP TABLE point_check_resolutions").unwrap();
        let landmarks = ORDER.iter().zip(wild_b()).map(|(id, p)| lmk(id, p, "ai", if *id == "B" { Some("single") } else { None })).collect();
        let e = ceph_store::CaseEdit { id: a.clone(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks };
        assert!(crate::library::save_and_learn(&mut l, &e, "Dr A").is_ok());
        assert!(l.load(&a).unwrap().landmarks.iter().any(|x| x.id == "B" && x.verified));
    }

    /// A film flag: no save resolves it, a "bulk accept of all 19" leaves it, only the command does, once.
    #[test] fn a_film_flag_is_resolved_only_by_the_command() {
        let (_t, mut l, a) = lib();
        let mut f = face();
        for id in ["S", "N", "Po", "L1T"] { f[at(id)].1 -= 250.0; }
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &points(&f, &[]), &set_up(), "Dr A").unwrap();
        assert_eq!(only_run(&l, &a).outcome, "film-unusual");
        // "Accept remaining": every point verified in bulk; and a single accept of every point too.
        let all_bulk: Vec<(&str, &str, &str)> = ORDER.iter().map(|id| (*id, "ai", "bulk")).collect();
        save_with(&mut l, &a, &f, "right", &all_bulk);
        let all_single: Vec<(&str, &str, &str)> = ORDER.iter().map(|id| (*id, "ai", "single")).collect();
        save_with(&mut l, &a, &f, "right", &all_single);
        println!("task 7, film flag after every point verified: resolutions = {:?}; verified = {}", res(&l), l.load(&a).unwrap().landmarks.iter().filter(|x| x.verified).count());
        assert!(res(&l).is_empty(), "no save resolves the film flag");
        assert_eq!(l.load(&a).unwrap().landmarks.iter().filter(|x| x.verified).count(), 19);
        let id = l.point_checks(&a).unwrap()[0].id;
        assert!(film_checked(&mut l, &a, id, "Dr A").unwrap());
        assert!(!film_checked(&mut l, &a, id, "Dr B").unwrap(), "pressing again writes nothing");
        println!("task 7, after Checked: resolutions = {:?}", res(&l));
        assert_eq!(res(&l), [(String::new(), "film-checked".to_string())]);
    }
    /// The command refuses what is not a film row of this film's latest run: a point row, another film's row, a stale row, nothing.
    #[test] fn the_checked_command_refuses_anything_but_this_films_current_film_row() {
        let (t, mut l, a) = flagged_b();
        let point_id = l.point_checks(&a).unwrap()[0].id;
        let e1 = film_checked(&mut l, &a, point_id, "Dr A");
        let b = film(&mut l, t.path(), "SYNTHETIC-b.png");
        let mut f = face();
        for id in ["S", "N", "Po", "L1T"] { f[at(id)].1 -= 250.0; }
        crate::library::record_ai_and_learn(&mut l, &b, &ai_run(AZ, "right"), &points(&f, &[]), &set_up(), "Dr A").unwrap();
        let other = l.point_checks(&b).unwrap()[0].id;
        let e2 = film_checked(&mut l, &a, other, "Dr A");
        let e3 = film_checked(&mut l, &a, other + 999, "Dr A");
        crate::library::record_ai_and_learn(&mut l, &b, &ai_run(AZ, "right"), &points(&face(), &[]), &set_up(), "Dr A").unwrap();   // b re-detected: `other` is stale
        let e4 = film_checked(&mut l, &b, other, "Dr A");
        for (why, e) in [("a point row", &e1), ("another film's row", &e2), ("no such row", &e3), ("a superseded run's row", &e4)] {
            println!("task 7, Checked on {why}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{why}");
        }
        assert!(res(&l).is_empty(), "nothing written by any refusal");
    }

    // ---- The standing edge cases (each prints its row for the report) ----

    /// S or N missing: a run without N is checked on 18 points. Fails if a missing N stopped the check.
    #[test] fn edge_a_run_without_n_is_checked_on_18() {
        let (_t, mut l, a) = lib();
        for (f, want) in [(face(), "clean"), (wild_b(), "flagged")] {
            let r = run(&mut l, &a, AZ, "right", &points(&f, &["N"]));
            check_run_or_log(&mut l, &a, r, AZ, &set_up());
            let rec = only_run(&l, &a);
            println!("edge, N missing: {rec:?}");
            assert_eq!((rec.outcome.as_str(), rec.present), (want, Some(18)));
        }
    }
    /// Every point offset together: a run shifted 300 px has the same outcome as unshifted (B flagged, same tail within
    /// 1e-9); the stored centre moves with the film. Fails if the check scored raw film px.
    #[test] fn edge_a_run_shifted_300_px_has_the_same_outcome() {
        let (_t, mut l, a) = lib();
        let shifted: Vec<Pt> = wild_b().iter().map(|p| (p.0 + 300.0, p.1 + 300.0)).collect();
        let mut got = vec![];
        for (model, f) in [(AZ, wild_b()), ("srpose-cldet23", shifted)] {
            let r = run(&mut l, &a, model, "right", &points(&f, &[]));
            check_run_or_log(&mut l, &a, r, model, &set_up());
        }
        for (m, rec) in l.point_check_runs(&a).unwrap() { println!("edge, offset ({m}): {rec:?}"); got.push(rec); }
        let (u, s) = (&got[0], &got[1]);
        assert_eq!((u.outcome.as_str(), s.outcome.as_str()), ("flagged", "flagged"));
        assert_eq!(u.flags.iter().map(|f| &f.landmark_id).collect::<Vec<_>>(), s.flags.iter().map(|f| &f.landmark_id).collect::<Vec<_>>());
        assert!((u.flags[0].tail.unwrap() / s.flags[0].tail.unwrap() - 1.0).abs() < 1e-9);
        assert!((s.flags[0].expected_x.unwrap() - u.flags[0].expected_x.unwrap() - 300.0).abs() < 1e-6);
    }
    /// A model with fewer points: a SYNTHETIC model id with 15 of the 19 is checked, present 15.
    #[test] fn edge_a_model_with_15_points_is_checked() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "synthetic-15-points", "right", &points(&face(), &["Po", "Or", "Ar", "PNS"]));
        check_run_or_log(&mut l, &a, r, "synthetic-15-points", &set_up());
        let rec = only_run(&l, &a);
        println!("edge, 15 points: {rec:?}");
        assert_eq!((rec.outcome.as_str(), rec.present), ("clean", Some(15)));
    }
    /// A locked film: a run recorded on a signed-off film is still checked (the raw run is evidence), and nothing about
    /// the sign-off changes. Fails if the check refused a signed-off film, or touched its sign-off.
    #[test] fn edge_a_signed_off_film_is_still_checked_and_stays_signed_off() {
        let (_t, mut l, a) = lib();
        run(&mut l, &a, AZ, "right", &points(&face(), &[]));
        traced(&mut l, &a, &face(), true);
        l.set_verified(&a, true, "Dr A").unwrap();
        let signed = l.load(&a).unwrap();
        assert!(signed.verified_at.is_some());
        let r = run(&mut l, &a, AZ, "right", &points(&wild_b(), &[]));
        let before = snapshot(&l);
        check_run_or_log(&mut l, &a, r, AZ, &set_up());
        let after_doc = l.load(&a).unwrap();
        let rec = only_run(&l, &a);
        println!("edge, signed off: verified_at {:?} -> {:?}, by {:?} -> {:?}; {rec:?}", signed.verified_at, after_doc.verified_at, signed.verified_by, after_doc.verified_by);
        assert_eq!(rec.outcome, "flagged");
        assert_eq!((signed.verified_at, signed.verified_by, signed.landmarks), (after_doc.verified_at, after_doc.verified_by, after_doc.landmarks));
        assert_eq!(before, snapshot(&l));
    }

    /// The view's field names, as the screen reads them (camelCase), and the ring centred on the expected position.
    #[test] fn the_view_is_camel_case_with_the_ring_at_the_expected_centre() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, AZ, "right", &points(&wild_b(), &[]));
        check_run_or_log(&mut l, &a, r, AZ, &set_up());
        let v = serde_json::to_value(view(&l, &a).unwrap()).unwrap();
        println!("view: {v}");
        let f = &v["flags"][0];
        for k in ["id", "modelId", "landmarkId", "action", "points", "offPx", "expectedX", "expectedY", "ring", "resolved"] { assert!(f.get(k).is_some(), "{k} missing: {f}"); }
        for k in ["modelId", "outcome", "notRunReason", "present"] { assert!(v["runs"][0].get(k).is_some(), "{k} missing"); }
        assert_eq!((&f["ring"]["cx"], &f["ring"]["cy"]), (&f["expectedX"], &f["expectedY"]));
        assert!(f["ring"]["angleDeg"].is_number());
    }
}
