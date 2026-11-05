//! Library behaviour on synthetic films only: generated gradients, never a real radiograph.
use ceph_store::{verify_backup, AiRun, CaseEdit, CaseMeta, LandmarkRow, Library, RulerMarks};
use serde_json::json;
use std::path::{Path, PathBuf};

fn synthetic_png(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn ai(id: &str, x: f64, y: f64) -> LandmarkRow {
    LandmarkRow { id: id.into(), x, y, source: "ai".into(), verified: false, ai_x: Some(x), ai_y: Some(y), confidence: Some(0.8), placed_by: None, accept_kind: None, placed_via: None }
}
/// An AI point with its placing model (and, for Automatic best, the 'auto-best' via mark), for the Library
/// table's AI status column (owner decisions, 29 Oct: Table view, Part 4).
fn ai_via(id: &str, x: f64, y: f64, placed_by: &str, placed_via: Option<&str>) -> LandmarkRow {
    LandmarkRow { id: id.into(), x, y, source: "ai".into(), verified: false, ai_x: Some(x), ai_y: Some(y), confidence: Some(0.8),
        placed_by: Some(placed_by.into()), accept_kind: None, placed_via: placed_via.map(String::from) }
}
fn edit(id: &str, landmarks: Vec<LandmarkRow>) -> CaseEdit {
    CaseEdit { id: id.into(), facing: "right".into(), orientation: json!({"mirror": false, "rotDeg": 0, "source": "none"}), display: json!({}), landmarks }
}
fn events(root: &Path, case: &str) -> Vec<(String, String)> {
    let c = rusqlite::Connection::open(root.join("library.sqlite3")).unwrap();
    let rows = c.prepare("SELECT landmark, kind FROM landmark_events WHERE case_id = ?1 ORDER BY seq").unwrap()
        .query_map([case], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
    rows
}

/// Owner, 29 Sep: the file name is never taken as the patient's name; a film starts unnamed until its label or a person names it.
#[test] fn import_copies_the_film_once_and_leaves_the_patient_unnamed() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = synthetic_png(src.path(), "Demo patient 01.png", 0);
    let first = lib.import(&a).unwrap();
    assert!(first.created);
    let doc = lib.load(&first.case_id).unwrap();
    assert_eq!((doc.patient_name.as_str(), doc.timepoint.as_str(), doc.image.width, doc.image.height), ("", "T1", 400, 300));
    assert!(Path::new(&doc.image.path).exists() && Path::new(&doc.image.path).starts_with(t.path().join("images")));
    // Review focus 1: the same film again, even under another name, is stored once and reopens the same case.
    let copy = src.path().join("copy.PNG"); std::fs::copy(&a, &copy).unwrap();
    let again = lib.import(&copy).unwrap();
    assert_eq!((again.case_id.as_str(), again.created), (first.case_id.as_str(), false));
    assert_eq!(std::fs::read_dir(t.path().join("images")).unwrap().count(), 1);
    assert_eq!(std::fs::read_dir(t.path().join("thumbs")).unwrap().count(), 1);
    // A second, different film with the same file name is not linked to it: unnamed films are never the same patient.
    let b = synthetic_png(src.path(), "Demo patient 01.png", 7);
    let second = lib.import(&b).unwrap();
    assert_eq!(lib.load(&second.case_id).unwrap().timepoint, "T1");
}

#[test] fn import_refuses_unsupported_or_unreadable_files_and_stores_nothing() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let dcm = src.path().join("scan.dcm"); std::fs::write(&dcm, b"DICM").unwrap();
    assert!(lib.import(&dcm).unwrap_err().to_string().contains("PNG, JPEG, TIFF or BMP"));
    let broken = src.path().join("broken.png"); std::fs::write(&broken, b"not a png").unwrap();
    assert!(lib.import(&broken).unwrap_err().to_string().contains("not a readable image"));
    assert!(lib.list(false).unwrap().is_empty());
    assert_eq!(std::fs::read_dir(t.path().join("images")).unwrap().count(), 0);
}

#[test] fn save_then_reopen_round_trips_exactly_and_logs_each_change() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let case = {
        let mut lib = Library::open(t.path()).unwrap();
        let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
        lib.save(&edit(&case, vec![ai("S", 100.25, 80.5), ai("N", 300.0, 60.0)]), "dr-a").unwrap();
        let moved = LandmarkRow { x: 101.75, source: "ai-adjusted".into(), verified: true, ..ai("S", 100.25, 80.5) };
        let mut accepted = ai("N", 300.0, 60.0); accepted.verified = true;
        let manual = LandmarkRow { id: "Co".into(), x: 50.0, y: 90.0, source: "manual".into(), verified: true, ai_x: None, ai_y: None, confidence: None, placed_by: None, accept_kind: None, placed_via: None };
        let mut e = edit(&case, vec![moved, accepted, manual]);
        e.facing = "left".into(); e.orientation = json!({"mirror": true, "rotDeg": -3.5, "source": "auto-FH"}); e.display = json!({"brightness": 1.2, "contrast": 1, "invert": false});
        lib.save(&e, "dr-a").unwrap();
        case
    };                                                                        // "quit": the library is dropped
    let lib = Library::open(t.path()).unwrap();                               // "reopen"
    let doc = lib.load(&case).unwrap();
    assert_eq!(doc.facing, "left");
    assert_eq!(doc.orientation, json!({"mirror": true, "rotDeg": -3.5, "source": "auto-FH"}));
    assert_eq!(doc.display["brightness"], json!(1.2));
    // Enhancement is display-only: the stored film, which is what the model reads, is byte-for-byte the import.
    use sha2::Digest;
    assert_eq!(format!("{:x}", sha2::Sha256::digest(std::fs::read(&doc.image.path).unwrap())), doc.image.sha256);
    let ids: Vec<_> = doc.landmarks.iter().map(|l| (l.id.as_str(), l.x, l.source.as_str(), l.verified)).collect();
    assert_eq!(ids, [("S", 101.75, "ai-adjusted", true), ("N", 300.0, "ai", true), ("Co", 50.0, "manual", true)]);
    assert_eq!(doc.landmarks[0].ai_x, Some(100.25));                          // the AI's original position survives the edit
    let ev: Vec<(String, String)> = events(t.path(), &case);
    let ev: Vec<(&str, &str)> = ev.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    assert_eq!(ev, [("S", "ai"), ("N", "ai"), ("S", "move"), ("N", "accept"), ("Co", "move")]);
}

