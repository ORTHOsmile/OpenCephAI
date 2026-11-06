//! SC1-1b-PKU's tests (SYNTHETIC faces and folders only; never data/ or models/). Each test names the production change
//! that would make it fail.
use super::*;
use crate::sc1_1a::tests::{gate_json, prior, FP, H, TAU2, W};
use ceph_infer::regions::{Found, FoundBox};
use ceph_model::pointcheck::ORDER;
use ceph_model::wholefilm::{cb_offset, points_of, reference_json, reference_path, size_calibration_path, size_score, teaching_boxes, CbCalibration, CbRuling, SizeCalibration,
    SizeRef, CB_CALIBRATION_VERSION, CB_RULE, SIZE_CALIBRATION_VERSION, SIZE_RULE};
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};

/// The pre-registration's SHA-256, pinned when it was committed alone: first 2cd3d1f, then amended alone at 0dadeee (the
/// owner's three bands for the switch, 6 Nov 2026), before any sc1_1b_pku code was committed or PKU was opened.
const PINNED_SHA256: &str = "02366f72299362f8b5ab296abd9035ef0fd23643ceb3fa626d32a76f08222d9f";

// ---- the pre-registration and the marks ----

/// Fails if: the pre-registration changes by a byte after it was committed alone.
#[test] fn the_preregistration_is_pinned() {
    assert_eq!(ft_common::sha256_hex(PREREG.as_bytes()), PINNED_SHA256);
}
/// Every value is filled (fails if: a `null` is left in the file), and the pins the program reads are the file's and the
/// owner's rulings: whole-film/3, gate /4's record and tau, the centre ruling and line 0.08, the 1,000-tracing reference
/// and its line, the size uses, the scale 0.125, the seed, the marks. Fails if a pin is read from the wrong key.
#[test] fn the_preregistration_has_no_null_and_pins_whole_film_3() {
    fn no_null(v: &serde_json::Value, at: &str) {
        match v {
            serde_json::Value::Null => panic!("null at {at}"),
            serde_json::Value::Object(m) => for (k, x) in m { no_null(x, &format!("{at}.{k}")) },
            serde_json::Value::Array(a) => for (i, x) in a.iter().enumerate() { no_null(x, &format!("{at}[{i}]")) },
            serde_json::Value::String(s) => assert!(!s.contains("PROVENANCE_SHA256"), "a placeholder at {at}"),
            _ => {}
        }
    }
    let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
    no_null(&v, "$");
    assert_eq!((v["version"].as_str(), v["rule"].as_str()), (Some(VERSION), Some("whole-film/3")));
    let p = Pins::from_prereg().unwrap();
    eprintln!("{p:?}");
    let r = crate::sc1_wf3::records().unwrap();
    assert_eq!(p.gate4, r.gate4_sha, "gate /4's record, by its SHA-256");
    assert_eq!(p.gate4, "ca3b3ecfa7a59c7cbfa23c4342b9a34ca1aa01d1625a0acf14f5f592be757cb6");
    assert_eq!(p.centre_ruling, r.centre_sha);
    assert_eq!(p.centre_ruling, "463ef936923682085f4a979e4aa0e394fa554b732dcd28a4aa09cb8d753300b5");
    assert_eq!((p.cb_line, p.cb_measured_line), (0.08, 0.06));
    assert_eq!((p.cb_line, p.cb_measured_line, p.cb_report.as_str()), (r.centre_line, r.measured_line, r.measured_report.as_str()));
    assert_eq!(p.tau, r.tau);
    assert_eq!(p.tau, TAU2, "gate /4's tau are gate /2's");
    assert_eq!(p.reference, "6f0f066aeedde5eb329800595c29fb082b56ec6092f8782fc8653d0a1b4a81bd");
    assert_eq!(p.line19, 95.9);
    assert_eq!(p.fingerprint, FP);
    assert_eq!(p.gate2_report, "db1a67a0a1761ad5463ba64ff338be00423a3ae73f097009b7ab091919f9eae7");
    assert_eq!(p.size_report, "836b8c341127026f0f8b27f7abe54fabfaa9da96b05a21e60d8bd2e872a91cab");
    assert_eq!(p.size_uses, vec![Region::CranialBase, Region::Maxilla, Region::Mandible, Region::Incisors]);
    assert_eq!(p.mm_per_px, crate::pku::PKU_MM_PER_PX);
    assert_eq!(p.mm_per_px, 0.125);
    assert_eq!(p.provenance.len(), 64);
    assert_eq!(v["plants"]["seed"].as_u64(), Some(SEED));
    assert_eq!((v["marks"]["planted"].as_u64(), v["marks"]["needed"].as_u64(), v["marks"]["normal"].as_u64(), v["marks"]["falseAlarmMax"].as_u64()),
        (Some(PLANTED as u64), Some(needed() as u64), Some(NORMAL as u64), Some(false_max() as u64)));
    let d: Vec<&str> = v["disclosure"].as_array().unwrap().iter().map(|x| x.as_str().unwrap()).collect();
    assert!(d.iter().any(|x| x.contains("THIRD tuning") && x.contains("2,643 of 2,740") && x.contains("5 of 300") && x.contains("in-sample")));
    assert!(d.iter().any(|x| x.contains("coin toss") && x.contains("1.7")));
    assert!(d.iter().any(|x| x.contains("+0.019") && x.contains("-0.006")));
    assert!(v["verdicts"]["brokenRerun"].as_str().unwrap().contains("it may be re-run only if no verdict line was printed"));
    let ships = &v["verdicts"]["ships"];
    assert!(ships["onBelowMarks"].as_str().unwrap().contains(">= 918 of 1020") && ships["onBelowMarks"].as_str().unwrap().contains("<= 5 of 102"));
    assert!(ships["reason"].as_str().unwrap().contains("still checks every point") && ships["noRetuning"].as_str().is_some());
    assert!(v["verdicts"]["laterIntent"].as_str().unwrap().contains("about 95%"));
    assert_eq!((Marks::real().ship_needed, Marks::real().ship_false_max), (918, 5), "the bands' numbers are the pre-registration's");
}
/// The switch's default (owner ruling, 6 Nov 2026), in integers at the real marks: PASS -> on, a pass; not PASS but >= 918
/// caught and <= 5 flagged -> on, below the marks with the shortfall; anything else -> off; no verdict (a control fails)
/// -> no band. Fails if: a band edge moves by one, `<`/`<=` swap, or the shortfall is not the exact count.
#[test] fn the_switch_follows_the_owners_three_bands() {
    let m = Marks::real();
    for (caught, flagged, holds, want, line) in [
        (969, 2, true, Some(Ships::OnPass), "ships: on, a pass"),
        (968, 2, true, Some(Ships::OnBelowMarks), "ships: on, below the pre-registered marks (1 catches short of 969; 0 false alarms over 2)"),
        (969, 3, true, Some(Ships::OnBelowMarks), "ships: on, below the pre-registered marks (0 catches short of 969; 1 false alarms over 2)"),
        (918, 5, true, Some(Ships::OnBelowMarks), "ships: on, below the pre-registered marks (51 catches short of 969; 3 false alarms over 2)"),
        (917, 0, true, Some(Ships::Off), "ships: off"),
        (1020, 6, true, Some(Ships::Off), "ships: off"),
        (918, 6, true, Some(Ships::Off), "ships: off"),
        (1020, 0, false, None, "ships: no band (no verdict): off, 'Not yet tested on new films.'"),
    ] {
        let v = PkuVerdict::of(caught, flagged, &m);
        let got = v.ships(&m, holds);
        eprintln!("{caught} caught, {flagged} flagged, controls hold {holds}: {got:?}; {}", v.ships_line(&m, holds));
        assert_eq!(got, want, "{caught}, {flagged}");
        assert!(v.ships_line(&m, holds).starts_with(line), "{}", v.ships_line(&m, holds));
    }
}
/// M21: the marks come from SC1-1a's integer rules, not a second copy. Fails if: PLANTED or NORMAL change, or
/// sc1_1a::needed_of / false_max_of change.
#[test] fn the_marks_come_from_sc1_1a_rules() {
    assert_eq!((needed(), false_max()), (969, 2));
    assert_eq!(PLANTED, 10 * NORMAL);
    assert_eq!(Marks::real(), Marks { films: 102, planted: 1020, needed: 969, normal: 102, false_max: 2, ship_needed: 918, ship_false_max: 5 });
    assert_eq!(Marks::for_films(10), Marks { films: 10, planted: 100, needed: 95, normal: 10, false_max: 0, ship_needed: 90, ship_false_max: 0 });
}
/// The verdict at its edges, in integers (M29). Fails if: `<=`/`<` swapped on either mark, a control failure is not
/// broken, or the marks line does not name which mark was missed.
#[test] fn the_verdict_names_each_mark_at_its_edges() {
    let m = Marks::real();
    for (caught, flagged, holds, want, exit, line) in [
        (969, 2, true, PASS, 0, "marks: catch met (969/1020, needed 969); false alarms met (2/102, at most 2)"),
        (968, 2, true, FAIL, 3, "marks: catch missed (968/1020, needed 969); false alarms met (2/102, at most 2)"),
        (1020, 3, true, FAIL, 3, "marks: catch met (1020/1020, needed 969); false alarms missed (3/102, at most 2)"),
        (900, 9, true, FAIL, 3, "marks: catch missed (900/1020, needed 969); false alarms missed (9/102, at most 2)"),
        (1020, 0, false, BROKEN, 1, "marks: catch met (1020/1020, needed 969); false alarms met (0/102, at most 2)"),
    ] {
        let v = PkuVerdict::of(caught, flagged, &m);
        eprintln!("{caught}, {flagged}, controls hold {holds}: {} exit {}; {}", v.verdict(holds), exit_code(v.verdict(holds)), v.marks_line(&m));
        assert_eq!((v.verdict(holds), exit_code(v.verdict(holds))), (want, exit));
        assert_eq!(v.marks_line(&m), line);
    }
    assert_eq!(exit_code(GATE_STOP), 4);
}

