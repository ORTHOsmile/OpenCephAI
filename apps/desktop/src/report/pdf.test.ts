import { describe, it, expect, vi } from 'vitest';
import { ALL_ANALYSES, buildRegistry } from '@ceph/analyses';
import { initialTracing } from '../tracing/state';
import { sha256Bytes } from '../export/sha256';
import { NOW, SYNTH_POINTS, synthCells, synthDoc, synthFitModel, synthModel } from './fixtures';
import { CONTEXT_LINE, DEFAULT_REPORT_OPTIONS, headerLines, type ReportModel, type ReportOptions } from './model';
import { figure, figureFit, profilogramShapes } from './shapes';
import { profilogramPageShapes } from './profilogramPage';
import { pageOneBoxes, profilogramBox, type Paper } from './page';
import { buildPdf } from './pdf';
import { cmapCoverage, pdfSafe } from './pdfText';
import { readPdf } from './readPdf';
import { testFonts } from './testFonts';
import { cjkTestFont } from './testCjkFont';
import type { PdfFonts } from './fonts';

// Ruling I4 (preflight-rulings.md): jsPDF 4's `triangle` is an own property of each instance, not of
// `jsPDF.prototype`, so `vi.spyOn(jsPDF.prototype, 'triangle')` would see nothing. The diamond lives in its own
// module (`./diamond`); wrap the REAL function so the byte-identity tests elsewhere in this file see the same PDF.
vi.mock('./diamond', async (importOriginal) => {
  const m = await importOriginal<typeof import('./diamond')>();
  return { ...m, diamond: vi.fn(m.diamond) };
});
import { diamond } from './diamond';

const registry = buildRegistry(ALL_ANALYSES), fonts = await testFonts();
const pts = Object.fromEntries(Object.entries(SYNTH_POINTS).map(([id, p]) => [id, { ...p, source: 'ai' as const, verified: id === 'S' }]));
// Carry-over from Task 6: figure() takes `scale: Scale` (the film's own scale), not a separate mmPerPx + assumed flag.
const pdf = (model: ReportModel = synthModel(), paper: Paper = 'a4', now = NOW, fontOverride: PdfFonts = fonts, options: ReportOptions = DEFAULT_REPORT_OPTIONS,
  profilogram: ReturnType<typeof profilogramShapes> | null = null) => {
  const fig = figure({ points: pts, registry, overlays: initialTracing.overlays, orientation: { mirror: false, rotDeg: 0, source: 'none' },
    dims: { W: 1200, H: 1400 }, scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 } }, pageOneBoxes(paper, headerLines(model.header).length).film, false);
  return buildPdf({ model, paper, decimals: 1, fonts: fontOverride, options, figure: { shapes: fig.shapes, film: null }, profilogram }, now);
};
const flat = (pages: string[]) => pages.join('\n').replace(/\s+/g, ' ');
// Owner, 29 Oct 2026 (item 1): the profilogram shapes for a report's own page, built exactly as the caller would
// (useReport.ts) — `profilogramBox`'s box, the same `figureFit` the film uses.
const orientation = { mirror: false, rotDeg: 0, source: 'none' as const }, dims = { W: 1200, H: 1400 };
const profilogramFor = (paper: Paper) => profilogramShapes(pts, orientation, dims, figureFit(orientation, dims, profilogramBox(paper)));

