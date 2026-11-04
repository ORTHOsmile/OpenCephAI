//! The tuning rule (pre-registered in docs/prereg/2026-10-13-crosscheck-pass-rule.md), as pure functions.
use ceph_infer::crosscheck::{params, real_oval, scale_ok, Guess};

pub const WINDOWS: [usize; 4] = [7, 11, 15, 21];
pub const SIGMA0_MM: [f64; 4] = [0.1, 0.2, 0.3, 0.5];
pub const T_GRID: [f64; 11] = [2.0, 3.0, 4.0, 5.99, 7.0, 9.21, 11.0, 13.8, 16.0, 20.0, 25.0];
pub const CHI2_95: f64 = 5.99;
pub const COVERAGE: f64 = 0.95;
pub const MIN_POSITIVES: usize = 10;
pub const PLANT_ONE_IN: usize = 10;
pub const PLANT_MM: f64 = 5.0;
pub const PLANT_CATCH_ABOVE: f64 = 0.5;
/// The models whose k is fitted (prereg step 2): the two voters and cwlachap (it places the source table's points).
pub const FIT_K_FOR: [&str; 3] = ["srpose-cldet23", "aariz-cepha29", "cwlachap-hrnet-w32"];

/// (model point − truth in px, the model's spread in px², the film's mm per px). There is no "missing spread": the
/// caller leaves a point with no spread out, and counts it, before building samples.
pub type KSample = ([f64; 2], [f64; 3], f64);

/// True when a sample can be measured: a finite offset, a spread that is a real oval, and a usable scale.
fn usable(s: &KSample) -> bool { s.0.iter().all(|v| v.is_finite()) && real_oval(s.1) && scale_ok(s.2) }

/// D² of one sample to the truth with k and σ₀, the truth having no spread of its own. The oval is the rule file's
/// own formula, `Params::sigma` (k·cov + σ₀² I, one formula, preflight c14). NaN when it cannot be measured.
fn d2_to_truth(k: f64, s: &KSample, sigma0_mm: f64) -> f64 {
    if !usable(s) { return f64::NAN; }
    let mut p = params().clone();
    p.sigma0_mm = sigma0_mm;
    p.k = [("fit".to_string(), k)].into_iter().collect();
    let g = p.sigma(&Guess { model_id: "fit".into(), x: 0.0, y: 0.0, cov: Some(s.1) }, s.2);
    let det = g[0] * g[2] - g[1] * g[1];
    if !(det > 0.0 && g[0] > 0.0) { return f64::NAN; }
    let d = s.0;
    let q = (g[2] * d[0] * d[0] - 2.0 * g[1] * d[0] * d[1] + g[0] * d[1] * d[1]) / det;
    if q.is_finite() { q.max(0.0) } else { f64::NAN }
}

/// Share of samples with D² ≤ 5.99 to the truth. A sample that cannot be measured (spread not a real oval, bad scale)
/// is never counted as inside: it is not treated as the tightest oval (Task 5 review, deferred minor).
pub fn coverage_at(k: f64, samples: &[KSample], sigma0_mm: f64) -> f64 {
    let inside = samples.iter().filter(|s| d2_to_truth(k, s, sigma0_mm) <= CHI2_95).count();
    inside as f64 / samples.len().max(1) as f64
}

/// The smallest k reaching the coverage target (bisection on log k in [0.001, 1000], 60 steps). Errors: no samples;
/// any sample that cannot be measured (the caller must leave those out and count them); the target out of reach.
pub fn fit_k(samples: &[KSample], sigma0_mm: f64) -> anyhow::Result<f64> {
    anyhow::ensure!(!samples.is_empty(), "no points to fit k on");
    let bad = samples.iter().filter(|s| !usable(s)).count();
    anyhow::ensure!(bad == 0, "{bad} of {} points have a spread that is not a real oval or no usable scale: leave them out and count them", samples.len());
    let (mut lo, mut hi) = (1e-3f64.ln(), 1e3f64.ln());
    anyhow::ensure!(coverage_at(hi.exp(), samples, sigma0_mm) >= COVERAGE, "even k = 1000 holds fewer than 95% of the true points: the spread does not describe this model's error");
    if coverage_at(lo.exp(), samples, sigma0_mm) >= COVERAGE { return Ok(lo.exp()); }
    for _ in 0..60 { let mid = 0.5 * (lo + hi); if coverage_at(mid.exp(), samples, sigma0_mm) >= COVERAGE { hi = mid } else { lo = mid } }
    Ok(hi.exp())
}

