use crate::spec::{Coords, Input, Resize};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)] #[serde(rename_all = "kebab-case")]
pub enum ResizeMode { Letterbox, Stretch }
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)] #[serde(rename_all = "kebab-case")]
pub enum HeatmapCenter { HalfPixel, Corner }

/// Film pixels I ↔ model-input pixels M (§2): u = ax·x + bx, v = ay·y + by. Letterbox also keeps the pasted region.
#[derive(Clone, Copy, Debug)]
pub struct Geometry { pub ax: f64, pub bx: f64, pub ay: f64, pub by: f64, pub pad_x: u32, pub pad_y: u32, pub inner_w: u32, pub inner_h: u32, pub out_w: u32, pub out_h: u32 }
impl Geometry {
    /// Week 1's square input (kept for its callers).
    pub fn new(w: u32, h: u32, size: u32, mode: ResizeMode) -> Self {
        match mode { ResizeMode::Letterbox => Self::letterbox(w, h, size, size), ResizeMode::Stretch => Self::stretch(w, h, size, size, Coords::HalfPixel) }
    }
    pub fn for_input(w: u32, h: u32, input: &Input) -> Self {
        match input.resize {
            Resize::Letterbox { .. } => Self::letterbox(w, h, input.width, input.height),
            Resize::Stretch { coords, .. } => Self::stretch(w, h, input.width, input.height, coords),
            Resize::Topdown { padding } => Self::topdown(w, h, input.width, input.height, padding),
        }
    }
    pub fn letterbox(w: u32, h: u32, ow: u32, oh: u32) -> Self {
        let r = (ow as f64 / w as f64).min(oh as f64 / h as f64);
        let (iw, ih) = ((w as f64 * r).round(), (h as f64 * r).round());
        let (px, py) = (((ow as f64 - iw) / 2.0).floor(), ((oh as f64 - ih) / 2.0).floor());
        let (sx, sy) = (iw / w as f64, ih / h as f64);
        Self { ax: sx, bx: 0.5 * sx - 0.5 + px, ay: sy, by: 0.5 * sy - 0.5 + py, pad_x: px as u32, pad_y: py as u32,
               inner_w: iw as u32, inner_h: ih as u32, out_w: ow, out_h: oh }
    }
    pub fn stretch(w: u32, h: u32, ow: u32, oh: u32, coords: Coords) -> Self {
        let (sx, sy) = (ow as f64 / w as f64, oh as f64 / h as f64);
        let (bx, by) = match coords { Coords::HalfPixel => (0.5 * sx - 0.5, 0.5 * sy - 0.5), Coords::Corner => (0.0, 0.0) };
        Self { ax: sx, bx, ay: sy, by, pad_x: 0, pad_y: 0, inner_w: ow, inner_h: oh, out_w: ow, out_h: oh }
    }
    /// MMPose GetBBoxCenterScale + TopdownAffine with the whole film as the box (inference_topdown, bboxes=None).
    pub fn topdown(w: u32, h: u32, ow: u32, oh: u32, padding: f64) -> Self {
        let (mut bw, mut bh) = (w as f64 * padding, h as f64 * padding);
        let aspect = ow as f64 / oh as f64;
        if bw > bh * aspect { bh = bw / aspect } else { bw = bh * aspect }
        let (kx, ky) = (ow as f64 / bw, oh as f64 / bh);
        Self { ax: kx, bx: ow as f64 / 2.0 - w as f64 / 2.0 * kx, ay: ky, by: oh as f64 / 2.0 - h as f64 / 2.0 * ky,
               pad_x: 0, pad_y: 0, inner_w: ow, inner_h: oh, out_w: ow, out_h: oh }
    }
    pub fn to_input(&self, x: f64, y: f64) -> (f64, f64) { (self.ax * x + self.bx, self.ay * y + self.by) }
    pub fn to_image(&self, u: f64, v: f64) -> (f64, f64) { ((u - self.bx) / self.ax, (v - self.by) / self.ay) }
}
pub fn heatmap_to_input(xh: f64, yh: f64, stride: f64, c: HeatmapCenter) -> (f64, f64) {
    match c { HeatmapCenter::HalfPixel => ((xh + 0.5) * stride - 0.5, (yh + 0.5) * stride - 0.5),
              HeatmapCenter::Corner => (xh * stride, yh * stride) }
}

#[cfg(test)]
mod tests {
    use super::*;
#[test] fn letterbox_isbi_geometry() {
    let g = Geometry::new(1935, 2400, 768, ResizeMode::Letterbox);
    assert_eq!((g.pad_x, g.pad_y), (74, 0));
    assert!((g.ax - 619.0 / 1935.0).abs() < 1e-12);
    let (xm, _) = g.to_input(-0.5, -0.5);       // image left edge → pasted-region left edge
    assert!((xm - 73.5).abs() < 1e-9);
}
#[test] fn roundtrip_is_identity() {
    for mode in [ResizeMode::Letterbox, ResizeMode::Stretch] {
        let g = Geometry::new(1935, 2400, 768, mode);
        let (u, v) = g.to_input(812.4, 1011.9);
        let (x, y) = g.to_image(u, v);
        assert!((x - 812.4).abs() < 1e-9 && (y - 1011.9).abs() < 1e-9);
    }
}
#[test] fn stretch_corner_and_half_pixel_conventions() {
    let c = Geometry::stretch(1935, 2400, 416, 512, crate::spec::Coords::Corner);
    assert_eq!(c.to_input(1935.0, 2400.0), (416.0, 512.0));
    let (x, y) = c.to_image(100.0, 200.0);
    assert!((x - 100.0 * 1935.0 / 416.0).abs() < 1e-9 && (y - 200.0 * 2400.0 / 512.0).abs() < 1e-9);
    let h = Geometry::stretch(2400, 2000, 416, 512, crate::spec::Coords::HalfPixel);   // a landscape film, not ISBI-shaped
    let (u, v) = h.to_input(812.4, 1011.9);
    let (x, y) = h.to_image(u, v);
    assert!((x - 812.4).abs() < 1e-9 && (y - 1011.9).abs() < 1e-9);
}
#[test] fn topdown_centres_the_padded_square_box() {
    let g = Geometry::topdown(1935, 2400, 1024, 1024, 1.25);                // box 3000 × 3000 around (967.5, 1200)
    let (u, v) = g.to_input(967.5, 1200.0);
    assert!((u - 512.0).abs() < 1e-9 && (v - 512.0).abs() < 1e-9);
    assert!((g.ax - 1024.0 / 3000.0).abs() < 1e-12 && (g.ay - g.ax).abs() < 1e-12);
    let w = Geometry::topdown(2400, 2000, 1024, 1024, 1.25);                // landscape: the width sets the square
    assert!((w.ax - 1024.0 / 3000.0).abs() < 1e-12);
    let (u, v) = w.to_input(10.0, 1990.0);
    let (x, y) = w.to_image(u, v);
    assert!((x - 10.0).abs() < 1e-9 && (y - 1990.0).abs() < 1e-9);
}
#[test] fn heatmap_half_pixel() { assert_eq!(heatmap_to_input(0.0, 0.0, 4.0, HeatmapCenter::HalfPixel), (1.5, 1.5)); }
}
