//! SC-1 Part 1, the region finder (design §4.3, §11;
//! owner ruling OQ-1): an RF-DETR file taught to box five anatomical regions, run through ONNX Runtime on the CPU at
//! full precision (fp32): no Core ML, no CoreML EP, no fp16, whatever CEPHTRACE_PROVIDER says. Manifest kind `regions`
//! at `<models>/regions/manifest.json`, its file's SHA-256 checked at every load. The boxes are in film pixels (the
//! film as stored); the best query per region is returned whatever its score (the score line is the check's).
//!
//! The preprocessing is the app's own: the film stretched to the square input with Pillow's antialiased bilinear resize
//! (`preprocess::pil_resize_bilinear`, bit for bit), the grey film copied to three channels, then (v / 255 - mean_c) /
//! std_c with the manifest's mean and sd (ImageNet's for RF-DETR). **Why Pillow's resize and not the landmark models'
//! cv2-style one (review I1, 3 Nov 2026):** rfdetr teaches, and picks its checkpoint, on antialiased bilinear resizes;
//! a region finder must see what it was taught on, and a film shrunk about 4 times looks different when the resize
//! does not average. The landmark models' preprocessing is untouched. The Python reference of Task 5 reproduces this
//! resize (PIL `Image.resize(.., BILINEAR)`), so the faithfulness check compares this path with PyTorch.
//!
//! Box corners: the model gives (cx, cy, w, h) as fractions of the input; a corner is that fraction times the film's
//! width or height. The model is taught on boxes drawn round the expert points (Task 3's COCO), so its corners are in
//! the pixel-centre convention of those points: a pixel's centre is at its index, and the film's edges are at -0.5 and
//! w - 0.5. A box found on a flipped run therefore maps back to the stored film with x' = (w - 1) - x, with x0 and x1
//! swapped (x0' = (w - 1) - x1, x1' = (w - 1) - x0), as Task 3 mirrors the points; not x' = W - x. ceph-infer does not
//! depend on ceph-model: the bench and the app turn a `Found` into `ceph_model::wholefilm::Regions` (spec §11's
//! `find -> Regions` is split this way).
use crate::engine::{MIN_SIDE, SESSION_START};
use crate::preprocess::pil_resize_bilinear;
use crate::spec::{fingerprint, sha256_file, Runtime};
use anyhow::{bail, ensure, Context};
use ort::{session::Session, value::Tensor};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::{atomic::{AtomicUsize, Ordering}, Mutex};
use std::time::Instant;

pub const KIND: &str = "regions";
/// The five regions in canonical order (ceph_model::wholefilm::Region's order and keys).
pub const REGION_KEYS: [&str; 5] = ["cranial-base", "maxilla", "mandible", "incisors", "soft-tissue"];
pub const MANIFEST_VERSION: u32 = 2;
pub const BOX_FORMAT: &str = "cxcywh-normalised";
pub const SCORE: &str = "sigmoid";

/// `<models>/regions/manifest.json`, built with `join` (no separator in a path string).
pub fn regions_manifest_path(models_dir: &Path) -> PathBuf { models_dir.join("regions").join("manifest.json") }

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionSpec {
    pub manifest_version: u32, pub kind: String, pub id: String, pub version: String, #[serde(default)] pub title: String,
    pub file: String, pub sha256: String, pub input: RegionInput, pub outputs: RegionOutputs, pub classes: Vec<RegionClass>,
    pub runtime: Runtime, #[serde(default)] pub training_note: String,
}
/// The square input (RF-DETR) and the per-channel mean and sd applied after v / 255.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionInput { pub name: String, pub width: u32, pub height: u32, pub mean: [f32; 3], pub std: [f32; 3] }
/// Output names: `boxes` [1, Q, 4] in `boxFormat`, `logits` [1, Q, C] turned into scores by `score`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionOutputs { pub boxes: String, pub logits: String, pub box_format: String, pub score: String }
/// Which logit column is which region. A taught model's columns are 0..4 in the order of its own class names (RF-DETR's
/// loader renumbers COCO ids 1..5 to labels 0..4), with one spare column after them; the manifest records the mapping.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegionClass { pub region: String, pub logit_index: usize }

