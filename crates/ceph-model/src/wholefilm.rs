//! SC-1 Part 1, the whole-film check (design §3, §11):
//! rule `whole-film/2` (whole-film/1 plus the size look and the cranial-base centre; the app writes `/2` from Task D2). This part: the shape look. Construct: how unlike the expert tracings is this tracing's WHOLE
//! shape, once position, turn and size are taken out; and does it fit much better mirrored? Method: the present points
//! (at least 12 of the 19) aligned to the experts' mean by a similarity (shift, turn, size; never a mirror; Gower 1975),
//! the Mahalanobis D² against the experts' Ledoit–Wolf spread (Ledoit & Wolf 2004), and the same for the tracing
//! mirrored. Not Stage A's conditional rings: nothing is conditioned, so nothing widens with leverage (Stage A's blind
//! spot, POINT-CHECK-METHODOLOGY §4(4a)). Scale-free: no film scale is read anywhere here (owner ruling OQ-8). A note,
//! never a verdict; nothing here moves a point.
use crate::linalg;
use crate::pointcheck::{Mark, Prior, MIN_POINTS, ORDER};
use crate::shape::{fit_sim, gpa, ledoit_wolf, Pt};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};

/// The rule the app writes on every new check. whole-film/3 (owner ruling, 5 Nov 2026, spec §17.15): whole-film/2's looks
/// with gate /4's tolerances and the centre line 0.08 by ruling (both read from the calibration files). Rows written
/// earlier keep the rule they were written under (`whole-film/1` or `/2`).
pub const RULE_VERSION: &str = "whole-film/3";
/// The line's leave-one-out percentile (spec §3.1 step 5), by nearest rank: the ⌈995 n / 1000⌉-th smallest value.
pub const LINE_PER_MILLE: usize = 995;
/// The fewest reference tracings a shape fit accepts.
pub const MIN_TRACINGS: usize = 20;
/// The ratios and angles the note may name (spec §3.2; fixed here). Indices into ORDER: S 0, N 1, A 4, B 5, Me 7, Go 9, Ar 18.
pub const MEASURES: [&str; 5] = ["S–N to N–Me", "SNA", "SNB", "ANB", "gonial angle (Ar–Go–Me)"];

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShapeVerdict { pub d2: f64, pub d2_mirror: f64, pub line: f64, pub mirrored: bool, pub unusual: bool, pub present: usize }

/// One set of present points' fit: the mean (aligned frame), the spread's mean vector and Cholesky factor.
struct Fit { mean: Vec<Pt>, mu: Vec<f64>, chol: Vec<f64> }
fn fit(train: &[Vec<Pt>], present: &[usize]) -> anyhow::Result<Fit> {
    let sub: Vec<Vec<Pt>> = train.iter().map(|t| present.iter().map(|&k| t[k]).collect()).collect();
    let (mean, sims) = gpa(&sub)?;
    let y: Vec<Vec<f64>> = sub.iter().zip(&sims).map(|(s, t)| s.iter().flat_map(|p| { let q = t.apply(*p); [q.0, q.1] }).collect()).collect();
    let (mu, cov, _) = ledoit_wolf(&y)?;
    let chol = linalg::cholesky(&cov, mu.len())?;
    Ok(Fit { mean, mu, chol })
}
/// D² of `pts` (the present points, in the fit's order) after a similarity onto the fit's mean.
fn d2_in(f: &Fit, pts: &[Pt]) -> f64 {
    let s = fit_sim(pts, &f.mean);
    let e: Vec<f64> = pts.iter().flat_map(|p| { let q = s.apply(*p); [q.0, q.1] }).zip(&f.mu).map(|(a, m)| a - m).collect();
    let z = linalg::chol_solve(&f.chol, e.len(), &e);
    e.iter().zip(&z).map(|(a, b)| a * b).sum()
}
/// The nearest-rank percentile of `sorted` (ascending): the ⌈per_mille · n / 1000⌉-th smallest value (1-based).
pub fn nearest_rank(sorted: &[f64], per_mille: usize) -> anyhow::Result<f64> {
    anyhow::ensure!(!sorted.is_empty(), "no values to take a percentile of");
    anyhow::ensure!((1..=1000).contains(&per_mille), "a per-mille rank must be 1 to 1000, not {per_mille}");
    Ok(sorted[(per_mille * sorted.len()).div_ceil(1000) - 1])
}
/// The smallest k/10 that is ≥ x (exact on tenths).
pub fn ceil_tenth(x: f64) -> f64 { let k = (x * 10.0).ceil(); if (k - 1.0) / 10.0 >= x { (k - 1.0) / 10.0 } else { k / 10.0 } }
/// `present` must be ascending (so unique), non-empty indices into the 19.
fn check_present(present: &[usize]) -> anyhow::Result<()> {
    anyhow::ensure!(present.windows(2).all(|w| w[0] < w[1]) && present.last().is_some_and(|&k| k < 19), "the present points must be ascending indices into the 19");
    Ok(())
}
fn mask(present: &[usize]) -> u32 { present.iter().fold(0u32, |m, j| m | 1 << j) }

/// The marks (film px, the film as stored) as 19 points in ORDER, faced right (x' = (w − 1) − x on a left-facing film).
/// Ids outside the 19 are ignored; a duplicate or a coordinate that is not a number is an error (as Stage A).
pub fn points_of(marks: &[Mark], facing_left: bool, img_w: u32) -> anyhow::Result<Vec<Option<Pt>>> {
    let flip = |x: f64| if facing_left { (img_w as f64 - 1.0) - x } else { x };
    let mut pts: Vec<Option<Pt>> = vec![None; 19];
    for m in marks {
        let Some(k) = ORDER.iter().position(|id| *id == m.landmark_id) else { continue };
        anyhow::ensure!(m.x.is_finite() && m.y.is_finite(), "{} is not a number ({}, {})", m.landmark_id, m.x, m.y);
        anyhow::ensure!(pts[k].is_none(), "{} is given twice", m.landmark_id);
        pts[k] = Some((flip(m.x), m.y));
    }
    Ok(pts)
}
fn angle(at: Pt, a: Pt, b: Pt) -> f64 {
    let (u, v) = ((a.0 - at.0, a.1 - at.1), (b.0 - at.0, b.1 - at.1));
    (u.0 * v.1 - u.1 * v.0).atan2(u.0 * v.0 + u.1 * v.1).abs().to_degrees()
}
/// The five measures (spec §3.2), each None when one of its points is absent. All are ratios or angles: scale-free.
pub fn measure_values(p: &[Option<Pt>]) -> [Option<f64>; 5] {
    let g = |i: usize| p[i];
    let d = |a: Pt, b: Pt| (a.0 - b.0).hypot(a.1 - b.1);
    let sna = g(1).zip(g(0)).zip(g(4)).map(|((n, s), a)| angle(n, s, a));
    let snb = g(1).zip(g(0)).zip(g(5)).map(|((n, s), b)| angle(n, s, b));
    [g(0).zip(g(1)).zip(g(7)).map(|((s, n), me)| d(s, n) / d(n, me)), sna, snb, sna.zip(snb).map(|(a, b)| a - b),
     g(9).zip(g(18)).zip(g(7)).map(|((go, ar), me)| angle(go, ar, me))]
}

pub struct WholeScorer { train: Vec<Vec<Pt>>, names: Vec<String>, fits: Mutex<HashMap<u32, Arc<Fit>>>, lines: Mutex<HashMap<u32, f64>>, measures: [(f64, f64); 5] }
/// Debug shows the size and the names only (the caches and tracings are not printed).
impl std::fmt::Debug for WholeScorer {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WholeScorer").field("films", &self.train.len()).field("names", &self.names).finish_non_exhaustive()
    }
}
impl WholeScorer {
    pub fn new(train: Vec<Vec<Pt>>) -> anyhow::Result<Self> {
        let names = (1..=train.len()).map(|i| format!("{i:03}")).collect();
        Self::with_names(train, names)
    }
    pub fn from_prior(p: &Prior) -> anyhow::Result<Self> { Self::with_names(p.tracings.clone(), p.names.clone()) }
    fn with_names(train: Vec<Vec<Pt>>, names: Vec<String>) -> anyhow::Result<Self> {
        anyhow::ensure!(train.len() >= MIN_TRACINGS, "the shape look needs at least {MIN_TRACINGS} reference tracings, not {}", train.len());
        anyhow::ensure!(names.len() == train.len(), "{} names for {} tracings", names.len(), train.len());
        for (n, t) in names.iter().zip(&train) {
            anyhow::ensure!(t.len() == 19 && t.iter().all(|p| p.0.is_finite() && p.1.is_finite()), "reference tracing {n} must have 19 points that are numbers");
        }
        let mut measures = [(0.0, 0.0); 5];
        let vals: Vec<[Option<f64>; 5]> = train.iter().map(|t| measure_values(&t.iter().map(|p| Some(*p)).collect::<Vec<_>>())).collect();
        for (i, m) in measures.iter_mut().enumerate() {
            let v: Vec<f64> = vals.iter().filter_map(|x| x[i]).collect();
            let mean = v.iter().sum::<f64>() / v.len() as f64;
            let sd = (v.iter().map(|x| (x - mean).powi(2)).sum::<f64>() / (v.len() - 1) as f64).sqrt();
            anyhow::ensure!(sd.is_finite() && sd > 0.0, "{} has no spread across the reference tracings", MEASURES[i]);
            *m = (mean, sd);
        }
        Ok(WholeScorer { train, names, fits: Mutex::new(HashMap::new()), lines: Mutex::new(HashMap::new()), measures })
    }
    pub fn films(&self) -> usize { self.train.len() }
    pub fn names(&self) -> &[String] { &self.names }
    pub fn leave_out(&self, films: &[usize]) -> anyhow::Result<Self> {
        let mut seen = std::collections::BTreeSet::new();
        for &i in films {
            anyhow::ensure!(i < self.train.len(), "tracing {i} does not exist ({} tracings)", self.train.len());
            anyhow::ensure!(seen.insert(i), "tracing {i} is left out twice");
        }
        let keep: Vec<usize> = (0..self.train.len()).filter(|i| !seen.contains(i)).collect();
        Self::with_names(keep.iter().map(|&i| self.train[i].clone()).collect(), keep.iter().map(|&i| self.names[i].clone()).collect())
    }
    /// The fit for one set of present points (ascending), cached. Cheap: one Procrustes and one spread.
    fn fitted(&self, present: &[usize]) -> anyhow::Result<Arc<Fit>> {
        check_present(present)?;
        let key = mask(present);
        if let Some(f) = self.fits.lock().map_err(|_| anyhow::anyhow!("the whole-film check's cache is poisoned"))?.get(&key) { return Ok(f.clone()); }
        let out = Arc::new(fit(&self.train, present)?);
        self.fits.lock().map_err(|_| anyhow::anyhow!("the whole-film check's cache is poisoned"))?.insert(key, out.clone());
        Ok(out)
    }
    /// The line for one set of present points, cached separately (it costs n fits): each reference tracing scored
    /// against a fit on all the others (leave one out), the ⌈995 n / 1000⌉-th smallest, rounded up to a tenth.
    pub fn line_for(&self, present: &[usize]) -> anyhow::Result<f64> {
        check_present(present)?;                                                 // before the cache: a mask is not a list
        let key = mask(present);
        if let Some(l) = self.lines.lock().map_err(|_| anyhow::anyhow!("the whole-film check's cache is poisoned"))?.get(&key) { return Ok(*l); }
        let n = self.train.len();
        let mut loo = Vec::with_capacity(n);
        for i in 0..n {
            let rest: Vec<Vec<Pt>> = self.train.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, t)| t.clone()).collect();
            loo.push(d2_in(&fit(&rest, present)?, &present.iter().map(|&k| self.train[i][k]).collect::<Vec<_>>()));
        }
        loo.sort_by(f64::total_cmp);
        let line = ceil_tenth(nearest_rank(&loo, LINE_PER_MILLE)?);
        self.lines.lock().map_err(|_| anyhow::anyhow!("the whole-film check's cache is poisoned"))?.insert(key, line);
        Ok(line)
    }
    pub fn d2_of(&self, pts: &[Pt], present: &[usize]) -> anyhow::Result<f64> {
        anyhow::ensure!(pts.len() == 19, "a tracing must be 19 points in ORDER, not {}", pts.len());
        let f = self.fitted(present)?;
        Ok(d2_in(&f, &present.iter().map(|&k| pts[k]).collect::<Vec<_>>()))
    }
    /// Fits, ahead of a check, the line `shape` will need for these marks (their present-point set), so the check
    /// itself reads it from the cache. Changes no number: the line is the same whenever and wherever it is fitted. Ok(None):
    /// too few points, nothing to fit; Ok(Some(present)): the set whose line is now cached.
    pub fn warm(&self, marks: &[Mark], facing_left: bool, img_w: u32) -> anyhow::Result<Option<Vec<usize>>> {
        let (_, present) = self.present_of(marks, facing_left, img_w)?;
        if present.len() < MIN_POINTS { return Ok(None); }
        self.line_for(&present)?;
        Ok(Some(present))
    }
    /// The marks as 19 points (faced right) and their present set: the one derivation `shape` and `warm` share, so the
    /// set warmed is the set the check looks up.
    fn present_of(&self, marks: &[Mark], facing_left: bool, img_w: u32) -> anyhow::Result<(Vec<Option<Pt>>, Vec<usize>)> {
        let p = points_of(marks, facing_left, img_w)?;
        let present: Vec<usize> = (0..19).filter(|&k| p[k].is_some()).collect();
        Ok((p, present))
    }
    /// The present-point sets whose lines are cached (each ascending; the sets sorted), for logs and tests.
    pub fn cached_line_sets(&self) -> Vec<Vec<usize>> {
        let mut v: Vec<Vec<usize>> = self.lines.lock().map(|m| m.keys().map(|&k| (0..19).filter(|j| k & (1 << j) != 0).collect()).collect()).unwrap_or_default();
        v.sort();
        v
    }
    pub fn shape(&self, marks: &[Mark], facing_left: bool, img_w: u32) -> anyhow::Result<Option<ShapeVerdict>> {
        let (p, present) = self.present_of(marks, facing_left, img_w)?;
        if present.len() < MIN_POINTS { return Ok(None); }
        let cur: Vec<Pt> = p.iter().map(|q| q.unwrap_or((f64::NAN, f64::NAN))).collect();
        let mir: Vec<Pt> = cur.iter().map(|q| (-q.0, q.1)).collect();           // turned over: Procrustes never mirrors
        let (d2, d2_mirror, line) = (self.d2_of(&cur, &present)?, self.d2_of(&mir, &present)?, self.line_for(&present)?);
        let mirrored = d2 > line && d2_mirror <= line;
        Ok(Some(ShapeVerdict { d2, d2_mirror, line, mirrored, unusual: d2 > line && !mirrored, present: present.len() }))
    }
    pub fn named(&self, marks: &[Mark], facing_left: bool, img_w: u32) -> anyhow::Result<Vec<&'static str>> {
        let v = measure_values(&points_of(marks, facing_left, img_w)?);
        let mut z: Vec<(f64, &'static str)> = (0..5).filter_map(|i| v[i].map(|x| (((x - self.measures[i].0) / self.measures[i].1).abs(), MEASURES[i]))).collect();
        z.sort_by(|a, b| b.0.total_cmp(&a.0));
        Ok(z.into_iter().take(2).map(|(_, n)| n).collect())
    }
}

// ---- The whole-film reference (SC-1 Part 1b, spec §17.4, owner ruling R1b-4): `whole-film-reference/1` ----
//
// The shape look's own reference file, separate from Stage A's `ceph400-v1.shape` (which keeps its 300 tracings and its
// numbers). It holds 1,000 expert tracings: Ceph-400 Train 001-150 and Test1 151-300 (named `ceph400:NNN`) and all 700
// Aariz train tracings (named `aariz:<id>`), each 19 points in ORDER, film px, facing right; and the line for the full 19
// points and for each 18-point set, stored so the app never fits them (each costs one fit per reference tracing). Names
// carry their dataset so the homework guard can tell a Ceph-400 film from an Aariz one, and a PKU name is refused.

pub const REFERENCE_VERSION: &str = "whole-film-reference/1";
pub const REFERENCE_SOURCE: &str = "Ceph-400 expert tracings Train 001-150 and Test1 151-300 (senior doctor), and all 700 Aariz train tracings (mean of senior and junior orthodontists); Test2, Aariz valid and Aariz test never read; PKU never read. Point coordinates only.";

/// `<models>/shape/whole-film-reference-v1.shape`, joins only (Windows-ready).
pub fn reference_path(models: &std::path::Path) -> std::path::PathBuf { models.join("shape").join("whole-film-reference-v1.shape") }

/// The loaded reference: the file's SHA-256, each tracing's name (file order), its 19 points, and the stored lines.
#[derive(Clone, Debug, PartialEq)]
pub struct Reference { pub sha256: String, pub names: Vec<String>, pub tracings: Vec<Vec<Pt>>, pub lines: Vec<(Vec<usize>, f64)> }

/// The point sets whose lines the file stores: the full 19, then each 18 (19 sets) in ascending order (each set
/// ascending; the sets compared as lists, so the set without point 18 comes first and the set without point 0 last).
pub fn stored_line_sets() -> Vec<Vec<usize>> {
    let mut eighteen: Vec<Vec<usize>> = (0..19).map(|k| (0..19).filter(|&j| j != k).collect()).collect();
    eighteen.sort();
    std::iter::once((0..19).collect()).chain(eighteen).collect()
}

/// A reference tracing's name: `ceph400:NNN` (001-300: Train and Test1) or `aariz:<id>`. A PKU name, a Test2 number
/// (301-400) and any other dataset are refused, each in words.
fn check_name(n: &str) -> anyhow::Result<()> {
    let Some((ds, id)) = n.split_once(':') else { anyhow::bail!("{n:?} names no dataset: a reference tracing is named ceph400:NNN or aariz:<id>") };
    match ds {
        "pku" => anyhow::bail!("{n} is a PKU film: PKU is the sealed test set (spec §17.7) and never enters the reference"),
        "ceph400" => {
            anyhow::ensure!(id.len() == 3 && id.bytes().all(|b| b.is_ascii_digit()), "{n:?} is not a Ceph-400 name (ceph400:001 to ceph400:300)");
            let k: u32 = id.parse()?;
            anyhow::ensure!((1..=300).contains(&k), "{}", if (301..=400).contains(&k) { format!("{n} is a Test2 film (301-400): Test2 is never read into the reference") }
                else { format!("{n:?} is not a Ceph-400 name (ceph400:001 to ceph400:300)") });
        }
        "aariz" => anyhow::ensure!(!id.is_empty() && !id.chars().any(|c| c.is_whitespace() || matches!(c, ':' | ',' | '"' | '/' | '\\')),
            "{n:?} is not an Aariz name (aariz:<the film's id>)"),
        _ => anyhow::bail!("{n:?}: the reference names only ceph400:NNN and aariz:<id> tracings"),
    }
    Ok(())
}

/// The checks shared by writing, reading and `from_reference`: at least MIN_TRACINGS tracings; each name valid and given
/// once; each tracing 19 points that are numbers; the lines either exactly `stored_line_sets()` in order (each a positive
/// number), or, only where `lines_may_be_empty`, none at all (each then fitted on first use).
fn check_reference(names: &[String], tracings: &[Vec<Pt>], lines: &[(Vec<usize>, f64)], lines_may_be_empty: bool) -> anyhow::Result<()> {
    anyhow::ensure!(names.len() == tracings.len(), "{} names for {} tracings", names.len(), tracings.len());
    anyhow::ensure!(names.len() >= MIN_TRACINGS, "the reference needs at least {MIN_TRACINGS} tracings, not {}", names.len());
    let mut seen = std::collections::BTreeSet::new();
    for (n, t) in names.iter().zip(tracings) {
        check_name(n)?;
        anyhow::ensure!(seen.insert(n.as_str()), "{n} is given twice");
        anyhow::ensure!(t.len() == 19, "{n} has {} points; every reference tracing must have all 19 ({})", t.len(), ORDER.join(", "));
        for (k, p) in t.iter().enumerate() {
            anyhow::ensure!(p.0.is_finite() && p.1.is_finite(), "{n}: {} is not a number ({}, {})", ORDER[k], p.0, p.1);
        }
    }
    if lines.is_empty() && lines_may_be_empty { return Ok(()); }
    let want = stored_line_sets();
    anyhow::ensure!(lines.len() == want.len() && lines.iter().zip(&want).all(|((s, _), w)| s == w),
        "the reference stores lines for {} point sets; it must store exactly the full 19 and each 18 (20 sets), in that order", lines.len());
    for (s, l) in lines {
        anyhow::ensure!(l.is_finite() && *l > 0.0, "the stored line for the {} points {:?} is {l}, not a positive number", s.len(), s);
    }
    Ok(())
}

#[derive(Serialize)]
struct RefFile { version: String, source: String, order: Vec<String>, films: usize, tracings: Vec<RefTracing>, lines: Vec<RefLine> }
#[derive(Serialize)]
struct RefTracing { name: String, points: Vec<[f64; 2]> }
#[derive(Serialize)]
struct RefLine { points: Vec<usize>, line: f64 }
/// Reading: every number kept as its literal text and parsed by `str::parse::<f64>` (correctly rounded), so it reads
/// back to the last bit what serde_json wrote (as `parse_prior`; serde_json's default f64 parser can miss by 1 ULP).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RefFileIn { #[allow(dead_code)] version: String, #[allow(dead_code)] source: String, order: Vec<String>, films: usize, tracings: Vec<RefTracingIn>, lines: Vec<RefLineIn> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RefTracingIn { name: String, points: Vec<[Box<serde_json::value::RawValue>; 2]> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RefLineIn { points: Vec<usize>, line: Box<serde_json::value::RawValue> }

/// The file's text. Refused unless the names, tracings and lines pass `check_reference` (the 20 lines required).
pub fn reference_json(names: &[String], tracings: &[Vec<Pt>], lines: &[(Vec<usize>, f64)]) -> anyhow::Result<String> {
    check_reference(names, tracings, lines, false)?;
    let f = RefFile {
        version: REFERENCE_VERSION.into(), source: REFERENCE_SOURCE.into(), order: ORDER.iter().map(|s| s.to_string()).collect(),
        films: names.len(),
        tracings: names.iter().zip(tracings).map(|(n, t)| RefTracing { name: n.clone(), points: t.iter().map(|p| [p.0, p.1]).collect() }).collect(),
        lines: lines.iter().map(|(s, l)| RefLine { points: s.clone(), line: *l }).collect(),
    };
    Ok(serde_json::to_string_pretty(&f)? + "\n")
}

/// The file's bytes, read and checked: version first, no unknown field, the 19 names in ORDER, the film count, every
/// number read to the last bit, and `check_reference` (the 20 lines required).
pub fn parse_reference(bytes: &[u8]) -> anyhow::Result<Reference> {
    let v: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| anyhow::anyhow!("not a whole-film reference file ({e})"))?;
    let version = v.get("version").and_then(|x| x.as_str()).unwrap_or("(none)");
    anyhow::ensure!(version == REFERENCE_VERSION, "version {version:?} is not {REFERENCE_VERSION}, the only version this app reads");
    let f: RefFileIn = serde_json::from_slice(bytes).map_err(|e| anyhow::anyhow!("not a {REFERENCE_VERSION} file ({e})"))?;
    anyhow::ensure!(f.order.iter().map(String::as_str).eq(ORDER.iter().copied()), "the point order is {:?}, not the check's order {:?}", f.order, ORDER);
    anyhow::ensure!(f.films == f.tracings.len(), "the file says {} films and holds {} tracings", f.films, f.tracings.len());
    let num = |what: &str, raw: &serde_json::value::RawValue| -> anyhow::Result<f64> {
        raw.get().parse::<f64>().map_err(|_| anyhow::anyhow!("{what} has {} where a number should be; not a number", raw.get()))
    };
    let tracings: Vec<Vec<Pt>> = f.tracings.iter().map(|t| t.points.iter().enumerate().map(|(k, p)| {
        let what = format!("{} {}", t.name, ORDER.get(k).copied().unwrap_or("a point past the 19th"));
        Ok((num(&what, &p[0])?, num(&what, &p[1])?))
    }).collect::<anyhow::Result<Vec<Pt>>>()).collect::<anyhow::Result<_>>()?;
    let lines: Vec<(Vec<usize>, f64)> = f.lines.iter().map(|l| Ok((l.points.clone(), num("a stored line", &l.line)?))).collect::<anyhow::Result<_>>()?;
    let names: Vec<String> = f.tracings.iter().map(|t| t.name.clone()).collect();
    check_reference(&names, &tracings, &lines, false)?;
    Ok(Reference { sha256: crate::install::sha256_bytes(bytes), names, tracings, lines })
}

