//! Schema 9 (spec 2026-10-06, Part C, Task 4): the case's chosen reference population, the clinician's own norms
//! (never in git, always labelled "user norm"), and the clinic default population setting. Synthetic films only.
use ceph_store::{Library, UserNorm};
use std::path::{Path, PathBuf};

fn synthetic_png(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
/// A library holding `n` synthetic films, and their case ids.
fn films(n: u8) -> (tempfile::TempDir, tempfile::TempDir, Library, Vec<String>) {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let ids = (0..n).map(|i| lib.import(&synthetic_png(src.path(), &format!("synthetic-{i}.png"), i * 40)).unwrap().case_id).collect();
    (t, src, lib, ids)
}
fn norm(set_name: &str, measurement: &str, mean: f64, sd: Option<f64>, source_note: &str) -> UserNorm {
    UserNorm { set_name: set_name.into(), measurement: measurement.into(), mean, sd, source_note: source_note.into() }
}

#[test] fn a_new_film_starts_with_no_population_meaning_the_clinic_default() {
    let (_t, _s, lib, ids) = films(1);
    assert_eq!(lib.load(&ids[0]).unwrap().population, None);
}

#[test] fn a_cases_population_round_trips_and_can_be_cleared() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_case_population(&ids[0], Some("steiner-adult")).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().population.as_deref(), Some("steiner-adult"));
    lib.set_case_population(&ids[0], None).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().population, None);
}

#[test] fn an_unknown_case_id_refuses_a_population_set() {
    let (_t, _s, mut lib, _ids) = films(0);
    assert!(lib.set_case_population("nope", Some("steiner-adult")).unwrap_err().to_string().contains("nope"));
}

/// Fix round 1, Important 2: `set_case_population` must refuse a soft-deleted case, like the setters next to it
/// (`set_patient_gender`, `set_patient_referrer`, both via `live_case`), and the refusal must leave the case's
/// existing population exactly as it was — not silently write through to a case nobody can see any more.
#[test] fn a_deleted_case_refuses_a_population_set_and_leaves_it_unchanged() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_case_population(&ids[0], Some("steiner-adult")).unwrap();
    lib.delete(&ids[0]).unwrap();
    let e = lib.set_case_population(&ids[0], Some("mcnamara-adult")).unwrap_err().to_string();
    assert!(e.contains("Recently deleted"), "{e}");
    assert_eq!(lib.load(&ids[0]).unwrap().population.as_deref(), Some("steiner-adult"), "the refusal must not have changed the stored population");
}

/// Fix round 1, Important 2: a blank or whitespace-only population is the same as clearing it (the same trim
/// pattern `set_patient_referrer` uses for the referrer), not a stray literal string stored in the column.
#[test] fn a_blank_or_whitespace_only_population_is_stored_as_none() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_case_population(&ids[0], Some("steiner-adult")).unwrap();   // starts non-blank, to prove it is actually cleared
    for blank in ["", "   "] {
        lib.set_case_population(&ids[0], Some(blank)).unwrap();
        assert_eq!(lib.load(&ids[0]).unwrap().population, None, "{blank:?} must store NULL, not a blank string");
        lib.set_case_population(&ids[0], Some("steiner-adult")).unwrap();   // reset for the next case in the loop
    }
}

#[test] fn setting_the_population_survives_closing_and_reopening_the_library() {
    let (t, _s, mut lib, ids) = films(1);
    lib.set_case_population(&ids[0], Some("mcnamara-adult")).unwrap();
    drop(lib);
    let reopened = Library::open(t.path()).unwrap();
    assert_eq!(reopened.load(&ids[0]).unwrap().population.as_deref(), Some("mcnamara-adult"));
}

#[test] fn user_norms_starts_empty() {
    let (_t, _s, lib, _ids) = films(0);
    assert_eq!(lib.user_norms().unwrap(), vec![]);
}

