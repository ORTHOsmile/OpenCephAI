import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES, buildRegistry } from '@ceph/analyses';
import { initialTracing, type TracingPoint } from '../tracing/state';
import { displayBounds } from '../canvas/orientation';
import { softDash } from '../compare/series';
import { ASSUMED_MM_PER_PX, type Scale } from '../tracing/spacing';
import { mix, PRINT } from './colours';
import type { ChartRow } from './model';
import { CHART, chartShapes, figure, figureFit, layoutChart, profilogramShapes, scaleBarShapes, toSvg, tracingShapes, type Shape } from './shapes';

const of = (s: Shape[], role: string) => s.filter((x) => x.role === role);

describe('the report polygon chart (CHART-TAB-1, from chart/polygon.ts)', () => {
  const rows = [
    { abbr: 'SNA', z: 0, mean: 82, sd: 3.5, unit: 'deg' as const },
    { abbr: 'ANB', z: 1.5, mean: 2, sd: 2, unit: 'deg' as const },
    { abbr: 'Wits', z: null, mean: null, sd: null, unit: 'mm' as const },
    { abbr: 'FMA', z: 4, mean: 25, sd: 5, unit: 'deg' as const },
  ];
  const { shapes, h } = chartShapes(rows, { x: 10, y: 20, w: 114 }, 1);   // plot from x 32, 90 mm wide
  it('one grey scale line and one abbreviation per row; height fits the rows', () => {
    expect(of(shapes, 'scale').map((s) => (s as { y1: number }).y1)).toEqual([24, 30, 36, 42]);
    expect(of(shapes, 'label').map((s) => (s as { s: string }).s)).toEqual(['SNA', 'ANB', 'Wits', 'FMA']);
    expect(h).toBe(26);
  });
  it('the patient dot sits at its SD position; the norm mean is the middle', () => {
    expect(of(shapes, 'dot').map((s) => [(s as { cx: number }).cx, (s as { cy: number }).cy])).toEqual([[77, 24], [99.5, 30], [122, 42]]);
    expect(of(shapes, 'mean').map((s) => (s as { x1: number }).x1)).toEqual([77, 77, 77]);
  });
  it('the green ±1 SD band (review Minor 2: pinned to the literal, not mix() on both sides), and the ticks at the mean and ±2 SD in the row\'s own units', () => {
    const band = of(shapes, 'band')[0] as { x: number; w: number; fill: string };
    expect([band.x, band.w, band.fill]).toEqual([62, 30, '#daf5e1']);
    expect(of(shapes, 'tick').slice(0, 3).map((s) => [(s as { x: number }).x, (s as { s: string }).s])).toEqual([[47, '75.0'], [77, '82.0'], [107, '89.0']]);
  });
  it('a row with no z has its grey line only, and the black line skips it', () => {
    expect(of(shapes, 'band')).toHaveLength(3);
    expect((of(shapes, 'patient')[0] as { pts: number[][] }).pts).toEqual([[77, 24], [99.5, 30], [122, 42]]);
  });
  it('beyond ±3 SD: drawn at the edge with an arrow pointing out', () => {
    expect((of(shapes, 'off')[0] as { pts: number[][] }).pts).toEqual([[120.5, 41], [122, 42], [120.5, 43]]);
    const low = chartShapes([{ abbr: 'X', z: -5, mean: 1, sd: 1, unit: 'deg' }], { x: 10, y: 20, w: 114 }, 1).shapes;
    expect((of(low, 'off')[0] as { pts: number[][] }).pts).toEqual([[33.5, 23], [32, 24], [33.5, 25]]);
  });
  it('one row with a value: a dot and no line; no rows: nothing but the height', () => {
    expect(of(chartShapes([rows[0]], { x: 0, y: 0, w: 114 }, 1).shapes, 'patient')).toHaveLength(0);
    expect(chartShapes([], { x: 0, y: 0, w: 114 }, 1)).toEqual({ shapes: [], h: 2 });
  });
  it('mix: 18 % of the norm green on white', () => {
    expect(mix('#34c759', '#ffffff', 0.18)).toBe('#daf5e1');
  });
  it('review Minor 7: a label with no approved abbreviation (longer than the label column) is truncated with an ellipsis; a short one is kept', () => {
    const long = 'A very long measurement name with no abbreviation at all';
    const r = chartShapes([{ abbr: long, z: 1, mean: 0, sd: 1, unit: 'mm' as const }], { x: 0, y: 0, w: 114 }, 1);
    const label = (of(r.shapes, 'label')[0] as { s: string }).s;
    expect(label.endsWith('…')).toBe(true);
    expect(label.length).toBeLessThan(long.length);
    expect(long.startsWith(label.slice(0, -1))).toBe(true);
    const short = chartShapes([{ abbr: 'SNA', z: 0, mean: 82, sd: 3.5, unit: 'deg' as const }], { x: 0, y: 0, w: 114 }, 1);
    expect((of(short.shapes, 'label')[0] as { s: string }).s).toBe('SNA');
  });
  it('a custom rowH changes the row pitch (a positive control for layoutChart below)', () => {
    const rows2: ChartRow[] = [{ abbr: 'SNA', z: 0, mean: 82, sd: 3.5, unit: 'deg' }, { abbr: 'ANB', z: 1.5, mean: 2, sd: 2, unit: 'deg' }];
    const shrunk = chartShapes(rows2, { x: 0, y: 0, w: 114 }, 1, 5.5);
    expect(of(shrunk.shapes, 'scale').map((s) => (s as { y1: number }).y1)).toEqual([3.75, 9.25]);   // 5.5 pitch, not 6
    expect(shrunk.h).toBe(2 * 5.5 + 2);
    const normal = chartShapes(rows2, { x: 0, y: 0, w: 114 }, 1);
    expect(of(normal.shapes, 'scale').map((s) => (s as { y1: number }).y1)).toEqual([4, 10]);   // the default pitch, unchanged
  });
});

