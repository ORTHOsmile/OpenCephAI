//! The cross-check (spec 2026-10-13 §6.2): parameters from the versioned reference/crosscheck.json, and (Task 5) the
//! pure rule. One implementation for the bench and the app. Every value here is a threshold: owner's OK to change.
use serde::Deserialize;
use std::collections::BTreeMap;

const EMBEDDED: &str = include_str!("../../../reference/crosscheck.json");

#[derive(Clone, Debug, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Params {
    pub rule_version: String, pub status: String,
    /// "not-run", "pass" or "fail" (Task 8). Anything but "pass" shows the word "experimental" (spec §6.3).
    pub test_result: String,
    pub voters: Vec<String>,
    /// Odd, ≥ 3: the square window, in heat-map cells, the spread is taken over.
    pub spread_window_cells: usize,
    pub sigma0_mm: f64, pub t_default: f64, pub t: BTreeMap<String, f64>, pub k: BTreeMap<String, f64>,
    /// Q10: mm per px on a film with no ruler.
    pub assumed_mm_per_px: f64,
}

pub fn parse_params(json: &str) -> anyhow::Result<Params> {
    let p: Params = serde_json::from_str(json)?;
    anyhow::ensure!(p.spread_window_cells >= 3 && p.spread_window_cells % 2 == 1, "spreadWindowCells must be odd and at least 3");
    anyhow::ensure!(p.sigma0_mm > 0.0 && p.t_default > 0.0 && p.assumed_mm_per_px > 0.0, "sigma0Mm, tDefault and assumedMmPerPx must be > 0");
    anyhow::ensure!(p.t.values().chain(p.k.values()).all(|v| v.is_finite() && *v > 0.0), "every T and k must be > 0");
    anyhow::ensure!(!p.voters.is_empty() && p.voters.iter().all(|v| p.k.contains_key(v)), "every voter needs a k");
    anyhow::ensure!(p.voters.len() <= 3, "the rule's group search (Task 5) handles at most three voters");
    anyhow::ensure!(["not-run", "pass", "fail"].contains(&p.test_result.as_str()), "testResult must be not-run, pass or fail");
    Ok(p)
}

pub fn params() -> &'static Params {
    static P: std::sync::OnceLock<Params> = std::sync::OnceLock::new();
    P.get_or_init(|| parse_params(EMBEDDED).expect("reference/crosscheck.json is valid (tests)"))
}

/// The spec §4 draft values (T 5.99, σ₀ 0.3 mm, k 1, window 15 cells), fixed: rule tests in every crate use these, so
/// tuning reference/crosscheck.json (Task 7) never changes what a test means.
pub const DRAFT_JSON: &str = r#"{ "ruleVersion": "crosscheck/0-draft", "status": "draft", "testResult": "not-run", "voters": ["srpose-cldet23", "aariz-cepha29"], "spreadWindowCells": 15, "sigma0Mm": 0.3, "tDefault": 5.99, "t": {}, "k": { "cwlachap-hrnet-w32": 1.0, "gu2net-isbi19": 1.0, "srpose-cldet23": 1.0, "aariz-cepha29": 1.0 }, "assumedMmPerPx": 0.1 }"#;
pub fn draft_params() -> Params { parse_params(DRAFT_JSON).expect("DRAFT_JSON is valid") }

/// One model's guess for one landmark on one film: film px, its heat-map spread in film px² (None for runs made before
/// the spread was kept).
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guess { pub model_id: String, pub x: f64, pub y: f64, pub cov: Option<[f64; 3]> }

#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
/// TooFewAnswered: fewer than two voters answered. NoSpread: a voter or the placed point has no spread, or one that is
/// not a real oval. BadScale: mm per px zero, negative or not finite (review I1).
pub enum NotCheckedWhy { TooFewAnswered, NoSpread, BadScale }
#[derive(Clone, Copy, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub enum ConflictWhy { NoTwoAgree, PlacedIsOddOneOut }
#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum Outcome { NotChecked { why: NotCheckedWhy }, Agree, Review { outside: Vec<String> }, Conflict { why: ConflictWhy } }

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Check {
    pub outcome: Outcome,
    /// Voters that answered for this landmark, of how many vote.
    pub answered: usize, pub of: usize,
    /// The placed point's largest D² to any other voter that answered (the bench's AUROC score).
    pub max_d2: Option<f64>,
    /// mm from the placed point to each voter that answered (shown beside the result, "≈" on an uncalibrated film).
    pub dist_mm: Vec<(String, f64)>,
    pub rule_version: String,
}

