-- Format 14 (chain spec §4; owner answer 15, 25 Oct:
-- one format for Part F, the cross-check and Tier 3, created empty and filled as each stage ships). Only after
-- AUTOBACKUP-1. Nothing already stored changes: five new tables start empty; every new column starts blank (NULL).
-- Never amend after release; if it must change before release, add a check_shape case as 011 did.

-- S1, Part F: the owner's answers to "Best model per point" offers (rule best-point/3). One row per answer; never
-- changed or removed (an undo is a new row). last_imported_at / last_case_id: the last film of the re-check the answer
-- was given on; basis: the films that decided, in words ("mm, 60 ruler films"; owner E1, 26 Oct); neither for an undo.
-- No foreign key to cases: the answer outlives a film emptied from Recently deleted.
CREATE TABLE point_choices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  landmark_id      TEXT NOT NULL CHECK (length(landmark_id) BETWEEN 1 AND 20),
  model_id         TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 100),
  action           TEXT NOT NULL CHECK (action IN ('accepted', 'declined', 'undone')),
  rule_version     TEXT NOT NULL,
  last_imported_at TEXT,
  last_case_id     TEXT,
  basis            TEXT CHECK (basis IS NULL OR length(basis) BETWEEN 1 AND 200),
  numbers          TEXT NOT NULL CHECK (json_valid(numbers)),
  operator         TEXT NOT NULL,
  at               TEXT NOT NULL,
  CHECK ((last_imported_at IS NULL) = (last_case_id IS NULL)),
  CHECK ((action = 'undone') = (last_imported_at IS NULL)),
  CHECK ((action = 'undone') = (basis IS NULL))
);
CREATE TRIGGER point_choices_never_changed BEFORE UPDATE ON point_choices BEGIN SELECT RAISE(ABORT, 'a point choice is never changed'); END;
CREATE TRIGGER point_choices_never_removed BEFORE DELETE ON point_choices BEGIN SELECT RAISE(ABORT, 'a point choice is never removed'); END;

-- S1, the weights check (owner Q4, 18 Oct): when a model's file changes, its new file is run on the older films its
-- earlier file measured. One row per film checked for one new file (how it went), one per point measured on it: the
-- earlier file's and the new file's distance from the final point, in mm (new_mm NULL: the new file gave no point
-- there). Never read by the learning record or by an offer. Emptied with the film from Recently deleted.
CREATE TABLE weights_check_films (
  model_id    TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 100),
  fingerprint TEXT NOT NULL CHECK (length(fingerprint) BETWEEN 1 AND 128),
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  outcome     TEXT NOT NULL CHECK (outcome IN ('measured', 'nothing-to-check', 'failed')),
  detail      TEXT NOT NULL,
  ran_at      TEXT NOT NULL,
  PRIMARY KEY (model_id, fingerprint, case_id)
);
CREATE TABLE weights_check (
  model_id    TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  case_id     TEXT NOT NULL,
  landmark_id TEXT NOT NULL CHECK (length(landmark_id) BETWEEN 1 AND 20),
  old_mm      REAL NOT NULL CHECK (old_mm BETWEEN 0 AND 1e9),
  new_mm      REAL CHECK (new_mm IS NULL OR new_mm BETWEEN 0 AND 1e9),
  PRIMARY KEY (model_id, fingerprint, case_id, landmark_id),
  FOREIGN KEY (model_id, fingerprint, case_id) REFERENCES weights_check_films (model_id, fingerprint, case_id) ON DELETE CASCADE
);

-- Chain spec answer 7: how each point was accepted. single = Accept position; bulk = Accept Positions (n) or Accept
-- remaining; double-click = a double press on the film or in the list; drag = moved (drag, arrow keys, a click
-- elsewhere); hand = placed by hand. Each kind only with the source it describes; NULL when not accepted, and on every
-- point stored before format 14.
ALTER TABLE landmarks ADD COLUMN accept_kind TEXT CHECK (accept_kind IS NULL
  OR (accept_kind IN ('single', 'bulk', 'double-click') AND source = 'ai' AND verified = 1)
  OR (accept_kind = 'drag' AND source = 'ai-adjusted')
  OR (accept_kind = 'hand' AND source = 'manual'));

