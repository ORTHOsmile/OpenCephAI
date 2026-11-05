//! FT-2, the point plausibility check's feasibility test (spec 2026-10-27 §14.9), on Ceph-400 Train and Test1 only
//! (Test2 stays closed). Aariz runs once per film on `cpu`; its pins and next heat-map spots are cached; the check is
//! judged in 5 folds against the experts' tracings. Bench only: nothing in the app reads it
//! (tests/no_app_reads_the_feasibility_tests.rs).
use crate::chainproof::{shuffle, Rng};
use crate::ft_common::{case_rng, counted, direction, dist, median, no_homework, par_map, Pt};
use crate::pointcheck::{check, Candidates, Lines, Outcome, ShapeScorer, Scorer, Spot};
use std::collections::BTreeSet;
use crate::xcache::{CacheHeader, CachedPoint, FilmRun};
use ceph_infer::engine::{load_gray, points_from_heatmaps, Engine};
use ceph_infer::spec::{Layout, ModelSpec};
use ceph_infer::transform::Geometry;
use ceph_model::{best::DEFAULT_BASE, scores::ORIGINAL_19};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

/// One film for FT-2: Aariz's 19 pins and each point's candidate spots, in `ORIGINAL_19` order.
#[derive(Clone, Debug, PartialEq)]
pub struct SpotFilm { pub film: String, pub mm_per_px: f64, pub aariz: Vec<Pt>, pub spots: Vec<Vec<Spot>> }

/// The position of a point in `ORIGINAL_19`.
pub fn idx(id: &str) -> usize { ORIGINAL_19.iter().position(|p| *p == id).unwrap_or_else(|| panic!("{id} is not one of the 19")) }

/// Aariz's pins (its own decode) and candidate spots for the 19 points, from one film's heat maps. The heat map's
/// length is checked against the channel it is about to slice BEFORE any indexing (carried from Task 3: a short
/// channel must be refused, never panic on an index).
pub fn film_spots(spec: &ModelSpec, g: &Geometry, hm: &[f32], img_w: u32, mm_per_px: f64, c: &Candidates) -> anyhow::Result<(Vec<Pt>, Vec<Vec<Spot>>)> {
    anyhow::ensure!(spec.input.layout == Layout::Chw, "FT-2 reads Chw heat maps only");
    let cells = (spec.output.width * spec.output.height) as usize;
    // `points_from_heatmaps` below indexes hm for EVERY channel in `landmark_map` (mapped or not), by raw channel
    // index; checked here, before that call, so a short heat map is refused by name, never a slice-index panic
    // (carried from Task 3 report, 40b381f: "spots still trusts ch.len() == rows × cols").
    let need = spec.landmark_map.len() * cells;
    anyhow::ensure!(need <= hm.len(),
        "{}: the heat map has only {} values, short of the {} ({} channels × {} = {} × {} cells) the model's channels need",
        spec.id, hm.len(), need, spec.landmark_map.len(), cells, spec.output.width, spec.output.height);
    let (lms, _) = points_from_heatmaps(spec, g, hm, img_w, false);
    let (mut marks, mut spots) = (vec![], vec![]);
    for id in ORIGINAL_19 {
        let ch = spec.landmark_map.iter().position(|l| l.as_deref() == Some(id))
            .ok_or_else(|| anyhow::anyhow!("{}: the model has no {id} channel (FT-2 needs all 19 points)", spec.id))?;
        let l = lms.iter().find(|l| l.id == id).expect("a mapped channel is a landmark");
        marks.push((l.x, l.y));
        spots.push(crate::pointcheck::spots(&hm[ch * cells..(ch + 1) * cells], spec, g, img_w, false, (l.x, l.y), mm_per_px, c)?);
    }
    Ok((marks, spots))
}

fn hx(v: f64) -> String { format!("{:016x}", v.to_bits()) }
fn unhx(s: &str) -> anyhow::Result<f64> {
    anyhow::ensure!(s.len() == 16, "not a 16-digit bit pattern: {s:?}");
    Ok(f64::from_bits(u64::from_str_radix(s, 16)?))
}
/// One line of `spots.jsonl`: every value as its bit pattern (as the bench's caches store floats).
#[derive(Serialize, Deserialize)]
struct SpotLine { film: String, spots: Vec<Vec<[String; 3]>> }

/// Writes the pins as an ordinary bench cache (`cache-header.json`, `detections.jsonl`) and the spots beside it.
pub fn write_spot_cache(out: &Path, h: &CacheHeader, films: &[SpotFilm]) -> anyhow::Result<()> {
    let runs: Vec<FilmRun> = films.iter().map(|f| FilmRun { film: f.film.clone(), mm_per_px: f.mm_per_px,
        models: [(DEFAULT_BASE.to_string(), Ok(ORIGINAL_19.iter().zip(&f.aariz).map(|(id, p)| (id.to_string(), CachedPoint { x: p.0, y: p.1, cov: BTreeMap::new() })).collect()))].into() }).collect();
    crate::xcache::write_cache(out, h, &runs)?;
    let mut text = String::new();
    for f in films {
        let line = SpotLine { film: f.film.clone(), spots: f.spots.iter().map(|v| v.iter().map(|s| [hx(s.x), hx(s.y), hx(s.brightness as f64)]).collect()).collect() };
        text += &serde_json::to_string(&line)?;
        text.push('\n');
    }
    std::fs::write(out.join("spots.jsonl"), text)?;
    Ok(())
}

/// Reads a spot cache. The header is checked for a held-back split first (by `--data` and by the dataset it names),
/// before any film or spot is read (owner, 27 Oct: Test2 stays closed).
pub fn read_spot_cache(data: &Path, dir: &Path) -> anyhow::Result<(CacheHeader, Vec<SpotFilm>)> {
    let h = crate::chainproof::cache_header(data, dir)?;
    anyhow::ensure!(h.models.contains_key(DEFAULT_BASE), "{}: not an Aariz cache", dir.display());
    let (_, runs) = crate::xcache::read_cache(dir)?;
    let mut spots: BTreeMap<String, Vec<Vec<Spot>>> = BTreeMap::new();
    for line in std::fs::read_to_string(dir.join("spots.jsonl"))?.lines().filter(|l| !l.trim().is_empty()) {
        let s: SpotLine = serde_json::from_str(line)?;
        let v = s.spots.iter().map(|p| p.iter().map(|[x, y, b]| Ok(Spot { x: unhx(x)?, y: unhx(y)?, brightness: unhx(b)? as f32 })).collect::<anyhow::Result<Vec<_>>>()).collect::<anyhow::Result<Vec<_>>>()?;
        spots.insert(s.film, v);
    }
    let mut films = vec![];
    for r in runs {
        let pts = r.models.get(DEFAULT_BASE).and_then(|m| m.as_ref().ok()).ok_or_else(|| anyhow::anyhow!("{}: Aariz gave no pins", r.film))?;
        let aariz = ORIGINAL_19.iter().map(|id| pts.get(*id).map(|p| (p.x, p.y)).ok_or_else(|| anyhow::anyhow!("{}: no {id}", r.film))).collect::<anyhow::Result<Vec<_>>>()?;
        let s = spots.remove(&r.film).ok_or_else(|| anyhow::anyhow!("{}: the spots file has no line for {}", dir.display(), r.film))?;
        anyhow::ensure!(s.len() == 19, "{}: {} points of spots, not 19", r.film, s.len());
        films.push(SpotFilm { film: r.film, mm_per_px: r.mm_per_px, aariz, spots: s });
    }
    anyhow::ensure!(spots.is_empty(), "{}: spots for films the cache does not hold ({:?})", dir.display(), spots.keys().take(3).collect::<Vec<_>>());
    Ok((h, films))
}

/// A film the cache could not make (Task 4 review ruling, 27 Oct): its id and why, the reason starting with the id.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct Refused { pub film: String, pub why: String }

/// The most films that may be refused, as a percentage of all the films asked for (refused + judged). Above it the run
/// stops: the sample would no longer be the pre-registered one. A safety stop, not a pass mark.
pub const REFUSED_MAX_PERCENT: usize = 5;

