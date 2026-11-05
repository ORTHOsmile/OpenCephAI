import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES } from '@ceph/analyses';
import type { CaseDoc, MachineScale } from '../ipc';
import { synthDoc } from '../report/fixtures';
import { diffMachineSweeps, sweepDocs, toJson, type SweepRow } from './machineScaleSweep';
import { requireTwoStates, unstamp } from '../sweepStates';

// The repo has no @types/node: node:fs and the environment are reached type-erased, as export/unadjusted.golden.test.ts does.
const FS = 'node:fs';
const fs = (await import(/* @vite-ignore */ FS)) as { readFileSync: (p: string, e: 'utf8') => string; writeFileSync: (p: string, d: string) => void };
const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const PER_FILM = ALL_ANALYSES.reduce((k, a) => k + a.measurements.length, 0);   // counted from the sources, not from the sweep
/** The live films `build_library` (crates/ceph-store/tests/machine_scale_sweep.rs) makes; g-deleted is in Recently
 *  deleted, so the Library's Export CSV never offers it and `dump_docs` leaves it out. */
const LIVE = ['a-ruler', 'b-match', 'c-match', 'd-size', 'e-fitted', 'f-fitted-off', 'h-other', 'i-none'];
const MAY = new Set(['b-match', 'c-match', 'e-fitted']);
// SYNTHETIC: a machine scale that applies to the synthetic film (1200 x 1400).
const machine = (applies: boolean): MachineScale => ({ machineId: 'm1', machineName: 'SYNTHETIC Radiology', spacingMm: 0.0998, widthPx: 1200, heightPx: 1400,
  source: 'entered', sourceCaseId: null, sourceFilmDate: null, setAt: '2026-10-25T00:00:00.000Z', applies });

describe('the machine-scale before/after instrument (spec 2026-10-20)', () => {
  it('positive controls: a machine scale moves the rows through the production path, and nothing else does', async () => {
    const plain = synthDoc({ id: 'c1', timepoint: 'x-plain', spacingMm: null }), other = synthDoc({ id: 'c2', timepoint: 'x-other', spacingMm: null });
    const before = await sweepDocs([plain, other]);
    expect(before.length).toBe(2 * PER_FILM);
    // A film of the machine whose scale applies: assumed -> 0.0998; its mm appear. A size that does not match: nothing.
    const after = await sweepDocs([{ ...plain, machineScale: machine(true) }, { ...other, machineScale: machine(false) }]);
    const d = diffMachineSweeps(before, after, new Set(['x-plain']));
    expect(d).toMatchObject({ compared: 2 * PER_FILM, unexpected: [] });
    expect(d.changed['x-plain']).toBe(PER_FILM);                  // the CSV `scale` cell is on every row of the film
    expect(d.changed['x-other'] ?? 0).toBe(0);
    expect(d.fields['x-plain']['report.num']).toBeGreaterThan(0);  // mm that were hidden now carry numbers
    expect(d.fields['x-plain']['headerScale']).toBe(PER_FILM);
    // The same change on a film that may NOT change is reported unexpected.
    expect(diffMachineSweeps(before, after, new Set()).unexpected.length).toBe(PER_FILM);
  });
  it('positive controls: NaN equals NaN across the file, a moved value is seen, nothing to compare and differing rows throw', () => {
    const rows: SweepRow[] = [{ key: 'a|s|m1', film: 'a', data: { z: NaN, i: Infinity, j: -Infinity, n: null } }, { key: 'b|s|m1', film: 'b', data: { z: 1 } }];
    expect(diffMachineSweeps(JSON.parse(toJson(rows)), rows, new Set())).toMatchObject({ compared: 2, changed: {}, unexpected: [] });
    const moved = [{ ...rows[0], data: { z: NaN, i: Infinity, j: -Infinity, n: 0 } }, rows[1]];
    expect(diffMachineSweeps(rows, moved, new Set(['b']))).toMatchObject({ compared: 2, changed: { a: 1 }, unexpected: ['a|s|m1'] });
    expect(() => diffMachineSweeps([], [], new Set())).toThrow('nothing compared');
    expect(() => diffMachineSweeps(rows, rows.slice(1), new Set())).toThrow('rows differ');
    expect(() => diffMachineSweeps(rows, [rows[0], { ...rows[1], key: 'b|s|m2' }], new Set())).toThrow('missing after');
  });
  it.runIf(!!env.MS_SWEEP_OUT && !!env.MS_BEFORE)('writes the sweep of the before docs (Step 3: main and branch read them alike)', async () => {
    const docs = unstamp<CaseDoc[]>(JSON.parse(fs.readFileSync(env.MS_BEFORE!, 'utf8'))).rows;
    fs.writeFileSync(env.MS_SWEEP_OUT!, toJson(await sweepDocs(docs)));
  });
  it.runIf(!!env.MS_BEFORE && !!env.MS_AFTER)('only the films that may change, change; every other row is bit-identical', async () => {
    // Final review M7 (ruling): the two dumps (`dump_docs`, stamped) must come from two git states, unless
    // MS_SELF_CHECK=1 says a self-check is meant.
    const b = unstamp<CaseDoc[]>(JSON.parse(fs.readFileSync(env.MS_BEFORE!, 'utf8'))), a = unstamp<CaseDoc[]>(JSON.parse(fs.readFileSync(env.MS_AFTER!, 'utf8')));
    requireTwoStates(b.gitState, a.gitState, env.MS_SELF_CHECK === '1');
    console.log(`machine scale before/after: before ${b.gitState ?? 'unstamped'}, after ${a.gitState ?? 'unstamped'}`);
    const before = b.rows, after = a.rows;
    for (const docs of [before, after]) expect(docs.map((x) => x.timepoint).sort()).toEqual([...LIVE].sort());
    const d = diffMachineSweeps(await sweepDocs(before), await sweepDocs(after), MAY);
    console.log(`machine scale before/after: ${d.compared} rows compared (expected ${LIVE.length * PER_FILM}); changed by film ${JSON.stringify(d.changed)}; unexpected ${d.unexpected.length}`);
    console.log(`machine scale fields changed by film: ${JSON.stringify(d.fields)}`);
    if (d.unexpected.length) console.log(`first unexpected: ${d.unexpected.slice(0, 5).join(', ')}`);
    expect(d.compared).toBe(LIVE.length * PER_FILM);   // 8 live films, counted from the sources
    expect(d.unexpected).toEqual([]);
    for (const f of MAY) expect(d.changed[f] ?? 0, f).toBeGreaterThan(0);   // cannot fail to move: assumed -> 0.0998
  });
});
