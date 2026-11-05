//! The per-point source table, embedded (spec 2026-10-13 §5.2): for each original point, which model places it when
//! Aariz is the main model. Decided on Aariz valid by ceph-bench --decide-source; a change needs the owner's OK.

use serde::Serialize;
use std::collections::BTreeMap;

const EMBEDDED: &str = include_str!("../../../reference/main-point-source.json");
/// SHA-256 of the committed reference/main-point-source.json (`shasum -a 256 reference/main-point-source.json`).
#[cfg(test)] // read only by the pin test
const PINNED_SHA256: &str = "98b13903d8ea77add3624a1c880e7917ed72d651598f26177ddb3d3c9c2b93e8";

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MainPointSource { pub rule_version: String, pub confirmation_pending: bool, pub points: BTreeMap<String, String>,
    /// Part F: the owner's accepted switches, point → model, and each one's note (from the library; never in the embedded table).
    pub owner_choices: BTreeMap<String, String>, pub owner_choice_notes: BTreeMap<String, ChoiceNote> }

/// Part F: the acceptance behind a switch in force — its date and the films that decided, in words (owner E1).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChoiceNote { pub since: String, pub basis: String }

pub fn parse(json: &str) -> anyhow::Result<MainPointSource> {
    let v: serde_json::Value = serde_json::from_str(json)?;
    let mut points = BTreeMap::new();
    for (id, p) in v["points"].as_object().ok_or_else(|| anyhow::anyhow!("no points"))? {
        anyhow::ensure!(crate::scores::ORIGINAL_19.contains(&id.as_str()), "{id} is not one of the original 19");
        let chosen = p["chosen"].as_str().ok_or_else(|| anyhow::anyhow!("{id}: no chosen model"))?;
        anyhow::ensure!(["aariz-cepha29", "cwlachap-hrnet-w32"].contains(&chosen), "{id}: {chosen} is neither Aariz nor cwlachap");
        points.insert(id.clone(), chosen.to_string());
    }
    Ok(MainPointSource { rule_version: v["ruleVersion"].as_str().unwrap_or("").to_string(), confirmation_pending: v["confirmation"] == "pending", points,
        owner_choices: BTreeMap::new(), owner_choice_notes: BTreeMap::new() })
}

/// The embedded table; the tests below prove it parses, covers the 19 and is the approved file.
pub fn main_point_source() -> MainPointSource { parse(EMBEDDED).expect("reference/main-point-source.json is valid (tests)") }

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn parses_the_chosen_model_per_point_and_the_confirmation_state() {
        let j = r#"{"ruleVersion":"main-point-source/1","confirmation":"pending","points":{"S":{"chosen":"aariz-cepha29"},"Go":{"chosen":"cwlachap-hrnet-w32"}}}"#;
        let s = parse(j).unwrap();
        assert_eq!((s.rule_version.as_str(), s.confirmation_pending), ("main-point-source/1", true));
        assert_eq!((s.points["S"].as_str(), s.points["Go"].as_str()), ("aariz-cepha29", "cwlachap-hrnet-w32"));
    }
    #[test] fn refuses_a_model_other_than_aariz_or_cwlachap_or_a_point_outside_the_19() {
        assert!(parse(r#"{"ruleVersion":"x","confirmation":"pending","points":{"S":{"chosen":"srpose-cldet23"}}}"#).is_err());
        assert!(parse(r#"{"ruleVersion":"x","confirmation":"pending","points":{"Co":{"chosen":"aariz-cepha29"}}}"#).is_err());
    }
    #[test] fn the_committed_table_covers_all_19_original_points() {
        let s = main_point_source();
        let mut keys: Vec<&str> = s.points.keys().map(String::as_str).collect();
        keys.sort();
        let mut want = crate::scores::ORIGINAL_19.to_vec();
        want.sort();
        assert_eq!(keys, want);
    }
    #[test] fn the_embedded_table_carries_no_owner_choices_and_serialises_them_as_owner_choices() {
        let s = main_point_source();
        assert!(s.owner_choices.is_empty() && s.owner_choice_notes.is_empty());
        let j = serde_json::to_value(&s).unwrap();
        assert!(j.get("ownerChoices").is_some() && j.get("ownerChoiceNotes").is_some());
    }
    /// Pinned like crosscheck.json: any edit to the committed file fails here until the owner approves it and this
    /// hash is updated in the same commit.
    #[test] fn the_committed_table_is_pinned() {
        use sha2::{Digest, Sha256};
        let h: String = Sha256::digest(EMBEDDED.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
        assert_eq!(h, PINNED_SHA256, "reference/main-point-source.json changed: owner's OK, then update PINNED_SHA256");
    }
}
