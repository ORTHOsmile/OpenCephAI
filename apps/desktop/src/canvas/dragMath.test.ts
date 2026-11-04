import { describe, it, expect } from 'vitest';
import { createCoalescer, dragStep, hitTest, imageDeltaFromScreen, nudgeVector, insideImage, rotationDrag } from './dragMath';

describe('drag maths', () => {
  it('Review Focus 3: ⌥-drag on a mirrored, rotated view moves the point with the gesture', () => {
    const o = { mirror: true, rotDeg: 90, source: 'manual' as const };
    // Screen right by 40 px at zoom 2, precise: 40/2 × 0.25 = 5 image px. Through mirror + 90° that is image-up:
    // D maps the image direction (0,−1) to the screen direction (1,0), so the inverse gives (0,−5).
    const d = imageDeltaFromScreen(o, 2, { x: 40, y: 0 }, true);
    expect(Math.hypot(d.x, d.y)).toBeCloseTo(5, 12);
    expect(d.x).toBeCloseTo(0, 12); expect(d.y).toBeCloseTo(-5, 12);
  });
  it('nudge follows the screen arrow on a mirrored view', () => {
    const d = nudgeVector({ mirror: true, rotDeg: 0, source: 'manual' }, 1, 0);
    expect(d.x).toBeCloseTo(-1, 12); expect(d.y).toBeCloseTo(0, 12);
    const e = nudgeVector({ mirror: false, rotDeg: 0, source: 'none' }, 0, 10);
    expect(e).toEqual({ x: 0, y: 10 });
  });
  it('hit-testing picks the nearest point within 8 px', () => {
    const pts = [{ id: 'S', s: { x: 100, y: 100 } }, { id: 'N', s: { x: 106, y: 100 } }];
    expect(hitTest(pts, { x: 105, y: 101 })).toBe('N');
    expect(hitTest(pts, { x: 130, y: 100 })).toBeNull();
  });
  it('coalesces many pointer moves into one update per frame, keeping the last', () => {
    const got: number[] = []; let pending: (() => void) | null = null;
    const c = createCoalescer<number>((v) => got.push(v), (cb) => { pending = cb; });
    for (let i = 0; i < 50; i++) c.push(i);
    expect(got).toEqual([]); pending!(); expect(got).toEqual([49]);
    c.push(7); c.flush(); expect(got).toEqual([49, 7]);
  });
});

describe('dragStep (review fixes #3, #4)', () => {
  const o = { mirror: false, rotDeg: 0, source: 'none' as const }, k = 0.5;
  const start = { img: { x: 100, y: 100 }, screen: { x: 300, y: 300 }, precise: false };
  it('grabbing off-centre does not snap the point to the cursor', () => {
    expect(dragStep(o, k, start, { x: 300, y: 300 }, false).pos).toEqual({ x: 100, y: 100 });
    expect(dragStep(o, k, start, { x: 310, y: 300 }, false).pos).toEqual({ x: 120, y: 100 });   // 10 screen px at k=0.5 = 20 image px
  });
  it('pressing ⌥ mid-drag does not make the point jump, then moves at 0.25×', () => {
    const coarse = dragStep(o, k, start, { x: 400, y: 300 }, false);                           // +200 image px
    const pressed = dragStep(o, k, coarse.anchor, { x: 400, y: 300 }, true);
    expect(pressed.pos).toEqual(coarse.pos);
    const fine = dragStep(o, k, pressed.anchor, { x: 404, y: 300 }, true);
    expect(fine.pos.x).toBeCloseTo(coarse.pos.x + 4 / k * 0.25, 12);
    const released = dragStep(o, k, fine.anchor, { x: 404, y: 300 }, false);
    expect(released.pos.x).toBeCloseTo(fine.pos.x, 12);
  });
});
describe('insideImage (pixel-centre convention, §2)', () => {
  it('accepts the whole pixel area and nothing beyond it', () => {
    const d = { W: 100, H: 50 };
    for (const p of [{ x: -0.5, y: -0.5 }, { x: 99.5, y: 49.5 }, { x: 50, y: 25 }]) expect(insideImage(p, d)).toBe(true);
    for (const p of [{ x: -0.6, y: 0 }, { x: 0, y: 49.6 }, { x: NaN, y: 1 }]) expect(insideImage(p, d)).toBe(false);
  });
});
describe('rotationDrag', () => {
  it('is clockwise-positive on screen (y down) and wraps to (−180, 180]', () => {
    expect(rotationDrag({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(90, 12);
    expect(rotationDrag({ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 0 })).toBeCloseTo(-90, 12);
    expect(rotationDrag({ x: 0, y: 0 }, { x: -1, y: 0.01 }, { x: -1, y: -0.01 })).toBeCloseTo(1.146, 3);   // across ±180 without a jump
  });
});
