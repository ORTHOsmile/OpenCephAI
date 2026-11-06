//! The development-film run's tests (SYNTHETIC faces and folders only; never data/ or models/). Each test names the
//! production change that would make it fail.
use super::*;
use crate::ft_common::Pt;
use crate::sc1_1a::tests::{cal, gate_json, ids, prior, sx, Sx, FP, TAU2};
use ceph_model::pointcheck::ORDER;
use ceph_model::shape::synthetic_faces as faces;
use ceph_model::wholefilm::{cb_calibration_path, cb_offset, points_of, reference_json, reference_path, size_calibration_path, size_score, CbVerdict, ExtraLook,
    FilmResult, Look, SizeCalibration, SizeRef, CB_CALIBRATION_VERSION, CB_RULE, REGIONS, SIZE_CALIBRATION_VERSION, SIZE_RULE};
use std::path::PathBuf;
use std::sync::OnceLock;

/// The pre-registration's SHA-256, pinned when it was committed alone (807320e, before any sc1_dev code or run).
const PINNED_SHA256: &str = "91e13e87f6a62071a4163e31a97d7c53c15d06a7c4b376a19f2be194f85bd686";
const TAU3: [f64; 5] = [0.09, 0.07, 0.10, 0.01, 0.10];

/// Fails if: the pre-registration file changes by a byte after it was committed.
#[test] fn the_preregistration_is_pinned() {
    assert_eq!(ft_common::sha256_hex(PREREG.as_bytes()), PINNED_SHA256);
}
/// The pins the program reads are the file's (fails if: a pin is read from the wrong key, or the /1 column's pins are not
/// SC1-1a's own); the header words are the file's; the plants are SC1-1a's, verbatim.
#[test] fn the_preregistration_pins_parse() {
    let p = DevPins::from_prereg().unwrap();
    eprintln!("{p:?}");
    assert_eq!(p.sc1a, sc1_1a::Pins::from_prereg().unwrap());
    assert_eq!(p.fingerprint, FP);
    assert_eq!(p.gate3, "f639b5bc41b12388ab430e9e86fda78143bb2984ae483d83cd65e3916d1ff0d5");
    assert_eq!(p.size, "836b8c341127026f0f8b27f7abe54fabfaa9da96b05a21e60d8bd2e872a91cab");
    assert_eq!(p.cb, "111776c2bfb0e5932061f7ccb92e0d2eab1a049ba32c779309b29c070362e797");
    assert_eq!(p.reference, "6f0f066aeedde5eb329800595c29fb082b56ec6092f8782fc8653d0a1b4a81bd");
    assert_eq!(p.prior, "106a45e3d2ea6f8a5eea9ea59d45555ffb427f37b14b7914ac843c12e97ccb66");
    assert_eq!(p.sc1a_report, "c08556b2a5ec860c1f4571f5fa782e2f76fa2e836aae310cab24c50dd7d324b6");
    let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
    let a: serde_json::Value = serde_json::from_str(sc1_1a::PREREG).unwrap();
    assert_eq!(v["header"], HEADER);
    assert_eq!((&v["plants"], &v["definitions"]), (&a["plants"], &a["definitions"]), "SC1-1a's plants, verbatim");
    assert_eq!(v["seeds"]["plants"].as_u64(), Some(sc1_1a::SEED));
    assert_eq!(v["seeds"]["folds"].as_u64(), Some(sc1_1a::FOLD_SEED));
}

/// The stop (spec §17.6), in integers at SC1-1a's marks. Fails if: `<=` for `<` on the catch, or `>=` for `>` on the
/// false alarms, or the marks are not SC1-1a's.
#[test] fn the_stop_rule() {
    let m = Marks::real();
    for (caught, fa, want) in [(2602, 0, 3), (2603, 0, 0), (2740, 7, 3), (2740, 6, 0), (2289, 11, 3), (2603, 6, 0)] {
        eprintln!("{caught} caught, {fa} untouched flagged: exit {}", stop_exit(caught, fa, &m));
        assert_eq!(stop_exit(caught, fa, &m), want, "{caught} caught, {fa} flagged");
    }
}

fn res(reasons: Vec<Reason>, size_look: ExtraLook, cb_look: ExtraLook) -> FilmResult {
    let check = if reasons.is_empty() { FilmCheck::Clean } else { FilmCheck::Flagged { reasons } };
    FilmResult { check, shape_look: Look::Judged, region_look: Look::Judged, shape: None, present: 19, size: None, size_look, cb: None, cb_look }
}
fn case(r: FilmResult) -> Case { Case { kind: Kind::N, dataset: Dataset::Ceph400, result: r, stage_a: false } }
fn cb(outside: Vec<(String, Option<f64>)>, centre: Option<f64>) -> Reason { Reason::Region { region: Region::CranialBase, outside, centre } }

