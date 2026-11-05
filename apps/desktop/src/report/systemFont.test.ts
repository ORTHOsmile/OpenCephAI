import { describe, it, expect } from 'vitest';
import { isCjk, scriptOrder, sfntFaces, extractFace, faceInfo, pickFace, loadSystemFont, has31Format4Cmap, cachedCjkSearch, type SysFont } from './systemFont';
import { cjkTestFont, withFsType, withoutOS2, asCff, toTtc, withTable, hostileFormat12Font, sfnt } from './testCjkFont';

const CP = (s: string) => s.codePointAt(0)!;

describe('isCjk (BMP-only, preflight-rulings Task 7A)', () => {
  it('李 明 あ 한 are CJK', () => { for (const c of '李明あ한') expect(isCjk(CP(c))).toBe(true); });
  it('Latin, Arabic, Hebrew, Devanagari and Thai are not', () => { for (const c of 'Aاבarea้') expect(isCjk(CP(c))).toBe(false); });
  it('a letter beyond the BMP is not CJK here (jsPDF text encoding is not reliable for it)', () => {
    expect(isCjk(0x20123)).toBe(false); // an arbitrary supplementary-plane CJK ideograph
  });
});

describe('scriptOrder', () => {
  it('李明: Chinese first, then Japanese, then Korean', () => { expect(scriptOrder('李明')).toEqual(['zh', 'ja', 'ko']); });
  it('あ: Japanese first', () => { expect(scriptOrder('あ')).toEqual(['ja', 'zh', 'ko']); });
  it('한: Korean first', () => { expect(scriptOrder('한')).toEqual(['ko', 'zh', 'ja']); });
  // Task 7A review m7: HANGUL/KANA missed half-width katakana (FF66-FF9F), the katakana phonetic extension
  // (31F0-31FF), Hangul compatibility jamo (3130-318F) and the Hangul jamo extended-A block (A960-A97F).
  it('half-width katakana (FF66-FF9F) still puts Japanese first', () => { expect(scriptOrder('ｶ')).toEqual(['ja', 'zh', 'ko']); }); // half-width カ
  it('the katakana phonetic extension (31F0-31FF) still puts Japanese first', () => { expect(scriptOrder('ㇰ')).toEqual(['ja', 'zh', 'ko']); });
  it('Hangul compatibility jamo (3130-318F) still puts Korean first', () => { expect(scriptOrder('ㄱ')).toEqual(['ko', 'zh', 'ja']); }); // ㄱ
  it('the Hangul jamo extended-A block (A960-A97F) still puts Korean first', () => { expect(scriptOrder('ꥠ')).toEqual(['ko', 'zh', 'ja']); });
});