#[test] fn saving_an_unchanged_case_logs_nothing_and_removal_is_logged() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0), ai("N", 3.0, 4.0)]), "op").unwrap();
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0), ai("N", 3.0, 4.0)]), "op").unwrap();
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0)]), "op").unwrap();
    assert_eq!(events(t.path(), &case).len(), 3);                             // S ai, N ai, N remove
    assert_eq!(events(t.path(), &case)[2], ("N".to_string(), "remove".to_string()));
    assert_eq!(lib.load(&case).unwrap().landmarks.len(), 1);
}

#[test] fn save_rejects_bad_input_without_writing_anything() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0)]), "op").unwrap();
    let mut bad = edit(&case, vec![ai("S", 9.0, 9.0), ai("N", f64::NAN, 0.0)]);
    assert!(lib.save(&bad, "op").is_err());
    bad.landmarks = vec![LandmarkRow { source: "guess".into(), ..ai("S", 9.0, 9.0) }];
    assert!(lib.save(&bad, "op").is_err());
    assert!(lib.save(&edit("no-such-case", vec![]), "op").is_err());
    assert_eq!(lib.load(&case).unwrap().landmarks[0].x, 1.0);                 // unchanged
}

#[test] fn verification_needs_every_point_verified_and_any_later_edit_clears_it() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0)]), "op").unwrap();
    assert!(lib.set_verified(&case, true, "dr-a").unwrap_err().to_string().contains("1 landmark"));
    let mut s = ai("S", 1.0, 2.0); s.verified = true;
    lib.save(&edit(&case, vec![s.clone()]), "op").unwrap();
    lib.set_verified(&case, true, "dr-a").unwrap();
    let doc = lib.load(&case).unwrap();
    assert_eq!(doc.verified_by.as_deref(), Some("dr-a"));
    let mut e = edit(&case, vec![s.clone()]); e.orientation = json!({"mirror": true, "rotDeg": 0, "source": "manual"});
    assert!(lib.save(&e, "op").unwrap().verified_at.is_some());               // view-only change: still verified
    assert!(lib.load(&case).unwrap().verified_at.is_some());
    s.x = 1.5;
    assert_eq!(lib.save(&edit(&case, vec![s]), "op").unwrap().verified_at, None);   // a landmark moved: back to review
    assert!(lib.load(&case).unwrap().verified_at.is_none());
}

#[test] fn calibration_is_validated_stored_and_clears_verification() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    // Review focus 5: bad calibrations are refused and leave the scale as it was.
    assert!(lib.calibrate(&case, (10.0, 10.0), (15.0, 10.0), 10.0, "op").unwrap_err().to_string().contains("at least 20 px"));
    assert!(lib.calibrate(&case, (10.0, 10.0), (210.0, 10.0), 0.0, "op").is_err());
    assert!(lib.calibrate(&case, (10.0, 10.0), (210.0, 10.0), f64::NAN, "op").is_err());
    assert_eq!(lib.load(&case).unwrap().spacing_mm, None);
    let s = lib.calibrate(&case, (10.0, 10.0), (210.0, 10.0), 20.0, "op").unwrap();
    assert!((s - 0.1).abs() < 1e-12);
    assert_eq!(lib.load(&case).unwrap().spacing_mm, Some(s));
}

#[test] fn meta_moves_the_case_between_patients_and_drops_empty_ones() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&synthetic_png(src.path(), "scan-0001.png", 0)).unwrap().case_id;
    let b = lib.import(&synthetic_png(src.path(), "b.png", 1)).unwrap().case_id;
    lib.set_meta(&b, &CaseMeta { patient_name: "Demo patient 02".into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None }).unwrap();
    lib.set_meta(&a, &CaseMeta { patient_name: " Demo patient 02 ".into(), timepoint: "T2".into(), taken_on: Some("2026-09-01".into()), date_of_birth: None, scan_id: None }).unwrap();
    let docs = [lib.load(&a).unwrap(), lib.load(&b).unwrap()];
    assert_eq!(docs[0].patient_name, docs[1].patient_name);
    assert_eq!(docs[0].taken_on.as_deref(), Some("2026-09-01"));
    let c = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
    assert_eq!(c.query_row("SELECT COUNT(*) FROM patients", [], |r| r.get::<_, i64>(0)).unwrap(), 1);   // a's unnamed patient is gone
    // Clearing the name moves the case back to a patient of its own (blank = not known), leaving b where it was.
    lib.set_meta(&a, &CaseMeta { patient_name: "  ".into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None }).unwrap();
    assert_eq!((lib.load(&a).unwrap().patient_name.as_str(), lib.load(&b).unwrap().patient_name.as_str()), ("", "Demo patient 02"));
    assert_eq!(c.query_row("SELECT COUNT(*) FROM patients", [], |r| r.get::<_, i64>(0)).unwrap(), 2);
}

