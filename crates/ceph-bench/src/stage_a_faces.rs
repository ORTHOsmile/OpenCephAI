//! Spec 2026-11-02 §14.13 U6: the app's synthetic faces are the bench's, number for number.
//! Positive control: change the first constant in ceph-model's `synthetic::Rng::next` → this fails.
#[test] fn the_app_synthetic_faces_are_the_bench_faces_bit_for_bit() {
    let mut compared = 0usize;
    for (n, seed) in [(1usize, 5u64), (60, 4), (240, 20261029)] {
        let (b, a) = (crate::shape::synthetic::faces(n, seed), ceph_model::shape::synthetic_faces(n, seed));
        assert_eq!(a.len(), b.len());
        for (fa, fb) in a.iter().zip(&b) {
            for (p, q) in fa.iter().zip(fb) { assert_eq!((p.0.to_bits(), p.1.to_bits()), (q.0.to_bits(), q.1.to_bits()), "seed {seed}"); compared += 1; }
        }
    }
    assert_eq!(compared, (1 + 60 + 240) * 19);
}

/// Ruled departures (a) and (b1): ceph-model's tests use its own copies of `chainproof::Rng` and `ft_common::median`.
/// Positive control: change the first constant in ceph-model's `synthetic::Rng::next`, or the even-length average in
/// its `synthetic::median` → this fails.
#[test] fn the_app_stream_and_median_are_the_bench_ones() {
    use ceph_model::shape::synthetic as app;
    let mut compared = 0usize;
    for seed in [0u64, 4, 20261029, u64::MAX] {
        let (mut a, mut b) = (app::Rng::new(seed), crate::chainproof::Rng::new(seed));
        for _ in 0..1000 { assert_eq!(a.next(), b.next(), "seed {seed}"); compared += 1; }
    }
    assert_eq!(compared, 4000);
    let lists: [&[f64]; 6] = [&[3.0], &[2.0, 1.0], &[5.0, -1.0, 0.25, 7.5], &[1.0, f64::INFINITY, -0.0, 0.0, 9.0], &[], &[1.0, f64::NAN]];
    for v in lists {
        match (app::median(v), crate::ft_common::median(v)) {
            (Ok(x), Ok(y)) => assert_eq!(x.to_bits(), y.to_bits(), "{v:?}"),
            (Err(x), Err(y)) => assert_eq!(x.to_string(), y.to_string(), "{v:?}"),
            (x, y) => panic!("{v:?}: app {x:?}, bench {y:?}"),
        }
    }
    assert!(app::median(&[]).is_err() && app::median(&[1.0, f64::NAN]).is_err(), "control: empty and NaN are refused");
}
