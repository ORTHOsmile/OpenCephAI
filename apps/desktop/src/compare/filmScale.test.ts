import { describe, it, expect } from 'vitest';
import fixture from '../../../../crates/ceph-store/tests/film_scale_cases.json';
import { ownPages } from './fit';
import { ASSUMED_MM_PER_PX } from '../tracing/spacing';
import type { FilmFit, MachineScale } from '../ipc';

type Case = { name: string; spacingMm: number | null; scaleSteps?: number; machine: { spacingMm: number; applies: boolean } | null;
  fit: { useOwn: boolean; scale: number; refSpacingMm: number | null; refMachineSpacingMm: number | null } | null;
  expect: { mmPerPx: number; source: string; fineTuned?: boolean } };
const machine = (m: NonNullable<Case['machine']>): MachineScale => ({ machineId: 'm', machineName: 'Demo Radiology', spacingMm: m.spacingMm, widthPx: 1,
  heightPx: 1, source: 'entered', sourceCaseId: null, sourceFilmDate: null, setAt: 'x', applies: m.applies });
const fit = (f: NonNullable<Case['fit']>): FilmFit => ({ refCaseId: 'r', refKind: 'sn', refPoints: [[0, 0], [1, 1]], filmPoints: [[0, 0], [1, 1]], mirror: false,
  scale: f.scale, rotation: 0, dx: 0, dy: 0, useOwn: f.useOwn, refTimepoint: 'T1', refSpacingMm: f.refSpacingMm, refMachineSpacingMm: f.refMachineSpacingMm,
  savedBy: 'x', savedAt: 'x' });

/** Part F Task 5 (owner E1): one rule, two languages. Each case of the shared fixture through the screen's `ownPages`
 *  (what a film's own pages use) must give the scale, source and fine-tune flag ceph-store's `film_scale` gives
 *  (crates/ceph-store/src/film_scale.rs reads the same file). A fit to a film with no scale (G3) is the screen's 'fit'
 *  marked `refAssumed`: Rust classes it 'assumed'. Induced failure (task report): swap the machine and fit checks in
 *  `ownPages` → "machine beats fit" fails here. */
describe("Part F: a film's scale, the same order as ceph-store's film_scale (shared fixture)", () => {
  it('every case of the fixture', () => {
    expect(fixture.assumedMmPerPx).toBe(ASSUMED_MM_PER_PX);
    const cases = fixture.cases as Case[];
    expect(cases.length).toBeGreaterThanOrEqual(29);
    let compared = 0;
    for (const c of cases) {
      const s = ownPages({ spacingMm: c.spacingMm, scaleSteps: c.scaleSteps ?? 0, machineScale: c.machine ? machine(c.machine) : null, fit: c.fit ? fit(c.fit) : null }).scale;
      const source = s.source === 'calibration' ? 'ruler' : s.source === 'fit' ? (s.fit.refAssumed ? 'assumed' : 'fit') : s.source;
      const fineTuned = s.source === 'calibration' && s.steps !== 0;
      expect([c.name, s.mmPerPx, source, fineTuned]).toEqual([c.name, c.expect.mmPerPx, c.expect.source, c.expect.fineTuned ?? false]);
      compared += 1;
    }
    expect(compared).toBe(cases.length);
  });
});