/// Each look counted from its own reason (fails if: a centre-only cranial-base reason is counted as a region edge, a
/// cranial-base point inside its τ counted as an edge, or `only_new` counts a case an old look also flagged).
#[test] fn looks_counts_each_look_and_what_only_the_new_looks_caught() {
    let tau = RegionTau(TAU3);
    let inside = || vec![("S".to_string(), Some(0.0)), ("N".to_string(), Some(0.05))];
    let cases = vec![
        case(res(vec![Reason::Size { factor: 0.5 }], ExtraLook::Judged, ExtraLook::Judged)),                         // size only: new
        case(res(vec![cb(inside(), Some(0.2))], ExtraLook::Judged, ExtraLook::Judged)),                              // centre only (points inside τ): new
        case(res(vec![cb(vec![("S".into(), Some(0.0)), ("N".into(), Some(0.3))], Some(0.2))], ExtraLook::Judged, ExtraLook::Judged)), // centre and an edge
        case(res(vec![cb(vec![("N".into(), None)], None)], ExtraLook::TooFew, ExtraLook::TooFew)),                  // off the film: an edge
        case(res(vec![Reason::Shape { named: vec![] }, Reason::Size { factor: 2.0 }], ExtraLook::Judged, ExtraLook::Judged)),
        case(res(vec![Reason::Mirrored, Reason::Facing], ExtraLook::NotSetUp, ExtraLook::Judged)),
        case(res(vec![Reason::NoCephFound], ExtraLook::TooFew, ExtraLook::TooFew)),
        case(res(vec![], ExtraLook::Judged, ExtraLook::Judged)),
    ];
    let refs: Vec<&Case> = cases.iter().collect();
    let l = looks("SYNTHETIC", &refs, &tau);
    eprintln!("{l:?}");
    assert_eq!((l.cases, l.flagged, l.mirrored, l.shape, l.region, l.size, l.centre, l.facing, l.no_ceph_found), (8, 7, 1, 1, 2, 2, 2, 1, 1));
    assert_eq!(l.only_new, 2, "the size-only and the centre-only cases");
    assert_eq!((l.size_not_judged, l.centre_not_judged), (3, 2), "too-few and not-set-up both count as not judged");
}

fn named_reference(extra: usize) -> Reference {
    let p = prior();
    let mut names: Vec<String> = p.names.iter().map(|n| format!("ceph400:{n}")).collect();
    let mut tracings = p.tracings.clone();
    for (i, t) in faces(extra, 98).into_iter().enumerate() { names.push(format!("aariz:tr-{:04}", i + 1)); tracings.push(t); }
    Reference { sha256: "SYNTHETIC".into(), names, tracings, lines: vec![] }
}

/// Each Test1 fold's scorer leaves out exactly that fold's `ceph400:` names; Aariz uses the whole reference; a Test1 film
/// judged by a reference that keeps its own `ceph400:` name is refused (fails if: the guard compares bare ids, M16); a
/// fold naming a film the reference does not hold is an error naming it (M17).
#[test] fn scorers_leave_out_each_fold_by_its_prefixed_names() {
    let r = named_reference(5);
    let folds = vec![ids(151..=152), ids(153..=154), ids(155..=156), ids(157..=158), ids(159..=160)];
    let (s, secs) = Scorers::new(&r, &folds).unwrap();
    eprintln!("five fold scorers fitted cold in {secs:.1} s");
    assert!(secs >= 0.0);
    for (k, f) in folds.iter().enumerate() {
        assert_eq!(s.folds[k].films(), 305 - 2);
        assert!(f.iter().all(|id| !s.folds[k].names().contains(&format!("ceph400:{id}"))), "fold {k}");
        assert_eq!(s.folds[k].cached_line_sets(), vec![(0..19).collect::<Vec<_>>()], "fold {k}'s all-19 line fitted ahead");
    }
    assert_eq!(s.all.films(), 305);
    let pts = r.tracings[150].clone();
    let fl = Film { id: "151".into(), dataset: Dataset::Ceph400, fold: Some(0), regions: sc1_1a::tests::own(&pts), pts, w: 2000, h: 2400, mm_per_px: Some(0.1) };
    assert!(std::ptr::eq(s.of(&fl), &s.folds[0]));
    let tau = RegionTau(TAU3);
    assert!(sc1_1a::check_with(&fl, &fl.pts, s.of(&fl), &FilmCal::tau_only(&tau)).is_ok());
    let e = sc1_1a::check_with(&fl, &fl.pts, &s.all, &FilmCal::tau_only(&tau)).unwrap_err().to_string();
    eprintln!("Test1 film 151 judged by the whole reference: {e}");
    assert!(e.contains("homework") && e.contains("ceph400:151"), "{e}");
    let az = Film { id: "va-0001".into(), dataset: Dataset::Aariz, fold: None, ..fl.clone() };
    assert!(std::ptr::eq(s.of(&az), &s.all));
    let mut bad = folds.clone();
    bad[2][0] = "301".into();
    let e = Scorers::new(&r, &bad).err().unwrap().to_string();
    eprintln!("a fold naming 301: {e}");
    assert!(e.contains("ceph400:301"), "{e}");
}

// ---- the run on SYNTHETIC folders ----

