// Film details smoke (spec 2026-10-17): the built UI in Chromium with a stubbed Tauri runtime. SYNTHETIC only.
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
    const LINES = [even('Demo Radiology Northside', [0.03, 0.03, 0.36, 0.025]), even('SMITH', [0.03, 0.07, 0.10, 0.025]),
      even('John', [0.03, 0.10, 0.08, 0.025]), even('DOB 07/03/1990 SYNTHETIC', [0.03, 0.13, 0.36, 0.025]),
      even('PID 5566', [0.03, 0.16, 0.14, 0.025]), even('LATERAL CEPH', [0.70, 0.90, 0.20, 0.025]), even('24 x 30 cm', [0.70, 0.93, 0.15, 0.025])];
    window.__calls = [];
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{}}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    let cb = 0;
    // Task 9 (D2): Patient ID is per-X-ray; Library ID is per-patient. `db.numbers` is the patient's own counter
    // (keyed by patientKey, a stand-in for the real per-patient row); `db.notSame` remembers "Not the same" answers
    // as [caseId, libraryId] pairs. Matching ignores case and spaces, never a near miss (owner L8).
    const normId = (s) => String(s).replace(/\s+/g, '').toLowerCase();
    const sameId = (a, b) => a != null && b != null && normId(a) === normId(b);
    const ensureLibraryNo = (db, key, name) => {
      if (!name || !name.trim()) return;
      db.numbers = db.numbers || {}; db.nextLibraryNo = db.nextLibraryNo || 1;
      if (db.numbers[key]) return;
      db.numbers[key] = 'L-' + String(db.nextLibraryNo).padStart(5, '0'); db.nextLibraryNo++;
    };
    const libraryIdOf = (db, key) => (db.numbers || {})[key] ?? null;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        if (cmd.startsWith('library_learn') || cmd.startsWith('library_set_') || cmd === 'library_accept_learned'
          || cmd === 'library_confirm_identity' || cmd === 'library_not_same_patient' || cmd === 'settings_set') window.__calls.push([cmd, a]);
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0, verifiedAt: null, deletedAt: null,
          patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true,
          // X6 (preflight): the same per-patient counter as library_open, so the Library search box (L5) can find a
          // card by Library ID or by any Patient ID on its patient's X-rays without opening each one first.
          libraryId: libraryIdOf(db, c.patientKey), formerLibraryIds: [], printedPatientId: c.patientId ?? null });
        const patientOf = (c) => Object.values(db.cases).filter((o) => o.patientKey === c.patientKey);
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'plugin:dialog|open': return [window.__nextPick];
          case 'plugin:dialog|message': return 'Yes';
          case 'plugin:event|listen': return 1;
          case 'detect_landmarks': return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
            timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks, facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9 };
          case 'library_list': return Object.values(db.cases).filter(() => !a.deleted).map(summary);
          case 'library_user_norms': return [];
          case 'operators_list': return { names: [], current: '' };
          case 'library_import': {
            const id = 'c' + (Object.keys(db.cases).length + 1), learned = a.path.includes('learned');
            // Task 8 (Q9), fix round 1 (review I1): a 'filmlearned' film is its OWN fresh patient ("Demo FilmLearned"),
            // never "Demo Synthetic" — so it carries nothing accumulated by earlier checks in this file (no Patient
            // ID, no name/DOB/Scan ID conflicts) and the note text, and the exact `library_learn_value` calls OK
            // fires, can be asserted as an EXACT string/list rather than `includes(...)` (the review's point: a bug
            // that scrambled NOTE_ORDER or taught an extra wrong field was not caught by presence-only checks). It
            // leaves DOB, the film date and Scan ID all blank, so only "name" (the film-sourced name itself),
            // "Gender" and "X-ray type" are ever learned or confirmed for it.
            const filmLearned = a.path.includes('filmlearned');
            // A 'nodob' film leaves DOB blank, so Choose on the film opens by itself (Task 8's S5 reads its buttons).
            db.cases[id] = filmLearned
              ? { id, path: a.path, patientName: 'Demo FilmLearned', patientKey: 'demo filmlearned', dateOfBirth: null, scanId: null,
                  timepoint: 'T1', takenOn: null, takenOnSource: null, facing: 'right', orientation: {}, display: {}, spacingMm: null,
                  verifiedAt: null, verifiedBy: null, landmarks: [], createdAt: now(), updatedAt: now(), deletedAt: null,
                  identitySource: 'film', identityChecked: true, identityIssues: [], learnedFields: ['gender', 'xray_type'],
                  gender: 'F', referringPractitioner: null,
                  population: null, patientId: null, xrayType: 'Lateral Ceph', xraySize: null, radiographyPractice: null,
                  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [] }
              : { id, path: a.path, patientName: 'Demo Synthetic', patientKey: 'demo synthetic', dateOfBirth: a.path.includes('nodob') ? null : '1990-03-07', scanId: '4471',   // SYNTHETIC
                  timepoint: 'T1', takenOn: '2024-02-07', takenOnSource: 'label', facing: 'right', orientation: {}, display: {}, spacingMm: null,
                  verifiedAt: null, verifiedBy: null, landmarks: [], createdAt: now(), updatedAt: now(), deletedAt: null,
                  identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: learned ? ['xray_type'] : [],
                  gender: null, referringPractitioner: null,
                  population: null, patientId: null, xrayType: learned ? 'Lateral Ceph' : null, xraySize: null, radiographyPractice: null,
                  // Task 5 (D2): the real CaseDoc always carries these; a stub without them has the panel read undefined.
                  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [] };
            ensureLibraryNo(db, db.cases[id].patientKey, db.cases[id].patientName);   // LIBID-1 rule 1: given once named
            store(db); return { caseId: id, created: true };
          }
          case 'library_read_label': { const c = db.cases[a.caseId];
            return { checked: true, issues: [], lines: LINES, learnedFields: c.learnedFields, conflicts: [], suggestions: [] }; }
          case 'library_label_text': return { lines: structuredClone(LINES), suggestions: [] };
          case 'library_learn_value': return true;
          // Owner Q10: the ✓ keeps the value, drops only that one mark.
          case 'library_accept_learned': { const c = db.cases[a.caseId];
            const acceptable = ['patient_id', 'xray_type', 'xray_size', 'practice', 'gender', 'referrer'];
            if (!acceptable.includes(a.field)) throw new Error(`${a.field} has no check of its own`);
            c.learnedFields = c.learnedFields.filter((f) => f !== a.field); store(db); return null; }
          // Owner Q9: OK on the patient note removes every "Learned for this machine" mark on this X-ray. LIBID-1
          // (L4, "Same patient" on a link suggestion): a.sameAs moves THIS X-ray only, onto that patient's name and
          // date of birth (as "Same patient" in Check patient details already does) — its own Patient ID stays.
          case 'library_confirm_identity': { const c = db.cases[a.caseId];
            if (a.sameAs) {
              const key = a.sameAs.name.trim().toLowerCase();
              Object.assign(c, { patientName: a.sameAs.name, patientKey: key, dateOfBirth: a.sameAs.dateOfBirth });
              ensureLibraryNo(db, key, a.sameAs.name);
            }
            c.identityChecked = true; c.identitySource = 'manual'; c.learnedFields = []; store(db); return null; }
          case 'library_open': { const c = db.cases[a.caseId];
            const live = patientOf(c).filter((o) => !o.deletedAt);
            // LIBID-1: every Patient ID seen on this patient's (live) X-rays, oldest first.
            const patientIdsSeen = [...new Set(live.map((o) => o.patientId).filter((v) => v != null))];
            // LIBID-1: a link suggestion for each OTHER, named patient whose X-ray(s) carry the SAME Patient ID as
            // this X-ray's own — never an unnamed one, and never one answered "Not the same" for this X-ray (L4).
            const idMatches = [];
            if (c.patientId) {
              const otherKeys = [...new Set(Object.values(db.cases)
                .filter((o) => !o.deletedAt && o.patientKey !== c.patientKey && o.patientName && o.patientName.trim() && sameId(o.patientId, c.patientId))
                .map((o) => o.patientKey))];
              for (const key of otherKeys) {
                const libraryId = libraryIdOf(db, key); if (!libraryId) continue;
                if ((db.notSame || []).some(([cid, l]) => cid === a.caseId && l === libraryId)) continue;
                const group = Object.values(db.cases).filter((o) => !o.deletedAt && o.patientKey === key && sameId(o.patientId, c.patientId));
                idMatches.push({ libraryId, patient: { name: group[0].patientName, dateOfBirth: group[0].dateOfBirth }, films: group.length });
              }
            }
            // S7 (preflight rulings): the CaseDoc field is `printedPatientId`, not `patientId` — `patientId` here is
            // only this stub's own storage key (it also doubles as the IPC call's argument name, which keeps it).
            // Owner L9-A (Task 19): the trail. `db.trails`, keyed by patient key, holds what the real `library_open`
            // would send; "__SELF__" stands for that patient's own number (see e2e12's `db.trails` block below).
            const self = libraryIdOf(db, c.patientKey);
            const libraryTrail = ((db.trails || {})[c.patientKey] || []).map((t) => JSON.parse(JSON.stringify(t).split('__SELF__').join(self)));
            return { ...c, printedPatientId: c.patientId ?? null, libraryId: libraryIdOf(db, c.patientKey), patientIdsSeen, idMatches, libraryTrail,
              image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, updatedAt: now() }); store(db); return { updatedAt: c.updatedAt, verifiedAt: null }; }
          case 'library_set_meta': { const c = db.cases[a.caseId];
            Object.assign(c, a.meta, { patientKey: a.meta.patientName.trim().toLowerCase() });
            ensureLibraryNo(db, c.patientKey, c.patientName); store(db); return null; }
          // Task 9 (X4): per-X-ray, not per-patient — the old stub wrote every sibling's `patientId`, which is why
          // the old S1 ("Patient ID shows on the same patient's OTHER film") passed; now only THIS X-ray's own.
          case 'library_set_patient_id': { const c = db.cases[a.caseId];
            if ((a.patientId ?? '').length > 200) throw new Error('that is too long (over 200 characters)');
            c.patientId = a.patientId?.trim() || null;
            c.learnedFields = c.learnedFields.filter((f) => f !== 'patient_id'); store(db); return null; }
          // "Not the same" on a link suggestion: remembered for this X-ray and that patient's Library ID only.
          case 'library_not_same_patient': { db.notSame = db.notSame || []; db.notSame.push([a.caseId, a.libraryId]); store(db); return null; }
          // Step 6 edge case: a deleted X-ray's ID is absent from the line and matches nothing (addendum edge cases).
          case 'library_delete': db.cases[a.caseId].deletedAt = now(); store(db); return null;
          case 'library_restore': db.cases[a.caseId].deletedAt = null; store(db); return null;
          case 'library_set_film_detail': { if (window.__slowSave) { await new Promise((r) => setTimeout(r, window.__slowSave)); Object.assign(db, load()); }
            const c = db.cases[a.caseId];
            const col = { xray_type: 'xrayType', xray_size: 'xraySize', practice: 'radiographyPractice' }[a.field];
            if (!col) throw new Error(`unknown film detail "${a.field}"`);
            c[col] = a.value?.trim() || null; c.learnedFields = c.learnedFields.filter((f) => f !== a.field); store(db); return null; }
          case 'settings_get': {
            // Fix round 1, Important 1 (D10): the first film_details_off read after a __delayFilmDetails flag is
            // set (localStorage, survives the reload that triggers it) is delayed, so a toggle made right after
            // the reload lands before this load resolves — proving the merge, not just the write queue.
            if (a.key === 'film_details_off' && localStorage.getItem('__delayFilmDetails')) {
              localStorage.removeItem('__delayFilmDetails');
              return new Promise((r) => setTimeout(() => r(db.settings[a.key] ?? null), 700));
            }
            return db.settings[a.key] ?? null;
          }
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
  // Task 7 (C3): the label is matched EXACTLY on its own title row — "Patient" must never also find "Patient ID".
  // The new detail boxes are one-row textareas that grow (S2), so the box is an input or a textarea.
  const exact = (label) => new RegExp('^' + label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(Pick)?$');
  const field = (label) => page.locator('.case-panel label').filter({ has: page.locator(':scope > .label-row', { hasText: exact(label) }) }).locator('input, textarea');
  // A box that is not there reads as null (a clean FAIL), never a 30 s wait that crashes the run.
  const box = async (label) => ((await field(label).count()) === 1 ? field(label).inputValue() : null);
  const calls = () => page.evaluate(() => window.__calls.map(([c, a]) => `${c}:${a.field ?? ''}:${a.value ?? a.patientId ?? a.libraryId ?? ''}`));
  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  await importFile('details-label.png');
  const ft = page.locator('section[aria-label="Text on the film"]');
  const what = (n) => ft.getByLabel(`What line ${n} is`, { exact: true });
  const optionLabels = await what(1).locator('option').allInnerTexts();
  ok('D1. the drop-down lists the new choices in order', JSON.stringify(optionLabels) === JSON.stringify(['—', 'Full name', 'Last name', 'First name(s)', 'DOB',
    'Film date', 'Scan ID', 'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice', 'Referring practitioner', 'Gender']), JSON.stringify(optionLabels));
  await what(2).selectOption('last'); await page.waitForTimeout(200);
  // Fix round 1, item 5: `.innerText()` on a locator that never appears waits the full 30s timeout and crashes the
  // run (exit 2) instead of printing FAIL — count()/allInnerTexts() never wait, so a missing note reads as a clean
  // FAIL. (Confirmed: rerunning this file against the pre-fix app code, below, now prints D2 FAIL instead of
  // hanging.)
  const d2notes = await ft.locator('.film-note-row').allInnerTexts();
  ok('D2. Last name alone waits for the first name and saves nothing', d2notes.some((t) => t.includes('Now choose the first name'))
    && (await field('Patient').inputValue()) === 'Demo Synthetic', d2notes.join(' | '));
  await what(3).selectOption('first'); await page.waitForTimeout(300);
  ok('D2. then First name saves "Smith, John"', (await field('Patient').inputValue()) === 'Smith, John', await field('Patient').inputValue());   // SYNTHETIC
  ok('D2. and the waiting note goes', (await ft.locator('.film-note-row').count()) === 0);
  await what(5).selectOption('patientId'); await page.waitForTimeout(200);
  await what(6).selectOption('xrayType'); await page.waitForTimeout(200);
  await what(7).selectOption('xraySize'); await page.waitForTimeout(200);
  await what(1).selectOption('practice'); await page.waitForTimeout(300);
  const c1 = await calls();
  ok('D4. each is saved on its own and teaches the machine', ['library_set_patient_id::5566', 'library_set_film_detail:xray_type:LATERAL CEPH',
    'library_set_film_detail:xray_size:24 x 30 cm', 'library_set_film_detail:practice:Demo Radiology Northside', 'library_learn_value:patient_id:5566',
    'library_learn_value:xray_type:LATERAL CEPH', 'library_learn_value:xray_size:24 x 30 cm', 'library_learn_value:practice:Demo Radiology Northside',
    'library_learn_value:last:Smith', 'library_learn_value:first:John']
    .every((x) => c1.includes(x)), c1.join(' | '));
  const d3 = [await box('Patient ID'), await box('X-ray type'), await box('X-ray dimensions'), await box('Radiography practice')];
  ok('D3. each new choice fills its box', JSON.stringify(d3) === JSON.stringify(['5566', 'LATERAL CEPH', '24 x 30 cm', 'Demo Radiology Northside']), JSON.stringify(d3));
  ok('D4. the lines now show what they are', (await what(5).inputValue()) === 'patientId' && (await what(1).inputValue()) === 'practice');
  await ft.getByLabel('Line 6', { exact: true }).fill('x'.repeat(201));
  await what(6).selectOption('xrayType'); await page.waitForTimeout(200);
  const d5notes = await ft.locator('.hint.warn').allInnerTexts();
  ok('D5. a 201-character line gives its note', d5notes.includes('That line is too long (over 200 characters)'), d5notes.join(' | '));
  ok('D5. and changes nothing (the save call count is unchanged)', (await calls()).filter((x) => x.startsWith('library_set_film_detail:xray_type:')).length
    === c1.filter((x) => x.startsWith('library_set_film_detail:xray_type:')).length);
  ok('D5. and the X-ray type box keeps its value', (await box('X-ray type')) === 'LATERAL CEPH', String(await box('X-ray type')));

  // Brief edge case, fix round 1 item 7: a locked case (the read-only Superimposition page) disables the
  // drop-downs too — pre-existing behaviour (`FilmText.tsx`'s `disabled={locked}`), not new to this task, but
  // named for Task 6 and otherwise had no output. Positive control (run manually, not kept in this file): removing
  // that `disabled={locked}` once made this check FAIL; restored.
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.case-panel');
  const ft2 = page.locator('section[aria-label="Text on the film"]');
  ok('locked case: the "What it is" drop-downs are disabled', await ft2.locator('select').first().isDisabled());
  // Task 7 (S6): the four detail boxes are disabled there too, and so are their Pick buttons.
  const lockedBoxes = [];
  for (const l of ['Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice']) lockedBoxes.push((await field(l).count()) === 1 && (await field(l).isDisabled()));
  ok('D10. locked case: the four detail boxes are disabled', lockedBoxes.length === 4 && lockedBoxes.every(Boolean), JSON.stringify(lockedBoxes));
  const lockedPick = page.getByRole('button', { name: 'Pick X-ray type on the film' });
  ok('D10. locked case: their Pick buttons are disabled', (await lockedPick.count()) === 1 && (await lockedPick.isDisabled()));
  await page.getByRole('button', { name: '‹ Tracing' }).click();

  await toLibrary();
  await page.getByRole('button', { name: 'Open Smith, John T1' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');   // SYNTHETIC
  ok('D6. closed and reopened, the details are still there', (await box('Radiography practice')) === 'Demo Radiology Northside'
    && (await box('Patient ID')) === '5566', `${await box('Radiography practice')} / ${await box('Patient ID')}`);
  // S1 at :175 (inverted, owner Q8 — preflight X4). This REPLACES the old S1, which asserted the PATIENT'S Patient
  // ID showed on another of its X-rays; Patient ID is now per-X-ray (Task 9), so a second X-ray of the same patient
  // shows a BLANK Patient ID box, and the Library ID line lists the ID seen on its sibling X-ray instead.
  const timepoint = (tp) => page.locator('.case-panel label', { hasText: 'Timepoint' }).locator('input').fill(tp)
    .then(() => page.locator('.case-panel label', { hasText: 'Timepoint' }).locator('input').press('Tab')).then(() => page.waitForTimeout(200));
  const libLine = () => page.locator('.library-line').innerText();
  const libIdIn = (text) => (text.match(/Library ID (L-\d{5})/) || [])[1];

  await toLibrary();
  await importFile('details-other.png');
  await timepoint('T2');                                           // keeps "Open Smith, John T1/T2/T3" unambiguous below
  await field('Patient').fill('Smith, John'); await field('Patient').press('Tab'); await page.waitForTimeout(300);   // SYNTHETIC
  ok('S1 (inverted, Q8). the same patient\'s other X-ray shows a BLANK Patient ID box, not the other X-ray\'s', (await box('Patient ID')) === ''
    && (await box('X-ray type')) === '', `${await box('Patient ID')} / ${await box('X-ray type')}`);
  const s1LibLine = await libLine();
  ok('S1 (inverted, Q8). and the Library ID line lists 5566 (seen on its sibling X-ray)', s1LibLine.includes('5566'), s1LibLine);

  // L1 (preflight Task 9): the line under the Patient box reads "Library ID L-0000…" and lists the patient's IDs.
  ok('L1. the line under the Patient box reads "Library ID L-0000…" and lists the patient\'s IDs',
    /^Library ID L-\d{5} · Patient IDs on this patient's X-rays: 5566$/.test(s1LibLine), s1LibLine);
  const smithLibraryId = libIdIn(s1LibLine);
  ok('L1. a Library ID was actually issued', !!smithLibraryId, s1LibLine);

  // L2: typing a second, differing Patient ID on this (second) X-ray of Smith, John shows the grey Q8 note on BOTH.
  await field('Patient ID').fill('ZQ-7781'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  const noteHere = await page.locator('.id-note').allInnerTexts();
  ok('L2. typing a differing ID shows the grey note on THIS X-ray', noteHere.some((t) => t.startsWith('Other X-rays of this patient show Patient ID 5566.')), noteHere.join(' | '));
  await toLibrary();
  await page.getByRole('button', { name: 'Open Smith, John T1' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');   // SYNTHETIC
  const noteThere = await page.locator('.id-note').allInnerTexts();
  ok('L2. and on the OTHER X-ray too, naming the ID it differs from', noteThere.some((t) => t.startsWith('Other X-rays of this patient show Patient ID ZQ-7781.')), noteThere.join(' | '));
  const libLineT1 = await libLine();
  ok('L2. the library line now lists both IDs', libLineT1.includes('5566, ZQ-7781') || libLineT1.includes('ZQ-7781, 5566'), libLineT1);

  // L3: a third X-ray named "Demo Other" with Patient ID 5566 shows the link note naming Smith, John (only the T1
  // X-ray still carries 5566, so "1 X-ray"). "Same patient" moves THIS X-ray only; its own Patient ID is unchanged.
  await toLibrary();
  await importFile('other-match1.png');
  await timepoint('T3');
  await field('Patient').fill('Demo Other'); await field('Patient').press('Tab'); await page.waitForTimeout(200);
  await field('Patient ID').fill('5566'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  const l3Link = page.locator('.id-link');
  const l3Text = (await l3Link.count()) === 1 ? await l3Link.innerText() : '';
  ok('L3. the matching Patient ID shows a link note naming Smith, John', l3Text.startsWith('Patient ID 5566 is also on 1 X-ray of Smith, John · 07/03/1990') && l3Text.includes(smithLibraryId), l3Text);   // SYNTHETIC
  await page.evaluate(() => { window.__calls = []; });
  await l3Link.getByRole('button', { name: 'Same patient', exact: true }).click(); await page.waitForTimeout(300);
  const l3Calls = await calls();
  ok('L3. Same patient calls library_confirm_identity', l3Calls.includes('library_confirm_identity::'), l3Calls.join(' | '));
  ok('L3. the Patient box now reads Smith, John, Patient ID still 5566', (await field('Patient').inputValue()) === 'Smith, John' && (await box('Patient ID')) === '5566',
    `${await field('Patient').inputValue()} / ${await box('Patient ID')}`);

  // L4: a fourth such X-ray ("Demo Other" again, Patient ID 5566 — now matching 2 X-rays of Smith, John: T1 and T3).
  await toLibrary();
  await importFile('other-match2.png');
  await timepoint('T4');
  await field('Patient').fill('Demo Other'); await field('Patient').press('Tab'); await page.waitForTimeout(200);
  await field('Patient ID').fill('5566'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  const l4Link = page.locator('.id-link');
  const l4Text = (await l4Link.count()) === 1 ? await l4Link.innerText() : '';
  ok('L4 setup. the link note now counts 2 X-rays', l4Text.startsWith('Patient ID 5566 is also on 2 X-rays of Smith, John · 07/03/1990'), l4Text);   // SYNTHETIC

  // L5 (locked page): before resolving the suggestion, the Superimposition page disables both link buttons.
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.case-panel');
  const lockedLink = page.locator('.id-link');
  ok('L5. locked case: the link note is still shown, read-only', (await lockedLink.count()) === 1);
  ok('L5. locked case: Same patient is disabled', await lockedLink.getByRole('button', { name: 'Same patient', exact: true }).isDisabled());
  ok('L5. locked case: Not the same is disabled', await lockedLink.getByRole('button', { name: 'Not the same', exact: true }).isDisabled());
  await page.getByRole('button', { name: '‹ Tracing' }).click();

  // L4: Not the same hides the suggestion for THIS X-ray and that Library ID, and it stays gone after reopening.
  await page.evaluate(() => { window.__calls = []; });
  await l4Link.getByRole('button', { name: 'Not the same', exact: true }).click(); await page.waitForTimeout(300);
  const l4Calls = await calls();
  ok('L4. Not the same calls library_not_same_patient with the Library ID', l4Calls.includes(`library_not_same_patient::${smithLibraryId}`), l4Calls.join(' | '));
  ok('L4. the note goes', (await page.locator('.id-link').count()) === 0);
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Other T4' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('L4. and stays gone after closing and reopening', (await page.locator('.id-link').count()) === 0);

  // L5 (search): the Library search box finds the patient by a Patient ID on ANY of its X-rays, and by its Library ID.
  await toLibrary();
  const search = page.getByLabel('Search the library');
  await search.fill('5566'); await page.waitForTimeout(200);
  const bySearchId = await page.locator('.card').count();
  ok('L5. searching 5566 finds every X-ray of the patient that carries it, not only its own card',
    bySearchId >= 3, String(bySearchId));   // Smith T1 (5566), Smith T3 (moved, 5566) and "Demo Other" T4 (5566, standalone)
  await search.fill(smithLibraryId); await page.waitForTimeout(200);
  const bySearchLib = await page.locator('.card').count();
  ok('L5. searching by Library ID finds the patient\'s X-rays', bySearchLib >= 3, `${smithLibraryId}: ${bySearchLib}`);
  await search.fill(''); await page.waitForTimeout(200);

  // Fix round 1, I2: ONE X-ray that carries a library line, the Q8 differing-ID note AND a resolved "Not the same"
  // answer all at once — closed and reopened, Step 6 requires all three to persist TOGETHER (not each shown only
  // in its own, separate scenario).
  await importFile('combo-p1.png');
  await timepoint('CB1');
  await field('Patient').fill('Demo Combo'); await field('Patient').press('Tab'); await page.waitForTimeout(200);   // SYNTHETIC
  await field('Patient ID').fill('CMB-A'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  await toLibrary();
  await importFile('combo-p2.png');
  await timepoint('CB2');
  await field('Patient').fill('Demo Combo'); await field('Patient').press('Tab'); await page.waitForTimeout(200);
  await field('Patient ID').fill('CMB-B'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);   // differs from CMB-A: Q8 note on both
  await toLibrary();
  await importFile('combo-other.png');
  await timepoint('CB3');
  await field('Patient').fill('Demo Combo Other'); await field('Patient').press('Tab'); await page.waitForTimeout(200);   // SYNTHETIC
  await field('Patient ID').fill('CMB-B'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);   // matches combo-p2's own ID: a link suggestion on combo-p2
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Combo CB2' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('Combined edge setup: this X-ray shows BOTH the Q8 note and a link suggestion before resolving',
    (await page.locator('.id-note').count()) === 1 && (await page.locator('.id-link').count()) === 1);
  await page.locator('.id-link').getByRole('button', { name: 'Not the same', exact: true }).click(); await page.waitForTimeout(300);
  const comboLineBefore = await libLine();
  const comboNoteBefore = await page.locator('.id-note').innerText();
  ok('Combined edge: before closing, the line, the note and the resolved link all show correctly',
    comboLineBefore.includes('CMB-A') && comboLineBefore.includes('CMB-B') && comboNoteBefore.includes('CMB-A')
    && (await page.locator('.id-link').count()) === 0, `${comboLineBefore} | ${comboNoteBefore}`);
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Combo CB2' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  const comboLineAfter = await libLine();
  const comboNoteAfter = await page.locator('.id-note').innerText();
  const comboLinkAfter = await page.locator('.id-link').count();
  ok('Combined edge (Step 6): closed and reopened, the line, the Q8 note AND the resolved "Not the same" all persist together',
    comboLineAfter === comboLineBefore && comboNoteAfter === comboNoteBefore && comboLinkAfter === 0,
    `line=${comboLineAfter} note=${comboNoteAfter} links=${comboLinkAfter}`);

  // Fix round 1, Minor 4: choosing the full Patient line clears a Last/First still waiting, so a LATER First/Last
  // choice cannot wrongly join onto a name that was pending before the Patient choice. A second film (no comma
  // in its patientName yet, unlike the first film's now-composed "Smith, John") isolates a fresh waiting state.
  // (Already in the Library view, from the L5 search above.)
  await importFile('details-label2.png');
  await what(2).selectOption('last'); await page.waitForTimeout(200);
  const m4notes1 = await ft.locator('.film-note-row').allInnerTexts();
  ok('Minor 4: Last alone waits, as before', m4notes1.some((t) => t.includes('Now choose the first name')), m4notes1.join(' | '));
  await what(3).selectOption('name'); await page.waitForTimeout(200);
  ok('Minor 4: choosing the full Patient line saves it directly', (await field('Patient').inputValue()) === 'John');
  await what(3).selectOption('first'); await page.waitForTimeout(200);
  const m4notes2 = await ft.locator('.film-note-row').allInnerTexts();
  ok('Minor 4: a later First does not join the earlier, now-cleared Last',
    m4notes2.some((t) => t.includes('Now choose the last name')) && (await field('Patient').inputValue()) === 'John',
    `notes=${m4notes2.join(' | ')} patient=${await field('Patient').inputValue()}`);

  await toLibrary();
  await importFile('learned-details.png');
  const tag = page.locator('.case-panel label', { hasText: 'X-ray type' }).locator('.learned-tag');
  ok('D7. a learned X-ray type shows "Learned for this machine"', (await tag.count()) === 1 && (await box('X-ray type')) === 'Lateral Ceph', String(await box('X-ray type')));
  if (await field('X-ray type').count()) { await field('X-ray type').fill('PA Ceph'); await field('X-ray type').press('Tab'); await page.waitForTimeout(300); }
  ok('D7. typing over it saves it and removes the tag', (await tag.count()) === 0 && (await box('X-ray type')) === 'PA Ceph', String(await box('X-ray type')));
  if (await field('X-ray dimensions').count()) { await field('X-ray dimensions').fill('x'.repeat(201)); await field('X-ray dimensions').press('Tab'); await page.waitForTimeout(200); }
  ok('D8. 201 characters typed is refused and the box goes back', (await box('X-ray dimensions')) === ''
    && (await page.getByText('X-ray dimensions is too long (over 200 characters).').count()) === 1);
  // A blank box saves NULL (brief edge case): clear the X-ray type typed above.
  await page.evaluate(() => { window.__calls = []; });
  if (await field('X-ray type').count()) { await field('X-ray type').fill('   '); await field('X-ray type').press('Tab'); await page.waitForTimeout(300); }
  const cBlank = await page.evaluate(() => window.__calls.filter(([c]) => c === 'library_set_film_detail').map(([, a]) => [a.field, a.value]));
  ok('D8. a blank box saves NULL', JSON.stringify(cBlank) === JSON.stringify([['xray_type', null]]) && (await box('X-ray type')) === '', JSON.stringify(cBlank));
  await page.evaluate(() => { window.__calls = []; });
  const pickPid = page.getByRole('button', { name: 'Pick Patient ID on the film' });
  if (await pickPid.count()) {
    await pickPid.click(); await page.waitForTimeout(200);
    const pidWord = page.locator('.choose-word').nth(9);                                  // words: 3 + 1 + 1 + 3 + "PID", "5566" → index 9
    const b = await pidWord.boundingBox(); await page.mouse.click(b.x + b.width / 2, b.y + b.height / 2);
    await page.keyboard.press('Enter'); await page.waitForTimeout(300);
  }
  const c2 = await calls();
  ok('D9. Pick Patient ID on the film fills it and teaches that place', (await box('Patient ID')) === '5566'
    && c2.some((x) => x.startsWith('library_learn_selection:patient_id')), c2.join(' | '));
  ok('D9. and leaves Scan ID alone', (await box('Scan ID')) === '4471', String(await box('Scan ID')));

  // Pre-flight D5: each box resets from its OWN saved value. A slow save of one box lands while the next box is
  // still being typed in; the text being typed must survive the refresh.
  await page.evaluate(() => { window.__slowSave = 250; });
  await field('Radiography practice').fill('North Clinic');
  await field('X-ray dimensions').click(); await field('X-ray dimensions').fill('24 x 30 cm');   // leaving practice saves it, slowly
  await page.waitForTimeout(600);
  ok('D5b. a save landing on one box never wipes text being typed in another', (await box('X-ray dimensions')) === '24 x 30 cm'
    && (await box('Radiography practice')) === 'North Clinic', `${await box('X-ray dimensions')} / ${await box('Radiography practice')}`);
  await page.evaluate(() => { window.__slowSave = 0; });
  await field('X-ray dimensions').press('Enter'); await page.waitForTimeout(300);
  ok('D5b. and Enter leaves the box and saves it', (await box('X-ray dimensions')) === '24 x 30 cm'
    && (await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases[Object.keys(JSON.parse(localStorage.getItem('fakeLib')).cases).pop()].xraySize)) === '24 x 30 cm');

  // S2 (spec edge case): a long value wraps in its box and shows whole — the box grows, nothing is hidden or clipped.
  const longPractice = 'Demo Radiology Northside Imaging Centre, Level 2, 100 Example Street, Synthetic Town';
  await field('Radiography practice').fill(longPractice); await field('Radiography practice').press('Tab'); await page.waitForTimeout(300);
  const fit = await field('Radiography practice').evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight, w: el.clientWidth,
    panel: el.closest('.case-panel').clientWidth, right: el.getBoundingClientRect().right, panelRight: el.closest('.case-panel').getBoundingClientRect().right }));
  ok('S2. a long value wraps onto more rows and shows whole', (await box('Radiography practice')) === longPractice && fit.h > 30 && fit.sh <= fit.h + 1
    && fit.right <= fit.panelRight + 1, JSON.stringify(fit));
  await page.locator('.case-panel').screenshot({ path: `${__dirname}/out/fd-t7-panel.png` });

  // Task 8: Settings › Text on the film — switching a detail off hides it from the drop-down and the Choose buttons
  // (Q2 A), a box already showing it stays, and the switch holds across a reload.
  await field('X-ray dimensions').fill('24 x 30 cm'); await field('X-ray dimensions').press('Tab'); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Settings…' }).click();
  const set = page.getByRole('dialog', { name: 'Settings' });
  await set.getByRole('tab', { name: 'Text on the film' }).click();
  const boxes = set.locator('.film-details-settings input[type="checkbox"]');
  ok('S1. Settings › Text on the film lists every detail, all on', (await boxes.count()) === 12
    && (await boxes.evaluateAll((els) => els.every((e) => e.checked))));
  // S7 (owner Q12, Task 10): switching "Full name" off hides exactly what it says — the drop-down loses "Full
  // name" but keeps "Last name"/"First name(s)"; the Patient box and its Pick button are unaffected (they are
  // not a Choose-on-the-film field at all). The Choose-on-the-film BUTTONS half of this (fix round 1, I1) is
  // checked further down, beside S5 — it needs a case with an unsure field to open the full chooser, which this
  // one (already identity-checked) doesn't have.
  await set.getByLabel('Full name', { exact: true }).uncheck(); await page.waitForTimeout(300);
  const s7opts = await ft.getByLabel('What line 1 is', { exact: true }).locator('option').allInnerTexts();
  ok('S7. Settings: unticking "Full name" removes it from the drop-down, keeps Last/First', !s7opts.includes('Full name')
    && s7opts.includes('Last name') && s7opts.includes('First name(s)'), JSON.stringify(s7opts));
  ok('S7. the Patient box and its Pick button are still there', (await field('Patient').count()) === 1
    && (await page.getByRole('button', { name: 'Pick Patient on the film' }).count()) === 1);
  await set.getByLabel('Full name', { exact: true }).check(); await page.waitForTimeout(300);   // restore for S2 below
  await set.getByLabel('X-ray dimensions', { exact: true }).uncheck();
  await set.getByLabel('Gender', { exact: true }).uncheck(); await page.waitForTimeout(300);
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings.film_details_off);
  ok('S2. two quick switches are both saved', saved === '["xraySize","gender"]', saved);
  await set.getByRole('button', { name: 'Close' }).click();
  const opts = (n) => ft.getByLabel(`What line ${n} is`, { exact: true }).locator('option').allInnerTexts();
  const o2 = await opts(2);
  ok('S3. a switched-off detail is gone from the drop-down', !o2.includes('X-ray dimensions') && !o2.includes('Gender') && o2.includes('Patient ID'), JSON.stringify(o2));
  ok('Minor 2 (Q2 A). the box for a switched-off detail still shows its saved value', (await box('X-ray dimensions')) === '24 x 30 cm', String(await box('X-ray dimensions')));
  ok('S4. a line already showing it keeps it (and still reads as it)', (await opts(7)).includes('X-ray dimensions') && (await what(7).inputValue()) === 'xraySize');
  await toLibrary();
  await importFile('nodob-details.png');                                    // DOB blank: Choose on the film opens by itself
  await page.waitForSelector('.choose-word');
  const w0 = await page.locator('.choose-word').nth(0).boundingBox(); await page.mouse.click(w0.x + w0.width / 2, w0.y + w0.height / 2);
  const buttons = await page.locator('.chooser button').allInnerTexts();
  ok('S5. the Choose-on-the-film buttons follow the switch (Q2 A)', !buttons.includes('X-ray dimensions') && buttons.includes('Patient ID'), JSON.stringify(buttons));
  // S7 control (owner Q12, I1): with "Full name" still ON at this point, the open chooser DOES offer it — proving
  // the assertion below isn't vacuous (it can see the button when it's there; the same selection, left open, is
  // what the next check reads from after the switch flips, per Task 8's existing "follows the switch" wiring).
  ok('S7 control. with "Full name" on, the chooser offers it (so the next check could fail)', buttons.includes('Full name'), JSON.stringify(buttons));
  await page.getByRole('button', { name: 'Settings…' }).click();
  await set.getByRole('tab', { name: 'Text on the film' }).click();
  await set.getByLabel('Full name', { exact: true }).uncheck(); await page.waitForTimeout(300);
  await set.getByRole('button', { name: 'Close' }).click();
  const buttonsFullOff = await page.locator('.chooser button').allInnerTexts();
  ok('S7. switching "Full name" off removes it from the Choose-on-the-film buttons too, keeps Last/First',
    !buttonsFullOff.includes('Full name') && buttonsFullOff.includes('Last name') && buttonsFullOff.includes('First name(s)'),
    JSON.stringify(buttonsFullOff));
  await page.getByRole('button', { name: 'Settings…' }).click();
  await set.getByRole('tab', { name: 'Text on the film' }).click();
  await set.getByLabel('Full name', { exact: true }).check(); await page.waitForTimeout(300);   // restore (D10 below expects xraySize,gender off only)
  await set.getByRole('button', { name: 'Close' }).click();
  // Edge case (brief Step 6, I2): all 12 off, then on again — the drop-down keeps only "—" with nothing off,
  // then shows every box word again, in order. Ends back on the xraySize/gender-off state the rest of this file
  // (D10, S3, S4) expects.
  await page.getByRole('button', { name: 'Settings…' }).click();
  await set.getByRole('tab', { name: 'Text on the film' }).click();
  for (let i = 0; i < 12; i++) await set.locator('.film-details-settings input[type="checkbox"]').nth(i).uncheck();
  await page.waitForTimeout(300);
  const optsAllOff = await ft.getByLabel('What line 1 is', { exact: true }).locator('option').allInnerTexts();
  ok('Edge (all 12 off): the drop-down keeps only "—"', JSON.stringify(optsAllOff) === JSON.stringify(['—']), JSON.stringify(optsAllOff));
  for (let i = 0; i < 12; i++) await set.locator('.film-details-settings input[type="checkbox"]').nth(i).check();
  await page.waitForTimeout(300);
  const optsAllOn = await ft.getByLabel('What line 1 is', { exact: true }).locator('option').allInnerTexts();
  ok('Edge (all 12 on again): the drop-down lists every box word again, in order', JSON.stringify(optsAllOn) === JSON.stringify(['—', 'Full name',
    'Last name', 'First name(s)', 'DOB', 'Film date', 'Scan ID', 'Patient ID', 'X-ray type', 'X-ray dimensions', 'Radiography practice',
    'Referring practitioner', 'Gender']), JSON.stringify(optsAllOn));
  await set.getByLabel('X-ray dimensions', { exact: true }).uncheck();
  await set.getByLabel('Gender', { exact: true }).uncheck(); await page.waitForTimeout(300);   // back to the state D10/S3/S4 expect
  await set.getByRole('button', { name: 'Close' }).click();
  await page.keyboard.press('Escape');
  await page.reload(); await page.waitForSelector('.library');
  await page.locator('.card').first().click(); await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('button', { name: 'Settings…' }).click();
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('tab', { name: 'Text on the film' }).click();
  ok('S6. after a restart the switch holds', !(await page.getByRole('dialog', { name: 'Settings' }).getByLabel('X-ray dimensions', { exact: true }).isChecked()));
  // Edge case (brief Step 6, I2): reopen Settings after a reload — "Full name" (owner Q12, never switched off in
  // this file's final state) still reads ON, same as before the reload; Gender (switched off) still reads OFF.
  ok('Edge (reopen Settings after a reload): "Full name" still reads on, "Gender" still reads off',
    (await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Full name', { exact: true }).isChecked())
    && !(await page.getByRole('dialog', { name: 'Settings' }).getByLabel('Gender', { exact: true }).isChecked()));
  await page.getByRole('dialog', { name: 'Settings' }).getByRole('button', { name: 'Close' }).click();

  // Fix round 1, Important 1 (D10, ruling): a tick made before the stored setting loads is MERGED onto
  // it, not overwritten by it and not overwriting it — neither the early toggle nor the already-stored switch-offs
  // (xraySize, gender from S2) are lost. The stored value already has xraySize off; practice is a different detail.
  await page.evaluate(() => localStorage.setItem('__delayFilmDetails', '1'));
  await page.reload(); await page.waitForSelector('.library');
  await page.locator('.card').first().click(); await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('button', { name: 'Settings…' }).click();
  const set2 = page.getByRole('dialog', { name: 'Settings' });
  await set2.getByRole('tab', { name: 'Text on the film' }).click();
  await page.waitForTimeout(100);                                    // well inside the 700ms delayed load
  await set2.getByLabel('Radiography practice', { exact: true }).uncheck();
  await page.waitForTimeout(900);                                    // past the delayed load resolving
  const d10ui = !(await set2.getByLabel('X-ray dimensions', { exact: true }).isChecked())
    && !(await set2.getByLabel('Gender', { exact: true }).isChecked())
    && !(await set2.getByLabel('Radiography practice', { exact: true }).isChecked());
  const d10saved = JSON.parse(await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings.film_details_off));
  ok('D10 (merge). a tick made before the late load resolves merges onto it, losing neither',
    d10ui && [...d10saved].sort().join(',') === 'gender,practice,xraySize', `ui=${d10ui} saved=${JSON.stringify(d10saved)}`);
  await set2.getByRole('button', { name: 'Close' }).click();

  // Task 8, Q10: the ✓ beside a "Learned for this machine" mark keeps the value, drops only that one mark, and
  // teaches the machine — without retyping.
  await toLibrary();
  await importFile('learned-q10.png');
  const xrayTypeLabel = page.locator('.case-panel label', { hasText: 'X-ray type' });
  const acceptBtn = xrayTypeLabel.getByRole('button', { name: 'Accept X-ray type as it is' });
  ok('Q10. the ✓ is visible beside "Learned for this machine"', (await acceptBtn.count()) === 1
    && (await xrayTypeLabel.locator('.learned-tag').innerText()).includes('Learned for this machine'));
  await page.evaluate(() => { window.__calls = []; });
  await acceptBtn.click(); await page.waitForTimeout(300);
  const q10calls = await calls();
  ok('Q10. clicking it calls library_accept_learned, then library_learn_value, for xray_type',
    q10calls.includes('library_accept_learned:xray_type:') && q10calls.includes('library_learn_value:xray_type:Lateral Ceph'), q10calls.join(' | '));
  ok('Q10. the mark goes and the box keeps its value', (await xrayTypeLabel.locator('.learned-tag').count()) === 0
    && (await box('X-ray type')) === 'Lateral Ceph', String(await box('X-ray type')));

  // Q10, locked case: the ✓ is disabled on the read-only Superimposition page, like every other box there.
  await toLibrary();
  await importFile('learned-q10b.png');
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForSelector('.case-panel');
  const lockedXrayTypeLabel = page.locator('.case-panel label', { hasText: 'X-ray type' });
  const lockedAcceptBtn = lockedXrayTypeLabel.getByRole('button', { name: 'Accept X-ray type as it is' });
  ok('Q10. locked case: the ✓ is disabled', (await lockedAcceptBtn.count()) === 1 && (await lockedAcceptBtn.isDisabled()));
  await page.getByRole('button', { name: '‹ Tracing' }).click();

  // Fix round 1 (review I2), brief Step 6 edge case: "closed and reopened, marks persist until ✓ or OK." D6
  // (above) already shows the VALUE survives; this shows the "Learned for this machine" mark (and its own ✓)
  // survives too, not just the value underneath it.
  await toLibrary();
  await importFile('learned-persist.png');
  await field('Patient').fill('Demo Persist'); await field('Patient').press('Tab'); await page.waitForTimeout(300);   // a unique name to reopen by
  const persistTagBefore = page.locator('.case-panel label', { hasText: 'X-ray type' }).locator('.learned-tag');
  ok('Edge (Step 6): a learned mark is present right after import', (await persistTagBefore.count()) === 1);
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Persist T1' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  const persistTagAfter = page.locator('.case-panel label', { hasText: 'X-ray type' }).locator('.learned-tag');
  ok('Edge (Step 6): the learned mark (and its ✓) survives closing and reopening the case',
    (await persistTagAfter.count()) === 1 && (await persistTagAfter.getByRole('button', { name: 'Accept X-ray type as it is' }).count()) === 1
    && (await box('X-ray type')) === 'Lateral Ceph', String(await persistTagAfter.count()));

  // Task 8, Q9: OK on the patient note lists what it confirms, in the box words, and removes every learned mark.
  // Fix round 1 (review I1): the fixture is its own fresh patient with nothing else learned or filled, so both
  // checks below assert the EXACT note text and the EXACT call list — not `includes(...)` — and a wrong extra
  // item (a scrambled NOTE_ORDER, or an extra wrongly-taught field) would make either check fail outright. See
  // the fix report for the induced control (an added item was shown to break both exact checks, then reverted).
  await toLibrary();
  await importFile('filmlearned-q9.png');
  const q9note = page.locator('.identity-note').first();
  const q9noteText = (await q9note.count()) === 1 ? await q9note.innerText() : '';
  ok('Q9. the note says EXACTLY what OK confirms: name, Gender, X-ray type — nothing else',
    q9noteText === 'Read from the film · OK confirms: name, Gender, X-ray type OK', q9noteText);
  await page.evaluate(() => { window.__calls = []; });
  await q9note.getByRole('button', { name: 'OK' }).click(); await page.waitForTimeout(300);
  const q9calls = await calls();
  ok('Q9. OK calls library_confirm_identity, then teaches EXACTLY name, X-ray type and Gender — nothing else',
    JSON.stringify(q9calls) === JSON.stringify(['library_confirm_identity::', 'library_learn_value:full:Demo FilmLearned',
      'library_learn_value:xray_type:Lateral Ceph', 'library_learn_value:gender:F']), q9calls.join(' | '));
  ok('Q9. every "Learned for this machine" mark on this X-ray is gone', (await page.locator('.case-panel .learned-tag').count()) === 0);

  // Step 6 edge cases (Task 9): unnamed patient; no Patient IDs anywhere; a 200-character Patient ID wraps whole; a
  // deleted X-ray's ID absent from the line; three matching patients, each with its own buttons.
  await toLibrary();
  await importFile('edge-unnamed.png');
  await field('Patient').fill(''); await field('Patient').press('Tab'); await page.waitForTimeout(300);
  ok('Edge: an unnamed patient has no Library ID yet, and no Patient IDs are listed',
    (await libLine()) === 'Library ID: given once the patient has a name', await libLine());
  await field('Patient').fill('Demo Edge'); await field('Patient').press('Tab'); await page.waitForTimeout(300);   // SYNTHETIC
  ok('Edge: named with no Patient ID anywhere, the line shows only the Library ID',
    /^Library ID L-\d{5}$/.test(await libLine()), await libLine());

  // A 200-character Patient ID, with a sibling X-ray carrying a different one, wraps whole in both the line and the
  // Q8 note — never clipped by the panel (reusing the S2 "fit" check).
  const longId = '7'.repeat(200);
  await field('Patient ID').fill(longId); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  await toLibrary();
  await importFile('edge-unnamed2.png');
  await field('Patient').fill('Demo Edge'); await field('Patient').press('Tab'); await page.waitForTimeout(300);
  await field('Patient ID').fill('short'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  const longLine = await libLine();
  ok('Edge: a 200-character Patient ID is listed whole, not truncated', longLine.includes(longId), longLine.length > 100 ? `${longLine.slice(0, 40)}…(${longLine.length} chars)` : longLine);
  const idNoteFit = await page.locator('.id-note').evaluate((el) => ({ h: el.clientHeight, sh: el.scrollHeight, right: el.getBoundingClientRect().right,
    panelRight: el.closest('.case-panel').getBoundingClientRect().right }));
  ok('Edge: the 200-character Q8 note wraps inside the panel width, nothing clipped',
    idNoteFit.sh <= idNoteFit.h + 1 && idNoteFit.right <= idNoteFit.panelRight + 1, JSON.stringify(idNoteFit));

  // A deleted X-ray's ID is absent from the line and matches nothing (addendum edge cases). Two distinct timepoints
  // so "Open"/"Delete" can address each X-ray of "Demo Deleted" without ambiguity.
  await toLibrary();
  await importFile('edge-deleted.png');
  await timepoint('TD1');
  await field('Patient').fill('Demo Deleted'); await field('Patient').press('Tab'); await page.waitForTimeout(200);   // SYNTHETIC
  await field('Patient ID').fill('DEL1'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  await toLibrary();
  await importFile('edge-deleted2.png');
  await timepoint('TD2');
  await field('Patient').fill('Demo Deleted'); await field('Patient').press('Tab'); await page.waitForTimeout(300);
  const beforeDelete = await libLine();
  ok('Edge: before deleting the other X-ray, its ID is listed here', beforeDelete.includes('DEL1'), beforeDelete);
  await toLibrary();
  await page.getByRole('button', { name: 'Delete Demo Deleted TD1' }).click(); await page.waitForTimeout(300);
  await page.getByRole('button', { name: 'Open Demo Deleted TD2' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  const afterDelete = await libLine();
  ok('Edge: once the other X-ray is deleted, its ID is gone from the line', !afterDelete.includes('DEL1') && afterDelete.includes('Library ID'), afterDelete);

  // Three matching patients: each is its own named patient, each gets its own link note with its own buttons.
  await toLibrary();
  await importFile('edge-target.png');
  await field('Patient').fill('Demo Target'); await field('Patient').press('Tab'); await page.waitForTimeout(200);   // SYNTHETIC
  await field('Patient ID').fill('TGT1'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  for (const n of [1, 2, 3]) {
    await toLibrary();
    await importFile(`edge-m${n}.png`);
    await field('Patient').fill(`Demo M${n}`); await field('Patient').press('Tab'); await page.waitForTimeout(200);   // SYNTHETIC
    await field('Patient ID').fill('TGT1'); await field('Patient ID').press('Tab'); await page.waitForTimeout(300);
  }
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Target T1' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  const links = page.locator('.id-link');
  const linkCount = await links.count();
  ok('Edge: three matching patients each show their own link note', linkCount === 3, String(linkCount));
  let okButtons = true;
  for (let i = 0; i < linkCount; i++) {
    const row = links.nth(i);
    okButtons = okButtons && (await row.getByRole('button', { name: 'Same patient', exact: true }).count()) === 1
      && (await row.getByRole('button', { name: 'Not the same', exact: true }).count()) === 1;
  }
  ok('Edge: each of the three has its own Same patient / Not the same buttons', okButtons);
  await page.locator('.case-panel').screenshot({ path: `${__dirname}/out/d2-t8-panel.png` });

  // Owner L9-A (Task 19): the Library ID trail. The stub sends, per patient key, what the real `library_open` would
  // (`db.trails`; "__SELF__" stands for that patient's own number). The Rust side is pinned in tests/library_ids.rs.
  // Every line is checked as EXACT text, in order. Positive controls (run, not kept): E1 remove the <ul> from
  // CasePanel -> TR1, TR2, TR4 FAIL; E2 drop `libraryTrail` from `identityFields` -> TR1 FAILs (no refresh after the
  // name is typed) while TR2 passes (reopening loads the whole case).
  await toLibrary();
  await page.evaluate(() => {
    const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.trails = { 'demo trail': [
      { kind: 'merged', number: 'L-00090', into: 'L-00091', on: '2026-10-16' },
      { kind: 'merged', number: 'L-00091', into: '__SELF__', on: '2026-10-17' },
      { kind: 'left', number: '__SELF__', on: '2026-10-18', now: 'L-00092', name: 'Smith, John' },   // SYNTHETIC
      { kind: 'left', number: 'L-00091', on: '2026-10-18', now: null, name: '' }] };
    localStorage.setItem('fakeLib', JSON.stringify(db));
  });
  await importFile('trail.png');
  await timepoint('TT1');
  await field('Patient').fill('Demo Trail'); await field('Patient').press('Tab'); await page.waitForTimeout(300);   // SYNTHETIC
  const trailIs = () => page.locator('.library-trail li').allInnerTexts();
  const wantTrail = ['L-00090 was merged into L-00091 on 16/10/2026.', 'L-00091 was merged into this patient on 17/10/2026.',
    'An X-ray left this patient on 18/10/2026. It is now L-00092 (Smith, John).',
    'An X-ray left L-00091 on 18/10/2026. It has no name now, so it has no Library ID.'];
  ok('TR1 (L9-A). once named, the patient shows its trail at once, oldest first, in plain words',
    JSON.stringify(await trailIs()) === JSON.stringify(wantTrail) && !!libIdIn(await libLine()), (await trailIs()).join(' | '));
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Trail TT1' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('TR2. closed and reopened, the same trail', JSON.stringify(await trailIs()) === JSON.stringify(wantTrail), (await trailIs()).join(' | '));
  const trailFit = (await page.locator('.library-trail').count()) === 1 ? await page.locator('.library-trail').evaluate((el) => ({ sw: el.scrollWidth,
    w: el.clientWidth, right: el.getBoundingClientRect().right, panelRight: el.closest('.case-panel').getBoundingClientRect().right })) : null;
  ok('TR3. the lines wrap inside the panel, nothing clipped', !!trailFit && trailFit.sw <= trailFit.w + 1 && trailFit.right <= trailFit.panelRight + 1, JSON.stringify(trailFit));
  await page.getByRole('button', { name: 'Superimposition ›' }).click(); await page.waitForSelector('.case-panel');
  ok('TR4. locked case: the trail is still shown, read-only', JSON.stringify(await trailIs()) === JSON.stringify(wantTrail), (await trailIs()).join(' | '));
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await toLibrary();
  await page.getByRole('button', { name: 'Open Demo Target T1' }).click(); await page.waitForSelector('g.landmark[data-id="S"]');
  ok('TR5. a patient with nothing to trace shows no trail list at all', (await page.locator('.library-trail').count()) === 0);

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
