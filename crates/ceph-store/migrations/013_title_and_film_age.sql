-- Format 13 (spec 2026-10-19 D/E; owner T1 and AG1, 19 Oct): the patient's title, and the age on each X-ray; and a
-- calibrated scale per X-ray machine (spec 2026-10-20, owner MS1–MS4, 20 Oct). Only after AUTOBACKUP-1. Nothing
-- already stored changes; every new value starts blank (NULL).
-- Never amend after release; if it must change before release, add a check_shape case as 011 did.
-- Title as printed (Mr, Mrs, Ms, Miss, Mx, Master, Mast, Mstr, Dr, Prof; with or without a dot; any case), on the
-- patient like Gender. The words are checked by the app (details::title_value); here, as 011, only its length.
ALTER TABLE patients ADD COLUMN title TEXT CHECK (title IS NULL OR length(title) BETWEEN 1 AND 200);
-- The age printed on (or typed for) THIS X-ray, as printed ("011Y", "11 yrs 3 mths"), and the same age in years.
-- Used for the norm's age row only when the patient has no date of birth (owner AG1: the DOB always wins).
ALTER TABLE cases ADD COLUMN age_on_film TEXT CHECK (age_on_film IS NULL OR length(age_on_film) BETWEEN 1 AND 200);
ALTER TABLE cases ADD COLUMN age_on_film_years REAL
  CHECK (age_on_film_years IS NULL OR (age_on_film_years > 0 AND age_on_film_years <= 120))
  CHECK ((age_on_film IS NULL) = (age_on_film_years IS NULL));   -- both or neither (NaN binds as NULL)
-- A machine's calibrated scale (spec 2026-10-20; owner MS1–MS4): measured once, from a ruler-calibrated film of the
-- machine ("film:<case id>") or typed ("entered"), and the exact film size in pixels it holds for. Used for every film
-- of the machine with exactly that size and no ruler of its own (the app works that out; nothing is written to a film).
-- All five blank: no scale. 9e999 reads as infinity, so "< 9e999" refuses it (NaN binds as NULL).
ALTER TABLE layout_machines ADD COLUMN spacing_mm REAL CHECK (spacing_mm IS NULL OR (spacing_mm > 0 AND spacing_mm < 9e999));
ALTER TABLE layout_machines ADD COLUMN width_px INTEGER CHECK (width_px IS NULL OR (typeof(width_px) = 'integer' AND width_px > 0));
ALTER TABLE layout_machines ADD COLUMN height_px INTEGER CHECK (height_px IS NULL OR (typeof(height_px) = 'integer' AND height_px > 0));
ALTER TABLE layout_machines ADD COLUMN scale_source TEXT
  CHECK (scale_source IS NULL OR scale_source = 'entered' OR (substr(scale_source, 1, 5) = 'film:' AND length(scale_source) BETWEEN 6 AND 200));
ALTER TABLE layout_machines ADD COLUMN scale_set_at TEXT
  CHECK ((spacing_mm IS NULL) = (width_px IS NULL) AND (spacing_mm IS NULL) = (height_px IS NULL)
     AND (spacing_mm IS NULL) = (scale_source IS NULL) AND (spacing_mm IS NULL) = (scale_set_at IS NULL));   -- all or none
