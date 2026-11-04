//! Serial superimposition (spec 2026-09-30 Part 2) on synthetic films only.
use ceph_store::{CaseMeta, Library};
use std::path::{Path, PathBuf};

fn film(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn meta(name: &str, tp: &str, dob: Option<&str>) -> CaseMeta {
    CaseMeta { patient_name: name.into(), timepoint: tp.into(), taken_on: None, date_of_birth: dob.map(str::to_string), scan_id: None }
}
fn ids(lib: &Library, case: &str) -> Vec<String> {
    let mut v: Vec<String> = lib.series(case).unwrap().into_iter().map(|f| f.id).collect(); v.sort(); v
}

#[test] fn series_is_the_same_patients_live_films_only() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&film(src.path(), "b.png", 1)).unwrap().case_id;
    let c = lib.import(&film(src.path(), "c.png", 2)).unwrap().case_id;
    let other = lib.import(&film(src.path(), "d.png", 3)).unwrap().case_id;
    for (id, tp) in [(&a, "T1"), (&b, "T2"), (&c, "T3")] { lib.set_meta(id, &meta("Demo Series", tp, Some("2010-01-02"))).unwrap(); }
    lib.set_meta(&other, &meta("Demo Other", "T1", Some("2010-01-02"))).unwrap();
    lib.delete(&c).unwrap();
    let mut want = vec![a.clone(), b.clone()]; want.sort();
    assert_eq!(ids(&lib, &a), want);
    let f = lib.series(&a).unwrap().into_iter().find(|f| f.id == b).unwrap();
    assert_eq!((f.timepoint.as_str(), f.stage, f.in_series), ("T2", None, true));
}
#[test] fn a_film_without_a_dob_joins_on_name() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let b = lib.import(&film(src.path(), "b.png", 1)).unwrap().case_id;
    let c = lib.import(&film(src.path(), "c.png", 2)).unwrap().case_id;
    lib.set_meta(&a, &meta("Demo Series", "T1", Some("2010-01-02"))).unwrap();
    lib.set_meta(&b, &meta("Demo Series", "T2", None)).unwrap();
    lib.set_meta(&c, &meta("Demo Series", "T1", Some("2011-05-06"))).unwrap();   // same name, different DOB: another person
    let mut want = vec![a.clone(), b.clone()]; want.sort();
    assert_eq!(ids(&lib, &a), want);
    // Final review: a film that joined on name alone is marked, so the key can say "(no DOB)" (the old menu did).
    let flags: Vec<(String, bool)> = lib.series(&a).unwrap().into_iter().map(|f| (f.id, f.name_only)).collect();
    assert!(flags.contains(&(b.clone(), true)) && flags.contains(&(a.clone(), false)), "{flags:?}");
    assert!(lib.series(&b).unwrap().into_iter().all(|f| f.id == b || f.name_only), "from the film without a DOB, every other film joined on name");
}
#[test] fn series_of_an_unnamed_case_is_just_that_case() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    lib.import(&film(src.path(), "b.png", 1)).unwrap();
    assert_eq!(ids(&lib, &a), vec![a.clone()]);
}
#[test] fn stage_and_tick_are_saved_validated_and_leave_verification_alone() {
    let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let mut lib = Library::open(t.path()).unwrap();
    let a = lib.import(&film(src.path(), "a.png", 0)).unwrap().case_id;
    let s = ceph_store::LandmarkRow { id: "S".into(), x: 1.0, y: 2.0, source: "ai".into(), verified: true, ai_x: Some(1.0), ai_y: Some(2.0), confidence: Some(0.8), placed_by: None };
    lib.save(&ceph_store::CaseEdit { id: a.clone(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks: vec![s] }, "op").unwrap();
    lib.set_verified(&a, true, "dr-a").unwrap();
    lib.set_stage(&a, Some("retention")).unwrap();
    lib.set_in_series(&a, false).unwrap();
    let f = lib.series(&a).unwrap().remove(0);
    assert_eq!((f.stage.as_deref(), f.in_series), (Some("retention"), false));
    assert!(lib.load(&a).unwrap().verified_at.is_some());
    lib.set_stage(&a, None).unwrap();
    assert_eq!(lib.series(&a).unwrap()[0].stage, None);
    assert!(lib.set_stage(&a, Some("debond")).unwrap_err().to_string().contains("stage"));
}
#[test] fn a_schema_5_library_gets_auto_stages_and_ticks() {
    let t = tempfile::tempdir().unwrap();
    {
        let c = rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap();
        for (i, sql) in ceph_store::schema::MIGRATIONS[..5].iter().enumerate() { c.execute_batch(sql).unwrap(); c.pragma_update(None, "user_version", i as i64 + 1).unwrap(); }
        c.execute("INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p1', 'Demo Six', 'demo six', 'x')", []).unwrap();
        c.execute("INSERT INTO images VALUES ('s1', 'png', 400, 300, 1, 'film.png', 'x')", []).unwrap();
        c.execute("INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p1', 's1', 'T1', 'x', 'x')", []).unwrap();
    }
    let lib = Library::open(t.path()).unwrap();
    let f = lib.series("c1").unwrap().remove(0);
    assert_eq!((f.stage, f.in_series), (None, true));
}
