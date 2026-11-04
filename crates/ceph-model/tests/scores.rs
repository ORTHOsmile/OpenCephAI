use ceph_model::scores::{status_in, validate, PointStatus};
const T: &str = r#"[{"dataset":"aariz","split":"test","modelId":"m","points":{"U1A":{"n":150,"mre":1.9,"sd":1,"sdr2":0.6},"Co":{"n":150,"mre":2.4,"sd":1,"sdr2":0.4},"S":{"n":150,"mre":3.1,"sd":1,"sdr2":0.3}}}]"#;
#[test] fn a_new_point_at_or_under_2mm_is_scored_and_placed() {
    assert!(matches!(status_in(T, "m", "U1A"), PointStatus::Scored { n: 150, .. }));
}
#[test] fn a_new_point_over_2mm_is_too_far() { assert!(matches!(status_in(T, "m", "Co"), PointStatus::TooFar { .. })); }
#[test] fn the_original_19_are_never_gated_even_with_a_bad_aariz_score() { assert_eq!(status_in(T, "m", "S"), PointStatus::Original); }
#[test] fn a_point_with_no_score_is_not_scored() { assert_eq!(status_in(T, "m", "Ba"), PointStatus::NotScored); }
#[test] fn exactly_2_0_passes() {
    let t = T.replace("1.9", "2.0"); assert!(matches!(status_in(&t, "m", "U1A"), PointStatus::Scored { .. }));
}
#[test] fn only_the_gate_dataset_and_split_count() {
    let t = T.replace(r#""split":"test""#, r#""split":"valid""#); assert_eq!(status_in(&t, "m", "U1A"), PointStatus::NotScored);
}
#[test] fn the_committed_table_parses_and_names_only_catalogue_models() {
    let ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    for row in ceph_model::scores::rows() { assert!(ids.contains(&row.model_id), "{}", row.model_id); }
}

// --- Fix round 1 (review finding, important): status_in must not silently pick one row when the
// table carries two rows for the same (modelId, dataset, split) — there is no correct choice
// between them. `validate` catches this ahead of time; the committed-table test calls it so a
// future edit to reference/model-scores.json that introduces a duplicate fails here, not silently
// in the running app. `status_in` itself also refuses to guess (see the should_panic test below).

const REAL: &str = include_str!("../../../reference/model-scores.json");

#[test] fn the_committed_table_has_no_duplicate_model_dataset_split_row() {
    assert_eq!(validate(REAL), Ok(()), "reference/model-scores.json carries a duplicate row");
}

/// Positive control for the test above: validate() must actually be able to fail. Plants a
/// duplicate of the real table's first row (same modelId/dataset/split) into a copy and checks
/// validate rejects it, before trusting that the real file's Ok above means anything.
#[test] fn validate_catches_a_duplicate_planted_in_a_copy_of_the_real_table() {
    let mut rows: Vec<serde_json::Value> = serde_json::from_str(REAL).expect("REAL parses");
    assert!(!rows.is_empty(), "the real table has at least one row to duplicate");
    rows.push(rows[0].clone());
    let dup = serde_json::to_string(&rows).unwrap();
    assert!(validate(&dup).is_err(), "a planted duplicate (modelId, dataset, split) row must be rejected");
}

#[test] fn validate_passes_a_table_with_no_duplicates() {
    assert_eq!(validate(T), Ok(()));
}

#[test] fn validate_catches_a_duplicate_in_the_small_inline_table_too() {
    let one = T.trim_start_matches('[').trim_end_matches(']');
    let dup = format!("[{one},{one}]");
    assert!(validate(&dup).is_err());
}

#[test]
#[should_panic(expected = "ambiguous")]
fn status_in_panics_rather_than_silently_picking_one_on_a_duplicate_gate_row() {
    // Two rows both claim modelId "m", dataset "aariz", split "test" — exactly the gate
    // dataset/split — with different scores for U1A. There is no correct pick between 1.0 and
    // 9.0 mm; silently returning NotScored (what a naive `.find()` miss would do) or either
    // score (what `.find()`'s "first match" does today) would both hide the conflict.
    let dup = r#"[
        {"dataset":"aariz","split":"test","modelId":"m","points":{"U1A":{"n":150,"mre":1.0,"sd":1,"sdr2":0.6}}},
        {"dataset":"aariz","split":"test","modelId":"m","points":{"U1A":{"n":150,"mre":9.0,"sd":1,"sdr2":0.6}}}
    ]"#;
    let _ = status_in(dup, "m", "U1A");
}

