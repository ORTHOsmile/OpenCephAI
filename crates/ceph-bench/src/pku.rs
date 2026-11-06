//! `ceph-bench --pku-prepare <raw>` (SC-1 Part 1b Task A; spec 2026-11-03 §17.7, controls C5 and C12): the PKU
//! cephalogram set (Zeng et al.; Figshare 13265471 v6) made into a bench folder beside its download, `data/pku/`:
//! `images/pku001.png` … (8-bit grey, the BMP's pixels unchanged), `gt.csv` (the mean of the two doctors, rule
//! `pku-truth/1`), `gt-doctor1.csv`, `gt-doctor2.csv`, `splits.json` (`{"test": [...]}`), `spacing.csv` (0.125 each) and
//! `provenance.json` (the SHA-256 of every raw file).
//!
//! The doctor files carry no point names; the ISBI 2015 order is assumed and checked on every film by anatomy that
//! cannot be otherwise, plus Part 1's facing guard and every point on the film. The scale (0.125 mm/px, owner ruling of 5 Nov 2026, from a secondary
//! source) is checked by C12: PKU's median S–N must lie within 15% of Ceph-400 Train's. Any failure stops the loader,
//! naming rules and counts only.
//!
//! PKU is SEALED (`ledger::SEALED`): every other mode refuses the folder. This loader makes it and runs no check, no
//! region finder and no shape look; its S–N median is the only number it reads off the truth.

use anyhow::{ensure, Context};
use std::collections::BTreeMap;
use std::path::Path;

pub const PKU_FILMS: usize = 102;
pub const PKU_SPLIT: &str = "test";
/// Owner P1 ruling, 5 Nov 2026 ("0.125 mm, cited"; spec §17.13): Self-CephaloNet (arXiv 2501.10984, 2025) gives PKU as
/// 2089 x 1937 px at about 0.125 mm/px. It replaces 0.096 (CL-Detection 2023 paper, arXiv 2409.15834, Table I), at
/// which C12 read 0.8063, outside ±0.15. The dataset's readme gives none.
pub const PKU_MM_PER_PX: f64 = 0.125;
pub const PKU_SCALE_SOURCE: &str = "Self-CephaloNet, arXiv 2501.10984 (2025): PKU cephalogram dataset, 2089 x 1937 px, about 0.125 mm per pixel \
    (owner ruling 5 Nov 2026; replaces 0.096 from Wang et al., arXiv 2409.15834, Table I, at which C12 read 0.8063)";
/// Width x height as published; either way round is accepted.
pub const PKU_SIZE: (u32, u32) = (2089, 1937);
/// The widths a PKU film may have, height `PKU_SIZE.1`, either way round. Owner P1 ruling, 5 Nov 2026 ("Accept 2089 or
/// 2090"): 12 of the 102 films are 2090 px wide. Any other size is refused.
pub const PKU_WIDTHS: &[u32] = &[2089, 2090];
/// The loader's rule version (scale, sizes and checks), written into provenance.json. /1 (0.096 mm/px, width 2089 only)
/// stopped at P1 on 5 Nov 2026 and wrote nothing; /2 is the owner's two rulings of that day.
pub const PREPARE_RULE: &str = "pku-prepare/2";
/// The truth: the mean of doctor1 and doctor2.
pub const TRUTH_RULE: &str = "pku-truth/1";
pub const ISBI_ORDER: [&str; 19] = ["S", "N", "Or", "Po", "A", "B", "Pog", "Me", "Gn", "Go", "L1T", "U1T", "UL", "LL", "Sn", "PogS", "PNS", "ANS", "Ar"];
/// C12: |median S–N (PKU, mm) / median S–N (Ceph-400 Train, mm) − 1| ≤ 0.15.
pub const SN_TOLERANCE: f64 = 0.15;
/// Ceph-400's pixel spacing (as `crate::MM_PER_PX`), for C12's other side.
const CEPH400_MM_PER_PX: f64 = crate::MM_PER_PX;
pub const FIGSHARE: &str = "figshare 13265471 v6 (dental-cepha-dataset.zip)";
pub const LICENCE: &str = "CC BY-NC-SA (the stricter of the two the record lists); testing only, nothing derived is shipped";

/// "7" -> "pku007"; 1..=102 only, written without leading zeros (as the dataset names its files).
pub fn id_of(stem: &str) -> anyhow::Result<String> {
    ensure!(!stem.is_empty() && stem.bytes().all(|b| b.is_ascii_digit()) && !stem.starts_with('0'),
        "file name {stem:?} is not a PKU film number (1 to {PKU_FILMS}, no leading zero)");
    let n: usize = stem.parse().with_context(|| format!("file name {stem:?} is not a number"))?;
    ensure!((1..=PKU_FILMS).contains(&n), "file name {stem:?} is not a PKU film number (1 to {PKU_FILMS})");
    Ok(format!("pku{n:03}"))
}

/// A doctor file: exactly 19 lines, each `x,y` (a space after the comma allowed), no header.
pub fn parse_doctor_file(text: &str) -> anyhow::Result<Vec<(f64, f64)>> {
    let lines: Vec<&str> = text.lines().collect();
    ensure!(lines.len() == ISBI_ORDER.len(), "the file has {} lines, not {} (one x,y per point, no header)", lines.len(), ISBI_ORDER.len());
    lines.iter().enumerate().map(|(i, l)| {
        let f: Vec<&str> = l.split(',').collect();
        ensure!(f.len() == 2, "line {}: not two numbers separated by a comma (x,y)", i + 1);
        let num = |v: &str| v.trim().parse::<f64>().ok().filter(|x| x.is_finite());
        match (num(f[0]), num(f[1])) {
            (Some(x), Some(y)) => Ok((x, y)),
            _ => anyhow::bail!("line {}: not two numbers (x,y)", i + 1),
        }
    }).collect()
}

/// The truth tracing (rule `pku-truth/1`): each point the mean of the two doctors', named in ISBI order.
pub fn mean_tracing(d1: &[(f64, f64)], d2: &[(f64, f64)]) -> Vec<(String, f64, f64)> {
    ISBI_ORDER.iter().zip(d1.iter().zip(d2))
        .map(|(n, (a, b))| (n.to_string(), (a.0 + b.0) / 2.0, (a.1 + b.1) / 2.0)).collect()
}

