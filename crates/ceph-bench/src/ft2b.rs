//! FT-2b, the re-test of the narrowed point check, "Stage A′: the gross-error net" (spec 2026-10-27 §14.9b, §16.1),
//! pre-registered in `reference/point-check-ft2b.json`. A **weaker re-test** (same 300 films; marks written after
//! FT-2). Flag-only (`point-check/2`): nothing moves, there is no candidate spot and no re-assessment. It reuses FT-2's
//! caches (`--point-check-feasibility cache`), FT-2's folds and FT-2's shape model. Bench only: nothing in the app reads
//! it (tests/no_app_reads_the_feasibility_tests.rs).
use crate::ft2::{anb_deg, idx, Count, Refused, Ring, SpotFilm, REFUSED_MAX_PERCENT};
use crate::ft_common::{case_rng, counted, direction, dist, no_homework, par_map, Pt};
use crate::pointcheck::{check, Lines, Outcome, Scorer, ShapeScorer};
use ceph_model::scores::ORIGINAL_19;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

pub const PREREG: &str = include_str!("../../../reference/point-check-ft2b.json");
pub const PREREG_PATH: &str = "reference/point-check-ft2b.json";

/// The pre-registration's numbers (its prose fields are pinned with the file's SHA-256, not read).
#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ft2bPrereg {
    pub version: String, pub rule: String, pub spec: String, pub label: String, pub seed: u64, pub fold_seed: u64, pub folds: usize,
    pub flag_line: f64, pub rounds: usize, pub min_points: usize,
    pub g1_distances_mm: Vec<f64>, pub g1_decide_mm: f64, pub g1_pooled: Vec<String>,
    pub g1_pooled_flagged_min: f64, pub g1_per_point_flagged_min: f64, pub g1_per_point_except: Vec<String>, pub g1_information_only: Vec<String>,
    pub g2_within_mm: f64, pub g2_flagged_max: f64, pub g3_extreme_films: usize, pub g3_flagged_max: usize,
    pub g4_real_miss_beyond_mm: Vec<f64>, pub g5_rings: Vec<f64>,
    pub control_nasion_mm: f64, pub control_nasion_films: usize, pub control_b_forward_mm: f64, pub control_b_flagged_min: f64,
    pub control_jaw: Vec<String>, pub control_jaw_forward_mm: f64, pub control_jaw_flag_share_max: f64,
    pub soft_tissue: Vec<String>, pub report_separately: Vec<String>,
}
impl Ft2bPrereg {
    /// Flag-only lines: the move line is 0, so no point is ever below it and nothing can move (`check` returns before
    /// any candidate is looked at); `qualify` is never reached.
    pub fn lines(&self) -> Lines { Lines { flag: self.flag_line, mv: 0.0, qualify: 1.0, rounds: self.rounds, min_points: self.min_points } }
}

/// The flag-only check (`point-check/2`, spec §14.5): worst first, at most `rounds` rounds, flags only. No candidate
/// spot is given and the move line is 0; a move or a re-assessment, were one ever to appear, stops the run.
pub fn flag_only(s: &dyn Scorer, pts: &[Pt], l: &Lines) -> anyhow::Result<Outcome> {
    let none = vec![vec![]; pts.len()];
    let o = check(s, &pts.iter().map(|q| Some(*q)).collect::<Vec<_>>(), &none, &Lines { mv: 0.0, ..*l })?;
    anyhow::ensure!(o.moved.is_none() && o.reassessed.is_empty(), "the flag-only check moved or re-assessed a point: {o:?}");
    Ok(o)
}

/// The verdict words (pre-registration `verdicts`).
pub const GO: &str = "go: Stage A′ may be built, flag-only";
pub const NO_GO: &str = "no-go: the gross-error net is not built; it returns to the owner";
pub const BROKEN: &str = "broken: a control did not hold, so the instrument cannot be trusted; nothing is concluded";
pub fn verdict(controls: bool, marks: bool) -> &'static str { if !controls { BROKEN } else if !marks { NO_GO } else { GO } }
/// 0 go, 3 no-go, 1 broken (and 1 for any error before a verdict).
pub fn exit_code(v: &str) -> i32 { if v == GO { 0 } else if v == NO_GO { 3 } else { 1 } }

/// Aariz's own misses beyond one distance: how many, and how many flagged; per point too.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Miss { pub beyond_mm: f64, pub flagged: Count, pub per_point: BTreeMap<String, Count> }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ft2bReport {
    pub prereg: Ft2bPrereg, pub label: String, pub films: usize, pub points: usize, pub fold_sizes: Vec<usize>,
    /// The films of each fold, by name: FT-2's folds (cut with `foldSeed`, FT-2's seed).
    pub folds: Vec<Vec<String>>, pub held_back: String,
    pub counts: Vec<String>, pub refused: Vec<Refused>,
    /// Each point's plants, one count per distance (`g1DistancesMm`).
    pub g1: BTreeMap<String, Vec<Count>>,
    pub g1_pooled: Count, pub g1_pooled_without_gonion: Count, pub g1_below_mark: Vec<String>,
    pub g2_flagged: Count, pub g2_gonion: Count,
    pub g3_films: Vec<String>, pub g3_flagged: Count,
    pub g4: Vec<Miss>, pub g5: Vec<Ring>, pub moves: usize,
    pub control_nasion: Count, pub control_nasion_unplanted: Count, pub control_b: Count, pub control_jaw: Count, pub controls_held: bool,
    pub g1_pooled_pass: bool, pub g1_each_pass: bool, pub g2_pass: bool, pub g3_pass: bool, pub verdict: String,
}

