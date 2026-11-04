//! The cross-check's pass mark (owner O1), pre-registered in docs/prereg/2026-10-13-crosscheck-pass-rule.md.
use crate::stats::Ci;

pub const PASS_RULE_VERSION: &str = "crosscheck-pass/1";
pub const ERROR_CUT_MM: f64 = 2.0;
pub const SENS_MIN: f64 = 0.90;
pub const SENS_LO_MIN: f64 = 0.80;
pub const BURDEN_MAX: f64 = 0.30;
pub const AUROC_LO_ABOVE: f64 = 0.5;
pub const SEED: u64 = 20_261_013;
pub const RESAMPLES: usize = 2000;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct Verdict { pub pass: bool, pub failed: Vec<String> }

/// All of O1's lines must hold; each one that does not is named in plain words. Each line is written as "passes only
/// if", so a value that is not a number (NaN) fails it rather than slipping through.
pub fn verdict(sensitivity: &Ci, burden: f64, auroc: &Ci) -> Verdict {
    let mut failed = Vec::new();
    if !(sensitivity.estimate >= SENS_MIN) { failed.push(format!("caught {:.1}% of points more than 2 mm off (needs at least 90%)", sensitivity.estimate * 100.0)); }
    if !(sensitivity.lo >= SENS_LO_MIN) { failed.push(format!("the lower end of that catch rate is {:.1}% (needs at least 80%)", sensitivity.lo * 100.0)); }
    if !(burden <= BURDEN_MAX) { failed.push(format!("flagged {:.1}% of checked points (allowed at most 30%)", burden * 100.0)); }
    if !(auroc.lo > AUROC_LO_ABOVE) { failed.push(format!("the AUROC's lower end is {:.3} (must be above 0.5)", auroc.lo)); }
    Verdict { pass: failed.is_empty(), failed }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stats::Ci;
    const PREREG_RAW: &str = include_str!("../../../docs/prereg/2026-10-13-crosscheck-pass-rule.md");
    /// The prereg with every run of spaces and line breaks made one space, so a phrase the Markdown wraps still matches.
    static PREREG_FLAT: std::sync::LazyLock<String> = std::sync::LazyLock::new(|| PREREG_RAW.split_whitespace().collect::<Vec<_>>().join(" "));
    fn ci(e: f64, lo: f64) -> Ci { Ci { estimate: e, lo, hi: e, resamples: 2000, resamples_used: 2000 } }
    #[test] fn the_code_uses_exactly_the_pre_registered_values() {
        for s in [format!("Pass rule version: `{PASS_RULE_VERSION}`"), format!("more than `{ERROR_CUT_MM:.1}` mm"), format!("at least `{SENS_MIN:.2}`"),
            format!("at least `{SENS_LO_MIN:.2}`"), format!("at most `{BURDEN_MAX:.2}`"), format!("above `{AUROC_LO_ABOVE}`"), format!("Seed: `{SEED}`"), format!("Resamples: `{RESAMPLES}`")] {
            assert!(PREREG_FLAT.contains(&s), "the prereg document does not say {s:?}");
        }
    }
    #[test] fn exactly_on_each_line_passes_except_auroc_which_must_be_above() {
        assert!(verdict(&ci(0.90, 0.80), 0.30, &ci(0.7, 0.51)).pass);
        let v = verdict(&ci(0.90, 0.80), 0.30, &ci(0.7, 0.50));
        assert_eq!((v.pass, v.failed.len()), (false, 1));
        assert!(v.failed[0].contains("AUROC"), "{:?}", v.failed);
    }
    /// Just over each line, one at a time: each fails alone, and is named.
    #[test] fn just_past_each_line_fails_that_line_only() {
        let a = ci(0.7, 0.51);
        for (v, word) in [(verdict(&ci(0.8999, 0.80), 0.30, &a), "caught"), (verdict(&ci(0.90, 0.7999), 0.30, &a), "lower end of that catch"),
            (verdict(&ci(0.90, 0.80), 0.3001, &a), "flagged")] {
            assert!(!v.pass && v.failed.len() == 1 && v.failed[0].contains(word), "{v:?}");
        }
    }
    /// VOTERS-2: the pass rule is about the same two voters as the pinned rule file; a change to either fails here.
    #[test] fn the_prereg_names_the_voters_of_the_pinned_rule_file() {
        let v = &ceph_infer::crosscheck::params().voters;
        assert!(PREREG_FLAT.contains(&format!("Voters: {}", v.iter().map(|m| format!("`{m}`")).collect::<Vec<_>>().join(", "))), "{v:?}");
    }
    /// The same check against a rule file with other voters must fail (the guard can fail).
    #[test] fn a_rule_file_with_other_voters_does_not_match_the_prereg() {
        let other = ceph_infer::crosscheck::parse_params(&ceph_infer::crosscheck::DRAFT_JSON.replace(r#""voters": ["srpose-cldet23", "aariz-cepha29"]"#, r#""voters": ["srpose-cldet23", "gu2net-isbi19"]"#)).unwrap();
        assert!(!PREREG_FLAT.contains(&format!("Voters: {}", other.voters.iter().map(|m| format!("`{m}`")).collect::<Vec<_>>().join(", "))));
    }
    /// A number that is not a number (NaN, a broken run) must never pass: every comparison with NaN is false, so a rule
    /// written as "fail if below" would wave it through.
    #[test] fn a_value_that_is_not_a_number_fails_its_line() {
        let ok = ci(0.95, 0.85);
        assert!(!verdict(&ci(f64::NAN, 0.85), 0.2, &ci(0.7, 0.6)).pass);
        assert!(!verdict(&ci(0.95, f64::NAN), 0.2, &ci(0.7, 0.6)).pass);
        assert!(!verdict(&ok, f64::NAN, &ci(0.7, 0.6)).pass);
        assert!(!verdict(&ok, 0.2, &ci(0.7, f64::NAN)).pass);
        assert_eq!(verdict(&ci(f64::NAN, f64::NAN), f64::NAN, &ci(f64::NAN, f64::NAN)).failed.len(), 4);
    }
    #[test] fn every_failed_line_is_named() {
        let v = verdict(&ci(0.85, 0.70), 0.40, &ci(0.55, 0.45));
        assert_eq!(v.failed.len(), 4, "{:?}", v.failed);
        assert!(!v.pass);
    }
}
