import populationsJson from '../../../../reference/norms/populations.json';
import { validateSet } from './validate';
import type { NormSet } from './types';

/** The population rule (owner rulings and answers, 7 Nov 2026), held only here, in populations.json, because research
 *  reports no significant norm difference between these pairs:
 *  - `normsOf`: this population IS another's for norms (Indian uses Caucasian; the app has no Indian study);
 *  - `fallsBackTo`: this population's own studies first, and another's where they have no row (Malay, then Chinese).
 *  Every resolver reads it through `normsPopulation` / `populationChain`. */
export const POPULATIONS: { id: string; label: string; normsOf?: string; fallsBackTo?: string }[] = populationsJson;

/** The population whose norms a patient of this population uses: itself, unless populations.json aliases it. */
export function normsPopulation(id: string): string;
export function normsPopulation(id: string | null): string | null;
export function normsPopulation(id: string | null): string | null {
  if (id === null) return null;
  return POPULATIONS.find((p) => p.id === id)?.normsOf ?? id;
}

/** The populations whose sets a patient of this population is resolved against, in order: Indian ['caucasian'],
 *  Malay ['malay', 'chinese'], anyone else [itself]. */
export function populationChain(id: string): string[] {
  const p = POPULATIONS.find((x) => x.id === id);
  return [normsPopulation(id), ...(p?.fallsBackTo ? [p.fallsBackTo] : [])];
}

const shortName = (id: string) => (POPULATIONS.find((p) => p.id === id)?.label ?? id).split(' (')[0];
/** The words said wherever a norm came from another population by the rule (`asked` the patient's, `used` the one whose
 *  set gave the row): owner answer C, 7 Nov 2026, "Norms: Chinese (population rule)", never the recorded background
 *  (the rule and its reason are in docs/norms/SEVERITY.md). null when the row is the patient's own population's. */
export function ruleWords(asked: string, used: string): string | null {
  return asked === used ? null : `Norms: ${shortName(used)} (population rule)`;
}
/** A population's name in a list to choose from: an aliased one says whose norms it uses, "Indian (Caucasian norms,
 *  population rule)"; every other one its own label. */
export function populationChoiceLabel(id: string): string {
  const p = POPULATIONS.find((x) => x.id === id);
  return p?.normsOf ? `${p.label} (${shortName(p.normsOf)} norms, population rule)` : p?.label ?? id;
}

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

  // Owner ruling 7 Nov 2026 (NUS): at most one fall-back own norm per analysis among sets chosen by population.
  const fallbacks = new Map<string, string[]>();
  for (const s of sets as any[]) if (s?.forOtherPopulations === true && s?.status !== 'pending') for (const a of s.analyses ?? []) fallbacks.set(a, [...(fallbacks.get(a) ?? []), s.id]);
  for (const [a, ids] of fallbacks) if (ids.length > 1) problems.push(`analysis "${a}": more than one set marked forOtherPopulations (${ids.join(', ')})`);

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
