//! Part F, the weights check (owner Q4, 18 Oct; spec: "When a
//! model's file changes"): when an installed model's file changes, run the new file on the older films its earlier file
//! measured and store, per point, both files' distances from your final point, measured the way the learning record
//! measures (`learning_rows_for`, unchanged). In the background, one film at a time, giving way to tracing: it runs each
//! model on its own copy (`check_detect`), so tracing never waits behind the check's film (final review I-1); it starts
//! no film while tracing runs that model; and it starts no model load while tracing runs the extra models, whose 15 s
//! begins only after a check load already under way ends, or after 15 s if it never does (`ModelsState::check_engine`;
//! the main model, which has no limit, can wait for one check load). Nothing here reaches the learning record, a film's
//! ghost marks or an offer, and nothing is ever switched.
use crate::learning::{learning_rows_for, placer_of};
use ceph_infer::engine::{load_gray, Detection};
use ceph_model::{best::DEFAULT_BASE, fingerprint::{earlier_films, normalise}, regress::{summarise, CheckPoint, CheckRow, CheckVerdict, CHECK_VERSION}, scores::ORIGINAL_19};
use ceph_store::{AiPoint, CaseDoc, CheckFilm, Library, ModelPoints, WeightsCheckFilm, WeightsCheckRow};
use serde::Serialize;
use std::{collections::{BTreeMap, BTreeSet}, path::Path, sync::{atomic::{AtomicBool, Ordering}, Arc, Mutex}, time::Duration};
use tauri::{Emitter, Manager};

/// The points of one older film the check compares, each with the earlier file's distance (mm) from your final point:
/// one of the 19; verified or placed by hand; a ruler on the film (F4); placed by Aariz or by you (Q11), and for Aariz
/// itself by you only (an Aariz-placed point holds Aariz's free zero); and the earlier file marked it (same facing).
pub fn eligible(doc: &CaseDoc, history: &[ModelPoints], machine: Option<String>, model_id: &str, current: &str) -> Vec<(String, f64)> {
    if !doc.spacing_mm.is_some_and(ceph_infer::crosscheck::scale_ok) { return vec![]; }
    let is_current = |r: &ModelPoints| r.model_id == model_id && normalise(&r.model_id, r.model_sha256.as_deref()).as_deref() == Some(current);
    let earlier: Vec<ModelPoints> = history.iter().filter(|r| !is_current(r)).cloned().collect();
    let rows = learning_rows_for(doc, &earlier, machine);
    doc.landmarks.iter()
        .filter(|row| ORIGINAL_19.contains(&row.id.as_str()) && (row.verified || row.source == "manual"))
        .filter(|row| row.source == "manual" || (model_id != DEFAULT_BASE && placer_of(row, history).as_deref() == Some(DEFAULT_BASE)))
        .filter_map(|row| rows.iter().find(|r| r.landmark_id == row.id && r.model_id == model_id && !r.placer).map(|r| (row.id.clone(), r.dist_mm)))
        .collect()
}

/// One older film, read from the library, ready to run (the library is not held while the model runs).
pub struct FilmJob {
    pub path: String, pub facing_left: bool,
    pub doc: CaseDoc, pub history: Vec<ModelPoints>, pub machine: Option<String>, pub eligible: Vec<(String, f64)>,
}

/// None: nothing on this film to check, so the model is not run.
pub fn prepare(l: &Library, model_id: &str, current: &str, case_id: &str) -> anyhow::Result<Option<FilmJob>> {
    let (doc, history, machine) = (l.load(case_id)?, l.ai_run_history(case_id)?, l.machine_of(case_id)?);
    let eligible = eligible(&doc, &history, machine.clone(), model_id, current);
    if eligible.is_empty() { return Ok(None); }
    Ok(Some(FilmJob { path: doc.image.path.clone(), facing_left: doc.facing == "left", doc, history, machine, eligible }))
}

/// A detection as the library stores a run (the front end's `pointsOf`: every channel's point).
fn run_of(d: &Detection, facing: &str) -> ModelPoints {
    ModelPoints { model_id: d.model_id.clone(), ran_at: String::new(), facing: facing.into(), execution_provider: d.execution_provider.clone(),
        model_sha256: Some(d.model_sha256.clone()),
        points: d.raw.iter().map(|p| AiPoint { channel: p.channel, landmark_id: p.landmark_id.clone(), x: p.x, y: p.y, peak: p.peak as f64 }).collect() }
}

