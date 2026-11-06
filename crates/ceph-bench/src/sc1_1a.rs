//! SC-1 Part 1, SC1-1a: the one-time pre-registered test of the whole-film check (spec §9.1; rulings R6, OQ-5, OQ-8,
//! RV-1), pre-registered in `reference/sc1-1a.json` (committed alone before any run, SHA-256 pinned in a test; every rule
//! here is that file's, and its `definitions` fix the details the spec leaves open).
//!
//! **The picture.** Lay the region finder's five boxes on a film the finder never learned from, put a tracing on it,
//! and ask the app's own check (`check_film`) whether the tracing sits on this film's anatomy and looks like a human face
//! the right way round. Do it with tracings we spoiled on purpose (mirrored, another patient's, the wrong size, one region
//! moved 10-20 mm): each one the check flags is a catch. Do it with the experts' own tracings untouched: each one it flags
//! is a false alarm.
//!
//! **Compared with.** The experts' tracings (gt.csv) of Ceph-400 Test1 (151-300) and Aariz valid (150). The shape look
//! judges a Test1 film by the 270 reference tracings outside its fold (the shipped file holds Test1), an Aariz film by
//! all 300. The regions are judged at the gate /2 calibration (τ and score line, owner ruling 5 Nov 2026).
//!
//! **Marks (pooled, OQ-5).** At least 2,603 of the 2,740 planted tracings flagged and at most 6 of the 300 untouched ones,
//! with every control holding: exit 0. Controls hold, a mark missed: exit 3, back to the owner, no re-run with new marks. A
//! control fails or a count is off: exit 1, nothing concluded. The gate report says stop: exit 4, no verdict.
//!
//! **What it cannot see.** A wrong mm-per-pixel number with the points untouched (Part 1 never reads the scale, OQ-8).
//! P2 (another patient's tracing from the same machine) may be the weakest plant; P3 rests on the regions alone, because
//! the shape look is scale-free.
//!
//! Ceph-400 Test2 and Aariz test are refused before anything is read. Prints aggregates only, never a film id.
use crate::chainproof::{self, shuffle, Rng};
use crate::ft_common::{self, case_rng, counted, direction, no_homework, par_map, Pt};
use crate::sc1_gate::{self, Git};
use crate::{dataset, ledger, scale, sc1_boxes, sc1_data, sc1_gate2, xcache};
use anyhow::{ensure, Context};
use ceph_infer::regions::{regions_manifest_path, Found, RegionEngine};
use ceph_model::pointcheck::{self as pc, Mark, Prior, RunCheck, ShapeScorer, ORDER};
use ceph_model::wholefilm::{box_quality, reference_name, calibration_path, check_film, off_film, FilmCal, parse_calibration, teaching_boxes, BoxQuality, FilmBoxes, FilmCheck,
    FilmResult, Look, Reason, Region, RegionCalibration, RegionLook, RegionTau, Regions, WholeScorer, REGIONS, REGION_OF};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::path::{Path, PathBuf};

pub const PREREG: &str = include_str!("../../../reference/sc1-1a.json");
pub const PREREG_PATH: &str = "reference/sc1-1a.json";
pub const VERSION: &str = "sc1-1a/1";
/// The marks (spec §9.1, R6): 2,740 planted, 2,603 caught needed; 300 untouched, at most 6 flagged.
pub const PLANTED: usize = 2740;
pub const NEEDED: usize = 2603;
pub const NORMAL: usize = 300;
pub const FALSE_MAX: usize = 6;
/// The films: Ceph-400 Test1 (151-300), Aariz valid, and the Aariz valid films with a true scale under aariz-scale/1.
pub const TEST1: usize = 150;
pub const VALID: usize = 150;
pub const SCALED_VALID: usize = 98;
pub const FOLDS: usize = 5;
pub const FOLD_SEED: u64 = 20261103;
pub const SEED: u64 = 20261104;
/// P2's dataset salts (definitions.salts): 400 + fold index for a Ceph-400 Test1 fold; 1 for Aariz valid.
pub const SALT_CEPH400: u64 = 400;
pub const SALT_AARIZ: u64 = 1;
/// case_rng type numbers (definitions.types).
pub const T_P4: u64 = 5;
pub const T_SHIFT: u64 = 6;
pub const T_CONTROL: u64 = 9;
/// The information shifts of the whole tracing, mm.
pub const SHIFTS_MM: [u64; 2] = [10, 20];
pub const CONTROL_FILMS: usize = 10;
/// C1 (definitions.C1): the reference faces (count, seed), the judged faces, the SYNTHETIC film's size.
pub const C1_REFERENCE: (usize, u64) = (300, 20261103);
pub const C1_JUDGED: (usize, u64) = (50, 20261104);
pub const C1_FILM: (u32, u32) = (2000, 2400);
pub const C2_FACTOR: f64 = 2.0;
pub const C3_SHIFT_MM: f64 = 40.0;
pub const C8_FACTOR: f64 = 1000.0;
pub const CEPH400_MM_PER_PX: f64 = sc1_gate::CEPH400_MM_PER_PX;
/// The gate rule SC1-1a requires (review I2): the calibration's rule and the report's version.
pub const GATE_RULE: &str = sc1_gate2::VERSION;
/// The only gate report SC1-1a reads, in `--out` (reports/sc1). The /1 pair (box-gate.json, calibration-1.json) is never read.
pub const GATE_REPORT: &str = "box-gate-2.json";
pub const REPORT: &str = "sc1-1a.json";
pub const PASS: &str = "pass";
pub const FAIL: &str = "fail";
pub const BROKEN: &str = "broken";
pub const GATE_STOP: &str = "gate-stop";

/// The counts a run is judged by. `real()` is the pre-registration's; the SYNTHETIC tests use smaller sets by the same rules.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marks { pub test1: usize, pub valid: usize, pub scaled_valid: usize, pub planted: usize, pub needed: usize, pub normal: usize, pub false_max: usize }
impl Marks {
    /// Five plants on every film (P1a, P1b, P2, P3 ×0.5, P3 ×2), five P4 on every film with a scale; one N per film.
    pub fn for_films(test1: usize, valid: usize, scaled_valid: usize) -> Marks {
        let planted = 5 * (test1 + valid) + REGIONS.len() * (test1 + scaled_valid);
        let normal = test1 + valid;
        Marks { test1, valid, scaled_valid, planted, needed: needed_of(planted), normal, false_max: false_max_of(normal) }
    }
    pub fn real() -> Marks { Marks::for_films(TEST1, VALID, SCALED_VALID) }
}
/// ceil(19 n / 20) in integers.
pub fn needed_of(planted: usize) -> usize { (19 * planted + 19) / 20 }
/// floor(2 n / 100) in integers.
pub fn false_max_of(normal: usize) -> usize { 2 * normal / 100 }

