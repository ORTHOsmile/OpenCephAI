// Stage A tasks 6 and 7: the point-check mark beside a flagged pin, its hover words and ring on the film, the "not run" lines under
// the film, and what the screen does for: nothing read yet, nothing flagged, a film that looks unusual, a left-facing and a
// flipped film, a locked page, a film closed and reopened, a run with 15 points and a missing point. The check only flags: no
// stored point moves. Setup and stub pattern copied from e2e18.cjs. The built UI in Chromium, Tauri stubbed, a fake library
// in localStorage. SYNTHETIC films, names and points only.
// Task 7 adds: both bulk accepts leave flagged points out, a look at the point on its own resolves its flag (a resolved flag is not
// drawn), the film note and its Checked press, the locked page, closed then reopened, Undo, and a re-detect. The stub library
// resolves flags the way src-tauri/src/point_check.rs `resolve_on_save` and `film_checked` do (those are tested in Rust).
// Task 8 adds: the report's Points table and the points CSV carry a `point_check` column (flagged / film-unusual / blank), the
// Models… counts ("Nasion: flagged 12 times, you left it 5 times"), and the same CSV bytes after closing and reopening.
// Final fix wave (whole-branch review I1, I2): the screen's copy of the check follows the run just stored (bulk accepts and the
// sign-off wait while a run is being stored and its check read), and a failed read holds, with "Try again".
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
    window.__written = [];
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{},"films":0}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
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
          case 'plugin:dialog|message': return 'Yes';
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
  const set = (patch) => page.evaluate((p) => { const d = JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{},"films":0}'); Object.assign(d, p); localStorage.setItem('fakeLib', JSON.stringify(d)); }, patch);
  const run = (outcome, extra = {}) => ({ modelId: MODEL, outcome, notRunReason: null, present: 19, ...extra });
  // N sits at film (1050, 200). A flag says: the rest of the face expected it 142 px to the LEFT, on the film as stored.
  const flagN = (over = {}) => ({ id: 1, modelId: MODEL, landmarkId: 'N', action: 'flagged', points: null, offPx: 142, expectedX: 908, expectedY: 200,
    ring: { cx: 908, cy: 200, rx: 90, ry: 40, angleDeg: 12 }, resolved: null, ...over });
  const marks = page.locator('[data-check="flagged"]');
  const mark = (id) => page.locator(`g.check-mark[data-id="${id}"]`);
  const lines = page.locator('.stage .check-line');
  const hoverText = async (id) => { await mark(id).locator('.check-hit').hover(); await page.waitForSelector('.check-hover-label', { timeout: 2000 }).catch(() => {}); return text(page.locator('.check-hover-label')); };
  const pinN = async () => (await page.locator('g.landmark[data-id="N"] circle, g.landmark[data-id="N"] rect').first().boundingBox());
  const storedN = async (c) => { const n = (await db()).cases[c].landmarks.find((l) => l.id === 'N'); return n ? [n.x, n.y, n.source] : null; };
  const pressed = (name) => page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed');

  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  // (a) one flagged point: the mark beside N (only), the hover words and the ring; the pin is where the model put it.
  // A second model's run also looks unusual overall: its film note (with Checked) is on this film, so "no Checked on the locked page" (f3) can fail.
  const OTHER = 'SYNTHETIC-other';
  const filmRow = (id = 7, over = {}) => ({ id, modelId: OTHER, landmarkId: null, action: 'film-unusual', points: 'N,S,B,Me', offPx: null, expectedX: null, expectedY: null, ring: null, resolved: null, ...over });
  await set({ pc: { runs: [run('flagged'), { modelId: OTHER, outcome: 'film-unusual', notRunReason: null, present: 19 }], flags: [flagN(), filmRow(7)] } });
  await importNew();                                                                      // c1 (left-facing: shown mirrored)
  ok('a1. exactly one mark, at N', (await marks.count()) === 1 && (await mark('N').count()) === 1);
  ok('a2. the mark says "Check: far outside the usual position" (visible text; the overlay is aria-hidden, so no aria-label is claimed)',
    (await mark('N').first().textContent()) === 'Check: far outside the usual position' && (await mark('N').getAttribute('aria-label')) === null);
  const mb = await mark('N').locator('.check-hit').boundingBox(), pb = await pinN();
  ok('a3. it sits beside the pin, to its right and on its line', mb.x > pb.x + pb.width && Math.abs(mb.y + mb.height / 2 - (pb.y + pb.height / 2)) < 30, JSON.stringify({ mb, pb }));
  ok('a4. no ring and no hover words until you hover', (await page.locator('ellipse.check-ring').count()) === 0 && (await page.locator('.check-hover-label').count()) === 0);
  const hov = await hoverText('N');
  ok('a5. hover: the words, "an estimate" on the assumed scale, and the closing line',
    /^Far outside where this point usually sits on faces like this one \(the rest of the face expected it about [\d.]+ mm \(an estimate\) (higher|lower|further left|further right|higher and further (left|right)|lower and further (left|right))\)\. On Ceph-400's expert tracings, about 1 correct point in 700 sits this far out\. A flag, not a verdict\.$/.test(hov), hov);
  ok('a6. hover: never "1 in 5,000"', !/5,000|5000/.test(await text(page.locator('.stage'))));
  ok('a7. hover: the ring is drawn on the film', (await page.locator('ellipse.check-ring').count()) === 1 && Number(await page.locator('ellipse.check-ring').getAttribute('rx')) > 0);
  await page.mouse.move(5, 5);
  ok('a8. leaving: the ring and the words go', await until(() => !document.querySelector('ellipse.check-ring') && !document.querySelector('.check-hover-label')));
  ok('a9. the pin was not moved: N is stored where the model put it, still an AI point', JSON.stringify(await storedN('c1')) === JSON.stringify([1050, 200, 'ai']), JSON.stringify(await storedN('c1')));
  ok('a10. nothing else on the film is marked: 19 pins, one mark', (await page.locator('g.landmark').count()) === 19 && (await marks.count()) === 1);

  // (e) flipped: the film shown mirrored (it faces left) says "further right" where the unmirrored film says "further left".
  ok('e1. this left-facing film is shown flipped', (await pressed('Flip')) === 'true');
  const mirroredWords = await hoverText('N'); await page.mouse.move(5, 5);
  await page.getByRole('button', { name: 'Flip', exact: true }).click();
  ok('e2. flipped back: unmirrored', (await pressed('Flip')) === 'false');
  ok('e3. the mark is still next to N after the flip', (await marks.count()) === 1 && (await mark('N').count()) === 1);
  const plainWords = await hoverText('N'); await page.mouse.move(5, 5);
  ok('e4. mirrored says "further right", unmirrored says "further left" (left and right follow the screen)',
    /expected it about [\d.]+ mm \(an estimate\) further right\)/.test(mirroredWords) && /expected it about [\d.]+ mm \(an estimate\) further left\)/.test(plainWords), `${mirroredWords} || ${plainWords}`);
  await page.getByRole('button', { name: 'Flip', exact: true }).click();   // back to the film's own look

  // (f) locked: the read-only Superimposition page shows the mark and the words, and offers no button on it.
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('g.landmark[data-id="N"]');
  ok('f1. the read-only page shows the mark at N', (await marks.count()) === 1 && (await mark('N').count()) === 1);
  ok('f2. and its hover words and ring', /A flag, not a verdict\.$/.test(await hoverText('N')) && (await page.locator('ellipse.check-ring').count()) === 1);
  await page.mouse.move(5, 5);
  ok('f3a. the film note is shown on the locked page', (await text(page.locator('.stage .check-note'))).startsWith('This film looks unusual overall: 4 points out of keeping (N, S, B, Me).'), await text(page.locator('.stage .check-note')));
  ok('f3. no button on the film (no Checked, no Accept), nothing to press', (await page.locator('.stage button').count()) === 0
    && (await page.getByRole('button', { name: 'Checked', exact: true }).count()) === 0);
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  ok('f4. back on the tracing page the mark is there', await until(() => !!document.querySelector('[data-check="flagged"]')));
  ok('f5. control for f3: on the tracing page the same note HAS its Checked button', (await page.locator('.stage .check-note').getByRole('button', { name: 'Checked', exact: true }).count()) === 1);

  // (g) closed then reopened: the same mark, read again from the stored result.
  await toLibrary();
  await page.locator('.cards .card .open').first().click(); await page.waitForSelector('g.landmark[data-id="N"]');
  ok('g1. reopened: the same single mark at N', await until(() => document.querySelectorAll('[data-check="flagged"]').length === 1 && !!document.querySelector('g.check-mark[data-id="N"]')));
  ok('g2. the stored pin is still where the model put it', JSON.stringify(await storedN('c1')) === JSON.stringify([1050, 200, 'ai']));
  await page.reload(); await page.waitForSelector('.library');
  await page.locator('.cards .card .open').first().click(); await page.waitForSelector('g.landmark[data-id="N"]');
  ok('g3. after the app is closed and opened again: the mark is there', await until(() => !!document.querySelector('g.check-mark[data-id="N"]')));

  // (b) nothing flagged: no mark, no line.
  await toLibrary(); await set({ pc: { runs: [run('clean')], flags: [] } }); await importNew();      // c2
  ok('b1. nothing flagged: no mark and no line', (await marks.count()) === 0 && (await lines.count()) === 0 && (await page.locator('g.landmark').count()) === 19);

  // (c) the check did not run: the fixed lines, in the line under the film, and no mark.
  await toLibrary(); await set({ pc: { runs: [run('not-run', { notRunReason: 'not-set-up', present: null })], flags: [] } }); await importNew();   // c3
  ok('c1. no tracings file: "Point check not set up." under the film, with the AI line, and no mark',
    (await text(lines)) === 'Point check not set up.' && (await marks.count()) === 0 && (await text(page.locator('.stage .banner'))).startsWith('AI'), await text(lines));
  await toLibrary(); await set({ pc: { runs: [run('not-run', { notRunReason: 'too-few-points', present: 9 })], flags: [] } }); await importNew();   // c4
  ok('c2. too few points: "Point check not run: only 9 of 19 points found."', (await text(lines)) === 'Point check not run: only 9 of 19 points found.' && (await marks.count()) === 0, await text(lines));

  // (d) nothing read yet: no stored result at all, or a result with no runs: no mark, no line.
  await toLibrary(); await set({ pc: null }); await importNew();                           // c5
  ok('d1. nothing read yet (no result): no mark, no line, no film note', (await marks.count()) === 0 && (await lines.count()) === 0 && (await page.locator('.check-note').count()) === 0);
  await toLibrary(); await set({ pc: { runs: [], flags: [] } }); await importNew();        // c6
  ok('d2. a result with no runs: no mark, no line, no film note', (await marks.count()) === 0 && (await lines.count()) === 0 && (await page.locator('.check-note').count()) === 0);

  // film unusual: ONE film row; no mark on any pin (a list of points that may not be the wrong ones), no "wrong points" words.
  await toLibrary();
  await set({ pc: { runs: [run('film-unusual')], flags: [{ id: 7, modelId: MODEL, landmarkId: null, action: 'film-unusual', points: 'N,S,B,Me', offPx: null, expectedX: null, expectedY: null, ring: null, resolved: null }] } });
  await importNew();                                                                      // c7
  ok('u1. film looks unusual: no mark on any pin, 19 pins as placed', (await marks.count()) === 0 && (await page.locator('g.landmark').count()) === 19);
  ok('u2. nothing on the film calls any point wrong', !/wrong|incorrect|error/i.test(await text(page.locator('.stage'))), await text(page.locator('.stage')));

  // a model with fewer points: a run of 15 points, one flagged: a mark only where flagged.
  await toLibrary(); await set({ omit: ['Po', 'Or', 'Ar', 'PNS'], pc: { runs: [run('flagged', { present: 15 })], flags: [flagN({ landmarkId: 'B', id: 9, expectedX: 1040, expectedY: 750 })] } });
  await importNew();                                                                      // c8
  ok('m1. the model really gave 15 points (4 dropped); one flag: one mark, at B only', (await page.locator('g.landmark').count()) === 15
    && (await page.locator('g.landmark[data-id="Po"]').count()) === 0 && (await marks.count()) === 1 && (await mark('B').count()) === 1);
  await set({ omit: [] });

  // S or N missing: the model found no N; a flag naming N has no pin to sit beside; B (flagged too) still shows.
  await toLibrary(); await set({ omit: ['N'], pc: { runs: [run('flagged', { present: 18 })], flags: [flagN({ id: 11 }), flagN({ landmarkId: 'B', id: 12, expectedX: 1040, expectedY: 750 })] } });
  await importNew();                                                                      // c9
  ok('x1. N not placed: no pin and no mark at N; the mark at B is shown', (await page.locator('g.landmark[data-id="N"]').count()) === 0
    && (await mark('N').count()) === 0 && (await mark('B').count()) === 1 && (await marks.count()) === 1);
  await set({ omit: [] });

  // several flagged: a mark at each, and each hover is its own.
  await toLibrary(); await set({ pc: { runs: [run('flagged')], flags: [flagN({ id: 21 }), flagN({ id: 22, landmarkId: 'B', expectedX: 1040, expectedY: 750, offPx: 100 }), flagN({ id: 23, landmarkId: 'Me', expectedX: 990, expectedY: 1150, offPx: 80 })] } });
  await importNew();                                                                      // c10
  ok('s1. three flagged points: three marks, one each at N, B and Me', (await marks.count()) === 3 && (await mark('N').count()) === 1 && (await mark('B').count()) === 1 && (await mark('Me').count()) === 1);
  const hb = await hoverText('B');
  ok('s2. hovering B shows B\'s own words and exactly one ring', /A flag, not a verdict\.$/.test(hb) && (await page.locator('ellipse.check-ring').count()) === 1 && (await page.locator('.check-hover-label').count()) === 1, hb);
  await page.mouse.move(5, 5);

  // another model's flag at a point is not shown beside a pin that the main model placed.
  await toLibrary(); await set({ pc: { runs: [run('clean'), { modelId: 'SYNTHETIC-other', outcome: 'flagged', notRunReason: null, present: 19 }], flags: [flagN({ modelId: 'SYNTHETIC-other', id: 31 })] } });
  await importNew();                                                                      // c11
  ok('s3. a flag from another model\'s run does not mark a point the main model placed', (await marks.count()) === 0);

  // ===== Task 7 =====
  const verifiedIds = async (c) => (await db()).cases[c].landmarks.filter((l) => l.verified).map((l) => l.id);
  const lmN = async (c) => (await db()).cases[c].landmarks.find((l) => l.id === 'N');
  const flagsNow = async () => (await db()).pc.flags;
  const openFilm = async (n, lib = true) => { if (lib) await toLibrary(); await page.locator('.cards .card', { hasText: `SYNTHETIC-film-${n}` }).locator('.open').click(); await page.waitForSelector('g.landmark[data-id="N"]'); };
  const row = (id) => page.locator('.lm-list li button').filter({ has: page.locator('b', { hasText: new RegExp(`^${id}$`) }) });

  // (h) Accept remaining leaves the flagged point; a double-click on it accepts it; the resolved flag is then not drawn.
  await toLibrary(); await set({ pc: { runs: [run('flagged')], flags: [flagN({ id: 41 })] } });
  await importNew();                                                                      // c12
  ok('h1. "Accept remaining (18)": the flagged point is not counted, and the title says it is left out', (await remainingBtn().count()) === 1 && /\(18\)/.test(await text(remainingBtn()))
    && /1 flagged point to check on its own/.test(await remainingBtn().getAttribute('title')), await text(remainingBtn()));
  await remainingBtn().click(); await page.waitForTimeout(900);
  const vh = await verifiedIds('c12');
  ok('h2. it verified 18 points and left N (stored)', vh.length === 18 && !vh.includes('N'), `${vh.length} verified, N in: ${vh.includes('N')}`);
  ok('h3. N is still flagged: its mark is drawn, its flag unresolved, and no Accept remaining is left', (await mark('N').count()) === 1 && (await flagsNow())[0].resolved === null && (await remainingBtn().count()) === 0);
  ok('h4. the bulk accept resolved nothing (the 18 others had no flag; N unresolved)', (await flagsNow()).every((f) => f.resolved === null));
  ok('h5. "Mark tracing verified" waits for N', (await status.getByRole('button', { name: 'Mark tracing verified' }).isDisabled()));
  await row('N').dblclick(); await page.waitForTimeout(900);
  const n41 = await lmN('c12');
  ok('h6. a double-click on N accepts it, as a double-click', n41.verified === true && n41.acceptKind === 'double-click', JSON.stringify(n41));
  ok('h7. its flag is resolved "accepted" and the mark is gone', (await flagsNow())[0].resolved === 'accepted' && await until(() => !document.querySelector('[data-check="flagged"]')));
  // Undo / ⌘Z after resolving (fix round 1): N is open again at the model's point, so its mark comes back and bulk accepts leave it out;
  // the stored resolution stays (spec U4).
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(900);
  ok('h8. ⌘Z after resolving: N is not accepted any more', (await lmN('c12')).verified === false);
  ok('h9. ...its stored resolution stays, and the mark is BACK on the unverified pin', (await flagsNow())[0].resolved === 'accepted' && await until(() => !!document.querySelector('g.check-mark[data-id="N"]')));
  ok('h10. ...and "Accept remaining" leaves N out (nothing to offer)', (await remainingBtn().count()) === 0);
  await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(700);
  ok('h11. ⌘⇧Z: accepted again, the mark goes again', (await lmN('c12')).verified === true && await until(() => !document.querySelector('[data-check="flagged"]')));

  // (k) closed then reopened, with N still flagged and with N resolved.
  await toLibrary(); await set({ pc: { runs: [run('flagged')], flags: [flagN({ id: 51 })] } });
  await importNew();                                                                      // c13
  await remainingBtn().click(); await page.waitForTimeout(900);
  await openFilm(13);
  ok('k1. reopened with N still flagged: the mark is there, N is not accepted, no Accept remaining', await until(() => !!document.querySelector('g.check-mark[data-id="N"]'))
    && (await lmN('c13')).verified === false && (await remainingBtn().count()) === 0);
  await page.reload(); await page.waitForSelector('.library'); await openFilm(13, false);
  ok('k2. after the app is closed and opened again: still flagged, still left out', await until(() => !!document.querySelector('g.check-mark[data-id="N"]')) && (await remainingBtn().count()) === 0);
  await row('N').dblclick(); await page.waitForTimeout(900);
  await openFilm(13); await page.waitForTimeout(500);
  ok('k3. reopened after resolving: no mark, the resolution is kept', (await marks.count()) === 0 && (await flagsNow())[0].resolved === 'accepted');

  // Re-detect brings a NEW run whose flag lands on N, which you already placed and accepted: nothing is drawn there, N is not
  // held out, and a later save does not resolve that flag (no look happened).
  await set({ pc: { runs: [run('flagged')], flags: [flagN({ id: 52 })] } });
  await page.getByRole('button', { name: 'Re-detect' }).click(); await page.waitForTimeout(1200);
  ok('r1. a re-detect flags N, already accepted: no mark at the verified pin', (await lmN('c13')).verified === true && (await marks.count()) === 0);
  const nBefore = await lmN('c13');
  await row('N').click(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900);          // a save that moves the accepted N
  const nAfter = await lmN('c13');
  ok('r2. a later save (it moved the accepted N: the instrument saw a save) does not resolve the flag: still unresolved', nAfter.x !== nBefore.x && (await flagsNow())[0].id === 52 && (await flagsNow())[0].resolved === null, JSON.stringify([nBefore.x, nAfter.x, await flagsNow()]));

  // (i) the film note: Accept remaining works as today on that film and resolves nothing; Checked resolves the film row.
  const noteLine = 'This film looks unusual overall: 4 points out of keeping (N, S, B, Me).';
  const checkedBtn = () => page.locator('.stage .check-note').getByRole('button', { name: 'Checked', exact: true });
  await toLibrary(); await set({ pc: { runs: [run('film-unusual')], flags: [filmRow(61, { modelId: MODEL })] } });
  await importNew();                                                                      // c14
  ok('i1. film note: the brief\'s words, and a Checked button', (await text(page.locator('.stage .check-note'))).includes(noteLine) && (await checkedBtn().count()) === 1, await text(page.locator('.stage .check-note')));
  ok('i2. no pin is marked and nothing is called wrong', (await marks.count()) === 0 && !/wrong|incorrect/i.test(await text(page.locator('.stage .check-note'))));
  ok('i3. "Accept remaining (19)": every point counts', /\(19\)/.test(await text(remainingBtn())), await text(remainingBtn()));
  await checkedBtn().click(); await page.waitForTimeout(700);
  ok('i4. Checked: the film row is resolved "film-checked", the button is gone, the words stay', (await flagsNow())[0].resolved === 'film-checked' && (await checkedBtn().count()) === 0
    && (await text(page.locator('.stage .check-note'))).includes(noteLine),
    JSON.stringify([(await flagsNow()), await checkedBtn().count(), await text(page.locator('.stage .check-note'))]));
  await remainingBtn().click(); await page.waitForTimeout(900);
  ok('i5. Accept remaining then verifies all 19 points', (await verifiedIds('c14')).length === 19);
  await openFilm(14); await page.waitForTimeout(500);
  ok('i6. reopened: the note shows, resolved, with no button', (await text(page.locator('.stage .check-note'))).includes(noteLine) && (await checkedBtn().count()) === 0
    && (await page.locator('.stage .check-note-line').first().getAttribute('data-resolved')) === 'true');
  // film unusual, not Checked: both bulk accepts work as today and resolve nothing; the film is signed off, so Checked is not offered (locked).
  await toLibrary(); await set({ pc: { runs: [run('film-unusual')], flags: [filmRow(62, { modelId: MODEL })] } });
  await importNew();                                                                      // c15
  await remainingBtn().click(); await page.waitForTimeout(900);
  ok('i7. film unusual: Accept remaining verifies all 19 and resolves nothing', (await verifiedIds('c15')).length === 19 && (await flagsNow())[0].resolved === null);
  // Owner ruling "Hold sign-off": nothing signs the film off while the note is unresolved.
  await page.waitForTimeout(1200);
  ok('j1. HELD: all 19 accepted, but the film is not signed off, and Checked is still offered', (await db()).cases.c15.verifiedAt === null && (await page.locator('.verified-note').count()) === 0 && (await checkedBtn().count()) === 1);
  const markBtn = status.getByRole('button', { name: 'Mark tracing verified' });
  ok('j2. "Mark tracing verified" is disabled and the line is exactly "Press Checked on the film note first."', (await markBtn.isDisabled()) && (await text(status.locator('.hold-line'))) === 'Press Checked on the film note first.', await text(status.locator('.hold-line')));
  await checkedBtn().click(); await page.waitForTimeout(900);
  ok('j3. after Checked the hold line is gone and the button works as before', (await flagsNow())[0].resolved === 'film-checked' && (await status.locator('.hold-line').count()) === 0 && !(await markBtn.isDisabled()));
  await markBtn.click(); await page.waitForTimeout(900);
  ok('j4. signed off now: the note shows, no Checked, only Reopen is enabled', (await db()).cases.c15.verifiedAt !== null && (await checkedBtn().count()) === 0
    && (await status.locator('button:not([disabled])').allInnerTexts()).every((t) => t === 'Reopen'), (await status.locator('button:not([disabled])').allInnerTexts()).join('|'));

  // (l) nothing read yet: no note (see d1, d2: no result at all, and a result with no runs).

  // two models flag the same point: the placing model's flag is the one drawn; accepting N on its own resolves both flags.
  await toLibrary(); await set({ pc: { runs: [run('flagged'), { modelId: OTHER, outcome: 'flagged', notRunReason: null, present: 19 }], flags: [flagN({ id: 71 }), flagN({ id: 72, modelId: OTHER })] } });
  await importNew();                                                                      // c16
  ok('t1. two models flagged N: one mark (the placing model\'s), N left out of Accept remaining', (await marks.count()) === 1 && /\(18\)/.test(await text(remainingBtn())));
  await row('N').dblclick(); await page.waitForTimeout(900);
  ok('t2. accepting N on its own resolves both models\' flags', (await flagsNow()).every((f) => f.resolved === 'accepted') && (await marks.count()) === 0, JSON.stringify((await flagsNow()).map((f) => f.resolved)));

  // too few points: no flags, so both bulk accepts are as before (the not-run line only).
  await toLibrary(); await set({ pc: { runs: [run('not-run', { notRunReason: 'too-few-points', present: 9 })], flags: [] } });
  await importNew();                                                                      // c17
  ok('n1. too few points checked: Accept remaining (19) as before', /\(19\)/.test(await text(remainingBtn())) && (await marks.count()) === 0);

  // flagged B with N absent: Accept remaining leaves only B (flipped film too: resolution is by landmark id).
  await toLibrary(); await set({ omit: ['N'], pc: { runs: [run('flagged', { present: 18 })], flags: [flagN({ landmarkId: 'B', id: 81, expectedX: 1040, expectedY: 750 })] } });
  await importNew();                                                                      // c18
  ok('o1. N absent, B flagged: "Accept remaining (17)" (18 placed, B left out)', /\(17\)/.test(await text(remainingBtn())), await text(remainingBtn()));
  await remainingBtn().click(); await page.waitForTimeout(900);
  const v18 = await verifiedIds('c18');
  ok('o2. only B is left open', v18.length === 17 && !v18.includes('B'), `${v18.length} verified`);
  await set({ omit: [] });

  // Fix round 1, C: drag N (a resolving look), ⌘Z: N is back at the model's point WITH its mark, and Accept remaining leaves it out.
  await toLibrary(); await set({ pc: { runs: [run('flagged')], flags: [flagN({ id: 91 })] } });
  await importNew();                                                                      // c19
  await remainingBtn().click(); await page.waitForTimeout(900);
  const pn = await pinN();
  await page.mouse.move(pn.x + pn.width / 2, pn.y + pn.height / 2); await page.mouse.down();
  await page.mouse.move(pn.x + pn.width / 2 + 25, pn.y + pn.height / 2 + 5, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(1000);
  const nd = await lmN('c19');
  ok('d3. a drag of N: moved, flag resolved "moved", mark gone', nd.verified === true && nd.source === 'ai-adjusted' && (await flagsNow())[0].resolved === 'moved' && (await marks.count()) === 0, JSON.stringify(nd));
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(900);
  const nu = await lmN('c19');
  ok('d4. ⌘Z: N is back at the model\'s point, not accepted, resolution kept', nu.verified === false && nu.x === 1050 && nu.y === 200 && (await flagsNow())[0].resolved === 'moved', JSON.stringify(nu));
  ok('d5. the mark is back on N and "Accept remaining" leaves N out', await until(() => !!document.querySelector('g.check-mark[data-id="N"]')) && (await remainingBtn().count()) === 0);

  // Minor 2: bulk accepts wait for the check read to settle; a failed read settles it too (flags unknown, as before).
  await toLibrary(); await set({ pcDelay: 2500, pc: { runs: [run('flagged')], flags: [flagN({ id: 92 })] } });
  await page.getByRole('button', { name: 'Import…' }).click(); await page.waitForSelector('g.landmark[data-id="S"]', { timeout: 4000 }); await page.waitForTimeout(400);   // c20
  ok('w1. while the check is being read: "Accept remaining" is disabled', (await remainingBtn().count()) === 1 && (await remainingBtn().isDisabled()));
  ok('w1b. ...and the status row says "Reading the point check…"', (await text(status.locator('.hold-line'))) === 'Reading the point check…', await text(status.locator('.hold-line')));
  ok('w2. once read it is enabled and counts without the flagged point', await until(() => { const b = [...document.querySelectorAll('.inspector .status-row button')].find((x) => /^Accept remaining/.test(x.textContent)); return !!b && !b.disabled && /\(18\)/.test(b.textContent); }));
  await set({ pcDelay: 0 });
  await toLibrary(); await set({ pcFail: true, pcDelay: 300 }); await importNew();                                   // c21
  // Final fix wave (review I2, fail closed): a failed read HOLDS: no bulk accept and no sign-off, with the words and "Try again".
  ok('w3. the read failed: no mark, "Accept remaining" disabled (fail closed), and the line "The point check could not be read."',
    (await marks.count()) === 0 && (await remainingBtn().count()) === 1 && (await remainingBtn().isDisabled()) && (await text(status.locator('.hold-line'))) === 'The point check could not be read.', await text(status.locator('.hold-line')));
  const tryAgain = status.getByRole('button', { name: 'Try again', exact: true });
  ok('w3b. "Try again" is offered', (await tryAgain.count()) === 1 && !(await tryAgain.isDisabled()));
  await set({ pcFail: false, pcDelay: 0 }); if (await tryAgain.count()) await tryAgain.click(); else await page.waitForTimeout(300);
  // The stored check still flags N (set for w1): the failed read had hidden it; the retry shows it and leaves N out.
  ok('w4. "Try again" after the library recovers: read; N\'s flag (hidden by the failed read) is marked and left out ("Accept remaining (18)"); the line and the button gone',
    await until(() => { const b = [...document.querySelectorAll('.inspector .status-row button')].find((x) => /^Accept remaining/.test(x.textContent)); return !!b && !b.disabled && /\(18\)/.test(b.textContent) && !!document.querySelector('g.check-mark[data-id="N"]'); })
    && (await status.locator('.hold-line').count()) === 0 && (await tryAgain.count()) === 0);


  // ---- Task 8: the report's Points table, the points CSV, and the Models… counts ----
  const preview = page.locator('[role="dialog"][aria-label="Report preview"]');
  const openReport = async () => { await page.getByRole('button', { name: 'Export ›' }).click(); await preview.waitFor(); await page.waitForTimeout(400); };
  const closeReport = async () => { await preview.getByRole('button', { name: 'Close' }).click(); await preview.waitFor({ state: 'detached' }); };
  const utf8 = (w) => Buffer.from(w.bytes).toString('utf8');
  const sha = (w) => crypto.createHash('sha256').update(Buffer.from(w.bytes)).digest('hex');
  // The file stamps its own export time (`exported_at`), so two exports never match byte for byte; blank that one column, then compare.
  const noStamp = (w) => { const rows = parseCsv(w), at = rows[0].indexOf('exported_at'); return rows.map((r) => r.map((c, i) => (i === at && r !== rows[0] ? '' : c)).join(',')).join('\n'); };
  const shaText = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const parseCsv = (w) => utf8(w).replace(/^﻿/, '').split('\r\n').filter(Boolean).map((l) => (l.match(/("([^"]|"")*"|[^,]*)(,|$)/g) || []).map((c) => c.replace(/,$/, '')).slice(0, -1));
  const nWritten = () => page.evaluate(() => window.__written.length);
  const exportPoints = async (path) => {
    const n = await nWritten();
    await preview.getByRole('radio', { name: 'One row per point' }).click();
    await page.evaluate((p) => { window.__nextSave = p; }, path);
    await preview.getByRole('button', { name: 'Export CSV…' }).click();
    await page.waitForFunction((k) => window.__written.length > k, n, { timeout: 15000 }).catch(() => {});
    return (await nWritten()) > n ? page.evaluate(() => window.__written[window.__written.length - 1]) : null;
  };
  const cellsFrom = (w) => { const [h, ...rows] = parseCsv(w); const at = h.indexOf('point_check'), pt = h.indexOf('point'); return { h, at, rows, byPoint: Object.fromEntries(rows.map((r) => [r[pt], r[at]])) }; };
  const previewCells = () => page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.report-points tr[data-point]')].map((r) => [r.getAttribute('data-point'), r.lastElementChild.textContent])));
  const previewHead = () => page.evaluate(() => [...document.querySelectorAll('.report-points thead th')].map((t) => t.textContent));
  const reopenFilm = async (n, patch, beforeOpen) => { await toLibrary(); if (patch) await set(patch); if (beforeOpen) await beforeOpen(); await page.locator('.cards .card', { hasText: `SYNTHETIC-film-${n}` }).locator('.open').click(); await page.waitForSelector('g.landmark[data-id="N"]'); await page.waitForTimeout(500); };
  const film = (n) => `SYNTHETIC-film-${n}`;

  // (p) N flagged by the model that placed it: N reads "flagged" in the report and the CSV, every other point blank.
  await toLibrary(); await set({ pc: { runs: [run('flagged')], flags: [flagN({ id: 201 })] } });
  await importNew();                                                                      // c22
  await openReport();
  const pHead = await previewHead(), pCells = await previewCells();
  ok('T8-p1. the report\'s Points table ends with "Point check"', pHead[pHead.length - 1] === 'Point check', pHead.join('|'));
  ok('T8-p2. the report: N reads flagged, every other point blank (19 rows compared)', Object.keys(pCells).length === 19 && pCells.N === 'flagged' && Object.entries(pCells).every(([id, v]) => id === 'N' || v === ''), JSON.stringify(pCells));
  const csvFlag = await exportPoints('/Users/demo/out/flag.csv');
  const cf = csvFlag ? cellsFrom(csvFlag) : null;
  ok('T8-p3. the points CSV: "point_check" follows accept_kind; N flagged, 18 others blank (19 rows compared)',
    !!cf && cf.at === cf.h.indexOf('accept_kind') + 1 && cf.rows.length === 19 && cf.byPoint.N === 'flagged' && Object.entries(cf.byPoint).every(([id, v]) => id === 'N' || v === ''), cf ? `${cf.rows.length} rows; ${JSON.stringify(cf.byPoint)}` : 'nothing written');
  ok('T8-p4. the CSV file does not call any point wrong', !!csvFlag && !/wrong/i.test(utf8(csvFlag)) && !/wrong/i.test(await preview.innerText()));
  await closeReport();

  // (q) closed then reopened: the same bytes (sha256 of both exports).
  await reopenFilm(22); await openReport();
  const csvAgain = await exportPoints('/Users/demo/out/flag-again.csv');
  console.log(`sha256 first export  ${csvFlag ? sha(csvFlag) : '-'}\nsha256 after reopen  ${csvAgain ? sha(csvAgain) : '-'}  (they differ only in the exported_at stamp)`);
  console.log(`sha256 with exported_at blanked: first ${csvFlag ? shaText(noStamp(csvFlag)) : '-'}  after reopen ${csvAgain ? shaText(noStamp(csvAgain)) : '-'}`);
  ok('T8-q1. reopened: the CSV is identical in every cell except the export time (sha256 of both, exported_at blanked, 20 lines)',
    !!csvFlag && !!csvAgain && noStamp(csvFlag) === noStamp(csvAgain) && noStamp(csvFlag).split('\n').length === 20);
  await closeReport();

  // (r) the same flag raised by a model that did NOT place N: blank (positive control for p2/p3).
  await reopenFilm(22, { pc: { runs: [run('flagged', { modelId: OTHER })], flags: [flagN({ id: 202, modelId: OTHER })] } }); await openReport();
  const rCells = await previewCells(), csvOther = await exportPoints('/Users/demo/out/other.csv');
  ok('T8-r1. a flag from another model: N is blank in the report and the CSV', rCells.N === '' && !!csvOther && cellsFrom(csvOther).byPoint.N === '' && cellsFrom(csvOther).rows.length === 19);
  // every cell other than point_check is the same as with the flag (the golden-diff of the points CSV: only that column differs)
  const strip = (w) => { const c = cellsFrom(w), st = c.h.indexOf('exported_at'); return c.rows.map((r) => r.filter((_, i) => i !== c.at && i !== st).join('\u0001')); };   // the export time differs by itself
  ok('T8-r2. flagged vs not flagged: every other cell equal, row by row (19 rows)', !!csvFlag && !!csvOther && strip(csvFlag).length === 19 && JSON.stringify(strip(csvFlag)) === JSON.stringify(strip(csvOther)));
  await closeReport();

  // (s) a film never checked (no result at all), a film not run (no tracings file), a clean film: column present, blank.
  for (const [name, pc] of [['never checked', null], ['not run (no tracings file)', { runs: [run('not-run', { notRunReason: 'not-set-up', present: null })], flags: [] }], ['nothing flagged', { runs: [run('clean')], flags: [] }]]) {
    await reopenFilm(22, { pc }); await openReport();
    const h = await previewHead(), c = await previewCells(), w = await exportPoints('/Users/demo/out/blank.csv'), cc = w ? cellsFrom(w) : null;
    ok(`T8-s. ${name}: the column is there and blank (19 rows)`, h[h.length - 1] === 'Point check' && Object.keys(c).length === 19 && Object.values(c).every((v) => v === '')
      && !!cc && cc.at > 0 && cc.rows.length === 19 && Object.values(cc.byPoint).every((v) => v === ''));
    await closeReport();
  }

  // (t) flagged then resolved: still "flagged" (a record of what the check said). Film unusual, unresolved and resolved: every point.
  await reopenFilm(22, { pc: { runs: [run('flagged')], flags: [flagN({ id: 203, resolved: 'accepted' })] } }); await openReport();
  const tc = await previewCells(); await closeReport();
  ok('T8-t1. flagged then resolved (accepted): N still reads flagged', tc.N === 'flagged' && Object.entries(tc).every(([id, v]) => id === 'N' || v === ''), JSON.stringify(tc));
  for (const resolved of [null, 'film-checked']) {
    await reopenFilm(22, { pc: { runs: [run('film-unusual')], flags: [filmRow(204, { modelId: MODEL, resolved })] } }); await openReport();
    const uc = await previewCells(), uw = await exportPoints('/Users/demo/out/unusual.csv'), uu = uw ? cellsFrom(uw) : null;
    ok(`T8-u. film unusual (${resolved ? 'resolved' : 'unresolved'}): every point reads film-unusual, in the report and the CSV (19 rows each)`,
      Object.keys(uc).length === 19 && Object.values(uc).every((v) => v === 'film-unusual') && !!uu && uu.rows.length === 19 && Object.values(uu.byPoint).every((v) => v === 'film-unusual')
      && !/wrong points/i.test(await preview.innerText()));
    await closeReport();
  }

  // (v) a left-facing film (c22 is left-facing: detect says so and the film is shown flipped): its flagged CSV already ran above (p3).
  const flipped = (await db()).cases.c22.facing;
  console.log('c22 facing stored as:', flipped, '; its flagged points CSV was p3');


  // (x) Review fixes. M6: a signed-off (locked) film's report shows the column. I1: a flagged point re-placed by hand reads flagged.
  // I2: a failed read of the check refuses the export in words, writing nothing.
  const setCase = (patch) => page.evaluate((p) => { const d = JSON.parse(localStorage.getItem('fakeLib')); const c = d.cases.c22;
    if (p.signed !== undefined) { c.verifiedAt = p.signed ? '2026-11-02T00:00:00.000Z' : null; c.verifiedBy = p.signed ? 'SYNTHETIC-operator' : null; c.landmarks.forEach((l) => { l.verified = !!p.signed; }); }
    if (p.nSource) c.landmarks.find((l) => l.id === 'N').source = p.nSource; localStorage.setItem('fakeLib', JSON.stringify(d)); }, patch);
  await reopenFilm(22, { pc: { runs: [run('flagged')], flags: [flagN({ id: 301 })] } }, () => setCase({ signed: true })); await openReport();
  const xs = await previewCells(); await closeReport();
  const locked = (await page.getByRole('button', { name: 'Reopen' }).count()) > 0;
  ok('T8-x1. a signed-off film (page locked): its report shows N flagged and the rest blank (19 rows)', locked && Object.keys(xs).length === 19 && xs.N === 'flagged' && Object.entries(xs).every(([id, v]) => id === 'N' || v === ''), `locked=${locked} ${JSON.stringify(xs)}`);
  await reopenFilm(22, { pc: { runs: [run('flagged')], flags: [flagN({ id: 302, resolved: 'placed' })] } }, () => setCase({ signed: false, nSource: 'manual' })); await openReport();
  const hc = await previewCells(), hw = await exportPoints('/Users/demo/out/hand.csv'), hh = hw ? cellsFrom(hw) : null;
  const handRow = hh && hh.rows.find((r) => r[hh.h.indexOf('point')] === 'N');
  ok('T8-x2. N flagged then re-placed by hand: reads flagged in the report and the CSV (accept_kind/label show it was placed by you)',
    hc.N === 'flagged' && !!hh && hh.byPoint.N === 'flagged' && /Placed by you/.test(handRow ? handRow.join('|') : ''), `${hc.N} ${handRow ? handRow.join('|').slice(-120) : ''}`);
  await closeReport();
  await reopenFilm(22, { pcFail: true, pc: { runs: [run('flagged')], flags: [flagN({ id: 303 })] } }, () => setCase({ nSource: 'ai' })); await openReport();
  const before = await nWritten();
  await preview.getByRole('radio', { name: 'One row per point' }).click();
  await page.evaluate(() => { window.__nextSave = '/Users/demo/out/failed-read.csv'; });
  await preview.getByRole('button', { name: 'Export CSV…' }).click(); await page.waitForTimeout(1200);
  const errText = (await preview.locator('.report-error').allInnerTexts()).join(' ');
  ok('T8-x3. the check could not be read: Export CSV… says so and writes nothing', /could not be read/.test(errText) && (await nWritten()) === before, errText);
  await closeReport(); await set({ pcFail: false });

  // (w) Models…: per point "flagged n times, you left it m times"; the same after reopening the dialog; a failed read says so, no zeros.
  await toLibrary();
  await set({ counts: [{ landmarkId: 'N', flagged: 12, left: 5 }, { landmarkId: 'S', flagged: 1, left: 1 }], countsFail: false });
  const modelsBtn = () => page.getByRole('button', { name: 'Models…' }).first();
  const countsText = async () => text(page.locator('.point-check-counts'));
  await modelsBtn().click(); await page.waitForSelector('.model-manager');
  await until(() => !!document.querySelector('.point-check-counts li'));
  const w1 = await countsText();
  ok('T8-w1. Models… says "Nasion: flagged 12 times, you left it 5 times"', w1.includes('Nasion: flagged 12 times, you left it 5 times'), w1);
  ok('T8-w2. singular: "Sella: flagged 1 time, you left it 1 time"', w1.includes('Sella: flagged 1 time, you left it 1 time'), w1);
  ok('T8-w3. information only: no button or field inside the counts', (await page.locator('.point-check-counts button, .point-check-counts input').count()) === 0);
  await page.getByRole('button', { name: 'Close' }).last().click(); await page.waitForSelector('.model-manager', { state: 'detached' });
  await modelsBtn().click(); await page.waitForSelector('.model-manager'); await until(() => !!document.querySelector('.point-check-counts li'));
  ok('T8-w4. reopened: the same counts', (await countsText()) === w1);
  await page.getByRole('button', { name: 'Close' }).last().click(); await page.waitForSelector('.model-manager', { state: 'detached' });
  await set({ counts: [] });
  await modelsBtn().click(); await page.waitForSelector('.model-manager'); await until(() => !!document.querySelector('.point-check-counts'));
  ok('T8-w5. nothing flagged yet: one plain line', (await countsText()).includes('No point has been flagged yet.'));
  await page.getByRole('button', { name: 'Close' }).last().click(); await page.waitForSelector('.model-manager', { state: 'detached' });
  await set({ countsFail: true });
  await modelsBtn().click(); await page.waitForSelector('.model-manager'); await until(() => !!document.querySelector('.point-check-counts'));
  const w6 = await countsText();
  ok('T8-w6. a failed read says so and shows no counts', w6.includes('couldn\'t be read') && !/flagged \d/.test(w6), w6);
  await page.getByRole('button', { name: 'Close' }).last().click(); await page.waitForSelector('.model-manager', { state: 'detached' });
  await set({ countsFail: false });


  // ---- Task 9: the note "Extreme value for the norm" at 4 SD or more (spec 14.4). A note on the measurement only: no point moves, the
  // point check is untouched. SYNTHETIC film c23 (left-facing, shown flipped, no ruler so the scale is assumed). Its ANB reads 3.6°; a user norm
  // with SD 1 and a chosen mean puts ANB a known number of SDs out (the shown 3.6 is rounded, so each z is within 0.05 of its name).
  await set({ pc: null });                                                                // no stored check: this block is about the note alone
  await importNew();                                                                      // c23
  await page.locator('.inspector').getByRole('tab', { name: 'Measurements' }).or(page.locator('.inspector').getByRole('button', { name: 'Measurements' })).first().click(); await page.waitForTimeout(400);
  const NOTE = 'Extreme value for the norm';
  const anbRow = () => page.locator('.inspector tr.m-row[data-node="m03_ANB"]').first();
  // What the row shows apart from the note itself: the value text, the stars, the colour class and band, the Mean ± SD cell. Printed as ROW lines so
  // the run without the note (today's output) can be diffed against the run with it.
  const rowState = async () => anbRow().evaluate((tr) => { const v = tr.querySelector('td.m-value'), n = v.querySelector('.extreme-note'), c = v.cloneNode(true); c.querySelector('.extreme-note')?.remove();
    return { value: c.textContent.replace(/\s+/g, ' ').trim(), stars: v.querySelector('.stars')?.textContent.trim() ?? '', cls: v.className, band: v.getAttribute('data-band'),
      starLabel: v.querySelector('.stars')?.getAttribute('aria-label') ?? '', norm: tr.querySelector('td.m-norm').textContent.trim(), note: n ? n.textContent.trim() : null, noteCount: v.querySelectorAll('.extreme-note').length }; });
  const withNorm = async (mean, sd, label) => { await set({ userNorms: [{ setName: 'SYNTHETIC own', measurement: 'm03_ANB', mean, sd, sourceNote: 'SYNTHETIC sample' }] });
    await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.cases.c23.population = 'user:SYNTHETIC own'; localStorage.setItem('fakeLib', JSON.stringify(d)); });
    await page.reload(); await page.waitForSelector('.library'); await openFilm(23, false); await page.waitForTimeout(500); await page.locator('.inspector').getByRole('tab', { name: 'Measurements' }).or(page.locator('.inspector').getByRole('button', { name: 'Measurements' })).first().click(); await page.waitForTimeout(400);
    const st = await rowState(); console.log('ROW', label, JSON.stringify({ ...st, note: undefined, noteCount: undefined })); return st; };
  // Step 3: ANB 4.2 SD out shows the note, 3.9 SD does not (both above the mean), and 4.2 below the mean shows it too.
  const z42 = await withNorm(-0.6, 1, 'z=+4.2');
  const ptsBefore = JSON.stringify((await db()).cases.c23.landmarks.map((l) => [l.id, l.x, l.y, l.verified]));
  ok('T9-1. ANB 4.2 SD above the norm shows "Extreme value for the norm", once', z42.note === NOTE && z42.noteCount === 1 && z42.value.startsWith('3.6°'), JSON.stringify(z42));
  const z39 = await withNorm(-0.3, 1, 'z=+3.9');
  ok('T9-2. ANB 3.9 SD out shows no note', z39.note === null && z39.noteCount === 0, JSON.stringify(z39));
  const zNeg = await withNorm(7.8, 1, 'z=-4.2');
  ok('T9-3. 4.2 SD BELOW the norm shows the note too', zNeg.note === NOTE, JSON.stringify(zNeg));
  // Nothing else on the row changes: z = 3.5 and 4.5 (both already three red stars, "Severe") read the same apart from the note.
  const z35 = await withNorm(0.1, 1, 'z=+3.5'), z45 = await withNorm(-0.9, 1, 'z=+4.5');
  const same = (a, b) => ['value', 'stars', 'cls', 'band', 'starLabel'].every((k) => a[k] === b[k]);
  ok('T9-4. z 3.5 has no note; z 4.5 has it', z35.note === null && z45.note === NOTE, `${z35.note} / ${z45.note}`);
  ok('T9-5. apart from the note, 3.5 and 4.5 read alike: value, stars, colour, band, words (red, ***, "Severe")', same(z35, z45) && z35.stars === '***' && z35.band === 'red' && /norm-red/.test(z35.cls) && /Severe/.test(z35.starLabel), JSON.stringify([z35, z45]));
  ok('T9-6. the stars/colour at 4.2 are the same as at 3.9 (the note adds nothing else)', same(z42, z39), JSON.stringify([z39, z42]));
  // Edge: a norm with no SD grades nothing and notes nothing.
  const noSd = await withNorm(-0.6, null, 'no SD');
  ok('T9-7. a norm with no SD: no stars, no note', noSd.note === null && noSd.stars === '', JSON.stringify(noSd));
  // Edge: no norm chosen (the case's default population): the row reads as before, no note.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.cases.c23.population = null; d.userNorms = []; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await page.reload(); await page.waitForSelector('.library'); await openFilm(23, false); await page.waitForTimeout(500); await page.locator('.inspector').getByRole('tab', { name: 'Measurements' }).or(page.locator('.inspector').getByRole('button', { name: 'Measurements' })).first().click(); await page.waitForTimeout(400);
  const dflt = await rowState(); console.log('ROW default', JSON.stringify({ ...dflt, note: undefined, noteCount: undefined }));
  ok('T9-8. the default norm (nothing chosen for the case; ANB 1.3 SD out): its stars and no note. A truly absent norm is covered by the unit test (kind none / no SD)', dflt.note === null && dflt.stars === '*', JSON.stringify(dflt));
  // Edge: assumed scale. The film has no ruler, so an mm row waits on calibration ("calibrate to show"): no note there, however far out; the angle row above is unaffected.
  const mmRow = page.locator('.inspector tr.m-row[data-node="m46_U1NAmm"]').first();
  ok('T9-9. assumed scale: a hidden mm row carries no note (this proves normCell gives a hidden row no z; the `!r.hidden` guard in the row only copies the stars guard and is not tested here)', (await mmRow.locator('.extreme-note').count()) === 0 && /calibrate to show/.test(await text(mmRow)), await text(mmRow));
  // Edge: flipped film. c23 is left-facing and shown flipped: its ANB is the same 3.6° as the unflipped reading and the row carries the note as above (T9-1 ran on it).
  ok('T9-10. flipped film: shown flipped, and its angle row read 3.6° with the note at 4.2 SD', (await pressed('Flip')) === 'true' && z42.value.startsWith('3.6°') && z42.note === NOTE);
  // The note moves no point and is not a point-check mark.
  ok('T9-11. no point moved or verified by any of it; no point-check mark drawn for the note', JSON.stringify((await db()).cases.c23.landmarks.map((l) => [l.id, l.x, l.y, l.verified])) === ptsBefore && (await marks.count()) === 0);
  // The Chart tab keeps its rows as they were (the note is not drawn there).
  // Put a 4.2 SD norm back first, so there IS a note to hide (the default norm of T9-8 has none).
  await withNorm(-0.6, 1, 'z=+4.2 again');
  const onMeasures = await page.locator('.inspector .extreme-note').count();
  await page.locator('.inspector').getByRole('tab', { name: 'Chart' }).or(page.locator('.inspector').getByRole('button', { name: 'Chart' })).first().click(); await page.waitForTimeout(300);
  const onChart = await page.locator('.inspector .extreme-note').count();
  ok('T9-12. the note is on Measurements at 4.2 SD and absent on the Chart tab', onMeasures >= 1 && onChart === 0, `measurements ${onMeasures}, chart ${onChart}`);

  // ===== Final fix wave, whole-branch review I1: the check follows the run that was just stored =====
  // The model's points land on the film at once, but its run (and the run's check) is stored 2.5 s later. A read made before
  // the write finds nothing; before the fix the screen took that as "nothing flagged" and offered every point in bulk.
  await toLibrary(); await set({ pc: null, pcAfterRecord: { runs: [run('flagged')], flags: [flagN({ id: 97 })] }, recordDelay: 2500 });
  await page.getByRole('button', { name: 'Import…' }).click(); await page.waitForSelector('g.landmark[data-id="S"]', { timeout: 4000 }); await page.waitForTimeout(400);
  ok('I1-1. the points are on the film but their run is not stored yet: "Accept remaining" waits, "Reading the point check…"',
    (await page.locator('g.landmark').count()) === 19 && (await remainingBtn().count()) === 1 && (await remainingBtn().isDisabled()) && (await text(status.locator('.hold-line'))) === 'Reading the point check…',
    `${await text(remainingBtn())} / ${await text(status.locator('.hold-line'))}`);
  ok('I1-2. once the run is stored and its check read: N is marked and left out ("Accept remaining (18)"), the line gone',
    await until(() => { const b = [...document.querySelectorAll('.inspector .status-row button')].find((x) => /^Accept remaining/.test(x.textContent)); return !!b && !b.disabled && /\(18\)/.test(b.textContent) && !!document.querySelector('g.check-mark[data-id="N"]'); })
    && (await status.locator('.hold-line').count()) === 0);
  await remainingBtn().click(); await page.waitForTimeout(800);
  const lastCase = async () => { const d = await db(); return Object.keys(d.cases).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).pop(); };
  const nI1 = (await db()).cases[await lastCase()].landmarks.find((l) => l.id === 'N');
  ok('I1-3. the bulk accept left N for a look of its own (stored unverified)', !!nI1 && nI1.verified === false, JSON.stringify(nI1));
  await set({ pcAfterRecord: null, recordDelay: 0 });

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(2); });
