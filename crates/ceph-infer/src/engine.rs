use crate::decode::{decode_dark, decode_heatmap};
use crate::preprocess::{input_tensor, window_u16};
use crate::spec::{Decode, Layout, ModelSpec, Runtime};
use crate::transform::{heatmap_to_input, Geometry};
use ort::execution_providers::coreml::{CoreMLComputeUnits, CoreMLModelFormat};
use ort::execution_providers::{CoreMLExecutionProvider, ExecutionProvider};
use ort::{session::Session, value::Tensor};
use serde::Serialize;
use std::{path::Path, sync::Mutex, time::Instant};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DetectedLandmark {
    pub id: String, pub x: f64, pub y: f64,
    /// Heatmap peak capped to 0..1, for display (§11: never shown as a percentage).
    pub confidence: f32,
    /// The raw heatmap peak. Often above 1 for this model; used to compare the two facing passes.
    #[serde(skip)]
    pub peak: f32,
    /// The heat map's spread around this point, [xx, xy, yy] in film px² (spec 2026-10-13 §6.1); None if the window held no positive weight.
    pub cov: Option<[f64; 3]>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings { pub preprocess: f64, pub inference: f64, pub decode: f64, pub total: f64 }
impl Timings {
    fn from(t0: Instant, t1: Instant, t2: Instant, t3: Instant) -> Self {
        let ms = |a: Instant, b: Instant| (b - a).as_secs_f64() * 1e3;
        Self { preprocess: ms(t0, t1), inference: ms(t1, t2), decode: ms(t2, t3), total: ms(t0, t3) }
    }
}

/// One output channel's peak in canonical film pixels, mapped to a landmark or not (spec 2026-10-01 Part 3).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RawPoint {
    pub channel: u32, pub landmark_id: Option<String>, pub x: f64, pub y: f64, pub peak: f32,
    /// The heat map's spread around this point, [xx, xy, yy] in film px² (spec 2026-10-13 §6.1); None if the window held no positive weight.
    pub cov: Option<[f64; 3]>,
}

/// Landmarks in canonical image space I (original pixels, pixel-index convention, y down).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detection {
    pub model_id: String,
    pub image_width: u32,
    pub image_height: u32,
    pub execution_provider: String,
    pub timings_ms: Timings,
    pub landmarks: Vec<DetectedLandmark>,
    /// Every channel's point, including channels not mapped to a landmark yet.
    pub raw: Vec<RawPoint>,
    /// Which version of the model ran: its fingerprint (spec::fingerprint; Part F, owner Q9), from the hashes verified at load.
    pub model_sha256: String,
}

/// Smallest image side accepted: below this the letterbox scale can round to zero and produce NaN coordinates.
pub const MIN_SIDE: u32 = 64;

/// What one run produced before decoding: the input tensor (if kept), the heatmaps, the geometry, and when
/// preprocessing ended.
struct Stages { input: Option<Vec<f32>>, heatmaps: Vec<f32>, geometry: Geometry, preprocessed: Instant }

