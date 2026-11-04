//! Format 11 (spec 2026-10-17, owner D-FIELDS-1; addendum D2 Q8): Patient ID, X-ray type, X-ray dimensions and
//! Radiography practice on the film. Synthetic films, names and IDs only.
use ceph_store::{CaseMeta, FilmDetailsRead, IdentityRead, Library, PatientRef};
use rusqlite::types::Value;
use std::path::{Path, PathBuf};

fn synthetic_png(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
pub fn meta(name: &str, dob: Option<&str>) -> CaseMeta {
    CaseMeta { patient_name: name.into(), timepoint: "T1".into(), taken_on: None, date_of_birth: dob.map(Into::into), scan_id: None }
}
/// A library holding `n` synthetic films, and their case ids.
pub fn films(n: u8) -> (tempfile::TempDir, tempfile::TempDir, Library, Vec<String>) {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let ids = (0..n).map(|i| lib.import(&synthetic_png(src.path(), &format!("synthetic-{i}.png"), i * 40)).unwrap().case_id).collect();
    (t, src, lib, ids)
}

/// Every column of one row, by name, for the D4 whole-row comparison: a single-field save must change only the
/// column it names (and, for a typed value, its own "Learned for this machine" mark) — never a neighbour's.
fn row_snapshot(lib: &Library, table: &str, id_col: &str, id: &str) -> Vec<(String, Value)> {
    let conn = lib.conn_for_tests();
    let cols: Vec<String> = conn.prepare(&format!("PRAGMA table_info({table})")).unwrap()
        .query_map([], |r| r.get::<_, String>(1)).unwrap().collect::<Result<_, _>>().unwrap();
    let select = format!("SELECT {} FROM {table} WHERE {id_col} = ?1", cols.join(", "));
    conn.query_row(&select, [id], |r| {
        Ok(cols.iter().enumerate().map(|(i, c)| (c.clone(), r.get::<_, Value>(i).unwrap())).collect())
    }).unwrap()
}
/// The patient id of a case, for `row_snapshot("patients", ...)`.
fn patient_of(lib: &Library, case_id: &str) -> String {
    lib.conn_for_tests().query_row("SELECT patient_id FROM cases WHERE id = ?1", [case_id], |r| r.get(0)).unwrap()
}
/// Names of columns that differ between two whole-row snapshots (same columns, same order).
fn changed_columns(before: &[(String, Value)], after: &[(String, Value)]) -> Vec<String> {
    before.iter().zip(after).filter(|(b, a)| b.1 != a.1).map(|(b, _)| b.0.clone()).collect()
}

#[test] fn a_new_film_starts_with_every_new_detail_blank() {
    let (_t, _s, lib, ids) = films(1);
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.printed_patient_id, d.xray_type, d.xray_size, d.radiography_practice), (None, None, None, None));
    let v = serde_json::to_value(lib.load(&ids[0]).unwrap()).unwrap();
    for k in ["printedPatientId", "xrayType", "xraySize", "radiographyPractice"] {
        assert_eq!(v.get(k), Some(&serde_json::Value::Null), "{k} is sent to the screen, as null (a missing key would also index as null)");
    }
}

/// A helper for reading several films' Patient IDs at once (addendum D2, Q8).
fn ids_on(lib: &Library, ids: &[String]) -> Vec<Option<String>> { ids.iter().map(|i| lib.load(i).unwrap().printed_patient_id).collect() }

