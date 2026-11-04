use crate::{schema, AiPoint, AiRun, LearningRow, ModelPoints, CaseDoc, CaseEdit, CaseMeta, CaseSummary, ImageInfo, Imported, LandmarkRow, Saved, SeriesFilm, UserNorm, IMAGE_EXTENSIONS, STAGES, KEEP_DELETED_DAYS, SOURCES};
use crate::identity::{self, iso_date_ok, name_key, IdentityOutcome, IdentityRead, PatientRef};
use anyhow::{anyhow, ensure, Context};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use sha2::{Digest, Sha256};
use std::{collections::HashMap, fs, path::{Path, PathBuf}};

/// ISO-8601 UTC with milliseconds, evaluated by SQLite so every timestamp comes from one clock.
pub(crate) const NOW: &str = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";
const THUMB_PX: u32 = 320;
const MIN_CALIBRATION_PX: f64 = 20.0;

/// What reading a film's label did: the identity check, the fields filled from a learned default, and any field where
/// the label and the learned default disagreed (left blank; the clinician chooses).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelApplied { pub outcome: IdentityOutcome, pub learned_fields: Vec<String>, pub conflicts: Vec<identity::Conflict> }

pub struct Library { pub(crate) conn: Connection, root: PathBuf, upgrade_copy: Option<PathBuf> }

/// Shown, and the library not opened, when the safety copy before a format upgrade can't be made or checked (AUTOBACKUP-1).
pub const UPGRADE_COPY_FAILED: &str = "Couldn't make a safety copy before upgrading. Your library hasn't been changed.";
/// Where the safety copies made before a format upgrade go, inside the library folder. Never deleted automatically.
pub const UPGRADE_BACKUPS_DIR: &str = "upgrade-backups";

fn hex(bytes: &[u8]) -> String { bytes.iter().map(|b| format!("{b:02x}")).collect() }

/// Write to a temporary sibling, then rename: a crash never leaves a half-written file under the final name.
fn write_atomic(dest: &Path, write: impl FnOnce(&Path) -> anyhow::Result<()>) -> anyhow::Result<()> {
    let tmp = dest.with_extension(format!("tmp-{}", uuid::Uuid::new_v4()));
    write(&tmp).and_then(|_| fs::rename(&tmp, dest).map_err(Into::into)).inspect_err(|_| { fs::remove_file(&tmp).ok(); })
}

fn row_to_landmark(r: &rusqlite::Row) -> rusqlite::Result<LandmarkRow> {
    Ok(LandmarkRow { id: r.get(0)?, x: r.get(1)?, y: r.get(2)?, source: r.get(3)?, verified: r.get::<_, i64>(4)? == 1,
        ai_x: r.get(5)?, ai_y: r.get(6)?, confidence: r.get(7)?, placed_by: r.get(8)? })
}

fn landmarks_of(conn: &Connection, case_id: &str) -> rusqlite::Result<Vec<LandmarkRow>> {
    conn.prepare("SELECT id, x, y, source, verified, ai_x, ai_y, confidence, placed_by FROM landmarks WHERE case_id = ?1 ORDER BY rowid")?
        .query_map([case_id], row_to_landmark)?.collect()
}

/// The patient with this name key and date of birth, created if new. `rename` (a person typed the name) makes this
/// spelling the patient's printed name; a name read from a film never renames an existing patient.
/// A patient with no name yet (owner, 29 Sep: blank beats a wrong name). Its key is unique, so it never matches another.
fn new_unnamed(tx: &Transaction, dob: Option<&str>) -> rusqlite::Result<String> {
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute(&format!("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES (?1, '', ?2, ?3, {NOW})"),
        params![id, format!("~{id}"), dob])?;
    Ok(id)
}

/// The case's patient while its name is blank: its own unnamed patient (given `dob`), created if it has a named one.
fn unnamed_for(tx: &Transaction, case_id: &str, dob: Option<&str>) -> rusqlite::Result<String> {
    let (pid, name): (String, String) = tx.query_row("SELECT p.id, p.display_name FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1",
        [case_id], |r| Ok((r.get(0)?, r.get(1)?)))?;
    if name.trim().is_empty() {
        tx.execute("UPDATE patients SET date_of_birth = ?2 WHERE id = ?1", params![pid, dob])?;
        return Ok(pid);
    }
    new_unnamed(tx, dob)
}

fn patient_for(tx: &Transaction, name: &str, dob: Option<&str>, rename: bool) -> rusqlite::Result<String> {
    if name.trim().is_empty() { return new_unnamed(tx, dob); }
    let key = name_key(name);
    let found: Option<String> = tx.query_row("SELECT id FROM patients WHERE name_key = ?1 AND date_of_birth IS ?2 ORDER BY created_at LIMIT 1",
        params![key, dob], |r| r.get(0)).optional()?;
    if let Some(id) = found {
        if rename { tx.execute("UPDATE patients SET display_name = ?2 WHERE id = ?1", params![id, name])?; }
        return Ok(id);
    }
    let id = uuid::Uuid::new_v4().to_string();
    tx.execute(&format!("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES (?1, ?2, ?3, ?4, {NOW})"),
        params![id, name, key, dob])?;
    Ok(id)
}

/// Moves a case to another patient as that patient's next timepoint (T1, T2, …); a patient left with no cases is removed,
/// after its Library ID is settled (handed on or merged: `library_ids::settle_after_move`).
fn move_case(tx: &Transaction, case_id: &str, pid: &str, how: crate::library_ids::Move) -> rusqlite::Result<()> {
    let cur: String = tx.query_row("SELECT patient_id FROM cases WHERE id = ?1", [case_id], |r| r.get(0))?;
    if cur == pid { return Ok(()); }
    let n: i64 = tx.query_row("SELECT COUNT(*) FROM cases WHERE patient_id = ?1", [pid], |r| r.get(0))?;
    tx.execute("UPDATE cases SET patient_id = ?2, timepoint = ?3 WHERE id = ?1", params![case_id, pid, format!("T{}", n + 1)])?;
    renumber_by_date(tx, pid)?;
    crate::library_ids::settle_after_move(tx, case_id, &cur, pid, how)?;
    tx.execute("DELETE FROM patients WHERE id NOT IN (SELECT patient_id FROM cases)", [])?;
    // Final review M1: Gender and Referrer are the patient's, and this move never carries them, so a "Learned for this
    // machine" mark from the old patient would sit beside values that were never learned.
    for f in ["gender", "referrer"] { crate::details::drop_learned(tx, case_id, f)?; }
    Ok(())
}

