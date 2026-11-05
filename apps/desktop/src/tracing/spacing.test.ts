import { describe, it, expect } from 'vitest';
import { ASSUMED_MM_PER_PX, MAX_SCALE_STEPS, adjustedWords, baseScale, fitMark, fitNoteLine, isAssumed, machineSizeNote, machineWords, noRulerSentence, scaleLabel, scaleOf, type MachineScale, type Scale } from './spacing';

describe('scale (§2 I → mm, decisions 17 and 21)', () => {
  it('uses the calibration when there is one, else the labelled assumption', () => {
    expect(scaleOf(0.0875)).toEqual({ mmPerPx: 0.0875, source: 'calibration', steps: 0 });
    for (const bad of [null, undefined, 0, -1, NaN, Infinity]) expect(scaleOf(bad)).toEqual({ mmPerPx: ASSUMED_MM_PER_PX, source: 'assumed' });
  });
  it('always says where the scale came from', () => {
    // Spec 2026-10-19 addendum (J, film side): the film's own scale, in the words the report header uses.
    expect(scaleLabel(scaleOf(0.0875))).toBe('0.0875 mm/px (calibrated scale)');
    expect(scaleLabel(scaleOf(null))).toBe('0.1 mm/px (assumed scale: calibrate with K)');
  });
});

describe('request G: a scale that comes from a fit (owner G2, G3)', () => {
  const note = { ref: 'T1', kind: 'sn' as const, k: 1.04, refAssumed: false };
  it('names its reference, how and how much', () => {
    expect(fitMark(note)).toBe('scaled to T1 on S–N (×1.040)');
    expect(fitMark({ ...note, kind: 'points', refAssumed: true })).toBe('scaled to T1 on two points (×1.040), assumed scale');
    expect(scaleLabel({ mmPerPx: 0.104, source: 'fit', fit: note })).toBe('0.1040 mm/px (scaled to T1 on S–N (×1.040))');
  });
  it('fitNoteLine names the fitted film, the same words on the screen and in the report (owner, 23 Oct)', () => {
    const note = { ref: 'T1', kind: 'sn' as const, k: 1.042, refAssumed: false };
    expect(fitNoteLine('T2', note)).toBe('T2 scaled to T1 on S–N (×1.042)');
    expect(fitNoteLine('  ', { ...note, refAssumed: true })).toBe('This film scaled to T1 on S–N (×1.042), assumed scale');
  });

  it('says plainly where the mm come from (owner G2, word for word)', () => {
    expect(noRulerSentence(note)).toBe('This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1.');
    expect(noRulerSentence({ ...note, refAssumed: true })).toBe('This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1. T1 had no ruler either, so both are on the assumed scale.');
  });
  it('is assumed when its reference had no ruler (G3)', () => {
    expect([isAssumed({ mmPerPx: 0.1, source: 'assumed' }), isAssumed({ mmPerPx: 0.1, source: 'calibration', steps: 0 }),
      isAssumed({ mmPerPx: 0.104, source: 'fit', fit: note }), isAssumed({ mmPerPx: 0.104, source: 'fit', fit: { ...note, refAssumed: true } })])
      .toEqual([true, false, false, true]);
  });
  /** Fix round 1, ruling 5: Scale is a discriminated union, so a 'fit' scale cannot exist without its note — the
   *  "assumed scale" mark can never be silently dropped. This line must NOT typecheck; if `fit` ever becomes
   *  optional again (or `Scale` reverts to one flat interface), there is nothing here for TS to complain about,
   *  `@ts-expect-error` becomes an unused directive, and `pnpm build` fails on exactly that (shown in the report:
   *  fails before this round's fix, passes after, fails again when temporarily reverted, passes once restored). */
  it('a "fit" scale cannot be built without its note (type-level; pnpm build enforces this line)', () => {
    // @ts-expect-error a 'fit' Scale must carry its FitNote (the discriminated union has no optional `fit`)
    const bad: Scale = { mmPerPx: 0.1, source: 'fit' };
    expect(bad.mmPerPx).toBe(0.1);
  });
});

