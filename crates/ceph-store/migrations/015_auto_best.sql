-- Format 15 (spec §9; owner Q3, 27 Oct: Automatic best's
-- own format, before Tier 3 Stage A, whose tables become format 16). Only after AUTOBACKUP-1. Nothing already stored
-- changes: one new column starts blank (NULL) and one new table starts empty.
-- Never amend after release; if it must change before release, add a check_shape case as 011 did.

-- The label on a reopened film (spec §5): 'auto-best' on a point Automatic best placed; NULL on every other point and on
-- every point stored before format 15. Only on an AI point with a real placing model.
ALTER TABLE landmarks ADD COLUMN placed_via TEXT CHECK (placed_via IS NULL
  OR (placed_via = 'auto-best' AND source IN ('ai', 'ai-adjusted') AND placed_by IS NOT NULL));

-- Owner D3 (spec §6a): every change of Automatic best's verdict (adopted, returned), every Undo (undone) and every
-- "Use … again" (redone); append-only. uses: the model Automatic best uses at the point after this row (NULL: its
-- fallback). last_*: for adopted, the re-check's last film; for undone and redone, the film the Undo is anchored on.
-- basis: the films that decided, in Part F's words. reason: why a model was dropped. No link to a film: a change
-- outlives a film emptied from Recently deleted.
CREATE TABLE auto_best_events (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  landmark_id      TEXT NOT NULL CHECK (length(landmark_id) BETWEEN 1 AND 20),
  kind             TEXT NOT NULL CHECK (kind IN ('adopted', 'returned', 'undone', 'redone')),
  model_id         TEXT NOT NULL CHECK (length(model_id) BETWEEN 1 AND 100 AND model_id <> 'auto-best'),
  fingerprint      TEXT CHECK (fingerprint IS NULL OR length(fingerprint) BETWEEN 1 AND 128),
  uses             TEXT CHECK (uses IS NULL OR (length(uses) BETWEEN 1 AND 100 AND uses <> 'auto-best')),
  last_imported_at TEXT,
  last_case_id     TEXT,
  basis            TEXT CHECK (basis IS NULL OR length(basis) BETWEEN 1 AND 200),
  reason           TEXT CHECK (reason IS NULL OR reason IN ('file-changed', 'not-installed', 'evidence')),
  numbers          TEXT NOT NULL CHECK (json_valid(numbers)),
  rule_version     TEXT NOT NULL,
  operator         TEXT NOT NULL,
  at               TEXT NOT NULL,
  CHECK ((last_imported_at IS NULL) = (last_case_id IS NULL)),
  CHECK ((kind = 'returned') = (last_imported_at IS NULL)),
  CHECK ((kind = 'returned') = (basis IS NULL)),
  CHECK ((kind = 'returned') = (reason IS NOT NULL)),
  CHECK (kind <> 'returned' OR uses IS NULL),
  -- `uses IS NOT NULL` is spelled out: with uses NULL, `uses = model_id` is NULL and a CHECK lets NULL through.
  CHECK (kind NOT IN ('adopted', 'redone') OR (uses IS NOT NULL AND uses = model_id AND fingerprint IS NOT NULL)),
  CHECK (kind <> 'undone' OR ((uses IS NULL OR uses <> model_id) AND fingerprint IS NOT NULL))
);
CREATE TRIGGER auto_best_events_never_changed BEFORE UPDATE ON auto_best_events BEGIN SELECT RAISE(ABORT, 'an Automatic best change is never changed'); END;
CREATE TRIGGER auto_best_events_never_removed BEFORE DELETE ON auto_best_events BEGIN SELECT RAISE(ABORT, 'an Automatic best change is never removed'); END;

-- Spec §7: Automatic best is made of the real models' marks. It never has a run, a learning row, a Part F answer, or a
-- point filed under its own name.
CREATE TRIGGER ai_runs_never_auto_best BEFORE INSERT ON ai_runs WHEN NEW.model_id = 'auto-best'
  BEGIN SELECT RAISE(ABORT, 'Automatic best has no run of its own'); END;
CREATE TRIGGER ai_runs_never_auto_best_update BEFORE UPDATE OF model_id ON ai_runs WHEN NEW.model_id = 'auto-best'
  BEGIN SELECT RAISE(ABORT, 'a run is never re-filed under Automatic best'); END;
CREATE TRIGGER learning_record_never_auto_best BEFORE INSERT ON learning_record WHEN NEW.model_id = 'auto-best'
  BEGIN SELECT RAISE(ABORT, 'Automatic best is never in the learning record'); END;
CREATE TRIGGER learning_record_never_auto_best_update BEFORE UPDATE OF model_id ON learning_record WHEN NEW.model_id = 'auto-best'
  BEGIN SELECT RAISE(ABORT, 'a learning row is never re-filed under Automatic best'); END;
CREATE TRIGGER point_choices_never_auto_best BEFORE INSERT ON point_choices WHEN NEW.model_id = 'auto-best'
  BEGIN SELECT RAISE(ABORT, 'Automatic best is never a Part F answer'); END;
CREATE TRIGGER landmarks_placed_by_never_auto_best BEFORE INSERT ON landmarks WHEN NEW.placed_by = 'auto-best'
  BEGIN SELECT RAISE(ABORT, 'a point is placed by a real model, never by Automatic best'); END;
CREATE TRIGGER landmarks_placed_by_never_auto_best_update BEFORE UPDATE OF placed_by ON landmarks WHEN NEW.placed_by = 'auto-best'
  BEGIN SELECT RAISE(ABORT, 'a point is placed by a real model, never by Automatic best'); END;