describe('the PDF report (read back with pdfjs)', () => {
  it('A4: page 1 is the header and figure; the tables follow; every page is A4', async () => {
    const r = await readPdf(pdf());
    expect(r.pages.length).toBeGreaterThanOrEqual(2);
    expect(r.sizes.every(([w, h]) => w === 595 && h === 842)).toBe(true);
    for (const s of ['Cephalometric report', 'SYNTHETIC Demo', 'L-00042', '07/03/2010 (age 13.9 at the film)', 'Aariz', 'Not verified', '18/10/2026']) expect(r.pages[0]).toContain(s);   // SYNTHETIC
  });
  it('Letter pages', async () => {
    expect((await readPdf(pdf(synthModel(), 'letter'))).sizes[0]).toEqual([612, 792]);
  });
  it('each table row: Measurement, Mean ± SD, Result with its stars, Meaning; the analysis names; no source lines by default (item 3)', async () => {
    const t = flat((await readPdf(pdf())).pages.slice(1));
    for (const s of ['Steiner', 'Downs', 'McNamara', 'Measurement', 'Mean ± SD', 'Result', 'Meaning',
      'ANB', '2.0 ± 2.0°', '6.2° **', 'Moderate Class II', 'prognathic maxilla tendency', 'Needs: Pog', 'calibrate to show']) expect(t).toContain(s);
    expect(t).not.toContain('Steiner 1953 (SYNTHETIC source line)');
  });
  it('item 3: the "Norm sources" option prints the long per-row source paragraph; the default proves the option is not vacuous', async () => {
    const on = flat((await readPdf(pdf(synthModel(), 'a4', NOW, fonts, { ...DEFAULT_REPORT_OPTIONS, normSources: true }))).pages.slice(1));
    expect(on).toContain('Steiner 1953 (SYNTHETIC source line)');
    const off = flat((await readPdf(pdf())).pages.slice(1));
    expect(off).not.toContain('Steiner 1953 (SYNTHETIC source line)');
  });
  it('a changed meaning prints instead of the usual words', async () => {
    const m = synthModel({ edits: { 'steiner:m03_ANB': { text: 'Moderate Class II, dental compensation', was: 'Moderate Class II' } } });
    const t = flat((await readPdf(pdf(m))).pages);
    expect(t).toContain('Moderate Class II, dental compensation');
  });
  it('the context line once, after the tables; the footer and page number on every page', async () => {
    const r = await readPdf(pdf());
    const all = flat(r.pages), line = pdfSafe(CONTEXT_LINE, fonts.has);
    expect(all.split(line).length - 1).toBe(1);
    expect(flat(r.pages.slice(0, 1))).not.toContain(line);
    r.pages.forEach((p, i) => {
      expect(p.replace(/\s+/g, ' ')).toContain('Research tool — not a diagnostic device');
      expect(p).toContain(`Page ${i + 1} of ${r.pages.length}`);
    });
  });
  it('a long table runs on over several pages, the page count stays right, and nothing is drawn off its page', async () => {
    const base = synthModel(), rows = Array.from({ length: 60 }, (_, i) => ({ ...base.blocks[0].rows[0], key: `steiner:x${i}`, label: `SYNTHETIC row ${i}`, abbr: `R${i}` }));
    const r = await readPdf(pdf({ ...base, blocks: [{ ...base.blocks[0], rows }] }));
    expect(r.pages.length).toBeGreaterThanOrEqual(3);   // page 1 (figure + chart) plus the table running over several pages
    for (const it of r.items) {   // nothing is drawn off its own page
      const [w, h] = r.sizes[it.page - 1];
      expect(it.x >= 0 && it.x <= w && it.y >= 0 && it.y <= h, `${it.str} at ${it.x},${it.y} on page ${it.page}`).toBe(true);
    }
    expect(r.pages[r.pages.length - 1]).toContain(`Page ${r.pages.length} of ${r.pages.length}`);
    expect(flat(r.pages)).toContain('SYNTHETIC row 59');
  });
  // Fix round (ruling, 29 Oct 2026): a printed report must never quietly drop a chart row. The old
  // behaviour sliced the chart to the rows that fit beside the film at the normal row height; this is exactly
  // the number of rows that old slicing would have dropped (60 rows; the chart box fits only ~33 at the normal
  // 6 mm pitch, and even the minimum readable pitch cannot fit all 60 beside the film) — so this is the REQUIRED
  // test: every row must still appear, now on a "Measurement chart, continued" page, never dropped.
  it('REQUIRED: more chart rows than fit even at the old row height — every row still appears, nothing drawn off its own page', async () => {
    const base = synthModel(), rows = Array.from({ length: 60 }, (_, i) => ({ ...base.blocks[0].rows[0], key: `steiner:x${i}`, label: `SYNTHETIC row ${i}`, abbr: `R${i}` }));
    const r = await readPdf(pdf({ ...base, blocks: [{ ...base.blocks[0], rows }] }));
    for (const it of r.items) {
      const [w, h] = r.sizes[it.page - 1];
      expect(it.x >= 0 && it.x <= w && it.y >= 0 && it.y <= h, `${it.str} at ${it.x},${it.y} on page ${it.page}`).toBe(true);
    }
    // Every row's chart label (R0..R59 — only the chart draws the abbreviation; the table draws "SYNTHETIC row N")
    // appears somewhere in the file: none dropped.
    const all = flat(r.pages);
    for (let i = 0; i < 60; i++) expect(all).toContain(`R${i}`);
    expect(all).toContain('Measurement chart, continued');
  });
  it('no analyses switched on: says so', async () => {
    expect(flat((await readPdf(pdf({ ...synthModel(), blocks: [] }))).pages)).toContain('No analyses are switched on');
  });
  // Merge-second follow-up (c), final-review.md: a "My analysis" block with a dropped measurement shows
  // unavailableLine(d) once, above its table (model.test.ts covers buildReport setting it; this covers the PDF
  // actually drawing it, since reportTexts/the font check alone would not catch a missed autoTable wire-up).
  it('a My-analysis block’s dropped-measurement note prints once, above its table', async () => {
    const base = synthModel(), note = 'My custom SYNTHETIC: 1 measurement no longer available (m86_Nasolabial).';
    const m = { ...base, blocks: [{ ...base.blocks[0], unavailable: note }, ...base.blocks.slice(1)] };
    const t = flat((await readPdf(pdf(m))).pages.slice(1));
    expect(t.split(note).length - 1).toBe(1);
    expect(t.indexOf(note)).toBeLessThan(t.indexOf('SNA'));
  });
  it('names in Greek, Cyrillic and Vietnamese print as written (FONT-1), round-tripping into the PDF text', async () => {
    for (const name of ['Παπαδόπουλος SYNTHETIC', 'Иванова SYNTHETIC', 'Nguyễn Thị Ánh SYNTHETIC']) {
      const r = await readPdf(pdf(synthModel({ doc: synthDoc({ patientName: name }) })));
      expect(r.pages[0].normalize('NFC')).toContain(name);
    }
  });
  it('a script Noto Sans does not cover still prints as ? (the preview warns first; owner question)', async () => {
    const r = await readPdf(pdf(synthModel({ doc: synthDoc({ patientName: '李明 SYNTHETIC' }) })));
    expect(r.pages[0]).toContain('?? SYNTHETIC');
  });
  // preflight-rulings Task 7: no @types/node in this repo, so compare bytes with sha256Bytes (Task 2), not Buffer.
  // Review fix round 1, ruling I1: jsPDF's /CreationDate has 1-second resolution, so two synchronous
  // `pdf()` calls almost always land in the same real second and would pass even if `buildPdf` read the wall clock
  // instead of the caller's `now` (task-7-report.md's control (b) proved exactly that with the bug present). Faking
  // the system clock to two different real moments around the two calls — while passing the SAME `now` to both —
  // makes the "equal" assertion fail reliably if the code ever reads `new Date()` instead of `now`.
  it('the same film at the same time gives the same file; another time, another file (positive control)', () => {
    let a!: Uint8Array, b!: Uint8Array;
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2020-01-01T00:00:00Z'));
      a = pdf();
      vi.setSystemTime(new Date('2030-06-15T12:34:56Z'));
      b = pdf();
    } finally {
      vi.useRealTimers();
    }
    expect(sha256Bytes(a)).toBe(sha256Bytes(b));
    expect(sha256Bytes(pdf(synthModel(), 'a4', new Date('2026-10-19T02:00:00Z')))).not.toBe(sha256Bytes(a));
  });
  // Owner, 29 Oct 2026 (the zig-zag plot beside the ceph, item 5): the chart sits to the RIGHT of the film on
  // page 1, both scaled to share the page (per `page.test.ts`'s own box-geometry proof) — checked here against
  // the PDF's own text: the chart's first row label ("SNA") sits well to the right of the film's own "10 mm"
  // scale-bar label, which the figure places near the film's own left edge.
  it('item 5: the chart\'s row labels sit to the right of the film (the scale bar\'s "10 mm" label)', async () => {
    const r = await readPdf(pdf());
    const page1 = r.items.filter((it) => it.page === 1);
    const bar = page1.find((it) => it.str === '10 mm');
    const label = page1.find((it) => it.str === 'SNA');
    expect(bar).toBeDefined();
    expect(label).toBeDefined();
    expect(label!.x).toBeGreaterThan(bar!.x + 40);   // comfortably clear of the film, not just a few pt over
  });
  it('without the film there is no image in the file', () => {
    expect(new TextDecoder('latin1').decode(pdf())).not.toContain('/Subtype /Image');
  });

  describe('owner FONT-2: the computer\'s own font for Chinese, Japanese and Korean', () => {
    it('李明 prints through the system font when one is supplied that maps it', async () => {
      const cjkTtf = await cjkTestFont({ '李': 'L', '明': 'M' });
      const withCjk: PdfFonts = { ...fonts, cjk: { ttf: cjkTtf, name: 'SYNTHETIC CJK', has: cmapCoverage(cjkTtf) } };
      const r = await readPdf(pdf(synthModel({ doc: synthDoc({ patientName: '李明 SYNTHETIC' }) }), 'a4', NOW, withCjk));
      expect(r.pages[0]).toContain('李明 SYNTHETIC');
    });
    it('the existing "?? SYNTHETIC" case (no CJK font) is the control for the test above', async () => {
      const r = await readPdf(pdf(synthModel({ doc: synthDoc({ patientName: '李明 SYNTHETIC' }) })));
      expect(r.pages[0]).toContain('?? SYNTHETIC');
    });
    it('a CJK changed Meaning prints in the table (the autotable cell path, not just the header)', async () => {
      const cjkTtf = await cjkTestFont({ '李': 'L', '明': 'M' });
      const withCjk: PdfFonts = { ...fonts, cjk: { ttf: cjkTtf, name: 'SYNTHETIC CJK', has: cmapCoverage(cjkTtf) } };
      const m = synthModel({ edits: { 'steiner:m03_ANB': { text: '李明 SYNTHETIC meaning', was: 'Moderate Class II' } } });
      const t = flat((await readPdf(pdf(m, 'a4', NOW, withCjk))).pages);
      expect(t).toContain('李明 SYNTHETIC meaning');
    });
    it('an Arabic name still prints "?" even with a CJK font that maps it (FONT-2: never through the system font)', async () => {
      const cjkTtf = await cjkTestFont({ 'ا': 'l' }); // the synthetic font DOES map ا — the rule must still refuse it
      const withCjk: PdfFonts = { ...fonts, cjk: { ttf: cjkTtf, name: 'SYNTHETIC CJK', has: cmapCoverage(cjkTtf) } };
      const r = await readPdf(pdf(synthModel({ doc: synthDoc({ patientName: 'ا SYNTHETIC' }) }), 'a4', NOW, withCjk));
      expect(r.pages[0]).toContain('? SYNTHETIC');
    });
    it('a Latin-only model gives identical bytes with and without a CJK font supplied (the untouched path)', async () => {
      const cjkTtf = await cjkTestFont({ '李': 'L' });
      const withCjk: PdfFonts = { ...fonts, cjk: { ttf: cjkTtf, name: 'SYNTHETIC CJK', has: cmapCoverage(cjkTtf) } };
      expect(sha256Bytes(pdf(synthModel(), 'a4', NOW, withCjk))).toBe(sha256Bytes(pdf(synthModel(), 'a4', NOW, fonts)));
    });
    it("the CJK font's name appears in the file only when it is actually used", async () => {
      const cjkTtf = await cjkTestFont({ '李': 'L', '明': 'M' });
      const withCjk: PdfFonts = { ...fonts, cjk: { ttf: cjkTtf, name: 'SYNTHETIC CJK', has: cmapCoverage(cjkTtf) } };
      const latinOnly = new TextDecoder('latin1').decode(pdf(synthModel(), 'a4', NOW, withCjk));
      expect(latinOnly).not.toContain('SystemCJK');
      const withCjkText = new TextDecoder('latin1').decode(pdf(synthModel({ doc: synthDoc({ patientName: '李明 SYNTHETIC' }) }), 'a4', NOW, withCjk));
      expect(withCjkText).toContain('SystemCJK');
    });
  });
});

