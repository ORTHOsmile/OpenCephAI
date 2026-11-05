//! The Model Manager (spec 2026-10-01 Parts 1–2): the built-in catalogue, installs from the authors' links or a file the
//! user downloaded, one engine per Ready model, the main model, and the extra models' detections.

use ceph_infer::engine::{load_gray, Detection, Engine};
use ceph_model::{catalog::{builtin, Licence, Model, Tier}, install::{convert, sha256_file}};
use serde::Serialize;
use std::{collections::{BTreeMap, HashMap}, path::{Path, PathBuf}, sync::{atomic::{AtomicBool, AtomicUsize, Ordering}, Arc, Mutex}, time::{Duration, Instant}};
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
pub struct ModelsState { engines: Mutex<HashMap<String, Arc<Engine>>>, stage: Mutex<HashMap<String, String>>, failed: Mutex<HashMap<String, String>>, busy: InFlight,
    check_engines: Mutex<HashMap<String, Arc<Engine>>>, tracing: Arc<AtomicUsize>, check_loading: Arc<AtomicBool> }
/// Held by a run of the extra models on a film (`detect_extras`) for its whole loop.
pub struct Tracing(Arc<AtomicUsize>);
impl Drop for Tracing { fn drop(&mut self) { self.0.fetch_sub(1, Ordering::SeqCst); } }
/// Held while the weights check loads a model.
struct CheckLoading(Arc<AtomicBool>);
impl Drop for CheckLoading { fn drop(&mut self) { self.0.store(false, Ordering::SeqCst); } }
impl ModelsState {
    /// Part F final review I-1 (ruling: tracing always has priority): the engine the weights check runs a
    /// model on. It is the check's own copy, loaded on the check's first film with that model and let go when the check
    /// moves to the next model or ends (`end_check`); it is never the engine tracing runs on (`engine_for`). A run holds
    /// its engine's one session for the whole film, so sharing tracing's engine made a tracing run wait behind the
    /// check's film, inside an extra model's 15 s limit. With its own copy, tracing never waits behind the check's film.
    /// Loading is the one place the two still meet (one load at a time in the app): see `check_engine_loaded_by` and
    /// `wait_for_check_load` for how an extra model's 15 s is kept clear of it, and the one exception (a check load
    /// past 15 s).
    pub fn check_engine(&self, root: &Path, id: &str) -> Result<Arc<Engine>, String> {
        self.check_engine_loaded_by(id, || load_engine(root, id, model(id).ok().map(|m| m.entry.manifest).as_ref()))
    }
    /// `check_engine` with the load passed in (a test holds it part-way). The check keeps one copy at a time: the last
    /// model's copy is let go before the next model loads (re-review S1). The load starts only when no tracing run of
    /// the extra models is under way (re-review, I-1 residual): every load in the app queues on one lock (the ONNX
    /// dirname-race fix, `SESSION_START` in ceph-infer, unchanged), so a check load must not stand in front of tracing's.
    fn check_engine_loaded_by(&self, id: &str, load: impl FnOnce() -> Result<Engine, String>) -> Result<Arc<Engine>, String> {
        if let Some(e) = self.check_engines.lock().unwrap().get(id).cloned() { return Ok(e); }
        self.check_engines.lock().unwrap().clear();
        let e = { let _loading = self.check_load_may_start(); Arc::new(load()?) };
        self.check_engines.lock().unwrap().insert(id.into(), e.clone());
        Ok(e)
    }
    /// Waits until no tracing run of the extra models is under way, then marks a check load as started. The flag is
    /// raised before tracing is read, and tracing raises its count before it reads the flag (`wait_for_check_load`), so
    /// at least one side always sees the other: either the check backs off, or tracing waits for this load to end.
    fn check_load_may_start(&self) -> CheckLoading {
        loop {
            self.check_loading.store(true, Ordering::SeqCst);
            if self.tracing.load(Ordering::SeqCst) == 0 { return CheckLoading(self.check_loading.clone()); }
            self.check_loading.store(false, Ordering::SeqCst);
            std::thread::sleep(crate::weights_check::WAIT_FOR_TRACING);
        }
    }
    /// A run of the extra models on a film has started; it counts as running until the guard is dropped.
    pub fn tracing_starts(&self) -> Tracing { self.tracing.fetch_add(1, Ordering::SeqCst); Tracing(self.tracing.clone()) }
    /// Before an extra model's clock starts: wait, not counted against its limit, for a model load the check already
    /// has under way (the check starts no new one while tracing runs). The wait is capped at `cap` (tracing passes the
    /// same 15 s, `EXTRA_MODEL_LIMIT`), so a load that never ends cannot hold a film back for ever; past the cap the
    /// clock starts as it did before this fix.
    pub fn wait_for_check_load(&self, cap: Duration) {
        let until = Instant::now() + cap;
        while self.check_loading.load(Ordering::SeqCst) && Instant::now() < until { std::thread::sleep(Duration::from_millis(10)); }
    }
    /// The check has ended: its own engines are let go (their memory freed).
    pub fn end_check(&self) { self.check_engines.lock().unwrap().clear(); }
    /// Remove's first step, one locked step: refuses while an install of this model runs or while a tracing run or the
    /// weights check holds its engine (an open file would block the delete on Windows); otherwise lets both engines go.
    fn release_for_remove(&self, id: &str) -> Result<(), String> {
        let stage = self.stage.lock().unwrap();                    // held throughout: no install can start in between
        if stage.contains_key(id) { return Err(format!("{} is being installed right now. Wait for that to finish, then press Remove again.", short_title(id))); }
        self.let_engines_go(id, "Remove")
    }
    /// A reinstall's first step (final review M1): the install already holds this model's place, so only the engines are
    /// looked at, in the reinstall's own words. Refuses while a tracing run or the weights check holds one.
    fn release_for_reinstall(&self, id: &str) -> Result<(), String> { self.let_engines_go(id, "Retry") }
    fn let_engines_go(&self, id: &str, again: &str) -> Result<(), String> {
        let (mut engines, mut check) = (self.engines.lock().unwrap(), self.check_engines.lock().unwrap());
        let held = |m: &HashMap<String, Arc<Engine>>| m.get(id).is_some_and(|e| Arc::strong_count(e) > 1);
        if held(&engines) || held(&check) { return Err(format!("{} is in use right now (a tracing or the weights check). Wait for it to finish, then press {again} again.", short_title(id))); }
        engines.remove(id); check.remove(id);
        Ok(())
    }
    /// A model reinstalled or removed: neither tracing nor the check keeps its old engine.
    fn forget_engine(&self, id: &str) {
        self.engines.lock().unwrap().remove(id);
        self.check_engines.lock().unwrap().remove(id);
    }
}

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
    /// Whether a run holds this model now (Part F: the weights check waits rather than make tracing skip a model).
    pub fn is_busy(&self, id: &str) -> bool { self.0.lock().unwrap_or_else(|e| e.into_inner()).contains(id) }
}
/// One extra model on one film: skipped at once if its run for an earlier film is still going (T12-2: the wait never
/// counts against this film's limit), otherwise `f` under `within`.
pub fn run_extra<T: Send + 'static>(busy: &InFlight, id: &str, limit: Duration, f: impl FnOnce() -> T + Send + 'static) -> Result<T, Skipped> {
    let claim = busy.claim(id).ok_or(Skipped::Busy)?;
    within(limit, move || { let _held = claim; f() })
}

