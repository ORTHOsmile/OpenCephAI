// Spec 2026-11-03 combined adult norm, plan Task 1: films on Auto with no background and no clinic
// default — 6 SYNTHETIC skulls × sex M, F, not recorded × three age states — through the export path, written in one
// git state (AUTO_SWEEP_OUT) and compared in another (AUTO_SWEEP_BEFORE). A child film (age 12) may change nothing at
// all; an adult or age-unknown film is counted (rows that change a number, rows that change their stars).
import { describe, it, expect } from 'vitest';
import { AUTO_CASE_POPULATION, ALL_ANALYSES } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import { numbers, populationDocs, populationSweep, readSweep, writeSweep } from './populationSweep';
import type { SweepRow } from '../export/machineScaleSweep';
import { gitState, requireTwoStates } from '../sweepStates';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
const perFilm = ALL_ANALYSES.reduce((k, a) => k + a.measurements.length, 0);
const autoDocs = (): CaseDoc[] => populationDocs().filter((d) => d.population === null).map((d) => ({ ...d, population: AUTO_CASE_POPULATION }));
const norms = async () => ({ sets: (await import('@ceph/analyses')).loadSets(), userNorms: [], clinicDefault: null });

const spell = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a, spell) === JSON.stringify(b, spell);
const stars = (d: Record<string, unknown>) => ((d.report ?? {}) as { stars?: unknown }).stars;

export interface AutoDiff { compared: number; childChanged: string[]; adultChanged: number; adultNumbers: number; adultStars: number }
export function diffAutoSweeps(before: SweepRow[], after: SweepRow[]): AutoDiff {
  if (!before.length || !after.length) throw new Error(`nothing compared (${before.length} before, ${after.length} after)`);
  const a = new Map(after.map((r) => [r.key, r]));
  if (a.size !== before.length || after.length !== before.length) throw new Error(`rows differ: ${before.length} before, ${after.length} after`);
  const d: AutoDiff = { compared: 0, childChanged: [], adultChanged: 0, adultNumbers: 0, adultStars: 0 };
  for (const b of before) {
    const r = a.get(b.key); if (!r) throw new Error(`row ${b.key} missing after`);
    d.compared++;
    if (same(b.data, r.data)) continue;
    if (b.film.includes('~dob-child~')) { d.childChanged.push(b.key); continue; }
    d.adultChanged++;
    if (!same(numbers(b.data), numbers(r.data))) d.adultNumbers++;
    if (!same(stars(b.data), stars(r.data))) d.adultStars++;
  }
  return d;
}

describe('Auto films, no background and no clinic default: before/after (plan Task 1)', () => {
  it('positive controls: a child film with its sex flipped is seen; nothing and missing rows refused', async () => {
    const docs = autoDocs().filter((d) => d.timepoint.includes('~dob-child~') && d.gender === 'M').slice(0, 1);
    const flipped = docs.map((d) => ({ ...d, gender: 'F' as const }));
    const n = await norms();
    const before = await populationSweep(docs, n), after = await populationSweep(flipped, n);
    expect(before.length).toBe(perFilm);
    expect(diffAutoSweeps(before, after).childChanged.length).toBeGreaterThan(0);
    expect(diffAutoSweeps(before, before)).toEqual({ compared: perFilm, childChanged: [], adultChanged: 0, adultNumbers: 0, adultStars: 0 });
    expect(() => diffAutoSweeps([], before)).toThrow('nothing compared');
    expect(() => diffAutoSweeps(before, before.slice(1))).toThrow('rows differ');
  }, 600_000);
  it('children unchanged across two git states; adults counted (in the ordinary suite: a self-check only)', async () => {
    const here = await gitState();
    const docs = autoDocs();
    const after = await populationSweep(docs, await norms());
    expect(after.length).toBe(docs.length * perFilm);
    if (env.AUTO_SWEEP_OUT) await writeSweep(env.AUTO_SWEEP_OUT, here, after);
    let d = diffAutoSweeps(after, after);
    if (env.AUTO_SWEEP_BEFORE) {
      const b = await readSweep(env.AUTO_SWEEP_BEFORE);
      requireTwoStates(b.gitState, here, env.AUTO_SWEEP_SELF_CHECK === '1');
      console.log(`auto before/after: before ${b.gitState}, after ${here}`);
      d = diffAutoSweeps(b.rows, after);
    }
    const children = after.filter((r) => r.film.includes('~dob-child~')).length;
    console.log(`auto before/after: compared ${d.compared} (children ${children}), children changed ${d.childChanged.length}, adult rows changed ${d.adultChanged}, in a number ${d.adultNumbers}, in their stars ${d.adultStars}`);
    expect(d.compared).toBe(after.length);
    expect(d.childChanged.slice(0, 10)).toEqual([]);
  }, 600_000);
});
