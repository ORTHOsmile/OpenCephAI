//! SC-1 Part 1, the box gate's second version (owner ruling 5 Nov 2026, "Set from both sets"), pre-registered in
//! `reference/sc1-box-gate-2.json` (`sc1-box-gate/2`, committed alone before any run, SHA-256 pinned in a test).
//!
//! **Why.** Task 10 (`sc1-box-gate/1`) set the five tolerances τ_r from 70 Aariz films. Four came out at the 0.01 floor.
//! The region probe (`sc1-region-probe/1`) then laid the finder's boxes on 150 Ceph-400 Train films with the experts' own
//! tracings, and 16 of those correct tracings were flagged (limit 3): soft tissue 13, maxilla 2, mandible 1.
//!
//! **The picture.** Same as /1: on each film the finder draws five rectangles; for each region we ask how far the
//! experts' traced points fall outside its rectangle, as a fraction of the rectangle's longer side. τ_r is the worst such
//! point, rounded up to the next 0.01, so no film used flags. The one change: the worst point is now taken over BOTH the
//! 70 Aariz hold-out films and the 150 Ceph-400 Train films. Neither is an SC1-1a film; SC1-1a stays the independent test.
//!
//! **Unchanged from /1:** the gate (median IoU ≥ 0.5 per region, on the Aariz hold-out only, against expert boxes drawn
//! with the full Aariz points), the score line, C5, C7 and C9; this module calls /1's code for each (`sc1_gate`).
//! **New:** a C7 count for Ceph-400 Train (150), the refusal of SC1-1a's films (Ceph-400 test1, Aariz valid) as well as
//! Test2 and Aariz test, the detector pinned to the pre-registered fingerprint, and a stop when any τ is above 0.15.
//!
//! **What it can no longer show.** The probe's films now set τ, so `sc1-region-probe/1` cannot be re-run as independent
//! evidence: by construction no Ceph-400 Train film flags a region. The false-alarm rate that counts is SC1-1a's.
//!
//! **Writes.** `<out>/box-gate-2.json` (pass or stop). On a pass only: `<models>/regions/calibration.json` with rule
//! `sc1-box-gate/2`, and the /1 calibration found there kept beside it as `calibration-1.json`. Broken writes nothing.
//! Prints aggregates only, never a film id.
//!
//! **The third version, `sc1-box-gate/3`** (owner OQ-1b-A = A, 5 Nov 2026; `reference/sc1-box-gate-3.json`, committed
//! alone before any run) is the same code with `GATE3`: τ is the worst traced point over FOUR sets, the hold-out (70),
//! Ceph-400 Train (150) and the development films, Ceph-400 Test1 151-300 and Aariz valid (150 each): SC1-1a's spent
//! films, tuned on and said so in the report ("development films, tuned on (R1b-5, OQ-1b-A)"). What it costs: SC1-1a's
//! region false alarms can no longer be re-measured, since by construction none of those films flags a region now.
//! It writes `box-gate-3.json`, and on a pass the calibration with rule `sc1-box-gate/3`, keeping the /2 file as
//! `calibration-2.json`. Ceph-400 Test2, Aariz test and PKU (sealed) are refused before any file is read.
use crate::{chainproof, dataset, ft_common, ledger, sc1_gate, sc1_probe};
use crate::sc1_data::{self, Split};
use crate::sc1_gate::{by_region, ceil_hundredth, Git, PASS, STOP, TAU_MIN, CEPH400_MM_PER_PX};
use anyhow::{ensure, Context};
use ceph_infer::regions::{regions_manifest_path, RegionEngine};
use ceph_model::wholefilm::{calibration_path, parse_calibration, BoxQuality, Regions, BOX_GATE_MIN_MEDIAN_IOU, REGIONS};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

pub const PREREG: &str = include_str!("../../../reference/sc1-box-gate-2.json");
pub const PREREG_PATH: &str = "reference/sc1-box-gate-2.json";
pub const VERSION: &str = "sc1-box-gate/2";
/// Ceph-400 Train: films 001–150 (C7 for that set).
pub const CEPH400_TRAIN: usize = sc1_probe::CEPH400_TRAIN;
/// gate /3's development sets: Ceph-400 test1 151-300 and Aariz valid, 150 films each (C7development).
pub const DEVELOPMENT_FILMS: usize = 150;
/// Any τ above this stops the run (exit 4) before a calibration is written.
pub const TAU_CEILING: f64 = 0.15;
pub const HOLDOUT: &str = "Aariz-train hold-out";
pub const CEPH400: &str = "Ceph-400 train";
pub const TEST1_DEV: &str = "Ceph-400 test1 (development)";
pub const VALID_DEV: &str = "Aariz valid (development)";
pub const BOTH: &str = "both (equal worst points)";
pub const FLOOR: &str = "the 0.01 floor";
/// Said in every gate /3 report (R1b-5, OQ-1b-A).
pub const DISCLOSURE: &str = "development films, tuned on (R1b-5, OQ-1b-A)";

/// One version of the box gate's second form: its pre-registration, its report, whether it reads the development films,
/// and which earlier calibration it keeps beside the new one (M14). /2 and /3 share every line of code below.
#[derive(Clone, Copy, Debug)]
pub struct GateSpec {
    pub version: &'static str, pub prereg: &'static str, pub prereg_path: &'static str, pub report: &'static str,
    pub with_development: bool, pub keep_as: &'static str, pub keeps_rule: &'static str,
}
/// sc1-box-gate/2 (owner, 5 Nov 2026, "Set from both sets"): τ over the hold-out and Ceph-400 Train; keeps a /1 file.
pub const GATE2: GateSpec = GateSpec { version: VERSION, prereg: PREREG, prereg_path: PREREG_PATH, report: "box-gate-2.json",
    with_development: false, keep_as: "calibration-1.json", keeps_rule: sc1_gate::VERSION };
/// sc1-box-gate/3 (owner OQ-1b-A = A, 5 Nov 2026): the same rule also over the development films; keeps a /2 file.
pub const GATE3: GateSpec = GateSpec { version: "sc1-box-gate/3", prereg: include_str!("../../../reference/sc1-box-gate-3.json"),
    prereg_path: "reference/sc1-box-gate-3.json", report: "box-gate-3.json", with_development: true, keep_as: "calibration-2.json", keeps_rule: VERSION };

/// A film's detected regions (at the score line) with its traced expert points.
pub type Traced = (Regions, Vec<(String, f64, f64)>);

