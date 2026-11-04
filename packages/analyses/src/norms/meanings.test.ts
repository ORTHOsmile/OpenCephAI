import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { CATALOGUE } from '../catalogue';
import { DEFAULT_MEANINGS } from './meanings';

// Owner MEANING-APPROVE (16 Oct 2026): the approved document is the source; the app's data must equal it, row for row.
const doc = readFileSync(fileURLToPath(new URL('../../../../docs/norms/meanings-draft.md', import.meta.url)), 'utf8');   // review M-5: any folder
const approved = Object.fromEntries(doc.split('\n').filter((l) => /^\| ☑ \| \d/.test(l)).map((l) => {
  const c = l.split('|').map((x) => x.trim());
  return [c[3], { abbr: c[5], high: c[6], low: c[7] }];
}));

describe('default meanings (MEANING-APPROVE)', () => {
  it('the approved document has 90 ticked rows (positive control: the parser sees them)', () => {
    expect(Object.keys(approved)).toHaveLength(90);
  });
  it('every live catalogue measurement has a meaning, and there are no extras', () => {
    const live = CATALOGUE.filter((e) => !e.retired).map((e) => e.id).sort();
    expect(Object.keys(DEFAULT_MEANINGS).sort()).toEqual(live);
  });
  it('each meaning equals the approved row exactly', () => {
    expect(DEFAULT_MEANINGS).toEqual(approved);
  });
});

import { meaningPhrase } from './meanings-phrase';
// SEVERITY-2 + MEANING-APPROVE: the severity word with the clinician's (or default) term, on the value's side of the mean.
describe('meaningPhrase', () => {
  const w = { high: 'Class II', low: 'Class III' };
  const sev = (word: string, side: 'above' | 'below') => ({ stars: '' as const, word: word as never, side });
  it('Mild / Moderate / Severe put the word first; tendency goes after; above uses high, below uses low', () => {
    expect(meaningPhrase(sev('Mild', 'above'), w)).toBe('Mild Class II');
    expect(meaningPhrase(sev('Moderate', 'below'), w)).toBe('Moderate Class III');
    expect(meaningPhrase(sev('Severe', 'above'), w)).toBe('Severe Class II');
    expect(meaningPhrase(sev('tendency', 'below'), w)).toBe('Class III tendency');
  });
  it('within normal range, no severity, or no words: no phrase', () => {
    expect(meaningPhrase(sev('within normal range', 'above'), w)).toBeNull();
    expect(meaningPhrase(null, w)).toBeNull();
    expect(meaningPhrase(sev('Mild', 'above'), undefined)).toBeNull();
    expect(meaningPhrase(sev('Mild', 'above'), { high: '  ', low: 'x' })).toBeNull();
  });
});
