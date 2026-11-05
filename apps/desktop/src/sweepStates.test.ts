import { describe, it, expect } from 'vitest';
import { gitState, requireTwoStates, stamped, unstamp } from './sweepStates';

// Final review M7 (ruling, 25 Oct): a before/after sweep refuses to compare a git state with itself unless
// an explicit self-check flag is passed; a side that does not say which state it came from is refused too.
describe('a before/after needs two git states (final review M7)', () => {
  it('the same state is refused; the explicit self-check flag lets it through', () => {
    expect(() => requireTwoStates('abc123', 'abc123', false)).toThrow('same git state');
    expect(() => requireTwoStates('abc123', 'abc123', true)).not.toThrow();
  });
  it('two different states pass', () => {
    expect(() => requireTwoStates('abc123', 'def456', false)).not.toThrow();
    expect(() => requireTwoStates('abc123', 'abc123+0123456789ab', false)).not.toThrow();   // the same commit, edited
  });
  it('a side with no state (an old, unstamped file) is refused unless self-checking', () => {
    expect(() => requireTwoStates(null, 'abc123', false)).toThrow('does not say which git state');
    expect(() => requireTwoStates('abc123', undefined, false)).toThrow('does not say which git state');
    expect(() => requireTwoStates(null, null, true)).not.toThrow();
  });
  it('a stamped file round-trips its state and rows; an old bare array reads with no state', async () => {
    const here = await gitState();
    expect(here).toMatch(/^[0-9a-f]{40}(\+[0-9a-f]{12})?$/);
    expect(unstamp(JSON.parse(JSON.stringify(stamped(here, [1, 2]))))).toEqual({ gitState: here, rows: [1, 2] });
    expect(unstamp([1, 2])).toEqual({ gitState: null, rows: [1, 2] });
  });
});
