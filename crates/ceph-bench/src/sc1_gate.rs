//! SC-1 Part 1 Task 10 (spec §3.3, §4.2, §9.1; owner ruling RV-1): the box-quality gate, run on the Aariz-train
//! hold-out before SC1-1a, through the app's own region finder (`ceph_infer::regions::RegionEngine`, ONNX Runtime CPU
//! fp32). Pre-registered in `reference/sc1-box-gate.json` (committed before any run, SHA-256 pinned in a test); every
//! rule below is that file's, word for word.
//!
//! **The picture.** On each hold-out film the region finder draws five rectangles (cranial base, maxilla, mandible,
//! incisors, soft-tissue profile). Beside each we draw the rectangle the teaching rule draws round the experts' points
//! for that region (10% margin of its longer side). The gate asks how well the two rectangles overlap (IoU: the area they
//! share ÷ the area they cover together; 1 identical, 0 apart) and how far apart their centres are. If any region's
//! median IoU over the hold-out is below 0.5, the run stops with exit 4: a stop, not a fail; SC1-1a does not run.
//!
//! **What it writes.** `<out>/box-gate.json` (pass or stop) and, only on a pass, `<models>/regions/calibration.json`
//! (`region-calibration/1`: the detector's fingerprint, the score line, the five τ_r and this report's SHA-256), which is
//! what the app reads. Broken (exit 1) writes nothing.
//!
//! **Information only, never a gate:** the same table on SC1-1a's normal films (Ceph-400 test1 at 0.1 mm/px, where the
//! expert boxes come from the 19 points only; Aariz valid, only the films `aariz-scale/1` gives a true scale).
//! Ceph-400 test2 and Aariz test are refused before any file is read (C5). Film ids are never printed.
use crate::{chainproof, dataset, ft_common, ledger, sc1_boxes, scale};
use crate::sc1_data::{self, Split};
use anyhow::{ensure, Context};
use ceph_infer::regions::{regions_manifest_path, Found, RegionEngine};
use ceph_model::wholefilm::{box_quality, calibration_json, calibration_path, gate_passes, outside_ratio, parse_calibration, teaching_boxes,
    BoxQuality, FilmBoxes, RegionBox, RegionCalibration, RegionTau, Regions, BOX_GATE_MIN_MEDIAN_IOU, CALIBRATION_VERSION, REGIONS, REGION_OF};
use serde::{ser::SerializeMap, Deserialize, Serialize, Serializer};
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::Path;

pub const PREREG: &str = include_str!("../../../reference/sc1-box-gate.json");
pub const PREREG_PATH: &str = "reference/sc1-box-gate.json";
pub const VERSION: &str = "sc1-box-gate/1";
pub const PASS: &str = "pass";
pub const STOP: &str = "stop";
pub const BROKEN: &str = "broken";
/// C9: the detected boxes are inflated this many times about their centres (area × 4).
pub const C9_FACTOR: f64 = 2.0;
/// The score line's bounds (pre-registration `scoreLine`).
pub const SCORE_LINE_MIN: f64 = 0.01;
pub const SCORE_LINE_MAX: f64 = 0.50;
/// The smallest τ_r (pre-registration `tau`).
pub const TAU_MIN: f64 = 0.01;
/// Ceph-400's films are 0.1 mm per pixel.
pub const CEPH400_MM_PER_PX: f64 = 0.1;

/// The largest multiple of 0.01 at or below `x` (exact on a value already a whole hundredth, whatever x * 100 rounds to).
pub fn floor_hundredth(x: f64) -> f64 {
    let mut k = (x * 100.0).floor();
    if (k + 1.0) / 100.0 <= x { k += 1.0 }
    if k / 100.0 > x { k -= 1.0 }
    k / 100.0
}
/// The smallest multiple of 0.01 at or above `x` (0.07 stays 0.07 although 0.07 * 100 = 7.000000000000001).
pub fn ceil_hundredth(x: f64) -> f64 {
    let mut k = (x * 100.0).ceil();
    if (k - 1.0) / 100.0 >= x { k -= 1.0 }
    if k / 100.0 < x { k += 1.0 }
    k / 100.0
}

/// min(0.50, max(0.01, floor to 0.01 of the lowest best-box score any film gives any region)). `best`: per film, the
/// detector's best score per region (REGIONS order). Every best box is then at or above the line (so found).
pub fn score_line(best: &[[f32; 5]]) -> f32 {
    let lowest = best.iter().flatten().fold(f64::INFINITY, |a, &s| a.min(s as f64));
    floor_hundredth(lowest).max(SCORE_LINE_MIN).min(SCORE_LINE_MAX) as f32
}

/// Per region r: the largest outside-ratio of region r's TRACED expert points (`REGION_OF`; the extra teaching points are
/// never checked) against the film's detected box for r, over the films that found r, rounded up to 0.01 and at least
/// 0.01. The second array counts the films that found each region.
pub fn tau(holdout: &[(Regions, Vec<(String, f64, f64)>)]) -> ([f64; 5], [usize; 5]) {
    let (worst, films) = worst_outside(holdout);
    (worst.map(|w| ceil_hundredth(w).max(TAU_MIN)), films)
}

/// Per region r: the largest outside-ratio of r's traced expert points over the films that found r, before rounding (0
/// when every point sits inside), and the number of films that found r. `tau` rounds the first.
pub fn worst_outside(holdout: &[(Regions, Vec<(String, f64, f64)>)]) -> ([f64; 5], [usize; 5]) {
    let (mut worst, mut films) = ([0.0f64; 5], [0usize; 5]);
    for (regions, pts) in holdout {
        for r in REGIONS {
            let Some(b) = regions.get(r) else { continue };
            films[r.index()] += 1;
            for (id, x, y) in pts {
                if !(x.is_finite() && y.is_finite()) || !REGION_OF.iter().any(|(n, q)| *n == id.as_str() && *q == r) { continue }
                let v = outside_ratio(b, (*x, *y));
                if v > worst[r.index()] { worst[r.index()] = v }
            }
        }
    }
    (worst, films)
}

/// pass 0, stop 4, broken (or anything else) 1.
pub fn exit_code(verdict: &str) -> i32 { match verdict { PASS => 0, STOP => 4, _ => 1 } }