// Fix round (ruling, 29 Oct 2026): a printed report must never quietly drop a row. layoutChart is the
// ONE function pdf.ts and ReportPreview.tsx both call, so they can never disagree about which rows print where.
describe('layoutChart (fix round, ruling, 29 Oct 2026): never drop a row', () => {
  const row = (i: number): ChartRow => ({ abbr: `R${i}`, z: 0.1 * (i % 7), mean: 80, sd: 3, unit: 'deg' });
  const BOX_H = 199;   // the real page-1 chart box height for A4 at the default fixture's header count
  it('few rows: the normal pitch, one page, nothing shrunk', () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(i));
    const pages = layoutChart(rows, BOX_H, BOX_H);
    expect(pages).toEqual([{ rows, rowH: CHART.rowH, continued: false }]);
  });
  it('more rows than fit at the normal pitch, but not so many the floor is needed: pitch shrinks, still ONE page, every row present', () => {
    const n = Math.floor(BOX_H / CHART.rowH) + 2;   // a couple more than fit at 6 mm
    const rows = Array.from({ length: n }, (_, i) => row(i));
    const pages = layoutChart(rows, BOX_H, BOX_H);
    expect(pages.length).toBe(1);
    expect(pages[0].rows.length).toBe(n);   // every row present — none dropped
    expect(pages[0].rowH).toBeCloseTo(BOX_H / n, 9);
    expect(pages[0].rowH).toBeLessThan(CHART.rowH);
    expect(pages[0].rowH).toBeGreaterThanOrEqual(CHART.minRowH);
  });
  it('REQUIRED (ruling): more rows than fit even at the old, fixed row height — every row is still present, across as many pages as it takes, never dropped', () => {
    const n = Math.floor(BOX_H / CHART.rowH) * 3;   // comfortably more than the old single-page capacity
    const rows = Array.from({ length: n }, (_, i) => row(i));
    const pages = layoutChart(rows, BOX_H, BOX_H);
    expect(pages.length).toBeGreaterThan(1);   // it continued — did not shrink below the floor to force one page
    const seen = pages.flatMap((p) => p.rows);
    expect(seen.length).toBe(n);   // every row present
    expect(seen.map((r) => r.abbr)).toEqual(rows.map((r) => r.abbr));   // in order, none skipped, none duplicated
    pages.forEach((p) => expect(p.rowH).toBeGreaterThanOrEqual(CHART.minRowH));   // the floor, never shrunk past it
    expect(pages[0].continued).toBe(false);
    pages.slice(1).forEach((p) => expect(p.continued).toBe(true));
  });
  it('no rows: no pages', () => expect(layoutChart([], BOX_H, BOX_H)).toEqual([]));
  it('positive control: reinstating the old "slice and drop" behaviour makes the REQUIRED test above fail', () => {
    const n = Math.floor(BOX_H / CHART.rowH) * 3;
    const rows = Array.from({ length: n }, (_, i) => row(i));
    // The old pdf.ts behaviour, before this fix round: `rowsFit = floor(boxH / CHART.rowH); rows.slice(0, rowsFit)`.
    const rowsFit = Math.floor(BOX_H / CHART.rowH);
    const oldSliced = rows.slice(0, rowsFit);
    expect(oldSliced.length).toBeLessThan(n);   // it silently dropped rows — exactly what this fix round forbids
    expect(oldSliced.length).not.toBe(layoutChart(rows, BOX_H, BOX_H).flatMap((p) => p.rows).length);
  });
});