/// Test1's folds: the ids sorted, shuffled with splitmix64 seed 20261103; fold i = positions s·i .. s·i + s − 1 with
/// s = ⌈n / 5⌉ (30 for 150). Always five folds.
pub fn folds(test1: &[String]) -> Vec<Vec<String>> {
    let mut v = test1.to_vec();
    v.sort();
    shuffle(&mut v, &mut Rng::new(FOLD_SEED));
    let s = v.len().div_ceil(FOLDS);
    (0..FOLDS).map(|i| v.iter().skip(s * i).take(s).cloned().collect()).collect()
}
/// The 10 control films: Test1 ids sorted, shuffled with case_rng(20261104, [9]), the first 10.
pub fn control_films(test1: &[String]) -> Vec<String> {
    let mut v = test1.to_vec();
    v.sort();
    shuffle(&mut v, &mut case_rng(SEED, &[T_CONTROL]));
    v.truncate(CONTROL_FILMS);
    v
}
/// Sattolo's algorithm on `ids.len()` positions with chainproof::Rng(seed ^ salt): one cycle, so position i gets the
/// tracing of position d[i] ≠ i. (Fewer than 2 ids cannot be deranged; the caller refuses them.)
pub fn derangement(ids: &[String], seed: u64, salt: u64) -> Vec<usize> {
    let mut p: Vec<usize> = (0..ids.len()).collect();
    let mut r = Rng::new(seed ^ salt);
    for i in (1..p.len()).rev() { let j = r.below(i); p.swap(i, j); }
    p
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum Dataset { Ceph400, Aariz }
impl Dataset {
    pub fn words(self) -> &'static str { match self { Dataset::Ceph400 => "Ceph-400 test1", Dataset::Aariz => "Aariz valid" } }
    /// The dataset's key in a reference name (`wholefilm::reference_name`): `ceph400:151`, `aariz:<id>` (M16).
    pub fn reference_key(self) -> &'static str { match self { Dataset::Ceph400 => "ceph400", Dataset::Aariz => "aariz" } }
}
/// One judged film: its expert tracing (19 points in ORDER, film px as stored), size, scale if recorded (never read by the
/// check), its Test1 fold, and the region finder's boxes on it at the score line.
#[derive(Clone, Debug)]
pub struct Film { pub id: String, pub dataset: Dataset, pub fold: Option<usize>, pub pts: Vec<Pt>, pub w: u32, pub h: u32, pub mm_per_px: Option<f64>, pub regions: Regions }
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize)]
pub enum Kind { P1a, P1b, P2, P3Half, P3Double, P4(Region), N, Shift(u64) }
impl Kind {
    pub fn label(&self) -> String {
        match self {
            Kind::P1a => "P1a mirrored with the film".into(), Kind::P1b => "P1b mirrored in place".into(), Kind::P2 => "P2 another film's tracing".into(),
            Kind::P3Half => "P3 x0.5".into(), Kind::P3Double => "P3 x2".into(), Kind::P4(r) => format!("P4 {} moved 10-20 mm", r.words()),
            Kind::N => "N untouched".into(), Kind::Shift(mm) => format!("the whole tracing moved {mm} mm (information)"),
        }
    }
    pub fn planted(&self) -> bool { !matches!(self, Kind::N | Kind::Shift(_)) }
}
/// One tracing to judge: on `films[film]`, made by `kind`.
#[derive(Clone, Debug)]
pub struct Plant { pub film: usize, pub kind: Kind, pub pts: Vec<Pt> }

pub fn centroid(pts: &[Pt]) -> Pt {
    let n = pts.len() as f64;
    (pts.iter().map(|p| p.0).sum::<f64>() / n, pts.iter().map(|p| p.1).sum::<f64>() / n)
}
/// P1a: mirrored with the film, x → (w − 1) − x.
pub fn mirror_film(pts: &[Pt], w: u32) -> Vec<Pt> { pts.iter().map(|p| ((w as f64 - 1.0) - p.0, p.1)).collect() }
/// P1b: mirrored in place about the centroid, x → 2 cx − x.
pub fn mirror_in_place(pts: &[Pt]) -> Vec<Pt> { let c = centroid(pts); pts.iter().map(|p| (2.0 * c.0 - p.0, p.1)).collect() }
/// P3 and C2: p → c + k (p − c).
pub fn scaled(pts: &[Pt], k: f64) -> Vec<Pt> { let c = centroid(pts); pts.iter().map(|p| (c.0 + k * (p.0 - c.0), c.1 + k * (p.1 - c.1))).collect() }
/// The region of ORDER[k].
fn region_at(k: usize) -> Option<Region> { REGION_OF.iter().find(|(n, _)| *n == ORDER[k]).map(|(_, r)| *r) }
/// The points of `only` (every point when None) moved by (dx, dy) px; the others as they are.
pub fn moved(pts: &[Pt], only: Option<Region>, dx: f64, dy: f64) -> Vec<Pt> {
    pts.iter().enumerate().map(|(k, p)| if only.is_none() || region_at(k) == only { (p.0 + dx, p.1 + dy) } else { *p }).collect()
}
/// P4's draws for one film and region: d = 10 + 10u mm and a unit direction, from case_rng(seed, [5, film, region]).
pub fn p4_draw(film_index: usize, region: Region) -> (f64, (f64, f64)) { p4_draw_seeded(SEED, film_index, region) }
/// The information shift's direction, from case_rng(seed, [6, film, mm]).
pub fn shift_draw(film_index: usize, mm: u64) -> (f64, f64) { shift_draw_seeded(SEED, film_index, mm) }
/// P4's draws under any seed (M20; SC1-1b-PKU plants with its own): d = 10 + 10u mm and a random unit direction, from
/// case_rng(seed, [5, film, region]). At SC1-1a's SEED these are SC1-1a's draws, bit for bit.
pub fn p4_draw_seeded(seed: u64, film_index: usize, region: Region) -> (f64, (f64, f64)) {
    let mut r = case_rng(seed, &[T_P4, film_index as u64, region.index() as u64]);
    let u = (r.next() >> 11) as f64 / (1u64 << 53) as f64;
    (10.0 + 10.0 * u, direction(&mut r))
}
/// The information shift's direction under any seed (M20), from case_rng(seed, [6, film, mm]).
pub fn shift_draw_seeded(seed: u64, film_index: usize, mm: u64) -> (f64, f64) { direction(&mut case_rng(seed, &[T_SHIFT, film_index as u64, mm])) }