#[test] fn a_user_norm_can_be_saved_read_updated_and_deleted() {
    let (_t, _s, mut lib, _ids) = films(0);
    lib.save_user_norm(&norm("My clinic", "sna", 82.0, Some(2.1), "my own measurements, 40 patients")).unwrap();
    assert_eq!(lib.user_norms().unwrap(), vec![norm("My clinic", "sna", 82.0, Some(2.1), "my own measurements, 40 patients")]);
    // Saving the same (set_name, measurement) again updates it in place (upsert), not a second row.
    lib.save_user_norm(&norm("My clinic", "sna", 83.5, None, "revised after more cases")).unwrap();
    let all = lib.user_norms().unwrap();
    assert_eq!(all.len(), 1, "an upsert on the same set and measurement must not add a second row");
    assert_eq!(all[0], norm("My clinic", "sna", 83.5, None, "revised after more cases"));
    lib.delete_user_norm("My clinic", "sna").unwrap();
    assert_eq!(lib.user_norms().unwrap(), vec![]);
}

#[test] fn deleting_an_unknown_user_norm_is_not_an_error() {
    let (_t, _s, mut lib, _ids) = films(0);
    lib.delete_user_norm("Nobody's set", "sna").unwrap();   // nothing to delete; not an error
}

#[test] fn two_measurements_in_one_set_are_two_rows_and_only_the_named_one_is_deleted() {
    let (_t, _s, mut lib, _ids) = films(0);
    lib.save_user_norm(&norm("My clinic", "sna", 82.0, Some(2.1), "n")).unwrap();
    lib.save_user_norm(&norm("My clinic", "snb", 80.0, Some(1.9), "n")).unwrap();
    assert_eq!(lib.user_norms().unwrap().len(), 2);
    lib.delete_user_norm("My clinic", "sna").unwrap();
    let left = lib.user_norms().unwrap();
    assert_eq!(left.len(), 1);
    assert_eq!(left[0].measurement, "snb");
}

