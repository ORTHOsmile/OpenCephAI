//! Film layouts on synthetic films and synthetic tokens only.
use ceph_label::layout::FilmToken;
use ceph_store::{CaseMeta, Library};
use std::path::{Path, PathBuf};

pub fn film(dir: &Path, name: &str, seed: u8, w: u32, h: u32) -> PathBuf {
    let p = dir.join(name);
    image::GrayImage::from_fn(w, h, |x, y| image::Luma([((x * 3 + y) as u8).wrapping_add(seed)])).save(&p).unwrap();
    p
}
/// "Demo Ceph A": practice line top-left, DOB and PID labels below it.
pub fn demo_a(dx: f64) -> Vec<FilmToken> {
    [("demo", 0.05), ("radiology", 0.15), ("northside", 0.27)].iter().map(|(t, x)| tok(t, x + dx, 0.03))
        .chain([tok("dob", 0.04 + dx, 0.12), tok("pid", 0.04 + dx, 0.15)]).collect()
}
pub fn tok(t: &str, x: f64, y: f64) -> FilmToken { FilmToken { token: t.into(), text: t.into(), cx: x, cy: y } }
pub fn name(lib: &mut Library, case: &str, n: &str) {
    lib.set_meta(case, &CaseMeta { patient_name: n.into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None }).unwrap();
}

#[test] fn the_first_film_creates_a_machine_and_the_next_of_its_size_matches_it_while_young() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0, 400, 300)).unwrap().case_id;
    let m1 = lib.match_machine(&a, &demo_a(0.0)).unwrap();
    assert!(m1.created && !m1.mirrored);
    name(&mut lib, &a, "Demo Alpha"); lib.record_confirmed_film(&a, &demo_a(0.0)).unwrap();
    let b = lib.import(&film(src.path(), "b.png", 1, 400, 300)).unwrap().case_id;
    let m2 = lib.match_machine(&b, &demo_a(0.0)).unwrap();
    assert_eq!((m2.machine_id.as_str(), m2.created), (m1.machine_id.as_str(), false), "candidates match a young machine");
    let c = lib.import(&film(src.path(), "c.png", 2, 300, 900)).unwrap().case_id;
    assert!(lib.match_machine(&c, &demo_a(0.0)).unwrap().created, "another film size is another machine");
}

/// Review focus 2.
#[test] fn a_slightly_shifted_film_matches_and_a_far_shifted_one_is_a_new_machine() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let ids: Vec<String> = (0..2).map(|i| lib.import(&film(src.path(), &format!("{i}.png"), i, 400, 300)).unwrap().case_id).collect();
    let m = lib.match_machine(&ids[0], &demo_a(0.0)).unwrap();
    name(&mut lib, &ids[0], "Demo Alpha"); lib.record_confirmed_film(&ids[0], &demo_a(0.0)).unwrap();
    lib.match_machine(&ids[1], &demo_a(0.0)).unwrap();
    name(&mut lib, &ids[1], "Demo Beta"); lib.record_confirmed_film(&ids[1], &demo_a(0.0)).unwrap();   // anchors now
    let near = lib.import(&film(src.path(), "near.png", 7, 400, 300)).unwrap().case_id;
    assert_eq!(lib.match_machine(&near, &demo_a(0.02)).unwrap().machine_id, m.machine_id);
    let far = lib.import(&film(src.path(), "far.png", 8, 400, 300)).unwrap().case_id;
    assert!(lib.match_machine(&far, &demo_a(0.2)).unwrap().created);
}