describe('sfntFaces / extractFace — bounds-checked, never throw (Task 7 review m2)', () => {
  it('a single-face sfnt is [0]', async () => {
    const f = await cjkTestFont({});
    expect(sfntFaces(f)).toEqual([0]);
  });
  it('a ttcf collection lists every face offset, in order', async () => {
    const a = await cjkTestFont({ '李': 'L' }), b = await cjkTestFont({ '明': 'M' });
    const ttc = toTtc([a, b]);
    const faces = sfntFaces(ttc);
    expect(faces.length).toBe(2);
    expect(faces[0]).toBeGreaterThanOrEqual(12 + 2 * 4); // the TTC header (12) + its 2-entry offset table
    expect(faces[1]).toBeGreaterThan(faces[0]);
  });
  it('a truncated file (not even a readable header) is []', () => {
    expect(sfntFaces(new Uint8Array(2))).toEqual([]);
  });
  it('a ttcf header whose face count is larger than the file stops early, never throws (positive control: a real count reads correctly)', async () => {
    const f = await cjkTestFont({});
    const real = toTtc([f]);
    expect(sfntFaces(real)).toEqual([16]); // positive control: a correct, readable ttcf lists its one real face (offset = header(12) + 1 offset entry(4))
    // A separate, purpose-built buffer with DISTINCT offset values at every slot (reusing the real font's own
    // tail bytes as "more entries" risked the dedupe fix (I2) collapsing some of them by coincidence, which
    // would conflate "capped" with "deduped" — this isolates the cap on its own).
    const slots = 200;
    const lying = new Uint8Array(12 + slots * 4);
    const dv = new DataView(lying.buffer);
    lying.set([0x74, 0x74, 0x63, 0x66], 0);
    dv.setUint16(4, 1); dv.setUint16(6, 0);
    dv.setUint32(8, 10_000_000); // claims 10M faces; the file only has room for 200 distinct offset entries
    for (let i = 0; i < slots; i++) dv.setUint32(12 + i * 4, i + 1); // every entry a distinct, nonzero offset
    expect(() => sfntFaces(lying)).not.toThrow();
    // Task 7A review I2: capped at MAX_FACES (64) now, not just "whatever the buffer could physically hold" —
    // a real single-face font is hundreds of KB, so the old "maxReadable" bound here was itself in the tens of
    // thousands, which is exactly the uncapped-allocation shape P3a found.
    expect(sfntFaces(lying).length).toBe(64);
    expect(dv.getUint32(8)).toBe(10_000_000); // sanity: the buffer still claims 10M, only the cap bounds the result
  });
  it('duplicate face offsets are dropped (Task 7A review I2)', () => {
    const buf = new Uint8Array(12 + 3 * 4);
    const dv = new DataView(buf.buffer);
    buf.set([0x74, 0x74, 0x63, 0x66], 0); // 'ttcf'
    dv.setUint16(4, 1); dv.setUint16(6, 0);
    dv.setUint32(8, 3); // claims 3 faces
    dv.setUint32(12, 100); dv.setUint32(16, 100); dv.setUint32(20, 200); // two entries point at the same offset
    expect(sfntFaces(buf)).toEqual([100, 200]);
  });
  // Task 7A review I2, fuzz probe P3a: "ttcf with numFonts = 0xFFFFFFFF in 4 MB. Stops at 1,048,573 faces in
  // 10 ms. pickFace takes 334 ms when every entry points at the header… a 100 MB file would hold the webview's
  // JS thread for about 12 minutes." MAX_FACES makes this return almost instantly regardless of the claimed count.
  it('P3a: numFonts = 0xFFFFFFFF never returns more than MAX_FACES, and finishes fast', () => {
    const slots = 1000;
    const buf = new Uint8Array(12 + slots * 4); // plenty of readable 4-byte slots, so the OLD code would not have stopped at the buffer end either
    const dv = new DataView(buf.buffer);
    buf.set([0x74, 0x74, 0x63, 0x66], 0);
    dv.setUint16(4, 1); dv.setUint16(6, 0);
    dv.setUint32(8, 0xffffffff);
    for (let i = 0; i < slots; i++) dv.setUint32(12 + i * 4, i + 1); // distinct offsets, so dedupe (I2) cannot collapse them
    const start = performance.now();
    const faces = sfntFaces(buf);
    expect(performance.now() - start).toBeLessThan(200); // loose time bound — this used to be "10 ms" even uncapped; the real cost was downstream in pickFace
    expect(faces.length).toBe(64);
  });
  // Task 7A review I2, fuzz probe P3b: "1 MB file, numTables = 65535, every entry covering the whole file …
  // extractFace allocates about 68 GB (virtual) and takes 10.9 s." The probe's own 68 GB is not reproduced here
  // (unsafe to allocate even transiently in a test); instead the DIRECTORY is made fully real and readable —
  // every one of the 65535 entries is individually small and in-bounds, so the PRE-EXISTING "directory/entry
  // truncated" checks do not fire on their own — isolating the new MAX_TABLES cap as what refuses it.
  it('P3b: a face with a full, readable 65535-entry directory is still refused outright (capped), fast', () => {
    const numTables = 65535;
    const dirLen = 12 + numTables * 16;
    const buf = new Uint8Array(dirLen + 16); // the whole directory fits; a little slack after it
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x00010000);
    dv.setUint16(4, numTables);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      dv.setUint32(rec + 8, dirLen); dv.setUint32(rec + 12, 1); // every entry individually trivial and in-bounds
    }
    const start = performance.now();
    const face = extractFace(buf, 0);
    expect(performance.now() - start).toBeLessThan(500);
    expect(face.length).toBe(0);
  });
  // Task 7A review I2, fuzz probe P3c: "A 65 KB file with 4,000 entries, each covering the whole file …
  // extractFace allocates 260 MB, a 4,000× amplification." This case sits UNDER MAX_TABLES (60 < 64), so the
  // table-count cap alone would not catch it — the separate "summed table length" refusal does.
  it('P3c: tables within the count cap whose summed lengths exceed the file are refused, no amplified allocation', () => {
    const fileSize = 65536, numTables = 60;
    const buf = new Uint8Array(fileSize);
    const dv = new DataView(buf.buffer);
    dv.setUint32(0, 0x00010000);
    dv.setUint16(4, numTables);
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      dv.setUint32(rec + 8, 0); dv.setUint32(rec + 12, fileSize); // every table claims offset 0, length = the WHOLE file
    }
    const start = performance.now();
    const face = extractFace(buf, 0);
    expect(performance.now() - start).toBeLessThan(200);
    expect(face.length).toBe(0); // 60 * 65536 bytes claimed, far more than the 65536-byte file itself
  });
  it('extractFace on a table offset past the end returns an empty (not usable) buffer, never throws', async () => {
    const f = await cjkTestFont({});
    const dv = new DataView(f.buffer, f.byteOffset, f.byteLength);
    const numTables = dv.getUint16(4);
    const broken = f.slice();
    const bdv = new DataView(broken.buffer);
    bdv.setUint32(12 + 8, 0xfffffff0); // the first table record's offset now points far past EOF
    expect(() => extractFace(broken, 0)).not.toThrow();
    expect(extractFace(broken, 0).length).toBe(0);
    expect(extractFace(f, 0).length).toBeGreaterThan(0); // positive control: the untouched font still extracts fine
    expect(numTables).toBeGreaterThan(0);
  });
  it('extractFace on a truncated table directory returns empty, never throws', async () => {
    const f = await cjkTestFont({});
    expect(() => extractFace(f.slice(0, 20), 0)).not.toThrow();
    expect(extractFace(f.slice(0, 20), 0).length).toBe(0);
  });
});

