//! Debug task-2 (15 Oct 2026), hypothesis (b): does each installed model's film handling map a known point on the film
//! to the model's input and back to the same film point, at Aariz-like film sizes and aspects? A synthetic bright blob
//! is drawn at a known film point; the real preprocessing (`input_tensor`, the committed catalog manifest) is run; the
//! blob's peak in the input tensor is read the way the heatmap decoder reads a peak (layout, stride) and mapped back with
//! `points_from_heatmaps`. It must land within half a model-input pixel (plus half a heatmap cell) of where it was drawn.
use ceph_infer::engine::points_from_heatmaps;
use ceph_infer::preprocess::input_tensor;
use ceph_infer::spec::{Layout, ModelSpec};
use ceph_infer::transform::Geometry;

fn catalog_spec(id: &str) -> ModelSpec {
    let c: serde_json::Value = serde_json::from_str(include_str!("../../ceph-model/catalog/catalog.json")).unwrap();
    let list = c.as_array().cloned().or_else(|| c.get("models").and_then(|m| m.as_array().cloned())).unwrap();
    let e = list.into_iter().find(|m| m["id"] == id).unwrap();
    let mut m = e["manifest"].clone();
    m["file"] = "m.onnx".into(); m["sha256"] = "x".into();
    serde_json::from_value(m).unwrap()
}

/// A film of w × h with a Gaussian blob (σ in film px) centred on (x0, y0).
fn blob_film(w: u32, h: u32, x0: f64, y0: f64, sigma: f64) -> image::GrayImage {
    image::GrayImage::from_fn(w, h, |x, y| {
        let d2 = (x as f64 - x0).powi(2) + (y as f64 - y0).powi(2);
        image::Luma([(250.0 * (-d2 / (2.0 * sigma * sigma)).exp()).round() as u8])
    })
}

/// Film point found for a blob at (x0, y0): preprocess, take the input tensor's peak as the heatmap peak (one channel,
/// placed in a heatmap of the manifest's output size at input / stride), decode with the app's own decoder.
fn found(spec: &ModelSpec, img: &image::GrayImage, facing_left: bool) -> (f64, f64, Geometry) {
    let mut im = img.clone();
    if facing_left { image::imageops::flip_horizontal_in_place(&mut im); }
    let (w, h) = im.dimensions();
    let g = Geometry::for_input(w, h, &spec.input);
    let t = input_tensor(im.as_raw(), w as usize, h as usize, &g, &spec.input).unwrap();
    let (iw, ih) = (spec.input.width as usize, spec.input.height as usize);
    let plane = &t[..iw * ih];
    let bi = (0..plane.len()).max_by(|a, b| plane[*a].total_cmp(&plane[*b])).unwrap();
    let (u, v) = match spec.input.layout { Layout::Chw => (bi % iw, bi / iw), Layout::Cwh => (bi / ih, bi % ih) };
    let s = spec.output.stride as usize;
    let (ow, oh) = (spec.output.width as usize, spec.output.height as usize);
    let near = |p: usize| (p as f64 / s as f64).round() as usize;           // nearest heatmap cell, as a trained peak would sit
    let (cu, cv) = (near(u).min(ow - 1), near(v).min(oh - 1));
    let n = spec.landmark_map.len();
    let mut hm = vec![0f32; n * ow * oh];
    let idx = match spec.input.layout { Layout::Chw => cv * ow + cu, Layout::Cwh => cu * oh + cv };
    hm[idx] = 1.0;
    let (lms, _) = points_from_heatmaps(spec, &g, &hm, img.width(), facing_left);
    (lms[0].x, lms[0].y, g)
}

const SIZES: [(u32, u32); 5] = [(540, 633), (1968, 1937), (2198, 2719), (2400, 1825), (1935, 2400)];

fn check(id: &str) {
    let spec = catalog_spec(id);
    let mut worst = 0f64;
    for (w, h) in SIZES {
        let gtmp = Geometry::for_input(w, h, &spec.input);
        let sigma = 3.0 / gtmp.ax.min(gtmp.ay);                     // about 3 model-input pixels wide
        for (fx, fy) in [(0.3, 0.4), (0.7, 0.25), (0.55, 0.8)] {
            let (x0, y0) = (fx * w as f64, fy * h as f64);
            let img = blob_film(w, h, x0, y0, sigma);
            for left in [false, true] {
                let (x, y, g) = found(&spec, &img, left);
                // half a model-input pixel, plus half a heatmap cell (stride input pixels), plus 0.5 input px of slack
                // for the corner/half-pixel convention, in film pixels per axis
                let s = spec.output.stride as f64;
                let (tx, ty) = ((0.5 + 0.5 * s + 0.5) / g.ax, (0.5 + 0.5 * s + 0.5) / g.ay);
                let (ex, ey) = ((x - x0).abs(), (y - y0).abs());
                worst = worst.max(ex * g.ax).max(ey * g.ay);
                assert!(ex <= tx && ey <= ty, "{id} {w}×{h} at ({x0:.0},{y0:.0}) facing_left={left}: found ({x:.1},{y:.1}), \
                    off by ({ex:.1},{ey:.1}) film px, allowed ({tx:.1},{ty:.1})");
            }
        }
    }
    eprintln!("{id}: worst round-trip error {worst:.3} model-input px over {} sizes × 3 points × 2 facings", SIZES.len());
}

#[test] fn gu2net_maps_a_known_point_back_at_aariz_sizes() { check("gu2net-isbi19"); }
#[test] fn cwlachap_maps_a_known_point_back_at_aariz_sizes() { check("cwlachap-hrnet-w32"); }
#[test] fn srpose_maps_a_known_point_back_at_aariz_sizes() { check("srpose-cldet23"); }
