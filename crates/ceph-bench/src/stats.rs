//! Bootstrap confidence intervals over films (spec 2026-10-13 §5.2, §7). Films are resampled whole, because points on
//! one film are not independent. A fixed seed gives the same interval on every rerun.

/// SplitMix64 (Steele, Lea & Flood 2014; Vigna's reference code): small and fully specified, so the pre-registered
/// seed draws the same films on every machine. No new dependency.
pub struct SplitMix64(u64);
impl SplitMix64 {
    pub fn new(seed: u64) -> Self { Self(seed) }
    pub fn next_u64(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    /// Uniform in 0..n (n > 0), by rejection, so no index is favoured.
    pub fn below(&mut self, n: usize) -> usize {
        assert!(n > 0, "below(0)");
        let n64 = n as u64;
        let zone = u64::MAX - (u64::MAX % n64);
        loop { let v = self.next_u64(); if v < zone { return (v % n64) as usize; } }
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Ci { pub estimate: f64, pub lo: f64, pub hi: f64, pub resamples: usize, pub resamples_used: usize }

/// Percentile bootstrap over films (prereg docs): `resamples` draws of `films.len()` films with replacement; `stat` on
/// each; the interval is the draws sorted, lower end at floor(0.025·m), upper end at ceil(0.975·m) − 1 (m = draws that
/// gave a value). A draw where `stat` has no value is counted (`resamples_used` is lower), never invented. Errors: no
/// films, no value on the full sample, no draw with a value, or a non-finite value.
pub fn bootstrap<T>(films: &[T], resamples: usize, seed: u64, stat: impl Fn(&[&T]) -> Option<f64>) -> anyhow::Result<Ci> {
    anyhow::ensure!(!films.is_empty(), "no films to resample");
    anyhow::ensure!(resamples > 0, "resamples must be at least 1");
    let all: Vec<&T> = films.iter().collect();
    let estimate = stat(&all).ok_or_else(|| anyhow::anyhow!("the statistic has no value on the full sample"))?;
    anyhow::ensure!(estimate.is_finite(), "the statistic is {estimate} on the full sample");
    let mut rng = SplitMix64::new(seed);
    let (mut draws, mut pick) = (Vec::with_capacity(resamples), Vec::with_capacity(films.len()));
    for _ in 0..resamples {
        pick.clear();
        for _ in 0..films.len() { pick.push(&films[rng.below(films.len())]); }
        if let Some(v) = stat(&pick) {
            anyhow::ensure!(v.is_finite(), "the statistic gave {v} on a resample");
            draws.push(v);
        }
    }
    anyhow::ensure!(!draws.is_empty(), "no resample gave a value");
    draws.sort_by(f64::total_cmp);
    let m = draws.len();
    let lo = draws[((0.025 * m as f64).floor() as usize).min(m - 1)];
    let hi = draws[((0.975 * m as f64).ceil() as usize).saturating_sub(1).min(m - 1)];
    Ok(Ci { estimate, lo, hi, resamples, resamples_used: m })
}

/// Average ranks (1-based); tied values share the mean of their ranks.
fn ranks(v: &[f64]) -> Vec<f64> {
    let mut idx: Vec<usize> = (0..v.len()).collect();
    idx.sort_by(|&a, &b| v[a].total_cmp(&v[b]));
    let mut r = vec![0.0; v.len()];
    let mut i = 0;
    while i < idx.len() {
        let mut j = i;
        while j + 1 < idx.len() && v[idx[j + 1]] == v[idx[i]] { j += 1; }
        for &k in &idx[i..=j] { r[k] = (i + j) as f64 / 2.0 + 1.0; }
        i = j + 1;
    }
    r
}

/// Mann–Whitney AUROC (spec §7): the chance that a point more than 2 mm off scores higher than one that is not; ties
/// count half. `scored` is (score, off). None without both groups (no point off, or every point off), and None if any
/// score is not a finite number (a D² that could not be measured is never ranked).
pub fn auroc(scored: &[(f64, bool)]) -> Option<f64> {
    if scored.iter().any(|s| !s.0.is_finite()) { return None; }
    let np = scored.iter().filter(|s| s.1).count();
    let nn = scored.len() - np;
    if np == 0 || nn == 0 { return None; }
    let r = ranks(&scored.iter().map(|s| s.0).collect::<Vec<_>>());
    let sum_pos: f64 = scored.iter().zip(&r).filter(|(s, _)| s.1).map(|(_, r)| *r).sum();
    Some((sum_pos - (np * (np + 1)) as f64 / 2.0) / (np as f64 * nn as f64))
}

/// Spearman's ρ (Pearson on average ranks). None if the lengths differ, there are fewer than two pairs, a value is not
/// finite, or either side is constant.
pub fn spearman(a: &[f64], b: &[f64]) -> Option<f64> {
    if a.len() != b.len() || a.len() < 2 || a.iter().chain(b).any(|v| !v.is_finite()) { return None; }
    let (ra, rb) = (ranks(a), ranks(b));
    let n = a.len() as f64;
    let (ma, mb) = (ra.iter().sum::<f64>() / n, rb.iter().sum::<f64>() / n);
    let cov: f64 = ra.iter().zip(&rb).map(|(x, y)| (x - ma) * (y - mb)).sum();
    let (va, vb): (f64, f64) = (ra.iter().map(|x| (x - ma).powi(2)).sum(), rb.iter().map(|y| (y - mb).powi(2)).sum());
    if va == 0.0 || vb == 0.0 { None } else { Some(cov / (va * vb).sqrt()) }
}

/// The exact (Clopper-Pearson) 95% interval for k successes in n trials (SC-1 Part 1b, M18): the lower end is the p at
/// which P(X >= k) = 0.025 (0 when k = 0), the upper end the p at which P(X <= k) = 0.025 (1 when k = n); each found by
/// bisection on the binomial tail, summed in logs. n = 0 or k > n is an error, never a NaN or a panic.
pub fn clopper_pearson(k: usize, n: usize) -> anyhow::Result<(f64, f64)> {
    anyhow::ensure!(n > 0, "an interval needs at least one trial (n = 0)");
    anyhow::ensure!(k <= n, "{k} successes in {n} trials: k is more than n");
    const TAIL: f64 = 0.025;
    // P(X <= j) under p, for 0 < p < 1, summed in logs: ln C(n, i) built up one i at a time.
    let cdf = |j: usize, p: f64| -> f64 {
        let (lp, lq) = (p.ln(), (1.0 - p).ln());
        let mut lc = 0.0;
        let mut s = 0.0;
        for i in 0..=j {
            if i > 0 { lc += ((n - i + 1) as f64).ln() - (i as f64).ln(); }
            s += (lc + i as f64 * lp + (n - i) as f64 * lq).exp();
        }
        s.min(1.0)
    };
    // Bisection on a tail that falls as p rises: the p in (0, 1) where `tail(p)` crosses TAIL.
    let solve = |tail: &dyn Fn(f64) -> f64| -> f64 {
        let (mut a, mut b) = (0.0f64, 1.0f64);
        for _ in 0..200 { let m = 0.5 * (a + b); if tail(m) > TAIL { a = m } else { b = m } }
        0.5 * (a + b)
    };
    // Lower end: P(X >= k) = TAIL, i.e. P(X <= k - 1) = 1 - TAIL; P(X <= k - 1) falls as p rises, so shift it by
    // (1 - TAIL) - TAIL to cross TAIL at that same p.
    let lo = if k == 0 { 0.0 } else { solve(&|p| cdf(k - 1, p) - (1.0 - TAIL) + TAIL) };
    let hi = if k == n { 1.0 } else { solve(&|p| cdf(k, p)) };
    anyhow::ensure!(lo.is_finite() && hi.is_finite() && lo <= hi, "the interval for {k} of {n} came out ({lo}, {hi})");
    Ok((lo, hi))
}

#[cfg(test)]
mod tests {
    use super::*;
    /// (0, 102): the upper end is 1 - 0.025^(1/102) exactly (fails if: the tail is P(X < k), or the 2.5% is 5%).
    #[test] fn clopper_pearson_at_zero_of_102() {
        let (lo, hi) = clopper_pearson(0, 102).unwrap();
        eprintln!("0 of 102: ({lo}, {hi}); 1 - 0.025^(1/102) = {}", 1.0 - 0.025f64.powf(1.0 / 102.0));
        assert_eq!(lo, 0.0);
        assert!((hi - 0.035519).abs() < 1e-5 && (hi - (1.0 - 0.025f64.powf(1.0 / 102.0))).abs() < 1e-9, "{hi}");
    }
    /// Known values to 4 decimals: (2, 102) (0.0024, 0.0690); (11, 300) (0.0184, 0.0647) (fails if: the two tails swap).
    #[test] fn clopper_pearson_known_values() {
        for (k, n, want) in [(2usize, 102usize, (0.0024, 0.0690)), (11, 300, (0.0184, 0.0647))] {
            let (lo, hi) = clopper_pearson(k, n).unwrap();
            eprintln!("{k} of {n}: ({lo:.5}, {hi:.5})");
            assert!((lo - want.0).abs() < 5e-5 && (hi - want.1).abs() < 5e-5, "{k} of {n}: ({lo}, {hi}) not {want:?}");
        }
    }
    /// k = n: the upper end is 1 and the lower is 0.025^(1/n); n = 0 and k > n are errors (fails if: n = 0 returns NaN).
    #[test] fn clopper_pearson_edges() {
        let (lo, hi) = clopper_pearson(102, 102).unwrap();
        eprintln!("102 of 102: ({lo}, {hi})");
        assert_eq!(hi, 1.0);
        assert!((lo - 0.025f64.powf(1.0 / 102.0)).abs() < 1e-9, "{lo}");
        let (lo, hi) = clopper_pearson(2289, 2740).unwrap();
        eprintln!("2289 of 2740: ({lo:.4}, {hi:.4})");
        assert!(lo < 2289.0 / 2740.0 && hi > 2289.0 / 2740.0 && lo > 0.8 && hi < 0.86, "({lo}, {hi})");
        for (k, n) in [(0usize, 0usize), (3, 2)] {
            let e = clopper_pearson(k, n).unwrap_err().to_string();
            eprintln!("({k}, {n}): {e}");
            assert!(e.contains("trial") || e.contains("more than"), "{e}");
        }
    }
    #[test] fn splitmix64_matches_the_reference_first_output_for_seed_0() {
        // Vigna's reference splitmix64.c, state 0: the first output is 0xE220A8397B1DCDAF.
        assert_eq!(SplitMix64::new(0).next_u64(), 0xE220_A839_7B1D_CDAF);
    }
    #[test] fn the_same_seed_gives_the_same_draws_and_another_seed_does_not() {
        let (mut a, mut b, mut c) = (SplitMix64::new(20_261_013), SplitMix64::new(20_261_013), SplitMix64::new(7));
        let (x, y, z): (Vec<u64>, Vec<u64>, Vec<u64>) = ((0..5).map(|_| a.next_u64()).collect(), (0..5).map(|_| b.next_u64()).collect(), (0..5).map(|_| c.next_u64()).collect());
        assert_eq!(x, y);
        assert_ne!(x, z);
    }
    #[test] fn below_stays_in_range_and_is_roughly_uniform() {
        let mut r = SplitMix64::new(1);
        let mut n = [0usize; 7];
        for _ in 0..70_000 { n[r.below(7)] += 1; }
        assert!(n.iter().all(|&k| (9_000..11_000).contains(&k)), "{n:?}");
    }
    fn mean(s: &[&f64]) -> Option<f64> { if s.is_empty() { None } else { Some(s.iter().copied().sum::<f64>() / s.len() as f64) } }
    #[test] fn a_constant_sample_gives_a_zero_width_interval_at_that_value() {
        let ci = bootstrap(&[2.5f64; 40], 2000, 1, mean).unwrap();
        assert_eq!((ci.estimate, ci.lo, ci.hi, ci.resamples, ci.resamples_used), (2.5, 2.5, 2.5, 2000, 2000));
    }
    #[test] fn a_clear_positive_mean_gives_an_interval_above_zero_and_a_centred_one_crosses_zero() {
        let shifted: Vec<f64> = (0..150).map(|i| 1.0 + ((i % 11) as f64 - 5.0) * 0.1).collect();     // mean 1.0
        let centred: Vec<f64> = (0..150).map(|i| ((i % 11) as f64 - 5.0) * 0.1).collect();          // mean 0.0 (± a little)
        let a = bootstrap(&shifted, 2000, 20_261_013, mean).unwrap();
        let b = bootstrap(&centred, 2000, 20_261_013, mean).unwrap();
        assert!(a.lo > 0.0 && a.lo <= a.estimate && a.estimate <= a.hi, "{a:?}");
        assert!(b.lo < 0.0 && b.hi > 0.0, "{b:?}");
    }
    #[test] fn the_same_seed_gives_the_same_interval() {
        let v: Vec<f64> = (0..50).map(|i| (i as f64).sin()).collect();
        assert_eq!(bootstrap(&v, 500, 3, mean).unwrap(), bootstrap(&v, 500, 3, mean).unwrap());
    }
    #[test] fn draws_without_a_value_are_counted_not_invented() {
        // Only films equal to 1.0 count; a draw with none of them has no value.
        let v = [0.0, 0.0, 0.0, 1.0];
        let ci = bootstrap(&v, 1000, 5, |s| { let k: Vec<&&f64> = s.iter().filter(|x| ***x == 1.0).collect(); if k.is_empty() { None } else { Some(k.len() as f64) } }).unwrap();
        assert!(ci.resamples_used < 1000 && ci.resamples_used > 0, "{ci:?}");
    }
    #[test] fn no_films_or_no_value_is_an_error_not_a_number() {
        assert!(bootstrap::<f64>(&[], 10, 1, mean).is_err());
        assert!(bootstrap(&[1.0], 10, 1, |_| None).is_err());
    }
    // The prereg fixes the interval at floor(0.025·m) and ceil(0.975·m) − 1. A `stat` built on a counter makes the
    // draws' values known exactly, so the index — not just "an interval somewhere near the middle" — is pinned.
    #[test] fn the_interval_sits_at_the_pre_registered_percentile_indices() {
        let counter = std::cell::Cell::new(-1i64);
        let films = [0.0f64; 5];                                 // the films are never read; only the call count matters
        let ci = bootstrap(&films, 2000, 1, |_| { let c = counter.get() + 1; counter.set(c); Some(c as f64) }).unwrap();
        // call 1 (the full-sample estimate) returns 0.0; the 2000 resample calls return 1.0..=2000.0 in order, so the
        // sorted draws are exactly [1.0, 2.0, ..., 2000.0]. m = 2000: lo index floor(0.025·2000) = 50 -> value 51;
        // hi index ceil(0.975·2000) − 1 = 1949 -> value 1950 (checked by hand against the formula before asserting).
        assert_eq!(ci.resamples_used, 2000);
        assert_eq!((ci.lo, ci.hi), (51.0, 1950.0));
    }
    #[test] fn the_indices_hold_off_a_round_number_with_a_draw_that_has_no_value() {
        let (attempt, success) = (std::cell::Cell::new(0i64), std::cell::Cell::new(0i64));
        let films = [0.0f64; 5];
        let ci = bootstrap(&films, 1000, 1, |_| {
            let a = attempt.get() + 1; attempt.set(a);
            if a == 1 { return Some(0.0); }                      // the full-sample estimate call
            if a == 500 { return None; }                         // one resample with no value: counted, not invented
            let s = success.get() + 1; success.set(s);
            Some(s as f64)
        }).unwrap();
        // 1000 resample calls, 1 of them None, so m = resamples_used = 999 (odd, off the round 1000). The 999
        // successes return 1.0..=999.0 in order, so sorted draws are exactly [1.0, ..., 999.0]. lo index
        // floor(0.025·999) = 24 -> value 25; hi index ceil(0.975·999) − 1 = 974 -> value 975.
        assert_eq!(ci.resamples_used, 999);
        assert_eq!((ci.lo, ci.hi), (25.0, 975.0));
    }
    #[test] fn auroc_is_one_for_perfect_separation_zero_reversed_half_for_ties_and_none_without_both_groups() {
        assert_eq!(auroc(&[(1.0, false), (2.0, false), (3.0, true), (4.0, true)]), Some(1.0));
        assert_eq!(auroc(&[(4.0, false), (3.0, false), (2.0, true), (1.0, true)]), Some(0.0));
        assert_eq!(auroc(&[(1.0, false), (1.0, true), (1.0, false), (1.0, true)]), Some(0.5));
        assert_eq!(auroc(&[(1.0, false), (2.0, false)]), None, "no point over 2 mm: no AUROC, not 0.5");
        assert_eq!(auroc(&[(1.0, true), (2.0, true)]), None, "every point over 2 mm: no AUROC");
        assert_eq!(auroc(&[]), None);
    }
    /// Pairs (off, not off): (3,1) win, (3,2) win, (2,1) win, (2,2) tie = 3.5 of 4. A score that is not a number
    /// (a D² that could not be measured) is never ranked: no AUROC.
    #[test] fn auroc_counts_a_tied_pair_as_half_and_refuses_a_score_that_is_not_a_number() {
        assert_eq!(auroc(&[(1.0, false), (2.0, false), (2.0, true), (3.0, true)]), Some(0.875));
        assert_eq!(auroc(&[(1.0, false), (f64::NAN, true), (3.0, true)]), None);
        assert_eq!(auroc(&[(1.0, false), (f64::INFINITY, true)]), None);
    }
    #[test] fn spearman_is_one_for_any_increasing_relation_and_none_for_a_constant() {
        assert!((spearman(&[1.0, 2.0, 3.0, 10.0], &[1.0, 4.0, 9.0, 100.0]).unwrap() - 1.0).abs() < 1e-12);
        assert_eq!(spearman(&[1.0, 1.0, 1.0], &[1.0, 2.0, 3.0]), None);
    }
    #[test] fn spearman_is_minus_one_reversed_and_none_for_unequal_or_too_short_input() {
        assert!((spearman(&[1.0, 2.0, 3.0], &[30.0, 20.0, 10.0]).unwrap() + 1.0).abs() < 1e-12);
        assert_eq!(spearman(&[1.0, 2.0], &[1.0, 2.0, 3.0]), None);
        assert_eq!(spearman(&[1.0], &[1.0]), None);
        assert_eq!(spearman(&[1.0, f64::NAN, 3.0], &[1.0, 2.0, 3.0]), None);
    }
}
