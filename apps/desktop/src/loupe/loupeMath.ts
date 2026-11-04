import type { Vec2 } from '@ceph/geometry';
import { invLinear, linearOf, type Orientation } from '../canvas/orientation';

export const LOUPE = { w: 328, h: 190, zoom: 5 } as const;
/** Owner, 16 Oct: the magnifier's zooms (a 2× / 5× switch), kept on this Mac; 5× is the default. */
export const LOUPE_ZOOMS = [2, 5] as const;
export type LoupeZoom = (typeof LOUPE_ZOOMS)[number];
export const LOUPE_ZOOM_KEY = 'loupe_zoom';
export const parseLoupeZoom = (v: string | null | undefined): LoupeZoom => (v === '2' ? 2 : 5);
export async function readLoupeZoom(s: { get: (key: string) => Promise<string | null> }): Promise<LoupeZoom> {
  try { return parseLoupeZoom(await s.get(LOUPE_ZOOM_KEY)); } catch { return LOUPE.zoom; }
}

/** The loupe shows the film in display orientation (same mirror and rotation as the canvas), magnified about `centre`. */
export function imageToLoupe(p: Vec2, centre: Vec2, o: Orientation, zoom: number = LOUPE.zoom): Vec2 {
  const [a, b, c, d] = linearOf(o), x = p.x - centre.x, y = p.y - centre.y;
  return { x: LOUPE.w / 2 + zoom * (a * x + b * y), y: LOUPE.h / 2 + zoom * (c * x + d * y) };
}
export function loupeToImage(q: Vec2, centre: Vec2, o: Orientation, zoom: number = LOUPE.zoom): Vec2 {
  const v = invLinear(o, { x: (q.x - LOUPE.w / 2) / zoom, y: (q.y - LOUPE.h / 2) / zoom });
  return { x: centre.x + v.x, y: centre.y + v.y };
}
export const grabOrPlace = (q: Vec2, ring: Vec2, grabRadius = 14): 'grab' | 'place' =>
  Math.hypot(q.x - ring.x, q.y - ring.y) <= grabRadius ? 'grab' : 'place';
