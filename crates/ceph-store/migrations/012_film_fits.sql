-- Format 12 (spec 2026-10-17 G; owner answers G1–G3, 17 Oct): a film's fit to another film of the same patient on the
-- Superimposition page, stored with the film. Only after AUTOBACKUP-1. Nothing already stored changes: the table starts
-- empty, and a film with no row here is compared exactly as before. It never holds a ruler calibration:
-- cases.spacing_mm is untouched by a fit (owner G2: a ruler-calibrated film is never rescaled).
-- Never amend after release; if it must change before release, add a `check_shape` case as 011 did.
-- Amended once before any release (ruling, Task 4 fix round 1, 19 Oct: case_id NOT NULL). Only temporary
-- test libraries were ever opened with the first version (no app was built from it), so no `check_shape` case.
CREATE TABLE film_fits (
  case_id     TEXT NOT NULL PRIMARY KEY REFERENCES cases(id) ON DELETE CASCADE,  -- the fitted film (one fit per film; NOT NULL: a TEXT key otherwise takes NULL)
  ref_case_id TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,         -- the film it is fitted to
  ref_kind    TEXT NOT NULL CHECK (ref_kind IN ('sn', 'points')),            -- S–N, or two points the operator picked
  ref_x1  REAL NOT NULL CHECK (ref_x1  BETWEEN -1e6 AND 1e6), ref_y1  REAL NOT NULL CHECK (ref_y1  BETWEEN -1e6 AND 1e6),   -- on the reference, image px
  ref_x2  REAL NOT NULL CHECK (ref_x2  BETWEEN -1e6 AND 1e6), ref_y2  REAL NOT NULL CHECK (ref_y2  BETWEEN -1e6 AND 1e6),
  film_x1 REAL NOT NULL CHECK (film_x1 BETWEEN -1e6 AND 1e6), film_y1 REAL NOT NULL CHECK (film_y1 BETWEEN -1e6 AND 1e6), -- on this film, image px
  film_x2 REAL NOT NULL CHECK (film_x2 BETWEEN -1e6 AND 1e6), film_y2 REAL NOT NULL CHECK (film_y2 BETWEEN -1e6 AND 1e6),
  mirror   INTEGER NOT NULL CHECK (mirror IN (0, 1)),                          -- 1: the films face opposite ways
  scale    REAL NOT NULL CHECK (scale BETWEEN 0.2 AND 5.0),                    -- reference px per film px (NaN binds as NULL)
  rotation REAL NOT NULL CHECK (rotation BETWEEN -4.0 AND 4.0),                -- radians
  dx REAL NOT NULL CHECK (dx BETWEEN -1e6 AND 1e6), dy REAL NOT NULL CHECK (dy BETWEEN -1e6 AND 1e6),   -- reference px
  use_own  INTEGER NOT NULL DEFAULT 0 CHECK (use_own IN (0, 1)),               -- owner G2: "Use the scale from the fit"
  saved_by TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  CHECK (ref_case_id != case_id)
);
CREATE INDEX film_fits_by_ref ON film_fits(ref_case_id);