/// The film's outcome, detail and points (landmark, earlier mm, new mm or None). The new run is put first in the
/// film's history, so `learning_rows_for` takes it as the model's newest mark and measures it against the same final
/// point with the same ruler as the earlier one.
pub fn finish(job: &FilmJob, model_id: &str, current: &str, ran: Result<Detection, String>) -> (&'static str, String, Vec<(String, f64, Option<f64>)>) {
    let d = match ran { Ok(d) => d, Err(e) => return ("failed", e, vec![]) };
    if d.model_id != model_id || d.model_sha256 != current {
        let short = |s: &str| s.chars().take(8).collect::<String>();
        return ("failed", format!("the model's file changed during the check ({} ran, {} expected)", short(&d.model_sha256), short(current)), vec![]);
    }
    let mut history = vec![run_of(&d, &job.doc.facing)];
    history.extend(job.history.iter().cloned());
    let rows = learning_rows_for(&job.doc, &history, job.machine.clone());
    let points = job.eligible.iter().map(|(lm, old)| (lm.clone(), *old,
        rows.iter().find(|r| &r.landmark_id == lm && r.model_id == model_id && !r.placer).map(|r| r.dist_mm))).collect();
    ("measured", String::new(), points)
}

/// Per installed model whose file changed: (model, current fingerprint, films not yet checked for that file), films in
/// Recently deleted left out.
pub fn due(l: &Library, current: &BTreeMap<String, String>) -> anyhow::Result<Vec<(String, String, Vec<String>)>> {
    let earlier = earlier_films(current, &l.run_fingerprints()?);
    let mut out = Vec::new();
    for (m, fp) in current {
        let done: BTreeSet<String> = l.weights_check_films(m, fp)?.into_iter().map(|f| f.case_id).collect();
        let films: Vec<String> = earlier.iter().filter(|(c, mm)| mm == m && !done.contains(c)).map(|(c, _)| c.clone()).collect();
        if !films.is_empty() { out.push((m.clone(), fp.clone(), films)); }
    }
    Ok(out)
}

/// One model run on one stored film within the extra models' time limit: the command's run, named so a test drives it
/// with a real engine.
pub fn detect_on_film(e: Arc<ceph_infer::engine::Engine>, path: &str, facing_left: bool) -> Result<Detection, String> {
    let p = path.to_string();
    let limit = crate::models::EXTRA_MODEL_LIMIT;
    crate::models::within(limit, move || load_gray(Path::new(&p)).and_then(|img| e.detect(&img, facing_left)).map_err(|err| format!("{err:#}")))
        .map_err(|s| match s {
            crate::models::Skipped::TimedOut(_) => format!("took longer than {} s on this film", limit.as_secs()),
            _ => "stopped without an answer".to_string(),
        })?
}

/// The check's run of one model on one film, on the check's OWN engine (`ModelsState::check_engine`), never the one
/// tracing runs on (final review I-1: tracing always has priority, and never waits behind the check's film).
pub fn check_detect(st: &crate::models::ModelsState, root: &Path, model_id: &str, path: &str, facing_left: bool) -> Result<Detection, String> {
    detect_on_film(st.check_engine(root, model_id)?, path, facing_left)
}

/// How long to wait before asking again whether tracing still holds the model.
pub const WAIT_FOR_TRACING: Duration = Duration::from_millis(250);

fn locked<T>(lib: &Mutex<Option<Library>>, f: impl FnOnce(&mut Library) -> anyhow::Result<T>) -> anyhow::Result<T> {
    let mut g = lib.lock().map_err(|_| anyhow::anyhow!("the library is unavailable after an earlier failure"))?;
    f(g.as_mut().ok_or_else(|| anyhow::anyhow!("the library is not open"))?)
}

/// Every due film of every changed model, one at a time: wait while tracing holds the model, read the film (library
/// held), run the model (library not held), record the film and its points (library held). Returns how many films the
/// model was run on. A film that cannot be read or recorded is logged and skipped.
pub fn run_due(lib: &Mutex<Option<Library>>, current: &BTreeMap<String, String>, detect: &dyn Fn(&str, &str, bool) -> Result<Detection, String>,
    busy: &dyn Fn(&str) -> bool, progress: &dyn Fn(&str, usize, usize)) -> anyhow::Result<usize> {
    let mut ran = 0;
    for (model, fp, films) in locked(lib, |l| due(l, current))? {
        let total = films.len();
        for (i, case_id) in films.iter().enumerate() {
            while busy(&model) { std::thread::sleep(WAIT_FOR_TRACING); }
            match locked(lib, |l| prepare(l, &model, &fp, case_id)) {
                Err(e) => eprintln!("weights check, {model} on {case_id}: skipped, {e:#}"),
                Ok(job) => {
                    let (outcome, detail, points) = match &job {
                        None => ("nothing-to-check", String::new(), vec![]),
                        Some(j) => { ran += 1; finish(j, &model, &fp, detect(&model, &j.path, j.facing_left)) }
                    };
                    if let Err(e) = locked(lib, |l| l.add_weights_check(&CheckFilm { model_id: &model, fingerprint: &fp, case_id, outcome, detail: &detail }, &points)) {
                        eprintln!("weights check, {model} on {case_id}: not recorded, {e:#}");
                    }
                }
            }
            progress(&model, i + 1, total);
        }
    }
    Ok(ran)
}

