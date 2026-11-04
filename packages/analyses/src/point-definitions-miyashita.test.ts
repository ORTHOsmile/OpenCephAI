import { describe, it, expect } from 'vitest';
import { LANDMARKS, POINT_DEFINITIONS, type LandmarkId } from './landmarks';
import { MIYASHITA, MIYASHITA_NOT_DEFINED, MIYASHITA_SOURCE } from './point-definitions-miyashita';
import { pointDefinition, APPENDIX_POINT_SOURCE } from './definitions';
import { longQuotes } from './norms/validate';

const lacking = (Object.keys(LANDMARKS) as LandmarkId[]).filter((id) => !POINT_DEFINITIONS[id]);
describe('Miyashita definitions (owner DEF-MIYA-1)', () => {
  it('every point lacking an appendix definition was looked up: defined by Miyashita or listed as not defined, never both, never neither', () => {
    const got = new Set(Object.keys(MIYASHITA)), not = new Set(MIYASHITA_NOT_DEFINED);
    expect(lacking.filter((id) => got.has(id) === not.has(id))).toEqual([]);
    expect([...got, ...not].filter((id) => !lacking.includes(id as LandmarkId))).toEqual([]);   // never overrides an appendix definition
  });
  it('each has a page and our own words (no quoted span of 8+ words, P44-STRICT; at most 25 words)', () => {
    for (const [id, d] of Object.entries(MIYASHITA)) {
      expect(d!.page, id).toBeGreaterThan(0);
      expect(longQuotes(d!.text), id).toEqual([]);
      expect(d!.text.split(/\s+/).length, id).toBeLessThanOrEqual(25);
    }
  });
  it('the quote check can fail (planted)', () => {
    expect(longQuotes('"one two three four five six seven eight"')).toEqual([8]);
  });
  // P17: a Miyashita definition that says it is still to be confirmed would need the "unconfirmed" mark, which reads
  // only the appendix words — so such a text is refused here and goes to the owner instead.
  const mentionsConfirm = (defs: Record<string, { text: string } | undefined>) => Object.entries(defs).filter(([, d]) => d && /confirm/i.test(d.text)).map(([id]) => id);
  it('no Miyashita definition says "to be confirmed"', () => expect(mentionsConfirm(MIYASHITA)).toEqual([]));
  it('that check can fail (planted)', () => expect(mentionsConfirm({ X: { text: 'Which cusp is meant is to be confirmed on films' } })).toEqual(['X']));
  it('the screen says where each definition comes from', () => {
    const [id, d] = Object.entries(MIYASHITA)[0] as [LandmarkId, { text: string; page: number }];
    expect(pointDefinition(id)).toMatchObject({ definition: d.text, definitionSource: `${MIYASHITA_SOURCE}, p. ${d.page}` });
    expect(pointDefinition('S').definitionSource).toBe(APPENDIX_POINT_SOURCE);
    if (MIYASHITA_NOT_DEFINED.length) expect(pointDefinition(MIYASHITA_NOT_DEFINED[0]).definition).toBeNull();
  });
});
