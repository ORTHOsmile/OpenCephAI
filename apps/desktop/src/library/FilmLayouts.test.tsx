import { describe, expect, it } from 'vitest';
import { applyScaleChange, learnedText } from './FilmLayouts';
import type { MachineScale, MachineScaleRow, MachineSummary, ScaleChange } from '../ipc';

// Pre-flight ruling (Task 7, X9): FilmLayouts used to print the raw field name (`CHOOSE_LABELS[f] ?? f`) for a
// field that isn't a Choose-on-the-film button, which Gender and Referring practitioner (owner Q6) are not. The
// box words (owner Q12) must show instead.
describe('learnedText: Preferences > Film layouts reads learned fields with the box words', () => {
  it('a machine that has learned Gender reads "Gender learned"', () => {
    expect(learnedText({ id: 'm1', name: 'Machine 1', films: 3, learned: ['gender'], scale: null, scaleFilms: 0 })).toBe('Gender learned');
  });
  it('a machine that has learned Referring practitioner reads the box words, not "referrer"', () => {
    expect(learnedText({ id: 'm1', name: 'Machine 1', films: 3, learned: ['referrer'], scale: null, scaleFilms: 0 })).toBe('Referring practitioner learned');
  });
  it('several learned fields join with the same box words as Choose on the film', () => {
    expect(learnedText({ id: 'm1', name: 'Machine 1', films: 3, learned: ['full', 'gender', 'referrer'], scale: null, scaleFilms: 0 }))
      .toBe('Full name, Gender, Referring practitioner learned');
  });
  it('nothing learned yet', () => {
    expect(learnedText({ id: 'm1', name: 'Machine 1', films: 0, learned: [], scale: null, scaleFilms: 0 })).toBe('nothing learned yet');
  });
});

// Spec 2026-10-20 (MS4, MS6): `applyScaleChange` is what the Save/Remove/Undo buttons call — count first
// (`machineScaleChange`), warn with the owner's words, only then write (`setMachineScale`). Tested directly
// (stubbed `lib`/`askFn`): this repo has no DOM-interaction test harness (no jsdom/happy-dom installed, and
// installing one is out of this task's scope) to "render it, click Save" as the brief's Step 5 literally describes.
const row: MachineScaleRow = { spacingMm: 0.0998, widthPx: 1200, heightPx: 1400, source: 'entered', setAt: null };
const scale: MachineScale = { machineId: 'm1', machineName: 'Demo Radiology', spacingMm: 0.1, widthPx: 1200, heightPx: 1400,
  source: 'entered', sourceCaseId: null, sourceFilmDate: null, setAt: '2026-10-20T00:00:00Z', applies: true };
const machine: MachineSummary = { id: 'm1', name: 'Demo Radiology', films: 5, learned: [], scale, scaleFilms: 3 };
const noChange: ScaleChange = { films: [], fitted: [], deleted: 0 };
const someChange: ScaleChange = { films: ['c1'], fitted: [], deleted: 0 };

describe('applyScaleChange (MS4, MS6)', () => {
  it('counts first, then warns, then saves — in that order', async () => {
    const calls: string[] = [];
    const lib = {
      machineScaleChange: async (_id: string, _r: MachineScaleRow | null) => { calls.push('count'); return someChange; },
      setMachineScale: async (_id: string, _r: MachineScaleRow | null) => { calls.push('save'); return someChange; },
    };
    const askFn = async () => { calls.push('warn'); return true; };
    await applyScaleChange(lib, askFn, machine, row);
    expect(calls).toEqual(['count', 'warn', 'save']);
  });
  it('nothing changes: no warning, saved at once', async () => {
    const calls: string[] = [];
    const lib = {
      machineScaleChange: async () => { calls.push('count'); return noChange; },
      setMachineScale: async () => { calls.push('save'); return noChange; },
    };
    const askFn = async () => { calls.push('warn'); return true; };
    await applyScaleChange(lib, askFn, machine, row);
    expect(calls).toEqual(['count', 'save']);
  });
  it('Cancel on the warning: nothing saved, returns "cancelled"', async () => {
    let saved = false;
    const lib = { machineScaleChange: async () => someChange, setMachineScale: async () => { saved = true; return someChange; } };
    const result = await applyScaleChange(lib, async () => false, machine, row);
    expect(result).toBe('cancelled');
    expect(saved).toBe(false);
  });
  it('returns the old row — with its original setAt — for Undo (MQ10)', async () => {
    const lib = { machineScaleChange: async () => someChange, setMachineScale: async () => someChange };
    const old = await applyScaleChange(lib, async () => true, machine, row);
    expect(old).toEqual({ spacingMm: 0.1, widthPx: 1200, heightPx: 1400, source: 'entered', setAt: '2026-10-20T00:00:00Z' });
  });
  it('a machine with no scale before the change: the old row is null', async () => {
    const lib = { machineScaleChange: async () => someChange, setMachineScale: async () => someChange };
    const old = await applyScaleChange(lib, async () => true, { ...machine, scale: null }, row);
    expect(old).toBeNull();
  });
});
