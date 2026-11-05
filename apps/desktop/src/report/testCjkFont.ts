// Tests only (preflight-rulings Task 7A): builds synthetic "system CJK font" fixtures in memory from the committed
// Noto Sans Regular — no new font file is ever added to the repo. Deliberately does its own minimal sfnt table
// read/write here rather than reusing `systemFont.ts` (which only READS an sfnt; it has no writer, and does not
// need one in production).
import { testFonts } from './testFonts';

interface TableEntry { tag: string; data: Uint8Array }

function tag4(s: string): number[] { return [...s.padEnd(4, ' ')].map((c) => c.charCodeAt(0) & 0xff); }

/** Reads a single-face sfnt's table directory (bounds are not an issue here: every input comes from either the
 *  committed Noto Regular or this file's own writer, never an untrusted file). */
function readTableDir(ttf: Uint8Array): { version: number; tables: TableEntry[] } {
  const dv = new DataView(ttf.buffer, ttf.byteOffset, ttf.byteLength);
  const version = dv.getUint32(0), numTables = dv.getUint16(4);
  const tables: TableEntry[] = [];
  for (let i = 0; i < numTables; i++) {
    const rec = 12 + i * 16;
    const t = String.fromCharCode(...ttf.subarray(rec, rec + 4));
    const offset = dv.getUint32(rec + 8), length = dv.getUint32(rec + 12);
    tables.push({ tag: t, data: ttf.slice(offset, offset + length) });
  }
  return { version, tables };
}

/** Writes a fresh single-face sfnt from a table list (checksums are zeroed: jsPDF's own TTF subsetter recomputes
 *  them when it writes its output font and never checks the input values — confirmed in jspdf.es.js's `Directory`
 *  constructor, which reads but never compares `checksum`; our own `systemFont.ts` readers do not check it either). */
export function sfnt(version: number, tables: TableEntry[], keepOrder = false): Uint8Array {
  const sorted = keepOrder ? [...tables] : [...tables].sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  const dirLen = 12 + sorted.length * 16;
  let pos = dirLen;
  const laidOut = sorted.map((t) => {
    const start = pos;
    pos += t.data.length + ((4 - (t.data.length % 4)) % 4);
    return { ...t, start };
  });
  const out = new Uint8Array(pos);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, version);
  dv.setUint16(4, sorted.length);
  const entrySelector = sorted.length > 0 ? Math.floor(Math.log2(sorted.length)) : 0;
  const searchRange = (1 << entrySelector) * 16;
  dv.setUint16(6, searchRange); dv.setUint16(8, entrySelector); dv.setUint16(10, sorted.length * 16 - searchRange);
  laidOut.forEach((t, i) => {
    const rec = 12 + i * 16;
    out.set(tag4(t.tag), rec);
    dv.setUint32(rec + 4, 0);
    dv.setUint32(rec + 8, t.start);
    dv.setUint32(rec + 12, t.data.length);
    out.set(t.data, t.start);
  });
  return out;
}

/** Replaces (or adds) one table by tag, keeping every other table unchanged. */
export function withTable(ttf: Uint8Array, replaceTag: string, data: Uint8Array): Uint8Array {
  const { version, tables } = readTableDir(ttf);
  return sfnt(version, [...tables.filter((t) => t.tag !== replaceTag), { tag: replaceTag, data }]);
}

/** Removes a table outright (used for "no OS/2 table at all" — a face `faceInfo` must refuse as not embeddable). */
export function withoutTable(ttf: Uint8Array, removeTag: string): Uint8Array {
  const { version, tables } = readTableDir(ttf);
  return sfnt(version, tables.filter((t) => t.tag !== removeTag));
}

/** The exact-glyph lookup this file needs for its own purposes (which existing Latin glyph a code point already
 *  has in the real Noto Regular) — duplicated in miniature rather than imported from `pdfText.ts`'s `cmapCoverage`,
 *  which only answers "is this printable", never "which glyph id". Trusts the input (Noto Regular, known-good). */
