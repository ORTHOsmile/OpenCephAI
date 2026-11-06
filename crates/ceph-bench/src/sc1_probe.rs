//! SC-1 Part 1, before SC1-1a (owner ruling 5 Nov 2026, "Check first"): the region false-alarm probe, pre-registered in
//! `reference/sc1-region-probe.json` (committed alone before any run, SHA-256 pinned in a test; every rule here is that
//! file's).
//!
//! **The picture.** Task 10 set the five tolerances τ_r on 70 Aariz films; four came out at the 0.01 floor, which means a
//! traced point may sit at most 1% of its box's longer side outside the box the region finder draws. The finder was
//! 2–3× less accurate on Ceph-400 films. So: on 150 Ceph-400 films the finder never saw and SC1-1a never uses (Train,
//! 001–150), lay the finder's boxes on the film, put the experts' own tracing on it, and count how many of these
//! *correct* tracings the app's check would still flag. Each flag here is a false alarm.
//!
//! **Compared with.** The finder's boxes on the same film, at the pinned score line, judged by the app's own
//! `check_film` (no shape look: these tracings are in the shape reference set) with the pinned τ_r.
//!
//! **Decision (pre-registered).** Ceph-400 Train flagged ≤ 3 of 150 (≤ 2%, SC1-1a's normal-film rate) → keep τ, proceed
//! to SC1-1a (exit 0). More than 3 → stop, to the owner (exit 3). Broken → exit 1. The probe never changes τ.
//!
//! **Positive control.** The same 150 tracings with the mandible's five points moved 40 mm forward (spec §9.1 C3) must be
//! flagged on at least 140; otherwise the probe is blind (exit 1).
//!
//! Ceph-400 test1, Aariz valid (SC1-1a's films), Ceph-400 test2 and Aariz test are refused before any file is read.
//! Prints aggregates only, never a film id.
use crate::{chainproof, dataset, ft_common, ledger, sc1_boxes, sc1_gate};
use crate::sc1_data::{self, Split};
use crate::sc1_gate::Git;
use anyhow::{ensure, Context};
use ceph_infer::regions::{regions_manifest_path, RegionEngine};
use ceph_model::pointcheck::Mark;
use ceph_model::wholefilm::{calibration_path, check_film, outside_ratio, FilmCal, parse_calibration, FilmCheck, Reason, Region, RegionBox,
    RegionCalibration, RegionLook, RegionTau, Regions, REGIONS, REGION_OF};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;

pub const PREREG: &str = include_str!("../../../reference/sc1-region-probe.json");
pub const PREREG_PATH: &str = "reference/sc1-region-probe.json";
pub const VERSION: &str = "sc1-region-probe/1";
/// The decision: Ceph-400 Train films flagged by the region rules, at most this many → keep τ (exit 0).
pub const THRESHOLD: usize = 3;
/// Ceph-400 Train: films 001–150.
pub const CEPH400_TRAIN: usize = 150;
/// The positive control: at least this many of the 150 shifted tracings flagged, else blind (exit 1).
pub const CONTROL_MIN: usize = 140;
/// The positive control's shift: 40 mm forward at Ceph-400's 0.1 mm per pixel.
pub const CONTROL_SHIFT_PX: f64 = 400.0;
pub const KEEP: &str = "keep";
pub const OWNER: &str = "owner";
pub const BROKEN: &str = "broken";

/// What the probe requires of the detector and the calibration (the pre-registration's values in the real run).
#[derive(Clone, Debug)]
pub struct Pins { pub fingerprint: String, pub gate_report_sha256: String, pub score_line: f32, pub tau: [f64; 5] }
impl Pins {
    /// The pre-registration's own values.
    pub fn from_prereg() -> anyhow::Result<Pins> {
        let v: serde_json::Value = serde_json::from_str(PREREG)?;
        let fp = pinned_fingerprint(&v);
        let c = &v["calibration"];
        let mut tau = [f64::NAN; 5];
        for r in REGIONS { tau[r.index()] = c["tau"][serde_json::to_value(r)?.as_str().unwrap_or_default()].as_f64().unwrap_or(f64::NAN); }
        Ok(Pins { fingerprint: fp, gate_report_sha256: c["gateReportSha256"].as_str().unwrap_or_default().into(),
            score_line: c["scoreLine"].as_f64().unwrap_or(f64::NAN) as f32, tau })
    }
}

/// The 64-hex detector fingerprint a pre-registration's "detector" line pins ("" when it names none).
pub fn pinned_fingerprint(prereg: &serde_json::Value) -> String {
    prereg["detector"].as_str().unwrap_or_default().split(|c: char| !c.is_ascii_hexdigit()).find(|w| w.len() == 64).unwrap_or_default().to_string()
}

/// One film as the probe reads it. Per region (REGIONS order): the largest outside-ratio and the largest signed
/// edge-ratio of its traced points (None: not found); whether a point is above τ_r; whether `check_film` gives a region
/// flag. Then no-ceph-found, facing, and whether `check_film` flags the film at all.
#[derive(Clone, Debug, PartialEq)]
pub struct FilmProbe {
    pub found: usize, pub outside: [Option<f64>; 5], pub signed: [Option<f64>; 5], pub over_tau: [bool; 5], pub region_flag: [bool; 5],
    pub no_ceph: bool, pub facing: bool, pub flagged: bool,
}

/// Outside the box: + the outside-ratio. Inside or on an edge: −(distance to the nearest edge) ÷ the longer side.
pub fn signed_edge_ratio(b: &RegionBox, p: (f64, f64)) -> f64 {
    let out = outside_ratio(b, p);
    if out > 0.0 || !out.is_finite() { return out }
    let d = (p.0 - b.x0).min(b.x1 - p.0).min(p.1 - b.y0).min(b.y1 - p.1);
    -d / b.longer_side()
}

/// One film through the app's region path: `check_film` with no shape scorer, the recorded facing right.
pub fn probe_film(regs: &Regions, pts: &[(String, f64, f64)], img_w: u32, img_h: u32, tau: &RegionTau) -> anyhow::Result<FilmProbe> {
    let marks: Vec<Mark> = REGION_OF.iter().filter_map(|(id, _)| pts.iter().find(|p| p.0 == *id)
        .map(|p| Mark { landmark_id: id.to_string(), x: p.1, y: p.2 })).collect();
    let r = check_film(None, &marks, false, img_w, img_h, RegionLook::Found(regs), &FilmCal::tau_only(tau))?;
    let reasons: &[Reason] = match &r.check { FilmCheck::Flagged { reasons } => reasons, _ => &[] };
    let (mut outside, mut signed, mut over_tau, mut region_flag) = ([None; 5], [None; 5], [false; 5], [false; 5]);
    for reg in REGIONS {
        let i = reg.index();
        region_flag[i] = reasons.iter().any(|x| matches!(x, Reason::Region { region, .. } if *region == reg));
        let Some(b) = regs.get(reg) else { continue };
        let mut worst = (f64::NEG_INFINITY, f64::NEG_INFINITY);
        for (id, _) in REGION_OF.iter().filter(|(_, q)| *q == reg) {
            let Some(p) = pts.iter().find(|p| p.0 == *id) else { continue };
            ensure!(p.1.is_finite() && p.2.is_finite(), "{id} is not a number");
            worst.0 = worst.0.max(outside_ratio(b, (p.1, p.2)));
            worst.1 = worst.1.max(signed_edge_ratio(b, (p.1, p.2)));
        }
        ensure!(worst.0.is_finite() && worst.1.is_finite(), "the {} region has no traced point to measure", reg.words());
        outside[i] = Some(worst.0);
        signed[i] = Some(worst.1);
        over_tau[i] = worst.0 > tau.get(reg);
    }
    Ok(FilmProbe { found: regs.found(), outside, signed, over_tau, region_flag,
        no_ceph: reasons.iter().any(|x| matches!(x, Reason::NoCephFound)), facing: reasons.iter().any(|x| matches!(x, Reason::Facing)),
        flagged: matches!(r.check, FilmCheck::Flagged { .. }) })
}