/// Review focus 5.
#[test] fn a_flipped_export_matches_its_machine_mirrored() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let ids: Vec<String> = (0..3).map(|i| lib.import(&film(src.path(), &format!("{i}.png"), i, 400, 300)).unwrap().case_id).collect();
    let m = lib.match_machine(&ids[0], &demo_a(0.0)).unwrap();
    for (i, n) in [(0, "Demo Alpha"), (1, "Demo Beta")] {
        if i == 1 { lib.match_machine(&ids[1], &demo_a(0.0)).unwrap(); }
        name(&mut lib, &ids[i], n); lib.record_confirmed_film(&ids[i], &demo_a(0.0)).unwrap();
    }
    let flipped: Vec<FilmToken> = demo_a(0.0).into_iter().map(|t| FilmToken { cx: 1.0 - t.cx, ..t }).collect();
    let got = lib.match_machine(&ids[2], &flipped).unwrap();
    assert_eq!((got.machine_id.as_str(), got.mirrored), (m.machine_id.as_str(), true));
}

fn anchor_count(root: &Path) -> i64 { rusqlite::Connection::open(root.join("library.sqlite3")).unwrap().query_row("SELECT COUNT(*) FROM layout_anchors", [], |r| r.get(0)).unwrap() }
fn candidate_count(root: &Path) -> i64 { rusqlite::Connection::open(root.join("library.sqlite3")).unwrap().query_row("SELECT COUNT(*) FROM layout_candidates", [], |r| r.get(0)).unwrap() }
fn stored_text(root: &Path) -> Vec<String> {
    let c = rusqlite::Connection::open(root.join("library.sqlite3")).unwrap();
    let mut v: Vec<String> = c.prepare("SELECT text FROM layout_anchors").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    v.extend(c.prepare("SELECT token_hash FROM layout_candidates").unwrap().query_map([], |r| r.get::<_, String>(0)).unwrap().map(Result::unwrap));
    v
}

/// Review focus 1.
#[test] fn the_same_patient_twice_never_makes_an_anchor() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let with_name = |dx: f64| { let mut v = demo_a(dx); v.push(tok("smith", 0.05, 0.06)); v.push(tok("john", 0.12, 0.06)); v };   // SYNTHETIC
    for i in 0..2u8 {
        let c = lib.import(&film(src.path(), &format!("{i}.png"), i, 400, 300)).unwrap().case_id;
        lib.match_machine(&c, &with_name(0.0)).unwrap();
        name(&mut lib, &c, "Smith, John");   // SYNTHETIC
        lib.record_confirmed_film(&c, &with_name(0.0)).unwrap();
    }
    assert_eq!(anchor_count(t.path()), 0, "one patient twice is not two patients");
}

#[test] fn two_patients_promote_the_pattern_but_never_their_names() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    for (i, (surname, given)) in [("smith", "john"), ("jones", "anna")].iter().enumerate() {   // SYNTHETIC
        let c = lib.import(&film(src.path(), &format!("{i}.png"), i as u8, 400, 300)).unwrap().case_id;
        let mut toks = demo_a(0.0); toks.push(tok(surname, 0.05, 0.06)); toks.push(tok(given, 0.12, 0.06));
        lib.match_machine(&c, &toks).unwrap();
        name(&mut lib, &c, &format!("{surname}, {given}"));
        lib.record_confirmed_film(&c, &toks).unwrap();
    }
    assert_eq!(anchor_count(t.path()), 5);
    let stored = stored_text(t.path()).join(" ").to_lowercase();
    for word in ["smith", "john", "jones", "anna"] { assert!(!stored.contains(word), "{word} stored"); }   // SYNTHETIC
    let names = lib.list_machines().unwrap();
    assert_eq!(names[0].name, "demo radiology northside", "named after its longest non-label anchor row");
}

#[test] fn a_films_own_name_and_scan_id_are_never_candidates() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "a.png", 0, 400, 300)).unwrap().case_id;
    let mut toks = demo_a(0.0);
    toks.extend([tok("smith", 0.05, 0.06), tok("john", 0.12, 0.06), tok("abc", 0.10, 0.15)]);   // SYNTHETIC
    lib.match_machine(&c, &toks).unwrap();
    lib.set_meta(&c, &CaseMeta { patient_name: "Smith, John".into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: Some("ABC".into()) }).unwrap();   // SYNTHETIC
    lib.record_confirmed_film(&c, &toks).unwrap();
    assert_eq!(candidate_count(t.path()), 5, "only the pattern words: never the name or the scan ID");
}