/// The reference's name for a film: ("ceph400", "151") -> "ceph400:151"; ("aariz", id) -> "aariz:<id>"; ("pku", id) ->
/// "pku:<id>" (made only so that a PKU name can be looked for and refused). Any other dataset: an error. (M16)
pub fn reference_name(dataset: &str, id: &str) -> anyhow::Result<String> {
    anyhow::ensure!(matches!(dataset, "ceph400" | "aariz" | "pku"), "{dataset:?} is not a dataset the reference names (ceph400, aariz; pku only to be refused)");
    anyhow::ensure!(!id.is_empty(), "a {dataset} film with no id has no reference name");
    Ok(format!("{dataset}:{id}"))
}

impl WholeScorer {
    /// The scorer over the reference's tracings, by name, with the stored lines seeded in the line cache (each read from
    /// the file, never refitted). With `r.lines` empty, every line is fitted fresh on first use.
    pub fn from_reference(r: &Reference) -> anyhow::Result<Self> {
        check_reference(&r.names, &r.tracings, &r.lines, true)?;
        let s = Self::with_names(r.tracings.clone(), r.names.clone())?;
        {
            let mut m = s.lines.lock().map_err(|_| anyhow::anyhow!("the whole-film check's cache is poisoned"))?;
            for (set, l) in &r.lines { check_present(set)?; m.insert(mask(set), *l); }
        }
        Ok(s)
    }
    /// `leave_out` by name (M17): an unknown or repeated name is an error naming it; names match exactly, prefix and all.
    /// The stored lines are NOT carried over (a smaller reference has its own lines, fitted on first use).
    pub fn leave_out_names(&self, names: &[String]) -> anyhow::Result<Self> {
        let mut idx = Vec::with_capacity(names.len());
        for n in names {
            let i = self.names.iter().position(|m| m == n).ok_or_else(|| anyhow::anyhow!("the reference holds no tracing named {n}"))?;
            anyhow::ensure!(!idx.contains(&i), "{n} is left out twice");
            idx.push(i);
        }
        self.leave_out(&idx)
    }
}

// ---- Regions, facing and the whole check (spec §3.3–3.5, §11, §12) ----
//
// Construct (regions): how far outside its region's box does this point lie, relative to the box's size? Method: the
// Euclidean distance from the point to the box (0 inside or on an edge) ÷ the box's longer side; no film scale. The
// boxes are found on this film by the region finder (Task 4), which learned them from boxes drawn round Aariz's expert
// points by `teaching_boxes`. Construct (facing): three witnesses (the stored facing, the detector's boxes, the tracing's
// better fit as is or mirrored) must agree. Construct (box quality): the IoU and the centre error of a detected box
// against the box the teaching rule draws round the experts' points. Part 2 reads `Region`, `RegionBox`, `Regions`,
// `REGION_OF` and `outside_ratio` for its search area: they are public and stable.

/// The five point-bearing regions, in the canonical order (ruling P13): every array indexed by region uses it.
/// Serde (IPC) names are camelCase; the stored keys are `key()`'s kebab-case (ruling P14).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Region { CranialBase, Maxilla, Mandible, Incisors, SoftTissue }
pub const REGIONS: [Region; 5] = [Region::CranialBase, Region::Maxilla, Region::Mandible, Region::Incisors, Region::SoftTissue];
impl Region {
    /// The stored key (library, report, CSV `region-<key>`).
    pub fn key(self) -> &'static str {
        match self { Region::CranialBase => "cranial-base", Region::Maxilla => "maxilla", Region::Mandible => "mandible", Region::Incisors => "incisors", Region::SoftTissue => "soft-tissue" }
    }
    /// The words on screen (plan, Global Constraints).
    pub fn words(self) -> &'static str {
        match self { Region::CranialBase => "cranial base", Region::Maxilla => "maxilla", Region::Mandible => "mandible", Region::Incisors => "incisors", Region::SoftTissue => "soft-tissue profile" }
    }
    pub fn index(self) -> usize { self as usize }
    pub fn from_key(k: &str) -> Option<Region> { REGIONS.into_iter().find(|r| r.key() == k) }
}
/// Each of the 19 traced points in exactly one region (spec §3.3; plan, Global Constraints, in the table's order).
pub const REGION_OF: [(&str, Region); 19] = [
    ("S", Region::CranialBase), ("N", Region::CranialBase), ("Po", Region::CranialBase), ("Ar", Region::CranialBase), ("Or", Region::CranialBase),
    ("A", Region::Maxilla), ("ANS", Region::Maxilla), ("PNS", Region::Maxilla),
    ("Go", Region::Mandible), ("Me", Region::Mandible), ("Pog", Region::Mandible), ("B", Region::Mandible), ("Gn", Region::Mandible),
    ("U1T", Region::Incisors), ("L1T", Region::Incisors),
    ("Sn", Region::SoftTissue), ("UL", Region::SoftTissue), ("LL", Region::SoftTissue), ("PogS", Region::SoftTissue)];
/// Extra Aariz points (our names) used only to draw the teaching boxes: U6 = `UMT`, U1A = `UIA`, L6 = `LMT`,
/// L1A = `LIA`, Ns = `` N` ``, Prn = `Pn`. Never checked: a tracing has none of them.
pub const TEACH_EXTRA: [(&str, Region); 8] = [("U6", Region::Maxilla), ("U1A", Region::Maxilla), ("L6", Region::Mandible), ("L1A", Region::Mandible),
    ("U1A", Region::Incisors), ("L1A", Region::Incisors), ("Ns", Region::SoftTissue), ("Prn", Region::SoftTissue)];
/// The teaching box's margin, a fraction of its longer side, on every side.
pub const TEACH_MARGIN: f64 = 0.10;
/// Fewer regions found than this: `no-ceph-found`, and no region or detector-facing judgement.
pub const MIN_REGIONS_FOUND: usize = 3;
/// A film whose shorter side is below this is not given to the region finder (the caller passes `FilmTooSmall`).
pub const MIN_FILM_SIDE: u32 = 256;
/// The box-quality gate (RV-1): every region's median IoU on the hold-out at least this, or stop (exit 4).
pub const BOX_GATE_MIN_MEDIAN_IOU: f64 = 0.5;

/// A box in film px as stored (pixel centres are integers), with the detector's score.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionBox { pub region: Region, pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64, pub score: f32 }
impl RegionBox {
    pub fn longer_side(&self) -> f64 { (self.x1 - self.x0).max(self.y1 - self.y0) }
    pub fn centre(&self) -> Pt { ((self.x0 + self.x1) / 2.0, (self.y0 + self.y1) / 2.0) }
    fn area(&self) -> f64 { (self.x1 - self.x0).max(0.0) * (self.y1 - self.y0).max(0.0) }
    /// The area shared ÷ the area covered together: 1 identical, 0 apart (and 0 when both are empty).
    pub fn iou(&self, o: &RegionBox) -> f64 {
        let i = (self.x1.min(o.x1) - self.x0.max(o.x0)).max(0.0) * (self.y1.min(o.y1) - self.y0.max(o.y0)).max(0.0);
        let u = self.area() + o.area() - i;
        if u > 0.0 { i / u } else { 0.0 }
    }
    /// The same centre, each side × k (control C9: k = 2).
    pub fn inflated(&self, k: f64) -> RegionBox {
        let ((cx, cy), hw, hh) = (self.centre(), (self.x1 - self.x0) * k / 2.0, (self.y1 - self.y0) * k / 2.0);
        RegionBox { x0: cx - hw, x1: cx + hw, y0: cy - hh, y1: cy + hh, ..*self }
    }
    /// A box that can be judged against: every coordinate a number, width and height above zero (ruling P16).
    fn usable(&self) -> bool { [self.x0, self.y0, self.x1, self.y1].iter().all(|v| v.is_finite()) && self.x1 > self.x0 && self.y1 > self.y0 }
}

/// The regions found on one film (at or above the score line), the detector's facing, and the detector's fingerprint.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Regions { pub boxes: Vec<RegionBox>, pub facing_left: Option<bool>, pub model_fingerprint: String }
impl Regions {
    /// `best`: the detector's best box per region. Kept when `score >= score_line` (at the line: kept) and the box is
    /// usable (a degenerate box is "not found", ruling P16). Two boxes for one region are refused (a caller bug).
    /// Facing: the soft-tissue profile's centre right of the cranial base's → facing right (`Some(false)`), left of it
    /// → `Some(true)`, level or either missing → `None`.
    pub fn from_scored(best: &[RegionBox], score_line: f32, model_fingerprint: &str) -> anyhow::Result<Regions> {
        for (i, b) in best.iter().enumerate() {
            anyhow::ensure!(!best[..i].iter().any(|o| o.region == b.region), "two boxes for the {} region", b.region.words());
        }
        let boxes: Vec<RegionBox> = best.iter().filter(|b| b.score >= score_line && b.usable()).copied().collect();
        let mut r = Regions { boxes, facing_left: None, model_fingerprint: model_fingerprint.to_string() };
        r.facing_left = match (r.get(Region::SoftTissue), r.get(Region::CranialBase)) {
            (Some(s), Some(c)) if s.centre().0 > c.centre().0 => Some(false),
            (Some(s), Some(c)) if s.centre().0 < c.centre().0 => Some(true),
            _ => None,
        };
        Ok(r)
    }
    /// The region's box, if found and usable.
    pub fn get(&self, r: Region) -> Option<&RegionBox> { self.boxes.iter().find(|b| b.region == r && b.usable()) }
    /// How many of the five regions have a usable box.
    pub fn found(&self) -> usize { REGIONS.iter().filter(|r| self.get(**r).is_some()).count() }
}

/// The five tolerances τ_r, in `REGIONS` order (measured by Task 10's rule; read from the calibration file).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct RegionTau(pub [f64; 5]);
impl RegionTau { pub fn get(&self, r: Region) -> f64 { self.0[r.index()] } }

/// The distance from `p` to the box (0 inside or on an edge) ÷ the box's longer side. Scale-free. Meaningful only for a
/// usable box (`Regions::get` returns no other); on a box whose longer side is not above zero it is infinity (the point
/// reads outside, never 0/0 = NaN).
pub fn outside_ratio(b: &RegionBox, p: Pt) -> f64 {
    if !(b.longer_side() > 0.0) { return f64::INFINITY }
    let dx = (b.x0 - p.0).max(0.0).max(p.0 - b.x1);
    let dy = (b.y0 - p.1).max(0.0).max(p.1 - b.y1);
    dx.hypot(dy) / b.longer_side()
}
/// Off the film: beyond half a pixel outside the outermost pixel centres. An off-film point is outside every box.
pub fn off_film(p: Pt, img_w: u32, img_h: u32) -> bool {
    p.0 < -0.5 || p.0 > img_w as f64 - 0.5 || p.1 < -0.5 || p.1 > img_h as f64 - 0.5
}

/// One look's status (stored per film).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Look { Judged, TooFewPoints, NotSetUp, NoRegionModel, FilmTooSmall }
/// One reason in a flagged result. `Region.outside`: each point outside, with its outside-ratio, or `None` when it is
/// off the film. Serde (IPC) is camelCase; the stored key is `key()` (ruling P14).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Reason { Mirrored, Shape { named: Vec<String> },
    /// `centre`: Some(d) when the cranial-base centre look flagged (then `outside` lists every present cranial-base point
    /// with its outside-ratio, 0 inside); skipped when None, so a whole-film/1 reason serialises as before.
    Region { region: Region, outside: Vec<(String, Option<f64>)>, #[serde(skip_serializing_if = "Option::is_none")] centre: Option<f64> },
    Size { factor: f64 }, Facing, NoCephFound }
impl Reason {
    pub fn key(&self) -> &'static str {
        match self { Reason::Mirrored => "mirrored", Reason::Shape { .. } => "shape", Reason::Region { .. } => "region", Reason::Size { .. } => "size", Reason::Facing => "facing", Reason::NoCephFound => "no-ceph-found" }
    }
}
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotRunWhy { TooFewPoints { present: usize }, NotSetUp, NoRegionModel, FilmTooSmall }
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum FilmCheck { Clean, Flagged { reasons: Vec<Reason> }, NotRun { why: NotRunWhy } }
/// The regions found on this film, or why the region finder did not run (`NoRegionModel`, `NotSetUp`, `FilmTooSmall`).
#[derive(Clone, Copy, Debug)]
pub enum RegionLook<'a> { Found(&'a Regions), NotRun(Look) }
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmResult { pub check: FilmCheck, pub shape_look: Look, pub region_look: Look, pub shape: Option<ShapeVerdict>, pub present: usize, pub size: Option<SizeVerdict>, pub size_look: ExtraLook,
    pub cb: Option<CbVerdict>, pub cb_look: ExtraLook }

/// The whole-film check on one set of marks (film px as stored). `s` None: no tracings file (shape `NotSetUp`). No scale
/// is read (OQ-8). Rules: brief Task 2 / spec §3.3–3.5 and §17.3; reasons in the fixed order mirrored|shape, regions in
/// `REGIONS` order, size, facing, no-ceph-found. With `cal.size` None the result is whole-film/1's, field for field (the
/// size look reads `not-set-up`).
pub fn check_film(s: Option<&WholeScorer>, marks: &[Mark], facing_left: bool, img_w: u32, img_h: u32, regions: RegionLook<'_>, cal: &FilmCal<'_>) -> anyhow::Result<FilmResult> {
    let tau = cal.tau;
    anyhow::ensure!(tau.0.iter().all(|t| t.is_finite() && *t >= 0.0), "each region tolerance must be a number at or above 0, not {:?}", tau.0);
    let stored = points_of(marks, false, img_w)?;                                // the film as stored: the boxes' frame
    let present = stored.iter().filter(|p| p.is_some()).count();
    let mut reasons = Vec::new();
    // The shape look (faced right inside `shape`).
    let (shape_look, shape) = match s {
        None => (Look::NotSetUp, None),
        Some(s) => match s.shape(marks, facing_left, img_w)? { None => (Look::TooFewPoints, None), Some(v) => (Look::Judged, Some(v)) },
    };
    if let (Some(s), Some(v)) = (s, shape) {
        if v.mirrored { reasons.push(Reason::Mirrored) }
        else if v.unusual { reasons.push(Reason::Shape { named: s.named(marks, facing_left, img_w)?.into_iter().map(String::from).collect() }) }
    }
    // The cranial-base centre look (whole-film/2): on the points AS STORED, against the cranial-base box in the same frame,
    // x mirrored on a left-facing film by `cb_offset` (never the faced-right points: M26, Task C's carry-over). Not judged:
    // copied from a region look that did not run; no calibration, or one for another detector; fewer than 3 regions found
    // (no-ceph-found: no region is judged); no cranial-base box, or any of S, N, Po, Ar, Or missing: too-few, never flagged.
    let cb_present = cb_points(&stored).len();
    let (cb_look, cb) = match (regions, cal.cb) {
        (RegionLook::NotRun(l), _) => (match l { Look::NoRegionModel => ExtraLook::NoRegionModel, Look::FilmTooSmall => ExtraLook::FilmTooSmall, _ => ExtraLook::NotSetUp }, None),
        (RegionLook::Found(_), None) => (ExtraLook::NotSetUp, None),
        (RegionLook::Found(regs), Some(c)) if c.fits(&regs.model_fingerprint).is_err() => (ExtraLook::NotSetUp, None),
        (RegionLook::Found(regs), Some(_)) if regs.found() < MIN_REGIONS_FOUND || cb_present < CB_POINTS => (ExtraLook::TooFew, None),
        (RegionLook::Found(regs), Some(c)) => match cb_offset(&stored, regs, facing_left) {
            None => (ExtraLook::TooFew, None),
            Some(o) => { let d = cb_distance(o, c); (ExtraLook::Judged, Some(CbVerdict { offset: o, distance: d, line: c.line, flagged: beyond(d, c.line) })) }
        },
    };
    // The region look.
    let (region_look, detector_facing, no_ceph) = match regions {
        RegionLook::NotRun(l) => {
            anyhow::ensure!(matches!(l, Look::NoRegionModel | Look::NotSetUp | Look::FilmTooSmall), "the region look cannot be 'not run' for {l:?}");
            (l, None, false)
        }
        RegionLook::Found(regs) if regs.found() < MIN_REGIONS_FOUND => (Look::Judged, None, true),
        RegionLook::Found(regs) => {
            for r in REGIONS {
                let b = regs.get(r);
                // A centre flag makes the cranial base's one Region reason: every present cranial-base point with its
                // outside-ratio (0 inside; off the film: none), and the distance.
                let centre = if r == Region::CranialBase { cb.filter(|v| v.flagged).map(|v| v.distance) } else { None };
                let outside: Vec<(String, Option<f64>)> = REGION_OF.iter().filter(|(_, reg)| *reg == r).filter_map(|(id, _)| {
                    let p = stored[ORDER.iter().position(|o| o == id)?]?;
                    if off_film(p, img_w, img_h) { return Some((id.to_string(), None)) }
                    let ratio = outside_ratio(b?, p);
                    (centre.is_some() || ratio > tau.get(r)).then(|| (id.to_string(), Some(ratio)))
                }).collect();
                if !outside.is_empty() || centre.is_some() { reasons.push(Reason::Region { region: r, outside, centre }) }
            }
            (Look::Judged, regs.facing_left, false)
        }
    };
    // The size look (whole-film/2): on the points as stored, against the boxes in the same frame, so facing changes
    // nothing (M26). Not judged: copied from a region look that did not run; no calibration, or one for another detector,
    // or no line for this film's set of regions; an incomplete tracing (fewer than all 19 points) or fewer than 3 usable
    // regions: too-few, never flagged.
    let (size_look, size) = match (regions, cal.size) {
        (RegionLook::NotRun(l), _) => (match l { Look::NoRegionModel => ExtraLook::NoRegionModel, Look::FilmTooSmall => ExtraLook::FilmTooSmall, _ => ExtraLook::NotSetUp }, None),
        (RegionLook::Found(_), None) => (ExtraLook::NotSetUp, None),
        (RegionLook::Found(regs), Some(c)) if c.fits(&regs.model_fingerprint).is_err() => (ExtraLook::NotSetUp, None),
        (RegionLook::Found(_), Some(_)) if present < SIZE_POINTS => (ExtraLook::TooFew, None),
        (RegionLook::Found(regs), Some(c)) => match size_score(&stored, regs, &c.uses) {
            None => (ExtraLook::TooFew, None),
            Some((used, q)) => match size_verdict(c, &used, q) { None => (ExtraLook::NotSetUp, None), Some(v) => (ExtraLook::Judged, Some(v)) },
        },
    };
    if let Some(v) = size.filter(|v| v.flagged) { reasons.push(Reason::Size { factor: v.factor }) }
    // Facing: any present witness that differs from the stored facing.
    let tracing_facing = shape.map(|v| if v.d2 <= v.d2_mirror { facing_left } else { !facing_left });
    if detector_facing.is_some_and(|d| d != facing_left) || tracing_facing.is_some_and(|t| t != facing_left) { reasons.push(Reason::Facing) }
    if no_ceph { reasons.push(Reason::NoCephFound) }
    let check = if !reasons.is_empty() { FilmCheck::Flagged { reasons } }
        else if shape_look != Look::Judged && region_look != Look::Judged {
            FilmCheck::NotRun { why: match (shape_look, region_look) {
                (Look::TooFewPoints, _) => NotRunWhy::TooFewPoints { present },
                (Look::NotSetUp, Look::NotSetUp) => NotRunWhy::NotSetUp,
                (_, Look::NoRegionModel) => NotRunWhy::NoRegionModel,
                (_, Look::FilmTooSmall) => NotRunWhy::FilmTooSmall,
                (_, l) => anyhow::bail!("no reason the check did not run (shape {shape_look:?}, regions {l:?})"),
            } }
        } else { FilmCheck::Clean };
    Ok(FilmResult { check, shape_look, region_look, shape, present, size, size_look, cb, cb_look })
}

/// The teaching rule (spec §3.3, §4.2): per region, the rectangle round its traced points and its `TEACH_EXTRA` points
/// present in `points` (film px), widened by `TEACH_MARGIN` × its longer side on every side, clipped to the film's pixel
/// centres. A region with fewer than 2 such points is omitted; a point that is not a number is skipped; a region whose
/// clipped box is inverted or empty (all its points off the film) is omitted too. Score 1.0.
pub fn teaching_boxes(points: &[(String, f64, f64)], img_w: u32, img_h: u32) -> Vec<RegionBox> {
    let (wmax, hmax) = (img_w.saturating_sub(1) as f64, img_h.saturating_sub(1) as f64);
    REGIONS.iter().filter_map(|&r| {
        let ids: Vec<&str> = REGION_OF.iter().chain(TEACH_EXTRA.iter()).filter(|(_, reg)| *reg == r).map(|(id, _)| *id).collect();
        let pts: Vec<(f64, f64)> = points.iter().filter(|(id, x, y)| ids.contains(&id.as_str()) && x.is_finite() && y.is_finite()).map(|(_, x, y)| (*x, *y)).collect();
        if pts.len() < 2 { return None }
        let (x0, x1) = pts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| (a.min(p.0), b.max(p.0)));
        let (y0, y1) = pts.iter().fold((f64::INFINITY, f64::NEG_INFINITY), |(a, b), p| (a.min(p.1), b.max(p.1)));
        let m = TEACH_MARGIN * (x1 - x0).max(y1 - y0);
        let b = RegionBox { region: r, x0: (x0 - m).max(0.0), y0: (y0 - m).max(0.0), x1: (x1 + m).min(wmax), y1: (y1 + m).min(hmax), score: 1.0 };
        (b.x1 > b.x0 && b.y1 > b.y0).then_some(b)
    }).collect()
}

/// One region's box quality over films (RV-1). Centre error in mm when every film that found the region has a scale
/// (`in_mm`), otherwise a fraction of the expert box's longer side for all; not a number when no film found it.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BoxQuality { pub region: Region, pub films: usize, pub not_found: usize, pub iou_median: f64, pub iou_p90: f64, pub centre_err_median: f64, pub centre_err_p90: f64, pub in_mm: bool }
/// One film's detected regions, the expert boxes (`teaching_boxes` on its expert points), and its scale if recorded.
pub struct FilmBoxes { pub detected: Regions, pub expert: Vec<RegionBox>, pub mm_per_px: Option<f64> }
fn median_of(sorted: &[f64]) -> f64 {
    let n = sorted.len();
    if n % 2 == 1 { sorted[n / 2] } else { (sorted[n / 2 - 1] + sorted[n / 2]) / 2.0 }
}
/// Per region, over the films with an expert box for it: IoU (0 where not found, counted in `not_found`), centre error
/// where found; each as median (mean of the two middle values for an even count) and p90 by nearest rank (⌈0.9 n⌉-th
/// smallest). A region no film has an expert box for is an error (nothing measured).
pub fn box_quality(films: &[FilmBoxes]) -> anyhow::Result<Vec<BoxQuality>> {
    REGIONS.iter().map(|&r| {
        let (mut iou, mut err, mut scales, mut not_found) = (Vec::new(), Vec::new(), Vec::new(), 0);
        for (i, f) in films.iter().enumerate() {
            let mut ex = f.expert.iter().filter(|b| b.region == r);
            let Some(e) = ex.next() else { continue };
            anyhow::ensure!(ex.next().is_none(), "film {i} has two expert boxes for the {} region", r.words());
            anyhow::ensure!(e.usable(), "film {i}'s expert box for the {} region is empty or not a number", r.words());
            if let Some(s) = f.mm_per_px { anyhow::ensure!(s.is_finite() && s > 0.0, "film {i}'s scale {s} is not a positive number") }
            match f.detected.get(r) {
                None => { not_found += 1; iou.push(0.0) }
                Some(d) => {
                    iou.push(d.iou(e));
                    let (a, b) = (d.centre(), e.centre());
                    err.push(((a.0 - b.0).hypot(a.1 - b.1), e.longer_side()));
                    scales.push(f.mm_per_px);
                }
            }
        }
        anyhow::ensure!(!iou.is_empty(), "no film has an expert box for the {} region: nothing to measure", r.words());
        let in_mm = !scales.is_empty() && scales.iter().all(|s| s.is_some());
        let mut e: Vec<f64> = err.iter().zip(&scales).map(|(&(px, side), s)| if in_mm { px * s.unwrap_or(f64::NAN) } else { px / side }).collect();
        iou.sort_by(f64::total_cmp); e.sort_by(f64::total_cmp);
        let (em, ep) = if e.is_empty() { (f64::NAN, f64::NAN) } else { (median_of(&e), nearest_rank(&e, 900)?) };
        Ok(BoxQuality { region: r, films: iou.len(), not_found, iou_median: median_of(&iou), iou_p90: nearest_rank(&iou, 900)?, centre_err_median: em, centre_err_p90: ep, in_mm })
    }).collect()
}
/// The gate: every one of the five regions' median IoU at least `BOX_GATE_MIN_MEDIAN_IOU`. Nothing measured: fails.
pub fn gate_passes(q: &[BoxQuality]) -> bool {
    REGIONS.iter().all(|r| q.iter().any(|x| x.region == *r)) && q.iter().all(|x| x.iou_median >= BOX_GATE_MIN_MEDIAN_IOU)
}