impl Params {
    pub fn t_for(&self, landmark: &str) -> f64 { self.t.get(landmark).copied().unwrap_or(self.t_default) }
    /// A model with no fitted k uses 1 (only possible for a model outside the catalogue: the file lists all four).
    pub fn k_for(&self, model: &str) -> f64 { self.k.get(model).copied().unwrap_or(1.0) }
    pub fn is_voter(&self, model: &str) -> bool { self.voters.iter().any(|v| v == model) }
    /// Σ_m = k_m·cov_m + σ₀² I, σ₀ converted to px with the film's scale. Public: the bench's spread-weighted average uses
    /// this same function (one formula, preflight c14). A guess with no spread (`cov: None`) gets the floor alone, the
    /// TIGHTEST possible oval: never pass one in where that matters (`check` refuses it; `real_oval` tells them apart).
    pub fn sigma(&self, g: &Guess, mm_per_px: f64) -> [f64; 3] {
        let c = g.cov.unwrap_or([0.0, 0.0, 0.0]);
        let (k, s0) = (self.k_for(&g.model_id), self.sigma0_mm / mm_per_px);
        [k * c[0] + s0 * s0, k * c[1], k * c[2] + s0 * s0]
    }
}

/// True when a spread is a real oval: every term finite, both variances ≥ 0, and |xy| ≤ √(xx·yy) (a 1e-9 relative
/// allowance for rounding; a spread along a straight line, |xy| = √(xx·yy), is real). Anything else (a corrupted
/// cache or library value) could make D² negative, which would read as "agree" (review I1).
pub fn real_oval(c: [f64; 3]) -> bool {
    c.iter().all(|v| v.is_finite()) && c[0] >= 0.0 && c[2] >= 0.0 && c[1] * c[1] <= c[0] * c[2] * (1.0 + 1e-9)
}

/// True when mm per px is a usable scale: finite and > 0.
pub fn scale_ok(mm_per_px: f64) -> bool { mm_per_px.is_finite() && mm_per_px > 0.0 }

/// D² = (p_a − p_b)ᵀ (Σ_a + Σ_b)⁻¹ (p_a − p_b). The σ₀ floor keeps the matrix invertible. Never negative: a bad scale,
/// a spread that is not a real oval, or a combined matrix that is not positive definite gives NaN ("cannot measure"),
/// which no threshold accepts.
pub fn d2(a: &Guess, b: &Guess, mm_per_px: f64, p: &Params) -> f64 {
    if !scale_ok(mm_per_px) || [a, b].iter().any(|g| g.cov.is_some_and(|c| !real_oval(c))) { return f64::NAN; }
    let (sa, sb) = (p.sigma(a, mm_per_px), p.sigma(b, mm_per_px));
    let (xx, xy, yy) = (sa[0] + sb[0], sa[1] + sb[1], sa[2] + sb[2]);
    let det = xx * yy - xy * xy;
    let (dx, dy) = (a.x - b.x, a.y - b.y);
    if !(det > 0.0 && xx > 0.0) { return f64::NAN; }
    let q = (yy * dx * dx - 2.0 * xy * dx * dy + xx * dy * dy) / det;
    if q.is_finite() { q.max(0.0) } else { f64::NAN }   // max: rounding only; the matrix is positive definite here
}