/// Spec 2026-10-17: a Patient ID identifies the patient, so its words are never pattern words (like the scan ID).
#[test] fn a_films_own_patient_id_is_never_a_candidate() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "a.png", 0, 400, 300)).unwrap().case_id;
    let mut toks = demo_a(0.0);
    toks.extend([tok("smith", 0.05, 0.06), tok("john", 0.12, 0.06), tok("zq", 0.10, 0.15)]);   // SYNTHETIC
    lib.match_machine(&c, &toks).unwrap();
    name(&mut lib, &c, "Smith, John");   // SYNTHETIC
    lib.set_patient_id(&c, Some("ZQ 7781")).unwrap();
    lib.record_confirmed_film(&c, &toks).unwrap();
    assert_eq!(candidate_count(t.path()), 5, "only the pattern words: never the name or the Patient ID");
}

// `a_referrers_words_are_never_pattern_words` moved to `crates/ceph-store/src/layouts.rs`'s own `#[cfg(test)]`
// module (fix round 1, review Important 1): it needs `token_hash`, which is `pub(crate)` and invisible from this
// integration-test crate. A hand-copied reimplementation of that hash lived here instead, which could silently
// drift from the real one and stop proving anything; the in-crate test uses the real function directly.

#[test] fn an_unconfirmed_or_unnamed_case_records_nothing() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "a.png", 0, 400, 300)).unwrap().case_id;
    lib.match_machine(&c, &demo_a(0.0)).unwrap();
    lib.record_confirmed_film(&c, &demo_a(0.0)).unwrap();
    // Only its pending hashes (for matching the next film; final review I2): no pattern candidates, no anchors.
    let db = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
    let taught: i64 = db.query_row("SELECT COUNT(*) FROM layout_candidates WHERE patient_id NOT LIKE 'pending:%'", [], |r| r.get(0)).unwrap();
    assert_eq!((taught, anchor_count(t.path())), (0, 0));
}

use ceph_label::layout::{End, Rule, Start};
use ceph_store::{merge_reads, IdentityRead};
fn last_rule(dy: f64) -> Rule { Rule { row_y: 0.06 + dy, right: false, start: Start::Line, end: End::Comma } }
/// `n` films of one machine; the first two are confirmed for two different patients, so the machine has its pattern.
fn setup(lib: &mut Library, src: &Path, n: u8) -> Vec<String> {
    (0..n).map(|i| {
        let c = lib.import(&film(src, &format!("{i}.png"), i, 400, 300)).unwrap().case_id;
        lib.match_machine(&c, &demo_a(0.0)).unwrap();
        if i < 2 { name(lib, &c, ["Demo Alpha", "Demo Beta"][i as usize]); lib.record_confirmed_film(&c, &demo_a(0.0)).unwrap(); }
        c
    }).collect()
}
fn shifted(dy: f64) -> Vec<FilmToken> { demo_a(0.0).into_iter().map(|t| FilmToken { cy: t.cy + dy, ..t }).collect() }

#[test] fn a_place_becomes_the_default_after_3_and_a_correction_takes_over() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 8);
    for id in &c[..2] { lib.learn(id, "last", &last_rule(0.0)).unwrap(); }
    assert!(!lib.places(&c[2]).unwrap().iter().any(|p| p.default), "2 is not enough");
    lib.learn(&c[2], "last", &last_rule(0.01)).unwrap();                   // same row within tolerance
    let p = lib.places(&c[3]).unwrap();
    assert_eq!((p.len(), p[0].count, p[0].default), (1, 3, true));
    let moved = Rule { row_y: 0.20, ..last_rule(0.0) };
    for id in &c[3..6] { lib.learn(id, "last", &moved).unwrap(); }          // each takes 1 from the old leader
    let p = lib.places(&c[6]).unwrap();
    let def: Vec<&ceph_store::Place> = p.iter().filter(|p| p.default).collect();
    assert_eq!((def.len(), (def[0].rule.row_y - 0.20).abs() < 1e-9), (1, true));
}

