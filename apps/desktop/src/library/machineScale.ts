// A calibrated scale per X-ray machine (spec 2026-10-20; owner MS1–MS4): the words of Library › Film layouts.
import type { MachineScaleRow, MachineSummary, ScaleChange } from '../ipc';

const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
/** MS4, the owner's words: null when the change moves no film's mm (then it is saved without asking). */
export function changeWarning(c: ScaleChange): string | null {
  if (!c.films.length && !c.fitted.length && !c.deleted) return null;
  const fitted = c.fitted.length ? ` and ${n(c.fitted.length, 'film', 'films')} fitted to them` : '';
  const gone = c.deleted ? ` ${c.deleted} more in Recently deleted ${c.deleted === 1 ? 'is' : 'are'} changed too.` : '';
  return `This changes the mm of ${n(c.films.length, 'film', 'films')} of this machine${fitted}. Each loses Tracing verified.${gone}`;
}
/** MS1 "typed": mm per pixel (a full stop for decimals, MQ5) and the film size in whole pixels; else the refusal. */
export function parseEntered(mm: string, w: string, h: string): MachineScaleRow | string {
  const v = /^\d+(\.\d+)?$/.test(mm.trim()) ? Number(mm.trim()) : NaN;
  if (!(v > 0)) return 'Enter the machine’s mm per pixel as a number above 0, with a full stop for decimals (e.g. 0.1).';
  const px = (s: string) => (/^\d+$/.test(s.trim()) ? Number(s.trim()) : NaN);
  const [W, H] = [px(w), px(h)];
  if (!(W > 0 && H > 0)) return 'Enter the film size in whole pixels, width and height above 0.';
  return { spacingMm: v, widthPx: W, heightPx: H, source: 'entered', setAt: null };
}
/** One line under the machine's name. */
export function scaleSummary(m: MachineSummary, date: (iso: string) => string): string {
  const s = m.scale; if (!s) return 'No calibrated scale';
  const from = s.source === 'entered' ? 'entered value' : s.sourceFilmDate ? `from film of ${date(s.sourceFilmDate)}` : 'from a calibrated film';
  return `Scale ${s.spacingMm.toFixed(4)} mm/px for ${s.widthPx} × ${s.heightPx} px films, ${from} · used by ${n(m.scaleFilms, 'film', 'films')}`;
}
