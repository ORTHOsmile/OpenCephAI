import type { Display } from '../tracing/state';

/** Canvas filter for the display-only adjustments; 'none' when nothing is changed. The model never sees these. */
export function filterOf(d: Display): string {
  const f: string[] = [];
  if (d.brightness !== 1) f.push(`brightness(${d.brightness})`);
  if (d.contrast !== 1) f.push(`contrast(${d.contrast})`);
  if (d.invert) f.push('invert(1)');
  return f.length ? f.join(' ') : 'none';
}

/**
 * The CSS filter for a canvas that shows the film. Applied to the element, not the 2D context: WebKit (the macOS app)
 * ignores CanvasRenderingContext2D.filter. The white mm-grid paper is never filtered.
 */
export const filmFilter = (d: Display, background: 'radiograph' | 'grid'): string => (background === 'grid' ? 'none' : filterOf(d));