/// Review focus 5.
#[test] fn a_flipped_export_reads_the_mirrored_place() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 2);
    lib.learn(&c[0], "last", &last_rule(0.0)).unwrap();
    rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap()
        .execute("UPDATE cases SET layout_mirrored = 1 WHERE id = ?1", [&c[1]]).unwrap();
    assert!(lib.places(&c[1]).unwrap()[0].rule.right, "the learned left-side place is on the right of a flipped film");
    lib.learn(&c[1], "last", &Rule { right: true, ..last_rule(0.0) }).unwrap();
    assert_eq!(lib.places(&c[0]).unwrap()[0].count, 2, "a flipped film's confirmation counts for the same place");
}

/// Review focus 3.
#[test] fn a_default_from_one_machine_never_fills_a_film_from_another() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 3);
    for id in &c { lib.learn(id, "last", &last_rule(0.0)).unwrap(); }
    let other = lib.import(&film(src.path(), "other.png", 9, 400, 300)).unwrap().case_id;
    lib.match_machine(&other, &[tok("planmeca", 0.5, 0.9), tok("promax", 0.6, 0.9)]).unwrap();
    assert!(lib.places(&other).unwrap().is_empty());
}

#[test] fn label_and_learned_values_combine_by_the_fill_table() {
    let r = |n: Option<&str>, d: Option<&str>| IdentityRead { name: n.map(Into::into), date_of_birth: d.map(Into::into), scan_date: None, scan_id: None };
    let (m, learned, conflicts) = merge_reads(&r(Some("Demo Synthetic"), None), &r(Some("DEMO SYNTHETIC"), None));
    assert_eq!((m.name.as_deref(), learned.len(), conflicts.len()), (Some("Demo Synthetic"), 0, 0), "agree: read from the film");
    let (m, learned, _) = merge_reads(&r(None, None), &r(Some("Demo Synthetic"), Some("1990-03-07")));   // SYNTHETIC
    assert_eq!((m.name.as_deref(), m.date_of_birth.as_deref(), learned), (Some("Demo Synthetic"), Some("1990-03-07"), vec!["name".to_string(), "dob".to_string()]));   // SYNTHETIC
    let (m, _, conflicts) = merge_reads(&r(Some("Demo Synthetic"), None), &r(Some("Other Person"), None));
    assert_eq!((m.name, conflicts.len(), conflicts[0].field.as_str()), (None, 1, "name"), "disagree: blank and ask");
}

