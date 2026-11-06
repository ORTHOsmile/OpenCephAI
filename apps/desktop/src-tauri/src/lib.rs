#[cfg(test)] mod crosscheck; // the coverage table is checked by tests; the app does not call the rule (owner PARK-FLAGS, 15 Oct)
mod best;
mod auto_best;
mod export;
mod files;
mod learning;
mod library;
mod model_dir;
mod models;
mod point_check;
mod system_font;
mod weights_check;
mod whole_film;
mod window_chrome;

use ceph_infer::engine::{load_gray, mean_peak, AutoDetection, Engine};
use serde::Serialize;
use std::{path::PathBuf, sync::{Arc, Mutex}};
use tauri::Manager;

#[derive(Default)]
struct AppState { engine: Mutex<Option<Arc<Engine>>>, searched: Mutex<Vec<String>> }

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ModelStatus { loaded: bool, model_id: Option<String>, searched: Vec<String>, error: Option<String> }

/// Candidate model folders, in priority order (see model_dir::find_manifest).
fn candidates(app: &tauri::AppHandle) -> Vec<Option<PathBuf>> {
    model_dir::candidates(
        std::env::var_os("CEPHTRACE_MODEL_DIR").map(PathBuf::from),
        library::setting(app, library::MODEL_DIR_KEY).map(PathBuf::from),
        app.path().app_data_dir().ok().map(|d| d.join("models")),
        cfg!(debug_assertions).then(|| PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../models")),
    )
}

/// The whole-film check's folders: the user's own (as `candidates`), then the check's files inside the app
/// (`<resources>/resources/check`, through Tauri's resource API; owner, 6 Nov 2026). The landmark model's search is
/// unchanged: the bundled folder is never offered to it.
fn whole_film_candidates(app: &tauri::AppHandle) -> Vec<Option<PathBuf>> {
    model_dir::with_bundled(candidates(app), app.path().resource_dir().ok().map(|d| model_dir::bundled_check_dir(&d)))
}

fn load(manifest: PathBuf) -> Result<Arc<Engine>, String> {
    Engine::load(&manifest).map(Arc::new).map_err(|e| format!("could not load {}: {e:#}", manifest.display()))
}

/// Loads the engine on first use from the first folder that holds a manifest.
async fn engine(app: &tauri::AppHandle) -> Result<Arc<Engine>, String> {
    if let Some(id) = models::main_id(app) { return models::engine_for(app, &id).await; }   // the Model Manager's main model
    let st = app.state::<AppState>();
    if let Some(e) = st.engine.lock().unwrap().clone() { return Ok(e); }
    let cands = candidates(app);
    *st.searched.lock().unwrap() = cands.iter().flatten().map(|d| d.display().to_string()).collect();
    let manifest = model_dir::find_manifest(&cands).ok_or_else(|| "MODEL_NOT_FOUND".to_string())?;
    let e = tauri::async_runtime::spawn_blocking(move || load(manifest)).await.map_err(|e| e.to_string())??;
    *st.engine.lock().unwrap() = Some(e.clone());
    Ok(e)
}

/// facing: "left" / "right" runs that orientation only; None detects the facing automatically (two passes).
#[tauri::command]
async fn detect_landmarks(app: tauri::AppHandle, path: String, facing: Option<String>) -> Result<AutoDetection, String> {
    let engine = engine(&app).await?;
    tauri::async_runtime::spawn_blocking(move || -> anyhow::Result<AutoDetection> {
        let img = load_gray(std::path::Path::new(&path))?;
        match facing.as_deref() {
            None => engine.detect_auto(&img),
            Some(f @ ("left" | "right")) => {
                let left = f == "left";
                let d = engine.detect(&img, left)?;
                let c = Some(mean_peak(&d));
                Ok(AutoDetection { detection: d, facing_left: left, mean_peak_right: if left { None } else { c }, mean_peak_left: if left { c } else { None } })
            }
            Some(other) => anyhow::bail!("facing must be left or right, not {other:?}"),
        }
    }).await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))
}

#[tauri::command]
async fn model_status(app: tauri::AppHandle) -> ModelStatus {
    let r = engine(&app).await;
    let searched = app.state::<AppState>().searched.lock().unwrap().clone();
    match r {
        Ok(e) => ModelStatus { loaded: true, model_id: Some(e.manifest().id.clone()), searched, error: None },
        Err(err) => ModelStatus { loaded: false, model_id: None, searched, error: Some(err) },
    }
}

