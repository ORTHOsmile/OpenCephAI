//! Film layouts (spec 2026-09-29): which machine a film came from, by its printing pattern, and where that machine
//! prints each detail. Only positions, sizes, hashed tokens and promoted pattern words are stored.
use crate::library::{Library, NOW};
use anyhow::anyhow;
use ceph_label::layout::{anchor_score, median, near, same_size, token, Anchor, End, FilmToken, Rule, Start, MATCH_MIN_ANCHORS, MATCH_SCORE, ROW_TOL};
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineMatch { pub machine_id: String, pub mirrored: bool, pub created: bool }

/// The library's random salt for token hashes, created when first needed.
pub(crate) fn layout_salt(conn: &Connection) -> rusqlite::Result<String> {
    if let Some(s) = conn.query_row("SELECT value FROM settings WHERE key = 'layoutSalt'", [], |r| r.get::<_, String>(0)).optional()? { return Ok(s); }
    let s = uuid::Uuid::new_v4().to_string();
    conn.execute("INSERT INTO settings (key, value) VALUES ('layoutSalt', ?1)", [&s])?;
    Ok(s)
}
pub(crate) fn token_hash(salt: &str, token: &str) -> String {
    let mut h = Sha256::new();
    h.update(salt.as_bytes()); h.update([0u8]); h.update(token.as_bytes());
    h.finalize().iter().map(|b| format!("{b:02x}")).collect()
}

/// A case's machine, mirrored flag, whether it is confirmed, its patient id, name, scan ID, printed Patient ID,
/// referring practitioner and Gender (owner Q6).
type ConfirmedCase = (Option<String>, bool, bool, String, String, Option<String>, Option<String>, Option<String>, Option<String>);

/// Every token a patient's own name, scan ID, Patient ID or referrer could print as: each whole word and each part
/// between punctuation ("O'Brien" → "o'brien", "o", "brien"), so none of them is ever recorded (final review I4;
/// spec 2026-10-17; the referrer, owner Q6, final review I4 extended). "male"/"female" are added separately by the
/// caller when the patient's Gender is set (a one-letter Gender is never itself a safe pattern word, so it is
/// excluded by its own words, not through this list).
fn own_tokens(name: &str, ids: &[Option<&str>]) -> Vec<String> {
    name.split_whitespace().chain(ids.iter().flat_map(|i| i.unwrap_or("").split_whitespace()))
        .flat_map(|w| std::iter::once(w).chain(w.split(|c: char| !c.is_alphanumeric())))
        .filter_map(token).collect()
}
/// "male"/"female" are never a pattern word when this film's patient's Gender is set (owner Q6): the only words
/// `gender_in` ever reads, excluded like a name or an ID, whichever gender is recorded.
fn gender_words(gender: Option<&str>) -> Vec<String> {
    match gender { Some("F") => vec!["female".to_string()], Some("M") => vec!["male".to_string()], _ => vec![] }
}
/// Month words come from dates of birth and film dates; they are never part of a pattern.
fn is_month(t: &str) -> bool {
    const M: [&str; 12] = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];
    t.len() >= 3 && M.iter().any(|m| m.starts_with(t) || (t.starts_with(&m[..3]) && m.starts_with(t.trim_end_matches('.'))))
}

pub(crate) fn anchors_of(conn: &Connection, machine: &str) -> rusqlite::Result<Vec<Anchor>> {
    conn.prepare("SELECT token, cx, cy FROM layout_anchors WHERE machine_id = ?1")?
        .query_map([machine], |r| Ok(Anchor { token: r.get(0)?, cx: r.get(1)?, cy: r.get(2)? }))?.collect()
}