/// The gate's reading of the hold-out: the quality table, C9's table, whether C9 tripped, the verdict.
pub struct Judged { pub quality: Vec<BoxQuality>, pub control_c9: Vec<BoxQuality>, pub control_tripped: bool, pub verdict: &'static str }

/// C7 (the film count and every region's film count equal `expected`, else an error: broken), the quality table, C9 (the
/// detected boxes through `inflate`, which is `inflated(2.0)` in the run; every region's median IoU must fall below 0.5,
/// else broken), then the gate: pass when every region's median IoU is at least 0.5, otherwise stop.
pub fn judge(films: &[FilmBoxes], expected: usize, inflate: &dyn Fn(&RegionBox) -> RegionBox) -> anyhow::Result<Judged> {
    ft_common::counted("hold-out films", films.len(), expected)?;
    let quality = box_quality(films)?;
    for q in &quality { ft_common::counted(&format!("hold-out films measured for the {} region", q.region.words()), q.films, expected)?; }
    let inflated: Vec<FilmBoxes> = films.iter().map(|f| FilmBoxes {
        detected: Regions { boxes: f.detected.boxes.iter().map(inflate).collect(), ..f.detected.clone() },
        expert: f.expert.clone(), mm_per_px: f.mm_per_px }).collect();
    let control_c9 = box_quality(&inflated)?;
    let control_tripped = REGIONS.iter().all(|r| control_c9.iter().any(|q| q.region == *r && q.iou_median < BOX_GATE_MIN_MEDIAN_IOU));
    let verdict = if !control_tripped { BROKEN } else if gate_passes(&quality) { PASS } else { STOP };
    Ok(Judged { quality, control_c9, control_tripped, verdict })
}

/// C5: each (folder, split) the gate reads goes through both held-back gates first (`ledger::refuse_held_back`, which
/// resolves links, and `chainproof::refuse_held_back_cache`). Ceph-400 test2 and Aariz test are refused.
pub fn refuse_reads(reads: &[(&Path, &str)]) -> anyhow::Result<()> {
    for (d, s) in reads {
        ledger::refuse_held_back(d, s)?;
        chainproof::refuse_held_back_cache(d, s)?;
    }
    Ok(())
}

/// The git state the pre-registration is judged by (filled from git by `run_cli`; given directly in tests).
#[derive(Clone, Debug)]
pub struct Git { pub prereg_at_head: Option<Vec<u8>>, pub dirty: bool, pub sha: String }

/// `box-gate.json`. `tau` and `tauFilms` are keyed by region (`cranialBase`, `maxilla`, `mandible`, `incisors`,
/// `softTissue`); a centre error that is not a number (a region found on no film) is JSON null.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GateReport {
    pub version: String, pub prereg_sha256: String, pub git_sha: String, pub detector_fingerprint: String,
    pub holdout_films: usize, pub score_line: f32,
    #[serde(serialize_with = "by_region")] pub tau: [f64; 5],
    #[serde(serialize_with = "by_region")] pub tau_films: [usize; 5],
    pub quality: Vec<BoxQuality>, pub information: Vec<(String, Vec<BoxQuality>)>,
    pub control_c9: Vec<BoxQuality>, pub control_tripped: bool, pub verdict: String,
}
pub(crate) fn by_region<S: Serializer, T: Serialize>(v: &[T; 5], s: S) -> Result<S::Ok, S::Error> {
    let mut m = s.serialize_map(Some(5))?;
    for r in REGIONS { m.serialize_entry(&r, &v[r.index()])?; }
    m.end()
}
fn num(x: f64) -> String { if x.is_finite() { format!("{x:.3}") } else { "none".into() } }
pub(crate) fn table(q: &[BoxQuality]) -> Vec<String> {
    let mut v = vec!["  region               films  not found  IoU median  IoU p90  centre error median  p90     unit".to_string()];
    for x in q {
        let unit = if x.centre_err_median.is_nan() { "none (not found on any film)" } else if x.in_mm { "mm" } else { "fraction of the expert box's longer side" };
        v.push(format!("  {:<20} {:>5}  {:>9}  {:>10}  {:>7}  {:>19}  {:>6}  {unit}", x.region.words(), x.films, x.not_found,
            num(x.iou_median), num(x.iou_p90), num(x.centre_err_median), num(x.centre_err_p90)));
    }
    v
}
impl GateReport {
    pub fn exit_code(&self) -> i32 { exit_code(&self.verdict) }
    /// The printed lines: counts, medians and percentiles only (no film id).
    pub fn summary(&self) -> Vec<String> {
        let mut v = vec![format!("box-quality gate {} ({PREREG_PATH} sha256 {}); git HEAD {}; detector {}", self.version, self.prereg_sha256, self.git_sha, self.detector_fingerprint),
            format!("hold-out films: compared {} (expected {}, the split file's)", self.quality.first().map(|q| q.films).unwrap_or(0), self.holdout_films),
            format!("score line {:.2}", self.score_line),
            "the gate (Aariz-train hold-out): median IoU at least 0.5 on every region".into()];
        v.extend(table(&self.quality));
        v.push(format!("tau: {}", REGIONS.iter().map(|r| format!("{} {:.2} ({} films)", r.words(), self.tau[r.index()], self.tau_films[r.index()])).collect::<Vec<_>>().join(", ")));
        v.push(format!("C9 (the hold-out's detected boxes x2 about their centres): IoU medians {}; tripped on every region: {}",
            self.control_c9.iter().map(|q| format!("{} {}", q.region.words(), num(q.iou_median))).collect::<Vec<_>>().join(", "),
            if self.control_tripped { "yes" } else { "NO (the gate is broken)" }));
        for (name, q) in &self.information {
            v.push(format!("information only, never a gate: {name}"));
            v.extend(table(q));
        }
        v.push(format!("verdict {} (exit {}: 0 pass, 4 stop, 1 broken)", self.verdict, self.exit_code()));
        v
    }
}

/// Whether the folder is Ceph-400: its name, or its real folder's name, is `ceph400` in any case.
pub fn is_ceph400(p: &Path) -> bool {
    let named = |p: &Path| p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("ceph400"));
    named(p) || std::fs::canonicalize(p).is_ok_and(|r| named(&r))
}

/// C5 by film: Ceph-400 test1 is films 151-300; a list naming any other film (301-400 is Test2) is refused.
pub(crate) fn refuse_outside_test1(ids: &[String]) -> anyhow::Result<()> {
    let bad = ids.iter().filter(|id| !(id.len() == 3 && id.bytes().all(|b| b.is_ascii_digit()) && (151..=300).contains(&id.parse::<u32>().unwrap_or(0)))).count();
    let test2 = ids.iter().filter(|id| id.parse::<u32>().is_ok_and(|n| n > 300)).count();
    ensure!(bad == 0, "Ceph-400's test1 list names {bad} film(s) outside 151-300 ({test2} of them Test2, 301-400, which stays closed): refused before any film is read");
    Ok(())
}

/// Only the `train` and `valid` lists of Aariz's splits.json (the test list is not kept).
pub(crate) fn aariz_train_valid(aariz: &Path) -> anyhow::Result<(Vec<String>, Vec<String>)> {
    #[derive(Deserialize)] struct TrainValid { train: Vec<String>, valid: Vec<String> }
    let p = aariz.join("splits.json");
    let t: TrainValid = serde_json::from_str(&std::fs::read_to_string(&p).with_context(|| p.display().to_string())?)
        .with_context(|| format!("{}: no train and valid lists", p.display()))?;
    Ok((t.train, t.valid))
}

/// Every film's expert tracing has all 19 traced points as numbers; refused otherwise (never boxed from what is left).
pub(crate) fn complete(gt: &dataset::Points, ids: &[String], what: &str) -> anyhow::Result<()> {
    let mut missing: BTreeMap<&str, usize> = BTreeMap::new();
    let mut films = 0;
    for id in ids {
        let pts = gt.get(id).map(|v| v.as_slice()).unwrap_or(&[]);
        let lacks: Vec<&str> = REGION_OF.iter().map(|(n, _)| *n)
            .filter(|n| !pts.iter().any(|(p, x, y)| p == n && x.is_finite() && y.is_finite())).collect();
        if !lacks.is_empty() { films += 1; for n in lacks { *missing.entry(n).or_default() += 1; } }
    }
    ensure!(films == 0, "{films} {what} film(s) lack expert points ({}): the expert tracings must hold all 19; refused",
        missing.iter().map(|(n, c)| format!("{n} on {c}")).collect::<Vec<_>>().join(", "));
    Ok(())
}

