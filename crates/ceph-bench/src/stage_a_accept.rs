//! Stage A Task 10: the pre-registered acceptance of the app's point check on public films
//! (`reference/point-check-app-acceptance.json`, `stage-a-acceptance/1`; spec 2026-11-02 §14.9b, §14.13 U6, U7).
//!
//! A **reproduction through the app's code**, not a fresh test: the same 300 Ceph-400 films (Train 001-150, Test1
//! 151-300; Test2 is never opened), FT-2's caches, FT-2b's folds (`foldSeed`), plants (`seed`), marks and controls.
//! It runs FT-2b itself (`ft2b::run_ft2b`, the bench, the reference) and then, on the same folds and the same plants,
//! the app's `ceph_model::pointcheck::score_run` with each fold's app `ShapeScorer`, built from the very same training
//! tracings in the very same order as the bench's (`ft2::fold_split`, then the other folds in fold order). Every case is
//! compared with the bench's `flag_only` outcome.
//!
//! The marks: A1 FT-2b's own marks on the app's counts; A2 every count equals FT-2b's report exactly; A3 the app's
//! outcome equals the bench's on every case (same flagged points, same order, tails equal to the bit); A4 the 10 control
//! films mirrored (facing left) give the same flags as unmirrored, through `score_run`; A5 the 10 control films' outcomes
//! written to a temporary library and read back after closing and reopening are equal.
//!
//! In A4, "the same flags" means the same flagged points in the same order and the same outcome, exactly; the tails,
//! centres and rings within 1e-12 relative, not bit for bit, because mirroring a fractional coordinate and mirroring it
//! back is not always exact to the last bit.
//!
//! Verdicts: pass (A1-A5 hold) exit 0; fail (the controls hold but A1-A5 do not) exit 3, back to the owner; broken (a
//! control fails, or a count is not its expected total) exit 1. A count other than its expected total, and a mark that
//! counted nothing, stop the run with an error, which `main` turns into exit 1. Bench only: nothing in the app reads it.
use crate::ft2::{anb_deg, idx, Count, SpotFilm};
use crate::ft2b::{flag_only, Ft2bPrereg, Ft2bReport};
use crate::ft_common::{case_rng, counted, direction, dist, no_homework, par_map, Pt};
use crate::pointcheck::{Lines, Outcome};
use ceph_model::pointcheck::{self as app, Mark, NotRun, RunCheck, ORDER};
use serde::Serialize;
use std::collections::{BTreeMap, HashMap};
use std::path::{Path, PathBuf};
use std::time::Instant;

pub const PREREG: &str = include_str!("../../../reference/point-check-app-acceptance.json");
pub const PREREG_PATH: &str = "reference/point-check-app-acceptance.json";
pub const VERSION: &str = "stage-a-acceptance/1";

/// The film width handed to `score_run` for A4's mirror, `x' = (W − 1) − x` (Ceph-400's films are 1935 px wide). The
/// mirror is undone inside `score_run` with the same width, so any width serves; the cache does not carry it.
pub const FILM_W: u32 = 1935;
/// A4's tolerance on numbers (ids and order are exact).
pub const A4_REL: f64 = 1e-12;

/// A2's expected counts, as written in the pre-registration's A2 (a test reads each back out of that text).
#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
pub struct Expected {
    pub g1_pooled: (usize, usize), pub lowest: (&'static str, usize, usize), pub g2: (usize, usize), pub g3: (usize, usize),
    pub nasion: (usize, usize), pub unplanted: (usize, usize), pub b: (usize, usize), pub jaw: (usize, usize),
}
pub const A2: Expected = Expected { g1_pooled: (4274, 4500), lowest: ("Po", 273, 300), g2: (0, 3229), g3: (0, 380),
    nasion: (10, 10), unplanted: (2, 10), b: (299, 300), jaw: (25, 5700) };

/// The app's check as the driver calls it: `score_run` in the real run. A test hands in another to prove A3 and A4
/// can fail.
pub type AppScore = dyn Fn(&app::ShapeScorer, &[Mark], bool, u32) -> anyhow::Result<RunCheck> + Sync;
pub fn production(s: &app::ShapeScorer, m: &[Mark], facing_left: bool, w: u32) -> anyhow::Result<RunCheck> { app::score_run(s, m, facing_left, w) }

/// What one side decided on one case, comparable to the bit: not run, the film flagged, the points flagged worst first
/// with each tail's bit pattern.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Seen { pub not_run: bool, pub film_unusual: bool, pub flagged: Vec<(String, u64)> }
impl Seen { pub fn is_flagged(&self, id: &str) -> bool { self.flagged.iter().any(|(p, _)| p == id) } }

pub fn seen_bench(o: &Outcome) -> anyhow::Result<Seen> {
    anyhow::ensure!(o.moved.is_none() && o.reassessed.is_empty(), "the bench's flag-only check moved or re-assessed a point: {o:?}");
    Ok(Seen { not_run: o.not_run, film_unusual: o.film_unusual, flagged: o.flagged.iter().map(|(k, t)| (ORDER[*k].to_string(), t.to_bits())).collect() })
}
pub fn seen_app(r: &RunCheck) -> anyhow::Result<Seen> {
    let pts = |f: &[app::PointFlag]| f.iter().map(|x| (x.landmark_id.clone(), x.tail.to_bits())).collect();
    Ok(match r {
        RunCheck::Clean { .. } => Seen::default(),
        RunCheck::Flagged { flags } => Seen { flagged: pts(flags), ..Default::default() },
        RunCheck::FilmUnusual { flags } => Seen { film_unusual: true, flagged: pts(flags), ..Default::default() },
        RunCheck::NotRun { reason: NotRun::TooFewPoints { .. } } => Seen { not_run: true, ..Default::default() },
        RunCheck::NotRun { reason: NotRun::NotSetUp } => anyhow::bail!("the app's check says not set up, with a scorer in hand"),
    })
}

/// A tracing (None: the point was not found) as the app's marks, in `ORDER`.
pub fn marks(pts: &[Option<Pt>]) -> Vec<Mark> {
    ORDER.iter().zip(pts).filter_map(|(id, p)| p.map(|q| Mark { landmark_id: id.to_string(), x: q.0, y: q.1 })).collect()
}
fn all(pts: &[Pt]) -> Vec<Option<Pt>> { pts.iter().map(|p| Some(*p)).collect() }
fn mirror(pts: &[Option<Pt>], w: u32) -> Vec<Option<Pt>> { pts.iter().map(|p| p.map(|q| ((w as f64 - 1.0) - q.0, q.1))).collect() }

/// The bench's outcome on one tracing: FT-2b's `flag_only` when all 19 are present; with points missing (the synthetic
/// edge cases only), the same call `flag_only` makes, `check` with no candidate spot and a move line of 0.
pub fn bench_outcome(s: &crate::pointcheck::ShapeScorer, pts: &[Option<Pt>], l: &Lines) -> anyhow::Result<Outcome> {
    if pts.iter().all(Option::is_some) { return flag_only(s, &pts.iter().map(|p| p.unwrap()).collect::<Vec<_>>(), l); }
    let none = vec![vec![]; pts.len()];
    crate::pointcheck::check(s, pts, &none, &Lines { mv: 0.0, ..*l })
}

/// One case's kind: Aariz's own run, the experts' tracing, a G1 plant (point, distance index), or a control.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Kind { Aariz, Expert, Plant { k: usize, di: usize }, Jaw, BAlone, Nasion }
impl Kind {
    pub fn label(&self, p: &Ft2bPrereg) -> String {
        match self {
            Kind::Aariz => "aariz".into(), Kind::Expert => "expert".into(), Kind::Jaw => "jaw".into(), Kind::BAlone => "b-alone".into(),
            Kind::Nasion => "nasion".into(),
            Kind::Plant { k, di } => format!("plant-{}-{}mm", ORDER[*k], p.g1_distances_mm[*di]),
        }
    }
}

/// Every case FT-2b scores on one film, built exactly as `ft2b::film_b` builds it (same expressions, same seeds).
pub fn cases(f: &SpotFilm, truth: &[Pt], fold: usize, pos: usize, p: &Ft2bPrereg) -> Vec<(Kind, Vec<Pt>)> {
    let mm = f.mm_per_px;
    let px = |v: f64| v / mm;
    let mut v = vec![(Kind::Aariz, f.aariz.clone()), (Kind::Expert, truth.to_vec())];
    for k in 0..19 {
        for (di, d) in p.g1_distances_mm.iter().enumerate() {
            let (ux, uy) = direction(&mut case_rng(p.seed, &[1, fold as u64, pos as u64, k as u64, di as u64]));
            let mut t = f.aariz.clone();
            t[k] = (t[k].0 + ux * px(*d), t[k].1 + uy * px(*d));
            v.push((Kind::Plant { k, di }, t));
        }
    }
    let mut jaw = truth.to_vec();
    for n in &p.control_jaw { jaw[idx(n)].0 += px(p.control_jaw_forward_mm); }
    v.push((Kind::Jaw, jaw));
    let mut bt = truth.to_vec();
    bt[idx("B")].0 += px(p.control_b_forward_mm);
    v.push((Kind::BAlone, bt));
    if is_control(fold, pos, p) { v.push((Kind::Nasion, nasion_at(f, pos, p.control_nasion_mm, p))); }
    v
}
/// FT-2b's nasion control film: fold 0, one of its first `controlNasionFilms`.
pub fn is_control(fold: usize, pos: usize, p: &Ft2bPrereg) -> bool { fold == 0 && pos < p.control_nasion_films }
/// Aariz's run with nasion moved `mm` along the control's direction (`case_rng(seed, [2, pos])`, as `film_b`).
fn nasion_at(f: &SpotFilm, pos: usize, mm: f64, p: &Ft2bPrereg) -> Vec<Pt> {
    let n = idx("N");
    let (ux, uy) = direction(&mut case_rng(p.seed, &[2, pos as u64]));
    let d = mm / f.mm_per_px;
    let mut t = f.aariz.clone();
    t[n] = (t[n].0 + ux * d, t[n].1 + uy * d);
    t
}

/// One case, both sides. On a control film the app's own result, its mirror (A4) and the tracing (A5) are kept.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaseResult {
    pub film: usize, pub fold: usize, pub pos: usize, pub kind: Kind, pub bench: Seen, pub app: Seen,
    #[serde(skip)] pub rc: Option<RunCheck>, #[serde(skip)] pub mirrored: Option<RunCheck>, #[serde(skip)] pub pts: Option<Vec<Pt>>,
}

