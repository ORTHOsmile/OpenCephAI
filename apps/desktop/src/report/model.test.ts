import { describe, it, expect } from 'vitest';
import type { AnalysisDef } from '@ceph/geometry';
import type { MyAnalysisDef } from '@ceph/analyses';
import severityMd from '../../../../docs/norms/SEVERITY.md?raw';
import type { MeasurementRow } from '../measurements';
import type { NormCell } from '../norms/normCell';
import type { Scale } from '../tracing/spacing';
import { NOW, cell, synthCells, synthDoc, synthInput, synthModel, synthRows } from './fixtures';
import { APP, CONTEXT_LINE, FOOTER, ageRowWords, allChartRows, autoFootnote, buildReport, chartRows, headerLines, isBlankChartRow, modelsUsed, normSourceSummary, reportTexts, DEFAULT_REPORT_OPTIONS, REPORT_OPTION_KEYS, unstatedScaleNote, visibleChartRows, type ChartRow } from './model';
import tauriConf from '../../src-tauri/tauri.conf.json';

describe('CONTEXT-LINE (owner, 16 Oct 2026): the owner\'s words, in the report only', () => {
  it('is word for word the line recorded in docs/norms/SEVERITY.md', () => {
    expect(severityMd.replace(/\s+/g, ' ')).toContain(`"${CONTEXT_LINE}"`);
  });
  const files = import.meta.glob('../**/*.{ts,tsx}', { query: '?raw', import: 'default' });
  it('no screen file outside the report carries the words (the screen never shows them)', async () => {
    const carrying: string[] = [];
    const needle = CONTEXT_LINE.split(';')[1].trim();   // built from the constant, so this test file never carries the words
    for (const [f, load] of Object.entries(files)) if (((await load()) as string).includes(needle)) carrying.push(f);
    // Not in the brief verbatim: Vite 5.4.21's import.meta.glob key is relative to THIS file's own directory
    // (src/report/), not to the pattern's '../' base — confirmed against the repo's other such guard
    // (branding.test.ts, same semantics: a file matches itself as './branding.test.ts'). model.ts, a sibling of
    // this test file, therefore keys as './model.ts'.
    expect(carrying.sort()).toEqual(['./model.ts']);
  });
});