// ---- the seal (M19, M23) ----

fn git(prereg: Option<&str>, dirty: bool) -> Git { Git { prereg_at_head: prereg.map(|p| p.as_bytes().to_vec()), dirty, sha: "SYNTHETIC".into() } }

/// The seal opens only for this run (M19): not committed, committed but changed, a dirty tree, or a report already there
/// -> refused, each by its reason. Fails if `open_seal` drops any one of its three conditions.
#[test] fn the_seal_opens_only_for_this_run() {
    let d = tempfile::tempdir().unwrap();
    let out = d.path().join("reports").join("sc1");
    std::fs::create_dir_all(&out).unwrap();
    for (what, g, want) in [("not committed", git(None, false), "not committed"), ("changed at HEAD", git(Some("{}"), false), "differs"),
                            ("a dirty tree", git(Some(PREREG), true), "not clean")] {
        let e = open_seal(&g, &out).unwrap_err().to_string();
        eprintln!("{what}: {e}");
        assert!(e.contains(want) && e.contains("seal"), "{what}: {e}");
    }
    assert!(open_seal(&git(Some(PREREG), false), &out).is_ok(), "control: committed as built, clean, no report");
    std::fs::write(out.join(REPORT), "{}").unwrap();
    let e = open_seal(&git(Some(PREREG), false), &out).unwrap_err().to_string();
    eprintln!("a report already there: {e}");
    assert!(e.contains("already exists"), "{e}");
}
/// With the key, PKU test passes both gates and the box cache reads a PKU film; without it every gate refuses; Test2 and
/// Aariz test are refused with or without it; "all" is never opened by the key. Fails if: a key opens a held-back split,
/// `boxes_for` (no key) lets PKU through, or the key opens "all".
#[test] fn the_key_opens_pku_test_and_nothing_else() {
    let r = crate::sc1_gate::tests::rx(1.0, &[]);
    let engine = RegionEngine::load(&ceph_infer::regions::regions_manifest_path(&r.models)).unwrap();
    let d = tempfile::tempdir().unwrap();
    let pku = d.path().join("pku");
    std::fs::create_dir_all(pku.join("images")).unwrap();
    crate::sc1_gate::tests::ramp(&pku.join("images").join("pku001.png"), 7);
    let c4 = d.path().join("ceph400");
    std::fs::create_dir_all(&c4).unwrap();
    let out = d.path().join("reports").join("sc1");
    std::fs::create_dir_all(&out).unwrap();
    let key = open_seal(&git(Some(PREREG), false), &out).unwrap();
    let cache = d.path().join("reports").join("sc1").join("boxes");
    let ids = vec!["pku001".to_string()];
    for (what, e) in [("refuse_held_back", ledger::refuse_held_back(&pku, "test").err()),
                      ("refuse_held_back_unless(None)", ledger::refuse_held_back_unless(&pku, "test", None).err()),
                      ("refuse_held_back_cache_unless(None)", crate::chainproof::refuse_held_back_cache_unless(&pku, "test", None).err()),
                      ("boxes_for", crate::sc1_boxes::boxes_for(&engine, &pku, "test", &ids, &cache, false).err()),
                      ("boxes_for_unless(None)", crate::sc1_boxes::boxes_for_unless(&engine, &pku, "test", &ids, &cache, false, None).err()),
                      ("the key with split all", ledger::refuse_held_back_unless(&pku, "all", Some(&key)).err())] {
        let e = e.map(|e| e.to_string()).unwrap_or_default();
        eprintln!("{what}: {e}");
        assert!(e.contains("sealed"), "{what}: {e}");
    }
    assert!(!cache.exists(), "nothing written before a refusal");
    ledger::refuse_held_back_unless(&pku, "test", Some(&key)).unwrap();
    crate::chainproof::refuse_held_back_cache_unless(&pku, "test", Some(&key)).unwrap();
    let got = crate::sc1_boxes::boxes_for_unless(&engine, &pku, "test", &ids, &cache, false, Some(&key)).unwrap();
    eprintln!("with the key: boxes for {} PKU film(s)", got.len());
    assert_eq!(got.len(), 1);
    for (data, split) in [(&c4, "test2"), (&d.path().join("aariz"), "test")] {
        std::fs::create_dir_all(data).unwrap();
        let e = ledger::refuse_held_back_unless(data, split, Some(&key)).unwrap_err().to_string();
        let e2 = crate::chainproof::refuse_held_back_cache_unless(data, split, Some(&key)).unwrap_err().to_string();
        eprintln!("{} {split} with the key: {e} / {e2}", data.display());
        assert!(e.contains("held back") && e2.contains("held back"), "{e} / {e2}");
    }
    // SC1-1a's finder (no key) still refuses PKU.
    let f = sc1_1a::EngineFinder { engine, cache };
    let e = sc1_1a::Finder::boxes(&f, &pku, "test", &ids, false).unwrap_err().to_string();
    eprintln!("SC1-1a's finder on PKU: {e}");
    assert!(e.contains("sealed"), "{e}");
}
/// M19: no module but `ledger` can make a key. Fails if: `SealKey {` is written anywhere else in the crate's code (a
/// public field or another constructor would let it), or the field is made public (the compile_fail doctest in ledger.rs).
#[test] fn only_ledger_makes_a_seal_key() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("src");
    let mut makers = Vec::new();
    for e in std::fs::read_dir(&dir).unwrap() {
        let p = e.unwrap().path();
        // every source file but this test file; comment lines (the doctest's own example) are not code
        if p.extension().is_some_and(|x| x == "rs") && p.file_name().is_some_and(|n| n != "sc1_1b_pku_tests.rs") {
            let text = std::fs::read_to_string(&p).unwrap();
            let needle = concat!("SealKey", " {");
            for (i, l) in text.lines().enumerate() {
                if l.contains(needle) && !l.trim_start().starts_with("//") { makers.push(format!("{}:{}", p.file_name().unwrap().to_string_lossy(), i + 1)); }
            }
        }
    }
    eprintln!("lines with the key's constructor: {makers:?}");
    assert!(!makers.is_empty() && makers.iter().all(|m| m.starts_with("ledger.rs:")), "{makers:?}");
    let ledger = include_str!("ledger.rs");
    assert!(ledger.contains("pub struct SealKey { _private: () }") && ledger.contains("```compile_fail"), "the field stays private, its doctest in place");
}