/// T for one landmark at a catch target (ruling, Task 6 fix round 1): the largest grid value still catching
/// at least `target` on valid; the smallest if none does; None (keep the default 5.99) with fewer than 10 points off.
pub fn pick_t_at(target: f64, positives: usize, sensitivity_at: &dyn Fn(f64) -> Option<f64>) -> Option<f64> {
    if positives < MIN_POSITIVES { return None; }
    Some(T_GRID.iter().rev().copied().find(|&t| sensitivity_at(t).is_some_and(|s| s >= target)).unwrap_or(T_GRID[0]))
}

/// T for one landmark at the pre-registered catch target (prereg step 3, `SENS_MIN` 0.90).
pub fn pick_t(positives: usize, sensitivity_at: &dyn Fn(f64) -> Option<f64>) -> Option<f64> { pick_t_at(crate::passrule::SENS_MIN, positives, sensitivity_at) }

#[cfg(test)]
mod tests {
    use super::*;
    const PREREG_RAW: &str = include_str!("../../../docs/prereg/2026-10-13-crosscheck-pass-rule.md");
    /// The prereg with every run of spaces and line breaks made one space, so a phrase the Markdown wraps still matches.
    static PREREG_FLAT: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| PREREG_RAW.split_whitespace().collect::<Vec<_>>().join(" "));
    #[test] fn the_grids_and_numbers_are_the_pre_registered_ones() {
        assert!(PREREG_FLAT.contains("window `7, 11, 15, 21`") && WINDOWS == [7, 11, 15, 21]);
        assert!(PREREG_FLAT.contains("σ₀ `0.1, 0.2, 0.3, 0.5`") && SIGMA0_MM == [0.1, 0.2, 0.3, 0.5]);
        assert!(PREREG_FLAT.contains("`2.0, 3.0, 4.0, 5.99, 7.0, 9.21, 11.0, 13.8, 16.0, 20.0, 25.0`") && T_GRID == [2.0, 3.0, 4.0, 5.99, 7.0, 9.21, 11.0, 13.8, 16.0, 20.0, 25.0]);
        assert!(PREREG_FLAT.contains(&format!("at least `{COVERAGE}`")) && PREREG_FLAT.contains(&format!("≤ `{CHI2_95}`")) && PREREG_FLAT.contains(&format!("`{MIN_POSITIVES}` placed points")));
        assert!(PREREG_FLAT.contains(&format!("one placed point in `{PLANT_ONE_IN}`")) && PREREG_FLAT.contains(&format!("moved `{PLANT_MM:.1}` mm")) && PREREG_FLAT.contains(&format!("more than `{PLANT_CATCH_ABOVE}`")));
        assert!(PREREG_FLAT.contains(&format!("2. k for {}", FIT_K_FOR.map(|m| format!("`{m}`")).join(", ").replacen(", `cwlachap", " and `cwlachap", 1))), "prereg step 2 names the fitted models");
        assert!(PREREG_FLAT.contains("heat-map cells"), "the window's unit");
    }
    /// The window must be one the rule file accepts (odd, at least 3), so every grid value can be written to it.
    #[test] fn every_window_is_one_the_rule_file_accepts() {
        for w in WINDOWS {
            let j = ceph_infer::crosscheck::DRAFT_JSON.replace("\"spreadWindowCells\": 15", &format!("\"spreadWindowCells\": {w}"));
            assert!(ceph_infer::crosscheck::parse_params(&j).is_ok(), "window {w}");
        }
    }
    /// Points whose error is 1.0 to 2.9 px round, in every direction, with no spread of their own: the k that holds
    /// 95% inside D² ≤ 5.99 is known in closed form when σ₀ is negligible.
    #[test] fn fit_k_finds_the_coverage_target_and_coverage_grows_with_k() {
        let s: Vec<KSample> = (0..200).map(|i| { let a = i as f64 * 0.0314; let r = 1.0 + (i % 20) as f64 * 0.1; ([r * a.cos(), r * a.sin()], [1.0, 0.0, 1.0], 0.1) }).collect();
        let k = fit_k(&s, 1e-6).unwrap();
        assert!(coverage_at(k, &s, 1e-6) >= COVERAGE && coverage_at(k * 0.98, &s, 1e-6) < COVERAGE, "k {k}");
        assert!(coverage_at(0.01, &s, 1e-6) <= coverage_at(1.0, &s, 1e-6));
        // Closed form: 95% of radii are ≤ 2.8 px (190 of 200), so k = 2.8² / 5.99.
        assert!((k - 2.8f64.powi(2) / CHI2_95).abs() < 1e-6, "k {k}");
    }
    #[test] fn fit_k_reports_a_target_it_cannot_reach() {
        let s: Vec<KSample> = vec![([1e9, 0.0], [1e-9, 0.0, 1e-9], 0.1); 20];
        assert!(fit_k(&s, 1e-6).is_err());
    }
    #[test] fn fit_k_refuses_no_points() {
        assert!(fit_k(&[], 0.3).is_err());
    }
    /// Already inside at the smallest k: the answer is the bottom of the search, not something below it.
    #[test] fn fit_k_returns_the_lower_bound_when_every_point_is_already_inside() {
        let s: Vec<KSample> = vec![([0.0, 0.0], [1.0, 0.0, 1.0], 0.1); 20];
        assert!((fit_k(&s, 0.3).unwrap() - 1e-3).abs() < 1e-12);
    }
    /// Task 5's deferred minor, made explicit here: a spread that is not a real oval, or a film with no usable scale,
    /// is never counted as "inside" (it is never treated as the tightest oval), and fit_k refuses to fit on it, naming
    /// how many. The caller leaves points with no spread out before building samples (KSample has no "missing").
    #[test] fn a_spread_that_is_not_a_real_oval_or_a_bad_scale_is_never_inside_and_fit_k_refuses_it() {
        let good: KSample = ([0.1, 0.0], [1.0, 0.0, 1.0], 0.1);
        for bad in [([0.1, 0.0], [1.0, 5.0, 1.0], 0.1), ([0.1, 0.0], [-1.0, 0.0, 1.0], 0.1), ([0.1, 0.0], [f64::NAN, 0.0, 1.0], 0.1),
            ([0.1, 0.0], [1.0, 0.0, 1.0], 0.0), ([0.1, 0.0], [1.0, 0.0, 1.0], f64::NAN), ([f64::NAN, 0.0], [1.0, 0.0, 1.0], 0.1)] {
            assert_eq!(coverage_at(1.0, &[bad], 0.3), 0.0, "{bad:?}");
            assert_eq!(coverage_at(1.0, &[good, bad], 0.3), 0.5, "{bad:?}");
            let e = fit_k(&[good, bad], 0.3).unwrap_err().to_string();
            assert!(e.contains("1 of 2"), "{e}");
        }
        assert_eq!(coverage_at(1.0, &[good], 0.3), 1.0);
    }
    /// One spread formula (preflight c14): the model's oval here is exactly `Params::sigma` with this k and σ₀.
    #[test] fn coverage_uses_the_rule_files_spread_formula() {
        use ceph_infer::crosscheck::{parse_params, Guess, DRAFT_JSON};
        let (k, s0, mm) = (2.5, 0.2, 0.08);
        let p = parse_params(&DRAFT_JSON.replace("\"sigma0Mm\": 0.3", &format!("\"sigma0Mm\": {s0}")).replace("\"srpose-cldet23\": 1.0", &format!("\"srpose-cldet23\": {k}"))).unwrap();
        let c = [3.0, 1.2, 2.0];
        let sg = p.sigma(&Guess { model_id: "srpose-cldet23".into(), x: 0.0, y: 0.0, cov: Some(c) }, mm);
        // A point exactly on the D² = 5.99 boundary of that oval along x, nudged in and out.
        let det = sg[0] * sg[2] - sg[1] * sg[1];
        let on = (CHI2_95 * det / sg[2]).sqrt();
        assert_eq!(coverage_at(k, &[([on * 0.999, 0.0], c, mm)], s0), 1.0);
        assert_eq!(coverage_at(k, &[([on * 1.001, 0.0], c, mm)], s0), 0.0);
        // Along the diagonals too, so the cross term's sign matters: (1, 1) lies along this oval's long axis (xy > 0),
        // (1, −1) across it. uᵀ Σ⁻¹ u with Σ⁻¹ = [[yy, −xy], [−xy, xx]] / det.
        for (ux, uy) in [(1.0, 1.0), (1.0, -1.0)] {
            let q = (sg[2] * ux * ux - 2.0 * sg[1] * ux * uy + sg[0] * uy * uy) / det;
            let t = (CHI2_95 / q).sqrt();
            assert_eq!(coverage_at(k, &[([t * 0.999 * ux, t * 0.999 * uy], c, mm)], s0), 1.0, "({ux}, {uy}) inside");
            assert_eq!(coverage_at(k, &[([t * 1.001 * ux, t * 1.001 * uy], c, mm)], s0), 0.0, "({ux}, {uy}) outside");
        }
    }
    #[test] fn pick_t_takes_the_largest_t_still_catching_90_percent_and_needs_10_off_points() {
        let sens = |t: f64| Some(if t <= 7.0 { 0.95 } else { 0.85 });
        assert_eq!(pick_t(12, &sens), Some(7.0));
        assert_eq!(pick_t(9, &sens), None);
        assert_eq!(pick_t(10, &sens), Some(7.0), "exactly 10 off points is enough");
        assert_eq!(pick_t(12, &|_| Some(0.5)), Some(2.0), "none reaches 0.90: the smallest T");
        assert_eq!(pick_t(12, &|t| Some(if t <= 9.21 { 0.90 } else { 0.8999 })), Some(9.21), "exactly 0.90 counts");
        assert_eq!(pick_t(12, &|_| None), Some(2.0), "no value anywhere: the smallest T");
        assert_eq!(pick_t(12, &|_| Some(1.0)), Some(25.0));
    }
    /// Ruling (Task 6 fix round 1): the same pick at other catch targets, for the owner's table; 0.90 is the
    /// pre-registered one and must give exactly `pick_t`'s answer.
    #[test] fn pick_t_at_other_catch_targets_and_0_90_is_pick_t() {
        let sens = |t: f64| Some(if t <= 4.0 { 0.96 } else if t <= 7.0 { 0.93 } else { 0.90 });
        assert_eq!(pick_t_at(0.90, 12, &sens), Some(25.0));
        assert_eq!(pick_t_at(0.93, 12, &sens), Some(7.0));
        assert_eq!(pick_t_at(0.95, 12, &sens), Some(4.0));
        assert_eq!(pick_t_at(0.97, 12, &sens), Some(2.0), "none reaches it: the smallest T");
        assert_eq!(pick_t_at(0.95, 9, &sens), None);
        for p in [9, 12] { assert_eq!(pick_t(p, &sens), pick_t_at(crate::passrule::SENS_MIN, p, &sens)); }
    }
}
