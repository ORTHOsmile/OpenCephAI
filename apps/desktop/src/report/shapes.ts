import type { Expr, NodeId, Vec2 } from '@ceph/geometry';
import { GRID_STYLE, MM_PER_PX } from '../canvas/gridStyle';
import { tickLabels, xOf } from '../chart/polygon';
import { mmGrid, planeSegments, profilogramPaths } from '../canvas/overlayGeometry';
import { displayBounds, displayOf, type Dims, type Orientation } from '../canvas/orientation';
import { softDash } from '../compare/series';
import type { Overlays, TracingPoint } from '../tracing/state';
import { isAssumed, type Scale } from '../tracing/spacing';
import type { Decimals } from '../format';
import type { ChartRow } from './model';
import { mix, PRINT, tokenColour } from './colours';

/** The report's drawings as plain shapes in page millimetres (text size in points), drawn as SVG in the preview and
 *  straight into the PDF — so the preview is the printed page (spec 2026-10-17 report-exports). */
export type Shape =
  | { t: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number; dash?: number[]; role?: string }
  | { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string; stroke?: string; width?: number; role?: string }
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: string; stroke?: string; width?: number; role?: string }
  | { t: 'poly'; pts: [number, number][]; stroke: string; width: number; closed?: boolean; dash?: number[]; fill?: string; role?: string }
  | { t: 'text'; x: number; y: number; s: string; size: number; fill: string; anchor?: 'start' | 'middle' | 'end'; role?: string };
export interface Box { x: number; y: number; w: number; h: number }
/** page = (x0 + k·displayX, y0 + k·displayY); `img` is where the oriented film lands on the page. */
export interface Fit { k: number; x0: number; y0: number; img: Box }

// Fix round (ruling, 29 Oct 2026): a printed report must never quietly drop a row from the chart.
// `rowH` is the normal (and maximum) row pitch; `minRowH` is the smallest pitch the fixed-size marks drawn
// inside a row (the ±1 SD mean line, `mid ± 1.6` mm tall, centred at `mid = top + rowH/2 + 1`) can use before
// one row's marks start to reach into the next row's slot — solved from `mid + 1.6 <= rowH` (the tightest
// constraint; the tick-label text above `mid` clears the row above it well before this does), which gives
// `rowH >= 5.2`, plus a small 0.3 mm clearance margin for rounding: 5.5 mm. Below that floor the chart does not
// shrink further — it continues onto another page instead (`layoutChart`).
export const CHART = { rowH: 6, minRowH: 5.5, labelW: 22, pad: 2 };

/** review Minor 7: the label column is only `CHART.labelW` mm wide. An approved abbreviation (≤ 9 characters) always
 *  fits, but `report/model.ts`'s fallback to the full measurement label (no approved abbreviation, e.g. a "My
 *  analysis" row) does not — the screen truncates with an ellipsis (`tokens.css` `.measures.chart .abbr`) and so
 *  does the print chart. No real font metrics are available at this layer (jsPDF is Task 7), so this is a
 *  deliberately conservative average glyph width for a sans-serif font, not an exact measurement. */
const LABEL_CHAR_W = 0.6;
const fitLabel = (s: string, widthMm: number, sizePt: number): string => {
  const max = Math.max(1, Math.floor(widthMm / (sizePt * 0.3528 * LABEL_CHAR_W)));
  return s.length <= max ? s : s.slice(0, Math.max(1, max - 1)) + '…';
};

/** CHART-TAB-1 for print: per row a grey scale line in SD units (±3 SD across), the light-green ±1 SD band and green
 *  mean, grey ticks at the mean and ±2 SD in the row's own units, and the black patient dot; the dots joined by one
 *  black line (one block = one analysis). A row with no z: grey line only. Beyond ±3 SD: at the edge, with an arrow. */
