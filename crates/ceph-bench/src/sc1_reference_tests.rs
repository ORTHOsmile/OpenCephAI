//! Task B's tests (SYNTHETIC folders only; never data/ or models/). Each test names the production change that would
//! make it fail.
use super::*;
use ceph_model::pointcheck::ORDER;
use ceph_model::wholefilm::{parse_reference, Reference, WholeScorer};
use std::path::PathBuf;
use std::sync::OnceLock;

/// A SYNTHETIC Aariz folder `<root>/data/aariz`: `train` 20 films (tr-0001…), `valid` 5 (va-…), `test` 5 (te-…), all in
/// gt.csv. Valid's faces are shifted by 7,000 px and test's by 9,000 px, so any of their numbers in a file stands out.
fn write_synthetic_aariz(root: &Path) -> PathBuf {
    let a = root.join("data").join("aariz");
    std::fs::create_dir_all(&a).unwrap();
    let ids = |p: &str| (1..=match p { "tr" => 20, _ => 5 }).map(|i| format!("{p}-{i:04}")).collect::<Vec<_>>();
    let (tr, va, te) = (ids("tr"), ids("va"), ids("te"));
    let faces = ceph_model::shape::synthetic_faces(30, 2026_11_05);
    let mut gt = String::from("image_id,landmark,x,y\n");
    for (i, id) in tr.iter().chain(&va).chain(&te).enumerate() {
        let shift = if i >= 25 { 9000.0 } else if i >= 20 { 7000.0 } else { 0.0 };
        for (n, p) in ORDER.iter().zip(&faces[i]) { gt += &format!("{id},{n},{},{}\n", p.0 + shift, p.1 + shift); }
        // Aariz's extra points (29 in all) are in gt.csv too; the builder picks the 19 by name.
        gt += &format!("{id},U6,{},{}\n", faces[i][4].0 + shift + 3.0, faces[i][4].1 + shift + 40.0);
    }
    std::fs::write(a.join("gt.csv"), gt).unwrap();
    std::fs::write(a.join("splits.json"), serde_json::json!({"train": tr, "valid": va, "test": te}).to_string()).unwrap();
    a
}
struct Fx { _d: tempfile::TempDir, c400: PathBuf, aariz: PathBuf, valid_ids: Vec<String>, test_ids: Vec<String> }
fn fx() -> Fx {
    let d = tempfile::tempdir().unwrap();
    let c400 = crate::shape_prior::write_synthetic_ceph400(d.path()).unwrap();
    let aariz = write_synthetic_aariz(d.path());
    let ids = |p: &str| (1..=5).map(|i| format!("{p}-{i:04}")).collect::<Vec<_>>();
    Fx { _d: d, c400, aariz, valid_ids: ids("va"), test_ids: ids("te") }
}
/// Built once (the 20 lines cost 20 leave-one-out passes over 320 tracings).
fn built() -> &'static (Fx, Built) {
    static B: OnceLock<(Fx, Built)> = OnceLock::new();
    B.get_or_init(|| { let f = fx(); let b = build(&f.c400, &f.aariz).unwrap(); (f, b) })
}