/// Owner ruling Q1 (2 Nov 2026): the tracing always uses the Models… model while one is Ready (`engine()` above), so a folder
/// picked then would load and be remembered but never be used. It is refused, in plain words, and nothing is written.
pub const MODEL_DIR_NOT_USED: &str = "This folder isn't used while a model installed in Models… is ready. OpenCephAI uses the Models… model to trace. To use a folder instead, remove the installed models first.";
fn model_dir_allowed(any_ready: bool) -> Result<(), &'static str> { if any_ready { Err(MODEL_DIR_NOT_USED) } else { Ok(()) } }

/// "Locate model…": load from a folder the user picked; it must contain manifest.json and the model it names.
#[tauri::command]
async fn set_model_dir(app: tauri::AppHandle, dir: String) -> Result<String, String> {
    model_dir_allowed(models::main_id(&app).is_some()).map_err(String::from)?;   // main_id is Some exactly when a Models… model is Ready
    let manifest = model_dir::find_manifest(&[Some(PathBuf::from(&dir))]).ok_or_else(|| format!("no manifest.json in {dir}"))?;
    let e = tauri::async_runtime::spawn_blocking(move || load(manifest)).await.map_err(|e| e.to_string())??;
    let id = e.manifest().id.clone();
    *app.state::<AppState>().engine.lock().unwrap() = Some(e);
    library::set_setting(&app, library::MODEL_DIR_KEY, &dir);               // remembered for the next launch
    Ok(id)
}

/// Set once the app is on its way out, so a close or exit is never held twice.
static QUITTING: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);
const QUIT_EVENT: &str = "cephtrace://quit-requested";
const QUIT_BACKSTOP: std::time::Duration = std::time::Duration::from_secs(6);

/// Whether to hold an exit request: a user quit (no exit code) is held until the web view has written the last edit
/// (review #2); an exit we requested ourselves (with a code) goes through.
fn holds_exit(quitting: bool, code: Option<i32>) -> bool { !quitting && code.is_none() }

/// Ask the web view to save and quit; if it never answers, quit anyway so the app can always be closed.
fn request_quit(app: &tauri::AppHandle) {
    use tauri::Emitter;
    if app.emit(QUIT_EVENT, ()).is_err() { quit(app); return; }
    let app = app.clone();
    std::thread::spawn(move || { std::thread::sleep(QUIT_BACKSTOP); quit(&app); });
}
fn quit(app: &tauri::AppHandle) {
    QUITTING.store(true, std::sync::atomic::Ordering::SeqCst);
    app.exit(0);
}

/// Called by the web view once its last edit is on disk.
#[tauri::command]
fn quit_now(app: tauri::AppHandle) { quit(&app); }

