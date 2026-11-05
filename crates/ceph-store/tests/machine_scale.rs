//! A calibrated scale per X-ray machine (spec 2026-10-20; owner MS1–MS4, 20 Oct). Synthetic films only.
use ceph_store::{CaseMeta, FitSave, Library, MachineScaleRow, ScaleChange};
use std::path::{Path, PathBuf};

const OP: &str = "Dr Demo";
fn png(dir: &Path, name: &str, w: u32, h: u32, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(w, h, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn meta(name: &str, tp: &str, taken: Option<&str>) -> CaseMeta {
    CaseMeta { patient_name: name.into(), timepoint: tp.into(), taken_on: taken.map(Into::into), date_of_birth: None, scan_id: None }
}
/// Films of sizes `sizes`, one patient "Demo Machine" (T1…), all recognised as machine 'm1' "Demo Radiology" (400 × 300).
fn library(sizes: &[(u32, u32)]) -> (tempfile::TempDir, tempfile::TempDir, Library, Vec<String>) {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let ids: Vec<String> = sizes.iter().enumerate()
        .map(|(i, (w, h))| lib.import(&png(src.path(), &format!("synthetic-{i}.png"), *w, *h, (i as u8).wrapping_mul(11))).unwrap().case_id).collect();
    for (i, id) in ids.iter().enumerate() { lib.set_meta(id, &meta("Demo Machine", &format!("T{}", i + 1), Some("2025-03-12"))).unwrap(); }   // SYNTHETIC
    lib.conn_for_tests().execute("INSERT INTO layout_machines (id, name, named_by_user, width, height, created_at, updated_at) VALUES ('m1', 'Demo Radiology', 1, 400, 300, 'x', 'x')", []).unwrap();
    for id in &ids { lib.conn_for_tests().execute("UPDATE cases SET layout_machine_id = 'm1' WHERE id = ?1", [id]).unwrap(); }
    (t, src, lib, ids)
}
fn put_scale(lib: &Library, spacing: f64, w: i64, h: i64, source: &str) {
    lib.conn_for_tests().execute("UPDATE layout_machines SET spacing_mm = ?1, width_px = ?2, height_px = ?3, scale_source = ?4, scale_set_at = '2026-10-24T00:00:00.000Z' WHERE id = 'm1'",
        rusqlite::params![spacing, w, h, source]).unwrap();
}

/// MS2: the machine's scale applies to a film of exactly its pixel size, and to no other size — not one pixel off,
/// not width and height swapped (MQ1). Positive control: make APPLIES compare with a 2 % tolerance (as machine
/// recognition's `same_size` does) -> the 401 × 300 film applies and this fails.
#[test] fn the_scale_applies_only_at_exactly_its_pixel_size() {
    let (_t, _s, lib, ids) = library(&[(400, 300), (401, 300), (400, 299), (300, 400)]);
    put_scale(&lib, 0.0998, 400, 300, "entered");
    let applies: Vec<bool> = ids.iter().map(|id| lib.load(id).unwrap().machine_scale.expect("the machine has a scale").applies).collect();
    assert_eq!(applies, [true, false, false, false]);
    let m = lib.load(&ids[0]).unwrap().machine_scale.unwrap();
    assert_eq!((m.machine_name.as_str(), m.spacing_mm, m.width_px, m.height_px, m.source.as_str(), m.source_case_id, m.source_film_date),
               ("Demo Radiology", 0.0998, 400, 300, "entered", None, None));
    assert_eq!(lib.load(&ids[0]).unwrap().machine.map(|r| r.name).as_deref(), Some("Demo Radiology"));
}
/// No scale on the machine, or no machine: nothing — the film reads exactly as before.
#[test] fn no_scale_or_no_machine_reads_as_before() {
    let (_t, _s, lib, ids) = library(&[(400, 300), (400, 300)]);
    lib.conn_for_tests().execute("UPDATE cases SET layout_machine_id = NULL WHERE id = ?1", [&ids[1]]).unwrap();
    assert!(lib.load(&ids[0]).unwrap().machine_scale.is_none());
    put_scale(&lib, 0.0998, 400, 300, "entered");
    let d = lib.load(&ids[1]).unwrap();
    assert!(d.machine.is_none() && d.machine_scale.is_none(), "a film with no machine has no machine scale");
}
/// MS1/MQ3: "from film of <date>" is the source film's film date, read live; gone or undated -> None.
#[test] fn the_source_films_date_is_read_live_and_blank_when_it_is_gone() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300)]);
    put_scale(&lib, 0.0998, 400, 300, &format!("film:{}", ids[0]));
    let m = lib.load(&ids[1]).unwrap().machine_scale.unwrap();
    assert_eq!((m.source.as_str(), m.source_case_id.as_deref(), m.source_film_date.as_deref()), ("film", Some(ids[0].as_str()), Some("2025-03-12")));
    lib.conn_for_tests().execute("UPDATE cases SET taken_on = NULL WHERE id = ?1", [&ids[0]]).unwrap();
    assert_eq!(lib.load(&ids[1]).unwrap().machine_scale.unwrap().source_film_date, None, "no film date");
    lib.conn_for_tests().execute("UPDATE layout_machines SET scale_source = 'film:gone-for-good'", []).unwrap();
    let m = lib.load(&ids[1]).unwrap().machine_scale.unwrap();
    assert_eq!((m.source.as_str(), m.source_film_date), ("film", None), "a source film no longer in the library");
}
/// G and MS together: a fit's reference with no ruler but a machine scale lends the machine scale (it is not assumed,
/// G3); a reference with its own ruler lends its ruler, never the machine's.
#[test] fn a_fits_reference_lends_its_machine_scale_when_it_has_no_ruler() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300)]);
    put_scale(&lib, 0.0998, 400, 300, "entered");
    lib.save_fit(&ids[1], &FitSave { ref_case_id: ids[0].clone(), ref_kind: "sn".into(), ref_points: [[100.0, 100.0], [300.0, 80.0]],
        film_points: [[110.0, 105.0], [302.0, 90.0]], mirror: false, scale: 1.04, rotation: 0.05, dx: 1.5, dy: -2.0 }, OP).unwrap();
    let f = lib.load(&ids[1]).unwrap().fit.unwrap();
    assert_eq!((f.ref_spacing_mm, f.ref_machine_spacing_mm), (None, Some(0.0998)));
    lib.calibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();
    let f = lib.load(&ids[1]).unwrap().fit.unwrap();
    assert_eq!((f.ref_spacing_mm, f.ref_machine_spacing_mm), (Some(0.1), None), "a ruler always wins");
}
/// Library › Film layouts: each machine's scale and how many live films without a ruler use it now.
#[test] fn film_layouts_lists_the_scale_and_the_films_using_it() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300), (400, 300), (401, 300)]);
    put_scale(&lib, 0.0998, 400, 300, "entered");
    lib.calibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();   // has its own ruler: not counted
    lib.delete(&ids[1]).unwrap();                                           // Recently deleted: not counted
    let m = lib.list_machines().unwrap().into_iter().find(|m| m.id == "m1").unwrap();
    assert_eq!((m.scale.map(|s| s.spacing_mm), m.scale_films), (Some(0.0998), 1), "only T3 (T4 is another size)");
}

