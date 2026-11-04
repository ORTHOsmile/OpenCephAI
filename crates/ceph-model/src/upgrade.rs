//! Task 5 (spec 2026-10-01 Part B): switch on a model's newly-named channels in an already-installed manifest
//! without ever moving a point that was already named. The catalogue can grow a `landmarkMap` (fill in `null`
//! channels with new names) and bump `version`; an installed model picks that up in place, on the next read.
use serde_json::Value;
use std::path::Path;

/// Why an installed manifest was left as it was.
#[derive(Debug)]
pub enum UpgradeError {
    /// The catalogue entry is for a different model id than the one installed.
    DifferentModel,
    /// The catalogue's `landmarkMap` has a different number of channels than the installed one.
    ChannelCount,
    /// Channel `channel` is already named `from`; the catalogue would rename or un-name it to `to`. Refused: the
    /// first 19 (or any already-named point) never move.
    WouldMove { channel: usize, from: String, to: Option<String> },
}
impl std::fmt::Display for UpgradeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DifferentModel => write!(f, "the catalogue entry is for a different model"),
            Self::ChannelCount => write!(f, "the catalogue's channel count does not match the installed model"),
            Self::WouldMove { channel, from, to } => write!(f, "channel {channel} is named {from:?}; the catalogue would change it to {to:?}"),
        }
    }
}
impl std::error::Error for UpgradeError {}

/// `installed` and `catalogue` are manifest-shaped `serde_json::Value`s (only `id`, `version` and `landmarkMap` are
/// read). Returns the new installed manifest (every other key of `installed` kept as-is) when something changed, or
/// `Ok(None)` when the installed manifest already has the catalogue's map and version.
pub fn upgrade_map(installed: &Value, catalogue: &Value) -> Result<Option<Value>, UpgradeError> {
    let (old_id, new_id) = (installed["id"].as_str().unwrap_or_default(), catalogue["id"].as_str().unwrap_or_default());
    if old_id != new_id { return Err(UpgradeError::DifferentModel); }
    let old_map: Vec<Option<String>> = serde_json::from_value(installed["landmarkMap"].clone()).unwrap_or_default();
    let new_map: Vec<Option<String>> = serde_json::from_value(catalogue["landmarkMap"].clone()).unwrap_or_default();
    if old_map.len() != new_map.len() { return Err(UpgradeError::ChannelCount); }
    for (channel, (old, new)) in old_map.iter().zip(new_map.iter()).enumerate() {
        if let Some(from) = old {
            if new.as_deref() != Some(from.as_str()) {
                return Err(UpgradeError::WouldMove { channel, from: from.clone(), to: new.clone() });
            }
        }
    }
    let new_version = catalogue.get("version").and_then(Value::as_str);
    let old_version = installed.get("version").and_then(Value::as_str);
    let version_changes = new_version.is_some_and(|v| Some(v) != old_version);
    let map_changes = old_map != new_map;
    if !version_changes && !map_changes { return Ok(None); }
    let mut out = installed.clone();
    out["landmarkMap"] = serde_json::to_value(&new_map).expect("Vec<Option<String>> serializes");
    if let Some(v) = new_version { out["version"] = Value::String(v.to_string()); }
    Ok(Some(out))
}

/// `dir/manifest.json` upgraded in place against `catalogue`, atomically (write `manifest.json.tmp`, rename over
/// the original) and only when `upgrade_map` says something changed. Returns whether it wrote. On any
/// [`UpgradeError`] (wrapped in the `anyhow::Error`) the installed file is left exactly as it was.
pub fn upgrade_installed(dir: &Path, catalogue: &Value) -> anyhow::Result<bool> {
    let manifest_path = dir.join("manifest.json");
    let installed: Value = serde_json::from_slice(&std::fs::read(&manifest_path)?)?;
    let upgraded = upgrade_map(&installed, catalogue).map_err(anyhow::Error::from)?;
    let Some(new_installed) = upgraded else { return Ok(false) };
    let tmp = dir.join("manifest.json.tmp");
    std::fs::write(&tmp, serde_json::to_string_pretty(&new_installed)?)?;
    std::fs::rename(&tmp, &manifest_path)?;
    Ok(true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test] fn display_names_each_variant_for_the_models_row() {
        assert!(UpgradeError::DifferentModel.to_string().contains("different model"));
        assert!(UpgradeError::ChannelCount.to_string().contains("channel count"));
        assert!(UpgradeError::WouldMove { channel: 3, from: "S".into(), to: None }.to_string().contains("channel 3"));
    }
    #[test] fn a_catalogue_with_no_version_keeps_the_installed_version() {
        let old = json!({"id": "m", "version": "v7", "landmarkMap": ["S", null]});
        let new = upgrade_map(&old, &json!({"id": "m", "landmarkMap": ["S", "D"]})).unwrap().unwrap();
        assert_eq!(new["version"], "v7");
    }
}
