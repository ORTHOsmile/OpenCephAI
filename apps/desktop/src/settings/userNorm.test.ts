import { describe, it, expect } from 'vitest';
import { byId } from '@ceph/analyses';
import { checkUserNorm, measurementLabel, MEASUREMENT_CHOICES, normSets } from './userNorm';

const good = { setName: ' SYNTHETIC clinic ', measurement: 'm01_SNA', mean: '80.5', sd: '2', sourceNote: 'SYNTHETIC sample of 40' };
describe('a user norm as typed in Settings ▸ Norms', () => {
  it('a good entry, trimmed', () => {
    expect(checkUserNorm(good)).toEqual({ ok: true, norm: { setName: 'SYNTHETIC clinic', measurement: 'm01_SNA', mean: 80.5, sd: 2, sourceNote: 'SYNTHETIC sample of 40' } });
  });
  it('a blank SD is no SD (shown, not coloured)', () => {
    const r = checkUserNorm({ ...good, sd: ' ' }); expect(r.ok && r.norm.sd).toBeNull();
  });
  it.each([
    [{ setName: '  ' }, 'Name the set'], [{ measurement: 'm45_U1NAmmLabial' }, 'Choose a measurement'],
    [{ mean: 'abc' }, 'Type the mean as a number'], [{ sd: '0' }, 'The SD must be more than 0'], [{ sd: '-1' }, 'The SD must be more than 0'],
    [{ sourceNote: '' }, 'Say where the norm comes from'],
  ])('refuses %o', (over, error) => {
    expect(checkUserNorm({ ...good, ...over } as any)).toEqual({ ok: false, error });
  });
  // Ruling T10-3 (12 Oct, review I3): a user norm passes the SAME plausibility check every published norm entry
  // does — not a new threshold, the shared `plausibilityErrors` (PLAUSIBLE_BOUNDS/sdMax, `@ceph/analyses`), so a
  // slipped decimal point or a wrong sign is caught here exactly as it would be in a committed set.
  it('refuses a mean outside the plausible range for the measurement’s unit (SNA is deg, bound [-90, 200])', () => {
    expect(checkUserNorm({ ...good, mean: '300' })).toEqual({ ok: false, error: 'mean 300 is implausible for unit "deg"' });
  });
  it('refuses an SD above the plausible bound for the unit (deg sdMax 20)', () => {
    expect(checkUserNorm({ ...good, sd: '25' })).toEqual({ ok: false, error: 'sd 25 is implausible for unit "deg"' });
  });
  it('a mean and SD inside the plausible bounds are not refused on that account (control: 82±4 is a real SNA norm)', () => {
    expect(checkUserNorm({ ...good, mean: '82', sd: '4' }).ok).toBe(true);
  });
  it('the measurement list has every live catalogue entry and no retired one', () => {
    expect(MEASUREMENT_CHOICES.some((m) => m.id === 'm45_U1NAmmLabial')).toBe(false);
    expect(MEASUREMENT_CHOICES.find((m) => m.id === 'm01_SNA')?.label).toBe('SNA');
  });
  it('rows grouped by set, sets by name', () => {
    const n = (s: string, m: string) => ({ setName: s, measurement: m, mean: 1, sd: null, sourceNote: 'x' });
    expect(normSets([n('B', 'm01_SNA'), n('A', 'm02_SNB'), n('B', 'm02_SNB')]).map((x) => [x.setName, x.rows.length])).toEqual([['A', 1], ['B', 2]]);
  });
  // Edge case: a user norm saved against a measurement whose id is simply unknown (e.g. a hand-edited settings
  // file, or a catalogue id removed outright) — the row must still render (its raw id), not crash the whole
  // dialog. `byId` still resolves a RETIRED entry (it stays in `CATALOGUE`, just out of `MEASUREMENT_CHOICES`),
  // so that case reads its real label, not the fallback; only a truly unknown id hits it.
  it('measurementLabel reads the catalogue label for a live id', () => {
    expect(measurementLabel('m01_SNA')).toBe('SNA');
  });
  it('measurementLabel still reads a retired entry’s own label (byId does not throw for it)', () => {
    expect(measurementLabel('m45_U1NAmmLabial')).toBe(byId('m45_U1NAmmLabial').label);
  });
  it('measurementLabel falls back to the raw id for a truly unknown measurement', () => {
    expect(measurementLabel('not-a-real-id')).toBe('not-a-real-id');
  });
});

// Final review M-5 (Task 10 M3): Number() accepts hex, binary, exponent and "Infinity" forms a clinician never means;
// a mean or SD is a plain decimal (a typed minus sign "−" read as "-").
describe('a user norm: plain decimals only (final review M-5)', () => {
  it.each(['0x10', '1e1', '0b1', '0o7', 'Infinity', '1,5', '1.2.3', '--2', '2-'])('refuses the mean %s', (mean) => {
    expect(checkUserNorm({ ...good, mean })).toEqual({ ok: false, error: 'Type the mean as a number' });
  });
  it.each(['0x2', '1e0', '0b1'])('refuses the SD %s', (sd) => {
    expect(checkUserNorm({ ...good, sd })).toEqual({ ok: false, error: 'The SD must be more than 0' });
  });
  it.each([['80', 80], ['80.', 80], ['.5', 0.5], ['+3', 3], ['-3.25', -3.25], ['−3.25', -3.25], [' 82.5 ', 82.5]])('accepts the mean %s as %d', (mean, want) => {
    const r = checkUserNorm({ ...good, measurement: 'm03_ANB', mean, sd: '2' });
    expect(r.ok && r.norm.mean).toBe(want);
  });
});
