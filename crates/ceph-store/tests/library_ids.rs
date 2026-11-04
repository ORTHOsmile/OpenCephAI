//! LIBID-1 / LIBID-2 (owner, 17 Oct): the library's own patient number. Synthetic films and names only.
use ceph_store::{library_ids::TrailLine, CaseMeta, Library, PatientRef};
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
    let ids = (0..n).map(|i| lib.import(&synthetic_png(src.path(), &format!("synthetic-{i}.png"), i.wrapping_mul(9))).unwrap().case_id).collect();
    (t, src, lib, ids)
}
fn lid(lib: &Library, case: &str) -> Option<String> { lib.load(case).unwrap().library_id }
fn same(name: &str) -> PatientRef { PatientRef { name: name.into(), date_of_birth: None } }

#[test] fn the_text_form_reads_and_writes_both_ways() {
    use ceph_store::library_ids::{library_id_text, parse_library_id};
    assert_eq!((library_id_text(42), library_id_text(123456)), ("L-00042".to_string(), "L-123456".to_string()));
    for (s, n) in [("L-00042", Some(42)), (" l-42 ", Some(42)), ("L 42", Some(42)), ("", None), ("L-", None), ("42x", None), ("L-0", None), ("L--1", None)] {
        assert_eq!(parse_library_id(s), n, "{s:?}");
    }
}
/// L6 A: a patient gets the next number when it first has a name; an imported, unnamed one has none.
#[test] fn a_named_patient_gets_the_next_id_and_an_unnamed_one_none() {
    let (_t, _s, mut lib, ids) = films(2);
    assert_eq!(lid(&lib, &ids[0]), None);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Two", None)).unwrap();
    assert_eq!((lid(&lib, &ids[0]), lid(&lib, &ids[1])), (Some("L-00001".into()), Some("L-00002".into())));
}
/// Rule 2: a correction that empties the old record hands its number to the corrected one — spelling, date of birth,
/// clearing the name and typing it again. Positive control: without the take-over this reads L-00002, L-00003 …
#[test] fn correcting_a_single_xray_patient_keeps_its_id() {
    let (_t, _s, mut lib, ids) = films(1);
    for (name, dob) in [("Demo One", None), ("Demo Won", None), ("Demo Won", Some("1990-03-07")), ("", Some("1990-03-07")), ("Demo One", Some("1990-03-07"))] {   // SYNTHETIC
        lib.set_meta(&ids[0], &meta(name, dob)).unwrap();
        assert_eq!(lid(&lib, &ids[0]).as_deref(), Some("L-00001"), "after {name:?} {dob:?}");
    }
}
/// Rules 3 + 4 (L3 A): correcting a two-X-ray patient one X-ray at a time ends with its FIRST number: the first
/// correction splits (a new number), the second merges and the older number survives.
#[test] fn correcting_each_xray_of_a_two_xray_patient_keeps_the_older_id() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo Smyth", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Smyth", None)).unwrap();     // L-00001, two X-rays
    lib.set_meta(&ids[2], &meta("Demo Other", None)).unwrap();     // L-00002
    lib.set_meta(&ids[0], &meta("Demo Smith", None)).unwrap();     // split: L-00003
    assert_eq!(lid(&lib, &ids[0]).as_deref(), Some("L-00003"));
    lib.set_meta(&ids[1], &meta("Demo Smith", None)).unwrap();     // merge: Smyth is now empty
    assert_eq!((lid(&lib, &ids[0]), lid(&lib, &ids[1])), (Some("L-00001".into()), Some("L-00001".into())));
    let f = lib.find_library_id("L-00003").unwrap().unwrap();
    assert_eq!((f.current.as_deref(), f.merged), (Some("L-00001"), true));
}
/// LIBID-2: a merge keeps ONE id, the older, even when the survivor row held the newer; the other resolves to it.
/// Positive controls: without the min() the survivor keeps L-00002; without merged_into the lookup finds nothing.
#[test] fn merging_keeps_the_older_id_and_the_retired_one_resolves_to_it() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo Older", None)).unwrap();     // L-00001
    lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap();     // L-00002
    lib.confirm_identity(&ids[0], Some(&same("Demo Newer"))).unwrap();   // the OLDER patient's only X-ray joins the newer
    assert_eq!(lid(&lib, &ids[1]).as_deref(), Some("L-00001"), "the survivor takes the older number");
    let holders: i64 = lib.conn_for_tests().query_row("SELECT COUNT(*) FROM patients WHERE library_no = 2", [], |r| r.get(0)).unwrap();
    assert_eq!(holders, 0, "L-00002 is held by nobody");
    let f = lib.find_library_id("l-2").unwrap().unwrap();
    assert_eq!((f.asked.as_str(), f.current.as_deref(), f.patient.map(|p| p.name), f.merged),
        ("L-00002", Some("L-00001"), Some("Demo Newer".to_string()), true));
}
/// LIBID-2: a retired number, and one whose patient was emptied from Recently deleted, is never issued again.
/// Positive control: issuing MAX(patients.library_no)+1 instead of the AUTOINCREMENT counter collides with the retired
/// row 2 and errors (UNIQUE constraint failed: library_numbers.n), so a retired number is never quietly handed out.
#[test] fn a_retired_or_removed_id_is_never_issued_again() {
    let (_t, s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();          // 1
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();          // 2
    lib.set_meta(&ids[2], &meta("Demo C", None)).unwrap();          // 3
    lib.confirm_identity(&ids[1], Some(&same("Demo A"))).unwrap();   // 2 retired into 1
    lib.delete(&ids[2]).unwrap(); lib.purge_deleted(0).unwrap();    // 3's patient removed
    let f = lib.find_library_id("L-00003").unwrap().unwrap();
    assert_eq!((f.current, f.patient, f.merged), (None, None, false), "a removed patient's number is known but leads nowhere");
    let issued: Vec<String> = (0..20u8).map(|i| {
        let c = lib.import(&synthetic_png(s.path(), &format!("more-{i}.png"), 100 + i)).unwrap().case_id;
        lib.set_meta(&c, &meta(&format!("Demo New {i}"), None)).unwrap();
        lid(&lib, &c).unwrap()
    }).collect();
    assert_eq!(issued.first().map(String::as_str), Some("L-00004"));
    assert!(!issued.iter().any(|x| x == "L-00002" || x == "L-00003"), "{issued:?}");
}
/// A chain of merges resolves to the number held now: 3 → 2 → 1.
#[test] fn a_lookup_follows_a_chain_of_merges() {
    let (_t, _s, mut lib, ids) = films(3);
    for (i, n) in ["Demo A", "Demo B", "Demo C"].iter().enumerate() { lib.set_meta(&ids[i], &meta(n, None)).unwrap(); }
    lib.confirm_identity(&ids[2], Some(&same("Demo B"))).unwrap();   // 3 into 2
    lib.confirm_identity(&ids[1], Some(&same("Demo A"))).unwrap();   // B's first X-ray into A (B keeps ids[2])
    lib.confirm_identity(&ids[2], Some(&same("Demo A"))).unwrap();   // now B is empty: 2 into 1
    assert_eq!(lib.find_library_id("L-00003").unwrap().unwrap().current.as_deref(), Some("L-00001"));
    assert!(lib.find_library_id("L-99999").unwrap().is_none(), "never issued");
    assert!(lib.find_library_id("ZQ-7781").unwrap().is_none(), "not a Library ID");
}
/// Rule 5: restoring a backup carries the counter, so a number issued after the backup is never issued again.
#[test] fn restoring_a_backup_never_reissues_a_later_number() {
    let (t, s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();          // 1
    let out = tempfile::tempdir().unwrap();
    let backup = lib.backup(out.path()).unwrap();
    let c = lib.import(&synthetic_png(s.path(), "later.png", 77)).unwrap().case_id;
    lib.set_meta(&c, &meta("Demo B", None)).unwrap();                // 2, after the backup
    drop(lib);
    let mut lib = Library::restore_backup(t.path(), &backup).unwrap();
    let c = lib.import(&synthetic_png(s.path(), "after-restore.png", 88)).unwrap().case_id;
    lib.set_meta(&c, &meta("Demo C", None)).unwrap();
    assert_eq!(lid(&lib, &c).as_deref(), Some("L-00003"), "2 was issued before the restore; never again");
    assert_eq!(lid(&lib, &ids[0]).as_deref(), Some("L-00001"), "a format-11 backup keeps its own numbers");
    // Review I2 (rule 6): L-00002 was issued after the backup. It is known and leads nowhere, which a never-issued
    // number does not. Positive control: without the placeholder rows L-00002 reads None, like L-00004.
    let f = lib.find_library_id("L-00002").unwrap().expect("L-00002 was issued; the restored library must know it");
    assert_eq!((f.current, f.patient, f.merged), (None, None, false), "belonged to a patient no longer in the library");
    assert!(lib.find_library_id("L-00004").unwrap().is_none(), "never issued");
}

