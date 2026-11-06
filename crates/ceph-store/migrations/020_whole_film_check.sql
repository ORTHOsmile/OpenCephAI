-- Format 20 — SC-1 Part 1, the whole-film check (design §8).
-- A note only: nothing here moves or changes a point. Only after AUTOBACKUP-1's checked safety copy. Every old row unchanged.
-- Append-only: no row is ever changed; rows are removed only with their film, when Recently deleted is emptied.
-- Never amend after release; the library records this file's SHA-256. Part 2's table takes its own number (ruling OQ-7).
CREATE TABLE film_regions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id           TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  model_fingerprint TEXT NOT NULL CHECK (length(model_fingerprint) = 64),
  model_version     TEXT NOT NULL CHECK (length(model_version) BETWEEN 1 AND 100),
  facing            TEXT CHECK (facing IS NULL OR facing IN ('right', 'left')),
  found_at          TEXT NOT NULL CHECK (length(found_at) BETWEEN 1 AND 40),
  UNIQUE (case_id, model_fingerprint));
CREATE TABLE film_region_boxes (
  run_id  INTEGER NOT NULL REFERENCES film_regions(id) ON DELETE CASCADE,
  region  TEXT NOT NULL CHECK (region IN ('cranial-base', 'maxilla', 'mandible', 'incisors', 'soft-tissue')),
  found   INTEGER NOT NULL CHECK (found IN (0, 1)),
  x0 REAL, y0 REAL, x1 REAL, y1 REAL,
  score   REAL NOT NULL CHECK (score >= 0 AND score <= 1),
  CHECK ((found = 1) = (x0 IS NOT NULL AND y0 IS NOT NULL AND x1 IS NOT NULL AND y1 IS NOT NULL)),
  CHECK (found = 0 OR (x0 < x1 AND y0 < y1)),
  PRIMARY KEY (run_id, region));
