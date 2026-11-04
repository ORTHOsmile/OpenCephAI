-- CephTrace library, schema 1 (plan §3.2, decision 16). Portable SQL: no SQLite-only types.
-- Timestamps are ISO-8601 UTC text with milliseconds.

CREATE TABLE patients (
  id           TEXT PRIMARY KEY,
  display_name TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL
);

-- One row per distinct film (content hash); the file is images/<sha256>.<ext>.
CREATE TABLE images (
  sha256        TEXT PRIMARY KEY,
  ext           TEXT NOT NULL,
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  bytes         INTEGER NOT NULL,
  original_name TEXT NOT NULL,
  imported_at   TEXT NOT NULL
);

CREATE TABLE cases (
  id           TEXT PRIMARY KEY,
  patient_id   TEXT NOT NULL REFERENCES patients(id),
  image_sha256 TEXT NOT NULL REFERENCES images(sha256),
  timepoint    TEXT NOT NULL,
  taken_on     TEXT,
  facing       TEXT NOT NULL DEFAULT 'right' CHECK (facing IN ('right', 'left')),
  orientation  TEXT NOT NULL DEFAULT '{"mirror":false,"rotDeg":0,"source":"none"}',
  display      TEXT NOT NULL DEFAULT '{}',
  spacing_mm   REAL CHECK (spacing_mm IS NULL OR spacing_mm > 0),
  verified_at  TEXT,
  verified_by  TEXT,
  created_at   TEXT NOT NULL,
  updated_at   TEXT NOT NULL,
  deleted_at   TEXT
);
CREATE INDEX cases_by_image ON cases(image_sha256);

-- Current position of each landmark in a case (canonical image px, pixel-centre convention, §2).
CREATE TABLE landmarks (
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  x          REAL NOT NULL,
  y          REAL NOT NULL,
  source     TEXT NOT NULL CHECK (source IN ('ai', 'ai-adjusted', 'manual')),
  verified   INTEGER NOT NULL CHECK (verified IN (0, 1)),
  ai_x       REAL,
  ai_y       REAL,
  confidence REAL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (case_id, id)
);

-- Append-only audit of every change (AI placement, move, accept, removal).
CREATE TABLE landmark_events (
  seq      INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id  TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  landmark TEXT NOT NULL,
  kind     TEXT NOT NULL CHECK (kind IN ('ai', 'move', 'accept', 'remove')),
  x        REAL,
  y        REAL,
  source   TEXT,
  operator TEXT NOT NULL,
  at       TEXT NOT NULL
);
CREATE INDEX landmark_events_by_case ON landmark_events(case_id, seq);

CREATE TABLE ai_runs (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id            TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  model_id           TEXT NOT NULL,
  execution_provider TEXT NOT NULL,
  facing             TEXT NOT NULL,
  total_ms           REAL NOT NULL,
  ran_at             TEXT NOT NULL
);

-- Ruler calibrations, kept for audit (decision 17): the two marks, the true distance, who, when.
CREATE TABLE calibrations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  x1 REAL NOT NULL, y1 REAL NOT NULL, x2 REAL NOT NULL, y2 REAL NOT NULL,
  mm         REAL NOT NULL CHECK (mm > 0),
  spacing_mm REAL NOT NULL CHECK (spacing_mm > 0),
  operator   TEXT NOT NULL,
  at         TEXT NOT NULL
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
