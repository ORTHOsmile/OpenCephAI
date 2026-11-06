//! ceph-bench: MRE/SDR on Ceph-Biometrics-400 through the exact `ceph-infer` pipeline the app ships.
pub mod chainproof;
pub mod dataset;
pub mod diag;
pub mod ft2;
pub mod ft2b;
pub mod ft_common;
pub mod ledger;
pub mod linalg;
pub mod metrics;
pub mod parity;
pub mod passrule;
pub mod pku;
pub mod pointcheck;
pub mod report;
pub mod runs;
pub mod sc1_1a;
pub mod sc1_1b_pku;
pub mod sc1_boxes;
pub mod sc1_calib;
pub mod sc1_data;
pub mod sc1_gate;
pub mod sc1_gate2;
pub mod sc1_probe;
pub mod sc1_reference;
pub mod sc1_size;
pub mod sc1_cb;
pub mod sc1_dev;
pub mod sc1_wf3;
pub mod scale;
pub mod shape;
pub mod shape_prior;
pub mod source;
pub mod stage_a_accept;
#[cfg(test)] mod stage_a_faces;
pub mod stats;
pub mod tune;
pub mod xcache;
pub mod xeval;

use ceph_infer::engine::{load_gray, Engine};
use report::{Provenance, Report};
use std::{collections::BTreeMap, path::{Path, PathBuf}};

pub const THRESHOLDS_MM: [f64; 4] = [2.0, 2.5, 3.0, 4.0];
pub const MM_PER_PX: f64 = 0.1;                              // Ceph-Biometrics-400 / ISBI 2015 pixel spacing
pub const PARITY_MAX_PX: f64 = 0.5;

pub struct BenchConfig { pub data: PathBuf, pub split: String, pub manifest: PathBuf, pub out: PathBuf, pub parity: Option<PathBuf> }

/// Scores the points a film's model found against the points the dataset's ground truth has for that film,
/// at the film's own pixel spacing. A found point the ground truth lacks is skipped (counted, never an error) —
/// this lets a model with more points than the dataset run against it instead of failing with "missing from gt".
pub fn score_film(found: &[(String, f64, f64)], truth: &[(String, f64, f64)], mm_per_px: f64) -> (Vec<(String, f64)>, Vec<String>) {
    let mut scored = Vec::new();
    let mut skipped = Vec::new();
    for (id, x, y) in found {
        match truth.iter().find(|(n, _, _)| n == id) {
            Some((_, gx, gy)) => scored.push((id.clone(), metrics::radial_error_mm((*x, *y), (*gx, *gy), mm_per_px))),
            None => skipped.push(id.clone()),
        }
    }
    (scored, skipped)
}

/// The pixel spacing for one film: its own row in `spacing.csv` when that map is in play (erroring by name if the
/// film has no row), otherwise the fixed Ceph-400 `MM_PER_PX`.
pub fn spacing_for(spacing: &Option<std::collections::HashMap<String, f64>>, iid: &str) -> anyhow::Result<f64> {
    match spacing {
        Some(m) => m.get(iid).copied().ok_or_else(|| anyhow::anyhow!("no spacing.csv row for {iid}")),
        None => Ok(MM_PER_PX),
    }
}

/// A film's mean error across only its scorable points (those the dataset has ground truth for); `None` when
/// the model found nothing the dataset could score, so `run` never divides zero error-sum by zero count.
fn per_image_mre(img_err: &[f64]) -> Option<f64> {
    if img_err.is_empty() { None } else { Some(img_err.iter().sum::<f64>() / img_err.len() as f64) }
}

