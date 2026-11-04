// Serial superimposition + left-panel sections smoke (spec 2026-09-30): the built UI in Chromium with a stubbed Tauri
// runtime and a fake library in localStorage. SYNTHETIC image, names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const lms = (dx) => Object.entries(base).map(([id,[x,y]]) => ({ id, x: x + 350 + (id === 'A' || id === 'Pog' ? dx : 0), y: y + 300, source: 'ai', verified: false, aiX: null, aiY: null, confidence: 0.8 }));
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const shot = (page, n) => page.screenshot({ path: `${__dirname}/out/ser-${n}.png` });
const film = (id, tp, takenOn, createdAt, dx, extra = {}) => ({ id, path: `/Users/demo/${id}.png`, patientName: 'Demo Series', patientKey: 'demo series', dateOfBirth: '2010-01-02',   // SYNTHETIC
  scanId: null, timepoint: tp, takenOn, takenOnSource: 'label', facing: 'right', orientation: {}, display: {}, spacingMm: null, verifiedAt: null, verifiedBy: null,
  landmarks: lms(dx), createdAt, updatedAt: createdAt, deletedAt: null, identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [],
  stage: null, inSeries: true,
  // Task 5 (D2): the real CaseDoc always carries these; a stub without them has the panel read undefined.
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [], ...extra });
const seed = { settings: {}, cases: {
  c1: film('c1', 'T3', '2026-01-10', '2026-09-30T01:00:00Z', 40),     // imported newest first
  c2: film('c2', 'T2', '2024-01-10', '2026-09-30T02:00:00Z', 20),
  c3: film('c3', 'T1', '2022-01-10', '2026-09-30T03:00:00Z', 0),
  c4: film('c4', 'T1', '2025-05-05', '2026-09-30T04:00:00Z', 0, { patientName: 'Demo Other', patientKey: 'demo other' }),
} };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        if (cmd === 'library_set_meta') (window.__metaCalls ||= []).push(structuredClone(a));
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'plugin:event|listen': return 1;
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map((c) => ({ id: c.id, patientName: c.patientName,
            timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation,
            landmarks: c.landmarks.length, unverified: c.landmarks.length, verifiedAt: null, deletedAt: c.deletedAt, patientKey: c.patientKey,
            dateOfBirth: c.dateOfBirth, identityChecked: true }));
          case 'library_open': { if ((db.failOpen || []).includes(a.caseId)) throw 'SYNTHETIC failure';
            const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, orientation: a.edit.orientation, display: a.edit.display });
            store(db); return { updatedAt: c.updatedAt, verifiedAt: null }; }
          case 'library_series': { const me = db.cases[a.caseId];
            return Object.values(db.cases).filter((c) => !c.deletedAt && (c.id === me.id || (!me.patientKey.startsWith('~') && c.patientKey === me.patientKey
              && (c.dateOfBirth === me.dateOfBirth || !c.dateOfBirth || !me.dateOfBirth))))
              .map((c) => ({ id: c.id, timepoint: c.timepoint, takenOn: c.takenOn, takenOnSource: c.takenOnSource, createdAt: c.createdAt, stage: c.stage, inSeries: c.inSeries,
                nameOnly: c.id !== me.id && (!c.dateOfBirth || !me.dateOfBirth) })); }
          case 'library_set_stage': db.cases[a.caseId].stage = a.stage; store(db); return null;
          case 'library_set_in_series': if (db.failSet) throw 'SYNTHETIC write failed'; db.cases[a.caseId].inSeries = a.on; store(db); return null;
          case 'library_label_text': return { lines: [], suggestions: [] };
          case 'settings_get': return db.settings[a.key] ?? null;
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png });

  const toLibrary = async () => { await page.getByRole('button', { name: '‹ Library' }).click(); await page.waitForSelector('.library'); };
  const openCase = async (tp) => { await page.locator('.cards .card .open', { hasText: tp }).first().click(); await page.waitForSelector('g.landmark[data-id="S"]'); };
  const swatch = (label) => page.locator('.series-key li', { hasText: label }).locator('.swatch').evaluate((e) => getComputedStyle(e).borderTopColor);
  const heads = async () => (await page.locator('.inspector table.measures thead th').allInnerTexts());
  const lastCol = async () => page.locator('.inspector table.measures tbody tr').evaluateAll((rs) => rs.map((r) => r.lastElementChild.textContent));
  // The Inspector shows the Change tab as soon as the comparison exists but switches to it in a useEffect, one render
  // later (~10 ms here) — after the overlay's compare outlines can already be drawn. Wait for the Change table itself
  // before reading it (2026-10-13: check 9 read the Landmarks tab mid-switch and got no headings;
  // the same race e2e4's changeShown fixed in 6f3ef67).
  const changeShown = () => page.waitForFunction(() =>
    [...document.querySelectorAll('.inspector table.measures thead th')].some((th) => th.textContent === 'Change'));

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();

  // Left panel sections on the tracing page.
  await openCase('T3');
  const secs = await page.locator('aside.sidebar section.panel-section').evaluateAll((s) => s.map((x) => x.getAttribute('aria-label')));
  ok('6. the tracing page has PATIENT, TEXT ON THE FILM, POINTS, ENHANCE, OVERLAYS sections in order', JSON.stringify(secs) === JSON.stringify(['Patient', 'Text on the film', 'Points', 'Enhance (display only)', 'Overlays']), secs.join(', '));
  ok('8. Mark tracing verified sits in POINTS', (await page.locator('section[aria-label="Points"]').getByRole('button', { name: 'Mark tracing verified' }).count()) === 1);
  const enh = page.locator('section[aria-label="Enhance (display only)"]');
  ok('7. Enhance is open by default', (await enh.getByText('Brightness').count()) === 1);
  await enh.locator('.section-head button.toggle').click();
  ok('7. its heading closes it', (await enh.getByText('Brightness').count()) === 0 && (await enh.locator('.section-head button.toggle').getAttribute('aria-expanded')) === 'false');
  await toLibrary();
  // Owner, 30 Sep: no flicker — watch from before the case opens that Enhance's sliders never appear.
  await page.evaluate(() => { window.__enhanceSeen = false;
    new MutationObserver(() => { if ([...document.querySelectorAll('section[aria-label="Enhance (display only)"] label')].some((l) => l.textContent.includes('Brightness'))) window.__enhanceSeen = true; })
      .observe(document.body, { childList: true, subtree: true }); });
  await openCase('T3'); await page.waitForTimeout(300);
  ok('7. it never flashes open while the case opens', (await page.evaluate(() => window.__enhanceSeen)) === false);
  ok('7. its heading shows in capitals like the others', (await page.locator('section[aria-label="Enhance (display only)"] .section-head button.toggle').evaluate((b) => getComputedStyle(b).textTransform)) === 'uppercase');
  ok('7. its toggle is inside a heading for screen readers', (await page.locator('section[aria-label="Enhance (display only)"] h2 button[aria-expanded]').count()) === 1);
  // Editing only the Timepoint sends the name and date of birth unchanged, so the library keeps "Check patient
  // details", the learned fields and the date source as they were (the library side is tested in ceph-store's layouts.rs).
  {
    const tp = page.locator('.case-panel label', { hasText: 'Timepoint' }).locator('input');
    const name0 = await page.locator('.case-panel label', { hasText: 'Patient' }).first().locator('input').inputValue();
    const tp0 = await tp.inputValue();
    await page.evaluate(() => { window.__metaCalls = []; });
    await tp.fill(tp0 + 'b'); await tp.blur(); await page.waitForTimeout(400);
    const calls = await page.evaluate(() => window.__metaCalls);
    const m = calls.length ? calls[calls.length - 1].meta : null;
    const dob0 = calls.length ? await page.evaluate((id) => JSON.parse(localStorage.getItem('fakeLib')).cases[id]?.dateOfBirth ?? null, calls[calls.length - 1].caseId) : 'none';
    ok('H29. a Timepoint-only edit saves the new timepoint and leaves the name and DOB exactly as they were', !!m && m.timepoint === tp0 + 'b'
      && m.patientName === name0 && (m.dateOfBirth ?? null) === dob0, JSON.stringify(calls).slice(0, 200));   // re-check: DOB too
    await tp.fill(tp0); await tp.blur(); await page.waitForTimeout(300);
  }
  ok('7. and it stays closed when a case is reopened', (await page.locator('section[aria-label="Enhance (display only)"]').getByText('Brightness').count()) === 0);
  await shot(page, '1-sections');

  // The series on the Superimposition page (T3 open; films imported newest first).
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.series-key li');
  await page.waitForFunction(() => document.querySelectorAll('svg.overlay g.compare').length === 2);
  await changeShown();
  const labels = await page.locator('.series-key .series-label').allInnerTexts();
  ok('1. the key lists T1, T2, T3 in date order', labels.length === 3 && labels[0].startsWith('T1 · 10/01/2022') && labels[1].startsWith('T2') && labels[2].startsWith('T3'), labels.join(' | '));
  const sw = [await swatch('T1'), await swatch('T2'), await swatch('T3')];
  ok('1. with ABO black, blue and red', JSON.stringify(sw) === JSON.stringify(['rgb(0, 0, 0)', 'rgb(0, 80, 179)', 'rgb(200, 16, 46)']), sw.join(' '));
  ok('1. T3 shows "Auto (Final)"', (await page.locator('.series-key li', { hasText: 'T3' }).locator('select option').first().innerText()) === 'Auto (Final)');
  const secs2 = await page.locator('aside.sidebar section.panel-section').evaluateAll((s) => s.map((x) => x.getAttribute('aria-label')));
  ok('6. the Superimposition page adds COMPARISON before OVERLAYS', JSON.stringify(secs2) === JSON.stringify(['Patient', 'Text on the film', 'Points', 'Enhance (display only)', 'Comparison', 'Overlays']), secs2.join(', '));
  const h = await heads();
  ok('2. the Change table has three value columns', h.length === 5 && h[1].startsWith('T1') && h[2].startsWith('T2') && h[3].startsWith('T3'), h.join(' | '));
  const pairSel = page.locator('select[aria-label="Change between"]');
  ok('2. and the pair reads T1 → T3', (await pairSel.locator('option:checked').innerText()) === 'T1 → T3');
  const before = await lastCol();
  await pairSel.selectOption({ label: 'T2 → T3' });
  const after = await lastCol();
  ok('3. choosing T2 → T3 changes the Change column', JSON.stringify(before) !== JSON.stringify(after), `${before.slice(0, 3)} vs ${after.slice(0, 3)}`);
  const snaRow = await page.locator('.inspector table.measures tbody tr', { hasText: 'SNA' }).first().evaluate((r) => [...r.children].map((c) => c.textContent));
  ok('3. change is later minus earlier (A moved forward over time → SNA +)', snaRow[snaRow.length - 1].startsWith('+'), snaRow.join(' | '));
  await shot(page, '2-series');
  await page.getByRole('checkbox', { name: /Show T2/ }).uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.inspector table.measures thead th').length === 4);
  ok('4. unticking T2 removes its column and outline', (await page.locator('svg.overlay g.compare[data-film="c2"]').count()) === 0
    && (await page.locator('svg.overlay g.compare[data-film="c3"]').count()) === 1);
  ok('4. and the pair falls back to T1 → T3', (await pairSel.locator('option:checked').innerText()) === 'T1 → T3');
  // Owner, 16 Oct: re-ticking a film brings its column and outline back.
  await page.getByRole('checkbox', { name: /Show T2/ }).check();
  await page.waitForFunction(() => document.querySelectorAll('.inspector table.measures thead th').length === 5);
  ok('H22. re-ticking T2 brings back its column and outline', (await page.locator('svg.overlay g.compare[data-film="c2"]').count()) === 1
    && (await page.getByRole('checkbox', { name: /Show T2/ }).isChecked()));
  await page.getByRole('checkbox', { name: /Show T2/ }).uncheck();
  await page.waitForFunction(() => document.querySelectorAll('.inspector table.measures thead th').length === 4);
  await page.locator('.series-key li', { hasText: 'T3' }).locator('select').selectOption('retention');
  await page.waitForFunction(() => getComputedStyle([...document.querySelectorAll('.series-key li')].find((l) => l.textContent.includes('T3')).querySelector('.swatch')).borderTopColor === 'rgb(26, 127, 55)');
  ok('5. setting T3 to Retention turns it green', (await swatch('T3')) === 'rgb(26, 127, 55)');
  await shot(page, '3-retention');

  // A film that can't be opened.
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.cases.c2.inSeries = true; db.failOpen = ['c2']; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.getByRole('button', { name: '‹ Tracing' }).click(); await toLibrary(); await openCase('T3');
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.series-key li');
  await page.waitForFunction(() => document.querySelectorAll('svg.overlay g.compare').length === 1);
  ok('9. a film that fails to open says so and the others still draw', (await page.locator('.series-key li', { hasText: 'T2' }).innerText()).includes('open this film')
    && (await page.locator('svg.overlay g.compare[data-film="c3"]').count()) === 1);
  await changeShown();
  const h9 = await heads();
  ok('9. and it takes no column, stage or pair (owner, 30 Sep)', h9.length === 4 && h9[1].startsWith('T1') && h9[2].startsWith('T3')
    && (await page.locator('.series-key li', { hasText: 'T3' }).locator('select option').first().innerText()) === 'Auto (Final)', h9.join(' | '));
  // Final review, important 1: a tick that can't be saved says so in the left panel, and the box shows what was saved.
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.failOpen = []; db.failSet = true; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.getByRole('checkbox', { name: /Show T1/ }).click();
  await page.waitForTimeout(400);
  const err = await page.locator('aside.sidebar .error').allInnerTexts();
  ok('11. a tick that fails to save shows the error in the left panel and stays ticked', err.some((e) => e.includes('SYNTHETIC write failed'))
    && (await page.getByRole('checkbox', { name: /Show T1/ }).isChecked()), err.join(' | '));
  // Final review, important 2: a film that joined on name alone is marked "(no DOB)".
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.failSet = false;
    db.cases.c5 = { ...db.cases.c3, id: 'c5', timepoint: 'T4', takenOn: '2026-06-10', dateOfBirth: null, createdAt: '2026-09-30T05:00:00Z' };
    localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.getByRole('button', { name: '‹ Tracing' }).click(); await toLibrary(); await openCase('T3');
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.series-key li:nth-child(4)');
  ok('12. a film that joined on name alone says "(no DOB)"', (await page.locator('.series-key li', { hasText: 'T4' }).innerText()).includes('(no DOB)')
    && !(await page.locator('.series-key li', { hasText: 'T1' }).innerText()).includes('(no DOB)'));
  // Another patient's film shows only its own series.
  await page.getByRole('button', { name: '‹ Tracing' }).click(); await toLibrary();
  await page.locator('.cards .card .open', { hasText: 'Demo Other' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.series-key li');
  ok('10. another patient\'s film has only itself, and no Change tab', (await page.locator('.series-key li').count()) === 1 && (await page.getByRole('tab', { name: 'Change' }).count()) === 0);

  // Owner, 30 Sep: an import day is shown as one; the Superimposition tooltip is current.
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  ok('13. the Superimposition button tooltip no longer promises Week 7', !(await page.getByRole('button', { name: 'Superimposition ›' }).getAttribute('title')).includes('Week 7'));
  // Task 11, owner ruling BUTTON (15 Oct 2026): the disabled Cross-check nav button says the flags are on hold and why,
  // in place of "Arrives with the cross-check"; the older "Model B" tool button keeps that title unchanged.
  const xcBtn = page.getByRole('button', { name: 'Cross-check ›' });
  const xcTitle = await xcBtn.getAttribute('title');
  ok('13b. the Cross-check button says its flags are on hold and when they return, with no "⌘"',
    xcTitle === 'On hold: model-disagreement flags could not catch enough errors. They return once your own trained model passes the cross-check test.'
    && !xcTitle.includes('⌘') && await xcBtn.isDisabled(), xcTitle || 'null');
  const modelBTitle = await page.getByRole('button', { name: 'Model B' }).getAttribute('title');
  ok('13c. the older "Model B" tool button keeps its own title (a different, older feature)', modelBTitle === 'Arrives with the cross-check', modelBTitle || 'null');
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); Object.assign(db.cases.c1, { takenOn: '2026-09-30', takenOnSource: 'import' }); localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await toLibrary(); await openCase('T3');
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.series-key li');
  ok('14. a film dated only by its import day says "imported"', (await page.locator('.series-key li', { hasText: 'T3' }).innerText()).includes('T3 · imported 30/09/2026'));
  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
