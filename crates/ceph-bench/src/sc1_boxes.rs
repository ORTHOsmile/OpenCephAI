//! SC-1 Part 1 (spec §4.2 step 5, §4.3, §10): the bench's region-finder boxes, cached per detector fingerprint, and the
//! faithfulness compare of the app's runtime (ONNX Runtime CPU fp32, `ceph_infer::regions`) against PyTorch CPU fp32.
//! Synthetic fixtures only in tests; the real run is the coordinator's (through `tools/sc1/heavy.sh`).
//!
//! **The box cache** (`boxes_for`): `<cache_root>/<fingerprint>/<dataset>-<split>[-flip].json` (cache_root normally
//! `reports/sc1/boxes`, git-ignored), one entry per film:
//! `{"schema": "sc1-box-cache/1", "fingerprint", "dataset", "split", "flipped", "films": {"<id>": <Found>}}`, where a
//! `Found` is ceph-infer's (`boxes` in REGION_KEYS order with `region`, `x0`, `y0`, `x1`, `y1`, `score`; `fingerprint`,
//! `version`, `imageWidth`, `imageHeight`, `ms`). A flipped entry's boxes are in the mirrored film's pixels (the film
//! as the model saw it). Every call refuses a held-back split (`ledger::refuse_held_back`,
//! `chainproof::refuse_held_back_cache`) before any file is read.
//! The faithfulness compare never reads the app's boxes from this cache: it runs every hold-out film afresh and
//! replaces their entries (so it checks this code path, not an old file).
//!
//! **`pytorch-boxes.json`** (written by Task 5's Python reference, read here; unknown fields refused):
//! ```json
//! {"schema": "sc1-pytorch-boxes/1",
//!  "fingerprint": "<the ONNX file's SHA-256, lower case: RegionSpec::fingerprint()>",
//!  "runtime": "pytorch-cpu-fp32",
//!  "films": {"<film id>": {"imageWidth": 1000, "imageHeight": 800,
//!            "boxes": {"cranial-base": {"x0": 400.0, "y0": 240.0, "x1": 600.0, "y1": 560.0, "score": 0.95},
//!                      "maxilla": {...}, "mandible": {...}, "incisors": {...}, "soft-tissue": {...}}}}}
//! ```
//! One entry per hold-out film, each with all five region keys: the best query per region (whatever its score), its
//! corners in film pixels (the film as stored, not flipped) and its sigmoid score, from the same preprocessing.
//!
//! **`faithfulness.json`** (written here into `--out`, read by Tasks 10 and 11):
//! ```json
//! {"schema": "sc1-faithfulness/1", "fingerprint": "...", "runtime": "onnxruntime-cpu-fp32",
//!  "referenceRuntime": "pytorch-cpu-fp32", "maxPx": 0.5, "expected": 70, "compared": 70, "boxPairs": 350,
//!  "maxCornerPx": 0.00002, "labelAgreement": 70, "maxScoreDiff": 0.000001,
//!  "films": [{"id": "...", "maxCornerPx": 0.00001, "labelsAgree": true, "maxScoreDiff": 0.0000004}],
//!  "verdict": "pass"}
//! ```
//! `maxCornerPx`: the largest |difference| of any corner coordinate (x0, y0, x1, y1) between the two runtimes' boxes
//! for the same region. A region's label disagrees when the app's box for it is not within `maxPx` of PyTorch's box
//! with that label but is within `maxPx` of PyTorch's box for another region (the box was found under another label);
//! two regions sharing one query's box, as RF-DETR can give, is not a disagreement. `labelAgreement` counts the films
//! whose five labels all agree. Verdict `pass` when every corner is within `maxPx` (0.5 px, the owner's S2 rule, inclusive) and
//! every label agrees; otherwise `fail` (exit 3). A reference that cannot be compared (another model's, a count that is
//! not the hold-out's, box pairs compared not five per film, a film of another size, or any corner or score on
//! either side that is not a finite number, named by film and region) is broken: exit 1 and nothing written.
use crate::{chainproof, ledger, scale, sc1_data};
use anyhow::{ensure, Context};
use ceph_infer::engine::load_gray;
use ceph_infer::regions::{regions_manifest_path, Found, RegionEngine, REGION_KEYS};
use ceph_model::wholefilm::{RegionBox, REGIONS};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const CACHE_SCHEMA: &str = "sc1-box-cache/1";
pub const PYTORCH_SCHEMA: &str = "sc1-pytorch-boxes/1";
pub const FAITHFULNESS_SCHEMA: &str = "sc1-faithfulness/1";
pub const PYTORCH_RUNTIME: &str = "pytorch-cpu-fp32";
pub const APP_RUNTIME: &str = "onnxruntime-cpu-fp32";
/// Every corner within 0.5 px (inclusive), the owner's S2 rule for every runtime (spec §4.2 step 5).
pub const FAITHFUL_MAX_PX: f64 = 0.5;

/// A `Found` as `ceph_model` boxes (REGIONS order), for `Regions::from_scored` (the score line is applied there).
pub fn region_boxes(found: &Found) -> Vec<RegionBox> {
    found.boxes.iter().map(|b| RegionBox { region: REGIONS[b.region], x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, score: b.score }).collect()
}