// --- Fix round 1 (review finding, minor): the committed table's stable formatting (P4: pretty
// JSON, models in catalogue order, points sorted) is enforced, not just hoped for. `serde_json`'s
// usual parse hands back object keys sorted whatever order the file was written in, which would
// make this check trivially pass on a mis-ordered file. So the ORDER is read from the raw text
// (where each `"modelId": "…"` and each point key `"X": {` sits), and the parse is used only for
// which ids and keys exist. (Final review M2: this used to rely on serde_json's `preserve_order`
// dev-dependency feature, which Cargo unifies into every crate of a combined `cargo test -p …` run.)

/// Byte position of `needle` in `text`, searching from `from`.
fn pos(text: &str, needle: &str, from: usize) -> Option<usize> { text[from..].find(needle).map(|i| i + from) }

/// Row order within one model: Aariz valid, Aariz test, Ceph-400 Test1, Ceph-400 Test2; anything else last.
fn split_rank(s: &str) -> usize { match s { "valid" => 0, "test" => 1, "test1" => 2, "test2" => 3, _ => 9 } }

/// P4, extended 13 Oct (cross-check Task 2): rows in catalogue order, then dataset, then split order, never the same
/// (model, dataset, split) twice; each row's point keys sorted; an optional `note` is one line of text (15 Oct). The ORDER is read from the raw text (see above).
fn format_ok(table: &str, catalogue_ids: &[String]) -> bool {
    let Ok(rows) = serde_json::from_str::<Vec<serde_json::Value>>(table) else { return false };
    let mut at = Vec::new();
    let mut from = 0;
    while let Some(p) = pos(table, "\"modelId\": \"", from) { at.push(p); from = p + 1; }
    if at.len() != rows.len() { return false; }
    let key = |r: &serde_json::Value| -> Option<(usize, String, usize)> {
        let id = r["modelId"].as_str()?;
        Some((catalogue_ids.iter().position(|x| x == id)?, r["dataset"].as_str()?.to_string(), split_rank(r["split"].as_str()?)))
    };
    let Some(keys) = rows.iter().map(key).collect::<Option<Vec<_>>>() else { return false };
    if keys.windows(2).any(|w| w[0] >= w[1]) { return false; }
    // Optional `note` (owner ruling ROWS-ADD, 15 Oct): when present, one non-empty line of text.
    let note_ok = |r: &serde_json::Value| match r.get("note") {
        None => true,
        Some(n) => n.as_str().is_some_and(|t| !t.trim().is_empty() && !t.contains('\n')),
    };
    if !rows.iter().all(note_ok) { return false; }
    for (i, row) in rows.iter().enumerate() {
        let end = at.get(i + 1).copied().unwrap_or(table.len());
        let Some(points_at) = pos(table, "\"points\"", at[i]).filter(|p| *p < end) else { return false };
        let Some(points) = row["points"].as_object() else { return false };
        let mut keyed = Vec::new();
        for k in points.keys() {
            let Some(p) = pos(&table[..end], &format!("\"{k}\": {{"), points_at) else { return false };
            keyed.push((p, k.clone()));
        }
        keyed.sort();
        if keyed.windows(2).any(|w| w[0].1 > w[1].1) { return false; }
    }
    true
}

/// Writes rows as pretty JSON with each row's point keys in the given order (the controls below
/// need a mis-ordered file, which serde_json's own writer would quietly re-sort).
fn write_rows(rows: &[serde_json::Value], point_order: &dyn Fn(usize, Vec<String>) -> Vec<String>) -> String {
    let mut out = String::from("[\n");
    for (i, row) in rows.iter().enumerate() {
        let obj = row.as_object().unwrap();
        let mut fields = Vec::new();
        for (k, v) in obj {
            if k == "points" { continue; }
            fields.push(format!("    \"{k}\": {}", serde_json::to_string(v).unwrap()));
        }
        let points = obj["points"].as_object().unwrap();
        let keys = point_order(i, points.keys().cloned().collect());
        let body: Vec<String> = keys.iter().map(|k| format!("      \"{k}\": {}", serde_json::to_string(&points[k]).unwrap())).collect();
        fields.push(format!("    \"points\": {{\n{}\n    }}", body.join(",\n")));
        out.push_str(&format!("  {{\n{}\n  }}{}\n", fields.join(",\n"), if i + 1 < rows.len() { "," } else { "" }));
    }
    out.push(']');
    out
}

