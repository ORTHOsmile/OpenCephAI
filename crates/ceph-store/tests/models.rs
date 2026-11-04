//! Schema 7 (spec 2026-10-01 Part 3) on synthetic films only.
use ceph_store::{AiPoint, AiRun, CaseEdit, LandmarkRow, Library};
use serde_json::json;
use std::path::{Path, PathBuf};

fn film(dir: &Path, name: &str) -> PathBuf {
    let p = dir.join(name);
    image::GrayImage::from_fn(300, 200, |x, y| image::Luma([((x * 3 + y) % 251) as u8])).save(&p).unwrap();
    p
}
fn run(model: &str) -> AiRun { AiRun { model_id: model.into(), execution_provider: "cpu".into(), facing: "right".into(), total_ms: 1.0, model_sha256: None } }
fn pt(channel: u32, id: Option<&str>, x: f64) -> AiPoint { AiPoint { channel, landmark_id: id.map(str::to_string), x, y: 2.0 * x, peak: 0.5 } }

/// The user's own edit, independent of any model run (one manually-placed point).
fn edit_moving_one_point(case_id: &str) -> CaseEdit {
    let lm = LandmarkRow { id: "S".into(), x: 5.0, y: 6.0, source: "manual".into(), verified: false, ai_x: None, ai_y: None, confidence: None, placed_by: None };
    CaseEdit { id: case_id.into(), facing: "right".into(), orientation: json!({"mirror": false, "rotDeg": 0, "source": "none"}), display: json!({}), landmarks: vec![lm] }
}

/// SRPose's 38 channels (owner map, R-B1): points no test set has are placed like any other AI point.
const SRPOSE_MAP2: [&str; 38] = [
    "S", "N", "Or", "Po", "A", "B", "Pog", "Me", "Gn", "Go", "L1T", "U1T", "UL", "LL", "Sn", "PogS", "PNS", "ANS",
    "Ar", "D", "U1A", "L1A", "Cm", "PTM", "Co", "Prn", "Ba", "Pt", "Bo", "ULs", "LLs", "GnS", "MeS", "G", "Ns",
    "Cerv", "U6", "L6",
];
/// Aariz's 29 channels; three carry no landmark id (LPM, R, UPM — kept unnamed, "" below).
const AARIZ_MAP: [&str; 29] = [
    "A", "ANS", "Ar", "B", "Co", "Gn", "Go", "L1A", "L1T", "L6", "", "LL", "UL", "Me", "N", "Ns", "Or", "PNS", "Prn",
    "Po", "Pog", "PogS", "", "S", "Sn", "U1A", "U1T", "U6", "",
];

#[test] fn every_models_points_are_kept_and_the_latest_run_per_model_is_returned() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "a.png")).unwrap().case_id;
    lib.record_ai_run(&c, &run("m1"), &[pt(0, Some("S"), 1.0), pt(1, None, 2.0)]).unwrap();
    let newer = lib.record_ai_run(&c, &run("m1"), &[pt(0, Some("S"), 5.0)]).unwrap();
    lib.record_ai_run(&c, &run("m2"), &[pt(0, Some("S"), 9.0)]).unwrap();
    assert!(newer > 0);
    let got = lib.latest_ai_points(&c).unwrap();
    assert_eq!(got.iter().map(|m| m.model_id.as_str()).collect::<Vec<_>>(), ["m1", "m2"]);
    assert_eq!(got[0].points, vec![pt(0, Some("S"), 5.0)]);
    assert_eq!(got[1].points[0].x, 9.0);
}

#[test] fn a_runs_points_go_when_the_run_goes() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "a.png")).unwrap().case_id;
    let id = lib.record_ai_run(&c, &run("m1"), &[pt(0, Some("S"), 1.0)]).unwrap();
    drop(lib);
    let conn = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
    conn.pragma_update(None, "foreign_keys", "ON").unwrap();
    conn.execute("DELETE FROM ai_runs WHERE id = ?1", [id]).unwrap();
    let left: i64 = conn.query_row("SELECT COUNT(*) FROM ai_points", [], |r| r.get(0)).unwrap();
    assert_eq!(left, 0);
}

#[test] fn operators_start_with_the_current_name_and_add_trimmed_unique_names() {
    let t = tempfile::tempdir().unwrap();
    let mut lib = Library::open(t.path()).unwrap();
    assert_eq!(lib.operators("Dr A").unwrap(), ["Dr A"]);
    assert_eq!(lib.add_operator("  Dr B ").unwrap(), "Dr B");
    lib.add_operator("Dr B").unwrap();                                       // a repeat is not added twice
    assert_eq!(lib.operators("ignored once the list has names").unwrap(), ["Dr A", "Dr B"]);
    assert!(lib.add_operator("   ").is_err());
}

#[test] fn a_licence_acceptance_is_kept_per_model_and_version() {
    let t = tempfile::tempdir().unwrap();
    let mut lib = Library::open(t.path()).unwrap();
    assert!(!lib.licence_accepted("srpose-cldet23", "1").unwrap());
    lib.accept_licence("srpose-cldet23", "1", "Dr A").unwrap();
    assert!(lib.licence_accepted("srpose-cldet23", "1").unwrap());
    assert!(!lib.licence_accepted("srpose-cldet23", "2").unwrap());
}

/// Guards existing behaviour (Parts F, G): a case's AI points, for every model that ran on it, must still be there
/// in full after the clinician's own edit is saved and the library is closed and reopened.
#[test] fn a_38_channel_run_and_a_29_channel_run_survive_a_case_save_and_a_reopen() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let case_id = { let mut lib = Library::open(t.path()).unwrap(); let im = lib.import(&film(src.path(), "a.png")).unwrap(); im.case_id };
    let pts = |n: u32, named: &[&str]| (0..n).map(|c| {
        let name = named.get(c as usize).copied().unwrap_or("");
        AiPoint { channel: c, landmark_id: if name.is_empty() { None } else { Some(name.to_string()) }, x: c as f64 + 0.25, y: 2.0 * c as f64, peak: 0.5 }
    }).collect::<Vec<_>>();
    {
        let mut lib = Library::open(t.path()).unwrap();
        lib.record_ai_run(&case_id, &run("srpose-cldet23"), &pts(38, &SRPOSE_MAP2)).unwrap();
        lib.record_ai_run(&case_id, &run("aariz-cepha29"), &pts(29, &AARIZ_MAP)).unwrap();
        lib.save(&edit_moving_one_point(&case_id), "op").unwrap();          // the user's own edit, saved after the runs
    }
    let lib = Library::open(t.path()).unwrap();                               // reopen
    let got = lib.latest_ai_points(&case_id).unwrap();
    let sr = got.iter().find(|m| m.model_id == "srpose-cldet23").unwrap();
    assert_eq!(sr.points.len(), 38);
    assert_eq!(sr.points[37].landmark_id.as_deref(), Some("L6"));
    assert_eq!((sr.points[37].x, sr.points[37].y), (37.25, 74.0));
    assert!(sr.points.iter().filter(|p| p.landmark_id.is_none()).count() == 0);
    let aa = got.iter().find(|m| m.model_id == "aariz-cepha29").unwrap();
    assert_eq!(aa.points.len(), 29);
    assert_eq!(aa.points.iter().filter(|p| p.landmark_id.is_none()).count(), 3);   // LPM, R, UPM kept unnamed
}
