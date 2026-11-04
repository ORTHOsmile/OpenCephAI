import populationsJson from '../../../../reference/norms/populations.json';
import { validateSet } from './validate';
import type { NormSet } from './types';

export const POPULATIONS: { id: string; label: string }[] = populationsJson;

/** Pure function behind `loadSets()`. `files` maps a file path to its parsed JSON content, as
 *  `import.meta.glob(..., { eager: true, import: 'default' })` returns it. Validates every set
 *  against the catalogue and populations list, and checks that each file's name (without
 *  `.json`) equals its own `id`. Throws, listing every problem, if any set is invalid or
 *  misnamed. */
export function loadSetsFrom(files: Record<string, unknown>): NormSet[] {
  const ctx = { populations: POPULATIONS.map((p) => p.id) };
  const problems: string[] = [];
  const sets: NormSet[] = [];

  for (const [path, data] of Object.entries(files)) {
    const base = path.split('/').pop()?.replace(/\.json$/, '') ?? path;
    problems.push(...validateSet(data, ctx));
    const id = (data as any)?.id;
    if (id !== base) {
      problems.push(`${path}: file name "${base}" does not match set id "${id}"`);
    }
    sets.push(data as NormSet);
  }

  // Final review I-4 (12 Oct): an sdSource must name a loaded set, or the SD is dropped silently.
  const ids = new Set(sets.map((s) => (s as any)?.id));
  for (const s of sets) {
    const entries = Array.isArray((s as any)?.entries) ? (s as any).entries : [];
    entries.forEach((e: any, i: number) => {
      const target = e?.sdSource?.set;
      if (typeof target === 'string' && !ids.has(target)) {
        problems.push(`${(s as any).id}: entries[${i}]: sdSource names set "${target}", which is not loaded`);
      }
    });
  }

  if (problems.length > 0) {
    throw new Error(`Invalid norm set(s):\n${problems.join('\n')}`);
  }
  return sets;
}

/** Loads every committed norm set from `reference/norms/sets/**\/*.json`. Throws, listing every
 *  problem, if any set is invalid. With no sets committed yet, returns `[]`. */
export function loadSets(): NormSet[] {
  const files = import.meta.glob('../../../../reference/norms/sets/**/*.json', {
    eager: true,
    import: 'default',
  }) as Record<string, unknown>;
  return loadSetsFrom(files);
}
