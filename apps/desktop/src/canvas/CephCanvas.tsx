import { useEffect, useMemo, useRef, useState } from 'react';
import type { Expr, NodeId, Vec2 } from '@ceph/geometry';
import type { PointCheckFlag, RulerMarks } from '../ipc';
import type { Action, TracingState } from '../tracing/state';
import { AI_LINE, aiLineShown } from '../confidence';
import { PointCheckNote } from '../layout/PointCheckNote';
import { pressOnPoint, DOUBLE_PX, type LastPress } from '../tracing/pointGestures';
import { isMod, isSpacePan } from '../input/keymap';
import { canvasMatrix, displayBounds, fitOriented, toImage, toScreen } from './orientation';
import { clampPanBox, keepCentre, wheelFactor, zoomAnchor, zoomAt, type Viewport } from './viewport';
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
import type { Sim } from '../compare/fit';
import { wrap } from '../compare/fit';

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
  /** Request G: the film being fitted, drawn over the open film (its reference) through its fit at `alpha`; `base` false
   *  shows paper instead of the open film's own picture. */
  fitLayer?: { image: ImageBitmap; sim: Sim; alpha: number; base: boolean } | null;
  /** Request G (Task 8): while a film is being fitted the pointer adjusts it: a click picks a reference point when
   *  `picking`, a drag moves the film, ⌥-drag turns it about `pivot`; positions are the open film's image px. */
  fitInput?: { picking: boolean; pivot: Vec2; hint: string; onPick: (p: Vec2) => void; onMove: (d: Vec2) => void; onTurn: (rad: number) => void } | null;
  /** Request G (Task 8): the points picked for a two-point fit, drawn as marks on the film. */
  fitMarks?: Vec2[];
  /** Spec 2026-10-19 (F): the ruler marks left on the film after calibrating, and their drag. Hidden while calibrating and on a read-only film. */
  rulerMarks?: RulerMarks | null; onRulerMove?: (i: 0 | 1, p: Vec2) => void; onRulerEnd?: () => void;
  /** Spec 2026-10-19 addendum (H): the open film's tracing is signed off, so the AI line hides. */
  signedOff?: boolean;
  /** Stage A (task 6): the point check's flag at each pin, and the lines for a check that did not run (shown with the AI line). */
  checks?: Record<string, PointCheckFlag> | null; checkLines?: string[];
  /** Stage A (task 7): the film note ("This film looks unusual overall…") and its Checked press; no press when `canCheck` is false. */
  filmChecks?: PointCheckFlag[]; canCheck?: boolean; onFilmChecked?: (checkIds: number[]) => void;
}

