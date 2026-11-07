//! The whole-film check's region finder, installed from Models… (1.2.1, spec 2026-11-06-check-model-download).
//!
//! Two files from the Zenodo VERSION record (`manifest.json` first, then `model.onnx`), each checked against its pinned
//! SHA-256, built in a work folder, test-run once on a blank SYNTHETIC film, then renamed into `<models>/regions` in one
//! step. On any failure nothing is left behind; a stopped download is deleted, never resumed (Q1 A). Joins only
//! (Windows-ready); the loaded finder is released before any replace or remove.

use crate::models::{self, ModelsState, DISK_FULL, DOWNLOAD_BLOCKED, STALL};
use crate::whole_film::WholeFilmState;
use ceph_infer::regions::RegionEngine;
use ceph_model::catalog::{check_model, CheckEntry, Source};
use ceph_model::install::sha256_file;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::Manager;

/// The install id (the event id and the `ModelsState` place), not a landmark model's.
pub const ID: &str = "check-regions";
/// A refused file: the hash is not the pinned one.
pub const MISMATCH: &str = "The file doesn't match the one this version of OpenCephAI was made for. Nothing was installed.";
/// The server could not be reached at all.
pub const NO_NET: &str = "No internet connection. Nothing was installed. Try again when you are online, or use Add files…";
const DOWNLOAD_WORK: &str = ".tmp-download-check-regions";
/// What the install records beside the files, so a later start can tell a whole install from a damaged one.
const INSTALLED: &str = "installed.json";

/// Where the two files come from. `base` replaces `https://zenodo.org` (tests only).
pub enum From { Download { base: Option<String> }, Folder(PathBuf) }

fn zenodo(s: &Source) -> Result<(&str, &str, String), String> {
    match s { Source::Zenodo { file, sha256, .. } => Ok((file, sha256, s.url())), _ => Err("the check model's files come from Zenodo".into()) }
}
fn nanos() -> u32 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos()).unwrap_or(0) }

/// A stalled or failed download says it installed nothing (batch B review M5). The refusal codes and the messages that
/// already say so are kept as they are (`DOWNLOAD_BLOCKED` is matched by the screen).
fn nothing_installed(e: String) -> String {
    if e == DOWNLOAD_BLOCKED || e == DISK_FULL || e.contains("Nothing was installed") { e }
    else if e.starts_with("The download stopped") { "The download stopped before it finished. Nothing was installed. Try again in Models…".into() }
    else { format!("{e} Nothing was installed.") }
}

/// One file → `dest`. A refused or HTML answer is `DOWNLOAD_BLOCKED`; a server that cannot be reached is `NO_NET`.
fn fetch(url: &str, dest: &Path, on: &dyn Fn(Option<f64>), stall: std::time::Duration,
         wrap: &dyn Fn(std::fs::File) -> Box<dyn std::io::Write>) -> Result<(), String> {
    // The blocking client's timeout applies to each read, not the whole download: 121 MB still arrives, a stall stops.
    let client = reqwest::blocking::Client::builder().user_agent("OpenCephAI").timeout(stall)
        .connect_timeout(std::time::Duration::from_secs(30)).build().map_err(|e| e.to_string())?;
    let mut resp = client.get(url).send().map_err(|e| if e.is_connect() { NO_NET.to_string() } else { DOWNLOAD_BLOCKED.to_string() })?;
    let html = resp.headers().get(reqwest::header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.contains("text/html"));
    if !resp.status().is_success() || html { return Err(DOWNLOAD_BLOCKED.into()); }
    let total = resp.content_length();
    models::write_download(&mut resp, dest, total, on, wrap)
}

