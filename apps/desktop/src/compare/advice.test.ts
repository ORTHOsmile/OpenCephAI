import { describe, it, expect } from 'vitest';
import type { SeriesFilm } from '../ipc';
import type { MachineScale } from '../tracing/spacing';
import { adviceFor, adviceText } from './advice';

const f = (id: string, tp: string, over: Partial<SeriesFilm> = {}): SeriesFilm => ({ id, timepoint: tp, takenOn: `202${tp.slice(1)}-01-01`, takenOnSource: 'label',
  createdAt: id, stage: null, inSeries: true, nameOnly: false, fitRef: null, calibrated: false, ...over });
const film = (id: string, tp: string, spacingMm: number | null = null, fitted = false, machineScale: MachineScale | null = null) => ({ id, timepoint: tp, spacingMm, fitted, machineScale });
// Spec 2026-10-20 (owner MS1–MS4). SYNTHETIC machine and dates.
const ms = (over: Partial<MachineScale> = {}): MachineScale => ({ machineId: 'm1', machineName: 'Demo Radiology', spacingMm: 0.0998, widthPx: 2400, heightPx: 3000,
  source: 'film', sourceCaseId: 'c9', sourceFilmDate: '2025-03-12', setAt: '2026-10-24T00:00:00.000Z', applies: true, ...over });

describe('"not scaled" advice (owner G1)', () => {
  const films = [f('a', 'T1', { calibrated: true }), f('b', 'T2'), f('c', 'T3', { calibrated: true })];
  it('a film with no ruler and no fit is not scaled; it is offered the earliest film with a ruler', () => {
    const a = adviceFor(film('b', 'T2'), films, false)!;
    expect(a).toEqual({ film: 'b', filmLabel: 'T2', ref: 'a', refLabel: 'T1', block: null });
    expect(adviceText(a)).toBe('T2 is not scaled. Calibrate it from its ruler, or scale it to T1?');
  });
  it('says nothing for a film with a ruler, or with a fit', () => {
    expect(adviceFor(film('a', 'T1', 0.1), films, false)).toBeNull();
    expect(adviceFor(film('b', 'T2', null, true), films, false)).toBeNull();
    expect(adviceFor(film('b', 'T2', 0), films, false)).not.toBeNull();       // a stored 0 is no ruler (scaleOf's rule)
  });
  it('the patient’s only film: calibrate only, and why Scale now is off', () => {
    const a = adviceFor(film('s', 'T1'), [f('s', 'T1')], false)!;
    expect([adviceText(a), a.block]).toEqual(['T1 is not scaled. Calibrate it from its ruler.', 'No other X-ray of this patient to scale it to.']);
  });
  it('an unnamed patient: name them first', () => {
    const a = adviceFor(film('u', 'T1'), [f('u', 'T1')], true)!;
    expect([a.refLabel, a.block]).toEqual([null, 'Name the patient first.']);
  });
  it('a film another film is fitted to (D-d): calibrate only, and which fit to reset', () => {
    const a = adviceFor(film('h1', 'T1'), [f('h1', 'T1'), f('h2', 'T2', { fitRef: 'h1' })], false)!;
    expect([adviceText(a), a.block]).toEqual(['T1 is not scaled. Calibrate it from its ruler.', 'T2 is scaled to this film; remove that fit first.']);
  });
  it('MS-4: a machine-scaled film gets no "not scaled" advice', () => {
    expect(adviceFor(film('m', 'T1', null, false, ms()), films, false)).toBeNull();
  });
});
