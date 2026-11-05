//! What the window may read through the asset protocol (`tauri.conf.json` › `app.security.assetProtocol.scope`).
//!
//! The window turns a path into a picture URL in exactly three places (`convertFileSrc`): the open film
//! (`library/useCase.ts`), the film in the fit panel (`compare/useFitPanel.ts`) and the Library cards' thumbnails
//! (`library/LibraryView.tsx`). All three paths come from the library, which lives in the app's data folder:
//! `images/<sha>.<ext>` and `thumbs/<sha>.jpg`. Importing copies the film there first (Rust reads the chosen file;
//! the window never does), so nothing else needs to be readable.
//!
//! These checks build a mock app from the real `tauri.conf.json` (`generate_context!`) and ask the same scope
//! object the asset protocol asks (`Manager::asset_protocol_scope`, Tauri's `protocol/asset.rs`) about real files
//! written by the real library. HOME is a fresh temporary folder, so the app-data folder is temporary too and the
//! real library is never touched (checked before anything is written). Synthetic grey images only.
//!
//! What this cannot show: the WebKit side (URL encoding, the CSP) — the owner's try-list.

use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use tauri::Manager;

/// The scope the app is meant to have, exactly. A wider entry (`$HOME/**`, `$APPDATA/**`, a new folder) must come
/// with a reason, a change here, and a line in the security review.
const EXPECTED_SCOPE: [&str; 2] = ["$APPDATA/images/*", "$APPDATA/thumbs/*"];

/// A temporary HOME for the whole test binary, set once before any app resolves a path.
fn home() -> &'static Path {
    static HOME: OnceLock<tempfile::TempDir> = OnceLock::new();
    HOME.get_or_init(|| {
        let t = tempfile::tempdir().unwrap();
        std::env::set_var("HOME", t.path());
        t
    })
    .path()
}

/// The app's data folder (where the library lives) and its asset scope, from the real config.
fn app() -> (tauri::App<tauri::test::MockRuntime>, PathBuf) {
    let home = home();
    let app = tauri::test::mock_builder().build(tauri::generate_context!()).unwrap();
    let data = app.path().app_data_dir().unwrap();
    // Never the real library: the data folder must sit inside the temporary HOME before anything is written.
    assert!(data.starts_with(home), "app data dir {} is outside the temporary HOME {}", data.display(), home.display());
    (app, data)
}

/// A small synthetic grey film (no patient data).
fn synthetic_png(dir: &Path, name: &str, shade: u8) -> PathBuf {
    let p = dir.join(name);
    image::GrayImage::from_pixel(64, 48, image::Luma([shade])).save(&p).unwrap();
    p
}

/// Imports a synthetic film into the library in `data` and returns (film path, thumbnail path) as the window gets them.
fn imported(data: &Path, shade: u8) -> (String, String) {
    static ONE_AT_A_TIME: std::sync::Mutex<()> = std::sync::Mutex::new(());   // the tests share one library file
    let _g = ONE_AT_A_TIME.lock().unwrap_or_else(|e| e.into_inner());
    let src_dir = tempfile::tempdir_in(home()).unwrap();
    let src = synthetic_png(src_dir.path(), "SYNTHETIC.png", shade);
    let mut lib = ceph_store::Library::open(data).unwrap();
    let case = lib.import(&src).unwrap().case_id;
    let film = lib.load(&case).unwrap().image.path;
    let thumb = lib.list(false).unwrap().into_iter().find(|c| c.id == case).unwrap().thumb_path;
    (film, thumb)
}

#[test]
fn the_library_film_and_its_thumbnail_are_readable() {
    let (app, data) = app();
    let (film, thumb) = imported(&data, 120);
    assert!(Path::new(&film).is_file() && Path::new(&thumb).is_file(), "the library did not write {film} / {thumb}");
    let scope = app.asset_protocol_scope();
    assert!(scope.is_allowed(&film), "the open film {film} must load (useCase.ts, useFitPanel.ts)");
    assert!(scope.is_allowed(&thumb), "the Library card thumbnail {thumb} must load (LibraryView.tsx)");
}