// ---- Step 6 edge cases ----
fn issued(lib: &Library) -> i64 { lib.conn_for_tests().query_row("SELECT COUNT(*) FROM library_numbers", [], |r| r.get(0)).unwrap() }
fn all_numbers(lib: &Library) -> Vec<(String, Option<i64>)> {
    lib.conn_for_tests().prepare("SELECT display_name, library_no FROM patients ORDER BY display_name").unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap()
}
/// An unnamed X-ray that joins a named patient by its label uses up no number; it shows that patient's.
#[test] fn an_unnamed_xray_joining_a_named_patient_by_its_label_uses_no_number() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();
    let before = issued(&lib);
    lib.apply_label(&ids[1], &ceph_store::IdentityRead { name: Some("Demo A".into()), ..Default::default() }).unwrap();
    println!("library_numbers rows before {before}, after {}; X-ray shows {:?}", issued(&lib), lid(&lib, &ids[1]));
    assert_eq!((issued(&lib), lid(&lib, &ids[1]).as_deref()), (before, Some("L-00001")));
}
/// Rule 4: a film moved off a patient that keeps other films gets a new number; the patient keeps its own.
#[test] fn a_film_moved_off_a_patient_with_other_films_gets_a_new_number() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo A", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();
    println!("stays {:?}, moved {:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]));
    assert_eq!((lid(&lib, &ids[0]).as_deref(), lid(&lib, &ids[1]).as_deref()), (Some("L-00001"), Some("L-00002")));
}
/// Text that is not a Library ID, a Patient ID and a never-issued number find nothing.
#[test] fn lookups_that_find_nothing() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();
    for q in ["", "L-", "ZQ-7781", "5566", "L-00002", "L-0"] {
        let f = lib.find_library_id(q).unwrap();
        println!("{q:?} -> {f:?}");
        assert!(f.is_none(), "{q:?}");
    }
    let f = lib.find_library_id("L-00001").unwrap().unwrap();
    println!("\"L-00001\" -> {f:?}");
    assert_eq!((f.current.as_deref(), f.merged), (Some("L-00001"), false), "a held number reads as held, not merged");
}
/// Reopening the library and purging with nothing to purge change no number.
#[test] fn reopening_and_an_empty_purge_change_no_number() {
    let (t, _s, mut lib, ids) = films(3);
    for (i, n) in ["Demo A", "Demo B", "Demo C"].iter().enumerate() { lib.set_meta(&ids[i], &meta(n, None)).unwrap(); }
    lib.confirm_identity(&ids[1], Some(&same("Demo A"))).unwrap();
    let before = (all_numbers(&lib), issued(&lib));
    assert_eq!(lib.purge_deleted(0).unwrap(), 0);
    let after_purge = (all_numbers(&lib), issued(&lib));
    drop(lib);
    let lib = Library::open(t.path()).unwrap();
    let after_reopen = (all_numbers(&lib), issued(&lib));
    println!("before {before:?}\nafter purge {after_purge:?}\nafter reopen {after_reopen:?}");
    assert_eq!((&after_purge, &after_reopen), (&before, &before));
    assert_eq!(lib.find_library_id("L-00002").unwrap().unwrap().current.as_deref(), Some("L-00001"));
}
/// Review minor 4: a merge chain that never ends (only a damaged database can hold one) is an error, not an answer
/// read from the middle of the chain. Positive control: the old loop guard fell through and answered Ok.
#[test] fn a_merge_chain_that_loops_is_an_error() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();
    lib.conn_for_tests().execute_batch("UPDATE library_numbers SET merged_into = 2 WHERE n = 1; UPDATE library_numbers SET merged_into = 1 WHERE n = 2;").unwrap();
    let r = lib.find_library_id("L-00001");
    println!("{r:?}");
    assert!(r.is_err(), "{r:?}");
}
/// Review minor 3 (pinned as known behaviour): a patient whose other X-ray is in Recently deleted is not empty, so a
/// correction of its only live X-ray is a split (a new number); the old number stays with the deleted X-ray's patient
/// and, once that X-ray is removed for good, leads nowhere.
#[test] fn an_xray_in_recently_deleted_keeps_its_patient_from_being_empty() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo Smyth", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Smyth", None)).unwrap();
    lib.delete(&ids[1]).unwrap();
    lib.set_meta(&ids[0], &meta("Demo Smith", None)).unwrap();
    assert_eq!(lid(&lib, &ids[0]).as_deref(), Some("L-00002"));
    lib.purge_deleted(0).unwrap();
    let f = lib.find_library_id("L-00001").unwrap().unwrap();
    println!("{f:?}");
    assert_eq!((f.current, f.patient), (None, None));
}

// ---- Owner ruling L9-A (18 Oct; replaced L9 B): undoing a wrong link gives the X-ray a NEW number; none is given back ----
fn n_of(lib: &Library, case: &str) -> String { lid(lib, case).unwrap_or_default() }

