//! SC-1 Part 1b Task C: the size look's calibration, rule `sc1-size/1` (spec §17.3, owner rulings R1b-3 and R1b-5),
//! pre-registered in `reference/sc1-size.json` (committed alone before any run, SHA-256 pinned in a test).
//!
//! **The picture.** On each calibration film the region finder has drawn its five boxes. Stick a pin in the middle of
//! each box, and a pin in the middle of each region's traced expert points. The size score q is the log of how far the
//! tracing pins spread against how far the box pins spread (`ceph_model::wholefilm::size_score`). On correct tracings q
//! sits near a usual value (the centre); the line is how far from it the worst correct tracing lies, rounded up. A
//! tracing at half size sits ln 2 = 0.69 below its own value; at double size 0.69 above.
//!
//! **Compared with what.** Each tracing against the boxes the finder drew on the same film; nothing in millimetres.
//!
//! **The films (520):** the Aariz-train hold-out (70), Ceph-400 Train 001-150 (150), and the development films Ceph-400
//! Test1 151-300 and Aariz valid (150 each): SC1-1a's spent films, tuned on by the owner's ruling R1b-5, and said so in
//! the report. Never: the 560 teaching films, the 70 tuning-slice films, PKU, Ceph-400 Test2, Aariz test. The boxes come
//! from the box cache of the pinned finder at score line 0.50; no shape is scored here (so no film is judged against its
//! own tracing in the shape reference: there is no shape look in this run).
//!
//! **Writes.** `<out>/size-calibration.json` (pass or stop); on a pass only `<models>/regions/size-calibration.json`,
//! read back by `parse_size_calibration` before it is written. Prints aggregates only, never a film id.
use crate::sc1_calib::{c7_by_set, control_holds, line_rounded_up, median_nearest_rank, CAL_SETS};
use crate::sc1_data::{self, Split};
use crate::sc1_gate::{self, Git};
use crate::sc1_gate2::{self, GATE3};
use crate::{dataset, ft_common, sc1_boxes, sc1_probe};
use anyhow::{ensure, Context};
use ceph_infer::regions::{regions_manifest_path, RegionEngine};
use ceph_model::pointcheck::ORDER;
use ceph_model::shape::Pt;
use ceph_model::wholefilm::{calibration_path, parse_calibration, parse_size_calibration, size_calibration_path, size_score, size_verdict, Region, RegionCalibration,
    Regions, SizeCalibration, SizeRef, REGIONS, SIZE_CALIBRATION_VERSION, SIZE_LINE_FLOOR, SIZE_LINE_STOP, SIZE_RULE};
use serde::Serialize;
use std::collections::BTreeSet;
use std::path::Path;

pub const PREREG: &str = include_str!("../../../reference/sc1-size.json");
pub const PREREG_PATH: &str = "reference/sc1-size.json";
pub const VERSION: &str = "sc1-size/1";
pub const PASS: &str = "pass";
pub const STOP: &str = "stop";
pub const BROKEN: &str = "broken";
/// The score line the boxes are read at (pre-registered).
pub const SCORE_LINE: f32 = 0.50;
/// Said in every report that uses the development films (R1b-5).
pub const DISCLOSURE: &str = "development films, tuned on (R1b-5)";
/// The pre-registration's SHA-256, pinned when it was committed.
pub const PINNED_SHA256: &str = "71dea580e32eeecd9eafe750b12d384ab025b78fcbadc888aa8eb696b197f4cd";

/// One calibration film: its set (a `CAL_SETS` name), its expert tracing (19 points in ORDER, the film as stored), the
/// regions the finder found on it at the score line, and its scale when one is recorded (Ceph-400 0.1 mm/px; Aariz under
/// `aariz-scale/1`). The size look never reads the scale; the cranial-base centre's control uses it to plant a move in mm.
#[derive(Clone, Debug)]
pub struct CalFilm { pub set: &'static str, pub pts: Vec<Option<Pt>>, pub regs: Regions, pub mm_per_px: Option<f64> }

/// What the calibration found: both region choices' refs and full-set lines, the choice, the controls, C7, per-set
/// medians (information), and the verdict.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeOutcome {
    pub refs_five: Vec<SetRow>, pub refs_four: Vec<SetRow>, pub line_five: f64, pub line_four: f64,
    pub uses: Vec<Region>, pub refs: Vec<SizeRef>,
    pub normal_flagged: usize, pub half: (usize, usize), pub double: (usize, usize), pub c7: String,
    pub per_set: Vec<PerSet>, pub verdict: String, pub exit: i32,
}
impl SizeOutcome {
    /// The chosen full-set line.
    pub fn line_chosen(&self) -> f64 { if self.uses.len() == 5 { self.line_five } else { self.line_four } }
}
/// One region set's row: films that found all of it, its centre and line (`SizeRef` plus the count and the worst).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetRow { pub regions: Vec<Region>, pub films: usize, pub centre: f64, pub worst: f64, pub line: f64 }
/// Information: each calibration set's median q on the chosen full set.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PerSet { pub set: String, pub films: usize, pub median: Option<f64> }

