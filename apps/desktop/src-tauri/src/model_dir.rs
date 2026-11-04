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
    #[test] fn nothing_found_is_none() {
        let a = tmp("empty");
        assert_eq!(find_manifest(&[Some(a.clone()), None]), None);
        std::fs::remove_dir_all(a).ok();
    }
}