/// Provenance for a report: git state (via `git`, "unknown" outside a checkout), the dataset revision from
/// `<data>/provenance.json` (written by prepare_ceph400.py; "unknown" if absent), model sha, OS and chip.
pub fn provenance(data: &Path, model_sha256: &str) -> Provenance {
    let git = |args: &[&str]| std::process::Command::new("git").args(args).output().ok()
        .filter(|o| o.status.success()).map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string());
    let dataset_revision = std::fs::read(data.join("provenance.json")).ok()
        .and_then(|b| serde_json::from_slice::<serde_json::Value>(&b).ok())
        .and_then(|v| v.get("revision").and_then(|r| r.as_str()).map(String::from));
    Provenance {
        git_sha: git(&["rev-parse", "--short=12", "HEAD"]).unwrap_or_else(|| "unknown".into()),
        git_dirty: git(&["status", "--porcelain", "--untracked-files=no"]).is_some_and(|s| !s.is_empty()),
        dataset_revision: dataset_revision.unwrap_or_else(|| "unknown".into()),
        model_sha256: model_sha256.into(),
        os: std::env::consts::OS.into(),
        arch: std::env::consts::ARCH.into(),
        generated_unix: std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0),
    }
}

/// How an Aariz report describes its pixel spacing.
pub const AARIZ_SPACING: &str = "per film, aariz-scale/1 (spacing.csv for ART Plus and ProMax; header_resolution.csv for Hyperion X5 and Rotograph EVO; Smart3D and Veraviewepocs excluded)";

/// The films a scoring mode runs on, each with its mm per pixel. Aariz (by folder name): rule `aariz-scale/1`, which
/// needs spacing.csv and header_resolution.csv and returns its counts. Any other dataset: every selected film at its
/// spacing.csv row, or the fixed Ceph-400 spacing, exactly as before task 2b.
pub fn films_to_score(data: &Path, ids: &[String], gt: &dataset::Points) -> anyhow::Result<(Vec<(String, f64)>, Option<scale::ScaleCounts>)> {
    let spacing_path = data.join("spacing.csv");
    let spacing = spacing_path.exists().then(|| dataset::load_spacing(&spacing_path)).transpose()?;
    if scale::is_aariz(data) {
        let sp = spacing.as_ref().ok_or_else(|| anyhow::anyhow!("{} is missing: an Aariz run needs it", spacing_path.display()))?;
        let p = scale::plan(ids, sp, &scale::load_header_resolution(data)?, gt)?;
        return Ok((p.films, Some(p.counts)));
    }
    Ok((ids.iter().map(|iid| Ok((iid.clone(), spacing_for(&spacing, iid)?))).collect::<anyhow::Result<_>>()?, None))
}