/// Spec §17.4, R1b-4. Fails if: Aariz valid or test is read, the tuning slice is left out (here: any train film), the
/// Ceph-400 train or test1 films are not all there, Test2 is read, or names lose their dataset.
#[test] fn the_reference_holds_ceph400_300_and_all_aariz_train_by_name() {
    let (f, b) = built();
    let r = parse_reference(b.text.as_bytes()).unwrap();
    eprintln!("films {} (ceph400 {}, aariz {}), coordinates checked {}, full-19 line {}, cold {:.1} s", b.films, b.ceph400, b.aariz, b.coordinates_checked, b.line19, b.seconds_cold);
    assert_eq!(r.names.len(), 300 + 20);
    assert_eq!((b.films, b.ceph400, b.aariz, b.coordinates_checked), (320, 300, 20, 320 * 19 * 2));
    assert!(r.names.iter().all(|n| n.starts_with("ceph400:") || n.starts_with("aariz:")));
    assert!(!r.names.iter().any(|n| n == "ceph400:301"));
    assert!(!r.names.iter().any(|n| f.valid_ids.iter().chain(&f.test_ids).any(|v| n.ends_with(v.as_str()))));
    assert_eq!((r.names[0].as_str(), r.names[299].as_str(), r.names[300].as_str(), r.names[319].as_str()), ("ceph400:001", "ceph400:300", "aariz:tr-0001", "aariz:tr-0020"));
    let biggest = r.tracings.iter().flatten().fold(0f64, |m, q| m.max(q.0).max(q.1));
    assert!(biggest < 4000.0, "a coordinate {biggest} is from Test2, Aariz valid or Aariz test");
    assert_eq!(b.line19, r.lines[0].1);
}
/// Spec §17.4 "the line rule unchanged". Fails if: a stored line is not WholeScorer's own line for that point set
/// (another set's, another percentile, or not leave-one-out).
#[test] fn the_stored_lines_equal_the_leave_one_out_rule() {
    let r = parse_reference(built().1.text.as_bytes()).unwrap();
    let fresh = WholeScorer::from_reference(&Reference { lines: vec![], ..r.clone() }).unwrap();   // nothing seeded: fitted fresh
    let got = par_map(&r.lines, |(set, _)| fresh.line_for(set).unwrap());
    for ((set, line), f) in r.lines.iter().zip(&got) { assert_eq!(line.to_bits(), f.to_bits(), "{set:?}") }
    assert_eq!(r.lines.len(), 20);
    assert_eq!(r.lines.iter().map(|l| l.0.clone()).collect::<Vec<_>>(), ceph_model::wholefilm::stored_line_sets());
}
/// The read-back control. Fails if `read_back` does not compare the lines (a line one ULP off passes) or the
/// coordinates (one coordinate one ULP off passes), or compares by value text rather than bits.
#[test] fn a_line_or_a_coordinate_one_ulp_off_is_refused_on_read_back() {
    let b = &built().1;
    let r = parse_reference(b.text.as_bytes()).unwrap();
    assert_eq!(read_back(&b.text, &r.names, &r.tracings, &r.lines).unwrap(), 320 * 19 * 2);
    let mut lines = r.lines.clone();
    lines[3].1 = f64::from_bits(lines[3].1.to_bits() + 1);
    let off = ceph_model::wholefilm::reference_json(&r.names, &r.tracings, &lines).unwrap();
    let e = format!("{:#}", read_back(&off, &r.names, &r.tracings, &r.lines).unwrap_err());
    eprintln!("a stored line one ULP off: {e}");
    assert!(e.contains("line"), "{e}");
    let mut tr = r.tracings.clone();
    tr[310][9].1 = f64::from_bits(tr[310][9].1.to_bits() + 1);
    let off = ceph_model::wholefilm::reference_json(&r.names, &tr, &r.lines).unwrap();
    let e = format!("{:#}", read_back(&off, &r.names, &r.tracings, &r.lines).unwrap_err());
    eprintln!("a coordinate one ULP off: {e}");
    assert!(e.contains("aariz:tr-0011") && e.contains("Go"), "{e}");
}
/// Positive control (Task B): a mirrored and a scrambled tracing still score over the line. Fails if the mirror is not a
/// mirror, the scramble is a no-op, or the counts compare against something other than the full-19 line.
#[test] fn mirrored_and_scrambled_tracings_score_over_the_line() {
    let r = parse_reference(built().1.text.as_bytes()).unwrap();
    let c = controls(&r).unwrap();
    eprintln!("controls on the SYNTHETIC reference: {c:?}");
    assert_eq!(c, Controls { tracings: 320, mirrored_over: 320, scrambled_over: 320 });
}
/// Edge case: an Aariz train film missing Go is refused, with the count. Fails if a film short of a point is skipped or
/// built from what is left.
#[test] fn an_aariz_train_film_missing_go_is_refused_with_the_count() {
    let f = fx();
    let p = f.aariz.join("gt.csv");
    let t = std::fs::read_to_string(&p).unwrap();
    std::fs::write(&p, t.lines().filter(|l| !l.starts_with("tr-0007,Go,")).map(|l| format!("{l}\n")).collect::<String>()).unwrap();
    let e = format!("{:#}", build(&f.c400, &f.aariz).err().unwrap());
    eprintln!("Aariz train film without Go: {e}");
    assert!(e.contains("1 Aariz train film(s)") && e.contains("Go on 1"), "{e}");
}
/// Edge case: a Ceph-400 train film with a duplicate N row is refused, naming the film. Fails if the first (or last) row
/// were taken silently.
#[test] fn a_ceph400_train_film_with_a_duplicate_n_row_is_refused() {
    let f = fx();
    let p = f.c400.join("gt.csv");
    let mut t = std::fs::read_to_string(&p).unwrap();
    let row = t.lines().find(|l| l.starts_with("042,N,")).unwrap().to_string();
    t += &format!("{row}\n");
    std::fs::write(&p, t).unwrap();
    let e = format!("{:#}", build(&f.c400, &f.aariz).err().unwrap());
    eprintln!("Ceph-400 train film 042 with N twice: {e}");
    assert!(e.contains("ceph400:042") && e.contains("2 rows for N"), "{e}");
}
/// Edge case: the folders must be what they say. Fails if PKU (or Ceph-400) is accepted as the Aariz folder, or a Test2
/// film planted in Ceph-400's train list reaches the file.
#[test] fn the_wrong_folder_or_a_test2_film_is_refused_before_any_tracing_is_read() {
    let f = fx();
    let pku = f.aariz.parent().unwrap().join("pku");
    std::fs::create_dir_all(&pku).unwrap();
    let e = format!("{:#}", build(&f.c400, &pku).err().unwrap());
    eprintln!("PKU given as Aariz: {e}");
    assert!(e.contains("Aariz"), "{e}");
    let e = format!("{:#}", build(&f.c400, &f.c400).err().unwrap());
    eprintln!("Ceph-400 given as Aariz: {e}");
    assert!(e.contains("Aariz"), "{e}");
    let mut s: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(f.c400.join("splits.json")).unwrap()).unwrap();
    s["train"][3] = "333".into();
    std::fs::write(f.c400.join("splits.json"), s.to_string()).unwrap();
    let e = format!("{:#}", build(&f.c400, &f.aariz).err().unwrap());
    eprintln!("Test2 film 333 planted in train: {e}");
    assert!(e.contains("Test2"), "{e}");
}
/// Fails if `--sc1-reference` accepted an output outside a folder named `models`, or Stage A's file name.
#[test] fn the_output_is_under_models_and_never_stage_as_file() {
    assert!(check_out(Path::new("models/shape/whole-film-reference-v1.shape")).is_ok());
    for bad in ["reports/whole-film-reference-v1.shape", "x.shape", "/tmp/x.shape"] {
        let e = check_out(Path::new(bad)).unwrap_err().to_string();
        eprintln!("{bad}: {e}");
        assert!(e.contains("models"), "{e}");
    }
    let e = check_out(Path::new("models/shape/ceph400-v1.shape")).unwrap_err().to_string();
    eprintln!("Stage A's file: {e}");
    assert!(e.contains("ceph400-v1.shape") && e.contains("Stage A"), "{e}");
}
/// Fails if a slice is miscounted, or a name outside the split is not counted as outside.
#[test] fn slices_count_the_aariz_names_by_the_pinned_split() {
    let split = crate::sc1_data::Split { version: "x".into(), seed: 0, rule: "x".into(), dataset: "aariz".into(),
        teach: vec!["a".into(), "b".into()], holdout: vec!["c".into()], tuning: vec!["d".into()] };
    let names: Vec<String> = ["ceph400:001", "aariz:a", "aariz:b", "aariz:c", "aariz:d", "aariz:e"].iter().map(|s| s.to_string()).collect();
    assert_eq!(slices(&names, &split), (2, 1, 1, 1));
}

