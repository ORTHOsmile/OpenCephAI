import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES, buildRegistry } from '@ceph/analyses';
import { initialTracing } from '../tracing/state';
import { SYNTH_POINTS } from './fixtures';
import { DEFAULT_REPORT_OPTIONS, type ReportOptions } from './model';
import { figureFit, type FigureInput, type Shape } from './shapes';
import { profilogramBox } from './page';
import { profilogramPageShapes } from './profilogramPage';
import { GRID_STYLE, MM_PER_PX } from '../canvas/gridStyle';
import css from '../styles/tokens.css?raw';
import overlaySource from '../canvas/Overlay.tsx?raw';

// Owner, 5 Nov 2026: the true-size mm grid behind the profilogram page (the screen's 'grid' background), ON by default.
const pts = Object.fromEntries(Object.entries(SYNTH_POINTS).map(([id, p]) => [id, { ...p, source: 'ai' as const, verified: false }]));
const dims = { W: 1200, H: 1400 }, orientation = { mirror: false, rotDeg: 0, source: 'none' as const };
const fi = (over: Partial<FigureInput> = {}): FigureInput => ({ points: pts, registry: buildRegistry(ALL_ANALYSES), overlays: initialTracing.overlays, orientation, dims,
  scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 }, ...over });
const on: ReportOptions = { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true };
const GRID = ['grid-minor', 'grid-mid', 'grid-major', 'grid-axis'];
const gridOf = (s: Shape[]) => s.filter((x) => GRID.includes(x.role ?? '')) as Extract<Shape, { t: 'line' }>[];
const rest = (s: Shape[]) => s.filter((x) => !GRID.includes(x.role ?? '') && x.role !== 'grid-note');

/** Distances (page mm) between the parallel grid lines that run like the first minor line, nearest first. */
function spacings(lines: Extract<Shape, { t: 'line' }>[]): number[] {
  const l0 = lines.find((l) => l.role === 'grid-minor')!, dx = l0.x2 - l0.x1, dy = l0.y2 - l0.y1, len = Math.hypot(dx, dy), nx = -dy / len, ny = dx / len;
  const proj = lines.filter((l) => Math.abs((l.x2 - l.x1) * nx + (l.y2 - l.y1) * ny) < 1e-6 * Math.hypot(l.x2 - l.x1, l.y2 - l.y1))   // same direction
    .map((l) => l.x1 * nx + l.y1 * ny).sort((a, b) => a - b);
  const uniq = proj.filter((v, i) => i === 0 || v - proj[i - 1] > 1e-6);
  return uniq.slice(1).map((v, i) => v - uniq[i]);
}

