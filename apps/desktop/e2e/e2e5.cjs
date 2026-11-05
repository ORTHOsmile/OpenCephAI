// Choose on the film + film layouts smoke: the built UI in Chromium with a stubbed Tauri runtime. SYNTHETIC only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const landmarks = Object.entries(base).map(([id,[x,y]]) => ({ id, x: x + 350, y: y + 300, confidence: 0.8 }));
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const shot = (page, n) => page.screenshot({ path: `${__dirname}/out/ch-${n}.png` });
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, landmarks }) => {
    const even = (text, bbox) => { const n = text.length; let i = 0;
      return { text, bbox, words: text.split(' ').map((w) => { const x = bbox[0] + (bbox[2] * i) / n; i += w.length + 1;
        return { text: w, bbox: [x, bbox[1], (bbox[2] * w.length) / n, bbox[3]] }; }) }; };
    const LINES = [even('Demo Radiology Northside', [0.03, 0.03, 0.36, 0.025]), even('DEMO, Synthetic', [0.03, 0.07, 0.24, 0.025]),
      even('DOB 07/03/1990 SYNTHETIC', [0.03, 0.11, 0.36, 0.025]), even('PID 5566', [0.03, 0.15, 0.14, 0.025]), even('09\\30\\70', [0.70, 0.30, 0.12, 0.025])];
    // I2 (owner, 5 Oct): a synthetic "glued scrap" word run as a Film date — the shape ")24-Jan-12" refuses rather
    // than misreading as 24 Jan 2012; a re-read that drops the scrap must not be allowed to save the wrong date.
    const CUTYEAR_LINES = [...LINES, even(')24-Jan-12', [0.03, 0.19, 0.12, 0.025])];
    window.__calls = [];
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{},"compare":{},"machines":[{"id":"m1","name":"J.Morita Mfg","films":12,"learned":["full","dob"]},{"id":"m2","name":"Machine 2","films":1,"learned":[]}]}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    const key = (n) => n.toLowerCase().trim();
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        if (cmd.startsWith('library_learn') || cmd === 'library_read_area' || cmd === 'library_confirm_identity' || cmd.endsWith('_machine') || cmd === 'plugin:dialog|message') window.__calls.push([cmd, a]);
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: c.landmarks.filter((l) => !l.verified).length,
          verifiedAt: c.verifiedAt, deletedAt: c.deletedAt, patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: c.identityChecked,
          libraryId: null, formerLibraryIds: [], printedPatientId: null });
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'plugin:dialog|open': return [window.__nextPick];
          // `ask()` (@tauri-apps/plugin-dialog) invokes 'plugin:dialog|message', never 'plugin:dialog|ask' — fix
          // round 1 (Task 10 review M2): the dead `case 'plugin:dialog|ask'` that used to sit here never matched
          // anything real; removed. Recorded above (into `window.__calls`) so "Reset asks"/"Delete asks" can
          // assert the confirm was actually shown, not just its reply.
          case 'plugin:dialog|message': return 'Yes';
          case 'plugin:event|listen': return 1;
          case 'detect_landmarks': return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
            timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks, facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9 };
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map(summary);
          case 'library_import': {
            const id = 'c' + (Object.keys(db.cases).length + 1);
            db.cases[id] = { id, path: a.path, patientName: '', patientKey: '~' + id, dateOfBirth: null, scanId: null, timepoint: 'T1', takenOn: now().slice(0, 10),
              facing: 'right', orientation: {}, display: {}, spacingMm: null, verifiedAt: null, verifiedBy: null, landmarks: [], createdAt: now(), updatedAt: now(),
              deletedAt: null, identitySource: 'manual', identityChecked: false, identityIssues: [{ kind: 'nameNotRead' }, { kind: 'noDateOfBirth' }], takenOnSource: 'label', learnedFields: [],
              gender: null, referringPractitioner: null,
              // Task 5 (D2): the real CaseDoc always carries these; a stub without them has the panel read undefined.
              libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [] };
            store(db); return { caseId: id, created: true };
          }
          case 'library_read_label': {
            const c = db.cases[a.caseId];
            if (c.path.includes('learned')) Object.assign(c, { patientName: 'Demo Synthetic', patientKey: 'demo synthetic', dateOfBirth: '1990-03-07', scanId: '5566',   // SYNTHETIC
              identitySource: 'film', identityChecked: true, identityIssues: [], learnedFields: ['name'] });
            const conflict = c.path.includes('conflict');
            if (conflict) Object.assign(c, { patientName: 'Demo Synthetic', patientKey: 'demo synthetic', identitySource: 'manual', identityChecked: true, identityIssues: [] });
            store(db);
            return { checked: c.identityChecked, issues: c.identityIssues, lines: c.path.includes('cutyear') ? CUTYEAR_LINES : LINES, learnedFields: c.learnedFields,
              conflicts: conflict ? [{ field: 'dob', label: '1990-03-07', learned: '1991-01-01' }] : [],   // SYNTHETIC
              suggestions: [{ field: 'dob', line: 2, from: 1, to: 1, value: '1990-03-07', isDefault: false }] };   // SYNTHETIC
          }
          case 'library_label_text': return { lines: structuredClone(db.cases[a.caseId].path.includes('cutyear') ? CUTYEAR_LINES : LINES), suggestions: [] };   // IPC gives fresh objects each read
          case 'library_read_area': return window.__areaText ? [even(window.__areaText, [a.rect[0] + 0.01, a.rect[1] + 0.01, 0.08, 0.02])]
            : [even('SYNTHETIC AREA', [a.rect[0] + 0.01, a.rect[1] + 0.01, 0.08, 0.02])];
          case 'library_learn_value': return true;
          case 'library_confirm_identity': Object.assign(db.cases[a.caseId], { identityChecked: true, identitySource: 'manual', identityIssues: [], learnedFields: [] }); store(db); return null;
          case 'library_open': { const c = db.cases[a.caseId];
            return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id];
            Object.assign(c, { facing: a.edit.facing, orientation: a.edit.orientation, display: a.edit.display, landmarks: a.edit.landmarks, updatedAt: now() });
            store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_set_meta': { const n = a.meta.patientName.trim();
            Object.assign(db.cases[a.caseId], a.meta, { patientKey: n ? key(n) : '~' + a.caseId, identityChecked: !!n, identitySource: 'manual', learnedFields: [],
              identityIssues: n ? [] : [{ kind: 'nameNotRead' }] });
            store(db); return null; }
          case 'library_machines': return db.machines;
          case 'library_rename_machine': db.machines.find((m) => m.id === a.id).name = a.name; store(db); return null;
          case 'library_reset_machine': db.machines.find((m) => m.id === a.id).learned = []; store(db); return null;
          case 'library_delete_machine': db.machines = db.machines.filter((m) => m.id !== a.id); store(db); return null;
          // Task MS-6: Delete now counts what it changes first (`machineDeleteChange`) before asking; this fixture
          // predates MS-1…MS-6 and has no scale to clear, so the count is always empty (M-2-style gap fix).
          case 'library_machine_delete_change': return { films: [], fitted: [], deleted: 0 };
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
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
  const toLibrary = async () => { await page.getByRole('button', { name: '‹ Library' }).click(); await page.waitForSelector('.library'); };
  // Film details Task 7 (C3): the label is matched EXACTLY on its title row, so "Patient" never also finds "Patient ID".
  const exact = (label) => new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(Pick)?$');
  const field = (label) => page.locator('.case-panel label').filter({ has: page.locator(':scope > .label-row', { hasText: exact(label) }) }).locator('input, textarea');
  const words = () => page.locator('.choose-word');
  const clickWord = async (i) => { const b = await words().nth(i).boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2); };
  const calls = () => page.evaluate(() => window.__calls);

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  await importFile('unread-label.png');
  await page.waitForTimeout(300);
  ok('1. a film whose name was not read opens Choose mode with every word outlined', (await words().count()) === 11, String(await words().count()));
  ok('1. with the hint', ((await page.locator('.place-hint').allInnerTexts()).join(' ')).includes('Click the words on the film, then choose what they are'));
  ok('4. a learned place not yet the default is marked Suggested', (await page.locator('.choose-suggested').allInnerTexts()).join() === 'Suggested: DOB');
  await shot(page, '1-choose');
  const S0 = await page.locator('g.landmark[data-id="S"]').boundingBox();
  await page.mouse.move(S0.x + S0.width / 2, S0.y + S0.height / 2); await page.mouse.down();
  await page.mouse.move(S0.x + S0.width / 2 + 40, S0.y + S0.height / 2 + 30, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(200);
  const S1 = await page.locator('g.landmark[data-id="S"]').boundingBox();
  ok('M3. in Choose mode a landmark can still be dragged', Math.abs(S1.x - S0.x) > 20 && (await words().count()) === 11, `${S0.x}→${S1.x}`);
  const st = await page.locator('.stage').boundingBox();
  await page.mouse.move(st.x + st.width * 0.6, st.y + st.height * 0.8); await page.mouse.down();
  await page.mouse.move(st.x + st.width * 0.6 - 60, st.y + st.height * 0.8 - 20, { steps: 5 }); await page.mouse.up();
  await page.waitForTimeout(200);
  ok('M3. and a drag on the film pans, without re-reading the area', !(await calls()).some(([c]) => c === 'library_read_area'));
  await page.keyboard.press('Meta+0'); await page.waitForTimeout(200);
  await clickWord(3);                                                                     // "DEMO,"
  ok('2. clicking a word shows the chooser', (await page.locator('.chooser').count()) === 1);
  const chooserButtons = await page.locator('.chooser select option').allInnerTexts();
  ok('2. the chooser offers every detail, in the panel\'s order (owner E)', JSON.stringify(chooserButtons) === JSON.stringify(['Use as…', 'Title', 'Full name', 'Last name', 'First name(s)', 'DOB', 'Age',
    'Gender', 'Film date', 'Scan ID', 'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice', 'Referring practitioner']), JSON.stringify(chooserButtons));
  await shot(page, '2-chooser');
  await page.locator('.chooser select').selectOption('last');
  await page.waitForTimeout(200);
  await clickWord(4);                                                                     // "Synthetic"
  await page.locator('.chooser select').selectOption('first');
  await page.waitForTimeout(300);
  ok('2. Last name then First name(s) make "Demo, Synthetic"', (await field('Patient').inputValue()) === 'Demo, Synthetic', await field('Patient').inputValue());
  const learned = (await calls()).filter(([c]) => c === 'library_learn_selection').map(([, a]) => `${a.field}:${a.line}:${a.from}-${a.to}`);
  ok('2. and each choice teaches the machine', learned.join() === 'last:1:0-0,first:1:1-1', learned.join());
  await page.getByRole('button', { name: 'Pick Scan ID on the film' }).click();
  await clickWord(9);                                                                     // "5566"
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok('3. Pick next to Scan ID, click the number, Enter: Scan ID is 5566', (await field('Scan ID').inputValue()) === '5566', await field('Scan ID').inputValue());
  ok('3. finishing a Pick closes Choose mode', (await words().count()) === 0);
  // Owner, 30 Sep: a back-to-front DOB came through garbled; choosing it re-reads that spot and uses the date found.
  await page.evaluate(() => { window.__areaText = '07/03/90'; });
  await page.getByRole('button', { name: 'Pick Date of birth on the film' }).click();
  await clickWord(10);                                                                    // the garbled word
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  ok('13. a garbled date is re-read where it was chosen and fills DOB', (await field('Date of birth').inputValue()) === '07/03/1990', await field('Date of birth').inputValue());   // SYNTHETIC
  await page.evaluate(() => { window.__areaText = undefined; });
  await page.getByRole('button', { name: 'Pick Date of birth on the film' }).click();
  await page.waitForTimeout(200);
  const before = await words().count();
  await page.evaluate(() => { window.__calls = window.__calls.filter(([c]) => c !== 'library_read_area'); });
  const film = await page.locator('.stage').boundingBox();
  await page.mouse.click(film.x + film.width * 0.5, film.y + film.height * 0.55);
  await page.waitForTimeout(300);
  ok('6. clicking where no text was found re-reads that area and outlines what it finds', (await calls()).some(([c]) => c === 'library_read_area')
    && (await words().count()) === before + 2, `${before} → ${await words().count()}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  ok('7. Esc closes Choose mode', (await words().count()) === 0);

  await toLibrary();
  await importFile('learned-label.png');
  await page.waitForTimeout(300);
  const note = page.locator('.identity-note', { hasText: 'Learned for this machine' });
  ok('5. a learned default fills with "Learned for this machine" and OK', (await note.count()) === 1 && (await field('Patient').inputValue()) === 'Demo Synthetic');
  await shot(page, '5-learned');
  await note.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(300);
  const c2 = (await calls()).map(([c, a]) => c + (a.field ? ':' + a.field : ''));
  ok('5. OK confirms and teaches the machine', c2.includes('library_confirm_identity') && c2.includes('library_learn_value:full'), c2.join());
  await toLibrary();
  await page.locator('details.film-layouts summary').click();
  const rows = () => page.locator('details.film-layouts li');
  ok('12. Film layouts lists each machine with what it learned', (await rows().count()) === 2
    && (await rows().nth(0).innerText()).includes('Full name, DOB learned · 12 films') && (await rows().nth(1).innerText()).includes('nothing learned yet · 1 film'),
    (await rows().allInnerTexts()).join(' / '));
  const n2 = page.getByRole('textbox', { name: 'Name of Machine 2' });
  await n2.fill('Room 2'); await n2.press('Tab'); await page.waitForTimeout(300);
  ok('12. renaming a machine saves it', (await calls()).some(([c, a]) => c === 'library_rename_machine' && a.name === 'Room 2')
    && (await page.getByRole('textbox', { name: 'Name of Room 2' }).count()) === 1);
  await rows().nth(0).getByRole('button', { name: 'Reset' }).click(); await page.waitForTimeout(300);
  ok('12. Reset asks (the confirm dialog was shown), then forgets what that machine learned', (await calls()).some(([c]) => c === 'plugin:dialog|message')
    && (await calls()).some(([c]) => c === 'library_reset_machine') && (await rows().nth(0).innerText()).includes('nothing learned yet'));
  await page.evaluate(() => { window.__calls = window.__calls.filter(([c]) => c !== 'plugin:dialog|message'); });
  await rows().nth(1).getByRole('button', { name: 'Delete' }).click(); await page.waitForTimeout(300);
  ok('12. Delete asks (the confirm dialog was shown), then removes the machine', (await calls()).some(([c]) => c === 'plugin:dialog|message')
    && (await calls()).some(([c]) => c === 'library_delete_machine') && (await rows().count()) === 1);
  await shot(page, '12-layouts');
  // Owner, 30 Sep (M1): a disagreement stays listed after the details are checked, and the label's value is outlined.
  if (!(await page.locator('.library').count())) await toLibrary();
  await importFile('conflict-label.png');
  await page.waitForTimeout(300);
  ok('14. a label/learned disagreement stays listed after details are checked', (await page.locator('.case-panel').innerText()).includes('label says 07/03/1990'));   // SYNTHETIC
  await page.getByRole('button', { name: 'Pick Date of birth on the film' }).click();
  await page.waitForTimeout(200);
  ok('15. the label\'s own value is outlined on the film', (await page.locator('.choose-label-tag').allInnerTexts()).join() === 'On the label: Date of birth'
    && (await page.locator('polygon.choose-label').count()) === 1, (await page.locator('.choose-label-tag').allInnerTexts()).join());
  // Owner, 30 Sep (M2): drag across words; shift-click onto the next line.
  const centre = async (i) => { const b = await words().nth(i).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const a0 = await centre(0), a2 = await centre(2);
  await page.mouse.move(a0.x, a0.y); await page.mouse.down(); await page.mouse.move(a2.x, a2.y, { steps: 6 }); await page.mouse.up();
  await page.waitForTimeout(150);
  ok('16. a drag across three words selects them', (await page.locator('.choose-word.selected').count()) === 3, String(await page.locator('.choose-word.selected').count()));
  await clickWord(2);
  const n0 = await centre(3);
  await page.keyboard.down('Shift'); await page.mouse.click(n0.x, n0.y); await page.keyboard.up('Shift');
  await page.waitForTimeout(150);
  ok('17. shift-click on the next line carries the selection onto it', (await page.locator('.choose-word.selected').count()) === 2, String(await page.locator('.choose-word.selected').count()));
  await page.keyboard.press('Escape');
  // Owner, 30 Sep (M6 and M2 colours): used words are tinted per field and cleared when the film is read again.
  await page.getByRole('button', { name: 'Pick Scan ID on the film' }).click();
  await page.waitForTimeout(200);
  await clickWord(9); await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Pick Date of birth on the film' }).click(); await page.waitForTimeout(200);
  ok('18. a used word keeps a Scan ID tint', (await page.locator('.choose-word.used.f-id').count()) === 1, String(await page.locator('.choose-word.used').count()));
  await page.keyboard.press('Escape');
  const ft = page.locator('section[aria-label="Text on the film"]');
  await ft.getByRole('button', { name: 'Read the film again' }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Pick Date of birth on the film' }).click(); await page.waitForTimeout(200);
  ok('18. reading the film again clears the tints', (await page.locator('.choose-word.used').count()) === 0);
  // Final review: with Choose mode open, calibrating (K) still takes a click on a word as the ruler mark.
  await page.keyboard.press('k'); await page.waitForTimeout(150);
  await clickWord(9); await page.waitForTimeout(150);
  ok('19. a calibration click on a recognised word marks the ruler', (await page.locator('.place-hint').allInnerTexts()).join(' ').includes('second ruler mark'),
    (await page.locator('.place-hint').allInnerTexts()).join(' | '));
  // Review I-2 (16 Oct): with Choose mode open and both ruler marks down, a press on a mark that sits on a word drags
  // the mark; it never starts a word selection or re-reads the area.
  await clickWord(3); await page.waitForTimeout(150);                    // the second ruler mark, on "DEMO,"
  await page.waitForSelector('.calibrate-dialog');
  const pxA = async () => Number((await page.locator('.calibrate-dialog .hint').first().innerText()).match(/([\d.]+) px apart/)[1]);
  const pa0 = await pxA();
  await page.evaluate(() => { window.__calls = window.__calls.filter(([c]) => c !== 'library_read_area'); });
  const w3 = await words().nth(3).boundingBox();
  await page.mouse.move(w3.x + w3.width / 2, w3.y + w3.height / 2); await page.mouse.down();
  await page.mouse.move(w3.x + w3.width / 2 + 60, w3.y + w3.height / 2 + 40, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(200);
  ok('23. a ruler mark on a word drags in Choose mode (distance changed)', Math.abs((await pxA()) - pa0) > 5, `${pa0} -> ${await pxA()}`);
  ok('23. and selects no word and reads nothing', (await page.locator('.choose-word.selected').count()) === 0 && (await page.locator('.chooser').count()) === 0
    && !(await calls()).some(([c]) => c === 'library_read_area'));
  await page.getByRole('button', { name: 'Cancel' }).last().click().catch(() => {});
  await page.keyboard.press('Escape');
  // I2 (owner, 5 Oct): choosing a glued-scrap word as Film date must not let a re-read that drops the scrap save
  // the wrong date — the re-read answers "24-Jan-12" (the ")" dropped), which reads as a genuine 2012-01-24, but the
  // ORIGINAL words ")24-Jan-12" are a refused cut-year shape, so the choice must stay refused, not silently saved.
  await toLibrary();
  await importFile('cutyear-label.png');
  await page.waitForTimeout(300);
  const beforeDate = await field('Film date').inputValue();
  await page.evaluate(() => { window.__areaText = '24-Jan-12'; });
  await page.getByRole('button', { name: 'Pick Film date on the film' }).click();
  await clickWord(11);                                                                   // ")24-Jan-12"
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  ok('I2. a re-read that drops the scrap must not save the wrong Film date', (await field('Film date').inputValue()) === beforeDate,
    `${beforeDate} → ${await field('Film date').inputValue()}`);
  ok('I2. the hint shows the words aren’t a Film date',
    ((await page.locator('.place-hint').allInnerTexts()).join(' ')).includes('aren’t a Film date'),
    (await page.locator('.place-hint').allInnerTexts()).join(' | '));
  await page.evaluate(() => { window.__areaText = undefined; });
  await page.keyboard.press('Escape');
  // Owner, 16 Oct (PLACE-WINS): "Place U6" then a click on the film said "No text found here". With Choose mode open,
  // a point waiting to be placed takes the click: it is placed there, and no area is read.
  await page.getByRole('button', { name: 'Pick Date of birth on the film' }).click(); await page.waitForTimeout(200);
  ok('20. setup: Choose mode is open', (await words().count()) > 0, String(await words().count()));
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  const todo = page.locator('.lm-list li button').filter({ has: page.locator('.st.todo') }).first();
  const todoId = await todo.locator('b').innerText();
  await todo.click(); await page.waitForTimeout(150);
  ok('20. choosing an unplaced point while Choose mode is open shows "Click the film to place"',
    (await page.locator('.place-hint').allInnerTexts()).join(' ').includes(`Click the film to place ${todoId}`), (await page.locator('.place-hint').allInnerTexts()).join(' | '));
  await page.evaluate(() => { window.__calls = window.__calls.filter(([c]) => c !== 'library_read_area'); });
  const stage = await page.locator('.stage').boundingBox();
  await page.mouse.click(stage.x + stage.width * 0.5, stage.y + stage.height * 0.55); await page.waitForTimeout(300);
  const placedRow = page.locator('.lm-list li button').filter({ has: page.locator('b', { hasText: new RegExp(`^${todoId}$`) }) }).first();
  ok('20. the click places that point (placing wins over Choose mode)', (await placedRow.locator('.st.todo').count()) === 0, `${todoId}: ${await placedRow.innerText()}`);
  ok('20. and does not read that area of the film', !(await calls()).some(([c]) => c === 'library_read_area'));
  ok('20. Choose mode stays open for the details afterwards', (await words().count()) > 0, String(await words().count()));
  // Edge: a click ON a recognised word still places the waiting point, and selects no word.
  const todo2 = page.locator('.lm-list li button').filter({ has: page.locator('.st.todo') }).first();
  const todo2Id = await todo2.locator('b').innerText();
  await todo2.click(); await page.waitForTimeout(150);
  await clickWord(9); await page.waitForTimeout(300);
  const placed2 = page.locator('.lm-list li button').filter({ has: page.locator('b', { hasText: new RegExp(`^${todo2Id}$`) }) }).first();
  ok('21. a click on a word while a point waits places the point there', (await placed2.locator('.st.todo').count()) === 0, `${todo2Id}: ${await placed2.innerText()}`);
  ok('21. and selects no word', (await page.locator('.choose-word.selected').count()) === 0 && (await page.locator('.chooser').count()) === 0);
  // Review M-3: the hint says "Esc cancels" — Esc cancels the waiting point first, and leaves Choose mode open.
  await page.locator('.lm-list li button').filter({ has: page.locator('.st.todo') }).first().click(); await page.waitForTimeout(150);
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  ok('22. Esc while a point waits cancels the placing', !(await page.locator('.place-hint').allInnerTexts()).join(' ').includes('Click the film to place'),
    (await page.locator('.place-hint').allInnerTexts()).join(' | '));
  ok('22. and leaves Choose mode open', (await words().count()) > 0, String(await words().count()));
  await page.keyboard.press('Escape'); await page.waitForTimeout(150);

  // Final review Minor 1: in Choose mode, Enter must not write a film detail while the Report preview is open —
  // gated like the other keys (hasCaseRef), not left to depend on the preview's backdrop hiding the canvas.
  const dateBefore = await field('Film date').inputValue();
  await page.getByRole('button', { name: 'Pick Film date on the film' }).click();
  await page.waitForTimeout(200);
  await clickWord(6);                                                                     // "07/03/1990"
  await page.waitForTimeout(200);
  await page.getByRole('button', { name: 'Export ›' }).click();
  const reportPreview = page.locator('[role="dialog"][aria-label="Report preview"]');
  await reportPreview.waitFor();
  await page.waitForTimeout(300);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok('24. Enter does not write a film detail while the Report preview is open',
    (await field('Film date').inputValue()) === dateBefore, `${dateBefore} -> ${await field('Film date').inputValue()}`);
  await reportPreview.getByRole('button', { name: 'Close' }).click();
  await reportPreview.waitFor({ state: 'detached' });
  await page.waitForTimeout(200);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  ok('24 control. once the preview is closed, the same Enter still finishes the pick (so the check above is not vacuous)',
    (await field('Film date').inputValue()) === '07/03/1990' && dateBefore !== '07/03/1990', `${dateBefore} -> ${await field('Film date').inputValue()}`);

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