/// The whole install. `stall` and `wrap` are the seams the tests use (a short stall; a writer that fails).
pub(crate) fn install_with(root: &Path, e: &CheckEntry, from: &From, stage: &dyn Fn(&str, Option<f64>), stall: std::time::Duration,
                           wrap: &dyn Fn(std::fs::File) -> Box<dyn std::io::Write>) -> Result<(), String> {
    std::fs::create_dir_all(root).map_err(|e| models::friendly_io(&e))?;
    let dl = root.join(DOWNLOAD_WORK);
    let work = root.join(format!(".tmp-check-regions-{}-{}", std::process::id(), nanos()));
    let res = (|| -> Result<(), String> {
        std::fs::remove_dir_all(&dl).ok();                         // a leftover of an earlier run: never resumed
        std::fs::create_dir_all(&dl).map_err(|e| models::friendly_io(&e))?;
        for f in &e.files {
            let (file, sha, url) = zenodo(f)?;
            let dest = dl.join(file);
            match from {
                From::Download { base } => {
                    let url = match base { Some(b) => url.replacen("https://zenodo.org", b, 1), None => url };
                    stage("downloading", None);
                    fetch(&url, &dest, &|fr| stage("downloading", fr), stall, wrap).map_err(nothing_installed)?;
                }
                From::Folder(p) => {
                    stage("checking", None);
                    let src = p.join(file);
                    if !src.is_file() { return Err(format!("{file} is not in that folder. Choose the folder holding manifest.json and model.onnx. Nothing was installed.")); }
                    std::fs::copy(&src, &dest).map_err(|e| models::friendly_io(&e))?;
                }
            }
            stage("checking", None);
            let got = sha256_file(&dest).map_err(|e| e.to_string())?;
            if !got.eq_ignore_ascii_case(sha) { return Err(MISMATCH.into()); }   // the manifest is checked before the 121 MB is fetched
        }
        let dir = work.join(&e.folder);
        std::fs::create_dir_all(&dir).map_err(|e| models::friendly_io(&e))?;
        for f in &e.files { let (file, _, _) = zenodo(f)?; std::fs::rename(dl.join(file), dir.join(file)).map_err(|e| models::friendly_io(&e))?; }
        stage("testing", None);
        let engine = RegionEngine::load(&dir.join("manifest.json")).map_err(|e| format!("{e:#}"))?;
        engine.find(&image::GrayImage::new(1935, 2400)).map_err(|e| format!("{e:#}"))?;
        drop(engine);
        let bytes = std::fs::metadata(dir.join("model.onnx")).map_err(|e| models::friendly_io(&e))?.len();
        std::fs::write(dir.join(INSTALLED), serde_json::json!({ "modelBytes": bytes }).to_string()).map_err(|e| models::friendly_io(&e))?;
        put_files(&dir, &root.join(&e.folder))
    })();
    std::fs::remove_dir_all(&dl).ok();
    std::fs::remove_dir_all(&work).ok();
    res
}
/// The three files this install owns inside `<models>/regions`. Nothing else in that folder is ever touched: the owner may
/// have put calibration files there by hand (batch B review I1).
const OWNED: [&str; 3] = ["model.onnx", "manifest.json", INSTALLED];

/// Put the three files of a finished, tested install into `target`. Each is staged as a `.tmp` file beside its place, then
/// renamed over the old one (the same folder, so one step); every other file in `target` stays. On a failure the staged
/// files are removed. A crash between two renames can only mix old and new copies of pinned files, which the finder's
/// pins and `status` refuse ("damaged"), never a wrong verdict.
fn put_files(from: &Path, target: &Path) -> Result<(), String> {
    std::fs::create_dir_all(target).map_err(|e| models::friendly_io(&e))?;
    let tmp = |n: &str| target.join(format!(".{n}.tmp-new"));
    let res = (|| -> Result<(), String> {
        for n in OWNED { std::fs::copy(from.join(n), tmp(n)).map_err(|e| models::friendly_io(&e))?; }
        for n in OWNED { std::fs::rename(tmp(n), target.join(n)).map_err(|e| models::friendly_io(&e))?; }
        Ok(())
    })();
    if res.is_err() { for n in OWNED { std::fs::remove_file(tmp(n)).ok(); } }
    res
}

/// Remove: delete only the three files the install owns, then the folder if nothing else is in it. Not installed is Ok.
pub(crate) fn remove_check_files(root: &Path, e: &CheckEntry) -> Result<(), String> {
    let dir = root.join(&e.folder);
    for n in OWNED {
        match std::fs::remove_file(dir.join(n)) {
            Ok(()) => {}
            Err(x) if x.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => return Err("The region finder couldn't be removed: a file in it is still in use. Close anything using it, then press Remove again.".into()),
        }
    }
    for n in OWNED { std::fs::remove_file(dir.join(format!(".{n}.tmp-new"))).ok(); }
    let _ = std::fs::remove_dir(&dir);                       // only succeeds when empty
    Ok(())
}

/// The install as the commands run it.
pub fn install_check(root: &Path, e: &CheckEntry, from: From, stage: &dyn Fn(&str, Option<f64>)) -> Result<(), String> {
    install_with(root, e, &from, stage, STALL, &|f| Box::new(f))
}

