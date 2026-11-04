import { useEffect, useMemo, useRef, useState } from 'react';
import type { Vec2 } from '@ceph/geometry';
import type { Action, TracingState } from '../tracing/state';
import { linearOf } from '../canvas/orientation';
import { createCoalescer } from '../canvas/dragMath';
import { filterOf } from '../canvas/display';
import { settings } from '../ipc';
import { grabOrPlace, imageToLoupe, loupeToImage, readLoupeZoom, LOUPE, LOUPE_ZOOMS, LOUPE_ZOOM_KEY, type LoupeZoom } from './loupeMath';

/** Docked magnifier (§0 rule 1), 2× or 5× (owner, 16 Oct; kept on this Mac). Drag the ring, or press elsewhere to place the
 *  active point there (decision 18). */
/** Owner, 16 Oct (C): while calibrating, the magnifier works on the two ruler marks instead of a landmark. `centre` is the
 *  pointer while marking (or the mark last moved); a press marks the ruler (fewer than two marks) or moves a mark. */
export interface Ruler { centre: Vec2 | null; marks: Vec2[]; active: number | null; onPress: (pos: Vec2) => void; onMove: (i: number, pos: Vec2) => void }

export function Loupe({ bitmap, state, dispatch, ruler = null }: { bitmap: ImageBitmap | null; state: TracingState; dispatch: (a: Action) => void; ruler?: Ruler | null }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [frozen, setFrozen] = useState<{ centre: Vec2; grab: Vec2 | null; start: Vec2; mark?: number } | null>(null);
  const [zoom, setZoom] = useState<LoupeZoom>(LOUPE.zoom);
  useEffect(() => { void readLoupeZoom(settings).then(setZoom); }, []);
  const pickZoom = (z: LoupeZoom) => { setZoom(z); void settings.set(LOUPE_ZOOM_KEY, String(z)).catch(() => {}); };
  const id = state.active, p = id ? state.points[id] : null, o = state.orientation;
  const centre = frozen?.centre ?? (ruler ? ruler.centre : p ? { x: p.x, y: p.y } : null);
  const moves = useMemo(() => createCoalescer<Vec2>((pos) => dispatch({ type: 'dragTo', pos })), [dispatch]);   // one move per frame

  useEffect(() => {
    const c = ref.current!, dpr = window.devicePixelRatio || 1;
    c.width = LOUPE.w * dpr; c.height = LOUPE.h * dpr;
    const ctx = c.getContext('2d')!; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.fillStyle = getComputedStyle(c).getPropertyValue('--canvas').trim(); ctx.fillRect(0, 0, c.width, c.height);
    if (!bitmap || !centre) return;
    const [a, b, cc, d] = linearOf(o), z = zoom * dpr, t = imageToLoupe({ x: 0, y: 0 }, centre, o, zoom);
    ctx.setTransform(z * a, z * cc, z * b, z * d, t.x * dpr, t.y * dpr);
    ctx.imageSmoothingEnabled = false;                       // show real pixels when judging a landmark
    ctx.drawImage(bitmap, -0.5, -0.5);
  }, [bitmap, centre?.x, centre?.y, o, zoom]);                     // eslint-disable-line react-hooks/exhaustive-deps

  // Review M-2: a ruler mark stays on the film — a press off it does nothing; a drag past the edge stops at the edge.
  const W = bitmap?.width ?? 0, H = bitmap?.height ?? 0;
  const keep = (p: Vec2): Vec2 | null => (bitmap && p.x >= -0.5 && p.y >= -0.5 && p.x <= W - 0.5 && p.y <= H - 0.5 ? p : null);
  const clampToFilm = (p: Vec2): Vec2 | null => (bitmap ? { x: Math.min(W - 0.5, Math.max(-0.5, p.x)), y: Math.min(H - 0.5, Math.max(-0.5, p.y)) } : null);
  const at = (e: React.PointerEvent): Vec2 => { const r = ref.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const onDown = (e: React.PointerEvent) => {
    if (ruler) {                                              // C: the ruler marks, not a landmark
      if (e.button !== 0 || !centre) return;
      const q = at(e), pos = keep(loupeToImage(q, centre, o, zoom));
      if (!pos) return;                                        // review M-2: never off the film
      if (ruler.marks.length < 2) { ruler.onPress(pos); return; }
      ref.current!.setPointerCapture(e.pointerId);
      const near = ruler.marks.map((m, i) => ({ i, r: imageToLoupe(m, centre, o, zoom) })).find(({ r }) => grabOrPlace(q, r) === 'grab');
      const i = near?.i ?? ruler.active ?? 1;
      if (!near) ruler.onMove(i, pos);
      setFrozen({ centre, grab: near ? { x: q.x - near.r.x, y: q.y - near.r.y } : { x: 0, y: 0 }, start: q, mark: i });
      return;
    }
    if (e.button !== 0 || !p || !centre || !id) return;
    ref.current!.setPointerCapture(e.pointerId);
    const q = at(e), ring = imageToLoupe(p, centre, o, zoom), mode = grabOrPlace(q, ring);
    dispatch({ type: 'beginDrag', id });
    if (mode === 'place') dispatch({ type: 'dragTo', pos: loupeToImage(q, centre, o, zoom) });
    setFrozen({ centre, grab: mode === 'grab' ? { x: q.x - ring.x, y: q.y - ring.y } : { x: 0, y: 0 }, start: q });
  };
  const onMove = (e: React.PointerEvent) => {
    if (!frozen) return; const q = at(e), g = frozen.grab ?? { x: 0, y: 0 };
    if (ruler && frozen.mark !== undefined) { const m = clampToFilm(loupeToImage({ x: q.x - g.x, y: q.y - g.y }, frozen.centre, o, zoom)); if (m) ruler.onMove(frozen.mark, m); return; }
    moves.push(loupeToImage({ x: q.x - g.x, y: q.y - g.y }, frozen.centre, o, zoom));
  };
  const onUp = () => { if (frozen) { if (frozen.mark === undefined) { moves.flush(); dispatch({ type: 'endDrag' }); } setFrozen(null); } };
  const ring = !ruler && p && centre ? imageToLoupe(p, centre, o, zoom) : null;
  const rulerRings = ruler && centre ? ruler.marks.map((m) => imageToLoupe(m, centre, o, zoom)) : [];
  // §0 rule 3: once a point has been moved, its original AI position stays visible as a hollow ring.
  const aiRing = !ruler && p?.ai && centre && (p.ai.x !== p.x || p.ai.y !== p.y) ? imageToLoupe(p.ai, centre, o, zoom) : null;

  return (
    <div className="loupe" role="application" data-mode={ruler ? 'ruler' : 'point'}
      aria-label={ruler ? `Magnifier, ${zoom}×, ruler marks. ${ruler.marks.length < 2 ? 'Press to mark the ruler' : 'Drag a mark to move it'}` : `Magnifier, ${zoom}×. Drag the ring or press to place ${id ?? 'the active landmark'}`}>
      <canvas ref={ref} style={{ width: LOUPE.w, height: LOUPE.h, filter: filterOf(state.display) }} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} />
      {!ruler && id && !p && <div className="loupe-msg">Click the film to place {id}</div>}
      {ruler && !centre && <div className="loupe-msg">Move over the ruler to magnify it</div>}
      <div className="crosshair" aria-hidden="true" />
      {aiRing && <div className="ai-ring" title="AI position" style={{ left: aiRing.x - 7, top: aiRing.y - 7 }} />}
      {ring && p && <div className={p.verified ? 'ring verified' : 'ring'} style={{ left: ring.x - 9, top: ring.y - 9 }} />}
      {rulerRings.map((r, i) => <div key={i} className="ring ruler" style={{ left: r.x - 9, top: r.y - 9 }} />)}
      <div className="zoom" role="group" aria-label="Magnification">{LOUPE_ZOOMS.map((z) =>
        <button key={z} type="button" aria-pressed={z === zoom} title={`Magnify ${z}×`} onClick={() => pickZoom(z)}>{z}×</button>)}</div>
    </div>
  );
}
