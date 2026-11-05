// Patient identity + Compare smoke: the built UI in Chromium with a stubbed Tauri runtime and a fake library in
// localStorage. SYNTHETIC image, names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const landmarks = Object.entries(base).map(([id,[x,y]]) => ({ id, x: x + 350, y: y + 300, confidence: 0.8 }));
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const shot = (page, n) => page.screenshot({ path: `${__dirname}/out/id-${n}.png` });

const FILM_LINES_TEXT = ['Demo Radiology Northside', 'DEMO, Synthetic', 'M, Y34', 'DOB 07/03/1990 SYNTHETIC', 'PID 5566', 'Se: Feb 07, 2024 01:36 PM', 'Im: 1/1'].join('\n');
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, landmarks }) => {
    const FILM_LINES_RAW = ['Demo Radiology Northside', 'DEMO, Synthetic', 'M, Y34', 'DOB 07/03/1990 SYNTHETIC', 'PID 5566', 'Se: Feb 07, 2024 01:36 PM', 'Im: 1/1'];
    const FILM_LINES = FILM_LINES_RAW.map((text) => ({ text, bbox: [0, 0, 0, 0], words: [] }));
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: async (t) => { window.__copied.push(t); } } });
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{},"compare":{}}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    const key = (n) => n.toLowerCase().trim();
    const tpFor = (db, c) => 'T' + (Object.values(db.cases).filter((x) => x.id !== c.id && x.patientKey === c.patientKey && x.dateOfBirth === c.dateOfBirth).length + 1);
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: c.landmarks.filter((l) => !l.verified).length,
          verifiedAt: c.verifiedAt, deletedAt: c.deletedAt, patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: c.identityChecked,
          libraryId: null, formerLibraryIds: [], printedPatientId: null });
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'plugin:dialog|open': return window.__nextPicks ?? [window.__nextPick];
          // `ask()` (@tauri-apps/plugin-dialog) invokes 'plugin:dialog|message', never 'plugin:dialog|ask' — fix
          // round 1 (Task 10 review M2): the dead `case 'plugin:dialog|ask'` that used to sit here never matched
          // anything real; corrected. Nothing in this smoke clicks an `ask()`-gated action (grep: none).
          case 'plugin:dialog|message': return 'Yes';
          case 'plugin:event|listen': return 1;
          case 'detect_landmarks': return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
            timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks, facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9 };
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map(summary);
          case 'library_import': {
            // An unused id (Task 12): the count alone collided with a case planted by hand (c9) and overwrote it.
            let n = Object.keys(db.cases).length + 1; while (db.cases['c' + n]) n++;
            const id = 'c' + n, stem = a.path.split('/').pop().replace('.png', '');
            // 19's noattempt-label case tests the film-text read failing, not the Patient-name flow, so it is given a
            // name at import — leaving it blank would also land it in the Review queue's "Name needed" count (12).
            const named = stem.startsWith('noattempt-label');
            db.cases[id] = { id, path: a.path, patientName: named ? 'Demo Noattempt' : '', patientKey: named ? 'demo noattempt' : '~' + id, dateOfBirth: null, scanId: null, timepoint: 'T1', takenOn: null,
              facing: 'right', orientation: {}, display: {}, spacingMm: null, verifiedAt: null, verifiedBy: null, landmarks: [], createdAt: now(), updatedAt: now(),
              deletedAt: null, identitySource: 'manual', identityChecked: true, identityIssues: [], takenOnSource: 'import', learnedFields: [],
              gender: null, referringPractitioner: null,
              // Task 5 (D2): the real CaseDoc always carries these; a stub without them has the panel read undefined.
              libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [] };
            db.cases[id].takenOn = now().slice(0, 10);
            store(db); return { caseId: id, created: true };
          }
          case 'library_read_label': {
            if (a.caseId && db.cases[a.caseId].path.includes('slow')) await new Promise((r) => setTimeout(r, 1500));
            const db2 = load(); const c = db2.cases[a.caseId], f = c.path.split('/').pop();
            // 19. "Not read yet": a film whose read_label call fails entirely (not merely finding no text) — the
            // Promise rejects, useCase's readFilmText().catch(() => null) fills nothing, and filmText stays null.
            if (f.startsWith('noattempt-label')) throw new Error('synthetic read failure');
            if (f.startsWith('clear-label')) Object.assign(c, { patientName: 'Demo Synthetic', patientKey: 'demo synthetic', dateOfBirth: '1990-03-07',   // SYNTHETIC
              takenOn: '2024-01-10', takenOnSource: 'label', scanId: '4471', identitySource: 'film', identityChecked: true, identityIssues: [] });
            else if (f.startsWith('conflict-label')) Object.assign(c, { patientName: 'Demo Synthetic', patientKey: 'demo synthetic', dateOfBirth: '1991-03-07',   // SYNTHETIC
              takenOn: '2026-09-12', takenOnSource: 'label', identitySource: 'film', identityChecked: false,
              identityIssues: [{ kind: 'sameNameOtherBirth', patient: { name: 'Demo Synthetic', dateOfBirth: '1990-03-07' } }] });   // SYNTHETIC
            else Object.assign(c, { identitySource: 'manual', identityChecked: false, identityIssues: [{ kind: 'nameNotRead' }, { kind: 'noDateOfBirth' }] });
            c.timepoint = tpFor(db2, c); store(db2);
            return { checked: c.identityChecked, issues: c.identityIssues, lines: f.startsWith('clear-label') ? FILM_LINES : [], learnedFields: [], conflicts: [], suggestions: [] };
          }
          // window.__secondReading lets a test give a DIFFERENT re-read (e.g. line 2 changed), so a full re-read
          // ("Read the film again") has something to refresh while an edited line's original stays put.
          case 'library_label_text': return window.__secondReading
            ? { lines: window.__secondReading.map((text) => ({ text, bbox: [0, 0, 0, 0], words: [] })), suggestions: [] }
            : { lines: FILM_LINES, suggestions: [] };
          case 'library_confirm_identity': {
            const c = db.cases[a.caseId];
            if (a.sameAs) { Object.assign(c, { patientName: a.sameAs.name, patientKey: key(a.sameAs.name), dateOfBirth: a.sameAs.dateOfBirth }); c.timepoint = tpFor(db, c); }
            Object.assign(c, { identityChecked: true, identitySource: 'manual', identityIssues: [] }); store(db); return null;
          }
          case 'library_open': {
            // Final-review fix round, Important 1: models a slow back end (the real condition behind the Gender/
            // Referrer save race — Tauri's `with` is spawn_blocking + Mutex, so two saves' `library_open` replies can
            // arrive in either order) by answering this call late while window.__slowOpen is set.
            if (window.__slowOpen) await new Promise((r) => setTimeout(r, 300));
            const c = db.cases[a.caseId];
            // Gender and referrer live on the patient row in the real database (ceph-store's `patients` table), so a
            // film imported AFTER the patient's gender was set still shows it. This fake library keeps a copy per
            // case instead of a shared row, so resolve against any sibling case's copy at open time (found debugging
            // this smoke on the Mac, 2026-10-04: c2 was imported after c1's gender was set and never got a copy).
            const sib = Object.values(db.cases).find((o) => o.id !== c.id && o.patientKey === c.patientKey && (o.gender != null || o.referringPractitioner != null));
            return { ...c, gender: sib ? sib.gender : c.gender, referringPractitioner: sib ? sib.referringPractitioner : c.referringPractitioner,
              image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id];
            Object.assign(c, { facing: a.edit.facing, orientation: a.edit.orientation, display: a.edit.display, landmarks: a.edit.landmarks, updatedAt: now() });
            store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_set_meta': Object.assign(db.cases[a.caseId], a.meta, { patientKey: a.meta.patientName.trim() ? key(a.meta.patientName) : '~' + a.caseId, identityChecked: !!a.meta.patientName.trim(), identitySource: 'manual', identityIssues: [] });
            store(db); return null;
          case 'library_confirm_film_date': db.cases[a.caseId].takenOnSource = 'manual'; store(db); return null;
          case 'library_series': { const me = db.cases[a.caseId];
            return Object.values(db.cases).filter((c) => !c.deletedAt && (c.id === me.id || (!me.patientKey.startsWith('~') && c.patientKey === me.patientKey
              && (c.dateOfBirth === me.dateOfBirth || !c.dateOfBirth || !me.dateOfBirth))))
              .map((c) => ({ id: c.id, timepoint: c.timepoint, takenOn: c.takenOn, takenOnSource: c.takenOnSource, createdAt: c.createdAt, stage: c.stage ?? null, inSeries: c.inSeries ?? true })); }
          case 'library_set_stage': db.cases[a.caseId].stage = a.stage; store(db); return null;
          case 'library_set_in_series': db.cases[a.caseId].inSeries = a.on; store(db); return null;
          // Split into two single-field saves (final-review fix round, Important 1): each writes only its own
          // column patient-wide, so one can never carry a stale value of the other back over an edit landing
          // meanwhile.
          case 'library_set_patient_gender': { const c = db.cases[a.caseId];
            for (const o of Object.values(db.cases)) if (o.patientKey === c.patientKey) o.gender = a.gender;
            store(db); return null; }
          case 'library_set_patient_referrer': { const c = db.cases[a.caseId];
            for (const o of Object.values(db.cases)) if (o.patientKey === c.patientKey) o.referringPractitioner = a.referringPractitioner?.trim() || null;
            store(db); return null; }
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          // Task 12: a batch import with a slow extra model. Only while window.__batchStub is set (the smoke's other
          // checks keep the old null answers): the extra model answers late and past its limit, as Rust does (15 s,
          // MODEL-LIMIT-1; shortened here), the main run is saved and every run with points is recorded.
          case 'detect_extras': if (!window.__batchStub) return null;
            await new Promise((r) => setTimeout(r, 700));
            return [{ modelId: 'gu2net-isbi19', title: 'GU2Net', detection: null, timedOut: true,
              error: 'GU2Net took longer than 15 s on this film; its points were not used.' }];
          case 'library_save_ai_if_untraced': { if (!window.__batchStub) return null;
            const c = db.cases[a.edit.id]; if (c.landmarks.length) return false;
            c.landmarks = a.edit.landmarks; store(db); return true; }
          case 'library_record_ai': { if (!window.__batchStub) return null;
            db.runs = db.runs || []; db.runs.push({ caseId: a.caseId, modelId: a.run.modelId }); store(db); return null; }
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
  // Fix round 1 (G Task 9): a bare timepoint is no longer unique text inside a whole <li> — a film's "not scaled"
  // advice can name ANOTHER film's timepoint too ("…scale it to T1?") — so match the series-label itself.
  const keyLine = (tp) => page.locator('.series-key li').filter({ has: page.locator('.series-label', { hasText: new RegExp('^' + tp + ' ') }) });
  // Film details Task 7 (C3): the label is matched EXACTLY on its title row, so "Patient" never also finds "Patient ID".
  const exact = (label) => new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(Pick)?$');
  const field = (label) => page.locator('.case-panel label').filter({ has: page.locator(':scope > .label-row', { hasText: exact(label) }) }).locator('input, textarea');
  // The Inspector switches to its Change tab in a useEffect once the comparison is ready, which lands a beat after
  // the overlay's compare groups are drawn: wait for the Change table itself before reading it (found debugging
  // this smoke on the Mac, 2026-10-04: without it, the table is read mid-switch and comes back empty).
  const changeShown = () => page.waitForFunction(() =>
    [...document.querySelectorAll('.inspector table.measures thead th')].some((th) => th.textContent === 'Change'));

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  await importFile('clear-label.png');
  ok('1. a clear label fills name, date of birth and scan ID', (await field('Patient').inputValue()) === 'Demo Synthetic'
    && (await field('Date of birth').inputValue()) === '07/03/1990' && (await field('Scan ID').inputValue()) === '4471');   // SYNTHETIC
  ok('1. with "Read from the film" and no prompt', (await page.locator('.identity-note').innerText()).includes('Read from the film')
    && (await page.locator('.identity-check').count()) === 0);
  await shot(page, '1-clear');
  const ft = page.locator('section[aria-label="Text on the film"]');
  const what = (n) => ft.getByLabel(`What line ${n} is`, { exact: true });
  ok('10. Text on the film is its own section, open, with a row per line', (await ft.locator('.film-line').count()) === 7
    && (await ft.locator('.film-line').nth(1).inputValue()) === 'DEMO, Synthetic');
  // 19. Spreadsheet-style table (owner, 5 Oct): a one-line header, and no row's cells wider than the section.
  const headBox = await ft.locator('thead th').first().boundingBox();
  // A one-line header at this font and padding measures about 20px; a genuine wrap to 2-3 lines (the owner's
  // screenshot) would measure 32px+. 24 safely separates the two without hard-coding the exact line height.
  ok('19. the table header is one line', headBox.height < 24, `height=${headBox.height}`);
  const sectionBox1 = await ft.boundingBox();
  const rowRights = await ft.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => tr.getBoundingClientRect().right));
  ok("19. no row's cells overflow the section", rowRights.every((r) => r <= sectionBox1.x + sectionBox1.width + 1), JSON.stringify(rowRights));
  ok('10. the saved name and DOB show against their lines', (await what(2).inputValue()) === 'name' && (await what(4).inputValue()) === 'dob');
  await what(5).selectOption('scan'); await page.waitForTimeout(300);
  ok('10. choosing Scan ID for "PID 5566" fills Scan ID', (await field('Scan ID').inputValue()) === '5566', await field('Scan ID').inputValue());
  await what(4).selectOption('name'); await page.waitForTimeout(200);
  ok('10. a date line chosen as Patient says so and changes nothing', (await ft.locator('.hint.warn').innerText()) === "That line isn't a name"
    && (await field('Patient').inputValue()) === 'Demo Synthetic' && (await what(4).inputValue()) === 'dob');
  ok('19. the per-row Copy button is the ⧉ icon, titled "Copy"', (await ft.getByRole('button', { name: 'Copy line 5' }).innerText()) === '⧉'
    && (await ft.getByRole('button', { name: 'Copy line 5' }).getAttribute('title')) === 'Copy');
  await ft.getByRole('button', { name: 'Copy all' }).click();
  await ft.getByRole('button', { name: 'Copy line 5' }).click();
  const copied = await page.evaluate(() => window.__copied);
  ok('10. Copy all and the per-row ⧉ icon put the text on the clipboard', copied[0] === FILM_LINES_TEXT && copied[1] === 'PID 5566', JSON.stringify(copied));
  // 19. a very long synthetic line wraps fully visible: no internal (vertical) overflow and no horizontal overflow.
  const LONG_LINE = 'SYNTHETIC ' + 'longword '.repeat(30) + 'end';
  await ft.getByLabel('Line 1', { exact: true }).fill(LONG_LINE);
  await page.waitForTimeout(100);
  const longMetrics = await ft.getByLabel('Line 1', { exact: true }).evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, scrollWidth: el.scrollWidth, clientWidth: el.clientWidth }));
  const longBox = await ft.getByLabel('Line 1', { exact: true }).boundingBox();
  const sectionBox2 = await ft.boundingBox();
  ok('19. a very long line wraps fully visible with no scrollbar and no overflow of the section',
    longMetrics.scrollHeight <= longMetrics.clientHeight + 1 && longMetrics.scrollWidth <= longMetrics.clientWidth + 1
    && longBox.x + longBox.width <= sectionBox2.x + sectionBox2.width + 1, JSON.stringify(longMetrics));
  // M4 (owner, 5 Oct): autosize only recalcs on React re-render, so narrowing the PANEL itself (a pure CSS/DOM
  // resize, with no React state change and so no re-render of FilmText) used to leave the long line's height at the
  // old, wider-layout value, cutting off the extra wrapped rows the narrower width now needs. A ResizeObserver on
  // the table must recalc it even though React never re-rendered. The width is changed directly on the DOM (not via
  // any React-driving interaction), so only a ResizeObserver — not an incidental re-render — can catch it.
  const ftSection = page.locator('section[aria-label="Text on the film"]');
  await ftSection.evaluate((el) => { el.style.maxWidth = '160px'; el.style.width = '160px'; });
  await page.waitForTimeout(250);
  const narrowMetrics = await ft.getByLabel('Line 1', { exact: true }).evaluate((el) => ({ scrollHeight: el.scrollHeight, clientHeight: el.clientHeight, clientWidth: el.clientWidth }));
  ok('M4. the long line is still shown whole after the panel narrows, with no row re-render of its own',
    narrowMetrics.scrollHeight <= narrowMetrics.clientHeight + 1, JSON.stringify(narrowMetrics));
  await ftSection.evaluate((el) => { el.style.maxWidth = ''; el.style.width = ''; });
  await page.waitForTimeout(200);
  await ft.locator('tbody tr').first().getByRole('button', { name: "Use the film's text for line 1" }).click();
  ok('19. undo restores the long-line edit', (await ft.getByLabel('Line 1', { exact: true }).inputValue()) === 'Demo Radiology Northside');
  // M3 (owner, 5 Oct): the cell is a spreadsheet cell, not a free-text box — Enter must not add a newline, and a
  // pasted multi-line value is flattened to spaces.
  const line1 = ft.getByLabel('Line 1', { exact: true });
  await line1.click();
  await line1.press('End');
  await line1.press('Enter');
  await page.waitForTimeout(100);
  ok('M3. Enter does not add a newline to a film line', (await line1.inputValue()) === 'Demo Radiology Northside', JSON.stringify(await line1.inputValue()));
  await line1.evaluate((el, text) => {
    el.setSelectionRange(el.value.length, el.value.length);   // caret at the true end (End alone stops at the visual, wrapped line)
    const dt = new DataTransfer(); dt.setData('text/plain', text);
    const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
    el.dispatchEvent(ev);
  }, 'First line\nSecond line\nThird');
  await page.waitForTimeout(100);
  ok('M3. a pasted multi-line value has its newlines replaced by spaces',
    (await line1.inputValue()) === 'Demo Radiology NorthsideFirst line Second line Third', JSON.stringify(await line1.inputValue()));

  // N (owner, 6 Oct): newlines still got in by a paste of a BARE "\r" (no "\n" — onPaste's own regex required one),
  // by drag-and-drop (no dedicated onDrop handler: the browser inserts the text itself, then fires a native "input"
  // event with no "paste" event at all), and by Ctrl+O (an Emacs-style "insert newline" binding some browsers honour
  // in a textarea, which "Enter" alone does not catch). onChange now strips CR/LF on every path, in one place.
  // A synthetic (script-dispatched) ClipboardEvent is not "trusted", so headless Chromium never performs the
  // browser's own default paste insertion for it — the existing M3 paste check above only ever worked because
  // onPaste's handler does the insertion itself (preventDefault + a manual value rebuild), so a bare "\r" that hits
  // onPaste's early-return `if (!/\r?\n/.test(text)) return;` is simply a no-op in THIS harness, not a leaked "\r":
  // a check built on a synthetic paste event here could not fail for the gap it claims to test (a guard that cannot
  // fail is the same defect as a test that cannot fail). Both the bare "\r" and the drop are instead simulated the
  // way the browser itself would land them — set the native value, then fire a real "input" event — so they land
  // on onChange exactly as a real paste or drop would, bypassing onPaste's own (narrower) regex entirely.
  await line1.evaluate((el) => { el.value += 'Bare\rReturn'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(100);
  const afterBareCr = await line1.inputValue();
  ok('N. a bare "\\r" (no "\\n") landing in the value (e.g. from a paste) is replaced by a space',
    !/[\r\n]/.test(afterBareCr) && afterBareCr.includes('Bare Return'), JSON.stringify(afterBareCr));

  await line1.evaluate((el) => { el.value += 'Dropped\r\nText'; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(100);
  const afterDrop = await line1.inputValue();
  ok('N. text dropped in (simulated: native value set + "input" event) has its CR/LF replaced by spaces',
    !/[\r\n]/.test(afterDrop) && afterDrop.includes('Dropped Text'), JSON.stringify(afterDrop));

  // Edge case: Enter used to CONFIRM an IME candidate (isComposing true on the native event) must not be blocked —
  // only a plain, non-composing Enter is a spreadsheet-cell "do nothing".
  const imeEnterPrevented = await line1.evaluate((el) => {
    const ev = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true });
    el.dispatchEvent(ev);
    return ev.defaultPrevented;
  });
  ok('N. Enter during IME composition is NOT blocked (isComposing true)', imeEnterPrevented === false, String(imeEnterPrevented));

  await ft.locator('tbody tr').first().getByRole('button', { name: "Use the film's text for line 1" }).click();   // restore for later checks
  await what(3).selectOption('gender'); await page.waitForTimeout(300);
  // Owner, 5 Oct: "Not recorded" wrapped onto two lines; the third choice reads N/A, with "Not recorded" on hover.
  const genderChoices = await page.getByRole('radiogroup', { name: 'Gender' }).getByRole('radio').allInnerTexts();
  ok('13. the Gender choices read Female, Male, N/A (hover: Not recorded)', JSON.stringify(genderChoices) === '["Female","Male","N/A"]'
    && (await page.getByRole('radio', { name: 'N/A', exact: true }).getAttribute('title')) === 'Not recorded', JSON.stringify(genderChoices));
  ok('13. "M, Y34" chosen as Gender sets Male', (await page.getByRole('radio', { name: 'Male', exact: true }).getAttribute('aria-checked')) === 'true');
  await ft.getByLabel('Line 7', { exact: true }).fill('Ref: Dr Demo'); await what(7).selectOption('referrer'); await page.waitForTimeout(300);
  ok('13. an edited line chosen as Referring practitioner fills it without its label', (await page.getByLabel('Referring practitioner', { exact: true }).inputValue()) === 'Dr Demo');
  ok('13. the import day shows under the table', /Imported \d\d\/\d\d\/\d{4}/.test(await ft.innerText()));
  await shot(page, '10-film-text');

  // Fix round 2 (owner's rule, approved in chat 5 Oct): a line the owner edited is never overwritten by a re-read;
  // only unedited lines refresh. POSITIVE CONTROL (run on 943fbd3, saved to fix2-report.md): the old keepEdits
  // replaced every edit whenever the new reading wasn't an exact prefix match, so this very check FAILED there.
  await ft.getByLabel('Line 1', { exact: true }).fill('SYNTHETIC edited line');
  const SECOND_READING = ['Demo Radiology Northside', 'DEMO, Synthetic TWO', 'M, Y34', 'DOB 07/03/1990 SYNTHETIC', 'PID 5566', 'Se: Feb 07, 2024 01:36 PM', 'Im: 1/1'];
  await page.evaluate((lines) => { window.__secondReading = lines; }, SECOND_READING);
  await ft.getByRole('button', { name: 'Read the film again' }).click();
  await page.waitForTimeout(300);
  ok('16. a full re-read keeps the edited line AND refreshes the one that changed',
    (await ft.getByLabel('Line 1', { exact: true }).inputValue()) === 'SYNTHETIC edited line'
    && (await ft.getByLabel('Line 2', { exact: true }).inputValue()) === 'DEMO, Synthetic TWO',
    `line1=${await ft.getByLabel('Line 1', { exact: true }).inputValue()} line2=${await ft.getByLabel('Line 2', { exact: true }).inputValue()}`);

  await ft.locator('tr.film-row').nth(0).getByRole('button', { name: /Use the film's text for line/ }).click();
  ok("17. ↺ on the edited row restores the film's text", (await ft.getByLabel('Line 1', { exact: true }).inputValue()) === 'Demo Radiology Northside');

  await ft.getByLabel('Line 3', { exact: true }).fill('SYNTHETIC gone edit');
  const THIRD_READING = SECOND_READING.filter((l) => l !== 'M, Y34');
  await page.evaluate((lines) => { window.__secondReading = lines; }, THIRD_READING);
  await ft.getByRole('button', { name: 'Read the film again' }).click();
  await page.waitForTimeout(300);
  // The "Your edit" note now spans the full row width in its own row under the data row (owner's table design, 5 Oct).
  const lastRow = ft.locator('tr.film-row').last();
  const lastNote = ft.locator('tr.film-note-row').last();
  ok('18. an edited line whose original is gone stays at the end with the "Your edit" note',
    (await lastRow.locator('.film-line').inputValue()) === 'SYNTHETIC gone edit'
    && (await lastNote.innerText()).includes("Your edit — this line wasn't in the latest reading"));
  await lastRow.getByRole('button', { name: /Remove your edit for line/ }).click();
  ok('18. its ↺ removes the kept row instead of restoring text', (await ft.locator('tr.film-row').count()) === THIRD_READING.length);

  // Leftovers T8: a note sits under its own row. Two "Your edit" rows, each with a note, survive a re-read with
  // their notes; ↺ on the first removes it and the second's note moves up with its row (before the fix it stayed
  // at the old index, one row too low, under the wrong row).
  await ft.getByLabel('Line 2', { exact: true }).fill('SYNTHETIC edit A');
  await ft.getByLabel('Line 3', { exact: true }).fill('SYNTHETIC edit B');
  await ft.getByLabel('What line 2 is', { exact: true }).selectOption('dob');
  await ft.getByLabel('What line 3 is', { exact: true }).selectOption('gender');
  await page.waitForTimeout(200);
  const FOURTH_READING = ['Demo Radiology Northside', 'PID 5566', 'Se: Feb 07, 2024 01:36 PM', 'Im: 1/1'];
  await page.evaluate((lines) => { window.__secondReading = lines; }, FOURTH_READING);
  await ft.getByRole('button', { name: 'Read the film again' }).click();
  await page.waitForTimeout(300);
  const under = (n) => ft.locator('tr.film-row').nth(n).locator('xpath=following-sibling::tr[1]');
  ok('18b. a re-read keeps each "Your edit" row with its own note',
    (await ft.locator('tr.film-row').count()) === FOURTH_READING.length + 2
    && (await under(4).innerText()).includes("isn't a date") && (await under(5).innerText()).includes("isn't F or M"),
    `${await under(4).innerText()} | ${await under(5).innerText()}`);
  await ft.locator('tr.film-row').nth(4).getByRole('button', { name: /Remove your edit for line/ }).click();
  await page.waitForTimeout(200);
  ok('18b. ↺ on the first removes it and the second\'s note sits directly under its row',
    (await ft.locator('tr.film-row').count()) === FOURTH_READING.length + 1
    && (await ft.locator('tr.film-row').nth(4).locator('.film-line').inputValue()) === 'SYNTHETIC edit B'
    && (await under(4).innerText()).includes("isn't F or M") && !(await ft.innerText()).includes("isn't a date"),
    await ft.innerText());
  // Leftovers T8 fix round 1: an edited row that stays in place keeps its note on a re-read (18d); ↺ on an edited row
  // that is NOT kept leaves the row, drops only its own note, and leaves the others where they were (18c).
  await ft.getByLabel('Line 1', { exact: true }).fill('SYNTHETIC edit C');
  await ft.getByLabel('What line 1 is', { exact: true }).selectOption('dob');
  await page.waitForTimeout(200);
  await ft.getByRole('button', { name: 'Read the film again' }).click();
  await page.waitForTimeout(300);
  ok('18d. an edited row that stays in place keeps its note on a re-read',
    (await ft.locator('tr.film-row').count()) === FOURTH_READING.length + 1
    && (await ft.locator('tr.film-row').nth(0).locator('.film-line').inputValue()) === 'SYNTHETIC edit C'
    && (await under(0).innerText()).includes("isn't a date") && (await under(4).innerText()).includes("isn't F or M"),
    `${await under(0).innerText()} | ${await under(4).innerText()}`);
  await ft.locator('tr.film-row').nth(0).getByRole('button', { name: "Use the film's text for line 1" }).click();
  await page.waitForTimeout(200);
  ok('18c. ↺ on an edited (not kept) row: the row stays, its note goes, the others are unchanged',
    (await ft.locator('tr.film-row').count()) === FOURTH_READING.length + 1
    && (await ft.locator('tr.film-row').nth(0).locator('.film-line').inputValue()) === FOURTH_READING[0]
    && !(await ft.innerText()).includes("isn't a date") && (await under(4).innerText()).includes("isn't F or M"),
    await ft.innerText());
  await page.evaluate(() => { window.__secondReading = undefined; });

  await toLibrary();
  await importFile('conflict-label.png');
  const same = page.getByRole('button', { name: 'Same patient: Demo Synthetic · 07/03/1990' });   // SYNTHETIC
  ok('2. a conflicting date of birth brings up Check patient details', (await page.locator('.identity-check').count()) === 1 && (await same.count()) === 1);
  await shot(page, '2-conflict');
  await same.click();
  await page.waitForSelector('.identity-check', { state: 'detached' });
  ok('2. "Same patient" clears the prompt', (await page.locator('.identity-check').count()) === 0);
  await toLibrary();
  // Owner decision, 29 Oct 2026: the PATIENTS sidebar list is gone (Library ▸ Table replaces it) — the merge is
  // checked through the search box instead, which still finds both of the merged patient's films by name or DOB.
  await page.getByLabel('Search the library').fill('Demo Synthetic');
  await page.waitForFunction(() => document.querySelectorAll('.cards .card').length === 2);
  ok('2. the merge leaves one patient, "Demo Synthetic", with 2 cases', (await page.locator('.cards .card').count()) === 2);   // SYNTHETIC
  await page.getByLabel('Search the library').fill('07/03/1990');
  ok('2b. searching the DOB also finds both', (await page.locator('.cards .card').count()) === 2);   // SYNTHETIC
  await page.getByLabel('Search the library').fill('');
  // Review I2 (29 Oct): the merge must unify the PATIENT (name key and DOB, what the Library groups on), not only copy
  // the DOB. Library ▸ Table ▸ Grouped shows one row per patient: after "Same patient" there is exactly one "Demo
  // Synthetic" row, holding both films. (Before the merge the two films were two patients: different DOBs.)
  await page.getByRole('radio', { name: 'Table' }).click();
  await page.locator('table.lib-table').waitFor();
  if ((await page.getByRole('radio', { name: 'Grouped' }).getAttribute('aria-checked')) !== 'true') await page.getByRole('radio', { name: 'Grouped' }).click();
  const merged = await page.locator('table.lib-table tbody tr.lib-patient button.lib-toggle', { hasText: 'Demo Synthetic' }).evaluateAll((bs) => bs.map((b) => b.getAttribute('aria-label')));
  ok('2c. the merge leaves ONE patient group, "Demo Synthetic", holding both films', merged.length === 1 && merged[0] === 'Demo Synthetic, 2 films', merged.join(' | '));   // SYNTHETIC
  await page.getByRole('radio', { name: 'Pictures' }).click();
  await page.locator('.cards').waitFor();

  await page.getByRole('radio', { name: 'MM/DD/YYYY' }).click();
  await page.getByLabel('Search the library').fill('03/07/1990');
  await page.waitForFunction(() => document.querySelectorAll('.cards .card').length === 2);
  ok('3. US dates: searching "03/07/1990" finds both of the merged patient\'s films', (await page.locator('.cards .card').count()) === 2);   // SYNTHETIC
  await page.getByLabel('Search the library').fill('');
  await page.locator('.cards .card .open').first().click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('3. and the case panel shows 03/07/1990', (await field('Date of birth').inputValue()) === '03/07/1990');   // SYNTHETIC
  await toLibrary();
  await page.getByRole('radio', { name: 'DD/MM/YYYY' }).click();

  await page.locator('.cards .card .open').first().click(); await page.waitForSelector('g.landmark[data-id="S"]');
  await field('Date of birth').fill('31/02/2020'); await field('Date of birth').press('Enter');   // SYNTHETIC: an impossible date, to check it is refused
  ok('4. an impossible date is refused and the old one kept', (await page.locator('.sidebar .error').innerText()).includes('Type dates as DD/MM/YYYY.')
    && (await field('Date of birth').inputValue()) === '07/03/1990');   // SYNTHETIC

  await toLibrary();
  await importFile('noattempt-label.png');
  const ftNone = page.locator('section[aria-label="Text on the film"]');
  ok('19. a film whose label read failed entirely shows "Not read yet."', (await ftNone.locator('.film-text-unread').innerText()) === 'Not read yet.');
  await ftNone.getByRole('button', { name: 'Read the film' }).click();
  await page.waitForTimeout(300);
  ok('19. "Read the film" from Not-read-yet reads the text', (await ftNone.locator('.film-line').count()) === 7);

  await toLibrary();
  await importFile('unread-label.png');
  ok('12. a film whose name could not be read leaves Patient blank and highlighted', (await field('Patient').inputValue()) === ''
    && (await page.locator('.case-panel label.needs', { hasText: 'Patient' }).count()) === 1
    && (await field('Patient').getAttribute('placeholder')) === 'Type the patient’s name');
  ok('12. Check patient details offers "Type the name", not "Details are right"', (await page.getByRole('button', { name: 'Type the name' }).count()) === 1
    && (await page.getByRole('button', { name: 'Details are right' }).count()) === 0);
  await shot(page, '12-blank-name');
  const note = page.locator('.case-panel .identity-note', { hasText: 'Import date' });
  ok('9. a film with no label or file date shows "Import date — please check"', (await note.count()) === 1);
  await note.getByRole('button', { name: 'OK' }).click();
  await page.waitForTimeout(300);
  ok('9. OK accepts it and the note goes', (await page.locator('.case-panel .identity-note', { hasText: 'Import date' }).count()) === 0);
  await toLibrary();
  await page.locator('.lib-nav button', { hasText: 'Review queue' }).click();
  ok('5. an unchecked case is in the Review queue with a Check details chip', (await page.locator('.card .lib-chip.check').count()) === 1);
  ok('12. its card reads "Name needed"', (await page.locator('.card b.needs').allInnerTexts()).join() === 'Name needed');
  await shot(page, '5-review');
  await page.locator('.cards .card', { has: page.locator('.lib-chip.check') }).locator('.open').click(); await page.waitForSelector('g.landmark[data-id="S"]');
  const ft2 = page.locator('section[aria-label="Text on the film"]');
  ok('11. a film with no text says so and offers Read the film again', (await ft2.innerText()).includes('No text was found on the film.'));
  await ft2.getByRole('button', { name: 'Read the film again' }).click();
  await page.waitForTimeout(300);
  ok('11. Read the film again shows the text', (await ft2.locator('.film-line').count()) === 7);
  await ft2.getByLabel('What line 6 is', { exact: true }).selectOption('date');
  await page.waitForTimeout(300);
  ok('11. the Film date button reads "Se: Feb 07, 2024 01:36 PM" as 07/02/2024', (await field('Film date').inputValue()) === '07/02/2024', await field('Film date').inputValue());
  await toLibrary();

  // Open the T2 scan (c2): the same patient's T1 (c1) joins the comparison by itself (spec 2026-09-30).
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await page.locator('.cards .card .open', { hasText: 'T2' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('14. Gender and Referrer show on the same patient\'s other film', (await page.getByRole('radio', { name: 'Male', exact: true }).getAttribute('aria-checked')) === 'true'
    && (await page.getByLabel('Referring practitioner', { exact: true }).inputValue()) === 'Dr Demo');

  // 15. Final review, Important 1 (verified): the Gender/Referrer save race. Today `set_patient_details(case,
  // gender, referrer)` overwrites BOTH fields, filling the untouched one from the screen as last rendered. Leaving
  // the Referrer box (blur) then clicking a Gender radio right away — no wait between — sends {gender: OLD,
  // ref: NEW} then {gender: NEW, ref: OLD}; the order of arrival is not guaranteed, so one edit is silently lost.
  // library_open answers slowly (window.__slowOpen, set above) so the race shows up reliably rather than by luck.
  await page.evaluate(() => { window.__slowOpen = true; });
  await page.getByLabel('Referring practitioner', { exact: true }).fill('Dr Race');
  await page.getByLabel('Referring practitioner', { exact: true }).press('Tab');       // blur: commits the referrer
  await page.getByRole('radio', { name: 'Female', exact: true }).click();              // straight away: no wait
  await page.waitForTimeout(500);
  ok('15. leaving Referrer then clicking Gender right after saves BOTH',
    (await page.getByRole('radio', { name: 'Female', exact: true }).getAttribute('aria-checked')) === 'true'
    && (await page.getByLabel('Referring practitioner', { exact: true }).inputValue()) === 'Dr Race',
    `gender=${await page.getByRole('radio', { name: 'Female', exact: true }).getAttribute('aria-checked')} ref=${await page.getByLabel('Referring practitioner', { exact: true }).inputValue()}`);
  await toLibrary();
  await page.locator('.cards .card .open', { hasText: 'T2' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('15. … and both are still saved after reopening the case',
    (await page.getByRole('radio', { name: 'Female', exact: true }).getAttribute('aria-checked')) === 'true'
    && (await page.getByLabel('Referring practitioner', { exact: true }).inputValue()) === 'Dr Race');
  await page.evaluate(() => { window.__slowOpen = false; });

  await page.locator('section[aria-label="Text on the film"] .section-head button').click();
  ok('14. Text on the film closes from its heading', (await page.locator('section[aria-label="Text on the film"] .film-text').count()) === 0);
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('svg.overlay g.compare');
  await changeShown();
  // Review M-4 (16 Oct): with the Change tab there are five tabs; they still fit on one line.
  const tabTops5 = await page.locator('.inspector .tabs [role="tab"]').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
  ok('M4. all five tabs (with Change) fit on one line', tabTops5.length === 5 && new Set(tabTops5).size === 1, JSON.stringify(tabTops5));
  const keyLines = await page.locator('.series-key .series-label').allInnerTexts();
  ok('6. the comparison key lists the same patient\'s T1 first ("T1 · 10/01/2024")', keyLines[0] === 'T1 · 10/01/2024', keyLines.join(' | '));
  ok('6. it draws the comparison and a Change tab with rows', (await page.getByRole('tab', { name: 'Change' }).count()) === 1
    && (await page.locator('.inspector table.measures tbody tr').count()) > 0);
  await shot(page, '6-compare');
  // 19. locked (read-only) case + reopened: the Superimposition page passes readOnly down to CasePanel, so reopening
  // Text on the film there shows the table again (reopened) with its controls disabled (locked).
  await page.locator('section[aria-label="Text on the film"] .section-head button').click();
  const ft3 = page.locator('section[aria-label="Text on the film"]');
  await ft3.locator('.film-text').waitFor();
  ok('19. reopening the section from its heading shows its content again', (await ft3.locator('.film-text').count()) === 1);
  // M6 (owner, 5 Oct): this used to branch on hasRows3 at runtime and assert only whichever branch happened to be
  // true — a guard that cannot fail, since it never checks that the branch it SKIPPED was the right one to skip.
  // T2's film text is never read in this flow (no importFile/'Read the film' call reaches c2 before this point),
  // so the fixed expected state is the EMPTY branch; asserting the row count directly makes that a real check that
  // would fail if the fixture or the app ever changed so T2 arrived here with rows.
  ok('19. T2’s film text was never read in this flow: the fixed, no-rows state', (await ft3.locator('.film-line').count()) === 0);
  ok('19. on Superimposition (read-only) "Read the film again" is disabled too', await ft3.getByRole('button', { name: /Read the film/ }).isDisabled());
  await page.locator('section[aria-label="Text on the film"] .section-head button').click();   // close again: later checks expect it closed
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('svg.overlay g.compare');
  ok('6. leaving and re-entering the page brings the comparison back', (await page.locator('svg.overlay g.compare').count()) === 1);
  await changeShown();
  const heads = async () => (await page.locator('.inspector table.measures thead th').allInnerTexts()).slice(1, 3);
  const h1 = await heads();
  ok('6. the Change table reads forward: T1 (older film) first, then T2', h1[0].startsWith('T1') && h1[1].startsWith('T2'), h1.join(' | '));
  // Owner, 30 Sep: two films dated only by the day they were imported used to tie, and the open one (T2) came first.
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib'));
    for (const id of ['c1', 'c2']) Object.assign(db.cases[id], { takenOn: '2026-09-30', takenOnSource: 'import' });
    localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.getByRole('button', { name: '‹ Tracing' }).click(); await toLibrary();
  await page.locator('.cards .card .open', { hasText: 'T2' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('14. … and stays closed on the next case', (await page.locator('section[aria-label="Text on the film"] .film-text').count()) === 0);
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('svg.overlay g.compare');
  await changeShown();
  const h2 = await heads();
  ok('6. with both films dated by the same import day, T1 is still first with T2 open', h2[0].startsWith('T1') && h2[1].startsWith('T2'), h2.join(' | '));

  // A same-patient scan with no S.
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); const c1 = db.cases.c1;
    db.cases.c9 = { ...c1, id: 'c9', timepoint: 'T3', takenOn: '2025-05-05', landmarks: c1.landmarks.filter((l) => l.id !== 'S') };
    localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.getByRole('button', { name: '‹ Tracing' }).click(); await toLibrary();
  await page.locator('.cards .card .open', { hasText: 'T2' }).first().click(); await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.series-key li:nth-child(3)');
  await page.waitForFunction(() => [...document.querySelectorAll('.series-key li')].some((l) => l.textContent.includes('Place S and N')));
  ok('7. a film without S says so in the key and is not drawn', (await keyLine('T3').innerText()).includes('Place S and N to draw it')
    && (await page.locator('svg.overlay g.compare[data-film="c9"]').count()) === 0);
  await shot(page, '7-no-s');
  // Final review, important 3: a multi-film import shows progress and blocks a second batch while labels are read.
  await page.getByRole('button', { name: '‹ Tracing' }).click(); await toLibrary();
  await page.evaluate(() => { window.__nextPicks = ['/Users/demo/slow-a.png', '/Users/demo/slow-b.png']; });
  await page.getByRole('button', { name: 'Import…' }).first().click();
  await page.waitForTimeout(500);
  const status = await page.locator('.lib-main [role="status"]').allInnerTexts();
  ok('8. while labels are read the Library says so and Import… is disabled', status.some((t) => t.startsWith('Reading label'))
    && await page.getByRole('button', { name: 'Import…' }).first().isDisabled(), JSON.stringify(status));
  await page.evaluate(() => { window.__nextPicks = undefined; });
  // Task 12 edge case: a batch import with a slow extra model never blocks the batch — every film is traced by the main
  // model, the slow model's (absent) points are not recorded, and the batch ends.
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Import…'); return b && !b.disabled; }, null, { timeout: 15000 });
  await page.evaluate(() => { window.__batchStub = true; window.__nextPicks = ['/Users/demo/batch-a.png', '/Users/demo/batch-b.png']; });
  const t12 = Date.now();
  await page.getByRole('button', { name: 'Import…' }).first().click();
  // The batch's films by their paths (this fake makes ids from the case count, and c9 was planted by hand above).
  const BATCH12 = ['/Users/demo/batch-a.png', '/Users/demo/batch-b.png'];
  await page.waitForFunction((ps) => { const d = JSON.parse(localStorage.getItem('fakeLib'));
    const added = Object.values(d.cases).filter((c) => ps.includes(c.path)); return added.length === 2 && added.every((c) => c.landmarks.length > 0); }, BATCH12, { timeout: 15000 }).catch(() => {});
  await page.waitForFunction(() => { const b = [...document.querySelectorAll('button')].find((x) => x.textContent.trim() === 'Import…'); return b && !b.disabled; }, null, { timeout: 15000 }).catch(() => {});
  const lib12 = await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')));
  const added12 = Object.values(lib12.cases).filter((c) => BATCH12.includes(c.path));
  ok('12-batch. a batch with a slow extra model finishes: both films traced by the main model',
    added12.length === 2 && added12.every((c) => c.landmarks.length > 0) && !(await page.getByRole('button', { name: 'Import…' }).first().isDisabled()),
    `${added12.map((c) => c.landmarks.length).join(',')} in ${Date.now() - t12} ms`);
  ok('12-batch. the slow model is recorded for neither film; the main model for both',
    (lib12.runs || []).filter((r) => r.modelId === 'gu2net-isbi19').length === 0 && (lib12.runs || []).filter((r) => r.modelId === 'SYNTHETIC-stub').length === 2,
    JSON.stringify(lib12.runs));
  await page.evaluate(() => { window.__batchStub = undefined; window.__nextPicks = undefined; });
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(2); });   // print the checks reached, so a crash still shows which failed