#[test] fn the_committed_table_is_in_catalogue_order_with_each_rows_points_sorted() {
    let catalogue_ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    assert!(format_ok(REAL, &catalogue_ids), "reference/model-scores.json should be in catalogue order with sorted points (P4)");
}

/// Positive control for the test above: the format check must actually be able to fail. Swaps the
/// first and last real rows (two different models) in a copy and shows `format_ok` catches it, before trusting that the real
/// file's pass above means anything. The same writer, unswapped, passes (so the catch is the swap).
#[test] fn the_format_check_catches_a_planted_model_order_swap() {
    let catalogue_ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    let mut rows: Vec<serde_json::Value> = serde_json::from_str(REAL).unwrap();
    assert!(format_ok(&write_rows(&rows, &|_, k| k), &catalogue_ids), "the unswapped copy must pass");
    let (first, last) = (0, rows.len() - 1);
    assert_ne!(rows[first]["modelId"], rows[last]["modelId"], "need rows of two different models to swap");
    rows.swap(first, last);
    assert!(!format_ok(&write_rows(&rows, &|_, k| k), &catalogue_ids), "swapping two models' rows must be caught");
}
#[test] fn the_format_check_catches_a_repeated_row() {
    let catalogue_ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    let mut rows: Vec<serde_json::Value> = serde_json::from_str(REAL).unwrap();
    let copy = rows[0].clone();
    rows.insert(1, copy);
    assert!(!format_ok(&write_rows(&rows, &|_, k| k), &catalogue_ids), "the same (model, dataset, split) twice must be caught");
}
#[test] fn the_format_check_allows_two_splits_of_one_model_in_split_order() {
    let catalogue_ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    let row = |split: &str| serde_json::json!({"dataset": "aariz", "split": split, "modelId": "gu2net-isbi19", "points": {"A": {"n": 1}, "S": {"n": 1}}});
    assert!(format_ok(&write_rows(&[row("valid"), row("test")], &|_, k| k), &catalogue_ids));
    assert!(!format_ok(&write_rows(&[row("test"), row("valid")], &|_, k| k), &catalogue_ids), "valid comes before test");
}
#[test] fn every_committed_row_says_clean_leaked_or_home_ground() {
    let rows: Vec<serde_json::Value> = serde_json::from_str(REAL).unwrap();
    for r in &rows {
        let l = r["leakage"].as_str().unwrap_or("");
        assert!(["clean", "leaked", "home-ground"].contains(&l), "{} {} {}: leakage {l:?}", r["modelId"], r["dataset"], r["split"]);
    }
}

/// Same positive control, for the "points sorted" half: swaps two of the first row's point keys in
/// the TEXT (each value stays with its own key) and shows `format_ok` catches it.
#[test] fn the_format_check_catches_a_planted_points_key_swap() {
    let catalogue_ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    let rows: Vec<serde_json::Value> = serde_json::from_str(REAL).unwrap();
    assert!(rows[0]["points"].as_object().unwrap().len() >= 2, "need at least two points to swap");
    assert!(format_ok(&write_rows(&rows, &|_, k| k), &catalogue_ids), "the unswapped copy must pass");
    let swapped = write_rows(&rows, &|i, mut k| { if i == 0 { k.swap(0, 1); } k });
    assert!(!format_ok(&swapped, &catalogue_ids), "swapping two point keys' order must be caught");
}

// --- Owner ruling ROWS-ADD (15 Oct 2026, relayed by the cross-check coordinator): GU2Net's and cwlachap's Aariz-valid
// rows are added exactly as measured, although Task 2 Step 11's >10 mm sanity stop fired (overridden for these two rows
// only; root cause: both fail off their ISBI training machine, bench and app sound). Each carries a note. The note is
// an optional field: when present it must be one non-empty line of text.