describe('the report model (spec 2026-10-17): the rows the screen shows, grouped by analysis', () => {
  const m = synthModel();
  it('one block per analysis, in the screen order, each row in the screen order', () => {
    expect(m.blocks.map((b) => [b.name, b.rows.map((r) => r.label)])).toEqual([
      ['Steiner', ['SNA', 'ANB']], ['Downs', ['Facial angle', 'Y-axis']], ['McNamara', ['Co-A']]]);
  });
  it('Measurement · Mean ± SD · Result + stars · Meaning, as the screen shows them', () => {
    const [sna, anb] = m.blocks[0].rows;
    expect([sna.label, sna.norm, sna.result, sna.stars, sna.meaning]).toEqual(['SNA', '82.0 ± 3.5°', '84.8°', '', 'prognathic maxilla tendency']);
    expect([anb.result, anb.stars, anb.meaning, anb.abbr, anb.key]).toEqual(['6.2°', '**', 'Moderate Class II', 'ANB', 'steiner:m03_ANB']);
  });
  it('a row waiting on a point says so, with no stars and no meaning', () => {
    const fa = m.blocks[1].rows[0];
    expect([fa.result, fa.status, fa.stars, fa.meaning, fa.z, fa.num]).toEqual(['Needs: Pog', 'Needs: Pog', '', '', null, null]);
  });
  it('a row with no norm keeps its value and has no meaning', () => {
    const y = m.blocks[1].rows[1];
    expect([y.result, y.norm, y.meaning, y.status]).toEqual(['59.0°', 'No norm', '', 'measured']);
  });
  // Added for coverage (not in the brief's Step 2 verbatim code): the brief's edge-case list names "an
  // 'Undefined: points coincide' row" but none of the given Step 2 tests exercises it — measurements.ts sets
  // undefinedReason when every needed point is present but the geometry is undefined (e.g. two coincident
  // points); buildReport must read it through to status/result the same way it reads `needs`.
  it('an "Undefined: points coincide" row reads so, with no stars and no meaning', () => {
    const rows = synthRows(); rows[2] = { ...rows[2], needs: [], undefinedReason: 'Undefined: points coincide' };
    const r = synthModel({ rows }).blocks[1].rows[0];
    expect([r.result, r.status, r.stars, r.meaning, r.z, r.num]).toEqual(['Undefined: points coincide', 'Undefined: points coincide', '', '', null, null]);
  });
  it('a hidden mm value is never a number, even if a row arrived with one (N5)', () => {
    const rows = synthRows(); rows[4] = { ...rows[4], num: 5.3, value: '5.3 mm' };
    const cells = synthCells(); cells[4] = { ...cells[4]!, z: 9, severity: { stars: '***', word: 'Severe', side: 'above' }, mean: 1, sd: 0.5 };
    const co = synthModel({ rows, cells }).blocks[2].rows[0];
    expect([co.result, co.status, co.num, co.z, co.stars, co.meaning]).toEqual(['calibrate to show', 'calibrate to show', null, null, '', '']);
  });
  it('each block lists its norm sources once', () => {
    expect(m.blocks[0].sources).toEqual(['Steiner 1953 (SYNTHETIC source line)']);
  });
  it('a built-in block is never "unavailable"', () => {
    expect(m.blocks.map((b) => b.unavailable)).toEqual([null, null, null]);
  });
  // Merge-second follow-up (c), final-review.md: the report must take App.tsx's `defs` (R3, shownDefs after
  // "My analysis" merged), and a "My analysis" block with a dropped (no-longer-catalogued) measurement shows
  // unavailableLine(d) under its heading, as the Inspector does (Inspector.tsx's `gone`) — never as a row.
  it('a "My analysis" block with a dropped measurement shows unavailableLine(d) under its heading', () => {
    const myDef: MyAnalysisDef = { id: 'my:t1', name: 'My custom SYNTHETIC', nodes: {}, mine: true,
      measurements: [{ node: 'm01_SNA', label: 'SNA' }], normFrom: { m01_SNA: 'steiner' }, unavailable: ['m86_Nasolabial'] };
    const myRow: MeasurementRow = { analysis: 'My custom SYNTHETIC', analysisId: 'my:t1', normAnalysisId: 'steiner',
      node: 'm01_SNA', label: 'SNA', unit: 'deg', value: '84.8°', num: 84.8, hidden: false, needs: [], undefinedReason: null };
    const model = buildReport({ doc: synthDoc(), rows: [myRow], cells: [synthCells()[0]], defs: [myDef],
      words: () => undefined, edits: {}, scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 }, models: [], dateFormat: 'AU', now: NOW });
    expect(model.blocks).toHaveLength(1);
    expect(model.blocks[0].unavailable).toBe('My custom SYNTHETIC: 1 measurement no longer available (m86_Nasolabial).');
    expect(model.blocks[0].rows.map((r) => r.label)).toEqual(['SNA']);   // never shown as a row
    expect(reportTexts(model)).toContain('My custom SYNTHETIC: 1 measurement no longer available (m86_Nasolabial).');
  });
  // Task 8 fix round 1, review I1: a zero-row block was always appended last, regardless of where it sits in
  // `i.defs` (the screen's own enabled-analysis order, R3) — confirmed by the reviewer's own probe (Steiner,
  // empty My-analysis, Downs gave ['steiner', 'downs', 'my:empty'] instead of screen order).
  it('a zero-row "My analysis" block keeps its place in defs/screen order (R3), not always last', () => {
    const steinerDef: AnalysisDef = { id: 'steiner', name: 'Steiner', nodes: {}, measurements: [] };
    const downsDef: AnalysisDef = { id: 'downs', name: 'Downs', nodes: {}, measurements: [] };
    const emptyDef: MyAnalysisDef = { id: 'my:empty', name: 'Empty SYNTHETIC', nodes: {}, mine: true,
      measurements: [], normFrom: {}, unavailable: ['m86_Nasolabial'] };
    const rows: MeasurementRow[] = [
      { analysis: 'Steiner', analysisId: 'steiner', normAnalysisId: 'steiner', node: 'm01_SNA', label: 'SNA', unit: 'deg',
        value: '84.8°', num: 84.8, hidden: false, needs: [], undefinedReason: null },
      { analysis: 'Downs', analysisId: 'downs', normAnalysisId: 'downs', node: 'm24_YAxis', label: 'Y-axis', unit: 'deg',
        value: '59.0°', num: 59, hidden: false, needs: [], undefinedReason: null },
    ];
    // emptyDef sits BETWEEN steiner and downs in the screen's own switched-on order, even though no row names it.
    const model = buildReport({ doc: synthDoc(), rows, cells: [null, null], defs: [steinerDef, emptyDef, downsDef],
      words: () => undefined, edits: {}, scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 }, models: [], dateFormat: 'AU', now: NOW });
    expect(model.blocks.map((b) => b.analysisId)).toEqual(['steiner', 'my:empty', 'downs']);
  });
  // Task 8 (ruling, final-review.md's "known gap"): a "My analysis" with EVERY measurement unavailable has
  // no rows at all, so the per-row loop above never creates its block on its own — buildReport must still walk
  // `defs` (as Inspector.tsx's own `gone` does) so the heading and unavailableLine show with an empty table.
  it('a "My analysis" whose EVERY measurement is unavailable still gets its block, with no rows', () => {
    const myDef: MyAnalysisDef = { id: 'my:none', name: 'Nothing left SYNTHETIC', nodes: {}, mine: true,
      measurements: [], normFrom: {}, unavailable: ['m86_Nasolabial', 'm99_Gone'] };
    const model = buildReport({ doc: synthDoc(), rows: [], cells: [], defs: [myDef],
      words: () => undefined, edits: {}, scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 }, models: [], dateFormat: 'AU', now: NOW });
    expect(model.blocks).toHaveLength(1);
    expect(model.blocks[0]).toMatchObject({ analysisId: 'my:none', name: 'Nothing left SYNTHETIC', rows: [] });
    expect(model.blocks[0].unavailable).toBe('Nothing left SYNTHETIC: 2 measurements no longer available (m86_Nasolabial, m99_Gone).');
    expect(reportTexts(model)).toContain('Nothing left SYNTHETIC: 2 measurements no longer available (m86_Nasolabial, m99_Gone).');
  });
  it("prints the clinician's changed words while they still apply, and offers them back once they don't", () => {
    const kept = synthModel({ edits: { 'steiner:m03_ANB': { text: 'Moderate Class II, dental compensation', was: 'Moderate Class II' } } }).blocks[0].rows[1];
    expect([kept.meaning, kept.usual, kept.edited, kept.stale]).toEqual(['Moderate Class II, dental compensation', 'Moderate Class II', true, null]);
    const old = { text: 'compensated', was: 'Mild Class II' };
    const stale = synthModel({ edits: { 'steiner:m03_ANB': old } }).blocks[0].rows[1];
    expect([stale.meaning, stale.edited, stale.stale]).toEqual(['Moderate Class II', false, old]);
  });
  it('carries the full-precision numbers the CSV needs', () => {
    const anb = m.blocks[0].rows[1];
    expect([anb.num, anb.z, anb.mean, anb.sd, anb.severity, anb.side, anb.unit]).toEqual([6.2, 2.1, 2, 2, 'Moderate', 'above', 'deg']);
  });
});

