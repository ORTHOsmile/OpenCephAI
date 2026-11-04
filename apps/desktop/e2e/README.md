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
| `e2e10.cjs` | Part D: calibrate to show, the analysis picker, a measurement waiting on a hand-placed point, a user norm entered and used, closed and reopened state |
| `e2e11.cjs` | Cross-check: old cases untouched by the main-model switch (opened, closed and reopened, every measurement row); Re-detect places with Aariz and says so; Aariz failing on a film keeps today's behaviour; "recommended" in Models…; Task 10: the source line survives reopening from the stored `placedBy`, and the next save keeps it (the flags themselves are parked, PARK-FLAGS 15 Oct) |
| `e2e12.cjs` | Film details: patient details learned from the label, Text on the film drop-downs, Settings › Text on the film |
| `e2e13.cjs` | "My analysis": shown beside the built-ins, per clinician; same values and norms as the built-ins; no longer available; Settings editor; export/import |

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