#[test] fn a_learned_fill_is_noted_until_confirmed_or_edited() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 2);
    let learned = IdentityRead { name: Some("Demo Synthetic".into()), date_of_birth: Some("1990-03-07".into()), scan_date: None, scan_id: None };   // SYNTHETIC
    let out = lib.apply_label_with(&c[1], &IdentityRead::default(), &learned).unwrap();
    assert_eq!(out.learned_fields, ["name", "dob"]);
    let d = lib.load(&c[1]).unwrap();
    assert_eq!((d.patient_name.as_str(), d.learned_fields.clone()), ("Demo Synthetic", vec!["name".to_string(), "dob".to_string()]));
    lib.confirm_identity(&c[1], None).unwrap();
    assert!(lib.load(&c[1]).unwrap().learned_fields.is_empty());
    lib.apply_label_with(&c[1], &IdentityRead::default(), &learned).unwrap();
    let keep = |tp: &str, name: &str| CaseMeta { patient_name: name.into(), timepoint: tp.into(), taken_on: None,
        date_of_birth: Some("1990-03-07".into()), scan_id: None };   // SYNTHETIC
    // Owner, 30 Sep: only the fields a person edits count as confirmed; a Timepoint edit confirms nothing.
    lib.set_meta(&c[1], &keep("T2", "Demo Synthetic")).unwrap();
    let d = lib.load(&c[1]).unwrap();
    assert_eq!((d.learned_fields.clone(), d.identity_source.as_str()), (vec!["name".to_string(), "dob".to_string()], "film"), "a Timepoint edit leaves them");
    lib.set_meta(&c[1], &keep("T2", "Demo Synthetic Two")).unwrap();
    assert_eq!(lib.load(&c[1]).unwrap().learned_fields, ["dob"], "editing the name confirms only the name");
    lib.apply_label_with(&c[1], &IdentityRead::default(), &learned).unwrap();
    let mut dob_only = keep("T2", "Demo Synthetic"); dob_only.date_of_birth = Some("1990-03-08".into());   // SYNTHETIC
    lib.set_meta(&c[1], &dob_only).unwrap();
    assert_eq!(lib.load(&c[1]).unwrap().learned_fields, ["name"], "editing the DOB confirms only the DOB");
}
/// Final review: a Timepoint-only edit must not dismiss "Check patient details" either.
#[test] fn a_timepoint_edit_leaves_check_patient_details_waiting() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 1);
    lib.apply_label(&c[0], &IdentityRead { name: Some("Demo Checked".into()), ..IdentityRead::default() }).unwrap();
    rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap().execute("UPDATE cases SET identity_checked = 0", []).unwrap();
    let d = lib.load(&c[0]).unwrap();
    lib.set_meta(&c[0], &CaseMeta { patient_name: d.patient_name.clone(), timepoint: "T7".into(), taken_on: d.taken_on.clone(), date_of_birth: d.date_of_birth.clone(), scan_id: d.scan_id.clone() }).unwrap();
    assert!(!lib.load(&c[0]).unwrap().identity_checked, "still waiting after a Timepoint edit");
    lib.set_meta(&c[0], &CaseMeta { patient_name: "Demo Checked Two".into(), timepoint: "T7".into(), taken_on: d.taken_on.clone(), date_of_birth: d.date_of_birth.clone(), scan_id: d.scan_id.clone() }).unwrap();
    assert!(lib.load(&c[0]).unwrap().identity_checked, "a typed name is a check");
}
#[test] fn a_new_machine_never_repeats_a_machine_number() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let sizes = [(400, 300), (300, 900), (500, 500)];
    let ids: Vec<String> = sizes.iter().enumerate().map(|(i, (w, h))| lib.import(&film(src.path(), &format!("m{i}.png"), i as u8, *w, *h)).unwrap().case_id).collect();
    let m1 = lib.match_machine(&ids[0], &demo_a(0.0)).unwrap();
    lib.match_machine(&ids[1], &demo_a(0.0)).unwrap();
    lib.delete_machine(&m1.machine_id).unwrap();
    lib.match_machine(&ids[2], &demo_a(0.0)).unwrap();
    let mut names: Vec<String> = lib.list_machines().unwrap().into_iter().map(|m| m.name).collect();
    names.sort();
    assert_eq!(names, ["Machine 1", "Machine 2"], "the freed number is reused, never a duplicate");
}

#[test] fn machines_can_be_listed_renamed_reset_and_deleted() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 3);
    for id in &c { lib.learn(id, "last", &last_rule(0.0)).unwrap(); }
    // Owner Q6 (addendum 2026-10-17): Gender is learned the same way as every other field, so Reset (below) must
    // forget it too, not only the identity/film-detail fields this test already covered.
    let gender_rule = ceph_label::layout::Rule { row_y: 0.2, right: false, start: ceph_label::layout::Start::Line, end: ceph_label::layout::End::Comma };
    for id in &c { lib.learn(id, "gender", &gender_rule).unwrap(); }
    let m = lib.list_machines().unwrap()[0].clone();
    assert_eq!((m.films, m.learned.clone()), (3, vec!["last".to_string(), "gender".to_string()]));
    lib.rename_machine(&m.id, "  Morita room 2 ").unwrap();
    assert_eq!(lib.list_machines().unwrap()[0].name, "Morita room 2");
    assert!(lib.rename_machine(&m.id, "  ").is_err());
    lib.reset_machine(&m.id).unwrap();
    assert!(lib.places(&c[0]).unwrap().is_empty() && lib.list_machines().unwrap()[0].films == 3, "Reset forgets EVERY place, Gender included");
    lib.delete_machine(&m.id).unwrap();
    assert!(lib.list_machines().unwrap().is_empty());
    assert!(lib.load(&c[0]).is_ok(), "cases stay; they just have no machine");
}

