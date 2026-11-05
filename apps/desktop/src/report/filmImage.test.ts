import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { NO_ORIENTATION } from '../canvas/orientation';
import { DISPLAY_DEFAULT } from '../tracing/state';
import { filmJpeg } from './filmImage';

// Browser-only (canvas), so there is no jsdom in this repo's test setup (preflight-rulings: no @types/node, and no
// jsdom dependency either — vitest runs in plain Node). A hand-rolled `document.createElement('canvas')` stub,
// scoped to this file only, is enough to exercise the scaling arithmetic and the Enhance pixel pass without
// pulling in a real canvas implementation; what it does NOT prove is that a real 2D context draws the same way —
// that is covered end to end by the e2e smoke (R16/R17, Task 9 report).
interface Captured { w: number; h: number; data: Uint8ClampedArray }
function fakeDocument(calls: Captured[]) {
  return {
    createElement(tag: string) {
      if (tag !== 'canvas') throw new Error(`unexpected element ${tag}`);
      const c = { width: 0, height: 0 } as { width: number; height: number; getContext?: unknown; toDataURL?: unknown };
      c.getContext = (type: string) => {
        if (type !== '2d') return null;
        return {
          fillStyle: '',
          fillRect() {},
          setTransform() {},
          drawImage() {},
          getImageData(_x: number, _y: number, w: number, h: number) {
            const data = new Uint8ClampedArray(w * h * 4);
            for (let i = 0; i < w * h; i++) { data[i * 4] = 100; data[i * 4 + 1] = 100; data[i * 4 + 2] = 100; data[i * 4 + 3] = 255; }
            return { data, width: w, height: h };
          },
          putImageData(img: { data: Uint8ClampedArray }) { calls.push({ w: c.width, h: c.height, data: img.data }); },
        };
      };
      c.toDataURL = (type: string, quality: number) => `data:${type};q=${quality};w=${c.width};h=${c.height}`;
      return c;
    },
  };
}

describe('filmJpeg (Task 9): the screen\'s own film, oriented and Enhanced, as a JPEG for the PDF', () => {
  let calls: Captured[];
  beforeEach(() => { calls = []; (globalThis as unknown as { document: unknown }).document = fakeDocument(calls); });
  afterEach(() => { delete (globalThis as { document?: unknown }).document; });
  const bmp = (w: number, h: number) => ({ width: w, height: h }) as unknown as ImageBitmap;

  it('under the 2400 px default, the canvas matches the film\'s own size (no scaling)', async () => {
    expect(await filmJpeg(bmp(1200, 1400), NO_ORIENTATION, DISPLAY_DEFAULT)).toBe('data:image/jpeg;q=0.85;w=1200;h=1400');
  });

  it('edge case: a long side over 2400 px is scaled down to at most 2400', async () => {
    // long side 3000 -> k = 2400/3000 = 0.8 -> 3000*0.8=2400, 2000*0.8=1600
    expect(await filmJpeg(bmp(3000, 2000), NO_ORIENTATION, DISPLAY_DEFAULT)).toBe('data:image/jpeg;q=0.85;w=2400;h=1600');
  });

  it('quality and maxSide are both overridable', async () => {
    // maxSide 600 on a 1200x1400 film -> k = 600/1400 = 0.428571... -> w=round(1200*k)=514, h=round(1400*k)=600
    expect(await filmJpeg(bmp(1200, 1400), NO_ORIENTATION, DISPLAY_DEFAULT, 600, 0.5)).toBe('data:image/jpeg;q=0.5;w=514;h=600');
  });

  it('Enhance (brightness/contrast/invert) is applied to the printed film, not just the screen\'s CSS filter', async () => {
    await filmJpeg(bmp(10, 10), NO_ORIENTATION, { ...DISPLAY_DEFAULT, brightness: 2 });
    const last = calls.at(-1)!;
    expect(last.data[0]).toBe(200);   // 100 * 2, clamped — see filmPixels.ts
    expect(last.data[3]).toBe(255);   // alpha untouched
  });

  it('no Enhance change: the pixels pass through unmodified', async () => {
    await filmJpeg(bmp(10, 10), NO_ORIENTATION, DISPLAY_DEFAULT);
    expect(calls.at(-1)!.data[0]).toBe(100);
  });
});
