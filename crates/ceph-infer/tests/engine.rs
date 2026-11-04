//! Integration tests against the real converted model and a Ceph-400 image. Both live outside git
//! (models/ and data/ are gitignored), so these are `#[ignore]`d: `cargo test -p ceph-infer -- --ignored`.
use ceph_infer::engine::Engine;
use std::path::PathBuf;

fn root() -> PathBuf { PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../..") }
fn engine() -> Engine { Engine::load(&root().join("models/manifest.json")).expect("load engine") }

#[test] #[ignore]
fn detects_19_landmarks_inside_the_image() {
    let e = engine();
    let d = e.detect_path(&root().join("data/ceph400/images/001.png"), false).unwrap();
    assert_eq!((d.image_width, d.image_height, d.landmarks.len()), (1935, 2400, 19));
    // Task 10 (schema 10): each detection names the model file it ran, by the SHA-256 the manifest verified at load.
    assert_eq!(d.model_sha256, e.manifest().sha256);
    assert_eq!(d.model_sha256.len(), 64);
    for l in &d.landmarks {
        assert!(l.x >= 0.0 && l.x < 1935.0 && l.y >= 0.0 && l.y < 2400.0, "{l:?}");
        assert!((0.0..=1.0).contains(&l.confidence));
    }
    assert_eq!(d.landmarks[0].id, "S");
    let expected: &[&str] = if cfg!(target_os = "macos") { &["coreml", "coreml-fp32", "cpu"] } else { &["cpu"] };
    assert!(expected.contains(&d.execution_provider.as_str()), "{}", d.execution_provider);
}

#[test] #[ignore]
fn facing_left_on_a_mirrored_film_gives_the_same_points() {
    let e = engine();
    let img = image::open(root().join("data/ceph400/images/001.png")).unwrap().to_luma8();
    let mirrored = image::imageops::flip_horizontal(&img);
    let (a, b) = (e.detect(&img, false).unwrap(), e.detect(&mirrored, true).unwrap());
    for (p, q) in a.landmarks.iter().zip(&b.landmarks) {
        assert!((1934.0 - p.x - q.x).abs() < 1e-6 && (p.y - q.y).abs() < 1e-6, "{p:?} vs {q:?}");
    }
}

#[test] #[ignore]
fn degenerate_image_is_an_error_not_nan() {
    let e = engine();
    assert!(e.detect(&image::GrayImage::new(1, 2400), false).is_err());
    assert!(e.detect(&image::GrayImage::new(2400, 1), false).is_err());
}

#[test] #[ignore]
fn manifest_that_does_not_match_the_model_is_an_error_not_a_panic() {
    let dir = std::env::temp_dir().join(format!("ceph-infer-mismatch-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let mut m: serde_json::Value = serde_json::from_slice(&std::fs::read(root().join("models/manifest.json")).unwrap()).unwrap();
    let model = root().join("models").join(m["file"].as_str().unwrap());
    let link = dir.join(m["file"].as_str().unwrap());
    let _ = std::fs::remove_file(&link);
    std::os::unix::fs::symlink(&model, &link).unwrap();
    m["landmarks"].as_array_mut().unwrap().push("Extra".into());          // 20 landmarks for a 19-channel model
    std::fs::write(dir.join("manifest.json"), serde_json::to_vec(&m).unwrap()).unwrap();
    let err = Engine::load(&dir.join("manifest.json")).err().expect("a manifest/model mismatch must be refused at load");
    assert!(err.to_string().contains("does not match the manifest"), "{err}");
    std::fs::remove_dir_all(&dir).ok();
}

#[test] #[ignore]
fn auto_facing_recognises_a_mirrored_film_and_maps_it_back() {
    let e = engine();
    let img = ceph_infer::engine::load_gray(&root().join("data/ceph400/images/001.png")).unwrap();
    let mirrored = image::imageops::flip_horizontal(&img);
    let (a, b) = (e.detect_auto(&img).unwrap(), e.detect_auto(&mirrored).unwrap());
    assert!(!a.facing_left && b.facing_left, "as-is {:?} / mirrored {:?}", (a.mean_peak_right, a.mean_peak_left), (b.mean_peak_right, b.mean_peak_left));
    for (p, q) in a.detection.landmarks.iter().zip(&b.detection.landmarks) {
        assert!((1934.0 - p.x - q.x).abs() < 1e-6 && (p.y - q.y).abs() < 1e-6, "{p:?} vs {q:?}");
    }
}
