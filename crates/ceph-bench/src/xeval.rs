//! The cross-check on bench films (spec 2026-10-13 §7): the placed point as the app places it, the rule's outcome,
//! the pre-registered metrics, the planted control, the tuning and the combining columns. Pure: works on the cache.

use crate::dataset::Points;
use crate::passrule::{verdict, Verdict, ERROR_CUT_MM, RESAMPLES, SEED};
use crate::source::{AARIZ, CWLACHAP, ORIGINAL_19};
use crate::stats::{auroc, bootstrap, spearman, Ci, SplitMix64};
use crate::xcache::FilmRun;
use ceph_infer::crosscheck::{check, real_oval, scale_ok, Check, Guess, Outcome, Params};
use std::collections::BTreeMap;

/// Who places what, and which values the rule uses (the app's placement, spec §5.1, and §6.2).
#[derive(Clone, Copy)]
pub struct Setup<'a> {
    pub main: &'a str, pub source: &'a BTreeMap<String, String>, pub order: &'a [String],
    /// R-B2: may this model place this landmark (not over the 2 mm gate)?
    pub placeable: &'a dyn Fn(&str, &str) -> bool,
    pub voters: &'a [String], pub window: usize, pub params: &'a Params,
}

pub fn guess(f: &FilmRun, model: &str, lm: &str, window: usize) -> Option<Guess> {
    let p = f.models.get(model)?.as_ref().ok()?.get(lm)?;
    Some(Guess { model_id: model.into(), x: p.x, y: p.y, cov: p.cov.get(&window).copied().flatten() })
}

/// The point the app would place (same rule as `placeFromRuns`): the main model unless over the gate — cwlachap instead
/// for an original point the source table gives it, when cwlachap answered — else the first model in catalogue order
/// that finds it and passes the gate.
pub fn placed(f: &FilmRun, lm: &str, s: &Setup) -> Option<Guess> {
    if let Some(g) = guess(f, s.main, lm, s.window).filter(|_| (s.placeable)(s.main, lm)) {
        if s.main == AARIZ && ORIGINAL_19.contains(&lm) && s.source.get(lm).map(String::as_str) == Some(CWLACHAP) {
            if let Some(c) = guess(f, CWLACHAP, lm, s.window) { return Some(c); }
        }
        return Some(g);
    }
    s.order.iter().filter(|m| m.as_str() != s.main).find_map(|m| guess(f, m, lm, s.window).filter(|_| (s.placeable)(m, lm)))
}

#[derive(Clone, Debug)]
pub struct Row { pub film: String, pub landmark: String, pub placer: String, pub err_mm: f64, pub check: Check }

/// One row per (film, truth landmark) that has a placed point.
pub fn rows(films: &[FilmRun], gt: &Points, s: &Setup) -> Vec<Row> {
    let mut out = Vec::new();
    for f in films {
        for (lm, tx, ty) in gt.get(&f.film).into_iter().flatten() {
            let Some(p) = placed(f, lm, s) else { continue };
            let voters: Vec<Guess> = s.voters.iter().filter_map(|v| guess(f, v, lm, s.window)).collect();
            out.push(Row { film: f.film.clone(), landmark: lm.clone(), placer: p.model_id.clone(),
                err_mm: crate::metrics::radial_error_mm((p.x, p.y), (*tx, *ty), f.mm_per_px), check: check(lm, &p, &voters, f.mm_per_px, s.params) });
        }
    }
    out
}

fn flagged(o: &Outcome) -> bool { matches!(o, Outcome::Review { .. } | Outcome::Conflict { .. }) }
fn checked(o: &Outcome) -> bool { !matches!(o, Outcome::NotChecked { .. }) }

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics { pub films: usize, pub placed: usize, pub off: usize, pub checked: usize, pub flagged: usize,
    /// Checked rows with no finite D²: left out of the AUROC and Spearman (`auroc` refuses a non-finite score) and counted.
    pub checked_unscored: usize,
    pub sensitivity: Ci, pub burden: Ci, pub auroc: Ci, pub spearman: Option<f64>, pub verdict: Verdict }

/// The AUROC's score for a row: its finite D², only if it was checked (Task 6 fix round 1).
fn score(r: &Row) -> Option<f64> { if checked(&r.check.outcome) { r.check.max_d2.filter(|d| d.is_finite()) } else { None } }