/// Both sides on every case of every film, fold by fold, plus the app's nasion at 10 mm on each control film
/// (information, ruling OQ-4; not an A3 case).
pub struct Compared { pub cases: Vec<CaseResult>, pub nasion10_control: Count, pub fold_train: Vec<usize> }

pub fn compare(films: &[SpotFilm], truth: &BTreeMap<String, Vec<Pt>>, p: &Ft2bPrereg, score: &AppScore) -> anyhow::Result<Compared> {
    let folds = crate::ft2::fold_split(films, p.folds, p.fold_seed);     // FT-2b's folds: FT-2's seed
    let l = p.lines();
    let fold_ids: Vec<usize> = (0..p.folds).collect();
    let per_fold: Vec<anyhow::Result<(Vec<CaseResult>, Count, usize)>> = par_map(&fold_ids, |&f| {
        let test = &folds[f];
        // FT-2b's training set, in FT-2b's order (`run_ft2b`): the other folds in fold order, each as `fold_split` cut it.
        let train: Vec<usize> = folds.iter().enumerate().filter(|(g, _)| *g != f).flat_map(|(_, v)| v.clone()).collect();
        let names = |v: &[usize]| v.iter().map(|&i| films[i].film.clone()).collect::<Vec<_>>();
        no_homework(&names(&train), &names(test))?;
        let tracings: Vec<Vec<Pt>> = train.iter().map(|&i| truth[&films[i].film].clone()).collect();
        let bench = crate::pointcheck::ShapeScorer::new(tracings.clone());
        let mine = app::ShapeScorer::new(tracings);
        let (mut out, mut n10) = (vec![], Count::default());
        for (pos, &i) in test.iter().enumerate() {
            let t = &truth[&films[i].film];
            let control = is_control(f, pos, p);
            for (kind, pts) in cases(&films[i], t, f, pos, p) {
                let o = all(&pts);
                let b = seen_bench(&bench_outcome(&bench, &o, &l)?)?;
                let rc = score(&mine, &marks(&o), false, FILM_W)?;
                let a = seen_app(&rc)?;
                let mirrored = if control { Some(score(&mine, &marks(&mirror(&o, FILM_W)), true, FILM_W)?) } else { None };
                out.push(CaseResult { film: i, fold: f, pos, kind, bench: b, app: a, rc: control.then_some(rc), mirrored, pts: control.then_some(pts) });
            }
            if control {
                let rc = score(&mine, &marks(&all(&nasion_at(&films[i], pos, 10.0, p))), false, FILM_W)?;
                n10.add(seen_app(&rc)?.is_flagged("N"));
            }
        }
        Ok((out, n10, train.len()))
    });
    let mut c = Compared { cases: vec![], nasion10_control: Count::default(), fold_train: vec![] };
    for r in per_fold {
        let (v, n10, tr) = r?;
        c.cases.extend(v);
        c.nasion10_control.of += n10.of; c.nasion10_control.hit += n10.hit;
        c.fold_train.push(tr);
    }
    if c.nasion10_control.of > 0 { c.nasion10_control.share = c.nasion10_control.hit as f64 / c.nasion10_control.of as f64; }
    Ok(c)
}

/// How many cases each film has (Aariz, experts, every plant, jaw, B), and the control films' nasion on top.
pub fn expected_cases(n: usize, p: &Ft2bPrereg) -> usize { n * (2 + 19 * p.g1_distances_mm.len() + 2) + p.control_nasion_films }

/// A3: every case compared; the count of mismatches, with the first few described (no film name, no coordinate).
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct A3 { pub compared: usize, pub flagged: usize, pub not_run: usize, pub mismatched: usize, pub same_flags_tails_differ: usize, pub first: Vec<String> }
pub fn a3(cases: &[CaseResult], want: usize, p: &Ft2bPrereg) -> anyhow::Result<A3> {
    let mut r = A3::default();
    for c in cases {
        r.compared += 1;
        r.flagged += !c.bench.flagged.is_empty() as usize;
        r.not_run += c.bench.not_run as usize;
        if c.bench != c.app {
            r.mismatched += 1;
            let ids = |s: &Seen| s.flagged.iter().map(|(id, _)| id.clone()).collect::<Vec<_>>();
            let same_ids = ids(&c.bench) == ids(&c.app) && c.bench.film_unusual == c.app.film_unusual && c.bench.not_run == c.app.not_run;
            r.same_flags_tails_differ += same_ids as usize;
            if r.first.len() < 20 {
                r.first.push(format!("fold {} pos {} {}: bench {:?}{}, app {:?}{}{}", c.fold, c.pos, c.kind.label(p), ids(&c.bench),
                    if c.bench.film_unusual { " film-unusual" } else { "" }, ids(&c.app), if c.app.film_unusual { " film-unusual" } else { "" },
                    if same_ids { " (same points, tails differ in the last bits)" } else { "" }));
            }
        }
    }
    counted("A3 cases compared", r.compared, want)?;
    anyhow::ensure!(r.flagged > 0, "A3 compared no flagged case: nothing was analysed; refusing to report");
    Ok(r)
}

/// A1 and A2: FT-2b's counts made from the app's outcomes, judged by FT-2b's own `decide` (its marks and controls).
pub fn app_report(bench: &Ft2bReport, films: &[SpotFilm], truth: &BTreeMap<String, Vec<Pt>>, cases: &[CaseResult], p: &Ft2bPrereg) -> anyhow::Result<Ft2bReport> {
    let at: HashMap<(usize, Kind), &CaseResult> = cases.iter().map(|c| ((c.film, c.kind), c)).collect();
    let get = |i: usize, k: Kind| at.get(&(i, k)).copied().ok_or_else(|| anyhow::anyhow!("no {k:?} case for film {i}"));
    let mut r = bench.clone();
    r.g1 = BTreeMap::new();
    r.g2_flagged = Count::default(); r.g2_gonion = Count::default(); r.g3_flagged = Count::default(); r.g3_films = vec![];
    r.control_nasion = Count::default(); r.control_nasion_unplanted = Count::default(); r.control_b = Count::default(); r.control_jaw = Count::default();
    r.moves = 0;
    let go = idx("Go");
    for (i, f) in films.iter().enumerate() {
        let t = &truth[&f.film];
        let base = &get(i, Kind::Aariz)?.app;
        for k in 0..19 {
            if dist(f.aariz[k], t[k]) * f.mm_per_px <= p.g2_within_mm {
                r.g2_flagged.add(base.is_flagged(ORDER[k]));
                if k == go { r.g2_gonion.add(base.is_flagged(ORDER[k])); }
            }
            for di in 0..p.g1_distances_mm.len() {
                r.g1.entry(ORDER[k].to_string()).or_insert_with(|| vec![Count::default(); p.g1_distances_mm.len()])[di]
                    .add(get(i, Kind::Plant { k, di })?.app.is_flagged(ORDER[k]));
            }
            r.control_jaw.add(get(i, Kind::Jaw)?.app.is_flagged(ORDER[k]));
        }
        r.control_b.add(get(i, Kind::BAlone)?.app.is_flagged("B"));
        if let Some(c) = at.get(&(i, Kind::Nasion)) {
            r.control_nasion.add(c.app.is_flagged("N"));
            r.control_nasion_unplanted.add(base.is_flagged("N"));
        }
    }
    let mut by_anb: Vec<(f64, usize)> = (0..films.len()).map(|i| (anb_deg(&truth[&films[i].film]), i)).collect();
    by_anb.sort_by(|a, c| a.0.total_cmp(&c.0).then(films[a.1].film.cmp(&films[c.1].film)));
    let e = p.g3_extreme_films;
    for (_, i) in by_anb.iter().take(e).chain(by_anb.iter().rev().take(e)) {
        r.g3_films.push(films[*i].film.clone());
        let x = &get(*i, Kind::Expert)?.app;
        for id in ORDER { r.g3_flagged.add(x.is_flagged(id)); }
    }
    anyhow::ensure!(r.g3_films == bench.g3_films, "the app side chose other extreme-ANB films than FT-2b");
    let n = films.len();
    counted("app: G1 plants", r.g1.values().flatten().map(|c| c.of).sum(), n * 19 * p.g1_distances_mm.len())?;
    counted("app: G3 extreme-ANB expert points", r.g3_flagged.of, 2 * e * 19)?;
    counted("app: jaw control points", r.control_jaw.of, n * 19)?;
    counted("app: B-alone control films", r.control_b.of, n)?;
    counted("app: nasion control films", r.control_nasion.of, p.control_nasion_films)?;
    crate::ft2b::decide(&mut r, p)?;
    Ok(r)
}

