//! The per-point source table (spec 2026-10-13 §5.2, owner O6/O7). Pre-registered in
//! docs/prereg/2026-10-13-main-point-source-rule.md before any comparison was run.

use crate::stats::{bootstrap, Ci};
use std::collections::BTreeMap;

pub const RULE_VERSION: &str = "main-point-source/1";
pub const SEED: u64 = 20_261_013;
pub const RESAMPLES: usize = 2000;
pub const AARIZ: &str = "aariz-cepha29";
pub const CWLACHAP: &str = "cwlachap-hrnet-w32";

/// One film's radial errors for one point, in mm at the film's own spacing: (Aariz, cwlachap).
pub type Pair = (f64, f64);

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointDecision { pub films: usize, pub mean_aariz: f64, pub mean_cwlachap: f64, pub diff: Ci, pub chosen: String }

/// The pre-registered rule for one point: cwlachap only if the whole 95% interval of (Aariz − cwlachap) is above zero.
pub fn decide_point(pairs: &[Pair]) -> anyhow::Result<PointDecision> {
    let diff = bootstrap(pairs, RESAMPLES, SEED, |s| Some(s.iter().map(|(a, c)| a - c).sum::<f64>() / s.len() as f64))?;
    let n = pairs.len() as f64;
    let chosen = if diff.lo > 0.0 { CWLACHAP } else { AARIZ };
    Ok(PointDecision { films: pairs.len(), mean_aariz: pairs.iter().map(|p| p.0).sum::<f64>() / n,
        mean_cwlachap: pairs.iter().map(|p| p.1).sum::<f64>() / n, diff, chosen: chosen.to_string() })
}

/// Every point given, each with the same seed (prereg).
pub fn decide_all(per_point: &BTreeMap<String, Vec<Pair>>) -> anyhow::Result<BTreeMap<String, PointDecision>> {
    per_point.iter().map(|(id, p)| Ok((id.clone(), decide_point(p).map_err(|e| e.context(format!("point {id}")))?))).collect()
}

/// The confirmation on Aariz test (prereg): a point fails only if its test interval lies wholly on the other side.
pub fn confirmed(chosen: &str, on_test: &Ci) -> bool {
    if chosen == CWLACHAP { on_test.hi >= 0.0 } else { on_test.lo <= 0.0 }
}

/// The 19 points every model had before Part B (owner ruling R-B2); the only points the source table covers. The app's
/// own constant, re-exported, so the bench can never drift from it (preflight c6).
pub use ceph_model::scores::ORIGINAL_19;

/// The pre-registered positive control: cwlachap's error on the point whose real mean difference is closest to zero is
/// set 2 mm lower; the rule must then give that point to cwlachap. Returns the point and whether it was named.
pub fn plant_control(per_point: &BTreeMap<String, Vec<Pair>>) -> anyhow::Result<(String, bool)> {
    let real = decide_all(per_point)?;
    let id = real.iter().min_by(|a, b| a.1.diff.estimate.abs().total_cmp(&b.1.diff.estimate.abs()))
        .map(|(id, _)| id.clone()).ok_or_else(|| anyhow::anyhow!("no points to plant on"))?;
    let planted: Vec<Pair> = per_point[&id].iter().map(|(a, c)| (*a, c - 2.0)).collect();
    Ok((id, decide_point(&planted)?.chosen == CWLACHAP))
}

