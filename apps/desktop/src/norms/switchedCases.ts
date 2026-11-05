// Spec 2026-10-29 §4.8 and §8 (owner NAP-Q3 (b)): every old "Clinic default" film graded as it was and as the format-18
// upgrade leaves it (Auto, no background recorded), through the production export path (sweepDocs), and every row that
// differs listed. SYNTHETIC films only.
import { AUTO_CASE_POPULATION, loadSets } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import { numbers, populationSweep } from './populationSweep';

export interface SwitchedSide { norm: unknown; z: unknown; stars: unknown; source: unknown }
export interface SwitchedRow { film: string; analysis: string; measurement: string; numbersChanged: boolean; before: SwitchedSide; after: SwitchedSide }
export interface SwitchedDiff { compared: number; changed: SwitchedRow[] }

const spell = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
const same = (a: unknown, b: unknown) => JSON.stringify(a, spell) === JSON.stringify(b, spell);
const side = (d: Record<string, unknown>): SwitchedSide => {
  const c = (d.cell ?? {}) as Record<string, unknown>, r = (d.report ?? {}) as Record<string, unknown>;
  return { norm: c.text, z: c.z, stars: r.stars, source: c.sourceLine };
};

/** Grades `docs` on "Clinic default" (population null) and on Auto, with this clinic default, and lists every row
 *  that differs (numbersChanged: z, mean, SD, norm, band, severity, stars or value). Throws when there is nothing to
 *  compare or the two sides do not hold the same rows. */
export async function switchedCaseDiff(docs: CaseDoc[], clinicDefault: string | null): Promise<SwitchedDiff> {
  if (!docs.length) throw new Error('nothing compared (no switched films)');
  const norms = { sets: loadSets(), userNorms: [], clinicDefault };
  const before = await populationSweep(docs.map((d) => ({ ...d, population: null })), norms);
  const after = await populationSweep(docs.map((d) => ({ ...d, population: AUTO_CASE_POPULATION })), norms);
  // Each film keeps its timepoint (its key) on both sides; the population is not in it twice.
  const a = new Map(after.map((r) => [r.key, r]));
  if (a.size !== before.length || after.length !== before.length) throw new Error(`rows differ: ${before.length} before, ${after.length} after`);
  const out: SwitchedDiff = { compared: 0, changed: [] };
  for (const b of before) {
    const r = a.get(b.key); if (!r) throw new Error(`row ${b.key} missing after`);
    out.compared++;
    if (same(b.data, r.data)) continue;
    const [film, analysis, measurement] = b.key.split('|');
    out.changed.push({ film, analysis, measurement, numbersChanged: !same(numbers(b.data), numbers(r.data)), before: side(b.data), after: side(r.data) });
  }
  return out;
}
