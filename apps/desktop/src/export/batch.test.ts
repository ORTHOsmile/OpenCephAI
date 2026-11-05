import { describe, it, expect, vi } from 'vitest';
// Task 10 fix round 2: `library.ghosts` wired in as `d.runs` is the batch export's real path to `library_ghosts`
// (App.tsx: `runs: (id) => library.ghosts(id)`). Mocking the Tauri boundary here (not `d.runs` directly) exercises
// the actual source fix in ipc.ts, not just this file's own stand-in.
const invokeMock = vi.fn((..._a: unknown[]) => Promise.resolve(null as unknown));
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invokeMock(...a) }));
import { compile } from '@ceph/geometry';
import { ALL_ANALYSES, buildRegistry, loadSets, resolveNorm } from '@ceph/analyses';
import { DEFAULT_ENABLED, enabledDefs } from '../analyses/enabled';
import { wordsFor } from '../settings/meanings';
import { NOW, synthDoc, synthFittedDoc } from '../report/fixtures';
import { buildReport, modelsUsed } from '../report/model';
import { measurementRows } from '../measurements';
import { normCell, queryFor } from '../norms/normCell';
import { ownPages } from '../compare/fit';
import { fittedValues } from '../compare/comparison';
import { docPoints } from './film';
import type { ReportModel } from '../report/model';
import { exportFilmsCsv, filmModels, wordsByFilm, type BatchDeps, type ExportDeps } from './batch';
import { library } from '../ipc';
import type { CaseDoc, ModelPoints, PointCheckFlag, PointCheckView } from '../ipc';
import { hydrateAction } from '../library/persist';
import { reportPoints } from '../report/points';
import { measurementsCsv } from './measurementsCsv';
import { placedByOf, pointPlacer } from '../measurements';

// SYNTHETIC films only.
const deps = (o: Partial<BatchDeps> = {}): BatchDeps => ({
  open: async (id) => synthDoc({ id }), readPicks: async () => ({}), readWords: async () => ({}),
  defs: enabledDefs(DEFAULT_ENABLED), compiled: compile(buildRegistry(ALL_ANALYSES)), decimals: 1,
  norms: { sets: loadSets(), userNorms: [], clinicDefault: null }, wordsOf: async () => (id) => wordsFor(id, {}), titleOf: (m) => (m === 'aariz' ? 'Aariz' : m),
  dateFormat: 'AU', now: NOW, ...o });

