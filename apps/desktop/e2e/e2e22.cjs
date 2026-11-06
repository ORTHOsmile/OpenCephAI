// Automatic best's base model smoke (Task 11). Checks, in order: 1. the base shown
// in Models… and in Settings › Best model; 2. a change in either place shows in the other; 3. the base-change note and
// its way back; 4. a refused change leaves both on the old base, with the reason; 5. the base not installed: greyed out;
// 6. no model installed: greyed out; 7. the fold of "Best model per point" survives closing Settings and a reload;
// 8. the Settings tab text is --link with the selected tab underlined, the Inspector's tabs unchanged; 9. the left
// panel's Settings… is blue, alone on its row and centred; 10. the model line names the actual base, never a file id.
// A control (check 2) proves a wrong expectation is caught by the same comparison.
// Built UI in Chromium, stubbed Tauri runtime, fake library in localStorage. SYNTHETIC image, names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19';
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const ORIGINAL_19 = Object.keys(base);
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const counts = (ruler) => ({ ruler, machine: 0, fit: 0, assumed: 0 });
const best = { ruleVersion: 'best-point/4', choices: [], checks: [], points: ORIGINAL_19.map((id) => ({ landmarkId: id, current: AZ, offer: null,
  offerBasis: null, filmsByScale: counts(0), fineTunedRuler: 0, leftOutOtherPlacer: 0, pairs: [] })) };
const adopted = { id: 1, landmarkId: 'Go', kind: 'adopted', modelId: SR, fingerprint: 'fp-sr', uses: SR, lastImportedAt: '2026-01-01T00:59:00.000Z', lastCaseId: 'c059',
  basis: 'mm, 60 ruler films', reason: null, numbers: { base: AZ }, ruleVersion: 'best-point/4', operator: 'Dr A', at: '2026-10-29T01:00:00.000Z' };
const lm = (id) => ({ id, x: base[id][0] + 400, y: base[id][1] + 300, source: 'ai', verified: false, aiX: base[id][0] + 400, aiY: base[id][1] + 300,
  confidence: 0.9, placedBy: AZ, placedVia: 'auto-best' });