/// The region sets of 3 or more drawn from `uses` (REGIONS order inside each; by size, largest last).
fn subsets(uses: &[Region]) -> Vec<Vec<Region>> {
    let n = uses.len();
    let mut v: Vec<Vec<Region>> = (0u32..1 << n).filter(|m| m.count_ones() as usize >= 3).map(|m| (0..n).filter(|i| m & (1 << i) != 0).map(|i| uses[i]).collect()).collect();
    v.sort_by_key(|s| s.len());
    v
}
/// The rule for one choice of regions: per set of 3 or more, the films that found all of it (q on exactly that set), the
/// nearest-rank median as centre, the worst |q − centre| rounded up to the next 0.01 (floor 0.05) as line.
fn rows(films: &[CalFilm], uses: &[Region]) -> anyhow::Result<Vec<SetRow>> {
    let mut out = Vec::new();
    for s in subsets(uses) {
        let q: Vec<f64> = films.iter().filter_map(|f| size_score(&f.pts, &f.regs, &s)).filter(|(u, _)| *u == s).map(|(_, q)| q).collect();
        if q.is_empty() { continue }
        let centre = median_nearest_rank(&q)?;
        let worst = q.iter().map(|x| (x - centre).abs()).fold(0.0, f64::max);
        out.push(SetRow { regions: s, films: q.len(), centre, worst, line: line_rounded_up(worst, SIZE_LINE_FLOOR)? });
    }
    Ok(out)
}
/// The pre-registered choice: the smaller full-set line wins; a tie keeps all five.
pub fn choose_five(line_five: f64, line_four: f64) -> bool { line_four >= line_five }
/// The verdict from the chosen line and the two controls (flagged, films): stop (exit 4) when the line is above 0.35 or
/// either control is under 95%; otherwise pass (exit 0).
pub fn verdict_with(line: f64, half: (usize, usize), double: (usize, usize)) -> (&'static str, i32) {
    let ok = |c: (usize, usize)| control_holds(c.0, c.1).unwrap_or(false);
    verdict(line, ok(half), ok(double))
}
pub fn verdict(line: f64, half_ok: bool, double_ok: bool) -> (&'static str, i32) {
    if line > SIZE_LINE_STOP || !half_ok || !double_ok { (STOP, 4) } else { (PASS, 0) }
}
/// Every point × k about the centroid of the present points (sc1_1a::scaled on a complete tracing).
fn scaled(pts: &[Option<Pt>], k: f64) -> Vec<Option<Pt>> {
    let v: Vec<Pt> = pts.iter().flatten().copied().collect();
    let n = v.len() as f64;
    let c = (v.iter().map(|p| p.0).sum::<f64>() / n, v.iter().map(|p| p.1).sum::<f64>() / n);
    pts.iter().map(|p| p.map(|p| (c.0 + k * (p.0 - c.0), c.1 + k * (p.1 - c.1)))).collect()
}
/// How many films flag size under `cal` with their tracings × k (k = 1: the films as they are).
fn flagged(films: &[CalFilm], cal: &SizeCalibration, k: f64) -> usize {
    films.iter().filter(|f| size_score(&scaled(&f.pts, k), &f.regs, &cal.uses).and_then(|(u, q)| size_verdict(cal, &u, q)).is_some_and(|v| v.flagged)).count()
}

/// The calibration on these films (no file read, nothing written): C7 by set, both region choices, the choice, the
/// stop, the controls. An error is broken (a count off, a choice with no full-set film).
pub fn calibrate(films: &[CalFilm]) -> anyhow::Result<SizeOutcome> {
    let got: Vec<(&str, usize)> = {
        let mut names: Vec<&str> = films.iter().map(|f| f.set).collect();
        names.sort(); names.dedup();
        names.iter().map(|n| (*n, films.iter().filter(|f| f.set == *n).count())).collect()
    };
    let c7 = c7_by_set(&got, &CAL_SETS)?;
    let five: Vec<Region> = REGIONS.to_vec();
    let four: Vec<Region> = REGIONS.into_iter().filter(|r| *r != Region::SoftTissue).collect();
    let (refs_five, refs_four) = (rows(films, &five)?, rows(films, &four)?);
    let full = |rows: &[SetRow], u: &[Region]| rows.iter().find(|r| r.regions == u).map(|r| r.line)
        .ok_or_else(|| anyhow::anyhow!("no calibration film found all of {u:?}: no full-set line"));
    let (line_five, line_four) = (full(&refs_five, &five)?, full(&refs_four, &four)?);
    let (uses, chosen) = if choose_five(line_five, line_four) { (five, &refs_five) } else { (four, &refs_four) };
    let refs: Vec<SizeRef> = chosen.iter().map(|r| SizeRef { regions: r.regions.clone(), centre: r.centre, line: r.line }).collect();
    let cal = SizeCalibration { version: SIZE_CALIBRATION_VERSION.into(), rule: SIZE_RULE.into(), detector_fingerprint: "0".repeat(64), uses: uses.clone(), refs: refs.clone(), report_sha256: "0".repeat(64) };
    let n = films.len();
    let normal_flagged = flagged(films, &cal, 1.0);
    ensure!(normal_flagged == 0, "{normal_flagged} calibration film(s) flag size on the lines they set: the rule is broken");
    let (half, double) = ((flagged(films, &cal, 0.5), n), (flagged(films, &cal, 2.0), n));
    let line = if uses.len() == 5 { line_five } else { line_four };
    let (verdict, exit) = verdict_with(line, half, double);
    let per_set = CAL_SETS.iter().map(|(s, _)| {
        let q: Vec<f64> = films.iter().filter(|f| f.set == *s).filter_map(|f| size_score(&f.pts, &f.regs, &uses)).filter(|(u, _)| *u == uses).map(|(_, q)| q).collect();
        Ok(PerSet { set: s.to_string(), films: q.len(), median: if q.is_empty() { None } else { Some(median_nearest_rank(&q)?) } })
    }).collect::<anyhow::Result<Vec<_>>>()?;
    Ok(SizeOutcome { refs_five, refs_four, line_five, line_four, uses, refs, normal_flagged, half, double, c7, per_set, verdict: verdict.into(), exit })
}