/// Runs the benchmark, writes predictions.csv / metrics.json / report.md to `cfg.out`, and returns the report.
/// `progress(done, total)` is called after each image (the Tauri command reuses this in Week 4).
pub fn run(cfg: &BenchConfig, progress: impl Fn(usize, usize)) -> anyhow::Result<Report> {
    let gt = dataset::load_points(&cfg.data.join("gt.csv"))?;
    let splits = dataset::load_splits(&cfg.data.join("splits.json"))?;
    let ids = dataset::select(&splits, &cfg.split)?;
    let split_of = |iid: &str| splits.iter().find(|(_, v)| v.iter().any(|x| x == iid)).map(|(k, _)| k.clone()).unwrap_or_default();
    let (films, aariz_scale) = films_to_score(&cfg.data, &ids, &gt)?;      // before the model loads: a refusal costs nothing
    let report_spacing = if aariz_scale.is_some() { AARIZ_SPACING.to_string() }
        else if cfg.data.join("spacing.csv").exists() { "per film, spacing.csv".to_string() } else { "0.1 mm/px fixed (Ceph-400)".to_string() };
    let engine = Engine::load(&cfg.manifest)?;

    let (mut all, mut per_lm, mut per_split) = (Vec::new(), BTreeMap::<String, Vec<f64>>::new(), BTreeMap::<String, Vec<f64>>::new());
    let (mut per_image, mut predictions, mut ms, mut rust_pts) = (Vec::new(), Vec::new(), 0.0, dataset::Points::new());
    let mut not_in_dataset = BTreeMap::<String, usize>::new();
    let mut point_bits = Vec::new();
    let mut provider = String::new();
    for (k, (iid, mm_per_px)) in films.iter().enumerate() {
        let mm_per_px = *mm_per_px;
        let d = engine.detect_path(&cfg.data.join("images").join(format!("{iid}.png")), false)?;
        provider = d.execution_provider.clone(); ms += d.timings_ms.inference;
        let truth = gt.get(iid).ok_or_else(|| anyhow::anyhow!("no ground truth for {iid}"))?;
        let found: Vec<(String, f64, f64)> = d.landmarks.iter().map(|l| (l.id.clone(), l.x, l.y)).collect();
        let (scored, skipped) = score_film(&found, truth, mm_per_px);
        for id in &skipped { *not_in_dataset.entry(id.clone()).or_default() += 1; }
        let mut img_err = Vec::new();
        for (id, e) in &scored {
            all.push(*e); img_err.push(*e);
            per_lm.entry(id.clone()).or_default().push(*e);
            per_split.entry(split_of(iid)).or_default().push(*e);
        }
        for l in &d.landmarks {
            predictions.push((iid.clone(), l.id.clone(), l.x, l.y, l.confidence));
            point_bits.push((iid.clone(), l.id.clone(), l.x.to_bits(), l.y.to_bits(), l.peak.to_bits()));
            rust_pts.entry(iid.clone()).or_default().push((l.id.clone(), l.x, l.y));
        }
        if let Some(mre) = per_image_mre(&img_err) { per_image.push((iid.clone(), mre)); }
        progress(k + 1, films.len());
    }
    per_image.sort_by(|a, b| b.1.total_cmp(&a.1));
    let parity = cfg.parity.as_ref().map(|p| parity::parity(&rust_pts, &dataset::load_points(p)?)).transpose()?;
    let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(&cfg.manifest)?)?;
    let r = Report {
        overall: metrics::summarize(&all, &THRESHOLDS_MM),
        per_landmark: per_lm.iter().map(|(k, v)| (k.clone(), metrics::summarize(v, &THRESHOLDS_MM))).collect(),
        per_split: per_split.iter().map(|(k, v)| (k.clone(), metrics::summarize(v, &THRESHOLDS_MM))).collect(),
        worst10: per_image.into_iter().take(10).collect(),
        leakage_note: manifest.get("trainingNote").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        provenance: provenance(&cfg.data, engine.manifest().sha256.as_str()),
        not_in_dataset, spacing: report_spacing, aariz_scale,
        manifest, provider, mean_inference_ms: ms / films.len().max(1) as f64, parity, predictions, point_bits,
    };
    report::write(&cfg.out, &r)?;
    Ok(r)
}

/// `--diag-facing`: every film run as-is and mirrored (the app's `detect(img, true)`, points mapped back), plus the
/// app's automatic choice. Returns per-film errors IN MEMORY ONLY; the caller prints aggregates (`print_diag_facing`).
/// `flip_control`: mirror each film and its truth first (positive control: every film then faces the other way).
pub fn run_diag_facing(cfg: &BenchConfig, flip_control: bool, pad: f64, reframe: bool, progress: impl Fn(usize, usize)) -> anyhow::Result<Vec<diag::FilmDiag>> {
    let gt = dataset::load_points(&cfg.data.join("gt.csv"))?;
    let splits = dataset::load_splits(&cfg.data.join("splits.json"))?;
    let ids = dataset::select(&splits, &cfg.split)?;
    let (scored, counts) = films_to_score(&cfg.data, &ids, &gt)?;
    if let Some(c) = &counts { println!("{}", report::scale_line(c)); }
    let engine = Engine::load(&cfg.manifest)?;
    let mut films = Vec::with_capacity(scored.len());
    for (k, (iid, film_mm)) in scored.iter().enumerate() {
        let path = cfg.data.join("images").join(format!("{iid}.png"));
        let sixteen_bit = matches!(image::ImageReader::open(&path)?.with_guessed_format()?.decode()?.color(), image::ColorType::L16 | image::ColorType::La16);
        let mut img = load_gray(&path)?;
        let mut truth = gt.get(iid).ok_or_else(|| anyhow::anyhow!("a film has no ground truth"))?.clone();
        if flip_control { image::imageops::flip_horizontal_in_place(&mut img); truth = diag::mirror_truth(&truth, img.width()); }
        if pad != 1.0 { (img, truth) = diag::pad_film(&img, &truth, pad); }
        let mut mm_per_px = *film_mm;
        if reframe {
            let (i, t, m) = diag::reframe(&img, &truth, mm_per_px, &diag::ISBI).ok_or_else(|| anyhow::anyhow!("a film has no S or N in its ground truth"))?;
            (img, truth, mm_per_px) = (i, t, m);
        }
        let pts = |d: &ceph_infer::engine::Detection| d.landmarks.iter().map(|l| (l.id.clone(), l.x, l.y)).collect::<Vec<_>>();
        let (r, l) = (engine.detect(&img, false)?, engine.detect(&img, true)?);
        let auto_left = ceph_infer::engine::choose_facing_left(ceph_infer::engine::mean_peak(&r), ceph_infer::engine::mean_peak(&l));
        films.push(diag::FilmDiag { width: img.width(), height: img.height(), mm_per_px, auto_left, grey: diag::grey_stats(&img), sixteen_bit,
            sn_mm: diag::truth_distance_mm(&truth, "S", "N", mm_per_px),
            s_frac: truth.iter().find(|(id, _, _)| id == "S").map(|(_, x, y)| (x / img.width() as f64, y / img.height() as f64)),
            as_is: score_film(&pts(&r), &truth, mm_per_px).0, mirrored: score_film(&pts(&l), &truth, mm_per_px).0 });
        progress(k + 1, scored.len());
    }
    Ok(films)
}

