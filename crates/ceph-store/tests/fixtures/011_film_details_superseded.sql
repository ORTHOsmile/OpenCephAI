-- The first format 11, superseded before release by addendum D2; kept only so a test can build a library with its shape.
-- Verbatim from main at 2828920 (crates/ceph-store/migrations/011_film_details.sql). Never run by any installed app.
-- Format 11 (spec 2026-10-17; owner D-FIELDS-1 and D-LEARN-1, 16 Oct 2026). Only after AUTOBACKUP-1 (a checked copy
-- first). Nothing already stored changes; every new value starts blank (NULL).
-- Patient ID, as printed on the film, on the patient: every film of that patient shows it. Named printed_patient_id
-- because cases.patient_id already means "which patient row this film belongs to".
ALTER TABLE patients ADD COLUMN printed_patient_id TEXT CHECK (printed_patient_id IS NULL OR length(printed_patient_id) BETWEEN 1 AND 200);
-- On each film, as printed. X-ray dimensions are text only: never parsed, never used for scale.
ALTER TABLE cases ADD COLUMN xray_type TEXT CHECK (xray_type IS NULL OR length(xray_type) BETWEEN 1 AND 200);
ALTER TABLE cases ADD COLUMN xray_size TEXT CHECK (xray_size IS NULL OR length(xray_size) BETWEEN 1 AND 200);
ALTER TABLE cases ADD COLUMN radiography_practice TEXT CHECK (radiography_practice IS NULL OR length(radiography_practice) BETWEEN 1 AND 200);
-- Each machine may learn where it prints the new details. SQLite cannot change a CHECK in place, so layout_places is
-- rebuilt, keeping every rowid (layout_votes.place holds them). 'gender' and 'referrer' are allowed but not yet
-- learned (spec Q6 A): learning them later needs no further format change.
CREATE TABLE layout_places_11 (
  machine_id  TEXT NOT NULL REFERENCES layout_machines(id) ON DELETE CASCADE,
  field       TEXT NOT NULL CHECK (field IN ('last', 'first', 'full', 'dob', 'film_date', 'scan_id',
                                             'patient_id', 'xray_type', 'xray_size', 'practice', 'gender', 'referrer')),
  row_y       REAL NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('left', 'right')),
  starts      TEXT NOT NULL,
  ends        TEXT NOT NULL,
  count       INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);
INSERT INTO layout_places_11 (rowid, machine_id, field, row_y, side, starts, ends, count, updated_at)
  SELECT rowid, machine_id, field, row_y, side, starts, ends, count, updated_at FROM layout_places;
DROP TABLE layout_places;
ALTER TABLE layout_places_11 RENAME TO layout_places;