/// `reference/main-point-source.json` (spec §5.2 "Output").
#[allow(clippy::too_many_arguments)]
pub fn table_json(d: &BTreeMap<String, PointDecision>, dataset: &str, split: &str, films: usize, films_sha256: &str, git_sha: &str,
    control: &str, left_out: &BTreeMap<String, usize>, providers: &BTreeMap<String, String>) -> serde_json::Value {
    serde_json::json!({
        "ruleVersion": RULE_VERSION, "seed": SEED, "resamples": RESAMPLES,
        "decidedOn": { "dataset": dataset, "split": split, "films": films, "filmsSha256": films_sha256 },
        "gitSha": git_sha,
        "providers": providers,
        "positiveControl": { "point": control, "cwlachapLoweredMm": 2.0, "named": true },
        "filmsLeftOut": left_out,
        "points": d,
        "confirmation": "pending",
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    const PREREG: &str = include_str!("../../../docs/prereg/2026-10-13-main-point-source-rule.md");
    #[test] fn the_code_uses_exactly_the_pre_registered_values() {
        assert!(PREREG.contains(&format!("Rule version: `{RULE_VERSION}`")));
        assert!(PREREG.contains(&format!("Seed: `{SEED}`")));
        assert!(PREREG.contains(&format!("Resamples: `{RESAMPLES}`")));
    }
    fn pairs(diffs: &[f64]) -> Vec<Pair> { diffs.iter().map(|d| (1.0 + d, 1.0)).collect() }
    #[test] fn aariz_keeps_a_point_unless_it_is_clearly_worse() {
        let worse: Vec<f64> = (0..150).map(|i| 0.8 + ((i % 9) as f64 - 4.0) * 0.05).collect();
        assert_eq!(decide_point(&pairs(&worse)).unwrap().chosen, CWLACHAP);
        let unclear: Vec<f64> = (0..150).map(|i| ((i % 9) as f64 - 4.0) * 0.05).collect();
        assert_eq!(decide_point(&pairs(&unclear)).unwrap().chosen, AARIZ);
        let better: Vec<f64> = (0..150).map(|i| -0.8 + ((i % 9) as f64 - 4.0) * 0.05).collect();
        assert_eq!(decide_point(&pairs(&better)).unwrap().chosen, AARIZ);
    }
    #[test] fn a_tie_and_a_lower_end_of_exactly_zero_stay_with_aariz() {
        let tie = decide_point(&pairs(&[0.0; 30])).unwrap();
        assert_eq!((tie.diff.lo, tie.chosen.as_str()), (0.0, AARIZ));
    }
    #[test] fn the_decision_reports_both_means_and_the_film_count() {
        let d = decide_point(&[(2.0, 1.0), (4.0, 1.0)]).unwrap();
        assert_eq!((d.films, d.mean_aariz, d.mean_cwlachap, d.diff.estimate), (2, 3.0, 1.0, 2.0));
    }
    #[test] fn no_films_is_an_error() { assert!(decide_point(&[]).is_err()); }
    // Pins today's behaviour, not a new rule: every resample of a single film IS that film, so the interval has
    // zero width at the one observed difference. A single film can therefore decide a point on its own (flagged in
    // review round 1; raised with the owner separately — the rule as written, prereg main-point-source/1, is
    // unchanged here).
    #[test] fn one_film_only_gives_a_zero_width_interval_and_decides_by_the_rule_as_written() {
        let worse = decide_point(&[(2.0, 1.0)]).unwrap();           // Aariz 1.0 mm worse on this one film
        assert_eq!((worse.films, worse.diff.lo, worse.diff.hi, worse.chosen.as_str()), (1, 1.0, 1.0, CWLACHAP));
        let better = decide_point(&[(1.0, 2.0)]).unwrap();          // Aariz 1.0 mm better on this one film
        assert_eq!((better.diff.lo, better.diff.hi, better.chosen.as_str()), (-1.0, -1.0, AARIZ));
    }
    #[test] fn decide_all_decides_every_point_it_is_given() {
        let m: std::collections::BTreeMap<String, Vec<Pair>> = [("S".to_string(), pairs(&[0.0; 10])), ("Go".to_string(), pairs(&[2.0; 10]))].into();
        let out = decide_all(&m).unwrap();
        assert_eq!((out["S"].chosen.as_str(), out["Go"].chosen.as_str()), (AARIZ, CWLACHAP));
    }
    #[test] fn confirmation_fails_only_when_the_test_interval_lies_wholly_on_the_other_side() {
        let ci = |lo: f64, hi: f64| crate::stats::Ci { estimate: (lo + hi) / 2.0, lo, hi, resamples: 2000, resamples_used: 2000 };
        assert!(confirmed(CWLACHAP, &ci(-0.1, 0.5)));
        assert!(!confirmed(CWLACHAP, &ci(-0.5, -0.1)));
        assert!(confirmed(CWLACHAP, &ci(-0.4, 0.0)), "an upper end of exactly 0 is not wholly below zero (preflight c3)");
        assert!(confirmed(AARIZ, &ci(-0.3, 0.2)));
        assert!(!confirmed(AARIZ, &ci(0.1, 0.4)));
        assert!(confirmed(AARIZ, &ci(0.0, 0.4)), "a lower end of exactly 0 is not wholly above zero");
    }
    // ORIGINAL_19 is ceph-model's constant re-exported (preflight c6): no literal copy, so no test of a copy.
    #[test] fn the_original_19_are_the_prereg_list() {
        assert!(PREREG.contains(&format!("(`{}`)", ORIGINAL_19.join(" "))), "the prereg names the same 19, in the app's order");
    }
    #[test] fn the_control_plants_on_the_point_closest_to_a_tie_and_the_rule_names_it() {
        let mut m: BTreeMap<String, Vec<Pair>> = BTreeMap::new();
        m.insert("S".into(), (0..150).map(|i| (1.0 + ((i % 7) as f64 - 3.0) * 0.05, 1.0)).collect());            // tie
        m.insert("Go".into(), (0..150).map(|i| (1.0 - 0.6 + ((i % 7) as f64 - 3.0) * 0.05, 1.0)).collect());     // Aariz better
        let (point, named) = plant_control(&m).unwrap();
        assert_eq!((point.as_str(), named), ("S", true));
    }
    #[test] fn the_control_reports_a_blind_instrument() {
        // Aariz 3 mm better everywhere: lowering cwlachap 2 mm cannot make Aariz worse, so the control must say so.
        let m: BTreeMap<String, Vec<Pair>> = [("S".to_string(), (0..50).map(|_| (0.5, 3.5)).collect())].into();
        assert_eq!(plant_control(&m).unwrap(), ("S".to_string(), false));
    }
    #[test] fn the_table_json_holds_what_the_spec_lists() {
        let d: BTreeMap<String, PointDecision> = [("S".to_string(), decide_point(&[(1.0, 1.0), (1.2, 1.0)]).unwrap())].into();
        let j = table_json(&d, "aariz", "valid", 150, "abc", "1234", "S", &[("S".to_string(), 0usize)].into(),
            &[(AARIZ.to_string(), "cpu".to_string()), (CWLACHAP.to_string(), "cpu".to_string())].into());
        assert_eq!(j["ruleVersion"], RULE_VERSION);
        assert_eq!(j["providers"][AARIZ], "cpu", "the runtime the decision ran on is recorded (preflight a1)");
        assert_eq!((j["seed"].as_u64(), j["resamples"].as_u64()), (Some(SEED), Some(RESAMPLES as u64)));
        assert_eq!((j["decidedOn"]["split"].as_str(), j["decidedOn"]["films"].as_u64(), j["decidedOn"]["filmsSha256"].as_str()), (Some("valid"), Some(150), Some("abc")));
        assert_eq!(j["confirmation"], "pending");
        assert_eq!(j["points"]["S"]["chosen"], AARIZ);
        assert!(j["points"]["S"]["diff"]["lo"].is_number() && j["points"]["S"]["meanAariz"].is_number());
    }
}