export function chartShapes(rows: ChartRow[], at: { x: number; y: number; w: number }, decimals: Decimals, rowH: number = CHART.rowH): { shapes: Shape[]; h: number } {
  const px = at.x + CHART.labelW, pw = at.w - CHART.labelW - CHART.pad, band = mix(PRINT.ok, '#ffffff', 0.18);
  const shapes: Shape[] = [], dots: [number, number][] = [], offs: Shape[] = [];
  rows.forEach((r, i) => {
    const top = at.y + i * rowH, mid = top + rowH / 2 + 1, X = (z: number) => px + xOf(z, pw).x;
    shapes.push({ t: 'text', x: at.x, y: mid + 1, s: fitLabel(r.abbr, CHART.labelW - 1, 7), size: 7, fill: PRINT.text, role: 'label' });
    shapes.push({ t: 'line', x1: px, y1: mid, x2: px + pw, y2: mid, stroke: PRINT.grey, width: 0.2, role: 'scale' });
    if (r.z === null || r.mean === null || r.sd === null) return;
    shapes.push({ t: 'rect', x: X(-1), y: mid - 1.2, w: X(1) - X(-1), h: 2.4, fill: band, role: 'band' });
    shapes.push({ t: 'line', x1: X(0), y1: mid - 1.6, x2: X(0), y2: mid + 1.6, stroke: PRINT.ok, width: 0.35, role: 'mean' });
    tickLabels(r.mean, r.sd, r.unit, decimals).forEach((s, j) =>
      shapes.push({ t: 'text', x: X((j - 1) * 2), y: top + 1.6, s, size: 5, fill: PRINT.grey, anchor: 'middle', role: 'tick' }));
    const { x, off } = xOf(r.z, pw), cx = px + x;
    dots.push([cx, mid]);
    if (off) offs.push({ t: 'poly', pts: [[cx - 1.5 * off, mid - 1], [cx, mid], [cx - 1.5 * off, mid + 1]], stroke: PRINT.text, width: 0.3, role: 'off' });
  });
  if (dots.length > 1) shapes.push({ t: 'poly', pts: dots, stroke: PRINT.text, width: 0.35, role: 'patient' });
  dots.forEach(([cx, cy]) => shapes.push({ t: 'circle', cx, cy, r: 0.6, fill: PRINT.text, role: 'dot' }));
  return { shapes: [...shapes, ...offs], h: rows.length * rowH + 2 };
}

/** One page's worth of the chart: its own rows, the row pitch to draw them at, and whether this is a
 *  continuation of an earlier page (for the "Measurement chart, continued" heading). */
export interface ChartPage { rows: ChartRow[]; rowH: number; continued: boolean }

/** Fix round (ruling, 29 Oct 2026): lay out EVERY row across as many pages as it takes — never
 *  drop one. Page 1 (or any page) first tries the normal pitch (`CHART.rowH`); if every row does not fit at
 *  that pitch, the pitch shrinks (never below `CHART.minRowH`, the smallest pitch the fixed-size marks drawn
 *  inside a row can use without reaching into the next one); only once even the floor cannot fit every
 *  remaining row does the chart continue onto a further page, at the floor pitch, as many pages as it takes.
 *  `firstBoxH` is the first page's own box height (beside the film); `laterBoxH` is every continuation page's
 *  (a plain, full-width page, `page.ts` `chartContinuationBox`). Pure and side-effect free, so `pdf.ts` and
 *  `ReportPreview.tsx` call this ONE function and can never lay the chart out two different ways. */
export function layoutChart(rows: ChartRow[], firstBoxH: number, laterBoxH: number): ChartPage[] {
  if (!rows.length) return [];
  const pages: ChartPage[] = [];
  let rest = rows, first = true;
  while (rest.length) {
    const boxH = first ? firstBoxH : laterBoxH;
    const fitsAtIdeal = Math.floor(boxH / CHART.rowH);
    if (rest.length <= fitsAtIdeal) { pages.push({ rows: rest, rowH: CHART.rowH, continued: !first }); break; }
    const shrunk = boxH / rest.length;
    if (shrunk >= CHART.minRowH) { pages.push({ rows: rest, rowH: shrunk, continued: !first }); break; }
    const perPage = Math.max(1, Math.floor(boxH / CHART.minRowH));
    pages.push({ rows: rest.slice(0, perPage), rowH: CHART.minRowH, continued: !first });
    rest = rest.slice(perPage);
    first = false;
  }
  return pages;
}

/** The oriented film (levelled, mirrored as on screen) fitted into `box`, keeping its shape, centred. */
export function figureFit(o: Orientation, dims: Dims, box: Box): Fit {
  const b = displayBounds(o, dims), w = b.x1 - b.x0, h = b.y1 - b.y0, k = Math.min(box.w / w, box.h / h);
  const img = { x: box.x + (box.w - w * k) / 2, y: box.y + (box.h - h * k) / 2, w: w * k, h: h * k };
  return { k, x0: img.x - b.x0 * k, y0: img.y - b.y0 * k, img };
}

/** The planes the operator has switched on, as print lines (colours, weights and dashes shared by the film page and
 *  the profilogram page). `P` maps a film point to page mm. */