describe('the grid behind the profilogram (owner, 5 Nov 2026)', () => {
  it('default options: the page carries the grid, painted BEFORE the profile; lines are minor (1 mm), mid (5 mm), major (10 mm) and the two axes', () => {
    expect(DEFAULT_REPORT_OPTIONS.profilogramGrid).toBe(true);
    const s = profilogramPageShapes(fi(), 'a4', on);
    const g = gridOf(s);
    for (const role of GRID) expect(g.some((l) => l.role === role), role).toBe(true);
    expect(g.filter((l) => l.role === 'grid-axis')).toHaveLength(2);
    const firstProfile = s.findIndex((x) => x.role === 'profile'), lastGrid = s.map((x) => GRID.includes(x.role ?? '')).lastIndexOf(true);
    expect(firstProfile).toBeGreaterThan(lastGrid);
  });
  it('true scale: neighbouring parallel grid lines are 1 patient mm apart, = fit.k / mmPerPx page mm; doubling mmPerPx doubles the gap', () => {
    const k = figureFit(orientation, dims, profilogramBox('a4')).k;
    const a = spacings(gridOf(profilogramPageShapes(fi(), 'a4', on)));
    expect(a.length).toBeGreaterThan(50);
    for (const d of a) expect(d).toBeCloseTo(k / 0.1, 6);
    const b = spacings(gridOf(profilogramPageShapes(fi({ scale: { mmPerPx: 0.2, source: 'calibration', steps: 0 } }), 'a4', on)));
    for (const d of b) expect(d).toBeCloseTo(k / 0.2, 6);
  });
  it('every 10th line is bold: major lines sit 10 patient mm apart, mid lines at the 5s', () => {
    const k = figureFit(orientation, dims, profilogramBox('a4')).k;
    const g = gridOf(profilogramPageShapes(fi(), 'a4', on)).filter((l) => l.role !== 'grid-axis');
    const major = g.filter((l) => l.role === 'grid-major'), mid = g.filter((l) => l.role === 'grid-mid');
    expect(spacings([g.find((l) => l.role === 'grid-minor')!, ...major])[0]).toBeCloseTo(10 * k / 0.1, 6);
    expect(spacings([g.find((l) => l.role === 'grid-minor')!, ...mid, ...major])[0]).toBeCloseTo(5 * k / 0.1, 6);
    expect(major[0].width).toBeGreaterThan(mid[0].width);
    expect(mid[0].width).toBeGreaterThan(g.find((l) => l.role === 'grid-minor')!.width);
  });
  it('stays inside the film (the oriented picture), never across the page margin', () => {
    const f = figureFit(orientation, dims, profilogramBox('a4'));
    for (const l of gridOf(profilogramPageShapes(fi(), 'a4', on))) {
      for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
        expect(x).toBeGreaterThanOrEqual(f.img.x - 1e-6); expect(x).toBeLessThanOrEqual(f.img.x + f.img.w + 1e-6);
        expect(y).toBeGreaterThanOrEqual(f.img.y - 1e-6); expect(y).toBeLessThanOrEqual(f.img.y + f.img.h + 1e-6);
      }
    }
  });
  it('also lies inside the film when it is levelled and mirrored (rotation + mirror applied to the lattice)', () => {
    const o = { mirror: true, rotDeg: 7, source: 'none' as const }, f = figureFit(o, dims, profilogramBox('a4'));
    const g = gridOf(profilogramPageShapes(fi({ orientation: o }), 'a4', on));
    expect(g.length).toBeGreaterThan(50);
    for (const l of g) for (const [x, y] of [[l.x1, l.y1], [l.x2, l.y2]]) {
      expect(x).toBeGreaterThanOrEqual(f.img.x - 1e-6); expect(x).toBeLessThanOrEqual(f.img.x + f.img.w + 1e-6);
      expect(y).toBeGreaterThanOrEqual(f.img.y - 1e-6); expect(y).toBeLessThanOrEqual(f.img.y + f.img.h + 1e-6);
    }
  });
  it('grid option off: the page is exactly the profilogram as before (no grid shapes, nothing else changed)', () => {
    const off = profilogramPageShapes(fi(), 'a4', { ...on, profilogramGrid: false });
    expect(gridOf(off)).toHaveLength(0);
    expect(off).toEqual(rest(profilogramPageShapes(fi(), 'a4', on)));
    expect(off.length).toBeGreaterThan(0);
  });
  it('profilogram page off: no shapes at all, grid option or not', () => {
    expect(profilogramPageShapes(fi(), 'a4', { ...DEFAULT_REPORT_OPTIONS, profilogramPage: false, profilogramGrid: true })).toEqual([]);
  });
  it('uncalibrated film (assumed scale): no mm grid, and no note either; the profilogram itself is unchanged', () => {
    const s = profilogramPageShapes(fi({ scale: { mmPerPx: 0.1, source: 'assumed' } }), 'a4', on);
    expect(gridOf(s)).toHaveLength(0);
    expect(s.some((x) => x.role === 'grid-note')).toBe(false);
    expect(s).toEqual(rest(profilogramPageShapes(fi(), 'a4', on)));
    // a fit to a film that itself has no ruler is just as unknown
    const fit = { mmPerPx: 0.1, source: 'fit' as const, fit: { ref: 'Pre', kind: 'points' as const, k: 1, refAssumed: true } };
    expect(gridOf(profilogramPageShapes(fi({ scale: fit }), 'a4', on))).toHaveLength(0);
  });
  it('a calibrated-by-fit or machine scale still gets the grid', () => {
    const fit = { mmPerPx: 0.1, source: 'fit' as const, fit: { ref: 'Pre', kind: 'points' as const, k: 1, refAssumed: false } };
    expect(gridOf(profilogramPageShapes(fi({ scale: fit }), 'a4', on)).length).toBeGreaterThan(50);
  });
  it('no Po or Or placed: no grid (no Frankfort direction), the profilogram still draws', () => {
    const { Po: _po, ...noPo } = pts;
    const s = profilogramPageShapes(fi({ points: noPo }), 'a4', on);
    expect(gridOf(s)).toHaveLength(0);
    expect(s.length).toBeGreaterThan(0);
  });
  it('nothing to draw (no profile points): an empty page, so no page is added, grid or not', () => {
    expect(profilogramPageShapes(fi({ points: { Po: pts.Po, Or: pts.Or } }), 'a4', on)).toEqual([]);
  });
  it('no figure at all: empty', () => {
    expect(profilogramPageShapes(null, 'a4', on)).toEqual([]);
  });
  it('says in words what a grid cell is: one patient millimetre, not a paper millimetre', () => {
    const note = profilogramPageShapes(fi(), 'a4', on).find((x) => x.role === 'grid-note') as Extract<Shape, { t: 'text' }>;
    expect(note.s).toMatch(/1 mm/);
    expect(note.s).toMatch(/10 mm/);
    expect(note.s).toMatch(/patient/);
  });
});

