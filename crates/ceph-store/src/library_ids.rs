//! The library's own patient number (owner LIBID-1/LIBID-2, 17 Oct; addendum D2). Issued once by SQLite's
//! AUTOINCREMENT counter (never re-used, even after a row's patient is gone); `library_numbers` rows are never deleted;
//! a number merged away keeps `merged_into`, so any number ever issued can be traced.
use crate::{identity::PatientRef, library::Library, IdMatch};
use anyhow::ensure;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Case and spaces ignored (owner L8 A): Rust's `trim`/`to_lowercase`, never a near miss.
pub(crate) fn norm_id(s: &str) -> String { s.chars().filter(|c| !c.is_whitespace()).flat_map(char::to_lowercase).collect() }

/// 42 → "L-00042" (owner L1: a letter, then five digits; more digits after 99,999).
pub fn library_id_text(n: i64) -> String { format!("L-{n:05}") }

/// Lenient: any case, any spaces, the dash and the leading zeros optional ("l-42", " L 00042 " → 42). Anything else,
/// and zero, is not a Library ID.
pub fn parse_library_id(s: &str) -> Option<i64> {
    let t: String = s.chars().filter(|c| !c.is_whitespace()).collect();
    let d = t.strip_prefix(['L', 'l'])?;
    let d = d.strip_prefix('-').unwrap_or(d);
    (!d.is_empty() && d.chars().all(|c| c.is_ascii_digit())).then(|| d.parse::<i64>().ok()).flatten().filter(|n| *n > 0)
}

fn no(tx: &Connection, pid: &str) -> rusqlite::Result<Option<i64>> {
    tx.query_row("SELECT library_no FROM patients WHERE id = ?1", [pid], |r| r.get(0)).optional().map(Option::flatten)
}

/// Issues the next number to patient `pid`; `issued_at` is the move's stamp (owner ruling JOIN-HISTORY), the same as on
/// that move's join rows. Nothing reads it to decide a number (L9-A).
fn issue(tx: &Transaction, pid: &str, at: &str) -> rusqlite::Result<i64> {
    tx.execute("INSERT INTO library_numbers (issued_at) VALUES (?1)", [at])?;
    let n = tx.last_insert_rowid();
    tx.execute("UPDATE patients SET library_no = ?2 WHERE id = ?1", params![pid, n])?;
    Ok(n)
}

const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

/// "Named" is judged with Rust's `trim` (every kind of whitespace), not SQL's `trim()` (spaces only).
fn named(tx: &Connection, pid: &str) -> rusqlite::Result<bool> {
    let name: String = tx.query_row("SELECT display_name FROM patients WHERE id = ?1", [pid], |r| r.get(0))?;
    Ok(!name.trim().is_empty())
}