impl RegionSpec {
    /// Reads and validates a manifest. A manifest of another kind (a landmark model's has no `kind`) is refused naming
    /// `kind` before its other fields are read.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let bytes = std::fs::read(path).with_context(|| format!("the region finder's manifest {} cannot be read", path.display()))?;
        let v: serde_json::Value = serde_json::from_slice(&bytes).with_context(|| format!("{} is not JSON", path.display()))?;
        match v.get("kind") {
            Some(serde_json::Value::String(k)) if k == KIND => {}
            Some(k) => bail!("{}: `kind` is {k}; the region finder's manifest has kind \"{KIND}\"", path.display()),
            None => bail!("{}: no `kind` field: this is a landmark model's manifest, not the region finder's (kind \"{KIND}\")", path.display()),
        }
        let s: Self = serde_json::from_value(v).with_context(|| format!("{}: not a region finder manifest", path.display()))?;
        s.validate().with_context(|| format!("{}", path.display()))?;
        Ok(s)
    }

    /// Each refusal names the field.
    pub fn validate(&self) -> anyhow::Result<()> {
        ensure!(self.manifest_version == MANIFEST_VERSION, "`manifestVersion` is {}; the region finder reads {MANIFEST_VERSION}", self.manifest_version);
        ensure!(self.kind == KIND, "`kind` is {:?}; the region finder's manifest has kind \"{KIND}\"", self.kind);
        ensure!(self.runtime == Runtime::Cpu, "`runtime` is {}: the region finder runs on ONNX Runtime on the CPU at full precision (owner ruling OQ-1); it must be \"cpu\"",
            serde_json::to_string(&self.runtime)?);
        ensure!(self.outputs.box_format == BOX_FORMAT, "`outputs.boxFormat` is {:?}; the region finder reads \"{BOX_FORMAT}\"", self.outputs.box_format);
        ensure!(self.outputs.score == SCORE, "`outputs.score` is {:?}; the region finder reads \"{SCORE}\"", self.outputs.score);
        ensure!(self.input.width == self.input.height && self.input.width > 0,
            "`input.width` {} and `input.height` {}: RF-DETR's input is square (and not empty)", self.input.width, self.input.height);
        for c in &self.classes {
            ensure!(REGION_KEYS.contains(&c.region.as_str()), "`classes`: {:?} is not a region ({REGION_KEYS:?})", c.region);
        }
        for key in REGION_KEYS {
            let n = self.classes.iter().filter(|c| c.region == key).count();
            ensure!(n == 1, "`classes` holds region {key:?} {n} times; each of {REGION_KEYS:?} exactly once");
        }
        let mut idx: Vec<usize> = self.classes.iter().map(|c| c.logit_index).collect();
        idx.sort_unstable();
        ensure!(idx.windows(2).all(|w| w[0] != w[1]), "`classes`: two regions share a `logitIndex` ({idx:?})");
        Ok(())
    }

    /// The ONNX file's SHA-256, lower case: `spec::fingerprint(sha, None)`, as the Python reference (Task 5) writes it.
    pub fn fingerprint(&self) -> String { fingerprint(&self.sha256, None) }

    fn logit_index(&self, key: &str) -> usize {
        self.classes.iter().find(|c| c.region == key).expect("validated: every region has a class").logit_index
    }
}

/// One region's box in film pixels. `region` is the index into REGION_KEYS.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FoundBox { pub region: usize, pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64, pub score: f32 }
/// One film's five boxes (REGION_KEYS order, the best query each whatever its score), the model that found them, the
/// film's size and the time taken (preprocessing, run and decoding).
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Found { pub boxes: Vec<FoundBox>, pub fingerprint: String, pub version: String, pub image_width: u32, pub image_height: u32, pub ms: f64 }

/// The film stretched to the square input with Pillow's antialiased bilinear resize (`pil_resize_bilinear`, bit for
/// bit), grey copied to three channels, (v / 255 - mean_c) / std_c; NCHW.
pub fn input_tensor(img: &image::GrayImage, s: &RegionSpec) -> Vec<f32> {
    let (w, h, n) = (img.width() as usize, img.height() as usize, s.input.width as usize);
    let r = pil_resize_bilinear(img.as_raw(), w, h, n, n);
    let mut t = vec![0f32; 3 * n * n];
    for c in 0..3 { for i in 0..n * n { t[c * n * n + i] = (r[i] as f32 / 255.0 - s.input.mean[c]) / s.input.std[c]; } }
    t
}

