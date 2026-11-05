import { describe, it, expect } from 'vitest';
import { meaningPhrase, severity } from '@ceph/analyses';
import { wordsFor } from '../settings/meanings';
import { reportMeaning } from './meaning';

const anb = wordsFor('m03_ANB', {});   // approved: high "Class II", low "Class III"

describe('the report Meaning cell (SEVERITY-2, MEANING-APPROVE)', () => {
  it('reads like the screen: severity word + the term for that side', () => {
    expect(reportMeaning(severity(1.34), anb)).toBe('Mild Class II');
    expect(reportMeaning(severity(-2.5), anb)).toBe('Moderate Class III');
    expect(reportMeaning(severity(3.5), anb)).toBe('Severe Class II');
    expect(reportMeaning(severity(0.8), anb)).toBe('Class II tendency');
  });
  it('the edges follow the stars: exactly 1 SD is a tendency, exactly -2 SD is Mild', () => {
    expect(reportMeaning(severity(1), anb)).toBe('Class II tendency');
    expect(reportMeaning(severity(-2), anb)).toBe('Mild Class III');
  });
  it('within 0.75 SD says so; no value or no usable SD says nothing', () => {
    expect(reportMeaning(severity(0.5), anb)).toBe('Within normal range');
    expect(reportMeaning(severity(null), anb)).toBe('');
    expect(reportMeaning(null, anb)).toBe('');
  });
  it('a measurement without approved words, or a blank side, still says how far and which side', () => {
    expect(reportMeaning(severity(1.5), undefined)).toBe('Mild, above the norm');
    expect(reportMeaning(severity(-0.9), undefined)).toBe('Tendency, below the norm');
    expect(reportMeaning(severity(2.4), { high: '  ', low: 'x' })).toBe('Moderate, above the norm');
  });
  it('positive control: wherever the screen shows a phrase, the report shows the same words', () => {
    for (const z of [-3.2, -2.1, -1.2, -0.8, 0.8, 1.2, 2.1, 3.2]) {
      const p = meaningPhrase(severity(z), anb);
      expect(p).not.toBeNull();
      expect(reportMeaning(severity(z), anb)).toBe(p);
    }
  });
});
