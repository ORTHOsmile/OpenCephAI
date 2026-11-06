//! SC-1 Part 1b Task E: the development-film run (spec §17.6, owner ruling R1b-5), pre-registered in
//! `reference/sc1-1b-dev.json` (committed alone before any code or run). **Information, not a test.**
//!
//! **The picture.** Take SC1-1a's exact films, folds, seeds and spoiled tracings (mirrored, another patient's, half and
//! double size, one region moved 10-20 mm) and judge each one twice: once by the check SC1-1a ran (whole-film/1: the
//! 300-tracing shape reference, gate /2's region tolerances), once by the improved check (whole-film/2: the 1,000-tracing
//! reference, gate /3's tolerances, the size look and the cranial-base centre). Print the two side by side.
//!
//! **What it cannot say.** These are development films, tuned on: gate /3, the size line and the centre line were all set
//! with them among the calibration films, so the new looks' false alarms here are zero by construction and their catches
//! are in-sample. Only SC1-1b-PKU (Task F) tests the improved check on unseen films.
//!
//! **The one consequence (pre-registered).** If whole-film/2 misses SC1-1a's marks even here (fewer than 2,603 of 2,740
//! caught, or more than 6 of 300 untouched flagged), exit 3: the work stops and goes to the owner before PKU is
//! pre-registered. Controls fail or a count is off: exit 1. Otherwise exit 0.
//!
//! Ceph-400 Test2, Aariz test and PKU are refused before anything is read. Prints aggregates only, never a film id.
use crate::ft_common::{self, par_map};
use crate::sc1_1a::{self, Case, Counts, Dataset, Film, Finder, Kind, Marks, Plant};
use crate::sc1_gate::Git;
use anyhow::{ensure, Context};
use ceph_model::wholefilm::{CbCalibration, ExtraLook, FilmCal, FilmCheck, FilmResult, Reason, Region, RegionTau, Reference, WholeScorer};
use serde::Serialize;
use std::path::Path;

pub const PREREG: &str = include_str!("../../../reference/sc1-1b-dev.json");
pub const PREREG_PATH: &str = "reference/sc1-1b-dev.json";
pub const VERSION: &str = "sc1-1b-dev/1";
/// The words every record of this run carries (R1b-5).
pub const HEADER: &str = "development films, tuned on (R1b-5); not a test";
pub const REPORT: &str = "sc1-1b-dev.json";
/// whole-film/3's confirmation run (owner ruling, 5 Nov 2026, spec §17.15), pre-registered in `reference/sc1-1b-dev3.json`.
pub const PREREG3: &str = include_str!("../../../reference/sc1-1b-dev3.json");
pub const PREREG3_PATH: &str = "reference/sc1-1b-dev3.json";
pub const VERSION3: &str = "sc1-1b-dev3/1";
pub const REPORT3: &str = "sc1-1b-dev3.json";
/// The centre lines the sensitivity table re-judges at (information; 0.06 is the calibrated line).
pub const CENTRE_LINES: [f64; 3] = [0.06, 0.08, 0.10];

/// What the run requires of its inputs (the pre-registration's `pins`, and SC1-1a's own pins for the /1 column).
#[derive(Clone, Debug, PartialEq)]
pub struct DevPins {
    pub sc1a: sc1_1a::Pins, pub fingerprint: String, pub gate3: String, pub size: String, pub cb: String, pub reference: String, pub prior: String, pub sc1a_report: String,
    /// whole-film/3's confirmation run only (`reference/sc1-1b-dev3.json`): the two ruling records and the decomposition report.
    pub gate4: Option<String>, pub centre: Option<String>, pub decompose: Option<String>,
}
impl DevPins {
    /// The pins of a development-run pre-registration's text (the dev3 run's three extra pins when present).
    pub fn from_text(text: &str) -> anyhow::Result<DevPins> {
        let v: serde_json::Value = serde_json::from_str(text)?;
        let p = &v["pins"];
        let hex = |k: &str| -> anyhow::Result<String> {
            let s = p[k].as_str().unwrap_or_default();
            ensure!(s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()), "{} pins no {k}", v["version"]);
            Ok(s.to_string())
        };
        let opt = |k: &str| -> anyhow::Result<Option<String>> { if p[k].is_null() { Ok(None) } else { hex(k).map(Some) } };
        Ok(DevPins { sc1a: sc1_1a::Pins::from_prereg()?, fingerprint: hex("detectorFingerprint")?, gate3: hex("gate3ReportSha256")?, size: hex("sizeReportSha256")?,
            cb: hex("cbReportSha256")?, reference: hex("referenceSha256")?, prior: hex("priorSha256")?, sc1a_report: hex("sc1aReportSha256")?,
            gate4: opt("gate4RecordSha256")?, centre: opt("centreRulingSha256")?, decompose: opt("decomposeReportSha256")? })
    }
    pub fn from_prereg() -> anyhow::Result<DevPins> { Self::from_text(PREREG) }
}

/// Exit 3 when whole-film/2 misses SC1-1a's marks (caught < needed or false alarms > the maximum), else 0.
pub fn stop_exit(caught: usize, false_alarms: usize, m: &Marks) -> i32 { if caught < m.needed || false_alarms > m.false_max { 3 } else { 0 } }