/// The best query for each region (the first wins a tie), its box scaled to the film, its score the sigmoid of its logit.
pub fn decode(s: &RegionSpec, dets: &[f32], logits: &[f32], queries: usize, classes: usize, img_w: u32, img_h: u32) -> Vec<FoundBox> {
    REGION_KEYS.iter().enumerate().map(|(r, key)| {
        let li = s.logit_index(key);
        let mut best = 0usize;
        for q in 1..queries { if logits[q * classes + li] > logits[best * classes + li] { best = q; } }   // first wins a tie
        let score = 1.0 / (1.0 + (-logits[best * classes + li]).exp());
        let d = &dets[best * 4..best * 4 + 4];
        let (cx, cy, bw, bh) = (d[0] as f64, d[1] as f64, d[2] as f64, d[3] as f64);
        let (fw, fh) = (img_w as f64, img_h as f64);
        FoundBox { region: r, x0: (cx - bw / 2.0) * fw, y0: (cy - bh / 2.0) * fh, x1: (cx + bw / 2.0) * fw, y1: (cy + bh / 2.0) * fh, score }
    }).collect()
}

/// The region finder: a plain ONNX Runtime CPU session (no execution provider is registered, CEPHTRACE_PROVIDER is not
/// read), its file's SHA-256 checked at load, its output shapes checked by one warm-up run on zeros.
pub struct RegionEngine { session: Mutex<Session>, s: RegionSpec, queries: usize, classes: usize, runs: AtomicUsize }

impl RegionEngine {
    pub fn load(manifest: &Path) -> anyhow::Result<Self> {
        let s = RegionSpec::load(manifest)?;
        let dir = manifest.parent().unwrap_or(Path::new("."));
        let file = dir.join(&s.file);
        let got = sha256_file(&file).with_context(|| format!("the region finder's file {}", file.display()))?;
        ensure!(got.eq_ignore_ascii_case(&s.sha256), "{} has sha256 {got}, the manifest's `sha256` is {}: refusing to load it", file.display(), s.sha256);
        let session = {
            let _one_at_a_time = SESSION_START.lock().unwrap_or_else(|p| p.into_inner());
            Session::builder()?.commit_from_file(&file)?
        };
        let mut e = Self { session: Mutex::new(session), s, queries: 0, classes: 0, runs: AtomicUsize::new(0) };
        let n = e.s.input.width as usize;
        let (q, c, _, _) = e.run(vec![0f32; 3 * n * n])?;
        let need = e.s.classes.iter().map(|c| c.logit_index).max().unwrap_or(0);
        ensure!(c > need, "the region finder gives {c} logits per query, the manifest's `classes` need index {need}; the manifest and model are out of step");
        ensure!(q >= 1, "the region finder gives no queries");
        (e.queries, e.classes) = (q, c);
        Ok(e)
    }
    pub fn spec(&self) -> &RegionSpec { &self.s }
    /// Always "cpu" (OQ-1): no other execution provider is ever built for the region finder.
    pub fn provider(&self) -> &'static str { "cpu" }
    /// How many films this engine has run (`find` calls that reached the model); the bench's cache test counts them.
    pub fn runs(&self) -> usize { self.runs.load(Ordering::SeqCst) }

    /// One run: (Q, C, boxes, logits), the shapes checked as [1, Q, 4] and [1, Q, C] (and against the warm-up's Q, C).
    fn run(&self, data: Vec<f32>) -> anyhow::Result<(usize, usize, Vec<f32>, Vec<f32>)> {
        let n = self.s.input.width as usize;
        let input = Tensor::from_array(([1usize, 3, n, n], data))?;
        let mut sess = self.session.lock().map_err(|_| anyhow::anyhow!("the region finder is unavailable after an earlier failure; reload it"))?;
        let out = sess.run(ort::inputs![self.s.input.name.as_str() => input])?;
        let (bs, boxes) = out[self.s.outputs.boxes.as_str()].try_extract_tensor::<f32>()?;
        let (ls, logits) = out[self.s.outputs.logits.as_str()].try_extract_tensor::<f32>()?;
        ensure!(bs.len() == 3 && bs[0] == 1 && bs[2] == 4 && bs[1] >= 1, "the region finder's `{}` output is {:?}, not [1, Q, 4]", self.s.outputs.boxes, &bs[..]);
        ensure!(ls.len() == 3 && ls[0] == 1 && ls[1] == bs[1], "the region finder's `{}` output is {:?}, not [1, {}, C]", self.s.outputs.logits, &ls[..], bs[1]);
        let (q, c) = (bs[1] as usize, ls[2] as usize);
        ensure!(self.queries == 0 || (q, c) == (self.queries, self.classes), "the region finder's outputs changed shape since load ({q}, {c})");
        Ok((q, c, boxes.to_vec(), logits.to_vec()))
    }