/// Spec §6.2 steps 1–7 for one landmark. `voters`: the guesses that answered for it; any guess from a model not in
/// `p.voters` (a ghost: GU2Net, cwlachap — owner VOTERS-2) is ignored here, so a careless caller cannot make a ghost
/// vote. `placed`: the point on the film and the model that placed it (a voter, or a non-voter such as cwlachap).
pub fn check(landmark: &str, placed: &Guess, voters: &[Guess], mm_per_px: f64, p: &Params) -> Check {
    let t = p.t_for(landmark);
    let voters: Vec<Guess> = voters.iter().filter(|v| p.is_voter(&v.model_id)).cloned().collect();
    let voters = voters.as_slice();
    let n = voters.len();
    if !scale_ok(mm_per_px) {
        // Review I1: no distance can be measured without a scale; the caller passes the assumed 0.1 mm/px (Q10) instead.
        return Check { outcome: Outcome::NotChecked { why: NotCheckedWhy::BadScale }, answered: n, of: p.voters.len(), max_d2: None, dist_mm: vec![], rule_version: p.rule_version.clone() };
    }
    let dist_mm: Vec<(String, f64)> = voters.iter().map(|v| (v.model_id.clone(), (v.x - placed.x).hypot(v.y - placed.y) * mm_per_px)).collect();
    let mk = |outcome: Outcome, max_d2: Option<f64>| Check { outcome, answered: n, of: p.voters.len(), max_d2, dist_mm: dist_mm.clone(), rule_version: p.rule_version.clone() };
    if n < 2 { return mk(Outcome::NotChecked { why: NotCheckedWhy::TooFewAnswered }, None); }
    // Every voter and the placed point need a real spread (None: an old run, or an empty channel; review I1: a value
    // that is not a real oval is treated the same, never measured).
    if voters.iter().chain(std::iter::once(placed)).any(|v| !v.cov.is_some_and(real_oval)) {
        return mk(Outcome::NotChecked { why: NotCheckedWhy::NoSpread }, None);
    }
    let agree = |a: &Guess, b: &Guess| d2(a, b, mm_per_px, p) <= t;
    let max_d2 = voters.iter().filter(|v| v.model_id != placed.model_id).map(|v| d2(placed, v, mm_per_px, p)).fold(None, |m: Option<f64>, d| Some(m.map_or(d, |m| m.max(d))));
    // Step 3: the largest sets of voters that all agree with each other (n ≤ 3 here, so whole sets, then pairs). With
    // today's two voters only the pair exists: they agree (group) or they do not (conflict, "the two models disagree").
    let idx: Vec<usize> = (0..n).collect();
    let mut groups: Vec<Vec<usize>> = Vec::new();
    if n >= 3 { for a in 0..n { for b in a + 1..n { for c in b + 1..n {
        if agree(&voters[a], &voters[b]) && agree(&voters[a], &voters[c]) && agree(&voters[b], &voters[c]) { groups.push(vec![a, b, c]); } } } } }
    if groups.is_empty() { for a in 0..n { for b in a + 1..n { if agree(&voters[a], &voters[b]) { groups.push(vec![a, b]); } } } }
    if groups.is_empty() { return mk(Outcome::Conflict { why: ConflictWhy::NoTwoAgree }, max_d2); }
    // Step 4: is the placed point with a largest group? A voter: if it is a member. A non-voter: if it agrees with every
    // member (strict, spec §4 ★).
    let with = |grp: &Vec<usize>| if p.is_voter(&placed.model_id) { grp.iter().any(|&i| voters[i].model_id == placed.model_id) }
        else { grp.iter().all(|&i| agree(placed, &voters[i])) };
    let Some(grp) = groups.iter().find(|g| with(g)) else { return mk(Outcome::Conflict { why: ConflictWhy::PlacedIsOddOneOut }, max_d2) };
    let outside: Vec<String> = idx.iter().filter(|i| !grp.contains(i)).map(|&i| voters[i].model_id.clone()).collect();
    if outside.is_empty() { mk(Outcome::Agree, max_d2) } else { mk(Outcome::Review { outside }, max_d2) }   // Review: ≥ 3 voters only
}