/// The 1,000-tracing scorer per Test1 fold (its fold's `ceph400:NNN` names left out) and whole (Aariz valid).
pub struct Scorers { pub folds: Vec<WholeScorer>, pub all: WholeScorer }
impl Scorers {
    /// The scorers, each fold's all-19 line fitted cold (in parallel); returns the seconds that took. The whole
    /// reference keeps its stored lines; a fold naming a film the reference does not hold is an error (M17).
    pub fn new(r: &Reference, folds: &[Vec<String>]) -> anyhow::Result<(Scorers, f64)> {
        let all = WholeScorer::from_reference(r)?;
        let folds: Vec<WholeScorer> = folds.iter().map(|f| {
            let names = f.iter().map(|id| ceph_model::wholefilm::reference_name(Dataset::Ceph400.reference_key(), id)).collect::<anyhow::Result<Vec<_>>>()?;
            all.leave_out_names(&names)
        }).collect::<anyhow::Result<_>>()?;
        let t = std::time::Instant::now();
        let all19: Vec<usize> = (0..19).collect();
        for l in par_map(&folds, |s| s.line_for(&all19)) { l?; }
        Ok((Scorers { folds, all }, t.elapsed().as_secs_f64()))
    }
    pub fn of(&self, f: &Film) -> &WholeScorer { match f.fold { Some(k) if k < self.folds.len() => &self.folds[k], _ => &self.all } }
}
/// whole-film/2 on every plant: `sc1_1a::check_with` with the film's scorer and `cal` (no Stage A).
pub fn judge_v2(films: &[Film], plants: &[Plant], s: &Scorers, cal: &FilmCal) -> anyhow::Result<Vec<Case>> {
    par_map(plants, |p| -> anyhow::Result<Case> {
        let f = films.get(p.film).context("a plant names no film")?;
        Ok(Case { kind: p.kind, dataset: f.dataset, result: sc1_1a::check_with(f, &p.pts, s.of(f), cal)?, stage_a: false })
    }).into_iter().collect()
}

/// One printed line: how many cases, how many flagged, which look flagged (a case may have several), how many were
/// flagged only by the new looks, and how many the new looks did not judge.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Looks {
    pub label: String, pub cases: usize, pub flagged: usize, pub mirrored: usize, pub shape: usize, pub region: usize, pub size: usize, pub centre: usize,
    pub facing: usize, pub no_ceph_found: usize, pub only_new: usize, pub size_not_judged: usize, pub centre_not_judged: usize,
}
/// A region reason with a point past its edge: off the film, or its outside-ratio above the region's τ. (A centre flag
/// lists every present cranial-base point, inside ones too, so the centre alone is not an edge.)
fn is_edge(r: &Reason, tau: &RegionTau) -> bool {
    matches!(r, Reason::Region { region, outside, .. } if outside.iter().any(|(_, x)| x.is_none_or(|v| v > tau.get(*region))))
}
fn is_centre(r: &Reason) -> bool { matches!(r, Reason::Region { centre: Some(_), .. }) }
fn reasons(c: &Case) -> &[Reason] { result_reasons(&c.result) }
fn result_reasons(r: &FilmResult) -> &[Reason] { match &r.check { FilmCheck::Flagged { reasons } => reasons, _ => &[] } }
pub fn looks(label: &str, cases: &[&Case], tau: &RegionTau) -> Looks {
    looks_of_results(label, &cases.iter().map(|c| &c.result).collect::<Vec<_>>(), tau)
}
/// `looks` on bare results (SC1-1b-PKU's films are neither Ceph-400 nor Aariz, so its cases are not SC1-1a's `Case`).
pub fn looks_of_results(label: &str, rs: &[&FilmResult], tau: &RegionTau) -> Looks {
    let n = |f: &dyn Fn(&Reason) -> bool| rs.iter().filter(|c| result_reasons(c).iter().any(f)).count();
    let new = |r: &Reason| matches!(r, Reason::Size { .. }) || (is_centre(r) && !is_edge(r, tau));
    Looks { label: label.into(), cases: rs.len(), flagged: rs.iter().filter(|c| !result_reasons(c).is_empty()).count(),
        mirrored: n(&|r| matches!(r, Reason::Mirrored)), shape: n(&|r| matches!(r, Reason::Shape { .. })), region: n(&|r| is_edge(r, tau)),
        size: n(&|r| matches!(r, Reason::Size { .. })), centre: n(&is_centre), facing: n(&|r| matches!(r, Reason::Facing)),
        no_ceph_found: n(&|r| matches!(r, Reason::NoCephFound)), only_new: rs.iter().filter(|c| !result_reasons(c).is_empty() && result_reasons(c).iter().all(new)).count(),
        size_not_judged: rs.iter().filter(|c| c.size_look != ExtraLook::Judged).count(),
        centre_not_judged: rs.iter().filter(|c| c.cb_look != ExtraLook::Judged).count() }
}

/// One column: SC1-1a's counts (C7), the per-kind and per-dataset look lines, the information shifts, and the exact 95%
/// intervals of the pooled catch and the untouched flags.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Column { pub name: String, pub counts: Counts, pub looks: Vec<Looks>, pub normal_looks: Vec<Looks>, pub shifts: Vec<Looks>, pub caught_ci: (f64, f64), pub false_ci: (f64, f64) }
const KINDS: [Kind; 10] = [Kind::P1a, Kind::P1b, Kind::P2, Kind::P3Half, Kind::P3Double, Kind::P4(Region::CranialBase), Kind::P4(Region::Maxilla),
    Kind::P4(Region::Mandible), Kind::P4(Region::Incisors), Kind::P4(Region::SoftTissue)];
fn of(v: &[Case], k: Kind, ds: Option<Dataset>) -> Vec<&Case> { v.iter().filter(|c| c.kind == k && ds.is_none_or(|d| c.dataset == d)).collect() }
fn column(name: &str, cases: &[Case], shifts: &[Case], m: &Marks, tau: &RegionTau) -> anyhow::Result<Column> {
    let counts = sc1_1a::count(cases, m)?;
    let lks = KINDS.iter().map(|k| looks(&k.label(), &of(cases, *k, None), tau)).collect();
    let normal = [Dataset::Ceph400, Dataset::Aariz].iter().map(|d| looks(&format!("N on {}", d.words()), &of(cases, Kind::N, Some(*d)), tau)).collect();
    let sh = sc1_1a::SHIFTS_MM.iter().map(|s| looks(&Kind::Shift(*s).label(), &of(shifts, Kind::Shift(*s), None), tau)).collect();
    Ok(Column { name: name.into(), caught_ci: crate::stats::clopper_pearson(counts.caught, counts.planted)?, false_ci: crate::stats::clopper_pearson(counts.false_alarms, counts.normal)?,
        counts, looks: lks, normal_looks: normal, shifts: sh })
}

