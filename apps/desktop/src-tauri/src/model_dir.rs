use std::path::PathBuf;

/// Where to look for the model, in priority order: $CEPHTRACE_MODEL_DIR, the folder last chosen with "Locate model…"
/// (remembered in settings), the app data dir's `models/`, and (dev builds) the repo's `models/`.
pub fn candidates(env: Option<PathBuf>, remembered: Option<PathBuf>, app_models: Option<PathBuf>, dev: Option<PathBuf>) -> Vec<Option<PathBuf>> {
    vec![env, remembered, app_models, dev]
}

/// The whole-film check's own files that come inside the app (owner, 6 Nov 2026): `<resources>/resources/check`, laid out
/// as a models folder (`regions/` and `shape/`). `resources` is the app's resource folder from Tauri's resource API
/// (`app.path().resource_dir()`), never a fixed path (Windows-ready; joins only).
pub fn bundled_check_dir(resources: &std::path::Path) -> PathBuf { resources.join("resources").join("check") }

/// The whole-film check's folders: the user's own first (so a file the user installed still wins), then the bundled one.
pub fn with_bundled(mut candidates: Vec<Option<PathBuf>>, bundled: Option<PathBuf>) -> Vec<Option<PathBuf>> {
    candidates.push(bundled);
    candidates
}

/// First candidate directory that holds a `manifest.json`. Landmark model weights are never bundled with the app (decision 2):
/// the caller passes, in order, $CEPHTRACE_MODEL_DIR, the app data dir's `models/`, and (dev builds) the repo's `models/`.
pub fn find_manifest(candidates: &[Option<PathBuf>]) -> Option<PathBuf> {
    candidates.iter().flatten().map(|d| d.join("manifest.json")).find(|m| m.is_file())
}

/// First candidate directory that holds the point check's tracings file (`shape/ceph400-v1.shape`, joins only).
pub fn find_shape_prior(candidates: &[Option<PathBuf>]) -> Option<PathBuf> {
    candidates.iter().flatten().map(|d| ceph_model::pointcheck::prior_path(d)).find(|p| p.is_file())
}

