//! The Model Manager (spec 2026-10-01 Parts 1–2): the built-in catalogue, installs from the authors' links or a file the
//! user downloaded, one engine per Ready model, the main model, and the extra models' detections.

use ceph_infer::engine::{load_gray, Detection, Engine};
use ceph_model::{catalog::{builtin, Licence, Model, Tier}, install::{convert, sha256_file}};
use serde::Serialize;
use std::{collections::HashMap, path::{Path, PathBuf}, sync::{Arc, Mutex}, time::Duration};
use tauri::{Emitter, Manager};

pub const MAIN_KEY: &str = "main_model";
pub const DEFAULT_MAIN: &str = "aariz-cepha29";
/// Shown as "recommended" in Models… whether or not it is installed or chosen (owner O5, 13 Oct).
pub const RECOMMENDED: &str = "aariz-cepha29";
/// The previous default: the first fallback when Aariz is not installed (spec §5.1).
const FALLBACK_MAIN: &str = "cwlachap-hrnet-w32";
pub const DOWNLOAD_BLOCKED: &str = "DOWNLOAD_BLOCKED";
const PROGRESS: &str = "models://progress";
/// A download that receives nothing for this long has stopped (spec Part 4: the partial file is deleted; Retry).
const STALL: std::time::Duration = std::time::Duration::from_secs(60);

#[derive(Default)]
pub struct ModelsState { engines: Mutex<HashMap<String, Arc<Engine>>>, stage: Mutex<HashMap<String, String>>, failed: Mutex<HashMap<String, String>>, busy: InFlight }

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelRow {
    id: String, title: String, tier: Tier, citation: String, size_mb: u32, licence: Licence, licence_accepted: bool,
    status: &'static str, stage: Option<String>, error: Option<String>, main: bool, ms_per_film: Option<f64>, page: String,
    /// Set when a Ready model's installed point map failed to pick up the catalogue's latest names (Task 5): logged,
    /// shown here, and never blocks the model from being used.
    notice: Option<String>,
    /// Owner O5 (13 Oct): Models… marks this model "recommended", installed or not.
    recommended: bool,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct Progress { id: String, stage: String, fraction: Option<f64> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtraResult { model_id: String, title: String, detection: Option<Detection>, error: Option<String>, timed_out: bool }

/// Part D (owner, 7 Oct); 15 s set by the owner (MODEL-LIMIT-1, 12 Oct): an extra model — loading
/// it (first use) and running it on the film, together (ruling P20) — may hold back the first view of a film
/// for at most this long.
pub const EXTRA_MODEL_LIMIT: Duration = Duration::from_secs(15);
/// Why an extra model gave no answer on this film: past the limit, still busy with an earlier film (T12-2), or its run
/// stopped without an answer (it panicked; T12-3).
#[derive(Debug, PartialEq)]
pub enum Skipped { TimedOut(Duration), Busy, Failed }
/// Runs `f` on its own thread and waits at most `limit`. A late run finishes on its own and its answer is dropped
/// (a running model cannot be stopped safely part-way). A run that ends without an answer (it panicked) is `Failed`,
/// known at once — never reported as a time-out (T12-3).
pub fn within<T: Send + 'static>(limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Result<T, Skipped> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || { let _ = tx.send(f()); });
    rx.recv_timeout(limit).map_err(|e| match e {
        std::sync::mpsc::RecvTimeoutError::Timeout => Skipped::TimedOut(limit),
        std::sync::mpsc::RecvTimeoutError::Disconnected => Skipped::Failed,   // the run ended with no answer (T12-3)
    })
}

/// The extra models whose run (on any film) has not ended yet, including a run that passed the limit and is finishing
/// on its own (ruling T12-2).
#[derive(Default, Clone)]
pub struct InFlight(Arc<Mutex<std::collections::HashSet<String>>>);
/// Holds a model as busy until the run that claimed it ends, even when nobody waits for that run any more.
struct Claim(InFlight, String);
impl Drop for Claim { fn drop(&mut self) { self.0 .0.lock().unwrap_or_else(|e| e.into_inner()).remove(&self.1); } }
impl InFlight {
    fn claim(&self, id: &str) -> Option<Claim> {
        self.0.lock().unwrap_or_else(|e| e.into_inner()).insert(id.to_string()).then(|| Claim(self.clone(), id.to_string()))
    }
}
/// One extra model on one film: skipped at once if its run for an earlier film is still going (T12-2: the wait never
/// counts against this film's limit), otherwise `f` under `within`.
pub fn run_extra<T: Send + 'static>(busy: &InFlight, id: &str, limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Result<T, Skipped> {
    let claim = busy.claim(id).ok_or(Skipped::Busy)?;
    within(limit, move || { let _held = claim; f() })
}

pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map(|d| d.join("models")).map_err(|e| e.to_string()) }
pub fn is_ready(root: &Path, id: &str) -> bool { root.join(id).join("manifest.json").is_file() }

/// At startup: work folders an interrupted install left behind are removed (Review Focus 3).
pub fn sweep(root: &Path) {
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        if e.file_name().to_string_lossy().starts_with(".tmp-") { std::fs::remove_dir_all(e.path()).ok(); }
    }
}

/// The setting's model if Ready (a deliberate choice, owner O5), else Aariz, else cwlachap, else the first Ready
/// standard model, else any Ready model.
pub fn main_of(ready: &[(&str, Tier)], setting: Option<&str>) -> Option<String> {
    let has = |id: &str| ready.iter().any(|(r, _)| *r == id);
    setting.filter(|s| has(s)).map(str::to_string)
        .or_else(|| has(DEFAULT_MAIN).then(|| DEFAULT_MAIN.to_string()))
        .or_else(|| has(FALLBACK_MAIN).then(|| FALLBACK_MAIN.to_string()))
        .or_else(|| ready.iter().find(|(_, t)| *t == Tier::Standard).map(|(id, _)| id.to_string()))
        .or_else(|| ready.first().map(|(id, _)| id.to_string()))
}
pub fn main_id(app: &tauri::AppHandle) -> Option<String> {
    let root = root(app).ok()?;
    let models = builtin();
    let ready: Vec<(&str, Tier)> = models.iter().filter(|m| is_ready(&root, &m.entry.id)).map(|m| (m.entry.id.as_str(), m.entry.tier)).collect();
    main_of(&ready, crate::library::setting(app, MAIN_KEY).as_deref())
}

