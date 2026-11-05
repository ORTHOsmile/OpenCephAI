// Part F smoke (plan 2026-10-18-part-f.md Task 15; chain spec §5, §6 S1): Library › Models… › "Best model per point": the
// rule's words and the films that decided, an offer accepted (asked first) then undone, a decline, a refused answer, a
// read failure, closed and reopened; a Re-detect that places Go from the chosen model with the label and its hover; how
// each point was accepted (answer 7); the weights check (its progress while running, films it could not run, a point
// with no older films to compare), a worse new file warned with its numbers side by side and a way back to Aariz; a
// locked or read-only library leaves Accept and Undo answered with the notice and nothing changed (Task 9-10 review,
// 27 Oct). Built UI in Chromium, stubbed Tauri runtime, fake library in localStorage. SYNTHETIC image,
// names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19';
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const ORIGINAL_19 = Object.keys(base);
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const blk = (am, cm, aw, cw, acc) => ({ caseIds: [], first: { importedAt: '2026-01-01T00:00:00.000Z', caseId: 'c000' }, last: { importedAt: '2026-01-01T00:59:00.000Z', caseId: 'c059' },
  incumbentMedianMm: am, challengerMedianMm: cm, incumbentPlainMedianMm: am, challengerPlainMedianMm: cm, incumbentMeanMm: am, challengerMeanMm: cm,
  incumbentPlainMeanMm: am, challengerPlainMeanMm: cm, incumbentWithin: aw, challengerWithin: cw, incumbentWithinShare: aw / 30, challengerWithinShare: cw / 30,
  acceptedUnmoved: acc, passed: true });
const counts = (ruler, machine = 0, fit = 0, assumed = 0) => ({ ruler, machine, fit, assumed });
const goPair = { modelId: SR, basis: 'ruler', films: 60, available: counts(60, 0, 0, 4), acceptedUnmoved: 42, leftOutEarlierFile: 0,
  verdict: { kind: 'offer', look: blk(2.1, 1.4, 18, 25, 22), check: blk(2.0, 1.5, 19, 24, 21) } };
const pnsPair = { modelId: GU, basis: 'ruler', films: 60, available: counts(60), acceptedUnmoved: 30, leftOutEarlierFile: 0,
  verdict: { kind: 'offer', look: blk(1.9, 1.5, 20, 22, 15), check: blk(1.8, 1.4, 21, 23, 15) } };
const best = { ruleVersion: 'best-point/3', choices: [], checks: [], points: ORIGINAL_19.map((id) => ({ landmarkId: id, current: AZ, offer: null, offerBasis: null,
  filmsByScale: counts(id === 'S' ? 12 : 0), fineTunedRuler: 0, leftOutOtherPlacer: 0,
  pairs: id === 'Go' ? [goPair] : id === 'PNS' ? [pnsPair] : id === 'S'
    ? [{ modelId: SR, basis: 'ruler', films: 12, available: counts(12), acceptedUnmoved: 9, leftOutEarlierFile: 0, verdict: { kind: 'notEnough', films: 12 } }] : [] })) };
Object.assign(best.points.find((p) => p.landmarkId === 'Go'), { offer: SR, offerBasis: 'ruler', filmsByScale: counts(60, 0, 0, 4), leftOutOtherPlacer: 2 });
Object.assign(best.points.find((p) => p.landmarkId === 'PNS'), { offer: GU, offerBasis: 'ruler', filmsByScale: counts(60) });
// Owner Q4: SRPose's new file, checked on 50 older films, worse on Go; Go is switched to SRPose when this is shown.
// Also carries 3 films it could not run (a weights-check edge the Task 12 review flagged untested) and a point
// (PNS) the new file placed nowhere on any of the 30 checked films (verdict NoFilms: "no older film to compare").
const srCheck = { modelId: SR, fingerprint: 'fp-new', version: 'weights-check/1', filmsChecked: 60, filmsDue: 0, filmsFailed: 3, failedDetail: 'stub: 3 films unreadable', goBack: ['Go'],
  points: [{ landmarkId: 'Go', films: 50, noNewPoint: 0, oldMedianMm: 1.1, newMedianMm: 1.45, oldWithin: 48, newWithin: 41, verdict: { kind: 'worse', medianUp: true, fewerWithin: true } },
    { landmarkId: 'PNS', films: 30, noNewPoint: 30, oldMedianMm: null, newMedianMm: null, oldWithin: 0, newWithin: 0, verdict: { kind: 'noFilms' } }] };