function glyphIdOf(ttf: Uint8Array, codePoint: number): number {
  const { tables } = readTableDir(ttf);
  const cmap = tables.find((t) => t.tag === 'cmap');
  if (!cmap) return 0;
  const dv = new DataView(cmap.data.buffer, cmap.data.byteOffset, cmap.data.byteLength);
  const numTables = dv.getUint16(2);
  let subOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = 4 + 8 * i;
    if (dv.getUint16(rec) === 3 && dv.getUint16(rec + 2) === 1) subOff = dv.getUint32(rec + 4);
  }
  if (subOff < 0 || dv.getUint16(subOff) !== 4) return 0;
  const segX2 = dv.getUint16(subOff + 6), segCount = segX2 / 2;
  const endOff = subOff + 14, startOff = endOff + segX2 + 2, deltaOff = startOff + segX2, rangeOff = deltaOff + segX2;
  for (let k = 0; k < segCount; k++) {
    const end = dv.getUint16(endOff + k * 2);
    if (codePoint > end) continue;
    const start = dv.getUint16(startOff + k * 2);
    if (codePoint < start) return 0;
    const idDelta = dv.getInt16(deltaOff + k * 2), idRangeOffset = dv.getUint16(rangeOff + k * 2);
    if (idRangeOffset === 0) return (codePoint + idDelta) & 0xffff;
    const g = dv.getUint16(rangeOff + k * 2 + idRangeOffset + 2 * (codePoint - start));
    return g === 0 ? 0 : (g + idDelta) & 0xffff;
  }
  return 0;
}

/** One format-4 subtable, one segment per code point (idRangeOffset 0, plain idDelta arithmetic) plus the
 *  required 0xFFFF terminator segment — always a "no holes" table (every point in `pairs` genuinely has that
 *  glyph; there is no separate range vs. exact-glyph distinction to create here). */
function format4Sparse(pairs: [number, number][]): Uint8Array {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const segCount = sorted.length + 1;
  const endCodes = [...sorted.map(([c]) => c), 0xffff];
  const startCodes = [...sorted.map(([c]) => c), 0xffff];
  const idDeltas = [...sorted.map(([c, g]) => (g - c) & 0xffff), 1];
  const segCountX2 = segCount * 2;
  const entrySelector = Math.floor(Math.log2(segCount)), searchRange = (1 << entrySelector) * 2;
  const headerLen = 14 + segCountX2 * 4 + 2;
  const out = new Uint8Array(headerLen);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 4); dv.setUint16(2, out.length); dv.setUint16(4, 0);
  dv.setUint16(6, segCountX2); dv.setUint16(8, searchRange); dv.setUint16(10, entrySelector); dv.setUint16(12, segCountX2 - searchRange);
  let p = 14;
  endCodes.forEach((c) => { dv.setUint16(p, c); p += 2; });
  p += 2; // reservedPad
  startCodes.forEach((c) => { dv.setUint16(p, c); p += 2; });
  idDeltas.forEach((d) => { dv.setUint16(p, d); p += 2; });
  sorted.forEach(() => { dv.setUint16(p, 0); p += 2; });
  dv.setUint16(p, 0); // terminator segment's idRangeOffset
  return out;
}

/** One format-4 subtable, a single [start,end] range using an idRangeOffset glyph array (glyph ids
 *  `glyphBase + (c - start)`), except every code point in `holes`, which is written as glyph 0 (.notdef) inside
 *  that same array — Task 7's review: a whole-segment "is this range covered" check cannot tell this apart from
 *  full coverage; only an exact per-glyph lookup can. Exported for `pdfText.test.ts`'s positive control. */
export function format4Hole(start: number, end: number, glyphBase: number, holes: number[]): Uint8Array {
  const segCount = 2; // the range, then the required 0xFFFF terminator
  const glyphCount = end - start + 1;
  const glyphIds = Array.from({ length: glyphCount }, (_, i) => (holes.includes(start + i) ? 0 : glyphBase + i));
  const segCountX2 = segCount * 2;
  const entrySelector = Math.floor(Math.log2(segCount)), searchRange = (1 << entrySelector) * 2;
  const headerLen = 16 + 8 * segCount; // 14 (fixed header) + 2 (reservedPad) + 4 arrays of segCount uint16
  const out = new Uint8Array(headerLen + glyphIds.length * 2);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 4); dv.setUint16(2, out.length); dv.setUint16(4, 0);
  dv.setUint16(6, segCountX2); dv.setUint16(8, searchRange); dv.setUint16(10, entrySelector); dv.setUint16(12, segCountX2 - searchRange);
  let p = 14;
  dv.setUint16(p, end); p += 2; dv.setUint16(p, 0xffff); p += 2; // endCode[2]
  p += 2; // reservedPad
  dv.setUint16(p, start); p += 2; dv.setUint16(p, 0xffff); p += 2; // startCode[2]
  dv.setUint16(p, 0); p += 2; dv.setUint16(p, 1); p += 2; // idDelta[2] (segment 0 unused when idRangeOffset != 0)
  dv.setUint16(p, 2 * segCount); p += 2; dv.setUint16(p, 0); p += 2; // idRangeOffset[2]
  glyphIds.forEach((g) => { dv.setUint16(p, g); p += 2; });
  return out;
}