/// Stops when more than `REFUSED_MAX_PERCENT` of the films were refused, naming the count and the films; no film at
/// all is an error too.
pub fn refused_within_limit(refused: &[Refused], judged: usize) -> anyhow::Result<()> {
    let total = refused.len() + judged;
    anyhow::ensure!(total > 0, "no film was cached or refused: nothing to judge");
    anyhow::ensure!(refused.len() * 100 <= REFUSED_MAX_PERCENT * total,
        "{} of {} films were refused, more than the {}% safety stop (the sample would no longer be the pre-registered one): {}",
        refused.len(), total, REFUSED_MAX_PERCENT, refused.iter().map(|r| r.film.as_str()).collect::<Vec<_>>().join(", "));
    Ok(())
}

/// `one` on every film. A film that fails is refused: counted, named on the console and skipped, never silently; the
/// others go on.
pub fn spot_films(films: &[(String, f64)], mut one: impl FnMut(&str, f64) -> anyhow::Result<(Vec<Pt>, Vec<Vec<Spot>>)>,
                  progress: impl Fn(usize, usize)) -> (Vec<SpotFilm>, Vec<Refused>) {
    let (mut out, mut refused) = (vec![], vec![]);
    for (n, (iid, mm)) in films.iter().enumerate() {
        match one(iid, *mm) {
            Ok((aariz, spots)) => out.push(SpotFilm { film: iid.clone(), mm_per_px: *mm, aariz, spots }),
            Err(e) => {
                let why = format!("{iid}: {e:#}");
                eprintln!("FT-2 cache: refused {why}");
                refused.push(Refused { film: iid.clone(), why });
            }
        }
        progress(n + 1, films.len());
    }
    (out, refused)
}

/// The refused films, beside the cache (`refused.json`; an empty list when none was refused).
pub fn write_refused(out: &Path, refused: &[Refused]) -> anyhow::Result<()> {
    std::fs::write(out.join("refused.json"), serde_json::to_string_pretty(refused)?)?;
    Ok(())
}
/// Reads `refused.json`. A cache without it is refused: its refusals would be unknown.
pub fn read_refused(dir: &Path) -> anyhow::Result<Vec<Refused>> {
    let p = dir.join("refused.json");
    let text = std::fs::read_to_string(&p).map_err(|e| anyhow::anyhow!("{}: {e}; rebuild the cache (the list of refused films is part of it)", p.display()))?;
    Ok(serde_json::from_str(&text)?)
}

/// Aariz once per film of `split` on `cpu` (CEPHTRACE_PROVIDER=cpu), pins and spots, written to `out`. The held-back
/// check comes before the data or the model is touched. A film that fails is refused by name and skipped; the cache
/// holds the others, and `refused.json` beside it lists the refused ones.
pub fn spot_cache(data: &Path, split: &str, manifest: &Path, out: &Path, c: &Candidates, progress: impl Fn(usize, usize)) -> anyhow::Result<(CacheHeader, Vec<Refused>)> {
    crate::ledger::refuse_held_back(data, split)?;
    let ids = crate::dataset::select(&crate::dataset::load_splits(&data.join("splits.json"))?, split)?;
    let gt = crate::dataset::load_points(&data.join("gt.csv"))?;
    let (films, _) = crate::films_to_score(data, &ids, &gt)?;
    let e = Engine::load(manifest)?;
    anyhow::ensure!(e.manifest().id == DEFAULT_BASE, "FT-2 runs Aariz ({DEFAULT_BASE}), not {}", e.manifest().id);
    anyhow::ensure!(e.provider() == "cpu", "FT-2 runs Aariz on cpu (set CEPHTRACE_PROVIDER=cpu), not {}", e.provider());
    let spec = e.manifest().clone();
    let (out_films, refused) = spot_films(&films, |iid, mm| {
        let img = load_gray(&data.join("images").join(format!("{iid}.png")))?;
        let (_, hm, g) = e.run_raw(&img, false)?;
        film_spots(&spec, &g, &hm, img.width(), mm, c)
    }, progress);
    let name = data.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let h = CacheHeader { dataset: name, split: split.into(), git_sha: crate::provenance(data, "").git_sha,
        models: [(DEFAULT_BASE.to_string(), e.manifest().fingerprint())].into(), providers: [(DEFAULT_BASE.to_string(), e.provider().to_string())].into(),
        windows: vec![], films: out_films.len(), aariz_scale: None };
    std::fs::create_dir_all(out)?;
    write_spot_cache(out, &h, &out_films)?;
    write_refused(out, &refused)?;
    Ok((h, refused))
}

/// `--point-check-feasibility <mode>`. Exit code as in the plan's Global Constraints.
pub fn cli(data: &Path, mode: &str, split: &str, manifest: &Path, caches: &[PathBuf], out: &Path) -> anyhow::Result<i32> {
    match mode {
        "cache" => {
            anyhow::ensure!(split == "train" || split == "test1", "FT-2 reads Ceph-400 train and test1 only, not {split:?}");
            crate::ledger::refuse_held_back(data, split)?;
            let dir = out.join(format!("cache-{split}"));
            crate::ft_common::ensure_ignored(&dir)?;
            let c = serde_json::from_str::<Ft2Prereg>(PREREG)?.candidates();
            let (h, refused) = spot_cache(data, split, manifest, &dir, &c, |d, n| if d % 25 == 0 || d == n { eprintln!("FT-2 cache {split}: {d}/{n}") })?;
            println!("FT-2 cache {split}: {} films, model {:?}, runtime {:?}", h.films, h.models, h.providers);
            println!("FT-2 cache {split}: refused {}{}", refused.len(), refused.iter().map(|r| format!("\nFT-2 cache {split}: refused {}", r.why)).collect::<String>());
            refused_within_limit(&refused, h.films)?;
            Ok(0)
        }
        "run" => run_cli(data, caches, out),
        // FT-2b (spec §14.9b): flag-only, on the same caches, its own pre-registration and verdict.
        "run-b" => crate::ft2b::run_cli(data, caches, out),
        m => anyhow::bail!("--point-check-feasibility knows: cache, run, run-b; not {m:?}"),
    }
}

pub const PREREG: &str = include_str!("../../../reference/point-check-ft2.json");
pub const PREREG_PATH: &str = "reference/point-check-ft2.json";

#[derive(Clone, Debug, PartialEq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ft2Prereg {
    pub version: String, pub rule: String, pub spec: String, pub seed: u64, pub folds: usize,
    pub flag_line: f64, pub move_line: f64, pub qualify_line: f64, pub rounds: usize, pub min_points: usize,
    pub candidate_min_mm: f64, pub candidate_min_share: f64, pub candidate_keep: usize,
    pub d1_distances_mm: Vec<f64>, pub d1_decide_mm: f64, pub d1_flagged_min: f64, pub d1_pooled: Vec<String>,
    pub d2_within_mm: f64, pub d2_flagged_max: f64, pub d2_moved_max: f64, pub d3_beyond_mm: f64,
    pub d4_plant_beyond_mm: f64, pub d4_closer_min: f64, pub d4_within_mm: f64, pub d4_within_min: f64, pub d4_min_moves: usize,
    pub d5_extreme_films: usize, pub d5_jaw: Vec<String>, pub d5_jaw_forward_mm: f64, pub d5_b_forward_mm: f64,
    pub d5_flag_share_max: f64, pub d5_b_flagged_min: f64, pub d6_rings: Vec<f64>, pub d6_trip_factor: f64,
    pub norms_anb_mean_deg: f64, pub norms_anb_sd_deg: f64, pub norms_sd: f64,
    pub control_nasion_mm: f64, pub control_nasion_films: usize, pub soft_tissue: Vec<String>, pub report_separately: Vec<String>,
}
impl Ft2Prereg {
    pub fn lines(&self) -> Lines { Lines { flag: self.flag_line, mv: self.move_line, qualify: self.qualify_line, rounds: self.rounds, min_points: self.min_points } }
    pub fn candidates(&self) -> Candidates { Candidates { min_mm: self.candidate_min_mm, min_share: self.candidate_min_share, keep: self.candidate_keep } }
}

/// How many of how many, and the share (0 until something is counted; a judge refuses an empty count).
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
pub struct Count { pub of: usize, pub hit: usize, pub share: f64 }
impl Count { pub fn add(&mut self, hit: bool) { self.of += 1; if hit { self.hit += 1; } self.share = self.hit as f64 / self.of as f64; } }

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ring { pub chance: f64, pub promise: f64, pub beyond: usize, pub of: usize }