pub fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map(|d| d.join("models")).map_err(|e| e.to_string()) }
/// Whether tracing is running this model right now.
pub fn model_busy(app: &tauri::AppHandle, id: &str) -> bool { app.state::<ModelsState>().busy.is_busy(id) }
pub fn is_ready(root: &Path, id: &str) -> bool { root.join(id).join("manifest.json").is_file() }

/// Part F (owner Q9): a Ready model's file fingerprint now, read from its installed manifest (the value every run of it
/// stores). None if it is not installed or its manifest cannot be read (logged: its marks then count for nothing).
pub fn installed_fingerprint(root: &Path, id: &str) -> Option<String> {
    if !is_ready(root, id) { return None; }
    match ceph_infer::spec::ModelSpec::load(&root.join(id).join("manifest.json")) {
        Ok(s) => Some(s.fingerprint()),
        Err(e) => { eprintln!("model {id}: its manifest could not be read, so none of its marks count: {e:#}"); None }
    }
}
/// Every Ready catalogue model's fingerprint, model id → fingerprint.
pub fn installed_fingerprints(root: &Path) -> BTreeMap<String, String> {
    builtin().into_iter().filter_map(|m| installed_fingerprint(root, &m.entry.id).map(|f| (m.entry.id, f))).collect()
}


/// Said when a write fails because the disk is full (a download, a copy, a rename into place).
pub(crate) const DISK_FULL: &str = "There isn't enough free disk space to install this model. Free some space, then press Retry.";
/// An IO error in plain words: a full disk (`StorageFull`, or the OS's own full-disk code on this platform) says so;
/// any other error keeps its own words.
fn friendly_io(e: &std::io::Error) -> String {
    // Raw codes mean different things per OS (28 is ENOSPC on Unix but ERROR_OUT_OF_PAPER on Windows; 112 is
    // ERROR_DISK_FULL on Windows but EHOSTDOWN on Linux), so each is trusted only on its own platform.
    #[cfg(unix)] let raw_full = e.raw_os_error() == Some(28);
    #[cfg(windows)] let raw_full = e.raw_os_error() == Some(112);
    #[cfg(not(any(unix, windows)))] let raw_full = false;
    if e.kind() == std::io::ErrorKind::StorageFull || raw_full { DISK_FULL.into() } else { e.to_string() }
}
/// The download loop: `r` → `w` in 1 MiB steps, `on` told the fraction when the whole percent changes. A write that
/// fails says so in plain words (`friendly_io`); a read that fails is "The download stopped".
fn copy_body(r: &mut impl std::io::Read, w: &mut impl std::io::Write, total: Option<u64>, on: &dyn Fn(Option<f64>)) -> Result<(), String> {
    let (mut buf, mut got, mut last) = (vec![0u8; 1 << 20], 0u64, -1i64);
    loop {
        let n = r.read(&mut buf).map_err(|e| format!("The download stopped: {e}"))?;
        if n == 0 { break; }
        w.write_all(&buf[..n]).map_err(|e| friendly_io(&e))?;
        got += n as u64;
        let pct = total.map(|t| (got * 100 / t.max(1)) as i64).unwrap_or(-1);
        if pct != last { last = pct; on(total.map(|t| got as f64 / t as f64)); }
    }
    Ok(())
}
/// `copy_body` into a new file at `dest`; on any failure the partial file is removed. `wrap` lets a test put a failing
/// writer in front of the file.
fn write_download(r: &mut impl std::io::Read, dest: &Path, total: Option<u64>, on: &dyn Fn(Option<f64>),
                  wrap: &dyn Fn(std::fs::File) -> Box<dyn std::io::Write>) -> Result<(), String> {
    let f = std::fs::File::create(dest).map_err(|e| friendly_io(&e))?;
    let mut w = wrap(f);
    let res = copy_body(r, &mut w, total, on).and_then(|_| w.flush().map_err(|e| friendly_io(&e)));
    drop(w);
    if res.is_err() { std::fs::remove_file(dest).ok(); }
    res
}

/// One install per model at a time: the model's place in `stage` is taken ("starting") under the lock, or the call is
/// refused. The place is freed by dropping the `InstallSlot` that `claim_install` returns, on every way out.
fn begin_install(st: &ModelsState, id: &str) -> Result<(), String> {
    let mut stage = st.stage.lock().unwrap();
    if stage.contains_key(id) { return Err(format!("{} is already being installed.", short_title(id))); }
    stage.insert(id.into(), "starting".into());
    Ok(())
}
struct InstallSlot<'a>(&'a ModelsState, String);
impl Drop for InstallSlot<'_> { fn drop(&mut self) { self.0.stage.lock().unwrap().remove(&self.1); } }
fn claim_install<'a>(st: &'a ModelsState, id: &str) -> Result<InstallSlot<'a>, String> { begin_install(st, id)?; Ok(InstallSlot(st, id.into())) }

/// After a Remove, whether the model is gone from use: not Ready, whether or not the delete has finished.
fn main_must_be_cleared(root: &Path, id: &str) -> bool { !is_ready(root, id) }

/// Deletes `<root>/<id>` safely: the folder is first renamed to `<root>/.tmp-removing-<id>-<pid>-<nanos>` (one quick
/// step in the same folder, so the model stops being Ready at once), then the renamed folder is deleted. If the delete
/// fails (a file still open on Windows), the `.tmp-` folder stays and `sweep` finishes it at the next start. Not
/// installed: Ok, nothing touched.
pub fn remove_model_dir(root: &Path, id: &str) -> Result<(), String> {
    let dir = root.join(id);
    if !dir.exists() { return Ok(()); }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let aside = root.join(format!(".tmp-removing-{id}-{}-{nanos}", std::process::id()));
    std::fs::rename(&dir, &aside).map_err(|e| if friendly_io(&e) == DISK_FULL { DISK_FULL.into() } else {
        format!("{} couldn't be removed: a file in it is still in use. Close anything using it, then press Remove again.", short_title(id)) })?;
    std::fs::remove_dir_all(&aside).map_err(|_| format!(
        "{} is no longer installed, but some of its files couldn't be deleted yet. They will be cleared the next time the app starts.", short_title(id)))
}

/// A reinstall's step (final review M1): the old `<root>/<id>` moves aside as in `remove_model_dir`, but the words are
/// the install's. A full disk says so as an install; a file still in use says to close it and press Retry; a delete of the
/// moved-aside folder that cannot finish does not stop the reinstall (the next start's `sweep` clears it).
fn replace_model_dir(root: &Path, id: &str) -> Result<(), String> {
    let dir = root.join(id);
    if !dir.exists() { return Ok(()); }
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let aside = root.join(format!(".tmp-removing-{id}-{}-{nanos}", std::process::id()));
    std::fs::rename(&dir, &aside).map_err(|e| if friendly_io(&e) == DISK_FULL { DISK_FULL.into() } else {
        format!("{} couldn't be installed again: the old copy has a file that is still in use. Close anything using it, then press Retry.", short_title(id)) })?;
    std::fs::remove_dir_all(&aside).ok();
    Ok(())
}

/// At startup: work folders an interrupted install left behind are removed (Review Focus 3).
pub fn sweep(root: &Path) {
    for e in std::fs::read_dir(root).into_iter().flatten().flatten() {
        if e.file_name().to_string_lossy().starts_with(".tmp-") { std::fs::remove_dir_all(e.path()).ok(); }
    }
}

