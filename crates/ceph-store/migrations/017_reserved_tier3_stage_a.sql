-- Format 17 — a placeholder. It was reserved for Tier 3 Stage A's point-check tables (ruling NAP-Q5 (a), 29 Oct 2026), but the format number is the count of upgrades, so 18 (the norms Auto population)
-- needs a 17 before it. It changes nothing: no table, no column, no row. Tier 3 Stage A appends AFTER format 18 (as 019 or later); it never takes this file's place: a
-- library opened by any build containing this file has passed 17, and from 18 on the library records which upgrade
-- ran at each format, so a different 017 would be refused (final review I4, 2 Nov 2026). Not a measurement: no
-- number, threshold or frozen value depends on it.
SELECT 1;
