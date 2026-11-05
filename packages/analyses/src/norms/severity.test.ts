import { describe, it, expect } from 'vitest';
import { severity, extremeForNorm, EXTREME_NOTE } from './severity';
import { zScore, type Resolved } from './resolve';

// Owner SEVERITY-1/2 (16 Oct 2026): stars and words from the same z the colours use.
describe('severity (SEVERITY-1/2)', () => {
  const s = (z: number | null) => { const r = severity(z); return r && `${r.stars}|${r.word}|${r.side}`; };
  it('no z, no severity', () => { expect(severity(null)).toBeNull(); expect(severity(Number.NaN)).toBeNull(); });
  it('the edges: exactly 1, 2, 3 SD stay in the lower band (as the colours: <= 1 is green)', () => {
    expect([s(0), s(0.74), s(0.75), s(1), s(1.0001), s(2), s(2.0001), s(3), s(3.0001)]).toEqual([
      '|within normal range|above', '|within normal range|above', '|tendency|above', '|tendency|above',
      '*|Mild|above', '*|Mild|above', '**|Moderate|above', '**|Moderate|above', '***|Severe|above']);
  });
  it('below the mean is the same, on the other side', () => {
    expect([s(-0.8), s(-1.5), s(-2.5), s(-4)]).toEqual(['|tendency|below', '*|Mild|below', '**|Moderate|below', '***|Severe|below']);
  });
});

// Stage A task 9 (spec §14.4): the note "Extreme value for the norm" from 4 SD. The stars, words and colours do not move.
describe('extremeForNorm (Stage A task 9, spec 14.4)', () => {
  // Fails if the test is `>` instead of `>=` (4.0 and -4.0 would read false) or if the cut moves off 4.
  it('is true from exactly 4 SD, either side; false just under', () => {
    expect([extremeForNorm(4), extremeForNorm(-4), extremeForNorm(4.5), extremeForNorm(-4.5), extremeForNorm(3.999), extremeForNorm(-3.999), extremeForNorm(3.5), extremeForNorm(0)])
      .toEqual([true, true, true, true, false, false, false, false]);
  });
  it('false for no z: null, undefined, NaN, Infinity', () => {
    expect([extremeForNorm(null), extremeForNorm(undefined), extremeForNorm(Number.NaN), extremeForNorm(Infinity), extremeForNorm(-Infinity)]).toEqual([false, false, false, false, false]);
  });
  it('false when the norm has no SD (zScore gives null) or no norm at all', () => {
    const noSd = { kind: 'norm', colour: true, mean: 2, sd: null } as unknown as Resolved;
    const none = { kind: 'none' } as unknown as Resolved;
    expect([extremeForNorm(zScore(50, noSd)), extremeForNorm(zScore(50, none))]).toEqual([false, false]);
  });
  it('the words are the owner-approved ones, verbatim', () => { expect(EXTREME_NOTE).toBe('Extreme value for the norm'); });
  // Pinned from the code BEFORE this change (run on 82690c7): the note adds nothing to the severity of a row.
  it('severity at z = 3.5 and 4.5 is exactly what it was before the note', () => {
    const s = (z: number) => JSON.stringify(severity(z));
    expect([s(3.5), s(4.5), s(-4.5)]).toEqual([
      '{"stars":"***","word":"Severe","side":"above"}', '{"stars":"***","word":"Severe","side":"above"}', '{"stars":"***","word":"Severe","side":"below"}']);
  });
});
