-- CephTrace library, schema 9 (spec 2026-10-06 Part C): the reference population chosen for a case (NULL = use the
-- clinic default from Settings, key 'default_population'), and the clinician's own norms (never in git; always
-- labelled "user norm"). Existing cases start with NULL.
ALTER TABLE cases ADD COLUMN population TEXT;
CREATE TABLE user_norms (
  set_name TEXT NOT NULL, measurement TEXT NOT NULL, mean REAL NOT NULL, sd REAL CHECK (sd IS NULL OR sd > 0),
  source_note TEXT NOT NULL CHECK (length(trim(source_note)) > 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  PRIMARY KEY (set_name, measurement));