function planeShapes(pos: Record<string, Vec2>, registry: Record<NodeId, Expr>, overlays: Overlays, P: (p: Vec2) => Vec2): Shape[] {
  const out: Shape[] = [];
  for (const s of planeSegments(registry, pos, overlays.planes)) {
    const a = P(s.a), b = P(s.b);
    out.push({ t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: tokenColour(s.colour), width: s.weight === 'major' ? 0.35 : 0.25,
      dash: s.dash ? s.dash.split(' ').map((n) => Number(n) * 0.25) : undefined, role: 'plane' });
  }
  return out;
}

/** The screen's marks on the page: planes switched on (their colours and dashes), verified points as filled
 *  squares and AI points as open circles, each with its id. Owner ruling (29 Oct 2026, items 1-2): the profilogram
 *  is NEVER drawn here, even when `overlays.profilogram` is on — it goes on its own page, or not at all, under
 *  the report's own "Profilogram page" tick-box (see `profilogramShapes` below, and pdf.ts/ReportPreview.tsx).
 *  Everything else matches exactly what the operator has switched on in the app. */
export function tracingShapes(points: Record<string, TracingPoint>, registry: Record<NodeId, Expr>, overlays: Overlays, o: Orientation, dims: Dims, fit: Fit): Shape[] {
  const P = (p: Vec2) => { const q = displayOf(o, dims, p); return { x: fit.x0 + fit.k * q.x, y: fit.y0 + fit.k * q.y }; };
  const pos: Record<string, Vec2> = Object.fromEntries(Object.entries(points).map(([id, p]) => [id, { x: p.x, y: p.y }]));
  const out: Shape[] = planeShapes(pos, registry, overlays, P);
  for (const [id, p] of Object.entries(points)) {
    const s = P(p), col = p.verified ? PRINT.verified : PRINT.ai;
    out.push(p.verified
      ? { t: 'rect', x: s.x - 0.7, y: s.y - 0.7, w: 1.4, h: 1.4, fill: col, role: 'point' }
      : { t: 'circle', cx: s.x, cy: s.y, r: 0.8, stroke: col, width: 0.3, role: 'point' });
    out.push({ t: 'text', x: s.x + 1.2, y: s.y - 1, s: id, size: 5, fill: col, role: 'point-id' });
  }
  return out;
}

/** Liang-Barsky: the part of the segment a-b inside [x0,x1] x [y0,y1], or null when none of it is. */
function clipSegment(a: Vec2, b: Vec2, x0: number, y0: number, x1: number, y1: number): [Vec2, Vec2] | null {
  const dx = b.x - a.x, dy = b.y - a.y;
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, a.x - x0], [dx, x1 - a.x], [-dy, a.y - y0], [dy, y1 - a.y]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return t1 - t0 <= 0 ? null : [{ x: a.x + t0 * dx, y: a.y + t0 * dy }, { x: a.x + t1 * dx, y: a.y + t1 * dy }];
}

/** Owner, 5 Nov 2026: the screen's true-size millimetre grid (canvas/overlayGeometry.ts `mmGrid`: 1 mm lines, heavier
 *  every 5 mm and every 10 mm, the two axes through Po; lined up with Frankfort and anchored at Po) laid under the
 *  profilogram. One grid line is 1 mm of the PATIENT, so on the page a cell is `fit.k / mmPerPx` page mm — the page is
 *  not life size, and the note says so. Cut to the film's own outline (the grid is the film's paper), so it never
 *  runs into the margin. Colours, line weights and opacity are the screen's, from `canvas/gridStyle.ts` (the colour is the light value of the screen's `--grid-*` token). */
function gridShapes(pos: Record<string, Vec2>, mmPerPx: number, dims: Dims, fit: Fit, P: (p: Vec2) => Vec2): Shape[] {
  const Po = pos.Po, Or = pos.Or;
  const g = Po && Or ? mmGrid(Po, Or, mmPerPx, dims) : null;
  if (!g) return [];
  const out: Shape[] = [];
  const draw = (list: { a: Vec2; b: Vec2 }[], role: string, colour: string, width: number) => {
    for (const s of list) {
      const c = clipSegment(s.a, s.b, -0.5, -0.5, dims.W - 0.5, dims.H - 0.5);
      if (!c) continue;
      const a = P(c[0]), b = P(c[1]);
      out.push({ t: 'line', x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: tokenColour(colour), width, role });
    }
  };
  // The screen's own colours and line weights, from the one shared table (`canvas/gridStyle.ts`); 1 CSS px = 25.4/96 page mm.
  const S = GRID_STYLE;
  draw(g.minor, 'grid-minor', `var(--${S.minor.token})`, S.minor.px * MM_PER_PX);
  draw(g.mid, 'grid-mid', `var(--${S.mid.token})`, S.mid.px * MM_PER_PX);
  draw(g.major, 'grid-major', `var(--${S.major.token})`, S.major.px * MM_PER_PX);
  draw(g.axes, 'grid-axis', `var(--${S.axis.token})`, S.axis.px * MM_PER_PX);
  out.push({ t: 'text', x: fit.img.x, y: fit.img.y - 1.5, s: 'Grid: 1 mm, 5 mm and 10 mm lines in patient millimetres (this page is not life size)', size: 6, fill: PRINT.grey, role: 'grid-note' });
  return out;
}

