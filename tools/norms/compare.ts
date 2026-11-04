// Standalone double-extraction comparison tool for norm sets.
// Run with plain `node` (Node 22 strips types; no deps, no imports from packages/).
//
// CLI: node tools/norms/compare.ts <a.json> <b.json> [--merge <out.json>]
// Exit 0: self-test passed and a/b agree on every compared field.
// Exit 1: self-test passed, a and b differ (differences listed, one per line).
// Exit 2: self-test failed, or a/b could not be read/parsed/used.

import fs from 'node:fs';
import path from 'node:path';

export interface Difference {
  where: string;
  a: unknown;
  b: unknown;
}

type AnyEntry = Record<string, any>;
type AnySet = Record<string, any>;

// Fields compared within a paired entry (identity fields measurement/sex/ageBand are
// the pairing key itself, so they are not re-compared here).
const ENTRY_FIELDS = ['mean', 'sd', 'range', 'n', 'unit', 'source', 'definitionMatch', 'centre'];

// Set-level fields compared. Deliberately excludes definitionNote, note, clinicalTarget,
// caveats and curation: prose that differs between extractors by design; the merger
// reconciles it by hand.
const SET_FIELD_PATHS: Array<[string, (s: AnySet) => unknown]> = [
  ['id', (s) => s.id],
  ['population.id', (s) => s.population?.id],
  ['sample.n', (s) => s.sample?.n],
  ['sample.nMale', (s) => s.sample?.nMale],
  ['sample.nFemale', (s) => s.sample?.nFemale],
  ['citation.year', (s) => s.citation?.year],
  ['citation.undated', (s) => s.citation?.undated],
  ['citation.doi', (s) => s.citation?.doi],
  ['citation.pmid', (s) => s.citation?.pmid],
];

function valuesEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false; // one is undefined/null, the other is not
  if (typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function ageBandKey(e: AnyEntry): string {
  return Array.isArray(e.ageBand) ? `${e.ageBand[0]}-${e.ageBand[1]}` : 'none';
}

function entryKey(e: AnyEntry): string {
  return `${e.measurement}|${e.sex}|${ageBandKey(e)}`;
}

function groupByKey(entries: AnyEntry[]): Map<string, AnyEntry[]> {
  const map = new Map<string, AnyEntry[]>();
  for (const e of entries) {
    const k = entryKey(e);
    const group = map.get(k);
    if (group) group.push(e);
    else map.set(k, [e]);
  }
  return map;
}

/** Compares two norm sets. Order-independent pairing of entries by (measurement, sex,
 *  ageBand); a duplicate key inside one file is itself reported as a difference. */
export function compareSets(a: AnySet, b: AnySet): Difference[] {
  const diffs: Difference[] = [];

  for (const [where, get] of SET_FIELD_PATHS) {
    const av = get(a);
    const bv = get(b);
    if (!valuesEqual(av, bv)) diffs.push({ where, a: av, b: bv });
  }

  const am = groupByKey(a.entries ?? []);
  const bm = groupByKey(b.entries ?? []);
  const allKeys = new Set<string>([...am.keys(), ...bm.keys()]);

  for (const key of allKeys) {
    const ag = am.get(key) ?? [];
    const bg = bm.get(key) ?? [];

    if (ag.length > 1) {
      diffs.push({ where: `${key}: duplicate entries in a (${ag.length})`, a: ag.length, b: bg.length });
      continue;
    }
    if (bg.length > 1) {
      diffs.push({ where: `${key}: duplicate entries in b (${bg.length})`, a: ag.length, b: bg.length });
      continue;
    }
    if (ag.length === 0) {
      diffs.push({ where: `${key}: missing from a`, a: undefined, b: bg[0] });
      continue;
    }
    if (bg.length === 0) {
      diffs.push({ where: `${key}: missing from b`, a: ag[0], b: undefined });
      continue;
    }

    const ea = ag[0];
    const eb = bg[0];
    for (const field of ENTRY_FIELDS) {
      const av = ea[field];
      const bv = eb[field];
      if (!valuesEqual(av, bv)) diffs.push({ where: `${key}: ${field}`, a: av, b: bv });
    }
  }

  return diffs;
}

interface NumericCandidate {
  entryIndex: number;
  field: string; // 'mean' | 'sd' | 'n' | 'range.low' | 'range.high'
}

function findNumericCandidates(set: AnySet): NumericCandidate[] {
  const out: NumericCandidate[] = [];
  const entries: AnyEntry[] = set.entries ?? [];
  entries.forEach((e, entryIndex) => {
    for (const field of ['mean', 'sd', 'n']) {
      if (typeof e[field] === 'number') out.push({ entryIndex, field });
    }
    if (e.range && typeof e.range === 'object') {
      for (const sub of ['low', 'high']) {
        if (typeof e.range[sub] === 'number') out.push({ entryIndex, field: `range.${sub}` });
      }
    }
  });
  return out;
}

function mutateNumber(v: number): number {
  // Changes one digit's worth of value: integers step by 1, decimals step by a tenth.
  const delta = Number.isInteger(v) ? 1 : 0.1;
  const mutated = Math.round((v + delta) * 1000) / 1000;
  return mutated === v ? v + 1 : mutated;
}

/** Plants exactly one digit-sized change into a copy of `set`, deterministically chosen
 *  by `seed`. Returns the mutated set and where compareSets should locate the change.
 *  Returns undefined when the set has no numeric field to plant into. */
export function plantTypo(set: AnySet, seed: number): { set: AnySet; where: string } | undefined {
  const candidates = findNumericCandidates(set);
  if (candidates.length === 0) return undefined;

  const choice = candidates[Math.abs(seed) % candidates.length];
  const planted: AnySet = JSON.parse(JSON.stringify(set));
  const entry = planted.entries[choice.entryIndex];

  if (choice.field.startsWith('range.')) {
    const sub = choice.field.slice('range.'.length);
    entry.range[sub] = mutateNumber(entry.range[sub]);
  } else {
    entry[choice.field] = mutateNumber(entry[choice.field]);
  }

  const fieldLabel = choice.field.startsWith('range.') ? 'range' : choice.field;
  return { set: planted, where: `${entryKey(entry)}: ${fieldLabel}` };
}

/** The tool's own positive control: plant a typo with several different seeds and
 *  require compareSets to report exactly that planted location each time. Returns
 *  false (never throws) when the set cannot be planted into, or when compareSets
 *  fails to catch a planted change — i.e. the tool itself is not trustworthy to run. */
export function selfTest(set: AnySet): boolean {
  const seeds = [1, 2, 3];
  for (const seed of seeds) {
    const planted = plantTypo(set, seed);
    if (!planted) return false;
    const diffs = compareSets(set, planted.set);
    if (diffs.length !== 1) return false;
    if (diffs[0].where !== planted.where) return false;
  }
  return true;
}

/** The LOCAL calendar date as YYYY-MM-DD (Task 5 fix round 1: toISOString gave the UTC date, a day
 *  behind in Australia every morning before 10/11 am). */
export function localIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function todayIso(): string {
  return localIsoDate(new Date());
}

function readSet(filePath: string): AnySet {
  const text = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(text);
}

function main(): void {
  const args = process.argv.slice(2);
  const mergeIndex = args.indexOf('--merge');
  const mergeOut = mergeIndex >= 0 ? args[mergeIndex + 1] : undefined;
  const positional = mergeIndex >= 0 ? args.slice(0, mergeIndex) : args;

  const [aPath, bPath] = positional;
  if (!aPath || !bPath) {
    console.error('usage: node tools/norms/compare.ts <a.json> <b.json> [--merge <out.json>]');
    process.exit(2);
  }

  let aSet: AnySet;
  let bSet: AnySet;
  try {
    aSet = readSet(aPath);
    bSet = readSet(bPath);
  } catch (err) {
    console.error(`could not read/parse input: ${(err as Error).message}`);
    process.exit(2);
    return;
  }

  if (!selfTest(aSet)) {
    console.error('comparison tool failed its own check: nothing compared');
    process.exit(2);
    return;
  }

  const diffs = compareSets(aSet, bSet);

  if (diffs.length > 0) {
    for (const d of diffs) {
      console.log(`${d.where}: a=${JSON.stringify(d.a)} b=${JSON.stringify(d.b)}`);
    }
    process.exit(1);
    return;
  }

  if (mergeOut) {
    const merged: AnySet = JSON.parse(JSON.stringify(aSet));
    merged.curation = merged.curation ?? {};
    merged.curation.extractedBy = [aSet.curation?.extractedBy?.[0], bSet.curation?.extractedBy?.[0]];
    merged.curation.comparedOn = todayIso();
    fs.mkdirSync(path.dirname(mergeOut), { recursive: true });
    fs.writeFileSync(mergeOut, JSON.stringify(merged, null, 2) + '\n');
  }

  process.exit(0);
}

const isMain = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
  } catch {
    return false;
  }
})();

if (isMain) main();
