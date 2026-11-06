use std::path::PathBuf;

/// Where to look for the model, in priority order: $CEPHTRACE_MODEL_DIR, the folder last chosen with "Locate model…"
/// (remembered in settings), the app data dir's `models/`, and (dev builds) the repo's `models/`.
pub fn candidates(env: Option<PathBuf>, remembered: Option<PathBuf>, app_models: Option<PathBuf>, dev: Option<PathBuf>) -> Vec<Option<PathBuf>> {
    vec![env, remembered, app_models, dev]
}

/// First candidate directory that holds a `manifest.json`. Model weights are never bundled with the app (decision 2):
/// the caller passes, in order, $CEPHTRACE_MODEL_DIR, the app data dir's `models/`, and (dev builds) the repo's `models/`.
pub fn find_manifest(candidates: &[Option<PathBuf>]) -> Option<PathBuf> {
    candidates.iter().flatten().map(|d| d.join("manifest.json")).find(|m| m.is_file())
}

/// First candidate directory that holds the point check's tracings file (`shape/ceph400-v1.shape`, joins only).
pub fn find_shape_prior(candidates: &[Option<PathBuf>]) -> Option<PathBuf> {
    candidates.iter().flatten().map(|d| ceph_model::pointcheck::prior_path(d)).find(|p| p.is_file())
}

/// First candidate directory that holds the whole-film check's shape reference (`shape/whole-film-reference-v1.shape`,
/// joins only). Stage A's `ceph400-v1.shape` is never taken in its place.
pub fn find_whole_film_reference(candidates: &[Option<PathBuf>]) -> Option<PathBuf> {
    candidates.iter().flatten().map(|d| ceph_model::wholefilm::reference_path(d)).find(|p| p.is_file())
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
    #[test] fn nothing_found_is_none() {
        let a = tmp("empty");
        assert_eq!(find_manifest(&[Some(a.clone()), None]), None);
        std::fs::remove_dir_all(a).ok();
    }
}