/// The lowest point at the deciding distance, Gonion (no mark of its own) left out: (point, hit, of).
pub fn lowest(r: &Ft2bReport, p: &Ft2bPrereg) -> anyhow::Result<(String, usize, usize)> {
    let d = p.g1_distances_mm.iter().position(|x| *x == p.g1_decide_mm).ok_or_else(|| anyhow::anyhow!("no deciding distance"))?;
    p.g1_pooled.iter().filter(|id| !p.g1_per_point_except.contains(id)).filter_map(|id| r.g1.get(id).map(|v| (id.clone(), v[d].hit, v[d].of)))
        .min_by(|a, b| (a.1 as f64 / a.2 as f64).total_cmp(&(b.1 as f64 / b.2 as f64)).then(a.0.cmp(&b.0)))
        .ok_or_else(|| anyhow::anyhow!("G1 has no point at {} mm: nothing analysed", p.g1_decide_mm))
}

/// A2: each of the report's counts against `want`, one line each.
pub fn a2(r: &Ft2bReport, p: &Ft2bPrereg, want: &Expected) -> anyhow::Result<(bool, Vec<String>)> {
    let lo = lowest(r, p)?;
    let rows: Vec<(&str, (usize, usize), (usize, usize))> = vec![
        ("G1 pooled", (r.g1_pooled.hit, r.g1_pooled.of), want.g1_pooled),
        ("G2", (r.g2_flagged.hit, r.g2_flagged.of), want.g2),
        ("G3", (r.g3_flagged.hit, r.g3_flagged.of), want.g3),
        ("nasion", (r.control_nasion.hit, r.control_nasion.of), want.nasion),
        ("unplanted", (r.control_nasion_unplanted.hit, r.control_nasion_unplanted.of), want.unplanted),
        ("B", (r.control_b.hit, r.control_b.of), want.b),
        ("jaw", (r.control_jaw.hit, r.control_jaw.of), want.jaw),
    ];
    let mut ok = lo.0 == want.lowest.0 && (lo.1, lo.2) == (want.lowest.1, want.lowest.2);
    let mut lines = vec![format!("lowest {} {}/{} (expected {} {}/{}) {}", lo.0, lo.1, lo.2, want.lowest.0, want.lowest.1, want.lowest.2, if ok { "equal" } else { "DIFFERS" })];
    for (name, got, w) in rows {
        let eq = got == w;
        ok &= eq;
        lines.push(format!("{name} {}/{} (expected {}/{}) {}", got.0, got.1, w.0, w.1, if eq { "equal" } else { "DIFFERS" }));
    }
    Ok((ok, lines))
}

fn close(a: f64, b: f64) -> bool { a == b || (a - b).abs() <= A4_REL * a.abs().max(b.abs()) }
/// A4 on one case: `m` is the mirrored film's result (film coordinates of the mirrored film). Same outcome, same points
/// in the same order, exactly; tails, centres and rings within 1e-12 relative, the mirror undone.
pub fn same_mirrored(a: &RunCheck, m: &RunCheck, w: u32) -> Result<(), String> {
    let back = |x: f64| (w as f64 - 1.0) - x;
    let flags = |x: &[app::PointFlag], y: &[app::PointFlag]| -> Result<(), String> {
        let ids = |v: &[app::PointFlag]| v.iter().map(|f| f.landmark_id.clone()).collect::<Vec<_>>();
        if ids(x) != ids(y) { return Err(format!("points {:?} unmirrored, {:?} mirrored", ids(x), ids(y))); }
        for (f, g) in x.iter().zip(y) {
            let pairs = [("tail", f.tail, g.tail), ("off", f.off_px, g.off_px), ("expected x", f.expected_x, back(g.expected_x)),
                ("expected y", f.expected_y, g.expected_y), ("ring cx", f.ring.cx, back(g.ring.cx)), ("ring cy", f.ring.cy, g.ring.cy),
                ("ring rx", f.ring.rx, g.ring.rx), ("ring ry", f.ring.ry, g.ring.ry), ("ring angle", f.ring.angle_deg, -g.ring.angle_deg)];
            for (what, u, v) in pairs { if !close(u, v) { return Err(format!("{} {what}: {u:e} unmirrored, {v:e} mirrored back", f.landmark_id)); } }
        }
        Ok(())
    };
    match (a, m) {
        (RunCheck::Clean { present: x }, RunCheck::Clean { present: y }) if x == y => Ok(()),
        (RunCheck::NotRun { reason: x }, RunCheck::NotRun { reason: y }) if x == y => Ok(()),
        (RunCheck::Flagged { flags: x }, RunCheck::Flagged { flags: y }) => flags(x, y),
        (RunCheck::FilmUnusual { flags: x }, RunCheck::FilmUnusual { flags: y }) => flags(x, y),
        _ => Err(format!("outcome {} unmirrored, {} mirrored", kind_of(a), kind_of(m))),
    }
}
fn kind_of(r: &RunCheck) -> &'static str {
    match r { RunCheck::Clean { .. } => "clean", RunCheck::Flagged { .. } => "flagged", RunCheck::FilmUnusual { .. } => "film-unusual", RunCheck::NotRun { .. } => "not-run" }
}

#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Agreement { pub compared: usize, pub flagged: usize, pub differ: usize, pub first: Vec<String> }

/// A4 over the control films' cases.
pub fn a4(cases: &[CaseResult], want: usize, p: &Ft2bPrereg) -> anyhow::Result<Agreement> {
    let mut r = Agreement::default();
    for c in cases.iter().filter(|c| c.rc.is_some()) {
        let (a, m) = (c.rc.as_ref().unwrap(), c.mirrored.as_ref().ok_or_else(|| anyhow::anyhow!("a control case without its mirror"))?);
        r.compared += 1;
        r.flagged += !matches!(a, RunCheck::Clean { .. } | RunCheck::NotRun { .. }) as usize;
        if let Err(e) = same_mirrored(a, m, FILM_W) {
            r.differ += 1;
            if r.first.len() < 20 { r.first.push(format!("fold {} pos {} {}: {e}", c.fold, c.pos, c.kind.label(p))); }
        }
    }
    counted("A4 control-film cases mirrored", r.compared, want)?;
    anyhow::ensure!(r.flagged > 0, "A4 compared no flagged case: nothing was analysed; refusing to report");
    Ok(r)
}

/// Two stored records equal to the bit (every number compared by its bit pattern, never by `==`).
pub fn same_record(a: &ceph_store::PointCheckRecord, b: &ceph_store::PointCheckRecord) -> Result<(), String> {
    let bits = |v: Option<f64>| v.map(f64::to_bits);
    let key = |r: &ceph_store::PointCheckRecord| (r.run_id, r.rule_version.clone(), r.prior_sha256.clone(), r.prior_films, r.outcome.clone(), r.not_run_reason.clone(), r.present, r.flags.len());
    if key(a) != key(b) { return Err(format!("{:?} written, {:?} read back", key(a), key(b))); }
    for (f, g) in a.flags.iter().zip(&b.flags) {
        let k = |x: &ceph_store::PointCheckFlag| (x.landmark_id.clone(), x.action.clone(), x.points.clone(), bits(x.tail), bits(x.off_px), bits(x.expected_x),
            bits(x.expected_y), bits(x.ring_rx), bits(x.ring_ry), bits(x.ring_angle_deg));
        if k(f) != k(g) { return Err(format!("flag {:?} written, {:?} read back", k(f), k(g))); }
    }
    Ok(())
}

/// A stored record read back, judged directly against `score_run`'s result: the outcome word, `present`, and for a
/// flagged run every point's id, tail, distance, centre and ring to the bit, in order; for a film flagged as unusual
/// the one film row naming the points in order. Independent of the mapping, so a mapping that drops or swaps a field
/// fails here.
pub fn against_score_run(got: &ceph_store::PointCheckRecord, rc: &RunCheck, pts: &[Pt]) -> Result<(), String> {
    let n = pts.len() as i64;
    let b = |v: Option<f64>| v.map(f64::to_bits);
    let want: (&str, Option<i64>, Vec<String>) = match rc {
        RunCheck::Clean { present } => ("clean", Some(*present as i64), vec![]),
        RunCheck::Flagged { flags } => ("flagged", Some(n), flags.iter().map(|f| format!("{}|flagged|{:?}", f.landmark_id,
            [b(Some(f.tail)), b(Some(f.off_px)), b(Some(f.expected_x)), b(Some(f.expected_y)), b(Some(f.ring.rx)), b(Some(f.ring.ry)), b(Some(f.ring.angle_deg))])).collect()),
        RunCheck::FilmUnusual { flags } => ("film-unusual", Some(n), vec![format!("-|film-unusual|{}", flags.iter().map(|f| f.landmark_id.as_str()).collect::<Vec<_>>().join(","))]),
        RunCheck::NotRun { reason: NotRun::TooFewPoints { present } } => ("not-run", Some(*present as i64), vec![]),
        RunCheck::NotRun { reason: NotRun::NotSetUp } => ("not-run", None, vec![]),
    };
    let rows: Vec<String> = got.flags.iter().map(|f| match &f.landmark_id {
        Some(id) => format!("{id}|{}|{:?}", f.action, [b(f.tail), b(f.off_px), b(f.expected_x), b(f.expected_y), b(f.ring_rx), b(f.ring_ry), b(f.ring_angle_deg)]),
        None => format!("-|{}|{}", f.action, f.points.clone().unwrap_or_default()),
    }).collect();
    if (got.outcome.as_str(), got.present, &rows) != (want.0, want.1, &want.2) {
        return Err(format!("stored {} present {:?} {rows:?}; score_run gave {} present {:?} {:?}", got.outcome, got.present, want.0, want.1, want.2));
    }
    Ok(())
}
fn pts_of(c: &CaseResult) -> anyhow::Result<&[Pt]> { c.pts.as_deref().ok_or_else(|| anyhow::anyhow!("a control case without its tracing")) }

