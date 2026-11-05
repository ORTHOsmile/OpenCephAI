// Spec 2026-10-20 (machine scale), task MS-7 (ruling P13: its own instrument, apart from
// norms/ageRowSweep.ts): every measurement of every analysis, for every film of a SYNTHETIC library, through the
// production path a Library ▸ Export CSV… takes — `filmModels` (export/batch.ts: evaluateFilm → buildReport) and
// `measurementsCsv`, Named and Anonymised, tidy and wide — so the films' docs read in two git states can be compared
// field by field. Uses nothing that is new in this branch, so the same file runs on main (Step 3).
import { compile } from '@ceph/geometry';
import { ALL_ANALYSES, buildRegistry, loadSets } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import type { NormContext } from '../norms/normCell';
import { DEFAULT_DECIMALS } from '../format';
import { filmModels, wordsByFilm, type BatchDeps } from './batch';
import { evaluateFilm } from './film';
import { measurementsCsv, type CsvLayout } from './measurementsCsv';

/** One (film, measurement): `key` is `film|analysis|measurement`, `film` the doc's timepoint (`build_library` names
 *  each film by it). `data` holds every field the screen, the report and the CSV show for that row and its film. */
export interface SweepRow { key: string; film: string; data: Record<string, unknown> }

const NOW = new Date('2026-10-25T00:00:00Z');
const SALT = '00112233445566778899aabbccddeeff';   // SYNTHETIC: a fixed anonymising salt, so the codes are the same in both states
const byTimepoint = (a: CaseDoc, b: CaseDoc) => (a.timepoint < b.timepoint ? -1 : a.timepoint > b.timepoint ? 1 : 0);

/** Every row of every doc, worked out as the Library's Export CSV… works it out. Throws when a film cannot be read
 *  (filmModels would leave it out) or the CSV does not hold one line per row. */
export async function sweepDocs(docs: CaseDoc[], norms: NormContext = { sets: loadSets(), userNorms: [], clinicDefault: null }): Promise<SweepRow[]> {
  const sorted = [...docs].sort(byTimepoint), byId = new Map(sorted.map((d) => [d.id, d]));
  const compiled = compile(buildRegistry(ALL_ANALYSES));
  const deps: BatchDeps = {
    open: async (id) => byId.get(id)!, readPicks: async () => ({}), readWords: async () => ({}),
    defs: ALL_ANALYSES, compiled, decimals: DEFAULT_DECIMALS, norms,
    wordsOf: wordsByFilm({ get: async () => null }, { explicit: null, login: 'SYNTHETIC Operator', names: [] }),
    titleOf: (m) => m, dateFormat: 'AU', now: NOW,
  };
  const { models, failed } = await filmModels(sorted.map((d) => d.id), deps);
  if (failed.length) throw new Error(`films could not be read: ${failed.join(', ')}`);
  const csv = (anonymise: boolean, layout: CsvLayout) =>
    measurementsCsv(models, { anonymise, layout, salt: SALT, exportedAt: NOW.toISOString(), decimals: DEFAULT_DECIMALS }).split('\r\n');
  const tidyRows = models.flatMap((m) => m.blocks.flatMap((b) => b.rows.map((r) => ({ m, r }))));
  const [named, anon, wideNamed, wideAnon] = [csv(false, 'tidy'), csv(true, 'tidy'), csv(false, 'wide'), csv(true, 'wide')];
  for (const [lines, n] of [[named, tidyRows.length], [anon, tidyRows.length], [wideNamed, models.length], [wideAnon, models.length]] as const)
    if (lines.length !== n + 2) throw new Error(`the CSV holds ${lines.length - 2} lines for ${n} rows`);
  const out: SweepRow[] = [];
  models.forEach((m, k) => {
    const doc = byId.get(m.caseId)!;
    const { rows, cells, scale } = evaluateFilm(doc, deps.defs, compiled, deps.decimals, norms, {});
    const { blocks, ...film } = m;
    rows.forEach((r, n) => {
      const at = tidyRows.findIndex((t) => t.m === m && t.r.analysisId === r.analysisId && t.r.node === r.node);
      if (at < 0) throw new Error(`${doc.timepoint}: no report row for ${r.analysisId}|${r.node}`);
      out.push({ key: `${doc.timepoint}|${r.analysisId}|${r.node}`, film: doc.timepoint, data: {
        row: { ...r }, cell: { ...cells[n] }, report: { ...tidyRows[at].r }, film,
        scale, mmPerPx: scale.mmPerPx, headerScale: m.header.scale,
        csvNamed: named[at + 1], csvAnon: anon[at + 1], wideNamed: wideNamed[k + 1], wideAnon: wideAnon[k + 1],
        blocks: blocks.map((b) => ({ ...b, rows: b.rows.length })),
      } });
    });
  });
  return out;
}

/** NaN and ±Infinity spelled out ('NaN', 'Infinity', '-Infinity'): plain JSON writes all three as null. */
const spell = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
/** A sweep as a file the other git state reads back, NaN and ±Infinity kept (as `same` spells them). */
export const toJson = (rows: SweepRow[]): string => JSON.stringify(rows, spell);
/** Same value, NaN equal to NaN, objects by their JSON with NaN and ±Infinity spelled out. */
const same = (a: unknown, b: unknown): boolean => JSON.stringify(a, spell) === JSON.stringify(b, spell);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export interface MachineSweepDiff {
  compared: number; changed: Record<string, number>; unexpected: string[];
  /** Per film, how many of its rows each field changed in (one level deep: `report.num`, `film.header`): the reasons. */
  fields: Record<string, Record<string, number>>;
}
/** Compares two sweeps row by row, every field, NaN-aware. A changed row of a film not in `mayChange` is `unexpected`.
 *  Throws when there is nothing to compare or the two do not hold the same rows. */
export function diffMachineSweeps(before: SweepRow[], after: SweepRow[], mayChange: Set<string>): MachineSweepDiff {
  if (!before.length || !after.length) throw new Error(`nothing compared (${before.length} before, ${after.length} after)`);
  const a = new Map(after.map((r) => [r.key, r]));
  if (a.size !== after.length || a.size !== before.length) throw new Error(`rows differ: ${before.length} before, ${after.length} after, ${a.size} distinct`);
  const d: MachineSweepDiff = { compared: 0, changed: {}, unexpected: [], fields: {} };
  for (const b of before) {
    const r = a.get(b.key); if (!r) throw new Error(`row ${b.key} missing after`);
    d.compared++;
    if (same(b.data, r.data)) continue;
    d.changed[b.film] = (d.changed[b.film] ?? 0) + 1;
    if (!mayChange.has(b.film)) d.unexpected.push(b.key);
    const f = (d.fields[b.film] ??= {}), count = (name: string) => { f[name] = (f[name] ?? 0) + 1; };
    for (const k of new Set([...Object.keys(b.data), ...Object.keys(r.data)])) {
      const x = b.data[k], y = r.data[k];
      if (same(x, y)) continue;
      if (isObj(x) && isObj(y)) { for (const s of new Set([...Object.keys(x), ...Object.keys(y)])) if (!same(x[s], y[s])) count(`${k}.${s}`); }
      else count(k);
    }
  }
  return d;
}