/// `not-installed` (no manifest in the folder), `ready` (the manifest is the pinned file and `model.onnx` is there: the size
/// the install recorded, or, with no record, a finder placed by hand), else `damaged`. Reads one small file and one size:
/// never the 121 MB.
pub fn check_status(root: &Path, e: &CheckEntry) -> &'static str {
    let dir = root.join(&e.folder);
    let manifest = dir.join("manifest.json");
    if !manifest.is_file() { return "not-installed"; }
    let pin = e.files.iter().find_map(|f| zenodo(f).ok().filter(|(n, _, _)| *n == "manifest.json").map(|(_, s, _)| s.to_string()));
    let manifest_ok = match (sha256_file(&manifest), pin) { (Ok(got), Some(p)) => got.eq_ignore_ascii_case(&p), _ => false };
    let size = std::fs::metadata(dir.join("model.onnx")).ok().map(|m| m.len());
    match (manifest_ok, recorded_bytes(&dir), size) {
        (true, Some(r), Some(sz)) if r == sz => "ready",
        (true, None, Some(_)) if !dir.join(INSTALLED).exists() => "ready",   // placed by hand: the check itself hashes the model
        _ => "damaged",
    }
}
fn recorded_bytes(dir: &Path) -> Option<u64> {
    std::fs::read(dir.join(INSTALLED)).ok().and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok()).and_then(|v| v["modelBytes"].as_u64())
}
/// A ready finder that has no install record (the owner put the two files there). Models… says "Ready (added by hand)".
pub fn added_by_hand(root: &Path, e: &CheckEntry) -> bool { !root.join(&e.folder).join(INSTALLED).exists() }

/// What Models… shows for the check model.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRow { title: String, author: String, licence: String, citation: String, page: String, size_mb: u32, status: &'static str, by_hand: bool, stage: Option<String>, error: Option<String> }

/// The row's status: installing > ready > failed (the last error) > damaged / not-installed.
fn row_status(on_disk: &'static str, installing: bool, failed: bool) -> &'static str {
    if installing { "installing" } else if on_disk == "ready" { "ready" } else if failed { "failed" } else { on_disk }
}
#[tauri::command]
pub async fn check_model_row(app: tauri::AppHandle) -> Result<CheckRow, String> {
    let e = check_model();
    let root = models::root(&app)?;
    let st = app.state::<ModelsState>();
    let (stage, error) = (st.stage_of(ID), st.failed_of(ID));
    let (e2, r2) = (e.clone(), root.clone());
    let disk = tauri::async_runtime::spawn_blocking(move || check_status(&r2, &e2)).await.map_err(|e| e.to_string())?;
    let status = row_status(disk, stage.is_some(), error.is_some());
    let page = e.files.first().and_then(|f| zenodo(f).ok()).map(|_| e.files[0].page()).unwrap_or_default();
    let by_hand = status == "ready" && added_by_hand(&root, &e);
    Ok(CheckRow { title: e.title, author: e.author, licence: e.licence.code, citation: e.citation, page, size_mb: e.size_mb, status, by_hand, stage, error: if status == "failed" { error } else { None } })
}

/// The install's one place (`check-regions`), taken or refused. Freed when the slot drops.
pub(crate) fn begin(st: &ModelsState) -> Result<models::InstallSlot<'_>, String> { models::claim_install(st, ID) }

async fn run(app: tauri::AppHandle, from: From) -> Result<(), String> {
    let e = check_model();
    let st = app.state::<ModelsState>();
    let slot = begin(&st)?;
    let root = models::root(&app)?;
    st.clear_failed(ID);
    app.state::<WholeFilmState>().forget_regions();            // Windows keeps a loaded file from being replaced
    let a = app.clone();
    let res = tauri::async_runtime::spawn_blocking(move || install_check(&root, &e, from, &|s, f| models::emit(&a, ID, s, f))).await.map_err(|e| e.to_string())?;
    app.state::<WholeFilmState>().forget_regions();            // the next check loads the paired set
    if let Err(e) = &res { st.set_failed(ID, e); }
    drop(slot);                                                // free the place before the event, so Retry on "failed" is allowed
    models::emit_done(&app, ID, res.is_ok());
    res
}
#[tauri::command] pub async fn check_model_install(app: tauri::AppHandle) -> Result<(), String> { run(app, From::Download { base: None }).await }
/// `path` is the folder holding the two files (a file inside it is taken as its folder).
#[tauri::command] pub async fn check_model_add_files(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = PathBuf::from(path);
    run(app, From::Folder(if p.is_file() { p.parent().map(Path::to_path_buf).unwrap_or(p) } else { p })).await
}
#[tauri::command]
pub async fn check_model_remove(app: tauri::AppHandle) -> Result<(), String> {
    let e = check_model();
    let st = app.state::<ModelsState>();
    let _slot = begin(&st)?;                                   // never while it is being installed
    let root = models::root(&app)?;
    app.state::<WholeFilmState>().forget_regions();            // never delete a folder something has open
    let res = tauri::async_runtime::spawn_blocking({ let (r, e) = (root.clone(), e.clone()); move || remove_check_files(&r, &e) }).await.map_err(|e| e.to_string())?;
    app.state::<WholeFilmState>().forget_regions();
    st.clear_failed(ID);
    res
}

