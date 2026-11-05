//! Part F Task 5 (owner E1): each film's scale as the library hands it to Part F, end to end through real stored films
//! (rulers, a machine's calibrated scale read with the `APPLIES` rule, fits read live). The shared fixture
//! (`film_scale_cases.json`) pins the rule against the screen's `ownPages`; this pins that the library feeds that rule
//! the same facts the screen is fed. Synthetic films and names only.
use ceph_store::{CaseMeta, FilmScale, FitSave, Library, ScaleSource};
use std::path::{Path, PathBuf};

const OP: &str = "Dr Demo";
fn png(dir: &Path, name: &str, w: u32, h: u32, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(w, h, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn fit(r: &str, scale: f64) -> FitSave {
    FitSave { ref_case_id: r.into(), ref_kind: "sn".into(), ref_points: [[100.0, 100.0], [300.0, 80.0]], film_points: [[110.0, 105.0], [302.0, 90.0]],
        mirror: false, scale, rotation: 0.05, dx: 1.5, dy: -2.0 }
}
fn at(s: &FilmScale) -> (f64, ScaleSource, bool) { (s.mm_per_px, s.source, s.fine_tuned) }

/// Eight films of one patient, all recognised as machine "Demo Radiology", whose scale is 0.0625 mm per px for films of
/// exactly 400 × 300 px. Each film exercises one step of the order; then the ruler is fine-tuned and the reference
/// film is deleted. Positive control: `film_scales` without `deleted_at IS NULL` → T1 is still listed and this fails.
#[test] fn the_library_gives_each_film_its_scale_in_the_apps_order() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let sizes = [(400, 300), (400, 300), (401, 300), (401, 300), (401, 300), (400, 300), (401, 300), (401, 300)];
    let ids: Vec<String> = sizes.iter().enumerate()
        .map(|(i, (w, h))| lib.import(&png(src.path(), &format!("synthetic-{i}.png"), *w, *h, (i as u8).wrapping_mul(11))).unwrap().case_id).collect();
    for (i, id) in ids.iter().enumerate() {
        lib.set_meta(id, &CaseMeta { patient_name: "Demo Scale".into(), timepoint: format!("T{}", i + 1), taken_on: None, date_of_birth: None, scan_id: None }).unwrap();
    }
    let c = lib.conn_for_tests();
    c.execute("INSERT INTO layout_machines (id, name, named_by_user, width, height, created_at, updated_at, spacing_mm, width_px, height_px, scale_source, scale_set_at)
               VALUES ('m1', 'Demo Radiology', 1, 400, 300, 'x', 'x', 0.0625, 400, 300, 'entered', '2026-10-27T00:00:00.000Z')", []).unwrap();
    for id in &ids { c.execute("UPDATE cases SET layout_machine_id = 'm1' WHERE id = ?1", [id]).unwrap(); }
    let [a, b, cc, d, e, f, g, h] = <[String; 8]>::try_from(ids.clone()).unwrap();
    lib.calibrate(&a, (0.0, 0.0), (100.0, 0.0), 12.5, OP).unwrap();                       // T1: ruler 0.125 (its machine applies too)
    lib.save_fit(&d, &fit(&a, 1.5), OP).unwrap(); lib.set_fit_own(&d, true).unwrap();       // T4: fit to the ruler film, on
    lib.save_fit(&e, &fit(&b, 2.0), OP).unwrap(); lib.set_fit_own(&e, true).unwrap();       // T5: fit to the machine-scaled film, on
    lib.save_fit(&f, &fit(&a, 1.5), OP).unwrap();                                           // T6: its own machine scale; a stale "on"
    lib.conn_for_tests().execute("UPDATE film_fits SET use_own = 1 WHERE case_id = ?1", [&f]).unwrap();
    lib.save_fit(&g, &fit(&cc, 2.0), OP).unwrap(); lib.set_fit_own(&g, true).unwrap();      // T7: fit to a film with no scale (G3)
    lib.save_fit(&h, &fit(&a, 1.5), OP).unwrap();                                           // T8: fit switched off

    let s = lib.film_scales(0.1).unwrap();
    assert_eq!(s.len(), 8, "every live film, once");
    let got: Vec<_> = ids.iter().map(|id| at(&s[id])).collect();
    assert_eq!(got, [
        (0.125, ScaleSource::Ruler, false),       // T1 ruler beats its machine
        (0.0625, ScaleSource::Machine, false),    // T2 machine at exactly 400 × 300
        (0.1, ScaleSource::Assumed, false),       // T3 machine of another pixel size does not apply
        (0.1875, ScaleSource::Fit, false),        // T4 0.125 × 1.5
        (0.125, ScaleSource::Fit, false),         // T5 0.0625 × 2.0
        (0.0625, ScaleSource::Machine, false),    // T6 machine beats fit, even with the switch on
        (0.2, ScaleSource::Assumed, false),       // T7 0.1 × 2.0, on the assumed scale (G3)
        (0.1, ScaleSource::Assumed, false),       // T8 fit switched off
    ]);
    for id in &ids { assert_eq!(s[id], ceph_store::film_scale(&lib.load(id).unwrap(), 0.1), "the list is film_scale on the loaded film"); }

    // A ruler fine-tuned by one press: still a ruler, marked; the film fitted to it follows at once (read live).
    lib.recalibrate(&a, (0.0, 0.0), (100.0, 0.0), 12.5, 1, OP).unwrap();
    let ruler = lib.load(&a).unwrap().spacing_mm.unwrap();
    assert_eq!(ruler, 0.125 * (201.0 / 200.0), "one press is 0.5 %");
    let s = lib.film_scales(0.1).unwrap();
    assert_eq!((at(&s[&a]), at(&s[&d])), ((ruler, ScaleSource::Ruler, true), (ruler * 1.5, ScaleSource::Fit, false)),
        "the fine-tune flag is the ruler film's own, never carried through a fit");

    // The reference in Recently deleted: it leaves the list, and the films fitted to it lose their fit.
    lib.delete(&a).unwrap();
    let s = lib.film_scales(0.1).unwrap();
    assert!(!s.contains_key(&a), "a film in Recently deleted is not listed");
    assert_eq!(s.len(), 7);
    assert_eq!((at(&s[&d]), at(&s[&f]), at(&s[&h])),
        ((0.1, ScaleSource::Assumed, false), (0.0625, ScaleSource::Machine, false), (0.1, ScaleSource::Assumed, false)));
}