// ---- the SYNTHETIC PKU set: 10 films (the 10 control films are all of them) ----

/// The stand-in region finder: each film's own teaching boxes (score 0.9), on the film as stored or flipped.
pub(crate) struct PkuStandIn { pub(crate) gt: BTreeMap<String, Vec<Pt>>, pub(crate) calls: Mutex<usize> }
impl PkuFinder for PkuStandIn {
    fn fingerprint(&self) -> String { FP.into() }
    fn boxes(&self, _data: &Path, ids: &[String], flipped: bool, _key: &ledger::SealKey) -> anyhow::Result<BTreeMap<String, Found>> {
        *self.calls.lock().unwrap() += 1;
        Ok(ids.iter().map(|id| {
            let pts = if flipped { sc1_1a::mirror_film(&self.gt[id], W) } else { self.gt[id].clone() };
            let named: Vec<(String, f64, f64)> = ORDER.iter().zip(&pts).map(|(n, p)| (n.to_string(), p.0, p.1)).collect();
            let boxes = teaching_boxes(&named, W, H).into_iter().map(|b| FoundBox { region: b.region.index(), x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, score: 0.9 }).collect();
            (id.clone(), Found { boxes, fingerprint: FP.into(), version: "SYNTHETIC".into(), image_width: W, image_height: H, ms: 0.0 })
        }).collect())
    }
}
pub(crate) struct Px { pub(crate) _d: tempfile::TempDir, pub(crate) pku: PathBuf, pub(crate) ceph400: PathBuf, pub(crate) models: PathBuf, pub(crate) out: PathBuf,
    pub(crate) git: Git, pub(crate) pins: Pins, pub(crate) marks: Marks, pub(crate) finder: PkuStandIn }
