import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ALL_ANALYSES, buildRegistry } from '@ceph/analyses';
import { initialTracing } from '../tracing/state';
import { Overlay } from './Overlay';

// Owner (Nov 2026): selected lines such as FH and SN sit ON TOP of the profilogram, never under it. SVG paints in
// document order, so the plane <line>s must come after the profilogram group.
const registry = buildRegistry(ALL_ANALYSES);
const pt = (x: number, y: number) => ({ x, y, source: 'ai' as const, verified: true });
const planesOff = Object.fromEntries(Object.keys(initialTracing.overlays.planes).map((k) => [k, false])) as typeof initialTracing.overlays.planes;
const points = { S: pt(100, 300), N: pt(700, 200), Sn: pt(720, 500), UL: pt(760, 520), Pg: pt(650, 900), Gn: pt(670, 950) };
const render = (overlays: Partial<typeof initialTracing.overlays>) => renderToStaticMarkup(
  <Overlay state={{ ...initialTracing, points, overlays: { ...initialTracing.overlays, planes: planesOff, profilogram: false, ...overlays } }}
    dims={{ W: 1000, H: 2000 }} registry={registry} S={(p) => p} mmPerPx={0.1} calib={null} assumedScale={false} />);

describe('Overlay paint order', () => {
  it('the plane lines are painted after (above) the profilogram', () => {
    const h = render({ planes: { ...planesOff, sn: true }, profilogram: true });
    const prof = h.indexOf('fill-opacity="0.05"'), line = h.indexOf('<line');
    expect(prof).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(-1);
    expect(line).toBeGreaterThan(prof);
  });
  it('with no profilogram the plane line is still drawn', () => {
    expect(render({ planes: { ...planesOff, sn: true } })).toContain('<line');
  });
});

// Stage A task 6: the point-check mark beside a flagged pin, its hover words and its ring. SYNTHETIC points only.
describe('Overlay: the point-check mark, hover and ring', () => {
  const flag = { id: 1, modelId: 'aariz-cepha29', landmarkId: 'N', action: 'flagged' as const, points: null, offPx: 142, expectedX: 700, expectedY: 58,
    ring: { cx: 700, cy: 58, rx: 90, ry: 40, angleDeg: 12 }, resolved: null };
  // N sits at (700, 200): the rest of the face expected it 142 px straight up.
  const base = { state: { ...initialTracing, points, overlays: { ...initialTracing.overlays, planes: planesOff, profilogram: false } },
    dims: { W: 1000, H: 2000 }, registry, mmPerPx: 0.1, calib: null, assumedScale: false };
  const draw = (extra: Record<string, unknown>, S: (p: { x: number; y: number }) => { x: number; y: number } = (p) => p) =>
    renderToStaticMarkup(<Overlay {...base} S={S} {...extra} />);
  const attr = (h: string, tag: string, name: string) => new RegExp(`<${tag}[^>]*? ${name}="([^"]*)"`).exec(h)?.[1];

  /** Fails if the Overlay does not draw the mark for a flagged point (or draws it with other words). */
  it('a flagged point gets the mark, with its words in the text, beside the pin and in the warn colour', () => {
    const h = draw({ checks: { N: flag } });
    expect(h).toContain('data-check="flagged"');
    // The overlay is aria-hidden like every pin and label on it, so an aria-label here would never be read: the words
    // are the visible text (task 7 carried item 3: the false assertion is removed, not kept).
    expect(h).not.toContain('aria-label');
    expect(h).toMatch(/<g[^>]*class="check-mark"[^>]*data-id="N"|<g[^>]*data-id="N"[^>]*class="check-mark"/);
    expect(h).toContain('>Check: far outside the usual position</text>');
    expect(h).toContain('var(--warn)');
    // 12 px right of the label: the label is at x + 10 and "N" is one character wide
    const x = Number(/<text[^>]*class="check-mark-text"[^>]* x="([\d.]+)"/.exec(h)?.[1] ?? /<text[^>]* x="([\d.]+)"[^>]*class="check-mark-text"/.exec(h)?.[1]);
    expect(x).toBeGreaterThan(700 + 10 + 12 - 1);
    expect(x).toBeLessThan(700 + 10 + 12 + 20);
  });
  /** Fails if a mark is drawn for an unflagged point, or with no `checks` at all. */
  it('no flag, no mark: neither the mark nor any ring', () => {
    expect(draw({})).not.toContain('data-check');
    expect(draw({ checks: null })).not.toContain('data-check');
    expect(draw({ checks: {} })).not.toContain('data-check');
  });
  /** Fails if a flag with no pin on the film (point absent: S or N missing) still draws a mark. */
  it('a flag for a point that has no pin draws nothing', () => {
    const { N: _n, ...noN } = points;
    const h = renderToStaticMarkup(<Overlay {...base} state={{ ...base.state, points: noN }} S={(p) => p} checks={{ N: flag }} />);
    expect(h).not.toContain('data-check');
  });
  /** Fails if the ring is drawn without a hover. */
  it('the ring and the hover words appear on hover only', () => {
    const quiet = draw({ checks: { N: flag } });
    expect(quiet).not.toContain('check-ring');
    expect(quiet).not.toContain('A flag, not a verdict.');
  });
  /** Fails if the ring is not the stored ring scaled by S (centre, radii, turn), or the hover words are not the stored ones. */
  it('hovering shows the ring (the stored ellipse, scaled by S) and the hover words', () => {
    const S2 = (p: { x: number; y: number }) => ({ x: 2 * p.x + 5, y: 2 * p.y + 7 });
    const h = draw({ checks: { N: flag }, checkHoverStart: 'N' }, S2);
    expect(h).toContain('class="check-ring"');
    expect(attr(h, 'ellipse', 'cx')).toBe('1405');   // 2 * 700 + 5
    expect(attr(h, 'ellipse', 'cy')).toBe('123');     // 2 * 58 + 7
    expect(attr(h, 'ellipse', 'rx')).toBe('180');
    expect(attr(h, 'ellipse', 'ry')).toBe('80');
    expect(attr(h, 'ellipse', 'transform')).toBe('rotate(12 1405 123)');
    expect(h).toContain('the rest of the face expected it about 14.2 mm higher)');
    expect(h).toContain('A flag, not a verdict.');
    expect(h).not.toMatch(/5,000|5000/);
  });
  /** Fails if the turn ignores the mirror: shown mirrored, the ring's long axis leans the other way on the screen. */
  it('a mirrored film turns the ring with it, and swaps left and right in the words', () => {
    const mirrorS = (p: { x: number; y: number }) => ({ x: 999 - p.x, y: p.y });
    const h = draw({ checks: { N: { ...flag, expectedX: 558, expectedY: 200, ring: { ...flag.ring, cx: 558, cy: 200 } } }, checkHoverStart: 'N',
      state: { ...base.state, orientation: { mirror: true, rotDeg: 0, source: 'none' as const } } }, mirrorS);
    expect(attr(h, 'ellipse', 'transform')).toBe(`rotate(-12 ${999 - 558} 200)`);
    expect(h).toContain('about 14.2 mm further right)');   // stored: expected 142 px left of the mark; shown mirrored: to the right
  });
  /** Fails if hovering one pin shows another's ring. */
  it('hovering a pin that has no flag shows no ring', () => {
    expect(draw({ checks: { N: flag }, checkHoverStart: 'S' })).not.toContain('check-ring');
  });
});