impl Library {
    /// Matches the case's film to a machine (spec Part 2) and records it on the case; a new machine if none fits.
    pub fn match_machine(&mut self, case_id: &str, film: &[FilmToken]) -> anyhow::Result<MachineMatch> {
        let tx = self.conn.transaction()?;
        let (w, h): (u32, u32) = tx.query_row("SELECT i.width, i.height FROM cases c JOIN images i ON i.sha256 = c.image_sha256 WHERE c.id = ?1",
            [case_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.ok_or_else(|| anyhow!("no case {case_id} in the library"))?;
        let before = crate::machine_scale::base_spacing(&tx, case_id)?;
        let salt = layout_salt(&tx)?;
        let machines: Vec<(String, u32, u32)> = tx.prepare("SELECT id, width, height FROM layout_machines")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
        // Each distinct token once, hashed for machines that have no pattern yet.
        let mut distinct: Vec<&FilmToken> = Vec::new();
        for t in film { if !distinct.iter().any(|d| d.token == t.token) { distinct.push(t); } }
        let hashed: Vec<(String, f64, f64)> = distinct.iter().map(|t| (token_hash(&salt, &t.token), t.cx, t.cy)).collect();
        let mut best: Option<(f64, String, bool, f64)> = None;
        for (id, _, _) in machines.into_iter().filter(|(_, mw, mh)| same_size((*mw, *mh), (w, h))) {
            let anchors = anchors_of(&tx, &id)?;
            let (fraction, mirrored, dy) = if anchors.len() >= MATCH_MIN_ANCHORS {
                let s = anchor_score(&anchors, film);
                if s.matched < MATCH_MIN_ANCHORS || s.fraction < MATCH_SCORE { continue; }
                (s.fraction, s.mirrored, s.dy)
            } else {
                // A machine with no pattern yet: at least 2 of this film's tokens, and half of them, must be among its
                // candidates in place (final review I1/I2).
                let cands: Vec<(String, f64, f64)> = tx.prepare("SELECT token_hash, cx, cy FROM layout_candidates WHERE machine_id = ?1")?
                    .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
                let hits = |mirror: bool| -> Vec<f64> { hashed.iter().filter_map(|(fh, fx, fy)| cands.iter()
                    .find(|(ch, x, y)| ch == fh && near(if mirror { 1.0 - x } else { *x }, *y, *fx, *fy)).map(|(_, _, y)| fy - y)).collect() };
                let (p, m) = (hits(false), hits(true));
                let (dys, mirrored) = if m.len() > p.len() { (m, true) } else { (p, false) };
                let f = dys.len() as f64 / hashed.len().max(1) as f64;
                if dys.len() < 2 || f < 0.5 { continue; }
                (f, mirrored, median(dys))
            };
            if best.as_ref().is_none_or(|b| fraction > b.0) { best = Some((fraction, id, mirrored, dy)); }
        }
        let (machine_id, mirrored, dy, created) = match best {
            Some((_, id, m, dy)) => (id, m, dy, false),
            None => {
                // The lowest free "Machine n" (owner, 30 Sep: a number freed by a delete is reused, never duplicated).
                let names: Vec<String> = tx.prepare("SELECT name FROM layout_machines")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
                let n = (1..).find(|n| !names.contains(&format!("Machine {n}"))).unwrap_or(1);
                let id = uuid::Uuid::new_v4().to_string();
                tx.execute(&format!("INSERT INTO layout_machines (id, name, width, height, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, {NOW}, {NOW})"),
                    params![id, format!("Machine {n}"), w, h])?;
                (id, false, 0.0, true)
            }
        };
        // A machine with no pattern yet keeps this film's hashed tokens, so the next unconfirmed film of the same machine
        // can match it (final review I2). They never promote to anchors; confirming the film replaces them.
        if anchors_of(&tx, &machine_id)?.len() < MATCH_MIN_ANCHORS {
            let pending = format!("pending:{case_id}");
            tx.execute("DELETE FROM layout_candidates WHERE patient_id = ?1", [&pending])?;
            for (h, x, y) in &hashed {
                tx.execute("INSERT INTO layout_candidates (machine_id, token_hash, cx, cy, patient_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![machine_id, h, if mirrored { 1.0 - x } else { *x }, y - dy, pending])?;
            }
        }
        tx.execute(&format!("UPDATE layout_machines SET films = films + 1, updated_at = {NOW} WHERE id = ?1"), [&machine_id])?;
        tx.execute("UPDATE cases SET layout_machine_id = ?2, layout_mirrored = ?3, layout_dy = ?4 WHERE id = ?1", params![case_id, machine_id, mirrored, dy])?;
        // MQ12 / D-c: only when the film's own mm move (its base scale), and then also every film whose mm come from
        // it through a fit with "Use the scale from the fit" on (final review I1: the same rule a scale change uses).
        if crate::machine_scale::base_spacing(&tx, case_id)?.map(f64::to_bits) != before.map(f64::to_bits) {
            let me = [case_id.to_string()];
            let fitted = crate::machine_scale::fitted_to(&tx, &me, |f| Ok(f == case_id || crate::machine_scale::base_spacing(&tx, f)?.is_some()))?;
            let all: Vec<String> = me.into_iter().chain(fitted.into_iter().map(|f| f.0)).collect();
            crate::machine_scale::unverify_all(&tx, &all)?;
        }
        tx.commit()?;
        Ok(MachineMatch { machine_id, mirrored, created })
    }

    /// A confirmed film teaches its machine's pattern (spec Part 2): each token becomes a hashed candidate, and one seen
    /// near the same place on a different confirmed patient's film becomes an anchor. Nothing is recorded until a person
    /// has confirmed the case with a name, and the film's own name, scan ID and Patient ID are never recorded.
    pub fn record_confirmed_film(&mut self, case_id: &str, film: &[FilmToken]) -> anyhow::Result<()> {
        let tx = self.conn.transaction()?;
        let row: Option<ConfirmedCase> = tx.query_row(
            "SELECT c.layout_machine_id, c.layout_mirrored, c.identity_checked, c.patient_id, p.display_name, c.scan_id, c.printed_patient_id,
                    p.referring_practitioner, p.gender
             FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1", [case_id],
            |r| Ok((r.get(0)?, r.get::<_, i64>(1)? == 1, r.get::<_, i64>(2)? == 1, r.get(3)?, r.get(4)?, r.get(5)?, r.get(6)?, r.get(7)?, r.get(8)?))).optional()?;
        let Some((Some(machine), mirrored, true, patient, name, scan_id, printed, referrer, gender)) = row else { return Ok(()) };
        if name.trim().is_empty() { return Ok(()); }
        let own: Vec<String> = own_tokens(&name, &[scan_id.as_deref(), printed.as_deref(), referrer.as_deref()])
            .into_iter().chain(gender_words(gender.as_deref())).collect();
        let dy: f64 = tx.query_row("SELECT layout_dy FROM cases WHERE id = ?1", [case_id], |r| r.get(0))?;
        tx.execute("DELETE FROM layout_candidates WHERE patient_id = ?1", [format!("pending:{case_id}")])?;
        let salt = layout_salt(&tx)?;
        let anchors = anchors_of(&tx, &machine)?;
        let mut seen: Vec<String> = Vec::new();
        for t in film.iter().filter(|t| !own.contains(&t.token) && !is_month(&t.token)) {
            if seen.contains(&t.token) { continue; }
            seen.push(t.token.clone());
            let (cx, cy) = (if mirrored { 1.0 - t.cx } else { t.cx }, t.cy - dy);
            if anchors.iter().any(|a| a.token == t.token && near(a.cx, a.cy, cx, cy)) { continue; }
            let h = token_hash(&salt, &t.token);
            let other: Option<(f64, f64)> = tx.prepare("SELECT cx, cy FROM layout_candidates WHERE machine_id = ?1 AND token_hash = ?2 AND patient_id != ?3 AND patient_id NOT LIKE 'pending:%'")?
                .query_map(params![machine, h, patient], |r| Ok((r.get::<_, f64>(0)?, r.get::<_, f64>(1)?)))?
                .filter_map(Result::ok).find(|(x, y)| near(*x, *y, cx, cy));
            if let Some((x, y)) = other {
                tx.execute("INSERT INTO layout_anchors (machine_id, token, text, cx, cy) VALUES (?1, ?2, ?3, ?4, ?5)",
                    params![machine, t.token, t.text, (x + cx) / 2.0, (y + cy) / 2.0])?;
                tx.execute("DELETE FROM layout_candidates WHERE machine_id = ?1 AND token_hash = ?2 AND patient_id NOT LIKE 'pending:%'", params![machine, h])?;
            } else {
                let mine: i64 = tx.query_row("SELECT COUNT(*) FROM layout_candidates WHERE machine_id = ?1 AND token_hash = ?2 AND patient_id = ?3",
                    params![machine, h, patient], |r| r.get(0))?;
                if mine == 0 {
                    tx.execute("INSERT INTO layout_candidates (machine_id, token_hash, cx, cy, patient_id) VALUES (?1, ?2, ?3, ?4, ?5)",
                        params![machine, h, cx, cy, patient])?;
                }
            }
        }
        name_machine(&tx, &machine)?;
        tx.commit()?;
        Ok(())
    }
}

pub const DEFAULT_AFTER: i64 = 3;

const LABEL_WORDS: [&str; 12] = ["dob", "pid", "id", "name", "se", "im", "acc", "mrn", "sex", "age", "date", "patient"];

/// An unrenamed machine takes the name of its longest anchor row that isn't only field labels.
fn name_machine(tx: &Connection, machine: &str) -> rusqlite::Result<()> {
    let by_user: bool = tx.query_row("SELECT named_by_user FROM layout_machines WHERE id = ?1", [machine], |r| Ok(r.get::<_, i64>(0)? == 1))?;
    if by_user { return Ok(()); }
    let mut a: Vec<(String, String, f64, f64)> = tx.prepare("SELECT token, text, cx, cy FROM layout_anchors WHERE machine_id = ?1")?
        .query_map([machine], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?)))?.collect::<Result<_, _>>()?;
    a.sort_by(|x, y| x.3.total_cmp(&y.3).then(x.2.total_cmp(&y.2)));
    let mut rows: Vec<Vec<&(String, String, f64, f64)>> = Vec::new();
    for t in &a {
        match rows.last_mut() {
            Some(r) if (r[0].3 - t.3).abs() <= 0.01 && (r[0].2 < 0.5) == (t.2 < 0.5) => r.push(t),
            _ => rows.push(vec![t]),
        }
    }
    let best = rows.iter().filter(|r| r.iter().any(|t| !LABEL_WORDS.contains(&t.0.as_str())))
        .map(|r| r.iter().map(|t| t.1.as_str()).collect::<Vec<_>>().join(" ")).max_by_key(|s| s.chars().count());
    if let Some(n) = best { tx.execute("UPDATE layout_machines SET name = ?2 WHERE id = ?1", params![machine, n])?; }
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineSummary {
    pub id: String, pub name: String, pub films: i64, pub learned: Vec<String>,
    /// This machine's calibrated scale (spec 2026-10-20), if any; `applies` is unused here (no film in view).
    pub scale: Option<crate::machine_scale::MachineScale>,
    /// Live films with no ruler that this scale applies to, right now.
    pub scale_films: i64,
}

impl Library {
    /// Every machine recognised on this Mac, with the fields it has a default for (Preferences › Film layouts).
    pub fn list_machines(&self) -> anyhow::Result<Vec<MachineSummary>> {
        let ms: Vec<(String, String, i64)> = self.conn.prepare("SELECT id, name, films FROM layout_machines ORDER BY name")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
        ms.into_iter().map(|(id, name, films)| {
            let counts: Vec<(String, i64)> = self.conn.prepare("SELECT field, count FROM layout_places WHERE machine_id = ?1")?
                .query_map([&id], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
            let patterned = anchors_of(&self.conn, &id)?.len() >= MATCH_MIN_ANCHORS;
            let learned = ceph_label::layout::FIELDS.iter().filter(|_| patterned).filter(|f| {
                let mut c: Vec<i64> = counts.iter().filter(|x| x.0 == **f).map(|x| x.1).collect();
                c.sort_unstable_by(|a, b| b.cmp(a));
                c.first().is_some_and(|top| *top >= DEFAULT_AFTER && c.get(1).is_none_or(|n| top > n))
            }).map(|f| f.to_string()).collect();
            let (scale, scale_films) = crate::machine_scale::scale_of_machine(&self.conn, &id)?;
            Ok(MachineSummary { id, name, films, learned, scale, scale_films })
        }).collect()
    }
    /// A name the clinician chose; it is kept as the machine learns.
    pub fn rename_machine(&mut self, id: &str, name: &str) -> anyhow::Result<()> {
        let n = name.trim();
        anyhow::ensure!(!n.is_empty(), "a machine needs a name");
        self.conn.execute(&format!("UPDATE layout_machines SET name = ?2, named_by_user = 1, updated_at = {NOW} WHERE id = ?1"), params![id, n])?;
        Ok(())
    }
    /// Forgets where this machine prints each detail; keeps its pattern.
    pub fn reset_machine(&mut self, id: &str) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM layout_places WHERE machine_id = ?1", [id])?;
        Ok(())
    }
    /// Forgets everything about this machine; its films keep their cases and simply have no machine.
    pub fn delete_machine(&mut self, id: &str) -> anyhow::Result<()> {
        let tx = self.conn.transaction()?;
        let (_, all) = crate::machine_scale::change_for_delete(&tx, id)?;
        tx.execute("UPDATE cases SET layout_machine_id = NULL, layout_mirrored = 0 WHERE layout_machine_id = ?1", [id])?;
        for t in ["layout_places", "layout_anchors", "layout_candidates"] { tx.execute(&format!("DELETE FROM {t} WHERE machine_id = ?1"), [id])?; }
        tx.execute("DELETE FROM layout_machines WHERE id = ?1", [id])?;
        crate::machine_scale::unverify_all(&tx, &all)?;
        tx.commit()?;
        Ok(())
    }
}

/// A learned place for one field of a machine, as a rule for this case's film (mirrored for a flipped export).
#[derive(Debug, Clone, PartialEq)]
pub struct Place { pub field: String, pub rule: Rule, pub count: i64, pub default: bool }

/// The case's machine, whether its film is flipped against that machine, and how far down it sits.
fn case_machine(conn: &Connection, case_id: &str) -> rusqlite::Result<Option<(String, bool, f64)>> {
    let row: Option<(Option<String>, i64, f64)> = conn.query_row("SELECT layout_machine_id, layout_mirrored, layout_dy FROM cases WHERE id = ?1", [case_id],
        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).optional()?;
    Ok(row.and_then(|(m, mirrored, dy)| m.map(|m| (m, mirrored == 1, dy))))
}

impl Library {
    /// A confirmed detail teaches its machine where it is printed (spec Part 3). The rule is kept in the machine's own
    /// frame (a flipped film's rule is mirrored back). A different place for the same field takes 1 from the leader.
    pub fn learn(&mut self, case_id: &str, field: &str, rule: &Rule) -> anyhow::Result<()> {
        anyhow::ensure!(ceph_label::layout::FIELDS.contains(&field), "unknown field {field}");
        let tx = self.conn.transaction()?;
        let Some((machine, mirrored, dy)) = case_machine(&tx, case_id)? else { return Ok(()) };
        // Defence for final review C1: a rule marked by one of the patient's own words is never stored.
        let (name, scan_id, printed, referrer, gender): (String, Option<String>, Option<String>, Option<String>, Option<String>) = tx.query_row(
            "SELECT p.display_name, c.scan_id, c.printed_patient_id, p.referring_practitioner, p.gender
             FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1",
            [case_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?;
        let own: Vec<String> = own_tokens(&name, &[scan_id.as_deref(), printed.as_deref(), referrer.as_deref()])
            .into_iter().chain(gender_words(gender.as_deref())).collect();
        let marker = |t: &str| own.iter().any(|o| o == t);
        if matches!(&rule.start, Start::After(t) if marker(t)) || matches!(&rule.end, End::Before(t) if marker(t)) { return Ok(()); }
        let mut r = if mirrored { rule.mirrored() } else { rule.clone() };
        r.row_y -= dy;                                                    // stored in the machine's own frame
        let side = if r.right { "right" } else { "left" };
        let rows: Vec<(i64, f64, String, String, String, i64)> = tx.prepare(
            "SELECT rowid, row_y, side, starts, ends, count FROM layout_places WHERE machine_id = ?1 AND field = ?2")?
            .query_map(params![machine, field], |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?, x.get(3)?, x.get(4)?, x.get(5)?)))?
            .collect::<Result<_, _>>()?;
        let same = rows.iter().find(|p| p.2 == side && p.3 == r.start.code() && p.4 == r.end.code() && (p.1 - r.row_y).abs() <= ROW_TOL).map(|p| p.0);
        // One vote per case and field (final review I3): the same answer again changes nothing; a new answer moves it.
        let vote: Option<i64> = tx.query_row("SELECT place FROM layout_votes WHERE case_id = ?1 AND field = ?2", params![case_id, field], |x| x.get(0)).optional()?;
        let old = vote.filter(|v| rows.iter().any(|p| p.0 == *v));
        if old.is_some() && old == same { return Ok(()); }
        let leader = rows.iter().max_by_key(|p| p.5).filter(|p| Some(p.0) != same && p.5 > 0).map(|p| p.0);
        let place = match same {
            Some(id) => { tx.execute(&format!("UPDATE layout_places SET count = count + 1, updated_at = {NOW} WHERE rowid = ?1"), [id])?; id }
            None => {
                tx.execute(&format!("INSERT INTO layout_places (machine_id, field, row_y, side, starts, ends, count, updated_at)
                                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, 1, {NOW})"),
                    params![machine, field, r.row_y, side, r.start.code(), r.end.code()])?;
                tx.last_insert_rowid()
            }
        };
        match old {
            Some(o) => { tx.execute("UPDATE layout_places SET count = count - 1 WHERE rowid = ?1", [o])?; }   // this case changed its answer
            None => { if let Some(id) = leader { tx.execute("UPDATE layout_places SET count = count - 1 WHERE rowid = ?1", [id])?; } }
        }
        tx.execute("INSERT INTO layout_votes (case_id, field, place) VALUES (?1, ?2, ?3)
                    ON CONFLICT (case_id, field) DO UPDATE SET place = excluded.place", params![case_id, field, place])?;
        tx.execute("DELETE FROM layout_places WHERE count <= 0", [])?;
        tx.commit()?;
        Ok(())
    }

    /// The pattern words of this case's machine: a learned rule may start after or end before one of these.
    pub fn anchor_tokens(&self, case_id: &str) -> anyhow::Result<Vec<String>> {
        let Some((machine, _, _)) = case_machine(&self.conn, case_id)? else { return Ok(vec![]) };
        Ok(anchors_of(&self.conn, &machine)?.into_iter().map(|a| a.token).collect())
    }

    /// The machine this case's film was matched to, if any.
    pub fn machine_of(&self, case_id: &str) -> anyhow::Result<Option<String>> {
        Ok(case_machine(&self.conn, case_id)?.map(|(m, _, _)| m))
    }

    /// This film's machine's learned places, as rules for this film, with each field's default marked.
    pub fn places(&self, case_id: &str) -> anyhow::Result<Vec<Place>> {
        let Some((machine, mirrored, dy)) = case_machine(&self.conn, case_id)? else { return Ok(vec![]) };
        // Only a machine with its pattern gives defaults; one without suggests (final review I1).
        let patterned = anchors_of(&self.conn, &machine)?.len() >= MATCH_MIN_ANCHORS;
        let rows: Vec<(i64, String, f64, String, String, String, i64)> = self.conn.prepare(
            "SELECT rowid, field, row_y, side, starts, ends, count FROM layout_places WHERE machine_id = ?1 ORDER BY field, count DESC")?
            .query_map([&machine], |x| Ok((x.get(0)?, x.get(1)?, x.get(2)?, x.get(3)?, x.get(4)?, x.get(5)?, x.get(6)?)))?
            .collect::<Result<_, _>>()?;
        Ok(rows.iter().filter_map(|(id, field, y, side, s, e, count)| {
            let rule = Rule { row_y: *y + dy, right: side == "right", start: Start::parse(s)?, end: End::parse(e)? };
            let best_other = rows.iter().filter(|o| &o.1 == field && o.0 != *id).map(|o| o.6).max().unwrap_or(0);
            Some(Place { field: field.clone(), rule: if mirrored { rule.mirrored() } else { rule }, count: *count,
                default: patterned && *count >= DEFAULT_AFTER && *count > best_other })
        }).collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::CaseMeta;
    use std::path::Path;

    fn film(dir: &Path, name: &str, seed: u8, w: u32, h: u32) -> std::path::PathBuf {
        let p = dir.join(name);
        image::GrayImage::from_fn(w, h, |x, y| image::Luma([((x * 3 + y) as u8).wrapping_add(seed)])).save(&p).unwrap();
        p
    }
    /// "Demo Ceph A": practice line top-left, DOB and PID labels below it (mirrors the fixture in `tests/layouts.rs`).
    fn demo_a(dx: f64) -> Vec<FilmToken> {
        [("demo", 0.05), ("radiology", 0.15), ("northside", 0.27)].iter().map(|(t, x)| tok(t, x + dx, 0.03))
            .chain([tok("dob", 0.04 + dx, 0.12), tok("pid", 0.04 + dx, 0.15)]).collect()
    }
    fn tok(t: &str, x: f64, y: f64) -> FilmToken { FilmToken { token: t.into(), text: t.into(), cx: x, cy: y } }
    fn name(lib: &mut Library, case: &str, n: &str) {
        lib.set_meta(case, &CaseMeta { patient_name: n.into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None }).unwrap();
    }

    /// Owner Q6 (addendum 2026-10-17): a referring practitioner identifies a person at the practice, not the
    /// patient being X-rayed, so their words are never pattern words — modelled on
    /// `a_films_own_patient_id_is_never_a_candidate` (`tests/layouts.rs`), but living here (fix round 1, review
    /// Important 1) so it can call the REAL `token_hash` directly: that function is `pub(crate)`, invisible to the
    /// integration-test crate, and a hand-copied reimplementation there could silently drift from this one and
    /// stop proving anything (the "guard that cannot fail" class).
    #[test] fn a_referrers_words_are_never_pattern_words() {
        let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let mut lib = Library::open(t.path()).unwrap();
        let c = lib.import(&film(src.path(), "a.png", 0, 400, 300)).unwrap().case_id;
        let mut toks = demo_a(0.0);
        toks.extend([tok("smith", 0.05, 0.06), tok("john", 0.12, 0.06), tok("zyxw", 0.10, 0.15)]);   // SYNTHETIC
        lib.match_machine(&c, &toks).unwrap();
        name(&mut lib, &c, "Smith, John");   // SYNTHETIC
        lib.set_patient_referrer(&c, Some("Dr Zyxw Demo")).unwrap();
        lib.record_confirmed_film(&c, &toks).unwrap();
        let salt = layout_salt(&lib.conn_for_tests()).unwrap();
        let candidates: Vec<String> = lib.conn_for_tests().prepare("SELECT token_hash FROM layout_candidates").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert!(!candidates.contains(&token_hash(&salt, "zyxw")), "the referrer's own word is never a pattern word: {candidates:?}");
    }
}