/// `films` must be Test1 sorted, then Aariz valid sorted (definitions.filmIndex), every tracing 19 points.
fn check_order(films: &[Film]) -> anyhow::Result<()> {
    ensure!(films.iter().all(|f| f.pts.len() == 19), "every judged tracing must have 19 points");
    let c4 = films.iter().take_while(|f| f.dataset == Dataset::Ceph400).count();
    ensure!(films[c4..].iter().all(|f| f.dataset == Dataset::Aariz), "the films must be Ceph-400 test1 first, then Aariz valid");
    ensure!(films[..c4].windows(2).all(|w| w[0].id < w[1].id) && films[c4..].windows(2).all(|w| w[0].id < w[1].id), "each dataset's films must be sorted by id, each once");
    Ok(())
}
/// Every plant and the untouched tracings (the counted cases), per film in order.
pub fn plants(films: &[Film], folds: &[Vec<String>]) -> anyhow::Result<Vec<Plant>> {
    check_order(films)?;
    // P2's sources: within each Test1 fold (salt 400 + fold), within Aariz valid (salt 1).
    let mut src: Vec<Option<usize>> = vec![None; films.len()];
    let idx = |ds: Dataset, id: &str| films.iter().position(|f| f.dataset == ds && f.id == id);
    for (k, fold) in folds.iter().enumerate() {
        ensure!(fold.len() >= 2, "fold {k} has {} films: a derangement needs at least 2", fold.len());
        let at: Vec<usize> = fold.iter().map(|id| idx(Dataset::Ceph400, id).with_context(|| format!("a fold names a film that is not judged ({id})"))).collect::<anyhow::Result<_>>()?;
        ensure!(at.iter().all(|&i| films[i].fold == Some(k)), "fold {k}'s films do not carry fold {k}");
        let d = derangement(fold, SEED, SALT_CEPH400 + k as u64);
        for (i, &j) in d.iter().enumerate() { ensure!(src[at[i]].is_none(), "a Test1 film is in two folds"); src[at[i]] = Some(at[j]); }
    }
    let az: Vec<usize> = (0..films.len()).filter(|&i| films[i].dataset == Dataset::Aariz).collect();
    ensure!(az.is_empty() || az.len() >= 2, "Aariz valid has 1 film: a derangement needs at least 2");
    let az_ids: Vec<String> = az.iter().map(|&i| films[i].id.clone()).collect();
    for (i, &j) in derangement(&az_ids, SEED, SALT_AARIZ).iter().enumerate() { src[az[i]] = Some(az[j]); }
    let mut out = Vec::new();
    for (i, f) in films.iter().enumerate() {
        let from = src[i].with_context(|| format!("a {} film is in no fold", f.dataset.words()))?;
        ensure!(from != i, "P2 would give a film its own tracing");
        out.push(Plant { film: i, kind: Kind::P1a, pts: mirror_film(&f.pts, f.w) });
        out.push(Plant { film: i, kind: Kind::P1b, pts: mirror_in_place(&f.pts) });
        out.push(Plant { film: i, kind: Kind::P2, pts: films[from].pts.clone() });
        out.push(Plant { film: i, kind: Kind::P3Half, pts: scaled(&f.pts, 0.5) });
        out.push(Plant { film: i, kind: Kind::P3Double, pts: scaled(&f.pts, 2.0) });
        if let Some(mm) = f.mm_per_px {
            ensure!(mm.is_finite() && mm > 0.0, "a film's scale is not a positive number");
            for r in REGIONS {
                let (d, u) = p4_draw(i, r);
                out.push(Plant { film: i, kind: Kind::P4(r), pts: moved(&f.pts, Some(r), d / mm * u.0, d / mm * u.1) });
            }
        }
        out.push(Plant { film: i, kind: Kind::N, pts: f.pts.clone() });
    }
    Ok(out)
}
/// Information only: on every film with a scale, the whole tracing moved 10 and 20 mm in a seeded direction.
pub fn info_shifts(films: &[Film]) -> anyhow::Result<Vec<Plant>> {
    check_order(films)?;
    let mut out = Vec::new();
    for (i, f) in films.iter().enumerate() {
        let Some(mm) = f.mm_per_px else { continue };
        for s in SHIFTS_MM {
            let u = shift_draw(i, s);
            let px = s as f64 / mm;
            out.push(Plant { film: i, kind: Kind::Shift(s), pts: moved(&f.pts, None, px * u.0, px * u.1) });
        }
    }
    Ok(out)
}

/// One reference set: the shape look's scorer and Stage A's, both from the same tracings (the file's, less `leave_out`,
/// found by name).
pub struct RefSet { pub whole: WholeScorer, pub stage_a: ShapeScorer }
impl RefSet {
    pub fn new(prior: &Prior, leave_out: &[String]) -> anyhow::Result<RefSet> {
        let idx: Vec<usize> = leave_out.iter().map(|n| prior.names.iter().position(|m| m == n)
            .with_context(|| format!("the reference file holds no tracing named {n}"))).collect::<anyhow::Result<_>>()?;
        let whole = WholeScorer::from_prior(prior)?.leave_out(&idx)?;
        let kept: Vec<Vec<Pt>> = prior.tracings.iter().enumerate().filter(|(i, _)| !idx.contains(i)).map(|(_, t)| t.clone()).collect();
        ensure!(kept.len() == whole.films(), "the two scorers would hold different tracings");
        Ok(RefSet { whole, stage_a: ShapeScorer::new(kept) })
    }
}
/// A reference set per Test1 fold (the 270 outside it) and the whole file (Aariz valid).
pub struct Refs { pub folds: Vec<RefSet>, pub all: RefSet }
impl Refs {
    pub fn new(prior: &Prior, folds: &[Vec<String>]) -> anyhow::Result<Refs> {
        Ok(Refs { folds: folds.iter().map(|f| RefSet::new(prior, f)).collect::<anyhow::Result<_>>()?, all: RefSet::new(prior, &[])? })
    }
    pub fn of(&self, f: &Film) -> &RefSet { match f.fold { Some(k) if k < self.folds.len() => &self.folds[k], _ => &self.all } }
    /// Fits the all-19 shape line of every set, one set per thread, before the plants (each costs a leave-one-out pass).
    fn warm(&self) -> anyhow::Result<()> {
        let sets: Vec<&RefSet> = self.folds.iter().chain(std::iter::once(&self.all)).collect();
        let all19: Vec<usize> = (0..19).collect();
        for r in par_map(&sets, |s| s.whole.line_for(&all19)) { r?; }
        Ok(())
    }
}
pub fn marks_of(pts: &[Pt]) -> Vec<Mark> { ORDER.iter().zip(pts).map(|(n, p)| Mark { landmark_id: n.to_string(), x: p.0, y: p.1 }).collect() }
/// The app's whole-film check on one tracing, on the film's own boxes, the stored facing right. The homework guard (C6)
/// first: a film judged by a reference set that holds its own tracing is refused.
pub fn check(f: &Film, pts: &[Pt], r: &RefSet, tau: &RegionTau) -> anyhow::Result<FilmResult> { check_marks(f, &marks_of(pts), r, tau) }
fn check_marks(f: &Film, marks: &[Mark], r: &RefSet, tau: &RegionTau) -> anyhow::Result<FilmResult> {
    check_marks_with(f, marks, &r.whole, &FilmCal::tau_only(tau))
}
/// The whole-film check with any shape scorer and any calibration (M17; SC-1 Part 1b: whole-film/2 is the 1,000-tracing
/// scorer with τ /3 and the size and centre looks): the homework guard by both names, then `check_film` on the film's own
/// boxes, the stored facing right. With `FilmCal::tau_only` and a `RefSet`'s scorer it is `check`.
pub fn check_with(f: &Film, pts: &[Pt], whole: &WholeScorer, cal: &FilmCal) -> anyhow::Result<FilmResult> { check_marks_with(f, &marks_of(pts), whole, cal) }
fn check_marks_with(f: &Film, marks: &[Mark], whole: &WholeScorer, cal: &FilmCal) -> anyhow::Result<FilmResult> {
    no_homework(whole.names(), &both_names(f)?)?;
    check_film(Some(whole), marks, false, f.w, f.h, RegionLook::Found(&f.regions), cal)
}
/// The judged film under both names the homework guard must look for (M16): its bare id, as SC1-1a's 300-tracing file
/// names it ("151"), and its reference name, as the 1,000-tracing file names it ("ceph400:151", "aariz:<id>").
fn both_names(f: &Film) -> anyhow::Result<[String; 2]> { Ok([f.id.clone(), reference_name(f.dataset.reference_key(), &f.id)?]) }
/// Information: Stage A (point-check/2) on the same tracing and reference tracings; flagged = Flagged or FilmUnusual.
pub fn stage_a(f: &Film, pts: &[Pt], r: &RefSet) -> anyhow::Result<bool> {
    no_homework(r.whole.names(), &both_names(f)?)?;
    Ok(matches!(pc::score_run(&r.stage_a, &marks_of(pts), false, f.w)?, RunCheck::Flagged { .. } | RunCheck::FilmUnusual { .. }))
}