/// A5: the control films' outcomes written to a new library in `dir` (one SYNTHETIC image per film, one model run per
/// case), the library closed and opened again, every record read back and compared to the bit with what was written,
/// and each read-back point record with the app's own result. `tamper` (tests only) changes one value after the
/// reopen, to show the comparison can fail.
pub fn a5(cases: &[CaseResult], fold_train: &[usize], dir: &Path, want: usize, p: &Ft2bPrereg, tamper: bool) -> anyhow::Result<Agreement> {
    let control: Vec<&CaseResult> = cases.iter().filter(|c| c.rc.is_some()).collect();
    let prior = crate::ft_common::sha256_hex(VERSION.as_bytes());
    let mut written: Vec<(String, String, ceph_store::PointCheckRecord, &CaseResult)> = vec![];
    {
        let mut lib = ceph_store::Library::open(dir)?;
        let mut film_case: BTreeMap<usize, String> = BTreeMap::new();
        for c in &control {
            if !film_case.contains_key(&c.film) {
                let png = dir.join(format!("SYNTHETIC-acceptance-{:03}.png", film_case.len()));
                let mut img = image::GrayImage::new(8, 8);
                img.put_pixel(0, 0, image::Luma([film_case.len() as u8 + 1]));      // one image per film (no de-duplication)
                img.save(&png)?;
                film_case.insert(c.film, lib.import(&png)?.case_id);
            }
            let case_id = film_case[&c.film].clone();
            let model = format!("acceptance-{}", c.kind.label(p));
            let pts = c.pts.as_ref().ok_or_else(|| anyhow::anyhow!("a control case without its tracing"))?;
            let ai: Vec<ceph_store::AiPoint> = ORDER.iter().zip(pts).enumerate()
                .map(|(i, (id, q))| ceph_store::AiPoint { channel: i as u32, landmark_id: Some(id.to_string()), x: q.0, y: q.1, peak: 1.0 }).collect();
            let run_id = lib.record_ai_run(&case_id, &ceph_store::AiRun { model_id: model.clone(), execution_provider: "cpu".into(), facing: "right".into(),
                total_ms: 0.0, model_sha256: None }, &ai)?;
            // The app's own mapping (`ceph_store::point_check_record`, the one the desktop calls), with what the app
            // would give it for this run: the tracings the rings were fitted from (this fold's) and the run's marks.
            let films = *fold_train.get(c.fold).ok_or_else(|| anyhow::anyhow!("no training count for fold {}", c.fold))? as i64;
            let rec = ceph_store::point_check_record(run_id, &prior, films, &marks(&all(pts)), c.rc.as_ref().unwrap());
            anyhow::ensure!(lib.record_point_check(&case_id, &rec)?, "the library had already recorded run {run_id}");
            written.push((case_id, model, rec, c));
        }
    }                                                                   // closed
    let lib = ceph_store::Library::open(dir)?;                          // and opened again
    let mut back: HashMap<(String, String), ceph_store::PointCheckRecord> = HashMap::new();
    for case_id in written.iter().map(|w| w.0.clone()).collect::<std::collections::BTreeSet<_>>() {
        for (m, r) in lib.point_check_runs(&case_id)? { back.insert((case_id.clone(), m), r); }
    }
    let mut r = Agreement::default();
    for (case_id, model, rec, c) in &written {
        r.compared += 1;
        r.flagged += !rec.flags.is_empty() as usize;
        let mut got = back.remove(&(case_id.clone(), model.clone())).ok_or_else(|| anyhow::anyhow!("{model}: not read back after reopening"))?;
        if tamper && r.compared == 1 { got.present = got.present.map(|x| x - 1); }
        let mut why = same_record(rec, &got).err();
        // And against the app's own result, field by field, whatever the outcome (never through the mapping).
        if why.is_none() { why = against_score_run(&got, c.rc.as_ref().unwrap(), pts_of(c)?).err(); }
        if let Some(e) = why {
            r.differ += 1;
            if r.first.len() < 20 { r.first.push(format!("fold {} pos {} {}: {e}", c.fold, c.pos, c.kind.label(p))); }
        }
    }
    anyhow::ensure!(back.is_empty(), "{} records read back that were never written", back.len());
    counted("A5 control-film records read back", r.compared, want)?;
    anyhow::ensure!(r.flagged > 0, "A5 wrote no flagged record: nothing was analysed; refusing to report");
    Ok(r)
}

/// The starting-knowledge file's own rings (all 300 tracings, the scorer the app ships): G2 and G3 on it (information),
/// whether its tracings are the caches' films in the caches' order to the bit, and how long one `score_run` takes.
#[derive(Clone, Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PriorInfo {
    pub films: usize, pub same_order_as_caches: bool, pub same_set_as_caches: bool, pub g2_flagged: Count, pub g3_flagged: Count,
    pub cold_ms: Vec<f64>, pub warm_ms: Vec<f64>, pub all_aariz_runs_ms: f64,
}
pub fn prior_info(tracings: &[Vec<Pt>], films: &[SpotFilm], truth: &BTreeMap<String, Vec<Pt>>, g3_films: &[String], p: &Ft2bPrereg, timed: usize) -> anyhow::Result<PriorInfo> {
    let in_order: Vec<&Vec<Pt>> = films.iter().map(|f| &truth[&f.film]).collect();
    let bits = |t: &Vec<Pt>| t.iter().flat_map(|q| [q.0.to_bits(), q.1.to_bits()]).collect::<Vec<u64>>();
    let same_order = tracings.len() == in_order.len() && tracings.iter().zip(&in_order).all(|(a, b)| bits(a) == bits(b));
    let (mut x, mut y): (Vec<Vec<u64>>, Vec<Vec<u64>>) = (tracings.iter().map(bits).collect(), in_order.iter().map(|t| bits(t)).collect());
    x.sort(); y.sort();
    let mut r = PriorInfo { films: tracings.len(), same_order_as_caches: same_order, same_set_as_caches: x == y, ..Default::default() };
    for f in films.iter().take(timed) {
        let s = app::ShapeScorer::new(tracings.to_vec());
        let m = marks(&all(&f.aariz));
        let t = Instant::now(); app::score_run(&s, &m, false, FILM_W)?; r.cold_ms.push(t.elapsed().as_secs_f64() * 1e3);
        let t = Instant::now(); app::score_run(&s, &m, false, FILM_W)?; r.warm_ms.push(t.elapsed().as_secs_f64() * 1e3);
    }
    let s = app::ShapeScorer::new(tracings.to_vec());
    let t = Instant::now();
    for f in films {
        let tr = &truth[&f.film];
        let seen = seen_app(&app::score_run(&s, &marks(&all(&f.aariz)), false, FILM_W)?)?;
        for k in 0..19 { if dist(f.aariz[k], tr[k]) * f.mm_per_px <= p.g2_within_mm { r.g2_flagged.add(seen.is_flagged(ORDER[k])); } }
    }
    r.all_aariz_runs_ms = t.elapsed().as_secs_f64() * 1e3;
    for name in g3_films {
        let seen = seen_app(&app::score_run(&s, &marks(&all(&truth[name])), false, FILM_W)?)?;
        for id in ORDER { r.g3_flagged.add(seen.is_flagged(id)); }
    }
    Ok(r)
}

pub const PASS: &str = "pass: A1-A5 hold";
pub const FAIL: &str = "fail: the controls hold but A1-A5 do not; back to the owner";
pub const BROKEN: &str = "broken: a control did not hold; nothing is concluded";
pub fn verdict(controls: bool, marks: bool) -> &'static str { if !controls { BROKEN } else if !marks { FAIL } else { PASS } }
/// 0 pass, 3 fail, 1 broken (and 1 for any error before a verdict).
pub fn exit_code(v: &str) -> i32 { if v == PASS { 0 } else if v == FAIL { 3 } else { 1 } }

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Acceptance {
    pub version: String, pub label: String, pub films: usize, pub fold_train: Vec<usize>,
    /// The commit the run was built and run at (the tree is refused when dirty), the pre-registration's SHA-256 and the
    /// starting-knowledge file's SHA-256: set by `run_cli`, so the result is bound to what produced it.
    pub git_sha: String, pub prereg_sha256: String, pub prior_sha256: String,
    pub bench_verdict: String, pub bench_controls_held: bool, pub app_controls_held: bool,
    pub a1: bool, pub a1_lines: Vec<String>, pub a2: bool, pub a2_bench: Vec<String>, pub a2_app: Vec<String>,
    pub a3: A3, pub a3_pass: bool, pub a4: Agreement, pub a4_pass: bool, pub a5: Agreement, pub a5_pass: bool,
    pub nasion10_control: Count, pub nasion10_pooled: Count, pub prior: Option<PriorInfo>,
    pub seconds_bench: f64, pub seconds_app: f64, pub verdict: String,
    #[serde(skip)] pub app_report: Option<Ft2bReport>,
}
impl Acceptance { pub fn exit_code(&self) -> i32 { exit_code(&self.verdict) } }

