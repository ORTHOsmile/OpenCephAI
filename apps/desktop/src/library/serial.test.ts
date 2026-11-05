import { describe, it, expect } from 'vitest';
import { serial } from './serial';

// Fix round 1, M4: the I5 "burst" smoke cannot prove ordering (the fake library is synchronous localStorage behind
// `invoke`, so two concurrent calls resolve in call order regardless of whether anything serialises them). This
// proves the ORDERING itself, with hand-resolved deferreds so job 2 can be made to settle before job 1 even though
// it was queued second.
const deferred = <T>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject }; };

describe('serial()', () => {
  it("the second call's work does not start until the first settles, even when the first settles last", async () => {
    const run = serial();
    const order: string[] = [];
    const d1 = deferred<string>();
    const r1 = run(() => { order.push('1 start'); return d1.promise.then((v) => { order.push('1 done'); return v; }); });
    const r2 = run(() => { order.push('2 start'); return Promise.resolve('b'); });   // job 2's own promise settles instantly
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();        // let microtasks drain without resolving d1
    expect(order).toEqual(['1 start']);                                              // job 2 must NOT have started yet
    d1.resolve('a');
    expect(await r1).toBe('a'); expect(await r2).toBe('b');
    expect(order).toEqual(['1 start', '1 done', '2 start']);
  });

  it('a rejected first call does not block the second', async () => {
    const run = serial();
    const order: string[] = [];
    const r1 = run(() => { order.push('1'); return Promise.reject(new Error('boom')); });
    const r2 = run(() => { order.push('2'); return Promise.resolve('ok'); });
    await expect(r1).rejects.toThrow('boom');
    await expect(r2).resolves.toBe('ok');
    expect(order).toEqual(['1', '2']);
  });

  it("the last call's value is what remains after a run of several", async () => {
    const run = serial();
    const r1 = run(() => Promise.resolve('a'));
    const r2 = run(() => Promise.resolve('b'));
    const r3 = run(() => Promise.resolve('c'));
    expect(await Promise.all([r1, r2, r3])).toEqual(['a', 'b', 'c']);
  });

  // Fix round 1, review M-1: `useCase.ts`'s `storeRuler` job fired `afterMmChange(...)` without `await`-ing it, so
  // `serial()` saw the job as settled before `afterMmChange`'s own async step (the `fit` re-read) landed. This is
  // the same defect, reproduced here with hand-resolved deferreds (`serial()` itself cannot be wrong: it serialises
  // exactly what each job's own returned promise awaits — the bug is a CALLER forgetting to return/await an inner
  // promise, same as `storeRuler` did at `useCase.ts:428`). No renderHook library exists in apps/desktop to test
  // the hook itself (see the file's own header comment on `serial()`), so this proves the property the fix depends
  // on: a job's side effect must be part of what the job awaits, or the next job races it.
  it("a job that fires its side effect WITHOUT awaiting it lets job 2 start before that side effect lands (the dropped-`await` defect)", async () => {
    const run = serial();
    const order: string[] = [];
    const sideEffect = deferred<void>();
    const buggyJob = () => {   // same shape as storeRuler before the fix: fires, does not await
      order.push('1 start');
      sideEffect.promise.then(() => order.push('1 side-effect landed'));
      return Promise.resolve(true);
    };
    const r1 = run(buggyJob);
    const r2 = run(() => { order.push('2 start'); return Promise.resolve(true); });
    await r1; await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['1 start', '2 start']);   // job 2 already started: the side effect has NOT landed yet
    sideEffect.resolve();
    await r2;
  });
  it('the fixed job (awaiting the side effect) keeps job 2 waiting until it lands', async () => {
    const run = serial();
    const order: string[] = [];
    const sideEffect = deferred<void>();
    const fixedJob = async () => {   // same shape as storeRuler after the fix: awaits its own side effect
      order.push('1 start');
      await sideEffect.promise;
      order.push('1 side-effect landed');
      return true;
    };
    const r1 = run(fixedJob);
    const r2 = run(() => { order.push('2 start'); return Promise.resolve(true); });
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    expect(order).toEqual(['1 start']);   // job 2 must NOT have started: job 1's side effect has not landed
    sideEffect.resolve();
    expect(await r1).toBe(true); expect(await r2).toBe(true);
    expect(order).toEqual(['1 start', '1 side-effect landed', '2 start']);
  });
});
