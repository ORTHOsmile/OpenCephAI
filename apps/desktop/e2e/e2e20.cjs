// Automatic best smoke (plan 2026-10-27-automatic-best-model.md Task 13; spec 2026-10-27-automatic-best-model-design.md): the
// upgrade note and its way back; Models…'s Automatic best row, Aariz "(recommended)", Part F's Accept hidden while it is
// main; a new film traced with it in two steps (Go waits for SRPose; automatic sign-off waits too); the label and hover;
// the note and its Undo (refused by a locked library, then saved); a reopened film keeps its labels; Use again; its
// ghost beside a fixed main model. Also (Task 12 review, useAutoBest.ts's only coverage): 1b. while a fixed model is
// main, a change event shows no note; 8b. a newer change at the same point replaces the older note, not a second one.
// Final review I3: 9 and 13 check an Undo names the change it undoes; 13 an Undo in Models… that hands the point to a
// second model shows that adoption as a note; 13b a stale note’s Undo is refused in plain words. Follow-up round: 6b Mark
// verified waits for a coming point, then asks for a check; 11 Use again names its Undo; 13c no note while not main.
// Built UI in Chromium, stubbed Tauri runtime, fake library in localStorage. SYNTHETIC image, names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19', AB = 'auto-best';
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const ORIGINAL_19 = Object.keys(base);
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const counts = (ruler) => ({ ruler, machine: 0, fit: 0, assumed: 0 });
const blk = { caseIds: [], first: { importedAt: '2026-01-01T00:00:00.000Z', caseId: 'c000' }, last: { importedAt: '2026-01-01T00:59:00.000Z', caseId: 'c059' },
  incumbentMedianMm: 2.1, challengerMedianMm: 1.4, incumbentPlainMedianMm: 2.1, challengerPlainMedianMm: 1.4, incumbentMeanMm: 2.1, challengerMeanMm: 1.4,
  incumbentPlainMeanMm: 2.1, challengerPlainMeanMm: 1.4, incumbentWithin: 18, challengerWithin: 25, incumbentWithinShare: 0.6, challengerWithinShare: 0.83, acceptedUnmoved: 22, passed: true };
const goPair = { modelId: SR, basis: 'ruler', films: 60, available: counts(60), acceptedUnmoved: 42, leftOutEarlierFile: 0, verdict: { kind: 'offer', look: blk, check: blk } };
const best = { ruleVersion: 'best-point/3', choices: [], checks: [], points: ORIGINAL_19.map((id) => ({ landmarkId: id, current: AZ, offer: id === 'Go' ? SR : null,
  offerBasis: id === 'Go' ? 'ruler' : null, filmsByScale: counts(id === 'Go' ? 60 : 0), fineTunedRuler: 0, leftOutOtherPlacer: 0, pairs: id === 'Go' ? [goPair] : [] })) };
const adopted = { id: 1, landmarkId: 'Go', kind: 'adopted', modelId: SR, fingerprint: 'fp-sr', uses: SR, lastImportedAt: '2026-01-01T00:59:00.000Z', lastCaseId: 'c059',
  basis: 'mm, 60 ruler films', reason: null, numbers: {}, ruleVersion: 'best-point/3', operator: 'Dr A', at: '2026-10-27T01:00:00.000Z' };
// 8b (Task 12 review): a second change at the SAME point (N), delivered in a LATER sync call than noteN1 below, must
// replace that point's note rather than add a second one.
const noteN1 = { id: 2, landmarkId: 'N', kind: 'adopted', modelId: GU, fingerprint: 'fp-gu-n', uses: GU, lastImportedAt: '2026-01-01T00:59:00.000Z', lastCaseId: 'c059',
  basis: 'mm, 20 ruler films', reason: null, numbers: {}, ruleVersion: 'best-point/3', operator: 'Dr A', at: '2026-10-27T01:00:00.000Z' };
const noteN2 = { id: 3, landmarkId: 'N', kind: 'adopted', modelId: SR, fingerprint: 'fp-sr-n', uses: SR, lastImportedAt: '2026-01-01T00:59:00.000Z', lastCaseId: 'c059',
  basis: 'mm, 60 ruler films', reason: null, numbers: {}, ruleVersion: 'best-point/3', operator: 'Dr A', at: '2026-10-27T02:30:00.000Z' };
// 1b: an event waiting while a fixed model is main; opened on a third, otherwise-unused film so it never touches T1/T2.
const pnsOffMain = { id: 10, landmarkId: 'PNS', kind: 'adopted', modelId: SR, fingerprint: 'fp-sr-pns', uses: SR, lastImportedAt: '2026-01-01T00:59:00.000Z', lastCaseId: 'c059',
  basis: 'mm, 60 ruler films', reason: null, numbers: {}, ruleVersion: 'best-point/3', operator: 'Dr A', at: '2026-10-27T01:15:00.000Z' };