describe('several films → report models (Library ▸ Export CSV…)', () => {
  it('one model per film, in the order chosen, each from its own saved points and scale', async () => {
    const r = await filmModels(['c1', 'c2'], deps({ open: async (id) => synthDoc({ id, spacingMm: id === 'c2' ? null : 0.1 }) }));
    expect(r.failed).toEqual([]);
    expect(r.models.map((m) => [m.caseId, m.film.scale.source, m.film.models])).toEqual([['c1', 'calibration', ['Aariz']], ['c2', 'assumed', ['Aariz']]]);
    const mm = r.models[1].blocks.flatMap((b) => b.rows).filter((x) => x.unit === 'mm');
    expect(mm.length).toBeGreaterThan(0);
    expect(mm.every((x) => x.num === null)).toBe(true);
    // preflight-rulings Task 10 [Critical]: the Co rows read "Needs: Co" (no Co on this film) — only the computable
    // mm rows read "calibrate to show".
    const computable = mm.filter((x) => !x.status.startsWith('Needs:'));
    expect(computable.length).toBeGreaterThan(0);
    expect(computable.every((x) => x.status === 'calibrate to show')).toBe(true);
    // ...and on the calibrated film the same computable rows carry numbers (the assumed film's nulls are its scale).
    const mm0 = r.models[0].blocks.flatMap((b) => b.rows).filter((x) => x.unit === 'mm' && !x.status.startsWith('Needs:'));
    expect(mm0.length).toBe(computable.length);
    expect(mm0.every((x) => typeof x.num === 'number')).toBe(true);
  });
  // Owner decisions 1 and 4 (29 Oct 2026; spec §4.6): the Library export's sentence says how Auto chose, through the
  // same helper as the screen (casePopulationChoice); a hand-chosen population gets no bracket.
  it('a case on Auto says how its population was chosen; the same case on that population by hand does not', async () => {
    const onAuto = await filmModels(['c1'], deps({ open: async (id) => synthDoc({ id, population: 'auto', background: 'chinese' }) }));
    expect(onAuto.models[0].normSummary).toMatch(/ \(chosen automatically from the patient's demographics\)(\.|; some measurements use other norms \(marked ◆\)\.)$/);
    expect(onAuto.models[0].normSummary).toContain('Chinese');
    const byHand = await filmModels(['c1'], deps({ open: async (id) => synthDoc({ id, population: 'chinese', background: 'chinese' }) }));
    expect(byHand.models[0].normSummary).not.toContain('chosen automatically');
    expect(byHand.models[0].normSummary).toBe(onAuto.models[0].normSummary!.replace(" (chosen automatically from the patient's demographics)", ''));
  });
  // Final review I3 (3 Nov 2026): an adult with nothing recorded, on Auto — the combined adult norm. When most rows are
  // single-study rows (◆), the sentence must still name the combined norm, never the single study's population.
  const adultAuto = (analysis: string) => deps({ defs: enabledDefs([analysis]),
    open: async (id) => synthDoc({ id, population: 'auto', gender: 'M', dateOfBirth: '1990-03-07' }) });   // SYNTHETIC
  it('I3: a Holdaway-only report of an adult man with nothing recorded names the combined norm, and the single-study rows as ◆', async () => {
    const r = await filmModels(['c1'], adultAuto('holdaway'));
    const rows = r.models[0].blocks.flatMap((b) => b.rows);
    expect(rows.filter((x) => x.autoStep === 'single-study').length).toBeGreaterThan(rows.filter((x) => x.sourceLine.startsWith('Combined adult norm')).length);
    expect(r.models[0].normSummary).toBe("We used combined adult norms for men, from every adult study in the app weighted by size (chosen automatically from the patient's demographics); some measurements use a single study or other norms (marked ◆).");
  });
  it('I3: a Kim-only report of an adult man with nothing recorded (no combined row at all) says each row uses a single study', async () => {
    const r = await filmModels(['c1'], adultAuto('kim'));
    const rows = r.models[0].blocks.flatMap((b) => b.rows).filter((x) => x.sourceLine);
    expect(rows.some((x) => x.sourceLine.startsWith('Combined adult norm'))).toBe(false);
    expect(r.models[0].normSummary).toBe("Fewer than 2 adult studies measured each of these measurements, so each uses a single study or other norms (marked ◆; chosen automatically from the patient's demographics).");
  });
  it("each film's own changed words are used", async () => {
    const r = await filmModels(['c1'], deps({ readWords: async () => ({ 'steiner:m03_ANB': { text: 'SYNTHETIC words', was: '__never__' } }) }));
    expect(r.models[0].blocks[0].rows.find((x) => x.node === 'm03_ANB')!.stale?.text).toBe('SYNTHETIC words');
  });
  it('a film that cannot be opened, or whose chosen norms cannot be read, is left out and counted', async () => {
    const r = await filmModels(['c1', 'bad', 'picks'], deps({
      open: async (id) => { if (id === 'bad') throw new Error('SYNTHETIC unreadable'); return synthDoc({ id }); },
      readPicks: async (id) => { if (id === 'picks') throw new Error('SYNTHETIC picks'); return {}; } }));
    expect(r.models.map((m) => m.caseId)).toEqual(['c1']);
    expect(r.failed).toEqual(['bad', 'picks']);
  });
  it("a film whose report words, or whose clinician's meaning words, cannot be read is left out and counted", async () => {
    const r = await filmModels(['c1', 'words', 'meanings'], deps({
      readWords: async (id) => { if (id === 'words') throw new Error('SYNTHETIC words'); return {}; },
      wordsOf: async (doc) => { if (doc.id === 'meanings') throw new Error('SYNTHETIC meanings'); return (id) => wordsFor(id, {}); } }));
    expect(r.models.map((m) => m.caseId)).toEqual(['c1']);
    expect(r.failed).toEqual(['words', 'meanings']);
  });
  it('no films: nothing', async () => {
    expect(await filmModels([], deps())).toEqual({ models: [], failed: [] });
  });

  it('Automatic best: a film placed through it carries the label in its points; control without it', async () => {
    const plain = synthDoc({ id: 'c1' });
    const via = { ...plain, landmarks: plain.landmarks.map((l) => (l.source === 'manual' ? l : { ...l, placedBy: 'aariz', placedVia: 'auto-best' })) };
    const r = await filmModels(['c1'], deps({ open: async () => via, points: true }));
    const ai = r.models[0].points.filter((p) => p.model);
    expect(ai.length).toBeGreaterThan(0);
    expect(ai.every((p) => p.label.includes('Automatic best · '))).toBe(true);
    const r0 = await filmModels(['c1'], deps({ open: async () => plain, points: true }));
    expect(r0.models[0].points.some((p) => p.label.includes('Automatic best'))).toBe(false);
  });

  // Task 13 carry (28 Oct, fix round 1): an ANONYMISED points CSV must keep the Automatic best label
  // on exactly the points that carry `placedVia`, and the plain label on the rest — within the SAME film, so a
  // mistake that strips/flattens the label under Anonymised (`pointColumns` in measurementsCsv.ts never reads
  // `o.anonymise` for `placed_by_label`, by design — ANON-1: no patient data in that column) would fail this.
  it('Automatic best, anonymised points CSV: the label survives on exactly the points that carry placedVia', async () => {
    const plain = synthDoc({ id: 'c1' });
    const mixed = { ...plain, landmarks: plain.landmarks.map((l) =>
      (l.id === 'S' || l.id === 'N' ? { ...l, placedBy: 'aariz', placedVia: 'auto-best' } : l)) };   // only S, N via Automatic best
    const r = await filmModels(['c1'], deps({ open: async () => mixed, points: true }));
    const csv = measurementsCsv(r.models, { layout: 'points', anonymise: true, salt: '0123456789abcdef0123456789abcdef', exportedAt: NOW.toISOString(), decimals: 1 });
    const [head, ...rows] = csv.replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(','));
    const pointAt = head.indexOf('point'), labelAt = head.indexOf('placed_by_label');
    expect([pointAt, labelAt].every((i) => i >= 0)).toBe(true);
    const labelOf = (id: string) => rows.find((row) => row[pointAt] === id)![labelAt];
    expect(labelOf('S')).toBe('Automatic best · Aariz');
    expect(labelOf('N')).toBe('Automatic best · Aariz');
    // Control within the same assertion: the points that do NOT carry placedVia keep the plain label — proves the
    // guard can tell the two apart, not just that "Automatic best" appears somewhere in the file.
    expect(labelOf('A')).toBe('Aariz');
    expect(rows.every((row) => row[pointAt] !== 'A' || !row[labelAt].includes('Automatic best'))).toBe(true);
  });
});

// preflight-rulings Task 10 [Important] (NOCLIN-2 on main): in the Library no film is open, so each film's words are
// resolved for THAT film — the top-bar clinician, else its own Referring practitioner if they have saved words, else
// the login name — exactly as its own screen and report would show them.
describe("each film's meaning words follow its own clinician (NOCLIN-2)", () => {
  const LOGIN = 'SYNTHETIC Login', REF = 'SYNTHETIC Dr Ref', TOP = 'SYNTHETIC Dr Top';
  const worded = (who: string) => JSON.stringify({ m03_ANB: { high: `${who} high`, low: `${who} low` } });
  const store = (m: Record<string, string>, fail: string[] = []) => {
    const reads: string[] = [];
    return { reads, get: async (k: string) => { reads.push(k); if (fail.includes(k)) throw new Error('SYNTHETIC read failed'); return m[k] ?? null; } };
  };
  const anb = (m: ReportModel) => m.blocks.flatMap((b) => b.rows).find((x) => x.node === 'm03_ANB')!.usual;
  const films = (o: Partial<BatchDeps>) => filmModels(['a', 'b'], deps({ open: async (id) => synthDoc({ id, referringPractitioner: id === 'a' ? '  synthetic dr REF ' : null }), ...o }));

  it("a film whose referrer has saved words uses them; the other film uses the login name's", async () => {
    const s = store({ [`meanings:${LOGIN}`]: worded('SYNTHETIC login'), [`meanings:${REF}`]: worded('SYNTHETIC referrer') });
    const r = await films({ wordsOf: wordsByFilm(s, { explicit: null, login: LOGIN, names: [LOGIN, REF] }) });
    expect(r.failed).toEqual([]);
    expect(r.models.map(anb)).toEqual([expect.stringContaining('SYNTHETIC referrer'), expect.stringContaining('SYNTHETIC login')]);
  });
  it("positive control: the referrer has no saved words, so both films use the login name's", async () => {
    const s = store({ [`meanings:${LOGIN}`]: worded('SYNTHETIC login') });
    const r = await films({ wordsOf: wordsByFilm(s, { explicit: null, login: LOGIN, names: [LOGIN, REF] }) });
    expect(r.models.map(anb)).toEqual([expect.stringContaining('SYNTHETIC login'), expect.stringContaining('SYNTHETIC login')]);
  });
  it('a clinician chosen in the top bar: every film uses theirs, a worded referrer or not', async () => {
    const s = store({ [`meanings:${LOGIN}`]: worded('SYNTHETIC login'), [`meanings:${REF}`]: worded('SYNTHETIC referrer'), [`meanings:${TOP}`]: worded('SYNTHETIC top') });
    const r = await films({ wordsOf: wordsByFilm(s, { explicit: TOP, login: LOGIN, names: [LOGIN, REF, TOP] }) });
    expect(r.models.map(anb)).toEqual([expect.stringContaining('SYNTHETIC top'), expect.stringContaining('SYNTHETIC top')]);
  });
  it('each clinician is read once per export, however many films they cover', async () => {
    const s = store({ [`meanings:${LOGIN}`]: worded('SYNTHETIC login') });
    const r = await filmModels(['a', 'b', 'c'], deps({ wordsOf: wordsByFilm(s, { explicit: null, login: LOGIN, names: [LOGIN] }) }));
    expect(r.models.length).toBe(3);
    expect(s.reads).toEqual([`meanings:${LOGIN}`]);
  });
  it("a film whose clinician's words cannot be read is left out and counted, not shown with someone else's", async () => {
    const s = store({ [`meanings:${LOGIN}`]: worded('SYNTHETIC login'), [`meanings:${REF}`]: worded('SYNTHETIC referrer') }, [`meanings:${REF}`]);
    const r = await films({ wordsOf: wordsByFilm(s, { explicit: null, login: LOGIN, names: [LOGIN, REF] }) });
    expect(r.failed).toEqual(['a']);
    expect(r.models.map((m) => [m.caseId, anb(m)])).toEqual([['b', expect.stringContaining('SYNTHETIC login')]]);
  });
});

describe('Library ▸ Export CSV…: one file for the chosen films', () => {
  const SALT = '0123456789abcdef0123456789abcdef';
  const exp = (o: Partial<ExportDeps> = {}) => {
    const files: { name: string; text: string }[] = [], calls = { salt: 0, open: 0 };
    const d: ExportDeps = { ...deps(), normsError: null,
      salt: async () => { calls.salt++; return SALT; },
      save: async (name, bytes) => { files.push({ name, text: new TextDecoder().decode(bytes) }); return true; }, ...o };
    const open = d.open;
    d.open = (id) => { calls.open++; return open(id); };
    return { d, files, calls };
  };
  const ANON = { anonymise: true, layout: 'tidy' } as const, NAMED = { anonymise: false, layout: 'tidy' } as const;

  it('norms that failed to load: no CSV, and it says why', async () => {
    const { d, files, calls } = exp({ normsError: 'SYNTHETIC norms file damaged' });
    await expect(exportFilmsCsv(['c1', 'c2'], ANON, d)).rejects.toThrow("norms couldn't be loaded (SYNTHETIC norms file damaged)");
    expect([files.length, calls.open, calls.salt]).toEqual([0, 0, 0]);
  });
  it('every film failing: no file, and a message', async () => {
    const { d, files } = exp({ open: async () => { throw new Error('SYNTHETIC unreadable'); } });
    await expect(exportFilmsCsv(['c1', 'c2'], ANON, d)).rejects.toThrow('none of the 2 chosen films could be read');
    expect(files.length).toBe(0);
  });
  it('nothing chosen: no file', async () => {
    const { d, files } = exp();
    await expect(exportFilmsCsv([], ANON, d)).rejects.toThrow('no films chosen');
    expect(files.length).toBe(0);
  });
  it('a film that cannot be read is left out and counted; the rest go in one file', async () => {
    const { d, files } = exp({ open: async (id) => { if (id === 'bad') throw new Error('SYNTHETIC unreadable'); return synthDoc({ id }); } });
    expect(await exportFilmsCsv(['c1', 'bad', 'c3'], NAMED, d)).toBe('2 films exported; 1 could not be read and was left out.');
    expect(files.length).toBe(1);
    const films = new Set(files[0].text.replace(/^﻿/, '').split('\r\n').filter(Boolean).slice(1).map((l) => l.split(',')[0]));
    expect([...films].sort()).toEqual(['c1', 'c3']);
  });
  it('the notice for one film, none left out; and for two left out', async () => {
    expect(await exportFilmsCsv(['c1'], NAMED, exp().d)).toBe('1 film exported.');
    const { d } = exp({ open: async (id) => { if (id !== 'c1') throw new Error('SYNTHETIC unreadable'); return synthDoc({ id }); } });
    expect(await exportFilmsCsv(['c1', 'x', 'y'], NAMED, d)).toBe('1 film exported; 2 could not be read and were left out.');
  });
  it('cancelled at the save dialog: nothing said, nothing written', async () => {
    const { d } = exp({ save: async () => false });
    expect(await exportFilmsCsv(['c1'], NAMED, d)).toBeNull();
  });
  it('Named reads no salt; Anonymised does', async () => {
    const a = exp(); await exportFilmsCsv(['c1'], NAMED, a.d); expect(a.calls.salt).toBe(0);
    const b = exp(); await exportFilmsCsv(['c1'], ANON, b.d); expect(b.calls.salt).toBe(1);
  });

  // ANON-1 with several patients: no name, date of birth or ID of ANY of them anywhere in the file. Named is the
  // positive control (the same films, the same search, must find every one of them).
  // Fix round 1 (review I1, confirmed by the reviewer's control): with the o.anonymise ? guard dropped on
  // library_patient_id, all 21 of this file's tests still passed — none of them gave a patient a libraryId, so
  // there was nothing for a leak to leak. Each PEOPLE entry now gets its own libraryId, carried in needles.
  // Owner decision (20 Oct): each person also verified by a clinician — film-aaa and film-ccc by the SAME one
  // (Dr Alice), film-bbb by a different one (Dr Bob), so the batch path's verified_by coding ("two clinicians
  // across three films") is exercised through the real export, not just measurementsCsv() directly.
  const PEOPLE = [
    { id: 'film-aaa', patientName: 'SYNTHETIC Alpha Person', patientKey: 'synthetic alpha person', dateOfBirth: '2010-03-07', printedPatientId: 'SYNTHPID-111', scanId: 'SYNTHSCAN-111', libraryId: 'L-00101', verifiedAt: '2026-10-01T00:00:00Z', verifiedBy: 'Dr Alice SYNTHETIC' },   // SYNTHETIC
    { id: 'film-bbb', patientName: 'SYNTHETIC Beta Person', patientKey: 'synthetic beta person', dateOfBirth: '2011-05-09', printedPatientId: 'SYNTHPID-222', scanId: 'SYNTHSCAN-222', libraryId: 'L-00102', verifiedAt: '2026-10-02T00:00:00Z', verifiedBy: 'Dr Bob SYNTHETIC' },   // SYNTHETIC
    { id: 'film-ccc', patientName: 'SYNTHETIC Gamma Person', patientKey: 'synthetic gamma person', dateOfBirth: '2012-08-11', printedPatientId: 'SYNTHPID-333', scanId: 'SYNTHSCAN-333', libraryId: 'L-00103', verifiedAt: '2026-10-03T00:00:00Z', verifiedBy: 'Dr Alice SYNTHETIC' },   // SYNTHETIC
  ];
  const needles = PEOPLE.flatMap((p) => [p.patientName, p.dateOfBirth, p.printedPatientId, p.scanId, p.id, p.libraryId, p.verifiedBy,
    p.dateOfBirth.split('-').reverse().join('/')]);   // SYNTHETIC: the DOB as DD/MM/YYYY too
  const count = (hay: string, n: string) => hay.toLowerCase().split(n.toLowerCase()).length - 1;
  // A real row (unlike the simplified fixtures' norm_source) carries the catalogue's own citations, which contain
  // commas inside quoted fields — naive `.split(',')` on such a row misaligns every column after the first quoted
  // one. A minimal RFC 4180 row parser, for reading a column by NAME rather than a now-unsafe fixed index.
  const parseCsvRow = (line: string): string[] => {
    const out: string[] = []; let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
    return out;
  };
  const several = (layout: 'tidy' | 'wide', anonymise: boolean) => {
    const { d, files } = exp({ open: async (id) => synthDoc(PEOPLE.find((p) => p.id === id)!) });
    return exportFilmsCsv(PEOPLE.map((p) => p.id), { anonymise, layout }, d).then(() => files[0].text);
  };
  for (const layout of ['tidy', 'wide'] as const) {
    it(`Anonymised, three patients (${layout}): no name, date of birth or ID of any of them appears anywhere`, async () => {
      const text = await several(layout, true);
      expect(Object.fromEntries(needles.map((n) => [n, count(text, n)]))).toEqual(Object.fromEntries(needles.map((n) => [n, 0])));
      expect(count(text, 'SYNTHETIC')).toBe(0);
      expect(count(text, '2024-02-07')).toBeGreaterThan(0);   // the film date stays (ANON-1)
      expect(new Set(text.match(/P-[0-9a-f]{10}/g)).size).toBe(3);
      expect(new Set(text.match(/F-[0-9a-f]{10}/g)).size).toBe(3);
    });
    it(`positive control, Named, the same three patients (${layout}): the same search finds every one`, async () => {
      const text = await several(layout, false);
      const iso = needles.filter((n) => !/\//.test(n));   // the CSV writes dates as YYYY-MM-DD only
      expect(iso.filter((n) => count(text, n) === 0)).toEqual([]);
    });
  }

  // Owner decision (20 Oct): verified_by becomes a stable per-clinician code in an Anonymised export, assigned
  // in order of first appearance across the WHOLE file (batch path: filmModels + measurementsCsv, through
  // exportFilmsCsv — the same function the open-film export calls with one model). film-aaa and film-ccc share
  // Dr Alice, so they must share the same code; Named must show the two clinicians' real names unchanged.
  it('verified_by is coded per clinician, in order of first appearance, across the batch (tidy)', async () => {
    const codesByFilm = (text: string) => {
      const allLines = text.replace(/^﻿/, '').split('\r\n').filter(Boolean);
      const header = parseCsvRow(allLines[0]), filmCol = header.indexOf('film'), vbCol = header.indexOf('verified_by');
      const rows = allLines.slice(1).map(parseCsvRow);
      const seen = new Map<string, string>();
      for (const r of rows) seen.set(r[filmCol], r[vbCol]);   // one entry per distinct film; verified_by is constant per film
      return [...seen.values()];
    };
    expect(codesByFilm(await several('tidy', true))).toEqual(['Clinician 1', 'Clinician 2', 'Clinician 1']);
    expect(codesByFilm(await several('tidy', false))).toEqual(['Dr Alice SYNTHETIC', 'Dr Bob SYNTHETIC', 'Dr Alice SYNTHETIC']);
  });
});

// R3 (D6, final-review.md I1): Library ▸ Export CSV… gives a fitted, switch-on film the same report model as its own
// preview — the open film's path is App.tsx's `compareRows` (measurementRows over `fittedValues`) with
// `ownPages(doc).scale`. Before R3 the batch used `scaleOf(doc.spacingMm)`: every mm blank, the header "assumed".
describe('R3 (D6): a fitted film exported from the Library equals its own preview', () => {
  it('filmModels([T2]) deep-equals buildReport over the screen\'s rows and scale', async () => {
    const doc = synthFittedDoc(), d = deps({ open: async () => doc });
    const { models: [got] } = await filmModels([doc.id], d);
    const p = ownPages(doc), pos = docPoints(doc);
    const rows = measurementRows(d.defs, d.compiled, fittedValues(d.compiled.evaluate(pos, p.own.mmPerPx), d.compiled, pos, p.scale), new Set(Object.keys(pos)), d.decimals, p.scale);
    const cells = rows.map((r) => { const q = queryFor(r.node, r.normAnalysisId, doc, d.norms, {}); return normCell(r.num, resolveNorm(q), q, d.decimals); });
    const want = buildReport({ doc, rows, cells, defs: d.defs, words: (await d.wordsOf(doc)), edits: {}, scale: p.scale,
      models: modelsUsed(doc.landmarks.map((l) => ({ source: l.source, placer: l.placedBy ?? null })), d.titleOf), dateFormat: d.dateFormat, now: d.now });
    expect(got).toEqual(want);
    expect(got.film.scale.source).toBe('fit');
    const shown = got.blocks.flatMap((b) => b.rows).filter((r) => r.unit === 'mm' && r.num !== null);
    expect(shown.length).toBeGreaterThan(0);
    console.log(`[R3 D6] rows compared ${got.blocks.flatMap((b) => b.rows).length}; mm with a number ${shown.length}`);
  });
});

describe('Part F: points for the points CSV (chain spec §5)', () => {
  it('only when asked; each point with its label, model, file and accept kind', async () => {
    expect((await filmModels(['c1'], deps())).models[0].points).toEqual([]);
    const r = await filmModels(['c1'], deps({ points: true, pointFiles: async () => ({ S: 'fp-az' }) }));
    const s = r.models[0].points.find((p) => p.id === 'S')!;
    expect([s.model, s.modelFile, s.acceptKind]).toEqual(['aariz', 'fp-az', null]);
    expect(r.models[0].points.length).toBe(synthDoc().landmarks.length);
  });
  it('a model file that cannot be read leaves model_file blank, never the film out', async () => {
    const r = await filmModels(['c1'], deps({ points: true, pointFiles: async () => { throw new Error('SYNTHETIC: unreadable'); } }));
    expect([r.failed, r.models[0].points.every((p) => p.modelFile === null)]).toEqual([[], true]);
  });
});

// Part F final review I-2: a film traced before schema 10 has no stored placed_by. The screen and the single-film export
// find its placer from the film's runs (the run whose point sits on the stored AI position); the Library's batch export
// must say exactly the same, in the label, model, model file and "models" columns.
describe('Part F final review I-2: one placer for the screen, the single-film export and the batch export', () => {
  const pre10 = () => synthDoc({ landmarks: synthDoc().landmarks.map((l) => ({ ...l, placedBy: null })) });
  const runsOf = (doc: CaseDoc): ModelPoints[] => [{ modelId: 'aariz', ranAt: 'SYNTHETIC', facing: 'right',
    points: doc.landmarks.map((l, i) => ({ channel: i, landmarkId: l.id, x: l.aiX!, y: l.aiY!, peak: 1 })) }];
  const files: Record<string, string> = { S: 'fp-az', N: 'fp-az' };
  const cols = (csv: string) => {
    const [head, ...rows] = csv.trim().split(/\r?\n/).map((l) => l.split(','));
    const at = ['point', 'placed_by_label', 'placed_by_model', 'model_file', 'models'].map((c) => head.indexOf(c));
    expect(at.every((i) => i >= 0)).toBe(true);
    return rows.map((r) => at.map((i) => r[i]));
  };
  it('a pre-schema-10 film exported both ways gives identical label and model columns, naming Aariz', async () => {
    const doc = pre10(), runs = runsOf(doc);
    const d = deps({ open: async () => doc, points: true, pointFiles: async () => files, runs: async () => runs });
    const { models: [batch], failed } = await filmModels([doc.id], d);
    expect(failed).toEqual([]);
    // The single-film export: the open film's points and the placer App hands to useReport.
    const pts = hydrateAction(doc).points, placer = pointPlacer(pts, placedByOf(doc), runs);
    const single: ReportModel = { ...batch, points: reportPoints(pts, placer, d.titleOf, files),
      film: { ...batch.film, models: modelsUsed(Object.entries(pts).map(([id, p]) => ({ source: p.source, placer: placer(id) })), d.titleOf) } };
    const o = { layout: 'points' as const, anonymise: false, salt: '', exportedAt: NOW.toISOString(), decimals: 1 as const };
    const [b, s] = [cols(measurementsCsv([batch], o)), cols(measurementsCsv([single], o))];
    console.log(`[I-2] point rows compared ${b.length} (film has ${doc.landmarks.length} points)`);
    expect(b.length).toBe(doc.landmarks.length);
    expect(b).toEqual(s);
    expect(b.every(([, label, model, , models]) => label === 'Aariz' && model === 'aariz' && models === 'Aariz')).toBe(true);
    expect(b.find(([p]) => p === 'S')![3]).toBe('fp-az');
  });
});

// Task 10 review, Important #1: the fix round guarded `aiPoints` in useCase.ts, but App.tsx wires the SAME
// `library.ghosts()` into the batch/report export path (`runs: (id) => library.ghosts(id)`), whose own `.catch`
// (batch.ts) only intercepts a rejected promise, not a resolved `null`. That `null` would reach
// `pointPlacer`/`placerOf` (measurements.ts), which calls `runs.find(...)` — the same `TypeError` class the fix
// round diagnosed for `.filter`. Fixed at the source (ipc.ts's `library.ghosts` now resolves `[]` for a null
// back-end answer), so every consumer, this one included, is safe without its own guard.
describe('Task 10 fix round 2: a batch export survives library.ghosts() resolving null (the back end gave no runs)', () => {
  it('completes without crashing; every point reads as placed by no recorded model, never a crash', async () => {
    const doc = synthDoc({ landmarks: synthDoc().landmarks.map((l) => ({ ...l, placedBy: null })) });
    const d = deps({ open: async () => doc, points: true, pointFiles: async () => ({}), runs: library.ghosts });
    const { models: [batch], failed } = await filmModels([doc.id], d);
    expect(failed).toEqual([]);
    expect(batch.points.length).toBe(doc.landmarks.length);
    expect(batch.points.every((p) => p.model === null)).toBe(true);   // no stored run matched (none exist) — not a crash
  });
});

// Stage A task 8: the batch export reads each film's own stored point check (the same read the screen uses).
describe('Stage A task 8: the batch export carries each film\'s point_check', () => {
  const flag = (modelId: string, landmarkId: string | null, over: Partial<PointCheckFlag> = {}): PointCheckFlag => ({ id: 1, modelId, landmarkId,
    action: landmarkId ? 'flagged' : 'film-unusual', points: landmarkId ? null : 'N,S,Po,Ar', offPx: 100, expectedX: 1, expectedY: 1, ring: null, resolved: null, ...over });
  const views: Record<string, PointCheckView | null> = {
    flagged: { runs: [], flags: [flag('aariz', 'N'), flag('aariz', 'B', { resolved: 'accepted' })] },
    unusual: { runs: [], flags: [flag('aariz', null)] },          // a film-unusual run has one film row and no point rows
    clean: { runs: [{ modelId: 'aariz', outcome: 'clean', notRunReason: null, present: 19 }], flags: [] },
    notrun: { runs: [{ modelId: 'aariz', outcome: 'not-run', notRunReason: 'too-few-points', present: 11 }], flags: [] },
    nonplacer: { runs: [], flags: [flag('srpose-cldet23', 'N')] },
    nonplacerFilm: { runs: [], flags: [flag('srpose-cldet23', null)] },
  };
  const readOf = (id: string) => views[id] ?? null;                                        // 'never' has no entry: never checked
  const col = (csv: string, name: string) => {
    const [head, ...rows] = csv.replace(/^﻿/, '').trim().split(/\r?\n/).map((l) => l.split(','));
    return { at: head.indexOf(name), pt: head.indexOf('point'), rows, head };
  };
  const cellsOf = (csv: string, film: string) => {
    const { at, pt, rows } = col(csv, 'point_check');
    expect(at).toBeGreaterThan(0);
    return Object.fromEntries(rows.filter((r) => r[0] === film).map((r) => [r[pt], r[at]]));
  };
  const OPTS = { layout: 'points' as const, anonymise: false, salt: '0123456789abcdef0123456789abcdef', exportedAt: NOW.toISOString(), decimals: 1 as const };
  const csvFor = async (ids: string[], o: Partial<BatchDeps> = {}) => {
    const r = await filmModels(ids, deps({ points: true, pointChecks: async (id) => readOf(id), ...o }));
    expect(r.failed).toEqual([]);
    expect(r.models.length, 'films compared').toBe(ids.length);
    return measurementsCsv(r.models, OPTS);
  };
  it('never checked / flagged then resolved / film-unusual / not run / nothing flagged / another model\'s flag: each film\'s own cells', async () => {
    const ids = ['never', 'flagged', 'unusual', 'clean', 'notrun', 'nonplacer', 'nonplacerFilm'];
    const csv = await csvFor(ids);
    const rows = Object.fromEntries(ids.map((id) => [id, cellsOf(csv, id)]));
    console.log('point_check cells N/B/S per film:', JSON.stringify(Object.fromEntries(ids.map((id) => [id, ['N', 'B', 'S'].map((p) => rows[id][p])]))));
    expect(Object.values(rows.never).every((v) => v === '')).toBe(true);
    expect([rows.flagged.N, rows.flagged.B, rows.flagged.S]).toEqual(['flagged', 'flagged', '']);        // B resolved `accepted`: still flagged
    expect(Object.values(rows.unusual).every((v) => v === 'film-unusual')).toBe(true);
    expect(Object.values(rows.clean).every((v) => v === '')).toBe(true);
    expect(Object.values(rows.notrun).every((v) => v === '')).toBe(true);
    expect(Object.values(rows.nonplacer).every((v) => v === '')).toBe(true);                           // the placer is Aariz
    expect(Object.values(rows.nonplacerFilm).every((v) => v === '')).toBe(true);
    expect(Object.keys(rows.flagged).length).toBeGreaterThan(5);
  });
  // Review I2: a blank cell would read as "checked, nothing flagged", so a failed read is a failed film (like a failed open):
  // it is left out and counted, never written as blanks. Fails if the read error is swallowed into a null view.
  it('a failed read of the check puts that film in `failed` and writes no row for it; the other films are unaffected', async () => {
    const r = await filmModels(['flagged', 'unusual'], deps({ points: true, pointChecks: async (id) => { if (id === 'unusual') throw new Error('busy'); return readOf(id); } }));
    console.log('check read failed for one of two films: models', r.models.map((m) => m.caseId), 'failed', r.failed);
    expect(r.failed).toEqual(['unusual']);
    expect(r.models.map((m) => m.caseId)).toEqual(['flagged']);
    expect(cellsOf(measurementsCsv(r.models, OPTS), 'flagged').N).toBe('flagged');
  });
  it('control: a film that was read but never checked (null view) stays in, with blank cells', async () => {
    const r = await filmModels(['never'], deps({ points: true, pointChecks: async () => null }));
    expect(r.failed).toEqual([]);
    expect(r.models.length).toBe(1);
  });
  it('a left-facing film: the same cells, and every other cell exactly as for a right-facing film', async () => {
    const left = (id: string) => ({ ...synthDoc({ id }), facing: 'left' as const });
    const r = await csvFor(['flagged'], { open: async (id) => left(id) });
    const rr = await csvFor(['flagged']);
    expect(r).toBe(rr);
    expect(cellsOf(r, 'flagged').N).toBe('flagged');
  });
  it('without a reader for the check (other callers): the column is there and blank', async () => {
    const r = await filmModels(['flagged'], deps({ points: true }));
    const csv = measurementsCsv(r.models, OPTS);
    expect(Object.values(cellsOf(csv, 'flagged')).every((v) => v === '')).toBe(true);
    expect(Object.keys(cellsOf(csv, 'flagged')).length).toBeGreaterThan(5);
  });
  // Positive control for the instrument (the cell reads the PLACING model's flag): emit N's flag from another model and
  // the cell for N must go blank. If this does not fail when pointCheckCell ignores the placer, it is blind.
  it('control: the same flag raised by a different model is not N\'s flag', async () => {
    const other = { runs: [], flags: [flag('srpose-cldet23', 'N')] };
    const mine = { runs: [], flags: [flag('aariz', 'N')] };
    expect((cellsOf(await csvFor(['f'], { pointChecks: async () => mine }), 'f')).N).toBe('flagged');
    expect((cellsOf(await csvFor(['f'], { pointChecks: async () => other }), 'f')).N).toBe('');
  });
});