describe('faceInfo — the embedding-licence and TrueType-outline rules', () => {
  it('Noto Regular itself is trueType and embeddable', async () => {
    const info = faceInfo(await cjkTestFont({}));
    expect(info.trueType).toBe(true);
    expect(info.embeddable).toBe(true);
  });
  it('fsType 2 (restricted) is refused; 8 (editable) and 0 (installable) are accepted', async () => {
    const f = await cjkTestFont({});
    expect(faceInfo(withFsType(f, 2)).embeddable).toBe(false);
    expect(faceInfo(withFsType(f, 8)).embeddable).toBe(true);
    expect(faceInfo(withFsType(f, 0)).embeddable).toBe(true);
  });
  it('bitmap-only (fsType bit 0x0200) is refused even when the licence bits allow it', async () => {
    expect(faceInfo(withFsType(await cjkTestFont({}), 0x0200)).embeddable).toBe(false);
  });
  // Task 7A review I5: jsPDF always subsets a TTF it embeds (`font.metadata.subset.encode(...)`, jspdf.es.js
  // 21896) — a face whose fsType says "no subsetting" (bit 8, 0x0100) would be embedded in a way its own
  // licence forbids even though the brief's `(fsType & 0xF) != 2` rule alone would have allowed it.
  it('fsType bit 0x0100 (no subsetting) is refused, even combined with an otherwise-allowed value', async () => {
    const f = await cjkTestFont({});
    expect(faceInfo(withFsType(f, 0x0100)).embeddable).toBe(false);
    expect(faceInfo(withFsType(f, 0x0108)).embeddable).toBe(false); // 0x08 (editable) | 0x0100 (no subsetting)
  });
  it('no OS/2 table at all is refused (AppleGothic/AppleMyungjo, preflight-rulings Task 7A)', async () => {
    expect(faceInfo(withoutOS2(await cjkTestFont({}))).embeddable).toBe(false);
  });
  // Task 7A review m4: an OS/2 table shorter than 10 bytes (fsType sits at offset 8, 2 bytes) must be refused
  // outright, rather than reading the fsType field from whatever table happens to follow OS/2 in the file.
  it('an OS/2 table shorter than 10 bytes is refused, not read from the next table', async () => {
    const f = await cjkTestFont({});
    const tooShort = withTable(f, 'OS/2', new Uint8Array(8)); // version + xAvgCharWidth + usWeightClass only
    expect(faceInfo(tooShort).embeddable).toBe(false);
  });
  it('a CFF-outline face (OTTO version, glyf renamed CFF ) is not trueType', async () => {
    const info = faceInfo(asCff(await cjkTestFont({})));
    expect(info.trueType).toBe(false);
  });
  it('the name comes from the font file itself', async () => {
    expect(faceInfo(await cjkTestFont({})).name).toBe('SYNTHETIC CJK');
  });
  // Task 7A review m4: an encoding record whose subtable offset reaches PAST the cmap table's own declared
  // length, into the table that physically follows it, must not be read as if it were still part of cmap —
  // even though that read stays safely inside the OVERALL file buffer. Built directly (not through a full
  // font): a 12-byte cmap table whose one record's subOff (12) points exactly at its own end, followed by a
  // second table whose first two bytes happen to spell out format 4.
  it('a cmap subtable offset reaching past the cmap table\'s own length is refused, even though it is a valid format-4 header', () => {
    const cmapData = new Uint8Array(12);
    const cdv = new DataView(cmapData.buffer);
    cdv.setUint16(0, 0); cdv.setUint16(2, 1); // version 0, 1 encoding record
    cdv.setUint16(4, 3); cdv.setUint16(6, 1); cdv.setUint32(8, 12); // (3,1), subOff = 12 == cmap.length (one past the end)
    const trailing = new Uint8Array(4);
    new DataView(trailing.buffer).setUint16(0, 4); // looks exactly like a format-4 header, if read
    const file = sfnt(0x00010000, [{ tag: 'cmap', data: cmapData }, { tag: 'zzzz', data: trailing }]);
    const dv = new DataView(file.buffer);
    const numTables = dv.getUint16(4);
    let cmapOffset = -1;
    for (let i = 0; i < numTables; i++) {
      const rec = 12 + i * 16;
      if (String.fromCharCode(...file.subarray(rec, rec + 4)) === 'cmap') cmapOffset = dv.getUint32(rec + 8);
    }
    expect(cmapOffset).toBeGreaterThan(0);
    expect(has31Format4Cmap(file, { offset: cmapOffset, length: 12 })).toBe(false);
  });
  // Regression (found live on this Mac's real Arial Unicode.ttf, 18 Oct 2026): a `name` table can carry the SAME
  // name id under the Macintosh platform (1 byte per character) as well as Windows (2 bytes, UTF-16BE). Reading
  // whichever record comes first without checking platform/encoding decoded "Arial Unicode MS" as "䅲楡氠啮楣潤攠䵓"
  // — every byte pair of the 1-byte-per-char Macintosh record misread as one 16-bit UTF-16BE code unit.
  it('a Macintosh-platform name record ahead of the Windows one is not read as UTF-16BE (regression)', async () => {
    const f = await cjkTestFont({});
    const macBytes = [...'BAD MAC NAME'].map((c) => c.charCodeAt(0));
    const header = new Uint8Array(6 + 2 * 12);
    const dv = new DataView(header.buffer);
    dv.setUint16(0, 0); dv.setUint16(2, 2); dv.setUint16(4, header.length);
    // Record 0: Macintosh (platform 1, encoding 0), nameID 4, 1 byte per character — must be SKIPPED.
    dv.setUint16(6, 1); dv.setUint16(8, 0); dv.setUint16(10, 0); dv.setUint16(12, 4); dv.setUint16(14, macBytes.length); dv.setUint16(16, 0);
    // Record 1: Windows (platform 3, encoding 1), nameID 4, UTF-16BE — the one that must win.
    const winText = 'GOOD WIN NAME', winBytes: number[] = [];
    for (const c of winText) { const cp = c.codePointAt(0)!; winBytes.push((cp >> 8) & 0xff, cp & 0xff); }
    dv.setUint16(18, 3); dv.setUint16(20, 1); dv.setUint16(22, 0x409); dv.setUint16(24, 4);
    dv.setUint16(26, winBytes.length); dv.setUint16(28, macBytes.length);
    const nameTable = new Uint8Array(header.length + macBytes.length + winBytes.length);
    nameTable.set(header, 0); nameTable.set(macBytes, header.length); nameTable.set(winBytes, header.length + macBytes.length);
    const withBoth = withTable(f, 'name', nameTable);
    expect(faceInfo(withBoth).name).toBe(winText);
  });
});

