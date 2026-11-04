import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushThenQuit } from './quit';

describe('quitting saves first (review #2)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });
  it('quits only after the last edit is written', async () => {
    const order: string[] = [];
    const flush = () => new Promise<boolean>((res) => setTimeout(() => { order.push('saved'); res(true); }, 300));
    const done = flushThenQuit(flush, () => { order.push('quit'); });
    await vi.advanceTimersByTimeAsync(299);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); await done;
    expect(order).toEqual(['saved', 'quit']);
  });
  it('still quits if saving hangs (after the timeout) or fails, so the app can always be closed', async () => {
    const quit = vi.fn();
    const hung = flushThenQuit(() => new Promise(() => {}), quit, 4000);
    await vi.advanceTimersByTimeAsync(3999); expect(quit).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1); await hung; expect(quit).toHaveBeenCalledTimes(1);
    await flushThenQuit(() => Promise.reject(new Error('disk full')), quit);
    expect(quit).toHaveBeenCalledTimes(2);
  });
});
