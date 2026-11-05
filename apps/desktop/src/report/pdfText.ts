// `isCjk` lives in `systemFont.ts` (the module that actually finds a system CJK font); this creates a circular
// import (systemFont.ts imports `cmapCoverage` back from here), which is fine for ES modules as long as neither
// side uses the other's binding at module-evaluation time — both uses below are inside function bodies, called
// only once both modules have finished loading.
import { isCjk } from './systemFont';

/** What the PDF can print (owner FONT-1): the embedded Noto Sans — its own character map decides — or, before it has
 *  loaded, Latin-1. A letter the font does not have prints as "?", and `unprintable` lists it so the preview can say
 *  so before saving. */
export type Printable = (codePoint: number) => boolean;
export const latin1: Printable = (c) => c === 0x0a || (c >= 0x20 && c <= 0x7e) || (c >= 0xa0 && c <= 0xff);
const fits = (ch: string, has: Printable) => { const c = ch.codePointAt(0)!; return c === 0x0a || c === 0x20 || has(c); };

/** Owner bug (29 Oct 2026): en dash (–) and em dash (—) are common in the app's own fixed text (the footer, the
 *  context line) and in words clinicians paste from a word processor. Whatever font is active — even the Latin-1
 *  PLACEHOLDER used for the brief window before the real Noto Sans has loaded, or a hypothetical system font that
 *  genuinely lacks them — they must never print as "?": mapped to a plain hyphen instead, here, at PDF time. A
 *  letter with no entry here is unaffected, so the warning stays for anything genuinely unsupported. */
const SAFE_EQUIV: Record<number, string> = { 0x2013: '-', 0x2014: '-' };
const safeEquivOf = (ch: string): string | undefined => SAFE_EQUIV[ch.codePointAt(0)!];

export const pdfSafe = (s: string, has: Printable): string => [...s].map((ch) => (fits(ch, has) ? ch : safeEquivOf(ch) ?? '?')).join('');
export function unprintable(texts: string[], has: Printable): string[] {
  const out: string[] = [];
  for (const t of texts) for (const ch of t) if (!fits(ch, has) && safeEquivOf(ch) === undefined && !out.includes(ch)) out.push(ch);
  return out;
}

/** Owner FONT-2 (18 Oct 2026): what the PDF can print, now that a computer's own font may cover Chinese, Japanese
 *  or Korean on top of the embedded Noto Sans. `cjk` is `null` until one is found (or none exists here). */
export interface PrintFonts { noto: Printable; cjk: { has: Printable; name: string } | null }

/** The font (and possibly "?"-substituted text) to print one string with: Noto when it alone prints every letter;
 *  else the system font, but ONLY when it covers every letter AND every letter is either CJK or already in Noto
 *  (ruling FONT-2: Arabic, Hebrew, Indic and Thai never print through the system font, even when a font such as
 *  Arial Unicode has them — jsPDF's shaping/right-to-left handling is not reliable for those scripts); else Noto
 *  with "?" for whatever it lacks, named in `missing`. */
export function printPlan(text: string, f: PrintFonts): { font: 'NotoSans' | 'SystemCJK'; text: string; missing: string[] } {
  if ([...text].every((ch) => fits(ch, f.noto))) return { font: 'NotoSans', text, missing: [] };
  if (f.cjk) {
    const cjk = f.cjk;
    const viaSystemFont = (ch: string) => {
      const c = ch.codePointAt(0)!;
      return c === 0x0a || c === 0x20 || (cjk.has(c) && (isCjk(c) || f.noto(c)));
    };
    if ([...text].every(viaSystemFont)) return { font: 'SystemCJK', text, missing: [] };
  }
  return { font: 'NotoSans', text: pdfSafe(text, f.noto), missing: unprintable([text], f.noto) };
}

/** Every letter missing across `texts`, under the full `printPlan` rule (used for the preview's "can't be
 *  printed" warning, Task 8) — the union of every `printPlan(t, f).missing`. */
export function printProblems(texts: string[], f: PrintFonts): string[] {
  const out: string[] = [];
  for (const t of texts) for (const m of printPlan(t, f).missing) if (!out.includes(m)) out.push(m);
  return out;
}

// Bounds-checked big-endian reads for `glyphOf` below: `undefined` (never a throw) when a read would run off the
// buffer end — see the Task 7A review's I1 ("Make glyphOf/has() total").
const u16 = (dv: DataView, o: number): number | undefined => (o >= 0 && o + 2 <= dv.byteLength ? dv.getUint16(o) : undefined);
const u32 = (dv: DataView, o: number): number | undefined => (o >= 0 && o + 4 <= dv.byteLength ? dv.getUint32(o) : undefined);
const i16 = (dv: DataView, o: number): number | undefined => (o >= 0 && o + 2 <= dv.byteLength ? dv.getInt16(o) : undefined);

