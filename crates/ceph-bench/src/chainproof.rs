//! The chain spec's S1 proof on Ceph-400 (spec §6 S1; Part F
//! plan Task 14). Pretend clinicians, films in a seeded random order, and the real rule (`ceph_model::best::decide`) on
//! their records. Proof only: it writes a report to reports/; nothing in the app reads it
//! (tests/no_app_reads_the_chain_proof.rs). Pass marks pre-registered in reference/chain-proof-s1.json, committed
//! before the run. Ceph-400 Test2 stays closed (owner O7; question 8): train and test1 only.
use crate::xcache::FilmRun;
use ceph_model::best::{self, Files, RecordRow, Tier};
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const PREREG: &str = include_str!("../../../reference/chain-proof-s1.json");
/// SHA-256 of the committed pre-registration (Step 4 fills it from the failing pin test's message).
#[cfg(test)]
const PINNED_SHA256: &str = "e4271f1eec1c03b56bafc80abe8925d5abb64bb9c58850597ce75955a273c075";
/// The challenger's model id in the pretend records.
pub const PLANTED: &str = "planted";

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Prereg {
    pub version: String, pub rule_version: String, pub seed: u64, pub clinicians: usize, pub films_per_test: usize,
    pub planted_points: Vec<String>, pub planted_fraction: f64, pub satisfied_within_mm: f64,
    pub offer_share_min: f64, pub false_offer_max: f64, pub satisfied_false_offer_max: f64, pub control_offset_mm: f64,
    pub floor_points: Vec<String>, pub floor_fractions: Vec<f64>,
}

/// splitmix64: a seeded stream, the same numbers on every machine, with no new dependency.
pub struct Rng(u64);
impl Rng {
    pub fn new(seed: u64) -> Self { Rng(seed) }
    pub fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    pub fn below(&mut self, n: usize) -> usize { (self.next() % n as u64) as usize }
    pub fn sign(&mut self) -> f64 { if self.next() & 1 == 0 { 1.0 } else { -1.0 } }
}
pub fn shuffle<T>(v: &mut [T], r: &mut Rng) { for i in (1..v.len()).rev() { v.swap(i, r.below(i + 1)); } }

/// One film for one point: Aariz's raw mark and the dataset's answer (film px), and the film's mm per px.
#[derive(Clone, Debug, PartialEq)]
pub struct Mark { pub film: String, pub aariz: (f64, f64), pub truth: (f64, f64), pub mm_per_px: f64 }

/// Self-based: final = Aariz's mark + the film's scatter × a random sign. Satisfied: the same, but a final within
/// `satisfied_within_mm` of Aariz's mark is accepted unmoved. Offset: Aariz's mark moved this many mm to the right on every
/// film (the control: the challenger on that point must always win).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Clinician { SelfBased, Satisfied, Offset(f64) }
/// Fraction(f): the clinician's final point + f × the film's scatter, own random sign (question 4: from the clinician's
/// point). Equal: + another film's scatter (a seeded permutation): the same spread of distances as Aariz's.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Challenger { Fraction(f64), Equal }

/// Aariz's scatter on one point (chain spec §6): its error on each film with its average error removed, film px.
pub fn scatter(marks: &[Mark]) -> Vec<(f64, f64)> {
    let n = marks.len() as f64;
    let e: Vec<(f64, f64)> = marks.iter().map(|m| (m.aariz.0 - m.truth.0, m.aariz.1 - m.truth.1)).collect();
    let mean = (e.iter().map(|v| v.0).sum::<f64>() / n, e.iter().map(|v| v.1).sum::<f64>() / n);
    e.iter().map(|v| (v.0 - mean.0, v.1 - mean.1)).collect()
}

/// One pretend clinician's records for one point on the first `films` films of their seeded order: Aariz (the placer)
/// and the challenger, each a pixel distance from the clinician's final point. Every film is a ruler film.
#[allow(clippy::too_many_arguments)]
pub fn records(point: &str, marks: &[Mark], sc: &[(f64, f64)], who: Clinician, ch: Challenger, films: usize, satisfied_mm: f64, rng: &mut Rng) -> Vec<RecordRow> {
    let n = marks.len();
    let mut order: Vec<usize> = (0..n).collect();
    shuffle(&mut order, rng);
    let mut perm: Vec<usize> = (0..n).collect();
    shuffle(&mut perm, rng);
    let off = |p: (f64, f64), q: (f64, f64)| (p.0 - q.0).hypot(p.1 - q.1);
    let mut out = Vec::new();
    for (k, &f) in order.iter().take(films).enumerate() {
        let m = &marks[f];
        let s = rng.sign();
        let mut fin = match who { Clinician::Offset(mm) => (m.aariz.0 + mm / m.mm_per_px, m.aariz.1), _ => (m.aariz.0 + s * sc[f].0, m.aariz.1 + s * sc[f].1) };
        let unmoved = off(fin, m.aariz) == 0.0 || (who == Clinician::Satisfied && off(fin, m.aariz) * m.mm_per_px <= satisfied_mm);
        if unmoved { fin = m.aariz; }
        let r = rng.sign();
        let d = match ch { Challenger::Fraction(x) => (x * sc[f].0, x * sc[f].1), Challenger::Equal => sc[perm[f]] };
        let mark = (fin.0 + r * d.0, fin.1 + r * d.1);
        let key = format!("{k:04}");
        let how = if unmoved { "accepted-unmoved" } else { "moved" };
        for (model, dist, placer) in [(best::DEFAULT_BASE, off(fin, m.aariz), true), (PLANTED, off(mark, fin), false)] {
            out.push(RecordRow { case_id: format!("{}-{key}", m.film), imported_at: key.clone(), landmark_id: point.into(), model_id: model.into(),
                dist_px: dist, mm_per_px: m.mm_per_px, tier: Tier::Ruler, fine_tuned: false, how: how.into(), placer, fingerprint: Some("proof".into()) });
        }
    }
    out
}

