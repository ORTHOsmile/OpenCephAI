// Spec 2026-10-29 norms-auto-population §8: the before/after instrument's positive controls, and the
// cross-state run (POP_SWEEP_OUT writes this state's sweep; POP_SWEEP_BEFORE compares it with another state's).
import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES, SYNTHETIC_SKULLS, loadSets, populationsOffered } from '@ceph/analyses';
import { diffPopulationSweepFile, diffPopulationSweeps, populationDocs, populationSweep, readSweep, toJson, writeSweep, AGE_STATES, SEXES } from './populationSweep';
import type { SweepRow } from '../export/machineScaleSweep';
import { gitState, requireTwoStates } from '../sweepStates';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const row = (key: string, data: Record<string, unknown>): SweepRow => ({ key, film: key.split('|')[0], data });

describe('the population before/after instrument (spec §8)', () => {
  it('positive controls: sees a change, NaN equals NaN, refuses nothing or a missing row', () => {
    const a = [row('caucasian~M~dob-adult~s1|steiner|m01_SNA', { cell: { z: NaN, text: '82.0 ± 3.0°' } })];
    expect(diffPopulationSweeps(a, a)).toEqual({ compared: 1, changed: { untouched: 0, wordsOnly: 0, noPopulation: 0 }, unexpected: [], fields: {} });
    const moved = [row(a[0].key, { cell: { z: 1, text: '82.0 ± 3.0°' } })];
    expect(diffPopulationSweeps(a, moved).unexpected).toEqual([a[0].key]);
    expect(diffPopulationSweeps(JSON.parse(toJson(a)), a).unexpected).toEqual([]);
    expect(() => diffPopulationSweeps([], a)).toThrow('nothing compared');
    expect(() => diffPopulationSweeps(a, [])).toThrow('nothing compared');
    expect(() => diffPopulationSweeps([...a, row('chinese~F~none~s1|steiner|m01_SNA', {})], a)).toThrow('rows differ');
  });
  it('classifies: sex not recorded may change words only; no population may change only a "No norm" row', () => {
    const w = 'caucasian~-~dob-adult~s1|steiner|m02_SNB';
    const before = [row(w, { cell: { z: 1, normMean: 80.95, normSd: 3.28, text: '81.0 ± 3.3°', badges: ['sexes averaged'] }, report: { stars: '*', num: 85 } })];
    const words = [row(w, { cell: { z: 1, normMean: 80.95, normSd: 3.28, text: '81.0 ± 3.3°', badges: ['average of male and female'] }, report: { stars: '*', num: 85 } })];
    expect(diffPopulationSweeps(before, words)).toMatchObject({ changed: { wordsOnly: 1 }, unexpected: [] });
    const number = [row(w, { cell: { z: 2, normMean: 80.95, normSd: 3.28, text: '81.0 ± 3.3°', badges: [] }, report: { stars: '**', num: 85 } })];
    expect(diffPopulationSweeps(before, number).unexpected).toEqual([w]);
    const n = '-~M~dob-adult~s1|steiner|m18_PogNB';
    const none = [row(n, { cell: { z: null, text: 'No norm' } })];
    expect(diffPopulationSweeps(none, [row(n, { cell: { z: 0.5, text: '1.7 ± 1.1 mm' } })])).toMatchObject({ changed: { noPopulation: 1 }, unexpected: [] });
    const had = [row(n, { cell: { z: 0.5, text: '82.0 ± 3.0°' } })];
    expect(diffPopulationSweeps(had, [row(n, { cell: { z: 0.6, text: '82.0 ± 3.0°' } })]).unexpected).toEqual([n]);
    // No population, sex not recorded: words may change on a row that had a norm; a number may not.
    const u = '-~-~dob-adult~s1|steiner|m02_SNB';
    const wasAvg = [row(u, { cell: { z: 1, text: '81.0 ± 3.3°', badges: ['sexes averaged'] }, report: { stars: '*', num: 85 } })];
    expect(diffPopulationSweeps(wasAvg, [row(u, { cell: { z: 1, text: '81.0 ± 3.3°', badges: ['average of male and female'] }, report: { stars: '*', num: 85 } })]))
      .toMatchObject({ changed: { noPopulation: 1 }, unexpected: [] });
    expect(diffPopulationSweeps(wasAvg, [row(u, { cell: { z: 1.2, text: '81.0 ± 3.3°', badges: [] }, report: { stars: '*', num: 85 } })]).unexpected).toEqual([u]);
    // A no-population film whose Pog–NB gained a norm: its other rows may see only the FILM's lines change.
    const f = '-~M~dob-adult~s1|steiner|m01_SNA';
    const film0 = row(f, { cell: { z: 0.5, text: '82.0 ± 2.0°' }, csvNamed: 'x', film: { normSummary: null }, wideNamed: 'w' });
    expect(diffPopulationSweeps([film0], [row(f, { ...film0.data, film: { normSummary: 'We used …' }, wideNamed: 'w2' })]))
      .toMatchObject({ changed: { noPopulation: 1 }, unexpected: [] });
    expect(diffPopulationSweeps([film0], [row(f, { ...film0.data, csvNamed: 'y', film: { normSummary: 'We used …' } })]))
      .toMatchObject({ unexpected: [f], fields: { csvNamed: 1, 'film.normSummary': 1 } });
    // ... and with the sex recorded, not even words.
    const k = '-~M~dob-adult~s1|steiner|m02_SNB';
    expect(diffPopulationSweeps([row(k, { cell: { z: 1, text: 'a' } })], [row(k, { cell: { z: 1, text: 'b' } })]).unexpected).toEqual([k]);
  });
  it('the file the other git state reads: written one row per line, read back whole, NaN kept, a change still seen', async () => {
    const p = `/tmp/nap-sweep-roundtrip-${Date.now()}.ndjson`;
    const a = [row('caucasian~M~dob-adult~s1|steiner|m01_SNA', { cell: { z: NaN, text: '82.0 ± 3.0°' } }),
      row('caucasian~F~none~s1|steiner|m02_SNB', { cell: { z: 1.5, text: '80.0 ± 3.0°' } })];
    await writeSweep(p, 'state-A', a);
    const back = await readSweep(p);
    expect(back.gitState).toBe('state-A');
    expect(back.rows.length).toBe(2);
    expect(diffPopulationSweeps(back.rows, a)).toMatchObject({ compared: 2, unexpected: [] });
    expect(diffPopulationSweeps(back.rows, [a[0], row(a[1].key, { cell: { z: 1.6, text: '80.0 ± 3.0°' } })]).unexpected).toEqual([a[1].key]);
    // The streamed compare (the cross-state run uses it): the same answers and the same refusals.
    expect((await diffPopulationSweepFile(p, a))).toMatchObject({ gitState: 'state-A', diff: { compared: 2, unexpected: [] } });
    expect((await diffPopulationSweepFile(p, [a[0], row(a[1].key, { cell: { z: 1.6, text: '80.0 ± 3.0°' } })])).diff.unexpected).toEqual([a[1].key]);
    await expect(diffPopulationSweepFile(p, [a[0]])).rejects.toThrow('missing after');
    await expect(diffPopulationSweepFile(p, [...a, row('extra|steiner|m01_SNA', {})])).rejects.toThrow('rows differ');
    await expect(diffPopulationSweepFile(p, [a[0], row('other|steiner|m01_SNA', {})])).rejects.toThrow('missing after');
  });
  it('the sweep holds one row per film per measurement, counted from the sources', async () => {
    const docs = populationDocs();
    const pops = 1 + populationsOffered(loadSets(), []).length;   // "Clinic default" (null) + every offered population
    expect(docs.length).toBe(SYNTHETIC_SKULLS.length * pops * SEXES.length * AGE_STATES.length);
    const one = await populationSweep(docs.slice(0, 2));
    expect(one.length).toBe(2 * ALL_ANALYSES.reduce((k, a) => k + a.measurements.length, 0));
  });
  it('a changed cell is seen through the whole export path (positive control: sex flipped on one film)', async () => {
    const docs = populationDocs().filter((d) => d.population === 'caucasian').slice(0, 1);
    const flipped = docs.map((d) => ({ ...d, gender: d.gender === 'M' ? ('F' as const) : ('M' as const) }));
    const d = diffPopulationSweeps(await populationSweep(docs), (await populationSweep(flipped)).map((r) => ({ ...r })));
    expect(d.unexpected.length).toBeGreaterThan(0);
  });
  // Final review M1 (2 Nov 2026): the direct control — a different hand-chosen population on the same film is seen
  // through the whole export path (not only a sex flip).
  it('a changed population is seen through the whole export path (positive control: Caucasian → Chinese on one film)', async () => {
    const docs = populationDocs().filter((d) => d.population === 'caucasian' && d.gender === 'M').slice(0, 1);
    const moved = docs.map((d) => ({ ...d, population: 'chinese' }));
    const d = diffPopulationSweeps(await populationSweep(docs), await populationSweep(moved));
    expect(d.compared).toBe(ALL_ANALYSES.reduce((k, a) => k + a.measurements.length, 0));
    expect(d.unexpected.length).toBeGreaterThan(0);
    expect(d.changed.untouched).toBe(d.unexpected.length);
  });
  // Final review M1: a hand-chosen population with a recorded sex does not depend on the clinic default (one skull,
  // every offered population, both sexes, three ages: 66 films). In this git state only: the before file was written
  // with no clinic default.
  it('a hand-chosen population with a recorded sex grades the same whatever the clinic default', async () => {
    const skull = populationDocs()[0].timepoint.split('~')[3];
    const docs = populationDocs().filter((d) => d.population !== null && d.gender !== null && d.timepoint.endsWith(skull));
    const none = await populationSweep(docs, { sets: loadSets(), userNorms: [], clinicDefault: null });
    const set = await populationSweep(docs, { sets: loadSets(), userNorms: [], clinicDefault: 'caucasian' });
    const d = diffPopulationSweeps(none, set);
    expect([docs.length, d.compared, d.unexpected.length, d.changed.untouched]).toEqual([66, 66 * 130, 0, 0]);
  }, 600_000);
  it('hand-chosen population + recorded sex: 0 changed, across two git states (in the ordinary suite: a self-check only)', async () => {
    const here = await gitState();
    const after = await populationSweep();
    if (env.POP_SWEEP_OUT) await writeSweep(env.POP_SWEEP_OUT, here, after);
    let d = diffPopulationSweeps(after, after);
    if (env.POP_SWEEP_BEFORE) {
      const b = await diffPopulationSweepFile(env.POP_SWEEP_BEFORE, after);
      requireTwoStates(b.gitState, here, env.POP_SWEEP_SELF_CHECK === '1');
      console.log(`population before/after: before ${b.gitState}, after ${here}`);
      d = b.diff;
    }
    console.log(`population before/after: compared ${d.compared}, changed ${JSON.stringify(d.changed)}, unexpected ${d.unexpected.length}`);
    expect(d.compared).toBe(after.length);
    if (d.unexpected.length) console.log(`population before/after: first unexpected rows ${JSON.stringify(d.unexpected.slice(0, 10))}; fields ${JSON.stringify(d.fields)}`);
    expect(d.unexpected).toEqual([]);
    expect(d.changed.untouched).toBe(0);
  }, 600_000);
});
