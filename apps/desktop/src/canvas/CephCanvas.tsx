import { useEffect, useMemo, useRef, useState } from 'react';
import type { Expr, NodeId, Vec2 } from '@ceph/geometry';
import type { Action, TracingState } from '../tracing/state';
import { AI_POINT_LABEL } from '../confidence';
import { canvasMatrix, displayBounds, fitOriented, toImage, toScreen } from './orientation';
import { clampPanBox, keepCentre, zoomAt, type Viewport } from './viewport';
import { createCoalescer, dragStep, hitTest, insideImage, rotationDrag, type DragAnchor } from './dragMath';
import { filmFilter } from './display';
import { Overlay, type CompareTracing, type Look } from './Overlay';
import { ChooseLayer } from './ChooseLayer';
import { wordAt } from '../library/choose';
import type { ChooseApi } from '../library/useChoose';
import type { Ghost } from '../ghosts/ghosts';
import type { Decimals } from '../format';
import { ModelBars } from '../progress/BarsView';
import type { Bar } from '../progress/modelBars';

interface Props {
  bitmap: ImageBitmap | null; state: TracingState; dispatch: (a: Action) => void;
  view: Viewport | null; setView: (v: Viewport) => void; registry: Record<NodeId, Expr>;
  mmPerPx: number; readOnly: boolean;
  /** Owner, 6 Oct, item S: whether `mmPerPx` is the ASSUMED default (no ruler calibration on this case) rather than a
   *  measured one — passed through to the ghost hover label so it can mark an assumed distance, never inferred. */
  assumedScale: boolean;
  /** What to draw: the film, or a sharpened copy of it (Enhance). Fitting and coordinates always follow `bitmap`. */
  drawn?: ImageBitmap | null; calib: Vec2[] | null; onCalibrationClick: (p: Vec2) => void;
  /** Owner, 16 Oct (C): the pointer over the film while marking the ruler (for the magnifier), and a ruler mark dragged. */
  onCalibrationHover?: (p: Vec2 | null) => void; onCalibrationMove?: (i: number, p: Vec2) => void;
  /** Serial superimposition: the patient's other films, aligned into this film's pixels, each in its ABO look; the open
   *  film's own look. */
  compare?: CompareTracing[] | null; own?: Look | null;
  /** Choose mode (spec 2026-09-29): a click on the film picks a recognised word, or re-reads the area clicked. */
  chooser?: ChooseApi | null;
  /** The other installed models' points (ghost marks), or null when hidden. */
  ghosts?: Ghost[] | null;
  /** The open case's id (owner, 5 Oct, M5): passed through to Overlay so it can clear a hovered ghost's label when
   *  the case changes under it. */
  caseId?: string | null;
  /** Owner DEC-1: decimals shown in the ghost hover label, passed through to Overlay. */
  decimals?: Decimals;
  /** Owner, 16 Oct: a loading bar per model while the film is traced. */
  bars?: Bar[];
}