// Owner, 6 Nov 2026: the PDF's mm grid uses exactly the screen's colours and line weights (and opacity), from one shared table.
describe('the report grid matches the app window\'s grid', () => {
  const g = gridOf(profilogramPageShapes(fi(), 'a4', on));
  const cssVar = (name: string, block: 'light' | 'dark') => {
    const parts = css.split('@media (prefers-color-scheme: dark)');
    const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block === 'light' ? parts[0] : parts[1]);
    return m?.[1].toLowerCase();
  };
  const ROLE = { minor: 'grid-minor', mid: 'grid-mid', major: 'grid-major', axis: 'grid-axis' } as const;
  /** Fails if any PDF grid line is drawn in a colour other than the screen's `--grid-*` value (light AND dark, which are equal). */
  it.each(Object.entries(ROLE))('%s lines are the screen\'s colour (%s)', (key, role) => {
    const lines = g.filter((l) => l.role === role);
    expect(lines.length).toBeGreaterThan(0);
    const screen = cssVar(role, 'light');   // the screen's variable named by the role itself, not through the shared table (so a wrong table entry is caught)
    expect(screen).toMatch(/^#[0-9a-f]{6}$/);
    expect(cssVar(role, 'dark')).toBe(screen);
    expect(GRID_STYLE[key as keyof typeof ROLE].token).toBe(role);
    for (const l of lines) expect(l.stroke.toLowerCase()).toBe(screen);
  });
  /** Fails if a PDF line weight is not the screen's CSS px weight (one CSS px = 25.4/96 page mm). */
  it.each(Object.entries(ROLE))('%s lines have the screen\'s weight', (key, role) => {
    const px = GRID_STYLE[key as keyof typeof ROLE].px;
    for (const l of g.filter((x) => x.role === role)) expect(l.width).toBeCloseTo(px * MM_PER_PX, 9);
    expect(MM_PER_PX).toBeCloseTo(25.4 / 96, 12);
  });
  it('the table holds the screen\'s published numbers (0.5, 0.8, 1.1, 1.6 px, fully opaque), and the screen draws from it, not from its own numbers', () => {
    expect([GRID_STYLE.minor.px, GRID_STYLE.mid.px, GRID_STYLE.major.px, GRID_STYLE.axis.px]).toEqual([0.5, 0.8, 1.1, 1.6]);
    expect(Object.values(GRID_STYLE).every((x) => x.opacity === 1)).toBe(true);
    for (const k of ['minor', 'mid', 'major', 'axis']) expect(overlaySource).toContain(`GRID_STYLE.${k}.px`);
    expect(overlaySource).not.toContain('var(--grid-');   // no colour of its own: it names the token through the table
  });
});
