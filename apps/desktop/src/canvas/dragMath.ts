import type { Vec2 } from '@ceph/geometry';
import { invLinear, type Orientation } from './orientation';

/** Screen delta → image delta through zoom and orientation; ⌥ gives 0.25× precision (§3.5 / Week 2 spec). */
export function imageDeltaFromScreen(o: Orientation, k: number, d: Vec2, precise: boolean): Vec2 {
  const f = (precise ? 0.25 : 1) / k, v = invLinear(o, { x: d.x * f, y: d.y * f });
  return v;
}
/** Arrow key (screen direction, ±1 or ±10) → image delta of the same length. */
export const nudgeVector = (o: Orientation, dx: number, dy: number): Vec2 => invLinear(o, { x: dx, y: dy });

export function hitTest(points: { id: string; s: Vec2 }[], at: Vec2, radius = 8): string | null {
  let best: string | null = null, bd = radius;
  for (const p of points) { const d = Math.hypot(p.s.x - at.x, p.s.y - at.y); if (d <= bd) { bd = d; best = p.id; } }
  return best;
}
/** One apply per animation frame with the latest value; flush() applies immediately (used on pointerup). */
export function createCoalescer<T>(apply: (v: T) => void, schedule: (cb: () => void) => void = (cb) => { requestAnimationFrame(cb); }) {
  let latest: { v: T } | null = null, queued = false;
  const run = () => { queued = false; if (latest) { const v = latest.v; latest = null; apply(v); } };
  return {
    push(v: T) { latest = { v }; if (!queued) { queued = true; schedule(run); } },
    flush() { run(); },
  };
}

/** Where a drag started (or last changed precision): the point's image position and the cursor's screen position. */
export interface DragAnchor { img: Vec2; screen: Vec2; precise: boolean }
/**
 * One pointer move of a landmark drag. Movement is relative to the grab, so an off-centre grab never snaps the point
 * to the cursor; toggling ⌥ re-anchors at the current position, so precision changes never make the point jump.
 */
export function dragStep(o: Orientation, k: number, anchor: DragAnchor, at: Vec2, precise: boolean): { pos: Vec2; anchor: DragAnchor } {
  const d = imageDeltaFromScreen(o, k, { x: at.x - anchor.screen.x, y: at.y - anchor.screen.y }, anchor.precise);
  const pos = { x: anchor.img.x + d.x, y: anchor.img.y + d.y };
  return { pos, anchor: precise === anchor.precise ? anchor : { img: pos, screen: at, precise } };
}
/** True when p lies on the image: pixels span [−0.5, W − 0.5] × [−0.5, H − 0.5] (§2 pixel-centre convention). */
export const insideImage = (p: Vec2, d: { W: number; H: number }) => p.x >= -0.5 && p.y >= -0.5 && p.x <= d.W - 0.5 && p.y <= d.H - 0.5;

/** Degrees turned about `centre` going from `from` to `to`: clockwise-positive on screen (y down), in (−180, 180]. */
export function rotationDrag(centre: Vec2, from: Vec2, to: Vec2): number {
  const a = Math.atan2(from.y - centre.y, from.x - centre.x), b = Math.atan2(to.y - centre.y, to.x - centre.x);
  let d = ((b - a) * 180) / Math.PI;
  while (d > 180) d -= 360; while (d <= -180) d += 360;
  return d;
}
