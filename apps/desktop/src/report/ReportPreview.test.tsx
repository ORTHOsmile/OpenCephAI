import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ALL_ANALYSES, buildRegistry, type MyAnalysisDef } from '@ceph/analyses';
import { initialTracing } from '../tracing/state';
import { SYNTH_POINTS, synthCells, synthDoc, synthFitModel, synthModel, NOW } from './fixtures';
import { buildReport, CONTEXT_LINE, DEFAULT_REPORT_OPTIONS, FOOTER, type ReportModel } from './model';
import { latin1, type PrintFonts } from './pdfText';
import { ReportPreview } from './ReportPreview';

const fi = { points: Object.fromEntries(Object.entries(SYNTH_POINTS).map(([id, p]) => [id, { ...p, source: 'ai' as const, verified: false }])),
  registry: buildRegistry(ALL_ANALYSES), overlays: initialTracing.overlays, orientation: { mirror: false, rotDeg: 0, source: 'none' as const },
  dims: { W: 1200, H: 1400 }, scale: { mmPerPx: 0.1, source: 'calibration' as const, steps: 0 } };
const words = { ready: true, error: null, save: () => {}, reset: () => {} };
// Task 9 carry-over (c): ReportPreview no longer excludes the footer from the printability check, so a fixture
// standing in for "the real Noto Sans is loaded" must cover its em dash (U+2014) the same way the real font does
// (pinned directly against the real font bytes in pdfText.test.ts) — otherwise every test below would warn about
// the app's own boilerplate rather than the thing each test actually means to probe.
const notoLike = (c: number) => latin1(c) || c === 0x2014;
const print: PrintFonts & { searching: boolean } = { noto: notoLike, cjk: null, searching: false };
const html = (model: ReportModel | null = synthModel(), o: Partial<Parameters<typeof ReportPreview>[0]> = {}) => renderToStaticMarkup(
  <ReportPreview model={model} problem={null} decimals={1} figureInput={fi} film={null} words={words} onClose={() => {}} paper="a4" withFilm={false} print={print} {...o} />);
