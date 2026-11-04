//! Patient identity on synthetic films only: typed-in label values, never a real patient.
use ceph_store::{CaseMeta, IdentityIssue, IdentityRead, Library, PatientRef};
use std::path::{Path, PathBuf};

fn film(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let p = dir.join(name);
    image::GrayImage::from_fn(200, 150, |x, y| image::Luma([((x * 3 + y) as u8).wrapping_add(seed)])).save(&p).unwrap();
    p
}
fn read(name: Option<&str>, dob: Option<&str>, scan: Option<&str>, id: Option<&str>) -> IdentityRead {
    IdentityRead { name: name.map(Into::into), date_of_birth: dob.map(Into::into), scan_date: scan.map(Into::into), scan_id: id.map(Into::into) }
}
fn patients(root: &Path) -> i64 {
    rusqlite::Connection::open(root.join("library.sqlite3")).unwrap().query_row("SELECT COUNT(*) FROM patients", [], |r| r.get(0)).unwrap()
}

#[test] fn a_clear_label_fills_the_case_silently() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "scan-0001.png", 0)).unwrap().case_id;
    let out = lib.apply_label(&c, &read(Some("Demo Synthetic"), Some("1990-03-07"), Some("2026-09-12"), Some("4471"))).unwrap();
    assert!(out.checked && out.issues.is_empty(), "{:?}", out.issues);
    let d = lib.load(&c).unwrap();
    assert_eq!((d.patient_name.as_str(), d.date_of_birth.as_deref(), d.taken_on.as_deref(), d.scan_id.as_deref()),
        ("Demo Synthetic", Some("1990-03-07"), Some("2026-09-12"), Some("4471")));
    assert_eq!((d.identity_source.as_str(), d.identity_checked, d.timepoint.as_str(), d.patient_key.as_str()), ("film", true, "T1", "demo synthetic"));
    assert_eq!(patients(t.path()), 1, "the placeholder patient named after the file is gone");
}

/// Review focus 4: two films of the same new patient (e.g. one batch) are one patient, T1 and T2.
#[test] fn a_second_film_with_the_same_name_and_birth_date_is_the_same_patient_as_t2() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&film(src.path(), "b.png", 9)).unwrap().case_id;
    lib.apply_label(&a, &read(Some("Demo Synthetic"), Some("1990-03-07"), Some("2024-01-10"), None)).unwrap();
    let out = lib.apply_label(&b, &read(Some("DEMO SYNTHETIC"), Some("1990-03-07"), Some("2026-09-12"), None)).unwrap();
    assert!(out.checked);
    let (da, db) = (lib.load(&a).unwrap(), lib.load(&b).unwrap());
    assert_eq!((da.timepoint.as_str(), db.timepoint.as_str()), ("T1", "T2"));
    assert_eq!(da.patient_name, db.patient_name);
    assert_eq!(patients(t.path()), 1);
}

/// Review focus 3.
#[test] fn surname_first_and_accented_spellings_link_to_one_patient() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&film(src.path(), "b.png", 5)).unwrap().case_id;
    lib.apply_label(&a, &read(Some("Zoë O'Brien"), Some("2012-05-01"), None, None)).unwrap();
    lib.apply_label(&b, &read(Some("OBrien, Zoe"), Some("2012-05-01"), None, None)).unwrap();
    assert_eq!(lib.load(&b).unwrap().patient_name, "Zoë O'Brien", "the existing patient keeps its printed name");
    assert_eq!(patients(t.path()), 1);
}

#[test] fn same_name_with_another_birth_date_asks_and_names_the_other_patient() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&film(src.path(), "b.png", 1)).unwrap().case_id;
    lib.apply_label(&a, &read(Some("Demo Synthetic"), Some("1990-03-07"), None, None)).unwrap();
    let out = lib.apply_label(&b, &read(Some("Demo Synthetic"), Some("1991-03-07"), None, None)).unwrap();
    assert!(!out.checked);
    assert_eq!(out.issues, vec![IdentityIssue::SameNameOtherBirth { patient: PatientRef { name: "Demo Synthetic".into(), date_of_birth: Some("1990-03-07".into()) } }]);
    let d = lib.load(&b).unwrap();
    assert!(!d.identity_checked && d.identity_issues == out.issues);
    assert_eq!(patients(t.path()), 2);
    assert!(!lib.list(false).unwrap().iter().find(|s| s.id == b).unwrap().identity_checked);
}

