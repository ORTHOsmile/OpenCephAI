-- Format 19 — Stage A′, the point check (spec §14.13 U1).
-- Flag-only: nothing here moves or changes a point. Only after AUTOBACKUP-1's checked safety copy; format 17 stays the
-- empty placeholder. Every old row unchanged. Never amend after release; from 18 the library records this file's SHA-256.
CREATE TABLE point_check_runs (
  run_id         INTEGER PRIMARY KEY REFERENCES ai_runs(id) ON DELETE CASCADE,
  case_id        TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  rule_version   TEXT NOT NULL CHECK (rule_version LIKE 'point-check/%' AND length(rule_version) <= 20),
  prior_sha256   TEXT CHECK (prior_sha256 IS NULL OR length(prior_sha256) = 64),
  prior_films    INTEGER CHECK (prior_films IS NULL OR prior_films >= 1),
  outcome        TEXT NOT NULL CHECK (outcome IN ('clean', 'flagged', 'film-unusual', 'not-run')),
  not_run_reason TEXT CHECK (not_run_reason IS NULL OR not_run_reason IN ('too-few-points', 'not-set-up')),
  present        INTEGER CHECK (present IS NULL OR present BETWEEN 0 AND 19),
  checked_at     TEXT NOT NULL CHECK (length(checked_at) BETWEEN 1 AND 40),
  CHECK ((outcome = 'not-run') = (not_run_reason IS NOT NULL)),
  CHECK ((not_run_reason IS 'not-set-up') = (prior_sha256 IS NULL)),
  CHECK ((prior_sha256 IS NULL) = (prior_films IS NULL)));
CREATE INDEX point_check_runs_by_case ON point_check_runs(case_id);
CREATE TABLE point_checks (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id         INTEGER NOT NULL REFERENCES point_check_runs(run_id) ON DELETE CASCADE,
  landmark_id    TEXT CHECK (landmark_id IS NULL OR length(landmark_id) BETWEEN 1 AND 16),
  action         TEXT NOT NULL CHECK (action IN ('flagged', 'film-unusual')),
  points         TEXT CHECK (points IS NULL OR length(points) BETWEEN 1 AND 200),
  tail           REAL CHECK (tail IS NULL OR (tail >= 0 AND tail < 1)),
  off_px         REAL CHECK (off_px IS NULL OR off_px >= 0),
  expected_x     REAL, expected_y REAL,
  ring_rx        REAL CHECK (ring_rx IS NULL OR ring_rx > 0),
  ring_ry        REAL CHECK (ring_ry IS NULL OR ring_ry > 0),
  ring_angle_deg REAL,
  CHECK ((action = 'film-unusual') = (landmark_id IS NULL)),
  CHECK ((action = 'film-unusual') = (points IS NOT NULL)),
  UNIQUE (run_id, landmark_id));
CREATE UNIQUE INDEX point_checks_one_film_flag ON point_checks(run_id) WHERE landmark_id IS NULL;
CREATE TABLE point_check_resolutions (
  check_id    INTEGER PRIMARY KEY REFERENCES point_checks(id) ON DELETE CASCADE,
  how         TEXT NOT NULL CHECK (how IN ('accepted', 'moved', 'placed', 'film-checked')),
  operator    TEXT NOT NULL CHECK (length(operator) BETWEEN 1 AND 80),
  resolved_at TEXT NOT NULL CHECK (length(resolved_at) BETWEEN 1 AND 40));
