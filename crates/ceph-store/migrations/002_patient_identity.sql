-- CephTrace library, schema 2 (spec 2026-09-28): patient identity read from the film, and Compare with…
-- Runs with foreign keys off (schema::migrate), as SQLite's table-rebuild procedure requires; migrate checks every
-- reference before it commits. name_key is filled in by schema.rs right after this script (it needs Rust).

-- Patients: the unique display name is replaced by a unique (name key, date of birth). Two patients may share a name.
CREATE TABLE patients_v2 (
  id            TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  name_key      TEXT NOT NULL DEFAULT '',
  date_of_birth TEXT,
  created_at    TEXT NOT NULL
);
INSERT INTO patients_v2 (id, display_name, created_at) SELECT id, display_name, created_at FROM patients;
DROP TABLE patients;
ALTER TABLE patients_v2 RENAME TO patients;
-- NULL dates of birth never collide, so names without a date of birth may repeat (the app reuses the first).
CREATE UNIQUE INDEX patients_by_identity ON patients(name_key, date_of_birth);

-- The ID printed on the label (reference only, never used for matching), and where the identity came from:
-- 'film' (read from a labelled field), 'guess' (an unlabelled name; always asks) or 'manual' (typed or confirmed by a person).
ALTER TABLE cases ADD COLUMN scan_id TEXT;
ALTER TABLE cases ADD COLUMN identity_source TEXT NOT NULL DEFAULT 'manual' CHECK (identity_source IN ('film', 'guess', 'manual'));
ALTER TABLE cases ADD COLUMN identity_checked INTEGER NOT NULL DEFAULT 1 CHECK (identity_checked IN (0, 1));
-- Where the film date came from (owner, 29 Sep): the label, the image file's own EXIF date, the import date, or a person.
-- NULL for cases from before schema 2.
ALTER TABLE cases ADD COLUMN taken_on_source TEXT CHECK (taken_on_source IS NULL OR taken_on_source IN ('label', 'image', 'import', 'manual'));

-- The last comparison opened for a case (Compare with…), reopened with it.
CREATE TABLE case_compare (
  case_id       TEXT PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,
  other_case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  updated_at    TEXT NOT NULL
);