/// L9-A (owner, 18 Oct): the OLDER patient's only X-ray was wrongly linked into a newer one, so the joined patient kept
/// the older number (L3). Undoing the link by correcting the name gives the X-ray a NEW number; the joined patient
/// keeps L-00001 and L-00002 still leads to it, with the trail shown. Positive control: re-introduce the take-along
/// (plan Task 17, control C2) -> X gets L-00001.
#[test] fn undoing_a_wrong_link_gives_the_xray_a_new_number_and_the_older_number_stays_with_the_patient_it_joined() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // L-00001 (X)
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();                   // L-00002 (Y)
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();           // the wrong link: both show L-00001
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1])), ("L-00001".into(), "L-00001".into()));
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // undone by correcting the name
    println!("X {:?}, Y {:?}; L1 {:?}; L2 {:?}; counter {}", lid(&lib, &ids[0]), lid(&lib, &ids[1]), found(&lib, "L-00001"), found(&lib, "L-00002"), counter(&lib));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1])), ("L-00003".into(), "L-00001".into()));
    assert_eq!(found(&lib, "L-00001"), (s("L-00001"), s("Demo B"), false));
    assert_eq!(found(&lib, "L-00002"), (s("L-00001"), s("Demo B"), true), "retired for good, still leads to the patient it was merged into");
    assert_eq!(counter(&lib), 3, "one new number, issued once");
}
/// L9-A: the NEWER patient's X-ray was linked into an older one, so its number was retired. Undoing the link gives it
/// a new number; the retired number stays retired and still leads to the older patient. Positive control:
/// re-introduce the give-back (plan Task 17, control C1) -> X gets L-00002.
#[test] fn undoing_a_wrong_link_never_gives_a_retired_number_back() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo Older", None)).unwrap();               // L-00001
    lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap();               // L-00002 (X)
    lib.confirm_identity(&ids[1], Some(&same("Demo Older"))).unwrap();       // 2 retired into 1
    lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap();
    println!("Older {:?}, X {:?}; L2 {:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]), found(&lib, "L-00002"));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1])), ("L-00001".into(), "L-00003".into()));
    assert_eq!(found(&lib, "L-00002"), (s("L-00001"), s("Demo Older"), true));
    assert_eq!(counter(&lib), 3);
}
/// L9-A: the rest of a wrongly linked group follows the first X-ray's new number by the normal name match; the
/// group's old number stays retired into the survivor; an X-ray that was never in the group gets its own new number.
/// Positive control: C1 -> X1 gets L-00002 back.
#[test] fn the_rest_of_a_group_joins_the_new_number_by_name_and_no_number_comes_back() {
    let (_t, _s, mut lib, ids) = films(4);
    lib.set_meta(&ids[0], &meta("Demo Kept", None)).unwrap();                // L-00001 (Z, on the survivor)
    lib.set_meta(&ids[1], &meta("Demo Group", None)).unwrap();               // L-00002: X1
    lib.set_meta(&ids[2], &meta("Demo Group", None)).unwrap();               //          X2
    lib.set_meta(&ids[3], &meta("Demo Kept", None)).unwrap();                // W, also on the survivor
    lib.confirm_identity(&ids[1], Some(&same("Demo Kept"))).unwrap();
    lib.confirm_identity(&ids[2], Some(&same("Demo Kept"))).unwrap();        // Group empties: 2 retired into 1
    lib.set_meta(&ids[0], &meta("Demo Zed", None)).unwrap();                 // Z is corrected: a split, L-00003
    lib.set_meta(&ids[1], &meta("Demo Group", None)).unwrap();               // X1: a split, L-00004
    lib.set_meta(&ids[2], &meta("Demo Group", None)).unwrap();               // X2 joins X1 by name
    println!("Z {:?} X1 {:?} X2 {:?} W {:?}; L2 {:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]), lid(&lib, &ids[2]), lid(&lib, &ids[3]), found(&lib, "L-00002"));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1]), n_of(&lib, &ids[2]), n_of(&lib, &ids[3])),
        ("L-00003".into(), "L-00004".into(), "L-00004".into(), "L-00001".into()));
    assert_eq!(found(&lib, "L-00002"), (s("L-00001"), s("Demo Kept"), true));
}
/// L9-A, chains: A (L-00003) linked into B (L-00002), then B into C (L-00001). Undoing them by name gives new numbers
/// (L-00004 for B, L-00005 for A); L-00003 and L-00002 stay retired and still lead to C, step by step. Positive
/// control: C1 -> X gets L-00002 first.
#[test] fn a_chain_of_wrong_merges_undone_gives_new_numbers_and_every_old_number_still_leads_to_the_survivor() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[2], &meta("Demo C", None)).unwrap();                   // L-00001 (Z)
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();                   // L-00002 (Y)
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // L-00003 (X)
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();           // 3 into 2
    lib.confirm_identity(&ids[1], Some(&same("Demo C"))).unwrap();           // Y joins C (B keeps X)
    lib.confirm_identity(&ids[0], Some(&same("Demo C"))).unwrap();           // B empties: 2 into 1
    lib.set_meta(&ids[0], &meta("Demo B", None)).unwrap();                   // X out of C: a new number
    assert_eq!(n_of(&lib, &ids[0]), "L-00004");
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();                   // Y joins X by name
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // X out of B: another new number
    println!("X {:?} Y {:?} Z {:?}; L2 {:?}; L3 {:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]), lid(&lib, &ids[2]), found(&lib, "L-00002"), found(&lib, "L-00003"));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1]), n_of(&lib, &ids[2])), ("L-00005".into(), "L-00004".into(), "L-00001".into()));
    assert_eq!((found(&lib, "L-00002"), found(&lib, "L-00003")), ((s("L-00001"), s("Demo C"), true), (s("L-00001"), s("Demo C"), true)));
}
/// L9-A: an X-ray linked into Older (its L-00002 retired) that then moved on to Other gets a new number when it is
/// corrected there; L-00002 stays retired and leads to Older. Positive control: C1 or C2 (plan Task 17) -> it does not
/// get L-00004.
#[test] fn an_xray_that_moved_on_gets_a_new_number_when_corrected() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo Older", None)).unwrap();               // L-00001
    lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap();               // L-00002 (X)
    lib.set_meta(&ids[2], &meta("Demo Other", None)).unwrap();               // L-00003
    lib.confirm_identity(&ids[1], Some(&same("Demo Older"))).unwrap();       // 2 into 1
    lib.confirm_identity(&ids[1], Some(&same("Demo Other"))).unwrap();       // X moves on (Older keeps ids[0])
    lib.set_meta(&ids[1], &meta("Demo Fresh", None)).unwrap();               // separated from Other, not from Older
    assert_eq!(n_of(&lib, &ids[1]), "L-00004");
    assert_eq!(lib.find_library_id("L-00002").unwrap().unwrap().current.as_deref(), Some("L-00001"), "2 stays retired");
}
/// An X-ray removed for good takes its record with it: its group's retired number stays retired, still resolves to
/// the survivor, and is never issued to anyone. Positive control: remove `ON DELETE CASCADE` from
/// `xray_joins` and `purge_deleted` fails on the foreign key, so this test fails.
#[test] fn a_record_whose_xrays_were_removed_gives_nothing_back() {
    let (_t, s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo Kept", None)).unwrap();                // L-00001
    lib.set_meta(&ids[1], &meta("Demo Gone", None)).unwrap();                // L-00002 (X)
    lib.confirm_identity(&ids[1], Some(&same("Demo Kept"))).unwrap();
    lib.delete(&ids[1]).unwrap(); lib.purge_deleted(0).unwrap();
    let rows: i64 = lib.conn_for_tests().query_row("SELECT COUNT(*) FROM xray_joins WHERE case_id = ?1", [&ids[1]], |r| r.get(0)).unwrap();
    assert_eq!(rows, 0, "removed with the X-ray");
    let w = lib.import(&synthetic_png(s.path(), "w.png", 55)).unwrap().case_id;
    lib.set_meta(&w, &meta("Demo Kept", None)).unwrap();
    lib.set_meta(&w, &meta("Demo Gone", None)).unwrap();                     // a correction off the survivor
    assert_eq!(n_of(&lib, &w), "L-00003");
    assert_eq!(lib.find_library_id("L-00002").unwrap().unwrap().current.as_deref(), Some("L-00001"));
}
/// L9-A: a name corrected straight over the wrong one, and a name cleared and then typed, now agree: both give a new
/// number (the owner's "needs a direct correction" rule is withdrawn with the give-back). Positive control: C1 -> the
/// direct correction gets L-00002.
#[test] fn correcting_directly_or_clearing_first_both_give_a_new_number() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo Older", None)).unwrap();               // L-00001
    lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap();               // L-00002
    lib.set_meta(&ids[2], &meta("Demo Third", None)).unwrap();               // L-00003
    lib.confirm_identity(&ids[1], Some(&same("Demo Older"))).unwrap();       // 2 into 1
    lib.confirm_identity(&ids[2], Some(&same("Demo Older"))).unwrap();       // 3 into 1
    lib.set_meta(&ids[1], &meta("Demo Renamed", None)).unwrap();             // corrected directly
    assert_eq!(n_of(&lib, &ids[1]), "L-00004");
    lib.set_meta(&ids[2], &meta("", None)).unwrap();                         // cleared first
    assert_eq!(lid(&lib, &ids[2]), None);
    lib.set_meta(&ids[2], &meta("Demo Third", None)).unwrap();
    assert_eq!(n_of(&lib, &ids[2]), "L-00005");
    assert_eq!((found(&lib, "L-00002").0, found(&lib, "L-00003").0), (s("L-00001"), s("L-00001")), "both stay retired");
}