/// SC1-1a's SYNTHETIC folders plus everything whole-film/2 needs: gate /2's calibration kept as calibration-2.json, gate
/// /3's report and calibration in force, a size and a centre calibration fitted to the SYNTHETIC films, the SYNTHETIC
/// 300-tracing file as the /1 reference, a 305-tracing `whole-film-reference/1` file named ceph400:NNN and aariz:<id>, SC1-1a's
/// own SYNTHETIC report (the v1 fixture) as sc1-1a.json, and a centre calibration report; the pins of all of them.
pub(crate) struct Dx { pub(crate) s: Sx, pub(crate) pins: DevPins }
impl Dx {
    fn run(&self) -> i32 { run_with(&self.s.ceph400, &self.s.aariz, &self.s.models, &self.s.out, &self.s.git, &self.pins, &self.s.marks, &self.s.finder).unwrap() }
    fn report(&self) -> PathBuf { self.s.out.join(REPORT) }
}
fn synthetic_line(r: &Reference) -> f64 {
    static L: OnceLock<f64> = OnceLock::new();
    *L.get_or_init(|| WholeScorer::from_reference(r).unwrap().line_for(&(0..19).collect::<Vec<_>>()).unwrap())
}
pub(crate) fn dx() -> Dx {
    let s = sx();
    let (models, out) = (s.models.clone(), s.out.clone());
    let cal2 = std::fs::read(ceph_model::wholefilm::calibration_path(&models)).unwrap();
    std::fs::write(models.join("regions").join("calibration-2.json"), &cal2).unwrap();
    let gate3 = gate_json("sc1-box-gate/3", "pass", true, FP, 0.5, TAU3);
    std::fs::write(out.join("box-gate-3.json"), &gate3).unwrap();
    let g3 = ft_common::sha256_hex(&gate3);
    std::fs::write(ceph_model::wholefilm::calibration_path(&models), cal(Some("sc1-box-gate/3"), TAU3, 0.5, FP, &g3)).unwrap();
    // The size and centre calibrations, fitted to the stand-in films (each film's own teaching boxes).
    let four: Vec<Region> = REGIONS.into_iter().filter(|r| *r != Region::SoftTissue).collect();
    let films: Vec<(Vec<Pt>, ceph_model::wholefilm::Regions)> = s.finder.gt.values().map(|p| (p.clone(), sc1_1a::tests::own(p))).collect();
    let marks = |p: &[Pt]| sc1_1a::marks_of(p);
    let qs: Vec<f64> = films.iter().map(|(p, r)| size_score(&points_of(&marks(p), false, 2000).unwrap(), r, &four).unwrap().1).collect();
    let centre = qs.iter().sum::<f64>() / qs.len() as f64;
    let line = (qs.iter().map(|q| (q - centre).abs()).fold(0.0, f64::max) * 100.0).ceil() / 100.0 + 0.05;
    let cb_report = serde_json::to_vec_pretty(&serde_json::json!({"version": CB_RULE, "perSet": [
        {"set": "holdout", "median": [-0.04, 0.01]}, {"set": "ceph400Train", "median": [-0.04, -0.01]},
        {"set": "ceph400Test1", "median": [-0.04, -0.01]}, {"set": "aarizValid", "median": [-0.05, 0.02]}]})).unwrap();
    std::fs::write(out.join("cb-centre-calibration.json"), &cb_report).unwrap();
    let cbs = ft_common::sha256_hex(&cb_report);
    let size_sha = "5".repeat(64);
    let sc = SizeCalibration { version: SIZE_CALIBRATION_VERSION.into(), rule: SIZE_RULE.into(), detector_fingerprint: FP.into(), uses: four.clone(),
        refs: vec![SizeRef { regions: four.clone(), centre, line }], report_sha256: size_sha.clone() };
    std::fs::write(size_calibration_path(&models), serde_json::to_string_pretty(&sc).unwrap()).unwrap();
    let os: Vec<(f64, f64)> = films.iter().map(|(p, r)| cb_offset(&points_of(&marks(p), false, 2000).unwrap(), r, false).unwrap()).collect();
    let mut xs: Vec<f64> = os.iter().map(|o| o.0).collect(); xs.sort_by(f64::total_cmp);
    let mut ys: Vec<f64> = os.iter().map(|o| o.1).collect(); ys.sort_by(f64::total_cmp);
    let c = CbCalibration { version: CB_CALIBRATION_VERSION.into(), rule: CB_RULE.into(), detector_fingerprint: FP.into(), median: (xs[xs.len() / 2], ys[ys.len() / 2]),
        line: 0.06, report_sha256: cbs.clone(), ruling: None };
    std::fs::write(cb_calibration_path(&models), serde_json::to_string_pretty(&c).unwrap()).unwrap();
    // The 1,000-tracing file's SYNTHETIC stand-in: 300 ceph400:NNN and 5 aariz:<id> (Aariz train, never valid).
    let r = named_reference(5);
    let l = synthetic_line(&r);
    let lines: Vec<(Vec<usize>, f64)> = ceph_model::wholefilm::stored_line_sets().into_iter().map(|set| (set, l)).collect();
    let text = reference_json(&r.names, &r.tracings, &lines).unwrap();
    std::fs::write(reference_path(&models), &text).unwrap();
    let fixture = include_str!("fixtures/sc1-1a-synthetic-v1.json");
    std::fs::write(out.join(sc1_1a::REPORT), fixture).unwrap();
    let prior_bytes = std::fs::read(ceph_model::pointcheck::prior_path(&models)).unwrap();
    let mut git = s.git.clone();
    git.prereg_at_head = Some(PREREG.as_bytes().to_vec());
    let pins = DevPins { sc1a: s.pins.clone(), fingerprint: FP.into(), gate3: g3, size: size_sha, cb: cbs, reference: ft_common::sha256_hex(text.as_bytes()),
        prior: ft_common::sha256_hex(&prior_bytes), sc1a_report: ft_common::sha256_hex(fixture.as_bytes()), gate4: None, centre: None, decompose: None };
    Dx { s: Sx { git, ..s }, pins }
}
/// The one full SYNTHETIC run, shared: its exit code and its report.
fn good_run() -> &'static (i32, serde_json::Value, Vec<String>) {
    static R: OnceLock<(i32, serde_json::Value, Vec<String>)> = OnceLock::new();
    R.get_or_init(|| {
        let d = dx();
        let t = std::time::Instant::now();
        let code = d.run();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.report()).unwrap()).unwrap();
        eprintln!("SYNTHETIC development run: exit {code} in {:.1} s", t.elapsed().as_secs_f64());
        let lines: Vec<String> = v["summary"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect();
        for l in &lines { eprintln!("  {l}"); }
        (code, v, lines)
    })
}