fn row(spacing: f64, w: i64, h: i64, source: &str) -> MachineScaleRow {
    MachineScaleRow { spacing_mm: spacing, width_px: w, height_px: h, source: source.into(), set_at: None }
}
fn verified(lib: &Library, id: &str) -> bool { lib.load(id).unwrap().verified_at.is_some() }

/// MS4 / D-c: setting a scale clears Tracing verified on exactly the films whose mm change — the count the warning
/// gives is the set it clears. Films with a ruler, of another size, or of another machine keep theirs, and NOTHING
/// else on any film changes. Positive control: clear every film of the machine instead -> the ruler film's flag
/// goes and this fails.
#[test] fn setting_a_scale_clears_verified_on_exactly_the_films_it_changes_and_the_warning_counts_them() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300), (400, 300), (401, 300)]);
    lib.calibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();                      // T1: its own ruler
    for id in &ids { lib.set_verified(id, true, OP).unwrap(); }
    let before: Vec<_> = ids.iter().map(|id| lib.load(id).unwrap()).collect();
    let new = row(0.0998, 400, 300, "entered");
    let preview = lib.machine_scale_change("m1", Some(&new)).unwrap();
    assert_eq!((preview.films.clone(), preview.fitted.clone(), preview.deleted), (vec![ids[1].clone(), ids[2].clone()], vec![], 0));
    let done = lib.set_machine_scale("m1", Some(&new)).unwrap();
    assert_eq!(done, preview, "the warning's count is what is cleared");
    assert_eq!(ids.iter().map(|id| verified(&lib, id)).collect::<Vec<_>>(), [true, false, false, true]);
    for (b, id) in before.iter().zip(&ids) {
        let a = lib.load(id).unwrap();
        assert_eq!((&a.landmarks, a.spacing_mm, a.scale_steps, &a.patient_name, &a.taken_on), (&b.landmarks, b.spacing_mm, b.scale_steps, &b.patient_name, &b.taken_on),
            "nothing on a film is written");
    }
    assert_eq!(lib.machine_scale_change("m1", Some(&new)).unwrap(), ScaleChange { films: vec![], fitted: vec![], deleted: 0 }, "the same value again changes nothing");
}
/// D-c family: a film fitted to a changed film, with "Use the scale from the fit" on, takes its mm from it, so it
/// is counted and cleared too; with the switch off it is not. A film in Recently deleted is cleared and counted apart.
#[test] fn fitted_films_and_recently_deleted_films_are_counted_and_cleared() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (500, 300), (500, 300), (400, 300)]);
    let fit = |r: &str| FitSave { ref_case_id: r.into(), ref_kind: "sn".into(), ref_points: [[100.0, 100.0], [300.0, 80.0]],
        film_points: [[110.0, 105.0], [302.0, 90.0]], mirror: false, scale: 1.04, rotation: 0.05, dx: 1.5, dy: -2.0 };
    lib.save_fit(&ids[1], &fit(&ids[0]), OP).unwrap(); lib.set_fit_own(&ids[1], true).unwrap();   // T2 (500 wide) uses its fit to T1
    lib.save_fit(&ids[2], &fit(&ids[0]), OP).unwrap();                                           // T3: switch off
    lib.delete(&ids[3]).unwrap();
    for id in &ids[..3] { lib.set_verified(id, true, OP).unwrap(); }
    let c = lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();
    assert_eq!((c.films, c.fitted, c.deleted), (vec![ids[0].clone()], vec![ids[1].clone()], 1));
    assert_eq!(ids[..3].iter().map(|id| verified(&lib, id)).collect::<Vec<_>>(), [false, false, true]);
}
/// MS4: removing a scale, and deleting a machine that has one, change the same films back: same count, same clearing.
#[test] fn removing_the_scale_or_deleting_the_machine_clears_the_same_films() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300)]);
    lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();
    for id in &ids { lib.set_verified(id, true, OP).unwrap(); }
    assert_eq!(lib.machine_delete_change("m1").unwrap(), lib.machine_scale_change("m1", None).unwrap());
    assert_eq!(lib.machine_delete_change("m1").unwrap().films.len(), 2);
    lib.delete_machine("m1").unwrap();
    assert!(ids.iter().all(|id| !verified(&lib, id)), "deleting the machine took the scale away");
    assert!(lib.load(&ids[0]).unwrap().machine_scale.is_none());
}
/// MS4 "undoable": the old row passed back restores the value, its source and its set time exactly, and nothing else
/// (Tracing verified is not restored — MQ10).
#[test] fn an_undo_restores_the_previous_value_and_nothing_else() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300)]);
    lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();
    let old = lib.load(&ids[0]).unwrap().machine_scale.unwrap();
    lib.set_verified(&ids[0], true, OP).unwrap();
    lib.set_machine_scale("m1", Some(&row(0.1010, 400, 300, "entered"))).unwrap();
    let back = MachineScaleRow { spacing_mm: old.spacing_mm, width_px: old.width_px, height_px: old.height_px, source: "entered".into(), set_at: Some(old.set_at.clone()) };
    lib.set_machine_scale("m1", Some(&back)).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().machine_scale.unwrap(), old);
    assert!(!verified(&lib, &ids[0]));
}
/// MS1 "Use for this machine": the film's own ruler (with its fine-tune) and its exact pixel size, sourced to it.
/// Refused for a film with no ruler, no machine, or in Recently deleted.
#[test] fn use_for_this_machine_takes_the_films_ruler_and_size() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300), (400, 300)]);
    lib.recalibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, 2, OP).unwrap();                  // +1.0 %
    let (m, r) = lib.machine_scale_from_film(&ids[0]).unwrap();
    assert_eq!((m.as_str(), r.spacing_mm, r.width_px, r.height_px, r.source.clone()), ("m1", lib.load(&ids[0]).unwrap().spacing_mm.unwrap(), 400, 300, format!("film:{}", ids[0])));
    assert_eq!(lib.machine_scale_from_film(&ids[1]).unwrap_err().to_string(), "this film has no ruler calibration to use for its machine");
    lib.conn_for_tests().execute("UPDATE cases SET layout_machine_id = NULL WHERE id = ?1", [&ids[2]]).unwrap();
    lib.calibrate(&ids[2], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();
    assert_eq!(lib.machine_scale_from_film(&ids[2]).unwrap_err().to_string(), "this film was not recognised as an X-ray machine");
    lib.delete(&ids[0]).unwrap();
    assert!(lib.machine_scale_from_film(&ids[0]).is_err(), "a film in Recently deleted");
}
/// What a scale can never be is refused in plain words, and nothing is written.
#[test] fn an_impossible_scale_is_refused_and_nothing_changes() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300)]);
    for (why, r) in [("zero", row(0.0, 400, 300, "entered")), ("negative", row(-0.1, 400, 300, "entered")), ("NaN", row(f64::NAN, 400, 300, "entered")),
                     ("infinite", row(f64::INFINITY, 400, 300, "entered")), ("no width", row(0.1, 0, 300, "entered")), ("source", row(0.1, 400, 300, "ruler"))] {
        assert!(lib.set_machine_scale("m1", Some(&r)).is_err(), "{why}");
    }
    assert!(lib.load(&ids[0]).unwrap().machine_scale.is_none());
    assert!(lib.set_machine_scale("no-such-machine", Some(&row(0.1, 400, 300, "entered"))).is_err());
}
/// MQ12: a label read again that moves a verified film off its machine's scale changes its mm, so its Tracing
/// verified goes. The "only if its mm change" half, which this test alone could not fail on (final review I2), is
/// `a_re_match_that_leaves_the_mm_where_they_were_keeps_the_sign_off`; the fitted films, `a_re_matched_film_takes_…`.
#[test] fn a_film_moved_off_its_machines_scale_loses_verified() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300)]);
    lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();
    lib.set_verified(&ids[0], true, OP).unwrap();
    lib.conn_for_tests().execute("DELETE FROM layout_machines WHERE id != 'm1'", []).unwrap();
    let tokens = ceph_label::layout::film_tokens(&[]);                                          // no text: a new machine
    lib.match_machine(&ids[0], &tokens).unwrap();
    assert!(!verified(&lib, &ids[0]), "the film left m1's scale");
}
/// MS-7 concern 1: the warning's count and Tracing-verified clearing use `change()`'s own exact-size equality (`at`);
/// every reader (the screen, the report, the CSV) uses the SQL `APPLIES` rule instead. This pins the two together over
/// a grid of film sizes (exact match, ±1 px on each side, swapped width/height, 2 % off, and a film with no machine at
/// all) — a change in which films `change()` lists must be exactly the films whose read-back scale (`machine_scale`,
/// built from `APPLIES`) actually moves. Positive control: loosen `APPLIES` alone to a 2 % tolerance (by hand, as the
/// comment on `the_scale_applies_only_at_exactly_its_pixel_size` above already does for one film) and watch this fail.
#[test] fn change_lists_exactly_the_films_whose_applies_rule_moves() {
    let sizes = [
        (400, 300),   // exact match (of the first scale)
        (401, 300),   // +1 px width
        (400, 301),   // +1 px height
        (399, 300),   // -1 px width
        (300, 400),   // swapped width/height
        (408, 300),   // 2 % off width (400 * 1.02)
        (400, 300),   // a second film at the exact size, to show more than one film moves together
    ];
    let (_t, _s, mut lib, mut ids) = library(&sizes);
    // one more film, recognised as no machine at all ("missing" from the grid: APPLIES can never see it).
    let (t2, s2) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let _ = &t2; let _ = &s2;
    let no_machine_png = png(s2.path(), "synthetic-none.png", 400, 300, 200);
    let no_machine_id = lib.import(&no_machine_png).unwrap().case_id;
    lib.set_meta(&no_machine_id, &meta("Demo Machine", "T-none", Some("2025-03-12"))).unwrap();
    ids.push(no_machine_id.clone());

    let applies_of = |lib: &Library, ids: &[String]| -> Vec<bool> {
        ids.iter().map(|id| lib.load(id).unwrap().machine_scale.map(|m| m.applies).unwrap_or(false)).collect()
    };

    // Start: no scale on the machine at all -> nothing applies anywhere.
    assert!(lib.load(&no_machine_id).unwrap().machine_scale.is_none(), "a film with no machine has no machine scale");
    assert_eq!(applies_of(&lib, &ids), vec![false; ids.len()]);

    // First change: set the machine's scale to 400 × 300. Only the two 400×300 films can move.
    let scale_a = row(0.1000, 400, 300, "entered");
    let preview_a = lib.machine_scale_change("m1", Some(&scale_a)).unwrap();
    lib.set_machine_scale("m1", Some(&scale_a)).unwrap();
    let after_a = applies_of(&lib, &ids);
    let readback_changed_a: Vec<String> = ids.iter().zip(&after_a).filter(|(_, a)| **a).map(|(id, _)| id.clone()).collect();
    assert_eq!(preview_a.films.iter().cloned().collect::<std::collections::HashSet<_>>(),
               readback_changed_a.iter().cloned().collect::<std::collections::HashSet<_>>(),
               "change() must list exactly the films whose read-back `applies` flipped");
    assert_eq!(readback_changed_a.len(), 2, "both 400×300 films, and no other size");

    // Second change: move the machine's scale to 401 × 300. The 400×300 films stop applying; the 401×300 film starts.
    let scale_b = row(0.1010, 401, 300, "entered");
    let preview_b = lib.machine_scale_change("m1", Some(&scale_b)).unwrap();
    lib.set_machine_scale("m1", Some(&scale_b)).unwrap();
    let after_b = applies_of(&lib, &ids);
    let readback_changed_b: Vec<String> = ids.iter().zip(&after_a).zip(&after_b)
        .filter(|((_, a), b)| a != b).map(|((id, _), _)| id.clone()).collect();
    assert_eq!(preview_b.films.iter().cloned().collect::<std::collections::HashSet<_>>(),
               readback_changed_b.iter().cloned().collect::<std::collections::HashSet<_>>(),
               "change() must list exactly the films whose read-back `applies` flipped, the second time too");
    // exactly the two 400×300 films (now stop applying) and the 401×300 film (now starts) — never the swapped,
    // ±1-px-on-the-other-side, 2 %-off, or no-machine films.
    assert_eq!(readback_changed_b.len(), 3);
    assert!(!after_b[2] && !after_b[3] && !after_b[4] && !after_b[5] && !after_b[6], "unrelated sizes never apply");
    assert!(lib.load(&no_machine_id).unwrap().machine_scale.is_none(), "still no machine, still no scale, whatever the machine's films do");
}