/// One judged tracing.
#[derive(Clone, Debug)]
pub struct Case { pub kind: Kind, pub dataset: Dataset, pub result: FilmResult, pub stage_a: bool }
/// Every plant judged (shape look, regions, facing; and Stage A for information), in the plants' order.
pub fn judge_all(films: &[Film], plants: &[Plant], refs: &Refs, tau: &RegionTau) -> anyhow::Result<Vec<Case>> {
    refs.warm()?;
    par_map(plants, |p| -> anyhow::Result<Case> {
        let f = films.get(p.film).context("a plant names no film")?;
        let r = refs.of(f);
        Ok(Case { kind: p.kind, dataset: f.dataset, result: check(f, &p.pts, r, tau)?, stage_a: stage_a(f, &p.pts, r)? })
    }).into_iter().collect()
}
/// One printed line: how many cases, how many flagged, which look flagged them (a case may have several), and how many
/// Stage A flagged too.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Line { pub label: String, pub cases: usize, pub flagged: usize, pub mirrored: usize, pub shape: usize, pub region: usize, pub facing: usize, pub no_ceph_found: usize, pub stage_a: usize }
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts { pub caught: usize, pub planted: usize, pub false_alarms: usize, pub normal: usize, pub lines: Vec<Line>, pub normal_lines: Vec<Line> }
fn reasons(c: &Case) -> &[Reason] { match &c.result.check { FilmCheck::Flagged { reasons } => reasons, _ => &[] } }
fn flagged(c: &Case) -> bool { matches!(c.result.check, FilmCheck::Flagged { .. }) }
pub fn line(label: &str, cases: &[&Case]) -> Line {
    let n = |k: &str| cases.iter().filter(|c| reasons(c).iter().any(|r| r.key() == k)).count();
    Line { label: label.into(), cases: cases.len(), flagged: cases.iter().filter(|c| flagged(c)).count(), mirrored: n("mirrored"), shape: n("shape"),
        region: n("region"), facing: n("facing"), no_ceph_found: n("no-ceph-found"), stage_a: cases.iter().filter(|c| c.stage_a).count() }
}
/// The counts (C7): every type's total and its split by dataset are the expected ones, the pooled totals are the marks'
/// planted and normal; anything else, an information case among them included, stops the run with an error.
pub fn count(cases: &[Case], m: &Marks) -> anyhow::Result<Counts> {
    ensure!(m.planted > 0 && m.normal > 0, "a mark that counts nothing is an error, never a pass");
    ensure!(*m == Marks::for_films(m.test1, m.valid, m.scaled_valid), "the marks {m:?} are not the pre-registered rule's for these film counts");
    ensure!(!cases.iter().any(|c| matches!(c.kind, Kind::Shift(_))), "an information case is among the counted ones");
    let of = |k: Kind, ds: Option<Dataset>| -> Vec<&Case> { cases.iter().filter(|c| c.kind == k && ds.is_none_or(|d| c.dataset == d)).collect() };
    let mut lines = Vec::new();
    let mut kinds: Vec<(Kind, usize)> = [Kind::P1a, Kind::P1b, Kind::P2, Kind::P3Half, Kind::P3Double].iter().map(|k| (*k, m.valid)).collect();
    kinds.extend(REGIONS.iter().map(|r| (Kind::P4(*r), m.scaled_valid)));
    for (k, az) in kinds {
        let all = of(k, None);
        counted(&k.label(), all.len(), m.test1 + az)?;
        counted(&format!("{} on {}", k.label(), Dataset::Ceph400.words()), of(k, Some(Dataset::Ceph400)).len(), m.test1)?;
        lines.push(line(&k.label(), &all));
    }
    let mut normal_lines = Vec::new();
    for (ds, n) in [(Dataset::Ceph400, m.test1), (Dataset::Aariz, m.valid)] {
        let c = of(Kind::N, Some(ds));
        counted(&format!("N on {}", ds.words()), c.len(), n)?;
        normal_lines.push(line(&format!("N on {}", ds.words()), &c));
    }
    // Every case is of one of the kinds counted above, so the totals are the marks' (Marks::for_films checked first).
    let planted: Vec<&Case> = cases.iter().filter(|c| c.kind.planted()).collect();
    let normal = of(Kind::N, None);
    Ok(Counts { caught: planted.iter().filter(|c| flagged(c)).count(), planted: planted.len(), false_alarms: normal.iter().filter(|c| flagged(c)).count(),
        normal: normal.len(), lines, normal_lines })
}
/// Broken when a control fails; otherwise pass when caught ≥ needed and false alarms ≤ the maximum, else fail.
pub fn verdict(controls_hold: bool, c: &Counts, m: &Marks) -> &'static str {
    if !controls_hold { BROKEN } else if c.caught >= m.needed && c.false_alarms <= m.false_max { PASS } else { FAIL }
}
/// pass 0, fail 3, gate stop 4, anything else (broken) 1.
pub fn exit_code(v: &str) -> i32 { match v { PASS => 0, FAIL => 3, GATE_STOP => 4, _ => 1 } }