/// The library setting that remembers the one-time question was answered (Download or Later, either way).
pub const ASKED_KEY: &str = "check_model_asked";
/// Ask only when no finder is found, the question was never answered, and the whole-film check is on (Q2 A: no question
/// about a model the check would not use).
pub fn should_ask(finder_found: bool, asked: Option<&str>, check_on: bool) -> bool { !finder_found && asked != Some("1") && check_on }
/// `should_ask` with the check's switch as the library gave it: unreadable (not open yet, locked, read-only) means no
/// question now, logged, and nothing is stored so the next open asks again.
fn decide(finder_found: bool, asked: Option<&str>, check_on: Result<bool, String>) -> bool {
    match check_on {
        Ok(on) => should_ask(finder_found, asked, on),
        Err(e) => { eprintln!("Check model: the one-time question waits (the library cannot be read yet): {e}"); false }
    }
}
/// Whether the screen should ask now.
#[tauri::command]
pub async fn check_model_offer(app: tauri::AppHandle) -> bool {
    let a = app.clone();
    let found = tauri::async_runtime::spawn_blocking(move || crate::whole_film::finder_pinned_in(&crate::whole_film_candidates(&a))).await.unwrap_or(true);
    let asked = crate::library::setting(&app, ASKED_KEY);
    let on = crate::library::with(&app, |l, _| crate::whole_film::switch_of(l).map(|s| s.on)).await;
    decide(found, asked.as_deref(), on)
}
/// Download or Later: the question is not asked again.
#[tauri::command]
pub async fn check_model_offer_answered(app: tauri::AppHandle) { crate::library::set_setting(&app, ASKED_KEY, "1"); }

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::sync::{Arc, Mutex};

    /// A SYNTHETIC check model: the tiny region fixture as `model.onnx`, a manifest written for it, and an entry pinning both.
    struct Synth { onnx: Vec<u8>, manifest: Vec<u8>, entry: CheckEntry }
    fn synth() -> Synth {
        let onnx = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..").join("crates").join("ceph-infer").join("tests").join("fixtures").join("tiny-regions.onnx")).unwrap();
        let manifest = serde_json::to_vec_pretty(&serde_json::json!({"manifestVersion": 2, "kind": "regions", "id": "tiny-regions", "version": "synthetic-1",
            "title": "SYNTHETIC tiny region finder", "file": "model.onnx", "sha256": ceph_model::install::sha256_bytes(&onnx),
            "input": {"name": "input", "width": 8, "height": 8, "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
            "outputs": {"boxes": "dets", "logits": "labels", "boxFormat": "cxcywh-normalised", "score": "sigmoid"},
            "classes": [{"region": "cranial-base", "logitIndex": 1}, {"region": "maxilla", "logitIndex": 2}, {"region": "mandible", "logitIndex": 3},
                        {"region": "incisors", "logitIndex": 4}, {"region": "soft-tissue", "logitIndex": 5}],
            "runtime": "cpu", "trainingNote": "SYNTHETIC: constants only"})).unwrap();
        let mut entry = check_model();
        entry.files = vec![
            Source::Zenodo { record: "1".into(), file: "manifest.json".into(), sha256: ceph_model::install::sha256_bytes(&manifest) },
            Source::Zenodo { record: "1".into(), file: "model.onnx".into(), sha256: ceph_model::install::sha256_bytes(&onnx) }];
        Synth { onnx, manifest, entry }
    }
    enum Reply { Body(Vec<u8>, &'static str), Half(Vec<u8>) }
    struct Srv { base: String, hits: Arc<Mutex<Vec<String>>> }
    /// A server on 127.0.0.1:0 (as `models::tests::a_stalled_download_stops_instead_of_hanging`): each request's path is
    /// counted; `Body` is a whole answer, `Half` sends half of the body and then nothing.
    fn serve(routes: Vec<(&'static str, Reply)>) -> Srv {
        let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let hits = Arc::new(Mutex::new(Vec::new()));
        let (h, routes) = (hits.clone(), Arc::new(routes));
        std::thread::spawn(move || for c in l.incoming().flatten() {
            let (h, routes) = (h.clone(), routes.clone());
            std::thread::spawn(move || {
                let mut c = c;
                let mut req = [0u8; 2048]; let n = c.read(&mut req).unwrap_or(0);
                let line = String::from_utf8_lossy(&req[..n]).lines().next().unwrap_or("").to_string();
                h.lock().unwrap().push(line.clone());
                let Some((_, r)) = routes.iter().find(|(name, _)| line.contains(&format!("/files/{name}/content"))) else {
                    let _ = c.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"); return };
                match r {
                    Reply::Body(b, ct) => { let _ = c.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: {ct}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", b.len()).as_bytes()); let _ = c.write_all(b); }
                    Reply::Half(b) => { let _ = c.write_all(format!("HTTP/1.1 200 OK\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n", b.len()).as_bytes());
                        let _ = c.write_all(&b[..b.len() / 2]); std::thread::sleep(std::time::Duration::from_secs(20)); }
                }
            });
        });
        Srv { base, hits }
    }
    fn good_server(s: &Synth) -> Srv {
        serve(vec![("manifest.json", Reply::Body(s.manifest.clone(), "application/json")), ("model.onnx", Reply::Body(s.onnx.clone(), "application/octet-stream"))])
    }
    fn dl(srv: &Srv) -> From { From::Download { base: Some(srv.base.clone()) } }
    const SECS: fn(u64) -> std::time::Duration = std::time::Duration::from_secs;
    fn run_it(root: &Path, e: &CheckEntry, from: &From, stall: u64) -> Result<(), String> { install_with(root, e, from, &|_, _| {}, SECS(stall), &|f| Box::new(f)) }
    fn listing(root: &Path) -> Vec<String> {
        fn walk(d: &Path, pre: &str, out: &mut Vec<String>) {
            let mut v: Vec<_> = std::fs::read_dir(d).unwrap().flatten().collect(); v.sort_by_key(|e| e.file_name());
            for e in v { let n = format!("{pre}{}", e.file_name().to_string_lossy()); if e.path().is_dir() { out.push(format!("{n}/")); walk(&e.path(), &format!("{n}/"), out) } else { out.push(n) } }
        }
        let mut o = Vec::new(); walk(root, "", &mut o); o
    }
    fn show(name: &str, r: &Result<(), String>, root: &Path) { println!("{name}: {r:?}; <root> holds {:?}", listing(root)); }
    struct Full;
    impl Write for Full { fn write(&mut self, _: &[u8]) -> std::io::Result<usize> { Err(std::io::Error::from(std::io::ErrorKind::StorageFull)) } fn flush(&mut self) -> std::io::Result<()> { Ok(()) } }

    #[test] fn check_model_install_good() {
        let s = synth(); let srv = good_server(&s); let root = tempfile::tempdir().unwrap();
        let r = run_it(root.path(), &s.entry, &dl(&srv), 5);
        show("good", &r, root.path());
        r.unwrap();
        assert_eq!(listing(root.path()), ["regions/", "regions/installed.json", "regions/manifest.json", "regions/model.onnx"]);
        assert_eq!(check_status(root.path(), &s.entry), "ready");
        assert_eq!(std::fs::read(root.path().join("regions").join("model.onnx")).unwrap(), s.onnx);
        assert_eq!(srv.hits.lock().unwrap().len(), 2, "one request per file");
    }
    #[test] fn check_model_install_wrong_manifest() {
        let s = synth();
        let mut bad = s.manifest.clone(); bad[0] = b' ';                        // one byte changed
        let srv = serve(vec![("manifest.json", Reply::Body(bad, "application/json")), ("model.onnx", Reply::Body(s.onnx.clone(), "application/octet-stream"))]);
        let root = tempfile::tempdir().unwrap();
        let r = run_it(root.path(), &s.entry, &dl(&srv), 5);
        show("wrong manifest", &r, root.path());
        assert_eq!(r.unwrap_err(), MISMATCH);
        assert_eq!(srv.hits.lock().unwrap().len(), 1, "the model was never requested: {:?}", srv.hits.lock().unwrap());
        assert!(listing(root.path()).is_empty());
    }
    #[test] fn check_model_install_wrong_onnx() {
        let s = synth();
        let mut bad = s.onnx.clone(); let k = bad.len() / 2; bad[k] ^= 1;
        let srv = serve(vec![("manifest.json", Reply::Body(s.manifest.clone(), "application/json")), ("model.onnx", Reply::Body(bad, "application/octet-stream"))]);
        let root = tempfile::tempdir().unwrap();
        let r = run_it(root.path(), &s.entry, &dl(&srv), 5);
        show("wrong onnx", &r, root.path());
        assert_eq!(r.unwrap_err(), MISMATCH);
        assert_eq!(srv.hits.lock().unwrap().len(), 2);
        assert!(listing(root.path()).is_empty());
    }
    #[test] fn check_model_install_html_answer() {
        let s = synth();
        let srv = serve(vec![("manifest.json", Reply::Body(b"<html>sign in</html>".to_vec(), "text/html; charset=utf-8"))]);
        let root = tempfile::tempdir().unwrap();
        let r = run_it(root.path(), &s.entry, &dl(&srv), 5);
        show("html answer", &r, root.path());
        assert_eq!(r.unwrap_err(), DOWNLOAD_BLOCKED);
        assert!(listing(root.path()).is_empty());
    }
    #[test] fn check_model_install_stall() {
        let s = synth();
        let srv = serve(vec![("manifest.json", Reply::Body(s.manifest.clone(), "application/json")), ("model.onnx", Reply::Half(s.onnx.clone()))]);
        let root = tempfile::tempdir().unwrap();
        let t = std::time::Instant::now();
        let r = run_it(root.path(), &s.entry, &dl(&srv), 1);
        println!("stall: gave up after {:?}", t.elapsed());
        show("stall", &r, root.path());
        assert!(t.elapsed() < SECS(5), "gave up after {:?}", t.elapsed());
        assert_eq!(r.unwrap_err(), "The download stopped before it finished. Nothing was installed. Try again in Models…");   // M5
        assert!(listing(root.path()).is_empty());
    }
    #[test] fn check_model_install_no_network() {
        let s = synth();
        let closed = { let l = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); l.local_addr().unwrap().port() };   // bound, then closed
        let root = tempfile::tempdir().unwrap();
        let r = run_it(root.path(), &s.entry, &From::Download { base: Some(format!("http://127.0.0.1:{closed}")) }, 5);
        show("no network", &r, root.path());
        assert_eq!(r.unwrap_err(), "No internet connection. Nothing was installed. Try again when you are online, or use Add files…");
        assert!(listing(root.path()).is_empty());
    }
    #[test] fn check_model_install_disk_full() {
        let s = synth(); let srv = good_server(&s); let root = tempfile::tempdir().unwrap();
        let r = install_with(root.path(), &s.entry, &dl(&srv), &|_, _| {}, SECS(5), &|_f| Box::new(Full));
        show("disk full", &r, root.path());
        assert_eq!(r.unwrap_err(), DISK_FULL);
        assert!(listing(root.path()).is_empty());
    }
    #[test] fn check_model_quit_midway_is_swept() {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(root.path().join(DOWNLOAD_WORK)).unwrap();
        std::fs::write(root.path().join(DOWNLOAD_WORK).join("model.onnx"), b"half").unwrap();
        std::fs::create_dir_all(root.path().join("regions")).unwrap();          // control: a real folder stays
        models::sweep(root.path());
        println!("after sweep: {:?}", listing(root.path()));
        assert_eq!(listing(root.path()), ["regions/"]);
    }
    #[test] fn check_model_two_at_once_refused() {
        let s = synth();
        let srv = serve(vec![("manifest.json", Reply::Body(s.manifest.clone(), "application/json")), ("model.onnx", Reply::Half(s.onnx.clone()))]);
        let root = tempfile::tempdir().unwrap();
        let st = Arc::new(ModelsState::default());
        let (st1, r1, e1, from) = (st.clone(), root.path().to_path_buf(), s.entry.clone(), dl(&srv));
        let first = std::thread::spawn(move || { let _slot = begin(&st1)?; run_it(&r1, &e1, &from, 2) });
        while st.stage_of(ID).is_none() { std::thread::sleep(std::time::Duration::from_millis(5)); }
        let second = begin(&st).err().expect("refused while the first holds the place");
        println!("second: {second}");
        assert!(second.contains("already being installed"));
        let r = first.join().unwrap();
        println!("first (unaffected by the refusal): {r:?}");
        assert!(r.unwrap_err().starts_with("The download stopped"), "the first ran its own course");
        begin(&st).unwrap();                                                    // free again afterwards
    }
    #[test] fn check_model_add_files_from_a_folder() {
        let s = synth();
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("manifest.json"), &s.manifest).unwrap();
        std::fs::write(src.path().join("model.onnx"), &s.onnx).unwrap();
        let root = tempfile::tempdir().unwrap();
        let r = run_it(root.path(), &s.entry, &From::Folder(src.path().to_path_buf()), 5);
        show("folder", &r, root.path()); r.unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "ready");
        // a wrong file: refused, nothing left
        let bad = tempfile::tempdir().unwrap();
        std::fs::write(bad.path().join("manifest.json"), &s.manifest).unwrap();
        std::fs::write(bad.path().join("model.onnx"), b"not the model").unwrap();
        let root2 = tempfile::tempdir().unwrap();
        let r = run_it(root2.path(), &s.entry, &From::Folder(bad.path().to_path_buf()), 5);
        show("folder, wrong file", &r, root2.path());
        assert_eq!(r.unwrap_err(), MISMATCH);
        assert!(listing(root2.path()).is_empty());
        // a folder missing a file
        let r = run_it(root2.path(), &s.entry, &From::Folder(tempfile::tempdir().unwrap().path().to_path_buf()), 5);
        show("folder, missing file", &r, root2.path());
        assert!(r.unwrap_err().contains("manifest.json is not in that folder"));
        assert!(listing(root2.path()).is_empty());
    }
    #[test] fn check_model_remove_then_reinstall() {
        let s = synth(); let srv = good_server(&s); let root = tempfile::tempdir().unwrap();
        run_it(root.path(), &s.entry, &dl(&srv), 5).unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "ready");
        remove_check_files(root.path(), &s.entry).unwrap();
        println!("after remove: {:?} {}", listing(root.path()), check_status(root.path(), &s.entry));
        assert_eq!(check_status(root.path(), &s.entry), "not-installed");
        assert!(!root.path().join("regions").exists());
        run_it(root.path(), &s.entry, &dl(&srv), 5).unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "ready");
        // a reinstall over a ready install
        run_it(root.path(), &s.entry, &dl(&srv), 5).unwrap();
        assert_eq!(listing(root.path()), ["regions/", "regions/installed.json", "regions/manifest.json", "regions/model.onnx"]);
    }
    #[test] fn check_model_status_damaged() {
        let s = synth(); let srv = good_server(&s); let root = tempfile::tempdir().unwrap();
        run_it(root.path(), &s.entry, &dl(&srv), 5).unwrap();
        let onnx = root.path().join("regions").join("model.onnx");
        let f = std::fs::OpenOptions::new().write(true).open(&onnx).unwrap(); f.set_len(s.onnx.len() as u64 - 1).unwrap();
        println!("truncated: {}", check_status(root.path(), &s.entry));
        assert_eq!(check_status(root.path(), &s.entry), "damaged");
        // other damage: a changed manifest (a missing installed.json is a hand-placed finder: ready)
        std::fs::write(&onnx, &s.onnx).unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "ready", "control: restored");
        std::fs::remove_file(root.path().join("regions").join("installed.json")).unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "ready", "pinned manifest and a model file, no record: added by hand (I1)");
        std::fs::write(root.path().join("regions").join("installed.json"), format!("{{\"modelBytes\":{}}}", s.onnx.len())).unwrap();
        std::fs::write(root.path().join("regions").join("manifest.json"), b"{}").unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "damaged");
    }
    /// I1 (batch B review): the folder `<models>/regions` may hold files the owner put there by hand. Install, Add files and
    /// Remove touch only model.onnx, manifest.json and installed.json.
    fn put_others(root: &Path) {
        let d = root.join("regions"); std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("calibration.json"), b"SYNTHETIC calibration").unwrap();
        std::fs::write(d.join("notes.txt"), b"SYNTHETIC notes").unwrap();
    }
    fn others_kept(root: &Path) {
        let d = root.join("regions");
        assert_eq!(std::fs::read(d.join("calibration.json")).unwrap(), b"SYNTHETIC calibration");
        assert_eq!(std::fs::read(d.join("notes.txt")).unwrap(), b"SYNTHETIC notes");
    }
    #[test] fn check_model_install_keeps_other_files() {
        let s = synth(); let srv = good_server(&s); let root = tempfile::tempdir().unwrap();
        put_others(root.path());
        run_it(root.path(), &s.entry, &dl(&srv), 5).unwrap();
        println!("install over other files: <root> holds {:?}", listing(root.path()));
        others_kept(root.path());
        assert_eq!(check_status(root.path(), &s.entry), "ready");
        // a reinstall over a ready install, and Add files…, keep them too
        run_it(root.path(), &s.entry, &dl(&srv), 5).unwrap(); others_kept(root.path());
        let src = tempfile::tempdir().unwrap();
        std::fs::write(src.path().join("manifest.json"), &s.manifest).unwrap(); std::fs::write(src.path().join("model.onnx"), &s.onnx).unwrap();
        run_it(root.path(), &s.entry, &From::Folder(src.path().to_path_buf()), 5).unwrap(); others_kept(root.path());
        assert_eq!(listing(root.path()), ["regions/", "regions/calibration.json", "regions/installed.json", "regions/manifest.json", "regions/model.onnx", "regions/notes.txt"]);
        // Add files… taken FROM the same folder it installs into leaves that folder's other files in place
        run_it(root.path(), &s.entry, &From::Folder(root.path().join("regions")), 5).unwrap(); others_kept(root.path());
    }
    #[test] fn check_model_remove_keeps_other_files() {
        let s = synth(); let srv = good_server(&s); let root = tempfile::tempdir().unwrap();
        put_others(root.path());
        run_it(root.path(), &s.entry, &dl(&srv), 5).unwrap();
        remove_check_files(root.path(), &s.entry).unwrap();
        println!("remove with other files: <root> holds {:?}", listing(root.path()));
        others_kept(root.path());
        assert_eq!(listing(root.path()), ["regions/", "regions/calibration.json", "regions/notes.txt"]);
        assert_eq!(check_status(root.path(), &s.entry), "not-installed");
        // with nothing else in the folder, the folder goes too; removing again is fine
        let root2 = tempfile::tempdir().unwrap();
        run_it(root2.path(), &s.entry, &dl(&srv), 5).unwrap();
        remove_check_files(root2.path(), &s.entry).unwrap();
        assert!(!root2.path().join("regions").exists(), "an empty folder is removed: {:?}", listing(root2.path()));
        remove_check_files(root2.path(), &s.entry).unwrap();
    }
    #[test] fn check_model_a_pinned_finder_placed_by_hand_reads_ready() {
        let s = synth(); let root = tempfile::tempdir().unwrap();
        let d = root.path().join("regions"); std::fs::create_dir_all(&d).unwrap();
        std::fs::write(d.join("manifest.json"), &s.manifest).unwrap(); std::fs::write(d.join("model.onnx"), &s.onnx).unwrap();   // no installed.json
        println!("by hand: {} by_hand={}", check_status(root.path(), &s.entry), added_by_hand(root.path(), &s.entry));
        assert_eq!(check_status(root.path(), &s.entry), "ready");
        assert!(added_by_hand(root.path(), &s.entry));
        // control: a manifest that is not the pinned one is still damaged, and an installed.json that disagrees with the size too
        std::fs::write(d.join("manifest.json"), b"{}").unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "damaged");
        std::fs::write(d.join("manifest.json"), &s.manifest).unwrap();
        std::fs::write(d.join("installed.json"), format!("{{\"modelBytes\":{}}}", s.onnx.len() + 1)).unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "damaged");
        assert!(!added_by_hand(root.path(), &s.entry), "a recorded install is not by hand");
        // a hand-placed manifest with no model file at all is damaged
        std::fs::remove_file(d.join("installed.json")).unwrap(); std::fs::remove_file(d.join("model.onnx")).unwrap();
        assert_eq!(check_status(root.path(), &s.entry), "damaged");
    }
    #[test] fn the_question_is_asked_only_without_a_finder_and_only_once() {
        assert!(should_ask(false, None, true), "new user or update from 1.2: ask");
        assert!(!should_ask(false, Some("1"), true), "asked before: never again");
        assert!(!should_ask(true, None, true), "a finder already found: never");
        assert!(!should_ask(false, None, false), "check switched off: not now (Q2 A)");
        assert!(should_ask(false, Some(""), true), "a blank value is not an answer");
        assert!(should_ask(false, Some("0"), true), "only \"1\" is an answer");
    }
    /// Edge: the library not yet open (or locked, or read-only) cannot say whether the check is on: no question, logged,
    /// and the next open asks again because nothing was stored.
    #[test] fn a_library_that_cannot_be_read_gives_no_question() {
        assert!(!decide(false, None, Err("the library is not open yet".into())));
        assert!(decide(false, None, Ok(true)), "control: the same inputs with a readable library ask");
        assert!(!decide(false, None, Ok(false)));
        assert!(!decide(true, None, Ok(true)));
    }
    #[test] fn the_asked_key_is_the_one_the_plan_names() { assert_eq!(ASKED_KEY, "check_model_asked"); }
    #[test] fn the_row_says_failed_only_when_not_ready() {
        assert_eq!(row_status("ready", false, true), "ready");
        assert_eq!(row_status("damaged", false, false), "damaged");
        assert_eq!(row_status("not-installed", false, true), "failed");
        assert_eq!(row_status("ready", true, true), "installing");
    }
}
