#[derive(Debug, Clone, Copy)] pub struct Peak { pub x: f64, pub y: f64, pub score: f32 }
pub fn decode_heatmap(h: &[f32], w: usize, hgt: usize, window: usize) -> Peak {
    let (mut bi, mut bv) = (0usize, f32::MIN);
    for (i, &v) in h.iter().enumerate() { if v > bv { bv = v; bi = i; } }
    let (px, py, r) = ((bi % w) as isize, (bi / w) as isize, (window / 2) as isize);
    let (mut sx, mut sy, mut sw) = (0f64, 0f64, 0f64);
    for y in (py - r).max(0)..=(py + r).min(hgt as isize - 1) {
        for x in (px - r).max(0)..=(px + r).min(w as isize - 1) {
            let v = h[y as usize * w + x as usize].max(0.0) as f64;
            sx += v * x as f64; sy += v * y as f64; sw += v;
        }
    }
    if sw <= 1e-12 { return Peak { x: px as f64, y: py as f64, score: bv }; }
    Peak { x: sx / sw, y: sy / sw, score: bv }
}

/// cv2.getGaussianKernel(k, 0): σ = 0.3·((k − 1)·0.5 − 1) + 0.8 (k > 7, the only sizes used here).
pub fn gaussian_kernel(k: usize) -> Vec<f64> {
    let s = 0.3 * ((k as f64 - 1.0) * 0.5 - 1.0) + 0.8;
    let c = (k / 2) as f64;
    let g: Vec<f64> = (0..k).map(|i| (-((i as f64 - c).powi(2)) / (2.0 * s * s)).exp()).collect();
    let sum: f64 = g.iter().sum();
    g.into_iter().map(|v| v / sum).collect()
}

/// MMPose's DARK refinement (MSRAHeatmap, unbiased=True): blur with the training kernel, take the log, then one Newton
/// step from the arg-max using the 5 × 5 neighbourhood. Only the cells that step reads are blurred (zero outside the
/// map, as MMPose pads); the max-preserving rescale is a constant in log space and drops out. Score = the raw peak.
pub fn decode_dark(h: &[f32], w: usize, hgt: usize, kernel: usize) -> Peak {
    let (mut bi, mut bv) = (0usize, f32::MIN);
    for (i, &v) in h.iter().enumerate() { if v > bv { bv = v; bi = i; } }
    let (x, y) = ((bi % w) as isize, (bi / w) as isize);
    let mut p = Peak { x: x as f64, y: y as f64, score: bv };
    if !(1 < x && x < w as isize - 2 && 1 < y && y < hgt as isize - 2) { return p; }
    let (g, r) = (gaussian_kernel(kernel), (kernel / 2) as isize);
    let l = |dx: isize, dy: isize| -> f64 {
        let (cx, cy) = (x + dx, y + dy);
        let mut s = 0.0;
        for ky in -r..=r { let yy = cy + ky; if yy < 0 || yy >= hgt as isize { continue; }
            for kx in -r..=r { let xx = cx + kx; if xx < 0 || xx >= w as isize { continue; }
                s += g[(ky + r) as usize] * g[(kx + r) as usize] * h[yy as usize * w + xx as usize] as f64; } }
        s.max(1e-10).ln()
    };
    let (dx, dy) = (0.5 * (l(1, 0) - l(-1, 0)), 0.5 * (l(0, 1) - l(0, -1)));
    let dxx = 0.25 * (l(2, 0) - 2.0 * l(0, 0) + l(-2, 0));
    let dyy = 0.25 * (l(0, 2) - 2.0 * l(0, 0) + l(0, -2));
    let dxy = 0.25 * (l(1, 1) - l(-1, 1) - l(1, -1) + l(-1, -1));
    let det = dxx * dyy - dxy * dxy;
    if det != 0.0 { p.x -= (dyy * dx - dxy * dy) / det; p.y -= (dxx * dy - dxy * dx) / det; }
    p
}

#[cfg(test)]
mod tests {
    use super::*;
#[test] fn gaussian_kernel_matches_opencv() {
    // cv2.getGaussianKernel(11, 0) with OpenCV 5.0.0
    let want = [0.00881223, 0.02714358, 0.06511406, 0.12164907, 0.17699836, 0.20056541, 0.17699836, 0.12164907, 0.06511406, 0.02714358, 0.00881223];
    for (a, b) in gaussian_kernel(11).iter().zip(want) { assert!((a - b).abs() < 1e-7, "{a} vs {b}"); }
}
#[test] fn dark_recovers_a_subpixel_peak_and_leaves_an_edge_peak_whole() {
    let (w, h, cx, cy, s) = (128usize, 96usize, 50.3f64, 40.7f64, 6.0f64);
    let g = |cx: f64, cy: f64| -> Vec<f32> { (0..w * h).map(|i| { let (x, y) = ((i % w) as f64, (i / w) as f64);
        (-((x - cx).powi(2) + (y - cy).powi(2)) / (2.0 * s * s)).exp() as f32 }).collect() };
    let p = decode_dark(&g(cx, cy), w, h, 11);
    assert!((p.x - cx).abs() < 0.05 && (p.y - cy).abs() < 0.05, "{p:?}");
    let e = decode_dark(&g(1.0, 40.0), w, h, 11);                       // x = 1 is too near the edge for DARK
    assert_eq!((e.x, e.y), (1.0, 40.0));
}
#[test] fn decode_recovers_subpixel_peak() {
    let (w, h, cx, cy, s) = (192usize, 192usize, 50.3f64, 70.7f64, 2.0f64);
    let hm: Vec<f32> = (0..w * h).map(|i| { let (x, y) = ((i % w) as f64, (i / w) as f64);
        (-((x - cx).powi(2) + (y - cy).powi(2)) / (2.0 * s * s)).exp() as f32 }).collect();
    let p = decode_heatmap(&hm, w, h, 11);
    assert!((p.x - cx).abs() < 0.05 && (p.y - cy).abs() < 0.05, "{p:?}");
    assert!(p.score > 0.9);
}
}