/// Owner Q8 (17 Oct): each X-ray keeps its own Patient ID; the patient's other X-ray does not show it.
#[test] fn a_patient_id_is_saved_on_its_own_xray_only() {
    let (_t, _s, mut lib, ids) = films(2);
    for id in &ids { lib.set_meta(id, &meta("Demo Synthetic", Some("1990-03-07"))).unwrap(); }   // SYNTHETIC
    lib.set_patient_id(&ids[0], Some("  ZQ-7781  ")).unwrap();
    assert_eq!(ids_on(&lib, &ids), [Some("ZQ-7781".into()), None]);
}
#[test] fn each_save_writes_only_its_own_detail() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.set_film_detail(&ids[0], "xray_type", Some("Lateral Ceph")).unwrap();
    lib.set_film_detail(&ids[0], "xray_size", Some("24 x 30 cm")).unwrap();
    lib.set_film_detail(&ids[0], "practice", Some("Demo Radiology Northside")).unwrap();
    lib.set_patient_id(&ids[0], Some("A-1")).unwrap();
    lib.set_patient_gender(&ids[0], Some("F")).unwrap();
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();                 // CaseMeta carries none of them
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.xray_type.as_deref(), d.xray_size.as_deref(), d.radiography_practice.as_deref(), d.printed_patient_id.as_deref(), d.gender.as_deref()),
        (Some("Lateral Ceph"), Some("24 x 30 cm"), Some("Demo Radiology Northside"), Some("A-1"), Some("F")));
}
/// D4 (preflight ruling, Task 2; review round 1, Important 2): compares the WHOLE patient and case rows of THREE
/// films before/after each single-field save — A, B (B shares A's patient) and C (a different patient) — so a save
/// whose `UPDATE` lost its `WHERE id = ?1` (or a `set_patient_id` that wrote every patient) is caught even though a
/// `films(1)` library has no second row for it to leak onto. Not only the field a save claims to touch: a save that
/// accidentally writes a neighbour's column, another film's row or another patient's row is caught even if that
/// column happens to hold the right value for an unrelated reason.
#[test] fn a_single_field_save_changes_only_its_own_row() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo Shared", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Shared", None)).unwrap();      // B: same patient as A
    lib.set_meta(&ids[2], &meta("Demo Other", None)).unwrap();       // C: a different patient
    let (pid_ab, pid_c) = (patient_of(&lib, &ids[0]), patient_of(&lib, &ids[2]));
    assert_eq!(patient_of(&lib, &ids[1]), pid_ab, "B must share A's patient for this test to mean anything");
    assert_ne!(pid_ab, pid_c, "C must be a different patient for this test to mean anything");

    fn snapshot(lib: &Library, ids: &[String], pid_ab: &str, pid_c: &str) -> [Vec<(String, Value)>; 5] {
        [row_snapshot(lib, "cases", "id", &ids[0]), row_snapshot(lib, "cases", "id", &ids[1]), row_snapshot(lib, "cases", "id", &ids[2]),
         row_snapshot(lib, "patients", "id", pid_ab), row_snapshot(lib, "patients", "id", pid_c)]
    }
    let labels = ["A's case row", "B's case row (same patient)", "C's case row (different patient)", "the shared A/B patient row", "C's patient row"];

    let before = snapshot(&lib, &ids, &pid_ab, &pid_c);
    lib.set_patient_id(&ids[0], Some("A-1")).unwrap();
    let after = snapshot(&lib, &ids, &pid_ab, &pid_c);
    for i in [1, 2, 3, 4] { assert_eq!(changed_columns(&before[i], &after[i]), Vec::<String>::new(), "set_patient_id touched {}", labels[i]); }
    assert_eq!(changed_columns(&before[0], &after[0]), vec!["printed_patient_id".to_string()], "set_patient_id's only change");
    assert_eq!(lib.load(&ids[1]).unwrap().printed_patient_id, None, "B shares A's patient but keeps its own (blank) ID");

    for (field, column, value) in [("xray_type", "xray_type", "Lateral Ceph"), ("xray_size", "xray_size", "24 x 30 cm"), ("practice", "radiography_practice", "Demo Radiology")] {
        let before = snapshot(&lib, &ids, &pid_ab, &pid_c);
        lib.set_film_detail(&ids[0], field, Some(value)).unwrap();
        let after = snapshot(&lib, &ids, &pid_ab, &pid_c);
        assert_eq!(changed_columns(&before[0], &after[0]), vec![column.to_string()], "set_film_detail({field:?})'s only change");
        for i in [1, 2, 3, 4] { assert_eq!(changed_columns(&before[i], &after[i]), Vec::<String>::new(), "set_film_detail({field:?}) touched {}", labels[i]); }
    }
}
#[test] fn blank_saves_as_nothing_and_over_200_characters_is_refused() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_film_detail(&ids[0], "practice", Some("Demo Radiology")).unwrap();
    lib.set_film_detail(&ids[0], "practice", Some("   ")).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().radiography_practice, None);
    lib.set_film_detail(&ids[0], "xray_size", Some(&"x".repeat(200))).unwrap();
    let e = lib.set_film_detail(&ids[0], "xray_size", Some(&"y".repeat(201))).unwrap_err().to_string();
    assert!(e.contains("too long"), "{e}");
    assert_eq!(lib.load(&ids[0]).unwrap().xray_size.map(|s| s.len()), Some(200), "a refused save changes nothing");
    assert!(lib.set_patient_id(&ids[0], Some(&"9".repeat(201))).unwrap_err().to_string().contains("too long"));
    // Review round 1, Minor 3: spaces-only and exactly-200 for the Patient ID too, not only a film detail.
    lib.set_patient_id(&ids[0], Some("A-1")).unwrap();
    lib.set_patient_id(&ids[0], Some("   ")).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().printed_patient_id, None, "a spaces-only Patient ID saves as NULL");
    lib.set_patient_id(&ids[0], Some(&"9".repeat(200))).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().printed_patient_id.map(|s| s.len()), Some(200), "exactly 200 characters is accepted");
    lib.set_patient_id(&ids[0], None).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().printed_patient_id, None);
}
#[test] fn an_unknown_film_detail_is_refused() {
    let (_t, _s, mut lib, ids) = films(1);
    for bad in ["radiography_practice", "patient_id", "xray_type; DROP TABLE cases", ""] {
        let e = lib.set_film_detail(&ids[0], bad, Some("x")).unwrap_err().to_string();
        assert!(e.contains("unknown film detail"), "{bad:?}: {e}");
    }
}
#[test] fn a_deleted_film_refuses_new_details() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.delete(&ids[0]).unwrap();
    assert!(lib.set_patient_id(&ids[0], Some("A-1")).unwrap_err().to_string().contains("Recently deleted"));
    assert!(lib.set_film_detail(&ids[0], "xray_type", Some("Lateral Ceph")).unwrap_err().to_string().contains("Recently deleted"));
}
/// Task 11 whole-branch edge sweep: every other new D2 save also refuses on a deleted film, not only
/// `set_patient_id`/`set_film_detail` above (which already have their own test). `apply_learned_details`,
/// `accept_learned` and `not_same_patient` have the same coverage elsewhere in this file; `set_patient_gender`/
/// `set_patient_referrer` in `patient_details.rs`. Positive control below: commenting out `live_case` in
/// `confirm_identity` makes this fail (the merge runs on the deleted film instead of refusing).
#[test] fn a_deleted_film_refuses_apply_label_patient_id_and_confirm_identity_too() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo Here", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo There", None)).unwrap();
    lib.delete(&ids[0]).unwrap();
    assert!(lib.apply_label_patient_id(&ids[0], Some("5566")).unwrap_err().to_string().contains("Recently deleted"));
    assert!(lib.confirm_identity(&ids[0], Some(&PatientRef { name: "Demo There".into(), date_of_birth: None }))
        .unwrap_err().to_string().contains("Recently deleted"));
}
#[test] fn a_save_removes_only_its_own_learned_mark() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.conn_for_tests().execute("UPDATE cases SET learned_fields = 'name,patient_id,xray_type,practice' WHERE id = ?1", [&ids[0]]).unwrap();
    lib.set_film_detail(&ids[0], "xray_type", Some("PA Ceph")).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().learned_fields, ["name", "patient_id", "practice"]);
    lib.set_patient_id(&ids[0], Some("A-1")).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().learned_fields, ["name", "practice"]);
}
/// Positive control for the `changed` change in `set_meta`: before it, any field set_meta does not know counted as
/// "changed", so a name edit silently dropped the new details' "Learned for this machine".
#[test] fn editing_the_name_keeps_the_new_details_marked_learned() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.conn_for_tests().execute("UPDATE cases SET learned_fields = 'patient_id,xray_type,practice' WHERE id = ?1", [&ids[0]]).unwrap();
    lib.set_meta(&ids[0], &meta("Demo Renamed", None)).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().learned_fields, ["patient_id", "xray_type", "practice"]);
}
#[test] fn a_film_renamed_to_a_new_patient_keeps_its_patient_id() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.set_patient_id(&ids[0], Some("A-1")).unwrap();
    lib.set_meta(&ids[0], &meta("Demo Renamed", None)).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().printed_patient_id.as_deref(), Some("A-1"));
}
/// Owner Q8: joining a patient — a typed name, "Same patient", or the label at import — never drops or changes an
/// X-ray's Patient ID, even when it empties (and so deletes) the X-ray's old patient record. Withdraws Q3 and
/// ruling I1.
#[test] fn joining_a_patient_never_drops_or_changes_an_xrays_patient_id() {
    let (_t, _s, mut lib, ids) = films(4);
    lib.set_meta(&ids[0], &meta("Demo Held", Some("1991-04-08"))).unwrap();     // SYNTHETIC
    lib.set_patient_id(&ids[0], Some("H-1")).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Source", Some("1991-04-08"))).unwrap();   // SYNTHETIC — its own patient, only film
    lib.set_patient_id(&ids[1], Some("S-2")).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Held", Some("1991-04-08"))).unwrap();     // SYNTHETIC — typed join
    lib.set_meta(&ids[2], &meta("Demo Tvo", Some("1991-04-08"))).unwrap();      // SYNTHETIC
    lib.set_patient_id(&ids[2], Some("C-3")).unwrap();
    let held = PatientRef { name: "Demo Held".into(), date_of_birth: Some("1991-04-08".into()) };   // SYNTHETIC
    lib.confirm_identity(&ids[2], Some(&held)).unwrap();                         // "Same patient"
    lib.set_patient_id(&ids[3], Some("D-4")).unwrap();
    let label = IdentityRead { name: Some("Demo Held".into()), date_of_birth: Some("1991-04-08".into()), ..IdentityRead::default() };   // SYNTHETIC
    lib.apply_label_with(&ids[3], &label, &IdentityRead::default()).unwrap();   // the label moves it
    assert!(ids.iter().all(|i| patient_of(&lib, i) == patient_of(&lib, &ids[0])), "all four are one patient now");
    assert_eq!(ids_on(&lib, &ids), [Some("H-1".into()), Some("S-2".into()), Some("C-3".into()), Some("D-4".into())]);
}
/// The learned mark stays true when the film joins another patient: the ID shown is still the learned one (Q8
/// replaces the M1 rule, which existed only because the shown ID could become the other patient's).
#[test] fn a_learned_patient_id_keeps_its_mark_when_its_film_is_renamed_onto_another_patient() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo Held", Some("1991-04-08"))).unwrap();     // SYNTHETIC
    lib.set_patient_id(&ids[0], Some("H-1")).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Source", Some("1991-04-08"))).unwrap();   // SYNTHETIC
    let read = FilmDetailsRead { printed_patient_id: Some("5566".into()), ..FilmDetailsRead::default() };
    assert_eq!(lib.apply_learned_details(&ids[1], &read).unwrap(), ["patient_id"]);
    lib.set_meta(&ids[1], &meta("Demo Held", Some("1991-04-08"))).unwrap();     // SYNTHETIC
    let d = lib.load(&ids[1]).unwrap();
    assert_eq!((d.printed_patient_id.as_deref(), d.learned_fields), (Some("5566"), vec!["patient_id".to_string()]));
}