#[test] fn delete_is_soft_restorable_and_purged_later_with_its_files() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0)]), "op").unwrap();
    lib.delete(&case).unwrap();
    assert!(lib.list(false).unwrap().is_empty());
    assert_eq!(lib.list(true).unwrap()[0].id, case);
    assert!(lib.save(&edit(&case, vec![]), "op").unwrap_err().to_string().contains("Recently deleted"));
    lib.restore(&case).unwrap();
    assert_eq!(lib.list(false).unwrap()[0].landmarks, 1);
    lib.delete(&case).unwrap();
    assert_eq!(lib.purge_deleted(30).unwrap(), 0);                            // too recent
    assert_eq!(lib.purge_deleted(-1).unwrap(), 1);                            // "older than −1 days" = everything deleted
    assert!(lib.list(true).unwrap().is_empty());
    assert_eq!(std::fs::read_dir(t.path().join("images")).unwrap().count(), 0);
}

#[test] fn list_reports_progress_for_the_library_cards() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let mut s = ai("S", 1.0, 2.0); s.verified = true;
    lib.save(&edit(&case, vec![s, ai("N", 3.0, 4.0)]), "op").unwrap();
    lib.record_ai_run(&case, &AiRun { model_id: "hrnet".into(), execution_provider: "cpu".into(), facing: "right".into(), total_ms: 120.0, model_sha256: None }, &[]).unwrap();
    let row = &lib.list(false).unwrap()[0];
    assert_eq!((row.landmarks, row.unverified), (2, 1));
    assert!(Path::new(&row.thumb_path).exists());
}

#[test] fn settings_round_trip() {
    let t = tempfile::tempdir().unwrap();
    let mut lib = Library::open(t.path()).unwrap();
    assert_eq!(lib.setting("operator").unwrap(), None);
    lib.set_setting("operator", "dr-a").unwrap(); lib.set_setting("operator", "dr-b").unwrap();
    assert_eq!(lib.setting("operator").unwrap().as_deref(), Some("dr-b"));
}

/// A deleted setting reads as never set; the others stay (Automatic best base Task 4: putting a setting back after a
/// change that failed part-way).
#[test] fn a_deleted_setting_reads_as_never_set_and_others_stay() {
    let t = tempfile::tempdir().unwrap();
    let mut lib = Library::open(t.path()).unwrap();
    lib.set_setting("a", "1").unwrap(); lib.set_setting("b", "2").unwrap();
    lib.delete_setting("a").unwrap();
    assert_eq!((lib.setting("a").unwrap(), lib.setting("b").unwrap().as_deref()), (None, Some("2")));
    lib.delete_setting("never-set").unwrap();
}

#[test] fn backup_then_restore_gives_identical_rows() {
    let (t, src, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0)]), "op").unwrap();
    let before = lib.load(&case).unwrap();
    let dir = lib.backup(out.path()).unwrap();
    verify_backup(&dir).unwrap();
    lib.save(&edit(&case, vec![ai("S", 9.0, 9.0)]), "op").unwrap();          // a change after the backup…
    drop(lib);
    let lib = Library::restore_backup(t.path(), &dir).unwrap();               // …is undone by restoring it
    assert_eq!(lib.load(&case).unwrap(), before);
    std::fs::remove_file(dir.join("images").read_dir().unwrap().next().unwrap().unwrap().path()).unwrap();
    assert!(verify_backup(&dir).unwrap_err().to_string().contains("missing 1 image"));
}

/// Rename (owner, 13 Oct): the backup folder is named after the app the clinician sees today.
#[test] fn a_new_backup_folder_is_named_after_opencephai() {
    let (t, src, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap();
    let dir = lib.backup(out.path()).unwrap();
    let name = dir.file_name().unwrap().to_string_lossy().to_string();
    assert!(name.starts_with("OpenCephAI backup "), "{name}");
    assert!(!name.contains("CephTrace"), "{name}");
}

/// Rename (owner, 13 Oct): restoring must not care what the backup folder is called — a folder made by the app
/// under its old name ("CephTrace backup …") still restores, because `restore_backup` reads `library.sqlite3`
/// inside it and never inspects the folder's own name.
#[test] fn a_backup_folder_kept_under_the_old_app_name_still_restores() {
    let (t, src, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0)]), "op").unwrap();
    let before = lib.load(&case).unwrap();
    let dir = lib.backup(out.path()).unwrap();
    // Simulate a backup made before the rename: rename the folder to the old "CephTrace backup …" scheme.
    let old_named = out.path().join("CephTrace backup 2026-10-01 00-00-00");
    std::fs::rename(&dir, &old_named).unwrap();
    verify_backup(&old_named).unwrap();
    lib.save(&edit(&case, vec![ai("S", 9.0, 9.0)]), "op").unwrap();          // a change after the backup…
    drop(lib);
    let lib = Library::restore_backup(t.path(), &old_named).unwrap();        // …is undone by restoring the old-named folder
    assert_eq!(lib.load(&case).unwrap(), before);
}