    /// The five boxes for one film, in its own pixels. Refuses a film under MIN_SIDE (64 px) per side; the app's 256 px
    /// rule (MIN_FILM_SIDE) is applied before this is called.
    pub fn find(&self, img: &image::GrayImage) -> anyhow::Result<Found> {
        let t0 = Instant::now();
        let (w, h) = img.dimensions();
        ensure!(w >= MIN_SIDE && h >= MIN_SIDE, "image is {w}×{h} px; the region finder needs at least {MIN_SIDE} px per side");
        let data = input_tensor(img, &self.s);
        self.runs.fetch_add(1, Ordering::SeqCst);
        let (q, c, boxes, logits) = self.run(data)?;
        let found = decode(&self.s, &boxes, &logits, q, c, w, h);
        Ok(Found { boxes: found, fingerprint: self.s.fingerprint(), version: self.s.version.clone(), image_width: w, image_height: h,
            ms: t0.elapsed().as_secs_f64() * 1e3 })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::preprocess::to_tensor;
    use crate::spec::Coords;
    use crate::transform::Geometry;
    use std::path::{Path, PathBuf};

    fn fixture() -> PathBuf { Path::new(env!("CARGO_MANIFEST_DIR")).join("tests").join("fixtures").join("tiny-regions.onnx") }
    const SHA: &str = "3f7b76f846c897e9c43ad88295e04bca25e2d67c1edae4a262dcac00c8cf0a88";
    /// The good manifest for the SYNTHETIC tiny region model, as JSON (each refusal test changes one field of it).
    fn good() -> serde_json::Value {
        serde_json::json!({"manifestVersion": 2, "kind": "regions", "id": "tiny-regions", "version": "synthetic-1",
            "title": "SYNTHETIC tiny region finder", "file": "tiny-regions.onnx", "sha256": SHA,
            "input": {"name": "input", "width": 8, "height": 8, "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
            "outputs": {"boxes": "dets", "logits": "labels", "boxFormat": "cxcywh-normalised", "score": "sigmoid"},
            "classes": [{"region": "cranial-base", "logitIndex": 1}, {"region": "maxilla", "logitIndex": 2},
                        {"region": "mandible", "logitIndex": 3}, {"region": "incisors", "logitIndex": 4},
                        {"region": "soft-tissue", "logitIndex": 5}],
            "runtime": "cpu", "trainingNote": "SYNTHETIC: constants only"})
    }
    /// A temp `<models>/regions/` holding the fixture and this manifest.
    fn placed(m: &serde_json::Value) -> (tempfile::TempDir, PathBuf) {
        let d = tempfile::tempdir().unwrap();
        let p = regions_manifest_path(d.path());
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::copy(fixture(), p.parent().unwrap().join("tiny-regions.onnx")).unwrap();
        std::fs::write(&p, serde_json::to_vec_pretty(m).unwrap()).unwrap();
        (d, p)
    }
    fn spec() -> RegionSpec { serde_json::from_value(good()).unwrap() }
    fn sig(x: f32) -> f32 { 1.0 / (1.0 + (-x).exp()) }
    /// The fixture's constants (tools/sc1/make_tiny_regions.py), Q = 3 queries, C = 6 logits.
    const DETS: [f32; 12] = [0.5, 0.5, 0.2, 0.4, 0.25, 0.75, 0.1, 0.1, 0.8, 0.3, 0.2, 0.2];
    const LOGITS: [f32; 18] = [-9., 3., 2., -9., -9., -9., -9., -1., -9., 4., 1., -9., -9., -9., -9., -9., -9., 0.5];
    fn near(b: &FoundBox, want: [f64; 4]) -> bool {
        [b.x0, b.y0, b.x1, b.y1].iter().zip(want).all(|(g, w)| (g - w).abs() < 1e-3)
    }

    /// Fails if `validate` drops any of its checks (kind, runtime cpu per OQ-1, box format, score, square input, the five
    /// classes once each with distinct logit indexes) or if `deny_unknown_fields` is removed.
    #[test] fn a_regions_manifest_is_read_and_checked() {
        let (_d, p) = placed(&good());
        let s = RegionSpec::load(&p).unwrap();
        assert_eq!(s, spec());
        assert_eq!(regions_manifest_path(Path::new("m")), Path::new("m").join("regions").join("manifest.json"));
        type Edit = fn(&mut serde_json::Value);
        let cases: [(&str, Edit, &str); 9] = [
            ("kind heatmaps", |m| m["kind"] = "heatmaps".into(), "kind"),
            ("runtime coreml-fp32", |m| m["runtime"] = "coreml-fp32".into(), "OQ-1"),
            ("boxFormat xyxy", |m| m["outputs"]["boxFormat"] = "xyxy".into(), "boxFormat"),
            ("score softmax", |m| m["outputs"]["score"] = "softmax".into(), "score"),
            ("width 8 height 16", |m| m["input"]["height"] = 16.into(), "input.height"),
            ("no soft-tissue class", |m| { m["classes"].as_array_mut().unwrap().pop(); }, "soft-tissue"),
            ("two classes share logit 3", |m| m["classes"][3]["logitIndex"] = 3.into(), "logitIndex"),
            ("an unknown field", |m| m["colour"] = "blue".into(), "colour"),
            ("manifestVersion 1", |m| m["manifestVersion"] = 1.into(), "manifestVersion"),
        ];
        for (what, edit, word) in cases {
            let mut m = good();
            edit(&mut m);
            let (_d, p) = placed(&m);
            let e = format!("{:#}", RegionSpec::load(&p).unwrap_err());
            eprintln!("{what}: {e}");
            assert!(e.contains(word), "{what}: {e}");
            if what.starts_with("runtime") { assert!(e.contains("`runtime`"), "{e}"); }
        }
        // Edge cases: no regions folder; a landmark model's manifest (no kind) at the regions path.
        let d = tempfile::tempdir().unwrap();
        let e = format!("{:#}", RegionEngine::load(&regions_manifest_path(d.path())).err().unwrap());
        eprintln!("no regions folder: {e}");
        assert!(e.contains("regions") && e.contains("manifest.json"), "{e}");
        let mut lm = good();
        lm.as_object_mut().unwrap().remove("kind");
        let (_d2, p) = placed(&lm);
        let e = format!("{:#}", RegionSpec::load(&p).unwrap_err());
        eprintln!("a landmark model's manifest (no kind): {e}");
        assert!(e.contains("`kind`"), "{e}");
    }

    /// P16: the fingerprint is `spec::fingerprint(sha, None)`, the ONNX file's SHA-256 in lower case, as the Python side
    /// writes it. Fails if the fingerprint hashes anything else (the id, the version, a second file) or keeps the case.
    #[test] fn the_fingerprint_is_the_onnx_files_sha256() {
        let mut s = spec();
        assert_eq!(s.fingerprint(), crate::spec::fingerprint(SHA, None));
        assert_eq!(s.fingerprint(), SHA);
        assert_eq!(s.fingerprint(), crate::spec::sha256_file(&fixture()).unwrap(), "the fixture's real hash");
        s.sha256 = SHA.to_ascii_uppercase();
        assert_eq!(s.fingerprint(), SHA, "lower case whatever the manifest wrote");
        s.version = "other".into();
        assert_eq!(s.fingerprint(), SHA, "the version is not part of it");
    }

