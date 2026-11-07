// 1.2.1: the whole-film check's model in Models… and the one-time question (spec 2026-11-06-check-model-download, Task 8).
// Checked in the built UI in Chromium, Tauri stubbed, state in localStorage; no film is opened (the note's new words are in e2e24.cjs):
//  a. first open with no finder: the question, once, its exact words; the beta notice first, the question only after OK
//  b. Later (button), Escape and the close button: each records the answer, none installs; after a reload no question
//  c. Download: install is called, then the answer is recorded; the question closes; Models… shows the progress, closed and
//     reopened mid-download it carries on, then Ready and Remove
//  d. the whole-film check switched off: no question (Q2); and a finder already found: no question
//  e. Models… row: the credit line, the all-versions DOI (copyable), the citation (no "v1"), ~121 MB, Download and Add files…
//  f. failures in the app's words: offline (Retry works), a file that does not match, a refused download (page to fetch by hand)
//  g. nothing read yet (the row says so), the library locked or read-only (offer fails: no question, no crash; row read fails: shown)
//  h. light and dark
//  i. review I2 (spec §6): after Download in the question, a small line under the film list follows the install and closes
//     when it is ready; a failure (an event, or a refused install) says "Nothing was installed. Try again in Models…"
//  j. review M2: Remove asks first, on a damaged row too; review I1: a finder added by hand reads "Ready (added by hand)"
// The stub's offer mimics src-tauri/src/check_model.rs `should_ask` (tested in Rust). SYNTHETIC only.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
const QUESTION = 'The whole-film check needs its model (121 MB, by Dr Linton Nash, CC BY 4.0). Download now?';
const CITATION = 'Nash L (2026). OpenCephAI region finder for lateral cephalograms. Zenodo. doi:10.5281/zenodo.23949953 (all versions). Licence: CC BY 4.0.';
const MISMATCH = "The file doesn't match the one this version of OpenCephAI was made for. Nothing was installed.";
const NO_NET = 'No internet connection. Nothing was installed. Try again when you are online, or use Add files…';

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(() => {
    const load = () => JSON.parse(localStorage.getItem('fake25') || '{"settings":{},"calls":[]}');
    const store = (d) => localStorage.setItem('fake25', JSON.stringify(d));
    let cb = 0; window.__listeners = [];
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: (fn) => { const id = ++cb; window['_cb' + id] = fn; return id; },
      convertFileSrc: () => '',
      invoke: async (cmd, a = {}) => {
        const d = load(); const log = (c) => { d.calls.push(c); store(d); };
        switch (cmd) {
          case 'plugin:event|listen': window.__listeners.push({ event: a.event, handler: a.handler }); return 1;
          case 'settings_get': return a.key === 'betaNoticeSeen' ? (d.beta === false ? null : '1') : (d.settings[a.key] ?? null);
          case 'settings_set': d.settings[a.key] = a.value; store(d); return null;
          case 'library_list': return [];
          case 'library_user_norms': return [];
          case 'operators_list': return { current: '', names: [] };
          case 'system_font_list': return [];
          case 'model_status': return { loaded: false, modelId: null, searched: [], error: null };
          case 'models_list': return [];
          case 'point_check_counts': return [];
          case 'whole_film_switch': return { on: !d.wfOff, isDefault: false, line: '' };
          case 'plugin:dialog|open': return '/Users/demo/SYNTHETIC-check-model-folder';
          case 'plugin:dialog|message': log('confirm'); return d.confirmNo ? 'No' : 'Yes';   // `ask` is the message command answered with the OK label
          // The check model (check_model.rs): the row, the install, add files, remove, the question.
          case 'check_model_row': if (d.rowDelay) await new Promise((r) => setTimeout(r, d.rowDelay)); if (d.rowFail) throw 'the library is locked'; window.__rowReads = (window.__rowReads || 0) + 1;
            return { title: 'Region finder for the whole-film check', author: 'Dr Linton Nash', licence: 'CC BY 4.0', citation: 'Nash L (2026). OpenCephAI region finder for lateral cephalograms. Zenodo. doi:10.5281/zenodo.23949953 (all versions). Licence: CC BY 4.0.',
              page: 'https://zenodo.org/records/23965907', sizeMb: 121, status: d.status || 'not-installed', byHand: !!d.byHand, stage: d.stage || null, error: d.error || null };
          case 'check_model_install': log('install'); if (d.installFail) { d.status = 'failed'; d.error = d.installFail; store(d); throw d.installFail; }
            d.status = 'installing'; d.stage = 'downloading'; store(d);
            // The back end's first progress event (models.rs `emit`), which is what moves an open row to Installing.
            setTimeout(() => { for (const l of window.__listeners.filter((x) => x.event === 'models://progress')) window['_cb' + l.handler]({ event: 'models://progress', id: 0, payload: { id: 'check-regions', stage: 'downloading', fraction: null } }); }, 50);
            return new Promise(() => {});
          case 'check_model_add_files': log('add:' + a.path); if (d.addFail) { d.status = 'failed'; d.error = d.addFail; store(d); throw d.addFail; }
            d.status = 'ready'; store(d); return null;
          case 'check_model_remove': log('remove'); d.status = 'not-installed'; d.error = null; store(d); return null;
          case 'check_model_offer': if (d.offerFail) throw 'the library is locked'; log('offer'); return !d.settings.check_model_asked && !d.finder && !d.wfOff;
          case 'check_model_offer_answered': log('answered'); d.settings.check_model_asked = '1'; store(d); return null;
          default: return null;
        }
      },
    };
  });
  const state = () => page.evaluate(() => JSON.parse(localStorage.getItem('fake25') || '{"settings":{},"calls":[]}'));
  const set = (patch) => page.evaluate((p) => { const d = JSON.parse(localStorage.getItem('fake25') || '{"settings":{},"calls":[]}'); Object.assign(d, p); localStorage.setItem('fake25', JSON.stringify(d)); }, patch);
  // The state is cleared once the page loaded first has made its last call (it would otherwise write it after the clear).
  const URL_ = process.env.E2E_URL || 'http://localhost:4173/';
  const fresh = async (patch = {}) => { await page.goto(URL_); await page.waitForTimeout(500); await page.evaluate(() => localStorage.clear()); await set(patch); await page.goto(URL_); await page.waitForSelector('.library'); };
  const offer = page.locator('[aria-label="Whole-film check model"]');
  const settle = () => page.waitForTimeout(600);
  const emit = (payload) => page.evaluate((p) => { for (const l of window.__listeners.filter((x) => x.event === 'models://progress')) window['_cb' + l.handler]({ event: 'models://progress', id: 0, payload: p }); }, payload);
  const openModels = async () => { await page.getByRole('button', { name: 'Models…', exact: true }).click(); await page.waitForSelector('[aria-label="Models"]'); };
  const closeModels = async () => { await page.keyboard.press('Escape'); await page.waitForSelector('[aria-label="Models"]', { state: 'detached' }); };
  const row = page.locator('[data-id="check-regions"]');
  const rowText = async () => (await row.count() ? row.first().innerText() : '');
  const rowBtns = async () => row.locator('button').allInnerTexts();
  const until = (fn, arg) => page.waitForFunction(fn, arg, { timeout: 4000 }).then(() => true, () => false);
  const calls = async () => (await state()).calls.filter((c) => c !== 'offer');

  // (a) first open, no finder, check on: the question once, in its words; the beta notice comes first.
  await fresh({ beta: false });
  await settle();
  ok('a1. the beta notice is open: no question yet', (await page.locator('.beta-notice').count()) === 1 && (await offer.count()) === 0);
  ok('a2. the question has not even been asked of the back end while the notice is open', !(await state()).calls.includes('offer'), JSON.stringify(await state()));
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await offer.waitFor({ timeout: 4000 }).catch(() => {});
  ok('a3. after OK the question shows, in its exact words', (await offer.count()) === 1 && (await offer.innerText()).includes(QUESTION), (await offer.count() ? await offer.innerText() : '').replace(/\n/g, '|'));
  ok('a4. two choices: Download and Later', JSON.stringify(await offer.getByRole('button').allInnerTexts()) === JSON.stringify(['×', 'Download', 'Later']));

  // (b) Later, Escape, the close button: each records the answer, none installs; reload: not asked again.
  await offer.getByRole('button', { name: 'Later', exact: true }).click();
  await settle();
  ok('b1. Later closes it, records the answer, installs nothing', (await offer.count()) === 0 && JSON.stringify(await calls()) === JSON.stringify(['answered']), JSON.stringify(await calls()));
  await page.reload(); await page.waitForSelector('.library'); await settle();
  ok('b2. reloaded: no question again', (await offer.count()) === 0);
  await fresh(); await offer.waitFor({ timeout: 4000 }).catch(() => {});
  await page.keyboard.press('Escape'); await settle();
  ok('b3. Escape: closed, answer recorded, no install', (await offer.count()) === 0 && JSON.stringify(await calls()) === JSON.stringify(['answered']), JSON.stringify(await calls()));
  await fresh(); await offer.waitFor({ timeout: 4000 }).catch(() => {});
  await offer.getByRole('button', { name: 'Close', exact: true }).click(); await settle();
  ok('b4. the close button: closed, answer recorded, no install', (await offer.count()) === 0 && JSON.stringify(await calls()) === JSON.stringify(['answered']), JSON.stringify(await calls()));

  // (c) Download: install, then the answer; Models… carries the progress, closed and reopened.
  await fresh(); await offer.waitFor({ timeout: 4000 }).catch(() => {});
  await offer.getByRole('button', { name: 'Download', exact: true }).click(); await settle();
  ok('c1. Download: install called, then the answer recorded; the question is gone', (await offer.count()) === 0 && JSON.stringify(await calls()) === JSON.stringify(['install', 'answered']), JSON.stringify(await calls()));
  const line = page.locator('.check-model-line');
  ok('c1b. the small line under the film list follows the install, from the first event', await until(() => /^Downloading the check model…$/.test(document.querySelector('.check-model-line')?.textContent || '')), (await line.count() ? await line.first().innerText() : 'no line'));
  await emit({ id: 'check-regions', stage: 'downloading', fraction: 0.37 });
  ok('c1c. with the percentage', await until(() => /^Downloading the check model… 37%$/.test(document.querySelector('.check-model-line')?.textContent || '')), (await line.count() ? await line.first().innerText() : 'no line'));
  ok('c1d. the line is in the library, outside the question and Models…', (await page.locator('.app-library .check-model-line').count()) === 1);
  await openModels();
  await row.waitFor({ timeout: 4000 }).catch(() => {});
  ok('c2. Models… shows it installing, no buttons', /Downloading/.test(await rowText()) && (await rowBtns()).every((b) => b === 'Copy link'), (await rowText()).replace(/\n/g, '|'));
  await emit({ id: 'check-regions', stage: 'downloading', fraction: 0.37 });
  ok('c3. the percentage', await until(() => /Downloading 37%/.test(document.querySelector('[data-id="check-regions"]')?.innerText || '')), (await rowText()).replace(/\n/g, '|'));
  await closeModels(); await openModels(); await row.waitFor({ timeout: 4000 }).catch(() => {});
  ok('c4. closed and reopened mid-download: still installing', /Downloading/.test(await rowText()) && (await rowBtns()).every((b) => b === 'Copy link'), (await rowText()).replace(/\n/g, '|'));
  await emit({ id: 'check-regions', stage: 'downloading', fraction: 0.8 });
  ok('c5. and its next event moves the percentage on', await until(() => /Downloading 80%/.test(document.querySelector('[data-id="check-regions"]')?.innerText || '')));
  await set({ status: 'ready', stage: null }); await emit({ id: 'check-regions', stage: 'ready', fraction: null });
  ok('c6a. ready: the line under the film list closes', await until(() => !document.querySelector('.check-model-line')));
  ok('c6. ready: Remove, no Download', await until(() => /Ready/.test(document.querySelector('[data-id="check-regions"]')?.innerText || '')) && (await rowBtns()).includes('Remove') && !(await rowBtns()).includes('Download'), (await rowBtns()).join('|'));
  await row.getByRole('button', { name: 'Remove', exact: true }).click(); await settle();
  ok('c7. Remove: back to not installed', (await calls()).includes('remove') && (await rowBtns()).includes('Download'), (await rowBtns()).join('|'));
  await closeModels();

  // (d) check switched off, or a finder already found: no question.
  await fresh({ wfOff: true }); await settle();
  ok('d1. whole-film check off: no question', (await offer.count()) === 0 && (await state()).calls.includes('offer'));
  await fresh({ finder: true }); await settle();
  ok('d2. a finder already found: no question', (await offer.count()) === 0);

  // (e) the row's credit.
  await fresh({ settings: { check_model_asked: '1' } }); await openModels(); await row.waitFor({ timeout: 4000 }).catch(() => {});
  const t = await rowText();
  ok('e1. the credit line', t.includes('Region finder for the whole-film check, by Dr Linton Nash, CC BY 4.0'), t.replace(/\n/g, '|'));
  ok('e2. the citation, ~121 MB, and no "v1" anywhere in the row', t.includes(CITATION) && t.includes('~121 MB') && !/v1/.test(t));
  ok('e3. the DOI is the all-versions one, copyable', (await row.locator('input[aria-label="Link"]').inputValue()) === 'https://doi.org/10.5281/zenodo.23949953');
  ok('e4. not installed: Download and Add files…', JSON.stringify((await rowBtns()).filter((b) => b !== 'Copy link')) === JSON.stringify(['Download', 'Add files…']), (await rowBtns()).join('|'));
  await row.getByRole('button', { name: 'Add files…', exact: true }).click(); await settle();
  ok('e5. Add files… hands the chosen folder to the back end', JSON.stringify(await calls()) === JSON.stringify(['add:/Users/demo/SYNTHETIC-check-model-folder']), JSON.stringify(await calls()));
  ok('e6. then ready', /Ready/.test(await rowText()));
  await closeModels();

  // (f) failures, in the app's words.
  await fresh({ settings: { check_model_asked: '1' }, installFail: NO_NET }); await openModels(); await row.waitFor({ timeout: 4000 }).catch(() => {});
  await row.getByRole('button', { name: 'Download', exact: true }).click(); await settle();
  ok('f1. offline: the words, and Retry', (await rowText()).includes(NO_NET) && (await rowBtns()).includes('Retry'), (await rowText()).replace(/\n/g, '|'));
  await set({ installFail: null }); await row.getByRole('button', { name: 'Retry', exact: true }).click(); await settle();
  ok('f2. Retry starts it again', (await calls()).filter((c) => c === 'install').length === 2 && /Downloading/.test(await rowText()), JSON.stringify(await calls()));
  await closeModels();
  await fresh({ settings: { check_model_asked: '1' }, addFail: MISMATCH }); await openModels(); await row.waitFor({ timeout: 4000 }).catch(() => {});
  await row.getByRole('button', { name: 'Add files…', exact: true }).click(); await settle();
  ok('f3. a corrupt or wrong file is refused in the words, with Retry and Add files…', (await rowText()).includes(MISMATCH) && (await rowBtns()).includes('Retry') && (await rowBtns()).includes('Add files…'), (await rowText()).replace(/\n/g, '|'));
  await closeModels();
  await fresh({ settings: { check_model_asked: '1' }, installFail: 'DOWNLOAD_BLOCKED' }); await openModels(); await row.waitFor({ timeout: 4000 }).catch(() => {});
  await row.getByRole('button', { name: 'Download', exact: true }).click(); await settle();
  ok('f4. a refused download: the page to fetch by hand, never the raw code', !(await rowText()).includes('DOWNLOAD_BLOCKED') && (await row.locator('input[aria-label="Link"]').count()) === 2 && (await row.locator('input[aria-label="Link"]').nth(1).inputValue()) === 'https://zenodo.org/records/23965907', (await rowText()).replace(/\n/g, '|'));
  await closeModels();
  await fresh({ settings: { check_model_asked: '1' }, status: 'damaged' }); await openModels(); await row.waitFor({ timeout: 4000 }).catch(() => {});
  ok('f5. damaged: says to download it again, with Retry', (await rowText()).includes('Damaged: download it again') && (await rowBtns()).includes('Retry'), (await rowText()).replace(/\n/g, '|'));
  await closeModels();

  // (j) Remove asks first, on a damaged row too (M2); a finder added by hand (I1).
  await fresh({ settings: { check_model_asked: '1' }, status: 'damaged', confirmNo: true }); await openModels(); await row.waitFor({ timeout: 4000 }).catch(() => {});
  await row.getByRole('button', { name: 'Remove', exact: true }).click(); await settle();
  ok('j1. damaged, Remove then No: asked, nothing removed', JSON.stringify(await calls()) === JSON.stringify(['confirm']), JSON.stringify(await calls()));
  await set({ confirmNo: false }); await row.getByRole('button', { name: 'Remove', exact: true }).click(); await settle();
  ok('j2. damaged, Remove then Yes: asked first, then removed', JSON.stringify(await calls()) === JSON.stringify(['confirm', 'confirm', 'remove']), JSON.stringify(await calls()));
  await closeModels();
  await fresh({ settings: { check_model_asked: '1' }, status: 'ready', byHand: true }); await openModels(); await row.waitFor({ timeout: 4000 }).catch(() => {});
  ok('j3. a finder put there by hand reads Ready (added by hand), with Remove', (await rowText()).includes('Ready (added by hand)') && (await rowBtns()).includes('Remove'), (await rowText()).replace(/\n/g, '|'));
  await closeModels();

  // (g) nothing read yet; the library locked or read-only.
  await fresh({ settings: { check_model_asked: '1' }, rowDelay: 1500 }); await openModels(); await page.waitForTimeout(200);
  ok('g1. nothing read yet: the row says Reading…, no buttons', (await rowText()).includes('Reading…') && (await rowBtns()).length === 0, (await rowText()).replace(/\n/g, '|'));
  ok('g2. then the row appears', await until(() => /Not installed/.test(document.querySelector('[data-id="check-regions"]')?.innerText || '')));
  await closeModels();
  await fresh({ offerFail: true, rowFail: true }); await settle();
  ok('g3. library locked or read-only: the offer fails, no question, no crash', (await offer.count()) === 0 && (await page.locator('.library').count()) === 1);
  await openModels(); await settle();
  ok('g4. and the row read failing is shown, not a crash', (await page.locator('[aria-label="Models"] .error').allInnerTexts()).join('|').includes('the library is locked'), (await page.locator('[aria-label="Models"] .error').allInnerTexts()).join('|'));
  await closeModels();

  // (i) the small line under the film list, failures (I2).
  const FAILED = 'The check model did not download. Nothing was installed. Try again in Models…';
  await fresh(); await offer.waitFor({ timeout: 4000 }).catch(() => {});
  await offer.getByRole('button', { name: 'Download', exact: true }).click(); await settle();
  await emit({ id: 'check-regions', stage: 'failed', fraction: null });
  ok('i1. a failed install event: the line says nothing was installed and where to retry', await until((t) => document.querySelector('.check-model-line')?.textContent === t, FAILED), (await line.count() ? await line.first().innerText() : 'no line'));
  ok('i2. Later never shows the line', await (async () => { await fresh(); await offer.waitFor({ timeout: 4000 }).catch(() => {}); await offer.getByRole('button', { name: 'Later', exact: true }).click(); await settle(); await emit({ id: 'check-regions', stage: 'downloading', fraction: 0.5 }); return (await line.count()) === 0; })());
  await fresh({ installFail: NO_NET }); await offer.waitFor({ timeout: 4000 }).catch(() => {});
  await offer.getByRole('button', { name: 'Download', exact: true }).click(); await settle();
  ok('i3. an install the back end refuses before any event shows the same words', await until((t) => document.querySelector('.check-model-line')?.textContent === t, FAILED), (await line.count() ? await line.first().innerText() : 'no line'));

  // (h) light and dark.
  for (const scheme of ['light', 'dark']) {
    await page.emulateMedia({ colorScheme: scheme });
    await fresh(); await offer.waitFor({ timeout: 4000 }).catch(() => {});
    const px = await offer.evaluate((el) => { const s = getComputedStyle(el), p = getComputedStyle(el.querySelector('p')); return { bg: s.backgroundColor, fg: p.color }; }).catch(() => null);
    ok(`h1. ${scheme}: the question is drawn and its text differs from its background`, !!px && px.bg !== px.fg && (await offer.isVisible()), JSON.stringify(px));
    await page.keyboard.press('Escape'); await settle();
  }
  await page.emulateMedia({ colorScheme: null });

  ok('no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  console.log(results.join('\n'));
  await browser.close();
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
})().catch((e) => { console.log(results.join('\n')); console.error(e); process.exit(2); });