#[test] fn batch_ai_points_are_written_only_to_a_case_that_is_still_untraced() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let opened = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let untouched = lib.import(&synthetic_png(src.path(), "b.png", 1)).unwrap().case_id;
    let mine = LandmarkRow { id: "S".into(), x: 1.0, y: 2.0, source: "manual".into(), verified: true, ai_x: None, ai_y: None, confidence: None, placed_by: None, accept_kind: None, placed_via: None };
    lib.save(&edit(&opened, vec![mine]), "op").unwrap();                     // the clinician traced it while the batch ran
    assert!(!lib.save_ai_if_untraced(&edit(&opened, vec![ai("S", 9.0, 9.0)]), "op").unwrap());
    assert_eq!(lib.load(&opened).unwrap().landmarks[0].source, "manual");     // review #3: the batch never overwrites it
    assert!(lib.save_ai_if_untraced(&edit(&untouched, vec![ai("S", 9.0, 9.0)]), "op").unwrap());
    assert_eq!(lib.load(&untouched).unwrap().landmarks.len(), 1);
}

#[test] fn restore_refuses_the_library_folder_itself_and_leaves_it_untouched() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let case = Library::open(t.path()).unwrap().import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let err = Library::restore_backup(t.path(), t.path()).err().expect("the live library is not a backup to restore");
    assert!(err.to_string().contains("outside the library"), "{err:#}");
    assert_eq!(Library::open(t.path()).unwrap().list(false).unwrap()[0].id, case);   // review #5: nothing moved
}

#[test] fn a_restore_that_fails_part_way_leaves_the_current_library_intact() {
    let (a, b, src, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let dir = { let mut la = Library::open(a.path()).unwrap(); la.import(&synthetic_png(src.path(), "a.png", 0)).unwrap(); la.backup(out.path()).unwrap() };
    let img = dir.join("images").read_dir().unwrap().next().unwrap().unwrap().path();
    std::fs::remove_file(&img).unwrap(); std::fs::create_dir(&img).unwrap();   // passes verification, fails to copy (like a drive unplugged mid-copy)
    let mine = Library::open(b.path()).unwrap().import(&synthetic_png(src.path(), "b.png", 5)).unwrap().case_id;
    assert!(Library::restore_backup(b.path(), &dir).is_err());
    let lb = Library::open(b.path()).unwrap();
    let ids: Vec<String> = lb.list(false).unwrap().into_iter().map(|c| c.id).collect();
    assert_eq!(ids, [mine]);                                                   // review #5: still this Mac's library, not empty, not half-restored
}

#[test] fn list_carries_each_case_orientation_so_library_cards_show_the_levelled_view() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let mut e = edit(&case, vec![ai("S", 1.0, 2.0)]);
    e.orientation = json!({"mirror": true, "rotDeg": -4.25, "source": "auto-FH"});
    lib.save(&e, "op").unwrap();
    assert_eq!(lib.list(false).unwrap()[0].orientation, json!({"mirror": true, "rotDeg": -4.25, "source": "auto-FH"}));
}

/// Review focus 1: a backup made by the Week 3 app (schema 1) restores into this app and is upgraded to schema 2.
#[test] fn a_schema_1_backup_restores_and_is_upgraded() {
    let (t, old) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let png = synthetic_png(old.path(), "film.png", 3);
    let bytes = std::fs::read(&png).unwrap();
    use sha2::Digest;
    let sha: String = sha2::Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(old.path().join("images")).unwrap();
    std::fs::copy(&png, old.path().join("images").join(format!("{sha}.png"))).unwrap();
    {
        let c = rusqlite::Connection::open(old.path().join("library.sqlite3")).unwrap();
        c.execute_batch(ceph_store::schema::MIGRATIONS[0]).unwrap();
        c.pragma_update(None, "user_version", 1).unwrap();
        c.execute("INSERT INTO patients VALUES ('p1', 'Demo patient 09', '2026-01-01T00:00:00.000Z')", []).unwrap();
        c.execute("INSERT INTO images VALUES (?1, 'png', 400, 300, ?2, 'film.png', '2026-01-01T00:00:00.000Z')", rusqlite::params![sha, bytes.len() as i64]).unwrap();
        c.execute("INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p1', ?1, 'T1', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", [&sha]).unwrap();
    }
    Library::open(t.path()).unwrap();                                          // a current library exists…
    let lib = Library::restore_backup(t.path(), old.path()).unwrap();          // …and is replaced by the old backup
    let doc = lib.load("c1").unwrap();
    assert_eq!((doc.patient_name.as_str(), doc.timepoint.as_str()), ("Demo patient 09", "T1"));
    let c = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
    assert_eq!(ceph_store::schema::version(&c).unwrap(), ceph_store::schema::CURRENT);
}

/// Schema 4 (film layouts): a backup made at schema 3 restores and is upgraded, keeping its case.
#[test] fn a_schema_3_backup_restores_and_upgrades_to_current() {
    let (t, old) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let png = synthetic_png(old.path(), "film.png", 4);
    let bytes = std::fs::read(&png).unwrap();
    use sha2::Digest;
    let sha: String = sha2::Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    std::fs::create_dir_all(old.path().join("images")).unwrap();
    std::fs::copy(&png, old.path().join("images").join(format!("{sha}.png"))).unwrap();
    {
        let c = rusqlite::Connection::open(old.path().join("library.sqlite3")).unwrap();
        for (i, sql) in ceph_store::schema::MIGRATIONS[..3].iter().enumerate() { c.execute_batch(sql).unwrap(); c.pragma_update(None, "user_version", i as i64 + 1).unwrap(); }
        c.execute("INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p1', 'Demo Three', 'demo three', 'x')", []).unwrap();
        c.execute("INSERT INTO images VALUES (?1, 'png', 400, 300, ?2, 'film.png', 'x')", rusqlite::params![sha, bytes.len() as i64]).unwrap();
        c.execute("INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p1', ?1, 'T1', 'x', 'x')", [&sha]).unwrap();
    }
    Library::open(t.path()).unwrap();
    let lib = Library::restore_backup(t.path(), old.path()).unwrap();
    let doc = lib.load("c1").unwrap();
    assert_eq!((doc.patient_name.as_str(), doc.learned_fields.len()), ("Demo Three", 0));
    let c = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
    assert_eq!(ceph_store::schema::version(&c).unwrap(), ceph_store::schema::CURRENT);
    let m: Option<String> = c.query_row("SELECT layout_machine_id FROM cases WHERE id = 'c1'", [], |r| r.get(0)).unwrap();
    assert_eq!(m, None);
}