/// One row of the centre-line sensitivity (information): the /2 column re-judged at `line`, everything else fixed.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensRow { pub line: f64, pub caught: usize, pub false_alarms: usize, pub p4_cranial_base: usize, pub centre_flags_planted: usize, pub centre_flags_untouched: usize }
/// One set's median centre offset (nearest rank per axis), and where it comes from.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CentreMedian { pub set: String, pub source: String, pub films: Option<usize>, pub median: Option<(f64, f64)> }
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Control { pub name: String, pub what: String, pub got: String, pub holds: bool }
fn control(name: &str, what: &str, got: String, holds: bool) -> Control { Control { name: name.into(), what: what.into(), got, holds } }

/// `sc1-1b-dev.json`.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DevReport {
    pub version: String, pub header: String, pub prereg_sha256: String, pub git_sha: String, pub detector_fingerprint: String, pub disclosure: Vec<String>,
    pub marks: Marks, pub v1: Column, pub v2: Column, pub v2_rule: String, pub centre_line: f64, pub size_line: f64, pub tau3: [f64; 5], pub tau2: [f64; 5],
    pub sensitivity: Vec<SensRow>, pub centre_medians: Vec<CentreMedian>, pub fold_warm_seconds: f64, pub controls: Vec<Control>, pub stop_tripped: bool,
    pub verdict: String, pub exit: i32, pub seconds: f64, pub summary: Vec<String>,
}
fn ci(x: (f64, f64)) -> String { format!("95% CI {:.1}% to {:.1}%", 100.0 * x.0, 100.0 * x.1) }
fn fmt_looks(l: &Looks, new: bool) -> String {
    let mut s = format!("mirrored {}, shape {}, region {}, facing {}, no-ceph-found {}", l.mirrored, l.shape, l.region, l.facing, l.no_ceph_found);
    if new { s += &format!(", size {}, centre {}; only size/centre {}; size not judged {}, centre not judged {}", l.size, l.centre, l.only_new, l.size_not_judged, l.centre_not_judged) }
    s
}
impl DevReport {
    fn lines(&self) -> Vec<String> {
        let (a, b) = (&self.v1, &self.v2);
        let mut v = vec![
            format!("SC1-1b development-film run {} (sha256 {}): {}", self.version, self.prereg_sha256, self.header),
            format!("git HEAD {}; detector {}; Ceph-400 test1 {} and Aariz valid {} ({} with a scale); seeds 20261103 (folds), 20261104 (plants), SC1-1a's plants unchanged (P4 direction random, as SC1-1a)",
                self.git_sha, self.detector_fingerprint, self.marks.test1, self.marks.valid, self.marks.scaled_valid),
            format!("/1 = whole-film/1 (300-tracing reference, tau /2 {:?}, no size, no centre); /2 = {} (1,000-tracing reference, tau {:?}, size line {:.2}, centre line {:.2})",
                self.tau2, self.v2_rule, self.tau3, self.size_line, self.centre_line),
            format!("the fold scorers' all-19 lines fitted cold in {:.1} s", self.fold_warm_seconds),
            "planted faults, /1 -> /2 (information; in-sample for the size and centre looks):".into(),
        ];
        for (x, y) in a.looks.iter().zip(&b.looks) {
            v.push(format!("  {}: {} -> {} of {} ({:+})", x.label, x.flagged, y.flagged, y.cases, y.flagged as i64 - x.flagged as i64));
            v.push(format!("      /1 looks: {}", fmt_looks(x, false)));
            v.push(format!("      /2 looks: {}", fmt_looks(y, true)));
        }
        v.push(format!("POOLED caught: /1 {} of {} ({}); /2 {} of {} ({}); needed {}", a.counts.caught, a.counts.planted, ci(a.caught_ci), b.counts.caught, b.counts.planted, ci(b.caught_ci), self.marks.needed));
        v.push("untouched expert tracings, /1 -> /2:".into());
        for (x, y) in a.normal_looks.iter().zip(&b.normal_looks) {
            v.push(format!("  {}: {} -> {} of {}", x.label, x.flagged, y.flagged, y.cases));
            v.push(format!("      /1 looks: {}", fmt_looks(x, false)));
            v.push(format!("      /2 looks: {}", fmt_looks(y, true)));
        }
        v.push(format!("POOLED untouched flagged: /1 {} of {} ({}); /2 {} of {} ({}); at most {}", a.counts.false_alarms, a.counts.normal, ci(a.false_ci), b.counts.false_alarms, b.counts.normal, ci(b.false_ci), self.marks.false_max));
        v.push("information, the whole tracing moved (films with a scale), /1 -> /2:".into());
        for (x, y) in a.shifts.iter().zip(&b.shifts) { v.push(format!("  {}: {} -> {} of {}", x.label, x.flagged, y.flagged, y.cases)); }
        v.push("information, the centre line (in memory only; no stored calibration changed; everything else fixed):".into());
        for r in &self.sensitivity {
            v.push(format!("  centre line {:.2}: caught {} of {}, untouched flagged {} of {}; P4 cranial base {}; centre flags on planted {}, on untouched {}",
                r.line, r.caught, b.counts.planted, r.false_alarms, b.counts.normal, r.p4_cranial_base, r.centre_flags_planted, r.centre_flags_untouched));
        }
        v.push("information, median centre offset per set (nearest rank per axis; x forward, y down; fraction of the cranial-base box's longer side):".into());
        for c in &self.centre_medians {
            v.push(format!("  {:<16} {} films {}: {}", c.set, c.source, c.films.map(|n| n.to_string()).unwrap_or("-".into()),
                c.median.map(|m| format!("({:+.4}, {:+.4})", m.0, m.1)).unwrap_or("none".into())));
        }
        v.push("controls:".into());
        v.extend(self.controls.iter().map(|x| format!("  {} {}: {} -> {}", x.name, x.what, x.got, if x.holds { "holds" } else { "DOES NOT HOLD" })));
        v.extend(self.disclosure.iter().map(|d| format!("disclosure: {d}")));
        v.push(format!("stop ({} below {} of {} caught, or above {} of {} untouched flagged): {}", self.v2_rule, self.marks.needed, self.marks.planted, self.marks.false_max, self.marks.normal,
            if self.stop_tripped { "TRIPPED: to the owner before PKU is pre-registered" } else { "not tripped" }));
        v.push(format!("verdict {} (exit {}: 0 printed, 3 the stop tripped, 1 broken); {:.0} s", self.verdict, self.exit, self.seconds));
        v
    }
}

