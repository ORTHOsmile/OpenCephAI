// Owner FONT-2 (18 Oct 2026): Chinese, Japanese and Korean names print in THIS COMPUTER'S OWN installed font, read
// at the moment the PDF is made — nothing is downloaded, installed or committed (contrast FONT-1's embedded Noto
// Sans, which the app ships). Arabic, Hebrew, Indic and Thai are deliberately never routed through this path (see
// `pdfText.ts`'s `printPlan`): jsPDF's shaping/right-to-left handling is not reliable for them.
//
// Licence note (repeated in Task 12's records): the font file itself is never copied into the app or the repo —
// only the PDF this computer makes carries a few of its glyphs, subset by jsPDF to the letters actually used. That
// is allowed only when the font's own OS/2 `fsType` embedding bit says so; `faceInfo` below refuses a restricted
// (`fsType` 2), bitmap-only, or `OS/2`-less face before it is ever handed to jsPDF.
//
// Every byte read here may come from an untrusted file already on this computer (Task 7 review m2: these parse a
// font file the app did not create). Every offset/length read is bounds-checked; a truncated, malformed or
// adversarial font answers "not usable" (false / null / an empty/partial result) — it never throws past the
// callers in this file.
import { invoke } from '@tauri-apps/api/core';
import { cmapCoverage, type Printable } from './pdfText';

export type ScriptId = 'zh' | 'ja' | 'ko';

/** BMP-only CJK ranges (preflight-rulings Task 7A). A letter beyond the BMP (e.g. 𠀋) is not CJK here: jsPDF's text
 *  encoding is not reliable for it, so it prints "?" with the warning, the same as Arabic/Hebrew/Indic/Thai. */
export function isCjk(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x11ff) || (c >= 0x2e80 && c <= 0x2fdf) || (c >= 0x3000 && c <= 0x303f) ||
    (c >= 0x3040 && c <= 0x30ff) || (c >= 0x3100 && c <= 0x312f) || (c >= 0x3130 && c <= 0x318f) ||
    (c >= 0x31a0 && c <= 0x31ff) || (c >= 0x3200 && c <= 0x33ff) || (c >= 0x3400 && c <= 0x4dbf) ||
    (c >= 0x4e00 && c <= 0x9fff) || (c >= 0xa960 && c <= 0xa97f) || (c >= 0xac00 && c <= 0xd7ff) ||
    (c >= 0xf900 && c <= 0xfaff) || (c >= 0xfe30 && c <= 0xfe4f) || (c >= 0xff00 && c <= 0xffef)
  );
}
// Task 7A review m7: the original ranges missed Hangul compatibility jamo (3130-318F), the Hangul jamo
// extended-A block (A960-A97F), half-width katakana (FF66-FF9F) and the katakana phonetic extension
// (31F0-31FF) — those names searched zh first, which matters little on this Mac (every list starts with the
// same file) but would matter once a Windows build has distinct per-script lists.
const HANGUL = (c: number) => (c >= 0x1100 && c <= 0x11ff) || (c >= 0x3130 && c <= 0x318f) || (c >= 0xa960 && c <= 0xa97f) || (c >= 0xac00 && c <= 0xd7ff);
const KANA = (c: number) => (c >= 0x3040 && c <= 0x30ff) || (c >= 0x31f0 && c <= 0x31ff) || (c >= 0xff66 && c <= 0xff9f);

/** Which script's own font list to try first: Hangul present → Korean; else kana present → Japanese; else Chinese
 *  — then the other two, in the same fixed order `system_font.rs`'s `script_order` uses. */
export function scriptOrder(letters: Iterable<string>): ScriptId[] {
  let hangul = false, kana = false;
  for (const ch of letters) {
    const c = ch.codePointAt(0);
    if (c === undefined) continue;
    if (HANGUL(c)) hangul = true;
    if (KANA(c)) kana = true;
  }
  if (hangul) return ['ko', 'zh', 'ja'];
  if (kana) return ['ja', 'zh', 'ko'];
  return ['zh', 'ja', 'ko'];
}