/// Whether the rule offers the challenger for this point on these records.
pub fn offered(point: &str, rows: &[RecordRow]) -> bool {
    let files = Files { current: [(best::DEFAULT_BASE.to_string(), "proof".to_string()), (PLANTED.to_string(), "proof".to_string())].into_iter().collect(), earlier: Default::default() };
    best::decide(&[point], &[PLANTED, best::DEFAULT_BASE], rows, &[], &files, best::DEFAULT_BASE)[0].offer.as_deref() == Some(PLANTED)
}

/// The share of the pre-registered number of clinicians offered the challenger on this point within `films_per_test`
/// films. `salt` gives each test its own random stream.
pub fn offer_share(point: &str, marks: &[Mark], who: Clinician, ch: Challenger, p: &Prereg, salt: u64) -> f64 {
    offer_count(point, marks, who, ch, p, salt, 0..p.clinicians) as f64 / p.clinicians as f64
}

/// How many of these clinicians (by number, each with its own seeded stream) are offered the challenger. Clinician c's
/// stream depends only on the seed, the salt and c, so clinicians 0..200 are the same ones whatever the total.
pub fn offer_count(point: &str, marks: &[Mark], who: Clinician, ch: Challenger, p: &Prereg, salt: u64, clinicians: std::ops::Range<usize>) -> usize {
    let sc = scatter(marks);
    clinicians.filter(|c| {
        let mut rng = Rng::new(p.seed ^ salt.wrapping_mul(0xA24B_AED4_963E_E407) ^ (*c as u64).wrapping_mul(0x9E37_79B9_7F4A_7C15));
        offered(point, &records(point, marks, &sc, who, ch, p.films_per_test, p.satisfied_within_mm, &mut rng))
    }).count()
}

/// Every film with Aariz's mark and the dataset's answer for this point.
pub fn marks_for(point: &str, films: &[FilmRun], gt: &crate::dataset::Points) -> Vec<Mark> {
    films.iter().filter_map(|f| {
        let a = f.models.get(best::DEFAULT_BASE)?.as_ref().ok()?.get(point)?;
        let t = gt.get(&f.film)?.iter().find(|(l, _, _)| l == point)?;
        Some(Mark { film: f.film.clone(), aariz: (a.x, a.y), truth: (t.1, t.2), mm_per_px: f.mm_per_px })
    }).collect()
}

/// P1.4 (answer 3: for information, never to choose): which Ceph-400 films each model trained on, as
/// THIRD_PARTY_MODELS.md and the catalogue's `leakage` (crates/ceph-model/catalog/catalog.json) say (checked 27 Oct).
/// Aariz on none ("not trained on ISBI films"); SRPose (CL-Detection 2023) on films that include all of ISBI 2015;
/// cwlachap on a random 70/15/15 split of all of ISBI 2015 (catalogue: Ceph-400 "leaked"), so every split is home ground;
/// GU2Net on ISBI 2015 training films 001–150 only (Test1 and Test2 clean). Any other model: "unknown", never "clean".
pub fn leakage(model: &str, split: &str) -> &'static str {
    match (model, split.to_lowercase().as_str()) {
        ("aariz-cepha29", _) => "clean",
        ("srpose-cldet23" | "cwlachap-hrnet-w32", _) => "home-ground",
        ("gu2net-isbi19", "train") => "home-ground",
        ("gu2net-isbi19", "test1" | "test2") => "clean",
        _ => "unknown",
    }
}

/// A cache of a held-back split is refused before any film is read (owner O7; question 8).
pub fn refuse_held_back_cache(data: &std::path::Path, split: &str) -> anyhow::Result<()> {
    anyhow::ensure!(!crate::ledger::is_held_back(data, split), "{} {split} is held back (owner O7): the chain proof never opens it (question 8)", data.display());
    Ok(())
}

/// A cache's header, read alone (its films file is not opened), refused if its split is held back, judged both by the
/// --data folder and by the dataset the cache says it was made from (a Test2 cache cannot pass under another --data).
pub fn cache_header(data: &std::path::Path, dir: &std::path::Path) -> anyhow::Result<crate::xcache::CacheHeader> {
    use anyhow::Context;
    let f = dir.join("cache-header.json");
    let h: crate::xcache::CacheHeader = serde_json::from_slice(&std::fs::read(&f).with_context(|| f.display().to_string())?)
        .with_context(|| format!("{}: not a cache header", f.display()))?;
    refuse_held_back_cache(data, &h.split)?;
    refuse_held_back_cache(std::path::Path::new(&h.dataset), &h.split)?;
    Ok(h)
}

/// The pass marks are pre-registered: the file at HEAD (`git show HEAD:reference/chain-proof-s1.json`, None when it is
/// not committed) must be the very bytes this program was built with.
pub fn committed_as_built(at_head: Option<Vec<u8>>) -> anyhow::Result<()> {
    let at_head = at_head.ok_or_else(|| anyhow::anyhow!("reference/chain-proof-s1.json is not committed: the pass marks are pre-registered, commit them before the run"))?;
    anyhow::ensure!(at_head == PREREG.as_bytes(), "reference/chain-proof-s1.json at HEAD differs from the one this program was built with: rebuild from the committed tree");
    Ok(())
}