/// D-LEARN-1: a learned value fills only a blank and is marked "Learned for this machine".
#[test] fn a_learned_detail_fills_only_a_blank_and_is_marked_learned() {
    let (_t, _s, mut lib, ids) = films(2);
    for id in &ids { lib.set_meta(id, &meta("Demo Synthetic", Some("1990-03-07"))).unwrap(); }   // SYNTHETIC
    lib.set_patient_id(&ids[1], Some("A-1")).unwrap();
    lib.set_film_detail(&ids[1], "practice", Some("Typed Practice")).unwrap();
    lib.conn_for_tests().execute("UPDATE cases SET learned_fields = 'name' WHERE id = ?1", [&ids[1]]).unwrap();
    let read = FilmDetailsRead { printed_patient_id: Some("B-2".into()), xray_type: Some("Lateral Ceph".into()),
        xray_size: Some("  ".into()), practice: Some("Demo Radiology".into()), ..FilmDetailsRead::default() };
    assert_eq!(lib.apply_learned_details(&ids[1], &read).unwrap(), ["xray_type"],
        "a saved Patient ID and a typed practice are never overwritten; a blank fills nothing");
    let d = lib.load(&ids[1]).unwrap();
    assert_eq!((d.printed_patient_id.as_deref(), d.xray_type.as_deref(), d.xray_size, d.radiography_practice.as_deref()),
        (Some("A-1"), Some("Lateral Ceph"), None, Some("Typed Practice")));
    assert_eq!(d.learned_fields, ["name", "xray_type"]);
    let long = FilmDetailsRead { xray_size: Some("x".repeat(201)), ..FilmDetailsRead::default() };
    assert!(lib.apply_learned_details(&ids[1], &long).unwrap().is_empty(), "over 200 fills nothing");
    let punct = FilmDetailsRead { xray_size: Some(" - ".into()), ..FilmDetailsRead::default() };
    assert!(lib.apply_learned_details(&ids[1], &punct).unwrap().is_empty(), "punctuation only fills nothing");
    assert_eq!(lib.load(&ids[1]).unwrap().xray_size, None);
}
/// Every blank fills from the learned read, each on its own film, and the fields are marked learned once each.
#[test] fn every_blank_detail_fills_and_each_is_marked_once() {
    let (_t, _s, mut lib, ids) = films(2);
    for id in &ids { lib.set_meta(id, &meta("Demo Synthetic", Some("1990-03-07"))).unwrap(); }   // SYNTHETIC
    let read = FilmDetailsRead { printed_patient_id: Some("5566".into()), xray_type: Some("Lateral Ceph".into()),
        xray_size: Some("10/12".into()), practice: Some("Demo Radiology".into()), ..FilmDetailsRead::default() };
    assert_eq!(lib.apply_learned_details(&ids[1], &read).unwrap(), ["patient_id", "xray_type", "xray_size", "practice"]);
    let d = lib.load(&ids[1]).unwrap();
    assert_eq!((d.xray_size.as_deref(), d.radiography_practice.as_deref()), (Some("10/12"), Some("Demo Radiology")));
    assert_eq!(lib.load(&ids[0]).unwrap().printed_patient_id, None, "on this film only");
    assert_eq!(lib.load(&ids[0]).unwrap().xray_type, None, "the film details stay on their film");
    assert!(lib.apply_learned_details(&ids[1], &read).unwrap().is_empty(), "nothing is blank now");
    assert_eq!(lib.load(&ids[1]).unwrap().learned_fields, ["patient_id", "xray_type", "xray_size", "practice"]);
}
#[test] fn a_deleted_film_takes_no_learned_detail() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.delete(&ids[0]).unwrap();
    let read = FilmDetailsRead { xray_type: Some("Lateral Ceph".into()), ..FilmDetailsRead::default() };
    assert!(lib.apply_learned_details(&ids[0], &read).is_err());
}