impl Px {
    fn run(&self) -> i32 { run_with(&self.pku, &self.ceph400, &self.models, &self.out, &self.git, &self.pins, &self.marks, &self.finder).unwrap() }
    fn report(&self) -> PathBuf { self.out.join(REPORT) }
    fn calls(&self) -> usize { *self.finder.calls.lock().unwrap() }
}
fn csv(rows: &[(String, Vec<Pt>)]) -> String {
    let mut s = String::from("image_id,landmark,x,y\n");
    for (id, p) in rows { for (n, q) in ORDER.iter().zip(p) { s += &format!("{id},{n},{},{}\n", q.0, q.1); } }
    s
}
/// SYNTHETIC heads drawn at PKU's pixel size: Ceph-400-sized faces x (0.1 / 0.125) about each face's centroid.
fn pku_faces(n: usize, seed: u64, k: f64) -> Vec<Vec<Pt>> {
    ceph_model::shape::synthetic_faces(n, seed).into_iter().map(|f| sc1_1a::scaled(&f, k * crate::MM_PER_PX / crate::pku::PKU_MM_PER_PX)).collect()
}
/// A 300-tracing `whole-film-reference/1` stand-in named ceph400:001..300 (SC1-1a's SYNTHETIC prior), lines stored.
fn reference_text() -> &'static str {
    static T: OnceLock<String> = OnceLock::new();
    T.get_or_init(|| {
        let p = prior();
        let names: Vec<String> = p.names.iter().map(|n| format!("ceph400:{n}")).collect();
        let r = Reference { sha256: "SYNTHETIC".into(), names: names.clone(), tracings: p.tracings.clone(), lines: vec![] };
        let l = WholeScorer::from_reference(&r).unwrap().line_for(&(0..19).collect::<Vec<_>>()).unwrap();
        let lines: Vec<(Vec<usize>, f64)> = ceph_model::wholefilm::stored_line_sets().into_iter().map(|s| (s, l)).collect();
        reference_json(&names, &p.tracings, &lines).unwrap()
    })
}
/// The SYNTHETIC set at scale `k` (1.0: drawn at 0.125 mm/px; 1.3: C12's wrong scale), every pin taken from it.
pub(crate) fn px_scaled(k: f64) -> Px {
    let d = tempfile::tempdir().unwrap();
    let data = d.path().join("data");
    let pku = data.join("pku");
    std::fs::create_dir_all(&pku).unwrap();
    let ceph400 = crate::shape_prior::write_synthetic_ceph400_scaled(d.path(), 1.0).unwrap();
    let ids: Vec<String> = (1..=10).map(|i| format!("pku{i:03}")).collect();
    let gt: Vec<(String, Vec<Pt>)> = ids.iter().cloned().zip(pku_faces(10, 2026_11_05, k)).collect();
    let d1: Vec<(String, Vec<Pt>)> = gt.iter().map(|(id, p)| (id.clone(), p.iter().map(|q| (q.0 - 1.0, q.1 + 0.5)).collect())).collect();
    let d2: Vec<(String, Vec<Pt>)> = gt.iter().map(|(id, p)| (id.clone(), p.iter().map(|q| (q.0 + 1.0, q.1 - 0.5)).collect())).collect();
    std::fs::write(pku.join("gt.csv"), csv(&gt)).unwrap();
    std::fs::write(pku.join("gt-doctor1.csv"), csv(&d1)).unwrap();
    std::fs::write(pku.join("gt-doctor2.csv"), csv(&d2)).unwrap();
    std::fs::write(pku.join("splits.json"), serde_json::json!({"test": ids}).to_string()).unwrap();
    std::fs::write(pku.join("spacing.csv"), ids.iter().fold(String::from("image_id,mm_per_px\n"), |s, id| s + &format!("{id},0.125\n"))).unwrap();
    let prov = b"{\"dataset\": \"SYNTHETIC PKU\"}\n".to_vec();
    std::fs::write(pku.join("provenance.json"), &prov).unwrap();
    // models: the reference, gate /4's calibration, the size calibration, the ruled centre calibration.
    let models = d.path().join("models");
    for s in ["regions", "shape"] { std::fs::create_dir_all(models.join(s)).unwrap(); }
    let out = d.path().join("reports").join("sc1");
    std::fs::create_dir_all(&out).unwrap();
    std::fs::write(reference_path(&models), reference_text()).unwrap();
    let rec = crate::sc1_wf3::records().unwrap();
    let cal = ceph_model::wholefilm::RegionCalibration { version: "region-calibration/1".into(), detector_fingerprint: FP.into(), score_line: 0.5,
        tau: RegionTau(rec.tau), gate_report_sha256: rec.gate4_sha.clone(), rule: Some("sc1-box-gate/4".into()) };
    std::fs::write(ceph_model::wholefilm::calibration_path(&models), ceph_model::wholefilm::calibration_json(&cal).unwrap()).unwrap();
    let gate2 = gate_json(sc1_1a::GATE_RULE, "pass", true, FP, 0.5, TAU2);
    std::fs::write(out.join(GATE2_REPORT), &gate2).unwrap();
    // The size and centre calibrations fitted to the SYNTHETIC films' own teaching boxes (as the dev run's fixture).
    let own = |p: &[Pt]| crate::sc1_1a::tests::own(p);
    let four: Vec<Region> = REGIONS.into_iter().filter(|r| *r != Region::SoftTissue).collect();
    let qs: Vec<f64> = gt.iter().map(|(_, p)| size_score(&points_of(&sc1_1a::marks_of(p), false, W).unwrap(), &own(p), &four).unwrap().1).collect();
    let centre = qs.iter().sum::<f64>() / qs.len() as f64;
    let line = (qs.iter().map(|q| (q - centre).abs()).fold(0.0, f64::max) * 100.0).ceil() / 100.0 + 0.05;
    let refs = vec![SizeRef { regions: four.clone(), centre, line }];
    let size_report = serde_json::to_vec_pretty(&serde_json::json!({"version": SIZE_RULE, "uses": four, "refs": refs})).unwrap();
    std::fs::write(out.join(SIZE_REPORT), &size_report).unwrap();
    let size_sha = ft_common::sha256_hex(&size_report);
    let sc = SizeCalibration { version: SIZE_CALIBRATION_VERSION.into(), rule: SIZE_RULE.into(), detector_fingerprint: FP.into(), uses: four.clone(), refs, report_sha256: size_sha.clone() };
    std::fs::write(size_calibration_path(&models), serde_json::to_string_pretty(&sc).unwrap()).unwrap();
    let os: Vec<(f64, f64)> = gt.iter().map(|(_, p)| cb_offset(&points_of(&sc1_1a::marks_of(p), false, W).unwrap(), &own(p), false).unwrap()).collect();
    let mut xs: Vec<f64> = os.iter().map(|o| o.0).collect(); xs.sort_by(f64::total_cmp);
    let mut ys: Vec<f64> = os.iter().map(|o| o.1).collect(); ys.sort_by(f64::total_cmp);
    let median = (xs[xs.len() / 2], ys[ys.len() / 2]);
    let cb_report = serde_json::to_vec_pretty(&serde_json::json!({"version": CB_RULE, "median": [median.0, median.1], "line": 0.06, "perSet": [
        {"set": "holdout", "judged": 70, "median": [-0.04, 0.018]}, {"set": "ceph400Train", "judged": 150, "median": [-0.04, -0.006]},
        {"set": "ceph400Test1", "judged": 150, "median": [-0.04, -0.006]}, {"set": "aarizValid", "judged": 150, "median": [-0.05, 0.019]}]})).unwrap();
    std::fs::write(out.join(CB_REPORT), &cb_report).unwrap();
    let cbs = ft_common::sha256_hex(&cb_report);
    let cb = CbCalibration { version: CB_CALIBRATION_VERSION.into(), rule: CB_RULE.into(), detector_fingerprint: FP.into(), median, line: rec.centre_line,
        report_sha256: cbs.clone(), ruling: Some(CbRuling { rule: "whole-film/3".into(), measured_line: rec.measured_line, record_sha256: rec.centre_sha.clone() }) };
    std::fs::write(ceph_model::wholefilm::cb_calibration_path(&models), serde_json::to_string_pretty(&cb).unwrap()).unwrap();
    let rt = reference_text();
    let line19 = ceph_model::wholefilm::parse_reference(rt.as_bytes()).unwrap().lines[0].1;
    let pins = Pins { provenance: ft_common::sha256_hex(&prov), mm_per_px: 0.125, reference: ft_common::sha256_hex(rt.as_bytes()), line19, fingerprint: FP.into(),
        gate4: rec.gate4_sha.clone(), tau: rec.tau, score_line: 0.5, gate2_report: ft_common::sha256_hex(&gate2), size_report: size_sha, size_uses: four,
        cb_report: cbs, centre_ruling: rec.centre_sha.clone(), cb_line: rec.centre_line, cb_measured_line: rec.measured_line };
    let finder = PkuStandIn { gt: gt.iter().cloned().collect(), calls: Mutex::new(0) };
    Px { pku, ceph400, models, out, git: git(Some(PREREG), false), pins, marks: Marks::for_films(10), finder, _d: d }
}
pub(crate) fn px() -> Px { px_scaled(1.0) }
/// The one full SYNTHETIC run, shared: its exit code, its report and its printed lines.
fn good_run() -> &'static (i32, serde_json::Value, Vec<String>) {
    static R: OnceLock<(i32, serde_json::Value, Vec<String>)> = OnceLock::new();
    R.get_or_init(|| {
        let p = px();
        let t = std::time::Instant::now();
        let code = p.run();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p.report()).unwrap()).unwrap();
        eprintln!("SYNTHETIC SC1-1b-PKU run: exit {code} in {:.1} s", t.elapsed().as_secs_f64());
        let lines: Vec<String> = v["summary"].as_array().unwrap().iter().map(|l| l.as_str().unwrap().to_string()).collect();
        for l in &lines { eprintln!("  {l}"); }
        (code, v, lines)
    })
}

