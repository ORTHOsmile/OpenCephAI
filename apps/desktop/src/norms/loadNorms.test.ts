import { describe, it, expect } from 'vitest';
import { OWN_NORMS_LABEL, type NormSet, type UserNorm } from '@ceph/analyses';
import { readClinicDefault, readUserNorms, safeLoadSets } from './loadNorms';

// Ruling T4-3 / review M-2 (Task 4 fix round 1): the three reads useNorms makes, as plain functions with stub
// loaders, so the failure paths have committed evidence. A failed read is a message for the screen, never swallowed.

const SYNTHETIC_NORM: UserNorm = { setName: 'SYNTHETIC clinic', measurement: 'm01_SNA', mean: 82, sd: 3, sourceNote: 'SYNTHETIC' };

describe('safeLoadSets: a broken norm set — the app still opens and says why', () => {
  it('the committed sets load, no error', () => {
    const r = safeLoadSets();
    expect([r.sets.length > 0, r.loadError]).toEqual([true, null]);
  });
  it('a loader that throws: no sets, and its message', () => {
    const r = safeLoadSets(() => { throw new Error('SYNTHETIC: a broken norm set (bad JSON)'); });
    expect(r.sets).toEqual([]);
    expect(r.loadError).toContain('SYNTHETIC: a broken norm set (bad JSON)');
  });
  it('the loader is called once and its sets passed through', () => {
    const sets = [{ id: 'synthetic' } as NormSet];
    expect(safeLoadSets(() => sets)).toEqual({ sets, loadError: null });
  });
});

describe("readUserNorms: the clinician's own norms", () => {
  it('a list: used, no error', async () => {
    expect(await readUserNorms({ userNorms: async () => [SYNTHETIC_NORM] })).toEqual({ value: [SYNTHETIC_NORM], error: null });
  });
  it('a failed read: none used, and the screen is told — never silently empty', async () => {
    const r = await readUserNorms({ userNorms: async () => { throw new Error('SYNTHETIC disk error'); } });
    expect(r.value).toEqual([]);
    expect(r.error).toMatch(/^Your own norms could not be read/);
    expect(r.error).toContain('SYNTHETIC disk error');
  });
  it('a reply that is not a list: treated as a failed read', async () => {
    const r = await readUserNorms({ userNorms: async () => ({ not: 'a list' }) as unknown as UserNorm[] });
    expect([r.value, r.error !== null]).toEqual([[], true]);
  });
});

describe('readClinicDefault: the clinic default population', () => {
  it('a population, or none set: used, no error', async () => {
    expect(await readClinicDefault({ defaultPopulation: async () => 'malay' })).toEqual({ value: 'malay', error: null });
    expect(await readClinicDefault({ defaultPopulation: async () => null })).toEqual({ value: null, error: null });
  });
  it("a failed read: no default, and the screen is told which norms are shown instead", async () => {
    const r = await readClinicDefault({ defaultPopulation: async () => { throw new Error('SYNTHETIC settings error'); } });
    expect(r.value).toBeNull();
    expect(r.error).toMatch(/^The clinic's default population could not be read/);
    expect(r.error).toContain('SYNTHETIC settings error');
    expect(r.error).toContain(OWN_NORMS_LABEL);
  });
});