fn median(v: &[f64]) -> f64 { let mut s = v.to_vec(); s.sort_by(f64::total_cmp); let n = s.len(); if n % 2 == 1 { s[n / 2] } else { (s[n / 2 - 1] + s[n / 2]) / 2.0 } }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Cell { pub model: String, pub split: String, pub point: String, pub films: usize, pub failed: usize, pub mre_mm: f64, pub median_mm: f64, pub sdr2: f64, pub leakage: &'static str }
/// P1.4: per split, model and point, the mean and median radial error and the share within 2 mm, against the dataset's
/// answer at its stated scale.
pub fn table(films: &[FilmRun], splits: &[(String, Vec<String>)], gt: &crate::dataset::Points, points: &[&str]) -> Vec<Cell> {
    let models: BTreeSet<String> = films.iter().flat_map(|f| f.models.keys().cloned()).collect();
    let mut out = vec![];
    for (split, ids) in splits {
        let these: Vec<&FilmRun> = films.iter().filter(|f| ids.contains(&f.film)).collect();
        for m in &models {
            for p in points {
                let failed = these.iter().filter(|f| f.models.get(m).map_or(true, |r| r.is_err())).count();
                let errs: Vec<f64> = these.iter().filter_map(|f| {
                    let g = f.models.get(m)?.as_ref().ok()?.get(*p)?;
                    let t = gt.get(&f.film)?.iter().find(|(l, _, _)| l == p)?;
                    Some(crate::metrics::radial_error_mm((g.x, g.y), (t.1, t.2), f.mm_per_px))
                }).collect();
                if errs.is_empty() { continue; }
                let s = crate::metrics::summarize(&errs, &[2.0]);
                out.push(Cell { model: m.clone(), split: split.clone(), point: p.to_string(), films: s.n, failed, mre_mm: s.mre, median_mm: median(&errs), sdr2: s.sdr[0].1, leakage: leakage(m, split) });
            }
        }
    }
    out
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult { pub name: String, pub point: String, pub share: f64, pub mark: String, pub passed: bool }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FloorRow { pub point: String, pub fraction: f64, pub median_advantage_mm: f64, pub share: f64, pub spec_floor_mm: Option<f64> }
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub prereg: Prereg, pub films: usize, pub held_back: String, pub films_per_point: BTreeMap<String, usize>,
    pub tests: Vec<TestResult>, pub control_ok: bool, pub passed: bool, pub floor: Vec<FloorRow>, pub table: Vec<Cell>,
}
impl Report {
    pub fn summary(&self) -> String {
        let mut s = format!("chain proof S1 on {} Ceph-400 films ({}); rule {}\n", self.films, self.held_back, self.prereg.rule_version);
        for t in &self.tests { s += &format!("  {} {}: {:.3} (mark {}) {}\n", t.name, t.point, t.share, t.mark, if t.passed { "PASS" } else { "FAIL" }); }
        s += &format!("control {}; overall {}", if self.control_ok { "held" } else { "BROKEN" }, if self.passed { "PASS" } else { "FAIL" });
        s
    }
}

/// S1's tests (P1.1–P1.3 with the control, the floor sweep, and P1.4) on the allowed films.
pub fn run_s1(films: &[FilmRun], splits: &[(String, Vec<String>)], gt: &crate::dataset::Points, p: &Prereg) -> anyhow::Result<Report> {
    // The proof runs the rule with Aariz as the base (best-point/4 with DEFAULT_BASE gives best-point/3's verdicts exactly).
    anyhow::ensure!(best::reproduced_with_default_base(&p.rule_version), "the pre-registration names {} but the rule is {}", p.rule_version, best::RULE_VERSION);
    let mut seen = BTreeSet::new();
    if let Some(f) = films.iter().find(|f| !seen.insert(f.film.as_str())) {
        anyhow::bail!("film {} is given twice (the same cache named twice, or two caches of one split?)", f.film);
    }
    let (mut tests, mut per_point) = (vec![], BTreeMap::new());
    for (i, pt) in p.planted_points.iter().enumerate() {
        let marks = marks_for(pt, films, gt);
        anyhow::ensure!(marks.len() >= p.films_per_test, "{pt}: only {} films carry Aariz's mark and the answer (the test needs {})", marks.len(), p.films_per_test);
        per_point.insert(pt.clone(), marks.len());
        let salt = 16 * (i as u64 + 1);
        let mut add = |name: &str, share: f64, mark: String, passed: bool| tests.push(TestResult { name: name.into(), point: pt.clone(), share, mark, passed });
        let c = offer_share(pt, &marks, Clinician::Offset(p.control_offset_mm), Challenger::Fraction(0.0), p, salt);
        add("control: the challenger on the clinician's own point, Aariz 3 mm off", c, "= 1.000 (instrument check)".into(), c == 1.0);
        let s1 = offer_share(pt, &marks, Clinician::SelfBased, Challenger::Fraction(p.planted_fraction), p, salt + 1);
        add("P1.1 planted challenger (half Aariz's scatter)", s1, format!(">= {}", p.offer_share_min), s1 >= p.offer_share_min);
        let s2 = offer_share(pt, &marks, Clinician::SelfBased, Challenger::Equal, p, salt + 2);
        add("P1.2 equal challenger", s2, format!("<= {}", p.false_offer_max), s2 <= p.false_offer_max);
        let s3 = offer_share(pt, &marks, Clinician::Satisfied, Challenger::Equal, p, salt + 3);
        add("P1.3 equal challenger, satisfied clinician", s3, format!("<= {}", p.satisfied_false_offer_max), s3 <= p.satisfied_false_offer_max);
    }
    let control_ok = tests.iter().filter(|t| t.name.starts_with("control")).all(|t| t.passed);
    let mut floor = vec![];
    for (i, pt) in p.floor_points.iter().enumerate() {
        let marks = marks_for(pt, films, gt);
        anyhow::ensure!(marks.len() >= p.films_per_test, "{pt}: only {} films carry Aariz's mark and the answer (the floor sweep needs {})", marks.len(), p.films_per_test);
        let sc = scatter(&marks);
        let spread: Vec<f64> = sc.iter().zip(&marks).map(|(d, m)| d.0.hypot(d.1) * m.mm_per_px).collect();
        for (j, f) in p.floor_fractions.iter().enumerate() {
            let share = offer_share(pt, &marks, Clinician::SelfBased, Challenger::Fraction(*f), p, 1000 + 64 * i as u64 + j as u64);
            floor.push(FloorRow { point: pt.clone(), fraction: *f, median_advantage_mm: (1.0 - f) * median(&spread), share,
                spec_floor_mm: match pt.as_str() { "B" => Some(0.5), "Go" => Some(0.75), _ => None } });
        }
    }
    let ids: Vec<&str> = ceph_model::scores::ORIGINAL_19.to_vec();
    let passed = control_ok && tests.iter().all(|t| t.passed);
    Ok(Report { prereg: p.clone(), films: films.len(), held_back: "Test2 (100 films) held back, owner O7; question 8".into(), films_per_point: per_point,
        tests, control_ok, passed, floor, table: table(films, splits, gt, &ids) })
}

// ---- POST-HOC P1.3 (owner 27 Oct, by multiple choice): `--chain-proof s1 --posthoc-clinicians N`. ----
// S1 missed P1.3 (the satisfied clinician's false-offer share, mark <= 0.05) at Go 0.070, Po 0.055 and B 0.055 with the
// pre-registered 200 clinicians. The miss stands and the rule stays. This re-runs ONLY that test (and its control) with
// N clinicians, the same seed, streams and pre-registration otherwise, to see whether the true rate is above 5 % or the
// miss was chance. It informs a later tightening; it cannot turn the miss into a pass, so it never reports one.

/// On every console line and every JSON record of the post-hoc run.
pub const POSTHOC_LABEL: &str = "POST-HOC (owner 27 Oct, not pre-registered); cannot change the S1 result";

/// Wilson's score interval for k of n at 95 % (z = the 0.975 normal quantile). n must be above 0.
pub fn wilson(k: usize, n: usize) -> (f64, f64) {
    const Z: f64 = 1.959_963_984_540_054;
    let (nf, p) = (n as f64, k as f64 / n as f64);
    let d = 1.0 + Z * Z / nf;
    let centre = (p + Z * Z / (2.0 * nf)) / d;
    let half = Z / d * (p * (1.0 - p) / nf + Z * Z / (4.0 * nf * nf)).sqrt();
    ((centre - half).max(0.0), (centre + half).min(1.0))
}

/// A share of some clinicians, with its count and its Wilson 95 % interval.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Share { pub clinicians: usize, pub offered: usize, pub share: f64, pub ci95_low: f64, pub ci95_high: f64 }
impl Share {
    pub fn of(offered: usize, clinicians: usize) -> Share {
        let (lo, hi) = if clinicians == 0 { (f64::NAN, f64::NAN) } else { wilson(offered, clinicians) };
        Share { clinicians, offered, share: if clinicians == 0 { f64::NAN } else { offered as f64 / clinicians as f64 }, ci95_low: lo, ci95_high: hi }
    }
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosthocTest {
    pub label: &'static str, pub name: String, pub point: String,
    /// All N clinicians.
    pub clinicians: usize, pub offered: usize, pub share: f64, pub ci95_low: f64, pub ci95_high: f64,
    /// The S1 mark, for reference only: this run is not judged against it.
    pub s1_mark: String,
    /// Clinicians 0..200: the very ones the S1 run used (reproduces its share).
    pub first_preregistered: Share,
    /// Clinicians 200..N: new ones, independent of the S1 result.
    pub beyond_preregistered: Share,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PosthocReport {
    pub label: &'static str, pub prereg: Prereg, pub clinicians: usize, pub films: usize, pub held_back: String,
    pub films_per_point: BTreeMap<String, usize>, pub control_held: bool, pub tests: Vec<PosthocTest>,
}
impl PosthocReport {
    pub fn summary(&self) -> String {
        let l = POSTHOC_LABEL;
        let mut s = format!("{l} | P1.3 re-run with {} pretend clinicians on {} Ceph-400 films ({}); rule {}; seed {}\n", self.clinicians, self.films, self.held_back, self.prereg.rule_version, self.prereg.seed);
        let fmt = |x: &Share| format!("{}/{} = {:.3} (95% CI {:.3}-{:.3})", x.offered, x.clinicians, x.share, x.ci95_low, x.ci95_high);
        for t in &self.tests {
            s += &format!("{l} | {} {}: {}/{} = {:.3} (95% Wilson CI {:.3}-{:.3}); first {}: {}; beyond: {}; S1 mark {} for reference only\n",
                t.name, t.point, t.offered, t.clinicians, t.share, t.ci95_low, t.ci95_high, self.prereg.clinicians, fmt(&t.first_preregistered), fmt(&t.beyond_preregistered), t.s1_mark);
        }
        s += &format!("{l} | control {}", if self.control_held { "held" } else { "BROKEN (the instrument is broken)" });
        s
    }
}

/// The post-hoc P1.3 run: for each planted point, the control and P1.3 only, with `clinicians` pretend clinicians and the
/// S1 run's seed and salts (so clinicians 0..200 are S1's own). Refuses too few films, as S1 does: nothing analysed is
/// an error.
pub fn run_posthoc_p13(films: &[FilmRun], gt: &crate::dataset::Points, p: &Prereg, clinicians: usize) -> anyhow::Result<PosthocReport> {
    let l = POSTHOC_LABEL;
    anyhow::ensure!(clinicians > 0, "{l}: --posthoc-clinicians needs at least 1 clinician");
    anyhow::ensure!(best::reproduced_with_default_base(&p.rule_version), "{l}: the pre-registration names {} but the rule is {}", p.rule_version, best::RULE_VERSION);
    let mut seen = BTreeSet::new();
    if let Some(f) = films.iter().find(|f| !seen.insert(f.film.as_str())) {
        anyhow::bail!("{l}: film {} is given twice (the same cache named twice, or two caches of one split?)", f.film);
    }
    let first = p.clinicians.min(clinicians);
    let (mut tests, mut per_point) = (vec![], BTreeMap::new());
    for (i, pt) in p.planted_points.iter().enumerate() {
        let marks = marks_for(pt, films, gt);
        anyhow::ensure!(marks.len() >= p.films_per_test, "{l}: {pt}: only {} films carry Aariz's mark and the answer (the test needs {})", marks.len(), p.films_per_test);
        per_point.insert(pt.clone(), marks.len());
        // The same salts as run_s1: the control at 16(i+1), P1.3 at 16(i+1) + 3.
        let salt = 16 * (i as u64 + 1);
        for (name, who, ch, salt, mark) in [
            ("control: the challenger on the clinician's own point, Aariz 3 mm off", Clinician::Offset(p.control_offset_mm), Challenger::Fraction(0.0), salt, "= 1.000 (instrument check)".to_string()),
            ("P1.3 equal challenger, satisfied clinician", Clinician::Satisfied, Challenger::Equal, salt + 3, format!("<= {}", p.satisfied_false_offer_max)),
        ] {
            let a = offer_count(pt, &marks, who, ch, p, salt, 0..first);
            let b = offer_count(pt, &marks, who, ch, p, salt, first..clinicians);
            let all = Share::of(a + b, clinicians);
            tests.push(PosthocTest { label: l, name: name.into(), point: pt.clone(), clinicians, offered: all.offered, share: all.share,
                ci95_low: all.ci95_low, ci95_high: all.ci95_high, s1_mark: mark, first_preregistered: Share::of(a, first), beyond_preregistered: Share::of(b, clinicians - first) });
        }
    }
    let control_held = tests.iter().filter(|t| t.name.starts_with("control")).all(|t| t.offered == t.clinicians);
    Ok(PosthocReport { label: l, prereg: p.clone(), clinicians, films: films.len(), held_back: "Test2 (100 films) held back, owner O7; question 8".into(),
        films_per_point: per_point, control_held, tests })
}

/// Writes <out>/posthoc-p13-<N>.json and returns its path. Never chain-proof-s1.json.
pub fn write_posthoc(out: &std::path::Path, r: &PosthocReport) -> anyhow::Result<std::path::PathBuf> {
    std::fs::create_dir_all(out)?;
    let path = out.join(format!("posthoc-p13-{}.json", r.clinicians));
    anyhow::ensure!(path.file_name() != Some(std::ffi::OsStr::new("chain-proof-s1.json")), "{POSTHOC_LABEL}: never written over the S1 report");
    std::fs::write(&path, serde_json::to_string_pretty(r)?)?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;
    /// The pre-registration is pinned: any edit after the run fails here until the hash is updated in the same commit,
    /// which a reviewer sees. First run: copy the printed hash into PINNED_SHA256 (Step 4), then it guards.
    #[test] fn the_preregistration_is_pinned() {
        use sha2::{Digest, Sha256};
        let h: String = Sha256::digest(PREREG.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(h, PINNED_SHA256, "reference/chain-proof-s1.json changed: owner's OK for a pass mark, then update PINNED_SHA256");
    }
    #[test] fn the_preregistration_names_this_rule_and_the_owners_marks() {
        let p: Prereg = serde_json::from_str(PREREG).unwrap();
        // Pre-registered on best-point/3 (Aariz as the yardstick); best-point/4 with Aariz as the base reproduces it exactly.
        assert_eq!((p.rule_version.as_str(), p.clinicians, p.films_per_test), ("best-point/3", 200, 60));
        assert!(best::reproduced_with_default_base(&p.rule_version));
        assert!(!best::reproduced_under("best-point/5", &p.rule_version), "a later rule refuses this pre-registration until it is re-proved (final review I3)");
        assert_eq!((p.offer_share_min, p.false_offer_max, p.satisfied_false_offer_max, p.planted_fraction, p.satisfied_within_mm), (0.9, 0.05, 0.05, 0.5, 0.5));
        assert_eq!(p.planted_points, ["Go", "Po", "B"]);
    }
    #[test] fn the_random_stream_is_the_same_every_time_and_differs_by_seed() {
        let take = |seed: u64| { let mut r = Rng::new(seed); (0..5).map(|_| r.next()).collect::<Vec<_>>() };
        assert_eq!(take(42), take(42));
        assert_ne!(take(42), take(43));
        let mut r = Rng::new(7);
        let mut v: Vec<usize> = (0..10).collect();
        shuffle(&mut v, &mut r);
        let mut sorted = v.clone(); sorted.sort();
        assert_eq!(sorted, (0..10).collect::<Vec<_>>(), "a shuffle keeps every film once");
    }
    /// Synthetic marks for one point: the answer at (500, 500), Aariz off by a bias of (3, −2) px and a wobble of about
    /// 15 px a side (Box–Muller from the seeded stream), 0.1 mm per px. SYNTHETIC: no Ceph-400 film is read.
    fn synthetic(n: usize) -> Vec<Mark> {
        let mut r = Rng::new(99);
        let mut g = || { let (u1, u2) = ((r.next() >> 11) as f64 / (1u64 << 53) as f64 + 1e-12, (r.next() >> 11) as f64 / (1u64 << 53) as f64);
            (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos() };
        (0..n).map(|i| Mark { film: format!("SYNTHETIC-{i:03}"), aariz: (503.0 + 15.0 * g(), 498.0 + 15.0 * g()), truth: (500.0, 500.0), mm_per_px: 0.1 }).collect()
    }
    #[test] fn the_scatter_has_its_average_removed() {
        let sc = scatter(&synthetic(300));
        let (mx, my) = (sc.iter().map(|v| v.0).sum::<f64>() / 300.0, sc.iter().map(|v| v.1).sum::<f64>() / 300.0);
        assert!(mx.abs() < 1e-9 && my.abs() < 1e-9, "{mx} {my}");
    }
    /// The instrument's controls, on synthetic marks: the control (Aariz moved 3 mm, the challenger on the clinician's
    /// own point) is offered every time; a planted challenger nearly always; an equal one rarely.
    #[test] fn on_synthetic_marks_the_control_always_the_planted_mostly_the_equal_rarely() {
        let marks = synthetic(300);
        let p = Prereg { clinicians: 50, ..serde_json::from_str::<Prereg>(PREREG).unwrap() };
        let shares = [offer_share("Go", &marks, Clinician::Offset(p.control_offset_mm), Challenger::Fraction(0.0), &p, 4),
            offer_share("Go", &marks, Clinician::SelfBased, Challenger::Fraction(0.5), &p, 1),
            offer_share("Go", &marks, Clinician::SelfBased, Challenger::Equal, &p, 2),
            offer_share("Go", &marks, Clinician::Satisfied, Challenger::Equal, &p, 3)];
        eprintln!("synthetic shares (control, planted, equal, equal satisfied): {shares:?}");
        assert_eq!(shares[0], 1.0);
        assert!(shares[1] >= 0.9);
        assert!(shares[2] <= 0.1);
        assert!(shares[3] <= 0.1);
    }
    #[test] fn a_satisfied_clinician_accepts_pins_within_half_a_millimetre_unmoved() {
        let marks = synthetic(300);
        let rows = records("Go", &marks, &scatter(&marks), Clinician::Satisfied, Challenger::Equal, 300, 0.5, &mut Rng::new(1));
        let aariz: Vec<&RecordRow> = rows.iter().filter(|r| r.model_id == best::DEFAULT_BASE).collect();
        assert_eq!(aariz.len(), 300);
        assert!(aariz.iter().all(|r| (r.how == "accepted-unmoved") == (r.dist_px == 0.0)));
        assert!(aariz.iter().filter(|r| r.how == "moved").all(|r| r.dist_px * 0.1 > 0.5));
        assert!(aariz.iter().any(|r| r.how == "accepted-unmoved"), "some of 300 pins fall within 0.5 mm (about 5 % do)");
    }
    #[test] fn held_back_caches_are_refused_and_allowed_ones_pass() {
        let d = std::path::Path::new("data/ceph400");
        assert!(refuse_held_back_cache(d, "test2").is_err() && refuse_held_back_cache(d, "all").is_err() && refuse_held_back_cache(d, "Test2").is_err());
        assert!(refuse_held_back_cache(d, "train").is_ok() && refuse_held_back_cache(d, "test1").is_ok());
    }
    /// Confirmed 27 Oct against THIRD_PARTY_MODELS.md and catalog.json `leakage` (Task 14 report): cwlachap was trained on
    /// a random 70/15/15 split of ALL of ISBI 2015 (catalogue: Ceph-400 "leaked"), so its Test1 cell is home ground too,
    /// not clean as the plan's draft had it; GU2Net on ISBI films 001–150 only (Test1 clean).
    #[test] fn the_leakage_marks_are_pinned() {
        assert_eq!([leakage("aariz-cepha29", "train"), leakage("srpose-cldet23", "test1"), leakage("gu2net-isbi19", "train"),
            leakage("gu2net-isbi19", "test1"), leakage("cwlachap-hrnet-w32", "test1"), leakage("cwlachap-hrnet-w32", "train"), leakage("someone-else", "train")],
            ["clean", "home-ground", "home-ground", "clean", "home-ground", "home-ground", "unknown"]);
    }

    // ---- Edge cases the brief names (Task 14 "Edge cases"), on SYNTHETIC caches and films only. ----

    /// A synthetic cache folder: a header with this dataset and split, and a detections file that is NOT valid JSON, so
    /// any attempt to read a film fails with a parse error instead of the held-back refusal.
    fn synthetic_cache(dataset: &str, split: &str) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("cache-header.json"), format!(
            r#"{{"dataset":"{dataset}","split":"{split}","gitSha":"SYNTHETIC","models":{{"aariz-cepha29":"SYNTHETIC"}},"providers":{{}},"windows":[],"films":1}}"#)).unwrap();
        std::fs::write(d.path().join("detections.jsonl"), "SYNTHETIC: not a film, reading it is an error\n").unwrap();
        d
    }
    /// The held-back guard reads the cache's header only: a Test2 or `all` cache is refused before any film is read
    /// (the films file here cannot be parsed, so a refusal that read it would say so instead), whether the held-back
    /// name comes from --data or from the dataset the cache was made from. Allowed splits pass on the header alone.
    #[test] fn a_held_back_cache_is_refused_from_its_header_before_any_film_is_read() {
        let data = std::path::Path::new("data/ceph400");
        for split in ["test2", "Test2", "all"] {
            let c = synthetic_cache("ceph400", split);
            let e = cache_header(data, c.path()).unwrap_err().to_string();
            assert!(e.contains("held back"), "{split}: {e}");
            let e = cache_header(std::path::Path::new("data/renamed"), c.path()).unwrap_err().to_string();
            assert!(e.contains("held back"), "{split}, made from ceph400 but --data named otherwise: {e}");
        }
        for split in ["train", "test1"] {
            let c = synthetic_cache("ceph400", split);
            assert_eq!(cache_header(data, c.path()).unwrap().split, split, "control: {split} passes on its header alone");
        }
        let c = synthetic_cache("ceph400", "train");
        assert!(ceph_bench_read(c.path()).is_err(), "control: the films file really cannot be read");
    }
    fn ceph_bench_read(dir: &std::path::Path) -> anyhow::Result<()> { crate::xcache::read_cache(dir).map(|_| ()) }

    /// Synthetic films carrying Aariz on `points` (and a second model that errors on the first film), with answers.
    fn synthetic_films(n: usize, points: &[&str]) -> (Vec<FilmRun>, crate::dataset::Points) {
        use crate::xcache::CachedPoint;
        let mut r = Rng::new(5);
        let mut g = || ((r.next() >> 11) as f64 / (1u64 << 53) as f64 - 0.5) * 50.0;
        let (mut films, mut gt) = (vec![], crate::dataset::Points::new());
        for i in 0..n {
            let film = format!("SYNTHETIC-{i:03}");
            let pts: BTreeMap<String, CachedPoint> = points.iter().map(|p| (p.to_string(), CachedPoint { x: 500.0 + g(), y: 500.0 + g(), cov: BTreeMap::new() })).collect();
            let other: Result<BTreeMap<String, CachedPoint>, String> = if i == 0 { Err("SYNTHETIC failure".into()) } else { Ok(pts.clone()) };
            films.push(FilmRun { film: film.clone(), mm_per_px: 0.1, models: [(best::DEFAULT_BASE.to_string(), Ok(pts)), ("srpose-cldet23".to_string(), other)].into_iter().collect() });
            gt.insert(film, points.iter().map(|p| (p.to_string(), 500.0, 500.0)).collect());
        }
        (films, gt)
    }
    fn small_prereg() -> Prereg { Prereg { clinicians: 20, floor_fractions: vec![0.0, 1.0], ..serde_json::from_str::<Prereg>(PREREG).unwrap() } }
    #[test] fn a_preregistration_naming_another_rule_is_refused() {
        let (films, gt) = synthetic_films(80, &["Go", "Po", "B"]);
        let p = Prereg { rule_version: "best-point/2".into(), ..small_prereg() };
        let e = run_s1(&films, &[("train".into(), films.iter().map(|f| f.film.clone()).collect())], &gt, &p).unwrap_err().to_string();
        assert!(e.contains("best-point/2") && e.contains(best::RULE_VERSION), "{e}");
        let later = Prereg { rule_version: "best-point/5".into(), ..small_prereg() };
        assert!(run_s1(&films, &[("train".into(), films.iter().map(|f| f.film.clone()).collect())], &gt, &later).is_err(), "a later rule is refused too");
    }
    #[test] fn a_point_with_too_few_films_is_refused_by_name_and_no_films_is_an_error() {
        let (films, gt) = synthetic_films(59, &["Go", "Po", "B"]);
        let e = run_s1(&films, &[("train".into(), films.iter().map(|f| f.film.clone()).collect())], &gt, &small_prereg()).unwrap_err().to_string();
        assert!(e.contains("Go") && e.contains("59") && e.contains("60"), "{e}");
        let e = run_s1(&[], &[], &gt, &small_prereg()).unwrap_err().to_string();
        assert!(e.contains("Go") && e.contains("only 0"), "nothing analysed is an error, never a pass: {e}");
        let (films, gt) = synthetic_films(80, &["Go", "B"]);
        let e = run_s1(&films, &[("train".into(), films.iter().map(|f| f.film.clone()).collect())], &gt, &small_prereg()).unwrap_err().to_string();
        assert!(e.contains("Po") && e.contains("only 0"), "a planted point Aariz never marked is named: {e}");
    }
    #[test] fn a_film_given_twice_is_refused() {
        let (mut films, gt) = synthetic_films(80, &["Go", "Po", "B"]);
        films.push(films[3].clone());
        let e = run_s1(&films, &[("train".into(), vec![])], &gt, &small_prereg()).unwrap_err().to_string();
        assert!(e.contains("SYNTHETIC-003") && e.contains("twice"), "{e}");
    }
    /// The whole S1 on 80 synthetic films and 20 clinicians: the control holds, the report counts every film, and a
    /// model that errored on a film is left out of that cell and counted.
    #[test] fn a_synthetic_run_reports_every_test_the_control_and_the_errored_film() {
        let (films, gt) = synthetic_films(80, &["Go", "Po", "B"]);
        let ids: Vec<String> = films.iter().map(|f| f.film.clone()).collect();
        let r = run_s1(&films, &[("train".into(), ids[..40].to_vec()), ("test1".into(), ids[40..].to_vec())], &gt, &small_prereg()).unwrap();
        eprintln!("{}", r.summary());
        assert!(r.control_ok, "{}", r.summary());
        assert_eq!((r.films, r.tests.len(), r.films_per_point["Go"]), (80, 12, 80));
        assert_eq!(r.tests.iter().filter(|t| t.name.starts_with("control")).count(), 3);
        assert_eq!(r.floor.len(), 4, "two floor points × two fractions");
        let sr = r.table.iter().find(|c| c.model == "srpose-cldet23" && c.split == "train" && c.point == "Go").unwrap();
        assert_eq!((sr.films, sr.failed, sr.leakage), (39, 1, "home-ground"));
        let az = r.table.iter().find(|c| c.model == best::DEFAULT_BASE && c.split == "test1" && c.point == "B").unwrap();
        assert_eq!((az.films, az.failed, az.leakage), (40, 0, "clean"));
        assert!(r.summary().contains("control held"), "{}", r.summary());
    }
    // ---- POST-HOC P1.3 (owner 27 Oct, not pre-registered): `--posthoc-clinicians N`. ----

    /// Wilson's 95 % interval, against a hand computation: 14 of 200 (p = 0.07, z = 1.95996, z² = 3.841459;
    /// centre (0.07 + 0.0096036) / 1.0192073 = 0.0781036; half 1.95996 × √(0.07 × 0.93 / 200 + 3.841459 / 160000) /
    /// 1.0192073 = 0.0359515) is 0.042152 to 0.114055; 0 of 10 is 0 to z² / (10 + z²) = 0.277533.
    #[test] fn the_wilson_interval_matches_a_hand_computed_case() {
        let (lo, hi) = wilson(14, 200);
        assert!((lo - 0.042152).abs() < 1e-6 && (hi - 0.114055).abs() < 1e-6, "14/200: {lo} {hi}");
        let (lo, hi) = wilson(0, 10);
        assert!(lo.abs() < 1e-12 && (hi - 0.277533).abs() < 1e-6, "0/10: {lo} {hi}");
        let (lo, hi) = wilson(10, 10);
        assert!((lo - (1.0 - 0.277533)).abs() < 1e-6 && (hi - 1.0).abs() < 1e-12, "10/10: {lo} {hi}");
    }
    /// The post-hoc run on synthetic films: P1.3 and the control only, N clinicians, every console line and every JSON
    /// record carries the label, and nothing says PASS or FAIL (in any case).
    #[test] fn the_posthoc_run_is_labelled_on_every_line_and_record_and_never_says_pass_or_fail() {
        let (films, gt) = synthetic_films(80, &["Go", "Po", "B"]);
        let p = small_prereg();
        let r = run_posthoc_p13(&films, &gt, &p, 50).unwrap();
        let text = r.summary();
        eprintln!("{text}");
        assert!(text.lines().count() >= 7, "{text}");
        for l in text.lines() { assert!(l.contains(POSTHOC_LABEL), "unlabelled line: {l}"); }
        let json = serde_json::to_value(&r).unwrap();
        assert_eq!(json["label"], POSTHOC_LABEL);
        let recs = json["tests"].as_array().unwrap();
        assert_eq!(recs.len(), 6, "a control and a P1.3 per planted point, nothing else");
        for t in recs {
            assert_eq!(t["label"], POSTHOC_LABEL, "{t}");
            assert!(t["name"].as_str().unwrap().starts_with("control") || t["name"].as_str().unwrap().starts_with("P1.3"), "{t}");
            assert_eq!(t["clinicians"], 50, "{t}");
        }
        let all = format!("{text}\n{}", serde_json::to_string_pretty(&r).unwrap()).to_lowercase();
        assert!(!all.contains("pass") && !all.contains("fail"), "a post-hoc check never passes or fails:\n{all}");
        assert!(r.control_held && r.films == 80, "{text}");
    }
    /// Each share comes with its count and its interval, and the first pre-registered clinicians are the very ones the
    /// S1 run used (the same seed and streams), so the post-hoc share over them reproduces S1's P1.3 share.
    /// SYNTHETIC films whose Aariz marks carry the Gaussian wobble of `synthetic` on every planted point: there the
    /// satisfied clinician IS sometimes falsely offered (a few in 200), so a reproduction check compares real counts.
    fn gaussian_films(n: usize) -> (Vec<FilmRun>, crate::dataset::Points) {
        use crate::xcache::CachedPoint;
        let (mut films, mut gt) = (vec![], crate::dataset::Points::new());
        for m in synthetic(n) {
            let pts: BTreeMap<String, CachedPoint> = ["Go", "Po", "B"].iter().map(|p| (p.to_string(), CachedPoint { x: m.aariz.0, y: m.aariz.1, cov: BTreeMap::new() })).collect();
            films.push(FilmRun { film: m.film.clone(), mm_per_px: m.mm_per_px, models: [(best::DEFAULT_BASE.to_string(), Ok(pts))].into_iter().collect() });
            gt.insert(m.film, ["Go", "Po", "B"].iter().map(|p| (p.to_string(), m.truth.0, m.truth.1)).collect());
        }
        (films, gt)
    }
    #[test] fn the_posthoc_shares_carry_their_counts_and_reproduce_s1_on_its_own_clinicians() {
        let (films, gt) = gaussian_films(300);
        let p = Prereg { clinicians: 200, floor_fractions: vec![0.0], ..serde_json::from_str::<Prereg>(PREREG).unwrap() };
        let r = run_posthoc_p13(&films, &gt, &p, 400).unwrap();
        let s1 = run_s1(&films, &[("train".into(), vec![])], &gt, &p).unwrap();
        let p13: usize = r.tests.iter().filter(|t| t.name.starts_with("P1.3")).map(|t| t.first_preregistered.offered).sum();
        assert!(p13 > 0, "fixture control: S1's own P1.3 counts are not all zero, so the reproduction below can fail");
        for t in &r.tests {
            assert_eq!(t.clinicians, 400);
            assert!((t.share - t.offered as f64 / 400.0).abs() < 1e-12, "{t:?}");
            assert_eq!((t.ci95_low, t.ci95_high), wilson(t.offered, 400));
            assert_eq!((t.first_preregistered.clinicians, t.beyond_preregistered.clinicians), (200, 200));
            assert_eq!(t.first_preregistered.offered + t.beyond_preregistered.offered, t.offered);
            let orig = s1.tests.iter().find(|o| o.point == t.point && o.name.starts_with(&t.name[..4])).unwrap();
            assert!((t.first_preregistered.share - orig.share).abs() < 1e-12, "{t:?} vs S1 {orig:?}");
        }
    }
    #[test] fn the_posthoc_run_refuses_too_few_clinicians_and_too_few_films() {
        let (films, gt) = synthetic_films(80, &["Go", "Po", "B"]);
        assert!(run_posthoc_p13(&films, &gt, &small_prereg(), 0).unwrap_err().to_string().contains("clinicians"));
        let e = run_posthoc_p13(&[], &gt, &small_prereg(), 50).unwrap_err().to_string();
        assert!(e.contains("only 0") && e.contains(POSTHOC_LABEL), "nothing analysed is an error: {e}");
    }
    /// It writes its own file and never touches chain-proof-s1.json.
    #[test] fn the_posthoc_run_writes_its_own_file_and_leaves_chain_proof_s1_untouched() {
        let (films, gt) = synthetic_films(80, &["Go", "Po", "B"]);
        let out = tempfile::tempdir().unwrap();
        let s1 = out.path().join("chain-proof-s1.json");
        std::fs::write(&s1, "SYNTHETIC S1 RESULT, must survive").unwrap();
        let r = run_posthoc_p13(&films, &gt, &small_prereg(), 40).unwrap();
        let path = write_posthoc(out.path(), &r).unwrap();
        assert_eq!(path, out.path().join("posthoc-p13-40.json"));
        assert_eq!(std::fs::read_to_string(&s1).unwrap(), "SYNTHETIC S1 RESULT, must survive");
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
        assert_eq!(v["label"], POSTHOC_LABEL);
        let names: Vec<String> = std::fs::read_dir(out.path()).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into()).collect();
        assert_eq!(names.len(), 2, "{names:?}");
    }

    /// The pass marks are pre-registered: the run refuses a pre-registration that is not committed at HEAD as built.
    #[test] fn the_run_needs_the_preregistration_committed_as_built() {
        assert!(committed_as_built(Some(PREREG.as_bytes().to_vec())).is_ok());
        let e = committed_as_built(None).unwrap_err().to_string();
        assert!(e.contains("not committed"), "{e}");
        let mut other = PREREG.as_bytes().to_vec(); other[10] ^= 1;
        let e = committed_as_built(Some(other)).unwrap_err().to_string();
        assert!(e.contains("differs"), "{e}");
    }
}