/// ANB in degrees from S, N, A and B: SNA − SNB (Steiner 1953).
pub fn anb_deg(t: &[Pt]) -> f64 {
    let (s, n) = (t[idx("S")], t[idx("N")]);
    let ang = |p: Pt| { let (u, v) = ((s.0 - n.0, s.1 - n.1), (p.0 - n.0, p.1 - n.1)); (u.0 * v.1 - u.1 * v.0).atan2(u.0 * v.0 + u.1 * v.1).abs().to_degrees() };
    ang(t[idx("A")]) - ang(t[idx("B")])
}

/// One film's results, judged by the shape model of its fold (fitted on the other folds' expert tracings).
struct FilmResult {
    film: String, mm: f64, aariz: Vec<Pt>, truth: Vec<Pt>, base: Outcome, expert: Outcome,
    d1: Vec<(usize, usize, bool)>, d4: Vec<(usize, Pt, Option<Pt>)>, d4_no_spot: usize,
    d5b: Outcome, d5c: Outcome, d6: Vec<f64>, sd_mm: Vec<f64>, ctrl: Option<(bool, bool)>,
}

fn film_result(s: &ShapeScorer, f: &SpotFilm, truth: &[Pt], fold: usize, pos: usize, p: &Ft2Prereg) -> anyhow::Result<FilmResult> {
    let (l, mm) = (p.lines(), f.mm_per_px);
    let px = |v: f64| v / mm;
    let some = |v: &[Pt]| v.iter().map(|q| Some(*q)).collect::<Vec<_>>();
    let base = check(s, &some(&f.aariz), &f.spots, &l)?;
    let expert = check(s, &some(truth), &f.spots, &l)?;
    let mut d1 = vec![];
    for k in 0..19 {
        for (di, d) in p.d1_distances_mm.iter().enumerate() {
            let (ux, uy) = direction(&mut case_rng(p.seed, &[1, fold as u64, pos as u64, k as u64, di as u64]));
            let mut t = f.aariz.clone();
            t[k] = (t[k].0 + ux * px(*d), t[k].1 + uy * px(*d));
            d1.push((k, di, check(s, &some(&t), &f.spots, &l)?.is_flagged(k)));
        }
    }
    let (mut d4, mut d4_no_spot) = (vec![], 0);
    for k in 0..19 {
        let Some(plant) = f.spots[k].iter().find(|c| dist((c.x, c.y), truth[k]) * mm >= p.d4_plant_beyond_mm).copied() else { d4_no_spot += 1; continue };
        let mut t = f.aariz.clone();
        t[k] = (plant.x, plant.y);
        // Control 3: the plant is now the pin; Aariz's own top peak was never a candidate (spots exclude it), so the
        // check cannot simply restore Aariz's original.
        let mut cands = f.spots.clone();
        cands[k].retain(|c| *c != plant);
        let o = check(s, &some(&t), &cands, &l)?;
        d4.push((k, (plant.x, plant.y), o.moved.filter(|m| m.point == k).map(|m| m.to)));
    }
    let mut jaw = truth.to_vec();
    for n in &p.d5_jaw { jaw[idx(n)].0 += px(p.d5_jaw_forward_mm); }                // forward = +x: Ceph-400 films face right
    let d5b = check(s, &some(&jaw), &f.spots, &l)?;
    let mut b = truth.to_vec();
    b[idx("B")].0 += px(p.d5_b_forward_mm);
    let d5c = check(s, &some(&b), &f.spots, &l)?;
    let (mut d6, mut sd_mm) = (vec![], vec![]);
    for k in 0..19 {
        let used: Vec<usize> = (0..19).filter(|&j| j != k).collect();
        d6.push(s.tail(k, &used, truth, truth[k])?);
        sd_mm.push(s.sd_px(k, &used, truth)? * mm);
    }
    let ctrl = if fold == 0 && pos < p.control_nasion_films {
        let n = idx("N");
        let (ux, uy) = direction(&mut case_rng(p.seed, &[2, pos as u64]));
        let mut t = f.aariz.clone();
        t[n] = (t[n].0 + ux * px(p.control_nasion_mm), t[n].1 + uy * px(p.control_nasion_mm));
        Some((check(s, &some(&t), &f.spots, &l)?.is_flagged(n), base.is_flagged(n)))
    } else { None };
    Ok(FilmResult { film: f.film.clone(), mm, aariz: f.aariz.clone(), truth: truth.to_vec(), base, expert, d1, d4, d4_no_spot, d5b, d5c, d6, sd_mm, ctrl })
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ft2Report {
    pub prereg: Ft2Prereg, pub films: usize, pub points: usize, pub fold_sizes: Vec<usize>, pub held_back: String, pub counts: Vec<String>,
    pub d1: BTreeMap<String, Vec<Count>>, pub d1_pooled: Count,
    pub d2_flagged: Count, pub d2_moved: Count,
    pub d3_flagged: Count, pub d3_moved: Count, pub d3_after_move_mm: Vec<f64>,
    pub d4_closer: Count, pub d4_within: Count, pub d4_real_moves: usize, pub d4_planted_moves: usize, pub d4_planted_tried: usize,
    pub d4_planted_no_spot: usize,
    /// The points reported separately (the pre-registration's `reportSeparately`; owner 27 Oct: Gonion), each with its own counts.
    pub separate: BTreeMap<String, Separate>,
    pub d5a_films: Vec<String>, pub d5a_flagged: Count, pub d5a_moves: usize, pub d5b_flagged: Count, pub d5b_moves: usize, pub d5c_flagged: Count,
    pub d6: Vec<Ring>, pub d6_tripped: bool, pub spread_mm: BTreeMap<String, f64>, pub norms_flagged: usize,
    pub control_nasion: Count, pub control_nasion_unplanted: Count, pub controls_held: bool,
    pub d1_pass: bool, pub d2_pass: bool, pub d4_pass: bool, pub d5_pass: bool, pub verdict: String,
    /// Films the caches could not make (set by the run from the caches' `refused.json`; not in the sample).
    pub refused: Vec<Refused>,
}

/// One point's own D2, D3 and D4 counts, for a point reported separately (never only inside a pooled number).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Separate { pub d2_flagged: Count, pub d2_moved: Count, pub d3_flagged: Count, pub d3_moved: Count, pub d4_closer: Count, pub d4_within: Count }

/// The verdict words (spec §14.9, verbatim in the plan's Global Constraints).
pub fn verdict(controls: bool, d1: bool, d2: bool, d5: bool, d4: bool) -> &'static str {
    if !controls { "broken: a control did not hold, so the instrument cannot be trusted; nothing is concluded" }
    else if !(d1 && d2 && d5) { "no-go: Stage A stops and returns to the owner" }
    else if !d4 { "go, flag-only: Stage A without corrections; returns to the owner as a question" }
    else { "go: Stage A may be built, with corrections" }
}
pub fn exit_code(v: &str) -> i32 { if v.starts_with("go:") { 0 } else if v.starts_with("go, flag-only") { 2 } else if v.starts_with("no-go") { 3 } else { 1 } }

/// The folds: the films sorted by name, shuffled with `seed`, dealt round-robin into `n` folds (indices into `films`).
/// FT-2b cuts its folds with FT-2's seed through this same function, so both judge each film with the same fold's model.
pub(crate) fn fold_split(films: &[SpotFilm], n: usize, seed: u64) -> Vec<Vec<usize>> {
    let mut order: Vec<usize> = (0..films.len()).collect();
    order.sort_by(|a, b| films[*a].film.cmp(&films[*b].film));
    shuffle(&mut order, &mut Rng::new(seed));
    (0..n).map(|f| order.iter().enumerate().filter(|(i, _)| i % n == f).map(|(_, x)| *x).collect()).collect()
}