fn read(p: &Path, what: &str) -> anyhow::Result<Vec<u8>> { std::fs::read(p).with_context(|| format!("{}: the development run needs {what}", p.display())) }
fn pinned(bytes: &[u8], pin: &str, what: &str) -> anyhow::Result<()> {
    let sha = ft_common::sha256_hex(bytes);
    ensure!(sha == pin, "{what}'s SHA-256 is {sha}, the pre-registered one {pin}");
    Ok(())
}
fn median_of(offsets: &[(f64, f64)]) -> anyhow::Result<Option<(f64, f64)>> {
    if offsets.is_empty() { return Ok(None) }
    let ax = |f: fn(&(f64, f64)) -> f64| { let mut v: Vec<f64> = offsets.iter().map(f).collect(); v.sort_by(f64::total_cmp); crate::sc1_calib::median_nearest_rank(&v) };
    Ok(Some((ax(|o| o.0)?, ax(|o| o.1)?)))
}

/// Everything both runs read, each pinned: the detector, gate /2's and /3's calibrations, the size and centre
/// calibrations, both shape files, SC1-1a's report, the centre calibration report, and SC1-1a's films and plants.
pub(crate) struct Inputs {
    pub(crate) fp: String, pub(crate) pre: serde_json::Value, pub(crate) cal2: ceph_model::wholefilm::RegionCalibration, pub(crate) cal3: ceph_model::wholefilm::RegionCalibration,
    pub(crate) prior: ceph_model::pointcheck::Prior, pub(crate) size: ceph_model::wholefilm::SizeCalibration, pub(crate) cb: CbCalibration, pub(crate) cb_report: Vec<u8>,
    pub(crate) reference: Reference, pub(crate) sc1a: serde_json::Value, pub(crate) j: sc1_1a::Judged, pub(crate) ps: Vec<Plant>, pub(crate) sh: Vec<Plant>,
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn load_inputs(spec: &DevSpec, ceph400: &Path, aariz: &Path, models: &Path, out: &Path, git: &Git, pins: &DevPins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<Inputs> {
    // Reads: Ceph-400 test1 and Aariz valid only (Test2, Aariz test and PKU refused before anything is read).
    crate::sc1_gate2::refuse_reads_for(&crate::sc1_gate2::GATE3, &[(aariz, "valid"), (ceph400, "test1")])?;
    ensure!(crate::sc1_gate::is_ceph400(ceph400), "{}: the development run reads Ceph-400 test1, and this folder is not Ceph-400", ceph400.display());
    ensure!(crate::scale::is_aariz(aariz), "{}: the development run reads Aariz valid, and this folder is not Aariz", aariz.display());
    // The pre-registration: committed as built, from a clean tree.
    ensure!(!git.dirty, "commit first: the development run is pre-registered ({}) and runs only from a clean tree", spec.path);
    ft_common::committed_as_built(spec.path, spec.prereg, git.prereg_at_head.clone())?;
    let pre: serde_json::Value = serde_json::from_str(spec.prereg)?;
    ensure!(pre["version"] == spec.version && pre["header"] == HEADER, "{} is not {}'s", spec.path, spec.version);
    crate::sc1_data::ensure_outside_or_ignored(out)?;
    crate::sc1_data::ensure_outside_or_ignored(models)?;
    let fp = finder.fingerprint();
    ensure!(fp == pins.fingerprint, "the installed region finder is {fp}; the development run is pinned to {}", pins.fingerprint);
    let regions = models.join("regions");
    // The /1 column: SC1-1a's rule exactly (gate /2's report and calibration-2.json, SC1-1a's pins; the 300-tracing file).
    let g2 = read(&out.join(sc1_1a::GATE_REPORT), "the gate /2 report")?;
    ensure!(matches!(sc1_1a::check_gate(&g2, &pins.sc1a)?, sc1_1a::Gate::Pass(_)), "the gate /2 report says stop");
    let cal2 = sc1_1a::check_calibration(&read(&regions.join("calibration-2.json"), "calibration-2.json (gate /2's tau, kept by gate /3)")?, &fp, &pins.sc1a)?;
    let prior_path = ceph_model::pointcheck::prior_path(models);
    let prior_bytes = read(&prior_path, "the 300-tracing shape file (ceph400-v1.shape)")?;
    pinned(&prior_bytes, &pins.prior, "the 300-tracing shape file")?;
    let prior = ceph_model::pointcheck::load_prior(&prior_path)?;
    // The second column's τ and centre. whole-film/2 (the development run): gate /3 and the measured centre; once
    // whole-film/3 is set up these are the files kept beside (calibration-3.json, cb-centre-calibration-1.json).
    // whole-film/3 (the confirmation run): gate /4 and the ruled centre in force, each as its committed record says.
    let kept = |name: &str, fallback: std::path::PathBuf| { let k = regions.join(name); if k.exists() { k } else { fallback } };
    let (cal3, cb) = match spec.kind {
        V2Kind::Gate3 => {
            let g3 = read(&out.join(crate::sc1_gate2::GATE3.report), "the gate /3 report")?;
            let cal3 = crate::sc1_size::check_tau(&read(&kept(crate::sc1_wf3::KEPT_TAU, ceph_model::wholefilm::calibration_path(models)), "gate /3's calibration")?, &g3, &fp, &pins.gate3)?;
            let cb = ceph_model::wholefilm::parse_cb_calibration(&read(&kept(crate::sc1_wf3::KEPT_CENTRE, ceph_model::wholefilm::cb_calibration_path(models)), "the centre calibration")?)?;
            ensure!(cb.ruling.is_none(), "the development run reads the measured centre calibration, and this one carries a ruling");
            (cal3, cb)
        }
        V2Kind::WholeFilm3 => {
            let r = crate::sc1_wf3::records()?;
            let r = crate::sc1_wf3::Records { gate4_sha: pins.gate4.clone().context("the confirmation run pins no gate /4 record")?,
                centre_sha: pins.centre.clone().context("the confirmation run pins no centre ruling")?, measured_report: pins.cb.clone(), ..r };
            let cal = ceph_model::wholefilm::parse_calibration(&read(&ceph_model::wholefilm::calibration_path(models), "calibration.json (gate /4's tau)")?)?;
            crate::sc1_wf3::check_gate4(&cal, &fp, &r)?;
            let cb = ceph_model::wholefilm::parse_cb_calibration(&read(&ceph_model::wholefilm::cb_calibration_path(models), "the ruled centre calibration")?)?;
            crate::sc1_wf3::check_ruled_centre(&cb, &fp, &r)?;
            (cal, cb)
        }
    };
    let size = ceph_model::wholefilm::parse_size_calibration(&read(&ceph_model::wholefilm::size_calibration_path(models), "the size calibration")?)?;
    size.fits(&fp)?;
    ensure!(size.report_sha256 == pins.size, "the size calibration names report {}, the pre-registered one {}", size.report_sha256, pins.size);
    cb.fits(&fp)?;
    ensure!(cb.report_sha256 == pins.cb, "the centre calibration names report {}, the pre-registered one {}", cb.report_sha256, pins.cb);
    let cb_report = read(&out.join("cb-centre-calibration.json"), "the centre calibration report")?;
    pinned(&cb_report, &pins.cb, "the centre calibration report")?;
    let ref_bytes = read(&ceph_model::wholefilm::reference_path(models), "the 1,000-tracing reference (whole-film-reference-v1.shape)")?;
    pinned(&ref_bytes, &pins.reference, "the 1,000-tracing reference")?;
    let reference = ceph_model::wholefilm::parse_reference(&ref_bytes)?;
    let sc1a = read(&out.join(sc1_1a::REPORT), "SC1-1a's report (the /1 column's positive control)")?;
    pinned(&sc1a, &pins.sc1a_report, "SC1-1a's report")?;
    let sc1a: serde_json::Value = serde_json::from_slice(&sc1a)?;
    // The films, folds and plants: SC1-1a's, by SC1-1a's own code.
    let j = sc1_1a::load_films(ceph400, aariz, m, finder, &fp, cal2.score_line)?;
    ensure!(cal3.score_line == cal2.score_line, "the two calibrations' score lines differ ({} and {})", cal2.score_line, cal3.score_line);
    let ps = sc1_1a::plants(&j.films, &j.folds)?;
    let sh = sc1_1a::info_shifts(&j.films)?;
    Ok(Inputs { fp, pre, cal2, cal3, prior, size, cb, cb_report, reference, sc1a, j, ps, sh })
}

#[cfg(test)]
#[allow(clippy::too_many_arguments)]
fn dev_run(ceph400: &Path, aariz: &Path, models: &Path, out: &Path, git: &Git, pins: &DevPins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<DevReport> {
    dev_run_spec(&DEV, ceph400, aariz, models, out, git, pins, m, finder)
}
/// The rule the second column judges by.
pub fn v2_rule(kind: V2Kind) -> &'static str { match kind { V2Kind::Gate3 => "whole-film/2", V2Kind::WholeFilm3 => ceph_model::wholefilm::RULE_VERSION } }
#[allow(clippy::too_many_arguments)]
pub(crate) fn dev_run_spec(spec: &DevSpec, ceph400: &Path, aariz: &Path, models: &Path, out: &Path, git: &Git, pins: &DevPins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<DevReport> {
    let t0 = std::time::Instant::now();
    // The confirmation run's decomposition report (its row 2 is what the 0.06 sensitivity row must reproduce), read and
    // pinned before anything is judged.
    let decomposition = match spec.kind {
        V2Kind::Gate3 => None,
        V2Kind::WholeFilm3 => {
            let b = read(&out.join(DECOMPOSE_REPORT), "the decomposition report (row 2 must be reproduced)")?;
            pinned(&b, pins.decompose.as_deref().context("the confirmation run pins no decomposition report")?, "the decomposition report")?;
            Some(serde_json::from_slice::<serde_json::Value>(&b)?)
        }
    };
    let Inputs { fp, pre, cal2, cal3, prior, size, cb, cb_report, reference, sc1a, j, ps, sh } = load_inputs(spec, ceph400, aariz, models, out, git, pins, m, finder)?;
    // /1.
    let refs = sc1_1a::Refs::new(&prior, &j.folds)?;
    let tau2 = cal2.tau;
    let j1 = sc1_1a::judge_all(&j.films, &ps, &refs, &tau2)?;
    let s1 = sc1_1a::judge_all(&j.films, &sh, &refs, &tau2)?;
    let v1 = column("whole-film/1", &j1, &s1, m, &tau2)?;
    // /2.
    let (scorers, warm) = Scorers::new(&reference, &j.folds)?;
    let tau3 = cal3.tau;
    let fc = FilmCal { tau: &tau3, size: Some(&size), cb: Some(&cb) };
    let j2 = judge_v2(&j.films, &ps, &scorers, &fc)?;
    let s2 = judge_v2(&j.films, &sh, &scorers, &fc)?;
    let v2 = column(v2_rule(spec.kind), &j2, &s2, m, &tau3)?;
    // The centre-line sensitivity (in memory only).
    let mut sens = Vec::new();
    for line in CENTRE_LINES {
        let c = CbCalibration { line, ..cb.clone() };
        let jl = judge_v2(&j.films, &ps, &scorers, &FilmCal { cb: Some(&c), ..fc })?;
        let k = sc1_1a::count(&jl, m)?;
        let p4 = jl.iter().filter(|x| x.kind == Kind::P4(Region::CranialBase) && !reasons(x).is_empty()).count();
        let cf = |planted: bool| jl.iter().filter(|x| if planted { x.kind.planted() } else { x.kind == Kind::N }).filter(|x| reasons(x).iter().any(is_centre)).count();
        sens.push(SensRow { line, caught: k.caught, false_alarms: k.false_alarms, p4_cranial_base: p4, centre_flags_planted: cf(true), centre_flags_untouched: cf(false) });
    }
    // The centre medians: the two development sets from this run's untouched tracings; the four calibration sets from the
    // calibration report.
    let mut medians = Vec::new();
    for ds in [Dataset::Ceph400, Dataset::Aariz] {
        let o: Vec<(f64, f64)> = j2.iter().filter(|c| c.kind == Kind::N && c.dataset == ds).filter_map(|c| c.result.cb.map(|v| v.offset)).collect();
        medians.push(CentreMedian { set: ds.words().into(), source: "this run (untouched, /2)".into(), films: Some(o.len()), median: median_of(&o)? });
    }
    let cbr: serde_json::Value = serde_json::from_slice(&cb_report)?;
    for s in cbr["perSet"].as_array().context("the centre calibration report has no perSet")? {
        let m2 = s["median"].as_array().and_then(|a| Some((a.first()?.as_f64()?, a.get(1)?.as_f64()?)));
        medians.push(CentreMedian { set: s["set"].as_str().unwrap_or_default().into(), source: "cb-centre-calibration.json".into(), films: s["judged"].as_u64().map(|n| n as usize), median: m2 });
    }
    // Controls.
    let got1 = serde_json::to_value(&v1.counts)?;
    let p0 = got1 == sc1a["counts"];
    let mut controls = vec![control("P0", "the /1 column's counts equal SC1-1a's report field for field (2,289 of 2,740; 11 of 300 on the real films)",
        format!("/1 {} of {} caught, {} of {} untouched; SC1-1a {} of {}, {} of {}", v1.counts.caught, v1.counts.planted, v1.counts.false_alarms, v1.counts.normal,
            sc1a["counts"]["caught"], sc1a["counts"]["planted"], sc1a["counts"]["falseAlarms"], sc1a["counts"]["normal"]), p0)];
    controls.push(control("C7", "every count equals its expected total in both columns", format!("planted {} and {}, untouched {} and {}", v1.counts.planted, v2.counts.planted, v1.counts.normal, v2.counts.normal), true));
    let t1 = j.films.iter().find(|f| f.dataset == Dataset::Ceph400).context("no Test1 film")?;
    let hw = sc1_1a::check_with(t1, &t1.pts, &scorers.all, &fc).is_err_and(|e| e.to_string().contains("homework"));
    controls.push(control("homework", "a Test1 film judged by the whole 1,000-tracing reference (its own ceph400: name kept) is refused", format!("refused: {hw}"), hw));
    let at = sens.iter().find(|r| r.line == cb.line);
    let same = at.is_some_and(|r| r.caught == v2.counts.caught && r.false_alarms == v2.counts.false_alarms);
    controls.push(control("centreAtCalibratedLine", "re-judging at the calibrated centre line gives the main /2 counts", format!("calibrated line {:.2}: {:?}", cb.line, at.map(|r| (r.caught, r.false_alarms))), same));
    if let Some(d) = &decomposition {
        let want = (d["rows"][1]["caught"].as_u64(), d["rows"][1]["falseAlarms"].as_u64());
        let row = sens.iter().find(|r| r.line == 0.06).map(|r| (Some(r.caught as u64), Some(r.false_alarms as u64)));
        controls.push(control("row2", "the 0.06 sensitivity row (gate /2's tolerances, the 1,000 reference, the measured centre line) reproduces the decomposition's row 2",
            format!("0.06 row {row:?}; decomposition row 2 {want:?} ({})", d["rows"][1]["name"]), row == Some(want) && want.0.is_some()));
    }
    let holds = controls.iter().all(|c| c.holds);
    let tripped = stop_exit(v2.counts.caught, v2.counts.false_alarms, m) == 3;
    let (verdict, exit) = if !holds { ("broken", 1) } else if tripped { ("stop", 3) } else { ("printed", 0) };
    let full = size.refs.iter().find(|r| r.regions == size.uses).map(|r| r.line).unwrap_or(f64::NAN);
    let disclosure: Vec<String> = pre["disclosure"].as_array().context("no disclosure")?.iter().filter_map(|d| d.as_str().map(String::from)).collect();
    let mut rep = DevReport { version: spec.version.into(), header: HEADER.into(), prereg_sha256: ft_common::sha256_hex(spec.prereg.as_bytes()), git_sha: git.sha.clone(),
        detector_fingerprint: fp, disclosure, marks: *m, v1, v2, v2_rule: v2_rule(spec.kind).into(), centre_line: cb.line, size_line: full,
        tau3: tau3.0, tau2: tau2.0, sensitivity: sens, centre_medians: medians, fold_warm_seconds: warm, controls, stop_tripped: tripped, verdict: verdict.into(), exit,
        seconds: t0.elapsed().as_secs_f64(), summary: vec![] };
    rep.summary = rep.lines();
    Ok(rep)
}

/// The run: prints every line and writes `<out>/sc1-1b-dev.json` (also when a control fails). Exit 0 printed, 3 the stop
/// tripped (to the owner before PKU), 1 broken (on an error nothing is written).
#[allow(clippy::too_many_arguments)]
pub fn run_with(ceph400: &Path, aariz: &Path, models: &Path, out: &Path, git: &Git, pins: &DevPins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<i32> {
    run_with_spec(&DEV, ceph400, aariz, models, out, git, pins, m, finder)
}
#[allow(clippy::too_many_arguments)]
fn run_with_spec(spec: &DevSpec, ceph400: &Path, aariz: &Path, models: &Path, out: &Path, git: &Git, pins: &DevPins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<i32> {
    println!("SC1-1b {} ({HEADER}): Ceph-400 folder {}; Aariz folder {}", spec.version, ceph400.display(), aariz.display());
    let rep = match dev_run_spec(spec, ceph400, aariz, models, out, git, pins, m, finder) {
        Ok(r) => r,
        Err(e) => { eprintln!("SC1-1b development run broken (nothing written, nothing concluded): {e:#}"); return Ok(1) }
    };
    for l in &rep.summary { println!("{l}"); }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let path = out.join(spec.report);
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {})", path.display(), ft_common::sha256_hex(text.as_bytes()));
    Ok(rep.exit)
}
/// Which development run: its pre-registration and report, and which rule its second column judges by.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum V2Kind { Gate3, WholeFilm3 }
#[derive(Clone, Copy, Debug)]
pub struct DevSpec { pub prereg: &'static str, pub path: &'static str, pub version: &'static str, pub report: &'static str, pub kind: V2Kind }
pub const DEV: DevSpec = DevSpec { prereg: PREREG, path: PREREG_PATH, version: VERSION, report: REPORT, kind: V2Kind::Gate3 };
pub const DEV3: DevSpec = DevSpec { prereg: PREREG3, path: PREREG3_PATH, version: VERSION3, report: REPORT3, kind: V2Kind::WholeFilm3 };
/// whole-film/3's confirmation run on given folders (`reference/sc1-1b-dev3.json`): prints and writes
/// `<out>/sc1-1b-dev3.json`. Exit 0 printed, 3 the stop tripped (to the owner, no re-tuning), 1 broken.
#[allow(clippy::too_many_arguments)]
pub fn run3_with(ceph400: &Path, aariz: &Path, models: &Path, out: &Path, git: &Git, pins: &DevPins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<i32> {
    run_with_spec(&DEV3, ceph400, aariz, models, out, git, pins, m, finder)
}
/// `--sc1-1b-dev3`.
pub fn run3_cli(aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> { run_cli_spec(&DEV3, aariz, ceph400, models, out) }
/// `--sc1-1b-dev` / `--sc1-1b-dev3`: the git state, the pins, the installed region finder (boxes from the cache), then
/// the run on SC1-1a's real marks.
fn run_cli_spec(spec: &DevSpec, aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Git, DevPins, sc1_1a::EngineFinder)> {
        crate::sc1_gate2::refuse_reads_for(&crate::sc1_gate2::GATE3, &[(aariz, "valid"), (ceph400, "test1")])?;
        let engine = ceph_infer::regions::RegionEngine::load(&ceph_infer::regions::regions_manifest_path(models))?;
        Ok((crate::sc1_gate::git_state(spec.path)?, DevPins::from_text(spec.prereg)?, sc1_1a::EngineFinder { engine, cache: out.join("boxes") }))
    };
    match pre() {
        Ok((git, pins, finder)) => run_with_spec(spec, ceph400, aariz, models, out, &git, &pins, &Marks::real(), &finder),
        Err(e) => { eprintln!("SC1-1b {} broken (nothing written, nothing concluded): {e:#}", spec.version); Ok(1) }
    }
}
/// `--sc1-1b-dev`.
pub fn run_cli(aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> { run_cli_spec(&DEV, aariz, ceph400, models, out) }

// ---- Information (owner ruling 5 Nov 2026, "Find the cause first"): the P4 loss decomposition ----

/// The decomposition's report (information only; no stored calibration or pre-registration changed).
pub const DECOMPOSE_REPORT: &str = "sc1-1b-dev-decompose.json";
/// Which shape reference a configuration uses.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum RefKind { Thousand, ThreeHundred }
/// The five configurations, in order: (name, τ, reference). Every one runs the size and centre looks as calibrated.
pub fn decompose_configs(tau2: [f64; 5], tau3: [f64; 5]) -> Vec<(String, [f64; 5], RefKind)> {
    let mut swapped = tau3;
    for r in [Region::Maxilla, Region::Mandible] { swapped[r.index()] = tau2[r.index()]; }
    vec![("1 as calibrated: gate /3 tau, 1,000-tracing reference".into(), tau3, RefKind::Thousand),
         ("2 gate /2 tau, 1,000-tracing reference".into(), tau2, RefKind::Thousand),
         ("3 gate /3 tau, 300-tracing reference".into(), tau3, RefKind::ThreeHundred),
         ("4 gate /2 tau, 300-tracing reference".into(), tau2, RefKind::ThreeHundred),
         ("5 as 1, but only the maxilla and mandible tau at gate /2's".into(), swapped, RefKind::Thousand)]
}
impl Scorers {
    /// The 300-tracing file's scorers (SC1-1a's shape look): each fold's bare ids left out, the whole file for Aariz;
    /// every all-19 line fitted cold, in parallel; returns the seconds that took.
    pub fn from_prior(p: &ceph_model::pointcheck::Prior, folds: &[Vec<String>]) -> anyhow::Result<(Scorers, f64)> {
        let all = WholeScorer::from_prior(p)?;
        let folds: Vec<WholeScorer> = folds.iter().map(|f| all.leave_out_names(f)).collect::<anyhow::Result<_>>()?;
        let t = std::time::Instant::now();
        let all19: Vec<usize> = (0..19).collect();
        let sets: Vec<&WholeScorer> = folds.iter().chain(std::iter::once(&all)).collect();
        for l in par_map(&sets, |s| s.line_for(&all19)) { l?; }
        Ok((Scorers { folds, all }, t.elapsed().as_secs_f64()))
    }
}
/// One configuration's result.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecRow { pub name: String, pub tau: [f64; 5], pub reference: RefKind, pub caught: usize, pub planted: usize, pub p4: Vec<Looks>, pub false_alarms: usize, pub normal: usize, pub untouched: Looks, pub untouched_by_set: Vec<Looks> }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecReport { pub version: String, pub header: String, pub what: String, pub git_sha: String, pub detector_fingerprint: String, pub rows: Vec<DecRow>, pub control: Control, pub seconds: f64, pub summary: Vec<String> }

#[allow(clippy::too_many_arguments)]
fn decompose_run(ceph400: &Path, aariz: &Path, models: &Path, out: &Path, git: &Git, pins: &DevPins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<DecReport> {
    let t0 = std::time::Instant::now();
    let i = load_inputs(&DEV, ceph400, aariz, models, out, git, pins, m, finder)?;
    let dev: serde_json::Value = serde_json::from_slice(&read(&out.join(REPORT), "the development run's report (row 1 must reproduce it)")?)?;
    let (thousand, w1) = Scorers::new(&i.reference, &i.j.folds)?;
    let (three, w3) = Scorers::from_prior(&i.prior, &i.j.folds)?;
    let mut rows = Vec::new();
    for (name, t, rk) in decompose_configs(i.cal2.tau.0, i.cal3.tau.0) {
        let tau = RegionTau(t);
        let fc = FilmCal { tau: &tau, size: Some(&i.size), cb: Some(&i.cb) };
        let jl = judge_v2(&i.j.films, &i.ps, match rk { RefKind::Thousand => &thousand, RefKind::ThreeHundred => &three }, &fc)?;
        let k = sc1_1a::count(&jl, m)?;
        let p4 = KINDS[5..].iter().map(|kd| looks(&kd.label(), &of(&jl, *kd, None), &tau)).collect();
        let by = [Dataset::Ceph400, Dataset::Aariz].iter().map(|d| looks(&format!("N on {}", d.words()), &of(&jl, Kind::N, Some(*d)), &tau)).collect();
        rows.push(DecRow { name, tau: t, reference: rk, caught: k.caught, planted: k.planted, p4, false_alarms: k.false_alarms, normal: k.normal,
            untouched: looks("N pooled", &of(&jl, Kind::N, None), &tau), untouched_by_set: by });
    }
    let want = (dev["v2"]["counts"]["caught"].as_u64(), dev["v2"]["counts"]["falseAlarms"].as_u64());
    let got = (Some(rows[0].caught as u64), Some(rows[0].false_alarms as u64));
    let control = control("row1", "row 1 (as calibrated) reproduces the development run's /2 counts (reports/sc1/sc1-1b-dev.json)",
        format!("row 1 {:?}; development run {:?}", got, want), got == want && want.0.is_some());
    let mut rep = DecReport { version: format!("{VERSION} information: P4 loss decomposition"), header: HEADER.into(),
        what: "information only, by the owner's ruling of 5 Nov 2026 ('Find the cause first'); not pre-registered; SC1-1a's films, folds, seeds and plants; the size and centre looks as calibrated in every row; no stored calibration or pre-registration changed".into(),
        git_sha: git.sha.clone(), detector_fingerprint: i.fp, rows, control, seconds: t0.elapsed().as_secs_f64(), summary: vec![] };
    let mut v = vec![format!("{}: {}", rep.version, rep.header), rep.what.clone(), format!("git HEAD {}; detector {}; scorers fitted: 1,000 folds {w1:.1} s, 300 folds and file {w3:.1} s", rep.git_sha, rep.detector_fingerprint)];
    for r in &rep.rows {
        v.push(format!("{} (tau {:?}): caught {} of {}; untouched flagged {} of {}", r.name, r.tau, r.caught, r.planted, r.false_alarms, r.normal));
        for l in &r.p4 { v.push(format!("    {}: {} of {} ({})", l.label, l.flagged, l.cases, fmt_looks(l, true))); }
        for l in &r.untouched_by_set { v.push(format!("    {}: {} of {} ({})", l.label, l.flagged, l.cases, fmt_looks(l, true))); }
    }
    v.push(format!("control {}: {} -> {}", rep.control.what, rep.control.got, if rep.control.holds { "holds" } else { "DOES NOT HOLD" }));
    v.push(format!("exit {} (0 printed, 1 broken); {:.0} s", if rep.control.holds { 0 } else { 1 }, rep.seconds));
    rep.summary = v;
    Ok(rep)
}
/// The decomposition on given folders: prints and writes `<out>/sc1-1b-dev-decompose.json` (also when its control
/// fails). Exit 0 printed, 1 broken (on an error nothing is written).
#[allow(clippy::too_many_arguments)]
pub fn decompose_with(ceph400: &Path, aariz: &Path, models: &Path, out: &Path, git: &Git, pins: &DevPins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<i32> {
    let rep = match decompose_run(ceph400, aariz, models, out, git, pins, m, finder) {
        Ok(r) => r,
        Err(e) => { eprintln!("SC1-1b decomposition broken (nothing written): {e:#}"); return Ok(1) }
    };
    for l in &rep.summary { println!("{l}"); }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let path = out.join(DECOMPOSE_REPORT);
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {})", path.display(), ft_common::sha256_hex(text.as_bytes()));
    Ok(if rep.control.holds { 0 } else { 1 })
}
/// `--sc1-1b-dev-decompose`: as `--sc1-1b-dev`, but the clean-tree check covers only `crates/ceph-bench` and `reference`
/// (the code and pins this run reads), since other work may be under way in the app and store files; that is printed.
pub fn decompose_cli(aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Git, DevPins, sc1_1a::EngineFinder)> {
        crate::sc1_gate2::refuse_reads_for(&crate::sc1_gate2::GATE3, &[(aariz, "valid"), (ceph400, "test1")])?;
        let engine = ceph_infer::regions::RegionEngine::load(&ceph_infer::regions::regions_manifest_path(models))?;
        let mut git = crate::sc1_gate::git_state(PREREG_PATH)?;
        let o = std::process::Command::new("git").args(["status", "--porcelain", "--untracked-files=no", "--", "crates/ceph-bench", "reference"]).output()?;
        ensure!(o.status.success(), "git status failed");
        println!("clean-tree check: crates/ceph-bench and reference only (whole tree dirty: {})", git.dirty);
        git.dirty = !o.stdout.is_empty();
        Ok((git, DevPins::from_prereg()?, sc1_1a::EngineFinder { engine, cache: out.join("boxes") }))
    };
    match pre() {
        Ok((git, pins, finder)) => decompose_with(ceph400, aariz, models, out, &git, &pins, &Marks::real(), &finder),
        Err(e) => { eprintln!("SC1-1b decomposition broken (nothing written): {e:#}"); Ok(1) }
    }
}

#[cfg(test)]
#[path = "sc1_dev_tests.rs"]
mod tests;
