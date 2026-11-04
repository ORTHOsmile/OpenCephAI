// Task 4 (Part C norms, schema 9): the store's `UserNorm` and the desktop ipc `UserNorm` must be the same type as
// `@ceph/analyses`' `UserNorm`, since `library.userNorms()` feeds `resolveNorm`'s `userNorms` directly with no
// reshaping. This is a type-level check (a UserNorm value as ipc.ts declares it must satisfy resolveNorm's
// NormQuery.userNorms) plus one runtime call, so a shape drift fails to compile, not just at runtime.
import { describe, it, expect } from 'vitest';
import { resolveNorm, type NormQuery } from '@ceph/analyses';
import type { UserNorm } from '../ipc';

describe('the ipc UserNorm shape is accepted by resolveNorm', () => {
  it('a UserNorm as the store/ipc layer would send it resolves to the clinician’s own norm', () => {
    const fromIpc: UserNorm = { setName: 'My clinic', measurement: 'm01_SNA', mean: 82, sd: 2.1, sourceNote: 'my own measurements, 40 patients' };
    const q: NormQuery = {
      measurement: 'm01_SNA', analysisId: 'steiner', population: null, clinicDefault: null,
      sex: null, ageYears: null, sets: [], userNorms: [fromIpc],
    };
    const r = resolveNorm(q);
    expect(r.kind).toBe('norm');
    if (r.kind === 'norm') {
      expect(r.mean).toBe(82);
      expect(r.sd).toBe(2.1);
      expect(r.flags).toContain('user-norm');
    }
  });
});