// Owner N-A5, AUTO-Q10 (ruling I4): one drawn diamond per Auto row (the norm cell's own mark) plus one for the
// footnote; none when there is no Auto row (positive control: the untouched path).
describe('N-A5 / AUTO-Q10: the diamond module is called once per Auto row plus one for the footnote', () => {
  const auto = { population: 'japanese', populationWords: 'Japanese', step: 'caucasian' as const, usedPopulation: 'Caucasian', source: 'McNamara 1984 Ann Arbor', n: 73 };
  const autoModel = () => synthModel({ cells: synthCells().map((c, i) => (c && (i === 0 || i === 1) ? { ...c, auto } : c)) });
  it('two Auto rows: three diamonds (2 + the footnote); no Auto row: none', () => {
    vi.mocked(diamond).mockClear();
    pdf(autoModel());
    expect(vi.mocked(diamond).mock.calls.length).toBe(3);
    vi.mocked(diamond).mockClear();
    pdf(synthModel());
    expect(vi.mocked(diamond)).not.toHaveBeenCalled();
  });
  it('the footnote prints, and the page text has neither "◆" nor a "?" in its place', async () => {
    const m = autoModel();
    const r = await readPdf(pdf(m));
    const all = flat(r.pages);
    expect(all).toContain(m.autoNote);
    expect(all).not.toContain('◆');
    expect(all.split('?').length - 1).toBe(0);
  });
  // Positive controls (I4's own Cost-if-wrong list): a broken wire-up must fail this count, not just pass silently.
  it('control: the control cells carry no diamond calls when auto is stripped out (proves the count is not vacuous)', () => {
    vi.mocked(diamond).mockClear();
    pdf(synthModel({ cells: synthCells().map((c) => (c ? { ...c, auto: null } : c)) }));
    expect(vi.mocked(diamond)).not.toHaveBeenCalled();
  });
  // Review I-2 (fix round 1, 25 Oct 2026): task-5-review's own "What Task 10 must do" 1 — an UNGRADED Auto row
  // (no z: "Needs: …", or a hidden mm value) still gets its ◆; the mark follows `auto`, never the grade. synthCells
  // index 2 is a Needs row (no z), index 4 is a hidden mm row (no z) — neither was ever given an AutoNote before
  // this fix, so a later change gating the mark on `z !== null` could have shipped unnoticed.
  it('I-2: ungraded Auto rows (a Needs row, a hidden mm row) still draw their diamond', () => {
    const ungraded = synthModel({ cells: synthCells().map((c, i) => (c && (i === 1 || i === 2 || i === 4) ? { ...c, auto } : c)) });
    vi.mocked(diamond).mockClear();
    pdf(ungraded);
    expect(vi.mocked(diamond).mock.calls.length).toBe(4); // 3 Auto rows (graded ANB, Needs Facial angle, hidden Co-A) + 1 footnote
  });
});

