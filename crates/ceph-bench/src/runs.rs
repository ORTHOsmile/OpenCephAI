//! Paired errors from two models' bench points on the same films (spec 2026-10-13 §5.2).

use crate::dataset::Points;
use crate::source::Pair;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// For each film and point: (error of `a`, error of `b`) in mm at the film's spacing. A film where `a`, `b` or the truth
/// lacks the point is left out for that point and counted in the second map (never an error).
pub fn paired_errors(a: &Points, b: &Points, gt: &Points, spacing: &dyn Fn(&str) -> anyhow::Result<f64>, ids: &[String], points: &[&str])
    -> anyhow::Result<(BTreeMap<String, Vec<Pair>>, BTreeMap<String, usize>)> {
    let find = |m: &Points, iid: &str, id: &str| m.get(iid).and_then(|v| v.iter().find(|(l, _, _)| l == id)).map(|(_, x, y)| (*x, *y));
    let (mut out, mut left) = (BTreeMap::<String, Vec<Pair>>::new(), BTreeMap::<String, usize>::new());
    for id in points { out.insert(id.to_string(), Vec::new()); left.insert(id.to_string(), 0); }
    for iid in ids {
        let mm = spacing(iid)?;
        for id in points {
            match (find(a, iid, id), find(b, iid, id), find(gt, iid, id)) {
                (Some(p), Some(q), Some(t)) => out.get_mut(*id).unwrap().push((
                    crate::metrics::radial_error_mm(p, t, mm), crate::metrics::radial_error_mm(q, t, mm))),
                _ => *left.get_mut(*id).unwrap() += 1,
            }
        }
    }
    Ok((out, left))
}

/// SHA-256 of the film ids, sorted, one per line: names the exact films a decision used, without listing them.
pub fn films_sha256(ids: &[String]) -> String {
    let mut v: Vec<&String> = ids.iter().collect();
    v.sort();
    let joined = v.iter().map(|s| s.as_str()).collect::<Vec<_>>().join("\n");
    Sha256::digest(joined.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Each run's `metrics.json` `aarizScale` must equal `expected` (both absent off Aariz); the first that differs is named.
pub fn same_scale(run_dirs: &[std::path::PathBuf], expected: Option<&crate::scale::ScaleCounts>) -> anyhow::Result<()> {
    let want = expected.map(serde_json::to_value).transpose()?;
    for dir in run_dirs {
        use anyhow::Context;
        let file = dir.join("metrics.json");
        let m: serde_json::Value = serde_json::from_slice(&std::fs::read(&file)
            .with_context(|| format!("{}: no bench run there (cannot read {})", dir.display(), file.display()))?)
            .with_context(|| format!("{}: unreadable", file.display()))?;
        anyhow::ensure!(m.get("aarizScale").cloned() == want,
            "{}: its Aariz scale ({}) is not this decision's ({}); re-run it under aariz-scale/1 on the same films",
            dir.display(), m.get("aarizScale").map(|v| v.to_string()).unwrap_or_else(|| "none".into()),
            want.as_ref().map(|v| v.to_string()).unwrap_or_else(|| "none".into()));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dataset::parse_points;
    #[test] fn pairs_each_film_and_point_at_its_own_spacing_and_counts_what_is_left_out() {
        let gt = parse_points("i,l,x,y\nf1,S,0,0\nf1,Go,0,0\nf2,S,0,0\n").unwrap();
        let a = parse_points("i,l,x,y,c\nf1,S,3,4,1\nf1,Go,6,8,1\nf2,S,0,0,1\n").unwrap();
        let b = parse_points("i,l,x,y,c\nf1,S,0,0,1\nf2,S,6,8,1\n").unwrap();                 // b lacks Go on f1
        let sp = |iid: &str| -> anyhow::Result<f64> { Ok(if iid == "f1" { 0.1 } else { 0.2 }) };
        let (p, left) = paired_errors(&a, &b, &gt, &sp, &["f1".into(), "f2".into()], &["S", "Go"]).unwrap();
        assert_eq!(p["S"], vec![(0.5, 0.0), (0.0, 2.0)]);
        assert!(!p.contains_key("Go") || p["Go"].is_empty());
        // f1: b lacks Go; f2: the truth (and both models) lack Go — both are left out and counted (prereg; preflight b5).
        assert_eq!((left["S"], left["Go"]), (0, 2));
    }
    #[test] fn a_missing_spacing_row_is_an_error_naming_the_film() {
        let gt = parse_points("i,l,x,y\nf1,S,0,0\n").unwrap();
        let sp = |iid: &str| -> anyhow::Result<f64> { anyhow::bail!("no spacing.csv row for {iid}") };
        assert!(paired_errors(&gt, &gt, &gt, &sp, &["f1".into()], &["S"]).unwrap_err().to_string().contains("f1"));
    }
    #[test] fn the_film_list_hash_ignores_order_and_changes_with_any_film() {
        let h = films_sha256(&["b".into(), "a".into()]);
        assert_eq!(h, films_sha256(&["a".into(), "b".into()]));
        assert_ne!(h, films_sha256(&["a".into(), "c".into()]));
        assert_eq!(h.len(), 64);
    }
    #[test] fn a_pair_of_runs_on_different_aariz_scales_is_refused_naming_the_run() {
        let d = tempfile::tempdir().unwrap();
        let c = |used: usize| crate::scale::ScaleCounts { aariz_scale_rule: crate::scale::AARIZ_SCALE_RULE.into(), films: 150, used, excluded: 150 - used, ..Default::default() };
        let run = |name: &str, scale: Option<&crate::scale::ScaleCounts>| {
            let dir = d.path().join(name); std::fs::create_dir_all(&dir).unwrap();
            let mut m = serde_json::json!({ "provider": "cpu" });
            if let Some(s) = scale { m["aarizScale"] = serde_json::to_value(s).unwrap(); }
            std::fs::write(dir.join("metrics.json"), m.to_string()).unwrap(); dir
        };
        let (a, b) = (run("a", Some(&c(98))), run("b", Some(&c(98))));
        assert!(same_scale(&[a.clone(), b.clone()], Some(&c(98))).is_ok());
        let old = run("old", None);                                              // a Task 2 run: no aarizScale
        assert!(same_scale(&[a.clone(), old], Some(&c(98))).unwrap_err().to_string().contains("old"));
        let other = run("other", Some(&c(97)));                                  // other films
        assert!(same_scale(&[a, other], Some(&c(98))).unwrap_err().to_string().contains("other"));
        let (p, q) = (run("p", None), run("q", None));                           // Ceph-400: no rule on either side
        assert!(same_scale(&[p, q], None).is_ok());
    }
    #[test] fn a_run_with_no_metrics_file_is_refused_naming_the_run() {
        let d = tempfile::tempdir().unwrap();
        let gone = d.path().join("aariz-cepha29");                                  // never run into this folder
        let e = format!("{:#}", same_scale(&[gone], None).unwrap_err());
        assert!(e.contains("aariz-cepha29"), "{e}");
    }
}