const esc = (s: string) => s.replace(/'/g, '&#x27;');

describe('the Report preview (spec 2026-10-17): what the PDF will hold', () => {
  it('a dialog with the header, one block per analysis, the context line once and the footer', () => {
    const h = html();
    expect(h).toContain('aria-label="Report preview"');
    for (const s of ['SYNTHETIC Demo', 'Not verified: the tracing has not been signed off', 'Aariz']) expect(h).toContain(s);
    expect([...h.matchAll(/<h3>([^<]*)<\/h3>/g)].map((m) => m[1])).toEqual(['Steiner', 'Downs', 'McNamara']);
    expect(h.split(esc(CONTEXT_LINE)).length - 1).toBe(1);
    expect(h).toContain(FOOTER);
  });
  it('the table columns in the report order, the stars after the result, and an editable Meaning per row', () => {
    const h = html();
    expect(h).toMatch(/<th>Measurement<\/th><th>Mean ± SD<\/th><th>Result<\/th><th>Meaning<\/th>/);
    expect(h).toContain('6.2° <span class="stars">**</span>');
    expect(h).toMatch(/aria-label="Meaning for ANB \(Steiner\)"[^>]*value="Moderate Class II"|value="Moderate Class II"[^>]*aria-label="Meaning for ANB \(Steiner\)"/);
    expect(h).toContain('data-screen-key="Steiner:m03_ANB"');
  });
  it('a changed word shows Reset; a change that no longer applies is offered back, not printed', () => {
    const m = synthModel({ edits: { 'steiner:m03_ANB': { text: 'compensated SYNTHETIC', was: 'Moderate Class II' }, 'steiner:m01_SNA': { text: 'old SYNTHETIC', was: 'Severe Class II' } } });
    const h = html(m);
    expect(h.split('Reset to my words').length - 1).toBe(1);
    expect(h).toContain('value="compensated SYNTHETIC"');
    expect(h).toMatch(/class="stale-note"[^]*old SYNTHETIC[^]*Severe Class II[^]*Use them/);
    expect(h).not.toContain('value="old SYNTHETIC"');
  });
  it('the Meaning boxes wait for the saved words, and a failed read says so', () => {
    expect(html(synthModel(), { words: { ...words, ready: false } })).toMatch(/aria-label="Meaning for ANB \(Steiner\)"[^>]*disabled|disabled[^>]*aria-label="Meaning for ANB \(Steiner\)"/);
    expect(html(synthModel(), { words: { ...words, error: 'Your words for this report could not be read (SYNTHETIC).' } })).toContain('could not be read (SYNTHETIC)');
  });
  // FONT-2 wiring (preflight-rulings Task 8): the warning is now computed over EVERY string the PDF prints
  // (printProblems(reportTexts(model), print)), not just the patient name and the Meaning cells, and a letter that
  // IS a CJK one gets its own message naming the computer's font rather than the generic "can't be printed" line.
  it('warns before saving when the PDF font cannot print a letter', () => {
    expect(html(synthModel({ doc: synthDoc({ patientName: '李明 SYNTHETIC' }) }))).toMatch(
      /class="report-warn"[^]*This computer has no font the PDF can use for 李 明[^]*print as \?\. The CSV keeps every letter\./);
    expect(html()).not.toContain('report-warn');
    const greek = (c: number) => notoLike(c) || (c >= 0x370 && c <= 0x3ff);
    expect(html(synthModel({ doc: synthDoc({ patientName: 'Παπαδόπουλος SYNTHETIC' }) }), { print: { noto: greek, cjk: null, searching: false } })).not.toContain('report-warn');
  });
  it('a CJK letter the system font covers prints a note naming the font, not a warning', () => {
    const cjk = { has: (c: number) => latin1(c) || c === 0x674e || c === 0x660e, name: 'SYNTHETIC CJK' };
    const h = html(synthModel({ doc: synthDoc({ patientName: '李明 SYNTHETIC' }) }), { print: { noto: notoLike, cjk, searching: false } });
    expect(h).not.toContain('report-warn');
    expect(h).toContain('class="report-note"');
    expect(h).toContain(esc('Chinese, Japanese and Korean letters print with this computer\'s own font (SYNTHETIC CJK).'));
  });
  it('Arabic still warns even when a found font happens to map it (FONT-2: never through the system font)', () => {
    const cjk = { has: (c: number) => latin1(c) || c === 0x0627, name: 'SYNTHETIC CJK' };   // ا SYNTHETIC
    const h = html(synthModel({ doc: synthDoc({ patientName: 'ا SYNTHETIC' }) }), { print: { noto: notoLike, cjk, searching: false } });
    expect(h).toContain('class="report-warn"');
    expect(h).not.toContain('class="report-note"');
  });
  it('while still searching for a system font, neither CJK message shows', () => {
    const h = html(synthModel({ doc: synthDoc({ patientName: '李明 SYNTHETIC' }) }), { print: { noto: notoLike, cjk: null, searching: true } });
    expect(h).not.toContain('class="report-note"');
    expect(h).not.toContain('This computer has no font');
  });
  // The verifier's name is printed too (header "Verification" line) — the warning must cover it, not only the
  // patient name and the Meaning cells (preflight-rulings Task 8).
  it('warns when only the verifier\'s name needs a letter the font cannot print', () => {
    const h = html(synthModel({ doc: synthDoc({ verifiedAt: '2024-02-08T10:00:00Z', verifiedBy: '李明 SYNTHETIC' }) }));
    expect(h).toContain('This computer has no font the PDF can use for 李 明');
  });
  it('no model: says why, with only Close', () => {
    const h = html(null, { problem: "Norms couldn't be loaded, so the report can't be made: SYNTHETIC" });
    expect(h).toContain('SYNTHETIC');
    expect(h).not.toContain('<table');
  });
  it('the chart below each table: one black line for Steiner (two rows with a value)', () => {
    expect(html().split('class="patient"').length - 1).toBe(1);
  });
  it('a film with no AI points says so in the header ("none: every point placed by hand")', () => {
    expect(html(synthModel({ models: [] }))).toContain('none: every point placed by hand');
  });
  // Ruling (final-review.md's "known gap", fixed in model.ts this task): a "My analysis" whose EVERY
  // measurement is unavailable still gets a block in the preview — heading and the note, no rows, no sources.
  it('a "My analysis" with every measurement unavailable still shows its block (heading + the note, no rows)', () => {
    const myDef: MyAnalysisDef = { id: 'my:none', name: 'Nothing left SYNTHETIC', nodes: {}, mine: true,
      measurements: [], normFrom: {}, unavailable: ['m86_Nasolabial'] };
    const model = buildReport({ doc: synthDoc(), rows: [], cells: [], defs: [myDef], words: () => undefined, edits: {},
      scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 }, models: [], dateFormat: 'AU', now: NOW });
    const h = html(model);
    expect(h).toContain('<h3>Nothing left SYNTHETIC</h3>');
    expect(h).toContain('class="r-unavailable"');
    expect(h).toContain('Nothing left SYNTHETIC: 1 measurement no longer available (m86_Nasolabial).');
    expect(h).not.toContain('class="r-row"');
  });
});