/// τ over the union of the two sets, with each set's worst point before rounding, the films that found each region in
/// each set, and which set set τ (REGIONS order throughout).
#[derive(Clone, Debug, PartialEq)]
pub struct UnionTau { pub tau: [f64; 5], pub worst_holdout: [f64; 5], pub worst_ceph400: [f64; 5], pub films_holdout: [usize; 5], pub films_ceph400: [usize; 5], pub set_by: [&'static str; 5] }

/// τ over any number of named sets: per set (in the order given) its worst point before rounding and the films that found
/// each region; per region the sets whose worst point is the largest (every one of them when they tie), or none when τ
/// is the 0.01 floor.
#[derive(Clone, Debug, PartialEq)]
pub struct UnionTauN { pub tau: [f64; 5], pub names: Vec<&'static str>, pub worst: Vec<[f64; 5]>, pub films: Vec<[usize; 5]>, pub set_by: [Vec<&'static str>; 5] }

/// The pre-registered τ rule over the union of the sets: per region, the largest outside-ratio of its traced points over
/// every film of every set, rounded up to the next 0.01, at least 0.01 (/1's `sc1_gate::tau` on the union).
pub fn union_tau_sets(sets: &[(&'static str, &[Traced])]) -> UnionTauN {
    let (mut worst, mut films) = (Vec::new(), Vec::new());
    for (_, t) in sets { let (w, f) = sc1_gate::worst_outside(t); worst.push(w); films.push(f); }
    let all: Vec<Traced> = sets.iter().flat_map(|(_, t)| t.iter().cloned()).collect();
    let (tau, _) = sc1_gate::tau(&all);
    let set_by = std::array::from_fn(|i| {
        let top = worst.iter().map(|w| w[i]).fold(0.0f64, f64::max);
        if ceil_hundredth(top) <= TAU_MIN { return vec![] }
        sets.iter().zip(&worst).filter(|(_, w)| w[i] == top).map(|((n, _), _)| *n).collect()
    });
    UnionTauN { tau, names: sets.iter().map(|(n, _)| *n).collect(), worst, films, set_by }
}

/// /2's two-set form, built on `union_tau_sets` with its output unchanged.
pub fn union_tau(holdout: &[Traced], ceph400: &[Traced]) -> UnionTau {
    let u = union_tau_sets(&[(HOLDOUT, holdout), (CEPH400, ceph400)]);
    let set_by = std::array::from_fn(|i| match u.set_by[i].as_slice() { [] => FLOOR, [one] => one, _ => BOTH });
    UnionTau { tau: u.tau, worst_holdout: u.worst[0], worst_ceph400: u.worst[1], films_holdout: u.films[0], films_ceph400: u.films[1], set_by }
}

/// A set's count line (its films, then every region's films found + not found, each equal to `want`; else an error:
/// broken) and the films that did not find each region.
fn set_counts(what: &str, films: &[Traced], want: usize) -> anyhow::Result<(String, [usize; 5])> {
    let line = ft_common::counted(&format!("{what} films"), films.len(), want)?;
    let mut not_found = [0usize; 5];
    for r in REGIONS {
        let found = films.iter().filter(|(regs, _)| regs.get(r).is_some()).count();
        not_found[r.index()] = films.len() - found;
        ft_common::counted(&format!("{what} films measured for the {} region (found + not found)", r.words()), found + not_found[r.index()], want)?;
    }
    Ok((line, not_found))
}

/// C7 for Ceph-400 Train: 150 films, and every region's count (found + not found) 150; else an error (broken). Returns
/// the count line (for the report) and the films that did not find each region.
pub fn ceph400_counts(ceph400: &[Traced]) -> anyhow::Result<(String, [usize; 5])> { set_counts("Ceph-400 train", ceph400, CEPH400_TRAIN) }

/// The verdict: /1's (pass, stop or broken, from the gate and C9), then a pass with any τ above `TAU_CEILING` is a stop.
/// The second value says why a pass became a stop.
pub fn verdict(gate: &'static str, tau: &[f64; 5]) -> (&'static str, Option<String>) {
    if gate != PASS { return (gate, None) }
    let over: Vec<String> = REGIONS.iter().filter(|r| tau[r.index()] > TAU_CEILING).map(|r| format!("{} {:.2}", r.words(), tau[r.index()])).collect();
    if over.is_empty() { (PASS, None) } else { (STOP, Some(format!("tau above {TAU_CEILING:.2}: {}; no calibration written; to the owner", over.join(", ")))) }
}

/// The sets this run reads are the train splits only: Ceph-400 test1, Aariz valid (SC1-1a's films), Ceph-400 test2,
/// Aariz test and "all" are refused before any file is read.
pub fn refuse_reads(reads: &[(&Path, &str)]) -> anyhow::Result<()> { sc1_probe::refuse_reads(reads) }

/// The refusals of one gate version, before any file is read. /2: the train splits only (`refuse_reads`). /3: train,
/// test1 and valid (the development films); Ceph-400 test2, Aariz test, PKU (sealed, by the ledger's own gates) and "all"
/// are refused.
pub fn refuse_reads_for(spec: &GateSpec, reads: &[(&Path, &str)]) -> anyhow::Result<()> {
    if !spec.with_development { return refuse_reads(reads) }
    for (d, s) in reads {
        ledger::refuse_held_back(d, s)?;
        chainproof::refuse_held_back_cache(d, s)?;
        ensure!(["train", "test1", "valid"].contains(s), "{} {s}: refused; {} reads only train, Ceph-400 test1 and Aariz valid", d.display(), spec.version);
    }
    Ok(())
}

fn by_region_opt<S: serde::Serializer, T: Serialize>(v: &Option<[T; 5]>, s: S) -> Result<S::Ok, S::Error> {
    match v { Some(v) => by_region(v, s), None => s.serialize_none() }
}

/// The development sets in a gate /3 report (absent from /2's).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Development {
    pub disclosure: String, pub ceph400_test1_films: usize, pub aariz_valid_films: usize, pub c7_development: String,
    #[serde(serialize_with = "by_region")] pub worst_ceph400_test1: [f64; 5],
    #[serde(serialize_with = "by_region")] pub worst_aariz_valid: [f64; 5],
    #[serde(serialize_with = "by_region")] pub films_ceph400_test1: [usize; 5],
    #[serde(serialize_with = "by_region")] pub films_aariz_valid: [usize; 5],
    #[serde(serialize_with = "by_region")] pub not_found_ceph400_test1: [usize; 5],
    #[serde(serialize_with = "by_region")] pub not_found_aariz_valid: [usize; 5],
}

/// `box-gate-2.json` and `box-gate-3.json`. /2 writes `tauV1` (the τ it superseded) and no development fields; /3 writes
/// `tauV2` and the development fields.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Gate2Report {
    pub version: String, pub prereg_sha256: String, pub git_sha: String, pub detector_fingerprint: String,
    pub holdout_films: usize, pub ceph400_train_films: usize, pub c7_ceph400_train: String, pub score_line: f32,
    #[serde(serialize_with = "by_region")] pub tau: [f64; 5],
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "by_region_opt")] pub tau_v1: Option<[f64; 5]>,
    #[serde(skip_serializing_if = "Option::is_none", serialize_with = "by_region_opt")] pub tau_v2: Option<[f64; 5]>,
    #[serde(serialize_with = "by_region")] pub worst_holdout: [f64; 5],
    #[serde(serialize_with = "by_region")] pub worst_ceph400_train: [f64; 5],
    #[serde(serialize_with = "by_region")] pub films_holdout: [usize; 5],
    #[serde(serialize_with = "by_region")] pub films_ceph400_train: [usize; 5],
    #[serde(serialize_with = "by_region")] pub not_found_ceph400_train: [usize; 5],
    #[serde(serialize_with = "by_region")] pub set_by: [String; 5],
    #[serde(skip_serializing_if = "Option::is_none", flatten)] pub development: Option<Development>,
    pub quality: Vec<BoxQuality>, pub control_c9: Vec<BoxQuality>, pub control_tripped: bool, pub verdict: String, pub stop_reason: Option<String>,
}
impl Gate2Report {
    pub fn exit_code(&self) -> i32 { sc1_gate::exit_code(&self.verdict) }
    /// The printed lines: counts, medians, percentiles and maxima only (no film id).
    pub fn summary(&self) -> Vec<String> {
        let path = if self.development.is_some() { GATE3.prereg_path } else { PREREG_PATH };
        let mut v = vec![format!("box-quality gate {} ({path} sha256 {}); git HEAD {}; detector {}", self.version, self.prereg_sha256, self.git_sha, self.detector_fingerprint),
            format!("hold-out films: compared {} (expected {}, the split file's); Ceph-400 train films: {} (expected {CEPH400_TRAIN})",
                self.quality.first().map(|q| q.films).unwrap_or(0), self.holdout_films, self.ceph400_train_films),
            format!("C7 {}", self.c7_ceph400_train)];
        if let Some(d) = &self.development { v.push(format!("C7development {}", d.c7_development)); v.push(d.disclosure.clone()); }
        v.push(format!("score line {:.2}", self.score_line));
        v.push("the gate (Aariz-train hold-out): median IoU at least 0.5 on every region".into());
        v.extend(sc1_gate::table(&self.quality));
        v.push(format!("C9 (the hold-out's detected boxes x2 about their centres): IoU medians {}; tripped on every region: {}",
            self.control_c9.iter().map(|q| format!("{} {:.3}", q.region.words(), q.iou_median)).collect::<Vec<_>>().join(", "),
            if self.control_tripped { "yes" } else { "NO (the gate is broken)" }));
        match (&self.development, self.tau_v1, self.tau_v2) {
            (None, Some(before), _) => {
                v.push("tau (/1 -> /2), set by; worst outside-ratio before rounding: hold-out / Ceph-400 train; films that found the region: hold-out / Ceph-400 train".into());
                for r in REGIONS {
                    let i = r.index();
                    v.push(format!("  {:<20} {:.2} -> {:.2}  set by {:<26} worst {:.4} / {:.4}  films {} / {} (Ceph-400 not found {})", r.words(), before[i], self.tau[i], self.set_by[i],
                        self.worst_holdout[i], self.worst_ceph400_train[i], self.films_holdout[i], self.films_ceph400_train[i], self.not_found_ceph400_train[i]));
                }
            }
            (Some(d), _, Some(before)) => {
                v.push("tau (/2 -> /3), set by; worst outside-ratio before rounding: hold-out / Ceph-400 train / Ceph-400 test1 / Aariz valid; films that found the region, same order".into());
                for r in REGIONS {
                    let i = r.index();
                    v.push(format!("  {:<20} {:.2} -> {:.2}  set by {:<40} worst {:.4} / {:.4} / {:.4} / {:.4}  films {} / {} / {} / {}", r.words(), before[i], self.tau[i], self.set_by[i],
                        self.worst_holdout[i], self.worst_ceph400_train[i], d.worst_ceph400_test1[i], d.worst_aariz_valid[i],
                        self.films_holdout[i], self.films_ceph400_train[i], d.films_ceph400_test1[i], d.films_aariz_valid[i]));
                }
            }
            _ => v.push("tau: no earlier tau recorded (a broken report)".into()),
        }
        if let Some(why) = &self.stop_reason { v.push(format!("stop: {why}")); }
        v.push(format!("verdict {} (exit {}: 0 pass, 4 stop, 1 broken)", self.verdict, self.exit_code()));
        v
    }
}