/// The 64-hex word after `after` in a pre-registration line ("" when none).
pub fn hex64_after(text: &str, after: &str) -> String {
    text.split_once(after).map(|(_, t)| t).unwrap_or("").split(|c: char| !c.is_ascii_hexdigit()).find(|w| w.len() == 64).unwrap_or_default().to_string()
}
/// The reads this run makes, before any file is read: Aariz train (the hold-out only) and valid, Ceph-400 train and
/// test1; Test2, Aariz test, PKU (sealed) and "all" are refused by gate /3's own refusals.
pub fn refuse_reads(aariz: &Path, ceph400: &Path) -> anyhow::Result<()> {
    sc1_gate2::refuse_reads_for(&GATE3, &[(aariz, "train"), (aariz, "valid"), (ceph400, "train"), (ceph400, "test1")])
}
/// The Aariz train films this run may read are the hold-out's: a teaching film, a tuning-slice film, or any film not in
/// the hold-out is refused before any film is read.
pub fn refuse_films(split: &Split, ids: &[String]) -> anyhow::Result<()> {
    let hold: BTreeSet<&String> = split.holdout.iter().collect();
    let teach = ids.iter().filter(|id| split.teach.contains(id)).count();
    let tuning = ids.iter().filter(|id| split.tuning.contains(id)).count();
    let other = ids.iter().filter(|id| !hold.contains(id)).count();
    ensure!(teach == 0 && tuning == 0 && other == 0, "{teach} teaching, {tuning} tuning-slice and {other} other non-hold-out Aariz train film(s) asked for: refused (only the 70 hold-out films calibrate)");
    Ok(())
}
/// The τ calibration in force must be gate /3's: rule sc1-box-gate/3, for this detector, naming the pinned gate report
/// (`gate_report` hashes to `pinned_sha`, verdict pass), its τ the report's and its score line 0.50.
pub fn check_tau(cal: &[u8], gate_report: &[u8], engine_fp: &str, pinned_sha: &str) -> anyhow::Result<RegionCalibration> {
    let c = parse_calibration(cal)?;
    ensure!(c.gate_rule() == GATE3.version, "the region calibration in force was set by {}, not {}: run --sc1-box-gate-3 first", c.gate_rule(), GATE3.version);
    let v: serde_json::Value = serde_json::from_slice(gate_report).context("the gate /3 report is not JSON")?;
    let mut tau = [f64::NAN; 5];
    for r in REGIONS { tau[r.index()] = v["tau"][serde_json::to_value(r)?.as_str().unwrap_or_default()].as_f64().unwrap_or(f64::NAN); }
    let pins = sc1_probe::Pins { fingerprint: engine_fp.into(), gate_report_sha256: pinned_sha.into(), score_line: SCORE_LINE, tau };
    sc1_probe::check_calibration(&c, engine_fp, gate_report, &pins)?;
    Ok(c)
}

