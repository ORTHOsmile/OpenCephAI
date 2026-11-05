//! Spec 2026-11-02 §14.13 U6: the app's copy of the shape model (ceph-model) gives the bench's numbers to the last bit.
//! Positive control: in crates/ceph-model/src/shape.rs change `self.mu_used.len() - 4` in `tail` to `- 2` → fails.
use ceph_bench::shape as bench;
use ceph_model::shape as app;

fn subsets() -> Vec<Vec<usize>> {
    // all 18 others; 12, 14 and 17 others (points not found); S (0) and N (1) absent
    vec![(1..19).collect(), (0..19).filter(|&j| j != 1).collect(), (2..14).collect(), (3..17).collect(),
         (0..19).filter(|&j| j != 5 && j != 9).collect()]
}

#[test] fn the_app_copy_gives_the_bench_numbers_bit_for_bit() {
    let mut compared = 0usize;
    for seed in [4u64, 11, 20261029] {
        let train = app::synthetic_faces(240, seed);
        let faces = app::synthetic_faces(40, seed + 1);
        for used in subsets() {
            for k in (0..19).filter(|k| !used.contains(k)) {
                let a = app::fit_conditional(&train, k, &used).unwrap();
                let b = bench::fit_conditional(&train, k, &used).unwrap();
                for f in &faces {
                    let others: Vec<(f64, f64)> = used.iter().map(|&j| f[j]).collect();
                    for p in [f[k], (f[k].0 + 100.0, f[k].1), (f[k].0, f[k].1 - 150.0)] {
                        assert_eq!(a.tail(&others, p).to_bits(), b.tail(&others, p).to_bits(), "seed {seed} k {k} used {used:?}");
                        let ((ad, ac), (bd, bc)) = (a.d2(&others, p), b.d2(&others, p));
                        assert_eq!((ad.to_bits(), ac.0.to_bits(), ac.1.to_bits()), (bd.to_bits(), bc.0.to_bits(), bc.1.to_bits()));
                        compared += 1;
                    }
                    assert_eq!(a.sd_px(&others).to_bits(), b.sd_px(&others).to_bits());
                }
            }
        }
    }
    eprintln!("compared {compared} tails");
    // 16 fits (k=0; k=1; 7 points outside 2..14; 5 outside 3..17; 5 and 9) × 40 faces × 3 probes × 3 seeds.
    assert_eq!(compared, 5_760, "the instrument compared {compared}, not the 5,760 it should");
}

/// Spec U6 / pre-flight F7: the app's restated `check` is the bench's `check` with no move line (FT-2b's flag-only),
/// flagged points, order, tails, film-unusual and not-run all bit for bit, on SYNTHETIC faces with a point planted at
/// every position. The bench side's lines are FT-2b's literals, never the app's constants, so a moved app constant
/// fails here too. `present` is checked against a count made here (the bench's outcome does not carry it).
/// Positive controls: in ceph-model `check` change `0..=l.rounds` to `0..l.rounds` → fails; change the app's
/// `FLAG_LINE` (even 0.0002 → 0.0003) or `MIN_POINTS` → fails; change `present.len() < l.min_points` to `<=` → fails
/// (the 12-point faces). The test also checks itself: some runs must change with the line at 0.0003 (a fixed
/// 18 mm plant gives none, which is why the plant distance varies) and some must come out clean.
#[test] fn the_app_check_is_the_bench_check_with_no_move_line() {
    use ceph_bench::pointcheck as b;
    use ceph_model::pointcheck as a;
    let train = app::synthetic_faces(240, 4);
    let (sa, sb) = (a::ShapeScorer::new(train.clone()), b::ShapeScorer::new(train));
    // FT-2b's pre-registered lines, written out: flag 0.0002, 3 rounds, 12 points; no move line, no candidate spots.
    let lb = b::Lines { flag: 0.0002, mv: 0.0, qualify: 1.0, rounds: 3, min_points: 12 };
    let (mut runs, mut not_run, mut film, mut flagged, mut at_12, mut line_seen) = (0usize, 0usize, 0usize, 0usize, 0usize, 0usize);
    for (i, f) in app::synthetic_faces(25, 77).iter().enumerate() {
        for k in 0..19 {
            let mut pts: Vec<Option<(f64, f64)>> = f.iter().map(|p| Some(*p)).collect();
            // A planted point, 5.4 to 18 mm out (0.3 to 1.0 of 150, −100 px) so some tails fall line_seen the flag line.
            let d = 0.3 + 0.05 * ((i + k) % 15) as f64;
            let p = f[k]; pts[k] = Some((p.0 + 150.0 * d, p.1 - 100.0 * d));
            match i % 5 {
                1 => pts[(k + 3) % 19] = None,                                                // a point not found
                2 => for j in [(k + 5) % 19, (k + 9) % 19, (k + 13) % 19] { let q = f[j]; pts[j] = Some((q.0, q.1 - 250.0)); } // 4 wild
                3 => for d in 1..=7 { pts[(k + d) % 19] = None; }                              // 12 present: the edge, runs
                4 => for d in 1..=8 { pts[(k + d) % 19] = None; }                              // 11 present: not run
                _ => {}
            }
            let none = vec![vec![]; 19];
            let (oa, ob) = (a::check(&sa, &pts, &a::LINES).unwrap(), b::check(&sb, &pts, &none, &lb).unwrap());
            assert!(ob.moved.is_none() && ob.reassessed.is_empty());
            let bits = |v: &[(usize, f64)]| v.iter().map(|(k, t)| (*k, t.to_bits())).collect::<Vec<_>>();
            assert_eq!((bits(&oa.flagged), oa.film_unusual, oa.not_run), (bits(&ob.flagged), ob.film_unusual, ob.not_run), "face {i} point {k}");
            let n = pts.iter().filter(|p| p.is_some()).count();
            assert_eq!(oa.present, n, "face {i} point {k}");
            if ob.not_run { not_run += 1; } else if ob.film_unusual { film += 1; } else if !ob.flagged.is_empty() { flagged += 1; }
            if n == 12 && !ob.not_run { at_12 += 1; }
            // The instrument's own check: would this run's outcome change if the flag line were 0.0003 instead of
            // 0.0002? Only such runs can see a moved line, so there must be some.
            if a::check(&sa, &pts, &a::Lines { flag: 0.0003, ..a::LINES }).unwrap() != oa { line_seen += 1; }
            runs += 1;
        }
    }
    eprintln!("runs {runs}: not run {not_run}, film unusual {film}, flagged {flagged}, run at exactly 12 points {at_12}, outcome moved by a 0.0003 line {line_seen}");
    assert_eq!(runs, 25 * 19);
    // Every branch was compared: 5 faces × 19 at 11 points (not run), 5 × 19 at 12 points (run), and some of each outcome.
    assert_eq!((not_run, at_12), (5 * 19, 5 * 19));
    assert!(film > 0 && flagged > 0, "film unusual {film}, flagged {flagged}");
    let clean = runs - not_run - film - flagged;
    assert!(clean > 0, "no clean run was compared");
    assert!(line_seen >= 5, "only {line_seen} runs change with the line at 0.0003: the comparison could not see a moved flag line");
}