/// G2 and MS: a film with a machine scale is not offered "Use the scale from the fit" (machine above fit).
#[test] fn set_fit_own_is_refused_for_a_machine_scaled_film() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300)]);
    lib.save_fit(&ids[1], &FitSave { ref_case_id: ids[0].clone(), ref_kind: "sn".into(), ref_points: [[100.0, 100.0], [300.0, 80.0]],
        film_points: [[110.0, 105.0], [302.0, 90.0]], mirror: false, scale: 1.04, rotation: 0.05, dx: 1.5, dy: -2.0 }, OP).unwrap();
    lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();
    assert_eq!(lib.set_fit_own(&ids[1], true).unwrap_err().to_string(), "this film has its machine's calibrated scale, so it keeps it");
}

fn fit_to(r: &str) -> FitSave {
    FitSave { ref_case_id: r.into(), ref_kind: "sn".into(), ref_points: [[100.0, 100.0], [300.0, 80.0]],
        film_points: [[110.0, 105.0], [302.0, 90.0]], mirror: false, scale: 1.04, rotation: 0.05, dx: 1.5, dy: -2.0 }
}
fn tok(t: &str, x: f64, y: f64) -> ceph_label::layout::FilmToken { ceph_label::layout::FilmToken { token: t.into(), text: t.into(), cx: x, cy: y } }
/// "Demo Radiology Northside" printed top left, with DOB and PID labels: enough for a machine with no pattern yet to
/// be matched again by its candidates (`match_machine`, 2 of the film's tokens and half of them, in place).
fn demo_tokens() -> Vec<ceph_label::layout::FilmToken> {
    vec![tok("demo", 0.05, 0.03), tok("radiology", 0.15, 0.03), tok("northside", 0.27, 0.03), tok("dob", 0.04, 0.12), tok("pid", 0.04, 0.15)]
}
fn verified_any(lib: &Library, id: &str) -> bool {
    lib.conn_for_tests().query_row("SELECT verified_at IS NOT NULL FROM cases WHERE id = ?1", [id], |r| r.get(0)).unwrap()
}

