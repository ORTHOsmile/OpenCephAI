//! Review focus 2: killing the app mid-save must leave a consistent library (plan §3.2 tests).
//! The test re-runs this test binary as a child that saves in a tight loop, kills it, then inspects the library.
use ceph_store::{CaseEdit, LandmarkRow, Library};
use std::{path::Path, process::Command, time::Duration};

const IDS: [&str; 19] = ["S", "N", "Or", "Po", "A", "B", "Pog", "Me", "Gn", "Go", "L1T", "U1T", "UL", "LL", "Sn", "PogS", "PNS", "ANS", "Ar"];

fn edit(case: &str, x: f64) -> CaseEdit {
    CaseEdit { id: case.into(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}),
        landmarks: IDS.iter().map(|id| LandmarkRow { id: (*id).into(), x, y: x, source: "manual".into(), verified: true, ai_x: None, ai_y: None, confidence: None, placed_by: None }).collect() }
}

/// Child side: only does anything when the parent sets CEPH_STORE_CHILD.
#[test] #[ignore] fn child_saves_forever() {
    let Ok(root) = std::env::var("CEPH_STORE_CHILD") else { return };
    let case = std::env::var("CEPH_STORE_CASE").unwrap();
    let mut lib = Library::open(Path::new(&root)).unwrap();
    for i in 1.. { lib.save(&edit(&case, i as f64), "op").unwrap(); }
}

#[test] fn killed_mid_save_leaves_every_landmark_from_one_save() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let png = src.path().join("a.png");
    image::GrayImage::from_fn(300, 300, |x, _| image::Luma([x as u8])).save(&png).unwrap();
    let case = Library::open(t.path()).unwrap().import(&png).unwrap().case_id;
    for round in 0..3 {
        let mut child = Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "child_saves_forever", "--ignored", "--nocapture"])
            .env("CEPH_STORE_CHILD", t.path()).env("CEPH_STORE_CASE", &case).spawn().unwrap();
        std::thread::sleep(Duration::from_millis(300 + 70 * round));
        child.kill().unwrap(); child.wait().unwrap();
        let lib = Library::open(t.path()).unwrap();                            // recovers the WAL
        let c = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
        assert_eq!(c.query_row("PRAGMA integrity_check", [], |r| r.get::<_, String>(0)).unwrap(), "ok");
        let doc = lib.load(&case).unwrap();
        assert!(doc.landmarks.is_empty() || doc.landmarks.len() == IDS.len(), "partial save: {} rows", doc.landmarks.len());
        assert!(doc.landmarks.iter().all(|l| l.x == doc.landmarks[0].x), "rows from two different saves");
    }
}