/// The pre-registered measures (prereg "What is measured"), with bootstrap CIs over films.
pub fn metrics(rows: &[Row], seen_by_two: &dyn Fn(&str) -> bool) -> anyhow::Result<Metrics> {
    let mut by_film: BTreeMap<&str, Vec<&Row>> = BTreeMap::new();
    for r in rows { by_film.entry(r.film.as_str()).or_default().push(r); }
    let films: Vec<Vec<&Row>> = by_film.into_values().collect();
    let off = |r: &Row| r.err_mm > ERROR_CUT_MM;
    let sens = |s: &[&Vec<&Row>]| { let (mut c, mut n) = (0usize, 0usize);
        for f in s { for r in f.iter().filter(|r| off(r) && seen_by_two(&r.landmark)) { n += 1; if flagged(&r.check.outcome) { c += 1; } } }
        (n > 0).then(|| c as f64 / n as f64) };
    let burden = |s: &[&Vec<&Row>]| { let (mut f_, mut n) = (0usize, 0usize);
        for f in s { for r in f.iter().filter(|r| checked(&r.check.outcome)) { n += 1; if flagged(&r.check.outcome) { f_ += 1; } } }
        (n > 0).then(|| f_ as f64 / n as f64) };
    let auc = |s: &[&Vec<&Row>]| auroc(&s.iter().flat_map(|f| f.iter()).filter_map(|r| score(r).map(|d| (d, off(r)))).collect::<Vec<_>>());
    let (sensitivity, burden_ci, auroc_ci) = (bootstrap(&films, RESAMPLES, SEED, sens)?, bootstrap(&films, RESAMPLES, SEED, burden)?, bootstrap(&films, RESAMPLES, SEED, auc)?);
    let pairs: Vec<(f64, f64)> = rows.iter().filter_map(|r| score(r).map(|d| (d, r.err_mm))).collect();
    let rho = spearman(&pairs.iter().map(|p| p.0).collect::<Vec<_>>(), &pairs.iter().map(|p| p.1).collect::<Vec<_>>());
    let v = verdict(&sensitivity, burden_ci.estimate, &auroc_ci);
    Ok(Metrics { films: films.len(), placed: rows.len(), off: rows.iter().filter(|r| off(r)).count(),
        checked: rows.iter().filter(|r| checked(&r.check.outcome)).count(), flagged: rows.iter().filter(|r| flagged(&r.check.outcome)).count(),
        checked_unscored: rows.iter().filter(|r| checked(&r.check.outcome) && score(r).is_none()).count(),
        sensitivity, burden: burden_ci, auroc: auroc_ci, spearman: rho, verdict: v })
}

/// The planted control (prereg step 4): about one placed point in 10 moved 5 mm in a seeded direction. Returns the
/// changed films and the (film, landmark) keys moved.
pub fn plant(films: &[FilmRun], gt: &Points, s: &Setup, seed: u64) -> (Vec<FilmRun>, Vec<(String, String)>) {
    let mut rng = SplitMix64::new(seed);
    let (mut out, mut keys) = (films.to_vec(), Vec::new());
    for f in out.iter_mut() {
        for (lm, _, _) in gt.get(&f.film).cloned().unwrap_or_default() {
            let Some(p) = placed(f, &lm, s) else { continue };
            if rng.below(crate::tune::PLANT_ONE_IN) != 0 { continue; }
            let a = 2.0 * std::f64::consts::PI * (rng.next_u64() as f64 / u64::MAX as f64);
            let d = crate::tune::PLANT_MM / f.mm_per_px;
            if let Some(Ok(m)) = f.models.get_mut(&p.model_id) { if let Some(c) = m.get_mut(&lm) { c.x += d * a.cos(); c.y += d * a.sin(); keys.push((f.film.clone(), lm.clone())); } }
        }
    }
    (out, keys)
}

/// The planted control on `films` with the values in `s`: (points moved 5 mm, of them flagged). Prereg step 4.
pub fn planted_control(films: &[FilmRun], gt: &Points, s: &Setup) -> (usize, usize) {
    let (moved, keys) = plant(films, gt, s, SEED);
    let keys: std::collections::BTreeSet<(String, String)> = keys.into_iter().collect();
    let flagged_n = rows(&moved, gt, s).iter().filter(|r| keys.contains(&(r.film.clone(), r.landmark.clone())) && flagged(&r.check.outcome)).count();
    (keys.len(), flagged_n)
}

/// Prereg step 4 and (c): more than half of the moved points must be flagged, or the instrument is blind and no result
/// counts. Nothing moved is never a pass.
pub fn not_blind(moved: usize, flagged_n: usize) -> anyhow::Result<()> {
    anyhow::ensure!(moved > 0 && flagged_n as f64 / moved as f64 > crate::tune::PLANT_CATCH_ABOVE,
        "the planted control failed ({flagged_n} of {moved} points moved 5 mm were flagged): the instrument is blind; no tuning result counts");
    Ok(())
}

/// The planted control with the untuned draft values (k 1, σ₀ 0.3 mm, window 15): recorded with its verdict, not a
/// gate. Prereg step 4 runs the control with the tuned values (that one stops the run, `not_blind`); the draft ovals are
/// placeholders (Task 7 Step 7: Aariz's at k 1 are about three times its real error), so their blindness says how far
/// off the draft was, not whether the instrument can see.
pub fn draft_control_record(moved: usize, flagged_n: usize) -> serde_json::Value {
    serde_json::json!({ "moved": moved, "flagged": flagged_n, "blind": not_blind(moved, flagged_n).is_err(), "gating": false,
        "note": "draft values (k 1, sigma0 0.3 mm, window 15); prereg step 4 gates on the tuned values" })
}

