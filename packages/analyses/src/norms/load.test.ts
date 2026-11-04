import { it, expect } from 'vitest';
import { loadSets, loadSetsFrom, POPULATIONS } from './load';

it('every committed set is valid and ids are unique and match file names', () => {
  const sets = loadSets(); // throws on any invalid set
  expect(new Set(sets.map((s) => s.id)).size).toBe(sets.length);
});

it('populations.json has unique ids including analysis-own', () => {
  expect(POPULATIONS.map((p) => p.id)).toContain('analysis-own');
  expect(new Set(POPULATIONS.map((p) => p.id)).size).toBe(POPULATIONS.length);
});

// Positive control: loadSetsFrom must be able to fail, not just pass.
const validSet = {
  id: 'synthetic2026', kind: 'population', status: 'verified',
  citation: { authors: 'SYNTHETIC A', title: 'Synthetic norms', year: 2026, openAccess: true },
  population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] },
  sample: { n: 60 }, selection: 'class-I-balanced', modality: 'digital', scale: { kind: 'not-stated' }, headPosition: 'FH',
  curation: { extractedBy: ['a', 'b'], comparedOn: '2026-10-07', date: '2026-10-07' }, caveats: [],
  entries: [{ measurement: 'm01_SNA', sex: 'pooled', mean: 82, sd: 3.5, unit: 'deg', source: 'Table 2, p. 4', definitionMatch: 'same' }],
};

it('loadSetsFrom throws on a planted invalid set', () => {
  const broken = { ...validSet, entries: [{ ...validSet.entries[0], sd: 0 }] };
  expect(() => loadSetsFrom({ '/x/synthetic2026.json': broken })).toThrow();
});

it('loadSetsFrom throws on a file name that differs from its id', () => {
  expect(() => loadSetsFrom({ '/x/wrong-name.json': validSet })).toThrow();
});

it('loadSetsFrom accepts a well-formed set keyed by matching file name', () => {
  const sets = loadSetsFrom({ '/x/synthetic2026.json': validSet });
  expect(sets).toHaveLength(1);
  expect(sets[0].id).toBe('synthetic2026');
});

// Final review I-4 (12 Oct): a misspelt sdSource.set dropped the SD silently.
it('loadSetsFrom refuses an sdSource naming no loaded set, and accepts one naming a loaded set', () => {
  const lender = { ...validSet, id: 'lender2026' };
  const withSource = (set: string) => ({ ...validSet, entries: [{ ...validSet.entries[0], sdSource: { set, source: 'Table 3' } }] });
  expect(() => loadSetsFrom({ '/x/synthetic2026.json': withSource('no-such-set'), '/x/lender2026.json': lender })).toThrow(
    /synthetic2026: entries\[0\]: sdSource names set "no-such-set", which is not loaded/,
  );
  expect(loadSetsFrom({ '/x/synthetic2026.json': withSource('lender2026'), '/x/lender2026.json': lender })).toHaveLength(2);
});
