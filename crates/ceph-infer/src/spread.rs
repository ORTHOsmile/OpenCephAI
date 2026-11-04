//! The spread of a heat map around its decoded point (spec 2026-10-13 §6.1), computed beside the decode: the decoded
//! point is never touched.

use crate::spec::Layout;
use crate::transform::Geometry;

/// Inside a square window of `window` cells centred on the cell nearest the decoded point (cx, cy) — stored column,
/// row — `max(h, 0)` as weights: the weighted 2×2 covariance ABOUT THE DECODED POINT, in cells², stored axes
/// [col·col, col·row, row·row]. None when the window holds no positive weight. The window is clipped at the edges;
/// a decoded point that is not finite, or so far off the map the window misses it, gives None (never a panic).
pub fn heatmap_spread(h: &[f32], cols: usize, rows: usize, cx: f64, cy: f64, window: usize) -> Option<[f64; 3]> {
    if !(cx.is_finite() && cy.is_finite()) { return None; }
    let r = (window / 2) as isize;
    let (px, py) = (cx.round() as isize, cy.round() as isize);          // saturates far off the map
    let (mut sw, mut saa, mut sab, mut sbb) = (0f64, 0f64, 0f64, 0f64);
    for y in py.saturating_sub(r).max(0)..=py.saturating_add(r).min(rows as isize - 1) {
        for x in px.saturating_sub(r).max(0)..=px.saturating_add(r).min(cols as isize - 1) {
            let w = h[y as usize * cols + x as usize].max(0.0) as f64;
            let (dx, dy) = (x as f64 - cx, y as f64 - cy);
            sw += w; saa += w * dx * dx; sab += w * dx * dy; sbb += w * dy * dy;
        }
    }
    if sw <= 1e-12 { return None; }
    Some([saa / sw, sab / sw, sbb / sw])
}