/// `size-calibration.json` (the report).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeReport {
    pub version: String, pub prereg_sha256: String, pub git_sha: String, pub detector_fingerprint: String, pub score_line: f32,
    pub tau_rule: String, pub gate_report_sha256: String, pub disclosure: String, pub films: usize, #[serde(flatten)] pub outcome: SizeOutcome,
}
impl SizeReport {
    pub fn summary(&self) -> Vec<String> {
        let o = &self.outcome;
        let mut v = vec![format!("size calibration {} ({PREREG_PATH} sha256 {}); git HEAD {}; detector {}; score line {:.2}", self.version, self.prereg_sha256, self.git_sha, self.detector_fingerprint, self.score_line),
            format!("tau in force: {} (gate report sha256 {})", self.tau_rule, self.gate_report_sha256),
            format!("{}: Ceph-400 test1 151-300 and Aariz valid", self.disclosure),
            format!("C7 {}", o.c7)];
        let show = |name: &str, rows: &[SetRow], v: &mut Vec<String>| {
            v.push(format!("{name}: region set, films, centre, worst |q - centre|, line"));
            for r in rows { v.push(format!("  {:<60} {:>4}  {:+.4}  {:.4}  {:.2}", r.regions.iter().map(|g| g.words()).collect::<Vec<_>>().join(", "), r.films, r.centre, r.worst, r.line)); }
        };
        show("all five regions", &o.refs_five, &mut v);
        show("without the soft-tissue profile", &o.refs_four, &mut v);
        v.push(format!("full-set lines: five {:.2}, four {:.2}; chosen: {} (smaller line wins, a tie keeps five)", o.line_five, o.line_four, if o.uses.len() == 5 { "all five" } else { "four, without the soft-tissue profile" }));
        v.push(format!("controls: untouched films flagged {} of {}; x0.5 flagged {} of {} ({:.1}%); x2 flagged {} of {} ({:.1}%); each must be at least 95%",
            o.normal_flagged, self.films, o.half.0, o.half.1, 100.0 * o.half.0 as f64 / o.half.1 as f64, o.double.0, o.double.1, 100.0 * o.double.0 as f64 / o.double.1 as f64));
        for p in &o.per_set { v.push(format!("  information: {} median q on the chosen full set {} over {} films", p.set, p.median.map(|m| format!("{m:+.4}")).unwrap_or("none".into()), p.films)); }
        v.push(format!("verdict {} (exit {}: 0 pass, 4 stop, 1 broken)", o.verdict, o.exit));
        v
    }
}

/// The run on given folders, split, git state and pins: prints the summary; writes the report on a pass or a stop and,
/// on a pass only, the size calibration (read back first). Exit 0 pass, 4 stop, 1 broken (nothing written).
pub fn run_with(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git) -> anyhow::Result<i32> {
    let broken = |e: anyhow::Error| { eprintln!("size calibration {VERSION} broken (nothing written): {e:#}"); Ok(1) };
    let rep = match size_run(aariz, ceph400, models, out, split, git) { Ok(r) => r, Err(e) => return broken(e) };
    for l in rep.summary() { println!("{l}"); }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let sha = ft_common::sha256_hex(text.as_bytes());
    let cal = if rep.outcome.exit == 0 {
        let c = SizeCalibration { version: SIZE_CALIBRATION_VERSION.into(), rule: SIZE_RULE.into(), detector_fingerprint: rep.detector_fingerprint.clone(),
            uses: rep.outcome.uses.clone(), refs: rep.outcome.refs.clone(), report_sha256: sha.clone() };
        let t = serde_json::to_string_pretty(&c)? + "\n";
        match parse_size_calibration(t.as_bytes()) { Ok(back) if back == c => Some(t), Ok(_) => return broken(anyhow::anyhow!("the size calibration does not read back as written")), Err(e) => return broken(e) }
    } else { None };
    std::fs::create_dir_all(out)?;
    let path = out.join("size-calibration.json");
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {sha})", path.display());
    match cal {
        Some(t) => { std::fs::write(size_calibration_path(models), t)?; println!("size calibration (rule {SIZE_RULE}) written to {}", size_calibration_path(models).display()); }
        None => println!("no size calibration written (the run stopped: to the owner)"),
    }
    Ok(rep.outcome.exit)
}

/// The expert tracing of `id` as 19 points in ORDER (complete, checked first by `sc1_gate::complete`).
fn pts_of(gt: &dataset::Points, id: &str) -> anyhow::Result<Vec<Option<Pt>>> {
    let rows = gt.get(id).context("a calibration film has no expert tracing")?;
    ORDER.iter().map(|n| rows.iter().find(|(p, _, _)| p == n).map(|(_, x, y)| Some((*x, *y))).context("an expert tracing lacks a point")).collect()
}

/// A calibration run's pre-registration: its path, its text as built, and the version this program knows.
#[derive(Clone, Copy, Debug)]
pub struct Prereg<'a> { pub path: &'a str, pub text: &'a str, pub version: &'a str, pub what: &'a str }
/// The size look's own.
pub const SIZE_PREREG: Prereg<'static> = Prereg { path: PREREG_PATH, text: PREREG, version: VERSION, what: "the size calibration" };
/// The 520 calibration films as loaded, with the detector and the τ calibration in force (gate /3, pinned report).
pub struct Loaded { pub films: Vec<CalFilm>, pub fp: String, pub tau_rule: String, pub gate_sha256: String }

fn size_run(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git) -> anyhow::Result<SizeReport> {
    let l = load_cal_films(aariz, ceph400, models, out, split, git, &SIZE_PREREG)?;
    let outcome = calibrate(&l.films)?;
    Ok(SizeReport { version: VERSION.into(), prereg_sha256: ft_common::sha256_hex(PREREG.as_bytes()), git_sha: git.sha.clone(), detector_fingerprint: l.fp,
        score_line: SCORE_LINE, tau_rule: l.tau_rule, gate_report_sha256: l.gate_sha256, disclosure: DISCLOSURE.into(), films: l.films.len(), outcome })
}