/// Judges the counts against the marks and sets the passes and the verdict. A mark that counted nothing is an error.
pub fn decide(r: &mut Ft2bReport, p: &Ft2bPrereg) -> anyhow::Result<()> {
    let d = p.g1_distances_mm.iter().position(|x| *x == p.g1_decide_mm)
        .ok_or_else(|| anyhow::anyhow!("G1 decides at {} mm, which is not one of the plant distances {:?}", p.g1_decide_mm, p.g1_distances_mm))?;
    anyhow::ensure!(!p.g1_pooled.is_empty(), "G1 pools nothing: no point is named; refusing to report");
    let at = |id: &str| r.g1.get(id).map(|v| v[d].clone()).ok_or_else(|| anyhow::anyhow!("G1 has no plants of {id}: nothing analysed"));
    let (mut pooled, mut without) = (Count::default(), Count::default());
    let mut below = vec![];
    for id in &p.g1_pooled {
        let c = at(id)?;
        anyhow::ensure!(c.of > 0, "G1 {id} at {} mm counted nothing: refusing to report", p.g1_decide_mm);
        pooled.of += c.of; pooled.hit += c.hit;
        if !p.g1_information_only.contains(id) { without.of += c.of; without.hit += c.hit; }
        // Gonion (`g1PerPointExcept`) has no mark of its own (Q-A′2): its line is information only.
        if !p.g1_per_point_except.contains(id) && c.share < p.g1_per_point_flagged_min { below.push(id.clone()); }
    }
    for c in [&mut pooled, &mut without] { c.share = if c.of > 0 { c.hit as f64 / c.of as f64 } else { 0.0 }; }
    anyhow::ensure!(r.g2_flagged.of > 0, "G2 counted nothing: no Aariz pin within {} mm of the experts; refusing to report", p.g2_within_mm);
    anyhow::ensure!(r.g3_flagged.of > 0, "G3 counted nothing: no extreme-ANB expert tracing; refusing to report");
    r.g1_pooled_pass = pooled.share >= p.g1_pooled_flagged_min;
    r.g1_each_pass = below.is_empty();
    r.g1_pooled = pooled; r.g1_pooled_without_gonion = without; r.g1_below_mark = below;
    r.g2_pass = r.g2_flagged.share <= p.g2_flagged_max;
    r.g3_pass = r.g3_flagged.hit <= p.g3_flagged_max;
    // The controls, two-sided (FT-2's): nasion 15 mm caught on every control film, the same films unplanted not all
    // flagged; B alone caught; the whole jaw moved together NOT flagged. Any that counted nothing does not hold.
    r.controls_held = r.control_nasion.of == p.control_nasion_films && r.control_nasion.hit == r.control_nasion.of
        && r.control_nasion_unplanted.hit < r.control_nasion_unplanted.of
        && r.control_b.of > 0 && r.control_b.share >= p.control_b_flagged_min
        && r.control_jaw.of > 0 && r.control_jaw.share <= p.control_jaw_flag_share_max;
    r.verdict = verdict(r.controls_held, r.g1_pooled_pass && r.g1_each_pass && r.g2_pass && r.g3_pass).into();
    Ok(())
}

/// One film's results, flag-only, judged by the shape model of its fold.
struct FilmB {
    film: String, mm: f64, aariz: Vec<Pt>, truth: Vec<Pt>, base: Outcome, expert: Outcome,
    g1: Vec<(usize, usize, bool)>, jaw: Outcome, b: bool, g5: Vec<f64>, ctrl: Option<(bool, bool)>,
}

fn film_b(s: &ShapeScorer, f: &SpotFilm, truth: &[Pt], fold: usize, pos: usize, p: &Ft2bPrereg) -> anyhow::Result<FilmB> {
    let (l, mm) = (p.lines(), f.mm_per_px);
    let px = |v: f64| v / mm;
    let base = flag_only(s, &f.aariz, &l)?;
    let expert = flag_only(s, truth, &l)?;
    let mut g1 = vec![];
    for k in 0..19 {
        for (di, d) in p.g1_distances_mm.iter().enumerate() {
            let (ux, uy) = direction(&mut case_rng(p.seed, &[1, fold as u64, pos as u64, k as u64, di as u64]));
            let mut t = f.aariz.clone();
            t[k] = (t[k].0 + ux * px(*d), t[k].1 + uy * px(*d));
            g1.push((k, di, flag_only(s, &t, &l)?.is_flagged(k)));
        }
    }
    let mut jaw = truth.to_vec();
    for n in &p.control_jaw { jaw[idx(n)].0 += px(p.control_jaw_forward_mm); }      // forward = +x: Ceph-400 films face right
    let jaw = flag_only(s, &jaw, &l)?;
    let mut bt = truth.to_vec();
    bt[idx("B")].0 += px(p.control_b_forward_mm);
    let b = flag_only(s, &bt, &l)?.is_flagged(idx("B"));
    let mut g5 = vec![];
    for k in 0..19 {
        let used: Vec<usize> = (0..19).filter(|&j| j != k).collect();
        g5.push(s.tail(k, &used, truth, truth[k])?);
    }
    let ctrl = if fold == 0 && pos < p.control_nasion_films {
        let n = idx("N");
        let (ux, uy) = direction(&mut case_rng(p.seed, &[2, pos as u64]));
        let mut t = f.aariz.clone();
        t[n] = (t[n].0 + ux * px(p.control_nasion_mm), t[n].1 + uy * px(p.control_nasion_mm));
        Some((flag_only(s, &t, &l)?.is_flagged(n), base.is_flagged(n)))
    } else { None };
    Ok(FilmB { film: f.film.clone(), mm, aariz: f.aariz.clone(), truth: truth.to_vec(), base, expert, g1, jaw, b, g5, ctrl })
}

