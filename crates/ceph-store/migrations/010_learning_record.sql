-- Schema 10 (spec 2026-10-13 "Parked" P5, owner PARK-FLAGS 15 Oct; tables approved 15 Oct 2026, owner ruling SCHEMA10-A,
-- option A: no spreads stored): who placed each AI point, the model version with each run, and the learning record.
-- Only after AUTOBACKUP-1 (a checked copy first). Rows already in the library are not changed; the new columns are NULL.
ALTER TABLE ai_runs   ADD COLUMN model_sha256 TEXT;   -- the weights SHA-256; NULL for runs before schema 10
ALTER TABLE landmarks ADD COLUMN placed_by TEXT;      -- the model that placed an AI point; NULL for old cases and hand-placed points

-- One row per verified or hand-placed point and per model that ran on the film and found that point: how far that
-- model's guess was from the clinician's final point. Replaced when the point is moved again, removed when the point
-- is un-verified (Task 10's code), deleted with the case (foreign key).
CREATE TABLE learning_record (
  case_id            TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  landmark_id        TEXT NOT NULL,
  model_id           TEXT NOT NULL,
  model_sha256       TEXT,                                          -- NULL if the run predates schema 10
  execution_provider TEXT NOT NULL,
  dist_px            REAL NOT NULL CHECK (dist_px BETWEEN 0 AND 1e9),  -- finite: 9e999 reads as Inf and is refused
  dist_mm            REAL NOT NULL CHECK (dist_mm BETWEEN 0 AND 1e9),  -- (Task 9 review Minor 1; NaN binds as NULL)
  mm_assumed         INTEGER NOT NULL CHECK (mm_assumed IN (0, 1)), -- 1: no ruler, 0.1 mm per px assumed (Q10)
  machine            TEXT NOT NULL,                                 -- the film-layout machine id, or 'unknown'
  how                TEXT NOT NULL CHECK (how IN ('accepted-unmoved', 'moved', 'hand-placed')),
  placer             INTEGER NOT NULL CHECK (placer IN (0, 1)),     -- 1: this model placed the point (0 px when accepted unmoved)
  operator           TEXT NOT NULL,
  recorded_at        TEXT NOT NULL,
  PRIMARY KEY (case_id, landmark_id, model_id)
);
