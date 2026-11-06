//! `ceph-bench --sc1-reference <out>` (SC-1 Part 1b Task B; spec 2026-11-03 §17.4, owner ruling R1b-4 "Ceph-400 + all
//! Aariz train"): the whole-film check's shape reference, `whole-film-reference/1`, from 1,000 expert tracings: Ceph-400
//! Train 001-150 and Test1 151-300 (named `ceph400:NNN`) and every Aariz train tracing (named `aariz:<id>`; the teaching,
//! hold-out and tuning slices alike). Ceph-400 Test2, Aariz valid, Aariz test and PKU are never read. Point coordinates
//! only. The line for the full 19 points and for each 18-point set is fitted here by the app's own `WholeScorer`
//! (leave-one-out, nearest-rank 99.5th percentile, rounded up to 0.1; the rule unchanged) and stored. The text is read
//! back with the app's loader and every coordinate and line must equal what was built, bit for bit. Stage A's
//! `ceph400-v1.shape` is never written.

use crate::ft_common::{par_map, Pt};
use ceph_model::pointcheck::ORDER;
use std::path::Path;

/// What `build` made: the file's text, the tracings by dataset, the coordinates checked on read-back, the full-19 line
/// and the time the 20 lines took to fit (seconds, cold).
pub struct Built { pub text: String, pub films: usize, pub ceph400: usize, pub aariz: usize, pub coordinates_checked: usize, pub line19: f64, pub seconds_cold: f64 }