/// Final review I1 (D-c, MQ12): a re-matched film whose mm change takes with it every film fitted to it with "Use the
/// scale from the fit" on and no scale of its own — live or in Recently deleted — exactly as a scale change does
/// (`change()`, one shared rule). A film fitted with the switch off keeps its sign-off. Positive control: delete the
/// fitted-films call from `match_machine` -> T2 keeps "Tracing verified" and this fails.
#[test] fn a_re_matched_film_takes_the_films_fitted_to_it_with_it() {
    // T1 400 × 300 uses m1's scale; T2, T3, T4 are 500 × 300 (m1's scale never applies to them).
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (500, 300), (500, 300), (500, 300)]);
    lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap(); lib.set_fit_own(&ids[1], true).unwrap();   // T2: switch on
    lib.save_fit(&ids[2], &fit_to(&ids[0]), OP).unwrap();                                           // T3: switch off
    lib.save_fit(&ids[3], &fit_to(&ids[0]), OP).unwrap(); lib.set_fit_own(&ids[3], true).unwrap();   // T4: on, then deleted
    for id in &ids { lib.set_verified(id, true, OP).unwrap(); }
    lib.delete(&ids[3]).unwrap();
    assert!(verified_any(&lib, &ids[3]), "a film in Recently deleted keeps its sign-off until its mm change");
    lib.conn_for_tests().execute("DELETE FROM layout_machines WHERE id != 'm1'", []).unwrap();
    lib.match_machine(&ids[0], &ceph_label::layout::film_tokens(&[])).unwrap();                     // no text: a new machine, no scale
    assert_eq!(lib.load(&ids[0]).unwrap().machine_scale, None, "T1 left m1's scale: 0.0998 -> assumed");
    assert_eq!(ids.iter().map(|id| verified_any(&lib, id)).collect::<Vec<_>>(), [false, false, true, false],
        "T1 and the films that take their mm from it lose the sign-off; T3 (switch off) keeps it");
}
/// Final review I1, the other way: a film that GAINS a machine scale by being matched moves its fitted films' mm too.
#[test] fn a_film_matched_to_a_scaled_machine_takes_its_fitted_films_with_it() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300), (500, 300)]);
    for id in &ids[..2] { lib.conn_for_tests().execute("UPDATE cases SET layout_machine_id = NULL WHERE id = ?1", [id]).unwrap(); }
    let x = lib.match_machine(&ids[0], &demo_tokens()).unwrap();                                    // T1 teaches a new machine X
    assert!(x.created);
    lib.set_machine_scale(&x.machine_id, Some(&row(0.0998, 400, 300, "entered"))).unwrap();
    lib.save_fit(&ids[2], &fit_to(&ids[1]), OP).unwrap(); lib.set_fit_own(&ids[2], true).unwrap();   // T3 (500 × 300, m1) on T2
    for id in &ids[1..] { lib.set_verified(id, true, OP).unwrap(); }
    let m = lib.match_machine(&ids[1], &demo_tokens()).unwrap();                                    // T2 is recognised as X
    assert_eq!((m.machine_id.as_str(), m.created), (x.machine_id.as_str(), false), "the test needs T2 matched to X");
    assert!(lib.load(&ids[1]).unwrap().machine_scale.unwrap().applies, "T2 now uses X's scale");
    assert_eq!((verified(&lib, &ids[1]), verified(&lib, &ids[2])), (false, false));
}
/// Final review I2 (MQ12, the "only if" half): a re-match that leaves a film's mm where they were — a film moved
/// between machines with no scale, or a film with its own ruler — keeps its sign-off, and so do the films fitted to
/// it. Positive control (the reviewer's mutation): make `match_machine` un-verify on every re-match (`if true`) ->
/// this fails.
#[test] fn a_re_match_that_leaves_the_mm_where_they_were_keeps_the_sign_off() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (500, 300), (400, 300)]);
    lib.calibrate(&ids[2], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();                            // T3: its own ruler
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap(); lib.set_fit_own(&ids[1], true).unwrap();   // T2 takes its mm from T1
    for id in &ids { lib.set_verified(id, true, OP).unwrap(); }
    lib.conn_for_tests().execute("DELETE FROM layout_machines WHERE id != 'm1'", []).unwrap();
    lib.match_machine(&ids[0], &ceph_label::layout::film_tokens(&[])).unwrap();                     // m1 (no scale) -> a new machine (no scale)
    lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();                  // T3 has a ruler: m1's scale never reaches it
    lib.set_verified(&ids[2], true, OP).unwrap();
    lib.match_machine(&ids[2], &ceph_label::layout::film_tokens(&[])).unwrap();                     // T3: m1 (scaled) -> new machine; its ruler holds
    assert_ne!(lib.load(&ids[0]).unwrap().machine.unwrap().id, "m1", "the test needs T1 moved");
    assert_ne!(lib.load(&ids[2]).unwrap().machine.unwrap().id, "m1", "the test needs T3 moved");
    assert_eq!(ids.iter().map(|id| verified(&lib, id)).collect::<Vec<_>>(), [true, true, true], "no mm changed, so no sign-off goes");
}
/// Re-review N1 (the "machine above fit" exclusion in `match_machine`, `layouts.rs:121`): a re-match that moves the
/// reference's mm does NOT clear the sign-off of a film fitted to it with "Use the scale from the fit" on, when that
/// fitted film has since gained its OWN machine's calibrated scale (a machine scale sits above the fit; that film's
/// mm never moved). Positive control: in `layouts.rs::match_machine`, replace the exclusion
/// `f == case_id || base_spacing(&tx, f)?.is_some()` with `f == case_id` alone (the reviewer's "no others" probe) ->
/// F wrongly loses its sign-off and this fails.
#[test] fn a_re_match_leaves_alone_a_fitted_film_whose_own_machine_now_has_a_scale() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (500, 300)]);
    lib.conn_for_tests().execute("INSERT INTO layout_machines (id, name, width, height, created_at, updated_at) VALUES ('m2', 'Demo Radiology 2', 500, 300, 'x', 'x')", []).unwrap();
    lib.conn_for_tests().execute("UPDATE cases SET layout_machine_id = 'm2' WHERE id = ?1", [&ids[1]]).unwrap();   // F: m2, not m1
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap(); lib.set_fit_own(&ids[1], true).unwrap();   // F takes its mm from T1 (m2 has no scale yet)
    lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();                   // T1 uses m1's scale
    lib.set_machine_scale("m2", Some(&row(0.0500, 500, 300, "entered"))).unwrap();                   // F now has its OWN machine's scale
    for id in &ids { lib.set_verified(id, true, OP).unwrap(); }
    lib.conn_for_tests().execute("DELETE FROM layout_machines WHERE id NOT IN ('m1', 'm2')", []).unwrap();
    lib.match_machine(&ids[0], &ceph_label::layout::film_tokens(&[])).unwrap();                      // T1: m1 (scaled) -> a new machine (no scale)
    assert_ne!(lib.load(&ids[0]).unwrap().machine.unwrap().id, "m1", "the test needs T1 moved");
    assert_eq!((verified(&lib, &ids[0]), verified(&lib, &ids[1])), (false, true),
        "T1's own mm moved and it loses its sign-off; F's mm never moved (its own machine, m2, holds the scale) and it keeps its sign-off");
}
/// Final review M2: clearing the sign-off writes nothing on a film that was never signed off — not even its
/// last-edited date ("recently edited" order). A signed-off film's date moves, as its sign-off does. Positive control:
/// drop `AND verified_at IS NOT NULL` from `unverify_all` -> T2's date moves and this fails.
#[test] fn clearing_the_sign_off_leaves_a_never_signed_films_edited_date_alone() {
    let (_t, _s, mut lib, ids) = library(&[(400, 300), (400, 300), (500, 300)]);
    lib.save_fit(&ids[2], &fit_to(&ids[1]), OP).unwrap(); lib.set_fit_own(&ids[2], true).unwrap();   // T3 takes its mm from T2
    lib.set_verified(&ids[0], true, OP).unwrap();
    lib.conn_for_tests().execute("UPDATE cases SET updated_at = '2000-01-01T00:00:00.000Z'", []).unwrap();
    let c = lib.set_machine_scale("m1", Some(&row(0.0998, 400, 300, "entered"))).unwrap();
    assert_eq!((c.films.len(), c.fitted.len()), (2, 1), "the test needs all three films changed");
    let at = |id: &str| -> String { lib.conn_for_tests().query_row("SELECT updated_at FROM cases WHERE id = ?1", [id], |r| r.get(0)).unwrap() };
    assert_ne!(at(&ids[0]), "2000-01-01T00:00:00.000Z", "T1 was signed off: its sign-off went, so its date moves");
    assert_eq!((at(&ids[1]), at(&ids[2])), ("2000-01-01T00:00:00.000Z".to_string(), "2000-01-01T00:00:00.000Z".to_string()),
        "never signed off: nothing written");
}