// Owner N-A5, AUTO-Q10 (19 Oct 2026): the preview marks an Auto row with a ◆ in its norm cell and prints the
// footnote (with the ◆ typed here — the preview is HTML, not the PDF's Noto Sans, so it can; AUTO-Q10 covers
// only the PDF) before the context line, and addendum 2 J's list after it.
describe('the Report preview: Auto rows (N-A5)', () => {
  it('a ◆ on the Auto row\'s norm cell, and the footnote before the context line', () => {
    const m = synthModel({ cells: synthCells().map((c, i) => (c && i === 0 ? { ...c, auto: { population: 'japanese', populationWords: 'Japanese', step: 'caucasian', usedPopulation: 'Caucasian', source: 'McNamara 1984 Ann Arbor', n: 73 } } : c)) });
    const h = html(m);
    expect(h).toMatch(/<td>82\.0 ± 3\.5°<span class="r-auto"[^>]*> ◆<\/span><\/td>/);
    expect(h).toContain('class="report-auto-note"');
    expect(h.indexOf('report-auto-note')).toBeLessThan(h.indexOf(esc(CONTEXT_LINE)));
    expect(h).toContain('Caucasian norm used: McNamara 1984 Ann Arbor (n = 73)');
    // T10 M-6 (final review, 25 Oct 2026): the hover reads "the population chosen for this case" — "the patient's
    // population" implies a population attribute on the patient, which is not what Auto reads.
    expect(h).toContain('title="Auto: no norm in the population chosen for this case — see the note below"');
  });
  it('no Auto row: no ◆, no footnote', () => {
    const h = html();
    expect(h).not.toContain('r-auto');
    expect(h).not.toContain('report-auto-note');
  });
  it("addendum 2 J: the unstated-enlargement list prints after the Auto footnote, before the context line", () => {
    const m = synthModel({ cells: synthCells().map((c, i) => (c && i === 0 ? { ...c, flags: ['scale-assumed'], citation: 'Ricketts 1960' } : c)) });
    const h = html(m);
    expect(h).toContain('class="report-scale-note"');
    expect(h).toContain('Ricketts 1960');
    expect(h.indexOf('report-scale-note')).toBeLessThan(h.indexOf(esc(CONTEXT_LINE)));
  });
  // Review I-2 (fix round 1, 25 Oct 2026): an UNGRADED Auto row (no z: a "Needs: …" row, or a hidden mm row) still
  // gets its ◆ — the mark follows `r.auto`, never the grade. synthRows index 2 (Facial angle, Needs: Pog) and
  // index 4 (Co-A, hidden mm) had never been given an AutoNote before this fix.
  it('I-2: an ungraded Auto row (Needs: Pog, no z) and a hidden-mm Auto row (Co-A) still get the ◆', () => {
    const auto = { population: 'japanese', populationWords: 'Japanese', step: 'caucasian' as const, usedPopulation: 'Caucasian', source: 'McNamara 1984 Ann Arbor', n: 73 };
    const m = synthModel({ cells: synthCells().map((c, i) => (c && (i === 2 || i === 4) ? { ...c, auto } : c)) });
    const h = html(m);
    expect(h.split('r-auto').length - 1).toBe(2);
    expect(h).toMatch(/data-node="m04_FacialAngle"[\s\S]*?r-auto/);
    expect(h).toMatch(/data-node="m10_CoA"[\s\S]*?r-auto/);
  });
});