pub fn build(ceph400: &Path, aariz: &Path) -> anyhow::Result<Built> {
    use crate::{dataset, ledger, sc1_gate};
    use ceph_model::wholefilm::{reference_json, reference_name, stored_line_sets, Reference, WholeScorer};
    // Before any tracing is read: the folders are what they say, and the held-back gate (with PKU's seal) for each split
    // read. Ceph-400 Test2, Aariz valid and Aariz test are never selected.
    anyhow::ensure!(sc1_gate::is_ceph400(ceph400), "{} is not the Ceph-400 folder (ceph400): the reference's first 300 tracings are Ceph-400 Train and Test1", ceph400.display());
    anyhow::ensure!(crate::scale::is_aariz(aariz), "{} is not the Aariz folder (aariz): the reference's other tracings are Aariz train", aariz.display());
    ledger::refuse_held_back(ceph400, "train")?;
    ledger::refuse_held_back(ceph400, "test1")?;
    ledger::refuse_held_back(aariz, "train")?;
    let c4s = dataset::load_splits(&ceph400.join("splits.json"))?;
    let c4_ids: Vec<String> = dataset::select(&c4s, "train")?.into_iter().chain(dataset::select(&c4s, "test1")?).collect();
    for id in &c4_ids {
        let n: u32 = if id.len() == 3 && id.bytes().all(|b| b.is_ascii_digit()) { id.parse()? } else { 0 };
        anyhow::ensure!(!(301..=400).contains(&n), "Ceph-400's train or test1 list names film {id}, a Test2 film (301-400): refused before any tracing is read");
        anyhow::ensure!((1..=300).contains(&n), "Ceph-400's train or test1 list names {id:?}, not a film 001-300: refused before any tracing is read");
    }
    let mut seen = std::collections::BTreeSet::new();
    anyhow::ensure!(c4_ids.iter().all(|i| seen.insert(i.clone())) && c4_ids.len() == 300, "Ceph-400 train and test1 list {} films ({} distinct), not 300", c4_ids.len(), seen.len());
    let az_splits = dataset::load_splits(&aariz.join("splits.json"))?;
    let az_ids = dataset::select(&az_splits, "train")?;
    anyhow::ensure!(!az_ids.is_empty(), "Aariz's train list is empty");
    // The train list must share no film with valid or test (their lists' names only are compared; no tracing is read).
    for other in ["valid", "test"] {
        let o: std::collections::BTreeSet<&String> = az_splits.get(other).map(|v| v.iter().collect()).unwrap_or_default();
        let both = az_ids.iter().filter(|i| o.contains(i)).count();
        anyhow::ensure!(both == 0, "Aariz's train list shares {both} film(s) with {other}: train must be disjoint from valid and test; refused before any tracing is read");
    }
    let c4_gt = dataset::load_points(&ceph400.join("gt.csv"))?;
    let az_gt = dataset::load_points(&aariz.join("gt.csv"))?;
    // Every one of the 19 points on every film (a missing point refuses, with the count), then each point exactly once.
    sc1_gate::complete(&c4_gt, &c4_ids, "Ceph-400 train and test1")?;
    sc1_gate::complete(&az_gt, &az_ids, "Aariz train")?;
    let mut names = Vec::with_capacity(c4_ids.len() + az_ids.len());
    let mut tracings = Vec::with_capacity(names.capacity());
    for (ds, gt, ids) in [("ceph400", &c4_gt, &c4_ids), ("aariz", &az_gt, &az_ids)] {
        for id in ids {
            let name = reference_name(ds, id)?;
            let rows = gt.get(id).ok_or_else(|| anyhow::anyhow!("{name}: gt.csv has no tracing"))?;
            let pts = ORDER.iter().map(|p| {
                let hits: Vec<&(String, f64, f64)> = rows.iter().filter(|r| r.0 == *p).collect();
                anyhow::ensure!(hits.len() == 1, "{name}: gt.csv has {} rows for {p}; every tracing needs each of the 19 points once", hits.len());
                Ok((hits[0].1, hits[0].2))
            }).collect::<anyhow::Result<Vec<Pt>>>()?;
            names.push(name);
            tracings.push(pts);
        }
    }
    let (n_c4, n_az) = (c4_ids.len(), az_ids.len());
    anyhow::ensure!(names.len() == n_c4 + n_az, "{} tracings, not {} + {}", names.len(), n_c4, n_az);
    // The lines: WholeScorer's own rule, fitted fresh for each stored set (one set per thread).
    let s = WholeScorer::from_reference(&Reference { sha256: String::new(), names: names.clone(), tracings: tracings.clone(), lines: vec![] })?;
    let sets = stored_line_sets();
    let t0 = std::time::Instant::now();
    let fitted = par_map(&sets, |set| s.line_for(set));
    let seconds_cold = t0.elapsed().as_secs_f64();
    let lines: Vec<(Vec<usize>, f64)> = sets.into_iter().zip(fitted).map(|(set, l)| Ok((set, l?))).collect::<anyhow::Result<_>>()?;
    let text = reference_json(&names, &tracings, &lines)?;
    let coordinates_checked = read_back(&text, &names, &tracings, &lines)?;
    anyhow::ensure!(coordinates_checked == names.len() * 19 * 2, "checked {coordinates_checked} coordinates, not {}", names.len() * 19 * 2);
    Ok(Built { text, films: names.len(), ceph400: n_c4, aariz: n_az, coordinates_checked, line19: lines[0].1, seconds_cold })
}

/// Reads `text` back with the app's loader and compares every name, coordinate and stored line with what was built,
/// bit for bit. Returns the coordinates checked.
pub fn read_back(text: &str, names: &[String], tracings: &[Vec<Pt>], lines: &[(Vec<usize>, f64)]) -> anyhow::Result<usize> {
    let r = ceph_model::wholefilm::parse_reference(text.as_bytes())?;
    anyhow::ensure!(r.names == names, "read back {} names, not the {} built (or in another order); refusing to finish", r.names.len(), names.len());
    anyhow::ensure!(r.tracings.len() == tracings.len(), "read back {} tracings, built {}", r.tracings.len(), tracings.len());
    let mut checked = 0usize;
    for ((n, want), got) in names.iter().zip(tracings).zip(&r.tracings) {
        anyhow::ensure!(got.len() == want.len(), "{n}: read back {} points, built {}", got.len(), want.len());
        for (k, (w, g)) in want.iter().zip(got).enumerate() {
            anyhow::ensure!(w.0.to_bits() == g.0.to_bits() && w.1.to_bits() == g.1.to_bits(),
                "{n} {}: read back ({}, {}), the dataset has ({}, {}); refusing to finish", ORDER[k], g.0, g.1, w.0, w.1);
            checked += 2;
        }
    }
    anyhow::ensure!(r.lines.len() == lines.len(), "read back {} stored lines, fitted {}", r.lines.len(), lines.len());
    for ((ws, wl), (gs, gl)) in lines.iter().zip(&r.lines) {
        anyhow::ensure!(ws == gs && wl.to_bits() == gl.to_bits(), "the stored line for the {} points {ws:?}: read back {gl} for {gs:?}, fitted {wl}; refusing to finish", ws.len());
    }
    Ok(checked)
}