describe('the tracing figure (same marks as the screen)', () => {
  const registry = buildRegistry(ALL_ANALYSES), dims = { W: 1000, H: 2000 }, box = { x: 0, y: 0, w: 100, h: 100 };
  const none = { mirror: false, rotDeg: 0, source: 'none' as const };
  const pt = (x: number, y: number, verified: boolean): TracingPoint => ({ x, y, source: 'ai', verified });
  const planesOff = Object.fromEntries(Object.keys(initialTracing.overlays.planes).map((k) => [k, false])) as typeof initialTracing.overlays.planes;
  const overlays = { ...initialTracing.overlays, planes: { ...planesOff, sn: true }, profilogram: false };
  it('fits the film into the box keeping its shape, centred', () => {
    const f = figureFit(none, dims, box);
    expect(f.k).toBeCloseTo(0.05, 12);
    expect(f.img).toEqual({ x: 25, y: 0, w: 50, h: 100 });
    expect([f.x0 + f.k * -0.5, f.y0 + f.k * -0.5]).toEqual([25, 0]);
    expect([f.x0 + f.k * 999.5, f.y0 + f.k * 1999.5].map((v) => +v.toFixed(9))).toEqual([75, 100]);
  });
  it('a rotated film keeps its aspect inside the box', () => {
    const f = figureFit({ mirror: false, rotDeg: 90, source: 'manual' }, dims, box);
    expect(f.img.w).toBeCloseTo(100, 9);
    expect(f.img.h).toBeCloseTo(50, 9);
  });
  it('verified points are filled squares, AI points open circles, each with its id; S–N drawn in its colour; review Minor 2: point colours pinned to the literal', () => {
    const s = tracingShapes({ S: pt(100, 300, true), N: pt(700, 200, false) }, registry, overlays, none, dims, figureFit(none, dims, box));
    expect(s.filter((x) => x.t === 'rect').length).toBe(1);
    expect(s.filter((x) => x.t === 'circle').length).toBe(1);
    expect(s.filter((x) => x.t === 'text').map((x) => (x as { s: string }).s).sort()).toEqual(['N', 'S']);
    const sn = s.filter((x) => x.t === 'line');
    expect(sn).toHaveLength(1);
    expect((sn[0] as { stroke: string }).stroke).toBe('#ffd60a');
    const sq = s.find((x) => x.t === 'rect') as { fill?: string };
    expect(sq.fill).toBe('#0a84ff');   // S is verified: mark-verified
    const ci = s.find((x) => x.t === 'circle') as { stroke?: string };
    expect(ci.stroke).toBe('#bf5af2');   // N is AI, unverified: mark-ai
  });
  it('positive control: a plane with a point missing is not drawn', () => {
    const s = tracingShapes({ S: pt(100, 300, true) }, registry, overlays, none, dims, figureFit(none, dims, box));
    expect(s.filter((x) => x.t === 'line')).toHaveLength(0);
  });
  it('a mirrored film draws the point mirrored, as the screen does', () => {
    const o = { mirror: true, rotDeg: 0, source: 'manual' as const }, f = figureFit(o, dims, box);
    const sq = tracingShapes({ S: pt(100, 300, true) }, registry, overlays, o, dims, f).find((x) => x.t === 'rect') as { x: number; w: number };
    expect(sq.x + sq.w / 2).toBeCloseTo(f.x0 + f.k * 899, 9);
  });
  // Owner ruling (29 Oct 2026, items 1-2): the profilogram is NEVER drawn on the film, even with the screen's own
  // overlay switched on — it has moved to its own page (`profilogramShapes`, below), under the report's
  // "Profilogram page" tick-box.
  it('positive control: tracingShapes draws no profile at all, even with overlays.profilogram on (the one exception to "match the operator\'s switches")', () => {
    const overlaysP = { ...overlays, profilogram: true };
    const s = tracingShapes({ S: pt(100, 300, true), N: pt(700, 200, false) }, registry, overlaysP, none, dims, figureFit(none, dims, box));
    expect(s.filter((x) => x.role === 'profile')).toHaveLength(0);
  });
  it('review Minor 4: profilogramShapes\' hard profile keeps the screen\'s 5 % fill', () => {
    const s = profilogramShapes({ S: pt(100, 300, true), N: pt(700, 200, false) }, none, dims, figureFit(none, dims, box));
    const hard = s.find((x) => x.t === 'poly' && x.role === 'profile' && (x as { closed?: boolean }).closed) as { fill?: string };
    expect(hard).toBeDefined();
    expect(hard.fill).toBe(mix(PRINT.profile, '#ffffff', 0.05));
  });
  it('review Minor 3: profilogramShapes\' soft-profile dash matches the screen\'s softDash(), scaled by the same 0.25 the planes use', () => {
    const s = profilogramShapes({ Sn: pt(100, 500, true), UL: pt(150, 520, true) }, none, dims, figureFit(none, dims, box));
    const soft = s.find((x) => x.t === 'poly' && x.role === 'profile' && !(x as { closed?: boolean }).closed) as { dash?: number[] };
    expect(soft).toBeDefined();
    expect(soft.dash).toEqual(softDash().split(' ').map((v) => Number(v) * 0.25));
  });
  // Owner (Nov 2026): the selected lines sit ON TOP of the profilogram, on the profilogram page too.
  it('profilogram page: the selected planes are drawn AFTER the profile shapes, in the film page\'s print colours and weights', () => {
    const pts = { S: pt(100, 300, true), N: pt(700, 200, false), Sn: pt(720, 500, true), UL: pt(760, 520, true) };
    const f = figureFit(none, dims, box);
    const withPlanes = profilogramShapes(pts, none, dims, f, { registry, overlays });
    const planes = withPlanes.filter((x) => x.role === 'plane'), prof = withPlanes.filter((x) => x.role === 'profile');
    expect(prof.length).toBeGreaterThan(0);
    expect(planes).toHaveLength(1);
    expect(withPlanes.indexOf(planes[0])).toBeGreaterThan(withPlanes.indexOf(prof[prof.length - 1]));
    // identical to the line the film page draws for the same plane
    expect(planes[0]).toEqual(tracingShapes(pts, registry, overlays, none, dims, f).find((x) => x.role === 'plane'));
  });
  it('profilogram page: no planes selected (or none passed) adds no plane shapes and leaves the profile unchanged', () => {
    const pts = { S: pt(100, 300, true), N: pt(700, 200, false), Sn: pt(720, 500, true), UL: pt(760, 520, true) };
    const f = figureFit(none, dims, box), plain = profilogramShapes(pts, none, dims, f);
    expect(plain.filter((x) => x.role === 'plane')).toHaveLength(0);
    const off = profilogramShapes(pts, none, dims, f, { registry, overlays: { ...overlays, planes: planesOff } });
    expect(off.filter((x) => x.role === 'plane')).toHaveLength(0);
    expect(off).toEqual(plain);
  });
  it('profilogram page: with nothing to draw as a profile, selected planes do not make a page of their own', () => {
    const f = figureFit(none, dims, box);
    const fh = { ...overlays, planes: { ...planesOff, fh: true } }, onlyFh = { Po: pt(100, 300, true), Or: pt(700, 320, true) };
    expect(tracingShapes(onlyFh, registry, fh, none, dims, f).filter((x) => x.role === 'plane')).toHaveLength(1);   // control: the plane itself does draw
    expect(profilogramShapes(onlyFh, none, dims, f, { registry, overlays: fh })).toEqual([]);
  });
  it('the film page still never carries a profile when planes go on the profilogram page', () => {
    const s = tracingShapes({ S: pt(100, 300, true), N: pt(700, 200, false), Sn: pt(720, 500, true), UL: pt(760, 520, true) }, registry, { ...overlays, profilogram: true }, none, dims, figureFit(none, dims, box));
    expect(s.filter((x) => x.role === 'profile')).toHaveLength(0);
  });
  it('review Important 1: the 10 mm bar is 10 mm in the patient at the film\'s CALIBRATED scale (0.1 mm/px would equal the assumed default and hide a bug)', () => {
    const mmPerPx = 0.0873;   // deliberately not ASSUMED_MM_PER_PX (0.1)
    const f = figureFit(none, dims, box);
    const bar = scaleBarShapes(f, mmPerPx, false, false), line = bar.find((x) => x.role === 'bar') as { x1: number; x2: number };
    expect(line.x2 - line.x1).toBeCloseTo((10 / mmPerPx) * f.k, 9);
    expect((bar.find((x) => x.t === 'text') as { s: string }).s).toBe('10 mm');
    expect((scaleBarShapes(f, mmPerPx, true, false).find((x) => x.t === 'text') as { s: string }).s).toBe('10 mm (assumed scale)');
    expect((scaleBarShapes(f, mmPerPx, false, true).find((x) => x.role === 'bar') as { stroke: string }).stroke).toBe('#ffffff');
  });
  it('review Important 1: the bar and the film share one page scale under rotation and mirroring, in a non-square box', () => {
    const o = { mirror: true, rotDeg: 7, source: 'manual' as const }, box2 = { x: 0, y: 0, w: 150, h: 80 }, mmPerPx = 0.0873;
    const f = figureFit(o, dims, box2);
    const b = displayBounds(o, dims), boundsW = b.x1 - b.x0;
    const line = scaleBarShapes(f, mmPerPx, false, false).find((x) => x.role === 'bar') as { x1: number; x2: number };
    expect((line.x2 - line.x1) / f.img.w).toBeCloseTo((10 / mmPerPx) / boundsW, 9);
  });
  it('review Important 2: on the film, a black backing box sits under the bar and its label, so Invert cannot hide them', () => {
    const f = figureFit(none, dims, box);
    const onFilm = scaleBarShapes(f, 0.0873, false, true);
    const backing = onFilm.find((x) => x.role === 'bar-backing') as { t: 'rect'; x: number; y: number; w: number; h: number; fill?: string };
    expect(backing).toBeDefined();
    expect(backing.t).toBe('rect');
    expect(backing.fill).toBe('#000000');
    // drawn first, so it paints UNDER the bar and its label (array order = paint order)
    expect(onFilm.indexOf(backing)).toBeLessThan(onFilm.findIndex((x) => x.role === 'bar'));
    expect(onFilm.indexOf(backing)).toBeLessThan(onFilm.findIndex((x) => x.role === 'bar-label'));
    const bar = onFilm.find((x) => x.role === 'bar') as { x1: number; x2: number; y1: number };
    const label = onFilm.find((x) => x.role === 'bar-label') as { y: number };
    expect(backing.x).toBeLessThanOrEqual(bar.x1);
    expect(backing.x + backing.w).toBeGreaterThanOrEqual(bar.x2);
    expect(backing.y).toBeLessThanOrEqual(label.y);
    expect(backing.y + backing.h).toBeGreaterThanOrEqual(bar.y1);
    // on paper there is no backing: the text is already black-on-white
    expect(scaleBarShapes(f, 0.0873, false, false).find((x) => x.role === 'bar-backing')).toBeUndefined();
  });
  it('review Minor 5: figure() takes one Scale (not independent mmPerPx/assumed that could disagree); asserts the bar through figure(), calibrated and assumed', () => {
    const calibrated: Scale = { mmPerPx: 0.0873, source: 'calibration', steps: 0 };
    const fi = { points: { S: pt(100, 300, true) }, registry, overlays, orientation: none, dims, scale: calibrated };
    const r = figure(fi, box, false);
    expect(r.img).toEqual({ x: 25, y: 0, w: 50, h: 100 });
    const f = figureFit(none, dims, box);
    const bar = r.shapes.find((x) => x.role === 'bar') as { x1: number; x2: number };
    expect(bar.x2 - bar.x1).toBeCloseTo((10 / calibrated.mmPerPx) * f.k, 9);
    expect((r.shapes.find((x) => x.role === 'bar-label') as { s: string }).s).toBe('10 mm');

    const assumed: Scale = { mmPerPx: ASSUMED_MM_PER_PX, source: 'assumed' };
    const r2 = figure({ ...fi, scale: assumed }, box, false);
    const bar2 = r2.shapes.find((x) => x.role === 'bar') as { x1: number; x2: number };
    expect(bar2.x2 - bar2.x1).toBeCloseTo((10 / ASSUMED_MM_PER_PX) * f.k, 9);
    expect((r2.shapes.find((x) => x.role === 'bar-label') as { s: string }).s).toBe('10 mm (assumed scale)');
  });
  // R3 (B): the bar reads "assumed" exactly when the screen does (`isAssumed`): a fit to a film with no ruler (G3) is
  // on the assumed scale; a fit to a ruler film is not. The bar's length is the fit's mm per pixel either way.
  it('R3: a fit to a film with no ruler (G3) reads "10 mm (assumed scale)"; a fit to a ruler film reads "10 mm"', () => {
    const fi = { points: { S: pt(100, 300, true) }, registry, overlays, orientation: none, dims };
    const fit = (refAssumed: boolean): Scale => ({ mmPerPx: 0.1042, source: 'fit', fit: { ref: 'T1', kind: 'sn', k: 1.042, refAssumed } });
    const label = (s: Scale) => (figure({ ...fi, scale: s }, box, false).shapes.find((x) => x.role === 'bar-label') as { s: string }).s;
    expect(label(fit(true))).toBe('10 mm (assumed scale)');
    expect(label(fit(false))).toBe('10 mm');
    const f = figureFit(none, dims, box), bar = figure({ ...fi, scale: fit(true) }, box, false).shapes.find((x) => x.role === 'bar') as { x1: number; x2: number };
    expect(bar.x2 - bar.x1).toBeCloseTo((10 / 0.1042) * f.k, 9);
  });
});

describe('the preview SVG', () => {
  it('draws in page millimetres and escapes text', () => {
    const svg = toSvg([{ t: 'text', x: 1, y: 2, s: 'A<B & "C"', size: 10, fill: '#000000' }], { x: 0, y: 0, w: 210, h: 297 });
    expect(svg).toContain('viewBox="0 0 210 297"');
    expect(svg).toContain('A&lt;B &amp; &quot;C&quot;');
    expect(svg).not.toContain('A<B');
  });
  it('puts the film under the drawing when given', () => {
    const svg = toSvg([], { x: 0, y: 0, w: 10, h: 10 }, { href: 'data:image/jpeg;base64,AAAA', x: 1, y: 2, w: 3, h: 4 });
    expect(svg).toContain('<image href="data:image/jpeg;base64,AAAA" x="1" y="2" width="3" height="4"');
  });
});
