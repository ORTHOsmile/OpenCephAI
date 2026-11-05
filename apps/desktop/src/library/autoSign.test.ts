import { describe, it, expect } from 'vitest';
import { serial } from './serial';
import { runAutoSignOff } from './autoSign';

// Final review m-2: V2's automatic sign-off (`setVerified(true, 'auto')`) is not ordered with the ruler-store
// chain. Scenario from the review: a drop's `calibrate` IPC is already in flight when the auto path's own check
// passes (the hold is still null); if the drop's store then lands first, the tracing is signed off at the NEW
// scale. The fix queues the auto path's check-and-sign through the SAME serial() chain (`rulerRunRef` in
// `useCase.ts`) as the ruler stores, so it can never slip into that gap. Proven here with the same hand-resolved
// deferred style as serial.test.ts, since no renderHook harness exists for the real hook.
const deferred = <T>() => { let resolve!: (v: T) => void; const promise = new Promise<T>((res) => { resolve = res; }); return { promise, resolve }; };

describe('runAutoSignOff (final review m-2)', () => {
  it('signs off when the film is still open, unsigned, fully accepted and allowed', async () => {
    const calls: string[] = [];
    const outcome = await runAutoSignOff('A', true, () => 'A',
      { open: async (id) => { calls.push(`open:${id}`); return { verifiedAt: null, verifiedBy: null }; },
        setVerified: async (id, v) => { calls.push(`setVerified:${id}:${v}`); } },
      () => true, () => true);
    expect(outcome.kind).toBe('signed');
    expect(calls).toEqual(['open:A', 'setVerified:A:true']);
  });

  it('a ruler store already queued on the SAME serial chain runs first, and by the time the auto job runs the hold it set is already visible', async () => {
    const run = serial();
    const order: string[] = [];
    let holdSetByRulerStore = false;
    // Job 1: stands in for a ruler drop's `calibrate` IPC, already in flight; it sets the hold once it lands —
    // exactly what `afterMmChange` → `holdForMm` does in the real chain.
    const rulerJobLanded = deferred<void>();
    const r1 = run(async () => { order.push('ruler start'); await rulerJobLanded.promise; holdSetByRulerStore = true; order.push('ruler done (hold set)'); return true; });
    // Job 2: the auto sign-off's check-and-sign, queued through the SAME chain (the fix) right after the drop's
    // own flush/open, i.e. while the drop's store is still in flight.
    const r2 = run(() => runAutoSignOff('A', true, () => 'A',
      { open: async (id) => { order.push(`auto open:${id}`); return { verifiedAt: null, verifiedBy: null }; },
        setVerified: async (id, v) => { order.push(`auto setVerified:${id}:${v}`); } },
      () => true, () => !holdSetByRulerStore));   // `stillAllowed` reads the SAME hold the ruler job sets
    await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['ruler start']);   // job 2 has not started: it is queued behind job 1 on the same chain
    rulerJobLanded.resolve();
    await r1;
    const outcome = await r2;
    expect(outcome.kind).toBe('held');        // the hold the ruler job set was visible BEFORE the auto job's own check
    expect(order).toEqual(['ruler start', 'ruler done (hold set)', 'auto open:A']);   // setVerified was never called
  });

  it('reports "stale" instead of signing when the open film has switched away before the job runs', async () => {
    const openId = { current: 'A' };
    const calls: string[] = [];
    const outcome = await runAutoSignOff('A', true, () => openId.current,
      { open: async (id) => { calls.push(`open:${id}`); return { verifiedAt: null, verifiedBy: null }; },
        setVerified: async (id, v) => { calls.push(`setVerified:${id}:${v}`); } },
      () => true, () => true);
    // film is still A here; now prove the id guard with a direct switch before the call
    openId.current = 'B';
    const outcome2 = await runAutoSignOff('A', true, () => openId.current,
      { open: async (id) => { calls.push(`open2:${id}`); return { verifiedAt: null, verifiedBy: null }; },
        setVerified: async (id, v) => { calls.push(`setVerified2:${id}:${v}`); } },
      () => true, () => true);
    expect(outcome.kind).toBe('signed');
    expect(outcome2.kind).toBe('stale');
    expect(calls).toEqual(['open:A', 'setVerified:A:true']);   // the second call touched nothing
  });
});