/// One film as the region finder sees it: `<data>/images/<id>.png` through `load_gray` (16-bit windowed), mirrored
/// left-right when `flipped`.
pub fn film(data: &Path, id: &str, flipped: bool) -> anyhow::Result<image::GrayImage> {
    ensure!(!id.is_empty() && !id.contains(['/', '\\']) && id != "." && id != "..", "film id {id:?} is not a plain name");
    let p = data.join("images").join(format!("{id}.png"));
    let mut g = load_gray(&p).with_context(|| format!("the film image {}", p.display()))?;
    if flipped { image::imageops::flip_horizontal_in_place(&mut g); }
    Ok(g)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoxCache { schema: String, fingerprint: String, dataset: String, split: String, flipped: bool, films: BTreeMap<String, Found> }

/// The region finder's boxes for `ids` of `<data>` `split`, from the cache where it has them, run and added otherwise.
pub fn boxes_for(engine: &RegionEngine, data: &Path, split: &str, ids: &[String], cache_root: &Path, flipped: bool) -> anyhow::Result<BTreeMap<String, Found>> {
    boxes_run(engine, data, split, ids, cache_root, flipped, false, None)
}
/// `boxes_for` with the PKU seal's key (SC1-1b-PKU's one run, `ledger::open_seal`): the sealed split passes both gates;
/// held-back splits are still refused. With `None` it is `boxes_for`.
#[allow(clippy::too_many_arguments)]
pub fn boxes_for_unless(engine: &RegionEngine, data: &Path, split: &str, ids: &[String], cache_root: &Path, flipped: bool, key: Option<&ledger::SealKey>) -> anyhow::Result<BTreeMap<String, Found>> {
    boxes_run(engine, data, split, ids, cache_root, flipped, false, key)
}

/// `boxes_for`, or with `fresh` every film of `ids` is run again and its cache entry replaced (the cache is not read).
#[allow(clippy::too_many_arguments)]
fn boxes_run(engine: &RegionEngine, data: &Path, split: &str, ids: &[String], cache_root: &Path, flipped: bool, fresh: bool, key: Option<&ledger::SealKey>) -> anyhow::Result<BTreeMap<String, Found>> {
    ledger::refuse_held_back_unless(data, split, key)?;
    chainproof::refuse_held_back_cache_unless(data, split, key)?;
    sc1_data::ensure_outside_or_ignored(cache_root)?;
    let real = std::fs::canonicalize(data)?;
    let dataset = real.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let split = split.to_lowercase();
    let fp = engine.spec().fingerprint();
    let path = cache_root.join(&fp).join(format!("{dataset}-{split}{}.json", if flipped { "-flip" } else { "" }));
    let mut cache = if path.exists() {
        let c: BoxCache = serde_json::from_str(&std::fs::read_to_string(&path)?).with_context(|| format!("{} is not a box cache", path.display()))?;
        ensure!(c.schema == CACHE_SCHEMA && c.fingerprint == fp && c.dataset == dataset && c.split == split && c.flipped == flipped,
            "{}: its header does not match its place (another model, dataset, split or facing); refusing to use it", path.display());
        c
    } else {
        BoxCache { schema: CACHE_SCHEMA.into(), fingerprint: fp.clone(), dataset, split, flipped, films: BTreeMap::new() }
    };
    let mut added = 0usize;
    let mut failure = None;
    for id in ids {
        if !fresh && cache.films.contains_key(id) { continue; }
        match film(&real, id, flipped).and_then(|g| engine.find(&g)) {
            Ok(f) => { cache.films.insert(id.clone(), f); added += 1; }
            Err(e) => { failure = Some(e); break; }
        }
    }
    if added > 0 {                                                  // keep what ran, even when a later film failed
        std::fs::create_dir_all(path.parent().expect("a cache file has a folder"))?;
        let tmp = path.with_extension("json.part");
        std::fs::write(&tmp, serde_json::to_string(&cache)? + "\n")?;
        std::fs::rename(&tmp, &path)?;
    }
    if let Some(e) = failure { return Err(e); }
    Ok(ids.iter().map(|id| (id.clone(), cache.films[id].clone())).collect())
}

/// One region's box in the PyTorch reference, film pixels.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefBox { pub x0: f64, pub y0: f64, pub x1: f64, pub y1: f64, pub score: f32 }
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RefFilm { pub image_width: u32, pub image_height: u32, pub boxes: BTreeMap<String, RefBox> }
/// `pytorch-boxes.json` (module doc).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PytorchBoxes { pub schema: String, pub fingerprint: String, pub runtime: String, pub films: BTreeMap<String, RefFilm> }

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FilmFaith { pub id: String, pub max_corner_px: f64, pub labels_agree: bool, pub max_score_diff: f64 }
/// `faithfulness.json` (module doc).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Faithfulness {
    pub schema: String, pub fingerprint: String, pub runtime: String, pub reference_runtime: String, pub max_px: f64,
    pub expected: usize, pub compared: usize, pub box_pairs: usize, pub max_corner_px: f64, pub label_agreement: usize, pub max_score_diff: f64,
    pub films: Vec<FilmFaith>, pub verdict: String,
}
impl Faithfulness {
    pub fn passed(&self) -> bool { self.verdict == "pass" }
    /// The printed lines: counts and maxima only (no film id).
    pub fn summary(&self) -> Vec<String> {
        vec![format!("compared {} films (expected {})", self.compared, self.expected),
             format!("compared {} box pairs (expected {})", self.box_pairs, REGION_KEYS.len() * self.expected),
             format!("largest corner difference {:.6} px (rule: every corner within {} px)", self.max_corner_px, self.max_px),
             format!("labels agree on {} of {} films", self.label_agreement, self.compared),
             format!("largest score difference {:.2e}", self.max_score_diff),
             format!("verdict {}", self.verdict)]
    }
}

