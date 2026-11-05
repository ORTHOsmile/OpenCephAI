//! Format 13 (spec 2026-10-19; owner T1, AG1): Title on the patient, the age on each X-ray. Synthetic films only.
use ceph_store::{CaseMeta, Library, NOT_AN_AGE, NOT_A_TITLE};
use rusqlite::types::Value;
use std::path::{Path, PathBuf};

fn synthetic_png(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn meta(name: &str, dob: Option<&str>) -> CaseMeta {
    CaseMeta { patient_name: name.into(), timepoint: "T1".into(), taken_on: None, date_of_birth: dob.map(Into::into), scan_id: None }
}
fn films(n: u8) -> (tempfile::TempDir, tempfile::TempDir, Library, Vec<String>) {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let ids = (0..n).map(|i| lib.import(&synthetic_png(src.path(), &format!("synthetic-{i}.png"), i * 40)).unwrap().case_id).collect();
    (t, src, lib, ids)
}
fn case_row(lib: &Library, id: &str) -> Vec<(String, Value)> {
    let c = lib.conn_for_tests();
    let cols: Vec<String> = c.prepare("SELECT name FROM pragma_table_info('cases')").unwrap().query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    c.query_row(&format!("SELECT {} FROM cases WHERE id = ?1", cols.join(", ")), [id], |r| Ok(cols.iter().enumerate().map(|(i, n)| (n.clone(), r.get::<_, Value>(i).unwrap())).collect())).unwrap()
}
fn titles() -> serde_json::Value { serde_json::from_str(include_str!("fixtures/titles.json")).unwrap() }

#[test] fn a_title_is_saved_on_the_patient_and_shown_on_every_film() {
    let (_t, _s, mut lib, ids) = films(2);
    for id in &ids { lib.set_meta(id, &meta("Demo Title", Some("1990-03-07"))).unwrap(); }   // SYNTHETIC
    lib.set_patient_title(&ids[0], Some("  Mr  ")).unwrap();
    assert_eq!(lib.load(&ids[1]).unwrap().title.as_deref(), Some("Mr"));
    lib.set_patient_title(&ids[1], Some("Dr.")).unwrap();                                       // R6: the last saved wins
    assert_eq!(lib.load(&ids[0]).unwrap().title.as_deref(), Some("Dr."));
    lib.set_patient_title(&ids[0], Some("   ")).unwrap();
    assert_eq!(lib.load(&ids[1]).unwrap().title, None, "blank clears");
}
#[test] fn a_title_is_one_of_the_owners_words_on_the_shared_table() {
    let (_t, _s, mut lib, ids) = films(1);
    let t = titles();
    for v in t["accept"].as_array().unwrap() { let v = v.as_str().unwrap(); lib.set_patient_title(&ids[0], Some(v)).unwrap(); assert_eq!(lib.load(&ids[0]).unwrap().title.as_deref(), Some(v)); }
    for v in t["refuse"].as_array().unwrap() {
        let v = v.as_str().unwrap();
        assert_eq!(lib.set_patient_title(&ids[0], Some(v)).unwrap_err().to_string(), NOT_A_TITLE, "{v:?}");
    }
    assert_eq!(NOT_A_TITLE, "That isn't a title (Mr, Mrs, Ms, Miss, Master, Dr…)");
}
#[test] fn a_film_renamed_to_a_new_patient_keeps_its_title_and_one_joining_another_shows_that_patients() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.set_patient_title(&ids[0], Some("Mrs")).unwrap();
    lib.set_meta(&ids[0], &meta("Demo Renamed", None)).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().title.as_deref(), Some("Mrs"), "a new patient keeps the old one's title, as Gender");
    lib.set_meta(&ids[1], &meta("Demo Other", None)).unwrap();
    lib.set_patient_title(&ids[1], Some("Dr")).unwrap();
    lib.set_meta(&ids[0], &meta("Demo Other", None)).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().title.as_deref(), Some("Dr"), "joining an existing patient shows THAT patient's title");
}
#[test] fn the_age_is_on_this_film_only_and_writes_nothing_else() {
    let (_t, _s, mut lib, ids) = films(2);
    for id in &ids { lib.set_meta(id, &meta("Demo Age", None)).unwrap(); }
    let (a0, b0) = (case_row(&lib, &ids[0]), case_row(&lib, &ids[1]));
    lib.set_film_age(&ids[0], Some(" 011Y "), Some(11.0)).unwrap();
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.age_on_film.as_deref(), d.age_on_film_years), (Some("011Y"), Some(11.0)));
    assert_eq!(lib.load(&ids[1]).unwrap().age_on_film, None, "each X-ray keeps its own age");
    let a1: Vec<_> = case_row(&lib, &ids[0]).into_iter().filter(|(n, _)| n != "age_on_film" && n != "age_on_film_years").collect();
    let a0: Vec<_> = a0.into_iter().filter(|(n, _)| n != "age_on_film" && n != "age_on_film_years").collect();
    assert_eq!(a1, a0, "no other column of this film changed (verified, updated_at, details…)");
    assert_eq!(case_row(&lib, &ids[1]), b0, "the other film is untouched");
    lib.set_film_age(&ids[0], None, None).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().age_on_film_years, None, "both blank clears");
}
#[test] fn an_age_is_both_or_neither_and_between_0_and_120_years() {
    let (_t, _s, mut lib, ids) = films(1);
    for (why, p, y) in [("no years", Some("011Y"), None), ("no text", None, Some(11.0)), ("zero", Some("000Y"), Some(0.0)),
                        ("negative", Some("x"), Some(-1.0)), ("over 120", Some("121Y"), Some(120.0001)), ("NaN", Some("x"), Some(f64::NAN)),
                        ("infinite", Some("x"), Some(f64::INFINITY))] {
        assert_eq!(lib.set_film_age(&ids[0], p, y).unwrap_err().to_string(), NOT_AN_AGE, "{why}");
    }
    assert!(lib.set_film_age(&ids[0], Some(&"1".repeat(201)), Some(11.0)).unwrap_err().to_string().contains("too long"));
    lib.set_film_age(&ids[0], Some("120Y"), Some(120.0)).unwrap();
    assert_eq!(NOT_AN_AGE, "That isn't an age");
}
#[test] fn a_film_in_recently_deleted_refuses_both_saves() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.delete(&ids[0]).unwrap();
    assert!(lib.set_patient_title(&ids[0], Some("Mr")).is_err());
    assert!(lib.set_film_age(&ids[0], Some("011Y"), Some(11.0)).is_err());
}
/// Final review M4: an empty or blank printed age with a number is refused in the owner's words, never as a database
/// error ("CHECK constraint failed"); both blank clears (Task 11: blank typed clears). Positive control: pass `printed`
/// through untrimmed in `set_film_age` -> the empty string reaches the CHECK and this fails.
#[test] fn an_empty_printed_age_is_refused_in_the_owners_words() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_film_age(&ids[0], Some("011Y"), Some(11.0)).unwrap();
    for (why, p) in [("empty", ""), ("spaces", "   "), ("tab", "\t")] {
        assert_eq!(lib.set_film_age(&ids[0], Some(p), Some(11.0)).unwrap_err().to_string(), NOT_AN_AGE, "{why}");
    }
    assert_eq!(lib.load(&ids[0]).unwrap().age_on_film.as_deref(), Some("011Y"), "a refused age changes nothing");
    lib.set_film_age(&ids[0], Some(" "), None).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().age_on_film_years, None, "blank and no number: cleared");
}
