/**
 * A FIFO queue of async jobs: job n+1 does not START until job n's own promise has settled (resolved OR rejected),
 * in queue order — even if job n+1 would otherwise settle first. A rejected job never blocks the one behind it.
 *
 * Fix round 1, M4: this is what `useCase.ts`'s ruler-store chain needed to actually PROVE. The e2e17 "burst" smoke
 * (I5) cannot prove ordering by construction — the fake library is synchronous localStorage behind `invoke`, so two
 * concurrent calls resolve in call order whether or not anything serialises them. Only a test with hand-resolved
 * deferreds (see `serial.test.ts`) can show job 2 waiting on job 1.
 */
export function serial() {
  let tail: Promise<unknown> = Promise.resolve();
  return function run<T>(job: () => Promise<T>): Promise<T> {
    const result = tail.then(job, job);              // start job only once the previous job has settled, success or failure
    tail = result.then(() => undefined, () => undefined);   // never let a rejection stop the chain from moving on
    return result;
  };
}
