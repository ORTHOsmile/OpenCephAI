import { describe, it, expect } from 'vitest';
import type { NormSet } from './types';
import { NO_ANALYSIS_LABEL, resolveNorm, type NormQuery } from './resolve';

// Owner B3 (17 Oct 2026): a My-analysis row whose measurement no built-in analysis lists is resolved with
// analysisId '' — it has no analysis's own norm. Before this change the "choose one" words read "no 's own norm".
const CHINESE: NormSet = {
  id: 'chinese-nasolabial-SYNTHETIC', kind: 'population', status: 'verified',
  citation: { authors: 'Synthetic A', title: 'Synthetic', year: 2020, openAccess: true },
  population: { id: 'chinese', label: 'Chinese', ethnicity: ['Chinese'] }, sample: { n: 50 }, selection: 'class-I',
  modality: 'digital', scale: { kind: 'not-stated' }, headPosition: 'FH', curation: { extractedBy: ['a', 'b'], date: '2026-10-18' },
  caveats: [], entries: [{ measurement: 'm86_Nasolabial', sex: 'pooled', mean: 100, sd: 8, unit: 'deg', source: 'Table 1', definitionMatch: 'same' }],
};
const STEINER_OWN: NormSet = {
  ...CHINESE, id: 'steiner-own-SYNTHETIC', kind: 'analysis-own', analyses: ['steiner'],
  population: { id: 'analysis-own', label: "The analysis's own norms", ethnicity: [] },
  entries: [{ measurement: 'm01_SNA', sex: 'pooled', mean: 82, sd: 3, unit: 'deg', source: 'p. 1', definitionMatch: 'same' }],
};
const q = (over: Partial<NormQuery>): NormQuery => ({ measurement: 'm86_Nasolabial', analysisId: '', population: null, clinicDefault: null,
  sex: null, ageYears: null, sets: [CHINESE, STEINER_OWN], userNorms: [], ...over });

describe('a measurement no built-in analysis lists (analysisId "")', () => {
  it('the analyses\' own norms chosen: "no built-in analysis norm — choose one", never "no \'s own norm"', () => {
    expect(resolveNorm(q({ population: 'analysis-own' }))).toEqual({ kind: 'choose', population: 'analysis-own', reason: `no ${NO_ANALYSIS_LABEL} norm — choose one` });
  });
  it('no population: none, naming only your norms', () => {
    expect(resolveNorm(q({}))).toEqual({ kind: 'none', reason: 'No norm for this measurement in your norms.' });
  });
  it('its population norm is used as for any analysis', () => {
    const r = resolveNorm(q({ population: 'chinese' }));
    expect(r.kind === 'norm' && r.setId).toBe('chinese-nasolabial-SYNTHETIC');
  });
  it('unchanged for a built-in (control): "no Steiner\'s own norm — choose one"', () => {
    expect(resolveNorm(q({ analysisId: 'steiner', population: 'analysis-own' }))).toEqual(
      { kind: 'choose', population: 'analysis-own', reason: "no Steiner's own norm — choose one" });
  });
});