/// Aggregates only: the facing summary, per-landmark MRE as-is vs the better pass, and buckets (≥ `MIN_BUCKET` films)
/// by aspect, width, height and spacing. No film id, file name or per-film row is printed.
pub fn print_diag_facing(id: &str, films: &[diag::FilmDiag]) {
    let s = diag::summarize_facing(films);
    println!("{id}: films {} · mirrored better by >{} mm: {} · as-is better by >{} mm: {}", s.n, diag::BIG_MM, s.mirrored_better_big, diag::BIG_MM, s.as_is_better_big);
    println!("  MRE as-is {:.3} · mirrored {:.3} · better pass per film {:.3} · app's automatic facing {:.3} mm", s.mre_as_is, s.mre_mirrored, s.mre_best, s.mre_auto);
    println!("  app auto-facing ran {} of {} films mirrored · on the {} decisive films it picked the better pass {} times",
        s.auto_left, s.n, s.decisive, s.auto_right_on_decisive);
    println!("  per-film MRE as-is p50 {:.2} p90 {:.2} · better pass p50 {:.2} p90 {:.2} mm", s.film_as_is_p50, s.film_as_is_p90, s.film_best_p50, s.film_best_p90);
    println!("  films with as-is MRE >{} mm: {} · of which the better pass is <5 mm: {}", diag::BIG_MM, s.as_is_over_big, s.of_which_best_under_5);
    print!("  per point (as-is → better pass):");
    for (lm, a, b) in diag::per_landmark(films) { print!(" {lm} {a:.1}→{b:.1}"); }
    println!();
    let ranges = |name: &str, v: Vec<f64>| println!("  {name}: min {:.3} p50 {:.3} max {:.3}", diag::percentile(&v, 0.0), diag::percentile(&v, 50.0), diag::percentile(&v, 100.0));
    ranges("aspect w/h", films.iter().map(|f| f.width as f64 / f.height as f64).collect());
    ranges("width px", films.iter().map(|f| f.width as f64).collect());
    ranges("height px", films.iter().map(|f| f.height as f64).collect());
    ranges("mm/px", films.iter().map(|f| f.mm_per_px).collect());
    ranges("film width mm", films.iter().map(|f| f.width as f64 * f.mm_per_px).collect());
    ranges("film height mm", films.iter().map(|f| f.height as f64 * f.mm_per_px).collect());
    let sn: Vec<f64> = films.iter().filter_map(|f| f.sn_mm).collect();
    println!("  ground-truth S–N mm at the film's spacing ({} films): p10 {:.1} p50 {:.1} p90 {:.1} · under 50 mm: {} · over 95 mm: {}",
        sn.len(), diag::percentile(&sn, 10.0), diag::percentile(&sn, 50.0), diag::percentile(&sn, 90.0),
        sn.iter().filter(|v| **v < 50.0).count(), sn.iter().filter(|v| **v > 95.0).count());
    ranges("S–N ÷ film width", films.iter().filter_map(|f| f.sn_mm.map(|d| d / (f.width as f64 * f.mm_per_px))).collect());
    ranges("S x ÷ film width", films.iter().filter_map(|f| f.s_frac.map(|p| p.0)).collect());
    ranges("S y ÷ film height", films.iter().filter_map(|f| f.s_frac.map(|p| p.1)).collect());
    ranges("grey mean", films.iter().map(|f| f.grey.mean).collect());
    ranges("grey sd", films.iter().map(|f| f.grey.sd).collect());
    ranges("grey border mean", films.iter().map(|f| f.grey.border_mean).collect());
    let show = |name: &str, b: Vec<diag::Bucket>| {
        println!("  by {name}:");
        for x in b {
            match (x.mre_as_is, x.mre_best, x.mirrored_better_big) {
                (Some(a), Some(c), Some(m)) => println!("    [{:.3}, {:.3}) n {:3} · MRE as-is {a:.2} · better pass {c:.2} · mirrored better >10 mm {m}", x.lo, x.hi, x.n),
                _ => println!("    [{:.3}, {:.3}) n {:3} · (fewer than {} films: not shown)", x.lo, x.hi, x.n, diag::MIN_BUCKET),
            }
        }
    };
    show("aspect w/h", diag::buckets(films, |f| f.width as f64 / f.height as f64, &[0.8, 0.9, 1.0, 1.1, 1.25]));
    show("width px", diag::buckets(films, |f| f.width as f64, &[1000.0, 1500.0, 2000.0, 2500.0]));
    show("height px", diag::buckets(films, |f| f.height as f64, &[1000.0, 1500.0, 2000.0, 2500.0]));
    show("mm/px", diag::buckets(films, |f| f.mm_per_px, &[0.08, 0.1, 0.12, 0.14]));
    show("film width mm (ISBI 193.5)", diag::buckets(films, |f| f.width as f64 * f.mm_per_px, &[100.0, 150.0, 180.0, 210.0, 250.0]));
    show("ground-truth S–N mm", diag::buckets(films, |f| f.sn_mm.unwrap_or(f64::NAN), &[50.0, 60.0, 70.0, 80.0, 95.0]));
    show("head size in frame: ground-truth S–N ÷ film width (spacing-free)",
        diag::buckets(films, |f| f.sn_mm.map(|d| d / (f.width as f64 * f.mm_per_px)).unwrap_or(f64::NAN), &[0.25, 0.3, 0.35, 0.4, 0.45]));
    show("16-bit file (0 no, 1 yes)", diag::buckets(films, |f| f.sixteen_bit as u8 as f64, &[0.5]));
    show("grey mean", diag::buckets(films, |f| f.grey.mean, &[60.0, 80.0, 100.0, 120.0, 140.0]));
    show("grey sd", diag::buckets(films, |f| f.grey.sd, &[40.0, 50.0, 60.0, 70.0, 80.0]));
    show("grey border mean", diag::buckets(films, |f| f.grey.border_mean, &[20.0, 50.0, 100.0, 150.0]));
    show("film height mm (ISBI 240)", diag::buckets(films, |f| f.height as f64 * f.mm_per_px, &[100.0, 150.0, 180.0, 210.0, 250.0]));
}