// R3 (D7, final-review.md C1): a report on a fit's scale prints the † on its mm values and the note, read back from
// the PDF itself; Noto Sans has U+2020, so no "?" stands in for it.
describe('R3 (D7): the PDF of a fitted film', () => {
  it('has the header\'s fit line, the † on the shown mm value, and the note with the G2 sentence, once, after the tables', async () => {
    expect(fonts.has(0x2020)).toBe(true);
    const m = synthFitModel(), r = await readPdf(pdf(m)), all = flat(r.pages);
    expect(flat(r.pages.slice(0, 1))).toContain('from a fit: 0.1042 mm per pixel (scaled to T1 on S–N (×1.042)) †');
    expect(all).toContain('95.3 mm †');
    expect(all.split(m.fitNote!).length - 1).toBe(1);
    expect(flat(r.pages.slice(0, 1))).not.toContain(m.fitNote!);
    expect(all.indexOf(m.fitNote!)).toBeGreaterThan(all.indexOf(pdfSafe(CONTEXT_LINE, fonts.has)));
    expect(all).toContain('This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1.');
  });
  it('G3: the second G2 sentence prints too', async () => {
    expect(flat((await readPdf(pdf(synthFitModel(true)))).pages)).toContain('T1 had no ruler either, so both are on the assumed scale.');
  });
  it('a calibrated film\'s PDF has no † (positive control for the search above)', async () => {
    expect(flat((await readPdf(pdf())).pages)).not.toContain('†');
  });
});

