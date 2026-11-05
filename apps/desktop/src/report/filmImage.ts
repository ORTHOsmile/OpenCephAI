import { canvasMatrix, displayBounds, type Orientation } from '../canvas/orientation';
import type { Display } from '../tracing/state';
import { adjustPixels } from './filmPixels';

/** The film as the screen shows it — oriented, with Enhance's brightness/contrast/invert (sharpness comes in the
 *  `drawn` bitmap App passes) — as a JPEG for the PDF: quality 0.85, long side at most 2400 px (master plan §8).
 *  Browser only (canvas); the PDF tests use no film. */
export async function filmJpeg(bitmap: ImageBitmap, o: Orientation, d: Display, maxSide = 2400, quality = 0.85): Promise<string> {
  const dims = { W: bitmap.width, H: bitmap.height }, b = displayBounds(o, dims), w = b.x1 - b.x0, h = b.y1 - b.y0;
  const k = Math.min(1, maxSide / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k)); c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('no 2D canvas');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.setTransform(...canvasMatrix({ k, tx: -b.x0 * k, ty: -b.y0 * k }, o, dims, 1));
  ctx.drawImage(bitmap, -0.5, -0.5);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height);
  adjustPixels(img.data, d);
  ctx.putImageData(img, 0, 0);
  return c.toDataURL('image/jpeg', quality);
}
