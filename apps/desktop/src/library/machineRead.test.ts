import { describe, expect, it } from 'vitest';
import type { MachineScale } from '../ipc';
import { afterMachineRead, type MachineReadDoc } from './machineRead';

// Final review I3 (ruling, 25 Oct): after a store call that can assign or move the OPEN film's machine
// ("Read the film again", entering Choose), the screen re-reads the doc and, when the film's mm moved or its sign-off
// was cleared, applies the V3 hold, so nothing re-signs it automatically at a scale the clinician has not seen.
const ms = (spacingMm: number, applies = true): MachineScale => ({ machineId: 'm1', machineName: 'Demo Radiology', spacingMm, widthPx: 1200, heightPx: 1400,
  source: 'entered', sourceCaseId: null, sourceFilmDate: null, setAt: '2026-10-25T00:00:00Z', applies });
const doc = (o: Partial<MachineReadDoc> = {}): MachineReadDoc => ({ spacingMm: null, scaleSteps: 0, fit: null, machine: null, machineScale: null,
  verifiedAt: '2026-10-25T00:00:00Z', verifiedBy: 'SYNTHETIC Dr Demo', ...o });
const m1 = { id: 'm1', name: 'Demo Radiology' };

describe('after a re-read that can move the open film\'s machine (final review I3)', () => {
  it('gaining a machine scale: mm moved and the sign-off cleared -> held, and the screen takes the new scale and the clear', () => {
    const r = afterMachineRead(doc(), doc({ machine: m1, machineScale: ms(0.0998), verifiedAt: null, verifiedBy: null }));
    expect(r.hold).toBe(true);
    expect(r.patch).toEqual({ machine: m1, machineScale: ms(0.0998), fit: null, verifiedAt: null, verifiedBy: null });
  });
  it('a machine with no scale (or one at another size): the mm stay, the sign-off stays, no hold', () => {
    expect(afterMachineRead(doc(), doc({ machine: m1 })).hold).toBe(false);
    expect(afterMachineRead(doc(), doc({ machine: m1, machineScale: ms(0.0998, false) })).hold).toBe(false);
  });
  it('a ruler film moved to a scaled machine: its ruler holds, no hold', () => {
    expect(afterMachineRead(doc({ spacingMm: 0.1 }), doc({ spacingMm: 0.1, machine: m1, machineScale: ms(0.0998) })).hold).toBe(false);
  });
  it('a film not signed off whose mm moved is held too (V3: a calibration holds it the same way)', () => {
    expect(afterMachineRead(doc({ verifiedAt: null, verifiedBy: null }), doc({ machine: m1, machineScale: ms(0.0998), verifiedAt: null, verifiedBy: null })).hold).toBe(true);
  });
  it('the store cleared the sign-off even with the same mm: held (the store is the truth)', () => {
    expect(afterMachineRead(doc(), doc({ verifiedAt: null, verifiedBy: null })).hold).toBe(true);
  });
});