/// LIBID-1: the patient view lists every Patient ID on the patient's LIVE X-rays, each once (case and spaces
/// ignored, first spelling kept), oldest X-ray first; a deleted X-ray's ID is not listed until restored.
#[test] fn the_patient_view_lists_every_patient_id_on_its_live_xrays() {
    let (_t, _s, mut lib, ids) = films(4);
    for id in &ids { lib.set_meta(id, &meta("Demo Synthetic", Some("1990-03-07"))).unwrap(); }   // SYNTHETIC
    lib.set_patient_id(&ids[0], Some("5566")).unwrap();
    lib.set_patient_id(&ids[1], Some("zq 7781")).unwrap();
    lib.set_patient_id(&ids[2], Some("ZQ7781")).unwrap();
    lib.set_patient_id(&ids[3], Some("D-4")).unwrap();
    lib.delete(&ids[3]).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().patient_ids_seen, ["5566", "zq 7781"]);
    lib.restore(&ids[3]).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().patient_ids_seen, ["5566", "zq 7781", "D-4"]);
}
/// LIBID-1 + L8 A: the same Patient ID (case and spaces ignored) on an X-ray of a DIFFERENT named patient is offered;
/// a near miss, an unnamed patient, the X-ray's own patient and a deleted X-ray are not.
#[test] fn an_xray_whose_id_matches_another_patients_xray_is_offered_as_the_same_patient() {
    let (_t, _s, mut lib, ids) = films(5);
    lib.set_meta(&ids[0], &meta("Demo Here", Some("1990-03-07"))).unwrap();   // SYNTHETIC
    lib.set_patient_id(&ids[0], Some("ZQ-7781")).unwrap();
    lib.set_meta(&ids[1], &meta("Demo There", Some("1980-01-02"))).unwrap();  // SYNTHETIC
    lib.set_patient_id(&ids[1], Some("zq-7781")).unwrap();
    lib.set_meta(&ids[2], &meta("Demo Near", None)).unwrap();
    lib.set_patient_id(&ids[2], Some("ZQ-7782")).unwrap();                    // a near miss
    lib.set_patient_id(&ids[3], Some("ZQ-7781")).unwrap();                    // unnamed
    lib.set_meta(&ids[4], &meta("Demo Gone", None)).unwrap();
    lib.set_patient_id(&ids[4], Some("ZQ 7781")).unwrap(); lib.delete(&ids[4]).unwrap();
    let m = lib.load(&ids[0]).unwrap().id_matches;
    assert_eq!(m.len(), 1, "{m:?}");
    assert_eq!((m[0].patient.name.as_str(), m[0].films, m[0].library_id.as_str()), ("Demo There", 1, "L-00002"));
    assert_eq!(lib.load(&ids[3]).unwrap().id_matches.len(), 2, "an unnamed X-ray is offered both named patients");
}
/// "Not the same" is remembered for that X-ray and that patient only, and survives a merge of the answered patient
/// (the answer is resolved through merged_into). Preflight ruling 5a: Also (L-00002), not There, is the one retired,
/// so the control (compare the stored number without `resolve`) can actually fail.
#[test] fn not_the_same_is_remembered_for_that_xray_and_that_patient() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo Here", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Also", None)).unwrap();
    lib.set_meta(&ids[2], &meta("Demo There", None)).unwrap();
    for id in &ids { lib.set_patient_id(id, Some("5566")).unwrap(); }
    lib.not_same_patient(&ids[0], "L-00003").unwrap();
    fn names(lib: &Library, ids: &[String], i: usize) -> Vec<String> {
        lib.load(&ids[i]).unwrap().id_matches.into_iter().map(|m| m.patient.name).collect()
    }
    assert_eq!(names(&lib, &ids, 0), ["Demo Also"], "There is hidden for this X-ray");
    assert!(names(&lib, &ids, 1).contains(&"Demo There".to_string()), "another X-ray still sees There");
    lib.confirm_identity(&ids[2], Some(&PatientRef { name: "Demo Also".into(), date_of_birth: None })).unwrap();   // There (3) merges into Also (2): keeps 2
    assert!(names(&lib, &ids, 0).is_empty(), "the answer still applies after the merge: {:?}", names(&lib, &ids, 0));
    assert!(lib.not_same_patient(&ids[0], "ZQ-1").is_err(), "not a Library ID");
    lib.delete(&ids[0]).unwrap();
    assert!(lib.not_same_patient(&ids[0], "L-00003").unwrap_err().to_string().contains("Recently deleted"));
}
/// Search fields: the library list carries each row's Library ID, every number merged into it, and its Patient ID.
#[test] fn the_library_list_carries_library_and_patient_ids_for_search() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();
    lib.set_patient_id(&ids[1], Some("5566")).unwrap();
    lib.confirm_identity(&ids[1], Some(&PatientRef { name: "Demo A".into(), date_of_birth: None })).unwrap();
    let rows = lib.list(false).unwrap();
    let r = rows.iter().find(|r| r.id == ids[1]).unwrap();
    assert_eq!((r.library_id.as_deref(), r.former_library_ids.clone(), r.printed_patient_id.as_deref()),
        (Some("L-00001"), vec!["L-00002".to_string()], Some("5566")));
}

