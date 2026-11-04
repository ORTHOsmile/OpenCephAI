import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createSaver, type SaveStatus } from './saver';
import type { CaseEdit } from '../ipc';

const edit = (id: string, x: number): CaseEdit => ({
  id, facing: 'right', orientation: { mirror: false, rotDeg: 0, source: 'none' }, display: { brightness: 1, contrast: 1, invert: false, sharpness: 0 },
  landmarks: [{ id: 'S', x, y: 0, source: 'manual', verified: true, aiX: null, aiY: null, confidence: null }],
});
const setup = (save: (e: CaseEdit) => Promise<unknown> = vi.fn(async () => {})) => {
  const statuses: SaveStatus[] = [];
  return { s: createSaver(save, (st) => { statuses.push(st); }, 600), save: save as ReturnType<typeof vi.fn>, statuses };
};
const calls = (save: ReturnType<typeof vi.fn>) => save.mock.calls.map((c) => [(c[0] as CaseEdit).id, (c[0] as CaseEdit).landmarks[0].x]);

describe('autosave', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('debounces a burst of edits into one write of the latest', async () => {
    const { s, save, statuses } = setup();
    s.schedule(edit('a', 1)); s.schedule(edit('a', 2)); s.schedule(edit('a', 3));
    await vi.advanceTimersByTimeAsync(599);
    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(calls(save)).toEqual([['a', 3]]);
    expect(statuses.at(-1)).toBe('saved');
  });
  it('never writes back what was just loaded, or the same edit twice', async () => {
    const { s, save } = setup();
    s.prime(edit('a', 1)); s.schedule(edit('a', 1)); await vi.runAllTimersAsync();
    expect(save).not.toHaveBeenCalled();
    s.schedule(edit('a', 2)); await vi.runAllTimersAsync();
    s.schedule(edit('a', 2)); await vi.runAllTimersAsync();
    expect(calls(save)).toEqual([['a', 2]]);
  });
  it('Review focus 3: switching case writes the pending edit to its own case at once', async () => {
    const { s, save } = setup();
    s.schedule(edit('a', 5));
    s.schedule(edit('b', 7));                                                 // another case opened before the timer fired
    await vi.advanceTimersByTimeAsync(0);
    expect(calls(save)).toEqual([['a', 5]]);
    await vi.runAllTimersAsync();
    expect(calls(save)).toEqual([['a', 5], ['b', 7]]);
  });
  it('flush writes at once and resolves after the write', async () => {
    const { s, save } = setup();
    s.schedule(edit('a', 1)); await s.flush();
    expect(save).toHaveBeenCalledTimes(1);
  });
  it('a failed write is reported and retried by the next flush', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const { s, statuses } = setup(save);
    s.schedule(edit('a', 1)); await s.flush();
    expect(statuses.at(-1)).toBe('error');
    await s.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('saved');
  });
  it('writes one at a time, in order', async () => {
    let active = 0, most = 0; const order: number[] = [];
    const save = vi.fn(async (e: CaseEdit) => { active++; most = Math.max(most, active); await new Promise((res) => setTimeout(res, 50)); order.push(e.landmarks[0].x); active--; });
    const { s } = setup(save);
    s.schedule(edit('a', 1)); void s.flush(); s.schedule(edit('a', 2)); void s.flush();
    await vi.runAllTimersAsync();
    expect([order, most]).toEqual([[1, 2], 1]);
  });
  it('a failed save for one case is kept and retried while you work on another, until it is written (review #1)', async () => {
    let failA = 2;
    const save = vi.fn(async (e: CaseEdit) => { if (e.id === 'a' && failA-- > 0) throw new Error('disk full'); });
    const { s, statuses } = setup(save);
    s.schedule(edit('a', 5)); await s.flush();
    expect(statuses.at(-1)).toBe('error');
    s.schedule(edit('b', 7)); await vi.runAllTimersAsync();
    s.schedule(edit('b', 8)); await vi.runAllTimersAsync();
    expect(calls(save).filter(([id]) => id === 'a')).toEqual([['a', 5], ['a', 5], ['a', 5]]);
    expect(calls(save).at(-1)).toEqual(['b', 8]);
    expect(statuses.at(-1)).toBe('saved');
  });
  it('flush reports whether everything is on disk, so sign-off can refuse an unsaved tracing (review minor #2)', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const { s } = setup(save);
    s.schedule(edit('a', 1));
    expect(await s.flush()).toBe(false);
    expect(await s.flush()).toBe(true);
  });
  it('a stale failed edit never overwrites a newer save of the same case', async () => {
    const save = vi.fn().mockRejectedValueOnce(new Error('disk full')).mockResolvedValue(undefined);
    const { s } = setup(save);
    s.schedule(edit('a', 1)); await s.flush();                                // a1 fails and is kept
    s.schedule(edit('a', 2)); await s.flush();                                // a2 supersedes it
    await s.flush();
    expect(calls(save)).toEqual([['a', 1], ['a', 2]]);
  });
});