/// First candidate directory that holds the region finder (`regions/manifest.json`, joins only).
pub fn find_regions(candidates: &[Option<PathBuf>]) -> Option<PathBuf> {
    candidates.iter().flatten().map(|d| ceph_infer::regions::regions_manifest_path(d)).find(|p| p.is_file())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("cephtrace-model-dir-{tag}-{}", std::process::id()));
        std::fs::create_dir_all(&d).unwrap(); d
    }
    #[test] fn first_candidate_holding_a_manifest_wins() {
        let (a, b, c) = (tmp("a"), tmp("b"), tmp("c"));
        std::fs::write(b.join("manifest.json"), "{}").unwrap();
        std::fs::write(c.join("manifest.json"), "{}").unwrap();
        assert_eq!(find_manifest(&[Some(a.clone()), None, Some(b.clone()), Some(c.clone())]), Some(b.join("manifest.json")));
        for d in [a, b, c] { std::fs::remove_dir_all(d).ok(); }
    }
    #[test] fn the_folder_chosen_with_locate_model_is_remembered_after_the_env_override() {
        let (env, chosen, appdata) = (tmp("env"), tmp("chosen"), tmp("appdata"));
        let order = candidates(Some(env.clone()), Some(chosen.clone()), Some(appdata.clone()), None);
        assert_eq!(order, vec![Some(env.clone()), Some(chosen.clone()), Some(appdata.clone()), None]);
        std::fs::write(chosen.join("manifest.json"), "{}").unwrap();
        std::fs::write(appdata.join("manifest.json"), "{}").unwrap();
        assert_eq!(find_manifest(&order), Some(chosen.join("manifest.json")));      // remembered beats the default folder
        std::fs::remove_dir_all(&chosen).ok();                                        // moved or deleted since: fall back
        assert_eq!(find_manifest(&order), Some(appdata.join("manifest.json")));
        for d in [env, appdata] { std::fs::remove_dir_all(d).ok(); }
    }
    /// Task 5: the point check's tracings file is found like the manifest: the first candidate folder that holds
    /// `shape/ceph400-v1.shape`. Fails if a folder without the file were taken, or the order ignored.
    #[test] fn the_first_folder_holding_the_tracings_file_wins() {
        let (a, b, c) = (tmp("shape-a"), tmp("shape-b"), tmp("shape-c"));
        for d in [&b, &c] { let p = ceph_model::pointcheck::prior_path(d); std::fs::create_dir_all(p.parent().unwrap()).unwrap(); std::fs::write(&p, "x").unwrap(); }
        std::fs::write(a.join("manifest.json"), "{}").unwrap();                       // a model folder without the file
        assert_eq!(find_shape_prior(&[None, Some(a.clone()), Some(b.clone()), Some(c.clone())]), Some(ceph_model::pointcheck::prior_path(&b)));
        assert_eq!(find_shape_prior(&[Some(a.clone())]), None);
        for d in [a, b, c] { std::fs::remove_dir_all(d).ok(); }
    }
    /// Task 7: the region finder is found like the tracings file: the first candidate folder that holds
    /// `regions/manifest.json` (joins only). Fails if a folder without it were taken, or the order ignored.
    #[test] fn the_first_folder_holding_the_region_finder_wins() {
        let (a, b, c) = (tmp("regions-a"), tmp("regions-b"), tmp("regions-c"));
        for d in [&b, &c] { let p = ceph_infer::regions::regions_manifest_path(d); std::fs::create_dir_all(p.parent().unwrap()).unwrap(); std::fs::write(&p, "{}").unwrap(); }
        std::fs::write(a.join("manifest.json"), "{}").unwrap();                       // a landmark model's folder, no region finder
        assert_eq!(find_regions(&[None, Some(a.clone()), Some(b.clone()), Some(c.clone())]), Some(ceph_infer::regions::regions_manifest_path(&b)));
        assert_eq!(find_regions(&[Some(a.clone())]), None);
        for d in [a, b, c] { std::fs::remove_dir_all(d).ok(); }
    }
    /// The check's bundled folder is looked in LAST, after every folder of the user's own (env, remembered, app data,
    /// dev), and sits at <resources>/resources/check (joins only). Fails if it is put first, or the path is spelt with `/`.
    #[test] fn the_bundled_check_folder_comes_after_the_users_own() {
        let order = with_bundled(candidates(Some("e".into()), Some("r".into()), Some("a".into()), None), Some("b".into()));
        assert_eq!(order, vec![Some(PathBuf::from("e")), Some("r".into()), Some("a".into()), None, Some("b".into())]);
        assert_eq!(bundled_check_dir(std::path::Path::new("res")), PathBuf::from("res").join("resources").join("check"));
    }
    #[test] fn nothing_found_is_none() {
        let a = tmp("empty");
        assert_eq!(find_manifest(&[Some(a.clone()), None]), None);
        std::fs::remove_dir_all(a).ok();
    }
    /// 1.2.1: the app carries the check's four small files only. A finder left in resources/check/regions (every Mac that
    /// built 1.2.0 still has one, git-ignored) would be bundled again by `resources/check/**/*`. Fails while it is there.
    #[test] fn the_resources_hold_only_the_four_small_files() {
        let b = bundled_check_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR")));
        let names = |d: PathBuf| { let mut v: Vec<String> = std::fs::read_dir(&d).unwrap_or_else(|e| panic!("{}: {e}", d.display())).flatten().map(|e| e.file_name().to_string_lossy().into_owned()).filter(|n| !n.starts_with('.')).collect(); v.sort(); v };   // a macOS .DS_Store is not a model file
        assert_eq!(names(b.join("regions")), ["calibration.json", "cb-centre-calibration.json", "size-calibration.json"], "{}: remove model.onnx and manifest.json", b.display());
        assert_eq!(names(b.join("shape")), ["whole-film-reference-v1.shape"]);
    }
}