/// A patient's T-numbers follow the film dates, so T1 is the oldest film (owner, 30 Sep). Only the T-numbered live cases take
/// part and they swap the numbers they already hold, so a named timepoint ("Pre") or one in Recently deleted never clashes.
/// Nothing moves while any of them is dated only by its import day: that film could be older or newer than any other.
pub(crate) fn renumber_by_date(tx: &Transaction, pid: &str) -> rusqlite::Result<()> {
    type Film = (String, String, Option<String>, Option<String>, String);   // id, timepoint, film date, its source, imported
    let rows: Vec<Film> = tx.prepare(
        "SELECT id, timepoint, taken_on, taken_on_source, created_at FROM cases WHERE patient_id = ?1 AND deleted_at IS NULL")?
        .query_map([pid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?.collect::<Result<_, _>>()?;
    let mut films: Vec<(String, u32, String, String)> = vec![];
    for (id, tp, taken_on, source, created) in rows {
        let Some(n) = tp.trim().strip_prefix(['T', 't']).and_then(|n| n.parse::<u32>().ok()) else { continue };
        match taken_on { Some(d) if source.as_deref() != Some("import") => films.push((id, n, d, created)), _ => return Ok(()) }
    }
    let mut numbers: Vec<u32> = films.iter().map(|f| f.1).collect();
    numbers.sort_unstable();
    films.sort_by(|a, b| (&a.2, a.1, &a.3).cmp(&(&b.2, b.1, &b.3)));
    for ((id, n, ..), to) in films.iter().zip(numbers) {
        if *n != to { tx.execute("UPDATE cases SET timepoint = ?2 WHERE id = ?1", params![id, format!("T{to}")])?; }
    }
    Ok(())
}

pub(crate) fn live_case(tx: &Transaction, case_id: &str) -> anyhow::Result<()> {
    let deleted: Option<Option<String>> = tx.query_row("SELECT deleted_at FROM cases WHERE id = ?1", [case_id], |r| r.get(0)).optional()?;
    match deleted { None => Err(anyhow!("no case {case_id} in the library")), Some(Some(_)) => Err(anyhow!("case {case_id} is in Recently deleted; restore it first")), Some(None) => Ok(()) }
}

/// The body of an autosave, inside the caller's transaction: replaces the case's landmarks and view state and appends an
/// event per change. Any landmark change clears "Tracing verified".
fn save_in(tx: &Transaction, e: &CaseEdit, operator: &str) -> anyhow::Result<Saved> {
    ensure!(e.facing == "right" || e.facing == "left", "facing must be right or left, not {:?}", e.facing);
    for l in &e.landmarks {
        ensure!(SOURCES.contains(&l.source.as_str()), "{}: unknown source {:?}", l.id, l.source);
        ensure!(l.x.is_finite() && l.y.is_finite(), "{}: position is not a number", l.id);
    }
    live_case(tx, &e.id)?;
    let old: HashMap<String, LandmarkRow> = landmarks_of(tx, &e.id)?.into_iter().map(|l| (l.id.clone(), l)).collect();
    let mut changed = false;
    {
        let mut event = tx.prepare(&format!("INSERT INTO landmark_events (case_id, landmark, kind, x, y, source, operator, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, {NOW})"))?;
        let mut upsert = tx.prepare(&format!(
            "INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, placed_by, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, {NOW})
             ON CONFLICT (case_id, id) DO UPDATE SET x = excluded.x, y = excluded.y, source = excluded.source, verified = excluded.verified,
               ai_x = excluded.ai_x, ai_y = excluded.ai_y, confidence = excluded.confidence,
               placed_by = CASE WHEN excluded.source = 'manual' THEN NULL ELSE COALESCE(excluded.placed_by, landmarks.placed_by) END,
               updated_at = excluded.updated_at"))?;
        // The learning record has no foreign key to `landmarks` (schema 10): a point that is removed or changed loses its
        // learning rows here, in the same transaction, and the app rebuilds them after the save. A row therefore never
        // outlives the point it was measured on, even if the rebuild fails. The record never fails a save (preflight c8):
        // if the table cannot be reached the save goes on and the failure is logged (a failed statement rolls back only
        // itself, never the save's transaction).
        let mut forget_stmt = tx.prepare("DELETE FROM learning_record WHERE case_id = ?1 AND landmark_id = ?2")
            .inspect_err(|err| eprintln!("learning record: rows of case {} not cleared on save: {err}", e.id)).ok();
        let mut forget = |lm: &str| if let Some(st) = forget_stmt.as_mut() {
            if let Err(err) = st.execute(params![e.id, lm]) { eprintln!("learning record: rows of {} / {lm} not cleared on save: {err}", e.id); }
        };
        for l in &e.landmarks {
            let prev = old.get(&l.id);
            if prev == Some(l) { continue; }
            // Only `placed_by` differs (or is missing): not a landmark change, so no event and "Tracing verified" stays.
            let only_placer = prev.is_some_and(|p| LandmarkRow { placed_by: l.placed_by.clone(), ..p.clone() } == *l);
            if only_placer {
                tx.execute("UPDATE landmarks SET placed_by = CASE WHEN source = 'manual' THEN NULL ELSE COALESCE(?3, placed_by) END WHERE case_id = ?1 AND id = ?2",
                    params![e.id, l.id, l.placed_by])?;
                continue;
            }
            changed = true;
            forget(&l.id);
            let kind = match prev {
                Some(p) if (p.x, p.y) == (l.x, l.y) && !p.verified && l.verified => Some("accept"),
                Some(p) if (p.x, p.y) == (l.x, l.y) => None,                     // e.g. un-verify on undo: no position change
                _ if l.source == "ai" => Some("ai"),
                _ => Some("move"),
            };
            if let Some(kind) = kind { event.execute(params![e.id, l.id, kind, l.x, l.y, l.source, operator])?; }
            let placed_by = if l.source == "manual" { None } else { l.placed_by.clone() };
            upsert.execute(params![e.id, l.id, l.x, l.y, l.source, l.verified as i64, l.ai_x, l.ai_y, l.confidence, placed_by])?;
        }
        for id in old.keys().filter(|id| !e.landmarks.iter().any(|l| &l.id == *id)) {
            changed = true;
            tx.execute("DELETE FROM landmarks WHERE case_id = ?1 AND id = ?2", params![e.id, id])?;
            forget(id);
            event.execute(params![e.id, id, "remove", None::<f64>, None::<f64>, None::<String>, operator])?;
        }
    }
    tx.execute(&format!("UPDATE cases SET facing = ?2, orientation = ?3, display = ?4, updated_at = {NOW},
                          verified_at = CASE WHEN ?5 THEN NULL ELSE verified_at END, verified_by = CASE WHEN ?5 THEN NULL ELSE verified_by END WHERE id = ?1"),
        params![e.id, e.facing, e.orientation.to_string(), e.display.to_string(), changed])?;
    let saved = tx.query_row("SELECT updated_at, verified_at FROM cases WHERE id = ?1", [&e.id], |r| Ok(Saved { updated_at: r.get(0)?, verified_at: r.get(1)? }))?;
    Ok(saved)
}

impl Library {
    /// Opens (creating if needed) the library in `root`: library.sqlite3, images/, thumbs/.
    pub fn open(root: &Path) -> anyhow::Result<Self> { open_with(root, schema::CURRENT, &check_copy) }

    /// The safety copy made before this open upgraded the library's format, if it did (AUTOBACKUP-1).
    pub fn upgrade_copy(&self) -> Option<&Path> { self.upgrade_copy.as_deref() }

    pub fn root(&self) -> &Path { &self.root }
    fn image_path(&self, sha: &str, ext: &str) -> PathBuf { self.root.join("images").join(format!("{sha}.{ext}")) }
    fn thumb_path(&self, sha: &str) -> PathBuf { self.root.join("thumbs").join(format!("{sha}.jpg")) }

    /// Copies the film into the library (once per distinct content) and returns its case: the existing live case
    /// for that film if there is one, otherwise a new case for a patient named after the file.
    pub fn import(&mut self, src: &Path) -> anyhow::Result<Imported> {
        let name = src.file_name().and_then(|n| n.to_str()).unwrap_or("image").to_string();
        let ext = src.extension().and_then(|e| e.to_str()).map(str::to_ascii_lowercase)
            .filter(|e| IMAGE_EXTENSIONS.contains(&e.as_str()))
            .ok_or_else(|| anyhow!("can’t import “{name}”: use a PNG, JPEG, TIFF or BMP cephalogram"))?;
        let bytes = fs::read(src).with_context(|| format!("could not read “{name}”"))?;
        let img = image::load_from_memory(&bytes).with_context(|| format!("“{name}” is not a readable image"))?;
        let sha = hex(&Sha256::digest(&bytes));

        let stored_ext: Option<String> = self.conn.query_row("SELECT ext FROM images WHERE sha256 = ?1", [&sha], |r| r.get(0)).optional()?;
        let ext = stored_ext.unwrap_or(ext);
        let dest = self.image_path(&sha, &ext);
        if !dest.exists() { write_atomic(&dest, |t| Ok(fs::write(t, &bytes)?))?; }
        let thumb = self.thumb_path(&sha);
        if !thumb.exists() {
            let small = img.thumbnail(THUMB_PX, THUMB_PX).to_luma8();
            write_atomic(&thumb, |t| Ok(small.save_with_format(t, image::ImageFormat::Jpeg)?))?;
        }

        let tx = self.conn.transaction()?;
        tx.execute(&format!("INSERT OR IGNORE INTO images (sha256, ext, width, height, bytes, original_name, imported_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, {NOW})"),
            params![sha, ext, img.width(), img.height(), bytes.len() as i64, name])?;
        let existing: Option<String> = tx.query_row("SELECT id FROM cases WHERE image_sha256 = ?1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1", [&sha], |r| r.get(0)).optional()?;
        if let Some(case_id) = existing { tx.commit()?; return Ok(Imported { case_id, created: false }); }
        let pid = new_unnamed(&tx, None)?;                                   // the file name is never taken as the patient's name
        let n: i64 = tx.query_row("SELECT COUNT(*) FROM cases WHERE patient_id = ?1", [&pid], |r| r.get(0))?;
        let case_id = uuid::Uuid::new_v4().to_string();
        // Film date until the label says otherwise: the file's own EXIF date, else today's date on this Mac.
        let (taken_on, source) = match crate::filedate::exif_date(&bytes) {
            Some(d) => (d, "image"),
            None => (tx.query_row("SELECT date('now', 'localtime')", [], |r| r.get::<_, String>(0))?, "import"),
        };
        tx.execute(&format!("INSERT INTO cases (id, patient_id, image_sha256, timepoint, taken_on, taken_on_source, created_at, updated_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, {NOW}, {NOW})"),
            params![case_id, pid, sha, format!("T{}", n + 1), taken_on, source])?;
        crate::library_ids::record_import(&tx, &case_id, &pid)?;
        tx.commit()?;
        Ok(Imported { case_id, created: true })
    }

    pub fn load(&self, case_id: &str) -> anyhow::Result<CaseDoc> {
        let mut doc = self.conn.query_row(
            "SELECT c.id, p.display_name, c.timepoint, c.taken_on, c.facing, c.orientation, c.display, c.spacing_mm, c.verified_at, c.verified_by,
                    c.created_at, c.updated_at, i.sha256, i.ext, i.width, i.height, i.original_name,
                    p.name_key, p.date_of_birth, c.scan_id, c.identity_source, c.identity_checked, c.taken_on_source, c.learned_fields,
                    p.gender, p.referring_practitioner, c.population, c.printed_patient_id, c.xray_type, c.xray_size, c.radiography_practice, p.library_no
             FROM cases c JOIN patients p ON p.id = c.patient_id JOIN images i ON i.sha256 = c.image_sha256 WHERE c.id = ?1", [case_id], |r| {
                let json = |k: usize| -> rusqlite::Result<serde_json::Value> {
                    let s: String = r.get(k)?; serde_json::from_str(&s).map_err(|e| rusqlite::Error::FromSqlConversionFailure(k, rusqlite::types::Type::Text, Box::new(e)))
                };
                let (sha, ext): (String, String) = (r.get(12)?, r.get(13)?);
                Ok(CaseDoc { id: r.get(0)?, patient_name: r.get(1)?, timepoint: r.get(2)?, taken_on: r.get(3)?, facing: r.get(4)?,
                    orientation: json(5)?, display: json(6)?, spacing_mm: r.get(7)?, verified_at: r.get(8)?, verified_by: r.get(9)?,
                    created_at: r.get(10)?, updated_at: r.get(11)?,
                    image: ImageInfo { path: self.image_path(&sha, &ext).display().to_string(), sha256: sha, ext, width: r.get(14)?, height: r.get(15)?, original_name: r.get(16)? },
                    patient_key: r.get(17)?, date_of_birth: r.get(18)?, scan_id: r.get(19)?, identity_source: r.get(20)?,
                    identity_checked: r.get::<_, i64>(21)? == 1, identity_issues: vec![], taken_on_source: r.get(22)?,
                    learned_fields: r.get::<_, String>(23)?.split(',').filter(|s| !s.is_empty()).map(String::from).collect(),
                    gender: r.get(24)?, referring_practitioner: r.get(25)?, population: r.get(26)?,
                    printed_patient_id: r.get(27)?, xray_type: r.get(28)?, xray_size: r.get(29)?, radiography_practice: r.get(30)?,
                    library_id: r.get::<_, Option<i64>>(31)?.map(crate::library_ids::library_id_text),
                    patient_ids_seen: vec![], id_matches: vec![], library_trail: vec![],   // filled below, once case_id/pid are known
                    landmarks: vec![] })
            }).optional()?.ok_or_else(|| anyhow!("no case {case_id} in the library"))?;
        doc.landmarks = landmarks_of(&self.conn, case_id)?;
        doc.identity_issues = identity::issues_in(&self.conn, case_id)?;
        let pid: String = self.conn.query_row("SELECT patient_id FROM cases WHERE id = ?1", [case_id], |r| r.get(0))?;
        doc.patient_ids_seen = crate::library_ids::ids_seen(&self.conn, &pid)?;
        doc.id_matches = crate::library_ids::matches_for(&self.conn, case_id)?;
        doc.library_trail = crate::library_ids::trail(&self.conn, &pid)?;
        Ok(doc)
    }

    /// Autosave: replaces the case's landmarks and view state in one transaction and appends an event per change.
    /// Any landmark change clears "Tracing verified".
    pub fn save(&mut self, e: &CaseEdit, operator: &str) -> anyhow::Result<Saved> {
        let tx = self.conn.transaction()?;
        let saved = save_in(&tx, e, operator)?;
        tx.commit()?;
        Ok(saved)
    }

    /// Batch tracing: writes AI points only if the case still has no landmarks, checked in the same transaction, so a
    /// case the clinician opened and edited meanwhile is never overwritten. Returns whether it wrote.
    pub fn save_ai_if_untraced(&mut self, e: &CaseEdit, operator: &str) -> anyhow::Result<bool> {
        let tx = self.conn.transaction()?;
        let n: i64 = tx.query_row("SELECT COUNT(*) FROM landmarks WHERE case_id = ?1", [&e.id], |r| r.get(0))?;
        if n > 0 { return Ok(false); }
        save_in(&tx, e, operator)?;
        tx.commit()?;
        Ok(true)
    }

    /// One model run and every channel's point (spec 2026-10-01 Part 3), in one transaction. Returns the run's id.
    pub fn record_ai_run(&mut self, case_id: &str, run: &AiRun, points: &[AiPoint]) -> anyhow::Result<i64> {
        let tx = self.conn.transaction()?;
        tx.execute(&format!("INSERT INTO ai_runs (case_id, model_id, execution_provider, facing, total_ms, model_sha256, ran_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, {NOW})"),
            params![case_id, run.model_id, run.execution_provider, run.facing, run.total_ms, run.model_sha256])?;
        let id = tx.last_insert_rowid();
        {
            let mut st = tx.prepare("INSERT INTO ai_points (run_id, channel, landmark_id, x, y, peak) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?;
            for p in points { st.execute(params![id, p.channel, p.landmark_id, p.x, p.y, p.peak])?; }
        }
        tx.commit()?;
        Ok(id)
    }

    /// The newest run of each model on this film, with its points (ordered by model id, then channel).
    pub fn latest_ai_points(&self, case_id: &str) -> anyhow::Result<Vec<ModelPoints>> {
        type Run = (i64, String, String, String, String, Option<String>);
        let runs: Vec<Run> = self.conn.prepare(
            "SELECT r.id, r.model_id, r.ran_at, r.facing, r.execution_provider, r.model_sha256 FROM ai_runs r
             WHERE r.case_id = ?1 AND r.id = (SELECT MAX(id) FROM ai_runs WHERE case_id = r.case_id AND model_id = r.model_id)
             ORDER BY r.model_id")?
            .query_map([case_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?.collect::<Result<_, _>>()?;
        let mut st = self.conn.prepare("SELECT channel, landmark_id, x, y, peak FROM ai_points WHERE run_id = ?1 ORDER BY channel")?;
        runs.into_iter().map(|(id, model_id, ran_at, facing, execution_provider, model_sha256)| {
            let points = st.query_map([id], |r| Ok(AiPoint { channel: r.get(0)?, landmark_id: r.get(1)?, x: r.get(2)?, y: r.get(3)?, peak: r.get(4)? }))?
                .collect::<Result<_, _>>()?;
            Ok(ModelPoints { model_id, ran_at, facing, points, execution_provider, model_sha256 })
        }).collect()
    }

    /// Every stored run of the case with its points, newest first (fix round 1, review I1): the learning record finds
    /// the run that placed a point among these, not only among each model's newest run.
    pub fn ai_run_history(&self, case_id: &str) -> anyhow::Result<Vec<ModelPoints>> {
        type Run = (i64, String, String, String, String, Option<String>);
        let runs: Vec<Run> = self.conn.prepare(
            "SELECT id, model_id, ran_at, facing, execution_provider, model_sha256 FROM ai_runs WHERE case_id = ?1 ORDER BY id DESC")?
            .query_map([case_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))?.collect::<Result<_, _>>()?;
        let mut st = self.conn.prepare("SELECT channel, landmark_id, x, y, peak FROM ai_points WHERE run_id = ?1 ORDER BY channel")?;
        runs.into_iter().map(|(id, model_id, ran_at, facing, execution_provider, model_sha256)| {
            let points = st.query_map([id], |r| Ok(AiPoint { channel: r.get(0)?, landmark_id: r.get(1)?, x: r.get(2)?, y: r.get(3)?, peak: r.get(4)? }))?
                .collect::<Result<_, _>>()?;
            Ok(ModelPoints { model_id, ran_at, facing, points, execution_provider, model_sha256 })
        }).collect()
    }

    /// The learning record (spec 2026-10-13 "Parked" P5): every row of the case replaced in one transaction (a moved point
    /// updates, an un-verified one goes). A row whose distance is not a finite number ≥ 0 refuses the whole call (the old
    /// rows stand); so does a case in Recently deleted.
    pub fn replace_learning(&mut self, case_id: &str, rows: &[LearningRow], operator: &str) -> anyhow::Result<()> {
        for r in rows {
            ensure!(r.dist_px.is_finite() && r.dist_px >= 0.0 && r.dist_mm.is_finite() && r.dist_mm >= 0.0,
                "learning row {} / {}: distance is not a number ≥ 0", r.landmark_id, r.model_id);
        }
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute("DELETE FROM learning_record WHERE case_id = ?1", [case_id])?;
        {
            let mut st = tx.prepare(&format!("INSERT INTO learning_record (case_id, landmark_id, model_id, model_sha256, execution_provider, dist_px, dist_mm,
                mm_assumed, machine, how, placer, operator, recorded_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, {NOW})"))?;
            for r in rows { st.execute(params![case_id, r.landmark_id, r.model_id, r.model_sha256, r.execution_provider, r.dist_px, r.dist_mm,
                r.mm_assumed as i64, r.machine, r.how, r.placer as i64, operator])?; }
        }
        tx.commit()?;
        Ok(())
    }

    /// The case's learning rows, by landmark, then model.
    pub fn learning_rows(&self, case_id: &str) -> anyhow::Result<Vec<LearningRow>> {
        Ok(self.conn.prepare("SELECT landmark_id, model_id, model_sha256, execution_provider, dist_px, dist_mm, mm_assumed, machine, how, placer
            FROM learning_record WHERE case_id = ?1 ORDER BY landmark_id, model_id")?
            .query_map([case_id], |r| Ok(LearningRow { landmark_id: r.get(0)?, model_id: r.get(1)?, model_sha256: r.get(2)?, execution_provider: r.get(3)?,
                dist_px: r.get(4)?, dist_mm: r.get(5)?, mm_assumed: r.get::<_, i64>(6)? == 1, machine: r.get(7)?, how: r.get(8)?, placer: r.get::<_, i64>(9)? == 1 }))?
            .collect::<Result<_, _>>()?)
    }

    /// The raw connection, for tests in other crates only (e.g. dropping `learning_record` to show a save survives it).
    #[doc(hidden)]
    pub fn conn_for_tests(&self) -> &Connection { &self.conn }

    /// Ruler calibration (decision 17): spacing = mm / ‖p1 − p2‖. Stored for audit; clears "Tracing verified"
    /// because every mm value changes. Returns the new mm per px.
    pub fn calibrate(&mut self, case_id: &str, p1: (f64, f64), p2: (f64, f64), mm: f64, operator: &str) -> anyhow::Result<f64> {
        ensure!(mm.is_finite() && mm > 0.0, "enter the true distance between the marks in millimetres");
        let px = (p2.0 - p1.0).hypot(p2.1 - p1.1);
        ensure!(px.is_finite() && px >= MIN_CALIBRATION_PX, "the marks are {px:.1} px apart; pick two ruler marks at least {MIN_CALIBRATION_PX} px apart");
        let spacing = mm / px;
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute(&format!("INSERT INTO calibrations (case_id, x1, y1, x2, y2, mm, spacing_mm, operator, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, {NOW})"),
            params![case_id, p1.0, p1.1, p2.0, p2.1, mm, spacing, operator])?;
        tx.execute(&format!("UPDATE cases SET spacing_mm = ?2, verified_at = NULL, verified_by = NULL, updated_at = {NOW} WHERE id = ?1"), params![case_id, spacing])?;
        // Every learning row's millimetres were at the old scale; the app rebuilds them after the calibration. Best
        // effort: the record never fails a calibration (fix round 1, review M1); a failed statement rolls back only itself.
        if let Err(err) = tx.execute("DELETE FROM learning_record WHERE case_id = ?1", [case_id]) {
            eprintln!("learning record: rows of case {case_id} not cleared on calibration: {err}");
        }
        tx.commit()?;
        Ok(spacing)
    }

    /// Patient name, date of birth, timepoint, film date and scan ID, typed by a person. The case moves to the patient
    /// with that name and date of birth (created if new; this spelling becomes the printed name), a patient left with no
    /// cases is removed, and the details count as checked.
    pub fn set_meta(&mut self, case_id: &str, m: &CaseMeta) -> anyhow::Result<()> {
        let name = m.patient_name.trim();                                   // blank = not known yet: the case keeps asking
        ensure!(!m.timepoint.trim().is_empty(), "the timepoint can’t be empty");
        for (label, d) in [("date of birth", &m.date_of_birth), ("film date", &m.taken_on)] {
            if let Some(d) = d { ensure!(iso_date_ok(d), "the {label} {d:?} is not a valid date"); }
        }
        let scan_id = m.scan_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        // Owner, 30 Sep: only the details a person changed count as confirmed; the rest keep "Learned for this machine".
        type Current = (String, Option<String>, Option<String>, Option<String>, String);   // name, dob, film date, scan ID, learned
        let (cur_name, cur_dob, cur_date, cur_scan, learned): Current = tx.query_row(
            "SELECT p.display_name, p.date_of_birth, c.taken_on, c.scan_id, c.learned_fields FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1",
            [case_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)))?;
        let changed = |f: &str| match f {
            "name" => cur_name != name, "dob" => cur_dob != m.date_of_birth, "scan_date" => cur_date != m.taken_on,
            "scan_id" => cur_scan.as_deref() != scan_id,
            // Format 11: saved on their own (details.rs). Gender and Referrer (owner Q6) are too, since Task 7:
            // `set_patient_gender`/`set_patient_referrer` drop their own mark, so a name edit here must never drop it.
            "patient_id" | "xray_type" | "xray_size" | "practice" | "gender" | "referrer" => false,
            _ => true,
        };
        let still_learned_fields: Vec<&str> = learned.split(',').filter(|f| !f.is_empty() && !changed(f)).collect();
        // A film that becomes a new patient keeps its Gender and Referrer; one that joins an existing patient shows that
        // patient's (spec 2026-10-04). Its Patient ID is on the film itself (addendum D2, Q8), so no move touches it.
        // New patients get rowids above today's highest.
        let (old_pid, old_gender, old_ref): (String, Option<String>, Option<String>) = tx.query_row(
            "SELECT p.id, p.gender, p.referring_practitioner FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1",
            [case_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
        let last_rowid: i64 = tx.query_row("SELECT COALESCE(MAX(rowid), 0) FROM patients", [], |r| r.get(0))?;
        let pid = if name.is_empty() { unnamed_for(&tx, case_id, m.date_of_birth.as_deref())? } else { patient_for(&tx, name, m.date_of_birth.as_deref(), true)? };
        let is_new: bool = tx.query_row("SELECT rowid > ?2 FROM patients WHERE id = ?1", params![pid, last_rowid], |r| r.get(0))?;
        if is_new && pid != old_pid {
            tx.execute("UPDATE patients SET gender = ?2, referring_practitioner = ?3 WHERE id = ?1", params![pid, old_gender, old_ref])?;
        }
        // Final review M1: joining an existing patient shows THAT patient's Gender and Referrer, so their marks go.
        let joins_existing = !is_new && pid != old_pid;
        let still_learned = still_learned_fields.into_iter().filter(|f| !(joins_existing && matches!(*f, "gender" | "referrer")))
            .collect::<Vec<_>>().join(",");
        tx.execute("UPDATE cases SET learned_fields = ?2, identity_source = CASE WHEN ?3 THEN 'manual' ELSE identity_source END WHERE id = ?1",
            params![case_id, still_learned, changed("name")])?;
        // A Timepoint, film date or scan ID edit leaves "Check patient details" as it was; a typed name or DOB is a check.
        let checked = if changed("name") || changed("dob") { !name.is_empty() } else {
            tx.query_row("SELECT identity_checked FROM cases WHERE id = ?1", [case_id], |r| Ok(r.get::<_, i64>(0)? == 1))? };
        tx.execute(&format!("UPDATE cases SET patient_id = ?2, timepoint = ?3, scan_id = ?5, identity_checked = ?6,
                              taken_on_source = CASE WHEN taken_on IS ?4 THEN taken_on_source WHEN ?4 IS NULL THEN NULL ELSE 'manual' END,
                              taken_on = ?4, updated_at = {NOW} WHERE id = ?1"),
            params![case_id, pid, m.timepoint.trim(), m.taken_on, scan_id, checked])?;
        renumber_by_date(&tx, &pid)?;
        use crate::library_ids::Move;
        let how = if name.is_empty() { Move::Cleared } else if cur_name.trim().is_empty() { Move::Typed } else { Move::Corrected };
        crate::library_ids::settle_after_move(&tx, case_id, &old_pid, &pid, how)?;      // Library ID: kept, merged or issued (LIBID-1/2)
        tx.execute("DELETE FROM patients WHERE id NOT IN (SELECT patient_id FROM cases)", [])?;
        tx.commit()?;
        Ok(())
    }

    /// The patient's gender ("F", "M" or None = Not recorded; spec 2026-10-04), saved on the case's patient so every
    /// film of that patient shows it. Writes only this column (final-review fix round, Important 1: the old
    /// `set_patient_details(case, gender, referrer)` wrote both fields every call, so a Gender save and a Referrer
    /// save landing out of order could silently lose whichever arrived first — split so neither save can touch the
    /// other's column). Taught to the machine since D2 (owner Q6): a person typing Gender drops its own "Learned
    /// for this machine" mark on this X-ray, like every other detail.
    pub fn set_patient_gender(&mut self, case_id: &str, gender: Option<&str>) -> anyhow::Result<()> {
        ensure!(matches!(gender, None | Some("F") | Some("M")), "gender must be F, M or not recorded, not {gender:?}");
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute("UPDATE patients SET gender = ?2 WHERE id = (SELECT patient_id FROM cases WHERE id = ?1)",
            params![case_id, gender])?;
        crate::details::drop_learned(&tx, case_id, "gender")?;
        tx.commit()?;
        Ok(())
    }
    /// The patient's referring practitioner (spec 2026-10-04), saved on the case's patient so every film of that
    /// patient shows it. A blank referrer is None. Writes only this column (see `set_patient_gender`). Taught to the
    /// machine since D2 (owner Q6): see `set_patient_gender`.
    pub fn set_patient_referrer(&mut self, case_id: &str, referrer: Option<&str>) -> anyhow::Result<()> {
        let referrer = referrer.map(str::trim).filter(|s| !s.is_empty());
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute("UPDATE patients SET referring_practitioner = ?2 WHERE id = (SELECT patient_id FROM cases WHERE id = ?1)",
            params![case_id, referrer])?;
        crate::details::drop_learned(&tx, case_id, "referrer")?;
        tx.commit()?;
        Ok(())
    }

    /// The reference population chosen for this case (spec 2026-10-06 Part C, N6; schema 9); `None` or a blank
    /// string clears it back to "use the clinic default" (`default_population`), the same trim pattern
    /// `set_patient_referrer` uses. Refuses a soft-deleted case, like the setters next to it (fix round 1,
    /// Important 2). A display choice: never clears "Tracing verified".
    pub fn set_case_population(&mut self, case_id: &str, population: Option<&str>) -> anyhow::Result<()> {
        let population = population.map(str::trim).filter(|s| !s.is_empty());
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute("UPDATE cases SET population = ?2 WHERE id = ?1", params![case_id, population])?;
        tx.commit()?;
        Ok(())
    }

    /// Every clinician-entered norm (spec 2026-10-06 Part C; schema 9), by set name then measurement. Never in git;
    /// always labelled "user norm" by the caller.
    pub fn user_norms(&self) -> anyhow::Result<Vec<UserNorm>> {
        Ok(self.conn.prepare("SELECT set_name, measurement, mean, sd, source_note FROM user_norms ORDER BY set_name, measurement")?
            .query_map([], |r| Ok(UserNorm { set_name: r.get(0)?, measurement: r.get(1)?, mean: r.get(2)?, sd: r.get(3)?, source_note: r.get(4)? }))?
            .collect::<Result<_, _>>()?)
    }
    /// Upserts one clinician-entered norm, keyed on (set name, measurement). Refuses an empty/whitespace set name,
    /// an empty/whitespace measurement, an empty/whitespace source note, a non-finite mean, or an SD that is not
    /// finite and positive (`None` — no SD at all — is allowed). Every refusal leaves the table unchanged.
    pub fn save_user_norm(&mut self, n: &UserNorm) -> anyhow::Result<()> {
        ensure!(!n.set_name.trim().is_empty(), "the set name can’t be empty");
        ensure!(!n.measurement.trim().is_empty(), "the measurement can’t be empty");
        ensure!(!n.source_note.trim().is_empty(), "the source note can’t be empty: say where this norm came from");
        ensure!(n.mean.is_finite(), "the mean must be a number, not {:?}", n.mean);
        if let Some(sd) = n.sd { ensure!(sd.is_finite() && sd > 0.0, "the SD must be greater than zero, not {sd:?}"); }
        self.conn.execute(&format!(
            "INSERT INTO user_norms (set_name, measurement, mean, sd, source_note, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, {NOW}, {NOW})
             ON CONFLICT (set_name, measurement) DO UPDATE SET mean = excluded.mean, sd = excluded.sd, source_note = excluded.source_note, updated_at = excluded.updated_at"),
            params![n.set_name, n.measurement, n.mean, n.sd, n.source_note])?;
        Ok(())
    }
    /// Removes one clinician-entered norm; removing one that doesn't exist is not an error.
    pub fn delete_user_norm(&mut self, set_name: &str, measurement: &str) -> anyhow::Result<()> {
        self.conn.execute("DELETE FROM user_norms WHERE set_name = ?1 AND measurement = ?2", params![set_name, measurement])?;
        Ok(())
    }

    /// The clinic default reference population (Settings key `default_population`; N6); `None` = not set.
    pub fn default_population(&self) -> anyhow::Result<Option<String>> { self.setting("default_population") }
    /// `None` or a blank string clears the clinic default back to not set (fix round 1, Minor 3: a blank is the
    /// same as not set, not a stray literal string in the settings table).
    pub fn set_default_population(&mut self, population: Option<&str>) -> anyhow::Result<()> {
        match population.map(str::trim).filter(|s| !s.is_empty()) {
            Some(p) => self.set_setting("default_population", p),
            None => { self.conn.execute("DELETE FROM settings WHERE key = 'default_population'", [])?; Ok(()) }
        }
    }

    /// A freshly imported film's label (spec Part 1). Fills what was read: name and date of birth pick the patient (a name
    /// not read keeps the current one), the scan date becomes the film date, the label's ID is kept. Malformed dates are
    /// ignored. The case is then checked: with no issues it is filled silently, otherwise "Check patient details" asks.
    pub fn apply_label(&mut self, case_id: &str, r: &IdentityRead) -> anyhow::Result<IdentityOutcome> {
        let clean = |s: &Option<String>| s.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        let date = |s: &Option<String>| clean(s).filter(|d| iso_date_ok(d));
        let name = clean(&r.name);
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        let (cur_name, cur_dob): (String, Option<String>) = tx.query_row(
            "SELECT p.display_name, p.date_of_birth FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1", [case_id],
            |x| Ok((x.get(0)?, x.get(1)?)))?;
        let dob = date(&r.date_of_birth).or(cur_dob);
        let pid = match name.as_deref().or(Some(cur_name.as_str()).filter(|n| !n.trim().is_empty())) {
            Some(n) => patient_for(&tx, n, dob.as_deref(), false)?,
            None => unnamed_for(&tx, case_id, dob.as_deref())?,
        };
        move_case(&tx, case_id, &pid, crate::library_ids::Move::Label)?;
        tx.execute(&format!("UPDATE cases SET taken_on = COALESCE(?2, taken_on), taken_on_source = CASE WHEN ?2 IS NULL THEN taken_on_source ELSE 'label' END,
                              scan_id = COALESCE(?3, scan_id), identity_source = ?4,
                              identity_checked = 0, updated_at = {NOW} WHERE id = ?1"),
            params![case_id, date(&r.scan_date), clean(&r.scan_id), if name.is_some() { "film" } else { "manual" }])?;
        renumber_by_date(&tx, &pid)?;
        let issues = identity::issues_in(&tx, case_id)?;
        let checked = issues.is_empty();
        tx.execute("UPDATE cases SET identity_checked = ?2 WHERE id = ?1", params![case_id, checked])?;
        tx.commit()?;
        Ok(IdentityOutcome { checked, issues })
    }

    /// apply_label with the machine's learned defaults (spec 2026-09-29 Part 3 fill table). Fields filled only from a
    /// learned default are recorded in `learned_fields` and shown as "Learned for this machine" until confirmed or edited.
    pub fn apply_label_with(&mut self, case_id: &str, label: &IdentityRead, learned: &IdentityRead) -> anyhow::Result<LabelApplied> {
        let (merged, learned_fields, conflicts) = identity::merge_reads(label, learned);
        let outcome = self.apply_label(case_id, &merged)?;
        // Task 9 sweep (carried from Task 3's review): `merge_reads` only ever names the four identity fields
        // ("name", "dob", "scan_date", "scan_id"), so writing its list here must REPLACE just those names in the
        // stored column, not the whole column — a second label read on an unchanged film used to wipe out the new
        // details' own "Learned for this machine" marks (patient_id, xray_type, xray_size, practice) that an earlier
        // read, or `apply_learned_details` run right after this call, had set. The value those marks describe is
        // never touched here either way.
        const IDENTITY_FIELDS: [&str; 4] = ["name", "dob", "scan_date", "scan_id"];
        let cur: String = self.conn.query_row("SELECT learned_fields FROM cases WHERE id = ?1", [case_id], |r| r.get(0))?;
        let mut all: Vec<String> = cur.split(',').filter(|f| !f.is_empty() && !IDENTITY_FIELDS.contains(f)).map(String::from).collect();
        all.extend(learned_fields.iter().cloned());
        self.conn.execute("UPDATE cases SET learned_fields = ?2 WHERE id = ?1", params![case_id, all.join(",")])?;
        Ok(LabelApplied { outcome, learned_fields, conflicts })
    }

    /// "Check patient details" answered. `same_as` ("Same patient (use existing)") moves the case to that patient;
    /// None ("Different patient", or OK on "Read from the film") keeps it. Either way a person has now checked the details.
    pub fn confirm_identity(&mut self, case_id: &str, same_as: Option<&PatientRef>) -> anyhow::Result<()> {
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        if same_as.is_none() {
            let name: String = tx.query_row("SELECT p.display_name FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1", [case_id], |r| r.get(0))?;
            ensure!(!name.trim().is_empty(), "type the patient’s name first");
        }
        if let Some(p) = same_as {
            let pid: Option<String> = tx.query_row("SELECT id FROM patients WHERE name_key = ?1 AND date_of_birth IS ?2 ORDER BY created_at LIMIT 1",
                params![name_key(&p.name), p.date_of_birth], |r| r.get(0)).optional()?;
            let pid = pid.ok_or_else(|| anyhow!("{} is no longer in the library", p.name))?;
            let dob: Option<String> = tx.query_row("SELECT p.date_of_birth FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1",
                [case_id], |r| r.get(0))?;
            move_case(&tx, case_id, &pid, crate::library_ids::Move::SamePatient)?;   // the film's own Patient ID moves with it (addendum D2, Q8)
            // A patient recorded without a date of birth (e.g. from Week 3) takes the one this film carried, unless another
            // patient already holds that name and date of birth.
            if let Some(dob) = dob {
                let key = name_key(&p.name);
                let taken: i64 = tx.query_row("SELECT COUNT(*) FROM patients WHERE name_key = ?1 AND date_of_birth = ?2", params![key, dob], |r| r.get(0))?;
                if taken == 0 { tx.execute("UPDATE patients SET date_of_birth = ?2 WHERE id = ?1 AND date_of_birth IS NULL", params![pid, dob])?; }
            }
        }
        tx.execute(&format!("UPDATE cases SET identity_checked = 1, identity_source = 'manual', learned_fields = '', updated_at = {NOW} WHERE id = ?1"), [case_id])?;
        tx.commit()?;
        Ok(())
    }

    /// The open case and the same patient's other live cases (same name key; same date of birth, or either blank).
    /// An unnamed patient ("~" key) never matches another, so its series is the case alone.
    pub fn series(&self, case_id: &str) -> anyhow::Result<Vec<SeriesFilm>> {
        let (key, dob): (String, Option<String>) = self.conn.query_row(
            "SELECT p.name_key, p.date_of_birth FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1 AND c.deleted_at IS NULL",
            [case_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?.ok_or_else(|| anyhow!("no live case {case_id} in the library"))?;
        let rows = self.conn.prepare(
            "SELECT c.id, c.timepoint, c.taken_on, c.taken_on_source, c.created_at, c.stage, c.in_series,
                    c.id != ?1 AND (p.date_of_birth IS NULL OR ?3 IS NULL)
             FROM cases c JOIN patients p ON p.id = c.patient_id
             WHERE c.deleted_at IS NULL AND (c.id = ?1 OR (substr(?2, 1, 1) != '~' AND p.name_key = ?2
                   AND (p.date_of_birth IS ?3 OR p.date_of_birth IS NULL OR ?3 IS NULL)))")?
            .query_map(params![case_id, key, dob], |r| Ok(SeriesFilm { id: r.get(0)?, timepoint: r.get(1)?, taken_on: r.get(2)?,
                taken_on_source: r.get(3)?, created_at: r.get(4)?, stage: r.get(5)?, in_series: r.get::<_, i64>(6)? == 1,
                name_only: r.get::<_, i64>(7)? == 1 }))?
            .collect::<Result<_, _>>()?;
        Ok(rows)
    }
    /// A film's stage (None = Auto). A display choice: never clears "Tracing verified".
    pub fn set_stage(&mut self, case_id: &str, stage: Option<&str>) -> anyhow::Result<()> {
        if let Some(s) = stage { ensure!(STAGES.contains(&s), "unknown stage {s:?}"); }
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute("UPDATE cases SET stage = ?2 WHERE id = ?1", params![case_id, stage])?;
        tx.commit()?;
        Ok(())
    }
    /// Whether a film is drawn in its patient's comparison. A display choice: never clears "Tracing verified".
    pub fn set_in_series(&mut self, case_id: &str, on: bool) -> anyhow::Result<()> {
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute("UPDATE cases SET in_series = ?2 WHERE id = ?1", params![case_id, on])?;
        tx.commit()?;
        Ok(())
    }

    /// OK on "From the image file" / "Import date": the clinician accepts the film date as it is.
    pub fn confirm_film_date(&mut self, case_id: &str) -> anyhow::Result<()> {
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        tx.execute(&format!("UPDATE cases SET taken_on_source = 'manual', updated_at = {NOW} WHERE id = ?1 AND taken_on IS NOT NULL"), [case_id])?;
        tx.commit()?;
        Ok(())
    }

    /// Today's date on this Mac (local time zone), ISO.
    pub fn today_local(&self) -> anyhow::Result<String> { Ok(self.conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?) }

    pub fn set_verified(&mut self, case_id: &str, verified: bool, operator: &str) -> anyhow::Result<()> {
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        if verified {
            let open: i64 = tx.query_row("SELECT COUNT(*) FROM landmarks WHERE case_id = ?1 AND verified = 0", [case_id], |r| r.get(0))?;
            ensure!(open == 0, "{open} landmark(s) are still unverified");
            tx.execute(&format!("UPDATE cases SET verified_at = {NOW}, verified_by = ?2 WHERE id = ?1"), params![case_id, operator])?;
        } else {
            tx.execute("UPDATE cases SET verified_at = NULL, verified_by = NULL WHERE id = ?1", [case_id])?;
        }
        tx.commit()?;
        Ok(())
    }

    /// Live cases (or, with `deleted`, the Recently deleted ones), most recently changed first.
    pub fn list(&self, deleted: bool) -> anyhow::Result<Vec<CaseSummary>> {
        // Search fields (addendum D2, LIBID-1/LIBID-2): built once, not once per row.
        let former = crate::library_ids::former_numbers(&self.conn)?;
        let mut st = self.conn.prepare(
            "SELECT c.id, p.display_name, c.timepoint, c.taken_on, c.created_at, c.updated_at, c.image_sha256,
                    (SELECT COUNT(*) FROM landmarks l WHERE l.case_id = c.id),
                    (SELECT COUNT(*) FROM landmarks l WHERE l.case_id = c.id AND l.verified = 0),
                    c.verified_at, c.deleted_at, c.orientation, p.date_of_birth, p.name_key, c.identity_checked,
                    p.library_no, c.printed_patient_id
             FROM cases c JOIN patients p ON p.id = c.patient_id
             WHERE (c.deleted_at IS NOT NULL) = ?1 ORDER BY c.updated_at DESC, c.created_at DESC")?;
        let rows = st.query_map([deleted], |r| {
            let sha: String = r.get(6)?;
            let lib_no: Option<i64> = r.get(15)?;
            Ok(CaseSummary { id: r.get(0)?, patient_name: r.get(1)?, timepoint: r.get(2)?, taken_on: r.get(3)?, created_at: r.get(4)?, updated_at: r.get(5)?,
                thumb_path: self.thumb_path(&sha).display().to_string(), landmarks: r.get(7)?, unverified: r.get(8)?, verified_at: r.get(9)?, deleted_at: r.get(10)?,
                orientation: serde_json::from_str(&r.get::<_, String>(11)?).unwrap_or(serde_json::Value::Null),
                date_of_birth: r.get(12)?, patient_key: r.get(13)?, identity_checked: r.get::<_, i64>(14)? == 1,
                library_id: lib_no.map(crate::library_ids::library_id_text),
                former_library_ids: lib_no.and_then(|n| former.get(&n).cloned()).unwrap_or_default()
                    .into_iter().map(crate::library_ids::library_id_text).collect(),
                printed_patient_id: r.get(16)? })
        })?;
        Ok(rows.collect::<Result<_, _>>()?)
    }

    /// Soft delete: the case moves to Recently deleted and can be restored for KEEP_DELETED_DAYS.
    pub fn delete(&mut self, case_id: &str) -> anyhow::Result<()> {
        let n = self.conn.execute(&format!("UPDATE cases SET deleted_at = {NOW} WHERE id = ?1 AND deleted_at IS NULL"), [case_id])?;
        ensure!(n == 1, "no live case {case_id}");
        Ok(())
    }
    pub fn restore(&mut self, case_id: &str) -> anyhow::Result<()> {
        let n = self.conn.execute("UPDATE cases SET deleted_at = NULL WHERE id = ?1 AND deleted_at IS NOT NULL", [case_id])?;
        ensure!(n == 1, "case {case_id} is not in Recently deleted");
        Ok(())
    }

    /// Removes cases deleted more than `days` ago, then any patient, image row and file nothing refers to.
    pub fn purge_deleted(&mut self, days: i64) -> anyhow::Result<usize> {
        let tx = self.conn.transaction()?;
        let n = tx.execute("DELETE FROM cases WHERE deleted_at IS NOT NULL AND deleted_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?1)", [format!("{} days", -days)])?;
        tx.execute("DELETE FROM patients WHERE id NOT IN (SELECT patient_id FROM cases)", [])?;
        let orphans: Vec<(String, String)> = tx.prepare("SELECT sha256, ext FROM images WHERE sha256 NOT IN (SELECT image_sha256 FROM cases)")?
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
        tx.execute("DELETE FROM images WHERE sha256 NOT IN (SELECT image_sha256 FROM cases)", [])?;
        tx.commit()?;
        for (sha, ext) in orphans { fs::remove_file(self.image_path(&sha, &ext)).ok(); fs::remove_file(self.thumb_path(&sha)).ok(); }
        Ok(n)
    }

    pub fn setting(&self, key: &str) -> anyhow::Result<Option<String>> {
        Ok(self.conn.query_row("SELECT value FROM settings WHERE key = ?1", [key], |r| r.get(0)).optional()?)
    }
    pub fn set_setting(&mut self, key: &str, value: &str) -> anyhow::Result<()> {
        self.conn.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", params![key, value])?;
        Ok(())
    }

    /// The people who trace on this Mac, in the order they were added. An empty list starts with `seed` (today's
    /// operator name), so nothing changes until a second name is added.
    pub fn operators(&mut self, seed: &str) -> anyhow::Result<Vec<String>> {
        let n: i64 = self.conn.query_row("SELECT COUNT(*) FROM operators", [], |r| r.get(0))?;
        if n == 0 && !seed.trim().is_empty() { self.add_operator(seed)?; }
        Ok(self.conn.prepare("SELECT name FROM operators ORDER BY rowid")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?)
    }
    pub fn add_operator(&mut self, name: &str) -> anyhow::Result<String> {
        let n = name.trim();
        ensure!(!n.is_empty(), "type a name");
        ensure!(n.chars().count() <= 60, "a name can be at most 60 characters");
        self.conn.execute(&format!("INSERT OR IGNORE INTO operators (name, created_at) VALUES (?1, {NOW})"), [n])?;
        Ok(n.to_string())
    }

    /// Who accepted which model licence, and when (spec 2026-10-01 Part 1).
    pub fn accept_licence(&mut self, model_id: &str, version: &str, by: &str) -> anyhow::Result<()> {
        self.conn.execute(&format!("INSERT OR REPLACE INTO model_licences (model_id, licence_version, accepted_by, accepted_at) VALUES (?1, ?2, ?3, {NOW})"),
            params![model_id, version, by])?;
        Ok(())
    }
    pub fn licence_accepted(&self, model_id: &str, version: &str) -> anyhow::Result<bool> {
        Ok(self.conn.query_row("SELECT COUNT(*) FROM model_licences WHERE model_id = ?1 AND licence_version = ?2",
            params![model_id, version], |r| r.get::<_, i64>(0))? > 0)
    }

    /// File ▸ Back up library…: a consistent snapshot (SQLite online backup) plus every image, in a new folder
    /// inside `dest`. Returns that folder.
    pub fn backup(&self, dest: &Path) -> anyhow::Result<PathBuf> {
        let dir = dest.join(format!("OpenCephAI backup {}", stamp(&self.conn)?));
        ensure!(!dir.exists(), "{} already exists", dir.display());
        snapshot(&self.conn, &self.root, &dir)?;
        verify_backup(&dir)?;
        Ok(dir)
    }

    /// Replaces the library in `root` with a verified backup. The caller must have dropped any open `Library` for `root`.
    /// Everything is copied into a staging folder and checked first; only then is the live database swapped, and any
    /// failure puts it back, so a failed restore never leaves an empty or half-restored library (review #5). The replaced
    /// database is kept in `root/replaced-<id>/`. A backup must be outside the library, except a safety copy directly in
    /// `root/upgrade-backups/` (AUTOBACKUP-1), which is read and never changed. If opening the restored library is
    /// refused (e.g. its upgrade copy can't be made), the replaced database is put back before returning (AB-5).
    /// The Library ID counter is carried over (rule 5): the restored library never issues a number the replaced one had
    /// already given out, and a backup from before format 11 has its patients numbered above all of them (so a patient
    /// restored from it carries a different number from the one on reports made since the upgrade; the old number leads
    /// nowhere). Numbers the backup does not know are kept as "belonged to a patient no longer in the library".
    /// Known limit: a format-11 backup from a DIFFERENT library keeps its own numbers, which may equal numbers this one
    /// gave other patients.
    pub fn restore_backup(root: &Path, backup: &Path) -> anyhow::Result<Library> {
        let live = root.canonicalize().unwrap_or_else(|_| root.to_path_buf());
        let from = backup.canonicalize().with_context(|| format!("{} is not a usable OpenCephAI backup", backup.display()))?;
        let upgrade_copy = from.parent() == Some(live.join(UPGRADE_BACKUPS_DIR).as_path());
        ensure!(!from.starts_with(&live) || upgrade_copy,
            "choose a backup folder outside the library itself, or a safety copy directly in its {UPGRADE_BACKUPS_DIR} folder");
        if upgrade_copy {
            let c = check_db(&from.join("library.sqlite3")).with_context(|| format!("{} is not a usable OpenCephAI backup", from.display()))?;
            images_after_restore(&c, &from, &live)?;
        } else { verify_backup(&from)?; }
        fs::create_dir_all(root.join("images"))?;
        let id = uuid::Uuid::new_v4();
        let stage = root.join(format!("restore-{id}"));
        let staged = (|| -> anyhow::Result<()> {
            fs::create_dir_all(stage.join("images"))?;
            fs::copy(from.join("library.sqlite3"), stage.join("library.sqlite3"))?;
            for f in fs::read_dir(from.join("images"))? {
                let f = f?.path(); let name = f.file_name().expect("a file name");
                if !root.join("images").join(name).exists() { fs::copy(&f, stage.join("images").join(name))?; }
            }
            check_db(&stage.join("library.sqlite3"))?;
            Ok(())
        })();
        if let Err(e) = staged { fs::remove_dir_all(&stage).ok(); return Err(e.context("the restore failed and the library was not changed")); }
        let issued_before = live_counter(&root.join("library.sqlite3"));

        let keep = root.join(format!("replaced-{id}"));
        fs::create_dir_all(&keep)?;
        let mut aside = Vec::new();
        let swapped = (|| -> anyhow::Result<()> {
            for suffix in ["", "-wal", "-shm"] {
                let f = root.join(format!("library.sqlite3{suffix}"));
                if f.exists() { let to = keep.join(f.file_name().expect("a file name")); fs::rename(&f, &to)?; aside.push((to, f)); }
            }
            fs::rename(stage.join("library.sqlite3"), root.join("library.sqlite3"))?;
            for f in fs::read_dir(stage.join("images"))? { let f = f?.path(); fs::rename(&f, root.join("images").join(f.file_name().expect("a file name")))?; }
            Ok(())
        })();
        let put_back = |aside: &[(PathBuf, PathBuf)]| {
            for suffix in ["", "-wal", "-shm"] { fs::remove_file(root.join(format!("library.sqlite3{suffix}"))).ok(); }
            for (moved, original) in aside.iter().rev() { fs::rename(moved, original).ok(); }
            fs::remove_dir_all(&stage).ok();
            if fs::read_dir(&keep).map(|mut d| d.next().is_none()).unwrap_or(false) { fs::remove_dir(&keep).ok(); }
        };
        if let Err(e) = swapped { put_back(&aside); return Err(e.context("the restore failed and the library was put back as it was")); }
        fs::remove_dir_all(&stage).ok();
        forget_upgrade_copy(&live);                                          // a different database: it needs its own copy
        // Rule 5: a backup from before format 11 is numbered above the replaced library's counter as it upgrades (review
        // I1, ruling A); a format-11 backup keeps its own numbers and its counter is raised. Either way every number the
        // replaced library issued is known afterwards and held by nobody the backup did not hold it for (review I2).
        match open_with_above(root, schema::CURRENT, &check_copy, issued_before)
            .and_then(|lib| { crate::library_ids::raise_counter(&lib.conn, issued_before)?; Ok(lib) }) {
            Ok(lib) => Ok(lib),
            // M3: the notes were about the restored database; the database put back gets its own judgement.
            Err(e) => { put_back(&aside); forget_upgrade_copy(&live); Err(e.context("the restore was undone and the library put back as it was")) }
        }
    }
}

/// The live library's Library ID counter, read before a restore replaces it (ruling 3a). Opened read-only, so a missing
/// database is not created; no database, no tables or no number issued yet all count as 0. A database that cannot be
/// read also counts as 0 (logged): restoring is how a damaged library is mended, so a damaged one must not block it.
fn live_counter(db: &Path) -> i64 {
    if !db.exists() { return 0; }
    Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)
        .and_then(|c| crate::library_ids::last_issued(&c))
        .unwrap_or_else(|e| { eprintln!("restore: the replaced library's Library ID counter could not be read ({e}); counting on from the backup's"); 0 })
}

/// `Library::open`, upgrading to schema `target` and checking the safety copy with `check`. Production passes
/// `schema::CURRENT` and `check_copy`; tests pass an older target or a checker that fails.
/// An existing library (stored schema 1..target-1) is first copied, as File ▸ Back up library… would, into
/// `<root>/upgrade-backups/OpenCephAI backup before upgrade <v>→<target> <stamp>`, and the copy checked as a restore
/// checks a backup; only then does any migration run. If either fails the library is not migrated or opened and the
/// error is `UPGRADE_COPY_FAILED` (the cause goes to the log). A new library (schema 0) or a current one makes no copy.
/// Checks a safety copy: (copy folder, the schema it must be at, the live library folder).
pub(crate) type CopyCheck<'a> = dyn Fn(&Path, i64, &Path) -> anyhow::Result<()> + 'a;

pub(crate) fn open_with(root: &Path, target: i64, check: &CopyCheck<'_>) -> anyhow::Result<Library> { open_with_above(root, target, check, 0) }

/// `open_with`, numbering patients above `floor` if this open upgrades the library to format 11 (`schema::migrate_to_above`).
fn open_with_above(root: &Path, target: i64, check: &CopyCheck<'_>, floor: i64) -> anyhow::Result<Library> {
    fs::create_dir_all(root.join("images"))?;
    fs::create_dir_all(root.join("thumbs"))?;
    let mut conn = Connection::open(root.join("library.sqlite3")).with_context(|| format!("could not open the library in {}", root.display()))?;
    conn.pragma_update_and_check(None, "journal_mode", "WAL", |r| r.get::<_, String>(0))?;
    conn.pragma_update(None, "foreign_keys", "ON")?;
    conn.pragma_update(None, "synchronous", "FULL")?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let v = schema::version(&conn)?;
    // Addendum D2 (L7 A; owner ruling JOIN-HISTORY): either withdrawn format 11's shape is refused before any copy or
    // migration; nothing is changed.
    schema::check_shape(&conn)?;
    let key = root.canonicalize()?;
    let upgrade_copy = if v > 0 && v < target {
        // AB-1: an upgrade that failed after its copy was made is retried against that same copy, not a new one each time.
        // Final review M1: a copy that could not be made is not attempted again this run (each attempt copies every film,
        // and the screen asks many times); quitting and reopening the app tries again.
        if FAILED_THIS_RUN.lock().ok().is_some_and(|f| f.as_ref().is_some_and(|f| f.contains(&key))) {
            eprintln!("library upgrade {v}→{target} refused earlier this run; not copied again until the app is reopened");
            anyhow::bail!(UPGRADE_COPY_FAILED)
        }
        let earlier = MADE_THIS_RUN.lock().ok().and_then(|m| m.as_ref()?.get(&key).cloned()).filter(|d| d.is_dir());
        match earlier.map(Ok).unwrap_or_else(|| copy_before_upgrade(&conn, root, v, target, check)) {
            Ok(dir) => { if let Ok(mut m) = MADE_THIS_RUN.lock() { m.get_or_insert_with(HashMap::new).insert(key.clone(), dir.clone()); } Some(dir) }
            Err(e) => {
                if let Ok(mut f) = FAILED_THIS_RUN.lock() { f.get_or_insert_with(std::collections::HashSet::new).insert(key.clone()); }
                eprintln!("library upgrade {v}→{target} refused, no safety copy: {e:#}"); anyhow::bail!(UPGRADE_COPY_FAILED)
            }
        }
    } else { None };
    schema::migrate_to_above(&mut conn, target, floor)?;
    forget_upgrade_copy(&key);
    if let Some(dir) = &upgrade_copy { eprintln!("library upgraded {v}→{target}; the copy from before is in {}", dir.display()); }
    let mut lib = Library { conn, root: root.to_path_buf(), upgrade_copy };
    lib.purge_deleted(KEEP_DELETED_DAYS)?;
    Ok(lib)
}

/// Per running app: the safety copy made for a library (canonical folder) whose upgrade has not yet succeeded (AB-1).
static MADE_THIS_RUN: std::sync::Mutex<Option<HashMap<PathBuf, PathBuf>>> = std::sync::Mutex::new(None);
/// Per running app: libraries (canonical folder) whose safety copy could not be made this run (final review M1).
static FAILED_THIS_RUN: std::sync::Mutex<Option<std::collections::HashSet<PathBuf>>> = std::sync::Mutex::new(None);
/// Forgets both notes for a library: after a successful upgrade, and whenever restore changes or puts back its database.
fn forget_upgrade_copy(root: &Path) {
    if let Ok(mut m) = MADE_THIS_RUN.lock() { if let Some(m) = m.as_mut() { m.remove(root); } }
    if let Ok(mut f) = FAILED_THIS_RUN.lock() { if let Some(f) = f.as_mut() { f.remove(root); } }
}

/// The safety copy for `open_with`: built in a new `… .incomplete` folder (never an existing one), filled, checked,
/// and only then renamed to its real name, so a crash mid-copy can't leave a folder that looks finished (Minor 2).
/// A folder this call created but could not fill or check is removed, so a failed attempt (e.g. a full disk) leaves
/// nothing behind.
fn copy_before_upgrade(conn: &Connection, root: &Path, v: i64, target: i64, check: &CopyCheck<'_>) -> anyhow::Result<PathBuf> {
    let base = root.join(UPGRADE_BACKUPS_DIR).join(format!("OpenCephAI backup before upgrade {v}→{target} {}", stamp(conn)?));
    let unfinished = |d: &Path| PathBuf::from(format!("{}.incomplete", d.display()));
    let dir = (1..).map(|n| if n == 1 { base.clone() } else { PathBuf::from(format!("{} ({n})", base.display())) })
        .find(|d| !d.exists() && !unfinished(d).exists()).expect("an unused name");
    let building = unfinished(&dir);
    fs::create_dir_all(dir.parent().expect("inside upgrade-backups"))?;
    fs::create_dir(&building)?;
    let made = snapshot(conn, root, &building).and_then(|()| check(&building, v, root)).and_then(|()| Ok(fs::rename(&building, &dir)?));
    if let Err(e) = made { fs::remove_dir_all(&building).ok(); return Err(e); }
    Ok(dir)
}

/// The check on an upgrade's safety copy (AB-3): its database passes `check_db` (restore's check), it is at the schema
/// `v` it was taken at, and it holds every film its database names, except a film the live library had already lost
/// (listed in the log), so a library missing a film is never locked out while a damaged copy is refused.
fn check_copy(dir: &Path, v: i64, live: &Path) -> anyhow::Result<()> {
    let c = check_db(&dir.join("library.sqlite3"))?;
    let at = schema::version(&c)?;
    ensure!(at == v, "the copy is at schema {at}, not {v}");
    images_present(&c, dir, live)
}

/// Every film the database `c` (in folder `dir`) names is in `dir/images`, except one also missing from the live
/// library's images; those are logged. The upgrade copy's check; restore uses `images_after_restore`.
fn images_present(c: &Connection, dir: &Path, live: &Path) -> anyhow::Result<()> {
    let names: Vec<String> = c.prepare("SELECT sha256 || '.' || ext FROM images")?.query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    let (lost_before, missing): (Vec<String>, Vec<String>) = names.into_iter().filter(|f| !dir.join("images").join(f).exists())
        .partition(|f| !live.join("images").join(f).exists());
    if !lost_before.is_empty() { eprintln!("{} film file(s) were already missing from the library, e.g. {}", lost_before.len(), lost_before[0]); }
    ensure!(missing.is_empty(), "backup is missing {} image file(s), e.g. {}", missing.len(), missing[0]);
    Ok(())
}

/// The restore of an upgrade copy (final review I1). Restore never removes a film from the live `images/` folder, so a
/// film the copy's database `c` names is there afterwards if it is in the copy OR already in the live folder. A film in
/// neither is accepted only if the live library is already missing it now (its database names it too), so the restore
/// makes nothing worse; otherwise the restored library would lack a film the live one does not, and it is refused.
fn images_after_restore(c: &Connection, dir: &Path, live: &Path) -> anyhow::Result<()> {
    let names = |c: &Connection| -> anyhow::Result<Vec<String>> {
        Ok(c.prepare("SELECT sha256 || '.' || ext FROM images")?.query_map([], |r| r.get::<_, String>(0))?.collect::<Result<Vec<_>, _>>()?)
    };
    let absent: Vec<String> = names(c)?.into_iter()
        .filter(|f| !dir.join("images").join(f).exists() && !live.join("images").join(f).exists()).collect();
    if absent.is_empty() { return Ok(()); }
    let live_names: std::collections::HashSet<String> = check_db(&live.join("library.sqlite3")).ok()
        .and_then(|l| names(&l).ok()).unwrap_or_default().into_iter().collect();
    let (lost_before, missing): (Vec<String>, Vec<String>) = absent.into_iter().partition(|f| live_names.contains(f));
    if !lost_before.is_empty() { eprintln!("{} film file(s) are already missing from the library, e.g. {}", lost_before.len(), lost_before[0]); }
    ensure!(missing.is_empty(), "backup is missing {} image file(s), e.g. {}", missing.len(), missing[0]);
    Ok(())
}

/// Local time for a backup folder's name, from SQLite's clock like every other timestamp.
fn stamp(conn: &Connection) -> anyhow::Result<String> {
    Ok(conn.query_row("SELECT strftime('%Y-%m-%d %H-%M-%S', 'now', 'localtime')", [], |r| r.get(0))?)
}

/// A consistent snapshot of the database (SQLite online backup) plus every image, into `dir`.
fn snapshot(conn: &Connection, root: &Path, dir: &Path) -> anyhow::Result<()> {
    fs::create_dir_all(dir.join("images"))?;
    conn.backup(rusqlite::MAIN_DB, dir.join("library.sqlite3"), None)?;
    for f in fs::read_dir(root.join("images"))? {
        let f = f?.path();
        if f.extension().is_some_and(|e| IMAGE_EXTENSIONS.contains(&e.to_string_lossy().as_ref())) { fs::copy(&f, dir.join("images").join(f.file_name().unwrap()))?; }
    }
    Ok(())
}

/// A backup is usable if SQLite's integrity check passes, its schema is one this app can read, and every image it
/// refers to is present.
pub fn verify_backup(dir: &Path) -> anyhow::Result<()> {
    let c = check_db(&dir.join("library.sqlite3")).with_context(|| format!("{} is not a usable OpenCephAI backup", dir.display()))?;
    let missing: Vec<String> = c.prepare("SELECT sha256 || '.' || ext FROM images")?.query_map([], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?.into_iter().filter(|f| !dir.join("images").join(f).exists()).collect();
    ensure!(missing.is_empty(), "backup is missing {} image file(s), e.g. {}", missing.len(), missing[0]);
    Ok(())
}

/// A library database this app can read: SQLite's integrity check passes and its schema is 1..=CURRENT.
fn check_db(path: &Path) -> anyhow::Result<Connection> {
    let c = Connection::open_with_flags(path, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY)?;
    let ok: String = c.query_row("PRAGMA integrity_check", [], |r| r.get(0))?;
    ensure!(ok == "ok", "integrity check failed: {ok}");
    let v = schema::version(&c)?;
    ensure!((1..=schema::CURRENT).contains(&v), "schema {v}; this app reads 1–{}", schema::CURRENT);
    Ok(c)
}

/// AUTOBACKUP-1: before an existing library's format is upgraded, a full copy is made next to it and checked; no copy,
/// no upgrade. Synthetic libraries only, built by running the shipped migrations up to an older schema.
#[cfg(test)]
mod upgrade_copy_tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    /// A library folder whose database stands at schema `v`, holding two settings rows (no migration touches them).
    fn old_library(root: &Path, v: i64) {
        fs::create_dir_all(root.join("images")).unwrap();
        let c = Connection::open(root.join("library.sqlite3")).unwrap();
        for (i, sql) in schema::MIGRATIONS.iter().take(v as usize).enumerate() {
            c.execute_batch(sql).unwrap();
            c.pragma_update(None, "user_version", i as i64 + 1).unwrap();
        }
        if v >= 1 { c.execute_batch("INSERT INTO settings (key, value) VALUES ('a', 'one'), ('b', 'two');").unwrap(); }
    }
    fn settings(db: &Path) -> Vec<(String, String)> {
        let c = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        let mut q = c.prepare("SELECT key, value FROM settings ORDER BY key").unwrap();
        let rows = q.query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
        rows
    }
    fn stored_version(db: &Path) -> i64 {
        schema::version(&Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap()).unwrap()
    }
    fn copies(root: &Path) -> Vec<PathBuf> {
        let Ok(d) = fs::read_dir(root.join(UPGRADE_BACKUPS_DIR)) else { return vec![] };
        let mut v: Vec<PathBuf> = d.map(|e| e.unwrap().path()).collect(); v.sort(); v
    }
    fn db(root: &Path) -> PathBuf { root.join("library.sqlite3") }
    fn rows() -> Vec<(String, String)> { vec![("a".into(), "one".into()), ("b".into(), "two".into())] }

    #[test] fn an_old_library_is_copied_and_checked_then_upgraded_and_the_copy_stays_at_the_old_version() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        fs::write(t.path().join("images").join("abc.png"), b"film bytes").unwrap();
        let lib = Library::open(t.path()).unwrap();
        assert_eq!(schema::version(&lib.conn).unwrap(), schema::CURRENT);
        let made = copies(t.path());
        assert_eq!(made.len(), 1, "one safety copy: {made:?}");
        let name = made[0].file_name().unwrap().to_string_lossy().into_owned();
        assert!(name.starts_with(&format!("OpenCephAI backup before upgrade 7→{} ", schema::CURRENT)), "{name}");
        assert_eq!(lib.upgrade_copy(), Some(made[0].as_path()));
        verify_backup(&made[0]).unwrap();
        assert_eq!(stored_version(&db(&made[0])), 7);
        assert_eq!(settings(&db(&made[0])), rows());
        assert_eq!(fs::read(made[0].join("images").join("abc.png")).unwrap(), b"film bytes");
        drop(lib);
        assert_eq!(settings(&db(t.path())), rows());
    }

    #[test] fn when_the_copy_cannot_be_written_nothing_is_upgraded_and_the_message_is_exact() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        let dest = t.path().join(UPGRADE_BACKUPS_DIR);
        fs::create_dir_all(&dest).unwrap();
        fs::set_permissions(&dest, fs::Permissions::from_mode(0o555)).unwrap();   // unwritable, like a full or locked disk
        let r = Library::open(t.path());
        fs::set_permissions(&dest, fs::Permissions::from_mode(0o755)).unwrap();
        let e = r.err().expect("the library must not open");
        assert_eq!(format!("{e:#}"), UPGRADE_COPY_FAILED);
        assert_eq!(UPGRADE_COPY_FAILED, "Couldn't make a safety copy before upgrading. Your library hasn't been changed.");
        assert_eq!(stored_version(&db(t.path())), 7);
        assert_eq!(settings(&db(t.path())), rows());
        assert!(copies(t.path()).is_empty());
    }

    #[test] fn when_the_copy_fails_its_check_nothing_is_upgraded() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        let checked = std::cell::Cell::new(0);
        let corrupt = |_: &Path, _: i64, _: &Path| -> anyhow::Result<()> { checked.set(checked.get() + 1); anyhow::bail!("integrity check failed: simulated") };
        let e = open_with(t.path(), schema::CURRENT, &corrupt).err().expect("the library must not open");
        assert_eq!(checked.get(), 1, "the checker ran on the copy");
        assert_eq!(format!("{e:#}"), UPGRADE_COPY_FAILED);
        assert_eq!(stored_version(&db(t.path())), 7);
        assert_eq!(settings(&db(t.path())), rows());
        assert!(copies(t.path()).is_empty(), "the checked-and-refused copy is removed: {:?}", copies(t.path()));   // AB-4
    }

    // Final review M1: a copy that cannot be made is not attempted again on every request from the screen in the same
    // run (each attempt is a full copy of every film). One attempt per library per run; quitting and reopening retries.
    #[test] fn a_refused_upgrade_is_not_copied_again_on_every_open() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        let checked = std::cell::Cell::new(0);
        let corrupt = |_: &Path, _: i64, _: &Path| -> anyhow::Result<()> { checked.set(checked.get() + 1); anyhow::bail!("integrity check failed: simulated") };
        for _ in 0..3 {
            let e = open_with(t.path(), schema::CURRENT, &corrupt).err().expect("the library must not open");
            assert_eq!(format!("{e:#}"), UPGRADE_COPY_FAILED);
        }
        println!("M1 copy attempts for 3 opens: {}", checked.get());
        assert_eq!(checked.get(), 1, "one copy attempt per library per run");
        assert_eq!(stored_version(&db(t.path())), 7);
        assert!(copies(t.path()).is_empty());
    }

    // Edge: an empty upgrade-backups folder (e.g. every copy moved away by hand) neither blocks the copy nor restores.
    #[test] fn an_empty_upgrade_backups_folder_is_harmless() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        fs::create_dir_all(t.path().join(UPGRADE_BACKUPS_DIR)).unwrap();
        let refused = Library::restore_backup(t.path(), &t.path().join(UPGRADE_BACKUPS_DIR)).err().map(|e| format!("{e:#}"));
        let lib = Library::open(t.path()).unwrap();
        println!("empty upgrade-backups: restore of the folder itself -> {refused:?}; open made {} copy", copies(t.path()).len());
        assert!(refused.unwrap().contains("outside the library"));
        assert_eq!(copies(t.path()).len(), 1);
        assert_eq!(schema::version(&lib.conn).unwrap(), schema::CURRENT);
    }

    /// The production check is a real one: a copy whose database is not SQLite fails it.
    #[test] fn the_copy_check_rejects_a_corrupt_database() {
        let t = tempfile::tempdir().unwrap();
        fs::write(t.path().join("library.sqlite3"), b"not a database at all, just bytes").unwrap();
        assert!(check_copy(t.path(), 7, t.path()).is_err());
        old_library(&t.path().join("good"), 7);
        check_copy(&t.path().join("good"), 7, &t.path().join("good")).unwrap();
    }

    // Task 11 edge sweep: a new library goes straight from schema 0 to CURRENT (11), makes no safety copy (there is
    // nothing old to copy), and issues no Library ID numbers (there is no named patient to number).
    #[test] fn a_new_library_makes_no_copy() {
        let t = tempfile::tempdir().unwrap();
        let lib = Library::open(t.path()).unwrap();
        assert_eq!(schema::version(&lib.conn).unwrap(), schema::CURRENT);
        assert_eq!(lib.upgrade_copy(), None);
        assert!(copies(t.path()).is_empty());
        let n: i64 = lib.conn.query_row("SELECT COUNT(*) FROM library_numbers", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "a brand-new library issues no Library ID numbers");
    }

    #[test] fn a_current_library_makes_no_copy() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), schema::CURRENT);
        let lib = Library::open(t.path()).unwrap();
        assert_eq!(lib.upgrade_copy(), None);
        assert!(copies(t.path()).is_empty());
        assert_eq!(settings(&db(t.path())), rows());
    }

    #[test] fn two_upgrades_in_a_row_keep_both_copies() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        let first = open_with(t.path(), 8, &check_copy).unwrap();
        assert_eq!(schema::version(&first.conn).unwrap(), 8);
        drop(first);
        let second = open_with(t.path(), 9, &check_copy).unwrap();
        assert_eq!(schema::version(&second.conn).unwrap(), 9);
        let made = copies(t.path());
        assert_eq!(made.len(), 2, "{made:?}");
        let versions: Vec<i64> = made.iter().map(|d| stored_version(&db(d))).collect();
        assert_eq!(versions, vec![7, 8]);
        assert!(made[0].file_name().unwrap().to_string_lossy().contains("7→8"));
        assert!(made[1].file_name().unwrap().to_string_lossy().contains("8→9"));
        for d in &made { verify_backup(d).unwrap(); assert_eq!(settings(&db(d)), rows()); }
    }

    /// `old_library` plus one image row, `abc.png`, with its file in images/ only if `file`.
    fn old_library_with_image(root: &Path, v: i64, file: bool) {
        old_library(root, v);
        let c = Connection::open(db(root)).unwrap();
        c.execute("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x')", []).unwrap();
        c.execute("INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p1', 'Demo Seven', 'demo seven', 'x')", []).unwrap();
        c.execute("INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p1', 'abc', 'T1', 'x', 'x')", []).unwrap();
        if file { fs::write(root.join("images").join("abc.png"), b"film bytes").unwrap(); }
    }
    /// Every file under `dir` with its bytes, to show a folder was not touched.
    fn tree(dir: &Path) -> Vec<(PathBuf, Vec<u8>)> {
        let mut out = vec![];
        for e in fs::read_dir(dir).unwrap() {
            let p = e.unwrap().path();
            if p.is_dir() { out.extend(tree(&p)); } else { out.push((p.clone(), fs::read(&p).unwrap())); }
        }
        out.sort(); out
    }
    fn set(root: &Path, key: &str, value: &str) {
        Connection::open(db(root)).unwrap().execute("UPDATE settings SET value = ?2 WHERE key = ?1", [key, value]).unwrap();
    }

    // AB-1: a migration that fails after a good copy must not make a new full copy on every retry.
    #[test] fn a_failed_upgrade_retried_makes_one_copy() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        Connection::open(db(t.path())).unwrap().execute_batch("ALTER TABLE patients ADD COLUMN gender TEXT;").unwrap();  // migration 8 will fail
        let first = Library::open(t.path()).err().expect("migration 8 fails");
        let second = Library::open(t.path()).err().expect("and fails again");
        assert!(!format!("{first:#}").contains(UPGRADE_COPY_FAILED) && !format!("{second:#}").contains(UPGRADE_COPY_FAILED), "{first:#}");
        assert_eq!(copies(t.path()).len(), 1, "one copy for one failed upgrade: {:?}", copies(t.path()));
        assert_eq!(stored_version(&db(t.path())), 7);
        verify_backup(&copies(t.path())[0]).unwrap();
    }

    // AB-3: the copy must be at the schema it was taken at…
    #[test] fn the_copy_check_refuses_a_copy_at_the_wrong_schema() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        assert!(check_copy(t.path(), 6, t.path()).is_err());
        check_copy(t.path(), 7, t.path()).unwrap();
    }
    // …and hold every image the library has…
    #[test] fn the_copy_check_refuses_a_copy_missing_an_image_the_library_has() {
        let (live, copy) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        old_library_with_image(live.path(), 7, true);
        old_library_with_image(copy.path(), 7, false);
        assert!(check_copy(copy.path(), 7, live.path()).is_err());
        fs::write(copy.path().join("images").join("abc.png"), b"film bytes").unwrap();
        check_copy(copy.path(), 7, live.path()).unwrap();
    }
    // …except one the library had already lost, which must not lock the library out.
    #[test] fn the_copy_check_accepts_an_image_the_library_had_already_lost() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, false);
        let lib = Library::open(t.path()).unwrap();
        assert_eq!(schema::version(&lib.conn).unwrap(), schema::CURRENT);
        assert_eq!(copies(t.path()).len(), 1);
    }

    // AB-4: a copy that fails half-way (here: an unreadable film; on a real Mac, a full disk) leaves no folder behind.
    #[test] fn when_the_copy_cannot_be_filled_the_half_made_folder_is_removed() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, true);
        let film = t.path().join("images").join("abc.png");
        fs::set_permissions(&film, fs::Permissions::from_mode(0o000)).unwrap();
        let r = Library::open(t.path());
        fs::set_permissions(&film, fs::Permissions::from_mode(0o644)).unwrap();
        assert_eq!(format!("{:#}", r.err().expect("the library must not open")), UPGRADE_COPY_FAILED);
        assert!(t.path().join(UPGRADE_BACKUPS_DIR).is_dir(), "the copy got as far as its folder");
        assert!(copies(t.path()).is_empty(), "{:?}", copies(t.path()));
        assert_eq!(stored_version(&db(t.path())), 7);
        assert_eq!(settings(&db(t.path())), rows());
    }

    // Minor 2: a copy is built under a name that says it is unfinished, and only gets its real name once checked.
    #[test] fn a_copy_is_built_as_incomplete_and_named_only_when_checked() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 7);
        let seen = std::cell::RefCell::new(None);
        let spy = |d: &Path, v: i64, live: &Path| { *seen.borrow_mut() = Some(d.to_path_buf()); check_copy(d, v, live) };
        open_with(t.path(), schema::CURRENT, &spy).unwrap();
        let checked = seen.borrow().clone().unwrap();
        assert!(checked.to_string_lossy().ends_with(".incomplete"), "{}", checked.display());
        let made = copies(t.path());
        assert_eq!(made.len(), 1);
        assert!(!made[0].to_string_lossy().contains("incomplete"), "{}", made[0].display());
    }

    // AB-2 (1): an upgrade copy restores where it is, and is not touched by the restore.
    #[test] fn an_upgrade_copy_restores_in_place_and_is_left_as_it_was() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, true);
        drop(Library::open(t.path()).unwrap());
        let c = copies(t.path()).remove(0);
        set(t.path(), "a", "changed after the upgrade");
        let before = tree(&c);
        let lib = Library::restore_backup(t.path(), &c).unwrap();
        assert_eq!(schema::version(&lib.conn).unwrap(), schema::CURRENT);
        drop(lib);
        assert_eq!(settings(&db(t.path())), rows());
        assert_eq!(tree(&c), before, "the copy is byte-identical after the restore");
        verify_backup(&c).unwrap();
        assert_eq!(copies(t.path()).len(), 2, "restoring the old copy upgrades it, so it is copied again first");
    }

    /// Ruling 3a (Task 3): restore reads the live Library ID counter first (rule 5). A live library from before format 11,
    /// an empty database or no database at all counts as 0: the restore neither fails nor creates a database file
    /// (which the swap would then keep as a "replaced" library). A damaged live database does not block its restore.
    #[test] fn a_restore_into_a_pre_11_empty_missing_or_damaged_live_library_does_not_fail() {
        for live in ["pre-11", "empty", "missing", "damaged"] {
            let (t, src, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
            let backup = Library::open(src.path()).unwrap().backup(out.path()).unwrap();
            match live {
                "pre-11" => old_library(t.path(), 10),
                "empty" => { fs::create_dir_all(t.path().join("images")).unwrap(); fs::write(db(t.path()), b"").unwrap(); }
                "damaged" => { fs::create_dir_all(t.path().join("images")).unwrap(); fs::write(db(t.path()), [0x5a_u8; 4096]).unwrap(); }
                _ => {}
            }
            let lib = Library::restore_backup(t.path(), &backup).unwrap_or_else(|e| panic!("{live}: {e:#}"));
            assert_eq!(schema::version(&lib.conn).unwrap(), schema::CURRENT, "{live}");
            let kept: Vec<PathBuf> = fs::read_dir(t.path()).unwrap().map(|e| e.unwrap().path())
                .filter(|p| p.file_name().unwrap().to_string_lossy().starts_with("replaced-") && p.join("library.sqlite3").exists()).collect();
            assert_eq!(kept.len(), usize::from(live != "missing"), "{live}: only a database that was there is kept aside");
        }
    }

    /// A format-10 library folder holding the named patients `(id, name, added)`, one film each (all on image `abc`).
    fn format_10_library_with_patients(root: &Path, patients: &[(&str, &str, &str)]) {
        old_library(root, 10);
        let c = Connection::open(db(root)).unwrap();
        c.execute("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x')", []).unwrap();
        for (id, name, added) in patients {
            c.execute("INSERT INTO patients (id, display_name, name_key, created_at) VALUES (?1, ?2, lower(?2), ?3)", params![id, name, added]).unwrap();
            c.execute("INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES (?1, ?2, 'abc', 'T1', ?3, ?3)",
                params![format!("case-{id}"), id, added]).unwrap();
        }
        fs::write(root.join("images").join("abc.png"), b"film bytes").unwrap();
    }
    fn numbers_by_name(lib: &Library) -> Vec<(String, Option<i64>)> {
        lib.conn.prepare("SELECT display_name, library_no FROM patients ORDER BY display_name").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap()
    }

    /// Review I1, ruling A (rule 5): a backup from before format 11 restored over a library that has issued numbers gets
    /// its patients numbered ABOVE every number the replaced library issued. Live A = L-00001, B = L-00002; the backup
    /// holds A and C. Positive control: numbering the backup from 1 gives C L-00002, B's number.
    #[test] fn restoring_a_pre_11_backup_numbers_its_patients_above_the_live_counter() {
        let (live, bk) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        format_10_library_with_patients(live.path(), &[("pa", "Demo A", "2026-01-01"), ("pb", "Demo B", "2026-01-02")]);
        let lib = Library::open(live.path()).unwrap();
        assert_eq!(numbers_by_name(&lib), vec![("Demo A".into(), Some(1)), ("Demo B".into(), Some(2))]);
        drop(lib);
        format_10_library_with_patients(bk.path(), &[("pa", "Demo A", "2026-01-01"), ("pc", "Demo C", "2026-01-03")]);
        let lib = Library::restore_backup(live.path(), bk.path()).unwrap();
        println!("restored: {:?}", numbers_by_name(&lib));
        assert_eq!(numbers_by_name(&lib), vec![("Demo A".into(), Some(3)), ("Demo C".into(), Some(4))]);
        for n in ["L-00001", "L-00002"] {
            let f = lib.find_library_id(n).unwrap().unwrap_or_else(|| panic!("{n} was issued; it must still be known"));
            assert_eq!((f.current, f.patient, f.merged), (None, None, false), "{n} leads nowhere, never to a restored patient");
        }
        assert!(lib.find_library_id("L-00005").unwrap().is_none(), "never issued");
    }

    /// Review item 3: the live library is read read-only before a restore. A library left with its last writes still in
    /// the write-ahead log (the app was killed: its connection never closed) must still give its counter, so a number
    /// issued after the backup is not issued again.
    #[test] fn a_restore_over_a_library_killed_with_writes_in_its_log_carries_the_counter() {
        let (t, src, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let mut lib = Library::open(t.path()).unwrap();
        let film = |name: &str, seed: u8| { let p = src.path().join(name); image::GrayImage::from_fn(64, 64, |x, y| image::Luma([(x as u8 ^ y as u8).wrapping_add(seed)])).save(&p).unwrap(); p };
        let meta = |name: &str| CaseMeta { patient_name: name.into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None };
        let a = lib.import(&film("synthetic-a.png", 1)).unwrap().case_id;
        lib.set_meta(&a, &meta("Demo A")).unwrap();
        let backup = lib.backup(out.path()).unwrap();
        let b = lib.import(&film("synthetic-b.png", 2)).unwrap().case_id;
        lib.set_meta(&b, &meta("Demo B")).unwrap();                              // L-00002, after the backup
        std::mem::forget(lib);                                                     // killed: never checkpointed
        let wal = fs::metadata(t.path().join("library.sqlite3-wal")).map(|m| m.len()).unwrap_or(0);
        println!("write-ahead log left behind: {wal} bytes");
        assert!(wal > 0, "the case needs writes still in the log");
        let mut lib = Library::restore_backup(t.path(), &backup).unwrap();
        let c = lib.import(&film("synthetic-c.png", 3)).unwrap().case_id;
        lib.set_meta(&c, &meta("Demo C")).unwrap();
        assert_eq!(lib.load(&c).unwrap().library_id.as_deref(), Some("L-00003"));
    }

    // AB-2 (2): everything else inside the library is still refused, whatever its contents.
    #[test] fn restore_still_refuses_every_other_folder_inside_the_library() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, true);
        drop(Library::open(t.path()).unwrap());
        let c = copies(t.path()).remove(0);
        let ub = t.path().join(UPGRADE_BACKUPS_DIR);
        let clone = |to: &Path| { fs::create_dir_all(to.join("images")).unwrap(); for (f, b) in tree(&c) { let r = f.strip_prefix(&c).unwrap(); fs::write(to.join(r), b).unwrap(); } };
        for n in ["restore-x", "replaced-x"] { clone(&t.path().join(n)); }
        std::os::unix::fs::symlink(t.path(), ub.join("link to the library")).unwrap();
        let nested = c.join("images").join("nested"); clone(&nested);
        for bad in [t.path().to_path_buf(), t.path().join("images"), ub.clone(), t.path().join("restore-x"), t.path().join("replaced-x"),
                    nested.clone(), ub.join("link to the library")] {
            let e = Library::restore_backup(t.path(), &bad).err().unwrap_or_else(|| panic!("{} must be refused", bad.display()));
            assert!(format!("{e:#}").contains("outside the library"), "{}: {e:#}", bad.display());
        }
        fs::remove_dir_all(&nested).unwrap();
        Library::restore_backup(t.path(), &c).unwrap();                       // the copy itself is accepted
    }

    // AB-2 (3): a swap that fails while restoring from a copy puts the library back and leaves the copy intact.
    #[test] fn a_failed_swap_from_an_upgrade_copy_puts_the_library_back_and_keeps_the_copy() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, true);
        drop(Library::open(t.path()).unwrap());
        let c = copies(t.path()).remove(0);
        set(t.path(), "a", "now");
        fs::remove_file(t.path().join("images").join("abc.png")).unwrap();     // so the restore has a film to move in
        let images = t.path().join("images");
        let before = tree(&c);
        fs::set_permissions(&images, fs::Permissions::from_mode(0o555)).unwrap();
        let r = Library::restore_backup(t.path(), &c);
        fs::set_permissions(&images, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(format!("{:#}", r.err().expect("the swap fails")).contains("put back"));
        assert_eq!(settings(&db(t.path()))[0].1, "now");
        assert_eq!(stored_version(&db(t.path())), schema::CURRENT);
        assert_eq!(tree(&c), before);
    }

    // AB-3 on restore: a copy of a library that had already lost a film restores; a copy that lost one itself does not.
    #[test] fn an_upgrade_copy_restores_without_a_film_the_library_had_already_lost() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, false);
        drop(Library::open(t.path()).unwrap());
        let c = copies(t.path()).remove(0);
        let r = Library::restore_backup(t.path(), &c);
        println!("I1 film missing everywhere, live library already missing it: {:?}", r.as_ref().err().map(|e| format!("{e:#}")));
        r.unwrap();
    }
    // Final review I1: restore never removes a film from the live images/ folder, so a film missing from the copy but
    // present in the live library is there after the restore. The reviewer's case: a film lost before the upgrade, then
    // re-imported, must not block restoring the copy.
    #[test] fn an_upgrade_copy_restores_when_a_film_it_lacks_was_reimported_since() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, false);
        drop(Library::open(t.path()).unwrap());
        let c = copies(t.path()).remove(0);
        fs::write(t.path().join("images").join("abc.png"), b"film bytes").unwrap();   // the film comes back
        let r = Library::restore_backup(t.path(), &c);
        println!("I1 re-imported film: {:?}", r.as_ref().err().map(|e| format!("{e:#}")));
        drop(r.expect("every film the restored database names is there afterwards"));
        assert_eq!(fs::read(t.path().join("images").join("abc.png")).unwrap(), b"film bytes");
    }
    // …and the same when the copy itself lost the film but the live library has it.
    #[test] fn an_upgrade_copy_missing_a_film_the_library_has_restores_complete() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, true);
        drop(Library::open(t.path()).unwrap());
        let c = copies(t.path()).remove(0);
        fs::remove_file(c.join("images").join("abc.png")).unwrap();
        let r = Library::restore_backup(t.path(), &c);
        println!("I1 copy lacks a film the library has: {:?}", r.as_ref().err().map(|e| format!("{e:#}")));
        drop(r.expect("the film is in the live library, so the result is complete"));
        assert!(t.path().join("images").join("abc.png").exists());
    }
    // The other direction: a film missing from the copy AND from the live folder, which the live library does not name
    // (so it is not missing there now), would leave the restored library missing a film. Refused, nothing changed.
    #[test] fn an_upgrade_copy_is_refused_when_the_restore_would_lose_a_film_the_library_is_not_missing() {
        let t = tempfile::tempdir().unwrap();
        old_library_with_image(t.path(), 7, true);
        drop(Library::open(t.path()).unwrap());
        let c = copies(t.path()).remove(0);
        fs::remove_file(c.join("images").join("abc.png")).unwrap();
        Connection::open(db(t.path())).unwrap().execute_batch("DELETE FROM cases; DELETE FROM images;").unwrap();
        fs::remove_file(t.path().join("images").join("abc.png")).unwrap();
        set(t.path(), "a", "live");
        let r = Library::restore_backup(t.path(), &c);
        println!("I1 film missing everywhere, live library does not name it: {:?}", r.as_ref().err().map(|e| format!("{e:#}")));
        let e = r.err().expect("the restored library would be missing a film the live one is not");
        assert!(format!("{e:#}").contains("missing 1 image"), "{e:#}");
        assert_eq!(settings(&db(t.path()))[0].1, "live", "the live library is not changed");
    }

    // AB-5: a restore whose final upgrade is refused puts the replaced library back, so "hasn't been changed" is true.
    #[test] fn a_restore_refused_at_its_upgrade_puts_the_replaced_library_back() {
        let (t, old) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        drop(Library::open(t.path()).unwrap());
        Connection::open(db(t.path())).unwrap().execute("INSERT INTO settings (key, value) VALUES ('mine', 'kept')", []).unwrap();
        old_library(old.path(), 7);                                           // a schema-7 backup
        let ub = t.path().join(UPGRADE_BACKUPS_DIR);
        fs::create_dir_all(&ub).unwrap();
        fs::set_permissions(&ub, fs::Permissions::from_mode(0o555)).unwrap();
        let r = Library::restore_backup(t.path(), old.path());
        fs::set_permissions(&ub, fs::Permissions::from_mode(0o755)).unwrap();
        assert!(format!("{:#}", r.err().expect("the upgrade copy is refused")).contains(UPGRADE_COPY_FAILED));
        assert_eq!(stored_version(&db(t.path())), schema::CURRENT);
        assert_eq!(settings(&db(t.path())), vec![("mine".to_string(), "kept".to_string())]);
        assert!(fs::read_dir(t.path()).unwrap().all(|e| !e.unwrap().file_name().to_string_lossy().starts_with("replaced-")));
        Library::open(t.path()).unwrap();
    }

    // Final review M3: a restore whose own upgrade fails after its copy was made is put back; the note of "this run's
    // copy" must not then be reused for the original library, or the upgrade notice would name the wrong copy.
    #[test] fn after_a_put_back_restore_the_original_library_gets_its_own_copy() {
        let (t, old) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        old_library(t.path(), 7);
        old_library(old.path(), 7);
        set(old.path(), "a", "from the backup");
        Connection::open(db(old.path())).unwrap().execute_batch("ALTER TABLE patients ADD COLUMN gender TEXT;").unwrap();  // its migration 8 fails
        assert!(Library::restore_backup(t.path(), old.path()).is_err(), "the restored database's upgrade fails, so it is put back");
        assert_eq!(settings(&db(t.path())), rows(), "the original is back");
        let lib = Library::open(t.path()).unwrap();
        let named = lib.upgrade_copy().expect("the original was upgraded, so it names its copy").to_path_buf();
        println!("M3 the copy named after the put-back holds: {:?}", settings(&db(&named)));
        assert_eq!(settings(&db(&named)), rows(), "the copy named is the original library's, not the restored one's");
        assert_eq!(copies(t.path()).len(), 2);
    }

    // AB-1 with restore: a backup restored after a failed upgrade is a different database and gets its own copy.
    #[test] fn a_restore_after_a_failed_upgrade_gets_its_own_copy() {
        let (t, old) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        old_library(t.path(), 7);
        Connection::open(db(t.path())).unwrap().execute_batch("ALTER TABLE patients ADD COLUMN gender TEXT;").unwrap();
        assert!(Library::open(t.path()).is_err());
        old_library(old.path(), 7);
        set(old.path(), "a", "from the backup");
        Library::restore_backup(t.path(), old.path()).unwrap();
        let made = copies(t.path());
        assert_eq!(made.len(), 2, "{made:?}");
        assert!(made.iter().any(|d| settings(&db(d))[0].1 == "from the backup"), "the restored database was copied before its upgrade");
    }

    /// Schema 10 (owner SCHEMA10-A, 15 Oct 2026): a schema-9 library built by the shipped migrations, with a case, a
    /// point, an AI run and its point, and its film on disk.
    fn schema_9_library_with_a_traced_case(root: &Path) {
        old_library_with_image(root, 9, true);
        Connection::open(db(root)).unwrap().execute_batch(
            "INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, updated_at) VALUES ('c1', 'S', 11, 12, 'ai-adjusted', 1, 10, 12, 0.9, 'x');
             INSERT INTO ai_runs (case_id, model_id, execution_provider, facing, total_ms, ran_at) VALUES ('c1', 'cwlachap-hrnet-w32', 'cpu', 'right', 1.5, 'x');
             INSERT INTO ai_points (run_id, channel, landmark_id, x, y, peak) VALUES (1, 0, 'S', 10, 12, 9.5);").unwrap();
    }
    /// Every row of the tables a schema-10 upgrade must not change, as text, from the database at `db`.
    fn traced_rows(db: &Path) -> Vec<String> {
        let c = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        ["SELECT case_id, id, x, y, source, verified, ai_x, ai_y, confidence, updated_at FROM landmarks",
         "SELECT id, case_id, model_id, execution_provider, facing, total_ms, ran_at FROM ai_runs",
         "SELECT run_id, channel, landmark_id, x, y, peak FROM ai_points",
         "SELECT id, patient_id, image_sha256, timepoint FROM cases", "SELECT key, value FROM settings ORDER BY key"].iter().flat_map(|sql| {
            let mut q = c.prepare(sql).unwrap();
            let n = q.column_count();
            q.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|"))).unwrap()
                .collect::<Result<Vec<_>, _>>().unwrap()
        }).collect()
    }
    fn has_column(db: &Path, table: &str, col: &str) -> bool {
        let c = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        c.query_row("SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2", [table, col], |r| r.get::<_, i64>(0)).unwrap() == 1
    }
    fn has_table(db: &Path, table: &str) -> bool {
        let c = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        c.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [table], |r| r.get::<_, i64>(0)).unwrap() == 1
    }

    #[test] fn a_schema_9_library_is_copied_at_9_before_it_becomes_10() {
        let t = tempfile::tempdir().unwrap();
        schema_9_library_with_a_traced_case(t.path());
        let before = traced_rows(&db(t.path()));
        let lib = open_with(t.path(), 10, &check_copy).unwrap();
        assert_eq!(schema::version(&lib.conn).unwrap(), 10);
        let made = copies(t.path());
        assert_eq!(made.len(), 1);
        let name = made[0].file_name().unwrap().to_string_lossy().into_owned();
        println!("9→10: live library now schema {}; copy {name:?} at schema {}", schema::version(&lib.conn).unwrap(), stored_version(&db(&made[0])));
        assert!(name.starts_with("OpenCephAI backup before upgrade 9→10 "), "{name}");
        assert_eq!(lib.upgrade_copy(), Some(made[0].as_path()));
        verify_backup(&made[0]).unwrap();
        assert_eq!(stored_version(&db(&made[0])), 9);
        assert_eq!(traced_rows(&db(&made[0])), before, "the copy holds every row as it was");
        assert!(!has_table(&db(&made[0]), "learning_record"), "the copy is the schema-9 library, untouched");
        drop(lib);
        assert_eq!(traced_rows(&db(t.path())), before, "the upgrade changed no old row");
        assert!(!has_column(&db(t.path()), "ai_runs", "sha256") && has_column(&db(t.path()), "ai_runs", "model_sha256"));
        assert!(has_column(&db(t.path()), "landmarks", "placed_by") && has_table(&db(t.path()), "learning_record"));
        let again = open_with(t.path(), 10, &check_copy).unwrap();
        assert_eq!((copies(t.path()).len(), again.upgrade_copy()), (1, None), "a current library makes no second copy");
    }

    // AUTOBACKUP-1 on 9→10: a migration 10 that fails after the copy leaves the library exactly at 9 (the first half of
    // the migration, ai_runs.model_sha256, is rolled back too) and the checked copy stays.
    #[test] fn a_failed_9_to_10_upgrade_changes_nothing_and_keeps_the_copy() {
        let t = tempfile::tempdir().unwrap();
        schema_9_library_with_a_traced_case(t.path());
        Connection::open(db(t.path())).unwrap().execute_batch("ALTER TABLE landmarks ADD COLUMN placed_by TEXT;").unwrap();  // migration 10 will fail
        let before = traced_rows(&db(t.path()));
        let e = Library::open(t.path()).err().expect("migration 10 fails");
        println!("injected 9→10 failure: {e:#}");
        assert!(!format!("{e:#}").contains(UPGRADE_COPY_FAILED), "the copy was fine; the migration failed: {e:#}");
        assert_eq!(stored_version(&db(t.path())), 9);
        assert_eq!(traced_rows(&db(t.path())), before);
        assert!(!has_column(&db(t.path()), "ai_runs", "model_sha256"), "the half-done migration was rolled back");
        assert!(!has_table(&db(t.path()), "learning_record"));
        let made = copies(t.path());
        assert_eq!(made.len(), 1, "{made:?}");
        verify_backup(&made[0]).unwrap();
        assert_eq!(stored_version(&db(&made[0])), 9);
    }

    /// A format-10 library (one image, patient p1, case c1) that has learned where a machine prints two details: the
    /// places have a GAP in their row numbers (1 and 3, place 2 was dropped) and case c1's vote points at place 3, and
    /// the patient has a date of birth. Migration 11 rebuilds `layout_places`, so this is what it must keep.
    fn schema_10_library_with_learned_places(root: &Path) {
        old_library_with_image(root, 10, true);
        Connection::open(db(root)).unwrap().execute_batch(
            "UPDATE patients SET date_of_birth = '1990-03-07', gender = 'F', referring_practitioner = 'Dr Demo' WHERE id = 'p1';   -- SYNTHETIC
             INSERT INTO layout_machines (id, name, width, height, created_at, updated_at) VALUES ('m1', 'Machine 1', 400, 300, 'x', 'x');
             INSERT INTO layout_places (machine_id, field, row_y, side, starts, ends, count, updated_at) VALUES
               ('m1', 'last', 0.06, 'left', 'line', 'comma', 3, 'x'), ('m1', 'dob', 0.11, 'left', 'after:dob', 'end', 2, 'x'),
               ('m1', 'scan_id', 0.14, 'left', 'after:pid', 'end', 1, 'x');
             DELETE FROM layout_places WHERE field = 'dob';
             UPDATE cases SET layout_machine_id = 'm1' WHERE id = 'c1';
             INSERT INTO layout_votes (case_id, field, place) VALUES ('c1', 'scan_id', 3);").unwrap();
    }
    /// Every row of the tables migration 11 alters or rebuilds, as text: the patients' format-10 columns, the machines,
    /// the learned places WITH their row numbers, and the votes.
    fn learned_rows(db: &Path) -> Vec<String> {
        let c = Connection::open_with_flags(db, rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY).unwrap();
        ["SELECT id, display_name, name_key, date_of_birth, created_at, gender, referring_practitioner FROM patients ORDER BY id",
         "SELECT id, name, named_by_user, width, height, films, created_at, updated_at FROM layout_machines ORDER BY id",
         "SELECT rowid, machine_id, field, row_y, side, starts, ends, count, updated_at FROM layout_places ORDER BY rowid",
         "SELECT case_id, field, place FROM layout_votes ORDER BY case_id, field"].iter().flat_map(|sql| {
            let mut q = c.prepare(sql).unwrap();
            let n = q.column_count();
            q.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|"))).unwrap()
                .collect::<Result<Vec<_>, _>>().unwrap()
        }).collect()
    }

    // AUTOBACKUP-1 on 10→11 (spec 2026-10-17): the copy is made and checked at 10, then the library becomes 11. Through
    // `Library::open`: the patients, machines, learned places (with their row numbers) and votes read the same in the
    // live library and in the copy. Positive control: a rebuild that renumbers the places fails "learned places".
    #[test] fn a_schema_10_library_is_copied_at_10_before_it_becomes_11() {
        let t = tempfile::tempdir().unwrap();
        schema_10_library_with_learned_places(t.path());
        let (before, learned_before) = (traced_rows(&db(t.path())), learned_rows(&db(t.path())));
        assert_eq!(learned_before.len(), 1 + 1 + 2 + 1, "the fixture holds a patient, a machine, two places and a vote: {learned_before:#?}");
        let lib = Library::open(t.path()).unwrap();
        assert_eq!(schema::version(&lib.conn).unwrap(), 11);
        let made = copies(t.path());
        assert_eq!(made.len(), 1);
        let name = made[0].file_name().unwrap().to_string_lossy().into_owned();
        println!("10→11: copy {name:?} at schema {}", stored_version(&db(&made[0])));
        assert!(name.starts_with("OpenCephAI backup before upgrade 10→11 "), "{name}");
        assert_eq!(lib.upgrade_copy(), Some(made[0].as_path()));
        verify_backup(&made[0]).unwrap();
        assert_eq!(stored_version(&db(&made[0])), 10);
        assert!(!has_column(&db(&made[0]), "cases", "xray_type"), "the copy is the format-10 library, untouched");
        assert_eq!(traced_rows(&db(&made[0])), before, "the copy holds every row as it was");
        assert_eq!(learned_rows(&db(&made[0])), learned_before, "the copy holds every learned place as it was");
        drop(lib);
        assert_eq!(traced_rows(&db(t.path())), before, "the upgrade changed no old row");
        assert_eq!(learned_rows(&db(t.path())), learned_before, "the upgrade kept every patient, machine, learned place (with its row number) and vote");
        assert!(has_column(&db(t.path()), "cases", "printed_patient_id") && has_column(&db(t.path()), "patients", "library_no") && !has_column(&db(t.path()), "patients", "printed_patient_id"));
        assert!(has_column(&db(t.path()), "cases", "radiography_practice"));
        let again = Library::open(t.path()).unwrap();
        assert_eq!((copies(t.path()).len(), again.upgrade_copy()), (1, None), "a current library makes no second copy");
    }
    // Task 11 whole-branch edge sweep: a format-10 library with a NAMED and an UNNAMED patient (schema.rs already
    // covers the numbering rule at the migration level; this is the same thing through the real entry point,
    // `Library::open`, which is what every production open and test above it uses). The copy is made and checked at
    // 10; the named patients are numbered in the order they were added (created_at); the unnamed one gets none.
    #[test] fn opening_a_format_10_library_with_named_and_unnamed_patients_numbers_only_the_named_ones() {
        let t = tempfile::tempdir().unwrap();
        old_library(t.path(), 10);
        {
            let c = Connection::open(db(t.path())).unwrap();
            c.execute_batch(
                "INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
                 INSERT INTO patients (id, display_name, name_key, created_at) VALUES
                   ('late', 'Demo Late', 'demo late', '2026-02-01T00:00:00Z'),
                   ('none', '', '~none', '2026-01-15T00:00:00Z'),
                   ('early', 'Demo Early', 'demo early', '2026-01-01T00:00:00Z');
                 INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES
                   ('c-late', 'late', 'abc', 'T1', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z'),
                   ('c-none', 'none', 'abc', 'T1', '2026-01-15T00:00:00Z', '2026-01-15T00:00:00Z'),
                   ('c-early', 'early', 'abc', 'T1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');").unwrap();   // SYNTHETIC
        }
        fs::write(t.path().join("images").join("abc.png"), b"film bytes").unwrap();
        let lib = Library::open(t.path()).unwrap();
        assert_eq!(schema::version(&lib.conn).unwrap(), schema::CURRENT);
        let made = copies(t.path());
        assert_eq!(made.len(), 1, "one safety copy, taken before the upgrade: {made:?}");
        assert_eq!(stored_version(&db(&made[0])), 10, "the copy is at format 10, untouched");
        let by_name = numbers_by_name(&lib);
        println!("named + unnamed through Library::open, numbers by name: {by_name:?}");
        assert_eq!(by_name, vec![("".into(), None), ("Demo Early".into(), Some(1)), ("Demo Late".into(), Some(2))],
            "named patients numbered in the order added; the unnamed one gets no number");
        let issued: Vec<i64> = lib.conn.prepare("SELECT n FROM library_numbers ORDER BY n").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(issued, [1, 2], "numbers issued in order, none for the unnamed patient");
    }
    /// Addendum D2 (L7 A): a library written by the FIRST format 11 (Patient ID on the patient) is refused, unchanged.
    /// Positive control: remove the `check_shape` call in `open_with` and this test fails (the library opens).
    /// The `copies(...)` assert is a fact about format 11 (a library already at 11 is never copied), not a control.
    #[test] fn a_library_with_the_superseded_format_11_shape_is_refused_and_not_changed() {
        let t = tempfile::tempdir().unwrap();
        schema_10_library_with_learned_places(t.path());
        {
            let c = Connection::open(db(t.path())).unwrap();
            c.execute_batch(include_str!("../tests/fixtures/011_film_details_superseded.sql")).unwrap();
            c.pragma_update(None, "user_version", 11).unwrap();
        }
        let before = (traced_rows(&db(t.path())), learned_rows(&db(t.path())));
        let e = Library::open(t.path()).err().expect("the old shape is refused");
        println!("superseded format 11 refused: {e:#}");
        assert!(format!("{e:#}").contains(schema::SUPERSEDED_11), "{e:#}");
        assert_eq!((traced_rows(&db(t.path())), learned_rows(&db(t.path()))), before, "nothing changed");
        assert_eq!(stored_version(&db(t.path())), 11);
        assert!(copies(t.path()).is_empty(), "no copy is made of a library that is not upgraded");
    }
    /// Owner ruling JOIN-HISTORY: a library written by the SECOND withdrawn format 11 (carried numbers noted in
    /// `library_number_films`, no join record) is refused, unchanged, like the first. Positive control: drop the
    /// `xray_joins` check from `check_shape` and this test fails (the library opens).
    #[test] fn a_library_with_the_second_superseded_format_11_shape_is_refused_and_not_changed() {
        let t = tempfile::tempdir().unwrap();
        schema_10_library_with_learned_places(t.path());
        {
            let c = Connection::open(db(t.path())).unwrap();
            c.execute_batch(include_str!("../tests/fixtures/011_film_details_superseded_2.sql")).unwrap();
            c.pragma_update(None, "user_version", 11).unwrap();
        }
        let before = (traced_rows(&db(t.path())), learned_rows(&db(t.path())));
        let e = Library::open(t.path()).err().expect("the second withdrawn shape is refused");
        println!("second superseded format 11 refused: {e:#}");
        assert!(format!("{e:#}").contains(schema::SUPERSEDED_11), "{e:#}");
        assert_eq!((traced_rows(&db(t.path())), learned_rows(&db(t.path()))), before, "nothing changed");
        assert_eq!(stored_version(&db(t.path())), 11);
        assert!(copies(t.path()).is_empty());
    }
    /// Owner ruling JOIN-HISTORY, Task 14: a library written by the THIRD withdrawn format 11 (the join record AND the
    /// carried-number notes `library_number_films`, c79ff84; debug builds only) is refused, unchanged, like the other
    /// two. Positive control: drop BOTH the `library_number_films` and the `first_linked_at` checks from `check_shape`
    /// and this test fails (it opens). (Since L9-A the third shape also has `first_linked_at`, so dropping only the
    /// first check no longer opens it: measured 18 Oct.)
    #[test] fn a_library_with_the_third_superseded_format_11_shape_is_refused_and_not_changed() {
        let t = tempfile::tempdir().unwrap();
        schema_10_library_with_learned_places(t.path());
        {
            let c = Connection::open(db(t.path())).unwrap();
            c.execute_batch(include_str!("../tests/fixtures/011_film_details_superseded_3.sql")).unwrap();
            c.pragma_update(None, "user_version", 11).unwrap();
        }
        let before = (traced_rows(&db(t.path())), learned_rows(&db(t.path())));
        let e = Library::open(t.path()).err().expect("the third withdrawn shape is refused");
        println!("third superseded format 11 refused: {e:#}");
        assert!(format!("{e:#}").contains(schema::SUPERSEDED_11), "{e:#}");
        assert_eq!((traced_rows(&db(t.path())), learned_rows(&db(t.path()))), before, "nothing changed");
        assert_eq!(stored_version(&db(t.path())), 11);
        assert!(copies(t.path()).is_empty());
    }
    /// Owner ruling L9-A: a library written by the FOURTH withdrawn format 11 (883f250: `library_numbers.first_linked_at`,
    /// read only by the withdrawn give-back) is refused, unchanged, like the other three. Positive control: drop the
    /// `first_linked_at` check from `check_shape` and this test fails (it opens).
    #[test] fn a_library_with_the_fourth_superseded_format_11_shape_is_refused_and_not_changed() {
        let t = tempfile::tempdir().unwrap();
        schema_10_library_with_learned_places(t.path());
        {
            let c = Connection::open(db(t.path())).unwrap();
            c.execute_batch(include_str!("../tests/fixtures/011_film_details_superseded_4.sql")).unwrap();
            c.pragma_update(None, "user_version", 11).unwrap();
        }
        let before = (traced_rows(&db(t.path())), learned_rows(&db(t.path())));
        let e = Library::open(t.path()).err().expect("the fourth withdrawn shape is refused");
        println!("fourth superseded format 11 refused: {e:#}");
        assert!(format!("{e:#}").contains(schema::SUPERSEDED_11), "{e:#}");
        assert_eq!((traced_rows(&db(t.path())), learned_rows(&db(t.path()))), before, "nothing changed");
        assert_eq!(stored_version(&db(t.path())), 11);
        assert!(copies(t.path()).is_empty());
    }
    // A migration 11 that fails after the copy leaves the library exactly at 10 (its first statement rolled back too).
    #[test] fn a_failed_10_to_11_upgrade_changes_nothing_and_keeps_the_copy() {
        let t = tempfile::tempdir().unwrap();
        schema_10_library_with_learned_places(t.path());
        Connection::open(db(t.path())).unwrap().execute_batch("ALTER TABLE cases ADD COLUMN radiography_practice TEXT;").unwrap();  // migration 11 will fail
        let (before, learned_before) = (traced_rows(&db(t.path())), learned_rows(&db(t.path())));
        let e = Library::open(t.path()).err().expect("migration 11 fails");
        println!("injected 10→11 failure: {e:#}");
        assert!(!format!("{e:#}").contains(UPGRADE_COPY_FAILED), "the copy was fine; the migration failed: {e:#}");
        assert_eq!(stored_version(&db(t.path())), 10);
        assert_eq!(traced_rows(&db(t.path())), before);
        assert_eq!(learned_rows(&db(t.path())), learned_before);
        // Preflight 1d: the amended 011's FIRST statement adds cases.printed_patient_id, before the injected failure, so
        // only this assert can see a migration that was not rolled back; the other two pin that nothing later ran.
        assert!(!has_column(&db(t.path()), "cases", "printed_patient_id"), "the half-done migration was rolled back");
        assert!(!has_column(&db(t.path()), "patients", "library_no") && !has_table(&db(t.path()), "library_numbers"), "the half-done migration was rolled back");
        let made = copies(t.path());
        assert_eq!(made.len(), 1, "{made:?}");
        verify_backup(&made[0]).unwrap();
        assert_eq!(stored_version(&db(&made[0])), 10);
        assert_eq!(learned_rows(&db(&made[0])), learned_before, "the copy holds every learned place");
    }

    // Deleted with the case: emptying Recently deleted (the one place a case row is removed) removes its learning rows,
    // through `Library::open`'s own connection (foreign keys on).
    #[test] fn purging_a_deleted_case_removes_its_learning_rows() {
        let t = tempfile::tempdir().unwrap();
        schema_9_library_with_a_traced_case(t.path());
        let mut lib = Library::open(t.path()).unwrap();
        lib.conn.execute("INSERT INTO learning_record VALUES ('c1', 'S', 'cwlachap-hrnet-w32', NULL, 'cpu', 1, 0.1, 1, 'unknown', 'moved', 1, 'Dr A', 'x')", []).unwrap();
        assert!(lib.conn.execute("INSERT INTO learning_record VALUES ('nope', 'S', 'm', NULL, 'cpu', 1, 0.1, 1, 'unknown', 'moved', 0, 'Dr A', 'x')", []).is_err(),
            "no learning row for a case that does not exist");
        lib.delete("c1").unwrap();
        let count = |l: &Library| l.conn.query_row("SELECT COUNT(*) FROM learning_record", [], |r| r.get::<_, i64>(0)).unwrap();
        assert_eq!(count(&lib), 1, "a case in Recently deleted keeps its rows (it can be restored)");
        lib.conn.execute("UPDATE cases SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = 'c1'", []).unwrap();
        assert_eq!(lib.purge_deleted(30).unwrap(), 1);
        assert_eq!(count(&lib), 0, "purging the case removed its learning rows");
    }
}