/// FT-2 on these films: 5 folds by film (seeded), the shape model of each fold fitted on the other folds' expert
/// tracings only, every film judged once.
pub fn run_ft2(films: &[SpotFilm], truth: &BTreeMap<String, Vec<Pt>>, p: &Ft2Prereg) -> anyhow::Result<Ft2Report> {
    anyhow::ensure!(p.version == "point-check-ft2/1", "this program knows point-check-ft2/1, not {}", p.version);
    let mut seen = BTreeSet::new();
    for f in films { anyhow::ensure!(seen.insert(f.film.as_str()), "film {} is given twice", f.film); }
    anyhow::ensure!(films.len() >= 2 * p.folds && films.len() / p.folds > p.control_nasion_films, "only {} films: too few for {} folds and the {}-film control", films.len(), p.folds, p.control_nasion_films);
    for f in films {
        let t = truth.get(&f.film).ok_or_else(|| anyhow::anyhow!("{}: no expert tracing", f.film))?;
        anyhow::ensure!(t.len() == 19 && f.aariz.len() == 19 && f.spots.len() == 19, "{}: not 19 points", f.film);
    }
    let folds = fold_split(films, p.folds, p.seed);
    let fold_ids: Vec<usize> = (0..p.folds).collect();
    let per_fold: Vec<anyhow::Result<Vec<FilmResult>>> = par_map(&fold_ids, |&f| {
        let test = &folds[f];
        let train: Vec<usize> = folds.iter().enumerate().filter(|(g, _)| *g != f).flat_map(|(_, v)| v.clone()).collect();
        let names = |v: &[usize]| v.iter().map(|&i| films[i].film.clone()).collect::<Vec<_>>();
        no_homework(&names(&train), &names(test))?;
        let s = ShapeScorer::new(train.iter().map(|&i| truth[&films[i].film].clone()).collect());
        test.iter().enumerate().map(|(pos, &i)| film_result(&s, &films[i], &truth[&films[i].film], f, pos, p)).collect()
    });
    let mut all = vec![];
    for r in per_fold { all.extend(r?); }
    for id in &p.report_separately { anyhow::ensure!(ORIGINAL_19.contains(&id.as_str()), "reportSeparately names {id:?}, which is not one of the 19"); }
    let (b, n) = (idx("B"), films.len());
    let sep_of = |k: usize| p.report_separately.iter().any(|x| x == ORIGINAL_19[k]);
    let mut counts = vec![counted("films judged once each", all.len(), n)?];
    let mut r = Ft2Report { prereg: p.clone(), films: n, points: n * 19, fold_sizes: folds.iter().map(Vec::len).collect(),
        held_back: "Test2 (100 films) held back, owner 27 Oct".into(), counts: vec![], d1: BTreeMap::new(), d1_pooled: Count::default(),
        d2_flagged: Count::default(), d2_moved: Count::default(),
        d3_flagged: Count::default(), d3_moved: Count::default(), d3_after_move_mm: vec![],
        d4_closer: Count::default(), d4_within: Count::default(), d4_real_moves: 0, d4_planted_moves: 0, d4_planted_tried: 0, d4_planted_no_spot: 0,
        separate: p.report_separately.iter().map(|x| (x.clone(), Separate::default())).collect(), d5a_films: vec![], d5a_flagged: Count::default(), d5a_moves: 0,
        d5b_flagged: Count::default(), d5b_moves: 0, d5c_flagged: Count::default(),
        d6: p.d6_rings.iter().map(|c| Ring { chance: *c, ..Default::default() }).collect(), d6_tripped: false, spread_mm: BTreeMap::new(), norms_flagged: 0,
        control_nasion: Count::default(), control_nasion_unplanted: Count::default(), controls_held: false,
        d1_pass: false, d2_pass: false, d4_pass: false, d5_pass: false, verdict: String::new(), refused: vec![] };
    let judged = |from: Pt, to: Pt, t: Pt, mm: f64| (dist(to, t) < dist(from, t), dist(to, t) * mm <= p.d4_within_mm);
    let mut sds: Vec<Vec<f64>> = vec![vec![]; 19];
    for fr in &all {
        for k in 0..19 {
            let e = dist(fr.aariz[k], fr.truth[k]) * fr.mm;
            if e <= p.d2_within_mm {
                r.d2_flagged.add(fr.base.is_flagged(k)); r.d2_moved.add(fr.base.is_moved(k));
                if sep_of(k) { let x = r.separate.get_mut(ORIGINAL_19[k]).unwrap(); x.d2_flagged.add(fr.base.is_flagged(k)); x.d2_moved.add(fr.base.is_moved(k)); }
            }
            if e > p.d3_beyond_mm {
                r.d3_flagged.add(fr.base.is_flagged(k)); r.d3_moved.add(fr.base.is_moved(k));
                if let Some(m) = fr.base.moved.as_ref().filter(|m| m.point == k) { r.d3_after_move_mm.push(dist(m.to, fr.truth[k]) * fr.mm); }
                if sep_of(k) { let x = r.separate.get_mut(ORIGINAL_19[k]).unwrap(); x.d3_flagged.add(fr.base.is_flagged(k)); x.d3_moved.add(fr.base.is_moved(k)); }
            }
            sds[k].push(fr.sd_mm[k]);
        }
        if let Some(m) = &fr.base.moved {
            let (c, w) = judged(m.from, m.to, fr.truth[m.point], fr.mm);
            r.d4_closer.add(c); r.d4_within.add(w); r.d4_real_moves += 1;
            if sep_of(m.point) { let x = r.separate.get_mut(ORIGINAL_19[m.point]).unwrap(); x.d4_closer.add(c); x.d4_within.add(w); }
        }
        for (k, plant, to) in &fr.d4 {
            r.d4_planted_tried += 1;
            if let Some(to) = to {
                let (c, w) = judged(*plant, *to, fr.truth[*k], fr.mm);
                r.d4_closer.add(c); r.d4_within.add(w); r.d4_planted_moves += 1;
                if sep_of(*k) { let x = r.separate.get_mut(ORIGINAL_19[*k]).unwrap(); x.d4_closer.add(c); x.d4_within.add(w); }
            }
        }
        r.d4_planted_no_spot += fr.d4_no_spot;
        for (k, di, flagged) in &fr.d1 {
            r.d1.entry(ORIGINAL_19[*k].to_string()).or_insert_with(|| vec![Count::default(); p.d1_distances_mm.len()])[*di].add(*flagged);
            if p.d1_distances_mm[*di] == p.d1_decide_mm && p.d1_pooled.iter().any(|x| x == ORIGINAL_19[*k]) { r.d1_pooled.add(*flagged); }
        }
        for k in 0..19 { r.d5b_flagged.add(fr.d5b.is_flagged(k)); }
        r.d5b_moves += fr.d5b.moved.is_some() as usize;
        r.d5c_flagged.add(fr.d5c.is_flagged(b));
        for (i, ring) in p.d6_rings.iter().enumerate() { r.d6[i].beyond += fr.d6.iter().filter(|t| **t < *ring).count(); r.d6[i].of += 19; }
        if let Some((planted, unplanted)) = fr.ctrl { r.control_nasion.add(planted); r.control_nasion_unplanted.add(unplanted); }
    }
    for ring in r.d6.iter_mut() { ring.promise = ring.chance * ring.of as f64; }
    if let Some(flag_ring) = r.d6.iter().find(|x| x.chance == p.flag_line) { r.d6_tripped = flag_ring.beyond as f64 > p.d6_trip_factor * flag_ring.promise; }
    for (k, v) in sds.iter().enumerate() { r.spread_mm.insert(ORIGINAL_19[k].to_string(), median(v)?); }
    let mut by_anb: Vec<(f64, &FilmResult)> = all.iter().map(|fr| (anb_deg(&fr.truth), fr)).collect();
    by_anb.sort_by(|a, c| a.0.total_cmp(&c.0).then(a.1.film.cmp(&c.1.film)));
    let e = p.d5_extreme_films;
    for (anb, fr) in by_anb.iter().take(e).chain(by_anb.iter().rev().take(e)) {
        r.d5a_films.push(fr.film.clone());
        for k in 0..19 { r.d5a_flagged.add(fr.expert.is_flagged(k)); }
        r.d5a_moves += fr.expert.moved.is_some() as usize;
        if (anb - p.norms_anb_mean_deg).abs() > p.norms_sd * p.norms_anb_sd_deg { r.norms_flagged += 1; }
    }
    counts.push(counted("D5(a) extreme-ANB films", r.d5a_films.len(), 2 * e)?);
    counts.push(counted("D1 plants", r.d1.values().flatten().map(|c| c.of).sum(), n * 19 * p.d1_distances_mm.len())?);
    counts.push(counted("D5(b) points", r.d5b_flagged.of, n * 19)?);
    counts.push(counted("D6 expert points", r.d6[0].of, n * 19)?);
    counts.push(counted("points scored on Aariz's output (D2 and the rest)", r.d2_flagged.of + all.iter().map(|fr| (0..19).filter(|&k| dist(fr.aariz[k], fr.truth[k]) * fr.mm > p.d2_within_mm).count()).sum::<usize>(), n * 19)?);
    counts.push(counted("nasion control films", r.control_nasion.of, p.control_nasion_films)?);
    r.counts = counts;
    r.d1_pass = r.d1_pooled.of > 0 && r.d1_pooled.share >= p.d1_flagged_min;
    r.d2_pass = r.d2_flagged.of > 0 && r.d2_flagged.share <= p.d2_flagged_max && r.d2_moved.share <= p.d2_moved_max;
    r.d4_pass = r.d4_closer.of >= p.d4_min_moves && r.d4_closer.share >= p.d4_closer_min && r.d4_within.share >= p.d4_within_min;
    r.d5_pass = r.d5a_moves == 0 && r.d5a_flagged.share <= p.d5_flag_share_max && r.d5b_moves == 0 && r.d5b_flagged.share <= p.d5_flag_share_max
        && r.d5c_flagged.of > 0 && r.d5c_flagged.share >= p.d5_b_flagged_min;
    // Controls: the 15 mm nasion is flagged on every control film and the unplanted films are not all flagged; B alone
    // 10 mm forward is flagged (the positive side of the two-sided class control; its negative side is D5(b)'s mark,
    // whose failure is a no-go, not a broken instrument).
    r.controls_held = r.control_nasion.of == p.control_nasion_films && r.control_nasion.hit == r.control_nasion.of
        && r.control_nasion_unplanted.hit < r.control_nasion_unplanted.of && r.d5c_flagged.share >= p.d5_b_flagged_min;
    r.verdict = verdict(r.controls_held, r.d1_pass, r.d2_pass, r.d5_pass, r.d4_pass).into();
    Ok(r)
}