/// One positive control's line.
#[derive(Clone, Debug, PartialEq, Serialize)]
pub struct Control { pub name: String, pub what: String, pub got: String, pub holds: bool }
fn control(name: &str, what: &str, got: String, holds: bool) -> Control { Control { name: name.into(), what: what.into(), got, holds } }
pub type Mirror = dyn Fn(&[Pt], u32) -> Vec<Pt>;
/// C1: 50 SYNTHETIC faces, mirrored by `mirror` (production: `mirror_film`), judged by a shape scorer of 300 SYNTHETIC
/// faces; every one must read `mirrored`.
pub fn c1(mirror: &Mirror, tau: &RegionTau) -> anyhow::Result<Control> {
    let reference = WholeScorer::new(ceph_model::shape::synthetic_faces(C1_REFERENCE.0, C1_REFERENCE.1))?;
    let judged = ceph_model::shape::synthetic_faces(C1_JUDGED.0, C1_JUDGED.1);
    let mut n = 0;
    for face in &judged {
        let r = check_film(Some(&reference), &marks_of(&mirror(face, C1_FILM.0)), false, C1_FILM.0, C1_FILM.1, RegionLook::NotRun(Look::NoRegionModel), &FilmCal::tau_only(tau))?;
        if matches!(&r.check, FilmCheck::Flagged { reasons } if reasons.contains(&Reason::Mirrored)) { n += 1 }
    }
    Ok(control("C1", "50 SYNTHETIC faces mirrored, judged by 300 SYNTHETIC faces: 50 of 50 mirrored", format!("{n} of {} mirrored", judged.len()), n == judged.len() && n == C1_JUDGED.0))
}
fn has_region(r: &FilmResult, only: Option<Region>) -> bool {
    matches!(&r.check, FilmCheck::Flagged { reasons } if reasons.iter().any(|x| matches!(x, Reason::Region { region, .. } if only.is_none_or(|o| *region == o))))
}
fn is_flagged(r: &FilmResult) -> bool { matches!(r.check, FilmCheck::Flagged { .. }) }
/// C2: the control films' tracings × `factor` about the centroid: a region flag on all 10; untouched: not all 10 flagged.
pub fn c2(cases: &[(&Film, &RefSet)], factor: f64, tau: &RegionTau) -> anyhow::Result<Control> {
    let (mut hit, mut plain) = (0, 0);
    for (f, r) in cases {
        if has_region(&check(f, &scaled(&f.pts, factor), r, tau)?, None) { hit += 1 }
        if is_flagged(&check(f, &f.pts, r, tau)?) { plain += 1 }
    }
    let n = cases.len();
    Ok(control("C2", "10 control films' tracings x2: 10 of 10 region; unscaled: not all 10 flagged",
        format!("{hit} of {n} region at x{factor}; unscaled {plain} of {n} flagged"), n == CONTROL_FILMS && hit == n && plain < n))
}
/// C3: the mandible's points moved `shift_mm` forward (+x; the film's own scale): a mandible region flag on all 10;
/// unshifted: not all 10 flagged.
pub fn c3(cases: &[(&Film, &RefSet)], shift_mm: f64, tau: &RegionTau) -> anyhow::Result<Control> {
    let (mut hit, mut plain) = (0, 0);
    for (f, r) in cases {
        let mm = f.mm_per_px.context("a C3 film has no scale")?;
        if has_region(&check(f, &moved(&f.pts, Some(Region::Mandible), shift_mm / mm, 0.0), r, tau)?, Some(Region::Mandible)) { hit += 1 }
        if is_flagged(&check(f, &f.pts, r, tau)?) { plain += 1 }
    }
    let n = cases.len();
    Ok(control("C3", "the mandible moved 40 mm forward: 10 of 10 region (mandible); unshifted: not all 10",
        format!("{hit} of {n} mandible flags at {shift_mm} mm; unshifted {plain} of {n} flagged"), n == CONTROL_FILMS && hit == n && plain < n))
}
/// C4: (the film's regions, the regions on the film flipped): the detector's facing must be read on both and differ.
pub fn c4(pairs: &[(Regions, Regions)]) -> Control {
    let n = pairs.len();
    let flips = pairs.iter().filter(|(a, b)| matches!((a.facing_left, b.facing_left), (Some(x), Some(y)) if x != y)).count();
    control("C4", "the 10 control films flipped: the detector's facing flips on 10 of 10", format!("{flips} of {n} flipped"), n == CONTROL_FILMS && flips == n)
}
/// C5: Ceph-400 test2 and Aariz test are refused as held back (by the ledger and by the cache rule).
pub fn c5(ceph400: &Path, aariz: &Path) -> Control {
    let refused = |d: &Path, s: &str| [ledger::refuse_held_back(d, s), chainproof::refuse_held_back_cache(d, s)].iter()
        .all(|r| r.as_ref().is_err_and(|e| e.to_string().contains("held back")));
    let (a, b) = (refused(ceph400, "test2"), refused(aariz, "test"));
    control("C5", "Ceph-400 test2 and Aariz test refused", format!("test2 refused: {a}; Aariz test refused: {b}"), a && b)
}
/// C6: the film judged by a reference set holding its own tracing (the whole file) must be refused as homework.
pub fn c6(f: &Film, prior: &Prior, tau: &RegionTau) -> Control {
    let refused = RefSet::new(prior, &[]).and_then(|r| check(f, &f.pts, &r, tau)).is_err_and(|e| e.to_string().contains("homework"));
    control("C6", "a judged film planted into its own reference set is refused", format!("refused: {refused}"), refused)
}
/// C8: the control films' coordinates × `factor`: a region flag on all 10, and every one of the 19 points off the film.
pub fn c8(cases: &[(&Film, &RefSet)], factor: f64, tau: &RegionTau) -> anyhow::Result<Control> {
    let mut hit = 0;
    for (f, r) in cases {
        let p: Vec<Pt> = f.pts.iter().map(|q| (q.0 * factor, q.1 * factor)).collect();
        if has_region(&check(f, &p, r, tau)?, None) && p.iter().all(|q| off_film(*q, f.w, f.h)) { hit += 1 }
    }
    let n = cases.len();
    Ok(control("C8", "coordinates x1000: 10 of 10 region, every point off the film", format!("{hit} of {n} at x{factor}"), n == CONTROL_FILMS && hit == n))
}
/// C9: carried from the gate report.
pub fn c9(gate: &serde_json::Value) -> Control {
    let t = gate["controlTripped"] == serde_json::Value::Bool(true);
    control("C9", "carried from the gate report: control tripped", format!("controlTripped: {}", gate["controlTripped"]), t)
}

/// What SC1-1a requires of the gate report, the calibration and the detector (the pre-registration's `regions`).
#[derive(Clone, Debug, PartialEq)]
pub struct Pins { pub fingerprint: String, pub gate_report_sha256: String, pub score_line: f32, pub tau: [f64; 5], pub rule: String }
impl Pins {
    pub fn from_prereg() -> anyhow::Result<Pins> {
        let v: serde_json::Value = serde_json::from_str(PREREG)?;
        let g = &v["regions"];
        let mut tau = [f64::NAN; 5];
        for r in REGIONS { tau[r.index()] = g["tau"][serde_json::to_value(r)?.as_str().unwrap_or_default()].as_f64().unwrap_or(f64::NAN); }
        Ok(Pins { fingerprint: g["detectorFingerprint"].as_str().unwrap_or_default().into(), gate_report_sha256: g["gateReportSha256"].as_str().unwrap_or_default().into(),
            score_line: g["scoreLine"].as_f64().unwrap_or(f64::NAN) as f32, tau, rule: g["calibrationRule"].as_str().unwrap_or_default().into() })
    }
}
#[derive(Clone, Debug, PartialEq)]
pub enum Gate { Pass(serde_json::Value), Stop }
/// The gate report (the bytes of reports/sc1/box-gate-2.json): version sc1-box-gate/2 (the /1 report refused); a stop is
/// a stop; otherwise its SHA-256, verdict pass, C9 tripped, fingerprint, score line and τ must be the pinned ones.
pub fn check_gate(report: &[u8], pins: &Pins) -> anyhow::Result<Gate> {
    let v: serde_json::Value = serde_json::from_slice(report).context("the gate report is not JSON")?;
    ensure!(v["version"] == GATE_RULE, "the gate report is version {}: SC1-1a reads only {GATE_RULE}'s report (the sc1-box-gate/1 pair is refused)", v["version"]);
    if v["verdict"] == sc1_gate::STOP { return Ok(Gate::Stop) }
    let sha = ft_common::sha256_hex(report);
    ensure!(sha == pins.gate_report_sha256, "the gate report's SHA-256 is {sha}, the pre-registered one {}", pins.gate_report_sha256);
    ensure!(v["verdict"] == sc1_gate::PASS, "the gate report's verdict is {}, not pass", v["verdict"]);
    ensure!(v["controlTripped"] == serde_json::Value::Bool(true), "the gate report's C9 did not trip (controlTripped {}): the gate is blind", v["controlTripped"]);
    ensure!(v["detectorFingerprint"] == pins.fingerprint.as_str(), "the gate report is for detector {}, SC1-1a is pinned to {}", v["detectorFingerprint"], pins.fingerprint);
    ensure!(v["scoreLine"].as_f64().map(|x| x as f32) == Some(pins.score_line), "the gate report's score line is {}, the pinned one {}", v["scoreLine"], pins.score_line);
    for r in REGIONS {
        let got = v["tau"][serde_json::to_value(r)?.as_str().unwrap_or_default()].as_f64();
        ensure!(got == Some(pins.tau[r.index()]), "the gate report's {} tau is {got:?}, the pinned one {}", r.words(), pins.tau[r.index()]);
    }
    Ok(Gate::Pass(v))
}
/// The calibration in place (models/regions/calibration.json): rule sc1-box-gate/2 (the /1 file refused), and its
/// fingerprint, gate report SHA-256, score line and τ the pinned ones; the installed detector the pinned one too.
pub fn check_calibration(cal: &[u8], engine_fp: &str, pins: &Pins) -> anyhow::Result<RegionCalibration> {
    let c = parse_calibration(cal)?;
    ensure!(c.gate_rule() == pins.rule, "the calibration was set by {}, SC1-1a is pinned to {} (a /1 calibration is refused)", c.gate_rule(), pins.rule);
    ensure!(engine_fp == pins.fingerprint, "the installed region finder is {engine_fp}, SC1-1a is pinned to {}", pins.fingerprint);
    ensure!(c.detector_fingerprint == pins.fingerprint, "the calibration is for detector {}, SC1-1a is pinned to {}", c.detector_fingerprint, pins.fingerprint);
    ensure!(c.gate_report_sha256 == pins.gate_report_sha256, "the calibration names gate report {}, SC1-1a is pinned to {}", c.gate_report_sha256, pins.gate_report_sha256);
    ensure!(c.score_line == pins.score_line, "the calibration's score line is {}, the pinned one {}", c.score_line, pins.score_line);
    ensure!(c.tau.0 == pins.tau, "the calibration's tau {:?} is not the pinned {:?}", c.tau.0, pins.tau);
    Ok(c)
}