describe('pickFace', () => {
  it('a TTC [CFF face, TrueType face] takes the second (usable) face', async () => {
    const good = await cjkTestFont({ '李': 'L', '明': 'M' });
    const ttc = toTtc([asCff(good), good]);
    const picked = pickFace(ttc, [CP('李'), CP('明')]);
    expect(picked).not.toBeNull();
    expect(picked!.name).toBe('SYNTHETIC CJK');
    expect([...'李明'].every((c) => picked!.has(CP(c)))).toBe(true);
  });
  it('a TTC with only a CFF face is null (positive control)', async () => {
    const good = await cjkTestFont({ '李': 'L' });
    expect(pickFace(toTtc([asCff(good)]), [CP('李')])).toBeNull();
  });
  it('a needed letter the font lacks entirely (龍) is not picked', async () => {
    const f = await cjkTestFont({ '李': 'L' }); // maps 李 but never 龍
    expect(pickFace(f, [CP('龍')])).toBeNull();
  });
  it('a face mapping only some of what is needed is still returned as the best partial match', async () => {
    const f = await cjkTestFont({ '李': 'L' }); // 明 is not mapped
    const picked = pickFace(f, [CP('李'), CP('明')]);
    expect(picked).not.toBeNull();
    expect(picked!.has(CP('李'))).toBe(true);
    expect(picked!.has(CP('明'))).toBe(false);
  });
});