/// Task 10 (spec 2026-10-13 "Parked" P5, owner SCHEMA10-A and Q5 second half): `placed_by`, the model fingerprint with
/// each run, and the learning record's store. Helper: `import` of a synthetic PNG, as `upgrade_copy_tests` does.
#[cfg(test)]
mod learning_store_tests {
    use super::*;
    use crate::LearningRow;
    fn lib() -> (tempfile::TempDir, Library, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        let png = t.path().join("SYNTHETIC.png");
        image::GrayImage::new(64, 64).save(&png).unwrap();
        let id = l.import(&png).unwrap().case_id;
        (t, l, id)
    }
    fn row(id: &str, source: &str, verified: bool, placed_by: Option<&str>) -> LandmarkRow {
        LandmarkRow { id: id.into(), x: 10.0, y: 20.0, source: source.into(), verified, ai_x: Some(10.0), ai_y: Some(20.0), confidence: Some(0.9), placed_by: placed_by.map(String::from) }
    }
    fn edit(id: &str, rows: Vec<LandmarkRow>) -> CaseEdit { CaseEdit { id: id.into(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks: rows } }
    fn events(l: &Library, id: &str) -> i64 { l.conn.query_row("SELECT COUNT(*) FROM landmark_events WHERE case_id = ?1", [id], |r| r.get(0)).unwrap() }
    #[test] fn placed_by_is_saved_and_read_back_and_old_rows_have_none() {
        let (_t, mut l, id) = lib();
        l.save(&edit(&id, vec![row("S", "ai", false, Some("aariz-cepha29")), row("N", "ai", false, None)]), "Dr A").unwrap();
        let d = l.load(&id).unwrap();
        assert_eq!(d.landmarks.iter().map(|r| r.placed_by.clone()).collect::<Vec<_>>(), vec![Some("aariz-cepha29".to_string()), None]);
    }
    #[test] fn a_save_that_only_adds_placed_by_keeps_tracing_verified_and_writes_no_event() {
        let (_t, mut l, id) = lib();
        l.save(&edit(&id, vec![row("S", "ai", true, None)]), "Dr A").unwrap();
        l.set_verified(&id, true, "Dr A").unwrap();
        let before = events(&l, &id);
        let s = l.save(&edit(&id, vec![row("S", "ai", true, Some("aariz-cepha29"))]), "Dr A").unwrap();
        assert!(s.verified_at.is_some(), "placed_by alone is not a landmark change");
        assert_eq!(events(&l, &id), before);
        assert_eq!(l.load(&id).unwrap().landmarks[0].placed_by.as_deref(), Some("aariz-cepha29"));
    }
    #[test] fn no_placed_by_keeps_the_stored_one_and_a_hand_placed_point_clears_it() {
        let (_t, mut l, id) = lib();
        l.save(&edit(&id, vec![row("S", "ai", false, Some("aariz-cepha29"))]), "Dr A").unwrap();
        l.save(&edit(&id, vec![LandmarkRow { x: 11.0, ..row("S", "ai-adjusted", false, None) }]), "Dr A").unwrap();
        assert_eq!(l.load(&id).unwrap().landmarks[0].placed_by.as_deref(), Some("aariz-cepha29"), "a moved point keeps who placed it");
        l.save(&edit(&id, vec![LandmarkRow { x: 12.0, ..row("S", "manual", false, Some("aariz-cepha29")) }]), "Dr A").unwrap();
        assert_eq!(l.load(&id).unwrap().landmarks[0].placed_by, None, "a hand-placed point has no placing model");
    }
    #[test] fn a_save_with_no_placed_by_for_an_unchanged_row_keeps_the_stored_one() {
        let (_t, mut l, id) = lib();
        l.save(&edit(&id, vec![row("S", "ai", false, Some("aariz-cepha29"))]), "Dr A").unwrap();
        let before = events(&l, &id);
        l.save(&edit(&id, vec![row("S", "ai", false, None)]), "Dr A").unwrap();
        assert_eq!(l.load(&id).unwrap().landmarks[0].placed_by.as_deref(), Some("aariz-cepha29"));
        assert_eq!(events(&l, &id), before, "no landmark event for a missing placed_by");
    }
    #[test] fn a_run_keeps_its_model_hash_and_provider() {
        let (_t, mut l, id) = lib();
        let run = AiRun { model_id: "gu2net-isbi19".into(), execution_provider: "coreml".into(), facing: "right".into(), total_ms: 1.0, model_sha256: Some("abc".into()) };
        l.record_ai_run(&id, &run, &[AiPoint { channel: 0, landmark_id: Some("S".into()), x: 1.0, y: 2.0, peak: 3.0 }]).unwrap();
        let m = &l.latest_ai_points(&id).unwrap()[0];
        assert_eq!((m.execution_provider.as_str(), m.model_sha256.as_deref()), ("coreml", Some("abc")));
    }
    fn lrow(lm: &str, model: &str, px: f64, how: &str) -> LearningRow {
        LearningRow { landmark_id: lm.into(), model_id: model.into(), model_sha256: None, execution_provider: "cpu".into(), dist_px: px, dist_mm: px * 0.1,
            mm_assumed: true, machine: "unknown".into(), how: how.into(), placer: false }
    }
    #[test] fn learning_rows_are_replaced_as_a_whole() {
        let (_t, mut l, id) = lib();
        l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 0.0, "accepted-unmoved"), lrow("S", "gu2net-isbi19", 7.0, "accepted-unmoved"), lrow("N", "aariz-cepha29", 1.0, "moved")], "Dr A").unwrap();
        l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 4.0, "moved"), lrow("S", "gu2net-isbi19", 3.0, "moved")], "Dr A").unwrap();
        let rows = l.learning_rows(&id).unwrap();
        assert_eq!(rows.len(), 2, "N was un-verified: its row is gone; S is updated, not added");
        assert_eq!((rows[0].dist_px, rows[0].how.as_str()), (4.0, "moved"));
        l.replace_learning(&id, &[], "Dr A").unwrap();
        assert!(l.learning_rows(&id).unwrap().is_empty());
    }
    #[test] fn a_bad_learning_row_changes_nothing() {
        let (_t, mut l, id) = lib();
        l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 1.0, "moved")], "Dr A").unwrap();
        assert!(l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 2.0, "moved"), lrow("N", "aariz-cepha29", f64::NAN, "moved")], "Dr A").is_err());
        assert!(l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 2.0, "moved"), lrow("N", "aariz-cepha29", f64::INFINITY, "moved")], "Dr A").is_err());
        assert!(l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 2.0, "guessed")], "Dr A").is_err(), "the schema refuses an unknown way");
        assert_eq!(l.learning_rows(&id).unwrap()[0].dist_px, 1.0, "one transaction: the old rows stand");
    }
    /// Review item 2: `learning_record` has no foreign key to `landmarks`, so the store itself removes a point's rows
    /// in the same transaction that removes or changes the point. A row never outlives the point it was measured on, even
    /// when the record cannot be rebuilt afterwards.
    #[test] fn a_removed_or_changed_point_loses_its_rows_in_the_save_itself() {
        let (_t, mut l, id) = lib();
        l.save(&edit(&id, vec![row("S", "ai", true, Some("aariz-cepha29")), row("N", "ai", true, None), row("Go", "ai", true, None)]), "Dr A").unwrap();
        l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 0.0, "accepted-unmoved"), lrow("N", "aariz-cepha29", 1.0, "accepted-unmoved"),
            lrow("Go", "aariz-cepha29", 2.0, "accepted-unmoved")], "Dr A").unwrap();
        // S deleted, N moved, Go untouched apart from placed_by.
        l.save(&edit(&id, vec![LandmarkRow { x: 30.0, ..row("N", "ai-adjusted", true, None) }, row("Go", "ai", true, Some("aariz-cepha29"))]), "Dr A").unwrap();
        let left: Vec<String> = l.learning_rows(&id).unwrap().into_iter().map(|r| r.landmark_id).collect();
        assert_eq!(left, ["Go"], "the deleted S and the moved N lose their rows; Go (placed_by only) keeps its row");
        l.save(&edit(&id, vec![row("Go", "ai", false, Some("aariz-cepha29"))]), "Dr A").unwrap();
        assert!(l.learning_rows(&id).unwrap().is_empty(), "un-verified (and N deleted): no rows left");
    }
    /// Fix round 1 (review I1): every stored run of the case, newest first, so the app can find the run that placed a point.
    #[test] fn the_run_history_lists_every_run_newest_first_with_its_hash_and_runtime() {
        let (_t, mut l, id) = lib();
        let run = |sha: &str, prov: &str| AiRun { model_id: "aariz-cepha29".into(), execution_provider: prov.into(), facing: "right".into(), total_ms: 1.0, model_sha256: Some(sha.into()) };
        l.record_ai_run(&id, &run("old", "cpu"), &[AiPoint { channel: 0, landmark_id: Some("S".into()), x: 1.0, y: 2.0, peak: 3.0 }]).unwrap();
        l.record_ai_run(&id, &run("new", "coreml"), &[AiPoint { channel: 0, landmark_id: Some("S".into()), x: 5.0, y: 2.0, peak: 3.0 }]).unwrap();
        let h = l.ai_run_history(&id).unwrap();
        assert_eq!(h.iter().map(|m| (m.model_sha256.as_deref(), m.execution_provider.as_str(), m.points[0].x)).collect::<Vec<_>>(),
            [(Some("new"), "coreml", 5.0), (Some("old"), "cpu", 1.0)]);
        assert_eq!(l.latest_ai_points(&id).unwrap().len(), 1, "latest still gives one run per model");
    }
    /// Fix round 1 (review M1): the record never fails a calibration.
    #[test] fn a_calibration_succeeds_when_the_learning_rows_cannot_be_cleared() {
        let (_t, mut l, id) = lib();
        l.conn.execute_batch("DROP TABLE learning_record").unwrap();
        assert!(l.calibrate(&id, (0.0, 0.0), (100.0, 0.0), 20.0, "Dr A").is_ok());
        assert_eq!(l.load(&id).unwrap().spacing_mm, Some(0.2));
    }
    /// A new ruler changes every millimetre: the old rows go with the old scale.
    #[test] fn a_calibration_drops_the_rows_measured_at_the_old_scale() {
        let (_t, mut l, id) = lib();
        l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 10.0, "moved")], "Dr A").unwrap();
        l.calibrate(&id, (0.0, 0.0), (100.0, 0.0), 20.0, "Dr A").unwrap();
        assert!(l.learning_rows(&id).unwrap().is_empty());
    }
    #[test] fn a_case_in_recently_deleted_refuses_the_record_and_keeps_its_rows_until_purged() {
        let (_t, mut l, id) = lib();
        l.replace_learning(&id, &[lrow("S", "aariz-cepha29", 1.0, "moved")], "Dr A").unwrap();
        l.delete(&id).unwrap();
        let e = l.replace_learning(&id, &[], "Dr A").unwrap_err().to_string();
        assert!(e.contains("Recently deleted"), "{e}");
        assert_eq!(l.learning_rows(&id).unwrap().len(), 1, "restorable: rows kept");
        l.restore(&id).unwrap();
        assert_eq!(l.learning_rows(&id).unwrap().len(), 1);
    }
}
