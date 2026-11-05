// Spec 2026-10-29 norms-auto-population §8: every measurement of every analysis, for SYNTHETIC films
// (six synthetic skulls × every offered population chosen by hand and "Clinic default" × sex M, F, not recorded × three
// age states), through the production path Library ▸ Export CSV… takes (machineScaleSweep.sweepDocs: filmModels →
// evaluateFilm → buildReport → measurementsCsv, Named and Anonymised, tidy and wide). Run in two git states and
// compared with diffPopulationSweeps. Uses nothing new in this branch, so the same file runs on the base commit.
import { SYNTHETIC_SKULLS, loadSets, populationsOffered } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import { synthDoc } from '../report/fixtures';
import { sweepDocs, type SweepRow } from '../export/machineScaleSweep';
import type { NormContext } from './normCell';

export const SEXES = ['M', 'F', null] as const;
export const AGE_STATES = [
  { id: 'dob-adult', dateOfBirth: '1996-01-02', takenOn: '2026-01-10' },   // SYNTHETIC
  { id: 'dob-child', dateOfBirth: '2014-01-02', takenOn: '2026-01-10' },   // SYNTHETIC
  { id: 'none', dateOfBirth: null, takenOn: '2026-01-10' },
] as const;

/** One film per (skull, population, sex, age state). Its timepoint is its key: `<population|->~<sex|->~<age>~<skull>`. */
export function populationDocs(): CaseDoc[] {
  const pops: (string | null)[] = [null, ...populationsOffered(loadSets(), []).map((p) => p.id)];
  const out: CaseDoc[] = [];
  for (const s of SYNTHETIC_SKULLS) for (const population of pops) for (const gender of SEXES) for (const a of AGE_STATES) {
    const tp = `${population ?? '-'}~${gender ?? '-'}~${a.id}~${s.name}`;
    out.push(synthDoc({ id: tp, timepoint: tp, population, gender, dateOfBirth: a.dateOfBirth, takenOn: a.takenOn,
      ageOnFilmYears: null, patientKey: `synthetic ${tp}` }, s.points));
  }
  return out;
}

/** The sweep, in chunks of one skull and one population (sweepDocs matches each row back to its CSV line by search, so
 *  one call over all films would be quadratic). */
export async function populationSweep(docs: CaseDoc[] = populationDocs(), norms?: NormContext): Promise<SweepRow[]> {
  const groups = new Map<string, CaseDoc[]>();
  for (const d of docs) { const k = `${d.population ?? '-'}~${d.timepoint.split('~')[3]}`; groups.set(k, [...(groups.get(k) ?? []), d]); }
  const out: SweepRow[] = [];
  for (const g of groups.values()) out.push(...(await sweepDocs(g, norms)));
  return out;
}

const spell = (_k: string, v: unknown) => (typeof v === 'number' && !Number.isFinite(v) ? String(v) : v);
/** A sweep as a file the other git state reads back, NaN and ±Infinity spelled out. */
export const toJson = (rows: SweepRow[]): string => JSON.stringify(rows, spell);

// The repo has no @types/node: node modules are reached type-erased, as sweepStates.ts does.
const FS = 'node:fs', RL = 'node:readline';
type Fs = { openSync: (p: string, f: string) => number; writeSync: (fd: number, s: string) => number; closeSync: (fd: number) => void;
  createReadStream: (p: string, o: { encoding: 'utf8' }) => unknown };
type Rl = { createInterface: (o: { input: unknown; crlfDelay: number }) => AsyncIterable<string> };
/** Writes a stamped sweep as one JSON line per row (first line: the git state). A whole sweep as ONE JSON string is
 *  larger than the longest string the JavaScript engine allows (84,240 rows, each carrying its film's model and CSV
 *  lines), so it is never built. */
export async function writeSweep(path: string, gitState: string, rows: SweepRow[]): Promise<void> {
  const fs = (await import(/* @vite-ignore */ FS)) as Fs;
  const fd = fs.openSync(path, 'w');
  try {
    fs.writeSync(fd, `${JSON.stringify({ gitState })}\n`);
    for (const r of rows) fs.writeSync(fd, `${JSON.stringify(r, spell)}\n`);
  } finally { fs.closeSync(fd); }
}
/** Each line of `writeSweep`'s file in turn: the git state, then every row. Streamed: a whole before-file (4 GB for
 *  the full sweep, each row carrying its film's model and CSV lines) is never held in memory at once. */
async function* sweepLines(path: string): AsyncGenerator<{ gitState: string | null } | SweepRow> {
  const fs = (await import(/* @vite-ignore */ FS)) as Fs, rl = (await import(/* @vite-ignore */ RL)) as Rl;
  let first = true;
  for await (const line of rl.createInterface({ input: fs.createReadStream(path, { encoding: 'utf8' }), crlfDelay: Infinity })) {
    if (!line) continue;
    if (first) { const g = (JSON.parse(line) as { gitState?: unknown }).gitState; first = false; yield { gitState: typeof g === 'string' && g ? g : null }; continue; }
    yield JSON.parse(line) as SweepRow;
  }
}
/** Reads `writeSweep`'s file back whole (small sweeps only: the controls). */
export async function readSweep(path: string): Promise<{ gitState: string | null; rows: SweepRow[] }> {
  let gitState: string | null = null; const rows: SweepRow[] = [];
  for await (const x of sweepLines(path)) { if ('key' in x) rows.push(x); else gitState = x.gitState; }
  return { gitState, rows };
}
/** `diffPopulationSweeps` with the BEFORE side read from `writeSweep`'s file one row at a time; also returns the
 *  file's git state. Same rules and the same refusals (nothing compared, rows differ, a row missing). */