/** The code points a TrueType font maps, by EXACT glyph lookup (preflight-rulings Task 7): a format-4 segment can
 *  hold code points inside its range that still resolve to glyph 0 (.notdef) — those print as an empty box with no
 *  warning if only the range is checked, so every lookup here resolves the real glyph id and treats glyph 0 as
 *  "not covered". Reads the Windows Unicode subtable (format 12, else format 4); results are cached per code point.
 *  Construction (finding the subtable) still throws on a file too small to be a font at all — callers (`fontsFrom`,
 *  `pickFace`) already expect and catch that. The returned `has()` closure, once built, is TOTAL (Task 7A review
 *  I1/P4): it can run against an untrusted system font whose subtable passed the lighter structural check in
 *  `faceInfo` but still lies about its own size (a format-12 `nGroups` or format-4 `segCount` with no group data
 *  behind it) — every read is bounds-checked against the whole buffer and answers "not covered" (0) rather than
 *  throwing, so a caller far from `pickFace`'s own try/catch (e.g. `printPlan`, while the PDF is being built) can
 *  never be crashed by it. */
export function cmapCoverage(ttf: Uint8Array): Printable {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength), tag = (o: number) => String.fromCharCode(...ttf.subarray(o, o + 4));
  let cmap = -1;
  for (let i = 0; i < dv.getUint16(4); i++) if (tag(12 + 16 * i) === 'cmap') cmap = dv.getUint32(12 + 16 * i + 8);
  if (cmap < 0) throw new Error('not a font: no character map');
  let best = -1, fmt = 0;
  for (let i = 0; i < dv.getUint16(cmap + 2); i++) {
    const r = cmap + 4 + 8 * i, pid = dv.getUint16(r), eid = dv.getUint16(r + 2), off = cmap + dv.getUint32(r + 4), f = dv.getUint16(off);
    if (pid === 3 && eid === 10 && f === 12) { best = off; fmt = 12; } else if (pid === 3 && eid === 1 && f === 4 && fmt !== 12) { best = off; fmt = 4; }
  }
  if (best < 0) throw new Error('not a font: no Unicode character map');

  // Exact glyph id for a code point under this subtable; 0 means .notdef ("not covered"), per the OpenType spec.
  // TOTAL: every field read goes through the bounds-checked u16/u32/i16 above and a read that would run off the
  // buffer answers "not covered" immediately instead of throwing. The format-12 loop is also capped to the
  // groups that actually fit between `best + 16` and the end of the WHOLE buffer, so a hostile `nGroups` (e.g.
  // 0xFFFFFFFF) can never turn this into either a crash or a long scan.
  const glyphOf = (c: number): number => {
    if (fmt === 12) {
      const nGroups = u32(dv, best + 12);
      if (nGroups === undefined) return 0;
      const maxGroups = Math.max(0, Math.floor((dv.byteLength - (best + 16)) / 12));
      const n = Math.min(nGroups, maxGroups);
      for (let g = 0; g < n; g++) {
        const lo = u32(dv, best + 16 + 12 * g), hi = u32(dv, best + 20 + 12 * g), startGlyph = u32(dv, best + 24 + 12 * g);
        if (lo === undefined || hi === undefined || startGlyph === undefined) return 0;
        if (c >= lo && c <= hi) return startGlyph + (c - lo);
      }
      return 0;
    }
    // format 4: endCode[segCount], reservedPad, startCode[segCount], idDelta[segCount] (int16), idRangeOffset[segCount]
    const segX2 = u16(dv, best + 6);
    if (segX2 === undefined) return 0;
    const segCount = segX2 / 2;
    const endOff = best + 14, startOff = endOff + segX2 + 2, deltaOff = startOff + segX2, rangeOff = deltaOff + segX2;
    for (let k = 0; k < segCount; k++) {
      const end = u16(dv, endOff + k * 2);
      if (end === undefined) return 0;
      if (c > end) continue;
      const start = u16(dv, startOff + k * 2);
      if (start === undefined) return 0;
      if (c < start) return 0;
      const idDelta = i16(dv, deltaOff + k * 2), idRangeOffset = u16(dv, rangeOff + k * 2);
      if (idDelta === undefined || idRangeOffset === undefined) return 0;
      if (idRangeOffset === 0) return (c + idDelta) & 0xffff;
      const g = u16(dv, rangeOff + k * 2 + idRangeOffset + 2 * (c - start));
      if (g === undefined) return 0;
      return g === 0 ? 0 : (g + idDelta) & 0xffff;
    }
    return 0;
  };
  const cache = new Map<number, boolean>();
  return (c: number) => {
    let v = cache.get(c);
    if (v === undefined) { v = glyphOf(c) !== 0; cache.set(c, v); }
    return v;
  };
}
