// Every date in this file is SYNTHETIC (made up for the arithmetic; no patient).
import { describe, it, expect } from 'vitest';
import { ageAt } from './age';

describe('ageAt (decimal years at the film date)', () => {
  it('the day before the 12th birthday is just under 12', () => {
    const a = ageAt('2010-03-07', '2022-03-06')!;
    expect(a).toBeLessThan(12);
    expect(a).toBeCloseTo(11.997, 3);
  });
  it('on the 12th birthday it is exactly 12', () => expect(ageAt('2010-03-07', '2022-03-07')).toBe(12));
  it('a full ISO timestamp is accepted (its date part is used)', () =>
    expect(ageAt('2010-03-07T00:00:00Z', '2022-03-07T15:30:00.000Z')).toBe(12));
  it('a leap-day birth: exactly 4 on the next 29 February, 1 on 1 March of a non-leap year', () => {
    expect(ageAt('2008-02-29', '2012-02-29')).toBe(4);
    expect(ageAt('2008-02-29', '2009-03-01')).toBe(1);
    const a = ageAt('2008-02-29', '2009-02-28')!;
    expect(a).toBeLessThan(1);
    expect(a).toBeCloseTo(365 / 365.2425, 9);
  });
  it('half a year on: 183 days past the 10th birthday (2020 is a leap year)', () => expect(ageAt('2010-01-01', '2020-07-02')!).toBeCloseTo(10 + 183 / 365.2425, 9));
  it('the film on the day of birth is 0', () => expect(ageAt('2010-03-07', '2010-03-07')).toBe(0));
  it('a missing date gives null', () => {
    expect(ageAt(null, '2022-03-07')).toBeNull();
    expect(ageAt('2010-03-07', null)).toBeNull();
    expect(ageAt('', '2022-03-07')).toBeNull();
  });
  it('a bad date string gives null', () => {
    expect(ageAt('7/3/2010', '2022-03-07')).toBeNull();
    expect(ageAt('2010-02-30', '2022-03-07')).toBeNull();
    expect(ageAt('2010-13-01', '2022-03-07')).toBeNull();
    expect(ageAt('2010-03-07', 'not a date')).toBeNull();
  });
  it('a film before birth gives null', () => expect(ageAt('2010-03-07', '2010-03-06')).toBeNull());
});
