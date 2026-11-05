//! Request G (spec 2026-10-17; owner G1–G3, 17 Oct): a film's fit to another film of the same patient, stored with the
//! film (format 12). Synthetic films and names only.
use ceph_store::{CaseDoc, CaseMeta, FitSave, IdentityRead, Library, PatientRef};
use std::path::{Path, PathBuf};

const OP: &str = "Dr Demo";
fn png(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn meta(name: &str, tp: &str, born: Option<&str>) -> CaseMeta {
    CaseMeta { patient_name: name.into(), timepoint: tp.into(), taken_on: None, date_of_birth: born.map(str::to_string), scan_id: None }
}
/// `n` films of one patient, "Demo Fit", born 2010-01-02 (SYNTHETIC), T1 … Tn.
fn films(n: u8) -> (tempfile::TempDir, tempfile::TempDir, Library, Vec<String>) {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let ids: Vec<String> = (0..n).map(|i| lib.import(&png(src.path(), &format!("synthetic-{i}.png"), i.wrapping_mul(7))).unwrap().case_id).collect();
    for (i, id) in ids.iter().enumerate() { lib.set_meta(id, &meta("Demo Fit", &format!("T{}", i + 1), Some("2010-01-02"))).unwrap(); }   // SYNTHETIC
    (t, src, lib, ids)
}
fn fit_to(r: &str) -> FitSave {
    FitSave { ref_case_id: r.into(), ref_kind: "sn".into(), ref_points: [[100.0, 100.0], [300.0, 80.0]], film_points: [[110.0, 105.0], [302.0, 90.0]],
        mirror: false, scale: 1.04, rotation: 0.05, dx: 1.5, dy: -2.0 }
}
fn rows(lib: &Library) -> Vec<(String, String)> {
    lib.conn_for_tests().prepare("SELECT case_id, ref_case_id FROM film_fits ORDER BY case_id").unwrap()
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap()
}

/// Spec G step 4: the fit is stored with the film and read back with its reference's timepoint and ruler; nothing
/// else on the film changes — not its ruler (owner G2), points, verified sign-off or dates.
#[test] fn a_saved_fit_reads_back_and_changes_nothing_else_on_the_film() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.calibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();             // T1: 0.1 mm per px
    let before = lib.load(&ids[1]).unwrap();
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap();
    let after = lib.load(&ids[1]).unwrap();
    let f = after.fit.clone().expect("the fit is stored with the film");
    assert_eq!(f.fit, fit_to(&ids[0]));
    assert_eq!((f.use_own, f.ref_timepoint.as_str(), f.ref_spacing_mm, f.saved_by.as_str()), (false, "T1", Some(0.1), OP));
    assert_eq!(CaseDoc { fit: None, ..after.clone() }, before, "nothing else on the film changed");
    assert_eq!(after.spacing_mm, None, "a fit never writes the film's ruler scale");
    assert!(lib.load(&ids[0]).unwrap().fit.is_none(), "the reference has no fit of its own");
}
/// What a fit can never be is refused, in plain words (never a raw database error), and nothing is stored.
/// Boundaries are accepted. Every limit the table's CHECKs hold (012_film_fits.sql) has its own line, so `save_fit`
/// refuses it before SQLite would (ruling, Task 5).
#[test] fn a_fit_that_cannot_mean_anything_is_refused() {
    let (_t, s, mut lib, ids) = films(2);
    let other = lib.import(&png(s.path(), "other.png", 99)).unwrap().case_id;
    lib.set_meta(&other, &meta("Demo Other", "T1", Some("2010-01-02"))).unwrap();   // SYNTHETIC
    let gone = lib.import(&png(s.path(), "gone.png", 77)).unwrap().case_id;
    lib.set_meta(&gone, &meta("Demo Fit", "T9", Some("2010-01-02"))).unwrap();      // SYNTHETIC
    lib.delete(&gone).unwrap();
    let with = |f: &dyn Fn(&mut FitSave)| { let mut x = fit_to(&ids[0]); f(&mut x); x };
    let over = 1e6 + 0.5;                                                            // just past the table's ±1e6 px
    let bad: Vec<(&str, String, FitSave)> = vec![
        ("itself", ids[0].clone(), fit_to(&ids[0])),
        ("another patient's film", ids[1].clone(), fit_to(&other)),
        ("a reference in Recently deleted", ids[1].clone(), fit_to(&gone)),
        ("a film in Recently deleted", gone.clone(), fit_to(&ids[0])),
        ("no such reference", ids[1].clone(), fit_to("nope")),
        ("an unknown reference kind", ids[1].clone(), with(&|x: &mut FitSave| x.ref_kind = "ruler".into())),
        ("a size below ×0.2", ids[1].clone(), with(&|x: &mut FitSave| x.scale = 0.199)),
        ("a size above ×5", ids[1].clone(), with(&|x: &mut FitSave| x.scale = 5.001)),
        ("a turn that is not a number", ids[1].clone(), with(&|x: &mut FitSave| x.rotation = f64::NAN)),
        ("an infinite move", ids[1].clone(), with(&|x: &mut FitSave| x.dx = f64::INFINITY)),
        ("reference points 19.9 px apart", ids[1].clone(), with(&|x: &mut FitSave| x.ref_points = [[0.0, 0.0], [19.9, 0.0]])),
        ("film points 19.9 px apart", ids[1].clone(), with(&|x: &mut FitSave| x.film_points = [[0.0, 0.0], [0.0, 19.9]])),
        // Pre-flight ruling: a turn beyond ±π (the table would take 4.0).
        ("a turn of 4 rad", ids[1].clone(), with(&|x: &mut FitSave| x.rotation = 4.0)),
        // Ruling: one line per bounded field, each past the table's own CHECK.
        ("a turn of −4.001 rad", ids[1].clone(), with(&|x: &mut FitSave| x.rotation = -4.001)),
        ("a move across past 1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.dx = over)),
        ("a move down past −1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.dy = -over)),
        ("reference point 1 across past 1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.ref_points[0][0] = over)),
        ("reference point 1 down past −1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.ref_points[0][1] = -over)),
        ("reference point 2 across past −1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.ref_points[1][0] = -over)),
        ("reference point 2 down past 1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.ref_points[1][1] = over)),
        ("film point 1 across past 1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.film_points[0][0] = over)),
        ("film point 1 down past −1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.film_points[0][1] = -over)),
        ("film point 2 across past −1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.film_points[1][0] = -over)),
        ("film point 2 down past 1,000,000 px", ids[1].clone(), with(&|x: &mut FitSave| x.film_points[1][1] = over)),
    ];
    let mut wrong = vec![];
    for (why, film, f) in bad {
        let said = lib.save_fit(&film, &f, OP).err().map(|e| format!("{e:#}"));
        println!("{why}: {}", said.as_deref().unwrap_or("ACCEPTED"));
        match said {
            None => wrong.push(format!("{why}: ACCEPTED")),
            Some(m) if m.contains("constraint") => wrong.push(format!("{why}: a raw database error: {m}")),
            Some(_) => {}
        }
    }
    assert!(wrong.is_empty(), "each must be refused in plain words:\n{}", wrong.join("\n"));
    assert!(rows(&lib).is_empty(), "nothing was stored");
    let pi = std::f64::consts::PI;
    for f in [with(&|x: &mut FitSave| x.ref_points = [[0.0, 0.0], [20.0, 0.0]]), with(&|x: &mut FitSave| x.scale = 0.2), with(&|x: &mut FitSave| x.scale = 5.0),
              with(&|x: &mut FitSave| x.rotation = pi), with(&|x: &mut FitSave| x.rotation = -pi),
              with(&|x: &mut FitSave| { x.dx = 1e6; x.dy = -1e6; }),
              with(&|x: &mut FitSave| { x.ref_points = [[-1e6, -1e6], [1e6, 1e6]]; x.film_points = [[1e6, 1e6], [-1e6, -1e6]]; })] {
        lib.save_fit(&ids[1], &f, OP).unwrap();
    }
}
/// Plan decision D-d: no chains. Several films may share one reference; saving again replaces. Each refusal names the
/// other film by its timepoint, and says so when that film is in Recently deleted (pre-flight ruling, Task 5).
#[test] fn a_fitted_film_is_never_a_reference_and_a_reference_is_never_fitted() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap();                            // T2 → T1
    let e = lib.save_fit(&ids[2], &fit_to(&ids[1]), OP).unwrap_err();
    println!("a fitted film as reference: {e:#}");
    assert!(format!("{e:#}").contains("remove its fit first") && format!("{e:#}").contains("T2"), "{e:#}");
    let e = lib.save_fit(&ids[0], &fit_to(&ids[2]), OP).unwrap_err();
    println!("a reference fitted: {e:#}");
    assert!(format!("{e:#}").contains("remove that fit first") && format!("{e:#}").contains("T2"), "{e:#}");
    assert!(!format!("{e:#}").contains("Recently deleted"), "T2 is live: {e:#}");
    lib.save_fit(&ids[2], &fit_to(&ids[0]), OP).unwrap();                            // T3 → T1 as well
    lib.save_fit(&ids[1], &FitSave { scale: 1.1, ..fit_to(&ids[0]) }, OP).unwrap();
    assert_eq!(lib.load(&ids[1]).unwrap().fit.unwrap().fit.scale, 1.1);
    assert_eq!(rows(&lib).len(), 2);
    // A fitted film in Recently deleted keeps its fit (for Restore), so its reference still cannot be fitted: say why.
    lib.clear_fit(&ids[2]).unwrap();
    lib.delete(&ids[1]).unwrap();
    let e = lib.save_fit(&ids[0], &fit_to(&ids[2]), OP).unwrap_err();
    println!("reference of a deleted fitted film: {e:#}");
    assert!(format!("{e:#}").contains("T2") && format!("{e:#}").contains("Recently deleted"), "{e:#}");
    lib.purge_deleted(0).unwrap();                                                    // "or empty Recently deleted"
    lib.save_fit(&ids[0], &fit_to(&ids[2]), OP).unwrap();
}
/// Spec G step 4: deleting the reference film clears the fit (it does not come back when the reference is restored);
/// deleting the fitted film keeps its fit for "Restore"; emptying Recently deleted removes it.
#[test] fn deleting_the_reference_clears_the_fit_and_deleting_the_film_keeps_it() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap();
    lib.save_fit(&ids[2], &fit_to(&ids[0]), OP).unwrap();
    lib.delete(&ids[2]).unwrap();
    lib.restore(&ids[2]).unwrap();
    assert!(lib.load(&ids[2]).unwrap().fit.is_some(), "the fitted film is restored with its fit");
    lib.delete(&ids[0]).unwrap();
    assert!(rows(&lib).is_empty(), "deleting the reference clears every fit to it");
    lib.restore(&ids[0]).unwrap();
    assert!(lib.load(&ids[1]).unwrap().fit.is_none(), "restoring the reference does not bring a fit back");
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap();
    lib.delete(&ids[1]).unwrap();
    lib.purge_deleted(0).unwrap();
    assert!(rows(&lib).is_empty(), "emptying Recently deleted removes the film and its fit");
}
/// Plan decision D-e: a fit lasts only while its two films are one patient's films — the rule Library::series uses.
/// After every identity change the store holds exactly those fits, and never brings one back. Positive control:
/// remove `fits::prune` from `set_meta` -> step (a) fails.
#[test] fn a_fit_lasts_only_while_both_films_are_one_patients() {
    let (_t, s, mut lib, ids) = films(3);
    let refit = |lib: &mut Library| for i in [1, 2] { lib.clear_fit(&ids[i]).unwrap(); lib.save_fit(&ids[i], &fit_to(&ids[0]), OP).unwrap(); };
    // Sorted as `rows` sorts (by case id, a random UUID): the brief's fixed T2, T3 order failed half the runs.
    let both = || { let mut v = vec![(ids[1].clone(), ids[0].clone()), (ids[2].clone(), ids[0].clone())]; v.sort(); v };
    let reads = |lib: &Library| ids.iter().map(|i| lib.load(i).unwrap().fit.is_some()).collect::<Vec<_>>();
    refit(&mut lib);
    // (a) the reference renamed to another patient, then back: gone, and it stays gone.
    lib.set_meta(&ids[0], &meta("Demo Elsewhere", "T1", Some("2010-01-02"))).unwrap();   // SYNTHETIC
    assert!(rows(&lib).is_empty(), "(a)");
    lib.set_meta(&ids[0], &meta("Demo Fit", "T1", Some("2010-01-02"))).unwrap();          // SYNTHETIC
    assert!(rows(&lib).is_empty(), "(a) never comes back by itself");
    refit(&mut lib);
    // (b) a fitted film renamed away.
    lib.set_meta(&ids[1], &meta("Demo Elsewhere", "T2", Some("2010-01-02"))).unwrap();   // SYNTHETIC
    assert_eq!(rows(&lib), vec![(ids[2].clone(), ids[0].clone())], "(b)");
    lib.set_meta(&ids[1], &meta("Demo Fit", "T2", Some("2010-01-02"))).unwrap(); refit(&mut lib);   // SYNTHETIC
    // (c) the reference given a different date of birth: another person.
    lib.set_meta(&ids[0], &meta("Demo Fit", "T1", Some("2011-11-11"))).unwrap();          // SYNTHETIC
    assert!(rows(&lib).is_empty(), "(c)");
    lib.set_meta(&ids[0], &meta("Demo Fit", "T1", Some("2010-01-02"))).unwrap(); refit(&mut lib);   // SYNTHETIC
    // (d) a blank date of birth still joins on the name (Library::series' rule): KEPT. Control for an over-eager prune.
    lib.set_meta(&ids[0], &meta("Demo Fit", "T1", None)).unwrap();
    assert_eq!(rows(&lib), both(), "(d) kept");
    lib.set_meta(&ids[0], &meta("Demo Fit", "T1", Some("2010-01-02"))).unwrap();          // SYNTHETIC
    assert_eq!(rows(&lib), both(), "(d) still kept");
    // (g) a fitted film's name cleared (unnamed: it joins no one, as in Library::series): its fit goes.
    lib.set_meta(&ids[2], &meta("", "T3", None)).unwrap();
    println!("(g) rows after T3's name is cleared: {:?}", rows(&lib));
    assert_eq!(rows(&lib), vec![(ids[1].clone(), ids[0].clone())], "(g)");
    lib.set_meta(&ids[2], &meta("Demo Fit", "T3", Some("2010-01-02"))).unwrap();          // SYNTHETIC
    assert_eq!(rows(&lib), vec![(ids[1].clone(), ids[0].clone())], "(g) never comes back by itself");
    refit(&mut lib);
    // (e) "Same patient" moves a fitted film to another named patient.
    let x = lib.import(&png(s.path(), "x.png", 55)).unwrap().case_id;
    lib.set_meta(&x, &meta("Demo Elsewhere", "T1", Some("2010-01-02"))).unwrap();         // SYNTHETIC
    lib.confirm_identity(&ids[1], Some(&PatientRef { name: "Demo Elsewhere".into(), date_of_birth: Some("2010-01-02".into()) })).unwrap();   // SYNTHETIC
    assert_eq!(rows(&lib), vec![(ids[2].clone(), ids[0].clone())], "(e)");
    // (f) the label moves the reference to another patient.
    lib.apply_label(&ids[0], &IdentityRead { name: Some("Demo Labelled".into()), ..IdentityRead::default() }).unwrap();
    assert!(rows(&lib).is_empty(), "(f)");
    assert_eq!(reads(&lib), vec![false, false, false], "what is read agrees with what is stored");
}
/// A row the prune never saw (written directly) is never read: `load` and `series` apply the same rule.
/// Positive control: drop the `together` condition from `fit_of` -> this fails.
#[test] fn a_fit_between_two_patients_is_never_read() {
    let (_t, s, mut lib, ids) = films(1);
    let other = lib.import(&png(s.path(), "other.png", 99)).unwrap().case_id;
    lib.set_meta(&other, &meta("Demo Other", "T1", Some("2010-01-02"))).unwrap();         // SYNTHETIC
    lib.conn_for_tests().execute(&format!("INSERT INTO film_fits (case_id, ref_case_id, ref_kind, ref_x1, ref_y1, ref_x2, ref_y2, film_x1, film_y1, film_x2, film_y2,
        mirror, scale, rotation, dx, dy, use_own, saved_by, saved_at) VALUES ('{}', '{other}', 'sn', 0, 0, 100, 0, 0, 0, 96, 0, 0, 1.04, 0, 0, 0, 0, 'x', 'x')", ids[0]), []).unwrap();
    assert!(lib.load(&ids[0]).unwrap().fit.is_none());
    assert!(lib.series(&ids[0]).unwrap().iter().all(|f| f.fit_ref.is_none()));
}
/// Owner G2 + plan decision D-c: "Use the scale from the fit" is per film, only for a film with no ruler, and every
/// change it makes to the film's own mm clears "Tracing verified" (decision 17's rule) — switched on, switched off, and
/// saved or reset while on. A fit alone never does.
#[test] fn use_the_scale_from_the_fit_is_per_film_and_clears_tracing_verified() {
    let (_t, _s, mut lib, ids) = films(2);
    assert!(lib.set_fit_own(&ids[1], true).is_err(), "no fit yet");
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap();
    lib.set_verified(&ids[1], true, OP).unwrap();
    lib.save_fit(&ids[1], &FitSave { dx: 9.0, ..fit_to(&ids[0]) }, OP).unwrap();
    assert!(lib.load(&ids[1]).unwrap().verified_at.is_some(), "a fit alone never touches Tracing verified");
    // Review I-2 (fix round 1): Reset ("Remove fit", owner D-f) with the switch OFF never touches it either.
    lib.clear_fit(&ids[1]).unwrap();
    let d = lib.load(&ids[1]).unwrap();
    assert!(d.fit.is_none() && d.verified_at.is_some(), "Reset with the switch off never touches Tracing verified");
    lib.save_fit(&ids[1], &FitSave { dx: 9.0, ..fit_to(&ids[0]) }, OP).unwrap();
    lib.set_fit_own(&ids[1], true).unwrap();
    let d = lib.load(&ids[1]).unwrap();
    assert!(d.fit.unwrap().use_own && d.verified_at.is_none(), "switched on: its own mm changed");
    lib.set_verified(&ids[1], true, OP).unwrap();
    lib.set_fit_own(&ids[1], true).unwrap();
    assert!(lib.load(&ids[1]).unwrap().verified_at.is_some(), "switching on what is already on changes nothing");
    // Pre-flight ruling (D-c says "on or off"): switching it OFF changes the film's own mm back.
    lib.set_fit_own(&ids[1], false).unwrap();
    let d = lib.load(&ids[1]).unwrap();
    assert!(!d.fit.unwrap().use_own && d.verified_at.is_none(), "switched off: its own mm changed back");
    lib.set_verified(&ids[1], true, OP).unwrap();
    lib.set_fit_own(&ids[1], true).unwrap();
    lib.set_verified(&ids[1], true, OP).unwrap();          // verified again, so the next step can show a change
    lib.save_fit(&ids[1], &FitSave { scale: 1.2, ..fit_to(&ids[0]) }, OP).unwrap();
    let d = lib.load(&ids[1]).unwrap();
    assert!(d.fit.as_ref().unwrap().use_own && d.verified_at.is_none(), "saved again with the switch on: kept on, verified cleared");
    lib.set_verified(&ids[1], true, OP).unwrap();
    lib.clear_fit(&ids[1]).unwrap();
    assert!(lib.load(&ids[1]).unwrap().verified_at.is_none(), "Reset with the switch on: its mm change back");
    assert!(lib.load(&ids[0]).unwrap().fit.is_none(), "per film: the reference never had it");
    lib.clear_fit(&ids[1]).unwrap();                                                    // nothing to clear is fine
    lib.calibrate(&ids[1], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap();                               // D-a: move and turn only
    let e = lib.set_fit_own(&ids[1], true).unwrap_err();
    assert!(format!("{e:#}").contains("calibrated from its ruler"), "owner G2: a ruler-calibrated film is locked: {e:#}");
}
/// D-c extension (pre-flight ruling, Task 5; owner confirmed 18 Oct): while "Use the scale from the fit" is on, the
/// film's own mm also change when its REFERENCE is calibrated (the reference's ruler is read live) and when its fit is
/// removed by the prune (reference deleted, a film moved to another patient). Each clears that film's Tracing verified.
/// A film with the switch OFF keeps its verified each time: the control for over-eager clearing.
#[test] fn the_switch_on_film_is_unverified_when_its_reference_changes() {
    let (_t, _s, mut lib, ids) = films(3);
    let verified = |lib: &Library, i: usize| lib.load(&ids[i]).unwrap().verified_at.is_some();
    let ready = |lib: &mut Library| {                     // T2 switched on, T3 switched off, both fitted to T1 and verified
        for i in [1, 2] { lib.clear_fit(&ids[i]).unwrap(); lib.save_fit(&ids[i], &fit_to(&ids[0]), OP).unwrap(); }
        lib.set_fit_own(&ids[1], true).unwrap();
        for i in [1, 2] { lib.set_verified(&ids[i], true, OP).unwrap(); }
        assert_eq!((verified(lib, 1), verified(lib, 2)), (true, true));
    };
    ready(&mut lib);
    lib.calibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();               // (1) the reference calibrated
    assert_eq!((verified(&lib, 1), verified(&lib, 2)), (false, true), "(1) calibrated: switch on cleared, switch off kept");
    ready(&mut lib);
    lib.calibrate(&ids[0], (0.0, 0.0), (200.0, 0.0), 10.0, OP).unwrap();               // (1') re-calibrated
    assert_eq!((verified(&lib, 1), verified(&lib, 2)), (false, true), "(1') re-calibrated");
    ready(&mut lib);
    lib.delete(&ids[0]).unwrap();                                                       // (2) the reference deleted
    assert!(rows(&lib).is_empty());
    assert_eq!((verified(&lib, 1), verified(&lib, 2)), (false, true), "(2) reference deleted");
    lib.restore(&ids[0]).unwrap();
    ready(&mut lib);
    lib.set_meta(&ids[0], &meta("Demo Elsewhere", "T1", Some("2010-01-02"))).unwrap();   // (3) the reference moved away  SYNTHETIC
    assert!(rows(&lib).is_empty());
    assert_eq!((verified(&lib, 1), verified(&lib, 2)), (false, true), "(3) reference moved to another patient");
}
/// Review I-1 (fix round 1; ruling, 19 Oct: a ruler always wins, owner G2). A film calibrated from its own
/// ruler after "Use the scale from the fit" was switched on takes its mm from the ruler only, so the switch goes off in
/// the same change. After that its own mm never change with the fit, so no fit event clears its Tracing verified:
/// Save fit (move only, D-a), its reference calibrated, Reset, and a prune. Positive control: drop the `use_own = 0`
/// update from `Library::calibrate` -> every line below fails.
#[test] fn a_film_given_its_own_ruler_leaves_the_fits_scale_and_its_sign_off_alone() {
    // T2 and T3 fitted to T1 with the switch on, then each calibrated from its own ruler. Two films, so Reset (T2) and
    // the prune (T3) each meet the flag as calibrate left it: either one deletes the row, and a re-saved fit starts off.
    let (_t, _s, mut lib, ids) = films(3);
    for i in [1, 2] {
        lib.save_fit(&ids[i], &fit_to(&ids[0]), OP).unwrap();
        lib.set_fit_own(&ids[i], true).unwrap();
        lib.calibrate(&ids[i], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();
    }
    let verified = |lib: &Library, i: usize| lib.load(&ids[i]).unwrap().verified_at.is_some();
    let sign = |lib: &mut Library| for i in [1, 2] { lib.set_verified(&ids[i], true, OP).unwrap(); };
    let mut got: Vec<(&str, bool)> = vec![
        ("T2: the switch goes off with its ruler", !lib.load(&ids[1]).unwrap().fit.unwrap().use_own),
        ("T3: the switch goes off with its ruler", !lib.load(&ids[2]).unwrap().fit.unwrap().use_own)];
    sign(&mut lib);
    lib.save_fit(&ids[1], &FitSave { dx: 9.0, ..fit_to(&ids[0]) }, OP).unwrap();       // D-a: move only
    got.push(("T2: Save fit (move only) keeps Tracing verified", verified(&lib, 1)));
    sign(&mut lib);
    lib.calibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();
    got.push(("T2: its reference calibrated keeps it", verified(&lib, 1)));
    got.push(("T3: its reference calibrated keeps it", verified(&lib, 2)));
    sign(&mut lib);
    lib.clear_fit(&ids[1]).unwrap();
    got.push(("T2: Reset keeps it", verified(&lib, 1)));
    lib.set_meta(&ids[2], &meta("Demo Elsewhere", "T3", Some("2010-01-02"))).unwrap();   // the prune removes T3's fit  SYNTHETIC
    got.push(("T3: its fit pruned (moved to another patient) keeps it", rows(&lib).is_empty() && verified(&lib, 2)));
    for (what, ok) in &got { println!("{what}: {}", if *ok { "yes" } else { "NO" }); }
    assert!(got.iter().all(|(_, ok)| *ok), "{got:?}");
}
/// The comparison key needs, for every film of the series, its reference (if fitted) and whether it has a ruler.
#[test] fn the_series_names_each_films_reference_and_ruler() {
    let (_t, _s, mut lib, ids) = films(3);
    lib.calibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();
    lib.save_fit(&ids[1], &fit_to(&ids[0]), OP).unwrap();
    let mut got: Vec<(String, Option<String>, bool)> = lib.series(&ids[2]).unwrap().into_iter().map(|f| (f.id, f.fit_ref, f.calibrated)).collect();
    got.sort();
    let mut want = vec![(ids[0].clone(), None, true), (ids[1].clone(), Some(ids[0].clone()), false), (ids[2].clone(), None, false)];
    want.sort();
    assert_eq!(got, want);
}
/// Addendum 3 (N) + D-c: a fine-tune of the REFERENCE's ruler changes a switched-on film's mm too (it reads the
/// reference's ruler live), so it clears that film's Tracing verified. A switched-off film keeps it (the control).
#[test] fn a_fine_tune_of_the_reference_unverifies_the_switch_on_film() {
    let (_t, _s, mut lib, ids) = films(3);
    let verified = |lib: &Library, i: usize| lib.load(&ids[i]).unwrap().verified_at.is_some();
    lib.calibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, OP).unwrap();
    for i in [1, 2] { lib.save_fit(&ids[i], &fit_to(&ids[0]), OP).unwrap(); }
    lib.set_fit_own(&ids[1], true).unwrap();
    for i in [1, 2] { lib.set_verified(&ids[i], true, OP).unwrap(); }
    lib.recalibrate(&ids[0], (0.0, 0.0), (100.0, 0.0), 10.0, 2, OP).unwrap();
    assert_eq!((verified(&lib, 1), verified(&lib, 2)), (false, true), "switch on cleared, switch off kept");
    assert_eq!(lib.load(&ids[1]).unwrap().fit.unwrap().ref_spacing_mm, Some(0.1 * (202.0 / 200.0)), "the fit reads the adjusted ruler");
}