// m1 (integration-review.md): `report/pdf.ts`'s header loop drew every value at a fixed HEADER_STEP, so a Scale
// value long enough to wrap (G3, a two-point fit, a reference timepoint over ~6 characters) landed its second line
// on top of the "AI models" row. The fix must push every later header row down by the wrapped value's extra lines,
// while a header with no wrapping prints at exactly the same y as before (checked against a hash taken at HEAD
// 6066156, before this fix, with `sha256Bytes(pdf(synthModel()))`).
describe('m1: a wrapped header value pushes the rows after it down, not over them', () => {
  it('a two-point G3 fit with a 13-character reference timepoint wraps the Scale value to two lines, and "AI models" prints below both', async () => {
    const m = synthFitModel(true, { scale: { mmPerPx: 0.1 * 1.042, source: 'fit', fit: { ref: 'Pre-treatment', kind: 'points', k: 1.042, refAssumed: true } } });
    const r = await readPdf(pdf(m));
    const page1 = r.items.filter((it) => it.page === 1);
    const scaleIdx = page1.findIndex((it) => it.str === 'Scale');
    const aiModelsIdx = page1.findIndex((it) => it.str === 'AI models');
    expect(scaleIdx).toBeGreaterThanOrEqual(0);
    expect(aiModelsIdx).toBeGreaterThan(scaleIdx);
    // Everything drawn for the Scale value sits between the two labels; with the fix it is two lines (the wrap).
    const scaleValueLines = page1.slice(scaleIdx + 1, aiModelsIdx).filter((it) => it.x > page1[scaleIdx].x);
    expect(scaleValueLines.length).toBeGreaterThanOrEqual(2);   // positive control: without the fix this is 1
    const lastScaleLineY = Math.min(...scaleValueLines.map((it) => it.y));   // PDF y is bottom-up: lower on the page = smaller y
    const aiModelsY = page1[aiModelsIdx].y;
    // The gap between the wrapped line and "AI models" must be a full header row's worth (HEADER_STEP = 5 mm =
    // 14.173 pt), the same gap every other row keeps — not the ~2.7 pt it was before the fix, which let the glyphs
    // of each line touch.
    expect(lastScaleLineY - aiModelsY).toBeCloseTo(14.173228346456694, 1);
  });

  // The hash was taken at version 0.2.0, and the PDF prints the app's version (model.ts APP), so the model's `app`
  // is pinned to that line here: otherwise every version bump would break this test without any layout change.
  // Re-pinned 29 Oct 2026 (the zig-zag plot beside the ceph, item 3 default): with the chart now beside the
  // (narrower) film rather than under the table, and the long per-row norm-source paragraph off by default, the
  // page-1 layout and the tables' page genuinely changed on purpose — a fresh hash was taken against the new
  // `pdf()` default (DEFAULT_REPORT_OPTIONS) and is pinned here the same way.
  it('a short header (no wrap) prints at exactly the same y as before this fix — same bytes as at HEAD 6066156, re-pinned 29 Oct 2026', () => {
    expect(sha256Bytes(pdf({ ...synthModel(), app: 'OpenCephAI 0.2.0' }))).toBe('8b623b91d87943a3e76b634419e8ece8ba6dbc0ce3949abd74bffa4c58444bc1');
  });
});