describe('the report header', () => {
  // "Report made" uses the computer's own time zone (localDay): '18/10/2026' holds in Sydney and in UTC, where this
  // suite runs (preflight-rulings Task 4, Minor) — not west of UTC-2.
  it('reads the film the way the clinician enters it', () => {
    expect(headerLines(synthModel().header)).toEqual([
      ['Patient', 'SYNTHETIC Demo'], ['Library ID', 'L-00042'], ['Date of birth', '07/03/2010 (age 13.9 at the film)'],   // SYNTHETIC
      ['Film date', '07/02/2024'], ['Timepoint', 'T1'],
      ['Scale', "calibrated from the film's ruler (0.1000 mm per pixel)"], ['AI models', 'Aariz'],
      ['Verification', 'Not verified: the tracing has not been signed off'], ['Report made', '18/10/2026']]);
  });
  // L2 (preflight-rulings Task 11): an unnamed patient has not been matched into the library yet.
  it('L2: an unnamed patient has no library number yet, and says so', () => {
    const h = synthModel({ doc: synthDoc({ patientName: ' ', libraryId: null }) }).header;
    expect(headerLines(h)[1]).toEqual(['Library ID', 'none yet (name the patient first)']);
  });
  it('says plainly what is missing or assumed', () => {
    const h = synthModel({ doc: synthDoc({ patientName: ' ', dateOfBirth: null, takenOn: null, timepoint: '', verifiedAt: '2024-02-08T10:00:00Z', verifiedBy: null }),
      scale: { mmPerPx: 0.1, source: 'assumed' }, models: [], dateFormat: 'US' }).header;
    expect([h.patient, h.dob, h.age, h.filmDate, h.timepoint, h.verified, h.models]).toEqual(
      ['Name needed', 'not recorded', null, 'not recorded', '—', 'All points approved by unknown on 02/08/2024', 'none: every point placed by hand']);
    expect(h.scale).toBe('assumed (0.1 mm per pixel): not calibrated, so mm values are not shown');
    expect(headerLines(h)[2]).toEqual(['Date of birth', 'not recorded']);
  });
  it('no age when the film is dated before the birth', () => {
    expect(synthModel({ doc: synthDoc({ takenOn: '2009-01-01' }) }).header.age).toBeNull();
  });
  it('the footer and the app name', () => {
    const m = synthModel();
    expect([m.footer, m.app, m.contextLine]).toEqual([FOOTER, APP, CONTEXT_LINE]);
    expect(APP).toMatch(/^OpenCephAI \d+\.\d+\.\d+ \(Beta\)$/);   // productName + version, once; Beta label, owner 2 Nov 2026
    expect(APP).toBe(`OpenCephAI ${tauriConf.version} (Beta)`);   // derives from the real app version
    expect(m.film).toMatchObject({ id: 'c1', patientKey: 'synthetic demo', dateOfBirth: '2010-03-07', takenOn: '2024-02-07', gender: 'F', printedPatientId: 'SYNTHETIC-PID-5566', scanId: 'SYNTHETIC-4471', models: ['Aariz'] });   // SYNTHETIC
    expect(m.film.age).toBeCloseTo(13 + 337 / 365.2425, 9);
    expect(NOW.toISOString()).toBe('2026-10-18T02:00:00.000Z');
  });
});

describe('the AI models named in the header', () => {
  const title = (id: string) => ({ aariz: 'Aariz', srpose: 'SRPose' }[id] ?? id);
  it('the models that placed the points now on the film, most points first; hand-placed points name none', () => {
    expect(modelsUsed([{ source: 'ai', placer: 'srpose' }, { source: 'ai', placer: 'aariz' }, { source: 'ai-adjusted', placer: 'aariz' }, { source: 'manual', placer: null }], title))
      .toEqual(['Aariz', 'SRPose']);
    expect(modelsUsed([{ source: 'manual', placer: null }], title)).toEqual([]);
    expect(modelsUsed([{ source: 'ai', placer: null }], title)).toEqual(['model not recorded']);
  });
});

describe('the chart rows of a block', () => {
  it('abbreviation, z, mean, SD and unit; a row without a z has none', () => {
    expect(chartRows(synthModel().blocks[0])).toEqual([
      { abbr: 'SNA', z: 0.8, mean: 82, sd: 3.5, unit: 'deg' }, { abbr: 'ANB', z: 2.1, mean: 2, sd: 2, unit: 'deg' }]);
    expect(chartRows(synthModel().blocks[1])[0]).toEqual({ abbr: 'Fac ang', z: null, mean: null, sd: null, unit: 'deg' });
  });
});

// Owner, 29 Oct 2026 (the zig-zag plot beside the ceph): the consolidated chart must be the screen's own rows, in
// the screen's own order — proved against the blocks' own ReportRow.node (the field the Inspector's Chart tab
// itself walks, in `rows` order), not a value recomputed here.
describe('allChartRows order matches the screen (owner, 29 Oct 2026)', () => {
  it('every block\'s rows, flattened, are in exactly the order the screen\'s rows/cells were given in', () => {
    const m = synthModel();
    expect(m.blocks.flatMap((b) => b.rows.map((r) => r.node))).toEqual(synthRows().map((r) => r.node));
    expect(allChartRows(m).length).toBe(synthRows().length);
  });
  it('positive control: a model whose rows were deliberately reordered fails the same check (proves it is not vacuous)', () => {
    const reordered = [...synthRows()].reverse();
    expect(reordered.map((r) => r.node)).not.toEqual(synthRows().map((r) => r.node));
  });
});

// Owner, 29 Oct 2026: a row the screen's Chart tab would draw blank (no dot, no norm band — U6-NA, L6-NB, Pog-NB
// in the owner's example) is dropped from the print chart entirely, not left as an empty row; the remaining rows'
// dots still join with one line, with no gap where the blank row was.
describe('isBlankChartRow / visibleChartRows (owner, 29 Oct 2026)', () => {
  const filled1: ChartRow = { abbr: 'SNA', z: 0.8, mean: 82, sd: 3.5, unit: 'deg' };
  const filled2: ChartRow = { abbr: 'ANB', z: 2.1, mean: 2, sd: 2, unit: 'deg' };
  // U6-NA: the patient's value is missing (no z), even though a norm exists (mean/sd present) — e.g. the tooth
  // was not measured on this film.
  const blankNoValue: ChartRow = { abbr: 'U6-NA', z: null, mean: 95, sd: 4, unit: 'mm' };
  // L6-NB: there is no norm at all for this measurement in the population used (mean/sd/z all null).
  const blankNoNorm: ChartRow = { abbr: 'L6-NB', z: null, mean: null, sd: null, unit: 'mm' };

  it('a blank row between two filled rows is dropped; the line joins the two filled rows directly', () => {
    const rows = [filled1, blankNoValue, filled2];
    expect(visibleChartRows(rows)).toEqual([filled1, filled2]);
  });
  it('control: include the blank row anyway, and the same equality fails (proves the drop above is not vacuous)', () => {
    const rows = [filled1, blankNoValue, filled2];
    expect(rows).not.toEqual([filled1, filled2]);   // the un-filtered array still carries the blank row
  });
  it('the "no norm at all" reason is blank too', () => {
    expect(isBlankChartRow(blankNoNorm)).toBe(true);
    expect(visibleChartRows([filled1, blankNoNorm, filled2])).toEqual([filled1, filled2]);
  });
  it('a filled row is never dropped', () => {
    expect(isBlankChartRow(filled1)).toBe(false);
    expect(visibleChartRows([filled1, filled2])).toEqual([filled1, filled2]);
  });
});