pub struct Engine { session: Mutex<Session>, m: ModelSpec, provider: &'static str }

/// One model load at a time in this process. ONNX Runtime 1.22 finds a model's separate weights
/// file through the C library's `dirname()`, and on macOS that returns one buffer shared by the whole process. Two
/// loads at once could each read the other's folder, look for `weights.bin` in the wrong place and fail with
/// "Encountered unknown exception in Initialize()". Only the start-up of a session waits here; runs on films do not.
pub(crate) static SESSION_START: Mutex<()> = Mutex::new(());

/// Test-only (Review I-1): poisons `SESSION_START` by panicking on another thread while it holds the lock, so an
/// integration test can exercise the `into_inner()` recovery at `Engine::load`'s line above without needing a real
/// ONNX Runtime panic. Not called by any production path. `#[doc(hidden)]` because integration tests (a separate
/// crate) cannot see a `#[cfg(test)]` item from the library they link against.
#[doc(hidden)]
pub fn poison_session_start_for_test() {
    std::thread::spawn(|| {
        let _guard = SESSION_START.lock().unwrap();
        panic!("SYNTHETIC: poisoning SESSION_START for test (Review I-1)");
    })
    .join()
    .expect_err("the spawned thread must panic to poison the lock");
}

/// Test-only (Part F I-1 residual): holds `SESSION_START` until the returned guard is dropped, as a model load part-way
/// through does, so a test can stand a slow load in front of another load. Not called by any production path.
#[doc(hidden)]
pub fn hold_session_start_for_test() -> impl Sized { SESSION_START.lock().unwrap_or_else(|p| p.into_inner()) }

impl Engine {
    pub fn load(manifest_path: &Path) -> anyhow::Result<Self> {
        let m = ModelSpec::load(manifest_path)?;
        let dir = manifest_path.parent().unwrap_or(Path::new("."));
        m.verify(dir)?;                                                    // refuse a tampered/mismatched model or weights
        let model = dir.join(&m.file);                                     // ONNX Runtime finds external weights beside it
        // Record the provider that is really used: CoreML only where ONNX Runtime reports it available. The manifest's
        // runtime picks it; CEPHTRACE_PROVIDER (cpu, coreml, coreml-fp32) overrides it for parity on a Mac.
        let runtime = match std::env::var("CEPHTRACE_PROVIDER").as_deref() {
            Ok("cpu") => Runtime::Cpu, Ok("coreml") => Runtime::Coreml, Ok("coreml-fp32") => Runtime::CoremlFp32, _ => m.runtime,
        };
        let (coreml, name) = match runtime {
            Runtime::CoremlFp32 => (CoreMLExecutionProvider::default().with_model_format(CoreMLModelFormat::MLProgram)
                .with_compute_units(CoreMLComputeUnits::CPUAndGPU).with_low_precision_accumulation_on_gpu(false), "coreml-fp32"),
            _ => (CoreMLExecutionProvider::default(), "coreml"),
        };
        let (builder, provider) = if runtime != Runtime::Cpu && coreml.is_available().unwrap_or(false) {
            (Session::builder()?.with_execution_providers([coreml.build().error_on_failure()])?, name)
        } else {
            (Session::builder()?, "cpu")
        };
        let session = {
            let _one_at_a_time = SESSION_START.lock().unwrap_or_else(|p| p.into_inner());
            builder.commit_from_file(&model)?
        };
        let e = Self { session: Mutex::new(session), m, provider };
        e.warmup()?;                                                       // first CoreML run compiles; pay it at startup
        Ok(e)
    }

    pub fn manifest(&self) -> &ModelSpec { &self.m }
    /// "coreml", "coreml-fp32" or "cpu": the execution provider this engine really runs on.
    pub fn provider(&self) -> &'static str { self.provider }

    /// [1, C, h, w], or [1, C, w, h] for a transposed (GU2Net) input.
    fn input_shape(&self) -> [usize; 4] {
        let (c, w, h) = (self.m.input.channels as usize, self.m.input.width as usize, self.m.input.height as usize);
        match self.m.input.layout { Layout::Chw => [1, c, h, w], Layout::Cwh => [1, c, w, h] }
    }
    /// (rows, cols) of one heatmap as stored.
    fn heatmap_dims(&self) -> (usize, usize) {
        let (w, h) = (self.m.output.width as usize, self.m.output.height as usize);
        match self.m.input.layout { Layout::Chw => (h, w), Layout::Cwh => (w, h) }
    }

    /// One run at load: pays CoreML's compile cost up front and proves the model's output matches the manifest.
    fn warmup(&self) -> anyhow::Result<()> {
        let shape = self.input_shape();
        let input = Tensor::from_array((shape, vec![0f32; shape.iter().product()]))?;
        let mut sess = self.lock()?;
        let out = sess.run(ort::inputs![self.m.input.name.as_str() => input])?;
        let (shape, _) = out[self.m.output.name.as_str()].try_extract_tensor::<f32>()?;
        self.check_output_shape(shape)
    }

    /// Test-only (Part F final review I-1): holds this engine's session as a run on a film does, until the returned guard
    /// is dropped, so a test can stand a "film part-way through" in front of another run. Not called by any production
    /// path; `#[doc(hidden)]` because the app's tests (another crate) cannot see a `#[cfg(test)]` item.
    #[doc(hidden)]
    pub fn hold_session_for_test(&self) -> impl Sized + '_ { self.lock().expect("SYNTHETIC: the session lock is healthy in tests") }

    fn lock(&self) -> anyhow::Result<std::sync::MutexGuard<'_, Session>> {
        self.session.lock().map_err(|_| anyhow::anyhow!("inference engine is unavailable after an earlier failure; reload the model"))
    }