/// Weiszfeld's geometric median (200 steps, as the app's key 4); two points give their midpoint.
pub fn geometric_median(p: &[[f64; 2]]) -> [f64; 2] {
    if p.len() == 2 { return [(p[0][0] + p[1][0]) / 2.0, (p[0][1] + p[1][1]) / 2.0]; }
    let n = p.len() as f64;
    let mut m = [p.iter().map(|q| q[0]).sum::<f64>() / n, p.iter().map(|q| q[1]).sum::<f64>() / n];
    for _ in 0..200 {
        let (mut sx, mut sy, mut sw) = (0.0, 0.0, 0.0);
        for q in p { let d = (q[0] - m[0]).hypot(q[1] - m[1]).max(1e-12); sx += q[0] / d; sy += q[1] / d; sw += 1.0 / d; }
        m = [sx / sw, sy / sw];
    }
    m
}
/// The Gaussian product of the guesses (spec §4.2 step 3): Σ = (Σ Σ_m⁻¹)⁻¹, μ = Σ Σ Σ_m⁻¹ p_m, Σ_m = k_m cov_m + σ₀² I.
pub fn spread_weighted(g: &[Guess], mm_per_px: f64, p: &Params) -> Option<[f64; 2]> {
    let (mut a, mut b, mut c, mut vx, mut vy) = (0.0, 0.0, 0.0, 0.0, 0.0);
    for q in g {
        q.cov?;                                                           // a guess without a spread: no weighted average
        let [xx, xy, yy] = p.sigma(q, mm_per_px);                         // the rule's own Σ (preflight c14)
        let det = xx * yy - xy * xy;
        let (ia, ib, ic) = (yy / det, -xy / det, xx / det);                 // inverse [[ia, ib], [ib, ic]]
        a += ia; b += ib; c += ic; vx += ia * q.x + ib * q.y; vy += ib * q.x + ic * q.y;
    }
    let det = a * c - b * b;
    (det > 0.0).then(|| [(c * vx - b * vy) / det, (a * vy - b * vx) / det])
}

/// Q2 (bench only): mean error and SDR at 2 mm of each model alone (all four), the plain average, the geometric median
/// (with two voters both are their midpoint), the spread-weighted average and (if given) the best single model per point
/// chosen on Aariz valid, against the placed point.
pub fn combining(films: &[FilmRun], gt: &Points, s: &Setup, best_per_point: Option<&BTreeMap<String, String>>) -> serde_json::Value {
    let mut errs: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for f in films { for (lm, tx, ty) in gt.get(&f.film).into_iter().flatten() {
        let vs: Vec<Guess> = s.voters.iter().filter_map(|v| guess(f, v, lm, s.window)).collect();
        if vs.len() < 2 { continue; }
        let e = |x: f64, y: f64| crate::metrics::radial_error_mm((x, y), (*tx, *ty), f.mm_per_px);
        let mut push = |k: &str, v: f64| errs.entry(k.to_string()).or_default().push(v);
        if let Some(p) = placed(f, lm, s) { push("placed (main placement)", e(p.x, p.y)); }
        // Every model alone, ghosts included (spec §4 Q2); the combined columns below use the voters only (VOTERS-2).
        for m in s.order { if let Some(g) = guess(f, m, lm, s.window) { push(&format!("alone: {m}"), e(g.x, g.y)); } }
        let n = vs.len() as f64;
        push("average of voters", e(vs.iter().map(|v| v.x).sum::<f64>() / n, vs.iter().map(|v| v.y).sum::<f64>() / n));
        let m = geometric_median(&vs.iter().map(|v| [v.x, v.y]).collect::<Vec<_>>());
        push("median of voters", e(m[0], m[1]));
        if let Some(w) = spread_weighted(&vs, f.mm_per_px, s.params) { push("spread-weighted average", e(w[0], w[1])); }
        if let Some(best) = best_per_point.and_then(|b| b.get(lm)) { if let Some(v) = vs.iter().find(|v| &v.model_id == best) { push("best single model per point (chosen on Aariz valid)", e(v.x, v.y)); } }
    } }
    serde_json::json!(errs.iter().map(|(k, v)| (k.clone(), serde_json::json!({ "n": v.len(), "mre": v.iter().sum::<f64>() / v.len() as f64,
        "sdr2": v.iter().filter(|x| **x <= 2.0).count() as f64 / v.len() as f64 }))).collect::<BTreeMap<_, _>>())
}

/// Why a point was left out of the k fit (prereg step 2: "not used for the fit and counted"). One reason per point,
/// the first that applies, in this order. Task 6 fix round 1: `fit_k` refuses any of these, so they are filtered here.
#[derive(Clone, Copy, Debug, Default, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KExcluded { pub no_spread: usize, pub bad_scale: usize, pub not_real_oval: usize, pub bad_offset: usize }

/// The k-fit samples for one model and window, and the count of points left out by reason. A landmark the model did
/// not find is not a sample (nothing to leave out).
pub fn k_samples(films: &[FilmRun], gt: &Points, model: &str, window: usize) -> (Vec<crate::tune::KSample>, KExcluded) {
    let (mut out, mut ex) = (Vec::new(), KExcluded::default());
    for f in films { for (lm, tx, ty) in gt.get(&f.film).into_iter().flatten() {
        let Some(g) = guess(f, model, lm, window) else { continue };
        let Some(c) = g.cov else { ex.no_spread += 1; continue };
        if !scale_ok(f.mm_per_px) { ex.bad_scale += 1; continue; }
        if !real_oval(c) { ex.not_real_oval += 1; continue; }
        let d = [g.x - tx, g.y - ty];
        if !d.iter().all(|v| v.is_finite()) { ex.bad_offset += 1; continue; }
        out.push((d, c, f.mm_per_px));
    } }
    (out, ex)
}

