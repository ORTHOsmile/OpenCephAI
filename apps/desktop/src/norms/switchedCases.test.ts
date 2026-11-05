// Spec 2026-10-29 §4.8 and §8 (owner NAP-Q3 (b)): the old "Clinic default" films graded as they were and as the
// format-18 upgrade leaves them (Auto, no background), through the production export path. SYNTHETIC films only.
import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES } from '@ceph/analyses';
import { populationDocs } from './populationSweep';
import { switchedCaseDiff } from './switchedCases';
import { SWITCHED_STAR_CHANGES } from './AutoSwitchNote';

const clinicDefaultDocs = () => populationDocs().filter((d) => d.population === null);
const perFilm = ALL_ANALYSES.reduce((k, a) => k + a.measurements.length, 0);

describe('owner NAP-Q3 (b): old "Clinic default" cases switched to Auto — before and after, through the export path', () => {
  it('with a clinic default set and no background: no number changes; only words (the report sentence bracket)', async () => {
    const docs = clinicDefaultDocs();
    const d = await switchedCaseDiff(docs, 'caucasian');
    console.log(`switched cases, clinic default Caucasian: ${d.changed.length} of ${d.compared} rows differ, ${d.changed.filter((r) => r.numbersChanged).length} in a number`);
    expect(d.compared).toBe(docs.length * perFilm);
    expect(d.changed.filter((r) => r.numbersChanged)).toEqual([]);
    // Task 11: the report sentence gains "(chosen automatically: clinic default)" — seen, on words only.
    expect(d.changed.length).toBeGreaterThan(0);
  }, 600_000);
  it('with no clinic default: the changed rows are listed and counted', async () => {
    const docs = clinicDefaultDocs();
    const d = await switchedCaseDiff(docs, null);
    expect(d.compared).toBe(docs.length * perFilm);
    const moved = d.changed.filter((r) => r.numbersChanged);
    console.log(`switched cases, no clinic default: ${moved.length} of ${d.compared} rows changed a number, over ${new Set(moved.map((r) => r.film)).size} of ${docs.length} films`);
    const byAnalysis = new Map<string, number>();
    for (const r of moved) byAnalysis.set(r.analysis, (byAnalysis.get(r.analysis) ?? 0) + 1);
    console.log(`switched cases, no clinic default, by analysis: ${JSON.stringify(Object.fromEntries([...byAnalysis].sort()))}`);
    expect(moved.length).toBeGreaterThan(0);
    // Owner R3 (3 Nov 2026): the note's figure — rows whose stars changed, of every row of the switched films.
    const stars = d.changed.filter((r) => r.before.stars !== r.after.stars);
    const adultFilm = (f: string) => !f.includes('~dob-child~');
    console.log(`switched cases, no clinic default: stars changed on ${stars.length} of ${d.compared} rows (1 in ${(d.compared / stars.length).toFixed(1)}); adult and age-unknown films ${stars.filter((r) => adultFilm(r.film)).length} of ${d.compared * 2 / 3}, child films ${stars.filter((r) => !adultFilm(r.film)).length} of ${d.compared / 3}`);
    expect(stars.length).toBe(SWITCHED_STAR_CHANGES);
    // A known row (spec §6): a SYNTHETIC woman of 30 — Steiner's SNA leaves Steiner 1953 for the combined adult norm
    // (owner R1/R5, 3 Nov 2026); a girl of 12 still gets the largest study for her sex and age.
    const sna = moved.find((r) => r.film.startsWith('-~F~dob-adult~') && r.analysis === 'steiner' && r.measurement === 'm01_SNA');
    console.log(`SNA, woman of 30: ${JSON.stringify(sna)}`);
    expect(String(sna?.before.source)).toMatch(/^Steiner 1953/);
    expect(String(sna?.after.source)).toMatch(/^Combined adult norm, women: 8 studies, 290 people \(/);
    const girl = moved.find((r) => r.film.startsWith('-~F~dob-child~') && r.analysis === 'steiner' && r.measurement === 'm01_SNA');
    expect(String(girl?.after.source)).toMatch(/^Thilander 2005/);
  }, 600_000);
  it('positive control: a background recorded with a clinic default set must change numbers', async () => {
    const docs = clinicDefaultDocs().slice(0, 3).map((x) => ({ ...x, background: 'chinese' }));
    expect((await switchedCaseDiff(docs, 'caucasian')).changed.filter((r) => r.numbersChanged).length).toBeGreaterThan(0);
  }, 600_000);
  it('refuses nothing', async () => {
    await expect(switchedCaseDiff([], null)).rejects.toThrow('nothing compared');
  });
});