// --- bounds-checked big-endian reads: undefined (never a throw) when a read would run off the buffer end ---
const u16 = (dv: DataView, o: number): number | undefined => (o >= 0 && o + 2 <= dv.byteLength ? dv.getUint16(o) : undefined);
const u32 = (dv: DataView, o: number): number | undefined => (o >= 0 && o + 4 <= dv.byteLength ? dv.getUint32(o) : undefined);
const TTCF = 0x74746366; // 'ttcf'
// Task 7A review I2: sane maxima, picked from real fonts on this Mac — Songti.ttc (the biggest real collection
// here) has 8 faces; a real face has under 40 tables (confirmed against Arial Unicode and the Songti faces). A
// hostile file claiming far more than either, before the fix, made `pickFace` iterate millions of "faces" (fuzz
// probe P3a) or `extractFace` allocate tens of gigabytes from a few-KB table directory (P3b/P3c).
const MAX_FACES = 64;
const MAX_TABLES = 64;

/** Every face's offset in a font file: a `ttcf` collection header's own table (bounds-checked: a face count
 *  larger than the file stops early and returns only the faces actually readable, never throws, and never more
 *  than `MAX_FACES`); a single-face sfnt is `[0]`. Duplicate offsets are dropped. */
export function sfntFaces(bytes: Uint8Array): number[] {
  if (bytes.length < 4) return [];
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = u32(dv, 0);
  if (tag !== TTCF) return [0];
  const numFonts = u32(dv, 8);
  if (numFonts === undefined) return [];
  const out: number[] = [];
  for (let i = 0; i < Math.min(numFonts, MAX_FACES); i++) {
    const off = u32(dv, 12 + i * 4);
    if (off === undefined) break; // the offset table itself runs off the end before this entry — stop, don't invent more
    if (!out.includes(off)) out.push(off);
  }
  return out;
}

/** A bounds-checked table directory for the face starting at `offset`: tag -> {offset, length} within `bytes`
 *  (offsets are absolute into `bytes`, not relative to `offset`). `null` when the directory itself, or any entry
 *  in it, cannot be read without running off the buffer, or when it claims more than `MAX_TABLES` (a real face
 *  has well under this many; more is treated as not usable rather than read). */
function tableDirAt(bytes: Uint8Array, offset: number): Map<string, { offset: number; length: number }> | null {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const numTables = u16(dv, offset + 4);
  if (numTables === undefined || numTables > MAX_TABLES) return null;
  const dirEnd = offset + 12 + numTables * 16;
  if (dirEnd > bytes.length) return null;
  const map = new Map<string, { offset: number; length: number }>();
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + i * 16;
    const t = String.fromCharCode(...bytes.subarray(rec, rec + 4));
    const tOffset = u32(dv, rec + 8), tLength = u32(dv, rec + 12);
    if (tOffset === undefined || tLength === undefined) return null;
    map.set(t, { offset: tOffset, length: tLength });
  }
  return map;
}

/** A standalone single-face sfnt, re-laid-out from `bytes` starting at `offset` (its own table directory,
 *  offsets rewritten, tables copied 4-byte aligned) — so the rest of this file (and `cmapCoverage`) can treat
 *  every face the same way regardless of whether it came out of a `ttcf` collection. Every length/offset is
 *  bounds-checked against `bytes`; a table directory that is truncated, any table whose own offset+length
 *  reaches past the end of the file (Task 7 review m2's "a table offset past the end"), more than `MAX_TABLES`
 *  tables (I2, fuzz probe P3b), or whose tables' lengths add up to more than the file itself (I2, fuzz probe
 *  P3c — several entries can each individually fit, yet together claim far more bytes than exist, which is what
 *  made the old code allocate a wildly amplified output buffer) returns an empty Uint8Array rather than
 *  throwing or over-allocating — `faceInfo` on an empty buffer is always "not usable", never a crash or a stall. */