const lm = (id, dx, extra = {}) => ({ id, x: base[id][0] + dx, y: base[id][1] + 300, source: 'ai', verified: false, aiX: base[id][0] + dx, aiY: base[id][1] + 300,
  confidence: 0.9, placedBy: AZ, placedVia: AB, ...extra });
const kase = (id, tp, landmarks) => ({ id, path: `/Users/demo/${id}.png`, patientName: 'Demo Synthetic', patientKey: 'demo synthetic',
  dateOfBirth: '2010-01-02', scanId: null, timepoint: tp, takenOn: '2026-01-10', takenOnSource: 'label', facing: 'right', orientation: {}, display: {},   // SYNTHETIC
  spacingMm: 0.1, scaleSteps: 0, fit: null, machine: null, machineScale: null, title: null, ageOnFilm: null, ageOnFilmYears: null,
  verifiedAt: null, verifiedBy: null, createdAt: '2026-10-01T01:00:00Z', updatedAt: '2026-10-01T01:00:00Z', deletedAt: null,
  identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [], stage: null, inSeries: true, gender: null, referringPractitioner: null, population: null,
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [], landmarks });
const traced = ORIGINAL_19.map((id) => (id === 'Go' ? lm('Go', 460, { placedBy: SR }) : id === 'S' ? lm('S', 395, { source: 'ai-adjusted', aiX: base.S[0] + 400 })
  : id === 'N' ? lm('N', 400, { placedVia: null }) : lm(id, 400)));
