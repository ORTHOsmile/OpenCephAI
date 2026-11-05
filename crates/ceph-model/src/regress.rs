//! Part F, the weights check (owner Q4, 18 Oct): when a model's file changes, the new file is run on the older films its
//! earlier file measured, and its distance from your final point is set beside the earlier file's on the same film. It
//! never switches anything. The yardsticks are the rule's own (`crate::best`), so "worse" means what it means there.
use crate::best::{median, FLOAT_SLACK, MIN_MEDIAN_GAIN_MM, WITHIN_MM};
use serde::{Deserialize, Serialize};

/// Bump with any change to a constant or to what `summarise` counts.
pub const CHECK_VERSION: &str = "weights-check/1";
/// Films a point needs before the check can warn (owner question Q15; recommended (a): the rule's block of 30, F2).
pub const MIN_CHECK_FILMS: usize = 30;

/// One point on one older film: the earlier file's distance from your final point and the new file's (None: the new file
/// gave no point there), in mm, measured at the same moment against the same point and the same ruler.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckRow { pub case_id: String, pub landmark_id: String, pub old_mm: f64, pub new_mm: Option<f64> }

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum CheckVerdict {
    /// No film has a distance from both files.
    NoFilms,
    /// Fewer than MIN_CHECK_FILMS films: the numbers are shown, no warning can be given.
    TooFew,
    /// Median not up by 0.3 mm or more, and no fewer films within 2 mm.
    NoWorse,
    /// Worse by the rule's yardsticks: which one, or both.
    #[serde(rename_all = "camelCase")]
    Worse { median_up: bool, fewer_within: bool },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckPoint {
    pub landmark_id: String,
    /// Films with a distance from both files: the films every number below is taken over.
    pub films: usize,
    /// Films where the new file gave no point: left out of the numbers, and shown.
    pub no_new_point: usize,
    pub old_median_mm: Option<f64>, pub new_median_mm: Option<f64>,
    pub old_within: usize, pub new_within: usize,
    pub verdict: CheckVerdict,
}

/// One model's new file against its earlier one, point by point. `rows`: that model's check rows for its current file.
pub fn summarise(points: &[&str], rows: &[CheckRow]) -> Vec<CheckPoint> {
    points.iter().map(|p| {
        let mine: Vec<&CheckRow> = rows.iter().filter(|r| r.landmark_id == *p).collect();
        let (old, new): (Vec<f64>, Vec<f64>) = mine.iter().filter_map(|r| r.new_mm.map(|n| (r.old_mm, n))).unzip();
        let within = |v: &[f64]| v.iter().filter(|d| **d <= WITHIN_MM).count();
        let med = |v: &[f64]| median(v);   // median returns Option<f64> since Task 1 fix round 1 (c489ce1)
        let (om, nm, ow, nw) = (med(&old), med(&new), within(&old), within(&new));
        let verdict = match (om, nm) {
            (Some(o), Some(n)) if old.len() >= MIN_CHECK_FILMS => {
                let (median_up, fewer_within) = (n - o + FLOAT_SLACK >= MIN_MEDIAN_GAIN_MM, nw < ow);
                if median_up || fewer_within { CheckVerdict::Worse { median_up, fewer_within } } else { CheckVerdict::NoWorse }
            }
            (Some(_), Some(_)) => CheckVerdict::TooFew,
            _ => CheckVerdict::NoFilms,
        };
        CheckPoint { landmark_id: p.to_string(), films: old.len(), no_new_point: mine.len() - old.len(),
            old_median_mm: om, new_median_mm: nm, old_within: ow, new_within: nw, verdict }
    }).collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn rows(n: usize, old: impl Fn(usize) -> f64, new: impl Fn(usize) -> Option<f64>) -> Vec<CheckRow> {
        (0..n).map(|i| CheckRow { case_id: format!("c{i:03}"), landmark_id: "Go".into(), old_mm: old(i), new_mm: new(i) }).collect()
    }
    fn go(r: &[CheckRow]) -> CheckPoint { summarise(&["Go"], r).remove(0) }
    const WORSE_MEDIAN: CheckVerdict = CheckVerdict::Worse { median_up: true, fewer_within: false };
    const FEWER_WITHIN: CheckVerdict = CheckVerdict::Worse { median_up: false, fewer_within: true };

    #[test] fn the_check_constants_are_pinned() { assert_eq!((CHECK_VERSION, MIN_CHECK_FILMS), ("weights-check/1", 30)); }
    /// Positive control and its negative: a file planted 0.5 mm worse on every film must warn; the same file run again
    /// (identical distances) must not.
    #[test] fn a_file_planted_0_5_mm_worse_warns_and_the_same_file_does_not() {
        let spread = |i: usize| 1.0 + 0.03 * i as f64;
        let same = go(&rows(60, spread, |i| Some(spread(i))));
        assert_eq!((same.verdict, same.films, same.old_within, same.new_within), (CheckVerdict::NoWorse, 60, 34, 34));
        let w = go(&rows(60, spread, |i| Some(spread(i) + 0.5)));
        assert_eq!(w.verdict, CheckVerdict::Worse { median_up: true, fewer_within: true });
        assert_eq!((w.old_within, w.new_within), (34, 17));
        assert!((w.old_median_mm.unwrap() - 1.885).abs() < 1e-9 && (w.new_median_mm.unwrap() - 2.385).abs() < 1e-9);
    }
    #[test] fn a_median_up_by_exactly_0_3_mm_warns_and_0_29_does_not() {
        // Both above 2 mm, so only the median can move the verdict. 2.8 − 2.5 is 0.2999999999999998 in floating point.
        assert_eq!(go(&rows(30, |_| 2.5, |_| Some(2.8))).verdict, WORSE_MEDIAN);
        assert_eq!(go(&rows(30, |_| 2.5, |_| Some(2.79))).verdict, CheckVerdict::NoWorse);
    }
    #[test] fn one_film_fewer_within_2_mm_warns_and_exactly_2_mm_counts_as_within() {
        assert_eq!(go(&rows(30, |_| 1.9, |i| Some(if i == 7 { 2.0 } else { 1.9 }))).verdict, CheckVerdict::NoWorse);
        assert_eq!(go(&rows(30, |_| 1.9, |i| Some(if i == 7 { 2.01 } else { 1.9 }))).verdict, FEWER_WITHIN);
    }
    #[test] fn a_better_file_does_not_warn() {
        assert_eq!(go(&rows(60, |i| 2.0 + 0.01 * i as f64, |i| Some(1.5 + 0.01 * i as f64))).verdict, CheckVerdict::NoWorse);
    }
    #[test] fn twenty_nine_films_show_their_numbers_but_cannot_warn_and_none_shows_no_films() {
        let few = go(&rows(29, |_| 1.0, |_| Some(3.0)));
        assert_eq!((few.verdict, few.films, few.old_median_mm, few.new_median_mm, few.old_within, few.new_within),
            (CheckVerdict::TooFew, 29, Some(1.0), Some(3.0), 29, 0));
        let none = go(&[]);
        assert_eq!((none.verdict, none.films, none.no_new_point, none.old_median_mm), (CheckVerdict::NoFilms, 0, 0, None));
    }
    #[test] fn films_where_the_new_file_gave_no_point_are_left_out_and_counted() {
        let v = go(&rows(60, |_| 1.0, |i| if i % 6 == 0 { None } else { Some(1.0) }));
        assert_eq!((v.films, v.no_new_point, v.verdict), (50, 10, CheckVerdict::NoWorse));
        let all_gone = go(&rows(30, |_| 1.0, |_| None));
        assert_eq!((all_gone.films, all_gone.no_new_point, all_gone.verdict), (0, 30, CheckVerdict::NoFilms));
    }
    #[test] fn each_point_is_judged_on_its_own() {
        let mut r = rows(30, |_| 1.0, |_| Some(1.5));
        r.extend(rows(30, |_| 1.0, |_| Some(1.0)).into_iter().map(|mut x| { x.landmark_id = "S".into(); x }));
        let v = summarise(&["Go", "S", "N"], &r);
        assert_eq!(v.iter().map(|p| (p.landmark_id.as_str(), p.verdict)).collect::<Vec<_>>(),
            [("Go", WORSE_MEDIAN), ("S", CheckVerdict::NoWorse), ("N", CheckVerdict::NoFilms)]);
    }
    #[test] fn the_check_serialises_in_the_shape_the_screen_reads() {
        let j = serde_json::to_value(go(&rows(30, |_| 2.5, |_| Some(2.8)))).unwrap();
        assert_eq!((j["landmarkId"].as_str(), j["films"].as_u64(), j["oldMedianMm"].as_f64(), j["noNewPoint"].as_u64()), (Some("Go"), Some(30), Some(2.5), Some(0)));
        assert_eq!(j["verdict"], serde_json::json!({ "kind": "worse", "medianUp": true, "fewerWithin": false }));
    }
}