export function extractFace(bytes: Uint8Array, offset: number): Uint8Array {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = u32(dv, offset), numTables = u16(dv, offset + 4);
  if (version === undefined || numTables === undefined || numTables > MAX_TABLES) return new Uint8Array(0);
  const dirEnd = offset + 12 + numTables * 16;
  if (dirEnd > bytes.length) return new Uint8Array(0);
  interface Entry { tag: Uint8Array; srcOffset: number; length: number }
  const entries: Entry[] = [];
  let totalLength = 0;
  for (let i = 0; i < numTables; i++) {
    const rec = offset + 12 + i * 16;
    const srcOffset = u32(dv, rec + 8), length = u32(dv, rec + 12);
    if (srcOffset === undefined || length === undefined) return new Uint8Array(0);
    if (srcOffset < 0 || length < 0 || srcOffset + length > bytes.length) return new Uint8Array(0);
    totalLength += length;
    entries.push({ tag: bytes.slice(rec, rec + 4), srcOffset, length });
  }
  if (totalLength > bytes.length) return new Uint8Array(0);
  let bodyLen = 12 + numTables * 16;
  const laidOut = entries.map((e) => {
    const start = bodyLen;
    bodyLen += e.length + ((4 - (e.length % 4)) % 4);
    return { ...e, start };
  });
  const out = new Uint8Array(bodyLen);
  const outDv = new DataView(out.buffer);
  outDv.setUint32(0, version);
  outDv.setUint16(4, numTables);
  laidOut.forEach((e, i) => {
    const rec = 12 + i * 16;
    out.set(e.tag, rec);
    outDv.setUint32(rec + 4, 0); // checksum: never read by anything this file (or jsPDF's TTF subsetter) checks
    outDv.setUint32(rec + 8, e.start);
    outDv.setUint32(rec + 12, e.length);
    out.set(bytes.subarray(e.srcOffset, e.srcOffset + e.length), e.start);
  });
  return out;
}

const REQUIRED_TABLES = ['glyf', 'loca', 'head', 'hhea', 'hmtx', 'maxp', 'post', 'name', 'cmap'];

/** Bounds-checked: a (3,1) format-4 cmap subtable exists (presence only — `cmapCoverage` does the exact-glyph
 *  coverage check later, once a face has already passed this structural test). Every read is checked against
 *  the `cmap` TABLE'S OWN length, not just the overall buffer (Task 7A review m4): an encoding record whose
 *  subtable offset reaches past the end of `cmap` itself would otherwise read into whatever table follows it
 *  in the file, which can coincidentally look like a valid format-4 subtable. Exported for direct testing (a
 *  false positive here needs a hand-built cmap table; reaching it through a full valid font would depend on
 *  the adjacent table's real bytes by chance). */
export function has31Format4Cmap(ttf: Uint8Array, cmap: { offset: number; length: number }): boolean {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const numTables = u16(dv, cmap.offset + 2);
  if (numTables === undefined) return false;
  for (let i = 0; i < numTables; i++) {
    const rec = cmap.offset + 4 + 8 * i;
    if (rec + 8 > cmap.offset + cmap.length) return false; // the encoding record itself would reach past this table
    const pid = u16(dv, rec), eid = u16(dv, rec + 2), subOff = u32(dv, rec + 4);
    if (pid === undefined || eid === undefined || subOff === undefined) return false;
    if (subOff + 2 > cmap.length) continue; // the subtable's format field would reach past this table
    if (pid === 3 && eid === 1) { const fmt = u16(dv, cmap.offset + subOff); if (fmt === 4) return true; }
  }
  return false;
}

/** Bounds-checked lookup of one name record by name id — platform 3 / encoding 1 (Windows, Unicode BMP) only,
 *  decoded as UTF-16BE. A font's `name` table can carry the SAME name id under other platforms too (Macintosh,
 *  platform 1, is 1-byte-per-character); reading the first matching record regardless of platform/encoding would
 *  sometimes grab a Macintosh record and decode its single bytes as 16-bit pairs, corrupting the string (caught
 *  on the real Arial Unicode.ttf on this Mac: "Arial Unicode MS" came back as "䅲楡氠啮楣潤攠䵓"). */