// Owner report request (29 Oct 2026): one plain sentence naming which norms were used, shown by default — built
// straight from the resolver's own sex/population/age-row, never recomputed (normCell.ts carries them).
describe('normSourceSummary (owner, 29 Oct 2026): the one-sentence norm summary', () => {
  const used = (normSex: 'M' | 'F' | 'pooled', normPopulation: string, normAgeRowUsed: string | null) =>
    cell({ normSex, normPopulation, normAgeRowUsed });
  describe('owner decisions 1 and 4 (29 Oct 2026): the sentence says how Auto chose', () => {
    const pc = (how: 'background' | 'clinic-default' | 'best-evidence' | 'combined', label: string, ageCovered = true) =>
      ({ population: 'x', how, setId: null, ageCovered, label });
    it('each step', () => {
      expect(normSourceSummary([used('M', 'Chinese', '18 y and over')], pc('background', 'Chinese')))
        .toBe("We used the norms for the male Chinese population for adults (chosen automatically from the patient's demographics).");   // owner R6, 3 Nov 2026
      expect(normSourceSummary([used('F', 'Caucasian', '18 y and over')], pc('clinic-default', 'Caucasian')))
        .toBe('We used the norms for the female Caucasian population for adults (chosen automatically: clinic default).');
      expect(normSourceSummary([used('F', 'Swedish', '18 y and over')], pc('best-evidence', 'Swedish')))
        .toBe('We used the norms for the female Swedish population for adults (chosen automatically: no background or clinic default recorded, so the largest study with norms for this sex and age).');
      expect(normSourceSummary([used('M', 'Chinese', '18 y and over')], pc('best-evidence', 'Chinese', false)))
        .toBe('We used the norms for the male Chinese population for adults (chosen automatically: no background or clinic default recorded, so the largest study with norms for this sex, at the nearest age).');
    });
    it('owner R1/R5 and R6 (3 Nov 2026): the combined adult norm, by sex; sex not recorded; with other rows', () => {
      expect(normSourceSummary([used('M', 'combined adult', '18 y and over')], pc('combined', 'combined adult')))
        .toBe("We used combined adult norms for men, from every adult study in the app weighted by size (chosen automatically from the patient's demographics).");
      expect(normSourceSummary([used('F', 'combined adult', '18 y and over')], pc('combined', 'combined adult')))
        .toBe("We used combined adult norms for women, from every adult study in the app weighted by size (chosen automatically from the patient's demographics).");
      expect(normSourceSummary([used('pooled', 'combined adult', '18 y and over')], pc('combined', 'combined adult')))
        .toBe("We used combined adult norms for men and women, from every adult study in the app weighted by size (chosen automatically from the patient's demographics).");
      expect(normSourceSummary([used('F', 'combined adult', '18 y and over'), used('F', 'combined adult', '18 y and over'), used('F', 'Swedish', '29–32 y')], pc('combined', 'combined adult')))
        .toBe("We used combined adult norms for women, from every adult study in the app weighted by size (chosen automatically from the patient's demographics); some measurements use a single study or other norms (marked ◆).");
    });
    it('the bracket before the "other norms" clause when rows are mixed', () => {
      const rows = [used('F', 'Swedish', '18 y and over'), used('F', 'Swedish', '18 y and over'), used('F', 'Caucasian', '18 y and over')];
      expect(normSourceSummary(rows, pc('best-evidence', 'Swedish'))).toBe('We used the norms for the female Swedish population for adults (chosen automatically: no background or clinic default recorded, so the largest study with norms for this sex and age); some measurements use other norms (marked ◆).');
    });
    it('no bracket when most rows are another population, or the population was chosen by hand', () => {
      const rows = [used('M', 'Caucasian', '18 y and over'), used('M', 'Caucasian', '18 y and over'), used('M', 'Swedish', '18 y and over')];
      expect(normSourceSummary(rows, pc('best-evidence', 'Swedish'))).toBe('We used the norms for the male Caucasian population for adults; some measurements use other norms (marked ◆).');
      expect(normSourceSummary([used('M', 'Chinese', '18 y and over')], null)).toBe('We used the norms for the male Chinese population for adults.');
      expect(normSourceSummary([used('M', 'Chinese', '18 y and over')])).toBe('We used the norms for the male Chinese population for adults.');
      expect(normSourceSummary([], pc('background', 'Chinese'))).toBeNull();
    });
    it('sex not recorded: an averaged row still reads "pooled" (owner NAP-Q4 (b)), like a paper\'s own pooled row', () => {
      const avg = { ...used('pooled', 'Chinese', '18 y and over'), flags: ['sexes-averaged' as const] };
      expect(normSourceSummary([avg])).toBe('We used the norms for the pooled Chinese population for adults.');
      expect(normSourceSummary([avg], pc('clinic-default', 'Chinese'))).toBe('We used the norms for the pooled Chinese population for adults (chosen automatically: clinic default).');
    });
  });
  it('male, female and pooled', () => {
    expect(normSourceSummary([used('M', 'Chinese', '18 y and over')])).toBe('We used the norms for the male Chinese population for adults.');
    expect(normSourceSummary([used('F', 'Chinese', '18 y and over')])).toBe('We used the norms for the female Chinese population for adults.');
    expect(normSourceSummary([used('pooled', 'Caucasian', '18 y and over')])).toBe('We used the norms for the pooled Caucasian population for adults.');
  });
  it('positive control: a different sex, population or age word really does change the sentence (not vacuously the same string every time)', () => {
    const a = normSourceSummary([used('M', 'Chinese', '18 y and over')]);
    expect(normSourceSummary([used('F', 'Chinese', '18 y and over')])).not.toBe(a);
    expect(normSourceSummary([used('M', 'Caucasian', '18 y and over')])).not.toBe(a);
    expect(normSourceSummary([used('M', 'Chinese', '8 y')])).not.toBe(a);
  });
  it('adults: a row with no age band (holds for every age), and a "N y and over" band', () => {
    expect(normSourceSummary([used('M', 'Caucasian', null)])).toBe('We used the norms for the male Caucasian population for adults.');
    expect(normSourceSummary([used('M', 'Caucasian', '18 y and over')])).toBe('We used the norms for the male Caucasian population for adults.');
  });
  it('children of a given age: a single-value row, including an interpolated one', () => {
    expect(normSourceSummary([used('F', 'Chinese', '8 y')])).toBe('We used the norms for the female Chinese population for children aged 8 years.');
    expect(normSourceSummary([used('F', 'Chinese', '8.2 y (interpolated 7–9 y)')])).toBe('We used the norms for the female Chinese population for children aged 8 years.');
  });
  it('children: a range under 18 with no single age to name', () => {
    expect(normSourceSummary([used('pooled', 'Chinese', '6–12 y')])).toBe('We used the norms for the pooled Chinese population for children.');
  });
  it('positive control for the ages: without the age-band branch, "6–12 y" would read as "children aged 6 years" (the first number alone) — the range check is what tells them apart', () => {
    expect(ageRowWords('6–12 y')).toBe('children');
    expect(ageRowWords('6–12 y')).not.toBe(ageRowWords('6 y'));
  });
  it('the mixed case: some rows used a different population (an Auto ◆ fallback, or a hand-chosen source)', () => {
    const rows = [used('M', 'Chinese', '8 y'), used('M', 'Chinese', '8 y'), used('M', 'Caucasian', '8 y')];
    expect(normSourceSummary(rows)).toBe('We used the norms for the male Chinese population for children aged 8 years; some measurements use other norms (marked ◆).');
  });
  it('positive control: all rows agreeing on one population never adds the mixed clause', () => {
    expect(normSourceSummary([used('M', 'Chinese', '8 y'), used('M', 'Chinese', '8 y')])).not.toContain('marked ◆');
  });
  it('no norm used at all: no sentence', () => {
    expect(normSourceSummary([cell({}), null])).toBeNull();
  });

  // Fix round (ruling, minor finding 4, 29 Oct 2026): the tie-break, documented and tested.
  describe('the majority tie-break (minor finding 4, fix round)', () => {
    it('two populations tied 1-1: the FIRST ROW ENCOUNTERED wins, not alphabetical order', () => {
      // "Zulu" sorts after "Chinese" alphabetically, but is listed FIRST here — proves it is row order, not A-Z.
      const rows = [used('M', 'Zulu', '8 y'), used('M', 'Chinese', '8 y')];
      expect(normSourceSummary(rows)).toBe('We used the norms for the male Zulu population for children aged 8 years; some measurements use other norms (marked ◆).');
    });
    it('swap which row comes first, and the winner swaps too — it is reproducible from the rows alone, not fixed to one population', () => {
      const rows = [used('M', 'Chinese', '8 y'), used('M', 'Zulu', '8 y')];
      expect(normSourceSummary(rows)).toBe('We used the norms for the male Chinese population for children aged 8 years; some measurements use other norms (marked ◆).');
    });
    it('a tie at 2-2 (not just 1-1) resolves the same way: first encountered', () => {
      const rows = [used('M', 'Zulu', '8 y'), used('M', 'Zulu', '8 y'), used('M', 'Chinese', '8 y'), used('M', 'Chinese', '8 y')];
      expect(normSourceSummary(rows)).toBe('We used the norms for the male Zulu population for children aged 8 years; some measurements use other norms (marked ◆).');
    });
    it('positive control: a genuine majority (not a tie) always wins regardless of row order — proves the tie-break above only fires on an actual tie', () => {
      const majorityFirst = [used('M', 'Chinese', '8 y'), used('M', 'Chinese', '8 y'), used('M', 'Zulu', '8 y')];
      const majorityLast = [used('M', 'Zulu', '8 y'), used('M', 'Chinese', '8 y'), used('M', 'Chinese', '8 y')];
      expect(normSourceSummary(majorityFirst)).toContain('Chinese');
      expect(normSourceSummary(majorityLast)).toContain('Chinese');
    });
  });
});