/// FT-2b on these films: FT-2's folds (5 by film, cut with `foldSeed`, FT-2's seed), each fold's shape model fitted on the
/// other folds' expert tracings only, every film judged once, flag-only.
pub fn run_ft2b(films: &[SpotFilm], truth: &BTreeMap<String, Vec<Pt>>, p: &Ft2bPrereg) -> anyhow::Result<Ft2bReport> {
    anyhow::ensure!(p.version == "point-check-ft2b/1", "this program knows point-check-ft2b/1, not {}", p.version);
    anyhow::ensure!(!p.g1_pooled.is_empty(), "G1 pools nothing: no point is named; refusing to report");
    for id in p.g1_pooled.iter().chain(&p.g1_per_point_except).chain(&p.g1_information_only).chain(&p.report_separately).chain(&p.control_jaw) {
        anyhow::ensure!(ORIGINAL_19.contains(&id.as_str()), "the pre-registration names {id:?}, which is not one of the 19");
    }
    let mut seen = BTreeSet::new();
    for f in films { anyhow::ensure!(seen.insert(f.film.as_str()), "film {} is given twice", f.film); }
    anyhow::ensure!(films.len() >= 2 * p.folds && films.len() / p.folds > p.control_nasion_films, "only {} films: too few for {} folds and the {}-film control", films.len(), p.folds, p.control_nasion_films);
    for f in films {
        let t = truth.get(&f.film).ok_or_else(|| anyhow::anyhow!("{}: no expert tracing", f.film))?;
        anyhow::ensure!(t.len() == 19 && f.aariz.len() == 19, "{}: not 19 points", f.film);
    }
    let folds = crate::ft2::fold_split(films, p.folds, p.fold_seed);     // FT-2's folds (spec §14.9b)
    let fold_ids: Vec<usize> = (0..p.folds).collect();
    let per_fold: Vec<anyhow::Result<Vec<FilmB>>> = par_map(&fold_ids, |&f| {
        let test = &folds[f];
        let train: Vec<usize> = folds.iter().enumerate().filter(|(g, _)| *g != f).flat_map(|(_, v)| v.clone()).collect();
        let names = |v: &[usize]| v.iter().map(|&i| films[i].film.clone()).collect::<Vec<_>>();
        no_homework(&names(&train), &names(test))?;
        let s = ShapeScorer::new(train.iter().map(|&i| truth[&films[i].film].clone()).collect());
        test.iter().enumerate().map(|(pos, &i)| film_b(&s, &films[i], &truth[&films[i].film], f, pos, p)).collect()
    });
    let mut all = vec![];
    for r in per_fold { all.extend(r?); }
    let n = films.len();
    let go = idx("Go");
    let mut r = Ft2bReport { prereg: p.clone(), label: p.label.clone(), films: n, points: n * 19, fold_sizes: folds.iter().map(Vec::len).collect(),
        folds: folds.iter().map(|v| v.iter().map(|&i| films[i].film.clone()).collect()).collect(),
        held_back: "Test2 (100 films) held back, owner 27 Oct".into(), counts: vec![], refused: vec![],
        g1: BTreeMap::new(), g1_pooled: Count::default(), g1_pooled_without_gonion: Count::default(), g1_below_mark: vec![],
        g2_flagged: Count::default(), g2_gonion: Count::default(), g3_films: vec![], g3_flagged: Count::default(),
        g4: p.g4_real_miss_beyond_mm.iter().map(|b| Miss { beyond_mm: *b, ..Default::default() }).collect(),
        g5: p.g5_rings.iter().map(|c| Ring { chance: *c, ..Default::default() }).collect(), moves: 0,
        control_nasion: Count::default(), control_nasion_unplanted: Count::default(), control_b: Count::default(), control_jaw: Count::default(),
        controls_held: false, g1_pooled_pass: false, g1_each_pass: false, g2_pass: false, g3_pass: false, verdict: String::new() };
    let mut scored = 0;
    for fr in &all {
        for k in 0..19 {
            let e = dist(fr.aariz[k], fr.truth[k]) * fr.mm;
            scored += 1;
            if e <= p.g2_within_mm {
                r.g2_flagged.add(fr.base.is_flagged(k));
                if k == go { r.g2_gonion.add(fr.base.is_flagged(k)); }
            }
            for m in r.g4.iter_mut().filter(|m| e > m.beyond_mm) {
                m.flagged.add(fr.base.is_flagged(k));
                m.per_point.entry(ORIGINAL_19[k].to_string()).or_default().add(fr.base.is_flagged(k));
            }
        }
        for (k, di, flagged) in &fr.g1 {
            r.g1.entry(ORIGINAL_19[*k].to_string()).or_insert_with(|| vec![Count::default(); p.g1_distances_mm.len()])[*di].add(*flagged);
        }
        for k in 0..19 { r.control_jaw.add(fr.jaw.is_flagged(k)); }
        r.control_b.add(fr.b);
        for (i, ring) in p.g5_rings.iter().enumerate() { r.g5[i].beyond += fr.g5.iter().filter(|t| **t < *ring).count(); r.g5[i].of += 19; }
        if let Some((planted, unplanted)) = fr.ctrl { r.control_nasion.add(planted); r.control_nasion_unplanted.add(unplanted); }
        r.moves += [&fr.base, &fr.expert, &fr.jaw].iter().filter(|o| o.moved.is_some()).count();
    }
    for ring in r.g5.iter_mut() { ring.promise = ring.chance * ring.of as f64; }
    let mut by_anb: Vec<(f64, &FilmB)> = all.iter().map(|fr| (anb_deg(&fr.truth), fr)).collect();
    by_anb.sort_by(|a, c| a.0.total_cmp(&c.0).then(a.1.film.cmp(&c.1.film)));
    let e = p.g3_extreme_films;
    for (_, fr) in by_anb.iter().take(e).chain(by_anb.iter().rev().take(e)) {
        r.g3_films.push(fr.film.clone());
        for k in 0..19 { r.g3_flagged.add(fr.expert.is_flagged(k)); }
    }
    let mut counts = vec![counted("films judged once each", all.len(), n)?];
    counts.push(counted("G1 plants", r.g1.values().flatten().map(|c| c.of).sum(), n * 19 * p.g1_distances_mm.len())?);
    counts.push(counted("points scored on Aariz's output (G2 and G4)", scored, n * 19)?);
    counts.push(counted("G3 extreme-ANB expert points", r.g3_flagged.of, 2 * e * 19)?);
    counts.push(counted("G5 expert points", r.g5.first().map(|x| x.of).unwrap_or(0), n * 19)?);
    counts.push(counted("jaw control points", r.control_jaw.of, n * 19)?);
    counts.push(counted("B-alone control films", r.control_b.of, n)?);
    counts.push(counted("nasion control films", r.control_nasion.of, p.control_nasion_films)?);
    r.counts = counts;
    decide(&mut r, p)?;
    Ok(r)
}