/// The /1 column is SC1-1a's SYNTHETIC run exactly: its counts equal the v1 fixture's field for field (fails if: the /1
/// column reads τ /3, the 1,000 reference, or the size or centre look). The positive control P0 holds on it.
#[test] fn the_v1_column_reproduces_sc1_1as_synthetic_run() {
    let (code, v, _) = good_run();
    let fx: serde_json::Value = serde_json::from_str(include_str!("fixtures/sc1-1a-synthetic-v1.json")).unwrap();
    assert_eq!(v["v1"]["counts"], fx["counts"], "the /1 column's counts are SC1-1a's");
    let p0 = v["controls"].as_array().unwrap().iter().find(|c| c["name"] == "P0").unwrap();
    assert_eq!(p0["holds"], true, "{p0}");
    assert!(*code == 0 || *code == 3, "{code}");
}
/// The header carries the disclosure words; every count is SC1-1a's marks'; the /2 column judged every plant with its
/// own reference and calibrations (the size and centre looks judged); the centre sensitivity has three rows, the
/// calibrated one equal to the main counts; the Clopper-Pearson intervals are printed; the fold-fit time printed. Fails
/// if any part of the run is skipped.
#[test] fn the_run_prints_both_columns_the_sensitivity_and_the_disclosure() {
    let (code, v, lines) = good_run();
    assert!(lines[0].contains(HEADER), "{}", lines[0]);
    assert!(lines.iter().any(|l| l.contains("POOLED") && l.contains("95%")));
    assert_eq!((v["v2"]["counts"]["planted"].as_u64(), v["v2"]["counts"]["normal"].as_u64()), (Some(175), Some(20)));
    let n2 = v["v2"]["normalLooks"].as_array().unwrap();
    assert_eq!(n2.len(), 2);
    let judged = |k: &str| n2.iter().map(|l| l["cases"].as_u64().unwrap() - l[k].as_u64().unwrap()).sum::<u64>();
    assert_eq!((judged("sizeNotJudged"), judged("centreNotJudged")), (20, 20), "every untouched SYNTHETIC tracing judged by both new looks");
    let sens = v["sensitivity"].as_array().unwrap();
    assert_eq!(sens.iter().map(|r| r["line"].as_f64().unwrap()).collect::<Vec<_>>(), CENTRE_LINES.to_vec());
    assert_eq!((sens[0]["caught"].clone(), sens[0]["falseAlarms"].clone()), (v["v2"]["counts"]["caught"].clone(), v["v2"]["counts"]["falseAlarms"].clone()));
    // The rows really re-judge at their line (fails if: the sensitivity reuses the calibrated centre line): on the
    // SYNTHETIC films the centre flags on planted tracings fall as the line rises.
    let cfp: Vec<u64> = sens.iter().map(|r| r["centreFlagsPlanted"].as_u64().unwrap()).collect();
    eprintln!("centre flags on planted tracings at 0.06 / 0.08 / 0.10: {cfp:?}");
    assert!(cfp[0] >= cfp[1] && cfp[1] >= cfp[2] && cfp[0] > cfp[2], "{cfp:?}");
    assert!(v["foldWarmSeconds"].as_f64().unwrap() >= 0.0);
    assert_eq!(v["centreMedians"].as_array().unwrap().len(), 6, "two from this run, four from the calibration report");
    assert!(v["controls"].as_array().unwrap().iter().all(|c| c["holds"] == true), "{}", v["controls"]);
    let c2 = v["v2"]["counts"]["caught"].as_u64().unwrap() as usize;
    let f2 = v["v2"]["counts"]["falseAlarms"].as_u64().unwrap() as usize;
    let m = Marks::for_films(10, 10, 5);
    assert_eq!(*code, stop_exit(c2, f2, &m), "the exit is the stop rule's on the /2 column");
    assert_eq!(v["v2"]["caughtCi"].as_array().unwrap().len(), 2);
}

