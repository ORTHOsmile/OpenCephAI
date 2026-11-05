// Spec 2026-10-19-verify-and-ruler addendum: block H (Task 9, the AI line hides while the tracing is signed off) and
// block J (Task 11, the film's own scale line reads "calibrated scale" / "assumed scale"). Setup and stub pattern
// copied from e2e17.cjs (verify/ruler smoke). The built UI in Chromium, Tauri stubbed, a fake library in
// localStorage. SYNTHETIC films, names and points only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
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
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{},"films":0}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
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
          case 'plugin:event|listen': return 1;
          // Block H (Task 9): a `noPoints` flag on the fake library switches the model to finding nothing, so a
          // freshly imported film carries no AI points at all.
          case 'detect_landmarks': { const lms = db.noPoints ? [] : landmarks;
            return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub', timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 },
              landmarks: lms, facingLeft: true, meanPeakRight: 4.9, meanPeakLeft: 12.6, raw: lms.map((l, i) => ({ channel: i, landmarkId: l.id, x: l.x, y: l.y, peak: 0.8 })) }; }
          case 'library_ghosts': return [];
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map(summary);
          case 'library_user_norms': return [];
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
          case 'library_save': { const c = db.cases[a.edit.id]; const moved = JSON.stringify(c.landmarks) !== JSON.stringify(a.edit.landmarks);
            Object.assign(c, { facing: a.edit.facing, orientation: a.edit.orientation, display: a.edit.display, landmarks: a.edit.landmarks, updatedAt: now() });
            if (moved) { c.verifiedAt = null; c.verifiedBy = null; }
            store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
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

  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  // Block H (Task 9): the AI line hides while the tracing is signed off, and is back when the sign-off clears.
  await importNew();                                                                      // c1
  const banner = page.locator('.stage .banner');
  const c1signed = (yes) => until((y) => !!JSON.parse(localStorage.getItem('fakeLib')).cases.c1.verifiedAt === y, yes);
  ok('H1. an unsigned film with AI points shows the line, words unchanged', (await text(banner)) === 'AI · unverified: clinician review required · not a diagnostic device');
  await remainingBtn().click(); await c1signed(true);
  ok('H2. signed off: the line hides', await until(() => !document.querySelector('.stage .banner')));
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  ok('H3. the read-only page follows the same rule (still hidden)', (await banner.count()) === 0);
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await page.keyboard.press('Meta+z'); await c1signed(false);
  ok('H4. ⌘Z clears the sign-off: the line is back', await until(() => !!document.querySelector('.stage .banner')));
  await page.keyboard.press('Meta+Shift+z'); await c1signed(true);
  await until(() => !document.querySelector('.stage .banner'));
  await calibrate(); await c1signed(false);
  ok('H5. calibrating clears the sign-off: the line is back', await until(() => !!document.querySelector('.stage .banner')));
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.noPoints = true; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await toLibrary(); await page.getByRole('button', { name: 'Import…' }).click();          // c2: the model finds nothing
  await page.waitForSelector('.stage canvas'); await page.waitForTimeout(1500);
  ok('H6. a film with no AI points never shows it', (await page.locator('g.landmark').count()) === 0 && (await banner.count()) === 0);
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.noPoints = false; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  // End of block H: on c2's tracing page (no bitmap-less film to clean up); c1 holds after the calibration.

  // Block J (Task 11): the film's own scale line, before and after calibrating (J, film side; the norm tag is not touched).
  await toLibrary(); await importNew();                                                    // c3
  await page.getByRole('tab', { name: 'Measurements' }).click();
  const scaleLine = () => text(page.locator('.inspector .hint', { hasText: 'Scale' }));
  ok('J1. before calibrating the line says "assumed scale"', (await scaleLine()).includes('(assumed scale: calibrate with K)'), await scaleLine());
  await calibrate();
  ok('J2. after calibrating it says "calibrated scale", never the old "(calibrated)"', (await scaleLine()).includes('(calibrated scale)') && !(await scaleLine()).includes('(calibrated)'), await scaleLine());
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('J3. the read-only page shows the same line', (await scaleLine()).includes('(calibrated scale)'), await scaleLine());
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  // End of block J: on c3's tracing page.

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(2); });