#[test]
fn nothing_else_in_the_app_data_folder_is_readable() {
    let (app, data) = app();
    imported(&data, 140);
    let models = data.join("models").join("some-model");
    std::fs::create_dir_all(&models).unwrap();
    std::fs::write(models.join("weights.onnx"), b"not a model").unwrap();
    let scope = app.asset_protocol_scope();
    for p in [
        data.join("library.sqlite3"),                                  // every patient's details
        models.join("weights.onnx"),                                   // installed models
        data.join("images").join("..").join("library.sqlite3"),        // a way back up from an allowed folder
        data.join("images").join("nested").join("x.png"),              // one level deeper than the films
    ] {
        assert!(!scope.is_allowed(&p), "{} must not be readable by the window", p.display());
    }
}

#[test]
fn files_elsewhere_in_the_home_folder_are_not_readable() {
    let (app, _data) = app();
    let docs = home().join("Documents");
    std::fs::create_dir_all(&docs).unwrap();
    let doc_film = synthetic_png(&docs, "film.png", 90);
    let top = synthetic_png(home(), "film.png", 91);
    std::fs::create_dir_all(home().join(".ssh")).unwrap();
    std::fs::write(home().join(".ssh").join("id"), b"x").unwrap();
    let scope = app.asset_protocol_scope();
    for p in [doc_film, top, home().join(".ssh").join("id"), home().join("Desktop").join("missing.png")] {
        assert!(!scope.is_allowed(&p), "{} is outside the library and must not be readable by the window", p.display());
    }
}

#[cfg(unix)]
#[test]
fn a_link_inside_the_film_folder_cannot_reach_out() {
    let (app, data) = app();
    imported(&data, 160);
    let secret = synthetic_png(home(), "outside.png", 30);
    let link = data.join("images").join("link.png");
    std::os::unix::fs::symlink(&secret, &link).unwrap();
    assert!(!app.asset_protocol_scope().is_allowed(&link), "a link in images/ to {} must not be followed", secret.display());
}

#[test]
fn the_configured_scope_is_exactly_the_two_library_image_folders() {
    let conf: serde_json::Value =
        serde_json::from_str(&std::fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("tauri.conf.json")).unwrap()).unwrap();
    let scope = &conf["app"]["security"]["assetProtocol"]["scope"];
    let got: Vec<&str> = scope.as_array().unwrap_or_else(|| panic!("scope is not a plain list: {scope}")).iter().map(|v| v.as_str().unwrap()).collect();
    for e in &got {
        assert!(!e.starts_with("$HOME"), "the asset scope names the home folder again: {e}");
        assert!(!e.contains("**"), "the asset scope has a recursive wildcard: {e}");
    }
    assert_eq!(got, EXPECTED_SCOPE, "the asset scope changed; widen it only with a reason (see this file's header)");
}

/// The three places listed in this file's header are the only ones that hand the window a file path as a picture.
/// A new one must be checked against the scope above (it fails to load if its file is outside the library folders).
#[test]
fn the_window_turns_paths_into_pictures_only_in_the_three_known_places() {
    fn walk(root: &Path, dir: &Path, out: &mut Vec<(String, usize)>) {
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            let name = p.file_name().unwrap().to_string_lossy().to_string();
            if p.is_dir() {
                // Build output, never source: a bundler can write a nested dist/build folder full of generated
                // .js that would otherwise look like a fourth place to the scan below.
                if name == "dist" || name == "build" || name == "node_modules" { continue; }
                walk(root, &p, out);
                continue;
            }
            let is_scanned_ext = name.ends_with(".ts") || name.ends_with(".tsx") || name.ends_with(".js")
                || name.ends_with(".jsx") || name.ends_with(".mjs") || name.ends_with(".cjs");
            if !is_scanned_ext || name.contains(".test.") { continue; }
            let n = std::fs::read_to_string(&p).unwrap().matches("convertFileSrc(").count();
            if n > 0 { out.push((p.strip_prefix(root).unwrap().to_string_lossy().replace('\\', "/"), n)); }
        }
    }
    let src = Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("src");
    let mut found = Vec::new();
    walk(&src, &src, &mut found);
    found.sort();
    assert_eq!(found, vec![
        ("compare/useFitPanel.ts".to_string(), 1),
        ("library/LibraryView.tsx".to_string(), 1),
        ("library/useCase.ts".to_string(), 1),
    ], "a new place loads a file as a picture: check its folder is inside the asset scope (tauri.conf.json)");
}