#[test] fn a_renamed_machine_keeps_its_name_as_it_learns() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 2);
    let id = lib.list_machines().unwrap()[0].id.clone();
    lib.rename_machine(&id, "Room 2").unwrap();
    name(&mut lib, &c[1], "Demo Beta"); lib.record_confirmed_film(&c[1], &demo_a(0.0)).unwrap();   // promotes anchors
    assert_eq!(lib.list_machines().unwrap()[0].name, "Room 2");
}

#[test] fn a_case_knows_its_machine() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = lib.import(&film(src.path(), "a.png", 0, 400, 300)).unwrap().case_id;
    assert_eq!(lib.machine_of(&c).unwrap(), None);
    let m = lib.match_machine(&c, &demo_a(0.0)).unwrap();
    assert_eq!(lib.machine_of(&c).unwrap(), Some(m.machine_id));
}

/// Final review C3: a film matched to its machine but printed a little lower reads the learned place lower too.
#[test] fn a_shifted_film_reads_its_learned_place_shifted_too() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 2);
    lib.learn(&c[0], "last", &last_rule(0.0)).unwrap();
    let low = lib.import(&film(src.path(), "low.png", 20, 400, 300)).unwrap().case_id;
    lib.match_machine(&low, &shifted(0.025)).unwrap();
    assert!((lib.places(&low).unwrap()[0].rule.row_y - 0.085).abs() < 1e-9);
    lib.learn(&low, "last", &last_rule(0.025)).unwrap();
    assert_eq!(lib.places(&c[0]).unwrap()[0].count, 2, "the shifted film's confirmation is the same place");
}

/// Final review I1: a machine that has no pattern yet (every film one patient) suggests but never fills.
#[test] fn a_machine_without_a_pattern_suggests_but_never_fills() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c: Vec<String> = (0..3u8).map(|i| {
        let c = lib.import(&film(src.path(), &format!("{i}.png"), i, 400, 300)).unwrap().case_id;
        lib.match_machine(&c, &demo_a(0.0)).unwrap();
        name(&mut lib, &c, "Demo Alpha"); lib.record_confirmed_film(&c, &demo_a(0.0)).unwrap();
        lib.learn(&c, "last", &last_rule(0.0)).unwrap();
        c
    }).collect();
    let p = lib.places(&c[2]).unwrap();
    assert_eq!((p[0].count, p[0].default), (3, false));
    assert!(lib.list_machines().unwrap()[0].learned.is_empty());
}

/// Final review I1 + I2: unconfirmed films of one machine are one machine; another practice's films with the same
/// size and the same DOB/PID labels are not.
#[test] fn unconfirmed_films_of_one_machine_are_one_machine_and_another_practice_is_not() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let names = [("smith", "john"), ("jones", "anna"), ("brown", "lee"), ("green", "max"), ("white", "zoe")];   // SYNTHETIC
    let ids: Vec<String> = names.iter().enumerate().map(|(i, (a, b))| {
        let c = lib.import(&film(src.path(), &format!("{i}.png"), i as u8, 400, 300)).unwrap().case_id;
        let mut toks = demo_a(0.0); toks.extend([tok(a, 0.05, 0.06), tok(b, 0.12, 0.06)]);
        lib.match_machine(&c, &toks).unwrap();
        c
    }).collect();
    assert_eq!(lib.list_machines().unwrap().len(), 1, "5 unconfirmed films, 1 machine");
    let b = lib.import(&film(src.path(), "b.png", 30, 400, 300)).unwrap().case_id;
    let other = vec![tok("other", 0.05, 0.03), tok("imaging", 0.15, 0.03), tok("dental", 0.27, 0.03), tok("dob", 0.04, 0.12), tok("pid", 0.04, 0.15),
        tok("lee", 0.05, 0.06), tok("chan", 0.12, 0.06)];   // SYNTHETIC
    assert!(lib.match_machine(&b, &other).unwrap().created);
    assert!(lib.machine_of(&ids[4]).unwrap().is_some());
}

