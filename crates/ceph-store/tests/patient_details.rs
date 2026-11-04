//! Gender and referring practitioner on the patient (spec 2026-10-04). Synthetic films and names only.
//! Final-review fix round, 5 Oct: split into two single-field saves (`set_patient_gender`, `set_patient_referrer`) so
//! that saving one field can never clobber the other with a stale value (the Gender/Referrer save race, Important 1).
use ceph_store::{CaseMeta, Library};
use std::path::{Path, PathBuf};

fn synthetic_png(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn meta(name: &str, dob: Option<&str>) -> CaseMeta {
    CaseMeta { patient_name: name.into(), timepoint: "T1".into(), taken_on: None, date_of_birth: dob.map(Into::into), scan_id: None }
}
/// A library holding `n` synthetic films, and their case ids.
fn films(n: u8) -> (tempfile::TempDir, tempfile::TempDir, Library, Vec<String>) {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let ids = (0..n).map(|i| lib.import(&synthetic_png(src.path(), &format!("synthetic-{i}.png"), i * 40)).unwrap().case_id).collect();
    (t, src, lib, ids)
}

#[test] fn a_new_film_starts_with_gender_and_referrer_not_recorded() {
    let (_t, _s, lib, ids) = films(1);
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.gender, d.referring_practitioner), (None, None));
}
#[test] fn details_are_saved_on_the_patient_and_shown_on_every_film_of_that_patient() {
    let (_t, _s, mut lib, ids) = films(2);
    for id in &ids { lib.set_meta(id, &meta("Demo Synthetic", Some("1990-03-07"))).unwrap(); }   // SYNTHETIC
    lib.set_patient_gender(&ids[0], Some("F")).unwrap();
    lib.set_patient_referrer(&ids[0], Some("  Dr Demo  ")).unwrap();
    let b = lib.load(&ids[1]).unwrap();
    assert_eq!((b.gender.as_deref(), b.referring_practitioner.as_deref()), (Some("F"), Some("Dr Demo")));
}
#[test] fn gender_is_f_m_or_not_recorded_and_a_blank_referrer_is_none() {
    let (_t, _s, mut lib, ids) = films(1);
    for bad in ["X", "f", "Female", ""] {
        let e = lib.set_patient_gender(&ids[0], Some(bad)).unwrap_err().to_string();
        assert!(e.contains("gender"), "{bad:?}: {e}");
    }
    lib.set_patient_gender(&ids[0], Some("M")).unwrap();
    lib.set_patient_referrer(&ids[0], Some("   ")).unwrap();
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.gender.as_deref(), d.referring_practitioner), (Some("M"), None));
    lib.set_patient_gender(&ids[0], None).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().gender, None);
}
#[test] fn a_film_renamed_to_a_new_patient_keeps_its_gender_and_referrer() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.set_patient_gender(&ids[0], Some("F")).unwrap();
    lib.set_patient_referrer(&ids[0], Some("Dr Demo")).unwrap();
    lib.set_meta(&ids[0], &meta("Demo Renamed", None)).unwrap();
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.patient_name.as_str(), d.gender.as_deref(), d.referring_practitioner.as_deref()), ("Demo Renamed", Some("F"), Some("Dr Demo")));
}
#[test] fn a_film_named_while_blank_keeps_what_was_set_before_its_name() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_patient_gender(&ids[0], Some("M")).unwrap();          // still unnamed
    lib.set_meta(&ids[0], &meta("Demo Later", None)).unwrap();
    assert_eq!(lib.load(&ids[0]).unwrap().gender.as_deref(), Some("M"));
}
#[test] fn a_film_renamed_to_an_existing_patient_shows_that_patients_details() {
    let (_t, _s, mut lib, ids) = films(2);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.set_meta(&ids[1], &meta("Demo Two", None)).unwrap();
    lib.set_patient_gender(&ids[0], Some("F")).unwrap();
    lib.set_patient_referrer(&ids[0], Some("Dr A")).unwrap();
    lib.set_patient_gender(&ids[1], Some("M")).unwrap();
    lib.set_patient_referrer(&ids[1], Some("Dr B")).unwrap();
    lib.set_meta(&ids[0], &meta("Demo Two", None)).unwrap();
    let a = lib.load(&ids[0]).unwrap();
    assert_eq!((a.gender.as_deref(), a.referring_practitioner.as_deref()), (Some("M"), Some("Dr B")));
    let b = lib.load(&ids[1]).unwrap();
    assert_eq!((b.gender.as_deref(), b.referring_practitioner.as_deref()), (Some("M"), Some("Dr B")), "the existing patient is not overwritten");
}
#[test] fn a_deleted_film_refuses_new_details() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.delete(&ids[0]).unwrap();
    assert!(lib.set_patient_gender(&ids[0], Some("F")).unwrap_err().to_string().contains("Recently deleted"));
    assert!(lib.set_patient_referrer(&ids[0], Some("Dr Demo")).unwrap_err().to_string().contains("Recently deleted"));
}

/// The race found in the final review (Important 1): setting Gender must never touch the Referrer, and the reverse.
/// Before the fix, `set_patient_details(case, gender, referrer)` took both fields every time, so two screen edits
/// landing out of order (blur the Referrer box, then click a Gender radio) could silently lose one of them.
#[test] fn setting_gender_never_touches_the_referrer_and_the_reverse() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_patient_gender(&ids[0], Some("F")).unwrap();
    lib.set_patient_referrer(&ids[0], Some("Dr A")).unwrap();
    lib.set_patient_gender(&ids[0], Some("M")).unwrap();
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!(d.referring_practitioner.as_deref(), Some("Dr A"), "setting gender touched the referrer");
    lib.set_patient_referrer(&ids[0], Some("Dr B")).unwrap();
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!(d.gender.as_deref(), Some("M"), "setting the referrer touched gender");
}

/// Store test gap (final review, C4): a DOB-only change that makes a new patient keeps that patient's Gender and
/// Referrer (the new-patient carry-forward in `set_meta` is keyed on becoming a new patient, not on which field
/// of the name/DOB pair changed).
#[test] fn a_dob_only_change_that_makes_a_new_patient_keeps_gender_and_referrer() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo One", Some("1990-03-07"))).unwrap();   // SYNTHETIC
    lib.set_patient_gender(&ids[0], Some("F")).unwrap();
    lib.set_patient_referrer(&ids[0], Some("Dr Demo")).unwrap();
    // Same name, a different date of birth: a new patient (same name key, different DOB never matches).
    lib.set_meta(&ids[0], &meta("Demo One", Some("1991-04-08"))).unwrap();   // SYNTHETIC
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.gender.as_deref(), d.referring_practitioner.as_deref()), (Some("F"), Some("Dr Demo")));
}

/// Store test gap (final review, C4): blanking the name (back to an unnamed patient) keeps Gender and Referrer.
#[test] fn blanking_the_name_keeps_gender_and_referrer() {
    let (_t, _s, mut lib, ids) = films(1);
    lib.set_meta(&ids[0], &meta("Demo One", None)).unwrap();
    lib.set_patient_gender(&ids[0], Some("M")).unwrap();
    lib.set_patient_referrer(&ids[0], Some("Dr Demo")).unwrap();
    lib.set_meta(&ids[0], &meta("", None)).unwrap();                       // blanked back to unnamed
    let d = lib.load(&ids[0]).unwrap();
    assert_eq!((d.patient_name.as_str(), d.gender.as_deref(), d.referring_practitioner.as_deref()), ("", Some("M"), Some("Dr Demo")));
}
