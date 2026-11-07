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
          case 'library_list': if (localStorage.getItem('gatePending') && !localStorage.getItem('gateConfirmed')) call('library_list_before_confirm', a);
            if (localStorage.getItem('failOpen') === 'still') throw "The library upgrade to format 18 is still failing. Your library hasn't been changed (it is still at format 7). No new safety copy was made: the safety copy already made for this upgrade is in /Users/demo/Library/OpenCephAI/upgrade-backups/OpenCephAI backup before upgrade 7→18 2026-11-02 10-00-00. To go back to it, choose Library ▸ Restore… and pick that folder.";
            if (localStorage.getItem('failOpen')) throw "Couldn't make a safety copy before upgrading, so your library hasn't been changed. OpenCephAI tries again only after you quit it and open it again."; return [];
          case 'library_upgrade_pending': return localStorage.getItem('gatePending') && !localStorage.getItem('gateConfirmed') ? { from: 19, to: 20 } : null;   // item 3: the notice before an upgrade
          case 'library_upgrade_confirm': call(cmd, a); localStorage.setItem('gateConfirmed', '1'); return null;
          case 'library_upgrade_quit': call(cmd, a); return null;
          case 'library_upgrade_copy': if (db.upgradeShown || localStorage.getItem('failOpen')) return null; db.upgradeShown = true; store(db);
            return '/Users/demo/Library/OpenCephAI/upgrade-backups/OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00';
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          case 'models_list': return db.models;
          case 'models_accept_licence': call(cmd, a); m(a.id).licenceAccepted = true; store(db); return null;
          case 'models_install': {
            call(cmd, a);
            if (a.id === 'srpose-cldet23' && localStorage.getItem('slowFail')) {   // Task 7: a slow install that then fails
              await new Promise((r) => setTimeout(r, 500)); Object.assign(m(a.id), { status: 'failed', error: 'Not enough disk space: 60 MB needed.' }); store(db); throw 'Not enough disk space: 60 MB needed.';
            }
            if (a.id === 'gu2net-isbi19' && !db.installs[a.id]) {
              db.installs[a.id] = 1; Object.assign(m(a.id), { status: 'failed', error: 'DOWNLOAD_BLOCKED' }); store(db); throw 'DOWNLOAD_BLOCKED';
            }
            Object.assign(m(a.id), { status: 'ready', error: null, msPerFilm: 412 }); store(db); return null;
          }
          case 'models_add_file': call(cmd, a); Object.assign(m(a.id), { status: 'ready', error: null, msPerFilm: 300 }); store(db); return null;
          case 'models_set_main': call(cmd, a); db.models.forEach((r) => { r.main = r.id === a.id; }); store(db); return null;
          case 'models_remove': call(cmd, a);
            if (localStorage.getItem('refuseRemove')) throw 'SRPose is in use right now (a tracing or the weights check). Wait for it to finish, then press Remove again.';
            Object.assign(m(a.id), { status: 'not-installed', main: false, msPerFilm: null }); store(db); return null;
          case 'set_model_dir': call(cmd, a);   // Task 7 (owner ruling Q1): refused while a Models… model is Ready; nothing written
            if (db.models.some((r) => r.status === 'ready')) throw "This folder isn't used while a model installed in Models… is ready. OpenCephAI uses the Models… model to trace. To use a folder instead, remove the installed models first.";
            db.settings.model_dir = a.dir; store(db); return 'folder-model';
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
  ok('1. Models… opens the dialog with three rows', (await page.locator('section.model-row:not(.check-model-row)').count()) === 3);   // the whole-film check's model row (1.2.1) is its own section, not a landmark model
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
  ok('3. a blocked row also says Retry', (await gu.getByRole('button', { name: 'Retry' }).count()) === 1);
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

  // Task 7 (PR #14 minors): Install is busy after one click; a Failed row says Retry.
  await page.evaluate(() => localStorage.setItem('slowFail', '1'));
  const before = (await calls('models_install')).filter(([, a]) => a.id === 'srpose-cldet23').length;
  const inst = srp.getByRole('button', { name: 'Install' });
  await inst.dblclick();
  ok('6. a double click on Install makes one models.install call', (await calls('models_install')).filter(([, a]) => a.id === 'srpose-cldet23').length === before + 1);
  ok('6. the button is disabled and says Starting… while it works', (await srp.getByRole('button', { name: 'Starting…' }).isDisabled()));
  await srp.getByRole('button', { name: 'Retry' }).waitFor({ timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: `${__dirname}/out/models-6.png` });
  ok('6. after the install fails, the row says why and the button says Retry, enabled',
    (await srp.getByText('Not enough disk space: 60 MB needed.').count()) === 1 && (await srp.getByRole('button', { name: 'Retry' }).isEnabled()));
  await page.evaluate(() => localStorage.removeItem('slowFail'));
  await srp.getByRole('button', { name: 'Retry' }).click();
  await page.waitForFunction(() => document.querySelector('section.model-row[data-id="srpose-cldet23"]')?.textContent.includes('Ready'));
  ok('6. Retry installs it (a second call)', (await calls('models_install')).filter(([, a]) => a.id === 'srpose-cldet23').length === before + 2);

  // Final review I1: a refused Remove says why on the Models screen, and the model stays Ready.
  await page.evaluate(() => localStorage.setItem('refuseRemove', '1'));
  await srp.getByRole('button', { name: 'Remove' }).click();
  await page.getByText('SRPose is in use right now (a tracing or the weights check). Wait for it to finish, then press Remove again.').waitFor({ timeout: 5000 }).catch(() => {});
  ok('6b. a refused Remove shows the app\'s words on the Models screen and the row stays Ready',
    (await page.locator('[role="dialog"][aria-label="Models"] p.error').allInnerTexts()).join(' ').includes('SRPose is in use right now') && (await srp.textContent()).includes('Ready'));
  await page.evaluate(() => localStorage.removeItem('refuseRemove'));

  // Task 7 (owner ruling Q1): with a Models… model Ready, "Use a model folder…" says why it is not used; nothing is stored.
  await page.getByRole('button', { name: 'Use a model folder…' }).click();
  await page.getByRole('status').filter({ hasText: "isn't used while a model installed in Models… is ready" }).waitFor({ timeout: 5000 }).catch(() => {});
  await page.screenshot({ path: `${__dirname}/out/models-7.png` });
  const note = (await page.locator('[role="dialog"][aria-label="Models"] [role="status"]').allInnerTexts()).join(' ');
  ok('7. a Ready Models… model: the folder is refused, in plain words, with the reason',
    note.includes("This folder isn't used while a model installed in Models… is ready. OpenCephAI uses the Models… model to trace.") && note.includes('remove the installed models first'), note);
  ok('7. nothing was remembered', await page.evaluate(() => !JSON.parse(localStorage.getItem('fakeLib')).settings.model_dir));
  // No Models… model Ready: the folder works as before (no message).
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.models.forEach((r) => { r.status = 'not-installed'; r.main = false; }); localStorage.setItem('fakeLib', JSON.stringify(db)); });
  await page.reload(); await page.waitForSelector('.library');
  await page.getByRole('button', { name: 'Models…' }).first().click();
  await page.waitForSelector('[role="dialog"][aria-label="Models"] section.model-row');
  await page.getByRole('button', { name: 'Use a model folder…' }).click();
  await page.waitForFunction(() => JSON.parse(localStorage.getItem('fakeLib')).settings.model_dir);
  ok('7. no Ready model: the folder is accepted as before, no message', (await page.getByRole('status').filter({ hasText: "isn't used" }).count()) === 0
    && (await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).settings.model_dir)) === '/Users/demo/SYNTHETIC-best.zip');

  await page.keyboard.press('Escape');
  ok('Esc closes the dialog', (await page.locator('[role="dialog"][aria-label="Models"]').count()) === 0);
  ok('no page errors', errors.length === 0, errors.join(' | '));

  await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(300);
  ok('0. the safety-copy notice is shown once, not on the next start', (await page.locator('.library [role="status"]', { hasText: 'safety copy' }).count()) === 0);
  await page.evaluate(() => localStorage.setItem('failOpen', '1')); await page.reload(); await page.waitForSelector('.library');
  await page.waitForSelector('.library .error', { timeout: 5000 }).catch(() => {});
  ok('0. a refused upgrade shows the message and no notice', ((await page.locator('.library .error').allInnerTexts()).join(' ')) ===
    "Couldn't make a safety copy before upgrading, so your library hasn't been changed. OpenCephAI tries again only after you quit it and open it again." && (await page.locator('.library [role="status"]', { hasText: 'safety copy' }).count()) === 0);
  // Ruling b (2 Nov): a later launch of a still-failing upgrade says so, names the safety copy already made for this upgrade, and shows no notice.
  await page.evaluate(() => localStorage.setItem('failOpen', 'still')); await page.reload(); await page.waitForSelector('.library');
  await page.waitForSelector('.library .error', { timeout: 5000 }).catch(() => {});
  ok('0b. a still-failing upgrade shows the "still failing" words and no notice', ((await page.locator('.library .error').allInnerTexts()).join(' ')) ===
    "The library upgrade to format 18 is still failing. Your library hasn't been changed (it is still at format 7). No new safety copy was made: the safety copy already made for this upgrade is in /Users/demo/Library/OpenCephAI/upgrade-backups/OpenCephAI backup before upgrade 7→18 2026-11-02 10-00-00. To go back to it, choose Library ▸ Restore… and pick that folder." && (await page.locator('.library [role="status"]', { hasText: 'safety copy' }).count()) === 0);
  // Item 3 (owner, 6 Nov 2026): the notice before a library upgrade. Continue / Quit; nothing opens until Continue; none when no upgrade is needed.
  await page.evaluate(() => { localStorage.removeItem('failOpen'); localStorage.setItem('calls', '[]'); localStorage.setItem('gatePending', '1'); localStorage.removeItem('gateConfirmed'); });
  await page.reload(); await page.waitForSelector('[role="alertdialog"]'); await page.waitForTimeout(400);
  const gateText = (await page.locator('[role="alertdialog"]').innerText()).replace(/\s+/g, ' ');
  ok('G1. the notice shows the owner\'s words with Continue and Quit', gateText.includes('This version of OpenCephAI will upgrade your library. A checked safety copy is made first. For extra safety, back up your library yourself before continuing. To do that, choose Quit, then in Finder choose Go › Go to Folder… (⇧⌘G) and copy ~/Library/Application Support/app.cephtrace.desktop.')
    && (await page.getByRole('button', { name: 'Continue', exact: true }).count()) === 1 && (await page.getByRole('button', { name: 'Quit', exact: true }).count()) === 1, gateText);
  ok('G2. before Continue the app is not shown and the library is not read', (await page.locator('.library').count()) === 0 && (await calls('library_list_before_confirm')).length === 0 && (await calls('library_upgrade_confirm')).length === 0);
  await page.getByRole('button', { name: 'Quit', exact: true }).click(); await page.waitForTimeout(300);
  ok('G3. Quit asks the back end to quit, confirms nothing, reads nothing', (await calls('library_upgrade_quit')).length === 1 && (await calls('library_upgrade_confirm')).length === 0 && (await calls('library_list_before_confirm')).length === 0 && (await page.locator('.library').count()) === 0);
  await page.reload(); await page.waitForSelector('[role="alertdialog"]');   // (the real app has closed; the stub reopens it: still asking, since nothing was confirmed)
  await page.getByRole('button', { name: 'Continue', exact: true }).click(); await page.waitForSelector('.library');
  ok('G4. Continue confirms, then the library opens as before', (await calls('library_upgrade_confirm')).length === 1 && (await page.locator('[role="alertdialog"]').count()) === 0 && (await calls('library_list_before_confirm')).length === 0);
  await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(300);
  ok('G5. confirmed (this run\'s stub): no notice again', (await page.locator('[role="alertdialog"]').count()) === 0);
  await page.evaluate(() => { localStorage.removeItem('gatePending'); localStorage.removeItem('gateConfirmed'); }); await page.reload(); await page.waitForSelector('.library'); await page.waitForTimeout(300);
  ok('G6. no upgrade needed (fresh install or already current): no notice, the library opens at once', (await page.locator('[role="alertdialog"]').count()) === 0 && (await page.locator('.library').count()) === 1);
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(1); });
