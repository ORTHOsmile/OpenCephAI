// "Who is tracing" smoke (spec 2026-10-01 Part 3): the toolbar picker, adding a name, and sign-off credited to the
// chosen orthodontist. Built UI in Chromium, stubbed Tauri runtime. SYNTHETIC image, names and dates only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const seed = { settings: {}, ops: ['Dr A'], cases: { c1: { id: 'c1', path: '/Users/demo/c1.png', patientName: 'Demo Synthetic', patientKey: 'demo synthetic',
  dateOfBirth: '2010-01-02', scanId: null, timepoint: 'T1', takenOn: '2026-01-10', takenOnSource: 'label', facing: 'right', orientation: {}, display: {},   // SYNTHETIC
  spacingMm: null, verifiedAt: null, verifiedBy: null, createdAt: '2026-09-30T01:00:00Z', updatedAt: '2026-09-30T01:00:00Z', deletedAt: null,
  identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [], stage: null, inSeries: true,
  // Task 5 (D2): the real CaseDoc always carries these; a stub without them has the panel read undefined.
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [],
  landmarks: Object.entries(base).map(([id, [x, y]]) => ({ id, x: x + 350, y: y + 300, source: 'manual', verified: true, aiX: null, aiY: null, confidence: null })) } } };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'cwlachap-hrnet-w32', searched: [], error: null };
          case 'plugin:event|listen': return 1;
          case 'library_list': return Object.values(db.cases).map((c) => ({ id: c.id, patientName: c.patientName, timepoint: c.timepoint, takenOn: c.takenOn,
            createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation, landmarks: c.landmarks.length, unverified: 0,
            verifiedAt: c.verifiedAt, deletedAt: null, patientKey: c.patientKey, dateOfBirth: c.dateOfBirth, identityChecked: true }));
          case 'library_open': { const c = db.cases[a.caseId]; return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path } }; }
          case 'library_save': { const c = db.cases[a.edit.id]; return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_set_verified': { const c = db.cases[a.caseId];
            Object.assign(c, a.verified ? { verifiedAt: '2026-10-02T09:00:00Z', verifiedBy: db.settings.operator ?? 'Dr A' } : { verifiedAt: null, verifiedBy: null }); store(db); return null; }
          case 'library_ghosts': return [];
          case 'models_list': return [];
          case 'library_label_text': return { lines: [], suggestions: [] };
          case 'operators_list': return { current: db.settings.operator ?? 'Dr A', names: db.ops };
          case 'operators_add': { const n = a.name.trim(); if (!n) throw 'type a name';
            if (!db.ops.includes(n)) db.ops.push(n); db.settings.operator = n; store(db); return { current: n, names: db.ops }; }
          case 'operators_set_current': db.settings.operator = a.name; store(db); return null;
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png });

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  await page.locator('.cards .card .open', { hasText: 'T1' }).first().click();
  await page.waitForSelector('g.landmark[data-id="S"]');

  const picker = page.getByLabel('Who is tracing');
  await picker.waitFor();
  ok('1. the toolbar shows "Tracing: Dr A"', (await page.locator('.toolbar .operator').innerText()).includes('Tracing:') && (await picker.inputValue()) === 'Dr A');
  await page.screenshot({ path: `${__dirname}/out/operator-1.png` });
  await picker.selectOption('__add');
  await page.getByLabel('New name').fill('Dr B');
  await page.getByLabel('New name').press('Enter');
  await page.waitForFunction(() => document.querySelector('select[aria-label="Who is tracing"]')?.value === 'Dr B');
  ok('2. Add… → "Dr B" → Enter makes Dr B the one tracing', (await page.getByLabel('Who is tracing').inputValue()) === 'Dr B');

  await page.getByRole('button', { name: 'Mark tracing verified' }).click();
  await page.locator('.verified-note').waitFor();
  ok('3. the sign-off is credited to Dr B', (await page.locator('.verified-note').innerText()).includes('Tracing verified by Dr B'));
  await page.getByLabel('Who is tracing').selectOption('Dr A');
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).settings.operator === 'Dr A');
  ok('4. switching back to Dr A leaves the note unchanged', (await page.locator('.verified-note').innerText()).includes('Tracing verified by Dr B'));

  await page.getByLabel('Who is tracing').selectOption('__add');
  await page.getByLabel('New name').fill('   ');
  await page.getByLabel('New name').press('Enter');
  await page.locator('.operator [role="alert"]').waitFor();
  ok('5. a blank name says "type a name"', (await page.locator('.operator [role="alert"]').innerText()).includes('type a name'));
  await page.screenshot({ path: `${__dirname}/out/operator-5.png` });

  ok('no page errors', errors.length === 0, errors.join(' | '));
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
