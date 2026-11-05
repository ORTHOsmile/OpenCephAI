import { describe, it, expect } from 'vitest';
import { changeWarning, parseEntered, scaleSummary } from './machineScale';

// Spec 2026-10-20 MS4 (owner's words) and MS1. SYNTHETIC ids.
describe('changeWarning (MS4)', () => {
  it('the owner\'s sentence, with the count; singular; fitted and Recently deleted parts', () => {
    expect(changeWarning({ films: Array(23).fill('c'), fitted: [], deleted: 0 })).toBe('This changes the mm of 23 films of this machine. Each loses Tracing verified.');
    expect(changeWarning({ films: ['c'], fitted: [], deleted: 0 })).toBe('This changes the mm of 1 film of this machine. Each loses Tracing verified.');
    expect(changeWarning({ films: ['a', 'b'], fitted: ['f', 'g'], deleted: 1 }))
      .toBe('This changes the mm of 2 films of this machine and 2 films fitted to them. Each loses Tracing verified. 1 more in Recently deleted is changed too.');
  });
  it('nothing changes: no warning', () => { expect(changeWarning({ films: [], fitted: [], deleted: 0 })).toBeNull(); });
});
describe('parseEntered (MS1, typed in Film layouts)', () => {
  it('mm per pixel and the film size in pixels', () => {
    expect(parseEntered('0.0998', '2400', '3000')).toEqual({ spacingMm: 0.0998, widthPx: 2400, heightPx: 3000, source: 'entered', setAt: null });
  });
  it('refuses what cannot be a scale, in plain words', () => {
    for (const [mm, w, h] of [['0', '2400', '3000'], ['abc', '2400', '3000'], ['0,1', '2400', '3000'], ['0.1', '', '3000'], ['0.1', '2400.5', '3000'], ['0.1', '2400', '-1']])
      expect(typeof parseEntered(mm, w, h), `${mm} ${w} ${h}`).toBe('string');
  });
});
describe('scaleSummary (Film layouts row)', () => {
  it('the scale, its source, its size and how many films use it', () => {
    const m = { id: 'm1', name: 'Demo Radiology', films: 30, learned: [], scaleFilms: 23, scale: { machineId: 'm1', machineName: 'Demo Radiology', spacingMm: 0.0998,
      widthPx: 2400, heightPx: 3000, source: 'film' as const, sourceCaseId: 'c9', sourceFilmDate: '2025-03-12', setAt: 'x', applies: false } };
    expect(scaleSummary(m, (iso) => iso.split('-').reverse().join('/'))).toBe('Scale 0.0998 mm/px for 2400 × 3000 px films, from film of 12/03/2025 · used by 23 films');
    expect(scaleSummary({ ...m, scale: null, scaleFilms: 0 }, (i) => i)).toBe('No calibrated scale');
  });
});