describe('loadSystemFont (fake ipc — the real command round-trip is Rust-tested in system_font.rs)', () => {
  it('a list that is not an array (the e2e smoke stub answers null) counts as nothing here', async () => {
    const result = await loadSystemFont([CP('李')], async (cmd) => (cmd === 'system_font_list' ? null : new Uint8Array()));
    expect(result).toBeNull();
  });
  it('the first file is CFF-only, the second is good: the second is used', async () => {
    const good = await cjkTestFont({ '李': 'L' }), cff = asCff(good);
    const files: Record<string, Uint8Array> = { 'bad.ttc': cff, 'good.ttf': good };
    const result = await loadSystemFont([CP('李')], async (cmd, args) => {
      if (cmd === 'system_font_list') return Object.keys(files);
      return files[(args as { path: string }).path];
    });
    expect(result?.file).toBe('good.ttf');
    expect(result?.has(CP('李'))).toBe(true);
  });
  it('a read that throws moves on to the next file', async () => {
    const good = await cjkTestFont({ '李': 'L' });
    const result = await loadSystemFont([CP('李')], async (cmd, args) => {
      if (cmd === 'system_font_list') return ['throws.ttf', 'good.ttf'];
      if ((args as { path: string }).path === 'throws.ttf') throw new Error('read failed');
      return good;
    });
    expect(result?.file).toBe('good.ttf');
  });
  it('no usable font anywhere: null', async () => {
    const result = await loadSystemFont([CP('李')], async (cmd) => (cmd === 'system_font_list' ? [] : new Uint8Array()));
    expect(result).toBeNull();
  });

  // Task 7A review I1/P4: a face that passes faceInfo (trueType/embeddable) but whose cmap has a (3,10)
  // format-12 subtable lying about nGroups must never throw past pickFace OR loadSystemFont — the committed
  // form of the reviewer's fuzz probe P4, which found `pickFace` throwing a RangeError and `loadSystemFont`
  // rejecting instead of trying the next file.
  it('a hostile font followed by a good one: the hostile one never throws, the good one is used', async () => {
    const good = await cjkTestFont({ '李': 'L' });
    const hostile = hostileFormat12Font(good);
    // faceInfo on the hostile font alone still reports a normal, usable face (the attack is in has(), not faceInfo).
    const info = faceInfo(hostile);
    expect(info.trueType).toBe(true);
    expect(info.embeddable).toBe(true);
    // pickFace on the hostile font ALONE must not throw, and (since its format-12 subtable never actually maps
    // anything real) must find no usable face rather than crash.
    expect(() => pickFace(hostile, [CP('李')])).not.toThrow();
    const files: Record<string, Uint8Array> = { 'hostile.ttf': hostile, 'good.ttf': good };
    const result = await loadSystemFont([CP('李')], async (cmd, args) => {
      if (cmd === 'system_font_list') return Object.keys(files);
      return files[(args as { path: string }).path];
    });
    expect(result?.file).toBe('good.ttf');
    expect(result?.has(CP('李'))).toBe(true);
  });
});

describe('cachedCjkSearch (preflight-rulings Task 9 carry-over (b)): search once per distinct set, cached for the session', () => {
  const CP = (s: string) => s.codePointAt(0)!;
  const fakeFont = (): SysFont => ({ ttf: new Uint8Array(), name: 'SYNTHETIC', has: () => true, file: 'x.ttf' });

  it('two requests for the same code points (different array instances, different order) search only once', async () => {
    let calls = 0;
    const cache = new Map<string, Promise<SysFont>>();
    const search = async () => { calls++; return fakeFont(); };
    const a = await cachedCjkSearch(cache, [CP('李'), CP('明')], search);
    const b = await cachedCjkSearch(cache, [CP('明'), CP('李')], search);   // same set, reversed, fresh array
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it('two near-simultaneous requests for the same set share one in-flight search (not two races)', async () => {
    let calls = 0;
    const cache = new Map<string, Promise<SysFont>>();
    const search = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return fakeFont(); };
    const [a, b] = await Promise.all([cachedCjkSearch(cache, [CP('あ')], search), cachedCjkSearch(cache, [CP('あ')], search)]);
    expect(calls).toBe(1);
    expect(a).toBe(b);
  });

  it('positive control: a different set searches again (the cache key is not ignoring content)', async () => {
    let calls = 0;
    const cache = new Map<string, Promise<SysFont>>();
    const search = async () => { calls++; return null; };
    await cachedCjkSearch(cache, [CP('李')], search);
    await cachedCjkSearch(cache, [CP('한')], search);
    expect(calls).toBe(2);
  });
});