/// /2's run (`run_with_spec(&GATE2, …)`).
pub fn run_with(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git, pinned_fp: &str) -> anyhow::Result<i32> {
    run_with_spec(&GATE2, aariz, ceph400, models, out, split, git, pinned_fp)
}

/// The run of one gate version on given folders, split, git state and pinned detector fingerprint: prints the summary;
/// writes `<out>/<spec.report>` on a pass or a stop, and on a pass the calibration (rule `spec.version`) with the
/// superseded file kept as `spec.keep_as`. Exit 0 pass, 4 stop, 1 broken (nothing written).
#[allow(clippy::too_many_arguments)]
pub fn run_with_spec(spec: &GateSpec, aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git, pinned_fp: &str) -> anyhow::Result<i32> {
    let v = spec.version;
    let broken = |e: anyhow::Error| { eprintln!("box-quality gate {v} broken (nothing written): {e:#}"); Ok(1) };
    let rep = match gate_run(spec, aariz, ceph400, models, out, split, git, pinned_fp) { Ok(r) => r, Err(e) => return broken(e) };
    for l in rep.summary() { println!("{l}"); }
    if rep.verdict != PASS && rep.verdict != STOP { return broken(anyhow::anyhow!("C9 did not trip")) }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let sha = ft_common::sha256_hex(text.as_bytes());
    // Everything a pass writes is made and checked before anything is written.
    let pass = if rep.verdict == PASS {
        let made = || -> anyhow::Result<(String, Option<Vec<u8>>)> {
            let cal = sc1_gate::calibration_text(&rep.detector_fingerprint, rep.score_line, rep.tau, &sha, Some(spec.version))?;
            Ok((cal, keep_previous(models, spec)?))
        };
        match made() { Ok(m) => Some(m), Err(e) => return broken(e) }
    } else { None };
    std::fs::create_dir_all(out)?;
    let path = out.join(spec.report);
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {sha})", path.display());
    match pass {
        Some((cal, keep)) => {
            if let Some(b) = keep {
                let k = calibration_kept_path(models, spec);
                std::fs::write(&k, &b)?;
                println!("the {} calibration kept as {} (sha256 {})", spec.keeps_rule, k.display(), ft_common::sha256_hex(&b));
            }
            std::fs::write(calibration_path(models), cal)?;
            println!("calibration (rule {}) written to {}", spec.version, calibration_path(models).display());
        }
        None => println!("no calibration written (the gate stopped)"),
    }
    Ok(rep.exit_code())
}

/// `<models>/regions/calibration-1.json`: the /1 calibration, kept for the record.
pub fn calibration_v1_path(models: &Path) -> PathBuf { calibration_kept_path(models, &GATE2) }
/// `<models>/regions/<spec.keep_as>`: the calibration this version supersedes, kept for the record.
pub fn calibration_kept_path(models: &Path, spec: &GateSpec) -> PathBuf { calibration_path(models).with_file_name(spec.keep_as) }

/// What to keep as `spec.keep_as`: the calibration in place when its rule is `spec.keeps_rule` (Some(its bytes)); nothing
/// otherwise or when there is none. An error (broken) when the file in place does not load, was set by a later rule than
/// `spec.version` (it would be overwritten), or when the kept file already holds other bytes than the file about to be kept.
pub fn keep_previous(models: &Path, spec: &GateSpec) -> anyhow::Result<Option<Vec<u8>>> {
    let p = calibration_path(models);
    let Ok(bytes) = std::fs::read(&p) else { return Ok(None) };
    let c = parse_calibration(&bytes).with_context(|| format!("{}: the calibration in place does not load; refusing to replace it", p.display()))?;
    // Never write over a calibration that a later rule set (gate /4 is the owner's whole-film/3 ruling, spec §17.15):
    // the order of `GATE_RULES` is the order the rules superseded each other (Task E3 review M1).
    let rank = |r: &str| ceph_model::wholefilm::GATE_RULES.iter().position(|g| *g == r);
    let (in_place, this) = (rank(c.gate_rule()), rank(spec.version));
    ensure!(this.is_some() && in_place <= this, "{}: the calibration in place was set by {}, which supersedes {}: this run would overwrite it; refused",
        p.display(), c.gate_rule(), spec.version);
    if c.gate_rule() != spec.keeps_rule { return Ok(None) }
    let k = calibration_kept_path(models, spec);
    if let Ok(old) = std::fs::read(&k) { ensure!(old == bytes, "{} already holds another file than the {} calibration in place; refusing", k.display(), spec.keeps_rule); }
    Ok(Some(bytes))
}