function readName(ttf: Uint8Array, name: { offset: number; length: number }, wantId: number): string | null {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const count = u16(dv, name.offset + 2), stringOffset = u16(dv, name.offset + 4);
  if (count === undefined || stringOffset === undefined) return null;
  for (let i = 0; i < count; i++) {
    const rec = name.offset + 6 + 12 * i;
    const platformId = u16(dv, rec), encodingId = u16(dv, rec + 2), nameId = u16(dv, rec + 6);
    const length = u16(dv, rec + 8), off = u16(dv, rec + 10);
    if (platformId === undefined || encodingId === undefined || nameId === undefined || length === undefined || off === undefined) return null;
    if (nameId !== wantId || platformId !== 3 || encodingId !== 1) continue;
    const start = name.offset + stringOffset + off, end = start + length;
    if (start < 0 || end > ttf.length || length % 2 !== 0) continue;
    let s = '';
    for (let p = start; p < end; p += 2) { const u = u16(dv, p); if (u === undefined) return s || null; s += String.fromCharCode(u); }
    if (s) return s;
  }
  return null;
}

/** `trueType`: TrueType-outline sfnt version AND every table jsPDF's own TTF embedder needs AND a (3,1) format-4
 *  cmap. `embeddable`: OS/2 present and at least 10 bytes long (m4 — otherwise the `fsType` read would take
 *  bytes from whatever table happens to follow), not licence-restricted (`fsType` bits 0-3 != 2), not
 *  bitmap-only (bit 9), and not marked "no subsetting" (bit 8 — Task 7A review I5: jsPDF always subsets a TTF
 *  it embeds, so a face whose own licence forbids that must be refused even though the brief's `!= 2` rule
 *  alone would have allowed it). `name`: the full font name (id 4), else the family name (id 1), else "". Never
 *  throws: every read it needs is bounds-checked, and a directory it cannot read safely just makes every field
 *  its "not usable" default. */
export function faceInfo(ttf: Uint8Array): { trueType: boolean; embeddable: boolean; name: string } {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const version = u32(dv, 0);
  const dir = tableDirAt(ttf, 0);
  const versionOk = version === 0x00010000 || version === 0x74727565; // 'true'
  let trueType = false;
  if (versionOk && dir) {
    const cmap = dir.get('cmap');
    trueType = REQUIRED_TABLES.every((t) => dir.has(t)) && !!cmap && has31Format4Cmap(ttf, cmap);
  }
  let embeddable = false;
  const os2 = dir?.get('OS/2');
  if (os2 && os2.length >= 10) {
    const fsType = u16(dv, os2.offset + 8);
    if (fsType !== undefined) embeddable = (fsType & 0x000f) !== 0x0002 && (fsType & 0x0200) === 0 && (fsType & 0x0100) === 0;
  }
  const nameTable = dir?.get('name');
  const name = (nameTable && readName(ttf, nameTable, 4)) || (nameTable && readName(ttf, nameTable, 1)) || '';
  return { trueType, embeddable, name };
}

/** The first face in `file` that is TrueType, embeddable and maps every code point in `needed` (exact glyph
 *  lookup); if none maps all of them, the face mapping the MOST of them (as long as it maps at least one — a
 *  face mapping none of what is needed is not usable, same as no face at all). `null` when nothing in the file
 *  qualifies. A face that passes the structural `faceInfo` check but still has a cmap `cmapCoverage` cannot parse
 *  (malformed past what the lighter structural check catches) is skipped, never thrown past this function. */
