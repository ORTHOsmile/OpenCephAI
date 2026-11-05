// Library ▸ Table smoke (owner decisions, 29 Oct 2026): the Pictures/Table switch (remembered across a reload),
// the Table's columns and header sorting, the search bar filtering the Table the same way it filters Pictures, a
// row opening a film, and the PATIENTS sidebar list being gone. Follow-up round (owner, 29 Oct, item B as revised and
// item C): Grouped (one row per patient, collapsed, opened by click, Enter, Space and the arrow keys; a search opens
// the matching patients) and Flat, remembered; a header sort keeps each patient's films together; a film row opened by
// Space (review I1); the Report column and its click-through to the PDF export, recorded only after a written save.
// Built UI in Chromium, stubbed Tauri runtime, fake library kept in localStorage. SYNTHETIC image, names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S: [0, 0], N: [700, -100], A: [720, 300], B: [690, 650] };
const AB = 'auto-best';
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const lm = (id, dx, over = {}) => ({ id, x: base[id][0] + dx, y: base[id][1] + 300, source: 'ai', verified: false,
  aiX: base[id][0] + dx, aiY: base[id][1] + 300, confidence: 0.9, placedBy: 'srpose-cldet23', placedVia: AB, ...over });
// Every field a real CaseDoc carries (as e2e9/e2e20's `kase` helper), so a missing one never silently fails to load.
const kase = (id, patientName, patientKey, dob, gender, tp, takenOn, created, over = {}) => ({
  id, path: `/Users/demo/${id}.png`, patientName, patientKey, dateOfBirth: dob, scanId: null, timepoint: tp, takenOn,
  takenOnSource: 'label', facing: 'right', orientation: {}, display: {}, spacingMm: 0.1, scaleSteps: 0, fit: null, machine: null,
  machineScale: null, title: null, ageOnFilm: null, ageOnFilmYears: null, verifiedAt: null, verifiedBy: null,
  createdAt: created, updatedAt: created, deletedAt: null, identitySource: 'manual', identityChecked: true, identityIssues: [],
  learnedFields: [], stage: null, inSeries: true, gender, referringPractitioner: null, population: null,
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [], landmarks: [], ...over,
});
// Two SYNTHETIC patients: Alpha (never traced) and Beta, with two films imported with T2 BEFORE T1 so the Table's
// default grouping (patient together, oldest film first) cannot be mistaken for import or nav order.
const seed = { settings: {}, ops: ['Dr A'], cases: {
  c1: kase('c1', 'Synth Alpha', 'synth alpha', '2010-01-02', 'F', 'T1', '2026-01-10', '2026-09-30T01:00:00Z'),   // SYNTHETIC
  c3: kase('c3', 'Synth Beta', 'synth beta', '2011-03-04', 'M', 'T2', '2026-03-01', '2026-09-29T01:00:00Z', { landmarks: [lm('S', 400)] }),   // SYNTHETIC
  c2: kase('c2', 'Synth Beta', 'synth beta', '2011-03-04', 'M', 'T1', '2026-02-01', '2026-09-28T01:00:00Z',
    { verifiedAt: '2026-10-12T03:00:00.000Z', verifiedBy: 'Dr A', reportSavedAt: '2026-10-20T01:00:00.000Z', landmarks: [lm('S', 400, { verified: true })] }),   // SYNTHETIC
} };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png }) => {
    window.__written = [];
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}, opts = {}) => {
        const db = load();
        // ai_model_id, as crates/ceph-store/src/library.rs's list(): 'auto-best' if any landmark's placedVia is, else
        // the most common placedBy, else null — mirrored here so the stub matches the real backend's contract.
        const aiModelIdOf = (c) => {
          if (c.landmarks.some((l) => l.placedVia === 'auto-best')) return 'auto-best';
          const by = c.landmarks.map((l) => l.placedBy).filter(Boolean);
          return by.length ? by[0] : null;
        };
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'cwlachap-hrnet-w32', searched: [], error: null };
          case 'plugin:event|listen': return 1;
          case 'library_list': return Object.values(db.cases).map((c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn,
            createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation, landmarks: c.landmarks.length,
            unverified: c.landmarks.filter((l) => !l.verified).length, verifiedAt: c.verifiedAt, deletedAt: c.deletedAt,
            patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true, libraryId: null, formerLibraryIds: [], printedPatientId: null,
            gender: c.gender, aiModelId: aiModelIdOf(c), reportSavedAt: c.reportSavedAt ?? null }));
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_ghosts': return [];
          case 'models_list': return [{ id: 'cwlachap-hrnet-w32', title: 'HRNet-W32 (cwlachap)', status: 'ready', main: true, tier: 'standard',
            citation: 'SYNTHETIC', sizeMb: 1, licence: { version: '1', code: 'SYNTHETIC', weights: 'SYNTHETIC', summary: 'SYNTHETIC', url: '', nonCommercial: false },
            licenceAccepted: true, stage: null, error: null, msPerFilm: null, page: '' }];
          case 'library_label_text': return { lines: [], suggestions: [] };
          case 'operators_list': return { current: db.settings.operator ?? 'Dr A', names: db.ops };
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          // The report preview's needs (as e2e14).
          case 'models_points': return [];
          case 'system_font_list': return [];
          case 'library_user_norms': return [];
          case 'settings_default_population_get': return 'caucasian';
          case 'plugin:dialog|save': return window.__nextSave ?? null;
          case 'plugin:dialog|message': return 'Yes';
          // As src-tauri export.rs save_export: write first; only a written PDF named for a film records its date.
          case 'export_write': {
            if (window.__failWrite) throw new Error(window.__failWrite);
            const path = decodeURIComponent(opts.headers.path);
            window.__written.push(path);
            const film = opts.headers.case ? decodeURIComponent(opts.headers.case) : null;
            if (film && /\.pdf$/i.test(path) && db.cases[film]) { db.cases[film].reportSavedAt = new Date().toISOString(); store(db); }
            return null;
          }
          default: return null;
        }
      },
    };
  }, { png });

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');

  // 1. PATIENTS sidebar list is gone.
  const navText = await page.locator('.lib-nav').innerText();
  ok('1. the PATIENTS sidebar list is gone', !navText.includes('PATIENTS'));

  // 2. Pictures is the default; cards are shown.
  await page.locator('.cards').waitFor();
  ok('2. Pictures is the default view (cards shown)', await page.locator('.cards').isVisible());

  // 3. Switching to Table shows the table and its columns, in order (Report last, owner 29 Oct).
  await page.getByRole('radio', { name: 'Table' }).click();
  await page.locator('table.lib-table').waitFor();
  const heads = await page.locator('table.lib-table thead th button').allInnerTexts();
  ok('3. the Table has every column, in order', heads.join('|') === 'Name|DOB|Timepoint|Date of scan|M/F|Age|AI status|Report', heads.join('|'));

  const T = 'table.lib-table tbody tr';
  const patientRows = () => page.locator(`${T}.lib-patient`);
  const filmRows = () => page.locator(`${T}.lib-film`);
  const toggle = (name) => page.locator(`${T}.lib-patient button.lib-toggle`, { hasText: name });
  const expanded = async (name) => toggle(name).getAttribute('aria-expanded');
  const rowTexts = async () => (await page.locator(T).evaluateAll((rs) => rs.map((r) => (r.classList.contains('lib-patient') ? 'P:' : 'F:') + r.cells[0].innerText.replace(/[▸▾]\s*/, '') + (r.classList.contains('lib-film') ? ' ' + r.cells[2].innerText : ''))));
  const localDay = (iso) => { const d = new Date(iso); return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`; };

  // G1. Grouped is the default: one collapsed row per patient, no film rows.
  ok('G1. Grouped is the default: one collapsed row per patient, no film rows', (await page.getByRole('radio', { name: 'Grouped' }).getAttribute('aria-checked')) === 'true'
    && (await patientRows().count()) === 2 && (await filmRows().count()) === 0 && (await expanded('Synth Beta')) === 'false', (await rowTexts()).join(','));
  // G2. A patient row: DOB, number of films, latest scan, M/F, "n of m verified", latest report.
  const betaCells = await patientRows().filter({ hasText: 'Synth Beta' }).locator('td').allInnerTexts();
  ok('G2. a patient row shows DOB, films, latest scan, M/F, "1 of 2 verified" and the latest report',
    betaCells.slice(1, 8).join('|') === `04/03/2011|2 films|01/03/2026|M||1 of 2 verified|${localDay('2026-10-20T01:00:00.000Z')}`, betaCells.join('|'));
  // G3. Clicking the triangle opens it: its films, oldest first.
  await toggle('Synth Beta').click();
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr.lib-film').length === 2);
  ok('G3. clicking opens the patient: its films in timepoint order', (await expanded('Synth Beta')) === 'true'
    && (await rowTexts()).join(',') === 'P:Synth Alpha,P:Synth Beta,F:Synth Beta T1,F:Synth Beta T2', (await rowTexts()).join(','));
  // G4. Keyboard: Left closes, Right opens, Enter and Space toggle.
  await toggle('Synth Beta').focus();
  const keyIs = async (key, want) => { await page.keyboard.press(key); await page.waitForFunction(([w]) => document.activeElement?.getAttribute('aria-expanded') === w, [want]).catch(() => {}); return (await expanded('Synth Beta')) === want && (await filmRows().count()) === (want === 'true' ? 2 : 0); };
  const left = await keyIs('ArrowLeft', 'false'), right = await keyIs('ArrowRight', 'true'), enter = await keyIs('Enter', 'false'), space = await keyIs('Space', 'true');
  ok('G4. Left closes, Right opens, Enter and Space toggle a patient row (aria-expanded follows)', left && right && enter && space, `left ${left} right ${right} enter ${enter} space ${space}`);

  // 5. AI status names the model by its title, never the raw id.
  const aiCol = await filmRows().locator('td:nth-child(7)').allInnerTexts();
  ok('5. AI status gives the stage and model in plain words', aiCol.some((t) => t === 'Verified 12/10/2026 · Automatic best')
    && aiCol.some((t) => t === 'AI points to check · Automatic best'), aiCol.join(' | '));

  // 6. Clicking Name sorts the PATIENTS; each patient's films stay together in timepoint order.
  const nameHead = page.locator('table.lib-table thead th button', { hasText: 'Name' });
  await nameHead.click();
  await page.waitForFunction(() => document.querySelector('table.lib-table thead th[aria-sort="ascending"]')?.textContent.includes('Name'));
  const asc = (await rowTexts()).join(',');
  ok('6. clicking Name sorts patients ascending, with aria-sort and an arrow', asc === 'P:Synth Alpha,P:Synth Beta,F:Synth Beta T1,F:Synth Beta T2'
    && (await nameHead.innerText()).includes('▲'), asc);
  ok('6a. the arrow is hidden from screen readers (the header is named "Name")', (await page.getByRole('button', { name: 'Name', exact: true }).count()) === 1);
  await nameHead.focus();   // keyboard access: Enter on a focused header sorts too
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('table.lib-table thead th[aria-sort="descending"]'));
  const desc = (await rowTexts()).join(',');
  ok('6b. Enter on Name reverses the PATIENTS; Beta\'s films stay together, T1 then T2', desc === 'P:Synth Beta,F:Synth Beta T1,F:Synth Beta T2,P:Synth Alpha', desc);

  // 7. A search opens every patient with a matching film, listing only the matching films.
  await toggle('Synth Beta').click();   // close Beta first: the search must open it by itself
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr.lib-film').length === 0);
  await page.getByLabel('Search the library').fill('T2');
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr.lib-film').length === 1).catch(() => {});   // a miss is reported by the check, not a crash
  ok('7. a search opens the patient with a matching film and lists only that film', (await rowTexts()).join(',') === 'P:Synth Beta,F:Synth Beta T2'
    && (await expanded('Synth Beta')) === 'true', (await rowTexts()).join(','));
  await page.getByLabel('Search the library').fill('Alpha');
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr').length === 2).catch(() => {});
  ok('7b. searching a name opens that patient alone', (await rowTexts()).join(',') === 'P:Synth Alpha,F:Synth Alpha T1', (await rowTexts()).join(','));
  await page.getByLabel('Search the library').fill('');
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr.lib-film').length === 0).catch(() => {});
  ok('7c. clearing the search closes the patients again (none opened by hand)', (await patientRows().count()) === 2);

  // F. Flat: every film its own row, no patient rows; a sort runs across all films.
  await page.getByRole('radio', { name: 'Flat' }).click();
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr.lib-patient').length === 0 && document.querySelectorAll('table.lib-table tbody tr.lib-film').length === 3);
  ok('F1. Flat lists every film as its own row, no patient rows', (await filmRows().count()) === 3 && (await patientRows().count()) === 0);
  const scanHead = page.locator('table.lib-table thead th button', { hasText: 'Date of scan' });
  await scanHead.click(); await scanHead.click();   // descending by scan date: Beta T2 (Mar), Beta T1 (Feb), Alpha (Jan)
  await page.waitForFunction(() => document.querySelector('table.lib-table thead th[aria-sort="descending"]')?.textContent.includes('Date of scan'));
  const flatDesc = (await rowTexts()).join(',');
  ok('F2. Flat sorts across all films', flatDesc === 'F:Synth Beta T2,F:Synth Beta T1,F:Synth Alpha T1', flatDesc);
  await page.getByLabel('Search the library').fill('Beta');
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr').length === 2);
  ok('F3. the search filters the Flat rows', (await rowTexts()).every((t) => t.includes('Synth Beta')));
  await page.getByLabel('Search the library').fill('');
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr').length === 3);

  // 8. A film row is a real button: Space opens the film (review I1), as Enter and a click do.
  const openBeta1 = page.getByRole('button', { name: 'Open Synth Beta T1', exact: true });
  await openBeta1.focus();
  await page.keyboard.press('Space');
  await page.waitForSelector('g.landmark[data-id="S"]');
  ok('8. Space on a film row\'s button opens the film (role button, named "Open Synth Beta T1")', true);
  await page.getByRole('button', { name: '‹ Library' }).click();
  await page.waitForSelector('table.lib-table');
  await page.getByRole('button', { name: 'Open Synth Alpha T1', exact: true }).focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('.toolbar')?.textContent.includes('Synth Alpha'));
  ok('8b. Enter opens it too', true);
  await page.getByRole('button', { name: '‹ Library' }).click();
  await page.waitForSelector('table.lib-table');

  // R. The Report column: a saved report's date opens that film straight at its PDF export.
  const preview = page.locator('[role="dialog"][aria-label="Report preview"]');
  const reportCells = await filmRows().locator('td:nth-child(8)').allInnerTexts();
  ok('R1. the Report column shows the last saved report\'s day, blank for none', reportCells.filter((t) => t).length === 1
    && reportCells.includes(localDay('2026-10-20T01:00:00.000Z')), reportCells.join('|'));
  await page.getByRole('button', { name: `Save the report again for Synth Beta T1 (last saved ${localDay('2026-10-20T01:00:00.000Z')})` }).click();
  await preview.waitFor({ timeout: 15000 }).catch(() => {});
  ok('R2. clicking the date opens that film at its PDF export', await preview.isVisible()
    && (await page.locator('.toolbar').innerText()).includes('Synth Beta · T1'));
  await page.waitForFunction(() => !document.querySelector('[aria-label="Report preview"] button.primary')?.disabled, null, { timeout: 30000 });
  const stamp = (id) => page.evaluate((k) => JSON.parse(localStorage.getItem('fakeLib')).cases[k].reportSavedAt ?? null, id);
  // Cancelled, then failed: nothing recorded.
  const before = await stamp('c2');
  await page.evaluate(() => { window.__nextSave = null; });
  await preview.getByRole('button', { name: 'Save PDF…' }).click(); await page.waitForTimeout(800);
  ok('R3. a cancelled save records no date', (await stamp('c2')) === before && (await page.evaluate(() => window.__written.length)) === 0);
  await page.evaluate(() => { window.__failWrite = 'SYNTHETIC: the disk is full'; window.__nextSave = '/Users/demo/out/x.pdf'; });
  await preview.getByRole('button', { name: 'Save PDF…' }).click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Report preview"] .report-error')?.textContent.includes('disk is full'), null, { timeout: 15000 }).catch(() => {});
  ok('R4. a failed save records no date', (await stamp('c2')) === before && (await preview.locator('.report-error').count()) > 0);
  await page.evaluate(() => { window.__failWrite = null; window.__nextSave = '/Users/demo/out/SYNTHETIC report.pdf'; });
  await preview.getByRole('button', { name: 'Save PDF…' }).click();
  await page.waitForFunction(() => window.__written.includes('/Users/demo/out/SYNTHETIC report.pdf'), null, { timeout: 30000 }).catch(() => {});
  const after = await stamp('c2');
  ok('R5. a written save records the date on that film', !!after && after !== before, `${before} -> ${after}`);
  await preview.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: '‹ Library' }).click();
  await page.waitForSelector('table.lib-table');
  const today = localDay(new Date().toISOString());
  await page.waitForFunction((d) => [...document.querySelectorAll('table.lib-table tbody tr.lib-film td:nth-child(8)')].some((td) => td.textContent === d), today, { timeout: 5000 }).catch(() => {});
  const nowCells = await filmRows().locator('td:nth-child(8)').allInnerTexts();
  ok('R6. back in the Library, the Report column shows today for that film', nowCells.filter((t) => t === today).length === 1, nowCells.join('|'));

  // 9. Both choices are remembered across a reload (settings, per Mac): Table, and Flat.
  await page.reload();
  await page.waitForSelector('.library');
  await page.locator('table.lib-table').waitFor();
  ok('9. Pictures/Table is remembered across a reload', await page.locator('table.lib-table').isVisible());
  ok('9b. Grouped/Flat is remembered across a reload', (await page.getByRole('radio', { name: 'Flat' }).getAttribute('aria-checked')) === 'true'
    && (await patientRows().count()) === 0 && (await filmRows().count()) === 3);
  await page.getByRole('radio', { name: 'Grouped' }).click();
  await page.waitForFunction(() => document.querySelectorAll('table.lib-table tbody tr.lib-patient').length === 2);
  await page.reload();
  await page.waitForSelector('.library');
  await page.locator('table.lib-table').waitFor();
  ok('9c. and Grouped back again', (await page.getByRole('radio', { name: 'Grouped' }).getAttribute('aria-checked')) === 'true' && (await patientRows().count()) === 2);

  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
