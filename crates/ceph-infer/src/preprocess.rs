use crate::spec::{Input, Interp, Layout, Normalize, Resize};
use crate::transform::Geometry;

/// Bit-for-bit semantics of cv2.INTER_LINEAR (half-pixel centres, edge clamp) in f64.
pub fn resize_bilinear(src: &[u8], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<f32> {
    let (fx, fy) = (sw as f64 / dw as f64, sh as f64 / dh as f64);
    let mut out = vec![0f32; dw * dh];
    for y in 0..dh {
        let syf = ((y as f64 + 0.5) * fy - 0.5).max(0.0);
        let y0 = (syf.floor() as usize).min(sh - 1); let y1 = (y0 + 1).min(sh - 1); let wy = syf - y0 as f64;
        for x in 0..dw {
            let sxf = ((x as f64 + 0.5) * fx - 0.5).max(0.0);
            let x0 = (sxf.floor() as usize).min(sw - 1); let x1 = (x0 + 1).min(sw - 1); let wx = sxf - x0 as f64;
            let p = |xx: usize, yy: usize| src[yy * sw + xx] as f64;
            out[y * dw + x] = ((1.0 - wy) * ((1.0 - wx) * p(x0, y0) + wx * p(x1, y0))
                             + wy * ((1.0 - wx) * p(x0, y1) + wx * p(x1, y1))) as f32;
        }
    }
    out
}
/// The film resized into its region of an ow × oh zero canvas (letterbox or stretch), 0–255 values.
fn paste(gray: &[u8], w: usize, h: usize, g: &Geometry, ow: usize, oh: usize) -> Vec<f32> {
    let inner = resize_bilinear(gray, w, h, g.inner_w as usize, g.inner_h as usize);
    let mut canvas = vec![0f32; ow * oh];
    for y in 0..g.inner_h as usize { let dst = (y + g.pad_y as usize) * ow + g.pad_x as usize;
        canvas[dst..dst + g.inner_w as usize].copy_from_slice(&inner[y * g.inner_w as usize..(y + 1) * g.inner_w as usize]); }
    canvas
}
/// letterbox-paste into size² zero canvas, then (v/255 − mean_c)/std_c, gray replicated to 3 channels, NCHW
pub fn to_tensor(gray: &[u8], w: usize, h: usize, g: &Geometry, size: usize, mean: [f32; 3], std: [f32; 3]) -> Vec<f32> {
    let canvas = paste(gray, w, h, g, size, size);
    let n = size * size; let mut t = vec![0f32; 3 * n];
    for c in 0..3 { for i in 0..n { t[c * n + i] = (canvas[i] / 255.0 - mean[c]) / std[c]; } }
    t
}

/// Pillow's Image.resize(BICUBIC) on 8-bit pixels, bit for bit (Resample.c): a = −0.5, support widened when shrinking,
/// 22-bit fixed point, a horizontal pass then a vertical one, each rounded and clipped to 0–255. GU2Net was trained on it.
pub fn pil_resize_bicubic(src: &[u8], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<u8> {
    fn filter(x: f64) -> f64 {
        let (a, x) = (-0.5, x.abs());
        if x < 1.0 { ((a + 2.0) * x - (a + 3.0)) * x * x + 1.0 } else if x < 2.0 { (((x - 5.0) * x + 8.0) * x - 4.0) * a } else { 0.0 }
    }
    pil_resample(src, sw, sh, dw, dh, filter, 2.0)
}
/// Pillow's Image.resize(BILINEAR) on 8-bit pixels, bit for bit: a triangle filter of support 1, widened by the shrink
/// factor (so it averages, unlike cv2's INTER_LINEAR). The Aariz model's own evaluation script resizes with it.
pub fn pil_resize_bilinear(src: &[u8], sw: usize, sh: usize, dw: usize, dh: usize) -> Vec<u8> {
    fn filter(x: f64) -> f64 { let x = x.abs(); if x < 1.0 { 1.0 - x } else { 0.0 } }
    pil_resample(src, sw, sh, dw, dh, filter, 1.0)
}
/// Resample.c's separable resampler for one filter and its support (in source pixels at scale 1).
fn pil_resample(src: &[u8], sw: usize, sh: usize, dw: usize, dh: usize, filter: fn(f64) -> f64, base_support: f64) -> Vec<u8> {
    const PB: u32 = 22;
    let coeffs = |insz: usize, outsz: usize| -> Vec<(usize, Vec<i64>)> {
        let scale = insz as f64 / outsz as f64;
        let fs = scale.max(1.0);
        let (support, ss) = (base_support * fs, 1.0 / fs);
        (0..outsz).map(|xx| {
            let c = (xx as f64 + 0.5) * scale;
            let xmin = ((c - support + 0.5) as i64).max(0) as usize;      // C's (int) truncates toward zero
            let xmax = (((c + support + 0.5) as i64) as usize).min(insz) - xmin;
            let k: Vec<f64> = (0..xmax).map(|x| filter((x as f64 + xmin as f64 - c + 0.5) * ss)).collect();
            let ww: f64 = k.iter().sum();
            let kk = k.iter().map(|&v| { let v = if ww != 0.0 { v / ww } else { v };
                (v * (1u64 << PB) as f64 + if v < 0.0 { -0.5 } else { 0.5 }) as i64 }).collect();
            (xmin, kk)
        }).collect()
    };
    let clip8 = |v: i64| (v >> PB).clamp(0, 255) as u8;
    let round = 1i64 << (PB - 1);
    let horiz: Vec<u8> = if dw != sw {
        let cs = coeffs(sw, dw);
        let mut out = Vec::with_capacity(dw * sh);
        for y in 0..sh {
            for (xmin, kk) in &cs { out.push(clip8(round + kk.iter().enumerate().map(|(i, k)| src[y * sw + xmin + i] as i64 * k).sum::<i64>())); }
        }
        out
    } else { src.to_vec() };
    if dh == sh { return horiz; }
    let cs = coeffs(sh, dh);
    let mut out = vec![0u8; dw * dh];
    for (yy, (ymin, kk)) in cs.iter().enumerate() {
        for x in 0..dw { out[yy * dw + x] = clip8(round + kk.iter().enumerate().map(|(i, k)| horiz[(ymin + i) * dw + x] as i64 * k).sum::<i64>()); }
    }
    out
}

/// cv2.warpAffine(INTER_LINEAR, constant border 0) for a scale-and-shift map, in f64: output pixel (u, v) samples the
/// film at ((u − bx)/ax, (v − by)/ay). OpenCV rounds its weights to 1/32 px; the CI tolerance allows for that.
pub fn warp_bilinear(src: &[u8], sw: usize, sh: usize, g: &Geometry) -> Vec<f32> {
    let (ow, oh) = (g.out_w as usize, g.out_h as usize);
    let p = |x: f64, y: f64| if x < 0.0 || y < 0.0 || x >= sw as f64 || y >= sh as f64 { 0.0 } else { src[y as usize * sw + x as usize] as f64 };
    let mut out = vec![0f32; ow * oh];
    for v in 0..oh {
        let sy = (v as f64 - g.by) / g.ay; let (y0, fy) = (sy.floor(), sy - sy.floor());
        for u in 0..ow {
            let sx = (u as f64 - g.bx) / g.ax; let (x0, fx) = (sx.floor(), sx - sx.floor());
            out[v * ow + u] = ((1.0 - fy) * ((1.0 - fx) * p(x0, y0) + fx * p(x0 + 1.0, y0))
                             + fy * ((1.0 - fx) * p(x0, y0 + 1.0) + fx * p(x0 + 1.0, y0 + 1.0))) as f32;
        }
    }
    out
}

/// The model's input tensor for `input` (NCHW, or NCWH for `Layout::Cwh`).
pub fn input_tensor(gray: &[u8], w: usize, h: usize, g: &Geometry, input: &Input) -> anyhow::Result<Vec<f32>> {
    let (ow, oh) = (input.width as usize, input.height as usize);
    let plane: Vec<f32> = match input.resize {
        Resize::Letterbox { interp: Interp::Cv2Linear } | Resize::Stretch { interp: Interp::Cv2Linear, .. } => paste(gray, w, h, g, ow, oh),
        Resize::Stretch { interp: Interp::PilBicubic, .. } => pil_resize_bicubic(gray, w, h, ow, oh).into_iter().map(f32::from).collect(),
        Resize::Stretch { interp: Interp::PilBilinear, .. } => pil_resize_bilinear(gray, w, h, ow, oh).into_iter().map(f32::from).collect(),
        Resize::Topdown { .. } => warp_bilinear(gray, w, h, g),
        Resize::Letterbox { interp: Interp::PilBicubic | Interp::PilBilinear } => anyhow::bail!("letterbox with Pillow resizing is not supported"),
    };
    let n = ow * oh;
    let chans: Vec<Vec<f32>> = match input.normalize {
        Normalize::Fixed { mean, std, scale } =>
            (0..input.channels as usize).map(|c| plane.iter().map(|v| (v / scale - mean[c]) / std[c]).collect()).collect(),
        Normalize::Zscore => {
            let m = plane.iter().map(|&v| v as f64).sum::<f64>() / n as f64;
            let sd = (plane.iter().map(|&v| (v as f64 - m).powi(2)).sum::<f64>() / n as f64).sqrt();
            vec![plane.iter().map(|&v| ((v as f64 - m) / (sd + 1e-20)) as f32).collect(); input.channels as usize]
        }
    };
    let mut t = Vec::with_capacity(chans.len() * n);
    for p in chans {
        match input.layout {
            Layout::Chw => t.extend(p),
            Layout::Cwh => for x in 0..ow { for y in 0..oh { t.push(p[y * ow + x]); } },
        }
    }
    Ok(t)
}
/// 16-bit → 8-bit: window [p0.5, p99.5]
pub fn window_u16(px: &[u16]) -> Vec<u8> {
    let mut s = px.to_vec(); s.sort_unstable();
    let (lo, hi) = (s[s.len() / 200] as f32, s[s.len() * 199 / 200].max(s[s.len() / 200] + 1) as f32);
    px.iter().map(|&v| (((v as f32 - lo) / (hi - lo)).clamp(0.0, 1.0) * 255.0).round() as u8).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transform::{Geometry, ResizeMode};

    #[test] fn resize_matches_cv2_float_inter_linear() {
        let src: Vec<u8> = (0..16).collect();                       // 4×4 ramp; expected values from cv2 float32 INTER_LINEAR
        assert_eq!(resize_bilinear(&src, 4, 4, 2, 2), vec![2.5, 4.5, 10.5, 12.5]);
    }
    #[test] fn to_tensor_letterboxes_and_normalises() {
        let (w, h) = (1935usize, 2400usize);
        let g = Geometry::new(w as u32, h as u32, 768, ResizeMode::Letterbox);
        let (mean, std) = ([0.485f32, 0.456, 0.406], [0.229f32, 0.224, 0.225]);
        let t = to_tensor(&vec![255u8; w * h], w, h, &g, 768, mean, std);
        assert_eq!(t.len(), 3 * 768 * 768);
        for c in 0..3 {
            let at = |x: usize, y: usize| t[c * 768 * 768 + y * 768 + x];
            assert!((at(384, 400) - (1.0 - mean[c]) / std[c]).abs() < 1e-6);   // inside the pasted image
            assert!((at(10, 400) - (0.0 - mean[c]) / std[c]).abs() < 1e-6);    // letterbox padding
        }
    }
    fn fixture() -> Vec<u8> { (0..7).flat_map(|y| (0..9).map(move |x| ((x * 37 + y * 91) % 256) as u8)).collect() }
    /// Expected values from Pillow 12.3.0: Image.fromarray(src, 'L').resize(size, Image.BICUBIC), which is also
    /// Image.resize's default for RGB, the path GU2Net uses.
    #[test] fn pil_bicubic_matches_pillow_bit_for_bit() {
        let src = fixture();
        assert_eq!(pil_resize_bicubic(&src, 9, 7, 4, 3), vec![91, 132, 131, 101, 114, 108, 127, 129, 128, 112, 116, 128]);
        assert_eq!(pil_resize_bicubic(&src, 9, 7, 5, 6), vec![24, 97, 161, 158, 33, 141, 143, 148, 63, 150, 128, 52, 112, 179, 137,
            71, 165, 109, 115, 79, 200, 99, 70, 129, 209, 74, 102, 181, 90, 73]);
        let up = pil_resize_bicubic(&src, 9, 7, 12, 9);
        assert_eq!(&up[..12], &[0, 17, 47, 75, 102, 129, 162, 199, 238, 78, 0, 38]);
        assert_eq!(&up[96..], &[24, 46, 81, 118, 144, 172, 212, 205, 10, 4, 45, 68]);
    }
    /// Pillow's BILINEAR shrinking 4 → 2 widens the triangle to 2 px each side (scale 2), so each output reads three
    /// inputs, weighted 3:3:1 (left) and 1:3:3 (right), normalised by 7. Row [0, 70, 140, 210]: (0·3 + 70·3 + 140)/7 = 50
    /// and (70 + 140·3 + 210·3)/7 = 160; each row adds 7·y, and the column pass adds (0·3 + 7·3 + 14)/7 = 5 or
    /// (7 + 14·3 + 21·3)/7 = 16. cv2's INTER_LINEAR samples two inputs instead: [39, 179, 53, 193].
    #[test] fn pil_bilinear_shrinks_with_a_widened_triangle() {
        let src: Vec<u8> = (0..4).flat_map(|y| (0..4).map(move |x| (70 * x + 7 * y) as u8)).collect();
        assert_eq!(pil_resize_bilinear(&src, 4, 4, 2, 2), vec![55, 165, 66, 176]);
        use crate::spec::{Coords, Input, Interp, Layout, Normalize, Resize};
        let input = Input { name: "x".into(), width: 2, height: 2, channels: 3, layout: Layout::Chw,
            resize: Resize::Stretch { interp: Interp::PilBilinear, coords: Coords::Corner },
            normalize: Normalize::Fixed { mean: [0.0; 3], std: [1.0; 3], scale: 1.0 } };
        let t = input_tensor(&src, 4, 4, &Geometry::stretch(4, 4, 2, 2, Coords::Corner), &input).unwrap();
        assert_eq!(t, [55.0, 165.0, 66.0, 176.0].repeat(3));
    }
    /// Expected values from Pillow 12.3.0: Image.fromarray(src, 'L').resize(size, Image.BILINEAR).
    #[test] fn pil_bilinear_matches_pillow_bit_for_bit() {
        let src = fixture();
        assert_eq!(pil_resize_bilinear(&src, 9, 7, 4, 3), vec![98, 130, 124, 106, 108, 113, 130, 123, 129, 111, 116, 130]);
        assert_eq!(pil_resize_bilinear(&src, 9, 7, 5, 6), vec![38, 96, 154, 147, 51, 135, 133, 146, 80, 138, 121, 72, 114, 162, 137,
            89, 147, 106, 120, 95, 179, 107, 81, 132, 190, 83, 105, 165, 91, 84]);
        let up = pil_resize_bilinear(&src, 9, 7, 12, 9);
        assert_eq!(&up[..12], &[0, 23, 51, 79, 106, 134, 162, 190, 217, 85, 17, 40]);
        assert_eq!(&up[96..], &[34, 57, 85, 113, 140, 168, 196, 192, 27, 23, 51, 74]);
    }
    #[test] fn warp_with_the_identity_map_copies_the_film() {
        let src = fixture();
        let g = Geometry::topdown(9, 7, 9, 7, 1.0);                         // box = film, same size: u = x, v = y
        assert!((g.ax - 1.0).abs() < 1e-12 && g.bx.abs() < 1e-12);
        let out = warp_bilinear(&src, 9, 7, &g);
        assert!(out.iter().zip(&src).all(|(a, &b)| (*a - b as f32).abs() < 1e-4));
    }
    #[test] fn zscore_transposed_input_is_normalised_and_x_major() {
        use crate::spec::{Coords, Input, Interp, Layout, Normalize, Resize};
        let src: Vec<u8> = vec![0, 10, 20, 30, 40, 50];                       // 3 wide × 2 high
        let input = Input { name: "x".into(), width: 3, height: 2, channels: 1, layout: Layout::Cwh,
            resize: Resize::Stretch { interp: Interp::PilBicubic, coords: Coords::Corner }, normalize: Normalize::Zscore };
        let g = Geometry::stretch(3, 2, 3, 2, Coords::Corner);
        let t = input_tensor(&src, 3, 2, &g, &input).unwrap();
        let mean = t.iter().sum::<f32>() / 6.0;
        assert!(mean.abs() < 1e-5);
        // x-major: (x0,y0)=0, (x0,y1)=30, (x1,y0)=10, (x1,y1)=40, (x2,y0)=20, (x2,y1)=50
        let order: Vec<usize> = { let mut i: Vec<usize> = (0..6).collect(); i.sort_by(|a, b| t[*a].total_cmp(&t[*b])); i };
        assert_eq!(order, [0, 2, 4, 1, 3, 5], "{t:?}");
    }
    #[test] fn window_u16_maps_percentiles_to_full_range() {
        let px: Vec<u16> = (0..1000u16).map(|v| v * 60).collect();
        let out = window_u16(&px);
        assert_eq!((out[0], out[999]), (0, 255));
        assert!(out[500] > 120 && out[500] < 135);
    }
}