describe('reportTexts (owner FONT-2): every string the PDF prints', () => {
  it('header, block names, each row\'s label/norm/result+stars/meaning, sources, the context line, footer and app', () => {
    const t = reportTexts(synthModel());
    for (const s of ['SYNTHETIC Demo', '07/03/2010 (age 13.9 at the film)', 'Report made'])   // header label/value pairs
      expect(t).toContain(s);
    expect(t).toContain('Steiner');                       // block name
    expect(t).toContain('SNA');                            // a row's label
    expect(t).toContain('82.0 ± 3.5°');                     // that row's norm
    expect(t).toContain('6.2° **');                         // ANB's result WITH its stars, joined as pdf.ts prints it
    expect(t).toContain('Moderate Class II');                // that row's meaning
    expect(t).toContain('Steiner 1953 (SYNTHETIC source line)');   // a source line
    expect(t).toContain(CONTEXT_LINE);
    expect(t).toContain(FOOTER);
    expect(t).toContain(APP);
    expect(t).not.toContain('6.2°'); // positive control: the bare result (no stars) must NOT appear on its own for a starred row
  });
  it('a changed meaning replaces the usual words', () => {
    const m = synthModel({ edits: { 'steiner:m03_ANB': { text: 'Moderate Class II, dental compensation', was: 'Moderate Class II' } } });
    expect(reportTexts(m)).toContain('Moderate Class II, dental compensation');
  });
  it('no analyses switched on: still the header, context line, footer and app, no block names', () => {
    const t = reportTexts({ ...synthModel(), blocks: [] });
    expect(t).toContain(CONTEXT_LINE);
    expect(t.some((s) => s === 'Steiner')).toBe(false);
  });
});

