import { describe, it, expect } from 'vitest';
import { severity } from './severity';

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
