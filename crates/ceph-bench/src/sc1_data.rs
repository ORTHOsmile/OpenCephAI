//! SC-1 Part 1, spec §4.2 steps 1-2: the seeded 80/10/10 split of Aariz TRAIN, and the teaching boxes written as COCO.
//! Bench only. Aariz train is the only source: valid is never taught on, test is closed (`ledger::refuse_held_back`),
//! and the 10% tuning slice is written into the split file and is never read in Part 1 (RV-4: it is Part 2's).
use crate::{chainproof::{shuffle, Rng}, dataset, ft_common, ledger, scale};
use anyhow::{ensure, Context};
use ceph_model::wholefilm::{teaching_boxes, REGIONS};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{collections::BTreeSet, path::{Path, PathBuf}};

pub const SPLIT_SEED: u64 = 20261107;
pub const SPLIT_VERSION: &str = "sc1-aariz-split/1";
/// The rule, in the file's `rule` field word for word; `load_split` re-derives the lists from it.
pub const SPLIT_RULE: &str = "Aariz train ids, sorted, shuffled with splitmix64 seed 20261107 (`chainproof::shuffle`); k = floor(n / 10); hold-out = the first k, tuning = the next k, teach = the rest; each list sorted.";

/// `<repo>/reference/sc1-aariz-split.json` at the repo root, whatever folder the bench runs from (as `ledger::path`),
/// built with `join` (no separator inside a path string, ruling P7). Outside a git checkout this is an error.
pub fn split_path() -> anyhow::Result<PathBuf> {
    let o = std::process::Command::new("git").args(["rev-parse", "--show-toplevel"]).output().context("running git")?;
    ensure!(o.status.success(), "not inside the repo: the SC-1 split file lives at <repo>/reference/sc1-aariz-split.json");
    Ok(PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()).join("reference").join("sc1-aariz-split.json"))
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Split { pub version: String, pub seed: u64, pub rule: String, pub dataset: String, pub teach: Vec<String>, pub holdout: Vec<String>, pub tuning: Vec<String> }

/// The inner function with the seed as an argument (the test of the seed calls it with another seed).
pub(crate) fn split_with_seed(ids: &[String], seed: u64) -> anyhow::Result<Split> {
    let mut v: Vec<String> = ids.to_vec();
    v.sort();
    ensure!(v.windows(2).all(|w| w[0] != w[1]), "the Aariz train list names a film twice; refusing to split it");
    let k = v.len() / 10;
    ensure!(k >= 1, "{} train films is too few to split 80/10/10 (each 10% slice would be empty)", v.len());
    shuffle(&mut v, &mut Rng::new(seed));
    let sorted = |s: &[String]| { let mut x = s.to_vec(); x.sort(); x };
    Ok(Split { version: SPLIT_VERSION.into(), seed, rule: SPLIT_RULE.into(), dataset: "aariz".into(),
        holdout: sorted(&v[..k]), tuning: sorted(&v[k..2 * k]), teach: sorted(&v[2 * k..]) })
}

/// The split of a list of Aariz train ids by the pinned rule and seed.
pub fn split(ids: &[String]) -> anyhow::Result<Split> { split_with_seed(ids, SPLIT_SEED) }

/// The file's text (and what is hashed): pretty JSON and a final newline.
pub fn split_text(s: &Split) -> anyhow::Result<String> { Ok(serde_json::to_string_pretty(s)? + "\n") }

/// SHA-256 of the real seeded split of the 700 Aariz train films (reference/sc1-aariz-split.json), pinned before any teaching.
pub const PINNED_SPLIT_SHA256: &str = "c8ed1fa03694b8096d4ce10fb6451a670d7e6cf12fbde4433115dfa2b2794b4e";