/// Q4 fill table (as Scan ID, spec 2026-09-29 Part 3): agree or one alone → fill (learned alone is marked);
/// disagree → nothing, and a conflict to show.
#[test] fn the_labels_patient_id_and_the_machines_follow_the_fill_table() {
    use ceph_store::merge_patient_id;
    assert_eq!(merge_patient_id(Some("5566"), Some("5566")), (Some("5566".into()), false, None));
    assert_eq!(merge_patient_id(Some("5566"), None), (Some("5566".into()), false, None));
    assert_eq!(merge_patient_id(None, Some("5566")), (Some("5566".into()), true, None));
    let (v, _, c) = merge_patient_id(Some("5566"), Some("5567"));
    assert_eq!((v, c.map(|c| (c.field, c.label, c.learned))), (None, Some(("patient_id".into(), "5566".into(), "5567".into()))));
    assert_eq!(merge_patient_id(Some(" "), None), (None, false, None));
    // Owner L8 (final review I2): case AND spaces ignored when the label and the learned place agree; the label's own
    // spelling fills, not marked learned.
    assert_eq!(merge_patient_id(Some("AB 123"), Some("ab123")), (Some("AB 123".into()), false, None));
    assert_eq!(merge_patient_id(Some("AB123"), Some("A B 1 2 3")), (Some("AB123".into()), false, None));
}
#[test] fn the_labels_patient_id_fills_only_a_blank_and_is_not_marked_learned() {
    let (_t, _s, mut lib, ids) = films(1);
    assert!(lib.apply_label_patient_id(&ids[0], Some("5566")).unwrap());
    assert!(!lib.apply_label_patient_id(&ids[0], Some("9999")).unwrap(), "never overwrites");
    assert!(!lib.apply_label_patient_id(&ids[0], None).unwrap(), "preflight 6a: no value, nothing to fill");
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.printed_patient_id.as_deref(), d.learned_fields.is_empty()), (Some("5566"), true));
}