/// The positive control's plant: the mandible's traced points (Go, Me, Pog, B, Gn) moved `dx` px along x; others as they are.
pub fn mandible_forward(pts: &[(String, f64, f64)], dx: f64) -> Vec<(String, f64, f64)> {
    pts.iter().map(|(n, x, y)| {
        let m = REGION_OF.iter().any(|(id, r)| id == n && *r == Region::Mandible);
        (n.clone(), if m { x + dx } else { *x }, *y)
    }).collect()
}

/// Median, p90, p99 and max by nearest rank (the ⌈q n⌉-th smallest); all None (JSON null) when there is no value.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Dist { pub median: Option<f64>, pub p90: Option<f64>, pub p99: Option<f64>, pub max: Option<f64> }
pub fn dist(values: &[f64]) -> anyhow::Result<Dist> {
    ensure!(values.iter().all(|v| v.is_finite()), "a value to summarise is not a number");
    if values.is_empty() { return Ok(Dist { median: None, p90: None, p99: None, max: None }) }
    let mut v = values.to_vec();
    v.sort_by(f64::total_cmp);
    let rank = |per_mille: usize| Some(v[(per_mille * v.len()).div_ceil(1000) - 1]);
    Ok(Dist { median: rank(500), p90: rank(900), p99: rank(990), max: rank(1000) })
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionRow { pub region: Region, pub films: usize, pub not_found: usize, pub over_tau: usize, pub region_flags: usize, pub outside_ratio: Dist, pub signed_edge_ratio: Dist }
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetSummary {
    pub name: String, pub films: usize,
    /// Films with 5, 4, 3 and fewer than 3 regions found.
    pub found5: usize, pub found4: usize, pub found3: usize, pub found_fewer: usize,
    pub no_ceph_found: usize, pub facing: usize, pub flagged: usize, pub flagged_percent: f64, pub regions: Vec<RegionRow>,
}
/// The set's table. Every count is checked against `expected` (C7 style): a set of another size is broken.
pub fn summarise(name: &str, films: &[FilmProbe], expected: usize) -> anyhow::Result<SetSummary> {
    ft_common::counted(&format!("{name} films"), films.len(), expected)?;
    let n = |f: &dyn Fn(&FilmProbe) -> bool| films.iter().filter(|x| f(x)).count();
    let mut regions = Vec::new();
    for r in REGIONS {
        let i = r.index();
        let outside: Vec<f64> = films.iter().filter_map(|f| f.outside[i]).collect();
        let signed: Vec<f64> = films.iter().filter_map(|f| f.signed[i]).collect();
        let not_found = n(&|f| f.outside[i].is_none());
        ensure!(films.iter().all(|f| f.outside[i].is_some() == f.signed[i].is_some()), "{name}: the {} region's two ratios disagree on found", r.words());
        ft_common::counted(&format!("{name} films measured for the {} region (found + not found)", r.words()), outside.len() + not_found, expected)?;
        regions.push(RegionRow { region: r, films: outside.len() + not_found, not_found, over_tau: n(&|f| f.over_tau[i]), region_flags: n(&|f| f.region_flag[i]),
            outside_ratio: dist(&outside)?, signed_edge_ratio: dist(&signed)? });
    }
    let flagged = n(&|f| f.flagged);
    Ok(SetSummary { name: name.into(), films: films.len(), found5: n(&|f| f.found == 5), found4: n(&|f| f.found == 4), found3: n(&|f| f.found == 3),
        found_fewer: n(&|f| f.found < 3), no_ceph_found: n(&|f| f.no_ceph), facing: n(&|f| f.facing), flagged,
        flagged_percent: if films.is_empty() { f64::NAN } else { 100.0 * flagged as f64 / films.len() as f64 }, regions })
}

/// keep (≤ THRESHOLD flagged) / owner (more) / broken (the positive control flagged fewer than CONTROL_MIN of its films,
/// or its film count is not CEPH400_TRAIN).
pub fn verdict(train_flagged: usize, control_flagged: usize, control_films: usize) -> &'static str {
    if control_films != CEPH400_TRAIN || control_flagged < CONTROL_MIN { BROKEN }
    else if train_flagged <= THRESHOLD { KEEP } else { OWNER }
}
/// keep 0, owner 3, broken (or anything else) 1.
pub fn exit_code(v: &str) -> i32 { match v { KEEP => 0, OWNER => 3, _ => 1 } }

/// The probe reads only Aariz train (its hold-out) and Ceph-400 train. Held-back sets are refused by the ledger's own
/// gates; every other split (SC1-1a's Ceph-400 test1 and Aariz valid among them, and "all") is refused here.
pub fn refuse_reads(reads: &[(&Path, &str)]) -> anyhow::Result<()> {
    for (d, s) in reads {
        ledger::refuse_held_back(d, s)?;
        chainproof::refuse_held_back_cache(d, s)?;
        ensure!(*s == "train", "{} {s}: refused; this run reads only the train splits (Ceph-400 test1 and Aariz valid are SC1-1a's films, and stay unread)", d.display());
    }
    Ok(())
}

/// Ceph-400 Train's list: exactly 150 ids, each three digits in 001–150; otherwise refused before any film is read.
pub fn refuse_outside_train(ids: &[String]) -> anyhow::Result<()> {
    let bad = ids.iter().filter(|id| !(id.len() == 3 && id.bytes().all(|b| b.is_ascii_digit()) && (1..=150).contains(&id.parse::<u32>().unwrap_or(0)))).count();
    ensure!(bad == 0, "Ceph-400's train list names {bad} film(s) outside 001-150 (Test1 and Test2 are not read here): refused before any film is read");
    let unique: BTreeSet<&String> = ids.iter().collect();
    ensure!(unique.len() == ids.len() && ids.len() == CEPH400_TRAIN, "Ceph-400's train list has {} ids ({} different), not the {CEPH400_TRAIN} films 001-150: refused", ids.len(), unique.len());
    Ok(())
}