fn meta(name: &str, tp: &str, taken_on: Option<&str>) -> CaseMeta {
    CaseMeta { patient_name: name.into(), timepoint: tp.into(), taken_on: taken_on.map(str::to_string), date_of_birth: None, scan_id: None }
}
/// Owner, 30 Sep: "T1 (oldest radiograph) should always be in the first column". A patient's T-numbers follow the film
/// dates, whatever order the films were imported in.
#[test] fn timepoints_follow_the_film_dates_not_the_import_order() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let newer = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let older = lib.import(&synthetic_png(src.path(), "b.png", 1)).unwrap().case_id;
    lib.set_meta(&newer, &meta("Demo patient 03", "T1", Some("2026-03-02"))).unwrap();
    lib.set_meta(&older, &meta("Demo patient 03", "T2", Some("2024-03-02"))).unwrap();
    assert_eq!((lib.load(&older).unwrap().timepoint.as_str(), lib.load(&newer).unwrap().timepoint.as_str()), ("T1", "T2"));
    // Correcting a film date re-orders them again.
    lib.set_meta(&older, &meta("Demo patient 03", "T1", Some("2027-01-05"))).unwrap();
    assert_eq!((lib.load(&newer).unwrap().timepoint.as_str(), lib.load(&older).unwrap().timepoint.as_str()), ("T1", "T2"));
}
/// A film dated only by its import day could be older or newer than anything: the numbers are left as they are.
#[test] fn timepoints_stay_put_while_any_film_is_dated_only_by_its_import_day() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&synthetic_png(src.path(), "b.png", 1)).unwrap().case_id;
    let c = lib.import(&synthetic_png(src.path(), "c.png", 2)).unwrap().case_id;
    let import_day = lib.load(&c).unwrap().taken_on;
    lib.set_meta(&a, &meta("Demo patient 04", "T1", Some("2026-03-02"))).unwrap();
    lib.set_meta(&b, &meta("Demo patient 04", "T2", Some("2024-03-02"))).unwrap();   // would swap, but …
    lib.set_meta(&c, &meta("Demo patient 04", "T3", import_day.as_deref())).unwrap();   // … c keeps its import day
    assert_eq!(lib.load(&c).unwrap().taken_on_source.as_deref(), Some("import"));
    let tps: Vec<String> = [&a, &b, &c].iter().map(|id| lib.load(id).unwrap().timepoint).collect();
    assert_eq!(tps, ["T2", "T1", "T3"]);   // a and b were swapped before c joined; c's arrival changes nothing
}
/// Named timepoints ("Pre", "Post-op") are a person's and never renumbered; the T-numbers keep their own set of numbers.
#[test] fn named_timepoints_are_left_alone_and_the_numbers_are_only_swapped_among_themselves() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let pre = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let late = lib.import(&synthetic_png(src.path(), "b.png", 1)).unwrap().case_id;
    let early = lib.import(&synthetic_png(src.path(), "c.png", 2)).unwrap().case_id;
    lib.set_meta(&pre, &meta("Demo patient 05", "Pre", Some("2020-01-01"))).unwrap();
    lib.set_meta(&late, &meta("Demo patient 05", "T2", Some("2026-01-01"))).unwrap();
    lib.set_meta(&early, &meta("Demo patient 05", "T5", Some("2023-01-01"))).unwrap();
    let tps: Vec<String> = [&pre, &early, &late].iter().map(|id| lib.load(id).unwrap().timepoint).collect();
    assert_eq!(tps, ["Pre", "T2", "T5"]);
}
/// Libraries from before the fix: their T-numbers are put in film-date order once, when the app is updated (schema 5).
#[test] fn a_schema_4_library_puts_each_patients_timepoints_in_film_date_order() {
    let t = tempfile::tempdir().unwrap();
    {
        let c = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
        for (i, sql) in ceph_store::schema::MIGRATIONS[..4].iter().enumerate() { c.execute_batch(sql).unwrap(); c.pragma_update(None, "user_version", i as i64 + 1).unwrap(); }
        c.execute("INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p1', 'Demo Six', 'demo six', 'x')", []).unwrap();
        for (sha, case, tp, date, source) in [("s1", "c1", "T1", "2026-03-02", "label"), ("s2", "c2", "T2", "2024-03-02", "manual")] {
            c.execute("INSERT INTO images VALUES (?1, 'png', 400, 300, 1, 'film.png', 'x')", [sha]).unwrap();
            c.execute("INSERT INTO cases (id, patient_id, image_sha256, timepoint, taken_on, taken_on_source, created_at, updated_at)
                       VALUES (?1, 'p1', ?2, ?3, ?4, ?5, 'x', 'x')", [case, sha, tp, date, source]).unwrap();
        }
    }
    let lib = Library::open(t.path()).unwrap();
    assert_eq!((lib.load("c2").unwrap().timepoint.as_str(), lib.load("c1").unwrap().timepoint.as_str()), ("T1", "T2"));
}
/// Spec 2026-10-19 (Part F interaction): a bulk accept — several points accepted where they are, in one save — logs
/// one "accept" event per point, the same "accepted without moving" record a single Accept position gives.
#[test] fn a_bulk_accept_logs_one_accept_event_per_point() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.save(&edit(&case, vec![ai("S", 1.0, 2.0), ai("N", 3.0, 4.0), ai("A", 5.0, 6.0)]), "op").unwrap();
    let acc = |id: &str, x: f64, y: f64| LandmarkRow { verified: true, ..ai(id, x, y) };
    lib.save(&edit(&case, vec![acc("S", 1.0, 2.0), acc("N", 3.0, 4.0), acc("A", 5.0, 6.0)]), "op").unwrap();
    let ev = events(t.path(), &case);
    let ev: Vec<(&str, &str)> = ev.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
    assert_eq!(ev, [("S", "ai"), ("N", "ai"), ("A", "ai"), ("S", "accept"), ("N", "accept"), ("A", "accept")]);
}
/// Spec 2026-10-19 (F): the ruler marks stay with the case: the newest calibration, while its scale still stands.
#[test] fn ruler_marks_are_the_newest_calibration_while_its_scale_stands() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    assert_eq!(lib.ruler(&case).unwrap(), None, "never calibrated: no marks");
    lib.calibrate(&case, (10.0, 10.0), (210.0, 10.0), 20.0, "op").unwrap();
    lib.calibrate(&case, (12.5, 11.0), (250.0, 11.0), 20.0, "op").unwrap();
    assert_eq!(lib.ruler(&case).unwrap(), Some(RulerMarks { p1: [12.5, 11.0], p2: [250.0, 11.0], mm: 20.0, steps: 0 }), "the newest calibration");
    assert!(lib.calibrate(&case, (12.5, 11.0), (14.0, 11.0), 20.0, "op").is_err());
    assert_eq!(lib.ruler(&case).unwrap().unwrap().p2, [250.0, 11.0], "a refused calibration leaves the marks");
    // Guard: if spacing_mm were ever set another way, the marks would no longer explain the mm, so none (G's fit never touches spacing_mm).
    lib.conn_for_tests().execute("UPDATE cases SET spacing_mm = 0.123 WHERE id = ?1", [&case]).unwrap();
    assert_eq!(lib.ruler(&case).unwrap(), None);
    let other = lib.import(&synthetic_png(src.path(), "b.png", 9)).unwrap().case_id;
    assert_eq!(lib.ruler(&other).unwrap(), None, "another case's calibration is not this one's");
}