/// LIBID-1 edge cases (Step 5): a blank own ID offers nothing; a 200-character ID still matches; a case's own
/// patient never appears in its own matches, however many of its own siblings share the ID; two "Not the same"
/// answers for the same pair are not an error; an answered patient later purged for good leaves the answer but
/// matches nothing (no crash walking a now-dangling Library ID).
#[test] fn link_suggestion_edge_cases() {
    let (_t, _s, mut lib, ids) = films(5);
    lib.set_meta(&ids[0], &meta("Demo Blank", None)).unwrap();                 // own ID stays blank
    lib.set_meta(&ids[1], &meta("Demo Sibling A", None)).unwrap();
    lib.set_meta(&ids[2], &meta("Demo Sibling A", None)).unwrap();              // same patient as ids[1] (same name, no DOB)
    let long = "9".repeat(200);
    lib.set_patient_id(&ids[1], Some(&long)).unwrap();
    lib.set_patient_id(&ids[2], Some(&long)).unwrap();
    lib.set_meta(&ids[3], &meta("Demo Elsewhere", None)).unwrap();
    lib.set_patient_id(&ids[3], Some(&long)).unwrap();
    assert!(lib.load(&ids[0]).unwrap().id_matches.is_empty(), "a blank own ID offers nothing");
    let m = lib.load(&ids[1]).unwrap().id_matches;
    assert_eq!(m.len(), 1, "{m:?}");
    assert_eq!((m[0].patient.name.as_str(), m[0].films), ("Demo Elsewhere", 1), "a 200-character ID still matches");
    assert!(lib.load(&ids[2]).unwrap().id_matches.iter().all(|x| x.patient.name != "Demo Sibling A"),
        "a case's own patient never appears in its own matches");

    lib.set_meta(&ids[4], &meta("Demo Answered", None)).unwrap();
    lib.set_patient_id(&ids[4], Some("5566")).unwrap();
    lib.set_patient_id(&ids[0], Some("5566")).unwrap();
    let answered_no = lib.load(&ids[4]).unwrap().library_id.unwrap();
    lib.not_same_patient(&ids[0], &answered_no).unwrap();
    lib.not_same_patient(&ids[0], &answered_no).unwrap();                       // a second answer for the same pair: not an error
    assert!(lib.load(&ids[0]).unwrap().id_matches.is_empty(), "the suggestion is hidden");
    lib.delete(&ids[4]).unwrap();
    assert_eq!(lib.purge_deleted(0).unwrap(), 1, "Demo Answered's only X-ray is purged for good");
    assert!(lib.load(&ids[0]).unwrap().id_matches.is_empty(),
        "the answer row stays and the now-dangling Library ID matches nothing, without crashing");
}