// ---- Task 4 Step 6 edge cases ----
fn counter(lib: &Library) -> i64 { lib.conn_for_tests().query_row("SELECT seq FROM sqlite_sequence WHERE name = 'library_numbers'", [], |r| r.get(0)).unwrap() }
/// The X-ray's join record (owner ruling JOIN-HISTORY), oldest first: (the number its patient held from then, how).
fn joins(lib: &Library, case: &str) -> Vec<(Option<i64>, String)> {
    lib.conn_for_tests().prepare("SELECT library_no, how FROM xray_joins WHERE case_id = ?1 ORDER BY joined_at, id").unwrap()
        .query_map([case], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap()
}
fn j(rows: &[(Option<i64>, &str)]) -> Vec<(Option<i64>, String)> { rows.iter().map(|(n, h)| (*n, h.to_string())).collect() }
/// A round trip (join C, link back to B, join C again) is in the record move by move, in order.
#[test] fn every_join_of_a_round_trip_is_in_the_record() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo C", None)).unwrap();                   // L-00001
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();                   // L-00002 (X)
    lib.set_meta(&ids[2], &meta("Demo B", None)).unwrap();                   //          Y keeps B alive
    lib.confirm_identity(&ids[1], Some(&same("Demo C"))).unwrap();           // X joins C (B keeps Y)
    lib.confirm_identity(&ids[1], Some(&same("Demo B"))).unwrap();           // back home
    lib.confirm_identity(&ids[1], Some(&same("Demo C"))).unwrap();           // and to C again
    println!("record of X: {:?}", joins(&lib, &ids[1]));
    assert_eq!(joins(&lib, &ids[1]), j(&[(None, "import"), (Some(2), "typed"), (Some(1), "same_patient"), (Some(2), "same_patient"), (Some(1), "same_patient")]));
}
/// An X-ray in Recently deleted cannot be corrected; its record is kept, and after Restore the correction gives a new
/// number (L9-A), never its old one. Positive control: C1 -> it gets L-00002.
#[test] fn an_xray_in_recently_deleted_cannot_be_corrected_and_after_restore_gets_a_new_number() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo Older", None)).unwrap();               // L-00001
    lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap();               // L-00002 (X)
    lib.confirm_identity(&ids[1], Some(&same("Demo Older"))).unwrap();       // 2 into 1
    lib.delete(&ids[1]).unwrap();
    let e = lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap_err();
    println!("while deleted: {e}; record kept {:?}", joins(&lib, &ids[1]));
    assert_eq!(joins(&lib, &ids[1]), j(&[(None, "import"), (Some(2), "typed"), (Some(1), "same_patient")]));
    lib.restore(&ids[1]).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap();
    println!("after restore and correction: {:?} / {:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1])), ("L-00001".into(), "L-00003".into()));
}
/// L9-A: two X-rays of A wrongly linked to B one at a time (A empties at the second, so B keeps A's older L-00001).
/// Undoing both by name gives A one new number (L-00003): L-00001 stays with B, which joined it, and B's own L-00002
/// leads to it. Positive control: C2 -> X takes L-00001.
#[test] fn undoing_two_wrong_links_gives_one_new_number_and_the_older_number_stays_with_the_patient_joined() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // X
    lib.set_meta(&ids[1], &meta("Demo A", None)).unwrap();                   // Q1: A = L-00001
    lib.set_meta(&ids[2], &meta("Demo B", None)).unwrap();                   // Y:  B = L-00002
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();           // a join: A keeps Q1
    lib.confirm_identity(&ids[1], Some(&same("Demo B"))).unwrap();           // A empties: 2 into 1
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo A", None)).unwrap();
    println!("X {:?}, Q1 {:?}, Y {:?}; L1 {:?}; L2 {:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]), lid(&lib, &ids[2]), found(&lib, "L-00001"), found(&lib, "L-00002"));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1]), n_of(&lib, &ids[2])), ("L-00003".into(), "L-00003".into(), "L-00001".into()));
    assert_eq!((found(&lib, "L-00001"), found(&lib, "L-00002")), ((s("L-00001"), s("Demo B"), false), (s("L-00001"), s("Demo B"), true)));
}
/// Review P4 (C2 ii), still true under L9-A: a wrong link undone by linking straight back, then Y joins A for real and
/// X is corrected off A: X gets a new number, never Y's L-00002 nor A's L-00001. Positive control: C1 (plan Task 17) ->
/// X gets L-00002.
#[test] fn linking_straight_back_leaves_nothing_to_give_back() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // X
    lib.set_meta(&ids[1], &meta("Demo A", None)).unwrap();                   // Q1: A = L-00001
    lib.set_meta(&ids[2], &meta("Demo B", None)).unwrap();                   // Y:  B = L-00002
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();           // wrong link
    lib.confirm_identity(&ids[0], Some(&same("Demo A"))).unwrap();           // undone by linking back
    assert_eq!(joins(&lib, &ids[0]), j(&[(None, "import"), (Some(1), "typed"), (Some(2), "same_patient"), (Some(1), "same_patient")]), "the visit and the way back are both in the record");
    lib.confirm_identity(&ids[2], Some(&same("Demo A"))).unwrap();           // Y joins A for real: 2 into 1
    lib.set_meta(&ids[0], &meta("Demo Xavier", None)).unwrap();               // X corrected off A
    let f2 = lib.find_library_id("L-00002").unwrap().unwrap();
    println!("X {:?}, Q1 {:?}, Y {:?}; L-00002 -> {f2:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]), lid(&lib, &ids[2]));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1]), n_of(&lib, &ids[2])), ("L-00003".into(), "L-00001".into(), "L-00001".into()));
    assert_eq!((f2.current.as_deref(), f2.patient.map(|p| p.name)), (Some("L-00001"), Some("Demo A".into())));
}
/// Unnamed destination: clearing the name of a linked X-ray gives no number and gives nothing back (L6); the
/// retired number stays retired and the clearing is in the record.
#[test] fn an_unnamed_destination_gets_nothing_back() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo Older", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Newer", None)).unwrap();
    lib.confirm_identity(&ids[1], Some(&same("Demo Older"))).unwrap();
    lib.set_meta(&ids[1], &meta("", None)).unwrap();
    let f2 = lib.find_library_id("L-00002").unwrap().unwrap();
    println!("cleared X shows {:?}; L-00002 -> {f2:?}; record {:?}", lid(&lib, &ids[1]), joins(&lib, &ids[1]));
    assert_eq!((lid(&lib, &ids[1]), f2.current.as_deref(), joins(&lib, &ids[1]).last().cloned()), (None, Some("L-00001"), Some((None, "cleared".to_string()))));
}

// ---- Review sequences 1 and 2 (final review I1), under L9-A ----
/// Review sequence 1 under L9-A (A={X,Q} L-00001, B={Y} L-00002): Y corrected gets a new L-00003 and B keeps L-00002
/// with X; when X links back, B empties into A (L-00002 retired into L-00001). Positive control: C2 -> Y takes L-00002.
#[test] fn review_sequence_1_the_corrected_xray_gets_a_new_number() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // X
    lib.set_meta(&ids[1], &meta("Demo A", None)).unwrap();                   // Q: A = L-00001
    lib.set_meta(&ids[2], &meta("Demo B", None)).unwrap();                   // Y: B = L-00002
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();           // X wrongly linked into B (A keeps Q)
    lib.set_meta(&ids[2], &meta("Demo Bee", None)).unwrap();                 // Y corrected to a new name
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[2])), ("L-00002".into(), "L-00003".into()));
    lib.confirm_identity(&ids[0], Some(&same("Demo A"))).unwrap();           // X links back to A: B empties
    println!("X {:?}, Q {:?}, Y {:?}; L2 {:?}; {:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]), lid(&lib, &ids[2]), found(&lib, "L-00002"), all_numbers(&lib));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1]), n_of(&lib, &ids[2])), ("L-00001".into(), "L-00001".into(), "L-00003".into()));
    assert_eq!(found(&lib, "L-00002"), (s("L-00001"), s("Demo A"), true));
    assert_eq!(found(&lib, "L-00003"), (s("L-00003"), s("Demo Bee"), false));
}
/// Review sequence 2 under L9-A (B={Y} L-00001, A={X,Q} L-00002): Y corrected gets a new L-00003; B keeps L-00001 with X;
/// when X links back home, B empties into A and the OLDER L-00001 survives on A (L3). A shows L-00001 from then on and
/// its own L-00002 leads to it; the trail on A says where Y went (plan Task 19). Positive control: C2 -> Y takes L-00001.
#[test] fn review_sequence_2_the_folder_keeps_its_number_and_a_later_merge_keeps_the_older() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[2], &meta("Demo B", None)).unwrap();                   // Y: B = L-00001
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // X
    lib.set_meta(&ids[1], &meta("Demo A", None)).unwrap();                   // Q: A = L-00002
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();
    lib.set_meta(&ids[2], &meta("Demo Bee", None)).unwrap();
    lib.confirm_identity(&ids[0], Some(&same("Demo A"))).unwrap();
    println!("X {:?}, Q {:?}, Y {:?}; L1 {:?}; L2 {:?}; {:?}", lid(&lib, &ids[0]), lid(&lib, &ids[1]), lid(&lib, &ids[2]), found(&lib, "L-00001"), found(&lib, "L-00002"), all_numbers(&lib));
    assert_eq!((n_of(&lib, &ids[0]), n_of(&lib, &ids[1]), n_of(&lib, &ids[2])), ("L-00001".into(), "L-00001".into(), "L-00003".into()));
    assert_eq!(found(&lib, "L-00001"), (s("L-00001"), s("Demo A"), false));
    assert_eq!(found(&lib, "L-00002"), (s("L-00001"), s("Demo A"), true));
}