/// Stored cells² → film px² [xx, xy, yy]. Chw stores (column = x, row = y); Cwh stores (column = y, row = x), so the
/// two axes swap. One cell is `stride` input px; one input px is 1/ax film px across and 1/ay down. A left-facing film
/// was flipped before the model saw it and x is flipped back, so the off-diagonal term changes sign.
pub fn to_film(c: [f64; 3], layout: Layout, stride: f64, g: &Geometry, facing_left: bool) -> [f64; 3] {
    let [aa, ab, bb] = c;
    let (xx, xy, yy) = match layout { Layout::Chw => (aa, ab, bb), Layout::Cwh => (bb, ab, aa) };
    let (sx, sy) = (stride / g.ax, stride / g.ay);
    [xx * sx * sx, if facing_left { -xy } else { xy } * sx * sy, yy * sy * sy]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::Layout;
    /// A Gaussian heat map in stored (column, row) cells with covariance [aa, ab, bb] about (cx, cy).
    fn gauss(cols: usize, rows: usize, cx: f64, cy: f64, aa: f64, ab: f64, bb: f64) -> Vec<f32> {
        let det = aa * bb - ab * ab;
        (0..rows * cols).map(|i| { let (x, y) = ((i % cols) as f64 - cx, (i / cols) as f64 - cy);
            (-0.5 * (bb * x * x - 2.0 * ab * x * y + aa * y * y) / det).exp() as f32 }).collect()
    }
    fn near(a: [f64; 3], b: [f64; 3], tol: f64) -> bool { a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tol * y.abs().max(1.0)) }
    #[test] fn a_round_gaussian_gives_a_round_spread_of_its_own_variance() {
        let h = gauss(40, 50, 20.3, 25.6, 2.25, 0.0, 2.25);
        let c = heatmap_spread(&h, 40, 50, 20.3, 25.6, 15).unwrap();
        assert!(near(c, [2.25, 0.0, 2.25], 0.01), "{c:?}");
    }
    #[test] fn a_stretched_gaussian_gives_the_known_ellipse() {
        let h = gauss(40, 50, 20.0, 25.0, 4.0, 0.0, 1.0);
        let c = heatmap_spread(&h, 40, 50, 20.0, 25.0, 15).unwrap();
        assert!(near(c, [4.0, 0.0, 1.0], 0.02), "{c:?}");
    }
    #[test] fn a_rotated_gaussian_gives_the_right_off_diagonal_sign() {
        // σ 2 along the 45° line (x right, y down), σ 1 across it: [2.5, 1.5, 2.5].
        let h = gauss(40, 50, 20.0, 25.0, 2.5, 1.5, 2.5);
        let c = heatmap_spread(&h, 40, 50, 20.0, 25.0, 15).unwrap();
        assert!(near(c, [2.5, 1.5, 2.5], 0.02) && c[1] > 0.0, "{c:?}");
        let m = gauss(40, 50, 20.0, 25.0, 2.5, -1.5, 2.5);
        assert!(heatmap_spread(&m, 40, 50, 20.0, 25.0, 15).unwrap()[1] < 0.0);
    }
    #[test] fn nothing_positive_in_the_window_is_none_and_an_edge_peak_is_clipped_not_a_panic() {
        assert_eq!(heatmap_spread(&vec![-1.0f32; 40 * 50], 40, 50, 20.0, 25.0, 15), None);
        let h = gauss(40, 50, 0.0, 0.0, 2.0, 0.0, 2.0);
        assert!(heatmap_spread(&h, 40, 50, 0.0, 0.0, 15).is_some());
    }
    #[test] fn to_film_scales_by_stride_and_letterbox_swaps_cwh_axes_and_flips_left_facing() {
        let input = crate::spec::Input { name: "i".into(), width: 40, height: 50, channels: 1, layout: Layout::Chw,
            resize: crate::spec::Resize::Stretch { interp: crate::spec::Interp::PilBicubic, coords: crate::spec::Coords::Corner }, normalize: crate::spec::Normalize::Zscore };
        let g = crate::transform::Geometry::for_input(400, 500, &input);          // 10 film px per input px, both ways
        assert_eq!(to_film([1.0, 0.5, 4.0], Layout::Chw, 1.0, &g, false), [100.0, 50.0, 400.0]);
        assert_eq!(to_film([1.0, 0.5, 4.0], Layout::Cwh, 1.0, &g, false), [400.0, 50.0, 100.0], "Cwh stores (column = y, row = x)");
        assert_eq!(to_film([1.0, 0.5, 4.0], Layout::Chw, 2.0, &g, true), [400.0, -200.0, 1600.0], "stride 2 → ×4; left-facing flips xy");
    }
    /// A decoded point far outside the map (a runaway DARK step) or not a number: no window, so no spread, and no
    /// panic from window arithmetic overflowing.
    #[test] fn a_decoded_point_off_the_map_or_not_finite_is_none_without_a_panic() {
        let h = gauss(40, 50, 20.0, 25.0, 2.0, 0.0, 2.0);
        assert_eq!(heatmap_spread(&h, 40, 50, 1e30, 25.0, 15), None);
        assert_eq!(heatmap_spread(&h, 40, 50, -1e30, -1e30, 15), None);
        assert_eq!(heatmap_spread(&h, 40, 50, f64::NAN, 25.0, 15), None);
        assert_eq!(heatmap_spread(&h, 40, 50, 20.0, f64::INFINITY, 15), None);
        assert_eq!(heatmap_spread(&h, 40, 50, 60.0, 25.0, 15), None, "window wholly right of the map");
    }
    /// The window is taken about the DECODED point, not the arg-max cell: the same map read from a point one cell off
    /// gives a larger spread along that axis (+1 cell² on xx), and the others unchanged to within the clipping.
    #[test] fn the_spread_is_about_the_decoded_point_not_the_peak_cell() {
        let h = gauss(40, 50, 20.0, 25.0, 2.0, 0.0, 2.0);
        let (a, b) = (heatmap_spread(&h, 40, 50, 20.0, 25.0, 15).unwrap(), heatmap_spread(&h, 40, 50, 21.0, 25.0, 15).unwrap());
        assert!((b[0] - a[0] - 1.0).abs() < 0.05 && (b[2] - a[2]).abs() < 0.05, "{a:?} {b:?}");
    }
    /// Review I1: a film whose two axes scale differently (ax ≠ ay). 800 × 500 film stretched to a 40 × 50 input:
    /// ax = 40/800 = 0.05 (one input px = 20 film px across), ay = 50/500 = 0.1 (one input px = 10 film px down).
    /// Stride 1, stored [aa, ab, bb] = [1, 0.5, 2]:
    ///   Chw: xx = 1·20² = 400, xy = 0.5·20·10 = 100, yy = 2·10² = 200.
    ///   Cwh (axes swap first): xx = 2·20² = 800, xy = 100, yy = 1·10² = 100.
    /// A swap of the two scales would give [100, 100, 800]; one scale for both, [400, 200, 800].
    #[test] fn to_film_uses_the_horizontal_scale_across_and_the_vertical_scale_down() {
        let input = crate::spec::Input { name: "i".into(), width: 40, height: 50, channels: 1, layout: Layout::Chw,
            resize: crate::spec::Resize::Stretch { interp: crate::spec::Interp::PilBicubic, coords: crate::spec::Coords::Corner }, normalize: crate::spec::Normalize::Zscore };
        let g = crate::transform::Geometry::for_input(800, 500, &input);
        assert!(g.ax != g.ay, "control: the two scales differ");
        let close = |a: [f64; 3], b: [f64; 3]| a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-9 * y.abs().max(1.0));
        let c = to_film([1.0, 0.5, 2.0], Layout::Chw, 1.0, &g, false);
        assert!(close(c, [400.0, 100.0, 200.0]), "Chw {c:?}");
        let c = to_film([1.0, 0.5, 2.0], Layout::Cwh, 1.0, &g, false);
        assert!(close(c, [800.0, 100.0, 100.0]), "Cwh {c:?}");
        let c = to_film([1.0, 0.5, 2.0], Layout::Chw, 1.0, &g, true);
        assert!(close(c, [400.0, -100.0, 200.0]), "Chw left {c:?}");
    }
}