const kase = (id, tp, landmarks) => ({ id, path: `/Users/demo/${id}.png`, patientName: 'Demo Synthetic', patientKey: 'demo synthetic',
  dateOfBirth: '2010-01-02', scanId: null, timepoint: tp, takenOn: '2026-01-10', takenOnSource: 'label', facing: 'right', orientation: {}, display: {},   // SYNTHETIC
  spacingMm: 0.1, scaleSteps: 0, fit: null, machine: null, machineScale: null, title: null, ageOnFilm: null, ageOnFilmYears: null,
  verifiedAt: null, verifiedBy: null, createdAt: '2026-10-01T01:00:00Z', updatedAt: '2026-10-01T01:00:00Z', deletedAt: null,
  identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [], stage: null, inSeries: true, gender: null, referringPractitioner: null, population: null,
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [], landmarks });
const seed = { settings: {}, ops: ['Dr A'], runs: {}, best, autoOn: true, base: AZ, installed: [AZ, SR, GU], uses: { Go: SR }, events: [adopted],
  cases: { c1: kase('c1', 'T1', ORIGINAL_19.map(lm)) } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png, base, AZ, SR, GU, adopted }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const call = (cmd, a) => { const c = JSON.parse(localStorage.getItem('calls') || '[]'); c.push([cmd, a]); localStorage.setItem('calls', JSON.stringify(c)); };
    const ids = Object.keys(base);
    const titles = { [AZ]: 'Aariz', [SR]: 'SRPose', [GU]: 'GU2Net' };
    const row = (db, id) => ({ id, title: titles[id], tier: 'standard', recommended: id === AZ, status: db.installed.includes(id) ? 'ready' : 'not-installed',
      main: !db.autoOn && id === db.base, citation: 'SYNTHETIC', sizeMb: 1,
      licence: { version: '1', code: 'SYNTHETIC', weights: 'SYNTHETIC', summary: 'SYNTHETIC', url: '', nonCommercial: false }, licenceAccepted: true, stage: null, error: null, msPerFilm: 400, page: '', notice: null });
    const available = (db) => db.installed.includes(db.base);
    const mapOf = (db) => ({ available: available(db), on: db.autoOn && available(db), base: db.base, uses: available(db) ? db.uses : {},
      notes: {}, kept: {}, latest: available(db) && db.events.length ? [db.events[db.events.length - 1]] : [] });
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        switch (cmd) {
          case 'model_status': return db.installed.length ? { loaded: true, modelId: available(db) ? db.base : db.installed[0], searched: [], error: null }
            : { loaded: false, modelId: null, searched: [], error: null };
          case 'plugin:event|listen': return 1;
          case 'plugin:dialog|message': return 'Yes';
          case 'models_list': return [AZ, SR, GU].map((id) => row(db, id));
          case 'models_points': return db.installed.map((m) => ({ modelId: m, title: titles[m], main: m === db.base, points: ids.map((id) => ({ id, status: { kind: 'original' } })) }));
          case 'models_best_per_point': return db.best;
          case 'models_weights_check_run': return null;
          case 'models_set_main': call(cmd, a); return null;
          case 'models_auto_best': return mapOf(db);
          case 'models_auto_best_sync': return { on: mapOf(db).on, events: [] };
          case 'models_auto_best_intro': return null;
          case 'models_auto_best_set_base': {
            call(cmd, a);
            if (localStorage.getItem('lockedLib')) throw 'stub: the library is locked (read-only)';
            if (!db.installed.includes(a.id)) throw `${titles[a.id] ?? a.id} is not installed: install it in Models… first`;
            const from = db.base;
            if (from === a.id) return { from, to: a.id, events: [] };
            db.base = a.id;
            // Against GU2Net, SRPose's Gonion evidence (judged against Aariz) no longer counts: returned; back to Aariz, adopted again.
            const ev = a.id === AZ ? { ...adopted, id: db.events.length + 1, numbers: { base: AZ, cause: 'base-changed', baseFrom: from, baseTo: a.id } }
              : { ...adopted, id: db.events.length + 1, kind: 'returned', uses: null, basis: null, reason: 'evidence', numbers: { base: a.id, cause: 'base-changed', baseFrom: from, baseTo: a.id } };
            db.uses = a.id === AZ ? { Go: SR } : {};
            db.events.push(ev); store(db); return { from, to: a.id, events: [ev] };
          }
          case 'models_main_point_source': return { ruleVersion: 'main-point-source/1', confirmationPending: true, points: Object.fromEntries(ids.map((id) => [id, AZ])),
            ownerChoices: {}, ownerChoiceNotes: {}, autoBest: mapOf(db) };
          case 'library_list': return Object.values(db.cases).map((c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn,
            createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0,
            verifiedAt: c.verifiedAt, deletedAt: null, patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true }));
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks }); store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_ghosts': return [];
          case 'library_label_text': return { lines: [], suggestions: [] };
          case 'library_user_norms': return [];
          case 'operators_list': return { current: 'Dr A', names: db.ops };
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png, base, AZ, SR, GU, adopted });

  const calls = async (cmd) => (await page.evaluate(() => JSON.parse(localStorage.getItem('calls') || '[]'))).filter(([c]) => c === cmd);
  const mdlg = () => page.locator('[role="dialog"][aria-label="Models"]');
  const sdlg = () => page.locator('[role="dialog"][aria-label="Settings"]');
  const openModels = async () => { await page.getByRole('button', { name: 'Models…' }).first().click(); await mdlg().locator('section.auto-best-row').waitFor(); };
  const closeModels = async () => { await mdlg().getByRole('button', { name: 'Close' }).click(); await mdlg().waitFor({ state: 'detached' }); };
  const openBest = async () => {
    await page.getByRole('button', { name: 'Settings…' }).first().click();
    await sdlg().getByRole('tab', { name: 'Best model' }).click();
    await sdlg().locator('.settings-best-model').waitFor();
  };
  const closeBest = async () => { await sdlg().getByRole('button', { name: 'Close' }).click(); await sdlg().waitFor({ state: 'detached' }); };
  // The chosen option's value once the base has been read (the select shows "Reading…" with value '' until then).
  const shown = async (sel) => { await page.waitForFunction((s) => document.querySelector(s)?.value, sel, { timeout: 5000 }).catch(() => {}); return page.locator(sel).inputValue().catch(() => ''); };
  const setDb = (f) => page.evaluate((src) => { const db = JSON.parse(localStorage.getItem('fakeLib')); (0, eval)(src)(db); localStorage.setItem('fakeLib', JSON.stringify(db)); }, f.toString());
  const resolved = (name) => page.evaluate((n) => { const d = document.createElement('div'); d.style.color = `var(${n})`; document.body.appendChild(d);
    const c = getComputedStyle(d).color; d.remove(); return c; }, name);
  const resolvedBg = (name) => page.evaluate((n) => { const d = document.createElement('div'); d.style.backgroundColor = `var(${n})`; document.body.appendChild(d);
    const c = getComputedStyle(d).backgroundColor; d.remove(); return c; }, name);

  await page.goto(process.env.E2E_URL || 'http://localhost:4173/');
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');

  // 1. The base, shown in both places.
  await openModels();
  const m1 = await shown('#base-models');
  const m1Text = await mdlg().locator('#base-models option:checked').innerText().catch(() => '');
  ok('1. Models… shows "Base model" with Aariz (recommended) chosen', m1 === AZ && m1Text === 'Aariz (recommended)'
    && (await mdlg().locator('section.auto-best-row').innerText()).includes('Base model'), `${m1} / ${m1Text}`);
  await closeModels();
  await openBest();
  const s1 = await shown('#base-settings');
  ok('1. Settings › Best model shows the same base', s1 === AZ);
  await closeBest();

  // 2. In step: a change in Models… shows in Settings, and a change in Settings shows in Models….
  await openModels();
  await mdlg().locator('#base-models').selectOption(GU);
  await page.waitForFunction(() => document.querySelector('#base-models')?.value === 'gu2net-isbi19', null, { timeout: 5000 }).catch(() => {});
  ok('2. choosing GU2Net in Models… sends it once', (await calls('models_auto_best_set_base')).map(([, a]) => a.id).join() === GU);
  await closeModels();
  await openBest();
  const s2 = await shown('#base-settings');
  ok('2. Settings › Best model then shows GU2Net (in step)', s2 === GU, s2);
  // Control (final review M2): the reading must MOVE. Read through the same helper, the same window showed Aariz before
  // the change and GU2Net after; a stuck or cached reading (the same value twice) fails this, whatever the value is.
  ok('2. control: the same reading changed with the base (Aariz before, GU2Net after)', s1 === AZ && s2 === GU && s1 !== s2, `${s1} -> ${s2}`);
  await sdlg().locator('#base-settings').selectOption(AZ);
  await page.waitForFunction(() => document.querySelector('#base-settings')?.value === 'aariz-cepha29', null, { timeout: 5000 }).catch(() => {});
  await closeBest();
  await openModels();
  ok('2. choosing Aariz in Settings shows in Models… (in step, the other way)', (await shown('#base-models')) === AZ);
  await closeModels();

  // 3. The note after a change, with the way back.
  await openBest();
  await sdlg().locator('#base-settings').selectOption(GU);
  await closeBest();
  const note = page.locator('.auto-best-base-note');
  await note.waitFor({ timeout: 5000 }).catch(() => {});
  const n3 = await note.innerText().catch(() => '');
  ok('3. the note says the base is now GU2Net and which point it took from SRPose', n3.includes('Base model is now GU2Net: every point starts from GU2Net.')
    && n3.includes('Go no longer uses SRPose: it was judged against Aariz.'), n3);
  await note.getByRole('button', { name: 'Back to Aariz' }).click({ timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(400);
  ok('3. Back to Aariz sends the earlier base', (await calls('models_auto_best_set_base')).pop()?.[1].id === AZ);
  await openModels();
  ok('3. after the way back, Models… shows Aariz', (await shown('#base-models')) === AZ);
  await closeModels();

  // 4. A refused change (the library is locked): both stay on the old base, the reason beside the control used.
  await page.evaluate(() => localStorage.setItem('lockedLib', '1'));
  await openModels();
  await mdlg().locator('#base-models').selectOption(GU).catch(() => {});
  await mdlg().locator('.base-select .error').waitFor({ timeout: 5000 }).catch(() => {});
  const err4 = await mdlg().locator('.base-select .error').innerText().catch(() => '');
  ok('4. refused: Models… still shows Aariz and says why', (await shown('#base-models')) === AZ && err4.includes('The base was not changed') && err4.includes('locked'), err4);
  await closeModels();
  await openBest();
  ok('4. refused: Settings still shows Aariz', (await shown('#base-settings')) === AZ);
  ok('4. the refusal is shown only beside the drop-down used, not in Settings', (await sdlg().locator('.base-select .error').count()) === 0);
  await closeBest();
  await page.evaluate(() => localStorage.removeItem('lockedLib'));

  // 5. The base not installed: Automatic best greyed out, naming the base.
  await setDb('(db) => { db.base = "gu2net-isbi19"; db.installed = ["aariz-cepha29", "srpose-cldet23"]; }');
  await page.reload(); await page.waitForSelector('.library');
  await openModels();
  const r5 = await mdlg().locator('section.auto-best-row').innerText();
  ok('5. base not installed: the choice is greyed out with its reason', (await mdlg().locator('section.auto-best-row input[type=radio]').isDisabled())
    && r5.includes('Needs GU2Net, the base model: install it, or choose another base in Settings › Best model.'), r5);
  ok('5. the missing base stays shown in the drop-down', (await mdlg().locator('#base-models option:checked').innerText().catch(() => '')) === 'GU2Net (not installed)');
  await closeModels();

  // 6. No model installed: greyed out, "No model is installed yet".
  await setDb('(db) => { db.base = "aariz-cepha29"; db.installed = []; }');
  await page.reload(); await page.waitForSelector('.library');
  await openModels();
  const r6 = await mdlg().locator('section.auto-best-row').innerText();
  ok('6. no model installed: the choice and the drop-down are greyed out with the reason', (await mdlg().locator('section.auto-best-row input[type=radio]').isDisabled())
    && (await mdlg().locator('#base-models').isDisabled()) && r6.includes('No model is installed yet: install one below.'), r6);
  await closeModels();
  await setDb('(db) => { db.installed = ["aariz-cepha29", "srpose-cldet23", "gu2net-isbi19"]; }');
  await page.reload(); await page.waitForSelector('.library');

  // 7. The fold: closed, it stays closed after closing Settings and after a reload.
  const fold = () => sdlg().getByRole('button', { name: /Best model per point/ });
  await openBest();
  ok('7. the table starts open', (await fold().getAttribute('aria-expanded')) === 'true' && (await sdlg().locator('section.best-per-point').count()) === 1);
  await fold().click();
  ok('7. folded: the table is not drawn', (await fold().getAttribute('aria-expanded')) === 'false' && (await sdlg().locator('section.best-per-point').count()) === 0);
  await closeBest(); await openBest();
  ok('7. closed and reopened: still folded', (await fold().getAttribute('aria-expanded')) === 'false');
  await closeBest();
  await page.reload(); await page.waitForSelector('.library');
  await page.waitForTimeout(300);
  await openBest();
  ok('7. after a reload: still folded (setting best_table_open)', (await fold().getAttribute('aria-expanded')) === 'false'
    && (await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings.best_table_open)) === '0');
  await fold().click();

  // 8. Colours: Settings tabs --link, the selected one underlined; the Inspector's tabs unchanged (--text-2).
  const link = await resolved('--link');
  const tabStyle = (sel) => page.locator(sel).evaluate((b) => ({ color: getComputedStyle(b).color, shadow: getComputedStyle(b).boxShadow }));
  const unsel = await tabStyle('[role="dialog"][aria-label="Settings"] [role="tab"][aria-selected="false"] >> nth=0');
  const sel = await tabStyle('[role="dialog"][aria-label="Settings"] [role="tab"][aria-selected="true"]');
  ok('8. Settings tab text is --link', unsel.color === link && sel.color === link, `${unsel.color} / ${sel.color} / ${link}`);
  ok('8. the selected Settings tab is underlined', sel.shadow !== 'none' && unsel.shadow === 'none', `${sel.shadow} / ${unsel.shadow}`);
  await closeBest();
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await page.locator('.cards .card .open', { hasText: 'T1' }).first().click();
  await page.waitForSelector('g.landmark[data-id="S"]');
  const text2 = await resolved('--text-2');
  const insp = await tabStyle('.inspector [role="tab"][aria-selected="false"] >> nth=0');
  ok("8. the Inspector's tabs keep --text-2 (unchanged)", insp.color === text2 && insp.color !== link, `${insp.color} / ${text2}`);

  // 9. The left panel's Settings…: blue, alone on its row, centred in the panel.
  const btn = page.locator('.sidebar .settings-row button');
  const g = await btn.evaluate((b) => { const r = b.getBoundingClientRect(), row = b.parentElement, p = b.closest('.sidebar').getBoundingClientRect();
    const ps = getComputedStyle(b.closest('.sidebar')); const inner = p.left + parseFloat(ps.paddingLeft), innerR = p.right - parseFloat(ps.paddingRight);
    return { bg: getComputedStyle(b).backgroundColor, alone: row.children.length === 1, text: b.textContent, mid: r.left + r.width / 2, panelMid: (inner + innerR) / 2 }; });
  ok('9. Settings… is blue (--accent-fill)', g.bg === (await resolvedBg('--accent-fill')) && g.text === 'Settings…', g.bg);
  ok('9. alone on its row, centred in the panel (±2 px)', g.alone && Math.abs(g.mid - g.panelMid) <= 2, `${g.mid} vs ${g.panelMid}`);

  // 10. The model line names the actual base, never a file id.
  await page.getByRole('button', { name: 'Models…' }).first().click();
  await mdlg().locator('#base-models').selectOption(GU);
  await page.waitForFunction(() => document.querySelector('#base-models')?.value === 'gu2net-isbi19', null, { timeout: 5000 }).catch(() => {});
  await closeModels();
  await page.waitForFunction(() => (document.querySelector('.sidebar .hint b')?.textContent || '').includes('GU2Net'), null, { timeout: 5000 }).catch(() => {});
  const line = await page.locator('.sidebar .hint', { hasText: 'Model:' }).first().innerText().catch(() => '');
  ok('10. the model line reads "Model: Automatic best (starts from GU2Net)" and names no file id', line.includes('Model: Automatic best (starts from GU2Net)')
    && !line.includes('aariz-cepha29') && !line.includes('gu2net-isbi19'), line);

  // Owner, 5 Nov 2026: the "Made from your verified films" label was white on white. Its computed colour must differ
  // from its background and read at 4.5:1 or better, in light and in dark (positive control: a bare .chip, white on none).
  const lum = (c) => { const [r, g, b] = c.match(/[\d.]+/g).slice(0, 3).map(Number).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  await openModels();
  const label = mdlg().locator('section.auto-best-row .chip', { hasText: 'Made from your verified films' });
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.waitForTimeout(150);
    const lc = await label.evaluate((e) => { const s = getComputedStyle(e); return { color: s.color, bg: s.backgroundColor, border: s.borderTopColor, bw: s.borderTopWidth }; });
    const panelBg = await mdlg().evaluate((e) => getComputedStyle(e).backgroundColor);
    const bare = await page.evaluate(() => { const e = document.createElement('span'); e.className = 'chip'; document.body.appendChild(e); const s = getComputedStyle(e); const r = { color: s.color, bg: s.backgroundColor }; e.remove(); return r; });
    ok(`11. ${scheme}: the label is grey on --bg with an outline, not white text`, lc.bg === (await resolvedBg('--bg')) && lc.color === (await resolved('--text-2')) && lc.bw === '1px', JSON.stringify(lc));
    ok(`11. ${scheme}: label text against its own background reads at 4.5:1 or better (${ratio(lc.color, lc.bg).toFixed(2)})`, lc.bg !== 'rgba(0, 0, 0, 0)' && ratio(lc.color, lc.bg) >= 4.5);   // a transparent background would read as black here
    ok(`11. ${scheme}: positive control: a bare .chip has no background and white text (the old fault) `, bare.bg === 'rgba(0, 0, 0, 0)' && bare.color === (await resolved('--on-fill')), JSON.stringify(bare));
    void panelBg;
  }
  await page.emulateMedia({ colorScheme: null });
  await closeModels();

  ok('no page errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  console.log(results.join('\n'));
})().catch((e) => { console.log(results.join('\n')); console.log('FAIL  crashed: ' + e); process.exit(1); });