/// The shared loading of the 520 calibration films (Task C's, used by the size look and the cranial-base centre, M27):
/// the refusals, the pre-registration committed as built from a clean tree and its pins, the detector and gate /3's τ,
/// the lists, the complete expert tracings, the scales (Ceph-400 0.1 mm/px; the hold-out and Aariz valid under
/// `aariz-scale/1`), and the boxes from the cache. No film id is printed.
pub fn load_cal_films(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git, pre: &Prereg) -> anyhow::Result<Loaded> {
    let what = pre.what;
    refuse_reads(aariz, ceph400)?;
    ensure!(crate::scale::is_aariz(aariz), "{}: {what} reads Aariz, and this folder is not Aariz", aariz.display());
    ensure!(sc1_gate::is_ceph400(ceph400), "{}: {what} reads Ceph-400, and this folder is not Ceph-400", ceph400.display());
    refuse_films(split, &split.holdout)?;
    // The pre-registration: committed as built, from a clean tree; its pins.
    ensure!(!git.dirty, "commit first: {what} is pre-registered ({}) and runs only from a clean tree", pre.path);
    ft_common::committed_as_built(pre.path, pre.text, git.prereg_at_head.clone())?;
    let v: serde_json::Value = serde_json::from_str(pre.text)?;
    ensure!(v["version"] == pre.version, "this program knows {}, not {}", pre.version, v["version"]);
    let pinned_fp = hex64_after(v["boxes"].as_str().unwrap_or_default(), "region finder");
    let pinned_gate = hex64_after(v["tau"].as_str().unwrap_or_default(), "SHA-256");
    ensure!(pinned_fp.len() == 64 && pinned_gate.len() == 64, "{} pins no detector or no gate report", pre.path);
    sc1_data::ensure_outside_or_ignored(out)?;
    sc1_data::ensure_outside_or_ignored(models)?;
    // The detector and the τ calibration in force (gate /3, pinned report).
    let engine = RegionEngine::load(&regions_manifest_path(models))?;
    let fp = engine.spec().fingerprint();
    ensure!(fp == pinned_fp, "the installed region finder is {fp}; {VERSION} is pinned to {pinned_fp}");
    let gp = out.join(GATE3.report);
    let gate = std::fs::read(&gp).with_context(|| format!("{}: {what} needs the gate /3 report", gp.display()))?;
    let cp = calibration_path(models);
    let tau = check_tau(&std::fs::read(&cp).with_context(|| cp.display().to_string())?, &gate, &fp, &pinned_gate)?;
    ensure!(tau.score_line == SCORE_LINE, "the score line in force is {}, the pre-registered one {SCORE_LINE}", tau.score_line);
    // The lists.
    let splits = dataset::load_splits(&ceph400.join("splits.json"))?;
    let c4_train = dataset::select(&splits, "train")?;
    sc1_probe::refuse_outside_train(&c4_train)?;
    let c4_test1 = dataset::select(&splits, "test1")?;
    sc1_gate::refuse_outside_test1(&c4_test1)?;
    let (train, valid) = sc1_gate::aariz_train_valid(aariz)?;
    let train: BTreeSet<String> = train.into_iter().collect();
    ensure!(split.holdout.iter().all(|id| train.contains(id)), "a hold-out film of the split file is not in Aariz train: refused");
    ensure!(valid.iter().all(|id| !train.contains(id)), "Aariz valid shares films with train: refused");
    // The expert tracings, complete.
    let az_gt = dataset::load_points(&aariz.join("gt.csv"))?;
    let c4_gt = dataset::load_points(&ceph400.join("gt.csv"))?;
    for (gt, ids, what) in [(&az_gt, &split.holdout, "hold-out"), (&c4_gt, &c4_train, "Ceph-400 train"), (&c4_gt, &c4_test1, "Ceph-400 test1"), (&az_gt, &valid, "Aariz valid")] {
        sc1_gate::complete(gt, ids, what)?;
    }
    // The scales: Ceph-400 at 0.1 mm/px; Aariz under aariz-scale/1 (a film it gives no true scale has none).
    let spacing = dataset::load_spacing(&aariz.join("spacing.csv"))?;
    let header = crate::scale::load_header_resolution(aariz)?;
    let mut az_mm: std::collections::HashMap<String, f64> = crate::scale::plan(&split.holdout, &spacing, &header, &az_gt)?.films.into_iter().collect();
    az_mm.extend(crate::scale::plan(&valid, &spacing, &header, &az_gt)?.films);
    // The boxes (the cache of the pinned finder; one call per set, each set's own split) and the films.
    let cache = out.join("boxes");
    let mut films = Vec::new();
    for (set, data, split_name, ids, gt, c4) in [(CAL_SETS[0].0, aariz, "train", &split.holdout, &az_gt, false), (CAL_SETS[1].0, ceph400, "train", &c4_train, &c4_gt, true),
                                               (CAL_SETS[2].0, ceph400, "test1", &c4_test1, &c4_gt, true), (CAL_SETS[3].0, aariz, "valid", &valid, &az_gt, false)] {
        let found = sc1_boxes::boxes_for(&engine, data, split_name, ids, &cache, false)?;
        ft_common::counted(&format!("{set} films with boxes"), found.len(), ids.len())?;
        for id in ids {
            let f = found.get(id).context("a calibration film has no boxes")?;
            sc1_gate::best_scores(f)?;
            ensure!(f.fingerprint == fp, "a film's boxes are from detector {}, not {fp}", f.fingerprint);
            let mm_per_px = if c4 { Some(sc1_gate::CEPH400_MM_PER_PX) } else { az_mm.get(id).copied() };
            films.push(CalFilm { set, pts: pts_of(gt, id)?, regs: Regions::from_scored(&sc1_boxes::region_boxes(f), SCORE_LINE, &fp)?, mm_per_px });
        }
    }
    Ok(Loaded { films, fp, tau_rule: tau.gate_rule().into(), gate_sha256: ft_common::sha256_hex(&gate) })
}

