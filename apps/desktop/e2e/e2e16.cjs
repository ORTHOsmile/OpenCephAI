// Patient panel and Text on the film (spec 2026-10-19 D/E): the built UI in Chromium with a stubbed Tauri runtime.
// SYNTHETIC only. Every PASS/FAIL line is also written to e2e/out/e2e16-report.txt (run.cjs prints a passing smoke as
// one count line only).
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const landmarks = Object.entries(base).map(([id,[x,y]]) => ({ id, x: x + 350, y: y + 300, confidence: 0.8 }));
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, landmarks }) => {
    const even = (text, bbox) => { const n = text.length; let i = 0;
      return { text, bbox, words: text.split(' ').map((w) => { const x = bbox[0] + (bbox[2] * i) / n; i += w.length + 1;
        return { text: w, bbox: [x, bbox[1], (bbox[2] * w.length) / n, bbox[3]] }; }) }; };
    const LINES = [even('Demo Radiology Northside', [0.03, 0.03, 0.36, 0.025]), even('PID 5566', [0.03, 0.07, 0.14, 0.025])];
    // A 'panel' film's label (Tasks 4, 5, 10, 11). Word numbers, top to bottom: MR 0, JOHN 1, DEMO 2 · Mrs 3 ·
    // Age: 4, 011Y 5 · (M) 6 · F 7 · Ref: 8, Dr 9, Demo 10, Referrer 11 · Sir 12 · 000Y 13 · M 14, F 15.
    const PANEL_LINES = [even('MR JOHN DEMO', [0.03, 0.03, 0.30, 0.025]), even('Mrs', [0.03, 0.07, 0.06, 0.025]),
      even('Age: 011Y', [0.03, 0.11, 0.16, 0.025]), even('(M)', [0.03, 0.15, 0.06, 0.025]), even('F', [0.03, 0.19, 0.03, 0.025]),
      even('Ref: Dr Demo Referrer', [0.03, 0.23, 0.36, 0.025]), even('Sir', [0.03, 0.27, 0.05, 0.025]),
      even('000Y', [0.03, 0.31, 0.07, 0.025]), even('M F', [0.03, 0.35, 0.05, 0.025])];
    window.__calls = [];
    window.__confirm = [];   // CF1-CF3: the commands a confirm gates, and the questions asked
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{}}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    let cb = 0;
    const ensureLibraryNo = (db, key, name) => {
      if (!name || !name.trim()) return;
      db.numbers = db.numbers || {}; db.nextLibraryNo = db.nextLibraryNo || 1;
      if (db.numbers[key]) return;
      db.numbers[key] = 'L-' + String(db.nextLibraryNo).padStart(5, '0'); db.nextLibraryNo++;
    };
    const libraryIdOf = (db, key) => (db.numbers || {})[key] ?? null;
    // Tasks MS-1…MS-6: puts every live case on one recognised machine, "Demo Radiology" (m1), with no scale yet.
    window.__seedMachine = () => {
      const db = load();
      db.machines = db.machines || {};
      db.machines.m1 = { id: 'm1', name: 'Demo Radiology', films: Object.values(db.cases).filter((c) => !c.deletedAt).length, learned: [], scale: null, scaleFilms: 0 };
      for (const c of Object.values(db.cases)) { c.machineId = 'm1'; c.machine = { id: 'm1', name: 'Demo Radiology' }; }
      store(db);
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        if (['library_delete', 'library_restore_backup', 'detect_landmarks', 'plugin:dialog|message'].includes(cmd)) window.__confirm.push([cmd, cmd.startsWith('plugin:dialog') ? { title: a.title, message: a.message } : a]);
        if (cmd.startsWith('library_set_') || cmd.startsWith('library_learn') || cmd === 'settings_set') window.__calls.push([cmd, a]);
        const linesOf = (id) => ((db.cases[id]?.path ?? '').includes('panel') ? PANEL_LINES : LINES);
        const patientOf = (c) => Object.values(db.cases).filter((o) => o.patientKey === c.patientKey);
        const onPatient = (c, k, v) => { for (const o of patientOf(c)) o[k] = v; };   // Gender, Referrer, Title: the patient's
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0, verifiedAt: null, deletedAt: null,
          patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true, libraryId: libraryIdOf(db, c.patientKey), formerLibraryIds: [], printedPatientId: c.patientId ?? null });
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'plugin:dialog|open': return a.options?.multiple ? [window.__nextPick] : window.__nextPick;   // real Tauri: an array only when multiple
          case 'plugin:dialog|message': return window.__dialogAnswer ?? 'Yes';   // final review M1: 'No' answers a warning No
          case 'plugin:event|listen': return 1;
          case 'detect_landmarks': return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
            timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks, facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9 };
          case 'library_list': return Object.values(db.cases).filter(() => !a.deleted).map(summary);
          case 'library_user_norms': return [];
          case 'operators_list': return { names: [], current: '' };
          case 'library_import': {
            // Path words: 'nodob' leaves DOB blank (Choose on the film opens by itself); 'unnamed' leaves the name blank.
            const id = 'c' + (Object.keys(db.cases).length + 1), name = a.path.includes('unnamed') ? '' : 'Demo Panel';
            db.cases[id] = { id, path: a.path, patientName: name, patientKey: name ? name.toLowerCase() : `unnamed ${id}`,
              dateOfBirth: a.path.includes('nodob') ? null : '1990-03-07', scanId: null,   // SYNTHETIC
              timepoint: 'T' + (Object.keys(db.cases).length + 1), takenOn: '2024-02-07', takenOnSource: 'label', facing: 'right', orientation: {}, display: {},
              spacingMm: null, verifiedAt: null, verifiedBy: null, landmarks: [], createdAt: now(), updatedAt: now(), deletedAt: null,
              identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [], gender: null, referringPractitioner: null,
              population: null, patientId: a.path.includes('ids') ? '5566' : null, xrayType: null, xraySize: null, radiographyPractice: null,
              title: null, ageOnFilm: null, ageOnFilmYears: null, machineId: null, machine: null, machineScale: null };
            ensureLibraryNo(db, db.cases[id].patientKey, name);
            store(db); return { caseId: id, created: true };
          }
          case 'library_read_label': { const c = db.cases[a.caseId];
            return { checked: true, issues: [], lines: linesOf(a.caseId), learnedFields: c.learnedFields, conflicts: [], suggestions: [] }; }
          case 'library_label_text': { const c = db.cases[a.caseId];
            // Final review I3: "Read the film again" on a film imported before its machine was learned matches it now
            // (library.rs `library_label_text`); a machine scale that applies moves its mm, so the store clears its
            // Tracing verified (MQ12). Only when the smoke asks for it (db.assignOnRead names the machine).
            if (db.assignOnRead && !c.machineId) { const m = db.machines[db.assignOnRead];
              Object.assign(c, { machineId: m.id, machine: { id: m.id, name: m.name }, machineScale: m.scale ? { ...m.scale, applies: true } : null });
              if (m.scale) Object.assign(c, { verifiedAt: null, verifiedBy: null }); store(db); }
            return { lines: structuredClone(linesOf(a.caseId)), suggestions: [] }; }
          case 'library_set_verified': { const c = db.cases[a.caseId];
            Object.assign(c, a.verified ? { verifiedAt: now(), verifiedBy: 'SYNTHETIC-operator' } : { verifiedAt: null, verifiedBy: null }); store(db); return null; }
          case 'library_learn_value': return true;
          case 'library_open': { const c = db.cases[a.caseId];
            const live = patientOf(c).filter((o) => !o.deletedAt);
            const self = libraryIdOf(db, c.patientKey);
            const libraryTrail = ((db.trails || {})[c.patientKey] || []).map((t) => JSON.parse(JSON.stringify(t).split('__SELF__').join(self)));
            return { ...c, printedPatientId: c.patientId ?? null, libraryId: self, idMatches: [], libraryTrail,
              patientIdsSeen: [...new Set(live.map((o) => o.patientId).filter((v) => v != null))],
              image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, updatedAt: now() }); store(db); return { updatedAt: c.updatedAt, verifiedAt: null }; }
          case 'library_set_meta': { const c = db.cases[a.caseId];
            Object.assign(c, a.meta, { patientKey: a.meta.patientName.trim() ? a.meta.patientName.trim().toLowerCase() : `unnamed ${c.id}` });
            ensureLibraryNo(db, c.patientKey, c.patientName); store(db); return null; }
          case 'library_set_patient_gender': onPatient(db.cases[a.caseId], 'gender', a.gender ?? null); store(db); return null;
          case 'library_set_patient_referrer': onPatient(db.cases[a.caseId], 'referringPractitioner', a.referringPractitioner?.trim() || null); store(db); return null;
          case 'library_set_patient_title': onPatient(db.cases[a.caseId], 'title', a.title?.trim() || null); store(db); return null;
          case 'library_set_film_age': { const c = db.cases[a.caseId];
            if ((a.printed == null) !== (a.years == null) || (a.years != null && !(a.years > 0 && a.years <= 120))) throw new Error("That isn't an age");
            c.ageOnFilm = a.printed?.trim() || null; c.ageOnFilmYears = a.years ?? null; store(db); return null; }
          case 'library_set_patient_id': { const c = db.cases[a.caseId]; c.patientId = a.patientId?.trim() || null; store(db); return null; }
          case 'library_delete': db.cases[a.caseId].deletedAt = now(); store(db); return null;
          // Tasks MS-1…MS-6: the machine scale (spec 2026-10-20).
          case 'library_machines': return Object.values(db.machines || {});
          case 'library_machine_scale_change': { const m = (db.machines || {})[a.machineId];
            const films = Object.values(db.cases).filter((c) => c.machineId === a.machineId && c.spacingMm == null && !c.deletedAt
              && ((m.scale && 1200 === m.scale.widthPx && 1400 === m.scale.heightPx) || (a.row && a.row.widthPx === 1200 && a.row.heightPx === 1400))).map((c) => c.id);
            return { films, fitted: [], deleted: 0 }; }
          case 'library_set_machine_scale': { const m = db.machines[a.machineId];
            m.scale = a.row ? { machineId: m.id, machineName: m.name, spacingMm: a.row.spacingMm, widthPx: a.row.widthPx, heightPx: a.row.heightPx,
              source: a.row.source === 'entered' ? 'entered' : 'film', sourceCaseId: null, sourceFilmDate: null, setAt: 'x', applies: false } : null;
            for (const c of Object.values(db.cases)) if (c.machineId === m.id) { c.machineScale = m.scale ? { ...m.scale, applies: true } : null; c.verifiedAt = null; }
            m.scaleFilms = m.scale ? Object.values(db.cases).filter((c) => c.machineId === m.id && c.spacingMm == null).length : 0;
            store(db); return { films: [], fitted: [], deleted: 0 }; }
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
  const exact = (label) => new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(Pick)?$');
  const field = (label) => page.locator('.case-panel label').filter({ has: page.locator(':scope > .label-row', { hasText: exact(label) }) }).locator('input, textarea');
  const box = async (label) => ((await field(label).count()) === 1 ? field(label).inputValue() : null);
  const calls = () => page.evaluate(() => window.__calls.map(([c, a]) => `${c}:${JSON.stringify(a)}`));
  const patientSec = page.locator('section[aria-label="Patient"]');
  const patientHead = () => patientSec.locator('.section-head button.toggle').evaluate((b) => b.textContent);   // textContent: no CSS capitals
  const clickWord = async (n, shift = false) => {
    const b = await page.locator('.choose-word').nth(n).boundingBox();
    if (shift) await page.keyboard.down('Shift');
    await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    if (shift) await page.keyboard.up('Shift');
  };
  const selectWords = async (from, to = from) => { await clickWord(from); if (to !== from) await clickWord(to, true); };
  const chooser = page.locator('.chooser select');
  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  // ---- Task 1: the Patient fold (owner D1, P3) ----
  await importFile('fold1-ids.png');
  ok('P1. the PATIENT heading is a fold, open by default', (await patientSec.locator('h2 button.toggle[aria-expanded="true"]').count()) === 1);
  ok('P1 control. open, the patient boxes and "Compare populations…" show', (await field('Patient').count()) === 1
    && (await patientSec.getByRole('button', { name: 'Compare populations…' }).count()) === 1);
  await patientSec.locator('.section-head button.toggle').click(); await page.waitForTimeout(200);
  ok('P2. folded, everything from the Patient box down to "Compare populations…" is hidden',
    (await patientSec.locator('input, select, textarea').count()) === 0 && (await patientSec.getByRole('button', { name: 'Compare populations…' }).count()) === 0
    && (await patientSec.locator('.library-line').count()) === 0);
  ok('P3. folded, the heading reads "Patient · L-0000n"', /^▸Patient · L-\d{5}$/.test(await patientHead()), await patientHead());
  ok('P3. shown in capitals, like the other headings', (await patientSec.locator('.section-head button.toggle').evaluate((b) => getComputedStyle(b).textTransform)) === 'uppercase');
  ok('P5. folding is saved on this Mac', (await calls()).some((c) => c === 'settings_set:{"key":"patient_open","value":"0"}'), (await calls()).join(' | '));
  await toLibrary();
  await importFile('fold2-unnamed.png');
  ok('P4. another film opens folded too', (await patientSec.locator('h2 button.toggle[aria-expanded="false"]').count()) === 1);
  ok('Edge (R7). an unnamed patient\'s folded heading says it has no Library ID yet', (await patientHead()) === '▸Patient · no Library ID yet', await patientHead());
  await page.evaluate(() => { window.__patientSeen = false;
    new MutationObserver(() => { if (document.querySelector('section[aria-label="Patient"] input')) window.__patientSeen = true; })
      .observe(document.body, { childList: true, subtree: true }); });
  const openPanelFilm = async () => { await page.getByRole('button', { name: 'Open Demo Panel T1' }).click(); await page.waitForSelector('g.landmark[data-id="S"]'); };
  await toLibrary(); await openPanelFilm(); await page.waitForTimeout(300);
  ok('P4. reopening a film: still folded, and it never flashed open', (await page.evaluate(() => window.__patientSeen)) === false
    && (await patientSec.locator('h2 button.toggle[aria-expanded="false"]').count()) === 1);
  await page.reload(); await page.waitForSelector('.library');
  await openPanelFilm();
  ok('P4. after a restart it is still folded', (await patientSec.locator('h2 button.toggle[aria-expanded="false"]').count()) === 1);
  await page.getByRole('button', { name: 'Superimposition ›' }).click(); await page.waitForSelector('.case-panel');
  const supToggle = patientSec.locator('.section-head button.toggle');
  await supToggle.click(); await page.waitForTimeout(200);
  ok('P6. on the read-only Superimposition page it still opens (it hides, never edits)', (await supToggle.getAttribute('aria-expanded')) === 'true'
    && (await field('Patient').count()) === 1 && (await field('Scan ID').count()) === 1);
  await page.getByRole('button', { name: '‹ Tracing' }).click(); await page.waitForSelector('.case-panel');
  ok('P7. opened again, every box is back', (await field('Patient').count()) === 1 && (await field('Scan ID').count()) === 1
    && (await patientSec.getByRole('button', { name: 'Compare populations…' }).count()) === 1);
  await patientSec.getByRole('button', { name: 'Compare populations…' }).click();
  ok('Edge. "Compare populations…" still opens its window', (await page.getByRole('dialog').count()) >= 1);
  await page.keyboard.press('Escape');

  // ---- Task 2: the Library ID fold (owner D2) ----
  await toLibrary();
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.trails = { 'demo panel': [{ kind: 'merged', number: 'L-00090', into: '__SELF__', on: '2026-10-17' }] };
    db.settings.patient_open = '1'; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.reload(); await page.waitForSelector('.library');
  await importFile('lib1-ids.png');                                     // "Demo Panel", Patient ID 5566, one trail line
  const libFold = page.locator('.library-fold'), libHead = libFold.locator('.library-line');
  ok('F1. the Library ID heading is closed by default and reads "Library ID L-0000n"', (await libHead.getAttribute('aria-expanded')) === 'false'
    && /^▸Library ID L-\d{5}$/.test(await libHead.evaluate((b) => b.textContent)), await libHead.evaluate((b) => b.textContent));
  ok('F1. closed, neither the Patient IDs nor the trail show', (await libFold.locator('.library-ids, .library-trail').count()) === 0);
  const fontOf = (l) => l.evaluate((e) => { const s = getComputedStyle(e); return `${s.fontFamily}|${s.fontSize}|${s.fontWeight}`; });
  await libHead.click(); await page.waitForTimeout(150);
  ok('F2. open: "Patient IDs on this patient\'s X-rays: 5566" and the trail', (await libFold.locator('.library-ids').innerText()) === "Patient IDs on this patient's X-rays: 5566"
    && JSON.stringify(await libFold.locator('.library-trail li').allInnerTexts()) === JSON.stringify(['L-00090 was merged into this patient on 17/10/2026.']));
  ok('F5. same font and size as the lines it folds', (await fontOf(libHead)) === (await fontOf(libFold.locator('.library-ids'))),
    `${await fontOf(libHead)} vs ${await fontOf(libFold.locator('.library-ids'))}`);
  await toLibrary(); await importFile('lib2-unnamed.png');
  ok('F3. nothing to fold (no IDs, no trail): no triangle', (await page.locator('.library-fold button').count()) === 0
    && (await page.locator('.library-line').innerText()) === 'Library ID: given once the patient has a name');
  await toLibrary(); await page.getByRole('button', { name: 'Open Demo Panel T1' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('F4 (R8). another film opens with the fold closed again', (await page.locator('.library-fold .library-line').getAttribute('aria-expanded')) === 'false');
  await page.getByRole('button', { name: 'Superimposition ›' }).click(); await page.waitForSelector('.case-panel');
  await page.locator('.library-fold .library-line').click(); await page.waitForTimeout(150);
  ok('F6. on the read-only Superimposition page it still opens', (await page.locator('.library-fold .library-ids').count()) === 1);
  await page.getByRole('button', { name: '‹ Tracing' }).click(); await page.waitForSelector('.case-panel');

  // ---- Task 3: one list (owner E) ----
  await toLibrary(); await importFile('list-panel-ids.png');
  const whatOpts = await page.locator('section[aria-label="Text on the film"]').getByLabel('What line 1 is', { exact: true }).locator('option').allInnerTexts();
  ok('E1. the panel drop-down lists the owner\'s order', JSON.stringify(whatOpts) === JSON.stringify(['—', 'Title', 'Full name', 'Last name', 'First name(s)', 'DOB', 'Age',
    'Gender', 'Film date', 'Scan ID', 'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice', 'Referring practitioner']), JSON.stringify(whatOpts));

  // ---- Task 4: the chooser on the X-ray is a drop-down (owner E) ----
  await toLibrary(); await importFile('chooser-panel-nodob.png');       // no DOB: Choose on the film opens by itself
  await page.waitForSelector('.choose-word');
  await selectWords(7);                                                 // "F"
  const chooserOpts = await chooser.locator('option').allInnerTexts();
  ok('C1. the chooser is one drop-down with the same list as the panel', (await page.locator('.chooser button:not([aria-label="Cancel"])').count()) === 0
    && JSON.stringify(chooserOpts) === JSON.stringify(['Use as…', 'Title', 'Full name', 'Last name', 'First name(s)', 'DOB', 'Age', 'Gender', 'Film date', 'Scan ID',
      'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice', 'Referring practitioner']), JSON.stringify(chooserOpts));
  const panelSelectH = await page.locator('section[aria-label="Text on the film"] select').first().evaluate((e) => e.getBoundingClientRect().height);
  const chooserH = await chooser.evaluate((e) => e.getBoundingClientRect().height);
  ok('C1. the size of the panel\'s drop-down', Math.abs(chooserH - panelSelectH) <= 2, `${chooserH} vs ${panelSelectH}`);
  await page.evaluate(() => { window.__calls = []; });
  await chooser.selectOption('gender'); await page.waitForTimeout(300);
  ok('C2. Gender chosen on the film saves on the patient', (await calls()).some((c) => c.startsWith('library_set_patient_gender:') && c.includes('"gender":"F"')), (await calls()).join(' | '));
  await selectWords(8, 11);                                             // "Ref: Dr Demo Referrer"
  await chooser.selectOption('referrer'); await page.waitForTimeout(300);
  ok('C2. Referring practitioner chosen on the film saves "Dr Demo Referrer"', (await calls()).some((c) => c.startsWith('library_set_patient_referrer:') && c.includes('"referringPractitioner":"Dr Demo Referrer"')), (await calls()).join(' | '));
  await selectWords(12);                                                // "Sir"
  await page.evaluate(() => { window.__calls = []; });
  await chooser.selectOption('gender'); await page.waitForTimeout(200);
  ok('C3. a line that is not F or M is refused with the panel\'s words, and nothing is saved',
    (await page.locator('.place-hint', { hasText: "That line isn't F or M" }).count()) === 1 && (await calls()).length === 0, (await calls()).join(' | '));
  await selectWords(7);
  await chooser.focus(); await page.keyboard.press('Escape'); await page.waitForTimeout(150);
  ok('C4 (R9). Esc on the drop-down closes it and keeps Choose mode', (await page.locator('.chooser').count()) === 0 && (await page.locator('.choose-word').count()) > 0);
  await selectWords(7); await page.locator('.chooser').getByRole('button', { name: 'Cancel' }).click();
  ok('C4. ✕ (Cancel) does the same', (await page.locator('.chooser').count()) === 0 && (await page.locator('.choose-word').count()) > 0);

  // ---- Task 5: "(M)" is M (owner E) ----
  await selectWords(6); await page.evaluate(() => { window.__calls = []; });
  await chooser.selectOption('gender'); await page.waitForTimeout(300);
  ok('G1. "(M)" chosen as Gender saves M', (await calls()).some((c) => c.startsWith('library_set_patient_gender:') && c.includes('"gender":"M"')), (await calls()).join(' | '));
  await selectWords(14, 15); await page.evaluate(() => { window.__calls = []; });
  await chooser.selectOption('gender'); await page.waitForTimeout(200);
  ok('G2 (R4). "M F" is refused and saves nothing', (await calls()).length === 0, (await calls()).join(' | '));

  // ---- Task 10: Title (owner T1) ----
  await toLibrary(); await importFile('title-panel-nodob.png'); await page.waitForSelector('.choose-word');
  ok('T1. the panel drop-down and the chooser both start "—/Use as…, Title, Full name"',
    JSON.stringify((await page.locator('section[aria-label="Text on the film"]').getByLabel('What line 1 is', { exact: true }).locator('option').allInnerTexts()).slice(0, 3)) === JSON.stringify(['—', 'Title', 'Full name']));
  await page.evaluate(() => { window.__calls = []; });
  await selectWords(0, 2); await chooser.selectOption('name'); await page.waitForTimeout(400);   // "MR JOHN DEMO" as Full name
  const tc = await calls();
  const iMeta = tc.findIndex((c) => c.startsWith('library_set_meta:') && c.includes('"patientName":"John Demo"'));   // SYNTHETIC
  const iTitle = tc.findIndex((c) => c.startsWith('library_set_patient_title:') && c.includes('"title":"Mr"'));
  ok('T2 (R5). "MR JOHN DEMO" chosen as Full name: name "John Demo", then Title "Mr"', iMeta >= 0 && iTitle > iMeta, tc.join(' | '));
  ok('T3. the Title box shows Mr, before the name', (await box('Title')) === 'Mr'
    && (await field('Title').evaluate((e) => e.getBoundingClientRect().left)) < (await field('Patient').evaluate((e) => e.getBoundingClientRect().left)));
  await selectWords(3); await chooser.selectOption('title'); await page.waitForTimeout(300);
  ok('T4. "Mrs" chosen as Title on the film saves Mrs', (await box('Title')) === 'Mrs');
  await field('Title').fill('Sir'); await field('Title').press('Tab'); await page.waitForTimeout(200);
  ok('T5. an unrecognised title is refused with the owner\'s words; the box goes back', (await page.getByText("That isn't a title (Mr, Mrs, Ms, Miss, Master, Dr…)").count()) >= 1
    && (await box('Title')) === 'Mrs');
  await field('Title').fill('dr.'); await field('Title').press('Tab'); await page.waitForTimeout(200);
  ok('T6. typed "dr." is kept as typed', (await box('Title')) === 'dr.');
  await field('Title').fill(''); await field('Title').press('Tab'); await page.waitForTimeout(200);
  ok('T6. blank clears it', (await box('Title')) === '');

  // ---- Task 11: Age (owner AG1) ----
  await toLibrary(); await importFile('age-panel-nodob.png'); await page.waitForSelector('.choose-word');
  await selectWords(4, 5); await chooser.selectOption('age'); await page.waitForTimeout(300);   // "Age: 011Y"
  ok('A1. "Age: 011Y" chosen on the film: the box reads 011Y, the line says no DOB', (await box('Age')) === '011Y'
    && (await page.locator('.age-line').innerText()) === 'Age 11 y (printed on the film or typed; no DOB)', await page.locator('.age-line').innerText());
  await selectWords(13); await page.evaluate(() => { window.__calls = []; }); await chooser.selectOption('age'); await page.waitForTimeout(200);
  ok('A2. "000Y" is refused with the owner\'s words and saves nothing', (await page.getByText("That isn't an age").count()) >= 1 && (await calls()).length === 0);
  await field('Age').fill('11 y 3 m'); await field('Age').press('Tab'); await page.waitForTimeout(200);
  ok('A3. typed "11 y 3 m" shows as 11 y 3 m', (await page.locator('.age-line').innerText()) === 'Age 11 y 3 m (printed on the film or typed; no DOB)');
  await field('Age').fill('121'); await field('Age').press('Tab'); await page.waitForTimeout(200);
  ok('A4. typed 121 is refused; the box goes back', (await box('Age')) === '11 y 3 m');
  await field('Date of birth').fill('02/01/2014'); await field('Date of birth').press('Tab'); await page.waitForTimeout(300);   // SYNTHETIC DOB
  ok('A5. with a DOB the box goes and the age is worked out to the scan date', (await field('Age').count()) === 0
    && (await page.locator('.age-line').innerText()) === 'Age 10 y 1 m at the scan (from the DOB)', await page.locator('.age-line').innerText());
  ok('A5. the film\'s age, over a year away, is noted', (await page.locator('.age-note').innerText()) === 'The film says 11 y 3 m; DOB gives 10 y 1 m at the scan date.',
    await page.locator('.age-note').innerText());

  // ---- Tasks MS-1…MS-6: a calibrated scale per X-ray machine (spec 2026-10-20) ----
  await toLibrary(); await importFile('ms-film.png'); await page.evaluate(() => window.__seedMachine()); await toLibrary();
  await page.locator('details.film-layouts > summary').click();
  // Deviation from the brief's literal `.filter({ hasText: 'Demo Radiology' })`: the machine's name lives only in
  // its rename input's accessible name (`aria-label="Name of …"`), never as plain text in the row — the same
  // reason e2e5.cjs (Task 7 X9's own Film layouts checks) locates a machine by `getByRole('textbox', { name: … })`,
  // never by `hasText`. `hasText` matches `textContent`, which an `<input>`'s value is not part of, so the literal
  // locator hangs (confirmed: it timed out waiting on `.machine-scale` because `row` matched zero elements).
  const row = page.locator('.film-layouts li').filter({ has: page.getByRole('textbox', { name: 'Name of Demo Radiology' }) });
  ok('MS1. Film layouts shows "No calibrated scale"', (await row.locator('.machine-scale').innerText()) === 'No calibrated scale');
  page.once('dialog', (d) => d.accept());
  await row.getByRole('button', { name: 'Enter scale…' }).click();
  await row.getByLabel('mm per pixel').fill('0.0998'); await row.getByLabel('Width (px)').fill('1200'); await row.getByLabel('Height (px)').fill('1400');
  await row.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(300);
  ok('MS1. typed: the scale, its size, "entered value" and the films using it', /^Scale 0\.0998 mm\/px for 1200 × 1400 px films, entered value · used by \d+ films?$/.test(await row.locator('.machine-scale').innerText()),
    await row.locator('.machine-scale').innerText());
  await page.getByRole('button', { name: /^Open Demo Panel/ }).first().click(); await page.waitForSelector('g.landmark[data-id="S"]');
  // Deviation from the brief's literal `{ name: /Measures/ }`: the tab's accessible name is "Measurements" (the
  // Inspector's own label, unchanged by this task), which that regex does not match ("Measures" is not a substring
  // of "Measurements") — every other smoke clicks the exact label 'Measurements' (e2e10, e2e13, e2e14, e2e15,
  // e2e17, e2e18, e2e3, e2e11). Confirmed: with the literal regex the click silently failed (caught), the tab
  // stayed on Landmarks, and `.scale-line` (which only renders on the Measurements tab) never appeared, timing out.
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('MS3. the film\'s scale line names the machine', (await page.locator('.scale-line').innerText()).includes('0.0998 mm/px, calibrated scale (machine: Demo Radiology, entered value)'),
    await page.locator('.scale-line').innerText());
  await toLibrary(); await page.locator('details.film-layouts > summary').click();
  const undoBtn = () => row.getByRole('button', { name: 'Undo' });
  const scaleText = () => row.locator('.machine-scale').innerText();
  ok('MS4 (final review I4). leaving the Library page closed Film layouts, so its Undo is gone', (await undoBtn().count()) === 0);
  const enter = async (mm) => { await row.getByRole('button', { name: 'Enter scale…' }).click();
    await row.getByLabel('mm per pixel').fill(mm); await row.getByLabel('Width (px)').fill('1200'); await row.getByLabel('Height (px)').fill('1400');
    await row.getByRole('button', { name: 'Save' }).click(); await page.waitForTimeout(300); };
  await enter('0.1010');
  ok('MS4. Undo is offered after a change while Film layouts stays open', (await undoBtn().count()) === 1 && (await scaleText()).startsWith('Scale 0.1010 mm/px'), await scaleText());
  await page.evaluate(() => { window.__dialogAnswer = 'No'; });
  await undoBtn().click(); await page.waitForTimeout(300);
  ok('MS4 (final review M1). No to the Undo warning: nothing changes and Undo is still offered', (await undoBtn().count()) === 1 && (await scaleText()).startsWith('Scale 0.1010 mm/px'), await scaleText());
  await page.evaluate(() => { window.__dialogAnswer = 'Yes'; });
  if (await undoBtn().count()) { await undoBtn().click(); await page.waitForTimeout(300); }   // M1 broken: no Undo left to press (the next check FAILs)
  ok('MS4. Undo puts back the value before the last change (0.0998), then is gone', (await undoBtn().count()) === 0 && (await scaleText()).startsWith('Scale 0.0998 mm/px'), await scaleText());
  await enter('0.1020');
  await page.locator('details.film-layouts > summary').click(); await page.waitForTimeout(150);
  await page.locator('details.film-layouts > summary').click(); await page.waitForTimeout(300);
  ok('MS4. closing Film layouts forgets its Undo (closed then reopened)', (await undoBtn().count()) === 0 && (await scaleText()).startsWith('Scale 0.1020 mm/px'), await scaleText());

  // ---- Re-review N2: restoring a backup discards any Undo in Film layouts (App.tsx restore `finally { libraryReplaced() }`) ----
  await enter('0.1030');
  ok('N2 control. a change leaves Undo offered, before restoring a backup', (await undoBtn().count()) === 1 && (await scaleText()).startsWith('Scale 0.1030 mm/px'), await scaleText());
  await page.evaluate(() => { window.__nextPick = '/Users/demo/backup-20261026'; window.__dialogAnswer = 'Yes'; });
  await page.getByRole('button', { name: 'Restore…' }).click();
  await page.waitForTimeout(300);
  ok('N2. restoring a backup discards the Undo', (await undoBtn().count()) === 0, await scaleText());

  // ---- Final review I3: a re-read that gives the OPEN film a machine scale holds its sign-off (V3) ----
  await importFile('i3-panel.png');                                      // imported with no machine (a film from before machines were learned)
  const i3 = await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); const ids = Object.keys(db.cases); const id = ids[ids.length - 1];
    Object.assign(db.cases[id], { verifiedAt: '2026-10-25T00:00:00.000Z', verifiedBy: 'SYNTHETIC Dr Demo' }); db.assignOnRead = 'm1';
    localStorage.setItem('fakeLib', JSON.stringify(db)); return { id, tp: db.cases[id].timepoint }; });
  await toLibrary(); await page.getByRole('button', { name: `Open Demo Panel ${i3.tp}` }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('I3 control. the film opens signed off, with no machine scale', (await page.locator('.verified-note').count()) === 1);
  await page.locator('section[aria-label="Text on the film"]').getByRole('button', { name: /^Read the film( again)?$/ }).click();
  await page.waitForTimeout(600);
  const i3db = await page.evaluate((id) => JSON.parse(localStorage.getItem('fakeLib')).cases[id], i3.id);
  ok('I3 control. the store gave it the machine and cleared its sign-off', i3db.machineId === 'm1' && !i3db.verifiedAt);
  ok('I3. the screen shows the cleared sign-off, held: "The mm changed — check, then mark verified."',
    (await page.locator('.verified-note').count()) === 0 && (await page.locator('.hold-line').count()) === 1
    && (await page.locator('.hold-line').innerText()) === 'The mm changed — check, then mark verified.');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('I3. the screen shows the new scale', (await page.locator('.scale-line').innerText()).includes('calibrated scale (machine: Demo Radiology'), await page.locator('.scale-line').innerText());

  // ---- CF1-CF3 (the smoke gap): the three confirms that gate a destructive action. For each, "No" must change
  // nothing and "Yes" must do it. Synthetic films only. ----
  const confirmLog = () => page.evaluate(() => window.__confirm.map(([c, a]) => `${c}:${JSON.stringify(a)}`));
  const confirmCount = async (cmd) => (await confirmLog()).filter((x) => x.startsWith(cmd + ':')).length;
  await toLibrary();
  await page.evaluate(() => { window.__confirm = []; window.__dialogAnswer = 'No'; });
  await page.locator('button.card-action.del').first().click(); await page.waitForTimeout(300);
  ok('CF1. Delete case asks first, by its own title', (await confirmLog()).some((x) => x.includes('"title":"Delete case"')), (await confirmLog()).join(' | '));
  ok('CF1. No to Delete case: nothing is deleted', (await confirmCount('library_delete')) === 0, (await confirmLog()).join(' | '));
  await page.evaluate(() => { window.__dialogAnswer = 'Yes'; });
  await page.locator('button.card-action.del').first().click(); await page.waitForTimeout(300);
  ok('CF1. Yes to Delete case: library_delete runs once', (await confirmCount('library_delete')) === 1, (await confirmLog()).join(' | '));

  await page.evaluate(() => { window.__confirm = []; window.__nextPick = '/Users/demo/SYNTHETIC-backup-CF'; window.__dialogAnswer = 'No'; });
  await page.getByRole('button', { name: 'Restore…' }).click(); await page.waitForTimeout(300);
  ok('CF2. Restore backup asks first, by its own title', (await confirmLog()).some((x) => x.includes('"title":"Restore backup"')), (await confirmLog()).join(' | '));
  ok('CF2. No to Restore backup: the library is not replaced', (await confirmCount('library_restore_backup')) === 0, (await confirmLog()).join(' | '));
  await page.evaluate(() => { window.__dialogAnswer = 'Yes'; });
  await page.getByRole('button', { name: 'Restore…' }).click(); await page.waitForTimeout(300);
  ok('CF2. Yes to Restore backup: library_restore_backup runs once, with the chosen folder',
    (await confirmCount('library_restore_backup')) === 1 && (await confirmLog()).some((x) => x.includes('SYNTHETIC-backup-CF')), (await confirmLog()).join(' | '));

  await importFile('cf-replace.png');
  const cfC = async (id) => { const b = await page.locator(`g.landmark[data-id="${id}"] circle, g.landmark[data-id="${id}"] rect`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const cfStart = await cfC('S');
  await page.mouse.move(cfStart.x, cfStart.y); await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(cfStart.x + 30 * i / 8, cfStart.y); await page.mouse.up();   // a moved point: now one the clinician edited
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.__confirm = []; window.__dialogAnswer = 'No'; });
  await page.getByRole('button', { name: 'Replace all…' }).click(); await page.waitForTimeout(400);
  ok('CF3. Replace all asks first, naming the points that will be replaced', (await confirmLog()).some((x) => x.includes('"title":"Replace all points"') && x.includes('1 point you placed')), (await confirmLog()).join(' | '));
  ok('CF3. No to Replace all: no new detection runs', (await confirmCount('detect_landmarks')) === 0, (await confirmLog()).join(' | '));
  await page.evaluate(() => { window.__dialogAnswer = 'Yes'; });
  await page.getByRole('button', { name: 'Replace all…' }).click(); await page.waitForTimeout(600);
  ok('CF3. Yes to Replace all: a new detection runs once', (await confirmCount('detect_landmarks')) === 1, (await confirmLog()).join(' | '));

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  fs.mkdirSync(__dirname + '/out', { recursive: true });
  fs.writeFileSync(__dirname + '/out/e2e16-report.txt', results.join('\n') + '\n');
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => {
  // A crash or timeout mid-run must not hide the FAIL lines already collected — print and save them before exiting.
  console.error(e);
  if (results.length) {
    fs.mkdirSync(__dirname + '/out', { recursive: true });
    fs.writeFileSync(__dirname + '/out/e2e16-report.txt', results.join('\n') + '\n');
    console.log(results.join('\n'));
  }
  process.exit(2);
});