/// Q6 (addendum 2026-10-17): a learned Gender / Referrer fills the PATIENT's blank only, is marked on THIS X-ray
/// (Q11), and a person's save drops only its own mark. Preflight ruling (Task 7, 7b): the "only F or M" check runs
/// on a THIRD film's patient ("Demo Other") whose Gender is blank — ids[0]'s own patient already has Gender F by
/// that point, so the check could not fail there.
#[test] fn a_learned_gender_or_referrer_fills_only_a_blank_and_a_save_drops_its_mark() {
    let (_t, _s, mut lib, ids) = films(3);
    for id in &ids[..2] { lib.set_meta(id, &meta("Demo Synthetic", Some("1990-03-07"))).unwrap(); }   // SYNTHETIC
    lib.set_meta(&ids[2], &meta("Demo Other", Some("1990-03-07"))).unwrap();   // SYNTHETIC: a different, blank-Gender patient
    let read = FilmDetailsRead { gender: Some("F".into()), referrer: Some("Dr Demo".into()), ..FilmDetailsRead::default() };
    assert_eq!(lib.apply_learned_details(&ids[1], &read).unwrap(), ["gender", "referrer"]);
    let (a, b) = (lib.load(&ids[0]).unwrap(), lib.load(&ids[1]).unwrap());
    assert_eq!((a.gender.as_deref(), a.referring_practitioner.as_deref(), a.learned_fields.len()), (Some("F"), Some("Dr Demo"), 0));
    assert_eq!(b.learned_fields, ["gender", "referrer"]);
    assert!(lib.apply_learned_details(&ids[1], &FilmDetailsRead { gender: Some("M".into()), ..FilmDetailsRead::default() }).unwrap().is_empty(), "never overwrites");
    assert!(lib.apply_learned_details(&ids[2], &FilmDetailsRead { gender: Some("X".into()), ..FilmDetailsRead::default() }).unwrap().is_empty(), "only F or M");
    lib.set_patient_gender(&ids[1], Some("F")).unwrap();
    assert_eq!(lib.load(&ids[1]).unwrap().learned_fields, ["referrer"]);
    lib.set_meta(&ids[1], &meta("Demo Renamed", Some("1990-03-07"))).unwrap();   // SYNTHETIC: a name edit keeps the referrer mark
    assert_eq!(lib.load(&ids[1]).unwrap().learned_fields, ["referrer"]);
    lib.set_patient_referrer(&ids[1], Some("Dr Demo")).unwrap();
    assert!(lib.load(&ids[1]).unwrap().learned_fields.is_empty());
}

