// Request G (spec 2026-10-17, owner G1–G3): scale a film to another on the Superimposition page and fine-tune the fit.
// The built UI in Chromium with a stubbed Tauri runtime and a fake library in localStorage. SYNTHETIC image, names,
// and dates only.
// B0 (plan 2026-10-18 Task 1) is the before/after instrument: with no fit anywhere, every Change-table cell, every
// Measurements cell and every drawn comparison point must equal the golden captured from main 5253e8d through this
// same screen (e2e/golden/g-unfitted.json). G_CAPTURE=<file> writes that golden instead of comparing (run on main).
// Norms Auto population Task 3 (owner decision 6, 29 Oct 2026): with no population at all, Auto now fills Steiner's
// Pog–NB, which main showed as "No norm". The B0 run on 5087cd3 found exactly 8 differing rows of 513, every one the
// Pog–NB norm cell of an un-fitted film ("No norm" → a norm); those 8 cells were replaced in the golden with what the
// screen now shows (checked: same measurement, same value cell, only the norm cell changed). Every other row is still
// main 5253e8d's.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || '/opt/node22/lib/node_modules/playwright');
const fs = require('fs'), path = require('path');
const png = fs.readFileSync(__dirname + '/out/synthetic.png').toString('base64');
const GOLDEN = path.join(__dirname, 'golden', 'g-unfitted.json');
const base = { S:[0,0],N:[700,-100],A:[720,300],B:[690,650],Pog:[700,760],Gn:[680,820],Me:[640,850],Go:[150,700],Po:[-200,100],Or:[560,80],
  ANS:[740,220],PNS:[260,240],Ar:[-40,200],U1T:[745,520],L1T:[735,530],UL:[800,440],LL:[790,590],Sn:[790,280],PogS:[770,800] };
// A film's points: the base shape enlarged by k about S, moved by (dx, dy), mirrored for a left-facing film (image 1200 × 1400).
const lms = ({ k = 1, dx = 0, dy = 0, mirror = false, drop = [] } = {}) => Object.entries(base).filter(([id]) => !drop.includes(id)).map(([id, [x, y]]) => {
  const px = 250 + dx + k * x, py = 300 + dy + k * y;
  return { id, x: mirror ? 1199 - px : px, y: py, source: 'ai', verified: false, aiX: null, aiY: null, confidence: 0.8 }; });
let made = 0;
const film = (id, [name, key, born], tp, takenOn, spacingMm, landmarks, extra = {}) => ({ id, path: `/Users/demo/${id}.png`, patientName: name, patientKey: key,
  dateOfBirth: born, scanId: null, timepoint: tp, takenOn, takenOnSource: 'label', facing: 'right', orientation: {}, display: {}, spacingMm,
  verifiedAt: null, verifiedBy: null, landmarks, createdAt: `2026-10-0${1 + (made++ % 9)}T0${made % 10}:00:00Z`, updatedAt: '2026-10-10T00:00:00Z', deletedAt: null,
  identitySource: 'manual', identityChecked: true, identityIssues: [], learnedFields: [], stage: null, inSeries: true,
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [], ...extra });
const RESCALE = ['Demo Rescale', 'demo rescale', '2012-03-04'];   // SYNTHETIC
const ASSUMED = ['Demo Assumed', 'demo assumed', '2013-05-06'];   // SYNTHETIC
const SINGLE = ['Demo Single', 'demo single', '2014-07-08'];      // SYNTHETIC
const seed = { settings: {}, fits: {}, cases: {
  g1: film('g1', RESCALE, 'T1', '2020-01-10', 0.1, lms()),                                         // SYNTHETIC ruler-calibrated
  g2: film('g2', RESCALE, 'T2', '2021-01-10', null, lms({ k: 0.96, dx: 20, dy: 10 })),            // SYNTHETIC no ruler, S–N 4 % shorter
  g3: film('g3', RESCALE, 'T3', '2022-01-10', 0.12, lms({ dx: -10, mirror: true }), { facing: 'left' }),   // SYNTHETIC calibrated, faces left
  g4: film('g4', RESCALE, 'T4', '2023-01-10', null, lms({ dx: 5, drop: ['N'] })),                 // SYNTHETIC no ruler, no N
  h1: film('h1', ASSUMED, 'T1', '2020-02-10', null, lms()),                                         // SYNTHETIC no ruler
  h2: film('h2', ASSUMED, 'T2', '2021-02-10', null, lms({ k: 0.97 })),                              // SYNTHETIC no ruler
  s1: film('s1', SINGLE, 'T1', '2022-03-10', null, lms()),                                          // SYNTHETIC the patient's only film
  u1: film('u1', ['', '~u1', null], 'T1', '2022-04-10', null, lms()),                               // SYNTHETIC unnamed
} };
// Fix round 1 (review M-2): the report and the diff log of an EARLIER run are deleted before anything runs, and a run
// that fails part-way writes what it got plus a CRASHED line, so a stale report can never be read as this run's.
const OUT = path.join(__dirname, 'out'), REPORT = path.join(OUT, 'e2e15-report.txt'), DIFFS = path.join(OUT, 'e2e15-diffs.log');
for (const f of [REPORT, DIFFS]) fs.rmSync(f, { force: true });
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  (' + extra + ')' : ''}`); };
// NaN-aware equality (fix round 1, Minor 1): a degenerate S≈N cross-mark
// coordinate reads as the string "NaN"; two runs that both hit it must count as equal to EACH OTHER but never to a
// real number. Not reachable with today's fixture (no film has S==N) — forward-looking, so it is proven with a
// quick probe below, every run, before `against()` is trusted to use it.
const sameCell = (x, y) => x === y || (Number.isNaN(x) && Number.isNaN(y));
if (!sameCell(NaN, NaN) || sameCell(NaN, 5) || sameCell(5, NaN) || !sameCell(5, 5) || sameCell(5, 6)) {
  throw new Error('sameCell probe failed: NaN-aware equality is broken (NaN must equal NaN, and differ from any number)');
}
// Each outline() line is "filmId x,y x,y …"; compare it coordinate-by-coordinate with sameCell so a degenerate NaN
// never masks (or is masked by) a real difference elsewhere in the same line. Every other key compares as exact text.
const sameLine = (key, a, b) => {
  if (!key.endsWith(' outline') || a === b) return a === b;
  if (a === undefined || b === undefined) return false;
  const [filmA, ...ptsA] = a.split(' '), [filmB, ...ptsB] = b.split(' ');
  if (filmA !== filmB || ptsA.length !== ptsB.length) return false;
  return ptsA.every((tok, i) => { const [ax, ay] = tok.split(',').map(Number), [bx, by] = ptsB[i].split(',').map(Number);
    return sameCell(ax, bx) && sameCell(ay, by); });
};
// Owner C1, addendum 2 J (19 Oct 2026), plan 2026-10-19-norms-auto Task 7: 'ideal', 'SD borrowed' and 'assumed
// scale' left every Measurements/Change-table row's norm cell, unconditionally — the golden was captured from
// main, which predates that change, so its stored text still carries these three literal badge words (rendered
// with no separating space, e.g. "…82.0 ± 3.3°idealSD borrowedAI"). This is the one, deliberate, words-only
// divergence from main this file's checks are allowed to see (B0's `against()` AND every direct `gold.snap[...]`
// comparison below) — stripped from the loaded golden itself, once, so a real regression (a value, a different
// badge, a missing AI tag) still shows everywhere else unchanged. Induced-failure control: with this strip
// removed, B0 and every direct `gold.snap` check fail (every Steiner/Downs row that was ideal and/or SD-borrowed
// differs) — confirmed, then restored.
// Review M-2 (fix round 1, 24 Oct 2026): a bare `replaceAll` over any string is not badge-span-aware — it would
// silently over-strip if a future label or free-text field ever contained one of these three words as prose. A
// textContent capture (table()/measures()) cannot tell "this is a badge span" from "this is a sentence" after the
// fact, so instead of trusting position we verify it: every badge Inspector/CompareTable can render is one of
// BADGE_WORDS (packages/analyses/src/norms/flags.ts's FLAG_WORDS[...].badge, duplicated here — keep in sync if a
// badge's word changes) followed, with no separator, only by more badge words and then optionally the "AI" tag.
// `assertBadgeRun` parses the tail from the first hit against exactly that grammar and throws if any of it is
// anything else (i.e. prose) — so a collision with an unrelated field fails loudly instead of being stripped
// silently.
const BADGE_WORDS = ['website value', 'close', 'read once', 'other age', 'sexes pooled', 'user norm', 'via', 'SD from another paper',
  'true size', 'assumed scale', 'SD borrowed', 'ideal', 'age-interpolated', "other sex's values", 'average of male and female', 'age not entered, no adult row',
  'age not entered', 'SD from another age', 'SD from both sexes', 'SD row measured differently', 'SD at true size', 'film date missing', 'chosen by you', 'Auto'];