/// `--scale-check`: no model. The pixel scale each film of the selection gets, and the ground-truth S–N it gives.
#[derive(Clone, Debug)]
pub struct ScaleCheck {
    pub films: usize,
    /// Aariz only: the rule's counts.
    pub counts: Option<scale::ScaleCounts>,
    /// Ground-truth S–N (mm) of every film that is scored, at the scale it is scored at (None: no S or N).
    pub sn_used_mm: Vec<Option<f64>>,
    /// Ground-truth S–N (mm) of every film at the dataset's own spacing (spacing.csv, or 0.1 fixed): the as-is control.
    pub sn_as_is_mm: Vec<Option<f64>>,
}

pub fn scale_check(data: &Path, split: &str) -> anyhow::Result<ScaleCheck> {
    let gt = dataset::load_points(&data.join("gt.csv"))?;
    let ids = dataset::select(&dataset::load_splits(&data.join("splits.json"))?, split)?;
    let spacing_path = data.join("spacing.csv");
    let spacing = spacing_path.exists().then(|| dataset::load_spacing(&spacing_path)).transpose()?;
    let sn = |iid: &str, mm: f64| gt.get(iid).and_then(|t| diag::truth_distance_mm(t, "S", "N", mm));
    let sn_as_is_mm = ids.iter().map(|iid| Ok(sn(iid, spacing_for(&spacing, iid)?))).collect::<anyhow::Result<Vec<_>>>()?;
    let (films, counts) = films_to_score(data, &ids, &gt)?;
    Ok(ScaleCheck { films: ids.len(), counts, sn_used_mm: films.iter().map(|(iid, mm)| sn(iid, *mm)).collect(), sn_as_is_mm })
}