/// A source file → `<root>/<id>`, every check and the warm-up passed. On any failure nothing is left behind.
pub fn install_local(root: &Path, m: &Model, source: &Path, stage: &dyn Fn(&str)) -> Result<f64, String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let work = root.join(format!(".tmp-{}-{}-{nanos}", m.entry.id, std::process::id()));
    let res = (|| -> Result<f64, String> {
        stage("checking");
        if !sha256_file(source).map_err(|e| e.to_string())?.eq_ignore_ascii_case(m.entry.source.sha256()) {
            return Err(ceph_model::install::InstallError::Changed.to_string());
        }
        stage("converting");
        let dir = convert(m, source, &work, false).map_err(|e| e.to_string())?;
        stage("testing");
        let engine = Engine::load(&dir.join("manifest.json")).map_err(|e| format!("{e:#}"))?;
        let t = std::time::Instant::now();
        engine.detect(&image::GrayImage::new(1935, 2400), false).map_err(|e| format!("{e:#}"))?;
        let ms = t.elapsed().as_secs_f64() * 1e3;
        drop(engine);
        std::fs::write(dir.join("timing.json"), serde_json::json!({ "msPerFilm": ms }).to_string()).map_err(|e| e.to_string())?;
        let dest = root.join(&m.entry.id);
        if dest.exists() { std::fs::remove_dir_all(&dest).map_err(|e| e.to_string())?; }
        std::fs::rename(&dir, &dest).map_err(|e| e.to_string())?;       // manifest.json arrives with the folder, last
        Ok(ms)
    })();
    std::fs::remove_dir_all(&work).ok();
    res
}

/// The authors' link → `dest`. A refused or HTML answer (Google Drive's "can't scan" page) is DOWNLOAD_BLOCKED.
fn download(url: &str, dest: &Path, on: &dyn Fn(Option<f64>), stall: std::time::Duration) -> Result<(), String> {
    use std::io::{Read, Write};
    // The blocking client's timeout applies to each read, not the whole download: a large file still arrives, a stall stops.
    let client = reqwest::blocking::Client::builder().user_agent("OpenCephAI").timeout(stall)
        .connect_timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|_| DOWNLOAD_BLOCKED.to_string())?;
    let html = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("text/html"));
    if !resp.status().is_success() || html { return Err(DOWNLOAD_BLOCKED.into()); }
    let total = resp.content_length();
    let mut f = std::fs::File::create(dest).map_err(|e| e.to_string())?;
    let (mut buf, mut got, mut last) = (vec![0u8; 1 << 20], 0u64, -1i64);
    loop {
        let n = resp.read(&mut buf).map_err(|e| format!("The download stopped: {e}"))?;
        if n == 0 { break; }
        f.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        got += n as u64;
        let pct = total.map(|t| (got * 100 / t.max(1)) as i64).unwrap_or(-1);
        if pct != last { last = pct; on(total.map(|t| got as f64 / t as f64)); }
    }
    Ok(())
}

fn model(id: &str) -> Result<Model, String> { builtin().into_iter().find(|m| m.entry.id == id).ok_or_else(|| format!("no model {id}")) }

/// Task 5: pick up the catalogue's latest point names for a Ready model, without ever moving a point. Logged and
/// surfaced as the row's plain-language notice; an upgrade failure never stops the model being used.
fn upgrade_notice(root: &Path, id: &str, manifest: &serde_json::Value) -> Option<String> { refresh_map(root, id, manifest).1 }

/// The one place the installed-map upgrade runs (Task 5; P16): every reader of an installed manifest (the Model
/// Manager's list, the engine, the points table) calls this first, so none depends on another having run. Returns
/// whether the manifest was rewritten, and the row's notice when the upgrade was refused (logged; never blocks use).
fn refresh_map(root: &Path, id: &str, manifest: &serde_json::Value) -> (bool, Option<String>) {
    match ceph_model::upgrade::upgrade_installed(&root.join(id), manifest) {
        Ok(wrote) => (wrote, None),
        Err(err) => {
            eprintln!("model {id}: couldn't upgrade its installed point map: {err:#}");
            (false, Some("Couldn't add new points to this model: reinstall it.".to_string()))
        }
    }
}
fn emit(app: &tauri::AppHandle, id: &str, stage: &str, fraction: Option<f64>) {
    app.state::<ModelsState>().stage.lock().unwrap().insert(id.into(), stage.into());
    app.emit(PROGRESS, Progress { id: id.into(), stage: stage.into(), fraction }).ok();
}

/// A Ready model's engine from `<root>/<id>`. `catalogue` is the model's catalogue manifest, when it has one.
/// The installed map is upgraded to the catalogue's first (P16).
pub fn load_engine(root: &Path, id: &str, catalogue: Option<&serde_json::Value>) -> Result<Engine, String> {
    if let Some(c) = catalogue { refresh_map(root, id, c); }
    Engine::load(&root.join(id).join("manifest.json")).map_err(|e| format!("{e:#}"))
}

pub async fn engine_for(app: &tauri::AppHandle, id: &str) -> Result<Arc<Engine>, String> {
    let (root, cat, id2) = (root(app)?, model(id).ok().map(|m| m.entry.manifest), id.to_string());
    // An engine cached before its installed map was upgraded still has the old map: drop it and load afresh (P16).
    if let Some(c) = &cat { if refresh_map(&root, id, c).0 { app.state::<ModelsState>().engines.lock().unwrap().remove(id); } }
    if let Some(e) = app.state::<ModelsState>().engines.lock().unwrap().get(id).cloned() { return Ok(e); }
    let e = tauri::async_runtime::spawn_blocking(move || load_engine(&root, &id2, cat.as_ref()).map(Arc::new))
        .await.map_err(|e| e.to_string())??;
    app.state::<ModelsState>().engines.lock().unwrap().insert(id.into(), e.clone());
    Ok(e)
}

