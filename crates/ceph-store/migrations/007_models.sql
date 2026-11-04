-- Schema 7 (spec 2026-10-01 Part 3): every model's raw points per run (the cross-check and personal learning are
-- built from them), the people who trace on this Mac, and who accepted which model licence.
CREATE TABLE ai_points (
  run_id      INTEGER NOT NULL REFERENCES ai_runs(id) ON DELETE CASCADE,
  channel     INTEGER NOT NULL,
  landmark_id TEXT,
  x           REAL NOT NULL,
  y           REAL NOT NULL,
  peak        REAL NOT NULL,
  PRIMARY KEY (run_id, channel)
);
CREATE TABLE operators (name TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE model_licences (
  model_id        TEXT NOT NULL,
  licence_version TEXT NOT NULL,
  accepted_by     TEXT NOT NULL,
  accepted_at     TEXT NOT NULL,
  PRIMARY KEY (model_id, licence_version)
);
