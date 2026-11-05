import type { Display } from '../tracing/state';

/** Enhance's brightness, contrast and invert on the film's pixels (RGBA, in place), as the screen's CSS filter does —
 *  brightness, then contrast, then invert, each clamped — because WebKit ignores a 2D context's `filter`
 *  (canvas/display.ts). The model never sees these; this is for the printed film only. */
export function adjustPixels(px: Uint8ClampedArray, d: Pick<Display, 'brightness' | 'contrast' | 'invert'>): void {
  if (d.brightness === 1 && d.contrast === 1 && !d.invert) return;
  const clamp = (v: number) => Math.max(0, Math.min(255, v));
  for (let i = 0; i < px.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      let v = clamp(px[i + c] * d.brightness);
      v = clamp((v - 127.5) * d.contrast + 127.5);
      px[i + c] = d.invert ? 255 - v : v;
    }
  }
}
