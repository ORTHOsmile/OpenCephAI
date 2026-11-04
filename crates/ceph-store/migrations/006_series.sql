-- Schema 6 (spec 2026-09-30): serial superimposition. A film's ABO stage (NULL = Auto, guessed from its place in the
-- series) and whether it is drawn in its patient's comparison.
ALTER TABLE cases ADD COLUMN stage TEXT CHECK (stage IS NULL OR stage IN ('initial', 'progress', 'final', 'retention'));
ALTER TABLE cases ADD COLUMN in_series INTEGER NOT NULL DEFAULT 1;