/// Aggregates only: counts, and the S–N spread of the scored films and of every film as-is. No film id.
pub fn print_scale_check(name: &str, c: &ScaleCheck) {
    let line = |label: &str, v: &[Option<f64>]| {
        let x: Vec<f64> = v.iter().flatten().copied().collect();
        let inside = |lo: f64, hi: f64| x.iter().filter(|d| (lo..=hi).contains(*d)).count();
        println!("  {label}: films {} · with S and N {} · p10 {:.1} p50 {:.1} p90 {:.1} mm · in 55–85 mm {}/{} ({:.1}%) · under {} mm {} · over {} mm {} · flagged {}",
            v.len(), x.len(), diag::percentile(&x, 10.0), diag::percentile(&x, 50.0), diag::percentile(&x, 90.0),
            inside(55.0, 85.0), x.len(), 100.0 * inside(55.0, 85.0) as f64 / x.len().max(1) as f64,
            scale::SN_RANGE_MM.0, x.iter().filter(|d| **d < scale::SN_RANGE_MM.0).count(),
            scale::SN_RANGE_MM.1, x.iter().filter(|d| **d > scale::SN_RANGE_MM.1).count(),
            v.iter().filter(|d| scale::flagged(**d)).count());
    };
    println!("{name}: films {}", c.films);
    if let Some(k) = &c.counts { println!("  {}", report::scale_line(k)); } else { println!("  no Aariz scale rule (not the Aariz folder)"); }
    line("S–N of scored films, at the scale they are scored at", &c.sn_used_mm);
    line("S–N of every film at the dataset's own spacing (as-is control)", &c.sn_as_is_mm);
}

/// `--orient` (Week 3 exit criterion): each film as-is must be called facing right and mirrored facing left, and the
/// mirrored film's points, mapped back, must equal the as-is points (the flip is exact, so any difference is a bug).
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrientReport { pub n: usize, pub right_correct: usize, pub left_correct: usize, pub max_mirror_diff_px: f64, pub wrong: Vec<String>, pub mean_auto_ms: f64 }
impl OrientReport {
    pub fn passes(&self) -> bool { self.right_correct == self.n && self.left_correct == self.n && self.max_mirror_diff_px < 1e-6 }
}