// --- Owner ruling SCALE-FIX (15 Oct 2026, task 2b): Aariz mm are scored under rule aariz-scale/1. GU2Net's and
// cwlachap's Aariz-valid rows were re-scored under it (cpu); each carries the bench's own `aarizScale` object (rule,
// used / excluded / flagged counts) and a note naming the rule and how many films were used. The Aariz TEST rows are
// held back, so they are NOT re-scored: their note says their mm are on the dataset's uncorrected scale. Task 8 (the
// single test opening that would have re-scored them) was cancelled by owner PARK-FLAGS (15 Oct 2026), so the note no
// longer promises a re-score (final review m1): the rows stay on the uncorrected scale.

fn rows_add_note(used: u64) -> String { format!("fails off its training machine (ISBI-only); scored under aariz-scale/1 ({used} used of 150)") }
const AARIZ_TEST_NOTE: &str = "mm under the dataset's uncorrected scale; never re-scored under aariz-scale/1: Task 8 was cancelled by owner PARK-FLAGS (15 Oct 2026), the test films stay closed";

#[test] fn the_two_aariz_valid_rows_are_scored_under_aariz_scale_1_and_say_how_many_films() {
    let rows: Vec<serde_json::Value> = serde_json::from_str(REAL).unwrap();
    for id in ["cwlachap-hrnet-w32", "gu2net-isbi19"] {
        let r = rows.iter().find(|r| r["modelId"] == id && r["dataset"] == "aariz" && r["split"] == "valid")
            .unwrap_or_else(|| panic!("{id} aariz valid row missing"));
        assert_eq!(r["aarizScale"]["aarizScaleRule"].as_str(), Some("aariz-scale/1"), "{id}");
        let used = r["aarizScale"]["used"].as_u64().unwrap_or_else(|| panic!("{id}: aarizScale.used missing"));
        assert_eq!(r["aarizScale"]["films"].as_u64(), Some(150), "{id}");
        assert_eq!(used + r["aarizScale"]["excluded"].as_u64().unwrap(), 150, "{id}: every film used or excluded");
        assert_eq!((r["leakage"].as_str(), r["note"].as_str()), (Some("clean"), Some(rows_add_note(used).as_str())), "{id}");
        let points = r["points"].as_object().unwrap();
        assert_eq!(points.len(), 19, "{id}: the 19 original points, as measured");
        for (k, v) in points { assert_eq!(v["n"].as_u64(), Some(used), "{id} {k}: each point scored on every used film"); }
    }
}
#[test] fn the_held_back_aariz_test_rows_are_not_rescored_and_say_so() {
    let rows: Vec<serde_json::Value> = serde_json::from_str(REAL).unwrap();
    let test_rows: Vec<&serde_json::Value> = rows.iter().filter(|r| r["dataset"] == "aariz" && r["split"] == "test").collect();
    assert_eq!(test_rows.len(), 2, "SRPose and Aariz");
    for r in test_rows {
        assert_eq!(r["note"].as_str(), Some(AARIZ_TEST_NOTE), "{}", r["modelId"]);
        assert!(r.get("aarizScale").is_none(), "{}: a test row is never re-scored (Task 8 cancelled)", r["modelId"]);
    }
}
#[test] fn every_aariz_row_is_either_under_the_rule_or_says_it_is_not() {
    let rows: Vec<serde_json::Value> = serde_json::from_str(REAL).unwrap();
    for r in rows.iter().filter(|r| r["dataset"] == "aariz") {
        let ruled = r["aarizScale"]["aarizScaleRule"].as_str() == Some("aariz-scale/1");
        assert!(ruled || r["note"].as_str() == Some(AARIZ_TEST_NOTE), "{} {}: Aariz mm with no scale statement", r["modelId"], r["split"]);
    }
}
#[test] fn a_note_when_present_must_be_one_line_of_text() {
    let catalogue_ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    let with = |note: serde_json::Value| {
        let mut r = serde_json::json!({"dataset": "aariz", "split": "valid", "modelId": "gu2net-isbi19", "points": {"A": {"n": 1}, "S": {"n": 1}}});
        r["note"] = note;
        write_rows(&[r], &|_, k| k)
    };
    assert!(format_ok(&with(serde_json::json!(rows_add_note(98))), &catalogue_ids), "a text note passes");
    for bad in [serde_json::json!(5), serde_json::json!(""), serde_json::json!("two\nlines"), serde_json::json!(null)] {
        assert!(!format_ok(&with(bad.clone()), &catalogue_ids), "a note of {bad} must be caught");
    }
}