/** The profilogram alone (review Minor 3/4's own marks, unchanged), for its OWN page (owner ruling, 29 Oct 2026,
 *  item 1): never drawn over the film. `fit` places it on whatever box the caller gives it — the same `figureFit`
 *  used for the film, but typically a full page box rather than the (now narrower) film box. `planes`, when given,
 *  adds the operator's selected planes AFTER the profile shapes (painted on top), as the film page draws them.
 *  `grid`, when given, lays the true-size mm grid BEFORE them (underneath); the caller passes it only for a
 *  calibrated film (profilogramPage.ts). */
export function profilogramShapes(points: Record<string, TracingPoint>, o: Orientation, dims: Dims, fit: Fit, planes?: { registry: Record<NodeId, Expr>; overlays: Overlays }, grid?: { mmPerPx: number } | null): Shape[] {
  const P = (p: Vec2) => { const q = displayOf(o, dims, p); return { x: fit.x0 + fit.k * q.x, y: fit.y0 + fit.k * q.y }; };
  const pos: Record<string, Vec2> = Object.fromEntries(Object.entries(points).map(([id, p]) => [id, { x: p.x, y: p.y }]));
  const pr = profilogramPaths(pos), pts = (l: Vec2[]) => l.map((p) => { const q = P(p); return [q.x, q.y] as [number, number]; });
  const out: Shape[] = [];
  // review Minor 4: Overlay.tsx:108 fills the hard profile at 5 % opacity; a solid print colour matches it.
  if (pr.hard.length > 1) out.push({ t: 'poly', pts: pts(pr.hard), stroke: PRINT.profile, width: 0.35, closed: true, fill: mix(PRINT.profile, '#ffffff', 0.05), role: 'profile' });
  if (pr.palatal.length > 1) out.push({ t: 'poly', pts: pts(pr.palatal), stroke: PRINT.profile, width: 0.3, role: 'profile' });
  // review Minor 3: the screen's softDash() (compare/series.ts), not a re-derived dash — same 0.25 factor the planes use.
  if (pr.soft.length > 1) out.push({ t: 'poly', pts: pts(pr.soft), stroke: PRINT.profileSoft, width: 0.3, dash: softDash().split(' ').map((v) => Number(v) * 0.25), role: 'profile' });
  // Owner (Nov 2026): the operator's selected lines (FH, SN...) sit ON TOP of the profilogram, so they are pushed last.
  // Only when there is a profile: a page with lines and no profilogram would not be a profilogram page.
  if (planes && out.length) out.push(...planeShapes(pos, planes.registry, planes.overlays, P));
  // Owner, 5 Nov 2026: the mm grid goes UNDER everything (first), and, like the planes, only on a page that has a profile.
  if (grid && out.length) return [...gridShapes(pos, grid.mmPerPx, dims, fit, P), ...out];
  return out;
}

/** 10 mm in the patient, at the film's scale (ruler-calibrated, or assumed and said so), bottom-left of the figure.
 *  White on the film, black on white paper. review Important 2: a levelled film's bottom-left corner of the
 *  bounding box usually lands outside the film itself (the oriented rectangle, not the page box); Task 7's
 *  `filmJpeg` fills that corner black, and Enhance's Invert can turn black into white there, so a plain white bar
 *  can land on a white corner. A solid black backing rect behind the bar and its label is robust to Invert, because
 *  Invert (`adjustPixels`/`filterOf`) only ever touches the film's own raster pixels, never this vector overlay. */