/// The time written on every join row, issue and merge of one move, and on every "Not the same" answer: now, or 1 ms
/// after the latest one already written if the clock has not moved on, so every move's stamp is strictly later than
/// every earlier move's. The join record and the trail are ordered by these stamps; two moves in the same millisecond
/// must not compare equal. SQLite's date arithmetic is in whole milliseconds, so the 1 ms step is exact.
fn stamp(tx: &Connection) -> rusqlite::Result<String> {
    tx.query_row(&format!(
        "SELECT CASE WHEN last IS NULL OR {NOW} > last THEN {NOW} ELSE strftime('%Y-%m-%dT%H:%M:%fZ', last, '+0.001 seconds') END
           FROM (SELECT max(t) AS last FROM (SELECT max(merged_at) AS t FROM library_numbers
                                             UNION ALL SELECT max(joined_at) FROM xray_joins
                                             UNION ALL SELECT max(answered_at) FROM id_link_answers))"), [], |r| r.get(0))
}

/// How an X-ray came to a patient (owner ruling JOIN-HISTORY, 17 Oct): the person's action that moved it.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Move { Typed, Corrected, Cleared, SamePatient, Label }
impl Move {
    fn word(self) -> &'static str {
        match self { Move::Typed => "typed", Move::Corrected => "corrected", Move::Cleared => "cleared", Move::SamePatient => "same_patient", Move::Label => "label" }
    }
}

/// The first row of a newly imported X-ray's record: on its own unnamed patient, no number.
pub(crate) fn record_import(tx: &Transaction, case_id: &str, pid: &str) -> rusqlite::Result<()> {
    let at = stamp(tx)?;
    tx.execute("INSERT INTO xray_joins (case_id, patient_id, library_no, joined_at, how) VALUES (?1, ?2, NULL, ?3, 'import')", params![case_id, pid, at]).map(|_| ())
}

/// Owner ruling JOIN-HISTORY: after a move, one row for every X-ray on `pids` (live or in Recently deleted) whose
/// patient or patient's number is not what its last row says. The moved X-ray's row says `how`; the others' say
/// "merge" (their patient's number was retired into the kept one; under L9-A nothing else changes another X-ray's
/// number). `merged`: the number retired in this move, written as `merged_from` on the rows of the X-rays that held it.
fn record_joins(tx: &Transaction, at: &str, case_id: &str, how: Move, pids: [&str; 2], merged: Option<i64>) -> rusqlite::Result<()> {
    let now: Vec<(String, String, Option<i64>)> = tx.prepare(
        "SELECT c.id, c.patient_id, p.library_no FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.patient_id IN (?1, ?2) ORDER BY c.created_at, c.rowid")?
        .query_map(params![pids[0], pids[1]], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    for (cid, pid, n) in now {
        let last: Option<(String, Option<i64>)> = tx.query_row(
            "SELECT patient_id, library_no FROM xray_joins WHERE case_id = ?1 ORDER BY joined_at DESC, id DESC LIMIT 1", [&cid],
            |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        if last.as_ref() == Some(&(pid.clone(), n)) { continue; }
        let from = merged.filter(|g| last.as_ref().and_then(|l| l.1) == Some(*g));
        let word = if cid == case_id { how.word() } else { "merge" };   // L9-A: only a merge changes another X-ray's number
        tx.execute("INSERT INTO xray_joins (case_id, patient_id, library_no, merged_from, joined_at, how) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![cid, pid, n, from, at, word])?;
    }
    Ok(())
}

/// After X-ray `case_id` moved from `old_pid` to `new_pid` (call BEFORE the empty-patient DELETE). The whole
/// number logic (owner L9-A, 18 Oct; addendum "L9-A: new number on undo"); no history is read:
/// - rule 2: an emptied old record hands its number to the new one when that has none (a correction, including
///   clearing the name: an unnamed patient can hold the number it had while named);
/// - rule 3 (L3 A): if the new record has one too, the older survives and the other is retired into it for good;
/// - rules 1 and 4 (L6 A): a named record still without a number gets the next. So an X-ray leaving a patient
///   that keeps other X-rays, for a new named patient, always gets a NEW number; nothing is ever given back.
/// Last, every X-ray on the two patients whose patient or number changed gets its row (`record_joins`).
pub(crate) fn settle_after_move(tx: &Transaction, case_id: &str, old_pid: &str, new_pid: &str, how: Move) -> rusqlite::Result<()> {
    if old_pid == new_pid { return Ok(()); }
    let (old_no, new_before) = (no(tx, old_pid)?, no(tx, new_pid)?);
    let left: i64 = tx.query_row("SELECT COUNT(*) FROM cases WHERE patient_id = ?1", [old_pid], |r| r.get(0))?;
    let at = stamp(tx)?;
    let mut merged: Option<i64> = None;
    if left == 0 {
        if let Some(o) = old_no {
            tx.execute("UPDATE patients SET library_no = NULL WHERE id = ?1", [old_pid])?;
            let keep = match new_before {
                None => o,
                Some(n) => {
                    let (keep, gone) = (o.min(n), o.max(n));
                    tx.execute("UPDATE patients SET library_no = NULL WHERE id = ?1", [new_pid])?;
                    tx.execute("UPDATE library_numbers SET merged_into = ?2, merged_at = ?3 WHERE n = ?1", params![gone, keep, at])?;
                    merged = Some(gone);
                    keep
                }
            };
            tx.execute("UPDATE patients SET library_no = ?2 WHERE id = ?1", params![new_pid, keep])?;
        }
    }
    if named(tx, new_pid)? && no(tx, new_pid)?.is_none() { issue(tx, new_pid, &at)?; }
    record_joins(tx, &at, case_id, how, [old_pid, new_pid], merged)?;
    Ok(())
}

/// The number held now by whoever `n` was merged into, following the chain; None if that patient is gone or `n` was
/// never issued. A chain longer than 10,000 steps is an error (a cycle cannot be made by `settle_after_move`, so it would
/// mean a damaged database; review minor 4: say so rather than answer from the middle of the chain).
pub(crate) fn resolve(conn: &Connection, mut n: i64) -> rusqlite::Result<Option<i64>> {
    for _ in 0..10_000 {
        let Some(next) = conn.query_row("SELECT merged_into FROM library_numbers WHERE n = ?1", [n], |r| r.get::<_, Option<i64>>(0)).optional()?
            else { return Ok(None) };
        let Some(m) = next else {
            let held: i64 = conn.query_row("SELECT COUNT(*) FROM patients WHERE library_no = ?1", [n], |r| r.get(0))?;
            return Ok((held == 1).then_some(n));
        };
        n = m;
    }
    Err(rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(rusqlite::ffi::SQLITE_CORRUPT),
        Some("a Library ID's merge chain does not end (more than 10,000 steps)".into())))
}

/// The highest number ever issued (the AUTOINCREMENT counter); 0 when none was, including a database from before
/// format 11 or one with no tables at all (no `sqlite_sequence` table: ruling 3a).
pub(crate) fn last_issued(conn: &Connection) -> rusqlite::Result<i64> {
    let has_seq: bool = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'sqlite_sequence'", [], |r| r.get::<_, i64>(0))? == 1;
    if !has_seq { return Ok(0); }
    Ok(conn.query_row("SELECT seq FROM sqlite_sequence WHERE name = 'library_numbers'", [], |r| r.get(0)).optional()?.unwrap_or(0))
}

/// Makes the next number issued at least `at_least + 1` (rule 5: a restored backup never re-issues a number the
/// replaced library had already given out). Every number up to `at_least` that this database does not know gets a row
/// held by nobody (review I2, rule 6), so looking it up says "belonged to a patient no longer in the library", not
/// "never issued". Its `issued_at` is when that row was written here (the real date stayed with the replaced library).
/// Inserting the rows moves the AUTOINCREMENT counter with them.
pub(crate) fn raise_counter(conn: &Connection, at_least: i64) -> rusqlite::Result<()> {
    let mut add = conn.prepare("INSERT INTO library_numbers (n, issued_at) VALUES (?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))")?;
    for n in last_issued(conn)? + 1..=at_least { add.execute([n])?; }
    Ok(())
}

/// One line of a patient's Library ID trail (owner L9-A, 18 Oct): where a number went, so a reader holding an old
/// report can follow it. `on` is the local day (YYYY-MM-DD) of the move; `at` (not sent) orders the lines.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TrailLine {
    /// `number` was retired into `into` (this patient's number, or another number that now leads here).
    Merged { number: String, into: String, on: String },
    /// An X-ray under `number` (this patient's, or one merged into it) left it; it is now under `now` (None: no
    /// Library ID) with the patient named `name` (blank: no name yet).
    Left { number: String, on: String, now: Option<String>, name: String },
}

/// The trail of patient `pid` (owner L9-A): every number merged into its number (through any chain), and every live
/// X-ray that was under one of those numbers and is now on another patient, oldest first. Empty while it has no number.
pub(crate) fn trail(conn: &Connection, pid: &str) -> rusqlite::Result<Vec<TrailLine>> {
    let Some(m) = no(conn, pid)? else { return Ok(vec![]) };
    let mut ours = vec![m];
    let mut lines: Vec<(String, TrailLine)> = Vec::new();
    let retired: Vec<(i64, i64, String, String)> = conn.prepare(
        "SELECT n, merged_into, merged_at, date(merged_at, 'localtime') FROM library_numbers WHERE merged_into IS NOT NULL")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?;
    for (n, into, at, on) in retired {
        if resolve(conn, n)? == Some(m) {
            ours.push(n);
            lines.push((at, TrailLine::Merged { number: library_id_text(n), into: library_id_text(into), on }));
        }
    }
    let mut left = std::collections::BTreeSet::new();
    for &n in &ours {
        let cases: Vec<String> = conn.prepare(
            "SELECT DISTINCT j.case_id FROM xray_joins j JOIN cases c ON c.id = j.case_id
              WHERE j.library_no = ?1 AND c.deleted_at IS NULL AND c.patient_id != ?2")?
            .query_map(params![n, pid], |r| r.get(0))?.collect::<Result<_, _>>()?;
        left.extend(cases);
    }
    for case in left {
        let rows: Vec<(Option<i64>, String, String)> = conn.prepare(
            "SELECT library_no, joined_at, date(joined_at, 'localtime') FROM xray_joins WHERE case_id = ?1 ORDER BY joined_at, id")?
            .query_map([&case], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
        let Some(i) = rows.iter().rposition(|r| r.0.is_some_and(|k| ours.contains(&k))) else { continue };
        let Some(next) = rows.get(i + 1) else { continue };
        let (now, name): (Option<i64>, String) = conn.query_row(
            "SELECT p.library_no, p.display_name FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1", [&case], |r| Ok((r.get(0)?, r.get(1)?)))?;
        lines.push((next.1.clone(), TrailLine::Left { number: library_id_text(rows[i].0.unwrap_or_default()), on: next.2.clone(),
            now: now.map(library_id_text), name }));
    }
    lines.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(lines.into_iter().map(|l| l.1).collect())
}

/// What a Library ID lookup found: the number asked for (as text), the number it leads to now (None: its patient is no
/// longer in the library), that patient, and whether it was merged into another number.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryIdFound { pub asked: String, pub current: Option<String>, pub patient: Option<PatientRef>, pub merged: bool }

/// Every Patient ID on patient `pid`'s live X-rays (addendum D2, LIBID-1), case/space-insensitive, first spelling
/// kept, oldest X-ray first.
pub(crate) fn ids_seen(conn: &Connection, pid: &str) -> rusqlite::Result<Vec<String>> {
    let raw: Vec<String> = conn.prepare(
        "SELECT printed_patient_id FROM cases WHERE patient_id = ?1 AND deleted_at IS NULL AND printed_patient_id IS NOT NULL
           ORDER BY COALESCE(taken_on, created_at), created_at")?
        .query_map([pid], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::new();
    for s in raw { if seen.insert(norm_id(&s)) { out.push(s); } }
    Ok(out)
}

/// Link suggestions for X-ray `case_id` (addendum D2, LIBID-1): every OTHER named patient with a number, holding at
/// least one live X-ray whose Patient ID matches this X-ray's own (case/spaces ignored, never a near miss), minus any
/// such patient this X-ray has been told "Not the same" about (`id_link_answers`, resolved through merges). None when
/// this X-ray's own Patient ID is blank. Ordered by name.
pub(crate) fn matches_for(conn: &Connection, case_id: &str) -> rusqlite::Result<Vec<IdMatch>> {
    let (own_pid, own_id): (String, Option<String>) =
        conn.query_row("SELECT patient_id, printed_patient_id FROM cases WHERE id = ?1", [case_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    let Some(own_norm) = own_id.as_deref().map(norm_id).filter(|s| !s.is_empty()) else { return Ok(vec![]) };
    type Row = (String, String, Option<String>, i64, String);
    let rows: Vec<Row> = conn.prepare(
        "SELECT p.id, p.display_name, p.date_of_birth, p.library_no, c.printed_patient_id
           FROM cases c JOIN patients p ON p.id = c.patient_id
          WHERE c.deleted_at IS NULL AND c.printed_patient_id IS NOT NULL AND p.id != ?1
                AND trim(p.display_name) != '' AND p.library_no IS NOT NULL")?
        .query_map(params![own_pid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<Result<_, _>>()?;
    let excluded: Vec<i64> = conn.prepare("SELECT library_no FROM id_link_answers WHERE case_id = ?1")?
        .query_map([case_id], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut counts: HashMap<String, (String, Option<String>, i64, i64)> = HashMap::new();
    for (pid, name, dob, lib_no, printed) in rows {
        if norm_id(&printed) == own_norm { counts.entry(pid).or_insert((name, dob, lib_no, 0)).3 += 1; }
    }
    let mut out = Vec::new();
    for (name, date_of_birth, lib_no, films) in counts.into_values() {
        let mut hidden = false;
        for &a in &excluded { if resolve(conn, a)? == Some(lib_no) { hidden = true; break; } }
        if !hidden { out.push(IdMatch { library_id: library_id_text(lib_no), patient: PatientRef { name, date_of_birth }, films }); }
    }
    out.sort_by(|a, b| a.patient.name.cmp(&b.patient.name));
    Ok(out)
}

/// Every number ever merged into the number it now resolves to (addendum D2, LIBID-2; the Library search box).
/// Built once per `list` call.
pub(crate) fn former_numbers(conn: &Connection) -> rusqlite::Result<HashMap<i64, Vec<i64>>> {
    let retired: Vec<i64> = conn.prepare("SELECT n FROM library_numbers WHERE merged_into IS NOT NULL")?
        .query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    let mut map: HashMap<i64, Vec<i64>> = HashMap::new();
    for n in retired { if let Some(current) = resolve(conn, n)? { map.entry(current).or_default().push(n); } }
    for v in map.values_mut() { v.sort_unstable(); }
    Ok(map)
}

impl Library {
    /// Any Library ID ever issued → the patient it belongs to now (LIBID-2: an old report or CSV can be traced).
    /// None for text that is not a Library ID and for a number never issued.
    pub fn find_library_id(&self, text: &str) -> anyhow::Result<Option<LibraryIdFound>> {
        let Some(n) = parse_library_id(text) else { return Ok(None) };
        let issued: bool = self.conn.query_row("SELECT COUNT(*) FROM library_numbers WHERE n = ?1", [n], |r| r.get::<_, i64>(0))? == 1;
        if !issued { return Ok(None); }
        let now = resolve(&self.conn, n)?;
        let patient = match now {
            Some(m) => self.conn.query_row("SELECT display_name, date_of_birth FROM patients WHERE library_no = ?1", [m],
                |r| Ok(PatientRef { name: r.get(0)?, date_of_birth: r.get(1)? })).optional()?,
            None => None,
        };
        Ok(Some(LibraryIdFound { asked: library_id_text(n), current: now.map(library_id_text), patient, merged: now.is_some_and(|m| m != n) }))
    }

    /// "Not the same" on a Patient ID link suggestion (addendum D2, LIBID-1): remembered for this X-ray and that
    /// patient's Library ID only; a second answer for the same pair is not an error. Refuses text that is not a
    /// Library ID, a number never issued, and a deleted X-ray (like every other film-detail write).
    pub fn not_same_patient(&mut self, case_id: &str, library_id: &str) -> anyhow::Result<()> {
        let n = parse_library_id(library_id).ok_or_else(|| anyhow::anyhow!("“{library_id}” is not a Library ID"))?;
        let tx = self.conn.transaction()?;
        crate::library::live_case(&tx, case_id)?;
        let issued: bool = tx.query_row("SELECT COUNT(*) FROM library_numbers WHERE n = ?1", [n], |r| r.get::<_, i64>(0))? == 1;
        ensure!(issued, "“{library_id}” is not a Library ID");
        // Stamped like a move (`stamp`), so an answer and a link in the same millisecond still compare in order (M2).
        let at = stamp(&tx)?;
        tx.execute("INSERT OR IGNORE INTO id_link_answers (case_id, library_no, answered_at) VALUES (?1, ?2, ?3)", params![case_id, n, at])?;
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Two moves in the same millisecond must not share a stamp (the join record and the trail are ordered by them).
    /// Forced here with a join row dated later than the clock. Positive control: `stamp` returning plain now -> the second
    /// value is today's.
    #[test] fn a_move_is_always_stamped_after_every_earlier_one() {
        let mut c = Connection::open_in_memory().unwrap();
        crate::schema::migrate(&mut c).unwrap();
        assert!(stamp(&c).unwrap().starts_with("20"), "an empty library stamps now");
        c.execute_batch("INSERT INTO library_numbers (n, issued_at, merged_into, merged_at) VALUES (1, 'x', NULL, NULL), (2, 'x', 1, '2999-01-01T00:00:00.000Z');").unwrap();
        assert_eq!(stamp(&c).unwrap(), "2999-01-01T00:00:00.001Z");
        c.pragma_update(None, "foreign_keys", "OFF").unwrap();   // a join row for a case that is not there: only its date matters
        c.execute("INSERT INTO xray_joins (case_id, patient_id, library_no, joined_at, how) VALUES ('c', 'p', 1, '2999-01-01T00:00:00.999Z', 'import')", []).unwrap();
        assert_eq!(stamp(&c).unwrap(), "2999-01-01T00:00:01.000Z", "carries into the next second");
    }
}
