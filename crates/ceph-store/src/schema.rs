use rusqlite::{params, Connection, Transaction};

/// Numbered migrations; entry i takes `PRAGMA user_version` from i to i + 1. Never edit a shipped entry: append. (011 was
/// amended four times, before any release — addendum D2, then owner ruling JOIN-HISTORY in two steps, 17 Oct, then
/// owner ruling L9-A, 18 Oct; `check_shape` refuses all four earlier versions.)
pub const MIGRATIONS: &[&str] = &[include_str!("../migrations/001_init.sql"), include_str!("../migrations/002_patient_identity.sql"),
    include_str!("../migrations/003_blank_unread_names.sql"), include_str!("../migrations/004_film_layouts.sql"),
    include_str!("../migrations/005_timepoints_by_film_date.sql"),
    include_str!("../migrations/006_series.sql"), include_str!("../migrations/007_models.sql"),
    include_str!("../migrations/008_patient_gender_referrer.sql"), include_str!("../migrations/009_norms.sql"),
    include_str!("../migrations/010_learning_record.sql"), include_str!("../migrations/011_film_details.sql")];
pub const CURRENT: i64 = MIGRATIONS.len() as i64;

/// Shown, and the library not opened or changed, when it was written by any withdrawn format 11 (addendum D2, L7 A;
/// owner ruling JOIN-HISTORY).
pub const SUPERSEDED_11: &str = "This library was opened by a test version of OpenCephAI whose format was changed before release. \
It has not been changed. Restore the safety copy in the library's \"upgrade-backups\" folder (made before that upgrade).";

pub fn version(conn: &Connection) -> rusqlite::Result<i64> { conn.query_row("PRAGMA user_version", [], |r| r.get(0)) }

/// Brings the library up to `CURRENT`, one transaction per migration. Refuses a library from a newer OpenCephAI.
/// Foreign keys are off while migrating (SQLite's table-rebuild procedure) and every reference is checked before each
/// migration commits; the caller's foreign-key setting is put back afterwards.
/// Test-only: the library opens through `Library::open`, which copies an existing library before any migration runs
/// (AUTOBACKUP-1), so no public entry point migrates an uncopied library.
#[cfg(test)]
pub(crate) fn migrate(conn: &mut Connection) -> anyhow::Result<()> { migrate_to(conn, CURRENT) }

/// `migrate`, stopping at schema `target` (≤ `CURRENT`); tests pass less to stand in for an app release that knew fewer
/// migrations. Production opens through `migrate_to_above`.
#[cfg(test)]
pub(crate) fn migrate_to(conn: &mut Connection, target: i64) -> anyhow::Result<()> { migrate_to_above(conn, target, 0) }

/// `migrate_to`, with migration 11 numbering patients above `floor` (review I1, ruling A: a backup from before format 11,
/// restored over a library that had issued numbers up to `floor`, never re-issues any of them). Production passes 0
/// except from `Library::restore_backup`.
pub(crate) fn migrate_to_above(conn: &mut Connection, target: i64, floor: i64) -> anyhow::Result<()> {
    let v = version(conn)?;
    anyhow::ensure!(v <= CURRENT, "this library was written by a newer OpenCephAI (schema {v}, this app knows {CURRENT}); update the app");
    anyhow::ensure!(target <= CURRENT, "schema {target} is newer than this app knows ({CURRENT})");
    if v >= target { return Ok(()); }
    let fk: i64 = conn.query_row("PRAGMA foreign_keys", [], |r| r.get(0))?;
    conn.pragma_update(None, "foreign_keys", "OFF")?;
    let run = (|| -> anyhow::Result<()> {
        for (i, sql) in MIGRATIONS.iter().enumerate().take(target as usize).skip(v as usize) {
            let tx = conn.transaction()?;
            tx.execute_batch(sql)?;
            if i + 1 == 2 { backfill_name_keys(&tx)?; }
            if i + 1 == 3 { blank_unread_names(&tx)?; }
            if i + 1 == 5 { timepoints_by_film_date(&tx)?; }
            if i + 1 == 11 { number_patients(&tx, floor)?; }
            let broken = tx.prepare("PRAGMA foreign_key_check")?.query_map([], |_| Ok(()))?.count();
            anyhow::ensure!(broken == 0, "migration {} would leave {broken} broken reference(s); the library was not changed", i + 1);
            tx.pragma_update(None, "user_version", (i + 1) as i64)?;
            tx.commit()?;
        }
        Ok(())
    })();
    conn.pragma_update(None, "foreign_keys", if fk == 1 { "ON" } else { "OFF" })?;
    run
}