/** Image on a canvas (pixel-centre convention, §2), overlay in screen space, drag/pan/zoom through one mapping. */
export function CephCanvas({ bitmap, state, dispatch, view, setView, registry, mmPerPx, readOnly, assumedScale, calib, onCalibrationClick, onCalibrationHover, onCalibrationMove, drawn, compare, own, chooser, ghosts, caseId, decimals, bars }: Props) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dims = useMemo(() => (bitmap ? { W: bitmap.width, H: bitmap.height } : { W: 1, H: 1 }), [bitmap]);
  const o = state.orientation;
  // Placement mode (Week 3): the active landmark has no point yet, so a click on the film places it.
  const placing = !readOnly && state.active && !state.points[state.active] ? state.active : null;
  const drag = useRef<{ id: string; anchor: DragAnchor } | null>(null);
  const pan = useRef<{ x: number; y: number; v: Viewport } | null>(null);
  const moves = useMemo(() => createCoalescer<Vec2>((pos) => dispatch({ type: 'dragTo', pos })), [dispatch]);
  const rot = useRef<{ last: Vec2; deg: number } | null>(null);
  const turns = useMemo(() => createCoalescer<number>((deg) => dispatch({ type: 'rotateTo', deg })), [dispatch]);

  useEffect(() => {
    const el = host.current!; const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el); return () => ro.disconnect();
  }, []);

  useEffect(() => {                                         // image layer: redrawn only when the view or orientation changes
    const c = canvas.current!, dpr = window.devicePixelRatio || 1;
    const W = Math.round(size.w * dpr), H = Math.round(size.h * dpr);
    if (c.width !== W || c.height !== H) { c.width = W; c.height = H; }
    const ctx = c.getContext('2d')!; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, c.width, c.height);
    if (!bitmap || !view) return;
    if (state.overlays.background === 'grid') { ctx.fillStyle = getComputedStyle(c).getPropertyValue('--paper').trim(); ctx.fillRect(0, 0, c.width, c.height); return; }
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(...canvasMatrix(view, o, dims, dpr));
    ctx.drawImage(drawn ?? bitmap, -0.5, -0.5);
  }, [bitmap, drawn, view, size, o, dims, state.overlays.background]);

  const local = (e: { clientX: number; clientY: number }): Vec2 => { const r = host.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  const S = (p: Vec2) => (view ? toScreen(view, o, dims, p) : p);
  // The newest view, updated synchronously: several wheel or pinch events can arrive before React re-renders.
  const viewNow = useRef(view); viewNow.current = view;
  // Fit when a film is first shown; a resized stage keeps the zoom and centre (Week 2 carry-over).
  const fittedFor = useRef<ImageBitmap | null>(null), lastSize = useRef(size);
  useEffect(() => {
    if (!bitmap || !size.w) return;
    const v = viewNow.current;
    if (fittedFor.current !== bitmap || !v) { fittedFor.current = bitmap; setView(fitOriented(o, dims, size.w, size.h)); }
    else setView(keepCentre(v, lastSize.current, size));
    lastSize.current = size;
  }, [bitmap, size.w, size.h]);   // eslint-disable-line react-hooks/exhaustive-deps
  const clamp = (v: Viewport) => { const n = clampPanBox(v, displayBounds(o, dims), size.w, size.h); viewNow.current = n; setView(n); };

  const calibDrag = useRef<number | null>(null);
  // Review I-1: one ruler update per frame, as landmark drags (`moves`) already are.
  const markMoves = useMemo(() => createCoalescer<{ i: number; p: Vec2 }>(({ i, p }) => onCalibrationMove?.(i, p)), [onCalibrationMove]);
  const hovers = useMemo(() => createCoalescer<Vec2 | null>((p) => onCalibrationHover?.(p)), [onCalibrationHover]);
  const onPointerDown = (e: React.PointerEvent) => {
    if (!view || !bitmap || e.button !== 0) return;
    // Choosing (final review M3): a landmark still drags and a drag still pans; a click that doesn't move picks a word
    // or re-reads the area (decided on release).
    // Owner, 16 Oct (C): a ruler mark drags like a point (while marking and while the dialog is open). Tested first, so a
    // mark on a recognised word is dragged, never chosen (review I-2).
    const markHit = calib && onCalibrationMove ? calib.findIndex((m) => { const s = S(m); return Math.hypot(s.x - local(e).x, s.y - local(e).y) <= 10; }) : -1;
    if (markHit >= 0) { chooseDown.current = null; calibDrag.current = markHit; host.current!.setPointerCapture(e.pointerId); return; }
    const onPoint = !!hitTest(Object.entries(state.points).map(([k, p]) => ({ id: k, s: S(p) })), local(e));
    // Calibrating takes the click first, even on a recognised word (final review).
    // Owner PLACE-WINS (16 Oct): a point waiting to be placed takes the click, even in Choose mode.
    chooseDown.current = chooser?.choose && !readOnly && !onPoint && !placing && !(calib && calib.length < 2) ? { at: local(e), shift: e.shiftKey, word: wordUnder(local(e)), dragged: false } : null;
    // A press on a word selects by dragging across words (owner, 30 Sep: M2); anywhere else still pans.
    if (chooseDown.current?.word && !e.shiftKey) { host.current!.setPointerCapture(e.pointerId); return; }
    if (calib && calib.length < 2) {                         // calibrating: a click marks the ruler (a drag after it still pans)
      const q = toImage(view, o, dims, local(e));
      if (insideImage(q, dims)) { onCalibrationClick(q); return; }
    }
    const at = local(e), id = hitTest(Object.entries(state.points).map(([k, p]) => ({ id: k, s: S(p) })), at);
    host.current!.setPointerCapture(e.pointerId);
    if (id && !readOnly && !calib) { drag.current = { id, anchor: { img: { x: state.points[id].x, y: state.points[id].y }, screen: at, precise: e.altKey } }; dispatch({ type: 'beginDrag', id }); }
    else if (placing && !chooseDown.current && insideImage(toImage(view, o, dims, at), dims)) dispatch({ type: 'place', id: placing, pos: toImage(view, o, dims, at) });
    else if (e.altKey && !readOnly) { rot.current = { last: at, deg: o.rotDeg }; dispatch({ type: 'beginRotate' }); }   // ⌥-drag on the film rotates
    else pan.current = { x: at.x, y: at.y, v: view };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0 && (drag.current || pan.current || rot.current)) { onPointerUp(); return; }   // released outside: never a stuck drag
    if (!view) return; const at = local(e);
    if (calibDrag.current !== null) {
      const q = toImage(view, o, dims, at);
      markMoves.push({ i: calibDrag.current, p: { x: Math.min(dims.W - 0.5, Math.max(-0.5, q.x)), y: Math.min(dims.H - 0.5, Math.max(-0.5, q.y)) } });
      return;
    }
    if (calib && calib.length < 2 && onCalibrationHover) { const q = toImage(view, o, dims, at); hovers.push(insideImage(q, dims) ? q : null); }
    const cd = chooseDown.current;
    if (cd?.word && e.buttons === 1 && Math.hypot(at.x - cd.at.x, at.y - cd.at.y) > 4) {
      const hit = wordUnder(at);
      if (hit) { cd.dragged = true; chooser?.onDrag(cd.word, hit.line, hit.word); }
      return;
    }
    if (drag.current) {
      const g = drag.current, step = dragStep(o, view.k, g.anchor, at, e.altKey);
      g.anchor = step.anchor; const pos = step.pos;
      moves.push({ x: Math.min(dims.W - 0.5, Math.max(-0.5, pos.x)), y: Math.min(dims.H - 0.5, Math.max(-0.5, pos.y)) });
    } else if (rot.current) {
      const c = toScreen(view, o, dims, { x: (dims.W - 1) / 2, y: (dims.H - 1) / 2 });          // D rotates about the image centre
      rot.current.deg += rotationDrag(c, rot.current.last, at); rot.current.last = at;
      turns.push(rot.current.deg);
    } else if (pan.current) {
      const p = pan.current; clamp({ k: p.v.k, tx: p.v.tx + at.x - p.x, ty: p.v.ty + at.y - p.y });
    }
  };
  const chooseDown = useRef<{ at: Vec2; shift: boolean; word: { line: number; word: number } | null; dragged: boolean } | null>(null);
  /** The recognised word under a screen point, while choosing. */
  const wordUnder = (at: Vec2) => {
    if (!view || !chooser?.choose) return null;
    const q = toImage(view, o, dims, at);
    return insideImage(q, dims) ? wordAt(chooser.lines, { x: (q.x + 0.5) / dims.W, y: (q.y + 0.5) / dims.H }) : null;
  };
  /** A click without movement while choosing: the word under it, or a re-read of that area. */
  const chooseClick = (e: React.PointerEvent) => {
    const d = chooseDown.current; chooseDown.current = null;
    if (!d || !view || !chooser?.choose || d.dragged) return;
    const at = local(e);
    if (Math.hypot(at.x - d.at.x, at.y - d.at.y) > 4) return;
    const q = toImage(view, o, dims, at);
    if (!insideImage(q, dims)) return;
    const p = { x: (q.x + 0.5) / dims.W, y: (q.y + 0.5) / dims.H }, hit = wordAt(chooser.lines, p);
    if (hit) chooser.onWord(hit.line, hit.word, d.shift); else chooser.onEmpty(p);
  };
  const onPointerUp = () => {
    if (calibDrag.current !== null) { markMoves.flush(); calibDrag.current = null; }
    if (drag.current) { moves.flush(); drag.current = null; dispatch({ type: 'endDrag' }); }
    if (rot.current) { turns.flush(); rot.current = null; dispatch({ type: 'endRotate' }); }
    pan.current = null;
  };
  // Trackpad pinch: WebKit sends gesturestart/gesturechange (with a cumulative `scale`), Chromium sends ctrl+wheel.
  const live = useRef({ clamp, local }); live.current = { clamp, local };
  const pinch = useRef<number | null>(null);
  useEffect(() => {
    const el = host.current!;
    const start = (e: Event) => { e.preventDefault(); pinch.current = (e as unknown as { scale: number }).scale || 1; };
    const change = (e: Event) => {
      e.preventDefault(); const g = e as unknown as { scale: number; clientX: number; clientY: number };
      const { clamp: c, local: l } = live.current, v = viewNow.current;
      if (!v || pinch.current === null || !g.scale) return;
      c(zoomAt(v, l(g), g.scale / pinch.current)); pinch.current = g.scale;
    };
    const end = (e: Event) => { e.preventDefault(); pinch.current = null; };
    el.addEventListener('gesturestart', start); el.addEventListener('gesturechange', change); el.addEventListener('gestureend', end);
    return () => { el.removeEventListener('gesturestart', start); el.removeEventListener('gesturechange', change); el.removeEventListener('gestureend', end); };
  }, []);

  const onWheel = (e: React.WheelEvent) => {
    const v = viewNow.current;
    if (!v || !bitmap || pinch.current !== null) return;             // during a WebKit pinch, ignore any ctrl+wheel echo
    if (e.metaKey || e.ctrlKey) clamp(zoomAt(v, local(e), Math.exp(-e.deltaY * 0.002)));
    else clamp({ ...v, tx: v.tx - e.deltaX, ty: v.ty - e.deltaY });
  };

  return (
    <div className="stage" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => { chooseClick(e); onPointerUp(); }}
         onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp} onWheel={onWheel} style={{ cursor: drag.current ? 'grabbing' : placing || (calib && calib.length < 2) ? 'crosshair' : chooser?.choose ? 'pointer' : 'default', touchAction: 'none' }}>
      <canvas ref={canvas} style={{ filter: filmFilter(state.display, state.overlays.background) }} />   {/* display-only: the model reads the stored file */}
      {view && bitmap && <Overlay state={state} dims={dims} registry={registry} S={S} mmPerPx={mmPerPx} assumedScale={assumedScale} calib={calib} compare={compare} own={own} ghosts={ghosts} caseId={caseId} decimals={decimals} />}
      {!bitmap && <div className="empty">Drag a cephalogram onto the window, or press ⌘O</div>}
      {calib && calib.length < 2 && <div className="place-hint">Click the {calib.length ? 'second' : 'first'} ruler mark. Zoom in for accuracy · Esc cancels</div>}
      {view && bitmap && chooser?.choose && !readOnly && <ChooseLayer api={chooser} dims={dims} S={S} />}
      {chooser?.choose && !readOnly && !placing && chooser.hint && <div className="place-hint">{chooser.hint}</div>}
      {placing && <div className="place-hint">Click the film to place {placing}. Esc cancels.</div>}
      {bars && <ModelBars bars={bars} />}
      <div className="banner">{AI_POINT_LABEL}: clinician review required · not a diagnostic device</div>
    </div>
  );
}
