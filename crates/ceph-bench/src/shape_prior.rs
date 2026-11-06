//! `ceph-bench --shape-prior <out>` (Stage A Task 3; spec 2026-11-02 §14.13 U5, owner ruling OQ-2 as revised): the
//! starting knowledge for the app's point check, built from Ceph-400's expert tracings. Train 001-150 and Test1 151-300
//! only; Test2 is never read. Point coordinates only: no film, no image. The text is read back with the app's own
//! loader before it is handed on, and every coordinate must equal what was read from the dataset, bit for bit.

use std::path::Path;

/// The starting-knowledge text from `<data>/gt.csv` and `<data>/splits.json`.
pub fn build(data: &Path) -> anyhow::Result<String> { Ok(build_counted(data)?.text) }

/// What `build` made, with the count of coordinates checked against the dataset when it was read back.
pub struct Built { pub text: String, pub films: usize, pub coordinates_checked: usize }

pub fn build_counted(data: &Path) -> anyhow::Result<Built> {
    use crate::{dataset, ledger};
    use ceph_model::pointcheck::{parse_prior, prior_json, ORDER};
    // Held back (owner O7): the gate first, for each split read, before any file is opened. Test2 is never selected.
    ledger::refuse_held_back(data, "train")?;
    ledger::refuse_held_back(data, "test1")?;
    let splits = dataset::load_splits(&data.join("splits.json"))?;
    let ids: Vec<String> = dataset::select(&splits, "train")?.into_iter().chain(dataset::select(&splits, "test1")?).collect();
    let gt = dataset::load_points(&data.join("gt.csv"))?;
    let mut films = Vec::with_capacity(ids.len());
    for id in &ids {
        let rows = gt.get(id).ok_or_else(|| anyhow::anyhow!("gt.csv has no tracing for film {id}"))?;
        let pts = ORDER.iter().map(|name| {
            let hits: Vec<&(String, f64, f64)> = rows.iter().filter(|r| r.0 == *name).collect();
            anyhow::ensure!(hits.len() == 1, "film {id}: gt.csv has {} rows for {name}; every tracing needs each of the 19 points once", hits.len());
            Ok((hits[0].1, hits[0].2))
        }).collect::<anyhow::Result<Vec<_>>>()?;
        films.push((id.clone(), pts));
    }
    let text = prior_json(&films)?;
    // Read back with the app's own loader: every coordinate must be what was read from the dataset, bit for bit.
    let back = parse_prior(text.as_bytes())?;
    anyhow::ensure!(back.tracings.len() == films.len(), "read back {} tracings, wrote {}", back.tracings.len(), films.len());
    let mut checked = 0usize;
    for ((id, want), got) in films.iter().zip(&back.tracings) {
        anyhow::ensure!(got.len() == want.len(), "film {id}: read back {} points, wrote {}", got.len(), want.len());
        for (k, (w, g)) in want.iter().zip(got).enumerate() {
            anyhow::ensure!(w.0.to_bits() == g.0.to_bits() && w.1.to_bits() == g.1.to_bits(),
                "film {id} {}: read back ({}, {}), the dataset has ({}, {}); refusing to finish", ORDER[k], g.0, g.1, w.0, w.1);
            checked += 2;
        }
    }
    anyhow::ensure!(checked == films.len() * 19 * 2, "checked {checked} coordinates, not {}", films.len() * 19 * 2);
    Ok(Built { text, films: films.len(), coordinates_checked: checked })
}

/// `--shape-prior <out>` writes only under a folder named `models` (git-ignored; never committed, bundled or uploaded
/// until the licence check allows it, THIRD_PARTY_MODELS.md).
pub fn check_out(out: &Path) -> anyhow::Result<()> {
    let under_models = out.parent().is_some_and(|p| p.components().any(|c| c.as_os_str() == "models"));
    anyhow::ensure!(under_models, "{}: the starting knowledge goes in the git-ignored models folder (e.g. models/shape/ceph400-v1.shape)", out.display());
    Ok(())
}

/// SYNTHETIC only, for tests (never the real `data/`): a Ceph-400-shaped folder `<root>/data/ceph400` with `gt.csv` for
/// films 001-400 (19 points each, synthetic faces in film px) and `splits.json` (`train` 001-150, `test1` 151-300,
/// `test2` 301-400). Test2's faces are shifted by 5,000 px so any of their numbers in a file would stand out.
#[doc(hidden)]
pub fn write_synthetic_ceph400(root: &Path) -> anyhow::Result<std::path::PathBuf> { write_synthetic_ceph400_scaled(root, 1.0) }