/// Schema 2: every existing patient gets its name key (existing rows have no date of birth).
fn backfill_name_keys(tx: &Transaction) -> anyhow::Result<()> {
    let rows: Vec<(String, String)> = tx.prepare("SELECT id, display_name FROM patients")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    for (id, name) in rows { tx.execute("UPDATE patients SET name_key = ?2 WHERE id = ?1", params![id, crate::identity::name_key(&name)])?; }
    Ok(())
}

/// Schema 3: unconfirmed names that were guessed or taken from the file name become blank (see the migration's comment).
fn blank_unread_names(tx: &Transaction) -> anyhow::Result<()> {
    let rows: Vec<(String, Option<String>)> = tx.prepare(
        "SELECT c.id, p.date_of_birth FROM cases c JOIN patients p ON p.id = c.patient_id
         WHERE c.identity_checked = 0 AND c.identity_source IN ('guess', 'manual') AND trim(p.display_name) != ''")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    for (case_id, dob) in rows {
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at)
                    VALUES (?1, '', ?2, ?3, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))", params![id, format!("~{id}"), dob])?;
        tx.execute("UPDATE cases SET patient_id = ?2, timepoint = 'T1', identity_source = 'manual' WHERE id = ?1", params![case_id, id])?;
    }
    tx.execute("DELETE FROM patients WHERE id NOT IN (SELECT patient_id FROM cases)", [])?;
    Ok(())
}

/// Schema 5: every patient's T-numbers in film-date order (see the migration's comment).
fn timepoints_by_film_date(tx: &Transaction) -> anyhow::Result<()> {
    let pids: Vec<String> = tx.prepare("SELECT id FROM patients")?.query_map([], |r| r.get(0))?.collect::<Result<_, _>>()?;
    for pid in pids { crate::library::renumber_by_date(tx, &pid)?; }
    Ok(())
}