/// Broken, nothing judged and nothing written, on each guard; the message is the guard's own. Fails if: both columns read
/// calibration.json (then the swapped files are not refused), a missing file is not named, or a pin is not compared.
#[test] fn the_run_is_broken_on_each_guard() {
    let d = dx();
    let regions = d.s.models.join("regions");
    let c2 = std::fs::read(regions.join("calibration-2.json")).unwrap();
    let c3 = std::fs::read(regions.join("calibration.json")).unwrap();
    let check = |d: &Dx, what: &str, says: &str| {
        let e = match dev_run(&d.s.ceph400, &d.s.aariz, &d.s.models, &d.s.out, &d.s.git, &d.pins, &d.s.marks, &d.s.finder) { Err(e) => format!("{e:#}"), Ok(_) => "no error".into() };
        let code = d.run();
        eprintln!("{what}: exit {code}; report {}; {e}", d.report().exists());
        assert_eq!((code, d.report().exists()), (1, false), "{what}");
        assert!(e.contains(says), "{what}: the guard's own message ({says:?}), not another's: {e}");
    };
    std::fs::remove_file(regions.join("calibration-2.json")).unwrap();
    check(&d, "calibration-2.json missing", "calibration-2.json");
    std::fs::write(regions.join("calibration-2.json"), &c3).unwrap();
    check(&d, "gate /3's calibration as calibration-2.json", "sc1-box-gate/2");
    std::fs::write(regions.join("calibration-2.json"), &c2).unwrap();
    std::fs::write(regions.join("calibration.json"), &c2).unwrap();
    check(&d, "gate /2's calibration in force", "sc1-box-gate/3");
    std::fs::write(regions.join("calibration.json"), &c3).unwrap();
    let rp = reference_path(&d.s.models);
    let rtext = std::fs::read(&rp).unwrap();
    std::fs::remove_file(&rp).unwrap();
    check(&d, "the 1,000-tracing reference missing", "whole-film-reference-v1.shape");
    std::fs::write(&rp, &rtext).unwrap();
    let mut p = d.pins.clone();
    for (what, f, says) in [("reference", 0, "reference"), ("size", 1, "size"), ("centre", 2, "centre"), ("SC1-1a report", 3, "SC1-1a"), ("prior", 4, "300-tracing")] {
        let mut q = d.pins.clone();
        match f { 0 => q.reference = "0".repeat(64), 1 => q.size = "0".repeat(64), 2 => q.cb = "0".repeat(64), 3 => q.sc1a_report = "0".repeat(64), _ => q.prior = "0".repeat(64) }
        let dd = Dx { s: Sx { ..clone_sx(&d.s) }, pins: q };
        check(&dd, &format!("the {what} pin differs"), says);
    }
    p.gate3 = "0".repeat(64);
    check(&Dx { s: clone_sx(&d.s), pins: p }, "the gate /3 pin differs", "gate");
    let mut g = clone_sx(&d.s);
    g.git.dirty = true;
    check(&Dx { s: g, pins: d.pins.clone() }, "a dirty tree", "clean tree");
    let mut g = clone_sx(&d.s);
    g.git.prereg_at_head = None;
    check(&Dx { s: g, pins: d.pins.clone() }, "not committed", "not committed");
}
fn clone_sx(s: &Sx) -> Sx {
    Sx { _d: tempfile::tempdir().unwrap(), ceph400: s.ceph400.clone(), aariz: s.aariz.clone(), models: s.models.clone(), out: s.out.clone(), git: s.git.clone(),
        pins: s.pins.clone(), marks: s.marks, finder: crate::sc1_1a::tests::StandIn { gt: s.finder.gt.clone(), calls: std::sync::Mutex::new(0), skip: None } }
}

/// The positive control P0 can fail: an SC1-1a report whose counts differ from the /1 column's (its pin updated to match
/// the altered file) makes the run broken (exit 1), with the report still written. Fails if: P0 compares nothing.
#[test] fn p0_fails_when_the_v1_column_is_not_sc1_1as() {
    let mut d = dx();
    let mut fx: serde_json::Value = serde_json::from_str(include_str!("fixtures/sc1-1a-synthetic-v1.json")).unwrap();
    fx["counts"]["caught"] = 174.into();
    let text = serde_json::to_string_pretty(&fx).unwrap() + "\n";
    std::fs::write(d.s.out.join(sc1_1a::REPORT), &text).unwrap();
    d.pins.sc1a_report = ft_common::sha256_hex(text.as_bytes());
    let code = d.run();
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.report()).unwrap()).unwrap();
    let p0 = v["controls"].as_array().unwrap().iter().find(|c| c["name"] == "P0").unwrap().clone();
    eprintln!("P0 against an altered SC1-1a report: exit {code}; {p0}");
    assert_eq!((code, p0["holds"].clone()), (1, serde_json::Value::Bool(false)));
}

// ---- the P4 loss decomposition (information; owner "Find the cause first", 5 Nov 2026) ----