    /// OQ-1. Fails if `RegionEngine::load` honours CEPHTRACE_PROVIDER (builds the CoreML EP for coreml-fp32), or if it
    /// stops checking the file's SHA-256.
    #[test] fn the_region_finder_runs_on_the_cpu_whatever_the_environment_says() {
        let (_d, p) = placed(&good());
        let before = std::env::var_os("CEPHTRACE_PROVIDER");
        std::env::set_var("CEPHTRACE_PROVIDER", "coreml-fp32");
        let got = RegionEngine::load(&p).map(|e| e.provider());
        match before { Some(v) => std::env::set_var("CEPHTRACE_PROVIDER", v), None => std::env::remove_var("CEPHTRACE_PROVIDER") }
        let provider = got.unwrap();
        eprintln!("CEPHTRACE_PROVIDER=coreml-fp32 -> provider {provider}");
        assert_eq!(provider, "cpu");
        let mut m = good();
        m["sha256"] = "0".repeat(64).into();
        let (_d2, p) = placed(&m);
        let e = format!("{:#}", RegionEngine::load(&p).err().unwrap());
        eprintln!("wrong sha256: {e}");
        assert!(e.contains("sha256") && e.contains(SHA), "{e}");
    }

    /// Fix round 1, I-2 (OQ-1 at the source): the region finder's code (this file up to its tests, comments removed)
    /// never builds an execution provider, never names CoreML or CEPHTRACE_PROVIDER, and never uses f16. The CPU test
    /// above only checks the label `provider()` returns; this one fails if `.with_execution_providers(...)` (or any CoreML
    /// or fp16 code) is added to `load`.
    #[test] fn the_region_finder_source_builds_no_execution_provider() {
        let src = include_str!("regions.rs");
        let code: String = src[..src.find("#[cfg(test)]").expect("the tests start here")].lines()
            .map(|l| l.find("//").map_or(l, |i| &l[..i])).collect::<Vec<_>>().join("\n");
        assert!(code.contains("commit_from_file"), "control: the stripped code still holds the session build");
        for bad in ["with_execution_providers", "CoreML", "CEPHTRACE_PROVIDER", "f16"] {
            assert!(!code.contains(bad), "regions.rs code (outside comments) contains {bad:?}: the region finder runs on the plain CPU session at fp32 (OQ-1)");
        }
        assert!(src.contains("CEPHTRACE_PROVIDER"), "control: the words are seen when they are in comments, and are stripped as comments");
    }

    /// Fails if cx and cy (or w and h) are swapped, if the corners are not scaled by the film's width and height, if the
    /// score is not the sigmoid of the chosen logit, if the regions leave REGION_KEYS order, or if a tie picks the last.
    #[test] fn decode_maps_normalised_boxes_to_film_pixels_and_picks_the_best_query() {
        let s = spec();
        let b = decode(&s, &DETS, &LOGITS, 3, 6, 1000, 800);
        eprintln!("decoded on 1000 x 800: {b:?}");
        assert_eq!(b.iter().map(|x| x.region).collect::<Vec<_>>(), [0, 1, 2, 3, 4]);
        assert!(near(&b[0], [400., 240., 600., 560.]), "{:?}", b[0]);
        assert!(near(&b[1], [400., 240., 600., 560.]), "maxilla from query 0 too: {:?}", b[1]);
        assert!(near(&b[2], [200., 560., 300., 640.]), "{:?}", b[2]);
        assert!(near(&b[3], [200., 560., 300., 640.]), "incisors from query 1: {:?}", b[3]);
        assert!(near(&b[4], [700., 160., 900., 320.]), "{:?}", b[4]);
        for (bx, l) in b.iter().zip([3.0f32, 2.0, 4.0, 1.0, 0.5]) { assert_eq!(bx.score, sig(l), "{bx:?}"); }
        // A tie: queries 1 and 2 both give the mandible logit 4; the first (query 1) wins.
        let mut tie = LOGITS;
        tie[2 * 6 + 3] = 4.0;
        assert!(near(&decode(&s, &DETS, &tie, 3, 6, 1000, 800)[2], [200., 560., 300., 640.]), "a tie picks the first query");
        // The logit index comes from the manifest, not the region's position: swap mandible and soft tissue's columns.
        let mut sw = s.clone();
        sw.classes[2].logit_index = 5;
        sw.classes[4].logit_index = 3;
        let b2 = decode(&sw, &DETS, &LOGITS, 3, 6, 1000, 800);
        assert!(near(&b2[2], [700., 160., 900., 320.]) && near(&b2[4], [200., 560., 300., 640.]), "{b2:?}");
    }

    /// P10: a box set flipped left-right (cx' = 1 - cx) decodes to x' = W - x of each corner, exactly, for a film whose
    /// width is not its height. This proves decode's arithmetic only (fractions times the film's width, no offset); it is
    /// not the rule for mapping a flipped run's boxes back to the stored film, which is x' = (w - 1) - x with x0 and x1
    /// swapped (module doc). Fails if decode offsets x (for example by a half pixel) or scales x by the height.
    #[test] fn a_flipped_box_set_decodes_to_the_mirrored_corners() {
        let s = spec();
        // Dyadic constants, so 1 - cx and every product are exact in f32 and f64.
        let dets: [f32; 12] = [0.5, 0.5, 0.25, 0.375, 0.25, 0.75, 0.125, 0.125, 0.8125, 0.3125, 0.25, 0.1875];
        let mut flip = dets;
        for q in 0..3 { flip[q * 4] = 1.0 - dets[q * 4]; }
        let (w, h) = (1024u32, 640u32);
        let (a, b) = (decode(&s, &dets, &LOGITS, 3, 6, w, h), decode(&s, &flip, &LOGITS, 3, 6, w, h));
        for (p, q) in a.iter().zip(&b) {
            eprintln!("{}: x {}..{} -> flipped {}..{}", REGION_KEYS[p.region], p.x0, p.x1, q.x0, q.x1);
            assert_eq!((q.x0, q.x1), (w as f64 - p.x1, w as f64 - p.x0), "x' = W - x");
            assert_eq!((q.y0, q.y1, q.score), (p.y0, p.y1, p.score), "y and score unchanged");
        }
    }

    /// Review I1: RF-DETR is taught and its checkpoint chosen on PIL-antialiased bilinear resizes, so the app resizes the
    /// same way. Fails if `input_tensor` goes back to the non-antialiased half-pixel resize (the old path, built below
    /// with the landmark models' own `to_tensor`, gives a different tensor for a film shrunk this much) or stops being
    /// bit-equal to `pil_resize_bilinear` followed by the manifest's normalisation.
    #[test] fn the_region_input_is_the_antialiased_pil_resize() {
        let (w, h) = (100u32, 80u32);
        let film = image::GrayImage::from_fn(w, h, |x, y| image::Luma([(((x * 37 + y * 91) ^ (x * y)) % 256) as u8]));
        let s = spec();
        let n = s.input.width as usize;
        let got = input_tensor(&film, &s);
        let r = crate::preprocess::pil_resize_bilinear(film.as_raw(), w as usize, h as usize, n, n);
        let mut want = vec![0f32; 3 * n * n];
        for c in 0..3 { for i in 0..n * n { want[c * n * n + i] = (r[i] as f32 / 255.0 - s.input.mean[c]) / s.input.std[c]; } }
        assert_eq!(got, want, "bit-equal to the PIL resize plus normalisation");
        let old = to_tensor(film.as_raw(), w as usize, h as usize, &Geometry::stretch(w, h, n as u32, n as u32, Coords::HalfPixel), n, s.input.mean, s.input.std);
        let worst = got.iter().zip(&old).map(|(a, b)| (a - b).abs()).fold(0f32, f32::max);
        eprintln!("largest difference from the old non-antialiased tensor: {worst}");
        assert!(worst > 0.05, "the control: the old path must give a visibly different tensor ({worst})");
    }

    /// Fails if `find` skips `input_tensor` (feeds zeros or the raw film), if it decodes with the input size instead of
    /// the film's, or if it stops returning the five boxes. The white film's scores cannot fail to move: the tiny model
    /// adds ReduceMean(input) to every logit, about +2.44 for white and -1.99 for black.
    #[test] fn find_feeds_the_film_through_the_app_preprocessing() {
        let (_d, p) = placed(&good());
        let e = RegionEngine::load(&p).unwrap();
        let mut scores = Vec::new();
        for (name, v) in [("black", 0u8), ("white", 255u8)] {
            let film = image::GrayImage::from_pixel(1000, 800, image::Luma([v]));
            let t = input_tensor(&film, e.spec());
            assert_eq!(t.len(), 3 * 8 * 8);
            let m = (t.iter().map(|x| *x as f64).sum::<f64>() / t.len() as f64) as f32;
            let f = e.find(&film).unwrap();
            eprintln!("{name}: mean of the input tensor {m:.4}; scores {:?}; {} ms", f.boxes.iter().map(|b| b.score).collect::<Vec<_>>(), f.ms);
            assert_eq!((f.image_width, f.image_height, f.fingerprint.as_str(), f.version.as_str()), (1000, 800, SHA, "synthetic-1"));
            let d = decode(e.spec(), &DETS, &LOGITS, 3, 6, 1000, 800);
            for (g, w) in f.boxes.iter().zip(&d) {
                assert!(near(g, [w.x0, w.y0, w.x1, w.y1]) && g.region == w.region, "{g:?} vs {w:?}");
            }
            for (g, l) in f.boxes.iter().zip([3.0f32, 2.0, 4.0, 1.0, 0.5]) {
                assert!((g.score - sig(l + m)).abs() < 1e-6, "{name} {}: {} vs {}", REGION_KEYS[g.region], g.score, sig(l + m));
            }
            scores.push(f.boxes.iter().map(|b| b.score).collect::<Vec<_>>());
        }
        assert!(scores[1].iter().zip(&scores[0]).all(|(w, b)| w > b), "the white film raised every score: {scores:?}");
        assert_eq!(e.runs(), 2);
    }

    /// Edge cases: a film under 64 px per side is refused; a large non-square film is resized to the input size and its
    /// boxes come back in its own pixels; a 16-bit film goes through `load_gray`'s window like every model.
    #[test] fn small_large_and_16_bit_films() {
        let (_d, p) = placed(&good());
        let e = RegionEngine::load(&p).unwrap();
        for (w, h) in [(63u32, 800u32), (800, 63)] {
            let err = e.find(&image::GrayImage::new(w, h)).unwrap_err().to_string();
            eprintln!("{w} x {h}: {err}");
            assert!(err.contains("64"), "{err}");
        }
        assert!(e.find(&image::GrayImage::new(64, 64)).is_ok(), "64 px per side is enough for the region finder");
        let big = image::GrayImage::from_fn(4000, 3000, |x, y| image::Luma([((x + y) % 251) as u8]));
        let f = e.find(&big).unwrap();
        eprintln!("SYNTHETIC 4000 x 3000: cranial base {:?} in {:.1} ms", [f.boxes[0].x0, f.boxes[0].y0, f.boxes[0].x1, f.boxes[0].y1], f.ms);
        assert!(near(&f.boxes[0], [1600., 900., 2400., 2100.]), "{:?}", f.boxes[0]);
        let d = tempfile::tempdir().unwrap();
        let p16 = d.path().join("film16.png");
        image::ImageBuffer::<image::Luma<u16>, Vec<u16>>::from_fn(300, 200, |x, _| image::Luma([(x * 200) as u16])).save(&p16).unwrap();
        let g = crate::engine::load_gray(&p16).unwrap();
        let f = e.find(&g).unwrap();
        eprintln!("SYNTHETIC 16-bit 300 x 200: windowed to 8 bits (min {}, max {}); soft tissue {:?}", g.iter().min().unwrap(), g.iter().max().unwrap(), f.boxes[4]);
        assert_eq!((g.iter().min(), g.iter().max()), (Some(&0), Some(&255)), "windowed to the full 8-bit range");
        assert!(near(&f.boxes[4], [210., 40., 270., 80.]), "{:?}", f.boxes[4]);
    }

    /// Ties this crate's resize to the Python reference (Task 5 pins the same numbers in tools/sc1/test_sc1tools.py).
    /// Fails if resize_bilinear stops being cv2's half-pixel bilinear (for example corner-aligned sampling).
    #[test] fn the_resize_matches_the_python_reference_numbers() {
        let r = crate::preprocess::resize_bilinear(&[0, 100, 200, 255], 2, 2, 4, 4);
        eprintln!("rows 0, 1: {:?} {:?}", &r[0..4], &r[4..8]);
        assert_eq!(&r[0..4], &[0.0, 25.0, 75.0, 100.0]);
        assert_eq!(&r[4..8], &[50.0, 72.1875, 116.5625, 138.75]);
    }
}