// ---- "Not the same" answers under L9-A: about a number, never rewritten ----
fn shown(lib: &Library, case: &str) -> Vec<String> { lib.load(case).unwrap().id_matches.into_iter().map(|m| m.patient.name).collect() }
/// L9-A: a "Not the same" answer is about a number and stays with it, as an old report does; it is never rewritten.
/// Before X's wrong link, W0 rejects L-00001 (Demo A) and W1 rejects L-00002 (Demo B); through the link (B keeps the
/// older L-00001, L-00002 is retired into it) W2 rejects L-00001 (the combined Demo B). All three then hide Demo B. After
/// the undo, L-00001 is still Demo B's, so all three still hide Demo B and X's new Demo A (L-00006) is suggested to all
/// three: W0's answer, given about Demo A, now hides Demo B (the stated limit, addendum "What a Library ID cannot tell
/// you"). Positive controls (plan Task 17): C6 (no `resolve` in `matches_for`) -> W1 is offered Demo B; C5 (re-point
/// answers at a merge) -> "never rewritten" fails; C2 (the take) -> X shows L-00001.
#[test] fn a_not_the_same_answer_stays_with_its_number_when_a_wrong_link_is_undone() {
    let (_t, _s, mut lib, ids) = films(5);
    let (x, y, w0, w1, w2) = (&ids[0], &ids[1], &ids[2], &ids[3], &ids[4]);
    for (c, n) in [(x, "Demo A"), (y, "Demo B"), (w0, "Demo W0"), (w1, "Demo W1"), (w2, "Demo W2")] {
        lib.set_meta(c, &meta(n, None)).unwrap();
        lib.set_patient_id(c, Some("5566")).unwrap();
    }
    lib.not_same_patient(w0, "L-00001").unwrap();                            // rejects Demo A
    lib.not_same_patient(w1, "L-00002").unwrap();                            // rejects Demo B
    lib.confirm_identity(x, Some(&same("Demo B"))).unwrap();                 // A empties: B = {X, Y} keeps L-00001
    lib.not_same_patient(w2, "L-00001").unwrap();                            // rejects the combined Demo B
    let v = |names: &[&str]| names.iter().map(|n| n.to_string()).collect::<Vec<_>>();
    println!("linked: W0 {:?}; W1 {:?}; W2 {:?}", shown(&lib, w0), shown(&lib, w1), shown(&lib, w2));
    assert_eq!((shown(&lib, w0), shown(&lib, w1), shown(&lib, w2)), (v(&["Demo W1", "Demo W2"]), v(&["Demo W0", "Demo W2"]), v(&["Demo W0", "Demo W1"])));
    lib.set_meta(x, &meta("Demo A", None)).unwrap();                         // undone: X gets L-00006
    println!("undone: X {:?}, Y {:?}; W0 {:?}; W1 {:?}; W2 {:?}", lid(&lib, x), lid(&lib, y), shown(&lib, w0), shown(&lib, w1), shown(&lib, w2));
    assert_eq!((n_of(&lib, x), n_of(&lib, y)), ("L-00006".into(), "L-00001".into()));
    assert_eq!((shown(&lib, w0), shown(&lib, w1), shown(&lib, w2)),
        (v(&["Demo A", "Demo W1", "Demo W2"]), v(&["Demo A", "Demo W0", "Demo W2"]), v(&["Demo A", "Demo W0", "Demo W1"])));
    let mut stored: Vec<(String, i64)> = lib.conn_for_tests().prepare("SELECT case_id, library_no FROM id_link_answers").unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
    stored.sort();
    let mut want = vec![(w0.clone(), 1), (w1.clone(), 2), (w2.clone(), 1)]; want.sort();
    assert_eq!(stored, want, "never rewritten");
}
/// Owner ruling JOIN-HISTORY, kept by L9-A: every move writes one row for each X-ray whose patient, or whose patient's
/// number, changed, saying how; a move that changes neither writes nothing; under L9-A another X-ray's row is only
/// ever a "merge" row. Positive controls: (a) record only the moved X-ray -> Y's "merge" row is missing; (b) skip the
/// "unchanged" check in `record_joins` -> Y gets duplicate rows. The spelling and timepoint edits never reach
/// `record_joins` (`settle_after_move` returns first when the patient is unchanged); dropping that early return as well
/// (control b2) -> they add rows to X.
#[test] fn every_join_is_recorded_with_how_it_happened() {
    let (_t, _s, mut lib, ids) = films(4);
    let (x, y, w, v) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(x, &meta("Demo A", None)).unwrap();                         // typed: L-00001
    lib.set_meta(y, &meta("Demo B", None)).unwrap();                         // typed: L-00002
    lib.set_meta(x, &meta("DEMO A", None)).unwrap();                         // the same patient, new spelling: no row
    lib.set_meta(x, &CaseMeta { timepoint: "Pre".into(), ..meta("DEMO A", None) }).unwrap();   // timepoint only: no row
    lib.confirm_identity(x, Some(&same("Demo B"))).unwrap();                 // A empties: B keeps L-00001, L-00002 retired
    lib.set_meta(x, &meta("Demo A", None)).unwrap();                         // corrected: X gets a new L-00003 (L9-A)
    lib.apply_label(w, &ceph_store::IdentityRead { name: Some("Demo B".into()), ..Default::default() }).unwrap();
    lib.set_meta(w, &meta("", None)).unwrap();                               // cleared: W's own unnamed patient, no number
    lib.set_meta(v, &meta("Demo V", None)).unwrap();                         // typed: L-00004
    lib.confirm_identity(v, Some(&same("Demo B"))).unwrap();                 // V's patient empties: L-00004 retired into L-00001
    for c in [x, y, w, v] { println!("{c}: {:?}", joins(&lib, c)); }
    assert_eq!(joins(&lib, x), j(&[(None, "import"), (Some(1), "typed"), (Some(1), "same_patient"), (Some(3), "corrected")]));
    assert_eq!(joins(&lib, y), j(&[(None, "import"), (Some(2), "typed"), (Some(1), "merge")]));
    assert_eq!(joins(&lib, w), j(&[(None, "import"), (Some(1), "label"), (None, "cleared")]));
    assert_eq!(joins(&lib, v), j(&[(None, "import"), (Some(4), "typed"), (Some(1), "same_patient")]));
    let merged_from: Vec<(String, i64)> = lib.conn_for_tests().prepare("SELECT how, merged_from FROM xray_joins WHERE merged_from IS NOT NULL ORDER BY joined_at, id").unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
    assert_eq!(merged_from, [("merge".to_string(), 2), ("same_patient".to_string(), 4)], "only the rows of X-rays whose number was retired");
    let at: Vec<String> = lib.conn_for_tests().prepare("SELECT joined_at FROM xray_joins WHERE case_id = ?1 ORDER BY joined_at, id").unwrap()
        .query_map([x], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
    assert!(at.windows(2).all(|p| p[0] < p[1]), "each move strictly later: {at:?}");
}
/// Task 13 review M3: every row a move writes names the patient the X-ray is on from then (the trail reads `patient_id`,
/// plan Task 19). After each move of a typed name, a label, a link, a merge that retires the destination's number, a
/// correction off a patient that keeps others and a clearing, every X-ray's last row is (its patient now, that patient's
/// number now). Positive control (induced): write the OTHER patient of the move as `patient_id` in `record_joins` ->
/// this test fails at the first move (a typed name).
#[test] fn every_row_a_move_writes_names_the_patient_the_xray_is_on() {
    let (_t, _s, mut lib, ids) = films(4);
    let (x, y, w, v) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    let check = |lib: &Library, step: &str| {
        let c = lib.conn_for_tests();
        for id in [x, y, w, v] {
            let now: (String, Option<i64>) = c.query_row("SELECT c.patient_id, p.library_no FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1",
                [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            let last: (String, Option<i64>) = c.query_row("SELECT patient_id, library_no FROM xray_joins WHERE case_id = ?1 ORDER BY joined_at DESC, id DESC LIMIT 1",
                [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
            assert_eq!(last, now, "after {step}: X-ray {id}'s last row");
        }
    };
    lib.set_meta(x, &meta("Demo A", None)).unwrap();                             check(&lib, "typed A");
    lib.set_meta(y, &meta("Demo B", None)).unwrap();                             check(&lib, "typed B");
    lib.set_meta(v, &meta("Demo B", None)).unwrap();                             check(&lib, "typed B again");
    lib.apply_label(w, &ceph_store::IdentityRead { name: Some("Demo A".into()), ..Default::default() }).unwrap();   check(&lib, "label");
    lib.confirm_identity(w, Some(&same("Demo B"))).unwrap();                     check(&lib, "a link (A keeps X)");
    lib.confirm_identity(x, Some(&same("Demo B"))).unwrap();                     check(&lib, "a merge: A empties into B");
    lib.set_meta(x, &meta("Demo A", None)).unwrap();                             check(&lib, "a separation");
    lib.set_meta(w, &meta("", None)).unwrap();                                   check(&lib, "cleared");
    let rows: i64 = lib.conn_for_tests().query_row("SELECT COUNT(*) FROM xray_joins", [], |r| r.get(0)).unwrap();
    println!("rows checked across the moves: {rows}");
}
// ---- Every breach a review found against the give-back, pinned under L9-A ----
fn found(lib: &Library, id: &str) -> (Option<String>, Option<String>, bool) {
    let f = lib.find_library_id(id).unwrap().unwrap();
    (f.current, f.patient.map(|p| p.name), f.merged)
}
fn s(x: &str) -> Option<String> { Some(x.to_string()) }

/// Re-review P1: three ordinary moves. W, imported and named into the combined Demo P after the merge, held nothing
/// from the start and takes nothing when corrected. Fails at the Task 13 head: L-00001 -> Demo W, Y and Z show L-00002.
/// L9-A: still pinned as found. Positive control: C2 (plan Task 17) -> fails.
#[test] fn three_ordinary_moves_never_give_a_number_to_an_xray_that_only_passed_through() {
    let (_t, _s, mut lib, ids) = films(3);
    let (y, z, w) = (&ids[0], &ids[1], &ids[2]);
    lib.set_meta(y, &meta("Demo M", None)).unwrap();                          // L-00001
    lib.set_meta(z, &meta("Demo P", None)).unwrap();                          // L-00002
    lib.confirm_identity(y, Some(&same("Demo P"))).unwrap();                  // M empties: P keeps L-00001
    lib.set_meta(w, &meta("Demo P", None)).unwrap();
    lib.set_meta(w, &meta("Demo W", None)).unwrap();
    println!("P1 Y {:?} Z {:?} W {:?}; L1 {:?}; L2 {:?}", lid(&lib, y), lid(&lib, z), lid(&lib, w), found(&lib, "L-00001"), found(&lib, "L-00002"));
    assert_eq!((n_of(&lib, y), n_of(&lib, z), n_of(&lib, w)), ("L-00001".into(), "L-00001".into(), "L-00003".into()));
    assert_eq!(found(&lib, "L-00001"), (s("L-00001"), s("Demo P"), false));
    assert_eq!(found(&lib, "L-00002"), (s("L-00001"), s("Demo P"), true));
}
/// Re-review P2 under L9-A: Y corrected off B gets a new L-00003 and B keeps L-00002 with X; W named into B and then
/// corrected gets L-00004; nobody else changes. Failed at 860fbb1 (L-00003 -> Demo W). Positive control: C2 -> W takes
/// L-00002.
#[test] fn an_xray_passing_through_after_the_original_was_corrected_off_takes_nothing() {
    let (_t, _s, mut lib, ids) = films(4);
    let (x, q, y, w) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(x, &meta("Demo A", None)).unwrap();
    lib.set_meta(q, &meta("Demo A", None)).unwrap();                          // L-00001
    lib.set_meta(y, &meta("Demo B", None)).unwrap();                          // L-00002
    lib.confirm_identity(x, Some(&same("Demo B"))).unwrap();
    lib.set_meta(y, &meta("Demo Bee", None)).unwrap();                        // Y: a new L-00003; B keeps L-00002 with X
    lib.set_meta(w, &meta("Demo B", None)).unwrap();
    lib.set_meta(w, &meta("Demo W", None)).unwrap();
    println!("P2 X {:?} Q {:?} Y {:?} W {:?}; L2 {:?}; L3 {:?}", lid(&lib, x), lid(&lib, q), lid(&lib, y), lid(&lib, w), found(&lib, "L-00002"), found(&lib, "L-00003"));
    assert_eq!((n_of(&lib, x), n_of(&lib, q), n_of(&lib, y), n_of(&lib, w)), ("L-00002".into(), "L-00001".into(), "L-00003".into(), "L-00004".into()));
    assert_eq!((found(&lib, "L-00002"), found(&lib, "L-00003")), ((s("L-00002"), s("Demo B"), false), (s("L-00003"), s("Demo Bee"), false)));
}
/// Re-review P3: Z linked into P, then split off to Demo S (L-00003); W in and out of S takes nothing. Fails at the
/// Task 13 head: L-00003 -> Demo W.
/// L9-A: still pinned as found. Positive control: C2 (plan Task 17) -> fails.
#[test] fn an_xray_passing_through_a_split_off_patient_takes_nothing() {
    let (_t, _s, mut lib, ids) = films(4);
    let (z, q, y, w) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(z, &meta("Demo M", None)).unwrap();
    lib.set_meta(q, &meta("Demo M", None)).unwrap();                          // L-00001
    lib.set_meta(y, &meta("Demo P", None)).unwrap();                          // L-00002
    lib.confirm_identity(z, Some(&same("Demo P"))).unwrap();
    lib.set_meta(z, &meta("Demo S", None)).unwrap();                          // split: L-00003
    lib.set_meta(w, &meta("Demo S", None)).unwrap();
    lib.set_meta(w, &meta("Demo W", None)).unwrap();
    println!("P3 Z {:?} Q {:?} Y {:?} W {:?}; L3 {:?}", lid(&lib, z), lid(&lib, q), lid(&lib, y), lid(&lib, w), found(&lib, "L-00003"));
    assert_eq!((n_of(&lib, z), n_of(&lib, q), n_of(&lib, y), n_of(&lib, w)), ("L-00003".into(), "L-00001".into(), "L-00002".into(), "L-00004".into()));
    assert_eq!(found(&lib, "L-00003"), (s("L-00003"), s("Demo S"), false));
}
/// Re-review P3b: as P3, but Z's name is cleared and then retyped (a new patient, L-00003). Fails at the Task 13 head.
/// L9-A: still pinned as found. Positive control: C2 (plan Task 17) -> fails.
#[test] fn an_xray_passing_through_a_patient_retyped_after_clearing_takes_nothing() {
    let (_t, _s, mut lib, ids) = films(4);
    let (z, q, y, w) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(z, &meta("Demo M", None)).unwrap();
    lib.set_meta(q, &meta("Demo M", None)).unwrap();
    lib.set_meta(y, &meta("Demo P", None)).unwrap();
    lib.confirm_identity(z, Some(&same("Demo P"))).unwrap();
    lib.set_meta(z, &meta("", None)).unwrap();
    lib.set_meta(z, &meta("Demo S", None)).unwrap();                          // a new patient: L-00003
    lib.set_meta(w, &meta("Demo S", None)).unwrap();
    lib.set_meta(w, &meta("Demo W", None)).unwrap();
    println!("P3b Z {:?} Q {:?} Y {:?} W {:?}; L3 {:?}", lid(&lib, z), lid(&lib, q), lid(&lib, y), lid(&lib, w), found(&lib, "L-00003"));
    assert_eq!((n_of(&lib, z), n_of(&lib, q), n_of(&lib, y), n_of(&lib, w)), ("L-00003".into(), "L-00001".into(), "L-00002".into(), "L-00004".into()));
    assert_eq!(found(&lib, "L-00003"), (s("L-00003"), s("Demo S"), false));
}
/// Re-review P4: as P1, but Y moves on to Demo Q before W leaves. Fails at the Task 13 head: L-00001 -> Demo W.
/// L9-A: still pinned as found. Positive control: C2 (plan Task 17) -> fails.
#[test] fn an_xray_passing_through_after_the_original_moved_on_takes_nothing() {
    let (_t, _s, mut lib, ids) = films(4);
    let (y, z, w, q) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(y, &meta("Demo M", None)).unwrap();                          // L-00001
    lib.set_meta(z, &meta("Demo P", None)).unwrap();                          // L-00002
    lib.set_meta(q, &meta("Demo Q", None)).unwrap();                          // L-00003
    lib.confirm_identity(y, Some(&same("Demo P"))).unwrap();
    lib.set_meta(w, &meta("Demo P", None)).unwrap();
    lib.confirm_identity(y, Some(&same("Demo Q"))).unwrap();
    lib.set_meta(w, &meta("Demo W", None)).unwrap();
    println!("P4 Y {:?} Z {:?} W {:?} Q {:?}; L1 {:?}", lid(&lib, y), lid(&lib, z), lid(&lib, w), lid(&lib, q), found(&lib, "L-00001"));
    assert_eq!((n_of(&lib, y), n_of(&lib, z), n_of(&lib, w), n_of(&lib, q)), ("L-00003".into(), "L-00001".into(), "L-00004".into(), "L-00003".into()));
    assert_eq!(found(&lib, "L-00001"), (s("L-00001"), s("Demo P"), false));
}
/// Re-review R1: the I1 shape, then Y's name is cleared off B; W in and out of B takes nothing. Fails at the Task 13
/// head: L-00002 -> Demo W.
/// L9-A: still pinned as found. Positive control: C2 (plan Task 17) -> fails.
#[test] fn an_xray_passing_through_after_the_original_was_cleared_takes_nothing() {
    let (_t, _s, mut lib, ids) = films(4);
    let (x, q, y, w) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(x, &meta("Demo A", None)).unwrap();
    lib.set_meta(q, &meta("Demo A", None)).unwrap();                          // L-00001
    lib.set_meta(y, &meta("Demo B", None)).unwrap();                          // L-00002
    lib.confirm_identity(x, Some(&same("Demo B"))).unwrap();
    lib.set_meta(y, &meta("", None)).unwrap();
    lib.set_meta(w, &meta("Demo B", None)).unwrap();
    lib.set_meta(w, &meta("Demo W", None)).unwrap();
    println!("R1 X {:?} Q {:?} Y {:?} W {:?}; L2 {:?}", lid(&lib, x), lid(&lib, q), lid(&lib, y), lid(&lib, w), found(&lib, "L-00002"));
    assert_eq!((n_of(&lib, x), n_of(&lib, q), lid(&lib, y), n_of(&lib, w)), ("L-00002".into(), "L-00001".into(), None, "L-00003".into()));
    assert_eq!(found(&lib, "L-00002"), (s("L-00002"), s("Demo B"), false));
}
/// Re-review R1's purge variant (reasoned there, probed here): Y removed for good instead of cleared. Fails at the
/// Task 13 head: L-00002 -> Demo W.
/// L9-A: still pinned as found. Positive control: C2 (plan Task 17) -> fails.
#[test] fn an_xray_passing_through_after_the_original_was_removed_for_good_takes_nothing() {
    let (_t, _s, mut lib, ids) = films(4);
    let (x, q, y, w) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(x, &meta("Demo A", None)).unwrap();
    lib.set_meta(q, &meta("Demo A", None)).unwrap();
    lib.set_meta(y, &meta("Demo B", None)).unwrap();
    lib.confirm_identity(x, Some(&same("Demo B"))).unwrap();
    lib.delete(y).unwrap(); lib.purge_deleted(0).unwrap();
    lib.set_meta(w, &meta("Demo B", None)).unwrap();
    lib.set_meta(w, &meta("Demo W", None)).unwrap();
    println!("R1p X {:?} Q {:?} W {:?}; L2 {:?}", lid(&lib, x), lid(&lib, q), lid(&lib, w), found(&lib, "L-00002"));
    assert_eq!((n_of(&lib, x), n_of(&lib, q), n_of(&lib, w)), ("L-00002".into(), "L-00001".into(), "L-00003".into()));
    assert_eq!(found(&lib, "L-00002"), (s("L-00002"), s("Demo B"), false));
}
/// V2 (found while writing the Join history spec; also at aaf2fee): X only VISITED B and then C; when Y's move merges
/// B into C, X owns neither number and gets a new one when corrected. Fails at the Task 13 head: X takes L-00002 to
/// Demo Xavier (the notes treated a visit as carrying).
/// L9-A: still pinned as found. Positive control: C2 (plan Task 17) -> fails.
#[test] fn a_visitor_never_takes_the_number_of_a_patient_it_only_visited() {
    let (_t, _s, mut lib, ids) = films(4);
    let (x, q, y, z) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(x, &meta("Demo A", None)).unwrap();
    lib.set_meta(q, &meta("Demo A", None)).unwrap();                          // L-00001
    lib.set_meta(y, &meta("Demo B", None)).unwrap();                          // L-00002
    lib.set_meta(z, &meta("Demo C", None)).unwrap();                          // L-00003
    lib.confirm_identity(x, Some(&same("Demo B"))).unwrap();                  // a visit (A keeps Q)
    lib.confirm_identity(x, Some(&same("Demo C"))).unwrap();                  // another visit (B keeps Y)
    lib.confirm_identity(y, Some(&same("Demo C"))).unwrap();                  // B empties: C keeps L-00002, L-00003 retired
    lib.set_meta(x, &meta("Demo Xavier", None)).unwrap();
    println!("V2 X {:?} Q {:?} Y {:?} Z {:?}; L2 {:?}; L3 {:?}", lid(&lib, x), lid(&lib, q), lid(&lib, y), lid(&lib, z), found(&lib, "L-00002"), found(&lib, "L-00003"));
    assert_eq!((n_of(&lib, x), n_of(&lib, q), n_of(&lib, y), n_of(&lib, z)), ("L-00004".into(), "L-00001".into(), "L-00002".into(), "L-00002".into()));
    assert_eq!(found(&lib, "L-00002"), (s("L-00002"), s("Demo C"), false));
    assert_eq!(found(&lib, "L-00003"), (s("L-00002"), s("Demo C"), true));
}
/// Kept from JOIN-HISTORY, still true under L9-A: X corrected off A gets a new number and A keeps L-00001 with V and W.
/// Positive control: C2 (plan Task 17) -> X takes L-00001.
#[test] fn a_newcomer_from_no_number_keeps_the_number_with_its_patient() {
    let (_t, _s, mut lib, ids) = films(4);
    let (x, v, q2, w) = (&ids[0], &ids[1], &ids[2], &ids[3]);
    lib.set_meta(x, &meta("Demo A", None)).unwrap();                          // L-00001
    lib.set_meta(v, &meta("Demo B", None)).unwrap();
    lib.set_meta(q2, &meta("Demo B", None)).unwrap();                         // L-00002
    lib.confirm_identity(v, Some(&same("Demo A"))).unwrap();                  // V linked in (B keeps Q2)
    lib.set_meta(w, &meta("Demo A", None)).unwrap();
    lib.set_meta(x, &meta("Demo Xavier", None)).unwrap();
    println!("VW X {:?} V {:?} W {:?}; L1 {:?}", lid(&lib, x), lid(&lib, v), lid(&lib, w), found(&lib, "L-00001"));
    assert_eq!((n_of(&lib, x), n_of(&lib, v), n_of(&lib, w), n_of(&lib, q2)), ("L-00003".into(), "L-00001".into(), "L-00001".into(), "L-00002".into()));
    assert_eq!(found(&lib, "L-00001"), (s("L-00001"), s("Demo A"), false));
}
/// Purge of the first linked X-ray (JOIN-HISTORY), still true under L9-A: B = {Y}; X1 (from A) linked in; W named into B;
/// X2 (from C) linked in; Y's name cleared; X1 removed for good; W corrected: W gets a new number and B keeps L-00002.
/// Failed at 860fbb1 (W took L-00002 to Demo W). Positive control: C2 (plan Task 17) -> W takes L-00002.
#[test] fn removing_the_first_linked_xray_for_good_changes_no_ones_start() {
    let (_t, _s, mut lib, ids) = films(7);
    let (x1, q1, y, x2, q2, w) = (&ids[0], &ids[1], &ids[2], &ids[3], &ids[4], &ids[5]);
    lib.set_meta(x1, &meta("Demo A", None)).unwrap();
    lib.set_meta(q1, &meta("Demo A", None)).unwrap();                         // L-00001
    lib.set_meta(y, &meta("Demo B", None)).unwrap();                          // L-00002
    lib.set_meta(x2, &meta("Demo C", None)).unwrap();
    lib.set_meta(q2, &meta("Demo C", None)).unwrap();                         // L-00003
    lib.confirm_identity(x1, Some(&same("Demo B"))).unwrap();                 // first link into L-00002
    lib.set_meta(w, &meta("Demo B", None)).unwrap();                          // W named into B after it
    lib.confirm_identity(x2, Some(&same("Demo B"))).unwrap();                 // a second link
    lib.set_meta(y, &meta("", None)).unwrap();                                // B's own X-ray leaves without a number
    lib.delete(x1).unwrap(); lib.purge_deleted(0).unwrap();                   // the first linked X-ray removed for good
    lib.set_meta(w, &meta("Demo W", None)).unwrap();
    println!("W {:?} X2 {:?}; L2 {:?}", lid(&lib, w), lid(&lib, x2), found(&lib, "L-00002"));
    assert_eq!((n_of(&lib, w), n_of(&lib, x2)), ("L-00004".into(), "L-00002".into()));
    assert_eq!(found(&lib, "L-00002"), (s("L-00002"), s("Demo B"), false));
}