/// The five configurations, in the owner's order, each τ and reference as named. Fails if: the last row swaps more or
/// fewer than the maxilla and mandible, or a row's τ or reference is another's.
#[test] fn decompose_configs_are_the_five() {
    let (t2, t3) = (TAU2, TAU3);
    let c = decompose_configs(t2, t3);
    for (n, t, r) in &c { eprintln!("{n}: {t:?} {r:?}"); }
    assert_eq!(c.len(), 5);
    assert_eq!((c[0].1, c[0].2), (t3, RefKind::Thousand));
    assert_eq!((c[1].1, c[1].2), (t2, RefKind::Thousand));
    assert_eq!((c[2].1, c[2].2), (t3, RefKind::ThreeHundred));
    assert_eq!((c[3].1, c[3].2), (t2, RefKind::ThreeHundred));
    assert_eq!((c[4].1, c[4].2), ([t3[0], t2[1], t2[2], t3[3], t3[4]], RefKind::Thousand));
    assert!(c[0].0.contains("as calibrated") && c[4].0.contains("maxilla and mandible"));
}
/// The 300-tracing scorers are SC1-1a's shape look exactly: each fold leaves out its bare ids, and every line equals
/// `sc1_1a::Refs`' bit for bit (fails if: a fold is not left out, or the whole file's line is not fitted).
#[test] fn scorers_from_prior_are_sc1_1as_shape_look() {
    let folds = vec![ids(151..=152), ids(153..=154), ids(155..=156), ids(157..=158), ids(159..=160)];
    let (s, secs) = Scorers::from_prior(prior(), &folds).unwrap();
    let refs = sc1_1a::Refs::new(prior(), &folds).unwrap();
    let all19: Vec<usize> = (0..19).collect();
    eprintln!("300-tracing scorers fitted in {secs:.1} s");
    for (k, f) in folds.iter().enumerate() {
        assert!(f.iter().all(|id| !s.folds[k].names().contains(id)), "fold {k}");
        assert_eq!(s.folds[k].films(), 298);
        assert_eq!(s.folds[k].line_for(&all19).unwrap().to_bits(), refs.folds[k].whole.line_for(&all19).unwrap().to_bits(), "fold {k}");
    }
    assert_eq!(s.all.films(), 300);
    assert_eq!(s.all.cached_line_sets(), vec![all19.clone()], "the whole file's line fitted ahead");
    assert_eq!(s.all.line_for(&all19).unwrap().to_bits(), refs.all.whole.line_for(&all19).unwrap().to_bits());
}
/// The decomposition on the SYNTHETIC folders: five rows, P4 per region and untouched by look in each; its control
/// holds (row 1 equals the development run's /2 counts) and it can fail (the development report altered: exit 1, the
/// report still written). Fails if: a row ignores its τ or reference, or the control compares nothing.
#[test] fn the_decomposition_prints_five_rows_and_checks_row_one() {
    let d = dx();
    assert_eq!(d.run() == 0 || d.run() == 3, true);
    let code = decompose_with(&d.s.ceph400, &d.s.aariz, &d.s.models, &d.s.out, &d.s.git, &d.pins, &d.s.marks, &d.s.finder).unwrap();
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.s.out.join(DECOMPOSE_REPORT)).unwrap()).unwrap();
    for l in v["summary"].as_array().unwrap() { eprintln!("  {}", l.as_str().unwrap()); }
    assert_eq!(code, 0);
    let rows = v["rows"].as_array().unwrap();
    assert_eq!(rows.len(), 5);
    for r in rows {
        assert_eq!(r["p4"].as_array().unwrap().len(), 5);
        assert!(r["p4"].as_array().unwrap().iter().all(|l| l["cases"] == 15));
        assert_eq!((r["planted"].as_u64(), r["normal"].as_u64(), r["untouchedBySet"].as_array().unwrap().len()), (Some(175), Some(20), 2));
    }
    let dev: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.report()).unwrap()).unwrap();
    assert_eq!((rows[0]["caught"].clone(), rows[0]["falseAlarms"].clone()), (dev["v2"]["counts"]["caught"].clone(), dev["v2"]["counts"]["falseAlarms"].clone()));
    assert_eq!(v["control"]["holds"], true);
    // A row really uses its τ: on the SYNTHETIC films gate /2's tighter maxilla and mandible flag more region edges in
    // P4 mandible than gate /3's (fails if: every row is judged at the calibrated τ).
    let md = |r: &serde_json::Value| r["p4"].as_array().unwrap().iter().find(|l| l["label"].as_str().unwrap().contains("mandible")).unwrap()["region"].as_u64().unwrap();
    eprintln!("P4 mandible region edges: /3 {} /2 {}", md(&rows[0]), md(&rows[1]));
    assert!(md(&rows[1]) > md(&rows[0]));
    let mut dv = dev.clone();
    dv["v2"]["counts"]["caught"] = (dev["v2"]["counts"]["caught"].as_u64().unwrap() - 1).into();
    std::fs::write(d.report(), serde_json::to_string_pretty(&dv).unwrap()).unwrap();
    let code = decompose_with(&d.s.ceph400, &d.s.aariz, &d.s.models, &d.s.out, &d.s.git, &d.pins, &d.s.marks, &d.s.finder).unwrap();
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.s.out.join(DECOMPOSE_REPORT)).unwrap()).unwrap();
    eprintln!("the development report altered: exit {code}; control {}", v["control"]);
    assert_eq!((code, v["control"]["holds"].clone()), (1, serde_json::Value::Bool(false)));
}

