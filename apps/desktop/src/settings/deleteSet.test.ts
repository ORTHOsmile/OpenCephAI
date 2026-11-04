import { describe, it, expect } from 'vitest';
import { deleteSetRows } from './userNorm';

// Final review M-5 (Task 10 M4): a failure part-way through "Delete set…" left earlier rows deleted with no word of how
// many, and skipped the refresh (a stale list). The helper reports how many went; SettingsWindow refreshes in finally.
const rows = ['m01_SNA', 'm02_SNB', 'm03_ANB'].map((measurement) => ({ setName: 'SYNTHETIC set', measurement, mean: 1, sd: 1, sourceNote: 'x' }));
describe('deleteSetRows', () => {
  it('every row deleted: no error', async () => {
    const gone: string[] = [];
    expect(await deleteSetRows(async (_s: string, m: string) => { gone.push(m); }, 'SYNTHETIC set', rows)).toBeNull();
    expect(gone).toEqual(['m01_SNA', 'm02_SNB', 'm03_ANB']);
  });
  it('a failure part-way: says how many of how many were deleted, and why', async () => {
    let n = 0;
    const r = await deleteSetRows(async () => { if (++n === 2) throw new Error('SYNTHETIC disk error'); }, 'SYNTHETIC set', rows);
    expect(r).toBe('Only 1 of 3 norms in “SYNTHETIC set” were deleted (SYNTHETIC disk error).');
  });
});