/// The model that runs first. Automatic best (the setting blank or `auto-best`) runs the base first when it is Ready
/// (spec 2026-10-29 §4: the base runs first, decides the facing and fills any gap); otherwise the setting's model if
/// Ready (a deliberate choice, owner O5), else Aariz, else cwlachap, else the first Ready standard model, else any.
pub fn main_of(ready: &[(&str, Tier)], setting: Option<&str>, base: &str) -> Option<String> {
    let has = |id: &str| ready.iter().any(|(r, _)| *r == id);
    let auto = setting.map_or(true, |s| s.trim().is_empty() || s == ceph_store::AUTO_BEST);
    (auto && has(base)).then(|| base.to_string())
        .or_else(|| setting.filter(|s| has(s)).map(str::to_string))
        .or_else(|| has(DEFAULT_MAIN).then(|| DEFAULT_MAIN.to_string()))
        .or_else(|| has(FALLBACK_MAIN).then(|| FALLBACK_MAIN.to_string()))
        .or_else(|| ready.iter().find(|(_, t)| *t == Tier::Standard).map(|(id, _)| id.to_string()))
        .or_else(|| ready.first().map(|(id, _)| id.to_string()))
}
pub fn main_id(app: &tauri::AppHandle) -> Option<String> {
    let root = root(app).ok()?;
    let models = builtin();
    let ready: Vec<(&str, Tier)> = models.iter().filter(|m| is_ready(&root, &m.entry.id)).map(|m| (m.entry.id.as_str(), m.entry.tier)).collect();
    let base = crate::auto_best::base_from(crate::library::setting(app, crate::auto_best::BASE_KEY).as_deref());
    main_of(&ready, crate::library::setting(app, MAIN_KEY).as_deref(), &base)
}

/// The short name the owner knows a model by (as the screen's `SHORT_NAMES`); else its Models… title; else its id.
pub fn short_title(id: &str) -> String {
    match id {
        "aariz-cepha29" => "Aariz".into(), "srpose-cldet23" => "SRPose".into(), "gu2net-isbi19" => "GU2Net".into(), "cwlachap-hrnet-w32" => "cwlachap".into(),
        _ => builtin().into_iter().find(|m| m.entry.id == id).map_or_else(|| id.to_string(), |m| m.entry.title),
    }
}

/// Spec §2: Automatic best may start the tracing only when its base is installed (the base runs first); a real model only
/// when it is installed.
pub fn can_set_main(id: &str, ready: impl Fn(&str) -> bool, base: &str) -> Result<(), String> {
    if id == ceph_store::AUTO_BEST {
        return if ready(base) { Ok(()) } else { Err(format!("Automatic best needs {}: install it, or choose another base.", short_title(base))) };
    }
    if ready(id) { Ok(()) } else { Err(format!("{id} is not installed")) }
}
/// Models…'s "Starts the tracing" for a real model: never while Automatic best is on (Aariz still runs first, spec §2).
pub fn shown_main(main: Option<&str>, id: &str, auto_on: bool) -> bool { !auto_on && main == Some(id) }

/// A source file → `<root>/<id>`, every check and the warm-up passed. On any failure nothing is left behind.
pub fn install_local(root: &Path, m: &Model, source: &Path, stage: &dyn Fn(&str)) -> Result<f64, String> {
    std::fs::create_dir_all(root).map_err(|e| friendly_io(&e))?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0);
    let work = root.join(format!(".tmp-{}-{}-{nanos}", m.entry.id, std::process::id()));
    let res = (|| -> Result<f64, String> {
        stage("checking");
        if !sha256_file(source).map_err(|e| e.to_string())?.eq_ignore_ascii_case(m.entry.source.sha256()) {
            return Err(ceph_model::install::InstallError::Changed.to_string());
        }
        stage("converting");
        let dir = convert(m, source, &work, false).map_err(|e| match &e { ceph_model::install::InstallError::Io(io) => friendly_io(io), _ => e.to_string() })?;
        stage("testing");
        let engine = Engine::load(&dir.join("manifest.json")).map_err(|e| format!("{e:#}"))?;
        let t = std::time::Instant::now();
        engine.detect(&image::GrayImage::new(1935, 2400), false).map_err(|e| format!("{e:#}"))?;
        let ms = t.elapsed().as_secs_f64() * 1e3;
        drop(engine);
        std::fs::write(dir.join("timing.json"), serde_json::json!({ "msPerFilm": ms }).to_string()).map_err(|e| friendly_io(&e))?;
        let dest = root.join(&m.entry.id);
        replace_model_dir(root, &m.entry.id)?;                          // a reinstall: the old folder moves aside, then is deleted
        std::fs::rename(&dir, &dest).map_err(|e| friendly_io(&e))?;       // manifest.json arrives with the folder, last
        Ok(ms)
    })();
    std::fs::remove_dir_all(&work).ok();
    res
}

/// The authors' link → `dest`. A refused or HTML answer (Google Drive's "can't scan" page) is DOWNLOAD_BLOCKED.
fn download(url: &str, dest: &Path, on: &dyn Fn(Option<f64>), stall: std::time::Duration) -> Result<(), String> {
    // The blocking client's timeout applies to each read, not the whole download: a large file still arrives, a stall stops.
    let client = reqwest::blocking::Client::builder().user_agent("OpenCephAI").timeout(stall)
        .connect_timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|_| DOWNLOAD_BLOCKED.to_string())?;
    let html = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("text/html"));
    if !resp.status().is_success() || html { return Err(DOWNLOAD_BLOCKED.into()); }
    let total = resp.content_length();
    write_download(&mut resp, dest, total, on, &|f| Box::new(f))
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

/// The point-source table, Part F's switches, and Automatic best's map (spec §3): placement and the label read all three.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointSource { #[serde(flatten)] pub base: ceph_model::source::MainPointSource, pub auto_best: Option<crate::auto_best::AutoBestMap>,
    /// Owner ruling M4 (2 Nov 2026): Automatic best is the owner's choice but its choices could not be read, so the plain
    /// base places every point (no Part F switch, no built-in switch) and the screen says so.
    pub auto_best_unreadable: bool }
/// Automatic best's map, or none when it could not be read (logged): then the main model places every point and no
/// label says "Automatic best" (spec §11).
pub(crate) fn with_auto_best(read: Result<crate::auto_best::AutoBestMap, String>) -> Option<crate::auto_best::AutoBestMap> {
    read.map_err(|e| eprintln!("Automatic best: its choices could not be read; the main model places every point: {e}")).ok()
}
/// The per-point source table (spec 2026-10-13 §5.2) plus the owner's Part F switches and their notes, for
/// `placeFromRuns` and the label's hover, and Automatic best's map. If the switches cannot be read, the built-in table
/// places every point (logged), as before Part F.
#[tauri::command] pub async fn models_main_point_source(app: tauri::AppHandle) -> PointSource {
    let read = crate::library::with(&app, |l, _| crate::best::owner_choices(l)).await;
    let auto = match root(&app) {
        Ok(r) => {
            let cur = installed_fingerprints(&r);
            crate::library::with(&app, move |l, _| crate::auto_best::map_now(l, &r, &cur)).await
        }
        Err(e) => Err(e),
    };
    // A main setting that cannot be read counts as blank (the default, Automatic best).
    point_source_from(read, auto, crate::library::setting(&app, MAIN_KEY).as_deref())
}
/// The pure core of `models_main_point_source`. Owner ruling M4: when Automatic best is the main setting (blank or
/// `auto-best`) and its map could not be read, the plain base places every point, so the switches are dropped and
/// `auto_best_unreadable` is set. A fixed main model keeps its Part F switches and sets no flag.
pub(crate) fn point_source_from(
    read_choices: Result<(BTreeMap<String, String>, BTreeMap<String, ceph_model::source::ChoiceNote>), String>,
    read_map: Result<crate::auto_best::AutoBestMap, String>, main_setting: Option<&str>) -> PointSource {
    let auto_is_main = main_setting.map_or(true, |s| s.trim().is_empty() || s == ceph_store::AUTO_BEST);
    let auto_best = with_auto_best(read_map);
    let auto_best_unreadable = auto_best.is_none() && auto_is_main;
    let base = if auto_best_unreadable { ceph_model::source::main_point_source() } else { with_owner_choices(ceph_model::source::main_point_source(), read_choices) };
    PointSource { base, auto_best, auto_best_unreadable }
}
/// The table `s` with the switches read from the library; when they could not be read, `s` unchanged (logged).
pub(crate) fn with_owner_choices(mut s: ceph_model::source::MainPointSource,
    read: Result<(BTreeMap<String, String>, BTreeMap<String, ceph_model::source::ChoiceNote>), String>) -> ceph_model::source::MainPointSource {
    match read {
        Ok((c, n)) => { s.owner_choices = c; s.owner_choice_notes = n; }
        Err(e) => eprintln!("Part F: your point choices could not be read; the built-in table places every point: {e}"),
    }
    s
}

