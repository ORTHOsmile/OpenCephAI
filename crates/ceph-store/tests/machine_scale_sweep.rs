//! Task MS-7 (spec 2026-10-20): the before/after of the machine scale across two git states. These
//! tools build a SYNTHETIC library on main (format 12) and dump every live film's CaseDoc, in either state, for
//! `apps/desktop/src/export/machineScaleSweep.ts` to run through the production export path. They use only the
//! Library API that main already has, so this file is copied unchanged into a main worktree. Env-driven and
//! `#[ignore]`d: they never run in the ordinary suite. Synthetic films only.
use ceph_store::{CaseEdit, CaseMeta, FitSave, LandmarkRow, Library};
use std::path::{Path, PathBuf};

const OP: &str = "SYNTHETIC Dr Demo";
const PATIENT: &str = "SYNTHETIC Machine Patient";
const DOB: &str = "2012-05-01";   // SYNTHETIC
const FILM_DATE: &str = "2025-03-12";   // SYNTHETIC

/// `SYNTHETIC_SKULLS[0]` ("SYNTHETIC balanced", packages/analyses/src/fixtures.ts `base`), copied point for point.
const SKULL: &[(&str, f64, f64)] = &[
    ("S", 0., 0.), ("N", 700., -100.), ("A", 720., 300.), ("B", 690., 650.), ("Pog", 700., 760.),
    ("Gn", 680., 820.), ("Me", 640., 850.), ("Go", 150., 700.), ("Po", -200., 100.), ("Or", 560., 80.),
    ("ANS", 740., 220.), ("PNS", 260., 240.), ("Co", -50., 150.), ("Ar", -40., 200.),
    ("U1T", 745., 520.), ("L1T", 735., 530.), ("UL", 800., 440.), ("LL", 790., 590.), ("Sn", 790., 280.), ("PogS", 770., 800.),
    ("U1A", 690., 300.), ("L1A", 660., 740.), ("U6", 470., 520.), ("L6", 470., 540.), ("P4", 590., 525.),
    ("U6D", 440., 520.), ("D", 650., 760.), ("Cm", 820., 250.), ("Prn", 880., 200.), ("Ba", -120., 300.),
    ("Pt", 280., 150.), ("PTM", 270., 170.), ("PR", 275., 160.), ("Bo", -200., 280.), ("G", 760., -250.),
    ("Ns", 740., -100.), ("GnS", 740., 860.), ("MeS", 680., 900.), ("Cerv", 500., 1000.),
    ("ULs", 785., 360.), ("LLs", 760., 690.), ("St", 792., 515.), ("Tg", 300., 800.), ("RT", 110., 600.),
    ("R1", 270., 500.), ("R2", 90., 480.), ("R3", 180., 330.), ("R4", 200., 760.), ("Pm", 665., 720.),
    ("DC", -30., 260.), ("SPog", 705., 740.), ("SPogS", 775., 780.), ("ULd", 800., 330.), ("U1L", 760., 480.),
    ("SPP", 250., 300.), ("UPW", 150., 310.), ("TM", 380., 720.), ("LPW", 280., 730.),
];
/// The skull scaled onto the image: × 0.2 and shifted (60, 60), so it fits inside every film here (≥ 400 × 300).
fn skull() -> Vec<LandmarkRow> {
    SKULL.iter().map(|(id, x, y)| LandmarkRow { id: (*id).into(), x: x * 0.2 + 60.0, y: y * 0.2 + 60.0, source: "manual".into(), verified: true,
        ai_x: None, ai_y: None, confidence: None, placed_by: None, accept_kind: None, placed_via: None }).collect()
}
fn png(dir: &Path, name: &str, w: u32, h: u32, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(w, h, |x, y| image::Luma([((x * 3 + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn env(k: &str) -> PathBuf { PathBuf::from(std::env::var(k).unwrap_or_else(|_| panic!("set {k}"))) }
fn by_timepoint(lib: &Library, deleted: bool) -> Vec<(String, String)> {
    let mut v: Vec<(String, String)> = lib.list(deleted).unwrap().into_iter().map(|c| (c.timepoint, c.id)).collect();
    v.sort(); v
}

/// The task's library (brief MS-7): machine m1 "Demo Radiology" (400 × 300) with a-ruler (own ruler), b-match and
/// c-match (no ruler), d-size (401 × 300), e-fitted (500 × 300, fitted to b-match, switch on), f-fitted-off
/// (500 × 300, fitted to c-match, switch off), g-deleted (400 × 300, Recently deleted); machine m2 with h-other
/// (400 × 300); i-none (no machine). One SYNTHETIC patient; every film has the skull, a DOB, a film date and
/// Tracing verified. Run on main: `MS_LIB=<dir> cargo test -p ceph-store --test machine_scale_sweep build_library -- --ignored`.
#[test] #[ignore] fn build_library() {
    let root = env("MS_LIB");
    assert!(!root.exists(), "MS_LIB {} already exists: start from nothing", root.display());
    let src = tempfile::tempdir().unwrap();
    let mut lib = Library::open(&root).unwrap();
    let films: [(&str, u32, u32, Option<&str>); 9] = [("a-ruler", 400, 300, Some("m1")), ("b-match", 400, 300, Some("m1")), ("c-match", 400, 300, Some("m1")),
        ("d-size", 401, 300, Some("m1")), ("e-fitted", 500, 300, Some("m1")), ("f-fitted-off", 500, 300, Some("m1")), ("g-deleted", 400, 300, Some("m1")),
        ("h-other", 400, 300, Some("m2")), ("i-none", 400, 300, None)];
    let c = lib.conn_for_tests();
    c.execute("INSERT INTO layout_machines (id, name, named_by_user, width, height, created_at, updated_at) VALUES ('m1', 'Demo Radiology', 1, 400, 300, 'x', 'x')", []).unwrap();
    c.execute("INSERT INTO layout_machines (id, name, named_by_user, width, height, created_at, updated_at) VALUES ('m2', 'Other Radiology', 1, 400, 300, 'x', 'x')", []).unwrap();
    let mut ids = std::collections::HashMap::new();
    for (i, (tp, w, h, m)) in films.iter().enumerate() {
        let id = lib.import(&png(src.path(), &format!("synthetic-{tp}.png"), *w, *h, (i as u8).wrapping_mul(29))).unwrap().case_id;
        lib.set_meta(&id, &CaseMeta { patient_name: PATIENT.into(), timepoint: (*tp).into(), taken_on: Some(FILM_DATE.into()),
            date_of_birth: Some(DOB.into()), scan_id: None }).unwrap();   // SYNTHETIC
        lib.save(&CaseEdit { id: id.clone(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks: skull() }, OP).unwrap();
        if let Some(m) = m { lib.conn_for_tests().execute("UPDATE cases SET layout_machine_id = ?2 WHERE id = ?1", [&id, &m.to_string()]).unwrap(); }
        ids.insert(*tp, id);
    }
    lib.calibrate(&ids["a-ruler"], (60.0, 280.0), (160.0, 280.0), 10.2, OP).unwrap();   // 0.102 mm/px: its own ruler
    let fit = |r: &str| FitSave { ref_case_id: r.into(), ref_kind: "sn".into(), ref_points: [[60.0, 60.0], [200.0, 40.0]],
        film_points: [[62.0, 61.0], [203.0, 42.0]], mirror: false, scale: 1.04, rotation: 0.02, dx: 1.5, dy: -2.0 };
    lib.save_fit(&ids["e-fitted"], &fit(&ids["b-match"]), OP).unwrap();
    lib.set_fit_own(&ids["e-fitted"], true).unwrap();
    lib.save_fit(&ids["f-fitted-off"], &fit(&ids["c-match"]), OP).unwrap();
    for id in ids.values() { lib.set_verified(id, true, OP).unwrap(); }
    lib.delete(&ids["g-deleted"]).unwrap();
    // The library is what the brief says, read back.
    let live = by_timepoint(&lib, false);
    assert_eq!(live.iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["a-ruler", "b-match", "c-match", "d-size", "e-fitted", "f-fitted-off", "h-other", "i-none"]);
    assert_eq!(by_timepoint(&lib, true).iter().map(|x| x.0.as_str()).collect::<Vec<_>>(), ["g-deleted"]);
    for (tp, id) in &live {
        let d = lib.load(id).unwrap();
        assert!(d.verified_at.is_some() && d.date_of_birth.as_deref() == Some(DOB) && d.landmarks.len() == SKULL.len(), "{tp}");
        assert_eq!(d.spacing_mm.is_some(), tp == "a-ruler", "{tp}: only a-ruler has a ruler");
        assert_eq!(d.fit.as_ref().map(|f| f.use_own), match tp.as_str() { "e-fitted" => Some(true), "f-fitted-off" => Some(false), _ => None }, "{tp}");
    }
    println!("build_library: {} live films, 1 in Recently deleted, in {}", live.len(), root.display());
}

/// This checkout's git state, in the form `apps/desktop/src/sweepStates.ts` `gitState` writes: the HEAD commit, plus
/// `+` and 12 hex of a SHA-256 over the uncommitted changes (tracked diff, then every untracked, not-ignored file's
/// name and content) when there are any (final review M7).
fn git_state() -> String {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let run = |dir: &Path, args: &[&str], input: Option<&str>| -> String {
        let mut c = std::process::Command::new("git");
        c.args(args).current_dir(dir).stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped());
        let mut ch = c.spawn().expect("git");
        if let Some(i) = input { ch.stdin.take().unwrap().write_all(i.as_bytes()).unwrap(); } else { drop(ch.stdin.take()); }
        let out = ch.wait_with_output().unwrap();
        assert!(out.status.success(), "git {args:?} failed");
        String::from_utf8(out.stdout).unwrap()
    };
    let top = PathBuf::from(run(Path::new(env!("CARGO_MANIFEST_DIR")), &["rev-parse", "--show-toplevel"], None).trim());
    let head = run(&top, &["rev-parse", "HEAD"], None).trim().to_string();
    let untracked = run(&top, &["ls-files", "--others", "--exclude-standard"], None);
    let contents = if untracked.trim().is_empty() { String::new() } else { run(&top, &["hash-object", "--stdin-paths"], Some(&untracked)) };
    let dirty = run(&top, &["diff", "HEAD", "--binary"], None) + &untracked + &contents;
    if dirty.is_empty() { head } else { format!("{head}+{}", &Sha256::digest(dirty.as_bytes()).iter().map(|b| format!("{b:02x}")).collect::<String>()[..12]) }
}

/// Every live film's CaseDoc (as the app reads it, IPC JSON), sorted by timepoint, to MS_OUT, stamped with the git
/// state that wrote it (`{"gitState": …, "rows": [docs]}`, final review M7: the comparison refuses two dumps of one
/// state). Films in Recently deleted are left out, as the Library's Export CSV… never offers them. Runs in either state.
#[test] #[ignore] fn dump_docs() {
    let lib = Library::open(&env("MS_LIB")).unwrap();
    let docs: Vec<_> = by_timepoint(&lib, false).into_iter().map(|(_, id)| lib.load(&id).unwrap()).collect();
    let state = git_state();
    std::fs::write(env("MS_OUT"), serde_json::to_string(&serde_json::json!({ "gitState": state, "rows": docs })).unwrap()).unwrap();
    println!("dump_docs: {} live films ({} in Recently deleted, left out) to {}, git state {state}", docs.len(), lib.list(true).unwrap().len(), env("MS_OUT").display());
}
