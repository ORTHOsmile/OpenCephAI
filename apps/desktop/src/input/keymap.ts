export type Command =
  | { t: 'import' } | { t: 'undo' } | { t: 'redo' } | { t: 'zoom'; factor: number } | { t: 'fit' }
  | { t: 'level' } | { t: 'flip' } | { t: 'restore' } | { t: 'rotate'; deg: number }
  | { t: 'nudge'; dx: number; dy: number } | { t: 'togglePlanes' } | { t: 'toggleProfilogram' }
  | { t: 'cancel' } | { t: 'remove' } | { t: 'calibrate' };
export interface KeyLike { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; targetTag?: string; targetType?: string; targetEditable?: boolean }

const ARROWS: Record<string, [number, number]> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/** Fields that take typing or arrow keys. A focused checkbox, radio or button must not swallow P, G or the arrows. */
const TYPING = /^(text|search|email|number|password|tel|url|date|time|datetime-local|month|week|range|)$/;
const typing = (e: KeyLike) => !!e.targetEditable || e.targetTag === 'TEXTAREA' || e.targetTag === 'SELECT'
  || (e.targetTag === 'INPUT' && TYPING.test((e.targetType ?? '').toLowerCase()));

export function commandFor(e: KeyLike): Command | null {
  if (typing(e)) return null;
  const mod = e.metaKey || e.ctrlKey, key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (mod) {
    if (key === 'o') return { t: 'import' };
    if (key === 'z') return e.shiftKey ? { t: 'redo' } : { t: 'undo' };
    if (key === '=' || key === '+') return { t: 'zoom', factor: 1.25 };
    if (key === '-') return { t: 'zoom', factor: 0.8 };
    if ((key === '0' || key === ')') && e.shiftKey) return { t: 'restore' };
    if (key === '0') return { t: 'fit' };
    if (key === 'l') return { t: 'level' };
    if (key === 'm' && e.shiftKey) return { t: 'flip' };
    return null;
  }
  if (key === '[' || key === '{') return { t: 'rotate', deg: e.shiftKey || key === '{' ? -5 : -0.5 };
  if (key === ']' || key === '}') return { t: 'rotate', deg: e.shiftKey || key === '}' ? 5 : 0.5 };
  if (key === 'p') return { t: 'togglePlanes' };
  if (key === 'g') return { t: 'toggleProfilogram' };
  if (key === 'k') return { t: 'calibrate' };
  if (key === 'Escape') return { t: 'cancel' };
  if (key === 'Backspace' || key === 'Delete') return { t: 'remove' };
  const a = ARROWS[key];
  if (a) { const n = e.shiftKey ? 10 : 1; return { t: 'nudge', dx: a[0] * n, dy: a[1] * n }; }
  return null;
}
export interface KeyContext { hasCase: boolean; hasActivePoint: boolean; calibrating: boolean }
/** Whether a command does anything right now; keys that don't are left to the browser (not preventDefault-ed). */
export function applies(c: Command, x: KeyContext): boolean {
  switch (c.t) {
    case 'import': return true;
    case 'cancel': return x.calibrating || x.hasCase;
    case 'nudge': case 'remove': return x.hasCase && x.hasActivePoint && !x.calibrating;
    case 'calibrate': return x.hasCase;
    default: return x.hasCase && !x.calibrating;
  }
}