/// The whole acceptance on these films: FT-2b (the bench), the app on the same cases, A1-A5. `lib_dir` is a new empty
/// folder for A5's library. `prior` is the starting-knowledge file's tracings (information and timing only).
pub fn accept(films: &[SpotFilm], truth: &BTreeMap<String, Vec<Pt>>, p: &Ft2bPrereg, score: &AppScore, lib_dir: &Path, prior: Option<&[Vec<Pt>]>) -> anyhow::Result<Acceptance> {
    let t0 = Instant::now();
    let bench = crate::ft2b::run_ft2b(films, truth, p)?;
    let t1 = Instant::now();
    let c = compare(films, truth, p, score)?;
    let seconds_app = t1.elapsed().as_secs_f64();
    let n = films.len();
    let a3 = a3(&c.cases, expected_cases(n, p), p)?;
    let per_film = 2 + 19 * p.g1_distances_mm.len() + 2 + 1;
    let a4 = a4(&c.cases, p.control_nasion_films * per_film, p)?;
    let a5 = a5(&c.cases, &c.fold_train, lib_dir, p.control_nasion_films * per_film, p, false)?;
    let ar = app_report(&bench, films, truth, &c.cases, p)?;
    let (a2b, a2_bench) = a2(&bench, p, &A2)?;
    let (a2a, a2_app) = a2(&ar, p, &A2)?;
    let a1 = ar.g1_pooled_pass && ar.g1_each_pass && ar.g2_pass && ar.g3_pass;
    let pf = |b: bool| if b { "PASS" } else { "FAIL" };
    let a1_lines = vec![
        format!("G1 pooled at {} mm {}/{} = {:.4} (>= {}) {}", p.g1_decide_mm, ar.g1_pooled.hit, ar.g1_pooled.of, ar.g1_pooled.share, p.g1_pooled_flagged_min, pf(ar.g1_pooled_pass)),
        format!("G1 each point but {} (>= {}) {}{}", p.g1_per_point_except.join(", "), p.g1_per_point_flagged_min, pf(ar.g1_each_pass),
            if ar.g1_below_mark.is_empty() { String::new() } else { format!(": below {}", ar.g1_below_mark.join(", ")) }),
        format!("G2 {}/{} (<= {}) {}", ar.g2_flagged.hit, ar.g2_flagged.of, p.g2_flagged_max, pf(ar.g2_pass)),
        format!("G3 {}/{} (<= {}) {}", ar.g3_flagged.hit, ar.g3_flagged.of, p.g3_flagged_max, pf(ar.g3_pass)),
    ];
    let nasion10_pooled = ar.g1.get("N").map(|v| v[0].clone()).unwrap_or_default();
    let prior = prior.map(|t| prior_info(t, films, truth, &bench.g3_films, p, 10)).transpose()?;
    let (a3p, a4p, a5p) = (a3.mismatched == 0, a4.differ == 0, a5.differ == 0);
    let controls = bench.controls_held && ar.controls_held;
    let v = verdict(controls, a1 && a2b && a2a && a3p && a4p && a5p);
    Ok(Acceptance { version: VERSION.into(), label: "a reproduction through the app's code (same 300 films, same folds and plants as FT-2b); not a fresh test".into(),
        films: n, fold_train: c.fold_train, git_sha: String::new(), prereg_sha256: crate::ft_common::sha256_hex(PREREG.as_bytes()), prior_sha256: String::new(), bench_verdict: bench.verdict.clone(), bench_controls_held: bench.controls_held, app_controls_held: ar.controls_held,
        a1, a1_lines, a2: a2b && a2a, a2_bench, a2_app, a3, a3_pass: a3p, a4, a4_pass: a4p, a5, a5_pass: a5p,
        nasion10_control: c.nasion10_control, nasion10_pooled, prior, seconds_bench: (t1 - t0).as_secs_f64(), seconds_app, verdict: v.into(), app_report: Some(ar) })
}

impl Acceptance {
    pub fn summary(&self) -> String {
        let pf = |b: bool| if b { "PASS" } else { "FAIL" };
        let mut s = format!("Stage A acceptance ({}): {}; {} films; fold training sets {:?}\n", self.version, self.label, self.films, self.fold_train);
        s += &format!("git HEAD {}; pre-registration {PREREG_PATH} sha256 {}; starting-knowledge file sha256 {}\n", self.git_sha, self.prereg_sha256, self.prior_sha256);
        s += &format!("bench FT-2b verdict: {} (controls {})\n", self.bench_verdict, if self.bench_controls_held { "held" } else { "BROKEN" });
        s += &format!("app controls (FT-2b's, on the app's outcomes): {}\n", if self.app_controls_held { "held" } else { "BROKEN" });
        for l in &self.a1_lines { s += &format!("A1 {l}\n"); }
        s += &format!("A1 {}\n", pf(self.a1));
        for l in &self.a2_bench { s += &format!("A2 bench {l}\n"); }
        for l in &self.a2_app { s += &format!("A2 app {l}\n"); }
        s += &format!("A2 {}\n", pf(self.a2));
        s += &format!("A3 cases compared {} ({} flagged, {} not run): {} differ ({} with the same points and tails differing in the last bits) {}\n",
            self.a3.compared, self.a3.flagged, self.a3.not_run, self.a3.mismatched, self.a3.same_flags_tails_differ, pf(self.a3_pass));
        for l in &self.a3.first { s += &format!("A3 differs: {l}\n"); }
        s += &format!("A4 control-film cases mirrored {} ({} flagged): {} differ {}\n", self.a4.compared, self.a4.flagged, self.a4.differ, pf(self.a4_pass));
        for l in &self.a4.first { s += &format!("A4 differs: {l}\n"); }
        s += &format!("A5 control-film records read back after reopening {} ({} flagged): {} differ {}\n", self.a5.compared, self.a5.flagged, self.a5.differ, pf(self.a5_pass));
        for l in &self.a5.first { s += &format!("A5 differs: {l}\n"); }
        s += &format!("information: nasion 10 mm on the {} control films (app) flagged {}/{}; pooled over all films (app, G1 N at 10 mm) {}/{}; FT-2 showed 127/300; not a mark (ruling OQ-4)\n",
            self.nasion10_control.of, self.nasion10_control.hit, self.nasion10_control.of, self.nasion10_pooled.hit, self.nasion10_pooled.of);
        match &self.prior {
            Some(x) => {
                let med = |v: &[f64]| { let mut w = v.to_vec(); w.sort_by(f64::total_cmp); w.get(w.len() / 2).copied().unwrap_or(f64::NAN) };
                let max = |v: &[f64]| v.iter().copied().fold(f64::NAN, f64::max);
                s += &format!("information: the starting-knowledge file's own rings (n = {}): G2 flagged {}/{}; G3 flagged {}/{} (in-sample: each film is among the {} tracings)\n",
                    x.films, x.g2_flagged.hit, x.g2_flagged.of, x.g3_flagged.hit, x.g3_flagged.of, x.films);
                s += &format!("information: the file's tracings are the caches' films in the caches' order, to the bit: {}; the same set: {}\n", x.same_order_as_caches, x.same_set_as_caches);
                s += &format!("timing: one score_run on the file's {} tracings, cold (a new scorer) median {:.0} ms, max {:.0} ms over {}; warm median {:.1} ms, max {:.1} ms; all {} Aariz runs on one scorer {:.0} ms\n",
                    x.films, med(&x.cold_ms), max(&x.cold_ms), x.cold_ms.len(), med(&x.warm_ms), max(&x.warm_ms), self.films, x.all_aariz_runs_ms);
            }
            None => s += "information: the starting-knowledge file was not given\n",
        }
        s += &format!("run time: bench {:.0} s, app side {:.0} s\n", self.seconds_bench, self.seconds_app);
        s += &format!("verdict: {} (exit {})", self.verdict, self.exit_code());
        s
    }
}

/// The full commit id at HEAD (`git rev-parse HEAD`); an error outside a checkout.
fn git_head() -> anyhow::Result<String> {
    let o = std::process::Command::new("git").args(["rev-parse", "HEAD"]).output()?;
    anyhow::ensure!(o.status.success(), "git rev-parse HEAD failed");
    Ok(String::from_utf8_lossy(&o.stdout).trim().to_string())
}

/// Each film must be a public Ceph-400 film, 001-300, given once; 301-400 is Test2 and is refused.
pub fn refuse_test2_films(films: &[SpotFilm]) -> anyhow::Result<()> {
    let mut seen = std::collections::BTreeSet::new();
    for f in films {
        let ok = !f.film.is_empty() && f.film.len() <= 3 && f.film.bytes().all(|b| b.is_ascii_digit());
        anyhow::ensure!(ok, "film {:?} is not a Ceph-400 film number (001-300)", f.film);
        let n: u32 = f.film.parse()?;
        anyhow::ensure!(n <= 300, "film {} is a Test2 film (301-400): Test2 is never opened", f.film);
        anyhow::ensure!(n >= 1, "film {:?} is not a Ceph-400 film number (001-300)", f.film);
        anyhow::ensure!(seen.insert(n), "film {} is given twice", f.film);
    }
    Ok(())
}