#[test] fn a_slightly_different_or_swapped_name_with_the_same_birth_date_asks() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    lib.apply_label(&a, &read(Some("Demo Synthetic"), Some("1990-03-07"), None, None)).unwrap();
    for (seed, name) in [(1u8, "Demo Synthetik"), (2, "Synthetic Demo")] {
        let b = lib.import(&film(src.path(), &format!("{seed}.png"), seed)).unwrap().case_id;
        let out = lib.apply_label(&b, &read(Some(name), Some("1990-03-07"), None, None)).unwrap();
        assert!(!out.checked, "{name}");
        assert!(out.issues.iter().any(|i| matches!(i, IdentityIssue::SimilarNameSameBirth { patient } if patient.name == "Demo Synthetic")), "{name}: {:?}", out.issues);
    }
}

/// Review focus 2: nothing readable → nothing filled, the name stays blank (never the file name), and the clinician is asked.
#[test] fn nothing_read_leaves_the_name_blank_and_asks() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "Demo patient 07.png", 0)).unwrap().case_id;
    let out = lib.apply_label(&c, &IdentityRead::default()).unwrap();
    assert_eq!((out.checked, out.issues.clone()), (false, vec![IdentityIssue::NameNotRead, IdentityIssue::NoDateOfBirth]));
    let d = lib.load(&c).unwrap();
    assert_eq!((d.patient_name.as_str(), d.identity_source.as_str()), ("", "manual"));
}

#[test] fn impossible_or_out_of_order_dates_ask() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let out = lib.apply_label(&a, &read(Some("Demo One"), Some("2999-01-01"), Some("1899-12-31"), None)).unwrap();
    assert!(out.issues.contains(&IdentityIssue::ImpossibleDate { field: "dateOfBirth".into() }));
    assert!(out.issues.contains(&IdentityIssue::ImpossibleDate { field: "scanDate".into() }));
    let b = lib.import(&film(src.path(), "b.png", 1)).unwrap().case_id;
    let out = lib.apply_label(&b, &read(Some("Demo Two"), Some("2020-05-01"), Some("2019-01-01"), None)).unwrap();
    assert_eq!(out.issues, vec![IdentityIssue::BirthAfterScan]);
    // A malformed date from the reader is ignored, not stored.
    let c = lib.import(&film(src.path(), "c.png", 2)).unwrap().case_id;
    lib.apply_label(&c, &read(Some("Demo Three"), Some("1990-02-30"), None, None)).unwrap();
    assert_eq!(lib.load(&c).unwrap().date_of_birth, None);
}

#[test] fn confirming_same_patient_moves_the_case_and_different_patient_keeps_it() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&film(src.path(), "b.png", 1)).unwrap().case_id;
    let c = lib.import(&film(src.path(), "c.png", 2)).unwrap().case_id;
    lib.apply_label(&a, &read(Some("Demo Synthetic"), Some("1990-03-07"), None, None)).unwrap();
    lib.apply_label(&b, &read(Some("Demo Synthetik"), Some("1990-03-07"), None, None)).unwrap();
    lib.apply_label(&c, &read(Some("Demo Synthetic"), Some("1991-01-01"), None, None)).unwrap();
    let existing = PatientRef { name: "Demo Synthetic".into(), date_of_birth: Some("1990-03-07".into()) };
    lib.confirm_identity(&b, Some(&existing)).unwrap();
    let d = lib.load(&b).unwrap();
    assert_eq!((d.patient_name.as_str(), d.timepoint.as_str(), d.identity_checked, d.identity_source.as_str()), ("Demo Synthetic", "T2", true, "manual"));
    lib.confirm_identity(&c, None).unwrap();
    let d = lib.load(&c).unwrap();
    assert_eq!((d.date_of_birth.as_deref(), d.identity_checked), (Some("1991-01-01"), true));
    assert_eq!(patients(t.path()), 2, "the misspelt patient left with no cases is removed");
    let gone = PatientRef { name: "Nobody".into(), date_of_birth: None };
    assert!(lib.confirm_identity(&c, Some(&gone)).unwrap_err().to_string().contains("no longer in the library"));
}