/// The positive controls on a reference: each of its tracings mirrored (x -> -x), and each scrambled (the jaw's points
/// B, Pog, Me, Gn, Go, PogS swapped with S, N, Or, Po, Ar, PNS), scored on the full 19 against the stored full-19 line.
/// Counts only.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Controls { pub tracings: usize, pub mirrored_over: usize, pub scrambled_over: usize }
pub fn controls(r: &ceph_model::wholefilm::Reference) -> anyhow::Result<Controls> {
    let s = ceph_model::wholefilm::WholeScorer::from_reference(r)?;
    let all: Vec<usize> = (0..19).collect();
    let line = s.line_for(&all)?;
    let over = par_map(&r.tracings, |t| -> anyhow::Result<(bool, bool)> {
        let mir: Vec<Pt> = t.iter().map(|p| (-p.0, p.1)).collect();
        let mut scr = t.clone();
        for (a, b) in [(5usize, 0usize), (6, 1), (7, 2), (8, 3), (9, 18), (15, 16)] { scr.swap(a, b); }
        Ok((s.d2_of(&mir, &all)? > line, s.d2_of(&scr, &all)? > line))
    });
    let mut c = Controls { tracings: r.tracings.len(), mirrored_over: 0, scrambled_over: 0 };
    for o in over { let (m, x) = o?; c.mirrored_over += m as usize; c.scrambled_over += x as usize; }
    Ok(c)
}

