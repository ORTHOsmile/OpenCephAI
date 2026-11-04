pub fn radial_error_mm(p: (f64, f64), g: (f64, f64), mm_per_px: f64) -> f64 { (p.0 - g.0).hypot(p.1 - g.1) * mm_per_px }
#[derive(Clone, Debug, serde::Serialize)] pub struct Summary { pub n: usize, pub mre: f64, pub sd: f64, pub sdr: Vec<(f64, f64)> }
pub fn summarize(e: &[f64], thresholds: &[f64]) -> Summary {
    let n = e.len(); let mre = e.iter().sum::<f64>() / n as f64;
    let sd = if n > 1 { (e.iter().map(|x| (x - mre).powi(2)).sum::<f64>() / (n - 1) as f64).sqrt() } else { 0.0 };
    let sdr = thresholds.iter().map(|&t| (t, e.iter().filter(|&&x| x <= t).count() as f64 / n as f64)).collect();
    Summary { n, mre, sd, sdr }
}

#[cfg(test)]
mod tests {
    use super::*;
#[test] fn summary_matches_hand_computation() {
    let s = summarize(&[1.0, 2.0, 3.0, 5.0], &[2.0, 2.5, 3.0, 4.0]);
    assert!((s.mre - 2.75).abs() < 1e-12);
    assert!((s.sd - 1.707825127659933).abs() < 1e-9);         // sample SD (n−1)
    assert_eq!(s.sdr, vec![(2.0, 0.5), (2.5, 0.5), (3.0, 0.75), (4.0, 0.75)]);
}
#[test] fn radial_error_uses_spacing() { assert!((radial_error_mm((3.0, 4.0), (0.0, 0.0), 0.1) - 0.5).abs() < 1e-12); }
}