describe('a fine-tuned calibration (spec 2026-10-19 addendum 3)', () => {
  it('carries its presses; no ruler, no presses', () => {
    expect(scaleOf(0.101, 2)).toEqual({ mmPerPx: 0.101, source: 'calibration', steps: 2 });
    expect(scaleOf(0.0875)).toEqual({ mmPerPx: 0.0875, source: 'calibration', steps: 0 });
    expect(scaleOf(null, 2)).toEqual({ mmPerPx: 0.1, source: 'assumed' });
    expect(MAX_SCALE_STEPS).toBe(10);
  });
  it('says "adjusted ±n.n %", one decimal, and nothing at 0 presses', () => {
    expect([0, 1, 2, -3, 10, -10].map(adjustedWords))
      .toEqual(['', ', adjusted +0.5 %', ', adjusted +1.0 %', ', adjusted -1.5 %', ', adjusted +5.0 %', ', adjusted -5.0 %']);
    expect(scaleLabel(scaleOf(0.101, 2))).toBe('0.1010 mm/px (calibrated scale, adjusted +1.0 %)');
    expect(scaleLabel(scaleOf(0.0875, 0))).toBe('0.0875 mm/px (calibrated scale)');
  });
});

// Spec 2026-10-20 (owner MS1–MS4). SYNTHETIC machine and dates.
const ms = (over: Partial<MachineScale> = {}): MachineScale => ({ machineId: 'm1', machineName: 'Demo Radiology', spacingMm: 0.0998, widthPx: 2400, heightPx: 3000,
  source: 'film', sourceCaseId: 'c9', sourceFilmDate: '2025-03-12', setAt: '2026-10-24T00:00:00.000Z', applies: true, ...over });
const au = (iso: string) => iso.split('-').reverse().join('/');
describe('a film\'s scale, in order: ruler → machine → (fit) → assumed (spec 2026-10-20)', () => {
  it('a ruler always wins, fine-tune and all', () => {
    expect(baseScale({ spacingMm: 0.1, scaleSteps: 2, machineScale: ms() })).toEqual({ mmPerPx: 0.1, source: 'calibration', steps: 2 });
  });
  it('no ruler, the machine\'s scale applies: a calibrated machine scale, never assumed', () => {
    const s = baseScale({ spacingMm: null, machineScale: ms() });
    expect(s).toEqual({ mmPerPx: 0.0998, source: 'machine', machine: ms() });
    expect(isAssumed(s)).toBe(false);
  });
  it('another size, or no machine scale, or an old doc without the field: assumed, exactly as before', () => {
    for (const m of [ms({ applies: false }), null, undefined]) expect(baseScale({ spacingMm: null, machineScale: m })).toEqual({ mmPerPx: 0.1, source: 'assumed' });
  });
});
describe('MS3: the words', () => {
  it('from a film, entered, or a source film that is gone', () => {
    expect(machineWords(ms(), au)).toBe('calibrated scale (machine: Demo Radiology, from film of 12/03/2025)');
    expect(machineWords(ms({ source: 'entered', sourceCaseId: null, sourceFilmDate: null }), au)).toBe('calibrated scale (machine: Demo Radiology, entered value)');
    expect(machineWords(ms({ sourceFilmDate: null }), au)).toBe('calibrated scale (machine: Demo Radiology, from a calibrated film)');
    expect(machineWords(ms(), au, true)).toBe('calibrated scale (machine: Demo Radiology, from a calibrated film)');   // MQ4: anonymised
  });
  it('on screen: "0.0998 mm/px, calibrated scale (machine: …)"; every other scale word for word as before', () => {
    expect(scaleLabel({ mmPerPx: 0.0998, source: 'machine', machine: ms() }, au)).toBe('0.0998 mm/px, calibrated scale (machine: Demo Radiology, from film of 12/03/2025)');
    expect(scaleLabel({ mmPerPx: 0.1, source: 'calibration', steps: 0 })).toBe('0.1000 mm/px (calibrated scale)');
    expect(scaleLabel({ mmPerPx: 0.1, source: 'assumed' })).toBe('0.1 mm/px (assumed scale: calibrate with K)');
  });
  it('MS2: a film of another size says why its scale stays assumed; otherwise nothing', () => {
    const d = (w: number, h: number, m: MachineScale | null, spacingMm: number | null = null) => ({ image: { width: w, height: h }, machineScale: m, spacingMm });
    expect(machineSizeNote(d(2500, 3100, ms({ applies: false })))).toBe('Demo Radiology has a calibrated scale for films of 2400 × 3000 px; this film is 2500 × 3100 px, so its scale stays assumed.');
    expect(machineSizeNote(d(2400, 3000, ms()))).toBeNull();
    expect(machineSizeNote(d(2500, 3100, ms({ applies: false }), 0.1))).toBeNull();   // its own ruler: nothing to explain
    expect(machineSizeNote(d(2500, 3100, null))).toBeNull();
  });
});
