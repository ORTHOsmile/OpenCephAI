import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES, SYNTHETIC_SKULLS, loadSets, populationsOffered } from '@ceph/analyses';
import { diffSweeps, mayChange, sweep, SWEEP_FILMS, toJson, type SweepRow } from './ageRowSweep';
import { normCell } from './normCell';
import { gitState, requireTwoStates, unstamp } from '../sweepStates';

// The repo has no @types/node: node:fs and the environment are reached type-erased, as export/unadjusted.golden.test.ts does.
const FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ FS)) as { readFileSync: (p: string, e: 'utf8') => string; writeFileSync: (p: string, d: string) => void };
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const strip = SWEEP_FILMS.map((f) => ({ ...f, ageOnFilmYears: null }));   // "today": no film age anywhere
const expected = SWEEP_FILMS.length * SYNTHETIC_SKULLS.length * (1 + populationsOffered(loadSets(), []).length)
  * ALL_ANALYSES.reduce((n, a) => n + a.measurements.length, 0);           // counted from the sources, not from the sweep
describe('the age-row before/after instrument (owner AG1)', () => {
  it('positive controls: it sees a change, treats NaN as NaN, and refuses to compare nothing', () => {
    const rows: SweepRow[] = [{ key: 'dob-adult|k', film: 'dob-adult', cell: { z: NaN } }, { key: 'nodob-11|k', film: 'nodob-11', cell: { z: 1 } }];
    expect(diffSweeps(rows, rows)).toEqual({ compared: 2, changed: {}, unexpected: [] });
    const moved = [{ ...rows[0], cell: { z: 0 } }, { ...rows[1], cell: { z: 2 } }];
    expect(diffSweeps(rows, moved)).toEqual({ compared: 2, changed: { 'dob-adult': 1, 'nodob-11': 1 }, unexpected: ['dob-adult|k'] });
    // Ruling I-6: a field outside the old hand-picked list (normMean, the CSV's norm_mean) is seen too.
    const moved2 = [{ ...rows[0], cell: { z: NaN, normMean: 1 } }, rows[1]];
    expect(diffSweeps(rows, moved2).changed).toEqual({ 'dob-adult': 1 });
    // Task 12 (beyond the brief): the before/after crosses git states through a JSON file; plain JSON writes NaN as
    // null, which would read as "changed" against an in-memory NaN. The file must round-trip NaN and ±Infinity.
    const odd: SweepRow[] = [{ key: 'dob-adult|k', film: 'dob-adult', cell: { z: NaN, a: Infinity, b: -Infinity, c: null } }];
    expect(diffSweeps(JSON.parse(toJson(odd)), odd)).toEqual({ compared: 1, changed: {}, unexpected: [] });
    expect(diffSweeps(JSON.parse(toJson(odd)), [{ ...odd[0], cell: { z: NaN, a: Infinity, b: -Infinity, c: 0 } }]).changed).toEqual({ 'dob-adult': 1 });
    expect(() => diffSweeps([], rows)).toThrow('nothing compared');
    expect(() => diffSweeps(rows, rows.slice(1))).toThrow('rows differ');
  });
  it('final review M3: every field of a cell is compared, the whole severity and every badge included', () => {
    // Positive controls that cannot fail to move: the severity's side flipped with its word kept, and a badge's
    // text changed with its flag kept. A sweep that shortens severity to its word, or badges to their flags, sees
    // neither.
    const films = [SWEEP_FILMS[0]];
    const base = sweep(films);
    const side = sweep(films, (...a) => { const c = normCell(...a);
      return c.severity ? { ...c, severity: { ...c.severity, side: c.severity.side === 'above' ? 'below' : 'above' } } : c; });
    expect(base.filter((r) => (r.cell as { severity: unknown }).severity !== null).length).toBeGreaterThan(0);   // there is a severity to flip
    expect(diffSweeps(base, side, films).changed['dob-adult'] ?? 0).toBeGreaterThan(0);
    const badge = sweep(films, (...a) => { const c = normCell(...a); return { ...c, badges: c.badges.map((b) => ({ ...b, badge: `${b.badge}!`, tip: `${b.tip}!` })) }; });
    expect(base.filter((r) => (r.cell as { badges: unknown[] }).badges.length > 0).length).toBeGreaterThan(0);  // there is a badge to change
    expect(diffSweeps(base, badge, films).changed['dob-adult'] ?? 0).toBeGreaterThan(0);
  });
  // Final review M7 (ruling): the before must come from ANOTHER git state. AGE_ROW_OUT writes the sweep
  // stamped with this checkout's state; AGE_ROW_BEFORE reads one and refuses it if it is this same state (or does not
  // say), unless AGE_ROW_SELF_CHECK=1. With no AGE_ROW_BEFORE (the ordinary suite) the before is this same code with
  // the film ages taken away: an explicit SELF-CHECK only, never the evidence — that is the cross-state run.
  it('the age row moves only for no-DOB films with an age; every other row bit-identical (in the suite: a self-check of this state only)', async () => {
    const here = await gitState();
    const after = sweep();
    if (env.AGE_ROW_OUT) fs.writeFileSync(env.AGE_ROW_OUT, `{"gitState":${JSON.stringify(here)},"rows":${toJson(after)}}`);
    let before: SweepRow[];
    if (env.AGE_ROW_BEFORE) {
      const b = unstamp<SweepRow[]>(JSON.parse(fs.readFileSync(env.AGE_ROW_BEFORE, 'utf8')));
      requireTwoStates(b.gitState, here, env.AGE_ROW_SELF_CHECK === '1');
      console.log(`age row before/after: before ${b.gitState ?? 'unstamped'}, after ${here}`);
      before = b.rows;
    } else {
      // Explicit self-check of this state against itself. Not a call to `requireTwoStates`: with selfCheck=true it
      // is a no-op for any arguments (`sweepStates.test.ts` already covers that branch, with its own positive
      // controls at lines 8-9 and 18 — a same-state pair refused when selfCheck is false, let through when true).
      before = sweep(strip);
    }
    const d = diffSweeps(before, after);
    console.log(`age row before/after: ${d.compared} rows compared (expected ${expected}); changed by film ${JSON.stringify(d.changed)}; unexpected ${d.unexpected.length}`);
    expect(d.compared).toBe(expected);
    expect(d.unexpected).toEqual([]);
    for (const f of SWEEP_FILMS.filter((x) => !mayChange(x))) expect(d.changed[f.id] ?? 0, f.id).toBe(0);
    expect(d.changed['nodob-11'] ?? 0).toBeGreaterThan(0);                // the change itself is seen (cannot fail to move: 11 vs adult)
  });
});
