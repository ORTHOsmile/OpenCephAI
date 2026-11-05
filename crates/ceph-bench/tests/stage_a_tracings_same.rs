//! Stage A Task 3 (spec 2026-11-02 §14.14 OQ-2 as revised): the starting-knowledge file's coordinates are the bench's
//! training tracings exactly, and the app's check built from the file gives the bench's flags. SYNTHETIC data folder
//! only (never the real data/).
//! Positive control: in ceph-model `prior_json`, write each coordinate as `f32` → both tests fail.
use ceph_bench::{dataset, shape_prior};
use ceph_model::pointcheck::{parse_prior, ORDER};

fn tracings(data: &std::path::Path) -> Vec<Vec<(f64, f64)>> {
    let gt = dataset::load_points(&data.join("gt.csv")).unwrap();
    let s = dataset::load_splits(&data.join("splits.json")).unwrap();
    let ids: Vec<String> = dataset::select(&s, "train").unwrap().into_iter().chain(dataset::select(&s, "test1").unwrap()).collect();
    ids.iter().map(|id| ORDER.iter().map(|n| { let r = gt[id].iter().find(|r| r.0 == *n).unwrap(); (r.1, r.2) }).collect()).collect()
}

#[test] fn every_coordinate_equals_the_bench_tracings_bit_for_bit() {
    let t = tempfile::tempdir().unwrap();
    let data = shape_prior::write_synthetic_ceph400(t.path()).unwrap();
    let p = parse_prior(shape_prior::build(&data).unwrap().as_bytes()).unwrap();
    let want = tracings(&data);
    assert_eq!(p.tracings.len(), want.len());
    let mut compared = 0usize;
    for (a, b) in p.tracings.iter().zip(&want) {
        assert_eq!(a.len(), 19);
        for (x, y) in a.iter().zip(b) { assert_eq!((x.0.to_bits(), x.1.to_bits()), (y.0.to_bits(), y.1.to_bits())); compared += 2; }
    }
    eprintln!("coordinates compared bit for bit: {compared}");
    assert_eq!(compared, 300 * 19 * 2, "the instrument compared {compared}, not 11,400");
}

/// The app's `check` with `ShapeScorer::from_prior` (the file) against the bench's `pointcheck::check` with
/// `ShapeScorer::new` on the dataset's tracings, move line 0 and no candidate spots (FT-2b's literal lines): planted runs,
/// flagged ids, order, tails, film-unusual and not-run, bit for bit.
#[test] fn the_app_check_from_the_file_gives_the_bench_flags() {
    use ceph_bench::pointcheck as b;
    use ceph_model::pointcheck as a;
    let t = tempfile::tempdir().unwrap();
    let data = shape_prior::write_synthetic_ceph400(t.path()).unwrap();
    let train = tracings(&data);
    let sa = a::ShapeScorer::from_prior(&parse_prior(shape_prior::build(&data).unwrap().as_bytes()).unwrap());
    let sb = b::ShapeScorer::new(train.clone());
    let lb = b::Lines { flag: 0.0002, mv: 0.0, qualify: 1.0, rounds: 3, min_points: 12 };
    let faces = ceph_model::shape::synthetic_faces(8, 91);
    let (mut runs, mut flagged, mut film, mut not_run, mut clean) = (0usize, 0usize, 0usize, 0usize, 0usize);
    for (i, f) in faces.iter().enumerate() {
        for k in 0..19 {
            let mut pts: Vec<Option<(f64, f64)>> = f.iter().map(|p| Some(*p)).collect();
            let d = 0.3 + 0.1 * ((i + k) % 8) as f64;
            pts[k] = Some((f[k].0 + 150.0 * d, f[k].1 - 100.0 * d));
            match i % 4 {
                1 => pts[(k + 3) % 19] = None,
                2 => for j in [(k + 5) % 19, (k + 9) % 19, (k + 13) % 19] { pts[j] = Some((f[j].0, f[j].1 - 250.0)); },
                3 => for d in 1..=8 { pts[(k + d) % 19] = None; },
                _ => {}
            }
            let (oa, ob) = (a::check(&sa, &pts, &a::LINES).unwrap(), b::check(&sb, &pts, &vec![vec![]; 19], &lb).unwrap());
            let bits = |v: &[(usize, f64)]| v.iter().map(|(k, t)| (*k, t.to_bits())).collect::<Vec<_>>();
            assert_eq!((bits(&oa.flagged), oa.film_unusual, oa.not_run), (bits(&ob.flagged), ob.film_unusual, ob.not_run), "face {i} point {k}");
            if ob.not_run { not_run += 1 } else if ob.film_unusual { film += 1 } else if ob.flagged.is_empty() { clean += 1 } else { flagged += 1 }
            runs += 1;
        }
    }
    eprintln!("runs compared {runs}: flagged {flagged}, film unusual {film}, not run {not_run}, clean {clean}");
    assert_eq!(runs, 8 * 19);
    assert!(flagged > 0 && film > 0 && not_run > 0, "every branch must be compared");
}