    fn check_output_shape(&self, shape: &[i64]) -> anyhow::Result<()> {
        let (n, (rows, cols)) = (self.m.landmark_map.len() as i64, self.heatmap_dims());
        anyhow::ensure!(shape == [1, n, rows as i64, cols as i64],
            "model output {shape:?} does not match the manifest ([1, {n}, {rows}, {cols}]); the manifest and model are out of step");
        Ok(())
    }

    /// The pipeline up to the heatmaps.
    fn infer(&self, img: &image::GrayImage, facing_left: bool, keep_input: bool) -> anyhow::Result<Stages> {
        let mut img = img.clone();
        if facing_left { image::imageops::flip_horizontal_in_place(&mut img); }
        let (w, h) = img.dimensions();
        anyhow::ensure!(w >= MIN_SIDE && h >= MIN_SIDE, "image is {w}×{h} px; a cephalogram needs at least {MIN_SIDE} px per side");
        let g = Geometry::for_input(w, h, &self.m.input);
        let data = input_tensor(img.as_raw(), w as usize, h as usize, &g, &self.m.input)?;
        let kept = keep_input.then(|| data.clone());
        let t1 = Instant::now();
        let input = Tensor::from_array((self.input_shape(), data))?;
        let mut sess = self.lock()?;
        let out = sess.run(ort::inputs![self.m.input.name.as_str() => input])?;
        let (shape, hm) = out[self.m.output.name.as_str()].try_extract_tensor::<f32>()?;
        self.check_output_shape(shape)?;
        Ok(Stages { input: kept, heatmaps: hm.to_vec(), geometry: g, preprocessed: t1 })
    }

    /// The input tensor, the heatmaps and the geometry for one film: everything `detect` maps to points. Used by the CI
    /// parity tool, so the app and the check share every line.
    pub fn run_raw(&self, img: &image::GrayImage, facing_left: bool) -> anyhow::Result<(Vec<f32>, Vec<f32>, Geometry)> {
        let s = self.infer(img, facing_left, true)?;
        Ok((s.input.unwrap_or_default(), s.heatmaps, s.geometry))
    }

    pub fn detect(&self, img: &image::GrayImage, facing_left: bool) -> anyhow::Result<Detection> {
        let t0 = Instant::now();
        let s = self.infer(img, facing_left, false)?;
        let (t1, t2) = (s.preprocessed, Instant::now());
        let (landmarks, raw) = points_from_heatmaps(&self.m, &s.geometry, &s.heatmaps, img.width(), facing_left);
        Ok(Detection { model_id: self.m.id.clone(), image_width: img.width(), image_height: img.height(), execution_provider: self.provider.into(),
            timings_ms: Timings::from(t0, t1, t2, Instant::now()), landmarks, raw, model_sha256: self.m.fingerprint() })
    }

    pub fn detect_path(&self, path: &Path, facing_left: bool) -> anyhow::Result<Detection> { self.detect(&load_gray(path)?, facing_left) }

    /// Runs both orientations and keeps the more confident one (about twice the time of `detect`).
    pub fn detect_auto(&self, img: &image::GrayImage) -> anyhow::Result<AutoDetection> {
        let (r, l) = (self.detect(img, false)?, self.detect(img, true)?);
        let (pr, pl) = (mean_peak(&r), mean_peak(&l));
        let facing_left = choose_facing_left(pr, pl);
        Ok(AutoDetection { detection: if facing_left { l } else { r }, facing_left, mean_peak_right: Some(pr), mean_peak_left: Some(pl) })
    }
}

/// Every channel's peak in film pixels (canonical, unflipped), with its spread; the mapped channels also as landmarks.
pub fn points_from_heatmaps(m: &ModelSpec, g: &Geometry, hm: &[f32], img_w: u32, facing_left: bool) -> (Vec<DetectedLandmark>, Vec<RawPoint>) {
    points_from_heatmaps_with(m, g, hm, img_w, facing_left, crate::crosscheck::params().spread_window_cells)
}