CREATE TABLE whole_film_checks (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  case_id          TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  subject          TEXT NOT NULL CHECK (subject IN ('run', 'final')),
  run_id           INTEGER REFERENCES ai_runs(id) ON DELETE CASCADE,
  rule_version     TEXT NOT NULL CHECK (rule_version LIKE 'whole-film/%' AND length(rule_version) <= 20),
  prior_sha256     TEXT CHECK (prior_sha256 IS NULL OR length(prior_sha256) = 64),
  prior_films      INTEGER CHECK (prior_films IS NULL OR prior_films >= 1),
  region_run_id    INTEGER REFERENCES film_regions(id) ON DELETE CASCADE,
  tau_cranial_base REAL, tau_maxilla REAL, tau_mandible REAL, tau_incisors REAL, tau_soft_tissue REAL,
  outcome          TEXT NOT NULL CHECK (outcome IN ('clean', 'flagged', 'not-run')),
  shape_look       TEXT NOT NULL CHECK (shape_look IN ('judged', 'too-few-points', 'not-set-up')),
  region_look      TEXT NOT NULL CHECK (region_look IN ('judged', 'no-region-model', 'not-set-up', 'film-too-small')),
  present          INTEGER NOT NULL CHECK (present BETWEEN 0 AND 19),
  d2 REAL, d2_mirror REAL, line REAL,
  -- Part 1b (amended before format 20's first release): the size look (sc1-size/1) and the cranial-base centre (sc1-cb-centre/1).
  -- A whole-film/1 row, or a look that did not run, reads size_look 'not-set-up' and NULLs. The centre look keeps its own status (cb_look) and how many of its five points were traced (cb_present).
  size_look        TEXT NOT NULL DEFAULT 'not-set-up' CHECK (size_look IN ('judged', 'not-set-up', 'no-region-model', 'film-too-small', 'too-few')),
  size_q REAL, size_centre REAL, size_line REAL,
  cb_distance REAL, cb_line REAL,
  -- The centre look's status (the same five keys); judged exactly when its pair is set. Added in D2 fix round 1, before the first release.
  cb_present       INTEGER NOT NULL DEFAULT 0 CHECK (cb_present BETWEEN 0 AND 5),
  cb_look          TEXT NOT NULL DEFAULT 'not-set-up' CHECK (cb_look IN ('judged', 'not-set-up', 'no-region-model', 'film-too-small', 'too-few')),
  checked_at       TEXT NOT NULL CHECK (length(checked_at) BETWEEN 1 AND 40),
  CHECK ((subject = 'run') = (run_id IS NOT NULL)),
  CHECK ((shape_look = 'judged') = (d2 IS NOT NULL AND d2_mirror IS NOT NULL AND line IS NOT NULL)),
  CHECK ((size_look = 'judged') = (size_q IS NOT NULL AND size_centre IS NOT NULL AND size_line IS NOT NULL)),
  CHECK ((cb_distance IS NULL) = (cb_line IS NULL)),
  CHECK ((cb_look = 'judged') = (cb_distance IS NOT NULL)),
  CHECK (cb_look <> 'judged' OR cb_present = 5),
  CHECK (region_look = 'judged' OR (size_look <> 'judged' AND cb_look <> 'judged')),
  CHECK ((shape_look = 'not-set-up') = (prior_sha256 IS NULL)),
  CHECK ((prior_sha256 IS NULL) = (prior_films IS NULL)),
  CHECK ((region_look = 'judged') = (region_run_id IS NOT NULL)),
  CHECK ((region_run_id IS NULL) = (tau_cranial_base IS NULL) AND (region_run_id IS NULL) = (tau_maxilla IS NULL)
     AND (region_run_id IS NULL) = (tau_mandible IS NULL) AND (region_run_id IS NULL) = (tau_incisors IS NULL)
     AND (region_run_id IS NULL) = (tau_soft_tissue IS NULL)),
  CHECK (region_run_id IS NULL OR (tau_cranial_base >= 0 AND tau_maxilla >= 0 AND tau_mandible >= 0 AND tau_incisors >= 0 AND tau_soft_tissue >= 0)),
  CHECK ((outcome = 'not-run') = (shape_look <> 'judged' AND region_look <> 'judged')));
CREATE UNIQUE INDEX whole_film_checks_one_per_run ON whole_film_checks(run_id) WHERE run_id IS NOT NULL;
CREATE INDEX whole_film_checks_by_case ON whole_film_checks(case_id);
CREATE TABLE whole_film_check_reasons (
  check_id INTEGER NOT NULL REFERENCES whole_film_checks(id) ON DELETE CASCADE,
  reason   TEXT NOT NULL CHECK (reason IN ('mirrored', 'shape', 'region', 'size', 'facing', 'no-ceph-found')),
  region   TEXT CHECK (region IS NULL OR region IN ('cranial-base', 'maxilla', 'mandible', 'incisors', 'soft-tissue')),
  detail   TEXT CHECK (detail IS NULL OR length(detail) BETWEEN 1 AND 400),
  CHECK ((reason = 'region') = (region IS NOT NULL)),
  CHECK (reason <> 'region' OR detail IS NOT NULL));
CREATE UNIQUE INDEX whole_film_check_reasons_once ON whole_film_check_reasons(check_id, reason, COALESCE(region, ''));
CREATE TABLE whole_film_check_resolutions (
  check_id    INTEGER PRIMARY KEY REFERENCES whole_film_checks(id) ON DELETE CASCADE,
  how         TEXT NOT NULL CHECK (how = 'checked'),
  reason      TEXT NOT NULL CHECK (reason IN ('tracing-right', 'expected-variant', 'corrected-tracing')),
  operator    TEXT NOT NULL CHECK (length(operator) BETWEEN 1 AND 80),
  resolved_at TEXT NOT NULL CHECK (length(resolved_at) BETWEEN 1 AND 40));
CREATE TRIGGER film_regions_never_changed BEFORE UPDATE ON film_regions BEGIN SELECT RAISE(ABORT, 'a region finder run is never changed'); END;
CREATE TRIGGER film_regions_kept_with_the_film BEFORE DELETE ON film_regions
  WHEN EXISTS (SELECT 1 FROM cases WHERE id = OLD.case_id AND deleted_at IS NULL)
  BEGIN SELECT RAISE(ABORT, 'a region finder run is removed only with its film'); END;
CREATE TRIGGER film_region_boxes_never_changed BEFORE UPDATE ON film_region_boxes BEGIN SELECT RAISE(ABORT, 'a region box is never changed'); END;
CREATE TRIGGER film_region_boxes_kept_with_the_film BEFORE DELETE ON film_region_boxes
  WHEN EXISTS (SELECT 1 FROM film_regions r JOIN cases c ON c.id = r.case_id WHERE r.id = OLD.run_id AND c.deleted_at IS NULL)
  BEGIN SELECT RAISE(ABORT, 'a region box is removed only with its film'); END;
CREATE TRIGGER whole_film_checks_never_changed BEFORE UPDATE ON whole_film_checks BEGIN SELECT RAISE(ABORT, 'a whole-film check is never changed'); END;
CREATE TRIGGER whole_film_checks_kept_with_the_film BEFORE DELETE ON whole_film_checks
  WHEN EXISTS (SELECT 1 FROM cases WHERE id = OLD.case_id AND deleted_at IS NULL)
  BEGIN SELECT RAISE(ABORT, 'a whole-film check is removed only with its film'); END;
CREATE TRIGGER whole_film_check_reasons_never_changed BEFORE UPDATE ON whole_film_check_reasons BEGIN SELECT RAISE(ABORT, 'a whole-film reason is never changed'); END;
CREATE TRIGGER whole_film_check_reasons_kept_with_the_film BEFORE DELETE ON whole_film_check_reasons
  WHEN EXISTS (SELECT 1 FROM whole_film_checks w JOIN cases c ON c.id = w.case_id WHERE w.id = OLD.check_id AND c.deleted_at IS NULL)
  BEGIN SELECT RAISE(ABORT, 'a whole-film reason is removed only with its film'); END;
CREATE TRIGGER whole_film_check_resolutions_never_changed BEFORE UPDATE ON whole_film_check_resolutions BEGIN SELECT RAISE(ABORT, 'a resolution and its reason are never amended'); END;
CREATE TRIGGER whole_film_check_resolutions_kept_with_the_film BEFORE DELETE ON whole_film_check_resolutions
  WHEN EXISTS (SELECT 1 FROM whole_film_checks w JOIN cases c ON c.id = w.case_id WHERE w.id = OLD.check_id AND c.deleted_at IS NULL)
  BEGIN SELECT RAISE(ABORT, 'a resolution is removed only with its film'); END;