/// The calibration file: where the app finds the five τ_r and the score line, tied to the detector's fingerprint
/// (written by Task 10 from the Aariz-train hold-out; pre-registered with SC1-1a).
pub const CALIBRATION_VERSION: &str = "region-calibration/1";
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionCalibration {
    pub version: String, pub detector_fingerprint: String, pub score_line: f32, pub tau: RegionTau, pub gate_report_sha256: String,
    /// The gate rule that set τ (`GATE_RULES`). None: Task 10's file, written before the field existed (sc1-box-gate/1).
    #[serde(default, skip_serializing_if = "Option::is_none")] pub rule: Option<String>,
}
/// The gate rules a calibration may name: /1 (Task 10, τ from the Aariz-train hold-out), /2 (owner, 5 Nov 2026: τ from
/// the hold-out and Ceph-400 Train 001-150 together) and /3 (owner OQ-1b-A = A, 5 Nov 2026: the same rule also over the
/// development films, Ceph-400 Test1 151-300 and Aariz valid).
/// sc1-box-gate/4 (whole-film/3, owner ruling 5 Nov 2026, spec §17.15): gate /2's tolerances set by ruling, recorded in
/// `reference/sc1-box-gate-4.json`.
pub const GATE_RULES: [&str; 4] = ["sc1-box-gate/1", "sc1-box-gate/2", "sc1-box-gate/3", "sc1-box-gate/4"];
/// `<models>/regions/calibration.json` (joined, never a `/` in a string: Windows-ready).
pub fn calibration_path(models_dir: &std::path::Path) -> std::path::PathBuf { models_dir.join("regions").join("calibration.json") }
fn is_sha256_hex(s: &str) -> bool { s.len() == 64 && s.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b)) }
pub fn parse_calibration(bytes: &[u8]) -> anyhow::Result<RegionCalibration> {
    let c: RegionCalibration = serde_json::from_slice(bytes).map_err(|e| anyhow::anyhow!("the region calibration file cannot be read: {e}"))?;
    anyhow::ensure!(c.version == CALIBRATION_VERSION, "the region calibration version is {:?}, not {CALIBRATION_VERSION:?}", c.version);
    anyhow::ensure!(is_sha256_hex(&c.detector_fingerprint), "the detector fingerprint must be 64 lower-case hex characters");
    anyhow::ensure!(is_sha256_hex(&c.gate_report_sha256), "the gate report SHA-256 must be 64 lower-case hex characters");
    anyhow::ensure!(GATE_RULES.contains(&c.gate_rule()), "the region calibration's rule is {:?}, not one of {GATE_RULES:?}", c.gate_rule());
    anyhow::ensure!(c.score_line > 0.0 && c.score_line <= 1.0, "the score line must be above 0 and at most 1, not {}", c.score_line);
    for r in REGIONS {
        let t = c.tau.get(r);
        anyhow::ensure!(t.is_finite() && (0.01..=10.0).contains(&t), "the {} tolerance must be from 0.01 to 10, not {t}", r.words());
    }
    Ok(c)
}
impl RegionCalibration {
    /// The gate rule that set τ: the file's `rule`, or sc1-box-gate/1 when it has none (Task 10's file).
    pub fn gate_rule(&self) -> &str { self.rule.as_deref().unwrap_or(GATE_RULES[0]) }
}
pub fn calibration_json(c: &RegionCalibration) -> anyhow::Result<String> { Ok(serde_json::to_string_pretty(c)? + "\n") }

// ---- The size look (SC-1 Part 1b, spec §17.3, owner ruling R1b-3): rule `sc1-size/1` ----
//
// Picture: stick a pin in the middle of each box the region finder drew, and a pin in the middle of each region's traced
// points. On a correct tracing the tracing pins spread out about as far as the box pins, because both come from the same
// skull on the same film. Shrink the tracing to half and its pins huddle at half the spread; double it and they sprawl to
// twice. Construct: how big is this tracing against the anatomy the finder sees on THIS film. Method: q = ln(S_t / S_b),
// S the root-mean-square distance of the pins from their own mean, over the regions found that have a traced point (at
// least 3). No millimetre, no film scale (OQ-8). Flag `size` when |q − centre| is beyond the line for the set of regions
// used; centre and line are set by `sc1-size/1` on the 520 calibration films (`reference/sc1-size.json`).

pub const SIZE_RULE: &str = "sc1-size/1";
/// The size calibration file's own version.
pub const SIZE_CALIBRATION_VERSION: &str = "size-calibration/1";
/// No size line is below this (pre-registered).
pub const SIZE_LINE_FLOOR: f64 = 0.05;
/// A chosen full-set line above this stops the calibration run (half of ln 2: a half-size tracing at the edge of the
/// normal spread would not be seen).
pub const SIZE_LINE_STOP: f64 = 0.35;
/// The fewest regions the size look is judged on.
pub const SIZE_MIN_REGIONS: usize = 3;
/// The size look judges complete tracings only (fix round 1, ruling on review I2): the lines were set on
/// complete expert tracings, and a missing point moves its region's pin (an 11-point tracing read q 0.165 against 0.029
/// complete). Fewer points: `too-few`, never flagged.
pub const SIZE_POINTS: usize = 19;

/// Strictly beyond the line (a value exactly on the line is not flagged). The one comparison the size and the
/// cranial-base centre looks use (M25, M27).
pub fn beyond(d: f64, line: f64) -> bool { d > line }

/// The status of a look added by whole-film/2 (the size look here; the cranial-base centre in Task D) (M4).
/// Stored keys: "judged", "not-set-up", "no-region-model", "film-too-small", "too-few". For the size look `too-few`
/// means an incomplete tracing (fewer than all 19 points: "not judged: incomplete tracing") or fewer than 3 usable
/// regions; either way it never flags.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum ExtraLook { Judged, NotSetUp, NoRegionModel, FilmTooSmall, TooFew }
impl ExtraLook {
    pub fn key(self) -> &'static str {
        match self { ExtraLook::Judged => "judged", ExtraLook::NotSetUp => "not-set-up", ExtraLook::NoRegionModel => "no-region-model",
            ExtraLook::FilmTooSmall => "film-too-small", ExtraLook::TooFew => "too-few" }
    }
}

/// q = ln(S_t / S_b) over the regions in `uses` (taken in REGIONS order) that are found and have at least one traced
/// point in `stored` (19 points in ORDER, the film as stored: the boxes' frame). `c_r` = the mean of the region's traced
/// points, `b_r` = the box's centre; S = the root-mean-square distance of the pins from their mean. None below
/// `SIZE_MIN_REGIONS` regions, or when the box pins do not spread (S_b not above 0). Off-film points count like any other.
pub fn size_score(stored: &[Option<Pt>], regs: &Regions, uses: &[Region]) -> Option<(Vec<Region>, f64)> {
    let (mut used, mut c, mut b) = (Vec::new(), Vec::new(), Vec::new());
    for r in REGIONS.into_iter().filter(|r| uses.contains(r)) {
        let Some(bx) = regs.get(r) else { continue };
        let pts: Vec<Pt> = REGION_OF.iter().filter(|(_, g)| *g == r)
            .filter_map(|(id, _)| ORDER.iter().position(|o| o == id).and_then(|k| stored.get(k).copied().flatten())).collect();
        if pts.is_empty() { continue }
        let n = pts.len() as f64;
        used.push(r);
        c.push((pts.iter().map(|p| p.0).sum::<f64>() / n, pts.iter().map(|p| p.1).sum::<f64>() / n));
        b.push(bx.centre());
    }
    if used.len() < SIZE_MIN_REGIONS { return None }
    let spread = |v: &[Pt]| {
        let n = v.len() as f64;
        let m = (v.iter().map(|p| p.0).sum::<f64>() / n, v.iter().map(|p| p.1).sum::<f64>() / n);
        (v.iter().map(|p| (p.0 - m.0).powi(2) + (p.1 - m.1).powi(2)).sum::<f64>() / n).sqrt()
    };
    let (st, sb) = (spread(&c), spread(&b));
    if !(sb > 0.0 && sb.is_finite() && st.is_finite()) { return None }
    Some((used, (st / sb).ln()))
}

/// One region set's centre and line.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SizeRef { pub regions: Vec<Region>, pub centre: f64, pub line: f64 }
/// `models/regions/size-calibration.json`: the centres and lines `sc1-size/1` set, for one detector.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]   // M24
pub struct SizeCalibration { pub version: String, pub rule: String, pub detector_fingerprint: String, pub uses: Vec<Region>, pub refs: Vec<SizeRef>, pub report_sha256: String }
/// `<models>/regions/size-calibration.json` (joins only: Windows-ready).
pub fn size_calibration_path(models: &std::path::Path) -> std::path::PathBuf { models.join("regions").join("size-calibration.json") }
/// A set of regions as stored: ascending in REGIONS order, no repeats.
fn ascending(v: &[Region]) -> bool { v.windows(2).all(|w| w[0] < w[1]) }
/// The file's bytes, read and checked: its version and rule; the detector and report hashes; `uses` is all five or the
/// four without the soft-tissue profile; every ref a set of at least 3 of `uses` (ascending, given once), with a centre
/// that is a number and a line that is a number at or above 0.05; the full `uses` set has a ref.
pub fn parse_size_calibration(bytes: &[u8]) -> anyhow::Result<SizeCalibration> {
    let c: SizeCalibration = serde_json::from_slice(bytes).map_err(|e| anyhow::anyhow!("the size calibration file cannot be read: {e}"))?;
    anyhow::ensure!(c.version == SIZE_CALIBRATION_VERSION, "the size calibration version is {:?}, not {SIZE_CALIBRATION_VERSION:?}", c.version);
    anyhow::ensure!(c.rule == SIZE_RULE, "the size calibration's rule is {:?}, not {SIZE_RULE:?}", c.rule);
    anyhow::ensure!(is_sha256_hex(&c.detector_fingerprint), "the size calibration's detector fingerprint must be 64 lower-case hex characters");
    anyhow::ensure!(is_sha256_hex(&c.report_sha256), "the size calibration's report SHA-256 must be 64 lower-case hex characters");
    let four: Vec<Region> = REGIONS.into_iter().filter(|r| *r != Region::SoftTissue).collect();
    anyhow::ensure!(c.uses == REGIONS.to_vec() || c.uses == four, "the size calibration uses {:?}: it must use all five regions or the four without the soft-tissue profile", c.uses);
    for (i, r) in c.refs.iter().enumerate() {
        anyhow::ensure!(r.regions.len() >= SIZE_MIN_REGIONS, "a size line is set for {} regions ({:?}); at least {SIZE_MIN_REGIONS} are needed", r.regions.len(), r.regions);
        anyhow::ensure!(ascending(&r.regions) && r.regions.iter().all(|g| c.uses.contains(g)), "the size line for {:?} is not a set of the regions used, in order", r.regions);
        anyhow::ensure!(!c.refs[..i].iter().any(|o| o.regions == r.regions), "the size line for {:?} is given twice", r.regions);
        anyhow::ensure!(r.centre.is_finite(), "the size centre for {:?} is not a number", r.regions);
        anyhow::ensure!(r.line.is_finite() && r.line >= SIZE_LINE_FLOOR, "the size line for {:?} is {}, not a number at or above {SIZE_LINE_FLOOR}", r.regions, r.line);
    }
    anyhow::ensure!(c.refs.iter().any(|r| r.regions == c.uses), "the size calibration has no line for its full set {:?}", c.uses);
    Ok(c)
}
impl SizeCalibration {
    /// This calibration is for the region finder `fp`; otherwise an error naming both (the size look is then not set up).
    pub fn fits(&self, fp: &str) -> anyhow::Result<()> {
        anyhow::ensure!(self.detector_fingerprint == fp, "the size calibration is for region finder {}, these boxes are from {fp}", self.detector_fingerprint);
        Ok(())
    }
}

/// The size verdict on one film. `factor` = exp(q − centre): ×1 right, ×0.5 half size, ×2 double. `flagged` =
/// `beyond(|q − centre|, line)`.
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SizeVerdict { pub q: f64, pub centre: f64, pub line: f64, pub factor: f64, pub flagged: bool }
/// The verdict for the set of regions `used`, or None when the calibration has no line for that set (not judged).
pub fn size_verdict(cal: &SizeCalibration, used: &[Region], q: f64) -> Option<SizeVerdict> {
    let r = cal.refs.iter().find(|r| r.regions == used)?;
    Some(SizeVerdict { q, centre: r.centre, line: r.line, factor: (q - r.centre).exp(), flagged: beyond((q - r.centre).abs(), r.line) })
}

// ---- The cranial-base centre look (SC-1 Part 1b, spec §17.5 Option 1, owner ruling OQ-1b-D = A): rule `sc1-cb-centre/1` ----
//
// Picture: put a pin in the middle of the five traced cranial-base points (S, N, Po, Ar, Or) and another in the middle of
// the rectangle the region finder drew round the cranial base on THIS film. On a correct tracing the two pins sit in
// about the same place relative to each other on every film. Move the traced cranial base 15 mm and its pin moves 15 mm
// while the rectangle's stays. Construct: how far has the traced cranial base drifted from the cranial base this film
// shows, as a fraction of its box? Method: the offset o = (tracing pin − box pin) ÷ the box's longer side, on the points
// AS STORED (the boxes' frame: never the faced-right points, which would put the tracing pin in another frame from the
// box pin), x mirrored on a left-facing film so that +x is always forward. d = |o − median|; flag when d > line. Median
// and line are set by `sc1-cb-centre/1` on the 520 calibration films (`reference/sc1-cb-centre.json`). No millimetre.

pub const CB_RULE: &str = "sc1-cb-centre/1";
/// The centre calibration file's own version.
pub const CB_CALIBRATION_VERSION: &str = "cb-centre-calibration/1";
/// `cb_offset` needs at least this many of S, N, Po, Ar, Or (spec §17.5).
pub const CB_MIN_POINTS: usize = 3;
/// The check JUDGES only a tracing with all five cranial-base points (Task D's missing-point rule, pre-registered in
/// `reference/sc1-cb-centre.json` "judged"): the median and line were set on complete expert tracings, and a missing
/// point moves the tracing pin (dropping N moves it about a quarter of N's distance from the others' mean, far beyond
/// any line). Fewer: `too-few`, never flagged, as the size look's complete-tracing rule.
pub const CB_POINTS: usize = 5;
/// No centre line is below this (pre-registered).
pub const CB_LINE_FLOOR: f64 = 0.02;
/// A line above this stops the calibration run (a 10 mm move is about 0.09 of the box side).
pub const CB_LINE_STOP: f64 = 0.10;

/// (tracing pin − box pin) ÷ the box's longer side, x mirrored on a left-facing film; None below 3 of S, N, Po, Ar, Or or no box.
pub fn cb_offset(stored: &[Option<Pt>], regs: &Regions, facing_left: bool) -> Option<(f64, f64)> {
    let b = regs.get(Region::CranialBase)?;
    let pts = cb_points(stored);
    if pts.len() < CB_MIN_POINTS { return None }
    let n = pts.len() as f64;
    let (m, c, side) = ((pts.iter().map(|p| p.0).sum::<f64>() / n, pts.iter().map(|p| p.1).sum::<f64>() / n), b.centre(), b.longer_side());
    let x = (m.0 - c.0) / side;
    Some((if facing_left { -x } else { x }, (m.1 - c.1) / side))
}
/// The present cranial-base points (S, N, Po, Ar, Or) of `stored` (19 points in ORDER), in REGION_OF order.
fn cb_points(stored: &[Option<Pt>]) -> Vec<Pt> {
    REGION_OF.iter().filter(|(_, g)| *g == Region::CranialBase)
        .filter_map(|(id, _)| ORDER.iter().position(|o| o == id).and_then(|k| stored.get(k).copied().flatten())).collect()
}

/// How many of S, N, Po, Ar, Or are traced on these marks (the film as stored), 0 to 5: what `check_film` compares with `CB_POINTS`.
/// Stored with the check so that `too-few` can say "a cranial-base point is missing" or "all five, but no box".
pub fn cb_present(marks: &[Mark], img_w: u32) -> anyhow::Result<usize> { Ok(cb_points(&points_of(marks, false, img_w)?).len()) }

/// `models/regions/cb-centre-calibration.json`: the median offset and the line `sc1-cb-centre/1` set, for one detector.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]   // M24
pub struct CbCalibration { pub version: String, pub rule: String, pub detector_fingerprint: String, pub median: (f64, f64), pub line: f64, pub report_sha256: String,
    /// whole-film/3 (owner ruling, 5 Nov 2026, spec §17.15): the line was set by the owner, not by the measured rule; the
    /// measured line and the committed record are named here. Absent on a measured file (which then reads as before).
    #[serde(default, skip_serializing_if = "Option::is_none")] pub ruling: Option<CbRuling> }
/// The owner's ruling on the centre line (`reference/sc1-cb-centre-ruling.json`): the rule it belongs to, the line the
/// measured rule had set, and the record's SHA-256.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CbRuling { pub rule: String, pub measured_line: f64, pub record_sha256: String }
/// `<models>/regions/cb-centre-calibration.json` (joins only: Windows-ready).
pub fn cb_calibration_path(models: &std::path::Path) -> std::path::PathBuf { models.join("regions").join("cb-centre-calibration.json") }
/// The file's bytes, read and checked: its version and rule; the detector and report hashes; a median that is a number on
/// both axes; a line that is a number from 0.02 to 0.10 (a line above 0.10 stops the rule and is never written).
pub fn parse_cb_calibration(bytes: &[u8]) -> anyhow::Result<CbCalibration> {
    let c: CbCalibration = serde_json::from_slice(bytes).map_err(|e| anyhow::anyhow!("the centre calibration file cannot be read: {e}"))?;
    anyhow::ensure!(c.version == CB_CALIBRATION_VERSION, "the centre calibration version is {:?}, not {CB_CALIBRATION_VERSION:?}", c.version);
    anyhow::ensure!(c.rule == CB_RULE, "the centre calibration's rule is {:?}, not {CB_RULE:?}", c.rule);
    anyhow::ensure!(is_sha256_hex(&c.detector_fingerprint), "the centre calibration's detector fingerprint must be 64 lower-case hex characters");
    anyhow::ensure!(is_sha256_hex(&c.report_sha256), "the centre calibration's report SHA-256 must be 64 lower-case hex characters");
    anyhow::ensure!(c.median.0.is_finite() && c.median.1.is_finite(), "the centre median {:?} is not a number", c.median);
    anyhow::ensure!(c.line.is_finite() && (CB_LINE_FLOOR..=CB_LINE_STOP).contains(&c.line), "the centre line is {}, not a number from {CB_LINE_FLOOR} to {CB_LINE_STOP}", c.line);
    // A ruled line (whole-film/3): it names a whole-film rule and its committed record, keeps the measured line, and may
    // only widen it (a ruling never narrows what the measured rule set).
    if let Some(r) = &c.ruling {
        anyhow::ensure!(r.rule.starts_with("whole-film/"), "the centre ruling belongs to {:?}, not a whole-film rule", r.rule);
        anyhow::ensure!(is_sha256_hex(&r.record_sha256), "the centre ruling's record SHA-256 must be 64 lower-case hex characters");
        anyhow::ensure!(r.measured_line.is_finite() && (CB_LINE_FLOOR..=CB_LINE_STOP).contains(&r.measured_line), "the centre ruling's measured line is {}, not a number from {CB_LINE_FLOOR} to {CB_LINE_STOP}", r.measured_line);
        anyhow::ensure!(c.line >= r.measured_line, "the ruled centre line {} would narrow the measured {}: a ruling only widens it", c.line, r.measured_line);
    }
    Ok(c)
}
impl CbCalibration {
    /// This calibration is for the region finder `fp`; otherwise an error naming both (the centre look is then not set up).
    pub fn fits(&self, fp: &str) -> anyhow::Result<()> {
        anyhow::ensure!(self.detector_fingerprint == fp, "the centre calibration is for region finder {}, these boxes are from {fp}", self.detector_fingerprint);
        Ok(())
    }
}
/// |o − median| (hypot).
pub fn cb_distance(o: (f64, f64), cal: &CbCalibration) -> f64 { (o.0 - cal.median.0).hypot(o.1 - cal.median.1) }
/// The centre check's result on one film (M6): the offset, its distance from the median, the line, and beyond(d, line).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbVerdict { pub offset: (f64, f64), pub distance: f64, pub line: f64, pub flagged: bool }

/// Everything `check_film` needs beyond the shape scorer: τ and the optional new looks (None = whole-film/1 behaviour).
/// Build it with `FilmCal::tau_only(&tau)` (+ struct update), so a new field touches no caller (M1).
#[derive(Clone, Copy, Debug)]
pub struct FilmCal<'a> { pub tau: &'a RegionTau, pub size: Option<&'a SizeCalibration>, pub cb: Option<&'a CbCalibration> }
impl<'a> FilmCal<'a> { pub fn tau_only(tau: &'a RegionTau) -> Self { FilmCal { tau, size: None, cb: None } } }

/// The whole-film/3 pins (owner ruling, 5 Nov 2026): the two committed records that make the region calibration gate /4's
/// and the centre calibration the ruled one. One place for the bench (`check_gate4`, `check_ruled_centre`) and the app, so
/// the app gives a verdict only with the inputs PKU tested.
pub mod pins {
    use super::{CbCalibration, RegionCalibration};
    use anyhow::{ensure, Context};
    /// The SHA-256 of the shape reference `whole-film-reference-v1.shape` that whole-film/3 and the PKU run used
    /// (pre-registered: `reference/sc1-1b-pku.json`, `shape.referenceSha256`).
    /// The SHA-256 of the size calibration's report that the PKU run required (pre-registered: `reference/sc1-1b-pku.json`,
    /// `size.reportSha256`), and the regions it uses (`size.uses`: four, without the soft-tissue profile).
    pub const SIZE_REPORT_SHA256: &str = "836b8c341127026f0f8b27f7abe54fabfaa9da96b05a21e60d8bd2e872a91cab";
    pub fn size_uses() -> Vec<super::Region> { vec![super::Region::CranialBase, super::Region::Maxilla, super::Region::Mandible, super::Region::Incisors] }
    /// The size calibration in force is the pre-registered one: its report's SHA-256 and its regions (the PKU run's own check).
    pub fn check_size(c: &super::SizeCalibration, fp: &str) -> anyhow::Result<()> {
        c.fits(fp)?;
        ensure!(c.report_sha256 == SIZE_REPORT_SHA256, "the size calibration names report {}, the pre-registered one {SIZE_REPORT_SHA256}", c.report_sha256);
        ensure!(c.uses == size_uses(), "the size calibration uses {:?}, the pre-registered {:?}", c.uses, size_uses());
        Ok(())
    }
    pub const REFERENCE_SHA256: &str = "6f0f066aeedde5eb329800595c29fb082b56ec6092f8782fc8653d0a1b4a81bd";
pub const GATE4_RECORD: &str = include_str!("../../../reference/sc1-box-gate-4.json");
pub const GATE4_PATH: &str = "reference/sc1-box-gate-4.json";
pub const CENTRE_RECORD: &str = include_str!("../../../reference/sc1-cb-centre-ruling.json");
pub const CENTRE_PATH: &str = "reference/sc1-cb-centre-ruling.json";
pub const GATE4: &str = "sc1-box-gate/4";
pub const WHOLE_FILM_3: &str = "whole-film/3";
/// The two records' numbers and hashes.
#[derive(Clone, Debug, PartialEq)]
pub struct Records {
    pub tau: [f64; 5], pub fingerprint: String, pub score_line: f32, pub from_gate3: String, pub gate4_sha: String,
    pub centre_line: f64, pub measured_line: f64, pub measured_report: String, pub centre_sha: String,
}
fn hex(v: &serde_json::Value, k: &str, what: &str) -> anyhow::Result<String> {
    let s = v[k].as_str().unwrap_or_default();
    ensure!(s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()), "{what} names no {k}");
    Ok(s.to_string())
}
/// The committed records, read: gate /4's τ (REGIONS order), detector, score line and the gate /3 report it replaces;
/// the ruled and measured centre lines and the measured report; and each record's own SHA-256.
pub fn records() -> anyhow::Result<Records> {
    let g: serde_json::Value = serde_json::from_str(GATE4_RECORD).context("the gate /4 record is not JSON")?;
    let c: serde_json::Value = serde_json::from_str(CENTRE_RECORD).context("the centre ruling is not JSON")?;
    ensure!(g["version"] == GATE4 && g["wholeFilmRule"] == WHOLE_FILM_3, "{GATE4_PATH} is not {GATE4} for {WHOLE_FILM_3}");
    ensure!(c["version"] == "sc1-cb-centre-ruling/1" && c["wholeFilmRule"] == WHOLE_FILM_3, "{CENTRE_PATH} is not the centre ruling for {WHOLE_FILM_3}");
    let mut tau = [f64::NAN; 5];
    for r in super::REGIONS { tau[r.index()] = g["tau"][serde_json::to_value(r)?.as_str().unwrap_or_default()].as_f64().unwrap_or(f64::NAN); }
    ensure!(tau.iter().all(|t| t.is_finite()), "{GATE4_PATH} lacks a tolerance: {tau:?}");
    let num = |v: &serde_json::Value, k: &str, p: &str| v[k].as_f64().with_context(|| format!("{p} has no {k}"));
    Ok(Records { tau, fingerprint: hex(&g, "detectorFingerprint", GATE4_PATH)?, score_line: num(&g, "scoreLine", GATE4_PATH)? as f32,
        from_gate3: hex(&g, "fromGate3ReportSha256", GATE4_PATH)?, gate4_sha: crate::install::sha256_bytes(GATE4_RECORD.as_bytes()),
        centre_line: num(&c, "line", CENTRE_PATH)?, measured_line: num(&c, "measuredLine", CENTRE_PATH)?, measured_report: hex(&c, "measuredReportSha256", CENTRE_PATH)?,
        centre_sha: crate::install::sha256_bytes(CENTRE_RECORD.as_bytes()) })
}
/// The calibration in force is gate /4's as recorded: rule /4, the record's τ, detector and score line, the record's hash.
pub fn check_gate4(c: &RegionCalibration, fp: &str, r: &Records) -> anyhow::Result<()> {
    ensure!(c.gate_rule() == GATE4, "the region calibration in force was set by {}, not {GATE4}: run --sc1-whole-film-3 first", c.gate_rule());
    ensure!(c.detector_fingerprint == fp && fp == r.fingerprint, "the calibration is for detector {}, the region finder is {fp}, the record names {}", c.detector_fingerprint, r.fingerprint);
    ensure!(c.gate_report_sha256 == r.gate4_sha, "the calibration names gate /4 record {}, the pre-registered one {}", c.gate_report_sha256, r.gate4_sha);
    ensure!(c.tau.0 == r.tau && c.score_line == r.score_line, "the calibration's tau {:?} at score line {} is not the gate /4 record's {:?} at {}", c.tau.0, c.score_line, r.tau, r.score_line);
    Ok(())
}
/// The centre calibration in force is the ruled one: the record's line, a ruling naming the record and the measured line,
/// the measured report and this detector.
pub fn check_ruled_centre(c: &CbCalibration, fp: &str, r: &Records) -> anyhow::Result<()> {
    let ru = c.ruling.as_ref().context("the centre calibration in force carries no ruling: run --sc1-whole-film-3 first")?;
    ensure!(ru.rule == WHOLE_FILM_3 && ru.record_sha256 == r.centre_sha && ru.measured_line == r.measured_line,
        "the centre ruling {ru:?} is not the pre-registered one ({WHOLE_FILM_3}, record {}, measured line {})", r.centre_sha, r.measured_line);
    ensure!(c.line == r.centre_line, "the ruled centre line is {}, the record's is {}", c.line, r.centre_line);
    ensure!(c.report_sha256 == r.measured_report, "the centre calibration names report {}, the measured one is {}", c.report_sha256, r.measured_report);
    c.fits(fp)
}
}
pub use pins::{check_size, size_uses, SIZE_REPORT_SHA256, check_gate4, check_ruled_centre, records, Records, CENTRE_PATH, CENTRE_RECORD, GATE4, GATE4_PATH, GATE4_RECORD, REFERENCE_SHA256, WHOLE_FILM_3};

/// whole-film/1 exactly as it stood at commit 0142ba9 (the commit before SC-1 Part 1b Task C), with private mirror types,
/// so that it still compiles when the real ones grow. `whole_film_1_is_unchanged_when_the_new_looks_are_off` compares the
/// real `check_film` (new looks off) with it. Never edited after Task C (M2, M3).
#[cfg(test)]
mod frozen_v1 {
    use super::{off_film, outside_ratio, points_of, Look, Mark, RegionLook, RegionTau, ShapeVerdict, WholeScorer, ORDER, REGIONS, REGION_OF, MIN_REGIONS_FOUND, Region};
    use serde::Serialize;
    #[derive(Clone, Debug, PartialEq, Serialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub(super) enum V1Reason { Mirrored, Shape { named: Vec<String> }, Region { region: Region, outside: Vec<(String, Option<f64>)> }, Facing, NoCephFound }
    #[derive(Clone, Debug, PartialEq, Serialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub(super) enum V1NotRunWhy { TooFewPoints { present: usize }, NotSetUp, NoRegionModel, FilmTooSmall }
    #[derive(Clone, Debug, PartialEq, Serialize)]
    #[serde(tag = "kind", rename_all = "camelCase")]
    pub(super) enum V1Check { Clean, Flagged { reasons: Vec<V1Reason> }, NotRun { why: V1NotRunWhy } }
    #[derive(Clone, Debug, PartialEq)]
    pub(super) struct V1Result { pub check: V1Check, pub shape_look: Look, pub region_look: Look, pub shape: Option<ShapeVerdict>, pub present: usize }
    impl V1Result {
        /// The five fields whole-film/1 had, as JSON (as the tests' `v1_fields`).
        pub(super) fn fields(&self) -> serde_json::Value { serde_json::json!([self.check, self.shape_look, self.region_look, self.shape, self.present]) }
    }