/// Reads a split file and checks the rule: version, seed and rule text are the pinned ones, and the three lists are
/// exactly what the rule gives when re-derived from their union (so a film moved between lists, a film listed twice or
/// a list not sorted is refused). Unknown fields are refused.
pub fn load_split(text: &str) -> anyhow::Result<Split> {
    let s: Split = serde_json::from_str(text).context("the split file is not the file this tool writes")?;
    ensure!(s.version == SPLIT_VERSION, "the split file's version is {:?}, this tool reads {SPLIT_VERSION:?}", s.version);
    ensure!(s.seed == SPLIT_SEED, "the split file's seed is {}, the rule's seed is {SPLIT_SEED}", s.seed);
    ensure!(s.rule == SPLIT_RULE, "the split file's rule text is not the pinned rule");
    let union: Vec<String> = s.teach.iter().chain(&s.holdout).chain(&s.tuning).cloned().collect();
    let want = split(&union).context("the split file's lists do not make a splittable set")?;
    ensure!(want == s, "the split file is not what the rule gives for its own films (a film moved between lists, or a list changed): refusing");
    Ok(s)
}

/// Only the `train` list of an Aariz `splits.json`: valid and test ids are not kept (serde ignores the other lists).
fn train_ids(aariz: &Path) -> anyhow::Result<Vec<String>> {
    #[derive(Deserialize)] struct OnlyTrain { train: Vec<String> }
    let p = aariz.join("splits.json");
    let t: OnlyTrain = serde_json::from_str(&std::fs::read_to_string(&p).with_context(|| p.display().to_string())?)
        .with_context(|| format!("{}: no train list", p.display()))?;
    ensure!(!t.train.is_empty(), "{}: the train list is empty", p.display());
    Ok(t.train)
}

/// What both SC-1 data modes check first, before any file is read: the folder resolves and its TRAIN split is not
/// held back, and it is Aariz.
fn gate(aariz: &Path) -> anyhow::Result<()> {
    ledger::refuse_held_back(aariz, "train")?;
    ensure!(scale::is_aariz(aariz), "{}: the SC-1 split and teaching boxes come from Aariz train only, and this folder is not Aariz", aariz.display());
    Ok(())
}

/// A folder outside the repository, or one git ignores. Git judges the inside case; a folder that does not exist yet is
/// placed by its nearest existing parent.
pub fn ensure_outside_or_ignored(dir: &Path) -> anyhow::Result<()> {
    let o = std::process::Command::new("git").args(["rev-parse", "--show-toplevel"]).output().context("running git")?;
    ensure!(o.status.success(), "not inside a git checkout: cannot tell whether {} is outside the repository; refusing", dir.display());
    let root = std::fs::canonicalize(String::from_utf8_lossy(&o.stdout).trim())?;
    let abs = if dir.is_absolute() { dir.to_path_buf() } else { std::env::current_dir()?.join(dir) };
    let mut tail = Vec::new();
    let mut base = abs.clone();
    while !base.exists() {
        let Some(name) = base.file_name().map(|n| n.to_owned()) else { break };
        tail.push(name);
        if !base.pop() { break }
    }
    let mut real = std::fs::canonicalize(&base).unwrap_or(base);
    for n in tail.into_iter().rev() { real.push(n); }
    if !real.starts_with(&root) { return Ok(()) }
    ft_common::ensure_ignored(&real).with_context(|| format!("{} is inside the repository and git does not ignore it", dir.display()))
}

/// `--sc1-split <out>`: splits Aariz train and writes the file; prints the counts and returns the SHA-256 of the file.
pub fn write_split_cli(aariz: &Path, out: &Path) -> anyhow::Result<String> {
    gate(aariz)?;
    if let Some(d) = out.parent().filter(|p| !p.as_os_str().is_empty()) { ensure_outside_or_ignored(d)?; }
    let s = split(&train_ids(aariz)?)?;
    let text = split_text(&s)?;
    if let Some(d) = out.parent().filter(|p| !p.as_os_str().is_empty()) { std::fs::create_dir_all(d)?; }
    std::fs::write(out, &text)?;
    let sha = ft_common::sha256_hex(text.as_bytes());
    println!("teach {} · hold-out {} · tuning {} · of {} Aariz train films", s.teach.len(), s.holdout.len(), s.tuning.len(), s.teach.len() + s.holdout.len() + s.tuning.len());
    println!("sha256 {sha}");
    Ok(sha)
}

/// The expert points mirrored across the film: x' = (w - 1) - x.
fn mirrored(pts: &[(String, f64, f64)], w: u32) -> Vec<(String, f64, f64)> {
    pts.iter().map(|(id, x, y)| (id.clone(), (w as f64 - 1.0) - x, *y)).collect()
}