// Owner N-A5 (19 Oct 2026): rows Auto filled carry ◆ in the report, and a footnote names them.
describe('report: Auto rows (N-A5)', () => {
  const own = { population: 'japanese', populationWords: 'Japanese', step: 'analysis-own' as const, usedPopulation: null, source: "Steiner's own norm", n: null };
  const cau = { population: 'japanese', populationWords: 'Japanese', step: 'caucasian' as const, usedPopulation: 'Caucasian', source: 'McNamara 1984 Ann Arbor', n: 73 };
  const any = { population: 'japanese', populationWords: 'Japanese', step: 'anywhere' as const, usedPopulation: 'Chinese', source: 'Zheng 2026 Beijing', n: 60 };
  it('the footnote names each step and its rows; no Auto row → none', () => {
    const rows = [{ label: 'SNA' }, { label: 'Upper pharynx' }, { label: 'Pog to NB' }, { label: 'SNB' }] as MeasurementRow[];
    const cells = [{ auto: own }, { auto: cau }, { auto: any }, { auto: null }] as NormCell[];
    expect(autoFootnote(rows, cells)).toBe("No Japanese norm for these measurements; Steiner's own norm used for SNA; Caucasian norm used: McNamara 1984 Ann Arbor (n = 73) for Upper pharynx; Chinese norm used: Zheng 2026 Beijing (n = 60) for Pog to NB.");
    expect(autoFootnote(rows, [{ auto: null }, { auto: null }, { auto: null }, null] as (NormCell | null)[])).toBeNull();
  });
  it('addendum 2 J: the papers that did not state their X-ray enlargement, each once, with its rows; none → null', () => {
    const rows = [{ label: 'Upper lip to E-line' }, { label: 'Lower lip to E-line' }, { label: 'SNA' }] as MeasurementRow[];
    const r60 = { flags: ['scale-assumed', 'sd-borrowed'], citation: 'Ricketts 1960' };
    const cells = [r60, r60, { flags: ['ideal'], citation: 'Steiner 1953' }] as NormCell[];
    // Review M-1 (fix round 1): labels joined with " · " (a label itself may hold a comma, e.g. "U1–NA (mm), tip").
    expect(unstatedScaleNote(rows, cells)).toBe('Norms whose papers did not state their X-ray enlargement (mm taken as true size): Ricketts 1960 (Upper lip to E-line · Lower lip to E-line).');
    expect(unstatedScaleNote(rows, [cells[2], null, cells[2]] as (NormCell | null)[])).toBeNull();
  });
  // Review M-1 (fix round 1): the same label under the same paper from two different rows (e.g. two analyses
  // sharing a measurement) must not repeat — the real golden line showed "Lower lip to E-line (mm), Lower lip to
  // E-line (mm)" before this fix.
  it('M-1: the same label under the same paper is listed once, not repeated', () => {
    const rows = [{ label: 'Lower lip to E-line' }, { label: 'Lower lip to E-line' }] as MeasurementRow[];
    const r81 = { flags: ['scale-assumed'], citation: 'Ricketts 1981' };
    expect(unstatedScaleNote(rows, [r81, r81] as NormCell[])).toBe('Norms whose papers did not state their X-ray enlargement (mm taken as true size): Ricketts 1981 (Lower lip to E-line).');
  });
  // Review M-2 (fix round 1): a norm whose own paper states its scale, but whose SD was borrowed from a paper that
  // did not, still names that donor paper here — `sdDonorCitation`, separate from `citation` (the mean's own paper).
  it('M-2: a borrowed-SD-only paper (its own mean stated the scale) is named too', () => {
    const rows = [{ label: 'SNA' }, { label: 'ANB' }] as MeasurementRow[];
    const cells = [{ flags: ['sd-borrowed'], citation: 'Smith 2000', sdDonorCitation: 'Fu 1975' }, { flags: [], citation: 'Smith 2000', sdDonorCitation: null }] as NormCell[];
    expect(unstatedScaleNote(rows, cells)).toBe('Norms whose papers did not state their X-ray enlargement (mm taken as true size): Fu 1975 (SNA).');
  });
  it('buildReport marks exactly the Auto rows and carries the footnote; reportTexts has it, without ◆', () => {
    const m = synthModel({ cells: synthCells().map((c, i) => (c && i === 0 ? { ...c, auto: cau } : c)) });
    expect(m.blocks.flatMap((b) => b.rows.map((r) => r.auto))).toEqual(m.blocks.flatMap((b) => b.rows.map((_, i) => i === 0 && b === m.blocks[0])));
    expect(m.autoNote).toContain('Caucasian norm used: McNamara 1984 Ann Arbor (n = 73)');
    expect(reportTexts(m)).toContain(m.autoNote);
    expect(reportTexts(m).some((t) => t.includes('◆'))).toBe(false);
  });
  // Review I-2 (fix round 1): `auto` is true on an UNGRADED Auto row too (a Needs row, a hidden mm row) — the
  // model layer, not only the PDF/preview's own gates.
  it('I-2: auto is true on an ungraded Auto row (Needs: Pog) and a hidden-mm Auto row (Co-A)', () => {
    const auto = cau;
    const m = synthModel({ cells: synthCells().map((c, i) => (c && (i === 2 || i === 4) ? { ...c, auto } : c)) });
    expect(m.blocks[1].rows[0].auto).toBe(true);   // Downs: Facial angle (Needs: Pog, no z)
    expect(m.blocks[2].rows[0].auto).toBe(true);   // McNamara: Co-A (hidden mm)
  });
  // Review I-3 (fix round 1): `buildReport` itself must set `autoStep` — a CSV test writing it straight onto a
  // `ReportRow` literal never exercises this wiring. Review + owner ruling (25 Oct 2026): a row the clinician
  // picked by hand (resolve.ts ~151-156, flag 'chosen-by-you') also compares the patient with another group's
  // norm, so `autoStep` (and the CSV's `norm_auto`) reads 'chosen' for it too — distinct from an Auto step, and
  // never both at once (the resolver takes the picked-source path before Auto is ever tried).
  it("I-3: autoStep travels through buildReport — 'analysis-own'/'caucasian'/'anywhere' for Auto, 'chosen' for a hand-picked row, null for the patient's own population", () => {
    const picked = { ...synthCells()[0]!, flags: ['chosen-by-you' as const] };
    const m = synthModel({ cells: [picked, { ...synthCells()[1]!, auto: cau }, synthCells()[2], synthCells()[3], synthCells()[4]] });
    expect(m.blocks.flatMap((b) => b.rows.map((r) => r.autoStep))).toEqual(['chosen', 'caucasian', null, null, null]);
  });
  it('an own-norm Auto row with n null omits "n not stated"; two rows from one Caucasian source name both', () => {
    const rows = [{ label: 'SNA' }, { label: 'ANB' }] as MeasurementRow[];
    const cells = [{ auto: own }, { auto: cau }] as NormCell[];
    expect(autoFootnote(rows, cells)).not.toContain('n not stated');
    const sameSource = [{ auto: cau }, { auto: cau }] as NormCell[];
    // Review M-1 (fix round 1): " · " join, the same as unstatedScaleNote's.
    expect(autoFootnote(rows, sameSource)).toBe('No Japanese norm for these measurements; Caucasian norm used: McNamara 1984 Ann Arbor (n = 73) for SNA · ANB.');
  });
  it('two populations group separately even with one case (compare-free): the grouping still works with two synthetic notes', () => {
    const otherPop = { population: 'chinese', populationWords: 'Chinese', step: 'caucasian' as const, usedPopulation: 'Caucasian', source: 'Downs 1948', n: 50 };
    const rows = [{ label: 'SNA' }, { label: 'ANB' }] as MeasurementRow[];
    const cells = [{ auto: own }, { auto: otherPop }] as NormCell[];
    expect(autoFootnote(rows, cells)).toBe("No Japanese norm for these measurements; Steiner's own norm used for SNA. No Chinese norm for these measurements; Caucasian norm used: Downs 1948 (n = 50) for ANB.");
  });
  // T10 M-7 (1) (final review, 25 Oct 2026): the previous version of this test called `unstatedScaleNote` directly
  // with hand-built `rows`/`cells` that never set `hidden` — so it could not tell the difference between a hidden
  // mm row and a shown one; it passed for the wrong reason. Rebuilt through `buildReport` with the fixtures'
  // actually-hidden Co-A row (`synthRows()[4]`, `hidden: true`), to prove the note is built from the real
  // hidden-mm row, not a stand-in that never sets the flag.
  it('an unstated-scale row whose mm value is hidden is still listed — the norm is what is described', () => {
    const cells = synthCells();
    cells[4] = { ...cells[4]!, flags: ['scale-assumed'], citation: 'Ricketts 1960' };
    const model = synthModel({ cells });
    expect(model.scaleNote).toBe('Norms whose papers did not state their X-ray enlargement (mm taken as true size): Ricketts 1960 (Co-A).');
    expect(model.blocks[2].rows[0].hidden).toBe(true);   // McNamara: Co-A, the row the note is actually about
  });
});