#[cfg(test)]
mod params_tests {
    use super::*;
    /// The frozen-value guard (spec §6.2 "Versioned file"): every value pinned. A change fails here until the owner's OK
    /// is recorded and this literal is updated in the same commit.
    #[test] fn the_committed_parameters_are_pinned() {
        let want = Params { rule_version: "crosscheck/0-draft".into(),
            status: "draft: spec 2026-10-13 §4 values (T 5.99, sigma0 0.3 mm, k 1, window 15 cells); tuned on Aariz valid in Task 7 and approved by the owner before Task 8".into(),
            test_result: "not-run".into(), voters: vec!["srpose-cldet23".into(), "aariz-cepha29".into()],   // owner VOTERS-2
            spread_window_cells: 15, sigma0_mm: 0.3, t_default: 5.99, t: BTreeMap::new(),
            k: [("cwlachap-hrnet-w32", 1.0), ("gu2net-isbi19", 1.0), ("srpose-cldet23", 1.0), ("aariz-cepha29", 1.0)].into_iter().map(|(a, b)| (a.to_string(), b)).collect(),
            assumed_mm_per_px: 0.1 };
        assert_eq!(params(), &want);
    }
    #[test] fn a_bad_file_is_refused() {
        let ok = DRAFT_JSON.to_string();
        assert!(parse_params(&ok).is_ok(), "the unchanged draft parses (control)");
        assert!(parse_params(&ok.replace("\"spreadWindowCells\": 15", "\"spreadWindowCells\": 14")).is_err());
        assert!(parse_params(&ok.replace("\"sigma0Mm\": 0.3", "\"sigma0Mm\": 0")).is_err());
        assert!(parse_params(&ok.replace("\"testResult\": \"not-run\"", "\"testResult\": \"maybe\"")).is_err());
        assert!(parse_params(&ok.replace("\"assumedMmPerPx\": 0.1", "\"assumedMmPerPx\": 0.1, \"extra\": 1")).is_err());
        assert!(parse_params(&ok.replace("\"voters\": [\"srpose-cldet23\", \"aariz-cepha29\"]", "\"voters\": [\"srpose-cldet23\", \"nobody\"]")).is_err(), "a voter with no k is refused");
        assert!(parse_params(&ok.replace("\"voters\": [\"srpose-cldet23\", \"aariz-cepha29\"]", "\"voters\": [\"srpose-cldet23\", \"aariz-cepha29\", \"gu2net-isbi19\", \"cwlachap-hrnet-w32\"]")).is_err(), "more than three voters is refused");
    }
}

