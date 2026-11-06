// Report and exports smoke (spec 2026-10-17 report-exports): the built UI in Chromium with a stubbed Tauri runtime.
// SYNTHETIC only: written files stay in the page (window.__written), never on disk.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const landmarks = Object.entries(base).map(([id,[x,y]]) => ({ id, x: x + 350, y: y + 300, confidence: 0.8 }));
const CONTEXT = "Meanings compare this film with the chosen norm; interpret with the clinical examination and the patient's age, sex, ethnicity and growth stage.";
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, landmarks }) => {
    window.__written = [];
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{}}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}, opts = {}) => {
        const db = load();
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0, verifiedAt: null, deletedAt: null,
          patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true, libraryId: null, formerLibraryIds: [], printedPatientId: c.patientId ?? null });
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'models_points': return [];
          // preflight-rulings Task 9 (FONT-2 smoke stub): no system font search in the browser smoke — every
          // report here is Latin-only, so `useReport`'s `need` set is always empty and this is never actually
          // called, but `loadSystemFont` still needs an array back (not an array at all means "nothing here").
          case 'system_font_list': return [];
          case 'plugin:dialog|open': return window.__nextPick ?? null;
          case 'plugin:dialog|save': return window.__nextSave ?? null;
          case 'plugin:dialog|message': return 'Yes';
          case 'plugin:event|listen': return 1;
          case 'detect_landmarks': return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
            timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks, facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9 };
          case 'library_list': return Object.values(db.cases).filter(() => !a.deleted).map(summary);
          case 'library_user_norms': return [];
          case 'operators_list': return { current: db.settings.operator ?? '', names: window.__opNames ?? [] };
          // Ruling I5 (preflight-rulings.md): reads the fake library's own stored default, falling back to
          // 'caucasian' (today's value, kept for every existing check) only when nothing was stored.
          case 'settings_default_population_get': return 'default_population' in db.settings ? db.settings.default_population : 'caucasian';
          case 'library_set_case_population': { const c = db.cases[a.caseId]; if (c) { c.population = a.population; store(db); } return null; }
          case 'library_import': {
            const id = 'c' + (Object.keys(db.cases).length + 1);
            db.cases[id] = { id, path: a.path, patientName: 'Demo Synthetic', patientKey: 'demo synthetic', dateOfBirth: '1990-03-07', scanId: 'SYNTHETIC-4471',   // SYNTHETIC
              timepoint: 'T1', takenOn: '2024-02-07', takenOnSource: 'label', facing: 'right', orientation: {}, display: {}, spacingMm: null,
              verifiedAt: null, verifiedBy: null, landmarks: [], createdAt: now(), updatedAt: now(), deletedAt: null, identitySource: 'manual',
              identityChecked: true, identityIssues: [], learnedFields: [], gender: null, referringPractitioner: null, population: null,
              patientId: null, xrayType: null, xraySize: null, radiographyPractice: null,
              libraryId: 'L-00042', patientIdsSeen: [], idMatches: [] };   // L2 SYNTHETIC
            store(db); return { caseId: id, created: true };
          }
          case 'library_read_label': return { checked: true, issues: [], lines: [], learnedFields: [], conflicts: [], suggestions: [] };
          case 'library_ruler': { const c = db.cases[a.caseId]; return c.ruler ?? null; }
          case 'library_open': {
            if (window.__failOpenAll || window.__failOpen === a.caseId) throw new Error('SYNTHETIC: this film could not be read');
            const c = db.cases[a.caseId];
            // R3 (request G merge): a saved fit, when the smoke stored one (db.fits); every other film reads null, as before.
            return { ...c, printedPatientId: c.patientId ?? null, libraryId: c.libraryId ?? null, patientIdsSeen: [], idMatches: [], libraryTrail: [],
              image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path }, fit: (db.fits || {})[a.caseId] ?? null };
          }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, updatedAt: now() }); store(db); return { updatedAt: c.updatedAt, verifiedAt: null }; }
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          case 'export_write': {
            if (window.__failWrite) throw new Error(window.__failWrite);
            window.__written.push({ path: decodeURIComponent(opts.headers.path), bytes: Array.from(a) });
            return null;
          }
          default: return null;
        }
      },
    };
  }, { png, landmarks });

  const importFile = async (name) => {
    await page.evaluate((n) => { window.__nextPick = '/Users/demo/' + n; }, name);
    await page.getByRole('button', { name: 'Import…' }).first().click();
    await page.waitForSelector('g.landmark[data-id="S"]');
  };
  const preview = page.locator('[role="dialog"][aria-label="Report preview"]');
  const openReport = async () => { await page.getByRole('button', { name: 'Export ›' }).click(); await preview.waitFor(); await page.waitForTimeout(300); };
  const closeReport = async () => { await preview.getByRole('button', { name: 'Close' }).click(); await preview.waitFor({ state: 'detached' }); };
  const stored = (key) => page.evaluate((k) => JSON.parse(localStorage.getItem('fakeLib')).settings[k] ?? null, key);
  const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')));
  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  await importFile('report-1.png');
  // What the screen shows: the Measurements rows, in order (Inspector rowKey = "<analysis name>:<node>").
  await page.getByRole('tab', { name: 'Measurements' }).click();
  await page.waitForSelector('tr.m-row');
  const screenKeys = await page.$$eval('tr.m-row', (trs) => trs.map((tr) => tr.dataset.key));
  ok('R1. Export › is on with a film open, and opens the Report preview', !(await page.getByRole('button', { name: 'Export ›' }).isDisabled()));
  await openReport();
  const head = await preview.locator('.report-header').innerText();
  ok('R2. the header names the film, its library ID, its assumed scale and that it is not verified',
    ['Demo Synthetic', 'L-00042', 'T1', 'assumed', 'Not verified'].every((s) => head.includes(s)), head.replace(/\s+/g, ' '));
  const pv = await preview.locator('tr.r-row').evaluateAll((trs) => trs.map((tr) => ({ key: tr.dataset.key, screen: tr.dataset.screenKey, meaning: tr.querySelector('input')?.value ?? '' })));
  ok('R3. the same rows as the Measurements tab, in the same order (the analyses switched on)', JSON.stringify(pv.map((r) => r.screen)) === JSON.stringify(screenKeys),
    `${pv.length} vs ${screenKeys.length}`);
  // Part F Task 13: the Points table is also a `.report-block`, so exclude it here (`.report-points`) — this check
  // counts the MEASUREMENT blocks only, one per analysis switched on; the Points table is not one of them.
  const names = await preview.locator('.report-block:not(.report-points) h3').allInnerTexts();
  ok('R4. one block per analysis, in order', JSON.stringify(names) === JSON.stringify([...new Set(screenKeys.map((k) => k.split(':')[0]))]), names.join(','));
  const text = await preview.innerText();
  ok('R5. the context line once, and the footer', text.split(CONTEXT).length - 1 === 1 && text.includes('Research tool — not a diagnostic device'));
  const pick = pv.find((r) => r.meaning && r.meaning !== 'Within normal range' && !/, (above|below) the norm$/.test(r.meaning));
  ok('R6. (fixture) some row has a meaning phrase to compare', !!pick, pv.map((r) => r.meaning).join(' | '));
  await closeReport();
  ok('R7. Close closes it', (await preview.count()) === 0);
  if (pick) {
    await page.locator(`tr.m-row[data-key="${pick.screen}"]`).click();
    const src = await page.locator('tr.norm-src td').first().innerText();
    ok('R6. the Meaning is the screen\'s own phrase for that row', src.split(' · ')[0] === pick.meaning, `${src} vs ${pick.meaning}`);
    await openReport();
    const box = preview.locator(`tr.r-row[data-key="${pick.key}"] input`);
    await box.fill('Mild Class II, compensated SYNTHETIC'); await box.press('Tab'); await page.waitForTimeout(400);
    const saved = JSON.parse((await stored('report_words:c1')) ?? '{}');
    ok('R8. a changed word is saved with the film, with the words it replaced', saved[pick.key]?.text === 'Mild Class II, compensated SYNTHETIC'
      && saved[pick.key]?.was === pick.meaning, JSON.stringify(saved));
    await preview.locator('h2').first().click();   // focus out of the boxes: Esc in a box only undoes that box
    await page.keyboard.press('Escape'); await page.waitForTimeout(300);
    ok('R7. Esc closes it', (await preview.count()) === 0);
    if (await preview.count()) await closeReport();
    await openReport();
    ok('R9. closed and reopened, the changed word is still there, with one Reset', (await box.inputValue()) === 'Mild Class II, compensated SYNTHETIC'
      && (await preview.getByRole('button', { name: 'Reset to my words' }).count()) === 1);
    await preview.getByRole('button', { name: 'Reset to my words' }).click(); await page.waitForTimeout(400);
    ok('R10. Reset puts the usual words back and forgets the change', (await box.inputValue()) === pick.meaning
      && JSON.stringify(JSON.parse((await stored('report_words:c1')) ?? '{}')) === '{}');
    await closeReport();
    // A change written for a value the row no longer has: offered back, never printed.
    await page.evaluate((k) => { const db = JSON.parse(localStorage.getItem('fakeLib'));
      db.settings['report_words:c1'] = JSON.stringify({ [k]: { text: 'old words SYNTHETIC', was: 'Severe nothing' } }); localStorage.setItem('fakeLib', JSON.stringify(db)); }, pick.key);
    await openReport();
    const note = preview.locator(`tr.r-row[data-key="${pick.key}"] .stale-note`);
    ok('R11. a change that no longer applies is offered back and not shown in the box', (await note.count()) === 1
      && (await note.innerText()).includes('old words SYNTHETIC') && (await box.inputValue()) === pick.meaning);
    await note.getByRole('button', { name: 'Use them' }).click(); await page.waitForTimeout(400);
    ok('R11. "Use them" puts the old words back for today\'s value', (await box.inputValue()) === 'old words SYNTHETIC' && (await note.count()) === 0);
    await preview.getByRole('button', { name: 'Reset to my words' }).click(); await page.waitForTimeout(300);
    await closeReport();
  }

  // R13 (preflight-rulings Task 8): the open film must not change behind the preview — select S on the Landmarks
  // tab (clicking the canvas mark itself never lands: the CephCanvas stage sits over the SVG marks), nudge it with
  // an arrow key while the preview is open and confirm the stored row is untouched; then prove the check is not
  // vacuous by showing the SAME key, once closed, does move it (and persist, past the 600 ms autosave debounce).
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await page.locator('.lm-list button', { has: page.locator('b', { hasText: /^S$/ }) }).click();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  const sBefore = (await lib()).cases.c1.landmarks.find((l) => l.id === 'S');
  await openReport();
  await page.keyboard.press('ArrowRight');
  await page.waitForTimeout(900);
  const sDuringReport = (await lib()).cases.c1.landmarks.find((l) => l.id === 'S');
  ok('R13. an arrow key does not move the active point while the preview is open', sDuringReport.x === sBefore.x && sDuringReport.y === sBefore.y,
    `${sBefore.x},${sBefore.y} vs ${sDuringReport.x},${sDuringReport.y}`);
  await closeReport();
  await page.keyboard.press('ArrowRight');
  await page.waitForFunction((x) => { const db = JSON.parse(localStorage.getItem('fakeLib')); return db.cases.c1.landmarks.find((l) => l.id === 'S').x !== x; },
    sBefore.x, { timeout: 3000 }).catch(() => {});
  const sAfter = (await lib()).cases.c1.landmarks.find((l) => l.id === 'S');
  ok('R13 control. once closed, the same key does move it (so the check above is not vacuous)', sAfter.x !== sBefore.x, `${sBefore.x} -> ${sAfter.x}`);

  // R14 (review I2, fix round 1): drags, not just keys, must not move a point while the preview is open. Dispatched
  // DIRECTLY on .stage (the pointerdown/pointermove/pointerup listeners CephCanvas itself attaches), never through
  // Playwright's own page.mouse (which respects hit-testing and would just hit the backdrop on top) — so this test
  // is not fooled by CSS stacking the way the reviewer flagged: it proves the explicit `readOnly` guard, not the
  // backdrop's incidental occlusion.
  const dragS = async (dx, dy) => page.evaluate(({ dx, dy }) => {
    const stage = document.querySelector('.stage');
    const mark = document.querySelector('g.landmark[data-id="S"] circle, g.landmark[data-id="S"] rect');
    const r = mark.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    // `buttons` (the held-down bitmask) matters here, not just `button` (which one triggered this event):
    // CephCanvas's own onPointerMove bails out as "released outside" the instant e.buttons is 0 while a drag is
    // in progress, so a move with buttons left at its default (0) would cancel the drag before it could move
    // anything — same whether the guard is present or not, which is exactly how this looked at first.
    const base = { bubbles: true, cancelable: true, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons: 1 };
    stage.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x, clientY: y }));
    stage.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: x + dx, clientY: y + dy }));
    stage.dispatchEvent(new PointerEvent('pointerup', { ...base, buttons: 0, clientX: x + dx, clientY: y + dy }));
  }, { dx, dy });
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await page.locator('.lm-list button', { has: page.locator('b', { hasText: /^S$/ }) }).click();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  const s14Before = (await lib()).cases.c1.landmarks.find((l) => l.id === 'S');
  await openReport();
  await dragS(60, 60);
  await page.waitForTimeout(900);
  const s14During = (await lib()).cases.c1.landmarks.find((l) => l.id === 'S');
  ok('R14. a drag (dispatched directly on .stage, bypassing the backdrop) does not move the point while the preview is open',
    s14During.x === s14Before.x && s14During.y === s14Before.y, `${s14Before.x},${s14Before.y} vs ${s14During.x},${s14During.y}  errors=${errors.slice(-2).join(' | ')}`);
  await closeReport();
  await dragS(60, 60);
  await page.waitForFunction((x) => { const db = JSON.parse(localStorage.getItem('fakeLib')); return db.cases.c1.landmarks.find((l) => l.id === 'S').x !== x; },
    s14Before.x, { timeout: 3000 }).catch(() => {});
  const s14After = (await lib()).cases.c1.landmarks.find((l) => l.id === 'S');
  ok('R14 control. once closed, the same drag does move it (so the check above is not vacuous)', s14After.x !== s14Before.x, `${s14Before.x} -> ${s14After.x}`);

  await page.getByRole('button', { name: 'Superimposition ›' }).click(); await page.waitForTimeout(300);
  ok('R12. Export › is greyed on the read-only Superimposition page', await page.getByRole('button', { name: 'Export ›' }).isDisabled());
  await page.getByRole('button', { name: '‹ Tracing' }).click();

  // Task 9: Save PDF… and Export CSV… for this film (R15-R23 — the task-9-brief.md Step 5 draft used R13-R21,
  // which collide with this file's own R13 (stale-note offer) and R14 (the open-film-frozen-behind-the-preview
  // checks above); renumbered here so every label in this file is unique).
  const TIDY = 'film,patient,library_patient_id,printed_patient_id,scan_id,date_of_birth,sex,film_date,age_years,age_source,timepoint,analysis_id,analysis,measurement_id,measurement,value,value_display,unit,status,norm,norm_mean,norm_sd,z,stars,severity,side,meaning,meaning_edited,norm_source,norm_auto,scale,mm_per_px,verified_by,verified_at,models,exported_at,app_version';
  const written = () => page.evaluate(() => window.__written.length);
  const last = async () => page.evaluate(() => { const w = window.__written[window.__written.length - 1]; return { path: w.path, bytes: w.bytes }; });
  const latin = (w) => Buffer.from(w.bytes).toString('latin1'), utf8 = (w) => Buffer.from(w.bytes).toString('utf8');
  // jsPDF's own number formatting is not exact-string-stable (seen live, debugged for this task): A4's 595.28pt
  // came back as "595.2799999999999727" (float noise from its internal unit conversion), and Letter's exact 612pt
  // came back as "612." (a bare trailing dot, no digits) — both parse fine with parseFloat, neither matches a
  // literal "595.28"/"612" string. Compare the parsed numbers with a small tolerance instead of the page's raw text.
  const mediaBox = (w) => { const m = latin(w).match(/\/MediaBox \[0 0 ([0-9.]+) ([0-9.]+)\]/); return m && [parseFloat(m[1]), parseFloat(m[2])]; };
  const close = (a, b, eps = 0.01) => typeof a === 'number' && Math.abs(a - b) < eps;
  const save = async (button, path) => {
    const n = await written();
    await page.evaluate((p) => { window.__nextSave = p; }, path);
    await preview.getByRole('button', { name: button }).click();
    return page.waitForFunction((k) => window.__written.length > k, n, { timeout: 30000 }).then(() => true).catch(() => false);
  };
  await openReport();
  await page.waitForFunction(() => !document.querySelector('[aria-label="Report preview"] button.primary')?.disabled, null, { timeout: 30000 });
  const okA4 = await save('Save PDF…', '/Users/demo/out/SYNTHETIC report.pdf');
  const a4 = okA4 ? await last() : null;
  ok('R15. Save PDF… writes a PDF where the clinician chose', !!a4 && a4.path === '/Users/demo/out/SYNTHETIC report.pdf' && latin(a4).startsWith('%PDF-'), a4?.path);
  const a4Box = a4 && mediaBox(a4);
  ok('R15. A4, with the film embedded', !!a4Box && close(a4Box[0], 595.28) && close(a4Box[1], 841.89) && latin(a4).includes('/Subtype /Image'), JSON.stringify(a4Box));
  await preview.getByLabel('Include the film').uncheck();
  const nf = (await save('Save PDF…', '/Users/demo/out/no film.pdf')) ? await last() : null;
  ok('R16. without the film: no image in the file (control for R15)', !!nf && !latin(nf).includes('/Subtype /Image'));
  await preview.getByRole('radio', { name: 'Letter' }).click();
  const lt = (await save('Save PDF…', '/Users/demo/out/letter.pdf')) ? await last() : null;
  const ltBox = lt && mediaBox(lt);
  ok('R17. Letter pages', !!ltBox && close(ltBox[0], 612) && close(ltBox[1], 792), JSON.stringify(ltBox));
  await closeReport(); await openReport();
  ok('R17. Letter is remembered', (await preview.getByRole('radio', { name: 'Letter' }).getAttribute('aria-checked')) === 'true'
    && (await stored('report_paper')) === 'letter');
  const before = await written();
  await page.evaluate(() => { window.__nextSave = null; });
  await preview.getByRole('button', { name: 'Save PDF…' }).click(); await page.waitForTimeout(800);
  ok('R18. cancelling the save dialog writes nothing and says nothing', (await written()) === before && (await preview.locator('.report-error').count()) === 0);
  await page.evaluate(() => { window.__failWrite = 'SYNTHETIC: the disk is full'; window.__nextSave = '/Users/demo/out/x.pdf'; });
  await preview.getByRole('button', { name: 'Save PDF…' }).click(); await page.waitForTimeout(1500);
  const err = (await preview.locator('.report-error').allInnerTexts()).join(' ');
  ok('R19. a failed write says why', err.includes('SYNTHETIC: the disk is full'), err);
  await page.evaluate(() => { window.__failWrite = null; });
  ok('R20. Named is chosen by default for this film, Anonymised offered beside it (owner R4, ANON-1)',
    (await preview.getByRole('radio', { name: 'Named' }).getAttribute('aria-checked')) === 'true'
    && (await preview.getByRole('radio', { name: 'Anonymised' }).count()) === 1);
  const one = (await save('Export CSV…', '/Users/demo/out/one.csv')) ? await last() : null;
  // This fixture's film carries no printed/library patient ID (library_import above sets patientId: null), so
  // the "Named" check is on the fields this fixture actually HAS: the patient's name, date of birth and scan id.
  ok('R20. the CSV starts with the byte-order mark and the heading line, and names the patient', !!one && one.bytes[0] === 0xef && one.bytes[1] === 0xbb && one.bytes[2] === 0xbf
    && utf8(one).replace(/^﻿/, '').split('\r\n')[0] === TIDY && ['Demo Synthetic', 'L-00042', '1990-03-07', 'SYNTHETIC-4471'].every((x) => utf8(one).includes(x)));   // SYNTHETIC
  if (pick) {
    const box2 = preview.locator(`tr.r-row[data-key="${pick.key}"] input`);
    await box2.fill('just typed SYNTHETIC');
    const typed = (await save('Export CSV…', '/Users/demo/out/typed.csv')) ? await last() : null;   // the click blurs the box: save and export race
    // Review I1 (fix round 1): this check exercises the real race end to end but cannot FAIL it — the fake
    // settings_set above resolves in a microtask, so React has already re-rendered with the saved word before
    // Playwright's click() fires, whatever useReport/useReportWords do. The guard that can actually fail on this
    // race is the deterministic unit test src/report/useReport.flush.test.ts (a hand-resolved promise forces the
    // race instead of relying on timing) — see e2e/README.md.
    ok('R21. a word typed just before Export CSV… is in the file', !!typed && utf8(typed).includes('just typed SYNTHETIC'));
    await preview.getByRole('button', { name: 'Reset to my words' }).click(); await page.waitForTimeout(300);
  }
  await preview.getByRole('radio', { name: 'Anonymised' }).click();
  const anon = (await save('Export CSV…', '/Users/demo/out/anon.csv')) ? await last() : null;
  const at = anon ? utf8(anon) : '';
  ok('R22. Anonymised: no name, no date of birth, no IDs, a coded patient; the film date stays (ANON-1)', !!anon
    && ['Demo Synthetic', 'L-00042', '1990-03-07', 'SYNTHETIC-4471'].every((x) => !at.includes(x))
    && at.includes('2024-02-07') && /,P-[0-9a-f]{10},/.test(at), at.split('\r\n')[1]);   // SYNTHETIC
  ok('R22. the salt is made once and kept', /^[0-9a-f]{32}$/.test((await stored('export_salt')) ?? ''));
  await preview.getByRole('radio', { name: 'One row per film' }).click();
  const wide = (await save('Export CSV…', '/Users/demo/out/wide.csv')) ? await last() : null;
  const wl = wide ? utf8(wide).replace(/^﻿/, '').split('\r\n').filter(Boolean) : [];
  ok('R23. one row per film: one heading line and one film line, a column per analysis.measurement', wl.length === 2 && wl[0].includes('steiner.m01_SNA'), wl[0]);
  await closeReport();

  // Task 10: Library ▸ Select ▸ Export CSV… (several films, one file).
  const toLibrary = async () => { await page.getByRole('button', { name: '‹ Library' }).click(); await page.waitForSelector('.library'); };
  await toLibrary();
  await importFile('report-2.png');
  await toLibrary();
  const cards = page.locator('.card button.open');
  const rowsOf = (w) => utf8(w).replace(/^﻿/, '').split('\r\n').filter(Boolean).slice(1).map((l) => l.split(','));
  const libSays = async (t) => (await page.locator('.library [role="status"]').allInnerTexts()).some((x) => x.includes(t));
  ok('L1. Select is offered in the Library', (await page.getByRole('button', { name: 'Select' }).count()) === 1);
  await page.getByRole('button', { name: 'Select' }).click();
  ok('L1. nothing chosen: Export CSV… is greyed', await page.getByRole('button', { name: 'Export CSV…' }).isDisabled()
    && (await page.locator('.lib-toolbar [role="status"]').innerText()).startsWith('0 chosen'));
  ok('L1. while choosing, the cards say Choose, not Open, and Delete is hidden', (await cards.nth(0).getAttribute('aria-label')).startsWith('Choose ')
    && (await page.locator('.card .del').count()) === 0);
  await cards.nth(0).click(); await cards.nth(1).click();
  ok('L2. two films chosen, ticked, and no film opened', (await page.locator('.lib-toolbar [role="status"]').innerText()).startsWith('2 chosen')
    && (await page.locator('.library').count()) === 1 && (await page.locator('.card .pick.on').count()) === 2);
  await page.getByRole('button', { name: 'Export CSV…' }).click();
  const dlg = page.locator('[role="dialog"][aria-label="Export CSV"]');
  ok('L3. several films: Anonymised chosen by default, Named offered (owner R4, ANON-1)',
    (await dlg.getByRole('radio', { name: 'Anonymised' }).getAttribute('aria-checked')) === 'true' && (await dlg.getByRole('radio', { name: 'Named' }).count()) === 1);
  let n = await written();
  await page.evaluate(() => { window.__nextSave = '/Users/demo/out/all.csv'; });
  await dlg.getByRole('button', { name: 'Save…' }).click();
  await page.waitForFunction((k) => window.__written.length > k, n, { timeout: 30000 }).catch(() => {});
  const allW = (await written()) > n ? await last() : null;
  const all = allW ? rowsOf(allW) : [];
  // Fix round 1 (review I1): widened with the library ID too — both films here come from the stub's
  // library_import, which gives every case the same libraryId: 'L-00042'.
  ok('L4. one file: both films, one coded patient, no name, date of birth, scan ID or library ID', !!allW && allW.path === '/Users/demo/out/all.csv'
    && new Set(all.map((r) => r[0])).size === 2 && new Set(all.map((r) => r[1])).size === 1
    && all.every((r) => /^P-[0-9a-f]{10}$/.test(r[1])) && ['Demo Synthetic', 'L-00042', '1990-03-07', 'SYNTHETIC-4471'].every((x) => !utf8(allW).includes(x)), `${all.length} rows`);   // SYNTHETIC
  ok('L4. the Library says how many went in, and the window closed', (await libSays('2 films exported.')) && (await dlg.count()) === 0);
  await cards.nth(1).click();   // un-choose the second
  await page.getByRole('button', { name: 'Export CSV…' }).click();
  ok('L5. one film chosen: Named chosen by default', (await dlg.getByRole('radio', { name: 'Named' }).getAttribute('aria-checked')) === 'true'
    && (await dlg.locator('h2').innerText()).includes('1 film'));
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  await cards.nth(1).click();
  const ids = (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fakeLib')).cases))).sort();
  await page.evaluate((id) => { window.__failOpen = id; }, ids[1]);
  await page.getByRole('button', { name: 'Export CSV…' }).click();
  n = await written();
  await page.evaluate(() => { window.__nextSave = '/Users/demo/out/some.csv'; });
  await dlg.getByRole('button', { name: 'Save…' }).click();
  await page.waitForFunction((k) => window.__written.length > k, n, { timeout: 30000 }).catch(() => {});
  const some = (await written()) > n ? rowsOf(await last()) : [];
  ok('L6. a film that cannot be read is left out, counted, and the rest exported', new Set(some.map((r) => r[0])).size === 1
    && (await libSays('1 film exported; 1 could not be read and was left out.')));
  await page.evaluate(() => { window.__failOpen = null; window.__failOpenAll = true; });   // every film fails: no file, a message, the window stays
  await page.getByRole('button', { name: 'Export CSV…' }).click();
  n = await written();
  await page.evaluate(() => { window.__nextSave = '/Users/demo/out/none.csv'; });
  await dlg.getByRole('button', { name: 'Save…' }).click(); await page.waitForTimeout(800);
  const noneErr = (await dlg.locator('.report-error').allInnerTexts()).join(' ');
  ok('L9. every film failing: no file, and the window says why', (await written()) === n && noneErr.includes('none of the 2 chosen films could be read'), noneErr);
  await page.evaluate(() => { window.__failOpenAll = false; window.__failOpen = null; });
  await dlg.getByRole('button', { name: 'Cancel' }).click();
  // NOCLIN-2 (preflight-rulings Task 10): a film whose Referring practitioner has saved words uses them in the CSV;
  // the other film (no referrer) uses the login name's, which here are the approved words.
  // measurement_id is found by its heading (Task 14: age_source moved it from column 12 to 13; L2/Task 11 had moved
  // it from 11 to 12) so a new column can never again silently point this at another one.
  const midAt = TIDY.split(',').indexOf('measurement_id');
  const nodes = [...new Set(all.map((r) => r[midAt]))];
  await page.evaluate(({ id, nodes }) => { const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.cases[id].referringPractitioner = '  synthetic DR ref ';   // matched to the clinician list ignoring capitals and spaces
    db.settings['meanings:SYNTHETIC Dr Ref'] = JSON.stringify(Object.fromEntries(nodes.map((k) => [k, { high: 'SYNTHETIC referrer words', low: 'SYNTHETIC referrer words' }])));
    localStorage.setItem('fakeLib', JSON.stringify(db)); window.__opNames = ['SYNTHETIC Dr Ref']; }, { id: ids[1], nodes });
  await page.getByRole('button', { name: 'Export CSV…' }).click();
  await dlg.getByRole('radio', { name: 'Named' }).click();
  n = await written();
  await page.evaluate(() => { window.__nextSave = '/Users/demo/out/words.csv'; });
  await dlg.getByRole('button', { name: 'Save…' }).click();
  await page.waitForFunction((k) => window.__written.length > k, n, { timeout: 30000 }).catch(() => {});
  const wordLines = (await written()) > n ? utf8(await last()).replace(/^﻿/, '').split('\r\n').filter(Boolean).slice(1) : [];
  const withRef = wordLines.filter((l) => l.includes('SYNTHETIC referrer words'));
  ok("L10. each film's meaning words follow its own referrer (NOCLIN-2)", withRef.length > 0 && withRef.every((l) => l.startsWith(`${ids[1]},`))
    && wordLines.some((l) => l.startsWith(`${ids[0]},`)), `${withRef.length} of ${wordLines.length} lines`);
  await page.evaluate(() => { window.__opNames = null; });
  await page.getByRole('button', { name: 'Done' }).click();
  ok('L7. Done: back to opening films, nothing ticked', (await page.getByRole('button', { name: 'Select' }).count()) === 1
    && (await cards.nth(0).getAttribute('aria-label')).startsWith('Open ') && (await page.locator('.card .pick').count()) === 0);
  await page.getByRole('button', { name: 'Select' }).click();
  ok('L7. Select again starts with nothing chosen', (await page.locator('.lib-toolbar [role="status"]').innerText()).startsWith('0 chosen'));
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: /^Recently deleted/ }).click();
  ok('L8. Recently deleted: no Select', (await page.getByRole('button', { name: 'Select' }).count()) === 0);
  await page.getByRole('button', { name: /^All cases/ }).click();

  // R3 (request G merge, final-review.md D8): a film with no ruler, fitted to T1 (ruler 0.1) at ×1.042 with "Use the
  // scale from the fit" on. Its preview says so (header, a † on each shown mm value, the note), its CSV names the fit,
  // and Library ▸ Export CSV… gives the same value cells as the preview's own CSV.
  const csvRows = (w) => utf8(w).replace(/^\uFEFF/, '').split('\r\n').filter(Boolean).map((l) => {
    const out = []; let cur = '', q = false;
    for (let i = 0; i < l.length; i++) { const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur); cur = ''; } else cur += ch; }
    out.push(cur); return out; });
  await page.evaluate(() => { window.__opNames = null; });
  await importFile('report-3.png');
  await page.waitForTimeout(900);   // past the autosave, so the stored film has its points
  const fid = (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fakeLib')).cases))).sort().pop();
  await page.evaluate(({ fid, ref }) => { const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.cases[fid].timepoint = 'T2'; db.fits = db.fits || {};
    db.fits[fid] = { refCaseId: ref, refKind: 'sn', refPoints: [[350, 300], [1050, 200]], filmPoints: [[350, 300], [1050, 200]], mirror: false, scale: 1.042,
      rotation: 0, dx: 0, dy: 0, useOwn: true, refTimepoint: 'T1', refSpacingMm: 0.1, savedBy: 'SYNTHETIC', savedAt: 'x' };
    localStorage.setItem('fakeLib', JSON.stringify(db)); }, { fid, ref: ids[0] });
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Synthetic T2' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  await page.waitForSelector('tr.m-row');
  const squash = (t) => t.replace(/\s+/g, '').replace(/\*+$/, '');
  const scr = await page.$$eval('tr.m-row', (trs) => trs.map((tr) => ({ key: tr.dataset.key, v: tr.querySelectorAll('td')[1].innerText, dagger: !!tr.querySelector('.fit-dagger') })));
  await openReport();
  const fhead = (await preview.locator('.report-header').innerText()).replace(/\s+/g, ' ');
  ok('F1. the preview header names the fit, not "assumed … not shown"', fhead.includes('from a fit: 0.1042 mm per pixel (scaled to T1 on S–N (×1.042)) †')
    && !fhead.includes('not shown'), fhead);
  const fpv = await preview.locator('tr.r-row').evaluateAll((trs) => trs.map((tr) => ({ key: tr.dataset.screenKey, v: tr.querySelectorAll('td')[2].innerText })));
  const daggered = fpv.filter((r) => r.v.includes('†'));
  const same = daggered.filter((r) => { const s = scr.find((x) => x.key === r.key); return s && s.dagger && squash(s.v) === squash(r.v); });
  ok('F2. each † in the preview is on an mm value the screen shows with its †, with the same value', daggered.length > 0
    && same.length === daggered.length && daggered.length === scr.filter((x) => x.dagger).length, `${same.length} of ${daggered.length} preview †; screen † ${scr.filter((x) => x.dagger).length}`);
  const fnote = await preview.locator('.report-fit-note').allInnerTexts();
  ok('F3. the note, once: the film, the fit and the owner\'s G2 sentence', fnote.length === 1
    && fnote[0] === '† T2 scaled to T1 on S–N (×1.042). This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1.', fnote.join(' | '));
  await preview.getByRole('radio', { name: 'Named' }).click();
  await preview.getByRole('radio', { name: 'One row per measurement' }).click();
  const pcsv = (await save('Export CSV…', '/Users/demo/out/fitted.csv')) ? csvRows(await last()) : [];
  const ph = pcsv[0] || [], pRows = pcsv.slice(1);
  const col = (h, name) => h.indexOf(name);
  ok('F4. the preview\'s CSV names the fit in the scale column, on every row', pRows.length > 0
    && pRows.every((r) => r[col(ph, 'scale')] === 'scaled to T1 on S–N (×1.042)'), `${pRows.length} rows; ${pRows[0]?.[col(ph, 'scale')]}`);
  await closeReport();
  await toLibrary();
  await page.getByRole('button', { name: 'Select' }).click();
  await page.getByRole('button', { name: 'Choose Demo Synthetic T2' }).click();
  await page.getByRole('button', { name: 'Export CSV…' }).click();
  await dlg.getByRole('radio', { name: 'Named' }).click();
  await dlg.getByRole('radio', { name: 'One row per measurement' }).click();
  n = await written();
  await page.evaluate(() => { window.__nextSave = '/Users/demo/out/fitted-library.csv'; });
  await dlg.getByRole('button', { name: 'Save…' }).click();
  await page.waitForFunction((k) => window.__written.length > k, n, { timeout: 30000 }).catch(() => {});
  const lcsv = (await written()) > n ? csvRows(await last()) : [];
  const lh = lcsv[0] || [], lRows = lcsv.slice(1);
  const cellsOf = (h, rows) => rows.map((r) => ['analysis_id', 'measurement_id', 'value', 'value_display', 'unit', 'status', 'scale', 'mm_per_px'].map((c) => r[col(h, c)]).join('|'));
  const pc = cellsOf(ph, pRows), lc = cellsOf(lh, lRows);
  const differ = pc.filter((x, i) => x !== lc[i]).length + Math.abs(pc.length - lc.length);
  const mmNum = lRows.filter((r) => r[col(lh, 'unit')] === 'mm' && r[col(lh, 'value')] !== '').length;
  ok('F5. Library ▸ Export CSV… gives the same value cells as the preview\'s CSV (no mm blanked)', lRows.length > 0 && differ === 0 && mmNum > 0,
    `${pc.length} rows compared, ${differ} differ, ${mmNum} mm with a number`);
  await page.getByRole('button', { name: 'Done' }).click();

  // Task 13 (spec 2026-10-19 addendum 3, N): a fine-tuned calibration says so in the preview header and the CSV scale
  // column, and its − / + are disabled while the preview is open.
  await importFile('report-4.png');
  await page.waitForTimeout(900);   // past the autosave
  const nrId = (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fakeLib')).cases))).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).pop();
  await page.evaluate((id) => { const db = JSON.parse(localStorage.getItem('fakeLib')), c = db.cases[id];
    c.timepoint = 'T3'; c.spacingMm = (40 / 400) * ((200 + 2) / 200); c.scaleSteps = 2; c.ruler = { p1: [400, 1000], p2: [800, 1000], mm: 40, steps: 2 };
    localStorage.setItem('fakeLib', JSON.stringify(db)); }, nrId);
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Synthetic T3' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  await page.waitForSelector('tr.m-row');
  const nrTune = page.locator('.inspector .fine-tune'), nrUp = nrTune.getByRole('button', { name: 'Scale up 0.5 %' }), nrDown = nrTune.getByRole('button', { name: 'Scale down 0.5 %' });
  const nrLine = await page.locator('.inspector .scale-line').innerText();
  ok('NR1. the scale line reads "calibrated scale, adjusted +1.0 %", and + is enabled', nrLine.includes('0.1010 mm/px (calibrated scale, adjusted +1.0 %)') && !(await nrUp.isDisabled()), nrLine);
  await openReport();
  const nrHead = await preview.locator('.report-header').innerText();
  ok('NR2. the preview header says the ruler was adjusted', nrHead.includes("calibrated scale, adjusted +1.0 % from the film's ruler (0.1010 mm per pixel)"), nrHead.replace(/\s+/g, ' '));
  ok('NR3. while the preview is open, − and + are disabled', await nrUp.isDisabled() && await nrDown.isDisabled());
  const nrCsv = (await save('Export CSV…', '/Users/demo/out/adjusted.csv')) ? csvRows(await last()) : [];
  const nrH = nrCsv[0] || [], nrRows = nrCsv.slice(1);
  ok('NR4. the CSV scale column says so on every row; mm_per_px is the adjusted value', nrRows.length > 0
    && nrRows.every((r) => r[col(nrH, 'scale')] === 'calibrated scale, adjusted +1.0 %' && Number(r[col(nrH, 'mm_per_px')]) === (40 / 400) * ((200 + 2) / 200)),
    `${nrRows.length} rows; ${nrRows[0]?.[col(nrH, 'scale')]}`);
  await closeReport();
  ok('NR5. preview closed: + is enabled again (control for NR3)', !(await nrUp.isDisabled()));

  // Task 10 (ruling I5): the report's ◆ on Auto rows, its footnote, and addendum 2 J's unstated-enlargement list.
  // No clinic default at all (`db.settings.default_population = null`) and no population of its own. Until 29 Oct
  // 2026 such a case never reached Auto (no ◆, no footnote). Owner decision 6 (29 Oct 2026): after the analysis's own
  // norm and your norms, Auto now fills the rows neither has — Steiner's Pog–NB from Zheng 2026 — so the ◆ and the
  // footnote appear, naming Steiner's own norm as the one missing. The old code fails this check (0 marks, no note).
  // useNorms() reads the clinic default once on mount (useEffect(refresh, [refresh]), refresh's deps never change)
  // — poking localStorage alone does not reach the running app; a full reload does (the same `reopen` pattern
  // e2e10 uses for this exact setting).
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.settings.default_population = null; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.reload();
  await page.waitForSelector('.library');
  await importFile('report-5.png');
  await page.waitForTimeout(900);
  const npId = (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fakeLib')).cases))).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).pop();
  await page.evaluate((id) => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases[id].timepoint = 'T4'; localStorage.setItem('fakeLib', JSON.stringify(db)); }, npId);
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Synthetic T4' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  await page.waitForSelector('tr.m-row');
  await openReport();
  const npAutoCount = await preview.locator('.r-auto').count();
  const npAutoNote = (await preview.locator('.report-auto-note').count()) ? await preview.locator('.report-auto-note').innerText() : '';
  ok('T10-1. no clinic default, no case population: Auto fills Pog–NB — a ◆, and the footnote names Steiner\'s own norm and Pog to NB (owner decision 6; was none)',
    npAutoCount > 0 && npAutoNote.includes("No Steiner's own norm") && npAutoNote.includes('Pog to NB'), `${npAutoCount} marks; ${npAutoNote}`);
  await closeReport();

  // With E-line switched on (still no population): Ricketts 1960's rows carry 'scale-assumed' (e2e10's own J
  // check), so the report's unstated-enlargement list names it.
  await page.getByRole('button', { name: 'Analyses…' }).click();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('checkbox', { name: 'Show E-line' }).check();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('button', { name: 'Done' }).click();
  await openReport();
  const scaleNoteText = (await preview.locator('.report-scale-note').count()) ? await preview.locator('.report-scale-note').innerText() : '';
  ok('T10-2. E-line on, no population: the unstated-enlargement list names Ricketts 1960', scaleNoteText.includes('Ricketts 1960'), scaleNoteText);
  await closeReport();
  await page.getByRole('button', { name: 'Analyses…' }).click();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('checkbox', { name: 'Show E-line' }).uncheck();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('button', { name: 'Done' }).click();

  // A Japanese case (its own population — the Caucasian clinic default stays set elsewhere, I5): no Japanese set
  // has SNA, so Steiner's own norm fills it, Auto — the ◆ and the footnote.
  await toLibrary();
  await importFile('report-6.png');
  await page.waitForTimeout(900);
  const jpId = (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fakeLib')).cases))).sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).pop();
  await page.evaluate((id) => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases[id].timepoint = 'T5'; db.cases[id].population = 'japanese'; localStorage.setItem('fakeLib', JSON.stringify(db)); }, jpId);
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Synthetic T5' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  await page.waitForSelector('tr.m-row');
  await openReport();
  const jpAutoCount = await preview.locator('.r-auto').count();
  const jpAutoNote = (await preview.locator('.report-auto-note').count()) ? await preview.locator('.report-auto-note').innerText() : '';
  ok('T10-3. Japanese population, Steiner on: at least one ◆, and the footnote starts "◆ No Japanese norm"', jpAutoCount > 0 && jpAutoNote.startsWith('◆ No Japanese norm') && (await preview.locator('tr[data-node="m01_SNA"] .r-auto').count()) > 0, `${jpAutoCount} marks; ${jpAutoNote}`);
  await closeReport();

  // Owner, 29 Oct 2026: the three export checkboxes default OFF; the control row doesn't overflow or wrap a
  // label mid-word at the default window size (1440×900) or the narrowest supported size (tauri.conf.json
  // minWidth/minHeight, 1100×700); Close sits at the bottom, styled as the app's primary button.
  await openReport();
  for (const label of ['Profilogram page', 'Norm sources', 'Placed by']) {
    ok(`O1. "${label}" defaults OFF`, (await preview.getByLabel(label).isChecked()) === false, label);
  }
  const checkNoOverflow = async (tag) => {
    const dlgBox = await preview.boundingBox();
    const groups = await preview.locator('.report-actions .report-ctrl-group, .report-actions .segmented').all();
    let worst = 0;
    for (const g of groups) {
      const b = await g.boundingBox();
      if (!b) continue;
      worst = Math.max(worst, b.x + b.width - (dlgBox.x + dlgBox.width));
    }
    // Nothing spills past the dialog's own right edge (which would mean a wrapped/squeezed label, or a horizontal
    // scrollbar) — a couple of px of rounding slack, never dozens.
    ok(`O2. ${tag}: no export control overflows the window (worst = ${worst.toFixed(1)}px)`, worst < 4, `${groups.length} groups`);
    // The DIALOG itself (not the app's own left/right panels behind it, which have a separate, pre-existing
    // minimum width unrelated to this feature — confirmed by probing scrollWidth with the dialog closed, same
    // figure either way) stays inside the window at this size.
    const vp = page.viewportSize();
    ok(`O2. ${tag}: the export window itself stays inside the viewport (right edge = ${(dlgBox.x + dlgBox.width).toFixed(1)}px of ${vp.width}px)`,
      dlgBox.x + dlgBox.width <= vp.width + 1);
  };
  await checkNoOverflow('default window (1440×900)');
  await page.setViewportSize({ width: 1100, height: 700 });   // tauri.conf.json minWidth/minHeight
  await page.waitForTimeout(200);
  await checkNoOverflow('narrowest supported size (1100×700)');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);
  // Close: the LAST button in the preview, visually below every other control (its own row at the bottom), and
  // the app's primary (blue) style — never invented, the same class `button.primary` uses everywhere else.
  const closeBtn = preview.getByRole('button', { name: 'Close' });
  ok('O3. Close has the app\'s primary (blue) style', (await closeBtn.getAttribute('class') || '').split(' ').includes('primary'));
  const closeBox = await closeBtn.boundingBox();
  const otherTops = [];
  for (const b of await preview.locator('button, input[type="checkbox"]').all()) {
    if (await b.evaluate((el, close) => el === close, await closeBtn.elementHandle())) continue;
    const bb = await b.boundingBox();
    if (bb) otherTops.push(bb.y);
  }
  ok('O3. Close sits below every other control in the preview', closeBox && otherTops.length > 0 && otherTops.every((y) => y < closeBox.y),
    `close.y=${closeBox && closeBox.y}, max other y=${Math.max(...otherTops)}`);
  await closeReport();

  // Owner, 5 Nov 2026: "Points table" (ON by default). Off hides the whole Points section; remembered across a reload.
  await openReport();
  ok('O4. "Points table" defaults ON', (await preview.getByLabel('Points table').isChecked()) === true);
  const ptsOn = await preview.locator('.report-points').count();
  ok('O4. (fixture) the film has a Points table to hide', ptsOn === 1, String(ptsOn));
  await preview.getByLabel('Points table').uncheck();
  ok('O4. off: no Points section (heading or table) in the preview',
    (await preview.locator('.report-points').count()) === 0 && !(await preview.locator('h3', { hasText: /^Points$/ }).count()), String(await preview.locator('.report-points').count()));
  await page.waitForTimeout(200);
  ok('O4. off is stored as report_points_table = 0', (await stored('report_points_table')) === '0', String(await stored('report_points_table')));
  await closeReport();
  await page.reload();
  await page.waitForSelector('.library');
  await page.getByRole('button', { name: 'Open Demo Synthetic T5' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await openReport();
  ok('O4. after a reload the box is still off and the section still absent',
    (await preview.getByLabel('Points table').isChecked()) === false && (await preview.locator('.report-points').count()) === 0);
  await preview.getByLabel('Points table').check();
  ok('O4. ticking it again brings the section back', (await preview.locator('.report-points').count()) === 1);
  await closeReport();

  // Owner, 5 Nov 2026: "Grid behind the profilogram" (ON by default; needs the Profilogram page; only on a calibrated film).
  const gridLines = () => preview.locator('.report-profilogram-page line.grid-minor, .report-profilogram-page line.grid-major').count();
  await openReport();
  ok('G1. "Grid behind the profilogram" defaults ON, but is greyed out while "Profilogram page" is off',
    (await preview.getByLabel('Grid behind the profilogram').isChecked()) === true && (await preview.getByLabel('Grid behind the profilogram').isDisabled()) === true);
  ok('G2. page off: no profilogram page and no grid', (await preview.locator('.report-profilogram-page').count()) === 0 && (await gridLines()) === 0);
  await preview.getByLabel('Profilogram page').check();
  ok('G3. page on, film NOT calibrated (assumed scale): the profilogram shows, with no grid and no note',
    (await preview.locator('.report-profilogram-page').count()) === 1 && (await preview.locator('.report-profilogram-page line.grid-minor').count()) === 0
    && !(await preview.locator('.report-profilogram-page').innerHTML()).includes('patient millimetres'), String(await gridLines()));
  await preview.getByLabel('Profilogram page').uncheck();
  await closeReport();
  await page.evaluate((id) => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases[id].spacingMm = 0.1; localStorage.setItem('fakeLib', JSON.stringify(db)); }, jpId);
  await page.reload();
  await page.waitForSelector('.library');
  await page.getByRole('button', { name: 'Open Demo Synthetic T5' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await openReport();
  await preview.getByLabel('Profilogram page').check();
  ok('G4. film calibrated, page on, grid on: mm grid lines are on the profilogram page, with the patient-millimetres note',
    (await preview.getByLabel('Grid behind the profilogram').isDisabled()) === false && (await gridLines()) > 50
    && (await preview.locator('.report-profilogram-page').innerHTML()).includes('patient millimetres'), String(await gridLines()));
  await preview.getByLabel('Grid behind the profilogram').uncheck();
  ok('G5. grid unticked: no grid lines, the profilogram stays', (await gridLines()) === 0 && (await preview.locator('.report-profilogram-page').count()) === 1);
  await page.waitForTimeout(200);
  ok('G6. stored: report_profilogram_grid = 0, report_profilogram_page = 1', (await stored('report_profilogram_grid')) === '0' && (await stored('report_profilogram_page')) === '1');
  await closeReport();
  await page.reload();
  await page.waitForSelector('.library');
  await page.getByRole('button', { name: 'Open Demo Synthetic T5' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await openReport();
  ok('G7. after a reload: page still on, grid still off, no lines',
    (await preview.getByLabel('Profilogram page').isChecked()) === true && (await preview.getByLabel('Grid behind the profilogram').isChecked()) === false && (await gridLines()) === 0);
  await preview.getByLabel('Grid behind the profilogram').check();
  ok('G8. grid ticked again: the lines are back', (await gridLines()) > 50);
  await preview.getByLabel('Profilogram page').uncheck();
  ok('G9. page unticked: the page and the grid are gone, and the grid box greys out',
    (await preview.locator('.report-profilogram-page').count()) === 0 && (await gridLines()) === 0 && (await preview.getByLabel('Grid behind the profilogram').isDisabled()) === true);
  await closeReport();

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
