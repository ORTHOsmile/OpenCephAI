//! Format 11 (spec 2026-10-17, addendum Q8): Patient ID, X-ray type, X-ray dimensions and Radiography practice are
//! each on the film (`cases`), never the patient. Each is saved on its own (the Gender/Referrer race, 5 Oct), so one
//! save never carries a stale value of another; `CaseMeta` is not touched.
use crate::library::{live_case, Library};
use anyhow::{anyhow, ensure};
use ceph_label::layout::{DETAIL_FIELDS, DETAIL_MAX_CHARS, PATIENT_FIELDS};
use rusqlite::{params, Transaction};
use serde::{Deserialize, Serialize};

/// A typed or chosen value: trimmed; blank is None; longer than `DETAIL_MAX_CHARS` is refused.
pub(crate) fn detail_value(v: Option<&str>) -> anyhow::Result<Option<String>> {
    let v = v.map(str::trim).filter(|s| !s.is_empty());
    if let Some(s) = v { ensure!(s.chars().count() <= DETAIL_MAX_CHARS, "that is too long (over {DETAIL_MAX_CHARS} characters)"); }
    Ok(v.map(str::to_string))
}
/// The film column of a film detail. A column name never comes from outside: anything else is refused.
pub(crate) fn film_column(field: &str) -> anyhow::Result<&'static str> {
    match field {
        "xray_type" => Ok("xray_type"), "xray_size" => Ok("xray_size"), "practice" => Ok("radiography_practice"),
        "patient_id" => Ok("printed_patient_id"),
        _ => Err(anyhow!("unknown film detail {field:?}")),
    }
}
/// Edits the case's "Learned for this machine" list: drops `remove`, then appends each of `add` not already there.
fn edit_learned(tx: &Transaction, case_id: &str, add: &[String], remove: &str) -> rusqlite::Result<()> {
    let cur: String = tx.query_row("SELECT learned_fields FROM cases WHERE id = ?1", [case_id], |r| r.get(0))?;
    let mut all: Vec<&str> = cur.split(',').filter(|f| !f.is_empty() && *f != remove).collect();
    for f in add { if !all.contains(&f.as_str()) { all.push(f); } }
    tx.execute("UPDATE cases SET learned_fields = ?2 WHERE id = ?1", params![case_id, all.join(",")])?;
    Ok(())
}
/// A person entered this detail: it no longer reads "Learned for this machine". `pub(crate)`: `library.rs`'s
/// `set_patient_gender`/`set_patient_referrer` call it too (owner Q6), so a typed Gender or Referrer drops its own
/// "Learned for this machine" mark, like every other detail.
pub(crate) fn drop_learned(tx: &Transaction, case_id: &str, field: &str) -> rusqlite::Result<()> { edit_learned(tx, case_id, &[], field) }

/// The new details read from this film's machine's default places (spec 2026-10-17, D-LEARN-1; owner Q6 adds Gender
/// and Referring practitioner). The label reader reads none of them (Q4 A), so a learned value alone fills a blank
/// and is noted as learned.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmDetailsRead {
    pub printed_patient_id: Option<String>, pub xray_type: Option<String>, pub xray_size: Option<String>, pub practice: Option<String>,
    pub gender: Option<String>, pub referrer: Option<String>,
}

/// The fill table (spec 2026-09-29 Part 3), for the label's Patient ID ("PID"/"Patient ID", owner Q4) against this
/// film's learned Patient ID: agree or one alone fills (a learned value alone is marked); a disagreement fills
/// nothing and is returned as a conflict to show. Blank or whitespace-only on either side counts as absent. "Agree"
/// ignores case and spaces (owner L8, as the link suggestions do), and the label's own spelling is the one filled.
pub fn merge_patient_id(label: Option<&str>, learned: Option<&str>) -> (Option<String>, bool, Option<crate::Conflict>) {
    let clean = |v: Option<&str>| v.map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
    match (clean(label), clean(learned)) {
        (Some(a), Some(b)) if crate::library_ids::norm_id(&a) == crate::library_ids::norm_id(&b) => (Some(a), false, None),   // owner L8: case and spaces ignored
        (Some(a), Some(b)) => (None, false, Some(crate::Conflict { field: "patient_id".into(), label: a, learned: b })),
        (Some(a), None) => (Some(a), false, None),
        (None, Some(b)) => (Some(b), true, None),
        (None, None) => (None, false, None),
    }
}