// R3 (B, final-review.md C1): a film whose mm come from a fit ("Use the scale from the fit" on) says so in the
// report — the header names the fit, each shown mm value carries the screen's †, and one note under the tables gives
// the fit and the owner's G2 sentence. Calibrated and assumed films are unchanged. SYNTHETIC.
describe('R3 (B): a report on the fit\'s scale', () => {
  const fitScale = (refAssumed = false): Scale => ({ mmPerPx: 0.1 * 1.042, source: 'fit', fit: { ref: 'T1', kind: 'sn', k: 1.042, refAssumed } });
  // with a fit scale nothing is hidden (measurements.ts hides only on 'assumed'): Co-A carries its number
  const fitRows = (): MeasurementRow[] => synthRows().map((r) => (r.node === 'm10_CoA' ? { ...r, hidden: false, value: '95.3 mm', num: 95.3 } : r));
  const fitted = (refAssumed = false) => synthModel({ doc: synthDoc({ timepoint: 'T2', spacingMm: null }), rows: fitRows(), scale: fitScale(refAssumed) });
  it('the header names the fit, at 4 decimals, and never says mm are not shown', () => {
    const h = fitted().header.scale;
    expect(h).toBe('from a fit: 0.1042 mm per pixel (scaled to T1 on S–N (×1.042)) †');
    expect(h).not.toContain('not shown');
    expect(h).not.toContain('0.10420000000000001');
  });
  it('each shown mm value ends in " †"; no angle does; the CSV number is unchanged', () => {
    const rows = fitted().blocks.flatMap((b) => b.rows);
    const coa = rows.find((r) => r.node === 'm10_CoA')!;
    expect([coa.result, coa.num, coa.status]).toEqual(['95.3 mm †', 95.3, 'measured']);
    expect(rows.filter((r) => r.unit !== 'mm').some((r) => r.result.includes('†'))).toBe(false);
    expect(rows.find((r) => r.node === 'm03_ANB')!.result).toBe('6.2°');
  });
  it('an mm row with no number (waiting on a point) gets no †', () => {
    const m = synthModel({ doc: synthDoc({ timepoint: 'T2' }), rows: synthRows().map((r) => (r.node === 'm10_CoA' ? { ...r, hidden: false, needs: ['Co'] } : r)), scale: fitScale() });
    expect(m.blocks[2].rows[0].result).toBe('Needs: Co');
  });
  it('the note: the film, the fit, and the owner\'s G2 sentence', () => {
    expect(fitted().fitNote).toBe('† T2 scaled to T1 on S–N (×1.042). This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1.');
  });
  it('G3 (the reference had no ruler either): the header and note say "assumed scale", and the second G2 sentence', () => {
    const m = fitted(true);
    expect(m.header.scale).toBe('from a fit: 0.1042 mm per pixel (scaled to T1 on S–N (×1.042), assumed scale) †');
    expect(m.fitNote).toBe('† T2 scaled to T1 on S–N (×1.042), assumed scale. This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1. T1 had no ruler either, so both are on the assumed scale.');
  });
  it('a film with no timepoint is named "This film" in the note', () => {
    expect(synthModel({ doc: synthDoc({ timepoint: ' ' }), rows: fitRows(), scale: fitScale() }).fitNote).toMatch(/^† This film scaled to T1/);
  });
  it('the note and the † are among the strings the PDF prints (FONT-2)', () => {
    const t = reportTexts(fitted());
    expect(t).toContain(fitted().fitNote);
    expect(t).toContain('95.3 mm †');
    expect(t).toContain('from a fit: 0.1042 mm per pixel (scaled to T1 on S–N (×1.042)) †');
  });
  it('calibrated and assumed films: the header is main\'s, word for word; no note; no † anywhere', () => {
    const cal = synthModel({ scale: { mmPerPx: 0.0937, source: 'calibration', steps: 0 } }), ass = synthModel({ scale: { mmPerPx: 0.1, source: 'assumed' } });
    expect(cal.header.scale).toBe("calibrated from the film's ruler (0.0937 mm per pixel)");
    expect(ass.header.scale).toBe('assumed (0.1 mm per pixel): not calibrated, so mm values are not shown');
    for (const m of [cal, ass]) { expect(m.fitNote).toBeNull(); expect(JSON.stringify(m)).not.toContain('†'); expect(reportTexts(m).join('\n')).not.toContain('†'); }
  });
  it('a fine-tuned calibration says so in the header (spec 2026-10-19 addendum 3); no press reads as before', () => {
    expect(synthModel({ scale: { mmPerPx: 0.101, source: 'calibration', steps: 2 } }).header.scale)
      .toBe("calibrated scale, adjusted +1.0 % from the film's ruler (0.1010 mm per pixel)");
    expect(synthModel({ scale: { mmPerPx: 0.0937, source: 'calibration', steps: 0 } }).header.scale).toBe("calibrated from the film's ruler (0.0937 mm per pixel)");
  });
});

// MS3 (owner, 20 Oct; decision 16): a machine-scaled film's header names the machine and its source, with the mm
// per pixel — the same words as `machineWords` (MS-4); every other film's header is main's, unchanged.
describe('MS3: a machine-scaled film\'s header names the machine (decision 16)', () => {
  const machine = { machineId: 'm1', machineName: 'Demo Radiology', spacingMm: 0.0998, widthPx: 2400, heightPx: 3000, source: 'film' as const,
    sourceCaseId: 'c9', sourceFilmDate: '2025-03-12', setAt: 'x', applies: true };
  it('a machine-scaled film: the header names the machine, its source and the mm per pixel (MS3)', () => {
    const m = synthModel({ scale: { mmPerPx: 0.0998, source: 'machine', machine } });
    expect(m.header.scale).toBe('calibrated scale (machine: Demo Radiology, from film of 12/03/2025), 0.0998 mm per pixel');
  });
});

