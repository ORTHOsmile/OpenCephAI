-- Schema 4 (spec 2026-09-29): each X-ray machine's printing pattern and where it prints each detail, learned on this Mac.
-- Only positions, the film size and pattern words are stored; a word is stored as text only after it was seen in the
-- same place on films of two different confirmed patients (before that, a salted hash).
CREATE TABLE layout_machines (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  named_by_user INTEGER NOT NULL DEFAULT 0 CHECK (named_by_user IN (0, 1)),
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  films         INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE TABLE layout_anchors (
  machine_id  TEXT NOT NULL REFERENCES layout_machines(id) ON DELETE CASCADE,
  token       TEXT NOT NULL,
  text        TEXT NOT NULL,
  cx          REAL NOT NULL,
  cy          REAL NOT NULL
);
CREATE TABLE layout_candidates (
  machine_id  TEXT NOT NULL REFERENCES layout_machines(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  cx          REAL NOT NULL,
  cy          REAL NOT NULL,
  patient_id  TEXT NOT NULL   -- the confirmed patient's id, or 'pending:<case id>' for a film not yet confirmed (matching only)
);
CREATE INDEX layout_candidates_by_hash ON layout_candidates(machine_id, token_hash);
CREATE TABLE layout_places (
  machine_id  TEXT NOT NULL REFERENCES layout_machines(id) ON DELETE CASCADE,
  field       TEXT NOT NULL CHECK (field IN ('last', 'first', 'full', 'dob', 'film_date', 'scan_id')),
  row_y       REAL NOT NULL,
  side        TEXT NOT NULL CHECK (side IN ('left', 'right')),
  starts      TEXT NOT NULL,
  ends        TEXT NOT NULL,
  count       INTEGER NOT NULL,
  updated_at  TEXT NOT NULL
);
ALTER TABLE cases ADD COLUMN layout_machine_id TEXT REFERENCES layout_machines(id) ON DELETE SET NULL;
ALTER TABLE cases ADD COLUMN layout_mirrored INTEGER NOT NULL DEFAULT 0 CHECK (layout_mirrored IN (0, 1));
-- How far down this film sits from its machine's pattern (0–1 of the film's height): learned rows move with it.
ALTER TABLE cases ADD COLUMN layout_dy REAL NOT NULL DEFAULT 0;
-- Each case's one vote per field for a learned place (a case counts once; changing its answer moves its vote).
CREATE TABLE layout_votes (
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  field       TEXT NOT NULL,
  place       INTEGER NOT NULL,
  PRIMARY KEY (case_id, field)
);
-- Fields filled from a machine's learned default and not yet confirmed ("name,dob"): shown as "Learned for this machine".
ALTER TABLE cases ADD COLUMN learned_fields TEXT NOT NULL DEFAULT '';