impl Library {
    /// The label's Patient ID ("PID"/"Patient ID", owner Q4), filling this X-ray's own Patient ID only while it is
    /// blank — never marked "Learned for this machine" (it came straight from this film's own label, not a learned
    /// place). Preflight 6a: no value to fill is `Ok(false)` at once, before any write.
    pub fn apply_label_patient_id(&mut self, case_id: &str, v: Option<&str>) -> anyhow::Result<bool> {
        let Some(v) = detail_value(v)? else { return Ok(false) };
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        let n = tx.execute("UPDATE cases SET printed_patient_id = ?2 WHERE id = ?1 AND printed_patient_id IS NULL", params![case_id, v])?;
        tx.commit()?;
        Ok(n == 1)
    }
    /// The Patient ID as printed on this X-ray (addendum D2, Q8: each X-ray keeps its own). Writes only this column.
    pub fn set_patient_id(&mut self, case_id: &str, patient_id: Option<&str>) -> anyhow::Result<()> {
        let v = detail_value(patient_id)?;
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute("UPDATE cases SET printed_patient_id = ?2 WHERE id = ?1", params![case_id, v])?;
        drop_learned(&tx, case_id, "patient_id")?;
        tx.commit()?;
        Ok(())
    }
    /// X-ray type, X-ray dimensions or Radiography practice ("xray_type", "xray_size", "practice"), on this film only.
    /// Writes only that column. Never clears "Tracing verified" (not a tracing change). The Patient ID has its own
    /// setter (`set_patient_id`): refused here even though `film_column` knows its column, so a caller can't reach
    /// it by the wrong name and skip that setter's own rules.
    pub fn set_film_detail(&mut self, case_id: &str, field: &str, value: Option<&str>) -> anyhow::Result<()> {
        ensure!(field != "patient_id", "unknown film detail {field:?}");
        let col = film_column(field)?;
        let v = detail_value(value)?;
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute(&format!("UPDATE cases SET {col} = ?2 WHERE id = ?1"), params![case_id, v])?;
        drop_learned(&tx, case_id, field)?;
        tx.commit()?;
        Ok(())
    }
    /// Fills each blank new detail from the machine's learned value, never overwriting a saved one, and adds the ids
    /// it filled to `learned_fields` ("Learned for this machine" until a person edits it or presses OK). The Patient ID
    /// is this X-ray's own (addendum D2, Q8), filled only while it is blank. Gender and Referring practitioner (owner
    /// Q6) are the PATIENT's, filled only while THAT is blank — never overwritten by a different machine's reading.
    /// A value that is blank, holds no letter or digit, or is over `DETAIL_MAX_CHARS` fills nothing; Gender fills
    /// only "F" or "M" (the patients table's own CHECK would otherwise refuse the write, erroring instead of skipping).
    pub fn apply_learned_details(&mut self, case_id: &str, r: &FilmDetailsRead) -> anyhow::Result<Vec<String>> {
        let usable = |v: &Option<String>| detail_value(v.as_deref()).ok().flatten().filter(|s| s.chars().any(char::is_alphanumeric));
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        let mut filled: Vec<String> = Vec::new();
        for field in DETAIL_FIELDS {
            // Paired by name, never by position (review M-1): reordering DETAIL_FIELDS cannot cross two details.
            let v = match field {
                "patient_id" => &r.printed_patient_id, "xray_type" => &r.xray_type, "xray_size" => &r.xray_size,
                "practice" => &r.practice, _ => return Err(anyhow!("unknown film detail {field:?}")),
            };
            let Some(v) = usable(v) else { continue };
            let col = film_column(field)?;
            let n = tx.execute(&format!("UPDATE cases SET {col} = ?2 WHERE id = ?1 AND {col} IS NULL"), params![case_id, v])?;
            if n == 1 { filled.push(field.to_string()); }
        }
        for field in PATIENT_FIELDS {
            let (v, col) = match field { "gender" => (&r.gender, "gender"), "referrer" => (&r.referrer, "referring_practitioner"),
                _ => return Err(anyhow!("unknown patient detail {field:?}")) };
            let Some(v) = usable(v) else { continue };
            if field == "gender" && v != "F" && v != "M" { continue; }
            let n = tx.execute(&format!("UPDATE patients SET {col} = ?2 WHERE id = (SELECT patient_id FROM cases WHERE id = ?1) AND {col} IS NULL"), params![case_id, v])?;
            if n == 1 { filled.push(field.to_string()); }
        }
        if !filled.is_empty() { edit_learned(&tx, case_id, &filled, "")?; }
        tx.commit()?;
        Ok(filled)
    }
    /// Owner Q10: "Accept as it is" beside a "Learned for this machine" mark: the value stays; only the mark goes. The
    /// screen then teaches the machine the value (as confirming does).
    pub fn accept_learned(&mut self, case_id: &str, field: &str) -> anyhow::Result<()> {
        const ACCEPTABLE: [&str; 6] = ["patient_id", "xray_type", "xray_size", "practice", "gender", "referrer"];
        ensure!(ACCEPTABLE.contains(&field), "{field:?} has no ✓ of its own");
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        drop_learned(&tx, case_id, field)?;
        tx.commit()?;
        Ok(())
    }
}
