// Task 5: SRPose's 19 extra points switched on without moving the first 19.
use ceph_model::upgrade::{upgrade_map, UpgradeError};
use serde_json::json;

fn man(map: serde_json::Value) -> serde_json::Value {
    json!({"id": "m", "version": "v1", "file": "model.onnx", "sha256": "abc", "landmarkMap": map})
}

#[test]
fn names_fill_null_channels_and_nothing_else_changes() {
    let old = man(json!(["S", "N", null, null]));
    let new = upgrade_map(&old, &json!({"id": "m", "version": "v2", "landmarkMap": ["S", "N", "D", null]})).unwrap().unwrap();
    assert_eq!(new["landmarkMap"], json!(["S", "N", "D", null]));
    assert_eq!((new["file"].clone(), new["sha256"].clone(), new["version"].clone()), (json!("model.onnx"), json!("abc"), json!("v2")));
}

#[test]
fn a_map_that_would_move_an_existing_point_is_refused() {
    // positive control for "1-19 keep their positions"
    let old = man(json!(["S", "N", null]));
    assert!(matches!(upgrade_map(&old, &json!({"id": "m", "landmarkMap": ["N", "S", null]})), Err(UpgradeError::WouldMove { channel: 0, .. })));
    assert!(matches!(upgrade_map(&old, &json!({"id": "m", "landmarkMap": ["S", null, null]})), Err(UpgradeError::WouldMove { channel: 1, .. })));
}

#[test]
fn a_different_channel_count_or_model_is_refused() {
    let old = man(json!(["S", null]));
    assert!(matches!(upgrade_map(&old, &json!({"id": "m", "landmarkMap": ["S", null, "D"]})), Err(UpgradeError::ChannelCount)));
    assert!(matches!(upgrade_map(&old, &json!({"id": "other", "landmarkMap": ["S", "D"]})), Err(UpgradeError::DifferentModel)));
}

#[test]
fn an_up_to_date_manifest_is_left_alone() {
    let old = man(json!(["S", "D"]));
    assert!(upgrade_map(&old, &json!({"id": "m", "version": "v1", "landmarkMap": ["S", "D"]})).unwrap().is_none());
}

#[test]
fn the_installed_file_is_rewritten_atomically_and_only_when_needed() {
    let d = tempfile::tempdir().unwrap();
    std::fs::write(d.path().join("manifest.json"), man(json!(["S", null])).to_string()).unwrap();
    assert!(ceph_model::upgrade::upgrade_installed(d.path(), &json!({"id": "m", "landmarkMap": ["S", "D"]})).unwrap());
    assert!(!ceph_model::upgrade::upgrade_installed(d.path(), &json!({"id": "m", "landmarkMap": ["S", "D"]})).unwrap());
    assert!(std::fs::read_dir(d.path()).unwrap().all(|f| !f.unwrap().file_name().to_string_lossy().contains(".tmp")));
}

#[test]
fn a_different_model_id_is_refused_and_the_installed_file_is_left_unchanged() {
    let d = tempfile::tempdir().unwrap();
    let original = man(json!(["S", "D"])).to_string();
    std::fs::write(d.path().join("manifest.json"), &original).unwrap();
    let err = ceph_model::upgrade::upgrade_installed(d.path(), &json!({"id": "other", "landmarkMap": ["S", "D"]})).unwrap_err();
    assert!(matches!(err.downcast_ref::<UpgradeError>(), Some(UpgradeError::DifferentModel)), "{err}");
    assert_eq!(std::fs::read_to_string(d.path().join("manifest.json")).unwrap(), original, "installed manifest must be untouched on refusal");
}

#[test]
fn a_channel_count_mismatch_is_refused_and_the_installed_file_is_left_unchanged() {
    let d = tempfile::tempdir().unwrap();
    let original = man(json!(["S", "D"])).to_string();
    std::fs::write(d.path().join("manifest.json"), &original).unwrap();
    let err = ceph_model::upgrade::upgrade_installed(d.path(), &json!({"id": "m", "landmarkMap": ["S", "D", "Extra"]})).unwrap_err();
    assert!(matches!(err.downcast_ref::<UpgradeError>(), Some(UpgradeError::ChannelCount)), "{err}");
    assert_eq!(std::fs::read_to_string(d.path().join("manifest.json")).unwrap(), original, "installed manifest must be untouched on refusal");
}

#[test]
fn a_map_that_would_move_a_point_is_refused_and_the_installed_file_is_left_unchanged() {
    let d = tempfile::tempdir().unwrap();
    let original = man(json!(["S", "N", null])).to_string();
    std::fs::write(d.path().join("manifest.json"), &original).unwrap();
    let err = ceph_model::upgrade::upgrade_installed(d.path(), &json!({"id": "m", "landmarkMap": ["N", "S", null]})).unwrap_err();
    assert!(matches!(err.downcast_ref::<UpgradeError>(), Some(UpgradeError::WouldMove { channel: 0, .. })), "{err}");
    assert_eq!(std::fs::read_to_string(d.path().join("manifest.json")).unwrap(), original, "installed manifest must be untouched on refusal");
}