/// The detector's best score per region of one film (REGIONS order). Exactly five boxes, one per region, every corner and
/// score a finite number; otherwise an error (broken).
pub(crate) fn best_scores(f: &Found) -> anyhow::Result<[f32; 5]> {
    let mut s = [f32::NAN; 5];
    ensure!(f.boxes.len() == 5, "a film has {} boxes from the region finder, not 5", f.boxes.len());
    for b in &f.boxes {
        ensure!(b.region < 5 && s[b.region].is_nan(), "a film's boxes do not name each of the five regions once");
        ensure!([b.x0, b.y0, b.x1, b.y1].iter().all(|v| v.is_finite()) && b.score.is_finite(), "a film's box for region {} is not a finite number", b.region);
        s[b.region] = b.score;
    }
    Ok(s)
}

/// One set's films as the gate sees them: the detector's boxes at the score line, the expert boxes, the scale.
pub(crate) fn film_boxes(engine: &RegionEngine, data: &Path, split: &str, films: &[(String, Option<f64>)], gt: &dataset::Points, cache: &Path, line: f32, fp: &str)
    -> anyhow::Result<(Vec<FilmBoxes>, Vec<(Regions, Vec<(String, f64, f64)>)>)> {
    let ids: Vec<String> = films.iter().map(|(id, _)| id.clone()).collect();
    let found = sc1_boxes::boxes_for(engine, data, split, &ids, cache, false)?;
    ft_common::counted(&format!("{split} films with boxes"), found.len(), ids.len())?;
    let (mut out, mut pts) = (Vec::new(), Vec::new());
    for (id, mm) in films {
        let f = &found[id];
        best_scores(f)?;
        let detected = Regions::from_scored(&sc1_boxes::region_boxes(f), line, fp)?;
        let p = gt[id].clone();
        out.push(FilmBoxes { detected: detected.clone(), expert: teaching_boxes(&p, f.image_width, f.image_height), mm_per_px: *mm });
        pts.push((detected, p));
    }
    Ok((out, pts))
}

/// The information table for one set (never a gate): the films' quality, every region measured on every film (C7).
fn information(engine: &RegionEngine, data: &Path, split: &str, films: &[(String, Option<f64>)], gt: &dataset::Points, cache: &Path, line: f32, fp: &str) -> anyhow::Result<Vec<BoxQuality>> {
    let (fb, _) = film_boxes(engine, data, split, films, gt, cache, line, fp)?;
    let q = box_quality(&fb)?;
    for x in &q { ft_common::counted(&format!("{split} films measured for the {} region", x.region.words()), x.films, films.len())?; }
    Ok(q)
}

/// The whole run up to the report (nothing written). An error is broken.
fn gate_run(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git) -> anyhow::Result<GateReport> {
    // C5 first, before any file is read.
    refuse_reads(&[(aariz, "train"), (aariz, "valid"), (ceph400, "test1")])?;
    ensure!(scale::is_aariz(aariz), "{}: the gate runs on the Aariz-train hold-out, and this folder is not Aariz", aariz.display());
    ensure!(is_ceph400(ceph400), "{}: the information table reads Ceph-400 test1, and this folder is not Ceph-400", ceph400.display());
    // The pre-registration: committed as built, from a clean tree.
    ensure!(!git.dirty, "commit first: the gate is pre-registered ({PREREG_PATH}) and runs only from a clean tree");
    ft_common::committed_as_built(PREREG_PATH, PREREG, git.prereg_at_head.clone())?;
    let v: serde_json::Value = serde_json::from_str(PREREG)?;
    ensure!(v["version"] == VERSION, "this program knows {VERSION}, not {}", v["version"]);
    ensure!(v["gate"]["minMedianIoU"].as_f64() == Some(BOX_GATE_MIN_MEDIAN_IOU), "the pre-registered gate value is not the program's {BOX_GATE_MIN_MEDIAN_IOU}");
    sc1_data::ensure_outside_or_ignored(out)?;
    sc1_data::ensure_outside_or_ignored(models)?;
    // Superseded for τ by sc1-box-gate/2 (owner, 5 Nov 2026): never write over a calibration that /2 set.
    if let Ok(bytes) = std::fs::read(calibration_path(models)) {
        if let Ok(c) = parse_calibration(&bytes) {
            ensure!(c.gate_rule() == VERSION, "the calibration in place was set by {}, which supersedes {VERSION} for tau (owner, 5 Nov 2026): this run would overwrite it; refused", c.gate_rule());
        }
    }
    // C5 by film, then the lists: the hold-out is in Aariz train, valid shares no film with train.
    let c4_ids = dataset::select(&dataset::load_splits(&ceph400.join("splits.json"))?, "test1")?;
    refuse_outside_test1(&c4_ids)?;
    let (train, valid) = aariz_train_valid(aariz)?;
    let train: BTreeSet<String> = train.into_iter().collect();
    let strangers = split.holdout.iter().filter(|id| !train.contains(*id)).count();
    ensure!(strangers == 0, "{strangers} hold-out film(s) of the split file are not in Aariz train: refused");
    ensure!(!valid.is_empty() && valid.iter().all(|id| !train.contains(id)), "Aariz valid is empty or shares films with train: refused");
    // The detector, and its faithfulness record for the same fingerprint over the whole hold-out.
    let engine = RegionEngine::load(&regions_manifest_path(models))?;
    let fp = engine.spec().fingerprint();
    check_faithfulness(out, &fp, split.holdout.len())?;
    // The expert tracings (complete) and the scales.
    let az_gt = dataset::load_points(&aariz.join("gt.csv"))?;
    let c4_gt = dataset::load_points(&ceph400.join("gt.csv"))?;
    complete(&az_gt, &split.holdout, "hold-out")?;
    complete(&c4_gt, &c4_ids, "Ceph-400 test1")?;
    let spacing = dataset::load_spacing(&aariz.join("spacing.csv"))?;
    let header = scale::load_header_resolution(aariz)?;
    let valid_plan = scale::plan(&valid, &spacing, &header, &az_gt)?;
    let valid_ids: Vec<String> = valid_plan.films.iter().map(|(id, _)| id.clone()).collect();
    complete(&az_gt, &valid_ids, "Aariz valid")?;
    // The hold-out: score line, the gate, C9, τ.
    let cache = out.join("boxes");
    let hold_ids = &split.holdout;
    let (line, films, tau_in) = holdout_boxes(&engine, aariz, hold_ids, &az_gt, &cache, &fp)?;
    let j = judge(&films, hold_ids.len(), &|b| b.inflated(C9_FACTOR))?;
    let (tau, tau_films) = tau(&tau_in);
    // Information only: SC1-1a's normal films.
    let c4: Vec<(String, Option<f64>)> = c4_ids.iter().map(|id| (id.clone(), Some(CEPH400_MM_PER_PX))).collect();
    let av: Vec<(String, Option<f64>)> = valid_plan.films.iter().map(|(id, mm)| (id.clone(), Some(*mm))).collect();
    let information = vec![
        (format!("Ceph-400 test1: all {} films at {CEPH400_MM_PER_PX} mm/px; expert boxes from the 19 traced points only (Ceph-400 has no extra points), so smaller", c4.len()),
         information(&engine, ceph400, "test1", &c4, &c4_gt, &cache, line, &fp)?),
        (format!("Aariz valid: {} of {} films, those {} gives a true scale (centre error in mm)", av.len(), valid.len(), scale::AARIZ_SCALE_RULE),
         information(&engine, aariz, "valid", &av, &az_gt, &cache, line, &fp)?),
    ];
    Ok(GateReport { version: VERSION.into(), prereg_sha256: ft_common::sha256_hex(PREREG.as_bytes()), git_sha: git.sha.clone(), detector_fingerprint: fp,
        holdout_films: hold_ids.len(), score_line: line, tau, tau_films, quality: j.quality, information, control_c9: j.control_c9,
        control_tripped: j.control_tripped, verdict: j.verdict.into() })
}