// `events` (unchanged: feeds only Models…'s "Recent changes", via mapOf.latest) keeps just `adopted`; `pendingSync`
// (feeds only models_auto_best_sync, what useAutoBest's notes read) carries the extra 8b fixture `noteN1` too — it
// must never reach `events`, or it would overtake `adopted` as the "Recent changes" row checks 3/11 read.
const seed = { settings: {}, ops: ['Dr A'], runs: {}, best, autoOn: true, main: AZ, uses: { Go: SR }, kept: {}, events: [adopted], pendingSync: [adopted, noteN1], delayExtras: 1500,
  intro: { before: GU, keptDeclines: 1 }, cases: { c1: kase('c1', 'T1', []), c2: kase('c2', 'T2', traced), c3: kase('c3', 'T3', []) } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, base, AZ, SR, GU, AB, adopted }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const call = (cmd, a) => { const c = JSON.parse(localStorage.getItem('calls') || '[]'); c.push([cmd, a]); localStorage.setItem('calls', JSON.stringify(c)); };
    const now = () => '2026-10-27T02:00:00.000Z';
    const ids = Object.keys(base);
    const row = (id, title, main) => ({ id, title, tier: 'standard', recommended: id === AZ, status: 'ready', main, citation: 'SYNTHETIC', sizeMb: 1,
      licence: { version: '1', code: 'SYNTHETIC', weights: 'SYNTHETIC', summary: 'SYNTHETIC', url: '', nonCommercial: false }, licenceAccepted: true, stage: null, error: null, msPerFilm: 400, page: '', notice: null });
    const mapOf = (db) => ({ available: true, on: db.autoOn, uses: db.uses, notes: db.uses.Go ? { Go: { since: adopted.at, basis: 'mm, 60 ruler films' } } : {},
      kept: db.kept, latest: db.events.length ? [db.events[db.events.length - 1]] : [] });
    const det = (modelId, dx) => { const lms = ids.map((id) => ({ id, x: base[id][0] + dx, y: base[id][1] + 300, confidence: 0.9 }));
      return { modelId, imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub', timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks: lms,
        raw: lms.map((l, i) => ({ channel: i, landmarkId: l.id, x: l.x, y: l.y, peak: 0.9, cov: null })) }; };
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: AZ, searched: [], error: null };
          case 'plugin:event|listen': return 1;
          case 'plugin:dialog|message': call(cmd, a); return 'Yes';
          case 'models_list': return [row(AZ, 'Aariz', !db.autoOn && db.main === AZ), row(SR, 'SRPose', false), row(GU, 'GU2Net', !db.autoOn && db.main === GU)];
          case 'models_points': return [[AZ, 'Aariz'], [SR, 'SRPose'], [GU, 'GU2Net']].map(([m, title]) => ({ modelId: m, title, main: m === AZ,
            points: ids.map((id) => ({ id, status: { kind: 'original' } })) }));
          case 'models_best_per_point': return db.best;
          case 'models_weights_check_run': return null;
          case 'models_set_main': call(cmd, a); if (a.id === AB) db.autoOn = true; else { db.autoOn = false; db.main = a.id; } store(db); return null;
          case 'models_auto_best': return mapOf(db);
          case 'models_auto_best_sync': { call(cmd, a); const events = db.pendingSync; db.pendingSync = []; store(db); return { on: db.autoOn, events }; }
          case 'models_auto_best_undo': {
            call(cmd, a);
            if (localStorage.getItem('lockedLib')) throw 'stub: the library is locked (read-only)';
            // Final review I3, as the back end: the Undo names its change; refused unless it is the point's latest.
            const last = [...db.events].reverse().find((e) => e.landmarkId === a.landmarkId);
            if (!last || last.id !== a.eventId) throw `That note is out of date: Automatic best has changed ${a.landmarkId} since. See Settings › Best model › Recent changes.`;
            delete db.uses[a.landmarkId]; db.kept[a.landmarkId] = { modelId: SR, since: now() };
            const rows = [{ ...adopted, id: db.events.length + 1, kind: 'undone', uses: db.handOn || null, at: now() }];
            if (db.handOn) {   // the Undo hands the point to a second model: its adoption is written too (spec §6a)
              db.uses[a.landmarkId] = db.handOn;
              rows.push({ ...adopted, id: db.events.length + 2, modelId: db.handOn, uses: db.handOn, fingerprint: 'fp-gu', at: now() }); db.handOn = null;
            }
            db.events.push(...rows); store(db); return rows;
          }
          case 'models_auto_best_redo': {
            call(cmd, a);
            const last = [...db.events].reverse().find((e) => e.landmarkId === a.landmarkId);   // as the back end: names the Undo in force
            if (!last || last.kind !== 'undone' || last.id !== a.eventId) throw `That button is out of date: the Undo it names is no longer the one in force at ${a.landmarkId}.`;
          }
            db.uses[a.landmarkId] = SR; delete db.kept[a.landmarkId];
            db.events.push({ ...adopted, id: db.events.length + 1, kind: 'redone', at: now() }); store(db); return null;
          case 'models_auto_best_intro': { call(cmd, a);
            // M1 (leftovers Task 4): `introDelay` holds the first-open step, as a slow library would, then logs its end.
            if (db.introDelay) await new Promise((r) => setTimeout(r, db.introDelay));
            const d2 = load(); const n = d2.intro; d2.intro = null; store(d2); call('intro-done', {}); return n; }
          case 'models_auto_best_way_back': call(cmd, a); db.autoOn = false; db.main = GU; store(db); return GU;
          case 'models_main_point_source': if (db.unreadable) { call('unreadable-read', {}); return { ruleVersion: 'main-point-source/1', confirmationPending: true, points: Object.fromEntries(ids.map((id) => [id, AZ])),
            ownerChoices: { Go: SR }, ownerChoiceNotes: {}, autoBest: null, autoBestUnreadable: true }; }
            return { ruleVersion: 'main-point-source/1', confirmationPending: true, points: Object.fromEntries(ids.map((id) => [id, AZ])),
            ownerChoices: {}, ownerChoiceNotes: {}, autoBest: mapOf(db) };
          case 'detect_landmarks': call(cmd, {}); return { ...det(AZ, 400), facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9 };
          case 'detect_extras': { await new Promise((r) => setTimeout(r, db.delayExtras)); return [{ modelId: SR, title: 'SRPose', error: null, timedOut: false, detection: det(SR, 460) }]; }
          case 'library_list': return Object.values(db.cases).map((c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn,
            createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0,
            verifiedAt: c.verifiedAt, deletedAt: null, patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true }));
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, orientation: a.edit.orientation, display: a.edit.display, updatedAt: now() });
            if (c.landmarks.some((l) => !l.verified)) { c.verifiedAt = null; c.verifiedBy = null; } store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_set_verified': { call(cmd, a); const c = db.cases[a.caseId]; c.verifiedAt = a.verified ? now() : null; c.verifiedBy = a.verified ? 'Dr A' : null; store(db); return null; }
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
  }, { png, base, AZ, SR, GU, AB, adopted });

  const calls = async (cmd) => (await page.evaluate(() => JSON.parse(localStorage.getItem('calls') || '[]'))).filter(([c]) => c === cmd);
  const dlg = () => page.locator('[role="dialog"][aria-label="Models"]');
  const openModels = async () => { await page.getByRole('button', { name: 'Models…' }).first().click(); await dlg().waitFor(); };
  const closeModels = async () => { await dlg().getByRole('button', { name: 'Close' }).click(); };
  const row = () => dlg().locator('section.auto-best-row');
  // Recent changes and Part F's table live in Settings › Best model since plan 2026-10-29 Task 9 (they were in Models…).
  const sdlg = () => page.locator('[role="dialog"][aria-label="Settings"]');
  const best = () => sdlg().locator('.settings-best-model');
  const openBest = async () => { await page.getByRole('button', { name: 'Settings…' }).first().click(); await sdlg().getByRole('tab', { name: 'Best model' }).click(); await best().waitFor(); };
  const closeBest = async () => { await sdlg().getByRole('button', { name: 'Close' }).click(); };
  const saved = (c, id) => page.evaluate(([c, id]) => JSON.parse(localStorage.getItem('fakeLib')).cases[c].landmarks.find((l) => l.id === id) ?? null, [c, id]);
  const labelOf = (id) => page.evaluate((id) => { const b = [...document.querySelectorAll('.inspector .lm-list button')].find((x) => x.querySelector('b')?.textContent === id); return b ? b.title.split(' — ').pop() : ''; }, id);
  const hoverOf = async (id) => { await page.locator('.lm-list button', { has: page.locator('b', { hasText: new RegExp(`^${id}$`) }) }).click(); return page.locator('.point-about .placed-by').getAttribute('title').catch(() => ''); };
  const openCase = async (tp) => { await page.locator('.lib-nav button', { hasText: 'All cases' }).click(); await page.locator('.cards .card .open', { hasText: tp }).first().click(); await page.waitForSelector('g.landmark[data-id="S"]'); };
  const toLibrary = async () => { await page.getByRole('button', { name: '‹ Library' }).click(); await page.waitForSelector('.library'); };

  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');

  // 1. The upgrade note (D1), once, with the way back to the model it was (GU2Net) and the kept declines (Q5 A).
  const intro = page.locator('.auto-best-intro');
  await intro.waitFor({ timeout: 5000 }).catch(() => {});
  const introText = await intro.innerText().catch(() => '');
  ok('1. the upgrade note says what changed, keeps your declines, and offers the way back', introText.includes('Automatic best now starts your tracings.')
    && introText.includes('Your Part F declines are kept.') && introText.includes('Go back to GU2Net'), introText);
  await intro.getByRole('button', { name: 'Go back to GU2Net' }).click();
  await page.waitForTimeout(300);
  ok('1. the way back is sent and the note goes', (await calls('models_auto_best_way_back')).length === 1 && (await intro.count()) === 0);

  // 1b (Task 12 review, useAutoBest.ts's only coverage): while a fixed model is main (GU2Net, just chosen by the way
  // back), a change event waiting at the back end must not become a note — the hook drops events when `on` is false.
  // Opened on T3 (otherwise unused) so this never touches the T1/T2 fixtures the rest of the smoke reads.
  await page.evaluate(({ pnsOffMain }) => {
    const db = JSON.parse(localStorage.getItem('fakeLib')); db.pendingSync = [pnsOffMain]; localStorage.setItem('fakeLib', JSON.stringify(db));
  }, { pnsOffMain });
  const syncBefore1b = (await calls('models_auto_best_sync')).length;
  await openCase('T3');
  await page.waitForFunction((n) => JSON.parse(localStorage.getItem('calls') || '[]').filter(([c]) => c === 'models_auto_best_sync').length > n, syncBefore1b, { timeout: 5000 }).catch(() => {});
  // (Go's and N's notes from the mount-time sync, taken while Automatic best was still on, are already showing — the
  // check is scoped to THIS event's point, PNS, never shown by anything else in this smoke.)
  ok('1b. while a fixed model is main, a waiting change shows no note', (await calls('models_auto_best_sync')).length > syncBefore1b
    && (await page.locator('.auto-best-note[data-point="PNS"]').count()) === 0, await page.locator('.auto-best-notes').innerText().catch(() => '(none)'));
  await page.waitForTimeout(1800);   // let T3's late SRPose extra (delayExtras) resolve and save before we navigate away
  await toLibrary();

  // 2. Models…: unchosen after the way back; the base (Aariz) fills the rest even beside a fixed GU2Net (owner answer 2 of
  // 29 Oct, which replaced Q2's "your main model"), and the old recommendation line is gone; Accept shown (control); then chosen.
  await openModels();
  await row().waitFor();
  let r = await row().innerText();
  ok('2. after the way back: not chosen, the base (Aariz) fills the rest, no main-model line', !(await row().locator('input[type=radio]').isChecked())
    && r.includes('Uses SRPose for Go; Aariz for the other 18 points.') && !r.includes('Points without evidence use your main model'), r);
  ok("2. Aariz's radio reads 'Starts the tracing (recommended)'", (await dlg().locator('section.model-row[data-id="aariz-cepha29"] label').first().innerText()).includes('Starts the tracing (recommended)'));
  await closeModels();
  await openBest();
  ok('2. Part F offers Accept while a fixed model is main (control)', (await sdlg().locator('section.best-per-point tr[data-point="Go"] button', { hasText: 'Accept' }).count()) === 1);
  await closeBest();
  await openModels();
  await row().locator('input[type=radio]').check();
  await page.waitForFunction(() => document.querySelector('section.auto-best-row input[type=radio]')?.checked, null, { timeout: 5000 }).catch(() => {});
  r = await row().innerText();
  ok('3. chosen: sent, its radio on, Aariz fills the rest', (await calls('models_set_main')).some(([, a]) => a.id === 'auto-best')
    && (await row().locator('input[type=radio]').isChecked()) && r.includes('Uses SRPose for Go; Aariz for the other 18 points.'), r);
  await closeModels();
  await openBest();
  const st = await best().innerText();
  ok('3. Settings › Best model: Recent changes with Undo', st.includes('Gonion (Go): SRPose since 27/10/2026, decided on 60 ruler films.')
    && (await best().locator('.auto-best-recent').getByRole('button', { name: 'Undo' }).count()) === 1, st);
  const bp = await sdlg().locator('section.best-per-point').innerText();
  ok("3. Part F: no Accept while Automatic best is main, and the line says why", (await sdlg().locator('section.best-per-point button', { hasText: 'Accept' }).count()) === 0
    && bp.includes('Automatic best is your main model'), bp.slice(0, 200));
  await closeBest();

  // 4–7. A new film in two steps; automatic sign-off waits for Go.
  await openCase('T1');
  ok('4. Aariz’s points are shown at once; Go waits for SRPose', (await page.locator('g.landmark[data-id="Go"]').count()) === 0
    && (await page.locator('g.landmark[data-id="N"]').count()) === 1);
  const note = page.locator('.auto-best-note[data-point="Go"]');
  ok('5. the note says what changed, with Undo', (await note.innerText().catch(() => '')).includes('Automatic best: Gonion now from SRPose, decided on 60 ruler films.')
    && (await note.getByRole('button', { name: 'Undo' }).count()) === 1);
  await page.getByRole('tab', { name: 'Landmarks' }).click().catch(() => {});
  await page.getByRole('button', { name: /^Accept remaining/ }).click();
  await page.waitForTimeout(300);
  ok('6. Accept remaining before Go arrives does not sign off', (await calls('library_set_verified')).length === 0 && (await page.locator('g.landmark[data-id="Go"]').count()) === 0);
  // 6b (owner, 28 Oct): Mark tracing verified pressed while Go is still coming waits for it, and says so.
  await page.getByRole('button', { name: 'Mark tracing verified' }).click();
  await page.waitForTimeout(200);
  const waitLine = await page.locator('.hold-line').innerText().catch(() => '');
  ok('6b. Mark verified while Go is coming: not signed, and the status row says it is waiting', (await calls('library_set_verified')).length === 0
    && waitLine === 'Waiting for a point still coming from another model before signing off.' && (await page.locator('g.landmark[data-id="Go"]').count()) === 0, waitLine);
  await page.waitForSelector('g.landmark[data-id="Go"]', { timeout: 5000 }).catch(() => {});
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'Go')?.placedBy === 'srpose-cldet23', null, { timeout: 5000 }).catch(() => {});
  const checkLine = await page.locator('.hold-line').innerText().catch(() => '');
  ok('6b. Go arrived: still not signed; you are asked to check it', (await calls('library_set_verified')).length === 0
    && checkLine === 'Gonion (Go) arrived after you pressed Mark verified: check it, then mark verified.', checkLine);
  const go = await saved('c1', 'Go'), s = await saved('c1', 'S');
  ok('7. Go arrives from SRPose, unverified, placed via Automatic best', go && go.x === base.Go[0] + 460 && go.placedBy === SR && go.placedVia === AB && !go.verified, JSON.stringify(go));
  ok('7. S from Aariz, via Automatic best (control: the instrument sees both models)', s && s.x === base.S[0] + 400 && s.placedBy === AZ && s.placedVia === AB, JSON.stringify(s));
  ok('7. still not signed off: Go is not accepted yet', (await calls('library_set_verified')).length === 0);
  ok('8. the label: Automatic best · SRPose at Go, Automatic best · Aariz at S', (await labelOf('Go')) === 'Automatic best · SRPose' && (await labelOf('S')) === 'Automatic best · Aariz',
    `${await labelOf('Go')} / ${await labelOf('S')}`);
  const why = await hoverOf('Go');
  ok('8. the hover gives the reason', why === "Part F's rule favours SRPose here: closer to your points than Aariz (mm, 60 ruler films).", why);
  // 8b (Task 12 review): a newer change arriving at the SAME point (N, already noted from noteN1 at mount) must
  // replace that note, not sit beside it — queued now so it lands in the sync afterSignOff fires below.
  await page.evaluate(({ noteN2 }) => {
    const db = JSON.parse(localStorage.getItem('fakeLib')); db.pendingSync = [noteN2]; localStorage.setItem('fakeLib', JSON.stringify(db));
  }, { noteN2 });
  await page.getByRole('button', { name: 'Accept position' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('calls') || '[]').some(([c]) => c === 'library_set_verified'), null, { timeout: 5000 }).catch(() => {});
  ok('8. accepting Go signs the tracing off, and Automatic best checks again after it', (await calls('library_set_verified')).length === 1 && (await calls('models_auto_best_sync')).length >= 2);
  const noteN = page.locator('.auto-best-note[data-point="N"]');
  await page.waitForFunction(() => (document.querySelector('.auto-best-note[data-point="N"]')?.textContent || '').includes('SRPose'), null, { timeout: 5000 }).catch(() => {});
  ok('8b. a newer change at the same point (N) replaces the older note, not a second one', (await noteN.count()) === 1
    && (await noteN.innerText()).includes('Automatic best: Nasion now from SRPose, decided on 60 ruler films.'), await noteN.count() ? await noteN.innerText() : '(missing)');

  // 9. Undo: refused by a locked library (shown, the note stays), then saved (the note goes).
  await page.evaluate(() => localStorage.setItem('lockedLib', '1'));
  await note.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(300);
  ok('9. a locked library: the Undo is refused, said, and the note stays', (await page.locator('.auto-best-notes').innerText()).includes('That Undo was not saved: stub: the library is locked (read-only)')
    && (await note.count()) === 1);
  await page.evaluate(() => localStorage.removeItem('lockedLib'));
  await note.getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(300);
  ok('9. then saved: sent for Go, naming the note’s change (I3), and the note goes', (await calls('models_auto_best_undo')).filter(([, a]) => a.landmarkId === 'Go' && a.eventId === adopted.id).length === 2
    && (await note.count()) === 0, JSON.stringify(await calls('models_auto_best_undo')));

  // 10. A film traced earlier, reopened: its labels from the stored placedVia; today's verdict in the hover.
  await toLibrary(); await openCase('T2');
  await page.getByRole('tab', { name: 'Landmarks' }).click().catch(() => {});
  ok('10. reopened: Automatic best · SRPose at Go, Moved by you · was: Automatic best · Aariz at S', (await labelOf('Go')) === 'Automatic best · SRPose'
    && (await labelOf('S')) === 'Moved by you · was: Automatic best · Aariz', `${await labelOf('Go')} / ${await labelOf('S')}`);
  ok('10. control: a point stored without placedVia keeps the plain label', (await labelOf('N')) === 'Aariz', await labelOf('N'));
  const whyNow = await hoverOf('Go');
  ok('10. after your Undo the hover says what it would use today', whyNow === 'Placed by SRPose, chosen by Automatic best when traced; today it would use Aariz.', whyNow);

  // 11. Use SRPose again; 12. Aariz as a fixed main model: the Automatic best ghost at SRPose's mark.
  await openBest();
  await best().getByRole('button', { name: 'Use SRPose again' }).click();
  await page.waitForTimeout(300);
  ok('11. Use SRPose again is sent and Undo is back', (await calls('models_auto_best_redo')).length === 1
    && (await calls('models_auto_best_redo'))[0][1].eventId === await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).events.filter((e) => e.kind === 'undone').pop().id) && (await best().locator('.auto-best-recent').getByRole('button', { name: 'Undo' }).count()) === 1);
  await closeBest();
  await openModels();
  await dlg().locator('section.model-row[data-id="aariz-cepha29"] input[type=radio]').check();
  await page.waitForTimeout(300);
  await closeModels();
  const ghostGo = 'g.ghost[data-model="auto-best"] g.ghost-pt[data-id="Go"] circle.ghost-hit';
  const srGhostGo = `g.ghost[data-model="${SR}"] g.ghost-pt[data-id="Go"] circle.ghost-hit`;
  // Owner, 28 Oct ("one mark, both names"): SRPose's own evidence IS what Automatic best uses at Go, so the two
  // ghosts coincide on the same pixel; the merge drops Automatic best's own mark there and names both models in
  // SRPose's own hover instead — one mark, not two, while SRPose's ghost is shown.
  await page.waitForSelector(srGhostGo, { timeout: 5000 }).catch(() => {});
  ok('12. beside Aariz as a fixed main model, the Automatic best ghost is listed (merged into SRPose’s own mark at Go)',
    (await page.locator('.ghost-key').getByLabel('Show Automatic best', { exact: true }).count()) === 1
    && (await page.locator(ghostGo).count()) === 0 && (await page.locator(srGhostGo).count()) === 1);
  // 12a. One mark, both names: hover the single (SRPose's) mark WITHOUT unticking SRPose.
  const b1 = await page.locator(srGhostGo).boundingBox();
  if (b1) await page.mouse.move(b1.x + b1.width / 2, b1.y + b1.height / 2);
  await page.locator('.ghost-hover-label').waitFor({ timeout: 3000 }).catch(() => {});
  const gl1 = await page.locator('.ghost-hover-label').innerText().catch(() => '');
  ok('12a. one mark, both names: the hover names SRPose and that Automatic best uses it', gl1.startsWith('SRPose (Automatic best uses this): '), gl1);
  await page.mouse.move(0, 0);   // leave, so the next hover below is a fresh enter, not a stale "fading" label
  // 12b. SRPose's ghost hidden in the ghost key: Automatic best's own mark stands alone with its normal hover.
  await page.locator('.ghost-key').getByLabel('Show SRPose', { exact: true }).uncheck();
  await page.waitForSelector(ghostGo, { timeout: 5000 }).catch(() => {});
  ok('12b. SRPose hidden: Automatic best’s own mark shows alone', (await page.locator(ghostGo).count()) === 1 && (await page.locator(srGhostGo).count()) === 0);
  const b2 = await page.locator(ghostGo).boundingBox();
  if (b2) await page.mouse.move(b2.x + b2.width / 2, b2.y + b2.height / 2);
  await page.locator('.ghost-hover-label').waitFor({ timeout: 3000 }).catch(() => {});
  const gl2 = await page.locator('.ghost-hover-label').innerText().catch(() => '');
  ok('12b. its own hover names the model behind the point', gl2.startsWith('Automatic best · SRPose: '), gl2);

  // 13 (final review I3). An Undo in Models… that hands Gonion to a second model (GU2Net): the Undo names the change it
  // undoes, and GU2Net's adoption shows as a note beside the film, like any other change (spec §6a).
  // 13c (follow-up round, concern 4): as for the routine check, an Undo in Models… shows no note while Automatic best
  // is not the main model (Aariz is the fixed main here) — even when it hands the point to another model.
  await openBest();
  const latestGo0 = await page.evaluate(() => [...JSON.parse(localStorage.getItem('fakeLib')).events].reverse().find((e) => e.landmarkId === 'Go').id);
  await page.evaluate((GU) => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.handOn = GU; localStorage.setItem('fakeLib', JSON.stringify(db)); }, GU);
  await best().locator('li[data-point="Go"]').getByRole('button', { name: 'Undo' }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  await closeBest();
  await page.waitForTimeout(300);
  ok('13c. Automatic best not main: the Undo is sent (naming its change) but no note appears', (await calls('models_auto_best_undo')).pop()?.[1].eventId === latestGo0
    && (await note.count()) === 0, await page.locator('.auto-best-notes').innerText().catch(() => '(none)'));
  // Then Automatic best is main again (stub), Go back with SRPose: the same Undo now shows GU2Net's note.
  await page.evaluate((SR) => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.autoOn = true; db.uses.Go = SR;
    db.events.push({ ...db.events[0], id: db.events.length + 1, kind: 'redone', uses: SR }); localStorage.setItem('fakeLib', JSON.stringify(db)); }, SR);
  await openBest();
  const latestGo = await page.evaluate(() => [...JSON.parse(localStorage.getItem('fakeLib')).events].reverse().find((e) => e.landmarkId === 'Go').id);
  await page.evaluate((GU) => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.handOn = GU; localStorage.setItem('fakeLib', JSON.stringify(db)); }, GU);
  await best().locator('li[data-point="Go"]').getByRole('button', { name: 'Undo' }).click();
  await page.waitForTimeout(300);
  await closeBest();
  const lastUndo = (await calls('models_auto_best_undo')).pop();
  await page.waitForFunction(() => (document.querySelector('.auto-best-note[data-point="Go"]')?.textContent || '').includes('GU2Net'), null, { timeout: 5000 }).catch(() => {});
  ok('13. an Undo in Models… names the change it undoes', !!lastUndo && lastUndo[1].eventId === latestGo, JSON.stringify(lastUndo));
  ok('13. the Undo handed Gonion to GU2Net: its adoption is a note beside the film, with Undo', (await note.count()) === 1
    && (await note.innerText()).includes('Automatic best: Gonion now from GU2Net') && (await note.getByRole('button', { name: 'Undo' }).count()) === 1,
    await note.innerText().catch(() => '(missing)'));
  // 13b. That note goes stale (a later change at Gonion lands elsewhere): its Undo is refused, said in plain words, and
  // it never undoes the later change.
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.events.push({ ...db.events[0], id: 99, kind: 'returned', uses: null }); localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await note.getByRole('button', { name: 'Undo' }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const notesText = await page.locator('.auto-best-notes').innerText().catch(() => '');
  ok('13b. a stale note’s Undo is refused with a plain message; nothing undone', notesText.includes('That Undo was not saved: That note is out of date: Automatic best has changed Go since.')
    && await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).events.slice(-1)[0].id === 99), notesText);

  // M1 (leftovers Task 4). A new launch whose first-open step takes 2.5 s; an untraced film is opened at once. The
  // check before its tracing must wait for the step (it carries the owner's Part F declines), so neither the check nor
  // the detection may start before the step ends. Positive control: App wiring `beforePlacing: () => ab.sync()` (the
  // old one) -> the check is logged before 'intro-done' and M1a fails.
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify({ ...s, introDelay: 2500, intro: null })); }, seed);
  await page.reload(); await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await page.locator('.cards .card .open', { hasText: 'T1' }).first().click();
  await page.waitForTimeout(1200);                                         // the step is still running
  const order1 = (await page.evaluate(() => JSON.parse(localStorage.getItem('calls') || '[]'))).map(([c]) => c);
  ok('M1a. a film opened while the first-open step runs: no check and no detection yet', order1.includes('models_auto_best_intro')
    && !order1.includes('intro-done') && !order1.includes('models_auto_best_sync') && !order1.includes('detect_landmarks'), order1.join(' > '));
  await page.waitForSelector('g.landmark[data-id="S"]', { timeout: 8000 }).catch(() => {});
  const order2 = (await page.evaluate(() => JSON.parse(localStorage.getItem('calls') || '[]'))).map(([c]) => c);
  const at = (c) => order2.indexOf(c);
  ok('M1b. once the step ends: the check, then the tracing; the film is traced', at('intro-done') >= 0 && at('models_auto_best_sync') > at('intro-done')
    && at('detect_landmarks') > at('intro-done') && (await page.locator('g.landmark[data-id="S"]').count()) === 1, order2.join(' > '));

  // M4 (leftovers Task 5, owner ruling 2 Nov). Automatic best's choices cannot be read (the stub returns autoBest: null,
  // autoBestUnreadable: true, and a Part F switch Go -> SRPose). The base places every point at once (Go from Aariz, no
  // wait for SRPose), the one plain note shows, and no label says "Automatic best". Then the choices read again on the
  // next film: the note goes and Go is SRPose's again. Positive control: remove the early return in placement.ts `wanted`
  // -> Go waits for SRPose and M4b fails.
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify({ ...s, intro: null, pendingSync: [], unreadable: true, delayExtras: 1500 })); }, seed);
  await page.reload(); await page.waitForSelector('.library');
  await openCase('T1');
  await page.waitForSelector('.auto-best-unreadable', { timeout: 5000 }).catch(() => {});
  const m4note = await page.locator('.auto-best-unreadable').first().innerText().catch(() => '(missing)');
  ok('M4a. the one plain note names the base and says any point it lacks comes from another model', m4note === "Automatic best's choices couldn't be read, so Aariz placed this film's points (any it doesn't find come from another model). This clears at the next tracing once the choices can be read.", m4note);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.some((l) => l.id === 'Go'), null, { timeout: 4000 }).catch(() => {});
  const m4go = await saved('c1', 'Go');
  ok('M4b. Go (the point Part F switched to SRPose) is placed by the base, at once, with no Automatic best label',
    !!m4go && m4go.x === base.Go[0] + 400 && m4go.placedBy === AZ && !m4go.placedVia && (await page.locator('g.landmark[data-id="Go"]').count()) === 1
    && (await labelOf('Go')) !== 'Automatic best · SRPose', `${JSON.stringify(m4go)} / ${await labelOf('Go')}`);
  await page.waitForTimeout(1800);   // SRPose's run lands: it must not take Go over
  const m4go2 = await saved('c1', 'Go');
  ok('M4c. SRPose arriving later does not take Go over', !!m4go2 && m4go2.placedBy === AZ && m4go2.x === base.Go[0] + 400, JSON.stringify(m4go2));
  // I1 (fix round 1): the note describes only the film on screen. Still unreadable throughout this part.
  await toLibrary();
  ok('M4e. back in the Library: no note', (await page.locator('.auto-best-unreadable').count()) === 0);
  await openCase('T2');                                              // already traced: no detection runs
  await page.waitForTimeout(400);
  ok('M4f. an already-traced film opened after the fallback film: no note', (await page.locator('.auto-best-unreadable').count()) === 0);
  await toLibrary();
  await page.reload(); await page.waitForSelector('.library');       // launch with the choices still unreadable
  await page.waitForTimeout(400);
  ok('M4g. a fresh launch with the choices unreadable: no note in the Library', (await page.locator('.auto-best-unreadable').count()) === 0);
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.unreadable = false; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await openCase('T3');
  await page.waitForTimeout(400);
  ok('M4d. the next film whose choices read: no note', (await page.locator('.auto-best-unreadable').count()) === 0);

  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.log(`FAIL  e2e20 crashed: ${e && e.stack || e}`); process.exit(1); });