#[test] fn editing_the_details_sets_name_birth_date_and_scan_id_and_counts_as_checked() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    lib.apply_label(&c, &IdentityRead::default()).unwrap();
    let meta = CaseMeta { patient_name: "Demo Synthetic".into(), timepoint: "T1".into(), taken_on: Some("2026-09-12".into()),
        date_of_birth: Some("1990-03-07".into()), scan_id: Some(" 4471 ".into()) };
    lib.set_meta(&c, &meta).unwrap();
    let d = lib.load(&c).unwrap();
    assert_eq!((d.date_of_birth.as_deref(), d.scan_id.as_deref(), d.identity_checked, d.identity_source.as_str()), (Some("1990-03-07"), Some("4471"), true, "manual"));
    let bad = CaseMeta { date_of_birth: Some("1990-02-30".into()), ..meta };
    assert!(lib.set_meta(&c, &bad).unwrap_err().to_string().contains("not a valid date"));
    assert_eq!(lib.list(false).unwrap()[0].date_of_birth.as_deref(), Some("1990-03-07"));
    assert_eq!(lib.list(false).unwrap()[0].patient_key, "demo synthetic");
}

#[test] fn today_is_the_macs_local_date() {
    let t = tempfile::tempdir().unwrap();
    let today = Library::open(t.path()).unwrap().today_local().unwrap();
    assert_eq!(today.len(), 10);
    assert!(ceph_store::identity::iso_date_ok(&today));
}

/// Final review, important 2: a Week 3 patient (no date of birth) and a new film of that name with one: it asks, and
/// "Same patient" keeps one patient, as T2, and records the date of birth.
#[test] fn a_same_name_patient_without_a_birth_date_is_offered_and_gets_it_on_confirm() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    lib.set_meta(&a, &CaseMeta { patient_name: "Demo Olden".into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None }).unwrap();   // Week 3: no date of birth
    let b = lib.import(&film(src.path(), "b.png", 1)).unwrap().case_id;
    let out = lib.apply_label(&b, &read(Some("OLDEN, DEMO"), Some("2012-02-01"), None, None)).unwrap();
    let existing = PatientRef { name: "Demo Olden".into(), date_of_birth: None };
    assert!(!out.checked);
    assert!(out.issues.contains(&IdentityIssue::SameNameOtherBirth { patient: existing.clone() }), "{:?}", out.issues);
    lib.confirm_identity(&b, Some(&existing)).unwrap();
    let (da, db) = (lib.load(&a).unwrap(), lib.load(&b).unwrap());
    assert_eq!((db.patient_name.as_str(), db.timepoint.as_str()), ("Demo Olden", "T2"));
    assert_eq!((da.date_of_birth.as_deref(), db.date_of_birth.as_deref()), (Some("2012-02-01"), Some("2012-02-01")));
    assert_eq!(patients(t.path()), 1);
}

/// Owner, 29 Sep: film date = the label's, else the image file's EXIF date, else the import date; the source is kept.
#[test] fn the_film_date_falls_back_to_the_image_file_then_the_import_date() {
    use image::ImageEncoder;
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    // A synthetic JPEG whose EXIF says it was taken on 10 Jan 2024.
    let dt = exif::Field { tag: exif::Tag::DateTimeOriginal, ifd_num: exif::In::PRIMARY, value: exif::Value::Ascii(vec![b"2024:01:10 09:30:00".to_vec()]) };
    let mut w = exif::experimental::Writer::new(); w.push_field(&dt);
    let mut raw = std::io::Cursor::new(Vec::new()); w.write(&mut raw, false).unwrap();
    let mut jpg = Vec::new();
    let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut jpg, 90);
    enc.set_exif_metadata(raw.into_inner()).unwrap();
    enc.write_image(image::GrayImage::from_fn(64, 48, |x, y| image::Luma([(x + y) as u8])).as_raw(), 64, 48, image::ExtendedColorType::L8).unwrap();
    std::fs::write(src.path().join("dated.jpg"), &jpg).unwrap();
    let a = lib.import(&src.path().join("dated.jpg")).unwrap().case_id;
    let d = lib.load(&a).unwrap();
    assert_eq!((d.taken_on.as_deref(), d.taken_on_source.as_deref()), (Some("2024-01-10"), Some("image")));
    // No label date: the file's date stays. A label date wins.
    lib.apply_label(&a, &read(Some("Demo Synthetic"), Some("1990-03-07"), None, None)).unwrap();
    assert_eq!(lib.load(&a).unwrap().taken_on_source.as_deref(), Some("image"));
    lib.apply_label(&a, &read(Some("Demo Synthetic"), Some("1990-03-07"), Some("2024-01-12"), None)).unwrap();
    let d = lib.load(&a).unwrap();
    assert_eq!((d.taken_on.as_deref(), d.taken_on_source.as_deref()), (Some("2024-01-12"), Some("label")));
    // A PNG with no metadata: the import date (today, on this Mac).
    let b = lib.import(&film(src.path(), "plain.png", 3)).unwrap().case_id;
    let d = lib.load(&b).unwrap();
    assert_eq!((d.taken_on.clone(), d.taken_on_source.as_deref()), (Some(lib.today_local().unwrap()), Some("import")));
    // Editing another field keeps the note; typing a date or pressing OK makes it the clinician's.
    let meta = CaseMeta { patient_name: "Demo Two".into(), timepoint: "T1".into(), taken_on: d.taken_on.clone(), date_of_birth: None, scan_id: None };
    lib.set_meta(&b, &meta).unwrap();
    assert_eq!(lib.load(&b).unwrap().taken_on_source.as_deref(), Some("import"));
    lib.confirm_film_date(&b).unwrap();
    assert_eq!(lib.load(&b).unwrap().taken_on_source.as_deref(), Some("manual"));
    lib.set_meta(&a, &CaseMeta { taken_on: Some("2024-01-11".into()), ..meta }).unwrap();
    assert_eq!(lib.load(&a).unwrap().taken_on_source.as_deref(), Some("manual"));
}