#[tauri::command]
pub async fn models_list(app: tauri::AppHandle) -> Result<Vec<ModelRow>, String> {
    let root = root(&app)?;
    let main = main_id(&app);
    // The same check as the screen's map (leftovers Task 3, M2): off until the first-open step has run on a library with films.
    let r = root.clone();
    let auto_on = crate::library::with(&app, move |l, _| crate::auto_best::on_at(l, &r)).await.unwrap_or_else(|e| {
        eprintln!("Models…: whether Automatic best is on could not be read; shown as off: {e}");
        false
    });
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
        rows.push(ModelRow { main: shown_main(main.as_deref(), &e.id, auto_on), stage: stages.get(&e.id).cloned(), error: failed.get(&e.id).cloned(),
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
    // One install per model at a time: a second press while one runs is refused here, and does not touch the first's row.
    let st = app.state::<ModelsState>();
    let slot = claim_install(&st, &id)?;
    if !crate::library::licence_accepted(&app, &id, &m.entry.licence.version).await { return Err("Accept the licence first.".into()); }
    let root = root(&app)?;
    st.failed.lock().unwrap().remove(&id);
    let a = app.clone();
    let released = st.release_for_reinstall(&id);           // a tracing run or the check holding the old copy open would block the replace
    let res = if let Err(e) = released { Err(e) } else { tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&root).map_err(|e| friendly_io(&e))?;
        let (src, tmp) = match file {
            Some(f) => (f, None),
            None => {
                let dl = root.join(format!(".tmp-download-{}", m.entry.id));
                std::fs::create_dir_all(&dl).map_err(|e| friendly_io(&e))?;
                let p = dl.join("source");
                let r = download(&m.entry.source.url(), &p, &|f| emit(&a, &m.entry.id, "downloading", f), STALL);
                if let Err(e) = r { std::fs::remove_dir_all(&dl).ok(); return Err(e); }
                (p, Some(dl))
            }
        };
        let r = install_local(&root, &m, &src, &|s| emit(&a, &m.entry.id, s, None)).map(|_| ());
        if let Some(t) = tmp { std::fs::remove_dir_all(t).ok(); }
        r
    }).await.map_err(|e| e.to_string())? };
    st.forget_engine(&id);                                  // a reinstall loads afresh (tracing's engine and the check's)
    if let Err(e) = &res { st.failed.lock().unwrap().insert(id.clone(), e.clone()); }
    drop(slot);                                             // free the model's place before the event, so a Retry on "failed" is allowed
    app.emit(PROGRESS, Progress { id, stage: if res.is_ok() { "ready".into() } else { "failed".into() }, fraction: None }).ok();
    res
}
#[tauri::command] pub async fn models_install(app: tauri::AppHandle, id: String) -> Result<(), String> { run_install(app, id, None).await }
#[tauri::command] pub async fn models_add_file(app: tauri::AppHandle, id: String, path: String) -> Result<(), String> { run_install(app, id, Some(PathBuf::from(path))).await }

#[tauri::command]
pub async fn models_remove(app: tauri::AppHandle, id: String) -> Result<(), String> {
    model(&id)?;
    let st = app.state::<ModelsState>();
    // Never delete a folder something may have open (Windows keeps open files from being deleted).
    st.release_for_remove(&id)?;
    let root = root(&app)?;
    let res = remove_model_dir(&root, &id);
    // Once the model is out of use (even if the delete is still pending), it can no longer be the main model.
    if main_must_be_cleared(&root, &id) && crate::library::setting(&app, MAIN_KEY).as_deref() == Some(id.as_str()) { crate::library::set_setting(&app, MAIN_KEY, ""); }
    res?;
    Ok(())
}
#[tauri::command]
pub async fn models_set_main(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let root = root(&app)?;
    let base = crate::auto_best::base_from(crate::library::setting(&app, crate::auto_best::BASE_KEY).as_deref());
    can_set_main(&id, |m| is_ready(&root, m), &base)?;
    crate::library::with(&app, move |l, _| l.set_setting(MAIN_KEY, &id)).await
}

