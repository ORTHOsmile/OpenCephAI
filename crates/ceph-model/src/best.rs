//! Part F, rule `best-point/4` (Part F design, "The decision rule";
//! chain spec §6 S1; the owner's answers of 26 Oct in
//! the base model, spec §3):
//! for each of the 19 original points, whether another model beats **the base** (default Aariz, `DEFAULT_BASE`) on the
//! owner's own verified films, despite the free zeros his accepted-unmoved points give the base, counting only films the
//! base or the owner placed, and only marks made by each model's current file (owner Q9). best-point/4 is best-point/3
//! with "Aariz" replaced by the base and nothing else changed: with Aariz as the base it gives /3's verdicts exactly
//! (the golden file `golden/best-point-3.json`). A film's distance is its raw pixel distance times the film's own
//! scale (ruler, machine, fit, assumed: the app's order); the most accurate scale group with MIN_TIER_FILMS films
//! decides, alone; within it a finer image counts more (weight 1 / mm per px, no film above MAX_FILM_SHARE). With every
//! counted film a ruler film of one pixel size this is exactly best-point/1. The whole rule is `decide`, a pure function
//! (no files, no clock, no library). Every constant is pinned by `the_rule_constants_are_pinned`: a change needs the
//! owner's OK and a new RULE_VERSION in the same commit. (best-point/2 is skipped: the chain spec's draft used that name
//! for the habit exclusion, which lapsed.)
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

/// Bump with any change to a constant or to what `decide` counts.
pub const RULE_VERSION: &str = "best-point/4";
/// Earlier rule versions whose verdicts this one gives byte for byte when the base is `DEFAULT_BASE` (Aariz): the test
/// `with_aariz_as_the_base_the_rule_gives_best_point_3s_bytes` holds that to the golden file captured on best-point/3.
/// The public-film proof (S1 on Ceph-400, in ceph-bench) was pre-registered on best-point/3 with Aariz
/// as the yardstick; it runs with `DEFAULT_BASE`, so it may name either. With any other base this list says nothing.
/// Keyed to the rule version it was PROVED for (final review I3): bump RULE_VERSION and the list no longer applies, so the
/// best-point/3 pre-registration is refused until someone re-proves the equivalence and re-keys this deliberately.
pub const SAME_WITH_DEFAULT_BASE: (&str, &[&str]) = ("best-point/4", &["best-point/3"]);
/// Whether a record naming rule version `v` is reproduced by `decide` with `DEFAULT_BASE` as the base, under this rule.
pub fn reproduced_with_default_base(v: &str) -> bool { reproduced_under(RULE_VERSION, v) }
/// `reproduced_with_default_base` for a given rule version (so a later version can be tested without bumping it).
pub fn reproduced_under(rule: &str, v: &str) -> bool {
    v == rule || (SAME_WITH_DEFAULT_BASE.0 == rule && SAME_WITH_DEFAULT_BASE.1.contains(&v))
}
/// The default base (owner, 29 Oct: Aariz, recommended). The base is the starting model and the yardstick: every other
/// model is compared with it (before 29 Oct always Aariz: owner ruling TABLE, 15 Oct; chain spec answer 3).
pub const DEFAULT_BASE: &str = "aariz-cepha29";
/// Films per block: the look, then the held-back re-check on the next block (owner F2, 17 Oct).
pub const BLOCK_FILMS: usize = 30;
/// The other model's weighted median must be lower than the base's by at least this, in mm (owner F2); exactly 0.3 passes.
pub const MIN_MEDIAN_GAIN_MM: f64 = 0.3;
/// "Within 2 mm" (SDR 2 mm): 2.00 mm or less, as `crates/ceph-bench/src/metrics.rs` counts it.
pub const WITHIN_MM: f64 = 2.0;
/// Films a scale group needs before it decides a pair (owner E4, 26 Oct). Below this the next group down decides.
pub const MIN_TIER_FILMS: usize = 20;
/// No film may carry more than this share of its block's weight (owner E3, 26 Oct).
pub const MAX_FILM_SHARE: f64 = 0.2;
/// Rounding slack, so a gain of exactly 0.3 mm that floating point stores as 0.2999999999999998 (2.3 − 2.0) passes, and
/// two equal weighted shares summed in a different order compare equal.
pub const FLOAT_SLACK: f64 = 1e-9;

/// Where a film's scale came from, most accurate first (the app's order: `ceph_store::film_scale`, `compare/fit.ts`
/// `ownPages`). A fit to a film with no ruler or machine scale is `Assumed` (owner G3).
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Tier { Ruler, Machine, Fit, Assumed }
/// The scale groups in the order they are tried (owner E2).
pub const TIERS: [Tier; 4] = [Tier::Ruler, Tier::Machine, Tier::Fit, Tier::Assumed];

/// Films per scale group.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TierCounts { pub ruler: usize, pub machine: usize, pub fit: usize, pub assumed: usize }
impl TierCounts {
    pub fn get(&self, t: Tier) -> usize { match t { Tier::Ruler => self.ruler, Tier::Machine => self.machine, Tier::Fit => self.fit, Tier::Assumed => self.assumed } }
    fn add(&mut self, t: Tier) { match t { Tier::Ruler => self.ruler += 1, Tier::Machine => self.machine += 1, Tier::Fit => self.fit += 1, Tier::Assumed => self.assumed += 1 } }
}

/// The deciding group in the words the record and the label use (owner E1: they name the measure that decided).
pub fn basis_words(tier: Tier, films: usize) -> String {
    match tier {
        Tier::Ruler => format!("mm, {films} ruler films"),
        Tier::Machine => format!("mm via machine scale, {films} films"),
        Tier::Fit => format!("mm via fit scale, {films} films"),
        Tier::Assumed => format!("mm via assumed scale (an estimate), {films} films"),
    }
}

/// One learning-record row (`learning_record`, schema 10) with its film's import time and its film's scale now.
/// `dist_px`: the raw pixel distance from the final point. `mm_per_px`, `tier`: the film's own scale (> 0, finite:
/// `ceph_store::film_scale` guarantees it) and where it came from; the same on every row of one film. `fine_tuned`: a
/// ruler adjusted by eye (± presses). `fingerprint`: the model file that made the mark, as
/// `ceph_model::fingerprint::normalise` reads the stored `model_sha256` (None: not known).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordRow {
    pub case_id: String, pub imported_at: String, pub landmark_id: String, pub model_id: String,
    pub dist_px: f64, pub mm_per_px: f64, pub tier: Tier, pub fine_tuned: bool,
    pub how: String, pub placer: bool, pub fingerprint: Option<String>,
}

/// Which model files count (owner Q9, 18 Oct: when a model's file changes, start that model afresh). `current`: each
/// installed model's file now, model → fingerprint (a model not installed is absent). `earlier`: (case id, model id) for
/// every film a model ran on with any other file; such a film never counts for that model again, even after a re-run
/// gives it a mark from the current file (owner Q4: offers use fresh films; older films serve the weights check only).
#[derive(Clone, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Files { pub current: BTreeMap<String, String>, pub earlier: BTreeSet<(String, String)> }

/// A film's place in the rule's order: import time, then case id (neither ever changes).
#[derive(Clone, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmKey { pub imported_at: String, pub case_id: String }

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Action { Accepted, Declined, Undone }

/// One of the owner's answers (`point_choices`, format 14), oldest first. `last_film`: the last film of the re-check the
/// answer was given on (none for an undo).
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Decision { pub landmark_id: String, pub model_id: String, pub action: Action, pub last_film: Option<FilmKey> }