/// `points_from_heatmaps` with an explicit spread window (the bench tunes it, spec §4 "Spread calibration"). The decode
/// lines are unchanged; the spread is computed beside them from the same channel.
pub fn points_from_heatmaps_with(m: &ModelSpec, g: &Geometry, hm: &[f32], img_w: u32, facing_left: bool, window: usize) -> (Vec<DetectedLandmark>, Vec<RawPoint>) {
    let (rows, cols) = match m.input.layout { Layout::Chw => (m.output.height as usize, m.output.width as usize), Layout::Cwh => (m.output.width as usize, m.output.height as usize) };
    let (mut lms, mut raw) = (Vec::new(), Vec::new());
    for (k, id) in m.landmark_map.iter().enumerate() {
        let ch = &hm[k * rows * cols..(k + 1) * rows * cols];
        let p = match m.output.decode {
            Decode::Softargmax { window } => decode_heatmap(ch, cols, rows, window),
            Decode::Argmax => decode_heatmap(ch, cols, rows, 1),
            Decode::Dark { kernel } => decode_dark(ch, cols, rows, kernel),
        };
        let (xh, yh) = match m.input.layout { Layout::Chw => (p.x, p.y), Layout::Cwh => (p.y, p.x) };
        let (u, v) = heatmap_to_input(xh, yh, m.output.stride as f64, m.output.heatmap_center);
        let (mut x, y) = g.to_image(u, v);
        if facing_left { x = (img_w - 1) as f64 - x; }
        let cov = crate::spread::heatmap_spread(ch, cols, rows, p.x, p.y, window)
            .map(|c| crate::spread::to_film(c, m.input.layout, m.output.stride as f64, g, facing_left));
        raw.push(RawPoint { channel: k as u32, landmark_id: id.clone(), x, y, peak: p.score, cov });
        if let Some(id) = id { lms.push(DetectedLandmark { id: id.clone(), x, y, confidence: p.score.clamp(0.0, 1.0), peak: p.score, cov }); }
    }
    (lms, raw)
}

/// Opens a film as 8-bit grey: 16-bit greyscale is windowed to 8 bits ([p0.5, p99.5]), anything else is converted to luma8.
pub fn load_gray(path: &Path) -> anyhow::Result<image::GrayImage> {
    Ok(match image::open(path)? {
        image::DynamicImage::ImageLuma16(i) => {
            let (w, h) = i.dimensions();
            image::GrayImage::from_raw(w, h, window_u16(i.as_raw())).expect("same dimensions")
        }
        other => other.to_luma8(),
    })
}

/// Detection plus the facing it was run with (§2 "mirror on upload", decision 14). The mean raw peak of each pass is
/// kept so a near tie can be flagged and a wrong call diagnosed; a pass that was not run is None.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoDetection {
    #[serde(flatten)]
    pub detection: Detection,
    pub facing_left: bool,
    pub mean_peak_right: Option<f32>,
    pub mean_peak_left: Option<f32>,
}

/// Mean raw heatmap peak. The capped confidence cannot be used: it saturates at 1.0 on real films for both passes.
pub fn mean_peak(d: &Detection) -> f32 {
    if d.landmarks.is_empty() { return 0.0; }
    d.landmarks.iter().map(|l| l.peak).sum::<f32>() / d.landmarks.len() as f32
}

/// The model only saw right-facing films in training, so the pass whose heatmaps peak higher saw the face the right
/// way round. A tie keeps the dataset convention (facing right).
pub fn choose_facing_left(right: f32, left: f32) -> bool { left > right }