// ---- Owner ruling L9-A: the trail on the patient view (where each number went) ----
fn trail(lib: &Library, case: &str) -> Vec<String> {
    lib.load(case).unwrap().library_trail.iter().map(|t| match t {
        TrailLine::Merged { number, into, .. } => format!("{number} merged into {into}"),
        TrailLine::Left { number, now, name, .. } => format!("left {number}: now {} {name}", now.as_deref().unwrap_or("none")),
    }).collect()
}
fn trail_days(lib: &Library, case: &str) -> Vec<String> {
    lib.load(case).unwrap().library_trail.into_iter().map(|t| match t { TrailLine::Merged { on, .. } | TrailLine::Left { on, .. } => on }).collect()
}
/// L9-A: after a wrong link is undone, the patient that kept the number shows where everything went, oldest first:
/// its own number that was merged in, and the X-ray that left with its new number. The X-ray's new patient shows
/// nothing. Each line carries the local day of the move. Positive control: return only the merged lines from `trail`
/// -> the "left" line is missing.
#[test] fn the_trail_shows_a_number_merged_in_and_an_xray_that_left() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // L-00001 (X)
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();                   // L-00002 (Y)
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();           // A empties: B keeps L-00001
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // undone: X gets L-00003
    println!("B: {:?} {:?}; A: {:?}", trail(&lib, &ids[1]), trail_days(&lib, &ids[1]), trail(&lib, &ids[0]));
    assert_eq!(trail(&lib, &ids[1]), ["L-00002 merged into L-00001", "left L-00001: now L-00003 Demo A"]);
    assert_eq!(trail_days(&lib, &ids[1]), [lib.today_local().unwrap(), lib.today_local().unwrap()]);
    assert!(trail(&lib, &ids[0]).is_empty(), "the X-ray's new patient has no history of its own yet");
}
/// L9-A: the trail follows chains (each number names the one it was merged into), names the number an X-ray left
/// when that number was merged later (review sequence 1: "left L-00002"), and lists only live X-rays: one in Recently
/// deleted is not listed until restored, and one removed for good is gone, while the merged lines stay. Positive
/// controls: list only numbers merged straight into this one -> the L-00003 line is missing; list X-rays in Recently
/// deleted too -> the line stays after the delete.
#[test] fn the_trail_follows_chains_and_lists_only_live_xrays() {
    let (_t, _s, mut lib, ids) = films(4);
    lib.set_meta(&ids[2], &meta("Demo C", None)).unwrap();                   // L-00001 (Z)
    lib.set_meta(&ids[1], &meta("Demo B", None)).unwrap();                   // L-00002 (Y)
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // L-00003 (X)
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();           // 3 into 2
    lib.confirm_identity(&ids[1], Some(&same("Demo C"))).unwrap();           // Y joins C (B keeps X)
    lib.confirm_identity(&ids[0], Some(&same("Demo C"))).unwrap();           // B empties: 2 into 1
    lib.set_meta(&ids[0], &meta("Demo Ax", None)).unwrap();                  // X out of C: L-00004
    let chain = ["L-00003 merged into L-00002", "L-00002 merged into L-00001", "left L-00001: now L-00004 Demo Ax"];
    println!("C: {:?}", trail(&lib, &ids[2]));
    assert_eq!(trail(&lib, &ids[2]), chain);
    lib.delete(&ids[0]).unwrap();
    assert_eq!(trail(&lib, &ids[2]), chain[..2], "an X-ray in Recently deleted is not listed");
    lib.restore(&ids[0]).unwrap();
    assert_eq!(trail(&lib, &ids[2]), chain, "listed again after Restore");
    lib.delete(&ids[0]).unwrap(); lib.purge_deleted(0).unwrap();
    assert_eq!(trail(&lib, &ids[2]), chain[..2], "removed for good: its line goes, the numbers' lines stay");
    let w = &ids[3];
    assert!(trail(&lib, w).is_empty(), "an unnamed X-ray has no number and no trail");
}
/// Review sequence 1 under L9-A: Y is corrected off B (a new L-00003) and B, holding only X, later empties into A. A's
/// trail names L-00002, the number Y left, so a reader holding Y's old report can follow it to Demo Bee. Positive
/// control: name the patient's current number instead of the number left -> the line reads "left L-00001".
#[test] fn the_trail_names_the_number_an_xray_left_when_that_number_was_merged_later() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.set_meta(&ids[0], &meta("Demo A", None)).unwrap();                   // X
    lib.set_meta(&ids[1], &meta("Demo A", None)).unwrap();                   // Q: A = L-00001
    lib.set_meta(&ids[2], &meta("Demo B", None)).unwrap();                   // Y: B = L-00002
    lib.confirm_identity(&ids[0], Some(&same("Demo B"))).unwrap();
    lib.set_meta(&ids[2], &meta("Demo Bee", None)).unwrap();                 // Y: L-00003
    lib.confirm_identity(&ids[0], Some(&same("Demo A"))).unwrap();           // B empties into A
    println!("A: {:?}", trail(&lib, &ids[1]));
    assert_eq!(trail(&lib, &ids[1]), ["left L-00002: now L-00003 Demo Bee", "L-00002 merged into L-00001"]);
}
/// The trail reaches the screen as `{ kind: "merged" | "left", … }` (ipc.ts `TrailLine`; the e2e12 stub sends the
/// same). Positive control: drop `tag = "kind"` from `TrailLine` -> the JSON is `{"left": {…}}` and this fails.
#[test] fn the_trail_reaches_the_screen_as_kind_tagged_json() {
    let l = TrailLine::Left { number: "L-00001".into(), on: "2026-10-18".into(), now: None, name: String::new() };
    let m = TrailLine::Merged { number: "L-00002".into(), into: "L-00001".into(), on: "2026-10-17".into() };
    assert_eq!(serde_json::to_value(&l).unwrap(), serde_json::json!({ "kind": "left", "number": "L-00001", "on": "2026-10-18", "now": null, "name": "" }));
    assert_eq!(serde_json::to_value(&m).unwrap(), serde_json::json!({ "kind": "merged", "number": "L-00002", "into": "L-00001", "on": "2026-10-17" }));
}
