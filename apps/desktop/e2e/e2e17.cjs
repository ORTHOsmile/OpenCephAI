// Verifying points, signing off a tracing, and the ruler marks that stay (spec 2026-10-19-verify-and-ruler-design.md).
// The built UI in Chromium, Tauri stubbed, a fake library in localStorage. SYNTHETIC films, names and points only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const landmarks = Object.entries(base).map(([id, [x, y]]) => ({ id, x: x + 350, y: y + 300, confidence: 0.8 }));
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, landmarks }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib') || '{"cases":{},"settings":{},"films":0}');
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const now = () => new Date().toISOString();
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        const summary = (c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: null, createdAt: c.createdAt, updatedAt: c.updatedAt,
          thumbPath: '/thumbs/x.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: c.landmarks.filter((l) => !l.verified).length,
          verifiedAt: c.verifiedAt, deletedAt: null, patientKey: c.patientKey, dateOfBirth: null, identityChecked: true,
          libraryId: null, formerLibraryIds: [], printedPatientId: null });
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'models_points': return db.statusTable ? [{ modelId: 'SYNTHETIC-stub', title: 'Main', main: true, points: landmarks.map((l) => ({ id: l.id, status: { kind: 'original' } })) }] : null;
          // Each Import… is a new synthetic film, so every block below starts on a fresh case (c1, c2, …).
          case 'plugin:dialog|open': { db.films += 1; store(db); const p = `/Users/demo/SYNTHETIC-film-${db.films}.png`; return a.options && a.options.multiple ? [p] : p; }
          case 'plugin:dialog|message': return 'Yes';
          case 'plugin:event|listen': return 1;
          case 'detect_landmarks': return { modelId: 'SYNTHETIC-stub', imageWidth: 1200, imageHeight: 1400, executionProvider: 'stub', timingsMs: { preprocess: 1, inference: 1, decode: 1, total: 3 },
            landmarks, facingLeft: true, meanPeakRight: 4.9, meanPeakLeft: 12.6, raw: landmarks.map((l, i) => ({ channel: i, landmarkId: l.id, x: l.x, y: l.y, peak: 0.8 })) };
          case 'library_ghosts': return [];
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map(summary);
          case 'library_import': {
            const id = 'c' + (Object.keys(db.cases).length + 1), n = id.slice(1);
            db.cases[id] = { id, path: a.path, patientName: `SYNTHETIC-film-${n}`, timepoint: 'T1', takenOn: null, facing: 'right', orientation: {}, display: {}, spacingMm: null,
              scaleSteps: 0,
              verifiedAt: null, verifiedBy: null, landmarks: [], calibrations: [], createdAt: now(), updatedAt: now(), deletedAt: null,
              patientKey: `synthetic film ${n}`, dateOfBirth: null, scanId: null, identitySource: 'manual', identityChecked: true, identityIssues: [],
              learnedFields: [], printedPatientId: null, xrayType: null, xraySize: null, radiographyPractice: null,
              libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [] };
            store(db); return { caseId: id, created: true };
          }
          // Fix round 1, M6: a one-shot failure so `library.open`'s re-read inside `afterMmChange` can be made to
          // throw AFTER `library_calibrate` already stored the new mm — the scenario the disk/screen mismatch needs.
          case 'library_open': { if (db.failOpenOnce) { delete db.failOpenOnce; store(db); throw 'SYNTHETIC: the film could not be re-read'; }
            const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC-film.png', path: c.path } }; }
          // As the store: any landmark change clears the sign-off.
          case 'library_save': { const c = db.cases[a.edit.id]; const moved = JSON.stringify(c.landmarks) !== JSON.stringify(a.edit.landmarks);
            Object.assign(c, { facing: a.edit.facing, orientation: a.edit.orientation, display: a.edit.display, landmarks: a.edit.landmarks, updatedAt: now() });
            if (moved) { c.verifiedAt = null; c.verifiedBy = null; }
            store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          // As the store: refused under 20 px; every calibration kept, with its presses; clears the sign-off.
          case 'library_calibrate': case 'library_recalibrate': { const c = db.cases[a.caseId], px = Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]), k = a.steps ?? 0;
            if (!(Math.abs(k) <= 10)) throw 'a calibration can be fine-tuned by at most 5 % either way';
            if (!(px >= 20)) throw `the marks are ${px.toFixed(1)} px apart; pick two ruler marks at least 20 px apart`;
            c.spacingMm = (a.mm / px) * ((200 + k) / 200); c.scaleSteps = k; c.verifiedAt = null; c.verifiedBy = null;
            c.calibrations.push({ p1: a.p1, p2: a.p2, mm: a.mm, spacingMm: c.spacingMm, steps: k });
            store(db); return c.spacingMm; }
          // As Library::ruler: the newest calibration, while its scale stands, with its presses.
          case 'library_ruler': { const c = db.cases[a.caseId], k = c.calibrations[c.calibrations.length - 1];
            return k && k.spacingMm === c.spacingMm ? { p1: k.p1, p2: k.p2, mm: k.mm, steps: k.steps ?? 0 } : null; }
          // As the store: refuses while any point is not accepted.
          case 'library_set_verified': { const c = db.cases[a.caseId], open = c.landmarks.filter((l) => !l.verified).length;
            if (a.verified && open) throw `${open} landmark(s) are still unverified`;
            Object.assign(c, a.verified ? { verifiedAt: now(), verifiedBy: 'SYNTHETIC-operator' } : { verifiedAt: null, verifiedBy: null }); store(db); return null; }
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png, landmarks });

  const db = () => page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')));
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true, () => false);
  const text = async (loc) => ((await loc.count()) ? loc.first().innerText() : '');
  const status = page.locator('.inspector .status-row');
  const btn = (name) => status.getByRole('button', { name, exact: true });
  const remainingBtn = () => status.getByRole('button', { name: /^Accept remaining \(\d+\)$/ });
  const remainingN = async () => Number(((await text(remainingBtn())).match(/\((\d+)\)/) ?? [0, 0])[1]);
  const row = (id) => page.locator('.lm-list li button').filter({ has: page.locator('b', { hasText: new RegExp(`^${id}$`) }) });
  const word = (id) => text(row(id).locator('.st'));
  const centre = async (id) => { const b = await page.locator(`g.landmark[data-id="${id}"] circle, g.landmark[data-id="${id}"] rect`).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  const dragBy = async (id, dx, dy) => { const c = await centre(id); await page.mouse.move(c.x, c.y); await page.mouse.down(); for (let i = 1; i <= 8; i++) await page.mouse.move(c.x + dx * i / 8, c.y + dy * i / 8); await page.mouse.up(); };
  const stored = async (c, id) => (await db()).cases[c].landmarks.find((l) => l.id === id);
  const toLibrary = async () => { await page.getByRole('button', { name: '‹ Library' }).click(); await page.waitForSelector('.library'); };
  const importNew = async () => { await page.getByRole('button', { name: 'Import…' }).click(); await page.waitForSelector('g.landmark[data-id="S"]'); await page.waitForTimeout(700); };
  const card = (name) => page.locator('.card').filter({ has: page.getByRole('button', { name: `Open ${name} T1` }) });
  const chip = (name) => text(card(name).locator('.lib-chip'));
  const openCard = async (name) => { await page.getByRole('button', { name: `Open ${name} T1` }).click(); await page.waitForSelector('g.landmark[data-id="S"]'); await page.waitForTimeout(500); };
  const calibrate = async (mm = '20') => {
    await page.keyboard.press('k'); const st = await page.locator('.stage').boundingBox();
    await page.mouse.click(st.x + st.width * 0.3, st.y + st.height * 0.7); await page.mouse.click(st.x + st.width * 0.6, st.y + st.height * 0.7);
    await page.waitForSelector('.calibrate-dialog'); await page.locator('.calibrate-dialog input').fill(mm);
    await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForSelector('.calibrate-dialog', { state: 'detached' });
  };

  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate(() => localStorage.clear()); await page.reload();
  await page.waitForSelector('.library');

  // Block A (Task 2): the status row — V1 (sign-off beside Accept), P1 ("Accepted"), V4 (Accept remaining, one ⌘Z step).
  await importNew();                                                                      // c1
  ok('A1. a new film: 19 AI points and "Accept remaining (19)"', (await page.locator('g.landmark').count()) === 19 && (await remainingN()) === 19);
  ok('A1. "Mark tracing verified" sits in the status row, disabled while points are left', (await btn('Mark tracing verified').count()) === 1 && await btn('Mark tracing verified').isDisabled());
  ok('A1. and is no longer in the Points section', (await page.locator('section[aria-label="Points"]').getByRole('button', { name: 'Mark tracing verified' }).count()) === 0);
  await row('S').click();
  ok('A2. the selected AI point reads "AI · unverified"', (await text(status.locator('.chip'))) === 'AI · unverified');
  await btn('Accept position').click(); await page.waitForTimeout(900);
  const sA = await stored('c1', 'S');
  ok('A2. Accept position: the pill reads "Accepted" (P1), one fewer left', (await text(status.locator('.chip'))) === 'Accepted' && (await remainingN()) === 18);
  ok('A2. accepting never moves the point', JSON.stringify([sA.x, sA.y, sA.source, sA.verified]) === JSON.stringify([350, 300, 'ai', true]), JSON.stringify(sA));
  await row('N').click();
  ok('A3. control: on the Tracing page Accept position is enabled for an AI point', !(await btn('Accept position').isDisabled()));
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  ok('A3. read-only page: Accept position, Accept remaining and Mark tracing verified are disabled',
    await btn('Accept position').isDisabled() && await remainingBtn().isDisabled() && await btn('Mark tracing verified').isDisabled());
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await remainingBtn().click();
  ok('A4. Accept remaining accepts every point and hides itself', (await remainingBtn().count()) === 0 && (await page.locator('g.landmark rect').count()) === 19);
  await page.keyboard.press('Meta+z');
  ok('A4. ⌘Z undoes it in one step', (await remainingN()) === 18);
  await page.keyboard.press('Meta+Shift+z');
  ok('A4. ⌘⇧Z redoes it', (await remainingBtn().count()) === 0);
  // A5: ⌘⇧Z redid the accept, and with it the automatic sign-off (V2); Reopen holds it until the button is pressed.
  await status.locator('.verified-note').waitFor({ timeout: 4000 }).catch(() => {});
  ok('A5. the redo signed the tracing off by itself (V2)', (await text(status.locator('.verified-note'))).includes('Tracing verified by SYNTHETIC-operator'));
  await status.getByRole('button', { name: 'Reopen' }).click();
  await btn('Mark tracing verified').waitFor({ timeout: 3000 }).catch(() => {});
  ok('A5. Reopen: the button is back and enabled', (await btn('Mark tracing verified').count()) === 1 && !(await btn('Mark tracing verified').isDisabled()));
  await btn('Mark tracing verified').click();
  await status.locator('.verified-note').waitFor({ timeout: 3000 }).catch(() => {});
  ok('A5. pressing it signs off, in the status row', (await text(status.locator('.verified-note'))).includes('Tracing verified by SYNTHETIC-operator'));
  await status.getByRole('button', { name: 'Reopen' }).click();
  await btn('Mark tracing verified').waitFor({ timeout: 3000 }).catch(() => {});
  // End of block A: c1 has every point accepted and is not signed off.

  // Block B (Task 3): a double-click accepts where it is (V5); ⌘-click picks (V6); every row says "Accepted" (P1).
  await toLibrary(); await importNew();                                                   // c2
  const n0 = await stored('c2', 'N'), cN = await centre('N');
  await page.mouse.dblclick(cN.x, cN.y); await page.waitForTimeout(900);
  const n1 = await stored('c2', 'N');
  ok('B1. a double-click on the film accepts N', (await word('N')) === 'Accepted' && n1.verified === true, JSON.stringify(n1));
  ok("B1. without moving it: the same x and y, still the AI's point", n1.x === n0.x && n1.y === n0.y && n1.source === 'ai', `${JSON.stringify(n0)} -> ${JSON.stringify(n1)}`);
  // preflight-rulings I4: a drag only begins once the pointer has moved past DOUBLE_PX, so a double-click (even with a
  // couple of px of real-mouse jitter between the two presses) never moves the point.
  const ar0b = await stored('c2', 'Ar'), cArb = await centre('Ar');
  await page.mouse.move(cArb.x, cArb.y); await page.mouse.down(); await page.mouse.move(cArb.x + 2, cArb.y + 1); await page.mouse.up();
  await page.mouse.down(); await page.mouse.up(); await page.waitForTimeout(900);
  const ar1b = await stored('c2', 'Ar');
  ok('B1b. a double-click with a 2 px jitter accepts Ar without moving it', ar1b.verified && ar1b.x === ar0b.x && ar1b.y === ar0b.y && ar1b.source === 'ai', `${JSON.stringify(ar0b)} -> ${JSON.stringify(ar1b)}`);
  await row('A').dblclick();
  ok('B2. a double-click on a Landmarks row accepts A', (await word('A')) === 'Accepted');
  // 3 accepted by now: N (B1), Ar (B1b) and A (this double-click).
  ok('B2. P1: rows say "Accepted", never "Verified"', (await page.locator('.lm-list .st', { hasText: 'Accepted' }).count()) === 3 && (await page.locator('.lm-list .st', { hasText: 'Verified' }).count()) === 0);
  await row('B').click({ modifiers: ['Meta'] }); await row('Pog').click({ modifiers: ['Meta'] });
  ok('B3. ⌘-click two rows: "Accept Positions (2)", both rows marked', (await btn('Accept Positions (2)').count()) === 1 && (await page.locator('.lm-list button[data-picked="true"]').count()) === 2);
  await btn('Accept Positions (2)').click();
  ok('B3. it accepts both, and the button reads "Accept position" again', (await word('B')) === 'Accepted' && (await word('Pog')) === 'Accepted' && (await btn('Accept position').count()) === 1);
  await page.waitForTimeout(2700);                                                         // let the Steps advance (2.5 s) run first
  const cGn = await centre('Gn'), cMe = await centre('Me'), cGo = await centre('Go');
  await page.keyboard.down('Meta'); await page.mouse.click(cGn.x, cGn.y); await page.mouse.click(cMe.x, cMe.y); await page.mouse.click(cGo.x, cGo.y); await page.keyboard.up('Meta');
  ok('B4. ⌘-click on the film picks points too, each ringed', (await btn('Accept Positions (3)').count()) === 1 && (await page.locator('g.landmark circle.picked').count()) === 3);
  await page.keyboard.down('Meta'); await page.mouse.click(cGn.x, cGn.y); await page.keyboard.up('Meta');
  ok('B5. a second ⌘-click takes a point out again', (await btn('Accept Positions (2)').count()) === 1 && (await page.locator('g.landmark[data-id="Gn"] circle.picked').count()) === 0);
  const me0 = await stored('c2', 'Me'), goN0 = await stored('c2', 'Go');
  await page.keyboard.press('ArrowRight'); await page.waitForTimeout(900);
  const me1 = await stored('c2', 'Me'), goN1 = await stored('c2', 'Go');
  ok('B6. the arrow keys still nudge only the active point (Go, the last one added)', goN1.x !== goN0.x && me1.x === me0.x, `Go ${goN0.x}->${goN1.x}, Me ${me0.x}->${me1.x}`);
  await page.waitForTimeout(2700);
  ok('B7. the Steps advance never clears the picks', (await btn('Accept Positions (2)').count()) === 1);
  await page.keyboard.press('Escape');
  ok('B8. Esc clears the picks', (await btn('Accept position').count()) === 1 && (await page.locator('g.landmark circle.picked').count()) === 0);
  await page.keyboard.down('Meta'); await page.mouse.click(cGn.x, cGn.y); await page.keyboard.up('Meta');
  await row('Ar').click();
  ok('B9. a plain click clears them too', (await page.locator('g.landmark circle.picked').count()) === 0);
  await page.keyboard.down('Meta'); await page.mouse.click(cGn.x, cGn.y); await page.keyboard.up('Meta');
  const go0 = await stored('c2', 'Go'), gnB = await stored('c2', 'Gn');
  await dragBy('Go', 25, 0); await page.waitForTimeout(900);
  const go1 = await stored('c2', 'Go'), gnA = await stored('c2', 'Gn');
  ok('B10. dragging moves only the point under the mouse, and clears the picks', go1.x !== go0.x && gnA.x === gnB.x && (await page.locator('g.landmark circle.picked').count()) === 0);
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  // preflight-rulings I4: Ar is accepted by B1b now, so B11's film double-click uses Sn instead (untouched in c2, still "AI").
  const sn0 = await stored('c2', 'Sn'), cSn = await centre('Sn');
  await page.mouse.dblclick(cSn.x, cSn.y); await page.waitForTimeout(900);
  ok('B11. read-only page: a double-click on the film accepts nothing', JSON.stringify(await stored('c2', 'Sn')) === JSON.stringify(sn0) && (await word('Sn')) === 'AI');
  await row('UL').click({ modifiers: ['Meta'] }); await row('LL').click({ modifiers: ['Meta'] });
  ok('B11. ⌘-click picks nothing there', (await page.locator('.lm-list button[data-picked="true"]').count()) === 0);
  await row('UL').dblclick(); await page.waitForTimeout(300);
  ok('B11. nor does a double-click on a row accept', (await word('UL')) === 'AI');
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  // End of block B: c2 has points still to check.

  // Block M (Task 12): the red AI bubble is on every row that uses an AI point not yet accepted (addendum 2, M).
  // The models table says every point is one of the main model's ORIGINAL points: under the 7 Oct rule, no row built
  // only from those showed the bubble, so M1 is red before Task 12. The models table is read once at start: reload.
  const setFlag = (on) => page.evaluate((v) => { const d = JSON.parse(localStorage.getItem('fakeLib')); if (v) d.statusTable = true; else delete d.statusTable; localStorage.setItem('fakeLib', JSON.stringify(d)); }, on);
  await page.waitForTimeout(900); await setFlag(true); await page.reload(); await page.waitForSelector('.library');
  await openCard('SYNTHETIC-film-2');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  const tag = (node) => page.locator(`tr.m-row[data-node="${node}"] .ai-tag`);
  const tip = async (node) => ((await tag(node).count()) ? await tag(node).first().getAttribute('title') : '') ?? '';
  ok('M1. SNA uses S, AI and not yet accepted (N and A were accepted in block B): the row carries the red AI bubble', (await tag('m01_SNA').count()) === 1);
  ok('M1. its hover names S in the new words', (await tip('m01_SNA')) === 'Uses AI points not yet accepted: S — click to check S', await tip('m01_SNA'));
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await row('S').dblclick();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('M2. accepting S (a row double-click: the bulk-accept path) clears that bubble', (await tag('m01_SNA').count()) === 0);
  ok('M2. control: a row that still uses an unaccepted AI point keeps its bubble', (await page.locator('tr.m-row .ai-tag').count()) > 0);
  await page.keyboard.press('Meta+z');
  ok('M3. ⌘Z brings it back', (await tag('m01_SNA').count()) === 1);
  await page.waitForTimeout(900); await setFlag(false); await page.reload(); await page.waitForSelector('.library');
  await openCard('SYNTHETIC-film-2');
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  // End of block M: on c2's tracing page (S is not accepted after the ⌘Z).

  // Block C (Task 4): the Library card's words (P2).
  await toLibrary();
  ok('C1. every point accepted, not signed off: the card reads "Ready to sign off"', (await chip('SYNTHETIC-film-1')) === 'Ready to sign off', await chip('SYNTHETIC-film-1'));
  ok('C2. points still left: "To review" (control)', (await chip('SYNTHETIC-film-2')) === 'To review', await chip('SYNTHETIC-film-2'));
  // End of block C: on the Library.

  // Block D (Task 5): the tracing signs itself off (V2); never by itself after the mm changed, a Reopen, or a reopen of the film (V3).
  await importNew();                                                                       // c3 (block C left us on the Library)
  const c3 = async () => (await db()).cases.c3;
  const signedNow = () => until(() => !!JSON.parse(localStorage.getItem('fakeLib')).cases.c3.verifiedAt);
  const unsignedNow = () => until(() => !JSON.parse(localStorage.getItem('fakeLib')).cases.c3.verifiedAt);
  await remainingBtn().click();
  ok('D1. accepting the last points signs the tracing off by itself, credited as the button would', (await signedNow()) && (await text(status.locator('.verified-note'))).includes('Tracing verified by SYNTHETIC-operator'));
  await page.keyboard.press('Meta+z');
  ok('D2. ⌘Z undoes the accept and the sign-off together', (await unsignedNow()) && (await remainingN()) === 19);
  await page.keyboard.press('Meta+Shift+z');
  ok('D3. ⌘⇧Z redoes both', (await signedNow()) && (await remainingN()) === 0);
  const at0 = (await c3()).verifiedAt; await page.waitForTimeout(1100);
  await dragBy('S', 20, 0);
  ok('D4. moving an accepted point clears the sign-off and, every point being accepted, signs again (control: S moved)',
    (await until((t) => { const c = JSON.parse(localStorage.getItem('fakeLib')).cases.c3; return !!c.verifiedAt && c.verifiedAt !== t; }, at0)) && (await stored('c3', 'S')).x !== 350);
  // preflight-rulings I3: Re-detect (nothing replaced, but `points` is a new object) then ⌘Z is a point action that
  // leaves every point accepted, but no landmark changed — the automatic path must not re-sign a signed-off tracing.
  const v0 = (await c3()).verifiedAt; await page.waitForTimeout(1100);
  await page.getByRole('button', { name: 'Re-detect', exact: true }).click(); await page.waitForTimeout(1500);
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(1500);
  ok('D4b. Re-detect then ⌘Z on a signed-off tracing (no landmark changed): the sign-off is untouched (control: v0 set)', !!v0 && (await c3()).verifiedAt === v0, `${v0} -> ${(await c3()).verifiedAt}`);
  await toLibrary();
  ok('D5. the card reads "Verified"', (await chip('SYNTHETIC-film-3')) === 'Verified');
  await openCard('SYNTHETIC-film-3');
  await calibrate();
  ok('D6. calibrating clears the sign-off and nothing signs it again (V3)', (await unsignedNow()) && (await btn('Mark tracing verified').count()) === 1 && !(await btn('Mark tracing verified').isDisabled()));
  ok('D6. the status row says why', (await text(status.locator('.hold-line'))) === 'The mm changed — check, then mark verified.');
  await row('N').click(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500);
  ok('D7. a later point action does not sign it either (control: N moved and was saved)', !(await c3()).verifiedAt && (await stored('c3', 'N')).x !== 1050);
  await btn('Mark tracing verified').click();
  ok('D8. pressing Mark tracing verified signs it and the line goes', (await signedNow()) && (await status.locator('.hold-line').count()) === 0);
  await status.getByRole('button', { name: 'Reopen' }).click(); await unsignedNow();
  await row('N').click(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(1500);
  ok('D9. after Reopen, a point action does not sign it (control: N moved down)', !(await c3()).verifiedAt && (await stored('c3', 'N')).y !== 200);
  await toLibrary();
  ok('D10. that card reads "Ready to sign off"', (await chip('SYNTHETIC-film-3')) === 'Ready to sign off');
  await openCard('SYNTHETIC-film-1');
  await row('N').click(); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500);
  ok('D11. closed and reopened with every point accepted but not signed off: a point action does not sign it (control: N moved)',
    !(await db()).cases.c1.verifiedAt && (await stored('c1', 'N')).x !== 1050);
  await toLibrary();
  // End of block D: on the Library.

  // Block E (Task 8): the ruler marks stay, red and draggable; a drop recalibrates at once and ⌘Z undoes it (F, R1).
  await importNew();                                                                       // c4 (block D left us on the Library)
  const c4 = async () => (await db()).cases.c4;
  const rmarks = page.locator('.overlay path.ruler-mark');
  const mark = async (i) => { const b = await page.locator(`.overlay path.ruler-mark[data-i="${i}"]`).boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  ok('E1. an uncalibrated film shows no ruler marks', (await rmarks.count()) === 0);
  await calibrate();
  ok('E2. after calibrating, both marks stay on the film', (await rmarks.count()) === 2);
  ok('E2. red, and drawn above the tracing', await page.evaluate(() => { const g = document.querySelector('.overlay g.ruler-marks'), last = [...document.querySelectorAll('.overlay g.landmark')].pop();
    return !!g && g.getAttribute('stroke') === 'var(--calibrate)' && !!(last.compareDocumentPosition(g) & Node.DOCUMENT_POSITION_FOLLOWING); }));
  const s0 = (await c4()).spacingMm;
  await remainingBtn().click(); await until(() => !!JSON.parse(localStorage.getItem('fakeLib')).cases.c4.verifiedAt);
  const m1 = await mark(1);
  await page.mouse.move(m1.x, m1.y); await page.mouse.down(); await page.mouse.move(m1.x + 30, m1.y, { steps: 3 });
  // M9: a timing-safe wait for the magnifier to switch mode, instead of reading it the instant after the move.
  ok('E3. while a mark is dragged, the magnifier shows the ruler', await until(() => document.querySelector('.loupe')?.getAttribute('data-mode') === 'ruler'));
  await page.mouse.move(m1.x + 60, m1.y, { steps: 3 }); await page.mouse.up();
  ok('E4. dropping it recalibrates at once, from the new marks and the same mm', (await until((s) => JSON.parse(localStorage.getItem('fakeLib')).cases.c4.spacingMm < s, s0))
    && (await c4()).calibrations.length === 2 && (await c4()).calibrations[1].mm === 20, `${s0} -> ${(await c4()).spacingMm}`);
  // M9: the hold-line read is also timing-safe — the row re-renders a tick after the drop lands.
  ok('E5. the sign-off is cleared and not re-signed, and the row says why (V3)', !(await c4()).verifiedAt
    && (await until(() => document.querySelector('.inspector .status-row .hold-line')?.textContent === 'The mm changed — check, then mark verified.')));
  ok('E5. the mark stays where it was dropped', Math.abs((await mark(1)).x - (m1.x + 60)) <= 2);
  await page.keyboard.press('Meta+z');
  ok('E6. ⌘Z puts the previous calibration back, mark and scale', (await until((s) => JSON.parse(localStorage.getItem('fakeLib')).cases.c4.spacingMm === s, s0)) && Math.abs((await mark(1)).x - m1.x) <= 2);
  await page.keyboard.press('Meta+Shift+z');
  ok('E7. ⌘⇧Z drops it again', await until((s) => JSON.parse(localStorage.getItem('fakeLib')).cases.c4.spacingMm < s, s0));
  // preflight-rulings I5 carried from Task 7, renamed per fix round 1 M4: this is a LIVENESS check only — it shows
  // the undo replay runs end to end for a ⌘Z/⌘⇧Z burst (two key presses with no await between them), and would catch
  // a thrown or deadlocked chain. It is NOT an ordering guard: the fake library is synchronous localStorage behind
  // `invoke`, so two concurrent calls resolve in call order whether or not anything serialises them (the
  // implementer's own control on the real chain proved this). The ordering itself is `serial.test.ts`, with
  // hand-resolved deferreds.
  const beforeBurst = await mark(1), mmBeforeBurst = (await c4()).spacingMm;
  page.keyboard.press('Meta+z'); page.keyboard.press('Meta+Shift+z');                    // the burst: NOT awaited between
  await page.waitForTimeout(1200);
  ok('I5 (liveness only, not ordering). the undo replay runs for a ⌘Z/⌘⇧Z burst and settles back to the same calibration',
    (await c4()).spacingMm === mmBeforeBurst && Math.abs((await mark(1)).x - beforeBurst.x) <= 2);
  const s1 = (await c4()).spacingMm, k1 = (await c4()).calibrations.length, m0 = await mark(0);
  await page.mouse.click(m0.x, m0.y); await page.waitForTimeout(600);
  ok('E8. a click on a mark that does not move it changes nothing', (await c4()).spacingMm === s1 && (await c4()).calibrations.length === k1);
  const m1c = await mark(1);
  await page.mouse.move(m1c.x, m1c.y); await page.mouse.down(); await page.mouse.move(m0.x + 3, m0.y, { steps: 4 }); await page.mouse.up(); await page.waitForTimeout(600);
  ok('E9. a drop a fresh calibration would refuse: the same message, the old calibration kept, the mark back',
    (await text(page.locator('.sidebar .error'))).includes('pick two ruler marks at least 20 px apart') && (await c4()).spacingMm === s1 && Math.abs((await mark(1)).x - m1c.x) <= 2);
  // Fix round 1, I1: a ruler mark drags like a point — anchored at the grab (never snapped to the cursor), with a
  // move threshold, and ⌥ precision. A tremor with less movement than DOUBLE_PX must do nothing to the ruler.
  // Mark 0 (p1) is used here: it has never been dragged (E8's click didn't move it), unlike mark 1, so there is no
  // risk of the press instead landing on a landmark that drifted nearby (the same risk the task brief named for
  // e2e3/e2e5/e2e10's own clicks at this film's stage fractions).
  // Esc first: by now the Steps advance (2.5 s, `advance.ts`) has had time to select the next catalogue point
  // waiting to be placed (M12 territory, not this fix) — left active-and-unplaced, it would otherwise win the very
  // first press below (PLACE-WINS) and silently plant that point on the mark, stealing every press after it.
  await page.keyboard.press('Escape');
  const i1a0 = await mark(0), i1aCalibLen = (await c4()).calibrations.length;
  await page.mouse.move(i1a0.x + 6, i1a0.y); await page.mouse.down();
  await page.mouse.move(i1a0.x + 7, i1a0.y, { steps: 2 });                               // 1 px of movement: well under DOUBLE_PX (4)
  await page.mouse.up(); await page.waitForTimeout(600);
  ok('I1a. a press 6 px off centre with only 1 px of movement changes nothing (no calibrate call, the mark unmoved)',
    (await c4()).calibrations.length === i1aCalibLen && Math.abs((await mark(0)).x - i1a0.x) <= 1 && Math.abs((await mark(0)).y - i1a0.y) <= 1);
  const i1b0 = await mark(0);
  await page.mouse.move(i1b0.x + 6, i1b0.y); await page.mouse.down();                    // the same 6 px off-centre grab…
  await page.mouse.move(i1b0.x + 6 + 40, i1b0.y, { steps: 6 }); await page.mouse.up();    // …then a real 40 px drag
  await page.waitForTimeout(900);
  const i1b1 = await mark(0);
  ok('I1b. a real drag moves the mark by the drag distance, anchored at the grab (not snapped 6 px further, to the cursor)',
    Math.abs(i1b1.x - (i1b0.x + 40)) <= 3 && Math.abs(i1b1.x - (i1b0.x + 46)) > 3, `${i1b0.x} -> ${i1b1.x}`);
  // Mark 0 has now moved +40 px; restore it to where the rest of block E expects it (its calibrate() position,
  // i.e. where mark 1's own history assumed it stayed) so E12/E13's "closed and reopened" check is unaffected.
  const i1b2 = await mark(0);
  await page.mouse.move(i1b2.x, i1b2.y); await page.mouse.down();
  await page.mouse.move(i1b2.x - 40, i1b2.y, { steps: 6 }); await page.mouse.up(); await page.waitForTimeout(900);
  ok('I1 cleanup: mark 0 is back where it was', Math.abs((await mark(0)).x - i1a0.x) <= 2);
  // Fix round 1, I2 (ruling): a landmark always wins over a ruler mark next to it. Put a landmark
  // exactly where a mark is, then show pressing it drags the LANDMARK, never the ruler. ANS, not Or/Po: moving
  // either of those re-levels the whole film to the Frankfurt Horizontal on release (`state.ts`'s `touchesFH`),
  // rotating the view out from under a screen-coordinate target — ANS touches nothing like that.
  const i2mark = await mark(1), ansBefore = await centre('ANS');
  await page.mouse.move(ansBefore.x, ansBefore.y); await page.mouse.down();
  await page.mouse.move(i2mark.x, i2mark.y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(900);   // ANS now sits on the mark
  const i2calibLen = (await c4()).calibrations.length, ansOnMark = await centre('ANS');
  ok('I2 setup: ANS now sits on the mark', Math.abs(ansOnMark.x - i2mark.x) <= 3 && Math.abs(ansOnMark.y - i2mark.y) <= 3,
    `ansBefore=${JSON.stringify(ansBefore)} i2mark=${JSON.stringify(i2mark)} ansOnMark=${JSON.stringify(ansOnMark)}`);
  await page.mouse.move(ansOnMark.x, ansOnMark.y); await page.mouse.down();
  await page.mouse.move(ansOnMark.x + 25, ansOnMark.y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(900);
  ok('I2. the press on the landmark drags IT, not the ruler mark underneath it: ANS moves, the mark does not, nothing recalibrates',
    (await centre('ANS')).x >= ansOnMark.x + 15 && (await c4()).calibrations.length === i2calibLen && Math.abs((await mark(1)).x - i2mark.x) <= 2);
  // Clear of the mark's area now, so M6's own drop below (which moves mark 1 again) has no chance of landing back
  // on ANS and stealing a later press meant for the ruler (M12-old, further down, presses mark 1 again).
  const ansFar = await centre('ANS');
  await page.mouse.move(ansFar.x, ansFar.y); await page.mouse.down();
  await page.mouse.move(ansFar.x, ansFar.y - 150, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(900);
  // Fix round 1, M1: hiding the marks mid-drag must cancel the drag — the release must not recalibrate. Mark 0
  // again, for the same reason as I1 (no risk of landing on a landmark instead). Esc first, for the same Steps
  // advance reason as above — I2's own point move just reset its 2.5 s timer.
  await page.keyboard.press('Escape');
  const m1hide0 = await mark(0), m1hideCalibLen = (await c4()).calibrations.length;
  await page.mouse.move(m1hide0.x, m1hide0.y); await page.mouse.down();
  await page.mouse.move(m1hide0.x + 30, m1hide0.y, { steps: 3 });                         // past the move threshold: a real drag in progress
  await page.keyboard.press('k');                                                         // k hides the marks mid-drag
  await page.mouse.up(); await page.waitForTimeout(900);
  ok('M1a. pressing k mid-drag hides the marks; the release does not recalibrate', (await c4()).calibrations.length === m1hideCalibLen);
  await page.keyboard.press('Escape');
  ok('M1a. Esc: the marks are back where they were (the cancelled drag never moved them)', (await rmarks.count()) === 2 && Math.abs((await mark(0)).x - m1hide0.x) <= 2,
    `count=${await rmarks.count()} m1hide0=${JSON.stringify(m1hide0)} now=${JSON.stringify(await mark(0))}`);
  await page.keyboard.press('Escape');
  // Points and the ruler share one undo history (`state.ts`): I2 just moved ANS, so the TOP of that history is
  // ANS's own move, not a ruler one. A tiny, completed ruler nudge first makes the ruler the thing ⌘Z below
  // actually targets — otherwise ⌘Z would move ANS back under us instead, not exercising M1 at all.
  const refresh0 = await mark(0);
  await page.mouse.move(refresh0.x, refresh0.y); await page.mouse.down();
  await page.mouse.move(refresh0.x + 10, refresh0.y, { steps: 3 }); await page.mouse.up(); await page.waitForTimeout(900);
  const m1b0 = await mark(0), m1bCalibLen = (await c4()).calibrations.length;
  await page.mouse.move(m1b0.x, m1b0.y); await page.mouse.down();
  await page.mouse.move(m1b0.x + 30, m1b0.y, { steps: 3 });                               // past the move threshold: a real drag in progress
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(900);                    // the ruler changes UNDER the grab
  await page.mouse.up(); await page.waitForTimeout(900);
  ok('M1b. ⌘Z mid-drag replaces the ruler under the grab; the release must not ALSO recalibrate on the now-stale drag (one new row, from the undo replay, not two)',
    (await c4()).calibrations.length === m1bCalibLen + 1);
  await page.keyboard.press('Meta+Shift+z'); await page.waitForTimeout(900);              // redo the ⌘Z above, back to the dropped state
  // Fix round 1, M6: `library.calibrate` can succeed while the re-read afterwards (`library.open`, only there to
  // refresh "use own") fails. The new mm is already taken on disk; the screen must match it, not fall back to the
  // old mm, and the error is shown rather than swallowed.
  await page.keyboard.press('Escape');
  const m6before = await mark(1), m6spacingBefore = (await c4()).spacingMm, m6calibLen = (await c4()).calibrations.length;
  await page.evaluate(() => { const d = JSON.parse(localStorage.getItem('fakeLib')); d.failOpenOnce = true; localStorage.setItem('fakeLib', JSON.stringify(d)); });
  await page.mouse.move(m6before.x, m6before.y); await page.mouse.down();
  await page.mouse.move(m6before.x + 25, m6before.y, { steps: 5 }); await page.mouse.up(); await page.waitForTimeout(900);
  ok('M6. the store took the drop (a new calibration row, a changed spacing) even though the re-read after it failed',
    (await c4()).calibrations.length === m6calibLen + 1 && (await c4()).spacingMm !== m6spacingBefore,
    `calibLen ${m6calibLen} -> ${(await c4()).calibrations.length}; spacing ${m6spacingBefore} -> ${(await c4()).spacingMm}`);
  ok('M6. the screen matches the disk: the mark stays at the dropped position, not snapped back to the old mm',
    Math.abs((await mark(1)).x - (m6before.x + 25)) <= 2, `m6before=${JSON.stringify(m6before)} now=${JSON.stringify(await mark(1))}`);
  ok('M6. the re-read failure is shown as an error, not swallowed', (await text(page.locator('.sidebar .error'))).includes('the film could not be re-read'),
    `error text="${await text(page.locator('.sidebar .error'))}"`);
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  ok('E10. hidden on the read-only Superimposition page', (await rmarks.count()) === 0);
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  ok('E10. back on Tracing they show again (control)', (await rmarks.count()) === 2);
  await page.keyboard.press('k');
  ok('E11. while calibrating again, the old marks are hidden', (await rmarks.count()) === 0);
  // M11: mid-calibration the Inspector takes the calibration branch (`ruler` non-null) and hides the status row,
  // showing "Ruler · Calibrating the scale" instead — intended, the same branch a ruler-mark drag also takes.
  ok('E11. the Inspector shows "Ruler · Calibrating the scale" and hides the status row',
    (await text(page.locator('.inspector .active-head b'))) === 'Ruler' && (await text(page.locator('.inspector .active-head span'))) === 'Calibrating the scale'
    && (await page.locator('.inspector .status-row').count()) === 0);
  await page.keyboard.press('Escape');
  ok('E11. Esc: they are back', (await rmarks.count()) === 2);
  // M12: a press within 10 px of a ruler mark while a point waits to be placed places the point, not the mark drag
  // (the ruling: placing wins, gated on `!placing` in the hit-test). Pick an unplaced landmark, press
  // exactly on a mark, and show the point lands there (not that the mark moved).
  const k1b = (await c4()).calibrations.length;
  await row('S').click(); await page.keyboard.press('Backspace'); await page.waitForTimeout(900);   // S now waits to be placed (autosave is debounced)
  const mPlace = await mark(1), sBefore = await stored('c4', 'S');
  ok('M12 setup: S has no stored point yet', !sBefore);
  await page.mouse.click(mPlace.x, mPlace.y); await page.waitForTimeout(900);
  const sPlaced = await stored('c4', 'S'), mAfter = await mark(1);
  ok('M12. the press placed S at the mark (not a mark drag): S now has a point there, the mark did not move, and no new calibration was taken',
    !!sPlaced && Math.abs(mAfter.x - mPlace.x) <= 2 && Math.abs(mAfter.y - mPlace.y) <= 2 && (await c4()).calibrations.length === k1b);
  // Two undo steps: 'place' and 'remove' are separate commits, so the first ⌘Z only undoes the placement (back to
  // S waiting) and the second restores S as it was before M12 touched it.
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(900);
  await page.keyboard.press('Meta+z'); await page.waitForTimeout(900);
  ok('M12 cleanup: S is back as it was (two undo steps: the placement, then the removal)', !!(await stored('c4', 'S')));
  const before = await mark(1);
  await toLibrary();
  ok('E12. the card reads "Ready to sign off"', (await chip('SYNTHETIC-film-4')) === 'Ready to sign off');
  await page.reload(); await page.waitForSelector('.library');
  await openCard('SYNTHETIC-film-4');
  ok('E13. closed and reopened: the marks are still there, in the same place', (await rmarks.count()) === 2
    && Math.abs((await mark(1)).x - before.x) <= 2 && Math.abs((await mark(1)).y - before.y) <= 2);
  // I8 (feat/report-exports merged in): the preview locks the Inspector and the ruler the same way `readOnly`
  // already locks everything else. Accept remaining needs points left, so this half reopens c2 (block B/M left
  // it with S still unaccepted); the drag half reuses c4, still open with its marks on screen.
  await page.getByRole('button', { name: 'Export ›' }).click();
  await page.waitForSelector('.report-preview');
  // M5 (fix round 1): this check passes through CephCanvas's `readOnly` gate alone (`readOnly={sup||reportOpen}`),
  // so on its own it cannot show the `!reportOpen` half of `useRulerMarks`'s `enabled` (App.tsx) doing the work —
  // acceptable as a product check (the marks ARE hidden, which is what the owner sees), said here plainly.
  ok('E14. the preview open: no ruler mark shows to drag (CephCanvas readOnly gate; does not isolate useRulerMarks\'s own enabled flag)', (await rmarks.count()) === 0);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForSelector('.report-preview', { state: 'detached' });
  await toLibrary();
  await openCard('SYNTHETIC-film-2');
  // M5: a control — the button must be ENABLED before the preview opens, else a button that was already disabled
  // (for some unrelated reason) would pass the check below for free.
  ok('E14 control: "Accept remaining" is enabled before the preview opens', !(await remainingBtn().isDisabled()));
  await page.getByRole('button', { name: 'Export ›' }).click();
  await page.waitForSelector('.report-preview');
  ok('E14. and "Accept remaining" is disabled once it is open', await remainingBtn().isDisabled());
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForSelector('.report-preview', { state: 'detached' });
  await toLibrary();

  // Block G (Task 10): the wheel zooms about the pointer (the view centre off the image); pinch too; Space-drag pans.
  await importNew();                                                                      // c5 (block E's last check left us on the Library)
  const gap = async (a, b) => { const p = await centre(a), q = await centre(b); return Math.hypot(p.x - q.x, p.y - q.y); };
  const st = await page.locator('.stage').boundingBox(), mid = { x: st.x + st.width / 2, y: st.y + st.height / 2 };
  let pS = await centre('S'); const g0 = await gap('S', 'N');
  await page.mouse.move(pS.x, pS.y); await page.mouse.wheel(0, -200); await page.waitForTimeout(300);
  const g1 = await gap('S', 'N'), pS1 = await centre('S');
  ok('G1. the wheel zooms in (control: S–N grew on screen)', g1 > g0 * 1.2, `${g0} -> ${g1}`);
  ok('G1. about the pointer: S stays under it', Math.hypot(pS1.x - pS.x, pS1.y - pS.y) <= 2, JSON.stringify([pS, pS1]));
  await page.mouse.wheel(0, 200); await page.waitForTimeout(300);
  ok('G2. the other way zooms back out', Math.abs((await gap('S', 'N')) - g0) < 2);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -200); await page.keyboard.up('Control'); await page.waitForTimeout(300);
  // M7: this check cannot fail apart from G1 (every wheel now zooms); renamed per the ruling, with the page-zoom control.
  ok('G3. a ctrl+wheel (Chromium/WebView2 pinch) zooms too and the page itself does not zoom', (await gap('S', 'N')) > g0 * 1.2
    && (await page.evaluate(() => (window.visualViewport ? window.visualViewport.scale : 1))) === 1);
  await page.keyboard.press('Meta+0'); await page.waitForTimeout(300);
  await page.mouse.move(st.x + 3, st.y + 3);                                              // off the image (the fit leaves a margin)
  const b0 = await centre('S'), h0 = await gap('S', 'N');
  await page.mouse.wheel(0, -200); await page.waitForTimeout(300);
  const b1 = await centre('S'), f = (await gap('S', 'N')) / h0;
  ok('G4. with the pointer off the image it zooms about the view centre', f > 1.2 && Math.hypot(b1.x - (mid.x + f * (b0.x - mid.x)), b1.y - (mid.y + f * (b0.y - mid.y))) <= 3,
    `f=${f.toFixed(3)} ${JSON.stringify([b0, b1])}`);
  for (let i = 0; i < 6; i++) await page.mouse.wheel(0, 3000);
  await page.waitForTimeout(300); const atMin = await gap('S', 'N');
  await page.mouse.wheel(0, 3000); await page.waitForTimeout(300);
  ok('G5. at the zoom limit it stays put (control: S–N is the K_MIN size)', Math.abs((await gap('S', 'N')) - atMin) < 0.05 && Math.abs(atMin - Math.hypot(700, 100) * 0.02) < 0.5, `${atMin}`);
  await page.keyboard.press('Meta+0'); await page.waitForTimeout(300);
  await row('Co').click(); pS = await centre('S');
  await page.mouse.move(st.x + st.width * 0.4, st.y + st.height * 0.55); await page.mouse.wheel(0, -200); await page.waitForTimeout(300);
  ok('G6. while placing a point the wheel zooms and places nothing', (await page.locator('g.landmark[data-id="Co"]').count()) === 0
    && (await text(page.locator('.stage .place-hint'))).includes('place Co') && (await gap('S', 'N')) > g0 * 1.2);
  await page.keyboard.press('Escape'); await page.keyboard.press('Meta+0'); await page.waitForTimeout(300);
  // Edge case (Step 6): while calibrating, the wheel zooms and never marks (the wheel never reaches onPointerDown),
  // and Space-drag pans instead of marking.
  await page.keyboard.press('k');
  const gK0 = await gap('S', 'N');
  await page.mouse.move(st.x + st.width * 0.5, st.y + st.height * 0.5); await page.mouse.wheel(0, -200); await page.waitForTimeout(300);
  ok('G6b. while calibrating the wheel zooms (control: S–N grew) and marks nothing',
    (await gap('S', 'N')) > gK0 * 1.2 && (await text(page.locator('.stage .place-hint'))).includes('first ruler mark'));
  const kPt = { x: st.x + st.width * 0.3, y: st.y + st.height * 0.6 };
  await page.mouse.move(kPt.x, kPt.y); await page.keyboard.down('Space'); await page.mouse.down();
  await page.mouse.move(kPt.x + 20, kPt.y + 10, { steps: 4 }); await page.mouse.up(); await page.keyboard.up('Space'); await page.waitForTimeout(300);
  ok('G6c. Space-drag pans the film while calibrating instead of marking it', (await text(page.locator('.stage .place-hint'))).includes('first ruler mark'));
  await page.keyboard.press('Escape'); await page.keyboard.press('Meta+0'); await page.waitForTimeout(300);
  const gS0 = await stored('c5', 'S'); pS = await centre('S');
  await page.mouse.move(pS.x, pS.y); await page.keyboard.down('Space'); await page.mouse.down();
  await page.mouse.move(pS.x + 40, pS.y + 30, { steps: 5 }); await page.mouse.up(); await page.keyboard.up('Space'); await page.waitForTimeout(900);
  const pS2 = await centre('S');
  ok('G7. Space-drag pans the film, even from on a point', Math.abs(pS2.x - pS.x - 40) <= 2 && Math.abs(pS2.y - pS.y - 30) <= 2, JSON.stringify([pS, pS2]));
  ok('G7. and never moves the point', JSON.stringify(await stored('c5', 'S')) === JSON.stringify(gS0));
  await page.mouse.move(st.x + 3, st.y + st.height / 2); await page.mouse.down(); await page.mouse.move(st.x + 33, st.y + st.height / 2, { steps: 4 }); await page.mouse.up();
  ok('G8. dragging an empty spot still pans (as before)', Math.abs((await centre('S')).x - pS2.x - 30) <= 2);
  const refBox = page.getByLabel('Referring practitioner');
  await refBox.click(); await refBox.fill('SYNTHETIC'); await page.mouse.move(mid.x, mid.y); await page.keyboard.press('Space');
  ok('G9. Space still types a space in a field', (await refBox.inputValue()) === 'SYNTHETIC ');
  await refBox.fill(''); await page.keyboard.press('Enter');
  await page.keyboard.press('Meta+0'); await page.waitForTimeout(300);
  // Edge case (Step 6): the read-only Superimposition page also zooms on the wheel (view only).
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  const gSup0 = await gap('S', 'N');
  await page.mouse.move(pS2.x, pS2.y); await page.mouse.wheel(0, -200); await page.waitForTimeout(300);
  ok('G10. the read-only Superimposition page zooms on the wheel too', (await gap('S', 'N')) > gSup0 * 1.2);
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await page.keyboard.press('Meta+0'); await page.waitForTimeout(300);
  await toLibrary();
  // End of block G: on the Library (c5's tracing page, fitted, uncalibrated).

  // Block N (Task 13): fine-tune a calibration (spec addendum 3): each press 0.5 % of the ruler's own value, ±5 % at
  // most, one ⌘Z step a press; it clears the sign-off (V3); a ruler drag or a fresh calibration starts again from 0.
  // (Already on the Library at the end of block G here; the brief's leading toLibrary() is redundant on this branch.)
  await importNew();
  const nId = 'c' + Object.keys((await db()).cases).length, nCase = async () => (await db()).cases[nId];
  const nTune = page.locator('.inspector .fine-tune');
  const nUp = nTune.getByRole('button', { name: 'Scale up 0.5 %' }), nDown = nTune.getByRole('button', { name: 'Scale down 0.5 %' });
  const nLine = () => text(page.locator('.inspector .scale-line'));
  const nSays = (t) => until((t) => (document.querySelector('.inspector .scale-line')?.textContent ?? '').includes(t), t);
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('N1. a film with no calibration shows no fine-tune', (await nTune.count()) === 0);
  await calibrate();
  const ns0 = (await nCase()).spacingMm;
  const nAt = (k) => until(({ id, s, k }) => JSON.parse(localStorage.getItem('fakeLib')).cases[id].spacingMm === s * ((200 + k) / 200), { id: nId, s: ns0, k });
  ok('N2. after calibrating: − and + beside the scale line, not adjusted', (await nTune.count()) === 1 && !(await nUp.isDisabled()) && !(await nDown.isDisabled())
    && (await nLine()).includes('(calibrated scale)'), await nLine());
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  await remainingBtn().click(); await until((id) => !!JSON.parse(localStorage.getItem('fakeLib')).cases[id].verifiedAt, nId);
  await page.getByRole('tab', { name: 'Measurements' }).click();
  await nUp.click();
  const kN = (await nCase()).calibrations;
  ok('N3. + is exactly 0.5 % of the ruler\'s value; the marks and the mm are the ruler\'s', await nAt(1)
    && kN.at(-1).mm === 20 && JSON.stringify([kN.at(-1).p1, kN.at(-1).p2]) === JSON.stringify([kN[0].p1, kN[0].p2]) && kN.at(-1).steps === 1);
  ok('N3. the line reads "calibrated scale, adjusted +0.5 %"', await nSays('(calibrated scale, adjusted +0.5 %)'), await nLine());
  await page.getByRole('tab', { name: 'Landmarks' }).click();
  ok('N4. it clears Tracing verified and nothing re-signs it (V3)', !(await nCase()).verifiedAt && (await text(status.locator('.hold-line'))) === 'The mm changed — check, then mark verified.');
  await page.getByRole('tab', { name: 'Measurements' }).click();
  await nUp.click();
  ok('N5. a second press: +1.0 %, from the ruler\'s value (not compounded)', await nAt(2) && await nSays('adjusted +1.0 %'), await nLine());
  await page.keyboard.press('Meta+z');
  ok('N6. ⌘Z undoes one press', await nAt(1) && await nSays('adjusted +0.5 %'), await nLine());
  await page.keyboard.press('Meta+z');
  ok('N6. ⌘Z again: the ruler\'s own value exactly, and no "adjusted"', await nAt(0) && await until(() => !(document.querySelector('.inspector .scale-line')?.textContent ?? '').includes('adjusted')));
  await page.keyboard.press('Meta+Shift+z');
  ok('N6. ⌘⇧Z redoes it', await nAt(1));
  for (let i = 0; i < 9; i++) await nUp.click();                        // each click waits for the last press to land
  ok('N7. at +5 % the + is disabled, the − is not', await nAt(10) && await nSays('adjusted +5.0 %') && await nUp.isDisabled() && !(await nDown.isDisabled()), await nLine());
  await nDown.click();
  ok('N8. − steps back: +4.5 %', await nAt(9) && await nSays('adjusted +4.5 %'));
  const nm = await mark(1);
  await page.mouse.move(nm.x, nm.y); await page.mouse.down(); await page.mouse.move(nm.x + 40, nm.y, { steps: 4 }); await page.mouse.up();
  ok('N9. dragging a ruler mark starts the fine-tune again from 0', await until((id) => { const c = JSON.parse(localStorage.getItem('fakeLib')).cases[id]; return c.calibrations.at(-1).steps === 0 && c.scaleSteps === 0; }, nId)
    && await until(() => !(document.querySelector('.inspector .scale-line')?.textContent ?? '').includes('adjusted')), await nLine());
  await page.keyboard.press('Meta+z');
  ok('N9. ⌘Z after the drag: the old mark and +4.5 % come back', await nAt(9) && await nSays('adjusted +4.5 %'));
  await calibrate();
  ok('N10. a fresh calibration starts again from 0', (await nCase()).calibrations.at(-1).steps === 0 && !(await nLine()).includes('adjusted'), await nLine());
  await nUp.click(); await nSays('adjusted +0.5 %');
  await page.getByRole('button', { name: 'Superimposition ›' }).click();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('N11. read-only Superimposition page: shown, both disabled', (await nTune.count()) === 1 && await nUp.isDisabled() && await nDown.isDisabled());
  await page.getByRole('button', { name: '‹ Tracing' }).click();
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('N11. back on Tracing: enabled again (control)', !(await nUp.isDisabled()) && !(await nDown.isDisabled()));
  await toLibrary(); await page.reload(); await page.waitForSelector('.library');
  await openCard(`SYNTHETIC-film-${nId.slice(1)}`);
  await page.getByRole('tab', { name: 'Measurements' }).click();
  ok('N12. closed and reopened: still "+0.5 %", and the control works', await nSays('(calibrated scale, adjusted +0.5 %)') && !(await nUp.isDisabled()), await nLine());
  await page.getByRole('tab', { name: 'Landmarks' }).click();

  // ---- next block goes here ----
  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(2); });