/// The detector line: a passed faithfulness record (`<out>/faithfulness/faithfulness.json`) for detector `fp` over the
/// whole hold-out (`n` films); otherwise an error (broken).
pub(crate) fn check_faithfulness(out: &Path, fp: &str, n: usize) -> anyhow::Result<()> {
    let fpath = out.join("faithfulness").join("faithfulness.json");
    let faith: sc1_boxes::Faithfulness = serde_json::from_str(&std::fs::read_to_string(&fpath)
        .with_context(|| format!("{}: the gate requires a passed faithfulness record (--sc1-faithfulness) for this detector", fpath.display()))?)
        .with_context(|| format!("{} is not a {} file", fpath.display(), sc1_boxes::FAITHFULNESS_SCHEMA))?;
    ensure!(faith.schema == sc1_boxes::FAITHFULNESS_SCHEMA, "{}: schema {:?}", fpath.display(), faith.schema);
    ensure!(faith.passed(), "the faithfulness record's verdict is {:?}, not pass: the gate does not run", faith.verdict);
    ensure!(faith.fingerprint.eq_ignore_ascii_case(fp), "the faithfulness record is for detector {}, the installed one is {fp}", faith.fingerprint);
    ensure!(faith.compared == n && faith.expected == n,
        "the faithfulness record compared {} of {} films; the hold-out is {n}", faith.compared, faith.expected);
    Ok(())
}

/// The hold-out through the detector: the score line (the lowest best score, checked: every best box at or above it), the
/// films as the gate sees them (scale from `aariz-scale/1`), and per film the detected regions with the traced points (τ).
pub(crate) fn holdout_boxes(engine: &RegionEngine, aariz: &Path, hold_ids: &[String], az_gt: &dataset::Points, cache: &Path, fp: &str)
    -> anyhow::Result<(f32, Vec<FilmBoxes>, Vec<(Regions, Vec<(String, f64, f64)>)>)> {
    let spacing = dataset::load_spacing(&aariz.join("spacing.csv"))?;
    let header = scale::load_header_resolution(aariz)?;
    let hold_mm: HashMap<String, f64> = scale::plan(hold_ids, &spacing, &header, az_gt)?.films.into_iter().collect();
    let found = sc1_boxes::boxes_for(engine, aariz, "train", hold_ids, cache, false)?;
    ft_common::counted("hold-out films with boxes", found.len(), hold_ids.len())?;
    let best: Vec<[f32; 5]> = hold_ids.iter().map(|id| best_scores(&found[id])).collect::<anyhow::Result<_>>()?;
    let line = score_line(&best);
    ensure!(best.iter().flatten().all(|s| *s >= line), "a hold-out film's best box is below the score line {line}: the rule is broken");
    let hold: Vec<(String, Option<f64>)> = hold_ids.iter().map(|id| (id.clone(), hold_mm.get(id).copied())).collect();
    let (films, tau_in) = film_boxes(engine, aariz, "train", &hold, az_gt, cache, line, fp)?;
    Ok((line, films, tau_in))
}

/// The run on given folders, split and git state: prints the summary, writes `<out>/box-gate.json` on a pass or a stop and
/// the calibration file on a pass only. Exit 0 pass, 4 stop, 1 broken (nothing written).
pub fn run_with(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git) -> anyhow::Result<i32> {
    let rep = match gate_run(aariz, ceph400, models, out, split, git) {
        Ok(r) => r,
        Err(e) => { eprintln!("box-quality gate broken (nothing written): {e:#}"); return Ok(1); }
    };
    for l in rep.summary() { println!("{l}"); }
    if rep.verdict != PASS && rep.verdict != STOP { eprintln!("box-quality gate broken (nothing written): C9 did not trip"); return Ok(1); }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let sha = ft_common::sha256_hex(text.as_bytes());
    let calibration = if rep.verdict == PASS {
        match calibration_text(&rep.detector_fingerprint, rep.score_line, rep.tau, &sha, None) {
            Ok(t) => Some(t),
            Err(e) => { eprintln!("box-quality gate broken (nothing written): {e:#}"); return Ok(1); }
        }
    } else { None };
    std::fs::create_dir_all(out)?;
    let path = out.join("box-gate.json");
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {sha})", path.display());
    if let Some(t) = calibration {
        let p = calibration_path(models);
        std::fs::write(&p, t)?;
        println!("calibration written to {}", p.display());
    } else {
        println!("no calibration written (the gate stopped)");
    }
    Ok(rep.exit_code())
}

/// The calibration file's text (`region-calibration/1`; `rule` None for /1, which writes no rule field), read back with
/// the app's parser before anything is written: an error if it would not load.
pub(crate) fn calibration_text(fp: &str, line: f32, tau: [f64; 5], report_sha: &str, rule: Option<&str>) -> anyhow::Result<String> {
    let c = RegionCalibration { version: CALIBRATION_VERSION.into(), detector_fingerprint: fp.into(), score_line: line, tau: RegionTau(tau),
        gate_report_sha256: report_sha.into(), rule: rule.map(String::from) };
    let t = calibration_json(&c)?;
    parse_calibration(t.as_bytes()).context("the calibration would not load")?;
    Ok(t)
}

