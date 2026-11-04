//! `--diag-facing` (debug instrument, task-2 debug 15 Oct 2026): runs each film both ways round (as-is, and mirrored
//! with the points mapped back) and prints AGGREGATES only — never a film id or a per-film row. Buckets with fewer than
//! `MIN_BUCKET` films are suppressed so no bucket stands for a single film. No scores are written.

/// One film's errors both ways round. Held in memory only; never printed or written per film.
#[derive(Clone, Debug)]
pub struct FilmDiag {
    pub width: u32,
    pub height: u32,
    pub mm_per_px: f64,
    /// (landmark, radial error mm) for the as-is pass and the mirrored pass (points mapped back to the film).
    pub as_is: Vec<(String, f64)>,
    pub mirrored: Vec<(String, f64)>,
    /// What the app's automatic facing (`detect_auto`, the higher mean raw peak) chose for this film.
    pub auto_left: bool,
    pub grey: Grey,
    /// The file was 16-bit grey (windowed to 8 bits by `load_gray`), not 8-bit.
    pub sixteen_bit: bool,
    /// Ground-truth S–N in mm at this film's spacing (None if either point is missing).
    pub sn_mm: Option<f64>,
    /// Ground-truth S as a fraction of film width and height.
    pub s_frac: Option<(f64, f64)>,
}

/// Appearance of the 8-bit grey film the model is given (after `load_gray`): mean, SD (population), and the mean of a
/// frame 5% of the short side wide (at least 1 px) — a bright frame means a white background or an inverted film.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Grey { pub mean: f64, pub sd: f64, pub border_mean: f64 }

pub fn grey_stats(img: &image::GrayImage) -> Grey {
    let (w, h) = img.dimensions();
    let b = ((w.min(h) as f64 * 0.05) as u32).max(1);
    let (mut s, mut s2, mut bs, mut bn) = (0f64, 0f64, 0f64, 0f64);
    for (x, y, p) in img.enumerate_pixels() {
        let v = p.0[0] as f64; s += v; s2 += v * v;
        if x < b || y < b || x >= w - b || y >= h - b { bs += v; bn += 1.0; }
    }
    let n = (w as f64) * (h as f64);
    let mean = s / n;
    Grey { mean, sd: (s2 / n - mean * mean).max(0.0).sqrt(), border_mean: bs / bn }
}

pub const MIN_BUCKET: usize = 5;
/// A film counts as "fixed by mirroring" (or the reverse) only when its MRE moves by more than this.
pub const BIG_MM: f64 = 10.0;

fn mean(v: &[f64]) -> f64 { if v.is_empty() { f64::NAN } else { v.iter().sum::<f64>() / v.len() as f64 } }
fn errs(v: &[(String, f64)]) -> Vec<f64> { v.iter().map(|(_, e)| *e).collect() }
impl FilmDiag {
    pub fn mre_as_is(&self) -> f64 { mean(&errs(&self.as_is)) }
    pub fn mre_mirrored(&self) -> f64 { mean(&errs(&self.mirrored)) }
    /// The pass with the lower MRE (an oracle: it uses the ground truth; for diagnosis only).
    pub fn best(&self) -> &[(String, f64)] { if self.mre_mirrored() < self.mre_as_is() { &self.mirrored } else { &self.as_is } }
    /// The pass the app would have kept.
    pub fn auto(&self) -> &[(String, f64)] { if self.auto_left { &self.mirrored } else { &self.as_is } }
}