fn corner_px(a: &ceph_infer::regions::FoundBox, b: &RefBox) -> f64 {
    [(a.x0 - b.x0).abs(), (a.y0 - b.y0).abs(), (a.x1 - b.x1).abs(), (a.y1 - b.y1).abs()].into_iter().fold(0.0, f64::max)
}

/// The compare itself: the hold-out films through the app's region finder, run afresh (M-3: the cache is written, never
/// read here), against the PyTorch reference. An
/// error means the check could not be made (broken).
pub fn faithfulness(aariz: &Path, split: &sc1_data::Split, models: &Path, boxes: &Path, reference: &Path) -> anyhow::Result<Faithfulness> {
    ledger::refuse_held_back(aariz, "train")?;
    ensure!(scale::is_aariz(aariz), "{}: the faithfulness check runs on the Aariz train hold-out, and this folder is not Aariz", aariz.display());
    let engine = RegionEngine::load(&regions_manifest_path(models))?;
    let r: PytorchBoxes = serde_json::from_str(&std::fs::read_to_string(reference).with_context(|| reference.display().to_string())?)
        .with_context(|| format!("{} is not a {PYTORCH_SCHEMA} file", reference.display()))?;
    ensure!(r.schema == PYTORCH_SCHEMA, "the reference's schema is {:?}, this tool reads {PYTORCH_SCHEMA:?}", r.schema);
    ensure!(r.runtime == PYTORCH_RUNTIME, "the reference ran on {:?}; the rule compares with {PYTORCH_RUNTIME:?}", r.runtime);
    let fp = engine.spec().fingerprint();
    ensure!(r.fingerprint.eq_ignore_ascii_case(&fp), "the reference is for model {}, the installed region finder is {fp}: not comparable", r.fingerprint);
    // M-3: the app's boxes are always run afresh here (the cache is written, never read), so this checks the code path.
    let found = boxes_run(&engine, aariz, "train", &split.holdout, boxes, false, true, None)?;
    compare_boxes(&split.holdout, &found, &r, &fp)
}

/// The compare of the app's boxes with the reference for the hold-out films. An error means broken: the films are not
/// the hold-out, a region key is unknown, a film's size differs, any corner or score on either side is not a finite
/// number (named by film and region), or the box pairs compared are not five per hold-out film.
pub fn compare_boxes(holdout: &[String], found: &BTreeMap<String, Found>, r: &PytorchBoxes, fp: &str) -> anyhow::Result<Faithfulness> {
    let expected = holdout.len();
    let common = holdout.iter().filter(|id| r.films.contains_key(*id)).count();
    let extra = r.films.len() - common;
    ensure!(common == expected && extra == 0, "compared {common} films (expected {expected}); the reference has {extra} film(s) outside the hold-out: a count that is not its expected total is refused");
    let missing_app = holdout.iter().filter(|id| !found.contains_key(*id)).count();
    ensure!(missing_app == 0, "{missing_app} hold-out film(s) have no boxes from the app's region finder");
    let unknown = r.films.values().flat_map(|f| f.boxes.keys()).filter(|k| !REGION_KEYS.contains(&k.as_str())).count();
    ensure!(unknown == 0, "the reference names {unknown} region(s) outside {REGION_KEYS:?}");
    let sized = holdout.iter().filter(|id| { let (a, b) = (&found[*id], &r.films[*id]); (a.image_width, a.image_height) != (b.image_width, b.image_height) }).count();
    ensure!(sized == 0, "{sized} reference film(s) are not the size of the film here: not the same films");
    // NaN-aware (I-1): f64::max drops a NaN, so a NaN corner would read as 0 px. Any non-finite value is broken.
    for id in holdout {
        for b in &found[id].boxes {
            let key = REGION_KEYS.get(b.region).copied().unwrap_or("?");
            ensure!([b.x0, b.y0, b.x1, b.y1].iter().all(|v| v.is_finite()) && b.score.is_finite(),
                "film {id}, region {key}: the app's box is not a finite number ({}, {}, {}, {}; score {})", b.x0, b.y0, b.x1, b.y1, b.score);
        }
        for (key, b) in &r.films[id].boxes {
            ensure!([b.x0, b.y0, b.x1, b.y1].iter().all(|v| v.is_finite()) && b.score.is_finite(),
                "film {id}, region {key}: the PyTorch box is not a finite number ({}, {}, {}, {}; score {})", b.x0, b.y0, b.x1, b.y1, b.score);
        }
    }
    let mut films = Vec::new();
    let mut pairs = 0usize;
    for id in holdout {
        let (a, b) = (&found[id], &r.films[id]);
        let mut fx = FilmFaith { id: id.clone(), max_corner_px: 0.0, labels_agree: true, max_score_diff: 0.0 };
        for (ri, key) in REGION_KEYS.iter().enumerate() {
            let (Some(ab), Some(rb)) = (a.boxes.iter().find(|x| x.region == ri), b.boxes.get(*key)) else { continue };
            pairs += 1;
            let d = corner_px(ab, rb);
            fx.max_corner_px = fx.max_corner_px.max(d);
            fx.max_score_diff = fx.max_score_diff.max((ab.score as f64 - rb.score as f64).abs());
            let elsewhere = b.boxes.iter().any(|(k, o)| k != key && corner_px(ab, o) <= FAITHFUL_MAX_PX);
            if d > FAITHFUL_MAX_PX && elsewhere { fx.labels_agree = false; }
        }
        films.push(fx);
    }
    let want = REGION_KEYS.len() * expected;
    ensure!(pairs == want, "compared {pairs} box pairs (expected {want}): a region is missing on one side; a count that is not its expected total is refused");
    let compared = films.len();
    let max_corner_px = films.iter().map(|f| f.max_corner_px).fold(0.0, f64::max);
    let label_agreement = films.iter().filter(|f| f.labels_agree).count();
    let pass = films.iter().all(|f| f.max_corner_px <= FAITHFUL_MAX_PX && f.labels_agree);
    Ok(Faithfulness { schema: FAITHFULNESS_SCHEMA.into(), fingerprint: fp.to_string(), runtime: APP_RUNTIME.into(), reference_runtime: r.runtime.clone(),
        max_px: FAITHFUL_MAX_PX, expected, compared, box_pairs: pairs, max_corner_px, label_agreement,
        max_score_diff: films.iter().map(|f| f.max_score_diff).fold(0.0, f64::max), films,
        verdict: if pass { "pass" } else { "fail" }.into() })
}

