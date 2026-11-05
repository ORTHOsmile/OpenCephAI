use rusqlite::{params, Connection, Transaction};

/// Numbered migrations; entry i takes `PRAGMA user_version` from i to i + 1. Never edit a shipped entry: append. (011 was
/// amended four times, before any release — addendum D2, then owner ruling JOIN-HISTORY in two steps, 17 Oct, then
/// owner ruling L9-A, 18 Oct; `check_shape` refuses all four earlier versions; 012, request G, appended 18 Oct;
/// 013, title and film age, appended 19 Oct; 014, Part F and the chain's format (Part F, cross-check, Tier 3), appended 27 Oct;
/// 015, Automatic best (`placed_via`, its change record), appended 27 Oct; 016, the Library's Report column
/// (`cases.report_saved_at`), appended 29 Oct; 017, held for Tier 3 Stage A and changing nothing, and 018, the norms Auto
/// population (`patients.background`, `population_switches`, old "Clinic default" cases switched to Auto), appended 2 Nov;
/// 019, Stage A′'s point check (`point_check_runs`, `point_checks`, `point_check_resolutions`; flag-only), appended 2 Nov)
pub const MIGRATIONS: &[&str] = &[include_str!("../migrations/001_init.sql"), include_str!("../migrations/002_patient_identity.sql"),
    include_str!("../migrations/003_blank_unread_names.sql"), include_str!("../migrations/004_film_layouts.sql"),
    include_str!("../migrations/005_timepoints_by_film_date.sql"),
    include_str!("../migrations/006_series.sql"), include_str!("../migrations/007_models.sql"),
    include_str!("../migrations/008_patient_gender_referrer.sql"), include_str!("../migrations/009_norms.sql"),
    include_str!("../migrations/010_learning_record.sql"), include_str!("../migrations/011_film_details.sql"),
    include_str!("../migrations/012_film_fits.sql"), include_str!("../migrations/013_title_and_film_age.sql"),
    include_str!("../migrations/014_part_f.sql"), include_str!("../migrations/015_auto_best.sql"),
    include_str!("../migrations/016_report_saved.sql"), include_str!("../migrations/017_reserved_tier3_stage_a.sql"),
    include_str!("../migrations/018_norms_auto_population.sql"), include_str!("../migrations/019_point_check.sql")];
pub const CURRENT: i64 = MIGRATIONS.len() as i64;

/// Shown, and the library not opened or changed, when it was written by any withdrawn format 11 (addendum D2, L7 A;
/// owner ruling JOIN-HISTORY).
pub const SUPERSEDED_11: &str = "This library was opened by a test version of OpenCephAI whose format was changed before release. \
It has not been changed. Restore the safety copy in the library's \"upgrade-backups\" folder (made before that upgrade).";

/// Final review I4 (2 Nov 2026): a format-18 library made by a test build whose 018 did not yet record its upgrades.
pub const SUPERSEDED_18: &str = "This library was opened by a test version of OpenCephAI whose format 18 was changed before release. \
It has not been changed. Restore the safety copy in the library's \"upgrade-backups\" folder (made before that upgrade).";

