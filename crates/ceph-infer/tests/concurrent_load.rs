//! Two model loads at the same moment in one process.
//!
//! ONNX Runtime 1.22 finds a model's separate weights file by taking the model file's folder with the C library's
//! `dirname()`. On macOS `dirname()` hands back one buffer shared by the whole process, so two loads at once can each
//! read the other's folder (or a mix of both) and look for `weights.bin` in the wrong place. The load then fails with
//! "Encountered unknown exception in Initialize()". Converted models (a `.pth` turned into model.onnx + weights.bin)
//! are the ones with a separate weights file.
//!
//! Synthetic only: ceph-model's tiny skeleton fixture (one 1×1 convolution, weights read from `weights.bin`) with
//! made-up weights. No patient data and no real model weights.
use ceph_infer::engine::Engine;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Barrier};

const SKELETON: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/../ceph-model/tests/fixtures/tiny.onnx");

/// The tiny skeleton and its 128-byte weights file (w = 2×3×1×1 at byte 0, b = 2 at byte 64, per
/// `tiny.layout.json`), with a v2 manifest set to `runtime`, in `dir`.
fn tiny(dir: &Path, runtime: &str) -> PathBuf {
    std::fs::create_dir_all(dir).unwrap();
    std::fs::copy(SKELETON, dir.join("model.onnx")).unwrap();
    let mut w = vec![0u8; 128];
    for (i, v) in [1f32, 0., 0., 0., 1., 0.].iter().enumerate() { w[i * 4..i * 4 + 4].copy_from_slice(&v.to_le_bytes()); }
    for (i, v) in [0.5f32, -0.5].iter().enumerate() { w[64 + i * 4..64 + i * 4 + 4].copy_from_slice(&v.to_le_bytes()); }
    std::fs::write(dir.join("weights.bin"), &w).unwrap();
    let sha = |f: &str| ceph_infer::spec::sha256_file(&dir.join(f)).unwrap();
    let m = serde_json::json!({"manifestVersion": 2, "id": "tiny", "version": "t", "title": "Tiny",
        "file": "model.onnx", "sha256": sha("model.onnx"), "weights": {"file": "weights.bin", "sha256": sha("weights.bin")},
        "runtime": runtime,
        "input": {"name": "image", "width": 8, "height": 8, "channels": 3, "resize": {"kind": "stretch"},
                  "normalize": {"kind": "fixed", "mean": [0, 0, 0], "std": [1, 1, 1], "scale": 255.0}},
        "output": {"name": "heatmaps", "width": 8, "height": 8, "stride": 1, "heatmapCenter": "corner", "decode": {"kind": "argmax"}},
        "landmarkMap": ["S", "N"]});
    std::fs::write(dir.join("manifest.json"), serde_json::to_vec(&m).unwrap()).unwrap();
    dir.join("manifest.json")
}

/// One load per manifest, all released together by a barrier, `rounds` times; every load's error.
fn load_together(manifests: &[PathBuf], rounds: usize) -> Vec<String> {
    let mut errors = Vec::new();
    for _ in 0..rounds {
        let gate = Arc::new(Barrier::new(manifests.len()));
        let runs: Vec<_> = manifests.iter().map(|m| {
            let (gate, m) = (gate.clone(), m.clone());
            std::thread::spawn(move || { gate.wait(); Engine::load(&m).map(|_| ()).map_err(|e| format!("{}: {e:#}", m.display())) })
        }).collect();
        errors.extend(runs.into_iter().filter_map(|t| t.join().unwrap().err()));
    }
    errors
}

/// The app can start two loads at once: a timed-out extra model keeps loading on its own thread while the next film
/// loads the main model, and a Model Manager install's test load (in its work folder) can meet a film's load. Each
/// load is of a different model in a different folder, as in the app; the folders differ in depth, like an install's
/// work folder and an installed model's folder. Every load must succeed, on every runtime a manifest can name.
#[test]
fn loads_of_models_in_different_folders_started_together_all_succeed_on_every_runtime() {
    assert!(std::env::var_os("CEPHTRACE_PROVIDER").is_none(), "unset CEPHTRACE_PROVIDER: it would override the runtime under test");
    for runtime in ["coreml-fp32", "coreml", "cpu"] {
        let d = tempfile::tempdir().unwrap();
        let manifests: Vec<_> = (0..8).map(|i| {
            let dir = if i % 2 == 0 { d.path().join(format!("m{i}")) } else { d.path().join(format!(".tmp-tiny-{i}-123456789/model")) };
            tiny(&dir, runtime)
        }).collect();
        // control: each model loads on its own and gives two points, so a failure below is the overlap, not the fixture
        for m in &manifests {
            let e = Engine::load(m).unwrap_or_else(|e| panic!("{runtime}: {} alone must load: {e:#}", m.display()));
            assert_eq!(e.detect(&image::GrayImage::new(64, 64), false).unwrap().landmarks.len(), 2);
        }
        let errors = load_together(&manifests, 25);
        assert!(errors.is_empty(), "{runtime}: {} of 200 overlapping loads failed: {:#?}", errors.len(), errors);
    }
}

/// Edge: a load that fails inside ONNX Runtime (a file that is not a model, with a manifest that vouches for it so the
/// checksum check lets it through) must not keep later loads waiting. The next load must finish, well inside 30 s.
#[test]
fn a_load_that_fails_inside_onnx_runtime_does_not_hold_up_the_next_one() {
    let d = tempfile::tempdir().unwrap();
    let good = tiny(&d.path().join("good"), "cpu");
    let bad_dir = d.path().join("bad");
    let bad = tiny(&bad_dir, "cpu");
    std::fs::write(bad_dir.join("model.onnx"), b"SYNTHETIC: not an ONNX model").unwrap();
    let mut m: serde_json::Value = serde_json::from_slice(&std::fs::read(&bad).unwrap()).unwrap();
    m["sha256"] = ceph_infer::spec::sha256_file(&bad_dir.join("model.onnx")).unwrap().into();
    std::fs::write(&bad, serde_json::to_vec(&m).unwrap()).unwrap();
    let err = Engine::load(&bad).err().expect("a file that is not a model must not load");
    assert!(!format!("{err:#}").contains("sha256"), "the failure must come from ONNX Runtime, not the checksum: {err:#}");
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || tx.send(Engine::load(&good).map(|_| ()).map_err(|e| format!("{e:#}"))).ok());
    let next = rx.recv_timeout(std::time::Duration::from_secs(30)).expect("the next load was still waiting after 30 s");
    assert_eq!(next, Ok(()));
}

/// Review I-1: the earlier test above proves an ordinary `Err` releases `SESSION_START` (plain RAII, no panic
/// involved) — it does not exercise the `into_inner()` poison-recovery at `engine.rs:96`. This test panics on another
/// thread while that lock is held (`poison_session_start_for_test`, a doc-hidden test-only hook — nothing in
/// production panics inside the lock), which poisons the real `Mutex`, then loads a synthetic model and confirms the
/// load still succeeds instead of every future load hanging or erroring on `.lock()`.
#[test]
fn a_poisoned_session_start_lock_still_lets_the_next_load_through() {
    ceph_infer::engine::poison_session_start_for_test();
    let d = tempfile::tempdir().unwrap();
    let good = tiny(&d.path().join("good"), "cpu");
    let loaded = Engine::load(&good);
    assert!(loaded.is_ok(), "a poisoned SESSION_START lock must still let the next load through: {:?}", loaded.err());
}