#[cfg(test)]
mod tests {
    use super::*;
    fn det(conf: &[f32]) -> Detection {
        Detection { model_id: "m".into(), image_width: 1, image_height: 1, execution_provider: "cpu".into(),
            timings_ms: Timings { preprocess: 0.0, inference: 0.0, decode: 0.0, total: 0.0 }, raw: vec![], model_sha256: "s".into(),
            landmarks: conf.iter().enumerate().map(|(i, c)| DetectedLandmark { id: i.to_string(), x: 0.0, y: 0.0, confidence: *c, peak: *c, cov: None }).collect() }
    }
    fn det_peaks(peaks: &[f32]) -> Detection {
        let mut d = det(&vec![1.0; peaks.len()]);                                  // capped confidence: 1.0 everywhere
        for (l, p) in d.landmarks.iter_mut().zip(peaks) { l.peak = *p; }
        d
    }
    /// A minimal `ModelSpec` for heatmap-decode tests: fixed 40×50 transposed (Cwh) output, varying only the map.
    fn spec(landmark_map: Vec<Option<String>>) -> crate::spec::ModelSpec {
        use crate::spec::*;
        ModelSpec { manifest_version: 2, id: "t".into(), version: "v".into(), title: String::new(), file: "m".into(), sha256: "s".into(), weights: None,
            input: Input { name: "image".into(), width: 40, height: 50, channels: 1, layout: Layout::Cwh,
                resize: Resize::Stretch { interp: Interp::PilBicubic, coords: Coords::Corner }, normalize: Normalize::Zscore },
            output: Output { name: "heatmaps".into(), width: 40, height: 50, stride: 1, heatmap_center: crate::transform::HeatmapCenter::Corner, decode: Decode::Argmax },
            landmark_map, training_note: String::new(), runtime: Runtime::Cpu }
    }
    #[test] fn transposed_heatmaps_map_back_to_film_pixels_and_unmapped_channels_stay_raw() {
        let spec = spec(vec![Some("S".into()), None]);
        let g = crate::transform::Geometry::for_input(400, 500, &spec.input);   // ×10 both ways
        let mut hm = vec![0f32; 2 * 40 * 50];
        hm[10 * 50 + 30] = 1.0;                       // channel 0, stored x-major: x = 10, y = 30
        hm[40 * 50 + 5 * 50 + 7] = 0.5;               // channel 1: x = 5, y = 7
        let (lms, raw) = points_from_heatmaps(&spec, &g, &hm, 400, false);
        assert_eq!(lms.len(), 1);
        assert_eq!((lms[0].id.as_str(), lms[0].x, lms[0].y), ("S", 100.0, 300.0));
        assert_eq!((raw[1].channel, raw[1].x, raw[1].y), (1, 50.0, 70.0));
        assert_eq!((raw[0].landmark_id.as_deref(), raw[1].landmark_id.as_deref()), (Some("S"), None));
        let (_, flipped) = points_from_heatmaps(&spec, &g, &hm, 400, true);   // left-facing: x comes back unflipped
        assert_eq!(flipped[1].x, 399.0 - 50.0);
    }
    /// Task 5: SRPose gets 19 more named channels; naming a previously-null channel must never move an already-named
    /// one's point. Same heatmaps, two specs differing only in whether channel 1 is named.
    #[test] fn naming_extra_channels_leaves_existing_points_bit_identical() {
        let old = spec(vec![Some("S".into()), None]);
        let new = spec(vec![Some("S".into()), Some("D".into())]);
        let g = crate::transform::Geometry::for_input(400, 500, &old.input);
        let mut hm = vec![0f32; 2 * 40 * 50];
        hm[10 * 50 + 30] = 1.0;                       // channel 0, stored x-major: x = 10, y = 30
        hm[40 * 50 + 5 * 50 + 7] = 0.5;               // channel 1: x = 5, y = 7
        let (lms_old, _) = points_from_heatmaps(&old, &g, &hm, 400, false);
        let (lms_new, raw_new) = points_from_heatmaps(&new, &g, &hm, 400, false);
        assert_eq!(lms_old.len(), 1, "old spec names only S");
        assert_eq!(lms_new.len(), 2, "new spec names S and D");
        let (s_old, s_new) = (&lms_old[0], lms_new.iter().find(|l| l.id == "S").unwrap());
        assert_eq!((s_old.x, s_old.y, s_old.peak), (s_new.x, s_new.y, s_new.peak), "S must not move when D is named");
        let (d, raw1) = (lms_new.iter().find(|l| l.id == "D").unwrap(), raw_new.iter().find(|r| r.channel == 1).unwrap());
        assert_eq!((d.x, d.y, d.peak), (raw1.x, raw1.y, raw1.peak), "D is exactly channel 1's existing raw point, now named");
    }
    #[test] fn mean_peak_averages_the_raw_peaks_and_is_zero_without_points() {
        assert!((mean_peak(&det_peaks(&[2.0, 4.0, 9.0])) - 5.0).abs() < 1e-6);
        assert_eq!(mean_peak(&det(&[])), 0.0);
    }
    /// Measured on a public lateral ceph (Radiopaedia) with this model: capped confidence was 1.000 on both passes for
    /// both orientations, so facing always tied and left-facing films were never mirrored. The raw peak separates
    /// them: ≈12.6 on the correctly oriented pass against ≈4.9 on the other.
    #[test] fn facing_uses_the_raw_peak_because_capped_confidence_ties_on_real_films() {
        let (right_pass, left_pass) = (det_peaks(&[4.9, 5.0, 2.9]), det_peaks(&[12.6, 13.2, 6.9]));
        assert!(choose_facing_left(mean_peak(&right_pass), mean_peak(&left_pass)));
        assert!(!choose_facing_left(mean_peak(&left_pass), mean_peak(&right_pass)));
    }
    #[test] fn facing_goes_to_the_more_confident_pass_and_a_tie_stays_right() {
        assert!(choose_facing_left(0.3, 0.6));
        assert!(!choose_facing_left(0.6, 0.3));
        assert!(!choose_facing_left(0.5, 0.5));
    }
    #[test] fn load_gray_windows_16_bit_films_and_converts_colour_ones() {
        let dir = std::env::temp_dir().join(format!("ceph-infer-gray-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let p16 = dir.join("a16.png");
        image::ImageBuffer::<image::Luma<u16>, Vec<u16>>::from_fn(80, 70, |x, _| image::Luma([x as u16 * 800])).save(&p16).unwrap();
        let prgb = dir.join("rgb.png");
        image::RgbImage::from_pixel(90, 64, image::Rgb([10, 200, 30])).save(&prgb).unwrap();
        assert_eq!(load_gray(&p16).unwrap().dimensions(), (80, 70));
        assert_eq!(load_gray(&prgb).unwrap().dimensions(), (90, 64));
        std::fs::remove_dir_all(&dir).ok();
    }
    /// Spec 2026-10-13 §6.1 parity guard: every decoded point (x, y, peak) for every decode, layout and facing, as bit
    /// patterns, recorded BEFORE the spread was added (UPDATE_GOLDEN=1 writes the file; never set it after Task 4 Step 1).
    fn spec_with(layout: crate::spec::Layout, decode: crate::spec::Decode, map: Vec<Option<String>>) -> crate::spec::ModelSpec {
        use crate::spec::*;
        let (w, h) = (40u32, 50u32);
        ModelSpec { manifest_version: 2, id: "g".into(), version: "v".into(), title: String::new(), file: "m".into(), sha256: "s".into(), weights: None,
            input: Input { name: "image".into(), width: w * 4, height: h * 4, channels: 1, layout,
                resize: Resize::Stretch { interp: Interp::PilBicubic, coords: Coords::Corner }, normalize: Normalize::Zscore },
            output: Output { name: "heatmaps".into(), width: w, height: h, stride: 4, heatmap_center: crate::transform::HeatmapCenter::HalfPixel, decode },
            landmark_map: map, training_note: String::new(), runtime: Runtime::Cpu }
    }
    /// A deterministic heat map: per channel, an elliptical Gaussian at a sub-cell centre plus a small negative floor.
    fn golden_heatmaps(rows: usize, cols: usize, n: usize) -> Vec<f32> {
        let mut hm = vec![0f32; n * rows * cols];
        for k in 0..n {
            let (cx, cy) = (8.3 + 9.7 * k as f64, 11.6 + 7.1 * k as f64);
            let (sa, sb, rho) = (1.2 + 0.4 * k as f64, 2.1 - 0.3 * k as f64, 0.35 - 0.3 * k as f64);
            for r in 0..rows { for c in 0..cols {
                let (dx, dy) = ((c as f64 - cx) / sa, (r as f64 - cy) / sb);
                let q = (dx * dx - 2.0 * rho * dx * dy + dy * dy) / (1.0 - rho * rho);
                hm[k * rows * cols + r * cols + c] = ((-0.5 * q).exp() * (3.0 + k as f64) - 0.01) as f32;
            } }
        }
        hm
    }
    fn golden_now() -> serde_json::Value {
        use crate::spec::{Decode, Layout};
        let map = vec![Some("S".to_string()), Some("N".to_string()), None];
        let mut cases = Vec::new();
        for layout in [Layout::Chw, Layout::Cwh] {
            for (dname, decode) in [("softargmax11", Decode::Softargmax { window: 11 }), ("argmax", Decode::Argmax), ("dark11", Decode::Dark { kernel: 11 })] {
                for facing_left in [false, true] {
                    let m = spec_with(layout, decode, map.clone());
                    let (rows, cols) = match layout { Layout::Chw => (50, 40), Layout::Cwh => (40, 50) };
                    let g = crate::transform::Geometry::for_input(800, 1000, &m.input);
                    let (_, raw) = points_from_heatmaps(&m, &g, &golden_heatmaps(rows, cols, map.len()), 800, facing_left);
                    let pts: Vec<serde_json::Value> = raw.iter().map(|p| serde_json::json!([p.channel, format!("{:016x}", p.x.to_bits()), format!("{:016x}", p.y.to_bits()), format!("{:08x}", p.peak.to_bits())])).collect();
                    cases.push(serde_json::json!({ "case": format!("{layout:?}/{dname}/{}", if facing_left { "left" } else { "right" }), "points": pts }));
                }
            }
        }
        serde_json::Value::Array(cases)
    }
    #[test] fn decoded_points_are_bit_identical_to_the_golden_file() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/points-golden.json");
        let now = golden_now();
        if std::env::var("UPDATE_GOLDEN").as_deref() == Ok("1") {
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(&path, serde_json::to_string_pretty(&now).unwrap() + "\n").unwrap();
        }
        let want: serde_json::Value = serde_json::from_slice(&std::fs::read(&path).expect("golden file: run once with UPDATE_GOLDEN=1 BEFORE the spread change")).unwrap();
        assert_eq!(want.as_array().map(|a| a.len()), Some(12), "12 cases: 2 layouts × 3 decodes × 2 facings");
        assert_eq!(now, want, "a decoded point moved (bit-level): the spread must be computed beside the decode, never change it");
    }
    #[test] fn every_channel_carries_its_spread_in_film_pixels_and_a_mirrored_film_flips_it() {
        use crate::spec::{Decode, Layout};
        let m = spec_with(Layout::Chw, Decode::Argmax, vec![Some("S".to_string())]);
        let g = crate::transform::Geometry::for_input(800, 1000, &m.input);    // input 160×200: 5 film px per input px; stride 4 → 20 px per cell
        let mut hm = vec![0f32; 50 * 40];
        for r in 0..50 { for c in 0..40 { let (dx, dy) = (c as f64 - 20.0, r as f64 - 25.0);
            hm[r * 40 + c] = (-0.5 * (dx * dx / 4.0 + dy * dy)).exp() as f32; } }       // σx 2 cells, σy 1 cell
        let (lms, raw) = points_from_heatmaps_with(&m, &g, &hm, 800, false, 15);
        let c = lms[0].cov.unwrap();
        assert!((c[0] / 1600.0 - 1.0).abs() < 0.02 && (c[2] / 400.0 - 1.0).abs() < 0.02 && c[1].abs() < 1e-6, "{c:?}");
        assert_eq!(raw[0].cov, lms[0].cov);
        let (left, _) = points_from_heatmaps_with(&m, &g, &hm, 800, true, 15);
        assert_eq!(left[0].cov.unwrap()[1], -c[1]);
    }
    /// A tilted oval (long along x = y, i.e. down-and-right on the film) through the whole engine, for both layouts,
    /// all three decodes and both facings: the off-diagonal is positive on a right-facing film and negative on a
    /// left-facing one, and the long axis lands on the film axis the layout says (Cwh swaps). Exact values: the stored
    /// covariance [aa, ab, bb] scaled by the cell size in film px (stride / ax, stride / ay), to within 3 %.
    #[test] fn a_tilted_oval_keeps_its_film_orientation_for_every_layout_decode_and_facing() {
        use crate::spec::{Decode, Layout};
        let (aa, ab, bb) = (4.0, 1.5, 1.0);                   // stored cells²: long along the stored column axis, tilted
        for layout in [Layout::Chw, Layout::Cwh] {
            for decode in [Decode::Softargmax { window: 11 }, Decode::Argmax, Decode::Dark { kernel: 11 }] {
                for facing_left in [false, true] {
                    let m = spec_with(layout, decode, vec![Some("S".to_string())]);
                    let g = crate::transform::Geometry::for_input(800, 1000, &m.input);
                    let (rows, cols) = match layout { Layout::Chw => (50usize, 40usize), Layout::Cwh => (40, 50) };
                    let (cx, cy) = (20.0, 20.0);
                    let det = aa * bb - ab * ab;
                    let hm: Vec<f32> = (0..rows * cols).map(|i| { let (x, y) = ((i % cols) as f64 - cx, (i / cols) as f64 - cy);
                        (-0.5 * (bb * x * x - 2.0 * ab * x * y + aa * y * y) / det).exp() as f32 }).collect();
                    let (lms, _) = points_from_heatmaps_with(&m, &g, &hm, 800, facing_left, 15);
                    let c = lms[0].cov.unwrap();
                    let (sx, sy) = (4.0 / g.ax, 4.0 / g.ay);
                    let (xx, yy) = match layout { Layout::Chw => (aa, bb), Layout::Cwh => (bb, aa) };
                    let want = [xx * sx * sx, if facing_left { -ab } else { ab } * sx * sy, yy * sy * sy];
                    let case = format!("{layout:?}/{decode:?}/{}", if facing_left { "left" } else { "right" });
                    for i in 0..3 { assert!((c[i] / want[i] - 1.0).abs() < 0.03, "{case}: {c:?} vs {want:?}"); }
                    assert_eq!(c[1] > 0.0, !facing_left, "{case}: off-diagonal sign");
                }
            }
        }
    }
    /// Standing order 3 edges through the engine: a channel with nothing positive still gives its decoded point (the
    /// same bits as before the spread existed) with no spread; a peak in the corner gives a finite, clipped spread.
    #[test] fn an_empty_channel_keeps_its_point_with_no_spread_and_a_corner_peak_is_clipped() {
        use crate::spec::{Decode, Layout};
        for decode in [Decode::Softargmax { window: 11 }, Decode::Argmax, Decode::Dark { kernel: 11 }] {
            let m = spec_with(Layout::Chw, decode, vec![Some("E".to_string()), Some("C".to_string())]);
            let g = crate::transform::Geometry::for_input(800, 1000, &m.input);
            let mut hm = vec![-0.5f32; 2 * 50 * 40];
            hm[50 * 40] = 2.0; hm[50 * 40 + 1] = 1.0; hm[50 * 40 + 40] = 1.0;     // channel 1: a peak in the top-left corner
            let (lms, raw) = points_from_heatmaps_with(&m, &g, &hm, 800, false, 15);
            let p = match decode { Decode::Dark { kernel } => crate::decode::decode_dark(&hm[..2000], 40, 50, kernel),
                Decode::Softargmax { window } => crate::decode::decode_heatmap(&hm[..2000], 40, 50, window), Decode::Argmax => crate::decode::decode_heatmap(&hm[..2000], 40, 50, 1) };
            let (u, v) = heatmap_to_input(p.x, p.y, 4.0, crate::transform::HeatmapCenter::HalfPixel);
            let (x, y) = g.to_image(u, v);
            assert_eq!((lms[0].x.to_bits(), lms[0].y.to_bits(), lms[0].peak.to_bits()), (x.to_bits(), y.to_bits(), (-0.5f32).to_bits()), "{decode:?}: empty channel still decoded");
            assert_eq!((lms[0].cov, raw[0].cov), (None, None), "{decode:?}: nothing positive, no spread");
            let c = lms[1].cov.expect("corner peak has a spread");
            assert!(c.iter().all(|v| v.is_finite()) && c[0] > 0.0 && c[2] > 0.0, "{decode:?}: {c:?}");
        }
    }
    /// Review I1, through the engine: a wide film into the model's 160 × 200 input (stretch), as cwlachap does with any
    /// film whose shape differs from its input. 800 × 500 film: ax = 160/800 = 0.2, ay = 200/500 = 0.4, so with stride 4
    /// one heat-map cell is 4/0.2 = 20 film px across and 4/0.4 = 10 film px down. Stored cov [aa, ab, bb] = [4, 1.5, 1]
    /// cells² gives, by hand: xx = 4·20² = 1600, xy = 1.5·20·10 = 300, yy = 1·10² = 100 film px² (left-facing: xy = −300).
    /// A swap of the two scales would give [400, 300, 400]; one scale for both, [1600, 600, 400]. Within 3 % (window clip).
    #[test] fn a_film_scaled_differently_across_and_down_gets_each_axis_its_own_scale() {
        use crate::spec::{Decode, Layout};
        let m = spec_with(Layout::Chw, Decode::Argmax, vec![Some("S".to_string())]);
        let g = crate::transform::Geometry::for_input(800, 500, &m.input);
        assert!((g.ax - 0.2).abs() < 1e-12 && (g.ay - 0.4).abs() < 1e-12, "control: ax {} ay {}", g.ax, g.ay);
        let (aa, ab, bb, cx, cy) = (4.0, 1.5, 1.0, 20.0, 25.0);
        let det = aa * bb - ab * ab;
        let hm: Vec<f32> = (0..50 * 40).map(|i| { let (x, y) = ((i % 40) as f64 - cx, (i / 40) as f64 - cy);
            (-0.5 * (bb * x * x - 2.0 * ab * x * y + aa * y * y) / det).exp() as f32 }).collect();
        for (facing_left, want) in [(false, [1600.0, 300.0, 100.0]), (true, [1600.0, -300.0, 100.0])] {
            let (lms, _) = points_from_heatmaps_with(&m, &g, &hm, 800, facing_left, 15);
            let c = lms[0].cov.unwrap();
            for i in 0..3 { assert!((c[i] / want[i] - 1.0).abs() < 0.03, "left {facing_left}: {c:?} vs {want:?}"); }
        }
    }
}
