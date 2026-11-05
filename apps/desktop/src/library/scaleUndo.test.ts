import { beforeEach, describe, expect, it } from 'vitest';
import type { MachineScale, MachineScaleRow, MachineSummary, ScaleChange } from '../ipc';
import { changeScale, discardScaleUndo, leftPage, libraryReplaced, scaleUndoEpoch, undoRowFor, undoScaleChange, useForMachineFlow } from './scaleUndo';

// Final review I4 (ruling, 25 Oct): Undo is the LAST change per (library, machine), recorded for every scale
// write (Film layouts and "Use for this machine"), discarded when Film layouts closes for any reason (leaving the
// Library page included), on a library switch and on a restore. M1: a cancelled Undo keeps the Undo.
const sc = (spacingMm: number, source: 'entered' | 'film' = 'entered', setAt = '2026-10-20T00:00:00Z'): MachineScale => ({ machineId: 'm1', machineName: 'Demo Radiology',
  spacingMm, widthPx: 1200, heightPx: 1400, source, sourceCaseId: source === 'film' ? 'c9' : null, sourceFilmDate: null, setAt, applies: false });
const m = (s: MachineScale | null): MachineSummary => ({ id: 'm1', name: 'Demo Radiology', films: 3, learned: [], scale: s, scaleFilms: 3 });
const row = (spacingMm: number, source = 'entered'): MachineScaleRow => ({ spacingMm, widthPx: 1200, heightPx: 1400, source, setAt: null });
const some: ScaleChange = { films: ['c1'], fitted: [], deleted: 0 };
function fakeLib(start: MachineScale | null) {
  let cur = start; const writes: (MachineScaleRow | null)[] = [];
  return {
    writes, scale: () => cur,
    machineScaleChange: async () => some,
    setMachineScale: async (_id: string, r: MachineScaleRow | null) => { writes.push(r); cur = r ? sc(r.spacingMm, r.source.startsWith('film:') ? 'film' : 'entered', r.setAt ?? 'now') : null; return some; },
    machines: async () => [m(cur)],
    machineScaleFromFilm: async (_c: string): Promise<[string, MachineScaleRow]> => ['m1', row(0.103, 'film:c9')],
  };
}
const yes = async () => true, no = async () => false;
beforeEach(() => libraryReplaced());

describe('scale Undo (final review I4, M1)', () => {
  it('a change in Film layouts is undoable to the value before it', async () => {
    const lib = fakeLib(sc(0.1));
    await changeScale(lib, yes, m(lib.scale()), row(0.101));
    expect(undoRowFor(m(lib.scale()))).toEqual({ spacingMm: 0.1, widthPx: 1200, heightPx: 1400, source: 'entered', setAt: '2026-10-20T00:00:00Z' });
  });
  it('(b) "Use for this machine" is recorded too: Undo goes back to the value before IT, never two changes back', async () => {
    const lib = fakeLib(sc(0.1));
    await changeScale(lib, yes, m(lib.scale()), row(0.101));           // A -> B in Film layouts
    expect(await useForMachineFlow(lib, yes, 'c9')).toBe('done');      // B -> C from the film
    expect(undoRowFor(m(lib.scale()))?.spacingMm).toBe(0.101);          // B, not A
  });
  it('a write nobody recorded hides the Undo (the scale is no longer the one the record changed it to)', async () => {
    const lib = fakeLib(sc(0.1));
    await changeScale(lib, yes, m(lib.scale()), row(0.101));
    expect(undoRowFor(m(sc(0.2)))).toBeUndefined();
  });
  it('M1: No to the Undo warning keeps the Undo; Yes restores it and the Undo is gone', async () => {
    const lib = fakeLib(sc(0.1));
    await changeScale(lib, yes, m(lib.scale()), row(0.101));
    expect(await undoScaleChange(lib, no, m(lib.scale()))).toBe('cancelled');
    expect(lib.writes.length).toBe(1);
    expect(undoRowFor(m(lib.scale()))?.spacingMm).toBe(0.1);
    expect(await undoScaleChange(lib, yes, m(lib.scale()))).toBe('done');
    expect(lib.scale()?.spacingMm).toBe(0.1);
    expect(undoRowFor(m(lib.scale()))).toBeUndefined();
  });
  it('No to a change\'s warning records nothing', async () => {
    const lib = fakeLib(sc(0.1));
    expect(await changeScale(lib, no, m(lib.scale()), row(0.101))).toBe('cancelled');
    expect(undoRowFor(m(lib.scale()))).toBeUndefined();
  });
  it('closing Film layouts, leaving the Library page, and a restore each discard it', async () => {
    const lib = fakeLib(sc(0.1));
    await changeScale(lib, yes, m(lib.scale()), row(0.101)); discardScaleUndo();
    expect(undoRowFor(m(lib.scale()))).toBeUndefined();
    await changeScale(lib, yes, m(lib.scale()), row(0.102));
    leftPage('library', 'library'); expect(undoRowFor(m(lib.scale()))).toBeDefined();   // no page change: kept
    leftPage('tracing', 'library'); expect(undoRowFor(m(lib.scale()))).toBeDefined();   // arriving at the Library: kept
    leftPage('library', 'tracing'); expect(undoRowFor(m(lib.scale()))).toBeUndefined();
    await changeScale(lib, yes, m(lib.scale()), row(0.103)); libraryReplaced();
    expect(undoRowFor(m(lib.scale()))).toBeUndefined();
  });
  it('a write that started before a restore never records into the restored library', async () => {
    const lib = fakeLib(sc(0.1)); const at = scaleUndoEpoch();
    const slow = { ...lib, setMachineScale: async (id: string, r: MachineScaleRow | null) => { libraryReplaced(); return lib.setMachineScale(id, r); } };
    await changeScale(slow, yes, m(lib.scale()), row(0.101));
    expect(scaleUndoEpoch()).not.toBe(at);
    expect(undoRowFor(m(lib.scale()))).toBeUndefined();
  });
});
