import { useEffect, useMemo, useRef, useState } from 'react';
import { GRID_STYLE } from './gridStyle';
import type { Expr, NodeId, Vec2 } from '@ceph/geometry';
import type { PointCheckFlag, RulerMarks } from '../ipc';
import type { TracingState } from '../tracing/state';
import { aiPointColour } from '../confidence';
import { mmGrid, planeSegments, profilogramPaths } from './overlayGeometry';
import { softDash } from '../compare/series';
import type { Dims } from './orientation';
import { ghostLabel, type Ghost } from '../ghosts/ghosts';
import { LANDMARKS, type LandmarkId } from '@ceph/analyses';
import { DEFAULT_DECIMALS, type Decimals } from '../format';
import { CHECK_WORDS, cardPlace, hoverText } from '../points/pointCheck';

interface Props {
  state: TracingState; dims: Dims; registry: Record<NodeId, Expr>; S: (p: Vec2) => Vec2; mmPerPx: number; calib: Vec2[] | null;
  /** Owner, 6 Oct, item S: whether `mmPerPx` is the ASSUMED default (no ruler calibration), passed to `ghostLabel`. */
  assumedScale: boolean;
  /** Owner DEC-1: decimals shown in the ghost hover label, the operator's setting (App.tsx reads it). Display only. */
  decimals?: Decimals;
  /** Serial superimposition (spec 2026-09-30): the patient's other films, aligned into this film's pixels, each in its look. */
  compare?: CompareTracing[] | null;
  /** The open film's ABO look on the Superimposition page: its profilogram and marks take that colour. */
  own?: Look | null;
  /** The other installed models' newest points on this film (spec 2026-10-01 Part 3): hollow and filled diamonds. */
  ghosts?: Ghost[] | null;
  /** The open case's id (owner, 5 Oct, M5): clears a hovered ghost's label when the case changes under it — the
   *  Overlay instance itself is not remounted on a case switch, so without this a stale label (and its line to a
   *  point that no longer means the same thing) could keep showing into the new case. */
  caseId?: string | null;
  /** Request G (Task 8): the points picked for a two-point fit, in this film's px. */
  fitMarks?: Vec2[];
  /** Spec 2026-10-19 (F): the ruler marks left on the film, drawn above the tracing as red crosses. */
  ruler?: RulerMarks | null;
  /** Stage A (task 6): the point check's flag at each pin, by landmark id (App: `flagAt`, the placing model's run). A flag
   *  draws a mark beside its pin and, on hover, a ring and words. It never moves, hides or recolours the pin. */
  checks?: Record<string, PointCheckFlag> | null;
  /** The pin whose flag starts hovered. For the static render in tests only; the app leaves it unset. */
  checkHoverStart?: string | null;
}
export interface Look { colour: string; dash?: string }
export interface CompareTracing extends Look { id: string; points: Record<string, Vec2> }
const d = (pts: Vec2[], close = false) => (pts.length < 2 ? '' : 'M' + pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join('L') + (close ? 'Z' : ''));

/** A hovered ghost point: which model, which landmark id. */
interface HoverKey { modelId: string; id: string }
const sameKey = (a: HoverKey | null, b: HoverKey) => !!a && a.modelId === b.modelId && a.id === b.id;