/// `--sc1-size-calibrate`: the refusals, the pinned split, the git state, then `run_with`. Exit 0 pass, 4 stop, 1 broken.
pub fn run_cli(aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Split, Git)> {
        refuse_reads(aariz, ceph400)?;
        let p = sc1_data::split_path()?;
        let text = std::fs::read_to_string(&p).with_context(|| p.display().to_string())?;
        ensure!(ft_common::sha256_hex(text.as_bytes()) == sc1_data::PINNED_SPLIT_SHA256, "{} is not the pinned split (SHA-256 differs)", p.display());
        Ok((sc1_data::load_split(&text)?, sc1_gate::git_state(PREREG_PATH)?))
    };
    match pre() {
        Ok((split, git)) => run_with(aariz, ceph400, models, out, &split, &git),
        Err(e) => { eprintln!("size calibration {VERSION} broken (nothing written): {e:#}"); Ok(1) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ft_common::{case_rng, normal, sha256_hex};
    use crate::sc1_calib::CAL_SETS;
    use ceph_model::pointcheck::ORDER;
    use ceph_model::wholefilm::{teaching_boxes, Region, RegionBox, Regions, REGIONS, SIZE_LINE_FLOOR, SIZE_LINE_STOP};

    const FP: &str = "17171e68f9f7072062e2a3a2cbd4851618056f5136bed998f1782c49d4897b80";

    /// A SYNTHETIC 520-film stand-in (70 + 150 + 150 + 150, the four calibration sets): faces from the shared generator,
    /// boxes drawn round each face by the teaching rule, each box's centre moved by `jitter` (soft tissue: `soft`) times
    /// its longer side, a normal draw per axis (seeded).
    fn stand_in(jitter: f64, soft: f64, seed: u64) -> Vec<CalFilm> {
        let faces = ceph_model::shape::synthetic_faces(520, seed);
        let mut k = 0usize;
        let mut out = Vec::new();
        for (set, n) in CAL_SETS {
            for _ in 0..n {
                let f = &faces[k];
                let named: Vec<(String, f64, f64)> = ORDER.iter().zip(f).map(|(id, p)| (id.to_string(), p.0, p.1)).collect();
                let mut r = case_rng(seed, &[k as u64]);
                let boxes: Vec<RegionBox> = teaching_boxes(&named, 2400, 2400).into_iter().map(|b| {
                    let j = if b.region == Region::SoftTissue { soft } else { jitter } * b.longer_side();
                    let (dx, dy) = (normal(&mut r) * j, normal(&mut r) * j);
                    RegionBox { x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy, score: 0.9, ..b }
                }).collect();
                out.push(CalFilm { set, pts: f.iter().map(|p| Some(*p)).collect(), regs: Regions::from_scored(&boxes, 0.5, FP).unwrap(), mm_per_px: None });
                k += 1;
            }
        }
        out
    }
    fn five() -> Vec<Region> { REGIONS.to_vec() }
    fn four() -> Vec<Region> { REGIONS.into_iter().filter(|r| *r != Region::SoftTissue).collect() }

    /// The rule, recomputed here independently: for the full five-region set, the centre is the ⌈n/2⌉-th smallest q and
    /// the line the largest |q − centre| rounded up to the next 0.01 (never below 0.05). Every film flags at ×0.5 and ×2.
    /// Fails if: the centre is a mean, the line is not rounded up, or the floor is dropped.
    #[test] fn the_centre_is_the_nearest_rank_median_and_the_line_the_worst_rounded_up() {
        let films = stand_in(0.02, 0.02, 11);
        let o = calibrate(&films).unwrap();
        let mut q: Vec<f64> = films.iter().filter_map(|f| size_score(&f.pts, &f.regs, &five()).filter(|(u, _)| *u == five()).map(|(_, q)| q)).collect();
        q.sort_by(f64::total_cmp);
        let c = q[(q.len() + 1) / 2 - 1];
        let worst = q.iter().map(|x| (x - c).abs()).fold(0.0, f64::max);
        let l = crate::sc1_gate::ceil_hundredth(worst).max(SIZE_LINE_FLOOR);
        let r = o.refs_five.iter().find(|r| r.regions == five()).unwrap();
        eprintln!("five: {} films, centre {c:.4}, worst {worst:.4}, line {l}; outcome {:?} line5 {} line4 {} half {:?} double {:?}", q.len(), r.centre, o.line_five, o.line_four, o.half, o.double);
        assert_eq!((r.centre, r.line), (c, l));
        assert_eq!(o.line_five, l);
        assert_eq!((o.half, o.double), ((520, 520), (520, 520)));
        assert_eq!(o.normal_flagged, 0, "by construction no calibration film flags");
        assert_eq!(o.exit, 0);
        // Every set of 3, 4 or 5 regions found by some film has its line; the four-region choice has its own 5 sets.
        assert_eq!(o.refs_five.len(), 16);
        assert_eq!(o.refs_four.len(), 5);
        assert!(o.refs_five.iter().all(|r| r.line >= SIZE_LINE_FLOOR && r.regions.len() >= 3));
    }

    /// The one choice: soft-tissue boxes that drift (as on Ceph-400) give a larger five-region line, so four regions are
    /// used; equal lines keep five. Fails if: the larger line wins, or a tie goes to four.
    #[test] fn the_soft_tissue_choice_takes_the_smaller_full_line_and_a_tie_keeps_five() {
        assert_eq!(choose_five(0.20, 0.20), true, "a tie keeps five");
        assert_eq!(choose_five(0.20, 0.19), false);
        assert_eq!(choose_five(0.19, 0.20), true);
        let o = calibrate(&stand_in(0.01, 0.15, 12)).unwrap();
        eprintln!("soft drift: line five {}, line four {}, uses {:?}", o.line_five, o.line_four, o.uses);
        assert!(o.line_four < o.line_five);
        assert_eq!(o.uses, four());
        assert!(o.refs.iter().all(|r| !r.regions.contains(&Region::SoftTissue)), "the chosen refs are the four-region ones");
        let o = calibrate(&stand_in(0.01, 0.01, 12)).unwrap();
        eprintln!("no drift: line five {}, line four {}, uses {:?}", o.line_five, o.line_four, o.uses);
        assert_eq!(o.uses, if o.line_four < o.line_five { four() } else { five() });
    }

    /// The stop above 0.35: 0.36 stops (exit 4); 0.35 itself passes. Fails if: `>=` is used, or the stop is dropped.
    #[test] fn a_line_above_0_35_stops_with_exit_4() {
        assert_eq!(SIZE_LINE_STOP, 0.35);
        assert_eq!(verdict(0.36, true, true), (STOP, 4));
        assert_eq!(verdict(0.35, true, true), (PASS, 0));
        // Through calibrate: boxes thrown about widely give a line above 0.35: exit 4.
        let o = calibrate(&stand_in(0.4, 0.4, 13)).unwrap();
        eprintln!("wide boxes: chosen line {}, exit {}", o.line_chosen(), o.exit);
        assert!(o.line_chosen() > SIZE_LINE_STOP && o.exit == 4);
    }

    /// The positive controls: a calibration whose ×0.5 catch is 94% is a stop (exit 4), as the pre-registration says;
    /// at 95% it passes. Fails if: the controls are skipped, or read as a rate in floating point.
    #[test] fn the_half_and_double_controls_must_reach_95_percent() {
        assert_eq!(verdict_with(0.2, (94, 100), (100, 100)), (STOP, 4));
        assert_eq!(verdict_with(0.2, (100, 100), (94, 100)), (STOP, 4));
        assert_eq!(verdict_with(0.2, (95, 100), (95, 100)), (PASS, 0));
        // Through calibrate, the control alone: 520 copies of one film (one q), 30 of them traced e^0.346 too large. The
        // worst is 0.346, so the line is 0.35: not above the stop. At x0.5 those 30 sit |0.346 - ln 2| = 0.347 from the
        // centre, inside the line: 490 of 520 = 94.2% caught, under 95%: stop, exit 4, by the control and not the line.
        let base = stand_in(0.0, 0.0, 14).remove(0);
        let films: Vec<CalFilm> = CAL_SETS.iter().flat_map(|(set, n)| std::iter::repeat_n(CalFilm { set, ..base.clone() }, *n)).enumerate()
            .map(|(i, f)| if i % 17 == 0 && i / 17 < 30 { CalFilm { pts: scaled(&f.pts, 0.346f64.exp()), ..f } } else { f }).collect();
        let o = calibrate(&films).unwrap();
        eprintln!("edge: line {} : half {:?}, double {:?}, exit {}", o.line_chosen(), o.half, o.double, o.exit);
        assert_eq!((o.line_chosen(), o.half, o.double, o.exit), (0.35, (490, 520), (520, 520), 4));
    }

    /// C7: 70 + 150 + 150 + 150 = 520 films, each set's count; a set short is broken, naming it.
    #[test] fn c7_counts_520_films_by_set() {
        let films = stand_in(0.02, 0.02, 15);
        let o = calibrate(&films).unwrap();
        assert!(o.c7.ends_with("calibration films in all: compared 520 (expected 520)"), "{}", o.c7);
        let short: Vec<CalFilm> = films.iter().enumerate().filter(|(i, _)| *i != 100).map(|(_, f)| f.clone()).collect();
        let e = calibrate(&short).unwrap_err().to_string();
        eprintln!("519 films: {e}");
        assert!(e.contains("ceph400Train"), "{e}");
    }

    /// The refusals before any read: Ceph-400 Test2, Aariz test, PKU (sealed) and "all"; and on the Aariz train side only
    /// the hold-out: a teaching film or a tuning-slice film is refused. Fails if: a teaching film is let in.
    #[test] fn refuses_teaching_tuning_test2_aariz_test_and_pku() {
        let d = tempfile::tempdir().unwrap();
        let (az, c4, pku) = (d.path().join("aariz"), d.path().join("ceph400"), d.path().join("pku"));
        for p in [&az, &c4, &pku] { std::fs::create_dir_all(p).unwrap(); }
        assert!(refuse_reads(&az, &c4).is_ok());
        for (p, s) in [(&c4, "test2"), (&az, "test"), (&pku, "test"), (&az, "all")] {
            let e = crate::sc1_gate2::refuse_reads_for(&crate::sc1_gate2::GATE3, &[(p.as_path(), s)]).unwrap_err().to_string();
            eprintln!("{} {s}: {e}", p.file_name().unwrap().to_string_lossy());
        }
        let ids: Vec<String> = (0..100).map(|i| format!("tr-{i:04}")).collect();
        let split = crate::sc1_data::split(&ids).unwrap();
        assert!(refuse_films(&split, &split.holdout).is_ok());
        for (what, id) in [("teaching", split.teach[3].clone()), ("tuning", split.tuning[0].clone()), ("unknown", "zz".to_string())] {
            let mut v = split.holdout.clone();
            v.push(id);
            let e = refuse_films(&split, &v).unwrap_err().to_string();
            eprintln!("a {what} film: {e}");
            assert!(e.contains("refused"), "{e}");
        }
    }

    /// The τ in force must be gate /3's: a /2 calibration (or one naming another gate report) is refused. Fails if: the
    /// rule is not checked.
    #[test] fn refuses_a_tau_calibration_that_is_not_gate_3() {
        let report = br#"{"version": "sc1-box-gate/3", "verdict": "pass", "tau": {"cranialBase": 0.09, "maxilla": 0.02, "mandible": 0.03, "incisors": 0.02, "softTissue": 0.12}}"#;
        let sha = sha256_hex(report);
        let cal = |rule: &str| crate::sc1_gate::calibration_text(FP, 0.5, [0.09, 0.02, 0.03, 0.02, 0.12], &sha, Some(rule)).unwrap();
        let c = check_tau(cal("sc1-box-gate/3").as_bytes(), report, FP, &sha).unwrap();
        assert_eq!(c.tau.0, [0.09, 0.02, 0.03, 0.02, 0.12]);
        let e = check_tau(cal("sc1-box-gate/2").as_bytes(), report, FP, &sha).unwrap_err().to_string();
        eprintln!("a /2 calibration: {e}");
        assert!(e.contains("sc1-box-gate/3"), "{e}");
        let e = check_tau(cal("sc1-box-gate/3").as_bytes(), report, FP, &"0".repeat(64)).unwrap_err().to_string();
        eprintln!("another gate report pinned: {e}");
        assert!(check_tau(cal("sc1-box-gate/3").as_bytes(), report, &"e".repeat(64), &sha).is_err(), "another detector");
    }

    /// The homework rule (Task B review): a film whose tracing is in the 1,000-tracing shape reference must be
    /// scored with that tracing left out. This run scores no shape at all (size only, against the film's own boxes), so no
    /// film can be judged against itself here. Fails if: a shape scorer is brought into this module (then it needs
    /// `leave_out_names` by both names and its own test, as `sc1_1a::check_marks` has).
    #[test] fn the_size_calibration_scores_no_shape() {
        let code = include_str!("sc1_size.rs");
        let body = &code[..code.find("#[cfg(test)]").unwrap()];
        for word in [concat!("Whole", "Scorer"), concat!("check", "_film"), concat!("shape", "("), concat!("from", "_reference")] {
            assert!(!body.contains(word), "{word} in sc1_size.rs: a shape look here must leave out the judged film's own tracing");
        }
    }

    /// The pre-registration is the committed one, and its numbers are the program's.
    #[test] fn the_preregistration_is_pinned() {
        assert_eq!(sha256_hex(PREREG.as_bytes()), PINNED_SHA256, "{PREREG_PATH} changed: the owner's OK, then a new version");
        let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
        assert_eq!(v["version"], VERSION);
        assert_eq!(hex64_after(v["boxes"].as_str().unwrap(), "region finder"), FP);
        assert_eq!(hex64_after(v["tau"].as_str().unwrap(), "SHA-256").len(), 64);
        assert!(v["line"].as_str().unwrap().contains("never below 0.05"));
        assert!(v["stop"].as_str().unwrap().contains("above 0.35"));
        assert!(v["controls"]["half"].as_str().unwrap().contains("20 x flagged >= 19 x films"));
        assert!(v["controls"]["counts"].as_str().unwrap().contains("70 + 150 + 150 + 150 = 520"));
        assert!(v["films"]["development"].as_str().unwrap().contains("tuned on"));
    }
}
