import { describe, it, expect } from 'vitest';
import { loadSets } from './load';
import { normSourcesFor } from './sources';

const sets = loadSets();
describe('normSourcesFor: the norm sets that hold a measurement', () => {
  it('#43 (S–N to Go–Me ratio) has no norm anywhere (coverage table)', () => {
    expect(normSourcesFor('m43_SNtoGoMe', sets)).toEqual([]);
  });
  it('#89 upper lip length: only Alcalde 2000 (Japanese), a close match with its note', () => {
    const s = normSourcesFor('m89_ULLength', sets);
    expect(s.map((x) => [x.setId, x.match, x.population])).toEqual([['alcalde2000', 'close', 'Japanese']]);
    expect(s[0].note).toBeTruthy();
  });
  it('SNA: Steiner\'s own set is listed; the analysis\'s own norms come first, websites last (review M-1, M-5)', () => {
    const s = normSourcesFor('m01_SNA', sets);
    expect(s.some((x) => x.setId === 'steiner1953')).toBe(true);
    const own = (x: (typeof s)[number]) => sets.find((t) => t.id === x.setId)!.kind === 'analysis-own';
    const rank = s.map((x) => (x.status === 'website' ? 2 : own(x) ? 0 : 1));
    expect(rank).toEqual([...rank].sort((a, b) => a - b));
    expect(rank).toEqual(expect.arrayContaining([0, 1, 2]));            // all three groups are present, so the order is tested
  });
  it('two sets with the same short citation and population are told apart by their title (review M-2)', () => {
    const s = normSourcesFor('m01_SNA', sets).filter((x) => x.setId === 'onfile-abo' || x.setId === 'onfile-nagasaki');
    expect(s).toHaveLength(2);
    expect(s[0].citation + s[0].population).toBe(s[1].citation + s[1].population);
    expect(s[0].title).not.toBe(s[1].title);
    expect(s.map((x) => x.title)).toEqual(s.map((x) => sets.find((t) => t.id === x.setId)!.citation.title));
  });
  it('a second-hand set shows what it was quoted via', () => {
    const s = normSourcesFor('m34_Saddle', sets).find((x) => x.setId === 'jarabak-via-alshahrani2018');
    expect(s?.via).toMatch(/Alshahrani/);
  });
  it('a definitionMatch "different" entry never counts (planted set)', () => {
    const planted = [{ ...sets[0], id: 'planted', status: 'verified' as const, kind: 'population' as const,
      entries: [{ measurement: 'm43_SNtoGoMe', sex: 'pooled' as const, mean: 1, unit: '' as const, source: 'p. 1', definitionMatch: 'different' as const, definitionNote: 'x' }] }];
    expect(normSourcesFor('m43_SNtoGoMe', planted)).toEqual([]);
    planted[0].entries[0].definitionMatch = 'same' as any;
    expect(normSourcesFor('m43_SNtoGoMe', planted)).toHaveLength(1);   // positive control: the same set, "same", is found
  });
  const one = (over: Record<string, unknown>) => [{ ...sets[0], id: 'planted', status: 'verified' as const, kind: 'population' as const,
    entries: [{ measurement: 'm43_SNtoGoMe', sex: 'pooled' as const, mean: 1, unit: '' as const, source: 'p. 1', definitionMatch: 'same' as const }],
    ...over }] as typeof sets;
  it('a pending set never counts (planted set, review I-3)', () => {
    expect(normSourcesFor('m43_SNtoGoMe', one({ status: 'pending' }))).toEqual([]);
    expect(normSourcesFor('m43_SNtoGoMe', one({}))).toHaveLength(1);   // positive control: the same set, verified, is found
  });
  it('SRC-ORDER-1 (owner 12 Oct): own norms first, then populations, websites last — even when given in reverse', () => {
    const planted = (id: string, kind: 'analysis-own' | 'population', status: 'verified' | 'website', pop: string) => one({ id, kind, status,
      population: { ...sets[0].population, label: pop } })[0];
    // Given website, population, own — and with population labels that would sort them the wrong way round alphabetically.
    const given = [planted('web', 'population', 'website', 'A'), planted('pop', 'population', 'verified', 'B'), planted('own', 'analysis-own', 'verified', 'C')];
    expect(normSourcesFor('m43_SNtoGoMe', given).map((x) => x.setId)).toEqual(['own', 'pop', 'web']);
  });
  it('a research-SD set never counts (planted set, review I-3)', () => {
    expect(normSourcesFor('m43_SNtoGoMe', one({ kind: 'research-sd' }))).toEqual([]);
    expect(normSourcesFor('m43_SNtoGoMe', one({}))).toHaveLength(1);   // positive control: the same set, a population, is found
  });
});

describe('shortCitation (review M-4)', () => {
  it('hyphenated initials are dropped like plain ones: "Fu M-K, Mao ST" reads "Fu 1975"', async () => {
    const { shortCitation } = await import('./resolve');
    expect(shortCitation(sets.find((s) => s.id === 'moate2002-fu1975')!)).toBe('Fu 1975');
    const planted = { ...sets[0], citation: { ...sets[0].citation, authors: 'Lee J-H, Kim S', year: 2001, undated: undefined } } as (typeof sets)[number];
    expect(shortCitation(planted)).toBe('Lee 2001');
    const plain = { ...planted, citation: { ...planted.citation, authors: 'McNamara JA Jr' } } as (typeof sets)[number];
    expect(shortCitation(plain)).toBe('McNamara 2001');                // the existing rule still holds
  });
});