/// Ruling (Task 6 fix round 1): the T pick is also reported at these catch targets, on Aariz valid only.
/// 0.90 is the pre-registered one (prereg step 3); the others are for the owner's decision at Step 8.
pub const CATCH_TARGETS: [f64; 3] = [0.90, 0.93, 0.95];

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandmarkRates { pub off: usize, pub flagged_off: usize, pub sensitivity: Option<f64>, pub checked: usize, pub flagged: usize, pub burden: Option<f64> }

/// Per landmark: catch rate (flagged ÷ off, unchecked off points missed; None on a landmark fewer than two voters see,
/// or with no off point) and flag rate (flagged ÷ checked; None with nothing checked).
pub fn per_landmark(rows: &[Row], seen_by_two: &dyn Fn(&str) -> bool) -> BTreeMap<String, LandmarkRates> {
    let mut out: BTreeMap<String, LandmarkRates> = BTreeMap::new();
    for r in rows {
        let e = out.entry(r.landmark.clone()).or_insert(LandmarkRates { off: 0, flagged_off: 0, sensitivity: None, checked: 0, flagged: 0, burden: None });
        let (off, fl) = (r.err_mm > ERROR_CUT_MM, flagged(&r.check.outcome));
        if off { e.off += 1; if fl { e.flagged_off += 1; } }
        if checked(&r.check.outcome) { e.checked += 1; if fl { e.flagged += 1; } }
    }
    for (lm, e) in out.iter_mut() {
        e.sensitivity = (seen_by_two(lm) && e.off > 0).then(|| e.flagged_off as f64 / e.off as f64);
        e.burden = (e.checked > 0).then(|| e.flagged as f64 / e.checked as f64);
    }
    out
}
/// Steps 1–3 of the prereg tuning rule. Returns the candidate parameters and the evidence.
pub fn tune(films: &[FilmRun], gt: &Points, s0: &Setup, seen_by_two: &dyn Fn(&str) -> bool) -> anyhow::Result<serde_json::Value> {
    // Prereg step 2: k is fitted for the two voters and cwlachap only; GU2Net keeps its draft k (VOTERS-2).
    let models: Vec<String> = crate::tune::FIT_K_FOR.iter().map(|m| m.to_string()).collect();
    let mut best: Option<(f64, usize, f64, BTreeMap<String, f64>, BTreeMap<String, KExcluded>)> = None;
    let mut grid = Vec::new();
    for &w in &crate::tune::WINDOWS { for &sg in &crate::tune::SIGMA0_MM {
        let (mut k, mut excluded) = (s0.params.k.clone(), BTreeMap::new());
        for m in &models {
            let (ks, ex) = k_samples(films, gt, m, w);      // broken points left out and counted (prereg step 2)
            excluded.insert(m.clone(), ex);
            k.insert(m.clone(), crate::tune::fit_k(&ks, sg).map_err(|e| anyhow::anyhow!("{m}, window {w}, sigma0 {sg} mm: {e}"))?);
        }
        let p = Params { sigma0_mm: sg, k: k.clone(), t: BTreeMap::new(), t_default: crate::tune::CHI2_95, spread_window_cells: w, ..s0.params.clone() };
        let s = Setup { window: w, params: &p, ..*s0 };
        let auc = metrics(&rows(films, gt, &s), seen_by_two)?.auroc.estimate;
        grid.push(serde_json::json!({ "window": w, "sigma0Mm": sg, "k": k, "kExcluded": excluded, "auroc": auc }));
        if best.as_ref().map_or(true, |b| auc > b.0) { best = Some((auc, w, sg, k, excluded)); }
    } }
    let (_, w, sg, k, k_excluded) = best.ok_or_else(|| anyhow::anyhow!("empty grid"))?;
    let base = Params { sigma0_mm: sg, k: k.clone(), t: BTreeMap::new(), t_default: crate::tune::CHI2_95, spread_window_cells: w, ..s0.params.clone() };
    let s = Setup { window: w, params: &base, ..*s0 };
    let r0 = rows(films, gt, &s);
    let landmarks: std::collections::BTreeSet<String> = r0.iter().map(|r| r.landmark.clone()).collect();
    // Each landmark's catch rate at every T on the grid, computed once and shared by every catch target.
    let mut sens_grid: BTreeMap<String, (usize, BTreeMap<u64, Option<f64>>)> = BTreeMap::new();
    for lm in landmarks.iter().filter(|l| seen_by_two(l)) {
        let positives = r0.iter().filter(|r| &r.landmark == lm && r.err_mm > ERROR_CUT_MM).count();
        let mut by_t = BTreeMap::new();
        for &tv in &crate::tune::T_GRID {
            let mut p = base.clone(); p.t.insert(lm.clone(), tv);
            let s2 = Setup { params: &p, ..s };
            let rs: Vec<Row> = rows(films, gt, &s2).into_iter().filter(|r| &r.landmark == lm && r.err_mm > ERROR_CUT_MM).collect();
            by_t.insert(tv.to_bits(), (!rs.is_empty()).then(|| rs.iter().filter(|r| flagged(&r.check.outcome)).count() as f64 / rs.len() as f64));
        }
        sens_grid.insert(lm.clone(), (positives, by_t));
    }
    let t_for_target = |target: f64| -> BTreeMap<String, f64> { sens_grid.iter().filter_map(|(lm, (positives, by_t))|
        crate::tune::pick_t_at(target, *positives, &|tv: f64| by_t.get(&tv.to_bits()).copied().flatten()).map(|tv| (lm.clone(), tv))).collect() };
    // The pre-registered pick (prereg step 3, catch target SENS_MIN = 0.90).
    let t = t_for_target(crate::passrule::SENS_MIN);
    // Ruling (Task 6 fix round 1): the same pick at 0.90, 0.93 and 0.95, with overall and per-landmark
    // catch and flag rates on Aariz valid, for the owner's choice at Step 8. Reported only; `t` above is what is proposed.
    let mut catch_targets = Vec::new();
    for &c in &CATCH_TARGETS {
        let tc = t_for_target(c);
        let pc = Params { t: tc.clone(), ..base.clone() };
        let rc = rows(films, gt, &Setup { params: &pc, ..s });
        let mc = metrics(&rc, seen_by_two)?;
        catch_targets.push(serde_json::json!({ "catchTarget": c, "preRegistered": c == crate::passrule::SENS_MIN, "t": tc,
            "sensitivity": mc.sensitivity, "burden": mc.burden, "perLandmark": per_landmark(&rc, seen_by_two) }));
    }
    let tuned = Params { t: t.clone(), ..base.clone() };
    Ok(serde_json::json!({ "grid": grid, "window": w, "sigma0Mm": sg, "k": k, "kExcluded": k_excluded, "t": t, "tDefault": crate::tune::CHI2_95,
        "catchTargets": catch_targets, "params": {
        "ruleVersion": "crosscheck/1", "voters": tuned.voters, "spreadWindowCells": w, "sigma0Mm": sg, "tDefault": crate::tune::CHI2_95, "t": t, "k": k } }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::xcache::{CachedPoint, FilmRun};
    const SR: &str = "srpose-cldet23"; const GU: &str = "gu2net-isbi19"; const AZ: &str = "aariz-cepha29"; const CW: &str = "cwlachap-hrnet-w32";
    fn cp(x: f64, y: f64) -> CachedPoint { CachedPoint { x, y, cov: [(15usize, Some([25.0, 0.0, 25.0]))].into() } }
    fn film(id: &str, pts: &[(&str, &str, f64, f64)]) -> FilmRun {
        let mut models: BTreeMap<String, Result<BTreeMap<String, CachedPoint>, String>> = BTreeMap::new();
        for (m, lm, x, y) in pts { models.entry(m.to_string()).or_insert_with(|| Ok(BTreeMap::new())).as_mut().unwrap().insert(lm.to_string(), cp(*x, *y)); }
        FilmRun { film: id.into(), mm_per_px: 0.1, models }
    }
    fn gt(rows: &[(&str, &str, f64, f64)]) -> Points { let mut p = Points::new(); for (f, l, x, y) in rows { p.entry(f.to_string()).or_default().push((l.to_string(), *x, *y)); } p }
    fn order() -> Vec<String> { [CW, GU, SR, AZ].map(String::from).to_vec() }
    fn voters() -> Vec<String> { [SR, AZ].map(String::from).to_vec() }   // owner VOTERS-2
    fn with<R>(source: &[(&str, &str)], placeable: &dyn Fn(&str, &str) -> bool, f: impl FnOnce(&Setup) -> R) -> R {
        let (src, ord, v, p): (BTreeMap<String, String>, _, _, _) = (source.iter().map(|(a, b)| (a.to_string(), b.to_string())).collect(), order(), voters(), ceph_infer::crosscheck::draft_params());
        f(&Setup { main: AZ, source: &src, order: &ord, placeable, voters: &v, window: 15, params: &p })
    }
    #[test] fn the_placed_point_follows_the_source_table_and_the_fill_rule() {
        let f = film("f", &[(AZ, "S", 1.0, 1.0), (AZ, "Go", 2.0, 2.0), (CW, "Go", 3.0, 3.0), (SR, "Ba", 4.0, 4.0), (AZ, "Co", 5.0, 5.0), (SR, "Co", 6.0, 6.0)]);
        let gate = |_m: &str, lm: &str| !(lm == "Co");                        // Co over the gate for every model (as committed)
        with(&[("Go", CW), ("S", AZ)], &gate, |s| {
            assert_eq!(placed(&f, "S", s).map(|g| g.model_id), Some(AZ.to_string()));
            assert_eq!(placed(&f, "Go", s).map(|g| (g.model_id, g.x)), Some((CW.to_string(), 3.0)));
            assert_eq!(placed(&f, "Ba", s).map(|g| g.model_id), Some(SR.to_string()));
            assert_eq!(placed(&f, "Co", s), None, "Co stays a ghost (R-B2)");
        });
        let no_cw = film("f", &[(AZ, "Go", 2.0, 2.0)]);
        with(&[("Go", CW)], &|_, _| true, |s| assert_eq!(placed(&no_cw, "Go", s).map(|g| g.model_id), Some(AZ.to_string()), "cwlachap gave nothing: Aariz"));
    }
    #[test] fn a_model_that_errored_on_a_film_did_not_answer_and_a_ghost_cannot_stand_in() {
        let mut f = film("f", &[(AZ, "S", 0.0, 0.0), (GU, "S", 1.0, 0.0)]);
        f.models.insert(SR.into(), Err("SYNTHETIC failure".into()));
        assert_eq!(guess(&f, SR, "S", 15), None);
        with(&[], &|_, _| true, |s| {
            let r = rows(&[f.clone()], &gt(&[("f", "S", 0.0, 0.0)]), s);
            assert_eq!((r[0].check.answered, r[0].check.of), (1, 2));
            assert_eq!(r[0].check.outcome, Outcome::NotChecked { why: ceph_infer::crosscheck::NotCheckedWhy::TooFewAnswered }, "GU2Net answered, but it does not vote (VOTERS-2)");
        });
    }
    #[test] fn metrics_count_off_points_flags_and_unchecked_off_points_as_missed() {
        // Film a: S placed by Aariz 30 px (3 mm) off, SRPose 1 px from the truth → the two voters disagree → conflict (caught).
        // Film b: S placed on the truth, both agree. Film c: Ba (one voter) placed 30 px off → not checked → but Ba is
        // seen by one voter only, so it is outside the sensitivity denominator.
        let fa = film("a", &[(AZ, "S", 30.0, 0.0), (SR, "S", 1.0, 0.0)]);
        let fb = film("b", &[(AZ, "S", 0.0, 0.0), (SR, "S", 0.0, 1.0)]);
        let fc = film("c", &[(SR, "Ba", 30.0, 0.0)]);
        let g = gt(&[("a", "S", 0.0, 0.0), ("b", "S", 0.0, 0.0), ("c", "Ba", 0.0, 0.0)]);
        with(&[], &|_, _| true, |s| {
            let r = rows(&[fa, fb, fc], &g, s);
            let m = metrics(&r, &|lm| lm != "Ba").unwrap();
            assert_eq!((m.placed, m.off, m.checked, m.flagged), (3, 2, 2, 1));
            assert_eq!(m.sensitivity.estimate, 1.0, "the only off point two voters can see was caught");
            assert_eq!(m.burden.estimate, 0.5);
        });
    }
    #[test] fn the_planted_control_moves_about_one_point_in_ten_by_5_mm_and_the_flags_see_it() {
        let films: Vec<FilmRun> = (0..60).map(|i| film(&format!("f{i}"), &[(AZ, "S", 0.0, 0.0), (SR, "S", 0.0, 0.5)])).collect();   // Aariz places; moving it moves Aariz's vote too
        let g: Points = (0..60).map(|i| (format!("f{i}"), vec![("S".to_string(), 0.0, 0.0)])).collect();
        with(&[], &|_, _| true, |s| {
            let (moved, keys) = plant(&films, &g, s, crate::passrule::SEED);
            assert!((2..=15).contains(&keys.len()), "about one in ten of 60: {}", keys.len());
            let r = rows(&moved, &g, s);
            let caught = r.iter().filter(|x| keys.contains(&(x.film.clone(), x.landmark.clone())) && matches!(x.check.outcome, Outcome::Review { .. } | Outcome::Conflict { .. })).count();
            assert_eq!(caught, keys.len());
            for (f, _) in &keys { let p = moved.iter().find(|m| &m.film == f).unwrap(); let q = guess(p, AZ, "S", 15).unwrap();
                assert!(((q.x.hypot(q.y)) * 0.1 - 5.0).abs() < 1e-9, "moved exactly 5 mm"); }
        });
    }
    /// Preflight c5: the table branch is reached only for a point the main model has and may place. L1A is a new point
    /// Aariz finds; even if a table named cwlachap for it, the placed point stays Aariz's (the 19 only).
    #[test] fn the_table_never_moves_a_new_point_that_the_main_model_may_place() {
        let f = film("f", &[(AZ, "L1A", 2.0, 2.0), (CW, "L1A", 3.0, 3.0)]);
        with(&[("L1A", CW)], &|_, _| true, |s| assert_eq!(placed(&f, "L1A", s).map(|g| (g.model_id, g.x)), Some((AZ.to_string(), 2.0))));
    }
    /// Preflight c13: the bench's "median of voters" and the app's key 4 are the same function — both suites read
    /// test-fixtures/geometric-median.json (cases: three points with an outlier, a triangle, two points) and must agree within 1e-6.
    #[test] fn the_geometric_median_matches_the_shared_fixture() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../../test-fixtures/geometric-median.json")).unwrap();
        for c in v["cases"].as_array().unwrap() {
            let pts: Vec<[f64; 2]> = c["points"].as_array().unwrap().iter().map(|p| [p[0].as_f64().unwrap(), p[1].as_f64().unwrap()]).collect();
            let m = geometric_median(&pts);
            assert!((m[0] - c["median"][0].as_f64().unwrap()).abs() < 1e-6 && (m[1] - c["median"][1].as_f64().unwrap()).abs() < 1e-6, "{c} → {m:?}");
        }
    }
    #[test] fn the_geometric_median_ignores_the_odd_one_out() {
        let m = geometric_median(&[[0.0, 0.0], [1.0, 0.0], [100.0, 0.0]]);
        assert!((m[0] - 1.0).abs() < 1e-3 && m[1].abs() < 1e-6, "{m:?}");
        assert_eq!(geometric_median(&[[2.0, 4.0], [4.0, 8.0]]), [3.0, 6.0], "two points: the midpoint");
    }
    /// Preflight c14: the tuning's coverage test uses the same Σ as the rule (`Params::sigma`): sweeping the gap, both say
    /// "inside" at exactly the same gaps.
    #[test] fn the_tuning_coverage_uses_the_rules_own_sigma() {
        let p = Params { k: [(SR.to_string(), 2.0)].into(), ..ceph_infer::crosscheck::draft_params() };
        let cov = [1.0, 0.5, 2.0];
        for dx in 0..30 {
            let g = Guess { model_id: SR.into(), x: dx as f64, y: 1.0, cov: Some(cov) };
            let [xx, xy, yy] = p.sigma(&g, 0.1);
            let (gx, gy) = (dx as f64, 1.0);
            let rule = (yy * gx * gx - 2.0 * xy * gx * gy + xx * gy * gy) / (xx * yy - xy * xy) <= crate::tune::CHI2_95;
            assert_eq!(crate::tune::coverage_at(2.0, &[([gx, gy], cov, 0.1)], p.sigma0_mm) == 1.0, rule, "gap {dx} px");
        }
    }
    /// Q2 (spec §4): every model's own column, ghosts included, on the rows the voters can check.
    #[test] fn the_combining_table_scores_every_model_alone_including_the_ghosts() {
        let f = film("f", &[(AZ, "S", 0.0, 0.0), (SR, "S", 10.0, 0.0), (GU, "S", 200.0, 0.0), (CW, "S", 20.0, 0.0)]);
        with(&[], &|_, _| true, |s| {
            let c = combining(&[f], &gt(&[("f", "S", 0.0, 0.0)]), s, None);
            for m in [CW, GU, SR, AZ] { assert!(c.get(format!("alone: {m}")).is_some(), "{m}: {c}"); }
            assert_eq!(c["alone: gu2net-isbi19"]["mre"], 20.0);
            assert_eq!(c["average of voters"]["mre"], 0.5, "the ghosts are not averaged in: midpoint of Aariz and SRPose");
        });
    }
    #[test] fn the_spread_weighted_average_leans_to_the_surer_model() {
        let a = Guess { model_id: SR.into(), x: 0.0, y: 0.0, cov: Some([1.0, 0.0, 1.0]) };
        let b = Guess { model_id: AZ.into(), x: 10.0, y: 0.0, cov: Some([9.0, 0.0, 9.0]) };
        let p = ceph_infer::crosscheck::draft_params();
        let w = spread_weighted(&[a, b], 0.1, &p).unwrap();
        assert!(w[0] < 5.0 && w[0] > 0.0, "{w:?}");
    }
    /// Task 6 fix round 1 (review I1): `fit_k` refuses any broken sample, so `k_samples` must leave each one out and
    /// count it by reason (prereg step 2). One broken spread must never stop the tuning.
    #[test] fn one_broken_spread_is_left_out_and_counted_not_fatal() {
        let mut films: Vec<FilmRun> = (0..30).map(|i| film(&format!("f{i}"), &[(AZ, "S", (i % 5) as f64, 0.0)])).collect();
        let set = |f: &mut FilmRun, c: Option<[f64; 3]>| f.models.get_mut(AZ).unwrap().as_mut().unwrap().get_mut("S").unwrap().cov.insert(15, c);
        set(&mut films[0], Some([1.0, 5.0, 1.0]));                     // not a real oval (|xy| > √(xx·yy))
        set(&mut films[1], None);                                      // no spread
        films[2].mm_per_px = 0.0;                                      // bad scale
        films[3].models.get_mut(AZ).unwrap().as_mut().unwrap().get_mut("S").unwrap().x = f64::NAN;   // offset not a number
        let g: Points = (0..30).map(|i| (format!("f{i}"), vec![("S".to_string(), 0.0, 0.0)])).collect();
        let (ks, ex) = k_samples(&films, &g, AZ, 15);
        assert_eq!(ks.len(), 26);
        assert_eq!(ex, KExcluded { no_spread: 1, bad_scale: 1, not_real_oval: 1, bad_offset: 1 });
        assert!(crate::tune::fit_k(&ks, 0.3).is_ok(), "the fit runs on what is left");
        assert!(crate::tune::fit_k(&films.iter().flat_map(|f| { let g = guess(f, AZ, "S", 15)?; Some(([g.x, g.y], g.cov?, f.mm_per_px)) }).collect::<Vec<_>>(), 0.3).is_err(),
            "positive control: unfiltered, the same samples stop the fit");
    }
    /// Task 6 fix round 1: `auroc` gives no value if any score is not a finite number, so a checked row with no finite
    /// D² is left out of the AUROC (and Spearman) and counted, not allowed to wipe out the whole AUROC.
    #[test] fn a_checked_row_with_no_finite_d2_is_left_out_of_the_auroc_and_counted() {
        let fa = film("a", &[(AZ, "S", 30.0, 0.0), (SR, "S", 1.0, 0.0)]);
        let fb = film("b", &[(AZ, "S", 0.0, 0.0), (SR, "S", 0.0, 1.0)]);
        let fc = film("c", &[(AZ, "S", 0.0, 0.0), (SR, "S", 1.0, 0.0)]);
        let g = gt(&[("a", "S", 0.0, 0.0), ("b", "S", 0.0, 0.0), ("c", "S", 0.0, 0.0)]);
        with(&[], &|_, _| true, |s| {
            let mut r = rows(&[fa, fb, fc], &g, s);
            let i = r.iter().position(|x| x.film == "c").unwrap();
            r[i].check.max_d2 = Some(f64::NAN);
            let m = metrics(&r, &|_| true).unwrap();
            assert_eq!((m.checked, m.checked_unscored), (3, 1));
            assert_eq!(m.auroc.estimate, 1.0, "scored on the two finite rows");
        });
    }
    /// Ruling (Task 6 fix round 1): per-landmark catch rate and flag rate for the owner's catch-target table.
    /// Unchecked off points count as missed on a landmark both voters see; a one-voter landmark has no catch rate.
    #[test] fn per_landmark_rates_count_unchecked_off_points_as_missed_and_skip_one_voter_landmarks() {
        let fa = film("a", &[(AZ, "S", 30.0, 0.0), (SR, "S", 1.0, 0.0)]);
        let fb = film("b", &[(AZ, "S", 0.0, 0.0), (SR, "S", 0.0, 1.0)]);
        let fd = film("d", &[(AZ, "S", 30.0, 0.0)]);                      // off, SRPose silent → not checked → missed
        let fc = film("c", &[(SR, "Ba", 30.0, 0.0)]);
        let g = gt(&[("a", "S", 0.0, 0.0), ("b", "S", 0.0, 0.0), ("d", "S", 0.0, 0.0), ("c", "Ba", 0.0, 0.0)]);
        with(&[], &|_, _| true, |s| {
            let pl = per_landmark(&rows(&[fa, fb, fd, fc], &g, s), &|lm| lm != "Ba");
            assert_eq!(pl["S"], LandmarkRates { off: 2, flagged_off: 1, sensitivity: Some(0.5), checked: 2, flagged: 1, burden: Some(0.5) });
            assert_eq!((pl["Ba"].sensitivity, pl["Ba"].burden), (None, None));
        });
    }
    /// Edge case (brief): the planted control failing stops the run, saying the instrument is blind. With a T no gap can
    /// exceed, the check sees nothing, so the same 5 mm slips go unflagged and `not_blind` refuses.
    #[test] fn a_planted_control_that_sees_nothing_stops_as_blind() {
        let films: Vec<FilmRun> = (0..60).map(|i| film(&format!("f{i}"), &[(AZ, "S", 0.0, 0.0), (SR, "S", 0.0, 0.5)])).collect();
        let g: Points = (0..60).map(|i| (format!("f{i}"), vec![("S".to_string(), 0.0, 0.0)])).collect();
        with(&[], &|_, _| true, |s| {
            let (moved, flagged) = planted_control(&films, &g, s);
            assert!(moved > 0 && flagged == moved, "control: the draft values see every slip ({flagged} of {moved})");
            assert!(not_blind(moved, flagged).is_ok());
        });
        let blind = Params { t_default: 1e12, ..ceph_infer::crosscheck::draft_params() };
        let (src, ord, v) = (BTreeMap::new(), order(), voters());
        let s = Setup { main: AZ, source: &src, order: &ord, placeable: &|_, _| true, voters: &v, window: 15, params: &blind };
        let (moved, flagged) = planted_control(&films, &g, &s);
        assert_eq!(flagged, 0);
        let e = not_blind(moved, flagged).unwrap_err().to_string();
        assert!(e.contains("blind"), "{e}");
        assert!(not_blind(0, 0).is_err(), "nothing moved is never a pass");
        assert!(not_blind(10, 5).is_err() && not_blind(10, 6).is_ok(), "more than half, not half");
    }
    /// Task 7 Step 7 finding: with the untuned draft values (k 1) Aariz's ovals are about three times its real error, so
    /// the draft-value control is blind by construction. The pre-registered control (prereg step 4) is the one with the
    /// TUNED values and stays a hard stop (`not_blind`); the draft-value result is recorded, never silently dropped.
    #[test] fn the_draft_value_control_is_recorded_with_its_verdict_and_does_not_gate() {
        let r = draft_control_record(213, 14);
        assert_eq!((r["moved"].as_u64(), r["flagged"].as_u64(), r["blind"].as_bool(), r["gating"].as_bool()), (Some(213), Some(14), Some(true), Some(false)));
        assert_eq!(draft_control_record(10, 6)["blind"].as_bool(), Some(false));
        assert!(not_blind(213, 14).is_err(), "the same counts would stop the run with the tuned values");
    }
    /// Edge case (brief): a landmark a model does not find is neither a k sample nor an exclusion, and is not placed by it.
    #[test] fn a_landmark_a_model_does_not_find_is_neither_a_sample_nor_counted() {
        let films: Vec<FilmRun> = (0..12).map(|i| film(&format!("f{i}"), &[(AZ, "S", (i % 3) as f64, 0.0), (SR, "Ba", 0.0, 0.0)])).collect();
        let g: Points = (0..12).map(|i| (format!("f{i}"), vec![("S".to_string(), 0.0, 0.0), ("Ba".to_string(), 0.0, 0.0)])).collect();
        let (ks, ex) = k_samples(&films, &g, AZ, 15);
        assert_eq!((ks.len(), ex), (12, KExcluded::default()), "Aariz has no Ba: 12 S samples, nothing left out");
        assert_eq!(guess(&films[0], AZ, "Ba", 15), None);
    }
}
