// Week 3 smoke: the built UI in Chromium with a stubbed Tauri runtime and an in-memory library kept in
// localStorage (so a page reload stands in for quit + reopen). SYNTHETIC image and landmarks only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const landmarks = Object.entries(base).map(([id,[x,y]]) => ({ id, x: x + 350, y: y + 300, confidence: 0.8 }));
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const shot = (page, n) => page.screenshot({ path: `${__dirname}/out/w3-${n}.png` });

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, landmarks }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{}}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      // Event listeners are kept so the fake back end can announce each extra model's run (owner, 16 Oct: loading bars).
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: c.landmarks.filter((l) => !l.verified).length, verifiedAt: c.verifiedAt, deletedAt: c.deletedAt,
          patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: c.identityChecked,
          libraryId: null, formerLibraryIds: [], printedPatientId: null });
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'plugin:dialog|open': return a.options && a.options.multiple ? ['/Users/demo/SYNTHETIC-demo.png'] : '/Users/demo';
          // `ask()` (@tauri-apps/plugin-dialog) invokes 'plugin:dialog|message', never 'plugin:dialog|ask' — fix
          // round 1 (Task 10 review M2): the dead `case 'plugin:dialog|ask'` that used to sit here never matched
          // anything real; corrected. This smoke clicks no `ask()`-gated action; Delete case, Restore backup and
          // Replace all are covered by e2e16 (CF1-CF3).
          case 'plugin:dialog|message': return 'Yes';
          case 'plugin:event|listen': (window.__listeners ||= []).push(a); return 1;
          case 'detect_landmarks': { window.__detects = (window.__detects || 0) + 1;
            // Review I1: an SRPose-style main model that also finds U1A, over the 2 mm gate for it ('mainTooFar').
            const lms = db.extraMode === 'mainTooFar' ? [...landmarks, { id: 'U1A', x: 1040, y: 690, confidence: 0.6 }] : landmarks;
            return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub', timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 },
              landmarks: lms, facingLeft: true, meanPeakRight: 4.9, meanPeakLeft: 12.6,
              raw: lms.map((l, i) => ({ channel: i, landmarkId: l.id, x: l.x, y: l.y, peak: 0.8 })) }; }
          case 'models_list': return db.extraMode === 'mainTooFar'
            ? [{ id: 'SYNTHETIC-stub', title: 'SRPose-like main', status: 'ready', main: true, tier: 'optional', citation: 'SYNTHETIC', sizeMb: 1,
              licence: { version: '1', code: 'SYNTHETIC', weights: 'SYNTHETIC', summary: 'SYNTHETIC', url: '', nonCommercial: false }, licenceAccepted: true,
              stage: null, error: null, msPerFilm: null, page: '' }] : null;
          case 'library_record_ai': { if (db.extraMode !== 'mainTooFar') return null;
            db.runs = { ...(db.runs || {}), [a.run.modelId]: { modelId: a.run.modelId, ranAt: now(), facing: a.run.facing, points: a.points } }; store(db); return null; }
          // Review T9-1: the real command answers Vec<ModelPoints> (never null), so the stub matches — [] here,
          // not null, like e2e8/e2e9/e2e10's stubs.
          case 'library_ghosts': return db.extraMode === 'mainTooFar' ? Object.values(db.runs || {}) : [];
          // Task 7: another installed model (Aariz) that finds U1A. Off unless a check sets db.extraMode, so every check
          // above runs exactly as before (no other model installed: both commands answer nothing).
          case 'detect_extras': {
            if (!db.extraMode || db.extraMode === 'mainTooFar') return null;
            if (db.extraMode === 'bars') {                      // two extra models, announced as the real back end does
              const emit = (payload) => (window.__listeners || []).filter((l) => l.event === 'cephtrace://extra-model')
                .forEach((l) => window['_cb' + l.handler]?.({ event: l.event, id: 1, payload }));
              const run = a.run;                                // review I-1: every event names its run
              emit({ modelId: 'stale-model', title: 'Another film', state: 'working', limitMs: 15000, run: typeof run === 'number' ? run - 1 : 999 });
              emit({ modelId: 'batch-model', title: 'A batch', state: 'working', limitMs: 15000, run: null });
              emit({ modelId: 'aariz-cepha29', title: 'Aariz', state: 'working', limitMs: 15000, run });
              await new Promise((r) => setTimeout(r, 1500));
              emit({ modelId: 'aariz-cepha29', title: 'Aariz', state: 'done', limitMs: 15000, run });
              emit({ modelId: 'gu2net', title: 'GU2Net', state: 'working', limitMs: 15000, run });
              emit({ modelId: 'gu2net', title: 'GU2Net', state: 'gave-up', limitMs: 15000, run });
              return [{ modelId: 'aariz-cepha29', title: 'Aariz', detection: null, error: null, timedOut: false },
                { modelId: 'gu2net', title: 'GU2Net', detection: null, error: 'GU2Net took longer than 15 s on this film; its points were not used.', timedOut: true }];
            }
            if (db.extraMode === 'error') return [{ modelId: 'aariz-cepha29', title: 'Aariz', detection: null, error: 'Aariz couldn’t read this film: SYNTHETIC', timedOut: false }];
            const u1a = { id: 'U1A', x: 1050, y: 680, confidence: 0.7 };
            return [{ modelId: 'aariz-cepha29', title: 'Aariz', error: null, timedOut: false, detection: { modelId: 'aariz-cepha29', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub',
              timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 }, landmarks: [u1a], raw: [{ channel: 0, landmarkId: 'U1A', x: u1a.x, y: u1a.y, peak: 0.7 }] } }];
          }
          case 'models_points': {
            if (!db.extraMode) return null;
            if (db.extraMode === 'mainTooFar') return [{ modelId: 'SYNTHETIC-stub', title: 'SRPose-like main', main: true,
              points: [...landmarks.map((l) => ({ id: l.id, status: { kind: 'original' } })), { id: 'U1A', status: { kind: 'tooFar', mre: 2.3, n: 150, dataset: 'aariz' } }] }];
            const st = db.extraMode === 'tooFar' ? { kind: 'tooFar', mre: 2.6, n: 150, dataset: 'aariz' } : { kind: 'scored', mre: 1.27, n: 150, dataset: 'aariz' };
            return [{ modelId: 'SYNTHETIC-stub', title: 'Main', main: true, points: landmarks.map((l) => ({ id: l.id, status: { kind: 'original' } })) },
              { modelId: 'aariz-cepha29', title: 'Aariz', main: false, points: [{ id: 'U1A', status: st }] }];
          }
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map(summary);
          case 'library_import': {
            const hit = Object.values(db.cases).find((c) => c.path === a.path && !c.deletedAt);
            if (hit) return { caseId: hit.id, created: false };
            const id = 'c' + (Object.keys(db.cases).length + 1);
            db.cases[id] = { id, path: a.path, patientName: 'SYNTHETIC-demo', timepoint: 'T1', takenOn: null, facing: 'right', orientation: {}, display: {}, spacingMm: null,
              verifiedAt: null, verifiedBy: null, landmarks: [], createdAt: now(), updatedAt: now(), deletedAt: null,
              patientKey: 'synthetic demo', dateOfBirth: null, scanId: null, identitySource: 'manual', identityChecked: true, identityIssues: [],
              // Film details Task 7: the real CaseDoc always carries these (Rust Vec / Option); the panel now reads
              // learnedFields for every detail box, so a stub without it crashed the panel.
              learnedFields: [], printedPatientId: null, xrayType: null, xraySize: null, radiographyPractice: null,
              // Task 5 (D2): the real CaseDoc always carries these too; a stub without them has the panel read undefined.
              libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [] };
            store(db); return { caseId: id, created: true };
          }
          case 'library_open': { const c = db.cases[a.caseId];
            return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC-demo.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; const moved = JSON.stringify(c.landmarks) !== JSON.stringify(a.edit.landmarks);
            Object.assign(c, { facing: a.edit.facing, orientation: a.edit.orientation, display: a.edit.display, landmarks: a.edit.landmarks, updatedAt: now() });
            if (moved) { c.verifiedAt = null; c.verifiedBy = null; }
            window.__saves = (window.__saves || 0) + 1; store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_calibrate': { const c = db.cases[a.caseId]; const px = Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]);
            c.spacingMm = a.mm / px; c.verifiedAt = null; store(db); return c.spacingMm; }
          case 'library_set_meta': Object.assign(db.cases[a.caseId], a.meta); store(db); return null;
          case 'library_set_verified': Object.assign(db.cases[a.caseId], a.verified ? { verifiedAt: now(), verifiedBy: 'SYNTHETIC-operator' } : { verifiedAt: null }); store(db); return null;
          case 'settings_get': return a.key === 'betaNoticeSeen' && localStorage.getItem('betaDone') ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png, landmarks });

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');
  // Owner, 2 Nov 2026: the one-time Beta notice. First open shows it (nothing stored yet); OK dismisses it; a reload (quit + reopen) does not bring it back.
  const betaDlg = page.getByRole('dialog', { name: 'OpenCephAI 1.1 Beta' });
  await betaDlg.waitFor();
  ok('BETA1. first open: the notice shows the owner\'s exact words', (await betaDlg.innerText()).includes('OpenCephAI is beta research software, not a diagnostic device. Every point must be checked by a clinician. Please report any problem.'));
  ok('BETA2. the window title (document title) is "OpenCephAI 1.1 Beta"', (await page.title()) === 'OpenCephAI 1.1 Beta', await page.title());
  await betaDlg.getByRole('button', { name: 'OK' }).click();
  ok('BETA3. OK closes it', (await page.getByRole('dialog', { name: 'OpenCephAI 1.1 Beta' }).count()) === 0);
  await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(400);
  ok('BETA4. closed and reopened: it does not come back (remembered)', (await page.getByRole('dialog', { name: 'OpenCephAI 1.1 Beta' }).count()) === 0);
  await page.evaluate(() => localStorage.setItem('betaDone', '1'));   // later checks replace the whole fake library; they must not meet the notice again
  ok('1. starts on the Library, empty', (await page.locator('.lib-empty').innerText()).includes('Drop cephalograms'));
  // Owner, 16 Oct (A): the OPEN CEPH AI wordmark sits at the top left, just right of the window buttons (traffic lights end ~78 px).
  const brand = await page.evaluate(() => { const el = document.querySelector('.lib-toolbar .brand-title'), r = el.getBoundingClientRect(), cs = getComputedStyle(el);
    return { left: r.left, pos: cs.webkitMaskPosition || cs.maskPosition }; });
  // (layout guard: the bar's left gap for the window buttons; the drawing position is checked by the next line — review M-6)
  ok('A. the wordmark starts just right of the window buttons', brand.left >= 78 && brand.left <= 100, JSON.stringify(brand));
  ok('A. and is drawn from its left edge, not centred', /^(0%|0px|left)/.test(brand.pos), JSON.stringify(brand));
  await shot(page, '1-library-empty');

  await page.getByRole('button', { name: 'Import…' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  ok('2. import opens the case and detects 19 points', (await page.locator('g.landmark').count()) === 19);
  const pressed = async (name) => (await page.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'true';
  ok('2. a left-facing film is shown mirrored', await pressed('Flip'));
  ok('2. and levelled to Frankfort', await pressed('Level to FH'));
  ok('2. a clear facing call offers no Faces right/left switch', (await page.getByRole('radiogroup', { name: 'Patient faces' }).count()) === 0);
  await shot(page, '2-imported');

  // Part A task 9: "Not placed" lists only the points Steiner/Downs/McNamara (BUILT_INS) actually
  // need, not every catalogue point (~59). With the 19 ISBI19 points just detected and nothing else
  // placed, BUILT_INS still needs 12 more (U1A, L1A, Co, Ba, U6, L6, PTM, Tg, SPP, UPW, TM, LPW) —
  // computed from the real catalogue via `unplacedLandmarks`, not guessed.
  // The list now has two headed groups ("Not placed", then the collapsible "Other points (n)"), so
  // read the slice strictly between the first `.lm-head` and the second one (fix round 1).
  const lmGroup = async (afterHead, uptoHead) => page.locator('.lm-list li').evaluateAll((lis, { afterHead, uptoHead }) => {
    const heads = lis.map((l, i) => (l.classList.contains('lm-head') ? i : -1)).filter((i) => i !== -1);
    const start = heads[afterHead] === undefined ? lis.length : heads[afterHead] + 1;
    const end = uptoHead === null ? lis.length : (heads[uptoHead] ?? lis.length);
    return lis.slice(start, end).map((l) => l.querySelector('b')?.textContent ?? null).filter((t) => t !== null);
  }, { afterHead, uptoHead });
  const notPlaced = await lmGroup(0, 1);
  ok('Task 9: "Not placed" count equals what BUILT_INS needs (12), not the full catalogue (~59)', notPlaced.length === 12, notPlaced.join(', '));
  ok('Task 9: it includes Co (McNamara #31 facial axis) and U1A (Steiner #47)', notPlaced.includes('Co') && notPlaced.includes('U1A'), notPlaced.join(', '));
  ok('Task 9: it excludes a Holdaway-only point no enabled analysis uses (SPogS)', !notPlaced.includes('SPogS'), notPlaced.join(', '));

  // Fix round 1 (review): the filter above also removed the ONLY way to place a point
  // no enabled analysis needs — the brief requires manual placement of any catalogue point to stay
  // possible. "Other points" is collapsed by default, and expanding it must reveal exactly the
  // points `unplaced` excludes (e.g. SPogS), each clickable like a "Not placed" entry.
  const otherHead = page.locator('.lm-list li.lm-head.collapsible button.toggle');
  ok("Fix 1: 'Other points' heading is collapsed by default", (await otherHead.getAttribute('aria-expanded')) === 'false');
  const otherCountBefore = (await otherHead.innerText()).match(/\((\d+)\)/)[1];
  ok('Fix 1: collapsed, its entries are not in the DOM at all', (await lmGroup(1, null)).length === 0);
  await otherHead.click();
  ok("Fix 1: clicking the heading expands it (aria-expanded true, ▾ shown)", (await otherHead.getAttribute('aria-expanded')) === 'true' && (await otherHead.innerText()).startsWith('▾'));
  const otherPoints = await lmGroup(1, null);
  ok(`Fix 1: expanded, "Other points" lists exactly the ${otherCountBefore} points the heading counted, including SPogS, excluding Co`,
    String(otherPoints.length) === otherCountBefore && otherPoints.includes('SPogS') && !otherPoints.includes('Co'), otherPoints.join(', '));
  await page.locator('.lm-list button').filter({ has: page.locator('b', { hasText: /^SPogS$/ }) }).click();
  ok('Fix 1: choosing SPogS (an "other" point) shows the placement hint, same as any unplaced point', (await page.locator('.place-hint').count()) === 1);
  const stOther = await page.locator('.stage').boundingBox();
  await page.mouse.click(stOther.x + stOther.width * 0.4, stOther.y + stOther.height * 0.55);
  ok('Fix 1: a click on the film places SPogS (manual, verified) — it now shows in the placed group, not "Other points"', (await page.locator('g.landmark[data-id="SPogS"] rect').count()) === 1);
  const afterPlaceOther = await lmGroup(1, null);
  ok('Fix 1: placed SPogS drops out of "Other points"', !afterPlaceOther.includes('SPogS'));
  await otherHead.click();
  ok("Fix 1: clicking the heading again collapses it", (await otherHead.getAttribute('aria-expanded')) === 'false');

  const centre = async (id) => { const b = await page.locator(`g.landmark[data-id="${id}"] circle, g.landmark[data-id="${id}"] rect`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const dragBy = async (id, dx, dy) => { const c = await centre(id); await page.mouse.move(c.x, c.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + dx * i / 8, c.y + dy * i / 8); await page.mouse.up(); };
  const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'S'));
  await dragBy('S', 30, 0); await page.keyboard.press('Meta+z'); await dragBy('S', 0, 25);
  await page.waitForTimeout(1000);
  const sSaved = await stored();
  ok('3. the edit autosaves (moved, AI position kept)', sSaved.source === 'ai-adjusted' && sSaved.aiX === 350 && sSaved.aiY === 300 && Math.hypot(sSaved.x - 350, sSaved.y - 300) > 1, JSON.stringify(sSaved));
  ok('3. the case panel says All changes saved', (await page.locator('.case-panel .save').innerText()) === 'All changes saved');
  const sBefore = await centre('S');

  // Owner, 16 Oct: the magnifier's 2× / 5× switch (5× by default), kept on this Mac.
  const zoomBtn = (z) => page.locator('.loupe .zoom button', { hasText: `${z}×` });
  ok('Z1. the magnifier opens at 5×', (await zoomBtn(5).getAttribute('aria-pressed')) === 'true' && (await zoomBtn(2).getAttribute('aria-pressed')) === 'false');
  await zoomBtn(2).click(); await page.waitForTimeout(150);
  ok('Z1. 2× can be chosen, and is saved on this Mac', (await zoomBtn(2).getAttribute('aria-pressed')) === 'true'
    && (await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings.loupe_zoom)) === '2');
  await page.reload(); await page.waitForSelector('.cards .card');
  ok('3. after quit + reopen the Library lists the case', (await page.locator('.cards .card').count()) === 1);
  await page.locator('.cards .card .open').first().click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  const sAfter = await centre('S'), back = await stored();
  ok('3. reopened: S is exactly where it was left', back.x === sSaved.x && back.y === sSaved.y && Math.hypot(sAfter.x - sBefore.x, sAfter.y - sBefore.y) < 1.5,
    `screen Δ ${Math.hypot(sAfter.x - sBefore.x, sAfter.y - sBefore.y).toFixed(2)} px`);
  ok('3. reopening does not detect again', (await page.evaluate(() => window.__detects || 0)) === 0);
  ok("Fix 1: 'Other points' stays collapsed after quit + reopen (remembered on this Mac like Enhance/Text on the film)",
    (await page.locator('.lm-list li.lm-head.collapsible button.toggle').getAttribute('aria-expanded')) === 'false');
  ok('Z2. after quit + reopen the magnifier is still at 2×', (await zoomBtn(2).getAttribute('aria-pressed')) === 'true');
  // A press 50 screen px from the ring places the point 25 film px away at 2× (10 at 5×), whatever the flip/level.
  await page.locator('.lm-list li button', { has: page.locator('b', { hasText: /^S$/ }) }).click(); await page.waitForTimeout(150);
  const zs0 = await stored(), lb = await page.locator('.loupe canvas').boundingBox();
  await page.mouse.move(lb.x + lb.width / 2 + 50, lb.y + lb.height / 2); await page.mouse.down(); await page.mouse.up();
  await page.waitForTimeout(900);
  const zs1 = await stored(), zd = Math.hypot(zs1.x - zs0.x, zs1.y - zs0.y);
  ok('Z3. at 2× a press 50 px from the ring moves the point 25 film px', Math.abs(zd - 25) < 0.6, zd.toFixed(3));
  await page.getByRole('button', { name: 'Undo' }).click(); await page.waitForTimeout(900);
  ok('Z3. (undo puts it back)', JSON.stringify(await stored()) === JSON.stringify(zs0) || Math.hypot((await stored()).x - zs0.x, (await stored()).y - zs0.y) < 1e-9);
  // Only the part under the tabs scrolls: the magnifier and the tabs stay put.
  const scroller = page.locator('.inspector-scroll');
  const lo0 = await page.locator('.loupe').boundingBox(), tb0 = await page.locator('.inspector .tabs').boundingBox();
  const lst = await page.locator('.lm-list').boundingBox();                 // a real wheel over the list, as the owner scrolls
  await page.mouse.move(lst.x + lst.width / 2, Math.min(lst.y + lst.height / 2, 850)); await page.mouse.wheel(0, 2000); await page.waitForTimeout(300);
  const lo1 = await page.locator('.loupe').boundingBox(), tb1 = await page.locator('.inspector .tabs').boundingBox();
  const sTop = await scroller.evaluate((el) => el.scrollTop);
  const panelTop = await page.locator('.inspector').evaluate((el) => el.scrollTop);
  ok('Z4. the wheel scrolls something (positive control: the list or the panel moved)', sTop > 50 || panelTop > 50, `${sTop}/${panelTop}`);
  ok('Z4. and it is the list under the tabs that scrolled', sTop > 50, String(sTop));
  ok('Z4. while the magnifier and the tabs stay where they were', lo1.y === lo0.y && tb1.y === tb0.y && lo1.height > 150, `${lo0.y}->${lo1.y}, ${tb0.y}->${tb1.y}`);
  ok('Z4. the whole panel itself does not scroll', (await page.locator('.inspector').evaluate((el) => el.scrollTop)) === 0);
  await scroller.evaluate((el) => { el.scrollTop = 0; });
  await zoomBtn(5).click(); await page.waitForTimeout(150);
  ok('Z1. back to 5×', (await zoomBtn(5).getAttribute('aria-pressed')) === 'true');

  await page.getByRole('tab', { name: 'Steps' }).click();
  await page.locator('.steps li.next button').click();                       // start on the highlighted step
  const step0 = await page.locator('.steps li.next').innerText(), active0 = await page.locator('.active-head b').innerText();
  await dragBy(active0, 20, 10);
  await page.waitForTimeout(600);
  const step1 = await page.locator('.steps li.next').innerText(), active1 = await page.locator('.active-head b').innerText();
  ok('10. just after release the highlight and the magnifier both stay put', step1 === step0 && active1 === active0, `${step0}/${active0} → ${step1}/${active1}`);
  await page.waitForTimeout(2400);
  const step2 = await page.locator('.steps li.next').innerText(), active2 = await page.locator('.active-head b').innerText();
  ok('10. ~2.5 s later both move to the next point together', step2 !== step0 && active2 !== active0 && step2.includes(active2), `${step2} / ${active2}`);
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await page.locator('.lm-list button', { hasText: 'Condylion' }).click();
  ok('4. choosing an unplaced point shows the placement hint', (await page.locator('.place-hint').count()) === 1);
  const st = await page.locator('.stage').boundingBox();
  await page.mouse.click(st.x + st.width * 0.35, st.y + st.height * 0.4);
  ok('4. a click on the film places Co (manual, verified)', (await page.locator('g.landmark[data-id="Co"] rect').count()) === 1);
  await shot(page, '4-placed-co');

  await page.keyboard.press('k');
  // Owner, 16 Oct (C): while marking the ruler the magnifier follows the pointer; a press in it marks the ruler there.
  const loupeSum = () => page.evaluate(() => { const c = document.querySelector('.loupe canvas'), d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let h = 0; for (let i = 0; i < d.length; i += 97) h = (h * 31 + d[i]) >>> 0; return h; });
  await page.mouse.move(st.x + st.width * 0.3, st.y + st.height * 0.7); await page.waitForTimeout(150);
  const lz0 = await loupeSum();
  ok('C1. calibrating: the panel says Ruler and offers no Accept position for an old point', (await page.locator('.active-head b').innerText()) === 'Ruler'
    && (await page.getByRole('button', { name: 'Accept position' }).count()) === 0);
  ok('C1. calibrating: the magnifier is in ruler mode', (await page.locator('.loupe').getAttribute('data-mode')) === 'ruler', String(await page.locator('.loupe').getAttribute('data-mode')));
  await page.mouse.move(st.x + st.width * 0.45, st.y + st.height * 0.5); await page.waitForTimeout(150);
  ok('C1. and follows the pointer over the film (positive control: its picture changed)', (await loupeSum()) !== lz0);
  await page.mouse.move(st.x + st.width * 0.3, st.y + st.height * 0.7); await page.waitForTimeout(150);
  const lb1 = await page.locator('.loupe canvas').boundingBox();
  await page.mouse.click(lb1.x + lb1.width / 2, lb1.y + lb1.height / 2); await page.waitForTimeout(150);
  ok('C1. a press in the magnifier marks the ruler there (now asks for the second mark)', (await page.locator('.place-hint').allInnerTexts()).join(' ').includes('second ruler mark'),
    (await page.locator('.place-hint').allInnerTexts()).join(' | '));
  await page.mouse.click(st.x + st.width * 0.6, st.y + st.height * 0.7);
  await page.waitForSelector('.calibrate-dialog');
  const pxApart = async () => Number((await page.locator('.calibrate-dialog .hint').first().innerText()).match(/([\d.]+) px apart/)[1]);
  const px0 = await pxApart();
  // The marks stay movable while the dialog is open: drag the second mark 60 screen px further right on the film.
  await page.mouse.move(st.x + st.width * 0.6, st.y + st.height * 0.7); await page.mouse.down();
  await page.mouse.move(st.x + st.width * 0.6 + 60, st.y + st.height * 0.7, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(150);
  const px1 = await pxApart();
  ok('C2. a ruler mark drags like a point, and the distance updates', px1 > px0 + 20 && (await page.locator('.calibrate-dialog').count()) === 1, `${px0} -> ${px1}`);
  // ...and in the magnifier, which now shows that mark: a press 40 px right of its ring moves it there.

  const lb2 = await page.locator('.loupe canvas').boundingBox();
  const rings = await page.locator('.loupe .ring.ruler').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().toJSON()));
  const rg = rings.find((r) => r.x >= lb2.x && r.x + r.width <= lb2.x + lb2.width && r.y >= lb2.y && r.y + r.height <= lb2.y + lb2.height);   // the mark in view
  if (rg) { await page.mouse.move(rg.x + rg.width / 2, rg.y + rg.height / 2); await page.mouse.down();
  await page.mouse.move(rg.x + rg.width / 2 + 40, rg.y + rg.height / 2, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(150); }
  const px2 = await pxApart();
  ok('C2. the magnifier shows the mark being moved (its ring is in view)', !!rg, JSON.stringify(rings));
  ok('C2. dragging the mark\'s ring in the magnifier moves it too', Math.abs(px2 - px1) > 3, `${px1} -> ${px2} (loupe at ${lb2.x})`);
  await page.locator('.calibrate-dialog input').fill('20');
  const preview = await page.locator('.calibrate-dialog .hint').nth(1).innerText();
  ok('5. the dialog previews mm per px', /mm per px/.test(preview), preview.split('\n')[0]);
  const h0 = await page.locator('.calibrate-dialog .drag-handle').boundingBox();
  await page.mouse.move(h0.x + 20, h0.y + 5); await page.mouse.down(); await page.mouse.move(h0.x + 20 - 400, h0.y + 5 + 300, { steps: 6 }); await page.mouse.up();
  const d1 = await page.locator('.calibrate-dialog').boundingBox();
  ok('5. the calibration panel can be dragged off the ruler', Math.abs(d1.x - (h0.x - 400)) < 30 && d1.y > h0.y + 250, JSON.stringify(d1));
  await shot(page, '5-calibrate');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.waitForSelector('.calibrate-dialog', { state: 'detached' });
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('5. the scale is now labelled "calibrated scale"', (await page.locator('.inspector .hint', { hasText: 'Scale' }).innerText()).includes('(calibrated scale)'));

  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  ok('6. superimposition shows the profilogram', (await page.locator('svg.overlay path[stroke="var(--profile)"]').count()) >= 1);
  const nStored = () => page.evaluate(() => JSON.stringify(JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'N')));
  const n0 = await nStored(); await dragBy('N', 40, 0); await page.waitForTimeout(900); const n1 = await nStored();
  ok('6. and cannot be edited (a drag pans; N is unchanged in the library)', n0 === n1, n0 + ' → ' + n1 + ' circles=' + (await page.locator('g.landmark[data-id="N"] circle').count()) + ' rects=' + (await page.locator('g.landmark[data-id="N"] rect').count()));
  await shot(page, '6-superimposition');
  await page.getByRole('button', { name: '‹ Tracing' }).click();

  await page.getByRole('button', { name: '‹ Library' }).click();
  await page.waitForSelector('.cards .card');
  const chip = await page.locator('.lib-chip').first().innerText(), meta = await page.locator('.card .meta').first().innerText();
  ok('7. the card shows status and what is left', chip === 'To review' && /to review/.test(meta), `${chip} · ${meta}`);
  const tf = await page.evaluate(() => { const i = document.querySelector('.card .thumb img'), r = document.querySelector('.card .thumb').getBoundingClientRect(); return [i.style.transform, Math.round(r.width), Math.round(r.height)]; });
  ok('7. the card thumbnail is square and shown flipped and levelled like the case', tf[0].includes('scaleX(-1)') && tf[0].includes('rotate(') && tf[1] === tf[2], JSON.stringify(tf));
  await shot(page, '7-library');

  await page.getByRole('button', { name: 'Import…' }).click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  ok('8. importing the same film again reopens it, no duplicate', (await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('fakeLib')).cases).length)) === 1
    && (await page.locator('.sidebar .hint', { hasText: 'already in the library' }).count()) === 1);

  // Enhance is open by default (owner, 30 Sep).
  await page.locator('.case-panel .enhance input[type="range"]').first().fill('1.5');
  await page.locator('.case-panel .enhance input[type="checkbox"]').check();
  const filt = await page.evaluate(() => [document.querySelector('.stage canvas').style.filter, document.querySelector('.loupe canvas').style.filter]);
  ok('9. Enhance filters the film and the magnifier (CSS filter, works in WebKit)', filt.every((f) => f.includes('brightness(1.5)') && f.includes('invert(1)')), JSON.stringify(filt));
  await page.locator('.case-panel .enhance input[type="checkbox"]').uncheck();
  const pix = () => page.evaluate(() => { const c = document.querySelector('.stage canvas'); const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let s = 0; for (let i = 0; i < d.length; i += 4) s += Math.abs(d[i] - d[i + 4 < d.length ? i + 4 : i]); return s; });
  const edges0 = await pix();
  await page.locator('.case-panel .enhance label', { hasText: 'Sharpness' }).locator('input').fill('2');
  await page.waitForTimeout(800);
  const edges1 = await pix();
  ok('9. Sharpness makes the film crisper on screen (more edge contrast)', edges1 > edges0 * 1.1, `${edges0} → ${edges1}`);
  await page.getByRole('radio', { name: 'mm grid' }).click();
  ok('9. but never the mm-grid paper', (await page.evaluate(() => document.querySelector('.stage canvas').style.filter)) === 'none');
  await page.getByRole('radio', { name: 'Radiograph' }).click();
  // Task 7 (owner rulings R-B2, R-B4, 7 Oct): a second installed model fills a point the main model lacks, only when
  // that model's point passes the 2 mm gate. A fresh library each time; SYNTHETIC points only.
  const importWith = async (mode) => {
    await page.evaluate((mode) => localStorage.setItem('fakeLib', JSON.stringify({ cases: {}, settings: {}, extraMode: mode })), mode);
    await page.reload(); await page.waitForSelector('.library');
    await page.getByRole('button', { name: 'Import…' }).click();
    await page.waitForSelector('g.landmark[data-id="S"]');
    await page.getByRole('tab', { name: 'Landmarks' }).click();
    return lmGroup(0, 1);
  };
  const np1 = await importWith('scored');
  ok('T7. an extra model whose U1A passes the gate fills it: "Not placed" no longer lists the upper incisor apex',
    !np1.includes('U1A') && np1.length === 11 && (await page.locator('g.landmark[data-id="U1A"]').count()) === 1, np1.join(', '));
  await page.waitForTimeout(1000);
  const u1aSaved = await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'U1A'));
  ok('T7. the filled point is saved as an AI point, unverified, where the extra model put it', !!u1aSaved && u1aSaved.source === 'ai' && !u1aSaved.verified
    && u1aSaved.aiX === 1050 && u1aSaved.aiY === 680, JSON.stringify(u1aSaved));
  await page.reload(); await page.waitForSelector('.cards .card');
  await page.locator('.cards .card .open').first().click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  ok('T7. closed and reopened: U1A is still placed, and nothing is detected again', (await page.locator('g.landmark[data-id="U1A"]').count()) === 1
    && !(await lmGroup(0, 1)).includes('U1A') && (await page.evaluate(() => window.__detects || 0)) === 0);
  const np2 = await importWith('tooFar');
  ok('T7. the same extra with U1A over 2 mm (tooFar) places nothing: "Not placed" still lists U1A',
    np2.includes('U1A') && np2.length === 12 && (await page.locator('g.landmark[data-id="U1A"]').count()) === 0, np2.join(', '));
  const np3 = await importWith('error');
  ok('T7. an extra model that errors leaves the main model\'s 19 points and U1A unplaced',
    np3.includes('U1A') && (await page.locator('g.landmark').count()) === 19, np3.join(', '));
  // Review I1 (owner ruling R-B2): the MAIN model's own new point over 2 mm, and no other model installed. It is not
  // placed, and it is shown as a ghost suggestion (the main model's diamond for U1A only), not lost.
  const np4 = await importWith('mainTooFar');
  await page.waitForSelector('g.ghost[data-model="SYNTHETIC-stub"] g.ghost-pt[data-id="U1A"]', { timeout: 5000 }).catch(() => {});
  const mainGhostIds = await page.locator('g.ghost[data-model="SYNTHETIC-stub"] g.ghost-pt').evaluateAll((els) => els.map((e) => e.getAttribute('data-id')));
  ok('I1. the main model\'s own U1A over 2 mm is not placed: "Not placed" lists it', np4.includes('U1A') && (await page.locator('g.landmark[data-id="U1A"]').count()) === 0, np4.join(', '));
  ok('I1. … and it shows as the main model\'s ghost diamond, U1A only', mainGhostIds.length === 1 && mainGhostIds[0] === 'U1A', JSON.stringify(mainGhostIds));
  // Owner, 16 Oct: a loading bar per model at the top of the film while it is traced; they fade when all have ended.
  // Automatic best Task 7 fix round 1: a bar shows only once the ghost ticks are known (`ghosts_hidden`, stored since
  // format 15's upgrade; this fake library has no model catalogue, so it could never be upgraded): every ghost on here.
  await page.evaluate(() => localStorage.setItem('fakeLib', JSON.stringify({ cases: {}, settings: { ghosts_hidden: '[]' }, extraMode: 'bars' })));
  await page.reload(); await page.waitForSelector('.library');
  await page.getByRole('button', { name: 'Import…' }).click();
  await page.waitForSelector('.model-bar[data-model="aariz-cepha29"]', { timeout: 3000 }).catch(() => {});
  const barsNow = () => page.locator('.model-bar').evaluateAll((els) => els.map((e) => `${e.dataset.model}:${e.querySelector('.mb-state').textContent}`));
  ok('B1. (review I-1) an announcement from another film\'s run, or from a batch, shows no bar', (await page.locator('.model-bar[data-model="stale-model"], .model-bar[data-model="batch-model"]').count()) === 0);
  ok('B1. while a film is traced, each model has a bar: the main model done, Aariz working', JSON.stringify(await barsNow()) === JSON.stringify(['main:✓', 'aariz-cepha29:working…']),
    JSON.stringify(await barsNow()));
  await page.waitForTimeout(1700);
  ok('B2. then Aariz is done and GU2Net shows it gave up at its limit', JSON.stringify(await barsNow()) === JSON.stringify(['main:✓', 'aariz-cepha29:✓', 'gu2net:gave up after 15 s']),
    JSON.stringify(await barsNow()));
  const lineShown = await page.evaluate(() => document.body.innerText.includes('GU2Net took longer than 15 s'));
  ok('B2. … and with its ghost on, its "gave up" line shows (the instrument B4 relies on can see it)', lineShown);
  await page.waitForTimeout(3500);
  ok('B3. a few seconds after the last one ends, the bars are gone', (await page.locator('.model-bars').count()) === 0);
  // Owner D2: GU2Net's ghost ticked off: its bar and its "gave up" line stay hidden (no point waits for it); Aariz's show.
  await page.evaluate(() => localStorage.setItem('fakeLib', JSON.stringify({ cases: {}, settings: { ghosts_hidden: '["gu2net"]' }, extraMode: 'bars' })));
  await page.reload(); await page.waitForSelector('.library');
  await page.getByRole('button', { name: 'Import…' }).click();
  await page.waitForSelector('.model-bar[data-model="aariz-cepha29"]', { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1700);
  const quiet = { bars: await barsNow(), line: await page.evaluate(() => document.body.innerText.includes('GU2Net took longer than 15 s')) };
  ok('B4. a model whose ghost is off shows no bar and no "gave up" line; the others do', JSON.stringify(quiet) === JSON.stringify({ bars: ['main:✓', 'aariz-cepha29:✓'], line: false }), JSON.stringify(quiet));

  // Owner, 1 Nov 2026: "Thanks to Dr Linton Nash" is always visible at the foot of the left sidebar, at the narrowest
  // supported size too (tauri.conf.json minWidth/minHeight, 1100x700), below the Models…/Analyses…/Settings… row, never overlapping it.
  await page.setViewportSize({ width: 1100, height: 700 });
  await page.waitForTimeout(200);
  const credit = page.locator('.sidebar .sidebar-credit');
  const cb = await credit.boundingBox();
  const sbBox = await page.locator('aside.sidebar').boundingBox();
  ok('CR1. 1100x700: the thanks line is visible and reads exactly "Thanks to Dr Linton Nash"', (await credit.isVisible()) && (await credit.innerText()) === 'Thanks to Dr Linton Nash', String(await credit.innerText()));
  ok('CR2. 1100x700: it sits inside the window and the sidebar, at the sidebar\'s foot', !!cb && cb.y >= 0 && cb.y + cb.height <= 700 && cb.y + cb.height <= sbBox.y + sbBox.height + 1 && cb.y + cb.height >= sbBox.y + sbBox.height - 40, JSON.stringify({ cb, sbBox }));
  // With a film open the sidebar's contents are taller than 700 px, so they scroll; the line must stay put while they do.
  await page.locator('.sidebar-scroll').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  const cb2 = await credit.boundingBox();
  ok('CR3. scrolling the sidebar to its end does not move the thanks line (pinned)', !!cb2 && Math.abs(cb2.y - cb.y) < 0.5, `${cb && cb.y} -> ${cb2 && cb2.y}`);
  const scrollBox = await page.locator('.sidebar-scroll').boundingBox();
  ok('CR4. the scrolling part ends above the thanks line (no overlap)', scrollBox.y + scrollBox.height <= cb2.y + 0.5, `${scrollBox.y + scrollBox.height} vs ${cb2.y}`);
  const btnBoxes = [];
  for (const n of ['Models…', 'Analyses…', 'Settings…']) { const bb = await page.locator('aside.sidebar').getByRole('button', { name: n }).boundingBox(); if (bb) btnBoxes.push(bb); }
  ok('CR5. scrolled to the end, Models…/Analyses…/Settings… are all visible above the thanks line, none overlapped', btnBoxes.length === 3 && btnBoxes.every((bb) => bb.y >= scrollBox.y - 0.5 && bb.y + bb.height <= cb2.y + 0.5), JSON.stringify(btnBoxes.map((bb) => [bb.y, bb.y + bb.height])) + ' vs ' + cb2.y);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(200);

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