/// The whole run up to the report (nothing written). An error is broken.
#[allow(clippy::too_many_arguments)]
fn gate_run(spec: &GateSpec, aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git, pinned_fp: &str) -> anyhow::Result<Gate2Report> {
    let (version, dev) = (spec.version, spec.with_development);
    // The refused sets first, before any file is read (C5; for /2 SC1-1a's films too; for /3 PKU by the seal).
    let mut reads: Vec<(&Path, &str)> = vec![(aariz, "train"), (ceph400, "train")];
    if dev { reads.extend([(aariz, "valid"), (ceph400, "test1")]); }
    refuse_reads_for(spec, &reads)?;
    ensure!(crate::scale::is_aariz(aariz), "{}: the gate runs on the Aariz-train hold-out, and this folder is not Aariz", aariz.display());
    ensure!(sc1_gate::is_ceph400(ceph400), "{}: tau reads Ceph-400 train, and this folder is not Ceph-400", ceph400.display());
    // The pre-registration: committed as built, from a clean tree.
    ensure!(!git.dirty, "commit first: the gate is pre-registered ({}) and runs only from a clean tree", spec.prereg_path);
    ft_common::committed_as_built(spec.prereg_path, spec.prereg, git.prereg_at_head.clone())?;
    let v: serde_json::Value = serde_json::from_str(spec.prereg)?;
    ensure!(v["version"] == version, "this program knows {version}, not {}", v["version"]);
    ensure!(v["gate"]["minMedianIoU"].as_f64() == Some(BOX_GATE_MIN_MEDIAN_IOU), "the pre-registered gate value is not the program's {BOX_GATE_MIN_MEDIAN_IOU}");
    ensure!(v["tauCeiling"]["max"].as_f64() == Some(TAU_CEILING), "the pre-registered tau ceiling is not the program's {TAU_CEILING}");
    if dev { ensure!(v["disclosure"] == DISCLOSURE, "the pre-registration's disclosure is not the program's {DISCLOSURE:?}"); }
    sc1_data::ensure_outside_or_ignored(out)?;
    sc1_data::ensure_outside_or_ignored(models)?;
    // The calibration in place loads, and the kept file (if there) is the superseded one: checked again before writing.
    keep_previous(models, spec)?;
    // The lists: Ceph-400 train is 001-150 (150 different ids); the hold-out lies in Aariz train, valid shares no film with
    // it; for /3, Ceph-400 test1 is 151-300 (C5 by film: no Test2 number).
    let splits = dataset::load_splits(&ceph400.join("splits.json"))?;
    let c4_ids = dataset::select(&splits, "train")?;
    sc1_probe::refuse_outside_train(&c4_ids)?;
    let t1_ids = if dev { let t = dataset::select(&splits, "test1")?; sc1_gate::refuse_outside_test1(&t)?; t } else { vec![] };
    let (train, valid) = sc1_gate::aariz_train_valid(aariz)?;
    let train: BTreeSet<String> = train.into_iter().collect();
    ensure!(split.holdout.iter().all(|id| train.contains(id)), "a hold-out film of the split file is not in Aariz train: refused");
    ensure!(valid.iter().all(|id| !train.contains(id)), "Aariz valid shares films with train: refused");
    if dev {
        let u: BTreeSet<&String> = t1_ids.iter().collect();
        ensure!(u.len() == t1_ids.len(), "Ceph-400's test1 list names a film twice: refused");
        let u: BTreeSet<&String> = valid.iter().collect();
        ensure!(u.len() == valid.len(), "Aariz's valid list names a film twice: refused");
    }
    // The detector: the pinned one, with its faithfulness record over the whole hold-out.
    let engine = RegionEngine::load(&regions_manifest_path(models))?;
    let fp = engine.spec().fingerprint();
    ensure!(fp == pinned_fp, "the installed region finder is {fp}; {version} is pinned to {pinned_fp}");
    sc1_gate::check_faithfulness(out, &fp, split.holdout.len())?;
    // The expert tracings, complete.
    let az_gt = dataset::load_points(&aariz.join("gt.csv"))?;
    let c4_gt = dataset::load_points(&ceph400.join("gt.csv"))?;
    sc1_gate::complete(&az_gt, &split.holdout, "hold-out")?;
    sc1_gate::complete(&c4_gt, &c4_ids, "Ceph-400 train")?;
    if dev {
        sc1_gate::complete(&c4_gt, &t1_ids, "Ceph-400 test1")?;
        sc1_gate::complete(&az_gt, &valid, "Aariz valid")?;
    }
    // The hold-out: score line, the gate, C9 (/1's code, unchanged).
    let cache = out.join("boxes");
    let hold_ids = &split.holdout;
    let (line, films, hold_traced) = sc1_gate::holdout_boxes(&engine, aariz, hold_ids, &az_gt, &cache, &fp)?;
    let j = sc1_gate::judge(&films, hold_ids.len(), &|b| b.inflated(sc1_gate::C9_FACTOR))?;
    // Ceph-400 train: the detected regions at the same score line, with the traced points; C7 for the set.
    let c4: Vec<(String, Option<f64>)> = c4_ids.iter().map(|id| (id.clone(), Some(CEPH400_MM_PER_PX))).collect();
    let (_, c4_traced) = sc1_gate::film_boxes(&engine, ceph400, "train", &c4, &c4_gt, &cache, line, &fp)?;
    let (c7_ceph400_train, not_found) = ceph400_counts(&c4_traced)?;
    // The development films (/3): the same, and C7development.
    let (t1_traced, av_traced, dev_counts) = if dev {
        let t1: Vec<(String, Option<f64>)> = t1_ids.iter().map(|id| (id.clone(), Some(CEPH400_MM_PER_PX))).collect();
        let av: Vec<(String, Option<f64>)> = valid.iter().map(|id| (id.clone(), None)).collect();
        let (_, t1_traced) = sc1_gate::film_boxes(&engine, ceph400, "test1", &t1, &c4_gt, &cache, line, &fp)?;
        let (_, av_traced) = sc1_gate::film_boxes(&engine, aariz, "valid", &av, &az_gt, &cache, line, &fp)?;
        let (l1, n1) = set_counts("Ceph-400 test1", &t1_traced, DEVELOPMENT_FILMS)?;
        let (l2, n2) = set_counts("Aariz valid", &av_traced, DEVELOPMENT_FILMS)?;
        (t1_traced, av_traced, Some((format!("{l1}; {l2}"), n1, n2)))
    } else { (vec![], vec![], None) };
    // τ over the sets, and the verdict.
    let mut sets: Vec<(&'static str, &[Traced])> = vec![(HOLDOUT, &hold_traced), (CEPH400, &c4_traced)];
    if dev { sets.extend([(TEST1_DEV, &t1_traced[..]), (VALID_DEV, &av_traced[..])]); }
    let u = union_tau_sets(&sets);
    let set_by: [String; 5] = if dev {
        std::array::from_fn(|i| if u.set_by[i].is_empty() { FLOOR.to_string() } else { u.set_by[i].join(" and ") })
    } else { union_tau(&hold_traced, &c4_traced).set_by.map(String::from) };
    let (verdict, stop_reason) = verdict(j.verdict, &u.tau);
    let development = dev_counts.map(|(c7, n1, n2)| Development { disclosure: DISCLOSURE.into(), ceph400_test1_films: t1_traced.len(), aariz_valid_films: av_traced.len(),
        c7_development: c7, worst_ceph400_test1: u.worst[2], worst_aariz_valid: u.worst[3], films_ceph400_test1: u.films[2], films_aariz_valid: u.films[3],
        not_found_ceph400_test1: n1, not_found_aariz_valid: n2 });
    let (tau_v1, tau_v2) = if dev { (None, Some(crate::sc1_1a::Pins::from_prereg()?.tau)) } else { (Some(sc1_probe::Pins::from_prereg()?.tau), None) };
    Ok(Gate2Report { version: version.into(), prereg_sha256: ft_common::sha256_hex(spec.prereg.as_bytes()), git_sha: git.sha.clone(), detector_fingerprint: fp,
        holdout_films: hold_ids.len(), ceph400_train_films: c4_traced.len(), c7_ceph400_train, score_line: line, tau: u.tau, tau_v1, tau_v2,
        worst_holdout: u.worst[0], worst_ceph400_train: u.worst[1], films_holdout: u.films[0], films_ceph400_train: u.films[1],
        not_found_ceph400_train: not_found, set_by, development, quality: j.quality, control_c9: j.control_c9, control_tripped: j.control_tripped,
        verdict: verdict.into(), stop_reason })
}

/// `--sc1-box-gate-2`: `run_cli_spec(&GATE2, …)`.
pub fn run_cli(aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> { run_cli_spec(&GATE2, aariz, ceph400, models, out) }

/// `--sc1-box-gate-2` / `--sc1-box-gate-3`: the refusals, the pinned split (its SHA-256 checked), the git state, the
/// pre-registration's detector fingerprint, then `run_with_spec`.
pub fn run_cli_spec(spec: &GateSpec, aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Split, Git, String)> {
        let mut reads: Vec<(&Path, &str)> = vec![(aariz, "train"), (ceph400, "train")];
        if spec.with_development { reads.extend([(aariz, "valid"), (ceph400, "test1")]); }
        refuse_reads_for(spec, &reads)?;
        let p = sc1_data::split_path()?;
        let text = std::fs::read_to_string(&p).with_context(|| p.display().to_string())?;
        ensure!(ft_common::sha256_hex(text.as_bytes()) == sc1_data::PINNED_SPLIT_SHA256, "{} is not the pinned split (SHA-256 differs)", p.display());
        let fp = sc1_probe::pinned_fingerprint(&serde_json::from_str(spec.prereg)?);
        ensure!(fp.len() == 64, "{} pins no detector fingerprint", spec.prereg_path);
        Ok((sc1_data::load_split(&text)?, sc1_gate::git_state(spec.prereg_path)?, fp))
    };
    match pre() {
        Ok((split, git, fp)) => run_with_spec(spec, aariz, ceph400, models, out, &split, &git, &fp),
        Err(e) => { eprintln!("box-quality gate {} broken (nothing written): {e:#}", spec.version); Ok(1) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ft_common::sha256_hex;
    use crate::sc1_gate::tests::{rx, tracing_for, ramp, Rx};
    use ceph_model::wholefilm::{teaching_boxes, Region, RegionBox, REGION_OF};

    /// The pre-registration's SHA-256, pinned when it was committed (266b615, before any run).
    const PINNED_SHA256: &str = "7ee97bb585f045d783f01d9b63fa23c491a6bd6d6ff25cee14d5c1544187b919";
    const FP: &str = "17171e68f9f7072062e2a3a2cbd4851618056f5136bed998f1782c49d4897b80";

    /// Fails if the file changes by one byte, if its numbers are not the program's, or if the parts the ruling keeps
    /// from /1 (gate, score line, quality, C5, C7, C9) are not /1's word for word.
    #[test] fn the_preregistration_is_pinned_and_keeps_1s_rules_verbatim() {
        assert_eq!(sha256_hex(PREREG.as_bytes()), PINNED_SHA256, "reference/sc1-box-gate-2.json changed: the owner's OK, then a new version");
        let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
        let one: serde_json::Value = serde_json::from_str(sc1_gate::PREREG).unwrap();
        assert_eq!(v["version"], VERSION);
        assert_eq!(v["gate"]["minMedianIoU"].as_f64(), Some(BOX_GATE_MIN_MEDIAN_IOU));
        assert_eq!(v["tauCeiling"]["max"].as_f64(), Some(TAU_CEILING));
        assert_eq!(sc1_probe::pinned_fingerprint(&v), FP);
        for k in ["gate", "scoreLine", "quality", "rule"] { assert_eq!(v[k], one[k], "{k} is /1's"); }
        for k in ["C5", "C7", "C9"] { assert_eq!(v["controls"][k], one["controls"][k], "{k} is /1's"); }
        let tau = v["tau"].as_str().unwrap();
        assert!(tau.contains("over the union of the Aariz-train hold-out (70) and Ceph-400 Train 001-150 (150), rounded up to the next 0.01 and at least 0.01"), "{tau}");
        let refused = v["films"]["refused"].as_str().unwrap();
        for s in ["Ceph-400 test1", "Ceph-400 test2", "Aariz valid", "Aariz test"] { assert!(refused.contains(s), "{s}"); }
        assert!(v["controls"]["C7ceph400Train"].as_str().unwrap().contains("equals 150"));
        assert!(v["statedLimits"][0].as_str().unwrap().contains("sc1-region-probe/1 cannot be re-run as independent evidence"));
        assert!(v["calibration"].as_str().unwrap().contains("rule = 'sc1-box-gate/2'"));
    }

    /// A SYNTHETIC 19-point tracing on a 2000 x 1600 film, and the detector's boxes drawn round it (score 0.9).
    fn tracing() -> Vec<(String, f64, f64)> {
        [("S", 600.0, 500.0), ("N", 1300.0, 450.0), ("Po", 400.0, 650.0), ("Ar", 500.0, 800.0), ("Or", 1150.0, 600.0),
         ("A", 1350.0, 900.0), ("ANS", 1380.0, 820.0), ("PNS", 900.0, 850.0),
         ("Go", 650.0, 1150.0), ("Me", 1200.0, 1350.0), ("Pog", 1300.0, 1250.0), ("B", 1290.0, 1150.0), ("Gn", 1260.0, 1320.0),
         ("U1T", 1380.0, 1040.0), ("L1T", 1360.0, 1080.0),
         ("Sn", 1450.0, 850.0), ("UL", 1480.0, 960.0), ("LL", 1470.0, 1100.0), ("PogS", 1400.0, 1300.0)]
            .iter().map(|(n, x, y)| (n.to_string(), *x, *y)).collect()
    }
    fn boxes(drop: Option<Region>) -> Vec<RegionBox> {
        teaching_boxes(&tracing(), 2000, 1600).into_iter().filter(|b| Some(b.region) != drop).map(|b| RegionBox { score: 0.9, ..b }).collect()
    }
    /// One film: `point` moved `out` of its region's longer side outside the box's right edge (None: the clean tracing).
    fn film(point: Option<(&str, f64)>, drop: Option<Region>) -> Traced {
        let b = boxes(drop);
        let regs = Regions::from_scored(&b, 0.5, FP).unwrap();
        let mut p = tracing();
        if let Some((id, out)) = point {
            let r = REGION_OF.iter().find(|(n, _)| *n == id).unwrap().1;
            let bx = *regs.get(r).unwrap_or(&teaching_boxes(&tracing(), 2000, 1600).into_iter().find(|x| x.region == r).unwrap());
            let q = p.iter_mut().find(|x| x.0 == id).unwrap();
            q.1 = bx.x1 + out * bx.longer_side();
            q.2 = (bx.y0 + bx.y1) / 2.0;
        }
        (regs, p)
    }

    /// The union: τ is the worst traced point over BOTH sets, rounded up, with the floor; each set's worst point is kept
    /// before rounding; a region a film did not find adds nothing; the set that set τ is named. Fails if τ is taken over
    /// one set only, not rounded up, has no floor, counts a not-found region, or names the wrong set.
    #[test] fn tau_is_the_worst_point_over_both_sets() {
        let hold = vec![film(None, None), film(Some(("ANS", 0.031)), None)];
        let c4 = vec![film(Some(("PogS", 0.073)), None), film(None, None), film(Some(("Me", 0.9)), Some(Region::Mandible))];
        let u = union_tau(&hold, &c4);
        eprintln!("union: {u:?}");
        assert_eq!(u.tau, [0.01, 0.04, 0.01, 0.01, 0.08]);
        assert_eq!(u.set_by, [FLOOR, HOLDOUT, FLOOR, FLOOR, CEPH400]);
        assert!((u.worst_holdout[1] - 0.031).abs() < 1e-9 && u.worst_ceph400[1] == 0.0, "{:?} {:?}", u.worst_holdout, u.worst_ceph400);
        assert!((u.worst_ceph400[4] - 0.073).abs() < 1e-9 && u.worst_holdout[4] == 0.0);
        assert_eq!(u.worst_ceph400[2], 0.0, "the mandible's far point sits on a film that did not find the mandible: it adds nothing");
        assert_eq!((u.films_holdout, u.films_ceph400), ([2; 5], [3, 3, 2, 3, 3]));
        // Equal worst points in both sets; and the same worst point on either side gives the same τ (the union is symmetric).
        let u = union_tau(&[film(Some(("PogS", 0.05)), None)], &[film(Some(("PogS", 0.05)), None)]);
        eprintln!("equal: tau {:?}, set by {:?}", u.tau, u.set_by);
        assert_eq!((u.tau[4], u.set_by[4]), (0.05, BOTH));
        assert_eq!(union_tau(&[film(Some(("PogS", 0.073)), None)], &[]).tau, union_tau(&[], &[film(Some(("PogS", 0.073)), None)]).tau);
        // The /1 rule on the hold-out alone is what /2 gives with an empty Ceph-400 set.
        assert_eq!(union_tau(&hold, &[]).tau, sc1_gate::tau(&hold).0);
    }

    /// C7 for Ceph-400 Train: 150 films pass and the not-found count per region is returned; 149 or 151 is broken.
    #[test] fn the_ceph400_train_count_is_150() {
        let mut c4: Vec<Traced> = (0..150).map(|_| film(None, None)).collect();
        c4[7] = film(None, Some(Region::Incisors));
        let (line, nf) = ceph400_counts(&c4).unwrap();
        assert_eq!(line, "Ceph-400 train films: compared 150 (expected 150)");
        eprintln!("150 films, one without incisors: not found {nf:?}");
        assert_eq!(nf, [0, 0, 0, 1, 0]);
        for n in [149, 151] {
            let c: Vec<Traced> = (0..n).map(|_| film(None, None)).collect();
            let e = ceph400_counts(&c).unwrap_err().to_string();
            eprintln!("{n} films: {e}");
            assert!(e.starts_with(&format!("Ceph-400 train films: compared {n}, expected 150")), "the set's own count, before any region's: {e}");
        }
    }

    /// The verdict: /1's verdict stands; a pass with a τ above 0.15 is a stop with its reason; 0.15 itself passes.
    #[test] fn a_tau_above_015_stops_a_pass() {
        let ok = [0.09, 0.02, 0.02, 0.01, 0.15];
        assert_eq!(verdict(PASS, &ok), (PASS, None));
        let (v, why) = verdict(PASS, &[0.09, 0.02, 0.02, 0.01, 0.16]);
        eprintln!("soft tissue 0.16: {v}, {why:?}");
        assert_eq!(v, STOP);
        assert!(why.unwrap().contains("soft-tissue profile"));
        assert_eq!(verdict(STOP, &ok).0, STOP);
        assert_eq!(verdict(sc1_gate::BROKEN, &[0.5; 5]).0, sc1_gate::BROKEN, "broken stays broken");
        assert_eq!(sc1_gate::exit_code(verdict(PASS, &[0.2; 5]).0), 4);
    }

    /// The refusals: SC1-1a's sets, the held-back sets and "all" are refused; the two train sets are read.
    #[test] fn the_run_refuses_sc1_1a_and_held_back_sets() {
        let d = tempfile::tempdir().unwrap();
        let (az, c4) = (d.path().join("aariz"), d.path().join("ceph400"));
        for p in [&az, &c4] { std::fs::create_dir_all(p).unwrap(); }
        assert!(refuse_reads(&[(&az, "train"), (&c4, "train")]).is_ok());
        for (p, s) in [(&c4, "test1"), (&az, "valid"), (&c4, "test2"), (&az, "test"), (&az, "all"), (&c4, "Test1")] {
            let e = refuse_reads(&[(&az, "train"), (p, s)]).err().unwrap_or_else(|| panic!("{s} was not refused")).to_string();
            eprintln!("{} {s}: {e}", p.file_name().unwrap().to_string_lossy());
            assert!(e.contains("refused") || e.contains("held back"), "{e}");
        }
    }

    // ---- sc1-box-gate/3 (owner OQ-1b-A = A, 5 Nov 2026): tau over four sets ----

    /// gate /3's pre-registration, pinned when it was committed alone (26efc5f, before any run).
    const PINNED3_SHA256: &str = "474665704da5ec56f65f9dad1983cd6390f2c11f729aec68ff30464a32828619";

    /// Fails if the file changes by one byte, or if a part the brief says is /2's word for word is not.
    #[test] fn gate3_preregistration_is_pinned() {
        assert_eq!(sha256_hex(GATE3.prereg.as_bytes()), PINNED3_SHA256, "reference/sc1-box-gate-3.json changed: the owner's OK, then a new version");
        let v: serde_json::Value = serde_json::from_str(GATE3.prereg).unwrap();
        let two: serde_json::Value = serde_json::from_str(PREREG).unwrap();
        assert_eq!((v["version"].as_str(), v["rule"].as_str()), (Some(GATE3.version), Some("whole-film/2")));
        for k in ["detector", "expertBox", "scoreLine", "quality", "gate", "tauCeiling", "verdicts"] { assert_eq!(v[k], two[k], "{k} is /2's"); }
        for k in ["C5", "C7", "C7ceph400Train", "C9", "committed"] { assert_eq!(v["controls"][k], two["controls"][k], "{k} is /2's"); }
        assert_eq!(v["tauCeiling"]["max"].as_f64(), Some(TAU_CEILING));
        assert_eq!(sc1_probe::pinned_fingerprint(&v), FP);
        assert!(v["tau"].as_str().unwrap().contains("70 + 150 + 150 + 150 = 520 films"));
        assert!(v["controls"]["C7development"].as_str().unwrap().contains("Ceph-400 test1 count 150 and Aariz valid count 150"));
        assert!(v["calibration"].as_str().unwrap().contains("rule = 'sc1-box-gate/3'") && v["calibration"].as_str().unwrap().contains("calibration-2.json"));
        assert_eq!(v["disclosure"], "development films, tuned on (R1b-5, OQ-1b-A)");
        for k in ["ceph400Test1", "aarizValid"] { assert!(v["films"][k].as_str().unwrap().contains("Development films: SC1-1a's spent films")); }
        assert!(!v["films"]["refused"].as_str().unwrap().contains("test1") && v["films"]["refused"].as_str().unwrap().contains("PKU"));
    }

    /// Four sets: the worst point placed in the Aariz-valid set sets τ there, and `set_by` names it; each set's worst point
    /// and films are kept. Fails if: a set is dropped from the union (then the Aariz-valid point is lost and τ falls).
    #[test] fn union_of_four_sets_takes_the_worst_of_each() {
        let hold = vec![film(Some(("ANS", 0.031)), None)];
        let c4 = vec![film(Some(("PogS", 0.073)), None), film(None, None)];
        let t1 = vec![film(Some(("Go", 0.044)), None)];
        let av = vec![film(None, None), film(Some(("PogS", 0.12)), None)];
        let u = union_tau_sets(&[(HOLDOUT, &hold), (CEPH400, &c4), (TEST1_DEV, &t1), (VALID_DEV, &av)]);
        eprintln!("four sets: tau {:?}, set by {:?}", u.tau, u.set_by);
        assert_eq!(u.tau, [0.01, 0.04, 0.05, 0.01, 0.12]);
        assert_eq!(u.set_by[4], vec![VALID_DEV]);
        assert_eq!((u.set_by[1].clone(), u.set_by[2].clone(), u.set_by[0].clone()), (vec![HOLDOUT], vec![TEST1_DEV], vec![]));
        assert!((u.worst[3][4] - 0.12).abs() < 1e-9 && (u.worst[1][4] - 0.073).abs() < 1e-9);
        assert_eq!(u.films.iter().map(|f| f[0]).collect::<Vec<_>>(), vec![1, 2, 1, 2]);
        // A tie names both sets.
        let u = union_tau_sets(&[(HOLDOUT, &[film(Some(("PogS", 0.05)), None)][..]), (VALID_DEV, &[film(Some(("PogS", 0.05)), None)][..])]);
        assert_eq!(u.set_by[4], vec![HOLDOUT, VALID_DEV]);
        // /2's union_tau is the two-set case of the same function.
        let (h, c) = (vec![film(Some(("ANS", 0.031)), None)], vec![film(Some(("PogS", 0.073)), None)]);
        let n = union_tau_sets(&[(HOLDOUT, &h), (CEPH400, &c)]);
        assert_eq!(union_tau(&h, &c).tau, n.tau);
    }

    /// The /3 reads: Ceph-400 train and test1, Aariz train and valid; Test2, Aariz test, PKU (sealed) and "all" are refused
    /// before any file is read. Fails if: /3 uses /2's list (which refuses test1 and valid) or omits PKU.
    #[test] fn gate3_refuses_test2_aariz_test_pku_and_all() {
        let d = tempfile::tempdir().unwrap();
        let (az, c4, pku) = (d.path().join("aariz"), d.path().join("ceph400"), d.path().join("pku"));
        for p in [&az, &c4, &pku] { std::fs::create_dir_all(p).unwrap(); }
        assert!(refuse_reads_for(&GATE3, &[(&az, "train"), (&az, "valid"), (&c4, "train"), (&c4, "test1")]).is_ok());
        for (p, s) in [(&c4, "test2"), (&az, "test"), (&pku, "test"), (&az, "all"), (&c4, "all"), (&pku, "all")] {
            let e = refuse_reads_for(&GATE3, &[(&az, "train"), (p, s)]).err().unwrap_or_else(|| panic!("{s} was not refused")).to_string();
            eprintln!("gate /3, {} {s}: {e}", p.file_name().unwrap().to_string_lossy());
            assert!(e.contains("refused") || e.contains("held back") || e.contains("sealed"), "{e}");
        }
        // /2 is unchanged: it still refuses SC1-1a's films.
        assert!(refuse_reads_for(&GATE2, &[(&c4, "test1")]).is_err() && refuse_reads_for(&GATE2, &[(&az, "valid")]).is_err());
    }

    /// keep_previous under /3: a /2 file in place is kept byte for byte as calibration-2.json; a /1 file is not /3's to keep;
    /// a different calibration-2.json already there is broken. Fails if: keep_previous keeps only /1 files.
    #[test] fn the_v2_calibration_is_kept_as_calibration_2() {
        let d = tempfile::tempdir().unwrap();
        let models = d.path().join("models");
        std::fs::create_dir_all(models.join("regions")).unwrap();
        let two = sc1_gate::calibration_text(FP, 0.5, [0.09, 0.02, 0.02, 0.01, 0.10], CAL1_SHA, Some(VERSION)).unwrap();
        std::fs::write(calibration_path(&models), &two).unwrap();
        assert_eq!(keep_previous(&models, &GATE3).unwrap(), Some(two.as_bytes().to_vec()));
        assert_eq!(calibration_kept_path(&models, &GATE3), calibration_path(&models).with_file_name("calibration-2.json"));
        assert_eq!(keep_previous(&models, &GATE2).unwrap(), None, "/2 keeps only a /1 file");
        std::fs::write(calibration_kept_path(&models, &GATE3), b"something else").unwrap();
        let e = keep_previous(&models, &GATE3).unwrap_err().to_string();
        eprintln!("calibration-2.json with other bytes: {e}");
        assert!(e.contains("refusing"), "{e}");
        std::fs::remove_file(calibration_kept_path(&models, &GATE3)).unwrap();
        let one = sc1_gate::calibration_text(FP, 0.5, [0.09, 0.01, 0.01, 0.01, 0.01], CAL1_SHA, None).unwrap();
        std::fs::write(calibration_path(&models), &one).unwrap();
        assert_eq!(keep_previous(&models, &GATE3).unwrap(), None, "a /1 file is not the one /3 supersedes");
        assert_eq!(keep_previous(&models, &GATE2).unwrap(), Some(one.as_bytes().to_vec()));
    }

    /// Task E3 review M1: a gate run never writes over a calibration set by a later rule (gate /4 is the owner's
    /// whole-film/3 ruling, spec §17.15). Fails if: `keep_previous` lets /2 replace a /3 or /4 file, or /3 a /4 file (it
    /// returned Ok(None) for any rule but the one it keeps, so a passing run overwrote the later file); or if a re-run of
    /// the same rule over its own file is refused.
    #[test] fn a_gate_run_never_replaces_a_later_rules_calibration() {
        let d = tempfile::tempdir().unwrap();
        let models = d.path().join("models");
        std::fs::create_dir_all(models.join("regions")).unwrap();
        let tau = [0.09, 0.02, 0.02, 0.01, 0.10];
        for (in_place, spec, refused) in [("sc1-box-gate/4", &GATE3, true), ("sc1-box-gate/4", &GATE2, true), ("sc1-box-gate/3", &GATE2, true),
                                          ("sc1-box-gate/3", &GATE3, false), (VERSION, &GATE2, false)] {
            let cal = sc1_gate::calibration_text(FP, 0.5, tau, CAL1_SHA, Some(in_place)).unwrap();
            std::fs::write(calibration_path(&models), &cal).unwrap();
            let r = keep_previous(&models, spec);
            eprintln!("{in_place} in place, {} run: {:?}", spec.version, r.as_ref().map(|o| o.is_some()).map_err(|e| e.to_string()));
            assert_eq!(r.is_err(), refused, "{in_place} under {}", spec.version);
            if refused { let e = r.unwrap_err().to_string(); assert!(e.contains("supersedes") && e.contains(in_place), "{e}"); }
            assert_eq!(std::fs::read_to_string(calibration_path(&models)).unwrap(), cal, "the file in place is untouched");
        }
    }

    // ---- run_with on SYNTHETIC folders (/1's fixture plus Ceph-400 train 001-150; the tiny region model) ----

    struct Gx { r: Rx, found: Vec<RegionBox> }
    impl Gx {
        fn run(&self) -> i32 { run_with(&self.r.aariz, &self.r.ceph400, &self.r.models, &self.r.out, &self.r.split, &self.r.git, &self.r.fp).unwrap() }
        fn report(&self) -> PathBuf { self.r.out.join("box-gate-2.json") }
        fn cal(&self) -> PathBuf { self.r.calibration() }
        fn cal1(&self) -> PathBuf { self.r.calibration().with_file_name("calibration-1.json") }
        /// Ceph-400 train's tracings: clean, except film 001's PogS `soft` of its box's side outside (0: clean).
        fn ceph400_tracings(&self, soft: f64) {
            let mut s = String::from("image_id,landmark,x,y\n");
            for i in 1..=150 {
                let mut t = tracing_for(&self.found, 1.0);
                if i == 1 && soft > 0.0 {
                    let b = self.found.iter().find(|b| b.region == Region::SoftTissue).unwrap();
                    let q = t.iter_mut().find(|x| x.0 == "PogS").unwrap();
                    q.1 = b.x1 + soft * b.longer_side();
                    q.2 = (b.y0 + b.y1) / 2.0;
                }
                for (n, x, y) in t { s += &format!("{i:03},{n},{x},{y}\n"); }
            }
            std::fs::write(self.r.ceph400.join("gt.csv"), s).unwrap();
        }
    }
    const CAL1_SHA: &str = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    /// /1's SYNTHETIC folders (Aariz 20 train, 3 valid; Ceph-400 test1 151-153 listed), plus Ceph-400 train 001-150 with
    /// images and tracings, and a /1 calibration (no rule field) already in place.
    fn gx() -> Gx { gx_k(1.0) }
    /// As `gx`, with the hold-out's expert boxes the model's own scaled by `k` (1/3: IoU 1/9, the gate stops).
    fn gx_k(k: f64) -> Gx {
        let r = rx(k, &[]);
        let engine = RegionEngine::load(&regions_manifest_path(&r.models)).unwrap();
        let found = crate::sc1_boxes::region_boxes(&engine.find(&crate::sc1_boxes::film(&r.aariz, &r.split.holdout[0], false).unwrap()).unwrap());
        for i in 1..=150u32 { ramp(&r.ceph400.join("images").join(format!("{i:03}.png")), 100 + i); }
        let train: Vec<String> = (1..=150).map(|i| format!("{i:03}")).collect();
        std::fs::write(r.ceph400.join("splits.json"), serde_json::json!({"train": train, "test1": ["151", "152", "153"], "test2": ["301"]}).to_string()).unwrap();
        let mut g = Gx { r, found };
        g.r.git = Git { prereg_at_head: Some(PREREG.as_bytes().to_vec()), dirty: false, sha: "SYNTHETIC".into() };
        g.ceph400_tracings(0.0);
        std::fs::write(g.cal(), sc1_gate::calibration_text(&g.r.fp, 0.5, [0.09, 0.01, 0.01, 0.01, 0.01], CAL1_SHA, None).unwrap()).unwrap();
        g
    }

    /// The pass end to end: exit 0; box-gate-2.json written; the calibration has rule /2, the report's SHA-256, the
    /// detector and the union τ (soft tissue set by Ceph-400 train: 0.073 -> 0.08); the /1 file is kept byte for byte as
    /// calibration-1.json; the region probe's /1 pins now refuse the new calibration. Fails if τ ignores Ceph-400, the
    /// rule is not recorded, the /1 file is not kept, or the C7 count of 150 is not reported.
    #[test] fn run_with_passes_with_tau_from_both_sets_and_keeps_the_1_calibration() {
        let g = gx();
        g.ceph400_tracings(0.073);
        let before = std::fs::read(g.cal()).unwrap();
        let code = g.run();
        let text = std::fs::read_to_string(g.report()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        eprintln!("pass: exit {code}; verdict {}; tau {}; set by {}; worst c4 {}; films c4 {}", v["verdict"], v["tau"], v["setBy"], v["worstCeph400Train"], v["ceph400TrainFilms"]);
        assert_eq!((code, v["verdict"].as_str().unwrap()), (0, "pass"));
        assert_eq!(v["ceph400TrainFilms"], 150);
        assert_eq!(v["c7Ceph400Train"], "Ceph-400 train films: compared 150 (expected 150)", "C7 for Ceph-400 train ran");
        assert_eq!(v["preregSha256"], PINNED_SHA256);
        assert_eq!(v["tau"]["softTissue"].as_f64(), Some(0.08));
        assert_eq!(v["setBy"]["softTissue"], CEPH400);
        assert_eq!(v["tauV1"]["cranialBase"].as_f64(), Some(0.09));
        let c = parse_calibration(&std::fs::read(g.cal()).unwrap()).unwrap();
        eprintln!("calibration: {c:?}");
        assert_eq!((c.gate_rule(), c.gate_report_sha256.as_str(), c.detector_fingerprint.as_str()), (VERSION, sha256_hex(text.as_bytes()).as_str(), g.r.fp.as_str()));
        assert_eq!(c.tau.0[4], 0.08);
        assert_eq!(std::fs::read(g.cal1()).unwrap(), before, "the /1 calibration kept byte for byte");
        // The region probe /1 pins /1's τ: given everything else of the new file, it still refuses it on τ.
        let pins = sc1_probe::Pins { fingerprint: g.r.fp.clone(), gate_report_sha256: c.gate_report_sha256.clone(), score_line: c.score_line, tau: [0.09, 0.01, 0.01, 0.01, 0.01] };
        let e = sc1_probe::check_calibration(&c, &g.r.fp, text.as_bytes(), &pins).unwrap_err().to_string();
        eprintln!("the region probe /1 on the /2 calibration: {e}");
        assert!(e.contains("tau"), "{e}");
        // A re-run with the /2 file in place keeps calibration-1.json as the /1 file.
        assert_eq!(g.run(), 0);
        assert_eq!(std::fs::read(g.cal1()).unwrap(), before, "a re-run never overwrites the /1 record");
    }

    /// The τ ceiling: a Ceph-400 point 0.2 of its box's side outside gives τ 0.20 > 0.15: stop, exit 4, the report says
    /// why, and neither calibration file is touched.
    #[test] fn run_with_stops_on_a_tau_above_015_and_writes_no_calibration() {
        let g = gx();
        g.ceph400_tracings(0.2);
        let before = std::fs::read(g.cal()).unwrap();
        let code = g.run();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(g.report()).unwrap()).unwrap();
        eprintln!("tau ceiling: exit {code}; verdict {}; reason {}", v["verdict"], v["stopReason"]);
        assert_eq!((code, v["verdict"].as_str().unwrap()), (4, "stop"));
        assert!(v["stopReason"].as_str().unwrap().contains("0.15"));
        assert_eq!(std::fs::read(g.cal()).unwrap(), before);
        assert!(!g.cal1().exists());
    }

    /// The gate itself (/1's, unchanged): hold-out expert boxes a third the size of the detected ones (IoU 1/9) stop the
    /// run with exit 4 and no calibration, whatever τ is. Fails if /2 drops /1's gate verdict.
    #[test] fn run_with_stops_when_the_gate_stops() {
        let g = gx_k(1.0 / 3.0);
        let before = std::fs::read(g.cal()).unwrap();
        let code = g.run();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(g.report()).unwrap()).unwrap();
        eprintln!("gate stop: exit {code}; verdict {}; IoU medians {:?}", v["verdict"], v["quality"].as_array().unwrap().iter().map(|q| q["iouMedian"].as_f64().unwrap()).collect::<Vec<_>>());
        assert_eq!((code, v["verdict"].as_str().unwrap()), (4, "stop"));
        assert!(v["stopReason"].is_null(), "a gate stop, not a tau stop");
        assert_eq!(std::fs::read(g.cal()).unwrap(), before);
        assert!(!g.cal1().exists());
    }

    /// /2's SYNTHETIC folders plus the development films: Ceph-400 test1 151-300 and Aariz valid va-0001..va-0150, with
    /// images and clean tracings; a /2 calibration in place; git at gate /3's pre-registration.
    fn gx3() -> Gx {
        let mut g = gx();
        for i in 151..=300u32 { ramp(&g.r.ceph400.join("images").join(format!("{i}.png")), 100 + i); }
        let valid: Vec<String> = (1..=150).map(|i| format!("va-{i:04}")).collect();
        for (i, id) in valid.iter().enumerate() { ramp(&g.r.aariz.join("images").join(format!("{id}.png")), 500 + i as u32); }
        let train: Vec<String> = (1..=150).map(|i| format!("{i:03}")).collect();
        let t1: Vec<String> = (151..=300).map(|i| format!("{i}")).collect();
        std::fs::write(g.r.ceph400.join("splits.json"), serde_json::json!({"train": train, "test1": t1, "test2": ["301"]}).to_string()).unwrap();
        let (az_train, _) = sc1_gate::aariz_train_valid(&g.r.aariz).unwrap();
        std::fs::write(g.r.aariz.join("splits.json"), serde_json::json!({"train": az_train, "valid": valid, "test": ["te-0001"]}).to_string()).unwrap();
        g.dev_tracings(0.0);
        g.r.git = Git { prereg_at_head: Some(GATE3.prereg.as_bytes().to_vec()), dirty: false, sha: "SYNTHETIC".into() };
        std::fs::write(g.cal(), sc1_gate::calibration_text(&g.r.fp, 0.5, [0.09, 0.02, 0.02, 0.01, 0.10], CAL1_SHA, Some(VERSION)).unwrap()).unwrap();
        g
    }
    impl Gx {
        fn run3(&self) -> i32 { run_with_spec(&GATE3, &self.r.aariz, &self.r.ceph400, &self.r.models, &self.r.out, &self.r.split, &self.r.git, &self.r.fp).unwrap() }
        /// The development films' tracings: Ceph-400 test1 appended to its gt.csv, Aariz valid rewritten in Aariz's;
        /// clean, except Aariz valid va-0007's PogS `soft` of its box's side outside (0: clean).
        fn dev_tracings(&self, soft: f64) {
            let tr = tracing_for(&self.found, 1.0);
            let c4 = std::fs::read_to_string(self.r.ceph400.join("gt.csv")).unwrap();
            let mut s: String = c4.lines().filter(|l| !l.split(',').next().unwrap().parse::<u32>().is_ok_and(|n| n > 150)).map(|l| l.to_string() + "\n").collect();
            for i in 151..=300 { for (n, x, y) in &tr { s += &format!("{i},{n},{x},{y}\n"); } }
            std::fs::write(self.r.ceph400.join("gt.csv"), s).unwrap();
            let az = std::fs::read_to_string(self.r.aariz.join("gt.csv")).unwrap();
            let mut s: String = az.lines().filter(|l| !l.starts_with("va-")).map(|l| l.to_string() + "\n").collect();
            for i in 1..=150 {
                let mut t = tr.clone();
                if i == 7 && soft > 0.0 {
                    let b = self.found.iter().find(|b| b.region == Region::SoftTissue).unwrap();
                    let q = t.iter_mut().find(|x| x.0 == "PogS").unwrap();
                    q.1 = b.x1 + soft * b.longer_side();
                    q.2 = (b.y0 + b.y1) / 2.0;
                }
                for (n, x, y) in t { s += &format!("va-{i:04},{n},{x},{y}\n"); }
            }
            std::fs::write(self.r.aariz.join("gt.csv"), s).unwrap();
        }
    }

    /// Gate /3 end to end on SYNTHETIC folders: exit 0; box-gate-3.json with the four sets' counts (C7 and C7development),
    /// the disclosure, τ /2 -> /3; soft tissue set by Aariz valid (0.115 -> 0.12); the calibration rule /3 with the report's SHA-256;
    /// the /2 file kept byte for byte as calibration-2.json. Fails if: the development films are not read, the rule or the
    /// kept file is wrong, or the disclosure is missing.
    #[test] fn run_with_gate3_sets_tau_over_four_sets_and_keeps_the_2_calibration() {
        let g = gx3();
        g.dev_tracings(0.115);
        let before = std::fs::read(g.cal()).unwrap();
        let code = g.run3();
        let text = std::fs::read_to_string(g.r.out.join("box-gate-3.json")).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        eprintln!("gate /3: exit {code}; verdict {}; tau {}; tau /2 {}; set by {}; C7 dev {}", v["verdict"], v["tau"], v["tauV2"], v["setBy"], v["c7Development"]);
        assert_eq!((code, v["verdict"].as_str().unwrap()), (0, "pass"));
        assert_eq!(v["version"], GATE3.version);
        assert_eq!(v["preregSha256"], PINNED3_SHA256);
        assert_eq!(v["disclosure"], "development films, tuned on (R1b-5, OQ-1b-A)");
        assert_eq!(v["c7Development"], "Ceph-400 test1 films: compared 150 (expected 150); Aariz valid films: compared 150 (expected 150)");
        assert_eq!(v["tau"]["softTissue"].as_f64(), Some(0.12));
        assert_eq!(v["setBy"]["softTissue"], VALID_DEV);
        assert_eq!(v["tauV2"]["softTissue"].as_f64(), Some(0.10));
        assert!(v.get("tauV1").is_none(), "/3 reports /2's tau, not /1's");
        assert_eq!(v["filmsCeph400Test1"]["maxilla"], 150);
        let c = parse_calibration(&std::fs::read(g.cal()).unwrap()).unwrap();
        assert_eq!((c.gate_rule(), c.gate_report_sha256.as_str()), (GATE3.version, sha256_hex(text.as_bytes()).as_str()));
        assert_eq!(std::fs::read(calibration_kept_path(&g.r.models, &GATE3)).unwrap(), before, "the /2 calibration kept byte for byte");
        // A count off on the development films is broken, nothing written (C7development).
        let g = gx3();
        let valid: Vec<String> = (1..=149).map(|i| format!("va-{i:04}")).collect();
        let (az_train, _) = sc1_gate::aariz_train_valid(&g.r.aariz).unwrap();
        std::fs::write(g.r.aariz.join("splits.json"), serde_json::json!({"train": az_train, "valid": valid}).to_string()).unwrap();
        assert_eq!(g.run3(), 1, "149 Aariz valid films: broken");
        assert!(!g.r.out.join("box-gate-3.json").exists());
    }

    /// Broken, nothing written: the pre-registration not committed, changed at HEAD, or a dirty tree; another detector than
    /// the pinned one; a Ceph-400 train list naming a Test1 film (151, given a tracing); a calibration-1.json already there
    /// with other bytes; folders swapped. Then the control: the same folders with the guards satisfied run.
    #[test] fn run_with_is_broken_and_writes_nothing_on_any_guard() {
        let mut g = gx();
        let before = std::fs::read(g.cal()).unwrap();
        let mut changed = PREREG.as_bytes().to_vec();
        changed[10] ^= 1;
        let check = |g: &Gx, what: &str, code: i32| {
            eprintln!("{what}: exit {code}");
            assert_eq!(code, 1, "{what}");
            assert!(!g.report().exists(), "{what}: no report");
            assert_eq!(std::fs::read(g.cal()).unwrap(), before, "{what}: calibration untouched");
        };
        for (what, head, dirty) in [("not committed", None, false), ("changed at HEAD", Some(changed), false), ("dirty tree", Some(PREREG.as_bytes().to_vec()), true)] {
            g.r.git = Git { prereg_at_head: head, dirty, sha: "SYNTHETIC".into() };
            let code = g.run();
            check(&g, &format!("pre-registration {what}"), code);
        }
        g.r.git = Git { prereg_at_head: Some(PREREG.as_bytes().to_vec()), dirty: false, sha: "SYNTHETIC".into() };
        let code = run_with(&g.r.aariz, &g.r.ceph400, &g.r.models, &g.r.out, &g.r.split, &g.r.git, FP).unwrap();
        check(&g, "another detector than the pinned one", code);
        let code = run_with(&g.r.ceph400, &g.r.aariz, &g.r.models, &g.r.out, &g.r.split, &g.r.git, &g.r.fp).unwrap();
        check(&g, "folders swapped", code);
        std::fs::write(g.cal1(), b"something else").unwrap();
        let code = g.run();
        check(&g, "calibration-1.json already there with other bytes", code);
        std::fs::remove_file(g.cal1()).unwrap();
        let splits = std::fs::read_to_string(g.r.ceph400.join("splits.json")).unwrap();
        std::fs::write(g.r.ceph400.join("splits.json"), serde_json::json!({"train": (1..=149).map(|i| format!("{i:03}")).chain(["151".to_string()]).collect::<Vec<_>>()}).to_string()).unwrap();
        let gt = std::fs::read_to_string(g.r.ceph400.join("gt.csv")).unwrap();
        let extra: String = gt.lines().filter(|l| l.starts_with("001,")).map(|l| l.replacen("001,", "151,", 1) + "\n").collect();
        std::fs::write(g.r.ceph400.join("gt.csv"), gt + &extra).unwrap();
        let code = g.run();
        check(&g, "Ceph-400 train list naming 151", code);
        assert!(!g.r.out.join("boxes").exists(), "refused before any film is read");
        std::fs::write(g.r.ceph400.join("splits.json"), splits).unwrap();
        assert_eq!(g.run(), 0, "control: the same folders with the guards satisfied run");
    }
}
