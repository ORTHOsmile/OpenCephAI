import type { NormSet, SetStatus } from './types';
import { shortCitation } from './resolve';

/** `title` is the set's full citation title: two sets can share a short citation and population (the onfile ABO and
 *  Nagasaki sets both read "[source removed] 2026 | The analysis's own norms"), and the title tells them apart (review M-2). */
export interface NormSource { setId: string; citation: string; title: string; population: string; status: SetStatus; match: 'same' | 'close'; note: string | null; via: string | null }

/** The norm sets that hold a usable entry for a measurement (Part D: "the norm sources available for it").
 *  Pending sets and research-SD sets are left out, as the resolver leaves them out; a 'different' entry never counts.
 *  A set with any 'close' row is listed as close, with that row's note. The analysis's own norms come first, then the
 *  populations, website values last (review M-1, for the owner's glance); within a group by population, then citation. */
export function normSourcesFor(measurement: string, sets: NormSet[]): NormSource[] {
  const group = (s: { status: SetStatus; kind: NormSet['kind'] }) => (s.status === 'website' ? 2 : s.kind === 'analysis-own' ? 0 : 1);
  return sets
    .filter((s) => s.status !== 'pending' && s.kind !== 'research-sd')
    .flatMap((s) => {
      const rows = s.entries.filter((e) => e.measurement === measurement && e.definitionMatch !== 'different');
      if (!rows.length) return [];
      const close = rows.find((r) => r.definitionMatch === 'close');
      return [{ g: group(s), src: { setId: s.id, citation: shortCitation(s), title: s.citation.title, population: s.population.label, status: s.status,
        match: close ? 'close' as const : 'same' as const, note: close?.definitionNote ?? null, via: s.secondHand?.via ?? null } }];
    })
    .sort((a, b) => a.g - b.g || a.src.population.localeCompare(b.src.population) || a.src.citation.localeCompare(b.src.citation))
    .map((x) => x.src);
}