impl Ft2bReport {
    pub fn exit_code(&self) -> i32 { exit_code(&self.verdict) }
    pub fn summary(&self) -> String {
        let pf = |b: bool| if b { "PASS" } else { "FAIL" };
        let c = |x: &Count| if x.of == 0 { "0/0 (nothing counted)".to_string() } else { format!("{}/{} = {:.4}", x.hit, x.of, x.share) };
        let p = &self.prereg;
        let d = p.g1_distances_mm.iter().position(|x| *x == p.g1_decide_mm).unwrap_or(0);
        let mut s = format!("FT-2b: {} ({}); on {} Ceph-400 films ({}); rule {}; seed {}; folds {:?}; flag-only, moves {}\n",
            self.label, p.version, self.films, self.held_back, p.rule, p.seed, self.fold_sizes, self.moves);
        for k in &self.counts { s += &format!("FT-2b count: {k}\n"); }
        s += &format!("FT-2b refused films (not in the sample): {}{}\n", self.refused.len(),
            if self.refused.is_empty() { String::new() } else { format!(": {} (safety stop above {}%)", self.refused.iter().map(|r| r.film.as_str()).collect::<Vec<_>>().join(", "), REFUSED_MAX_PERCENT) });
        for x in &self.refused { s += &format!("FT-2b refused: {}\n", x.why); }
        s += &format!("FT-2b G1 at {} mm, pooled over {} points: {} (mark >= {}) {}; without Gonion (information): {}\n",
            p.g1_decide_mm, p.g1_pooled.len(), c(&self.g1_pooled), p.g1_pooled_flagged_min, pf(self.g1_pooled_pass), c(&self.g1_pooled_without_gonion));
        s += &format!("FT-2b G1 each point but {} at {} mm (mark >= {}): {}{}\n", p.g1_per_point_except.join(", "), p.g1_decide_mm, p.g1_per_point_flagged_min,
            pf(self.g1_each_pass), if self.g1_below_mark.is_empty() { String::new() } else { format!(": below the mark {}", self.g1_below_mark.join(", ")) });
        let line = |v: &[Count]| v.iter().zip(&p.g1_distances_mm).map(|(x, mm)| format!("{mm} mm {}/{}", x.hit, x.of)).collect::<Vec<_>>().join(", ");
        for id in &p.g1_pooled {
            if p.g1_per_point_except.contains(id) { continue; }
            if let Some(v) = self.g1.get(id) { s += &format!("FT-2b G1 {id}: {} [{} mm: {}]\n", line(v), p.g1_decide_mm, if v[d].share >= p.g1_per_point_flagged_min { "PASS" } else { "FAIL" }); }
        }
        for (id, v) in self.g1.iter().filter(|(id, _)| !p.g1_pooled.contains(id)) { s += &format!("FT-2b G1 {id} (not in the pool; information): {}\n", line(v)); }
        s += &format!("FT-2b G2 Aariz's pins within {} mm of the experts: flagged {} (mark <= {}) {}\n", p.g2_within_mm, c(&self.g2_flagged), p.g2_flagged_max, pf(self.g2_pass));
        s += &format!("FT-2b G3 {} extreme-ANB expert tracings: flagged {} points (mark <= {}) {}\n", self.g3_films.len(), c(&self.g3_flagged), p.g3_flagged_max, pf(self.g3_pass));
        for m in &self.g4 {
            s += &format!("FT-2b G4 Aariz's own misses beyond {} mm (reported, no mark): {} misses, flagged {}{}\n", m.beyond_mm, m.flagged.of, c(&m.flagged),
                if m.per_point.is_empty() { String::new() } else { format!("; {}", m.per_point.iter().map(|(k, x)| format!("{k} {}/{}", x.hit, x.of)).collect::<Vec<_>>().join(", ")) });
        }
        for ring in &self.g5 { s += &format!("FT-2b G5 ring 1 in {:.0}: {} of {} expert points beyond (promise {:.2}; reported, no chance shown on screen)\n", 1.0 / ring.chance, ring.beyond, ring.of, ring.promise); }
        for id in &p.report_separately {
            let name = if id == "Go" { "Gonion" } else { id.as_str() };
            let g1 = self.g1.get(id).map(|v| line(v)).unwrap_or_default();
            let g4 = self.g4.iter().map(|m| format!("beyond {} mm {}", m.beyond_mm, m.per_point.get(id).map(|x| format!("{}/{}", x.hit, x.of)).unwrap_or_else(|| "0/0".into()))).collect::<Vec<_>>().join(", ");
            let g2 = if id == "Go" { c(&self.g2_gonion) } else { "see G2".into() };
            s += &format!("FT-2b {name} (reported separately; information only, no mark): the net does not cover {name}; the cross-check (S2) is {name}'s guard. G1 {g1}; G2 flagged {g2}; G4 {g4}\n");
        }
        s += &format!("FT-2b controls: nasion {} mm flagged {} (must be all); unplanted {} (must not be all); B alone {} mm forward flagged {} (>= {}); the whole jaw {} mm forward flagged {} (<= {}): {}\n",
            p.control_nasion_mm, c(&self.control_nasion), c(&self.control_nasion_unplanted), p.control_b_forward_mm, c(&self.control_b), p.control_b_flagged_min,
            p.control_jaw_forward_mm, c(&self.control_jaw), p.control_jaw_flag_share_max, if self.controls_held { "held" } else { "BROKEN" });
        s += &format!("FT-2b verdict: {}", self.verdict);
        s
    }
}

