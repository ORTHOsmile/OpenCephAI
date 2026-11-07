// Owner, 7 Nov 2026 (norms "data on file"): proof that renaming the website-sourced sets and rewording their source
// text moved no norm number. The same resolver grid runs at two git states: ONFILE_OUT=<file> writes this state's rows,
// ONFILE_BEFORE=<file> compares this state with them. A row's NUMBERS (kind, mean, sd, range, printed, colour, flags,
// the entry's measurement/sex/band/n/unit/centre/match, the age row used, the donor's numbers) must be identical; its
// WORDS (source line, set ids, reasons) are allowed to differ and are counted separately.
import { describe, it, expect } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { ALL_ANALYSES, CATALOGUE, POPULATIONS, loadSets, resolveNorm, type Resolved } from '../index';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};

export interface ProbeRow { key: string; numbers: unknown; words: unknown }

export function project(r: Resolved): { numbers: unknown; words: unknown } {
  if (r.kind !== 'norm') return { numbers: { kind: r.kind, population: r.kind === 'choose' ? r.population : null }, words: { reason: r.reason } };
  const e = r.entry;
  return {
    numbers: {
      kind: r.kind, mean: r.mean, sd: r.sd, range: r.range, printed: r.printed, colour: r.colour, flags: r.flags, ageRowUsed: r.ageRowUsed,
      entry: { measurement: e.measurement, sex: e.sex, ageBand: e.ageBand ?? null, mean: e.mean ?? null, sd: e.sd ?? null, range: e.range ?? null, n: e.n ?? null, unit: e.unit, centre: e.centre ?? null, definitionMatch: e.definitionMatch },
      donor: r.sdDonor ? { sex: r.sdDonor.sex, ageRowUsed: r.sdDonor.ageRowUsed, n: r.sdDonor.n } : null,
      auto: r.auto ? { population: r.auto.population, step: r.auto.step, n: r.auto.n } : null,
    },
    words: { sourceLine: r.sourceLine, setId: r.setId, donor: r.sdDonor ? { setId: r.sdDonor.setId, source: r.sdDonor.source } : null, auto: r.auto?.source ?? null, entrySource: e.source },
  };
}

export function grid(): ProbeRow[] {
  const sets = loadSets();
  const pops: (string | null)[] = [null, ...POPULATIONS.map((p) => p.id)];
  const rows: ProbeRow[] = [];
  for (const a of ALL_ANALYSES) {
    for (const c of CATALOGUE) {
      for (const population of pops) for (const sex of ['M', 'F', null] as const) for (const ageYears of [null, 12, 30]) {
        const r = resolveNorm({ measurement: c.id, analysisId: a.id, population, clinicDefault: null, sex, ageYears, sets, userNorms: [] });
        rows.push({ key: [a.id, c.id, population ?? 'none', sex ?? 'x', ageYears ?? 'x'].join('|'), ...project(r) });
      }
    }
  }
  return rows;
}

export function diffRows(before: ProbeRow[], after: ProbeRow[]): { compared: number; numbersChanged: string[]; wordsChanged: number } {
  if (!before.length || !after.length) throw new Error('nothing compared');
  if (before.length !== after.length) throw new Error(`rows differ: ${before.length} before, ${after.length} after`);
  const byKey = new Map(after.map((r) => [r.key, r]));
  if (byKey.size !== after.length) throw new Error('duplicate keys: rows would collapse');
  const numbersChanged: string[] = [];
  let wordsChanged = 0;
  for (const b of before) {
    const a = byKey.get(b.key);
    if (!a) throw new Error(`missing after: ${b.key}`);
    if (JSON.stringify(a.numbers) !== JSON.stringify(b.numbers)) numbersChanged.push(b.key);
    if (JSON.stringify(a.words) !== JSON.stringify(b.words)) wordsChanged++;
  }
  return { compared: before.length, numbersChanged, wordsChanged };
}

/** Owner, 7 Nov 2026 (NUS switch-on): the same comparison for a grid that GROWS (a new population or a new measure
 *  adds rows). Every row present in both states is compared; rows only after are listed as added, rows only before as
 *  removed. Never returns "no change" on nothing: an empty side or a duplicated key throws. */
export function diffGrowing(before: ProbeRow[], after: ProbeRow[]): { compared: number; added: string[]; removed: string[]; numbersChanged: string[]; wordsChanged: string[] } {
  if (!before.length || !after.length) throw new Error('nothing compared');
  const byKey = new Map(after.map((r) => [r.key, r]));
  if (byKey.size !== after.length || new Set(before.map((r) => r.key)).size !== before.length) throw new Error('duplicate keys: rows would collapse');
  const was = new Set(before.map((r) => r.key));
  const numbersChanged: string[] = [], wordsChanged: string[] = [], removed: string[] = [];
  let compared = 0;
  for (const b of before) {
    const a = byKey.get(b.key);
    if (!a) { removed.push(b.key); continue; }
    compared++;
    if (JSON.stringify(a.numbers) !== JSON.stringify(b.numbers)) numbersChanged.push(b.key);
    if (JSON.stringify(a.words) !== JSON.stringify(b.words)) wordsChanged.push(b.key);
  }
  return { compared, added: after.filter((r) => !was.has(r.key)).map((r) => r.key), removed, numbersChanged, wordsChanged };
}