/// The calibration and the gate report are the pinned ones: the calibration's fingerprint, gate-report SHA-256, score
/// line and τ equal `pins`, the installed detector's fingerprint equals it, and `gate_report` (the bytes of
/// reports/sc1/box-gate.json) hashes to that SHA-256 with verdict pass.
pub fn check_calibration(c: &RegionCalibration, engine_fp: &str, gate_report: &[u8], pins: &Pins) -> anyhow::Result<()> {
    ensure!(engine_fp == pins.fingerprint, "the installed region finder is {engine_fp}, the probe is pinned to {}", pins.fingerprint);
    ensure!(c.detector_fingerprint == pins.fingerprint, "the calibration is for detector {}, the probe is pinned to {}", c.detector_fingerprint, pins.fingerprint);
    ensure!(c.gate_report_sha256 == pins.gate_report_sha256, "the calibration names gate report {}, the probe is pinned to {}", c.gate_report_sha256, pins.gate_report_sha256);
    ensure!(c.score_line == pins.score_line, "the calibration's score line is {}, the pinned one {}", c.score_line, pins.score_line);
    ensure!(c.tau.0 == pins.tau, "the calibration's tau {:?} is not the pinned {:?}", c.tau.0, pins.tau);
    let sha = ft_common::sha256_hex(gate_report);
    ensure!(sha == pins.gate_report_sha256, "the gate report's SHA-256 is {sha}, the pinned one {}", pins.gate_report_sha256);
    let v: serde_json::Value = serde_json::from_slice(gate_report).context("the gate report is not JSON")?;
    ensure!(v["verdict"] == sc1_gate::PASS, "the gate report's verdict is {}, not pass", v["verdict"]);
    Ok(())
}

/// The positive control's line in the report.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Control { pub plant: String, pub films: usize, pub flagged: usize, pub min: usize, pub holds: bool }
/// `region-probe.json`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProbeReport {
    pub version: String, pub prereg_sha256: String, pub git_sha: String, pub detector_fingerprint: String, pub gate_report_sha256: String,
    pub score_line: f32, pub tau: [f64; 5], pub sets: Vec<SetSummary>, pub control: Control,
    pub decision: String, pub verdict: String,
}
fn num(x: Option<f64>) -> String { x.map(|v| format!("{v:.4}")).unwrap_or_else(|| "none".into()) }
impl ProbeReport {
    pub fn exit_code(&self) -> i32 { exit_code(&self.verdict) }
    /// The printed lines: counts and percentiles only, never a film id.
    pub fn summary(&self) -> Vec<String> {
        let mut v = vec![format!("region false-alarm probe {} ({PREREG_PATH} sha256 {}); git HEAD {}; detector {}", self.version, self.prereg_sha256, self.git_sha, self.detector_fingerprint),
            format!("calibration: score line {:.2}; tau {}; gate report sha256 {}", self.score_line,
                REGIONS.iter().map(|r| format!("{} {:.2}", r.words(), self.tau[r.index()])).collect::<Vec<_>>().join(", "), self.gate_report_sha256)];
        for s in &self.sets {
            v.push(format!("{}: {} films; regions found 5/4/3/<3: {}/{}/{}/{}; no-ceph-found {}; facing {}; FLAGGED by the region rules {} ({:.1}%)",
                s.name, s.films, s.found5, s.found4, s.found3, s.found_fewer, s.no_ceph_found, s.facing, s.flagged, s.flagged_percent));
            v.push("  region               films  not found  above tau  region flags  outside ratio median/p90/p99/max      signed edge ratio median/p90/p99/max".into());
            for r in &s.regions {
                v.push(format!("  {:<20} {:>5}  {:>9}  {:>9}  {:>12}  {} / {} / {} / {}      {} / {} / {} / {}", r.region.words(), r.films, r.not_found, r.over_tau, r.region_flags,
                    num(r.outside_ratio.median), num(r.outside_ratio.p90), num(r.outside_ratio.p99), num(r.outside_ratio.max),
                    num(r.signed_edge_ratio.median), num(r.signed_edge_ratio.p90), num(r.signed_edge_ratio.p99), num(r.signed_edge_ratio.max)));
            }
        }
        v.push(format!("positive control ({}): flagged {} of {} (needs at least {}): {}", self.control.plant, self.control.flagged, self.control.films, self.control.min,
            if self.control.holds { "holds" } else { "BLIND (the probe is broken)" }));
        v.push(format!("decision: {}", self.decision));
        v.push(format!("verdict {} (exit {}: 0 keep tau and proceed to SC1-1a, 3 to the owner, 1 broken)", self.verdict, self.exit_code()));
        v
    }
}

/// One set through the probe: per film the detector's boxes at the score line, `probe_film` on the expert tracing and,
/// with `control`, on the tracing with the mandible moved forward.
fn probe_set(engine: &RegionEngine, data: &Path, ids: &[String], gt: &dataset::Points, cache: &Path, cal: &RegionCalibration, fp: &str, control: bool)
    -> anyhow::Result<(Vec<FilmProbe>, Vec<FilmProbe>)> {
    let found = sc1_boxes::boxes_for(engine, data, "train", ids, cache, false)?;
    ft_common::counted("films with boxes", found.len(), ids.len())?;
    let (mut films, mut planted) = (Vec::new(), Vec::new());
    for id in ids {
        let f = &found[id];
        sc1_gate::best_scores(f)?;
        let regs = Regions::from_scored(&sc1_boxes::region_boxes(f), cal.score_line, fp)?;
        let pts: Vec<(String, f64, f64)> = gt[id].iter().filter(|(n, _, _)| REGION_OF.iter().any(|(r, _)| r == n)).cloned().collect();
        films.push(probe_film(&regs, &pts, f.image_width, f.image_height, &cal.tau)?);
        if control { planted.push(probe_film(&regs, &mandible_forward(&pts, CONTROL_SHIFT_PX), f.image_width, f.image_height, &cal.tau)?); }
    }
    Ok((films, planted))
}

