//! SC-1 Part 1b: the calibration arithmetic, in one place (M27). The size look (`sc1_size`, rule `sc1-size/1`) and the
//! cranial-base centre (`sc1_cb`, Task D) both set a centre and a line from the 520 calibration films by the same written
//! rule: the centre is the nearest-rank median; the line is the worst distance from it, rounded UP to the next 0.01,
//! never below a floor; a positive control holds when at least 95% of films flag, counted in integers; and every set's
//! film count is checked against the pre-registered count (C7).

/// The calibration films, by set, with their pre-registered counts (spec §17.3): the Aariz-train hold-out, Ceph-400
/// Train 001-150, and the development films Ceph-400 Test1 151-300 and Aariz valid (R1b-5: tuned on, said so).
pub const CAL_SETS: [(&str, usize); 4] = [("holdout", 70), ("ceph400Train", 150), ("ceph400Test1", 150), ("aarizValid", 150)];

/// The median by nearest rank (500 per mille: the ⌈n/2⌉-th smallest; for [4, 1, 3, 2] that is 2, not 2.5). Sorted with
/// `total_cmp`; an empty list or a value that is not a number is refused.
pub fn median_nearest_rank(v: &[f64]) -> anyhow::Result<f64> {
    anyhow::ensure!(v.iter().all(|x| !x.is_nan()), "a value to take the median of is not a number");
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    ceph_model::wholefilm::nearest_rank(&s, 500)
}

/// The line: `worst` rounded up to the next 0.01 (0.23 stays 0.23; 0.2300001 becomes 0.24), never below `floor`. A value
/// that is not a number, or is negative, is refused.
pub fn line_rounded_up(worst: f64, floor: f64) -> anyhow::Result<f64> {
    anyhow::ensure!(worst.is_finite() && worst >= 0.0, "the worst distance must be a number at or above 0, not {worst}");
    anyhow::ensure!(floor.is_finite() && floor >= 0.0, "the floor must be a number at or above 0, not {floor}");
    Ok(crate::sc1_gate::ceil_hundredth(worst).max(floor))
}

/// A positive control holds when at least 95% of the films flag, in integers: 20 × flagged ≥ 19 × films. No films is
/// refused (a control that saw nothing proves nothing).
pub fn control_holds(flagged: usize, films: usize) -> anyhow::Result<bool> {
    anyhow::ensure!(films > 0, "a control over no films proves nothing");
    anyhow::ensure!(flagged <= films, "{flagged} flagged of {films} films");
    Ok(20 * flagged >= 19 * films)
}

/// C7 by set: every set in `want` is present in `got` with its count (each through `ft_common::counted`, so the message
/// names the set that is off), no set is extra, then the total. Returns the line for the report.
pub fn c7_by_set(got: &[(&str, usize)], want: &[(&str, usize)]) -> anyhow::Result<String> {
    for (g, _) in got { anyhow::ensure!(want.iter().any(|(w, _)| w == g), "set {g} is not a calibration set"); }
    let mut parts = Vec::new();
    for (w, n) in want {
        let k = got.iter().find(|(g, _)| g == w).map(|(_, k)| *k).unwrap_or(0);
        parts.push(crate::ft_common::counted(&format!("{w} films"), k, *n)?);
    }
    let (gt, wt) = (got.iter().map(|x| x.1).sum::<usize>(), want.iter().map(|x| x.1).sum::<usize>());
    parts.push(crate::ft_common::counted("calibration films in all", gt, wt)?);
    Ok(parts.join("; "))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Fails if: the median is the mean of the two middle values (2.5), or an empty or NaN list is accepted.
    #[test] fn median_is_the_nearest_rank_500() {
        assert_eq!(median_nearest_rank(&[4.0, 1.0, 3.0, 2.0]).unwrap(), 2.0);
        assert_eq!(median_nearest_rank(&[5.0, -1.0, 3.0]).unwrap(), 3.0);
        assert!(median_nearest_rank(&[]).is_err());
        assert!(median_nearest_rank(&[1.0, f64::NAN]).is_err());
    }
    /// Fails if: plain ceil(x·100)/100 is used (0.23 → 0.24, since 0.23·100 = 23.000000000000004), or the floor is dropped.
    #[test] fn line_is_rounded_up_with_a_floor() {
        assert_eq!(line_rounded_up(0.23, 0.05).unwrap(), 0.23);
        assert_eq!(line_rounded_up(0.2300001, 0.05).unwrap(), 0.24);
        assert_eq!(line_rounded_up(0.01, 0.05).unwrap(), 0.05);
        assert_eq!(line_rounded_up(0.0, 0.05).unwrap(), 0.05);
        assert!(line_rounded_up(f64::NAN, 0.05).is_err());
        assert!(line_rounded_up(-0.1, 0.05).is_err());
    }
    /// Fails if: `>` is used for `>=` (19 of 20 is exactly 95%), or a float rate rounds 94 of 100 up.
    #[test] fn control_is_95_percent_in_integers() {
        assert!(control_holds(19, 20).unwrap());
        assert!(!control_holds(18, 20).unwrap());
        assert!(control_holds(95, 100).unwrap());
        assert!(!control_holds(94, 100).unwrap());
        assert!(control_holds(494, 520).unwrap());    // 9880 ≥ 9880
        assert!(!control_holds(493, 520).unwrap());
        assert!(control_holds(0, 0).is_err());
    }
    /// Fails if: the counts are checked only in total (a set short and another long by the same number pass), or the
    /// message does not name the set that is off.
    #[test] fn c7_names_the_set_that_is_off() {
        let ok = [("holdout", 70), ("ceph400Train", 150), ("ceph400Test1", 150), ("aarizValid", 150)];
        let line = c7_by_set(&ok, &CAL_SETS).unwrap();
        eprintln!("C7: {line}");
        assert!(line.ends_with("calibration films in all: compared 520 (expected 520)"), "{line}");
        let swapped = [("holdout", 70), ("ceph400Train", 149), ("ceph400Test1", 151), ("aarizValid", 150)];
        let e = c7_by_set(&swapped, &CAL_SETS).unwrap_err().to_string();
        eprintln!("one short, one long: {e}");
        assert!(e.contains("ceph400Train"), "{e}");
        let e = c7_by_set(&ok[..3], &CAL_SETS).unwrap_err().to_string();
        assert!(e.contains("aarizValid"), "{e}");
        assert!(c7_by_set(&[("holdout", 70), ("ceph400Train", 150), ("ceph400Test1", 150), ("aarizValid", 150), ("pku", 1)], &CAL_SETS).is_err());
    }
}