// A check for a model still running (Task 12 review: "running states render-untested") — 30 films due, none yet.
const srRunning = { modelId: SR, fingerprint: 'fp-running', version: 'weights-check/1', filmsChecked: 0, filmsDue: 30, filmsFailed: 0, failedDetail: null, goBack: [], points: [] };
const aiLm = (id, x, y) => ({ id, x, y, source: 'ai', verified: false, aiX: x, aiY: y, confidence: 0.9, placedBy: AZ });
const seed = { settings: {}, ops: ['Dr A'], runs: {}, best, cases: { c1: { id: 'c1', path: '/Users/demo/c1.png', patientName: 'Demo Synthetic', patientKey: 'demo synthetic',
  dateOfBirth: '2010-01-02', scanId: null, timepoint: 'T1', takenOn: '2026-01-10', takenOnSource: 'label', facing: 'right', orientation: {}, display: {},   // SYNTHETIC
  spacingMm: 0.1, scaleSteps: 0, fit: null, machine: null, machineScale: null, title: null, ageOnFilm: null, ageOnFilmYears: null,
  verifiedAt: null, verifiedBy: null, createdAt: '2026-10-01T01:00:00Z', updatedAt: '2026-10-01T01:00:00Z', deletedAt: null,
  identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [], stage: null, inSeries: true, gender: null, referringPractitioner: null, population: null,
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [],
  landmarks: Object.entries(base).map(([id, [x, y]]) => aiLm(id, x + 390, y + 300)) } } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, base, AZ, SR, GU, goPair }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const call = (cmd, a) => { const c = JSON.parse(localStorage.getItem('calls') || '[]'); c.push([cmd, a]); localStorage.setItem('calls', JSON.stringify(c)); };
    const now = () => '2026-10-18T01:00:00.000Z';
    const ids = Object.keys(base);
    const row = (id, title, main) => ({ id, title, tier: 'standard', recommended: id === AZ, status: 'ready', main, citation: 'SYNTHETIC', sizeMb: 1,
      licence: { version: '1', code: 'SYNTHETIC', weights: 'SYNTHETIC', summary: 'SYNTHETIC', url: '', nonCommercial: false }, licenceAccepted: true, stage: null, error: null, msPerFilm: 400, page: '', notice: null });
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    // Event listeners are kept so the fake back end can replay the weights check's progress event (cephtrace://weights-check),
    // the same pattern as e2e3's extra-model bars.
    window.__listeners = [];
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: AZ, searched: [], error: null };
          case 'plugin:event|listen': window.__listeners.push(a); return 1;
          case 'plugin:dialog|message': call(cmd, a); return localStorage.getItem('dialogReply') || 'Yes';
          case 'models_list': return [row(AZ, 'Aariz', true), row(SR, 'SRPose', false), row(GU, 'GU2Net', false)];
          case 'models_points': return [[AZ, 'Aariz'], [SR, 'SRPose'], [GU, 'GU2Net']].map(([m, title]) => ({ modelId: m, title, main: m === AZ,
            points: ids.map((id) => ({ id, status: { kind: 'original' } })) }));
          case 'models_best_per_point': if (localStorage.getItem('failBest')) throw 'stub: unreadable'; return db.best;
          case 'models_weights_check_run': call(cmd, a); return null;
          case 'models_point_choice': {
            call(cmd, a);
            if (localStorage.getItem('lockedLib')) throw 'stub: the library is locked (read-only)';
            if (localStorage.getItem('failAnswer')) throw 'stub: the library refused';
            const p = db.best.points.find((x) => x.landmarkId === a.landmarkId);
            const add = (action, last) => db.best.choices.push({ id: db.best.choices.length + 1, landmarkId: a.landmarkId, modelId: a.modelId, action, ruleVersion: 'best-point/3',
              lastImportedAt: last ? '2026-01-01T00:59:00.000Z' : null, lastCaseId: last ? 'c059' : null, basis: last ? 'mm, 60 ruler films' : null,
              numbers: last ? p.pairs[0] : {}, operator: 'Dr A', at: now() });
            if (a.answer === 'accept') { add('accepted', true); Object.assign(p, { current: a.modelId, offer: null, pairs: [] }); }
            if (a.answer === 'decline') { add('declined', true); Object.assign(p, { offer: null, offerBasis: null,
              pairs: [{ modelId: a.modelId, basis: 'ruler', films: 0, available: { ruler: 0, machine: 0, fit: 0, assumed: 0 }, acceptedUnmoved: 0, leftOutEarlierFile: 0, verdict: { kind: 'notEnough', films: 0 } }] }); }
            if (a.answer === 'undo') { add('undone', false); Object.assign(p, { current: AZ, offer: SR, offerBasis: 'ruler', pairs: [goPair] }); }
            store(db); return null;
          }
          case 'models_main_point_source': {
            const owner = {}, notes = {};
            for (const c of db.best.choices) {
              if (c.action === 'accepted') { owner[c.landmarkId] = c.modelId; notes[c.landmarkId] = { since: c.at, basis: c.basis }; }
              if (c.action === 'undone') { delete owner[c.landmarkId]; delete notes[c.landmarkId]; }
            }
            return { ruleVersion: 'main-point-source/1', confirmationPending: true, points: Object.fromEntries(ids.map((id) => [id, AZ])), ownerChoices: owner, ownerChoiceNotes: notes };
          }
          case 'detect_landmarks': { window.__detects = (window.__detects || 0) + 1;
            const lms = Object.entries(base).map(([id, [x, y]]) => ({ id, x: x + 400, y: y + 300, confidence: 0.9 }));
            return { modelId: AZ, imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub', timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 },
              landmarks: lms, facingLeft: false, meanPeakRight: 12.6, meanPeakLeft: 4.9, raw: lms.map((l, i) => ({ channel: i, landmarkId: l.id, x: l.x, y: l.y, peak: 0.9, cov: null })) }; }
          // SRPose's answer: every point 60 px further right than Aariz's.
          case 'detect_extras': return [{ modelId: SR, title: 'SRPose', error: null, timedOut: false, detection: { modelId: SR, imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
            timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks: Object.entries(base).map(([id, [x, y]]) => ({ id, x: x + 460, y: y + 300, confidence: 0.9 })), raw: [] } }];
          case 'library_list': return Object.values(db.cases).map((c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn,
            createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0,
            verifiedAt: c.verifiedAt, deletedAt: null, patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true }));
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, orientation: a.edit.orientation, display: a.edit.display, updatedAt: now() }); store(db);
            return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
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
  }, { png, base, AZ, SR, GU, goPair });

  const calls = async (cmd) => (await page.evaluate(() => JSON.parse(localStorage.getItem('calls') || '[]'))).filter(([c]) => c === cmd);
  // Part F's table lives in Settings › Best model since plan 2026-10-29 Task 9 (it was in Models…); every check below is
  // unchanged. `openModels`/`closeModels` keep their names and now open and close that tab.
  const section = () => page.locator('[role="dialog"][aria-label="Settings"] section.best-per-point');
  const openModels = async () => {
    await page.getByRole('button', { name: 'Settings…' }).first().click();
    await page.locator('[role="dialog"][aria-label="Settings"]').getByRole('tab', { name: 'Best model' }).click();
    await page.waitForSelector('[role="dialog"][aria-label="Settings"] section.best-per-point');
  };
  const closeModels = async () => { await page.locator('[role="dialog"][aria-label="Settings"]').getByRole('button', { name: 'Close' }).click(); };
  const rowText = (p, m) => section().locator(m ? `tr[data-point="${p}"][data-model="${m}"]` : `tr[data-point="${p}"]`).first().innerText();
  // Fires a Tauri event to every listener registered for it (the weights check's progress bar), e2e3's pattern.
  const emit = (event, payload) => page.evaluate(({ event, payload }) => {
    (window.__listeners || []).filter((l) => l.event === event).forEach((l) => window['_cb' + l.handler]?.({ event, id: 1, payload }));
  }, { event, payload });
  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');

  // 1–3: the rule's words, from the back end's verdicts.
  await openModels();
  await page.waitForFunction(() => document.querySelector('section.best-per-point table'), null, { timeout: 5000 }).catch(() => {});
  const go = await rowText('Go', SR);
  ok('1. Go: the offer, its re-check numbers with the accepted-unmoved share, Accept and Decline', go.includes('offer: switch to SRPose')
    && go.includes('median Aariz 2.00 mm, SRPose 1.50 mm · within 2 mm: Aariz 19, SRPose 24 of 30 · 21 of 30 accepted unmoved')
    && (await section().locator('tr[data-point="Go"] button', { hasText: 'Accept' }).count()) === 1, go);
  ok('1. Go: the films that decided, the films per scale, and the films left out', go.includes('Decided on mm, 60 ruler films · not used: 4 assumed-scale')
    && go.includes('Films: ruler 60 · machine 0 · fit 0 · assumed 4') && go.includes('Films left out — placed by another model: 2'), go);
  const s = await rowText('S', SR);
  ok('2. S: not enough films (12 of 30), no buttons', s.includes('not enough films (12 of 30)') && (await section().locator('tr[data-point="S"] button').count()) === 0, s);
  ok('3. N: nothing yet, and no switches', (await rowText('N')).includes('no verified films yet') && (await section().innerText()).includes('None: Aariz places every point.'));
  await page.screenshot({ path: `${__dirname}/out/partf-1.png` });

  // 4. Accept asks first; answered No, nothing is sent.
  await page.evaluate(() => localStorage.setItem('dialogReply', 'No'));
  await section().locator('tr[data-point="Go"] button', { hasText: 'Accept' }).click();
  await page.waitForTimeout(300);
  ok('4. Accept asks first, and No sends nothing', (await calls('plugin:dialog|message')).length === 1 && (await calls('models_point_choice')).length === 0);
  await page.evaluate(() => localStorage.removeItem('dialogReply'));
  await section().locator('tr[data-point="Go"] button', { hasText: 'Accept' }).click();
  await page.waitForFunction(() => document.querySelector('section.best-per-point .best-switches'), null, { timeout: 5000 }).catch(() => {});
  const sent = (await calls('models_point_choice'))[0]?.[1];
  ok('5. Yes sends the answer for Go and SRPose', sent && sent.landmarkId === 'Go' && sent.modelId === SR && sent.answer === 'accept', JSON.stringify(sent));
  const sw = await section().locator('.best-switches').innerText().catch(() => '');
  ok('5. the switch is listed with its date, who, the films that decided, its numbers and Undo',
    sw.includes('Go: SRPose since 18/10/2026, accepted by Dr A — mm, 60 ruler films — re-check: median Aariz 2.00 mm') && sw.includes('Undo'), sw);
  ok('5. Go now reads "switched to SRPose"', (await rowText('Go')).includes('switched to SRPose'));
  // 6. Closed and reopened: read again from the back end, still there.
  await closeModels(); await openModels();
  ok('6. closed and reopened: the switch is still listed', (await section().locator('.best-switches').innerText().catch(() => '')).includes('Go: SRPose since 18/10/2026'));

  // 6b–6c. A locked or read-only library: Accept and Undo both answer, the screen shows the notice, and nothing
  // changes — PNS's offer stays an offer, and Go's switch stays a switch (Task 9–10 review, 27 Oct).
  await page.evaluate(() => localStorage.setItem('lockedLib', '1'));
  const pnsBefore = await rowText('PNS', GU);
  await section().locator('tr[data-point="PNS"] button', { hasText: 'Accept' }).click();
  await page.waitForTimeout(300);
  const pnsAfter = await rowText('PNS', GU);
  ok('6b. a locked library: Accept on PNS shows the notice and changes nothing', (await section().innerText()).includes('That answer was not saved: stub: the library is locked (read-only)')
    && pnsAfter === pnsBefore && (await section().locator('tr[data-point="PNS"] button', { hasText: 'Accept' }).count()) === 1, pnsAfter);
  const switchesBefore = await section().locator('.best-switches').innerText();
  await section().locator('.best-switches button', { hasText: 'Undo' }).click();
  await page.waitForTimeout(300);
  const switchesAfter = await section().locator('.best-switches').innerText();
  ok('6c. a locked library: Undo on Go shows the notice and changes nothing', (await section().innerText()).includes('That answer was not saved: stub: the library is locked (read-only)')
    && switchesAfter === switchesBefore && switchesAfter.includes('Go: SRPose since 18/10/2026'), switchesAfter);
  await page.evaluate(() => localStorage.removeItem('lockedLib'));
  await closeModels();

  // 7. Re-detect: Go comes from SRPose (your choice), S from Aariz (control: the instrument sees both models).
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await page.locator('.cards .card .open', { hasText: 'T1' }).first().click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('tab', { name: 'Case' }).click().catch(() => {});
  await page.getByRole('button', { name: 'Re-detect' }).click();
  await page.waitForFunction(() => (window.__detects || 0) >= 1);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'Go').placedBy === 'srpose-cldet23', null, { timeout: 5000 }).catch(() => {});
  const lms = await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks);
  const at = (id) => lms.find((l) => l.id === id);
  ok('7. Re-detect: Go is placed from SRPose, your choice', at('Go').x === base.Go[0] + 460 && at('Go').placedBy === SR, `Go x ${at('Go').x} by ${at('Go').placedBy}`);
  ok('7. and S from Aariz (control)', at('S').x === base.S[0] + 400 && at('S').placedBy === AZ, `S x ${at('S').x} by ${at('S').placedBy}`);
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  const line = await page.evaluate(() => { const b = [...document.querySelectorAll('.inspector .lm-list button')].find((x) => x.querySelector('b')?.textContent === 'Go'); return b ? b.title : ''; });
  ok('7. Go carries the label SRPose (chain spec §5)', / — SRPose$/.test(line), line.split(' — ').pop());
  await page.locator('.lm-list button', { has: page.locator('b', { hasText: /^Go$/ }) }).click();
  const why = await page.locator('.point-about .placed-by').getAttribute('title').catch(() => '');
  ok('7. and its hover names the switch, its date and the films that decided', why === 'Switched to SRPose on 18/10/2026: closer to your points (mm, 60 ruler films).', why || 'no hover');

  // 7b. How each point was accepted (chain spec answer 7), as the autosave sends it: a double-click in the list, Accept
  // position, then Accept remaining. Control: a point not yet accepted carries no kind.
  const kindOf = async (id) => (await page.evaluate((i) => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === i), id))?.acceptKind ?? null;
  ok('7b. before any accept, S carries no kind (control)', (await kindOf('S')) === null);
  await page.locator('.lm-list button', { has: page.locator('b', { hasText: /^S$/ }) }).dblclick();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'S').acceptKind === 'double-click', null, { timeout: 5000 }).catch(() => {});
  ok('7b. a double-click in the list is recorded as double-click', (await kindOf('S')) === 'double-click', String(await kindOf('S')));
  await page.locator('.lm-list button', { has: page.locator('b', { hasText: /^N$/ }) }).click();
  await page.getByRole('button', { name: 'Accept position' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'N').acceptKind === 'single', null, { timeout: 5000 }).catch(() => {});
  ok('7b. Accept position is recorded as single', (await kindOf('N')) === 'single', String(await kindOf('N')));
  await page.getByRole('button', { name: /^Accept remaining/ }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'A').acceptKind === 'bulk', null, { timeout: 5000 }).catch(() => {});
  ok('7b. Accept remaining is recorded as bulk', (await kindOf('A')) === 'bulk' && (await kindOf('S')) === 'double-click', `A ${await kindOf('A')}, S ${await kindOf('S')}`);

  // 8. Undo; 9. Decline; 10. a refused answer; 11. a read failure.
  await openModels();
  await section().locator('.best-switches button', { hasText: 'Undo' }).click();
  await page.waitForFunction(() => !document.querySelector('section.best-per-point .best-switches'), null, { timeout: 5000 }).catch(() => {});
  ok('8. Undo sends the answer and the list is empty again', (await calls('models_point_choice')).some(([, x]) => x.answer === 'undo' && x.landmarkId === 'Go')
    && (await section().innerText()).includes('None: Aariz places every point.'));
  await section().locator('tr[data-point="PNS"] button', { hasText: 'Decline' }).click();
  await page.waitForFunction(() => !document.querySelector('section.best-per-point tr[data-point="PNS"] button'), null, { timeout: 5000 }).catch(() => {});
  ok('9. Decline sends the answer and the PNS offer goes', (await calls('models_point_choice')).some(([, x]) => x.answer === 'decline' && x.landmarkId === 'PNS')
    && (await section().locator('tr[data-point="PNS"] button').count()) === 0);
  await page.evaluate(() => localStorage.setItem('failAnswer', '1'));
  await section().locator('tr[data-point="Go"] button', { hasText: 'Decline' }).click();
  await page.waitForTimeout(300);
  ok('10. a refused answer says so and the table stays', (await section().innerText()).includes('That answer was not saved: stub: the library refused')
    && (await section().locator('table').count()) === 1);
  await page.evaluate(() => { localStorage.removeItem('failAnswer'); localStorage.setItem('failBest', '1'); });
  await closeModels(); await openModels().catch(() => {});
  await page.waitForTimeout(300);
  // The table lives in Settings › Best model since plan 2026-10-29 Task 9: what must still show beside a failed read is
  // the rest of that tab (Automatic best and its base drop-down), as Models…'s rows did before.
  ok("11. a read failure says so; the rest of Settings › Best model still shows", (await section().innerText()).includes("Best model per point couldn't be read: stub: unreadable")
    && (await page.locator('[role="dialog"][aria-label="Settings"] .settings-best-model .base-select select').count()) === 1);

  // 12. the weights check was started (at launch, and again every time Settings › Best model opens).
  ok('12. the weights check was started', (await calls('models_weights_check_run')).length >= 1);

  // 12b. the weights check running: a model with films still due shows progress and an ETA from the model's own
  // measured speed (400 ms/film here), fed by the real cephtrace://weights-check event (Task 12 review: untested).
  await page.evaluate(({ srRunning }) => {
    localStorage.removeItem('failBest');
    const db = JSON.parse(localStorage.getItem('fakeLib'));
    db.best.checks = [srRunning];
    localStorage.setItem('fakeLib', JSON.stringify(db));
  }, { srRunning });
  await closeModels(); await openModels();
  await page.waitForFunction(() => document.querySelector('section.best-per-point .best-checks'), null, { timeout: 5000 }).catch(() => {});
  await emit('cephtrace://weights-check', { modelId: SR, done: 10, total: 30 });
  await page.waitForFunction(() => (document.querySelector('section.best-per-point .best-checks .identity-note')?.textContent || '').includes('10 of 30'), null, { timeout: 5000 }).catch(() => {});
  const runningText = await section().locator('.best-checks .identity-note').first().innerText().catch(() => '');
  ok('12b. the weights check running shows progress and an ETA from the model’s own speed', runningText.includes('SRPose has a new file: checking it on your older films, 10 of 30 (about 8 s left)'), runningText);
  await closeModels();

  // 13–15. The weights check's result (owner Q4): started at launch and when Models… opens; a worse new file is
  // warned, its numbers beside the earlier file's and the films it could not run; for a point switched to that model,
  // a way back to Aariz; and a point the new file placed on none of the checked films reads "no older film to compare".
  await page.evaluate(({ SR, srCheck }) => {
    const db = JSON.parse(localStorage.getItem('fakeLib'));
    Object.assign(db.best.points.find((p) => p.landmarkId === 'Go'), { current: SR, offer: null, pairs: [] });
    db.best.choices.push({ id: 99, landmarkId: 'Go', modelId: SR, action: 'accepted', ruleVersion: 'best-point/3', lastImportedAt: 'x', lastCaseId: 'c059', basis: 'mm, 60 ruler films',
      numbers: null, operator: 'Dr A', at: '2026-10-18T01:00:00.000Z' });
    db.best.checks = [srCheck];
    localStorage.setItem('fakeLib', JSON.stringify(db));
  }, { SR, srCheck });
  await openModels();
  await page.waitForFunction(() => document.querySelector('section.best-per-point .best-checks'), null, { timeout: 5000 }).catch(() => {});
  const checkText = await section().locator('.best-checks').innerText().catch(() => '');
  ok("13. the warning names SRPose and Go and says nothing was switched", checkText.includes("Warning: SRPose's new file is worse than its earlier one on your older films for Go. Nothing was switched."), checkText);
  ok('13. the earlier file and the new one sit side by side', checkText.includes('Go: median 1.10 → 1.45 mm · within 2 mm 48 → 41 of 50 · worse (median up 0.35 mm, fewer within 2 mm)'), checkText);
  ok('14. the films SRPose could not run are named with the reason', checkText.includes('checked on 60 of your older films · could not run on 3 (stub: 3 films unreadable)'), checkText);
  ok("15. PNS, placed on none of the checked films, reads 'no older film to compare'", checkText.includes('PNS: no older film to compare') && !checkText.includes('PNS: median'), checkText);
  const undosBefore = (await calls('models_point_choice')).filter(([, x]) => x.answer === 'undo' && x.landmarkId === 'Go').length;
  await section().locator('.best-checks button', { hasText: 'Go back to Aariz for Go' }).click().catch(() => {});
  await page.waitForTimeout(300);
  ok('16. Go back to Aariz sends the undo for Go', (await calls('models_point_choice')).filter(([, x]) => x.answer === 'undo' && x.landmarkId === 'Go').length === undosBefore + 1);

  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(`FAIL  e2e19 crashed: ${e && e.stack || e}`); process.exit(1); });