/// SHA-256 (hex) of the upgrade this app runs to reach `version` (1-based). From format 18 the library records it for
/// every format it passes (`applied_migrations`), so a later app whose upgrade at an already-passed format is a
/// different file is refused rather than skipped (final review I4: format 17 is a placeholder; Tier 3 appends after 18).
pub fn migration_sha(version: i64) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(MIGRATIONS[(version - 1) as usize].as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Records the upgrade that took the library to `version`, once the record exists (format 18 on); at 18 it also records
/// 17, which ran before the record existed.
fn record_applied(tx: &Transaction, version: i64) -> anyhow::Result<()> {
    if version < 18 { return Ok(()); }
    if version == 18 { tx.execute("INSERT OR REPLACE INTO applied_migrations (version, sha256) VALUES (17, ?1)", [migration_sha(17)])?; }
    tx.execute("INSERT OR REPLACE INTO applied_migrations (version, sha256) VALUES (?1, ?2)", params![version, migration_sha(version)])?;
    Ok(())
}

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

/// Refuses a library written by a newer OpenCephAI. `knows` is this app's own format (`CURRENT`); a test passes an
/// older one to stand in for an app release that knew fewer formats (format 13: an app that knows 12 refuses it).
pub(crate) fn ensure_known(v: i64, knows: i64) -> anyhow::Result<()> {
    anyhow::ensure!(v <= knows, "this library was written by a newer OpenCephAI (schema {v}, this app knows {knows}); update the app");
    Ok(())
}

/// `migrate_to`, with migration 11 numbering patients above `floor` (review I1, ruling A: a backup from before format 11,
/// restored over a library that had issued numbers up to `floor`, never re-issues any of them). Production passes 0
/// except from `Library::restore_backup`.
pub(crate) fn migrate_to_above(conn: &mut Connection, target: i64, floor: i64) -> anyhow::Result<()> {
    let v = version(conn)?;
    ensure_known(v, CURRENT)?;
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
            record_applied(&tx, (i + 1) as i64)?;
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
    check_applied(conn)
}

/// Final review I4 (2 Nov 2026): from format 18, every format the library passed must have been reached by the same
/// upgrade this app has for it; otherwise the library is refused, unchanged — never a format silently skipped.
fn check_applied(conn: &Connection) -> anyhow::Result<()> {
    let v = version(conn)?;
    if !(18..=CURRENT).contains(&v) { return Ok(()); }   // older: nothing recorded yet; newer: `ensure_known` refuses it
    let has: i64 = conn.query_row("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'applied_migrations'", [], |r| r.get(0))?;
    anyhow::ensure!(has == 1, SUPERSEDED_18);
    let rows: Vec<(i64, String)> = conn.prepare("SELECT version, sha256 FROM applied_migrations ORDER BY version")?
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?.collect::<Result<_, _>>()?;
    for (n, sha) in rows {
        if n > CURRENT { continue; }   // a newer app's format: `ensure_known` refuses the library
        anyhow::ensure!(sha == migration_sha(n), "This library's format {n} was made by an upgrade this version of OpenCephAI \
does not have. It has not been changed, so nothing is skipped. Update OpenCephAI, or restore the library's safety copy from before that upgrade.");
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
        assert_eq!(tables(&c), ["ai_points", "ai_runs", "applied_migrations", "auto_best_events", "calibrations", "case_compare", "cases", "film_fits",
            "id_link_answers", "images", "landmark_events", "landmarks", "layout_anchors", "layout_candidates", "layout_machines", "layout_places", "layout_votes",
            "learning_record", "library_numbers", "model_licences", "operators", "patients", "personal_model_events", "personal_models", "point_check_resolutions", "point_check_runs", "point_checks", "point_choices", "population_switches",
            "settings", "user_norms", "weights_check", "weights_check_films", "xray_joins"]);
    }
    /// Every row of every table, as "table|values…", ordered: format 12 must change none of them.
    fn all_rows(c: &Connection) -> Vec<String> {
        tables(c).iter().flat_map(|t| {
            let mut q = c.prepare(&format!("SELECT * FROM \"{t}\" ORDER BY rowid")).unwrap();
            let n = q.column_count();
            q.query_map([], |r| Ok(format!("{t}|{}", (0..n).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|"))))
                .unwrap().collect::<Result<Vec<_>, _>>().unwrap()
        }).collect()
    }
    /// Format 12 (spec 2026-10-17 G; owner G1–G3): an empty `film_fits` table; every row already stored unchanged; the
    /// table refuses what a fit can never be. Positive control: append `UPDATE cases SET spacing_mm = NULL;` to 012 and
    /// "every old row unchanged" fails.
    #[test] fn schema_12_adds_an_empty_fit_table_and_keeps_every_row() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 11).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p', 'Demo Fit', 'demo fit', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at, spacing_mm) VALUES
              ('r', 'p', 'abc', 'T1', 'x', 'x', 0.1), ('f', 'p', 'abc', 'T2', 'y', 'y', NULL);
            INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, updated_at) VALUES ('f', 'S', 11, 12, 'manual', 1, NULL, NULL, NULL, 'x');").unwrap();
        let before = all_rows(&c);
        assert!(before.len() >= 5, "the instrument compares {} rows", before.len());
        migrate_to(&mut c, 12).unwrap();
        assert_eq!(version(&c).unwrap(), 12);
        let after: Vec<String> = all_rows(&c).into_iter().filter(|r| !r.starts_with("film_fits|")).collect();
        assert_eq!(after, before, "every old row unchanged");
        let n: i64 = c.query_row("SELECT COUNT(*) FROM film_fits", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "the table starts empty");
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        let ins = |case: &str, refc: &str, kind: &str, scale: f64, mirror: i64, own: i64| c.execute(
            "INSERT INTO film_fits (case_id, ref_case_id, ref_kind, ref_x1, ref_y1, ref_x2, ref_y2, film_x1, film_y1, film_x2, film_y2,
                                    mirror, scale, rotation, dx, dy, use_own, saved_by, saved_at)
             VALUES (?1, ?2, ?3, 0, 0, 100, 0, 0, 0, 96, 0, ?5, ?4, 0.1, 1, -1, ?6, 'Dr Demo', 'x')",
            rusqlite::params![case, refc, kind, scale, mirror, own]);
        for (why, r) in [("to itself", ins("f", "f", "sn", 1.0, 0, 0)), ("unknown kind", ins("f", "r", "ruler", 1.0, 0, 0)),
                         ("too small", ins("f", "r", "sn", 0.19, 0, 0)), ("too large", ins("f", "r", "sn", 5.01, 0, 0)),
                         ("not a number (binds as NULL)", ins("f", "r", "sn", f64::NAN, 0, 0)), ("mirror 2", ins("f", "r", "sn", 1.0, 2, 0)),
                         ("use_own 2", ins("f", "r", "sn", 1.0, 0, 2)), ("no such film", ins("nope", "r", "sn", 1.0, 0, 0))] {
            assert!(r.is_err(), "{why} must be refused");
        }
        assert_eq!(ins("f", "r", "points", 1.04, 0, 0).unwrap(), 1, "a good fit is accepted");
        assert!(ins("f", "r", "sn", 1.0, 0, 0).is_err(), "one fit per film");
        c.execute("DELETE FROM cases WHERE id = 'r'", []).unwrap();
        let n: i64 = c.query_row("SELECT COUNT(*) FROM film_fits", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0, "removing the reference film's row for good removes the fit (ON DELETE CASCADE)");
    }
    /// A format-12 database (foreign keys ON, as the library opens) with patient `p` and two films: `r` (the reference)
    /// and `f` (the film to fit).
    fn fit_db() -> Connection {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 12).unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p', 'Demo Fit', 'demo fit', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES
              ('r', 'p', 'abc', 'T1', 'x', 'x'), ('f', 'p', 'abc', 'T2', 'y', 'y');").unwrap();
        c
    }
    /// Inserts a good fit of film `f` to `r`, with column `col` set to `v` instead.
    fn fit_with(c: &Connection, col: &str, v: rusqlite::types::Value) -> rusqlite::Result<usize> {
        use rusqlite::types::Value::{Integer, Real, Text};
        let mut row: Vec<(&str, rusqlite::types::Value)> = vec![
            ("case_id", Text("f".into())), ("ref_case_id", Text("r".into())), ("ref_kind", Text("sn".into())),
            ("ref_x1", Real(0.0)), ("ref_y1", Real(0.0)), ("ref_x2", Real(100.0)), ("ref_y2", Real(0.0)),
            ("film_x1", Real(0.0)), ("film_y1", Real(0.0)), ("film_x2", Real(96.0)), ("film_y2", Real(0.0)),
            ("mirror", Integer(0)), ("scale", Real(1.04)), ("rotation", Real(0.1)), ("dx", Real(1.0)), ("dy", Real(-1.0)),
            ("use_own", Integer(0)), ("saved_by", Text("Dr Demo".into())), ("saved_at", Text("x".into()))];
        let slot = row.iter_mut().find(|(n, _)| *n == col).unwrap_or_else(|| panic!("no column {col}"));
        slot.1 = v;
        let names: Vec<&str> = row.iter().map(|(n, _)| *n).collect();
        let marks: Vec<String> = (1..=row.len()).map(|i| format!("?{i}")).collect();
        c.execute(&format!("INSERT INTO film_fits ({}) VALUES ({})", names.join(", "), marks.join(", ")),
            rusqlite::params_from_iter(row.into_iter().map(|(_, v)| v)))
    }
    /// Task 4 fix round 1, M1 (ruling, 19 Oct: overrides the brief's verbatim 012): a fit always belongs to a
    /// film. SQLite lets a TEXT primary key hold NULL unless it is declared NOT NULL; a NULL `case_id` would need no
    /// film, pass the self-reference CHECK and break "one fit per film". Red before `NOT NULL` was added: accepted.
    #[test] fn schema_12_refuses_a_fit_that_belongs_to_no_film() {
        let c = fit_db();
        assert!(fit_with(&c, "case_id", rusqlite::types::Value::Null).is_err(), "a fit with no film (case_id NULL) must be refused");
        assert!(fit_with(&c, "case_id", rusqlite::types::Value::Null).is_err(), "and a second one too");
        let n: i64 = c.query_row("SELECT COUNT(*) FROM film_fits", [], |r| r.get(0)).unwrap();
        assert_eq!(n, 0);
        assert_eq!(fit_with(&c, "case_id", rusqlite::types::Value::Text("f".into())).unwrap(), 1, "the same fit with its film is accepted");
    }
    /// Task 4 fix round 1, M2 (D-e): removing a film's row for good removes its fit, whichever of the two films it is.
    /// Without the cascade the delete would fail ("FOREIGN KEY constraint failed") and `purge_deleted`, run on every
    /// open, would stop the library opening. Positive control: drop either `ON DELETE CASCADE` and its half fails.
    #[test] fn schema_12_removing_either_films_row_removes_the_fit() {
        let count = |c: &Connection| c.query_row("SELECT COUNT(*) FROM film_fits", [], |r| r.get::<_, i64>(0)).unwrap();
        let c = fit_db();
        assert_eq!(fit_with(&c, "case_id", rusqlite::types::Value::Text("f".into())).unwrap(), 1);
        c.execute("DELETE FROM cases WHERE id = 'f'", []).expect("the fitted film's row can be removed for good");
        assert_eq!(count(&c), 0, "removing the fitted film's row removes its fit (case_id ON DELETE CASCADE)");
        let c = fit_db();
        assert_eq!(fit_with(&c, "case_id", rusqlite::types::Value::Text("f".into())).unwrap(), 1);
        c.execute("DELETE FROM cases WHERE id = 'r'", []).expect("the reference film's row can be removed for good");
        assert_eq!(count(&c), 0, "removing the reference film's row removes the fit (ref_case_id ON DELETE CASCADE)");
    }
    /// Task 4 fix round 1, M3: the input limits on the turn, the shift and the eight point coordinates. Each is refused
    /// just past its limit (both signs), at infinity, and as NaN (binds as NULL); each is accepted AT its limit.
    /// Positive control: loosen any one CHECK and the line naming that column fails.
    #[test] fn schema_12_refuses_a_turn_a_shift_or_a_point_out_of_range() {
        use rusqlite::types::Value::Real;
        let c = fit_db();
        let limits = [("rotation", 4.0), ("dx", 1e6), ("dy", 1e6), ("ref_x1", 1e6), ("ref_y1", 1e6), ("ref_x2", 1e6), ("ref_y2", 1e6),
                      ("film_x1", 1e6), ("film_y1", 1e6), ("film_x2", 1e6), ("film_y2", 1e6)];
        let mut tried = 0;
        for (col, lim) in limits {
            for v in [lim * 1.0001, -lim * 1.0001, f64::INFINITY, f64::NEG_INFINITY, f64::NAN] {
                assert!(fit_with(&c, col, Real(v)).is_err(), "{col} = {v} must be refused");
                tried += 1;
            }
            for v in [lim, -lim] {
                assert_eq!(fit_with(&c, col, Real(v)).unwrap(), 1, "{col} = {v} (at the limit) is accepted");
                c.execute("DELETE FROM film_fits", []).unwrap();
            }
        }
        println!("M3: {tried} out-of-range values refused across {} columns", limits.len());
        assert_eq!(tried, 55);
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

    /// Every table's columns before an upgrade: what the upgrade must keep.
    fn shape(c: &Connection) -> Vec<(String, Vec<String>)> {
        tables(c).into_iter().map(|t| {
            let cols = c.prepare(&format!("SELECT name FROM pragma_table_info('{t}')")).unwrap()
                .query_map([], |r| r.get(0)).unwrap().collect::<Result<Vec<String>, _>>().unwrap();
            (t, cols)
        }).collect()
    }
    /// Every row of every table in `shape`, reading only `shape`'s columns, by rowid.
    fn rows_in(c: &Connection, shape: &[(String, Vec<String>)]) -> Vec<String> {
        shape.iter().flat_map(|(t, cols)| {
            let list = cols.iter().map(|n| format!("\"{n}\"")).collect::<Vec<_>>().join(", ");
            let mut q = c.prepare(&format!("SELECT {list} FROM \"{t}\" ORDER BY rowid")).unwrap();
            let n = q.column_count();
            q.query_map([], |r| Ok(format!("{t}|{}", (0..n).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|"))))
                .unwrap().collect::<Result<Vec<_>, _>>().unwrap()
        }).collect()
    }
    /// Format 13 (spec 2026-10-19; owner T1, AG1): blank title and film age; every row already stored unchanged
    /// (task-8-review I1: including a learned machine, a fit and a numbered patient — the tables MS-1 can touch).
    /// Positive control: append `UPDATE patients SET gender = NULL;` to 013 -> "every old row unchanged" fails.
    #[test] fn schema_13_adds_blank_title_and_film_age_and_keeps_every_row() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 12).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at, date_of_birth, gender, referring_practitioner)
              VALUES ('p', 'Demo Title', 'demo title', 'x', '1990-03-07', 'F', 'Dr Demo');   -- SYNTHETIC
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at, spacing_mm, printed_patient_id) VALUES
              ('r', 'p', 'abc', 'T1', 'x', 'x', 0.1, '5566'), ('f', 'p', 'abc', 'T2', 'y', 'y', NULL, NULL);
            INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, updated_at) VALUES ('f', 'S', 11, 12, 'manual', 1, NULL, NULL, NULL, 'x');
            INSERT INTO layout_machines (id, name, width, height, films, created_at, updated_at) VALUES ('m1', 'Demo Radiology', 400, 300, 1, 'x', 'x');
            UPDATE cases SET layout_machine_id = 'm1' WHERE id = 'r';
            INSERT INTO layout_places (machine_id, field, row_y, side, starts, ends, count, updated_at)
              VALUES ('m1', 'last', 0.1, 'left', 'a', 'z', 1, 'x');
            INSERT INTO layout_votes (case_id, field, place) VALUES ('r', 'last', 1);
            INSERT INTO film_fits (case_id, ref_case_id, ref_kind, ref_x1, ref_y1, ref_x2, ref_y2, film_x1, film_y1, film_x2, film_y2,
                                   mirror, scale, rotation, dx, dy, use_own, saved_by, saved_at)
              VALUES ('f', 'r', 'sn', 10, 10, 20, 20, 10, 10, 20, 20, 0, 1.0, 0.0, 0, 0, 0, 'Dr A', 'x');
            INSERT INTO library_numbers (issued_at) VALUES ('x');
            UPDATE patients SET library_no = (SELECT MAX(n) FROM library_numbers) WHERE id = 'p';
            INSERT INTO xray_joins (case_id, patient_id, library_no, joined_at, how)
              VALUES ('r', 'p', (SELECT MAX(n) FROM library_numbers), 'x', 'upgrade');").unwrap();
        let (sh, before) = (shape(&c), rows_in(&c, &shape(&c)));
        println!("12→13: comparing {} rows", before.len());
        assert!(before.len() >= 11, "the instrument compares rows: {before:#?}");
        migrate_to(&mut c, 13).unwrap();
        assert_eq!(version(&c).unwrap(), 13);
        assert_eq!(rows_in(&c, &sh), before, "every old row unchanged");
        let blank: i64 = c.query_row("SELECT (SELECT COUNT(*) FROM patients WHERE title IS NULL) + (SELECT COUNT(*) FROM cases WHERE age_on_film IS NULL AND age_on_film_years IS NULL)", [], |r| r.get(0)).unwrap();
        assert_eq!(blank, 3, "one patient and two films, every new value blank");
        assert_eq!(tables(&c), sh.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>(), "no table added or removed");
    }
    /// The library refuses what a title or a film age can never be (011's length rule; the age's range and its pair).
    /// Positive control: drop each CHECK of 013 in turn -> the line naming it fails.
    #[test] fn schema_13_refuses_what_a_title_or_a_film_age_can_never_be() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 13).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p', 'Demo Age', 'demo age', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('f', 'p', 'abc', 'T1', 'x', 'x');").unwrap();
        let title = |v: Option<String>| c.execute("UPDATE patients SET title = ?1 WHERE id = 'p'", [v]);
        assert!(title(Some(String::new())).is_err(), "an empty title");
        assert!(title(Some("x".repeat(201))).is_err(), "a 201-character title");
        assert_eq!(title(Some("x".repeat(200))).unwrap(), 1, "200 characters fit (as 011)");
        assert_eq!(title(None).unwrap(), 1, "blank clears");
        let age = |t: Option<&str>, y: Option<f64>| c.execute("UPDATE cases SET age_on_film = ?1, age_on_film_years = ?2 WHERE id = 'f'", rusqlite::params![t, y]);
        for (why, r) in [("empty text", age(Some(""), Some(11.0))), ("201 characters", age(Some(&"1".repeat(201)), Some(11.0))),
                         ("zero years", age(Some("000Y"), Some(0.0))), ("negative", age(Some("-1"), Some(-1.0))),
                         ("over 120", age(Some("121Y"), Some(120.0001))), ("NaN (binds as NULL) with text", age(Some("011Y"), Some(f64::NAN))),
                         ("text without years", age(Some("011Y"), None)), ("years without text", age(None, Some(11.0))),
                         ("infinite", age(Some("011Y"), Some(f64::INFINITY)))] {
            assert!(r.is_err(), "{why} must be refused");
        }
        assert_eq!(age(Some("011Y"), Some(11.0)).unwrap(), 1);
        assert_eq!(age(Some("120Y"), Some(120.0)).unwrap(), 1, "120 years is the limit, accepted");
        assert_eq!(age(None, None).unwrap(), 1, "both blank clears");
    }
    /// Format 13 (spec 2026-10-20 MS1–MS4): a machine's calibrated scale, five columns, all blank on every old machine;
    /// every old machine row unchanged. Positive control: append `UPDATE layout_machines SET films = 0;` to 013 ->
    /// "every old row unchanged" fails.
    #[test] fn schema_13_gives_every_old_machine_a_blank_scale_and_keeps_its_row() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 12).unwrap();
        c.execute_batch("INSERT INTO layout_machines (id, name, named_by_user, width, height, films, created_at, updated_at)
                           VALUES ('m1', 'Demo Radiology', 1, 2400, 3000, 7, 'x', 'y'), ('m2', 'Machine 2', 0, 400, 300, 1, 'x', 'y');").unwrap();
        let (sh, before) = (shape(&c), rows_in(&c, &shape(&c)));
        println!("12→13 machines: comparing {} rows", before.len());
        assert!(before.len() >= 2, "the instrument compares rows: {before:#?}");
        migrate_to(&mut c, 13).unwrap();
        assert_eq!(rows_in(&c, &sh), before, "every old row unchanged");
        let blank: i64 = c.query_row("SELECT COUNT(*) FROM layout_machines WHERE spacing_mm IS NULL AND width_px IS NULL AND height_px IS NULL
                                      AND scale_source IS NULL AND scale_set_at IS NULL", [], |r| r.get(0)).unwrap();
        assert_eq!(blank, 2, "both machines start with no scale");
    }
    /// The library refuses a machine scale that can never be: not > 0, not finite, a size that is not a whole number of
    /// pixels > 0, a source that is neither "entered" nor "film:<id>", or only some of the five set. Positive control:
    /// drop each CHECK in turn -> the line naming it fails.
    #[test] fn schema_13_refuses_a_machine_scale_that_can_never_be() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 13).unwrap();
        c.execute_batch("INSERT INTO layout_machines (id, name, width, height, created_at, updated_at) VALUES ('m', 'Machine 1', 2400, 3000, 'x', 'x');").unwrap();
        let set = |s: Option<f64>, w: rusqlite::types::Value, h: rusqlite::types::Value, src: Option<&str>, at: Option<&str>|
            c.execute("UPDATE layout_machines SET spacing_mm = ?1, width_px = ?2, height_px = ?3, scale_source = ?4, scale_set_at = ?5 WHERE id = 'm'",
                rusqlite::params![s, w, h, src, at]);
        use rusqlite::types::Value::{Integer as I, Real as R, Text as T, Null as N};
        for (why, r) in [
            ("zero mm", set(Some(0.0), I(2400), I(3000), Some("entered"), Some("x"))),
            ("negative mm", set(Some(-0.1), I(2400), I(3000), Some("entered"), Some("x"))),
            ("infinite mm", set(Some(f64::INFINITY), I(2400), I(3000), Some("entered"), Some("x"))),
            ("NaN mm (binds as NULL) with the rest set", set(Some(f64::NAN), I(2400), I(3000), Some("entered"), Some("x"))),
            ("zero width", set(Some(0.1), I(0), I(3000), Some("entered"), Some("x"))),
            ("fractional height", set(Some(0.1), I(2400), R(3000.5), Some("entered"), Some("x"))),
            ("height as text", set(Some(0.1), I(2400), T("3000 px".into()), Some("entered"), Some("x"))),
            ("unknown source", set(Some(0.1), I(2400), I(3000), Some("ruler"), Some("x"))),
            ("film: with no id", set(Some(0.1), I(2400), I(3000), Some("film:"), Some("x"))),
            ("no set time", set(Some(0.1), I(2400), I(3000), Some("entered"), None)),
            ("size without mm", set(None, I(2400), I(3000), None, None)),
        ] { assert!(r.is_err(), "{why} must be refused"); }
        assert_eq!(set(Some(0.1), I(2400), I(3000), Some("entered"), Some("x")).unwrap(), 1);
        assert_eq!(set(Some(0.0998), I(2400), I(3000), Some("film:c1"), Some("x")).unwrap(), 1);
        assert_eq!(set(None, N, N, None, None).unwrap(), 1, "all five blank: no scale");
    }
    /// Owner rule for every format: an app that knows 12 refuses a format-13 library. Positive control: make
    /// `ensure_known` return Ok always -> this fails.
    #[test] fn an_app_that_knows_12_refuses_a_format_13_library() {
        let e = ensure_known(13, 12).unwrap_err().to_string();
        assert_eq!(e, "this library was written by a newer OpenCephAI (schema 13, this app knows 12); update the app");
        ensure_known(12, 12).unwrap();
        ensure_known(13, 13).unwrap();
    }
    /// Format 14 (chain spec §4; Part F plan Task 4): five empty tables (three for S1, two for S3), `landmarks.accept_kind`
    /// and the learning row's scale, blank on every old row; every row already stored unchanged. Positive control: append
    /// `UPDATE learning_record SET dist_mm = 0;` to 014 → "every old row unchanged" fails.
    #[test] fn schema_14_adds_part_f_and_tier_3_tables_empty_and_keeps_every_row() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 13).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at, title) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x', 'Dr');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at, spacing_mm, age_on_film, age_on_film_years)
              VALUES ('c1', 'p', 'abc', 'T1', 'x', 'x', 0.1, '011Y', 11.0);
            INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, placed_by, updated_at)
              VALUES ('c1', 'S', 11, 12, 'ai', 1, 11, 12, 0.9, 'aariz-cepha29', 'x'), ('c1', 'N', 1, 2, 'manual', 1, NULL, NULL, NULL, NULL, 'x');
            INSERT INTO learning_record VALUES ('c1', 'S', 'aariz-cepha29', NULL, 'cpu', 10, 1, 0, 'unknown', 'accepted-unmoved', 1, 'Dr A', 'x');
            INSERT INTO layout_machines (id, name, width, height, films, created_at, updated_at, spacing_mm, width_px, height_px, scale_source, scale_set_at)
              VALUES ('m1', 'Demo Radiology', 400, 300, 1, 'x', 'x', 0.11, 400, 300, 'entered', 'x');
            INSERT INTO settings (key, value) VALUES ('main_model', 'aariz-cepha29');").unwrap();
        let (sh, before) = (shape(&c), rows_in(&c, &shape(&c)));
        println!("13→14: comparing {} rows", before.len());
        assert!(before.len() >= 8, "the instrument compares rows: {before:#?}");
        migrate_to(&mut c, 14).unwrap();
        assert_eq!(version(&c).unwrap(), 14);
        assert_eq!(rows_in(&c, &sh), before, "every old row unchanged");
        for t in ["point_choices", "weights_check_films", "weights_check", "personal_models", "personal_model_events"] {
            assert_eq!(c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get::<_, i64>(0)).unwrap(), 0, "{t} starts empty");
        }
        let blank: i64 = c.query_row("SELECT (SELECT COUNT(*) FROM landmarks WHERE accept_kind IS NULL)
            + (SELECT COUNT(*) FROM learning_record WHERE mm_per_px IS NULL AND scale_source IS NULL)", [], |r| r.get(0)).unwrap();
        assert_eq!(blank, 3, "two points and one learning row, every new value blank");
    }
    /// The library refuses what an answer, an accept kind, a learning row's scale or a Tier 3 row can never be, and never
    /// changes or removes an answer or a Tier 3 row. Positive control: drop each CHECK or trigger of 014 in turn → the
    /// line naming it fails.
    #[test] fn schema_14_refuses_what_its_rows_can_never_be() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 14).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p', 'abc', 'T1', 'x', 'x');").unwrap();
        // point_choices: the owner's answers
        let ins = |action: &str, last: &str, basis: &str, numbers: &str| c.execute(&format!(
            "INSERT INTO point_choices (landmark_id, model_id, action, rule_version, last_imported_at, last_case_id, basis, numbers, operator, at)
             VALUES ('Go', 'srpose-cldet23', '{action}', 'best-point/3', {last}, {basis}, '{numbers}', 'Dr A', 'x')"), []);
        assert!(ins("accepted", "'2026-01-01T00:59:00.000Z', 'c059'", "'mm, 60 ruler films'", "{\"films\":60}").is_ok());
        assert!(ins("declined", "'t', 'c'", "'mm, 60 ruler films'", "{}").is_ok());
        assert!(ins("undone", "NULL, NULL", "NULL", "{}").is_ok());
        assert!(ins("maybe", "'t', 'c'", "'b'", "{}").is_err(), "an unknown answer");
        assert!(ins("accepted", "NULL, NULL", "'b'", "{}").is_err(), "an acceptance names the films it was given on");
        assert!(ins("accepted", "'t', 'c'", "NULL", "{}").is_err(), "an acceptance names the films that decided");
        assert!(ins("undone", "'t', 'c'", "NULL", "{}").is_err(), "an undo names no films");
        assert!(ins("undone", "NULL, NULL", "'b'", "{}").is_err(), "an undo names no basis");
        assert!(ins("accepted", "'t', 'c'", "'b'", "not json").is_err(), "numbers must be JSON");
        assert!(c.execute("UPDATE point_choices SET model_id = 'gu2net-isbi19'", []).is_err(), "never changed");
        assert!(c.execute("DELETE FROM point_choices", []).is_err(), "never removed");
        // the weights check (owner Q4)
        assert!(c.execute("INSERT INTO weights_check_films VALUES ('srpose-cldet23', 'fp', 'c1', 'maybe', '', 'x')", []).is_err());
        c.execute("INSERT INTO weights_check_films VALUES ('srpose-cldet23', 'fp', 'c1', 'measured', '', 'x')", []).unwrap();
        c.execute("INSERT INTO weights_check VALUES ('srpose-cldet23', 'fp', 'c1', 'Go', 1.0, NULL)", []).unwrap();
        assert!(c.execute("INSERT INTO weights_check VALUES ('srpose-cldet23', 'fp', 'c1', 'S', -1.0, 1.0)", []).is_err());
        // accept_kind: only with the source it describes (answer 7)
        let lm = |id: &str, source: &str, verified: i64, kind: &str| c.execute(&format!(
            "INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, placed_by, updated_at, accept_kind)
             VALUES ('c1', '{id}', 1, 2, '{source}', {verified}, 1, 2, 0.9, NULL, 'x', {kind})"), []);
        for (id, source, v, kind) in [("S", "ai", 1, "'single'"), ("N", "ai", 1, "'bulk'"), ("A", "ai", 1, "'double-click'"),
            ("B", "ai-adjusted", 1, "'drag'"), ("Go", "manual", 1, "'hand'"), ("Me", "ai", 0, "NULL")] {
            assert_eq!(lm(id, source, v, kind).unwrap(), 1, "{id} {kind}");
        }
        for (id, source, v, kind, why) in [("Gn", "ai", 0, "'single'", "accepted but not verified"), ("Po", "ai", 1, "'drag'", "dragged but where the AI put it"),
            ("Or", "manual", 1, "'single'", "a hand point accepted like an AI one"), ("Ar", "ai-adjusted", 1, "'hand'", "a moved AI point called hand-placed"),
            ("Pog", "ai", 1, "'twice'", "an unknown kind")] {
            assert!(lm(id, source, v, kind).is_err(), "{why}");
        }
        // the learning row's film scale (owner E1)
        let lr = |lmid: &str, s: &str, src: &str| c.execute(&format!(
            "INSERT INTO learning_record VALUES ('c1', '{lmid}', 'aariz-cepha29', NULL, 'cpu', 10, 1, 0, 'unknown', 'moved', 1, 'Dr A', 'x', {s}, {src})"), []);
        assert_eq!(lr("S", "0.1", "'ruler'").unwrap(), 1);
        assert_eq!(lr("N", "NULL", "NULL").unwrap(), 1, "both blank: a row written before format 14");
        for (s, src, why) in [("0", "'ruler'", "zero"), ("-0.1", "'machine'", "negative"), ("9e999", "'fit'", "infinite"),
            ("0.1", "NULL", "a scale with no source"), ("NULL", "'assumed'", "a source with no scale"), ("0.1", "'guess'", "an unknown source")] {
            assert!(lr("A", s, src).is_err(), "{why}");
        }
        // Tier 3 (chain spec §4): empty until S3, already strict
        let pm = |version: i64, films: &str, sha: &str| c.execute("INSERT INTO personal_models (operator, version, base_model_id, base_fingerprint, layer_sha256,
            trained_case_ids, rule_version, created_at) VALUES ('Dr A', ?1, 'aariz-cepha29', 'cacd38', ?2, ?3, 'tier3/1', 'x')", rusqlite::params![version, sha.repeat(64), films]);
        assert_eq!(pm(1, "[\"c1\"]", "a").unwrap(), 1);
        assert!(pm(1, "[]", "b").is_err(), "one row per operator and version");
        assert!(pm(2, "{}", "c").is_err(), "the films trained on are a list");
        assert!(c.execute("UPDATE personal_models SET version = 3", []).is_err() && c.execute("DELETE FROM personal_models", []).is_err(), "versions are kept");
        c.execute("INSERT INTO personal_model_events (operator, version, kind, numbers, by_whom, at) VALUES ('Dr A', NULL, 'paused', '{}', 'Dr A', 'x')", []).unwrap();
        assert!(c.execute("INSERT INTO personal_model_events (operator, version, kind, numbers, by_whom, at) VALUES ('Dr A', 1, 'deleted', '{}', 'Dr A', 'x')", []).is_err());
        assert!(c.execute("DELETE FROM personal_model_events", []).is_err(), "append-only");
    }
    /// Task 4 (every CHECK has a test that refuses a bad value): each CHECK, trigger and reference of 014
    /// that `schema_14_refuses_what_its_rows_can_never_be` does not reach, refused just past its limit and accepted at
    /// it. Positive control: neutralise each in turn (`CHECK (1)`, a trigger that raises nothing, no REFERENCES) → the
    /// line naming it fails (the run is listed in the Task 4 report).
    #[test] fn schema_14_refuses_every_other_value_its_rows_can_never_be() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 14).unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p', 'abc', 'T1', 'x', 'x');").unwrap();
        use rusqlite::types::Value::{self, Integer as I, Null as N, Real as R, Text as T};
        let t = |s: &str| T(s.into());
        // point_choices: one good answer, then each column set to a value it can never hold.
        let pc = |lm: Value, model: Value, last_at: Value, last_case: Value, basis: Value| c.execute(
            "INSERT INTO point_choices (landmark_id, model_id, action, rule_version, last_imported_at, last_case_id, basis, numbers, operator, at)
             VALUES (?1, ?2, 'declined', 'best-point/3', ?3, ?4, ?5, '{}', 'Dr A', 'x')", rusqlite::params![lm, model, last_at, last_case, basis]);
        assert_eq!(pc(t(&"G".repeat(20)), t(&"m".repeat(100)), t("t"), t("c"), t(&"b".repeat(200))).unwrap(), 1, "at every limit");
        for (why, r) in [("no landmark", pc(t(""), t("m"), t("t"), t("c"), t("b"))), ("a 21-character landmark", pc(t(&"G".repeat(21)), t("m"), t("t"), t("c"), t("b"))),
            ("no model", pc(t("Go"), t(""), t("t"), t("c"), t("b"))), ("a 101-character model", pc(t("Go"), t(&"m".repeat(101)), t("t"), t("c"), t("b"))),
            ("an empty basis", pc(t("Go"), t("m"), t("t"), t("c"), t(""))), ("a 201-character basis", pc(t("Go"), t("m"), t("t"), t("c"), t(&"b".repeat(201)))),
            ("a last film with no case", pc(t("Go"), t("m"), t("t"), N, t("b"))), ("a last case with no time", pc(t("Go"), t("m"), N, t("c"), t("b")))] {
            assert!(r.is_err(), "point_choices: {why} must be refused");
        }
        let undo = |numbers: &str| c.execute("INSERT INTO point_choices (landmark_id, model_id, action, rule_version, numbers, operator, at)
            VALUES ('Go', 'm', 'undone', 'best-point/3', ?1, 'Dr A', 'x')", [numbers]);
        assert!(undo("{").is_err(), "point_choices: numbers that are not JSON (an undo too)");
        assert!(c.execute("UPDATE point_choices SET at = 'y'", []).is_err(), "point_choices: never changed, not even its time");
        // the weights check: the film row, then its points.
        let wf = |model: Value, fp: Value, case: Value| c.execute("INSERT INTO weights_check_films VALUES (?1, ?2, ?3, 'measured', '', 'x')", rusqlite::params![model, fp, case]);
        assert_eq!(wf(t(&"m".repeat(100)), t(&"f".repeat(128)), t("c1")).unwrap(), 1, "at every limit");
        for (why, r) in [("no model", wf(t(""), t("fp"), t("c1"))), ("a 101-character model", wf(t(&"m".repeat(101)), t("fp"), t("c1"))),
            ("no fingerprint", wf(t("m"), t(""), t("c1"))), ("a 129-character fingerprint", wf(t("m"), t(&"f".repeat(129)), t("c1"))),
            ("a film not in the library", wf(t("m"), t("fp"), t("nope")))] {
            assert!(r.is_err(), "weights_check_films: {why} must be refused");
        }
        wf(t("m"), t("fp"), t("c1")).unwrap();
        let wp = |model: &str, lm: &str, old: Value, new: Value| c.execute("INSERT INTO weights_check VALUES (?1, 'fp', 'c1', ?2, ?3, ?4)", rusqlite::params![model, lm, old, new]);
        assert_eq!(wp("m", &"G".repeat(20), R(1e9), R(1e9)).unwrap(), 1, "at every limit");
        assert_eq!(wp("m", "S", R(0.0), R(0.0)).unwrap(), 1, "zero is a distance");
        for (why, r) in [("no landmark", wp("m", "", R(1.0), N)), ("a 21-character landmark", wp("m", &"G".repeat(21), R(1.0), N)),
            ("an old distance over 1e9", wp("m", "N", R(1.0001e9), N)), ("an infinite old distance", wp("m", "N", R(f64::INFINITY), N)),
            ("no old distance (NaN binds as NULL)", wp("m", "N", R(f64::NAN), N)), ("a negative new distance", wp("m", "N", R(1.0), R(-0.001))),
            ("an infinite new distance", wp("m", "N", R(1.0), R(f64::INFINITY))), ("a point with no film row", wp("other", "N", R(1.0), N))] {
            assert!(r.is_err(), "weights_check: {why} must be refused");
        }
        // Tier 3: personal_models
        let pm = |op: Value, version: Value, base: Value, fp: Value, layer: Value, films: Value| c.execute("INSERT INTO personal_models (operator, version,
            base_model_id, base_fingerprint, layer_sha256, trained_case_ids, rule_version, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'tier3/1', 'x')",
            rusqlite::params![op, version, base, fp, layer, films]);
        let sha = || t(&"a".repeat(64));
        assert_eq!(pm(t(&"o".repeat(200)), I(1), t(&"m".repeat(100)), t(&"f".repeat(128)), sha(), t("[]")).unwrap(), 1, "at every limit");
        for (why, r) in [("no operator", pm(t(""), I(2), t("m"), t("f"), sha(), t("[]"))), ("a 201-character operator", pm(t(&"o".repeat(201)), I(2), t("m"), t("f"), sha(), t("[]"))),
            ("version 0", pm(t("Dr A"), I(0), t("m"), t("f"), sha(), t("[]"))), ("version 1.5", pm(t("Dr A"), R(1.5), t("m"), t("f"), sha(), t("[]"))),
            ("no base model", pm(t("Dr A"), I(2), t(""), t("f"), sha(), t("[]"))), ("a 101-character base model", pm(t("Dr A"), I(2), t(&"m".repeat(101)), t("f"), sha(), t("[]"))),
            ("no base fingerprint", pm(t("Dr A"), I(2), t("m"), t(""), sha(), t("[]"))), ("a 129-character base fingerprint", pm(t("Dr A"), I(2), t("m"), t(&"f".repeat(129)), sha(), t("[]"))),
            ("a 63-character layer hash", pm(t("Dr A"), I(2), t("m"), t("f"), t(&"a".repeat(63)), t("[]"))),
            ("films that are not JSON", pm(t("Dr A"), I(2), t("m"), t("f"), sha(), t("[")))] {
            assert!(r.is_err(), "personal_models: {why} must be refused");
        }
        // Tier 3: personal_model_events
        let ev = |op: &str, version: Value, numbers: &str, by: &str| c.execute("INSERT INTO personal_model_events (operator, version, kind, numbers, by_whom, at)
            VALUES (?1, ?2, 'offered', ?3, ?4, 'x')", rusqlite::params![op, version, numbers, by]);
        assert_eq!(ev(&"o".repeat(200), I(1), "{}", &"b".repeat(200)).unwrap(), 1, "at every limit");
        for (why, r) in [("no operator", ev("", I(1), "{}", "Dr A")), ("a 201-character operator", ev(&"o".repeat(201), I(1), "{}", "Dr A")),
            ("version 0", ev("Dr A", I(0), "{}", "Dr A")), ("version 1.5", ev("Dr A", R(1.5), "{}", "Dr A")),
            ("numbers that are not JSON", ev("Dr A", I(1), "{", "Dr A")),
            ("by nobody", ev("Dr A", I(1), "{}", "")), ("by a 201-character name", ev("Dr A", I(1), "{}", &"b".repeat(201)))] {
            assert!(r.is_err(), "personal_model_events: {why} must be refused");
        }
        assert!(c.execute("UPDATE personal_model_events SET at = 'y'", []).is_err(), "personal_model_events: never changed");
    }
    /// Owner rule for every format: an app that knows 13 refuses a format-14 library. Positive control: make
    /// `ensure_known` return Ok always → this fails.
    #[test] fn an_app_that_knows_13_refuses_a_format_14_library() {
        let e = ensure_known(14, 13).unwrap_err().to_string();
        assert_eq!(e, "this library was written by a newer OpenCephAI (schema 14, this app knows 13); update the app");
        ensure_known(13, 13).unwrap();
        ensure_known(14, 14).unwrap();
    }
    /// Format 15 (Automatic best spec §9; owner Q3, D3): `landmarks.placed_via` blank on every old point, and an empty
    /// `auto_best_events`; every row already stored unchanged. Positive control: append `UPDATE landmarks SET x = 0;` to
    /// 015 → "every old row unchanged" fails.
    #[test] fn schema_15_adds_placed_via_and_the_change_record_and_keeps_every_row() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 14).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at, title) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x', 'Dr');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at, spacing_mm) VALUES ('c1', 'p', 'abc', 'T1', 'x', 'x', 0.1);
            INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, placed_by, updated_at, accept_kind)
              VALUES ('c1', 'S', 11, 12, 'ai', 1, 11, 12, 0.9, 'aariz-cepha29', 'x', 'single'), ('c1', 'N', 1, 2, 'manual', 1, NULL, NULL, NULL, NULL, 'x', 'hand');
            INSERT INTO learning_record VALUES ('c1', 'S', 'aariz-cepha29', NULL, 'cpu', 10, 1, 0, 'unknown', 'accepted-unmoved', 1, 'Dr A', 'x', 0.1, 'ruler');
            INSERT INTO point_choices (landmark_id, model_id, action, rule_version, last_imported_at, last_case_id, basis, numbers, operator, at)
              VALUES ('Go', 'srpose-cldet23', 'declined', 'best-point/3', 't', 'c1', 'mm, 60 ruler films', '{}', 'Dr A', 'x');
            INSERT INTO settings (key, value) VALUES ('main_model', 'aariz-cepha29');").unwrap();
        let (sh, before) = (shape(&c), rows_in(&c, &shape(&c)));
        println!("14→15: comparing {} rows", before.len());
        assert!(before.len() >= 8, "the instrument compares rows: {before:#?}");
        migrate_to(&mut c, 15).unwrap();
        assert_eq!(version(&c).unwrap(), 15);
        assert_eq!(rows_in(&c, &sh), before, "every old row unchanged");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM auto_best_events", [], |r| r.get::<_, i64>(0)).unwrap(), 0, "the change record starts empty");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM landmarks WHERE placed_via IS NULL", [], |r| r.get::<_, i64>(0)).unwrap(), 2, "every old point blank");
    }
    /// The library refuses what `placed_via` and a change can never be, never changes or removes a change, and never
    /// gives Automatic best a run, a learning row, a Part F answer or a point of its own (spec §7). Positive control:
    /// replace each CHECK of 015 with `CHECK (1)`, or drop each trigger, in turn → the line naming it fails.
    #[test] fn schema_15_refuses_what_its_rows_can_never_be() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 15).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p', 'abc', 'T1', 'x', 'x');").unwrap();
        // placed_via: only 'auto-best', only on an AI point with a real placing model
        let lm = |id: &str, source: &str, by: &str, via: &str| c.execute(&format!(
            "INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, placed_by, updated_at, placed_via)
             VALUES ('c1', '{id}', 1, 2, '{source}', 0, 1, 2, 0.9, {by}, 'x', {via})"), []);
        assert_eq!(lm("S", "ai", "'srpose-cldet23'", "'auto-best'").unwrap(), 1);
        assert_eq!(lm("N", "ai-adjusted", "'aariz-cepha29'", "'auto-best'").unwrap(), 1);
        assert_eq!(lm("A", "ai", "'aariz-cepha29'", "NULL").unwrap(), 1);
        for (id, source, by, via, why) in [("B", "manual", "NULL", "'auto-best'", "a hand-placed point placed via Automatic best"),
            ("Go", "ai", "NULL", "'auto-best'", "via Automatic best with no real placing model"),
            ("Me", "ai", "'srpose-cldet23'", "'part-f'", "an unknown via"),
            ("Gn", "ai", "'auto-best'", "NULL", "Automatic best as the placing model"),
            ("Po", "ai", "'auto-best'", "'auto-best'", "Automatic best as the placing model, via itself")] {
            assert!(lm(id, source, by, via).is_err(), "{why} must be refused");
        }
        assert!(c.execute("UPDATE landmarks SET placed_by = 'auto-best' WHERE id = 'A'", []).is_err(), "a point is never re-filed under Automatic best");
        assert_eq!(c.execute("UPDATE landmarks SET placed_by = 'gu2net-isbi19' WHERE id = 'A'", []).unwrap(), 1, "control: a real model is taken");
        // never a run, a learning row or a Part F answer of its own; controls with a real model pass
        let run = |m: &str| c.execute("INSERT INTO ai_runs (case_id, model_id, execution_provider, facing, total_ms, ran_at) VALUES ('c1', ?1, 'cpu', 'right', 1, 'x')", [m]);
        assert!(run("auto-best").is_err(), "no run of its own");
        assert_eq!(run("srpose-cldet23").unwrap(), 1);
        let lr = |m: &str| c.execute("INSERT INTO learning_record VALUES ('c1', 'S', ?1, NULL, 'cpu', 1, 0.1, 0, 'unknown', 'moved', 0, 'Dr A', 'x', 0.1, 'ruler')", [m]);
        assert!(lr("auto-best").is_err(), "never in the learning record");
        assert_eq!(lr("srpose-cldet23").unwrap(), 1);
        let pc = |m: &str| c.execute("INSERT INTO point_choices (landmark_id, model_id, action, rule_version, last_imported_at, last_case_id, basis, numbers, operator, at)
            VALUES ('Go', ?1, 'declined', 'best-point/3', 't', 'c', 'b', '{}', 'Dr A', 'x')", [m]);
        assert!(pc("auto-best").is_err(), "never a Part F answer");
        assert_eq!(pc("srpose-cldet23").unwrap(), 1);
        // auto_best_events: every argument is an SQL literal
        let ev = |kind: &str, model: &str, fp: &str, uses: &str, last: &str, basis: &str, reason: &str| c.execute(&format!(
            "INSERT INTO auto_best_events (landmark_id, kind, model_id, fingerprint, uses, last_imported_at, last_case_id, basis, reason, numbers, rule_version, operator, at)
             VALUES ('Go', {kind}, {model}, {fp}, {uses}, {last}, {basis}, {reason}, '{{}}', 'best-point/3', 'Dr A', 'x')"), []);
        let (sr, gu, fp, film, b, none, nolast) = ("'srpose-cldet23'", "'gu2net-isbi19'", "'fp'", "'2026-01-01T00:59:00.000Z', 'c059'", "'mm, 60 ruler films'", "NULL", "NULL, NULL");
        assert_eq!(ev("'adopted'", sr, fp, sr, film, b, none).unwrap(), 1);
        assert_eq!(ev("'undone'", sr, fp, none, film, b, none).unwrap(), 1);
        assert_eq!(ev("'undone'", sr, fp, gu, film, b, none).unwrap(), 1);
        assert_eq!(ev("'redone'", sr, fp, sr, film, b, none).unwrap(), 1);
        assert_eq!(ev("'returned'", sr, fp, none, nolast, none, "'file-changed'").unwrap(), 1);
        assert_eq!(ev("'returned'", sr, none, none, nolast, none, "'evidence'").unwrap(), 1);
        let long_fp = format!("'{}'", "f".repeat(129));
        for (kind, model, f, uses, last, basis, reason, why) in [
            ("'maybe'", sr, fp, sr, film, b, none, "an unknown kind"),
            ("'adopted'", "'auto-best'", fp, "'auto-best'", film, b, none, "Automatic best adopting itself"),
            ("'adopted'", sr, none, sr, film, b, none, "an adoption with no file"),
            ("'adopted'", sr, fp, gu, film, b, none, "an adoption that uses another model"),
            ("'adopted'", sr, fp, sr, nolast, b, none, "an adoption with no deciding films"),
            ("'adopted'", sr, fp, sr, film, none, none, "an adoption with no basis"),
            ("'adopted'", sr, fp, sr, film, b, "'evidence'", "an adoption with a reason"),
            ("'adopted'", sr, fp, sr, "'t', NULL", b, none, "a last film with no case"),
            ("'adopted'", sr, long_fp.as_str(), sr, film, b, none, "a 129-character file"),
            ("'undone'", sr, fp, sr, film, b, none, "an undo that still uses the model undone"),
            ("'undone'", sr, none, none, film, b, none, "an undo with no file"),
            ("'undone'", sr, fp, "'auto-best'", film, b, none, "an undo that uses Automatic best"),
            ("'redone'", sr, fp, none, film, b, none, "a redo that uses nothing"),
            ("'returned'", sr, fp, sr, nolast, none, "'evidence'", "a return that still uses a model"),
            ("'returned'", sr, fp, none, film, none, "'evidence'", "a return with deciding films"),
            ("'returned'", sr, fp, none, nolast, b, "'evidence'", "a return with a basis"),
            ("'returned'", sr, fp, none, nolast, none, none, "a return with no reason"),
            ("'returned'", sr, fp, none, nolast, none, "'tired'", "an unknown reason"),
        ] {
            assert!(ev(kind, model, f, uses, last, basis, reason).is_err(), "auto_best_events: {why} must be refused");
        }
        assert!(c.execute("INSERT INTO auto_best_events (landmark_id, kind, model_id, fingerprint, uses, last_imported_at, last_case_id, basis, numbers, rule_version, operator, at)
            VALUES ('Go', 'adopted', 'srpose-cldet23', 'fp', 'srpose-cldet23', 't', 'c', 'b', 'not json', 'best-point/3', 'Dr A', 'x')", []).is_err(), "numbers must be JSON");
        assert!(c.execute(&format!("INSERT INTO auto_best_events (landmark_id, kind, model_id, fingerprint, uses, last_imported_at, last_case_id, basis, numbers, rule_version, operator, at)
            VALUES ('{}', 'adopted', 'srpose-cldet23', 'fp', 'srpose-cldet23', 't', 'c', 'b', '{{}}', 'best-point/3', 'Dr A', 'x')", "G".repeat(21)), []).is_err(), "a 21-character landmark");
        assert!(c.execute("UPDATE auto_best_events SET at = 'y'", []).is_err(), "never changed");
        assert!(c.execute("DELETE FROM auto_best_events", []).is_err(), "never removed");
    }
    /// Every CHECK of 015 that `schema_15_refuses_what_its_rows_can_never_be` does not reach on its own, refused just past
    /// its limit and taken at it (the rule: every CHECK has a test that refuses a bad value, with a control),
    /// and `placed_via` held on UPDATE as well as INSERT. Positive control: neutralise each CHECK in turn (`CHECK (1)`) →
    /// the line naming it fails (listed in the Task 1 report).
    #[test] fn schema_15_refuses_every_other_value_its_rows_can_never_be() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 15).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p', 'abc', 'T1', 'x', 'x');
            INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, placed_by, updated_at, placed_via)
              VALUES ('c1', 'S', 1, 2, 'ai', 0, 1, 2, 0.9, 'srpose-cldet23', 'x', 'auto-best'), ('c1', 'N', 1, 2, 'manual', 1, NULL, NULL, NULL, NULL, 'x', NULL);").unwrap();
        // placed_via on UPDATE: a point moved to the hand or stripped of its model keeps no 'auto-best'; clearing it is taken.
        assert!(c.execute("UPDATE landmarks SET source = 'manual' WHERE id = 'S'", []).is_err(), "a hand-placed point keeps no 'via Automatic best'");
        assert!(c.execute("UPDATE landmarks SET placed_by = NULL WHERE id = 'S'", []).is_err(), "via Automatic best needs a real placing model");
        assert!(c.execute("UPDATE landmarks SET placed_via = 'auto-best' WHERE id = 'N'", []).is_err(), "a hand-placed point is never re-labelled");
        assert!(c.execute("UPDATE landmarks SET placed_via = 'part-f' WHERE id = 'S'", []).is_err(), "an unknown via, on update");
        assert_eq!(c.execute("UPDATE landmarks SET source = 'manual', placed_by = NULL, placed_via = NULL WHERE id = 'S'", []).unwrap(), 1, "control: placed by hand, label cleared");
        // Carry from Task 1 (progress.md ruling a): model_id is never changed TO 'auto-best' on ai_runs / learning_record,
        // on UPDATE as well as on INSERT.
        c.execute("INSERT INTO ai_runs (case_id, model_id, execution_provider, facing, total_ms, ran_at) VALUES ('c1', 'srpose-cldet23', 'cpu', 'right', 1, 'x')", []).unwrap();
        assert!(c.execute("UPDATE ai_runs SET model_id = 'auto-best' WHERE case_id = 'c1'", []).is_err(), "a run is never re-filed under Automatic best");
        assert_eq!(c.execute("UPDATE ai_runs SET model_id = 'gu2net-isbi19' WHERE case_id = 'c1'", []).unwrap(), 1, "control: a real model is taken");
        c.execute("INSERT INTO learning_record VALUES ('c1', 'S', 'aariz-cepha29', NULL, 'cpu', 1, 0.1, 0, 'unknown', 'moved', 0, 'Dr A', 'x', 0.1, 'ruler')", []).unwrap();
        assert!(c.execute("UPDATE learning_record SET model_id = 'auto-best' WHERE case_id = 'c1' AND landmark_id = 'S'", []).is_err(), "a learning row is never re-filed under Automatic best");
        assert_eq!(c.execute("UPDATE learning_record SET model_id = 'gu2net-isbi19' WHERE case_id = 'c1' AND landmark_id = 'S'", []).unwrap(), 1, "control: a real model is taken");
        // auto_best_events, column by column. Each argument is a Value; the good row is an adoption.
        use rusqlite::types::Value::{self, Null as N, Text as T};
        let t = |s: &str| T(s.into());
        let ev = |lm: Value, kind: Value, model: Value, fp: Value, uses: Value, at: Value, case: Value, basis: Value, reason: Value| c.execute(
            "INSERT INTO auto_best_events (landmark_id, kind, model_id, fingerprint, uses, last_imported_at, last_case_id, basis, reason, numbers, rule_version, operator, at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, '{}', 'best-point/3', 'Dr A', 'x')", rusqlite::params![lm, kind, model, fp, uses, at, case, basis, reason]);
        let m100 = "m".repeat(100);
        let good = |lm: &str, model: &str, fp: &str, basis: &str| ev(t(lm), t("adopted"), t(model), t(fp), t(model), t("t"), t("c"), t(basis), N);
        assert_eq!(good(&"G".repeat(20), &m100, &"f".repeat(128), &"b".repeat(200)).unwrap(), 1, "at every limit");
        assert_eq!(ev(t("Go"), t("undone"), t("sr"), t("fp"), t(&"u".repeat(100)), t("t"), t("c"), t("b"), N).unwrap(), 1, "an undo using a 100-character model");
        assert_eq!(ev(t("Go"), t("returned"), t("sr"), N, N, N, N, N, t("not-installed")).unwrap(), 1, "the third reason");
        for (why, r) in [("no landmark", good("", "sr", "fp", "b")),
            ("no model", good("Go", "", "fp", "b")), ("a 101-character model", good("Go", &"m".repeat(101), "fp", "b")),
            ("Automatic best as the model of a return", ev(t("Go"), t("returned"), t("auto-best"), N, N, N, N, N, t("evidence"))),
            ("an empty file", good("Go", "sr", "", "b")),
            ("an undo using an empty model", ev(t("Go"), t("undone"), t("sr"), t("fp"), t(""), t("t"), t("c"), t("b"), N)),
            ("an undo using a 101-character model", ev(t("Go"), t("undone"), t("sr"), t("fp"), t(&"u".repeat(101)), t("t"), t("c"), t("b"), N)),
            ("an empty basis", good("Go", "sr", "fp", "")), ("a 201-character basis", good("Go", "sr", "fp", &"b".repeat(201))),
            ("a last case with no time", ev(t("Go"), t("adopted"), t("sr"), t("fp"), t("sr"), N, t("c"), t("b"), N)),
            ("an adoption that uses nothing (SQL NULL would slip past `uses = model_id`)", ev(t("Go"), t("adopted"), t("sr"), t("fp"), N, t("t"), t("c"), t("b"), N)),
            ("a redo with no file", ev(t("Go"), t("redone"), t("sr"), N, t("sr"), t("t"), t("c"), t("b"), N)),
            ("a redo that uses another model", ev(t("Go"), t("redone"), t("sr"), t("fp"), t("gu"), t("t"), t("c"), t("b"), N)),
            ("an undo with a reason", ev(t("Go"), t("undone"), t("sr"), t("fp"), N, t("t"), t("c"), t("b"), t("evidence"))),
            ("no kind", ev(t("Go"), N, t("sr"), t("fp"), t("sr"), t("t"), t("c"), t("b"), N))] {
            assert!(r.is_err(), "auto_best_events: {why} must be refused");
        }
        // NOT NULL: each required column left blank in turn; the control (nothing left blank) is taken.
        let names = ["landmark_id", "kind", "model_id", "fingerprint", "uses", "last_imported_at", "last_case_id", "basis", "numbers", "rule_version", "operator", "at"];
        let blank = |col: Option<&str>| {
            let vals: Vec<&str> = names.iter().zip(["'Go'", "'adopted'", "'sr'", "'fp'", "'sr'", "'t'", "'c'", "'b'", "'{}'", "'best-point/3'", "'Dr A'", "'x'"])
                .map(|(n, v)| if Some(*n) == col { "NULL" } else { v }).collect();
            c.execute(&format!("INSERT INTO auto_best_events ({}) VALUES ({})", names.join(", "), vals.join(", ")), [])
        };
        assert_eq!(blank(None).unwrap(), 1, "control: nothing left blank");
        for col in ["landmark_id", "model_id", "numbers", "rule_version", "operator", "at"] {
            assert!(blank(Some(col)).is_err(), "auto_best_events: no {col} must be refused");
        }
    }
    /// Owner rule for every format: an app that knows 14 refuses a format-15 library. Positive control: make
    /// `ensure_known` return Ok always → this fails.
    #[test] fn an_app_that_knows_14_refuses_a_format_15_library() {
        let e = ensure_known(15, 14).unwrap_err().to_string();
        assert_eq!(e, "this library was written by a newer OpenCephAI (schema 15, this app knows 14); update the app");
        ensure_known(14, 14).unwrap();
        ensure_known(15, 15).unwrap();
    }
    /// Format 16 (Library ▸ Table "Report" column, owner 29 Oct): one blank `cases.report_saved_at` on every old film;
    /// no table added; every row already stored unchanged. Positive control: append `UPDATE cases SET timepoint = 'T9';`
    /// to 016 → "every old row unchanged" fails.
    #[test] fn schema_16_adds_a_blank_report_date_to_every_film_and_keeps_every_row() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 15).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at, title, gender) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x', 'Dr', 'F');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at, spacing_mm, verified_at, verified_by)
              VALUES ('c1', 'p', 'abc', 'T1', 'x', 'x', 0.1, 'v', 'Dr A'), ('c2', 'p', 'abc', 'T2', 'y', 'y', NULL, NULL, NULL);
            UPDATE cases SET deleted_at = 'z' WHERE id = 'c2';
            INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, placed_by, updated_at, accept_kind, placed_via)
              VALUES ('c1', 'S', 11, 12, 'ai', 1, 11, 12, 0.9, 'aariz-cepha29', 'x', 'single', 'auto-best');
            INSERT INTO settings (key, value) VALUES ('main_model', 'auto-best');").unwrap();
        let (sh, before) = (shape(&c), rows_in(&c, &shape(&c)));
        println!("15→16: comparing {} rows", before.len());
        assert!(before.len() >= 6, "the instrument compares rows: {before:#?}");
        migrate_to(&mut c, 16).unwrap();
        assert_eq!(version(&c).unwrap(), 16);
        assert_eq!(rows_in(&c, &sh), before, "every old row unchanged");
        assert_eq!(tables(&c), sh.iter().map(|(t, _)| t.clone()).collect::<Vec<_>>(), "no table added or removed");
        let added: Vec<String> = shape(&c).into_iter().zip(sh.iter())
            .flat_map(|((t, now), (_, was))| now.into_iter().filter(|n| !was.contains(n)).map(move |n| format!("{t}.{n}")).collect::<Vec<_>>()).collect();
        assert_eq!(added, ["cases.report_saved_at"], "one new column, nothing else");
        assert_eq!(c.query_row("SELECT COUNT(*) FROM cases WHERE report_saved_at IS NULL", [], |r| r.get::<_, i64>(0)).unwrap(), 2, "every old film blank, live or deleted");
    }
    /// The library refuses what a report date can never be: empty, or longer than any timestamp. Positive control: replace
    /// 016's CHECK with `CHECK (1)` → the two refusals fail.
    #[test] fn schema_16_refuses_what_a_report_date_can_never_be() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 16).unwrap();
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at) VALUES ('c1', 'p', 'abc', 'T1', 'x', 'x');").unwrap();
        let set = |v: &str| c.execute("UPDATE cases SET report_saved_at = ?1 WHERE id = 'c1'", [v]);
        assert!(set("").is_err(), "an empty report date must be refused");
        assert!(set(&"2".repeat(41)).is_err(), "a 41-character report date must be refused");
        set("2026-10-29T01:02:03.456Z").unwrap();
        c.execute("UPDATE cases SET report_saved_at = NULL WHERE id = 'c1'", []).unwrap();
    }
    /// Owner rule for every format: an app that knows 15 refuses a format-16 library. Positive control: make
    /// `ensure_known` return Ok always → this fails.
    #[test] fn an_app_that_knows_15_refuses_a_format_16_library() {
        let e = ensure_known(16, 15).unwrap_err().to_string();
        assert_eq!(e, "this library was written by a newer OpenCephAI (schema 16, this app knows 15); update the app");
        ensure_known(15, 15).unwrap();
        ensure_known(16, 16).unwrap();
    }

    // ---- Formats 17 and 18 (norms Auto population, spec 2026-10-29 §4.1 and §4.8; ruling NAP-Q5 (a)). ----
    /// A format-16 database with a row in every table this test needs: two films with no population ("Clinic
    /// default"), one of them in Recently deleted, and two with a population chosen by hand.
    fn format_16_rows(c: &Connection) {
        c.execute_batch("INSERT INTO images VALUES ('abc', 'png', 400, 300, 10, 'film.png', 'x');
            INSERT INTO patients (id, display_name, name_key, created_at, title, gender) VALUES ('p', 'Demo Synthetic', 'demo synthetic', 'x', 'Dr', 'F');
            INSERT INTO cases (id, patient_id, image_sha256, timepoint, created_at, updated_at, population, deleted_at) VALUES
              ('c1', 'p', 'abc', 'T1', 'x', 'x', NULL, NULL), ('c2', 'p', 'abc', 'T2', 'x', 'x', 'chinese', NULL),
              ('c3', 'p', 'abc', 'T3', 'x', 'x', NULL, '2026-10-01T00:00:00.000Z'), ('c4', 'p', 'abc', 'T4', 'x', 'x', 'user:My clinic', NULL);
            INSERT INTO landmarks (case_id, id, x, y, source, verified, updated_at) VALUES ('c1', 'S', 11, 12, 'manual', 0, 'x');
            INSERT INTO settings (key, value) VALUES ('default_population', 'caucasian');").unwrap();
    }
    /// Format 17 is held for Tier 3 Stage A (ruling NAP-Q5 (a)); until that work merges it changes nothing:
    /// no table, no column, no row. Positive control: put `UPDATE cases SET timepoint = 'T9';` into 017 → fails.
    #[test] fn format_17_is_reserved_and_changes_nothing() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 16).unwrap();
        format_16_rows(&c);
        let (sh, before) = (shape(&c), rows_in(&c, &shape(&c)));
        migrate_to(&mut c, 17).unwrap();
        assert_eq!(version(&c).unwrap(), 17);
        assert_eq!(shape(&c), sh, "no table or column added");
        assert_eq!(rows_in(&c, &sh), before, "no row changed");
    }
    /// Spec 2026-10-29 §4.8 (owner NAP-Q3 (b)): format 18 switches exactly the "Clinic default" cases to Auto (a case
    /// in Recently deleted too), logs each with its previous setting and the time, adds a blank background, and leaves
    /// every hand-chosen case and every other row alone. Positive control: change both of 018's `WHERE population IS
    /// NULL` to `WHERE population IS NULL OR population = 'chinese'` → fails on c2.
    #[test] fn format_18_switches_clinic_default_cases_to_auto_and_logs_them() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 17).unwrap();
        format_16_rows(&c);
        let sh = shape(&c);
        let other: Vec<String> = rows_in(&c, &sh).into_iter().filter(|r| !r.starts_with("cases|")).collect();
        assert!(other.len() >= 4, "the instrument compares rows: {other:#?}");
        migrate_to(&mut c, 18).unwrap();
        assert_eq!(version(&c).unwrap(), 18);
        let pops: Vec<(String, Option<String>)> = c.prepare("SELECT id, population FROM cases ORDER BY id").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?))).unwrap().map(Result::unwrap).collect();
        assert_eq!(pops, vec![("c1".into(), Some("auto".into())), ("c2".into(), Some("chinese".into())),
            ("c3".into(), Some("auto".into())), ("c4".into(), Some("user:My clinic".into()))]);
        let log: Vec<(String, Option<String>, bool, Option<String>)> = c.prepare(
            "SELECT case_id, previous_population, length(switched_at) BETWEEN 20 AND 30, undone_at FROM population_switches ORDER BY case_id").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).unwrap().map(Result::unwrap).collect();
        assert_eq!(log, vec![("c1".into(), None, true, None), ("c3".into(), None, true, None)]);
        let bg: Option<String> = c.query_row("SELECT background FROM patients WHERE id = 'p'", [], |r| r.get(0)).unwrap();
        assert_eq!(bg, None);
        assert_eq!(rows_in(&c, &sh).into_iter().filter(|r| !r.starts_with("cases|")).collect::<Vec<_>>(), other, "every other table's rows unchanged");
        // Every column of every case except `population` unchanged.
        let others: Vec<String> = sh.iter().find(|(t, _)| t == "cases").unwrap().1.iter().filter(|n| *n != "population").cloned().collect();
        let rows = |c: &Connection| -> Vec<String> { c.prepare(&format!("SELECT {} FROM cases ORDER BY id", others.join(", "))).unwrap()
            .query_map([], |r| Ok((0..others.len()).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|"))).unwrap()
            .map(Result::unwrap).collect() };
        let mut was = Connection::open_in_memory().unwrap(); migrate_to(&mut was, 17).unwrap(); format_16_rows(&was);
        assert_eq!(rows(&c), rows(&was), "every case column but population unchanged");
        let added: Vec<String> = shape(&c).into_iter().flat_map(|(t, cols)| {
            let was = sh.iter().find(|(n, _)| *n == t).map(|(_, v)| v.clone());
            match was { None => vec![format!("{t} (table)")], Some(w) => cols.into_iter().filter(|n| !w.contains(n)).map(|n| format!("{t}.{n}")).collect() }
        }).collect();
        assert_eq!(added, ["applied_migrations (table)", "patients.background", "population_switches (table)"], "one column and two tables, nothing else");
    }
    /// What a background or a switch record can never be: empty, or longer than 40. Positive control: replace 018's
    /// CHECKs with `CHECK (1)` → the refusals fail.
    #[test] fn format_18_refuses_what_a_background_or_a_switch_can_never_be() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 18).unwrap();
        format_16_rows(&c);
        let bg = |v: &str| c.execute("UPDATE patients SET background = ?1 WHERE id = 'p'", [v]);
        assert!(bg("").is_err(), "an empty background must be refused");
        assert!(bg(&"x".repeat(41)).is_err(), "a 41-character background must be refused");
        bg("chinese").unwrap(); bg("other").unwrap();
        let sw = |at: &str, undone: Option<&str>| c.execute("INSERT OR REPLACE INTO population_switches (case_id, previous_population, switched_at, undone_at) VALUES ('c9', NULL, ?1, ?2)", rusqlite::params![at, undone]);
        assert!(sw("", None).is_err(), "an empty switch time must be refused");
        assert!(sw("x", Some("")).is_err(), "an empty undo time must be refused");
        assert!(c.execute("INSERT INTO population_switches (case_id, previous_population, switched_at) VALUES ('c8', NULL, NULL)", []).is_err(), "a switch with no time must be refused");
        sw("2026-10-29T00:00:00.000Z", None).unwrap();
        sw("2026-10-29T00:00:00.000Z", Some("2026-10-30T00:00:00.000Z")).unwrap();
    }
    /// Owner rule for every format: an app that knows 16 or 17 refuses a format-18 library. Positive control: make
    /// `ensure_known` return Ok always → this fails.
    #[test] fn an_app_that_knows_16_or_17_refuses_a_format_18_library() {
        assert_eq!(ensure_known(18, 16).unwrap_err().to_string(), "this library was written by a newer OpenCephAI (schema 18, this app knows 16); update the app");
        assert_eq!(ensure_known(18, 17).unwrap_err().to_string(), "this library was written by a newer OpenCephAI (schema 18, this app knows 17); update the app");
        ensure_known(18, 18).unwrap();
        assert_eq!(CURRENT, 19);
    }

    // ---- Format 19 (Stage A′, the point check; spec 2026-11-02 §14.13 U1): three new tables, every old row unchanged. ----
    /// Format 19 adds `point_check_runs`, `point_checks` and `point_check_resolutions`, empty, and changes no old row; the
    /// only other write is its own line in `applied_migrations`. Positive control: append `UPDATE cases SET timepoint =
    /// 'T9';` to 019 → "every old table's rows unchanged" fails.
    #[test] fn format_19_adds_three_tables_and_changes_no_row() {
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 18).unwrap();
        format_16_rows(&c);
        let sh = shape(&c);
        let before = rows_in(&c, &sh);
        let not_applied = |v: Vec<String>| -> Vec<String> { v.into_iter().filter(|r| !r.starts_with("applied_migrations|")).collect() };
        println!("18→19: comparing {} rows", not_applied(before.clone()).len());
        assert!(not_applied(before.clone()).len() >= 8, "the instrument compares rows: {before:#?}");
        migrate_to(&mut c, 19).unwrap();
        assert_eq!(version(&c).unwrap(), 19);
        let after = rows_in(&c, &sh);
        assert_eq!(not_applied(after.clone()), not_applied(before.clone()), "every old table's rows unchanged");
        let applied: Vec<String> = after.into_iter().filter(|r| r.starts_with("applied_migrations|")).collect();
        let mut expected: Vec<String> = before.into_iter().filter(|r| r.starts_with("applied_migrations|")).collect();
        expected.push(format!("applied_migrations|Integer(19)|Text(\"{}\")", migration_sha(19)));
        assert_eq!(applied, expected, "17 and 18 as they were, and 19 recorded");
        let added: Vec<String> = shape(&c).into_iter().flat_map(|(t, cols)| {
            let was = sh.iter().find(|(n, _)| *n == t).map(|(_, v)| v.clone());
            match was { None => vec![format!("{t} (table)")], Some(w) => cols.into_iter().filter(|n| !w.contains(n)).map(|n| format!("{t}.{n}")).collect() }
        }).collect();
        assert_eq!(added, ["point_check_resolutions (table)", "point_check_runs (table)", "point_checks (table)"], "three tables, nothing else");
        for t in ["point_check_runs", "point_checks", "point_check_resolutions"] {
            assert_eq!(c.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get::<_, i64>(0)).unwrap(), 0, "{t} starts empty");
        }
    }
    /// What a check record can never be: every CHECK, the UNIQUE and the one-film-flag index of 019 refuse one bad row
    /// each (exactly one thing wrong in each), and the matching good row is accepted. Positive control: replace any one
    /// of 019's CHECKs with `CHECK (1)` (or drop the UNIQUE, or the index) → its refusal here fails.
    #[test] fn format_19_refuses_what_a_check_can_never_be() {
        use rusqlite::types::Value::{self, Integer, Null, Real, Text};
        let mut c = Connection::open_in_memory().unwrap();
        migrate_to(&mut c, 19).unwrap();
        c.pragma_update(None, "foreign_keys", "ON").unwrap();
        format_16_rows(&c);
        c.execute_batch("INSERT INTO ai_runs (id, case_id, model_id, execution_provider, facing, total_ms, ran_at) VALUES
            (1, 'c1', 'aariz-cepha29', 'cpu', 'right', 1.0, 'x'), (2, 'c1', 'aariz-cepha29', 'cpu', 'right', 1.0, 'y'),
            (3, 'c1', 'srpose-cldet23', 'cpu', 'right', 1.0, 'z');").unwrap();
        let t = |s: &str| Text(s.into());
        let sha = t(&"a".repeat(64));
        let insert = |table: &str, base: &[(&str, Value)], change: &[(&str, Value)]| -> rusqlite::Result<usize> {
            let cols: Vec<(&str, Value)> = base.iter().map(|(k, v)| (*k, change.iter().find(|(n, _)| n == k).map(|(_, x)| x.clone()).unwrap_or_else(|| v.clone()))).collect();
            let names = cols.iter().map(|(k, _)| *k).collect::<Vec<_>>().join(", ");
            let marks = (1..=cols.len()).map(|i| format!("?{i}")).collect::<Vec<_>>().join(", ");
            c.execute(&format!("INSERT INTO {table} ({names}) VALUES ({marks})"), rusqlite::params_from_iter(cols.into_iter().map(|(_, v)| v)))
        };
        let run = [("run_id", Integer(1)), ("case_id", t("c1")), ("rule_version", t("point-check/2")), ("prior_sha256", sha.clone()),
            ("prior_films", Integer(300)), ("outcome", t("clean")), ("not_run_reason", Null), ("present", Integer(19)), ("checked_at", t("2026-11-02T00:00:00.000Z"))];
        let refused_runs: Vec<(&str, Vec<(&str, Value)>)> = vec![
            ("a rule that is not point-check/…", vec![("rule_version", t("best-point/3"))]),
            ("a 21-character rule", vec![("rule_version", t(&format!("point-check/{}", "9".repeat(9))))]),
            ("a 63-character SHA", vec![("prior_sha256", t(&"a".repeat(63)))]),
            ("a knowledge of 0 films", vec![("prior_films", Integer(0))]),
            ("an outcome `moved`", vec![("outcome", t("moved"))]),
            ("a reason `crashed`", vec![("outcome", t("not-run")), ("not_run_reason", t("crashed"))]),
            ("20 points present", vec![("present", Integer(20))]),
            ("-1 points present", vec![("present", Integer(-1))]),
            ("an empty time", vec![("checked_at", t(""))]),
            ("a 41-character time", vec![("checked_at", t(&"2".repeat(41)))]),
            ("a `not-run` with no reason", vec![("outcome", t("not-run"))]),
            ("a `clean` with a reason", vec![("not_run_reason", t("too-few-points"))]),
            ("`not-set-up` with a SHA", vec![("outcome", t("not-run")), ("not_run_reason", t("not-set-up"))]),
            ("`too-few-points` with no SHA", vec![("outcome", t("not-run")), ("not_run_reason", t("too-few-points")), ("prior_sha256", Null), ("prior_films", Null)]),
            ("`not-set-up` with a film count but no SHA", vec![("outcome", t("not-run")), ("not_run_reason", t("not-set-up")), ("prior_sha256", Null)]),
            ("a SHA with no film count", vec![("prior_films", Null)]),
        ];
        for (why, change) in &refused_runs {
            let e = insert("point_check_runs", &run, change);
            println!("run, {why}: {:?}", e.as_ref().map_err(|e| e.to_string()));
            assert!(e.is_err(), "{why} must be refused");
        }
        insert("point_check_runs", &run, &[]).expect("the good run");
        insert("point_check_runs", &run, &[("run_id", Integer(2)), ("outcome", t("not-run")), ("not_run_reason", t("too-few-points")), ("present", Integer(11))]).expect("a good too-few-points run");
        insert("point_check_runs", &run, &[("run_id", Integer(3)), ("outcome", t("not-run")), ("not_run_reason", t("not-set-up")), ("prior_sha256", Null), ("prior_films", Null), ("present", Null)]).expect("a good not-set-up run");
        let flag = [("run_id", Integer(1)), ("landmark_id", t("N")), ("action", t("flagged")), ("points", Null), ("tail", Real(0.0001)), ("off_px", Real(150.0)),
            ("expected_x", Real(10.0)), ("expected_y", Real(-5.0)), ("ring_rx", Real(30.0)), ("ring_ry", Real(20.0)), ("ring_angle_deg", Real(-12.5))];
        let film = [("run_id", Integer(1)), ("landmark_id", Null), ("action", t("film-unusual")), ("points", t("N,S,Po,Ar")), ("tail", Null), ("off_px", Null),
            ("expected_x", Null), ("expected_y", Null), ("ring_rx", Null), ("ring_ry", Null), ("ring_angle_deg", Null)];
        let refused_flags: Vec<(&str, &[(&str, Value)], Vec<(&str, Value)>)> = vec![
            ("an empty point id", &flag, vec![("landmark_id", t(""))]),
            ("a 17-character point id", &flag, vec![("landmark_id", t(&"N".repeat(17)))]),
            ("an action `moved`", &flag, vec![("action", t("moved"))]),
            ("an empty points list", &film, vec![("points", t(""))]),
            ("a 201-character points list", &film, vec![("points", t(&"N".repeat(201)))]),
            ("a tail of 1", &flag, vec![("tail", Real(1.0))]),
            ("a tail below 0", &flag, vec![("tail", Real(-0.0001))]),
            ("a distance below 0", &flag, vec![("off_px", Real(-1.0))]),
            ("a ring of width 0", &flag, vec![("ring_rx", Real(0.0))]),
            ("a ring of height 0", &flag, vec![("ring_ry", Real(0.0))]),
            ("a film flag with a point", &film, vec![("landmark_id", t("N"))]),
            ("a point flag with no point", &flag, vec![("landmark_id", Null)]),
            ("a point flag with `points`", &flag, vec![("points", t("N,S"))]),
            ("a film flag with no `points`", &film, vec![("points", Null)]),
        ];
        for (why, base, change) in &refused_flags {
            let e = insert("point_checks", base, change);
            println!("flag, {why}: {:?}", e.as_ref().map_err(|e| e.to_string()));
            assert!(e.is_err(), "{why} must be refused");
        }
        insert("point_checks", &flag, &[]).expect("the good point flag");
        insert("point_checks", &film, &[]).expect("the good film flag");
        let twice = insert("point_checks", &flag, &[]);
        println!("flag, N twice on one run: {:?}", twice.as_ref().map_err(|e| e.to_string()));
        assert!(twice.is_err(), "one flag per point per run");
        let second_film = insert("point_checks", &film, &[("points", t("Go,Me"))]);
        println!("flag, a second film flag on one run: {:?}", second_film.as_ref().map_err(|e| e.to_string()));
        assert!(second_film.is_err(), "one film flag per run");
        insert("point_checks", &film, &[("run_id", Integer(2))]).expect("a film flag on another run");
        insert("point_checks", &flag, &[("landmark_id", t("S"))]).expect("another point on the same run");
        let check_id: i64 = c.query_row("SELECT id FROM point_checks WHERE landmark_id = 'N'", [], |r| r.get(0)).unwrap();
        let res = [("check_id", Integer(check_id)), ("how", t("accepted")), ("operator", t("Dr A")), ("resolved_at", t("2026-11-02T00:00:00.000Z"))];
        let refused_res: Vec<(&str, Vec<(&str, Value)>)> = vec![
            ("a resolution `bulk`", vec![("how", t("bulk"))]),
            ("an empty operator", vec![("operator", t(""))]),
            ("an 81-character operator", vec![("operator", t(&"D".repeat(81)))]),
            ("an empty time", vec![("resolved_at", t(""))]),
            ("a 41-character time", vec![("resolved_at", t(&"2".repeat(41)))]),
        ];
        for (why, change) in &refused_res {
            let e = insert("point_check_resolutions", &res, change);
            println!("resolution, {why}: {:?}", e.as_ref().map_err(|e| e.to_string()));
            assert!(e.is_err(), "{why} must be refused");
        }
        insert("point_check_resolutions", &res, &[]).expect("the good resolution");
        let again = insert("point_check_resolutions", &res, &[("how", t("moved"))]);
        assert!(again.is_err(), "a flag is resolved once");
        for how in ["moved", "placed", "film-checked"] {
            let id: i64 = c.query_row("SELECT id FROM point_checks WHERE id NOT IN (SELECT check_id FROM point_check_resolutions) LIMIT 1", [], |r| r.get(0)).unwrap();
            insert("point_check_resolutions", &res, &[("check_id", Integer(id)), ("how", t(how))]).unwrap_or_else(|e| panic!("{how}: {e}"));
        }
    }
    /// Owner rule for every format: an app that knows 18 refuses a format-19 library. Positive control: make
    /// `ensure_known` return Ok always → this fails.
    #[test] fn an_app_that_knows_18_refuses_a_format_19_library() {
        assert_eq!(ensure_known(19, 18).unwrap_err().to_string(), "this library was written by a newer OpenCephAI (schema 19, this app knows 18); update the app");
        ensure_known(18, 19).unwrap();
        ensure_known(19, 19).unwrap();
        assert_eq!(CURRENT, 19);
    }
}