/** Everything drawn over the film, in screen space so strokes stay crisp at any zoom (§2). */
export function Overlay({ state, dims, registry, S, mmPerPx, assumedScale, calib, compare, own, ghosts, caseId, decimals = DEFAULT_DECIMALS, fitMarks, ruler, checks, checkHoverStart = null }: Props) {
  const pos = Object.fromEntries(Object.entries(state.points).map(([id, p]) => [id, { x: p.x, y: p.y }]));
  // Owner, 5 Oct, Task C: the on-canvas hover label replaces the SVG `<title>` tooltip. `hover` shows it at full
  // opacity immediately (no system tooltip delay); leaving sets `fading` so the label stays mounted for the ~0.5 s
  // CSS fade instead of vanishing, then both clear once the timer fires (unless re-entered first, which cancels it).
  const [hover, setHover] = useState<HoverKey | null>(null);
  const [fading, setFading] = useState<HoverKey | null>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (fadeTimer.current) clearTimeout(fadeTimer.current); }, []);
  // M5 (owner, 5 Oct): the case changing under a hovered label (Overlay itself is not remounted on a case switch).
  useEffect(() => {
    setHover(null); setFading(null);
    if (fadeTimer.current) { clearTimeout(fadeTimer.current); fadeTimer.current = null; }
  }, [caseId]);
  // M5: the hovered ghost itself unmounting — its model's run disappeared (e.g. a re-detect, or the model hidden).
  useEffect(() => {
    const stillThere = (k: HoverKey | null) => !!k && !!ghosts?.some((g) => g.modelId === k.modelId && k.id in g.points);
    setHover((h) => (h && !stillThere(h) ? null : h));
    setFading((f) => (f && !stillThere(f) ? null : f));
  }, [ghosts]);   // eslint-disable-line react-hooks/exhaustive-deps
  // M5: the label stays inside the stage near the right edge, flipping to the diamond's left instead of running off.
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [stageW, setStageW] = useState(Infinity), [stageH, setStageH] = useState(Infinity);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => { setStageW(el.clientWidth); setStageH(el.clientHeight); });
    setStageW(el.clientWidth); setStageH(el.clientHeight);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // L (owner, 6 Oct): the label's own MEASURED width (a fixed guess was either too wide, wasting room a short label
  // didn't need, or too narrow for a long one), read from the rendered DOM node each time it changes.
  const [labelW, setLabelW] = useState(0);
  const enterGhost = (key: HoverKey) => {
    if (fadeTimer.current) { clearTimeout(fadeTimer.current); fadeTimer.current = null; }
    setFading(null);
    setHover(key);
  };
  const leaveGhost = (key: HoverKey) => {
    setHover((h) => (sameKey(h, key) ? null : h));
    setFading(key);
    fadeTimer.current = setTimeout(() => setFading((f) => (sameKey(f, key) ? null : f)), 500);
  };
  // Stage A: the pin whose point-check mark is hovered (its ring and words show), cleared when the case changes under it.
  const [checkHover, setCheckHover] = useState<string | null>(checkHoverStart);
  useEffect(() => { setCheckHover(null); }, [caseId]);
  const activeHover = hover ?? fading;
  const hoverGhost = activeHover && ghosts?.find((g) => g.modelId === activeHover.modelId);
  const hoverPoint = hoverGhost && activeHover ? hoverGhost.points[activeHover.id] : null;
  /** (A function, not a component: a component defined here would remount on every hover and lose the pointer.)
   *  The mark beside a flagged pin, 12 px right of the pin's label (hit area for the hover). Words are the owner's. */
  const checkMark = (id: string, s: Vec2) => {
    const x = s.x + 10 + id.length * 8 + 12, y = s.y - 10;
    return (
      <g key={`check-${id}`} className="check-mark" data-check="flagged" data-id={id}
         onMouseEnter={() => setCheckHover(id)} onMouseLeave={() => setCheckHover((h) => (h === id ? null : h))}>
        <rect className="check-hit" x={x - 4} y={y - 14} width={CHECK_WORDS.mark.length * 6.4 + 8} height={20} />
        <text className="check-mark-text" x={x} y={y} fill="var(--warn)">{CHECK_WORDS.mark}</text>
      </g>
    );
  };
  const paper = state.overlays.background === 'grid', Po = pos.Po, Or = pos.Or;
  const grid = useMemo(() => (paper && Po && Or ? mmGrid(Po, Or, mmPerPx, dims) : null), [paper, Po?.x, Po?.y, Or?.x, Or?.y, mmPerPx, dims]);   // eslint-disable-line react-hooks/exhaustive-deps
  const segs = (list: { a: Vec2; b: Vec2 }[]) => list.map((s) => `M${S(s.a).x.toFixed(1)} ${S(s.a).y.toFixed(1)}L${S(s.b).x.toFixed(1)} ${S(s.b).y.toFixed(1)}`).join('');
  const prof = state.overlays.profilogram ? profilogramPaths(pos) : null;
  return (
    <svg ref={svgRef} className="overlay" aria-hidden="true">
      {grid && <g fill="none">
        <path d={segs(grid.minor)} stroke={`var(--${GRID_STYLE.minor.token})`} strokeWidth={GRID_STYLE.minor.px} strokeOpacity={GRID_STYLE.minor.opacity} />
        <path d={segs(grid.mid)} stroke={`var(--${GRID_STYLE.mid.token})`} strokeWidth={GRID_STYLE.mid.px} strokeOpacity={GRID_STYLE.mid.opacity} />
        <path d={segs(grid.major)} stroke={`var(--${GRID_STYLE.major.token})`} strokeWidth={GRID_STYLE.major.px} strokeOpacity={GRID_STYLE.major.opacity} />
        <path d={segs(grid.axes)} stroke={`var(--${GRID_STYLE.axis.token})`} strokeWidth={GRID_STYLE.axis.px} strokeOpacity={GRID_STYLE.axis.opacity} />
      </g>}
      {calib && calib.length > 0 && <g stroke="var(--calibrate)" fill="none" strokeWidth={1.6}>
        {calib.length === 2 && <line x1={S(calib[0]).x} y1={S(calib[0]).y} x2={S(calib[1]).x} y2={S(calib[1]).y} strokeDasharray="4 3" />}
        {calib.map((p, i) => <circle key={i} cx={S(p).x} cy={S(p).y} r={6} />)}
      </g>}
      {fitMarks && fitMarks.length > 0 && <g stroke="var(--calibrate)" fill="none" strokeWidth={1.6}>
        {fitMarks.map((p, i) => <circle key={i} className="fit-mark-pt" cx={S(p).x} cy={S(p).y} r={6} />)}</g>}
      {prof && <g fill="none" strokeLinejoin="round">
        <path d={d(prof.hard.map(S), true)} stroke={own?.colour ?? 'var(--profile)'} strokeWidth={1.6} strokeDasharray={own?.dash} fill={own?.colour ?? 'var(--profile)'} fillOpacity={0.05} />
        <path d={d(prof.palatal.map(S))} stroke={own?.colour ?? 'var(--profile)'} strokeWidth={1.2} strokeDasharray={own?.dash} />
        <path d={d(prof.soft.map(S))} stroke={own?.colour ?? 'var(--profile-soft)'} strokeWidth={1.3} strokeDasharray={softDash(own?.dash)} />
      </g>}
      {/* Owner, Nov 2026: selected lines (FH, SN...) are painted AFTER the profilogram so they sit on top of it. */}
      {planeSegments(registry, pos, state.overlays.planes).map((p) => (
        <line key={p.key} x1={S(p.a).x} y1={S(p.a).y} x2={S(p.b).x} y2={S(p.b).y} stroke={p.colour}
          strokeWidth={p.weight === 'major' ? 1.6 : 1.1} strokeDasharray={p.dash} />
      ))}
      {compare?.map((t) => {
        const cp = profilogramPaths(t.points);
        return (
          <g key={t.id} className="compare" data-film={t.id} fill="none" stroke={t.colour} strokeLinejoin="round">
            <path d={d(cp.hard.map(S), true)} strokeWidth={1.4} strokeDasharray={t.dash} />
            <path d={d(cp.palatal.map(S))} strokeWidth={1.1} strokeDasharray={t.dash} />
            <path d={d(cp.soft.map(S))} strokeWidth={1.2} strokeDasharray={softDash(t.dash)} />
            {Object.entries(t.points).map(([id, p]) => { const s = S(p);
              return <path key={id} d={`M${s.x - 4} ${s.y}H${s.x + 4}M${s.x} ${s.y - 4}V${s.y + 4}`} strokeWidth={1.4} />; })}
          </g>);
      })}
      {ghosts?.map((g) => (
        <g key={g.modelId} className={`ghost ghost-${g.shade}`} data-model={g.modelId}>
          {Object.entries(g.points).map(([id, p]) => { const s = S(p), r = 4.5;
            return (
              <g key={id} className="ghost-pt" data-id={id}
                 onMouseEnter={() => enterGhost({ modelId: g.modelId, id })}
                 onMouseLeave={() => leaveGhost({ modelId: g.modelId, id })}>
                {/* Owner, 5 Oct, Task C: a hit area well bigger than the 1.3 px outline (about 10 screen px radius),
                   with a normal cursor — the diamond itself no longer reacts to the pointer (tokens.css). */}
                <circle className="ghost-hit" cx={s.x} cy={s.y} r={10} />
                <path data-id={id} d={`M${s.x} ${s.y - r}L${s.x + r} ${s.y}L${s.x} ${s.y + r}L${s.x - r} ${s.y}Z`}
                  stroke={`var(--ghost-${g.shade})`} strokeWidth={1.3} fill={g.shade === 2 ? `var(--ghost-${g.shade})` : 'none'} fillOpacity={0.35} />
              </g>); })}
        </g>))}
      {Object.entries(state.points).map(([id, p]) => {
        const s = S(p), active = state.active === id, r = active ? 9 : 7, col = own?.colour ?? (p.verified ? 'var(--mark-verified)' : aiPointColour());
        return (
          <g key={id} className="landmark" data-id={id}>
            {p.verified
              ? <rect x={s.x - r + 1} y={s.y - r + 1} width={2 * r - 2} height={2 * r - 2} fill={col} stroke="var(--on-fill)" strokeWidth={1.5} />
              : <circle cx={s.x} cy={s.y} r={r} fill="none" stroke={col} strokeWidth={2} />}
            {active && <circle cx={s.x} cy={s.y} r={r + 4} fill="none" stroke="var(--on-fill)" strokeWidth={1.5} />}
            {state.picked.includes(id) && <circle className="picked" cx={s.x} cy={s.y} r={r + 7} fill="none" stroke="var(--link)" strokeWidth={1.5} strokeDasharray="3 2" />}
            <text x={s.x + 10} y={s.y - 10} fill={col} className={paper ? 'label paper' : 'label'}>{id}</text>
            {checks?.[id] && checkMark(id, s)}
          </g>
        );
      })}
      {ruler && <g className="ruler-marks" stroke="var(--calibrate)" strokeWidth={2} fill="none">
        {[ruler.p1, ruler.p2].map((m, i) => { const s = S(m);
          return <path key={i} className="ruler-mark" data-i={i} d={`M${s.x - 7} ${s.y}H${s.x + 7}M${s.x} ${s.y - 7}V${s.y + 7}`} />; })}
      </g>}
      {checkHover && checks?.[checkHover] && state.points[checkHover] && (() => {
        const f = checks[checkHover], p = state.points[checkHover], s = S(p);
        // The ring is the stored ellipse (film px) taken through S: its centre, radii and turn follow the film's zoom,
        // mirror and rotation. Screen turn = the major axis's direction after S, kept in (-90, 90].
        const c = f.ring ?? (f.expectedX != null && f.expectedY != null ? { cx: f.expectedX, cy: f.expectedY, rx: 0, ry: 0, angleDeg: 0 } : null);
        if (!c) return null;
        const o = S({ x: c.cx, y: c.cy }), a = (c.angleDeg * Math.PI) / 180;
        const u = S({ x: c.cx + Math.cos(a), y: c.cy + Math.sin(a) });
        const k = Math.hypot(S({ x: c.cx + 1, y: c.cy }).x - o.x, S({ x: c.cx + 1, y: c.cy }).y - o.y);
        let turn = (Math.atan2(u.y - o.y, u.x - o.x) * 180) / Math.PI;
        if (turn > 90) turn -= 180; else if (turn <= -90) turn += 180;
        turn = Math.round(turn * 1e4) / 1e4;
        // The words use the mark as stored: the model's own point when the pin has been moved since (the flag is about its mark).
        const at = p.ai ?? p;
        const text = hoverText(f, mmPerPx, assumedScale, at, state.orientation.mirror);
        const w = 360, h = 90, { x, y: cardY } = cardPlace(s.x, s.y, w, h, stageW, stageH);   // inside the stage on every edge
        return (
          <g className="check-hover" data-id={checkHover}>
            {f.ring && <ellipse className="check-ring" cx={o.x} cy={o.y} rx={c.rx * k} ry={c.ry * k} transform={`rotate(${turn} ${o.x} ${o.y})`}
              fill="none" stroke="var(--warn)" strokeWidth={1.6} strokeDasharray="5 3" />}
            <foreignObject x={x} y={cardY} width={w} height={h} style={{ overflow: 'visible' }}>
              <div className="ghost-hover-label check-hover-label" style={{ whiteSpace: 'normal', maxWidth: w }}>{text}</div>
            </foreignObject>
          </g>
        );
      })()}
      {activeHover && hoverGhost && hoverPoint && (() => {
        const s = S(hoverPoint), placed = state.points[activeHover.id];
        const name = LANDMARKS[activeHover.id as LandmarkId]?.name;
        const text = ghostLabel(hoverGhost.titles?.[activeHover.id] ?? hoverGhost.title, hoverPoint, placed, mmPerPx, activeHover.id, name, assumedScale, decimals);
        const lineColour = `var(--ghost-${hoverGhost.shade})`;
        // L: flip to the left when the MEASURED width would run off the stage's right edge, then clamp to BOTH
        // edges — a flip alone is not enough near the left edge, where flipping left would run off there instead.
        const w = labelW || 160;   // a reasonable guess before the first paint has measured the real width
        const flip = s.x + 10 + w > stageW;
        const x = Math.max(0, Math.min(flip ? s.x - 10 - w : s.x + 10, stageW - w));
        return (
          <g className="ghost-hover" data-model={hoverGhost.modelId} data-id={activeHover.id} data-flip={flip || undefined}>
            {placed && <line x1={s.x} y1={s.y} x2={S(placed).x} y2={S(placed).y} stroke={lineColour} strokeWidth={1} strokeDasharray="2 2" />}
            <foreignObject x={x} y={s.y - 16} width={w} height={40} style={{ overflow: 'visible' }}>
              <div ref={(el) => { if (el && el.offsetWidth && el.offsetWidth !== labelW) setLabelW(el.offsetWidth); }}
                className={hover ? 'ghost-hover-label' : 'ghost-hover-label fading'}>{text}</div>
            </foreignObject>
          </g>
        );
      })()}
    </svg>
  );
}