/// The whole run up to the report (nothing written). An error is broken.
fn probe_run(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git, pins: &Pins) -> anyhow::Result<ProbeReport> {
    // The refused sets first, before any file is read.
    refuse_reads(&[(aariz, "train"), (ceph400, "train")])?;
    ensure!(crate::scale::is_aariz(aariz), "{}: the hold-out is Aariz train, and this folder is not Aariz", aariz.display());
    ensure!(sc1_gate::is_ceph400(ceph400), "{}: the probe reads Ceph-400 train, and this folder is not Ceph-400", ceph400.display());
    ensure!(!git.dirty, "commit first: the probe is pre-registered ({PREREG_PATH}) and runs only from a clean tree");
    ft_common::committed_as_built(PREREG_PATH, PREREG, git.prereg_at_head.clone())?;
    let v: serde_json::Value = serde_json::from_str(PREREG)?;
    ensure!(v["version"] == VERSION, "this program knows {VERSION}, not {}", v["version"]);
    ensure!(v["decision"]["threshold"].as_u64() == Some(THRESHOLD as u64), "the pre-registered threshold is not the program's {THRESHOLD}");
    sc1_data::ensure_outside_or_ignored(out)?;
    // The lists: Ceph-400 train is 001-150; the hold-out lies in Aariz train and shares no film with valid.
    let c4_ids = dataset::select(&dataset::load_splits(&ceph400.join("splits.json"))?, "train")?;
    refuse_outside_train(&c4_ids)?;
    let (train, valid) = sc1_gate::aariz_train_valid(aariz)?;
    let train: BTreeSet<String> = train.into_iter().collect();
    ensure!(split.holdout.iter().all(|id| train.contains(id)), "a hold-out film of the split file is not in Aariz train: refused");
    ensure!(valid.iter().all(|id| !train.contains(id)), "Aariz valid shares films with train: refused");
    // The detector, the calibration and the gate report: the pinned ones.
    let engine = RegionEngine::load(&regions_manifest_path(models))?;
    let fp = engine.spec().fingerprint();
    let cp = calibration_path(models);
    let cal = parse_calibration(&std::fs::read(&cp).with_context(|| cp.display().to_string())?)?;
    let gp = out.join("box-gate.json");
    let gate = std::fs::read(&gp).with_context(|| format!("{}: the probe needs Task 10's gate report", gp.display()))?;
    check_calibration(&cal, &fp, &gate, pins)?;
    // The expert tracings, complete.
    let c4_gt = dataset::load_points(&ceph400.join("gt.csv"))?;
    let az_gt = dataset::load_points(&aariz.join("gt.csv"))?;
    sc1_gate::complete(&c4_gt, &c4_ids, "Ceph-400 train")?;
    sc1_gate::complete(&az_gt, &split.holdout, "hold-out")?;
    // The two sets and the control.
    let cache = out.join("boxes");
    let (c4, control) = probe_set(&engine, ceph400, &c4_ids, &c4_gt, &cache, &cal, &fp, true)?;
    let (hold, _) = probe_set(&engine, aariz, &split.holdout, &az_gt, &cache, &cal, &fp, false)?;
    let sets = vec![summarise("Ceph-400 train 001-150", &c4, CEPH400_TRAIN)?, summarise("Aariz-train hold-out (information)", &hold, split.holdout.len())?];
    let control_flagged = control.iter().filter(|f| f.flagged).count();
    let verdict = verdict(sets[0].flagged, control_flagged, control.len());
    let decision = match verdict {
        KEEP => format!("Ceph-400 train flagged {} of {CEPH400_TRAIN} <= {THRESHOLD}: keep tau as is and proceed to SC1-1a", sets[0].flagged),
        OWNER => format!("Ceph-400 train flagged {} of {CEPH400_TRAIN} > {THRESHOLD}: stop; to the owner with options; tau unchanged by this probe", sets[0].flagged),
        _ => "none: the positive control did not hold, nothing concluded".into(),
    };
    Ok(ProbeReport { version: VERSION.into(), prereg_sha256: ft_common::sha256_hex(PREREG.as_bytes()), git_sha: git.sha.clone(), detector_fingerprint: fp,
        gate_report_sha256: cal.gate_report_sha256.clone(), score_line: cal.score_line, tau: cal.tau.0, sets,
        control: Control { plant: "mandible's five points 40 mm (400 px) forward".into(), films: control.len(), flagged: control_flagged, min: CONTROL_MIN, holds: verdict != BROKEN },
        decision, verdict: verdict.into() })
}

/// The run on given folders, split, git state and pins: prints the aggregates, writes `<out>/region-probe.json` on keep
/// or owner. Exit 0 keep, 3 owner, 1 broken (nothing written).
pub fn run_with(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git, pins: &Pins) -> anyhow::Result<i32> {
    let rep = match probe_run(aariz, ceph400, models, out, split, git, pins) {
        Ok(r) => r,
        Err(e) => { eprintln!("region probe broken (nothing written): {e:#}"); return Ok(1); }
    };
    for l in rep.summary() { println!("{l}"); }
    if rep.verdict == BROKEN { eprintln!("region probe broken (nothing written): the positive control did not hold"); return Ok(1); }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let path = out.join("region-probe.json");
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {})", path.display(), ft_common::sha256_hex(text.as_bytes()));
    Ok(rep.exit_code())
}