describe('the patient and age lines (owner T1, AG1; ruling R12, R15)', () => {
  const input = synthInput();
  // R15 (owner, 24 Oct; preflight I-8): a film with a DOB prints its header exactly as before. Captured by running
  // headerLines(buildReport(input).header) at a6a8eff (before Task 14) and pasting its output — today's words, not
  // the new code's.
  const headerLinesBefore: [string, string][] = [['Patient', 'SYNTHETIC Demo'], ['Library ID', 'L-00042'], ['Date of birth', '07/03/2010 (age 13.9 at the film)'], ['Film date', '07/02/2024'], ['Timepoint', 'T1'], ['Scale', "calibrated from the film's ruler (0.1000 mm per pixel)"], ['AI models', 'Aariz'], ['Verification', 'Not verified: the tracing has not been signed off'], ['Report made', '18/10/2026']];   // SYNTHETIC
  it('a DOB film prints its header exactly as before (R15)', () => {
    const m = buildReport(input);
    expect(headerLines(m.header)).toEqual(headerLinesBefore);
  });
  it('the patient line has the title before the name; the age line is the screen\'s own (owner T1, AG1)', () => {
    const m = buildReport({ ...input, doc: { ...input.doc, patientName: 'John Smith', title: 'Mr', dateOfBirth: null, ageOnFilm: '011Y', ageOnFilmYears: 11 } });
    expect(m.header.patient).toBe('Mr John Smith');
    expect(headerLines(m.header)).toContainEqual(['Age', 'Age 11 y (printed on the film or typed; no DOB)']);
    expect([m.film.age, m.film.ageSource]).toEqual([11, 'film']);     // R12: the norms' age, and its source
  });
  it('no DOB with a film age: the Date of birth line stays "not recorded" — the film\'s age is never printed as a DOB age', () => {
    const m = buildReport({ ...input, doc: { ...input.doc, dateOfBirth: null, ageOnFilm: '011Y', ageOnFilmYears: 11 } });
    expect(headerLines(m.header)).toContainEqual(['Date of birth', 'not recorded']);
  });
  it('no title, no age: as before', () => {
    const m = buildReport({ ...input, doc: { ...input.doc, title: null, dateOfBirth: null, ageOnFilm: null, ageOnFilmYears: null } });
    expect(headerLines(m.header).some(([k]) => k === 'Age')).toBe(false);
    expect([m.film.age, m.film.ageSource]).toEqual([null, null]);
  });
  it('a title and a "Last, First" name: the name as stored, never reordered', () => {
    const m = buildReport({ ...input, doc: { ...input.doc, patientName: 'Smith, John', title: 'Mr' } });
    expect(m.header.patient).toBe('Mr Smith, John');
  });
  it('a DOB with no film date and a film age (R1): no age used, the film\'s age shown with its note', () => {
    const m = buildReport({ ...input, doc: { ...input.doc, takenOn: null, ageOnFilm: '011Y', ageOnFilmYears: 11 } });
    expect([m.film.age, m.film.ageSource]).toEqual([null, null]);
    const l = headerLines(m.header);
    expect(l.find(([k]) => k === 'Date of birth')).toEqual(['Date of birth', '07/03/2010']);   // SYNTHETIC
    expect(l).toContainEqual(['Age', 'Age 11 y (printed on the film)']);
    expect(l).toContainEqual(['', 'The DOB cannot be checked against it without the scan date.']);
  });
  it('a DOB film whose printed age is more than a year away: the DOB line as before, then the note (R15)', () => {
    const m = buildReport({ ...input, doc: { ...input.doc, ageOnFilm: '009Y', ageOnFilmYears: 9 } });
    const l = headerLines(m.header);
    expect(l.some(([k]) => k === 'Age')).toBe(false);
    expect(l.slice(0, 3)).toEqual(headerLinesBefore.slice(0, 3));
    expect(l[3]).toEqual(['', 'The film says 9 y; DOB gives 13 y 11 m at the scan date.']);
    expect(l.slice(4)).toEqual(headerLinesBefore.slice(3));
  });
});

// Owner, 5 Nov 2026: an option to hide the whole Points section. ON by default so today's reports are unchanged.
describe('owner, 5 Nov 2026: the "Points table" option', () => {
  const pt = { id: 'LI', name: '李明 SYNTHETIC point', label: 'Aariz', model: 'aariz-cepha29', modelFile: null, acceptKind: null, pointCheck: '' as const, wholeFilmCheck: '', wholeFilmRegion: '' };
  it('is ON by default and remembered under report_points_table', () => {
    expect(DEFAULT_REPORT_OPTIONS.pointsTable).toBe(true);
    expect(REPORT_OPTION_KEYS.pointsTable).toBe('report_points_table');
  });
  it('reportTexts carries the Points heading and names by default, and neither when the option is off (no CJK font need from them)', () => {
    const m = synthModel({ points: [pt] });
    expect(reportTexts(m)).toContain('Points');
    expect(reportTexts(m)).toContain('李明 SYNTHETIC point');
    const off = reportTexts(m, { ...DEFAULT_REPORT_OPTIONS, pointsTable: false });
    expect(off).not.toContain('Points');
    expect(off).not.toContain('李明 SYNTHETIC point');
  });
  it('with no points at all and the option on, there is no Points text (as before)', () => {
    expect(reportTexts(synthModel())).not.toContain('Points');
  });
});

describe('owner, 5 Nov 2026: the "Grid behind the profilogram" option', () => {
  it('is ON by default and remembered under report_profilogram_grid', () => {
    expect(DEFAULT_REPORT_OPTIONS.profilogramGrid).toBe(true);
    expect(REPORT_OPTION_KEYS.profilogramGrid).toBe('report_profilogram_grid');
  });
  it('every option has its own settings key (none shared, none missing)', () => {
    expect(new Set(Object.values(REPORT_OPTION_KEYS)).size).toBe(Object.keys(DEFAULT_REPORT_OPTIONS).length);
    expect(Object.keys(REPORT_OPTION_KEYS).sort()).toEqual(Object.keys(DEFAULT_REPORT_OPTIONS).sort());
  });
});