/// Every refusal below must leave the table exactly as it was (§3 of the standing orders: "the refusals each
/// leaving the table unchanged"). Fix round 1, Minor 5: each test first seeds a VALID row — at the exact
/// `(set_name, measurement)` key the bad call would land on when that key is unaffected by the field under test
/// (source note, mean, sd), or at a representative key otherwise (set name, measurement: those tests' bad value
/// IS the key, so it can never collide with a seeded key no matter what) — so "unchanged" proves an existing row
/// SURVIVES the refusal, not merely that the table started and stayed empty.
#[test] fn save_user_norm_refuses_an_empty_set_name_and_leaves_the_table_unchanged() {
    let (_t, _s, mut lib, _ids) = films(0);
    lib.save_user_norm(&norm("Existing clinic", "snb", 80.0, Some(1.9), "the existing row this refusal must not touch")).unwrap();
    let before = lib.user_norms().unwrap();
    for bad in ["", "   "] {
        let e = lib.save_user_norm(&norm(bad, "sna", 82.0, Some(2.0), "n")).unwrap_err().to_string();
        assert!(e.contains("set name") || e.contains("set_name"), "{bad:?}: {e}");
    }
    assert_eq!(lib.user_norms().unwrap(), before);
}
#[test] fn save_user_norm_refuses_an_empty_measurement_and_leaves_the_table_unchanged() {
    let (_t, _s, mut lib, _ids) = films(0);
    lib.save_user_norm(&norm("My clinic", "snb", 80.0, Some(1.9), "the existing row this refusal must not touch")).unwrap();
    let before = lib.user_norms().unwrap();
    for bad in ["", "   "] {
        let e = lib.save_user_norm(&norm("My clinic", bad, 82.0, Some(2.0), "n")).unwrap_err().to_string();
        assert!(e.contains("measurement"), "{bad:?}: {e}");
    }
    assert_eq!(lib.user_norms().unwrap(), before);
}
#[test] fn save_user_norm_refuses_an_empty_source_note_and_leaves_the_table_unchanged() {
    let (_t, _s, mut lib, _ids) = films(0);
    // Same (set_name, measurement) key as the bad calls below: if the refusal let the write through, it would
    // land right on this row, so "unchanged" here really does mean "the existing row was not overwritten".
    lib.save_user_norm(&norm("My clinic", "sna", 82.0, Some(2.1), "the existing row this refusal must not touch")).unwrap();
    let before = lib.user_norms().unwrap();
    for bad in ["", "   "] {
        let e = lib.save_user_norm(&norm("My clinic", "sna", 82.0, Some(2.0), bad)).unwrap_err().to_string();
        assert!(e.contains("source") || e.contains("note"), "{bad:?}: {e}");
    }
    assert_eq!(lib.user_norms().unwrap(), before);
}
#[test] fn save_user_norm_refuses_a_non_finite_mean_and_leaves_the_table_unchanged() {
    let (_t, _s, mut lib, _ids) = films(0);
    // Same (set_name, measurement) key as the bad calls below (see the source-note test above).
    lib.save_user_norm(&norm("My clinic", "sna", 82.0, Some(2.1), "the existing row this refusal must not touch")).unwrap();
    let before = lib.user_norms().unwrap();
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let e = lib.save_user_norm(&norm("My clinic", "sna", bad, Some(2.0), "n")).unwrap_err().to_string();
        assert!(e.contains("mean"), "{bad:?}: {e}");
    }
    assert_eq!(lib.user_norms().unwrap(), before);
}
#[test] fn save_user_norm_refuses_an_sd_at_or_below_zero_and_leaves_the_table_unchanged() {
    let (_t, _s, mut lib, _ids) = films(0);
    // Same (set_name, measurement) key as the bad calls below (see the source-note test above).
    lib.save_user_norm(&norm("My clinic", "sna", 82.0, Some(2.1), "the existing row this refusal must not touch")).unwrap();
    let before = lib.user_norms().unwrap();
    for bad in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let e = lib.save_user_norm(&norm("My clinic", "sna", 82.0, Some(bad), "n")).unwrap_err().to_string();
        assert!(e.contains("sd") || e.contains("SD"), "{bad:?}: {e}");
    }
    assert_eq!(lib.user_norms().unwrap(), before);
    // An SD of None (no SD at all) is allowed: never colours, but still a usable mean. This is a legitimate
    // update of the very row this test protects, so it is checked after the `before == after` assertion above.
    lib.save_user_norm(&norm("My clinic", "sna", 82.0, None, "n")).unwrap();
    assert_eq!(lib.user_norms().unwrap(), vec![norm("My clinic", "sna", 82.0, None, "n")]);
}

/// The clinic default population (Settings; N6): `None` clears it, and it round-trips through `setting`/`set_setting`.
#[test] fn the_default_population_round_trips_and_can_be_cleared() {
    let (_t, _s, mut lib, _ids) = films(0);
    assert_eq!(lib.default_population().unwrap(), None);
    lib.set_default_population(Some("steiner-adult")).unwrap();
    assert_eq!(lib.default_population().unwrap().as_deref(), Some("steiner-adult"));
    lib.set_default_population(None).unwrap();
    assert_eq!(lib.default_population().unwrap(), None);
}

/// Fix round 1, Minor 3: a blank or whitespace-only default population is the same as clearing it (not a stray
/// literal string in the settings table).
#[test] fn a_blank_or_whitespace_only_default_population_clears_it() {
    let (_t, _s, mut lib, _ids) = films(0);
    lib.set_default_population(Some("steiner-adult")).unwrap();   // starts non-blank, to prove it is actually cleared
    for blank in ["", "   "] {
        lib.set_default_population(Some(blank)).unwrap();
        assert_eq!(lib.default_population().unwrap(), None, "{blank:?} must clear the default, not store a blank string");
        lib.set_default_population(Some("steiner-adult")).unwrap();   // reset for the next case in the loop
    }
}