/// The nine rules' names, in the order `order_checks` returns them.
pub const ORDER_RULES: [&str; 9] = ["ANS in front of PNS", "Sn in front of A", "PogS in front of Pog", "LL below UL", "Me below N",
    "Ar below S", "N in front of S", "Me below S", "UL in front of Ar"];

/// One rule's failures over all films.
#[derive(Clone, Debug, PartialEq)]
pub struct OrderCheck { pub rule: &'static str, pub failures: usize }

/// The six anatomy rules and the three facing rules on one tracing (film px; x grows forwards on a right-facing film,
/// y grows downwards). `true` = the rule holds.
pub fn order_checks(t: &[(String, f64, f64)]) -> Vec<(&'static str, bool)> {
    let g = |n: &str| t.iter().find(|r| r.0 == n).map(|r| (r.1, r.2));
    // "a in front of b": x(a) > x(b); "a below b": y(a) > y(b). A point that is missing fails its rules.
    let front = |a: &str, b: &str| matches!((g(a), g(b)), (Some(p), Some(q)) if p.0 > q.0);
    let below = |a: &str, b: &str| matches!((g(a), g(b)), (Some(p), Some(q)) if p.1 > q.1);
    let held = [front("ANS", "PNS"), front("Sn", "A"), front("PogS", "Pog"), below("LL", "UL"), below("Me", "N"), below("Ar", "S"),
        front("N", "S"), below("Me", "S"), front("UL", "Ar")];
    ORDER_RULES.iter().copied().zip(held).collect()
}

/// What `prepare` found, printed as aggregates only.
#[derive(Clone, Debug)]
pub struct Prepared {
    pub films: usize,
    pub sizes: BTreeMap<(u32, u32), usize>,
    pub order: Vec<OrderCheck>,
    pub sn_ratio: f64,
    pub doctor_gap_p95_mm: f64,
    pub doctor_gap_over_5mm: usize,
    pub provenance_sha256: String,
}

/// Reads `<raw>/image/*.bmp`, `<raw>/doctor1/*.txt`, `<raw>/doctor2/*.txt`; checks; writes the folder `out` (named
/// `pku`, so the seal covers it; outside the repository or git-ignored). `ceph400` is read for C12 (Train only).
pub fn prepare(raw: &Path, out: &Path, ceph400: &Path) -> anyhow::Result<Prepared> {
    prepare_expecting(raw, out, ceph400, PKU_FILMS)
}

/// The files `prepare` writes into `out` (moved there from a temp folder only when everything has passed).
const WRITTEN: [&str; 7] = ["images", "gt.csv", "gt-doctor1.csv", "gt-doctor2.csv", "splits.json", "spacing.csv", "provenance.json"];
const TMP: &str = ".pku-prepare-tmp";

fn prepare_expecting(raw: &Path, out: &Path, ceph400: &Path, expected: usize) -> anyhow::Result<Prepared> {
    // Before any file is read: the output is the folder the seal covers, and git never sees it.
    ensure!(out.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("pku")),
        "{}: the PKU folder must be named pku, so the seal (ledger::SEALED) covers it", out.display());
    crate::sc1_data::ensure_outside_or_ignored(out)?;
    crate::ledger::refuse_held_back(ceph400, "train")?;
    let tmp = out.join(TMP);
    if tmp.exists() { std::fs::remove_dir_all(&tmp)?; }                  // only ever this loader's own leftover
    let r = build(raw, &tmp, ceph400, expected);
    let r = r.and_then(|p| { move_into(&tmp, out)?; Ok(p) });
    if tmp.exists() { let _ = std::fs::remove_dir_all(&tmp); }
    r
}

/// The stems of the files in `dir` with extension `ext` (without case).
fn stems(dir: &Path, ext: &str) -> anyhow::Result<std::collections::BTreeSet<String>> {
    let mut s = std::collections::BTreeSet::new();
    for e in std::fs::read_dir(dir).with_context(|| format!("{} (the PKU download's folders are image, doctor1 and doctor2)", dir.display()))? {
        let p = e?.path();
        if p.is_file() && p.extension().is_some_and(|x| x.to_string_lossy().eq_ignore_ascii_case(ext)) {
            s.insert(p.file_stem().map(|n| n.to_string_lossy().to_string()).unwrap_or_default());
        }
    }
    Ok(s)
}

/// The SHA-256 of every file directly in `dir`, by name.
fn shas(dir: &Path) -> anyhow::Result<BTreeMap<String, String>> {
    let mut m = BTreeMap::new();
    for e in std::fs::read_dir(dir)? {
        let p = e?.path();
        if p.is_file() { m.insert(p.file_name().unwrap_or_default().to_string_lossy().to_string(), crate::ft_common::sha256_hex(&std::fs::read(&p)?)); }
    }
    Ok(m)
}

/// The film as 8-bit grey, its pixels unchanged; refused unless it is grey (or R = G = B on every pixel, alpha opaque).
fn grey(img: image::DynamicImage, id: &str) -> anyhow::Result<image::GrayImage> {
    use image::DynamicImage::*;
    Ok(match img {
        ImageLuma8(g) => g,
        ImageRgb8(c) => {
            ensure!(c.pixels().all(|p| p[0] == p[1] && p[1] == p[2]), "{id}: the BMP is not grey (R, G and B differ on some pixel)");
            image::GrayImage::from_fn(c.width(), c.height(), |x, y| image::Luma([c.get_pixel(x, y)[0]]))
        }
        ImageRgba8(c) => {
            ensure!(c.pixels().all(|p| p[0] == p[1] && p[1] == p[2] && p[3] == 255), "{id}: the BMP is not grey (R, G and B differ, or it is transparent, on some pixel)");
            image::GrayImage::from_fn(c.width(), c.height(), |x, y| image::Luma([c.get_pixel(x, y)[0]]))
        }
        other => anyhow::bail!("{id}: the BMP is not 8-bit ({:?}); refusing to convert it", other.color()),
    })
}

pub(crate) fn median(v: &[f64]) -> anyhow::Result<f64> {
    ensure!(!v.is_empty() && v.iter().all(|x| x.is_finite()), "median of nothing or of a non-number");
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    let n = s.len();
    Ok(if n % 2 == 1 { s[n / 2] } else { (s[n / 2 - 1] + s[n / 2]) / 2.0 })
}