// ---- the run ----

/// The whole run on the SYNTHETIC set: C1-C12 all hold, every count is its total (C7: 100 planted, 10 untouched, 10
/// kinds of 10), the marks line, both Clopper-Pearson intervals, the doctor1 and doctor2 lines, the shifts, the box
/// quality and PKU's centre median are printed; the report carries the pre-registration's SHA-256 and whole-film/3; the
/// exit is the verdict's. Fails if any part of the run is skipped.
#[test] fn run_with_judges_every_plant_and_prints_every_line() {
    let (code, v, lines) = good_run();
    let names: Vec<&str> = v["controls"].as_array().unwrap().iter().map(|c| c["name"].as_str().unwrap()).collect();
    assert_eq!(names, ["C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8", "C9", "C10", "C11", "C12"]);
    for c in v["controls"].as_array().unwrap() { assert_eq!(c["holds"], true, "{c}"); }
    assert_eq!((v["counts"]["planted"].as_u64(), v["counts"]["normal"].as_u64()), (Some(100), Some(10)));
    assert_eq!(v["counts"]["kinds"].as_array().unwrap().len(), 10);
    assert!(v["counts"]["kinds"].as_array().unwrap().iter().all(|k| k["cases"] == 10));
    assert_eq!(v["rule"], "whole-film/3");
    assert_eq!(v["preregSha256"].as_str().unwrap(), ft_common::sha256_hex(PREREG.as_bytes()));
    assert!(lines.iter().any(|l| l.starts_with("marks: catch ") && l.contains("/100, needed 95)") && l.contains("/10, at most 0)")), "{lines:?}");
    assert!(lines.iter().any(|l| l.contains("POOLED caught") && l.contains("95% CI")));
    assert!(lines.iter().any(|l| l.contains("POOLED untouched flagged") && l.contains("95% CI")));
    assert!(lines.iter().any(|l| l.contains("N with doctor1 alone")) && lines.iter().any(|l| l.contains("N with doctor2 alone")));
    assert_eq!(v["doctors"].as_array().unwrap().len(), 2);
    assert!(v["doctors"].as_array().unwrap().iter().all(|d| d["cases"] == 10));
    assert_eq!(v["shifts"].as_array().unwrap().len(), 2);
    assert!(v["shifts"].as_array().unwrap().iter().all(|d| d["cases"] == 10));
    assert_eq!(v["boxQuality"].as_array().unwrap().len(), 5);
    assert_eq!(v["centreMedians"].as_array().unwrap().len(), 5, "PKU's beside the four calibration sets'");
    assert!(lines.iter().any(|l| l.contains("Stage A also flagged")));
    assert!(lines.iter().any(|l| l.starts_with("disclosure: ") && l.contains("THIRD tuning")));
    let want = exit_code(v["verdict"].as_str().unwrap());
    assert_eq!(*code, want);
    assert!(*code == 0 || *code == 3, "controls hold, so pass or fail: {code}");
    assert_eq!(v["verdictMarks"]["caught"], v["counts"]["caught"]);
    assert_eq!(v["ships"], "on-pass", "the SYNTHETIC set passes, so the switch's band is a pass");
    assert!(lines.iter().any(|l| l.starts_with("ships: on, a pass")), "{lines:?}");
}
/// The plants (M20): SC1-1a's recipes under seed 20261108, P2 a single-cycle derangement (no film keeps its own tracing),
/// P4 moved d = 10-20 mm at 0.125 mm/px (80-160 px) in the case rng's direction, 10 kinds per film plus N; the shifts 10
/// and 20 mm. Fails if: the seed, the scale or a recipe changes.
#[test] fn the_plants_are_sc1_1as_recipes_with_pkus_seed_and_scale() {
    let films: Vec<PkuFilm> = pku_faces(4, 3, 1.0).into_iter().enumerate().map(|(i, p)| PkuFilm { id: format!("pku{:03}", i + 1), regions: sc1_1a::tests::own(&p), pts: p, w: W, h: H }).collect();
    let ps = plants(&films).unwrap();
    assert_eq!(ps.len(), 4 * 11);
    let d = sc1_1a::derangement(&films.iter().map(|f| f.id.clone()).collect::<Vec<_>>(), SEED, P2_SALT);
    for (i, f) in films.iter().enumerate() {
        let of = |k: Kind| &ps.iter().find(|p| p.film == i && p.kind == k).unwrap().pts;
        assert_eq!(of(Kind::P1a), &sc1_1a::mirror_film(&f.pts, f.w));
        assert_eq!(of(Kind::P1b), &sc1_1a::mirror_in_place(&f.pts));
        assert_eq!(of(Kind::P2), &films[d[i]].pts);
        assert_ne!(d[i], i);
        assert_eq!(of(Kind::P3Half), &sc1_1a::scaled(&f.pts, 0.5));
        assert_eq!(of(Kind::P3Double), &sc1_1a::scaled(&f.pts, 2.0));
        assert_eq!(of(Kind::N), &f.pts);
        for r in REGIONS {
            let (mm, u) = sc1_1a::p4_draw_seeded(SEED, i, r);
            assert!((10.0..20.0).contains(&mm));
            assert_eq!(of(Kind::P4(r)), &sc1_1a::moved(&f.pts, Some(r), mm / 0.125 * u.0, mm / 0.125 * u.1));
        }
    }
    let sh = info_shifts(&films).unwrap();
    assert_eq!(sh.len(), 8);
    let u = sc1_1a::shift_draw_seeded(SEED, 2, 20);
    assert_eq!(sh.iter().find(|p| p.film == 2 && p.kind == Kind::Shift(20)).unwrap().pts, sc1_1a::moved(&films[2].pts, None, 160.0 * u.0, 160.0 * u.1));
    assert_eq!((SEED, P2_SALT), (20261108, 102));
    let ids: Vec<String> = (1..=102).map(|i| format!("pku{i:03}")).collect();
    let mut want = ids.clone();
    crate::chainproof::shuffle(&mut want, &mut ft_common::case_rng(SEED, &[sc1_1a::T_CONTROL]));
    assert_eq!(control_films(&ids), want[..10].to_vec());
}
/// Exit 4: the gate report in force (gate /2's) says stop -> nothing judged, no report, the finder never called.
#[test] fn a_gate_stop_is_exit_4_and_judges_nothing() {
    let mut p = px();
    let stop = gate_json(sc1_1a::GATE_RULE, "stop", false, FP, 0.5, TAU2);
    std::fs::write(p.out.join(GATE2_REPORT), &stop).unwrap();
    p.pins.gate2_report = ft_common::sha256_hex(&stop);
    let code = p.run();
    eprintln!("gate stop: exit {code}; finder calls {}; report {}", p.calls(), p.report().exists());
    assert_eq!((code, p.calls(), p.report().exists()), (4, 0, false));
}
/// Every pin refuses on its own, before any film is judged and with nothing written: broken (exit 1). Then the control:
/// the same folders with every pin met run. Fails if any one comparison is dropped.
#[test] fn the_run_refuses_unless_every_pin_matches() {
    let base = px();
    let cases: Vec<(&str, Box<dyn Fn(&mut Px)>)> = vec![
        ("the provenance file differs", Box::new(|p: &mut Px| std::fs::write(p.pku.join("provenance.json"), "{}\n").unwrap())),
        ("the reference differs", Box::new(|p: &mut Px| p.pins.reference = "0".repeat(64))),
        ("the stored line differs", Box::new(|p: &mut Px| p.pins.line19 += 0.1)),
        ("another detector pinned", Box::new(|p: &mut Px| p.pins.fingerprint = "0".repeat(64))),
        ("another gate /4 record", Box::new(|p: &mut Px| p.pins.gate4 = "0".repeat(64))),
        ("tau in force not gate /4's", Box::new(|p: &mut Px| { let mut c = ceph_model::wholefilm::parse_calibration(&std::fs::read(ceph_model::wholefilm::calibration_path(&p.models)).unwrap()).unwrap();
            c.tau = RegionTau([0.09, 0.07, 0.10, 0.01, 0.10]); std::fs::write(ceph_model::wholefilm::calibration_path(&p.models), ceph_model::wholefilm::calibration_json(&c).unwrap()).unwrap(); })),
        ("the gate /2 report differs", Box::new(|p: &mut Px| p.pins.gate2_report = "0".repeat(64))),
        ("the size report differs", Box::new(|p: &mut Px| p.pins.size_report = "0".repeat(64))),
        ("the size uses differ", Box::new(|p: &mut Px| p.pins.size_uses = REGIONS.to_vec())),
        ("the centre report differs", Box::new(|p: &mut Px| p.pins.cb_report = "0".repeat(64))),
        ("the centre ruling differs", Box::new(|p: &mut Px| p.pins.centre_ruling = "0".repeat(64))),
        ("the centre line pinned 0.06", Box::new(|p: &mut Px| p.pins.cb_line = 0.06)),
        // every row present, one at 0.1 (C12's ratio barely moves, so only the spacing count can refuse it)
        ("a spacing row not 0.125", Box::new(|p: &mut Px| { let t = std::fs::read_to_string(p.pku.join("spacing.csv")).unwrap();
            std::fs::write(p.pku.join("spacing.csv"), t.replacen("pku001,0.125", "pku001,0.1", 1)).unwrap(); })),
        ("the scale pinned 0.096", Box::new(|p: &mut Px| p.pins.mm_per_px = 0.096)),
        // the pin and every spacing row agree on 0.096: only the pin-against-the-loader check can refuse it
        ("the scale pinned 0.096 and spacing.csv 0.096", Box::new(|p: &mut Px| { p.pins.mm_per_px = 0.096; let t = std::fs::read_to_string(p.pku.join("spacing.csv")).unwrap();
            std::fs::write(p.pku.join("spacing.csv"), t.replace(",0.125", ",0.096")).unwrap(); })),
        ("a film count off", Box::new(|p: &mut Px| p.marks = Marks::for_films(11))),
        ("a dirty tree", Box::new(|p: &mut Px| p.git.dirty = true)),
        ("the pre-registration not committed", Box::new(|p: &mut Px| p.git.prereg_at_head = None)),
    ];
    for (what, f) in &cases {
        let mut p = px();
        f(&mut p);
        let code = p.run();
        eprintln!("{what}: exit {code}; finder calls {}; report {}", p.calls(), p.report().exists());
        assert_eq!((code, p.report().exists()), (1, false), "{what}");
    }
    let code = base.run();
    eprintln!("control, every pin met: exit {code}");
    assert!(code == 0 || code == 3, "{code}");
}