fn git(args: &[&str]) -> anyhow::Result<String> {
    let o = std::process::Command::new("git").args(args).output().context("running git")?;
    ensure!(o.status.success(), "git {} failed", args.join(" "));
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// The git state a pre-registration at `rel` is judged by: its bytes at HEAD, whether tracked files are changed, the HEAD sha.
pub(crate) fn git_state(rel: &str) -> anyhow::Result<Git> {
    Ok(Git { prereg_at_head: ft_common::at_head(rel), dirty: !git(&["status", "--porcelain", "--untracked-files=no"])?.is_empty(), sha: git(&["rev-parse", "HEAD"])? })
}

/// `--sc1-box-gate`: the pinned split (`reference/sc1-aariz-split.json`, its SHA-256 checked), the git state, then
/// `run_with`. Held-back sets are refused first (before the split file, and again inside).
pub fn run_cli(aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Split, Git)> {
        refuse_reads(&[(aariz, "train"), (aariz, "valid"), (ceph400, "test1")])?;
        let p = sc1_data::split_path()?;
        let text = std::fs::read_to_string(&p).with_context(|| p.display().to_string())?;
        ensure!(ft_common::sha256_hex(text.as_bytes()) == sc1_data::PINNED_SPLIT_SHA256, "{} is not the pinned split (SHA-256 differs)", p.display());
        let split = sc1_data::load_split(&text)?;
        Ok((split, git_state(PREREG_PATH)?))
    };
    match pre() {
        Ok((split, git)) => run_with(aariz, ceph400, models, out, &split, &git),
        Err(e) => { eprintln!("box-quality gate broken (nothing written): {e:#}"); Ok(1) }
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::ft_common::sha256_hex;
    use crate::sc1_boxes::{Faithfulness, FAITHFULNESS_SCHEMA, APP_RUNTIME, PYTORCH_RUNTIME};
    use crate::sc1_data::split;
    use ceph_infer::regions::{regions_manifest_path, RegionClass, RegionEngine, RegionInput, RegionOutputs, RegionSpec};
    use ceph_model::wholefilm::{calibration_path, parse_calibration, teaching_boxes, Region, BOX_GATE_MIN_MEDIAN_IOU, REGIONS, REGION_OF};
    use std::path::PathBuf;

    /// The pre-registration's SHA-256, pinned when it was committed (8174e60, before any run).
    const PINNED_SHA256: &str = "efda327bca9d9e9de72c52207cd4c71e79d0e79fcc9902cd2eb70956f202fdbe";
    const FP: &str = "17171e68f9f7072062e2a3a2cbd4851618056f5136bed998f1782c49d4897b80";

    /// Fails if the file changes by one byte, if its version or gate value is not the program's, or if it names the old
    /// faithfulness path (ruling: the record is at reports/sc1/faithfulness/faithfulness.json).
    #[test] fn the_preregistration_is_pinned() {
        assert_eq!(sha256_hex(PREREG.as_bytes()), PINNED_SHA256, "reference/sc1-box-gate.json changed: the owner's OK, then a new version");
        let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
        assert_eq!(v["version"], VERSION);
        assert_eq!(v["gate"]["minMedianIoU"].as_f64().unwrap(), BOX_GATE_MIN_MEDIAN_IOU);
        assert!(v["detector"].as_str().unwrap().contains("reports/sc1/faithfulness/faithfulness.json"));
    }

    /// Fails if either rounds the wrong way, or on a value already a whole hundredth (0.07 * 100 = 7.000000000000001).
    #[test] fn hundredths_round_the_right_way() {
        assert_eq!(floor_hundredth(0.37), 0.37);
        assert_eq!(floor_hundredth(0.379), 0.37);
        assert_eq!(ceil_hundredth(0.0701), 0.08);
        assert_eq!(ceil_hundredth(0.07), 0.07);
        assert_eq!(ceil_hundredth(0.123), 0.13);
        assert_eq!(ceil_hundredth(0.0), 0.0);
    }

    /// Fails if the line is not the lowest best score over every film and region, floored to 0.01, at most 0.50 and at least 0.01.
    #[test] fn the_score_line_is_the_lowest_best_score_floored_and_clamped() {
        assert_eq!(score_line(&[[0.9, 0.8, 0.373, 0.95, 0.6]]), 0.37);
        assert_eq!(score_line(&[[0.9; 5]]), 0.50);
        assert_eq!(score_line(&[[0.004, 0.9, 0.9, 0.9, 0.9]]), 0.01);
        assert_eq!(score_line(&[[0.9; 5], [0.9, 0.9, 0.9, 0.9, 0.2851]]), 0.28, "the lowest over every film");
        let best = [[0.8, 0.7, 0.4499, 0.9, 0.6f32]];
        let l = score_line(&best);
        assert!(best.iter().flatten().all(|s| *s >= l), "every best box is at or above the line: {l}");
    }

    /// A SYNTHETIC 19-point tracing on a 2000 x 1600 film, moved by `k` px.
    fn tracing(k: f64) -> Vec<(String, f64, f64)> {
        [("S", 600.0, 500.0), ("N", 1300.0, 450.0), ("Po", 400.0, 650.0), ("Ar", 500.0, 800.0), ("Or", 1150.0, 600.0),
         ("A", 1350.0, 900.0), ("ANS", 1380.0, 820.0), ("PNS", 900.0, 850.0),
         ("Go", 650.0, 1150.0), ("Me", 1200.0, 1350.0), ("Pog", 1300.0, 1250.0), ("B", 1290.0, 1150.0), ("Gn", 1260.0, 1320.0),
         ("U1T", 1380.0, 1040.0), ("L1T", 1360.0, 1080.0),
         ("Sn", 1450.0, 850.0), ("UL", 1480.0, 960.0), ("LL", 1470.0, 1100.0), ("PogS", 1400.0, 1300.0)]
            .iter().map(|(n, x, y)| (n.to_string(), x + k, y + k)).collect()
    }
    fn regions(boxes: &[RegionBox]) -> Regions { Regions::from_scored(boxes, 0.01, FP).unwrap() }
    fn film(k: f64, detect: impl Fn(&RegionBox) -> RegionBox) -> FilmBoxes {
        let expert = teaching_boxes(&tracing(k), 2000, 1600);
        assert_eq!(expert.len(), 5);
        FilmBoxes { detected: regions(&expert.iter().map(|b| RegionBox { score: 0.9, ..detect(b) }).collect::<Vec<_>>()), expert, mm_per_px: Some(0.1) }
    }
    fn films(n: usize, detect: impl Fn(&RegionBox) -> RegionBox + Copy) -> Vec<FilmBoxes> { (0..n).map(|i| film(i as f64 * 7.0, detect)).collect() }
    fn medians(q: &[BoxQuality]) -> Vec<f64> { q.iter().map(|x| x.iou_median).collect() }

    /// Fails if τ uses the extra teaching points or another region's points, is not rounded up, has no 0.01 floor, or if
    /// tau_films does not count the films that found the region.
    #[test] fn tau_is_the_worst_traced_point_rounded_up() {
        let mk = |k: f64, out: f64, drop_mandible: bool| {
            let pts = tracing(k);
            let det: Vec<RegionBox> = teaching_boxes(&pts, 2000, 1600).into_iter().filter(|b| !(drop_mandible && b.region == Region::Mandible)).collect();
            let r = regions(&det);
            let mut p = pts.clone();
            if let Some(m) = det.iter().find(|b| b.region == Region::Mandible) {
                let me = p.iter_mut().find(|x| x.0 == "Me").unwrap();
                me.1 = m.x1 + out * m.longer_side();
                me.2 = (m.y0 + m.y1) / 2.0;
                p.push(("L6".into(), m.x1 + 5.0 * m.longer_side(), m.y0));     // an extra teaching point: never checked
            }
            (r, p)
        };
        let (t, n) = tau(&[mk(0.0, 0.123, false), mk(9.0, 0.05, false)]);
        eprintln!("tau {t:?}, films {n:?}");
        assert_eq!(t, [0.01, 0.01, 0.13, 0.01, 0.01]);
        assert_eq!(n, [2; 5]);
        let (t, n) = tau(&[mk(0.0, 0.123, false), mk(9.0, 0.3, true)]);
        eprintln!("mandible not found on film 2: tau {t:?}, films {n:?}");
        assert_eq!((t[2], n), (0.13, [2, 2, 1, 2, 2]));
    }

    /// The gate: boxes equal to the expert's pass (exit 0); boxes shrunk to a third about their centres (IoU 1/9 = 0.11)
    /// stop it on every region (exit 4). Fails if the gate is skipped or reads another number than the median IoU.
    #[test] fn the_gate_passes_on_expert_boxes_and_stops_on_boxes_a_third_the_size() {
        let inflate = |b: &RegionBox| b.inflated(2.0);
        let j = judge(&films(5, |b| *b), 5, &inflate).unwrap();
        eprintln!("expert boxes: IoU medians {:?}; C9 {:?}; verdict {}", medians(&j.quality), medians(&j.control_c9), j.verdict);
        assert_eq!((j.verdict, exit_code(j.verdict)), ("pass", 0));
        assert!(medians(&j.quality).iter().all(|m| (m - 1.0).abs() < 1e-9));
        let j = judge(&films(5, |b| b.inflated(1.0 / 3.0)), 5, &inflate).unwrap();
        eprintln!("boxes a third the size: IoU medians {:?}; verdict {}", medians(&j.quality), j.verdict);
        assert_eq!((j.verdict, exit_code(j.verdict)), ("stop", 4));
        assert!(medians(&j.quality).iter().all(|m| (m - 1.0 / 9.0).abs() < 1e-6), "{:?}", medians(&j.quality));
    }

    /// C9 positive control: the inflated boxes trip the gate on every region (IoU 0.25); an "inflate" that does nothing
    /// passes them, and that is broken (exit 1), never a pass.
    #[test] fn c9_trips_on_good_boxes_and_a_broken_inflate_is_broken() {
        let j = judge(&films(5, |b| *b), 5, &|b: &RegionBox| b.inflated(2.0)).unwrap();
        eprintln!("C9 x2: medians {:?}, tripped {}", medians(&j.control_c9), j.control_tripped);
        assert!(j.control_tripped);
        assert!(medians(&j.control_c9).iter().all(|m| (m - 0.25).abs() < 1e-9));
        let j = judge(&films(5, |b| *b), 5, &|b: &RegionBox| *b).unwrap();
        eprintln!("C9 with an inflate that does nothing: medians {:?}, tripped {}, verdict {} exit {}", medians(&j.control_c9), j.control_tripped, j.verdict, exit_code(j.verdict));
        assert_eq!((j.control_tripped, j.verdict, exit_code(j.verdict)), (false, "broken", 1));
    }

    /// Edge cases: a region not found on a film counts IoU 0 (and in not_found); a region found on NO film has a centre
    /// error that is not a number (JSON null), the gate stops on it and nothing crashes. Fails if a not-found region is
    /// dropped from the IoU, or if a NaN median passes.
    #[test] fn a_region_not_found_counts_iou_0_and_a_region_never_found_stops_the_gate() {
        let inflate = |b: &RegionBox| b.inflated(2.0);
        let mut fs = films(3, |b| *b);
        fs[0].detected.boxes.retain(|b| b.region != Region::Mandible);
        let j = judge(&fs, 3, &inflate).unwrap();
        let m = j.quality[Region::Mandible.index()];
        eprintln!("mandible not found on 1 of 3: not found {}, IoU median {}, p90 {}", m.not_found, m.iou_median, m.iou_p90);
        assert_eq!((m.films, m.not_found, m.iou_median), (3, 1, 1.0));
        for f in fs.iter_mut() { f.detected.boxes.retain(|b| b.region != Region::Incisors); }
        let j = judge(&fs, 3, &inflate).unwrap();
        let q = j.quality[Region::Incisors.index()];
        let text = serde_json::to_string(&q).unwrap();
        eprintln!("incisors found on no film: {text}; verdict {}", j.verdict);
        assert!(q.centre_err_median.is_nan() && text.contains("\"centreErrMedian\":null"), "{text}");
        assert_eq!((q.not_found, q.iou_median, j.verdict), (3, 0.0, "stop"));
    }

    /// C7: a hold-out count other than the split's, or a region whose film count is not the hold-out's, is broken.
    #[test] fn c7_a_count_other_than_its_total_is_broken() {
        let inflate = |b: &RegionBox| b.inflated(2.0);
        let e = judge(&films(4, |b| *b), 5, &inflate).err().expect("4 films for a hold-out of 5 is refused").to_string();
        eprintln!("4 films, hold-out 5: {e}");
        assert!(e.contains("compared 4, expected 5"), "{e}");
        let mut fs = films(5, |b| *b);
        fs[2].expert.retain(|b| b.region != Region::SoftTissue);
        let e = judge(&fs, 5, &inflate).err().expect("a region measured on 4 of 5 films is refused").to_string();
        eprintln!("soft tissue measured on 4 of 5: {e}");
        assert!(e.contains("soft-tissue profile") && e.contains("compared 4, expected 5"), "{e}");
    }

    #[test] fn each_verdict_has_its_exit_code() {
        assert_eq!([exit_code("pass"), exit_code("stop"), exit_code("broken"), exit_code("anything else")], [0, 4, 1, 1]);
    }

    /// C5 at the source: the gate refuses Ceph-400 test2 and Aariz test before any file is read; the sets it does read pass.
    #[test] fn the_reads_refuse_held_back_splits() {
        let d = tempfile::tempdir().unwrap();
        let (az, c4) = (d.path().join("aariz"), d.path().join("ceph400"));
        for p in [&az, &c4] { std::fs::create_dir_all(p).unwrap(); }
        assert!(refuse_reads(&[(&az, "train"), (&az, "valid"), (&c4, "test1")]).is_ok());
        for (p, s) in [(&c4, "test2"), (&az, "test"), (&az, "all")] {
            let e = refuse_reads(&[(&az, "train"), (p, s)]).unwrap_err().to_string();
            eprintln!("{s}: {e}");
            assert!(e.contains("held back"), "{e}");
        }
    }

    // ---- run_with on SYNTHETIC folders (80 x 80 grey ramps; the tiny region model; never data/ or models/) ----

    const W: u32 = 80;
    fn tiny_onnx() -> Vec<u8> {
        std::fs::read(Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("ceph-infer").join("tests").join("fixtures").join("tiny-regions.onnx")).unwrap()
    }
    pub(crate) fn write_models(root: &Path) -> PathBuf {
        let m = root.join("models");
        let p = regions_manifest_path(&m);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let onnx = tiny_onnx();
        std::fs::write(p.parent().unwrap().join("tiny-regions.onnx"), &onnx).unwrap();
        let keys = ceph_infer::regions::REGION_KEYS;
        let s = RegionSpec { manifest_version: 2, kind: "regions".into(), id: "tiny-regions".into(), version: "synthetic-1".into(),
            title: "SYNTHETIC".into(), file: "tiny-regions.onnx".into(), sha256: sha256_hex(&onnx),
            input: RegionInput { name: "input".into(), width: 8, height: 8, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
            outputs: RegionOutputs { boxes: "dets".into(), logits: "labels".into(), box_format: "cxcywh-normalised".into(), score: "sigmoid".into() },
            classes: keys.iter().enumerate().map(|(i, k)| RegionClass { region: k.to_string(), logit_index: i + 1 }).collect(),
            runtime: ceph_infer::spec::Runtime::Cpu, training_note: "SYNTHETIC".into() };
        std::fs::write(&p, serde_json::to_vec_pretty(&s).unwrap()).unwrap();
        m
    }
    pub(crate) fn ramp(p: &Path, k: u32) {
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        image::GrayImage::from_fn(W, W, |x, y| image::Luma([((x * 3 + y + k * 7) % 256) as u8])).save(p).unwrap();
    }
    /// Points whose teaching box is `t` exactly (margin L/12 inside, so the box round them plus 0.10 of its longer side is t).
    fn points_for(t: &RegionBox) -> Vec<(f64, f64)> {
        let m = t.longer_side() / 12.0;
        let (a0, b0, a1, b1) = (t.x0 + m, t.y0 + m, t.x1 - m, t.y1 - m);
        vec![(a0, b0), (a1, b1), ((a0 + a1) / 2.0, (b0 + b1) / 2.0)]
    }
    /// A full 19-point tracing whose expert boxes are the tiny model's boxes scaled by `k` about their centres (k = 1: equal).
    pub(crate) fn tracing_for(found: &[RegionBox], k: f64) -> Vec<(String, f64, f64)> {
        REGION_OF.iter().map(|(name, r)| {
            let t = found.iter().find(|b| b.region == *r).unwrap().inflated(k);
            let pts = points_for(&t);
            let i = REGION_OF.iter().filter(|(_, q)| q == r).position(|(n, _)| n == name).unwrap();
            let p = pts[i.min(2)];
            (name.to_string(), p.0, p.1)
        }).collect()
    }
    pub(crate) struct Rx { pub(crate) _d: tempfile::TempDir, pub(crate) aariz: PathBuf, pub(crate) ceph400: PathBuf, pub(crate) models: PathBuf, pub(crate) out: PathBuf, pub(crate) split: Split, pub(crate) fp: String, pub(crate) git: Git }
    impl Rx {
        pub(crate) fn run(&self) -> i32 { run_with(&self.aariz, &self.ceph400, &self.models, &self.out, &self.split, &self.git).unwrap() }
        fn report(&self) -> PathBuf { self.out.join("box-gate.json") }
        fn faith(&self) -> PathBuf { self.out.join("faithfulness").join("faithfulness.json") }
        pub(crate) fn calibration(&self) -> PathBuf { calibration_path(&self.models) }
        fn write_faith(&self, edit: impl Fn(&mut Faithfulness)) {
            let n = self.split.holdout.len();
            let mut f = Faithfulness { schema: FAITHFULNESS_SCHEMA.into(), fingerprint: self.fp.clone(), runtime: APP_RUNTIME.into(),
                reference_runtime: PYTORCH_RUNTIME.into(), max_px: 0.5, expected: n, compared: n, box_pairs: 5 * n, max_corner_px: 0.0,
                label_agreement: n, max_score_diff: 0.0, films: vec![], verdict: "pass".into() };
            edit(&mut f);
            std::fs::create_dir_all(self.faith().parent().unwrap()).unwrap();
            std::fs::write(self.faith(), serde_json::to_string_pretty(&f).unwrap()).unwrap();
        }
        /// Rewrites `<folder>/gt.csv` without the rows `drop` names (film id, point).
        fn drop_points(&self, folder: &Path, drop: impl Fn(&str, &str) -> bool) {
            let p = folder.join("gt.csv");
            let t = std::fs::read_to_string(&p).unwrap();
            let kept: Vec<&str> = t.lines().enumerate().filter(|(i, l)| { let f: Vec<&str> = l.split(',').collect(); *i == 0 || !drop(f[0], f[1]) }).map(|(_, l)| l).collect();
            std::fs::write(&p, kept.join("\n") + "\n").unwrap();
        }
    }
    /// SYNTHETIC Aariz (20 train films, 3 valid; `no_scale` ids on Smart3D, every other film ART Plus at 0.1 mm/px) and
    /// Ceph-400 (test1 151-153; test2 301 listed, never given an image), the tiny model, a passed faithfulness record.
    /// Expert boxes are the model's own boxes scaled by `k` (1: equal, so the gate passes).
    pub(crate) fn rx(k: f64, no_scale: &[&str]) -> Rx {
        let d = tempfile::tempdir().unwrap();
        let (aariz, ceph400) = (d.path().join("aariz"), d.path().join("ceph400"));
        let train: Vec<String> = (1..=20).map(|i| format!("tr-{i:04}")).collect();
        let valid: Vec<String> = (1..=3).map(|i| format!("va-{i:04}")).collect();
        let c4: Vec<String> = (151..=153).map(|i| i.to_string()).collect();
        for (i, id) in train.iter().chain(&valid).enumerate() { ramp(&aariz.join("images").join(format!("{id}.png")), i as u32); }
        for (i, id) in c4.iter().enumerate() { ramp(&ceph400.join("images").join(format!("{id}.png")), 40 + i as u32); }
        let models = write_models(d.path());
        let engine = RegionEngine::load(&regions_manifest_path(&models)).unwrap();
        let found = crate::sc1_boxes::region_boxes(&engine.find(&crate::sc1_boxes::film(&aariz, &train[0], false).unwrap()).unwrap());
        let tr = tracing_for(&found, k);
        let gt = |ids: &[String]| { let mut s = String::from("image_id,landmark,x,y\n"); for id in ids { for (n, x, y) in &tr { s += &format!("{id},{n},{x},{y}\n"); } } s };
        std::fs::write(aariz.join("gt.csv"), gt(&[train.clone(), valid.clone()].concat())).unwrap();
        std::fs::write(ceph400.join("gt.csv"), gt(&c4)).unwrap();
        std::fs::write(aariz.join("splits.json"), serde_json::json!({"train": train, "valid": valid, "test": ["te-0001"]}).to_string()).unwrap();
        std::fs::write(ceph400.join("splits.json"), serde_json::json!({"train": [], "test1": c4, "test2": ["301"]}).to_string()).unwrap();
        let all: Vec<&String> = train.iter().chain(&valid).collect();
        std::fs::write(aariz.join("spacing.csv"), std::iter::once("image_id,mm_per_px".to_string()).chain(all.iter().map(|id| format!("{id},0.1"))).collect::<Vec<_>>().join("\n") + "\n").unwrap();
        std::fs::write(aariz.join(crate::scale::HEADER_FILE), std::iter::once("image_id,machine,format,raw_x,raw_y,units,mm_per_px,reason".to_string())
            .chain(all.iter().map(|id| format!("{id},{},png,,,,,no resolution in header", if no_scale.contains(&id.as_str()) { "Smart3D" } else { "ART Plus" })))
            .collect::<Vec<_>>().join("\n") + "\n").unwrap();
        let split = split(&train).unwrap();
        let out = d.path().join("reports").join("sc1");
        let r = Rx { fp: engine.spec().fingerprint(), git: Git { prereg_at_head: Some(PREREG.as_bytes().to_vec()), dirty: false, sha: "SYNTHETIC".into() },
            aariz, ceph400, models, out, split, _d: d };
        r.write_faith(|_| {});
        r
    }

    /// The pass path end to end: exit 0; the report and the calibration file are written; the calibration carries the
    /// report's SHA-256, the detector's fingerprint, the score line and τ, and the app's parser reads it. The information
    /// table names both sets with their film counts (Aariz valid: only the films aariz-scale/1 gives a true scale).
    #[test] fn run_with_passes_and_writes_the_report_and_the_calibration() {
        let r = rx(1.0, &["va-0002"]);
        let code = r.run();
        let text = std::fs::read_to_string(r.report()).unwrap();
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        eprintln!("expert boxes = the model's: exit {code}; verdict {}; score line {}; tau {}; information {}", v["verdict"], v["scoreLine"], v["tau"], v["information"].as_array().unwrap().iter().map(|x| x[0].to_string()).collect::<Vec<_>>().join(" / "));
        assert_eq!((code, v["verdict"].as_str().unwrap()), (0, "pass"));
        assert_eq!(v["holdoutFilms"], r.split.holdout.len());
        assert_eq!(v["detectorFingerprint"], r.fp.as_str());
        assert_eq!(v["preregSha256"], PINNED_SHA256);
        assert_eq!(v["controlTripped"], true);
        for q in v["quality"].as_array().unwrap() { assert_eq!(q["inMm"], true, "every hold-out film has a scale: mm"); }
        let info = v["information"].as_array().unwrap();
        assert_eq!(info.len(), 2);
        assert!(info[0][0].as_str().unwrap().contains("Ceph-400 test1") && info[0][0].as_str().unwrap().contains("3 films"), "{}", info[0][0]);
        assert!(info[1][0].as_str().unwrap().contains("Aariz valid") && info[1][0].as_str().unwrap().contains("2 of 3"), "{}", info[1][0]);
        for q in info[0][1].as_array().unwrap() { assert_eq!((q["films"].as_u64(), q["inMm"].as_bool()), (Some(3), Some(true))); }
        let c = parse_calibration(&std::fs::read(r.calibration()).unwrap()).unwrap();
        eprintln!("calibration: {c:?}");
        assert_eq!(c.gate_report_sha256, sha256_hex(text.as_bytes()));
        assert_eq!(c.detector_fingerprint, r.fp);
        assert_eq!(c.score_line, v["scoreLine"].as_f64().unwrap() as f32);
        for (i, reg) in REGIONS.iter().enumerate() { assert_eq!(c.tau.0[i], v["tau"][serde_json::to_value(reg).unwrap().as_str().unwrap()].as_f64().unwrap()); }
    }

    /// The stop path: expert boxes a third the size of the model's (IoU 0.11): exit 4, the report says stop, NO
    /// calibration. One hold-out film has no true scale, so the centre error is a fraction of the expert box for all.
    #[test] fn run_with_stops_with_exit_4_and_writes_no_calibration() {
        let r0 = rx(1.0, &[]);
        let hold = r0.split.holdout[0].clone();
        drop(r0);
        let r = rx(1.0 / 3.0, &[hold.as_str()]);
        let code = r.run();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(r.report()).unwrap()).unwrap();
        eprintln!("expert boxes a third the size: exit {code}; verdict {}; IoU medians {:?}; C9 tripped {}", v["verdict"],
            v["quality"].as_array().unwrap().iter().map(|q| q["iouMedian"].as_f64().unwrap()).collect::<Vec<_>>(), v["controlTripped"]);
        assert_eq!((code, v["verdict"].as_str().unwrap()), (4, "stop"));
        assert!(!r.calibration().exists(), "no calibration on a stop");
        for q in v["quality"].as_array().unwrap() { assert_eq!(q["inMm"], false, "a hold-out film without a scale: fractions for all"); }
    }

    /// C5 through the run: a Ceph-400 test1 list that names a Test2 film (301), or folders given the wrong way round, are
    /// refused before any film is read: exit 1, no box cache, no report.
    #[test] fn run_with_refuses_test2_films_and_wrong_folders_before_any_film_is_read() {
        let r = rx(1.0, &[]);
        std::fs::write(r.ceph400.join("splits.json"), serde_json::json!({"train": [], "test1": ["151", "152", "301"]}).to_string()).unwrap();
        // 301 is given an expert tracing (no image), so only the film-number check can stop it before the hold-out runs.
        let gt = std::fs::read_to_string(r.ceph400.join("gt.csv")).unwrap();
        let extra: String = gt.lines().filter(|l| l.starts_with("151,")).map(|l| l.replacen("151,", "301,", 1) + "\n").collect();
        std::fs::write(r.ceph400.join("gt.csv"), gt + &extra).unwrap();
        let code = r.run();
        eprintln!("test1 listing film 301: exit {code}; box cache made: {}", r.out.join("boxes").exists());
        assert_eq!(code, 1);
        assert!(!r.out.join("boxes").exists() && !r.report().exists());
        let r = rx(1.0, &[]);
        let code = run_with(&r.ceph400, &r.aariz, &r.models, &r.out, &r.split, &r.git).unwrap();
        eprintln!("folders swapped: exit {code}");
        assert_eq!(code, 1);
        assert!(!r.out.join("boxes").exists() && !r.report().exists());
    }

    /// The detector line: without a passed faithfulness record for this fingerprint over the whole hold-out, broken.
    #[test] fn run_with_needs_a_passed_faithfulness_record_for_this_model() {
        let r = rx(1.0, &[]);
        type Edit = fn(&mut Faithfulness);
        let cases: [(&str, Edit); 3] = [("verdict fail", |f| f.verdict = "fail".into()), ("another model", |f| f.fingerprint = "0".repeat(64)),
            ("one film fewer compared", |f| f.compared -= 1)];
        for (what, edit) in cases {
            r.write_faith(edit);
            let code = r.run();
            eprintln!("faithfulness {what}: exit {code}");
            assert_eq!(code, 1, "{what}");
            assert!(!r.report().exists());
        }
        std::fs::remove_file(r.faith()).unwrap();
        let code = r.run();
        eprintln!("no faithfulness file: exit {code}");
        assert_eq!(code, 1);
        r.write_faith(|_| {});
        assert_eq!(r.run(), 0, "control: the passed record runs");
    }

    /// The pre-registration must be committed as built, from a clean tree.
    #[test] fn run_with_refuses_an_uncommitted_or_changed_preregistration() {
        let mut r = rx(1.0, &[]);
        let mut changed = PREREG.as_bytes().to_vec();
        changed[10] ^= 1;
        for (what, head, dirty) in [("not committed", None, false), ("changed at HEAD", Some(changed), false), ("dirty tree", Some(PREREG.as_bytes().to_vec()), true)] {
            r.git = Git { prereg_at_head: head, dirty, sha: "SYNTHETIC".into() };
            let code = r.run();
            eprintln!("pre-registration {what}: exit {code}");
            assert_eq!(code, 1, "{what}");
            assert!(!r.report().exists());
        }
    }

    /// /1 is superseded for τ by sc1-box-gate/2 (owner, 5 Nov 2026): a /1 run never overwrites a calibration whose rule
    /// is /2 (broken, nothing written, the file untouched). A /1 calibration in place does not stop it (Task 10's re-run).
    /// Fails if the /1 run writes over the /2 file.
    #[test] fn run_with_never_overwrites_a_calibration_set_by_gate_2() {
        let r = rx(1.0, &[]);
        let two = calibration_text(&r.fp, 0.5, [0.09, 0.02, 0.02, 0.01, 0.10], &"a".repeat(64), Some("sc1-box-gate/2")).unwrap();
        std::fs::write(r.calibration(), &two).unwrap();
        let code = r.run();
        eprintln!("/1 run with a /2 calibration in place: exit {code}; report written {}", r.report().exists());
        assert_eq!(code, 1);
        assert_eq!(std::fs::read_to_string(r.calibration()).unwrap(), two, "the /2 calibration untouched");
        assert!(!r.report().exists());
        std::fs::write(r.calibration(), calibration_text(&r.fp, 0.5, [0.09, 0.01, 0.01, 0.01, 0.01], &"a".repeat(64), None).unwrap()).unwrap();
        assert_eq!(r.run(), 0, "control: over a /1 calibration the /1 run goes ahead");
    }

    /// Edge case: an expert tracing missing S (or any of the 19) is refused, never boxed from what is left.
    #[test] fn run_with_refuses_an_incomplete_expert_tracing() {
        let r = rx(1.0, &[]);
        let hold = r.split.holdout[1].clone();
        r.drop_points(&r.aariz, |id, p| id == hold && p == "S");
        let code = r.run();
        eprintln!("a hold-out film without S: exit {code}");
        assert_eq!(code, 1);
        assert!(!r.report().exists());
        let r = rx(1.0, &[]);
        r.drop_points(&r.ceph400, |id, p| id == "152" && p == "N");
        let code = r.run();
        eprintln!("a Ceph-400 information film without N: exit {code}");
        assert_eq!(code, 1);
    }
}
