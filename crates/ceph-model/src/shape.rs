//! The point plausibility check's shape model (spec 2026-10-27 §14.3), the app's copy for Stage A′
//! (spec 2026-11-02 §14.13 U6); the bench keeps the tested original, and `ceph-bench/tests/stage_a_same_maths.rs`
//! proves the two identical.
//! Construct: given where the other points of this tracing sit, how unusual is this point's position among correctly
//! traced films — a tail chance, NOT the chance that the point is wrong. Method: a similarity alignment of the other
//! points to their mean (turn, size, shift; never a mirror; Gower 1975), the joint spread of the points shrunk towards a
//! simpler one (Ledoit & Wolf 2004), and the Gaussian of the point given the others; chance = e^(−d²/2). Not an S–N
//! frame: if S or N is the wild point, an S–N frame is built on the error itself.
/// A point in film px (x, y).
pub type Pt = (f64, f64);
use crate::linalg;

/// x' = a·x − b·y + tx, y' = b·x + a·y + ty: a turn, a size change and a shift; never a mirror.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Sim { pub a: f64, pub b: f64, pub tx: f64, pub ty: f64 }
impl Sim {
    pub fn apply(&self, p: Pt) -> Pt { (self.a * p.0 - self.b * p.1 + self.tx, self.b * p.0 + self.a * p.1 + self.ty) }
    pub fn scale(&self) -> f64 { self.a.hypot(self.b) }
    pub fn inverse(&self) -> Sim {
        let s2 = self.a * self.a + self.b * self.b;
        let (a, b) = (self.a / s2, -self.b / s2);
        Sim { a, b, tx: -(a * self.tx - b * self.ty), ty: -(b * self.tx + a * self.ty) }
    }
}

/// The least-squares similarity taking `src` onto `dst` (the complex-number form of Procrustes, so a mirror is
/// impossible by construction).
pub fn fit_sim(src: &[Pt], dst: &[Pt]) -> Sim {
    let n = src.len() as f64;
    let (msx, msy) = (src.iter().map(|p| p.0).sum::<f64>() / n, src.iter().map(|p| p.1).sum::<f64>() / n);
    let (mdx, mdy) = (dst.iter().map(|p| p.0).sum::<f64>() / n, dst.iter().map(|p| p.1).sum::<f64>() / n);
    let (mut na, mut nb, mut den) = (0.0, 0.0, 0.0);
    for (s, d) in src.iter().zip(dst) {
        let (sx, sy, dx, dy) = (s.0 - msx, s.1 - msy, d.0 - mdx, d.1 - mdy);
        na += sx * dx + sy * dy;
        nb += sx * dy - sy * dx;
        den += sx * sx + sy * sy;
    }
    let (a, b) = (na / den, nb / den);
    Sim { a, b, tx: mdx - (a * msx - b * msy), ty: mdy - (b * msx + a * msy) }
}

/// Centred, and of size 1 (the root of the summed squared distances from the centre).
fn normalise(m: &mut [Pt]) {
    let n = m.len() as f64;
    let (cx, cy) = (m.iter().map(|p| p.0).sum::<f64>() / n, m.iter().map(|p| p.1).sum::<f64>() / n);
    for p in m.iter_mut() { p.0 -= cx; p.1 -= cy; }
    let s = m.iter().map(|p| p.0 * p.0 + p.1 * p.1).sum::<f64>().sqrt();
    for p in m.iter_mut() { p.0 /= s; p.1 /= s; }
}

