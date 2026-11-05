import { describe, it, expect } from 'vitest';
import type { FilmFit, FitSave } from '../ipc';
import { putBack } from './useFitPanel';

// SYNTHETIC: an in-memory film_fits table with the library's three fit commands, as the stub in e2e15 keeps it.
const table = () => {
  const rows: Record<string, FitSave & { useOwn: boolean }> = {}, calls: string[] = [];
  return { rows, calls,
    saveFit: async (id: string, f: FitSave) => { calls.push('save'); rows[id] = { ...f, useOwn: rows[id]?.useOwn ?? false }; },
    clearFit: async (id: string) => { calls.push('clear'); delete rows[id]; },
    setFitOwn: async (id: string, on: boolean) => { calls.push(`own ${on}`); rows[id].useOwn = on; } };
};
const saved: FilmFit = { refCaseId: 'g1', refKind: 'sn', refPoints: [[250, 300], [950, 200]], filmPoints: [[270, 310], [942, 214]], mirror: false,
  scale: 1.043, rotation: 0.01, dx: 2, dy: -1, useOwn: false, refTimepoint: 'T1', refSpacingMm: 0.1, savedBy: 'SYNTHETIC', savedAt: 'x' };
const fields = ({ refCaseId, refKind, refPoints, filmPoints, mirror, scale, rotation, dx, dy }: FitSave) =>
  ({ refCaseId, refKind, refPoints, filmPoints, mirror, scale, rotation, dx, dy });

/** Owner D-f (18 Oct): "Remove fit" is undoable — ⌘Z puts the removed fit back as it was. */
describe('putting a removed fit back (⌘Z after Remove fit, owner D-f)', () => {
  it('stores exactly the fit that was removed — only its saved fields, nothing the library adds on reading', async () => {
    const lib = table(); lib.rows.g2 = { ...fields(saved), useOwn: false };
    await lib.clearFit('g2');
    expect(lib.rows.g2).toBeUndefined();                                     // the control: Remove fit deleted the row
    await putBack(lib, 'g2', saved);
    expect(lib.rows.g2).toEqual({ ...fields(saved), useOwn: false });
    expect(lib.calls).toEqual(['clear', 'save']);                            // the switch was off: left off, not written
  });
  it('a fit whose "Use the scale from the fit" was on comes back switched on', async () => {
    const lib = table(); lib.rows.g2 = { ...fields(saved), useOwn: true };
    await lib.clearFit('g2');
    await putBack(lib, 'g2', { ...saved, useOwn: true });
    expect(lib.rows.g2).toEqual({ ...fields(saved), useOwn: true });
    expect(lib.calls).toEqual(['clear', 'save', 'own true']);
  });
});