export function pickFace(file: Uint8Array, needed: number[]): { ttf: Uint8Array; name: string; has: Printable } | null {
  let best: { ttf: Uint8Array; name: string; has: Printable; score: number } | null = null;
  for (const offset of sfntFaces(file)) {
    // Task 7A review I1: `glyphOf`/`has()` are now total (never throw — see `cmapCoverage` in pdfText.ts), but
    // this whole block is ALSO wrapped in try/continue as belt-and-suspenders: a face that is malformed in some
    // way neither `extractFace` nor `faceInfo`'s own bounds-checked reads happen to catch must still never stop
    // this function from trying the next face, let alone the next FILE in `loadSystemFont`.
    try {
      const ttf = extractFace(file, offset);
      if (ttf.length === 0) continue;
      const info = faceInfo(ttf);
      if (!info.trueType || !info.embeddable) continue;
      const has = cmapCoverage(ttf);
      const score = needed.filter((c) => has(c)).length;
      if (score === needed.length) return { ttf, name: info.name, has };
      if (score > 0 && (!best || score > best.score)) best = { ttf, name: info.name, has, score };
    } catch { continue; }
  }
  return best ? { ttf: best.ttf, name: best.name, has: best.has } : null;
}

type Ipc = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>;

function toBytes(v: unknown): Uint8Array {
  if (v instanceof Uint8Array) return v;
  if (v instanceof ArrayBuffer) return new Uint8Array(v);
  if (Array.isArray(v)) return new Uint8Array(v as number[]);
  throw new Error('unexpected system_font_read response shape');
}

/** Searches this computer's own fonts (Rust `system_font_list`/`system_font_read`) for one that can print every
 *  code point in `needed`, trying each script's own list (Hangul → ko first, kana → ja first, else zh first),
 *  then the other two. A list that comes back not-an-array (the e2e smoke stub answers `null` — Task 9) or a read
 *  that throws both count as "nothing usable here" and move on to the next file/script; this function itself
 *  never throws. */
export async function loadSystemFont(
  needed: number[],
  ipc: Ipc = invoke as Ipc,
): Promise<{ ttf: Uint8Array; name: string; has: Printable; file: string } | null> {
  const letters = needed.map((c) => String.fromCodePoint(c));
  for (const script of scriptOrder(letters)) {
    let files: unknown;
    try { files = await ipc('system_font_list', { script }); } catch { continue; }
    if (!Array.isArray(files)) continue;
    for (const file of files as string[]) {
      let bytes: Uint8Array;
      try { bytes = toBytes(await ipc('system_font_read', { script, path: file })); } catch { continue; }
      // Task 7A review I1: `pickFace` should never throw now, but this call is wrapped too — a hostile font
      // must never stop the search from reaching a later, good file.
      let picked: ReturnType<typeof pickFace>;
      try { picked = pickFace(bytes, needed); } catch { continue; }
      if (picked) return { ...picked, file };
    }
  }
  return null;
}

export type SysFont = Awaited<ReturnType<typeof loadSystemFont>>;

/** Searches once per distinct `need` set, cached for the session (preflight-rulings Task 9 carry-over (b)): the
 *  font file on this computer does not change while the app runs, so re-building the report model with the SAME
 *  set of CJK code points (every re-render while the preview stays open, or the next save) must not re-run the
 *  Rust round trip `loadSystemFont` makes. The key is content-based (sorted, deduplicated), not the array's
 *  identity, so two different `need` ARRAY instances carrying the same code points share one search — and share
 *  its in-flight promise too, so two near-simultaneous callers never start two searches for the same set.
 *  Exported standalone (rather than inlined in `useReport`) so the "once per set" promise can be verified with a
 *  plain call-counter, independent of React's render timing (there is no jsdom in this repo to mount a hook). */
export function cachedCjkSearch(
  cache: Map<string, Promise<SysFont>>,
  need: number[],
  search: (need: number[]) => Promise<SysFont> = loadSystemFont,
): Promise<SysFont> {
  const key = [...new Set(need)].sort((a, b) => a - b).join(',');
  let p = cache.get(key);
  if (!p) { p = search(need); cache.set(key, p); }
  return p;
}
