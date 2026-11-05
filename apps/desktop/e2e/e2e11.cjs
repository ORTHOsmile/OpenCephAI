// Cross-check smokes (spec 2026-10-13): existing cases untouched by the main-model switch (§5.3), "recommended" in
// Models…, then (Tasks 10–11) chips, rings, counts, the verify question and the review screen. Built UI in Chromium,
// stubbed Tauri runtime, fake library in localStorage. SYNTHETIC image, names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const ORIGINAL_19 = Object.keys(base);
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const aiLm = (id, x, y) => ({ id, x, y, source: 'ai', verified: false, aiX: x, aiY: y, confidence: 0.9 });
// Review I-1: the case was traced before the switch, by cwlachap as the then-main model; its recorded run sits exactly on
// the stored AI points (so the app can tell who placed each one).
const oldRun = { modelId: 'cwlachap-hrnet-w32', ranAt: '2026-09-30T01:00:00Z', facing: 'right',
  points: Object.entries(base).map(([id, [x, y]], i) => ({ channel: i, landmarkId: id, x: x + 350, y: y + 300, peak: 0.9 })) };
const seed = { settings: {}, ops: ['Dr A'], userNorms: [], runs: { 'cwlachap-hrnet-w32': oldRun }, cases: { c1: { id: 'c1', path: '/Users/demo/c1.png', patientName: 'Demo Synthetic', patientKey: 'demo synthetic',
  dateOfBirth: '2010-01-02', scanId: null, timepoint: 'T1', takenOn: '2026-01-10', takenOnSource: 'label', facing: 'right', orientation: {}, display: {},   // SYNTHETIC
  spacingMm: null, verifiedAt: null, verifiedBy: null, createdAt: '2026-09-30T01:00:00Z', updatedAt: '2026-09-30T01:00:00Z', deletedAt: null,
  identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [], stage: null, inSeries: true, gender: null, referringPractitioner: null, population: null,
  // Task 5 (D2): the real CaseDoc always carries these; a stub without them has the panel read undefined.
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [],
  landmarks: Object.entries(base).map(([id, [x, y]]) => aiLm(id, x + 350, y + 300)) } } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, base }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => '2026-10-13T01:00:00Z';
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'aariz-cepha29', searched: [], error: null };
          case 'plugin:event|listen': return 1;
          case 'plugin:dialog|message': return localStorage.getItem('dialogReply') || 'Yes';
          // The new main model's answer: every point 40 px to the right of what the case stored (so any re-placement shows).
          case 'detect_landmarks': { window.__detects = (window.__detects || 0) + 1;
            // Check 4: the main model fails on this film (a rejected call, as Tauri rejects: a string).
            if (localStorage.getItem('detectFails')) throw 'stub: Aariz failed on this film';
            const lms = Object.entries(base).map(([id, [x, y]]) => ({ id, x: x + 390, y: y + 300, confidence: 0.9 }));
            return { modelId: 'aariz-cepha29', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub', timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 },
              landmarks: lms, facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9, raw: lms.map((l, i) => ({ channel: i, landmarkId: l.id, x: l.x, y: l.y, peak: 0.9, cov: null })) }; }
          case 'detect_extras': window.__extras = (window.__extras || 0) + 1; return [];
          case 'models_points': return [{ modelId: 'aariz-cepha29', title: 'Aariz', main: true, points: Object.keys(base).map((id) => ({ id, status: { kind: 'original' } })) }];
          case 'models_main_point_source': return { ruleVersion: 'main-point-source/1', confirmationPending: true, points: Object.fromEntries(Object.keys(base).map((id) => [id, 'aariz-cepha29'])) };
          case 'models_list': return [
            { id: 'cwlachap-hrnet-w32', title: 'cwlachap HRNet', tier: 'standard', recommended: false, status: 'ready', main: false, citation: 'SYNTHETIC', sizeMb: 1,
              licence: { version: '1', code: 'SYNTHETIC', weights: 'SYNTHETIC', summary: 'SYNTHETIC', url: '', nonCommercial: false }, licenceAccepted: true, stage: null, error: null, msPerFilm: null, page: '', notice: null },
            { id: 'aariz-cepha29', title: 'Aariz', tier: 'optional', recommended: true, status: 'not-installed', main: false, citation: 'SYNTHETIC', sizeMb: 1,
              licence: { version: '1', code: 'SYNTHETIC', weights: 'SYNTHETIC', summary: 'SYNTHETIC', url: '', nonCommercial: false }, licenceAccepted: false, stage: null, error: null, msPerFilm: null, page: '', notice: null }];
          case 'library_list': return Object.values(db.cases).map((c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn,
            createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0,
            verifiedAt: c.verifiedAt, deletedAt: null, patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true }));
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, orientation: a.edit.orientation, display: a.edit.display, updatedAt: now() }); store(db);
            return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_set_verified': Object.assign(db.cases[a.caseId], a.verified ? { verifiedAt: now(), verifiedBy: 'Dr A' } : { verifiedAt: null }); store(db); return null;
          case 'library_record_ai': db.runs[a.run.modelId] = { modelId: a.run.modelId, ranAt: now(), facing: a.run.facing, points: a.points }; store(db); return null;
          case 'library_ghosts': return Object.values(db.runs);
          case 'library_label_text': return { lines: [], suggestions: [] };
          case 'library_user_norms': return [];
          case 'operators_list': return { current: 'Dr A', names: db.ops };
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png, base });

  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');
  const openCase = async () => {
    await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
    await page.locator('.cards .card .open', { hasText: 'T1' }).first().click();
    await page.waitForSelector('g.landmark[data-id="S"]');
  };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks);
  // The whole Measurements table, every row (spec §5.3 "every measurement"; preflight e3), plus its row count.
  const measures = async () => { await page.getByRole('tab', { name: 'Measurements' }).click();
    const rows = await page.locator('.inspector table.measures tbody tr.m-row').allInnerTexts(); return { n: rows.length, text: rows.join('\n') }; };

  // 1. An existing case is untouched by the switch (spec §5.3): opening it runs no model and changes no point or value.
  await openCase();
  await page.waitForTimeout(800);
  ok('1. opening an existing case runs no model', (await page.evaluate(() => window.__detects || 0)) === 0);
  ok('1. every stored point is unchanged after opening', JSON.stringify(await stored()) === JSON.stringify(seed.cases.c1.landmarks));
  const mFirst = await measures();
  await page.reload(); await page.waitForSelector('.library'); await openCase();
  const mAgain = await measures();
  ok('1. closed and reopened: every measurement row reads the same', mFirst.n > 0 && mAgain.n === mFirst.n && mAgain.text === mFirst.text, `${mFirst.n} rows compared`);
  // 1b. Review I-1: on that old case the source line names cwlachap plainly. The table (owner TABLE) gives cwlachap no
  // point, so it must not claim cwlachap is "better than Aariz".
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  const oldLine = await page.evaluate(() => {
    const b = [...document.querySelectorAll('.inspector .lm-list button')].find((x) => x.querySelector('b')?.textContent === 'S'); return b ? b.title : ''; });
  ok('1b. an old case placed by cwlachap says so plainly, with no "better than Aariz" claim', / — cwlachap$/.test(oldLine) && !/better/.test(oldLine), oldLine.split(' — ').pop());
  // 2. Positive control: Re-detect DOES change the unverified AI points (the instrument can see a change).
  await page.getByRole('tab', { name: 'Case' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Re-detect' }).click();
  await page.waitForFunction(() => (window.__detects || 0) >= 1);
  await page.waitForTimeout(800);
  const after = await stored();
  ok('2. Re-detect runs the new main model and replaces the unverified AI points (control)', after.find((l) => l.id === 'S').x === seed.cases.c1.landmarks.find((l) => l.id === 'S').x + 40);
  // The S point's hover label in the Landmarks list (check 1 left the Inspector on Measurements; the list item is the
  // button whose bold label is exactly "S" — a "starts with S" match would find the Steps tab).
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  ok('2. and the point says it was placed by Aariz', / — Aariz$/.test(await page.evaluate(() => {
    const b = [...document.querySelectorAll('.inspector .lm-list button')].find((x) => x.querySelector('b')?.textContent === 'S'); return b ? b.title : ''; })));
  // 2b. The source line is derived, so it reads the same after closing and reopening (preflight a3).
  await page.reload(); await page.waitForSelector('.library'); await openCase();
  await page.locator('g.landmark[data-id="S"]').click().catch(() => {});
  ok('2. closed and reopened: the point still says it was placed by Aariz', (await page.locator('.point-about .placed-by').innerText().catch(() => '')) === 'Aariz');
  // 4. Aariz fails on a film: today's behaviour, unchanged (spec §5.1 as corrected 13 Oct, preflight e2) — the error is
  // shown, no point is placed or moved, no other model is tried, and Re-detect tries again.
  await page.evaluate(() => { localStorage.setItem('detectFails', '1'); window.__extras = 0; });
  const before4 = await stored(), d0 = await page.evaluate(() => window.__detects || 0);
  await page.getByRole('button', { name: 'Re-detect' }).click();
  await page.waitForFunction((n) => (window.__detects || 0) > n, d0);
  await page.waitForSelector('.error');
  await page.waitForTimeout(500);
  ok('4. Aariz fails on the film: the error is shown', /Aariz failed on this film/.test(await page.locator('.error').first().innerText()));
  ok('4. and no point is placed or moved', JSON.stringify(await stored()) === JSON.stringify(before4));
  ok('4. and no other model is tried', (await page.evaluate(() => window.__extras || 0)) === 0);
  await page.evaluate(() => localStorage.removeItem('detectFails'));
  await page.getByRole('button', { name: 'Re-detect' }).click();
  await page.waitForFunction((n) => (window.__detects || 0) > n + 1, d0);
  await page.waitForTimeout(800);
  ok('4. Re-detect tries again: the error clears and the other models run', (await page.locator('.error').count()) === 0 && (await page.evaluate(() => window.__extras || 0)) === 1);
  // 3. Models… shows Aariz as "recommended", installed or not (owner O5).
  await page.reload(); await page.waitForSelector('.library');
  await page.getByRole('button', { name: 'Models…' }).first().click();
  await page.waitForSelector('.model-row[data-id="aariz-cepha29"]');
  ok('3. Aariz is marked "recommended" in Models… (not installed here)', /recommended/.test(await page.locator('.model-row[data-id="aariz-cepha29"] .model-head').innerText()));
  ok('3. no other model is marked recommended', !/recommended/.test(await page.locator('.model-row[data-id="cwlachap-hrnet-w32"] .model-head').innerText()));

  // 5. Task 10 (schema 10): the label "Aariz" survives closing and reopening from the stored placedBy alone. Control: the
  // stub returns no runs (library_ghosts -> []), so the exact-match lookup cannot supply the answer.
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.runs = {};
    db.cases.c1.landmarks.forEach((l) => { l.placedBy = l.source === 'manual' ? null : 'aariz-cepha29'; }); localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.reload(); await page.waitForSelector('.library'); await openCase();
  // Select S from the Landmarks list (the canvas sits over the SVG marks, so a click on g.landmark does not land).
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await page.locator('.lm-list button', { has: page.locator('b', { hasText: /^S$/ }) }).click();
  const about5 = await page.locator('.point-about .placed-by').innerText().catch(() => '');
  ok('5. reopened with no runs to hand: the label still reads "Aariz" from the stored value', about5 === 'Aariz', about5 || 'no label');
  // A real save must carry it back: nudge S (it becomes "moved", still placed by Aariz) and read the stored row. Before
  // Task 10 the front end sent no placedBy, so the stub (which stores rows as given) would lose it.
  const sBefore = (await stored()).find((l) => l.id === 'S');
  await page.keyboard.press('Shift+ArrowUp');
  await page.waitForFunction((y) => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'S').y !== y, sBefore.y, { timeout: 5000 }).catch(() => {});
  const saved5 = (await stored()).find((l) => l.id === 'S');
  ok('5. the next save (S nudged, so a real save happened) keeps placedBy on the row', saved5 && saved5.y !== sBefore.y && saved5.placedBy === 'aariz-cepha29',
    saved5 ? `y ${sBefore.y} -> ${saved5.y}, source ${saved5.source}, placedBy ${saved5.placedBy}` : 'no S row');

  // 6. Task 10: Re-detect keeps the placer of every point it keeps. S is verified (touched) and was placed by cwlachap; N is
  // an untouched AI point. After a plain Re-detect (Aariz places everything here), S must still say cwlachap and N Aariz.
  // Control: N's placer does change, so the check can see a change.
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.cases.c1.landmarks.forEach((l) => { l.placedBy = 'cwlachap-hrnet-w32'; if (l.id === 'S') l.verified = true; }); localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.reload(); await page.waitForSelector('.library'); await openCase();
  const d6 = await page.evaluate(() => window.__detects || 0);
  await page.getByRole('tab', { name: 'Case' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Re-detect' }).click();
  await page.waitForFunction((n) => (window.__detects || 0) > n, d6);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'N').placedBy === 'aariz-cepha29', null, { timeout: 5000 }).catch(() => {});
  const after6 = await stored(), by = (id) => after6.find((l) => l.id === id)?.placedBy;
  ok('6. Re-detect: the untouched AI point N is now placed by Aariz (control)', by('N') === 'aariz-cepha29', `N ${by('N')}`);
  ok('6. and the verified point S it kept still says cwlachap placed it', by('S') === 'cwlachap-hrnet-w32', `S ${by('S')}`);

  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(`FAIL  e2e11 crashed: ${e && e.stack || e}`); process.exit(1); });