impl Ft2Report {
    pub fn exit_code(&self) -> i32 { exit_code(&self.verdict) }
    pub fn summary(&self) -> String {
        let pf = |b: bool| if b { "PASS" } else { "FAIL" };
        // A count of nothing is shown as such, never as a share of 0/0 (Count's share is 0 until something is counted).
        let c = |x: &Count| if x.of == 0 { "0/0 (nothing counted)".to_string() } else { format!("{}/{} = {:.4}", x.hit, x.of, x.share) };
        let p = &self.prereg;
        let mut s = format!("FT-2 on {} Ceph-400 films ({}); rule {}; seed {}; folds {:?}\n", self.films, self.held_back, p.rule, p.seed, self.fold_sizes);
        for k in &self.counts { s += &format!("FT-2 count: {k}\n"); }
        s += &format!("FT-2 refused films (not in the sample): {}{}\n", self.refused.len(),
            if self.refused.is_empty() { String::new() } else { format!(": {} (safety stop above {}%)", self.refused.iter().map(|r| r.film.as_str()).collect::<Vec<_>>().join(", "), REFUSED_MAX_PERCENT) });
        for x in &self.refused { s += &format!("FT-2 refused: {}\n", x.why); }
        s += &format!("FT-2 D1 at {} mm, pooled over {} points: {} (mark >= {}) {}\n", p.d1_decide_mm, p.d1_pooled.len(), c(&self.d1_pooled), p.d1_flagged_min, pf(self.d1_pass));
        for (pt, v) in &self.d1 { s += &format!("FT-2 D1 {pt}: {}\n", v.iter().zip(&p.d1_distances_mm).map(|(x, d)| format!("{d} mm {}/{}", x.hit, x.of)).collect::<Vec<_>>().join(", ")); }
        s += &format!("FT-2 D2 flagged {} (mark <= {}); moved {} (mark <= {}) {}\n", c(&self.d2_flagged), p.d2_flagged_max, c(&self.d2_moved), p.d2_moved_max, pf(self.d2_pass));
        let after = median(&self.d3_after_move_mm).map(|m| format!("{m:.2} mm")).unwrap_or_else(|_| "no move".into());
        s += &format!("FT-2 D3 Aariz misses > {} mm: {}; flagged {}; moved {}; after a move, median {} from the truth\n", p.d3_beyond_mm, self.d3_flagged.of, c(&self.d3_flagged), c(&self.d3_moved), after);
        s += &format!("FT-2 D4 moves {} (real {}, planted {} of {} tried; {} points had no spot >= {} mm from the truth): closer {} (>= {}), within {} mm {} (>= {}); at least {} moves needed {}\n",
            self.d4_closer.of, self.d4_real_moves, self.d4_planted_moves, self.d4_planted_tried, self.d4_planted_no_spot, p.d4_plant_beyond_mm,
            c(&self.d4_closer), p.d4_closer_min, p.d4_within_mm, c(&self.d4_within), p.d4_within_min, p.d4_min_moves, pf(self.d4_pass));
        s += &format!("FT-2 D5 (a) {} extreme-ANB expert tracings: flagged {} points, moves {}; (b) jaw {} mm forward: flagged {} points, moves {}; (c) B {} mm forward: flagged {} {}\n",
            self.d5a_films.len(), c(&self.d5a_flagged), self.d5a_moves, p.d5_jaw_forward_mm, c(&self.d5b_flagged), self.d5b_moves, p.d5_b_forward_mm, c(&self.d5c_flagged), pf(self.d5_pass));
        for ring in &self.d6 { s += &format!("FT-2 D6 ring 1 in {:.0}: {} of {} expert points beyond (promise {:.2})\n", 1.0 / ring.chance, ring.beyond, ring.of, ring.promise); }
        s += &format!("FT-2 D6 tripped (more than {} times the 1-in-5,000 promise): {}\n", p.d6_trip_factor, if self.d6_tripped { "YES: the chance must be read from the real spread; the owner is told" } else { "no" });
        s += &format!("FT-2 spread per point (median ring sd, mm): {}\n", self.spread_mm.iter().map(|(k, v)| format!("{k} {v:.2}")).collect::<Vec<_>>().join(", "));
        s += &format!("FT-2 norms (ANB beyond {} SD of {}° ± {}°) would flag {} of D5(a)'s {} films (for the record)\n", p.norms_sd, p.norms_anb_mean_deg, p.norms_anb_sd_deg, self.norms_flagged, self.d5a_films.len());
        // In the pre-registration's order (`reportSeparately`); Go is printed as "Gonion", the owner's word.
        for id in &p.report_separately {
            let Some(x) = self.separate.get(id) else { continue };
            let g = self.d1.get(id).map(|v| v.iter().zip(&p.d1_distances_mm).map(|(x, d)| format!("{d} mm {}/{}", x.hit, x.of)).collect::<Vec<_>>().join(", ")).unwrap_or_default();
            s += &format!("FT-2 {} (reported separately): D1 {g}; D2 flagged {}, moved {}; D3 misses {}, flagged {}, moved {}; D4 moves {}, closer {}, within {}; ring sd {:.2} mm\n",
                if id == "Go" { "Gonion" } else { id.as_str() }, c(&x.d2_flagged), c(&x.d2_moved), x.d3_flagged.of, c(&x.d3_flagged), c(&x.d3_moved), x.d4_closer.of, c(&x.d4_closer), c(&x.d4_within), self.spread_mm.get(id).copied().unwrap_or(f64::NAN));
        }
        s += &format!("FT-2 controls: nasion {} mm flagged {} (must be all); unplanted {} (must not be all); B alone {}: {}\n",
            p.control_nasion_mm, c(&self.control_nasion), c(&self.control_nasion_unplanted), c(&self.d5c_flagged), if self.controls_held { "held" } else { "BROKEN" });
        s += &format!("FT-2 verdict: {}", self.verdict);
        s
    }
}

/// The experts' tracings of these films, in `ORIGINAL_19` order; a film or point missing is an error.
pub fn truth_of(films: &[SpotFilm], gt: &crate::dataset::Points) -> anyhow::Result<BTreeMap<String, Vec<Pt>>> {
    films.iter().map(|f| {
        let pts = gt.get(&f.film).ok_or_else(|| anyhow::anyhow!("{}: no expert tracing", f.film))?;
        let t = ORIGINAL_19.iter().map(|id| pts.iter().find(|(l, _, _)| l == id).map(|(_, x, y)| (*x, *y)).ok_or_else(|| anyhow::anyhow!("{}: the experts have no {id}", f.film))).collect::<anyhow::Result<Vec<_>>>()?;
        Ok((f.film.clone(), t))
    }).collect()
}

