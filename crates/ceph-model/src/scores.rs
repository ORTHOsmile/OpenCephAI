//! Point-status table for the new (non-original-19) landmarks (spec 2026-10-07 Part B, task 6).
//! Reads the committed `reference/model-scores.json` — one object per bench run, each carrying
//! {dataset, split, modelId, points{<landmark>: {n, mre, ...}}} — and turns a model+landmark pair
//! into a status an orthodontist can read directly: the point is one of the original 19 the app
//! always places, a new point scored at or under the owner's gate, a new point scored over the
//! gate (a ghost suggestion only), or a new point with no score on the gate dataset/split at all.
use serde::{Deserialize, Serialize};

/// The 19 points the app always places; owner ruling R-B2 (7 Oct 2026) never gates these, however
/// a model's Aariz test score for them reads.
pub const ORIGINAL_19: [&str; 19] =
    ["S", "N", "Or", "Po", "A", "B", "Pog", "Me", "Gn", "Go", "L1T", "U1T", "UL", "LL", "Sn", "PogS", "PNS", "ANS", "Ar"];
/// Owner ruling R-B2, 7 Oct 2026: a new point is placed automatically only at mean radial error at
/// or under this many millimetres on the gate dataset/split; above it, a ghost suggestion only.
pub const GATE_MM: f64 = 2.0;
/// The one dataset/split the gate reads from (R-B2): Aariz's held-out test split.
pub const GATE_DATASET: (&str, &str) = ("aariz", "test");

/// The embedded score table: `reference/model-scores.json`, one object per bench run.
const EMBEDDED: &str = include_str!("../../../reference/model-scores.json");

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PointStatus {
    /// One of `ORIGINAL_19`: always placed, never gated by any score.
    Original,
    /// A new point scored at or under `GATE_MM` on the gate dataset/split: placed automatically.
    Scored { mre: f64, n: usize, dataset: String },
    /// A new point scored over `GATE_MM` on the gate dataset/split: a ghost suggestion only.
    TooFar { mre: f64, n: usize, dataset: String },
    /// A new point with no score on the gate dataset/split for this model.
    NotScored,
}

/// One bench run's score for one landmark, as read back out of a row for the "names only
/// catalogue models" check.
#[derive(Clone, Debug, Deserialize)]
struct PointScore {
    n: usize,
    mre: f64,
}

#[derive(Clone, Debug, Deserialize)]
struct ScoreRow {
    dataset: String,
    split: String,
    #[serde(rename = "modelId")]
    model_id: String,
    points: std::collections::BTreeMap<String, PointScore>,
}

/// One row of the committed table, for `tests/scores.rs`'s "names only catalogue models" check.
pub struct Row {
    pub model_id: String,
}

/// The committed table's model IDs, one `Row` per bench-run object in `reference/model-scores.json`.
pub fn rows() -> Vec<Row> {
    parse(EMBEDDED).into_iter().map(|r| Row { model_id: r.model_id }).collect()
}

fn parse(table: &str) -> Vec<ScoreRow> {
    serde_json::from_str(table).expect("model-scores.json is valid (tests/scores.rs: the_committed_table_parses)")
}

/// Rejects a table that carries two rows for the same (modelId, dataset, split): there is no
/// correct way to pick between them, so a table that commits this is a bug, not an ambiguity for
/// `status_in` to paper over. The committed-table test (`tests/scores.rs`) calls this on
/// `reference/model-scores.json` before anything else trusts it; `status_in` assumes it has
/// already been validated and would panic (see below) rather than silently pick one row if it
/// hasn't been.
pub fn validate(table: &str) -> Result<(), String> {
    let rows = parse(table);
    let mut seen = std::collections::BTreeSet::new();
    for r in &rows {
        let key = (r.model_id.clone(), r.dataset.clone(), r.split.clone());
        if !seen.insert(key.clone()) {
            return Err(format!(
                "duplicate row for modelId {:?}, dataset {:?}, split {:?}",
                key.0, key.1, key.2
            ));
        }
    }
    Ok(())
}

/// `status`, against an arbitrary table (so tests don't depend on the real scores).
///
/// Assumes `table` has already passed `validate` (as `reference/model-scores.json` is, by
/// `tests/scores.rs::the_committed_table_parses_and_names_only_catalogue_models`): at most one row
/// per (modelId, dataset, split). If that invariant is broken — two rows claim the same gate
/// dataset/split for the same model — there is no correct row to prefer, so this panics rather
/// than silently returning one row's score (or `NotScored`) as if the conflict did not exist.
pub fn status_in(table: &str, model_id: &str, landmark: &str) -> PointStatus {
    if ORIGINAL_19.contains(&landmark) {
        return PointStatus::Original;
    }
    let rows = parse(table);
    let mut matches = rows.iter().filter(|r| {
        r.model_id == model_id && r.dataset == GATE_DATASET.0 && r.split == GATE_DATASET.1
    });
    let Some(row) = matches.next() else { return PointStatus::NotScored };
    assert!(
        matches.next().is_none(),
        "scores table has more than one {:?}/{:?} row for model {model_id:?}: ambiguous, refusing to silently pick one (see validate)",
        GATE_DATASET.0, GATE_DATASET.1
    );
    let Some(score) = row.points.get(landmark) else { return PointStatus::NotScored };
    if score.mre <= GATE_MM {
        PointStatus::Scored { mre: score.mre, n: score.n, dataset: row.dataset.clone() }
    } else {
        PointStatus::TooFar { mre: score.mre, n: score.n, dataset: row.dataset.clone() }
    }
}

/// A landmark's status for a given model, read from the committed `reference/model-scores.json`.
pub fn status(model_id: &str, landmark: &str) -> PointStatus {
    status_in(EMBEDDED, model_id, landmark)
}