/// What the Best model table shows for one model whose file changed (owner Q4).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCheck {
    pub model_id: String, pub fingerprint: String, pub version: String,
    /// Films checked (measured, nothing to check, or failed); films in Recently deleted not counted.
    pub films_checked: usize,
    /// Films still to run.
    pub films_due: usize,
    pub films_failed: usize,
    /// Why the first failed film failed.
    pub failed_detail: Option<String>,
    pub points: Vec<CheckPoint>,
    /// Points switched to this model (your accepted choice) that the check finds worse: each offers "Go back to Aariz".
    pub go_back: Vec<String>,
}

/// One model's check from what is stored. `in_force`: the switches in force, point → model.
pub fn model_check(model_id: &str, fingerprint: &str, films: &[WeightsCheckFilm], rows: &[WeightsCheckRow], due: usize, in_force: &BTreeMap<String, String>) -> ModelCheck {
    let live: Vec<&WeightsCheckFilm> = films.iter().filter(|f| !f.deleted).collect();
    let failed: Vec<&&WeightsCheckFilm> = live.iter().filter(|f| f.outcome == "failed").collect();
    let check_rows: Vec<CheckRow> = rows.iter().map(|r| CheckRow { case_id: r.case_id.clone(), landmark_id: r.landmark_id.clone(), old_mm: r.old_mm, new_mm: r.new_mm }).collect();
    let points = summarise(&ORIGINAL_19, &check_rows);
    let go_back = points.iter().filter(|p| matches!(p.verdict, CheckVerdict::Worse { .. }) && in_force.get(&p.landmark_id).map(String::as_str) == Some(model_id))
        .map(|p| p.landmark_id.clone()).collect();
    ModelCheck { model_id: model_id.into(), fingerprint: fingerprint.into(), version: CHECK_VERSION.into(), films_checked: live.len(), films_due: due,
        films_failed: failed.len(), failed_detail: failed.first().map(|f| f.detail.clone()), points, go_back }
}

/// Every installed model that ran with another file on any film not in Recently deleted: its check so far (also while
/// it runs).
pub fn checks(l: &Library, current: &BTreeMap<String, String>, in_force: &BTreeMap<String, String>) -> anyhow::Result<Vec<ModelCheck>> {
    let due_now: BTreeMap<String, usize> = due(l, current)?.into_iter().map(|(m, _, f)| (m, f.len())).collect();
    let earlier = earlier_films(current, &l.run_fingerprints()?);
    let mut out = Vec::new();
    for (m, fp) in current {
        if !earlier.iter().any(|(_, mm)| mm == m) { continue; }
        out.push(model_check(m, fp, &l.weights_check_films(m, fp)?, &l.weights_check_rows(m, fp)?, due_now.get(m).copied().unwrap_or(0), in_force));
    }
    Ok(out)
}

pub const WEIGHTS_CHECK_EVENT: &str = "cephtrace://weights-check";
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Progress { model_id: String, done: usize, total: usize }

/// One weights check at a time.
#[derive(Default)]
pub struct Running(Arc<AtomicBool>);
/// Held while a check runs; letting it go (the run ended, by any path, a panic included) lets the next check start.
pub struct RunningGuard(Arc<AtomicBool>);
impl Drop for RunningGuard { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }
impl Running {
    /// The guard if no check runs now; None if one does.
    pub fn start(&self) -> Option<RunningGuard> {
        (!self.0.swap(true, Ordering::SeqCst)).then(|| RunningGuard(self.0.clone()))
    }
}