/// Q10: the ✓ removes one mark, keeps the value, and refuses an identity field or an unknown one.
#[test] fn accepting_a_learned_value_removes_only_its_mark_and_keeps_the_value() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    let read = FilmDetailsRead { xray_type: Some("Lateral Ceph".into()), gender: Some("F".into()), ..FilmDetailsRead::default() };
    lib.apply_learned_details(&ids[0], &read).unwrap();
    lib.accept_learned(&ids[0], "xray_type").unwrap();
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.xray_type.as_deref(), d.learned_fields), (Some("Lateral Ceph"), vec!["gender".to_string()]));
    for bad in ["name", "dob", "shoe_size", ""] { assert!(lib.accept_learned(&ids[0], bad).is_err(), "{bad:?}"); }
    lib.delete(&ids[0]).unwrap();
    assert!(lib.accept_learned(&ids[0], "gender").unwrap_err().to_string().contains("Recently deleted"));
}
/// Q9: OK on the patient note (confirm_identity with no other patient) removes EVERY mark on the X-ray. Existing
/// behaviour, pinned: induce a failure by clearing only the identity marks and watch this fail.
#[test] fn ok_on_the_patient_note_confirms_every_learned_detail() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.conn_for_tests().execute("UPDATE cases SET learned_fields = 'name,dob,scan_date,scan_id,patient_id,xray_type,xray_size,practice,gender,referrer' WHERE id = ?1", [&ids[0]]).unwrap();
    lib.confirm_identity(&ids[0], None).unwrap();
    assert!(lib.load(&ids[0]).unwrap().learned_fields.is_empty());
}

/// Final review M1: a Gender/Referrer "Learned for this machine" mark describes the patient the X-ray was on. Joining a
/// different, existing patient (typed name, or a label read) shows THAT patient's typed values, so the mark must go;
/// becoming a new patient keeps it (the values travel with the X-ray, see the Q6 test above).
#[test] fn joining_a_patient_with_typed_gender_or_referrer_drops_the_learned_marks() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo Typed", None)).unwrap();
    lib.set_patient_gender(&ids[0], Some("M")).unwrap();
    lib.set_patient_referrer(&ids[0], Some("Dr Typed")).unwrap();
    let read = FilmDetailsRead { gender: Some("F".into()), referrer: Some("Dr Learned".into()), xray_type: Some("Lateral Ceph".into()), ..FilmDetailsRead::default() };
    for id in &ids[1..] {
        lib.set_meta(id, &meta(&format!("Demo Learned {id}"), None)).unwrap();
        assert_eq!(lib.apply_learned_details(id, &read).unwrap(), ["xray_type", "gender", "referrer"]);
    }
    lib.set_meta(&ids[1], &meta("Demo Typed", None)).unwrap();                             // joins by a typed name
    lib.apply_label(&ids[2], &IdentityRead { name: Some("Demo Typed".into()), ..Default::default() }).unwrap();   // by a label
    for id in &ids[1..] {
        let d = lib.load(id).unwrap();
        println!("{:?} {:?} {:?}", d.gender, d.referring_practitioner, d.learned_fields);
        assert_eq!((d.gender.as_deref(), d.referring_practitioner.as_deref(), d.learned_fields), (Some("M"), Some("Dr Typed"), vec!["xray_type".to_string()]),
            "the X-ray's own film detail keeps its mark; the joined patient's typed values carry none");
    }
}