export function scaleBarShapes(fit: Fit, mmPerPx: number, assumed: boolean, onFilm: boolean): Shape[] {
  const len = (10 / mmPerPx) * fit.k, x = fit.img.x + 3, y = fit.img.y + fit.img.h - 4, col = onFilm ? '#ffffff' : PRINT.text;
  const label = assumed ? '10 mm (assumed scale)' : '10 mm';
  const out: Shape[] = [];
  if (onFilm) {
    const labelSize = 7, labelH = labelSize * 0.3528, labelW = label.length * labelH * 0.6, pad = 1;
    const w = Math.max(len, labelW) + 2 * pad, top = y - 1.6 - labelH - pad, bottom = y + 1 + pad;
    out.push({ t: 'rect', x: x - pad, y: top, w, h: bottom - top, fill: '#000000', role: 'bar-backing' });
  }
  out.push(
    { t: 'line', x1: x, y1: y, x2: x + len, y2: y, stroke: col, width: 0.5, role: 'bar' },
    { t: 'line', x1: x, y1: y - 1, x2: x, y2: y + 1, stroke: col, width: 0.3, role: 'bar-end' },
    { t: 'line', x1: x + len, y1: y - 1, x2: x + len, y2: y + 1, stroke: col, width: 0.3, role: 'bar-end' },
    { t: 'text', x, y: y - 1.6, s: label, size: 7, fill: col, role: 'bar-label' },
  );
  return out;
}

/** review Minor 5: one `scale`, not independent `mmPerPx`/`assumed` fields that could disagree — `assumed` is
 *  derived once, by the same `isAssumed` the screen uses (`assumedScale={isAssumed(scale)}` in App.tsx), so a fit to a
 *  film with no ruler (G3) reads "assumed" in the report as it does on the canvas (R3). */
export interface FigureInput { points: Record<string, TracingPoint>; registry: Record<NodeId, Expr>; overlays: Overlays; orientation: Orientation; dims: Dims; scale: Scale }
export function figure(f: FigureInput, box: Box, onFilm: boolean): { shapes: Shape[]; img: Box } {
  const fit = figureFit(f.orientation, f.dims, box), assumed = isAssumed(f.scale);
  return { shapes: [...tracingShapes(f.points, f.registry, f.overlays, f.orientation, f.dims, fit), ...scaleBarShapes(fit, f.scale.mmPerPx, assumed, onFilm)], img: fit.img };
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const n = (x: number) => String(+x.toFixed(3));
const dash = (d?: number[]) => (d && d.length ? ` stroke-dasharray="${d.map(n).join(' ')}"` : '');
const cls = (r?: string) => (r ? ` class="${r}"` : '');
const paint = (s: { fill?: string; stroke?: string; width?: number }) => ` fill="${s.fill ?? 'none'}"${s.stroke ? ` stroke="${s.stroke}" stroke-width="${n(s.width ?? 0.2)}"` : ''}`;

/** The shapes as an SVG in page millimetres (the preview). Text is escaped; 1 pt = 0.3528 mm. */
export function toSvg(shapes: Shape[], box: Box, image: ({ href: string } & Box) | null = null): string {
  const body = shapes.map((s) => {
    switch (s.t) {
      case 'line': return `<line${cls(s.role)} x1="${n(s.x1)}" y1="${n(s.y1)}" x2="${n(s.x2)}" y2="${n(s.y2)}" stroke="${s.stroke}" stroke-width="${n(s.width)}"${dash(s.dash)}/>`;
      case 'rect': return `<rect${cls(s.role)} x="${n(s.x)}" y="${n(s.y)}" width="${n(s.w)}" height="${n(s.h)}"${paint(s)}/>`;
      case 'circle': return `<circle${cls(s.role)} cx="${n(s.cx)}" cy="${n(s.cy)}" r="${n(s.r)}"${paint(s)}/>`;
      case 'poly': return `<${s.closed ? 'polygon' : 'polyline'}${cls(s.role)} points="${s.pts.map(([x, y]) => `${n(x)},${n(y)}`).join(' ')}" fill="${s.fill ?? 'none'}" stroke="${s.stroke}" stroke-width="${n(s.width)}"${dash(s.dash)}/>`;
      case 'text': return `<text${cls(s.role)} x="${n(s.x)}" y="${n(s.y)}" font-size="${n(s.size * 0.3528)}" font-family="Noto Sans, Helvetica, Arial, sans-serif" fill="${s.fill}"${s.anchor && s.anchor !== 'start' ? ` text-anchor="${s.anchor}"` : ''}>${esc(s.s)}</text>`;
    }
  }).join('');
  const img = image ? `<image href="${esc(image.href)}" x="${n(image.x)}" y="${n(image.y)}" width="${n(image.w)}" height="${n(image.h)}" preserveAspectRatio="none"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(box.x)} ${n(box.y)} ${n(box.w)} ${n(box.h)}" width="100%">${img}${body}</svg>`;
}