pub(crate) fn sn_px(t: &[(String, f64, f64)]) -> anyhow::Result<f64> {
    let g = |n: &str| t.iter().find(|r| r.0 == n).map(|r| (r.1, r.2)).ok_or_else(|| anyhow::anyhow!("a tracing has no {n}"));
    let (s, n) = (g("S")?, g("N")?);
    Ok(((s.0 - n.0).powi(2) + (s.1 - n.1).powi(2)).sqrt())
}

/// C12's other side: the median S–N in mm over Ceph-400 Train (its gt.csv, at 0.1 mm/px).
pub(crate) fn ceph400_train_sn_mm(ceph400: &Path) -> anyhow::Result<f64> {
    let splits = crate::dataset::load_splits(&ceph400.join("splits.json"))?;
    let ids = crate::dataset::select(&splits, "train")?;
    let gt = crate::dataset::load_points(&ceph400.join("gt.csv"))?;
    let v = ids.iter().map(|id| gt.get(id).ok_or_else(|| anyhow::anyhow!("Ceph-400 gt.csv has no tracing for train film {id}"))
        .and_then(|t| sn_px(t)).map(|d| d * CEPH400_MM_PER_PX)).collect::<anyhow::Result<Vec<f64>>>()?;
    median(&v)
}

fn csv(rows: &[(String, Vec<(String, f64, f64)>)]) -> String {
    let mut s = String::from("image_id,landmark,x,y\n");
    for (id, t) in rows { for (n, x, y) in t { s += &format!("{id},{n},{x},{y}\n"); } }
    s
}

/// Reads, checks and writes everything into `tmp`; any refusal leaves `out` as it was.
fn build(raw: &Path, tmp: &Path, ceph400: &Path, expected: usize) -> anyhow::Result<Prepared> {
    let (img_dir, d1_dir, d2_dir) = (raw.join("image"), raw.join("doctor1"), raw.join("doctor2"));
    let (imgs, d1s, d2s) = (stems(&img_dir, "bmp")?, stems(&d1_dir, "txt")?, stems(&d2_dir, "txt")?);
    for (name, set) in [("doctor1", &d1s), ("doctor2", &d2s)] {
        if let Some(s) = imgs.iter().find(|s| !set.contains(*s)) { anyhow::bail!("{name} has no file {s}.txt for the film {s}.bmp; every film needs both doctors' files"); }
        if let Some(s) = set.iter().find(|s| !imgs.contains(*s)) { anyhow::bail!("{name} file {s}.txt has no film {s}.bmp in image"); }
    }
    ensure!(imgs.len() == expected, "found {} films; the PKU set has {expected}", imgs.len());
    let mut films: Vec<(String, String)> = imgs.iter().map(|s| Ok((id_of(s)?, s.clone()))).collect::<anyhow::Result<_>>()?;
    films.sort();

    std::fs::create_dir_all(tmp.join("images"))?;
    let mut sizes: BTreeMap<(u32, u32), usize> = BTreeMap::new();
    let mut failures = [0usize; 9];
    let (mut off, mut points, mut wrong_size) = (0usize, 0usize, 0usize);
    let (mut gaps, mut sns) = (Vec::new(), Vec::new());
    let (mut gt, mut g1, mut g2) = (Vec::new(), Vec::new(), Vec::new());
    for (id, stem) in &films {
        let read = |dir: &Path, who: &str| -> anyhow::Result<Vec<(f64, f64)>> {
            let p = dir.join(format!("{stem}.txt"));
            parse_doctor_file(&std::fs::read_to_string(&p).with_context(|| format!("{who} file {stem}.txt"))?).with_context(|| format!("{who} file {stem}.txt"))
        };
        let (d1, d2) = (read(&d1_dir, "doctor1")?, read(&d2_dir, "doctor2")?);
        let img = image::open(img_dir.join(format!("{stem}.bmp"))).with_context(|| format!("{id}: the BMP"))?;
        let (w, h) = (img.width(), img.height());
        // Counted, not refused here: the refusal after the pass gives every rule's count (the owner's P1 decision).
        let fits = |a: u32, b: u32| PKU_WIDTHS.contains(&a) && b == PKU_SIZE.1;
        if !(fits(w, h) || fits(h, w)) { wrong_size += 1; }
        *sizes.entry((w, h)).or_default() += 1;
        let g = grey(img, id)?;
        g.save_with_format(tmp.join("images").join(format!("{id}.png")), image::ImageFormat::Png)?;
        for p in d1.iter().chain(&d2) {
            points += 1;
            if !(p.0 >= 0.0 && p.1 >= 0.0 && p.0 <= (w - 1) as f64 && p.1 <= (h - 1) as f64) { off += 1; }
        }
        let t = mean_tracing(&d1, &d2);
        for (k, (_, ok)) in order_checks(&t).iter().enumerate() { if !ok { failures[k] += 1; } }
        for (a, b) in d1.iter().zip(&d2) { gaps.push(((a.0 - b.0).powi(2) + (a.1 - b.1).powi(2)).sqrt() * PKU_MM_PER_PX); }
        sns.push(sn_px(&t)? * PKU_MM_PER_PX);
        let named = |d: &[(f64, f64)]| ISBI_ORDER.iter().zip(d).map(|(n, p)| (n.to_string(), p.0, p.1)).collect::<Vec<_>>();
        g1.push((id.clone(), named(&d1)));
        g2.push((id.clone(), named(&d2)));
        gt.push((id.clone(), t));
    }
    let n = films.len();
    let order: Vec<OrderCheck> = ORDER_RULES.iter().zip(failures).map(|(rule, failures)| OrderCheck { rule, failures }).collect();
    // C12: the scale is plausible.
    let (pku_sn, c4_sn) = (median(&sns)?, ceph400_train_sn_mm(ceph400)?);
    let sn_ratio = pku_sn / c4_sn;
    // Any failure stops the loader after the pass, naming rules and counts only (no film), every rule at once.
    let mut wrong: Vec<String> = order.iter().filter(|o| o.failures > 0).map(|o| format!("{}: {} of {n} films", o.rule, o.failures)).collect();
    if off > 0 { wrong.push(format!("points off the image: {off} of {points}")); }
    if wrong_size > 0 {
        let seen: Vec<String> = sizes.iter().map(|((w, h), k)| format!("{w} x {h}: {k}")).collect();
        let widths: Vec<String> = PKU_WIDTHS.iter().map(|w| w.to_string()).collect();
        wrong.push(format!("film size not {} x {} (either way round): {wrong_size} of {n} films (sizes seen, px: {})", widths.join(" or "), PKU_SIZE.1, seen.join(", ")));
    }
    if wrong.is_empty() {
        ensure!((sn_ratio - 1.0).abs() <= SN_TOLERANCE,
            "C12: PKU's median S-N at {PKU_MM_PER_PX} mm/px is {sn_ratio:.4} times Ceph-400 Train's at {CEPH400_MM_PER_PX} mm/px, outside 1 ± {SN_TOLERANCE}: \
            the scale is wrong, so the loader stops (to the owner)");
    } else {
        let c12 = if (sn_ratio - 1.0).abs() <= SN_TOLERANCE { "within" } else { "OUTSIDE" };
        anyhow::bail!("a PKU rule does not hold, so the loader stops and writes nothing (spec §17.7; to the owner): {}. \
            C12 S-N ratio {sn_ratio:.4} ({c12} 1 ± {SN_TOLERANCE})", wrong.join("; "));
    }
    let mut sorted = gaps.clone();
    sorted.sort_by(f64::total_cmp);
    let doctor_gap_p95_mm = sorted[(sorted.len() * 95).div_ceil(100) - 1];                       // nearest rank
    let doctor_gap_over_5mm = gaps.iter().filter(|g| **g > 5.0).count();

    std::fs::write(tmp.join("gt.csv"), csv(&gt))?;
    std::fs::write(tmp.join("gt-doctor1.csv"), csv(&g1))?;
    std::fs::write(tmp.join("gt-doctor2.csv"), csv(&g2))?;
    let ids: Vec<&String> = films.iter().map(|f| &f.0).collect();
    std::fs::write(tmp.join("splits.json"), serde_json::to_string_pretty(&serde_json::json!({ PKU_SPLIT: ids }))? + "\n")?;
    std::fs::write(tmp.join("spacing.csv"), ids.iter().fold(String::from("image_id,mm_per_px\n"), |s, id| s + &format!("{id},{PKU_MM_PER_PX}\n")))?;
    let prov = serde_json::json!({
        "dataset": "PKU cephalogram dataset (Zeng et al.)",
        "revision": FIGSHARE,
        "licence": LICENCE,
        "prepareRule": PREPARE_RULE,
        "truthRule": TRUTH_RULE,
        "truth": "the mean of doctor1 and doctor2, point by point",
        "pointOrder": ISBI_ORDER,
        "mmPerPx": PKU_MM_PER_PX,
        "scaleSource": PKU_SCALE_SOURCE,
        "widthsPx": PKU_WIDTHS,
        "heightPx": PKU_SIZE.1,
        "films": n,
        "sizesPx": sizes.iter().map(|((w, h), k)| serde_json::json!({ "widthPx": w, "heightPx": h, "films": k })).collect::<Vec<_>>(),
        "c12": { "snRatio": sn_ratio, "pkuMedianSnMm": pku_sn, "ceph400TrainMedianSnMm": c4_sn, "pkuMmPerPx": PKU_MM_PER_PX,
            "ceph400MmPerPx": CEPH400_MM_PER_PX, "tolerance": SN_TOLERANCE,
            "rule": "median S-N of gt.csv (the mean of the two doctors) x mmPerPx over Ceph-400 Train's gt.csv x 0.1; within 1 +- tolerance" },
        "split": PKU_SPLIT,
        "rawSha256": { ".": shas(raw)?, "image": shas(&img_dir)?, "doctor1": shas(&d1_dir)?, "doctor2": shas(&d2_dir)? },
    });
    let prov = serde_json::to_string_pretty(&prov)? + "\n";
    std::fs::write(tmp.join("provenance.json"), &prov)?;
    Ok(Prepared { films: n, sizes, order, sn_ratio, doctor_gap_p95_mm, doctor_gap_over_5mm, provenance_sha256: crate::ft_common::sha256_hex(prov.as_bytes()) })
}