/** Wraps a single format-4 subtable as a complete (3,1) `cmap` table (header + one encoding record). */
export function cmapTable(format4: Uint8Array): Uint8Array {
  const out = new Uint8Array(4 + 8 + format4.length);
  const dv = new DataView(out.buffer);
  dv.setUint16(0, 0); dv.setUint16(2, 1); // version 0, 1 encoding record
  dv.setUint16(4, 3); dv.setUint16(6, 1); dv.setUint32(8, 12); // platform 3 (Windows), encoding 1 (Unicode BMP)
  out.set(format4, 12);
  return out;
}

/** Task 7A review P4/I1: a face whose `cmap` carries the original (3,1) format-4 table (so `faceInfo` still sees
 *  it as a normal, usable TrueType face) PLUS a second, (3,10) format-12 encoding record whose subtable claims
 *  `nGroups = 0xFFFFFFFF` — the hostile shape the reviewer's fuzz probe P4 used to make the pre-fix `glyphOf`'s
 *  format-12 loop run off the end of the buffer and throw past `pickFace`/`loadSystemFont`. */
export function hostileFormat12Font(valid: Uint8Array): Uint8Array {
  const { version, tables } = readTableDir(valid);
  const oldCmap = tables.find((t) => t.tag === 'cmap')!.data;
  const format4 = oldCmap.slice(12); // `cmapTable()` always writes a 4-byte header + one 8-byte encoding record first
  const newHeaderLen = 4 + 16; // version/numTables(4) + TWO 8-byte encoding records
  const format12Offset = newHeaderLen + format4.length;
  const hostileCmap = new Uint8Array(format12Offset + 16); // the format-12 header is this table's own last 16 bytes
  const cdv = new DataView(hostileCmap.buffer);
  cdv.setUint16(0, 0); cdv.setUint16(2, 2); // version 0, 2 encoding records
  cdv.setUint16(4, 3); cdv.setUint16(6, 1); cdv.setUint32(8, newHeaderLen); // record 0: (3,1) -> the real format-4 subtable
  cdv.setUint16(12, 3); cdv.setUint16(14, 10); cdv.setUint32(16, format12Offset); // record 1: (3,10) -> the hostile header
  hostileCmap.set(format4, newHeaderLen);
  cdv.setUint16(format12Offset, 12); cdv.setUint16(format12Offset + 2, 0); // format 12, reserved
  cdv.setUint32(format12Offset + 4, 16); cdv.setUint32(format12Offset + 8, 0); // length (lies), language
  cdv.setUint32(format12Offset + 12, 0xffffffff); // nGroups — the hostile value
  // Force `cmap` to be the LAST table physically (sfnt()'s default alphabetical order would put several large
  // tables after it — glyf, head, hhea, …), so the hostile header really does sit in the last 16 bytes of the
  // WHOLE FACE, with nothing real after it that could accidentally satisfy a garbage lo/hi comparison before the
  // pre-fix loop ran off the buffer end (that is exactly what happened on the first attempt at this fixture).
  const others = tables.filter((t) => t.tag !== 'cmap').sort((a, b) => (a.tag < b.tag ? -1 : a.tag > b.tag ? 1 : 0));
  return sfnt(version, [...others, { tag: 'cmap', data: hostileCmap }], true);
}

/** A minimal format-0 `name` table carrying only name ids 1 (family) and 4 (full name), platform 3 / encoding 1 /
 *  language 0x409 (en-US) — the only combination `jspdf.es.js`'s `NameTable` and this plan's own `faceInfo` read. */
function buildNameTable(name: string): Uint8Array {
  const units = [...name].map((c) => c.codePointAt(0)!);
  const bytes: number[] = [];
  for (const c of units) bytes.push((c >> 8) & 0xff, c & 0xff);
  const ids = [1, 4];
  const header = new Uint8Array(6 + ids.length * 12);
  const dv = new DataView(header.buffer);
  dv.setUint16(0, 0); dv.setUint16(2, ids.length); dv.setUint16(4, header.length);
  ids.forEach((id, i) => {
    const rec = 6 + i * 12;
    dv.setUint16(rec, 3); dv.setUint16(rec + 2, 1); dv.setUint16(rec + 4, 0x409); dv.setUint16(rec + 6, id);
    dv.setUint16(rec + 8, bytes.length); dv.setUint16(rec + 10, 0);
  });
  const out = new Uint8Array(header.length + bytes.length);
  out.set(header, 0); out.set(bytes, header.length);
  return out;
}

