// Ghost marks smoke (spec 2026-10-01 Part 3): the extra models run after the main one, their points are stored and drawn
// as ghosts with a key and a hover distance. Built UI in Chromium, stubbed Tauri runtime. SYNTHETIC image, names and dates.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const film = (id, tp, name, traced, spacingMm = null) => ({ id, path: `/Users/demo/${id}.png`, patientName: name, patientKey: name.toLowerCase(), dateOfBirth: '2010-01-02',   // SYNTHETIC
  scanId: null, timepoint: tp, takenOn: '2026-01-10', takenOnSource: 'label', facing: 'right', orientation: {}, display: {}, spacingMm, verifiedAt: null, verifiedBy: null,
  landmarks: traced ? Object.entries(base).map(([lid, [x, y]]) => ({ id: lid, x: x + 350, y: y + 300, source: 'ai', verified: false, aiX: null, aiY: null, confidence: 0.8 })) : [],
  createdAt: '2026-09-30T01:00:00Z', updatedAt: '2026-09-30T01:00:00Z', deletedAt: null, identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [],
  // Task 5 (D2): the real CaseDoc always carries these; a stub without them has the panel read undefined.
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [],
  stage: null, inSeries: true });
const ready = (id, title, tier, main) => ({ id, title, tier, citation: 'SYNTHETIC', sizeMb: 60,
  licence: { version: '1', code: 'MIT', weights: 'w', summary: 's', url: 'u', nonCommercial: tier === 'optional' }, licenceAccepted: true,
  status: 'ready', stage: null, error: null, main, msPerFilm: 400, page: 'p' });
