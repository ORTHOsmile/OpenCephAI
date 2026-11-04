/** Owner, 16 Oct: a loading bar per model while a film opens. The main model has no time limit; each extra model is
 *  announced by the back end (`cephtrace://extra-model`) when its run starts, with its limit, and again when it ends. */
export type BarState = 'working' | 'done' | 'gave-up' | 'busy' | 'failed';
export interface Bar { id: string; title: string; state: BarState; limitMs: number | null }
export type BarAction =
  | { type: 'start' }
  | { type: 'main'; state: 'done' | 'failed' }
  | { type: 'extra'; modelId: string; title: string; state: BarState; limitMs: number }
  | { type: 'clear' };
export const EXTRA_EVENT = 'cephtrace://extra-model';
export const NO_BARS: Bar[] = [];

export function modelBars(bars: Bar[], a: BarAction): Bar[] {
  switch (a.type) {
    case 'start': return [{ id: 'main', title: 'Main model', state: 'working', limitMs: null }];
    case 'main': return bars.map((b) => (b.id === 'main' ? { ...b, state: a.state } : b));
    case 'extra': {
      const bar: Bar = { id: a.modelId, title: a.title, state: a.state, limitMs: a.limitMs };
      return bars.some((b) => b.id === a.modelId) ? bars.map((b) => (b.id === a.modelId ? bar : b)) : [...bars, bar];
    }
    case 'clear': return NO_BARS;
  }
}

/** Every bar showing has ended (nothing showing is not "ended": there is nothing to fade). */
export const allEnded = (bars: Bar[]) => bars.length > 0 && bars.every((b) => b.state !== 'working');

export function barText(b: Bar): string {
  switch (b.state) {
    case 'working': return 'working…';
    case 'done': return '✓';
    case 'gave-up': return `gave up after ${Math.round((b.limitMs ?? 0) / 1000)} s`;
    case 'busy': return 'busy with another film';
    case 'failed': return 'couldn’t read this film';
  }
}
