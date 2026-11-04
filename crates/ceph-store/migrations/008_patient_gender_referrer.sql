-- CephTrace library, schema 8 (spec 2026-10-04): the patient's gender and referring practitioner, read off the film
-- or typed. NULL = not recorded, which every existing patient starts as. Saved on the patient, so every film of that
-- patient shows them.
ALTER TABLE patients ADD COLUMN gender TEXT CHECK (gender IS NULL OR gender IN ('F', 'M'));
ALTER TABLE patients ADD COLUMN referring_practitioner TEXT;
