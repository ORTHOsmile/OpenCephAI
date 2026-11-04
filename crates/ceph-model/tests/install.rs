use ceph_model::install::{convert, sha256_file, InstallError};
use ceph_model::testing::*;

#[test] fn converts_checks_and_writes_the_same_bytes_every_time() {
    let d = tempfile::tempdir().unwrap();
    let src = tiny_pth(d.path());
    let w_sha = pinned_weights(&src);                                              // --pin: learn the hash
    let m = tiny_model(&sha256_file(&src).unwrap(), &w_sha);
    let a = convert(&m, &src, &d.path().join("a"), false).unwrap();
    let b = convert(&m, &src, &d.path().join("b"), false).unwrap();
    assert_eq!(std::fs::read(a.join("weights.bin")).unwrap(), std::fs::read(b.join("weights.bin")).unwrap());
    let bytes = std::fs::read(a.join("weights.bin")).unwrap();
    assert_eq!(bytes.len(), 128);
    assert_eq!(f32::from_le_bytes(bytes[64..68].try_into().unwrap()), 0.5);           // b at its layout offset
    assert!(bytes[24..64].iter().all(|&x| x == 0));                                   // the gap is zeros
    let man: serde_json::Value = serde_json::from_slice(&std::fs::read(a.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(man["weights"]["sha256"], w_sha);
    assert_eq!(man["file"], "model.onnx");
}
#[test] fn each_refusal_says_what_went_wrong_and_leaves_nothing() {
    let d = tempfile::tempdir().unwrap();
    let src = tiny_pth(d.path());
    let ok_src = sha256_file(&src).unwrap();
    let e = convert(&tiny_model("00", "00"), &src, &d.path().join("w1"), false).unwrap_err();
    assert!(matches!(e, InstallError::Changed));
    assert_eq!(e.to_string(), "The authors' file has changed since this version of OpenCephAI was made, so it can't be checked. Nothing was installed.");
    let e = convert(&tiny_model(&ok_src, "00"), &src, &d.path().join("w2"), false).unwrap_err();
    assert_eq!(e.to_string(), "Conversion didn't give the expected result. Nothing was installed.");
    assert!(!d.path().join("w2/model").exists());
    let wrong = d.path().join("wrong.pt");                                            // w has the wrong shape
    write_pth(&wrong, &P::new().od().mark().s("w").tensor("0", 6, 0, &[6], &[1]).s("b").tensor("1", 2, 0, &[2], &[1]).op(b'u').stop(),
        &[("0", vec![0.; 6]), ("1", vec![0.; 2])]);
    let e = convert(&tiny_model(&sha256_file(&wrong).unwrap(), "00"), &wrong, &d.path().join("w3"), false).unwrap_err();
    assert_eq!(e.to_string(), "This file doesn't match Tiny. Nothing was installed.");
    let evil = d.path().join("evil.pt");
    write_pth(&evil, &P::new().global("os", "system").mark().s("x").tuple().reduce().stop(), &[]);
    let e = convert(&tiny_model(&sha256_file(&evil).unwrap(), "00"), &evil, &d.path().join("w4"), false).unwrap_err();
    assert_eq!(e.to_string(), "This file contains something other than model weights. Nothing was installed.");
}
#[test] fn a_ready_onnx_entry_installs_by_copying_the_checked_file() {
    let d = tempfile::tempdir().unwrap();
    let src = d.path().join("tiny-full.onnx");
    std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tiny-full.onnx"), &src).unwrap();
    let m = ceph_model::testing::tiny_full_model(&ceph_model::install::sha256_file(&src).unwrap());
    let dir = ceph_model::install::convert(&m, &src, &d.path().join("work"), false).unwrap();
    let man: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join("manifest.json")).unwrap()).unwrap();
    assert_eq!(man["file"], "model.onnx");
    assert_eq!(man["sha256"], ceph_model::install::sha256_file(&src).unwrap());
    assert!(man.get("weights").is_none() || man["weights"].is_null());          // weights are inside the file
    assert_eq!(std::fs::read(dir.join("model.onnx")).unwrap(), std::fs::read(&src).unwrap());
}
#[test] fn a_ready_onnx_entry_refuses_a_changed_file() {
    let d = tempfile::tempdir().unwrap();
    let src = d.path().join("tiny-full.onnx");
    std::fs::copy(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/tiny-full.onnx"), &src).unwrap();
    let m = ceph_model::testing::tiny_full_model(&"0".repeat(64));
    assert!(matches!(ceph_model::install::convert(&m, &src, &d.path().join("work"), false), Err(ceph_model::install::InstallError::Changed)));
    assert!(!d.path().join("work/model").exists());
}
#[test] fn a_pth_entry_still_converts_exactly_as_before() {
    // the existing tiny pth path, unchanged: same weights sha as pinned_weights() gives
    let d = tempfile::tempdir().unwrap(); let src = ceph_model::testing::tiny_pth(d.path());
    let w = ceph_model::testing::pinned_weights(&src);
    let m = ceph_model::testing::tiny_model(&ceph_model::install::sha256_file(&src).unwrap(), &w);
    let dir = ceph_model::install::convert(&m, &src, &d.path().join("work"), false).unwrap();
    assert_eq!(ceph_model::install::sha256_file(&dir.join("weights.bin")).unwrap(), w);
}
#[test] fn a_checkpoint_inside_a_zip_download_is_found() {
    // GU2Net's download is a zip holding best.pt.
    use std::io::Write;
    let d = tempfile::tempdir().unwrap();
    let inner = tiny_pth(d.path());
    let outer = d.path().join("download.zip");
    let mut z = zip::ZipWriter::new(std::fs::File::create(&outer).unwrap());
    z.start_file("best.pt", zip::write::SimpleFileOptions::default()).unwrap();
    z.write_all(&std::fs::read(&inner).unwrap()).unwrap();
    z.finish().unwrap();
    let mut m = tiny_model(&sha256_file(&outer).unwrap(), &pinned_weights(&inner));
    m.entry.source = serde_json::from_value(serde_json::json!({"kind": "gdrive", "id": "x", "sha256": sha256_file(&outer).unwrap(), "zipMember": "best.pt"})).unwrap();
    let dir = convert(&m, &outer, &d.path().join("w"), false).unwrap();
    assert!(dir.join("weights.bin").is_file());
}
