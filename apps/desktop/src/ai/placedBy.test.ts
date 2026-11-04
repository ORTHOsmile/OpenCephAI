import { describe, it, expect } from 'vitest';
import { placedByLine, PLACED_BY_WORDS, isFallback } from './placedBy';
import { AARIZ, CWLACHAP } from './placement';
const title = (m: string) => ({ [AARIZ]: 'Aariz', [CWLACHAP]: 'cwlachap' }[m] ?? m);
describe('the point\'s source line (spec §5.1 "Shown")', () => {
  it('names Aariz for a point Aariz placed as main', () => {
    expect(placedByLine('S', AARIZ, AARIZ, false, title, null)).toBe('Placed by Aariz');
  });
  const allAariz = { ruleVersion: 'main-point-source/1', confirmationPending: true, points: { S: AARIZ, Go: AARIZ } };
  const goToCw = { ...allAariz, points: { S: AARIZ, Go: CWLACHAP } };
  it('names cwlachap and why, for a point the table gave it', () => {
    expect(placedByLine('Go', CWLACHAP, AARIZ, false, title, goToCw)).toBe(`Placed by cwlachap ${PLACED_BY_WORDS.better}`);
  });
  // Review I-1 (fix round 1): a case traced before the switch, cwlachap then the main model. The table (owner TABLE)
  // gives cwlachap no point, so "better than Aariz" would be false: the line names cwlachap plainly.
  it('an old case placed by cwlachap as the then-main model reads plainly, with no "better" claim', () => {
    expect(placedByLine('S', CWLACHAP, AARIZ, false, title, allAariz)).toBe('Placed by cwlachap');
    expect(placedByLine('Go', CWLACHAP, AARIZ, false, title, allAariz)).toBe('Placed by cwlachap');
  });
  it('with no table read, a cwlachap point never claims to be better', () => {
    expect(placedByLine('Go', CWLACHAP, AARIZ, false, title, null)).toBe('Placed by cwlachap');
  });
  it('says so when the table named cwlachap but Aariz placed it', () => {
    expect(placedByLine('Go', AARIZ, AARIZ, true, title, null)).toBe(`Placed by Aariz ${PLACED_BY_WORDS.fallback}`);
  });
  it('a main model chosen in Models… is named plainly', () => {
    expect(placedByLine('S', CWLACHAP, CWLACHAP, false, title, null)).toBe('Placed by cwlachap');
  });
  it('fill points keep their existing line (no new line), and an unknown placer shows nothing', () => {
    expect(placedByLine('Ba', 'srpose-cldet23', AARIZ, false, title, null)).toBeNull();
    expect(placedByLine('S', null, AARIZ, false, title, null)).toBeNull();
  });
});
describe('the fallback note is derived, never stored (preflight a3)', () => {
  const src = { ruleVersion: 'main-point-source/1', confirmationPending: true, points: { S: AARIZ, Go: CWLACHAP } };
  it('is true only when Aariz is main, Aariz placed the point, and the table gives that point to cwlachap', () => {
    expect(isFallback(AARIZ, AARIZ, src, 'Go')).toBe(true);
    expect(isFallback(CWLACHAP, AARIZ, src, 'Go')).toBe(false);        // cwlachap placed it as the table says
    expect(isFallback(AARIZ, AARIZ, src, 'S')).toBe(false);            // the table gives S to Aariz
    expect(isFallback(CWLACHAP, CWLACHAP, src, 'Go')).toBe(false);     // a chosen main model ignores the table
    expect(isFallback(AARIZ, AARIZ, null, 'Go')).toBe(false);          // no table read
    expect(isFallback(null, AARIZ, src, 'Go')).toBe(false);            // unknown placer
  });
});
