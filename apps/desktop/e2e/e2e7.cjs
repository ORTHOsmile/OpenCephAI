// Model Manager smoke (spec 2026-10-01 Part 1): the built UI in Chromium with a stubbed Tauri runtime and a fake
// catalogue in localStorage. SYNTHETIC data only: no model is downloaded and no film is read.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const licence = (nc) => ({ version: '1', code: 'MIT', weights: 'CC BY-NC 4.0', summary: 'SYNTHETIC licence summary.', url: 'https://example.org/licence', nonCommercial: nc });
const row = (id, title, tier, status, main, nc) => ({ id, title, tier, citation: 'SYNTHETIC et al.', sizeMb: 60, licence: licence(nc), licenceAccepted: false,
  status, stage: null, error: null, main, msPerFilm: status === 'ready' ? 412 : null, page: `https://drive.google.com/file/d/SYNTHETIC-${id}/view` });
const seed = { settings: {}, cases: {}, installs: {}, models: [
  row('cwlachap-hrnet-w32', 'cwlachap HRNet-W32', 'standard', 'ready', true, false),
  row('gu2net-isbi19', 'GU2Net', 'standard', 'not-installed', false, false),
  row('srpose-cldet23', 'SRPose (CL-Detection 2023)', 'optional', 'not-installed', false, true),
] };

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(() => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    const call = (cmd, a) => { const c = JSON.parse(localStorage.getItem('calls') || '[]'); c.push([cmd, a]); localStorage.setItem('calls', JSON.stringify(c)); };
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: (p) => p,
      invoke: async (cmd, a = {}) => {
        const db = load();
        const m = (id) => db.models.find((r) => r.id === id);
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'cwlachap-hrnet-w32', searched: [], error: null };
          case 'plugin:event|listen': return 1;
          case 'library_list': if (localStorage.getItem('failOpen')) throw "Couldn't make a safety copy before upgrading. Your library hasn't been changed."; return [];
          case 'library_upgrade_copy': if (db.upgradeShown || localStorage.getItem('failOpen')) return null; db.upgradeShown = true; store(db);
            return '/Users/demo/Library/OpenCephAI/upgrade-backups/OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00';
          case 'settings_get': return db.settings[a.key] ?? null;
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          case 'models_list': return db.models;
          case 'models_accept_licence': call(cmd, a); m(a.id).licenceAccepted = true; store(db); return null;
          case 'models_install': {
            call(cmd, a);
            if (a.id === 'gu2net-isbi19' && !db.installs[a.id]) {
              db.installs[a.id] = 1; Object.assign(m(a.id), { status: 'failed', error: 'DOWNLOAD_BLOCKED' }); store(db); throw 'DOWNLOAD_BLOCKED';
            }
            Object.assign(m(a.id), { status: 'ready', error: null, msPerFilm: 412 }); store(db); return null;
          }
          case 'models_add_file': call(cmd, a); Object.assign(m(a.id), { status: 'ready', error: null, msPerFilm: 300 }); store(db); return null;
          case 'models_set_main': call(cmd, a); db.models.forEach((r) => { r.main = r.id === a.id; }); store(db); return null;
          case 'models_remove': call(cmd, a); Object.assign(m(a.id), { status: 'not-installed', main: false, msPerFilm: null }); store(db); return null;
          case 'plugin:dialog|open': return '/Users/demo/SYNTHETIC-best.zip';
          case 'plugin:dialog|message': call(cmd, a); return 'Yes';      // ask() is a Yes/No message in plugin-dialog 2
          default: return null;
        }
      },
    };
  });
  const calls = async (cmd) => (await page.evaluate(() => JSON.parse(localStorage.getItem('calls') || '[]'))).filter(([c]) => c === cmd);
  const modelRow = (id) => page.locator(`section.model-row[data-id="${id}"]`);

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await page.evaluate((s) => { localStorage.clear(); localStorage.setItem('fakeLib', JSON.stringify(s)); }, seed); await page.reload();
  await page.waitForSelector('.library');

  // AUTOBACKUP-1: after the library's format was upgraded, the notice says where the safety copy is (once).
  await page.waitForFunction(() => document.querySelector('.library [role="status"]')?.textContent.includes('safety copy'), null, { timeout: 5000 }).catch(() => {});
  ok('0. an upgraded library shows where its safety copy is', ((await page.locator('.library [role="status"]').allInnerTexts()).join(' ')) ===
    'Your library was upgraded to a new format. A safety copy from before the upgrade is in /Users/demo/Library/OpenCephAI/upgrade-backups/OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00. It holds patient data, like the library itself.');

  await page.getByRole('button', { name: 'Models…' }).first().click();
  await page.waitForSelector('[role="dialog"][aria-label="Models"] section.model-row');
  const srp = modelRow('srpose-cldet23');
  ok('1. Models… opens the dialog with three rows', (await page.locator('section.model-row').count()) === 3);
  ok('1. the SRPose row shows Optional and Non-commercial', (await srp.getByText('Optional', { exact: true }).count()) === 1 && (await srp.getByText('Non-commercial').count()) === 1);
  ok('1. a Ready row shows its time per film', (await modelRow('cwlachap-hrnet-w32').innerText()).includes('Ready · 0.4 s per film'));

  await page.screenshot({ path: `${__dirname}/out/models-1.png` });
  await srp.getByRole('button', { name: 'Install' }).click();
  ok('2. SRPose Install shows the licence first', (await srp.getByText('SYNTHETIC licence summary.').count()) === 1);
  const go = srp.locator('.model-licence').getByRole('button', { name: 'Install' });
  await page.screenshot({ path: `${__dirname}/out/models-2.png` });
  ok('2. Install is disabled until "I accept" is ticked', await go.isDisabled());
  await srp.getByLabel('I accept').check();
  await go.click();
  await page.waitForFunction(() => document.querySelector('section.model-row[data-id="srpose-cldet23"]')?.textContent.includes('Ready'));
  ok('2. after accepting, the row reads Ready', (await srp.innerText()).includes('Ready'));
  ok('2. the licence was accepted before installing', (await calls('models_accept_licence')).length === 1 && (await calls('models_install')).some(([, a]) => a.id === 'srpose-cldet23'));

  const gu = modelRow('gu2net-isbi19');
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.models.find((r) => r.id === 'gu2net-isbi19').licenceAccepted = true; localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.getByRole('button', { name: 'Close' }).click();
  await page.getByRole('button', { name: 'Models…' }).first().click();
  await gu.getByRole('button', { name: 'Install' }).click();
  await gu.getByText('Download it yourself', { exact: false }).waitFor();
  await page.screenshot({ path: `${__dirname}/out/models-3.png` });
  ok('3. a blocked GU2Net download offers "Download it yourself" with the Drive link',
    (await gu.locator('.model-link input').inputValue()).includes('drive.google.com') && (await gu.getByRole('button', { name: 'Add downloaded file…' }).count()) === 1);
  await gu.getByRole('button', { name: 'Add downloaded file…' }).click();
  await page.waitForFunction(() => document.querySelector('section.model-row[data-id="gu2net-isbi19"]')?.textContent.includes('Ready'));
  const added = await calls('models_add_file');
  ok('3. picking the file installs it from that path', added.length === 1 && added[0][1].path === '/Users/demo/SYNTHETIC-best.zip');

  await gu.getByLabel('Starts the tracing').check();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('calls') || '[]').some(([c]) => c === 'models_set_main'));
  ok('4. "Starts the tracing" sets GU2Net as the main model', (await calls('models_set_main')).some(([, a]) => a.id === 'gu2net-isbi19'));

  await srp.getByRole('button', { name: 'Remove' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('calls') || '[]').some(([c]) => c === 'models_remove'));
  ok('5. Remove asks, then removes SRPose', (await calls('plugin:dialog|message')).length === 1 && (await calls('models_remove')).some(([, a]) => a.id === 'srpose-cldet23'));

  await page.keyboard.press('Escape');
  ok('Esc closes the dialog', (await page.locator('[role="dialog"][aria-label="Models"]').count()) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));

  await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(300);
  ok('0. the safety-copy notice is shown once, not on the next start', (await page.locator('.library [role="status"]', { hasText: 'safety copy' }).count()) === 0);
  await page.evaluate(() => localStorage.setItem('failOpen', '1')); await page.reload(); await page.waitForSelector('.library');
  await page.waitForSelector('.library .error', { timeout: 5000 }).catch(() => {});
  ok('0. a refused upgrade shows the message and no notice', ((await page.locator('.library .error').allInnerTexts()).join(' ')) ===
    "Couldn't make a safety copy before upgrading. Your library hasn't been changed." && (await page.locator('.library [role="status"]', { hasText: 'safety copy' }).count()) === 0);
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
