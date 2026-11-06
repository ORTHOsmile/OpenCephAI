# Browser smokes

End-to-end checks of the built app in Chromium, with the Tauri runtime stubbed out and a fake library kept in
`localStorage`. Everything here is synthetic: a generated grey test image, and names such as
"Demo Synthetic". Any line that carries a date of birth is marked SYNTHETIC. Never put a real film, name or date here.

| Smoke | Covers |
|-------|--------|
| `e2e3.cjs` | Library, import, tracing, calibration, Enhance, backup |
| `e2e4.cjs` | Patient details from the label, Text on the film, the comparison and its order |
| `e2e5.cjs` | Choose on the film, learned machine layouts, Film layouts |
| `e2e6.cjs` | Serial superimposition (T1 … Tn), ABO stage colours, and the left-panel sections |
| `e2e7.cjs` | Model Manager: the models list, licence/tier badges, install/accept flow |
| `e2e8.cjs` | Ghost marks: extra models' points stored and drawn as ghosts, key and hover distance, timed-out/busy outcomes |
| `e2e9.cjs` | "Who is tracing": the toolbar picker, adding a name, sign-off credited to the chosen orthodontist |
| `e2e10.cjs` | Part D: calibrate to show, the analysis picker, a measurement waiting on a hand-placed point, a user norm entered and used, closed and reopened state; norms-auto: the Compare window's own norms or "—" (AUTO-Q7), Auto norms and the norm list ("◆ Auto" first, in use, choosing Auto clears the pick; N-A2/N-A3, AUTO-Q6), no ideal/SD-borrowed/assumed-scale tags with their words on the source hover (C1, J), decimals on the Norms page (I) |
| `e2e11.cjs` | Cross-check: old cases untouched by the main-model switch (opened, closed and reopened, every measurement row); Re-detect places with Aariz and says so; Aariz failing on a film keeps today's behaviour; "recommended" in Models…; Task 10: the source line survives reopening from the stored `placedBy`, and the next save keeps it (the flags themselves are parked, PARK-FLAGS 15 Oct) |
| `e2e12.cjs` | Film details: patient details learned from the label, Text on the film drop-downs, Settings › Text on the film |
| `e2e13.cjs` | "My analysis": shown beside the built-ins, per clinician; same values and norms as the built-ins; no longer available; Settings editor; export/import |
| `e2e14.cjs` | Report and exports (spec 2026-10-17 report-exports): Export › enabled/greyed, the Report preview's rows and header; words changed for this film kept, offered back when stale, Reset; the open film is frozen behind the preview (an arrow key does not move the active point); Export › greyed on Superimposition; Save PDF…/Export CSV… (A4/Letter, with/without the film, cancel, a failed write, Named/Anonymised, wide layout, the salt); F1–F5 (request G merge, R3): a film with no ruler on a fit's scale — the preview's header, † and note, its CSV's `scale` cell, and Library ▸ Export CSV… giving the same value cells as the preview's CSV; T10-1–T10-3 (norms-auto Task 10, ruling I5): no clinic default and no case population → no ◆, no Auto footnote; E-line on, still no population → the unstated-enlargement list names Ricketts 1960; a Japanese case → the ◆ and "◆ No Japanese norm" footnote |
| `e2e15.cjs` | Request G: B0 (no fit: every number and outline equals main's golden), then the fit, its marks, the panel, the advice and "Use the scale from the fit" |
| `e2e17.cjs` | Spec 2026-10-19: the status row (Accepted, Accept Positions / remaining, the sign-off beside them), double-click and ⌘-click, the automatic sign-off and its holds, the Library card's words, and the ruler marks that stay |
| `e2e18.cjs` | Spec 2026-10-19 addendum: block H (Task 9) — the AI line under the film hides while the tracing is signed off, back on ⌘Z/calibrate/Reopen, never shown with no AI points; block J (Task 11, film side) — the Measurements scale line reads "calibrated scale" / "assumed scale", before and after calibrating, and on the read-only page |
| `e2e19.cjs` | Part F: Best model per point in Models… (offer, the films that decided, numbers, films per scale, left-out films, accept asked first, switch listed, closed and reopened, a locked or read-only library leaves Accept and Undo answered with the notice and nothing changed, Re-detect places the switched point from the chosen model, the label and its hover, how points were accepted, undo, decline, refused answer, read failure, the weights check running with its progress and ETA, films it could not run, a point with no older films to compare, a worse new file warned with the way back to Aariz) |
| `e2e20.cjs` | Automatic best: the upgrade note and its way back; Models…'s row, Aariz "(recommended)", Part F's Accept hidden while it is main; a film in two steps (Go waits for SRPose, sign-off waits too); the label and hover; the note and Undo (locked, then saved); reopened labels; Use again; its ghost beside a fixed main model; useAutoBest.ts's only coverage — no note while a fixed model is main, a newer change at the same point replaces the older note |
| `e2e21.cjs` | Library ▸ Table (owner decisions, 29 Oct 2026): the PATIENTS sidebar list gone; the Pictures/Table switch, remembered across a reload; the Table's columns, patient grouping and header-click sorting (with a keyboard check); the search bar filtering the Table the same way it filters Pictures; a row opening a film; the AI status column's words |
| `e2e23.cjs` | Stage A task 6, the point check on the film: the mark `Check: far outside the usual position` beside a flagged pin (only that pin), its hover words and ring (assumed scale says "an estimate"); the pin not moved; a left-facing film (shown flipped) says "further right" where the unflipped one says "further left"; the read-only Superimposition page shows the mark and no button; closed and reopened (and the app closed and opened) gives the same mark; nothing flagged, nothing read yet, no runs: no mark and no line; "Point check not set up." and "Point check not run: only 9 of 19 points found." under the film; a film that looks unusual marks no pin and calls no point wrong; a run of 15 points with one flag; N not placed; three flagged points; another model's flag does not mark this model's pin; Task 8: the report's Points table and the points CSV end with `point_check` (flagged / film-unusual / blank; the placing model's flag only; a flag from another model leaves it blank; film never checked, not run, nothing flagged, flagged then resolved, film unusual resolved and not), the CSV is the same in every other cell and the same after closing and reopening, and Models… says "Nasion: flagged 12 times, you left it 5 times" (singular, none yet, a failed read) ; Task 9: the note "Extreme value for the norm" on an ANB row at 4.2 SD above and below, not at 3.9, none with no SD or no norm chosen or on a hidden mm row, stars and colour identical at 3.5 and 4.5 SD, no point moved, none on the Chart tab |
| `e2e24.cjs` | SC-1 Part 1 tasks 8 and 9 (task 9: the `whole_film_check` column (with the research switch on: then `whole_film_region` and six `whole_film_look_*` columns after it) right after `point_check` in the report's Points table and the points CSV: flagged, clean, not-run, checked, no record, mirrored with facing, the same bytes after reopening, a failed read stops the export), the whole-film note on the film: a mandible region flag in the owner's words (the stored key mapped to words) with the hover words, mirrored without the facing line (facing alone is shown), two or more regions as one combined line, shape (furthest out named), no skull, no region finder / film too small / too few points / not set up lines (no button), a clean judged check and nothing read yet / no record / shown null / a failed read give no note; `Checked` asks exactly the three reasons in the page (no browser dialog, no message box) and the stub receives the stored key; the resolved note reads `Checked: <reason>`; closed and reopened and the app closed and opened give the same; a signed-off film still offers `Checked` (OQ-6); the read-only Superimposition page shows the note and no button; an SC-1 note alone never holds sign-off (R3); with Stage A's film note too the film is held exactly as before and Stage A's `Checked` asks no reason |
| `e2e16.cjs` | The Patient fold and the Library ID fold; one list for the drop-down and the chooser on the film; Gender, Title and Age (spec 2026-10-19); CF1-CF3: the Delete case, Restore backup and Replace all confirms (No changes nothing, Yes does it) |

**R21's known limit (Task 9 fix round 1, review I1):** R21 ("a word typed just before Export CSV… is in the
file") exercises the real race end to end, but it cannot FAIL it: this smoke's fake `settings_set` (the Tauri IPC
stub above) resolves in a microtask, so React has already re-rendered with the saved word by the time Playwright's
`click()` actually fires — regardless of whether `useReport`/`useReportWords` wait for the save at all. R21 stays
as the end-to-end check (it is still the only place that exercises the real click-then-save sequence through the
real UI), but the guard that can actually fail on this race is the deterministic unit test
`src/report/useReport.flush.test.ts`, which forces the race with a hand-resolved promise instead of relying on
timing.

Run them from `apps/desktop`:

```sh
./node_modules/.bin/vite build
./node_modules/.bin/vite preview --port 4173 --strictPort &   # leave it running
PREVIEW_PID=$!; sleep 1; kill -0 $PREVIEW_PID || echo "preview did not start (port 4173 held?)"
node e2e/run.cjs            # all smokes; or e.g. node e2e/run.cjs e2e6
```

`run.cjs` refuses to run (exit 2) unless the page served on port 4173 is byte for byte `dist/index.html`: if an old
preview still holds the port, `--strictPort` makes the new one fail, and without this check the smokes would test the
old build (final review M-4).

`run.cjs` generates `e2e/out/synthetic.png` on first use and exits non-zero if any check fails. Screenshots go to
`e2e/out/`, which git ignores. These environment variables override the defaults, which suit the cloud container:

- `PLAYWRIGHT_MODULE`: where `require` finds Playwright;
- `CHROMIUM_PATH`: the Chromium binary;
- `E2E_URL`: the served app.
