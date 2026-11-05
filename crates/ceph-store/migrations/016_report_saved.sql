-- Format 16 (Library ▸ Table "Report" column; owner decision, 29 Oct 2026): when a PDF report of this film was last
-- saved, so the Library can show it. Only after AUTOBACKUP-1. Nothing already stored changes: one new column, blank
-- (NULL) on every film already in the library, meaning "no report saved" (none was ever recorded before format 16).
-- Written by the app only after the PDF file itself was written successfully (`export_write`); a cancelled or failed
-- save never sets it. Not a measurement: no number, threshold or frozen value depends on it.
-- Never amend after release; if it must change before release, add a check_shape case as 011 did.
-- Tier 3 Stage A's point-check tables, planned as format 16, become format 17.
ALTER TABLE cases ADD COLUMN report_saved_at TEXT CHECK (report_saved_at IS NULL OR length(report_saved_at) BETWEEN 1 AND 40);