/// The data checks on a reference (fix round 1, F1): how many tracings fit better mirrored than as stored, each scored
/// against the other tracings only (leave one out); and the failures of Task A's nine order and facing rules
/// (`pku::order_checks`), by rule and as the count of tracings failing any.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Sanity { pub tracings: usize, pub better_mirrored: usize, pub over_line_as_stored: usize, pub rules: Vec<(&'static str, usize)>, pub failing_any: usize }
pub fn sanity(r: &ceph_model::wholefilm::Reference) -> anyhow::Result<Sanity> {
    use ceph_model::wholefilm::{Reference, WholeScorer};
    let all: Vec<usize> = (0..19).collect();
    // The line as the file states it (or, with none stored, fitted by the same rule).
    let line = WholeScorer::from_reference(r)?.line_for(&all)?;
    let base = WholeScorer::from_reference(&Reference { lines: vec![], ..r.clone() })?;
    let idx: Vec<usize> = (0..r.tracings.len()).collect();
    let per = par_map(&idx, |&i| -> anyhow::Result<(bool, bool)> {
        let rest = base.leave_out(&[i])?;                                     // scored against the others only
        let t = &r.tracings[i];
        let mir: Vec<Pt> = t.iter().map(|p| (-p.0, p.1)).collect();       // turned over, as the shape look does
        let (d2, d2m) = (rest.d2_of(t, &all)?, rest.d2_of(&mir, &all)?);
        Ok((d2m < d2, d2 > line))
    });
    let (mut better_mirrored, mut over_line_as_stored) = (0, 0);
    for p in per { let (m, o) = p?; better_mirrored += m as usize; over_line_as_stored += o as usize; }
    let mut rules: Vec<(&'static str, usize)> = crate::pku::ORDER_RULES.iter().map(|n| (*n, 0)).collect();
    let mut failing_any = 0;
    for t in &r.tracings {
        let named: Vec<(String, f64, f64)> = ORDER.iter().zip(t).map(|(n, p)| (n.to_string(), p.0, p.1)).collect();
        let held = crate::pku::order_checks(&named);
        failing_any += held.iter().any(|(_, ok)| !ok) as usize;
        for ((_, n), (_, ok)) in rules.iter_mut().zip(&held) { *n += !ok as usize; }
    }
    Ok(Sanity { tracings: r.tracings.len(), better_mirrored, over_line_as_stored, rules, failing_any })
}

/// Information only (fix round 1, F2): the full-19 line, by the same rule, fitted fresh on subsets of the reference:
/// Ceph-400 alone, `k` random Aariz, `k` random of all, all Aariz, and all (seeded; nothing stored changes). Each row:
/// (what, tracings, line).
pub fn line_decomposition(r: &ceph_model::wholefilm::Reference, k: usize, seed: u64) -> anyhow::Result<Vec<(String, usize, f64)>> {
    use crate::chainproof::{shuffle, Rng};
    let of = |pre: &str| -> Vec<usize> { (0..r.names.len()).filter(|&i| r.names[i].starts_with(pre)).collect() };
    let pick = |mut v: Vec<usize>, salt: u64| -> Vec<usize> { shuffle(&mut v, &mut Rng::new(seed ^ salt)); v.truncate(k); v.sort(); v };
    let (c4, az, every) = (of("ceph400:"), of("aariz:"), (0..r.names.len()).collect::<Vec<_>>());
    let sets: Vec<(String, Vec<usize>)> = vec![
        ("Ceph-400 alone".into(), c4),
        (format!("random Aariz (seed {seed})"), pick(az.clone(), 1)),
        (format!("random of all (seed {seed})"), pick(every.clone(), 2)),
        ("all Aariz".into(), az),
        ("all".into(), every),
    ];
    let all19: Vec<usize> = (0..19).collect();
    let lines = par_map(&sets, |(_, idx)| -> anyhow::Result<f64> {
        ceph_model::wholefilm::WholeScorer::new(idx.iter().map(|&i| r.tracings[i].clone()).collect())?.line_for(&all19)
    });
    sets.into_iter().zip(lines).map(|((w, idx), l)| Ok((w, idx.len(), l?))).collect()
}

/// How many of the reference's Aariz names fall in each slice of the pinned SC-1 split (teach, hold-out, tuning) and
/// how many in none. Names of other datasets are not counted.
pub fn slices(names: &[String], split: &crate::sc1_data::Split) -> (usize, usize, usize, usize) {
    let mut c = (0, 0, 0, 0);
    for id in names.iter().filter_map(|n| n.strip_prefix("aariz:")) {
        if split.teach.iter().any(|x| x == id) { c.0 += 1 } else if split.holdout.iter().any(|x| x == id) { c.1 += 1 }
        else if split.tuning.iter().any(|x| x == id) { c.2 += 1 } else { c.3 += 1 }
    }
    c
}

/// `--sc1-reference` writes only under a folder named `models` (git-ignored; never committed, bundled or uploaded), and
/// never over Stage A's `ceph400-v1.shape` (pinned `106a45e3…ccb66`; SC1-1a used it).
pub fn check_out(out: &Path) -> anyhow::Result<()> {
    let under_models = out.parent().is_some_and(|p| p.components().any(|c| c.as_os_str() == "models"));
    anyhow::ensure!(under_models, "{}: the whole-film reference goes in the git-ignored models folder (models/shape/whole-film-reference-v1.shape)", out.display());
    anyhow::ensure!(out.file_name().is_none_or(|n| n != "ceph400-v1.shape"),
        "{}: ceph400-v1.shape is Stage A's file (pinned 106a45e3…ccb66, used by SC1-1a); the whole-film reference never overwrites it", out.display());
    Ok(())
}

#[cfg(test)]
#[path = "sc1_reference_tests.rs"]
mod tests;
