// Owner AG1 (19 Oct): every norm cell of every measurement of every analysis, for SYNTHETIC skulls and
// SYNTHETIC films, for every population — through the production path (measurementRows → queryFor → resolveNorm →
// normCell). Run in two git states and compared with diffSweeps. Uses nothing that is new in this branch, so the
// same file runs on main.
import { compile } from '@ceph/geometry';
import { ALL_ANALYSES, SYNTHETIC_SKULLS, buildRegistry, loadSets, populationsOffered, resolveNorm } from '@ceph/analyses';
import { measurementRows } from '../measurements';
import { normCell, queryFor } from './normCell';
import { DEFAULT_DECIMALS } from '../format';

export interface SweepFilm { id: string; gender: 'F' | 'M' | null; dateOfBirth: string | null; takenOn: string | null; ageOnFilmYears: number | null }
export const SWEEP_FILMS: SweepFilm[] = [
  { id: 'dob-adult', gender: 'M', dateOfBirth: '1996-01-02', takenOn: '2026-01-10', ageOnFilmYears: null },                    // SYNTHETIC
  { id: 'dob-child', gender: 'F', dateOfBirth: '2014-01-02', takenOn: '2026-01-10', ageOnFilmYears: null },                    // SYNTHETIC
  { id: 'dob-child-film-says-9', gender: 'F', dateOfBirth: '2014-01-02', takenOn: '2026-01-10', ageOnFilmYears: 9 },            // SYNTHETIC: DOB wins
  { id: 'dob-no-film-date-film-says-11', gender: 'M', dateOfBirth: '2014-01-02', takenOn: null, ageOnFilmYears: 11 },          // SYNTHETIC: R1
  { id: 'nodob-none', gender: null, dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: null },                          // SYNTHETIC
  { id: 'nodob-11', gender: 'M', dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: 11 },                               // SYNTHETIC
  { id: 'nodob-11y3m', gender: 'F', dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: 11.25 },                         // SYNTHETIC
  { id: 'nodob-30', gender: 'F', dateOfBirth: null, takenOn: '2026-01-10', ageOnFilmYears: 30 },                               // SYNTHETIC
  { id: 'nodob-8-no-film-date', gender: null, dateOfBirth: null, takenOn: null, ageOnFilmYears: 8 },                           // SYNTHETIC
];
/** May the norm row of this film change (owner AG1)? Only with no DOB and an age. */
export const mayChange = (f: SweepFilm) => !f.dateOfBirth && f.ageOnFilmYears !== null;
export interface SweepRow { key: string; film: string; cell: unknown }
/** `cellOf` is the production `normCell`; a test passes a changed one as a positive control (final review M3). */
export function sweep(films: SweepFilm[] = SWEEP_FILMS, cellOf: typeof normCell = normCell): SweepRow[] {
  const sets = loadSets(), ctx = { sets, userNorms: [], clinicDefault: null };
  const pops: (string | null)[] = [null, ...populationsOffered(sets, []).map((p) => p.id)];
  const g = compile(buildRegistry(ALL_ANALYSES));
  const out: SweepRow[] = [];
  for (const s of SYNTHETIC_SKULLS) {
    const rows = measurementRows(ALL_ANALYSES, g, g.evaluate(s.points, 0.1), new Set(Object.keys(s.points)), DEFAULT_DECIMALS);
    for (const f of films) for (const population of pops) for (const r of rows) {
      const q = queryFor(r.node, r.normAnalysisId, { ...f, population }, ctx);
      const c = cellOf(r.num, resolveNorm(q), q, DEFAULT_DECIMALS);
      out.push({ key: `${f.id}|${s.name}|${population ?? '-'}|${r.analysisId}|${r.node}`, film: f.id,
        cell: { ...c } });   // every field, whole (severity and badges included: final review M3), so none is ever left out
    }
  }
  return out;
}
/** NaN and ±Infinity spelled out ('NaN', 'Infinity', '-Infinity'): plain JSON writes all three as null. */
const spellNonFinite = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
/** A sweep as the JSON file the other git state reads back (AGE_ROW_OUT / AGE_ROW_BEFORE) — with NaN and ±Infinity
 *  spelled as `same` spells them, so a NaN written in one state still equals a NaN computed in the other. */
export const toJson = (rows: SweepRow[]): string => JSON.stringify(rows, spellNonFinite);
/** Same value, NaN equal to NaN, objects by their JSON with NaN and ±Infinity spelled out. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a, spellNonFinite) === JSON.stringify(b, spellNonFinite);
export interface SweepDiff { compared: number; changed: Record<string, number>; unexpected: string[] }
/** Compares two sweeps row by row. Throws when there is nothing to compare or the two do not hold the same rows. */
export function diffSweeps(before: SweepRow[], after: SweepRow[], films: SweepFilm[] = SWEEP_FILMS): SweepDiff {
  if (!before.length || !after.length) throw new Error(`nothing compared (${before.length} before, ${after.length} after)`);
  const a = new Map(after.map((r) => [r.key, r]));
  if (a.size !== after.length || a.size !== before.length) throw new Error(`rows differ: ${before.length} before, ${after.length} after, ${a.size} distinct`);
  const may = new Map(films.map((f) => [f.id, mayChange(f)]));
  const d: SweepDiff = { compared: 0, changed: {}, unexpected: [] };
  for (const b of before) {
    const r = a.get(b.key); if (!r) throw new Error(`row ${b.key} missing after`);
    d.compared++;
    if (same(b.cell, r.cell)) continue;
    d.changed[b.film] = (d.changed[b.film] ?? 0) + 1;
    if (!may.get(b.film)) d.unexpected.push(b.key);
  }
  return d;
}