// ---- each control made to fail on purpose ----

struct Judge { films: Vec<PkuFilm>, whole: WholeScorer, tau: RegionTau, size: SizeCalibration, cb: CbCalibration }
fn judge() -> &'static Judge {
    static J: OnceLock<Judge> = OnceLock::new();
    J.get_or_init(|| {
        let p = px();
        let size = ceph_model::wholefilm::parse_size_calibration(&std::fs::read(size_calibration_path(&p.models)).unwrap()).unwrap();
        let cb = ceph_model::wholefilm::parse_cb_calibration(&std::fs::read(ceph_model::wholefilm::cb_calibration_path(&p.models)).unwrap()).unwrap();
        let r = ceph_model::wholefilm::parse_reference(reference_text().as_bytes()).unwrap();
        let films = p.finder.gt.iter().map(|(id, pts)| PkuFilm { id: id.clone(), regions: sc1_1a::tests::own(pts), pts: pts.clone(), w: W, h: H }).collect();
        Judge { films, whole: WholeScorer::from_reference(&r).unwrap(), tau: RegionTau(TAU2), size, cb }
    })
}
fn holds(c: anyhow::Result<Control>) -> bool { let c = c.unwrap(); eprintln!("  {} {}: {} -> {}", c.name, c.what, c.got, c.holds); c.holds }