fn run_cli(data: &Path, caches: &[PathBuf], out: &Path) -> anyhow::Result<i32> {
    anyhow::ensure!(!caches.is_empty(), "--point-check-feasibility run needs --cache <train cache>,<test1 cache>");
    let mut splits = vec![];
    for d in caches { splits.push(crate::chainproof::cache_header(data, d)?.split); }     // every header first
    splits.sort();
    anyhow::ensure!(splits == ["test1", "train"], "FT-2 runs on one train cache and one test1 cache, not {splits:?}");
    anyhow::ensure!(!crate::provenance(data, "").git_dirty, "commit first: the pass marks are pre-registered ({PREREG_PATH})");
    crate::ft_common::committed_as_built(PREREG_PATH, PREREG, crate::ft_common::at_head(PREREG_PATH))?;
    let p: Ft2Prereg = serde_json::from_str(PREREG)?;
    let (mut films, mut refused) = (vec![], vec![]);
    for d in caches { films.extend(read_spot_cache(data, d)?.1); refused.extend(read_refused(d)?); }
    for x in &refused { eprintln!("FT-2 refused: {}", x.why); }
    refused_within_limit(&refused, films.len())?;
    let truth = truth_of(&films, &crate::dataset::load_points(&data.join("gt.csv"))?)?;
    let mut r = run_ft2(&films, &truth, &p)?;
    r.refused = refused;
    crate::ft_common::ensure_ignored(out)?;
    std::fs::create_dir_all(out)?;
    let path = out.join("ft2.json");
    std::fs::write(&path, serde_json::to_string_pretty(&r)?)?;
    println!("{}", r.summary());
    println!("FT-2 written to {} (exit {})", path.display(), r.exit_code());
    Ok(r.exit_code())
}

