// "My analysis" smoke (spec 2026-10-17 analysis builder, Option A; owner B1–B4, 17 Oct 2026): the built UI in
// Chromium with a stubbed Tauri runtime. SYNTHETIC only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800],
  Tg:[300,800],U1A:[690,300],L1A:[660,740],U6:[470,520],L6:[470,540] };
const landmarks = Object.entries(base).map(([id,[x,y]]) => ({ id, x: x + 350, y: y + 300, confidence: 0.8 }));
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const DEMO = 'Dr Demo SYNTHETIC', OTHER = 'Dr Other SYNTHETIC', NOS = 'NOS clinic SYNTHETIC';
const SEED = { version: 1, analyses: [{ id: 'my:seed1', name: NOS, items: [
  { id: 'm03_ANB', from: 'steiner' }, { id: 'm01_SNA', from: 'steiner' }, { id: 'm02_SNB', from: 'steiner' },
  { id: 'm22_FHMPt', from: 'downs' }, { id: 'm99_Gone', from: '' }] }] };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, landmarks }) => {
    window.__calls = [];
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{}}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        if (cmd.startsWith('library_learn') || cmd.startsWith('library_set_') || cmd === 'settings_set') window.__calls.push([cmd, a]);
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0, verifiedAt: null, deletedAt: null,
          patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true,
          // D2 (LIBID-1/2): the real CaseSummary always carries these (Library search box reads them).
          libraryId: null, formerLibraryIds: [], printedPatientId: c.patientId ?? null });
        const patientOf = (c) => Object.values(db.cases).filter((o) => o.patientKey === c.patientKey);
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          // Empty (not null/unstubbed): a real table, so `placeOnFilm`'s no-table fail-safe (ORIGINAL_19 only) is
          // never hit — every point `detect_landmarks` returns (including Tg, U1A, L1A, U6, L6) gets placed.
          case 'models_points': return [];
          case 'plugin:dialog|open': return window.__nextPick ?? null;
          case 'plugin:dialog|save': return window.__nextSave ?? null;
          case 'plugin:dialog|message': return 'Yes';
          case 'plugin:event|listen': return 1;
          case 'detect_landmarks': return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
            timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks, facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9 };
          case 'library_list': return Object.values(db.cases).filter(() => !a.deleted).map(summary);
          case 'library_user_norms': return [];
          case 'operators_list': return { current: db.settings.operator ?? '', names: ['Dr Demo SYNTHETIC', 'Dr Other SYNTHETIC'] };
          case 'operators_set_current': db.settings.operator = a.name; store(db); return null;
          case 'settings_default_population_get': return 'caucasian';   // a population with SDs, so the Chart draws lines
          case 'library_import': {
            const id = 'c' + (Object.keys(db.cases).length + 1), learned = a.path.includes('learned');
            // A 'nodob' film leaves DOB blank, so Choose on the film opens by itself (Task 8's S5 reads its buttons).
            db.cases[id] = { id, path: a.path, patientName: 'Demo Synthetic', patientKey: 'demo synthetic', dateOfBirth: a.path.includes('nodob') ? null : '1990-03-07', scanId: '4471',   // SYNTHETIC
              timepoint: 'T1', takenOn: '2024-02-07', takenOnSource: 'label', facing: 'right', orientation: {}, display: {}, spacingMm: 0.1,
              verifiedAt: null, verifiedBy: null, landmarks: [], createdAt: now(), updatedAt: now(), deletedAt: null, identitySource: 'manual',
              identityChecked: true, identityIssues: [], learnedFields: learned ? ['xray_type'] : [], gender: null, referringPractitioner: null,
              population: null, patientId: null, xrayType: learned ? 'Lateral Ceph' : null, xraySize: null, radiographyPractice: null };
            store(db); return { caseId: id, created: true };
          }
          case 'library_read_label': return { checked: true, issues: [], lines: [], learnedFields: [], conflicts: [], suggestions: [] };
          case 'library_label_text': return { lines: [], suggestions: [] };
          // The real command returns whether the value was found on the film; this stub's films have no text lines.
          case 'library_learn_value': return false;
          case 'library_open': { const c = db.cases[a.caseId];
            // D2 (Q8): the Patient ID is this X-ray's own; LIBID-1: every Patient ID on the patient's live X-rays.
            const patientIdsSeen = [...new Set(patientOf(c).filter((o) => !o.deletedAt).map((o) => o.patientId).filter((v) => v != null))];
            // D2 (LIBID-1, L9-A): the real CaseDoc always carries these; without them the patient panel reads
            // `doc.idMatches.map` of undefined, React unmounts and no landmark ever shows (merge of f240c7b).
            return { ...c, printedPatientId: c.patientId ?? null, libraryId: null, patientIdsSeen, idMatches: [], libraryTrail: [], image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, updatedAt: now() }); store(db); return { updatedAt: c.updatedAt, verifiedAt: null }; }
          case 'library_set_meta': Object.assign(db.cases[a.caseId], a.meta, { patientKey: a.meta.patientName.trim().toLowerCase() }); store(db); return null;
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          case 'text_file_write': { const f = JSON.parse(localStorage.getItem('fakeFiles') || '{}'); f[a.path] = a.text; localStorage.setItem('fakeFiles', JSON.stringify(f)); return null; }
          case 'text_file_read': { const f = JSON.parse(localStorage.getItem('fakeFiles') || '{}'); if (!(a.path in f)) throw new Error('No such file (SYNTHETIC)'); return f[a.path]; }
          default: return null;
        }
      },
    };
  }, { png, landmarks });

  const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')));
  const importFile = async (name) => {
    await page.evaluate((n) => { window.__nextPick = ['/Users/demo/' + n]; }, name);
    await page.getByRole('button', { name: 'Import…' }).first().click();
    // A film that never shows its points prints the page's own errors before giving up, so the cause is in the log.
    try { await page.waitForSelector('g.landmark[data-id="S"]'); }
    catch (e) { console.log(`importFile(${name}) — page errors:\n${errors.join('\n') || '(none)'}`); throw e; }
  };
  const keys = () => page.locator('.measures tr.m-row').evaluateAll((trs) => trs.map((t) => t.dataset.key));
  const mineKeys = async (name) => (await keys()).filter((k) => k.startsWith(name + ':'));
  // A cell that is not there reads as null (a clean FAIL), never a 30 s wait.
  const cell = async (key, sel) => { const l = page.locator(`tr.m-row[data-key="${key}"] ${sel}`); return (await l.count()) ? l.first().innerText() : null; };
  const picker = async () => { await page.getByRole('button', { name: 'Analyses…' }).click(); return page.getByRole('dialog', { name: 'Choose analyses' }); };
  const who = async (name) => { await page.getByLabel('Who is tracing').selectOption(name); await page.waitForTimeout(400); };

  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(({ seed, demo }) => localStorage.setItem('fakeLib', JSON.stringify({ cases: {}, settings: {
    analyses_enabled: JSON.stringify(['steiner', 'downs', 'mcnamara', 'my:seed1']), [`my_analyses:${demo}`]: JSON.stringify(seed) } })), { seed: SEED, demo: DEMO });
  await page.reload(); await page.waitForSelector('.library');
  await importFile('myanalysis-SYNTHETIC.png');
  await page.getByRole('tab', { name: 'Measurements' }).click(); await page.waitForTimeout(200);

  // M0: no clinician chosen — the built-ins only, nothing of anyone's own, no error.
  ok('M0. no clinician: no "My analysis" rows', (await mineKeys(NOS)).length === 0, (await keys()).slice(0, 4).join(' | '));
  let win = await picker();
  ok('M0. no clinician: the picker lists the 15 built-ins', (await win.locator('.analysis-row').count()) === 15);
  await win.getByRole('button', { name: 'Done' }).click();

  // M1–M6: Dr Demo chosen — their analysis appears, in their order, with the built-ins' values and norms.
  await who(DEMO);
  ok('M1. their analysis shows, in their order (the unavailable one is no row)',
    JSON.stringify(await mineKeys(NOS)) === JSON.stringify(['m03_ANB', 'm01_SNA', 'm02_SNB', 'm22_FHMPt'].map((n) => `${NOS}:${n}`)), (await mineKeys(NOS)).join(' | '));
  const pairs = [['m01_SNA', 'Steiner'], ['m02_SNB', 'Steiner'], ['m03_ANB', 'Steiner'], ['m22_FHMPt', 'Downs']];
  const m2 = [];
  let numericCompared = 0;
  for (const [n, a] of pairs) {
    const mv = await cell(`${NOS}:${n}`, 'td[data-band]'), bv = await cell(`${a}:${n}`, 'td[data-band]');
    const mn = await cell(`${NOS}:${n}`, 'td.m-norm'), bn = await cell(`${a}:${n}`, 'td.m-norm');
    m2.push([n, mv, bv, mn, bn]);
    const numeric = !!mv && /^-?\d/.test(mv);
    if (numeric) numericCompared++;
    ok(`M2. ${n}: the same value as in ${a}`, numeric && mv === bv, `${mv} vs ${bv}`);
    ok(`M3. ${n}: the same norm as in ${a} (owner B3)`, !!mn && mn === bn, `${mn} vs ${bn}`);
  }
  ok('M2. four numeric value pairs were actually compared', numericCompared === 4, `numericCompared=${numericCompared} ${JSON.stringify(m2)}`);
  ok('M2 control. the value comparison can fail (SNA and SNB differ)', (await cell('Steiner:m01_SNA', 'td[data-band]')) !== (await cell('Steiner:m02_SNB', 'td[data-band]')));
  const gone = await page.locator('.inspector p.unavailable').allInnerTexts();
  ok('M4. the measurement no longer available is named once, above the table', gone.length === 1 && gone[0] === `${NOS}: 1 measurement no longer available (m99_Gone).`, gone.join(' | '));
  await page.getByRole('tab', { name: 'Chart' }).click(); await page.waitForTimeout(200);
  const groups = await page.locator('svg.chart-overlay polyline.patient').evaluateAll((ps) => ps.map((p) => p.dataset.group));
  ok('M5. the Chart draws a line for it exactly as for Steiner (same rows, same norms)', groups.includes('steiner') && groups.includes('my:seed1'), groups.join(','));
  await page.getByRole('tab', { name: 'Measurements' }).click();

  win = await picker();
  ok('M6. the picker lists it beside the 15, marked yours', (await win.locator('.analysis-row').count()) === 16
    && (await win.locator('.analysis-row.mine .mine-tag').allInnerTexts()).join() === 'yours');
  await win.locator('.analysis-row.mine').getByRole('button', { name: NOS }).click();
  const un = await win.locator('.analysis-row.mine .measure-row.unavailable').allInnerTexts();
  ok('M6. opened, it shows the measurement no longer available', un.length === 1 && un[0].includes('m99_Gone') && un[0].includes('no longer available'), un.join(' | '));
  await win.getByRole('checkbox', { name: `Show ${NOS}` }).uncheck();
  await win.getByRole('button', { name: 'Done' }).click(); await page.waitForTimeout(200);
  const en1 = JSON.parse((await lib()).settings.analyses_enabled);
  ok('M7. unticked: its rows go, and the stored choice drops it', (await mineKeys(NOS)).length === 0 && !en1.includes('my:seed1'), JSON.stringify(en1));
  win = await picker(); await win.getByRole('checkbox', { name: `Show ${NOS}` }).check(); await win.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(200);
  ok('M7. ticked again: back', (await mineKeys(NOS)).length === 4);

  // M8: another clinician sees only the built-ins; their changes keep Dr Demo's tick.
  await who(OTHER);
  ok('M8. another clinician: no rows of Dr Demo\'s analysis', (await mineKeys(NOS)).length === 0);
  win = await picker();
  ok('M8. another clinician: the picker lists the 15', (await win.locator('.analysis-row').count()) === 15);
  await win.getByRole('checkbox', { name: 'Show McNamara' }).uncheck(); await win.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(200);
  const en2 = JSON.parse((await lib()).settings.analyses_enabled);
  ok("M8. their change keeps Dr Demo's tick in the stored choice", en2.includes('my:seed1') && !en2.includes('mcnamara'), JSON.stringify(en2));
  await who(DEMO);
  ok('M8. back to Dr Demo: shown again', (await mineKeys(NOS)).length === 4);

  // E1–E11: Settings ▸ Analyses ▸ Your analyses (Dr Demo is the clinician here).
  const stored = async (c = DEMO) => (await lib()).settings[`my_analyses:${c}`] ?? null;
  const openSettings = async () => { await page.getByRole('button', { name: 'Settings…' }).first().click(); return page.getByRole('dialog', { name: 'Settings' }); };
  let set = await openSettings();
  // V1 (owner, 19 Oct): the foot of Settings names the app, its version (package.json) and the build day (AU format here).
  const foot = (await set.locator('.settings-version').count()) ? await set.locator('.settings-version').innerText() : '';
  const appVersion = JSON.parse(fs.readFileSync(require('path').join(__dirname, '..', 'package.json'), 'utf8')).version;
  ok('V1. Settings shows "OpenCephAI <version> · built <day>"', new RegExp(`^OpenCephAI ${appVersion.replace(/\./g, '\\.')} · built \\d{2}/\\d{2}/\\d{4}$`).test(foot), foot);
  const mineBox = () => set.getByRole('region', { name: 'Your analyses' });
  // F14: Chrome's innerText puts a line break between flex items (.my-row is display:flex), so reading the whole
  // row's innerText as one string would never match a single-space join — compare the normalised parts instead.
  const rowsText = async () => mineBox().locator('.my-row').evaluateAll((ls) => ls.map((l) => `${l.querySelector('b').textContent} ${l.querySelector('.hint').textContent}`));
  ok('E1. their analysis is listed with its counts', (await rowsText()).includes(`${NOS} 4 measurements, 1 no longer available`), (await rowsText()).join(' | '));
  const editor = () => set.getByRole('group', { name: /analysis/ });
  const alertText = async () => ((await editor().getByRole('alert').count()) ? editor().getByRole('alert').innerText() : null);
  const before = await stored();
  await mineBox().getByRole('button', { name: 'New analysis…' }).click();
  await editor().getByRole('textbox', { name: 'Name' }).fill('Empty SYNTHETIC');
  await editor().getByRole('button', { name: 'Save analysis' }).click(); await page.waitForTimeout(200);
  ok('E2. an empty analysis is refused and nothing is stored', (await alertText()) === 'Choose at least one measurement. An empty analysis is not saved.' && (await stored()) === before, await alertText());
  await editor().getByRole('textbox', { name: 'Name' }).fill('steiner');
  await editor().getByRole('checkbox', { name: 'Include SNA', exact: true }).check();
  await editor().getByRole('button', { name: 'Save analysis' }).click(); await page.waitForTimeout(200);
  ok("E3. a built-in's name is refused, in any case", (await alertText()) === 'There is already an analysis called “Steiner”. Choose another name.' && (await stored()) === before, await alertText());
  const find = editor().getByRole('searchbox', { name: 'Find a measurement' });
  await find.fill('zzz');
  ok('E4. a search with no match says so', (await editor().getByText('No measurement matches “zzz”.').count()) === 1);
  await find.fill('wits'); await editor().getByRole('checkbox', { name: 'Include Wits (mm)', exact: true }).check();
  await find.fill('#22');
  ok('E4. #22 shows that one measurement', (await editor().locator('.my-pick').count()) === 1);
  await editor().locator('.my-pick input').first().check();
  const order = () => editor().locator('.my-chosen li').evaluateAll((ls) => ls.map((l) => l.dataset.node));
  ok('E4. chosen in the order ticked', JSON.stringify(await order()) === '["m01_SNA","m13_Wits","m22_FHMPt"]', JSON.stringify(await order()));
  await editor().getByRole('button', { name: 'Move FH–MP, tangent (FMA, Downs mandibular plane) up' }).click();
  ok('E4. ↑ moves it up', JSON.stringify(await order()) === '["m01_SNA","m22_FHMPt","m13_Wits"]', JSON.stringify(await order()));
  await editor().locator('.my-chosen li').nth(2).dragTo(editor().locator('.my-chosen li').nth(0));
  ok('E5. drag moves it too', JSON.stringify(await order()) === '["m13_Wits","m01_SNA","m22_FHMPt"]', JSON.stringify(await order()));
  ok('E4. each says where its norm comes from', (await editor().locator('.my-item[data-node="m01_SNA"] .my-norm').innerText()) === "Norm: your population's, else Steiner's own");
  await editor().getByRole('textbox', { name: 'Name' }).fill('Quick SYNTHETIC');
  await editor().getByRole('button', { name: 'Save analysis' }).click(); await page.waitForTimeout(300);
  const s1 = JSON.parse(await stored());
  const quick = s1.analyses.find((a) => a.name === 'Quick SYNTHETIC');
  ok('E6. saved in that order, under Dr Demo', !!quick && JSON.stringify(quick.items.map((i) => i.id)) === '["m13_Wits","m01_SNA","m22_FHMPt"]' && (await stored()) !== before, JSON.stringify(quick));
  await set.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(300);
  ok('E6. shown at once, in its order', JSON.stringify(await mineKeys('Quick SYNTHETIC')) === JSON.stringify(['m13_Wits', 'm01_SNA', 'm22_FHMPt'].map((n) => `Quick SYNTHETIC:${n}`)),
    (await mineKeys('Quick SYNTHETIC')).join(' | '));

  set = await openSettings();
  await set.getByLabel('Built-in analysis to duplicate').selectOption('downs');
  await mineBox().getByRole('button', { name: 'Duplicate' }).click();
  ok('E7. Duplicate names it "Downs (copy)" with all 10', (await editor().getByRole('textbox', { name: 'Name' }).inputValue()) === 'Downs (copy)' && (await editor().locator('.my-chosen li').count()) === 10);
  await editor().getByRole('button', { name: 'Save analysis' }).click(); await page.waitForTimeout(300);
  await set.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(300);
  const dk = await mineKeys('Downs (copy)'), dv = [];
  for (const k of dk) { const n = k.split(':').pop(); dv.push([n, await cell(k, 'td[data-band]'), await cell(`Downs:${n}`, 'td[data-band]')]); }
  ok('E7. every value of the copy equals Downs\'s (master plan §7, on screen)', dk.length === 10 && dv.every(([, a, b]) => a !== null && a === b), JSON.stringify(dv));

  set = await openSettings();
  await mineBox().locator('.my-row', { hasText: 'Quick SYNTHETIC' }).getByRole('button', { name: 'Edit…' }).click();
  await editor().getByRole('textbox', { name: 'Name' }).fill(NOS);
  await editor().getByRole('button', { name: 'Save analysis' }).click(); await page.waitForTimeout(200);
  ok('E8. renaming to another of their own names is refused', (await alertText()) === `There is already an analysis called “${NOS}”. Choose another name.`, await alertText());
  await editor().getByRole('textbox', { name: 'Name' }).fill('Quick 2 SYNTHETIC');
  await editor().getByRole('button', { name: 'Save analysis' }).click(); await page.waitForTimeout(300);
  const s2 = JSON.parse(await stored());
  ok('E8. renamed, same id', s2.analyses.some((a) => a.id === quick.id && a.name === 'Quick 2 SYNTHETIC'));
  await mineBox().locator('.my-row', { hasText: NOS }).getByRole('button', { name: 'Edit…' }).click();
  await editor().getByRole('button', { name: 'Remove m99_Gone — no longer available' }).click();
  await editor().getByRole('button', { name: 'Save analysis' }).click(); await page.waitForTimeout(300);
  ok('E9. removing the unavailable one: the list no longer mentions it', (await mineBox().locator('.my-row', { hasText: NOS }).innerText()).includes('4 measurements')
    && !(await mineBox().locator('.my-row', { hasText: NOS }).innerText()).includes('no longer available'));
  await mineBox().locator('.my-row', { hasText: 'Quick 2 SYNTHETIC' }).getByRole('button', { name: 'Edit…' }).click();
  await editor().getByRole('button', { name: 'Remove SNA' }).click();
  const unchanged = await stored();
  await editor().getByRole('button', { name: 'Cancel' }).click(); await page.waitForTimeout(200);
  ok('E10. Cancel stores nothing', (await stored()) === unchanged);
  await mineBox().locator('.my-row', { hasText: 'Downs (copy)' }).getByRole('button', { name: 'Delete…' }).click(); await page.waitForTimeout(300);
  const copyId = s2.analyses.find((a) => a.name === 'Downs (copy)').id;
  ok('E11. Delete removes it from their list and from the shown analyses', !(await stored()).includes('Downs (copy)')
    && !JSON.parse((await lib()).settings.analyses_enabled).includes(copyId));
  await set.getByRole('button', { name: 'Close' }).click(); await page.waitForTimeout(300);
  ok('E11. its rows are gone', (await mineKeys('Downs (copy)')).length === 0);
  ok('E9/E11. no \'no longer available\' line once m99_Gone is removed', (await page.locator('.inspector p.unavailable').count()) === 0);
  await who(OTHER); set = await openSettings();
  ok('E12. another clinician: none yet', (await mineBox().locator('.my-row').count()) === 0);
  await set.getByRole('button', { name: 'Close' }).click(); await who(DEMO);
  await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(400);
  set = await openSettings();
  ok('E12. after a reload: their two analyses are still there', (await mineBox().locator('.my-row').count()) === 2);
  await set.getByRole('button', { name: 'Close' }).click();

  // X1–X8: Export… and Import… (owner B4). The app is on the library screen after E12's reload.
  const files = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakeFiles') || '{}'));
  set = await openSettings();
  await page.evaluate(() => { window.__nextSave = null; });
  await mineBox().locator('.my-row', { hasText: NOS }).getByRole('button', { name: 'Export…' }).click(); await page.waitForTimeout(200);
  ok('X1. a cancelled save writes nothing', Object.keys(await files()).length === 0);
  await page.evaluate(() => { window.__nextSave = '/Users/demo/NOS SYNTHETIC.analysis.json'; });
  await mineBox().locator('.my-row', { hasText: NOS }).getByRole('button', { name: 'Export…' }).click(); await page.waitForTimeout(300);
  const out = JSON.parse((await files())['/Users/demo/NOS SYNTHETIC.analysis.json'] ?? 'null');
  ok('X2. exported: format, name, measurements in order with labels and norm sources', !!out && out.format === 'opencephai-analysis' && out.version === 1 && out.name === NOS
    && JSON.stringify(out.items.map((i) => [i.id, i.from])) === JSON.stringify([['m03_ANB', 'steiner'], ['m01_SNA', 'steiner'], ['m02_SNB', 'steiner'], ['m22_FHMPt', 'downs']])
    && out.items[1].label === 'SNA', JSON.stringify(out));
  await page.evaluate(() => { window.__nextPick = null; });
  await mineBox().getByRole('button', { name: 'Import…' }).click(); await page.waitForTimeout(200);
  ok('X3. a cancelled open does nothing', (await mineBox().locator('.my-row').count()) === 2);
  await page.evaluate(() => { window.__nextPick = '/Users/demo/NOS SYNTHETIC.analysis.json'; });
  await mineBox().getByRole('button', { name: 'Import…' }).click(); await page.waitForTimeout(300);
  ok('X4. same name already here: the editor opens with the reason', (await alertText()) === `There is already an analysis called “${NOS}”. Choose another name.`, await alertText());
  await editor().getByRole('textbox', { name: 'Name' }).fill('NOS from Clinic B SYNTHETIC');
  await editor().getByRole('button', { name: 'Save analysis' }).click(); await page.waitForTimeout(300);
  const imp = JSON.parse(await stored()).analyses.find((a) => a.name === 'NOS from Clinic B SYNTHETIC');
  ok('X4. renamed and saved, every measurement and norm source kept', !!imp && JSON.stringify(imp.items) === JSON.stringify(out.items.map(({ id, from }) => ({ id, from }))), JSON.stringify(imp));
  // A "new Mac": Dr Demo's analyses gone; import brings them back.
  await set.getByRole('button', { name: 'Close' }).click();
  await page.evaluate((demo) => { const db = JSON.parse(localStorage.getItem('fakeLib')); delete db.settings[`my_analyses:${demo}`]; localStorage.setItem('fakeLib', JSON.stringify(db)); }, DEMO);
  await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(400);
  set = await openSettings();
  ok('X5. "new Mac": none yet', (await mineBox().locator('.my-row').count()) === 0);
  await page.evaluate(() => { window.__nextPick = '/Users/demo/NOS SYNTHETIC.analysis.json'; });
  await mineBox().getByRole('button', { name: 'Import…' }).click(); await page.waitForTimeout(300);
  const back = JSON.parse(await stored() ?? '{"analyses":[]}').analyses;
  ok('X5. imported straight in: same name, measurements, order and norm sources', back.length === 1 && back[0].name === NOS
    && JSON.stringify(back[0].items) === JSON.stringify(out.items.map(({ id, from }) => ({ id, from }))), JSON.stringify(back));
  ok('X5. and shown at once', JSON.parse((await lib()).settings.analyses_enabled).includes(back[0]?.id));
  await page.evaluate(() => { const f = JSON.parse(localStorage.getItem('fakeFiles') || '{}');
    f['/Users/demo/not.json'] = '{"hello":1}'; f['/Users/demo/newer.json'] = JSON.stringify({ format: 'opencephai-analysis', version: 2, name: 'N', items: [] });
    localStorage.setItem('fakeFiles', JSON.stringify(f)); });
  const status = async () => ((await mineBox().getByRole('status').count()) ? mineBox().getByRole('status').innerText() : null);
  for (const [path, words, n] of [['/Users/demo/not.json', 'This file is not an OpenCephAI analysis.', 'X6'],
    ['/Users/demo/newer.json', 'This analysis was saved by a newer OpenCephAI. Update the app, then import it again.', 'X7'],
    ['/Users/demo/missing.json', 'It could not be imported: No such file (SYNTHETIC)', 'X8']]) {
    await page.evaluate((p) => { window.__nextPick = p; }, path);
    await mineBox().getByRole('button', { name: 'Import…' }).click(); await page.waitForTimeout(300);
    ok(`${n}. ${path.split('/').pop()}: says why, imports nothing`, (await status()) === words && (await mineBox().locator('.my-row').count()) === 1, await status());
  }
  await set.getByRole('button', { name: 'Close' }).click();

  // X9 (fix round 1, review I1): a fresh analysis holding a measurement id outside today's catalogue — seeded
  // directly, since the editor's picker only offers live catalogue ids and there is no UI path to create one; this
  // stands in for an export made before the id was retired. A fresh analysis is used so NOS's own E9 step (which
  // already removed its one unavailable item earlier in this file) cannot interfere. Exporting it must keep that
  // item exactly as `analysisFile` defines it (Task 6, custom-file.ts); importing it back must show it as "no
  // longer available" the same way the Settings list already does (E1).
  const GONE_NAME = 'Keeps unavailable SYNTHETIC';
  await page.evaluate(({ demo, name }) => {
    const db = JSON.parse(localStorage.getItem('fakeLib'));
    const cur = JSON.parse(db.settings[`my_analyses:${demo}`] ?? '{"version":1,"analyses":[]}');
    cur.analyses.push({ id: 'my:seed9', name, items: [{ id: 'm01_SNA', from: 'steiner' }, { id: 'm99_Gone', from: '' }] });
    db.settings[`my_analyses:${demo}`] = JSON.stringify(cur);
    localStorage.setItem('fakeLib', JSON.stringify(db));
  }, { demo: DEMO, name: GONE_NAME });
  await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(400);
  set = await openSettings();
  await page.evaluate(() => { window.__nextSave = '/Users/demo/gone SYNTHETIC.analysis.json'; });
  await mineBox().locator('.my-row', { hasText: GONE_NAME }).getByRole('button', { name: 'Export…' }).click(); await page.waitForTimeout(300);
  const goneOut = JSON.parse((await files())['/Users/demo/gone SYNTHETIC.analysis.json'] ?? 'null');
  ok('X9. exported: the unavailable item is kept exactly as analysisFile defines it (Task 6)', !!goneOut
    && JSON.stringify(goneOut.items) === JSON.stringify([{ id: 'm01_SNA', label: 'SNA', from: 'steiner' }, { id: 'm99_Gone', label: null, from: '' }]), JSON.stringify(goneOut));
  // Rename the file's own name before importing (X4 already covers the clash/rename path), so this round trip
  // lands directly as a new row rather than retesting the editor-rename path.
  await page.evaluate(() => { const f = JSON.parse(localStorage.getItem('fakeFiles') || '{}');
    const j = JSON.parse(f['/Users/demo/gone SYNTHETIC.analysis.json']); j.name = 'Keeps unavailable copy SYNTHETIC';
    f['/Users/demo/gone SYNTHETIC.analysis.json'] = JSON.stringify(j); localStorage.setItem('fakeFiles', JSON.stringify(f)); });
  await page.evaluate(() => { window.__nextPick = '/Users/demo/gone SYNTHETIC.analysis.json'; });
  await mineBox().getByRole('button', { name: 'Import…' }).click(); await page.waitForTimeout(300);
  ok('X9. re-imported under a new name: shown as no longer available, the same way the Settings list shows it (E1)',
    (await rowsText()).includes('Keeps unavailable copy SYNTHETIC 1 measurement, 1 no longer available'), (await rowsText()).join(' | '));
  await set.getByRole('button', { name: 'Close' }).click();

  // END OF CHECKS (Tasks 5 and 7 insert their sections above this line)
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
