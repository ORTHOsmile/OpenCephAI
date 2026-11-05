-- Format 18 — norms Auto population (spec §4.1 and
-- §4.8; ruling NAP-Q5 (a), 29 Oct 2026: 16 is the Library table, 17 Tier 3 Stage A). Only after
-- AUTOBACKUP-1: the safety copy holds the library exactly as it was before the switch below.
-- Never amend after release; if it must change before release, add a check_shape case as 011 did.

-- §4.1 (owner decision 1, NAP-Q2 (a)): the patient's recorded background, used only to choose the reference population
-- when a case is on Auto. NULL = not recorded, which every existing patient starts as. A population id from
-- reference/norms/populations.json, or 'other'. Never read off a film, never taught to the machine, never exported.
ALTER TABLE patients ADD COLUMN background TEXT CHECK (background IS NULL OR length(background) BETWEEN 1 AND 40);

-- §4.8 (owner NAP-Q3 (b)): every case on "Clinic default" (population NULL) is switched to Auto. The record is written
-- FIRST, one row per switched case: what it held (NULL = "Clinic default"), when, and — set later by the per-case
-- undo, "Clinic default (as before the upgrade)" — when it was put back. No foreign key: the record outlives a film
-- emptied from Recently deleted (as format 15's change record does). Cases with a population chosen by hand are untouched.
CREATE TABLE population_switches (
  case_id TEXT PRIMARY KEY,
  previous_population TEXT,
  switched_at TEXT NOT NULL CHECK (length(switched_at) BETWEEN 1 AND 40),
  undone_at TEXT CHECK (undone_at IS NULL OR length(undone_at) BETWEEN 1 AND 40));
INSERT INTO population_switches (case_id, previous_population, switched_at)
  SELECT id, NULL, strftime('%Y-%m-%dT%H:%M:%fZ', 'now') FROM cases WHERE population IS NULL;
UPDATE cases SET population = 'auto' WHERE population IS NULL;

-- Final review I4 (2 Nov 2026): from here on the library records which upgrade took it to each format (the SHA-256 of
-- the upgrade's SQL, written by the app as each one commits; 17 is recorded with 18). An app whose upgrade at a format
-- the library already passed is a different file then refuses the library, unchanged, instead of skipping it. Format
-- 17 is a placeholder: Tier 3 Stage A appends after 18 and never takes 17's place.
CREATE TABLE applied_migrations (
  version INTEGER PRIMARY KEY CHECK (version >= 1),
  sha256 TEXT NOT NULL CHECK (length(sha256) = 64));