/// Nearest-rank percentile (p in 0..=100) of a non-empty list; NaN when empty.
pub fn percentile(v: &[f64], p: f64) -> f64 {
    if v.is_empty() { return f64::NAN; }
    let mut s = v.to_vec(); s.sort_by(|a, b| a.total_cmp(b));
    let rank = ((p / 100.0) * s.len() as f64).ceil().max(1.0) as usize;
    s[rank.min(s.len()) - 1]
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FacingSummary {
    pub n: usize,
    /// Films whose mirrored MRE is lower than the as-is MRE by more than `BIG_MM`, and the reverse.
    pub mirrored_better_big: usize,
    pub as_is_better_big: usize,
    /// Point-weighted MRE (as the bench reports it) for: as-is only, mirrored only, the better pass per film, the app's pass.
    pub mre_as_is: f64,
    pub mre_mirrored: f64,
    pub mre_best: f64,
    pub mre_auto: f64,
    /// Films the app's automatic facing would run mirrored.
    pub auto_left: usize,
    /// Among films where the two passes differ by more than `BIG_MM`: how many the app's choice gets right.
    pub decisive: usize,
    pub auto_right_on_decisive: usize,
    /// Per-film MRE spread of the as-is pass, and of the better pass.
    pub film_as_is_p50: f64,
    pub film_as_is_p90: f64,
    pub film_best_p50: f64,
    pub film_best_p90: f64,
    /// Films whose as-is MRE is over `BIG_MM`, and how many of those the better pass brings under 5 mm.
    pub as_is_over_big: usize,
    pub of_which_best_under_5: usize,
}

pub fn summarize_facing(films: &[FilmDiag]) -> FacingSummary {
    let cat = |f: &dyn Fn(&FilmDiag) -> Vec<f64>| films.iter().flat_map(f).collect::<Vec<f64>>();
    let decisive: Vec<&FilmDiag> = films.iter().filter(|f| (f.mre_as_is() - f.mre_mirrored()).abs() > BIG_MM).collect();
    let film_as_is: Vec<f64> = films.iter().map(FilmDiag::mre_as_is).collect();
    let film_best: Vec<f64> = films.iter().map(|f| mean(&errs(f.best()))).collect();
    let over: Vec<&FilmDiag> = films.iter().filter(|f| f.mre_as_is() > BIG_MM).collect();
    FacingSummary {
        n: films.len(),
        mirrored_better_big: films.iter().filter(|f| f.mre_as_is() - f.mre_mirrored() > BIG_MM).count(),
        as_is_better_big: films.iter().filter(|f| f.mre_mirrored() - f.mre_as_is() > BIG_MM).count(),
        mre_as_is: mean(&cat(&|f| errs(&f.as_is))),
        mre_mirrored: mean(&cat(&|f| errs(&f.mirrored))),
        mre_best: mean(&cat(&|f| errs(f.best()))),
        mre_auto: mean(&cat(&|f| errs(f.auto()))),
        auto_left: films.iter().filter(|f| f.auto_left).count(),
        decisive: decisive.len(),
        auto_right_on_decisive: decisive.iter().filter(|f| f.auto_left == (f.mre_mirrored() < f.mre_as_is())).count(),
        film_as_is_p50: percentile(&film_as_is, 50.0),
        film_as_is_p90: percentile(&film_as_is, 90.0),
        film_best_p50: percentile(&film_best, 50.0),
        film_best_p90: percentile(&film_best, 90.0),
        as_is_over_big: over.len(),
        of_which_best_under_5: over.iter().filter(|f| mean(&errs(f.best())) < 5.0).count(),
    }
}

/// Per landmark: (id, MRE as-is, MRE of the better pass per film), in first-seen order.
pub fn per_landmark(films: &[FilmDiag]) -> Vec<(String, f64, f64)> {
    let mut ids: Vec<String> = Vec::new();
    for f in films { for (id, _) in &f.as_is { if !ids.contains(id) { ids.push(id.clone()); } } }
    ids.into_iter().map(|id| {
        let pick = |v: &[(String, f64)]| v.iter().filter(|(n, _)| *n == id).map(|(_, e)| *e).collect::<Vec<_>>();
        let a: Vec<f64> = films.iter().flat_map(|f| pick(&f.as_is)).collect();
        let b: Vec<f64> = films.iter().flat_map(|f| pick(f.best())).collect();
        (id.clone(), mean(&a), mean(&b))
    }).collect()
}

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Bucket {
    pub lo: f64,
    pub hi: f64,
    pub n: usize,
    /// None when `n < MIN_BUCKET` (suppressed so a bucket never stands for one film).
    pub mre_as_is: Option<f64>,
    pub mre_best: Option<f64>,
    pub mirrored_better_big: Option<usize>,
}

/// Films grouped by `key` into [edges[i], edges[i+1]) with open ends (−∞ and +∞ added).
pub fn buckets(films: &[FilmDiag], key: impl Fn(&FilmDiag) -> f64, edges: &[f64]) -> Vec<Bucket> {
    let mut bounds = vec![f64::NEG_INFINITY]; bounds.extend_from_slice(edges); bounds.push(f64::INFINITY);
    bounds.windows(2).map(|w| {
        let inb: Vec<&FilmDiag> = films.iter().filter(|f| { let k = key(f); k >= w[0] && k < w[1] }).collect();
        let shown = inb.len() >= MIN_BUCKET;
        let pts = |g: &dyn Fn(&FilmDiag) -> Vec<f64>| inb.iter().flat_map(|f| g(f)).collect::<Vec<f64>>();
        Bucket {
            lo: w[0], hi: w[1], n: inb.len(),
            mre_as_is: shown.then(|| mean(&pts(&|f| errs(&f.as_is)))),
            mre_best: shown.then(|| mean(&pts(&|f| errs(f.best())))),
            mirrored_better_big: shown.then(|| inb.iter().filter(|f| f.mre_as_is() - f.mre_mirrored() > BIG_MM).count()),
        }
    }).collect()
}

/// Ground-truth distance between two landmarks in mm at the film's spacing (spacing check: adult S–N is about 65–80 mm
/// on any machine, so a film whose S–N reads far outside that has the wrong spacing, whatever its pixel size).
pub fn truth_distance_mm(truth: &[(String, f64, f64)], a: &str, b: &str, mm_per_px: f64) -> Option<f64> {
    let get = |n: &str| truth.iter().find(|(id, _, _)| id == n).map(|(_, x, y)| (*x, *y));
    let (p, q) = (get(a)?, get(b)?);
    Some((p.0 - q.0).hypot(p.1 - q.1) * mm_per_px)
}

/// For the head-size control: the film centred on a black canvas `factor` times as wide and as high (so the head fills
/// less of the frame, as on a machine with a larger field of view), and its ground truth shifted by the same offset.
pub fn pad_film(img: &image::GrayImage, truth: &[(String, f64, f64)], factor: f64) -> (image::GrayImage, Vec<(String, f64, f64)>) {
    let (w, h) = img.dimensions();
    let (nw, nh) = ((w as f64 * factor).round() as u32, (h as f64 * factor).round() as u32);
    let (ox, oy) = ((nw - w) / 2, (nh - h) / 2);
    let mut out = image::GrayImage::new(nw, nh);
    image::imageops::replace(&mut out, img, ox as i64, oy as i64);
    (out, truth.iter().map(|(id, x, y)| (id.clone(), x + ox as f64, y + oy as f64)).collect())
}

/// Where a head sits in a reference film: canvas size, S as a fraction of width and height, and S–N as a fraction of
/// the width. `ISBI` is Ceph-400 test1's median (measured with `--diag-facing`, 15 Oct 2026; see task-2-debug.md).
#[derive(Clone, Copy, Debug)]
pub struct Frame { pub canvas: (u32, u32), pub s: (f64, f64), pub sn_frac_w: f64 }
pub const ISBI: Frame = Frame { canvas: (1935, 2400), s: (0.419, 0.439), sn_frac_w: 0.302 };   // Ceph-400 test1 medians, n 150

/// A film, its ground truth and its spacing after re-framing.
pub type Reframed = (image::GrayImage, Vec<(String, f64, f64)>, f64);

/// Oracle re-framing (diagnosis only — it uses the ground truth S and N): scales the film uniformly so S–N is
/// `sn_frac_w` of the canvas width and shifts it so S lands on `s` (to the nearest pixel), on a black canvas. Returns
/// the new film, its truth (same mapping as the pixels: half-pixel centres) and its new spacing. None without S or N.
pub fn reframe(img: &image::GrayImage, truth: &[(String, f64, f64)], mm_per_px: f64, f: &Frame) -> Option<Reframed> {
    let get = |n: &str| truth.iter().find(|(id, _, _)| id == n).map(|(_, x, y)| (*x, *y));
    let (s, n) = (get("S")?, get("N")?);
    let k = f.sn_frac_w * f.canvas.0 as f64 / (s.0 - n.0).hypot(s.1 - n.1);
    let (w, h) = img.dimensions();
    let (nw, nh) = (((w as f64 * k).round() as u32).max(1), ((h as f64 * k).round() as u32).max(1));
    let (kx, ky) = (nw as f64 / w as f64, nh as f64 / h as f64);
    let map = |x: f64, y: f64| ((x + 0.5) * kx - 0.5, (y + 0.5) * ky - 0.5);
    let scaled = image::imageops::resize(img, nw, nh, image::imageops::FilterType::Triangle);
    let (ms, mt) = (map(s.0, s.1), (f.s.0 * f.canvas.0 as f64, f.s.1 * f.canvas.1 as f64));
    let (ox, oy) = ((mt.0 - ms.0).round(), (mt.1 - ms.1).round());
    let mut out = image::GrayImage::new(f.canvas.0, f.canvas.1);
    image::imageops::replace(&mut out, &scaled, ox as i64, oy as i64);
    let t = truth.iter().map(|(id, x, y)| { let (u, v) = map(*x, *y); (id.clone(), u + ox, v + oy) }).collect();
    Some((out, t, mm_per_px / k))
}

/// For the positive control: ground truth of a film mirrored left-right (pixel-index convention, x' = w − 1 − x).
pub fn mirror_truth(truth: &[(String, f64, f64)], width: u32) -> Vec<(String, f64, f64)> {
    truth.iter().map(|(id, x, y)| (id.clone(), (width - 1) as f64 - x, *y)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn film(as_is: f64, mirrored: f64, auto_left: bool, w: u32, h: u32) -> FilmDiag {
        FilmDiag { width: w, height: h, mm_per_px: 0.1, auto_left, grey: Grey::default(), sixteen_bit: false, sn_mm: None, s_frac: None,
            as_is: vec![("S".into(), as_is), ("N".into(), as_is)], mirrored: vec![("S".into(), mirrored), ("N".into(), mirrored)] }
    }
    #[test] fn facing_summary_counts_films_mirroring_fixes_and_the_better_pass_mre() {
        let f = vec![
            film(1.0, 40.0, false, 1000, 1200),     // right-facing, app right
            film(30.0, 2.0, true, 1000, 1200),      // left-facing, app mirrored: right
            film(50.0, 3.0, false, 1000, 1200),     // left-facing, app did NOT mirror: wrong
            film(4.0, 6.0, false, 1000, 1200),      // not decisive
        ];
        let s = summarize_facing(&f);
        assert_eq!((s.n, s.mirrored_better_big, s.as_is_better_big), (4, 2, 1));
        assert!((s.mre_as_is - 85.0 / 4.0).abs() < 1e-12);
        assert!((s.mre_mirrored - 51.0 / 4.0).abs() < 1e-12);
        assert!((s.mre_best - (1.0 + 2.0 + 3.0 + 4.0) / 4.0).abs() < 1e-12);
        assert!((s.mre_auto - (1.0 + 2.0 + 50.0 + 4.0) / 4.0).abs() < 1e-12);
        assert_eq!((s.auto_left, s.decisive, s.auto_right_on_decisive), (1, 3, 2));
        assert_eq!((s.as_is_over_big, s.of_which_best_under_5), (2, 2));
        assert_eq!((s.film_as_is_p50, s.film_as_is_p90), (4.0, 50.0));
    }
    #[test] fn per_landmark_reports_as_is_and_best() {
        let f = vec![film(1.0, 40.0, false, 10, 10), film(30.0, 2.0, true, 10, 10)];
        assert_eq!(per_landmark(&f), vec![("S".to_string(), 15.5, 1.5), ("N".to_string(), 15.5, 1.5)]);
    }
    #[test] fn small_buckets_are_suppressed_and_edges_are_half_open() {
        let mut f: Vec<FilmDiag> = (0..5).map(|_| film(30.0, 2.0, false, 2000, 1000)).collect();   // aspect 2.0
        f.push(film(1.0, 9.0, false, 1000, 1000));                                                  // aspect 1.0: alone
        let b = buckets(&f, |x| x.width as f64 / x.height as f64, &[1.0, 1.5]);
        assert_eq!(b.iter().map(|x| x.n).collect::<Vec<_>>(), vec![0, 1, 5]);
        assert_eq!((b[1].mre_as_is, b[1].mirrored_better_big), (None, None));                      // one film: hidden
        assert_eq!((b[2].mre_as_is, b[2].mre_best, b[2].mirrored_better_big), (Some(30.0), Some(2.0), Some(5)));
    }
    #[test] fn mirrored_truth_uses_the_pixel_index_convention() {
        assert_eq!(mirror_truth(&[("S".into(), 10.0, 7.0)], 400), vec![("S".to_string(), 389.0, 7.0)]);
    }
    #[test] fn grey_stats_gives_mean_sd_and_the_border_mean() {
        // 20 × 20, bright (200) only in a 2-px band on the RIGHT and BOTTOM, so a frame read on one side only is caught.
        // The frame is 5% of 20 = 1 px: 76 pixels; bright: right column 20 + bottom row 19 + (18, 0) + (0, 18) = 41.
        let img = image::GrayImage::from_fn(20, 20, |x, y| image::Luma([if x >= 18 || y >= 18 { 200 } else { 0 }]));
        let g = grey_stats(&img);
        let bright = 400 - 18 * 18;
        assert!((g.mean - 200.0 * bright as f64 / 400.0).abs() < 1e-9);
        assert!((g.border_mean - 200.0 * 41.0 / 76.0).abs() < 1e-9, "{g:?}");
        let p = bright as f64 / 400.0;
        assert!((g.sd - 200.0 * (p * (1.0 - p)).sqrt()).abs() < 1e-9, "{g:?}");
    }
    #[test] fn truth_distance_uses_the_films_spacing_and_is_none_without_both_points() {
        let t = vec![("S".to_string(), 0.0, 0.0), ("N".to_string(), 300.0, 400.0)];
        assert_eq!(truth_distance_mm(&t, "S", "N", 0.1), Some(50.0));
        assert_eq!(truth_distance_mm(&t, "S", "N", 0.14), Some(70.0));
        assert_eq!(truth_distance_mm(&t, "S", "Me", 0.1), None);
    }
    #[test] fn padding_keeps_a_known_point_on_its_pixel() {
        let mut img = image::GrayImage::new(40, 30);
        img.put_pixel(7, 11, image::Luma([255]));
        let (p, t) = pad_film(&img, &[("S".to_string(), 7.0, 11.0)], 1.5);
        assert_eq!(p.dimensions(), (60, 45));
        let (x, y) = (t[0].1, t[0].2);
        assert_eq!((x, y), (17.0, 18.0));                                   // offset (10, 7)
        assert_eq!(p.get_pixel(x as u32, y as u32).0[0], 255);
        assert_eq!(p.iter().filter(|v| **v == 255).count(), 1);
        let (q, u) = pad_film(&img, &[("S".to_string(), 7.0, 11.0)], 1.0);  // factor 1: unchanged
        assert_eq!((q.dimensions(), u[0].1, u[0].2), ((40, 30), 7.0, 11.0));
    }
    #[test] fn reframing_puts_s_and_n_where_asked_and_the_truth_follows_the_pixels() {
        // 400 × 300 film, S dot at (100, 120), N dot at (180, 120): S–N 80 px.
        let mut img = image::GrayImage::new(400, 300);
        for (x, y) in [(100u32, 120u32), (180, 120)] { for dx in 0..3 { for dy in 0..3 { img.put_pixel(x - 1 + dx, y - 1 + dy, image::Luma([255])); } } }
        let truth = vec![("S".to_string(), 100.0, 120.0), ("N".to_string(), 180.0, 120.0), ("Me".to_string(), 150.0, 250.0)];
        let target = Frame { canvas: (500, 600), s: (0.4, 0.3), sn_frac_w: 0.32 };          // S at (200, 180); S–N 160 px: ×2
        let (out, t, mm) = reframe(&img, &truth, 0.1, &target).unwrap();
        assert_eq!(out.dimensions(), (500, 600));
        assert!((mm - 0.05).abs() < 1e-12, "{mm}");                                         // twice the pixels per mm
        let get = |n: &str| t.iter().find(|(id, _, _)| id == n).map(|(_, x, y)| (*x, *y)).unwrap();
        let (sx, sy) = get("S"); let (nx, ny) = get("N"); let (mx, my) = get("Me");
        assert!((sx - 200.0).abs() <= 0.5 && (sy - 180.0).abs() <= 0.5, "S at ({sx},{sy})");   // to the nearest pixel
        assert!(((nx - sx).hypot(ny - sy) - 160.0).abs() < 1e-9);
        assert!((mx - sx - 100.0).abs() < 1e-9 && (my - sy - 260.0).abs() < 1e-9, "Me at ({mx},{my})");
        for (x, y) in [(sx, sy), (nx, ny)] { assert!(out.get_pixel(x.round() as u32, y.round() as u32).0[0] > 128, "dot not under ({x},{y})"); }
        assert!(reframe(&img, &truth[..1], 0.1, &target).is_none());                        // no N: cannot reframe
    }
    #[test] fn percentile_is_nearest_rank() {
        assert_eq!(percentile(&[5.0, 1.0, 3.0, 2.0, 4.0], 50.0), 3.0);
        assert_eq!(percentile(&[5.0, 1.0, 3.0, 2.0, 4.0], 90.0), 5.0);
        assert!(percentile(&[], 50.0).is_nan());
    }
}
