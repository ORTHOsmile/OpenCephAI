// SC-1 Part 1 task 8: the whole-film note on the film (spec §3.5, §5, §12; R3, RV-2, OQ-6). Its words and hover (a mandible region
// flag, mirrored without the facing line, two regions shown once, no region finder, too few points, shape, no skull), nothing
// read yet / no record / a failed read (no note, no crash), `Checked` asking one of three reasons in the page (no browser
// confirm), a signed-off film that still offers `Checked`, a read-only page that does not, closed then reopened, an SC-1 note
// that never holds sign-off while Stage A's film note still does, and Stage A's `Checked` asking no reason. The stub library
// resolves the way src-tauri/src/whole_film.rs `resolve` does (tested in Rust). Setup and stub pattern copied from e2e23.cjs.
// SC-1 Part 1b Task D2 (blocks (sz) and (sw) near the end): the size note (its words, factor, order, Checked, the CSV cell), the lines for a look
// that did not judge, and Settings › Checks: the "Whole-film check (beta)" switch with its line; unticked, the open film's note goes and the
// CSV cell reads `off`; ticked again the note is back. The stub's switch/off view mimic src-tauri/src/whole_film.rs (tested in Rust).
// The built UI in Chromium, Tauri stubbed, a fake library in localStorage. SYNTHETIC films, names and points only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const crypto = require('crypto');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const landmarks = Object.entries(base).map(([id, [x, y]]) => ({ id, x: x + 350, y: y + 300, confidence: 0.8 }));
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, landmarks }) => {
    window.__written = []; window.__wfReads = 0; window.__asked = 0;
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{"whole_film_in_reports":"1"},"films":0}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    // The switch: stored `wfOff` wins; with none stored the stub follows `wfDefaultOff` (the real first-run default is OFF until the PKU result is in).
    const offNow = (d) => (d.wfOff === undefined ? !!d.wfDefaultOff : !!d.wfOff);
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}, opts = {}) => {
        const db = load();
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: null, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: c.landmarks.filter((l) => !l.verified).length,
          verifiedAt: c.verifiedAt, deletedAt: null, patientKey: c.patientKey, dateOfBirth: null, identityChecked: true,
          libraryId: null, formerLibraryIds: [], printedPatientId: null });
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'models_points': return null;
          // Each Import… is a new synthetic film, so every block below starts on a fresh case (c1, c2, …).
          case 'plugin:dialog|open': { db.films += 1; store(db); const p = `/Users/demo/SYNTHETIC-film-${db.films}.png`; return a.options && a.options.multiple ? [p] : p; }
          case 'plugin:dialog|message': window.__asked += 1; return 'Yes';
          // Task 8: Save… / Export CSV… write into the page (window.__written), never to disk; Models… lists no models and reads the counts the test set.
          case 'plugin:dialog|save': return window.__nextSave ?? null;
          case 'export_write': window.__written.push({ path: decodeURIComponent(opts.headers.path), bytes: Array.from(a) }); return null;
          case 'system_font_list': return [];
          case 'operators_list': return { current: '', names: [] };
          case 'models_list': return [];
          case 'point_check_counts': if (db.countsFail) throw 'the counts could not be read'; return db.counts ?? [];
          case 'plugin:event|listen': return 1;
          // Block H (Task 9): a `noPoints` flag on the fake library switches the model to finding nothing, so a
          // freshly imported film carries no AI points at all.
          case 'detect_landmarks': { const lms = db.noPoints ? [] : landmarks.filter((l) => !(db.omit || []).includes(l.id));
            return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub', timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 },
              landmarks: lms, facingLeft: true, meanPeakRight: 4.9, meanPeakLeft: 12.6, raw: lms.map((l, i) => ({ channel: i, landmarkId: l.id, x: l.x, y: l.y, peak: 0.8 })) }; }
          // Stage A task 6: the stored point-check result, whatever the test put in `db.pc` (null: nothing read yet).
          // Fix round 1: `pcDelay` (ms) holds the read, `pcFail` makes it fail, to see the bulk accepts wait for it.
          case 'point_checks_for_case': if (db.pcDelay) await new Promise((r) => setTimeout(r, db.pcDelay)); if (db.pcFail) throw 'the check could not be read'; return load().pc ?? null;
          // SC-1 task 8: the whole-film view, whatever the test put in `db.wf` (null: no record; the back end then returns shown null).
          // `wfDelay` holds the read, `wfFail` makes it fail. The resolve is as whole_film.rs: only the shown, flagged check; the first reason stays.
          case 'whole_film_check': if (db.wfDelay) await new Promise((r) => setTimeout(r, db.wfDelay)); window.__wfReads += 1; if (db.wfFail) throw 'the whole-film check could not be read'; { const d = load(); if (offNow(d)) return { shown: null, checks: [], off: true }; return d.wf ?? { shown: null, checks: [], off: false }; }
          // Task D2: the switch (src-tauri whole_film.rs `whole_film_switch`, `whole_film_switch_set`): on unless `wfOff`; the line as with no PKU result yet.
          case 'whole_film_switch': { const d = load(); return { on: !offNow(d), isDefault: d.wfOff === undefined, line: 'Not yet tested on new films.' }; }
          case 'whole_film_switch_set': { const d = load(); d.wfOff = !a.on; d.wfSetCalls = (d.wfSetCalls || []).concat([a.on]); store(d); return { on: a.on, isDefault: false, line: 'Not yet tested on new films.' }; }
          case 'whole_film_check_resolve': { const d2 = load(); const w = d2.wf && d2.wf.shown; d2.wfCalls = (d2.wfCalls || []).concat([[a.checkId, a.reason]]);
            if (!['tracing-right', 'expected-variant', 'corrected-tracing'].includes(a.reason)) { store(d2); throw 'not a reason'; }
            if (!w || w.id !== a.checkId) { store(d2); throw 'not this film\'s shown check'; }
            if (w.outcome !== 'flagged') { store(d2); throw 'not flagged'; }
            const was = !!w.resolved; if (!was) w.resolved = { reason: a.reason, operator: 'SYNTHETIC-operator', resolvedAt: now() }; store(d2); return !was; }
          case 'library_ghosts': return [];
          // Whole-branch review I1: a model run is stored with its check. `recordDelay` (ms) holds the write, and `pcAfterRecord`
          // becomes the stored check only once the write lands, so a read that runs before it finds nothing (the race).
          case 'library_record_ai': if (db.recordDelay) await new Promise((r) => setTimeout(r, db.recordDelay));
            { const d2 = load(); if (d2.pcAfterRecord) { d2.pc = d2.pcAfterRecord; store(d2); } } return null;
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map(summary);
          case 'library_user_norms': return db.userNorms ?? [];
          case 'library_set_case_population': { db.cases[a.caseId].population = a.population; store(db); return null; }
          case 'settings_default_population_get': return 'caucasian';
          case 'library_import': {
            const id = 'c' + (Object.keys(db.cases).length + 1), n = id.slice(1);
            db.cases[id] = { id, path: a.path, patientName: `SYNTHETIC-film-${n}`, timepoint: 'T1', takenOn: null, facing: 'right', orientation: {}, display: {}, spacingMm: null,
              verifiedAt: null, verifiedBy: null, landmarks: [], calibrations: [], createdAt: now(), updatedAt: now(), deletedAt: null,
              patientKey: `synthetic film ${n}`, dateOfBirth: null, scanId: null, identitySource: 'manual', identityChecked: true, identityIssues: [],
              learnedFields: [], printedPatientId: null, xrayType: null, xraySize: null, radiographyPractice: null,
              libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [] };
            store(db); return { caseId: id, created: true };
          }
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC-film.png', path: c.path } }; }
          // As the store: any landmark change clears the sign-off.
          case 'library_save': { const c = db.cases[a.edit.id]; const wasVerified = new Set(c.landmarks.filter((x) => x.verified).map((x) => x.id)); const moved = JSON.stringify(c.landmarks) !== JSON.stringify(a.edit.landmarks);
            Object.assign(c, { facing: a.edit.facing, orientation: a.edit.orientation, display: a.edit.display, landmarks: a.edit.landmarks, updatedAt: now() });
            if (moved) { c.verifiedAt = null; c.verifiedBy = null; }
            // As resolve_on_save: a point flag is resolved when its point goes from unverified to verified in this save, unless a bulk accept did it.
            for (const f of (db.pc ? db.pc.flags : [])) { const l = f.landmarkId && !f.resolved && a.edit.landmarks.find((x) => x.id === f.landmarkId);
              if (l && l.verified && !wasVerified.has(l.id) && l.acceptKind !== 'bulk') f.resolved = l.source === 'manual' ? 'placed' : l.source === 'ai-adjusted' ? 'moved' : 'accepted'; }
            store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          // As film_checked: only a film row of the stored (latest) result.
          case 'point_check_film_checked': { const f = (db.pc ? db.pc.flags : []).find((x) => x.id === a.checkId && x.landmarkId === null);
            if (!f) throw 'not a film note on this film'; const was = !!f.resolved; if (!was) f.resolved = 'film-checked'; store(db); return !was; }
          // As the store: refused under 20 px; every calibration kept; clears the sign-off.
          case 'library_calibrate': { const c = db.cases[a.caseId], px = Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]);
            if (!(px >= 20)) throw `the marks are ${px.toFixed(1)} px apart; pick two ruler marks at least 20 px apart`;
            c.spacingMm = a.mm / px; c.verifiedAt = null; c.verifiedBy = null; c.calibrations.push({ p1: a.p1, p2: a.p2, mm: a.mm, spacingMm: c.spacingMm });
            store(db); return c.spacingMm; }
          // As Library::ruler: the newest calibration, while its scale stands.
          case 'library_ruler': { const c = db.cases[a.caseId], k = c.calibrations[c.calibrations.length - 1];
            return k && k.spacingMm === c.spacingMm ? { p1: k.p1, p2: k.p2, mm: k.mm } : null; }
          // As the store: refuses while any point is not accepted.
          case 'library_set_verified': { const c = db.cases[a.caseId], open = c.landmarks.filter((l) => !l.verified).length;
            if (a.verified && open) throw `${open} landmark(s) are still unverified`;
            Object.assign(c, a.verified ? { verifiedAt: now(), verifiedBy: 'SYNTHETIC-operator' } : { verifiedAt: null, verifiedBy: null }); store(db); return null; }
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png, landmarks });

  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')));
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true, () => false);
  const text = async (loc) => ((await loc.count()) ? loc.first().innerText() : '');
  const status = page.locator('.inspector .status-row');
  const remainingBtn = () => status.getByRole('button', { name: /^Accept remaining \(\d+\)$/ });
  const toLibrary = async () => { await page.getByRole('button', { name: '‹ Library' }).click(); await page.waitForSelector('.library'); };
  const importNew = async () => { await page.getByRole('button', { name: 'Import…' }).click(); await page.waitForSelector('g.landmark[data-id="S"]', { timeout: 4000 }).catch(() => {}); await page.waitForTimeout(700); };
  const calibrate = async (mm = '20') => {
    await page.keyboard.press('k'); const st = await page.locator('.stage').boundingBox();
    await page.mouse.click(st.x + st.width * 0.3, st.y + st.height * 0.7); await page.mouse.click(st.x + st.width * 0.6, st.y + st.height * 0.7);
    await page.waitForSelector('.calibrate-dialog'); await page.locator('.calibrate-dialog input').fill(mm);
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForSelector('.calibrate-dialog', { state: 'detached' });
  };

  const MODEL = 'SYNTHETIC-stub';
  const set = (patch) => page.evaluate((p) => { const d = JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{"whole_film_in_reports":"1"},"films":0}'); Object.assign(d, p); localStorage.setItem('fakeLib', JSON.stringify(d)); window.__wfReads = 0; }, patch);
  let dialogs = 0; page.on('dialog', (d) => { dialogs += 1; d.dismiss().catch(() => {}); });
  const openFilm = async (n, lib = true) => { if (lib) await toLibrary(); await page.locator('.cards .card', { hasText: `SYNTHETIC-film-${n}` }).locator('.open').click(); await page.waitForSelector('g.landmark[data-id="N"]'); };
  const verifiedIds = async (c) => (await db()).cases[c].landmarks.filter((l) => l.verified).map((l) => l.id);

  // The stored view, as the back end sends it: kebab-case keys everywhere.
  const check = (over = {}) => ({ id: 11, subject: 'run', modelId: MODEL, outcome: 'flagged', shapeLook: 'judged', regionLook: 'judged', present: 19, reasons: [], resolved: null, sizeLook: 'judged', cbLook: 'judged', cbPresent: 5, ...over });
  const region = (key, ids) => ({ reason: 'region', region: key, ids, named: [], factor: null });
  const reason = (r, over = {}) => ({ reason: r, region: null, ids: [], named: [], factor: null, ...over });
  const view = (shown) => ({ shown, checks: shown ? [shown] : [], off: false });
  const pcClean = { runs: [{ modelId: MODEL, outcome: 'clean', notRunReason: null, present: 19 }], flags: [] };
  const pcFilm = (id = 7) => ({ runs: [{ modelId: MODEL, outcome: 'film-unusual', notRunReason: null, present: 19 }],
    flags: [{ id, modelId: MODEL, landmarkId: null, action: 'film-unusual', points: 'N,S,B,Me', offPx: null, expectedX: null, expectedY: null, ring: null, resolved: null }] });
  const HOVER = 'A note, not a verdict. It checks the tracing against the film in boxes; it does not judge errors under about 10 mm.';
  const note = page.locator('.stage .whole-film-note');
  const stageA = page.locator('.stage .check-note:not(.whole-film-note)');
  const wBtn = () => note.getByRole('button', { name: 'Checked', exact: true });
  const aBtn = () => stageA.getByRole('button', { name: 'Checked', exact: true });
  const noteLines = async () => (await note.locator('.check-note-line:not(.whole-film-actions):not(:has(.whole-film-hover))').allInnerTexts());
  const noteBtns = async () => (await note.locator('button').allInnerTexts());
  const reads = () => page.evaluate(() => window.__wfReads);
  // A check that an element is absent first waits for the read it depends on (the instrument must have SEEN the answer).
  const readSeen = () => until(() => window.__wfReads > 0);
  const calls = async () => (await db()).wfCalls || [];

  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  // (a) one region (mandible): its line in the owner's words (region key mapped to words), the hover words, a Checked button.
  await set({ pc: pcClean, wf: view(check({ id: 11, reasons: [region('mandible', ['Me', 'Gn', 'Pog'])] })) });
  await importNew();                                                                      // c1
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('a1. mandible flag: the line, in words not keys', (await noteLines()).join('|') === 'Whole-film check: the mandible points do not sit on the mandible this film shows (Me, Gn, Pog).', (await noteLines()).join('|'));
  ok('a2. the hover words are on the "?" marker at the end, not on the lines', (await note.locator('.whole-film-hover').getAttribute('title')) === HOVER && (await note.locator('[title]').count()) === 1 && (await text(note.locator('.whole-film-hover'))) === '?');
  ok('a3. one Checked button, no reason buttons yet', (await noteBtns()).join('|') === 'Checked');
  ok('a4. nothing is called wrong, and the film note of Stage A is not there', !/is wrong|wrong tracing|error/i.test(await text(note)) && (await stageA.count()) === 0, await text(note));
  ok('a5. no pin moved: 19 pins', (await page.locator('g.landmark').count()) === 19);

  // (b) mirrored (the back end stores mirrored AND facing together): the mirrored line only, no facing line.
  await toLibrary(); await set({ wf: view(check({ id: 12, reasons: [reason('mirrored'), reason('facing')] })) }); await importNew();      // c2
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('b1. mirrored: its line only', (await noteLines()).join('|') === 'Whole-film check: this tracing looks mirrored: it faces the other way from the film.', (await noteLines()).join('|'));
  ok('b2. the facing line is not shown beside it', !/recorded facing/.test(await text(note)));
  // facing alone is shown.
  await toLibrary(); await set({ wf: view(check({ id: 13, reasons: [reason('facing')] })) }); await importNew();      // c3
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('b3. facing alone: the facing line', (await noteLines()).join('|') === "Whole-film check: the face on this film seems to point the other way from the film's recorded facing. Check the film's facing and Re-detect.");

  // (c) two or more regions: the combined line, once.
  await toLibrary(); await set({ wf: view(check({ id: 14, reasons: [region('maxilla', ['A', 'ANS']), region('mandible', ['Me']), region('soft-tissue', ['Sn'])] })) }); await importNew();      // c4
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  const cl = await noteLines();
  ok('c1. three regions: ONE line, naming them in words', cl.length === 1 && cl[0] === "Whole-film check: the tracing's points do not sit where this film's regions are (it may be at the wrong size, or belong to another film): maxilla, mandible, soft-tissue profile.", cl.join('|'));
  ok('c2. no single-region line beside it', !/points do not sit on the/.test(await text(note)));

  // shape (furthest out named), no skull, together with a region: the stated order.
  await toLibrary(); await set({ wf: view(check({ id: 15, reasons: [reason('no-ceph-found'), region('incisors', ['U1T']), reason('shape', { named: ['SNB', 'ANB'] })] })) }); await importNew();      // c5
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('s1. shape names the furthest out; order: shape, region, no skull', JSON.stringify(await noteLines()) === JSON.stringify([
    "Whole-film check: this tracing's overall shape is unlike the expert tracings (furthest out: SNB, ANB). Look at the whole tracing.",
    'Whole-film check: the incisors points do not sit on the incisors this film shows (U1T).',
    'Whole-film check: the region finder found no skull on this film.']), (await noteLines()).join('|'));

  // (d) no region finder, nothing else unusual: only the regions-not-checked line, and no Checked (nothing to check).
  await toLibrary(); await set({ wf: view(check({ id: 16, outcome: 'clean', regionLook: 'no-region-model' })) }); await importNew();      // c6
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('d1. no region model, clean shape: the regions-not-checked line only, no button', JSON.stringify(await noteLines()) === JSON.stringify(['Whole-film check: regions not checked (not set up: download the check model in Models…).']) && (await noteBtns()).length === 0, (await noteLines()).join('|'));
  await toLibrary(); await set({ wf: view(check({ id: 17, outcome: 'clean', regionLook: 'film-too-small' })) }); await importNew();      // c7
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('d2. film too small: its line', (await noteLines()).join('|') === 'Whole-film check: regions not checked (the film is too small).');
  await toLibrary(); await set({ wf: view(check({ id: 18, outcome: 'not-run', shapeLook: 'too-few-points', regionLook: 'no-region-model', present: 9 })) }); await importNew();      // c8
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('d3. too few points: "only 9 of 19 points found", no button', (await noteLines()).join('|') === 'Whole-film check not run: only 9 of 19 points found.' && (await noteBtns()).length === 0);
  await toLibrary(); await set({ wf: view(check({ id: 19, outcome: 'not-run', shapeLook: 'not-set-up', regionLook: 'no-region-model', present: 0 })) }); await importNew();      // c9
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('d4. nothing set up: "Whole-film check not set up."', (await noteLines()).join('|') === 'Whole-film check not set up.');
  await toLibrary(); await set({ wf: view(check({ id: 20, outcome: 'clean' })) }); await importNew();      // c10
  ok('d5. a clean judged check says nothing: no note (the read was seen)', (await readSeen()) && (await note.count()) === 0);

  // (e) nothing read yet / no record / a failed read: no note, no crash.
  await toLibrary(); await set({ wf: view(check({ id: 21, reasons: [region('maxilla', ['A'])] })), wfDelay: 2500 });
  await page.getByRole('button', { name: 'Import…' }).click(); await page.waitForSelector('g.landmark[data-id="S"]', { timeout: 4000 }); await page.waitForTimeout(400);      // c11
  ok('e1. while the read is out (nothing read yet): no note, the film is usable', (await reads()) === 0 && (await note.count()) === 0 && (await page.locator('g.landmark').count()) === 19);
  ok('e2. once read: the note appears (control: the instrument can see a note)', await until(() => !!document.querySelector('.stage .whole-film-note')));
  await set({ wfDelay: 0 });
  await toLibrary(); await set({ wf: null }); await importNew();                         // c12
  ok('e3. no record (blank): no note', (await readSeen()) && (await note.count()) === 0);
  await toLibrary(); await set({ wf: { shown: null, checks: [check({ id: 22, reasons: [region('maxilla', ['A'])] })], off: false } }); await importNew();   // c13
  ok('e4. shown null (a run whose landmarks are not saved yet): no note even with checks listed', (await readSeen()) && (await note.count()) === 0);
  await toLibrary(); await set({ wf: view(check({ id: 23, reasons: [region('maxilla', ['A'])] })), wfFail: true }); await importNew();   // c14
  ok('e5. a failed read: no note, no hold, 19 pins', (await readSeen()) && (await note.count()) === 0 && (await page.locator('g.landmark').count()) === 19);
  await set({ wfFail: false });

  // (f) Checked asks one of three reasons, in the page: no browser dialog and no Tauri message box.
  await toLibrary(); await set({ wf: view(check({ id: 31, reasons: [region('mandible', ['Me', 'Gn'])] })), wfCalls: [] }); await importNew();      // c15
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  await wBtn().click();
  ok('f1. Checked asks: exactly the three reasons, nothing else', JSON.stringify(await noteBtns()) === JSON.stringify(['Tracing is right', 'Expected variant (cleft, syndrome, surgery)', 'I corrected the tracing']), (await noteBtns()).join('|'));
  ok('f2. nothing stored yet by asking', (await calls()).length === 0);
  await note.getByRole('button', { name: 'I corrected the tracing', exact: true }).click();
  ok('f3. the stub received corrected-tracing for the shown check', await until(() => JSON.parse(localStorage.getItem('fakeLib')).wfCalls?.length === 1) && JSON.stringify((await calls())[0]) === JSON.stringify([31, 'corrected-tracing']), JSON.stringify(await calls()));
  ok('f4. the note now reads "Checked: I corrected the tracing", and no button is left', await until(() => /Checked: I corrected the tracing/.test(document.querySelector('.stage .whole-film-note')?.textContent || '')) && (await noteBtns()).length === 0, await text(note));
  ok('f5. the lines stay beside it', (await noteLines()).some((l) => /the mandible points/.test(l)));
  ok('f6. no browser confirm/alert and no message box was used', dialogs === 0 && (await page.evaluate(() => window.__asked)) === 0, `dialogs ${dialogs}`);
  // (i) closed then reopened, and the app closed and opened: the same note and resolution, read again from what is stored.
  // (The stub keeps the one stored view the test last set; this runs straight after f6, so that view is film 15's resolved one.)
  await openFilm(15);
  ok('i1. reopened: the same lines and "Checked: I corrected the tracing", no button', await until(() => (document.querySelector('.stage .whole-film-note')?.textContent || '').includes('Checked: I corrected the tracing')) && (await noteBtns()).length === 0 && (await noteLines()).some((l) => /the mandible points/.test(l)));
  await page.reload(); await page.waitForSelector('.library'); await openFilm(15, false);
  ok('i2. after the app is closed and opened again: the same', await until(() => (document.querySelector('.stage .whole-film-note')?.textContent || '').includes('Checked: I corrected the tracing')) && (await noteBtns()).length === 0);

  // each of the other two reasons reaches the stub as its key
  for (const [i, [words, key]] of [['Tracing is right', 'tracing-right'], ['Expected variant (cleft, syndrome, surgery)', 'expected-variant']].entries()) {
    await toLibrary(); await set({ wf: view(check({ id: 32 + i, reasons: [region('maxilla', ['A'])] })) }); await importNew();
    await note.waitFor({ timeout: 4000 }).catch(() => {});
    await wBtn().click(); await note.getByRole('button', { name: words, exact: true }).click();
    ok(`f7.${i}. "${words}" is sent as ${key} and read back`, await until(() => (document.querySelector('.stage .whole-film-note')?.textContent || '').includes('Checked: ')) && (await calls()).some((c) => c[1] === key), JSON.stringify(await calls()));
  }

  // (h) a read-only page: the note shows, no button (even when unresolved); control: the tracing page has it.
  await toLibrary(); await set({ wf: view(check({ id: 41, reasons: [region('cranial-base', ['S', 'Po'])] })) }); await importNew();      // new film
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  await page.getByRole('button', { name: 'Superimposition ›' }).click(); await page.waitForSelector('g.landmark[data-id="N"]');
  ok('h1. the read-only page shows the note\'s line', await until(() => /the cranial base points/.test(document.querySelector('.stage .whole-film-note')?.textContent || '')));
  ok('h2. and offers no button on it', (await noteBtns()).length === 0 && (await page.getByRole('button', { name: 'Checked', exact: true }).count()) === 0);
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  ok('h3. control: back on the tracing page the same note HAS its Checked button', await until(() => !!document.querySelector('.stage .whole-film-note button')) && (await wBtn().count()) === 1);

  // (I1, fix round 1) a press on the note's text reaches the stage, as on Stage A's note: a drag that starts on a line pans the film.
  // Control: the same drag from the "?" marker (which takes the pointer for the hover words) does NOT pan. (The note sits at the stage's
  // top-left, where a click-to-place can fall outside the picture, so the pan is the press-through that cannot depend on the letterbox.)
  await toLibrary(); await set({ pc: pcClean, wf: view(check({ id: 71, reasons: [region('cranial-base', ['S'])] })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  const pinS = async () => (await page.locator('g.landmark[data-id="S"]').first().boundingBox());
  const dragFrom = async (loc, dx, dy) => { const bb = await loc.boundingBox(); const x = bb.x + bb.width / 2, y = bb.y + bb.height / 2;
    await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx / 2, y + dy / 2, { steps: 4 }); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(300); };
  const s0 = await pinS();
  await dragFrom(note.locator('.whole-film-hover'), 90, 50);
  const s1 = await pinS();
  ok('p1. control: a drag from the ? marker does not pan the film (it takes the pointer)', Math.abs(s1.x - s0.x) < 2 && Math.abs(s1.y - s0.y) < 2, JSON.stringify([s0, s1]));
  await dragFrom(note.locator('.check-note-line span').first(), 90, 50);
  const s2 = await pinS();
  ok('p2. a drag that starts on the note\'s text reaches the stage: the film pans by the drag', Math.abs(s2.x - s1.x - 90) < 4 && Math.abs(s2.y - s1.y - 50) < 4, JSON.stringify([s1, s2]));

  // (j) R3: an SC-1 note alone never holds sign-off. Accept remaining, Mark tracing verified works.
  const markBtn = status.getByRole('button', { name: 'Mark tracing verified' });
  await toLibrary(); await set({ pc: pcClean, wf: view(check({ id: 51, reasons: [region('mandible', ['Me', 'Gn'])] })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  const cJ = Object.keys((await db()).cases).length;
  await remainingBtn().click();
  await page.waitForTimeout(900);
  ok('j1. Accept remaining is not changed by the note: all 19 verified', (await verifiedIds('c' + cJ)).length === 19);
  ok('j2. an unresolved SC-1 note, no Stage A film note: the sign-off goes through by itself, with no hold line', (await db()).cases['c' + cJ].verifiedAt !== null && (await status.locator('.hold-line').count()) === 0);
  await status.getByRole('button', { name: 'Reopen', exact: true }).click(); await page.waitForTimeout(700);
  ok('j2b. reopened for the button: "Mark tracing verified" is enabled, no hold line, the SC-1 note still unresolved', (await db()).cases['c' + cJ].verifiedAt === null && !(await markBtn.isDisabled()) && (await status.locator('.hold-line').count()) === 0 && (await wBtn().count()) === 1);
  await markBtn.click(); await page.waitForTimeout(900);
  ok('j3. it works: the film is signed off, with the SC-1 note unresolved', (await db()).cases['c' + cJ].verifiedAt !== null && (await wBtn().count()) === 1);
  // (g) signed off: Checked is still offered (OQ-6); the Stage A button is not (unchanged).
  ok('g1. signed off: the SC-1 note still offers Checked', (await wBtn().count()) === 1 && (await stageA.count()) === 0);
  await wBtn().click(); await note.getByRole('button', { name: 'Expected variant (cleft, syndrome, surgery)', exact: true }).click();
  ok('g2. and a reason can be given on the signed-off film', await until(() => /Checked: Expected variant \(cleft, syndrome, surgery\)/.test(document.querySelector('.stage .whole-film-note')?.textContent || '')) && (await db()).cases['c' + cJ].verifiedAt !== null);

  // (j, with Stage A's note too) the film is held by Stage A's note exactly as before; the SC-1 note changes nothing.
  await toLibrary(); await set({ pc: pcFilm(61), wf: view(check({ id: 62, reasons: [region('maxilla', ['A'])] })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  const cK = Object.keys((await db()).cases).length;
  ok('k1. both notes are on the film: Stage A\'s first, then the SC-1 note, each with its own Checked', (await stageA.count()) === 1 && (await aBtn().count()) === 1 && (await wBtn().count()) === 1
    && (await text(stageA)).startsWith('This film looks unusual overall'));
  await remainingBtn().click(); await page.waitForTimeout(1200);
  ok('k2. HELD by Stage A\'s note exactly as before: all 19 accepted, not signed off, disabled, with its line', (await verifiedIds('c' + cK)).length === 19 && (await db()).cases['c' + cK].verifiedAt === null
    && (await markBtn.isDisabled()) && (await text(status.locator('.hold-line'))) === 'Press Checked on the film note first.', await text(status.locator('.hold-line')));
  await aBtn().click(); await page.waitForTimeout(900);
  ok('k3. Stage A\'s Checked asks NO reason: it resolves at once, and no reason button appears anywhere', (await db()).pc.flags[0].resolved === 'film-checked'
    && (await page.getByRole('button', { name: 'Tracing is right', exact: true }).count()) === 0 && (await aBtn().count()) === 0);
  ok('k4. the SC-1 note is untouched by it: still unresolved, nothing sent to the SC-1 resolve', (await wBtn().count()) === 1 && (await calls()).every((c) => c[0] !== 62));
  ok('k5. the hold is gone and Mark tracing verified works, the SC-1 note still unresolved', !(await markBtn.isDisabled()) && (await status.locator('.hold-line').count()) === 0);

  // ---- SC-1 Part 1 task 9: the `whole_film_check` column in the report's Points table and the points CSV ----
  const preview = page.locator('[role="dialog"][aria-label="Report preview"]');
  const openReport = async () => { await page.getByRole('button', { name: 'Export ›' }).click(); await preview.waitFor(); await page.waitForTimeout(400); };
  const closeReport = async () => { await preview.getByRole('button', { name: 'Close' }).click(); await preview.waitFor({ state: 'detached' }); };
  const utf8 = (w) => Buffer.from(w.bytes).toString('utf8');
  const sha = (w) => crypto.createHash('sha256').update(Buffer.from(w.bytes)).digest('hex');
  const parseCsv = (w) => utf8(w).replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).map((l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((c) => c.replace(/,$/, '')).slice(0, -1));
  // The file stamps its own export time (`exported_at`), so two exports never match byte for byte; blank that one column, then compare.
  const noStamp = (w) => { const rows = parseCsv(w), at = rows[0].indexOf('exported_at'); return rows.map((r) => r.map((c, i) => (i === at && r !== rows[0] ? '' : c)).join(',')).join('\n'); };
  const shaText = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const nWritten = () => page.evaluate(() => window.__written.length);
  const exportPoints = async (path) => {
    const n = await nWritten();
    await preview.getByRole('radio', { name: 'One row per point' }).click();
    await page.evaluate((pp) => { window.__nextSave = pp; }, path);
    await preview.getByRole('button', { name: 'Export CSV…' }).click();
    await page.waitForFunction((k) => window.__written.length > k, n, { timeout: 15000 }).catch(() => {});
    return (await nWritten()) > n ? page.evaluate(() => window.__written[window.__written.length - 1]) : null;
  };
  const wcells = (w) => { const [h, ...rows] = parseCsv(w); const at = h.indexOf('whole_film_check'), pt = h.indexOf('point'); return { h, at, rows, vals: rows.map((r) => r[at]), byPoint: Object.fromEntries(rows.map((r) => [r[pt], r[at]])) }; };
  const previewLast = () => page.evaluate(() => { const at = [...document.querySelectorAll('.report-points thead th')].findIndex((t) => t.textContent === 'Whole-film check'); return [...document.querySelectorAll('.report-points tr[data-point]')].map((r) => r.children[at].textContent); });
  const previewHead = () => page.evaluate(() => [...document.querySelectorAll('.report-points thead th')].map((t) => t.textContent));
  const reopenFilm = async (n) => { await toLibrary(); await page.locator('.cards .card', { hasText: `SYNTHETIC-film-${n}` }).locator('.open').click(); await page.waitForSelector('g.landmark[data-id="N"]'); await page.waitForTimeout(500); };

  // (t9-a) a flagged film (mandible region + facing): the column on every one of the 19 rows, in the report and the file; reopened: same bytes.
  await toLibrary(); await set({ pc: pcClean, wf: view(check({ id: 71, reasons: [region('mandible', ['Me', 'Gn']), reason('facing')] })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  const nA = Object.keys((await db()).cases).length;
  await openReport();
  const hA = await previewHead(), lA = await previewLast();
  ok('T9-a1. the report\'s Points table ends "Point check", "Whole-film check", "Region"', hA.slice(-3).join('|') === 'Point check|Whole-film check|Region', hA.join('|'));
  ok('T9-a2. the report: every one of 19 rows reads flagged:region-mandible+facing', lA.length === 19 && lA.every((v) => v === 'flagged:region-mandible+facing'), JSON.stringify([...new Set(lA)]) + ' x' + lA.length);
  const csvA = await exportPoints('/Users/demo/out/wf-flag.csv'), cA = csvA ? wcells(csvA) : null;
  ok('T9-a3. the points CSV: "whole_film_check" right after "point_check" (then whole_film_region, six look columns, and "scale"); all 19 rows flagged:region-mandible+facing',
    !!cA && cA.at === cA.h.indexOf('point_check') + 1 && cA.h.indexOf('whole_film_region') === cA.at + 1 && cA.h.indexOf('scale') === cA.at + 8 && cA.rows.length === 19 && cA.vals.every((v) => v === 'flagged:region-mandible+facing'),
    cA ? `${cA.rows.length} rows; at ${cA.at}; ${cA.h.slice(cA.at - 1, cA.at + 2).join('|')}` : 'nothing written');
  await closeReport();
  await reopenFilm(nA); await openReport();
  const csvA2 = await exportPoints('/Users/demo/out/wf-flag-again.csv');
  console.log(`sha256 first export  ${csvA ? sha(csvA) : '-'}\nsha256 after reopen  ${csvA2 ? sha(csvA2) : '-'}  (they differ only in the exported_at stamp)`);
  console.log(`sha256 with exported_at blanked: first ${csvA ? shaText(noStamp(csvA)) : '-'}  after reopen ${csvA2 ? shaText(noStamp(csvA2)) : '-'}`);
  ok('T9-a4. reopened: the CSV is identical in every cell except the export time (sha256 of both, exported_at blanked, 20 lines)',
    !!csvA && !!csvA2 && noStamp(csvA) === noStamp(csvA2) && noStamp(csvA).split('\n').length === 20);
  await closeReport();

  // (t9-b..e) the other values, each on a fresh film: no record (blank), clean, not-run, checked with a reason.
  const valueOf = async (patch, path) => { await toLibrary(); await set(patch); await importNew(); await readSeen(); await page.waitForTimeout(400); await openReport();
    const last = await previewLast(), csv = await exportPoints(path), c = csv ? wcells(csv) : null; await closeReport(); return { last, c }; };
  const bB = await valueOf({ pc: pcClean, wf: null }, '/Users/demo/out/wf-none.csv');
  ok('T9-b1. no record (a film before format 20, or never checked): the column is blank on all 19 rows, in the report and the file', bB.last.length === 19 && bB.last.every((v) => v === '') && !!bB.c && bB.c.rows.length === 19 && bB.c.vals.every((v) => v === ''));
  const bC = await valueOf({ pc: pcClean, wf: view(check({ id: 72, outcome: 'clean' })) }, '/Users/demo/out/wf-clean.csv');
  ok('T9-c1. clean: "clean" on all 19 rows, report and file', bC.last.every((v) => v === 'clean') && bC.last.length === 19 && !!bC.c && bC.c.vals.length === 19 && bC.c.vals.every((v) => v === 'clean'));
  const bD = await valueOf({ pc: pcClean, wf: view(check({ id: 73, outcome: 'not-run', shapeLook: 'too-few-points', regionLook: 'no-region-model', present: 9 })) }, '/Users/demo/out/wf-notrun.csv');
  ok('T9-d1. too few points: "not-run" on every present point\'s row (19 here), report and file', bD.last.every((v) => v === 'not-run') && !!bD.c && bD.c.vals.every((v) => v === 'not-run') && bD.c.vals.length === 19);
  const bE = await valueOf({ pc: pcClean, wf: view(check({ id: 74, reasons: [region('maxilla', ['A'])], resolved: { reason: 'expected-variant', operator: 'SYNTHETIC-operator', resolvedAt: '2026-11-03T00:00:00Z' } })) }, '/Users/demo/out/wf-checked.csv');
  ok('T9-e1. checked with a reason: "checked:expected-variant" on all 19 rows, report and file', bE.last.every((v) => v === 'checked:expected-variant') && !!bE.c && bE.c.vals.length === 19 && bE.c.vals.every((v) => v === 'checked:expected-variant'));
  const bF = await valueOf({ pc: pcClean, wf: view(check({ id: 75, reasons: [reason('mirrored'), reason('facing')] })) }, '/Users/demo/out/wf-mirror.csv');
  ok('T9-f1. mirrored with facing: "flagged:mirrored+facing" on all 19 rows', !!bF.c && bF.c.vals.length === 19 && bF.c.vals.every((v) => v === 'flagged:mirrored+facing'));
  // a failed read of the view stops the export (a blank cell would read as "no record")
  await toLibrary(); await set({ pc: pcClean, wf: null, wfFail: true }); await importNew(); await page.waitForTimeout(600); await openReport();
  const nBefore = await nWritten();
  await preview.getByRole('radio', { name: 'One row per point' }).click(); await page.evaluate(() => { window.__nextSave = '/Users/demo/out/wf-fail.csv'; });
  await preview.getByRole('button', { name: 'Export CSV…' }).click(); await page.waitForTimeout(800);
  ok('T9-g1. the whole-film view could not be read: nothing is written, and the preview says why', (await nWritten()) === nBefore && /whole-film check could not be read/i.test(await preview.innerText()), (await preview.innerText()).slice(-160));
  await closeReport(); await set({ wfFail: false });


  // ---- SC-1 Part 1b Task D2 (sz): the size look's lines, factor, order, Checked and the CSV cell ----
  const SIZE_HALF = 'Whole-film check: this tracing is about ×0.5 the size of the anatomy on this film. Look at the whole tracing.';
  const SIZE_DBL = 'Whole-film check: this tracing is about ×2.0 the size of the anatomy on this film. Look at the whole tracing.';
  await toLibrary(); await set({ pc: pcClean, wf: view(check({ id: 81, reasons: [reason('size', { factor: 0.5 })] })), wfCalls: [] }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('SZ1. a size flag: its line in the brief\'s words, ×0.5', JSON.stringify(await noteLines()) === JSON.stringify([SIZE_HALF]), (await noteLines()).join('|'));
  ok('SZ2a. and exactly one Checked button', (await noteBtns()).join('|') === 'Checked');
  await wBtn().click(); await note.getByRole('button', { name: 'Tracing is right', exact: true }).click();
  const sent = await until(() => JSON.parse(localStorage.getItem('fakeLib')).wfCalls?.length === 1);
  ok('SZ2b. pressing it asks the three reasons and the key reaches the stub for the size check', sent && JSON.stringify((await calls())[0]) === JSON.stringify([81, 'tracing-right']), JSON.stringify(await calls()));
  await toLibrary(); await set({ wf: view(check({ id: 82, reasons: [reason('size', { factor: 2 }), region('cranial-base', ['S', 'N']), reason('no-ceph-found'), reason('shape', { named: ['SNB'] }), reason('mirrored')] })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('SZ3. the order: mirrored, shape, region, size ×2.0, no skull', JSON.stringify(await noteLines()) === JSON.stringify([
    'Whole-film check: this tracing looks mirrored: it faces the other way from the film.',
    "Whole-film check: this tracing's overall shape is unlike the expert tracings (furthest out: SNB). Look at the whole tracing.",
    'Whole-film check: the cranial base points do not sit on the cranial base this film shows (S, N).', SIZE_DBL,
    'Whole-film check: the region finder found no skull on this film.']), (await noteLines()).join('|'));
  await toLibrary(); await set({ wf: view(check({ id: 83, outcome: 'clean', sizeLook: 'not-set-up' })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('SZ4. size calibration not set up: "size not checked (not set up)", no Checked button', (await noteLines()).join('|') === 'Whole-film check: size not checked (not set up).' && (await noteBtns()).length === 0, (await noteLines()).join('|'));
  await toLibrary(); await set({ wf: view(check({ id: 84, outcome: 'clean', present: 18, sizeLook: 'too-few', cbLook: 'too-few', cbPresent: 4 })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('SZ5. an incomplete tracing (18 of 19): both "not judged" lines', JSON.stringify(await noteLines()) === JSON.stringify([
    'Whole-film check: size not judged: incomplete tracing (all 19 points needed).', 'Whole-film check: cranial-base centre not judged: S, N, Po, Ar and Or all needed.']), (await noteLines()).join('|'));
  await toLibrary(); await set({ wf: view(check({ id: 85, outcome: 'clean', regionLook: 'no-region-model', sizeLook: 'no-region-model' })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('SZ6. no region model: the regions-not-checked line covers the size too (no separate size line)', (await noteLines()).join('|') === 'Whole-film check: regions not checked (not set up: download the check model in Models…).');
  await toLibrary(); await set({ wf: view(check({ id: 86, reasons: [reason('size', { factor: 0.5 })], resolved: { reason: 'expected-variant', operator: 'SYNTHETIC-operator', resolvedAt: '2026-11-05T00:00:00Z' } })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('SZ7. locked/Checked already: the size line stays with "Checked: Expected variant …", no button', (await noteLines()).includes(SIZE_HALF) && /Checked: Expected variant/.test(await text(note)) && (await noteBtns()).length === 0);

  await toLibrary(); await set({ wf: view(check({ id: 89, outcome: 'clean', present: 19, cbLook: 'too-few', cbPresent: 5 })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('SZ10. a full tracing with no cranial-base box: the centre says so (stored status), not silence', (await noteLines()).join('|') === 'Whole-film check: cranial-base centre not judged: no cranial-base box found on this film.', (await noteLines()).join('|'));

  await toLibrary(); await set({ wf: view(check({ id: 92, outcome: 'clean', present: 18, sizeLook: 'too-few', cbLook: 'too-few', cbPresent: 5 })) }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  ok('SZ11. 18 points but all five cranial-base points traced, no box: the centre line names the box, not the points', (await noteLines()).join('|') === 'Whole-film check: size not judged: incomplete tracing (all 19 points needed).|Whole-film check: cranial-base centre not judged: no cranial-base box found on this film.', (await noteLines()).join('|'));

  // the CSV cell for the size reasons
  const bS = await valueOf({ pc: pcClean, wf: view(check({ id: 87, reasons: [reason('size', { factor: 0.5 })] })) }, '/Users/demo/out/wf-size.csv');
  ok('SZ8. the CSV and report: flagged:size on all 19 rows', bS.last.length === 19 && bS.last.every((v) => v === 'flagged:size') && !!bS.c && bS.c.vals.length === 19 && bS.c.vals.every((v) => v === 'flagged:size'), JSON.stringify([...new Set(bS.last)]));
  const bS2 = await valueOf({ pc: pcClean, wf: view(check({ id: 88, reasons: [region('cranial-base', ['S', 'N']), reason('size', { factor: 2 })] })) }, '/Users/demo/out/wf-cb-size.csv');
  ok('SZ9. a cranial-base flag with size: flagged:region-cranial-base+size on all 19 rows', !!bS2.c && bS2.c.vals.length === 19 && bS2.c.vals.every((v) => v === 'flagged:region-cranial-base+size'));

  // ---- (sw): Settings › Checks, the switch ----
  const settingsDlg = page.getByRole('dialog', { name: 'Settings' });
  const openChecks = async () => { await page.getByRole('button', { name: 'Settings…' }).first().click(); await settingsDlg.waitFor(); await settingsDlg.getByRole('tab', { name: 'Checks', exact: true }).click(); };
  const closeSettings = async () => { await settingsDlg.getByRole('button', { name: 'Close', exact: true }).click(); await settingsDlg.waitFor({ state: 'detached' }); };
  const swBox = () => settingsDlg.getByRole('checkbox', { name: 'Whole-film check (beta)' });
  // (sw0) the real first-run default: nothing stored, the switch OFF (until the PKU result is in): box unticked, the line, no note, cell `off`.
  await toLibrary(); await set({ pc: pcClean, wf: view(check({ id: 90, reasons: [region('mandible', ['Me'])] })), wfDefaultOff: true }); await importNew();
  ok('SW0a. first run, nothing stored: the view is read and there is no note', (await readSeen()) && (await note.count()) === 0);
  await page.getByRole('button', { name: 'Settings…' }).first().click(); await settingsDlg.waitFor(); await settingsDlg.getByRole('tab', { name: 'Checks', exact: true }).click();
  ok('SW0b. the box is unticked and the line reads "Not yet tested on new films."', await until(() => !!document.querySelector('.settings-checks input[type=checkbox]')) && !(await swBox().isChecked())
    && (await settingsDlg.locator('.settings-checks').innerText()).includes('Not yet tested on new films.'));
  await closeSettings(); await set({ wfDefaultOff: false });
  await toLibrary(); await set({ pc: pcClean, wf: view(check({ id: 91, reasons: [region('mandible', ['Me', 'Gn'])] })), wfOff: undefined, wfSetCalls: [] }); await importNew();
  await note.waitFor({ timeout: 4000 }).catch(() => {});
  const nSw = Object.keys((await db()).cases).length;
  await set({ wfOff: null });                                   // JSON null reads falsy: on, as no stored value
  const tabs = await (async () => { await page.getByRole('button', { name: 'Settings…' }).first().click(); await settingsDlg.waitFor(); return settingsDlg.getByRole('tab').allInnerTexts(); })();
  ok('SW1. the tabs end "Best model", "Checks"', tabs.slice(-2).join('|') === 'Best model|Checks', tabs.join('|'));
  await settingsDlg.getByRole('tab', { name: 'Checks', exact: true }).click();
  ok('SW2. Settings › Checks: the box labelled "Whole-film check (beta)", ticked, with the result line under it', await until(() => !!document.querySelector('.settings-checks input[type=checkbox]:checked'))
    && (await settingsDlg.locator('.settings-checks').innerText()).includes('Not yet tested on new films.'), await text(settingsDlg.locator('.settings-checks')));
  ok('SW3. the open film\'s note is still there behind it (switch on)', (await note.count()) === 1);
  await swBox().click();
  ok('SW4. unticked: the stub received set(false)', await until(() => (JSON.parse(localStorage.getItem('fakeLib')).wfSetCalls || []).join() === 'false'), JSON.stringify((await db()).wfSetCalls));
  ok('SW5. and the open film\'s note disappears once the view is read again', await until(() => !document.querySelector('.stage .whole-film-note')));
  ok('SW6. the box stays unticked', !(await swBox().isChecked()));
  await closeSettings();
  ok('SW7. off: no note on the stage, 19 pins, the film still usable', (await note.count()) === 0 && (await page.locator('g.landmark').count()) === 19);
  await openReport();
  const lOff = await previewLast(), csvOff = await exportPoints('/Users/demo/out/wf-off.csv'), cOff = csvOff ? wcells(csvOff) : null;
  ok('SW8. the report and the points CSV read `off` on all 19 rows (not blank, which would read as "no record")', lOff.length === 19 && lOff.every((v) => v === 'off') && !!cOff && cOff.vals.length === 19 && cOff.vals.every((v) => v === 'off'), JSON.stringify([...new Set(lOff)]));
  await closeReport();
  // closed and reopened with the switch off: still off
  await reopenFilm(nSw);
  ok('SW9. closed and reopened while off: still no note', (await readSeen()) && (await note.count()) === 0);
  await openChecks();
  ok('SW10. and the box is still unticked in Settings', await until(() => !!document.querySelector('.settings-checks input[type=checkbox]')) && !(await swBox().isChecked()));
  await swBox().click();
  ok('SW11. ticked again: the stub received set(true)', await until(() => (JSON.parse(localStorage.getItem('fakeLib')).wfSetCalls || []).join() === 'false,true'), JSON.stringify((await db()).wfSetCalls));
  ok('SW12. and the note is back (read again, waited for)', await until(() => /the mandible points/.test(document.querySelector('.stage .whole-film-note')?.textContent || '')));
  await closeSettings();
  ok('SW13. switch on again: the Checked button is offered', (await wBtn().count()) === 1);

  // ---- (rs): Settings › Checks, "Include the whole-film check in reports and CSV (research)" (owner, 6 Nov 2026). The stub library is seeded
  // with it ticked (the earlier sections read the cell); here it is unticked, remembered, and ticked again.
  const rsBox = () => settingsDlg.getByRole('checkbox', { name: 'Include the whole-film check in reports and CSV (research)' });
  await openChecks();
  ok('RS1. the research box is there, beside the check\'s own box, and ticked (seeded)', await until(() => document.querySelectorAll('.settings-checks input[type=checkbox]').length === 2) && await rsBox().isChecked());
  await rsBox().click();
  ok('RS2. unticked: the setting is stored as 0', await until(() => JSON.parse(localStorage.getItem('fakeLib')).settings.whole_film_in_reports === '0'), JSON.stringify((await db()).settings));
  await closeSettings();
  await openReport();
  const hRs = await previewHead(), csvRs = await exportPoints('/Users/demo/out/wf-rs-off.csv');
  const rsHeader = csvRs ? parseCsv(csvRs)[0] : [];
  ok('RS3. research off: the report\'s Points table has no "Whole-film check" column and the CSV neither whole_film_check nor whole_film_region', hRs.includes('Point check') && !hRs.includes('Whole-film check') && !!csvRs && rsHeader.includes('point_check') && !rsHeader.some((c) => c.startsWith('whole_film')), hRs.join('|') + ' / ' + rsHeader.filter((c) => c.startsWith('whole')).join('|'));
  ok('RS3b. nor any whole-film value anywhere in the file', !!csvRs && !/flagged:|clean|not-run|checked:/.test(utf8(csvRs).split('\n').slice(1).join('\n')));
  await closeReport();
  await page.reload(); await page.waitForSelector('.library');
  await page.locator('.cards .card', { hasText: `SYNTHETIC-film-${nSw}` }).locator('.open').click(); await page.waitForSelector('g.landmark[data-id="N"]'); await page.waitForTimeout(500);
  await openReport();
  const hRs2 = await previewHead();
  ok('RS4. remembered after a restart: still no whole-film column', hRs2.includes('Point check') && !hRs2.includes('Whole-film check'), hRs2.join('|'));
  await closeReport();
  await openChecks();
  ok('RS5. the box is still unticked after the restart', await until(() => !!document.querySelector('.settings-checks input[type=checkbox]')) && !(await rsBox().isChecked()));
  await rsBox().click();
  await until(() => JSON.parse(localStorage.getItem('fakeLib')).settings.whole_film_in_reports === '1');
  await closeSettings();
  await openReport();
  const hRs3 = await previewHead(), csvRs3 = await exportPoints('/Users/demo/out/wf-rs-on.csv');
  const rs3 = csvRs3 ? parseCsv(csvRs3) : [[]], at3 = rs3[0].indexOf('whole_film_check'), ar3 = rs3[0].indexOf('whole_film_region');
  ok('RS6. ticked again: the Points table has the column, and the CSV has whole_film_check then whole_film_region right after point_check', hRs3.includes('Whole-film check') && at3 === rs3[0].indexOf('point_check') + 1 && ar3 === at3 + 1, rs3[0].join('|'));
  ok('RS7. the region column carries a value on all 19 rows (the stub holds no per-landmark results: "not checked", never blank, never "fine")', rs3.length === 20 && rs3.slice(1).every((r) => r[ar3] === 'not checked'), JSON.stringify([...new Set(rs3.slice(1).map((r) => r[ar3]))]));
  await closeReport();

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(2); });