// ---- whole-film/3's confirmation run (owner ruling, 5 Nov 2026, spec §17.15) ----

/// The confirmation run's pre-registration SHA-256, pinned when it was committed alone (249830d, before any code or run).
const PINNED3_SHA256: &str = "39761e77540ee2835ddf0cf8b642be325fbdccf972c501fdfd6c0598d778d3ac";
/// Fails if: the file changes by a byte. Its plants and definitions are SC1-1a's verbatim, its header the disclosure
/// words, its marks SC1-1a's; its pins are the development run's plus the two ruling records and the decomposition.
#[test] fn the_dev3_preregistration_is_pinned_and_its_pins_parse() {
    assert_eq!(ft_common::sha256_hex(PREREG3.as_bytes()), PINNED3_SHA256);
    let v: serde_json::Value = serde_json::from_str(PREREG3).unwrap();
    let a: serde_json::Value = serde_json::from_str(sc1_1a::PREREG).unwrap();
    assert_eq!((v["version"].as_str(), v["header"].as_str()), (Some(VERSION3), Some(HEADER)));
    assert_eq!((&v["plants"], &v["definitions"]), (&a["plants"], &a["definitions"]), "SC1-1a's plants, verbatim");
    assert_eq!((v["marks"]["needed"].as_u64(), v["marks"]["falseAlarmMax"].as_u64()), (Some(2603), Some(6)));
    let (d, d3) = (DevPins::from_prereg().unwrap(), DevPins::from_text(PREREG3).unwrap());
    eprintln!("{d3:?}");
    assert_eq!((d.gate4.as_deref(), d.centre.as_deref(), d.decompose.as_deref()), (None, None, None));
    assert_eq!(d3.gate4.as_deref(), Some("ca3b3ecfa7a59c7cbfa23c4342b9a34ca1aa01d1625a0acf14f5f592be757cb6"));
    assert_eq!(d3.centre.as_deref(), Some("463ef936923682085f4a979e4aa0e394fa554b732dcd28a4aa09cb8d753300b5"));
    assert_eq!(d3.decompose.as_deref(), Some("45ea63ca5bdcb557701c1d082af7d9e28b36213f9e9adfa01995b11b8a4f3b81"));
    assert_eq!(DevPins { gate4: None, centre: None, decompose: None, ..d3 }, d, "every other pin is the development run's");
}

/// The SYNTHETIC folders after the development run and its decomposition, with whole-film/3 set up by `sc1_wf3::setup_with`
/// (SYNTHETIC records: the real numbers, the stand-in hashes), and the confirmation run's pins.
fn dx3() -> (Dx, DevPins) {
    let d = dx();
    let _ = d.run();
    assert_eq!(decompose_with(&d.s.ceph400, &d.s.aariz, &d.s.models, &d.s.out, &d.s.git, &d.pins, &d.s.marks, &d.s.finder).unwrap(), 0);
    let g3 = ceph_model::wholefilm::parse_calibration(&std::fs::read(ceph_model::wholefilm::calibration_path(&d.s.models)).unwrap()).unwrap().gate_report_sha256;
    let r = crate::sc1_wf3::Records { from_gate3: g3, measured_report: d.pins.cb.clone(), gate4_sha: "4".repeat(64), centre_sha: "8".repeat(64), ..crate::sc1_wf3::records().unwrap() };
    let git = crate::sc1_wf3::RecordsGit { gate4_at_head: Some(crate::sc1_wf3::GATE4_RECORD.as_bytes().to_vec()), centre_at_head: Some(crate::sc1_wf3::CENTRE_RECORD.as_bytes().to_vec()), dirty: false };
    for l in crate::sc1_wf3::setup_with(&d.s.models, &r, &git).unwrap() { eprintln!("setup: {l}"); }
    let dec = std::fs::read(d.s.out.join(DECOMPOSE_REPORT)).unwrap();
    let p3 = DevPins { gate4: Some(r.gate4_sha.clone()), centre: Some(r.centre_sha.clone()), decompose: Some(ft_common::sha256_hex(&dec)), ..d.pins.clone() };
    let mut g = d.s.git.clone();
    g.prereg_at_head = Some(PREREG3.as_bytes().to_vec());
    let pins = d.pins.clone();
    (Dx { s: Sx { git: g, ..d.s }, pins }, p3)
}
fn run3(d: &Dx, p: &DevPins) -> i32 { run3_with(&d.s.ceph400, &d.s.aariz, &d.s.models, &d.s.out, &d.s.git, p, &d.s.marks, &d.s.finder).unwrap() }