-- Owner E1 (26 Oct): each learning row keeps the scale its film had when the row was written (mm per px and where it
-- came from: ruler, machine, fit, assumed), so a ranking can be recomputed without re-placing points. Both or neither;
-- NULL on every row written before format 14. 9e999 reads as infinity, so "< 9e999" refuses it (NaN binds as NULL).
ALTER TABLE learning_record ADD COLUMN mm_per_px REAL CHECK (mm_per_px IS NULL OR (mm_per_px > 0 AND mm_per_px < 9e999));
ALTER TABLE learning_record ADD COLUMN scale_source TEXT
  CHECK (scale_source IS NULL OR scale_source IN ('ruler', 'machine', 'fit', 'assumed'))
  CHECK ((mm_per_px IS NULL) = (scale_source IS NULL));

-- S3, Tier 3 (chain spec §4, §7; an outline, its detailed design to follow): created empty now so the three stages
-- share one format (owner answer 15). If the Tier 3 design needs something these do not foresee, that is a second
-- format, asked for first. One row per trained version of an operator's personal model, never changed or removed
-- (earlier versions are kept, answer 11). trained_case_ids: the films it trained on, so Part F can leave them out (§3).
CREATE TABLE personal_models (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  operator         TEXT NOT NULL CHECK (length(operator) BETWEEN 1 AND 200),
  version          INTEGER NOT NULL CHECK (typeof(version) = 'integer' AND version >= 1),
  base_model_id    TEXT NOT NULL CHECK (length(base_model_id) BETWEEN 1 AND 100),
  base_fingerprint TEXT NOT NULL CHECK (length(base_fingerprint) BETWEEN 1 AND 128),
  layer_sha256     TEXT NOT NULL CHECK (length(layer_sha256) = 64),
  trained_case_ids TEXT NOT NULL CHECK (json_valid(trained_case_ids) AND json_type(trained_case_ids) = 'array'),
  rule_version     TEXT NOT NULL,
  created_at       TEXT NOT NULL,
  UNIQUE (operator, version)
);
CREATE TRIGGER personal_models_never_changed BEFORE UPDATE ON personal_models BEGIN SELECT RAISE(ABORT, 'a personal model version is never changed'); END;
CREATE TRIGGER personal_models_never_removed BEFORE DELETE ON personal_models BEGIN SELECT RAISE(ABORT, 'a personal model version is never removed'); END;
-- Every adoption offer and answer, rollback, pause, resume, reset and undone reset (answers 6, 10, 11), with who and
-- when; append-only. version: none for a pause, resume or reset.
CREATE TABLE personal_model_events (
  id       INTEGER PRIMARY KEY AUTOINCREMENT,
  operator TEXT NOT NULL CHECK (length(operator) BETWEEN 1 AND 200),
  version  INTEGER CHECK (version IS NULL OR (typeof(version) = 'integer' AND version >= 1)),
  kind     TEXT NOT NULL CHECK (kind IN ('offered', 'accepted', 'declined', 'rolled-back', 'paused', 'resumed', 'reset', 'reset-undone')),
  numbers  TEXT NOT NULL CHECK (json_valid(numbers)),
  by_whom  TEXT NOT NULL CHECK (length(by_whom) BETWEEN 1 AND 200),
  at       TEXT NOT NULL
);
CREATE TRIGGER personal_model_events_never_changed BEFORE UPDATE ON personal_model_events BEGIN SELECT RAISE(ABORT, 'a personal model event is never changed'); END;
CREATE TRIGGER personal_model_events_never_removed BEFORE DELETE ON personal_model_events BEGIN SELECT RAISE(ABORT, 'a personal model event is never removed'); END;