/// Schema 11 (LIBID-1): every named patient gets a Library ID in the order it was added, above `floor` (numbers 1..floor
/// become known but held by nobody); unnamed ones wait for a name. "Named" uses Rust's `trim`, as `settle_after_move`
/// does (Task 1 deferred minor: SQL `trim()` strips only spaces).
fn number_patients(tx: &Transaction, floor: i64) -> anyhow::Result<()> {
    crate::library_ids::raise_counter(tx, floor)?;
    let rows: Vec<(String, String, String)> = tx.prepare("SELECT id, created_at, display_name FROM patients ORDER BY created_at, rowid")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    for (id, at, _) in rows.into_iter().filter(|r| !r.2.trim().is_empty()) {
        tx.execute("INSERT INTO library_numbers (issued_at) VALUES (?1)", [&at])?;
        tx.execute("UPDATE patients SET library_no = ?2 WHERE id = ?1", params![id, tx.last_insert_rowid()])?;
    }
    // Owner ruling JOIN-HISTORY: every X-ray already in the library (live or in Recently deleted) starts its record on
    // the patient it is on now, with that patient's number; what happened before the upgrade is not known.
    tx.execute("INSERT INTO xray_joins (case_id, patient_id, library_no, joined_at, how)
                SELECT c.id, c.patient_id, p.library_no, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'upgrade'
                  FROM cases c JOIN patients p ON p.id = c.patient_id ORDER BY c.created_at, c.rowid", [])?;
    Ok(())
}

/// A library at format 11 that still has the first 011's shape (the Patient ID on the patient), the second's (no join
/// record, owner ruling JOIN-HISTORY) or the third's (the join record AND the withdrawn carried-number notes
/// `library_number_films`, c79ff84) is refused (L7 A), or the fourth's (`library_numbers.first_linked_at`, 883f250,
/// withdrawn by owner ruling L9-A).
pub(crate) fn check_shape(conn: &Connection) -> anyhow::Result<()> {
    if version(conn)? == 11 {
        let old: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_table_info('patients') WHERE name = 'printed_patient_id'", [], |r| r.get(0))?;
        let table = |name: &str| conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?1", [name], |r| r.get::<_, i64>(0));
        let (joins, notes) = (table("xray_joins")?, table("library_number_films")?);
        let linked: i64 = conn.query_row("SELECT COUNT(*) FROM pragma_table_info('library_numbers') WHERE name = 'first_linked_at'", [], |r| r.get(0))?;
        anyhow::ensure!(old == 0 && joins == 1 && notes == 0 && linked == 0, SUPERSEDED_11);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn tables(c: &Connection) -> Vec<String> {
        c.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap()
    }
    /// Every column of one row of `cases`, by name (final-review fix round 2, C4 follow-up): lets a migration test
    /// compare the WHOLE row before and after, not a hand-picked column or two, so a migration that touches a case
    /// column it has no business touching is caught.
    fn case_row(c: &Connection, id: &str) -> Vec<(String, rusqlite::types::Value)> {
        let cols: Vec<String> = c.prepare("SELECT name FROM pragma_table_info('cases')").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        let sql = format!("SELECT {} FROM cases WHERE id = ?1", cols.join(", "));
        c.query_row(&sql, [id], |r| {
            cols.iter().enumerate().map(|(i, name)| Ok((name.clone(), r.get::<_, rusqlite::types::Value>(i)?))).collect()
        }).unwrap()
    }
    #[test] fn migrates_an_empty_database_to_current_and_is_idempotent() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        assert_eq!(version(&c).unwrap(), CURRENT);
        migrate(&mut c).unwrap();                                            // second run is a no-op
        assert_eq!(tables(&c), ["ai_points", "ai_runs", "calibrations", "case_compare", "cases",
            "id_link_answers", "images", "landmark_events", "landmarks", "layout_anchors", "layout_candidates", "layout_machines", "layout_places", "layout_votes",
            "learning_record", "library_numbers", "model_licences", "operators", "patients", "settings", "user_norms", "xray_joins"]);
    }
    /// Owner ruling JOIN-HISTORY: the upgrade starts every X-ray's record (live or in Recently deleted) on the patient it
    /// is on, with that patient's new number (none while unnamed), marked "upgrade", all at one moment. Positive
    /// control: drop the backfill INSERT from `number_patients` and the record is empty.
    #[test] fn schema_11_starts_every_xrays_join_record_on_its_patient() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 10).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES
              ('named', 'Demo Named', 'demo named', '2026-01-01T00:00:00Z'), ('none', '', '~none', '2026-01-02T00:00:00Z');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at, deleted_at) VALUES
              ('c1', 'named', 'abc', 'T1', 'x', 'x', NULL), ('c2', 'named', 'abc', 'T2', 'y', 'y', '2026-01-03T00:00:00Z'),
              ('c3', 'none', 'abc', 'T1', 'z', 'z', NULL);").unwrap();
        migrate_to(&mut c, 11).unwrap();
        type Row = (String, String, Option<i64>, Option<i64>, String);
        let rows: Vec<Row> = c.prepare("SELECT case_id, patient_id, library_no, merged_from, how FROM xray_joins ORDER BY case_id").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).unwrap().collect::<Result<_, _>>().unwrap();
        let row = |c: &str, p: &str, n: Option<i64>| (c.to_string(), p.to_string(), n, None, "upgrade".to_string());
        assert_eq!(rows, [row("c1", "named", Some(1)), row("c2", "named", Some(1)), row("c3", "none", None)]);
        let moments: i64 = c.query_row("SELECT COUNT(DISTINCT joined_at) FROM xray_joins", [], |r| r.get(0)).unwrap();
        assert_eq!(moments, 1, "one moment: the upgrade");
    }
    /// Owner ruling L9-A: the give-back's column and join word are gone from format 11. Positive control: put
    /// `first_linked_at` back in 011 -> the first assert fails; put 'separated' back in the `how` list -> the second.
    #[test] fn schema_11_keeps_no_give_back_column_or_word() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        let linked: i64 = c.query_row("SELECT COUNT(*) FROM pragma_table_info('library_numbers') WHERE name = 'first_linked_at'", [], |r| r.get(0)).unwrap();
        assert_eq!(linked, 0, "library_numbers.first_linked_at is withdrawn");
        c.execute_batch("PRAGMA foreign_keys = OFF; INSERT INTO library_numbers (n, issued_at) VALUES (1, 'x');").unwrap();
        let separated = c.execute("INSERT INTO xray_joins (case_id, patient_id, library_no, joined_at, how) VALUES ('c', 'p', 1, 'x', 'separated')", []);
        assert!(separated.is_err(), "the join word 'separated' is withdrawn");
        assert_eq!(c.execute("INSERT INTO xray_joins (case_id, patient_id, library_no, joined_at, how) VALUES ('c', 'p', 1, 'x', 'merge')", []).unwrap(), 1);
    }
    #[test] fn refuses_a_library_from_a_newer_app() {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "user_version", CURRENT + 1).unwrap();
        assert!(migrate(&mut c).unwrap_err().to_string().contains("newer OpenCephAI"));
    }
    #[test] fn a_schema_1_library_with_cases_migrates_to_2_keeping_every_row() {
        let mut c = Connection::open_in_memory().unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        c.execute_batch(MIGRATIONS[0]).unwrap();
        c.pragma_update(None, "user_version", 1).unwrap();
        c.execute_batch("INSERT INTO patients VALUES ('p1', 'Smith, Jóhn', '2026-01-01T00:00:00.000Z');
            INSERT INTO images VALUES ('sha', 'png', 10, 10, 100, 'a.png', '2026-01-01T00:00:00.000Z');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p1', 'sha', 'T1', 'x', 'x');
            INSERT INTO landmarks VALUES ('c1', 'S', 1, 2, 'ai', 0, 1, 2, 0.9, 'x');").unwrap();
        migrate(&mut c).unwrap();
        assert_eq!(version(&c).unwrap(), CURRENT);
        let (key, dob, name): (String, Option<String>, String) =
            c.query_row("SELECT name_key, date_of_birth, display_name FROM patients WHERE id = 'p1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
        assert_eq!((key.as_str(), dob, name.as_str()), ("john smith", None, "Smith, Jóhn"));
        let (src, checked, pid, scan): (String, i64, String, Option<String>) = c.query_row(
            "SELECT identity_source, identity_checked, patient_id, scan_id FROM cases WHERE id = 'c1'", [], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!((src.as_str(), checked, pid.as_str(), scan), ("manual", 1, "p1", None));
        assert_eq!(c.query_row("SELECT COUNT(*) FROM landmarks", [], |r| r.get::<_, i64>(0)).unwrap(), 1);
        assert_eq!(c.query_row("PRAGMA foreign_keys", [], |r| r.get::<_, i64>(0)).unwrap(), 1);   // switched back on
        assert!(c.execute("INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c2', 'nobody', 'sha', 'T1', 'x', 'x')", []).is_err(),
            "references to patients are still enforced after the rebuild");
    }
    #[test] fn one_name_with_one_birth_date_is_one_patient_but_names_without_a_birth_date_may_repeat() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate(&mut c).unwrap();
        c.execute("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('a', 'Demo A', 'demo a', '1990-03-07', 'x')", []).unwrap();
        assert!(c.execute("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('b', 'DEMO A', 'demo a', '1990-03-07', 'x')", []).is_err());
        c.execute("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('c', 'Demo A', 'demo a', '1991-03-07', 'x')", []).unwrap();
        c.execute("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('d', 'Demo A', 'demo a', NULL, 'x')", []).unwrap();
        c.execute("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('e', 'Demo A', 'demo a', NULL, 'x')", []).unwrap();
    }
    /// Owner, 29 Sep: libraries upgraded by the first PR #11 builds hold names nobody confirmed that were guessed off the
    /// film ("J.Morita Miig") or taken from the file name ("Lateral Ceph"). Schema 3 blanks exactly those, each case on
    /// an unnamed patient of its own (keeping any date of birth); names read from a labelled field or confirmed stay.
    #[test] fn schema_3_blanks_unconfirmed_guessed_and_file_names_and_keeps_the_rest() {
        let mut c = Connection::open_in_memory().unwrap();
        for (i, sql) in MIGRATIONS.iter().take(2).enumerate() { c.execute_batch(sql).unwrap(); c.pragma_update(None, "user_version", i as i64 + 1).unwrap(); }
        c.execute_batch("INSERT INTO images VALUES ('sha', 'png', 10, 10, 100, 'a.png', 'x');
            INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES
              ('pg', 'J.Morita Miig', 'j morita miig', '2000-01-01', 'x'), ('pf', 'Lateral Ceph', 'lateral ceph', NULL, 'x'),
              ('pd', 'Demo Synthetic', 'demo synthetic', '1990-03-07', 'x'), ('pw', 'Week Three', 'week three', NULL, 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at, identity_source, identity_checked) VALUES
              ('g', 'pg', 'sha', 'T1', 'x', 'x', 'guess', 0), ('f1', 'pf', 'sha', 'T1', 'x', 'x', 'manual', 0),
              ('f2', 'pf', 'sha', 'T2', 'x', 'x', 'manual', 0), ('d', 'pd', 'sha', 'T1', 'x', 'x', 'film', 0),
              ('w', 'pw', 'sha', 'T1', 'x', 'x', 'manual', 1);").unwrap();   // SYNTHETIC
        migrate(&mut c).unwrap();
        assert_eq!(version(&c).unwrap(), CURRENT);
        let row = |id: &str| c.query_row("SELECT p.display_name, p.date_of_birth, c.timepoint, c.identity_source, c.patient_id FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1",
            [id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?, r.get::<_, String>(4)?))).unwrap();
        let (g, f1, f2, d, w) = (row("g"), row("f1"), row("f2"), row("d"), row("w"));
        assert_eq!((g.0.as_str(), g.1.as_deref(), g.2.as_str(), g.3.as_str()), ("", Some("2000-01-01"), "T1", "manual"));
        assert_eq!((f1.0.as_str(), f2.0.as_str(), f2.2.as_str()), ("", "", "T1"));
        assert!(f1.4 != f2.4, "two blanked cases are never the same patient");
        assert_eq!((d.0.as_str(), d.3.as_str(), w.0.as_str()), ("Demo Synthetic", "film", "Week Three"));
        let left: i64 = c.query_row("SELECT COUNT(*) FROM patients WHERE display_name IN ('J.Morita Miig', 'Lateral Ceph')", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0);
    }
    /// Spec 2026-10-04: schema 8 adds the patient's gender and referring practitioner, blank for every patient.
    #[test] fn schema_8_adds_blank_gender_and_referrer_and_keeps_every_patient() {
        let c = Connection::open_in_memory().unwrap();
        for (i, sql) in MIGRATIONS.iter().take(7).enumerate() { c.execute_batch(sql).unwrap(); c.pragma_update(None, "user_version", i as i64 + 1).unwrap(); }
        c.execute("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('p', 'Demo Synthetic', 'demo synthetic', '1990-03-07', 'x')", []).unwrap();   // SYNTHETIC
        // Final-review fix round (C4): schema 8 only ALTERs `patients`; a case row on that patient must survive
        // untouched too.
        c.execute_batch("INSERT INTO images VALUES ('sha', 'png', 10, 10, 100, 'a.png', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c', 'p', 'sha', 'T1', 'x', 'x');").unwrap();
        let before = case_row(&c, "c");   // whole row, every column, before schema 8 (it only ALTERs `patients`)
        // Migrates only to schema 8 (not `migrate`'s CURRENT, which by now may be newer): this test is about what
        // schema 8 itself does, so a later schema (e.g. 9's own `cases` column) must not change what it asserts.
        c.execute_batch(MIGRATIONS[7]).unwrap();
        c.pragma_update(None, "user_version", 8).unwrap();
        assert_eq!(version(&c).unwrap(), 8);
        let row: (String, Option<String>, Option<String>, Option<String>) = c.query_row(
            "SELECT display_name, date_of_birth, gender, referring_practitioner FROM patients WHERE id = 'p'", [],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap();
        assert_eq!(row, ("Demo Synthetic".to_string(), Some("1990-03-07".to_string()), None, None));   // SYNTHETIC
        let after = case_row(&c, "c");
        assert_eq!(before, after, "the whole case row on that patient must survive schema 8 unchanged, every column");
        assert!(c.execute("UPDATE patients SET gender = 'X' WHERE id = 'p'", []).is_err(), "only F, M or blank");
        c.execute("UPDATE patients SET gender = 'F', referring_practitioner = 'Dr Demo' WHERE id = 'p'", []).unwrap();
    }
    /// Spec 2026-10-06 (Part C, Task 4): schema 9 adds the case's chosen reference population (NULL = clinic
    /// default) and an empty `user_norms` table for the clinician's own norms.
    #[test] fn schema_9_adds_case_population_and_user_norms_and_keeps_every_row() {
        let mut c = Connection::open_in_memory().unwrap();
        for (i, sql) in MIGRATIONS.iter().take(8).enumerate() { c.execute_batch(sql).unwrap(); c.pragma_update(None, "user_version", i as i64 + 1).unwrap(); }
        c.execute("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('p', 'Demo Synthetic', 'demo synthetic', '1990-03-07', 'x')", []).unwrap();   // SYNTHETIC
        c.execute_batch("INSERT INTO images VALUES ('sha', 'png', 10, 10, 100, 'a.png', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c', 'p', 'sha', 'T1', 'x', 'x');").unwrap();
        let before = case_row(&c, "c");   // whole row, every column, before schema 9 (it only ADDs a column to `cases`)
        migrate_to(&mut c, 9).unwrap();
        assert_eq!(version(&c).unwrap(), 9);
        let after = case_row(&c, "c");
        let pop_before: Vec<(String, rusqlite::types::Value)> = before.into_iter().filter(|(n, _)| n != "population").collect();
        let (pop_after, pop_col): (Vec<_>, Vec<_>) = after.into_iter().partition(|(n, _)| n != "population");
        assert_eq!(pop_before, pop_after, "every existing case column must survive schema 9 unchanged");
        assert_eq!(pop_col, [("population".to_string(), rusqlite::types::Value::Null)], "a case from before schema 9 starts with no population (use the clinic default)");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM user_norms", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
    }

    /// Owner ruling SCHEMA10-A (15 Oct 2026; spec "Parked" P5, PARK-FLAGS): schema 10 adds which model placed each AI
    /// point, the weights fingerprint of each model run, and the learning record, and changes no existing row.
    #[test] fn schema_10_adds_the_learning_record_and_keeps_every_row() {
        let mut c = Connection::open_in_memory().unwrap();
        for (i, sql) in MIGRATIONS.iter().take(9).enumerate() { c.execute_batch(sql).unwrap(); c.pragma_update(None, "user_version", i as i64 + 1).unwrap(); }
        c.execute_batch("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('p', 'SYNTHETIC Demo', 'synthetic demo', '1990-03-07', 'x');   -- SYNTHETIC
            INSERT INTO images VALUES ('sha', 'png', 10, 10, 100, 'a.png', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c', 'p', 'sha', 'T1', 'x', 'x');
            INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, updated_at) VALUES ('c', 'S', 1, 2, 'ai', 0, 1, 2, 0.9, 'x');
            INSERT INTO ai_runs (case_id, model_id, execution_provider, facing, total_ms, ran_at) VALUES ('c', 'cwlachap-hrnet-w32', 'cpu', 'right', 1.0, 'x');
            INSERT INTO ai_points (run_id, channel, landmark_id, x, y, peak) VALUES (1, 0, 'S', 1, 2, 9.5);").unwrap();   // SYNTHETIC
        type Row = Vec<rusqlite::types::Value>;
        let all = |c: &Connection, sql: &str, n: usize| -> Row { c.query_row(sql, [], |r| (0..n).map(|i| r.get(i)).collect()).unwrap() };
        const LM: &str = "SELECT case_id, id, x, y, source, verified, ai_x, ai_y, confidence, updated_at FROM landmarks";
        const RUN: &str = "SELECT id, case_id, model_id, execution_provider, facing, total_ms, ran_at FROM ai_runs";
        const PT: &str = "SELECT run_id, channel, landmark_id, x, y, peak FROM ai_points";
        let (case_before, lm_before, run_before, pt_before) = (case_row(&c, "c"), all(&c, LM, 10), all(&c, RUN, 7), all(&c, PT, 6));
        migrate_to(&mut c, 10).unwrap();
        assert_eq!(version(&c).unwrap(), 10);
        assert_eq!(case_row(&c, "c"), case_before, "schema 10 does not touch `cases`");
        assert_eq!(all(&c, LM, 10), lm_before, "every old landmark column unchanged");
        assert_eq!(all(&c, RUN, 7), run_before, "every old ai_runs column unchanged");
        assert_eq!(all(&c, PT, 6), pt_before, "ai_points unchanged");
        let nulls: (Option<String>, Option<String>) = c.query_row("SELECT l.placed_by, r.model_sha256 FROM landmarks l, ai_runs r", [], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        assert_eq!(nulls, (None, None), "old rows have no placed_by and no model hash");
        let spread: i64 = c.query_row("SELECT COUNT(*) FROM pragma_table_info('ai_points') WHERE name LIKE 'cov_%'", [], |r| r.get(0)).unwrap();
        assert_eq!(spread, 0, "option A: no spreads are stored");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM learning_record", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
        let ins = |how: &str, placer: i64, assumed: i64, px: &str, mm: &str| format!(
            "INSERT INTO learning_record VALUES ('c', 'S', 'm-{how}-{placer}-{assumed}-{px}-{mm}', NULL, 'cpu', {px}, {mm}, {assumed}, 'unknown', '{how}', {placer}, 'Dr A', 'x')");
        assert!(c.execute(&ins("guessed", 0, 1, "1", "0.1"), []).is_err(), "only the three ways");
        assert!(c.execute(&ins("moved", 2, 1, "1", "0.1"), []).is_err(), "placer is 0 or 1");
        assert!(c.execute(&ins("moved", 0, 2, "1", "0.1"), []).is_err(), "mm_assumed is 0 or 1");
        assert!(c.execute(&ins("moved", 0, 1, "-1", "0.1"), []).is_err(), "no negative distance in px");
        assert!(c.execute(&ins("moved", 0, 1, "1", "-0.1"), []).is_err(), "no negative distance in mm");
        assert!(c.execute(&ins("moved", 0, 1, "NULL", "0.1"), []).is_err(), "no missing distance in px");
        assert!(c.execute(&ins("moved", 0, 1, "1", "NULL"), []).is_err(), "no missing distance in mm");
        // Task 10 item 1 (Task 9 review, Minor 1): a distance must be a finite number. SQLite reads 9e999 as +Inf and
        // binds a Rust NaN as NULL; both must be refused, written as SQL text and bound from Rust.
        assert!(c.execute(&ins("moved", 0, 1, "9e999", "0.1"), []).is_err(), "no infinite distance in px");
        assert!(c.execute(&ins("moved", 0, 1, "1", "9e999"), []).is_err(), "no infinite distance in mm");
        let bound = |px: f64, mm: f64| c.execute("INSERT INTO learning_record VALUES ('c', 'S', 'bound', NULL, 'cpu', ?1, ?2, 1, 'unknown', 'moved', 0, 'Dr A', 'x')",
            rusqlite::params![px, mm]);
        for (px, mm) in [(f64::INFINITY, 0.1), (1.0, f64::INFINITY), (f64::NAN, 0.1), (1.0, f64::NAN), (1e10, 0.1), (1.0, 1e10)] {
            assert!(bound(px, mm).is_err(), "bound ({px}, {mm}) must be refused");
        }
        assert_eq!(bound(1e9, 1e8).unwrap(), 1, "the largest allowed distance is stored");
        c.execute("DELETE FROM learning_record WHERE model_id = 'bound'", []).unwrap();
        c.execute(&ins("accepted-unmoved", 1, 1, "0", "0"), []).unwrap();
        c.execute(&ins("moved", 0, 0, "12.5", "1.25"), []).unwrap();
        c.execute(&ins("hand-placed", 0, 1, "3", "0.3"), []).unwrap();
        assert!(c.execute(&ins("moved", 0, 0, "12.5", "1.25"), []).is_err(), "one row per case, point and model");
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        assert!(c.execute("INSERT INTO learning_record VALUES ('nope', 'S', 'm', NULL, 'cpu', 1, 0.1, 1, 'unknown', 'moved', 0, 'Dr A', 'x')", []).is_err(), "no row for a case that does not exist");
        c.execute("DELETE FROM cases WHERE id = 'c'", []).unwrap();
        let left: i64 = c.query_row("SELECT COUNT(*) FROM learning_record", [], |r| r.get(0)).unwrap();
        assert_eq!(left, 0, "deleting a case removes its learning rows");
    }

    /// Spec 2026-10-17 (owner D-FIELDS-1, D-LEARN-1, 16 Oct 2026) as amended by addendum D2 (17 Oct): format 11 adds
    /// the Patient ID on each X-ray (Q8), X-ray type, X-ray dimensions and Radiography practice on the film, all blank,
    /// the Library ID numbers (LIBID-1), and widens the details a machine may learn. Every old row reads the same, and every learned place keeps its row number (the votes point at it).
    /// Positive control: the places have a GAP in their row numbers (1, 3), so a rebuild that renumbers them fails.
    #[test] fn schema_11_adds_blank_film_details_and_keeps_every_row_and_place_number() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 10).unwrap();
        c.execute_batch("INSERT INTO patients (id, display_name, name_key, date_of_birth, created_at) VALUES ('p', 'SYNTHETIC Demo', 'synthetic demo', '1990-03-07', 'x');
            INSERT INTO images VALUES ('sha', 'png', 10, 10, 100, 'a.png', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c', 'p', 'sha', 'T1', 'x', 'x');
            INSERT INTO layout_machines (id, name, width, height, created_at, updated_at) VALUES ('m', 'Machine 1', 10, 10, 'x', 'x');
            INSERT INTO layout_places (machine_id, field, row_y, side, starts, ends, count, updated_at) VALUES
              ('m', 'last', 0.06, 'left', 'line', 'comma', 3, 'x'), ('m', 'dob', 0.11, 'left', 'after:dob', 'end', 2, 'x'),
              ('m', 'scan_id', 0.14, 'left', 'after:pid', 'end', 1, 'x');
            DELETE FROM layout_places WHERE field = 'dob';
            INSERT INTO layout_votes (case_id, field, place) VALUES ('c', 'scan_id', 3);").unwrap();   // SYNTHETIC
        type Rows = Vec<Vec<rusqlite::types::Value>>;
        let rows = |c: &Connection, sql: &str| -> Rows {
            let mut q = c.prepare(sql).unwrap(); let n = q.column_count();
            q.query_map([], |r| (0..n).map(|i| r.get(i)).collect()).unwrap().collect::<Result<_, _>>().unwrap()
        };
        const PLACES: &str = "SELECT rowid, machine_id, field, row_y, side, starts, ends, count, updated_at FROM layout_places ORDER BY rowid";
        const PATIENT: &str = "SELECT id, display_name, name_key, date_of_birth, created_at, gender, referring_practitioner FROM patients";
        let (case_before, places_before, patient_before) = (case_row(&c, "c"), rows(&c, PLACES), rows(&c, PATIENT));
        migrate_to(&mut c, 11).unwrap();
        assert_eq!(version(&c).unwrap(), 11);
        let (old, new): (Vec<_>, Vec<_>) = case_row(&c, "c").into_iter()
            .partition(|(n, _)| !["printed_patient_id", "xray_type", "xray_size", "radiography_practice"].contains(&n.as_str()));
        assert_eq!(old, case_before, "every old case column unchanged");
        assert!(new.len() == 4 && new.iter().all(|(_, v)| *v == rusqlite::types::Value::Null), "{new:?}");
        let has = |t: &str, col: &str| c.query_row("SELECT COUNT(*) FROM pragma_table_info(?1) WHERE name = ?2", [t, col], |r| r.get::<_, i64>(0)).unwrap() == 1;
        assert!(!has("patients", "printed_patient_id"), "Q8: the Patient ID is on each X-ray, never on the patient");
        assert!(has("patients", "library_no"));
        assert_eq!(rows(&c, PATIENT), patient_before, "every old patient column unchanged");
        assert_eq!(rows(&c, PLACES), places_before, "every learned place, with its row number");
        let voted: i64 = c.query_row("SELECT COUNT(*) FROM layout_votes v JOIN layout_places p ON p.rowid = v.place", [], |r| r.get(0)).unwrap();
        assert_eq!(voted, 1, "the vote still points at its place");
        let place = |f: &str| c.execute("INSERT INTO layout_places (machine_id, field, row_y, side, starts, ends, count, updated_at)
                                          VALUES ('m', ?1, 0.2, 'left', 'line', 'end', 1, 'x')", [f]);
        for f in ["last", "first", "full", "dob", "film_date", "scan_id"] { place(f).unwrap(); }   // the six old details still accepted
        for f in ["patient_id", "xray_type", "xray_size", "practice", "gender", "referrer"] { place(f).unwrap(); }   // D2 Q6: gender/referrer learned
        assert!(place("shoe_size").is_err(), "only known details");
        // Every new column, its own 200-character limit: '' refused, 201 refused, 200 accepted (then put back to blank).
        let (long, max) = ("x".repeat(201), "x".repeat(200));
        for col in ["printed_patient_id", "xray_type", "xray_size", "radiography_practice"] {
            let set = |v: Option<&str>| c.execute(&format!("UPDATE cases SET {col} = ?1"), [v]);
            assert!(set(Some("")).is_err(), "cases.{col}: blank is stored as NULL, never ''");
            assert!(set(Some(&long)).is_err(), "cases.{col}: 201 characters must be refused");
            assert_eq!(set(Some(&max)).unwrap(), 1, "cases.{col}: 200 characters accepted");
            assert_eq!(set(None).unwrap(), 1, "cases.{col}: back to blank");
        }
    }

    /// LIBID-1 (17 Oct): every NAMED patient gets a Library ID in the order it was added (created_at, then rowid);
    /// an unnamed one gets none (L6 A); the counter then continues after the last. Positive control: the fixture's
    /// rowid order DIFFERS from its created_at order, so numbering by rowid fails.
    #[test] fn schema_11_numbers_every_named_patient_in_the_order_they_were_added() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 10).unwrap();
        c.execute_batch("INSERT INTO patients (id, display_name, name_key, created_at) VALUES
              ('late', 'Demo Late', 'demo late', '2026-02-01T00:00:00Z'),
              ('none', '', '~none', '2026-01-15T00:00:00Z'),
              ('early', 'Demo Early', 'demo early', '2026-01-01T00:00:00Z');").unwrap();
        migrate_to(&mut c, 11).unwrap();
        let no = |id: &str| c.query_row("SELECT library_no FROM patients WHERE id = ?1", [id], |r| r.get::<_, Option<i64>>(0)).unwrap();
        assert_eq!((no("early"), no("late"), no("none")), (Some(1), Some(2), None));
        let issued: Vec<(i64, String)> = c.prepare("SELECT n, issued_at FROM library_numbers ORDER BY n").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(issued, [(1, "2026-01-01T00:00:00Z".to_string()), (2, "2026-02-01T00:00:00Z".to_string())]);
        c.execute("INSERT INTO library_numbers (issued_at) VALUES ('x')", []).unwrap();
        assert_eq!(c.last_insert_rowid(), 3, "the counter continues after the backfill");
    }
    /// A name of only tabs or line breaks is no name (Rust `trim`, as `settle_after_move` judges it; SQL `trim()` strips
    /// only spaces), and a floor (a restore over a library that had issued numbers: review I1) numbers above it while
    /// every number up to it becomes known and held by nobody.
    #[test] fn schema_11_skips_a_whitespace_only_name_and_numbers_above_a_floor() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 10).unwrap();
        c.execute_batch("INSERT INTO patients (id, display_name, name_key, created_at) VALUES
              ('tab', char(9, 10), '~tab', '2026-01-01T00:00:00Z'),
              ('named', 'Demo Named', 'demo named', '2026-01-02T00:00:00Z');").unwrap();
        migrate_to_above(&mut c, 11, 5).unwrap();
        let no = |id: &str| c.query_row("SELECT library_no FROM patients WHERE id = ?1", [id], |r| r.get::<_, Option<i64>>(0)).unwrap();
        assert_eq!((no("tab"), no("named")), (None, Some(6)));
        let known: Vec<i64> = c.prepare("SELECT n FROM library_numbers ORDER BY n").unwrap().query_map([], |r| r.get(0)).unwrap()
            .collect::<Result<_, _>>().unwrap();
        assert_eq!(known, [1, 2, 3, 4, 5, 6]);
    }
}