/// Spec 2026-10-19 Addendum 3 (N): each fine-tune press is 0.5 % of the ruler's OWN mm per px (never of the last
/// press), at most ±5 %; the marks and the true distance stay the ruler's; the presses read back as a whole number.
#[test] fn a_fine_tune_is_whole_half_percent_presses_of_the_rulers_own_value() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let (p1, p2, mm) = ((10.0, 10.0), (190.0, 47.0), 20.0);
    let ruler = lib.calibrate(&case, p1, p2, mm, "op").unwrap();
    assert_eq!(ruler.to_bits(), (mm / (p2.0 - p1.0).hypot(p2.1 - p1.1)).to_bits(), "no press: today's mm / px, bit for bit");
    let mut compared = 0;
    for k in (-10..=10).chain((-10..=10).rev()) {                       // up, then back down: no drift
        let s = lib.recalibrate(&case, p1, p2, mm, k, "op").unwrap();
        assert_eq!(s.to_bits(), (ruler * ((200.0 + k as f64) / 200.0)).to_bits(), "press {k}: the ruler's value × (200 + k) / 200");
        assert!((s / ruler - (1.0 + 0.005 * k as f64)).abs() < 1e-15, "press {k}: {s} is not exactly {k} × 0.5 %");
        let doc = lib.load(&case).unwrap();
        assert_eq!((doc.spacing_mm, doc.scale_steps), (Some(s), k));
        assert_eq!(lib.ruler(&case).unwrap(), Some(RulerMarks { p1: [p1.0, p1.1], p2: [p2.0, p2.1], mm, steps: k }), "marks and mm stay the ruler's");
        compared += 1;
    }
    assert_eq!(compared, 42);
    // Deviation from the brief, found while watching this test fail for the wrong reason (24 Oct): the chained
    // sequence (-10..=10).chain((-10..=10).rev()) has 42 elements but ends at k = -10, not k = 0 — its per-step
    // bit-check above already proves no drift at every k, including -10. Returning to 0 explicitly before this
    // assertion is what the comment "back at 0 presses" actually needs.
    lib.recalibrate(&case, p1, p2, mm, 0, "op").unwrap();
    assert_eq!(lib.load(&case).unwrap().spacing_mm.unwrap().to_bits(), ruler.to_bits(), "back at 0 presses: the ruler's own value, bit for bit");
    lib.recalibrate(&case, p1, p2, mm, 10, "op").unwrap();
    for k in [11, -11, 1000, i64::MAX, i64::MIN] {
        let e = lib.recalibrate(&case, p1, p2, mm, k, "op").unwrap_err().to_string();
        assert!(e.contains("at most 5 %"), "{k}: {e}");
    }
    assert_eq!(lib.load(&case).unwrap().scale_steps, 10, "a refused press leaves the scale as it was");
    // A fresh calibration (also what a dropped ruler mark stores) starts again from 0 presses.
    lib.calibrate(&case, p1, (200.0, 47.0), mm, "op").unwrap();
    assert_eq!((lib.ruler(&case).unwrap().unwrap().steps, lib.load(&case).unwrap().scale_steps), (0, 0));
}