/// `--point-check-feasibility run-b`.
pub fn run_cli(data: &Path, caches: &[PathBuf], out: &Path) -> anyhow::Result<i32> {
    anyhow::ensure!(!caches.is_empty(), "--point-check-feasibility run-b needs --cache <train cache>,<test1 cache> (FT-2's caches)");
    let mut splits = vec![];
    for d in caches { splits.push(crate::chainproof::cache_header(data, d)?.split); }     // every header first
    splits.sort();
    anyhow::ensure!(splits == ["test1", "train"], "FT-2b runs on one train cache and one test1 cache, not {splits:?}");
    anyhow::ensure!(!crate::provenance(data, "").git_dirty, "commit first: the pass marks are pre-registered ({PREREG_PATH})");
    crate::ft_common::committed_as_built(PREREG_PATH, PREREG, crate::ft_common::at_head(PREREG_PATH))?;
    let p: Ft2bPrereg = serde_json::from_str(PREREG)?;
    let (mut films, mut refused) = (vec![], vec![]);
    for d in caches { films.extend(crate::ft2::read_spot_cache(data, d)?.1); refused.extend(crate::ft2::read_refused(d)?); }
    for x in &refused { eprintln!("FT-2b refused: {}", x.why); }
    crate::ft2::refused_within_limit(&refused, films.len())?;
    let truth = crate::ft2::truth_of(&films, &crate::dataset::load_points(&data.join("gt.csv"))?)?;
    let mut r = run_ft2b(&films, &truth, &p)?;
    r.refused = refused;
    crate::ft_common::ensure_ignored(out)?;
    std::fs::create_dir_all(out)?;
    let path = out.join("ft2b.json");
    std::fs::write(&path, serde_json::to_string_pretty(&r)?)?;
    println!("{}", r.summary());
    println!("FT-2b written to {} (exit {}: 0 go, 3 no-go, 1 broken)", path.display(), r.exit_code());
    Ok(r.exit_code())
}