/** Noto Sans Regular with its `cmap` replaced by one (3,1) format-4 table mapping printable ASCII (so plain
 *  "SYNTHETIC" text keeps working) plus every `map` entry's code point to the EXISTING glyph of the named Latin
 *  letter already in Noto — so `glyf`/`loca`/`hmtx` never need to change and the result stays a fully valid,
 *  jsPDF-embeddable TrueType font. `name` becomes "SYNTHETIC CJK". Example: `cjkTestFont({ '李': 'L', '明': 'M' })`. */
export async function cjkTestFont(map: Record<string, string>): Promise<Uint8Array> {
  const { regular } = await testFonts();
  const pairs: [number, number][] = [];
  for (let c = 0x20; c <= 0x7e; c++) { const g = glyphIdOf(regular, c); if (g) pairs.push([c, g]); }
  for (const [ch, letter] of Object.entries(map)) {
    const g = glyphIdOf(regular, letter.codePointAt(0)!);
    if (g) pairs.push([ch.codePointAt(0)!, g]);
  }
  const withCmap = withTable(regular, 'cmap', cmapTable(format4Sparse(pairs)));
  return withTable(withCmap, 'name', buildNameTable('SYNTHETIC CJK'));
}

/** Patches only the OS/2 table's `fsType` field (offset 8), leaving every other byte (and every other table)
 *  unchanged — used to test the embedding-licence rule (`fsType` 2 = restricted, 8/0 = allowed). */
export function withFsType(ttf: Uint8Array, fsType: number): Uint8Array {
  const { tables } = readTableDir(ttf);
  const os2 = tables.find((t) => t.tag === 'OS/2');
  if (!os2) return ttf.slice();
  const data = os2.data.slice();
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint16(8, fsType);
  return withTable(ttf, 'OS/2', data);
}

/** A face with no OS/2 table at all (AppleGothic/AppleMyungjo, preflight-rulings Task 7A) — `faceInfo` must treat
 *  this as not embeddable, the same as a restricted `fsType`. */
export const withoutOS2 = (ttf: Uint8Array): Uint8Array => withoutTable(ttf, 'OS/2');

/** A CFF-outline face masquerading with a TrueType-looking table set otherwise: `sfnt` version becomes `OTTO` and
 *  the `glyf` table is renamed to `CFF ` — both independently enough to fail `faceInfo`'s `trueType` check, as a
 *  real Hiragino/PingFang/Apple SD Gothic Neo collection does (preflight-rulings Task 7A design fact). */
export function asCff(ttf: Uint8Array): Uint8Array {
  const { tables } = readTableDir(ttf);
  const renamed = tables.map((t) => (t.tag === 'glyf' ? { tag: 'CFF ', data: t.data } : t));
  return sfnt(0x4f54544f, renamed); // 'OTTO'
}

/** Wraps one or more single-face sfnts into one `ttcf` collection, in the given order — `sfntFaces` must return
 *  every face's offset, in that order. */
export function toTtc(faces: Uint8Array[]): Uint8Array {
  const headerLen = 12 + faces.length * 4;
  let pos = headerLen;
  const laidOut = faces.map((f) => {
    const start = pos;
    pos += f.length + ((4 - (f.length % 4)) % 4);
    return { data: f, start };
  });
  const out = new Uint8Array(pos);
  const dv = new DataView(out.buffer);
  out.set([0x74, 0x74, 0x63, 0x66], 0); // 'ttcf'
  dv.setUint16(4, 1); dv.setUint16(6, 0);
  dv.setUint32(8, faces.length);
  laidOut.forEach((f, i) => {
    dv.setUint32(12 + i * 4, f.start);
    // A real ttcf's per-face table-directory offsets are always absolute into the WHOLE file (that is how faces
    // can share tables). Each `f.data` here was built as an independent standalone sfnt whose own table offsets
    // are relative to ITS OWN start at 0, so they must be shifted by `f.start` before this face is placed here.
    const face = f.data.slice();
    const fdv = new DataView(face.buffer, face.byteOffset, face.byteLength);
    const numTables = fdv.getUint16(4);
    for (let t = 0; t < numTables; t++) {
      const rec = 12 + t * 16;
      fdv.setUint32(rec + 8, fdv.getUint32(rec + 8) + f.start);
    }
    out.set(face, f.start);
  });
  return out;
}
