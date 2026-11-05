import { describe, it, expect } from 'vitest';
import { cmapCoverage, latin1, pdfSafe, printPlan, printProblems, unprintable, type PrintFonts } from './pdfText';
import { testFonts } from './testFonts';
import { cjkTestFont, cmapTable, format4Hole, sfnt } from './testCjkFont';
import { FOOTER } from './model';

// preflight-rulings Task 7: testFonts is async (Vite's `?inline` returns a URL path, not a data URL, under this
// Vite/Vitest combination), so read the font once here and share it across the tests below.
const has = (await testFonts()).has;

describe("what the embedded Noto Sans can print (FONT-1)", () => {
  it('Latin with Vietnamese, Greek, Cyrillic and the report\'s symbols print as written', () => {
    for (const t of ['Zoë SYNTHETIC ± 3.5° · Björk', 'Nguyễn Thị Ánh', 'Παπαδόπουλος', 'Иванова', 'Research tool — not a diagnostic device; U1–SN ‘a’ “b” …'])
      expect(pdfSafe(t, has)).toBe(t);
  });
  it('a letter the font does not have prints as ?, and is listed so the preview can warn', () => {
    expect(pdfSafe('李明 SYNTHETIC', has)).toBe('?? SYNTHETIC');
    expect(unprintable(['李明 SYNTHETIC', 'Zoë — ok', 'Иванова'], has)).toEqual(['李', '明']);
    expect(unprintable(['plain'], has)).toEqual([]);
  });
  it('the coverage comes from the font file itself; a file that is not a font is refused', () => {
    expect([0x41, 0x3b1, 0x416, 0x1ec5].every(has)).toBe(true);
    expect(has(0x674e)).toBe(false);
    expect(() => cmapCoverage(new Uint8Array(64))).toThrow();
  });
  it('positive control: Latin-1 alone (before the font has loaded) cannot print Greek', () => {
    expect(pdfSafe('Παπα', latin1)).toBe('????');
  });
  it('exact coverage positive control: a format-4 segment with a hole is not "covered" just because the point sits inside the range (Task 7 review)', () => {
    // A range-only check ("c is between start and end") would say every point in [0x674e, 0x6750] is covered;
    // the middle one (0x674f) is deliberately written to glyph 0 (.notdef) via the idRangeOffset glyph array.
    const font = sfnt(0x00010000, [{ tag: 'cmap', data: cmapTable(format4Hole(0x674e, 0x6750, 40, [0x674f])) }]);
    const holeHas = cmapCoverage(font);
    expect(holeHas(0x674e)).toBe(true);   // the range's first point really is covered
    expect(holeHas(0x6750)).toBe(true);   // and its last point
    expect(holeHas(0x674f)).toBe(false);  // the hole: inside the range, but glyph 0 — a range-only check would miss this
  });
});

describe('printPlan / printProblems (owner FONT-2): Noto, then the system CJK font, never for Arabic/Hebrew/Indic/Thai', () => {
  const noFont: PrintFonts = { noto: has, cjk: null };

  it('plain Latin prints through Noto unchanged', () => {
    expect(printPlan('Zoë SYNTHETIC', noFont)).toEqual({ font: 'NotoSans', text: 'Zoë SYNTHETIC', missing: [] });
  });

  it('李明 with no system font found: Noto with "?", and the missing letters are named', () => {
    expect(printPlan('李明 SYNTHETIC', noFont)).toEqual({ font: 'NotoSans', text: '?? SYNTHETIC', missing: ['李', '明'] });
  });

  it('李明 with a system CJK font that maps both: SystemCJK, text unchanged', async () => {
    const cjkTtf = await cjkTestFont({ '李': 'L', '明': 'M' });
    const f: PrintFonts = { noto: has, cjk: { has: cmapCoverage(cjkTtf), name: 'SYNTHETIC CJK' } };
    expect(printPlan('李明 SYNTHETIC', f)).toEqual({ font: 'SystemCJK', text: '李明 SYNTHETIC', missing: [] });
  });

  it('FONT-2: an Arabic letter never prints through the system font, even when that font has it', async () => {
    const cjkTtf = await cjkTestFont({ 'ا': 'l' }); // the synthetic font DOES map ا — the rule must still refuse it
    const f: PrintFonts = { noto: has, cjk: { has: cmapCoverage(cjkTtf), name: 'SYNTHETIC CJK' } };
    expect(printPlan('ا SYNTHETIC', f)).toEqual({ font: 'NotoSans', text: '? SYNTHETIC', missing: ['ا'] });
  });

  it('printProblems is the union of missing letters across every text', async () => {
    expect(printProblems(['李明 SYNTHETIC', 'plain', 'あ SYNTHETIC'], noFont)).toEqual(['李', '明', 'あ']);
  });

  // Task 8 review Minor 1 -> Task 9 carry-over (c): ReportPreview used to exclude the three fixed app-wide strings
  // (contextLine, footer, app) from this check, ONLY because Task 8's placeholder Latin-1 font could not print the
  // footer's em dash (U+2014) -- which would have made EVERY report warn about its own boilerplate. Now that the
  // real Noto Sans loads (Task 9), that exclusion is removed (ReportPreview.tsx) and this is the guard that a fixed
  // string never again escapes the check silently: the real font must pass it, and the placeholder must fail it
  // (the positive control that proves this test is not vacuously green for any font at all).
  it('the footer\'s own em dash passes the check with the real Noto font (Task 9 carry-over (c))', () => {
    expect(FOOTER).toContain('—');
    expect(printProblems([FOOTER], { noto: has, cjk: null })).toEqual([]);
  });
  // Owner bug (29 Oct 2026): en and em dash are common in the app's own fixed text (this footer) and in words
  // clinicians paste from a word processor. They must never print as "?", in ANY font state — including the
  // Latin-1 PLACEHOLDER that is active for the brief window before the real Noto Sans has loaded — so this no
  // longer reports them as missing (dashMaps below is the positive control that this check can still fail).
  it("the footer's own em dash never warns, even under the Latin-1 PLACEHOLDER font (before Noto loads)", () => {
    expect(printProblems([FOOTER], { noto: latin1, cjk: null })).toEqual([]);
  });
});

describe('en/em dash safe fallback (owner bug, 29 Oct 2026): never "?", even when the active font lacks the glyph', () => {
  // Positive control: an unrelated, genuinely unsupported letter (no safe fallback) still gets "?" and still
  // warns, under the very same placeholder font — proves this check can fail, so "never ?" above is not vacuous.
  it('positive control: a Greek letter (no safe fallback) still prints as ? and still warns under Latin-1', () => {
    expect(pdfSafe('Σ', latin1)).toBe('?');
    expect(unprintable(['Σ'], latin1)).toEqual(['Σ']);
  });
  it('en dash (–) and em dash (—) map to a plain hyphen, not ?, when the active font cannot print them', () => {
    expect(pdfSafe('U1–SN', latin1)).toBe('U1-SN');
    expect(pdfSafe('a — b', latin1)).toBe('a - b');
  });
  it('a dash with no safe fallback need is never named as missing', () => {
    expect(unprintable(['U1–SN — total'], latin1)).toEqual([]);
  });
  it('printPlan substitutes the hyphen and reports nothing missing for dash-only gaps', () => {
    expect(printPlan('U1–SN — total', { noto: latin1, cjk: null })).toEqual({ font: 'NotoSans', text: 'U1-SN - total', missing: [] });
  });
});