/// The confirmation run on the SYNTHETIC folders: the /1 column is still SC1-1a's (P0); the whole-film/3 column judges
/// with gate /4's τ and the centre at 0.08 (its rule printed as whole-film/3); its 0.06 sensitivity row reproduces the
/// decomposition's row 2 (control row2); every control holds and the exit is the stop rule's. Fails if: the column reads
/// gate /3's τ or the measured centre line, or the row-2 control compares nothing.
#[test] fn the_confirmation_run_judges_by_whole_film_3_and_reproduces_row_2() {
    let (d, p3) = dx3();
    let code = run3(&d, &p3);
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.s.out.join(REPORT3)).unwrap()).unwrap();
    for l in v["summary"].as_array().unwrap() { eprintln!("  {}", l.as_str().unwrap()); }
    let fx: serde_json::Value = serde_json::from_str(include_str!("fixtures/sc1-1a-synthetic-v1.json")).unwrap();
    assert_eq!(v["v1"]["counts"], fx["counts"]);
    assert_eq!((v["v2Rule"].as_str(), v["centreLine"].as_f64()), (Some("whole-film/3"), Some(0.08)));
    assert_eq!(v["tau3"].as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect::<Vec<_>>(), vec![0.09, 0.02, 0.02, 0.01, 0.10]);
    let row2 = v["controls"].as_array().unwrap().iter().find(|c| c["name"] == "row2").cloned().unwrap();
    eprintln!("row2: {row2}");
    assert_eq!(row2["holds"], true);
    assert!(v["controls"].as_array().unwrap().iter().all(|c| c["holds"] == true), "{}", v["controls"]);
    let c = v["v2"]["counts"]["caught"].as_u64().unwrap() as usize;
    let f = v["v2"]["counts"]["falseAlarms"].as_u64().unwrap() as usize;
    assert_eq!(code, stop_exit(c, f, &d.s.marks));
    // The row-2 control can fail: the decomposition report altered (its pin updated): broken, exit 1, report written.
    let mut dec: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.s.out.join(DECOMPOSE_REPORT)).unwrap()).unwrap();
    dec["rows"][1]["caught"] = (dec["rows"][1]["caught"].as_u64().unwrap() + 1).into();
    let t = serde_json::to_string_pretty(&dec).unwrap();
    std::fs::write(d.s.out.join(DECOMPOSE_REPORT), &t).unwrap();
    let code = run3(&d, &DevPins { decompose: Some(ft_common::sha256_hex(t.as_bytes())), ..p3.clone() });
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(d.s.out.join(REPORT3)).unwrap()).unwrap();
    let row2 = v["controls"].as_array().unwrap().iter().find(|c| c["name"] == "row2").cloned().unwrap();
    eprintln!("the decomposition altered: exit {code}; {row2}");
    assert_eq!((code, row2["holds"].clone()), (1, serde_json::Value::Bool(false)));
}
/// Broken, nothing written, before whole-film/3 is set up or with its files wrong: gate /3's calibration in force; the
/// measured (unruled) centre file in force; the gate /4 or centre record pin differing; the decomposition pin differing.
/// Fails if: the column accepts a /3 calibration or a measured centre, or a pin is not compared.
#[test] fn the_confirmation_run_refuses_what_is_not_whole_film_3() {
    let (d, p3) = dx3();
    let reg = d.s.models.join("regions");
    let (c4, cb) = (std::fs::read(reg.join("calibration.json")).unwrap(), std::fs::read(reg.join("cb-centre-calibration.json")).unwrap());
    let refused = |what: &str, p: &DevPins, says: &str| {
        let _ = std::fs::remove_file(d.s.out.join(REPORT3));
        let code = run3(&d, p);
        let e = match dev_run_spec(&DEV3, &d.s.ceph400, &d.s.aariz, &d.s.models, &d.s.out, &d.s.git, p, &d.s.marks, &d.s.finder) { Err(e) => format!("{e:#}"), Ok(_) => "no error".into() };
        eprintln!("{what}: exit {code}; {e}");
        assert_eq!((code, d.s.out.join(REPORT3).exists()), (1, false), "{what}");
        assert!(e.contains(says), "{what}: {e}");
    };
    std::fs::write(reg.join("calibration.json"), std::fs::read(reg.join("calibration-3.json")).unwrap()).unwrap();
    refused("gate /3's calibration in force", &p3, "sc1-box-gate/4");
    std::fs::write(reg.join("calibration.json"), &c4).unwrap();
    std::fs::write(reg.join("cb-centre-calibration.json"), std::fs::read(reg.join("cb-centre-calibration-1.json")).unwrap()).unwrap();
    refused("the measured centre file in force", &p3, "ruling");
    std::fs::write(reg.join("cb-centre-calibration.json"), &cb).unwrap();
    refused("the gate /4 pin differs", &DevPins { gate4: Some("0".repeat(64)), ..p3.clone() }, "gate /4");
    refused("the centre ruling pin differs", &DevPins { centre: Some("0".repeat(64)), ..p3.clone() }, "ruling");
    refused("the decomposition pin differs", &DevPins { decompose: Some("0".repeat(64)), ..p3.clone() }, "decomposition");
    // The development run (whole-film/2) still runs after the setup: it reads gate /3's and the measured files kept beside.
    let mut g = d.s.git.clone();
    g.prereg_at_head = Some(PREREG.as_bytes().to_vec());
    let dev = Dx { s: Sx { git: g, ..clone_sx(&d.s) }, pins: d.pins.clone() };
    let code = dev.run();
    eprintln!("the development run after the setup: exit {code}");
    assert!(code == 0 || code == 3, "the development run reads the kept files");
}

#[allow(dead_code)]
fn unused(_: (&[Pt], CbVerdict, [f64; 5], &[&str])) { let _ = (TAU2, ORDER); }