describe('Part F: the Points table (chain spec §5)', () => {
  it('printed when the report carries points; a report without points prints the same bytes as before', () => {
    const pts = [{ id: 'S', name: 'Sella', label: 'Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '' as const, wholeFilmCheck: '', wholeFilmRegion: '' }];
    const withPts = pdf(synthModel({ points: pts })), without = pdf(synthModel());
    expect(sha256Bytes(withPts)).not.toBe(sha256Bytes(without));
    expect(sha256Bytes(pdf(synthModel({ points: [] })))).toBe(sha256Bytes(without));
  });
  // Stage A task 8: the PDF is the same report as the preview, so the Points table carries the same last column.
  it('Stage A: the PDF Points table has a "Point check" column with flagged / film-unusual', async () => {
    const base = { name: 'x', label: 'Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null };
    const t = flat((await readPdf(pdf(synthModel({ points: [{ ...base, id: 'N', name: 'Nasion', pointCheck: 'flagged' as const, wholeFilmCheck: '', wholeFilmRegion: '' }, { ...base, id: 'S', name: 'Sella', pointCheck: 'film-unusual' as const, wholeFilmCheck: '', wholeFilmRegion: '' }] })))).pages);
    expect(t).toContain('Point check');
    expect(t).toContain('flagged');
    expect(t).toContain('film-unusual');
    const none = flat((await readPdf(pdf(synthModel({ points: [{ ...base, id: 'N', name: 'Nasion', pointCheck: '' as const, wholeFilmCheck: '', wholeFilmRegion: '' }] })))).pages);
    expect(none).toContain('Point check');
    expect(none).not.toContain('flagged');
  });
  // Research switch off (owner, 6 Nov 2026). Fails if the PDF still prints the header or any whole-film value when the points carry none (null).
  it('switch off: the PDF Points table has no Whole-film column and prints no whole-film value, with or without Placed by', async () => {
    const base = { name: 'x', label: 'Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '' as const };
    for (const placedBy of [false, true]) {
      const t = flat((await readPdf(pdf(synthModel({ points: [{ ...base, id: 'N', name: 'Nasion', wholeFilmCheck: null, wholeFilmRegion: null }] }), 'a4', NOW, fonts, { ...DEFAULT_REPORT_OPTIONS, placedBy }))).pages);
      expect(t).toContain('Point check');
      expect(t).not.toContain('Whole-film');
      expect(t).not.toContain('flagged:');
    }
  });
  // Research switch on (owner ruling 6 Nov 2026): the PDF states each look and each landmark's region result. Fails if either is missing.
  it('switch on: the PDF Points table has a Region column and a line for each look', async () => {
    const looks = { shape: 'judged', regions: 'judged', size: 'not checked (not set up)', centre: 'judged', mirrored: 'judged', facing: 'judged' };
    const base = { name: 'x', label: 'Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '' as const, wholeFilmCheck: 'clean', wholeFilmLooks: looks };
    const t = flat((await readPdf(pdf(synthModel({ points: [{ ...base, id: 'N', name: 'Nasion', wholeFilmRegion: 'region flagged' }, { ...base, id: 'S', name: 'Sella', wholeFilmRegion: 'fine' }] })))).pages);
    expect(t).toContain('Region');
    expect(t).toContain('region flagged');
    expect(t).toContain('size not checked (not set up)');
    expect(t).toContain('shape judged');
  });
  // SC-1 Part 1 task 9. Fails if the PDF's Points table drops the whole-film column or prints a blank / another value.
  it('Task 9: the PDF Points table has a "Whole-film check" column carrying the film\'s value; with no record the header stays and no value prints', async () => {
    const base = { name: 'x', label: 'Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '' as const };
    const text = async (cell: string, opts = DEFAULT_REPORT_OPTIONS) => flat((await readPdf(pdf(synthModel({ points: [{ ...base, id: 'N', name: 'Nasion', wholeFilmCheck: cell, wholeFilmRegion: '' }, { ...base, id: 'S', name: 'Sella', wholeFilmCheck: cell, wholeFilmRegion: '' }] }), 'a4', NOW, fonts, opts))).pages);
    const flagged = await text('flagged:region-mandible');
    expect(flagged).toContain('Whole-film check');
    expect(flagged).toContain('Point check');
    expect(flagged.split('flagged:region-mandible').length - 1).toBe(2);            // once per point row
    const clean = await text('clean');
    expect(clean).toContain('clean');
    const none = await text('');
    expect(none).toContain('Whole-film check');
    expect(none).not.toContain('flagged:');
    expect(none).not.toContain('checked:');
    expect(await text('checked:corrected-tracing', { ...DEFAULT_REPORT_OPTIONS, placedBy: true })).toContain('checked:corrected-tracing');   // with the Placed-by column too
  });
  // Owner, 29 Oct 2026 (item 4): who placed each point is OFF by default.
  it('"Placed by" (who placed the point) is absent by default; the option prints it', async () => {
    const pts = [{ id: 'S', name: 'Sella', label: 'SYNTHETIC Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '' as const, wholeFilmCheck: '', wholeFilmRegion: '' }];
    const m = synthModel({ points: pts });
    const off = flat((await readPdf(pdf(m))).pages);
    expect(off).not.toContain('SYNTHETIC Aariz');
    expect(off).toContain('Sella');
    const on = flat((await readPdf(pdf(m, 'a4', NOW, fonts, { ...DEFAULT_REPORT_OPTIONS, placedBy: true }))).pages);
    expect(on).toContain('SYNTHETIC Aariz');
  });
});

// Owner, 5 Nov 2026: "Points table" off removes the whole Points section from the PDF.
describe('owner, 5 Nov 2026: the Points table option in the PDF', () => {
  const pt = { id: 'S', name: 'Sella', label: 'Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '' as const, wholeFilmCheck: '', wholeFilmRegion: '' };
  const off: ReportOptions = { ...DEFAULT_REPORT_OPTIONS, pointsTable: false };
  it('on (default): the Points heading and name print; off: neither, and the bytes equal a report with no points', async () => {
    const m = synthModel({ points: [pt] });
    expect(flat((await readPdf(pdf(m))).pages)).toContain('Sella');
    const t = flat((await readPdf(pdf(m, 'a4', NOW, fonts, off))).pages);
    expect(t).not.toContain('Points');
    expect(t).not.toContain('Sella');
    expect(sha256Bytes(pdf(m, 'a4', NOW, fonts, off))).toBe(sha256Bytes(pdf(synthModel())));
  });
  it('off: a CJK point name does not bring the system CJK font into the file; on, it does', async () => {
    const cjkTtf = await cjkTestFont({ '李': 'L' });
    const withCjk: PdfFonts = { ...fonts, cjk: { ttf: cjkTtf, name: 'SYNTHETIC CJK', has: cmapCoverage(cjkTtf) } };
    const m = synthModel({ points: [{ ...pt, name: '李 SYNTHETIC' }] });
    expect(new TextDecoder('latin1').decode(pdf(m, 'a4', NOW, withCjk))).toContain('SystemCJK');
    expect(new TextDecoder('latin1').decode(pdf(m, 'a4', NOW, withCjk, off))).not.toContain('SystemCJK');
  });
});

// Owner, 29 Oct 2026 (items 1-2): the profilogram goes on its own page, never over the film; OFF by default.
describe('the profilogram page (owner, 29 Oct 2026, items 1-2)', () => {
  it('nothing extra when the caller passes none (the option off, or nothing to draw) — same page count and bytes as without the feature', async () => {
    const r = await readPdf(pdf());
    expect(r.pages.length).toBe(2);   // page 1 (figure) + the Steiner/Downs/McNamara tables on one more page
  });
  it('"Profilogram page" checked: one more page, headed "Profilogram", with the profile shapes — never drawn over page 1 (the film)', async () => {
    const without = await readPdf(pdf());
    const withIt = await readPdf(pdf(synthModel(), 'a4', NOW, fonts, { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true }, profilogramFor('a4')));
    expect(withIt.pages.length).toBe(without.pages.length + 1);
    expect(withIt.pages[withIt.pages.length - 1]).toContain('Profilogram');
    expect(withIt.pages[0]).not.toContain('Profilogram');   // page 1 (the film) never carries the heading or the profile
  });
  it('readable on Letter too: the profilogram page stays within the page, one extra page', async () => {
    const r = await readPdf(pdf(synthModel(), 'letter', NOW, fonts, { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true }, profilogramFor('letter')));
    expect(r.pages[r.pages.length - 1]).toContain('Profilogram');
  });
  // Owner, 5 Nov 2026: the mm grid behind the profilogram, in the file.
  it('the grid option adds line work to the profilogram page and no page: same page count, a bigger file, the grid note on that page only', async () => {
    const f = { points: pts, registry, overlays: initialTracing.overlays, orientation, dims, scale: { mmPerPx: 0.1, source: 'calibration' as const, steps: 0 } };
    const withGrid: ReportOptions = { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true }, noGrid: ReportOptions = { ...withGrid, profilogramGrid: false };
    const a = pdf(synthModel(), 'a4', NOW, fonts, withGrid, profilogramPageShapes(f, 'a4', withGrid));
    const b = pdf(synthModel(), 'a4', NOW, fonts, noGrid, profilogramPageShapes(f, 'a4', noGrid));
    const ra = await readPdf(a), rb = await readPdf(b);
    expect(ra.pages.length).toBe(rb.pages.length);
    expect(sha256Bytes(a)).not.toBe(sha256Bytes(b));
    expect(a.length).toBeGreaterThan(b.length);
    expect(ra.pages[ra.pages.length - 1]).toContain('patient millimetres');
    expect(rb.pages[rb.pages.length - 1]).not.toContain('patient millimetres');
    expect(ra.pages[0]).not.toContain('patient millimetres');
  });
  it('uncalibrated film: the profilogram page prints without the grid, byte for byte the same as with the grid option off', () => {
    const f = { points: pts, registry, overlays: initialTracing.overlays, orientation, dims, scale: { mmPerPx: 0.1, source: 'assumed' as const } };
    const withGrid: ReportOptions = { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true }, noGrid: ReportOptions = { ...withGrid, profilogramGrid: false };
    expect(sha256Bytes(pdf(synthModel(), 'a4', NOW, fonts, withGrid, profilogramPageShapes(f, 'a4', withGrid))))
      .toBe(sha256Bytes(pdf(synthModel(), 'a4', NOW, fonts, noGrid, profilogramPageShapes(f, 'a4', noGrid))));
  });
  it('positive control: an empty profilogram (no shapes — e.g. the points needed are not placed) adds no page, even with the option on', async () => {
    const r = await readPdf(pdf(synthModel(), 'a4', NOW, fonts, { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true }, []));
    expect(r.pages.length).toBe(2);
  });
});