/// Owner, 29 Sep: a wrong name is worse than none. The file name ("Lateral Ceph.jpg") is never the patient's name: a film
/// starts unnamed, and two unnamed films are never the same patient.
#[test] fn an_imported_film_is_unnamed_until_its_name_is_read_or_typed_and_unnamed_films_are_never_linked() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "Lateral Ceph.png", 0)).unwrap().case_id;
    let b = lib.import(&film(src.path(), "Lateral Ceph 2.png", 9)).unwrap().case_id;
    let out = lib.apply_label(&b, &read(None, Some("1990-03-07"), None, None)).unwrap();
    let c = lib.import(&film(src.path(), "Lateral Ceph 3.png", 5)).unwrap().case_id;
    lib.apply_label(&c, &read(None, Some("1990-03-07"), None, None)).unwrap();
    let (da, db, dc) = (lib.load(&a).unwrap(), lib.load(&b).unwrap(), lib.load(&c).unwrap());
    assert_eq!((da.patient_name.as_str(), db.patient_name.as_str(), dc.patient_name.as_str()), ("", "", ""));
    assert_eq!((da.timepoint.as_str(), db.timepoint.as_str(), dc.timepoint.as_str()), ("T1", "T1", "T1"), "each unnamed film is its own patient");
    assert_eq!(patients(t.path()), 3);
    assert!(!out.checked && out.issues == vec![IdentityIssue::NameNotRead], "{:?}", out.issues);
}

#[test] fn dates_can_be_saved_while_the_name_is_blank_and_the_case_still_asks_for_the_name() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&film(src.path(), "b.png", 9)).unwrap().case_id;
    for id in [&a, &b] {
        lib.set_meta(id, &CaseMeta { patient_name: "  ".into(), timepoint: "T1".into(), taken_on: Some("2024-02-07".into()),
            date_of_birth: Some("1990-03-07".into()), scan_id: Some("5566".into()) }).unwrap();
    }
    let d = lib.load(&a).unwrap();
    assert_eq!((d.patient_name.as_str(), d.date_of_birth.as_deref(), d.taken_on.as_deref(), d.scan_id.as_deref()),
        ("", Some("1990-03-07"), Some("2024-02-07"), Some("5566")));
    assert!(!d.identity_checked && d.identity_issues == vec![IdentityIssue::NameNotRead], "{:?}", d.identity_issues);
    assert_eq!(patients(t.path()), 2, "same date of birth, no names: still two patients");
    assert!(lib.confirm_identity(&a, None).unwrap_err().to_string().contains("name"), "OK is refused until a name is typed");
    lib.set_meta(&a, &CaseMeta { patient_name: "Demo Synthetic".into(), timepoint: "T1".into(), taken_on: Some("2024-02-07".into()),
        date_of_birth: Some("1990-03-07".into()), scan_id: Some("5566".into()) }).unwrap();
    let d = lib.load(&a).unwrap();
    assert!(d.identity_checked && d.patient_name == "Demo Synthetic");
}