pub fn run_orient(cfg: &BenchConfig, progress: impl Fn(usize, usize)) -> anyhow::Result<OrientReport> {
    let engine = Engine::load(&cfg.manifest)?;
    let splits = dataset::load_splits(&cfg.data.join("splits.json"))?;
    let ids = dataset::select(&splits, &cfg.split)?;
    let mut r = OrientReport { n: ids.len(), right_correct: 0, left_correct: 0, max_mirror_diff_px: 0.0, wrong: vec![], mean_auto_ms: 0.0 };
    for (k, iid) in ids.iter().enumerate() {
        let img = load_gray(&cfg.data.join("images").join(format!("{iid}.png")))?;
        let mirrored = image::imageops::flip_horizontal(&img);
        let t = std::time::Instant::now();
        let (a, b) = (engine.detect_auto(&img)?, engine.detect_auto(&mirrored)?);
        r.mean_auto_ms += t.elapsed().as_secs_f64() * 1e3 / 2.0;
        if a.facing_left { r.wrong.push(format!("{iid} (as-is read as left)")) } else { r.right_correct += 1 }
        if b.facing_left { r.left_correct += 1 } else { r.wrong.push(format!("{iid} (mirrored read as right)")) }
        if !a.facing_left && b.facing_left {
            let w = (img.width() - 1) as f64;
            for (p, q) in a.detection.landmarks.iter().zip(&b.detection.landmarks) {
                r.max_mirror_diff_px = r.max_mirror_diff_px.max((w - p.x - q.x).abs()).max((p.y - q.y).abs());
            }
        }
        progress(k + 1, ids.len());
    }
    r.mean_auto_ms /= ids.len().max(1) as f64;
    std::fs::create_dir_all(&cfg.out)?;
    std::fs::write(cfg.out.join("orient.json"), serde_json::to_vec_pretty(&r)?)?;
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn provenance_reads_dataset_revision_and_git_state() {
        let dir = std::env::temp_dir().join(format!("ceph-bench-prov-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("provenance.json"), r#"{"repo": "YongchengYAO/Ceph-Biometrics-400", "revision": "fc579ac"}"#).unwrap();
        let p = provenance(&dir, "16f2");
        assert_eq!((p.dataset_revision.as_str(), p.model_sha256.as_str()), ("fc579ac", "16f2"));
        assert_eq!((p.os.as_str(), p.arch.as_str()), (std::env::consts::OS, std::env::consts::ARCH));
        assert!(p.git_sha.len() >= 7 && p.generated_unix > 0);      // tests run inside the repo
        std::fs::remove_dir_all(&dir).ok();
        assert_eq!(provenance(&dir, "x").dataset_revision, "unknown");   // missing file is reported, not invented
    }
    #[test] fn scoring_skips_points_the_dataset_lacks_and_counts_them() {
        let truth = vec![("S".to_string(), 10.0, 10.0)];
        let found = vec![("S".to_string(), 13.0, 14.0), ("U1A".to_string(), 1.0, 1.0)];
        let (scored, skipped) = score_film(&found, &truth, 0.2);
        assert_eq!(scored, vec![("S".to_string(), 1.0)]);              // 5 px x 0.2 mm/px
        assert_eq!(skipped, vec!["U1A".to_string()]);
    }
    #[test] fn scoring_uses_the_films_own_spacing() {
        let truth = vec![("S".to_string(), 0.0, 0.0)];
        let found = vec![("S".to_string(), 3.0, 4.0)];
        assert_eq!(score_film(&found, &truth, 0.1).0[0].1, 0.5);
        assert_eq!(score_film(&found, &truth, 0.127).0[0].1, 5.0 * 0.127);
    }
    #[test] fn spacing_for_uses_fixed_value_when_no_spacing_csv() {
        assert_eq!(spacing_for(&None, "001").unwrap(), MM_PER_PX);
    }
    #[test] fn spacing_for_errors_by_name_when_film_has_no_row() {
        let m: std::collections::HashMap<String, f64> = [("x1".to_string(), 0.1)].into();
        assert_eq!(spacing_for(&Some(m.clone()), "x1").unwrap(), 0.1);
        let err = spacing_for(&Some(m), "missing-film").unwrap_err();
        assert!(err.to_string().contains("missing-film"), "error should name the film: {err}");
    }
    #[test] fn per_image_mre_is_none_for_a_film_with_no_scorable_points() {
        assert_eq!(per_image_mre(&[]), None);                  // no NaN from an empty-sum / zero-count division
        assert_eq!(per_image_mre(&[1.0, 3.0]), Some(2.0));
    }
    /// A SYNTHETIC Aariz-shaped dataset: one film per machine group, S–N given in pixels. No images (none are opened).
    fn synthetic(folder: &str, with_header: bool) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let root = d.path().join(folder);
        std::fs::create_dir_all(&root).unwrap();
        let films = [("a1", "ART Plus", 0.1, "", "no resolution in header", 700.0),
                     ("h1", "Hyperion X5", 0.089, "0.250000", "real", 280.0),
                     ("h2", "Hyperion X5", 0.089, "", "default resolution", 280.0),
                     ("r1", "Rotograph EVO", 0.135, "0.169333", "real", 880.0),
                     ("s1", "Smart3D", 0.1, "", "no resolution in header", 280.0)];
        let mut gt = String::from("image_id,landmark,x,y\n");
        let mut sp = String::from("image_id,mm_per_px\n");
        let mut hr = String::from("image_id,machine,format,raw_x,raw_y,units,mm_per_px,reason\n");
        for (id, m, csv, mm, why, sn) in films {
            gt += &format!("{id},S,100,100\n{id},N,{},100\n", 100.0 + sn);
            sp += &format!("{id},{csv}\n");
            hr += &format!("{id},{m},bmp,1,1,px/m,{mm},{why}\n");
        }
        std::fs::write(root.join("gt.csv"), gt).unwrap();
        std::fs::write(root.join("spacing.csv"), sp).unwrap();
        if with_header { std::fs::write(root.join("header_resolution.csv"), hr).unwrap(); }
        std::fs::write(root.join("splits.json"), r#"{"valid":["a1","h1","h2","r1","s1"]}"#).unwrap();
        d
    }
    #[test] fn an_aariz_run_without_header_resolution_csv_is_refused_before_any_model_loads() {
        let d = synthetic("aariz", false);
        let cfg = BenchConfig { data: d.path().join("aariz"), split: "valid".into(), manifest: d.path().join("no-model/manifest.json"),
                                out: d.path().join("out"), parity: None };
        let e = format!("{:#}", run(&cfg, |_, _| {}).unwrap_err());
        assert!(e.contains("header_resolution.csv"), "{e}");
        assert!(!d.path().join("out").exists(), "nothing written");
        let e = format!("{:#}", run_diag_facing(&cfg, false, 1.0, false, |_, _| {}).unwrap_err());
        assert!(e.contains("header_resolution.csv"), "diag-facing too: {e}");
    }
    #[test] fn scale_check_applies_the_rule_on_aariz_and_keeps_the_as_is_control() {
        let d = synthetic("aariz", true);
        let c = scale_check(&d.path().join("aariz"), "valid").unwrap();
        let k = c.counts.as_ref().expect("Aariz carries the rule's counts");
        assert_eq!((c.films, k.used, k.excluded, k.flagged), (5, 3, 2, 1));
        let used: Vec<f64> = c.sn_used_mm.iter().map(|v| (v.unwrap() * 10.0).round() / 10.0).collect();
        assert_eq!(used, vec![70.0, 70.0, 149.0]);                        // ART at the CSV, Hyperion at its header, Rotograph flagged
        let as_is: Vec<f64> = c.sn_as_is_mm.iter().map(|v| (v.unwrap() * 10.0).round() / 10.0).collect();
        assert_eq!(as_is, vec![70.0, 24.9, 24.9, 118.8, 28.0]);           // every film at the dataset's own spacing
    }
    #[test] fn scale_check_on_a_folder_that_is_not_aariz_uses_its_spacing_and_no_rule() {
        let d = synthetic("ceph400", false);
        std::fs::remove_file(d.path().join("ceph400/spacing.csv")).unwrap();   // Ceph-400 has none: 0.1 fixed
        let c = scale_check(&d.path().join("ceph400"), "valid").unwrap();
        assert!(c.counts.is_none());
        assert_eq!(c.sn_used_mm, c.sn_as_is_mm);
        assert_eq!((c.sn_used_mm[0].unwrap() * 10.0).round() / 10.0, 70.0);
    }
    #[test] fn orient_report_passes_only_when_every_film_is_called_right() {
        let ok = OrientReport { n: 2, right_correct: 2, left_correct: 2, max_mirror_diff_px: 0.0, wrong: vec![], mean_auto_ms: 1.0 };
        assert!(ok.passes());
        assert!(!OrientReport { left_correct: 1, wrong: vec!["002 (mirrored read as right)".into()], ..ok.clone() }.passes());
        assert!(!OrientReport { max_mirror_diff_px: 0.5, ..ok }.passes());
    }
}
