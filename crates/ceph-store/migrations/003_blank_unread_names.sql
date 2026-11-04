-- Schema 3 (owner, 29 Sep: a wrong name is worse than a blank one). A case whose name nobody has confirmed and that did
-- not come from a labelled field on the film (a guessed line, or the file name) is moved to an unnamed patient of its
-- own, keeping any date of birth. schema.rs does the move right after this script (each patient needs a new id).
SELECT 1;