/// `--sc1-region-probe`: the pinned split (its SHA-256 checked), the git state, the pre-registration's pins, then
/// `run_with`. The refused sets are refused first.
pub fn run_cli(aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Split, Git, Pins)> {
        refuse_reads(&[(aariz, "train"), (ceph400, "train")])?;
        let p = sc1_data::split_path()?;
        let text = std::fs::read_to_string(&p).with_context(|| p.display().to_string())?;
        ensure!(ft_common::sha256_hex(text.as_bytes()) == sc1_data::PINNED_SPLIT_SHA256, "{} is not the pinned split (SHA-256 differs)", p.display());
        let split = sc1_data::load_split(&text)?;
        Ok((split, sc1_gate::git_state(PREREG_PATH)?, Pins::from_prereg()?))
    };
    match pre() {
        Ok((split, git, pins)) => run_with(aariz, ceph400, models, out, &split, &git, &pins),
        Err(e) => { eprintln!("region probe broken (nothing written): {e:#}"); Ok(1) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ceph_model::wholefilm::teaching_boxes;

    /// The pre-registration's SHA-256, pinned when it was committed (44295d3, before any run).
    const PINNED_SHA256: &str = "6a42cab76e0d0af7e0be1759371c020ac416346e475d3018a9f76003a15cb758";
    const FP: &str = "17171e68f9f7072062e2a3a2cbd4851618056f5136bed998f1782c49d4897b80";
    const GATE: &str = "b11ad41da0760a2a7832c5d87fa372fc91b3c3a1dd5b549d94f4e7164c123eb2";

    /// Fails if the file changes by one byte, or if its numbers are not the program's.
    #[test] fn the_preregistration_is_pinned() {
        assert_eq!(ft_common::sha256_hex(PREREG.as_bytes()), PINNED_SHA256, "reference/sc1-region-probe.json changed: the owner's OK, then a new version");
        let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
        assert_eq!(v["version"], VERSION);
        assert_eq!(v["decision"]["threshold"].as_u64(), Some(THRESHOLD as u64));
        assert!(v["controls"]["positive"].as_str().unwrap().contains(&format!("at least {CONTROL_MIN} of {CEPH400_TRAIN}")));
        assert!(v["controls"]["positive"].as_str().unwrap().contains("40 mm (400 px at 0.1 mm/px)"));
        let p = Pins::from_prereg().unwrap();
        eprintln!("pins {p:?}");
        assert_eq!((p.fingerprint.as_str(), p.gate_report_sha256.as_str(), p.score_line, p.tau), (FP, GATE, 0.5, [0.09, 0.01, 0.01, 0.01, 0.01]));
    }

    /// A SYNTHETIC 19-point tracing on a 2000 x 1600 film, facing right (soft tissue in front of the cranial base).
    fn tracing() -> Vec<(String, f64, f64)> {
        [("S", 600.0, 500.0), ("N", 1300.0, 450.0), ("Po", 400.0, 650.0), ("Ar", 500.0, 800.0), ("Or", 1150.0, 600.0),
         ("A", 1350.0, 900.0), ("ANS", 1380.0, 820.0), ("PNS", 900.0, 850.0),
         ("Go", 650.0, 1150.0), ("Me", 1200.0, 1350.0), ("Pog", 1300.0, 1250.0), ("B", 1290.0, 1150.0), ("Gn", 1260.0, 1320.0),
         ("U1T", 1380.0, 1040.0), ("L1T", 1360.0, 1080.0),
         ("Sn", 1450.0, 850.0), ("UL", 1480.0, 960.0), ("LL", 1470.0, 1100.0), ("PogS", 1400.0, 1300.0)]
            .iter().map(|(n, x, y)| (n.to_string(), *x, *y)).collect()
    }
    const W: u32 = 2000;
    const H: u32 = 1600;
    const TAU: RegionTau = RegionTau([0.09, 0.01, 0.01, 0.01, 0.01]);
    /// The tracing's own teaching boxes as the detector's (score 0.9), at score line 0.5.
    fn own(pts: &[(String, f64, f64)]) -> Regions {
        let b: Vec<RegionBox> = teaching_boxes(pts, W, H).into_iter().map(|b| RegionBox { score: 0.9, ..b }).collect();
        Regions::from_scored(&b, 0.5, FP).unwrap()
    }
    fn set(pts: &mut [(String, f64, f64)], id: &str, x: f64, y: f64) { let p = pts.iter_mut().find(|p| p.0 == id).unwrap(); p.1 = x; p.2 = y; }

    /// Fails if inside points read 0 (no headroom) or outside points differ from the app's outside-ratio.
    #[test] fn the_signed_edge_ratio_is_minus_the_headroom_inside_and_the_outside_ratio_outside() {
        let b = RegionBox { region: Region::Maxilla, x0: 0.0, y0: 0.0, x1: 200.0, y1: 100.0, score: 0.9 };
        assert_eq!(signed_edge_ratio(&b, (100.0, 50.0)), -0.25, "50 px from the nearest edge (top/bottom) / 200");
        assert_eq!(signed_edge_ratio(&b, (10.0, 50.0)), -0.05, "10 px from the left edge / 200");
        assert_eq!(signed_edge_ratio(&b, (200.0, 50.0)), 0.0, "on the edge");
        assert_eq!(signed_edge_ratio(&b, (230.0, 50.0)), outside_ratio(&b, (230.0, 50.0)));
        assert_eq!(signed_edge_ratio(&b, (230.0, 50.0)), 0.15);
    }

    /// The clean case: every point inside its own teaching box (10% margin): found 5, outside 0, the worst point's
    /// headroom about the margin, nothing flagged. Fails if probe_film flags a clean tracing or drops a region.
    #[test] fn a_clean_tracing_on_its_own_boxes_is_not_flagged() {
        let pts = tracing();
        let f = probe_film(&own(&pts), &pts, W, H, &TAU).unwrap();
        eprintln!("clean: {f:?}");
        assert_eq!((f.found, f.no_ceph, f.facing, f.flagged, f.over_tau, f.region_flag), (5, false, false, false, [false; 5], [false; 5]));
        assert!(f.outside.iter().all(|o| *o == Some(0.0)), "{:?}", f.outside);
        assert!(f.signed.iter().all(|s| s.is_some_and(|s| s < 0.0 && s >= -0.5)), "{:?}", f.signed);
        for s in f.signed { assert!((s.unwrap() + 0.10 / 1.2).abs() < 1e-9, "the extreme point sits margin / (1 + 2 margin) inside: {s:?}"); }
    }

    /// One point just above τ (0.05 > 0.01 in the maxilla) is a maxilla flag; one at 0.005 (below τ) is not.
    /// Fails if `>` becomes `>=` on the wrong side, τ is ignored, or the wrong region is named.
    #[test] fn a_point_above_tau_is_a_region_flag_and_one_below_is_not() {
        let pts = tracing();
        let regs = own(&pts);
        let m = *regs.get(Region::Maxilla).unwrap();
        for (out, want) in [(0.05, true), (0.005, false)] {
            let mut p = pts.clone();
            set(&mut p, "ANS", m.x1 + out * m.longer_side(), (m.y0 + m.y1) / 2.0);
            let f = probe_film(&regs, &p, W, H, &TAU).unwrap();
            eprintln!("ANS {out} outside the maxilla box: {f:?}");
            assert!((f.outside[1].unwrap() - out).abs() < 1e-9);
            assert_eq!((f.over_tau[1], f.region_flag[1], f.flagged), (want, want, want));
            assert_eq!(f.over_tau.iter().filter(|x| **x).count(), want as usize, "only the maxilla");
        }
    }

    /// A point off the film is a region flag (the app's rule) though its outside-ratio is what it is.
    #[test] fn a_point_off_the_film_is_a_region_flag() {
        let mut p = tracing();
        set(&mut p, "PogS", W as f64 + 10.0, 1300.0);
        let f = probe_film(&own(&tracing()), &p, W, H, &RegionTau([10.0; 5])).unwrap();
        eprintln!("PogS off the film, tau 10: {f:?}");
        assert_eq!((f.over_tau[4], f.region_flag[4], f.flagged), (false, true, true));
    }

    /// Not found: a region not found has null outside and signed ratios and gives no region flag; fewer than 3 found is
    /// no-ceph-found (a flag). Fails if a missing region reads 0 (looks clean) or NaN, or the 3-of-5 rule is dropped.
    #[test] fn a_region_not_found_is_null_and_fewer_than_three_is_no_ceph_found() {
        let pts = tracing();
        let mut regs = own(&pts);
        regs.boxes.retain(|b| b.region != Region::Incisors);
        let f = probe_film(&regs, &pts, W, H, &TAU).unwrap();
        eprintln!("incisors not found: {f:?}");
        assert_eq!((f.found, f.outside[3], f.signed[3], f.region_flag[3], f.no_ceph, f.flagged), (4, None, None, false, false, false));
        regs.boxes.retain(|b| b.region == Region::Maxilla || b.region == Region::CranialBase);
        let f = probe_film(&regs, &pts, W, H, &TAU).unwrap();
        eprintln!("2 found: {f:?}");
        assert_eq!((f.found, f.no_ceph, f.flagged), (2, true, true));
    }

    /// The detector's facing (soft tissue left of the cranial base) against the recorded facing right is a facing flag.
    #[test] fn the_detectors_facing_against_the_recorded_facing_is_a_flag() {
        let pts = tracing();
        let mut regs = own(&pts);
        regs.facing_left = Some(true);
        let f = probe_film(&regs, &pts, W, H, &TAU).unwrap();
        eprintln!("detector says left: {f:?}");
        assert_eq!((f.facing, f.flagged, f.region_flag), (true, true, [false; 5]));
    }

    /// The control's plant moves exactly the five mandible points by dx, and on the synthetic film it is a mandible flag.
    #[test] fn the_control_moves_the_mandible_forward_and_is_flagged() {
        let pts = tracing();
        let moved = mandible_forward(&pts, CONTROL_SHIFT_PX);
        for ((a, b), (n, r)) in pts.iter().zip(&moved).zip(REGION_OF.iter()) {
            assert_eq!(&a.0, n);
            let dx = if *r == Region::Mandible { CONTROL_SHIFT_PX } else { 0.0 };
            assert_eq!((b.0.as_str(), b.1, b.2), (a.0.as_str(), a.1 + dx, a.2), "{n}");
        }
        let f = probe_film(&own(&pts), &moved, W, H, &TAU).unwrap();
        eprintln!("mandible +400 px: {f:?}");
        assert!(f.region_flag[2] && f.flagged);
        let f0 = probe_film(&own(&pts), &mandible_forward(&pts, 0.0), W, H, &TAU).unwrap();
        assert!(!f0.flagged, "a 0 px shift is not flagged: the control moves only because of the shift");
    }

    /// Nearest rank on known values, None (null) on none. Fails on a mean-of-two median or an off-by-one rank.
    #[test] fn dist_is_nearest_rank_and_null_on_no_values() {
        let v: Vec<f64> = (1..=150).map(|i| i as f64).collect();
        assert_eq!(dist(&v).unwrap(), Dist { median: Some(75.0), p90: Some(135.0), p99: Some(149.0), max: Some(150.0) });
        assert_eq!(dist(&[3.0, 1.0, 2.0, 4.0]).unwrap(), Dist { median: Some(2.0), p90: Some(4.0), p99: Some(4.0), max: Some(4.0) });
        let none = dist(&[]).unwrap();
        assert_eq!(none, Dist { median: None, p90: None, p99: None, max: None });
        assert_eq!(serde_json::to_string(&none).unwrap(), r#"{"median":null,"p90":null,"p99":null,"max":null}"#);
        assert!(dist(&[1.0, f64::NAN]).is_err(), "a NaN is never a value");
    }

    fn clean() -> FilmProbe { FilmProbe { found: 5, outside: [Some(0.0); 5], signed: [Some(-0.08); 5], over_tau: [false; 5], region_flag: [false; 5], no_ceph: false, facing: false, flagged: false } }

    /// The counting: per region not found / over τ / region flags, the found buckets, flagged as count and percent.
    /// Fails if a not-found region enters the distribution, a flag is miscounted, or the count check is skipped.
    #[test] fn the_summary_counts_each_film_once_and_keeps_not_found_out_of_the_distribution() {
        let mut fs = vec![clean(); 10];
        fs[0].outside[3] = None; fs[0].signed[3] = None; fs[0].found = 4;
        fs[1].outside[1] = Some(0.05); fs[1].signed[1] = Some(0.05); fs[1].over_tau[1] = true; fs[1].region_flag[1] = true; fs[1].flagged = true;
        fs[2].found = 2; fs[2].no_ceph = true; fs[2].flagged = true; for r in 2..5 { fs[2].outside[r] = None; fs[2].signed[r] = None; }
        fs[3].facing = true; fs[3].flagged = true;
        let s = summarise("SYNTHETIC", &fs, 10).unwrap();
        eprintln!("{}", serde_json::to_string(&s).unwrap());
        assert_eq!((s.films, s.found5, s.found4, s.found3, s.found_fewer, s.no_ceph_found, s.facing, s.flagged), (10, 8, 1, 0, 1, 1, 1, 3));
        assert_eq!(s.flagged_percent, 30.0);
        let inc = &s.regions[3];
        assert_eq!((inc.films, inc.not_found, inc.over_tau, inc.region_flags), (10, 2, 0, 0));
        let max = &s.regions[1];
        assert_eq!((max.not_found, max.over_tau, max.region_flags, max.outside_ratio.max, max.signed_edge_ratio.max), (0, 1, 1, Some(0.05), Some(0.05)));
        assert_eq!(max.outside_ratio.median, Some(0.0));
        let e = summarise("SYNTHETIC", &fs, 11).unwrap_err().to_string();
        eprintln!("10 films for 11: {e}");
        assert!(e.starts_with("SYNTHETIC films: compared 10, expected 11"), "the set's own count, not only a region's: {e}");
        let mut all_out = vec![clean(); 3];
        for f in &mut all_out { f.outside[0] = None; f.signed[0] = None; f.found = 4; }
        let s = summarise("SYNTHETIC", &all_out, 3).unwrap();
        assert_eq!((s.regions[0].not_found, s.regions[0].outside_ratio.median), (3, None), "a region found on no film is null, not 0");
    }

    /// The decision's edge (3 → keep, exit 0; 4 → owner, exit 3) and the control (139 of 150 → broken; 140 → judged).
    /// Fails if the threshold moves by one either way or the control is not checked.
    #[test] fn the_threshold_edge_and_the_control() {
        assert_eq!((verdict(3, 150, 150), exit_code(verdict(3, 150, 150))), ("keep", 0));
        assert_eq!((verdict(0, 140, 150), exit_code(verdict(0, 140, 150))), ("keep", 0));
        assert_eq!((verdict(4, 150, 150), exit_code(verdict(4, 150, 150))), ("owner", 3));
        assert_eq!((verdict(0, 139, 150), exit_code(verdict(0, 139, 150))), ("broken", 1));
        assert_eq!((verdict(4, 139, 150), exit_code(verdict(4, 139, 150))), ("broken", 1), "a blind probe is broken even when it flags many");
        assert_eq!(verdict(0, 140, 149), "broken", "the control must cover all 150");
        assert_eq!(exit_code("anything"), 1);
    }

    /// The refusals: SC1-1a's sets, the held-back sets and "all" are refused; Aariz train and Ceph-400 train are read.
    #[test] fn the_probe_refuses_sc1_1a_and_held_back_sets() {
        let d = tempfile::tempdir().unwrap();
        let (az, c4) = (d.path().join("aariz"), d.path().join("ceph400"));
        for p in [&az, &c4] { std::fs::create_dir_all(p).unwrap(); }
        assert!(refuse_reads(&[(&az, "train"), (&c4, "train")]).is_ok());
        for (p, s) in [(&c4, "test1"), (&az, "valid"), (&c4, "test2"), (&az, "test"), (&az, "all"), (&c4, "all"), (&c4, "Test1")] {
            let e = refuse_reads(&[(&az, "train"), (p, s)]).unwrap_err().to_string();
            eprintln!("{} {s}: {e}", p.file_name().unwrap().to_string_lossy());
            assert!(e.contains("refused") || e.contains("held back"), "{e}");
        }
    }

    /// Ceph-400 Train's list: 150 ids, 001–150; a Test1 or Test2 id, a bad name, or a short list is refused.
    #[test] fn the_train_list_is_001_to_150_only() {
        let ok: Vec<String> = (1..=150).map(|i| format!("{i:03}")).collect();
        assert!(refuse_outside_train(&ok).is_ok());
        for (what, bad) in [("151", "151"), ("301", "301"), ("1", "1"), ("abc", "abc"), ("000", "000")] {
            let mut l = ok.clone(); l[5] = bad.to_string();
            let e = refuse_outside_train(&l).unwrap_err().to_string();
            eprintln!("{what}: {e}");
        }
        assert!(refuse_outside_train(&ok[..149]).is_err(), "149 films");
        let mut dup = ok.clone(); dup[1] = "001".into();
        assert!(refuse_outside_train(&dup).is_err(), "a repeated id");
    }

    /// The calibration and gate report must be the pinned ones. Fails if any of the six checks is dropped.
    #[test] fn the_calibration_and_gate_report_must_be_the_pinned_ones() {
        let report = br#"{"verdict": "pass"}"#.to_vec();
        let sha = ft_common::sha256_hex(&report);
        let pins = Pins { fingerprint: FP.into(), gate_report_sha256: sha.clone(), score_line: 0.5, tau: [0.09, 0.01, 0.01, 0.01, 0.01] };
        let cal = RegionCalibration { version: "region-calibration/1".into(), detector_fingerprint: FP.into(), score_line: 0.5,
            tau: RegionTau(pins.tau), gate_report_sha256: sha.clone(), rule: None };
        check_calibration(&cal, FP, &report, &pins).unwrap();
        let other = "0".repeat(64);
        let cases: Vec<(&str, RegionCalibration, String, Vec<u8>)> = vec![
            ("calibration for another detector", RegionCalibration { detector_fingerprint: other.clone(), ..cal.clone() }, FP.into(), report.clone()),
            ("another detector installed", cal.clone(), other.clone(), report.clone()),
            ("calibration names another gate report", RegionCalibration { gate_report_sha256: other.clone(), ..cal.clone() }, FP.into(), report.clone()),
            ("gate report changed", cal.clone(), FP.into(), br#"{"verdict": "pass" }"#.to_vec()),
            ("score line moved", RegionCalibration { score_line: 0.49, ..cal.clone() }, FP.into(), report.clone()),
            ("tau moved", RegionCalibration { tau: RegionTau([0.09, 0.02, 0.01, 0.01, 0.01]), ..cal.clone() }, FP.into(), report.clone()),
        ];
        for (what, c, fp, r) in cases {
            let e = check_calibration(&c, &fp, &r, &pins).unwrap_err().to_string();
            eprintln!("{what}: {e}");
        }
        let stop = br#"{"verdict": "stop"}"#.to_vec();
        let p2 = Pins { gate_report_sha256: ft_common::sha256_hex(&stop), ..pins.clone() };
        let c2 = RegionCalibration { gate_report_sha256: p2.gate_report_sha256.clone(), ..cal.clone() };
        let e = check_calibration(&c2, FP, &stop, &p2).unwrap_err().to_string();
        eprintln!("gate report says stop: {e}");
        assert!(e.contains("pass"), "{e}");
    }

    // ---- run_with on SYNTHETIC folders (80 x 80 grey ramps; the tiny region model; never data/ or models/) ----

    use ceph_infer::regions::{RegionClass, RegionInput, RegionOutputs, RegionSpec};
    use std::path::PathBuf;
    const FW: u32 = 80;
    fn write_models(root: &Path) -> PathBuf {
        let m = root.join("models");
        let p = regions_manifest_path(&m);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let onnx = std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("ceph-infer").join("tests").join("fixtures").join("tiny-regions.onnx")).unwrap();
        std::fs::write(p.parent().unwrap().join("tiny-regions.onnx"), &onnx).unwrap();
        let s = RegionSpec { manifest_version: 2, kind: "regions".into(), id: "tiny-regions".into(), version: "synthetic-1".into(),
            title: "SYNTHETIC".into(), file: "tiny-regions.onnx".into(), sha256: ft_common::sha256_hex(&onnx),
            input: RegionInput { name: "input".into(), width: 8, height: 8, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
            outputs: RegionOutputs { boxes: "dets".into(), logits: "labels".into(), box_format: "cxcywh-normalised".into(), score: "sigmoid".into() },
            classes: ceph_infer::regions::REGION_KEYS.iter().enumerate().map(|(i, k)| RegionClass { region: k.to_string(), logit_index: i + 1 }).collect(),
            runtime: ceph_infer::spec::Runtime::Cpu, training_note: "SYNTHETIC".into() };
        std::fs::write(&p, serde_json::to_vec_pretty(&s).unwrap()).unwrap();
        m
    }
    fn ramp(p: &Path, k: u32) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        image::GrayImage::from_fn(FW, FW, |x, y| image::Luma([((x * 3 + y + k * 7) % 256) as u8])).save(p).unwrap();
    }
    /// A full 19-point tracing whose points sit inside the tiny model's boxes scaled by `k` about their centres
    /// (k = 1: each point a twelfth of the side inside; k = 3: the outer points well outside the detected box).
    fn tracing_for(found: &[RegionBox], k: f64) -> Vec<(String, f64, f64)> {
        REGION_OF.iter().map(|(name, r)| {
            let t = found.iter().find(|b| b.region == *r).unwrap().inflated(k);
            let m = t.longer_side() / 12.0;
            let (a0, b0, a1, b1) = (t.x0 + m, t.y0 + m, t.x1 - m, t.y1 - m);
            let pts = [(a0, b0), (a1, b1), ((a0 + a1) / 2.0, (b0 + b1) / 2.0)];
            let i = REGION_OF.iter().filter(|(_, q)| q == r).position(|(n, _)| n == name).unwrap();
            (name.to_string(), pts[i.min(2)].0, pts[i.min(2)].1)
        }).collect()
    }
    fn gt_text(rows: &[(String, Vec<(String, f64, f64)>)]) -> String {
        let mut s = String::from("image_id,landmark,x,y\n");
        for (id, tr) in rows { for (n, x, y) in tr { s += &format!("{id},{n},{x},{y}\n"); } }
        s
    }
    struct Px { _d: tempfile::TempDir, aariz: PathBuf, ceph400: PathBuf, models: PathBuf, out: PathBuf, split: Split, pins: Pins, git: Git, found: Vec<RegionBox> }
    impl Px {
        fn run(&self) -> i32 { run_with(&self.aariz, &self.ceph400, &self.models, &self.out, &self.split, &self.git, &self.pins).unwrap() }
        fn report(&self) -> PathBuf { self.out.join("region-probe.json") }
        /// Ceph-400 Train's tracings: the first `bad` films' at k = 3 (outside their boxes), the rest at k = 1.
        fn ceph400_tracings(&self, bad: usize) {
            let rows: Vec<(String, Vec<(String, f64, f64)>)> = (1..=150).map(|i| (format!("{i:03}"), tracing_for(&self.found, if i <= bad { 3.0 } else { 1.0 }))).collect();
            std::fs::write(self.ceph400.join("gt.csv"), gt_text(&rows)).unwrap();
        }
        fn write_calibration(&self, tau: [f64; 5]) {
            let c = RegionCalibration { version: "region-calibration/1".into(), detector_fingerprint: self.pins.fingerprint.clone(), score_line: self.pins.score_line,
                tau: RegionTau(tau), gate_report_sha256: self.pins.gate_report_sha256.clone(), rule: None };
            std::fs::write(calibration_path(&self.models), ceph_model::wholefilm::calibration_json(&c).unwrap()).unwrap();
        }
    }
    /// SYNTHETIC Aariz (20 train films, 3 valid) and Ceph-400 (train 001-150 with images; test1 151-152 and test2 301
    /// listed, never given an image), the tiny model, a pass gate report and its calibration.
    fn px() -> Px {
        let d = tempfile::tempdir().unwrap();
        let (aariz, ceph400) = (d.path().join("aariz"), d.path().join("ceph400"));
        let train: Vec<String> = (1..=20).map(|i| format!("tr-{i:04}")).collect();
        let valid: Vec<String> = (1..=3).map(|i| format!("va-{i:04}")).collect();
        let c4: Vec<String> = (1..=150).map(|i| format!("{i:03}")).collect();
        for (i, id) in train.iter().enumerate() { ramp(&aariz.join("images").join(format!("{id}.png")), i as u32); }
        for (i, id) in c4.iter().enumerate() { ramp(&ceph400.join("images").join(format!("{id}.png")), 40 + i as u32); }
        let models = write_models(d.path());
        let engine = RegionEngine::load(&regions_manifest_path(&models)).unwrap();
        let found = sc1_boxes::region_boxes(&engine.find(&sc1_boxes::film(&aariz, &train[0], false).unwrap()).unwrap());
        let tr = tracing_for(&found, 1.0);
        std::fs::write(aariz.join("gt.csv"), gt_text(&train.iter().chain(&valid).map(|id| (id.clone(), tr.clone())).collect::<Vec<_>>())).unwrap();
        std::fs::write(aariz.join("splits.json"), serde_json::json!({"train": train, "valid": valid, "test": ["te-0001"]}).to_string()).unwrap();
        std::fs::write(ceph400.join("splits.json"), serde_json::json!({"train": c4, "test1": ["151", "152"], "test2": ["301"]}).to_string()).unwrap();
        let out = d.path().join("reports").join("sc1");
        std::fs::create_dir_all(&out).unwrap();
        let gate = b"{\n  \"verdict\": \"pass\"\n}\n";
        std::fs::write(out.join("box-gate.json"), gate).unwrap();
        let pins = Pins { fingerprint: engine.spec().fingerprint(), gate_report_sha256: ft_common::sha256_hex(gate), score_line: 0.01, tau: [0.09, 0.01, 0.01, 0.01, 0.01] };
        let p = Px { split: crate::sc1_data::split(&train).unwrap(), pins, git: Git { prereg_at_head: Some(PREREG.as_bytes().to_vec()), dirty: false, sha: "SYNTHETIC".into() },
            aariz, ceph400, models, out, found, _d: d };
        p.ceph400_tracings(0);
        p.write_calibration(p.pins.tau);
        p
    }

    /// The keep path end to end: clean tracings, exit 0; the report names both sets with their totals, nothing flagged;
    /// the positive control flags all 150. Then the threshold edge through the real run: 3 bad films exit 0, 4 exit 3.
    /// Fails if the run reads another number than the flagged count, or the control is not run.
    #[test] fn run_with_keeps_tau_at_3_flagged_and_goes_to_the_owner_at_4() {
        let p = px();
        let code = p.run();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p.report()).unwrap()).unwrap();
        eprintln!("clean: exit {code}; verdict {}; sets {}; control {}", v["verdict"], v["sets"].as_array().unwrap().iter().map(|s| format!("{} {} films {} flagged", s["name"], s["films"], s["flagged"])).collect::<Vec<_>>().join(" / "), v["control"]);
        assert_eq!((code, v["verdict"].as_str().unwrap()), (0, "keep"));
        assert_eq!((v["sets"][0]["films"].as_u64(), v["sets"][0]["flagged"].as_u64()), (Some(150), Some(0)));
        assert_eq!((v["sets"][1]["films"].as_u64(), v["sets"][1]["flagged"].as_u64()), (Some(p.split.holdout.len() as u64), Some(0)));
        assert_eq!((v["control"]["films"].as_u64(), v["control"]["flagged"].as_u64()), (Some(150), Some(150)));
        assert_eq!(v["preregSha256"], ft_common::sha256_hex(PREREG.as_bytes()));
        for (bad, want, verdict) in [(3, 0, "keep"), (4, 3, "owner")] {
            p.ceph400_tracings(bad);
            let code = p.run();
            let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(p.report()).unwrap()).unwrap();
            eprintln!("{bad} films outside their boxes: exit {code}; verdict {}; flagged {} ({}%)", v["verdict"], v["sets"][0]["flagged"], v["sets"][0]["flaggedPercent"]);
            assert_eq!((code, v["verdict"].as_str().unwrap(), v["sets"][0]["flagged"].as_u64()), (want, verdict, Some(bad as u64)));
        }
    }

    /// Broken, nothing written: a dirty tree, a pre-registration not committed or changed at HEAD, a calibration whose τ
    /// differs from the pinned one, a missing gate report, a Ceph-400 train list naming a Test1 film.
    #[test] fn run_with_is_broken_and_writes_nothing_on_any_guard() {
        let mut p = px();
        let mut changed = PREREG.as_bytes().to_vec();
        changed[10] ^= 1;
        for (what, head, dirty) in [("not committed", None, false), ("changed at HEAD", Some(changed), false), ("dirty tree", Some(PREREG.as_bytes().to_vec()), true)] {
            p.git = Git { prereg_at_head: head, dirty, sha: "SYNTHETIC".into() };
            let code = p.run();
            eprintln!("pre-registration {what}: exit {code}");
            assert_eq!(code, 1, "{what}");
            assert!(!p.report().exists());
        }
        p.git = Git { prereg_at_head: Some(PREREG.as_bytes().to_vec()), dirty: false, sha: "SYNTHETIC".into() };
        p.write_calibration([0.09, 0.02, 0.01, 0.01, 0.01]);
        let code = p.run();
        eprintln!("calibration tau moved: exit {code}");
        assert_eq!(code, 1);
        assert!(!p.report().exists());
        p.write_calibration(p.pins.tau);
        let gate = std::fs::read(p.out.join("box-gate.json")).unwrap();
        std::fs::remove_file(p.out.join("box-gate.json")).unwrap();
        let code = p.run();
        eprintln!("no gate report: exit {code}");
        assert_eq!(code, 1);
        std::fs::write(p.out.join("box-gate.json"), gate).unwrap();
        std::fs::write(p.ceph400.join("splits.json"), serde_json::json!({"train": (1..=149).map(|i| format!("{i:03}")).chain(["151".to_string()]).collect::<Vec<_>>(), "test1": ["152"]}).to_string()).unwrap();
        // 151 is given an expert tracing (no image), so only the film-number check can stop it before any film is read.
        let gt = std::fs::read_to_string(p.ceph400.join("gt.csv")).unwrap();
        let extra: String = gt.lines().filter(|l| l.starts_with("001,")).map(|l| l.replacen("001,", "151,", 1) + "\n").collect();
        std::fs::write(p.ceph400.join("gt.csv"), gt + &extra).unwrap();
        let code = p.run();
        eprintln!("train list naming 151: exit {code}; box cache made: {}", p.out.join("boxes").exists());
        assert_eq!(code, 1);
        assert!(!p.out.join("boxes").exists() && !p.report().exists());
        std::fs::write(p.ceph400.join("splits.json"), serde_json::json!({"train": (1..=150).map(|i| format!("{i:03}")).collect::<Vec<_>>(), "test1": ["151"]}).to_string()).unwrap();
        assert_eq!(p.run(), 0, "control: the same folders with the guards satisfied run");
    }

    /// The refused sets through the run: folders given the wrong way round are refused before any film is read.
    #[test] fn run_with_refuses_wrong_folders_before_any_film_is_read() {
        let p = px();
        let code = run_with(&p.ceph400, &p.aariz, &p.models, &p.out, &p.split, &p.git, &p.pins).unwrap();
        eprintln!("folders swapped: exit {code}");
        assert_eq!(code, 1);
        assert!(!p.out.join("boxes").exists() && !p.report().exists());
    }
}