/// Addendum 3 (N), the before/after for the store: with no press, `calibrate` gives today's mm / px bit for bit, on
/// 1,000+ rulers. Positive control: compute `with_steps` as `(ruler × (200 + k)) / 200` and about one ruler in six fails.
#[test] fn an_unadjusted_calibration_is_todays_mm_per_px_bit_for_bit() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let (mut px, mut compared) = (20.0f64, 0);
    while px < 2000.0 {
        let (p1, p2) = ((10.0, 10.0), (10.0 + px, 13.0));
        let s = lib.calibrate(&case, p1, p2, 20.0, "op").unwrap();
        assert_eq!(s.to_bits(), (20.0 / (p2.0 - p1.0).hypot(p2.1 - p1.1)).to_bits(), "{px} px");   // library.rs:378-380 as it was
        assert_eq!(lib.ruler(&case).unwrap().unwrap().steps, 0);
        px += 1.37; compared += 1;
    }
    assert!(compared >= 1000, "{compared}");
}

/// Addendum 3 (N): only a spacing that is exactly a whole number of presses of its own marks (−10…+10) reads as a
/// fine-tune. Anything else was not written by this app, so it claims no marks and no presses.
#[test] fn a_spacing_that_is_not_whole_presses_of_its_marks_claims_none() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.recalibrate(&case, (10.0, 10.0), (210.0, 10.0), 20.0, 3, "op").unwrap();
    assert_eq!(lib.ruler(&case).unwrap().unwrap().steps, 3, "control: a real press reads back");
    for (what, factor) in [("a third of a press off", 1.015 + 0.005 / 3.0), ("12 presses, beyond ±5 %", 1.06)] {
        let s = 0.1 * factor;
        lib.conn_for_tests().execute("UPDATE calibrations SET spacing_mm = ?2 WHERE id = (SELECT MAX(id) FROM calibrations WHERE case_id = ?1)", rusqlite::params![case, s]).unwrap();
        lib.conn_for_tests().execute("UPDATE cases SET spacing_mm = ?2 WHERE id = ?1", rusqlite::params![case, s]).unwrap();
        assert_eq!(lib.ruler(&case).unwrap(), None, "{what}");
        assert_eq!(lib.load(&case).unwrap().scale_steps, 0, "{what}");
    }
}

/// Addendum 3 (N) + V3: a press changes every mm value, so it clears Tracing verified, as any calibration does; the
/// points do not move.
#[test] fn a_fine_tune_clears_tracing_verified_and_moves_no_point() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let mut s = ai("S", 1.0, 2.0); s.verified = true;
    lib.save(&edit(&case, vec![s]), "op").unwrap();
    lib.calibrate(&case, (10.0, 10.0), (210.0, 10.0), 20.0, "op").unwrap();
    lib.set_verified(&case, true, "dr-a").unwrap();
    assert!(lib.load(&case).unwrap().verified_at.is_some(), "control: signed off before the press");
    lib.recalibrate(&case, (10.0, 10.0), (210.0, 10.0), 20.0, 1, "op").unwrap();
    let doc = lib.load(&case).unwrap();
    assert!(doc.verified_at.is_none(), "every mm changed: back to review");
    assert_eq!((doc.landmarks[0].x, doc.landmarks[0].y, doc.landmarks[0].verified), (1.0, 2.0, true));
}

/// Fix round 1, review I-1 (Important): the read-back must tolerate the platform's `hypot` disagreeing by a few
/// bits (a different libm on Windows, or a macOS update), as long as it cannot confuse two neighbouring presses
/// (0.5 % apart). Perturbing the stored spacing by a few ULPs must still read back the same k.
#[test] fn a_fine_tune_reads_back_within_a_few_ulps_of_tolerance() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let (p1, p2, mm) = ((10.0, 10.0), (190.0, 47.0), 20.0);
    for k in [-10i64, -3, 0, 4, 10] {
        lib.recalibrate(&case, p1, p2, mm, k, "op").unwrap();
        let stored = lib.load(&case).unwrap().spacing_mm.unwrap();
        for ulps in [-3i64, -1, 1, 3] {
            let perturbed = f64::from_bits((stored.to_bits() as i64 + ulps) as u64);
            lib.conn_for_tests().execute("UPDATE calibrations SET spacing_mm = ?2 WHERE id = (SELECT MAX(id) FROM calibrations WHERE case_id = ?1)", rusqlite::params![case, perturbed]).unwrap();
            lib.conn_for_tests().execute("UPDATE cases SET spacing_mm = ?2 WHERE id = ?1", rusqlite::params![case, perturbed]).unwrap();
            assert_eq!(lib.ruler(&case).unwrap().map(|r| r.steps), Some(k), "k={k} ulps={ulps}");
            assert_eq!(lib.load(&case).unwrap().scale_steps, k, "k={k} ulps={ulps}");
        }
    }
}