/// SYNTHETIC only, for tests: `write_synthetic_ceph400` with every coordinate scaled by `k` about its own face's
/// centroid (before Test2's shift), so the faces are `k` times the size and sit where they sat. `k = 1.0` writes the
/// same bytes as `write_synthetic_ceph400` (SC-1 Part 1b Task A, the C12 control).
#[doc(hidden)]
pub fn write_synthetic_ceph400_scaled(root: &Path, k: f64) -> anyhow::Result<std::path::PathBuf> {
    let data = root.join("data").join("ceph400");
    std::fs::create_dir_all(&data)?;
    let faces = ceph_model::shape::synthetic_faces(400, 2026_11_02);
    let mut gt = String::from("image_id,landmark,x,y\n");
    for (i, f) in faces.iter().enumerate() {
        let shift = if i >= 300 { 5000.0 } else { 0.0 };
        let c = (f.iter().map(|p| p.0).sum::<f64>() / f.len() as f64, f.iter().map(|p| p.1).sum::<f64>() / f.len() as f64);
        // p·k + c·(1 − k): exactly p when k = 1, so the unscaled folder keeps its bytes.
        for (name, p) in ceph_model::pointcheck::ORDER.iter().zip(f) {
            let (x, y) = (p.0 * k + c.0 * (1.0 - k), p.1 * k + c.1 * (1.0 - k));
            gt += &format!("{:03},{name},{},{}\n", i + 1, x + shift, y + shift);
        }
    }
    std::fs::write(data.join("gt.csv"), gt)?;
    let ids = |a: usize, b: usize| (a..=b).map(|n| format!("{n:03}")).collect::<Vec<_>>();
    std::fs::write(data.join("splits.json"), serde_json::to_string(&serde_json::json!({"train": ids(1, 150), "test1": ids(151, 300), "test2": ids(301, 400)}))?)?;
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use ceph_model::pointcheck::{parse_prior, ORDER};

    /// Fails if `build` stops writing the 300 films (e.g. only Train), or writes a file the app cannot load.
    #[test] fn a_synthetic_folder_builds_a_file_the_app_loads_with_300_films() {
        let t = tempfile::tempdir().unwrap();
        let data = write_synthetic_ceph400(t.path()).unwrap();
        let b = build_counted(&data).unwrap();
        let p = parse_prior(b.text.as_bytes()).unwrap();
        eprintln!("films {}, coordinates checked {}", b.films, b.coordinates_checked);
        assert_eq!((p.films, p.tracings.len(), b.films, b.coordinates_checked), (300, 300, 300, 300 * 19 * 2));
        assert_eq!(build(&data).unwrap(), b.text, "two builds give the same bytes");
    }
    /// Fails if a missing film were skipped (299 tracings written) or the error did not name it.
    #[test] fn a_gt_csv_missing_one_train_film_is_refused_naming_it() {
        let t = tempfile::tempdir().unwrap();
        let data = write_synthetic_ceph400(t.path()).unwrap();
        let gt = std::fs::read_to_string(data.join("gt.csv")).unwrap();
        std::fs::write(data.join("gt.csv"), gt.lines().filter(|l| !l.starts_with("042,")).map(|l| format!("{l}\n")).collect::<String>()).unwrap();
        let e = format!("{:#}", build(&data).unwrap_err());
        eprintln!("gt.csv without film 042: {e}");
        assert!(e.contains("042"), "{e}");
        // One point missing (S) in one film, the edge case "S or N missing in a tracing".
        let data = write_synthetic_ceph400(&t.path().join("b")).unwrap();
        let gt = std::fs::read_to_string(data.join("gt.csv")).unwrap();
        std::fs::write(data.join("gt.csv"), gt.lines().filter(|l| !l.starts_with("007,S,")).map(|l| format!("{l}\n")).collect::<String>()).unwrap();
        let e = format!("{:#}", build(&data).unwrap_err());
        eprintln!("gt.csv with S missing in film 007: {e}");
        assert!(e.contains("007") && e.contains('S'), "{e}");
    }
    /// The held-back gate runs for both splits read. By name it cannot refuse `train` or `test1` of ceph400 (only Test2 is
    /// held back), so what is seen is (1) a Test2 film name planted into `train` is refused naming Test2, and (2) a data
    /// folder that does not exist is refused by the gate's own words ("cannot find the data folder"), before any file is
    /// read. Fails if the Test2 check is dropped, or if `refuse_held_back` is no longer called first.
    #[test] fn the_held_back_gate_runs_and_a_test2_film_in_train_is_refused() {
        let t = tempfile::tempdir().unwrap();
        let data = write_synthetic_ceph400(t.path()).unwrap();
        let mut s: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(data.join("splits.json")).unwrap()).unwrap();
        s["train"][149] = "301".into();
        std::fs::write(data.join("splits.json"), s.to_string()).unwrap();
        let e = format!("{:#}", build(&data).unwrap_err());
        eprintln!("a Test2 film planted into train: {e}");
        assert!(e.contains("Test2") && e.contains("301"), "{e}");
        let e = format!("{:#}", build(&t.path().join("data").join("not-there")).unwrap_err());
        eprintln!("a data folder that does not exist: {e}");
        assert!(e.contains("cannot find the data folder"), "{e}");
    }
    /// Fails if any Test2 coordinate reaches the file (e.g. `select(.., "all")`). Test2's synthetic faces are shifted by
    /// 5,000 px, so none of the file's coordinates may be 4,000 px or more, and none of Test2's numbers may appear.
    #[test] fn no_test2_film_reaches_the_file() {
        let t = tempfile::tempdir().unwrap();
        let data = write_synthetic_ceph400(t.path()).unwrap();
        let text = build(&data).unwrap();
        let p = parse_prior(text.as_bytes()).unwrap();
        let biggest = p.tracings.iter().flatten().fold(0f64, |m, q| m.max(q.0).max(q.1));
        assert!(biggest < 4000.0, "a coordinate {biggest} is from a Test2 face");
        let gt = ceph_bench_points(&data);
        let mut test2_numbers = 0;
        for n in 301..=400 {
            for (_, x, y) in &gt[&format!("{n:03}")] { for v in [x, y] { assert!(!text.contains(&format!("{v}")), "Test2 film {n}'s {v} is in the file"); test2_numbers += 1; } }
        }
        assert_eq!(test2_numbers, 100 * 19 * 2);
        assert!(!text.contains("\"301\"") && !text.contains("\"400\""));
        assert_eq!(ORDER.len(), 19);
    }
    fn ceph_bench_points(data: &Path) -> crate::dataset::Points { crate::dataset::load_points(&data.join("gt.csv")).unwrap() }
    /// SC-1 Part 1b Task A. Fails if k = 1 changes a byte, or if k does not scale each face's S–N by k (about its centroid,
    /// so the centroid stays).
    #[test] fn the_scaled_synthetic_ceph400_is_k_times_the_size_and_k_1_is_unchanged() {
        let (a, b) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let plain = write_synthetic_ceph400(a.path()).unwrap();
        let one = write_synthetic_ceph400_scaled(b.path(), 1.0).unwrap();
        for f in ["gt.csv", "splits.json"] { assert_eq!(std::fs::read(plain.join(f)).unwrap(), std::fs::read(one.join(f)).unwrap(), "{f}"); }
        let c = tempfile::tempdir().unwrap();
        let big = write_synthetic_ceph400_scaled(c.path(), 1.3).unwrap();
        let (p, q) = (ceph_bench_points(&plain), ceph_bench_points(&big));
        let sn = |r: &Vec<(String, f64, f64)>| { let g = |n: &str| r.iter().find(|x| x.0 == n).map(|x| (x.1, x.2)).unwrap(); let (s, n) = (g("S"), g("N")); ((s.0 - n.0).powi(2) + (s.1 - n.1).powi(2)).sqrt() };
        let cen = |r: &Vec<(String, f64, f64)>| (r.iter().map(|x| x.1).sum::<f64>() / 19.0, r.iter().map(|x| x.2).sum::<f64>() / 19.0);
        for id in ["001", "150", "333"] {
            assert!((sn(&q[id]) / sn(&p[id]) - 1.3).abs() < 1e-9, "{id}");
            let (c0, c1) = (cen(&p[id]), cen(&q[id]));
            assert!((c0.0 - c1.0).abs() < 1e-6 && (c0.1 - c1.1).abs() < 1e-6, "{id}: the centroid stays");
        }
    }
    /// Fails if `--shape-prior` accepted an output outside a folder named `models`.
    #[test] fn the_output_must_be_under_a_folder_named_models() {
        assert!(check_out(Path::new("models/shape/ceph400-v1.shape")).is_ok());
        assert!(check_out(Path::new("/x/models/a.shape")).is_ok());
        for bad in ["reports/ceph400-v1.shape", "ceph400-v1.shape", "models-old/x.shape", "/tmp/x.shape"] {
            let e = check_out(Path::new(bad)).unwrap_err().to_string();
            eprintln!("{bad}: {e}");
            assert!(e.contains("git-ignored models folder"), "{e}");
        }
    }
}