// R3 (B): the preview shows the fit's note once, under the tables and the context line, and the † on the mm value.
describe('R3: the preview of a fitted film', () => {
  const daggerOk = (c: number) => notoLike(c) || c === 0x2013 || c === 0x2020 || c === 0x00d7;
  it('the note once, after the context line; the † on the mm value; no "can\'t be printed" warning', () => {
    const m = synthFitModel(), h = html(m, { print: { ...print, noto: daggerOk } });
    expect(h.split(esc(m.fitNote!)).length - 1).toBe(1);
    expect(h.indexOf(esc(m.fitNote!))).toBeGreaterThan(h.indexOf(esc(CONTEXT_LINE)));
    expect(h).toContain('<td>95.3 mm †</td>');
    expect(h).toContain('class="report-fit-note"');
    expect(h).not.toContain('report-warn');
  });
  it('FONT-2 sees the † (positive control: a font without U+2020 warns about it)', () => {
    const h = html(synthFitModel(), { print: { ...print, noto: (c) => daggerOk(c) && c !== 0x2020 } });
    expect(h).toMatch(/report-warn">These letters can&#x27;t be printed[^<]*†/);
  });
  it('a calibrated film has no note', () => {
    expect(html()).not.toContain('report-fit-note');
  });
});

// Owner, 29 Oct 2026: the export window's new options (items 1, 3, 4, 5) and the Close button (item 7).
describe('owner, 29 Oct 2026: export options and the Close button', () => {
  it('item 7: Close is the LAST element in the preview, styled as the app\'s primary (blue) button — not at the top', () => {
    const h = html();
    const closeIdx = h.lastIndexOf('>Close<');
    expect(closeIdx).toBeGreaterThan(0);
    // Nothing of substance follows Close but the closing tags.
    expect(h.slice(closeIdx)).toMatch(/^>Close<\/button><\/div><\/div><\/div>$/);
    const closeTag = h.slice(h.lastIndexOf('<button', closeIdx), closeIdx);
    expect(closeTag).toContain('class="primary"');
  });
  it('positive control: Close used to be the first control, beside Save PDF… — proves the "last element" check above is not vacuously true for any markup', () => {
    const h = html();
    const actionsIdx = h.indexOf('report-actions');
    expect(actionsIdx).toBeLessThan(h.lastIndexOf('>Close<'));   // the (now empty) top actions bar still comes first
  });
  it('item 3: the long per-row norm-source paragraph is absent by default; the option prints it', () => {
    const off = html();
    expect(off).not.toContain('Steiner 1953 (SYNTHETIC source line)');
    const on = html(synthModel(), { options: { ...DEFAULT_REPORT_OPTIONS, profilogramPage: false, normSources: true, placedBy: false } });
    expect(on).toContain('Steiner 1953 (SYNTHETIC source line)');
  });
  it('item 4: "Placed by" is absent by default; the option adds the column and its value', () => {
    const m = synthModel({ points: [{ id: 'S', name: 'Sella', label: 'SYNTHETIC Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '', wholeFilmCheck: '', wholeFilmRegion: '' }] });
    const off = html(m);
    expect(off).not.toContain('SYNTHETIC Aariz');
    expect(off).toContain('<th>Point</th><th>Name</th><th>Point check</th><th>Whole-film check</th><th>Region</th></tr>');
    const on = html(m, { options: { ...DEFAULT_REPORT_OPTIONS, profilogramPage: false, normSources: false, placedBy: true } });
    expect(on).toContain('SYNTHETIC Aariz');
    expect(on).toContain('<th>Point</th><th>Name</th><th>Placed by</th><th>Point check</th><th>Whole-film check</th><th>Region</th></tr>');
  });
  // Stage A task 8: the Points table's last column. Fails if the cell is dropped, moved, or shows anything but the value.
  it('Stage A: the Points table has "Point check" (flagged, film-unusual, blank; never "wrong"), then Task 9\'s "Whole-film check"', () => {
    const base = { name: 'x', label: 'SYNTHETIC Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null };
    const m = synthModel({ points: [{ ...base, id: 'N', name: 'Nasion', pointCheck: 'flagged', wholeFilmCheck: '', wholeFilmRegion: '' }, { ...base, id: 'S', name: 'Sella', pointCheck: 'film-unusual', wholeFilmCheck: '', wholeFilmRegion: '' }, { ...base, id: 'B', name: 'B point', pointCheck: '', wholeFilmCheck: '', wholeFilmRegion: '' }] });
    for (const placedBy of [false, true]) {
      const h = html(m, { options: { ...DEFAULT_REPORT_OPTIONS, profilogramPage: false, normSources: false, placedBy } });
      const row = (id: string) => h.slice(h.indexOf(`data-point="${id}"`)).split('</tr>')[0];
      expect(row('N').endsWith('<td>flagged</td><td></td><td class="whole-region"></td>'), row('N')).toBe(true);
      expect(row('S').endsWith('<td>film-unusual</td><td></td><td class="whole-region"></td>'), row('S')).toBe(true);
      expect(row('B').endsWith('<td></td><td></td><td class="whole-region"></td>'), row('B')).toBe(true);
      expect(h.match(/<th>Point check<\/th><th>Whole-film check<\/th><th>Region<\/th><\/tr>/g)?.length).toBe(1);
    }
    expect(html(m)).not.toMatch(/wrong points/i);
    // Task 9: the film's value, on every row, in the last cell. Fails if the preview's cell is dropped or reads another field.
    const w = synthModel({ points: m.points.map((p) => ({ ...p, wholeFilmCheck: 'flagged:region-mandible+facing' })) });
    const hw = html(w), rowW = (id: string) => hw.slice(hw.indexOf(`data-point="${id}"`)).split('</tr>')[0];
    expect(['N', 'S', 'B'].map((id) => rowW(id).endsWith('<td>flagged:region-mandible+facing</td><td class="whole-region"></td>'))).toEqual([true, true, true]);
  });
  // Research switch off (owner, 6 Nov 2026). Fails if the preview still shows the column or a value when the points carry null.
  it('switch off: the preview Points table has no Whole-film column or value', () => {
    const m = synthModel({ points: [{ id: 'N', name: 'Nasion', label: 'SYNTHETIC Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: 'flagged', wholeFilmCheck: null, wholeFilmRegion: null }] });
    const h = html(m);
    expect(h).toContain('<th>Point check</th></tr>');
    expect(h).not.toContain('Whole-film');
    expect(h.slice(h.indexOf('data-point="N"')).split('</tr>')[0].endsWith('<td>flagged</td>')).toBe(true);
  });
  it('item 5: the chart sits beside the figure (both inside report-page-one-figure), not under each block\'s table', () => {
    const h = html();
    expect(h.match(/class="report-chart /g)?.length).toBe(1);   // one consolidated chart, not one per block
    expect(h).not.toMatch(/<div class="report-block">[\s\S]*?report-chart/);   // no block carries its own chart any more
    const wrap = h.slice(h.indexOf('report-page-one-figure'), h.indexOf('</section>'));
    expect(wrap).toContain('report-figure');
    expect(wrap).toContain('report-chart-beside');
    expect(wrap.indexOf('report-figure')).toBeLessThan(wrap.indexOf('report-chart-beside'));   // figure (left), then chart (right)
  });
  it('items 1-2: no profilogram page by default; one appears, after the tables, only with the option on', () => {
    expect(html()).not.toContain('report-profilogram-page');
    const on = html(synthModel(), { options: { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true, normSources: false, placedBy: false } });
    expect(on).toContain('report-profilogram-page');
    expect(on).toContain('<h2>Profilogram</h2>');
    expect(on.indexOf('report-profilogram-page')).toBeGreaterThan(on.indexOf('report-footer'));
  });

  // Fix round (ruling, 29 Oct 2026): the REQUIRED test — more chart rows than fit even at the old,
  // fixed row height. The preview must show exactly the rows/page-break the PDF does (pdf.test.ts's own
  // "REQUIRED" test, same 60-row fixture) — never drop a row.
  it('REQUIRED: more chart rows than fit even at the old row height — every row still appears in the preview, on a "continued" page, matching the PDF', () => {
    const base = synthModel(), rows = Array.from({ length: 60 }, (_, i) => ({ ...base.blocks[0].rows[0], key: `steiner:x${i}`, label: `SYNTHETIC row ${i}`, abbr: `R${i}` }));
    const m = { ...base, blocks: [{ ...base.blocks[0], rows }] };
    const h = html(m);
    // Every row's chart label (only the chart draws the bare abbreviation; the table draws "SYNTHETIC row N").
    for (let i = 0; i < 60; i++) expect(h).toContain(`>R${i}<`);
    expect(h).toContain('report-chart-continued');
    expect(h).toContain('Measurement chart, continued');
    // The same shape the PDF relies on: a continuation section exists, and it comes after page 1's own figure.
    expect(h.indexOf('report-chart-continued')).toBeGreaterThan(h.indexOf('report-page-one-figure'));
  });
  it('positive control: a short report (the default fixture) needs no continuation page — proves the check above is not vacuously true for any report', () => {
    expect(html()).not.toContain('report-chart-continued');
  });
});

// Owner, 5 Nov 2026: "Points table" off hides the whole Points section (heading and table) in the preview.
describe('owner, 5 Nov 2026: Points table option in the preview', () => {
  const m = synthModel({ points: [{ id: 'S', name: 'Sella', label: 'SYNTHETIC Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '', wholeFilmCheck: '', wholeFilmRegion: '' }] });
  it('on (the default): the Points heading and the row are there', () => {
    const h = html(m);
    expect(h).toContain('<h3>Points</h3>');
    expect(h).toContain('data-point="S"');
  });
  it('off: no Points heading, no table, no point rows', () => {
    const h = html(m, { options: { ...DEFAULT_REPORT_OPTIONS, pointsTable: false } });
    expect(h).not.toContain('<h3>Points</h3>');
    expect(h).not.toContain('report-points');
    expect(h).not.toContain('data-point=');
  });
  it('on but no points at all: no table (as before)', () => {
    expect(html(synthModel())).not.toContain('report-points');
  });
  it('off hides the CJK warning that only a point name would have raised', () => {
    const cjk = synthModel({ points: [{ id: 'S', name: '李 SYNTHETIC', label: 'Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '', wholeFilmCheck: '', wholeFilmRegion: '' }] });
    expect(html(cjk)).toContain('no font the PDF can use');
    expect(html(cjk, { options: { ...DEFAULT_REPORT_OPTIONS, pointsTable: false } })).not.toContain('no font the PDF can use');
  });
});

// Owner, 5 Nov 2026: the mm grid behind the profilogram page, in the preview.
describe('owner, 5 Nov 2026: the grid behind the profilogram in the preview', () => {
  const page = (h: string) => h.slice(h.indexOf('report-profilogram-page'));
  const on = { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true };
  it('calibrated, page ticked, grid on (the default): the profilogram page holds grid lines', () => {
    const h = page(html(synthModel(), { options: on }));
    expect(h).toContain('class="grid-minor"');
    expect(h).toContain('class="grid-major"');
  });
  it('grid unticked: none; page unticked: no page and no grid anywhere', () => {
    expect(html(synthModel(), { options: { ...on, profilogramGrid: false } })).not.toContain('grid-minor');
    const none = html(synthModel(), { options: { ...DEFAULT_REPORT_OPTIONS, profilogramPage: false } });
    expect(none).not.toContain('report-profilogram-page');
    expect(none).not.toContain('grid-minor');
  });
  it('uncalibrated film: the page still shows the profilogram, with no grid', () => {
    const h = html(synthModel(), { options: on, figureInput: { ...fi, scale: { mmPerPx: 0.1, source: 'assumed' as const } } });
    expect(h).toContain('report-profilogram-page');
    expect(h).not.toContain('grid-minor');
  });
});
