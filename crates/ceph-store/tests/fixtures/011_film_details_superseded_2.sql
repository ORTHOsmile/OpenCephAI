-- The second format 11, superseded before release by owner ruling JOIN-HISTORY (17 Oct): it noted carried numbers in
-- library_number_films and kept no join record. Kept only so a test can build a library with its shape. Verbatim from
-- feat/film-details-d2 at 860fbb1 (crates/ceph-store/migrations/011_film_details.sql). Never run by any installed app.
-- Format 11 (spec 2026-10-17 D; addendum D2 of 17 Oct, which amended this file BEFORE any release: no installed app
-- ever ran the first version; `schema::check_shape` refuses a library written by it). Only after AUTOBACKUP-1.
-- Nothing already stored changes; every new value starts blank (NULL).
-- Patient ID as printed on THIS X-ray (owner Q8, 17 Oct: each X-ray keeps its own). Named printed_patient_id because
-- cases.patient_id already means "which patient row this film belongs to".
ALTER TABLE cases ADD COLUMN printed_patient_id TEXT CHECK (printed_patient_id IS NULL OR length(printed_patient_id) BETWEEN 1 AND 200);
-- On each film, as printed. X-ray dimensions are text only: never parsed, never used for scale.
ALTER TABLE cases ADD COLUMN xray_type TEXT CHECK (xray_type IS NULL OR length(xray_type) BETWEEN 1 AND 200);
ALTER TABLE cases ADD COLUMN xray_size TEXT CHECK (xray_size IS NULL OR length(xray_size) BETWEEN 1 AND 200);
ALTER TABLE cases ADD COLUMN radiography_practice TEXT CHECK (radiography_practice IS NULL OR length(radiography_practice) BETWEEN 1 AND 200);
-- The library's own patient number (owner LIBID-1/LIBID-2, 17 Oct). AUTOINCREMENT never hands a number out again,
-- and rows are never deleted: a number merged away points at the one it was merged into (merged_into).
CREATE TABLE library_numbers (
  n           INTEGER PRIMARY KEY AUTOINCREMENT,
  issued_at   TEXT NOT NULL,
  merged_into INTEGER REFERENCES library_numbers(n),
  merged_at   TEXT                              -- when it was retired; NULL while held (owner L9 B: picks the latest merge)
);
ALTER TABLE patients ADD COLUMN library_no INTEGER REFERENCES library_numbers(n);
CREATE UNIQUE INDEX patients_by_library_no ON patients(library_no);
-- Owner L9 B (17 Oct): which X-rays carried which Library ID before they joined another patient, so undoing a wrong
-- link by correcting the name gives those X-rays (and only those) their old number back. Deleted with the X-ray.
CREATE TABLE library_number_films (
  n           INTEGER NOT NULL REFERENCES library_numbers(n),
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  recorded_at TEXT NOT NULL,
  PRIMARY KEY (n, case_id)
);
-- "Not the same patient" answered on a Patient ID link suggestion: this film, that patient's Library ID.
CREATE TABLE id_link_answers (
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  library_no  INTEGER NOT NULL REFERENCES library_numbers(n),
  answered_at TEXT NOT NULL,
  PRIMARY KEY (case_id, library_no)
);
-- Each machine may learn where it prints the new details. SQLite cannot change a CHECK in place, so layout_places is
-- rebuilt, keeping every rowid (layout_votes.place holds them). 'gender' and 'referrer' are learned from D2 (Q6).
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