/// `--sc1-faithfulness`: runs the compare, writes `<out>/faithfulness.json` and prints the summary. 0 pass, 3 fail,
/// 1 broken (nothing written).
pub fn faithfulness_cli(aariz: &Path, split: &sc1_data::Split, models: &Path, boxes: &Path, reference: &Path, out: &Path) -> anyhow::Result<i32> {
    let rep = match sc1_data::ensure_outside_or_ignored(out).and_then(|_| faithfulness(aariz, split, models, boxes, reference)) {
        Ok(r) => r,
        Err(e) => { eprintln!("faithfulness check broken (nothing written): {e:#}"); return Ok(1); }
    };
    std::fs::create_dir_all(out)?;
    let path: PathBuf = out.join("faithfulness.json");
    std::fs::write(&path, serde_json::to_string_pretty(&rep)? + "\n")?;
    for l in rep.summary() { println!("{l}"); }
    println!("written to {}", path.display());
    Ok(if rep.passed() { 0 } else { 3 })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ft_common;
    use crate::sc1_data::{split, Split};
    use ceph_infer::regions::{regions_manifest_path, RegionClass, RegionInput, RegionOutputs, RegionSpec};

    const W: u32 = 80;
    const H: u32 = 80;
    fn tiny_onnx() -> Vec<u8> {
        let p = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().join("ceph-infer").join("tests").join("fixtures").join("tiny-regions.onnx");
        std::fs::read(p).unwrap()
    }
    /// `<models>/regions/` with the SYNTHETIC tiny region model (or these bytes) and its manifest.
    fn models(root: &Path, onnx: &[u8]) -> PathBuf {
        let m = root.join("models");
        let p = regions_manifest_path(&m);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p.parent().unwrap().join("tiny-regions.onnx"), onnx).unwrap();
        let keys = ceph_infer::regions::REGION_KEYS;
        let s = RegionSpec { manifest_version: 2, kind: "regions".into(), id: "tiny-regions".into(), version: "synthetic-1".into(),
            title: "SYNTHETIC".into(), file: "tiny-regions.onnx".into(), sha256: ft_common::sha256_hex(onnx),
            input: RegionInput { name: "input".into(), width: 8, height: 8, mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225] },
            outputs: RegionOutputs { boxes: "dets".into(), logits: "labels".into(), box_format: "cxcywh-normalised".into(), score: "sigmoid".into() },
            classes: keys.iter().enumerate().map(|(i, k)| RegionClass { region: k.to_string(), logit_index: i + 1 }).collect(),
            runtime: ceph_infer::spec::Runtime::Cpu, training_note: "SYNTHETIC".into() };
        std::fs::write(&p, serde_json::to_vec_pretty(&s).unwrap()).unwrap();
        m
    }
    struct Fx { d: tempfile::TempDir, aariz: PathBuf, split: Split, models: PathBuf, cache: PathBuf }
    /// A SYNTHETIC Aariz folder of 20 train films (80 x 80 grey ramps, no points), its split, the tiny model and a cache
    /// root, all in a temp folder (never data/).
    fn fx(folder: &str) -> Fx {
        let d = tempfile::tempdir().unwrap();
        let aariz = d.path().join(folder);
        std::fs::create_dir_all(aariz.join("images")).unwrap();
        let ids: Vec<String> = (1..=20).map(|i| format!("tr-{i:04}")).collect();
        for (k, id) in ids.iter().enumerate() {
            image::GrayImage::from_fn(W, H, |x, y| image::Luma([((x * 3 + y + k as u32 * 7) % 256) as u8]))
                .save(aariz.join("images").join(format!("{id}.png"))).unwrap();
        }
        let models = models(d.path(), &tiny_onnx());
        let cache = d.path().join("boxes");
        Fx { split: split(&ids).unwrap(), aariz, models, cache, d }
    }
    fn engine(f: &Fx) -> RegionEngine { RegionEngine::load(&regions_manifest_path(&f.models)).unwrap() }
    /// The reference a faithful PyTorch run would write: the tiny engine's own boxes for the hold-out films.
    fn reference_of(f: &Fx) -> PytorchBoxes {
        let e = engine(f);
        let films = f.split.holdout.iter().map(|id| {
            let found = e.find(&film(&f.aariz, id, false).unwrap()).unwrap();
            (id.clone(), RefFilm { image_width: found.image_width, image_height: found.image_height,
                boxes: found.boxes.iter().map(|b| (REGION_KEYS[b.region].to_string(), RefBox { x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, score: b.score })).collect() })
        }).collect();
        PytorchBoxes { schema: PYTORCH_SCHEMA.into(), fingerprint: e.spec().fingerprint(), runtime: PYTORCH_RUNTIME.into(), films }
    }
    fn write_ref(f: &Fx, r: &PytorchBoxes) -> PathBuf {
        let p = f.d.path().join("pytorch-boxes.json");
        std::fs::write(&p, serde_json::to_string_pretty(r).unwrap()).unwrap();
        p
    }
    fn faith(f: &Fx, r: &PytorchBoxes) -> (i32, PathBuf) {
        let out = f.d.path().join("faith");
        let code = faithfulness_cli(&f.aariz, &f.split, &f.models, &f.cache, &write_ref(f, r), &out).unwrap();
        (code, out.join("faithfulness.json"))
    }

    /// The bench and ceph-infer agree on the five regions' order and keys. Fails if either list is reordered or renamed,
    /// or if `region_boxes` maps a box to the wrong region.
    #[test] fn the_region_keys_are_the_models_regions() {
        assert_eq!(REGION_KEYS.to_vec(), REGIONS.iter().map(|r| r.key()).collect::<Vec<_>>());
        let f = fx("aariz");
        let found = engine(&f).find(&film(&f.aariz, &f.split.holdout[0], false).unwrap()).unwrap();
        let rb = region_boxes(&found);
        assert_eq!(rb.iter().map(|b| b.region).collect::<Vec<_>>(), REGIONS.to_vec());
        assert_eq!((rb[4].x0, rb[4].score), (found.boxes[4].x0, found.boxes[4].score));
    }

    /// C5. Fails if `boxes_for` stops calling `ledger::refuse_held_back` (the link case: only it resolves the link to the
    /// held-back folder) or both held-back gates, or if it reads or writes anything before refusing.
    #[test] fn boxes_for_refuses_held_back_splits_before_any_file_is_read() {
        let f = fx("aariz");
        let e = engine(&f);
        let c4 = f.d.path().join("ceph400");
        std::fs::create_dir_all(&c4).unwrap();
        let link = f.d.path().join("public-films");
        std::os::unix::fs::symlink(&f.aariz, &link).unwrap();
        for (data, sp) in [(&c4, "test2"), (&f.aariz, "test"), (&f.aariz, "all"), (&link, "test")] {
            let err = boxes_for(&e, data, sp, &f.split.holdout, &f.cache, false).unwrap_err().to_string();
            eprintln!("{} {sp}: {err}", data.file_name().unwrap().to_string_lossy());
            assert!(err.contains("held back"), "{err}");
        }
        assert_eq!(e.runs(), 0, "no film was run");
        assert!(!f.cache.exists(), "nothing was written");
        assert!(boxes_for(&e, &f.aariz, "train", &f.split.holdout, &f.cache, false).is_ok(), "control: train is not held back");
    }

    /// SC-1 Part 1b Task A (C5, M23). Fails if `boxes_for` lets the sealed PKU folder through (neither gate consults
    /// `ledger::SEALED`), or reads or writes anything first.
    #[test] fn boxes_for_refuses_pku_before_any_read() {
        let f = fx("aariz");
        let e = engine(&f);
        let pku = f.d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        for sp in ["test", "all"] {
            let err = boxes_for(&e, &pku, sp, &f.split.holdout, &f.cache, false).unwrap_err().to_string();
            eprintln!("boxes_for pku {sp}: {err}");
            assert!(err.contains("sealed"), "{err}");
        }
        assert_eq!(e.runs(), 0, "no film was run");
        assert!(!f.cache.exists(), "no cache file made");
    }

    /// Fails if the cache is not read (a second call runs the model again), if it is not keyed by the fingerprint (a new
    /// model is served the old boxes), or if a cached film's image is read again.
    #[test] fn boxes_are_cached_per_detector_fingerprint() {
        let f = fx("aariz");
        let e = engine(&f);
        let ids = &f.split.holdout;
        let first = boxes_for(&e, &f.aariz, "train", ids, &f.cache, false).unwrap();
        let file = f.cache.join(e.spec().fingerprint()).join("aariz-train.json");
        eprintln!("first call: {} runs; cache {}", e.runs(), file.strip_prefix(f.d.path()).unwrap().display());
        assert_eq!((e.runs(), first.len()), (ids.len(), ids.len()));
        assert!(file.exists());
        for id in ids { std::fs::remove_file(f.aariz.join("images").join(format!("{id}.png"))).unwrap(); }
        let second = boxes_for(&e, &f.aariz, "train", ids, &f.cache, false).unwrap();
        eprintln!("second call, images removed: {} runs in all", e.runs());
        assert_eq!(e.runs(), ids.len(), "the second call ran nothing");
        // JSON text keeps a float to its last digit or so (serde_json without exact round trip): compare to 1e-9 px, and
        // not the time taken.
        for (id, a) in &first {
            let b = &second[id];
            assert_eq!((a.boxes.len(), &a.fingerprint, a.image_width), (b.boxes.len(), &b.fingerprint, b.image_width));
            for (p, q) in a.boxes.iter().zip(&b.boxes) {
                assert!(p.region == q.region && p.score == q.score && [p.x0 - q.x0, p.y0 - q.y0, p.x1 - q.x1, p.y1 - q.y1].iter().all(|d| d.abs() < 1e-9), "{p:?} vs {q:?}");
            }
        }
        // Another model (the same network with a doc string appended: another file, another SHA-256) runs again.
        let mut other = tiny_onnx();
        other.extend_from_slice(&[0x32, 5, b'o', b't', b'h', b'e', b'r']);                // ModelProto.doc_string
        let m2 = models(&f.d.path().join("second"), &other);
        let e2 = RegionEngine::load(&regions_manifest_path(&m2)).unwrap();
        assert_ne!(e2.spec().fingerprint(), e.spec().fingerprint());
        let err = boxes_for(&e2, &f.aariz, "train", ids, &f.cache, false).unwrap_err().to_string();
        eprintln!("new fingerprint, images gone: {err}");
        assert!(err.contains("the film image"), "a new fingerprint is not served the old boxes: it goes to the film ({err})");
        for id in ids { image::GrayImage::new(W, H).save(f.aariz.join("images").join(format!("{id}.png"))).unwrap(); }
        assert_eq!(boxes_for(&e2, &f.aariz, "train", ids, &f.cache, false).unwrap().len(), ids.len());
        eprintln!("new fingerprint, images back: {} runs", e2.runs());
        assert_eq!(e2.runs(), ids.len(), "a new fingerprint runs the model on every film");
        assert!(f.cache.join(e2.spec().fingerprint()).join("aariz-train.json").exists());
        assert!(f.cache.join(e.spec().fingerprint()).join("aariz-train.json").exists(), "the first model's cache is kept");
    }

    /// Fails if a flipped film is not mirrored before the model sees it, or if its boxes share the unflipped cache.
    #[test] fn a_flipped_film_runs_mirrored_and_is_cached_separately() {
        let f = fx("aariz");
        let id = &f.split.holdout[0];
        let (a, b) = (film(&f.aariz, id, false).unwrap(), film(&f.aariz, id, true).unwrap());
        assert_eq!(b.get_pixel(0, 5), a.get_pixel(W - 1, 5));
        assert_ne!(a.get_pixel(0, 5), a.get_pixel(W - 1, 5), "control: the film is not symmetric");
        assert_eq!(b, image::imageops::flip_horizontal(&a));
        let e = engine(&f);
        boxes_for(&e, &f.aariz, "train", &f.split.holdout, &f.cache, false).unwrap();
        let flipped = boxes_for(&e, &f.aariz, "train", &f.split.holdout, &f.cache, true).unwrap();
        let dir = f.cache.join(e.spec().fingerprint());
        let mut names: Vec<String> = std::fs::read_dir(&dir).unwrap().map(|x| x.unwrap().file_name().to_string_lossy().into()).collect();
        names.sort();
        eprintln!("flipped: {} runs (2 plain + 2 mirrored); cache files {names:?}; soft tissue x {:.1}..{:.1}", e.runs(), flipped[id].boxes[4].x0, flipped[id].boxes[4].x1);
        assert_eq!(e.runs(), 2 * f.split.holdout.len(), "the mirrored films ran; they were not served the plain ones");
        assert_eq!(names, ["aariz-train-flip.json", "aariz-train.json"]);
    }

    /// P15: the two files' schemas. Fails if a field is renamed or dropped (each side reads the other's file with
    /// deny_unknown_fields), or if the written text does not read back as the same values.
    #[test] fn the_pytorch_and_faithfulness_schemas_round_trip() {
        let text = r#"{"schema": "sc1-pytorch-boxes/1", "fingerprint": "ab12", "runtime": "pytorch-cpu-fp32",
            "films": {"tr-0001": {"imageWidth": 1000, "imageHeight": 800, "boxes": {
              "cranial-base": {"x0": 400.0, "y0": 240.0, "x1": 600.0, "y1": 560.0, "score": 0.95},
              "maxilla": {"x0": 1.0, "y0": 2.0, "x1": 3.0, "y1": 4.0, "score": 0.5},
              "mandible": {"x0": 1.0, "y0": 2.0, "x1": 3.0, "y1": 4.0, "score": 0.5},
              "incisors": {"x0": 1.0, "y0": 2.0, "x1": 3.0, "y1": 4.0, "score": 0.5},
              "soft-tissue": {"x0": 1.0, "y0": 2.0, "x1": 3.0, "y1": 4.0, "score": 0.5}}}}}"#;
        let p: PytorchBoxes = serde_json::from_str(text).unwrap();
        assert_eq!(p.films["tr-0001"].boxes["cranial-base"].x1, 600.0);
        assert_eq!(serde_json::from_str::<PytorchBoxes>(&serde_json::to_string(&p).unwrap()).unwrap(), p);
        assert!(serde_json::from_str::<PytorchBoxes>(&text.replace("\"imageWidth\"", "\"width\"")).is_err(), "a renamed field is refused");
        let fr = Faithfulness { schema: FAITHFULNESS_SCHEMA.into(), fingerprint: "ab12".into(), runtime: APP_RUNTIME.into(),
            reference_runtime: PYTORCH_RUNTIME.into(), max_px: FAITHFUL_MAX_PX, expected: 1, compared: 1, box_pairs: 5, max_corner_px: 0.25,
            label_agreement: 1, max_score_diff: 1e-6, films: vec![FilmFaith { id: "tr-0001".into(), max_corner_px: 0.25, labels_agree: true, max_score_diff: 1e-6 }],
            verdict: "pass".into() };
        let t = serde_json::to_string_pretty(&fr).unwrap();
        eprintln!("faithfulness.json:\n{t}");
        for k in ["\"boxPairs\"", "\"compared\"", "\"expected\"", "\"maxCornerPx\"", "\"labelAgreement\"", "\"labelsAgree\"", "\"verdict\"", "\"fingerprint\""] { assert!(t.contains(k), "{k}"); }
        assert_eq!(serde_json::from_str::<Faithfulness>(&t).unwrap(), fr);
    }

    /// Fix round 1, I-1: a NaN or infinite corner or score on either side is broken (exit 1), named by film and region;
    /// never a pass. Fails if the compare folds a NaN away (f64::max drops NaN, so a NaN corner read as 0 px) or skips
    /// the reference side.
    #[test] fn a_non_finite_box_on_either_side_is_broken() {
        let f = fx("aariz");
        let good = reference_of(&f);
        let e = engine(&f);
        let found: BTreeMap<String, Found> = f.split.holdout.iter().map(|id| (id.clone(), e.find(&film(&f.aariz, id, false).unwrap()).unwrap())).collect();
        let fp = e.spec().fingerprint();
        assert!(compare_boxes(&f.split.holdout, &found, &good, &fp).unwrap().passed(), "control: the clean sets pass");
        let id = f.split.holdout[1].clone();
        type AppEdit = fn(&mut ceph_infer::regions::FoundBox);
        let app: [(&str, AppEdit); 3] = [("x1 NaN", |b| b.x1 = f64::NAN), ("y0 infinite", |b| b.y0 = f64::INFINITY), ("score NaN", |b| b.score = f32::NAN)];
        for (what, edit) in app {
            let mut bad = found.clone();
            edit(&mut bad.get_mut(&id).unwrap().boxes[2]);
            let err = compare_boxes(&f.split.holdout, &bad, &good, &fp).map(|r| r.verdict).unwrap_err().to_string();
            eprintln!("app side, mandible {what}: {err}");
            assert!(err.contains(&id) && err.contains("mandible") && err.contains("not a finite number"), "{err}");
        }
        type RefEdit = fn(&mut RefBox);
        let refs: [(&str, RefEdit); 2] = [("x0 NaN", |b| b.x0 = f64::NAN), ("score NaN", |b| b.score = f32::NAN)];
        for (what, edit) in refs {
            let mut bad = good.clone();
            edit(bad.films.get_mut(&id).unwrap().boxes.get_mut("incisors").unwrap());
            let err = compare_boxes(&f.split.holdout, &found, &bad, &fp).map(|r| r.verdict).unwrap_err().to_string();
            eprintln!("PyTorch side, incisors {what}: {err}");
            assert!(err.contains(&id) && err.contains("incisors") && err.contains("not a finite number"), "{err}");
        }
        // Through the file and the exit code: Python's json writes NaN as a bare NaN, which is broken (exit 1).
        let text = serde_json::to_string_pretty(&good).unwrap();
        let k = text.find("\"x0\"").unwrap();
        let v = k + text[k..].find(':').unwrap() + 1;
        let end = v + text[v..].find(',').unwrap();
        let nan = format!("{} NaN{}", &text[..v], &text[end..]);
        let p = f.d.path().join("nan-boxes.json");
        std::fs::write(&p, nan).unwrap();
        let code = faithfulness_cli(&f.aariz, &f.split, &f.models, &f.cache, &p, &f.d.path().join("faith-nan")).unwrap();
        eprintln!("a NaN in pytorch-boxes.json: exit {code}");
        assert_eq!(code, 1);
    }

    /// Fix round 1, M-3: the compare always runs the app's region finder afresh; it never takes the app's boxes from the
    /// cache (so it checks this code path, not an old file). Fails if `faithfulness` reads the cache.
    #[test] fn the_faithfulness_compare_ignores_a_stale_cache() {
        let f = fx("aariz");
        let good = reference_of(&f);
        assert_eq!(faith(&f, &good).0, 0);
        let e = engine(&f);
        let file = f.cache.join(e.spec().fingerprint()).join("aariz-train.json");
        let id = f.split.holdout[0].clone();
        let mut c: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        let x0 = c["films"][&id]["boxes"][2]["x0"].as_f64().unwrap();
        c["films"][&id]["boxes"][2]["x0"] = (x0 + 5.0).into();                          // a stale, planted box
        std::fs::write(&file, serde_json::to_string(&c).unwrap()).unwrap();
        let served = boxes_for(&e, &f.aariz, "train", &f.split.holdout, &f.cache, false).unwrap();
        assert!((served[&id].boxes[2].x0 - (x0 + 5.0)).abs() < 1e-9, "control: boxes_for serves the planted entry");
        let (code, out) = faith(&f, &good);
        let rep: Faithfulness = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        eprintln!("stale cache entry planted (+5 px): exit {code}; {}", rep.summary().join(" | "));
        assert_eq!(code, 0, "the planted entry was not used");
        let c: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&file).unwrap()).unwrap();
        assert!((c["films"][&id]["boxes"][2]["x0"].as_f64().unwrap() - x0).abs() < 1e-9, "the fresh boxes replaced the stale entry");
    }

    /// Fails if the compare passes a box 0.6 px out, if a swapped label passes, if a short reference (one film fewer)
    /// or another model's reference is compared at all, or if the count is not checked against the hold-out.
    #[test] fn the_faithfulness_compare_passes_fails_and_refuses() {
        let f = fx("aariz");
        let good = reference_of(&f);
        let (code, out) = faith(&f, &good);
        let rep: Faithfulness = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        eprintln!("faithful reference: exit {code}; {}", rep.summary().join(" | "));
        assert_eq!(code, 0);
        assert!(rep.summary()[0] == format!("compared {} films (expected {})", f.split.holdout.len(), f.split.holdout.len()));
        assert_eq!((rep.compared, rep.expected, rep.label_agreement, rep.verdict.as_str()), (2, 2, 2, "pass"));
        assert!(rep.max_corner_px < 1e-9);
        let id = f.split.holdout[1].clone();
        let mut near = good.clone();
        near.films.get_mut(&id).unwrap().boxes.get_mut("mandible").unwrap().x1 += 0.49;
        let (code, _) = faith(&f, &near);
        eprintln!("one corner 0.49 px out: exit {code}");
        assert_eq!(code, 0);
        let mut moved = good.clone();
        moved.films.get_mut(&id).unwrap().boxes.get_mut("mandible").unwrap().x1 += 0.6;
        let (code, out) = faith(&f, &moved);
        let rep: Faithfulness = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        eprintln!("one corner 0.6 px out: exit {code}; {}", rep.summary().join(" | "));
        assert_eq!((code, rep.verdict.as_str()), (3, "fail"));
        assert!((rep.max_corner_px - 0.6).abs() < 1e-9, "{}", rep.max_corner_px);
        let mut swapped = good.clone();
        let b = &mut swapped.films.get_mut(&id).unwrap().boxes;
        let (m, s) = (b["mandible"].clone(), b["soft-tissue"].clone());
        b.insert("mandible".into(), s);
        b.insert("soft-tissue".into(), m);
        let (code, out) = faith(&f, &swapped);
        let rep: Faithfulness = serde_json::from_str(&std::fs::read_to_string(&out).unwrap()).unwrap();
        eprintln!("mandible and soft tissue labels swapped: exit {code}; {}", rep.summary().join(" | "));
        assert_eq!((code, rep.label_agreement), (3, 1));
        // Broken: a count that is not its expected total, another model, a missing region. Nothing is written.
        let mut short = good.clone();
        short.films.remove(&id);
        let mut other = good.clone();
        other.fingerprint = "0".repeat(64);
        let mut four = good.clone();
        four.films.get_mut(&id).unwrap().boxes.remove("incisors");
        let err = faithfulness(&f.aariz, &f.split, &f.models, &f.cache, &write_ref(&f, &four)).unwrap_err().to_string();
        eprintln!("a film with four regions, the message: {err}");
        assert!(err.contains("compared 9 box pairs (expected 10)"), "the box-pair count refuses it: {err}");
        for (what, r) in [("one film fewer", short), ("another model's reference", other), ("a film with four regions", four)] {
            std::fs::remove_dir_all(f.d.path().join("faith")).ok();
            let (code, out) = faith(&f, &r);
            eprintln!("{what}: exit {code}");
            assert_eq!(code, 1, "{what}");
            assert!(!out.exists(), "{what}: nothing written");
        }
        let err = faithfulness(&f.aariz, &f.split, &f.models, &f.cache, &write_ref(&f, &{ let mut s = good.clone(); s.films.remove(&id); s })).unwrap_err().to_string();
        eprintln!("one film fewer, the message: {err}");
        assert!(err.contains("compared 1 films (expected 2)"), "{err}");
        // The compare reads Aariz train only: a folder that does not resolve, or is not Aariz, is refused before any read.
        let gone = f.d.path().join("no-such").join("aariz");
        let err = faithfulness(&gone, &f.split, &f.models, &f.cache, &write_ref(&f, &good)).unwrap_err().to_string();
        eprintln!("unresolvable folder: {err}");
        assert!(err.contains("cannot find the data folder"), "{err}");
        let c4 = f.d.path().join("ceph400");
        std::fs::create_dir_all(&c4).unwrap();
        let err = faithfulness(&c4, &f.split, &f.models, &f.cache, &write_ref(&f, &good)).unwrap_err().to_string();
        eprintln!("a Ceph-400 folder: {err}");
        assert!(err.contains("Aariz"), "{err}");
    }
}