/// Every Ready model except the main one, on this film with the main model's facing (spec Part 3). One model failing
/// is reported for that model only.
#[tauri::command]
/// `run` (review I-1): the front end's number for this tracing run, echoed in every progress event so a film opened
/// mid-run ignores another run's bars; None (a batch import) shows no bars.
pub async fn detect_extras(app: tauri::AppHandle, path: String, facing_left: bool, run: Option<u64>) -> Result<Vec<ExtraResult>, String> {
    let (root, main) = (root(&app)?, main_id(&app));
    let _tracing = app.state::<ModelsState>().tracing_starts();   // the weights check starts no model load until this ends
    let mut out = Vec::new();
    for m in builtin().into_iter().filter(|m| is_ready(&root, &m.entry.id) && Some(&m.entry.id) != main.as_ref()) {
        let (id, title) = (m.entry.id.clone(), m.entry.title.clone());
        // The load (or the cached engine) and the run on this film share one limit (P20); a model still running for an
        // earlier film is skipped (T12-2). The main model is never limited.
        let (app2, app3, id2, id3, p) = (app.clone(), app.clone(), id.clone(), id.clone(), path.clone());
        let event = |state| ExtraEvent { model_id: id.clone(), title: title.clone(), state, limit_ms: EXTRA_MODEL_LIMIT.as_millis() as u64, run };
        app.emit(EXTRA_EVENT, event("working")).ok();
        let r = tauri::async_runtime::spawn_blocking(move || extra_for_tracing(&app3.state::<ModelsState>(), &id3, EXTRA_MODEL_LIMIT,
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

/// One extra model on one film for tracing: first a wait, not counted, for a model load the weights check has under way;
/// then `extra_on_film`, whose clock starts only after that wait.
pub fn extra_for_tracing(st: &ModelsState, id: &str, limit: Duration, load: impl FnOnce() -> Result<Arc<Engine>, String> + Send + 'static,
    path: String, facing_left: bool) -> Result<Result<Detection, String>, Skipped> {
    st.wait_for_check_load(EXTRA_MODEL_LIMIT);
    extra_on_film(&st.busy, id, limit, load, path, facing_left)
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
    #[test] fn automatic_best_runs_the_base_first() {
        let ready = [("aariz-cepha29", Tier::Standard), ("gu2net-isbi19", Tier::Optional)];
        assert_eq!(main_of(&ready, Some("auto-best"), "gu2net-isbi19").as_deref(), Some("gu2net-isbi19"));
        assert_eq!(main_of(&ready, None, "gu2net-isbi19").as_deref(), Some("gu2net-isbi19"), "blank means Automatic best");
        assert_eq!(main_of(&ready, Some("  "), "gu2net-isbi19").as_deref(), Some("gu2net-isbi19"), "blank means Automatic best");
        assert_eq!(main_of(&ready, Some("auto-best"), "aariz-cepha29").as_deref(), Some("aariz-cepha29"));
        assert_eq!(main_of(&ready, Some("aariz-cepha29"), "gu2net-isbi19").as_deref(), Some("aariz-cepha29"), "a fixed main model is kept");
        assert_eq!(main_of(&[("aariz-cepha29", Tier::Standard)], Some("auto-best"), "gu2net-isbi19").as_deref(), Some("aariz-cepha29"),
            "base not installed: the usual fallback runs (Automatic best is greyed out)");
        assert_eq!(main_of(&[("cwlachap-hrnet-w32", Tier::Standard)], None, "none-such").as_deref(), Some("cwlachap-hrnet-w32"), "an unknown base: the usual fallback");
        assert_eq!(can_set_main("auto-best", |m| m == "aariz-cepha29", "gu2net-isbi19").unwrap_err(), "Automatic best needs GU2Net: install it, or choose another base.");
        assert!(can_set_main("auto-best", |m| m == "gu2net-isbi19", "gu2net-isbi19").is_ok());
    }

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
    /// Part F final review I-1 (ruling: tracing ALWAYS has priority). The weights check is part-way through a
    /// film with a model (it holds the engine it runs on, as a run does) when tracing opens a new film and runs that
    /// model as an extra. Tracing must answer at once: it never waits behind the check's film, so none of that film's
    /// time counts against tracing's limit. Fails if the check runs on tracing's own engine (one session, one lock): tracing
    /// then waits until its limit and gives up.
    #[test] fn a_tracing_run_started_while_the_check_is_mid_film_answers_within_its_limit() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        install_local(&root, &tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src)), &src, &|_| {}).unwrap();
        let film = d.path().join("SYNTHETIC-film.png");
        image::GrayImage::from_fn(64, 64, |x, y| image::Luma([((x * 3 + y * 5) % 251) as u8])).save(&film).unwrap();
        let st = ModelsState::default();
        let traced = Arc::new(load_engine(&root, "tiny", None).unwrap());
        st.engines.lock().unwrap().insert("tiny".into(), traced.clone());          // tracing's engine, as engine_for caches it
        let check = st.check_engine(&root, "tiny").unwrap();
        let mid_film = check.hold_session_for_test();                                // the check is part-way through a film
        let limit = Duration::from_secs(3);
        let t = Instant::now();
        let r = extra_on_film(&st.busy, "tiny", limit, move || Ok(traced), film.display().to_string(), false);
        let took = t.elapsed();
        drop(mid_film);
        assert!(matches!(r, Ok(Ok(_))), "tracing gave no points while the check was mid-film: {:?}", r.as_ref().map(|x| x.as_ref().err()));
        assert!(took < limit, "tracing waited {took:?} behind the check");
        assert!(!st.busy.is_busy("tiny"), "tracing's claim is let go once it answers");
    }
    /// Part F I-1 residual (re-review): every model load in the app takes one process-wide lock (the dirname-race fix,
    /// `SESSION_START`), so a tracing run's first load of an extra model used to queue behind a load the weights check
    /// had under way, inside its 15 s clock. Here the check is part-way through a load (it holds the lock for 2 s, the
    /// way a slow load does) when tracing opens a film and loads the model for real, with a 1 s limit. Tracing must wait
    /// for the check's load BEFORE its clock starts, then answer. Fails if the wait is removed: tracing's load queues on
    /// the lock inside the limit and the model gives up.
    #[test] fn a_tracing_run_started_while_the_check_is_loading_does_not_count_that_load_against_its_limit() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        install_local(&root, &tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src)), &src, &|_| {}).unwrap();
        let film = d.path().join("SYNTHETIC-film.png");
        image::GrayImage::from_fn(64, 64, |x, y| image::Luma([((x * 3 + y * 5) % 251) as u8])).save(&film).unwrap();
        let st = ModelsState::default();
        let (hold, limit) = (Duration::from_millis(2000), Duration::from_millis(1000));
        let (started, loading) = std::sync::mpsc::channel::<()>();
        std::thread::scope(|s| {
            s.spawn(|| st.check_engine_loaded_by("other", move || {
                let _lock = ceph_infer::engine::hold_session_start_for_test();         // the check's load, part-way through
                started.send(()).unwrap();
                std::thread::sleep(hold);
                Err("SYNTHETIC: the check's load ends here".into())
            }));
            loading.recv().unwrap();                                                    // tracing starts while it loads
            let _tracing = st.tracing_starts();
            let manifest = root.join("tiny/manifest.json");
            let t = Instant::now();
            let r = extra_for_tracing(&st, "tiny", limit, move || Engine::load(&manifest).map(Arc::new).map_err(|e| format!("{e:#}")),
                film.display().to_string(), false);
            let took = t.elapsed();
            assert!(matches!(r, Ok(Ok(_))), "the check's load counted against tracing's limit: {:?}", r.as_ref().map(|x| x.as_ref().err()));
            assert!(took >= hold - Duration::from_millis(300), "precondition: tracing did meet the check's load (it took {took:?})");
        });
    }
    /// Part F I-1 residual, the other flag: while a tracing run of the extra models is under way, the weights check starts
    /// no model load; it starts once tracing ends (positive control). Fails if the check loads without asking.
    #[test] fn the_check_starts_no_model_load_while_tracing_runs() {
        let st = ModelsState::default();
        let tracing = st.tracing_starts();
        let (began, load_began) = std::sync::mpsc::channel::<()>();
        std::thread::scope(|s| {
            s.spawn(|| st.check_engine_loaded_by("m", move || { began.send(()).unwrap(); Err("SYNTHETIC: no real load needed".into()) }));
            assert!(load_began.recv_timeout(Duration::from_millis(800)).is_err(), "the check started a load while tracing ran");
            drop(tracing);
            assert!(load_began.recv_timeout(Duration::from_secs(10)).is_ok(), "control: the check loads once tracing ends");
        });
    }
    /// Edge: a check load that never ends holds tracing back for at most the cap, then tracing's clock starts as before;
    /// with no check load under way tracing does not wait at all.
    #[test] fn tracing_waits_for_a_check_load_at_most_the_cap() {
        let st = ModelsState::default();
        let t = Instant::now();
        st.wait_for_check_load(Duration::from_secs(5));
        assert!(t.elapsed() < Duration::from_millis(100), "no check load: no wait ({:?})", t.elapsed());
        let _never_ends = st.check_load_may_start();
        let t = Instant::now();
        st.wait_for_check_load(Duration::from_millis(300));
        let took = t.elapsed();
        assert!(took >= Duration::from_millis(300) && took < Duration::from_secs(3), "waited {took:?} for a load that never ends");
    }
    /// Part F re-review S1 (memory): the check keeps at most one model copy. Moving on to the next model lets the last
    /// copy go before the next one loads. Fails if copies are kept until the check ends.
    #[test] fn the_check_holds_one_model_copy_at_a_time() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        install_local(&root, &tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src)), &src, &|_| {}).unwrap();
        let onnx = d.path().join("tiny-full.onnx");
        std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/../../../crates/ceph-model/tests/fixtures/tiny-full.onnx"), &onnx).unwrap();
        install_local(&root, &ceph_model::testing::tiny_full_model(&sha256_file(&onnx).unwrap()), &onnx, &|_| {}).unwrap();
        let st = ModelsState::default();
        let first = Arc::downgrade(&st.check_engine(&root, "tiny").unwrap());
        assert!(Arc::ptr_eq(&first.upgrade().unwrap(), &st.check_engine(&root, "tiny").unwrap()), "control: the same model's copy is kept between its films");
        let _second = st.check_engine(&root, "tiny-full").unwrap();
        assert!(first.upgrade().is_none(), "the first model's copy is still held after the check moved on");
        assert_eq!(st.check_engines.lock().unwrap().len(), 1);
    }
    #[test] fn a_run_answered_in_time_leaves_its_model_free_for_the_next_film() {
        let busy = InFlight::default();
        assert_eq!(run_extra(&busy, "m", Duration::from_millis(3000), || 1), Ok(1));
        assert_eq!(run_extra(&busy, "m", Duration::from_millis(3000), || 2), Ok(2));
    }
    /// Part F Task 11: the weights check asks before each film whether tracing is using the model.
    #[test] fn a_model_is_busy_only_while_a_run_holds_it() {
        let busy = InFlight::default();
        assert!(!busy.is_busy("m"));
        let claim = busy.claim("m").unwrap();
        assert!(busy.is_busy("m") && !busy.is_busy("other"));
        drop(claim);
        assert!(!busy.is_busy("m"));
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
    struct Full;
    impl std::io::Write for Full {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> { Err(std::io::Error::from(std::io::ErrorKind::StorageFull)) }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    struct OtherFail;
    impl std::io::Write for OtherFail {
        fn write(&mut self, _: &[u8]) -> std::io::Result<usize> { Err(std::io::Error::new(std::io::ErrorKind::PermissionDenied, "no permission to write here")) }
        fn flush(&mut self) -> std::io::Result<()> { Ok(()) }
    }
    #[test] fn a_full_disk_during_a_download_says_so_in_plain_words() {
        let mut body: &[u8] = &[0u8; 4096];
        assert_eq!(copy_body(&mut body, &mut Full, Some(4096), &|_| {}).unwrap_err(), DISK_FULL);
        assert_eq!(friendly_io(&std::io::Error::from(std::io::ErrorKind::StorageFull)), DISK_FULL);
    }
    #[test] fn another_write_error_keeps_its_own_words() {
        let mut body: &[u8] = &[0u8; 4096];
        assert_eq!(copy_body(&mut body, &mut OtherFail, Some(4096), &|_| {}).unwrap_err(), "no permission to write here");
    }
    #[test] fn a_full_disk_removes_the_partial_download_and_says_so() {
        let d = tempfile::tempdir().unwrap(); let p = d.path().join("source");
        let mut body: &[u8] = &[0u8; 4096];
        let e = write_download(&mut body, &p, Some(4096), &|_| {}, &|_file| Box::new(Full)).unwrap_err();
        assert_eq!(e, DISK_FULL);
        assert!(!p.exists(), "partial file removed");
    }
    #[test] fn one_install_at_a_time_per_model() {
        let st = ModelsState::default();
        begin_install(&st, "aariz-cepha29").unwrap();
        assert!(begin_install(&st, "aariz-cepha29").unwrap_err().contains("already being installed"));
        begin_install(&st, "srpose-cldet23").unwrap();
    }
    #[test] fn a_failed_install_clears_its_place_so_retry_is_allowed() {
        let st = ModelsState::default();
        let slot = claim_install(&st, "aariz-cepha29").unwrap();
        drop(slot);
        begin_install(&st, "aariz-cepha29").unwrap();
    }
    #[test] fn the_second_install_is_refused_while_the_first_is_held_mid_way() {
        // The first install is held inside its work (a channel the test releases); the second starts meanwhile.
        let st = Arc::new(ModelsState::default());
        let (hold_tx, hold_rx) = std::sync::mpsc::channel::<()>();
        let (in_tx, in_rx) = std::sync::mpsc::channel::<()>();
        let s1 = st.clone();
        let first = std::thread::spawn(move || { let _slot = claim_install(&s1, "aariz-cepha29")?; in_tx.send(()).unwrap(); hold_rx.recv().unwrap(); Ok::<(), String>(()) });
        in_rx.recv().unwrap();                                    // the first is now inside its work
        assert!(claim_install(&st, "aariz-cepha29").err().unwrap().contains("already being installed"));
        hold_tx.send(()).unwrap();
        first.join().unwrap().unwrap();
        claim_install(&st, "aariz-cepha29").unwrap();             // finished: its place is free again
    }
    #[test] fn a_panicking_install_still_frees_its_place() {
        let st = Arc::new(ModelsState::default());
        let s1 = st.clone();
        assert!(std::thread::spawn(move || { let _slot = claim_install(&s1, "aariz-cepha29").unwrap(); panic!("boom"); }).join().is_err());
        begin_install(&st, "aariz-cepha29").unwrap();
    }
    #[test] fn remove_is_refused_while_a_run_holds_the_engine_and_allowed_when_it_lets_go() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        let m = tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src));
        install_local(&root, &m, &src, &|_| {}).unwrap();
        let st = ModelsState::default();
        st.release_for_remove("tiny").unwrap();                    // nothing loaded
        let e = Arc::new(Engine::load(&root.join("tiny/manifest.json")).unwrap());
        st.engines.lock().unwrap().insert("tiny".into(), e.clone());
        assert!(st.release_for_remove("tiny").unwrap_err().contains("in use right now"), "a run holds a copy");
        assert!(st.engines.lock().unwrap().contains_key("tiny"), "a refused Remove lets nothing go");
        drop(e);
        st.release_for_remove("tiny").unwrap();
        assert!(!st.engines.lock().unwrap().contains_key("tiny"), "the run finished: the engine is let go");
        let c = Arc::new(Engine::load(&root.join("tiny/manifest.json")).unwrap());
        st.check_engines.lock().unwrap().insert("tiny".into(), c.clone());
        assert!(st.release_for_remove("tiny").unwrap_err().contains("in use right now"), "the weights check holds a copy");
    }
    #[test] fn remove_is_refused_while_the_model_is_being_installed() {
        let st = ModelsState::default();
        let _slot = claim_install(&st, "aariz-cepha29").unwrap();
        let e = st.release_for_remove("aariz-cepha29").unwrap_err();
        assert!(e.contains("is being installed right now"), "{e}");
        st.release_for_remove("srpose-cldet23").unwrap();           // another model is unaffected
    }
    #[cfg(unix)]
    #[test] fn a_remove_whose_move_aside_fails_says_so_in_plain_words_and_changes_nothing() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        fake_model(d.path(), "aariz-cepha29");
        std::fs::set_permissions(d.path(), std::fs::Permissions::from_mode(0o500)).unwrap();   // the folder cannot be changed
        let e = remove_model_dir(d.path(), "aariz-cepha29").unwrap_err();
        std::fs::set_permissions(d.path(), std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(e.starts_with("Aariz couldn't be removed") && !e.contains("os error"), "{e}");
        assert!(is_ready(d.path(), "aariz-cepha29") && !main_must_be_cleared(d.path(), "aariz-cepha29"), "nothing moved: still Ready, still the main model");
    }
    #[test] fn friendly_io_trusts_a_raw_code_only_on_its_own_platform() {
        #[cfg(unix)] { assert_eq!(friendly_io(&std::io::Error::from_raw_os_error(28)), DISK_FULL); assert_ne!(friendly_io(&std::io::Error::from_raw_os_error(112)), DISK_FULL, "112 is EHOSTDOWN/other on Unix"); }
        #[cfg(windows)] { assert_eq!(friendly_io(&std::io::Error::from_raw_os_error(112)), DISK_FULL); assert_ne!(friendly_io(&std::io::Error::from_raw_os_error(28)), DISK_FULL, "28 is ERROR_OUT_OF_PAPER on Windows"); }
    }
    fn fake_model(root: &Path, id: &str) { std::fs::create_dir_all(root.join(id)).unwrap(); std::fs::write(root.join(id).join("manifest.json"), "{}").unwrap(); }
    #[test] fn remove_moves_the_model_aside_then_deletes_it() {
        let d = tempfile::tempdir().unwrap();
        fake_model(d.path(), "m");
        remove_model_dir(d.path(), "m").unwrap();
        assert!(!d.path().join("m").exists());
        assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 0, "nothing left behind");
        remove_model_dir(d.path(), "m").unwrap();   // not installed: Ok, nothing touched
        assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 0);
    }
    #[cfg(unix)]
    #[test] fn a_remove_that_cannot_finish_leaves_the_model_not_ready_and_a_leftover_the_next_start_sweeps() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        fake_model(d.path(), "m");
        let locked = d.path().join("m/locked"); std::fs::create_dir_all(&locked).unwrap();
        std::fs::write(locked.join("weights.bin"), "x").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();   // a file inside cannot be deleted
        let r = remove_model_dir(d.path(), "m");
        assert!(r.is_err(), "the delete failed");
        assert!(!is_ready(d.path(), "m"), "the model is no longer listed as Ready");
        assert!(main_must_be_cleared(d.path(), "m"), "a failed delete after the move-aside still clears the main-model setting");
        assert!(r.unwrap_err().contains("cleared the next time the app starts"));
        let left: Vec<String> = std::fs::read_dir(d.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        assert!(left.len() == 1 && left[0].starts_with(".tmp-removing-m-"), "{left:?}");
        let aside = d.path().join(&left[0]);
        std::fs::set_permissions(aside.join("locked"), std::fs::Permissions::from_mode(0o700)).unwrap();
        sweep(d.path());
        assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 0, "the next start finishes the delete");
    }
    #[cfg(unix)]
    #[test] fn a_reinstall_whose_move_aside_fails_says_retry_not_remove() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        let m = tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src));
        install_local(&root, &m, &src, &|_| {}).unwrap();
        let before = std::fs::read_dir(&root).unwrap().count();
        // The move-aside step on its own: the folder cannot be changed.
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o500)).unwrap();
        let e = replace_model_dir(&root, "tiny").unwrap_err();
        std::fs::set_permissions(&root, std::fs::Permissions::from_mode(0o700)).unwrap();
        assert!(e.contains("press Retry") && !e.contains("Remove") && !e.contains("os error"), "{e}");
        assert!(is_ready(&root, "tiny") && std::fs::read_dir(&root).unwrap().count() == before, "nothing moved");
    }
    #[cfg(unix)]
    #[test] fn a_reinstall_goes_ahead_when_the_old_folder_cannot_be_fully_deleted() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        let m = tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src));
        install_local(&root, &m, &src, &|_| {}).unwrap();
        let locked = root.join("tiny/locked"); std::fs::create_dir_all(&locked).unwrap(); std::fs::write(locked.join("w"), "x").unwrap();
        std::fs::set_permissions(&locked, std::fs::Permissions::from_mode(0o500)).unwrap();
        let r = install_local(&root, &m, &src, &|_| {});
        let left: Vec<_> = std::fs::read_dir(&root).unwrap().map(|e| e.unwrap().path()).collect();
        for l in &left { if l.join("locked").exists() { std::fs::set_permissions(l.join("locked"), std::fs::Permissions::from_mode(0o700)).unwrap(); } }
        r.unwrap();
        assert!(is_ready(&root, "tiny") && !root.join("tiny/locked").exists(), "the new copy is in place");
        sweep(&root);
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1, "the next start clears the leftover");
    }
    #[test] fn a_reinstall_is_refused_in_retry_words_while_a_run_holds_the_engine_and_lets_go_otherwise() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        let m = tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src));
        install_local(&root, &m, &src, &|_| {}).unwrap();
        let st = ModelsState::default();
        let e = Arc::new(Engine::load(&root.join("tiny/manifest.json")).unwrap());
        st.engines.lock().unwrap().insert("tiny".into(), e.clone());
        let msg = st.release_for_reinstall("tiny").unwrap_err();
        assert!(msg.contains("in use right now") && msg.contains("press Retry again") && !msg.contains("Remove"), "{msg}");
        assert!(st.engines.lock().unwrap().contains_key("tiny"), "a refused reinstall lets nothing go");
        drop(e);
        st.release_for_reinstall("tiny").unwrap();
        assert!(!st.engines.lock().unwrap().contains_key("tiny"), "the run finished: the engine is let go");
        begin_install(&st, "tiny").unwrap();                       // the install's own place is held, as in run_install
        st.release_for_reinstall("tiny").unwrap();                 // and a reinstall is not refused for it
    }
    #[test] fn a_reinstall_replaces_a_ready_model_through_the_same_aside_then_delete() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        let m = tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src));
        install_local(&root, &m, &src, &|_| {}).unwrap();
        std::fs::write(root.join("tiny/old-marker"), "x").unwrap();
        install_local(&root, &m, &src, &|_| {}).unwrap();
        assert!(is_ready(&root, "tiny") && !root.join("tiny/old-marker").exists(), "the old folder was replaced");
        assert_eq!(std::fs::read_dir(&root).unwrap().count(), 1, "no work or removing folder left behind");
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
        assert_eq!(main_of(&all, None, DEFAULT_MAIN).as_deref(), Some("aariz-cepha29"), "no main model chosen, Aariz installed: Aariz (owner O5)");
        assert_eq!(main_of(&all, Some(""), DEFAULT_MAIN).as_deref(), Some("aariz-cepha29"), "an empty setting is not a choice");
        assert_eq!(main_of(&all, Some("cwlachap-hrnet-w32"), DEFAULT_MAIN).as_deref(), Some("cwlachap-hrnet-w32"), "a chosen main model is kept (O5)");
        let no_aariz = [("cwlachap-hrnet-w32", Tier::Standard), ("gu2net-isbi19", Tier::Standard)];
        assert_eq!(main_of(&no_aariz, None, DEFAULT_MAIN).as_deref(), Some("cwlachap-hrnet-w32"), "Aariz not installed: falls back as today");
        let ready = [("gu2net-isbi19", Tier::Standard), ("srpose-cldet23", Tier::Optional)];
        assert_eq!(main_of(&ready, Some("srpose-cldet23"), DEFAULT_MAIN).as_deref(), Some("srpose-cldet23"));
        assert_eq!(main_of(&ready, Some("cwlachap-hrnet-w32"), DEFAULT_MAIN).as_deref(), Some("gu2net-isbi19"));   // the setting's model was removed
        assert_eq!(main_of(&[("srpose-cldet23", Tier::Optional)], None, DEFAULT_MAIN).as_deref(), Some("srpose-cldet23"));
        assert_eq!(main_of(&[], None, DEFAULT_MAIN), None);
    }
    #[test] fn automatic_best_may_be_main_only_with_aariz_and_a_real_model_only_when_installed() {
        let with = |ids: &'static [&'static str]| move |m: &str| ids.contains(&m);
        assert!(can_set_main("auto-best", with(&["aariz-cepha29"]), DEFAULT_MAIN).is_ok());
        assert_eq!(can_set_main("auto-best", with(&["gu2net-isbi19"]), DEFAULT_MAIN).unwrap_err(), "Automatic best needs Aariz: install it, or choose another base.");
        assert!(can_set_main("gu2net-isbi19", with(&["gu2net-isbi19"]), DEFAULT_MAIN).is_ok());
        assert_eq!(can_set_main("gu2net-isbi19", with(&[]), DEFAULT_MAIN).unwrap_err(), "gu2net-isbi19 is not installed");
    }
    #[test] fn no_real_model_shows_as_main_while_automatic_best_is_on() {
        assert!(shown_main(Some("aariz-cepha29"), "aariz-cepha29", false));
        assert!(!shown_main(Some("aariz-cepha29"), "aariz-cepha29", true));
        assert!(!shown_main(Some("aariz-cepha29"), "gu2net-isbi19", false));
    }
    #[test] fn the_point_source_keeps_part_f_keys_and_adds_auto_best() {
        let j = serde_json::to_value(PointSource { base: ceph_model::source::main_point_source(), auto_best: None, auto_best_unreadable: false }).unwrap();
        assert!(j.get("ownerChoices").is_some() && j.get("points").is_some() && j.get("autoBest") == Some(&serde_json::Value::Null));
        assert_eq!(with_auto_best(Err("locked".into())), None, "unreadable: Aariz places every point (logged)");
        assert_eq!(with_auto_best(Ok(crate::auto_best::AutoBestMap::default())), Some(crate::auto_best::AutoBestMap::default()));
    }
    fn choices() -> Result<(BTreeMap<String, String>, BTreeMap<String, ceph_model::source::ChoiceNote>), String> {
        Ok((BTreeMap::from([("Go".into(), "srpose-cldet23".into())]), BTreeMap::new()))
    }
    #[test] fn unreadable_choices_while_automatic_best_is_main_are_flagged_and_drop_the_switches() {
        let s = point_source_from(choices(), Err("locked".into()), Some(""));
        assert!(s.auto_best_unreadable);
        assert!(s.base.owner_choices.is_empty(), "plain base: no Part F switch");
        let fixed = point_source_from(choices(), Err("locked".into()), Some("aariz-cepha29"));
        assert!(!fixed.auto_best_unreadable && !fixed.base.owner_choices.is_empty(), "a fixed main model: as before");
    }
    #[test] fn unreadable_choices_edge_cases_m4() {
        // main setting unset or "auto-best": Automatic best is main
        assert!(point_source_from(choices(), Err("x".into()), None).auto_best_unreadable, "main setting unreadable/unset = blank");
        assert!(point_source_from(choices(), Err("x".into()), Some("auto-best")).auto_best_unreadable);
        // readable map: unchanged, no flag, switches kept
        let ok = point_source_from(choices(), Ok(crate::auto_best::AutoBestMap::default()), Some(""));
        assert!(!ok.auto_best_unreadable && ok.auto_best.is_some() && !ok.base.owner_choices.is_empty());
        // the flag reaches the screen as camelCase
        let j = serde_json::to_value(&point_source_from(choices(), Err("x".into()), None)).unwrap();
        assert_eq!(j.get("autoBestUnreadable"), Some(&serde_json::Value::Bool(true)));
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
    /// Part F Task 3: every run stores the file fingerprint the model manager reads from the installed manifest, and for
    /// a model with a weights file that is not the network file's hash alone. Positive control: put back
    /// `model_sha256: self.m.sha256.clone()` in engine.rs and this fails.
    #[test] fn a_run_stores_the_installed_files_fingerprint() {
        let d = tempfile::tempdir().unwrap(); let root = d.path().join("models");
        let src = tiny_pth(d.path());
        install_local(&root, &tiny_model(&sha256_file(&src).unwrap(), &pinned_weights(&src)), &src, &|_| {}).unwrap();
        let spec = ceph_infer::spec::ModelSpec::load(&root.join("tiny/manifest.json")).unwrap();
        assert!(spec.weights.is_some(), "the tiny model has a weights file, like the three converted models");
        let fp = installed_fingerprint(&root, "tiny").unwrap();
        assert_ne!(fp, spec.sha256, "not the network file's hash alone");
        let ran = Engine::load(&root.join("tiny/manifest.json")).unwrap().detect(&image::GrayImage::new(64, 64), false).unwrap();
        assert_eq!(ran.model_sha256, fp);
        assert_eq!(installed_fingerprint(&root, "not-installed"), None);
        std::fs::write(root.join("tiny/manifest.json"), b"{ not json").unwrap();
        assert_eq!(installed_fingerprint(&root, "tiny"), None, "an unreadable manifest gives no fingerprint");
    }
    /// Part F Task 3: BEFORE_13 is the one formula applied to the files the catalogue pinned when it was written (18 Oct,
    /// unchanged at 26 Oct). If a later catalogue pins a new file, this test's `pinned` list is NOT changed and BEFORE_13
    /// is NOT changed: both describe marks stored before Part F (formats up to 13). Only the last assertion (today's
    /// catalogue) is updated then.
    #[test] fn before_13_is_the_formula_on_the_files_pinned_before_format_13() {
        let pinned = [("57af69dbe035ddd153b33341efe4035057c590782cf2adcc3e0903c601b13db2", Some("276772267f80e1f0d81b4ba40c2d0f0302672bc81da2d3862b16c471f075c46e")),
            ("c41e7116c098343bec27301b67fa3667be93b291bc102440202e67b7949d796b", Some("36967440bef7147e1b89dd63839613d99ac03d5d8f5964ef7093f586e42ee6aa")),
            ("61b601aa6194e1142a39e5159fd498611257d82af0c68106bc18cc983228e368", Some("70fe793b5a70a3bf419f0ab68168d455d3ee9de219ded109968fcd9e6fc5f40c")),
            ("cacd38201ada69fa7d3ea2566cb63b315302f35e3c66fb483a6eed32c88f14c5", None)];
        for (b, (f, w)) in ceph_model::fingerprint::BEFORE_13.iter().zip(pinned) {
            assert_eq!((b.recorded, b.fingerprint.to_string()), (f, ceph_infer::spec::fingerprint(f, w)), "{}", b.model_id);
        }
        let today: Vec<(String, String, String)> = builtin().iter().map(|m| (m.entry.id.clone(), m.entry.skeleton_sha256.clone(), m.entry.weights_sha256.clone())).collect();
        for (b, (f, w)) in ceph_model::fingerprint::BEFORE_13.iter().zip(pinned).take(3) {
            assert!(today.contains(&(b.model_id.to_string(), f.to_string(), w.unwrap().to_string())), "{} is still pinned to these files today", b.model_id);
        }
    }
}