/// The region finder as SC1-1a uses it: its fingerprint, and its boxes per film (cached), on the film as stored or flipped.
pub trait Finder { fn fingerprint(&self) -> String; fn boxes(&self, data: &Path, split: &str, ids: &[String], flipped: bool) -> anyhow::Result<BTreeMap<String, Found>>; }
/// The real one: the installed model through `sc1_boxes::boxes_for` (cache under reports/sc1/boxes).
pub struct EngineFinder { pub engine: RegionEngine, pub cache: PathBuf }
impl Finder for EngineFinder {
    fn fingerprint(&self) -> String { self.engine.spec().fingerprint() }
    fn boxes(&self, data: &Path, split: &str, ids: &[String], flipped: bool) -> anyhow::Result<BTreeMap<String, Found>> { sc1_boxes::boxes_for(&self.engine, data, split, ids, &self.cache, flipped) }
}
fn regions_of(found: &Found, fp: &str, line: f32) -> anyhow::Result<Regions> {
    sc1_gate::best_scores(found)?;
    ensure!(found.fingerprint == fp, "a film's boxes are from detector {}, not {fp}", found.fingerprint);
    Regions::from_scored(&sc1_boxes::region_boxes(found), line, fp)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Sc1aReport {
    pub version: String, pub prereg_sha256: String, pub git_sha: String, pub detector_fingerprint: String, pub gate_report_sha256: String,
    pub calibration_rule: String, pub score_line: f32, pub tau: [f64; 5], pub prior_sha256: String, pub marks: Marks,
    pub counts: Counts, pub controls: Vec<Control>, pub shifts: Vec<Line>, pub box_quality: Vec<(String, Vec<BoxQuality>)>,
    pub real_runs: Vec<String>, pub seconds: f64, pub verdict: String,
}
fn fmt_line(l: &Line, of_what: &str) -> String {
    format!("{}: {} of {} {of_what} (mirrored {}, shape {}, region {}, facing {}, no-ceph-found {}; Stage A also flagged {})",
        l.label, l.flagged, l.cases, l.mirrored, l.shape, l.region, l.facing, l.no_ceph_found, l.stage_a)
}
fn num(x: f64) -> String { if x.is_finite() { format!("{x:.3}") } else { "none".into() } }
impl Sc1aReport {
    pub fn exit_code(&self) -> i32 { exit_code(&self.verdict) }
    /// The printed lines: counts only, never a film id.
    pub fn summary(&self) -> Vec<String> {
        let m = &self.marks;
        let c = &self.counts;
        let mut v = vec![
            format!("SC1-1a {} ({PREREG_PATH} sha256 {}); git HEAD {}; detector {}", self.version, self.prereg_sha256, self.git_sha, self.detector_fingerprint),
            format!("calibration rule {}; gate report {GATE_REPORT} sha256 {}; score line {:.2}; tau {}", self.calibration_rule, self.gate_report_sha256, self.score_line,
                REGIONS.iter().map(|r| format!("{} {:.2}", r.words(), self.tau[r.index()])).collect::<Vec<_>>().join(", ")),
            format!("films: Ceph-400 test1 {}, Aariz valid {} ({} with a scale under {}); shape reference sha256 {}", m.test1, m.valid, m.scaled_valid, scale::AARIZ_SCALE_RULE, self.prior_sha256),
            "planted faults (each type on its own line, information; no per-type floor):".into(),
        ];
        v.extend(c.lines.iter().map(|l| format!("  {}", fmt_line(l, "caught"))));
        v.push(format!("POOLED: caught {} of {} planted (needed {})", c.caught, c.planted, m.needed));
        v.push("untouched expert tracings:".into());
        v.extend(c.normal_lines.iter().map(|l| format!("  {}", fmt_line(l, "flagged (false alarms)"))));
        v.push(format!("FALSE ALARMS: {} of {} (at most {})", c.false_alarms, c.normal, m.false_max));
        v.push("note: P2 (another patient's tracing from the same machine) may be the weakest plant; P3 rests on the regions alone, because the shape look is scale-free".into());
        v.push("information, the whole tracing moved (films with a scale):".into());
        v.extend(self.shifts.iter().map(|l| format!("  {}", fmt_line(l, "flagged"))));
        for (name, q) in &self.box_quality {
            v.push(format!("information, box quality on {name}:"));
            for x in q {
                v.push(format!("  {:<20} films {:>3} not found {:>2} IoU median {} p90 {} centre error median {} p90 {} {}", x.region.words(), x.films, x.not_found,
                    num(x.iou_median), num(x.iou_p90), num(x.centre_err_median), num(x.centre_err_p90), if x.in_mm { "mm" } else { "(fraction of the expert box's longer side)" }));
            }
        }
        v.extend(self.real_runs.iter().map(|l| format!("information, {l}")));
        v.push("controls:".into());
        v.extend(self.controls.iter().map(|x| format!("  {} {}: {} -> {}", x.name, x.what, x.got, if x.holds { "holds" } else { "DOES NOT HOLD" })));
        v.push(format!("verdict {} (exit {}: 0 pass, 3 fail, 1 broken, 4 gate stop); {:.0} s", self.verdict, self.exit_code(), self.seconds));
        v
    }
}

/// The real-runs caches given with --cache: each header read alone and refused unless it is Ceph-400 test1 or Aariz
/// valid (Test2 and Aariz test as held back), before any film of any cache is read.
pub fn cache_headers(caches: &[PathBuf], ceph400: &Path, _aariz: &Path) -> anyhow::Result<Vec<(PathBuf, Dataset)>> {
    let mut out = Vec::new();
    for d in caches {
        let h = chainproof::cache_header(ceph400, d)?;                   // refuses by --ceph400's name and by the cache's own dataset
        let name = Path::new(&h.dataset).file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
        let ds = match (name.as_str(), h.split.to_lowercase().as_str()) {
            ("ceph400", "test1") => Dataset::Ceph400,
            ("aariz", "valid") => Dataset::Aariz,
            (n, s) => anyhow::bail!("{}: a {n} {s} cache; the real-runs line reads only SC1-1a's films (Ceph-400 test1, Aariz valid): refused", d.display()),
        };
        out.push((d.clone(), ds));
    }
    Ok(out)
}
/// Information: each model's real runs in the caches, judged by the check on the film's own boxes and reference set,
/// split by whether any point is more than 10 mm from the expert's.
pub fn real_runs(caches: &[(PathBuf, Dataset)], films: &[Film], refs: &Refs, tau: &RegionTau) -> anyhow::Result<Vec<String>> {
    if caches.is_empty() { return Ok(vec!["real runs: no cache was given (--cache), so no real-run flag rate".into()]) }
    let mut out = Vec::new();
    for (dir, ds) in caches {
        let (_, runs) = xcache::read_cache(dir)?;
        // model -> (far, far flagged, near, near flagged, no answer)
        let mut t: BTreeMap<String, [usize; 5]> = BTreeMap::new();
        let mut outside = 0;
        for run in &runs {
            let Some(f) = films.iter().find(|f| f.dataset == *ds && f.id == run.film) else { outside += 1; continue };
            for (model, res) in &run.models {
                let e = t.entry(model.clone()).or_default();
                let Ok(pts) = res else { e[4] += 1; continue };
                let marks: Vec<Mark> = ORDER.iter().filter_map(|n| pts.get(*n).map(|p| Mark { landmark_id: n.to_string(), x: p.x, y: p.y })).collect();
                let far = ORDER.iter().zip(&f.pts).any(|(n, q)| pts.get(*n).is_some_and(|p| ft_common::dist((p.x, p.y), *q) * run.mm_per_px > 10.0));
                let fl = is_flagged(&check_marks(f, &marks, refs.of(f), tau)?);
                if far { e[0] += 1; e[1] += fl as usize } else { e[2] += 1; e[3] += fl as usize }
            }
        }
        for (model, e) in t {
            out.push(format!("real runs, {model} on {}: more than 10 mm off: {} of {} flagged; all within 10 mm: {} of {} flagged; no answer {}; films outside SC1-1a's set {outside}",
                ds.words(), e[1], e[0], e[3], e[2], e[4]));
        }
    }
    Ok(out)
}

/// The expert tracing of `id` as 19 points in ORDER.
fn pts_of(gt: &dataset::Points, id: &str) -> anyhow::Result<Vec<Pt>> {
    let rows = gt.get(id).context("a judged film has no expert tracing")?;
    ORDER.iter().map(|n| rows.iter().find(|(p, _, _)| p == n).map(|(_, x, y)| (*x, *y)).context("an expert tracing lacks a point")).collect()
}
/// SC1-1a's judged films as loaded: Test1 sorted, its five folds, and every film (Test1 then Aariz valid, each sorted).
pub struct Judged { pub test1: Vec<String>, pub folds: Vec<Vec<String>>, pub films: Vec<Film> }
/// SC1-1a's films (shared with the development-film run, SC-1 Part 1b Task E): the lists (Test2 by film number, counts by
/// the marks), the complete expert tracings, the scales (Ceph-400 0.1 mm/px; Aariz valid under aariz-scale/1), the folds,
/// and each film's boxes from `finder` at `score_line` (detector `fp`). No film id is printed.
pub fn load_films(ceph400: &Path, aariz: &Path, m: &Marks, finder: &dyn Finder, fp: &str, score_line: f32) -> anyhow::Result<Judged> {
    let mut t1 = dataset::select(&dataset::load_splits(&ceph400.join("splits.json"))?, "test1")?;
    sc1_gate::refuse_outside_test1(&t1)?;
    t1.sort();
    ensure!(t1.windows(2).all(|w| w[0] != w[1]), "Ceph-400's test1 list names a film twice");
    counted("Ceph-400 test1 films", t1.len(), m.test1)?;
    ensure!(t1.len() % FOLDS == 0, "{} Test1 films do not split into {FOLDS} equal folds", t1.len());
    let (train, mut valid) = sc1_gate::aariz_train_valid(aariz)?;
    valid.sort();
    ensure!(valid.windows(2).all(|w| w[0] != w[1]), "Aariz's valid list names a film twice");
    let train: BTreeSet<String> = train.into_iter().collect();
    ensure!(valid.iter().all(|id| !train.contains(id)), "Aariz valid shares films with train: refused");
    counted("Aariz valid films", valid.len(), m.valid)?;
    // The expert tracings, complete; the scales.
    let c4_gt = dataset::load_points(&ceph400.join("gt.csv"))?;
    let az_gt = dataset::load_points(&aariz.join("gt.csv"))?;
    sc1_gate::complete(&c4_gt, &t1, "Ceph-400 test1")?;
    sc1_gate::complete(&az_gt, &valid, "Aariz valid")?;
    let spacing = dataset::load_spacing(&aariz.join("spacing.csv"))?;
    let header = scale::load_header_resolution(aariz)?;
    let scales: HashMap<String, f64> = scale::plan(&valid, &spacing, &header, &az_gt)?.films.into_iter().collect();
    counted(&format!("Aariz valid films with a scale ({})", scale::AARIZ_SCALE_RULE), scales.len(), m.scaled_valid)?;
    // The region finder: once per film (cached).
    let fs = folds(&t1);
    let c4_found = finder.boxes(ceph400, "test1", &t1, false)?;
    let az_found = finder.boxes(aariz, "valid", &valid, false)?;
    let mut films = Vec::new();
    for id in &t1 {
        let f = c4_found.get(id).context("a Test1 film has no boxes")?;
        films.push(Film { id: id.clone(), dataset: Dataset::Ceph400, fold: fs.iter().position(|x| x.contains(id)), pts: pts_of(&c4_gt, id)?, w: f.image_width, h: f.image_height,
            mm_per_px: Some(CEPH400_MM_PER_PX), regions: regions_of(f, fp, score_line)? });
    }
    for id in &valid {
        let f = az_found.get(id).context("an Aariz valid film has no boxes")?;
        films.push(Film { id: id.clone(), dataset: Dataset::Aariz, fold: None, pts: pts_of(&az_gt, id)?, w: f.image_width, h: f.image_height,
            mm_per_px: scales.get(id).copied(), regions: regions_of(f, fp, score_line)? });
    }
    ensure!(films.iter().filter(|f| f.dataset == Dataset::Ceph400).all(|f| f.fold.is_some()), "a Test1 film is in no fold");
    Ok(Judged { test1: t1, folds: fs, films })
}

enum Outcome { Stop, Report(Box<Sc1aReport>) }

#[allow(clippy::too_many_arguments)]
fn sc1a_run(ceph400: &Path, aariz: &Path, models: &Path, out: &Path, caches: &[PathBuf], git: &Git, pins: &Pins, m: &Marks, finder: &dyn Finder) -> anyhow::Result<Outcome> {
    let t0 = std::time::Instant::now();
    // C5: this run names only Ceph-400 test1 and Aariz valid (never test2 or test; the held-back rules are proved by C5 and
    // refused again by the box cache); the Test1 list is checked for Test2 numbers below. The cache headers alone first.
    ensure!(sc1_gate::is_ceph400(ceph400), "{}: SC1-1a reads Ceph-400 test1, and this folder is not Ceph-400", ceph400.display());
    ensure!(scale::is_aariz(aariz), "{}: SC1-1a reads Aariz valid, and this folder is not Aariz", aariz.display());
    let headers = cache_headers(caches, ceph400, aariz)?;
    // The pre-registration: committed as built, from a clean tree (its numbers equal the program's: the_preregistration_is_complete).
    ensure!(!git.dirty, "commit first: SC1-1a is pre-registered ({PREREG_PATH}) and runs only from a clean tree");
    ft_common::committed_as_built(PREREG_PATH, PREREG, git.prereg_at_head.clone())?;
    ensure!(pins.rule == GATE_RULE, "SC1-1a is pinned to {GATE_RULE}, not {}", pins.rule);
    sc1_data::ensure_outside_or_ignored(out)?;
    // The gate report (only box-gate-2.json): a stop is exit 4, nothing judged. Then the calibration and the detector.
    let gp = out.join(GATE_REPORT);
    let gate_bytes = std::fs::read(&gp).with_context(|| format!("{}: SC1-1a needs the gate /2 report", gp.display()))?;
    let gate = match check_gate(&gate_bytes, pins)? { Gate::Stop => return Ok(Outcome::Stop), Gate::Pass(v) => v };
    let fp = finder.fingerprint();
    let cp = calibration_path(models);
    let cal = check_calibration(&std::fs::read(&cp).with_context(|| cp.display().to_string())?, &fp, pins)?;
    let tau = cal.tau;
    // The lists (Test2 by film number, counts by the marks), then the reference tracings.
    let prior = pc::load_prior(&pc::prior_path(models))?;
    let Judged { test1: t1, folds: fs, films, .. } = load_films(ceph400, aariz, m, finder, &fp, cal.score_line)?;
    let ctrl = control_films(&t1);
    let flip_found = finder.boxes(ceph400, "test1", &ctrl, true)?;
    let refs = Refs::new(&prior, &fs)?;
    // The controls.
    let cf: Vec<&Film> = ctrl.iter().map(|id| films.iter().find(|f| f.dataset == Dataset::Ceph400 && &f.id == id).context("a control film is not judged")).collect::<anyhow::Result<_>>()?;
    let cases: Vec<(&Film, &RefSet)> = cf.iter().map(|f| (*f, refs.of(f))).collect();
    let flips: Vec<(Regions, Regions)> = cf.iter().map(|f| Ok((f.regions.clone(), regions_of(flip_found.get(&f.id).context("a control film has no flipped boxes")?, &fp, cal.score_line)?)))
        .collect::<anyhow::Result<_>>()?;
    let mut controls = vec![c1(&|p: &[Pt], w: u32| mirror_film(p, w), &tau)?, c2(&cases, C2_FACTOR, &tau)?, c3(&cases, C3_SHIFT_MM, &tau)?, c4(&flips), c5(ceph400, aariz), c6(cf[0], &prior, &tau)];
    // The plants (C7 on every count), the information shifts, the box quality, the real runs.
    let ps = plants(&films, &fs)?;
    let judged = judge_all(&films, &ps, &refs, &tau)?;
    let counts = count(&judged, m)?;
    controls.push(control("C7", "every count equals its expected total; a mark that counted nothing is an error",
        format!("planted {} of {}, untouched {} of {}, every type and dataset as expected", counts.planted, m.planted, counts.normal, m.normal), true));
    controls.push(c8(&cases, C8_FACTOR, &tau)?);
    controls.push(c9(&gate));
    let sh = info_shifts(&films)?;
    let sj = judge_all(&films, &sh, &refs, &tau)?;
    let shifts: Vec<Line> = SHIFTS_MM.iter().map(|s| line(&Kind::Shift(*s).label(), &sj.iter().filter(|c| c.kind == Kind::Shift(*s)).collect::<Vec<_>>())).collect();
    for l in &shifts { counted(&l.label, l.cases, m.test1 + m.scaled_valid)?; }
    let mut quality = Vec::new();
    for ds in [Dataset::Ceph400, Dataset::Aariz] {
        let fb: Vec<FilmBoxes> = films.iter().filter(|f| f.dataset == ds).map(|f| FilmBoxes { detected: f.regions.clone(),
            expert: teaching_boxes(&ORDER.iter().zip(&f.pts).map(|(n, p)| (n.to_string(), p.0, p.1)).collect::<Vec<_>>(), f.w, f.h), mm_per_px: f.mm_per_px }).collect();
        let n = fb.len();
        let label = match ds { Dataset::Ceph400 => format!("Ceph-400 test1 ({n} films; expert boxes from the 19 traced points only)"),
            Dataset::Aariz => format!("Aariz valid ({n} films; expert boxes from the 19 traced points only; centre error in mm only when every film has a scale)") };
        quality.push((label, box_quality(&fb)?));
    }
    let real = real_runs(&headers, &films, &refs, &tau)?;
    let holds = controls.iter().all(|c| c.holds);
    Ok(Outcome::Report(Box::new(Sc1aReport { version: VERSION.into(), prereg_sha256: ft_common::sha256_hex(PREREG.as_bytes()), git_sha: git.sha.clone(),
        detector_fingerprint: fp, gate_report_sha256: ft_common::sha256_hex(&gate_bytes), calibration_rule: cal.gate_rule().into(), score_line: cal.score_line,
        tau: tau.0, prior_sha256: prior.sha256.clone(), marks: *m, verdict: verdict(holds, &counts, m).into(), counts, controls, shifts, box_quality: quality,
        real_runs: real, seconds: t0.elapsed().as_secs_f64() })))
}

/// The run on given folders, git state, pins, marks and region finder: prints every line and writes `<out>/sc1-1a.json`
/// (pass, fail, or broken by a control). Exit 0 pass, 3 fail, 4 gate stop (nothing judged, nothing written), 1 broken
/// (on an error nothing is written).
#[allow(clippy::too_many_arguments)]
pub fn run_with(ceph400: &Path, aariz: &Path, models: &Path, out: &Path, caches: &[PathBuf], git: &Git, pins: &Pins, marks: &Marks, finder: &dyn Finder) -> anyhow::Result<i32> {
    println!("SC1-1a: Ceph-400 folder {}; Aariz folder {}", ceph400.display(), aariz.display());
    let rep = match sc1a_run(ceph400, aariz, models, out, caches, git, pins, marks, finder) {
        Ok(Outcome::Report(r)) => r,
        Ok(Outcome::Stop) => { println!("SC1-1a: the gate report's verdict is stop: no verdict, SC1-1a not failed, nothing judged (exit 4: to the owner)"); return Ok(4) }
        Err(e) => { eprintln!("SC1-1a broken (nothing written, nothing concluded): {e:#}"); return Ok(1) }
    };
    for l in rep.summary() { println!("{l}"); }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let path = out.join(REPORT);
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {})", path.display(), ft_common::sha256_hex(text.as_bytes()));
    Ok(rep.exit_code())
}

/// `--sc1-1a`: the git state, the pre-registration's pins, the installed region finder, then `run_with` on the real marks.
pub fn run_cli(ceph400: &Path, aariz: &Path, models: &Path, out: &Path, caches: &[PathBuf]) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Git, Pins, EngineFinder)> {
        let engine = RegionEngine::load(&regions_manifest_path(models))?;
        Ok((sc1_gate::git_state(PREREG_PATH)?, Pins::from_prereg()?, EngineFinder { engine, cache: out.join("boxes") }))
    };
    match pre() {
        Ok((git, pins, finder)) => run_with(ceph400, aariz, models, out, caches, &git, &pins, &Marks::real(), &finder),
        Err(e) => { eprintln!("SC1-1a broken (nothing written, nothing concluded): {e:#}"); Ok(1) }
    }
}

#[cfg(test)]
#[path = "sc1_1a_tests.rs"]
pub(crate) mod tests;
