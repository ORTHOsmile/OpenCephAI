import { describe, it, expect } from 'vitest';
import { allEnded, barText, modelBars, NO_BARS, type BarAction } from './modelBars';

const run = (...as: BarAction[]) => as.reduce(modelBars, NO_BARS);

// Owner, 16 Oct: a loading bar per model while a film opens, so it is clear each one is working.
describe('model loading bars', () => {
  it('a film starting to open shows the main model working, with no time limit', () => {
    expect(run({ type: 'start' })).toEqual([{ id: 'main', title: 'Main model', state: 'working', limitMs: null }]);
  });
  it('each extra model gets its own bar when it starts, with its limit, and is updated in place when it ends', () => {
    const b = run({ type: 'start' }, { type: 'main', state: 'done' },
      { type: 'extra', modelId: 'srpose', title: 'SRPose', state: 'working', limitMs: 15000 },
      { type: 'extra', modelId: 'gu2', title: 'GU2Net', state: 'working', limitMs: 15000 },
      { type: 'extra', modelId: 'srpose', title: 'SRPose', state: 'gave-up', limitMs: 15000 });
    expect(b.map((x) => [x.id, x.state, x.limitMs])).toEqual([['main', 'done', null], ['srpose', 'gave-up', 15000], ['gu2', 'working', 15000]]);
    expect(allEnded(b)).toBe(false);
  });
  it('every bar ended (done, gave up, busy or failed) -> ended; nothing showing is not "ended"', () => {
    const b = run({ type: 'start' }, { type: 'main', state: 'done' }, { type: 'extra', modelId: 'a', title: 'A', state: 'busy', limitMs: 15000 });
    expect(allEnded(b)).toBe(true);
    expect(allEnded(NO_BARS)).toBe(false);
    expect(allEnded(run({ type: 'start' }))).toBe(false);
  });
  it('a new film starts afresh; clear hides them all', () => {
    const b = run({ type: 'start' }, { type: 'extra', modelId: 'a', title: 'A', state: 'done', limitMs: 15000 }, { type: 'start' });
    expect(b.map((x) => x.id)).toEqual(['main']);
    expect(run({ type: 'start' }, { type: 'clear' })).toEqual(NO_BARS);
  });
  it('an extra model\'s news with no bars showing (a re-run after the bars faded) starts no main bar of its own', () => {
    expect(run({ type: 'extra', modelId: 'a', title: 'A', state: 'working', limitMs: 15000 }).map((x) => x.id)).toEqual(['a']);
  });
  it('plain words for each state, with the limit in seconds', () => {
    const t = (state: string, limitMs: number | null = 15000) => barText({ id: 'x', title: 'X', state: state as never, limitMs });
    expect([t('working'), t('done'), t('gave-up'), t('busy'), t('failed')]).toEqual(
      ['working…', '✓', 'gave up after 15 s', 'busy with another film', 'couldn’t read this film']);
    expect(t('gave-up', 8000)).toBe('gave up after 8 s');
  });
});