/** Image on a canvas (pixel-centre convention, §2), overlay in screen space, drag/pan/zoom through one mapping. */
export function CephCanvas({ bitmap, state, dispatch, view, setView, registry, mmPerPx, readOnly, assumedScale, calib, onCalibrationClick, onCalibrationHover, onCalibrationMove, drawn, compare, own, chooser, ghosts, caseId, decimals, bars, fitLayer, fitInput, fitMarks, rulerMarks, onRulerMove, onRulerEnd, signedOff = false, checks, checkLines, filmChecks, canCheck = false, onFilmChecked }: Props) {
  const host = useRef<HTMLDivElement>(null), canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dims = useMemo(() => (bitmap ? { W: bitmap.width, H: bitmap.height } : { W: 1, H: 1 }), [bitmap]);
  const o = state.orientation;
  // Placement mode (Week 3): the active landmark has no point yet, so a click on the film places it.
  const placing = !readOnly && state.active && !state.points[state.active] ? state.active : null;
  const drag = useRef<{ id: string; anchor: DragAnchor; started: boolean } | null>(null);
  const lastPress = useRef<LastPress | null>(null);   // spec 2026-10-19 V5: the press before, for a double press
  const pan = useRef<{ x: number; y: number; v: Viewport } | null>(null);
  // Spec 2026-10-19 addendum (G): Space held with the pointer over the film pans by dragging, from anywhere on it.
  const over = useRef(false), space = useRef(false), [spaceDown, setSpaceDown] = useState(false);
  useEffect(() => {
    const keyOf = (e: KeyboardEvent) => { const t = e.target as HTMLElement | null;
      return { key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey, targetTag: t?.tagName, targetType: (t as HTMLInputElement | null)?.type, targetEditable: !!t?.isContentEditable }; };
    const down = (e: KeyboardEvent) => { if (!isSpacePan(keyOf(e), over.current)) return; e.preventDefault(); if (!space.current) { space.current = true; setSpaceDown(true); } };
    const up = (e: KeyboardEvent) => { if (e.key !== ' ' || !space.current) return; e.preventDefault(); space.current = false; setSpaceDown(false); };
    const off = () => { space.current = false; setSpaceDown(false); };
    window.addEventListener('keydown', down); window.addEventListener('keyup', up); window.addEventListener('blur', off);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', off); };
  }, []);
  const moves = useMemo(() => createCoalescer<Vec2>((pos) => dispatch({ type: 'dragTo', pos })), [dispatch]);
  const rot = useRef<{ last: Vec2; deg: number } | null>(null);
  const turns = useMemo(() => createCoalescer<number>((deg) => dispatch({ type: 'rotateTo', deg })), [dispatch]);
  const fitDrag = useRef<{ last: Vec2; turn: boolean } | null>(null);
  const fitNow = useRef(fitInput); fitNow.current = fitInput;
  // One update per frame, summing every pointer move since the last (a drag never loses a step).
  const fitAcc = useRef({ dx: 0, dy: 0, rad: 0 });
  const fitFlush = useMemo(() => createCoalescer<number>(() => {
    const a = fitAcc.current; fitAcc.current = { dx: 0, dy: 0, rad: 0 };
    if (a.dx || a.dy) fitNow.current?.onMove({ x: a.dx, y: a.dy });
    if (a.rad) fitNow.current?.onTurn(a.rad);
  }), []);

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
    const paper = () => { ctx.fillStyle = getComputedStyle(c).getPropertyValue('--paper').trim(); ctx.fillRect(0, 0, c.width, c.height); };
    const grid = state.overlays.background === 'grid';
    if (grid || (fitLayer && !fitLayer.base)) { paper(); if (!fitLayer) return; }
    ctx.imageSmoothingQuality = 'high';
    ctx.setTransform(...canvasMatrix(view, o, dims, dpr));
    if (!grid && (!fitLayer || fitLayer.base)) ctx.drawImage(drawn ?? bitmap, -0.5, -0.5);
    if (fitLayer) {                                         // the fitted film's pixels → the open film's pixels, then as above
      const m = fitLayer.sim;
      ctx.save(); ctx.transform(m.a, m.b, m.c, m.d, m.e, m.f); ctx.globalAlpha = fitLayer.alpha;
      ctx.drawImage(fitLayer.image, -0.5, -0.5); ctx.restore();
    }
  }, [bitmap, drawn, view, size, o, dims, state.overlays.background, fitLayer]);

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
  // Spec 2026-10-19 (F): the ruler marks left on the film. Hidden while calibrating and on a read-only film.
  const marks = !readOnly && !calib ? rulerMarks ?? null : null;
  // Fix round 1, I1: a ruler-mark drag is a point drag — an anchor relative to the grab (never snaps to the
  // cursor), a move threshold (`DOUBLE_PX`) before it starts, and ⌥ precision through the same `dragStep`.
  const rulerDrag = useRef<{ i: 0 | 1; anchor: DragAnchor; started: boolean } | null>(null);
  const rulerMoves = useMemo(() => createCoalescer<{ i: 0 | 1; p: Vec2 }>(({ i, p }) => onRulerMove?.(i, p)), [onRulerMove]);
  // Fix round 1, M1: the marks hidden mid-drag (k, ⌘Z, the preview opening) must not leave the HOOK's own drag
  // state stuck. `onRulerEnd` is always called on release (below, if the move passed the threshold) regardless of
  // whether `marks` is currently visible — the hook's own `onEnd` is what decides whether to recalibrate
  // (`enabledRef`, and whether the underlying ruler changed mid-drag) and, either way, clears its drag state
  // unconditionally. Clearing `rulerDrag` here instead (skipping that call) would leave the hook's `drag` state
  // applied to the next `ruler` it sees once visible again — a stale offset reappearing after Esc.
  const onPointerDown = (e: React.PointerEvent) => {
    if (!view || !bitmap || e.button !== 0) return;
    if (space.current) { chooseDown.current = null; const at = local(e); host.current!.setPointerCapture(e.pointerId); pan.current = { x: at.x, y: at.y, v: view }; return; }   // G: Space-drag pans, never drags, picks, places or marks
    if (fitInput) {                                   // request G: the film being fitted takes the pointer
      const q = toImage(view, o, dims, local(e));
      if (fitInput.picking) { if (insideImage(q, dims)) fitInput.onPick(q); return; }
      host.current!.setPointerCapture(e.pointerId);
      fitDrag.current = { last: q, turn: e.altKey };
      return;
    }
    // Choosing (final review M3): a landmark still drags and a drag still pans; a click that doesn't move picks a word
    // or re-reads the area (decided on release).
    const at = local(e);
    // Owner, 16 Oct (C): a ruler mark drags like a point (while marking and while the dialog is open). Tested first, so a
    // mark on a recognised word is dragged, never chosen (review I-2).
    const markHit = calib && onCalibrationMove ? calib.findIndex((m) => { const s = S(m); return Math.hypot(s.x - at.x, s.y - at.y) <= 10; }) : -1;
    if (markHit >= 0) { chooseDown.current = null; calibDrag.current = markHit; lastPress.current = null; host.current!.setPointerCapture(e.pointerId); return; }
    // Fix round 1, I2 (ruling): a landmark always wins over a ruler mark — the point hit-test runs
    // FIRST, and the ruler-mark hit-test applies only when no point is within its own hit radius.
    const pointHit = hitTest(Object.entries(state.points).map(([k, p]) => ({ id: k, s: S(p) })), at);
    // Preflight-rulings M12: placing wins — a press near a ruler mark while a point waits to be placed places the
    // point instead of dragging the mark.
    const rulerHit = !placing && !pointHit && marks && onRulerMove ? [marks.p1, marks.p2].findIndex((m) => { const s = S(m); return Math.hypot(s.x - at.x, s.y - at.y) <= 10; }) : -1;
    if ((rulerHit === 0 || rulerHit === 1) && marks) {
      // Fix round 1, I1: anchor at the grab point (never the mark's centre), so the mark moves by the drag
      // distance and does not snap to the cursor; the move threshold and ⌥ precision come from `dragStep` below,
      // exactly as a point drag.
      chooseDown.current = null;
      rulerDrag.current = { i: rulerHit, anchor: { img: rulerHit === 0 ? marks.p1 : marks.p2, screen: at, precise: e.altKey }, started: false };
      host.current!.setPointerCapture(e.pointerId);
      return;
    }
    const onPoint = !!pointHit;
    // Calibrating takes the click first, even on a recognised word (final review).
    // Owner PLACE-WINS (16 Oct): a point waiting to be placed takes the click, even in Choose mode.
    chooseDown.current = chooser?.choose && !readOnly && !onPoint && !placing && !(calib && calib.length < 2) ? { at, shift: e.shiftKey, word: wordUnder(at), dragged: false } : null;
    // A press on a word selects by dragging across words (owner, 30 Sep: M2); anywhere else still pans.
    if (chooseDown.current?.word && !e.shiftKey) { lastPress.current = null; host.current!.setPointerCapture(e.pointerId); return; }
    if (calib && calib.length < 2) {                         // calibrating: a click marks the ruler (a drag after it still pans)
      const q = toImage(view, o, dims, at);
      if (insideImage(q, dims)) { lastPress.current = null; onCalibrationClick(q); return; }
    }
    const id = pointHit;
    host.current!.setPointerCapture(e.pointerId);
    if (id && !readOnly && !calib) {                         // spec 2026-10-19: ⌘-click picks (V6), a double press accepts in place (V5)
      const press = pressOnPoint(id, at, e.timeStamp, isMod(e), lastPress.current); lastPress.current = press.last;
      if (press.act === 'pick') dispatch({ type: 'togglePick', id });
      else if (press.act === 'accept') dispatch({ type: 'acceptMany', ids: [id], kind: 'double-click' });
      else { drag.current = { id, anchor: { img: { x: state.points[id].x, y: state.points[id].y }, screen: at, precise: e.altKey }, started: false }; dispatch({ type: 'select', id }); }   // V5: the drag begins only past DOUBLE_PX
    }
    else if (placing && !chooseDown.current && insideImage(toImage(view, o, dims, at), dims)) dispatch({ type: 'place', id: placing, pos: toImage(view, o, dims, at) });
    else if (e.altKey && !readOnly) { rot.current = { last: at, deg: o.rotDeg }; dispatch({ type: 'beginRotate' }); }   // ⌥-drag on the film rotates
    else { if (state.picked.length && !isMod(e)) dispatch({ type: 'unpick' }); lastPress.current = null; pan.current = { x: at.x, y: at.y, v: view }; }   // a plain click on the film clears the picks
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (e.buttons === 0 && (drag.current || pan.current || rot.current || fitDrag.current || rulerDrag.current)) { onPointerUp(); return; }   // released outside: never a stuck drag
    if (!view) return; const at = local(e);
    if (fitDrag.current && fitInput) {
      const q = toImage(view, o, dims, at), g = fitDrag.current, p = fitInput.pivot;
      if (g.turn) fitAcc.current.rad += wrap(Math.atan2(q.y - p.y, q.x - p.x) - Math.atan2(g.last.y - p.y, g.last.x - p.x));
      else { fitAcc.current.dx += q.x - g.last.x; fitAcc.current.dy += q.y - g.last.y; }
      g.last = q; fitFlush.push(0);
      return;
    }
    if (calibDrag.current !== null) {
      const q = toImage(view, o, dims, at);
      markMoves.push({ i: calibDrag.current, p: { x: Math.min(dims.W - 0.5, Math.max(-0.5, q.x)), y: Math.min(dims.H - 0.5, Math.max(-0.5, q.y)) } });
      return;
    }
    if (rulerDrag.current) {
      // Fix round 1, I1: the same anchor-relative step and ⌥ precision as a point drag (`dragStep`), not an
      // absolute cursor position — a tiny jitter during the grab must not change the scale.
      const g = rulerDrag.current;
      if (!g.started) { if (Math.hypot(at.x - g.anchor.screen.x, at.y - g.anchor.screen.y) <= DOUBLE_PX) return; g.started = true; }
      const step = dragStep(o, view.k, g.anchor, at, e.altKey);
      g.anchor = step.anchor; const pos = step.pos;
      rulerMoves.push({ i: g.i, p: { x: Math.min(dims.W - 0.5, Math.max(-0.5, pos.x)), y: Math.min(dims.H - 0.5, Math.max(-0.5, pos.y)) } });
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
      const g = drag.current;
      if (!g.started) { if (Math.hypot(at.x - g.anchor.screen.x, at.y - g.anchor.screen.y) <= DOUBLE_PX) return; g.started = true; lastPress.current = null; dispatch({ type: 'beginDrag', id: g.id }); }   // a real drag is never half of a double press
      const step = dragStep(o, view.k, g.anchor, at, e.altKey);
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
    if (fitDrag.current) { fitFlush.flush(); fitDrag.current = null; }
    if (rulerDrag.current) { const g = rulerDrag.current; rulerMoves.flush(); rulerDrag.current = null; if (g.started) onRulerEnd?.(); }   // fix round 1, I1: below DOUBLE_PX, nothing to drop
    if (calibDrag.current !== null) { markMoves.flush(); calibDrag.current = null; }
    if (drag.current) { const began = drag.current.started; moves.flush(); drag.current = null; if (began) dispatch({ type: 'endDrag' }); }
    if (rot.current) { turns.flush(); rot.current = null; dispatch({ type: 'endRotate' }); }
    pan.current = null;
  };
  // Trackpad pinch: WebKit sends gesturestart/gesturechange (with a cumulative `scale`); Chromium and WebView2 send ctrl+wheel.
  // Spec 2026-10-19 addendum (G): every wheel event zooms (a mouse wheel, a two-finger swipe, a ctrl+wheel pinch), as the
  // WebKit pinch does, about the pointer, or the view centre when the pointer is off the image. The listener is
  // non-passive, so the page itself never scrolls or zooms. Panning is a drag on an empty spot, or Space-drag.
  const anchorAt = (at: Vec2): Vec2 => { const v = viewNow.current; return zoomAnchor(at, !!v && insideImage(toImage(v, o, dims, at), dims), size); };
  const live = useRef({ clamp, local, anchorAt, hasFilm: !!bitmap }); live.current = { clamp, local, anchorAt, hasFilm: !!bitmap };
  const pinch = useRef<number | null>(null);
  useEffect(() => {
    const el = host.current!;
    const start = (e: Event) => { e.preventDefault(); pinch.current = (e as unknown as { scale: number }).scale || 1; };
    const change = (e: Event) => {
      e.preventDefault(); const g = e as unknown as { scale: number; clientX: number; clientY: number };
      const { clamp: c, local: l, anchorAt: a } = live.current, v = viewNow.current;
      if (!v || pinch.current === null || !g.scale) return;
      c(zoomAt(v, a(l(g)), g.scale / pinch.current)); pinch.current = g.scale;
    };
    const end = (e: Event) => { e.preventDefault(); pinch.current = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const { clamp: c, local: l, anchorAt: a, hasFilm } = live.current, v = viewNow.current;
      if (!v || !hasFilm || pinch.current !== null || !e.deltaY) return;   // during a WebKit pinch, ignore any ctrl+wheel echo
      c(zoomAt(v, a(l(e)), wheelFactor(e.deltaY, e.deltaMode, el.clientHeight)));
    };
    el.addEventListener('gesturestart', start); el.addEventListener('gesturechange', change); el.addEventListener('gestureend', end);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => { el.removeEventListener('gesturestart', start); el.removeEventListener('gesturechange', change); el.removeEventListener('gestureend', end); el.removeEventListener('wheel', wheel); };
  }, []);

  return (
    <div className="stage" ref={host} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={(e) => { chooseClick(e); onPointerUp(); }}
         onPointerCancel={onPointerUp} onLostPointerCapture={onPointerUp}
         onPointerEnter={() => { over.current = true; }} onPointerLeave={() => { over.current = false; }}
         style={{ cursor: spaceDown ? 'grab' : fitInput ? (fitInput.picking ? 'crosshair' : 'move') : drag.current ? 'grabbing' : placing || (calib && calib.length < 2) ? 'crosshair' : chooser?.choose ? 'pointer' : 'default', touchAction: 'none' }}>
      <canvas ref={canvas} style={{ filter: filmFilter(state.display, state.overlays.background) }} />   {/* display-only: the model reads the stored file */}
      {view && bitmap && <Overlay state={state} dims={dims} registry={registry} S={S} mmPerPx={mmPerPx} assumedScale={assumedScale} calib={calib} compare={compare} own={own} ghosts={ghosts} caseId={caseId} decimals={decimals} fitMarks={fitMarks} ruler={marks} checks={checks} />}
      {!bitmap && <div className="empty">Drag a cephalogram onto the window, or press ⌘O</div>}
      {calib && calib.length < 2 && <div className="place-hint">Click the {calib.length ? 'second' : 'first'} ruler mark. Zoom in for accuracy · Esc cancels</div>}
      {view && bitmap && chooser?.choose && !readOnly && <ChooseLayer api={chooser} dims={dims} S={S} />}
      {chooser?.choose && !readOnly && !placing && chooser.hint && <div className="place-hint">{chooser.hint}</div>}
      {fitInput && <div className="place-hint">{fitInput.hint}</div>}
      {placing && <div className="place-hint">Click the film to place {placing}. Esc cancels.</div>}
      {bars && <ModelBars bars={bars} />}
      {aiLineShown(state.points, signedOff) && <div className="banner">{AI_LINE}</div>}
      {!!filmChecks?.length && <PointCheckNote flags={filmChecks} canCheck={canCheck && !readOnly && !!onFilmChecked} onChecked={(ids) => onFilmChecked?.(ids)} />}
      {aiLineShown(state.points, signedOff) && !!checkLines?.length && <div className="check-line">{checkLines.map((l) => <div key={l}>{l}</div>)}</div>}
    </div>
  );
}