/// The per-point source table (spec 2026-10-13 §5.2), for `placeFromRuns`.
#[tauri::command] pub async fn models_main_point_source() -> ceph_model::source::MainPointSource { ceph_model::source::main_point_source() }

#[tauri::command]
pub async fn models_list(app: tauri::AppHandle) -> Result<Vec<ModelRow>, String> {
    let root = root(&app)?;
    let main = main_id(&app);
    let st = app.state::<ModelsState>();
    let (stages, failed) = (st.stage.lock().unwrap().clone(), st.failed.lock().unwrap().clone());
    let mut rows = Vec::new();
    for m in builtin() {
        let e = m.entry;
        let recommended = e.id == RECOMMENDED;
        let accepted = crate::library::licence_accepted(&app, &e.id, &e.licence.version).await;
        let ready = is_ready(&root, &e.id);
        let (wrote, notice) = if ready { refresh_map(&root, &e.id, &e.manifest) } else { (false, None) };
        if wrote { st.engines.lock().unwrap().remove(&e.id); }            // a cached engine still has the old map
        let ms = std::fs::read(root.join(&e.id).join("timing.json")).ok()
            .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()).and_then(|v| v["msPerFilm"].as_f64());
        let status = if stages.contains_key(&e.id) { "installing" } else if ready { "ready" } else if failed.contains_key(&e.id) { "failed" } else { "not-installed" };
        rows.push(ModelRow { main: main.as_deref() == Some(e.id.as_str()), stage: stages.get(&e.id).cloned(), error: failed.get(&e.id).cloned(),
            page: e.source.page(), id: e.id, title: e.title, tier: e.tier, citation: e.citation, size_mb: e.size_mb, licence: e.licence,
            licence_accepted: accepted, status, ms_per_film: ms, notice, recommended });
    }
    Ok(rows)
}

#[tauri::command]
pub async fn models_accept_licence(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let v = model(&id)?.entry.licence.version;
    crate::library::accept_licence(&app, &id, &v).await
}

async fn run_install(app: tauri::AppHandle, id: String, file: Option<PathBuf>) -> Result<(), String> {
    let m = model(&id)?;
    if !crate::library::licence_accepted(&app, &id, &m.entry.licence.version).await { return Err("Accept the licence first.".into()); }
    let root = root(&app)?;
    app.state::<ModelsState>().failed.lock().unwrap().remove(&id);
    let a = app.clone();
    let res = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&root).map_err(|e| e.to_string())?;
        let (src, tmp) = match file {
            Some(f) => (f, None),
            None => {
                let dl = root.join(format!(".tmp-download-{}", m.entry.id));
                std::fs::create_dir_all(&dl).map_err(|e| e.to_string())?;
                let p = dl.join("source");
                let r = download(&m.entry.source.url(), &p, &|f| emit(&a, &m.entry.id, "downloading", f), STALL);
                if let Err(e) = r { std::fs::remove_dir_all(&dl).ok(); return Err(e); }
                (p, Some(dl))
            }
        };
        let r = install_local(&root, &m, &src, &|s| emit(&a, &m.entry.id, s, None)).map(|_| ());
        if let Some(t) = tmp { std::fs::remove_dir_all(t).ok(); }
        r
    }).await.map_err(|e| e.to_string())?;
    let st = app.state::<ModelsState>();
    st.stage.lock().unwrap().remove(&id);
    st.engines.lock().unwrap().remove(&id);                 // a reinstall loads afresh
    if let Err(e) = &res { st.failed.lock().unwrap().insert(id.clone(), e.clone()); }
    app.emit(PROGRESS, Progress { id, stage: if res.is_ok() { "ready".into() } else { "failed".into() }, fraction: None }).ok();
    res
}
#[tauri::command] pub async fn models_install(app: tauri::AppHandle, id: String) -> Result<(), String> { run_install(app, id, None).await }
#[tauri::command] pub async fn models_add_file(app: tauri::AppHandle, id: String, path: String) -> Result<(), String> { run_install(app, id, Some(PathBuf::from(path))).await }

#[tauri::command]
pub async fn models_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    model(&id)?;
    app.state::<ModelsState>().engines.lock().unwrap().remove(&id);
    let dir = root(&app)?.join(&id);
    if dir.exists() { std::fs::remove_dir_all(&dir).map_err(|e| e.to_string())?; }
    if crate::library::setting(&app, MAIN_KEY).as_deref() == Some(id.as_str()) { crate::library::set_setting(&app, MAIN_KEY, ""); }
    Ok(())
}
#[tauri::command]
pub async fn models_set_main(app: tauri::AppHandle, id: String) -> Result<(), String> {
    if !is_ready(&root(&app)?, &id) { return Err(format!("{id} is not installed")); }
    crate::library::set_setting(&app, MAIN_KEY, &id);
    Ok(())
}

/// Every Ready model except the main one, on this film with the main model's facing (spec Part 3). One model failing
/// is reported for that model only.
#[tauri::command]
/// `run` (review I-1): the front end's number for this tracing run, echoed in every progress event so a film opened
/// mid-run ignores another run's bars; None (a batch import) shows no bars.
pub async fn detect_extras(app: tauri::AppHandle, path: String, facing_left: bool, run: Option<u64>) -> Result<Vec<ExtraResult>, String> {
    let (root, main) = (root(&app)?, main_id(&app));
    let mut out = Vec::new();
    for m in builtin().into_iter().filter(|m| is_ready(&root, &m.entry.id) && Some(&m.entry.id) != main.as_ref()) {
        let (id, title) = (m.entry.id.clone(), m.entry.title.clone());
        // The load (or the cached engine) and the run on this film share one limit (P20); a model still running for an
        // earlier film is skipped (T12-2). The main model is never limited.
        let (app2, id2, id3, p) = (app.clone(), id.clone(), id.clone(), path.clone());
        let busy = app.state::<ModelsState>().busy.clone();
        let event = |state| ExtraEvent { model_id: id.clone(), title: title.clone(), state, limit_ms: EXTRA_MODEL_LIMIT.as_millis() as u64, run };
        app.emit(EXTRA_EVENT, event("working")).ok();
        let r = tauri::async_runtime::spawn_blocking(move || extra_on_film(&busy, &id3, EXTRA_MODEL_LIMIT,
            move || tauri::async_runtime::block_on(engine_for(&app2, &id2)), p, facing_left)).await.map_err(|e| e.to_string());
        app.emit(EXTRA_EVENT, event(extra_state(&r))).ok();
        out.push(extra_result(id, title, r));
    }
    Ok(out)
}