/// `--stage-a-acceptance`: the caches (one train, one test1; every header checked for Test2 first), a committed
/// pre-registration (this one and FT-2b's), the starting-knowledge file under `models`, the run, the report in `out`.
pub fn run_cli(data: &Path, caches: &[PathBuf], models: &Path, out: &Path) -> anyhow::Result<i32> {
    anyhow::ensure!(!caches.is_empty(), "--stage-a-acceptance needs --cache <train cache>,<test1 cache> (FT-2's caches)");
    let mut dirs = vec![];
    for d in caches { dirs.push((crate::chainproof::cache_header(data, d)?.split, d.clone())); }     // every header first
    dirs.sort_by(|a, b| b.0.cmp(&a.0));                                                             // train, then test1
    let splits: Vec<&str> = dirs.iter().map(|(s, _)| s.as_str()).collect();
    anyhow::ensure!(splits == ["train", "test1"], "the acceptance runs on one train cache and one test1 cache, not {splits:?}");
    anyhow::ensure!(!crate::provenance(data, "").git_dirty, "commit first: the marks are pre-registered ({PREREG_PATH})");
    crate::ft_common::committed_as_built(PREREG_PATH, PREREG, crate::ft_common::at_head(PREREG_PATH))?;
    crate::ft_common::committed_as_built(crate::ft2b::PREREG_PATH, crate::ft2b::PREREG, crate::ft_common::at_head(crate::ft2b::PREREG_PATH))?;
    let v: serde_json::Value = serde_json::from_str(PREREG)?;
    anyhow::ensure!(v["version"] == VERSION, "this program knows {VERSION}, not {}", v["version"]);
    let p: Ft2bPrereg = serde_json::from_str(crate::ft2b::PREREG)?;
    // The starting-knowledge file first: a missing file stops the run before half an hour is spent.
    let prior = app::load_prior(&app::prior_path(models))?;
    let (mut films, mut refused) = (vec![], vec![]);
    for (_, d) in &dirs { films.extend(crate::ft2::read_spot_cache(data, d)?.1); refused.extend(crate::ft2::read_refused(d)?); }
    refuse_test2_films(&films)?;
    anyhow::ensure!(refused.is_empty(), "{} films were refused when the caches were made; the acceptance needs FT-2b's 300", refused.len());
    counted("films in the caches", films.len(), 300)?;
    let truth = crate::ft2::truth_of(&films, &crate::dataset::load_points(&data.join("gt.csv"))?)?;
    crate::ft_common::ensure_ignored(out)?;
    std::fs::create_dir_all(out)?;
    let lib = std::env::temp_dir().join(format!("stage-a-acceptance-{}", std::process::id()));
    if lib.exists() { std::fs::remove_dir_all(&lib)?; }
    std::fs::create_dir_all(&lib)?;
    let r = accept(&films, &truth, &p, &production, &lib, Some(&prior.tracings));
    let _ = std::fs::remove_dir_all(&lib);
    let mut r = r?;
    r.git_sha = git_head()?;
    r.prior_sha256 = prior.sha256.clone();
    let path = out.join("acceptance.json");
    std::fs::write(&path, serde_json::to_string_pretty(&r)?)?;
    println!("{}", r.summary());
    println!("written to {} (exit {}: 0 pass, 3 fail, 1 broken)", path.display(), r.exit_code());
    Ok(r.exit_code())
}