/// Fix round 1, review I-1: the tolerance (1e-12) is about 9 orders below the 0.25 % gap half way between two
/// presses, so a spacing a quarter of a percent off the ruler still reads as no press at all — presses cannot be
/// confused with each other.
#[test] fn a_spacing_a_quarter_percent_off_still_claims_no_press() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let case = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    lib.calibrate(&case, (10.0, 10.0), (210.0, 10.0), 20.0, "op").unwrap();
    let ruler = lib.load(&case).unwrap().spacing_mm.unwrap();
    let s = ruler * 1.0025;   // half way between 0 presses (0 %) and 1 press (+0.5 %)
    lib.conn_for_tests().execute("UPDATE calibrations SET spacing_mm = ?2 WHERE id = (SELECT MAX(id) FROM calibrations WHERE case_id = ?1)", rusqlite::params![case, s]).unwrap();
    lib.conn_for_tests().execute("UPDATE cases SET spacing_mm = ?2 WHERE id = ?1", rusqlite::params![case, s]).unwrap();
    assert_eq!(lib.ruler(&case).unwrap(), None, "a quarter of a press off either side: no press");
    assert_eq!(lib.load(&case).unwrap().scale_steps, 0);
}

/// Library ▸ Table (owner decisions, 29 Oct 2026): `list()` carries the patient's gender and, for each film, which
/// model placed its AI points — 'auto-best' when any point went through Automatic best, else the model most of its
/// AI points carry, else `None` when every point is hand-placed (so the Table's AI status column never shows a raw
/// file id for a case with no AI involvement). Positive control: a case whose landmarks are all hand-placed must
/// come back with `ai_model_id: None`, proving the column is not always populated.
#[test] fn list_carries_gender_and_the_model_that_placed_each_films_ai_points() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let hand = lib.import(&synthetic_png(src.path(), "hand.png", 0)).unwrap().case_id;
    lib.save(&edit(&hand, vec![LandmarkRow { id: "N".into(), x: 1.0, y: 2.0, source: "manual".into(), verified: true,
        ai_x: None, ai_y: None, confidence: None, placed_by: None, accept_kind: Some("hand".into()), placed_via: None }]), "op").unwrap();
    lib.set_patient_gender(&hand, Some("F")).unwrap();

    let plain_ai = lib.import(&synthetic_png(src.path(), "plain.png", 1)).unwrap().case_id;
    lib.save(&edit(&plain_ai, vec![ai_via("S", 1.0, 2.0, "aariz-cepha29", None), ai_via("N", 3.0, 4.0, "aariz-cepha29", None)]), "op").unwrap();
    lib.set_patient_gender(&plain_ai, Some("M")).unwrap();

    let auto_best = lib.import(&synthetic_png(src.path(), "auto.png", 2)).unwrap().case_id;
    lib.save(&edit(&auto_best, vec![ai_via("S", 1.0, 2.0, "srpose-cldet23", Some("auto-best"))]), "op").unwrap();

    // A patient with no gender recorded (default: None, not a stray "Not recorded" string).
    let unrecorded = lib.import(&synthetic_png(src.path(), "unrec.png", 3)).unwrap().case_id;

    let rows = lib.list(false).unwrap();
    let find = |id: &str| rows.iter().find(|r| r.id == id).unwrap();
    assert_eq!(find(&hand).gender.as_deref(), Some("F"), "patients.gender carried through");
    assert_eq!(find(&hand).ai_model_id, None, "every point hand-placed: no model shown");
    assert_eq!(find(&plain_ai).gender.as_deref(), Some("M"));
    assert_eq!(find(&plain_ai).ai_model_id.as_deref(), Some("aariz-cepha29"), "the model that placed its AI points");
    assert_eq!(find(&auto_best).ai_model_id.as_deref(), Some("auto-best"), "Automatic best, even though a real model ran it");
    assert_eq!(find(&unrecorded).gender, None);
}

/// Library ▸ Table "Report" column (owner, 29 Oct; format 16): a film has no report date until one is recorded; recording
/// sets it on that film only, never moves the film in "most recent first" (its `updated_at` is untouched), and is
/// refused for a film that is not in the live library. Production change that fails it: `record_report_saved` writing
/// `updated_at` too, or `list()` not reading the column.
#[test] fn a_report_date_is_blank_until_recorded_and_recording_it_touches_nothing_else() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&synthetic_png(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&synthetic_png(src.path(), "b.png", 1)).unwrap().case_id;
    let rows = lib.list(false).unwrap();
    assert!(rows.iter().all(|r| r.report_saved_at.is_none()), "no report saved yet: {rows:?}");
    let before = rows.iter().find(|r| r.id == a).unwrap().clone();

    let at = lib.record_report_saved(&a).unwrap();
    assert!(at.len() >= 20 && at.ends_with('Z'), "a UTC timestamp: {at}");
    let rows = lib.list(false).unwrap();
    let now_a = rows.iter().find(|r| r.id == a).unwrap();
    assert_eq!(now_a.report_saved_at.as_deref(), Some(at.as_str()));
    assert_eq!(now_a.updated_at, before.updated_at, "recording a report is not an edit of the film");
    assert_eq!(rows.iter().find(|r| r.id == b).unwrap().report_saved_at, None, "only that film");

    let again = lib.record_report_saved(&a).unwrap();
    assert!(again >= at, "a later save replaces it with the later time: {at} -> {again}");

    assert!(lib.record_report_saved("no-such-film").is_err(), "an unknown film is refused");
    lib.delete(&b).unwrap();
    assert!(lib.record_report_saved(&b).is_err(), "a film in Recently deleted is refused");
    assert_eq!(lib.list(true).unwrap().iter().find(|r| r.id == b).unwrap().report_saved_at, None);
}