/// Owner Q4: check every installed model whose file changed, on its older films, in the background. Returns at once; a
/// call while a check runs does nothing. Called at launch.
#[tauri::command]
pub async fn models_weights_check_run(app: tauri::AppHandle) -> Result<(), String> {
    let Some(guard) = app.state::<Running>().start() else { return Ok(()) };
    let root = crate::models::root(&app)?;
    let (current, lib) = (crate::models::installed_fingerprints(&root), crate::library::shared(&app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<crate::models::ModelsState>();
        let detect = |m: &str, path: &str, facing_left: bool| -> Result<Detection, String> { check_detect(&st, &root, m, path, facing_left) };
        let busy = |m: &str| crate::models::model_busy(&app, m);
        let progress = |m: &str, done: usize, total: usize| { app.emit(WEIGHTS_CHECK_EVENT, Progress { model_id: m.into(), done, total }).ok(); };
        if let Err(e) = run_due(&lib, &current, &detect, &busy, &progress) { eprintln!("weights check stopped: {e:#}"); }
        st.end_check();   // the check's own engines are let go
        drop(guard);   // free before "ended" is announced, so a start on hearing it is not refused
        app.emit(WEIGHTS_CHECK_EVENT, Progress { model_id: String::new(), done: 0, total: 0 }).ok();
    });
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use ceph_infer::engine::{RawPoint, Timings};
    use ceph_store::{AiRun, CaseEdit, LandmarkRow};
    use std::cell::{Cell, RefCell};
    const AZ: &str = "aariz-cepha29";
    const SR: &str = "srpose-cldet23";
    const CW: &str = "cwlachap-hrnet-w32";
    const OLD: &str = "fp-old";
    const NEW: &str = "fp-new";
    fn run(m: &str, sha: &str, pts: &[(&str, f64)]) -> ModelPoints {
        ModelPoints { model_id: m.into(), ran_at: "x".into(), facing: "right".into(), execution_provider: "cpu".into(), model_sha256: Some(sha.into()),
            points: pts.iter().enumerate().map(|(i, (id, x))| AiPoint { channel: i as u32, landmark_id: Some(id.to_string()), x: *x, y: 20.0, peak: 1.0 }).collect() }
    }
    fn lm(id: &str, x: f64, source: &str, verified: bool, ai_x: Option<f64>, placed_by: Option<&str>) -> LandmarkRow {
        LandmarkRow { id: id.into(), x, y: 20.0, source: source.into(), verified, ai_x, ai_y: ai_x.map(|_| 20.0), confidence: None, placed_by: placed_by.map(String::from), accept_kind: None, placed_via: None }
    }
    fn doc(landmarks: Vec<LandmarkRow>, spacing: Option<f64>) -> CaseDoc {
        let mut d: CaseDoc = serde_json::from_value(serde_json::json!({ "id": "c", "patientName": "Demo Synthetic", "timepoint": "T1", "takenOn": null, "facing": "right",   // SYNTHETIC
            "patientKey": "", "identitySource": "manual", "identityChecked": true, "identityIssues": [], "learnedFields": [],
            "orientation": {}, "display": {}, "spacingMm": spacing, "verifiedAt": null, "verifiedBy": null, "createdAt": "x", "updatedAt": "x",
            "image": { "sha256": "s", "ext": "png", "width": 10, "height": 10, "originalName": "SYNTHETIC.png", "path": "/x" }, "landmarks": [] })).unwrap();
        d.landmarks = landmarks;
        d
    }
    /// One film, ruler 0.1 mm per px. Go: Aariz placed it at 100, you moved it to 130 (verified). S: you placed it by
    /// hand at 0. N: Aariz's, not verified. Or: SRPose placed it (a switched point). Ar: cwlachap placed it (traced before
    /// 15 Oct; Q11 leaves it out). Po: verified, but SRPose's earlier file gave no Po. Ba: hand-placed, not one of the
    /// 19. SRPose's earlier file: Go 120, S 20, Or 50, Ar 65, Ba 9.
    fn film(spacing: Option<f64>) -> (CaseDoc, Vec<ModelPoints>) {
        let d = doc(vec![lm("Go", 130.0, "ai-adjusted", true, Some(100.0), Some(AZ)), lm("S", 0.0, "manual", true, None, None),
            lm("N", 40.0, "ai", false, Some(40.0), Some(AZ)), lm("Or", 50.0, "ai", true, Some(50.0), Some(SR)),
            lm("Ar", 60.0, "ai", true, Some(60.0), Some(CW)),
            lm("Po", 70.0, "ai", true, Some(70.0), Some(AZ)), lm("Ba", 5.0, "manual", true, None, None)], spacing);
        let history = vec![run(SR, OLD, &[("Go", 120.0), ("S", 20.0), ("Or", 50.0), ("Ar", 65.0), ("Ba", 9.0)]),
            run(CW, "fp-cw", &[("Ar", 60.0)]),
            run(AZ, "fp-az", &[("Go", 100.0), ("S", 10.0), ("N", 40.0), ("Po", 70.0)])];
        (d, history)
    }
    fn detection(sha: &str, pts: &[(&str, f64)]) -> Detection {
        Detection { model_id: SR.into(), image_width: 200, image_height: 200, execution_provider: "cpu".into(),
            timings_ms: Timings { preprocess: 0.0, inference: 0.0, decode: 0.0, total: 0.0 }, landmarks: vec![],
            raw: pts.iter().enumerate().map(|(i, (id, x))| RawPoint { channel: i as u32, landmark_id: Some(id.to_string()), x: *x, y: 20.0, peak: 1.0, cov: None }).collect(),
            model_sha256: sha.into() }
    }
    fn job(d: CaseDoc, history: Vec<ModelPoints>) -> FilmJob {
        let eligible = eligible(&d, &history, None, SR, NEW);
        FilmJob { path: "/x".into(), facing_left: false, doc: d, history, machine: None, eligible }
    }

    #[test] fn the_points_checked_are_the_19_verified_or_hand_placed_with_a_ruler_placed_by_aariz_or_by_hand_and_marked_by_the_earlier_file() {
        let (d, h) = film(Some(0.1));
        assert_eq!(eligible(&d, &h, None, SR, NEW), [("Go".to_string(), 1.0), ("S".to_string(), 2.0)]);
    }
    #[test] fn without_a_ruler_or_without_an_earlier_file_there_is_nothing_to_check() {
        let (d, h) = film(None);
        assert!(eligible(&d, &h, None, SR, NEW).is_empty(), "F4: films with a ruler only");
        let (d, _) = film(Some(0.1));
        let only_new = vec![run(SR, NEW, &[("Go", 120.0), ("S", 20.0)]), run(AZ, "fp-az", &[("Go", 100.0), ("S", 10.0)])];
        assert!(eligible(&d, &only_new, None, SR, NEW).is_empty(), "the current file only: nothing earlier to compare");
    }
    #[test] fn for_aariz_itself_only_points_placed_by_hand_are_checked() {
        let (d, h) = film(Some(0.1));
        assert_eq!(eligible(&d, &h, None, AZ, "fp-az-new"), [("S".to_string(), 1.0)], "Go: Aariz placed it, so its earlier distance holds a free zero or a selected miss");
    }
    /// The null control and the positive control: the new file's marks are measured exactly as the learning record
    /// measures, against the same point with the same ruler. Given the earlier file's own marks back, it reproduces the
    /// earlier distances exactly; given marks 5 px closer on Go and on S, it reads 0.5 mm and 0 mm.
    #[test] fn the_new_file_is_measured_against_the_same_point_and_ruler() {
        let (d, h) = film(Some(0.1));
        let j = job(d, h);
        let same = finish(&j, SR, NEW, Ok(detection(NEW, &[("Go", 120.0), ("S", 20.0), ("Or", 50.0)])));
        assert_eq!(same, ("measured", String::new(), vec![("Go".to_string(), 1.0, Some(1.0)), ("S".to_string(), 2.0, Some(2.0))]));
        let closer = finish(&j, SR, NEW, Ok(detection(NEW, &[("Go", 125.0), ("S", 0.0)])));
        assert_eq!(closer.2, [("Go".to_string(), 1.0, Some(0.5)), ("S".to_string(), 2.0, Some(0.0))]);
        let no_s = finish(&j, SR, NEW, Ok(detection(NEW, &[("Go", 125.0)])));
        assert_eq!(no_s.2[1], ("S".to_string(), 2.0, None), "the new file gave no S");
    }
    #[test] fn a_failed_run_or_a_different_file_is_recorded_as_failed() {
        let (d, h) = film(Some(0.1));
        let j = job(d, h);
        assert_eq!(finish(&j, SR, NEW, Err("SRPose took longer than 15 s on this film".into())),
            ("failed", "SRPose took longer than 15 s on this film".to_string(), vec![]));
        let other = finish(&j, SR, NEW, Ok(detection("fp-other", &[("Go", 125.0)])));
        assert_eq!((other.0, other.2.len()), ("failed", 0));
        assert!(other.1.starts_with("the model's file changed during the check"), "{}", other.1);
    }

    // ---- through a temp library (synthetic films; never the real library) ----
    /// Film `a`: ruler 0.1 mm per px; Aariz placed Go at 10, you moved it to 13 and verified it; SRPose's earlier file put
    /// Go at 15. Film `b`: the same, without a ruler.
    fn library() -> (tempfile::TempDir, Library, String, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        let import = |l: &mut Library, name: &str, h: u32| { let p = t.path().join(name); image::GrayImage::new(64, h).save(&p).unwrap(); l.import(&p).unwrap().case_id };
        let (a, b) = (import(&mut l, "SYNTHETIC-1.png", 64), import(&mut l, "SYNTHETIC-2.png", 65));
        l.calibrate(&a, (0.0, 0.0), (50.0, 0.0), 5.0, "Dr A").unwrap();
        for id in [&a, &b] {
            for (m, sha, x) in [(AZ, "fp-az", 10.0), (SR, OLD, 15.0)] {
                l.record_ai_run(id, &AiRun { model_id: m.into(), execution_provider: "cpu".into(), facing: "right".into(), total_ms: 1.0, model_sha256: Some(sha.into()) },
                    &[AiPoint { channel: 0, landmark_id: Some("Go".into()), x, y: 20.0, peak: 1.0 }]).unwrap();
            }
            l.save(&CaseEdit { id: id.clone(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}),
                landmarks: vec![lm("Go", 13.0, "ai-adjusted", true, Some(10.0), Some(AZ))] }, "Dr A").unwrap();
        }
        (t, l, a, b)
    }
    fn cur(sr: &str) -> BTreeMap<String, String> { BTreeMap::from([(AZ.to_string(), "fp-az".to_string()), (SR.to_string(), sr.to_string())]) }

    fn checked(case_id: &str, outcome: &str, deleted: bool) -> ceph_store::WeightsCheckFilm {
        ceph_store::WeightsCheckFilm { case_id: case_id.into(), outcome: outcome.into(), ran_at: "x".into(), deleted,
            detail: if outcome == "failed" { "took longer than 15 s on this film".into() } else { String::new() } }
    }
    fn worse(n: usize, lm: &str) -> Vec<ceph_store::WeightsCheckRow> {
        (0..n).map(|i| ceph_store::WeightsCheckRow { case_id: format!("c{i:03}"), landmark_id: lm.into(), old_mm: 1.0, new_mm: Some(1.5) }).collect()
    }
    /// Owner Q4: a worse point switched to the model offers the way back to Aariz; a worse point Aariz places gives the
    /// warning only; nothing switched, or too few films, offers no way back.
    #[test] fn a_worse_point_switched_to_the_model_offers_the_way_back_and_one_aariz_places_does_not() {
        let films: Vec<_> = (0..30).map(|i| checked(&format!("c{i:03}"), "measured", false))
            .chain([checked("x1", "failed", false), checked("x2", "measured", true)]).collect();
        let mut rows = worse(30, "Go");
        rows.extend(worse(30, "S"));
        let in_force = BTreeMap::from([("Go".to_string(), SR.to_string())]);
        let c = model_check(SR, NEW, &films, &rows, 5, &in_force);
        assert_eq!((c.films_checked, c.films_due, c.films_failed, c.failed_detail.as_deref()), (31, 5, 1, Some("took longer than 15 s on this film")));
        assert_eq!((c.go_back.clone(), c.points.len(), c.version.as_str()), (vec!["Go".to_string()], 19, "weights-check/1"));
        assert!(matches!(c.points.iter().find(|p| p.landmark_id == "S").unwrap().verdict, ceph_model::regress::CheckVerdict::Worse { .. }), "S is worse too: warned, not offered");
        assert!(model_check(SR, NEW, &films, &rows, 0, &BTreeMap::new()).go_back.is_empty(), "nothing switched: no way back to offer");
        assert!(model_check(SR, NEW, &films, &worse(29, "Go"), 0, &in_force).go_back.is_empty(), "too few films: no warning, no way back");
    }
    #[test] fn a_model_is_listed_once_its_file_changed_with_its_progress() {
        let (_t, l, _a, _b) = library();
        assert!(checks(&l, &cur(OLD), &BTreeMap::new()).unwrap().is_empty(), "no file changed: no check");
        let c = checks(&l, &cur(NEW), &BTreeMap::new()).unwrap();
        assert_eq!(c.iter().map(|x| (x.model_id.as_str(), x.films_due, x.films_checked)).collect::<Vec<_>>(), [(SR, 2, 0)]);
        let lib = Mutex::new(Some(l));
        run_due(&lib, &cur(NEW), &|_: &str, _: &str, _: bool| -> Result<Detection, String> { Ok(detection(NEW, &[("Go", 14.0)])) },
            &|_: &str| false, &|_: &str, _: usize, _: usize| {}).unwrap();
        let g = lib.lock().unwrap();
        let c = checks(g.as_ref().unwrap(), &cur(NEW), &BTreeMap::new()).unwrap().remove(0);
        let go = c.points.iter().find(|p| p.landmark_id == "Go").unwrap();
        assert_eq!((c.films_due, c.films_checked, go.films, go.verdict), (0, 2, 1, ceph_model::regress::CheckVerdict::TooFew));
    }

    #[test] fn films_are_due_once_per_new_file_again_for_a_later_file_and_never_in_recently_deleted() {
        let (_t, mut l, a, b) = library();
        assert!(due(&l, &cur(OLD)).unwrap().is_empty(), "nothing changed");
        let mut both = vec![a.clone(), b.clone()];
        both.sort();
        assert_eq!(due(&l, &cur(NEW)).unwrap(), vec![(SR.to_string(), NEW.to_string(), both)]);
        l.add_weights_check(&CheckFilm { model_id: SR, fingerprint: NEW, case_id: &a, outcome: "nothing-to-check", detail: "" }, &[]).unwrap();
        assert_eq!(due(&l, &cur(NEW)).unwrap()[0].2, [b.clone()], "a film is checked once for this file");
        assert_eq!(due(&l, &cur("fp-newer")).unwrap()[0].2.len(), 2, "a later file checks both again");
        l.delete(&b).unwrap();
        assert_eq!(due(&l, &cur("fp-newer")).unwrap()[0].2, [a.clone()], "never a film in Recently deleted");
    }
    /// The loop: film `a` is run once and measured (0.2 mm earlier, 0.1 mm new); film `b` (no ruler) is recorded as
    /// nothing to check without running the model; it waits once for tracing; a second pass runs nothing.
    #[test] fn the_loop_runs_each_due_film_once_gives_way_to_tracing_and_records_every_film() {
        let (_t, l, a, _b) = library();
        let lib = Mutex::new(Some(l));
        let (calls, waits, seen) = (Cell::new(0), Cell::new(0), RefCell::new(Vec::<(String, usize, usize)>::new()));
        let detect = |m: &str, _path: &str, facing_left: bool| -> Result<Detection, String> {
            calls.set(calls.get() + 1);
            assert_eq!((m, facing_left), (SR, false));
            Ok(detection(NEW, &[("Go", 14.0)]))
        };
        let busy = |_: &str| -> bool { waits.set(waits.get() + 1); waits.get() == 1 };   // tracing holds the model once, then lets go
        let progress = |m: &str, done: usize, total: usize| seen.borrow_mut().push((m.to_string(), done, total));
        assert_eq!(run_due(&lib, &cur(NEW), &detect, &busy, &progress).unwrap(), 1, "only the film with a ruler is run");
        assert_eq!((calls.get(), waits.get() >= 2), (1, true));
        assert_eq!(seen.borrow().last(), Some(&(SR.to_string(), 2, 2)));
        {
            let g = lib.lock().unwrap();
            let l = g.as_ref().unwrap();
            assert_eq!(l.weights_check_rows(SR, NEW).unwrap().iter().map(|r| (r.case_id.as_str(), r.landmark_id.as_str(), r.old_mm, r.new_mm)).collect::<Vec<_>>(),
                [(a.as_str(), "Go", 0.2, Some(0.1))]);
            let outcomes: std::collections::BTreeSet<String> = l.weights_check_films(SR, NEW).unwrap().into_iter().map(|f| f.outcome).collect();
            assert_eq!(outcomes, ["measured".to_string(), "nothing-to-check".to_string()].into());
        }
        assert_eq!(run_due(&lib, &cur(NEW), &detect, &|_: &str| false, &|_: &str, _: usize, _: usize| {}).unwrap(), 0, "a second pass runs nothing");
        assert_eq!(calls.get(), 1);
    }
    /// The command's own model run (`check_detect`, on the check's own engine) with a real engine (the tiny synthetic test model) on a stored
    /// synthetic film, through the loop: the run reports the installed fingerprint, so the film is measured, not failed.
    #[test] fn a_real_engine_runs_through_the_loop_and_reports_the_installed_fingerprint() {
        use ceph_model::{install::sha256_file, testing::{pinned_weights, tiny_model, tiny_pth}};
        let (tm, tl) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let root = tm.path().join("models");
        let src = tiny_pth(tm.path());
        crate::models::install_local(&root, &tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src)), &src, &|_| {}).unwrap();
        let fp = crate::models::installed_fingerprint(&root, "tiny").unwrap();
        let spec = ceph_infer::spec::ModelSpec::load(&root.join("tiny/manifest.json")).unwrap();
        let point = spec.landmark_map.iter().flatten().next().cloned().unwrap();
        assert!(ORIGINAL_19.contains(&point.as_str()), "precondition: the tiny model's first point ({point}) is one of the 19");
        let st = crate::models::ModelsState::default();
        let mut l = Library::open(tl.path()).unwrap();
        let png = tl.path().join("SYNTHETIC.png");
        image::GrayImage::from_fn(64, 64, |x, y| image::Luma([((x * 3 + y * 5) % 251) as u8])).save(&png).unwrap();
        let id = l.import(&png).unwrap().case_id;
        l.calibrate(&id, (0.0, 0.0), (50.0, 0.0), 5.0, "Dr A").unwrap();
        l.record_ai_run(&id, &AiRun { model_id: "tiny".into(), execution_provider: "cpu".into(), facing: "right".into(), total_ms: 1.0, model_sha256: Some(OLD.into()) },
            &[AiPoint { channel: 0, landmark_id: Some(point.clone()), x: 30.0, y: 20.0, peak: 1.0 }]).unwrap();
        l.save(&CaseEdit { id: id.clone(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}),
            landmarks: vec![lm(&point, 32.0, "manual", true, None, None)] }, "Dr A").unwrap();
        let lib = Mutex::new(Some(l));
        let current = BTreeMap::from([("tiny".to_string(), fp.clone())]);
        let detect = |m: &str, path: &str, facing_left: bool| -> Result<Detection, String> { check_detect(&st, &root, m, path, facing_left) };
        assert_eq!(run_due(&lib, &current, &detect, &|_: &str| false, &|_: &str, _: usize, _: usize| {}).unwrap(), 1);
        let g = lib.lock().unwrap();
        let films = g.as_ref().unwrap().weights_check_films("tiny", &fp).unwrap();
        assert_eq!((films.len(), films[0].outcome.as_str()), (1, "measured"), "{}", films[0].detail);
        let rows = g.as_ref().unwrap().weights_check_rows("tiny", &fp).unwrap();
        assert_eq!((rows.len(), rows[0].landmark_id.as_str(), rows[0].old_mm), (1, point.as_str(), 0.2));
        // The tiny model's guess can be anywhere on a synthetic film; what this test proves is the run itself: it ran on
        // the stored film, reported the installed fingerprint (else "failed: the model's file changed") and was measured.
        assert!(rows[0].new_mm.map_or(true, |d| d.is_finite() && d >= 0.0), "{:?}", rows[0].new_mm);
    }

    // ---- added by the implementer (brief: "no measured number, placed point or stored value of any existing film may
    // change"; "a second call while one runs does nothing") ----
    /// Every row of every table except the weights check's own two, as text, sorted per table.
    fn everything_but_the_check(l: &Library) -> Vec<(String, Vec<String>)> {
        let c = l.conn_for_tests();
        let tables: Vec<String> = c.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT IN ('weights_check', 'weights_check_films') ORDER BY name").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        tables.into_iter().map(|t| {
            let mut st = c.prepare(&format!("SELECT * FROM \"{t}\"")).unwrap();
            let n = st.column_count();
            let mut rows: Vec<String> = st.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get_ref(i).unwrap())).collect::<Vec<_>>().join("|"))).unwrap()
                .collect::<Result<_, _>>().unwrap();
            rows.sort();
            (t, rows)
        }).collect()
    }
    /// The check writes its own two tables and nothing else: every film's points, runs (its ghost marks), learning record,
    /// ruler and every other stored value read the same before and after a full pass that measured one film.
    #[test] fn the_check_changes_nothing_stored_but_its_own_record() {
        let (_t, mut l, a, b) = library();
        for id in [&a, &b] { crate::learning::record_learning(&mut l, id, "Dr A").unwrap(); }
        let before = everything_but_the_check(&l);
        assert!(before.iter().any(|(t, rows)| t == "learning_record" && rows.len() >= 2), "precondition: the learning record holds rows to watch");
        assert!(before.iter().any(|(t, rows)| t == "ai_runs" && rows.len() == 4), "precondition: four stored runs to watch");
        let lib = Mutex::new(Some(l));
        let detect = |_: &str, _: &str, _: bool| -> Result<Detection, String> { Ok(detection(NEW, &[("Go", 14.0)])) };
        assert_eq!(run_due(&lib, &cur(NEW), &detect, &|_: &str| false, &|_: &str, _: usize, _: usize| {}).unwrap(), 1);
        let g = lib.lock().unwrap();
        let l = g.as_ref().unwrap();
        assert_eq!(l.weights_check_rows(SR, NEW).unwrap().len(), 1, "precondition: the pass measured a film");
        assert_eq!(everything_but_the_check(l), before);
    }
    /// One check at a time: a second start while one runs gets nothing; the flag is let go when the run ends, even when
    /// it ends in a panic (else no check would run again until the app restarts).
    #[test] fn one_check_runs_at_a_time_and_ending_it_even_by_a_panic_lets_the_next_start() {
        let r = Running::default();
        let first = r.start().expect("nothing runs yet");
        assert!(r.start().is_none(), "a second call while one runs does nothing");
        drop(first);
        let held = r.start().expect("free again once the first ended");
        let panicked = std::panic::catch_unwind(std::panic::AssertUnwindSafe(move || { let _held = held; panic!("a run that panics") }));
        assert!(panicked.is_err());
        assert!(r.start().is_some(), "free again after a panic");
    }
}
