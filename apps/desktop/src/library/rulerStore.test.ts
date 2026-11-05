import { describe, it, expect } from 'vitest';
import { serial } from './serial';
import { runRulerStore } from './rulerStore';

// Final review I-1: a queued ruler store must act on the film it was queued for, never on whichever film happens
// to be open when the serial queue finally runs the job or when the library's IPC call returns. This reproduces
// the review's scenario with hand-resolved deferreds (the same style as serial.test.ts, since no renderHook
// harness exists in apps/desktop for the real hook): a job is queued for film A, the "open" film is switched to B
// before the job runs, and the job must write nothing — neither the library call nor the screen update.
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((res) => { resolve = res; }); return { promise, resolve }; };

describe('runRulerStore (final review I-1)', () => {
  it('a job queued for film A is skipped — no library call, no screen update — once the open film has switched to B before the job runs', async () => {
    const run = serial();
    const calls: string[] = [];
    const openId = { current: 'A' };
    const stored: string[] = [];
    const firstJobStarted = deferred<void>();
    // Job 1 occupies the queue so job 2 (the ruler store queued for A) does not run until we have switched to B.
    const r1 = run(async () => { firstJobStarted.resolve(); await new Promise((r) => setTimeout(r, 10)); return 'first'; });
    const r2 = run(() => runRulerStore('A', { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, mm: 1, steps: 0 }, () => openId.current,
      { calibrate: async (id) => { calls.push(id); return 1; }, recalibrate: async (id) => { calls.push(id); return 1; } },
      async (spacingMm) => { stored.push(`A:${spacingMm}`); }));
    await firstJobStarted.promise;
    openId.current = 'B';   // the clinician switched film while job 1 (and so job 2, behind it) was still queued
    await r1;
    const took = await r2;
    expect(took).toBe(false);
    expect(calls).toEqual([]);      // no library.calibrate(A's id, ...) — film A's mm was never touched
    expect(stored).toEqual([]);     // no rulerOnDisk/afterMmChange write either — B's screen was never touched
  });

  it('a job queued for A runs normally when the open film is still A when it runs', async () => {
    const run = serial();
    const calls: string[] = [];
    const openId = { current: 'A' };
    const stored: string[] = [];
    const took = await run(() => runRulerStore('A', { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, mm: 1, steps: 0 }, () => openId.current,
      { calibrate: async (id) => { calls.push(id); return 2.5; }, recalibrate: async (id) => { calls.push(id); return 2.5; } },
      async (spacingMm) => { stored.push(`A:${spacingMm}`); }));
    expect(took).toBe(true);
    expect(calls).toEqual(['A']);
    expect(stored).toEqual(['A:2.5']);
  });

  it('the open film switches away WHILE the library call is in flight: the call already landed, but the screen update is still skipped', async () => {
    const run = serial();
    const calls: string[] = [];
    const openId = { current: 'A' };
    const stored: string[] = [];
    const ipc = deferred<number>();
    const p = run(() => runRulerStore('A', { p1: { x: 0, y: 0 }, p2: { x: 1, y: 0 }, mm: 1, steps: 0 }, () => openId.current,
      { calibrate: async (id) => { calls.push(id); return ipc.promise; }, recalibrate: async (id) => { calls.push(id); return ipc.promise; } },
      async (spacingMm) => { stored.push(`A:${spacingMm}`); }));
    await Promise.resolve(); await Promise.resolve();
    openId.current = 'B';            // switched while the IPC call to the store is in flight
    ipc.resolve(3);
    const took = await p;
    expect(took).toBe(false);
    expect(calls).toEqual(['A']);    // the IPC call had already been sent — cannot be unsent
    expect(stored).toEqual([]);      // but the screen update (B's doc) must never happen
  });
});