/// Generalised Procrustes (Gower 1975): the mean shape (centred, size 1, turned like the first shape) and each shape's
/// similarity onto it.
pub fn gpa(shapes: &[Vec<Pt>]) -> anyhow::Result<(Vec<Pt>, Vec<Sim>)> {
    anyhow::ensure!(shapes.len() >= 2 && shapes[0].len() >= 2, "Procrustes needs at least 2 shapes of at least 2 points");
    anyhow::ensure!(shapes.iter().all(|s| s.len() == shapes[0].len()), "the shapes differ in their number of points");
    let mut mean = shapes[0].clone();
    normalise(&mut mean);
    for _ in 0..100 {
        let mut next = vec![(0.0, 0.0); mean.len()];
        for s in shapes {
            let t = fit_sim(s, &mean);
            for (j, p) in s.iter().enumerate() { let q = t.apply(*p); next[j].0 += q.0; next[j].1 += q.1; }
        }
        let n = shapes.len() as f64;
        for p in next.iter_mut() { p.0 /= n; p.1 /= n; }
        let keep = fit_sim(&next, &mean);                           // keep the old mean's turn
        let mut next: Vec<Pt> = next.iter().map(|p| keep.apply(*p)).collect();
        normalise(&mut next);
        let change: f64 = next.iter().zip(&mean).map(|(a, b)| (a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sum();
        mean = next;
        if change < 1e-20 { break; }
    }
    let sims = shapes.iter().map(|s| fit_sim(s, &mean)).collect();
    Ok((mean, sims))
}

/// Ledoit & Wolf (2004): the sample spread pulled towards (its average variance) × identity by the amount their
/// formula gives, so a 38 × 38 spread from a few hundred tracings is never over-confident. (mean, spread row-major,
/// shrinkage in [0, 1]).
pub fn ledoit_wolf(y: &[Vec<f64>]) -> anyhow::Result<(Vec<f64>, Vec<f64>, f64)> {
    let n = y.len();
    anyhow::ensure!(n >= 2, "a spread needs at least 2 tracings, not {n}");
    let p = y[0].len();
    anyhow::ensure!(y.iter().all(|r| r.len() == p), "the tracings differ in length");
    let mean: Vec<f64> = (0..p).map(|j| y.iter().map(|r| r[j]).sum::<f64>() / n as f64).collect();
    let c: Vec<Vec<f64>> = y.iter().map(|r| r.iter().zip(&mean).map(|(a, m)| a - m).collect()).collect();
    let mut s = vec![0.0; p * p];
    for r in &c { for i in 0..p { for j in 0..p { s[i * p + j] += r[i] * r[j] / n as f64; } } }
    let mu = (0..p).map(|i| s[i * p + i]).sum::<f64>() / p as f64;
    let norm2 = |f: &dyn Fn(usize, usize) -> f64| { let mut t = 0.0; for i in 0..p { for j in 0..p { t += f(i, j).powi(2); } } t / p as f64 };
    let d2 = norm2(&|i, j| s[i * p + j] - if i == j { mu } else { 0.0 });
    let mut b2 = 0.0;
    for r in &c { b2 += norm2(&|i, j| r[i] * r[j] - s[i * p + j]); }
    let b2 = (b2 / (n * n) as f64).min(d2);
    let shrink = if d2 > 0.0 { b2 / d2 } else { 1.0 };
    let out = (0..p * p).map(|ij| shrink * if ij / p == ij % p { mu } else { 0.0 } + (1.0 - shrink) * s[ij]).collect();
    Ok((mean, out, shrink))
}

/// The small-sample tail chance of a new point (owner, 27 Oct: "apply the standard small-sample correction so the rings
/// are not too tight"). Construct: the share of correctly placed points at least this far out, allowing for the rings
/// having been learned from only `n` tracings. Method: the prediction ellipse for a new response of a multivariate
/// multiple regression (m = 2 responses, the point's x and y; r predictors, the other points' 2u aligned coordinates,
/// of rank 2u − 4 because the alignment uses up the shift, turn and size; `Conditional::tail` passes r = 2u − 4):
///   T² = e′ [n Σ̂ / (n−r−1)]⁻¹ e / (1 + h),  and  T² (n−r−2) / (2 (n−r−1)) ~ F(2, n−r−2),
/// where Σ̂ is the residual spread with divisor n (here `cov`, so d² = e′ Σ̂⁻¹ e) and h = z₀′(Z′Z)⁻¹z₀ the new
/// tracing's leverage. With m = 2 the F tail is closed-form, P(F(2,k) > f) = (1 + 2f/k)^(−k/2), which gives
///   tail = (1 + d² / (n (1 + h)))^(−(n−r−2)/2),
/// and as n grows (h → 0) this becomes e^(−d²/2), the uncorrected Gaussian tail: no correction in the limit.
/// Evidence: Johnson & Wichern, *Applied Multivariate Statistical Analysis* (6th ed., 2007), ch. 7, the prediction
/// ellipsoid for a new response in multivariate multiple regression (section and equation number TO BE CONFIRMED).
/// r: the other points' 2u aligned coordinates have rank 2u − 4 (36 − 4 = 32 for 18 points), because the similarity
/// alignment uses up four of them (shift x, shift y, turn, size). This rank argument was applied AFTER r = 36 was seen
/// to over-correct slightly on synthetic faces (1-in-100 line: 0.61–0.93% with r = 36, 0.68–1.01% with r = 32): a
/// principled choice, made after the fact. The measured mean leverage (0.158) matches the rank-32 expectation (0.159).
/// Widened twice, slightly: Σ̂ here is the Ledoit–Wolf spread (shrinkage about 4% at 240 tracings), not the plain
/// sample spread the formula assumes, and the shrinkage already widens each ring a little. So the rings are mildly
/// CONSERVATIVE: fewer needless flags, at the cost of a slightly weaker catch. Measured on SYNTHETIC faces (rings from
/// 240 tracings, 10 training sets, 200,000 new faces per point): at the 1-in-5,000 flag line B 19 and N 36 against the
/// 40 promised; uncorrected 372 and 310.
pub fn predictive_tail(d2: f64, n: usize, r: usize, h: f64) -> f64 {
    assert!(n >= r + 3, "the small-sample tail needs n ≥ r + 3 ({n} tracings, {r} numbers)");
    let (n, k) = (n as f64, (n - r - 2) as f64);
    (1.0 + d2 / (n * (1.0 + h))).powf(-k / 2.0)
}

/// How much the small-sample correction widens the point's spread (variance): n (1 + h) / (n − r − 4). The corrected
/// tail is that of a 2-D multivariate t with ν = n − r − 2 degrees of freedom and scale Σ̂ n (1 + h) / ν, whose
/// covariance is the scale × ν / (ν − 2). At n = 240, r = 32, h ≈ 0.16 it is about 1.36 (the sd about 1.17×); it
/// tends to 1 as n grows.
pub fn predictive_var_factor(n: usize, r: usize, h: f64) -> f64 {
    assert!(n >= r + 5, "the predictive spread needs n ≥ r + 5 ({n} tracings, {r} numbers)");
    n as f64 * (1.0 + h) / (n - r - 4) as f64
}

/// One point's rings given a set of other points (the "used" points, in ascending order), learned from expert tracings.
#[derive(Clone, Debug)]
pub struct Conditional {
    /// The used points' mean shape (the alignment target).
    pub mean_used: Vec<Pt>,
    /// The used points' mean in the aligned frame (x, y interleaved) and the point's own mean.
    pub mu_used: Vec<f64>, pub mu: [f64; 2],
    /// Σ_kr Σ_rr⁻¹, 2 × 2u row-major: how the point's expected place follows the others.
    pub gain: Vec<f64>,
    /// The point's spread given the others (2 × 2), and its inverse.
    pub cov: [f64; 4], pub cov_inv: [f64; 4],
    /// The number of training tracings, and the lower Cholesky factor of the used points' spread Σ_rr, for the
    /// small-sample correction's leverage h = 1/n + (x − μ_used)′ Σ_rr⁻¹ (x − μ_used) / n.
    pub n: usize, pub rr_chol: Vec<f64>,
}

/// Fits point `k`'s rings given the points `used` (never `k` itself) from `train`, every tracing in `ORIGINAL_19` order.
pub fn fit_conditional(train: &[Vec<Pt>], k: usize, used: &[usize]) -> anyhow::Result<Conditional> {
    anyhow::ensure!(!used.contains(&k), "point {k} cannot take part in its own alignment");
    anyhow::ensure!(used.len() >= 2, "the rings need at least 2 other points");
    let shapes: Vec<Vec<Pt>> = train.iter().map(|t| used.iter().map(|&j| t[j]).collect()).collect();
    let (mean_used, sims) = gpa(&shapes)?;
    let y: Vec<Vec<f64>> = train.iter().zip(&sims).map(|(t, s)| {
        let mut v: Vec<f64> = used.iter().flat_map(|&j| { let q = s.apply(t[j]); [q.0, q.1] }).collect();
        let q = s.apply(t[k]);
        v.extend([q.0, q.1]);
        v
    }).collect();
    let (mean, sig, _) = ledoit_wolf(&y)?;
    let (r, p) = (2 * used.len(), 2 * used.len() + 2);
    anyhow::ensure!(train.len() >= r + 3,
        "{r} numbers to condition on need at least {} tracings for the small-sample correction, not {}", r + 3, train.len());
    let rr: Vec<f64> = (0..r * r).map(|ij| sig[(ij / r) * p + ij % r]).collect();
    let rk: Vec<f64> = (0..r * 2).map(|ij| sig[(ij / 2) * p + r + ij % 2]).collect();
    let g = linalg::solve_spd_many(&rr, r, &rk, 2)?;                         // Σ_rr⁻¹ Σ_rk, r × 2
    let rr_chol = linalg::cholesky(&rr, r)?;
    let gain: Vec<f64> = (0..2 * r).map(|ij| g[(ij % r) * 2 + ij / r]).collect();
    let mut cov = [sig[r * p + r], sig[r * p + r + 1], sig[(r + 1) * p + r], sig[(r + 1) * p + r + 1]];
    for a in 0..2 { for b in 0..2 { cov[a * 2 + b] -= (0..r).map(|j| sig[(r + a) * p + j] * g[j * 2 + b]).sum::<f64>(); } }
    let det = cov[0] * cov[3] - cov[1] * cov[2];
    anyhow::ensure!(det > 0.0 && det.is_finite(), "point {k}'s spread given the others is not positive (det {det})");
    Ok(Conditional { mean_used, mu_used: mean[..r].to_vec(), mu: [mean[r], mean[r + 1]], gain, cov,
        cov_inv: [cov[3] / det, -cov[1] / det, -cov[2] / det, cov[0] / det], n: train.len(), rr_chol })
}

impl Conditional {
    /// d² of `p` from the rings' centre given `others` (film px, in `used` order), and that centre in film px. This is
    /// the plain (uncorrected) Mahalanobis distance; `tail` applies the small-sample correction.
    pub fn d2(&self, others: &[Pt], p: Pt) -> (f64, Pt) { let (d2, c, _) = self.parts(others, p); (d2, c) }
    /// d², the centre in film px, and the leverage h of this tracing's other points.
    fn parts(&self, others: &[Pt], p: Pt) -> (f64, Pt, f64) {
        assert_eq!(others.len(), self.mean_used.len(), "the other points must be the ones the rings were fitted with");
        let s = fit_sim(others, &self.mean_used);
        let x: Vec<f64> = others.iter().flat_map(|q| { let r = s.apply(*q); [r.0, r.1] }).collect();
        let r = x.len();
        let mut c = self.mu;
        for i in 0..2 { for j in 0..r { c[i] += self.gain[i * r + j] * (x[j] - self.mu_used[j]); } }
        let q = s.apply(p);
        let (dx, dy, ci) = (q.0 - c[0], q.1 - c[1], self.cov_inv);
        (dx * (ci[0] * dx + ci[1] * dy) + dy * (ci[2] * dx + ci[3] * dy), s.inverse().apply((c[0], c[1])), self.leverage(&x))
    }
    /// The new tracing's leverage h = 1/n + (x − μ_used)′ Σ_rr⁻¹ (x − μ_used) / n, x its aligned other points.
    fn leverage(&self, x: &[f64]) -> f64 {
        let dev: Vec<f64> = x.iter().zip(&self.mu_used).map(|(a, m)| a - m).collect();
        let v = linalg::chol_solve(&self.rr_chol, dev.len(), &dev);
        (1.0 + dev.iter().zip(&v).map(|(a, b)| a * b).sum::<f64>()) / self.n as f64
    }
    /// The tail chance: the share of correctly placed points at least this far out, corrected for the rings having
    /// been learned from `n` tracings (`predictive_tail`); e^(−d²/2) in the large-sample limit.
    pub fn tail(&self, others: &[Pt], p: Pt) -> f64 {
        let (d2, _, h) = self.parts(others, p);
        predictive_tail(d2, self.n, self.mu_used.len() - 4, h)                // r = rank 2u − 4, see predictive_tail
    }
    /// The point's CORRECTED predictive spread on this film in film px: √(mean of the two variances) of where a correctly
    /// placed point falls, widened by the same small-sample correction as `tail` (`predictive_var_factor`), undone of
    /// the alignment's size. This is the spread FT-2's D6 reports as "each point's real spread".
    pub fn sd_px(&self, others: &[Pt]) -> f64 {
        let s = fit_sim(others, &self.mean_used);
        let x: Vec<f64> = others.iter().flat_map(|q| { let r = s.apply(*q); [r.0, r.1] }).collect();
        let f = predictive_var_factor(self.n, self.mu_used.len() - 4, self.leverage(&x));  // r = 2u − 4, as in `tail`
        ((self.cov[0] + self.cov[3]) / 2.0 * f).sqrt() / s.scale()
    }
    /// The ring on which the corrected tail equals `tail` (spec §14.1: drawn on hover), in film px. In the aligned frame
    /// it is the ellipse e′ cov⁻¹ e = d²*, with d²* = n (1 + h) (tail^(−2/(n−r−2)) − 1) (`predictive_tail` solved for d²);
    /// the alignment's turn and size are then undone.
    pub fn ring(&self, others: &[Pt], tail: f64) -> Ring {
        let s = fit_sim(others, &self.mean_used);
        let x: Vec<f64> = others.iter().flat_map(|q| { let r = s.apply(*q); [r.0, r.1] }).collect();
        let (n, r, h) = (self.n as f64, (self.mu_used.len() - 4) as f64, self.leverage(&x));
        let d2 = n * (1.0 + h) * (tail.powf(-2.0 / (n - r - 2.0)) - 1.0);
        let (_, c) = self.d2(others, (0.0, 0.0));
        let [a, b, _, d] = self.cov;                                     // symmetric 2 × 2
        let tr = (a + d) / 2.0; let disc = (((a - d) / 2.0).powi(2) + b * b).sqrt();
        let (l1, l2) = (tr + disc, tr - disc);
        let th = 0.5 * (2.0 * b).atan2(a - d);                            // major axis, aligned frame
        let sc = s.scale();
        Ring { cx: c.0, cy: c.1, rx: (l1 * d2).sqrt() / sc, ry: (l2 * d2).sqrt() / sc,
               angle_deg: (th - s.b.atan2(s.a)).to_degrees() }
    }
}

/// A flag ring in film px: centre, semi-axes (`rx` along the major axis) and the major axis's turn in degrees, for the
/// pin's hover (spec §14.1). Added for Stage A′; not in the bench copy.
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ring { pub cx: f64, pub cy: f64, pub rx: f64, pub ry: f64, pub angle_deg: f64 }

#[doc(hidden)]
pub mod synthetic {
    use super::*;
    /// splitmix64, copied from ceph-bench's seeded `Rng` (same stream, same numbers; `stage_a_faces` proves it).
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
    }
    /// Box–Muller, copied from ceph-bench's `ft_common::normal`.
    pub fn normal(r: &mut Rng) -> f64 {
        let u1 = ((r.next() >> 11) as f64 + 0.5) / (1u64 << 53) as f64;
        let u2 = (r.next() >> 11) as f64 / (1u64 << 53) as f64;
        (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
    }
    /// For tests only (not `cfg(test)`, so ceph-bench can prove it the same): the median, copied from ceph-bench's
    /// `ft_common::median` (refuses an empty list and NaN).
    pub fn median(v: &[f64]) -> anyhow::Result<f64> {
        anyhow::ensure!(!v.is_empty(), "median of nothing: nothing was measured");
        anyhow::ensure!(v.iter().all(|x| !x.is_nan()), "median of a list holding NaN");
        let mut s = v.to_vec();
        s.sort_by(f64::total_cmp);
        let n = s.len();
        Ok(if n % 2 == 1 { s[n / 2] } else { (s[n / 2 - 1] + s[n / 2]) / 2.0 })
    }
    /// SYNTHETIC: a rough 19-point outline in film px at 0.1 mm/px, facing right, in `ORIGINAL_19` order.
    pub const OUTLINE: [Pt; 19] = [(800.0, 1000.0), (1400.0, 950.0), (1300.0, 1150.0), (650.0, 1150.0), (1450.0, 1450.0),
        (1400.0, 1800.0), (1420.0, 1950.0), (1350.0, 2050.0), (1400.0, 2020.0), (850.0, 1750.0), (1460.0, 1560.0),
        (1480.0, 1550.0), (1560.0, 1550.0), (1550.0, 1650.0), (1560.0, 1400.0), (1500.0, 1980.0), (950.0, 1380.0),
        (1500.0, 1370.0), (750.0, 1350.0)];
    /// B, Pog, Me, Gn, L1T, PogS in `ORIGINAL_19` order.
    pub const JAW: [usize; 6] = [5, 6, 7, 8, 10, 15];
    /// SYNTHETIC faces: the outline turned (sd 0.03 rad), sized (sd 5%) and shifted (sd 30 px); the six jaw points share
    /// one forward position (sd 40 px = 4 mm, a Class II–III spread); every point wobbles 15 px (1.5 mm) on its own.
    pub fn faces(n: usize, seed: u64) -> Vec<Vec<Pt>> {
        let mut r = Rng::new(seed);
        (0..n).map(|_| {
            let (turn, size) = (normal(&mut r) * 0.03, 1.0 + normal(&mut r) * 0.05);
            let (tx, ty, m) = (normal(&mut r) * 30.0, normal(&mut r) * 30.0, normal(&mut r) * 40.0);
            let s = Sim { a: size * turn.cos(), b: size * turn.sin(), tx, ty };
            OUTLINE.iter().enumerate().map(|(i, p)| {
                let jaw = if JAW.contains(&i) { m } else { 0.0 };
                s.apply((p.0 + jaw + normal(&mut r) * 15.0, p.1 + normal(&mut r) * 15.0))
            }).collect()
        }).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::synthetic::*;
    use super::*;
    use super::synthetic::{Rng, normal, median};
    fn others(t: &[Pt], k: usize) -> (Vec<usize>, Vec<Pt>) {
        let used: Vec<usize> = (0..t.len()).filter(|&j| j != k).collect();
        let pts = used.iter().map(|&j| t[j]).collect();
        (used, pts)
    }
    #[test] fn a_known_turn_size_and_shift_is_recovered_and_undone() {
        let s = Sim { a: 1.3 * 0.5f64.cos(), b: 1.3 * 0.5f64.sin(), tx: 12.0, ty: -7.0 };
        let dst: Vec<Pt> = OUTLINE.iter().map(|p| s.apply(*p)).collect();
        let f = fit_sim(&OUTLINE, &dst);
        for (x, y) in [(f.a, s.a), (f.b, s.b), (f.tx, s.tx), (f.ty, s.ty)] { assert!((x - y).abs() < 1e-9, "{f:?} vs {s:?}"); }
        let back = f.inverse().apply(f.apply((3.0, 4.0)));
        assert!((back.0 - 3.0).abs() < 1e-9 && (back.1 - 4.0).abs() < 1e-9);
        assert!((f.scale() - 1.3).abs() < 1e-12);
    }
    #[test] fn a_mirror_image_is_never_fitted() {
        let mirrored: Vec<Pt> = OUTLINE.iter().map(|p| (-p.0, p.1)).collect();
        let f = fit_sim(&OUTLINE, &mirrored);
        let res = OUTLINE.iter().zip(&mirrored).map(|(p, q)| { let r = f.apply(*p); (r.0 - q.0).powi(2) + (r.1 - q.1).powi(2) }).sum::<f64>() / 19.0;
        assert!(res > 1e4, "a mirror must not fit: mean squared residual {res} px²");
    }
    #[test] fn procrustes_of_copies_gives_back_one_shape_of_size_one() {
        let copies: Vec<Vec<Pt>> = (0..5).map(|i| { let (t, z) = (0.1 * i as f64, 1.0 + 0.1 * i as f64);
            let s = Sim { a: z * t.cos(), b: z * t.sin(), tx: 10.0 * i as f64, ty: -5.0 * i as f64 };
            OUTLINE.iter().map(|p| s.apply(*p)).collect() }).collect();
        let (mean, sims) = gpa(&copies).unwrap();
        for (c, s) in copies.iter().zip(&sims) { for (p, m) in c.iter().zip(&mean) {
            let q = s.apply(*p); assert!((q.0 - m.0).abs() < 1e-9 && (q.1 - m.1).abs() < 1e-9); } }
        assert!((mean.iter().map(|p| p.0 * p.0 + p.1 * p.1).sum::<f64>() - 1.0).abs() < 1e-12);
    }
    #[test] fn the_shrunk_spread_is_usable_where_the_raw_one_is_not() {
        let mut r = Rng::new(8);
        let y: Vec<Vec<f64>> = (0..10).map(|_| (0..38).map(|_| normal(&mut r)).collect()).collect();
        let (mean, sig, shrink) = ledoit_wolf(&y).unwrap();
        let mut raw = vec![0.0; 38 * 38];
        for row in &y { for i in 0..38 { for j in 0..38 { raw[i * 38 + j] += (row[i] - mean[i]) * (row[j] - mean[j]) / 10.0; } } }
        assert!(linalg::cholesky(&raw, 38).is_err(), "control: 10 tracings cannot fill a 38 × 38 spread");
        assert!(linalg::cholesky(&sig, 38).is_ok() && shrink > 0.0 && shrink <= 1.0, "shrink {shrink}");
        let y: Vec<Vec<f64>> = (0..5000).map(|_| (0..4).map(|_| normal(&mut r)).collect()).collect();
        let (_, sig, _) = ledoit_wolf(&y).unwrap();
        for i in 0..4 { for j in 0..4 { assert!((sig[i * 4 + j] - if i == j { 1.0 } else { 0.0 }).abs() < 0.1, "{sig:?}"); } }
    }
    /// SYNTHETIC test faces for the class logic: B's rings learned from 240 faces (seed 1), judged on 2,000 others (seed 2).
    const RATE_FACES: usize = 2_000;
    /// A wild B, alone: 10 mm (100 px at 0.1 mm/px) forward, judged at the flag line; 12 mm, judged at the move line.
    const PLANT_FLAG_PX: f64 = 100.0;
    const PLANT_MOVE_PX: f64 = 120.0;
    /// The whole jaw (B, Pog, Me, Gn, L1T, PogS) moved forward together, 10 mm. Chosen (ruling 27 Oct) so that the
    /// positive control fails clearly: with the gain set to zero, B is left quiet on 1,955 / 1,858 / 1,733 of 2,000
    /// faces at 5 / 8 / 10 mm (mark 1,900); 8 mm fails by 42 faces (≈ 4 sd of counting noise), 10 mm by 167. The real
    /// rings leave B quiet on 2,000 of 2,000 at every size from 5 to 15 mm.
    const JAW_MOVE_PX: f64 = 100.0;
    fn b_rings() -> (Conditional, Vec<Vec<Pt>>, usize) {
        let (train, test, b) = (faces(240, 1), faces(RATE_FACES, 2), 5);
        let (used, _) = others(&test[0], b);
        (fit_conditional(&train, b, &used).unwrap(), test, b)
    }
    /// Spec §14.4, FT-2's D1 in miniature (rulings 27 Oct: rates over 2,000 faces, not "every face", which was a
    /// coin-flip). With the small-sample correction in, B moved 10 mm forward alone is beyond the FLAG line (1 in 5,000)
    /// on at least 90% of faces (spec D1's line and mark), and B moved 12 mm alone is beyond the MOVE line (1 in 50,000)
    /// on at least 95%. Measured: 10 mm reaches the move line on only 82.6% of faces, because B's own 1.5 mm wobble
    /// and the honest (corrected) rings put the move line about 9–10 mm out; that is the check's real reach. Also: an
    /// unplanted B is usually unremarkable, and a point placed at its ring's centre scores exactly 1.
    #[test] fn b_moved_alone_is_flagged_at_10_mm_and_moved_at_12_mm() {
        let (c, test, b) = b_rings();
        let (mut flagged, mut moved, mut plain) = (0, 0, vec![]);
        for t in &test {
            let (_, o) = others(t, b);
            plain.push(c.tail(&o, t[b]));
            if c.tail(&o, (t[b].0 + PLANT_FLAG_PX, t[b].1)) < 1.0 / 5_000.0 { flagged += 1; }
            if c.tail(&o, (t[b].0 + PLANT_MOVE_PX, t[b].1)) < 1.0 / 50_000.0 { moved += 1; }
            let (_, centre) = c.d2(&o, t[b]);
            assert!((c.tail(&o, centre) - 1.0).abs() < 1e-9, "the ring's centre scores 1");
        }
        println!("B {PLANT_FLAG_PX} px forward alone: beyond the flag line on {flagged} of {RATE_FACES} faces");
        println!("B {PLANT_MOVE_PX} px forward alone: beyond the move line on {moved} of {RATE_FACES} faces");
        assert!(flagged as f64 >= 0.90 * RATE_FACES as f64, "{PLANT_FLAG_PX} px: flagged on only {flagged} of {RATE_FACES}");
        assert!(moved as f64 >= 0.95 * RATE_FACES as f64, "{PLANT_MOVE_PX} px: beyond the move line on only {moved} of {RATE_FACES}");
        assert!(median(&plain).unwrap() > 0.1, "an unplanted B is usually unremarkable");
    }
    /// Spec §14.4, FT-2's D5 in miniature: the whole jaw moved forward together (a Class III face, not a wrong B) is NOT
    /// flagged at B on at least 95% of faces. The move is large enough that rings which ignore the other points
    /// (the gain set to zero, the positive control) DO flag it, so this test can fail.
    #[test] fn the_whole_jaw_moved_together_is_not_flagged_at_b() {
        let (c, test, b) = b_rings();
        let mut quiet = 0;
        for t in &test {
            let mut moved = t.clone();
            for j in JAW { moved[j].0 += JAW_MOVE_PX; }
            let (_, o) = others(&moved, b);
            if c.tail(&o, moved[b]) >= 1.0 / 5_000.0 { quiet += 1; }
        }
        println!("jaw {JAW_MOVE_PX} px forward together: B not flagged on {quiet} of {RATE_FACES} faces");
        assert!(quiet as f64 >= 0.95 * RATE_FACES as f64, "B flagged on {} of {RATE_FACES} faces", RATE_FACES - quiet);
    }
    /// The small-sample tail (owner, 27 Oct) by hand. With m = 2 the F(2, k) tail is (1 + 2f/k)^(−k/2), so the tail is
    /// (1 + d²/(n(1+h)))^(−(n−r−2)/2). n = 40, r = 36, h = 0, d² = 40: (1 + 1)^(−1) = 0.5. h = 1 halves the reach:
    /// (1 + 0.5)^(−1) = 2/3. At the centre it is 1; it is always wider than e^(−d²/2) for finite n, and becomes it as n
    /// grows (n = 10⁸ agrees to 1e-5 relative at the flag line, d² = 17.03; the gap is ≈ 4e-6 there and 100× more at 10⁶).
    #[test] fn the_small_sample_tail_by_hand_and_its_large_sample_limit() {
        assert!((predictive_tail(40.0, 40, 36, 0.0) - 0.5).abs() < 1e-15);
        assert!((predictive_tail(40.0, 40, 36, 1.0) - 2.0 / 3.0).abs() < 1e-15);
        assert_eq!(predictive_tail(0.0, 240, 36, 0.2), 1.0);
        let d2 = -2.0 * (1.0f64 / 5_000.0).ln();
        let (exact, small, big) = ((-d2 / 2.0).exp(), predictive_tail(d2, 240, 36, 0.15), predictive_tail(d2, 100_000_000, 36, 0.0));
        println!("at d² {d2:.3}: Gaussian {exact:.3e}, n = 240 {small:.3e}, n = 1e8 {big:.3e}");
        assert!(small > 2.0 * exact, "240 tracings must widen the ring: {small:e} vs {exact:e}");
        let mid = predictive_tail(d2, 1_000_000, 36, 0.0);
        // ln(big/exact) ≈ (r+2)·d²/(2n) + d⁴/(4n) = 3.2e-6 + 0.7e-6 at n = 10⁸, and 100× that at n = 10⁶.
        assert!(((big - exact) / exact).abs() < 1e-5, "the correction must vanish as n grows: {big:e} vs {exact:e}");
        assert!((mid - exact).abs() > 50.0 * (big - exact).abs(), "and shrink as n grows: {mid:e}, {big:e}");
    }
    /// Calibration (owner, 27 Oct): unplanted points on SYNTHETIC faces from the known generator, rings learned from 240
    /// tracings, must reach the 1-in-100 line about 1 time in 100. Proxy line: at 1 in 5,000, 20,000 faces expect only
    /// 4 hits (no power); a ±50% check of 1 in 5,000 needs about 77,000 faces per point. At 1 in 100, 20,000 faces per
    /// point expect 200 (binomial sd 14). Marks (ruling B1, 27 Oct): at most 1.3% (no excess; the uncorrected rings give
    /// 2.6–3.6% and cannot pass) and at least 0.5% (not absurdly wide). The corrected rings are mildly conservative
    /// (0.68–1.01% over all 19 points): the Ledoit–Wolf shrinkage and the small-sample correction both widen them, so
    /// part of the widening is counted twice. Averaged over 10 training sets, since the correction is a promise about a
    /// new tracing AND a new training set. Points B (5) and N (1).
    #[test] fn unplanted_points_reach_the_1_in_100_line_about_1_time_in_100() {
        for k in [5usize, 1] {
            let used: Vec<usize> = (0..19).filter(|&j| j != k).collect();
            let (mut hit, mut total) = (0, 0);
            for s in 0..10u64 {
                let c = fit_conditional(&faces(240, 100 + s), k, &used).unwrap();
                for t in faces(RATE_FACES, 200 + s) {
                    let (_, o) = others(&t, k);
                    if c.tail(&o, t[k]) < 0.01 { hit += 1; }
                    total += 1;
                }
            }
            let rate = hit as f64 / total as f64;
            println!("point {k}: below the 1-in-100 line on {hit} of {total} unplanted faces ({:.2}%)", 100.0 * rate);
            assert!(rate <= 0.013, "point {k}: {hit} of {total} ({:.2}%): too many, the rings are too tight", 100.0 * rate);
            assert!(rate >= 0.005, "point {k}: {hit} of {total} ({:.2}%): too few, the rings are absurdly wide", 100.0 * rate);
        }
    }
    /// The predictive spread's factor by hand: n(1+h)/(n−r−4). n = 240, r = 32, h = 0.2: 288/204 = 1.41176…; it is
    /// 1 + 1/n·(…) → 1 as n grows (n = 10⁸, h = 0: within 1e-6).
    #[test] fn the_predictive_variance_factor_by_hand() {
        assert!((predictive_var_factor(240, 32, 0.2) - 288.0 / 204.0).abs() < 1e-15);
        assert!((predictive_var_factor(100_000_000, 32, 0.0) - 1.0).abs() < 1e-6);
    }
    /// sd_px is the CORRECTED predictive spread (ruling 27 Oct, so FT-2's D6 reads the real spread). SYNTHETIC check
    /// against what it claims: over 10 training sets × 2,000 new faces, the mean sd_px must match the measured root-mean-
    /// square spread of the true point about its ring centre, per axis, within 0.95–1.10 (the upper side allows the
    /// mild double widening). Positive control: the uncorrected spread is ≈ 14% short and fails the lower mark.
    #[test] fn sd_px_matches_the_measured_spread_of_new_points() {
        for k in [5usize, 1] {
            let used: Vec<usize> = (0..19).filter(|&j| j != k).collect();
            let (mut sq, mut sd, mut m) = (0.0, 0.0, 0.0);
            for s in 0..10u64 {
                let c = fit_conditional(&faces(240, 100 + s), k, &used).unwrap();
                for t in faces(RATE_FACES, 200 + s) {
                    let (_, o) = others(&t, k);
                    let (_, centre) = c.d2(&o, t[k]);
                    sq += ((t[k].0 - centre.0).powi(2) + (t[k].1 - centre.1).powi(2)) / 2.0;
                    sd += c.sd_px(&o);
                    m += 1.0;
                }
            }
            let (measured, claimed) = ((sq / m).sqrt(), sd / m);
            println!("point {k}: measured spread {measured:.2} px per axis, mean sd_px {claimed:.2} px, ratio {:.3}", claimed / measured);
            assert!((0.95..=1.10).contains(&(claimed / measured)), "point {k}: sd_px {claimed:.2} vs measured {measured:.2}");
        }
    }
    #[test] fn a_point_cannot_align_itself_and_too_few_tracings_are_refused() {
        let train = faces(50, 3);
        assert!(fit_conditional(&train, 5, &[4, 5, 6]).unwrap_err().to_string().contains("own alignment"));
        assert!(ledoit_wolf(&[vec![1.0, 2.0]]).unwrap_err().to_string().contains("at least 2"));
        assert!(gpa(&[OUTLINE.to_vec()]).unwrap_err().to_string().contains("at least 2"));
        let used: Vec<usize> = (0..19).filter(|&j| j != 5).collect();
        let e = fit_conditional(&faces(38, 4), 5, &used).unwrap_err().to_string();
        assert!(e.contains("39 tracings"), "36 numbers to condition on need at least 39 tracings: {e}");
        assert!(fit_conditional(&faces(39, 4), 5, &used).is_ok(), "control: 39 tracings are enough");
    }
}

#[doc(hidden)] pub fn synthetic_faces(n: usize, seed: u64) -> Vec<Vec<Pt>> { synthetic::faces(n, seed) }