export async function diffPopulationSweepFile(path: string, after: SweepRow[]): Promise<{ gitState: string | null; diff: PopulationDiff }> {
  const a = new Map(after.map((r) => [r.key, r]));
  if (a.size !== after.length) throw new Error(`rows differ: ${after.length} after, ${a.size} distinct`);
  const d = emptyDiff(); let gitState: string | null = null; let n = 0;
  const seen = new Set<string>();
  for await (const x of sweepLines(path)) {
    if (!('key' in x)) { gitState = x.gitState; continue; }
    n++;
    if (seen.has(x.key)) throw new Error(`rows differ: ${x.key} twice before`);
    seen.add(x.key);
    classify(d, x, a.get(x.key));
  }
  if (!n || !after.length) throw new Error(`nothing compared (${n} before, ${after.length} after)`);
  if (n !== after.length) throw new Error(`rows differ: ${n} before, ${after.length} after, ${a.size} distinct`);
  return { gitState, diff: d };
}
/** Same value, NaN equal to NaN. */
const same = (a: unknown, b: unknown) => JSON.stringify(a, spell) === JSON.stringify(b, spell);

/** The numbers of a row (what grades the patient), apart from its words. */
export const numbers = (d: Record<string, unknown>) => {
  const c = (d.cell ?? {}) as Record<string, unknown>, r = (d.report ?? {}) as Record<string, unknown>;
  return [c.z, c.mean, c.sd, c.normMean, c.normSd, c.band, c.severity, r.stars, r.num];
};
/** `fields`: for the unexpected rows only, how many of them each field changed in (one level deep, `cell.z`): the reasons. */
export interface PopulationDiff { compared: number; changed: { untouched: number; wordsOnly: number; noPopulation: number }; unexpected: string[]; fields: Record<string, number> }
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function countFields(f: Record<string, number>, x: Record<string, unknown>, y: Record<string, unknown>): void {
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const p = x[k], q = y[k];
    if (same(p, q)) continue;
    if (isObj(p) && isObj(q)) { for (const s of new Set([...Object.keys(p), ...Object.keys(q)])) if (!same(p[s], q[s])) f[`${k}.${s}`] = (f[`${k}.${s}`] ?? 0) + 1; }
    else f[k] = (f[k] ?? 0) + 1;
  }
}

/** Rules (spec §6): population chosen by hand and sex recorded → nothing may change; sex not recorded → only words;
 *  no population → only rows that read "No norm" before. Throws when there is nothing to compare or the rows differ. */
const emptyDiff = (): PopulationDiff => ({ compared: 0, changed: { untouched: 0, wordsOnly: 0, noPopulation: 0 }, unexpected: [], fields: {} });
/** The fields of a sweep row that belong to its FILM, not to the row: the same on every row of a film. */
const FILM_FIELDS = ['film', 'blocks', 'wideNamed', 'wideAnon', 'scale', 'mmPerPx', 'headerScale'];
const rowOwn = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).filter(([k]) => !FILM_FIELDS.includes(k)));
/** One before row against its after row, by the rules of diffPopulationSweeps. */
function classify(d: PopulationDiff, b: SweepRow, r: SweepRow | undefined): void {
  if (!r) throw new Error(`row ${b.key} missing after`);
  d.compared++;
  if (same(b.data, r.data)) return;
  const n = d.unexpected.length;
  judge(d, b, r);
  if (d.unexpected.length > n) countFields(d.fields, b.data, r.data);
}
function judge(d: PopulationDiff, b: SweepRow, r: SweepRow): void {
  const [pop, sex] = b.key.split('|')[0].split('~');
  if (pop === '-') {
    // No population: a row that read "No norm" may gain a norm (owner decision 6), and with it the film's own lines
    // (its sentence, Auto note, scale note, wide CSV line: FILM_FIELDS) change on every row of that film, so another row
    // passes when everything that is its OWN is unchanged; with the sex not recorded, any other row may change its words
    // only (owner decision 5), exactly as on a hand-chosen population.
    d.changed.noPopulation++;
    const wasNone = ((b.data.cell ?? {}) as { text?: string }).text === 'No norm';
    const ownSame = same(rowOwn(b.data), rowOwn(r.data));
    if (!wasNone && !ownSame && !(sex === '-' && same(numbers(b.data), numbers(r.data)))) d.unexpected.push(b.key);
  } else if (sex === '-') {
    d.changed.wordsOnly++;
    if (!same(numbers(b.data), numbers(r.data))) d.unexpected.push(b.key);
  } else {
    d.changed.untouched++;
    d.unexpected.push(b.key);
  }
}

export function diffPopulationSweeps(before: SweepRow[], after: SweepRow[]): PopulationDiff {
  if (!before.length || !after.length) throw new Error(`nothing compared (${before.length} before, ${after.length} after)`);
  const a = new Map(after.map((r) => [r.key, r]));
  if (a.size !== after.length || a.size !== before.length) throw new Error(`rows differ: ${before.length} before, ${after.length} after, ${a.size} distinct`);
  const d = emptyDiff();
  for (const b of before) classify(d, b, a.get(b.key));
  return d;
}
