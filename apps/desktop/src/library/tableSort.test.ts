import { describe, it, expect } from 'vitest';
import { sortBy } from './tableSort';

describe('sortBy (Library ▸ Table column headers)', () => {
  it('sorts strings case-insensitively, ascending and descending', () => {
    const rows = ['Beta', 'alpha', 'Gamma'];
    expect(sortBy(rows, (r) => r, 'asc')).toEqual(['alpha', 'Beta', 'Gamma']);
    expect(sortBy(rows, (r) => r, 'desc')).toEqual(['Gamma', 'Beta', 'alpha']);
  });
  it('sorts numbers as numbers, not lexically ("9" before "10")', () => {
    expect(sortBy([10, 9, 2], (n) => n, 'asc')).toEqual([2, 9, 10]);
  });
  it('null always sorts last, in either direction (a blank DOB/age sinks, not "first" on desc)', () => {
    const rows = [{ k: 'b', v: 2 }, { k: 'a', v: null }, { k: 'c', v: 1 }];
    expect(sortBy(rows, (r) => r.v, 'asc').map((r) => r.k)).toEqual(['c', 'b', 'a']);
    expect(sortBy(rows, (r) => r.v, 'desc').map((r) => r.k)).toEqual(['b', 'c', 'a']);
  });
  it('is stable: equal values keep their original relative order', () => {
    const rows = [{ k: 1, v: 'x' }, { k: 2, v: 'x' }, { k: 3, v: 'x' }];
    expect(sortBy(rows, (r) => r.v, 'asc').map((r) => r.k)).toEqual([1, 2, 3]);
  });
  it('never mutates the array it was given', () => {
    const rows = [3, 1, 2];
    sortBy(rows, (n) => n, 'asc');
    expect(rows).toEqual([3, 1, 2]);
  });
  // Final review m6: numbers inside labels sort as numbers (T2 before T10), as a patient's own timepoint order does.
  it('T2 sorts before T10', () => {
    expect(sortBy(['T10', 'T2', 'T1'], (r) => r, 'asc')).toEqual(['T1', 'T2', 'T10']);
  });
});