// ---- Fix round 1 (review F1, F2, F4) ----

/// F1. On a clean SYNTHETIC reference nothing fits better mirrored and no order rule fails; one tracing planted facing
/// left (mirrored about x = 2,400) is counted once, and one with ANS and PNS swapped fails that rule once. Fails if the
/// mirrored count compares the wrong pair (d2 against itself), the counts score a tracing against a set that includes it
/// (the over-the-line count then differs from an independent leave-one-out recomputation), or the order rules are not
/// run on every tracing.
#[test] fn sanity_counts_a_left_facing_and_a_swapped_tracing_and_nothing_on_a_clean_reference() {
    let r = parse_reference(built().1.text.as_bytes()).unwrap();
    let clean = sanity(&r).unwrap();
    eprintln!("clean SYNTHETIC reference: {clean:?}");
    assert_eq!((clean.tracings, clean.better_mirrored, clean.failing_any), (320, 0, 0));
    assert_eq!(clean.rules.len(), 9);
    assert!(clean.rules.iter().all(|(_, n)| *n == 0));
    // Leave one out, recomputed independently: each tracing scored by a scorer built without it.
    let all: Vec<usize> = (0..19).collect();
    let over = par_map(&(0..r.tracings.len()).collect::<Vec<_>>(), |&i| {
        let rest: Vec<Vec<Pt>> = r.tracings.iter().enumerate().filter(|(j, _)| *j != i).map(|(_, t)| t.clone()).collect();
        WholeScorer::new(rest).unwrap().d2_of(&r.tracings[i], &all).unwrap() > r.lines[0].1
    }).into_iter().filter(|x| *x).count();
    assert_eq!(clean.over_line_as_stored, over, "the over-the-line count is leave-one-out");
    assert!(over >= 1, "the fixture must have a tracing over the line, or this check could not fail");
    let mut bad = Reference { lines: vec![], ..r.clone() };
    bad.tracings[5] = bad.tracings[5].iter().map(|p| (2400.0 - p.0, p.1)).collect();
    let (ans, pns) = (ORDER.iter().position(|n| *n == "ANS").unwrap(), ORDER.iter().position(|n| *n == "PNS").unwrap());
    bad.tracings[310].swap(ans, pns);
    let s = sanity(&bad).unwrap();
    eprintln!("one left-facing (ceph400:006) and one ANS/PNS swap (aariz:tr-0011): {s:?}");
    assert_eq!(s.better_mirrored, 1);
    assert_eq!(s.rules.iter().find(|(n, _)| *n == "ANS in front of PNS").unwrap().1, 2, "the left-facing one and the swapped one");
    assert!(s.failing_any >= 2);
}
/// F2, the instrument's positive control. Fails if a subset's line is not the same rule's line on exactly those
/// tracings (Ceph-400 alone must equal a scorer built from the first 300 tracings; all must equal the stored line), or
/// the random subsets are not the size asked or not seeded (same seed, same lines; another seed, another subset).
#[test] fn the_line_decomposition_reproduces_the_stored_line_and_ceph400_alone() {
    let r = parse_reference(built().1.text.as_bytes()).unwrap();
    let rows = line_decomposition(&r, 20, 7).unwrap();
    for row in &rows { eprintln!("decomposition (SYNTHETIC): {row:?}"); }
    let all: Vec<usize> = (0..19).collect();
    let c4 = WholeScorer::new(r.tracings[..300].to_vec()).unwrap().line_for(&all).unwrap();
    let get = |w: &str| rows.iter().find(|x| x.0 == w || x.0.starts_with(&format!("{w} ("))).unwrap_or_else(|| panic!("no row {w}")).clone();
    assert_eq!((get("Ceph-400 alone").1, get("Ceph-400 alone").2.to_bits()), (300, c4.to_bits()));
    assert_eq!((get("all").1, get("all").2.to_bits()), (320, r.lines[0].1.to_bits()));
    assert_eq!((get("random Aariz").1, get("random of all").1, get("all Aariz").1), (20, 20, 20));
    assert_eq!(rows, line_decomposition(&r, 20, 7).unwrap(), "seeded");
    assert_ne!(get("random of all").2.to_bits(), line_decomposition(&r, 20, 8).unwrap().iter().find(|x| x.0.starts_with("random of all")).unwrap().2.to_bits(), "another seed, another subset");
}
/// F4. Fails if the builder accepts an Aariz train list that shares a film with valid or test.
#[test] fn aariz_train_sharing_a_film_with_valid_or_test_is_refused() {
    for (other, at) in [("valid", 2usize), ("test", 4)] {
        let f = fx();
        let p = f.aariz.join("splits.json");
        let mut s: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let id = s[other][at].clone();
        s["train"].as_array_mut().unwrap().push(id);
        std::fs::write(&p, s.to_string()).unwrap();
        let e = format!("{:#}", build(&f.c400, &f.aariz).err().unwrap());
        eprintln!("Aariz train also listing a {other} film: {e}");
        assert!(e.contains("1 film(s)") && e.contains(other), "{other}: {e}");
    }
}