#[cfg(test)] const PINNED_SHA256: &str = "7b556631d3abb366265fa6d6bc4de33e19761ba8d0a2e1b8773ec06ef5c15111";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ft2::synthetic;

    fn prereg() -> Ft2bPrereg { serde_json::from_str(PREREG).unwrap() }
    fn decide_at(p: &Ft2bPrereg) -> usize { p.g1_distances_mm.iter().position(|d| *d == p.g1_decide_mm).unwrap() }
    fn count(hit: usize, of: usize) -> Count { Count { of, hit, share: hit as f64 / of as f64 } }

    #[test] fn the_preregistration_is_pinned() {
        assert_eq!(crate::ft_common::sha256_hex(PREREG.as_bytes()), PINNED_SHA256,
            "reference/point-check-ft2b.json changed: the owner's OK for a mark, then update PINNED_SHA256 (before any run)");
    }
    /// The owner's answers Q-A′1..6 (27 Oct), as numbers. Every line is FT-2's where the answer kept FT-2's.
    /// Spec §14.9b: "FT-2's folds and shape model, a new seed". The folds are cut with FT-2's seed (`foldSeed`), so each
    /// film is judged by the same fold's model as in FT-2; only the plant directions take FT-2b's own seed.
    #[test] fn the_folds_are_ft2s_and_only_the_plants_take_the_new_seed() {
        let p = prereg();
        let ft2: crate::ft2::Ft2Prereg = serde_json::from_str(crate::ft2::PREREG).unwrap();
        assert_eq!((p.fold_seed, p.folds), (ft2.seed, ft2.folds), "foldSeed is FT-2's seed");
        let (films, _) = synthetic(300);
        let names = |seed: u64| -> Vec<Vec<String>> { crate::ft2::fold_split(&films, ft2.folds, seed).iter().map(|v| v.iter().map(|&i| films[i].film.clone()).collect()).collect() };
        assert_ne!(names(ft2.seed), names(p.seed), "the two seeds cut different folds, so this test can tell them apart");
        let (r, _) = passing();
        assert_eq!(r.folds, names(ft2.seed), "FT-2b's folds are FT-2's");
    }
    #[test] fn the_preregistration_holds_the_owners_answers() {
        let p = prereg();
        let ft2: crate::ft2::Ft2Prereg = serde_json::from_str(crate::ft2::PREREG).unwrap();
        assert_eq!(p.version, "point-check-ft2b/1");
        assert_eq!(p.label, "weaker re-test (same 300 films; marks written after FT-2)");
        assert_ne!(p.seed, ft2.seed, "a new seed, never FT-2's");
        assert_eq!((p.flag_line, p.rounds, p.min_points, p.folds), (ft2.flag_line, ft2.rounds, ft2.min_points, ft2.folds), "no line is tuned on these films");
        assert_eq!((p.g1_decide_mm, p.g1_pooled_flagged_min, p.g1_per_point_flagged_min), (15.0, 0.9, 0.8), "Q-A′1");
        assert_eq!(p.g1_pooled, ft2.d1_pooled, "Q-A′1: the same 15 points as FT-2's D1");
        assert_eq!(p.g1_distances_mm, [10.0, 15.0, 20.0], "20 mm kept, information only");
        assert_eq!((p.g1_per_point_except.clone(), p.g1_information_only.clone(), p.report_separately.clone()), (vec!["Go".to_string()], vec!["Go".to_string()], vec!["Go".to_string()]), "Q-A′2");
        assert_eq!((p.g2_within_mm, p.g2_flagged_max), (2.0, 0.005), "Q-A′3");
        assert_eq!((p.g3_extreme_films, p.g3_flagged_max), (10, 0), "Q-A′4: 0 of 380");
        assert_eq!((p.control_nasion_mm, p.control_nasion_films, p.control_b_forward_mm, p.control_b_flagged_min, p.control_jaw_forward_mm, p.control_jaw_flag_share_max),
                   (ft2.control_nasion_mm, ft2.control_nasion_films, ft2.d5_b_forward_mm, ft2.d5_b_flagged_min, ft2.d5_jaw_forward_mm, ft2.d5_flag_share_max), "FT-2's controls");
        assert_eq!(p.control_jaw, ft2.d5_jaw);
        let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
        assert!(v.get("status").is_none() && v.get("moveLine").is_none(), "no longer a draft; no move line");
        for q in ["Q-A'1", "Q-A'2", "Q-A'3", "Q-A'4", "Q-A'5", "Q-A'6"] { assert!(v["answers"][q].is_string(), "{q} recorded"); }
        // The owner's binding answers (restart approved 28 Oct), word for word, in the file.
        let verbatim: Vec<&str> = v["ownerAnswersVerbatim"].as_array().expect("ownerAnswersVerbatim").iter().map(|x| x.as_str().unwrap()).collect();
        assert_eq!(verbatim, OWNER_ANSWERS_VERBATIM, "the owner's answers, verbatim");
        // Q-A′5: the hover quotes the measured rate, so nothing may say no chance is shown at all.
        assert!(!PREREG.contains("no chance is shown"), "Q-A′5: the hover gives \"about 1 in 700 on Ceph-400\"");
        assert!(v["answers"]["Q-A'5"].as_str().unwrap().contains("about 1 in 700 on Ceph-400"), "Q-A′5 hover");
        assert!(v["ringCalibration"].as_str().unwrap().contains("shape::tail") && v["ringCalibration"].as_str().unwrap().contains("r = 32"), "the owner's small-sample correction");
    }
    /// The owner's binding answers for FT-2b (Q-A′1..6 and the rules with them), as given; copied into the file verbatim.
    const OWNER_ANSWERS_VERBATIM: [&str; 8] = [
        "Detection: ≥90% at 15 mm pooled, and ≥80% for each point except Gonion. Gonion is for information only.",
        "False flags ≤0.5%.",
        "Extreme ANB: 0 flags out of 380.",
        "Label: \"Check: far outside the usual position\". The hover gives the mm and \"about 1 in 700 on Ceph-400\".",
        "This is a weaker re-test, plus confirmation on the owner's first ~100 films. That confirmation is recorded as a later owner step, not run now.",
        "Test2 stays CLOSED. Never open or score it.",
        "Flag only: it never moves a point.",
        "The ring calibration uses the owner-approved small-sample correction already in shape.rs (`shape::tail`, r=32).",
    ];

    /// A scorer that knows the right place of each point: 0.5 there, `bad[k]` anywhere else.
    struct Fake { good: Vec<Pt>, bad: Vec<f64> }
    impl Scorer for Fake {
        fn tail(&self, k: usize, _used: &[usize], _pts: &[Pt], p: Pt) -> anyhow::Result<f64> { Ok(if dist(p, self.good[k]) < 1e-9 { 0.5 } else { self.bad[k] }) }
    }
    /// Flag-only: a point far below FT-2's move line, with a qualifying spot at its right place, is flagged and NOT
    /// moved. Positive control: FT-2's own check (`point-check/1`, move line 1 in 50,000) moves it on the same input.
    #[test] fn the_flag_only_check_flags_and_never_moves_where_ft2s_check_would() {
        let good: Vec<Pt> = (0..19).map(|i| (100.0 * i as f64, 50.0)).collect();
        let mut pts = good.clone(); pts[3] = (pts[3].0 + 70.0, pts[3].1 + 90.0);
        let mut bad = vec![1e-9; 19]; bad[3] = 1e-7;
        let f = Fake { good: good.clone(), bad };
        let mut spots = vec![vec![]; 19]; spots[3] = vec![crate::pointcheck::Spot { x: good[3].0, y: good[3].1, brightness: 0.9 }];
        let ft2_lines = Lines { flag: 1.0 / 5_000.0, mv: 1.0 / 50_000.0, qualify: 0.05, rounds: 3, min_points: 12 };
        let o1 = check(&f, &pts.iter().map(|p| Some(*p)).collect::<Vec<_>>(), &spots, &ft2_lines).unwrap();
        assert!(o1.is_moved(3), "control: FT-2's check moves this point");
        let o = flag_only(&f, &pts, &prereg().lines()).unwrap();
        assert!(o.is_flagged(3) && o.moved.is_none() && o.reassessed.is_empty(), "{o:?}");
    }

    /// The clean synthetic(300) run, made once and cloned (each run takes seconds in a debug build).
    fn passing() -> (Ft2bReport, Ft2bPrereg) {
        static R: std::sync::OnceLock<Ft2bReport> = std::sync::OnceLock::new();
        let r = R.get_or_init(|| { let (films, truth) = synthetic(300); run_ft2b(&films, &truth, &prereg()).unwrap() });
        (r.clone(), prereg())
    }

    #[test] fn a_synthetic_run_is_go_counts_everything_and_reports_gonion_as_information_only() {
        let (r, _) = passing();
        let s = r.summary();
        eprintln!("{s}");
        assert_eq!((r.films, r.points, r.fold_sizes.iter().sum::<usize>()), (300, 5700, 300));
        assert_eq!(r.g1.values().flatten().map(|c| c.of).sum::<usize>(), 300 * 19 * 3, "every point planted at 10, 15, 20 mm");
        assert_eq!((r.g1_pooled.of, r.g3_flagged.of, r.g5.iter().map(|x| x.of).collect::<Vec<_>>()), (300 * 15, 380, vec![5700; 3]));
        assert_eq!(r.moves, 0, "flag-only");
        assert!(r.controls_held && r.g1_pooled_pass && r.g1_each_pass && r.g2_pass && r.g3_pass, "{s}");
        assert_eq!((r.verdict.as_str(), r.exit_code()), (GO, 0));
        assert!(s.lines().next().unwrap().contains("weaker re-test (same 300 films; marks written after FT-2)"), "{s}");
        let go = s.lines().find(|l| l.starts_with("FT-2b Gonion")).expect("Gonion has its own line");
        assert!(go.contains("information only") && go.contains("does not cover Gonion") && go.contains("20 mm"), "{go}");
        assert!(s.lines().any(|l| l == "FT-2b refused films (not in the sample): 0"), "{s}");
        assert!(s.lines().any(|l| l.starts_with("FT-2b G4 Aariz's own misses beyond 10 mm")), "{s}");
    }

    /// Q-A′1: a point other than Gonion below 80% at 15 mm fails the verdict even with the pool above 90%; exactly 80%
    /// passes. Control: the same 239 given to Gonion leaves it go (next test).
    #[test] fn a_point_other_than_gonion_below_80_percent_is_no_go() {
        let (mut r, p) = passing();
        let d = decide_at(&p);
        for c in r.g1.values_mut() { c[d] = count(300, 300); }
        r.g1.get_mut("Po").unwrap()[d] = count(239, 300);
        decide(&mut r, &p).unwrap();
        eprintln!("Po 239/300: pooled {:?}, below {:?}, {}", r.g1_pooled, r.g1_below_mark, r.verdict);
        assert!(r.g1_pooled_pass && !r.g1_each_pass && r.g1_below_mark == ["Po"], "{:?}", r.g1_below_mark);
        assert_eq!((r.verdict.as_str(), r.exit_code()), (NO_GO, 3));
        r.g1.get_mut("Po").unwrap()[d] = count(240, 300);
        decide(&mut r, &p).unwrap();
        assert_eq!((r.verdict.as_str(), r.g1_each_pass), (GO, true), "exactly 80% passes");
    }
    /// Q-A′2: Gonion's own line carries no mark. Gonion at 0 of 300 or 300 of 300 at every distance leaves the verdict
    /// go. Positive control: the same 0 of 300 given to nasion makes it no-go, so the mutation reaches the judge.
    #[test] fn gonion_never_changes_the_verdict() {
        let (mut r, p) = passing();
        let d = decide_at(&p);
        for c in r.g1.values_mut() { c[d] = count(300, 300); }
        for hit in [0, 150, 300] {
            for c in r.g1.get_mut("Go").unwrap().iter_mut() { *c = count(hit, 300); }
            decide(&mut r, &p).unwrap();
            eprintln!("Gonion {hit}/300: pooled {:?}, {}", r.g1_pooled, r.verdict);
            assert_eq!((r.verdict.as_str(), r.g1_each_pass), (GO, true), "Gonion {hit}/300");
        }
        r.g1.get_mut("N").unwrap()[d] = count(0, 300);
        decide(&mut r, &p).unwrap();
        assert_eq!(r.verdict, NO_GO, "control: the same count on nasion fails");
    }
    /// The pool decides on its own: every point at exactly 80% passes each line but not the pooled 90%. And the pool at
    /// exactly 90% passes.
    #[test] fn the_pooled_mark_decides_on_its_own() {
        let (mut r, p) = passing();
        let d = decide_at(&p);
        for c in r.g1.values_mut() { c[d] = count(240, 300); }
        decide(&mut r, &p).unwrap();
        assert!(!r.g1_pooled_pass && r.g1_each_pass && r.verdict == NO_GO, "{:?}", r.g1_pooled);
        for c in r.g1.values_mut() { c[d] = count(270, 300); }
        decide(&mut r, &p).unwrap();
        assert!(r.g1_pooled_pass && r.g1_pooled.hit == 4050 && r.verdict == GO, "{:?}", r.g1_pooled);
    }
    /// Q-A′3: at most 0.5% (15 of 3,000 passes; 16 fails).
    #[test] fn false_flags_above_half_a_percent_are_no_go() {
        let (mut r, p) = passing();
        r.g2_flagged = count(15, 3000);
        decide(&mut r, &p).unwrap();
        assert_eq!(r.verdict, GO);
        r.g2_flagged = count(16, 3000);
        decide(&mut r, &p).unwrap();
        assert_eq!((r.verdict.as_str(), r.g2_pass), (NO_GO, false));
    }
    /// Q-A′4: one flag on the extreme-ANB experts is no-go. Real path: Me moved 40 mm on the expert tracing of the
    /// lowest-ANB film (Me is not in ANB, so the film stays among the extremes) is flagged and fails G3.
    #[test] fn one_flag_on_an_extreme_anb_expert_tracing_is_no_go() {
        let (mut r, p) = passing();
        r.g3_flagged = count(1, 380);
        decide(&mut r, &p).unwrap();
        assert_eq!((r.verdict.as_str(), r.g3_pass), (NO_GO, false));
        let (films, mut truth) = synthetic(300);
        let lowest = truth.iter().min_by(|a, b| anb_deg(a.1).total_cmp(&anb_deg(b.1)).then(a.0.cmp(b.0))).unwrap().0.clone();
        truth.get_mut(&lowest).unwrap()[idx("Me")].1 += 400.0;
        let r = run_ft2b(&films, &truth, &p).unwrap();
        eprintln!("{lowest}: G3 {:?}, {}", r.g3_flagged, r.verdict);
        assert!(r.g3_films.contains(&lowest) && r.g3_flagged.hit >= 1 && r.verdict == NO_GO, "{}", r.summary());
    }
    /// The controls, two-sided, each made to fail on purpose: nasion planted 0 mm (not caught), B alone 0 mm (not
    /// caught), and the "jaw" reduced to B alone 10 mm forward (B left behind by the rest of the jaw, which IS caught,
    /// so the not-flagged side must fail). Each is broken, exit 1. (Measured first: the whole jaw even 40 mm forward is
    /// NOT flagged on the synthetic faces, 0 of 5,700, since the jaw moving as one block still fits the face; so it
    /// cannot serve as the case that must move.)
    #[test] fn each_control_can_fail_and_then_the_instrument_is_broken() {
        let (films, truth) = synthetic(300);
        for (name, p) in [("nasion 0 mm", Ft2bPrereg { control_nasion_mm: 0.0, ..prereg() }),
                          ("B alone 0 mm", Ft2bPrereg { control_b_forward_mm: 0.0, ..prereg() }),
                          ("jaw = B alone 10 mm", Ft2bPrereg { control_jaw: vec!["B".into()], control_jaw_forward_mm: 10.0, ..prereg() })] {
            let r = run_ft2b(&films, &truth, &p).unwrap();
            eprintln!("{name}: nasion {:?} unplanted {:?} B {:?} jaw {:?} -> {}", r.control_nasion, r.control_nasion_unplanted, r.control_b, r.control_jaw, r.verdict);
            assert!(!r.controls_held && r.verdict == BROKEN && r.exit_code() == 1, "{name}: {}", r.summary());
        }
    }
    /// An analysis of nothing is refused, never a pass: an empty G1 pool; no Aariz pin within 2 mm (all moved 5 mm,
    /// the whole face, so nothing else changes); too few films; a film twice; another version.
    #[test] fn an_analysis_of_nothing_is_refused() {
        let (films, truth) = synthetic(300);
        let e = run_ft2b(&films, &truth, &Ft2bPrereg { g1_pooled: vec![], ..prereg() }).unwrap_err().to_string();
        assert!(e.contains("G1") && e.contains("nothing"), "{e}");
        let mut shifted = films.clone();
        for f in shifted.iter_mut() { for a in f.aariz.iter_mut() { a.0 += 50.0; } }
        let e = run_ft2b(&shifted, &truth, &prereg()).unwrap_err().to_string();
        assert!(e.contains("G2") && e.contains("nothing"), "{e}");
        let (few, t) = synthetic(9);
        assert!(run_ft2b(&few, &t, &prereg()).unwrap_err().to_string().contains("too few"));
        let mut twice = films.clone(); twice.push(films[3].clone());
        assert!(run_ft2b(&twice, &truth, &prereg()).unwrap_err().to_string().contains("twice"));
        let e = run_ft2b(&films, &truth, &Ft2bPrereg { version: "point-check-ft2/1".into(), ..prereg() }).unwrap_err().to_string();
        assert!(e.contains("point-check-ft2b/1"), "{e}");
    }
    #[test] fn each_verdict_has_its_exit_code() {
        assert_eq!((verdict(true, true), exit_code(verdict(true, true))), (GO, 0));
        assert_eq!((verdict(true, false), exit_code(verdict(true, false))), (NO_GO, 3));
        assert_eq!((verdict(false, true), exit_code(verdict(false, true))), (BROKEN, 1));
        assert_eq!(verdict(false, false), BROKEN);
    }
    /// Test2 stays closed (owner, binding): a Test2 cache given to run-b is refused from its header, before its spots
    /// are read (the spots file here is not even JSON) and before anything else is checked. Control: the same cache
    /// labelled train gets past the header (to the next refusal, a missing test1 cache).
    #[test] fn run_b_refuses_a_test2_cache_from_its_header() {
        let d = Path::new("data/ceph400");
        let (t2, tr) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        crate::ft2::write_spot_cache(t2.path(), &crate::ft2::tests::header("test2", 1), &crate::ft2::tests::films(1)).unwrap();
        crate::ft2::write_spot_cache(tr.path(), &crate::ft2::tests::header("train", 1), &crate::ft2::tests::films(1)).unwrap();
        std::fs::write(t2.path().join("spots.jsonl"), "SYNTHETIC: not JSON\n").unwrap();
        let e = run_cli(d, &[tr.path().to_path_buf(), t2.path().to_path_buf()], Path::new("reports/x")).unwrap_err().to_string();
        assert!(e.contains("held back"), "{e}");
        let e = run_cli(d, &[tr.path().to_path_buf()], Path::new("reports/x")).unwrap_err().to_string();
        assert!(!e.contains("held back") && e.contains("test1"), "control: a train cache passes the header check: {e}");
    }
    /// The mode word reaches this run; an unknown word names run-b among the known ones.
    #[test] fn run_b_is_a_mode_of_the_point_check_feasibility() {
        let d = Path::new("data/ceph400");
        let e = crate::ft2::cli(d, "run-b", "train", Path::new("m.json"), &[], Path::new("reports/x")).unwrap_err().to_string();
        assert!(e.contains("run-b needs --cache"), "{e}");
        let e = crate::ft2::cli(d, "nonsense", "train", Path::new("m.json"), &[], Path::new("reports/x")).unwrap_err().to_string();
        assert!(e.contains("run-b"), "{e}");
    }
}