describe('the on-file before/after instrument', () => {
  const base = (): ProbeRow => ({ key: 'k', numbers: { mean: 82, sd: 2 }, words: { sourceLine: 'x' } });
  it('sees a changed number, ignores changed words, and refuses empty or mismatched input (positive controls)', () => {
    expect(diffRows([base()], [base()])).toEqual({ compared: 1, numbersChanged: [], wordsChanged: 0 });
    expect(diffRows([base()], [{ ...base(), words: { sourceLine: 'y' } }])).toEqual({ compared: 1, numbersChanged: [], wordsChanged: 1 });
    expect(diffRows([base()], [{ ...base(), numbers: { mean: 82.1, sd: 2 } }]).numbersChanged).toEqual(['k']);
    expect(() => diffRows([], [base()])).toThrow('nothing compared');
    expect(() => diffRows([base()], [base(), { ...base(), key: 'j' }])).toThrow('rows differ');
    expect(() => diffRows([base()], [{ ...base(), key: 'j' }])).toThrow('missing after');
  });
  it('a growing grid: compares the shared rows, lists added and removed keys, refuses empty or duplicated input', () => {
    const k = (key: string, mean = 82): ProbeRow => ({ key, numbers: { mean }, words: { sourceLine: 'x' } });
    const d = diffGrowing([k('a'), k('b'), k('c')], [k('a'), k('b', 83), { ...k('c'), words: { sourceLine: 'y' } }, k('new')]);
    expect(d).toEqual({ compared: 3, added: ['new'], removed: [], numbersChanged: ['b'], wordsChanged: ['c'] });
    expect(diffGrowing([k('a'), k('gone')], [k('a')]).removed).toEqual(['gone']);
    expect(() => diffGrowing([], [k('a')])).toThrow('nothing compared');
    expect(() => diffGrowing([k('a')], [k('a'), k('a')])).toThrow('duplicate keys');
    expect(() => diffGrowing([k('a'), k('a')], [k('a')])).toThrow('duplicate keys');
  });
  it('projects a norm row with its numbers apart from its words', () => {
    const rows = grid().filter((r) => (r.numbers as { kind: string }).kind === 'norm');
    expect(rows.length).toBeGreaterThan(1000);
    expect(JSON.stringify(rows.map((r) => r.numbers))).not.toMatch(/page|source/i);
  });
  // ONFILE_GROW=<file> with ONFILE_BEFORE: compare a grown grid (diffGrowing) and write its key lists to <file>.
  const grow = env.ONFILE_GROW;
  (grow && env.ONFILE_BEFORE ? it : it.skip)('cross-state run of a growing grid (ONFILE_BEFORE + ONFILE_GROW)', () => {
    const was = JSON.parse(readFileSync(env.ONFILE_BEFORE!, 'utf8')) as { state: string; rows: ProbeRow[] };
    const rows = grid();
    const d = diffGrowing(was.rows, rows);
    const state = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    writeFileSync(grow!, JSON.stringify({ before: was.state, after: state, rowsBefore: was.rows.length, rowsAfter: rows.length, ...d }));
    console.log(`growing grid: before ${was.state} ${was.rows.length} rows, after ${state} ${rows.length} rows; compared ${d.compared}, added ${d.added.length}, removed ${d.removed.length}, numbers changed ${d.numbersChanged.length}, words changed ${d.wordsChanged.length}`);
    expect(d.removed).toEqual([]);
  });
  const out = env.ONFILE_OUT, before = grow ? undefined : env.ONFILE_BEFORE;
  (out || before ? it : it.skip)('cross-state run (set ONFILE_OUT to write, ONFILE_BEFORE to compare)', () => {
    const rows = grid();
    const state = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    if (out) writeFileSync(out, JSON.stringify({ state, rows }));
    if (before) {
      const was = JSON.parse(readFileSync(before, 'utf8')) as { state: string; rows: ProbeRow[] };
      const d = diffRows(was.rows, rows);
      const norms = was.rows.filter((r) => (r.numbers as { kind: string }).kind === 'norm').length;
      console.log(`on-file before/after: before ${was.state}, after ${state}; compared ${d.compared} (norm rows ${norms}), numbers changed ${d.numbersChanged.length}, words changed ${d.wordsChanged}`);
      expect(d.numbersChanged).toEqual([]);
    }
  });
});