/// C2 x2 and C10 x0.5 hold; each with x1 does not (fails if: the factor is ignored, or "unscaled: not all" is dropped).
#[test] fn c2_and_c10_fail_at_x1() {
    let j = judge();
    let cal = FilmCal { tau: &j.tau, size: Some(&j.size), cb: Some(&j.cb) };
    let f: Vec<&PkuFilm> = j.films.iter().collect();
    assert!(holds(c2(&f, &j.whole, &cal, C2_FACTOR)));
    assert!(!holds(c2(&f, &j.whole, &cal, 1.0)));
    // "unscaled: not all 10": a size calibration whose centre is moved by 1 flags every untouched tracing, so neither
    // control may hold even though their planted side is caught (fails if: the untouched side is dropped).
    let far = SizeCalibration { refs: j.size.refs.iter().map(|r| SizeRef { centre: r.centre + 1.0, ..r.clone() }).collect(), ..j.size.clone() };
    let every = FilmCal { size: Some(&far), ..cal };
    assert!(!holds(c2(&f, &j.whole, &every, C2_FACTOR)));
    assert!(!holds(c10(&f, &j.whole, &every, 1.0 / 8.0)));
    assert!(holds(c10(&f, &j.whole, &cal, C10_FACTOR)));
    assert!(!holds(c10(&f, &j.whole, &cal, 1.0)));
    // C10 counts the size look only: with no size calibration, x0.5 is still caught by the regions but C10 does not hold
    // (fails if: C10 counts any region flag as a size flag).
    let no_size = FilmCal { size: None, ..cal };
    assert!(!holds(c10(&f, &j.whole, &no_size, C10_FACTOR)));
}
/// C3 mandible +40 mm and C11 cranial base +20 mm hold; each at 0 mm does not (fails if: the move is ignored, the region
/// is not the one asked, or "unmoved: not all" is dropped).
#[test] fn c3_and_c11_fail_at_0_mm() {
    let j = judge();
    let cal = FilmCal { tau: &j.tau, size: Some(&j.size), cb: Some(&j.cb) };
    let f: Vec<&PkuFilm> = j.films.iter().collect();
    assert!(holds(c3(&f, &j.whole, &cal, C3_SHIFT_MM, 0.125)));
    assert!(!holds(c3(&f, &j.whole, &cal, 0.0, 0.125)));
    assert!(holds(c11(&f, &j.whole, &cal, C11_SHIFT_MM, 0.125)));
    assert!(!holds(c11(&f, &j.whole, &cal, 0.0, 0.125)));
}
/// C8 x1000 holds; x1 does not (fails if: the off-film test or the region flag is dropped).
#[test] fn c8_fails_at_x1() {
    let j = judge();
    let cal = FilmCal { tau: &j.tau, size: Some(&j.size), cb: Some(&j.cb) };
    let f: Vec<&PkuFilm> = j.films.iter().collect();
    assert!(holds(c8(&f, &j.whole, &cal, C8_FACTOR)));
    assert!(!holds(c8(&f, &j.whole, &cal, 1.0)));
    // x1.5 about the film's origin: region flags, but not every point off the film (fails if: the off-film test is dropped)
    assert!(!holds(c8(&f, &j.whole, &cal, 1.5)));
}
/// C1 (SC1-1a's) fails with a mirror that mirrors nothing; C4 fails when the flipped facing does not flip; C9 fails when
/// the gate report's control did not trip; C7 refuses a count that is one short.
#[test] fn c1_c4_c7_c9_fail_on_purpose() {
    let tau = RegionTau(TAU2);
    assert!(!sc1_1a::c1(&|p: &[Pt], _w: u32| p.to_vec(), &tau).unwrap().holds);
    let j = judge();
    let same: Vec<(Regions, Regions)> = j.films.iter().map(|f| (f.regions.clone(), f.regions.clone())).collect();
    assert!(!sc1_1a::c4(&same).holds);
    let flipped: Vec<(Regions, Regions)> = j.films.iter().map(|f| (f.regions.clone(), sc1_1a::tests::own(&sc1_1a::mirror_film(&f.pts, W)))).collect();
    assert!(sc1_1a::c4(&flipped).holds, "control: flipped boxes flip the facing");
    let g: serde_json::Value = serde_json::from_slice(&gate_json(sc1_1a::GATE_RULE, "pass", false, FP, 0.5, TAU2)).unwrap();
    assert!(!sc1_1a::c9(&g).holds);
    let (_, v, _) = good_run();
    assert_eq!(v["controls"][6]["name"], "C7");
    let cal = FilmCal { tau: &j.tau, size: Some(&j.size), cb: Some(&j.cb) };
    let ps = plants(&j.films).unwrap();
    let mut cases = judge_all(&j.films, &ps, &j.whole, &ShapeScorer::new(prior().tracings.clone()), &cal).unwrap();
    assert!(count(&cases, &Marks::for_films(10), &j.tau).is_ok());
    cases.pop();
    let e = count(&cases, &Marks::for_films(10), &j.tau).unwrap_err().to_string();
    eprintln!("one case short: {e}");
    assert!(e.contains("N untouched"), "{e}");
}
/// C5 holds on the real names; it fails when the folder given as PKU is not named pku (the seal would not cover it).
#[test] fn c5_fails_when_the_seal_does_not_cover_the_folder() {
    let p = px();
    assert!(c5(&p.ceph400, &p.pku).holds);
    let other = p.pku.parent().unwrap().join("pku-copy");
    std::fs::create_dir_all(&other).unwrap();
    let c = c5(&p.ceph400, &other);
    eprintln!("  {} {}: {} -> {}", c.name, c.what, c.got, c.holds);
    assert!(!c.holds);
}
/// C6 holds on a reference with no PKU name; it fails on a reference file that names a PKU tracing (fails if: the name
/// check or the homework refusal is dropped).
#[test] fn c6_fails_when_the_reference_names_a_pku_tracing() {
    let j = judge();
    let r = ceph_model::wholefilm::parse_reference(reference_text().as_bytes()).unwrap();
    let cal = FilmCal { tau: &j.tau, size: Some(&j.size), cb: Some(&j.cb) };
    assert!(c6(&j.films[0], &r, &cal).holds);
    let bad = Reference { names: r.names.iter().enumerate().map(|(i, n)| if i == 0 { "pku:pku001".to_string() } else { n.clone() }).collect(), ..r.clone() };
    let c = c6(&j.films[0], &bad, &cal);
    eprintln!("  {} {}: {} -> {}", c.name, c.what, c.got, c.holds);
    assert!(!c.holds);
}
/// C12 holds at the SYNTHETIC set's true scale; a set drawn x1.3 whose spacing.csv still says 0.125 is refused (ratio
/// about 1.25), and so is a changed provenance file. Fails if: the ratio is not recomputed from gt.csv x spacing.csv, one
/// side of +-0.15 is dropped, or the provenance SHA-256 is not compared.
#[test] fn c12_fails_at_the_wrong_scale_or_provenance() {
    let p = px();
    let ok = c12(&p.pku, &p.ceph400, &p.pins.provenance).unwrap();
    eprintln!("  {} {}: {} -> {}", ok.name, ok.what, ok.got, ok.holds);
    assert!(ok.holds);
    let w = px_scaled(1.3);
    let c = c12(&w.pku, &w.ceph400, &w.pins.provenance).unwrap();
    eprintln!("  {} {}: {} -> {}", c.name, c.what, c.got, c.holds);
    assert!(!c.holds && c.got.starts_with("ratio 1.3"), "drawn x1.3, so the ratio is about 1.3 times the true one: {}", c.got);
    assert!(ok.got.starts_with("ratio 0.9") || ok.got.starts_with("ratio 1.0"), "the true scale: {}", ok.got);
    let c = c12(&p.pku, &p.ceph400, &"0".repeat(64)).unwrap();
    eprintln!("  provenance changed: {} -> {}", c.got, c.holds);
    assert!(!c.holds);
}
/// A control that fails after judging makes the whole run broken (exit 1) and the report says so; the seal then stays
/// shut (a verdict line was printed). Here C12: the set is drawn x1.3 while spacing.csv says 0.125 (every pin is the
/// set's own, so the run judges and only the control fails). Fails if: a control failure is reported as pass or fail,
/// or a broken report leaves the seal open. (A gate report whose C9 did not trip is refused before any verdict, as in
/// SC1-1a: `check_gate`.)
#[test] fn a_control_that_fails_makes_the_run_broken_and_shuts_the_seal() {
    let p = px_scaled(1.3);
    let code = p.run();
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p.report()).unwrap_or_default()).unwrap_or_default();
    let c12 = v["controls"].as_array().map(|a| a[11].clone()).unwrap_or_default();
    eprintln!("C12 fails (x1.3): exit {code}; verdict {}; {c12}", v["verdict"]);
    assert_eq!((code, v["verdict"].as_str(), c12["holds"].as_bool()), (1, Some(BROKEN), Some(false)));
    assert!(v["controls"].as_array().unwrap().iter().filter(|c| c["holds"] == false).count() >= 1);
    let e = open_seal(&p.git, &p.out).unwrap_err().to_string();
    assert!(e.contains("already exists"), "{e}");
}
/// Edge cases: a film where the finder finds fewer than 3 regions is counted under its plants (no-ceph-found printed),
/// not dropped; a tracing with 18 points is not judged by the size look (counted as not judged). Fails if: a
/// no-ceph-found film is left out of the counts, or the size look judges an incomplete tracing.
#[test] fn a_film_with_fewer_than_3_regions_is_counted_as_no_ceph_found() {
    let j = judge();
    let cal = FilmCal { tau: &j.tau, size: Some(&j.size), cb: Some(&j.cb) };
    let mut f = j.films[0].clone();
    f.regions.boxes.retain(|b| matches!(b.region, Region::CranialBase | Region::Maxilla));
    let r = check(&f, &f.pts, &j.whole, &cal).unwrap();
    eprintln!("two regions found: {:?}; size {:?}; centre {:?}", r.check, r.size_look, r.cb_look);
    assert!(matches!(&r.check, FilmCheck::Flagged { reasons } if reasons.contains(&Reason::NoCephFound)));
    let films = vec![f.clone(), j.films[1].clone()];
    let cases = judge_all(&films, &plants(&films).unwrap(), &j.whole, &ShapeScorer::new(prior().tracings.clone()), &cal).unwrap();
    let c = count(&cases, &Marks::for_films(2), &j.tau).unwrap();
    eprintln!("two films, one with no ceph found: planted {}, untouched {}, no-ceph-found among the untouched {}", c.planted, c.normal, c.untouched.looks.no_ceph_found);
    assert_eq!((c.planted, c.normal, c.untouched.looks.no_ceph_found), (20, 2, 1));
    let mut short = sc1_1a::marks_of(&j.films[1].pts);
    short.pop();
    let r = ceph_model::wholefilm::check_film(Some(&j.whole), &short, false, W, H, ceph_model::wholefilm::RegionLook::Found(&j.films[1].regions), &cal).unwrap();
    eprintln!("18 points: size look {:?}", r.size_look);
    assert_eq!(r.size_look, ceph_model::wholefilm::ExtraLook::TooFew);
}