#[cfg(test)]
/// SYNTHETIC films (shared with FT-2b's tests) from the synthetic faces: Aariz = the face + 0.5 mm wobble; each point has a wrong spot 12 mm
/// forward (brightest) and a right spot 0.36 mm from the truth.
pub(crate) fn synthetic(n: usize) -> (Vec<SpotFilm>, BTreeMap<String, Vec<Pt>>) {
    let mut r = crate::chainproof::Rng::new(22);
    let (mut films, mut truth) = (vec![], BTreeMap::new());
    for (i, f) in crate::shape::synthetic::faces(n, 21).into_iter().enumerate() {
        let id = format!("SYNTHETIC-{i:03}");
        let aariz = f.iter().map(|p| (p.0 + crate::ft_common::normal(&mut r) * 5.0, p.1 + crate::ft_common::normal(&mut r) * 5.0)).collect();
        let spots = f.iter().map(|p| vec![Spot { x: p.0 + 120.0, y: p.1, brightness: 0.9 }, Spot { x: p.0 + 3.0, y: p.1 + 2.0, brightness: 0.8 }]).collect();
        films.push(SpotFilm { film: id.clone(), mm_per_px: 0.1, aariz, spots });
        truth.insert(id, f);
    }
    (films, truth)
}
#[cfg(test)] const PINNED_SHA256: &str = "a82f09912e62088f710110d9a292960ba70310ba0489b0083402bc90f1e778c0";

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    /// A SYNTHETIC 20-channel spec (the 19 originals and one unused), 40 × 50 cells, Chw.
    fn spec19(map: Vec<Option<String>>) -> ModelSpec {
        serde_json::from_value(serde_json::json!({"manifestVersion": 2, "id": "aariz-cepha29", "version": "SYNTHETIC", "file": "m", "sha256": "s",
            "input": {"name": "image", "width": 160, "height": 200, "channels": 3, "resize": {"kind": "stretch"},
                      "normalize": {"kind": "fixed", "mean": [0, 0, 0], "std": [1, 1, 1], "scale": 255.0}},
            "output": {"name": "heatmaps", "width": 40, "height": 50, "stride": 4, "heatmapCenter": "half-pixel", "decode": {"kind": "argmax"}},
            "landmarkMap": map, "runtime": "cpu"})).unwrap()
    }
    fn all19() -> Vec<Option<String>> { ORIGINAL_19.iter().map(|s| Some(s.to_string())).chain([None]).collect() }
    /// Channel k: its top at (5 + k, 10 + k) = 2.0 and a second peak at (35, 45 − k) = 1.0.
    fn heat(n: usize) -> Vec<f32> {
        let mut h = vec![0f32; n * 2000];
        for k in 0..n { h[k * 2000 + (10 + k) * 40 + 5 + k] = 2.0; h[k * 2000 + (45 - k) * 40 + 35] = 1.0; }
        h
    }
    #[test] fn each_of_the_19_gets_its_pin_and_its_next_spot() {
        let m = spec19(all19());
        let g = Geometry::for_input(800, 1000, &m.input);
        let (marks, spots) = film_spots(&m, &g, &heat(20), 800, 0.1, &Candidates { min_mm: 3.0, min_share: 0.25, keep: 4 }).unwrap();
        let (lms, _) = points_from_heatmaps(&m, &g, &heat(20), 800, false);
        assert_eq!((marks.len(), spots.len()), (19, 19));
        for (k, id) in ORIGINAL_19.iter().enumerate() {
            let l = lms.iter().find(|l| l.id == *id).unwrap();
            assert_eq!((marks[k].0.to_bits(), marks[k].1.to_bits()), (l.x.to_bits(), l.y.to_bits()), "{id}: the pin is the decode's own");
            assert_eq!((spots[k].len(), spots[k][0].brightness), (1, 1.0), "{id}");
        }
    }
    #[test] fn a_model_without_all_19_is_refused_by_name() {
        let m = spec19(vec![Some("S".into()), Some("N".into())]);
        let g = Geometry::for_input(800, 1000, &m.input);
        let e = film_spots(&m, &g, &heat(2), 800, 0.1, &Candidates { min_mm: 3.0, min_share: 0.25, keep: 4 }).unwrap_err().to_string();
        assert!(e.contains("Or") && e.contains("FT-2 needs all 19"), "{e}");
    }
    /// BINDING CARRY (Task 3 report, 40b381f): `film_spots` must refuse a heat map too short for the channel it is
    /// about to slice, never panic on the index. A model mapping 19 channels but given only 10 channels' worth of
    /// data must fail cleanly (not with a slice-index panic) well before the 19th point.
    #[test] fn a_short_heat_map_is_refused_before_it_is_indexed() {
        let m = spec19(all19());
        let g = Geometry::for_input(800, 1000, &m.input);
        let c = Candidates { min_mm: 3.0, min_share: 0.25, keep: 4 };
        let e = film_spots(&m, &g, &heat(10), 800, 0.1, &c).unwrap_err().to_string();
        assert!(e.contains("heat map has only"), "{e}");
        assert!(e.contains("20000") && e.contains("40000"), "names the shortfall: {e}");
        // Positive control: the right-sized heat map (same spec, same candidates) still works.
        assert!(film_spots(&m, &g, &heat(20), 800, 0.1, &c).is_ok(), "control: a full heat map is not refused");
    }
    pub(crate) fn films(n: usize) -> Vec<SpotFilm> {
        (0..n).map(|i| SpotFilm { film: format!("SYNTHETIC-{i:03}"), mm_per_px: 0.1,
            aariz: (0..19).map(|k| (1.0 / 3.0 + i as f64 + k as f64, 2.0 / 7.0 * k as f64)).collect(),
            spots: (0..19).map(|k| vec![Spot { x: 0.1 + k as f64, y: 1.0 / 9.0, brightness: 0.3 }]).collect() }).collect()
    }
    pub(crate) fn header(split: &str, n: usize) -> CacheHeader {
        CacheHeader { dataset: "ceph400".into(), split: split.into(), git_sha: "SYNTHETIC".into(), models: [(DEFAULT_BASE.to_string(), "SYNTHETIC".to_string())].into(),
            providers: [(DEFAULT_BASE.to_string(), "cpu".to_string())].into(), windows: vec![], films: n, aariz_scale: None }
    }
    #[test] fn the_cache_gives_back_every_value_bit_for_bit() {
        let d = tempfile::tempdir().unwrap();
        write_spot_cache(d.path(), &header("train", 3), &films(3)).unwrap();
        let (_, back) = read_spot_cache(Path::new("data/ceph400"), d.path()).unwrap();
        assert_eq!(back, films(3));
    }
    #[test] fn a_test2_cache_is_refused_before_its_spots_are_read_and_a_missing_film_is_named() {
        let d = tempfile::tempdir().unwrap();
        write_spot_cache(d.path(), &header("test2", 1), &films(1)).unwrap();
        std::fs::write(d.path().join("spots.jsonl"), "SYNTHETIC: not JSON\n").unwrap();
        assert!(read_spot_cache(Path::new("data/ceph400"), d.path()).unwrap_err().to_string().contains("held back"));
        let d = tempfile::tempdir().unwrap();
        write_spot_cache(d.path(), &header("train", 2), &films(2)).unwrap();
        let first = std::fs::read_to_string(d.path().join("spots.jsonl")).unwrap().lines().next().unwrap().to_string();
        std::fs::write(d.path().join("spots.jsonl"), first + "\n").unwrap();
        assert!(read_spot_cache(Path::new("data/ceph400"), d.path()).unwrap_err().to_string().contains("SYNTHETIC-001"));
    }
    #[test] fn the_preregistration_is_pinned() {
        assert_eq!(crate::ft_common::sha256_hex(PREREG.as_bytes()), PINNED_SHA256, "reference/point-check-ft2.json changed: owner's OK for a pass mark, then update PINNED_SHA256");
    }
    #[test] fn the_preregistration_holds_the_owners_lines_and_marks() {
        let p: Ft2Prereg = serde_json::from_str(PREREG).unwrap();
        assert_eq!((p.flag_line, p.move_line, p.qualify_line, p.rounds, p.min_points), (1.0 / 5_000.0, 1.0 / 50_000.0, 0.05, 3, 12));
        assert_eq!((p.d1_flagged_min, p.d2_flagged_max, p.d2_moved_max, p.d4_closer_min, p.d4_within_min, p.d5_b_flagged_min), (0.9, 0.005, 0.001, 0.9, 0.7, 0.9));
        assert_eq!((p.d5_jaw_forward_mm, p.d5_b_forward_mm, p.d6_trip_factor), (5.0, 10.0, 5.0));
        assert!(p.d1_pooled.iter().all(|x| !p.soft_tissue.contains(x)) && p.report_separately == ["Go"]);
    }
    #[test] fn a_synthetic_run_counts_everything_holds_its_controls_and_reports_gonion_alone() {
        let (films, truth) = synthetic(300);
        let p: Ft2Prereg = serde_json::from_str(PREREG).unwrap();
        let r = run_ft2(&films, &truth, &p).unwrap();
        eprintln!("{}", r.summary());
        assert_eq!((r.films, r.points, r.fold_sizes.iter().sum::<usize>()), (300, 5700, 300));
        assert!(r.controls_held, "{}", r.summary());
        assert!(r.d1_pass && r.d5_pass, "{}", r.summary());
        assert_eq!(r.d5b_moves, 0);
        assert!(r.d4_planted_moves > 0 && r.d4_closer.share >= 0.9, "{}", r.summary());
        assert!(r.summary().lines().any(|l| l.starts_with("FT-2 Gonion")), "Gonion has its own line");
        assert_eq!(r.d6.iter().map(|x| x.of).collect::<Vec<_>>(), vec![5700; 3]);
        assert!(!r.d6_tripped, "the experts' own points sit inside the rings: D6 must not trip\n{}", r.summary());
        assert!(r.summary().lines().any(|l| l == "FT-2 refused films (not in the sample): 0"), "the refusals line is always printed");
        let mut r = r;
        r.refused = vec![Refused { film: "SYNTHETIC-777".into(), why: "SYNTHETIC-777: SYNTHETIC".into() }];
        assert!(r.summary().lines().any(|l| l.starts_with("FT-2 refused films (not in the sample): 1: SYNTHETIC-777")), "{}", r.summary());
    }
    /// The instrument check: a nasion "plant" of 0 mm is no plant, so the control cannot be met and the run must say
    /// the instrument is broken (exit 1), never a verdict.
    #[test] fn a_nasion_plant_of_zero_mm_breaks_the_instrument() {
        let (films, truth) = synthetic(300);
        let p = Ft2Prereg { control_nasion_mm: 0.0, ..serde_json::from_str(PREREG).unwrap() };
        let r = run_ft2(&films, &truth, &p).unwrap();
        assert!(!r.controls_held && r.exit_code() == 1, "{}", r.summary());
    }
    #[test] fn a_film_twice_too_few_films_and_a_missing_truth_are_refused() {
        let (mut films, truth) = synthetic(60);
        let p: Ft2Prereg = serde_json::from_str(PREREG).unwrap();
        films.push(films[4].clone());
        assert!(run_ft2(&films, &truth, &p).unwrap_err().to_string().contains("twice"));
        let (films, truth) = synthetic(9);
        assert!(run_ft2(&films, &truth, &p).unwrap_err().to_string().contains("too few"));
        let (films, mut truth) = synthetic(60);
        truth.remove("SYNTHETIC-007");
        assert!(run_ft2(&films, &truth, &p).unwrap_err().to_string().contains("SYNTHETIC-007"));
    }
    /// Edge case: a point with no spot >= 5 mm from the truth on any film cannot be planted. D4 skips it and counts it.
    /// Control: drop the distance filter (plant whatever spot comes first) -> no point is skipped and this fails.
    #[test] fn d4_skips_and_counts_a_point_with_no_spot_far_from_the_truth() {
        let (mut films, truth) = synthetic(60);
        let go = idx("Go");
        for f in films.iter_mut() { f.spots[go].retain(|s| s.x - f.aariz[go].0 < 50.0); }   // only the right spot (0.36 mm) is left
        let p: Ft2Prereg = serde_json::from_str(PREREG).unwrap();
        let r = run_ft2(&films, &truth, &p).unwrap();
        let line = r.summary().lines().find(|l| l.starts_with("FT-2 D4")).unwrap().to_string();
        eprintln!("{line}");
        assert_eq!((r.d4_planted_no_spot, r.d4_planted_tried), (60, 60 * 18), "{line}");
        assert!(line.contains("60 points had no spot >= 5 mm"), "{line}");
    }
    /// Edge case (Q-FT3): too few moves to judge D4 is "go, flag-only", exit 2, never "go". Zero moves: every point has
    /// only its wrong spot, so nothing can move, and D4's shares read "nothing counted", never a share of 0/0. Twenty
    /// perfect moves (Go's right spot on 20 films only): every move closer and within 2 mm, still fewer than 30.
    /// Control: drop `r.d4_closer.of >= p.d4_min_moves` from `d4_pass` -> the 20-move half says "go" (exit 0) and fails.
    #[test] fn fewer_than_30_moves_is_go_flag_only() {
        let p: Ft2Prereg = serde_json::from_str(PREREG).unwrap();
        let (mut films, truth) = synthetic(300);
        for f in films.iter_mut() { for v in f.spots.iter_mut() { v.retain(|s| s.brightness > 0.85); } }
        let r = run_ft2(&films, &truth, &p).unwrap();
        let line = r.summary().lines().find(|l| l.starts_with("FT-2 D4")).unwrap().to_string();
        eprintln!("zero moves: {line}\nzero moves: {}", r.summary().lines().last().unwrap());
        assert_eq!((r.d4_closer.of, r.d4_real_moves, r.d4_planted_moves), (0, 0, 0), "{line}");
        assert!(line.contains("nothing counted") && !line.contains("0/0 = 0.0000"), "{line}");
        assert!(r.controls_held && r.d1_pass && r.d2_pass && r.d5_pass && !r.d4_pass, "{}", r.summary());
        assert_eq!((r.verdict.as_str(), r.exit_code()), ("go, flag-only: Stage A without corrections; returns to the owner as a question", 2));
        let (mut films, truth) = synthetic(300);
        let go = idx("Go");
        for (i, f) in films.iter_mut().enumerate() { for (k, v) in f.spots.iter_mut().enumerate() { if !(k == go && i < 20) { v.retain(|s| s.brightness > 0.85); } } }
        let r = run_ft2(&films, &truth, &p).unwrap();
        let line = r.summary().lines().find(|l| l.starts_with("FT-2 D4")).unwrap().to_string();
        eprintln!("twenty: {line}\ntwenty: {}", r.summary().lines().last().unwrap());
        assert!(r.d4_closer.of > 0 && r.d4_closer.of < 30 && r.d4_closer.share == 1.0 && r.d4_within.share == 1.0, "{line}");
        assert_eq!(r.exit_code(), 2, "{}", r.summary());
    }
    /// Edge case: D6 trips when the experts' own points sit beyond the 1-in-5,000 ring far more often than it promises.
    /// Nasion is moved 40 mm on every 33rd expert tracing (10 of 300). Few and far: the other folds' rings widen a little
    /// with them (they learn from them too), but not enough to hold them, so they sit beyond the ring far more often
    /// than 5 x 1.14. (Measured first: 30 of 300 moved 20 mm widened the rings so much that D6 did not trip, which is
    /// the honest limit of D6: a heavy tail that is common enough is learnt as spread.)
    /// Controls: the assignment of `d6_tripped` removed -> this fails; `d6_tripped = true` always -> the clean synthetic
    /// run's `!r.d6_tripped` fails.
    #[test] fn d6_trips_when_the_experts_points_sit_beyond_the_ring() {
        let (films, mut truth) = synthetic(300);
        for (i, t) in truth.values_mut().enumerate() { if i % 33 == 0 { t[idx("N")].0 += 400.0; } }
        let p: Ft2Prereg = serde_json::from_str(PREREG).unwrap();
        let r = run_ft2(&films, &truth, &p).unwrap();
        let s = r.summary();
        for l in s.lines().filter(|l| l.starts_with("FT-2 D6")) { eprintln!("{l}"); }
        assert!(r.d6_tripped, "{s}");
        assert!(s.contains("FT-2 D6 tripped (more than 5 times the 1-in-5,000 promise): YES"), "{s}");
    }
    /// Edge case: an expert tracing missing one of the 19 points is refused by film and point name.
    #[test] fn a_tracing_missing_a_point_in_the_truth_is_refused_by_name() {
        let (films, truth) = synthetic(2);
        let mut gt: crate::dataset::Points = truth.iter().map(|(f, t)| (f.clone(), ORIGINAL_19.iter().zip(t).map(|(id, p)| (id.to_string(), p.0, p.1)).collect())).collect();
        assert_eq!(truth_of(&films, &gt).unwrap(), truth, "control: a whole tracing is read back as it was");
        gt.get_mut("SYNTHETIC-001").unwrap().retain(|(id, _, _)| id != "Gn");
        let e = truth_of(&films, &gt).unwrap_err().to_string();
        assert!(e.contains("SYNTHETIC-001") && e.contains("Gn"), "{e}");
    }
    /// Task 4 review ruling: one film that fails (here a short heat map) is refused by name, counted and skipped; the
    /// other films are still cached, and the refusal is read back with the cache. Control: the refusal not recorded
    /// (the film skipped silently) -> the count and the name fail.
    #[test] fn one_bad_film_among_good_ones_is_refused_named_and_the_rest_cached() {
        let m = spec19(all19());
        let g = Geometry::for_input(800, 1000, &m.input);
        let c = Candidates { min_mm: 3.0, min_share: 0.25, keep: 4 };
        let ids: Vec<(String, f64)> = (0..3).map(|i| (format!("SYNTHETIC-{i:03}"), 0.1)).collect();
        let (films, refused) = spot_films(&ids, |id, mm| film_spots(&m, &g, &heat(if id == "SYNTHETIC-001" { 10 } else { 20 }), 800, mm, &c), |_, _| {});
        eprintln!("refused: {refused:?}");
        assert_eq!(films.iter().map(|f| f.film.as_str()).collect::<Vec<_>>(), ["SYNTHETIC-000", "SYNTHETIC-002"]);
        assert_eq!(refused.len(), 1, "{refused:?}");
        assert!(refused[0].film == "SYNTHETIC-001" && refused[0].why.starts_with("SYNTHETIC-001: ") && refused[0].why.contains("heat map has only"), "{refused:?}");
        let d = tempfile::tempdir().unwrap();
        write_spot_cache(d.path(), &header("train", films.len()), &films).unwrap();
        write_refused(d.path(), &refused).unwrap();
        let (_, back) = read_spot_cache(Path::new("data/ceph400"), d.path()).unwrap();
        assert_eq!(back, films, "the cache holds every film that was not refused");
        assert_eq!(read_refused(d.path()).unwrap(), refused);
        let none = tempfile::tempdir().unwrap();
        assert!(read_refused(none.path()).unwrap_err().to_string().contains("refused.json"), "a cache without its refusals list is refused");
    }
    /// More than REFUSED_MAX_PERCENT of the films refused stops the run: the sample is no longer the pre-registered one.
    /// Exactly 5% (15 of 300) is allowed; 16 of 300 stops, naming the count. Controls: the check removed -> 16 passes;
    /// `>` made `>=` -> 15 stops. Both fail this test.
    #[test] fn more_than_5_percent_refused_stops_the_run() {
        let r = |n: usize| (0..n).map(|i| Refused { film: format!("SYNTHETIC-{i:03}"), why: "SYNTHETIC".into() }).collect::<Vec<_>>();
        assert_eq!(REFUSED_MAX_PERCENT, 5);
        refused_within_limit(&r(0), 300).unwrap();
        refused_within_limit(&r(15), 285).unwrap();
        let e = refused_within_limit(&r(16), 284).unwrap_err().to_string();
        eprintln!("{e}");
        assert!(e.contains("16 of 300") && e.contains("5%") && e.contains("SYNTHETIC-000"), "{e}");
        assert!(refused_within_limit(&r(0), 0).unwrap_err().to_string().contains("no film"), "nothing at all is an error, never a pass");
    }
    /// Task 5 review: the points reported separately come from the pre-registration's `reportSeparately`, never a
    /// hard-coded Go. With ["Go", "N"] both get their own counts and their own line; an id not among the 19 is refused.
    /// Control: hard-code "Go" again -> N has no line and this fails.
    #[test] fn the_points_reported_separately_are_read_from_the_preregistration() {
        let (films, truth) = synthetic(60);
        let p = Ft2Prereg { report_separately: vec!["Go".into(), "N".into()], ..serde_json::from_str(PREREG).unwrap() };
        let r = run_ft2(&films, &truth, &p).unwrap();
        let sep: Vec<String> = r.summary().lines().filter(|l| l.contains("(reported separately)")).map(String::from).collect();
        for l in &sep { eprintln!("{l}"); }
        assert_eq!(r.separate.keys().map(String::as_str).collect::<Vec<_>>(), ["Go", "N"]);
        assert!(r.separate["N"].d2_flagged.of + r.separate["N"].d3_flagged.of > 0, "N's own counts are filled");
        assert!(sep.len() == 2 && sep[0].starts_with("FT-2 Gonion (reported separately): ") && sep[1].starts_with("FT-2 N (reported separately): "), "{sep:?}");
        let p = Ft2Prereg { report_separately: vec!["Gonion".into()], ..serde_json::from_str(PREREG).unwrap() };
        assert!(run_ft2(&films, &truth, &p).unwrap_err().to_string().contains("Gonion"), "an id not among the 19 is refused by name");
    }
    #[test] fn each_verdict_has_its_exit_code() {
        assert_eq!(exit_code(verdict(true, true, true, true, true)), 0);
        assert_eq!(exit_code(verdict(true, true, true, true, false)), 2);
        assert_eq!(exit_code(verdict(true, false, true, true, true)), 3);
        assert_eq!(exit_code(verdict(true, true, true, false, true)), 3);
        assert_eq!(exit_code(verdict(false, true, true, true, true)), 1);
    }
    /// By hand: N at the origin, S 70 px behind; A at 82° and B at 80° from N→S (film y down) give ANB = 2°.
    #[test] fn anb_is_sna_minus_snb() {
        let mut t = vec![(0.0, 0.0); 19];
        t[idx("S")] = (-70.0, 0.0);
        let at = |deg: f64| (60.0 * (180.0 - deg).to_radians().cos(), 60.0 * (180.0 - deg).to_radians().sin());
        t[idx("A")] = at(82.0); t[idx("B")] = at(80.0);
        assert!((anb_deg(&t) - 2.0).abs() < 1e-9, "{}", anb_deg(&t));
    }
}