/// One extra model on one film, the body of `detect_extras` (final review M-6): `load` (the cached engine, or its first
/// load) and the run on the film happen together inside `run_extra`'s one limit (P20), so a slow first load times the
/// model out like a slow run. Pulled out with an injectable loader so a test can hold the load inside the limit.
pub fn extra_on_film(busy: &InFlight, id: &str, limit: Duration, load: impl FnOnce() -> Result<Arc<Engine>, String> + Send + 'static,
    path: String, facing_left: bool) -> Result<Result<Detection, String>, Skipped> {
    run_extra(busy, id, limit, move || {
        let e = load()?;
        load_gray(Path::new(&path)).and_then(|img| e.detect(&img, facing_left)).map_err(|e| format!("{e:#}"))
    })
}

/// Owner, 16 Oct: a loading bar per model while a film opens. Each extra model is announced on this event as "working"
/// (with its time limit) when its run starts, then with how it ended (`extra_state`).
pub const EXTRA_EVENT: &str = "cephtrace://extra-model";
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExtraEvent { model_id: String, title: String, state: &'static str, limit_ms: u64, run: Option<u64> }
/// How one extra model's run on one film ended, for its loading bar: done, gave-up (past the limit), busy (still on an
/// earlier film) or failed.
fn extra_state(r: &Result<Result<Result<Detection, String>, Skipped>, String>) -> &'static str {
    match r {
        Ok(Ok(Ok(_))) => "done",
        Ok(Err(Skipped::TimedOut(_))) => "gave-up",
        Ok(Err(Skipped::Busy)) => "busy",
        _ => "failed",
    }
}

/// One extra model's answer on one film: its points, an error, or — past the limit or still busy — no points and the
/// sentence saying so (`timed_out` covers both: the front end treats them alike).
fn extra_result(model_id: String, title: String, r: Result<Result<Result<Detection, String>, Skipped>, String>) -> ExtraResult {
    match r {
        Ok(Ok(Ok(d))) => ExtraResult { model_id, title, detection: Some(d), error: None, timed_out: false },
        Ok(Err(Skipped::TimedOut(l))) => {
            let error = Some(format!("{title} took longer than {} s on this film; its points were not used.", l.as_secs()));
            ExtraResult { model_id, title, detection: None, error, timed_out: true }
        }
        Ok(Err(Skipped::Busy)) => {
            let error = Some(format!("{title} is still busy with an earlier film; its points are not used on this one."));
            ExtraResult { model_id, title, detection: None, error, timed_out: true }
        }
        Ok(Err(Skipped::Failed)) => {
            let error = Some(format!("{title} couldn't read this film: its run stopped without an answer"));
            ExtraResult { model_id, title, detection: None, error, timed_out: false }
        }
        Ok(Ok(Err(e))) | Err(e) => {
            let error = Some(format!("{title} couldn't read this film: {e}"));
            ExtraResult { model_id, title, detection: None, error, timed_out: false }
        }
    }
}

/// One point a model finds, with its standing against the owner's 2 mm gate (Task 7; rulings R-B1, R-B2).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PointRow { id: String, status: ceph_model::scores::PointStatus }
/// One Ready model and the points it finds (its installed map's named channels).
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ModelPointRow { model_id: String, title: String, main: bool, points: Vec<PointRow> }

/// Every Ready model under `root`, in `catalogue` order with the main model first, and each point its installed map
/// names (`null` channels skipped) with that point's status. A model whose manifest can't be read gives no row.
pub fn point_rows(root: &Path, catalogue: &[(String, String, serde_json::Value)], main: Option<&str>) -> Vec<ModelPointRow> {
    let mut rows: Vec<ModelPointRow> = catalogue.iter().filter_map(|(id, title, manifest)| {
        if !manifest.is_null() && is_ready(root, id) { refresh_map(root, id, manifest); }   // the table agrees with the engine (P16)
        let bytes = std::fs::read(root.join(id).join("manifest.json")).ok()?;
        let v: serde_json::Value = serde_json::from_slice(&bytes).ok()?;
        let points = v["landmarkMap"].as_array()?.iter().filter_map(|c| c.as_str())
            .map(|l| PointRow { id: l.to_string(), status: ceph_model::scores::status(id, l) }).collect();
        Some(ModelPointRow { model_id: id.clone(), title: title.clone(), main: main == Some(id.as_str()), points })
    }).collect();
    rows.sort_by_key(|r| !r.main);                       // stable: the main model first, the rest in catalogue order
    rows
}