    pub(super) fn check_film(s: Option<&WholeScorer>, marks: &[Mark], facing_left: bool, img_w: u32, img_h: u32, regions: RegionLook<'_>, tau: &RegionTau) -> anyhow::Result<V1Result> {
        anyhow::ensure!(tau.0.iter().all(|t| t.is_finite() && *t >= 0.0), "each region tolerance must be a number at or above 0, not {:?}", tau.0);
        let stored = points_of(marks, false, img_w)?;                                // the film as stored: the boxes' frame
        let present = stored.iter().filter(|p| p.is_some()).count();
        let mut reasons = Vec::new();
        // The shape look (faced right inside `shape`).
        let (shape_look, shape) = match s {
            None => (Look::NotSetUp, None),
            Some(s) => match s.shape(marks, facing_left, img_w)? { None => (Look::TooFewPoints, None), Some(v) => (Look::Judged, Some(v)) },
        };
        if let (Some(s), Some(v)) = (s, shape) {
            if v.mirrored { reasons.push(V1Reason::Mirrored) }
            else if v.unusual { reasons.push(V1Reason::Shape { named: s.named(marks, facing_left, img_w)?.into_iter().map(String::from).collect() }) }
        }
        // The region look.
        let (region_look, detector_facing, no_ceph) = match regions {
            RegionLook::NotRun(l) => {
                anyhow::ensure!(matches!(l, Look::NoRegionModel | Look::NotSetUp | Look::FilmTooSmall), "the region look cannot be 'not run' for {l:?}");
                (l, None, false)
            }
            RegionLook::Found(regs) if regs.found() < MIN_REGIONS_FOUND => (Look::Judged, None, true),
            RegionLook::Found(regs) => {
                for r in REGIONS {
                    let b = regs.get(r);
                    let outside: Vec<(String, Option<f64>)> = REGION_OF.iter().filter(|(_, reg)| *reg == r).filter_map(|(id, _)| {
                        let p = stored[ORDER.iter().position(|o| o == id)?]?;
                        if off_film(p, img_w, img_h) { return Some((id.to_string(), None)) }
                        let ratio = outside_ratio(b?, p);
                        (ratio > tau.get(r)).then(|| (id.to_string(), Some(ratio)))
                    }).collect();
                    if !outside.is_empty() { reasons.push(V1Reason::Region { region: r, outside }) }
                }
                (Look::Judged, regs.facing_left, false)
            }
        };
        // Facing: any present witness that differs from the stored facing.
        let tracing_facing = shape.map(|v| if v.d2 <= v.d2_mirror { facing_left } else { !facing_left });
        if detector_facing.is_some_and(|d| d != facing_left) || tracing_facing.is_some_and(|t| t != facing_left) { reasons.push(V1Reason::Facing) }
        if no_ceph { reasons.push(V1Reason::NoCephFound) }
        let check = if !reasons.is_empty() { V1Check::Flagged { reasons } }
            else if shape_look != Look::Judged && region_look != Look::Judged {
                V1Check::NotRun { why: match (shape_look, region_look) {
                    (Look::TooFewPoints, _) => V1NotRunWhy::TooFewPoints { present },
                    (Look::NotSetUp, Look::NotSetUp) => V1NotRunWhy::NotSetUp,
                    (_, Look::NoRegionModel) => V1NotRunWhy::NoRegionModel,
                    (_, Look::FilmTooSmall) => V1NotRunWhy::FilmTooSmall,
                    (_, l) => anyhow::bail!("no reason the check did not run (shape {shape_look:?}, regions {l:?})"),
                } }
            } else { V1Check::Clean };
        Ok(V1Result { check, shape_look, region_look, shape, present })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::synthetic::{faces, JAW};
    use crate::shape::Sim;
    use std::sync::OnceLock;
    const W: u32 = 2400;
    fn marks(f: &[Pt]) -> Vec<Mark> { ORDER.iter().zip(f).map(|(id, p)| Mark { landmark_id: id.to_string(), x: p.0, y: p.1 }).collect() }
    /// SYNTHETIC reference: 120 faces (seed 4). Built once (the leave-one-out line costs 120 fits).
    fn scorer() -> &'static WholeScorer { static S: OnceLock<WholeScorer> = OnceLock::new(); S.get_or_init(|| WholeScorer::new(faces(120, 4)).unwrap()) }
    fn all() -> Vec<usize> { (0..19).collect() }
    fn about_centre(f: &[Pt], g: impl Fn(f64, f64) -> Pt) -> Vec<Pt> {
        let (cx, cy) = (f.iter().map(|p| p.0).sum::<f64>() / 19.0, f.iter().map(|p| p.1).sum::<f64>() / 19.0);
        f.iter().map(|p| { let q = g(p.0 - cx, p.1 - cy); (q.0 + cx, q.1 + cy) }).collect()
    }
    fn rel(a: f64, b: f64) -> f64 { (a - b).abs() / a.abs().max(b.abs()).max(1e-300) }

    /// Spec §3.1 step 5. Fails if LINE_PER_MILLE is changed (995 → 990 picks the 119th of 120, not the 120th), if the
    /// line is not rounded up to a tenth, or if a tracing is scored against a set that includes itself.
    #[test] fn the_line_is_the_leave_one_out_995th_percentile_rounded_up_to_a_tenth() {
        let train = faces(120, 4);
        let mut loo: Vec<f64> = (0..train.len()).map(|i| {
            let rest: Vec<Vec<Pt>> = train.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, t)| t.clone()).collect();
            WholeScorer::new(rest).unwrap().d2_of(&train[i], &all()).unwrap()
        }).collect();
        loo.sort_by(f64::total_cmp);
        let rank = (LINE_PER_MILLE * loo.len() + 999) / 1000;             // nearest rank, 1-based
        assert_eq!(rank, 120, "120 tracings: the 99.5th percentile by nearest rank is the largest");
        assert_eq!(scorer().line_for(&all()).unwrap(), ceil_tenth(loo[rank - 1]));
        eprintln!("line {} from {} leave-one-out values", scorer().line_for(&all()).unwrap(), loo.len());
    }
    /// Fails if ceil_tenth rounds a value already on a tenth up again (0.7 → 0.8) or rounds down.
    #[test] fn ceil_tenth_is_exact_on_and_between_tenths() {
        assert_eq!((ceil_tenth(0.7), ceil_tenth(0.70001), ceil_tenth(41.0), ceil_tenth(40.91)), (0.7, 0.8, 41.0, 41.0));
    }
    /// Control C1 at unit level (Stage A read all 50 Clean). Fails if the mirrored D² is computed without mirroring
    /// (then d2_mirror == d2 and nothing reads mirrored), or if `mirrored` ignores d2_mirror.
    #[test] fn fifty_mirrored_synthetic_faces_read_mirrored_and_their_unmirrored_selves_never_do() {
        let (mut mirrored, mut unmirrored) = (0, 0);
        for f in faces(50, 99) {
            let m = about_centre(&f, |x, y| (-x, y));
            let v = scorer().shape(&marks(&m), false, W).unwrap().unwrap();
            if v.mirrored { mirrored += 1 } else { panic!("a mirrored face not read mirrored: {v:?}") }
            if scorer().shape(&marks(&f), false, W).unwrap().unwrap().mirrored { unmirrored += 1 }
        }
        assert_eq!((mirrored, unmirrored), (50, 0));
    }
    /// OQ-8: scale-free. Fails if the alignment stops removing size (e.g. fit_sim replaced by a shift-only fit).
    #[test] fn size_shift_and_turn_change_nothing() {
        let f = faces(1, 7).remove(0);
        let base = scorer().shape(&marks(&f), false, W).unwrap().unwrap();
        for (k, t, dx, dy) in [(0.5, 0.0, 0.0, 0.0), (2.0, 0.0, 0.0, 0.0), (1.0, 0.0, 300.0, -200.0), (1.0, 0.15, 0.0, 0.0), (1000.0, 0.0, 0.0, 0.0)] {
            let s = Sim { a: k * f64::cos(t), b: k * f64::sin(t), tx: dx, ty: dy };
            let g = about_centre(&f, |x, y| { let q = s.apply((x, y)); (q.0, q.1) });
            let v = scorer().shape(&marks(&g), false, W).unwrap().unwrap();
            assert!(rel(v.d2, base.d2) < 1e-9 && rel(v.d2_mirror, base.d2_mirror) < 1e-9, "×{k} turn {t} shift ({dx},{dy}): {v:?} vs {base:?}");
            assert_eq!((v.mirrored, v.unusual, v.line), (base.mirrored, base.unusual, base.line));
        }
    }
    /// Spec §12 "Flipped film": faced right first, as Stage A. Fails if `facing_left` is ignored.
    #[test] fn a_left_facing_film_is_faced_right_first() {
        let f = faces(1, 7).remove(0);
        let left: Vec<Pt> = f.iter().map(|p| ((W - 1) as f64 - p.0, p.1)).collect();
        let (r, l) = (scorer().shape(&marks(&f), false, W).unwrap().unwrap(), scorer().shape(&marks(&left), true, W).unwrap().unwrap());
        assert!(rel(r.d2, l.d2) < 1e-9 && !l.mirrored, "{r:?} {l:?}");
        assert!(scorer().shape(&marks(&left), false, W).unwrap().unwrap().mirrored, "control: the same marks read as facing right are mirrored");
    }
    /// Spec §12 "Too few points": < 12 → not run (None), 12 → runs. Fails if MIN_POINTS is not used, or `<=` is used.
    #[test] fn too_few_points_does_not_run_and_twelve_does() {
        let f = faces(1, 7).remove(0);
        let mut m = marks(&f); m.truncate(11);
        assert_eq!(scorer().shape(&m, false, W).unwrap(), None);
        let mut m = marks(&f); m.truncate(12);
        assert_eq!(scorer().shape(&m, false, W).unwrap().unwrap().present, 12);
        // S or N missing: runs on the other 18, on a line fitted for those 18.
        for gone in ["S", "N"] {
            let m: Vec<Mark> = marks(&f).into_iter().filter(|x| x.landmark_id != gone).collect();
            let v = scorer().shape(&m, false, W).unwrap().unwrap();
            let present: Vec<usize> = (0..19).filter(|&k| ORDER[k] != gone).collect();
            assert_eq!((v.present, v.line), (18, scorer().line_for(&present).unwrap()), "{gone} missing");
        }
    }
    /// A face whose jaw points sit where the cranial base should (a whole region on the wrong structure): unusual,
    /// not mirrored. Fails if `unusual` is computed as `mirrored`, or the line is not applied.
    #[test] fn a_scrambled_face_is_unusual_not_mirrored() {
        let mut f = faces(1, 7).remove(0);
        for (j, c) in JAW.iter().zip([0usize, 1, 2, 3, 18, 16]) { f.swap(*j, c); }
        let v = scorer().shape(&marks(&f), false, W).unwrap().unwrap();
        assert!(v.unusual && !v.mirrored && v.d2 > v.line, "{v:?}");
    }
    /// SC1-1a's folds rest on this. Fails if leave_out keeps a left-out tracing, or drops the wrong one.
    #[test] fn leave_out_equals_a_scorer_built_without_those_tracings() {
        let train = faces(120, 4);
        let out = [3usize, 50, 77];
        let a = scorer().leave_out(&out).unwrap();
        let b = WholeScorer::new(train.iter().enumerate().filter(|(i, _)| !out.contains(i)).map(|(_, t)| t.clone()).collect()).unwrap();
        let probe = faces(1, 11).remove(0);
        assert_eq!(a.films(), 117);
        assert_eq!(a.d2_of(&probe, &all()).unwrap().to_bits(), b.d2_of(&probe, &all()).unwrap().to_bits());
        assert_eq!(a.line_for(&all()).unwrap().to_bits(), b.line_for(&all()).unwrap().to_bits());
        assert!(!a.names().iter().any(|n| ["004", "051", "078"].contains(&n.as_str())), "the left-out names are gone");
        assert!(scorer().leave_out(&[120]).unwrap_err().to_string().contains("120"));
        assert!(scorer().leave_out(&[5, 5]).unwrap_err().to_string().contains("twice"));
    }
    /// Spec §12 "A model with fewer points": ids outside the 19 ignored; a duplicate or a NaN is an error (as Stage A).
    #[test] fn other_ids_are_ignored_and_a_duplicate_or_a_nan_is_an_error() {
        let f = faces(1, 7).remove(0);
        let mut m = marks(&f); m.retain(|x| !["Po", "Or", "Ar", "PNS"].contains(&x.landmark_id.as_str()));
        m.push(Mark { landmark_id: "Ba".into(), x: 1.0, y: 1.0 });
        assert_eq!(scorer().shape(&m, false, W).unwrap().unwrap().present, 15);
        let mut d = marks(&f); d.push(d[0].clone());
        assert!(scorer().shape(&d, false, W).unwrap_err().to_string().contains("twice"));
        let mut n = marks(&f); n[3].x = f64::NAN;
        assert!(scorer().shape(&n, false, W).unwrap_err().to_string().contains("not a number"));
    }
    /// Spec §3.2: the note names the furthest of five fixed ratios and angles; the naming never sets the flag. Fails if
    /// an angle is measured at the wrong vertex (checked against acos here, an independent formula), or the naming
    /// does not pick the largest |z|.
    #[test] fn the_named_measures_are_the_fixed_five_and_name_the_furthest() {
        let f = faces(1, 7).remove(0);
        let p: Vec<Option<Pt>> = f.iter().map(|q| Some(*q)).collect();
        let acos = |at: Pt, a: Pt, b: Pt| { let (u, v) = ((a.0 - at.0, a.1 - at.1), (b.0 - at.0, b.1 - at.1));
            ((u.0 * v.0 + u.1 * v.1) / (u.0.hypot(u.1) * v.0.hypot(v.1))).acos().to_degrees() };
        let v = measure_values(&p);
        let d = |i: usize, j: usize| (f[i].0 - f[j].0).hypot(f[i].1 - f[j].1);
        assert!((v[0].unwrap() - d(0, 1) / d(1, 7)).abs() < 1e-12);                 // S–N : N–Me
        assert!((v[1].unwrap() - acos(f[1], f[0], f[4])).abs() < 1e-9);             // SNA at N
        assert!((v[2].unwrap() - acos(f[1], f[0], f[5])).abs() < 1e-9);             // SNB at N
        assert!((v[3].unwrap() - (v[1].unwrap() - v[2].unwrap())).abs() < 1e-12);  // ANB = SNA − SNB
        assert!((v[4].unwrap() - acos(f[9], f[18], f[7])).abs() < 1e-9);            // Ar–Go–Me at Go
        let mut b = f.clone(); b[5].0 += 300.0;                                     // B 30 mm forward: SNB and ANB move
        let named = scorer().named(&marks(&b), false, W).unwrap();
        assert_eq!(named.len(), 2);
        assert!(named.contains(&"SNB") && named.contains(&"ANB"), "{named:?}");
        let mut gone = p.clone(); gone[4] = None;
        assert_eq!((measure_values(&gone)[1], measure_values(&gone)[3]), (None, None), "A absent: SNA and ANB not measured");
    }
    /// The 300 tracings' names come from the file (SC1-1a's folds and the homework guard need them). Fails if
    /// `parse_prior` does not fill `names`, or fills them out of order.
    #[test] fn from_prior_keeps_the_film_numbers_in_file_order() {
        let films: Vec<(String, Vec<Pt>)> = faces(300, 4).into_iter().enumerate().map(|(i, t)| (format!("{:03}", i + 1), t)).collect();
        let p = crate::pointcheck::parse_prior(crate::pointcheck::prior_json(&films).unwrap().as_bytes()).unwrap();
        assert_eq!(p.names.len(), 300);
        assert_eq!((p.names[0].as_str(), p.names[149].as_str(), p.names[299].as_str()), ("001", "150", "300"));
        let s = WholeScorer::from_prior(&p).unwrap();
        assert_eq!((s.films(), s.names()[150].as_str()), (300, "151"));
    }
    /// Ruling P8: the nearest-rank helper on its own, on 1..=1000 (at n = 120 the 99.5th percentile is the largest
    /// value, so the 120-tracing test above cannot tell this rank from "the maximum"). Fails if the helper returns the
    /// maximum, uses a floor rank (⌊995 n / 1000⌋ is the same here, so 990 at n = 999 is also checked), or is off by one.
    #[test] fn nearest_rank_picks_the_ceil_rank_not_the_maximum() {
        let v: Vec<f64> = (1..=1000).map(|i| i as f64).collect();
        assert_eq!((nearest_rank(&v, 995).unwrap(), nearest_rank(&v, 990).unwrap()), (995.0, 990.0));
        let w: Vec<f64> = (1..=999).map(|i| i as f64).collect();          // ⌈990·999/1000⌉ = ⌈989.01⌉ = 990
        assert_eq!(nearest_rank(&w, 990).unwrap(), 990.0);
        assert!(nearest_rank(&[], 995).unwrap_err().to_string().contains("no values"));
    }
    /// Carry-over M2 (Task 1 review): `present` is checked before either cache is read. Fails if `line_for` looks up its
    /// cache first (the reversed list has the same mask as the cached ascending one, so it is answered from the cache;
    /// an index of 40 overflows the mask's shift and panics instead of refusing).
    #[test] fn line_for_checks_present_before_its_cache() {
        scorer().line_for(&all()).unwrap();                                         // cached
        let rev: Vec<usize> = (0..19).rev().collect();
        assert!(scorer().line_for(&rev).unwrap_err().to_string().contains("ascending"), "reversed: refused, not cached");
        let mut dup = all(); dup[1] = 0;
        assert!(scorer().line_for(&dup).is_err(), "a repeated index: refused");
        let mut big = all(); big[18] = 40;
        assert!(scorer().line_for(&big).is_err(), "an index past 19: refused, not a panic");
        assert!(scorer().line_for(&[]).is_err(), "nothing present: refused");
    }
    /// Lock fix (Task 7 review): `warm` fits the line for the marks' own present set. Fails if `warm` fits nothing (the
    /// set is not cached afterwards), fits another set, or fits when too few points are present.
    #[test] fn warm_fits_the_line_for_the_present_set_of_these_marks() {
        let s = WholeScorer::new(faces(40, 4)).unwrap();
        let f = faces(1, 7).remove(0);
        let mk: Vec<Mark> = marks(&f).into_iter().filter(|m| m.landmark_id != "Po" && m.landmark_id != "PNS").collect();
        let present: Vec<usize> = (0..19).filter(|&k| ORDER[k] != "Po" && ORDER[k] != "PNS").collect();
        assert!(s.cached_line_sets().is_empty(), "a new scorer has no line cached");
        assert_eq!(s.warm(&mk, false, W).unwrap(), Some(present.clone()));
        assert_eq!(s.cached_line_sets(), vec![present.clone()], "the marks' set is cached, and only it");
        let few: Vec<Mark> = marks(&f).into_iter().take(MIN_POINTS - 1).collect();
        assert_eq!(s.warm(&few, false, W).unwrap(), None, "too few points: nothing fitted");
        assert_eq!(s.cached_line_sets(), vec![present], "too few points: nothing added");
    }
    /// The warm-up moves only WHERE the line is fitted, never a result: the same marks give the same FilmResult (as JSON
    /// bytes) from a scorer warmed first and from a cold one. Induced failure (see warm-report): `warm` storing a wrong
    /// line under the set's key makes the bytes differ.
    #[test] fn a_warmed_scorer_gives_the_same_result_as_a_cold_one() {
        let f = faces(1, 7).remove(0);
        let mut wild = f.clone(); for k in [5usize, 7, 9] { wild[k].1 += 400.0; }
        for (name, pts) in [("face", &f), ("mandible moved", &wild)] {
            let mk: Vec<Mark> = marks(pts).into_iter().filter(|m| m.landmark_id != "Or" && m.landmark_id != "Gn").collect();
            let (cold, warmed) = (WholeScorer::new(faces(40, 4)).unwrap(), WholeScorer::new(faces(40, 4)).unwrap());
            assert!(warmed.warm(&mk, false, W).unwrap().is_some());
            let run = |s: &WholeScorer| serde_json::to_vec(&check_film(Some(s), &mk, false, W, W, RegionLook::NotRun(Look::NoRegionModel), &FilmCal::tau_only(&RegionTau([0.05; 5]))).unwrap()).unwrap();
            let (a, b) = (run(&cold), run(&warmed));
            eprintln!("{name}: {}", String::from_utf8_lossy(&a));
            assert_eq!(a, b, "{name}: warmed and cold results differ");
        }
    }
    /// Carry-over M3: `d2_of` refuses a list that is not 19 points. Fails if it indexes `pts` unchecked (a panic).
    #[test] fn d2_of_refuses_a_list_that_is_not_19_points() {
        let f = faces(1, 7).remove(0);
        let e = scorer().d2_of(&f[..10], &(0..10).collect::<Vec<_>>()).unwrap_err().to_string();
        assert!(e.contains("19"), "{e}");
    }

    // ---- Task 2: regions, facing, check_film, teaching boxes, box quality, the calibration file ----
    const H: u32 = 2400;
    fn face() -> Vec<Pt> { faces(1, 7).remove(0) }
    fn named_pts(f: &[Pt]) -> Vec<(String, f64, f64)> { ORDER.iter().zip(f).map(|(id, p)| (id.to_string(), p.0, p.1)).collect() }
    /// The face's own expert-rule boxes as a stand-in detector (score 0.9 each).
    fn own_regions(f: &[Pt]) -> Regions {
        let b: Vec<RegionBox> = teaching_boxes(&named_pts(f), W, H).into_iter().map(|b| RegionBox { score: 0.9, ..b }).collect();
        Regions::from_scored(&b, 0.5, &"a".repeat(64)).unwrap()
    }
    const TAU: RegionTau = RegionTau([0.05; 5]);
    fn reasons(r: &FilmResult) -> Vec<Reason> { match &r.check { FilmCheck::Flagged { reasons } => reasons.clone(), _ => vec![] } }
    fn region_ids(r: &FilmResult, reg: Region) -> Vec<String> {
        reasons(r).into_iter().filter_map(|x| match x { Reason::Region { region, outside, .. } if region == reg => Some(outside.into_iter().map(|o| o.0).collect::<Vec<_>>()), _ => None }).flatten().collect()
    }
    trait CloneFilms { fn clone_regions(&self) -> Vec<FilmBoxes>; }
    impl CloneFilms for Vec<FilmBoxes> {
        fn clone_regions(&self) -> Vec<FilmBoxes> { self.iter().map(|x| FilmBoxes { detected: x.detected.clone(), expert: x.expert.clone(), mm_per_px: x.mm_per_px }).collect() }
    }

    /// The constants are the spec's and this plan's; changing one needs the owner and whole-film/2.
    #[test] fn the_constants_are_pinned() {
        assert_eq!((RULE_VERSION, LINE_PER_MILLE, TEACH_MARGIN, MIN_REGIONS_FOUND, MIN_FILM_SIDE, BOX_GATE_MIN_MEDIAN_IOU),
                   ("whole-film/3", 995, 0.10, 3, 256, 0.5));
        assert_eq!(REGION_OF.len(), 19);
        let mut ids: Vec<&str> = REGION_OF.iter().map(|x| x.0).collect(); ids.sort();
        let mut want: Vec<&str> = ORDER.to_vec(); want.sort();
        assert_eq!(ids, want, "each of the 19 points in exactly one region");
        assert_eq!(REGIONS.map(|r| r.key()), ["cranial-base", "maxilla", "mandible", "incisors", "soft-tissue"]);
    }
    /// Rulings P13/P14: the stored keys (kebab-case) for every variant, the words, the index order, `from_key` its
    /// inverse, and the IPC names (serde camelCase). Fails if a key is misspelt, a region's index is out of the canonical
    /// order (cranial base, maxilla, mandible, incisors, soft-tissue profile), or serde is switched to the stored keys.
    #[test] fn every_region_and_reason_has_its_stored_key() {
        let want = [(Region::CranialBase, "cranial-base", "cranial base", "\"cranialBase\""), (Region::Maxilla, "maxilla", "maxilla", "\"maxilla\""),
                    (Region::Mandible, "mandible", "mandible", "\"mandible\""), (Region::Incisors, "incisors", "incisors", "\"incisors\""),
                    (Region::SoftTissue, "soft-tissue", "soft-tissue profile", "\"softTissue\"")];
        for (i, (r, key, words, ipc)) in want.iter().enumerate() {
            assert_eq!((r.key(), r.words(), r.index(), Region::from_key(key), REGIONS[i]), (*key, *words, i, Some(*r), *r));
            assert_eq!(serde_json::to_string(r).unwrap(), *ipc);
            assert_eq!(serde_json::from_str::<Region>(ipc).unwrap(), *r);
        }
        assert_eq!(Region::from_key("cranialBase"), None, "from_key reads the stored keys only");
        let reasons = [(Reason::Mirrored, "mirrored"), (Reason::Shape { named: vec![] }, "shape"),
                       (Reason::Region { region: Region::Maxilla, outside: vec![], centre: None }, "region"), (Reason::Facing, "facing"), (Reason::NoCephFound, "no-ceph-found")];
        for (r, key) in &reasons { assert_eq!(r.key(), *key); }
        assert_eq!(serde_json::to_value(&Reason::NoCephFound).unwrap()["kind"], "noCephFound", "IPC stays camelCase");
    }
    /// A clean face on its own boxes: clean. Control for the plants below (C2, C3 and C8 must move from this).
    #[test] fn a_clean_face_on_its_own_boxes_is_clean() {
        let f = face();
        let r = check_film(Some(scorer()), &marks(&f), false, W, H, RegionLook::Found(&own_regions(&f)), &FilmCal::tau_only(&TAU)).unwrap();
        assert_eq!((r.check.clone(), r.shape_look, r.region_look, r.present), (FilmCheck::Clean, Look::Judged, Look::Judged, 19), "{r:?}");
    }
    /// Control C3 at unit level: the mandible 40 mm (400 px at 0.1 mm/px) forward leaves the mandible box. Fails if
    /// the region test is dropped or uses the wrong box.
    #[test] fn the_mandible_moved_40_mm_is_a_mandible_region_flag() {
        let f = face(); let boxes = own_regions(&f);
        let mut g = f.clone();
        for (id, reg) in REGION_OF { if reg == Region::Mandible { let k = ORDER.iter().position(|o| *o == id).unwrap(); g[k].0 += 400.0; } }
        let r = check_film(Some(scorer()), &marks(&g), false, W, H, RegionLook::Found(&boxes), &FilmCal::tau_only(&TAU)).unwrap();
        let ids = region_ids(&r, Region::Mandible);
        eprintln!("C3 mandible +40 mm: {:?}", reasons(&r));
        for id in ["Me", "Pog", "B", "Gn"] { assert!(ids.contains(&id.to_string()), "{id} not outside: {r:?}"); }
    }
    /// Controls C2 and C8 at unit level (OQ-8: shape cannot see size; the regions can). Fails if off-film points are
    /// not outside every box, or the region look is skipped.
    #[test] fn a_tracing_at_double_size_or_in_metres_is_a_region_flag() {
        let f = face(); let boxes = own_regions(&f);
        let x2 = about_centre(&f, |x, y| (2.0 * x, 2.0 * y));
        let r = check_film(Some(scorer()), &marks(&x2), false, W, H, RegionLook::Found(&boxes), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("C2 x2: {:?}", reasons(&r).iter().map(|x| x.key()).collect::<Vec<_>>());
        assert!(reasons(&r).iter().any(|x| matches!(x, Reason::Region { .. })), "×2: {r:?}");
        assert!(!reasons(&r).iter().any(|x| matches!(x, Reason::Mirrored | Reason::Shape { .. })), "shape is scale-free: {r:?}");
        // Carry-over (a): half size on its own boxes is a region flag too. Fails if the region look only caught points
        // that fall outside because they grew (e.g. the ratio were folded to a one-sided test).
        let half = about_centre(&f, |x, y| (0.5 * x, 0.5 * y));
        let r = check_film(Some(scorer()), &marks(&half), false, W, H, RegionLook::Found(&boxes), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("C2 x0.5: {:?}", reasons(&r).iter().map(|x| x.key()).collect::<Vec<_>>());
        assert!(reasons(&r).iter().any(|x| matches!(x, Reason::Region { .. })), "×0.5: {r:?}");
        assert!(!reasons(&r).iter().any(|x| matches!(x, Reason::Mirrored | Reason::Shape { .. })), "shape is scale-free at ×0.5: {r:?}");
        let m: Vec<Pt> = f.iter().map(|p| (p.0 * 1000.0, p.1 * 1000.0)).collect();
        let r = check_film(Some(scorer()), &marks(&m), false, W, H, RegionLook::Found(&boxes), &FilmCal::tau_only(&TAU)).unwrap();
        let off: usize = reasons(&r).iter().map(|x| match x { Reason::Region { outside, .. } => outside.iter().filter(|o| o.1.is_none()).count(), _ => 0 }).sum();
        eprintln!("C8 x1000: {off} of 19 off the film; reasons {:?}", reasons(&r).iter().map(|x| x.key()).collect::<Vec<_>>());
        assert_eq!(off, 19, "×1000: every point off the film: {r:?}");
    }
    /// τ_r is applied strictly and per region (RV-1). Fails if `>` becomes `>=`, or one τ is used for all regions.
    #[test] fn tau_is_strict_and_per_region() {
        let b = RegionBox { region: Region::Incisors, x0: 100.0, y0: 100.0, x1: 200.0, y1: 150.0, score: 0.9 };
        assert_eq!((outside_ratio(&b, (150.0, 120.0)), outside_ratio(&b, (200.0, 150.0)), outside_ratio(&b, (210.0, 125.0))), (0.0, 0.0, 0.1));
        assert!((outside_ratio(&b, (203.0, 154.0)) - 0.05).abs() < 1e-12);          // 3-4-5 from the corner
        // U1T at whole-pixel (1500, 1500); an incisor box 100 px square whose right edge is 10 px to its left: the
        // ratio is exactly 10.0 / 100.0 (both whole numbers, so no rounding decides the test).
        let f = face();
        let k = ORDER.iter().position(|o| *o == "U1T").unwrap();
        let mut g = f.clone(); g[k] = (1500.0, 1500.0);
        let mut regs = own_regions(&f);
        regs.boxes.retain(|x| x.region != Region::Incisors);
        regs.boxes.push(RegionBox { region: Region::Incisors, x0: 1390.0, y0: 1450.0, x1: 1490.0, y1: 1550.0, score: 0.9 });
        assert_eq!(outside_ratio(regs.get(Region::Incisors).unwrap(), g[k]), 10.0 / 100.0);
        let run = |t: [f64; 5]| check_film(Some(scorer()), &marks(&g), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&RegionTau(t))).unwrap();
        let mut t = TAU.0; t[Region::Incisors.index()] = 0.1;
        assert!(!region_ids(&run(t), Region::Incisors).contains(&"U1T".to_string()), "exactly at τ: not outside");
        t[Region::Incisors.index()] = 0.0999;
        assert!(region_ids(&run(t), Region::Incisors).contains(&"U1T".to_string()), "just beyond τ_incisors: outside");
        // Per region: a tight τ on every OTHER region leaves U1T's verdict to τ_incisors alone.
        let mut t2 = [0.0001; 5]; t2[Region::Incisors.index()] = 0.1;
        assert!(!region_ids(&run(t2), Region::Incisors).contains(&"U1T".to_string()), "τ_incisors decides U1T, not another region's τ");
        // A τ that is not a number, or negative, could never (or always) flag: refused. Fails if τ is not checked.
        for bad in [f64::NAN, -0.1, f64::INFINITY] {
            let mut t3 = TAU.0; t3[2] = bad;
            assert!(check_film(Some(scorer()), &marks(&g), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&RegionTau(t3))).is_err(), "τ {bad} refused");
        }
    }
    /// Spec §3.4. Fails if the detector's facing is ignored, or `from_scored` reads facing from the wrong boxes.
    #[test] fn the_detector_facing_the_other_way_is_a_facing_flag() {
        let f = face();
        let mut regs = own_regions(&f);
        assert_eq!(regs.facing_left, Some(false), "profile in front of the cranial base: facing right");
        regs.facing_left = Some(true);
        let r = check_film(Some(scorer()), &marks(&f), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap();
        assert_eq!(reasons(&r), vec![Reason::Facing]);
        let flipped: Vec<RegionBox> = own_regions(&f).boxes.iter().map(|b| RegionBox { x0: (W - 1) as f64 - b.x1, x1: (W - 1) as f64 - b.x0, ..*b }).collect();
        assert_eq!(Regions::from_scored(&flipped, 0.5, &"a".repeat(64)).unwrap().facing_left, Some(true), "boxes of a flipped film face left");
    }
    /// Spec §12 "Flipped film" (the brief's test line, ruling P16): a left-facing tracing on its left-facing film's boxes,
    /// stored facing left, is clean, and the same with the stored facing wrong is a facing flag. Fails if `check_film`
    /// judges the boxes against the faced-right points (the boxes are in film px as stored), or the facing is not read.
    #[test] fn a_left_facing_tracing_on_left_facing_boxes_is_clean() {
        let left: Vec<Pt> = face().iter().map(|p| ((W - 1) as f64 - p.0, p.1)).collect();
        let regs = own_regions(&left);
        assert_eq!(regs.facing_left, Some(true));
        let r = check_film(Some(scorer()), &marks(&left), true, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("flipped film, stored left: {:?}", r.check);
        assert_eq!(r.check, FilmCheck::Clean, "{r:?}");
        let r = check_film(Some(scorer()), &marks(&left), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("flipped film, stored right: {:?}", reasons(&r).iter().map(|x| x.key()).collect::<Vec<_>>());
        assert!(reasons(&r).contains(&Reason::Facing), "{r:?}");
    }
    /// Control C1 through check_film: a mirrored tracing gives `mirrored` (and the tracing witness gives `facing`),
    /// with or without a region model. Fails if the mirrored reason is dropped when regions are not run.
    #[test] fn a_mirrored_tracing_is_flagged_with_or_without_a_region_model() {
        let m = about_centre(&face(), |x, y| (-x, y));
        for look in [RegionLook::NotRun(Look::NoRegionModel), RegionLook::NotRun(Look::NotSetUp)] {
            let r = check_film(Some(scorer()), &marks(&m), false, W, H, look, &FilmCal::tau_only(&TAU)).unwrap();
            assert_eq!(reasons(&r), vec![Reason::Mirrored, Reason::Facing], "{r:?}");
        }
    }
    /// Spec §12 "RF-DETR finds no ceph": < 3 of 5 found → no-ceph-found; the shape still runs. Fails if
    /// MIN_REGIONS_FOUND is 2, or the shape is skipped.
    #[test] fn two_boxes_found_is_no_ceph_found_and_the_shape_still_runs() {
        let f = face(); let mut regs = own_regions(&f);
        regs.boxes.truncate(2);
        let r = check_film(Some(scorer()), &marks(&f), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("no ceph found (2 of 5): {:?}, shape {:?}", r.check, r.shape_look);
        assert_eq!((reasons(&r), r.shape_look), (vec![Reason::NoCephFound], Look::Judged));
        regs = own_regions(&f); regs.boxes.truncate(3);
        assert_eq!(check_film(Some(scorer()), &marks(&f), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap().check, FilmCheck::Clean, "3 found: judged");
    }
    /// Spec §12 "No region model installed", "Very small film", and no tracings file: the app keeps working.
    #[test] fn without_a_region_model_the_shape_runs_and_without_both_it_is_not_run() {
        let f = face();
        for l in [Look::NoRegionModel, Look::NotSetUp, Look::FilmTooSmall] {
            let r = check_film(Some(scorer()), &marks(&f), false, W, H, RegionLook::NotRun(l), &FilmCal::tau_only(&TAU)).unwrap();
            eprintln!("regions {l:?}: {:?} shape {:?}", r.check, r.shape_look);
            assert_eq!((r.check.clone(), r.shape_look, r.region_look), (FilmCheck::Clean, Look::Judged, l));
        }
        let r = check_film(None, &marks(&f), false, W, H, RegionLook::NotRun(Look::NoRegionModel), &FilmCal::tau_only(&TAU)).unwrap();
        assert_eq!(r.check, FilmCheck::NotRun { why: NotRunWhy::NoRegionModel });
        let r = check_film(None, &marks(&f), false, W, H, RegionLook::NotRun(Look::NotSetUp), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("not set up (no tracings file, no calibration): {:?}", r.check);
        assert_eq!(r.check, FilmCheck::NotRun { why: NotRunWhy::NotSetUp });
        let mut m = marks(&f); m.truncate(9);
        let r = check_film(Some(scorer()), &m, false, W, H, RegionLook::NotRun(Look::NoRegionModel), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("9 points, no region model: {:?}", r.check);
        assert_eq!(r.check, FilmCheck::NotRun { why: NotRunWhy::TooFewPoints { present: 9 } });
        // Too few for the shape, but regions still check each present point (spec §12).
        let mut g = f.clone(); g[0].0 += 900.0;                                       // S far out of the cranial base box
        let mut m = marks(&g); m.truncate(9);
        let r = check_film(Some(scorer()), &m, false, W, H, RegionLook::Found(&own_regions(&f)), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("9 points, boxes, S moved 90 mm: {:?}", r.check);
        assert_eq!((r.shape_look, region_ids(&r, Region::CranialBase)), (Look::TooFewPoints, vec!["S".to_string()]));
        // A region look that is not a reason it did not run is refused. Fails if NotRun(Judged) is accepted.
        assert!(check_film(Some(scorer()), &marks(&f), false, W, H, RegionLook::NotRun(Look::Judged), &FilmCal::tau_only(&TAU)).is_err());
    }
    /// The score line is inclusive. Fails if `>=` becomes `>`.
    #[test] fn a_box_at_the_score_line_is_kept_and_one_below_is_not() {
        let b = |r, s| RegionBox { region: r, x0: 0.0, y0: 0.0, x1: 10.0, y1: 10.0, score: s };
        let regs = Regions::from_scored(&[b(Region::Maxilla, 0.30), b(Region::Mandible, 0.29)], 0.30, &"a".repeat(64)).unwrap();
        assert_eq!((regs.found(), regs.get(Region::Maxilla).is_some(), regs.get(Region::Mandible).is_none()), (1, true, true));
        assert!(Regions::from_scored(&[b(Region::Maxilla, 0.9), b(Region::Maxilla, 0.8)], 0.3, &"a".repeat(64)).is_err(), "two boxes for one region");
    }
    /// Ruling P16: a degenerate detector box (zero or negative width or height, or a coordinate that is not a number)
    /// above the score line is "not found" for its region: never a panic, never an error that fails the check. Fails
    /// if `from_scored` keeps it (its longer side 0 divides by zero, or a negative box is used), or refuses it.
    #[test] fn a_degenerate_box_counts_as_not_found() {
        let f = face();
        let good = own_regions(&f).boxes;
        let mand = *good.iter().find(|b| b.region == Region::Mandible).unwrap();
        for (bad, why) in [(RegionBox { x1: mand.x0, ..mand }, "zero width"), (RegionBox { y1: mand.y0 - 5.0, ..mand }, "negative height"),
                           (RegionBox { x0: f64::NAN, ..mand }, "NaN"), (RegionBox { x0: mand.x0, y0: mand.y0, x1: mand.x0, y1: mand.y0, ..mand }, "a point")] {
            let boxes: Vec<RegionBox> = good.iter().map(|b| if b.region == Region::Mandible { bad } else { *b }).collect();
            let regs = Regions::from_scored(&boxes, 0.5, &"a".repeat(64)).unwrap();
            assert_eq!((regs.found(), regs.get(Region::Mandible).is_none()), (4, true), "{why}");
            assert!(regs.boxes.iter().all(|b| b.region != Region::Mandible), "{why}: not stored as a found box");
            // The mandible moved 40 mm: with its box not found, only off-film points judge it, so no mandible flag.
            let mut g = f.clone();
            for (id, reg) in REGION_OF { if reg == Region::Mandible { let k = ORDER.iter().position(|o| *o == id).unwrap(); g[k].0 += 400.0; } }
            let r = check_film(Some(scorer()), &marks(&g), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap();
            assert!(region_ids(&r, Region::Mandible).is_empty(), "{why}: {r:?}");
        }
        // Pushed straight into `boxes` (bypassing from_scored), a degenerate box is still not found.
        let mut regs = own_regions(&f);
        regs.boxes.retain(|b| b.region != Region::Incisors);
        regs.boxes.push(RegionBox { region: Region::Incisors, x0: 5.0, y0: 5.0, x1: 5.0, y1: 9.0, score: 0.9 });
        assert_eq!((regs.found(), regs.get(Region::Incisors).is_none()), (4, true));
        assert_eq!(check_film(Some(scorer()), &marks(&f), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap().check, FilmCheck::Clean);
    }
    /// The teaching rule (spec §3.3, §4.2). Fails if the margin, the extras or the clipping change.
    #[test] fn teaching_boxes_use_the_margin_the_extras_and_clip_to_the_film() {
        let pts = vec![("U1T".to_string(), 100.0, 100.0), ("L1T".to_string(), 140.0, 130.0), ("U1A".to_string(), 60.0, 40.0), ("L1A".to_string(), 50.0, 200.0)];
        let b = teaching_boxes(&pts, 1000, 1000);
        let inc = b.iter().find(|x| x.region == Region::Incisors).unwrap();
        // points span x 50..140, y 40..200: longer side 160, margin 16
        assert_eq!((inc.x0, inc.y0, inc.x1, inc.y1), (34.0, 24.0, 156.0, 216.0));
        assert!(b.iter().all(|x| x.region != Region::CranialBase), "no cranial-base points: no box");
        let edge = teaching_boxes(&[("U1T".to_string(), 2.0, 2.0), ("L1T".to_string(), 50.0, 50.0)], 100, 100);
        assert_eq!((edge[0].x0, edge[0].y0), (0.0, 0.0), "clipped to the film");
    }
    /// Carry-overs (b) and (c). (b) a point on a zero-size box reads outside (infinity), never NaN (0/0): fails if the
    /// guard on `longer_side() <= 0` is removed. (c) a region whose clipped box is inverted or empty (all its points off
    /// the film) is skipped, not emitted: fails if the emptiness check is removed.
    #[test] fn a_zero_size_box_reads_outside_and_an_off_film_region_makes_no_teaching_box() {
        let z = RegionBox { region: Region::Incisors, x0: 50.0, y0: 50.0, x1: 50.0, y1: 50.0, score: 0.9 };
        let (on, off) = (outside_ratio(&z, (50.0, 50.0)), outside_ratio(&z, (60.0, 50.0)));
        eprintln!("zero-size box: point on it {on}, point off it {off}");
        assert!(on.is_infinite() && off.is_infinite(), "{on} {off}");
        let inv = RegionBox { x1: 40.0, ..z };
        assert!(outside_ratio(&inv, (45.0, 50.0)).is_infinite(), "an inverted box too");
        // Both incisor points beyond the film's right edge (x 500, 520 on a 100-wide film): clipping gives x0 = 498 > x1 = 99.
        let off = teaching_boxes(&[("U1T".to_string(), 500.0, 50.0), ("L1T".to_string(), 520.0, 60.0)], 100, 100);
        eprintln!("all points off the film: {} boxes", off.len());
        assert!(off.iter().all(|b| b.region != Region::Incisors), "{off:?}");
        let neg = teaching_boxes(&[("U1T".to_string(), -50.0, -50.0), ("L1T".to_string(), -30.0, -40.0)], 100, 100);
        assert!(neg.iter().all(|b| b.region != Region::Incisors), "{neg:?}");
        let on_film = teaching_boxes(&[("U1T".to_string(), 10.0, 10.0), ("L1T".to_string(), 30.0, 40.0)], 100, 100);
        assert!(on_film.iter().any(|b| b.region == Region::Incisors), "control: a region on the film still gets its box");
    }
    /// RV-1 and control C9 at unit level. Fails if an inflated box does not trip the gate, if a region not found is
    /// left out of the IoU, or if the median of an even count is not the mean of the two middle values.
    #[test] fn box_quality_and_the_gate_trip_on_boxes_inflated_twofold() {
        let f = face();
        let expert = teaching_boxes(&named_pts(&f), W, H);
        let films: Vec<FilmBoxes> = (0..4).map(|_| FilmBoxes { detected: own_regions(&f), expert: expert.clone(), mm_per_px: Some(0.1) }).collect();
        let q = box_quality(&films).unwrap();
        assert!(q.iter().all(|x| x.iou_median == 1.0 && x.centre_err_median == 0.0 && x.in_mm && x.films == 4), "{q:?}");
        assert!(gate_passes(&q));
        let inflated: Vec<FilmBoxes> = films.iter().map(|x| FilmBoxes { detected: Regions { boxes: x.detected.boxes.iter().map(|b| b.inflated(2.0)).collect(), ..x.detected.clone() }, expert: x.expert.clone(), mm_per_px: x.mm_per_px }).collect();
        let q2 = box_quality(&inflated).unwrap();
        eprintln!("C9 inflated x2: median IoU per region {:?}; gate passes: {}", q2.iter().map(|x| (x.region.key(), x.iou_median)).collect::<Vec<_>>(), gate_passes(&q2));
        assert!(q2.iter().all(|x| (x.iou_median - 0.25).abs() < 1e-9), "{q2:?}");
        assert!(!gate_passes(&q2), "C9: the gate must trip");
        let mut missing = films.clone_regions();
        missing[0].detected.boxes.retain(|b| b.region != Region::Maxilla);
        missing[1].detected.boxes.retain(|b| b.region != Region::Maxilla);
        let q3 = box_quality(&missing).unwrap();
        let mx = q3.iter().find(|x| x.region == Region::Maxilla).unwrap();
        assert_eq!((mx.not_found, mx.iou_median), (2, 0.5), "IoUs 0, 0, 1, 1: median 0.5, and the gate passes AT 0.5");
        assert!(gate_passes(&q3));
        let mut fraction = films.clone_regions(); fraction[3].mm_per_px = None;
        assert!(box_quality(&fraction).unwrap().iter().all(|x| !x.in_mm), "one film without a scale: fractions for all");
        assert!(!gate_passes(&[]), "nothing measured: the gate does not pass");
    }
    /// Ruling P9: a known, non-zero centre error. The maxilla's detected box is shifted by (0,0), (30,40), (60,80),
    /// (90,120) px on four films: errors 0, 50, 100, 150 px = 0, 5, 10, 15 mm at 0.1 mm/px. Median (5 + 10) / 2 = 7.5 mm;
    /// p90 by nearest rank = the ⌈3.6⌉ = 4th = 15 mm; as fractions, each ÷ the expert box's longer side. Fails if the
    /// centre error is measured from a corner, not converted to mm, the even median takes one middle value, or the p90
    /// is interpolated (13.5) or a floor rank (10).
    #[test] fn box_quality_centre_error_median_p90_and_mm() {
        let f = face();
        let expert = teaching_boxes(&named_pts(&f), W, H);
        let shifts = [(0.0, 0.0), (30.0, 40.0), (60.0, 80.0), (90.0, 120.0)];
        let films: Vec<FilmBoxes> = shifts.iter().map(|&(dx, dy)| {
            let mut d = own_regions(&f);
            for b in d.boxes.iter_mut().filter(|b| b.region == Region::Maxilla) { b.x0 += dx; b.x1 += dx; b.y0 += dy; b.y1 += dy; }
            FilmBoxes { detected: d, expert: expert.clone(), mm_per_px: Some(0.1) }
        }).collect();
        let q = box_quality(&films).unwrap();
        let mx = *q.iter().find(|x| x.region == Region::Maxilla).unwrap();
        eprintln!("P9 maxilla centre error: median {} mm, p90 {} mm, in_mm {}", mx.centre_err_median, mx.centre_err_p90, mx.in_mm);
        assert!(mx.in_mm && (mx.centre_err_median - 7.5).abs() < 1e-9 && (mx.centre_err_p90 - 15.0).abs() < 1e-9, "{mx:?}");
        assert!(mx.iou_median < 1.0 && mx.iou_median > 0.0, "shifted boxes overlap less: {mx:?}");
        assert!(q.iter().filter(|x| x.region != Region::Maxilla).all(|x| x.centre_err_median == 0.0), "the other regions are untouched");
        let mut frac = films.clone_regions(); frac[0].mm_per_px = None;
        let l = expert.iter().find(|b| b.region == Region::Maxilla).unwrap().longer_side();
        let fx = *box_quality(&frac).unwrap().iter().find(|x| x.region == Region::Maxilla).unwrap();
        assert!(!fx.in_mm && (fx.centre_err_median - 75.0 / l).abs() < 1e-12 && (fx.centre_err_p90 - 150.0 / l).abs() < 1e-12, "{fx:?} (longer side {l})");
        // A region found on no film: IoU 0 on every film (the gate fails), the centre error is not a number (nothing to
        // measure), and nothing panics. No film with an expert box for a region at all: refused.
        let mut none = films.clone_regions();
        for x in none.iter_mut() { x.detected.boxes.retain(|b| b.region != Region::Incisors); }
        let inc = *box_quality(&none).unwrap().iter().find(|x| x.region == Region::Incisors).unwrap();
        assert!(inc.iou_median == 0.0 && inc.not_found == 4 && inc.centre_err_median.is_nan() && !inc.in_mm, "{inc:?}");
        assert!(!gate_passes(&box_quality(&none).unwrap()));
        let mut no_expert = films.clone_regions();
        for x in no_expert.iter_mut() { x.expert.retain(|b| b.region != Region::Incisors); }
        assert!(box_quality(&no_expert).unwrap_err().to_string().contains("incisors"));
    }
    /// The calibration file (Task 10 writes it; the app reads it). Fails if an unknown field, a τ below 0.01 or a
    /// wrong version is accepted.
    #[test] fn the_calibration_file_round_trips_and_refuses_what_it_cannot_be() {
        let c = RegionCalibration { version: CALIBRATION_VERSION.into(), detector_fingerprint: "b".repeat(64), score_line: 0.3, tau: RegionTau([0.05, 0.12, 0.08, 0.2, 0.07]), gate_report_sha256: "c".repeat(64), rule: None };
        let j = calibration_json(&c).unwrap();
        assert_eq!(parse_calibration(j.as_bytes()).unwrap(), c);
        assert_eq!(calibration_path(std::path::Path::new("m")), std::path::Path::new("m").join("regions").join("calibration.json"));
        for (bad, why) in [(j.replace("region-calibration/1", "region-calibration/2"), "version"), (j.replace("0.05", "0.005"), "0.01"),
                           (j.replacen('{', "{\"extra\": 1,", 1), "unknown field"), (j.replace(&"b".repeat(64), "b"), "fingerprint")] {
            let e = parse_calibration(bad.as_bytes()).unwrap_err().to_string();
            assert!(e.contains(why), "{why}: {e}");
        }
        // The other refusals the rules name. Fails if the score line, an upper-case or short gate hash, or τ above 10
        // is accepted.
        for (bad, why) in [(j.replace("0.3,", "0.0,"), "score line"), (j.replace("0.3,", "1.5,"), "score line"),
                           (j.replace(&"c".repeat(64), &"C".repeat(64)), "gate report"), (j.replace("0.12", "10.5"), "0.01")] {
            let e = parse_calibration(bad.as_bytes()).unwrap_err().to_string();
            assert!(e.contains(why), "{why}: {e}");
        }
    }
    /// sc1-box-gate/2 (owner, 5 Nov 2026) records which gate rule set τ in a `rule` field. The /1 file (no `rule`) still
    /// loads, and reads as /1; a /2 file loads and reads as /2; an unknown rule is refused. Fails if the parser drops the
    /// field, refuses a /1 file, or accepts a rule it does not know.
    #[test] fn the_calibration_records_its_gate_rule_and_still_reads_a_1_file() {
        let one = format!(r#"{{"version": "region-calibration/1", "detectorFingerprint": "{}", "scoreLine": 0.5, "tau": [0.09, 0.01, 0.01, 0.01, 0.01], "gateReportSha256": "{}"}}"#, "b".repeat(64), "c".repeat(64));
        let c1 = parse_calibration(one.as_bytes()).unwrap();
        eprintln!("a /1 file: rule {:?}", c1.gate_rule());
        assert_eq!(c1.gate_rule(), "sc1-box-gate/1");
        let two = one.replacen('{', r#"{"rule": "sc1-box-gate/2", "#, 1);
        let c2 = parse_calibration(two.as_bytes()).unwrap();
        eprintln!("a /2 file: rule {:?}", c2.gate_rule());
        assert_eq!(c2.gate_rule(), "sc1-box-gate/2");
        assert_eq!(parse_calibration(calibration_json(&c2).unwrap().as_bytes()).unwrap(), c2, "round trip keeps the rule");
        assert!(!calibration_json(&c1).unwrap().contains("rule"), "a /1 calibration is written as before, with no rule field");
        let e = parse_calibration(one.replacen('{', r#"{"rule": "sc1-box-gate/9", "#, 1).as_bytes()).unwrap_err().to_string();
        eprintln!("an unknown rule: {e}");
        assert!(e.contains("rule"), "{e}");
        // sc1-box-gate/3 (owner OQ-1b-A = A) loads; so does /4 (whole-film/3, the owner's ruling of 5 Nov 2026, spec
        // §17.15); /5 is refused. Fails if: GATE_RULES lacks /3 or /4, or accepts any rule.
        let three = parse_calibration(one.replacen('{', r#"{"rule": "sc1-box-gate/3", "#, 1).as_bytes()).unwrap();
        assert_eq!(three.gate_rule(), "sc1-box-gate/3");
        let four = parse_calibration(one.replacen('{', r#"{"rule": "sc1-box-gate/4", "#, 1).as_bytes()).unwrap();
        assert_eq!(four.gate_rule(), "sc1-box-gate/4");
        assert!(parse_calibration(one.replacen('{', r#"{"rule": "sc1-box-gate/5", "#, 1).as_bytes()).is_err());
    }
    /// The brief's edge cases, each output printed (information; the clean ones asserted). Fails if a face without N,
    /// or a model with 15 of the 19, is flagged on its own boxes.
    #[test] fn the_edge_cases_print_their_output() {
        let f = face(); let regs = own_regions(&f);
        let no_n: Vec<Mark> = marks(&f).into_iter().filter(|m| m.landmark_id != "N").collect();
        let r = check_film(Some(scorer()), &no_n, false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("N missing: {:?}, present {}", r.check, r.present);
        assert_eq!((r.check.clone(), r.present), (FilmCheck::Clean, 18));
        let fifteen: Vec<Mark> = marks(&f).into_iter().filter(|m| !["Po", "Or", "Ar", "PNS"].contains(&m.landmark_id.as_str())).collect();
        let r = check_film(Some(scorer()), &fifteen, false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("15 of 19: {:?}, present {}", r.check, r.present);
        assert_eq!((r.check.clone(), r.present), (FilmCheck::Clean, 15));
        let shifted: Vec<Pt> = f.iter().map(|p| (p.0 + 200.0, p.1)).collect();       // 20 mm at 0.1 mm/px
        let r = check_film(Some(scorer()), &marks(&shifted), false, W, H, RegionLook::Found(&regs), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("whole tracing 20 mm forward, tau 0.05: {:?}", r.check);
        let r = check_film(Some(scorer()), &marks(&f), false, W, H, RegionLook::NotRun(Look::FilmTooSmall), &FilmCal::tau_only(&TAU)).unwrap();
        eprintln!("film too small: {:?}, region look {:?}", r.check, r.region_look);
    }

    // ---- SC-1 Part 1b Task C: the size look (sc1-size/1), FilmCal, and whole-film/1 unchanged (M2) ----

    fn opt(f: &[Pt]) -> Vec<Option<Pt>> { f.iter().map(|p| Some(*p)).collect() }
    /// Marks for the present points only (a missing point has no mark).
    fn marks_opt(f: &[Option<Pt>]) -> Vec<Mark> { ORDER.iter().zip(f).filter_map(|(id, p)| p.map(|p| Mark { landmark_id: id.to_string(), x: p.0, y: p.1 })).collect() }
    /// A SYNTHETIC face (film px, W x H) and its own expert-rule boxes (`own_regions`) as the "detected" regions.
    fn face_and_boxes(seed: u64) -> (Vec<Option<Pt>>, Regions) { let f = faces(1, seed).remove(0); let r = own_regions(&f); (opt(&f), r) }
    /// The same film flipped left-right (x -> W - 1 - x), points and boxes both; its facing then reads left.
    fn flipped(f: &[Option<Pt>], r: &Regions) -> (Vec<Option<Pt>>, Regions) {
        let w = (W - 1) as f64;
        let boxes: Vec<RegionBox> = r.boxes.iter().map(|b| RegionBox { x0: w - b.x1, x1: w - b.x0, ..*b }).collect();
        (map_opt(f, |p| (w - p.0, p.1)), Regions::from_scored(&boxes, 0.5, &r.model_fingerprint).unwrap())
    }
    const TAU_GATE2: RegionTau = RegionTau([0.09, 0.02, 0.02, 0.01, 0.10]);   // gate /2's five values (cranial base … soft tissue)
    fn run(f: &[Option<Pt>], r: &Regions, s: Option<&WholeScorer>, facing_left: bool, cal: &FilmCal) -> FilmResult {
        check_film(s, &marks_opt(f), facing_left, W, H, RegionLook::Found(r), cal).unwrap()
    }
    /// The five fields whole-film/1 had, as JSON (new fields are left out; `Reason::Region`'s Task-D `centre` is skipped
    /// when None, so a v1 reason serialises as before).
    fn v1_fields(r: &FilmResult) -> serde_json::Value { serde_json::json!([r.check, r.shape_look, r.region_look, r.shape, r.present]) }
    fn map_opt(f: &[Option<Pt>], g: impl Fn(Pt) -> Pt) -> Vec<Option<Pt>> { f.iter().map(|p| p.map(&g)).collect() }
    fn centroid_opt(f: &[Option<Pt>]) -> Pt { let v: Vec<Pt> = f.iter().flatten().copied().collect(); (v.iter().map(|p| p.0).sum::<f64>() / v.len() as f64, v.iter().map(|p| p.1).sum::<f64>() / v.len() as f64) }
    fn scaled_opt(f: &[Option<Pt>], k: f64) -> Vec<Option<Pt>> { let c = centroid_opt(f); map_opt(f, |p| (c.0 + k * (p.0 - c.0), c.1 + k * (p.1 - c.1))) }
    fn shifted_opt(f: &[Option<Pt>], dx: f64, dy: f64) -> Vec<Option<Pt>> { map_opt(f, |p| (p.0 + dx, p.1 + dy)) }
    fn without(f: &[Option<Pt>], ids: &[&str]) -> Vec<Option<Pt>> { f.iter().enumerate().map(|(k, p)| if ids.contains(&ORDER[k]) { None } else { *p }).collect() }
    fn regs_with(r: &Regions, keep: &[Region]) -> Regions { Regions { boxes: r.boxes.iter().filter(|b| keep.contains(&b.region)).copied().collect(), ..r.clone() } }
    fn moved_region(f: &[Option<Pt>], r: Region, dx: f64, dy: f64) -> Vec<Option<Pt>> {
        f.iter().enumerate().map(|(k, p)| if REGION_OF.iter().any(|(n, g)| *n == ORDER[k] && *g == r) { p.map(|q| (q.0 + dx, q.1 + dy)) } else { *p }).collect()
    }
    fn vec_all5() -> Vec<Region> { REGIONS.to_vec() }
    fn vec_no_incisors() -> Vec<Region> { REGIONS.into_iter().filter(|r| *r != Region::Incisors).collect() }
    fn cal_with(refs: &[(Vec<Region>, f64, f64)]) -> SizeCalibration {
        SizeCalibration { version: "size-calibration/1".into(), rule: SIZE_RULE.into(), detector_fingerprint: "0".repeat(64), uses: vec_all5(),
            refs: refs.iter().map(|(r, c, l)| SizeRef { regions: r.clone(), centre: *c, line: *l }).collect(), report_sha256: "0".repeat(64) }
    }
    /// `cal_with` for the boxes' own detector (`own_regions` fingerprints them "a" × 64).
    fn cal_for(refs: &[(Vec<Region>, f64, f64)]) -> SizeCalibration { SizeCalibration { detector_fingerprint: "a".repeat(64), ..cal_with(refs) } }
    fn reason_keys(r: &FilmResult) -> Vec<&'static str> { reasons(r).iter().map(|x| x.key()).collect() }

    #[test] fn the_size_score_halves_and_doubles_exactly() {
        // fails if: the spread is not about the regions' own mean, or the log is dropped
        let (f, regs) = face_and_boxes(7);
        let (_, q1) = size_score(&f, &regs, &REGIONS).unwrap();
        let (_, qh) = size_score(&scaled_opt(&f, 0.5), &regs, &REGIONS).unwrap();
        let (_, qd) = size_score(&scaled_opt(&f, 2.0), &regs, &REGIONS).unwrap();
        eprintln!("q {q1:.6}, x0.5 {qh:.6}, x2 {qd:.6}");
        assert!((qh - q1 - 0.5f64.ln()).abs() < 1e-12 && (qd - q1 - 2f64.ln()).abs() < 1e-12);
    }
    #[test] fn the_size_score_ignores_a_shift() {
        // fails if: absolute positions enter the score (e.g. the spread taken about the image centre)
        let (f, regs) = face_and_boxes(7);
        let (_, q) = size_score(&f, &regs, &REGIONS).unwrap();
        assert!((size_score(&shifted_opt(&f, 300.0, -200.0), &regs, &REGIONS).unwrap().1 - q).abs() < 1e-12);
    }
    #[test] fn a_left_facing_film_gets_the_same_size_verdict() {
        // M26. fails if: check_film scores the size on the faced-right points against the boxes in the stored frame
        // (mixing frames moves the tracing pins but not the box pins, so q changes on a flipped film)
        let (f, regs) = face_and_boxes(7);
        let cal = cal_for(&[(vec_all5(), 0.0, 0.05)]);
        let (fl, rl) = flipped(&f, &regs);
        let a = run(&f, &regs, None, false, &FilmCal { size: Some(&cal), ..FilmCal::tau_only(&TAU) }).size.unwrap();
        let b = run(&fl, &rl, None, true, &FilmCal { size: Some(&cal), ..FilmCal::tau_only(&TAU) }).size.unwrap();
        eprintln!("right {a:?}; left {b:?}");
        assert!((a.q - b.q).abs() < 1e-9 && a.flagged == b.flagged, "{a:?} {b:?}");
    }
    #[test] fn fewer_than_three_usable_regions_is_not_judged() {
        // fails if: a region with no traced point is counted, or 2 regions are judged
        let (f, regs) = face_and_boxes(7);
        let two = regs_with(&regs, &[Region::Mandible, Region::Maxilla]);
        assert!(size_score(&f, &two, &REGIONS).is_none());
        let no_incisor_points = without(&f, &["U1T", "L1T"]);           // region found, no traced point: not used
        assert_eq!(size_score(&no_incisor_points, &regs, &REGIONS).unwrap().0.len(), 4);
        let three = regs_with(&regs, &[Region::Mandible, Region::Maxilla, Region::CranialBase]);
        assert_eq!(size_score(&f, &three, &REGIONS).unwrap().0, vec![Region::CranialBase, Region::Maxilla, Region::Mandible], "3 regions: judged");
    }
    #[test] fn the_verdict_uses_the_line_for_the_regions_used() {
        // fails if: the full-set line is used for every set, or a set with no line is judged
        let cal = cal_with(&[(vec_all5(), 0.10, 0.20), (vec_no_incisors(), 0.12, 0.25)]);
        assert!(size_verdict(&cal, &vec_all5(), 0.31).unwrap().flagged);     // |0.31-0.10| = 0.21 > 0.20
        assert!(!size_verdict(&cal, &vec_no_incisors(), 0.31).unwrap().flagged); // 0.19 <= 0.25
        assert!(size_verdict(&cal, &vec![Region::Maxilla, Region::Mandible, Region::SoftTissue], 0.0).is_none()); // no ref: not judged
    }
    #[test] fn the_size_line_is_strict_at_equality() {
        // M25. fails if: `beyond` (or size_verdict) uses >= : a film exactly on the line would flag. Binary-exact values.
        let cal = cal_with(&[(vec_all5(), 0.125, 0.25)]);
        assert!(!size_verdict(&cal, &vec_all5(), 0.375).unwrap().flagged);                    // |0.375 − 0.125| = 0.25, on the line
        assert!(size_verdict(&cal, &vec_all5(), 0.375 + 2f64.powi(-20)).unwrap().flagged);   // just beyond
        assert!(!size_verdict(&cal, &vec_all5(), -0.125).unwrap().flagged);                   // the other side, on the line
        assert!(size_verdict(&cal, &vec_all5(), -0.125 - 2f64.powi(-20)).unwrap().flagged);
        assert!(!beyond(0.25, 0.25) && beyond(0.25 + 2f64.powi(-20), 0.25));
    }
    #[test] fn whole_film_1_is_unchanged_when_the_new_looks_are_off() {
        // M2. fails if: anything in check_film moved for whole-film/1 inputs: a region comparison made >=, a reason
        // reordered, the shape look or the facing witness changed, a not-run reason changed. Run with and without the
        // shape scorer (so the shape fields are really compared), facing right and left, at [0.05; 5] and at gate /2's τ.
        let mut n = 0;
        for tau in [TAU, TAU_GATE2] { for s in [None, Some(scorer())] { for left in [false, true] { for seed in 0..40 {
            let (f, regs) = face_and_boxes(seed);
            for g in [f.clone(), scaled_opt(&f, 0.5), moved_region(&f, Region::Mandible, 400.0, 0.0),
                      map_opt(&f, |p| (p.0 * 1000.0, p.1 * 1000.0)), without(&f, &["S", "N", "Po", "Ar", "Or", "A", "B", "Me"])] {
                let a = frozen_v1::check_film(s, &marks_opt(&g), left, W, H, RegionLook::Found(&regs), &tau).unwrap();
                assert_eq!(v1_fields(&run(&g, &regs, s, left, &FilmCal::tau_only(&tau))), a.fields(), "seed {seed}, left {left}");
                n += 1;
            }
        }}}}
        // the not-run paths too
        for l in [Look::NoRegionModel, Look::NotSetUp, Look::FilmTooSmall] {
            let (f, _) = face_and_boxes(1);
            let a = frozen_v1::check_film(None, &marks_opt(&f), false, W, H, RegionLook::NotRun(l), &TAU).unwrap();
            let b = check_film(None, &marks_opt(&f), false, W, H, RegionLook::NotRun(l), &FilmCal::tau_only(&TAU)).unwrap();
            assert_eq!(v1_fields(&b), a.fields());
            n += 1;
        }
        eprintln!("whole-film/1 compared with the frozen copy on {n} cases");
        assert_eq!(n, 2 * 2 * 2 * 40 * 5 + 3);
    }
    /// fails if: the factor is exp(q) without the centre, or `Size` is pushed after `Facing`.
    #[test] fn a_tracing_at_half_size_flags_size_with_its_factor() {
        let (f, regs) = face_and_boxes(7);
        let (_, q) = size_score(&f, &regs, &REGIONS).unwrap();
        let cal = cal_for(&[(vec_all5(), q, 0.2)]);
        let fc = FilmCal { size: Some(&cal), ..FilmCal::tau_only(&TAU) };
        let r = run(&f, &regs, None, false, &fc);
        assert_eq!((r.size_look, r.check.clone()), (ExtraLook::Judged, FilmCheck::Clean), "the film itself, at its own centre: clean");
        let r = run(&scaled_opt(&f, 0.5), &regs, None, true, &fc);           // stored facing left: the detector witness disagrees
        let v = r.size.unwrap();
        eprintln!("x0.5: {v:?}; reasons {:?}", reason_keys(&r));
        assert_eq!((v.factor * 10.0).round() / 10.0, 0.5);
        let keys = reason_keys(&r);
        let size_at = keys.iter().position(|k| *k == "size").unwrap();
        assert!(keys[..size_at].iter().all(|k| *k == "region") && keys[size_at + 1..] == ["facing"], "{keys:?}");
        assert!(reasons(&r).contains(&Reason::Size { factor: v.factor }));
    }
    /// fails if: off-film points stop the size look.
    #[test] fn metre_scale_coordinates_flag_size_and_region() {
        let (f, regs) = face_and_boxes(7);
        let (_, q) = size_score(&f, &regs, &REGIONS).unwrap();
        let cal = cal_for(&[(vec_all5(), q, 0.2)]);
        let r = run(&map_opt(&f, |p| (p.0 * 1000.0, p.1 * 1000.0)), &regs, None, false, &FilmCal { size: Some(&cal), ..FilmCal::tau_only(&TAU) });
        eprintln!("x1000: size {:?}; reasons {:?}", r.size, reason_keys(&r));
        assert!(r.size.unwrap().flagged && reason_keys(&r).contains(&"size") && reason_keys(&r).contains(&"region"));
    }
    /// Fix round 1, I2 (ruling): the size look judges complete tracings only, since the lines were set on
    /// complete expert tracings and a missing point moves its region's pin. An 18-point tracing reads too-few and never
    /// flags, even at half size; the same tracing with all 19 is judged. Fails if: 18 points are accepted.
    #[test] fn an_incomplete_tracing_is_not_size_judged() {
        let (f, regs) = face_and_boxes(7);
        let (_, q) = size_score(&f, &regs, &REGIONS).unwrap();
        let cal = cal_for(&[(vec_all5(), q, 0.2)]);
        let fc = FilmCal { size: Some(&cal), ..FilmCal::tau_only(&TAU) };
        for gone in ["Po", "U1T", "PogS"] {
            let r = run(&without(&f, &[gone]), &regs, None, false, &fc);
            eprintln!("18 points (no {gone}): size look {:?}, size {:?}, reasons {:?}", r.size_look, r.size, reason_keys(&r));
            assert_eq!((r.size_look, r.size), (ExtraLook::TooFew, None), "{gone}");
            let h = run(&scaled_opt(&without(&f, &[gone]), 0.5), &regs, None, false, &fc);
            assert!(!reason_keys(&h).contains(&"size") && h.size_look == ExtraLook::TooFew, "a half-size 18-point tracing never flags size");
        }
        let r = run(&f, &regs, None, false, &fc);
        assert_eq!((r.size_look, r.size.unwrap().flagged), (ExtraLook::Judged, false), "19 points: judged as before");
        assert!(run(&scaled_opt(&f, 0.5), &regs, None, false, &fc).size.unwrap().flagged);
    }
    /// fails if: any of them reads `Judged`.
    #[test] fn the_size_look_says_why_it_did_not_run() {
        let (f, regs) = face_and_boxes(7);
        let cal = cal_for(&[(vec_all5(), 0.0, 0.2)]);
        let with = FilmCal { size: Some(&cal), ..FilmCal::tau_only(&TAU) };
        let r = run(&f, &regs, None, false, &FilmCal::tau_only(&TAU));
        assert_eq!((r.size_look, r.size), (ExtraLook::NotSetUp, None), "no size calibration");
        for (l, want) in [(Look::NoRegionModel, ExtraLook::NoRegionModel), (Look::FilmTooSmall, ExtraLook::FilmTooSmall), (Look::NotSetUp, ExtraLook::NotSetUp)] {
            let r = check_film(None, &marks_opt(&f), false, W, H, RegionLook::NotRun(l), &with).unwrap();
            assert_eq!((r.size_look, r.size), (want, None), "{l:?}");
        }
        let r = run(&f, &regs_with(&regs, &[Region::Mandible, Region::Maxilla]), None, false, &with);
        assert_eq!((r.size_look, r.size), (ExtraLook::TooFew, None), "2 regions");
        let r = run(&f, &regs_with(&regs, &[Region::CranialBase, Region::Maxilla, Region::Mandible, Region::SoftTissue]), None, false, &with);
        assert_eq!((r.size_look, r.size), (ExtraLook::NotSetUp, None), "4 regions used, and no line for that set");
        let r = run(&without(&f, &["U1T", "L1T"]), &regs, None, false, &with);
        assert_eq!((r.size_look, r.size), (ExtraLook::TooFew, None), "an incomplete tracing (17 points)");
        let other = cal_with(&[(vec_all5(), 0.0, 0.2)]);
        let r = run(&f, &regs, None, false, &FilmCal { size: Some(&other), ..FilmCal::tau_only(&TAU) });
        eprintln!("another detector's calibration: {:?}, refused: {}", r.size_look, other.fits(&regs.model_fingerprint).unwrap_err());
        assert_eq!((r.size_look, r.size), (ExtraLook::NotSetUp, None), "another detector's calibration");
    }
    /// fails if: a key is misspelt.
    #[test] fn extra_look_keys_are_the_stored_ones() {
        for (l, k) in [(ExtraLook::Judged, "judged"), (ExtraLook::NotSetUp, "not-set-up"), (ExtraLook::NoRegionModel, "no-region-model"),
                       (ExtraLook::FilmTooSmall, "film-too-small"), (ExtraLook::TooFew, "too-few")] {
            assert_eq!(l.key(), k);
            assert_eq!(serde_json::to_value(l).unwrap(), k);
        }
        assert_eq!(Reason::Size { factor: 0.5 }.key(), "size");
        assert_eq!(serde_json::to_value(Reason::Size { factor: 0.5 }).unwrap()["kind"], "size");
    }
    /// fails if: `deny_unknown_fields` is missing (M24), or a check is skipped.
    #[test] fn a_size_calibration_file_round_trips_and_refuses() {
        let c = cal_with(&[(vec_all5(), 0.1, 0.2), (vec_no_incisors(), 0.12, 0.25)]);
        let j = serde_json::to_string_pretty(&c).unwrap();
        assert_eq!(parse_size_calibration(j.as_bytes()).unwrap(), c);
        assert_eq!(size_calibration_path(std::path::Path::new("m")), std::path::Path::new("m").join("regions").join("size-calibration.json"));
        assert!(c.fits(&"0".repeat(64)).is_ok());
        let e = c.fits(&"b".repeat(64)).unwrap_err().to_string();
        eprintln!("another detector: {e}");
        assert!(e.contains("region finder"), "{e}");
        assert!(j.contains("\"line\": 0.2\n"), "the mutations below must find their text");
        let two = r#"{"regions": ["maxilla", "mandible"], "centre": 0.1, "line": 0.2}"#;
        for (bad, why) in [(j.replacen("\"line\": 0.2\n", "\"line\": NaN\n", 1), "cannot be read"), (j.replacen("\"line\": 0.2\n", "\"line\": 0.04\n", 1), "0.05"),
                           (j.replacen("\"refs\": [", &format!("\"refs\": [{two}, "), 1), "at least 3"),
                           (j.replacen('{', "{\"extra\": 1,", 1), "unknown field"), (j.replace("sc1-size/1", "sc1-size/2"), "rule"),
                           (j.replace("size-calibration/1", "size-calibration/2"), "version")] {
            let e = parse_size_calibration(bad.as_bytes()).unwrap_err().to_string();
            eprintln!("{why}: {e}");
            assert!(e.contains(why), "{why}: {e}");
        }
    }

    /// The brief's edge cases for the size look, each output printed (and the verdict asserted). The calibration has a
    /// line for every set of 3, 4 or 5 regions (centre at the clean film's own q, line 0.2).
    #[test] fn the_size_edge_cases_print_their_output() {
        let (f, regs) = face_and_boxes(7);
        let sets: Vec<Vec<Region>> = (0u32..32).filter(|m| m.count_ones() >= 3).map(|m| REGIONS.into_iter().filter(|r| m & (1 << r.index()) != 0).collect()).collect();
        let refs: Vec<(Vec<Region>, f64, f64)> = sets.iter().map(|s| (s.clone(), size_score(&f, &regs, s).unwrap().1, 0.2)).collect();
        let cal = cal_for(&refs);
        let fc = FilmCal { size: Some(&cal), ..FilmCal::tau_only(&TAU) };
        let show = |what: &str, r: &FilmResult| eprintln!("{what}: size look {:?}; size {:?}; check {:?}", r.size_look, r.size.map(|v| (v.q, v.factor, v.flagged)), reason_keys(r));
        let r = run(&f, &regs_with(&regs, &[Region::CranialBase, Region::Maxilla, Region::Mandible, Region::Incisors]), None, false, &fc);
        show("missing one region (soft tissue not found)", &r);
        assert_eq!((r.size_look, r.size.unwrap().flagged), (ExtraLook::Judged, false));
        let r = run(&f, &regs_with(&regs, &[Region::CranialBase, Region::Maxilla, Region::Mandible]), None, false, &fc);
        show("missing two regions (its one 3-set)", &r);
        assert_eq!((r.size_look, r.size.unwrap().flagged), (ExtraLook::Judged, false));
        let r = run(&without(&f, &["U1T", "L1T"]), &regs, None, false, &fc);
        show("no traced point in a found region (incisors): an incomplete tracing", &r);
        assert_eq!((r.size_look, r.size), (ExtraLook::TooFew, None));
        let (fl, rl) = flipped(&f, &regs);
        let r = run(&fl, &rl, None, true, &fc);
        show("left-facing film", &r);
        assert!(r.size.unwrap().q == run(&f, &regs, None, false, &fc).size.unwrap().q || (r.size.unwrap().q - run(&f, &regs, None, false, &fc).size.unwrap().q).abs() < 1e-9);
        let r = run(&shifted_opt(&f, 200.0, 0.0), &regs, None, false, &fc);
        show("whole tracing shifted 200 px (size same; the regions catch the shift)", &r);
        assert!(!r.size.unwrap().flagged);
        let r = run(&map_opt(&f, |p| (p.0 * 1000.0, p.1 * 1000.0)), &regs, None, false, &fc);
        show("x1000 (metre scale)", &r);
        assert!(r.size.unwrap().flagged);
        let few = without(&f, &["Po", "Or", "Ar", "PNS", "Go", "B", "Gn", "LL"]);
        let r = run(&few, &regs, Some(scorer()), false, &fc);
        show("too few points (11 of 19): shape not judged, size not judged", &r);
        assert_eq!((r.shape_look, r.size_look, r.size), (Look::TooFewPoints, ExtraLook::TooFew, None));
        let r = check_film(None, &marks_opt(&f), false, W, H, RegionLook::NotRun(Look::NoRegionModel), &fc).unwrap();
        show("no region model", &r);
        assert_eq!(r.size_look, ExtraLook::NoRegionModel);
        let r = run(&f, &regs, None, false, &FilmCal::tau_only(&TAU));
        show("size calibration absent", &r);
        assert_eq!(r.size_look, ExtraLook::NotSetUp);
        let other = cal_with(&refs);
        let r = run(&f, &regs, None, false, &FilmCal { size: Some(&other), ..FilmCal::tau_only(&TAU) });
        show(&format!("another detector's calibration ({})", other.fits(&regs.model_fingerprint).unwrap_err()), &r);
        assert_eq!(r.size_look, ExtraLook::NotSetUp);
    }

    // ---- SC-1 Part 1b Task D: the cranial-base centre look (sc1-cb-centre/1) ----

    /// A centre calibration for the boxes' own detector (`own_regions` fingerprints them "a" × 64; a "0" × 64 calibration
    /// is another detector's and reads not-set-up, as the size look's `cal_for`).
    fn cbc(median: (f64, f64), line: f64) -> CbCalibration {
        CbCalibration { version: "cb-centre-calibration/1".into(), rule: CB_RULE.into(), detector_fingerprint: "a".repeat(64), median, line, report_sha256: "0".repeat(64), ruling: None }
    }
    fn with_cb<'a>(cal: &'a CbCalibration, tau: &'a RegionTau) -> FilmCal<'a> { FilmCal { cb: Some(cal), ..FilmCal::tau_only(tau) } }
    const CB_IDS: [&str; 5] = ["S", "N", "Po", "Ar", "Or"];
    fn cb_reason(r: &FilmResult) -> Option<(Vec<(String, Option<f64>)>, Option<f64>)> {
        reasons(r).into_iter().find_map(|x| match x { Reason::Region { region: Region::CranialBase, outside, centre } => Some((outside, centre)), _ => None })
    }

    #[test] fn a_cranial_base_moved_20mm_moves_its_offset_by_20mm_over_the_side() {
        // fails if: the offset is not tracing pin minus box pin over the longer side
        let (f, regs) = face_and_boxes(3);
        let o0 = cb_offset(&f, &regs, false).unwrap();
        let side = regs.get(Region::CranialBase).unwrap().longer_side();
        let o1 = cb_offset(&moved_region(&f, Region::CranialBase, 200.0, 0.0), &regs, false).unwrap();
        eprintln!("offset {o0:?}; moved 200 px {o1:?}; side {side:.1} px");
        assert!(((o1.0 - o0.0) - 200.0 / side).abs() < 1e-12 && (o1.1 - o0.1).abs() < 1e-12);
        // and the offset is the pin difference itself (not only its change): recomputed here
        let b = regs.get(Region::CranialBase).unwrap().centre();
        let pts: Vec<Pt> = CB_IDS.iter().map(|id| f[ORDER.iter().position(|o| o == id).unwrap()].unwrap()).collect();
        let m = (pts.iter().map(|p| p.0).sum::<f64>() / 5.0, pts.iter().map(|p| p.1).sum::<f64>() / 5.0);
        assert!(((m.0 - b.0) / side - o0.0).abs() < 1e-12 && ((m.1 - b.1) / side - o0.1).abs() < 1e-12);
    }
    #[test] fn left_facing_mirrors_x_only() {
        // fails if: x is not mirrored on a left-facing film (the offset's x changes sign), or y is mirrored too
        let (f, regs) = face_and_boxes(3);
        let (fl, rl) = flipped(&f, &regs);                       // points and boxes, x -> W - 1 - x
        let (a, b) = (cb_offset(&f, &regs, false).unwrap(), cb_offset(&fl, &rl, true).unwrap());
        eprintln!("right {a:?}; left {b:?}");
        assert!(a.0.abs() > 1e-3, "the fixture's x offset must not be 0, or a missing mirror could not show");
        assert!((a.0 - b.0).abs() < 1e-9 && (a.1 - b.1).abs() < 1e-9);
    }
    #[test] fn fewer_than_three_cranial_base_points_is_not_judged() {
        // fails if: CB_MIN_POINTS is not applied, or applied as > 3
        let (f, regs) = face_and_boxes(3);
        assert!(cb_offset(&without(&f, &["S", "N", "Po"]), &regs, false).is_none());
        assert!(cb_offset(&without(&f, &["S", "N"]), &regs, false).is_some());
        // no cranial-base box: None
        assert!(cb_offset(&f, &regs_with(&regs, &[Region::Maxilla, Region::Mandible, Region::Incisors, Region::SoftTissue]), false).is_none());
    }
    #[test] fn the_centre_line_is_strict_at_equality() {
        // M25. fails if: the centre verdict uses >= (a film exactly on the line flags). Binary-exact: median (0, 0), offset (0.25, 0).
        let cal = cbc((0.0, 0.0), 0.25);
        assert_eq!(cb_distance((0.25, 0.0), &cal), 0.25);
        assert!(!beyond(cb_distance((0.25, 0.0), &cal), cal.line));
        assert!(beyond(cb_distance((0.25 + 2f64.powi(-20), 0.0), &cal), cal.line));
        // through check_film: the line set to this film's own distance exactly (so d == line bit for bit): not flagged;
        // one step below it: flagged
        let (f, regs) = face_and_boxes(3);
        let moved = moved_region(&f, Region::CranialBase, 60.0, 0.0);
        let cal = cbc(cb_offset(&f, &regs, false).unwrap(), 0.05);
        let d = run(&moved, &regs, None, false, &with_cb(&cal, &TAU)).cb.unwrap().distance;
        let on = run(&moved, &regs, None, false, &with_cb(&CbCalibration { line: d, ..cal.clone() }, &TAU)).cb.unwrap();
        let below = run(&moved, &regs, None, false, &with_cb(&CbCalibration { line: d - 1e-9, ..cal.clone() }, &TAU)).cb.unwrap();
        eprintln!("on the line: {on:?}; just below: {below:?}");
        assert_eq!(on.distance, on.line);
        assert!(!on.flagged && below.flagged);
    }
    #[test] fn an_edge_flag_and_a_centre_flag_make_one_region_reason() {
        // fails if: two Region reasons for the cranial base are emitted (the library allows one per region)
        let (f, regs) = face_and_boxes(3);
        let cal = cbc(cb_offset(&f, &regs, false).unwrap(), 0.03);
        let r = run(&moved_region(&f, Region::CranialBase, 2000.0, 0.0), &regs, None, false, &FilmCal { cb: Some(&cal), ..FilmCal::tau_only(&TAU) });
        let FilmCheck::Flagged { reasons } = r.check.clone() else { panic!("not flagged") };
        eprintln!("edge and centre: {reasons:?}");
        assert_eq!(reasons.iter().filter(|x| matches!(x, Reason::Region { region: Region::CranialBase, .. })).count(), 1);
        assert!(r.cb.unwrap().flagged && r.cb_look == ExtraLook::Judged);
        assert_eq!(cb_reason(&r).unwrap().1, Some(r.cb.unwrap().distance));
    }
    #[test] fn a_centre_flag_alone_is_a_cranial_base_reason_with_its_distance() {
        // M6. fails if: the centre flag is not turned into a Region reason, or its distance is not carried, or the points
        // list is not every present cranial-base point with its outside-ratio (0 inside)
        let (f, regs) = face_and_boxes(3);
        let cal = cbc(cb_offset(&f, &regs, false).unwrap(), 0.02);
        let moved = moved_region(&f, Region::CranialBase, 150.0, 0.0);
        let r = run(&moved, &regs, None, false, &FilmCal { cb: Some(&cal), ..FilmCal::tau_only(&TAU_GATE2) });
        let none = run(&moved, &regs, None, false, &FilmCal::tau_only(&TAU_GATE2));
        eprintln!("150 px, centre on: {:?}; centre off: {:?}", reasons(&r), reasons(&none));
        assert!(cb_reason(&none).is_none(), "the fixture: 150 px is inside the edge tolerance 0.09, so only the centre can flag it");
        let (outside, c) = cb_reason(&r).unwrap();
        assert_eq!(c, Some(r.cb.unwrap().distance));
        assert_eq!(outside.iter().map(|o| o.0.as_str()).collect::<Vec<_>>(), CB_IDS.to_vec());
        let b = regs.get(Region::CranialBase).unwrap();
        for (id, ratio) in &outside {
            let p = moved[ORDER.iter().position(|o| o == id).unwrap()].unwrap();
            assert_eq!(*ratio, Some(outside_ratio(b, p)), "{id}");
        }
        assert!(outside.iter().any(|o| o.1 == Some(0.0)), "a point inside reads 0");
    }
    /// Task C's carry-over (M26): the centre look compares positions ACROSS the tracing and the boxes, so it must use the
    /// points as stored (the boxes' frame). Fails if: check_film passes the faced-right points (points_of(.., facing_left,
    /// ..)) to the centre look, or does not mirror x for a left-facing film: on the flipped film the tracing pin then sits
    /// in another frame from the box pin and the distance is no longer the right-facing film's.
    #[test] fn the_centre_look_reads_the_stored_frame_on_a_left_facing_film() {
        let (f, regs) = face_and_boxes(3);
        let cal = cbc(cb_offset(&f, &regs, false).unwrap(), 0.02);
        let (fl, rl) = flipped(&f, &regs);
        let a = run(&f, &regs, None, false, &with_cb(&cal, &TAU)).cb.unwrap();
        let b = run(&fl, &rl, None, true, &with_cb(&cal, &TAU));
        eprintln!("right {a:?}; left {:?} ({:?})", b.cb, b.cb_look);
        let b = b.cb.unwrap();
        assert!(a.distance < 1e-12 && !a.flagged);
        assert!((a.distance - b.distance).abs() < 1e-9 && !b.flagged && (a.offset.0 - b.offset.0).abs() < 1e-9, "{a:?} {b:?}");
        // and a move FORWARD on the left-facing film (−x as stored) reads as +x, like a forward move on a right-facing one
        let fwd = run(&moved_region(&fl, Region::CranialBase, -100.0, 0.0), &rl, None, true, &with_cb(&cal, &TAU)).cb.unwrap();
        let fwd_r = run(&moved_region(&f, Region::CranialBase, 100.0, 0.0), &regs, None, false, &with_cb(&cal, &TAU)).cb.unwrap();
        assert!((fwd.offset.0 - fwd_r.offset.0).abs() < 1e-9 && fwd.offset.0 > a.offset.0);
    }
    /// The missing-point rule (Task D): any of S, N, Po, Ar, Or missing → too-few, never flagged, even with the cranial base
    /// moved 2000 px; all five → judged. Fails if: 4 (or 3) cranial-base points are judged by check_film.
    #[test] fn a_tracing_missing_a_cranial_base_point_is_not_centre_judged() {
        let (f, regs) = face_and_boxes(3);
        let cal = cbc(cb_offset(&f, &regs, false).unwrap(), 0.02);
        for gone in CB_IDS {
            let g = without(&f, &[gone]);
            let r = run(&g, &regs, None, false, &with_cb(&cal, &TAU));
            let far = run(&moved_region(&g, Region::CranialBase, 2000.0, 0.0), &regs, None, false, &with_cb(&cal, &TAU));
            eprintln!("no {gone}: {:?} {:?}; moved 2000 px: centre {:?}", r.cb_look, r.cb, cb_reason(&far).map(|x| x.1));
            assert_eq!((r.cb_look, r.cb), (ExtraLook::TooFew, None), "{gone}");
            assert_eq!(far.cb_look, ExtraLook::TooFew);
            assert_eq!(cb_reason(&far).unwrap().1, None, "the edge flags; the centre never does");
        }
        assert_eq!(run(&f, &regs, None, false, &with_cb(&cal, &TAU)).cb_look, ExtraLook::Judged);
    }
    /// fails if: any reads `Judged`.
    #[test] fn the_cb_look_says_why_it_did_not_run() {
        let (f, regs) = face_and_boxes(3);
        let cal = cbc((0.0, 0.0), 0.05);
        let r = run(&f, &regs, None, false, &FilmCal::tau_only(&TAU));
        assert_eq!((r.cb_look, r.cb), (ExtraLook::NotSetUp, None), "no centre calibration");
        for (l, want) in [(Look::NoRegionModel, ExtraLook::NoRegionModel), (Look::FilmTooSmall, ExtraLook::FilmTooSmall), (Look::NotSetUp, ExtraLook::NotSetUp)] {
            let r = check_film(None, &marks_opt(&f), false, W, H, RegionLook::NotRun(l), &with_cb(&cal, &TAU)).unwrap();
            assert_eq!((r.cb_look, r.cb), (want, None), "{l:?}");
        }
        let r = run(&without(&f, &["S", "N", "Po"]), &regs, None, false, &with_cb(&cal, &TAU));
        assert_eq!((r.cb_look, r.cb), (ExtraLook::TooFew, None), "2 cranial-base points");
        let r = run(&f, &regs_with(&regs, &[Region::Maxilla, Region::Mandible, Region::Incisors, Region::SoftTissue]), None, false, &with_cb(&cal, &TAU));
        assert_eq!((r.cb_look, r.cb), (ExtraLook::TooFew, None), "no cranial-base box");
        let r = run(&f, &regs_with(&regs, &[Region::CranialBase, Region::Maxilla]), None, false, &with_cb(&cal, &TAU));
        assert_eq!((r.cb_look, r.cb), (ExtraLook::TooFew, None), "2 regions found: no-ceph-found, no region judged");
        let other = CbCalibration { detector_fingerprint: "0".repeat(64), ..cal.clone() };
        let r = run(&f, &regs, None, false, &with_cb(&other, &TAU));
        assert_eq!((r.cb_look, r.cb), (ExtraLook::NotSetUp, None), "another detector's calibration");
    }
    /// fails if: `deny_unknown_fields` is missing (M24), or a check is skipped.
    #[test] fn a_cb_calibration_file_round_trips_and_refuses() {
        let c = cbc((0.0625, -0.03125), 0.05);
        let j = serde_json::to_string_pretty(&c).unwrap();
        eprintln!("{j}");
        assert_eq!(parse_cb_calibration(j.as_bytes()).unwrap(), c);
        assert_eq!(cb_calibration_path(std::path::Path::new("m")), std::path::Path::new("m").join("regions").join("cb-centre-calibration.json"));
        assert!(c.fits(&"a".repeat(64)).is_ok());
        let e = c.fits(&"b".repeat(64)).unwrap_err().to_string();
        eprintln!("another detector: {e}");
        assert!(e.contains("region finder"), "{e}");
        assert!(j.contains("\"line\": 0.05,"), "the mutations below must find their text");
        for (bad, why) in [(j.replacen("\"line\": 0.05,", "\"line\": NaN,", 1), "cannot be read"), (j.replacen("\"line\": 0.05,", "\"line\": 0.019,", 1), "0.02"),
                           (j.replacen("\"line\": 0.05,", "\"line\": 0.11,", 1), "0.1"),
                           (j.replacen("0.0625", "1e999", 1), "cannot be read"),
                           (j.replacen('{', "{\"extra\": 1,", 1), "unknown field"), (j.replace("sc1-cb-centre/1", "sc1-cb-centre/2"), "rule"),
                           (j.replace("cb-centre-calibration/1", "cb-centre-calibration/2"), "version"),
                           (j.replace(&"a".repeat(64), &"A".repeat(64)), "fingerprint")] {
            let e = parse_cb_calibration(bad.as_bytes()).unwrap_err().to_string();
            eprintln!("{why}: {e}");
            assert!(e.contains(why), "{why}: {e}");
        }
    }
    /// fails if: `centre` is serialised when None (a whole-film/1 reason would change on the IPC and the frozen guard), or
    /// dropped when Some.
    #[test] fn a_region_reason_carries_centre_only_when_set() {
        let a = serde_json::to_value(Reason::Region { region: Region::CranialBase, outside: vec![], centre: None }).unwrap();
        assert_eq!(a, serde_json::json!({"kind": "region", "region": "cranialBase", "outside": []}));
        let b = serde_json::to_value(Reason::Region { region: Region::CranialBase, outside: vec![], centre: Some(0.125) }).unwrap();
        assert_eq!(b["centre"], 0.125);
    }
    /// The brief's edge cases for the centre look, each output printed (and asserted). Calibration: median at the clean
    /// film's own offset, line 0.05. 100 px is 10 mm at Ceph-400's 0.1 mm/px.
    #[test] fn the_cb_edge_cases_print_their_output() {
        let (f, regs) = face_and_boxes(3);
        let cal = cbc(cb_offset(&f, &regs, false).unwrap(), 0.05);
        let fc = with_cb(&cal, &TAU);
        let show = |what: &str, r: &FilmResult| eprintln!("{what}: centre look {:?}; centre {:?}; reasons {:?}", r.cb_look, r.cb.map(|v| (v.offset, v.distance, v.flagged)), reason_keys(r));
        let r = run(&f, &regs, None, false, &fc);
        show("the film itself", &r);
        assert_eq!((r.cb_look, r.cb.unwrap().flagged), (ExtraLook::Judged, false));
        let (fl, rl) = flipped(&f, &regs);
        let r = run(&fl, &rl, None, true, &fc);
        show("left-facing film", &r);
        assert_eq!((r.cb_look, r.cb.unwrap().flagged), (ExtraLook::Judged, false));
        eprintln!("3 cranial-base points (cb_offset): {:?}; 2: {:?}", cb_offset(&without(&f, &["S", "N"]), &regs, false), cb_offset(&without(&f, &["S", "N", "Po"]), &regs, false));
        let r = run(&without(&f, &["S", "N"]), &regs, None, false, &fc);
        show("3 cranial-base points in the check", &r);
        assert_eq!(r.cb_look, ExtraLook::TooFew);
        let r = run(&without(&f, &["S", "N", "Po"]), &regs, None, false, &fc);
        show("2 cranial-base points in the check", &r);
        assert_eq!(r.cb_look, ExtraLook::TooFew);
        let r = run(&f, &regs_with(&regs, &[Region::Maxilla, Region::Mandible, Region::Incisors, Region::SoftTissue]), None, false, &fc);
        show("the cranial-base box not found", &r);
        assert_eq!(r.cb_look, ExtraLook::TooFew);
        let r = run(&shifted_opt(&f, 100.0, 0.0), &regs, None, false, &fc);
        show("the whole tracing shifted 100 px (10 mm at 0.1 mm/px): the centre also sees a whole-tracing shift", &r);
        assert!(r.cb.unwrap().offset.0 > cal.median.0);
        let r = run(&map_opt(&f, |p| (p.0 * 1000.0, p.1 * 1000.0)), &regs, None, false, &fc);
        show("x1000 (metre scale)", &r);
        assert!(r.cb.unwrap().flagged);
        let r = run(&moved_region(&f, Region::CranialBase, 150.0, 0.0), &regs, None, false, &fc);
        show("the cranial base moved 150 px (15 mm at 0.1 mm/px)", &r);
        assert!(r.cb.unwrap().flagged && r.cb.unwrap().distance > 2.0 * cal.line, "a 15 mm move must sit far outside the line");
        let r = check_film(None, &marks_opt(&f), false, W, H, RegionLook::NotRun(Look::NoRegionModel), &fc).unwrap();
        show("no region model", &r);
        assert_eq!(r.cb_look, ExtraLook::NoRegionModel);
        let r = run(&f, &regs, None, false, &FilmCal::tau_only(&TAU));
        show("centre calibration absent", &r);
        assert_eq!(r.cb_look, ExtraLook::NotSetUp);
    }

    // ---- SC-1 Part 1b Task B: the whole-film reference (whole-film-reference/1) ----

    /// SYNTHETIC: 40 tracings named ceph400:001-020 and aariz:001-020 (the same bare number in both datasets, so a match
    /// without the prefix would be caught), and their 20 stored lines fitted by `WholeScorer::new` (not by the code under
    /// test). Built once.
    fn small_ref() -> &'static (Vec<String>, Vec<Vec<Pt>>, Vec<(Vec<usize>, f64)>) {
        static R: OnceLock<(Vec<String>, Vec<Vec<Pt>>, Vec<(Vec<usize>, f64)>)> = OnceLock::new();
        R.get_or_init(|| {
            let names: Vec<String> = (1..=20).map(|i| format!("ceph400:{i:03}")).chain((1..=20).map(|i| format!("aariz:{i:03}"))).collect();
            let tr = faces(40, 4);
            let s = WholeScorer::new(tr.clone()).unwrap();
            let mut sets = vec![all()];
            for k in (0..19).rev() { sets.push((0..19).filter(|&j| j != k).collect()); }
            let lines = sets.into_iter().map(|set| { let l = s.line_for(&set).unwrap(); (set, l) }).collect();
            (names, tr, lines)
        })
    }
    fn small_text() -> String { let (n, t, l) = small_ref(); reference_json(n, t, l).unwrap() }

    /// Fails if a set is missing, repeated, out of order, or not ascending (the file and the bench rely on this list).
    #[test] fn stored_line_sets_are_the_19_and_each_18() {
        let s = stored_line_sets();
        assert_eq!(s.len(), 20);
        assert_eq!(s[0], all());
        for (i, k) in (0..19).rev().enumerate() { assert_eq!(s[i + 1], (0..19).filter(|&j| j != k).collect::<Vec<_>>(), "set {}", i + 1); }
        assert!(s[1..].windows(2).all(|w| w[0] < w[1]), "the 18-point sets ascend");
    }
    /// M16 / spec §17.4. Fails if `reference_name` drops the dataset, accepts a dataset other than the three, or PKU's
    /// name is not made (it is needed so a PKU name can be looked for and refused).
    #[test] fn reference_names_carry_their_dataset() {
        assert_eq!(reference_name("ceph400", "151").unwrap(), "ceph400:151");
        assert_eq!(reference_name("aariz", "cephalo_0042").unwrap(), "aariz:cephalo_0042");
        assert_eq!(reference_name("pku", "pku001").unwrap(), "pku:pku001");
        let e = reference_name("isbi", "151").unwrap_err().to_string();
        eprintln!("isbi: {e}");
        assert!(e.contains("isbi"), "{e}");
        assert!(reference_name("ceph400", "").is_err(), "an empty id is refused");
    }
    /// Spec §17.4. Each bad file is refused with a message naming what is wrong. Fails if a PKU or Test2 name, an unknown
    /// prefix, a repeated name, a tracing short of 19 points or a coordinate that is not a number is let through.
    #[test] fn a_reference_names_its_dataset_and_refuses_pku() {
        let (names, tr, lines) = small_ref();
        let ok = parse_reference(small_text().as_bytes()).unwrap();
        assert_eq!((ok.names.len(), ok.tracings.len(), ok.lines.len(), ok.sha256.len()), (40, 40, 20, 64));
        let renamed = |i: usize, to: &str| { let mut n = names.clone(); n[i] = to.into(); n };
        for (what, n, want) in [("pku:001", renamed(0, "pku:001"), "PKU"), ("ceph400:301", renamed(0, "ceph400:301"), "Test2"),
                                ("x:1", renamed(0, "x:1"), "x:1"), ("ceph400:1", renamed(0, "ceph400:1"), "ceph400:1"),
                                ("a repeated name", renamed(1, "ceph400:001"), "twice"), ("aariz: (no id)", renamed(30, "aariz:"), "aariz:")] {
            let e = format!("{:#}", reference_json(&n, tr, lines).unwrap_err());
            eprintln!("written with {what}: {e}");
            assert!(e.contains(want), "{what}: {e}");
            // The same name in a file written by hand is refused on reading too.
            let text = small_text().replacen(&format!("\"{}\"", names[if what == "a repeated name" { 1 } else if what.starts_with("aariz") { 30 } else { 0 }]),
                &format!("\"{}\"", n[if what == "a repeated name" { 1 } else if what.starts_with("aariz") { 30 } else { 0 }]), 1);
            let e = format!("{:#}", parse_reference(text.as_bytes()).unwrap_err());
            eprintln!("read with {what}: {e}");
            assert!(e.contains(want), "{what} (read): {e}");
        }
        let mut short = tr.clone(); short[5].truncate(18);
        let e = format!("{:#}", reference_json(names, &short, lines).unwrap_err());
        eprintln!("18 points: {e}");
        assert!(e.contains("19") && e.contains("ceph400:006"), "{e}");
        let mut nan = tr.clone(); nan[7][3].1 = f64::NAN;
        let e = format!("{:#}", reference_json(names, &nan, lines).unwrap_err());
        eprintln!("a NaN: {e}");
        assert!(e.contains("not a number") && e.contains("ceph400:008"), "{e}");
        let v: serde_json::Value = serde_json::from_str(&small_text()).unwrap();
        let first = v["tracings"][0]["points"][0][0].to_string();
        let e = format!("{:#}", parse_reference(small_text().replacen(&first, "null", 1).as_bytes()).unwrap_err());
        eprintln!("a null coordinate read: {e}");
        assert!(e.contains("not a number"), "{e}");
        let e = format!("{:#}", reference_json(names, tr, &lines[..19]).unwrap_err());
        eprintln!("19 stored lines: {e}");
        assert!(e.contains("line"), "{e}");
        let e = format!("{:#}", parse_reference(small_text().replace(REFERENCE_VERSION, "whole-film-reference/0").as_bytes()).unwrap_err());
        assert!(e.contains("whole-film-reference/0"), "{e}");
        let ok_from = WholeScorer::from_reference(&Reference { names: renamed(0, "pku:001"), ..ok.clone() });
        assert!(ok_from.unwrap_err().to_string().contains("PKU"), "from_reference checks the names too");
    }
    /// The stored line is what the app uses (the app never refits it). Fails if `from_reference` ignores `lines` (the
    /// one-ULP-changed value would not come back) or carries a wrong set's line; a reference with no stored lines fits
    /// them fresh and gets the true line.
    #[test] fn from_reference_uses_the_stored_line() {
        let (names, tr, lines) = small_ref();
        let mut bumped = lines.clone();
        bumped[0].1 = f64::from_bits(bumped[0].1.to_bits() + 1);
        let r = parse_reference(reference_json(names, tr, &bumped).unwrap().as_bytes()).unwrap();
        let s = WholeScorer::from_reference(&r).unwrap();
        let mut want = stored_line_sets(); want.sort();
        assert_eq!(s.cached_line_sets(), want, "all 20 stored lines are seeded, and only they");
        assert_eq!(s.line_for(&all()).unwrap().to_bits(), bumped[0].1.to_bits(), "the stored (changed) line is used");
        for (set, l) in &lines[1..] { assert_eq!(s.line_for(set).unwrap().to_bits(), l.to_bits(), "{set:?}"); }
        let fresh = WholeScorer::from_reference(&Reference { lines: vec![], ..r.clone() }).unwrap();
        assert!(fresh.cached_line_sets().is_empty());
        assert_eq!(fresh.line_for(&all()).unwrap().to_bits(), lines[0].1.to_bits(), "fitted fresh: the true line");
        assert_eq!((s.films(), s.names()[20].as_str()), (40, "aariz:001"));
    }
    /// Spec §17.4 "Stage A is untouched". Fails if `prior_path` is moved to the new file (or the new file to Stage A's
    /// name), if Stage A's loader starts taking more than 300 films, or if either loader reads the other's file.
    #[test] fn stage_a_still_loads_ceph400_v1() {
        let m = std::path::Path::new("models");
        assert_eq!(crate::pointcheck::prior_path(m), m.join("shape").join("ceph400-v1.shape"));
        assert_eq!(reference_path(m), m.join("shape").join("whole-film-reference-v1.shape"));
        let films: Vec<(String, Vec<Pt>)> = faces(300, 4).into_iter().enumerate().map(|(i, t)| (format!("{:03}", i + 1), t)).collect();
        let prior = crate::pointcheck::prior_json(&films).unwrap();
        assert_eq!(crate::pointcheck::parse_prior(prior.as_bytes()).unwrap().films, 300, "Stage A's 300-film file still loads");
        let thousand: Vec<(String, Vec<Pt>)> = (0..1000).map(|i| (format!("{:03}", i % 300 + 1), films[i % 300].1.clone())).collect();
        assert!(crate::pointcheck::prior_json(&thousand).is_err(), "Stage A's writer refuses 1,000 films");
        let e = crate::pointcheck::parse_prior(prior.replacen("\"films\": 300", "\"films\": 1000", 1).as_bytes()).unwrap_err().to_string();
        eprintln!("Stage A's file saying 1,000 films: {e}");
        assert!(e.contains("300"), "{e}");
        assert!(crate::pointcheck::parse_prior(small_text().as_bytes()).is_err(), "Stage A's loader refuses the new file");
        assert!(parse_reference(prior.as_bytes()).is_err(), "the new loader refuses Stage A's file");
    }
    /// M17. Fails if names are matched without their prefix ("003" taking ceph400:003 or aariz:003), a missing or
    /// repeated name is skipped silently, the stored lines are carried over to the smaller set, or the result is not the
    /// same scorer as `leave_out` by index.
    #[test] fn leave_out_names_drops_by_name() {
        let r = parse_reference(small_text().as_bytes()).unwrap();
        let s = WholeScorer::from_reference(&r).unwrap();
        let by_name = s.leave_out_names(&["ceph400:003".into(), "aariz:017".into()]).unwrap();
        let by_index = s.leave_out(&[2, 36]).unwrap();
        assert_eq!(by_name.names(), by_index.names());
        assert!(by_name.names().contains(&"aariz:003".to_string()) && !by_name.names().contains(&"ceph400:003".to_string()));
        assert!(by_name.cached_line_sets().is_empty(), "the stored lines are not carried over");
        let probe = faces(1, 11).remove(0);
        assert_eq!(by_name.d2_of(&probe, &all()).unwrap().to_bits(), by_index.d2_of(&probe, &all()).unwrap().to_bits());
        assert_eq!(by_name.line_for(&all()).unwrap().to_bits(), by_index.line_for(&all()).unwrap().to_bits());
        for (bad, want) in [(vec!["003"], "003"), (vec!["ceph400:099"], "ceph400:099"), (vec!["aariz:005", "aariz:005"], "twice")] {
            let names: Vec<String> = bad.iter().map(|x| x.to_string()).collect();
            let e = s.leave_out_names(&names).unwrap_err().to_string();
            eprintln!("leave out {bad:?}: {e}");
            assert!(e.contains(want) && e.contains(bad[0]), "{bad:?}: {e}");
        }
    }
    /// Spec §17.4 "a tracing with 17 or fewer points has its line fitted the first time it is needed": from the stored
    /// reference, a 17-point tracing's set is not stored, and `warm` fits it (its time printed). Fails if a 17-point
    /// set were wrongly answered from a stored set, or if warm did not add it.
    #[test] fn a_17_point_tracing_is_fitted_on_first_use() {
        let s = WholeScorer::from_reference(&parse_reference(small_text().as_bytes()).unwrap()).unwrap();
        let f = faces(1, 7).remove(0);
        let mk: Vec<Mark> = marks(&f).into_iter().filter(|m| m.landmark_id != "Po" && m.landmark_id != "PNS").collect();
        let t = std::time::Instant::now();
        let set = s.warm(&mk, false, W).unwrap().unwrap();
        eprintln!("17 points: line fitted on first use in {} ms (40 SYNTHETIC tracings)", t.elapsed().as_millis());
        assert_eq!(set.len(), 17);
        assert!(s.cached_line_sets().contains(&set) && s.cached_line_sets().len() == 21);
        let fresh = WholeScorer::new(faces(40, 4)).unwrap();
        assert_eq!(s.line_for(&set).unwrap().to_bits(), fresh.line_for(&set).unwrap().to_bits());
    }

    /// D2 fix round 2 (N2): `cb_present` counts the traced S, N, Po, Ar, Or on the points as stored; it is what `check_film`
    /// itself compares with `CB_POINTS`. Fails if it counts another point, or a point that is not there.
    #[test] fn cb_present_counts_the_five_cranial_base_points() {
        let marks: Vec<Mark> = ORDER.iter().zip(crate::shape::synthetic_faces(1, 7).remove(0)).map(|(id, p)| Mark { landmark_id: id.to_string(), x: p.0, y: p.1 }).collect();
        assert_eq!(cb_present(&marks, 2400).unwrap(), 5);
        for gone in ["S", "N", "Po", "Ar", "Or"] {
            let m: Vec<Mark> = marks.iter().filter(|x| x.landmark_id != gone).cloned().collect();
            assert_eq!(cb_present(&m, 2400).unwrap(), 4, "without {gone}");
        }
        let m: Vec<Mark> = marks.iter().filter(|x| x.landmark_id != "Me").cloned().collect();
        assert_eq!(cb_present(&m, 2400).unwrap(), 5, "a point outside the cranial base changes nothing");
        assert_eq!(cb_present(&[], 2400).unwrap(), 0);
    }

    // ---- whole-film/3 (owner ruling, 5 Nov 2026, spec §17.15): the ruled centre line and gate /4 ----

    fn ruled(median: (f64, f64)) -> CbCalibration {
        CbCalibration { line: 0.08, ruling: Some(CbRuling { rule: "whole-film/3".into(), measured_line: 0.06, record_sha256: "4".repeat(64) }), ..cbc(median, 0.08) }
    }
    /// A ruled centre file round-trips with its ruling; a measured file (no ruling) reads and writes as before, with no
    /// `ruling` key; a ruling that narrows the measured line, names no whole-film rule, has a bad record hash or an
    /// unknown key is refused. Fails if: the ruling is not checked, or a measured file gains a key.
    #[test] fn a_ruled_centre_calibration_round_trips_and_refuses_what_it_cannot_be() {
        let r = ruled((-0.0457, 0.0048));
        let j = serde_json::to_string_pretty(&r).unwrap();
        eprintln!("ruled file:\n{j}");
        assert_eq!(parse_cb_calibration(j.as_bytes()).unwrap(), r);
        let m = cbc((-0.0457, 0.0048), 0.06);
        let mj = serde_json::to_string(&m).unwrap();
        assert!(!mj.contains("ruling"), "a measured file is written as before: {mj}");
        assert_eq!(parse_cb_calibration(mj.as_bytes()).unwrap().ruling, None);
        for (bad, why) in [(j.replace("\"measuredLine\": 0.06", "\"measuredLine\": 0.09"), "narrow"), (j.replace("\"whole-film/3\"", "\"sc1-cb-centre/1\""), "whole-film"),
                           (j.replace(&"4".repeat(64), "4"), "record"), (j.replace("\"measuredLine\": 0.06", "\"measuredLine\": 0.06, \"extra\": 1"), "unknown field"),
                           (j.replace("\"measuredLine\": 0.06", "\"measuredLine\": 0.01"), "measured line")] {
            let e = parse_cb_calibration(bad.as_bytes()).map(|_| "accepted".to_string()).unwrap_or_else(|e| e.to_string());
            eprintln!("{why}: {e}");
            assert!(e.contains(why), "{why}: {e}");
        }
    }
    /// The centre exactly at the ruled line 0.08 is NOT flagged (the comparison stays strict, `beyond`: d > line, as
    /// whole-film/2's); one step further out is flagged. Through `check_film`, with d == 0.08 bit for bit. Fails if: the
    /// centre verdict uses >= (M25).
    #[test] fn the_centre_exactly_at_the_ruled_line_is_not_flagged() {
        let (f, regs) = face_and_boxes(3);
        let o = cb_offset(&f, &regs, false).unwrap();
        // The median 0.08 above this film's offset on y (on y the median and 0.08 share one ulp size, so a search ulp by
        // ulp reaches a distance of 0.08 exactly; hypot of (0, y) is |y|).
        let m0 = (o.1 - 0.08).to_bits() as i64;
        let near = |want: &dyn Fn(f64) -> bool| (-64..=64).map(|k| f64::from_bits((m0 + k) as u64)).find(|m| want(cb_distance(o, &ruled((o.0, *m))))).unwrap();
        let my = near(&|d| d == 0.08);
        let cal = ruled((o.0, my));
        let at = run(&f, &regs, None, false, &with_cb(&cal, &TAU)).cb.unwrap();
        let far = ruled((o.0, near(&|d| d > 0.08)));
        let out = run(&f, &regs, None, false, &with_cb(&far, &TAU)).cb.unwrap();
        eprintln!("at the line: {at:?}; one step further out: {out:?}");
        assert_eq!(at.distance, 0.08, "the fixture puts the centre exactly on the line");
        assert!(!at.flagged, "exactly on the line is not beyond it");
        assert!(out.distance > 0.08 && out.flagged);
    }
    /// A complete 19-point tracing on a film with no cranial-base box: the centre look reads too-few (never flags); the
    /// size look is judged on the other regions' line; the region look judges the rest. Output printed. Fails if: a film
    /// without the box is centre-judged or flagged for it.
    #[test] fn a_19_point_tracing_with_no_cranial_base_box() {
        let (f, regs) = face_and_boxes(3);
        let no_cb = regs_with(&regs, &[Region::Maxilla, Region::Mandible, Region::Incisors, Region::SoftTissue]);
        let three = vec![Region::Maxilla, Region::Mandible, Region::Incisors];
        let q = size_score(&f, &no_cb, &[Region::CranialBase, Region::Maxilla, Region::Mandible, Region::Incisors]).unwrap();
        let four = vec![Region::CranialBase, Region::Maxilla, Region::Mandible, Region::Incisors];
        let size = SizeCalibration { uses: four.clone(), ..cal_for(&[(four.clone(), 0.0, 0.09), (three.clone(), q.1, 0.32)]) };
        assert_eq!(q.0, three, "without its box the cranial base drops out of the size look's set");
        let cb = ruled(cb_offset(&f, &regs, false).unwrap());
        let r = run(&f, &no_cb, None, false, &FilmCal { tau: &TAU, size: Some(&size), cb: Some(&cb) });
        eprintln!("19 points, no cranial-base box: present {}, check {:?}, region look {:?}, size {:?} {:?}, centre {:?} {:?}", r.present, r.check, r.region_look, r.size_look, r.size, r.cb_look, r.cb);
        assert_eq!((r.present, r.cb_look, r.cb), (19, ExtraLook::TooFew, None));
        assert_eq!(r.size_look, ExtraLook::Judged);
        assert_eq!(r.size.unwrap().line, 0.32, "the three-region line");
        assert!(cb_reason(&r).is_none(), "no cranial-base reason without its box");
    }
}