const seed = { settings: {}, runs: [], delayExtras: 0, base, cases: {
  c1: film('c1', 'T1', 'Demo Ghost', false),
  c2: film('c2', 'T2', 'Demo Other', true),
  c3: film('c3', 'T3', 'Demo Late', false),
  // Owner 6 Oct, item S/T: a genuinely CALIBRATED case (spacingMm set), distinct from the assumed 0.1 mm/px default,
  // so the "=" label and its own mm figure are a real, independent check, not a relabelled copy of the uncalibrated one.
  c5: film('c5', 'T5', 'Demo Calibrated', false, 0.05),   // SYNTHETIC
}, models: [ready('cwlachap-hrnet-w32', 'cwlachap HRNet-W32', 'standard', true), ready('gu2net-isbi19', 'GU2Net', 'standard', false),
  ready('srpose-cldet23', 'SRPose (CL-Detection 2023)', 'optional', false),
  // A second always-succeeding extra model (19, 20): with GU2Net and the always-failing SRPose above, the key has
  // three rows — two tick-boxes to show "mixed ticks" (owner, 5 Oct) and one error row with no tick-box.
  ready('srpose2-fake-model', 'SRPose2', 'optional', false)] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    let cb = 0, clock = 0;
    const det = (db, dx) => {
      const pts = Object.entries(db.base).map(([id, [x, y]], i) => ({ id, x: x + 350 + dx, y: y + 300, confidence: 0.8, channel: i }));
      return { modelId: 'x', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub', timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 },
        landmarks: pts.map(({ id, x, y, confidence }) => ({ id, x, y, confidence })),
        raw: pts.map(({ id, x, y, channel }) => ({ channel, landmarkId: id, x, y, peak: 0.8 })) };
    };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },   // kept, so a test can emit an event
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'cwlachap-hrnet-w32', searched: [], error: null };
          case 'plugin:event|listen': { (window.__listeners ||= {})[a.event] = [...(window.__listeners[a.event] || []), a.handler]; return a.handler; }
          // Leftovers Task 3 (M2): the first-open step, as Rust answers it. db.introStep: undefined → not stubbed (null, as
          // before); 'waiting' → the base is not installed yet (null); 'base-ready' → the step runs once (its note), then
          // 'done' (null for ever after). Each call is counted.
          case 'models_auto_best_intro': {
            db.introCalls = (db.introCalls || 0) + 1;
            const n = db.introStep === 'base-ready' ? { before: null, keptDeclines: 1 } : null;
            if (n) db.introStep = 'done';
            store(db); return n;
          }
          case 'models_list': return db.models;
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map((c) => ({ id: c.id, patientName: c.patientName,
            timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation,
            landmarks: c.landmarks.length, unverified: c.landmarks.length, verifiedAt: null, deletedAt: c.deletedAt, patientKey: c.patientKey,
            dateOfBirth: c.dateOfBirth, identityChecked: true }));
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, orientation: a.edit.orientation, display: a.edit.display });
            store(db); return { updatedAt: c.updatedAt, verifiedAt: null }; }
          case 'detect_landmarks': return { ...det(db, 0), modelId: 'cwlachap-hrnet-w32', facingLeft: false, meanPeakRight: 0.8, meanPeakLeft: 0.2 };
          case 'detect_extras': {
            // db.extrasScript: [[delay ms, dx], …] per call, for the re-detect race; otherwise db.delayExtras and +12 px.
            const step = (db.extrasScript || []).shift(); if (step) store(db);
            const [delay, dx] = step || [db.delayExtras, 12];
            if (delay) await new Promise((r) => setTimeout(r, delay));
            const fresh = load();
            // db.gu2Late: 'timeout' | 'busy' — GU2Net gives no points, as Rust answers past the 15 s limit or while its run
            // for an earlier film is still going (Task 12, MODEL-LIMIT-1, ruling T12-2).
            const late = { timeout: 'GU2Net took longer than 15 s on this film; its points were not used.',
              busy: 'GU2Net is still busy with an earlier film; its points are not used on this one.' }[fresh.gu2Late];
            return [late ? { modelId: 'gu2net-isbi19', title: 'GU2Net', detection: null, error: late, timedOut: true }
                : { modelId: 'gu2net-isbi19', title: 'GU2Net', detection: { ...det(fresh, dx), modelId: 'gu2net-isbi19' }, error: null, timedOut: false },
              { modelId: 'srpose2-fake-model', title: 'SRPose2', detection: { ...det(fresh, dx - 8), modelId: 'srpose2-fake-model' }, error: null, timedOut: false },
              { modelId: 'srpose-cldet23', title: 'SRPose (CL-Detection 2023)', detection: null, error: 'SRPose (CL-Detection 2023) couldn’t read this film: SYNTHETIC', timedOut: false }];
          }
          case 'library_record_ai': { const d2 = load(); d2.runs.push({ caseId: a.caseId, modelId: a.run.modelId, facing: a.run.facing, points: a.points, at: ++clock + Date.now() }); store(d2); return null; }
          case 'library_ghosts': {
            const newest = {};
            for (const r of db.runs.filter((x) => x.caseId === a.caseId)) if (!newest[r.modelId] || newest[r.modelId].at < r.at) newest[r.modelId] = r;
            return Object.values(newest).map((r) => ({ modelId: r.modelId, ranAt: String(r.at), facing: r.facing, points: r.points }));
          }
          case 'library_series': return [{ id: a.caseId, timepoint: db.cases[a.caseId].timepoint, takenOn: '2026-01-10', takenOnSource: 'label', createdAt: '', stage: null, inSeries: true, nameOnly: false }];
          case 'library_label_text': return { lines: [], suggestions: [] };
          case 'settings_get':
            // I3 (owner, 5 Oct): on demand, delay just the old ghosts_shown flag so models_list (and modelList.rows)
            // answers first — the race that used to let the ghosts_hidden upgrade silently never run.
            if (localStorage.getItem('delaySettings') === '1' && a.key === 'ghosts_shown') await new Promise((r) => setTimeout(r, 400));
            return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png });

  const toLibrary = async () => { await page.getByRole('button', { name: '‹ Library' }).click(); await page.waitForSelector('.library'); };
  const openCase = async (tp) => { await page.locator('.cards .card .open', { hasText: tp }).first().click(); await page.waitForSelector('g.landmark[data-id="S"]'); };
  const gu = 'g.ghost[data-model="gu2net-isbi19"] path';
  const sp2 = 'g.ghost[data-model="srpose2-fake-model"] path';
  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')));

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();

  await openCase('T1');                                    // untraced: detection runs, then the extra models
  await page.waitForSelector(gu);
  ok('1. after detection GU2Net is drawn as 19 ghost marks', (await page.locator(gu).count()) === 19);
  ok('1. the main model is not drawn as a ghost', (await page.locator('g.ghost[data-model="cwlachap-hrnet-w32"]').count()) === 0);
  const key = page.locator('.ghost-key');
  await key.getByText("SRPose (CL-Detection 2023) couldn't read this film.").waitFor();
  ok('2. the key lists GU2Net and says SRPose couldn\'t read the film', (await key.getByText('GU2Net').count()) === 1
    && (await key.getByText("SRPose (CL-Detection 2023) couldn't read this film.").count()) === 1);
  await page.screenshot({ path: `${__dirname}/out/ghosts-1.png` });

  // Task C (owner, 5 Oct): the SVG <title> tooltip is replaced by an on-canvas label, with a bigger invisible hover
  // area and no time-out. GU2Net's and SRPose2's diamonds for the same landmark sit only a few px apart (both carry
  // a small, different offset from the real point), so hide SRPose2 first to test GU2Net's own label unambiguously;
  // the "two models' diamonds close together" edge case below covers the overlap itself.
  const hoverLabel = page.locator('.ghost-hover-label');
  const ghostHit = (model, id) => `g.ghost[data-model="${model}"] g.ghost-pt[data-id="${id}"] circle.ghost-hit`;
  const centreOf = async (sel) => { const b = await page.locator(sel).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const leaveGhosts = async () => { await page.mouse.move(5, 5); await page.waitForTimeout(650); };   // clears any hover + its ~0.5 s fade

  await key.getByLabel('Show SRPose2', { exact: true }).uncheck();
  await page.waitForSelector(sp2, { state: 'detached' });
  const guS = await centreOf(ghostHit('gu2net-isbi19', 'S'));
  await page.mouse.move(guS.x, guS.y);
  await hoverLabel.waitFor();
  const label = await hoverLabel.textContent();
  // Owner, 6 Oct, item S: this film has no ruler calibration (spacingMm null), so the label's distance comes from the
  // ASSUMED scale and must carry the "≈" marker, not read as if it were measured. The expected mm figure is computed
  // from the fixture's own constants (fix round 3, owner 6 Oct — folded in so there is only one assertion of this
  // string, not two): this stub's extras run offsets GU2Net by EXTRA_DX px (the default step in detect_extras,
  // [db.delayExtras, 12]), and T1 has no spacingMm, so App.tsx's own assumed-scale fallback (0.1 mm/px) applies.
  const EXTRA_DX = 12, ASSUMED_MM_PER_PX = 0.1;
  const expectedMm = (EXTRA_DX * ASSUMED_MM_PER_PX).toFixed(1);
  ok('3. hovering GU2Net\'s S shows an on-canvas label naming the point, marked ≈ (assumed scale), with the mm figure matching dx×ASSUMED_MM_PER_PX',
    label === `GU2Net: ≈${expectedMm} mm from Sella (S)`, `${label} (expected from dx=${EXTRA_DX}px × ${ASSUMED_MM_PER_PX} mm/px)`);

  // Edge case: still visible after 3 s of hovering — no time-out, unlike the old <title> tooltip.
  await page.waitForTimeout(3000);
  ok('Task C. the label is still visible after 3 s of hovering (no time-out)', (await hoverLabel.count()) === 1 && (await hoverLabel.textContent()) === label);

  await leaveGhosts();
  ok('Task C. the label is gone after leaving (past the ~0.5 s fade)', (await hoverLabel.count()) === 0);

  // Edge case: hovering near, not exactly on, the diamond still shows the label — the ~10 screen px hit area, not
  // just the 1.3 px outline the old CSS reacted to.
  await page.mouse.move(guS.x + 6, guS.y - 6);
  await hoverLabel.waitFor();
  ok('Task C. hovering near (not exactly on) the diamond still shows the label', (await hoverLabel.textContent()) === label);
  await leaveGhosts();

  // I5 (owner, 5 Oct): the ghost hit area must keep the STAGE's own cursor (crosshair while placing, pointer while
  // choosing) next to the diamond, not its old "?" (cursor: help via pointer-events: visiblePainted on the 1.3 px
  // outline). Unplace S (select it, then remove it) so the stage enters placement mode, then read the computed
  // cursor directly over GU2Net's S ghost hit area; re-place S where it was so the drag check (6) below still finds it.
  const sBefore = await page.locator('g.landmark[data-id="S"] circle').first().boundingBox();
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await page.locator('.lm-list button', { hasText: 'Sella' }).click();
  await page.keyboard.press('Backspace');
  await page.waitForSelector('.place-hint');
  const ghostCursor = await page.locator(ghostHit('gu2net-isbi19', 'S')).evaluate((el) => getComputedStyle(el).cursor);
  ok('I5. in placement mode the ghost hit area shows the stage’s crosshair cursor, not its own', ghostCursor === 'crosshair', ghostCursor);
  await page.mouse.click(sBefore.x + sBefore.width / 2, sBefore.y + sBefore.height / 2);
  await page.waitForSelector('g.landmark[data-id="S"]');

  // M5/L (owner, 5 Oct / 6 Oct): the label stays inside the stage near the right edge, flipping to the diamond's
  // LEFT instead of running off; item L also uses the label's own MEASURED width (not a fixed guess) and clamps on
  // BOTH sides, since a flip alone still runs off a stage narrow enough. Narrowing the stage itself (not the window)
  // is the simplest way to put a diamond within the label's own width of an edge, exercising the same clamp logic a
  // point drawn near the true edge would.
  const stageEl = page.locator('.stage');
  const stageBox = () => stageEl.boundingBox();
  await stageEl.evaluate((el) => { el.style.maxWidth = '260px'; el.style.width = '260px'; });
  await page.waitForTimeout(150);
  const guSNarrow = await centreOf(ghostHit('gu2net-isbi19', 'S'));
  await page.mouse.move(guSNarrow.x, guSNarrow.y);
  await hoverLabel.waitFor();
  const flippedBox = await hoverLabel.boundingBox();
  const narrowStage = await stageBox();
  // M5, corrected 6 Oct (item L): "ends at or before the diamond" assumed a flip always had somewhere clear to land.
  // With the label's real (measured) width, S's label here actually fits without flipping at all — the CLAMP alone
  // keeps it on-stage, which the old fixed-320px guess never got the chance to show. Containment on the stage is
  // the property that actually matters (and is what M5 was really trying to protect against: the label running off
  // the visible area), so that is what this now checks.
  ok('M5/L. near the right edge the label’s whole box lies within the stage’s own box (measured width, clamped)',
    flippedBox.x >= narrowStage.x - 1 && flippedBox.x + flippedBox.width <= narrowStage.x + narrowStage.width + 1,
    JSON.stringify({ flippedBox, narrowStage }));
  await leaveGhosts();

  // L: a second diamond (Gonion), whose longer label (its point name is longer than Sella's) needs a little more
  // room to actually fit the stage at all — widened just enough for that (340px: Gonion's label measures ~272px) so
  // this checks CONTAINMENT, not the separate, impossible-to-satisfy case of a label wider than the whole stage.
  // With the old fixed-320px guess, this diamond's flipped label ran clean off the stage's LEFT edge (a flip alone,
  // towards whichever side has more room, is not enough — the flipped box must also be clamped to the edge it flips
  // TOWARDS).
  await stageEl.evaluate((el) => { el.style.maxWidth = '340px'; el.style.width = '340px'; });
  await page.waitForTimeout(150);
  const goNarrow = await centreOf(ghostHit('gu2net-isbi19', 'Go'));
  await page.mouse.move(goNarrow.x, goNarrow.y);
  await hoverLabel.waitFor();
  const leftBox = await hoverLabel.boundingBox();
  const goStage = await stageBox();
  ok('L. a second diamond’s flipped label is also clamped within the stage’s own box, not run off its left edge',
    leftBox.x >= goStage.x - 1 && leftBox.x + leftBox.width <= goStage.x + goStage.width + 1,
    JSON.stringify({ leftBox, goNarrow, goStage }));
  await leaveGhosts();
  await stageEl.evaluate((el) => { el.style.maxWidth = ''; el.style.width = ''; });
  await page.waitForTimeout(150);

  await key.getByLabel('Show SRPose2', { exact: true }).check();
  await page.waitForSelector(sp2);

  // Edge case: two models' diamonds close together (GU2Net and SRPose2 each carry their own small offset from the
  // same real point). They remain two separate hit areas — hovering each gives a distinct, correctly named label —
  // but where they overlap the topmost (later-drawn, SRPose2) one wins; that overlap is a real limit of a point-radius
  // hit area and is recorded as-is here, not hidden by widening the model apart only for the test.
  const sp2S = await centreOf(ghostHit('srpose2-fake-model', 'S'));
  const apart = Math.hypot(sp2S.x - guS.x, sp2S.y - guS.y);
  ok('Task C. the two models’ S diamonds sit close together on screen (< 10 px apart)', apart < 10, `${apart.toFixed(2)} px`);
  await page.mouse.move(guS.x, guS.y);
  await hoverLabel.waitFor();
  const atGu = await hoverLabel.textContent();
  ok('Task C. close together: hovering where they overlap gives the topmost (later-drawn) model’s label, SRPose2’s',
    atGu.startsWith('SRPose2:'), atGu);
  await leaveGhosts();
  await key.getByLabel('Show SRPose2', { exact: true }).uncheck();
  await page.waitForSelector(sp2, { state: 'detached' });
  await page.mouse.move(guS.x, guS.y);
  await hoverLabel.waitFor();
  ok('Task C. … hiding SRPose2 reaches GU2Net’s own label at the same spot', (await hoverLabel.textContent()) === label);
  await leaveGhosts();
  await key.getByLabel('Show SRPose2', { exact: true }).check();
  await page.waitForSelector(sp2);

  const runs = (await db()).runs.filter((r) => r.caseId === 'c1');
  ok('7. one film records a run per model that read it: the main model, GU2Net and SRPose2', runs.length === 3
    && runs.map((r) => r.modelId).sort().join() === 'cwlachap-hrnet-w32,gu2net-isbi19,srpose2-fake-model',
    runs.map((r) => r.modelId).join());
  ok('7. every channel\'s points are stored with each run', runs.every((r) => r.points.length === 19));

  // 6. A landmark 12 px from its ghost still drags. Select the point's own marker shape (a verified point draws a
  // <rect>, an unverified one a <circle>; S was re-placed by hand above, so it is verified) rather than assuming
  // one shape — a selector tied to only one shape is a guard that can stop matching on an unrelated timing change
  // (e.g. S's "active" ring, itself a <circle>, fading as auto-advance moves on) without the drag itself breaking.
  const mark = page.locator('g.landmark[data-id="S"] rect, g.landmark[data-id="S"] circle').first();
  const b = await mark.boundingBox();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.length === 19);   // the autosave has run
  const before = (await db()).cases.c1.landmarks.find((l) => l.id === 'S');
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 40, b.y + b.height / 2 + 30, { steps: 6 }); await page.mouse.up();
  await page.waitForFunction((x0) => JSON.parse(localStorage.getItem('fakeLib')).cases.c1.landmarks.find((l) => l.id === 'S').x !== x0, before.x, { timeout: 5000 }).catch(() => {});
  const after = (await db()).cases.c1.landmarks.find((l) => l.id === 'S');
  ok('6. dragging a landmark beside a ghost still moves the landmark', after.x !== before.x, `${before.x} → ${after.x}`);

  // Owner, 5 Oct: a tick-box per model, not one "Show other models" switch, plus "Show all" (indeterminate — the
  // dash — when only some are on). The key now has three rows: GU2Net and SRPose2 (tickable; both read this film)
  // and SRPose (an error row, no tick-box).
  await page.waitForSelector(sp2);
  ok('20. three models in the key: two tickable and one error row, no tick-box on the error', (await key.locator('input[type="checkbox"]').count()) === 3   // Show all + 2 models
    && (await key.getByText("SRPose (CL-Detection 2023) couldn't read this film.").count()) === 1);
  const showAll = key.getByLabel('Show all', { exact: true });
  const tickGu = key.getByLabel('Show GU2Net', { exact: true });
  const tickSp2 = key.getByLabel('Show SRPose2', { exact: true });

  await tickGu.uncheck();
  ok('19. unticking one model hides only its diamonds', (await page.locator(gu).count()) === 0 && (await page.locator(sp2).count()) > 0);
  ok('19. "Show all" shows the dash when only some models are on', await showAll.evaluate((el) => el.indeterminate));

  // Clicking the dash standardises to fully on (as a native tri-state "select all" checkbox does) — the owner's
  // "on" direction. From there, the next click is the owner's "off": every model's ghosts go.
  await showAll.check();
  await page.waitForSelector(gu); await page.waitForSelector(sp2);
  ok('19. clicking the dash brings every model back (fully "on")', (await page.locator(gu).count()) > 0 && (await page.locator(sp2).count()) > 0
    && (await showAll.isChecked()) && !(await showAll.evaluate((el) => el.indeterminate)));

  await showAll.uncheck();
  ok('19. "Show all" off removes every model\'s ghosts', (await page.locator('g.ghost').count()) === 0);
  ok('19. … and both tick-boxes read unticked', !(await tickGu.isChecked()) && !(await tickSp2.isChecked()));

  await showAll.check();
  await page.waitForSelector(gu); await page.waitForSelector(sp2);
  ok('19. "Show all" on brings every model\'s ghosts back', (await page.locator(gu).count()) > 0 && (await page.locator(sp2).count()) > 0);
  ok('19. … and "Show all" itself reads ticked, no dash', (await showAll.isChecked()) && !(await showAll.evaluate((el) => el.indeterminate)));

  await tickGu.uncheck();
  await toLibrary(); await openCase('T1');
  await page.waitForSelector(sp2);
  ok('19. the choice holds on the next case: GU2Net stays hidden, SRPose2 still shows', (await page.locator(gu).count()) === 0 && (await page.locator(sp2).count()) > 0);
  await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await openCase('T1');
  await page.waitForSelector(sp2);
  const hiddenNow = JSON.parse((await db()).settings.ghosts_hidden || '[]');
  ok('19. … and after a reload, from the saved ghosts_hidden setting', (await page.locator(gu).count()) === 0
    && (await page.locator(sp2).count()) > 0 && hiddenNow.includes('gu2net-isbi19') && !hiddenNow.includes('srpose2-fake-model'), JSON.stringify(hiddenNow));

  // Restore both shown before the later tests, which read GU2Net's ghost.
  await page.locator('.ghost-key').getByLabel('Show all', { exact: true }).check();
  await page.waitForSelector(gu);

  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.waitForTimeout(300);
  ok('5. the Superimposition page draws no ghosts', (await page.locator('g.ghost').count()) === 0);

  // Owner, 6 Oct, items S and T: a GENUINELY calibrated case (T5, spacingMm 0.05 — unlike T1's assumed 0.1), so the
  // "=" form and its own mm figure are checked independently of the assumed-scale arithmetic above (positive control:
  // 0.05 mm/px gives a DIFFERENT number than the assumed 0.1 mm/px would for the same dx, so this cannot pass by
  // reusing check 3's or the assumed-scale check's value). Done here, after all of c1/T1's own checks, so it does not
  // disturb T1's detection-run state (the SRPose error row and the per-film "Show SRPose2" tick live on that run).
  await toLibrary(); await openCase('T5');                 // untraced: detection + extras run fresh, calibrated
  await page.waitForSelector(gu);
  const key5 = page.locator('.ghost-key');
  await key5.getByLabel('Show SRPose2', { exact: true }).uncheck();   // its diamond sits close to GU2Net's (see Task C edge case)
  await page.waitForSelector(sp2, { state: 'detached' });
  const CALIB_MM_PER_PX = 0.05, EXTRA_DX_T5 = 12, ASSUMED_MM_PER_PX_T5 = 0.1;
  const calibExpectedMm = (EXTRA_DX_T5 * CALIB_MM_PER_PX).toFixed(1), assumedExpectedMm = (EXTRA_DX_T5 * ASSUMED_MM_PER_PX_T5).toFixed(1);
  ok('positive control: the calibrated mm figure differs from the assumed-scale one for the same dx',
    calibExpectedMm !== assumedExpectedMm, `${calibExpectedMm} vs ${assumedExpectedMm}`);
  const guCalib = await centreOf(ghostHit('gu2net-isbi19', 'S'));
  await page.mouse.move(guCalib.x, guCalib.y);
  await hoverLabel.waitFor();
  const calibLabel = await hoverLabel.textContent();
  ok('S/T. a calibrated case’s label reads "=" and the mm figure from ITS OWN spacingMm, not the assumed default',
    calibLabel === `GU2Net: =${calibExpectedMm} mm from Sella (S)`, calibLabel);
  await leaveGhosts();

  // 8. A slow extra model's answer never lands on the next film (Review Focus 4).
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.delayExtras = 800; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await toLibrary(); await openCase('T3');                 // untraced: its extras are now slow
  await toLibrary(); await openCase('T2');                 // traced, no runs of its own
  await page.waitForTimeout(1500);
  ok('8. a newer case shows no ghosts from the slow, older detection', (await page.locator('g.ghost').count()) === 0 && (await page.locator('.ghost-key').count()) === 0);

  // 9. A re-detect while the extra models are still running: only the newer run is drawn and kept (Review Focus 4).
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.delayExtras = 0;
    d.cases.c4 = { ...d.cases.c3, id: 'c4', path: '/Users/demo/c4.png', timepoint: 'T4', landmarks: [] };
    d.extrasScript = [[1200, 12], [0, 30]]; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await toLibrary(); await openCase('T4');                 // untraced: the first extras run is slow (+12 px)
  await page.getByRole('button', { name: 'Re-detect' }).click();   // the second is fast (+30 px)
  await page.waitForTimeout(2000);
  // Hide SRPose2 first: its diamond sits a few px from GU2Net's (both carry their own small offset), close enough on
  // screen to overlap the hover area — see the "two models' diamonds close together" edge case above.
  await key.getByLabel('Show SRPose2', { exact: true }).uncheck();
  const guS4 = await centreOf(ghostHit('gu2net-isbi19', 'S'));
  await page.mouse.move(guS4.x, guS4.y);
  const t9 = await hoverLabel.textContent().catch(() => null);
  const runs9 = (await db()).runs.filter((r) => r.caseId === 'c4' && r.modelId === 'gu2net-isbi19');
  const newest = runs9.sort((p, q) => q.at - p.at)[0];
  ok('9. after a re-detect only the newer extras run is drawn', t9 === 'GU2Net: ≈3.0 mm from Sella (S)', t9);   // c4 (from c3) has no spacingMm: assumed scale
  ok('9. and the stored newest run is the newer one', newest && Math.round(newest.points[0].x - 350) === 30, newest && String(newest.points[0].x));

  // Task 12 (MODEL-LIMIT-1, rulings T12-1, T12-2): GU2Net past its 15 s limit, then still busy with an earlier film, on a
  // re-detect of T4 — which already has stored GU2Net runs. Its points are not used, its earlier ghosts are not drawn,
  // the key says why, and the main model's points are still placed. Then GU2Net answers again (positive control).
  const srpSentence = "SRPose (CL-Detection 2023) couldn't read this film.";
  for (const [mode, sentence] of [['timeout', 'GU2Net took longer than 15 s on this film; its points were not used.'],
    ['busy', 'GU2Net is still busy with an earlier film; its points are not used on this one.']]) {
    await page.evaluate((m) => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.gu2Late = m; localStorage.setItem('fakeLib', JSON.stringify(d)); }, mode);
    const guRunsBefore = (await db()).runs.filter((r) => r.caseId === 'c4' && r.modelId === 'gu2net-isbi19').length;
    await page.getByRole('button', { name: 'Re-detect' }).click();
    await key.getByText(sentence, { exact: true }).waitFor({ timeout: 5000 }).catch(() => {});
    ok(`12-${mode}. the key says so in one sentence, and SRPose's error sentence is unchanged`,
      (await key.getByText(sentence, { exact: true }).count()) === 1 && (await key.getByText(srpSentence, { exact: true }).count()) === 1,
      (await key.innerText()).replace(/\n/g, ' | '));
    ok(`12-${mode}. GU2Net's earlier stored points (${guRunsBefore} runs) are not drawn as ghosts on this film`,
      guRunsBefore > 0 && (await page.locator(gu).count()) === 0, `stored ${guRunsBefore}, drawn ${await page.locator(gu).count()}`);
    ok(`12-${mode}. no GU2Net run is recorded for it`,
      (await db()).runs.filter((r) => r.caseId === 'c4' && r.modelId === 'gu2net-isbi19').length === guRunsBefore);
    ok(`12-${mode}. the main model's points are still placed`, (await page.locator('g.landmark[data-id="S"]').count()) === 1
      && (await page.locator('g.landmark').count()) >= 19, String(await page.locator('g.landmark').count()));
  }
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); delete d.gu2Late; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await page.getByRole('button', { name: 'Re-detect' }).click();
  await page.waitForSelector(gu, { timeout: 5000 }).catch(() => {});
  ok('12-control. once GU2Net answers again its ghosts are drawn and the key has no time-limit sentence',
    (await page.locator(gu).count()) === 19 && (await key.getByText('took longer than', { exact: false }).count()) === 0
    && (await key.getByText('still busy', { exact: false }).count()) === 0);

  // 19's upgrade rule: with ghosts_hidden never set and the old ghosts_shown left at '0' from before this feature,
  // every other model starts hidden — and the upgrade is written once, as ghosts_hidden, so it never repeats.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); delete d.settings.ghosts_hidden;
    d.settings.ghosts_shown = '0'; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await openCase('T1');                                     // already traced, with stored GU2Net and SRPose2 runs
  await page.waitForTimeout(500);
  ok('19. upgrading from ghosts_shown=\'0\' hides every other model by default', (await page.locator('g.ghost').count()) === 0);
  const upgraded = JSON.parse((await db()).settings.ghosts_hidden || '[]').sort();
  ok('19. … and writes ghosts_hidden with every other model\'s id (including SRPose, which errors on every film)',
    upgraded.join() === ['gu2net-isbi19', 'srpose-cldet23', 'srpose2-fake-model'].sort().join(), upgraded.join());

  // I3 (owner, 5 Oct): the same upgrade, but with the old ghosts_shown flag answering AFTER models_list — this used
  // to leave ghostsUpgradeFlag as a ref, so the upgrade effect (keyed only on modelList.rows) ran once too early,
  // saw the flag still unknown, and never ran again: the upgrade silently never happened.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); delete d.settings.ghosts_hidden;
    d.settings.ghosts_shown = '0'; localStorage.setItem('fakeLib', JSON.stringify(d)); localStorage.setItem('delaySettings', '1'); });
  await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await openCase('T1');
  await page.waitForTimeout(900);   // well past the 400ms settings_get delay
    ok('I3. models_list answering before the old flag still upgrades and hides every other model',
    (await page.locator('g.ghost').count()) === 0, String(await page.locator('g.ghost').count()));
  const upgraded3 = JSON.parse((await db()).settings.ghosts_hidden || '[]').sort();
  ok('I3. … and ghosts_hidden is written, so the upgrade does not have to run again',
    upgraded3.join() === ['gu2net-isbi19', 'srpose-cldet23', 'srpose2-fake-model'].sort().join(), upgraded3.join());
  await page.evaluate(() => { localStorage.removeItem('delaySettings'); });

  // Owner, 6 Oct, item G: with ghosts_shown='0' and no other model Ready YET (the catalogue is loaded — modelList.rows
  // is non-empty — but every other model is still 'not-installed'), the upgrade must commit NOW, writing
  // ghosts_hidden='[]', not wait for one to become Ready. The old code returned early whenever readyOtherIds was
  // empty, postponing the upgrade indefinitely; the FIRST model to finish installing afterwards then triggered the
  // upgrade with the stale '0' flag and got hidden by it — a model the operator never ticked off.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fakeLib'));
    delete d.settings.ghosts_hidden; d.settings.ghosts_shown = '0';
    d.models = d.models.map((m) => (m.main ? m : { ...m, status: 'not-installed' }));   // catalogue loaded, nothing else Ready
    localStorage.setItem('fakeLib', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForSelector('.library');
  await page.waitForTimeout(300);
  const seededNow = JSON.parse((await db()).settings.ghosts_hidden ?? 'null');
  ok('G. no other model Ready yet: the upgrade still commits now, writing ghosts_hidden=[] (not postponed)',
    Array.isArray(seededNow) && seededNow.length === 0, JSON.stringify(seededNow));

  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fakeLib'));
    d.models.find((m) => m.id === 'gu2net-isbi19').status = 'ready';
    localStorage.setItem('fakeLib', JSON.stringify(d));
  });
  await page.reload();
  await page.waitForSelector('.library');
  await page.waitForTimeout(300);
  const afterInstall = JSON.parse((await db()).settings.ghosts_hidden ?? 'null');
  ok('G. … and once a model installs afterwards, it is NOT swept into the already-committed upgrade',
    Array.isArray(afterInstall) && afterInstall.length === 0 && !afterInstall.includes('gu2net-isbi19'), JSON.stringify(afterInstall));

  // Restore the full model catalogue (all Ready) for the edge cases below.
  await page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem('fakeLib'));
    d.models.forEach((m) => { if (!m.main) m.status = 'ready'; });
    d.settings.ghosts_hidden = '[]';
    localStorage.setItem('fakeLib', JSON.stringify(d));
  });

  // Edge case: exactly one other model installed — "Show all" simply mirrors that one tick-box; no dash is possible.
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.settings.ghosts_hidden = '[]';
    d.models = d.models.filter((m) => m.main || m.id === 'gu2net-isbi19'); localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await openCase('T1');
  await page.waitForSelector(gu);
  const key2 = page.locator('.ghost-key');
  ok('19. one other model: one tick-box, "Show all" mirrors it ticked (no dash possible)', (await key2.locator('input[type="checkbox"]').count()) === 2
    && (await key2.getByLabel('Show all', { exact: true }).isChecked()));
  await key2.getByLabel('Show GU2Net', { exact: true }).uncheck();
  ok('19. unticking the only model also unticks "Show all", still no dash', !(await key2.getByLabel('Show all', { exact: true }).isChecked())
    && !(await key2.getByLabel('Show all', { exact: true }).evaluate((el) => el.indeterminate)));

  // Edge case: no other models installed at all — the section doesn't appear (as now).
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.models = d.models.filter((m) => m.main); localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await openCase('T1');
  await page.waitForTimeout(300);
  ok('19. no other models installed: the section doesn\'t appear', (await page.locator('.ghost-key').count()) === 0);

  // Leftovers Task 3 (M2): a library with films and no first-open record; the base (Aariz) is not installed at launch,
  // so the step waits. Installing it mid-session (its progress ends 'ready') runs the step again at once: the upgrade
  // note shows in the same session, no relaunch. A later install that ends Ready shows no second note.
  const emitReady = (id) => page.evaluate((id) => { for (const h of (window.__listeners || {})['models://progress'] || [])
    window['_cb' + h]({ event: 'models://progress', id: 1, payload: { id, stage: 'ready' } }); }, id);
  const introNote = page.locator('.auto-best-intro');
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.introStep = 'waiting'; d.introCalls = 0; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await page.reload();
  await page.waitForSelector('.library');
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('fakeLib')).introCalls || 0) >= 1, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok('M2. at launch without the base: the first-open step runs once and shows no note',
    (await db()).introCalls === 1 && (await introNote.count()) === 0, `calls ${(await db()).introCalls}`);
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.introStep = 'base-ready'; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await emitReady('aariz-cepha29');                          // the base's install ends Ready
  await introNote.waitFor({ timeout: 5000 }).catch(() => {});
  const shownText = await introNote.innerText().catch(() => '');
  ok('M2. the base installed mid-session: the step runs again and its note shows in the same session',
    (await db()).introCalls === 2 && shownText.includes('Automatic best now starts your tracings.') && shownText.includes('Your Part F declines are kept.'),
    `calls ${(await db()).introCalls}; ${shownText}`);
  await page.screenshot({ path: `${__dirname}/out/auto-best-reintro.png` });
  await introNote.getByRole('button', { name: 'Dismiss' }).click();
  await emitReady('gu2net-isbi19');                          // another install later: the step has run, no second note
  await page.waitForFunction(() => (JSON.parse(localStorage.getItem('fakeLib')).introCalls || 0) >= 3, null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(300);
  ok('M2. a later install: the step is asked again but has already run, so no second note',
    (await db()).introCalls === 3 && (await introNote.count()) === 0, `calls ${(await db()).introCalls}`);

  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