/// Who finds which point on this Mac (Task 7): Ready models only, catalogue order, main first.
#[tauri::command]
pub async fn models_points(app: tauri::AppHandle) -> Result<Vec<ModelPointRow>, String> {
    let root = root(&app)?;
    let cat: Vec<(String, String, serde_json::Value)> = builtin().into_iter().map(|m| (m.entry.id, m.entry.title, m.entry.manifest)).collect();
    Ok(point_rows(&root, &cat, main_id(&app).as_deref()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ceph_model::{catalog::Tier, install::sha256_file, testing::{tiny_model, tiny_pth, pinned_weights}};
    use std::time::{Duration, Instant};
    #[test] fn within_returns_a_quick_answer() {
        assert_eq!(within(Duration::from_millis(500), || 7), Ok(7));
    }
    #[test] fn within_gives_up_on_a_slow_run_at_about_the_limit() {
        let t = Instant::now();
        let r = within(Duration::from_millis(100), || { std::thread::sleep(Duration::from_millis(2000)); 7 });
        assert_eq!(r, Err(Skipped::TimedOut(Duration::from_millis(100))));
        assert!(t.elapsed() < Duration::from_millis(1000), "waited {:?}", t.elapsed());
    }
    /// Owner, 16 Oct: a loading bar per model. Each extra model's run is announced as "working" (with its limit), then
    /// with how it ended: done, gave up (past the limit), busy (still on an earlier film) or failed.
    #[test] fn an_extra_models_progress_says_how_its_run_ended() {
        let d = || Detection { model_id: "m".into(), image_width: 1, image_height: 1, execution_provider: "cpu".into(),
            timings_ms: ceph_infer::engine::Timings { preprocess: 0.0, inference: 0.0, decode: 0.0, total: 0.0 }, landmarks: vec![],
            raw: vec![], model_sha256: String::new() };
        assert_eq!(extra_state(&Ok(Ok(Ok(d())))), "done");
        assert_eq!(extra_state(&Ok(Err(Skipped::TimedOut(EXTRA_MODEL_LIMIT)))), "gave-up");
        assert_eq!(extra_state(&Ok(Err(Skipped::Busy))), "busy");
        assert_eq!(extra_state(&Ok(Err(Skipped::Failed))), "failed");
        assert_eq!(extra_state(&Ok(Ok(Err("bad film".into())))), "failed");
        assert_eq!(extra_state(&Err("join failed".into())), "failed");
        // Review I-1: each event names the run it belongs to, so a film opened mid-run never shows another film's bars.
        let j = serde_json::to_value(ExtraEvent { model_id: "gu2".into(), title: "GU2Net".into(), state: "working", limit_ms: 15000, run: Some(7) }).unwrap();
        assert_eq!(j, serde_json::json!({ "modelId": "gu2", "title": "GU2Net", "state": "working", "limitMs": 15000, "run": 7 }));
        let j = serde_json::to_value(ExtraEvent { model_id: "gu2".into(), title: "GU2Net".into(), state: "done", limit_ms: 15000, run: None }).unwrap();
        assert_eq!(j["run"], serde_json::Value::Null);
        assert_eq!(EXTRA_EVENT, "cephtrace://extra-model");
    }
    #[test] fn a_timed_out_extra_model_gives_no_points_and_says_so() {
        let r = extra_result("gu2".into(), "GU2Net".into(), Ok(Err(Skipped::TimedOut(EXTRA_MODEL_LIMIT))));
        assert!(r.detection.is_none() && r.timed_out);
        assert_eq!(r.error.as_deref(), Some("GU2Net took longer than 15 s on this film; its points were not used."));
        let j = serde_json::to_value(&r).unwrap();
        assert_eq!((j["timedOut"].clone(), j["detection"].clone()), (serde_json::json!(true), serde_json::Value::Null));
    }
    #[test] fn an_extra_model_that_errors_is_not_marked_as_timed_out() {
        for r in [Ok(Ok(Err("bad film".to_string()))), Err("join failed".to_string())] {
            let x = extra_result("srp".into(), "SRPose".into(), r);
            assert!(x.detection.is_none() && !x.timed_out, "{:?}", x.error);
            assert!(x.error.as_deref().unwrap().starts_with("SRPose couldn't read this film: "));
        }
    }
    /// P20: a timed-out run keeps going on its own thread with the shared engine. The next film's run of that model waits
    /// for it (the engine's one session sits behind a lock) and gets its own answer: two overlapping runs on one engine
    /// give each film the same points as a run on its own.
    #[test] fn overlapping_runs_on_one_shared_engine_wait_for_each_other_and_keep_their_own_answers() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        install_local(&root, &tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src)), &src, &|_| {}).unwrap();
        let e = Arc::new(Engine::load(&root.join("tiny/manifest.json")).unwrap());
        let film = |v: u8| image::GrayImage::from_fn(64, 64, |x, y| image::Luma([((x * 3 + y * 5) as u8).wrapping_mul(v)]));
        let solo: Vec<_> = [1u8, 7].iter().map(|&v| e.detect(&film(v), false).unwrap().raw).collect();
        for _ in 0..20 {
            let runs: Vec<_> = [1u8, 7].iter().map(|&v| { let e = e.clone(); std::thread::spawn(move || e.detect(&film(v), false).unwrap().raw) }).collect();
            let got: Vec<_> = runs.into_iter().map(|t| t.join().unwrap()).collect();
            assert_eq!(format!("{got:?}"), format!("{solo:?}"));
        }
        assert_ne!(format!("{:?}", solo[0]), format!("{:?}", solo[1]), "the two films must give different answers, or a swap could not show");
    }
    /// T12-2: a sleeping closure stands in for a slow engine (synthetic; no model weights).
    #[test] fn a_model_still_busy_with_an_earlier_film_is_skipped_at_once_and_free_again_when_that_run_ends() {
        // Channels, not sleeps (fix round 1): the earlier film's run ends only when the test says so, so no timing
        // margin can be eaten by a loaded machine.
        let busy = InFlight::default();
        let (open_gate, gate) = std::sync::mpsc::channel::<()>();
        let slow = move || { gate.recv().ok(); 1 };                                   // runs until the gate opens
        assert_eq!(run_extra(&busy, "slow", Duration::from_millis(100), slow), Err(Skipped::TimedOut(Duration::from_millis(100))));
        let t = Instant::now();
        assert_eq!(run_extra(&busy, "slow", Duration::from_millis(5000), || 2), Err(Skipped::Busy));
        assert!(t.elapsed() < Duration::from_millis(1000), "the skip waited {:?}", t.elapsed());   // ≥ 4 s short of the limit
        assert_eq!(run_extra(&busy, "other", Duration::from_millis(5000), || 3), Ok(3));   // another model is not held back
        open_gate.send(()).unwrap();                                                    // the earlier film's run ends
        let deadline = Instant::now() + Duration::from_secs(10);
        let free = loop {                                                               // its claim goes as it returns
            match run_extra(&busy, "slow", Duration::from_millis(5000), || 4) {
                Err(Skipped::Busy) if Instant::now() < deadline => std::thread::yield_now(),
                r => break r,
            }
        };
        assert_eq!(free, Ok(4));                                                        // positive control: free again
    }
    #[test] fn a_slow_first_load_and_the_run_share_one_limit() {
        let load_then_run = || { std::thread::sleep(Duration::from_millis(250)); std::thread::sleep(Duration::from_millis(250)); 1 };
        assert_eq!(run_extra(&InFlight::default(), "m", Duration::from_millis(400), load_then_run),
            Err(Skipped::TimedOut(Duration::from_millis(400))));
        assert_eq!(run_extra(&InFlight::default(), "m", Duration::from_millis(2000), load_then_run), Ok(1));   // control
    }
    /// Final review M-6: the real per-model body of `detect_extras` (`extra_on_film`) — load and run on a film under ONE
    /// limit. A loader that takes longer than the limit (a slow first load) must time the model out; moving the load
    /// outside the limit would make this answer instead. Control: the same tiny model with a quick loader gives points.
    #[test] fn the_real_extra_run_loads_the_model_inside_the_limit() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        install_local(&root, &tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src)), &src, &|_| {}).unwrap();
        let film = d.path().join("SYNTHETIC-film.png");
        image::GrayImage::from_fn(64, 64, |x, y| image::Luma([((x * 3 + y * 5) % 251) as u8])).save(&film).unwrap();
        let manifest = root.join("tiny/manifest.json");
        let (m1, m2) = (manifest.clone(), manifest.clone());
        let slow_load = move || { std::thread::sleep(Duration::from_millis(1500)); Engine::load(&m1).map(Arc::new).map_err(|e| format!("{e:#}")) };
        let t = Instant::now();
        let r = extra_on_film(&InFlight::default(), "tiny", Duration::from_millis(300), slow_load, film.display().to_string(), false);
        assert!(matches!(r, Err(Skipped::TimedOut(_))), "a load past the limit must time the model out, got {:?}", r.as_ref().map(|x| x.is_ok()));
        assert!(t.elapsed() < Duration::from_millis(1200), "waited {:?}: the load was not inside the limit", t.elapsed());
        let quick_load = move || Engine::load(&m2).map(Arc::new).map_err(|e| format!("{e:#}"));
        let ok = extra_on_film(&InFlight::default(), "tiny", Duration::from_secs(30), quick_load, film.display().to_string(), false);
        assert!(matches!(ok, Ok(Ok(_))), "control: the tiny model on the synthetic film gives points");
    }
    #[test] fn a_run_answered_in_time_leaves_its_model_free_for_the_next_film() {
        let busy = InFlight::default();
        assert_eq!(run_extra(&busy, "m", Duration::from_millis(3000), || 1), Ok(1));
        assert_eq!(run_extra(&busy, "m", Duration::from_millis(3000), || 2), Ok(2));
    }
    #[test] fn a_busy_extra_model_gives_no_points_and_says_so() {
        let r = extra_result("gu2".into(), "GU2Net".into(), Ok(Err(Skipped::Busy)));
        assert!(r.detection.is_none() && r.timed_out);
        assert_eq!(r.error.as_deref(), Some("GU2Net is still busy with an earlier film; its points are not used on this one."));
    }
    /// T12-3: a run that stops without an answer (it panicked) is an error, not a time-out, and is known at once.
    #[test] fn a_run_that_panics_is_a_failure_not_a_time_out() {
        let t = Instant::now();
        let r = within(Duration::from_millis(3000), || -> i32 { panic!("SYNTHETIC: a model that fails part-way") });
        assert_eq!(r, Err(Skipped::Failed));
        assert!(t.elapsed() < Duration::from_millis(2000), "waited {:?} for a run that had already stopped", t.elapsed());
    }
    #[test] fn a_failed_extra_model_gives_the_error_sentence_not_the_time_limit_one() {
        let x = extra_result("srp".into(), "SRPose".into(), Ok(Err(Skipped::Failed)));
        assert!(x.detection.is_none() && !x.timed_out);
        assert!(x.error.as_deref().unwrap().starts_with("SRPose couldn't read this film: "), "{:?}", x.error);
    }
    #[test] fn the_extra_model_limit_is_the_owners_15_s() { assert_eq!(EXTRA_MODEL_LIMIT, Duration::from_secs(15)); }
    #[test] fn the_same_slow_run_is_answered_when_the_limit_allows_it() {   // positive control for the test above
        assert_eq!(within(Duration::from_millis(3000), || { std::thread::sleep(Duration::from_millis(200)); 7 }), Ok(7));
    }
    #[test] fn install_local_puts_a_working_model_in_place_and_a_failure_leaves_nothing() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        let m = tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src));
        let ms = install_local(&root, &m, &src, &|_| {}).unwrap();
        assert!(ms >= 0.0 && is_ready(&root, "tiny"));
        let e = Engine::load(&root.join("tiny/manifest.json")).unwrap();      // ONNX Runtime finds weights.bin beside it
        assert_eq!(e.detect(&image::GrayImage::new(64, 64), false).unwrap().raw.len(), 2);
        std::fs::remove_dir_all(root.join("tiny")).unwrap();
        let bad = tiny_model(&sha256_file(&src).unwrap(), &"0".repeat(64));
        assert!(install_local(&root, &bad, &src, &|_| {}).unwrap_err().starts_with("Conversion didn't give the expected result"));
        assert!(!is_ready(&root, "tiny"));
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0, "no work folder left behind");
    }
    #[test] fn install_local_puts_a_ready_onnx_model_in_place_and_it_detects() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = d.path().join("tiny-full.onnx");
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../crates/ceph-model/tests/fixtures/tiny-full.onnx"), &src).unwrap();
        let m = ceph_model::testing::tiny_full_model(&sha256_file(&src).unwrap());
        install_local(&root, &m, &src, &|_| {}).unwrap();
        let e = Engine::load(&root.join("tiny-full/manifest.json")).unwrap();
        assert_eq!(e.detect(&image::GrayImage::new(64, 64), false).unwrap().raw.len(), 2);
    }
    #[test] fn a_ready_onnx_entry_whose_manifest_channel_count_disagrees_with_the_file_installs_nothing() {
        // the file has 2 output channels; the manifest claims 3 landmarks. Engine::load's warmup catches the
        // mismatch, and install_local leaves nothing behind.
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = d.path().join("tiny-full.onnx");
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../crates/ceph-model/tests/fixtures/tiny-full.onnx"), &src).unwrap();
        let mut m = ceph_model::testing::tiny_full_model(&sha256_file(&src).unwrap());
        m.entry.manifest["landmarkMap"] = serde_json::json!(["S", "N", "Extra"]);
        let e = install_local(&root, &m, &src, &|_| {}).unwrap_err();
        assert!(e.contains("does not match"), "{e}");
        assert!(!is_ready(&root, "tiny-full"));
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 0, "no work folder left behind");
    }
    #[test] fn a_stalled_download_stops_instead_of_hanging() {
        use std::io::{Read, Write};
        let server = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("http://{}/weights", server.local_addr().unwrap());
        std::thread::spawn(move || {
            let (mut c, _) = server.accept().unwrap();
            let mut req = [0u8; 1024]; let _ = c.read(&mut req);
            c.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: 1000\r\n\r\n0123456789").unwrap();
            std::thread::sleep(std::time::Duration::from_secs(20));        // then nothing more
        });
        let d = tempfile::tempdir().unwrap();
        let t = std::time::Instant::now();
        let e = download(&url, &d.path().join("source"), &|_| {}, std::time::Duration::from_secs(1)).unwrap_err();
        assert!(t.elapsed() < std::time::Duration::from_secs(10), "it gave up after {:?}", t.elapsed());
        assert!(e.starts_with("The download stopped"), "{e}");
    }
    #[test] fn sweep_removes_only_leftover_work_folders() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join(".tmp-gu2net-isbi19-1/model")).unwrap();
        std::fs::create_dir_all(d.path().join("gu2net-isbi19")).unwrap();
        sweep(d.path());
        assert!(!d.path().join(".tmp-gu2net-isbi19-1").exists() && d.path().join("gu2net-isbi19").exists());
    }
    #[test] fn the_main_model_is_the_setting_then_aariz_then_a_ready_standard_one() {
        let all = [("cwlachap-hrnet-w32", Tier::Standard), ("gu2net-isbi19", Tier::Standard), ("srpose-cldet23", Tier::Optional), ("aariz-cepha29", Tier::Optional)];
        assert_eq!(main_of(&all, None).as_deref(), Some("aariz-cepha29"), "no main model chosen, Aariz installed: Aariz (owner O5)");
        assert_eq!(main_of(&all, Some("")).as_deref(), Some("aariz-cepha29"), "an empty setting is not a choice");
        assert_eq!(main_of(&all, Some("cwlachap-hrnet-w32")).as_deref(), Some("cwlachap-hrnet-w32"), "a chosen main model is kept (O5)");
        let no_aariz = [("cwlachap-hrnet-w32", Tier::Standard), ("gu2net-isbi19", Tier::Standard)];
        assert_eq!(main_of(&no_aariz, None).as_deref(), Some("cwlachap-hrnet-w32"), "Aariz not installed: falls back as today");
        let ready = [("gu2net-isbi19", Tier::Standard), ("srpose-cldet23", Tier::Optional)];
        assert_eq!(main_of(&ready, Some("srpose-cldet23")).as_deref(), Some("srpose-cldet23"));
        assert_eq!(main_of(&ready, Some("cwlachap-hrnet-w32")).as_deref(), Some("gu2net-isbi19"));   // the setting's model was removed
        assert_eq!(main_of(&[("srpose-cldet23", Tier::Optional)], None).as_deref(), Some("srpose-cldet23"));
        assert_eq!(main_of(&[], None), None);
    }
    #[test] fn aariz_is_the_recommended_model_and_the_default() {
        assert_eq!((DEFAULT_MAIN, RECOMMENDED), ("aariz-cepha29", "aariz-cepha29"));
        assert!(builtin().iter().any(|m| m.entry.id == RECOMMENDED), "the recommended model is in the catalogue");
    }
    #[test] fn upgrade_notice_is_none_when_the_installed_map_is_already_current() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("m")).unwrap();
        std::fs::write(d.path().join("m/manifest.json"), serde_json::json!({"id": "m", "version": "v1", "landmarkMap": ["S", "D"]}).to_string()).unwrap();
        assert_eq!(upgrade_notice(d.path(), "m", &serde_json::json!({"id": "m", "version": "v1", "landmarkMap": ["S", "D"]})), None);
    }
    #[test] fn upgrade_notice_fills_in_new_names_silently_and_rewrites_the_manifest() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("m")).unwrap();
        std::fs::write(d.path().join("m/manifest.json"), serde_json::json!({"id": "m", "version": "v1", "landmarkMap": ["S", null]}).to_string()).unwrap();
        assert_eq!(upgrade_notice(d.path(), "m", &serde_json::json!({"id": "m", "version": "v2", "landmarkMap": ["S", "D"]})), None);
        let after: serde_json::Value = serde_json::from_slice(&std::fs::read(d.path().join("m/manifest.json")).unwrap()).unwrap();
        assert_eq!(after["landmarkMap"], serde_json::json!(["S", "D"]));
    }
    /// The notice reaching the row: a model whose installed map can't be upgraded (channel count changed underneath
    /// it) gets the plain-language notice, and the manifest on disk is untouched.
    #[test] fn upgrade_notice_logs_and_surfaces_a_plain_sentence_on_refusal_and_leaves_the_file_alone() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("m")).unwrap();
        let original = serde_json::json!({"id": "m", "version": "v1", "landmarkMap": ["S", "D"]}).to_string();
        std::fs::write(d.path().join("m/manifest.json"), &original).unwrap();
        let notice = upgrade_notice(d.path(), "m", &serde_json::json!({"id": "m", "landmarkMap": ["S", "D", "Extra"]}));
        assert_eq!(notice.as_deref(), Some("Couldn't add new points to this model: reinstall it."));
        assert_eq!(std::fs::read_to_string(d.path().join("m/manifest.json")).unwrap(), original);
    }
    /// Task 7 (owner rulings R-B1, R-B2, R-B4): who finds which point, and whether it passes the 2 mm gate.
    #[test] fn point_rows_list_each_ready_models_mapped_points_with_their_status_main_first() {
        use ceph_model::scores::PointStatus;
        let d = tempfile::tempdir().unwrap();
        let put = |id: &str, map: serde_json::Value| {
            std::fs::create_dir_all(d.path().join(id)).unwrap();
            std::fs::write(d.path().join(id).join("manifest.json"), serde_json::json!({ "id": id, "landmarkMap": map }).to_string()).unwrap();
        };
        put("cwlachap-hrnet-w32", serde_json::json!(["S", "N"]));
        put("srpose-cldet23", serde_json::json!(["S", "U1A", null, "Ba"]));
        // aariz-cepha29 is in the catalogue but not installed: it has no row.
        // Test catalogue entries (no manifest of their own: nothing to upgrade from).
        let cat: Vec<(String, String, serde_json::Value)> = ["cwlachap-hrnet-w32", "gu2net-isbi19", "srpose-cldet23", "aariz-cepha29"]
            .iter().map(|id| (id.to_string(), format!("Title {id}"), serde_json::Value::Null)).collect();
        let rows = point_rows(d.path(), &cat, Some("srpose-cldet23"));
        assert_eq!(rows.iter().map(|r| r.model_id.as_str()).collect::<Vec<_>>(), ["srpose-cldet23", "cwlachap-hrnet-w32"]);
        assert!(rows[0].main && !rows[1].main);
        assert_eq!(rows[0].title, "Title srpose-cldet23");
        let ids: Vec<_> = rows[0].points.iter().map(|p| p.id.as_str()).collect();
        assert_eq!(ids, ["S", "U1A", "Ba"], "the null channel is skipped");
        assert_eq!(rows[0].points[0].status, PointStatus::Original);
        assert!(matches!(rows[0].points[1].status, PointStatus::TooFar { .. }), "SRPose's U1A is over 2 mm on the Aariz test split");
        assert_eq!(rows[0].points[2].status, PointStatus::NotScored);
        // serialised as the front end reads it
        let v = serde_json::to_value(&rows[0]).unwrap();
        assert_eq!(v["modelId"], "srpose-cldet23");
        assert_eq!(v["points"][2], serde_json::json!({ "id": "Ba", "status": { "kind": "notScored" } }));
        // no main (none set): catalogue order unchanged; an unreadable manifest gives no row rather than an error
        std::fs::write(d.path().join("cwlachap-hrnet-w32/manifest.json"), "not json").unwrap();
        let rows = point_rows(d.path(), &cat, None);
        assert_eq!(rows.iter().map(|r| r.model_id.as_str()).collect::<Vec<_>>(), ["srpose-cldet23"]);
        assert!(point_rows(&d.path().join("nothing"), &cat, None).is_empty());
    }
    /// P16 (review Minor 1): the installed-map upgrade must not depend on `models_list` having run. An installed map
    /// with `null` where the catalogue now names a point reports the new id in `point_rows`, and the engine loaded
    /// through `load_engine` finds it, with `models_list` never called.
    #[test] fn point_rows_and_load_engine_pick_up_the_catalogues_new_names_without_models_list() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        let m = tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src));     // catalogue map: ["S", "N"]
        install_local(&root, &m, &src, &|_| {}).unwrap();
        let installed = root.join("tiny/manifest.json");
        let mut v: serde_json::Value = serde_json::from_slice(&std::fs::read(&installed).unwrap()).unwrap();
        v["landmarkMap"] = serde_json::json!(["S", null]);                       // installed before N was named
        std::fs::write(&installed, v.to_string()).unwrap();
        let cat = vec![("tiny".to_string(), "Tiny".to_string(), m.entry.manifest.clone())];
        let rows = point_rows(&root, &cat, Some("tiny"));
        assert_eq!(rows[0].points.iter().map(|p| p.id.as_str()).collect::<Vec<_>>(), ["S", "N"], "the table names N");
        std::fs::write(&installed, v.to_string()).unwrap();                       // back to the old map for the engine
        let e = load_engine(&root, "tiny", Some(&m.entry.manifest)).unwrap();
        let ids: Vec<String> = e.detect(&image::GrayImage::new(64, 64), false).unwrap().landmarks.into_iter().map(|l| l.id).collect();
        assert_eq!(ids, ["S", "N"], "the engine finds N");
        // a catalogue that would move a point is refused: logged, the model still loads with its installed map
        std::fs::write(&installed, v.to_string()).unwrap();
        let bad = serde_json::json!({ "id": "tiny", "landmarkMap": ["N", "S"] });
        let e = load_engine(&root, "tiny", Some(&bad)).unwrap();
        assert_eq!(e.detect(&image::GrayImage::new(64, 64), false).unwrap().landmarks.len(), 1);
    }
    #[test] fn every_builtin_manifest_reads_as_a_model_spec() {
        for m in ceph_model::catalog::builtin() {
            let mut v = m.entry.manifest.clone();
            v["file"] = "model.onnx".into(); v["sha256"] = m.entry.skeleton_sha256.clone().into();
            let s: ceph_infer::spec::ModelSpec = serde_json::from_value(v).unwrap();
            assert_eq!(s.id, m.entry.id);
        }
    }
}