/// Final review I3: one case counts once per field; changing its answer moves its vote.
#[test] fn one_case_counts_once_per_field_and_a_change_moves_its_vote() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 2);
    lib.learn(&c[0], "last", &last_rule(0.0)).unwrap();
    lib.learn(&c[0], "last", &last_rule(0.0)).unwrap();
    assert_eq!(lib.places(&c[0]).unwrap()[0].count, 1);
    lib.learn(&c[0], "last", &Rule { row_y: 0.30, ..last_rule(0.0) }).unwrap();
    let p = lib.places(&c[0]).unwrap();
    assert_eq!((p.len(), (p[0].rule.row_y - 0.30).abs() < 1e-9, p[0].count), (1, true, 1));
}

/// Final review I4: siblings share a surname; with an apostrophe or hyphen it still never becomes a pattern word.
#[test] fn a_shared_surname_with_punctuation_never_becomes_an_anchor() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    for (i, n) in ["O'Brien, Liam", "O'Brien, Ava", "Smith-Jones, Kim", "Smith-Jones, Lou"].iter().enumerate() {   // SYNTHETIC
        let c = lib.import(&film(src.path(), &format!("{i}.png"), i as u8, 400, 300)).unwrap().case_id;
        let surname = n.split(',').next().unwrap().to_uppercase();
        let mut toks = demo_a(0.0); toks.push(FilmToken { token: surname.to_lowercase(), text: surname.clone(), cx: 0.05, cy: 0.06 });
        toks.push(tok("february", 0.10, 0.12));
        lib.match_machine(&c, &toks).unwrap();
        name(&mut lib, &c, n); lib.record_confirmed_film(&c, &toks).unwrap();
    }
    let c = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
    let words: Vec<String> = c.prepare("SELECT token FROM layout_anchors").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    assert!(!words.iter().any(|w| w.contains("brien") || w.contains("smith") || w == "february"), "{words:?}");
}

/// Final review C1 (defence): a rule anchored on the patient's own name is never stored.
#[test] fn a_rule_anchored_on_the_patients_own_name_is_refused() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 3);
    name(&mut lib, &c[2], "Smith, John");   // SYNTHETIC
    lib.learn(&c[2], "first", &Rule { row_y: 0.06, right: false, start: Start::After("smith".into()), end: End::Line }).unwrap();
    assert!(lib.places(&c[2]).unwrap().is_empty());
}


/// D-LEARN-1: a practice place becomes the machine's default after 3 films, like a name's.
#[test] fn a_practice_place_becomes_the_default_after_3() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 4);
    let r = Rule { row_y: 0.03, right: false, start: Start::Line, end: End::Line };
    for id in &c[..3] { lib.learn(id, "practice", &r).unwrap(); }
    let p = lib.places(&c[3]).unwrap();
    assert!(p.iter().any(|p| p.field == "practice" && p.default && p.count == 3), "{p:?}");
    assert!(lib.list_machines().unwrap()[0].learned.contains(&"practice".to_string()));
}
/// Spec 2026-10-17: a rule marked by a word of the patient's own Patient ID ("after:zq") is never stored.
#[test] fn a_rule_anchored_on_the_patients_own_patient_id_is_refused() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let c = setup(&mut lib, src.path(), 3);
    lib.set_patient_id(&c[2], Some("ZQ 7781")).unwrap();
    lib.learn(&c[2], "xray_size", &Rule { row_y: 0.5, right: false, start: Start::After("zq".into()), end: End::Line }).unwrap();
    assert!(lib.places(&c[2]).unwrap().iter().all(|p| p.field != "xray_size"), "{:?}", lib.places(&c[2]).unwrap());
}