/// One full block of 30 films for one model pair, in mm. The weighted median and weighted share decide; the plain
/// median, the means and the counts are kept beside them (owner E3: the unweighted numbers and n are stored too).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BlockStats {
    pub case_ids: Vec<String>, pub first: FilmKey, pub last: FilmKey,
    pub incumbent_median_mm: f64, pub challenger_median_mm: f64,
    pub incumbent_plain_median_mm: f64, pub challenger_plain_median_mm: f64,
    pub incumbent_mean_mm: f64, pub challenger_mean_mm: f64,
    pub incumbent_plain_mean_mm: f64, pub challenger_plain_mean_mm: f64,
    pub incumbent_within: usize, pub challenger_within: usize,
    pub incumbent_within_share: f64, pub challenger_within_share: f64,
    pub accepted_unmoved: usize, pub passed: bool,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PairVerdict {
    /// The look's block is not full: `films` of 30 in the deciding group (0 when no group has 20).
    NotEnough { films: usize },
    /// The look passed; the held-back re-check has `films` of 30.
    ReCheck { look: BlockStats, films: usize },
    /// The last look failed (`check` None) or its re-check failed; the next look has `films` of 30.
    Keep { look: BlockStats, check: Option<BlockStats>, films: usize },
    /// The look and the re-check both passed: offer the switch (never made by itself).
    Offer { look: BlockStats, check: BlockStats },
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Pair {
    pub model_id: String,
    /// The scale group that decides (owner E2, E4): the most accurate with MIN_TIER_FILMS films; None when none has.
    pub basis: Option<Tier>,
    /// Films in the deciding group (0 when none).
    pub films: usize,
    /// Every counted film of this pair, per scale group.
    pub available: TierCounts,
    /// Of the deciding group's films, those accepted unmoved (F1: shown beside every result).
    pub accepted_unmoved: usize,
    /// Films left out for this pair because a mark came from an earlier (or unknown, or uninstalled) model file.
    pub left_out_earlier_file: usize,
    pub verdict: PairVerdict,
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PointVerdict {
    pub landmark_id: String,
    /// The model that places this point now: the base, or the owner's accepted switch.
    pub current: String,
    pub pairs: Vec<Pair>,
    /// The one model offered for this point, if any, and the scale group its offer was decided on.
    pub offer: Option<String>,
    pub offer_basis: Option<Tier>,
    /// The counted films of this point, per scale group; and how many of its ruler films were fine-tuned by eye.
    pub films_by_scale: TierCounts,
    pub fine_tuned_ruler: usize,
    pub left_out_other_placer: usize,
}

/// The switches in force, point → model: the latest accepted or undone answer per point (a decline switches nothing).
pub fn current_choices(decisions: &[Decision]) -> BTreeMap<String, String> {
    let mut out = BTreeMap::new();
    for d in decisions {
        match d.action {
            Action::Accepted => { out.insert(d.landmark_id.clone(), d.model_id.clone()); }
            Action::Undone => { out.remove(&d.landmark_id); }
            Action::Declined => {}
        }
    }
    out
}

/// A film in one pair's deciding group: both models' distances in mm (pixels × the film's scale) and the film's scale.
struct TrackFilm { key: FilmKey, mm_per_px: f64, incumbent_mm: f64, challenger_mm: f64, accepted_unmoved: bool }

/// The rule, items 1–9 (this plan, Task 1). `points`: the points to judge, in the order to show them. `catalogue`: the
/// Models… list order (the last tie-break). `rows`: the learning record of every film not in Recently deleted, with each
/// film's scale. `decisions`: the owner's answers, oldest first. `files`: which model files count (item 1, owner Q9).
/// `base`: the yardstick and starting model (`DEFAULT_BASE` unless the owner chose another). The `incumbent_*` fields of
/// the verdict are the base's.
pub fn decide(points: &[&str], catalogue: &[&str], rows: &[RecordRow], decisions: &[Decision], files: &Files, base: &str) -> Vec<PointVerdict> {
    let current = current_choices(decisions);
    points.iter().map(|p| {
        let now = current.get(*p).cloned().unwrap_or_else(|| base.to_string());
        // Item 1: the point's rows by film, in the rule's order.
        let mut films: BTreeMap<FilmKey, Vec<&RecordRow>> = BTreeMap::new();
        for r in rows.iter().filter(|r| r.landmark_id == *p) {
            films.entry(FilmKey { imported_at: r.imported_at.clone(), case_id: r.case_id.clone() }).or_default().push(r);
        }
        let (mut by_scale, mut fine_tuned, mut other_placer) = (TierCounts::default(), 0, 0);
        let mut counted: Vec<(FilmKey, Vec<&RecordRow>)> = Vec::new();
        for (k, rs) in films {
            let hand = rs.iter().any(|r| r.how == "hand-placed");
            let by_base = rs.iter().any(|r| r.model_id == base && r.placer);
            if !(hand || by_base) { if rs.iter().any(|r| r.placer) { other_placer += 1; } continue; }   // free zero not the base's (Q11)
            by_scale.add(rs[0].tier);
            if rs[0].tier == Tier::Ruler && rs[0].fine_tuned { fine_tuned += 1; }
            counted.push((k, rs));
        }
        let mut verdict = PointVerdict { landmark_id: p.to_string(), current: now.clone(), pairs: vec![], offer: None, offer_basis: None,
            films_by_scale: by_scale, fine_tuned_ruler: fine_tuned, left_out_other_placer: other_placer };
        if now != base { return verdict; }                                                    // Q7: no offers after a switch
        let mut models: Vec<&str> = counted.iter().flat_map(|(_, rs)| rs.iter().map(|r| r.model_id.as_str())).filter(|m| *m != base).collect();
        models.sort_by_key(|m| (catalogue.iter().position(|c| c == m).unwrap_or(usize::MAX), m.to_string()));
        models.dedup();
        for m in models {
            // Item 8: a model's next look starts after the films of its last accepted or declined offer on this point.
            let after = decisions.iter().filter(|d| d.landmark_id == *p && d.model_id == m).filter_map(|d| d.last_film.clone()).max();
            // Item 1, owner Q9: a mark counts only if the model's current file made it and that file is the only one
            // that ever ran on the film for that model.
            let fresh = |r: &RecordRow, k: &FilmKey| r.fingerprint.is_some() && r.fingerprint.as_ref() == files.current.get(&r.model_id)
                && !files.earlier.contains(&(k.case_id.clone(), r.model_id.clone()));
            let (mut all, mut earlier_file) = (Vec::<(Tier, TrackFilm)>::new(), 0);
            for (k, rs) in counted.iter().filter(|(k, _)| after.as_ref().map_or(true, |a| k > a)) {
                let (Some(a), Some(c)) = (rs.iter().find(|r| r.model_id == base), rs.iter().find(|r| r.model_id == m)) else { continue };
                if !(fresh(a, k) && fresh(c, k)) { earlier_file += 1; continue; }
                // Item 3: pixels × the film's own scale.
                all.push((a.tier, TrackFilm { key: k.clone(), mm_per_px: a.mm_per_px, incumbent_mm: a.dist_px * a.mm_per_px,
                    challenger_mm: c.dist_px * a.mm_per_px, accepted_unmoved: a.how == "accepted-unmoved" }));
            }
            let mut available = TierCounts::default();
            for (t, _) in &all { available.add(*t); }
            // Item 2 (owner E2, E4): the most accurate group with MIN_TIER_FILMS films decides, alone.
            let basis = TIERS.into_iter().find(|t| available.get(*t) >= MIN_TIER_FILMS);
            let track: Vec<TrackFilm> = all.into_iter().filter(|(t, _)| Some(*t) == basis).map(|(_, f)| f).collect();
            let pv = if basis.is_some() { walk(&track) } else { PairVerdict::NotEnough { films: 0 } };
            verdict.pairs.push(Pair { model_id: m.to_string(), basis, films: track.len(), available,
                accepted_unmoved: track.iter().filter(|f| f.accepted_unmoved).count(), left_out_earlier_file: earlier_file, verdict: pv });
        }
        // Item 7: one offer per point; `min_by` keeps the first of equals, and the pairs are in the Models… list order.
        let best = verdict.pairs.iter()
            .filter_map(|pr| match &pr.verdict { PairVerdict::Offer { check, .. } => Some((pr, check)), _ => None })
            .min_by(|(pa, a), (pb, b)| pa.basis.cmp(&pb.basis)
                .then(a.challenger_median_mm.total_cmp(&b.challenger_median_mm))
                .then(b.challenger_within_share.total_cmp(&a.challenger_within_share)))
            .map(|(pr, _)| (pr.model_id.clone(), pr.basis));
        if let Some((m, b)) = best { verdict.offer = Some(m); verdict.offer_basis = b; }
        verdict
    }).collect()
}

/// Items 4 and 6: full blocks of 30 in order; a passing look is followed by its re-check; a failure starts a fresh look
/// on the next block. The first offer found stands until the owner answers it.
fn walk(films: &[TrackFilm]) -> PairVerdict {
    let (mut look, mut failed): (Option<BlockStats>, Option<(BlockStats, Option<BlockStats>)>) = (None, None);
    for chunk in films.chunks_exact(BLOCK_FILMS) {
        let b = block(chunk);
        match look.take() {
            None if b.passed => look = Some(b),
            None => failed = Some((b, None)),
            Some(l) if b.passed => return PairVerdict::Offer { look: l, check: b },
            Some(l) => failed = Some((l, Some(b))),
        }
    }
    let rest = films.len() % BLOCK_FILMS;
    match (look, failed) {
        (Some(look), _) => PairVerdict::ReCheck { look, films: rest },
        (None, Some((look, check))) => PairVerdict::Keep { look, check, films: rest },
        (None, None) => PairVerdict::NotEnough { films: films.len() },
    }
}

/// Item 5 on one full block (measurement 3).
fn block(films: &[TrackFilm]) -> BlockStats {
    let w = shares(&films.iter().map(|f| f.mm_per_px).collect::<Vec<_>>());
    let total: f64 = w.iter().sum();
    let a: Vec<f64> = films.iter().map(|f| f.incumbent_mm).collect();
    let c: Vec<f64> = films.iter().map(|f| f.challenger_mm).collect();
    let mean = |v: &[f64]| v.iter().zip(&w).map(|(x, s)| x * s).sum::<f64>() / total;
    let plain_mean = |v: &[f64]| v.iter().sum::<f64>() / v.len() as f64;
    let within = |v: &[f64]| v.iter().filter(|d| **d <= WITHIN_MM).count();
    // A float sum of no terms is -0.0 in Rust; a share is never negative, so a block with no film within 2 mm stores 0.0.
    let share = |v: &[f64]| { let x = v.iter().zip(&w).filter(|(d, _)| **d <= WITHIN_MM).map(|(_, s)| *s).sum::<f64>() / total; if x == 0.0 { 0.0 } else { x } };
    // A block is never empty (`walk` takes full blocks of BLOCK_FILMS), so its medians always exist.
    let mid = |m: Option<f64>| m.expect("a block holds BLOCK_FILMS films");
    let (am, cm, aws, cws) = (mid(weighted_median(&a, &w)), mid(weighted_median(&c, &w)), share(&a), share(&c));
    BlockStats {
        case_ids: films.iter().map(|f| f.key.case_id.clone()).collect(),
        first: films[0].key.clone(), last: films[films.len() - 1].key.clone(),
        incumbent_median_mm: am, challenger_median_mm: cm,
        incumbent_plain_median_mm: mid(median(&a)), challenger_plain_median_mm: mid(median(&c)),
        incumbent_mean_mm: mean(&a), challenger_mean_mm: mean(&c),
        incumbent_plain_mean_mm: plain_mean(&a), challenger_plain_mean_mm: plain_mean(&c),
        incumbent_within: within(&a), challenger_within: within(&c),
        incumbent_within_share: aws, challenger_within_share: cws,
        accepted_unmoved: films.iter().filter(|f| f.accepted_unmoved).count(),
        passed: am - cm + FLOAT_SLACK >= MIN_MEDIAN_GAIN_MM && cws + FLOAT_SLACK >= aws,
    }
}

/// Owner E3 (26 Oct): each film's share of its block's weight. Weight 1 / mm per px (a finer image counts more),
/// normalised to sum to 1, then no film above MAX_FILM_SHARE: the excess goes to the films under the cap in proportion
/// to their own weight, repeated until none is over. A group of fewer than 1 / MAX_FILM_SHARE films cannot keep every
/// film under the cap, so its films weigh the same (a block of 30 never is; tested).
pub(crate) fn shares(mm_per_px: &[f64]) -> Vec<f64> {
    let n = mm_per_px.len();
    if (n as f64) * MAX_FILM_SHARE < 1.0 { return vec![1.0 / n as f64; n]; }
    let raw: Vec<f64> = mm_per_px.iter().map(|s| 1.0 / s).collect();
    let mut capped = vec![false; n];
    loop {
        let free: f64 = raw.iter().zip(&capped).filter(|(_, c)| !**c).map(|(w, _)| *w).sum();
        let left = 1.0 - MAX_FILM_SHARE * capped.iter().filter(|c| **c).count() as f64;
        let out: Vec<f64> = (0..n).map(|i| if capped[i] { MAX_FILM_SHARE } else { raw[i] / free * left }).collect();
        let over: Vec<usize> = (0..n).filter(|i| !capped[*i] && out[*i] > MAX_FILM_SHARE + FLOAT_SLACK).collect();
        if over.is_empty() { return out; }
        for i in over { capped[i] = true; }
    }
}

/// The weighted median: sort the distances; take the smallest whose running weight reaches one half, and the smallest
/// whose running weight passes one half, and average them (so equal weights give exactly the plain median, even or odd
/// count). The half is compared with a slack of FLOAT_SLACK × the total, so sums that differ only in rounding tie.
/// None for an empty list, or weights that are all zero: there is no middle value to give.
pub(crate) fn weighted_median(v: &[f64], w: &[f64]) -> Option<f64> {
    let mut s: Vec<(f64, f64)> = v.iter().copied().zip(w.iter().copied()).collect();
    s.sort_by(|a, b| a.0.total_cmp(&b.0));
    let total: f64 = s.iter().map(|x| x.1).sum();
    let eps = FLOAT_SLACK * total;
    let (mut cum, mut lower, mut upper) = (0.0, None, None);
    for (x, wt) in &s {
        cum += wt;
        if lower.is_none() && 2.0 * cum >= total - eps { lower = Some(*x); }
        if upper.is_none() && 2.0 * cum > total + eps { upper = Some(*x); }
    }
    Some((lower? + upper?) / 2.0)
}

/// The middle value; for an even count, the mean of the two middle values. None for an empty list.
pub(crate) fn median(v: &[f64]) -> Option<f64> {
    if v.is_empty() { return None; }
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    let n = s.len();
    Some(if n % 2 == 1 { s[n / 2] } else { (s[n / 2 - 1] + s[n / 2]) / 2.0 })
}

#[cfg(test)]
mod tests {
    use super::*;
    const AZ: &str = DEFAULT_BASE;
    const CW: &str = "cwlachap-hrnet-w32";
    const GU: &str = "gu2net-isbi19";
    const SR: &str = "srpose-cldet23";
    /// The Models… list order (crates/ceph-model/catalog/catalog.json).
    const CAT: [&str; 4] = [CW, GU, SR, AZ];
    /// Tests that check exact numbers use films at 1 mm per pixel: a pixel distance is then the same number in mm (no
    /// rounding), and every film weighs the same.
    const S: f64 = 1.0;
    type Spec = (&'static str, f64, Vec<(&'static str, f64)>);

    fn key(n: usize) -> FilmKey { FilmKey { imported_at: format!("2026-01-01T{:02}:{:02}:00.000Z", n / 60, n % 60), case_id: format!("c{n:03}") } }
    /// Film `n`'s rows for point `p`, on a film of scale group `tier` at `s` mm per px: Aariz's pixel distance (Aariz
    /// placed the point unless it was hand-placed) and each other model's. Films are imported in the order of `n`.
    fn film_on(n: usize, p: &str, how: &str, tier: Tier, s: f64, az: f64, others: &[(&str, f64)]) -> Vec<RecordRow> {
        let k = key(n);
        let row = |m: &str, d: f64, placer: bool| RecordRow { case_id: k.case_id.clone(), imported_at: k.imported_at.clone(),
            landmark_id: p.into(), model_id: m.into(), dist_px: d, mm_per_px: s, tier, fine_tuned: false, how: how.into(), placer,
            fingerprint: Some(format!("fp-{m}")) };
        std::iter::once(row(AZ, az, how != "hand-placed")).chain(others.iter().map(|(m, d)| row(m, *d, false))).collect()
    }
    /// A ruler film at 1 mm per px.
    fn film(n: usize, p: &str, how: &str, az: f64, others: &[(&str, f64)]) -> Vec<RecordRow> { film_on(n, p, how, Tier::Ruler, S, az, others) }
    /// Gonion on films `from..to` of one scale group, each built by `f(n)` = (how, Aariz, other models).
    fn go_films_on(from: usize, to: usize, tier: Tier, s: f64, f: impl Fn(usize) -> Spec) -> Vec<RecordRow> {
        (from..to).flat_map(|n| { let (how, az, o) = f(n); film_on(n, "Go", how, tier, s, az, &o) }).collect()
    }
    /// Gonion on ruler films `from..to` at 1 mm per px.
    fn go_films(from: usize, to: usize, f: impl Fn(usize) -> Spec) -> Vec<RecordRow> { go_films_on(from, to, Tier::Ruler, S, f) }
    /// The positive control's films: every fifth accepted unmoved (Aariz 0 by construction, each listed model 1 from
    /// Aariz's mark); the rest moved, Aariz 1.5–2.95 off, each listed model `gain` closer.
    fn planted(gain: f64, models: &'static [&'static str]) -> impl Fn(usize) -> Spec {
        move |n| if n % 5 == 0 { ("accepted-unmoved", 0.0, models.iter().map(|m| (*m, 1.0)).collect()) } else {
            let az = 1.5 + 0.05 * (n % 30) as f64;
            ("moved", az, models.iter().map(|m| (*m, (az - gain).max(0.0))).collect())
        }
    }
    /// Every catalogue model installed, each with the file `fp-<model id>` that made every mark `film_on` builds.
    fn files() -> Files { Files { current: CAT.iter().map(|m| (m.to_string(), format!("fp-{m}"))).collect(), earlier: BTreeSet::new() } }
    fn go_with(rows: &[RecordRow], decisions: &[Decision], files: &Files) -> PointVerdict { decide(&["Go"], &CAT, rows, decisions, files, AZ).remove(0) }
    fn go(rows: &[RecordRow], decisions: &[Decision]) -> PointVerdict { go_with(rows, decisions, &files()) }
    fn pair<'a>(v: &'a PointVerdict, m: &str) -> &'a Pair { v.pairs.iter().find(|p| p.model_id == m).expect("pair") }
    fn kind(v: &PairVerdict) -> &'static str {
        match v { PairVerdict::NotEnough { .. } => "notEnough", PairVerdict::ReCheck { .. } => "reCheck", PairVerdict::Keep { .. } => "keep", PairVerdict::Offer { .. } => "offer" }
    }
    fn decision(m: &str, action: Action, last: Option<usize>) -> Decision { Decision { landmark_id: "Go".into(), model_id: m.into(), action, last_film: last.map(key) } }
    fn counts(ruler: usize, machine: usize, fit: usize, assumed: usize) -> TierCounts { TierCounts { ruler, machine, fit, assumed } }
    fn track(n: usize, s: f64, az: f64, sr: f64) -> TrackFilm { TrackFilm { key: key(n), mm_per_px: s, incumbent_mm: az, challenger_mm: sr, accepted_unmoved: false } }

    /// Task 1 of plan 2026-10-29: the rule's output on fixed scenarios, captured under best-point/3 BEFORE the base was
    /// made a parameter. With Aariz as the base, every later rule version must give these bytes exactly (spec §3, §9.1).
    /// Each scenario takes a different branch: offer, decline anchor, switch in force, pile order with weighting, keep,
    /// all 19 points, empty.
    fn golden_scenarios() -> Vec<(&'static str, Vec<PointVerdict>)> {
        let ruler_offer = go_films(0, 60, planted(1.0, &[SR]));
        let mut mixed = go_films_on(0, 25, Tier::Machine, 0.15, planted(1.0, &[SR, GU]));
        mixed.extend(go_films_on(25, 60, Tier::Assumed, 0.1, planted(0.5, &[SR, GU, CW])));
        let keep = go_films(0, 60, planted(0.1, &[SR]));
        let all19: Vec<RecordRow> = crate::scores::ORIGINAL_19.iter().enumerate()
            .flat_map(|(i, p)| (0..60).flat_map(move |n| film(n, p, if n % 5 == 0 { "accepted-unmoved" } else { "moved" }, 1.5 + 0.01 * (i + n) as f64, &[(SR, 1.0), (GU, 1.4)]))).collect();
        vec![
            ("ruler offer", decide(&["Go"], &CAT, &ruler_offer, &[], &files(), AZ)),
            ("ruler offer, declined at film 59", decide(&["Go"], &CAT, &ruler_offer, &[decision(SR, Action::Declined, Some(59))], &files(), AZ)),
            ("ruler offer, accepted (no offers after a switch)", decide(&["Go"], &CAT, &ruler_offer, &[decision(SR, Action::Accepted, Some(59))], &files(), AZ)),
            ("machine then assumed piles", decide(&["Go"], &CAT, &mixed, &[], &files(), AZ)),
            ("keep", decide(&["Go"], &CAT, &keep, &[], &files(), AZ)),
            ("all 19 points", decide(&crate::scores::ORIGINAL_19, &CAT, &all19, &[], &files(), AZ)),
            ("nothing at all", decide(&crate::scores::ORIGINAL_19, &CAT, &[], &[], &files(), AZ)),
        ]
    }
    const GOLDEN_3: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/golden/best-point-3.json");
    #[test] fn with_aariz_as_the_base_the_rule_gives_best_point_3s_bytes() {
        let got = serde_json::to_string_pretty(&golden_scenarios()).unwrap() + "\n";
        // Final review M5: writing never passes, so a run with the variable set can never be taken for a check.
        if std::env::var("BEST_GOLDEN_WRITE").is_ok() { std::fs::write(GOLDEN_3, &got).unwrap(); panic!("golden written to {GOLDEN_3}; re-run without BEST_GOLDEN_WRITE"); }
        let want = std::fs::read_to_string(GOLDEN_3).expect("golden file: run once with BEST_GOLDEN_WRITE=1 on best-point/3");
        assert!(got == want, "the rule's output moved from best-point/3's (compare {GOLDEN_3})");
    }


    // ---- The base (plan 2026-10-29 Task 2; spec §3, §9.2, §9.3) ----
    /// Film `n`'s rows for point `p` on a ruler film at 1 mm/px, `placer` placed it (none: hand-placed).
    fn film_by(n: usize, p: &str, how: &str, placer: Option<&str>, dists: &[(&str, f64)]) -> Vec<RecordRow> {
        let k = key(n);
        dists.iter().map(|(m, d)| RecordRow { case_id: k.case_id.clone(), imported_at: k.imported_at.clone(), landmark_id: p.into(),
            model_id: (*m).into(), dist_px: *d, mm_per_px: S, tier: Tier::Ruler, fine_tuned: false, how: how.into(),
            placer: placer == Some(*m), fingerprint: Some(format!("fp-{m}")) }).collect()
    }
    /// GU2Net placed every film; SRPose 0.5 mm closer than GU2Net, but 0.2 mm FURTHER than Aariz.
    fn gu_placed(from: usize, to: usize) -> Vec<RecordRow> {
        (from..to).flat_map(|n| { let gu = 1.5 + 0.05 * (n % 30) as f64;
            film_by(n, "Go", "moved", Some(GU), &[(GU, gu), (SR, gu - 0.5), (AZ, gu - 0.7)]) }).collect()
    }
    #[test] fn the_base_moves_the_answer() {
        let rows = gu_placed(0, 60);
        let with_gu = decide(&["Go"], &CAT, &rows, &[], &files(), GU).remove(0);
        assert_eq!(with_gu.offer.as_deref(), Some(AZ), "against GU2Net, Aariz (0.7 mm closer) is offered first by median");
        assert_eq!(kind(&pair(&with_gu, SR).verdict), "offer", "SRPose beats GU2Net by 0.5 mm too");
        // Aariz is the base here: GU2Net placed every film, so under rule item 1 no film counts.
        let with_az = decide(&["Go"], &CAT, &rows, &[], &files(), AZ).remove(0);
        assert_eq!((with_az.offer.as_deref(), with_az.left_out_other_placer), (None, 60));
    }
    #[test] fn rule_item_1_counts_only_films_the_base_or_the_owner_placed() {
        // 60 films Aariz placed and the owner accepted unmoved: Aariz 0, SRPose 1, GU2Net 3.
        let az_unmoved: Vec<RecordRow> = (0..60).flat_map(|n| film_by(n, "Go", "accepted-unmoved", Some(AZ), &[(AZ, 0.0), (SR, 1.0), (GU, 3.0)])).collect();
        let v = decide(&["Go"], &CAT, &az_unmoved, &[], &files(), GU).remove(0);
        assert_eq!((v.offer.as_deref(), v.left_out_other_placer), (None, 60), "Aariz's free zeros never count for a challenger");
        let hand: Vec<RecordRow> = (0..60).flat_map(|n| film_by(n, "Go", "hand-placed", None, &[(AZ, 0.4), (SR, 1.0), (GU, 3.0)])).collect();
        let h = decide(&["Go"], &CAT, &hand, &[], &files(), GU).remove(0);
        assert_eq!(h.offer.as_deref(), Some(AZ), "hand-placed films count whatever the base");
    }
    #[test] fn a_part_f_switch_to_the_base_is_no_switch() {
        let rows = gu_placed(0, 60);
        let v = decide(&["Go"], &CAT, &rows, &[decision(GU, Action::Accepted, Some(10))], &files(), GU).remove(0);
        assert_eq!((v.current.as_str(), v.offer.is_some()), (GU, true), "offers still start (spec §7)");
    }
    /// Edge cases (plan Task 2 Step 6): a base with no rows at all; the base first or last in the catalogue; no rows.
    #[test] fn a_base_with_no_marks_offers_nothing_and_catalogue_order_does_not_move_the_verdict() {
        let rows = go_films(0, 60, planted(1.0, &[SR]));
        let none = decide(&crate::scores::ORIGINAL_19, &CAT, &rows, &[], &files(), "none-such");
        assert!(none.iter().all(|p| p.offer.is_none() && p.current == "none-such"), "{none:?}");
        let go = none.iter().find(|p| p.landmark_id == "Go").unwrap();
        assert!(go.pairs.iter().all(|x| x.verdict == PairVerdict::NotEnough { films: 0 }), "{:?}", go.pairs);
        let first = decide(&["Go"], &[AZ, CW, GU, SR], &rows, &[], &files(), AZ);
        assert_eq!(first, decide(&["Go"], &CAT, &rows, &[], &files(), AZ), "the base listed first or last: the same verdicts");
        assert!(decide(&["Go"], &CAT, &[], &[], &files(), GU).iter().all(|p| p.pairs.is_empty() && p.offer.is_none()));
    }

    #[test] fn the_rule_constants_are_pinned() {
        assert_eq!((RULE_VERSION, DEFAULT_BASE, BLOCK_FILMS, MIN_TIER_FILMS), ("best-point/4", "aariz-cepha29", 30, 20));
        assert_eq!(SAME_WITH_DEFAULT_BASE, ("best-point/4", &["best-point/3"][..]), "only /3, proved under /4 by the golden file");
        assert!(reproduced_with_default_base("best-point/4") && reproduced_with_default_base("best-point/3"));
        assert!(!reproduced_with_default_base("best-point/1") && !reproduced_with_default_base("best-point/5") && !reproduced_with_default_base(""));
    }
    /// Final review I3: the equivalence was proved for one rule version only. Bump RULE_VERSION (simulated: /5) and the
    /// best-point/3 pre-registration must be refused until someone deliberately re-proves and re-keys it.
    #[test] fn a_later_rule_version_refuses_the_best_point_3_pre_registration() {
        assert!(reproduced_under("best-point/4", "best-point/3"), "control: under /4 the /3 pre-registration is accepted");
        assert!(!reproduced_under("best-point/5", "best-point/3"), "under /5 it is refused");
        assert!(reproduced_under("best-point/5", "best-point/5"), "a pre-registration naming the rule itself is accepted");
        assert_eq!((MIN_MEDIAN_GAIN_MM, WITHIN_MM, MAX_FILM_SHARE, FLOAT_SLACK), (0.3, 2.0, 0.2, 1e-9));
        assert_eq!(TIERS, [Tier::Ruler, Tier::Machine, Tier::Fit, Tier::Assumed]);
    }

    // ---- The positive control (Part F design "Testing") and its two controls ----
    /// Planted 1 mm better on the moved films, with a fifth of the films accepted unmoved (Aariz's free zeros counted):
    /// must be offered, after the look (films 0–29) and the held-back re-check (films 30–59). Every film is a ruler film
    /// of one pixel size, so these are best-point/1's own numbers, unchanged.
    #[test] fn a_model_planted_1_mm_better_is_offered_despite_the_accepted_unmoved_share() {
        let v = go(&go_films(0, 60, planted(1.0, &[SR])), &[]);
        let p = pair(&v, SR);
        let PairVerdict::Offer { look, check } = &p.verdict else { panic!("{:?}", p.verdict) };
        assert_eq!((look.incumbent_median_mm, look.challenger_median_mm), (2.075, 1.075));
        assert_eq!((look.incumbent_plain_median_mm, look.challenger_plain_median_mm), (2.075, 1.075), "every film weighs the same here");
        assert_eq!((look.incumbent_within, look.challenger_within, look.accepted_unmoved), (14, 30, 6));
        assert_eq!((&look.first, &look.last, &check.first, &check.last), (&key(0), &key(29), &key(30), &key(59)));
        assert_eq!(look.case_ids.len(), 30);
        assert!(look.passed && check.passed);
        assert_eq!((p.basis, p.films, p.accepted_unmoved), (Some(Tier::Ruler), 60, 12));
        assert_eq!((v.offer.as_deref(), v.offer_basis, v.current.as_str()), (Some(SR), Some(Tier::Ruler), AZ), "offered, not switched");
    }
    /// Planted equal on the moved films (and 1 mm off Aariz's mark on the accepted ones): must not be offered.
    #[test] fn a_model_planted_equal_is_not_offered() {
        let v = go(&go_films(0, 60, planted(0.0, &[SR])), &[]);
        assert_eq!(kind(&pair(&v, SR).verdict), "keep");
        assert_eq!(v.offer, None);
    }
    /// Equal on every film, the accepted ones included (both pins on Aariz's mark): must not be offered.
    #[test] fn a_model_equal_on_every_film_is_not_offered() {
        let v = go(&go_films(0, 60, |n| { let (how, az, _) = planted(0.0, &[SR])(n); (how, az, vec![(SR, az)]) }), &[]);
        assert_eq!((kind(&pair(&v, SR).verdict), v.offer.clone()), ("keep", None));
    }
    /// The F1 trap working as designed: 16 of 30 accepted unmoved puts Aariz's median at 0 mm, so even a model 2 mm
    /// better on every moved film cannot be offered.
    #[test] fn more_than_half_accepted_unmoved_holds_aariz_by_design() {
        let v = go(&go_films(0, 60, |n| if n % 30 < 16 { ("accepted-unmoved", 0.0, vec![(SR, 0.5)]) } else { ("moved", 3.0, vec![(SR, 1.0)]) }), &[]);
        let PairVerdict::Keep { look, .. } = &pair(&v, SR).verdict else { panic!() };
        assert_eq!((look.incumbent_median_mm, look.challenger_median_mm, look.accepted_unmoved), (0.0, 0.5, 16));
        assert_eq!(v.offer, None);
    }

    /// Final review M3: both sides in mm at a scale other than 1 mm per px. On ruler films at 0.15 mm per px, Aariz is
    /// 10 px off (1.5 mm) and SRPose 9 px (1.35 mm): a gain of 0.15 mm, under the 0.3 mm mark, so no offer. If either
    /// side lost its film's scale (raw pixels), a median would read 10 or 9 and the verdict would flip (Aariz "10 mm off"
    /// against SRPose's 1.35 mm passes easily). The tests at 1 mm per px cannot see that slip: there px and mm agree.
    #[test] fn both_sides_are_in_mm_at_a_scale_other_than_one_mm_per_px() {
        let v = go(&go_films_on(0, 60, Tier::Ruler, 0.15, |_| ("moved", 10.0, vec![(SR, 9.0)])), &[]);
        let p = pair(&v, SR);
        let PairVerdict::Keep { look, .. } = &p.verdict else { panic!("{:?}", p.verdict) };
        assert!((look.incumbent_median_mm - 1.5).abs() < 1e-9 && (look.challenger_median_mm - 1.35).abs() < 1e-9,
            "Aariz {} mm, SRPose {} mm", look.incumbent_median_mm, look.challenger_median_mm);
        assert!((look.incumbent_mean_mm - 1.5).abs() < 1e-9 && (look.challenger_mean_mm - 1.35).abs() < 1e-9);
        assert_eq!((look.incumbent_within, look.challenger_within, look.passed), (30, 30, false));
        assert_eq!(v.offer, None);
    }

    /// Final review I-3: the worked example in docs/PART-F-METHODOLOGY.md §4 is exactly what `decide` gives; change one and
    /// the other must change with it. Gonion, 60 ruler films at 0.1 mm per px (every film weighs the same). In each block
    /// of 30, films 1–8 are accepted unmoved (Aariz 0 mm, SRPose 0.8 mm from Aariz's mark); on the other 22, Aariz is
    /// 1.5, 1.6 … 3.6 mm off and SRPose 0.7 mm closer on films 1–30 and 0.4 mm closer on films 31–60. Fewer than half are
    /// accepted unmoved, so Aariz's median is not 0 (note §3), but the 8 free zeros still pull it down.
    #[test] fn the_methodology_worked_example_is_what_the_rule_gives() {
        let rows = go_films_on(0, 60, Tier::Ruler, 0.1, |n| {
            let (j, gain_px) = (n % 30, if n < 30 { 7.0 } else { 4.0 });
            if j < 8 { ("accepted-unmoved", 0.0, vec![(SR, 8.0)]) } else { let az = 15.0 + (j - 8) as f64; ("moved", az, vec![(SR, az - gain_px)]) }
        });
        let v = go(&rows, &[]);
        let p = pair(&v, SR);
        let PairVerdict::Offer { look, check } = &p.verdict else { panic!("{:?}", p.verdict) };
        let r2 = |x: f64| (x * 100.0).round() / 100.0;
        let quote = |b: &BlockStats| (r2(b.incumbent_median_mm), r2(b.challenger_median_mm), b.incumbent_within, b.challenger_within, b.accepted_unmoved, b.passed);
        println!("[I-3] look {:?}; re-check {:?}; basis {:?} {} films", quote(look), quote(check), p.basis, p.films);
        assert_eq!(quote(look), (2.15, 1.45, 14, 21, 8, true));
        assert_eq!(quote(check), (2.15, 1.75, 14, 18, 8, true));
        assert_eq!((p.basis, p.films, v.offer.as_deref()), (Some(Tier::Ruler), 60, Some(SR)));
        assert_eq!(basis_words(p.basis.unwrap(), p.films), "mm, 60 ruler films");
    }

    // ---- Film counts ----
    #[test] fn zero_films_give_no_pairs_for_every_point() {
        let all = decide(&crate::scores::ORIGINAL_19, &CAT, &[], &[], &files(), AZ);
        assert_eq!(all.iter().map(|p| p.landmark_id.as_str()).collect::<Vec<_>>(), crate::scores::ORIGINAL_19.to_vec());
        assert!(all.iter().all(|p| p.pairs.is_empty() && p.offer.is_none() && p.offer_basis.is_none() && p.current == AZ
            && p.films_by_scale == TierCounts::default() && p.fine_tuned_ruler == 0 && p.left_out_other_placer == 0));
    }
    #[test] fn twenty_nine_films_are_not_enough() {
        let v = go(&go_films(0, 29, planted(1.0, &[SR])), &[]);
        assert_eq!((pair(&v, SR).basis, pair(&v, SR).verdict.clone()), (Some(Tier::Ruler), PairVerdict::NotEnough { films: 29 }));
        assert_eq!(v.offer, None);
    }
    #[test] fn exactly_thirty_passing_films_start_the_re_check() {
        let v = go(&go_films(0, 30, planted(1.0, &[SR])), &[]);
        assert!(matches!(pair(&v, SR).verdict, PairVerdict::ReCheck { films: 0, .. }), "{:?}", pair(&v, SR).verdict);
        assert_eq!(v.offer, None, "never offered on the look alone");
    }
    #[test] fn fifty_nine_films_wait_and_sixty_offer() {
        assert!(matches!(pair(&go(&go_films(0, 59, planted(1.0, &[SR])), &[]), SR).verdict, PairVerdict::ReCheck { films: 29, .. }));
        assert_eq!(kind(&pair(&go(&go_films(0, 60, planted(1.0, &[SR])), &[]), SR).verdict), "offer");
    }

    // ---- Boundaries ----
    #[test] fn a_gain_of_exactly_0_3_mm_passes_and_0_29_does_not() {
        // 2.3 − 2.0 is 0.2999999999999998 in floating point: the slack makes it count as 0.3.
        assert_eq!(go(&go_films(0, 60, |_| ("moved", 2.3, vec![(SR, 2.0)])), &[]).offer.as_deref(), Some(SR));
        assert_eq!(go(&go_films(0, 60, |_| ("moved", 2.29, vec![(SR, 2.0)])), &[]).offer, None);
    }
    #[test] fn two_mm_counts_as_within_and_an_equal_share_passes_but_one_film_worse_fails() {
        // Aariz 1.0 on every film (30 within). SRPose 0.5, but exactly 2.0 on one film: still 30 within, passes.
        assert_eq!(go(&go_films(0, 60, |n| ("moved", 1.0, vec![(SR, if n % 30 == 7 { 2.0 } else { 0.5 })])), &[]).offer.as_deref(), Some(SR));
        // 2.01 on that film: 29 within against Aariz's 30, one film worse: fails, although its median is 0.5 mm lower.
        assert_eq!(go(&go_films(0, 60, |n| ("moved", 1.0, vec![(SR, if n % 30 == 7 { 2.01 } else { 0.5 })])), &[]).offer, None);
        // Both 2.5 on that film: 29 and 29, equal: passes.
        assert_eq!(go(&go_films(0, 60, |n| if n % 30 == 7 { ("moved", 2.5, vec![(SR, 2.5)]) } else { ("moved", 1.0, vec![(SR, 0.5)]) }), &[]).offer.as_deref(), Some(SR));
    }

    // ---- Which films count ----
    #[test] fn a_model_missing_on_some_films_is_judged_only_on_the_films_it_has() {
        let v = go(&go_films(0, 60, |n| { let (how, az, mut o) = planted(1.0, &[GU, SR])(n); if n % 2 == 1 { o.retain(|(m, _)| *m != SR); } (how, az, o) }), &[]);
        assert_eq!((pair(&v, GU).films, kind(&pair(&v, GU).verdict)), (60, "offer"));
        assert_eq!((pair(&v, SR).films, kind(&pair(&v, SR).verdict)), (30, "reCheck"), "SRPose ran on the even films only");
        let PairVerdict::ReCheck { look, .. } = &pair(&v, SR).verdict else { panic!() };
        assert_eq!((&look.first, &look.last), (&key(0), &key(58)), "Aariz judged on the same 30 films as SRPose");
        assert_eq!(v.offer.as_deref(), Some(GU));
    }
    /// Owner E1 (26 Oct): a film without a ruler is never left out; it joins its scale group, which decides only when
    /// the ruler films are too few. Here 50 ruler films decide; the 10 assumed films wait.
    #[test] fn films_without_a_ruler_join_their_scale_group_and_wait_while_ruler_films_suffice() {
        let rows: Vec<RecordRow> = go_films(0, 60, planted(1.0, &[SR])).into_iter()
            .map(|mut r| { if r.case_id.as_str() < "c010" { r.tier = Tier::Assumed; } r }).collect();
        let v = go(&rows, &[]);
        assert_eq!(v.films_by_scale, counts(50, 0, 0, 10));
        let p = pair(&v, SR);
        assert_eq!((p.basis, p.films, p.available), (Some(Tier::Ruler), 50, counts(50, 0, 0, 10)));
        assert!(matches!(p.verdict, PairVerdict::ReCheck { films: 20, .. }), "{:?}", p.verdict);
    }
    #[test] fn films_placed_by_another_model_are_left_out_and_counted() {
        let mut rows = go_films(0, 60, planted(1.0, &[SR]));
        for n in 60..65 {   // traced before 15 Oct: cwlachap placed Gonion and it was accepted unmoved
            rows.extend(film(n, "Go", "accepted-unmoved", 1.2, &[(SR, 1.0), (CW, 0.0)]).into_iter()
                .map(|mut r| { r.placer = r.model_id == CW; r }));
        }
        let v = go(&rows, &[]);
        assert_eq!((v.left_out_other_placer, pair(&v, SR).films), (5, 60));
        assert!(v.pairs.iter().all(|p| p.model_id != CW), "cwlachap appears only on films that do not count");
        assert_eq!(v.offer.as_deref(), Some(SR));
    }
    #[test] fn hand_placed_films_count_and_carry_no_free_zero() {
        let v = go(&go_films(0, 60, |n| ("hand-placed", 1.5 + 0.05 * (n % 30) as f64, vec![(SR, 0.5 + 0.05 * (n % 30) as f64)])), &[]);
        assert_eq!((pair(&v, SR).films, pair(&v, SR).accepted_unmoved, v.offer.as_deref()), (60, 0, Some(SR)));
    }
    /// A ruler fine-tuned by eye (±0.5 % presses) stays a ruler film, and is counted so the
    /// owner sees how many (question 3).
    #[test] fn fine_tuned_ruler_films_count_as_ruler_films_and_are_counted() {
        let rows: Vec<RecordRow> = go_films(0, 60, planted(1.0, &[SR])).into_iter()
            .map(|mut r| { if r.case_id.as_str() < "c007" { r.fine_tuned = true; } r }).collect();
        let v = go(&rows, &[]);
        assert_eq!((v.fine_tuned_ruler, pair(&v, SR).films, v.offer.as_deref()), (7, 60, Some(SR)));
    }

    // ---- Looks, ties and answers ----
    #[test] fn a_failed_look_or_re_check_keeps_aariz_and_no_film_is_looked_at_twice() {
        assert!(matches!(go(&go_films(0, 30, |_| ("moved", 1.0, vec![(SR, 1.0)])), &[]).pairs[0].verdict, PairVerdict::Keep { check: None, films: 0, .. }));
        // Look passes (0–29), re-check fails (30–59): keep. The next block (60–89) is a fresh look, not the failed re-check.
        let rows = go_films(0, 90, |n| if (30..60).contains(&n) { ("moved", 1.0, vec![(SR, 1.0)]) } else { planted(1.0, &[SR])(n) });
        let at60 = go(&rows[..60 * 2], &[]);   // two rows per film (Aariz, SRPose): films 0–59
        assert!(matches!(&at60.pairs[0].verdict, PairVerdict::Keep { check: Some(c), .. } if !c.passed));
        let at90 = go(&rows, &[]);
        let PairVerdict::ReCheck { look, films: 0 } = &at90.pairs[0].verdict else { panic!("{:?}", at90.pairs[0].verdict) };
        assert_eq!(look.first, key(60));
    }
    #[test] fn ties_go_to_the_lower_re_check_median_then_more_within_2_mm_then_the_models_list_order() {
        assert_eq!(go(&go_films(0, 60, planted(1.0, &[GU, SR])), &[]).offer.as_deref(), Some(GU), "identical: the Models… list order");
        let v = go(&go_films(0, 60, |n| { let (how, az, _) = planted(1.0, &[SR])(n);
            (how, az, vec![(GU, if how == "moved" { az - 0.5 } else { 1.0 }), (SR, if how == "moved" { az - 1.0 } else { 1.0 })]) }), &[]);
        assert_eq!(v.offer.as_deref(), Some(SR), "the lower re-check median");
        let w = go(&go_films(0, 60, |n| if n % 30 == 7 { ("moved", 2.5, vec![(GU, 2.5), (SR, 0.5)]) } else { ("moved", 1.0, vec![(GU, 0.5), (SR, 0.5)]) }), &[]);
        assert_eq!(w.offer.as_deref(), Some(SR), "same median: more within 2 mm");
    }
    #[test] fn a_decline_moves_the_next_look_past_its_films() {
        let d = [decision(SR, Action::Declined, Some(59))];
        let v = go(&go_films(0, 60, planted(1.0, &[SR])), &d);
        assert_eq!((pair(&v, SR).verdict.clone(), v.offer.clone()), (PairVerdict::NotEnough { films: 0 }, None));
        let later = go(&go_films(0, 120, planted(1.0, &[SR])), &d);
        let PairVerdict::Offer { look, .. } = &pair(&later, SR).verdict else { panic!() };
        assert_eq!(look.first, key(60));
    }
    #[test] fn an_accepted_switch_ends_offers_for_that_point_and_undo_restores_aariz() {
        let rows = go_films(0, 60, planted(1.0, &[SR]));
        let accepted = [decision(SR, Action::Accepted, Some(59))];
        let v = go(&rows, &accepted);
        assert_eq!((v.current.as_str(), v.pairs.len(), v.offer.clone()), (SR, 0, None));
        assert_eq!(current_choices(&accepted), BTreeMap::from([("Go".to_string(), SR.to_string())]));
        let undone = [decision(SR, Action::Accepted, Some(59)), decision(SR, Action::Undone, None)];
        let u = go(&rows, &undone);
        assert_eq!((u.current.as_str(), pair(&u, SR).verdict.clone()), (AZ, PairVerdict::NotEnough { films: 0 }), "the next look starts after the accepted films");
        assert!(current_choices(&undone).is_empty());
        assert!(current_choices(&[decision(SR, Action::Declined, Some(59))]).is_empty(), "a decline switches nothing");
    }
    #[test] fn the_verdict_serialises_in_the_shape_the_screen_reads() {
        let v = go(&go_films(0, 60, planted(1.0, &[SR])), &[]);
        let j = serde_json::to_value(&v).unwrap();
        assert_eq!((j["landmarkId"].as_str(), j["offer"].as_str(), j["offerBasis"].as_str()), (Some("Go"), Some(SR), Some("ruler")));
        assert_eq!(j["filmsByScale"], serde_json::json!({ "ruler": 60, "machine": 0, "fit": 0, "assumed": 0 }));
        assert_eq!((j["pairs"][0]["basis"].as_str(), j["pairs"][0]["films"].as_u64(), j["fineTunedRuler"].as_u64()), (Some("ruler"), Some(60), Some(0)));
        assert_eq!(j["pairs"][0]["verdict"]["kind"], "offer");
        assert_eq!(j["pairs"][0]["verdict"]["check"]["challengerMedianMm"], 1.075);
        assert!(j["pairs"][0]["verdict"]["check"]["challengerPlainMeanMm"].is_f64() && j["pairs"][0]["verdict"]["check"]["challengerWithinShare"].is_f64());
        assert_eq!(j["pairs"][0]["verdict"]["look"]["first"]["caseId"], "c000");
        assert_eq!(j["pairs"][0]["leftOutEarlierFile"], 0);
    }

    // ---- Which file made each mark (owner Q9, 18 Oct: start a model afresh when its file changes) ----
    /// SRPose's marks on films 0–29 came from its earlier file: only films 30–59 count for it, and the 30 are counted.
    #[test] fn marks_from_an_earlier_model_file_do_not_count_and_are_counted_as_left_out() {
        let rows: Vec<RecordRow> = go_films(0, 60, planted(1.0, &[SR])).into_iter()
            .map(|mut r| { if r.model_id == SR && r.case_id.as_str() < "c030" { r.fingerprint = Some("fp-old".into()); } r }).collect();
        let v = go(&rows, &[]);
        let p = pair(&v, SR);
        assert_eq!((p.films, p.left_out_earlier_file), (30, 30));
        let PairVerdict::ReCheck { look, films: 0 } = &p.verdict else { panic!("{:?}", p.verdict) };
        assert_eq!(look.first, key(30), "the new file's look starts on its own films");
        assert_eq!(v.offer, None);
    }
    /// A film the earlier file ran on never counts for the new file, even after a re-run gave it a mark from the new
    /// file (owner Q4: offers use fresh films; older films serve the weights check only).
    #[test] fn a_film_an_earlier_file_ran_on_never_counts_for_the_new_file() {
        let mut f = files();
        f.earlier.extend((0..30).map(|n| (key(n).case_id, SR.to_string())));
        let v = go_with(&go_films(0, 60, planted(1.0, &[SR])), &[], &f);
        assert_eq!((pair(&v, SR).films, pair(&v, SR).left_out_earlier_file), (30, 30));
        assert!(matches!(pair(&v, SR).verdict, PairVerdict::ReCheck { films: 0, .. }));
    }
    /// A new Aariz file restarts every pair; a model not installed, or a mark whose file is unknown, counts nothing.
    #[test] fn a_new_aariz_file_restarts_every_pair_and_an_unknown_or_missing_file_counts_nothing() {
        let mut f = files();
        f.current.insert(AZ.into(), "fp-aariz-new".into());
        let v = go_with(&go_films(0, 60, planted(1.0, &[GU, SR])), &[], &f);
        assert!(v.pairs.iter().all(|p| p.films == 0 && p.basis.is_none() && p.left_out_earlier_file == 60 && p.verdict == PairVerdict::NotEnough { films: 0 }), "{:?}", v.pairs);
        assert_eq!(v.offer, None);
        let mut gone = files();
        gone.current.remove(SR);
        assert_eq!(pair(&go_with(&go_films(0, 60, planted(1.0, &[SR])), &[], &gone), SR).films, 0, "SRPose not installed");
        let unknown: Vec<RecordRow> = go_films(0, 60, planted(1.0, &[SR])).into_iter()
            .map(|mut r| { if r.model_id == SR { r.fingerprint = None; } r }).collect();
        assert_eq!(pair(&go(&unknown, &[]), SR).films, 0, "a mark whose file is unknown never counts");
    }

    // ---- Scale groups (owner E2, E4, 26 Oct) ----
    /// 19 ruler films are too few, so the 40 machine films decide; the 40 assumed films (imported first, SRPose worse on
    /// them) are never pooled in: a rule that pooled them would fail the look.
    #[test] fn a_scale_group_with_fewer_than_20_films_gives_way_to_the_next_and_none_are_pooled() {
        let mut rows = go_films_on(0, 40, Tier::Assumed, S, |_| ("moved", 1.0, vec![(SR, 2.0)]));
        rows.extend(go_films_on(40, 59, Tier::Ruler, S, planted(1.0, &[SR])));
        rows.extend(go_films_on(59, 99, Tier::Machine, S, planted(1.0, &[SR])));
        let v = go(&rows, &[]);
        let p = pair(&v, SR);
        assert_eq!((p.basis, p.films, p.available), (Some(Tier::Machine), 40, counts(19, 40, 0, 40)));
        let PairVerdict::ReCheck { look, films: 10 } = &p.verdict else { panic!("{:?}", p.verdict) };
        assert_eq!((&look.first, &look.last), (&key(59), &key(88)), "the look is the first 30 machine films");
    }
    /// 20 ruler films decide alone, even before they fill a block: Aariz stays while they wait, though the machine films
    /// would offer. With 19, the machine films decide and offer.
    #[test] fn twenty_ruler_films_decide_alone_and_nineteen_do_not() {
        let rows = |ruler: usize| { let mut r = go_films_on(0, 60, Tier::Machine, S, planted(1.0, &[SR]));
            r.extend(go_films_on(60, 60 + ruler, Tier::Ruler, S, planted(1.0, &[SR]))); r };
        let twenty = go(&rows(20), &[]);
        assert_eq!((pair(&twenty, SR).basis, pair(&twenty, SR).verdict.clone(), twenty.offer.clone()), (Some(Tier::Ruler), PairVerdict::NotEnough { films: 20 }, None));
        let nineteen = go(&rows(19), &[]);
        assert_eq!((pair(&nineteen, SR).basis, nineteen.offer.as_deref(), nineteen.offer_basis), (Some(Tier::Machine), Some(SR), Some(Tier::Machine)));
    }
    /// No scale group reaches 20 films: nothing decides and Aariz stays (owner E4), however good the other model.
    #[test] fn no_scale_group_with_20_films_keeps_aariz() {
        let mut rows = go_films_on(0, 15, Tier::Ruler, S, |_| ("moved", 3.0, vec![(SR, 0.1)]));
        rows.extend(go_films_on(15, 30, Tier::Machine, S, |_| ("moved", 3.0, vec![(SR, 0.1)])));
        rows.extend(go_films_on(30, 49, Tier::Assumed, S, |_| ("moved", 3.0, vec![(SR, 0.1)])));
        let v = go(&rows, &[]);
        let p = pair(&v, SR);
        assert_eq!((p.basis, p.films, p.available, p.verdict.clone()), (None, 0, counts(15, 15, 0, 19), PairVerdict::NotEnough { films: 0 }));
        assert_eq!(v.offer, None);
    }
    /// The more accurate deciding group wins a tie of offers, before the numbers: SRPose's assumed-scale median is
    /// lower than GU2Net's ruler median, and still loses.
    #[test] fn a_more_accurate_scale_group_wins_between_two_offers() {
        let mut rows = go_films(0, 60, planted(1.0, &[GU]));
        rows.extend(go_films_on(60, 120, Tier::Assumed, S, |_| ("moved", 1.0, vec![(SR, 0.05)])));
        let v = go(&rows, &[]);
        assert_eq!((kind(&pair(&v, GU).verdict), kind(&pair(&v, SR).verdict)), ("offer", "offer"));
        assert_eq!((pair(&v, SR).basis, v.offer.as_deref(), v.offer_basis), (Some(Tier::Assumed), Some(GU), Some(Tier::Ruler)));
    }

    // ---- Resolution weighting and its cap (owner E3, 26 Oct) ----
    /// Positive control for the weighting: on 15 fine films (0.10 mm per px) SRPose is 1 mm closer than Aariz, on 15
    /// coarse films (0.15 mm per px) 1 mm further. Unweighted the medians tie and the block fails; weighted 1 / mm per px
    /// the fine films count 1.5×, and the block passes.
    #[test] fn a_finer_image_counts_more_and_moves_the_verdict() {
        let films = |fine: f64, coarse: f64| -> Vec<TrackFilm> {
            (0..30).map(|n| if n < 15 { track(n, fine, 2.5, 1.5) } else { track(n, coarse, 1.5, 2.5) }).collect() };
        let weighted = block(&films(0.10, 0.15));
        assert_eq!((weighted.incumbent_median_mm, weighted.challenger_median_mm, weighted.passed), (2.5, 1.5, true));
        assert_eq!((weighted.incumbent_plain_median_mm, weighted.challenger_plain_median_mm), (2.0, 2.0), "the plain medians tie");
        assert_eq!((weighted.incumbent_within, weighted.challenger_within), (15, 15));
        let plain = block(&films(0.10, 0.10));
        assert_eq!((plain.incumbent_median_mm, plain.challenger_median_mm, plain.passed), (2.0, 2.0, false), "one pixel size: no weighting, no pass");
    }
    #[test] fn the_weighted_median_with_equal_weights_is_the_plain_median() {
        let lists: Vec<Vec<f64>> = vec![vec![3.0, 1.0, 2.0], vec![4.0, 1.0, 3.0, 2.0], vec![0.0; 30], (0..30).map(|i| (i * 7 % 30) as f64 * 0.05).collect()];
        for v in &lists {
            for w in [1.0, 10.0, 1.0 / 0.15] {
                assert_eq!(weighted_median(v, &vec![w; v.len()]), median(v), "{v:?} at weight {w}");
            }
        }
    }
    /// Positive control for the cap (owner E3): one very sharp film in a small group would carry 71 % of the weight;
    /// capped at a fifth, the excess goes to the others in proportion.
    #[test] fn one_very_sharp_film_in_a_small_group_is_capped_at_a_fifth() {
        let five = shares(&[0.01, 0.1, 0.1, 0.1, 0.1]);
        assert!(five.iter().all(|x| (x - 0.2).abs() < 1e-12), "{five:?}");
        let six = shares(&[0.05, 0.1, 0.1, 0.1, 0.1, 0.1]);
        assert!((six[0] - 0.2).abs() < 1e-12 && six[1..].iter().all(|x| (x - 0.16).abs() < 1e-12), "{six:?}");
        assert!((six.iter().sum::<f64>() - 1.0).abs() < 1e-12);
        let even = shares(&[0.1; 30]);
        assert!(even.iter().all(|x| (x - 1.0 / 30.0).abs() < 1e-15), "nobody near the cap: plain 1/30 each");
        assert_eq!(shares(&[0.1]), vec![1.0], "a group too small for the cap weighs its films the same");
    }
    /// The cap's effect on a verdict: in a block of 30, one film at 0.001 mm per px where SRPose is 5 mm closer would
    /// carry 77 % of the weight and decide alone; capped at a fifth, the 29 films where the two are equal decide.
    #[test] fn a_capped_sharp_film_cannot_decide_a_block_alone() {
        let films: Vec<TrackFilm> = (0..30).map(|n| if n == 0 { track(n, 0.001, 5.0, 0.0) } else { track(n, 0.1, 1.0, 1.0) }).collect();
        let b = block(&films);
        assert_eq!((b.incumbent_median_mm, b.challenger_median_mm, b.passed), (1.0, 1.0, false));
    }
    #[test] fn the_deciding_group_is_named_in_plain_words() {
        assert_eq!(basis_words(Tier::Ruler, 60), "mm, 60 ruler films");
        assert_eq!(basis_words(Tier::Machine, 45), "mm via machine scale, 45 films");
        assert_eq!(basis_words(Tier::Fit, 30), "mm via fit scale, 30 films");
        assert_eq!(basis_words(Tier::Assumed, 61), "mm via assumed scale (an estimate), 61 films");
    }

    // ---- Fix round 1 (task review, 27 Oct) ----
    /// `Files` crosses the same boundary as the other inputs: it reads and writes JSON in the shape the store will hand
    /// over (model → file now; [case id, model id] for each film an earlier file ran on).
    #[test] fn files_round_trip_through_json_in_camel_case() {
        let mut f = Files { current: BTreeMap::from([(SR.to_string(), "fp-sr".to_string())]), earlier: BTreeSet::new() };
        f.earlier.insert(("c000".to_string(), SR.to_string()));
        let j = serde_json::to_value(&f).unwrap();
        assert_eq!(j, serde_json::json!({ "current": { SR: "fp-sr" }, "earlier": [["c000", SR]] }));
        assert_eq!(serde_json::from_value::<Files>(j).unwrap(), f);
        assert_eq!(serde_json::from_value::<Files>(serde_json::json!({ "current": {}, "earlier": [] })).unwrap(), Files::default(), "nothing installed");
    }
    /// A share of films within 2 mm is never negative: with no film within 2 mm (Aariz 3.0, SRPose 2.5 on every film,
    /// so both shares are empty sums) it is stored as 0.0, not -0.0.
    #[test] fn a_share_with_no_film_within_2_mm_is_stored_as_zero_not_minus_zero() {
        let v = go(&go_films(0, 60, |_| ("moved", 3.0, vec![(SR, 2.5)])), &[]);
        let PairVerdict::Offer { look, check } = &pair(&v, SR).verdict else { panic!("{:?}", pair(&v, SR).verdict) };
        for b in [look, check] {
            assert_eq!((b.incumbent_within, b.challenger_within), (0, 0));
            assert_eq!((b.incumbent_within_share.to_bits(), b.challenger_within_share.to_bits()), (0, 0), "+0.0, not -0.0");
        }
        let text = serde_json::to_string(&v).unwrap();
        assert!(text.contains("\"incumbentWithinShare\":0.0") && text.contains("\"challengerWithinShare\":0.0"), "{text}");
        assert!(!text.contains("-0.0"), "{text}");
    }
    /// An empty list has no middle value: `median` and `weighted_median` say so (None) instead of panicking; so do
    /// weights that are all zero. A non-empty list gives its middle as before.
    #[test] fn an_empty_list_has_no_median_and_does_not_panic() {
        assert_eq!(median(&[]), None);
        assert_eq!(weighted_median(&[], &[]), None);
        assert_eq!(weighted_median(&[1.0, 2.0], &[0.0, 0.0]), None, "no weight, no middle");
        assert_eq!((median(&[2.0]), median(&[3.0, 1.0])), (Some(2.0), Some(2.0)));
        assert_eq!(weighted_median(&[2.0], &[1.0]), Some(2.0));
    }
    /// The fine-tune flag means a ruler adjusted by eye. A film whose scale is not its ruler (machine, fit or assumed)
    /// cannot have that, so a stray flag there is not counted as a fine-tuned ruler film, and the film stays in its
    /// own scale group, counted and judged like any other.
    #[test] fn a_fine_tune_flag_on_a_film_without_a_ruler_scale_is_not_counted_and_the_film_stays_in_its_group() {
        let mut rows: Vec<RecordRow> = go_films_on(0, 60, Tier::Machine, S, planted(1.0, &[SR])).into_iter()
            .map(|mut r| { if r.case_id.as_str() < "c005" { r.fine_tuned = true; } r }).collect();
        let v = go(&rows, &[]);
        assert_eq!((v.fine_tuned_ruler, v.films_by_scale, pair(&v, SR).basis, v.offer.as_deref()), (0, counts(0, 60, 0, 0), Some(Tier::Machine), Some(SR)));
        rows.extend(go_films_on(60, 67, Tier::Ruler, S, planted(1.0, &[SR])).into_iter().map(|mut r| { r.fine_tuned = true; r }));
        let w = go(&rows, &[]);
        assert_eq!((w.fine_tuned_ruler, w.films_by_scale), (7, counts(7, 60, 0, 0)), "only the 7 ruler films count as fine-tuned");
    }
}
