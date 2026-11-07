// Part D smokes (spec 2026-10-06 §2 Part D): calibrate-to-show, the analysis picker, a measurement waiting on a
// hand-placed point, a user norm entered and used, closed and reopened state. Built UI in Chromium, stubbed Tauri
// runtime, fake library in localStorage. SYNTHETIC image, names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const ORIGINAL_19 = Object.keys(base);
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const seed = { settings: {}, ops: ['Dr A', 'Dr B'], userNorms: [], cases: { c1: { id: 'c1', path: '/Users/demo/c1.png', patientName: 'Demo Synthetic', patientKey: 'demo synthetic',
  dateOfBirth: '2010-01-02', scanId: null, timepoint: 'T1', takenOn: '2026-01-10', takenOnSource: 'label', facing: 'right', orientation: {}, display: {},   // SYNTHETIC
  spacingMm: null, verifiedAt: null, verifiedBy: null, createdAt: '2026-09-30T01:00:00Z', updatedAt: '2026-09-30T01:00:00Z', deletedAt: null,
  identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [], stage: null, inSeries: true, gender: null, referringPractitioner: null, population: null,
  // Task 5 (D2): the real CaseDoc always carries these; a stub without them has the panel read undefined.
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [],
  landmarks: [...Object.entries(base).map(([id, [x, y]]) => ({ id, x: x + 350, y: y + 300, source: 'manual', verified: true, aiX: null, aiY: null, confidence: null })),
    { id: 'Pt', x: 600, y: 540, source: 'ai', verified: false, aiX: 600, aiY: 540, confidence: 0.5 }] } } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, ORIGINAL_19 }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    // T10-2/M9 (fix round 1): record every dialog-plugin call (so a smoke can assert the confirm was actually
    // shown, not just that its reply was 'Yes'), and let a smoke force one named command to fail (so the
    // on-screen failure path — SettingsWindow's try/catch — is exercised for real, not argued).
    const call = (cmd, a) => { const c = JSON.parse(localStorage.getItem('calls') || '[]'); c.push([cmd, a]); localStorage.setItem('calls', JSON.stringify(c)); };
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        const failing = localStorage.getItem('forceFail');
        if (failing && failing === cmd) throw new Error(`SYNTHETIC forced failure: ${cmd}`);
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-main', searched: [], error: null };
          case 'plugin:event|listen': return 1;
          // Task 10: "Delete set…" (Settings ▸ Norms) confirms first, via `ask()` (@tauri-apps/plugin-dialog).
          // Found while writing this smoke, not in the brief: `ask()` calls `invoke('plugin:dialog|message', …)`
          // and resolves true only when the reply equals its `okLabel` ('Yes' by default) — e2e3.cjs's existing
          // `case 'plugin:dialog|ask': return true;` stubs a command name `ask()` never actually invokes, so it has
          // never fired in any real test there either (nothing in e2e3 calls `ask()` on a path an assertion checks).
          // Stubbed correctly here, recording the call and the message shown, and reading its reply from
          // localStorage ('Yes' by default — `setDialogReply` below can flip it to 'No' for one call).
          case 'plugin:dialog|message': call(cmd, a); return localStorage.getItem('dialogReply') || 'Yes';
          case 'library_list': return Object.values(db.cases).map((c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn,
            createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0,
            verifiedAt: c.verifiedAt, deletedAt: null, patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true }));
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, orientation: a.edit.orientation, display: a.edit.display }); store(db);
            return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_calibrate': { const c = db.cases[a.caseId]; c.spacingMm = a.mm / Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]); store(db); return c.spacingMm; }
          // Mirrors the library (spec 2026-10-29 §4.8): a case the upgrade switched (`switchLogged`) offers the undo while
          // on Auto; choosing "Clinic default" (null) withdraws it, Auto again offers it again.
          case 'library_set_case_population': { const c = db.cases[a.caseId]; c.population = a.population;
            c.switchedFromClinicDefault = !!c.switchLogged && a.population === 'auto'; store(db); return null; }
          case 'library_set_patient_background': db.cases[a.caseId].background = a.background; store(db); return null;
          case 'library_set_patient_gender': db.cases[a.caseId].gender = a.gender; store(db); return null;
          case 'library_user_norms': return db.userNorms;
          case 'library_save_user_norm': db.userNorms = [...db.userNorms.filter((u) => !(u.setName === a.norm.setName && u.measurement === a.norm.measurement)), a.norm]; store(db); return null;
          case 'library_delete_user_norm': db.userNorms = db.userNorms.filter((u) => !(u.setName === a.setName && u.measurement === a.measurement)); store(db); return null;
          case 'settings_default_population_get': return db.settings.default_population ?? null;
          case 'settings_default_population_set': db.settings.default_population = a.population; store(db); return null;
          // Spec 2026-10-29 §4.8: the upgrade's note — the seeded count until dismissed.
          case 'settings_auto_switch_note': return db.switchNote ?? null;
          case 'settings_auto_switch_note_dismiss': db.switchNote = null; store(db); return null;
          case 'models_points': return [
            { modelId: 'SYNTHETIC-main', title: 'Main', main: true, points: ORIGINAL_19.map((id) => ({ id, status: { kind: 'original' } })) },
            { modelId: 'SYNTHETIC-extra', title: 'Extra', main: false, points: [{ id: 'Pt', status: { kind: 'notScored' } },
              { id: 'U1A', status: { kind: 'scored', mre: 1.27, n: 150, dataset: 'aariz' } }] }];
          case 'library_ghosts': return [];
          case 'models_list': return [];
          case 'library_label_text': return { lines: [], suggestions: [] };
          case 'operators_list': return { current: db.settings.operator || 'Dr A', names: db.ops };
          case 'operators_set_current': db.settings.operator = a.name; store(db); return null;   // review I-3: a real switch
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png, ORIGINAL_19 });

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await page.locator('.cards .card .open', { hasText: 'T1' }).first().click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  // Quit and reopen the case (fake library kept in localStorage). Used by the sex-hint check (Task 6) and smoke 5.
  const reopen = async () => {
    await page.reload(); await page.waitForSelector('.library');
    await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
    await page.locator('.cards .card .open', { hasText: 'T1' }).first().click();
    await page.waitForSelector('g.landmark[data-id="S"]');
    await page.getByRole('tab', { name: 'Measurements' }).click();
  };
  const row = (label) => page.locator('.inspector table.measures tbody tr.m-row', { has: page.locator('td.m-label', { hasText: label }) }).first();
  // T10-2/M9 (fix round 1): dialog-call recording + a forced-failure switch (see the stub above).
  const dialogCalls = async () => (await page.evaluate(() => JSON.parse(localStorage.getItem('calls') || '[]'))).filter(([c]) => c === 'plugin:dialog|message');
  // A write (clinic default, delete) goes through an async handler + a React re-render; reading right after the
  // triggering action can race it. Polls a real condition instead of a fixed sleep.
  const waitUntil = async (fn, timeout = 3000, step = 50) => {
    const start = Date.now();
    while (Date.now() - start < timeout) { if (await fn()) return true; await new Promise((r) => setTimeout(r, step)); }
    return false;
  };
  const clearDialogCalls = () => page.evaluate(() => localStorage.setItem('calls', '[]'));
  const setDialogReply = (reply) => page.evaluate((r) => localStorage.setItem('dialogReply', r), reply);
  const forceFail = (cmd) => page.evaluate((c) => localStorage.setItem('forceFail', c), cmd);
  const clearForceFail = () => page.evaluate(() => localStorage.removeItem('forceFail'));
  // Fix round 1 (review Minor 3): SNA's OWN source-line row, not just the first one on the page — the sibling
  // `tr.norm-src` the Inspector renders directly after each `tr.m-row` (Inspector.tsx: one Fragment per row).
  const sourceLineOf = (label) => row(label).locator('xpath=following-sibling::tr[1]');
  // Owner, 16 Oct: source lines show only when their row is clicked; open it first (it stays open while the case is open).
  const srcText = async (label) => { const r = row(label); if ((await r.getAttribute('aria-expanded')) === 'false') await r.locator('td.m-label').click(); return sourceLineOf(label).innerText(); };

  // Smoke 1 — calibrate to show (N5).
  ok('1. an angle shows straight away on an uncalibrated film (SNA has a number)', /\d+\.\d°/.test(await row('SNA').locator('td.m-value').innerText()));
  ok('1. an mm value on an uncalibrated film reads "calibrate to show" (Pog to NB)', (await row('Pog to NB').locator('td.m-value').innerText()) === 'calibrate to show');
  ok('1. and is not coloured', (await row('Pog to NB').locator('td.m-value').getAttribute('class')) === 'm-value');
  // Owner, 16 Oct: the norm's source line is hidden until its row is clicked (too much text otherwise).
  ok('1. SNA shows a norm', /±/.test(await row('SNA').locator('td.m-norm').innerText()));
  ok('S1. no source line shows until a row is clicked', (await page.locator('tr.norm-src').count()) === 0, String(await page.locator('tr.norm-src').count()));
  await row('SNA').locator('td.m-label').click();
  ok('S1. clicking SNA shows its own source line, under it (not just the first on the page)', (await page.locator('tr.norm-src').count()) === 1
    && (await sourceLineOf('SNA').getAttribute('class')) === 'norm-src' && (await sourceLineOf('SNA').innerText()).length > 10);
  ok('S1. the row says it is open', (await row('SNA').getAttribute('aria-expanded')) === 'true');
  await row('SNA').locator('td.m-label').click();
  ok('S1. clicking it again hides it', (await page.locator('tr.norm-src').count()) === 0 && (await row('SNA').getAttribute('aria-expanded')) === 'false');
  await row('SNA').focus(); await page.keyboard.press('Enter');
  ok('S1. Enter on a focused row opens it too', (await page.locator('tr.norm-src').count()) === 1);
  await page.keyboard.press('Enter');
  const pog = row('Pog to NB');
  ok('S2. setup: Pog to NB has a source line to open and a "calibrate to show" link', (await pog.getAttribute('aria-expanded')) === 'false'
    && (await pog.locator('td.m-value button').count()) === 1, String(await pog.getAttribute('aria-expanded')));
  await pog.locator('td.m-value button').click(); await page.waitForTimeout(150);
  ok('S2. clicking "calibrate to show" starts calibrating and does not open the row', (await pog.getAttribute('aria-expanded')) === 'false'
    && (await page.locator('.place-hint').allInnerTexts()).join(' ').includes('ruler mark'), (await page.locator('.place-hint').allInnerTexts()).join(' | '));
  await page.keyboard.press('Escape'); await page.waitForTimeout(100);
  // Owner TABLE-2 (16 Oct): no "Measurement" heading; Result, then Mean ± SD; stars straight after the Result.
  const heads = await page.locator('.inspector table.measures thead th').allInnerTexts();
  ok('T2. headings are (blank) · Result · Mean ± SD', JSON.stringify(heads.map((h) => h.trim())) === JSON.stringify(['', 'Result', 'Mean ± SD']), JSON.stringify(heads));
  const starred = await page.locator('.inspector table.measures tr.m-row td.m-value .stars').evaluateAll((els) => els.map((e) => [e.textContent.trim(), e.closest('td').className]));
  ok('T2. stars sit in coloured Result cells and match the colour (amber *, red ** or ***)', starred.length > 0
    && starred.every(([t, c]) => (c.includes('norm-amber') && t === '*') || (c.includes('norm-red') && (t === '**' || t === '***'))), JSON.stringify(starred));
  // Review M-9: the converse too — every amber Result has exactly *, every red one ** or ***.
  const colourStars = await page.locator('.inspector table.measures tr.m-row td.norm-amber, .inspector table.measures tr.m-row td.norm-red').evaluateAll((els) =>
    els.map((td) => [td.className.includes('norm-red') ? 'red' : 'amber', (td.querySelector('.stars')?.textContent ?? '').trim()]));
  ok('T2. every coloured Result carries its stars (amber *, red ** or ***)', colourStars.length > 0
    && colourStars.every(([c, t]) => (c === 'amber' ? t === '*' : t === '**' || t === '***')), JSON.stringify(colourStars));
  ok('T2. a green Result has no stars', (await page.locator('.inspector table.measures td.m-value:not(.norm-amber):not(.norm-red) .stars').count()) === 0);
  const starRow = page.locator('.inspector table.measures tr.m-row.has-src', { has: page.locator('.stars') }).first();
  await starRow.locator('td.m-label').click(); await page.waitForTimeout(100);
  const starSrc = await starRow.locator('xpath=following-sibling::tr[1]').innerText();
  // Owner MEANING-APPROVE (16 Oct): the phrase (severity word + the approved term) leads the detail line.
  ok('T2. its detail line starts with the phrase and how many SD (e.g. "Mild Class II · 1.34 SD above the mean")', /^(Mild|Moderate|Severe) [A-Za-z][^·]+ · \d+\.\d\d SD (above|below) the mean/.test(starSrc), starSrc.slice(0, 80));
  await starRow.locator('td.m-label').click();
  // Owner MEANING-PER-CLINICIAN (16 Oct): Settings › Meanings changes the words for the current clinician (Dr A here).
  const starNode = await starRow.getAttribute('data-node');
  const phraseOf = async () => { const r = page.locator(`.inspector table.measures tr.m-row[data-node="${starNode}"]`).first();
    if ((await r.getAttribute('aria-expanded')) === 'false') await r.locator('td.m-label').click();
    const t = await r.locator('xpath=following-sibling::tr[1]').innerText(); await r.locator('td.m-label').click(); return t; };
  const before = await phraseOf();
  await page.getByRole('button', { name: 'Settings…' }).click();
  const mset = page.getByRole('dialog', { name: 'Settings' });
  await mset.getByRole('tab', { name: 'Meanings' }).click();
  const mrow = mset.locator(`.meanings-row[data-node="${starNode}"]`);
  ok('M1. Settings › Meanings lists every measurement with its approved words, for the current clinician', (await mset.locator('.meanings-row').count()) === 91   /* 91: #93 BaSN added, owner ruling 7 Nov 2026 */
    && (await mset.innerText()).includes('Dr A'), String(await mset.locator('.meanings-row').count()));
  for (const side of ['above', 'below']) { const f = mrow.getByLabel(new RegExp(`, ${side} the norm$`)); await f.fill('SYNTHETIC-term'); await f.blur(); }
  await page.waitForTimeout(200);
  ok('M1. a changed row shows the approved words and a Reset', (await mrow.locator('.meaning-default').count()) === 2 && (await mrow.getByRole('button', { name: /Reset/ }).count()) === 2);
  await mset.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(200);
  const after = await phraseOf();
  ok('M1. the detail line now uses the clinician\'s words', /^(Mild|Moderate|Severe) SYNTHETIC-term · /.test(after), `${before.slice(0, 40)} -> ${after.slice(0, 40)}`);
  // Review I-3: words belong to a clinician — switching to Dr B shows the approved words, switching back shows Dr A's.
  const pick = async (who) => { await page.getByLabel('Who is tracing').selectOption(who); await page.waitForTimeout(300); };
  await pick('Dr B');
  ok('M1. another clinician (Dr B) sees the approved words', (await phraseOf()) === before, (await phraseOf()).slice(0, 40));
  await pick('Dr A');
  ok('M1. switching back to Dr A shows Dr A\'s words again', /^(Mild|Moderate|Severe) SYNTHETIC-term · /.test(await phraseOf()), (await phraseOf()).slice(0, 40));
  ok('M1. saved for Dr A on this Mac', (await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings['meanings:Dr A'] || '')).includes('SYNTHETIC-term'));
  await page.getByRole('button', { name: 'Settings…' }).click();
  await mset.getByRole('tab', { name: 'Meanings' }).click();
  for (let i = 0; i < 4 && (await mrow.getByRole('button', { name: /Reset/ }).count()) > 0; i++) { await mrow.getByRole('button', { name: /Reset/ }).first().click(); await page.waitForTimeout(150); }
  await mset.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(200);
  ok('M1. Reset puts the approved words back', (await phraseOf()) === before, (await phraseOf()).slice(0, 40));

  // NOCLIN-2 (ruling, 17 Oct 2026, item 34): with no one chosen in the top bar, the open film's
  // Referring practitioner's own saved words are used if the referrer has any saved; else the Mac login name
  // (today's rule). The picker itself can never show "none chosen" — Rust's `operator()` always falls back to
  // the login name — so "nobody chosen" is simulated the one way the real app can reach it too: the `operator`
  // setting left unset from the start (a fresh install, before anyone ever used the top-bar picker).
  // Dr B's own saved words, set directly (as if Dr B had once been the top-bar clinician and used Settings ›
  // Meanings), independently of the UI flow above, which just Reset Dr A's.
  await page.evaluate((node) => { const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.settings['meanings:Dr B'] = JSON.stringify({ [node]: { high: 'SYNTHETIC-referrer-term' } });
    localStorage.setItem('fakeLib', JSON.stringify(db)); }, starNode);
  const clearExplicitOperator = () => page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); delete db.settings.operator; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  const setReferrer = (name) => page.evaluate((n) => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases.c1.referringPractitioner = n; localStorage.setItem('fakeLib', JSON.stringify(db)); }, name);
  await clearExplicitOperator(); await setReferrer('  dr   b  ');   // extra spaces and capitals — must still match "Dr B"
  await reopen();
  ok('N2. rule 2: nobody chosen in the top bar — the referrer\'s own words are used (matched ignoring case/spacing)',
    /^(Mild|Moderate|Severe) SYNTHETIC-referrer-term · /.test(await phraseOf()), (await phraseOf()).slice(0, 60));
  await page.getByRole('button', { name: 'Settings…' }).click();
  await mset.getByRole('tab', { name: 'Meanings' }).click();
  ok('N2. Settings › Meanings says, in one plain line, that this film shows the referrer\'s words',
    (await mset.innerText()).includes("This film shows Dr B's words (the referring practitioner)."));
  const mrowInputs = await mrow.locator('input').evaluateAll((els) => els.map((e) => e.value));
  ok('N2. but Settings › Meanings still EDITS the Mac-login clinician\'s words (Dr A here), never the referrer\'s',
    (await mset.innerHTML()).includes('<b>Dr A</b>') && mrowInputs.every((v) => v !== 'SYNTHETIC-referrer-term'), JSON.stringify(mrowInputs));
  await mset.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(200);

  // Edge case: the referrer has no saved words of their own — falls through to the Mac login name (rule 3).
  await setReferrer('Dr C'); await reopen();
  ok('N2. a referrer with no saved words falls through to the Mac login name (the approved words return)', (await phraseOf()) === before, (await phraseOf()).slice(0, 60));
  await page.getByRole('button', { name: 'Settings…' }).click();
  await mset.getByRole('tab', { name: 'Meanings' }).click();
  ok('N2. and Settings › Meanings shows no referrer note then', !(await mset.innerText()).includes('the referring practitioner'));
  await mset.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(200);

  // Restore today's rule for the rest of this file: an explicit top-bar clinician again (Dr A).
  await pick('Dr A'); await setReferrer(null);

  // Owner CHART-TAB-1 (16 Oct): a Chart tab with the same rows, order and heights as Measurements; panel not wider.
  const centreOf = async (id) => { const b = await page.locator(`g.landmark[data-id="${id}"] circle, g.landmark[data-id="${id}"] rect`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const dragPt = async (id, dx, dy) => { const c = await centreOf(id); await page.mouse.move(c.x, c.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + dx * i / 8, c.y + dy * i / 8); await page.mouse.up(); };
  const geo = () => page.locator('.inspector .inspector-scroll table.measures tbody tr.m-row').evaluateAll((els) => els.map((e) => [e.getAttribute('data-node') || e.querySelector('td').textContent.trim().slice(0, 14), Math.round(e.getBoundingClientRect().top), Math.round(e.getBoundingClientRect().height)]));
  const w0 = (await page.locator('.inspector').boundingBox()).width, mRows = await geo();
  await page.getByRole('tab', { name: 'Chart' }).click(); await page.waitForTimeout(150);
  const cRows = await geo(), w1 = (await page.locator('.inspector').boundingBox()).width;
  await page.locator('.inspector').screenshot({ path: `${__dirname}/out/chart-tab.png` });   // SYNTHETIC film; for a look by eye
  await page.getByRole('tab', { name: 'Measurements' }).click(); await page.locator('.inspector').screenshot({ path: `${__dirname}/out/measures-tab.png` });
  await page.getByRole('tab', { name: 'Chart' }).click(); await page.waitForTimeout(100);
  ok('CH1. the Chart tab lists the same measurements, in the same order, at the same row tops and heights', mRows.length > 5 && cRows.length === mRows.length
    && JSON.stringify(cRows.map((r) => r.slice(1))) === JSON.stringify(mRows.map((r) => r.slice(1))), `${mRows.length} vs ${cRows.length}: ${JSON.stringify(mRows.slice(0, 3))} / ${JSON.stringify(cRows.slice(0, 3))}`);
  ok('CH1. the panel does not widen', Math.abs(w1 - w0) < 1, `${w0} -> ${w1}`);
  // MEANING-APPROVE: the Chart tab's label is the approved abbreviation (the full name, hidden, keeps the row height).
  ok('CH1. the Chart label is the approved abbreviation (Interincisal angle -> U1-L1)', (await page.locator('.inspector table.chart tr.m-row[data-node="m53_Interincisal"] .abbr').first().innerText()) === 'U1-L1');
  const tabTops = await page.locator('.inspector .tabs [role="tab"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  ok('CH1. the three tabs (Landmarks, Measurements, Chart; no Steps) fit on one line', tabTops.length === 3 && new Set(tabTops).size === 1, JSON.stringify(tabTops));
  ok('CH1. no "Measurement" heading on the Chart tab', !(await page.locator('.inspector table.chart').innerText()).includes('Measurement'));
  const chk = await page.evaluate(() => { const ov = document.querySelector('.inspector .chart-overlay'); const g = [...ov.querySelectorAll('g.chart-row')];
    return { rows: g.length, withZ: g.filter((x) => x.getAttribute('data-z') !== '').length, greenOnZ: g.every((x) => (x.getAttribute('data-z') === '') === !x.querySelector('.norm-band')),
      dots: ov.querySelectorAll('.patient-dot').length, line: !!ov.querySelector('polyline.patient') }; });
  ok('CH2. one chart row per table row; rows with a z draw the green norm and a black dot, rows without neither; one black line', chk.rows === mRows.length
    && chk.withZ > 1 && chk.greenOnZ && chk.dots === chk.withZ && chk.line, JSON.stringify(chk));
  const groups = await page.locator('.inspector .chart-overlay polyline.patient').evaluateAll((els) => els.map((e) => e.getAttribute('data-group')));
  ok('CH2. one black line per analysis (M-8)', groups.length >= 1 && new Set(groups).size === groups.length, JSON.stringify(groups));
  // Review M-9: a dot sits where its z says: middle of the Result+Mean cells, plus z sixths of the width (±3 SD).
  const dotFit = await page.evaluate(() => { const box = document.querySelector('.inspector .measures-box').getBoundingClientRect();
    const g = document.querySelector('.inspector .chart-overlay g.chart-row[data-z]:not([data-z=""])'); const key = [...document.querySelectorAll('.inspector .chart-overlay g.chart-row')].indexOf(g);
    const tr = document.querySelectorAll('.inspector table.measures tbody tr.m-row')[key]; const a = tr.querySelector('td.m-value').getBoundingClientRect(), c = tr.querySelector('td.m-norm').getBoundingClientRect();
    const z = Number(g.getAttribute('data-z')), w = c.right - a.left - 8, x0 = a.left - box.left + 4;
    const want = x0 + w / 2 + Math.max(-3, Math.min(3, z)) * w / 6;
    const dot = [...document.querySelectorAll('.inspector .chart-overlay g[data-node="' + g.getAttribute('data-node') + '"] .patient-dot')][0];
    return { z, want, got: Number(dot.getAttribute('cx')) }; });
  ok('CH4. a dot sits where its z says (to 0.5 px)', Math.abs(dotFit.got - dotFit.want) < 0.5, JSON.stringify(dotFit));
  const dotX = () => page.locator('.inspector .chart-overlay g[data-node="m01_SNA"] .patient-dot').first().evaluate((e) => e.getBoundingClientRect().x);
  const dx0 = await dotX(); await dragPt('A', 40, 0); await page.waitForTimeout(400); const dx1 = await dotX();
  ok('CH3. moving a point on the film moves its row\'s dot straight away (positive control: it moved)', Math.abs(dx1 - dx0) > 1, `${dx0} -> ${dx1}`);
  await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(300);
  await page.getByRole('tab', { name: 'Measurements' }).click(); await page.waitForTimeout(100);

  // Smoke 2 (ruling, decision 5): on the read-only Superimposition page, "calibrate to show" must
  // either work or not be offered. The toolbar's own Calibrate button is already disabled there
  // (Toolbar.tsx: `edit = canEdit && page === 'tracing'`); tested here while the film is still uncalibrated, so an
  // offered link would be provably clickable if it were one.
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('2. the read-only Superimposition page still shows SNA’s norm', /±/.test(await row('SNA').locator('td.m-norm').innerText()));
  const supCell = row('Pog to NB').locator('td.m-value');
  ok('2. "calibrate to show" is plain text there, not a working link (0 buttons)', (await supCell.locator('button').count()) === 0 && (await supCell.innerText()) === 'calibrate to show');
  ok('2. the toolbar’s own Calibrate button is disabled on this page too (consistent)', await page.locator('.toolbar button', { hasText: 'Calibrate' }).isDisabled());
  // Fix round 1 (Minor 3): by analogy with "calibrate to show", the read-only Superimposition page still NAMES
  // the points no model finds but never offers the "Place them" shortcut there (readOnly means no editing).
  const supMissing = page.locator('.missing-points');
  ok('2. the read-only Superimposition page still names the points no model finds', (await supMissing.innerText()).startsWith('Needs points no model finds:'));
  ok('2. but does not offer "Place them" there (0 buttons)', (await supMissing.getByRole('button', { name: 'Place them' }).count()) === 0);
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await page.getByRole('tab', { name: 'Measurements' }).click();

  // Back to Smoke 1: the link DOES work on the (editable) Tracing page.
  await row('Pog to NB').getByRole('button', { name: 'calibrate to show' }).click();
  ok('1. the link opens the ruler tool (Calibrate pressed)', (await page.locator('.toolbar button[aria-pressed="true"]', { hasText: 'Calibrate' }).count()) === 1);
  const st = await page.locator('.stage').boundingBox();
  await page.mouse.click(st.x + st.width * 0.3, st.y + st.height * 0.7);
  await page.mouse.click(st.x + st.width * 0.6, st.y + st.height * 0.7);
  await page.waitForSelector('.calibrate-dialog');
  await page.locator('.calibrate-dialog input').fill('20');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForSelector('.calibrate-dialog', { state: 'detached' });
  ok('1. after calibrating, Pog to NB shows its mm value', / mm$/.test(await row('Pog to NB').locator('td.m-value').innerText()));
  await page.screenshot({ path: `${__dirname}/out/partd-1-calibrated.png` });

  // Edge case: closed then reopened — the calibration (not an in-memory-only state)
  // is kept, so Pog to NB still shows its mm value without recalibrating.
  await reopen();
  ok('3. closed and reopened: the calibration is kept, Pog to NB still shows its mm value', / mm$/.test(await row('Pog to NB').locator('td.m-value').innerText()));

  // Smoke 3 — a measurement waiting on a hand-placed point (Part D task 7).
  ok('3. L1–NB (°) waits for L1A', (await row('L1–NB (°)').locator('td.m-value').innerText()).includes('L1A'));
  const missing = await page.locator('.missing-points').innerText();
  ok('3. the Measurements tab names the points no model finds', missing.startsWith('Needs points no model finds:') && missing.includes('L1A') && !missing.includes('U1A'), missing.slice(0, 120));
  await page.locator('.missing-points').getByRole('button', { name: 'Place them' }).click();
  ok('3. "Place them" opens Landmarks on the first such point (there is no Steps tab)', (await page.getByRole('tab', { name: 'Landmarks' }).getAttribute('aria-selected')) === 'true'
    && (await page.getByRole('tab', { name: 'Steps' }).count()) === 0
    && (await page.locator('.active-head b').innerText()) === 'L1A'
    && (await page.locator('.lm-list button[aria-current="true"] b').innerText()) === 'L1A');
  const st3 = await page.locator('.stage').boundingBox();
  await page.mouse.click(st3.x + st3.width * 0.62, st3.y + st3.height * 0.72);
  await page.getByRole('tab', { name: 'Measurements' }).click();
  // P19 (Task 12): the hand-placed L1A reaches the (fake) library before any later reload; without this wait a reload
  // could win the race with the autosave and smoke 5r would find L1A gone (seen once while building Task 12).
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.some((l) => l.id === 'L1A'));
  ok('3. once L1A is placed by hand, L1–NB (°) has a value', /\d+\.\d°/.test(await row('L1–NB (°)').locator('td.m-value').innerText()));

  // Smoke 4 (ruling T5-2, positive control): move the A landmark until SNA's z-score crosses 1 SD, then
  // 2 SD, and show the cell's colour class changes with it — without this, the colour wiring could be deleted
  // and every other check here would still pass (a hidden/no-norm cell has no band either way).
  // Steiner 1953 SNA: mean 82°, SD 4° (borrowed) — z = (value-82)/4. Moving A straight up (Shift+ArrowUp, 10 px
  // a press, image y decreases) increases the S-N-A angle; 16 presses -> ~86.6° (z~1.16, amber), 30 -> ~93.2°
  // (z~2.8, red). Found by probing the real geometry (not asserted blind): see task-5-report.md fix round 1.
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await page.locator('.lm-list button', { has: page.locator('b', { hasText: /^A$/ }) }).click();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  for (let i = 0; i < 16; i++) await page.keyboard.press('Shift+ArrowUp');
  const amberClass = await row('SNA').locator('td.m-value').getAttribute('class');
  ok('4. moving A pushes SNA past 1 SD: the cell turns amber', amberClass === 'm-value norm-amber', amberClass);
  for (let i = 0; i < 14; i++) await page.keyboard.press('Shift+ArrowUp');
  const redClass = await row('SNA').locator('td.m-value').getAttribute('class');
  ok('4. moving it further past 2 SD: the cell turns red', redClass === 'm-value norm-red', redClass);
  await page.screenshot({ path: `${__dirname}/out/partd-4-coloured.png` });

  // Smoke 2 — the analysis picker (all 15, automatic or partly, definitions readable). Placed here (not at the
  // very end, where the brief originally put it): Smoke 5 below closes the case, and this smoke needs one open
  // (the "Analyses…" button only shows then, App.tsx) — adapted position, same content.
  // Fix round 1 (review m4): Steiner's own SNA cell, read before the picker opens at all, so it can be compared
  // unchanged after ticking an unrelated analysis (NUS) below.
  const snaCell = () => row('SNA').locator('td.m-value');
  const snaBefore = { value: await snaCell().innerText(), cls: await snaCell().getAttribute('class') };
  await page.getByRole('button', { name: 'Analyses…' }).click();
  const win = page.getByRole('dialog', { name: 'Choose analyses' });
  ok('2. the picker lists all 15 analyses', (await win.locator('.analysis-row').count()) === 15);
  const steinerCoverage = await win.locator('.analysis-row', { hasText: 'Steiner' }).locator('.coverage').innerText();
  ok('2. Steiner is marked partly automatic for this film', steinerCoverage.startsWith('Partly automatic'));
  // Fix round 1 (review m3): the marking is LIVE, driven by the fake library's models_points table (U1A is found
  // by the extra model there, L1A is found by none) — not a static label. Proves Part B's table, not a guess, is
  // read.
  ok('2. live marking: U1A (found by the extra model) is NOT named as a hand point', !steinerCoverage.includes('U1A'), steinerCoverage);
  ok('2. live marking: L1A (no installed model finds it) IS named as a hand point', steinerCoverage.includes('L1A'), steinerCoverage);

  // Edge case: unticking the last analysis is refused. Untick Downs then McNamara (down to one, Steiner), then
  // try to untick Steiner too — it must stay ticked.
  const tickOf = (name) => win.locator('.analysis-row', { hasText: name }).getByRole('checkbox', { name: `Show ${name}` });
  await tickOf('Downs').uncheck();
  await tickOf('McNamara').uncheck();
  ok('2e. down to one ticked (Steiner) before the refusal check', await tickOf('Steiner').isChecked());
  await tickOf('Steiner').click({ force: true });
  ok('2e. unticking the last analysis is refused: Steiner stays ticked', await tickOf('Steiner').isChecked());
  await tickOf('Downs').check(); await tickOf('McNamara').check();   // restore today's three before Done

  await win.locator('.analysis-row', { hasText: 'Steiner' }).getByRole('button', { name: /Steiner/ }).click();
  await win.locator('.measure-row', { hasText: 'SNA' }).first().getByRole('button').click();
  const def = await win.locator('.definition').first().innerText();
  ok('2. SNA opens to its catalogue definition: words, points, source', def.includes('Angle at N between S and A') && def.includes('Sella') && def.includes('Steiner 1953'), def.slice(0, 120));
  await win.getByRole('checkbox', { name: 'Show NUS' }).check();
  await win.getByRole('button', { name: 'Done' }).click();
  ok('2. ticking NUS adds its rows to Measurements (U1–MxP)', (await row('U1–MxP').count()) === 1);
  ok('2. the choice is saved on this Mac', await page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('fakeLib')).settings.analyses_enabled).includes('nus')));
  // Fix round 1 (review m4): enabling another analysis (NUS) never moves a value or colour already shown by
  // another analysis (Steiner) — the registry stays the whole catalogue regardless of which analyses are ticked.
  const snaAfter = { value: await snaCell().innerText(), cls: await snaCell().getAttribute('class') };
  ok('2. ticking NUS leaves Steiner\'s own SNA value and colour unchanged', snaBefore.value === snaAfter.value && snaBefore.cls === snaAfter.cls, `${snaBefore.value}/${snaBefore.cls} -> ${snaAfter.value}/${snaAfter.cls}`);

  // Edge case: closed then reopened — the choice (not an in-memory-only state) is kept.
  await reopen();
  await page.getByRole('button', { name: 'Analyses…' }).click();
  const win2 = page.getByRole('dialog', { name: 'Choose analyses' });
  ok('2f. closed and reopened: NUS is still ticked in the picker', await win2.getByRole('checkbox', { name: 'Show NUS' }).isChecked());
  ok('2f. and its rows are still in Measurements (U1–MxP)', (await row('U1–MxP').count()) === 1);
  await win2.getByRole('button', { name: 'Done' }).click();

  // SEX-AVG-1 on screen. The SYNTHETIC patient is 16 with sex not recorded. Swedish norms (Thilander 2005) give SNA for
  // boys and girls aged 14–17 separately, with no row for both, so a Swedish case averages them (men ≠ women there;
  // Ricketts' E-line is NOT used here: his adult women's rows copy the men's, ruling P9). There is no population picker
  // until Task 11, so the clinic default is set in the fake library, the case reopened, and the default cleared again.
  const setDefault = (pop) => page.evaluate((pop) => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.settings.default_population = pop;
    localStorage.setItem('fakeLib', JSON.stringify(db)); }, pop);
  // Owner C1 (19 Oct): Steiner's SNA under its own norm is an ideal value with a borrowed SD — the source line still says
  // both (the report prints it), but neither shows as a tag on the row; hovering the source line explains both.
  const snaTags = await row('SNA').locator('td.m-norm .norm-badge').allInnerTexts();
  ok('C1. SNA (Steiner\'s own ideal, SD borrowed) shows no "ideal" or "SD borrowed" tag', !snaTags.includes('ideal') && !snaTags.includes('SD borrowed'), snaTags.join(', '));
  const snaSrcC1 = await srcText('SNA');
  ok('C1. its source line still says it', snaSrcC1.includes('ideal value (') && snaSrcC1.includes('SD borrowed from'), snaSrcC1);
  const snaTip = (await sourceLineOf('SNA').locator('td').getAttribute('title')) ?? '';
  ok('C1. hovering the source line explains both', snaTip.includes("The author's ideal value") && snaTip.includes('The paper printed no SD'), snaTip);
  await row('SNA').locator('td.m-label').click();   // close the source line again, as the checks below expect

  // Owner, addendum 2 J (19 Oct): the paper-scale tag "assumed scale" leaves the row; the hover says it is the PAPER's
  // X-rays, never the film's. Ricketts 1960's E-line rows (no population) carry 'scale-assumed'.
  await page.getByRole('button', { name: 'Analyses…' }).click();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('checkbox', { name: 'Show E-line' }).check();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('button', { name: 'Done' }).click();
  const uleTags = await row('Upper lip to E-line').locator('td.m-norm .norm-badge').allInnerTexts();
  ok('J. Upper lip to E-line shows no "assumed scale" tag', !uleTags.includes('assumed scale'), uleTags.join(', '));
  await srcText('Upper lip to E-line');
  const uleTip = (await sourceLineOf('Upper lip to E-line').locator('td').getAttribute('title')) ?? '';
  ok('J. its hover says the paper did not state its X-ray enlargement', uleTip.includes('The paper did not say whether its X-rays were enlarged'), uleTip);
  await row('Upper lip to E-line').locator('td.m-label').click();   // close the source line again
  await page.getByRole('button', { name: 'Analyses…' }).click();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('checkbox', { name: 'Show E-line' }).uncheck();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('button', { name: 'Done' }).click();

  ok('2s. control: before, SNA has no "average of male and female" badge (own norms)', (await row('SNA').locator('.norm-badge', { hasText: 'average of male and female' }).count()) === 0);
  await setDefault('swedish'); await reopen();
  ok('2s. sex not recorded, Swedish: SNA reads "average of male and female"', (await row('SNA').locator('.norm-badge', { hasText: 'average of male and female' }).count()) === 1);
  ok('2s. and the one-line hint shows above the table', (await page.locator('.sex-hint').innerText()) === 'Sex not recorded — record it for the exact norm.');
  await page.getByRole('radio', { name: 'Female' }).click();
  await page.waitForFunction(() => !document.querySelector('.sex-hint'));
  ok('2s. recording the sex removes the averaging and the hint (positive control)', (await row('SNA').locator('.norm-badge', { hasText: 'average of male and female' }).count()) === 0);
  await page.getByRole('radio', { name: 'N/A' }).click();
  await page.locator('.sex-hint').waitFor();
  await setDefault(null); await reopen();

  // Smoke 7 — a user norm entered and used (Part D task 10, brief step 5, verbatim; renumbered from the brief's
  // "4." — fix round 1, M8 — which collided with the unrelated Task 5 colour-positive-control checks above).
  const snaNormBefore = await row('SNA').locator('td.m-norm').innerText();
  await page.getByRole('button', { name: 'Settings…' }).click();
  const set = page.getByRole('dialog', { name: 'Settings' });
  await set.getByRole('tab', { name: 'Analyses' }).click();
  ok('7. Settings ▸ Analyses lists all 15', (await set.locator('.analysis-row').count()) === 15);
  await set.getByRole('tab', { name: 'Norms' }).click();
  // Edge case: no user norms yet (the seed starts with none) — the empty-state message, not a blank table.
  ok('10. no user norms yet: the empty-state message shows', (await set.locator('.hint', { hasText: 'No user norms yet.' }).count()) === 1);
  await set.getByLabel('Set name').fill('SYNTHETIC clinic');
  await set.getByLabel('Measurement').selectOption({ label: 'SNA' });
  await set.getByLabel('Mean').fill('70');
  await set.getByLabel('SD').fill('2');
  await set.getByLabel('Where it comes from').fill('SYNTHETIC sample');
  await set.getByRole('button', { name: 'Save norm' }).click();
  ok('7. the norm is listed under its set', (await set.locator('.user-norm-set', { hasText: 'SYNTHETIC clinic' }).locator('tr', { hasText: 'SNA' }).count()) === 1);
  await set.getByLabel('Clinic default population').selectOption({ label: 'SYNTHETIC clinic (your norms)' });
  await set.getByRole('button', { name: 'Close' }).click();
  const snaNorm = await row('SNA').locator('td.m-norm').innerText();
  ok('7. SNA now uses the user norm, labelled "user norm"', snaNorm.startsWith('70.0 ± 2.0°') && snaNorm.includes('user norm') && snaNorm !== snaNormBefore, `${snaNormBefore} → ${snaNorm}`);
  ok('7. and is coloured against it (red: far from 70)', (await row('SNA').locator('td.m-value').getAttribute('class')).includes('norm-red'));
  await page.getByRole('button', { name: 'Settings…' }).click();
  await set.getByRole('tab', { name: 'Norms' }).click();
  // P18: the form is new each time Settings opens, so fill every field and make SD the only fault.
  await set.getByLabel('Set name').fill('SYNTHETIC clinic');
  await set.getByLabel('Measurement').selectOption({ label: 'SNA' });
  await set.getByLabel('Mean').fill('70');
  await set.getByLabel('Where it comes from').fill('SYNTHETIC sample');
  await set.getByLabel('SD').fill('0'); await set.getByRole('button', { name: 'Save norm' }).click();
  ok('7. an SD of 0 is refused in words', (await set.locator('[role="alert"]').innerText()).includes('The SD must be more than 0'));

  // Ruling T10-1 (fix round 1, review I1): "clinic default cleared" must be able to fail — checked HERE, while
  // "SYNTHETIC clinic" still holds its SNA norm and is still the default, not after that norm is already gone
  // (the old, vacuous position — proven vacuous by the reviewer removing the clear and seeing 57/57 unchanged).
  await set.getByLabel('Clinic default population').selectOption('');
  await waitUntil(async () => !(await row('SNA').locator('td.m-norm').innerText()).includes('user norm'));
  const snaNormAfterClear = await row('SNA').locator('td.m-norm').innerText();
  const clinicSelVal = await set.getByLabel('Clinic default population').inputValue();
  ok('10. T10-1: clinic default cleared: SNA no longer reads "user norm"', !snaNormAfterClear.includes('user norm'), snaNormAfterClear);
  ok('10. T10-1: the select itself reads blank', clinicSelVal === '', clinicSelVal);
  // Owner decision 2 (29 Oct 2026): the unset default reads "Not set", and a hint says what Auto does with it.
  ok('10. the unset clinic default reads "Not set"', (await set.getByLabel('Clinic default population').locator('option:checked').innerText()) === 'Not set');
  ok('10. and the hint under it explains Auto', (await set.locator('p.hint', { hasText: "Auto uses: the patient's background, else this default, else for patients 18 and over (or with no age entered) a combined adult norm (every adult study, weighted by size, men and women separately) and for children the largest study for their sex and age." }).count()) === 1);
  ok('10. T10-1: and the store’s default_population is actually null', (await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings.default_population)) === null);

  // M9 (review): a failed settings write is shown on screen, not swallowed — forced via the stub's `forceFail`.
  // 'Swedish' is a real, already-used population (the SEX-AVG-1 checks above resolve against it), unaffected by
  // anything done to the user-norm sets, so it stays a valid target throughout.
  await forceFail('settings_default_population_set');
  await set.getByLabel('Clinic default population').selectOption({ label: 'Swedish' });
  await waitUntil(async () => (await set.locator('[role="alert"]').count()) > 0);
  ok('10. M9: a failed clinic-default write is shown on screen', (await set.locator('[role="alert"]').innerText()).includes('SYNTHETIC forced failure: settings_default_population_set'));
  await clearForceFail();

  // Edge cases, still in the same Settings ▸ Norms session; a failed save keeps
  // the draft (only a successful save resets it, P18 only promises a fresh draft on each OPEN), so each case below
  // starts from the previous one's (deliberately faulty) fields and fixes only what it is not testing.
  await set.getByLabel('Set name').fill('  ');
  await set.getByRole('button', { name: 'Save norm' }).click();
  ok('10. a blank set name is refused in words', (await set.locator('[role="alert"]').innerText()).includes('Name the set'));
  await set.getByLabel('Set name').fill('SYNTHETIC clinic');
  await set.getByLabel('Mean').fill('not a number');
  await set.getByRole('button', { name: 'Save norm' }).click();
  ok('10. a mean that is not a number is refused in words', (await set.locator('[role="alert"]').innerText()).includes('Type the mean as a number'));
  await set.getByLabel('Mean').fill('70');
  await set.getByLabel('SD').fill('2');
  await set.getByLabel('Where it comes from').fill('');
  await set.getByRole('button', { name: 'Save norm' }).click();
  ok('10. a blank source note is refused in words', (await set.locator('[role="alert"]').innerText()).includes('Say where the norm comes from'));

  // Ruling T10-3 (review I3): the editor shows the catalogue unit beside Mean/SD (SNA is still selected: deg, °).
  ok('10. T10-3: the editor shows the catalogue unit beside Mean/SD', (await set.locator('label', { hasText: 'Mean' }).innerText()).includes('°')
    && (await set.locator('label', { hasText: /^SD/ }).innerText()).includes('°'));
  // Ruling T10-3: a user norm passes the SAME plausibility check a published set does (PLAUSIBLE_BOUNDS/sdMax,
  // via the shared `plausibilityErrors` — not a new threshold), and a refused entry says why.
  await set.getByLabel('Where it comes from').fill('SYNTHETIC sample');
  await set.getByLabel('Mean').fill('300');
  await set.getByRole('button', { name: 'Save norm' }).click();
  ok('10. T10-3: a mean outside the plausible range for the unit is refused, saying why', (await set.locator('[role="alert"]').innerText()).includes('mean 300 is implausible for unit "deg"'));
  await set.getByLabel('Mean').fill('70');
  await set.getByLabel('SD').fill('25');
  await set.getByRole('button', { name: 'Save norm' }).click();
  ok('10. T10-3: an SD outside the plausible bound for the unit is refused, saying why', (await set.locator('[role="alert"]').innerText()).includes('sd 25 is implausible for unit "deg"'));
  await set.getByLabel('SD').fill('2');

  // Edge case: saving the same measurement twice in one set replaces the row, not adds a second one.
  await set.getByLabel('Mean').fill('71');
  await set.getByLabel('Where it comes from').fill('SYNTHETIC sample, revised n');
  await set.getByRole('button', { name: 'Save norm' }).click();
  const snaRows = set.locator('.user-norm-set', { hasText: 'SYNTHETIC clinic' }).locator('tr', { hasText: 'SNA' });
  ok('10. saving the same measurement twice in one set replaces the row, not adds another', (await snaRows.count()) === 1 && (await snaRows.innerText()).includes('71'));

  // Edge case: deleting the last row of a set removes the whole set, and the empty state returns.
  await set.locator('.user-norm-set', { hasText: 'SYNTHETIC clinic' }).getByRole('button', { name: 'Delete', exact: true }).click();
  ok('10. deleting the last row of a set removes the set from the list', (await set.locator('.user-norm-set', { hasText: 'SYNTHETIC clinic' }).count()) === 0);
  ok('10. no user norms yet, again: the empty-state message returns', (await set.locator('.hint', { hasText: 'No user norms yet.' }).count()) === 1);

  // Ruling T10-2 (review I2) + Minor M1: a new two-row set, made the clinic default, to prove both at once —
  // "asks first" is now EVIDENCED (the dialog call is recorded, naming the set) and a "No" reply keeps the set;
  // a "Yes" reply removes every row AND, because it was the clinic default, clears the default with a message.
  await set.getByLabel('Set name').fill('SYNTHETIC multi');
  await set.getByLabel('Measurement').selectOption({ label: 'SNA' });
  await set.getByLabel('Mean').fill('80'); await set.getByLabel('SD').fill('3'); await set.getByLabel('Where it comes from').fill('SYNTHETIC sample A');
  await set.getByRole('button', { name: 'Save norm' }).click();
  await set.getByLabel('Set name').fill('SYNTHETIC multi');
  await set.getByLabel('Measurement').selectOption({ label: 'SNB' });
  await set.getByLabel('Mean').fill('78'); await set.getByLabel('SD').fill('3'); await set.getByLabel('Where it comes from').fill('SYNTHETIC sample B');
  await set.getByRole('button', { name: 'Save norm' }).click();
  ok('10. the new set holds both rows before deleting it', (await set.locator('.user-norm-set', { hasText: 'SYNTHETIC multi' }).locator('tr').count()) === 2);
  await set.getByLabel('Clinic default population').selectOption({ label: 'SYNTHETIC multi (your norms)' });

  await setDialogReply('No'); await clearDialogCalls();
  await set.locator('.user-norm-set', { hasText: 'SYNTHETIC multi' }).getByRole('button', { name: 'Delete set…' }).click();
  const noCalls = await dialogCalls();
  ok('10. T10-2: deleting a whole set asks first (recorded, naming the set)', noCalls.length === 1 && noCalls[0][1].message.includes('SYNTHETIC multi'), JSON.stringify(noCalls));
  ok('10. T10-2: answering "No" keeps the set', (await set.locator('.user-norm-set', { hasText: 'SYNTHETIC multi' }).locator('tr').count()) === 2);

  await setDialogReply('Yes'); await clearDialogCalls();
  await set.locator('.user-norm-set', { hasText: 'SYNTHETIC multi' }).getByRole('button', { name: 'Delete set…' }).click();
  await set.locator('.user-norm-set', { hasText: 'SYNTHETIC multi' }).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await waitUntil(async () => (await set.locator('[role="status"]').count()) > 0);
  const yesCalls = await dialogCalls();
  ok('10. T10-2: answering "Yes", asked once, removes every row in it', yesCalls.length === 1 && (await set.locator('.user-norm-set', { hasText: 'SYNTHETIC multi' }).count()) === 0);
  const statusCount = await set.locator('[role="status"]').count();
  const statusText = statusCount > 0 ? await set.locator('[role="status"]').innerText() : '(none)';
  const defaultNow = await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings.default_population);
  ok('10. M1: deleting the clinic-default set clears the default, with a message', statusText.includes('it was the clinic default, so the default is now cleared') && defaultNow === null, `status=${statusCount}:${statusText} default_population=${defaultNow}`);
  ok('10. M1: the select reads blank again', (await set.getByLabel('Clinic default population').inputValue()) === '');

  // DEC-1 (12 Oct, Task 10's control): the decimals setting changes the Inspector immediately — no reopen needed —
  // and only the display, never the colour or the underlying value; it is saved on this Mac and read back.
  // Owner, addendum 2 I (19 Oct): the decimals setting is on the Norms page now — same setting, same stored value.
  await set.getByRole('tab', { name: 'Analyses' }).click();
  ok('10. I: the Analyses page no longer has the decimals setting', (await set.getByLabel('Decimals shown').count()) === 0);
  await set.getByRole('tab', { name: 'Norms' }).click();
  const decBefore = await row('SNA').locator('td.m-value').innerText();
  await set.getByLabel('Decimals shown').selectOption('0');
  const dec0 = await row('SNA').locator('td.m-value').innerText();
  ok('10. DEC-1: 0 decimals updates the Inspector immediately, without reopening the case', dec0 !== decBefore && !dec0.includes('.'), `${decBefore} → ${dec0}`);
  await set.getByLabel('Decimals shown').selectOption('3');
  const dec3 = await row('SNA').locator('td.m-value').innerText();
  ok('10. and 3 decimals shows three digits after the point', /\.\d{3}°$/.test(dec3), dec3);
  await set.getByLabel('Decimals shown').selectOption('2');
  const dec2 = await row('SNA').locator('td.m-value').innerText();
  const normDec2 = await row('SNA').locator('td.m-norm').innerText();
  // Final review M-5 (Task 10 M6): anchored, so 3 decimals on the norm text fails it (the old /\.\d{2}/ passed at 3).
  ok('10. 2 decimals shows two digits after the point, on the value and the norm text', /\.\d{2}°$/.test(dec2) && /^\S*\d\.\d{2} ± \d+\.\d{2}°/.test(normDec2), `${dec2} / ${normDec2}`);
  await set.getByRole('button', { name: 'Close' }).click();
  await reopen();
  ok('10. the decimals setting is saved and read back after reopening', (await row('SNA').locator('td.m-value').innerText()) === dec2);
  ok('10. I: the stored value is the same setting as before (display_decimals = "2")',
    await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings.display_decimals === '2'));

  // Smoke 6 (Part D task 9): the landmark list shows each point's definition, source and which models find it;
  // measurements using an AI point not yet accepted are marked (owner, 19 Oct, superseding the 7 Oct rule — see
  // The seed has Pt AI-placed, unverified; the models stub scores it "notScored" (via the
  // Extra model), so Ricketts' facial axis (Pt to constructed gnathion) reads "Uses AI points not yet accepted:
  // Pt" once Ricketts is enabled.
  await page.getByRole('button', { name: 'Analyses…' }).click();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('checkbox', { name: 'Show Ricketts' }).check();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('button', { name: 'Done' }).click();
  // Owner, 16 Oct (F): just a small "AI" at the row's right end; hovering it names the points. No line under the label.
  const fax = row('Facial axis, Ricketts');
  ok('6. Ricketts facial axis carries a small "AI" tag that names Pt on hover', (await fax.locator('.ai-tag').innerText()) === 'AI'
    && (await fax.locator('.ai-tag').getAttribute('title')).includes('Pt'), String(await fax.locator('.ai-tag').getAttribute('title')));
  ok('6. F: no "Uses AI points not yet accepted" line under the label', (await fax.locator('.unconfirmed').count()) === 0 && !(await fax.innerText()).includes('not yet accepted'));
  ok('6. F: the AI tag sits at the right of the row', (await fax.locator('td').last().locator('.ai-tag').count()) === 1);
  // Owner, 16 Oct: on the same line as the measurement, value and norm, so the row is no taller than a plain one.
  // Task 7 (C1): SNA itself carried 'ideal' and 'sd-borrowed' badges that wrapped its row before this plan — now
  // hidden, SNA is genuinely one line, shorter than it was, so it is no longer a safe height reference. U1–SN (NUS)
  // carries no badges either before or after Task 7 (a plain sample row, untouched), so it stays the fair comparator.
  const plainH = (await row('U1–SN').boundingBox()).height, faxH = (await fax.boundingBox()).height;
  ok('6. F: a row with the AI tag is no taller than a plain row', faxH <= plainH + 1, `${faxH} vs ${plainH}`);
  // Review M-6: compared with a fresh .warn element and with plain text, so a tag that lost its colour fails.
  ok('6. F: the tag is red, like the other warning text (and not the plain text colour)', await fax.locator('.ai-tag').evaluate((el) => {
    const ref = document.createElement('span'); ref.className = 'warn'; document.body.appendChild(ref);
    const plain = document.createElement('span'); document.body.appendChild(plain);
    const ok = getComputedStyle(el).color === getComputedStyle(ref).color && getComputedStyle(el).color !== getComputedStyle(plain).color;
    ref.remove(); plain.remove(); return ok; }));
  await fax.locator('.ai-tag').click(); await page.waitForTimeout(150);
  ok('6. F: clicking AI selects the point not yet accepted to check it (Pt), staying on Measurements', (await page.locator('.active-head b').innerText()) === 'Pt'
    && (await page.getByRole('tab', { name: 'Measurements' }).getAttribute('aria-selected')) === 'true');
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await page.locator('.lm-list button').filter({ has: page.locator('b', { hasText: /^S$/ }) }).click();
  const about = await page.locator('.point-about').innerText();
  ok('6. the active point shows its catalogue definition and who finds it', about.includes('Geometric centre of the pituitary fossa') && about.includes('Main: one of its original points'), about.slice(0, 160));
  await page.getByRole('tab', { name: 'Measurements' }).click();

  // Smoke 11 (Part D task 11, master plan §9): the case's own "Reference population" picker (case header,
  // ruling P26: CasePanel's Patient section) and "Compare populations…". Edge case: the clinic default (N6/Task 10's
  // own field — no picker reached it until now) set directly in the fake library, the case reopened, the picker
  // shows which it is.
  await setDefault('chinese'); await reopen();
  const pop = page.getByLabel('Reference population');
  ok('11. the case starts on the clinic default, saying which', (await pop.locator('option:checked').innerText()) === 'Clinic default (Chinese)');

  // Edge case: a user-norm set (schema 9, Task 4/10) chosen as the case population.
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.userNorms = [{ setName: 'SYNTHETIC own', measurement: 'm01_SNA', mean: 75, sd: 3, sourceNote: 'SYNTHETIC sample' }];
    localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await reopen();
  // `waitUntil` (not `waitForFunction` on the fake-library store): `setCasePopulation` writes the backend
  // synchronously but the screen only follows once the IPC promise resolves and React re-renders — polling the
  // store alone races that and can read the OLD norm still showing (caught running this smoke: it showed the
  // clinic default's Chinese citation a tick before the user-norm source line took over).
  await pop.selectOption({ label: 'SYNTHETIC own (your norms)' });
  await waitUntil(async () => (await srcText('SNA')).includes('your norm'));
  const snaUser = await srcText('SNA');
  ok('11. a user-norm set chosen as the case population is used for SNA', snaUser.includes('your norm'), snaUser);
  ok('11. and the store actually holds the user-population id', await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.population) === 'user:SYNTHETIC own');

  // Choosing a built-in population changes the source line to that population's own set.
  await pop.selectOption({ label: 'Chinese' });
  await waitUntil(async () => !(await srcText('SNA')).includes('your norm'));
  const snaChinese = await srcText('SNA');
  ok('11. choosing Chinese changes the source line to a Chinese set', /Chinese/.test(snaChinese), snaChinese.slice(0, 120));

  // Owner decision 3 (29 Oct 2026; spec §4.4): once a population is chosen by hand, the old "Clinic default" entry is
  // gone (it is offered only while a case holds it); the way back from a hand choice is Auto, first in the list.
  ok('11. a hand-chosen case no longer offers the old "Clinic default" entry', !(await pop.locator('option').allInnerTexts()).some((l) => l.startsWith('Clinic default')));
  await pop.selectOption('auto');
  await waitUntil(async () => (await pop.inputValue()) === 'auto');
  ok('11. back to Auto: the select reads it, saying it uses the clinic default (Chinese)', (await pop.locator('option:checked').innerText()) === 'Auto — Chinese (clinic default)');
  ok('11. and the store’s case population is actually auto', await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.population) === 'auto');

  // Edge case: the read-only Superimposition page — the picker is disabled, so that page can never change the
  // case's population (by analogy with "calibrate to show", decision 5, and the Analyses/Norms Settings reached
  // from there too).
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  ok('11. the read-only Superimposition page disables the population picker', await page.getByLabel('Reference population').isDisabled());
  await page.getByRole('button', { name: '‹ Tracing' }).click();

  // Edge case: closed and reopened — the choice is kept (a saved case field, not in-memory-only state).
  await pop.selectOption({ label: 'Chinese' });
  await reopen();
  ok('11. closed and reopened: the population choice is kept', (await page.getByLabel('Reference population').inputValue()) === 'chinese');

  // Fix round 1, ruling T11-4: a case whose population names a user-norm set that gets deleted is
  // treated as having none — the clinic default — in BOTH the resolver query and the picker, and the picker
  // says so in words. Clinic default is still "chinese" (set at the top of this block, never cleared).
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.userNorms = [...db.userNorms, { setName: 'SYNTHETIC Deleteme', measurement: 'm01_SNA', mean: 60, sd: 2, sourceNote: 'SYNTHETIC sample' }];
    localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await reopen();
  await page.getByLabel('Reference population').selectOption({ label: 'SYNTHETIC Deleteme (your norms)' });
  await waitUntil(async () => (await srcText('SNA')).includes('your norm'));
  ok('11. T11-4: set up — the case is set to a user population before it is deleted', (await srcText('SNA')).includes('your norm'));
  await page.getByRole('button', { name: 'Settings…' }).click();
  await set.getByRole('tab', { name: 'Norms' }).click();
  await setDialogReply('Yes'); await clearDialogCalls();
  await set.locator('.user-norm-set', { hasText: 'SYNTHETIC Deleteme' }).getByRole('button', { name: 'Delete set…' }).click();
  await set.locator('.user-norm-set', { hasText: 'SYNTHETIC Deleteme' }).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
  await set.getByRole('button', { name: 'Close' }).click();
  await waitUntil(async () => (await page.locator('.hint.warn', { hasText: 'chosen set deleted' }).count()) > 0);
  ok('11. T11-4: the picker says the chosen set was deleted, using the clinic default',
    (await page.locator('.hint.warn', { hasText: 'chosen set deleted — using clinic default' }).count()) === 1);
  ok('11. T11-4: the select itself falls back to the clinic default option', (await page.getByLabel('Reference population').inputValue()) === '');
  const snaAfterDelete = await srcText('SNA');
  ok('11. T11-4: and the resolver falls back too — SNA reads the clinic default\'s Chinese source, not "your norm"',
    /Chinese/.test(snaAfterDelete) && !snaAfterDelete.includes('your norm'), snaAfterDelete.slice(0, 120));

  // Smoke 11b (owner decisions 1-3, 29 Oct 2026; spec 2026-10-29 §4.1, §4.4): the Background select and Auto first in
  // the chooser. c1 is put on Auto here and restored afterwards; the clinic default is still Chinese.
  const keep11b = await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('fakeLib')).cases.c1; return { population: c.population, background: c.background ?? null }; });
  const setC1 = (o) => page.evaluate((o) => { const db = JSON.parse(localStorage.getItem('fakeLib')); Object.assign(db.cases.c1, o); localStorage.setItem('fakeLib', JSON.stringify(db)); }, o);
  await setC1({ population: 'auto', background: null, switchLogged: false, switchedFromClinicDefault: false }); await reopen();
  const pop11 = page.getByLabel('Reference population'), bg11 = page.getByLabel("Patient's background", { exact: true });
  const optLabels = async () => pop11.locator('option').allInnerTexts();
  ok('11b. a case on Auto: Auto is first and selected, saying it chose the clinic default (Chinese)',
    (await pop11.inputValue()) === 'auto' && (await optLabels())[0] === 'Auto — Chinese (clinic default)', (await optLabels()).slice(0, 2).join(' | '));
  ok('11b. a case on Auto offers no "Clinic default" entry', !(await optLabels()).some((l) => l.startsWith('Clinic default')), (await optLabels()).slice(0, 3).join(' | '));
  ok('11b. Background reads Not recorded, with Other or mixed last', (await bg11.locator('option:checked').innerText()) === 'Not recorded'
    && (await bg11.locator('option').allInnerTexts()).slice(-1)[0] === 'Other or mixed');
  await bg11.selectOption({ label: 'Malay' });
  // Owner answer B, 7 Nov 2026: a Malay patient uses the Malay studies (Chinese only where they have no row).
  const malayAuto = "Auto — Malay (patient's background)";
  await waitUntil(async () => (await optLabels())[0] === malayAuto);
  ok(`11b. choosing Background Malay: Auto follows it — "${malayAuto}"`, (await optLabels())[0] === malayAuto, (await optLabels())[0]);
  ok('11b. and the store holds the background on the case\'s patient', await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.background) === 'malay');
  await waitUntil(async () => /Malay/.test(await srcText('SNA')));
  ok('11b. and SNA is graded against the Malay norm (a Malay study has SNA)', /Malay/.test(await srcText('SNA')) && !/population rule|norms used/.test(await srcText('SNA')), (await srcText('SNA')).slice(0, 160));
  await reopen();
  ok('11b. closed and reopened: Background and Auto are kept', (await bg11.inputValue()) === 'malay' && (await pop11.inputValue()) === 'auto');
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  ok('11b. read-only (Superimposition): both selects are disabled', (await page.getByLabel("Patient's background", { exact: true }).isDisabled()) && (await page.getByLabel('Reference population').isDisabled()));
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  // A case still on the old "Clinic default" (NULL): the entry is there and selected; after choosing Auto it is gone.
  await setC1({ population: null, background: null }); await reopen();
  ok('11b. a case on "Clinic default": Auto first, then "Clinic default (Chinese)", selected', (await optLabels())[1] === 'Clinic default (Chinese)'
    && (await pop11.locator('option:checked').innerText()) === 'Clinic default (Chinese)', (await optLabels()).slice(0, 2).join(' | '));
  await pop11.selectOption('auto');
  await waitUntil(async () => (await pop11.inputValue()) === 'auto');
  ok('11b. after choosing Auto, the old "Clinic default" entry is gone', !(await optLabels()).some((l) => l.startsWith('Clinic default')), (await optLabels()).slice(0, 3).join(' | '));
  // Smoke 11c (owner NAP-Q3 (b), spec §4.8): a case the upgrade switched offers "Clinic default (as before the
  // upgrade)" directly under Auto; choosing it puts the case back on "Clinic default (Chinese)"; Auto again offers the
  // undo again.
  await setC1({ population: 'auto', switchLogged: true, switchedFromClinicDefault: true }); await reopen();
  ok('11c. a switched case: the undo is second, under Auto', (await optLabels())[1] === 'Clinic default (as before the upgrade)', (await optLabels()).slice(0, 2).join(' | '));
  await pop11.selectOption({ label: 'Clinic default (as before the upgrade)' });
  await waitUntil(async () => (await pop11.locator('option:checked').innerText()) === 'Clinic default (Chinese)');
  ok('11c. choosing it puts the case back on "Clinic default (Chinese)"', (await pop11.locator('option:checked').innerText()) === 'Clinic default (Chinese)'
    && await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.population) === null);
  await pop11.selectOption('auto');
  await waitUntil(async () => (await optLabels())[1] === 'Clinic default (as before the upgrade)');
  ok('11c. Auto again: the undo is offered again', (await optLabels())[1] === 'Clinic default (as before the upgrade)', (await optLabels()).slice(0, 2).join(' | '));
  await setC1({ population: keep11b.population, background: keep11b.background, switchLogged: false, switchedFromClinicDefault: false }); await reopen();

  // "Compare populations…" (master plan §9: 2–4 side by side). Edge case: 1 ticked asks for 2 to 4.
  await page.getByRole('button', { name: 'Compare populations…' }).click();
  const cmp = page.getByRole('dialog', { name: 'Compare populations' });
  // exact: a name match is a substring match, so pin the one tick-box (7 Nov 2026: the list's labels changed).
  await cmp.getByRole('checkbox', { name: 'Chinese', exact: true }).check();
  ok('11. 1 ticked: asks for 2 to 4 populations', (await cmp.locator('.hint', { hasText: 'Tick 2 to 4 populations to compare.' }).count()) === 1);
  await cmp.getByRole('checkbox', { name: /^Caucasian/ }).check();
  ok('11. two populations side by side', (await cmp.locator('thead th.pop').count()) === 2);
  // Edge case: a 5th tick is refused in words, and stays unticked — still 4 side by side, not 5. The 5th click
  // uses `.click()`, not `.check()`: `.check()` asserts the box ENDS UP checked, which is exactly what the
  // refusal must NOT do, so it would fail this smoke for the right behaviour and the wrong reason.
  await cmp.getByRole('checkbox', { name: 'Malay' }).check();
  await cmp.getByRole('checkbox', { name: 'Saudi' }).check();
  const swedish = cmp.getByRole('checkbox', { name: 'Swedish' });
  await swedish.click();
  ok('11. 5 ticked is refused, in words', (await cmp.locator('[role="alert"]', { hasText: 'Compare 2 to 4 populations.' }).count()) === 1);
  ok('11. and the 5th stays unticked', !(await swedish.isChecked()));
  ok('11. still 4 side by side, not 5', (await cmp.locator('thead th.pop').count()) === 4);
  await cmp.getByRole('button', { name: 'Close' }).click();

  // Edge case: a population with no norm for a row reads "—" (ruling AUTO-Q7 — the same mark as any other
  // population with none of its own, never the analysis's own fallback) — Björk–Jarabak's "Cranial base to body"
  // (m43_SNtoGoMe) has no norm anywhere, own or population, pinned by
  // packages/analyses/src/norms/coverage.test.ts's PINNED_NOTHING.
  await page.getByRole('button', { name: 'Analyses…' }).click();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('checkbox', { name: 'Show Björk–Jarabak' }).check();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('button', { name: 'Done' }).click();
  // Proof the new analysis actually reached the Measurements tab's own rows before trusting the Compare dialog
  // sees it too.
  await row('Cranial base to body').waitFor();
  await page.getByRole('button', { name: 'Compare populations…' }).click();
  // `.filter({ hasText })` on the row locator, not `{ has: cmp.locator('td.m-label', { hasText }) }`: the latter
  // timed out finding this row even though the label text was confirmed present in the table (debugged running
  // this smoke). Fix round 1, M3: the cause is not pinned down — only the observation that one combinator timed
  // out on this ~75-row table and the other found the row first try. Not claimed as a row-count threshold.
  const noNormRow = cmp.locator('.compare-table tbody tr').filter({ hasText: 'Cranial base to body' }).first();
  await noNormRow.waitFor();
  ok('11. AUTO-Q7: a population with no norm for a row reads "—"', (await noNormRow.locator('td.pop-value').first().innerText()) === '—');
  await cmp.getByRole('button', { name: 'Close' }).click();

  // Edge case (N5): a hidden mm value is never coloured in the comparison, and the patient column reads
  // "calibrate to show" there too. The film was calibrated at Smoke 1; dropped here the same way `setDefault`
  // plants a fact directly in the fake library (there is no un-calibrate control in the app).
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases.c1.spacingMm = null; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await reopen();
  await page.getByRole('button', { name: 'Compare populations…' }).click();
  const pogRow = cmp.locator('.compare-table tbody tr').filter({ hasText: 'Pog to NB' }).first();
  ok('11. a hidden mm value reads "calibrate to show" in the comparison too', (await pogRow.locator('td.m-value').innerText()) === 'calibrate to show');
  ok('11. and its population cells are never coloured', (await pogRow.locator('td.pop-value.norm-amber, td.pop-value.norm-red').count()) === 0);
  await cmp.getByRole('button', { name: 'Close' }).click();

  // Fix round 1, ruling T11-1: every compare cell shows its badges and hint visibly, and a cell
  // whose ticked population has no entry of its own says so IN THE CELL (never a silent fallback under a
  // population heading it is not from). The patient's sex is unrecorded (N/A, set in the "2s" block above) and
  // the four ticks persisted from the 5-ticked-refusal check above are chinese/caucasian/malay/saudi — Saudi has
  // no SNA entry of its own at this age (own-norm-fallback: Steiner's own norm shown instead), and Caucasian's
  // SNA needs sexes averaged (sexes-averaged, raising the sex-not-recorded hint) — both real, not planted.
  await page.getByRole('button', { name: 'Compare populations…' }).click();
  const snaCompareRow = cmp.locator('.compare-table tbody tr').filter({ hasText: 'SNA' }).first();
  // Ruling AUTO-Q7 (19 Oct): Saudi has no SNA of its own, so its column shows "—" — no value, no colour, no tag, no
  // button (never another population's value under the Saudi heading, nor "choose one").
  const heads11 = await cmp.locator('thead th').allInnerTexts();
  const saudiCell = snaCompareRow.locator('td.pop-value').nth(heads11.findIndex((t) => t === 'Saudi') - 2);
  ok('11. AUTO-Q7: a population with no SNA of its own shows "—"', heads11.includes('Saudi') && (await saudiCell.innerText()).trim() === '—', await saudiCell.innerText());
  ok('11. AUTO-Q7: uncoloured, no tag, no button', !/norm-(amber|red)/.test(await saudiCell.getAttribute('class'))
    && (await saudiCell.locator('.norm-badge').count()) === 0 && (await saudiCell.locator('button').count()) === 0);
  // `.filter({ hasText })`, not `{ has: … }` (M3: the same combinator that needed this change finding the
  // "Cranial base to body" row above).
  const caucasianCell = snaCompareRow.locator('td.pop-value').filter({ hasText: 'average of male and female' });
  ok('11. T11-1: a different population\'s own badge (average of male and female) shows too — not pooled across the row',
    (await caucasianCell.count()) === 1);
  ok('11. T11-1: the row\'s sex-not-recorded hint shows in the dialog, the same wording as the Inspector',
    (await snaCompareRow.locator('xpath=following-sibling::tr[1]').innerText()).trim() === 'Sex not recorded — record it for the exact norm.');
  // Minor M2 (review): the dialog follows DEC-1 (Task 10's decimals setting, left at 2 by that task's own last
  // check) — the first ticked population (Chinese, no borrow/ideal path) shows two digits after the point.
  ok('11. M2: the dialog follows the decimals setting (DEC-1)', /\.\d{2}°$/.test(await snaCompareRow.locator('td.pop-value').first().innerText()));
  // Final review I-2 (ruling): the compare window carries the "Uses AI points not yet accepted" mark, as the Measurements
  // tab does (smoke 6: Ricketts' facial axis uses Pt, AI-placed and not confirmed).
  const axisCompareRow = cmp.locator('.compare-table tbody tr').filter({ hasText: 'Facial axis, Ricketts' }).first();
  ok('11. I-2 / F: the compare window marks a measurement using an AI point not yet accepted with the same "AI" tag', (await axisCompareRow.locator('.ai-tag').innerText()) === 'AI'
    && (await axisCompareRow.locator('.ai-tag').getAttribute('title')).includes('Pt') && (await axisCompareRow.locator('.unconfirmed').count()) === 0);
  await cmp.getByRole('button', { name: 'Close' }).click();

  // Owner N-A3 and AUTO-Q6 (19 Oct, Auto), with NORM-PICK-1 kept for overriding: a case whose population has no norm for
  // a measurement is filled automatically — the analysis's own norm, else the best Caucasian sample, else the best study
  // anywhere — and its norm opens
  // the choice list; a pick is saved on the case and wins. Eastman's SN–MxP under Saudi: no Saudi paper has it; Eastman's
  // own norm does (Alassiry 2022, 8 ± 3°, quoted second-hand).
  await page.getByRole('button', { name: 'Analyses…' }).click();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('checkbox', { name: 'Show Eastman' }).check();
  await page.getByRole('dialog', { name: 'Choose analyses' }).getByRole('button', { name: 'Done' }).click();
  await page.getByLabel('Reference population').selectOption({ label: 'Saudi' });
  const mxp = () => row('SN–MxP');
  await waitUntil(async () => /±/.test(await mxp().locator('td.m-norm').innerText()));
  ok('12. N-A3: SN–MxP under Saudi shows Eastman\'s own norm (Auto), not "choose one"',
    /^8\.\d+ ± 3\.\d+°/.test((await mxp().locator('td.m-norm').innerText()).trim()) && !(await mxp().locator('td.m-norm').innerText()).includes('choose one'), await mxp().locator('td.m-norm').innerText());
  ok('12. N-A3: and graded against it (it has an SD)', ['neutral', 'amber', 'red'].includes(await mxp().locator('td.m-value').getAttribute('data-band')));
  ok('12. N-A5: no "Auto" tag on the row', (await mxp().locator('td.m-norm .norm-badge', { hasText: /^Auto$/ }).count()) === 0);
  ok('12. N-A3: its source line names Auto and the population that had none', (await srcText('SN–MxP')).includes('Auto (no Saudi norm)'));
  await mxp().locator('td.m-norm button.norm-choose').click();
  const chooser = page.locator('.inspector .norm-chooser');
  const choiceTexts = await chooser.locator('.norm-choice').allInnerTexts();
  ok('12. N-A2: clicking the norm lists Auto first, then every source, each with its value, n and ages',
    choiceTexts.length >= 2 && choiceTexts[0].includes("Auto · Eastman's own norm (no Saudi norm)") && choiceTexts.every((t) => /n (=|not stated)/.test(t)), choiceTexts.join(' | '));
  await chooser.locator('.norm-choice').nth(1).getByRole('button').click();
  await waitUntil(async () => (await mxp().locator('td.m-norm').innerText()).includes('chosen by you'));
  ok('12. the picked source is used, labelled "chosen by you"', (await mxp().locator('td.m-norm').innerText()).includes('chosen by you'), await mxp().locator('td.m-norm').innerText());
  ok('12. and coloured against it (it has an SD)', ['neutral', 'amber', 'red'].includes(await mxp().locator('td.m-value').getAttribute('data-band')));
  ok('12. the pick is saved on the case', await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('fakeLib')).settings['norm_picks:c1']; return !!v && !!JSON.parse(v).saudi?.m26_SNMxP; }));
  await reopen();
  ok('12. closed and reopened: still "chosen by you"', (await row('SN–MxP').locator('td.m-norm').innerText()).includes('chosen by you'));
  await page.getByRole('button', { name: 'Compare populations…' }).click();
  const mxpCompare = cmp.locator('.compare-table tbody tr').filter({ hasText: 'SN–MxP' }).first();
  const saudiIdx = (await cmp.locator('thead th').allInnerTexts()).findIndex((t) => t === 'Saudi') - 2;
  ok('12. AUTO-Q7: the compare window\'s Saudi column shows "—" — the pick is used on the Measurements tab only',
    saudiIdx >= 0 && (await mxpCompare.locator('td.pop-value').nth(saudiIdx).innerText()).trim() === '—');
  await cmp.getByRole('button', { name: 'Close' }).click();
  // N-A3: Steiner's SNA under Saudi (no Saudi SNA) → Steiner's own norm, Auto: graded, and on the Chart.
  await waitUntil(async () => /±/.test(await row('SNA').locator('td.m-norm').innerText()));
  const snaSrc12 = await srcText('SNA');
  ok('12. N-A3: Steiner SNA under Saudi shows Steiner\'s own norm (Auto), graded',
    snaSrc12.includes('Steiner 1953') && snaSrc12.includes('Auto (no Saudi norm)') && ['neutral', 'amber', 'red'].includes(await row('SNA').locator('td.m-value').getAttribute('data-band')), snaSrc12);
  await page.getByRole('tab', { name: 'Chart' }).click();
  ok('12. N-A3: the Auto row is on the Chart (it has a z)', ((await page.locator('.inspector .chart-overlay g.chart-row[data-node="m01_SNA"]').first().getAttribute('data-z')) ?? '') !== '');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  // Owner N-A2 (19 Oct): the row's norm list shows Auto first, marked ◆ and in use; another source chosen is stored and
  // wins ("chosen by you"); choosing Auto again removes the stored pick.
  await row('SNA').locator('td.m-norm button.norm-choose').click();
  const firstChoice = chooser.locator('.norm-choice').first();
  ok('12. N-A2: Auto is first, marked ◆, and in use', (await firstChoice.innerText()).startsWith('◆')
    && (await firstChoice.innerText()).includes("Auto · Steiner's own norm (no Saudi norm)") && (await firstChoice.getAttribute('aria-current')) === 'true', await firstChoice.innerText());
  ok('12. N-A2: exactly one source is marked in use', (await chooser.locator('.norm-choice[aria-current="true"]').count()) === 1);
  await chooser.locator('.norm-choice', { hasText: 'Chinese' }).first().getByRole('button').click();
  await waitUntil(async () => (await row('SNA').locator('td.m-norm').innerText()).includes('chosen by you'));
  const snaPick = () => page.evaluate(() => JSON.parse(JSON.parse(localStorage.getItem('fakeLib')).settings['norm_picks:c1'] ?? '{}').saudi?.m01_SNA ?? null);
  ok('12. N-A2: another source chosen is stored and wins ("chosen by you")', (await row('SNA').locator('td.m-norm').innerText()).includes('chosen by you') && (await snaPick()) === 'chinese');
  await row('SNA').locator('td.m-norm button.norm-choose').click();
  ok('12. N-A2: the stored source is now in use; Auto still first', (await chooser.locator('.norm-choice[aria-current="true"]').innerText()).includes('Chinese')
    && (await chooser.locator('.norm-choice').first().innerText()).startsWith('◆'));
  await chooser.locator('.norm-choice').first().getByRole('button').click();
  await waitUntil(async () => !(await row('SNA').locator('td.m-norm').innerText()).includes('chosen by you'));
  ok('12. N-A2: choosing Auto removes the stored pick; Auto is used again', (await snaPick()) === null && (await srcText('SNA')).includes('Auto (no Saudi norm)'));
  await reopen();
  ok('12. N-A2: closed and reopened, Auto still in use (no pick came back)', (await snaPick()) === null && (await srcText('SNA')).includes('Auto (no Saudi norm)'));
  // AUTO-Q6 step 4: neither Steiner's own norms nor any Caucasian paper has Pog to NB (only Chinese, Malay and
  // African-American papers): Auto takes the best study anywhere — for this 16-year-old, Zheng 2026's 10–17 y row.
  await waitUntil(async () => (await srcText('Pog to NB')).includes('Auto (no Saudi norm)'));
  const pogSrc = await srcText('Pog to NB');
  ok('12. AUTO-Q6: Pog to NB under Saudi takes the best study anywhere (Zheng 2026, Chinese), not "choose one"',
    pogSrc.includes('Zheng 2026') && pogSrc.includes('Auto (no Saudi norm)') && !(await row('Pog to NB').locator('td.m-norm').innerText()).includes('choose one'), pogSrc);
  await row('Pog to NB').locator('td.m-norm button.norm-choose').click();
  ok('12. AUTO-Q6: its list names the population used, first', (await chooser.locator('.norm-choice').first().innerText()).includes('Auto · Chinese — Zheng 2026'));
  await chooser.getByRole('button', { name: 'Cancel' }).click();
  // Edge case: the read-only Superimposition page offers no choosing — Auto rows are plain text there.
  await page.getByLabel('Reference population').selectOption({ label: 'Japanese' });
  await waitUntil(async () => (await srcText('SNA')).includes('Auto (no Japanese norm)'));
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  ok('12. read-only Superimposition: Auto rows (SNA, Pog to NB; Japanese) show their values, no button',
    (await row('SNA').locator('td.m-norm button').count()) === 0 && (await row('Pog to NB').locator('td.m-norm button').count()) === 0
    && /±/.test(await row('SNA').locator('td.m-norm').innerText())
    && /±/.test(await row('Pog to NB').locator('td.m-norm').innerText()));
  await page.getByRole('button', { name: '‹ Tracing' }).click();

  // Owner FILMDATE-1 (12 Oct): the date of birth entered, the film date missing → "film date missing — adult norms
  // assumed", not "age not entered". Edge cases: both missing still reads "age not entered"; restored after.
  await page.getByLabel('Reference population').selectOption({ label: 'Chinese' });
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases.c1.takenOn = null; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await reopen();
  const snaBadges = async () => (await row('SNA').locator('td.m-norm .norm-badge').allInnerTexts());
  ok('13. FILMDATE-1: date of birth entered, film date missing → "film date missing", not "age not entered"',
    (await snaBadges()).includes('film date missing') && !(await snaBadges()).includes('age not entered'), (await snaBadges()).join(', '));
  ok('13. and its words are the owner\'s', (await row('SNA').locator('.norm-badge', { hasText: 'film date missing' }).getAttribute('title')) === 'Film date missing — adult norms assumed. Enter the date the film was taken for the exact norm.');
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases.c1.dateOfBirth = null; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await reopen();
  ok('13. both missing: still "age not entered"', (await snaBadges()).includes('age not entered') && !(await snaBadges()).includes('film date missing'), (await snaBadges()).join(', '));
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases.c1.takenOn = '2026-01-10'; db.cases.c1.dateOfBirth = '2010-01-02'; localStorage.setItem('fakeLib', JSON.stringify(db)); });   // SYNTHETIC
  await reopen();
  ok('13. both entered again: neither', !(await snaBadges()).some((b) => b === 'film date missing' || b === 'age not entered'), (await snaBadges()).join(', '));

  // Smoke 5 (review Important 3, T5-3): "no case open" shown with real output, not just argued — back to the
  // library, no Inspector mounted at all, so there is no norm-column content to show.
  await page.locator('.toolbar button', { hasText: '‹ Library' }).click();
  await page.waitForSelector('.library');
  ok('5. no case open: the Inspector (and its norm column) is not even mounted', (await page.locator('.inspector').count()) === 0);

  // Smoke 5 set-up (Task 12). The checks above end with some choices undone on purpose: the N5 edge case dropped the
  // calibration, T11-4 deleted the case's user set (the case fell back to the clinic default), Task 10 deleted
  // "SYNTHETIC clinic" and left Chinese as the clinic default, and four populations are ticked to compare. They are
  // chosen again here through the screen, so every 5r check below reads a value that is NOT the default.
  await reopen();
  await row('Pog to NB').getByRole('button', { name: 'calibrate to show' }).click();
  const st5 = await page.locator('.stage').boundingBox();
  await page.mouse.click(st5.x + st5.width * 0.3, st5.y + st5.height * 0.7);
  await page.mouse.click(st5.x + st5.width * 0.6, st5.y + st5.height * 0.7);
  await page.waitForSelector('.calibrate-dialog');
  await page.locator('.calibrate-dialog input').fill('20');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForSelector('.calibrate-dialog', { state: 'detached' });
  await page.getByLabel('Reference population').selectOption({ label: 'Chinese' });
  await waitUntil(async () => (await page.getByLabel('Reference population').inputValue()) === 'chinese');
  await page.getByRole('button', { name: 'Settings…' }).click();
  await set.getByRole('tab', { name: 'Norms' }).click();
  await set.getByLabel('Set name').fill('SYNTHETIC clinic');
  await set.getByLabel('Measurement').selectOption({ label: 'SNA' });
  await set.getByLabel('Mean').fill('70');
  await set.getByLabel('SD').fill('2');
  await set.getByLabel('Where it comes from').fill('SYNTHETIC sample');
  await set.getByRole('button', { name: 'Save norm' }).click();
  await set.locator('.user-norm-set', { hasText: 'SYNTHETIC clinic' }).waitFor();
  await set.getByLabel('Clinic default population').selectOption({ label: 'SYNTHETIC clinic (your norms)' });
  await waitUntil(async () => (await set.getByLabel('Clinic default population').locator('option:checked').innerText()) === 'SYNTHETIC clinic (your norms)');
  await set.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Compare populations…' }).click();
  await cmp.getByRole('checkbox', { name: 'Malay' }).uncheck();
  await cmp.getByRole('checkbox', { name: 'Saudi' }).uncheck();
  const ticked5 = await cmp.locator('thead th.pop').count();
  await cmp.getByRole('button', { name: 'Close' }).click();
  ok('5 set-up. every choice is made again before quitting (mm shown, Chinese, the user set the clinic default, 2 ticked)',
    / mm$/.test(await row('Pog to NB').locator('td.m-value').innerText())
    && (await page.getByLabel('Reference population').locator('option:checked').innerText()) === 'Chinese'
    && await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); return d.userNorms.some((n) => n.setName === 'SYNTHETIC clinic'); })
    && ticked5 === 2, `ticked ${ticked5}`);

  // Smoke 5 — closed and reopened: everything chosen above survives quitting and reopening.
  // P19: wait until the hand-placed L1A has reached the (fake) library before quitting.
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.some((l) => l.id === 'L1A'));
  await page.reload(); await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await page.locator('.cards .card .open', { hasText: 'T1' }).first().click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('5r. the chosen analyses are kept (NUS and Ricketts rows still shown)', (await row('U1–MxP').count()) === 1 && (await row('Facial axis, Ricketts').count()) === 1);
  ok('5r. the calibration is kept (Pog to NB shows mm)', / mm$/.test(await row('Pog to NB').locator('td.m-value').innerText()));
  ok('5r. the case population is kept', (await page.getByLabel('Reference population').locator('option:checked').innerText()) === 'Chinese');
  ok('5r. L1A, placed by hand, is kept', (await page.locator('g.landmark[data-id="L1A"]').count()) === 1);
  await page.getByRole('button', { name: 'Settings…' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Norms' }).click();
  ok('5r. the user norm and the clinic default are kept', (await page.locator('.user-norm-set', { hasText: 'SYNTHETIC clinic' }).count()) === 1
    && (await page.getByLabel('Clinic default population').locator('option:checked').innerText()) === 'SYNTHETIC clinic (your norms)');
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Compare populations…' }).click();
  ok('5r. the compare choice is kept', (await page.getByRole('dialog', { name: 'Compare populations' }).locator('thead th.pop').count()) === 2);
  await page.getByRole('dialog', { name: 'Compare populations' }).getByRole('button', { name: 'Close' }).click();

  // Smoke 12 (owner NAP-Q3 (b), spec 2026-10-29 §4.8): the one-time note after the format-18 upgrade. Nothing seeded
  // so far: no note has shown during any check above.
  const note = page.getByRole('dialog', { name: 'Auto norms' });
  ok('12. no switched cases: no note', (await note.count()) === 0);
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.switchNote = 37; db.settings.default_population = 'caucasian'; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.reload(); await page.waitForSelector('.library');
  await note.waitFor({ timeout: 5000 }).catch(() => {});
  ok('12. 37 switched, clinic default Caucasian: the title', (await note.locator('h2').innerText().catch(() => '')) === 'Auto norms now choose the population for 37 older cases.');
  ok('12. and the first paragraph, in the spec\'s words', (await note.locator('p').first().innerText().catch(() => '')) === 'These cases were on "Clinic default". Auto uses the patient\'s recorded background, else your clinic default (Caucasian), else for adults a combined norm from every adult study in the app and for children the largest study for their sex and age. No background is recorded yet, so for now they are graded against Caucasian exactly as before; the only change in their reports is the words "chosen automatically: clinic default". Recording a background later can change their grades.');
  ok('12. it says saved PDFs are not changed, and how to go back for one case', (await note.locator('p').nth(1).innerText().catch(() => '')) === 'Reports you already saved as PDF are not changed.'
    && (await note.locator('p').nth(2).innerText().catch(() => '')).includes('"Clinic default (as before the upgrade)"'));
  await note.getByRole('button', { name: 'OK' }).click().catch(() => {});
  await waitUntil(async () => (await note.count()) === 0);
  ok('12. OK closes it, and the library is told', (await note.count()) === 0 && (await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).switchNote)) === null);
  await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(500);
  ok('12. reopened: not shown again', (await note.count()) === 0);

  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