#[cfg(test)]
mod rule_tests {
    use super::*;
    const SR: &str = "srpose-cldet23"; const GU: &str = "gu2net-isbi19"; const AZ: &str = "aariz-cepha29"; const CW: &str = "cwlachap-hrnet-w32";
    /// Draft values: T 5.99, σ₀ 0.3 mm, k 1, voters SRPose and Aariz (owner VOTERS-2). Round spreads of σ 0.5 mm (25 px²
    /// at 0.1 mm/px): two guesses agree within about 2.0 mm.
    fn p() -> Params { draft_params() }
    /// A hypothetical third voter, ONLY to keep the general code honest (review and the chain): no third voter exists today.
    fn three() -> Params { Params { voters: vec![SR.into(), GU.into(), AZ.into()], ..draft_params() } }
    fn g(m: &str, x_mm: f64, y_mm: f64) -> Guess { Guess { model_id: m.into(), x: x_mm / 0.1, y: y_mm / 0.1, cov: Some([25.0, 0.0, 25.0]) } }
    fn run(placed: &Guess, voters: &[Guess]) -> Check { check("Go", placed, voters, 0.1, &p()) }
    #[test] fn both_voters_together_agree() {
        let v = [g(SR, 0.0, 0.0), g(AZ, 0.0, 0.3)];
        let c = run(&v[1], &v);
        assert_eq!((c.outcome.clone(), c.answered, c.of), (Outcome::Agree, 2, 2));
    }
    #[test] fn a_voter_5_mm_from_the_placed_point_is_a_conflict_the_two_disagree() {
        // Aariz placed the point, so "SRPose is off" and "the placed point is off" are the same disagreement (spec §6.2 step 3).
        let v = [g(SR, 5.0, 0.0), g(AZ, 0.0, 0.0)];
        assert_eq!(run(&v[1], &v).outcome, Outcome::Conflict { why: ConflictWhy::NoTwoAgree });
        let w = [g(SR, 0.0, 0.0), g(AZ, 5.0, 0.0)];
        assert_eq!(run(&w[1], &w).outcome, Outcome::Conflict { why: ConflictWhy::NoTwoAgree });
    }
    #[test] fn one_voter_half_a_mm_off_is_not_flagged() {
        let v = [g(SR, 0.5, 0.0), g(AZ, 0.0, 0.0)];
        assert_eq!(run(&v[1], &v).outcome, Outcome::Agree);
    }
    #[test] fn one_or_none_answered_is_not_checked_one_of_two() {
        let a = g(AZ, 0.0, 0.0);
        let c = run(&a, &[a.clone()]);
        assert_eq!((c.outcome, c.answered, c.of), (Outcome::NotChecked { why: NotCheckedWhy::TooFewAnswered }, 1, 2));
        assert_eq!(run(&g(CW, 0.0, 0.0), &[]).outcome, Outcome::NotChecked { why: NotCheckedWhy::TooFewAnswered });
    }
    #[test] fn a_ghosts_guess_is_never_counted() {
        // GU2Net handed to the rule (as a careless caller might) changes nothing: it is not in the voter list (VOTERS-2).
        let far_ghost = [g(SR, 0.0, 0.0), g(GU, 5.0, 0.0), g(AZ, 0.0, 0.3)];
        let c = run(&far_ghost[2], &far_ghost);
        assert_eq!((c.outcome.clone(), c.answered), (Outcome::Agree, 2), "a ghost 5 mm off does not flag");
        assert!(c.dist_mm.iter().all(|(m, _)| m != GU), "and is not reported as a voter's distance");
        let ghost_only = [g(GU, 0.0, 0.0), g(AZ, 0.0, 0.0)];
        assert_eq!(run(&ghost_only[1], &ghost_only).outcome, Outcome::NotChecked { why: NotCheckedWhy::TooFewAnswered }, "a ghost cannot make up the second voter");
    }
    #[test] fn a_voter_without_a_spread_is_not_checked_until_the_models_are_re_run() {
        let mut old = g(SR, 0.0, 0.0); old.cov = None;
        let v = [old, g(AZ, 0.0, 0.0)];
        assert_eq!(run(&v[1], &v).outcome, Outcome::NotChecked { why: NotCheckedWhy::NoSpread });
    }
    #[test] fn a_point_placed_by_cwlachap_must_agree_with_both_voters() {
        let v = [g(SR, 0.0, 0.0), g(AZ, 1.6, 0.0)];                         // the two voters agree (1.6 mm, D² 3.8)
        assert_eq!(run(&g(CW, 0.8, 0.1), &v).outcome, Outcome::Agree, "a cwlachap point near both is with them");
        let with_one = g(CW, -1.9, 0.0);                                    // agrees with SR (1.9 mm), not with AZ (3.5 mm)
        assert_eq!(run(&with_one, &v).outcome, Outcome::Conflict { why: ConflictWhy::PlacedIsOddOneOut });
        let apart = [g(SR, 0.0, 0.0), g(AZ, 5.0, 0.0)];
        assert_eq!(run(&g(CW, 0.0, 0.0), &apart).outcome, Outcome::Conflict { why: ConflictWhy::NoTwoAgree }, "voters apart: conflict whoever placed it");
    }
    #[test] fn a_third_voter_if_one_is_ever_added_brings_back_review_and_the_chain() {
        // Dormant today (two voters cannot make a majority); kept so a later third voter needs no rule change.
        let q = three();
        let v = [g(SR, 5.0, 0.0), g(GU, 0.3, 0.0), g(AZ, 0.0, 0.0)];
        assert_eq!(check("Go", &v[2], &v, 0.1, &q).outcome, Outcome::Review { outside: vec![SR.into()] });
        assert_eq!(check("Go", &v[0], &v, 0.1, &q).outcome, Outcome::Conflict { why: ConflictWhy::PlacedIsOddOneOut });
        let chain = [g(SR, 0.0, 0.0), g(GU, 1.6, 0.0), g(AZ, 3.2, 0.0)];
        assert!(d2(&chain[0], &chain[1], 0.1, &q) <= 5.99 && d2(&chain[1], &chain[2], 0.1, &q) <= 5.99 && d2(&chain[0], &chain[2], 0.1, &q) > 5.99, "fixture must be a chain");
        assert_eq!(check("Go", &chain[2], &chain, 0.1, &q).outcome, Outcome::Review { outside: vec![SR.into()] });
        let two_of_three = [g(GU, 0.3, 0.0), g(AZ, 0.0, 0.0)];
        let c = check("Go", &two_of_three[1], &two_of_three, 0.1, &q);
        assert_eq!((c.outcome, c.answered, c.of), (Outcome::Agree, 2, 3));
    }
    /// A mirrored film (x -> w-1-x) negates the spread's off-diagonal term, so every answer must stay the same. The
    /// fixture is tilted along the 45° line and each pair sits either side of T only because of that term (D² 0.49
    /// along, 7.2 across), so the control - flipping x but forgetting to negate xy - must change every answer.
    #[test] fn a_mirrored_film_gives_the_same_answer() {
        let mk = |m: &str, x: f64, y: f64| Guess { model_id: m.into(), x, y, cov: Some([200.5, 199.5, 200.5]) };
        let (s, t) = (20.0 / 2f64.sqrt(), 12.0 / 2f64.sqrt());              // 2 mm along, 1.2 mm across
        let along = [mk(SR, 100.0, 100.0), mk(AZ, 100.0 + s, 100.0 + s)];
        let across = [mk(SR, 100.0, 100.0), mk(AZ, 100.0 + t, 100.0 - t)];
        let cw_mid = mk(CW, 100.0 + s / 2.0, 100.0 + s / 2.0);              // between two agreeing voters
        let cw_off = mk(CW, 100.0 - t, 100.0 + t);                          // across from SRPose
        let cases: [(&Guess, &[Guess], Outcome); 4] = [
            (&along[1], &along, Outcome::Agree),
            (&across[1], &across, Outcome::Conflict { why: ConflictWhy::NoTwoAgree }),
            (&cw_mid, &along, Outcome::Agree),
            (&cw_off, &along, Outcome::Conflict { why: ConflictWhy::PlacedIsOddOneOut }),
        ];
        let w = 1000.0;
        let flip = |q: &Guess| Guess { x: w - 1.0 - q.x, cov: q.cov.map(|c| [c[0], -c[1], c[2]]), ..q.clone() };
        let flip_forgetting_xy = |q: &Guess| Guess { x: w - 1.0 - q.x, ..q.clone() };   // control: a wrong mirror
        for (i, (placed, voters, want)) in cases.iter().enumerate() {
            assert_eq!(&run(placed, voters).outcome, want, "case {i} on the film as taken");
            let m: Vec<Guess> = voters.iter().map(flip).collect();
            assert_eq!(&run(&flip(placed), &m).outcome, want, "case {i} on the mirrored film");
            let bad: Vec<Guess> = voters.iter().map(flip_forgetting_xy).collect();
            assert_ne!(&run(&flip_forgetting_xy(placed), &bad).outcome, want, "case {i}: the control must change the answer, or this test is blind");
        }
    }
    /// Review I1: a spread that is not a real oval (a negative variance, |xy| > √(xx·yy), not finite) or a placed point
    /// with none is "not checked", never a confident answer: a negative variance once made a 5 mm gap read D² −1250, agree.
    #[test] fn a_spread_that_is_not_a_real_oval_is_not_checked() {
        let with = |m: &str, x: f64, cov: Option<[f64; 3]>| Guess { model_id: m.into(), x: x / 0.1, y: 0.0, cov };
        let both_negative = [with(SR, 5.0, Some([-20.0, 0.0, -20.0])), with(AZ, 0.0, Some([-20.0, 0.0, -20.0]))];
        assert_eq!(run(&both_negative[1], &both_negative).outcome, Outcome::NotChecked { why: NotCheckedWhy::NoSpread }, "5 mm apart, both spreads negative: once D² < 0, agree");
        for bad in [[-20.0, 0.0, -20.0], [25.0, 0.0, -1.0], [25.0, 30.0, 25.0], [f64::NAN, 0.0, 25.0], [25.0, f64::INFINITY, 25.0]] {
            let v = [with(SR, 5.0, Some(bad)), g(AZ, 0.0, 0.0)];
            assert_eq!(run(&v[1], &v).outcome, Outcome::NotChecked { why: NotCheckedWhy::NoSpread }, "voter spread {bad:?}");
            let ok = [g(SR, 5.0, 0.0), g(AZ, 0.0, 0.0)];
            assert_eq!(run(&with(CW, 0.0, Some(bad)), &ok).outcome, Outcome::NotChecked { why: NotCheckedWhy::NoSpread }, "placed spread {bad:?}");
            let ghost = [g(SR, 0.0, 0.0), with(GU, 5.0, Some(bad)), g(AZ, 0.0, 0.3)];
            assert_eq!(run(&ghost[2], &ghost).outcome, Outcome::Agree, "a ghost's bad spread is ignored with the ghost");
        }
        let line = [with(SR, 0.0, Some([25.0, 25.0, 25.0])), g(AZ, 0.0, 0.3)];   // |xy| = √(xx·yy) exactly: a real (flat) oval
        assert_eq!(run(&line[1], &line).outcome, Outcome::Agree, "a spread along a line is still a spread");
        let mut placed = g(AZ, 0.0, 0.0); placed.cov = None;
        let v = [g(SR, 0.0, 0.0), g(AZ, 0.0, 0.0)];
        assert_eq!(run(&placed, &v).outcome, Outcome::NotChecked { why: NotCheckedWhy::NoSpread }, "a placed point without a spread");
    }
    /// Review I1: a scale that is zero, negative or not finite is refused for the whole landmark (check() returns a
    /// Check, not a Result, so the refusal is NotChecked with its own reason).
    #[test] fn a_bad_scale_is_refused() {
        let v = [g(SR, 5.0, 0.0), g(AZ, 0.0, 0.0)];
        for mm in [0.0, -0.1, f64::NAN, f64::INFINITY] {
            let c = check("Go", &v[1], &v, mm, &p());
            assert_eq!(c.outcome, Outcome::NotChecked { why: NotCheckedWhy::BadScale }, "mm_per_px {mm}");
            assert!(c.dist_mm.is_empty() && c.max_d2.is_none(), "no distances from a bad scale: {:?}", c.dist_mm);
            assert!(d2(&v[0], &v[1], mm, &p()).is_nan(), "d2 cannot measure on a bad scale");
        }
    }
    /// Review I1: D² is never negative. Bad input gives NaN ("cannot measure"); every valid pair gives D² ≥ 0.
    #[test] fn d2_is_never_negative() {
        let bad = [[-20.0, 0.0, -20.0], [25.0, 30.0, 25.0], [f64::NAN, 0.0, 1.0], [0.0, 1.0, 0.0]];
        let good = [[0.0, 0.0, 0.0], [25.0, 25.0, 25.0], [25.0, -25.0, 25.0], [400.0, -10.0, 1.0], [1e6, 0.0, 1e-6]];
        let at = |m: &str, x: f64, y: f64, c: [f64; 3]| Guess { model_id: m.into(), x, y, cov: Some(c) };
        for (dx, dy) in [(0.0, 0.0), (50.0, 0.0), (-30.0, 40.0), (7.0, -7.0)] {
            for c in bad { assert!(d2(&at(SR, 0.0, 0.0, c), &at(AZ, dx, dy, [25.0, 0.0, 25.0]), 0.1, &p()).is_nan(), "{c:?}"); }
            for a in good { for b in good {
                let d = d2(&at(SR, 0.0, 0.0, a), &at(AZ, dx, dy, b), 0.1, &p());
                assert!(d.is_finite() && d >= 0.0, "{a:?} {b:?} ({dx}, {dy}): {d}");
            } }
        }
    }
    #[test] fn distances_are_reported_in_mm_beside_the_result() {
        let v = [g(SR, 3.0, 4.0), g(AZ, 0.0, 0.0)];
        let c = run(&v[1], &v);
        assert!(c.dist_mm.iter().any(|(m, d)| m == SR && (d - 5.0).abs() < 1e-9), "{:?}", c.dist_mm);
        assert!(c.max_d2.unwrap() > 5.99);
        assert_eq!(c.rule_version, p().rule_version);
    }
    #[test] fn a_landmark_with_its_own_t_uses_it() {
        let mut q = p(); q.t.insert("Go".into(), 1000.0);
        let v = [g(SR, 5.0, 0.0), g(AZ, 0.0, 0.0)];
        assert_eq!(check("Go", &v[1], &v, 0.1, &q).outcome, Outcome::Agree);
        assert!(matches!(check("S", &v[1], &v, 0.1, &q).outcome, Outcome::Conflict { .. }));
    }
    /// Spec §2 "the oval along the bone" (preflight c7): with spreads stretched along the 45° line, a 2 mm gap ALONG it
    /// agrees and a 1.2 mm gap ACROSS it does not (across, only the 0.3 mm floors and 1 px² remain: 1 mm would still agree). The only test of d2's off-diagonal term; the mirrored test above is
    /// sign-invariant and cannot see a wrong sign.
    #[test] fn a_gap_along_the_oval_agrees_and_a_smaller_gap_across_it_does_not() {
        // σ² 400 px² along (1, 1)/√2, 1 px² across: [xx, xy, yy] = [200.5, 199.5, 200.5].
        let along = |m: &str, x: f64, y: f64| Guess { model_id: m.into(), x, y, cov: Some([200.5, 199.5, 200.5]) };
        let a = along(SR, 0.0, 0.0);
        let s = 20.0 / 2f64.sqrt();                                          // 20 px = 2 mm at 0.1 mm/px
        let t = 12.0 / 2f64.sqrt();                                          // 12 px = 1.2 mm
        assert!(d2(&a, &along(AZ, s, s), 0.1, &p()) <= 5.99, "2 mm along the oval agrees");
        assert!(d2(&a, &along(AZ, t, -t), 0.1, &p()) > 5.99, "1.2 mm across the oval does not");   // D² 0.49 along, 7.2 across
    }
    #[test] fn the_floor_is_converted_with_the_films_own_scale() {
        // Same pixels, coarser film (0.2 mm/px): the floor is fewer px, so the same 3 px gap is relatively larger.
        let a = Guess { model_id: SR.into(), x: 0.0, y: 0.0, cov: Some([0.0, 0.0, 0.0]) };
        let b = Guess { model_id: AZ.into(), x: 3.0, y: 0.0, cov: Some([0.0, 0.0, 0.0]) };
        assert!(d2(&a, &b, 0.2, &p()) > d2(&a, &b, 0.1, &p()));
    }
    /// A film with no ruler: the caller passes the assumed 0.1 mm/px (Q10) and the rule answers as on a calibrated
    /// film of that scale; the "≈" is the screen's job, so the rule only has to use the scale it is given.
    #[test] fn a_film_with_no_ruler_uses_the_assumed_scale() {
        let q = p();
        let v = [g(SR, 3.0, 4.0), g(AZ, 0.0, 0.0)];
        let c = check("Go", &v[1], &v, q.assumed_mm_per_px, &q);
        assert_eq!(c.dist_mm, vec![(SR.to_string(), 5.0), (AZ.to_string(), 0.0)]);
        assert_eq!(c.outcome, Outcome::Conflict { why: ConflictWhy::NoTwoAgree });
    }
    /// Q1 and Q6: the rule only ever answers one of four words, none of them "verified" or a moved point.
    #[test] fn the_outcome_is_tagged_and_never_verified() {
        let v = [g(SR, 0.0, 0.0), g(AZ, 0.0, 0.3)];
        let j = serde_json::to_value(&run(&v[1], &v)).unwrap();
        assert_eq!(j["outcome"], serde_json::json!({ "kind": "agree" }));
        assert_eq!(serde_json::to_value(Outcome::NotChecked { why: NotCheckedWhy::NoSpread }).unwrap(), serde_json::json!({ "kind": "notChecked", "why": "noSpread" }));
        assert_eq!(serde_json::to_value(Outcome::Conflict { why: ConflictWhy::PlacedIsOddOneOut }).unwrap(), serde_json::json!({ "kind": "conflict", "why": "placedIsOddOneOut" }));
        assert!(!j.to_string().to_lowercase().contains("verified"));
    }
}