const BADGE_RUN_RE = new RegExp(`^(?:${BADGE_WORDS.slice().sort((a, b) => b.length - a.length).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})*(?:AI)?$`);
const HIDDEN_WORDS = ['ideal', 'SD borrowed', 'assumed scale'];
const assertBadgeRun = (s) => {
  const first = Math.min(...HIDDEN_WORDS.map((w) => s.indexOf(w)).filter((i) => i >= 0));
  if (!Number.isFinite(first)) return;
  const tail = s.slice(first);
  if (!BADGE_RUN_RE.test(tail)) throw new Error(`stripHiddenBadges: "${tail}" (from "${s}") is not a pure badge run — refusing to strip a possible false match`);
};
const stripHiddenBadges = (v) => {
  if (typeof v === 'string') { assertBadgeRun(v); return v.replaceAll('ideal', '').replaceAll('SD borrowed', '').replaceAll('assumed scale', ''); }
  if (Array.isArray(v)) return v.map(stripHiddenBadges);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, k.endsWith('outline') ? x : stripHiddenBadges(x)]));
  return v;
};

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = []; page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !(m.location().url || '').endsWith('/favicon.ico')) errors.push(m.text()); });
  await page.addInitScript(({ png }) => {
    const load = () => JSON.parse(localStorage.getItem('fakeLib'));
    const store = (db) => localStorage.setItem('fakeLib', JSON.stringify(db));
    // The library's rule (ceph-store fits.rs `together`, the same as Library::series): same name key, not unnamed,
    // dates of birth equal or either blank, the reference not in Recently deleted.
    const together = (a, b) => !!a && !!b && !b.deletedAt && !a.patientKey.startsWith('~') && a.patientKey === b.patientKey
      && (a.dateOfBirth === b.dateOfBirth || !a.dateOfBirth || !b.dateOfBirth);
    const fitOf = (db, id) => { const f = db.fits[id], r = f && db.cases[f.refCaseId];
      return f && together(db.cases[id], r) ? { ...f, refTimepoint: r.timepoint, refSpacingMm: r.spacingMm } : null; };
    let cb = 0;
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
      transformCallback: () => ++cb,
      convertFileSrc: () => 'data:image/png;base64,' + png,
      invoke: async (cmd, a = {}) => {
        const db = load();
        if (/^library_(save|clear|set)_fit/.test(cmd)) (window.__fitCalls ||= []).push([cmd, structuredClone(a)]);
        switch (cmd) {
          case 'model_status': return { loaded: true, modelId: 'SYNTHETIC-stub', searched: [], error: null };
          case 'plugin:event|listen': return 1;
          case 'plugin:dialog|message': return 'Yes';        // ask() goes through 'message' (e2e10's finding)
          case 'library_list': return Object.values(db.cases).filter((c) => !!c.deletedAt === a.deleted).map((c) => ({ id: c.id, patientName: c.patientName,
            timepoint: c.timepoint, takenOn: c.takenOn, createdAt: c.createdAt, updatedAt: c.updatedAt, thumbPath: '/t.jpg', orientation: c.orientation,
            landmarks: c.landmarks.length, unverified: c.landmarks.length, verifiedAt: c.verifiedAt, deletedAt: c.deletedAt, patientKey: c.patientKey,
            dateOfBirth: c.dateOfBirth, identityChecked: true, libraryId: null, formerLibraryIds: [], printedPatientId: null }));
          case 'library_open': { const c = db.cases[a.caseId];
            return { ...c, image: { sha256: 'x', ext: 'png', width: 1200, height: 1400, originalName: 'SYNTHETIC.png', path: c.path }, fit: fitOf(db, a.caseId) }; }
          case 'library_save': { const c = db.cases[a.edit.id]; Object.assign(c, { landmarks: a.edit.landmarks, orientation: a.edit.orientation, display: a.edit.display });
            store(db); return { updatedAt: c.updatedAt, verifiedAt: c.verifiedAt }; }
          case 'library_series': { const me = db.cases[a.caseId];
            return Object.values(db.cases).filter((c) => !c.deletedAt && (c.id === me.id || (!me.patientKey.startsWith('~') && c.patientKey === me.patientKey
              && (c.dateOfBirth === me.dateOfBirth || !c.dateOfBirth || !me.dateOfBirth))))
              .map((c) => ({ id: c.id, timepoint: c.timepoint, takenOn: c.takenOn, takenOnSource: c.takenOnSource, createdAt: c.createdAt, stage: c.stage,
                inSeries: c.inSeries, nameOnly: c.id !== me.id && (!c.dateOfBirth || !me.dateOfBirth),
                fitRef: fitOf(db, c.id)?.refCaseId ?? null, calibrated: c.spacingMm !== null })); }
          // Fix round 1, review I-1: a patient-detail edit can move a film off its fit (the store's `fits::prune`,
          // D-e), clearing a switched-on film's sign-off the same way calibrating does.
          case 'library_set_meta': { const c = db.cases[a.caseId];
            Object.assign(c, { patientName: a.meta.patientName, patientKey: a.meta.patientName.trim().toLowerCase(),
              timepoint: a.meta.timepoint, takenOn: a.meta.takenOn, dateOfBirth: a.meta.dateOfBirth, scanId: a.meta.scanId });
            for (const [id, f] of Object.entries(db.fits)) if (!together(db.cases[id], db.cases[f.refCaseId])) { if (f.useOwn) db.cases[id].verifiedAt = null; delete db.fits[id]; }
            store(db); return null; }
          // Fix round 1, review M-4: a calibration turns this film's own "Use the scale from the fit" off (a ruler
          // always wins, as `set_fit_own` already refuses a ruler film) — same rule as `crates/ceph-store`'s.
          case 'library_calibrate': { const c = db.cases[a.caseId], px = Math.hypot(a.p2[0] - a.p1[0], a.p2[1] - a.p1[1]);
            if (!(px >= 20)) throw `the marks are ${px.toFixed(1)} px apart; pick two ruler marks at least 20 px apart`;
            c.spacingMm = a.mm / px; c.verifiedAt = null; c.verifiedBy = null;
            if (db.fits[a.caseId]) db.fits[a.caseId].useOwn = false;
            store(db); return c.spacingMm; }
          case 'library_set_stage': db.cases[a.caseId].stage = a.stage; store(db); return null;
          case 'library_set_in_series': db.cases[a.caseId].inSeries = a.on; store(db); return null;
          case 'library_save_fit': { if (db.failFit) throw 'SYNTHETIC write failed';
            db.fits[a.caseId] = { ...a.fit, useOwn: db.fits[a.caseId]?.useOwn ?? false, savedBy: 'SYNTHETIC', savedAt: 'x' }; store(db); return null; }
          case 'library_clear_fit': { if (db.fits[a.caseId]?.useOwn) db.cases[a.caseId].verifiedAt = null; delete db.fits[a.caseId]; store(db); return null; }
          case 'library_set_fit_own': { if (db.failOwn) { delete db.failOwn; store(db); throw 'SYNTHETIC switch failed'; }   // a one-off failure (Task 10 edge case)
            const f = db.fits[a.caseId]; if (!f) throw 'this film has no fit';
            if (f.useOwn !== a.on) { f.useOwn = a.on; db.cases[a.caseId].verifiedAt = null; } store(db); return null; }
          case 'library_delete': { db.cases[a.caseId].deletedAt = '2026-10-18T00:00:00Z';
            for (const [id, f] of Object.entries(db.fits)) if (!together(db.cases[id], db.cases[f.refCaseId])) delete db.fits[id];
            store(db); return null; }
          case 'library_ghosts': return [];
          case 'library_label_text': return { lines: [], suggestions: [] };
          case 'settings_get': return a.key === 'betaNoticeSeen' ? '1' : (db.settings[a.key] ?? null);
          case 'settings_set': db.settings[a.key] = a.value; store(db); return null;
          default: return null;
        }
      },
    };
  }, { png });

  const reseed = (mutate) => page.evaluate(({ s, m }) => { const db = JSON.parse(JSON.stringify(s)); if (m) new Function('db', m)(db);
    localStorage.setItem('fakeLib', JSON.stringify(db)); }, { s: seed, m: mutate ? `(${mutate})(db)` : '' });
  const back = async () => {
    if (await page.getByRole('button', { name: '‹ Tracing' }).count()) await page.getByRole('button', { name: '‹ Tracing' }).click();
    await page.getByRole('button', { name: '‹ Library' }).click(); await page.waitForSelector('.library');
    await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
  };
  const openFilm = async (name, tp) => { await page.getByRole('button', { name: `Open ${name} ${tp}`, exact: true }).click(); await page.waitForSelector('g.landmark[data-id="S"]'); };
  // The Inspector switches to the Change tab one render after the overlay draws: wait for the table.
  const changeShown = () => page.waitForFunction(() => [...document.querySelectorAll('.inspector table.measures thead th')].some((th) => th.textContent === 'Change'));
  // `n` is the expected drawn g.compare count (0 when the open film cannot align to any other, e.g. g4 missing N) —
  // the Change tab still appears whenever ≥2 films are ticked in the series, independent of draws, so wait for it
  // unconditionally (fix round 1, I1: toSup(0) must not skip changeShown and read a stale/empty table).
  const toSup = async (n) => { await page.getByRole('button', { name: 'Superimposition ›' }).click(); await page.waitForSelector('.series-key li');
    await page.waitForFunction((k) => document.querySelectorAll('svg.overlay g.compare').length === k, n); await changeShown(); };
  const table = () => page.locator('.inspector table.measures tr').evaluateAll((rs) => rs.map((r) => [...r.children].map((c) => c.textContent.trim()).join(' ¦ ')));
  // Each drawn comparison point, relative to the open film's S in units of its S–N on screen, so zoom and panel width
  // cannot move it: the cross paths after a film's three outline paths are `M x−4 y H x+4 M x y−4 V y+4`.
  const outline = () => page.evaluate(() => {
    // Fix round 1 (I1 coverage): when the OPEN film itself is missing N (g4), there is nothing to normalise
    // against and nothing drawn either (alignOnSN(cur, …) returns null for every `other` before `cur.N` is even
    // read) — return [] before touching the open film's own S/N, which would throw on a film with no N rendered.
    const groups = [...document.querySelectorAll('svg.overlay g.compare')];
    if (!groups.length) return [];
    const own = (id) => { const b = document.querySelector(`g.landmark[data-id="${id}"] circle, g.landmark[data-id="${id}"] rect`).getBBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const S = own('S'), N = own('N'), L = Math.hypot(N.x - S.x, N.y - S.y);
    return groups.map((g) => `${g.getAttribute('data-film')} ` + [...g.querySelectorAll('path')].slice(3).map((p) => {
      const n = (p.getAttribute('d').match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/g) || []).map(Number);
      return `${((n[3] - S.x) / L).toFixed(4)},${((n[1] - S.y) / L).toFixed(4)}`; }).join(' ')).sort();
  });
  const measures = async () => { await page.getByRole('tab', { name: 'Measurements' }).click(); await page.waitForSelector('.inspector table.measures tbody tr'); return table(); };
  // One film's line in the comparison key, by its label ("T2 · …"): text elsewhere in other lines (e.g. "scale it to T1") never matches.
  const keyLine = (tp) => page.locator('.series-key li').filter({ has: page.locator('.series-label', { hasText: new RegExp('^' + tp + ' ') }) });
  const FILMS = [['Demo Rescale', 'T1', 'g1'], ['Demo Rescale', 'T2', 'g2'], ['Demo Rescale', 'T3', 'g3'], ['Demo Rescale', 'T4', 'g4'],
    ['Demo Assumed', 'T1', 'h1'], ['Demo Assumed', 'T2', 'h2'], ['Demo Single', 'T1', 's1'], ['Name needed', 'T1', 'u1']];
  async function snapshotAll() {
    const out = {};
    await openFilm('Demo Rescale', 'T1'); await toSup(2);
    const sel = page.locator('select[aria-label="Change between"]');
    for (const label of await sel.locator('option').allInnerTexts()) { await sel.selectOption({ label }); out[`sup g1 ${label}`] = await table(); }
    out['sup g1 outline'] = await outline(); await back();
    await openFilm('Demo Rescale', 'T2'); await toSup(2); out['sup g2 table'] = await table(); out['sup g2 outline'] = await outline(); await back();
    // Fix round 1, Important 1 (review): every film that HAS a series partner also gets its own Superimposition
    // page snapshotted, not only when it is drawn as the "other" film — g3 is the only mirrored, left-facing film
    // in the fixture, and align.ts's `cur` (the OPEN film) is never run through `m()`, so a future regression in
    // the open film's own facing/mirror handling would otherwise never show up anywhere in B0. g4 opens its own
    // page too (0 draws: its own S–N is incomplete, so alignOnSN(cur, …) returns null for every `other`, but its
    // Change table still renders from the ticked films' own values) — and h2, the cheaper second instance of the
    // same class of gap (review Minor 3). s1 and u1 have no series partner, so they have no Superimposition page.
    await openFilm('Demo Rescale', 'T3'); await toSup(2); out['sup g3 table'] = await table(); out['sup g3 outline'] = await outline(); await back();
    await openFilm('Demo Rescale', 'T4'); await toSup(0); out['sup g4 table'] = await table(); out['sup g4 outline'] = await outline(); await back();
    await openFilm('Demo Assumed', 'T1'); await toSup(1); out['sup h1 table'] = await table(); out['sup h1 outline'] = await outline(); await back();
    await openFilm('Demo Assumed', 'T2'); await toSup(1); out['sup h2 table'] = await table(); out['sup h2 outline'] = await outline(); await back();
    for (const [name, tp, key] of FILMS) { await openFilm(name, tp); out[`measures ${key}`] = await measures(); await back(); }
    return out;
  }
  const goldRaw = fs.existsSync(GOLDEN) ? JSON.parse(fs.readFileSync(GOLDEN, 'utf8')) : null;
  const gold = goldRaw ? { ...goldRaw, snap: stripHiddenBadges(goldRaw.snap) } : null;
  // Compares this build's snapshot with the golden, row by row; an un-fitted film's rows only when `only` is given.
  const against = (snap, only) => { const diffs = []; let n = 0;
    for (const k of new Set([...Object.keys(gold?.snap ?? {}), ...Object.keys(snap)])) {
      if (only && !only(k)) continue;
      const a = gold?.snap[k] ?? [], b = snap[k] ?? [];
      for (let i = 0; i < Math.max(a.length, b.length); i++) { n++; if (!sameLine(k, a[i], b[i])) diffs.push(`${k} #${i}: main ${JSON.stringify(a[i])} / now ${JSON.stringify(b[i])}`); }
    }
    return { n, diffs }; };

  await page.goto((process.env.E2E_URL || 'http://localhost:4173/'));
  await reseed(); await page.reload(); await page.waitForSelector('.library');
  await page.locator('.lib-nav button', { hasText: 'All cases' }).click();

  // B0: no fit anywhere — the screen equals main's.
  const snap = await snapshotAll();
  const count = Object.values(snap).reduce((n, v) => n + v.length, 0);
  if (process.env.G_CAPTURE) {
    fs.writeFileSync(process.env.G_CAPTURE, JSON.stringify({ capturedFrom: process.env.G_CAPTURE_FROM || 'unknown', count, snap }, null, 1));
    ok(`B0. captured ${count} rows from this build into ${process.env.G_CAPTURE}`, count >= 100, String(count));
  } else {
    const { n, diffs } = against(snap);
    // Fix round 1, Important 2 / Minor 2 (review): the FAIL line keeps its 5-line human sample, but also states
    // the TOTAL diff count, and every differing key is written out in full (not just the first 5) so a real
    // regression — or a positive control — can be read in full without adding temporary instrumentation.
    fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
    fs.writeFileSync(path.join(__dirname, 'out', 'e2e15-diffs.log'), diffs.length ? diffs.join('\n') + '\n' : '(no diffs)\n');
    ok(`B0. with no fit, every Change-table cell, Measurements cell and comparison point equals main ${gold?.capturedFrom} (${n} rows compared, golden ${gold?.count}, ${diffs.length} differ)`,
      !!gold && gold.count >= 100 && count === gold.count && n >= gold.count && diffs.length === 0,
      gold ? diffs.slice(0, 5).join(' || ') + (diffs.length > 5 ? ` … see out/e2e15-diffs.log for all ${diffs.length}` : '') : 'no golden file: ' + GOLDEN);
  }

  if (!process.env.G_CAPTURE) {      // a capture run stops after B0 (on main there are no fits to check)
    // Task 6 (request G): saved fits — T2 (no ruler) on T1 (ruler) by S–N; for G3, h2 on h1 (neither has a ruler).
    const FIT_G2 = { refCaseId: 'g1', refKind: 'sn', refPoints: [[250, 300], [950, 200]], filmPoints: [[270, 310], [942, 214]], mirror: false,
      scale: 1 / 0.96, rotation: 0, dx: 0, dy: 0, useOwn: false, savedBy: 'SYNTHETIC', savedAt: 'x' };
    const FIT_H2 = { refCaseId: 'h1', refKind: 'sn', refPoints: [[250, 300], [950, 200]], filmPoints: [[250, 300], [929, 203]], mirror: false,
      scale: 1 / 0.97, rotation: 0, dx: 0, dy: 0, useOwn: false, savedBy: 'SYNTHETIC', savedAt: 'x' };
    const restart = async (fits) => { await reseed(`(db) => { db.fits = ${JSON.stringify(fits)}; }`); await page.reload();
      await page.waitForSelector('.library'); await page.locator('.lib-nav button', { hasText: 'All cases' }).click(); };
    const heads = () => page.locator('.inspector table.measures thead th').allInnerTexts();
    const cell = (r, i) => r.split(' ¦ ')[i];
    const pick = (arr, id) => arr.find((s) => s.startsWith(id + ' '));
    const xy = (entry, n) => entry.split(' ')[1 + n].split(',').map(Number);
    if (gold) {
      await restart({ g2: FIT_G2, h2: FIT_H2 });
      await openFilm('Demo Rescale', 'T1'); await toSup(2);
      const h1 = await heads();
      ok('C1. T2’s column, and only T2’s, is marked “scaled to T1 on S–N (×1.042)”', h1[2].includes('scaled to T1 on S–N (×1.042)')
        && [1, 3, 4].every((i) => !h1[i].includes('scaled')), h1.join(' | '));
      const sel = page.locator('select[aria-label="Change between"]');
      let mm = 0, shown = 0, same = 0, n = 0, k = 0, m = 0, withT2 = 0, withoutT2 = 0;   // the last two: starred Change cells
      for (const label of await sel.locator('option').allInnerTexts()) {
        await sel.selectOption({ label }); const now = await table(), was = gold.snap[`sup g1 ${label}`];
        now.forEach((r, j) => { if (j === 0) return; n++;
          if (cell(was[j], 2) === 'calibrate to show') { mm++; if (cell(r, 2) !== 'calibrate to show' && cell(r, 2).endsWith('†')) shown++; }
          else { m++; if (cell(r, 2) === cell(was[j], 2)) k++; }      // pre-flight ruling (b): T2's angles and ratios
          if ([0, 1, 3, 4].every((i) => cell(r, i) === cell(was[j], i))) same++;
          if (cell(r, 5).endsWith('†')) { if (label.includes('T2')) withT2++; else withoutT2++; } });
      }
      ok(`C1. every mm value of T2 is shown, marked † (${shown} of ${mm})`, mm > 0 && shown === mm);
      ok(`C2. T1, T3 and T4 read exactly as on main while T2 is fitted (${same} of ${n} rows)`, n > 0 && same === n);
      ok(`C2. T2's angles and ratios read exactly as on main (${k} of ${m})`, m > 0 && k === m);
      // Task 6 edge case: a Change pair not involving the fitted T2 stars nothing (T1 → T3, T1 → T4, T3 → T4); the pairs
      // with T2 must star some, so the check is seen able to fire.
      ok(`C2. a change between films other than T2 is never marked † (${withoutT2} marked; ${withT2} in pairs with T2)`, withT2 > 0 && withoutT2 === 0);
      const o = await outline(), og = gold.snap['sup g1 outline'];
      ok('C3. T3’s outline is drawn exactly as on main; T2’s moved (the fit is used)', !!pick(o, 'g3') && pick(o, 'g3') === pick(og, 'g3') && !!pick(o, 'g2') && pick(o, 'g2') !== pick(og, 'g2'));
      const [s2, n2] = [xy(pick(o, 'g2'), 0), xy(pick(o, 'g2'), 1)], L = Math.hypot(700, 100);
      ok('C3. T2 lands with its S on T1’s S and its N on T1’s N', Math.hypot(s2[0], s2[1]) < 1e-3 && Math.hypot(n2[0] - 700 / L, n2[1] + 100 / L) < 1e-3, `${s2} ${n2}`);
      const notes = await page.locator('.inspector .fit-note').allInnerTexts();
      ok('C4. the note under the table says what the † means, naming the film (fix round 2)', notes.length === 1 && notes[0] === '† T2 scaled to T1 on S–N (×1.042)', notes.join(' | '));
      ok('C4. the comparison key says T2 is scaled', (await keyLine('T2').innerText()).includes('Scaled to T1 on S–N (×1.042)'));
      await back();
      await openFilm('Demo Rescale', 'T2');
      const m5 = await measures(), sev = m5.filter((r) => / \*+ ¦/.test(r)).length, sevMain = gold.snap['measures g2'].filter((r) => / \*+ ¦/.test(r)).length;
      ok('C5. T2’s own Measurements are unchanged while “Use the scale from the fit” is off (G2)', JSON.stringify(m5) === JSON.stringify(gold.snap['measures g2']));
      ok(`C5. severity stars still render on the Measurements tab, and no † there (${sev} star cells, main ${sevMain})`, sevMain > 0 && sev === sevMain && !m5.some((r) => r.includes('†')));
      await toSup(2);
      const o6 = await outline(), [s1, n1] = [xy(pick(o6, 'g1'), 0), xy(pick(o6, 'g1'), 1)], L2 = Math.hypot(672, 96);
      ok('C6. with the fitted T2 open, T1 lands by the fit undone: its S and N on T2’s', Math.hypot(s1[0], s1[1]) < 1e-3 && Math.hypot(n1[0] - 672 / L2, n1[1] + 96 / L2) < 1e-3, `${s1} ${n1}`);
      ok('C6. the open T2’s own column is marked too', (await heads())[2].includes('scaled to T1 on S–N (×1.042)'));
      await back();
      await openFilm('Demo Assumed', 'T1'); await toSup(1);
      const h7 = await heads(), t7 = await table();
      ok('C7. G3: the reference with no ruler is marked “assumed scale”; the fitted film “…, assumed scale”', h7[1].includes('assumed scale') && !h7[1].includes('scaled to')
        && h7[2].includes('scaled to T1 on S–N (×1.031), assumed scale'), h7.join(' | '));
      // Fix round 2: † means exactly "scaled by a fit": T2's mm carry it, the assumed-scale reference T1's do not.
      const mm7 = t7.slice(1).filter((r) => cell(r, 2).endsWith('†')), t1dag = mm7.filter((r) => cell(r, 1).endsWith('†')).length;
      ok(`C7. both films' mm are shown (D-b); T2's marked †, T1's (assumed scale, not fitted) not (${mm7.length} mm rows, ${t1dag} T1 cells marked)`,
        mm7.length > 0 && t1dag === 0 && !t7.some((r) => r.includes('calibrate to show')), t7.slice(0, 3).join(' || '));
      const n7 = await page.locator('.inspector .fit-note').allInnerTexts();
      ok('C7. the note names the fitted film and says assumed scale', n7.length === 1 && n7[0] === '† T2 scaled to T1 on S–N (×1.031), assumed scale', n7.join(' | '));
      await back();
      await page.getByRole('button', { name: 'Delete Demo Rescale T1', exact: true }).click();
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem('fakeLib')).fits.g2);
      await openFilm('Demo Rescale', 'T2'); await toSup(1);
      const t8 = await table();
      ok('C8. deleting the reference (T1) clears T2’s fit: no mark, its mm hidden again', !t8.some((r) => r.includes('scaled to')) && t8.some((r) => r.includes('calibrate to show')));
      await back();
    }
    // Task 7: the panel. Owner D-f (18 Oct, binding; supersedes the plan): Reset goes back to the last SAVED fit and
    // writes nothing; "Remove fit" (shown only while a fit is saved) removes it through the clear-fit command; ⌘Z puts
    // it back.
    const fitCalls = () => page.evaluate(() => window.__fitCalls || []);
    const fitRow = (id) => page.evaluate((k) => JSON.parse(localStorage.getItem('fakeLib')).fits[k] ?? null, id);
    const canvasHash = () => page.evaluate(() => { const c = document.querySelector('.stage canvas'), g = c.getContext('2d');
      const d = g.getImageData(0, 0, c.width, c.height).data; let h = 0;
      for (let y = 15; y < c.height; y += 23) for (let x = 15; x < c.width; x += 29) { const i = (y * c.width + x) * 4; h = (h * 31 + d[i] + 3 * d[i + 1] + 7 * d[i + 2]) % 1000000007; }
      return h; });
    const size = () => page.locator('.fit-panel input[aria-label="Size"]').inputValue();
    const sizeIs = (v) => page.waitForFunction((x) => document.querySelector('.fit-panel input[aria-label="Size"]')?.value === x, v, { timeout: 5000 }).then(() => true, () => false);
    const adjust = async (tp) => { await keyLine(tp).getByRole('button', { name: 'Adjust fit…' }).click();
      await page.waitForSelector('.fit-panel'); await page.waitForFunction(() => document.querySelector('.fit-panel input[aria-label="Size"]')?.value); };
    const larger = async (n) => { for (let i = 0; i < n; i++) await panelBtn('Larger').click(); };
    // The panel's own buttons: the Enhance section has a "Reset" too.
    const panelBtn = (name) => page.locator('.fit-panel').getByRole('button', { name, exact: true });
    const removeBtn = () => panelBtn('Remove fit');
    {
      await restart({});
      await openFilm('Demo Rescale', 'T2'); await toSup(2);
      await adjust('T2');
      ok('P1. "Adjust fit…" on T2 opens T1 as the base, with the panel “Fit T2 to T1”', (await page.locator('.fit-panel h3').innerText()) === 'Fit T2 to T1'
        && (await page.locator('header.toolbar').innerText()).includes('T1'));
      ok('P2. it starts at the S–N superimposition: size ×1.042', (await size()) === '1.042', await size());
      ok('P2. with nothing saved there is no "Remove fit"', (await removeBtn().count()) === 0);
      await page.waitForTimeout(300); const both = await canvasHash();
      await page.locator('.fit-panel [role="radio"]', { hasText: 'T1' }).click(); await page.waitForTimeout(300); const onlyRef = await canvasHash();
      await page.locator('.fit-panel [role="radio"]', { hasText: 'T2' }).click(); await page.waitForTimeout(300); const onlyFilm = await canvasHash();
      await page.locator('.fit-panel [role="radio"]', { hasText: 'Both' }).click(); await page.waitForTimeout(300);
      ok('P3. the film is drawn over the reference: Both, T1 alone and T2 alone are three different pictures', new Set([both, onlyRef, onlyFilm]).size === 3, `${both} ${onlyRef} ${onlyFilm}`);
      await larger(1);
      ok('P4. + makes it ×1.043', (await size()) === '1.043', await size());
      await panelBtn('Save fit').click(); await page.waitForSelector('.fit-panel', { state: 'detached' });
      const saved = (await fitCalls()).filter(([c]) => c === 'library_save_fit').pop();
      ok('P4. Save fit stores T2’s fit to T1 by S–N at ×1.043', !!saved && saved[1].caseId === 'g2' && saved[1].fit.refCaseId === 'g1' && saved[1].fit.refKind === 'sn'
        && Math.abs(saved[1].fit.scale - 1.043) < 1e-12, JSON.stringify(saved));
      await changeShown();
      ok('P4. and the Change table shows it at once', (await heads()).some((h) => h.includes('scaled to T1 on S–N (×1.043)')), (await heads()).join(' | '));
      await adjust('T2');
      ok('P5. closed and reopened, the panel shows the saved size', (await size()) === '1.043', await size());
      // D-f: Reset after a save goes back to the saved placement, keeps the row, and writes nothing.
      const row0 = await fitRow('g2'), calls0 = (await fitCalls()).length;
      await larger(2);
      ok('P6. while adjusting, the Change table follows the unsaved size (×1.045)', (await sizeIs('1.045')) && (await heads()).some((h) => h.includes('(×1.045)')), (await heads()).join(' | '));
      await panelBtn('Reset').click();
      ok('P6. Reset after a save goes back to the saved fit (×1.043), discarding the unsaved change', await sizeIs('1.043'), await size());
      ok('P6. Reset writes nothing and keeps the saved fit', (await fitCalls()).length === calls0 && !!row0 && JSON.stringify(await fitRow('g2')) === JSON.stringify(row0),
        `${(await fitCalls()).length - calls0} calls; ${JSON.stringify(await fitRow('g2'))}`);
      // D-f: "Remove fit" deletes the saved fit, says so, and starts again from S–N.
      ok('P6. "Remove fit" is shown while a fit is saved', (await removeBtn().count()) === 1);
      await removeBtn().click();
      // A wait that times out must not stop the run: the check below then FAILs by name.
      await page.waitForFunction(() => (window.__fitCalls || []).some(([c]) => c === 'library_clear_fit'), null, { timeout: 5000 }).catch(() => {});
      ok('P6. Remove fit removes the saved fit through the clear-fit command, and says so', (await fitRow('g2')) === null
        && (await page.locator('.fit-panel [role="status"]').innerText()) === "T2's fit was removed: it is back on the plain S–N superimposition at its own scale.");
      ok('P6. after Remove fit it starts again from S–N (×1.042), and "Remove fit" is gone', (await sizeIs('1.042')) && (await removeBtn().count()) === 0, await size());
      await larger(1); await sizeIs('1.043');
      await panelBtn('Reset').click();
      ok('P6. with nothing saved, Reset goes back to the S–N start (×1.042)', await sizeIs('1.042'), await size());
      // D-f: ⌘Z puts the removed fit back, exactly as it was saved.
      const saves0 = (await fitCalls()).filter(([c]) => c === 'library_save_fit').length;
      await page.keyboard.press('Meta+z');
      await page.waitForFunction((n) => (window.__fitCalls || []).filter(([c]) => c === 'library_save_fit').length > n, saves0, { timeout: 5000 }).catch(() => {});
      const row1 = await fitRow('g2');
      ok('P6. ⌘Z after Remove fit puts the saved fit back exactly', !!row1 && JSON.stringify(row1) === JSON.stringify(row0), JSON.stringify(row1));
      ok('P6. … and the panel is back on it (×1.043), with "Remove fit" shown again', (await sizeIs('1.043')) && (await removeBtn().count()) === 1, await size());
      await larger(3);
      const before = (await fitCalls()).length;
      ok('P7. while adjusting, the table shows the unsaved ×1.046', (await sizeIs('1.046')) && (await heads()).some((h) => h.includes('(×1.046)')), (await heads()).join(' | '));
      await panelBtn('Cancel').click(); await page.waitForSelector('.fit-panel', { state: 'detached' });
      ok('P7. Cancel saves nothing; the table is back on the saved fit (×1.043)', (await fitCalls()).length === before
        && (await heads()).some((h) => h.includes('(×1.043)')) && !(await heads()).some((h) => h.includes('(×1.046)')), (await heads()).join(' | '));
      await adjust('T3');
      ok('P8. a ruler-calibrated film’s size is fixed at its true size (G2): ×1.200, locked, and says why',
        (await size()) === '1.200' && await page.locator('.fit-panel input[aria-label="Size"]').isDisabled()
        && (await page.locator('.fit-panel').innerText()).includes('T3 was calibrated from its ruler, so its size is fixed. You can still move and turn it.'));
      await panelBtn('Cancel').click();
      await adjust('T4');
      ok('P10. a film with no N cannot start from S–N: it says so and Save fit is off', await panelBtn('Save fit').isDisabled()
        && (await page.locator('.fit-panel').innerText()).includes('Place S and N on both films to start from S–N, or choose two points you pick.'));
      await panelBtn('Cancel').click();
      await page.evaluate(() => { const db = JSON.parse(localStorage.getItem('fakeLib')); db.failFit = true; localStorage.setItem('fakeLib', JSON.stringify(db)); });
      await adjust('T2'); await panelBtn('Save fit').click();
      await page.waitForSelector('.fit-panel .error');
      ok('P9. a save that fails says why and keeps the panel open', (await page.locator('.fit-panel .error').innerText()).includes('SYNTHETIC write failed'));
      await page.locator('.fit-panel input[aria-label="Size"]').fill('9'); await page.locator('.fit-panel input[aria-label="Size"]').press('Enter');
      ok('P9. a size it cannot use is refused, in words', (await page.locator('.fit-panel').innerText()).includes('The size must be between ×0.200 and ×5.000.'));
      await page.locator('.fit-panel input[aria-label="Size"]').fill('abc'); await page.locator('.fit-panel input[aria-label="Size"]').press('Enter');
      ok('P9. a size typed as text is refused too, and the size is unchanged', (await page.locator('.fit-panel').innerText()).includes('The size must be between ×0.200 and ×5.000.')
        && (await size()) === '1.043', await size());
      await page.getByRole('button', { name: '‹ Tracing' }).click();
      await page.waitForFunction(() => !document.querySelector('.fit-panel'));
      ok('P11. leaving for the tracing page closes the panel', (await page.locator('.fit-panel').count()) === 0);
      await back();
    }
    // Task 8: fine-tune on the film, and two points you pick.
    const centreOf = async (sel) => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
    const zoom = () => page.evaluate(() => {                      // screen px per image px, from T1's own S–N (image length √(700² + 100²))
      const c = (id) => { const b = document.querySelector(`g.landmark[data-id="${id}"] circle, g.landmark[data-id="${id}"] rect`).getBBox(); return [b.x + b.width / 2, b.y + b.height / 2]; };
      const [s, n] = [c('S'), c('N')]; return Math.hypot(n[0] - s[0], n[1] - s[1]) / Math.hypot(700, 100); });
    const lastSave = async () => (await fitCalls()).filter(([c]) => c === 'library_save_fit').pop()?.[1].fit;
    {
      await restart({});
      await openFilm('Demo Rescale', 'T1'); await toSup(2);
      await adjust('T2');
      const k = await zoom(), st = await page.locator('.stage').boundingBox(), cx = st.x + st.width / 2, cy = st.y + st.height / 2;
      await page.mouse.move(cx, cy); await page.mouse.down(); await page.mouse.move(cx + 40, cy + 10, { steps: 5 }); await page.mouse.up();
      await page.keyboard.press('ArrowRight'); await page.keyboard.press('Shift+ArrowDown');
      await page.keyboard.down('Alt');
      await page.mouse.move(cx + 200, cy); await page.mouse.down(); await page.mouse.move(cx + 200, cy + 120, { steps: 5 }); await page.mouse.up();
      await page.keyboard.up('Alt');
      await page.getByRole('button', { name: 'Save fit' }).click(); await page.waitForSelector('.fit-panel', { state: 'detached' });
      const f = await lastSave();
      ok('F1. a drag moves the film, the arrows nudge it 1 px and ⇧ 10 px, ⌥-drag turns it, and the size is untouched',
        !!f && Math.abs(f.dx - (40 / k + 1)) < 0.5 && Math.abs(f.dy - (10 / k + 10)) < 0.5 && Math.abs(f.rotation) > 0.01 && Math.abs(f.scale - 1 / 0.96) < 1e-12,
        JSON.stringify(f) + ` k=${k}`);
      await adjust('T2');
      await page.keyboard.press('ArrowLeft'); await page.keyboard.press('Escape');
      await page.waitForSelector('.fit-panel', { state: 'detached' });
      ok('F2. Esc closes the panel without saving', (await lastSave()).dx === f.dx);
      await adjust('T2');
      await page.locator('.fit-panel [role="radio"]', { hasText: 'Two points you pick' }).click();
      ok('F3. "Two points you pick" asks for a point on T1 first', (await page.locator('.fit-panel').innerText()).includes('Click a stable point on T1 (for example the front wall of sella turcica).'));
      await page.mouse.click(...Object.values(await centreOf('g.landmark[data-id="A"] circle, g.landmark[data-id="A"] rect')));
      ok('F3. the picked point is marked on the film', (await page.locator('circle.fit-mark-pt').count()) === 1);
      await page.mouse.click(...Object.values(await centreOf('g.landmark[data-id="Me"] circle, g.landmark[data-id="Me"] rect')));
      ok('F3. then for the same first point on T2', (await page.locator('.fit-panel').innerText()).includes('Click the same first point on T2.'));
      // T2's A and Me where T2 is drawn now: its cross marks (paths after the three outline paths, in landmark order S, N, A, B, Pog, Gn, Me).
      const cross = async (i) => centreOf(`svg.overlay g.compare[data-film="g2"] path >> nth=${3 + i}`);
      await page.mouse.click(...Object.values(await cross(2))); await page.mouse.click(...Object.values(await cross(6)));
      // Clicks land on sub-pixel centres, but allow 0.002 (about 1 image px over A–Me's 556 px) for the browser's rounding.
      ok('F3. four points place T2 so A and Me match: ×1.042 ± 0.002 (T2 is T1 made 4 % smaller)', Math.abs(Number(await size()) - 1 / 0.96) < 0.002, await size());
      await page.getByRole('button', { name: 'Save fit' }).click(); await page.waitForSelector('.fit-panel', { state: 'detached' });
      const g = await lastSave();
      ok('F3. saved as two picked points, on T1’s A and Me (within 3 px)', g.refKind === 'points' && Math.hypot(g.refPoints[0][0] - 970, g.refPoints[0][1] - 600) < 3
        && Math.hypot(g.refPoints[1][0] - 890, g.refPoints[1][1] - 1150) < 3, JSON.stringify(g));
      ok('F3. and the Change table says "on two points"', (await heads()).some((h) => /scaled to T1 on two points \(×1\.04[0-4]\)/.test(h)), (await heads()).join(' | '));
      await adjust('T2');
      ok('F4. reopened, it is still "Two points you pick"', (await page.locator('.fit-panel [role="radio"][aria-checked="true"]').allInnerTexts()).includes('Two points you pick'));
      await page.locator('.fit-panel [role="radio"]', { hasText: 'S–N' }).click();
      await page.locator('.fit-panel [role="radio"]', { hasText: 'Two points you pick' }).click();
      const a = await centreOf('g.landmark[data-id="A"] circle, g.landmark[data-id="A"] rect');
      for (let i = 0; i < 2; i++) await page.mouse.click(a.x, a.y);
      for (let i = 0; i < 2; i++) await page.mouse.click(...Object.values(await cross(2)));
      ok('F5. the same point twice is refused, in words, and picking starts again', (await page.locator('.fit-panel').innerText()).includes('Pick two points at least 20 px apart on each film, then try again.')
        && (await page.locator('circle.fit-mark-pt').count()) === 0);
      await page.getByRole('button', { name: 'Cancel' }).click();
      await back();
    }
    // Task 9: "not scaled" on both pages, looking the same (owner G1).
    const advice = (scope) => page.locator(`${scope} .scale-advice`);
    {
      await restart({});
      await openFilm('Demo Rescale', 'T1'); await toSup(2);
      const onSup = keyLine('T2').locator('.scale-advice');
      ok('A1. the Superimposition key says T2 is not scaled, with "Calibrate now" and "Scale now"', (await onSup.locator('span').first().innerText())
        === 'T2 is not scaled. Calibrate it from its ruler, or scale it to T1?' && (await onSup.getByRole('button').allInnerTexts()).join('|') === 'Calibrate now|Scale now');
      ok('A1. none on the calibrated T1 and T3; T4 (no ruler) has it too', (await keyLine('T1').locator('.scale-advice').count()) === 0
        && (await keyLine('T3').locator('.scale-advice').count()) === 0 && (await keyLine('T4').locator('.scale-advice').count()) === 1);
      const supHtml = await onSup.evaluate((e) => e.outerHTML);
      await onSup.getByRole('button', { name: 'Calibrate now' }).click();
      await page.waitForSelector('.place-hint >> text=ruler mark');
      ok('A3. "Calibrate now" opens T2 on its tracing page with the ruler tool', (await page.locator('header.toolbar').innerText()).includes('T2')
        && (await page.locator('.place-hint', { hasText: 'Click the first ruler mark' }).count()) === 1);
      await page.keyboard.press('Escape');
      await page.getByRole('tab', { name: 'Measurements' }).click();
      const onTracing = advice('.inspector');
      ok('A2. the tracing page of T2 shows the same advice, made the same way', (await onTracing.count()) === 1 && (await onTracing.evaluate((e) => e.outerHTML)) === supHtml,
        await onTracing.evaluate((e) => e.outerHTML).catch(() => 'none'));
      ok('A2. its Measurements are still what main shows', JSON.stringify(await table()) === JSON.stringify(gold.snap['measures g2']));
      await onTracing.getByRole('button', { name: 'Scale now' }).click();
      await page.waitForSelector('.fit-panel');
      ok('A4. "Scale now" on the tracing page opens the panel on the Superimposition page, T1 as the base',
        (await page.locator('.fit-panel h3').innerText()) === 'Fit T2 to T1' && (await page.locator('header.toolbar').innerText()).includes('T1'));
      await page.getByRole('button', { name: 'Cancel' }).click();
      await back();
      await openFilm('Demo Single', 'T1'); await page.getByRole('tab', { name: 'Measurements' }).click();
      const single = advice('.inspector');
      ok('A5. the patient’s only film: calibrate only; "Scale now" is off and says why', (await single.locator('span').first().innerText()) === 'T1 is not scaled. Calibrate it from its ruler.'
        && await single.getByRole('button', { name: 'Scale now' }).isDisabled() && (await single.innerText()).includes('No other X-ray of this patient to scale it to.'));
      await back();
      await openFilm('Name needed', 'T1'); await page.getByRole('tab', { name: 'Measurements' }).click();
      ok('A6. an unnamed patient: "Name the patient first."', (await advice('.inspector').innerText()).includes('Name the patient first.')
        && await advice('.inspector').getByRole('button', { name: 'Scale now' }).isDisabled());
      await back();
      await restart({ g2: FIT_G2, h2: FIT_H2 });
      await openFilm('Demo Rescale', 'T1'); await toSup(2);
      ok('A7. a fitted film is scaled: no advice on T2, its mark instead', (await keyLine('T2').locator('.scale-advice').count()) === 0);
      await back();
      await openFilm('Demo Rescale', 'T2'); await page.getByRole('tab', { name: 'Measurements' }).click();
      ok('A7. and no "Calibrate now" on its tracing page', (await page.locator('.inspector').getByRole('button', { name: 'Calibrate now' }).count()) === 0);
      await back();
      await openFilm('Demo Assumed', 'T1'); await page.getByRole('tab', { name: 'Measurements' }).click();
      ok('A8. a film another film is fitted to: calibrate only, and which fit to reset', (await advice('.inspector').innerText()).includes('T2 is scaled to this film; remove that fit first.')
        && await advice('.inspector').getByRole('button', { name: 'Scale now' }).isDisabled());
      await back();
    }
    // Task 10: "Use the scale from the fit" (owner G2). Pre-flight rulings: D-c on screen (Tracing verified cleared on
    // and off), the S2 scale-line locator /^Scale /, and S9 (Compare populations says where its mm come from).
    // Carries: a ruler always wins (no switch, a reason, no set-fit-own call); the film's own mm carry †.
    const own = () => page.locator('.inspector .scale-advice');
    const num = (s) => parseFloat(s);
    const verify = async (id) => { await page.evaluate((k) => { const db = JSON.parse(localStorage.getItem('fakeLib'));
      Object.assign(db.cases[k], { verifiedAt: '2026-10-10T00:00:00Z', verifiedBy: 'SYNTHETIC' }); localStorage.setItem('fakeLib', JSON.stringify(db)); }, id);
      await page.reload(); await page.waitForSelector('.library'); await page.locator('.lib-nav button', { hasText: 'All cases' }).click(); };
    const ownCalls = () => page.evaluate(() => (window.__fitCalls || []).filter(([c]) => c === 'library_set_fit_own'));
    const popNote = async () => { await page.getByRole('button', { name: 'Compare populations…' }).click();
      const dlg = page.getByRole('dialog', { name: 'Compare populations' }); await dlg.waitFor();
      const n = await dlg.locator('.fit-note').allInnerTexts(); await dlg.getByRole('button', { name: 'Close' }).click(); return n; };
    {
      await restart({ g2: FIT_G2, h2: FIT_H2, g3: { ...FIT_G2, filmPoints: [[959, 300], [259, 200]], mirror: true, scale: 1.2 } });
      await verify('g2');
      await openFilm('Demo Rescale', 'T2'); await page.getByRole('tab', { name: 'Measurements' }).click();
      // A missing line must FAIL by name, not stop the run on a 30 s timeout.
      const s1 = await own().locator('span').first().innerText({ timeout: 5000 }).catch(() => '(no line)');
      ok('S1. off: T2 keeps its own numbers and says the fit is for comparisons only', s1
        === 'T2 has no ruler. Its fit to T1 is used for comparisons only (scaled to T1 on S–N (×1.042)).'
        && !(await own().locator('input[type=checkbox]').isChecked({ timeout: 5000 }).catch(() => true)) && JSON.stringify(await table()) === JSON.stringify(gold.snap['measures g2']), s1);
      ok('S1. Tracing verified is shown before the switch (D-c set-up)', await page.locator('.verified-note').isVisible());
      await own().getByLabel('Use the scale from the fit').check();
      await page.waitForFunction(() => (window.__fitCalls || []).some(([c, a]) => c === 'library_set_fit_own' && a.on === true));
      await page.waitForFunction(() => ![...document.querySelectorAll('.inspector table.measures td')].some((t) => t.textContent.includes('calibrate to show')));
      const on = await table();
      ok('S2. on: the owner’s sentence, word for word', (await own().locator('span').first().innerText())
        === 'This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1.');
      ok('S2. its mm are shown, its angles unchanged', on.length === gold.snap['measures g2'].length && on.every((r, j) => { const was = gold.snap['measures g2'][j];
        return was.includes('calibrate to show') ? !r.includes('calibrate to show') : r === was; }));
      let dag = 0, mmRows = 0;
      on.forEach((r, j) => { if (gold.snap['measures g2'][j].includes('calibrate to show')) { mmRows++; if (/^-?\d[^¦]*†/.test(cell(r, 1))) dag++; } });
      ok(`S2. every mm value on T2’s own page is marked † (${dag} of ${mmRows}), and nothing else`, mmRows > 0 && dag === mmRows && on.filter((r) => r.includes('†')).length === mmRows,
        on.filter((r) => r.includes('†')).slice(0, 2).join(' || '));
      ok('S2. the note under the table says what the † means, naming the film as the report does (owner, 23 Oct)', JSON.stringify(await page.locator('.inspector .fit-note').allInnerTexts()) === JSON.stringify(['† T2 scaled to T1 on S–N (×1.042)']),
        (await page.locator('.inspector .fit-note').allInnerTexts()).join(' | '));
      ok('S2. the scale line names the fit', (await page.locator('.inspector p.hint', { hasText: /^Scale / }).innerText()).includes('(scaled to T1 on S–N (×1.042))'));
      ok('S2. switching on clears Tracing verified (D-c)', (await page.locator('.verified-note').count()) === 0);
      // Task 5 V3: G's own mm change (the store cleared the sign-off above, never touching cases.spacing_mm) holds the
      // tracing exactly as a calibration would, through the same `holdForMm` path — never `afterMmChange` (a fit is
      // never a calibration, so the line must not read "calibrated scale"). StatusRow renders beside every tab.
      ok('S2b. V3: the switch holds the tracing, with the mm-changed line (not a calibration)', (await page.locator('.inspector .status-row .hold-line').innerText()) === 'The mm changed — check, then mark verified.');
      ok('S9. Compare populations says its mm come from the fit', JSON.stringify(await popNote()) === JSON.stringify(['mm scaled to T1 on S–N (×1.042).']));
      const mine = Object.fromEntries(on.slice(1).map((r) => [cell(r, 0), num(cell(r, 1))]));
      await toSup(2);
      const sel = page.locator('select[aria-label="Change between"]'); await sel.selectOption({ label: 'T1 → T2' });
      let agree = 0, mm = 0;
      for (const r of (await table()).slice(1)) if (cell(r, 2).endsWith('†')) { mm++; if (mine[cell(r, 0)] !== undefined && Math.abs(mine[cell(r, 0)] - num(cell(r, 2))) < 1e-9) agree++; }
      ok(`S3. T2’s own mm are the Change table’s, from the same fit (${agree} of ${mm})`, mm > 0 && agree === mm);
      await back(); await verify('g2'); await openFilm('Demo Rescale', 'T2'); await page.getByRole('tab', { name: 'Measurements' }).click();
      ok('S4. closed and reopened, it is still on', await own().locator('input[type=checkbox]').isChecked());
      ok('S5. verified again before switching off (D-c set-up)', await page.locator('.verified-note').isVisible());
      await own().getByLabel('Use the scale from the fit').uncheck();
      await page.waitForFunction(() => [...document.querySelectorAll('.inspector table.measures td')].some((t) => t.textContent.includes('calibrate to show')));
      ok('S5. off again: exactly main’s numbers', JSON.stringify(await table()) === JSON.stringify(gold.snap['measures g2']));
      ok('S5. switching off clears it too (D-c)', (await page.locator('.verified-note').count()) === 0);
      ok('S5b. V3: switching off holds it too (same D-c path as S2b)', (await page.locator('.inspector .status-row .hold-line').innerText()) === 'The mm changed — check, then mark verified.');
      ok('S9. switched off: no note in Compare populations', (await popNote()).length === 0);
      await back(); await openFilm('Demo Rescale', 'T1'); await page.getByRole('tab', { name: 'Measurements' }).click();
      ok('S6. the reference’s own numbers never move', JSON.stringify(await table()) === JSON.stringify(gold.snap['measures g1']));
      await back(); await openFilm('Demo Rescale', 'T3'); await page.getByRole('tab', { name: 'Measurements' }).click();
      ok('S7. a ruler-calibrated film with a fit has no switch (G2: locked) and its own numbers', (await own().count()) === 0
        && JSON.stringify(await table()) === JSON.stringify(gold.snap['measures g3']));
      ok('S7. … and says why, and the switch was never written for it', (await page.locator('.inspector .fit-own-locked').innerText())
        === '“Use the scale from the fit” is not offered: this film has its own ruler.' && !(await ownCalls()).some(([, a]) => a.caseId === 'g3'));
      await back(); await openFilm('Demo Assumed', 'T2'); await page.getByRole('tab', { name: 'Measurements' }).click();
      await own().getByLabel('Use the scale from the fit').check();
      await page.waitForFunction(() => document.querySelector('.inspector .scale-advice span')?.textContent.startsWith('This radiograph'));
      ok('S8. G3: when the reference had no ruler either, it says both are on the assumed scale', (await own().locator('span').first().innerText())
        === 'This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1. T1 had no ruler either, so both are on the assumed scale.');
      await back();
    }
    // Fix round 1, review I-1: editing patient details that move a switched-on, signed-off film off its fit
    // (the store's `fits::prune`, D-e) must hold it (V3), not leave it signed with the stale fit and scale.
    {
      await reseed(`(db) => {
        db.fits = ${JSON.stringify({ g2: { ...FIT_G2, useOwn: true } })};
        db.cases.g2.landmarks = db.cases.g2.landmarks.map((l) => ({ ...l, verified: true }));
        db.cases.g2.verifiedAt = '2026-10-10T00:00:00Z'; db.cases.g2.verifiedBy = 'SYNTHETIC';
      }`);
      await page.reload(); await page.waitForSelector('.library'); await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
      await openFilm('Demo Rescale', 'T2');
      ok('I1setup. verified, every point accepted, scaled from the fit, before the edit', await page.locator('.verified-note').isVisible());
      const nameInput = page.locator('input[placeholder="Type the patient’s name"]');
      await nameInput.fill('Demo Rescale Moved'); await nameInput.blur();
      await page.waitForFunction(() => !JSON.parse(localStorage.getItem('fakeLib')).fits.g2);
      ok('I1. moving the film off its fit holds it, never leaves it signed with the stale fit (V3)', (await page.locator('.verified-note').count()) === 0);
      ok('I1. the status row says why (not left blank, not "calibrated scale")', (await page.locator('.inspector .status-row .hold-line').innerText()) === 'The mm changed — check, then mark verified.');
      const n0 = (await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.g2.landmarks.find((l) => l.id === 'N'))).x;
      await page.locator('g.landmark[data-id="N"] circle, g.landmark[data-id="N"] rect').first().click({ force: true });
      await page.keyboard.press('ArrowRight'); await page.waitForTimeout(1500);
      const after = await page.evaluate(() => JSON.parse(localStorage.getItem('fakeLib')).cases.g2);
      ok('I1. a later point action does not re-sign it (control: N moved)', !after.verifiedAt && after.landmarks.find((l) => l.id === 'N').x !== n0,
        `verifiedAt=${after.verifiedAt}`);
      await back();
    }
    // Fix round 1, review M-4: calibrating turns the open film's own "Use the scale from the fit" off in the store
    // (a ruler always wins); `doc.fit` must be refreshed at once, not only on reopening.
    {
      await reseed(`(db) => { db.fits = ${JSON.stringify({ g2: { ...FIT_G2, useOwn: true } })}; }`);
      await page.reload(); await page.waitForSelector('.library'); await page.locator('.lib-nav button', { hasText: 'All cases' }).click();
      await openFilm('Demo Rescale', 'T2'); await page.getByRole('tab', { name: 'Measurements' }).click();
      ok('M4setup. switched on before calibrating', await own().locator('input[type=checkbox]').isChecked());
      await page.keyboard.press('k');
      const st = await page.locator('.stage').boundingBox();
      await page.mouse.click(st.x + st.width * 0.3, st.y + st.height * 0.7); await page.mouse.click(st.x + st.width * 0.6, st.y + st.height * 0.7);
      await page.waitForSelector('.calibrate-dialog'); await page.locator('.calibrate-dialog input').fill('20');
      await page.getByRole('button', { name: 'Save', exact: true }).click(); await page.waitForSelector('.calibrate-dialog', { state: 'detached' });
      await page.getByRole('tab', { name: 'Measurements' }).click();
      ok('M4. calibrating turns the switch off at once: no checkbox, the locked line instead (not stale until reopened)',
        (await own().locator('input[type=checkbox]').count()) === 0 && (await page.locator('.inspector .fit-own-locked').innerText())
          === '“Use the scale from the fit” is not offered: this film has its own ruler.');
      await back();
    }
  }

  ok('no page errors', errors.length === 0, errors.join(' | '));
  fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
  fs.writeFileSync(path.join(__dirname, 'out', 'e2e15-report.txt'), results.join('\n') + '\n');
  console.log(results.join('\n'));
  await browser.close();
})().catch((e) => {
  const lines = [...results, `CRASHED  e2e15 stopped part-way, after ${results.length} checks: ${String(e).split('\n')[0]}`];
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(REPORT, lines.join('\n') + '\n');
  console.log(lines.join('\n')); console.error(e); process.exit(1);
});