/// One COCO file for a list of films, each film and its mirror image. Returns the text and (images, annotations).
fn coco(aariz: &Path, ids: &[String], gt: &dataset::Points) -> anyhow::Result<(String, usize, usize)> {
    let real = std::fs::canonicalize(aariz)?;
    let (mut images, mut anns) = (Vec::new(), Vec::new());
    for id in ids {
        let src = real.join("images").join(format!("{id}.png"));
        let (w, h) = image::image_dimensions(&src).with_context(|| format!("the film image of {id}"))?;
        let pts = gt.get(id).with_context(|| format!("no expert points for film {id}"))?;
        for (flip, name, p) in [(false, format!("{id}.png"), pts.clone()), (true, format!("{id}_flip.png"), mirrored(pts, w))] {
            let image_id = images.len() + 1;
            images.push(json!({"id": image_id, "file_name": name, "width": w, "height": h,
                "cephtrace_source": src.to_string_lossy(), "cephtrace_flip": flip}));
            for b in teaching_boxes(&p, w, h) {
                let (bw, bh) = (b.x1 - b.x0, b.y1 - b.y0);
                anns.push(json!({"id": anns.len() + 1, "image_id": image_id, "category_id": b.region.index() + 1,
                    "bbox": [b.x0, b.y0, bw, bh], "area": bw * bh, "iscrowd": 0}));
            }
        }
    }
    let categories: Vec<_> = REGIONS.iter().enumerate().map(|(i, r)| json!({"id": i + 1, "name": r.key(), "supercategory": "region"})).collect();
    let (ni, na) = (images.len(), anns.len());
    let text = serde_json::to_string_pretty(&json!({"images": images, "annotations": anns, "categories": categories}))? + "\n";
    Ok((text, ni, na))
}

/// `--sc1-teaching-boxes <dir>`: `<dir>/train` holds the teach films, `<dir>/valid` the hold-out films, each with its
/// mirror image. The tuning slice and Aariz valid are never written. Returns (teach images, hold-out images).
pub fn teaching_boxes_cli(aariz: &Path, split: &Split, dir: &Path) -> anyhow::Result<(usize, usize)> {
    gate(aariz)?;
    ensure_outside_or_ignored(dir)?;
    let train: BTreeSet<String> = train_ids(aariz)?.into_iter().collect();
    let strangers = split.teach.iter().chain(&split.holdout).chain(&split.tuning).filter(|i| !train.contains(*i)).count();
    ensure!(strangers == 0, "{strangers} film(s) in the split file are not in Aariz train; refusing (nothing written)");
    let gt = dataset::load_points(&aariz.join("gt.csv"))?;
    let (teach, nt, at) = coco(aariz, &split.teach, &gt)?;
    let (hold, nh, ah) = coco(aariz, &split.holdout, &gt)?;
    for (sub, text) in [("train", teach), ("valid", hold)] {
        std::fs::create_dir_all(dir.join(sub))?;
        std::fs::write(dir.join(sub).join("_annotations.coco.json"), text)?;
    }
    println!("{}", ft_common::counted("teach images (films and mirror images)", nt, split.teach.len() * 2)?);
    println!("{}", ft_common::counted("hold-out images (films and mirror images)", nh, split.holdout.len() * 2)?);
    println!("boxes: teach {at}, hold-out {ah}; the {} tuning films were not written", split.tuning.len());
    Ok((nt, nh))
}

#[cfg(test)]
mod tests {
    use super::*;
    use ceph_model::pointcheck::ORDER;
    use std::collections::BTreeMap;

    fn ids(n: usize) -> Vec<String> { (0..n).map(|i| format!("s{i:04}")).collect() }
    fn strs(v: &[&str]) -> Vec<String> { v.iter().map(|s| s.to_string()).collect() }