#[cfg(test)] const PINNED_SHA256: &str = "d90f5dbbc5a1c0b31f8eaf826ada107d3905e0201d37e0148d44db2c9cfb34f7";

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ft2::synthetic;
    fn prereg() -> Ft2bPrereg { serde_json::from_str(crate::ft2b::PREREG).unwrap() }
    use std::sync::OnceLock;

    /// SYNTHETIC films named as Ceph-400 numbers (001-300), so the driver's film rules see real-looking names.
    fn numbered(n: usize) -> (Vec<SpotFilm>, BTreeMap<String, Vec<Pt>>) {
        let (films, truth) = synthetic(n);
        let name = |s: &str| format!("{:03}", s.trim_start_matches("SYNTHETIC-").parse::<usize>().unwrap() + 1);
        (films.into_iter().map(|f| SpotFilm { film: name(&f.film), ..f }).collect(), truth.into_iter().map(|(k, v)| (name(&k), v)).collect())
    }
    fn run(films: &[SpotFilm], truth: &BTreeMap<String, Vec<Pt>>, score: &AppScore) -> Acceptance {
        let d = tempfile::tempdir().unwrap();
        let tr: Vec<Vec<Pt>> = films.iter().map(|f| truth[&f.film].clone()).collect();
        accept(films, truth, &prereg(), score, d.path(), Some(&tr)).unwrap()
    }
    /// The clean synthetic(300) acceptance with the real scorer, made once.
    fn passing() -> &'static Acceptance {
        static R: OnceLock<Acceptance> = OnceLock::new();
        R.get_or_init(|| { let (f, t) = numbered(300); run(&f, &t, &production) })
    }

    #[test] fn the_preregistration_is_pinned() {
        assert_eq!(crate::ft_common::sha256_hex(PREREG.as_bytes()), PINNED_SHA256,
            "reference/point-check-app-acceptance.json changed: the owner's OK, then update PINNED_SHA256 (before any run)");
    }
    /// A2's numbers in this file are the pre-registration's, in its order; the marks reuse FT-2b's file.
    #[test] fn the_expected_counts_are_the_preregistrations() {
        let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
        assert_eq!((v["version"].as_str(), v["rule"].as_str()), (Some(VERSION), Some(app::RULE_VERSION)));
        let a2 = v["marks"]["A2"].as_str().unwrap();
        let e = A2;
        let want = [format!("G1 {}/{}", e.g1_pooled.0, e.g1_pooled.1), format!("lowest {} {}/{}", e.lowest.0, e.lowest.1, e.lowest.2),
            format!("G2 {}/{}", e.g2.0, e.g2.1), format!("G3 {}/{}", e.g3.0, e.g3.1), format!("nasion {}/{}", e.nasion.0, e.nasion.1),
            format!("unplanted {}/{}", e.unplanted.0, e.unplanted.1), format!("B {}/{}", e.b.0, e.b.1), format!("jaw {}/{}", e.jaw.0, e.jaw.1)];
        let mut at = 0;
        for w in &want { let i = a2[at..].find(w.as_str()).unwrap_or_else(|| panic!("{w:?} not in A2 (in order): {a2}")); at += i + w.len(); }
        let p = prereg();
        assert_eq!((p.seed, p.fold_seed, p.folds), (20261029, 20261028, 5), "reuses FT-2b's seeds and folds");
        assert_eq!(expected_cases(300, &p), 300 + 300 + 17100 + 300 + 300 + 10, "A3: Aariz, experts, plants, jaw, B, nasion");
    }

    /// The clean synthetic run passes every mark; each line is printed. (A2 compares with the real run's counts, so on
    /// synthetic films it must DIFFER: that is shown here and judged in the next test.)
    #[test] fn a_synthetic_run_compares_every_case_and_every_mark_but_a2_holds() {
        let r = passing();
        eprintln!("{}", r.summary());
        assert_eq!(r.a3.compared, 18310);
        assert_eq!((r.a3.mismatched, r.a4.differ, r.a5.differ), (0, 0, 0), "{}", r.summary());
        assert_eq!((r.a4.compared, r.a5.compared), (620, 620));
        assert!(r.a4.flagged > 0 && r.a5.flagged > 0 && r.a3.flagged > 0);
        assert!(r.a1 && r.bench_controls_held && r.app_controls_held, "{}", r.summary());
        assert!(!r.a2, "synthetic counts are not the real run's");
        assert_eq!((r.verdict.as_str(), r.exit_code()), (FAIL, 3));
        assert_eq!(r.prereg_sha256, PINNED_SHA256, "the report names the pre-registration it was judged by");
        assert!(r.summary().contains(&format!("pre-registration {PREREG_PATH} sha256 {PINNED_SHA256}")), "{}", r.summary());
        let x = r.prior.as_ref().unwrap();
        assert!(x.same_order_as_caches && x.same_set_as_caches && x.cold_ms.len() == 10 && x.g2_flagged.of > 0 && x.g3_flagged.of == 380);
    }
    /// A2 with its expected counts set to what this synthetic run counted: pass, exit 0. One count off by one: fail.
    #[test] fn a2_decides_and_a_pass_needs_every_count_equal() {
        let r = passing();
        let ar = r.app_report.as_ref().unwrap();
        let p = prereg();
        let lo = lowest(ar, &p).unwrap();
        let lo_id: &'static str = ORDER.iter().copied().find(|x| *x == lo.0).unwrap();
        let mut e = Expected { g1_pooled: (ar.g1_pooled.hit, ar.g1_pooled.of), lowest: (lo_id, lo.1, lo.2), g2: (ar.g2_flagged.hit, ar.g2_flagged.of),
            g3: (ar.g3_flagged.hit, ar.g3_flagged.of), nasion: (ar.control_nasion.hit, ar.control_nasion.of),
            unplanted: (ar.control_nasion_unplanted.hit, ar.control_nasion_unplanted.of), b: (ar.control_b.hit, ar.control_b.of), jaw: (ar.control_jaw.hit, ar.control_jaw.of) };
        let (ok, lines) = a2(ar, &p, &e).unwrap();
        eprintln!("{}", lines.join("\n"));
        assert!(ok, "{lines:?}");
        assert_eq!(verdict(true, ok && r.a1 && r.a3_pass && r.a4_pass && r.a5_pass), PASS);
        e.jaw.0 += 1;
        let (ok, lines) = a2(ar, &p, &e).unwrap();
        assert!(!ok && lines.iter().any(|l| l.starts_with("jaw") && l.ends_with("DIFFERS")), "{lines:?}");
    }
    #[test] fn each_verdict_has_its_exit_code() {
        assert_eq!((verdict(true, true), exit_code(verdict(true, true))), (PASS, 0));
        assert_eq!((verdict(true, false), exit_code(verdict(true, false))), (FAIL, 3));
        assert_eq!((verdict(false, true), exit_code(verdict(false, true))), (BROKEN, 1));
        assert_eq!(verdict(false, false), BROKEN);
    }

    /// Test2 is never opened: a film numbered 301-400 is refused by name; so is a name that is not a number, and a film
    /// twice. Control: 001-300 pass.
    #[test] fn a_test2_film_is_refused() {
        let (films, _) = numbered(300);
        refuse_test2_films(&films).unwrap();
        for (bad, why) in [("301", "Test2"), ("400", "Test2"), ("SYNTHETIC-1", "not a Ceph-400 film number"), ("000", "not a Ceph-400")] {
            let mut f = films.clone(); f[7].film = bad.into();
            let e = refuse_test2_films(&f).unwrap_err().to_string();
            eprintln!("{bad}: {e}");
            assert!(e.contains(why), "{bad}: {e}");
        }
        let mut f = films.clone(); f[8].film = f[9].film.clone();
        assert!(refuse_test2_films(&f).unwrap_err().to_string().contains("twice"));
    }
    /// The caches must be one train and one test1: two train caches are refused; a Test2 cache is refused from its header
    /// before its spots are read (the spots file here is not JSON). Control: train + test1 gets past the caches (to the
    /// next check, the committed tree or the pre-registration).
    #[test] fn a_cache_that_is_not_train_and_test1_is_refused() {
        let d = Path::new("data/ceph400");
        let mk = |split: &str| { let t = tempfile::tempdir().unwrap(); crate::ft2::write_spot_cache(t.path(), &crate::ft2::tests::header(split, 1), &crate::ft2::tests::films(1)).unwrap(); t };
        let (a, b, c) = (mk("train"), mk("train"), mk("test1"));
        let x = |v: &[&tempfile::TempDir]| run_cli(d, &v.iter().map(|t| t.path().to_path_buf()).collect::<Vec<_>>(), Path::new("models"), Path::new("reports/x")).unwrap_err().to_string();
        let e = x(&[&a, &b]); eprintln!("train + train: {e}");
        assert!(e.contains("one train cache and one test1 cache"), "{e}");
        let e = x(&[&a]); assert!(e.contains("one train cache and one test1 cache"), "{e}");
        let t2 = mk("test2");
        std::fs::write(t2.path().join("spots.jsonl"), "SYNTHETIC: not JSON\n").unwrap();
        let e = x(&[&a, &t2]); eprintln!("train + test2: {e}");
        assert!(e.contains("held back"), "{e}");
        let e = x(&[&c, &a]); eprintln!("test1 + train (control): {e}");
        assert!(!e.contains("one train cache") && !e.contains("held back"), "control: {e}");
        assert!(run_cli(d, &[], Path::new("models"), Path::new("reports/x")).unwrap_err().to_string().contains("needs --cache"));
    }
    /// A count other than its expected total stops the run with an error (main: exit 1): one case missing from A3, one
    /// control case missing from A4 and from A5.
    #[test] fn a_count_other_than_its_expected_total_stops_the_run() {
        let (films, truth) = numbered(60);
        let p = prereg();
        let mut c = compare(&films, &truth, &p, &production).unwrap();
        let want = expected_cases(60, &p);
        a3(&c.cases, want, &p).unwrap();
        let e = a3(&c.cases, want + 1, &p).unwrap_err().to_string();
        eprintln!("{e}");
        assert!(e.contains("A3 cases compared: compared") && e.contains("refusing"), "{e}");
        let i = c.cases.iter().position(|x| x.rc.is_some()).unwrap();
        c.cases.remove(i);
        assert!(a3(&c.cases, want, &p).is_err());
        assert!(a4(&c.cases, 620, &p).unwrap_err().to_string().contains("A4 control-film cases mirrored: compared 619, expected 620"));
        let d = tempfile::tempdir().unwrap();
        assert!(a5(&c.cases, &c.fold_train, d.path(), 620, &p, false).unwrap_err().to_string().contains("A5 control-film records read back: compared 619, expected 620"));
    }
    /// A mark that counted nothing is an error, never a pass: A3, A4 and A5 with no flagged case; G2 with nothing within
    /// 2 mm (from FT-2b's own judge).
    #[test] fn a_mark_that_counted_nothing_is_an_error() {
        let (films, truth) = numbered(60);
        let p = prereg();
        let mut c = compare(&films, &truth, &p, &production).unwrap();
        for x in c.cases.iter_mut() {
            x.bench.flagged.clear(); x.app = x.bench.clone();
            if x.rc.is_some() { x.rc = Some(RunCheck::Clean { present: 19 }); x.mirrored = x.rc.clone(); }
        }
        let e = a3(&c.cases, expected_cases(60, &p), &p).unwrap_err().to_string();
        assert!(e.contains("A3 compared no flagged case"), "{e}");
        assert!(a4(&c.cases, 620, &p).unwrap_err().to_string().contains("A4 compared no flagged case"));
        let d = tempfile::tempdir().unwrap();
        assert!(a5(&c.cases, &c.fold_train, d.path(), 620, &p, false).unwrap_err().to_string().contains("A5 wrote no flagged record"));
        let mut shifted = films.clone();
        for f in shifted.iter_mut() { for a in f.aariz.iter_mut() { a.0 += 50.0; } }
        let d = tempfile::tempdir().unwrap();
        let e = accept(&shifted, &truth, &p, &production, d.path(), None).unwrap_err().to_string();
        assert!(e.contains("G2") && e.contains("nothing"), "{e}");
    }

    /// The bench's check with its last round (the one that flags the film) dropped, as the app's scorer: worst first for
    /// `rounds` rounds only, so a fourth point far out is never looked at and the film is never flagged.
    fn drops_the_last_round(s: &app::ShapeScorer, m: &[Mark], _left: bool, _w: u32) -> anyhow::Result<RunCheck> {
        use app::Scorer;
        let mut pts: Vec<Option<Pt>> = vec![None; 19];
        for x in m { pts[ORDER.iter().position(|id| *id == x.landmark_id).unwrap()] = Some((x.x, x.y)); }
        let present: Vec<usize> = (0..19).filter(|&i| pts[i].is_some()).collect();
        if present.len() < app::MIN_POINTS { return Ok(RunCheck::NotRun { reason: NotRun::TooFewPoints { present: present.len() } }); }
        let cur: Vec<Pt> = pts.iter().map(|p| p.unwrap_or((f64::NAN, f64::NAN))).collect();
        let mut aside: Vec<(usize, f64)> = vec![];
        for _ in 0..app::ROUNDS {
            let active: Vec<usize> = present.iter().copied().filter(|i| !aside.iter().any(|(a, _)| a == i)).collect();
            let mut worst: Option<(usize, f64)> = None;
            for &k in &active {
                let used: Vec<usize> = active.iter().copied().filter(|&j| j != k).collect();
                let t = s.tail(k, &used, &cur, cur[k])?;
                if worst.is_none_or(|(_, w)| t < w) { worst = Some((k, t)); }
            }
            match worst { Some((k, t)) if t < app::FLAG_LINE => aside.push((k, t)), _ => break }
        }
        if aside.is_empty() { return Ok(RunCheck::Clean { present: present.len() }); }
        let ring = ceph_model::shape::Ring { cx: 0.0, cy: 0.0, rx: 1.0, ry: 1.0, angle_deg: 0.0 };
        Ok(RunCheck::Flagged { flags: aside.iter().map(|&(k, tail)| app::PointFlag { landmark_id: ORDER[k].into(), tail, expected_x: 0.0, expected_y: 0.0, off_px: 0.0, ring }).collect() })
    }
    /// A3 fails when the app's scorer drops the last round: on films whose Aariz run has S, N, Po and Ar 80 mm out
    /// (Task 2's recipe for a film out of keeping) the bench flags the film (four points); the replaced scorer flags three
    /// points and not the film. Verdict fail (exit 3). Control: the same films through `score_run` agree on every case,
    /// and the fixture itself must make the bench flag a film. (300 films, so 240 training tracings a fold: measured
    /// first, with 48 a fold the rings are so wide that two points even 200 mm out flag nothing, and no film can be.)
    #[test] fn a3_fails_when_the_apps_scorer_drops_the_last_round() {
        let (mut films, truth) = numbered(300);
        for f in films.iter_mut().take(30) { for id in ["S", "N", "Po", "Ar"] { f.aariz[idx(id)].1 -= 800.0; } }
        let p = prereg();
        let good = compare(&films, &truth, &p, &production).unwrap();
        let g = a3(&good.cases, expected_cases(300, &p), &p).unwrap();
        assert_eq!(g.mismatched, 0, "control: {:?}", g.first);
        let unusual = good.cases.iter().filter(|c| c.bench.film_unusual).count();
        eprintln!("fixture: {unusual} cases where the bench flags the film");
        assert!(unusual > 0, "fixture: the bench must flag some film, or dropping the round that does so cannot show");
        let bad = compare(&films, &truth, &p, &drops_the_last_round).unwrap();
        let r = a3(&bad.cases, expected_cases(300, &p), &p).unwrap();
        eprintln!("dropped last round: {} of {} differ; first {:?}", r.mismatched, r.compared, r.first.first());
        assert!(r.mismatched > 0 && r.first.iter().any(|l| l.contains("film-unusual")), "{r:?}");
        assert_eq!(verdict(true, r.mismatched == 0), FAIL);
    }
    /// A4 fails when `facing_left` is ignored (the mirrored film scored as facing right): the control films' planted
    /// nasion no longer reads as the same flag. Control: through `score_run`, every control case agrees (the passing run).
    #[test] fn a4_fails_when_facing_left_is_ignored() {
        let (films, truth) = numbered(60);
        let p = prereg();
        let ignores = |s: &app::ShapeScorer, m: &[Mark], _left: bool, w: u32| app::score_run(s, m, false, w);
        let c = compare(&films, &truth, &p, &ignores).unwrap();
        let r = a4(&c.cases, 620, &p).unwrap();
        eprintln!("facing ignored: {} of {} differ; first {:?}", r.differ, r.compared, r.first.first());
        assert!(r.differ > 0, "{r:?}");
        let good = compare(&films, &truth, &p, &production).unwrap();
        let g = a4(&good.cases, 620, &p).unwrap();
        assert_eq!(g.differ, 0, "control: {:?}", g.first);
    }
    /// A5 reads back what it wrote; a value changed after the reopen (one record's `present`) is caught.
    #[test] fn a5_catches_a_record_that_changed_after_reopening() {
        let (films, truth) = numbered(60);
        let p = prereg();
        let c = compare(&films, &truth, &p, &production).unwrap();
        let d = tempfile::tempdir().unwrap();
        let r = a5(&c.cases, &c.fold_train, d.path(), 620, &p, false).unwrap();
        eprintln!("A5: {} read back, {} flagged, {} differ", r.compared, r.flagged, r.differ);
        assert_eq!(r.differ, 0, "{:?}", r.first);
        let d = tempfile::tempdir().unwrap();
        let r = a5(&c.cases, &c.fold_train, d.path(), 620, &p, true).unwrap();
        eprintln!("A5 tampered: {:?}", r.first);
        assert_eq!(r.differ, 1);
    }

    /// A5's cross-check reads the stored record against `score_run`'s result directly, for a flagged run (every field)
    /// and a film flagged as unusual (its point list, in order). Each mutation of the stored record is caught: a field
    /// from the wrong source, the film's list re-ordered, `present` off by one, the outcome word. Control: the shared
    /// mapping's own record passes.
    #[test] fn a5s_cross_check_covers_every_field_and_the_films_point_list() {
        use ceph_model::shape::Ring;
        let f = |id: &str, k: f64| app::PointFlag { landmark_id: id.into(), tail: 1e-5 * k, expected_x: 100.0 + k, expected_y: 200.0 + k, off_px: 30.0 + k,
            ring: Ring { cx: 100.0 + k, cy: 200.0 + k, rx: 11.0 + k, ry: 7.0 + k, angle_deg: -20.0 + k } };
        let pts: Vec<Pt> = (0..19).map(|k| (k as f64, 2.0 * k as f64)).collect();
        let m = marks(&all(&pts));
        let sha = "b".repeat(64);
        let flagged = RunCheck::Flagged { flags: vec![f("B", 1.0), f("N", 2.0)] };
        let film = RunCheck::FilmUnusual { flags: vec![f("N", 1.0), f("S", 2.0), f("B", 3.0), f("Po", 4.0)] };
        for rc in [&flagged, &film, &RunCheck::Clean { present: 19 }] {
            against_score_run(&ceph_store::point_check_record(1, &sha, 240, &m, rc), rc, &pts).unwrap();
        }
        let r = ceph_store::point_check_record(1, &sha, 240, &m, &flagged);
        let mut y = r.clone(); y.flags[1].expected_y = y.flags[1].expected_x;
        let mut pr = r.clone(); pr.present = Some(18);
        let mut word = r.clone(); word.outcome = "clean".into();
        let rf = ceph_store::point_check_record(1, &sha, 240, &m, &film);
        let mut order = rf.clone(); order.flags[0].points = Some("B,N,Po,S".into());
        for (name, bad, rc) in [("expected y from x", &y, &flagged), ("present", &pr, &flagged), ("outcome word", &word, &flagged), ("film list order", &order, &film)] {
            let e = against_score_run(bad, rc, &pts).unwrap_err();
            eprintln!("{name}: {e}");
        }
    }
    /// Edge cases on one fold's scorers (synthetic): 11 points: not run on both sides, and counted as not run; nasion
    /// absent: run on 18 (the app says 18 present) and equal; a point 20 mm out with S absent: flagged on both, equal.
    #[test] fn too_few_points_and_a_missing_point_compare_equal() {
        let (films, truth) = numbered(60);
        let p = prereg();
        let tr: Vec<Vec<Pt>> = films.iter().skip(12).map(|f| truth[&f.film].clone()).collect();
        let (b, a) = (crate::pointcheck::ShapeScorer::new(tr.clone()), app::ShapeScorer::new(tr));
        let face = all(&films[0].aariz);
        let l = p.lines();
        let mut eleven = face.clone(); for x in eleven.iter_mut().skip(11) { *x = None; }
        let mut no_n = face.clone(); no_n[idx("N")] = None;
        let mut wild = face.clone(); wild[idx("S")] = None; wild[idx("B")] = wild[idx("B")].map(|q| (q.0 + 200.0, q.1));
        let mut cases = vec![];
        for (name, pts) in [("11 points", &eleven), ("N absent", &no_n), ("S absent, B 20 mm", &wild)] {
            let bo = seen_bench(&bench_outcome(&b, pts, &l).unwrap()).unwrap();
            let rc = app::score_run(&a, &marks(pts), false, FILM_W).unwrap();
            eprintln!("{name}: bench {bo:?}; app {rc:?}");
            assert_eq!(bo, seen_app(&rc).unwrap(), "{name}");
            cases.push(CaseResult { film: 0, fold: 0, pos: 0, kind: Kind::Aariz, app: seen_app(&rc).unwrap(), bench: bo, rc: None, mirrored: None, pts: None });
            match name {
                "11 points" => assert_eq!(rc, RunCheck::NotRun { reason: NotRun::TooFewPoints { present: 11 } }),
                "N absent" => assert!(matches!(rc, RunCheck::Clean { present: 18 }), "{rc:?}"),
                _ => assert!(matches!(&rc, RunCheck::Flagged { flags } if flags[0].landmark_id == "B"), "{rc:?}"),
            }
        }
        let r = a3(&cases, 3, &p).unwrap();
        assert_eq!((r.compared, r.not_run, r.flagged, r.mismatched), (3, 1, 1, 0));
    }
    /// Edge case, offset: the whole tracing of each control film moved together (+123.4, −56.7 px) gives the same outcome
    /// through `score_run`: same points, same order, tails within 1e-9 relative (the shape model is blind to where the
    /// face sits). Control: on each film's shifted Aariz run, B alone 60 mm forward IS flagged.
    #[test] fn a_whole_tracing_shift_of_the_control_films_gives_the_same_outcome() {
        let (films, truth) = numbered(60);
        let p = prereg();
        let c = compare(&films, &truth, &p, &production).unwrap();
        let folds = crate::ft2::fold_split(&films, p.folds, p.fold_seed);
        let train: Vec<Vec<Pt>> = folds.iter().skip(1).flatten().map(|&i| truth[&films[i].film].clone()).collect();
        let s = app::ShapeScorer::new(train);
        let (mut n, mut flagged) = (0, 0);
        for x in c.cases.iter().filter(|x| x.rc.is_some()) {
            let pts = x.pts.as_ref().unwrap();
            let moved: Vec<Option<Pt>> = pts.iter().map(|q| Some((q.0 + 123.4, q.1 - 56.7))).collect();
            let rc = app::score_run(&s, &marks(&moved), false, FILM_W).unwrap();
            let (a, b) = (seen_app(x.rc.as_ref().unwrap()).unwrap(), seen_app(&rc).unwrap());
            assert_eq!((a.film_unusual, a.flagged.iter().map(|f| &f.0).collect::<Vec<_>>()), (b.film_unusual, b.flagged.iter().map(|f| &f.0).collect::<Vec<_>>()), "{:?}", x.kind);
            for (u, v) in a.flagged.iter().zip(&b.flagged) {
                let (u, v) = (f64::from_bits(u.1), f64::from_bits(v.1));
                assert!((u - v).abs() <= 1e-9 * u.abs().max(v.abs()), "{:?}: {u:e} vs {v:e}", x.kind);
            }
            n += 1; flagged += !a.flagged.is_empty() as usize;
            if x.kind == Kind::Aariz {
                let mut b_only = moved.clone(); b_only[idx("B")] = b_only[idx("B")].map(|q| (q.0 + 600.0, q.1));
                assert!(seen_app(&app::score_run(&s, &marks(&b_only), false, FILM_W).unwrap()).unwrap().is_flagged("B"), "control");
            }
        }
        eprintln!("whole-tracing shift: {n} control cases, {flagged} flagged, all the same");
        assert_eq!(n, 620);
        assert!(flagged > 0);
    }
}
