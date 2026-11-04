import { useEffect, useState } from 'react';

/**
 * Unsharp mask on RGBA pixels: out = src + amount × (src − 3×3 box blur), per colour channel, clamped to 0–255; alpha is
 * copied. Edges are clamped (the border pixel repeats). Display only: the stored film and what the AI reads never change.
 */
export function unsharp(src: Uint8ClampedArray, w: number, h: number, amount: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  if (!amount) return out;
  const at = (x: number, y: number, c: number) => src[(Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))) * 4 + c];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) sum += at(x + dx, y + dy, c);
        out[i + c] = src[i + c] + amount * (src[i + c] - sum / 9);          // Uint8ClampedArray clamps and rounds
      }
    }
  }
  return out;
}

/**
 * The film to draw: the original, or a sharpened copy once it is ready (computed off the input bitmap, ~0.1 s for a
 * full ceph). Until the copy is ready, and at sharpness 0, the original is drawn.
 */
export function useSharpened(bitmap: ImageBitmap | null, amount: number): ImageBitmap | null {
  const [sharp, setSharp] = useState<{ from: ImageBitmap; amount: number; bmp: ImageBitmap } | null>(null);
  useEffect(() => {
    if (!bitmap || !amount) return;
    let cancelled = false;
    const t = setTimeout(async () => {                                        // let a slider settle before recomputing
      const c = document.createElement('canvas'); c.width = bitmap.width; c.height = bitmap.height;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(bitmap, 0, 0);
      const img = ctx.getImageData(0, 0, c.width, c.height);
      img.data.set(unsharp(img.data, c.width, c.height, amount));
      const bmp = await createImageBitmap(img);
      if (!cancelled) setSharp({ from: bitmap, amount, bmp });
    }, 150);
    return () => { cancelled = true; clearTimeout(t); };
  }, [bitmap, amount]);
  return bitmap && amount && sharp && sharp.from === bitmap && sharp.amount === amount ? sharp.bmp : bitmap;
}