/// Moves each written file from `tmp` into `out`, replacing an earlier run's (never a rename onto an existing file).
fn move_into(tmp: &Path, out: &Path) -> anyhow::Result<()> {
    for name in WRITTEN {
        let (from, to) = (tmp.join(name), out.join(name));
        if to.is_dir() { std::fs::remove_dir_all(&to)?; } else if to.exists() { std::fs::remove_file(&to)?; }
        std::fs::rename(&from, &to).with_context(|| format!("moving {} to {}", from.display(), to.display()))?;
    }
    std::fs::remove_dir(tmp)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::OnceLock;

    fn grey_bmp(w: u32, h: u32) -> image::RgbImage {
        image::RgbImage::from_fn(w, h, |x, y| { let v = ((x * 3 + y * 5) % 251) as u8; image::Rgb([v, v, v]) })
    }
    /// One SYNTHETIC 2089 x 1937 grey BMP (R = G = B), encoded once and copied into each fixture.
    fn bmp_bytes() -> &'static [u8] {
        static B: OnceLock<Vec<u8>> = OnceLock::new();
        B.get_or_init(|| {
            let mut c = std::io::Cursor::new(Vec::new());
            grey_bmp(PKU_SIZE.0, PKU_SIZE.1).write_to(&mut c, image::ImageFormat::Bmp).unwrap();
            c.into_inner()
        })
    }
    struct Fx { _d: tempfile::TempDir, raw: PathBuf, out: PathBuf, c4: PathBuf, n: usize }
    /// SYNTHETIC: `n` films (stems 1..=n), each a grey BMP, doctor1 from `synthetic_faces` in ISBI order, drawn at PKU's
    /// pixel size (x 0.1 / PKU_MM_PER_PX about each face's centroid, so the heads are Ceph-400's heads in mm) and moved 300 px up
    /// (so every point is on a 1,937-px-high film), doctor2 = doctor1 + (2, -1) px; Ceph-400 synthetic at scale `k`.
    fn fx_scaled(n: usize, k: f64) -> Fx {
        let d = tempfile::tempdir().unwrap();
        let out = d.path().join("data").join("pku");
        let raw = out.join("unpacked").join("dental-cepha-dataset");
        for s in ["image", "doctor1", "doctor2"] { std::fs::create_dir_all(raw.join(s)).unwrap(); }
        std::fs::write(raw.join("readme.txt"), "SYNTHETIC readme\n").unwrap();
        let faces = ceph_model::shape::synthetic_faces(n, 2026_11_05);
        let to_pku = crate::MM_PER_PX / PKU_MM_PER_PX;                               // the same heads, in PKU's pixels
        let faces: Vec<Vec<(f64, f64)>> = faces.iter().map(|f| {
            let c = (f.iter().map(|p| p.0).sum::<f64>() / 19.0, f.iter().map(|p| p.1).sum::<f64>() / 19.0);
            f.iter().map(|p| (c.0 + (p.0 - c.0) * to_pku, c.1 + (p.1 - c.1) * to_pku)).collect()
        }).collect();
        for (i, f) in faces.iter().enumerate() {
            let stem = (i + 1).to_string();
            std::fs::write(raw.join("image").join(format!("{stem}.bmp")), bmp_bytes()).unwrap();
            let d1: String = f.iter().map(|p| format!("{},{}\n", p.0.round(), (p.1 - 300.0).round())).collect();
            let d2: String = f.iter().map(|p| format!("{},{}\n", p.0.round() + 2.0, (p.1 - 300.0).round() - 1.0)).collect();
            std::fs::write(raw.join("doctor1").join(format!("{stem}.txt")), d1).unwrap();
            std::fs::write(raw.join("doctor2").join(format!("{stem}.txt")), d2).unwrap();
        }
        let c4 = crate::shape_prior::write_synthetic_ceph400_scaled(d.path(), k).unwrap();
        Fx { _d: d, raw, out, c4, n }
    }
    fn fx() -> Fx { fx_scaled(3, 1.0) }
    fn run(f: &Fx) -> anyhow::Result<Prepared> { prepare_expecting(&f.raw, &f.out, &f.c4, f.n) }
    fn err(f: &Fx) -> String { format!("{:#}", run(f).unwrap_err()) }
    /// Rewrites every doctor file (both doctors) of the listed stems with `edit` applied to its 19 points.
    fn edit_points(f: &Fx, stems: &[usize], edit: impl Fn(&mut Vec<(f64, f64)>)) {
        for s in stems {
            for doc in ["doctor1", "doctor2"] {
                let p = f.raw.join(doc).join(format!("{s}.txt"));
                let mut pts = parse_doctor_file(&std::fs::read_to_string(&p).unwrap()).unwrap();
                edit(&mut pts);
                std::fs::write(&p, pts.iter().map(|(x, y)| format!("{x},{y}\n")).collect::<String>()).unwrap();
            }
        }
    }
    fn all_files(dir: &Path) -> BTreeMap<String, Vec<u8>> {
        let mut m = BTreeMap::new();
        for e in std::fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            let name = p.file_name().unwrap().to_string_lossy().to_string();
            if name == "unpacked" { continue }
            if p.is_dir() { for (k, v) in all_files(&p) { m.insert(format!("{name}|{k}"), v); } } else { m.insert(name, std::fs::read(&p).unwrap()); }
        }
        m
    }

    #[test] fn a_doctor_file_is_19_xy_lines_and_nothing_else() {
        // fails if: a line count other than 19 is accepted, or "x, y" (space) is refused
        let ok: String = (0..19).map(|i| if i == 3 { format!("{}, {}\n", 100 + i, 200 + i) } else { format!("{},{}\n", 100 + i, 200 + i) }).collect();
        assert_eq!(parse_doctor_file(&ok).unwrap().len(), 19);
        eprintln!("\"x, y\" on line 4: read as {:?}", parse_doctor_file(&ok).unwrap()[3]);
        assert_eq!(parse_doctor_file(ok.trim_end()).unwrap().len(), 19);              // no final newline
        eprintln!("no final newline: {} points read", parse_doctor_file(ok.trim_end()).unwrap().len());
        let short: String = (0..18).map(|i| format!("{i},{i}\n")).collect();
        let e = parse_doctor_file(&short).unwrap_err().to_string();
        eprintln!("18 lines: {e}");
        assert!(e.contains("18"), "{e}");
        let e = parse_doctor_file(&(ok.clone() + "5,5\n")).unwrap_err().to_string();
        eprintln!("20 lines: {e}");
        let e2 = parse_doctor_file(&ok.replace("103, 203", "x,203")).unwrap_err().to_string();
        eprintln!("a non-number on line 4: {e2}");
        assert!(e2.contains("line 4"), "{e2}");
        assert!(e.contains("20"), "{e}");
        let e = parse_doctor_file(&ok.replacen(",", ";", 1)).unwrap_err().to_string();
        eprintln!("x;y: {e}");
        assert_eq!(parse_doctor_file(&ok).unwrap()[3], (103.0, 203.0), "\"x, y\" read as x and y");
    }
    #[test] fn the_truth_is_the_mean_of_the_two_doctors_in_isbi_order() {
        // fails if: one doctor is used, or the names are not ISBI's order
        let d1: Vec<(f64, f64)> = (0..19).map(|i| (i as f64, 10.0)).collect();
        let d2: Vec<(f64, f64)> = (0..19).map(|i| (i as f64 + 2.0, 12.0)).collect();
        let t = mean_tracing(&d1, &d2);
        assert_eq!(t[0], ("S".to_string(), 1.0, 11.0));
        assert_eq!(t[18].0, "Ar");
        assert_eq!(t.iter().map(|r| r.0.as_str()).collect::<Vec<_>>(), ISBI_ORDER.to_vec());
        assert_eq!(mean_tracing(&d2, &d1), t);                                          // doctors swapped: same truth
    }
    #[test] fn ids_are_pku001_to_pku102() {
        assert_eq!(id_of("7").unwrap(), "pku007");
        assert_eq!(id_of("1").unwrap(), "pku001");
        assert_eq!(id_of("102").unwrap(), "pku102");
        for bad in ["0", "103", "07", "a", "", "-1", "+7"] { assert!(id_of(bad).is_err(), "{bad}") }
    }
    /// ISBI's order is the one `ceph-model` names the 19 points by (the gt.csv names every other mode reads).
    #[test] fn the_isbi_order_is_the_apps_original_19() {
        assert_eq!(ISBI_ORDER, ceph_model::pointcheck::ORDER);
    }
    /// Fails if: gt.csv is not the mean, a doctor file is not copied as read, the split is unsorted, a spacing row is not
    /// 0.125, provenance misses a raw file or the truth rule, a PNG differs from its BMP by one pixel, or a second run
    /// writes other bytes.
    #[test] fn prepare_writes_the_folder_and_reads_back() {
        let f = fx();
        let p = run(&f).unwrap();
        eprintln!("films {} sizes {:?} order {:?} sn_ratio {:.4} gap p95 {:.4} mm over5 {} provenance {}",
            p.films, p.sizes, p.order, p.sn_ratio, p.doctor_gap_p95_mm, p.doctor_gap_over_5mm, p.provenance_sha256);
        assert_eq!(p.films, 3);
        assert_eq!(p.sizes, BTreeMap::from([(PKU_SIZE, 3)]));
        assert_eq!(p.order.len(), 9);
        assert!(p.order.iter().all(|o| o.failures == 0), "{:?}", p.order);
        assert!((p.sn_ratio - 0.96).abs() < 0.06, "{}", p.sn_ratio);
        let gap = 5f64.sqrt() * PKU_MM_PER_PX;
        assert!((p.doctor_gap_p95_mm - gap).abs() < 1e-9 && p.doctor_gap_over_5mm == 0, "{} {}", p.doctor_gap_p95_mm, p.doctor_gap_over_5mm);
        let gt = crate::dataset::load_points(&f.out.join("gt.csv")).unwrap();
        let d1 = crate::dataset::load_points(&f.out.join("gt-doctor1.csv")).unwrap();
        let d2 = crate::dataset::load_points(&f.out.join("gt-doctor2.csv")).unwrap();
        assert_eq!(gt.len(), 3);
        for s in 1..=3usize {
            let id = format!("pku{s:03}");
            let raw1 = parse_doctor_file(&std::fs::read_to_string(f.raw.join("doctor1").join(format!("{s}.txt"))).unwrap()).unwrap();
            let raw2 = parse_doctor_file(&std::fs::read_to_string(f.raw.join("doctor2").join(format!("{s}.txt"))).unwrap()).unwrap();
            for k in 0..19 {
                assert_eq!(gt[&id][k], (ISBI_ORDER[k].to_string(), (raw1[k].0 + raw2[k].0) / 2.0, (raw1[k].1 + raw2[k].1) / 2.0));
                assert_eq!(d1[&id][k], (ISBI_ORDER[k].to_string(), raw1[k].0, raw1[k].1));
                assert_eq!(d2[&id][k], (ISBI_ORDER[k].to_string(), raw2[k].0, raw2[k].1));
            }
            let png = image::open(f.out.join("images").join(format!("{id}.png"))).unwrap();
            assert_eq!(png.color(), image::ColorType::L8, "8-bit grey");
            let bmp = image::open(f.raw.join("image").join(format!("{s}.bmp"))).unwrap().to_rgb8();
            let g = png.to_luma8();
            assert_eq!(g.dimensions(), bmp.dimensions());
            assert!(g.pixels().zip(bmp.pixels()).all(|(a, b)| a[0] == b[0]), "pixel for pixel");
        }
        let splits = crate::dataset::load_splits(&f.out.join("splits.json")).unwrap();
        assert_eq!(splits.len(), 1);
        assert_eq!(splits["test"], vec!["pku001", "pku002", "pku003"]);
        let sp = crate::dataset::load_spacing(&f.out.join("spacing.csv")).unwrap();
        assert_eq!(sp.len(), 3);
        assert!(sp.values().all(|v| *v == PKU_MM_PER_PX));
        let prov_bytes = std::fs::read(f.out.join("provenance.json")).unwrap();
        assert_eq!(crate::ft_common::sha256_hex(&prov_bytes), p.provenance_sha256);
        let prov: serde_json::Value = serde_json::from_slice(&prov_bytes).unwrap();
        assert_eq!(prov["truthRule"], TRUTH_RULE);
        assert_eq!(prov["mmPerPx"], PKU_MM_PER_PX);
        let raw_sha = &prov["rawSha256"];
        let want = crate::ft_common::sha256_hex(&std::fs::read(f.raw.join("doctor2").join("3.txt")).unwrap());
        assert_eq!(raw_sha["doctor2"]["3.txt"], want.as_str());
        let count = ["image", "doctor1", "doctor2"].iter().map(|k| raw_sha[k].as_object().unwrap().len()).sum::<usize>()
            + raw_sha["."].as_object().unwrap().len();
        assert_eq!(count, 3 * 3 + 1, "every raw file, the readme included");
        let first = all_files(&f.out);
        assert!(!first.keys().any(|k| k.contains("tmp")), "no temp folder left: {:?}", first.keys().collect::<Vec<_>>());
        let p2 = run(&f).unwrap();
        assert_eq!(all_files(&f.out), first, "a second run writes the same bytes");
        eprintln!("run twice: {} files compared byte for byte, all equal", first.len());
        assert_eq!(p2.provenance_sha256, p.provenance_sha256);
    }
    /// Fails if `prepare` (the public one) takes any film count but 102.
    #[test] fn three_films_are_not_pku() {
        let f = fx();
        let e = format!("{:#}", prepare(&f.raw, &f.out, &f.c4).unwrap_err());
        eprintln!("3 films through prepare: {e}");
        assert!(e.contains("102") && e.contains('3'), "{e}");
        assert!(!f.out.join("gt.csv").exists(), "nothing written");
    }
    /// Fails if the order rules are skipped, or the refusal names a film.
    #[test] fn a_swapped_pair_stops_the_loader() {
        let f = fx();
        edit_points(&f, &[1, 2, 3], |p| p.swap(16, 17));                               // PNS <-> ANS
        let e = err(&f);
        eprintln!("ANS and PNS swapped in every file: {e}");
        assert!(e.contains("ANS in front of PNS") && e.contains("3 of 3"), "{e}");
        assert!(!e.contains("pku0") && !f.out.join("gt.csv").exists(), "{e}");
    }
    #[test] fn a_left_facing_film_stops_it() {
        let f = fx();
        edit_points(&f, &[2], |p| for q in p.iter_mut() { q.0 = (PKU_SIZE.0 - 1) as f64 - q.0 });
        let e = err(&f);
        eprintln!("one film facing left: {e}");
        assert!(e.contains("N in front of S") && e.contains("UL in front of Ar") && e.contains("1 of 3"), "{e}");
        assert!(!e.contains("pku0"), "{e}");
    }
    #[test] fn a_point_off_the_image_stops_it() {
        let f = fx();
        let p = f.raw.join("doctor1").join("2.txt");
        let mut pts = parse_doctor_file(&std::fs::read_to_string(&p).unwrap()).unwrap();
        pts[9].1 = 1937.0;                                                          // Go one pixel below the film; no order rule uses Go
        std::fs::write(&p, pts.iter().map(|(x, y)| format!("{x},{y}\n")).collect::<String>()).unwrap();
        let e = err(&f);
        eprintln!("one point off the image: {e}");
        assert!(e.contains("points off the image: 1 of 114") && !e.contains("films"), "only the off-image count: {e}");
        assert!(!e.contains("pku0"), "{e}");
    }
    #[test] fn a_colour_bmp_whose_channels_differ_is_refused() {
        let f = fx();
        let mut img = grey_bmp(PKU_SIZE.0, PKU_SIZE.1);
        img.put_pixel(10, 10, image::Rgb([10, 11, 10]));
        img.save(f.raw.join("image").join("2.bmp")).unwrap();
        let e = err(&f);
        eprintln!("a colour BMP: {e}");
        assert!(e.contains("not grey"), "{e}");
    }
    /// Fails if the size rule stops at the first film (the owner would see one film, not the count), names a film, or
    /// is not reported beside the other rules' counts and C12's ratio.
    #[test] fn an_image_of_another_size_is_refused() {
        let f = fx();
        grey_bmp(2000, PKU_SIZE.1).save(f.raw.join("image").join("1.bmp")).unwrap();
        grey_bmp(2091, PKU_SIZE.1).save(f.raw.join("image").join("3.bmp")).unwrap();
        let e = err(&f);
        eprintln!("a 2000 x 1937 film and a 2091 x 1937 film: {e}");
        assert!(e.contains("not 2089 or 2090 x 1937 (either way round): 2 of 3 films"), "{e}");
        assert!(e.contains("2000 x 1937: 1") && e.contains("2091 x 1937: 1") && e.contains("2089 x 1937: 1"), "every size seen, counted: {e}");
        assert!(e.contains("C12 S-N ratio"), "the scale's ratio beside it: {e}");
        assert!(!e.contains("pku0") && !f.out.join("gt.csv").exists(), "{e}");
    }
    /// Owner P1 ruling (5 Nov 2026, "Accept 2089 or 2090"): 12 of PKU's 102 films are 2090 px wide. Fails if a
    /// 2090-wide film (either way round) is refused, or if 2091 is let through (`an_image_of_another_size_is_refused`).
    #[test] fn a_2090_wide_film_is_accepted() {
        let f = fx();
        grey_bmp(2090, PKU_SIZE.1).save(f.raw.join("image").join("2.bmp")).unwrap();
        grey_bmp(PKU_SIZE.1, 2090).save(f.raw.join("image").join("3.bmp")).unwrap();
        let r = run(&f).map(|p| p.sizes).map_err(|e| format!("{e:#}"));
        eprintln!("one film 2090 x 1937 and one 1937 x 2090: {r:?}");
        assert_eq!(r.unwrap(), BTreeMap::from([((2089, 1937), 1), ((2090, 1937), 1), ((1937, 2090), 1)]));
        assert_eq!(PKU_WIDTHS, &[2089, 2090]);
    }
    /// Task A review F4: the height is checked too. Fails if: `fits` drops `b == PKU_SIZE.1` (a 2089 x 2500 film, or a
    /// 2090 x 1936 one, would then pass the size rule, because only the width was compared).
    #[test] fn a_film_of_the_right_width_and_the_wrong_height_is_refused() {
        let f = fx();
        grey_bmp(2089, 2500).save(f.raw.join("image").join("1.bmp")).unwrap();
        grey_bmp(2090, 1936).save(f.raw.join("image").join("2.bmp")).unwrap();
        let e = err(&f);
        eprintln!("a 2089 x 2500 film and a 2090 x 1936 film: {e}");
        assert!(e.contains("not 2089 or 2090 x 1937 (either way round): 2 of 3 films"), "{e}");
        assert!(e.contains("2089 x 2500: 1") && e.contains("2090 x 1936: 1"), "{e}");
        assert!(!f.out.join("gt.csv").exists(), "nothing written");
    }
    /// Task A review F6: provenance.json stores the size counts and C12's ratio (and both medians it comes from), so the
    /// record of what the loader found does not live only in a log. Fails if: either is left out of provenance, or the
    /// stored ratio is not the one `prepare` returned.
    #[test] fn provenance_stores_the_sizes_and_the_c12_ratio() {
        let f = fx();
        grey_bmp(2090, PKU_SIZE.1).save(f.raw.join("image").join("2.bmp")).unwrap();
        let p = run(&f).unwrap();
        let prov: serde_json::Value = serde_json::from_slice(&std::fs::read(f.out.join("provenance.json")).unwrap()).unwrap();
        eprintln!("provenance sizes {} c12 {}", prov["sizesPx"], prov["c12"]);
        assert_eq!(prov["sizesPx"], serde_json::json!([
            { "widthPx": 2089, "heightPx": 1937, "films": 2 }, { "widthPx": 2090, "heightPx": 1937, "films": 1 } ]));
        let c12 = &prov["c12"];
        // serde_json's reader is not bit-exact without float_roundtrip, so to 1e-12 (C12 is recomputed at the run anyway)
        assert!((c12["snRatio"].as_f64().unwrap() - p.sn_ratio).abs() < 1e-12, "{}", c12["snRatio"]);
        assert_eq!(c12["tolerance"].as_f64(), Some(SN_TOLERANCE));
        let (a, b) = (c12["pkuMedianSnMm"].as_f64().unwrap(), c12["ceph400TrainMedianSnMm"].as_f64().unwrap());
        assert!((a / b - p.sn_ratio).abs() < 1e-12, "the stored ratio is the two stored medians' quotient");
        assert_eq!((c12["pkuMmPerPx"].as_f64(), c12["ceph400MmPerPx"].as_f64()), (Some(PKU_MM_PER_PX), Some(crate::MM_PER_PX)));
    }
    #[test] fn a_rotated_image_is_accepted() {
        let f = fx();
        let p = run(&f).unwrap();
        assert_eq!(p.sizes.len(), 1);
        // either way round: a 1937 x 2089 film passes the size rule (its points still fit on it in this fixture)
        let r = grey_bmp(PKU_SIZE.1, PKU_SIZE.0);
        r.save(f.raw.join("image").join("1.bmp")).unwrap();
        let e = run(&f).map(|p| p.sizes).map_err(|e| format!("{e:#}"));
        eprintln!("one film 1937 x 2089: {e:?}");
        assert_eq!(e.unwrap(), BTreeMap::from([(PKU_SIZE, 2), ((PKU_SIZE.1, PKU_SIZE.0), 1)]));
    }
    #[test] fn a_missing_doctor2_file_is_refused() {
        let f = fx();
        std::fs::remove_file(f.raw.join("doctor2").join("2.txt")).unwrap();
        let e = err(&f);
        eprintln!("doctor2/2.txt missing: {e}");
        assert!(e.contains("doctor2") && e.contains("2.txt"), "{e}");
    }
    #[test] fn a_missing_doctor1_file_is_refused() {
        let f = fx();
        std::fs::remove_file(f.raw.join("doctor1").join("3.txt")).unwrap();
        let e = err(&f);
        eprintln!("doctor1/3.txt missing: {e}");
        assert!(e.contains("doctor1") && e.contains("3.txt"), "{e}");
    }
    #[test] fn an_extra_bmp_with_no_doctor_files_is_refused() {
        let f = fx();
        std::fs::write(f.raw.join("image").join("4.bmp"), bmp_bytes()).unwrap();
        let e = err(&f);
        eprintln!("image/4.bmp with no doctor files: {e}");
        assert!(e.contains("4.txt"), "{e}");
    }
    #[test] fn a_doctor_file_with_no_film_is_refused() {
        let f = fx();
        std::fs::copy(f.raw.join("doctor2").join("1.txt"), f.raw.join("doctor2").join("9.txt")).unwrap();
        let e = err(&f);
        eprintln!("doctor2/9.txt with no film: {e}");
        assert!(e.contains("9"), "{e}");
    }
    /// C12 (M22). Fails if the ratio is not compared, or only one side of ±0.15 is checked.
    #[test] fn c12_the_wrong_scale_stops_it() {
        for (k, ok) in [(1.3, false), (1.0 / 1.3, false), (1.0, true)] {
            let f = fx_scaled(3, k);
            let r = run(&f);
            match &r {
                Ok(p) => eprintln!("Ceph-400 x{k:.4}: accepted, S-N ratio {:.4}", p.sn_ratio),
                Err(e) => eprintln!("Ceph-400 x{k:.4}: {e:#}"),
            }
            assert_eq!(r.is_ok(), ok, "k = {k}");
            if !ok {
                let e = format!("{:#}", r.unwrap_err());
                assert!(e.contains("C12") && e.contains("S-N"), "{e}");
                assert!(!f.out.join("gt.csv").exists(), "nothing written");
            }
        }
        // the ratios themselves, as the brief gives them
        let lo = fx_scaled(3, 1.3);
        let e = format!("{:#}", run(&lo).unwrap_err());
        assert!(e.contains("0.7"), "about 0.74: {e}");
        let hi = fx_scaled(3, 1.0 / 1.3);
        let e = format!("{:#}", run(&hi).unwrap_err());
        assert!(e.contains("1.2"), "about 1.25: {e}");
    }
    /// Owner P1 ruling (5 Nov 2026, "0.125 mm, cited"): the scale is 0.125 mm/px, and C12 (±0.15, unchanged) passes
    /// a SYNTHETIC PKU set drawn at that scale at exactly the ratio its files give. Fails if the scale is not 0.125, if
    /// C12 reads another spacing than PKU_MM_PER_PX on either side, or if the tolerance moved.
    #[test] fn c12_at_0_125_passes_at_the_right_ratio() {
        assert_eq!((PKU_MM_PER_PX, SN_TOLERANCE), (0.125, 0.15));
        assert!(PKU_SCALE_SOURCE.contains("2501.10984") && PKU_SCALE_SOURCE.contains("0.125"), "{PKU_SCALE_SOURCE}");
        let f = fx();
        let p = run(&f).unwrap();
        let sn = |t: &[(String, f64, f64)]| sn_px(t).unwrap();
        let pku: Vec<f64> = crate::dataset::load_points(&f.out.join("gt.csv")).unwrap().values().map(|t| sn(t) * 0.125).collect();
        let c4s = crate::dataset::load_splits(&f.c4.join("splits.json")).unwrap();
        let c4g = crate::dataset::load_points(&f.c4.join("gt.csv")).unwrap();
        let c4: Vec<f64> = c4s["train"].iter().map(|id| sn(&c4g[id]) * 0.1).collect();
        assert_eq!(c4.len(), 150);
        let want = median(&pku).unwrap() / median(&c4).unwrap();
        eprintln!("C12 at 0.125 mm/px: ratio {:.4} (from the files {want:.4})", p.sn_ratio);
        assert!((p.sn_ratio - want).abs() < 1e-12 && (p.sn_ratio - 1.0).abs() <= 0.15, "{} vs {want}", p.sn_ratio);
        let prov: serde_json::Value = serde_json::from_slice(&std::fs::read(f.out.join("provenance.json")).unwrap()).unwrap();
        assert_eq!((prov["prepareRule"].as_str(), prov["mmPerPx"].as_f64()), (Some(PREPARE_RULE), Some(0.125)));
        assert_eq!(PREPARE_RULE, "pku-prepare/2");
    }
    /// Fails if `out` may be a folder inside the repository that git does not ignore, or is not named `pku` (the seal
    /// would not cover it).
    #[test] fn out_must_be_git_ignored_or_outside_the_repo() {
        let f = fx();
        let repo = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
        let inside = repo.join("src").join("pku");
        let e = format!("{:#}", prepare_expecting(&f.raw, &inside, &f.c4, 3).unwrap_err());
        eprintln!("out inside the repo, not ignored: {e}");
        assert!(e.contains("not git-ignored") || e.contains("does not ignore"), "{e}");
        assert!(!inside.exists(), "nothing made");
        let other = f.out.parent().unwrap().join("pku-copy");
        let e = format!("{:#}", prepare_expecting(&f.raw, &other, &f.c4, 3).unwrap_err());
        eprintln!("out not named pku: {e}");
        assert!(e.contains("named pku"), "{e}");
        assert!(run(&f).is_ok(), "control: a temp folder outside the repo, named pku");
    }
    /// The seal covers what the loader writes: the folder it made is refused by `refuse_held_back` afterwards.
    #[test] fn the_folder_made_is_sealed() {
        let f = fx();
        run(&f).unwrap();
        let e = crate::ledger::refuse_held_back(&f.out, PKU_SPLIT).unwrap_err().to_string();
        assert!(e.contains("sealed"), "{e}");
    }
}