/// Quit on the upgrade notice (owner, 6 Nov 2026): no library has been opened, so there is nothing to save and nothing is touched.
#[tauri::command]
fn library_upgrade_quit(app: tauri::AppHandle) { quit(&app); }

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let check = window_chrome::check_mode(std::env::args());
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .manage(library::LibState::default())
        .manage(library::FilmTexts::default())
        .manage(models::ModelsState::default())
        .manage(weights_check::Running::default())
        .manage(point_check::PointCheckState::default())
        .manage(whole_film::WholeFilmState::default())
        .setup(move |app| {
            // --check-window-chrome: never near a real library. Say where app data would go and refuse a real home,
            // before any window exists; the check's window shows a blank page and nothing below it runs.
            if check.is_some() {
                let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
                println!("window-chrome: app_data_dir={}", dir.display());
                if let Some(why) = window_chrome::refuse_dir(&dir) { eprintln!("window-chrome: refused: {why}"); window_chrome::finish(2); }
            }
            // The main window is made here, not from tauri.conf.json, so its button position fits this Mac's macOS.
            let (win, _geometry, _y) = window_chrome::create_main(app, check.as_ref())?;
            #[cfg(target_os = "macos")]
            {
                use window_vibrancy::{apply_vibrancy, NSVisualEffectMaterial};
                apply_vibrancy(&win, NSVisualEffectMaterial::Sidebar, None, None).ok();   // cosmetic: never fatal
            }
            if check.is_some() {
                #[cfg(target_os = "macos")]
                window_chrome::start_check(win, _geometry, _y);
                #[cfg(not(target_os = "macos"))]
                { eprintln!("window-chrome: the check is for macOS only"); window_chrome::finish(2); }
                return Ok(());
            }
            let _ = win;
            if let Ok(r) = models::root(app.handle()) { models::sweep(&r); }   // an install interrupted by quitting
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            detect_landmarks, model_status, set_model_dir, quit_now,
            library::library_list, library::library_import, library::library_open, library::library_point_files, library::library_save, library::library_save_ai_if_untraced, library::library_record_ai,
            library::library_set_meta, library::library_set_patient_gender, library::library_set_patient_background, library::library_set_patient_referrer, library::library_set_patient_id, library::library_set_film_detail, library::library_set_patient_title, library::library_set_film_age, library::library_not_same_patient, library::library_accept_learned, library::library_read_label, library::library_label_text, library::library_read_area, library::library_learn_selection, library::library_learn_value, library::library_machines, library::library_rename_machine, library::library_reset_machine, library::library_delete_machine, library::library_machine_scale_from_film, library::library_machine_scale_change, library::library_set_machine_scale, library::library_machine_delete_change, library::library_confirm_identity, library::library_confirm_film_date, library::library_series, library::library_set_stage, library::library_set_in_series, library::library_save_fit, library::library_clear_fit, library::library_set_fit_own,
            library::library_set_verified, library::library_calibrate, library::library_delete,
            library::library_restore, library::library_backup, library::library_restore_backup, library::library_upgrade_copy,
            library::library_upgrade_pending, library::library_upgrade_confirm, library_upgrade_quit,
            library::settings_get, library::settings_set, library::library_ghosts,
            library::library_ruler,
            library::library_recalibrate,
            library::library_set_case_population, library::library_user_norms, library::library_save_user_norm, library::library_delete_user_norm,
            library::settings_default_population_get, library::settings_default_population_set, library::settings_auto_switch_note, library::settings_auto_switch_note_dismiss,
            library::operators_list, library::operators_add, library::operators_set_current,
            files::text_file_write, files::text_file_read,
            models::models_list, models::models_accept_licence, models::models_install, models::models_add_file,
            models::models_remove, models::models_set_main, models::detect_extras, models::models_points, models::models_main_point_source,
            best::models_best_per_point, best::models_point_choice,
            auto_best::models_auto_best, auto_best::models_auto_best_sync, auto_best::models_auto_best_undo, auto_best::models_auto_best_redo,
            auto_best::models_auto_best_intro, auto_best::models_auto_best_way_back, auto_best::models_auto_best_set_base,
            weights_check::models_weights_check_run,
            export::export_write,
            point_check::point_checks_for_case, point_check::point_check_film_checked, point_check::point_check_counts,
            whole_film::whole_film_check, whole_film::whole_film_check_resolve, whole_film::whole_film_status, whole_film::whole_film_switch, whole_film::whole_film_switch_set,
            system_font::system_font_list, system_font::system_font_read,
        ])
        .build(tauri::generate_context!())
        .expect("error while building OpenCephAI")
        .run(|app, event| {
            use std::sync::atomic::Ordering::SeqCst;
            match event {
                tauri::RunEvent::WindowEvent { event: tauri::WindowEvent::CloseRequested { api, .. }, .. } if !QUITTING.load(SeqCst) => {
                    api.prevent_close(); request_quit(app);
                }
                tauri::RunEvent::ExitRequested { code, api, .. } if holds_exit(QUITTING.load(SeqCst), code) => {
                    api.prevent_exit(); request_quit(app);
                }
                _ => {}
            }
        });
}

#[cfg(test)]
mod quit_tests {
    use super::holds_exit;
    #[test] fn a_user_quit_is_held_until_the_web_view_has_saved_but_our_own_exit_is_not() {
        assert!(holds_exit(false, None));          // ⌘Q / last window closed: hold, ask the web view to save
        assert!(!holds_exit(false, Some(0)));      // app.exit(0) from quit_now or the backstop: let it through
        assert!(!holds_exit(true, None));          // already saving on the way out: never hold twice
    }
}

#[cfg(test)]
mod model_dir_tests {
    use super::*;
    #[test] fn a_ready_models_model_refuses_the_folder_and_says_why() {
        assert_eq!(model_dir_allowed(true), Err(MODEL_DIR_NOT_USED));
        assert!(MODEL_DIR_NOT_USED.contains("isn't used") && MODEL_DIR_NOT_USED.contains("uses the Models… model to trace"));
    }
    #[test] fn with_no_ready_model_the_folder_is_allowed_as_before() { assert_eq!(model_dir_allowed(false), Ok(())); }
}