    /// Fails if the lists are not 80/10/10 of the input, overlap, drop a film, are unsorted, depend on the input order,
    /// or the seed is not part of the result (the seed argument is the inner function's).
    #[test] fn the_split_is_80_10_10_seeded_disjoint_and_complete() {
        let all = ids(703);
        let s = split(&all).unwrap();
        eprintln!("703 films: hold-out {}, tuning {}, teach {}", s.holdout.len(), s.tuning.len(), s.teach.len());
        assert_eq!((s.holdout.len(), s.tuning.len(), s.teach.len()), (70, 70, 563));
        let mut union: Vec<String> = s.teach.iter().chain(&s.holdout).chain(&s.tuning).cloned().collect();
        let n = union.len();
        union.sort(); union.dedup();
        assert_eq!((n, union.len()), (703, 703), "disjoint and complete");
        assert_eq!(union, all);
        for l in [&s.teach, &s.holdout, &s.tuning] { assert!(l.windows(2).all(|w| w[0] < w[1]), "each list sorted"); }
        let mut rev = all.clone(); rev.reverse();
        assert_eq!(split(&rev).unwrap(), s, "the same films in another order give the same split");
        let other = split_with_seed(&all, 20261108).unwrap();
        assert_ne!(other.holdout, s.holdout, "another seed gives another hold-out");
        assert_eq!((s.version.as_str(), s.seed, s.rule.as_str()), (SPLIT_VERSION, SPLIT_SEED, SPLIT_RULE));
        assert!(split(&ids(9)).is_err(), "9 films: an empty 10% slice is refused");
        assert!(split(&strs(&["a", "b", "a", "c", "d", "e", "f", "g", "h", "i", "j"])).unwrap_err().to_string().contains("twice"));
    }

    /// The seed control (ruling P3): SHA-256 of the written text of the split of a SYNTHETIC list pins seed, shuffle,
    /// sorting and layout together. Fails if SPLIT_SEED changes, if `chainproof::shuffle` or `Rng` changes, or if the
    /// file layout changes.
    #[test] fn the_seed_is_pinned_by_the_hash_of_a_synthetic_split() {
        let text = split_text(&split(&ids(703)).unwrap()).unwrap();
        let sha = ft_common::sha256_hex(text.as_bytes());
        eprintln!("synthetic 703 split sha256 {sha}");
        assert_eq!(sha, "63f0778771ce1599475799eadc59135b2a560ff19b22c9495f254d3c1b53a19b");
    }

    /// Fails if `load_split` stops re-deriving the rule, or accepts another version or an unknown field.
    /// Fails if the committed reference split changes by one byte, is not what the rule gives, or is not 560/70/70.
    #[test] fn the_split_reference_file_is_pinned() {
        let text = include_str!("../../../reference/sc1-aariz-split.json");
        let s = load_split(text).unwrap();
        assert_eq!((s.teach.len(), s.holdout.len(), s.tuning.len()), (560, 70, 70));
        assert_eq!(ft_common::sha256_hex(text.as_bytes()), PINNED_SPLIT_SHA256);
    }

    #[test] fn load_split_refuses_a_file_that_is_not_the_rule() {
        let good = split(&ids(40)).unwrap();
        assert_eq!(load_split(&split_text(&good).unwrap()).unwrap(), good, "control: the file the tool writes loads");
        let mut moved = good.clone();
        let one = moved.teach.remove(0);
        moved.holdout.push(one); moved.holdout.sort();
        let e = load_split(&split_text(&moved).unwrap()).unwrap_err().to_string();
        eprintln!("one film moved: {e}");
        assert!(e.contains("rule"), "{e}");
        let v2 = Split { version: "sc1-aariz-split/2".into(), ..good.clone() };
        let e = load_split(&split_text(&v2).unwrap()).unwrap_err().to_string();
        eprintln!("version /2: {e}");
        assert!(e.contains("version"), "{e}");
        let mut v: serde_json::Value = serde_json::to_value(&good).unwrap();
        v["extra"] = json!(1);
        let e = format!("{:#}", load_split(&v.to_string()).unwrap_err());
        eprintln!("unknown field: {e}");
        assert!(e.contains("unknown field"), "{e}");
        let wrong_seed = Split { seed: 20261108, ..good.clone() };
        assert!(load_split(&split_text(&wrong_seed).unwrap()).unwrap_err().to_string().contains("seed"));
        let wrong_rule = Split { rule: "something else".into(), ..good.clone() };
        assert!(load_split(&split_text(&wrong_rule).unwrap()).unwrap_err().to_string().contains("rule"));
        let mut dup = good.clone(); dup.tuning.push(dup.teach[0].clone()); dup.tuning.sort();
        assert!(load_split(&split_text(&dup).unwrap()).is_err(), "a film in two lists");
        let mut unsorted = good.clone(); unsorted.teach.reverse();
        assert!(load_split(&split_text(&unsorted).unwrap()).is_err(), "an unsorted list");
    }

    // ---- synthetic Aariz-shaped folders (never data/) ----
    const W: u32 = 8;
    const H: u32 = 10;
    /// The 19 points (ORDER) of a synthetic face scaled into the 8 x 10 film, plus the six extra Aariz points the teaching
    /// boxes use (U6, U1A, L6, L1A, Ns, Prn), each placed one pixel from a point of its region.
    fn film_points(seed: u64) -> Vec<(String, f64, f64)> {
        let f = ceph_model::shape::synthetic_faces(1, seed).remove(0);
        let (x0, x1) = f.iter().fold((f64::MAX, f64::MIN), |a, p| (a.0.min(p.0), a.1.max(p.0)));
        let (y0, y1) = f.iter().fold((f64::MAX, f64::MIN), |a, p| (a.0.min(p.1), a.1.max(p.1)));
        let at = |p: (f64, f64)| (1.0 + 5.0 * (p.0 - x0) / (x1 - x0), 1.0 + 7.0 * (p.1 - y0) / (y1 - y0));
        let mut v: Vec<(String, f64, f64)> = ORDER.iter().zip(&f).map(|(id, p)| { let q = at(*p); (id.to_string(), q.0, q.1) }).collect();
        let near = |v: &[(String, f64, f64)], id: &str, dx: f64, dy: f64| { let p = v.iter().find(|x| x.0 == id).unwrap(); (p.1 + dx, p.2 + dy) };
        for (name, base, dx, dy) in [("U6", "A", 1.0, 0.0), ("U1A", "U1T", 0.0, -1.0), ("L6", "B", 1.0, 0.0), ("L1A", "L1T", 0.0, 1.0), ("Ns", "N", 0.0, 0.5), ("Prn", "Sn", 1.0, 0.0)] {
            let q = near(&v, base, dx, dy);
            v.push((name.to_string(), q.0.clamp(0.0, 7.0), q.1.clamp(0.0, 9.0)));
        }
        v
    }
    struct Fixture { _d: tempfile::TempDir, aariz: PathBuf, split: Split, special: [String; 2] }
    fn rows(id: &str, pts: &[(String, f64, f64)]) -> String { pts.iter().map(|(n, x, y)| format!("{id},{n},{x},{y}\n")).collect() }
    /// 20 train films (tr-0001..), 2 valid, 1 test, all with 8 x 10 PNGs and expert points. Two teach films are made the
    /// edge cases: the first has only the Me point of the mandible (no L1A or L6), the second has no S and no N.
    fn fixture(folder: &str) -> Fixture {
        let d = tempfile::tempdir().unwrap();
        let aariz = d.path().join(folder);
        std::fs::create_dir_all(aariz.join("images")).unwrap();
        let train: Vec<String> = (1..=20).map(|i| format!("tr-{i:04}")).collect();
        let sp = split(&train).unwrap();
        let special = [sp.teach[0].clone(), sp.teach[1].clone()];
        let (valid, test) = (strs(&["va-0001", "va-0002"]), strs(&["te-0001"]));
        let mut gt = String::from("image_id,landmark,x,y\n");
        for (k, id) in train.iter().chain(&valid).chain(&test).enumerate() {
            let mut pts = film_points(100 + k as u64);
            if *id == special[0] { pts.retain(|p| !["Go", "Pog", "B", "Gn", "L6", "L1A"].contains(&p.0.as_str())); }
            if *id == special[1] { pts.retain(|p| p.0 != "S" && p.0 != "N"); }
            gt += &rows(id, &pts);
            image::GrayImage::new(W, H).save(aariz.join("images").join(format!("{id}.png"))).unwrap();
        }
        std::fs::write(aariz.join("gt.csv"), gt).unwrap();
        std::fs::write(aariz.join("splits.json"), serde_json::to_string(&json!({"train": train, "valid": valid, "test": test})).unwrap()).unwrap();
        Fixture { _d: d, aariz, split: sp, special }
    }
    fn read(p: PathBuf) -> serde_json::Value { serde_json::from_str(&std::fs::read_to_string(p).unwrap()).unwrap() }
    fn boxes_of(coco: &serde_json::Value, file_name: &str) -> BTreeMap<u64, Vec<f64>> {
        let img = coco["images"].as_array().unwrap().iter().find(|i| i["file_name"] == file_name).unwrap_or_else(|| panic!("no image {file_name}"));
        coco["annotations"].as_array().unwrap().iter().filter(|a| a["image_id"] == img["id"])
            .map(|a| (a["category_id"].as_u64().unwrap(), a["bbox"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect())).collect()
    }
    /// JSON text carries a float to within the last digit (serde_json without exact round-trip): compare to 1e-9 px.
    fn same(a: &[f64], b: &[f64]) -> bool { a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() < 1e-9) }
    fn xyxy(b: &ceph_model::wholefilm::RegionBox) -> Vec<f64> { vec![b.x0, b.y0, b.x1 - b.x0, b.y1 - b.y0] }

    /// Held-back and non-Aariz folders (C5). Fails if valid or test ids reach the split file, if the Aariz rule is not
    /// asked of the folder, or if the held-back gate is not called before splits.json is read.
    #[test] fn the_split_refuses_held_back_and_non_aariz_folders() {
        let f = fixture("aariz");
        let out = f._d.path().join("out").join("split.json");
        let sha = write_split_cli(&f.aariz, &out).unwrap();
        let text = std::fs::read_to_string(&out).unwrap();
        assert_eq!(ft_common::sha256_hex(text.as_bytes()), sha);
        for id in ["va-0001", "va-0002", "te-0001"] { assert!(!text.contains(id), "{id} is not a train film but is in the split file"); }
        assert_eq!(load_split(&text).unwrap(), f.split, "the file written is the split of the 20 train ids");
        let c4 = fixture("ceph400");
        let e = write_split_cli(&c4.aariz, &c4._d.path().join("o.json")).unwrap_err().to_string();
        eprintln!("ceph400 folder: {e}");
        assert!(e.contains("Aariz"), "{e}");
        // Nothing resolves: refused before any read (the folder has no splits.json to read, and the message is the gate's).
        let missing = f._d.path().join("no-such").join("aariz");
        let e = write_split_cli(&missing, &f._d.path().join("o2.json")).unwrap_err().to_string();
        eprintln!("unresolvable folder: {e}");
        assert!(e.contains("cannot find the data folder") && !e.contains("splits.json"), "{e}");
        let e = teaching_boxes_cli(&missing, &f.split, &f._d.path().join("c")).unwrap_err().to_string();
        assert!(e.contains("cannot find the data folder"), "{e}");
        // Test2 and Aariz test through the preflight are shown in main.rs's tests. Here, the gate on the train split alone:
        assert!(ledger::refuse_held_back(&f.aariz, "train").is_ok(), "control: train is not held back");
        assert!(ledger::refuse_held_back(&f.aariz, "test").is_err(), "control: the same folder's test is");
    }

    /// Fails if the tuning slice or Aariz valid is written, if a flip is skipped (2 x counts), if a category id leaves 1..=5,
    /// or if a flipped film's boxes are not the boxes of its mirrored points.
    #[test] fn teaching_boxes_write_teach_and_holdout_with_flips_and_never_the_tuning_slice() {
        let f = fixture("aariz");
        let dir = f._d.path().join("coco");
        let (nt, nh) = teaching_boxes_cli(&f.aariz, &f.split, &dir).unwrap();
        eprintln!("images written: train {nt} (16 films x 2), valid {nh} (2 films x 2)");
        assert_eq!((nt, nh), (32, 4));
        let (train, valid) = (read(dir.join("train").join("_annotations.coco.json")), read(dir.join("valid").join("_annotations.coco.json")));
        assert_eq!((train["images"].as_array().unwrap().len(), valid["images"].as_array().unwrap().len()), (32, 4));
        let all = format!("{train}{valid}");
        for id in f.split.tuning.iter().chain(&strs(&["va-0001", "va-0002", "te-0001"])) { assert!(!all.contains(id.as_str()), "{id} must not appear"); }
        for id in f.split.holdout.iter() { assert!(!train.to_string().contains(id.as_str()), "hold-out film {id} is in train"); }
        for id in f.split.teach.iter() { assert!(!valid.to_string().contains(id.as_str()), "teach film {id} is in valid"); }
        for id in f.split.holdout.iter() { assert!(valid.to_string().contains(id.as_str()), "hold-out film {id} is not in valid"); }
        for id in f.split.teach.iter() { assert!(train.to_string().contains(id.as_str()), "teach film {id} is not in train"); }
        let cats = train["categories"].as_array().unwrap();
        assert_eq!(cats.iter().map(|c| c["name"].as_str().unwrap()).collect::<Vec<_>>(), ["cranial-base", "maxilla", "mandible", "incisors", "soft-tissue"]);
        assert_eq!(cats.iter().map(|c| c["id"].as_u64().unwrap()).collect::<Vec<_>>(), [1, 2, 3, 4, 5]);
        let mut per_cat = BTreeMap::<u64, usize>::new();
        for a in train["annotations"].as_array().unwrap().iter().chain(valid["annotations"].as_array().unwrap()) {
            let c = a["category_id"].as_u64().unwrap();
            assert!((1..=5).contains(&c), "category id {c}");
            *per_cat.entry(c).or_default() += 1;
            assert_eq!(a["iscrowd"], 0);
            let b = a["bbox"].as_array().unwrap();
            assert!((a["area"].as_f64().unwrap() - b[2].as_f64().unwrap() * b[3].as_f64().unwrap()).abs() < 1e-9);
        }
        eprintln!("annotations per category id (1 cranial base .. 5 soft tissue): {per_cat:?}");
        let img = &train["images"][0];
        assert_eq!((img["width"].as_u64(), img["height"].as_u64(), img["cephtrace_flip"].as_bool()), (Some(8), Some(10), Some(false)));
        assert!(img["cephtrace_source"].as_str().unwrap().ends_with(&format!("images{}{}.png", std::path::MAIN_SEPARATOR, f.split.teach[0])));
        assert!(Path::new(img["cephtrace_source"].as_str().unwrap()).is_absolute());
        // A film and its flip: the flip's boxes are the boxes of the mirrored expert points, and the exact geometric mirror.
        let id = &f.split.teach[2];
        let gt = dataset::load_points(&f.aariz.join("gt.csv")).unwrap();
        let (orig, flip) = (boxes_of(&train, &format!("{id}.png")), boxes_of(&train, &format!("{id}_flip.png")));
        let want = teaching_boxes(&mirrored(&gt[id], W), W, H);
        assert_eq!(want.len(), 5);
        for b in &want {
            let got = &flip[&(b.region.index() as u64 + 1)];
            assert!(same(got, &xyxy(b)), "flip box of {}: {got:?}", b.region.key());
            let o = &orig[&(b.region.index() as u64 + 1)];
            assert!(same(&[got[0], got[0] + got[2]], &[7.0 - (o[0] + o[2]), 7.0 - o[0]]), "the flip is the mirror of the original box");
        }
        let mandible = ceph_model::wholefilm::Region::Mandible.index() as u64 + 1;
        eprintln!("flip edge: mandible {:?} -> mirrored {:?}", orig[&mandible], flip[&mandible]);
        assert_ne!(orig[&mandible], flip[&mandible], "control: a mirror image really moved the box");
        // Counts, as the bench prints them (C7).
        eprintln!("{}", ft_common::counted("teach images", nt, 32).unwrap());
        assert!(ft_common::counted("teach images", nt, 16).is_err(), "control: skipping the flips would not match 2 x teach");
    }

    /// Edge cases: a film with 1 mandible point has no mandible box (but is still written); a film without S and N draws
    /// its cranial-base box from Po, Ar, Or; each shows its output.
    #[test] fn too_few_points_and_a_missing_s_or_n_are_handled_per_region() {
        let f = fixture("aariz");
        let dir = f._d.path().join("coco");
        teaching_boxes_cli(&f.aariz, &f.split, &dir).unwrap();
        let train = read(dir.join("train").join("_annotations.coco.json"));
        let gt = dataset::load_points(&f.aariz.join("gt.csv")).unwrap();
        let (few, nosn) = (&f.special[0], &f.special[1]);
        let mand = ceph_model::wholefilm::Region::Mandible.index() as u64 + 1;
        let cb = ceph_model::wholefilm::Region::CranialBase.index() as u64 + 1;
        let b = boxes_of(&train, &format!("{few}.png"));
        eprintln!("one mandible point (Me only): categories boxed {:?}; file still written: {}", b.keys().collect::<Vec<_>>(), train.to_string().contains(few.as_str()));
        assert!(!b.contains_key(&mand), "1 mandible point: no mandible box");
        assert_eq!(b.len(), 4, "the other four regions are still boxed");
        assert!(boxes_of(&train, &format!("{few}_flip.png")).get(&mand).is_none(), "and none on its flip");
        let b = boxes_of(&train, &format!("{nosn}.png"));
        let want = teaching_boxes(&gt[nosn], W, H);
        let cbw = want.iter().find(|x| x.region.index() as u64 + 1 == cb).expect("Po, Ar, Or are still 3 points");
        eprintln!("S and N missing: cranial-base box {:?} from the other three points", b[&cb]);
        assert!(same(&b[&cb], &xyxy(cbw)));
        assert!(gt[nosn].iter().all(|p| p.0 != "S" && p.0 != "N"), "control: this film really has no S or N");
    }

    /// Fails if the tool will write anywhere git does not ignore inside the repository.
    #[test] fn teaching_boxes_refuse_a_dir_inside_the_repository_that_git_does_not_ignore() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap();
        let f = fixture("aariz");
        let bad = root.join("crates").join("ceph-bench").join("src").join("sc1-out-not-ignored");
        let e = teaching_boxes_cli(&f.aariz, &f.split, &bad).unwrap_err().to_string();
        eprintln!("inside the repo, not ignored: {e}");
        assert!(e.contains("inside the repository") && !bad.exists(), "{e}");
        let e = write_split_cli(&f.aariz, &bad.join("split.json")).unwrap_err().to_string();
        assert!(e.contains("inside the repository") && !bad.exists(), "{e}");
        assert!(ensure_outside_or_ignored(&root.join("reports").join("sc1")).is_ok(), "control: reports/<run>/ is git-ignored");
        assert!(ensure_outside_or_ignored(&f._d.path().join("anywhere").join("deep")).is_ok(), "control: outside the repo is fine");
        assert!(ensure_outside_or_ignored(&root.join("docs").join("x")).is_err());
    }

    /// The split file has one place, `<repo>/reference/sc1-aariz-split.json`, whatever folder the bench runs from (as
    /// `ledger::path`). Fails if `split_path` goes back to a path relative to the current folder.
    #[test] fn the_split_file_is_found_from_the_repository_root() {
        let root = std::fs::canonicalize(Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..")).unwrap();
        let p = split_path().unwrap();
        eprintln!("split file: {}", p.display());
        assert!(p.is_absolute(), "{}", p.display());
        assert_eq!(std::fs::canonicalize(p.parent().unwrap().parent().unwrap()).unwrap(), root);
        assert!(p.ends_with(Path::new("reference").join("sc1-aariz-split.json")));
    }

    /// Fails if a split file holding a film that is not in Aariz train is accepted.
    #[test] fn a_split_file_with_a_film_outside_aariz_train_is_refused() {
        let f = fixture("aariz");
        let mut s = f.split.clone();
        s.tuning[0] = "va-0001".into();                                    // a valid-split film smuggled in
        let e = teaching_boxes_cli(&f.aariz, &s, &f._d.path().join("c")).unwrap_err().to_string();
        eprintln!("valid film in the split: {e}");
        assert!(e.contains("not in Aariz train") && !f._d.path().join("c").exists(), "{e}");
    }
}
