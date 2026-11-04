import { describe, it, expect } from 'vitest';
import { grabOrPlace, imageToLoupe, loupeToImage, LOUPE, LOUPE_ZOOMS, parseLoupeZoom, readLoupeZoom } from './loupeMath';

const c = { x: 500, y: 400 };
describe('loupe maths', () => {
  it('the centre of the loupe is the centre point', () => { expect(imageToLoupe(c, c, { mirror: false, rotDeg: 0, source: 'none' })).toEqual({ x: LOUPE.w / 2, y: LOUPE.h / 2 }); });
  it('50 screen px in the loupe = 10 image px at 5×, reversed when mirrored', () => {
    const q = { x: LOUPE.w / 2 + 50, y: LOUPE.h / 2 };
    expect(loupeToImage(q, c, { mirror: false, rotDeg: 0, source: 'none' }).x).toBeCloseTo(510, 12);
    expect(loupeToImage(q, c, { mirror: true, rotDeg: 0, source: 'manual' }).x).toBeCloseTo(490, 12);
  });
  it('round-trips under rotation', () => {
    const o = { mirror: true, rotDeg: -12, source: 'manual' as const }, p = { x: 517.25, y: 388.5 };
    const back = loupeToImage(imageToLoupe(p, c, o), c, o); expect(back.x).toBeCloseTo(p.x, 10); expect(back.y).toBeCloseTo(p.y, 10);
  });
  it('pressing on the ring grabs it; pressing elsewhere places the point', () => {
    expect(grabOrPlace({ x: 170, y: 100 }, { x: 164, y: 95 })).toBe('grab');
    expect(grabOrPlace({ x: 220, y: 60 }, { x: 164, y: 95 })).toBe('place');
  });
});

// Owner, 16 Oct: a 2× / 5× switch, remembered on this Mac. A press in the magnifier must land on the same film pixel at
// either zoom, so the maths takes the zoom; 5× stays the default (and the value for anything unreadable).
describe('loupe zoom (owner, 16 Oct)', () => {
  const o0 = { mirror: false, rotDeg: 0, source: 'none' as const };
  it('50 screen px in the loupe = 25 image px at 2× (and still 10 at 5×)', () => {
    const q = { x: LOUPE.w / 2 + 50, y: LOUPE.h / 2 };
    expect(loupeToImage(q, c, o0, 2).x).toBeCloseTo(525, 12);
    expect(loupeToImage(q, c, o0, 5).x).toBeCloseTo(510, 12);
    expect(imageToLoupe({ x: 525, y: 400 }, c, o0, 2).x).toBeCloseTo(LOUPE.w / 2 + 50, 12);
  });
  it('round-trips at 2× under mirror and rotation', () => {
    const o = { mirror: true, rotDeg: 17, source: 'manual' as const }, p = { x: 461.75, y: 432.5 };
    const back = loupeToImage(imageToLoupe(p, c, o, 2), c, o, 2); expect(back.x).toBeCloseTo(p.x, 10); expect(back.y).toBeCloseTo(p.y, 10);
  });
  it('the zooms offered are 2 and 5; 5 is the default', () => { expect(LOUPE_ZOOMS).toEqual([2, 5]); expect(LOUPE.zoom).toBe(5); });
  it('a stored setting reads back; anything else (missing, junk, another number) is 5', async () => {
    expect(parseLoupeZoom('2')).toBe(2); expect(parseLoupeZoom('5')).toBe(5);
    for (const v of [null, '', 'x', '3', '2.5', '10']) expect(parseLoupeZoom(v)).toBe(5);
    expect(await readLoupeZoom({ get: async () => '2' })).toBe(2);
    expect(await readLoupeZoom({ get: async () => { throw new Error('no settings'); } })).toBe(5);
  });
});
