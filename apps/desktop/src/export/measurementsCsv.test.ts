import { describe, it, expect } from 'vitest';
import { APP } from '../report/model';
import { synthDoc, synthFitModel, synthModel } from '../report/fixtures';
import { filmCode, measurementsCsv, patientCode, POINTS_COLUMNS, POINTS_COLUMNS_WHOLE, readSalt, TIDY_COLUMNS, type CsvOptions } from './measurementsCsv';

const SALT = '0123456789abcdef0123456789abcdef';
const opts = (o: Partial<CsvOptions> = {}): CsvOptions => ({ anonymise: false, layout: 'tidy', salt: SALT, exportedAt: '2026-10-18T02:00:00.000Z', decimals: 1, ...o });
// Task 14: a column read by its NAME, not its position, so a new column (age_source) cannot silently shift a check.
const col = (name: string) => TIDY_COLUMNS.indexOf(name);
const lines = (csv: string) => csv.replace(/^﻿/, '').split('\r\n').filter(Boolean);
// MS-5: no CSV-aware splitter existed beside `lines` (the R3(C) describe below keeps its own quote-preserving
// `cell`, read for a quoted whole-cell check) — this one splits on commas outside double quotes and unquotes
// ("" -> ") each field, for tests that want the plain value rather than the raw CSV text.
const parseRow = (line: string): string[] => {
  const cells = (line.match(/("([^"]|"")*"|[^,]*)(,|$)/g) ?? []).map((c) => c.replace(/,$/, ''));
  cells.pop();   // the regex's own trailing empty match after the last field
  return cells.map((c) => (c.startsWith('"') && c.endsWith('"') ? c.slice(1, -1).replace(/""/g, '"') : c));
};
const TAIL = `calibrated,0.1,,,Aariz,2026-10-18T02:00:00.000Z,${APP}`;
const FILM = 'c1,SYNTHETIC Demo,L-00042,SYNTHETIC-PID-5566,SYNTHETIC-4471,2010-03-07,F,2024-02-07,13.92,dob,T1';   // SYNTHETIC

describe('measurements CSV, tidy (one row per film × measurement)', () => {
  it('golden file for the SYNTHETIC film', () => {
    expect(TIDY_COLUMNS.join(',')).toBe('film,patient,library_patient_id,printed_patient_id,scan_id,date_of_birth,sex,film_date,age_years,age_source,timepoint,analysis_id,analysis,measurement_id,measurement,value,value_display,unit,status,norm,norm_mean,norm_sd,z,stars,severity,side,meaning,meaning_edited,norm_source,norm_auto,scale,mm_per_px,verified_by,verified_at,models,exported_at,app_version');
    expect(lines(measurementsCsv([synthModel()], opts()))).toEqual([
      TIDY_COLUMNS.join(','),
      `${FILM},steiner,Steiner,m01_SNA,SNA,84.8,84.8,deg,measured,82.0 ± 3.5°,82,3.5,0.8,,tendency,above,prognathic maxilla tendency,no,Steiner 1953 (SYNTHETIC source line),,${TAIL}`,
      `${FILM},steiner,Steiner,m03_ANB,ANB,6.2,6.2,deg,measured,2.0 ± 2.0°,2,2,2.1,**,Moderate,above,Moderate Class II,no,Steiner 1953 (SYNTHETIC source line),,${TAIL}`,
      // Owner decision (20 Oct): norm_mean/norm_sd now hold the resolved norm whenever `norm` shows a value — a
      // Needs row and a hidden mm row both still name their norm, so both are filled; z/stars/severity stay
      // blank (no grade is possible with no value shown).
      `${FILM},downs,Downs,m04_FacialAngle,Facial angle,,,deg,Needs: Pog,87.8 ± 3.6°,87.8,3.6,,,,,,no,Downs 1948 (SYNTHETIC),,${TAIL}`,
      `${FILM},downs,Downs,m24_YAxis,Y-axis,59,59.0,deg,measured,No norm,,,,,,,,no,no norm for this measurement,,${TAIL}`,
      `${FILM},mcnamara,McNamara,m10_CoA,Co-A,,,mm,calibrate to show,91.0 ± 4.0 mm,91,4,,,,,,no,McNamara 1984 (SYNTHETIC),,${TAIL}`,
    ]);
  });
  it('a changed meaning with a comma and quotes is quoted, and marked as changed', () => {
    const m = synthModel({ edits: { 'steiner:m03_ANB': { text: 'Class II, "compensated"', was: 'Moderate Class II' } } });
    expect(lines(measurementsCsv([m], opts()))[2]).toContain(',"Class II, ""compensated""",yes,');
  });
  it('a name Excel would run as a formula is shown as text', () => {
    const m = synthModel({ doc: synthDoc({ patientName: '=SYNTHETIC()' }) });
    expect(lines(measurementsCsv([m], opts()))[1].split(',')[1]).toBe("'=SYNTHETIC()");
  });
  it('zero films: the heading line alone', () => {
    expect(lines(measurementsCsv([], opts()))).toEqual([TIDY_COLUMNS.join(',')]);
  });
  // Fix round 1, m1 (ruling): the brief says age_years has 2 decimals, so an exact whole-year
  // age must still print fixed to 2 decimals ("14.00"), not as a bare integer.
  it('age_years keeps two decimals for an exact whole year', () => {
    const m = synthModel({ doc: synthDoc({ dateOfBirth: '2010-02-07' }) });   // SYNTHETIC: exactly 14 on the default film date 2024-02-07
    const row = lines(measurementsCsv([m], opts()))[1].split(',');
    expect(row[8]).toBe('14.00');
  });
  // Owner decision (20 Oct): norm_mean/norm_sd follow the `norm` TEXT, not whether z is possible — a Needs row
  // (no value placed) and a hidden mm row (not calibrated) both still name a norm in text, so both columns.
  it('norm_mean/norm_sd are filled for a Needs row and a hidden mm row, whenever norm shows a value', () => {
    const rows = lines(measurementsCsv([synthModel()], opts())).slice(1).map((l) => l.split(','));
    const byMeasurement = (id: string) => rows.find((r) => r[col('measurement_id')] === id)!;
    expect([byMeasurement('m04_FacialAngle')[col('norm_mean')], byMeasurement('m04_FacialAngle')[col('norm_sd')]]).toEqual(['87.8', '3.6']);   // Needs: Pog
    expect([byMeasurement('m10_CoA')[col('norm_mean')], byMeasurement('m10_CoA')[col('norm_sd')]]).toEqual(['91', '4']);   // calibrate to show
    expect([byMeasurement('m24_YAxis')[col('norm_mean')], byMeasurement('m24_YAxis')[col('norm_sd')]]).toEqual(['', '']);   // "No norm": still blank
  });
});

// Owner ruling Q-A (24 Oct 2026): a dedicated norm_auto column, TIDY LAYOUT ONLY (review I-1, fix round 1: the
// wide layout has no norm, z or source columns at all — one column per analysis.measurement, value only — so
// Auto changes no number there to filter on) — blank for a row the patient's own population covers, otherwise the
// AutoNote step that filled it ('analysis-own' | 'caucasian' | 'anywhere') or, review I-4 + owner ruling (fix
// round 1), 'chosen' for a row the clinician picked by hand.
describe('norm_auto (owner ruling Q-A, 24 Oct 2026; fix round 1: tidy only, and "chosen")', () => {
  const withAuto = (step: 'analysis-own' | 'caucasian' | 'anywhere') => {
    const m = synthModel();
    m.blocks[0].rows[0] = { ...m.blocks[0].rows[0], auto: true, autoStep: step };
    return m;
  };
  const withChosen = () => {
    const m = synthModel();
    m.blocks[0].rows[0] = { ...m.blocks[0].rows[0], auto: false, autoStep: 'chosen' };
    return m;
  };
  it('tidy: blank for a non-Auto row, the step for an Auto one — positive control, each step distinctly', () => {
    for (const step of ['analysis-own', 'caucasian', 'anywhere'] as const) {
      const rows = lines(measurementsCsv([withAuto(step)], opts())).slice(1).map((l) => l.split(','));
      const head = lines(measurementsCsv([withAuto(step)], opts()))[0].split(',');
      const col = head.indexOf('norm_auto');
      expect(rows[0][col]).toBe(step);         // SNA row: Auto filled it
      expect(rows[1][col]).toBe('');            // ANB row: untouched, stays blank
    }
  });
  // Review I-4 + owner ruling (fix round 1, 25 Oct 2026): a row the clinician picked by hand also compares the
  // patient with another group's norm, so it reads 'chosen' here too.
  it("tidy: 'chosen' for a hand-picked row", () => {
    const rows = lines(measurementsCsv([withChosen()], opts())).slice(1).map((l) => l.split(','));
    const col = lines(measurementsCsv([withChosen()], opts()))[0].split(',').indexOf('norm_auto');
    expect(rows[0][col]).toBe('chosen');
  });
  it('wide: norm_auto is not a wide column (one column per analysis.measurement, not per attribute)', () => {
    const head = lines(measurementsCsv([withAuto('caucasian')], opts({ layout: 'wide' })))[0];
    expect(head).not.toContain('norm_auto');
  });
  it('a non-Auto film: blank on every row (control for the Auto case above)', () => {
    const rows = lines(measurementsCsv([synthModel()], opts())).slice(1).map((l) => l.split(','));
    const col = lines(measurementsCsv([synthModel()], opts()))[0].split(',').indexOf('norm_auto');
    expect(rows.every((r) => r[col] === '')).toBe(true);
  });
});

describe('Anonymised (owner R4 + ANON-1: chosen by default for several films, Named for one)', () => {
  const two = [synthModel(), synthModel({ doc: synthDoc({ id: 'c2', takenOn: '2025-02-07', timepoint: 'T2' }) })];
  const csv = measurementsCsv(two, opts({ anonymise: true }));
  it('no name, no date of birth and no patient identifier anywhere', () => {
    for (const s of ['SYNTHETIC Demo', 'synthetic demo', '2010-03-07', 'L-00042', 'SYNTHETIC-PID-5566', 'SYNTHETIC-4471']) expect(csv).not.toContain(s);   // SYNTHETIC
  });
  // Task 5 preflight ruling [Important]: 'film' is the FIRST column, so a bare film id is never preceded by a comma
  // — ',c1,'/',c2,' can never match and the check would pass even in Named mode. Check the line start instead, with
  // a positive control showing the same check DOES catch the un-anonymised (Named) output.
  it('the raw film id never starts a row (positive control: it does in Named mode)', () => {
    expect(lines(csv).slice(1).some((l) => /^c[12],/.test(l))).toBe(false);
    const plain = measurementsCsv(two, opts());
    expect(lines(plain).slice(1).some((l) => /^c[12],/.test(l))).toBe(true);
  });
  it('the film date and the age stay as they are (ANON-1)', () => {
    const rows = lines(csv).slice(1).map((l) => l.split(','));
    expect(rows.map((r) => [r[3], r[4], r[5], r[7], r[8]])).toContainEqual(['', '', '', '2024-02-07', '13.92']);
    expect(csv).toContain('2025-02-07');
    // L2: the library number column is blank when anonymised (its own column, never folded into the patient code).
    expect(rows.every((r) => r[2] === '')).toBe(true);
  });
  it('one code for the patient across films, one per film, the same in every export with this salt', () => {
    const rows = lines(csv).slice(1).map((l) => l.split(','));
    expect(new Set(rows.map((r) => r[1]))).toEqual(new Set([patientCode(SALT, { patientKey: 'synthetic demo', dateOfBirth: '2010-03-07' })]));   // SYNTHETIC
    expect(new Set(rows.map((r) => r[0]))).toEqual(new Set([filmCode(SALT, 'c1'), filmCode(SALT, 'c2')]));
    expect(rows[0][1]).toMatch(/^P-[0-9a-f]{10}$/);
    expect(rows[0][0]).toMatch(/^F-[0-9a-f]{10}$/);
    expect(measurementsCsv(two, opts({ anonymise: true }))).toBe(csv);
    expect(patientCode('f'.repeat(32), { patientKey: 'synthetic demo', dateOfBirth: '2010-03-07' })).not.toBe(rows[0][1]);   // SYNTHETIC
  });
  it('positive control: Named has the name, the date of birth and the IDs', () => {
    const plain = measurementsCsv(two, opts());
    for (const s of ['SYNTHETIC Demo', 'L-00042', '2010-03-07', 'SYNTHETIC-PID-5566', 'SYNTHETIC-4471']) expect(plain).toContain(s);   // SYNTHETIC
  });
  // Fix round 1, m2 (ruling): the same name with a different date of birth must give a
  // different code — every existing salt/code test instead varies the salt, never the DOB.
  it('the same name with a different date of birth gives a different code', () => {
    const golden = patientCode(SALT, { patientKey: 'synthetic demo', dateOfBirth: '2010-03-07' });   // SYNTHETIC
    const differentDob = patientCode(SALT, { patientKey: 'synthetic demo', dateOfBirth: '2010-03-08' });   // SYNTHETIC
    expect(differentDob).not.toBe(golden);
  });
  // Final review Minor 5: patientIdOf gives "|" for an empty patientKey and no DOB, so two DIFFERENT unnamed
  // patients (no name read, no DOB) used to get the SAME anonymised code — reading as one patient to a
  // longitudinal analysis. The code must fall back to the film id when there is no name to key on.
  it('two different unnamed patients with no date of birth get different codes', () => {
    const unnamed = (id: string) => synthModel({ doc: synthDoc({ id, patientName: '', patientKey: '', dateOfBirth: null }) });
    const rows = lines(measurementsCsv([unnamed('c1'), unnamed('c2')], opts({ anonymise: true }))).slice(1).map((l) => l.split(','));
    const codes = new Set(rows.map((r) => r[1]));
    expect(codes.size).toBe(2);
  });
  // Owner decision (20 Oct): verified_by becomes a stable per-clinician code within the file ("Clinician 1",
  // "Clinician 2", …), in order of first appearance, when Anonymised; Meaning, timepoint and analysis (ANON-1/
  // Minor 5-7) stay as written; Named is unchanged.
  describe('verified_by (owner decision, 20 Oct)', () => {
    const verifiedBy = (id: string, verifiedAt: string | null, by: string | null) =>
      synthModel({ doc: synthDoc({ id, verifiedAt, verifiedBy: by }) });
    const three = [
      verifiedBy('c1', '2026-10-01T00:00:00Z', 'Dr Alice SYNTHETIC'),
      verifiedBy('c2', '2026-10-02T00:00:00Z', 'Dr Bob SYNTHETIC'),
      verifiedBy('c3', '2026-10-03T00:00:00Z', 'Dr Alice SYNTHETIC'),   // the same clinician as c1
    ];
    const verifiedByOfEachFilm = (csv: string) => {
      const rows = lines(csv).slice(1).map((l) => l.split(','));
      const seen = new Map<string, string>();
      for (const r of rows) seen.set(r[0], r[col('verified_by')]);
      return [...seen.values()];
    };
    it('Anonymised: "Clinician 1"/"Clinician 2", in order of first appearance; the same clinician reuses their code', () => {
      const anon = measurementsCsv(three, opts({ anonymise: true }));
      expect(verifiedByOfEachFilm(anon)).toEqual(['Clinician 1', 'Clinician 2', 'Clinician 1']);
      expect(anon).not.toContain('Dr Alice SYNTHETIC');
      expect(anon).not.toContain('Dr Bob SYNTHETIC');
    });
    it('Named: the clinician\'s own name, unchanged', () => {
      const named = measurementsCsv(three, opts());
      expect(verifiedByOfEachFilm(named)).toEqual(['Dr Alice SYNTHETIC', 'Dr Bob SYNTHETIC', 'Dr Alice SYNTHETIC']);
    });
    it('a film not yet verified stays blank in both modes; a verified film with no name recorded stays blank too', () => {
      const unverified = verifiedBy('c4', null, null), blankName = verifiedBy('c5', '2026-10-04T00:00:00Z', null);
      for (const anonymise of [true, false]) {
        const rows = lines(measurementsCsv([unverified, blankName], opts({ anonymise }))).slice(1).map((l) => l.split(','));
        expect(new Set(rows.map((r) => r[col('verified_by')]))).toEqual(new Set(['']));
      }
    });
  });
});

describe('measurements CSV, wide (one row per film)', () => {
  it('one column per analysis.measurement, full-precision values, blank where none', () => {
    const two = [synthModel(), synthModel({ doc: synthDoc({ id: 'c2', timepoint: 'T2' }) })];
    const l = lines(measurementsCsv(two, opts({ layout: 'wide' })));
    expect(l[0]).toBe('film,patient,library_patient_id,printed_patient_id,scan_id,date_of_birth,sex,film_date,age_years,age_source,timepoint,steiner.m01_SNA,steiner.m03_ANB,downs.m04_FacialAngle,downs.m24_YAxis,mcnamara.m10_CoA,scale,mm_per_px,verified_by,verified_at,models,exported_at,app_version');
    expect(l[1]).toBe(`${FILM},84.8,6.2,,59,,${TAIL}`);
    expect(l).toHaveLength(3);
  });
});

describe('the anonymising salt', () => {
  const store = (v: string | null, failSet = false) => { const m = { v }; return { m, get: async () => m.v, set: async (_k: string, x: string) => { if (failSet) throw new Error('SYNTHETIC write failed'); m.v = x; } }; };
  it('is made once, from 16 random bytes, and kept', async () => {
    const s = store(null);
    const a = await readSalt(s, () => new Uint8Array(16).fill(171));
    expect(a).toBe('ab'.repeat(16));
    expect(await readSalt(s, () => new Uint8Array(16).fill(1))).toBe(a);
  });
  it('junk stored in its place is replaced', async () => {
    expect(await readSalt(store('short'), () => new Uint8Array(16).fill(2))).toBe('02'.repeat(16));
  });
  it('a failed write stops the export (never an anonymised file with a throwaway salt)', async () => {
    await expect(readSalt(store(null, true), () => new Uint8Array(16))).rejects.toThrow('SYNTHETIC write failed');
  });
  // Task 5 preflight ruling [Minor]: two exports started together on an empty store must not race two different
  // salts into existence (the second write would win, so the first file's codes never match later exports).
  it('two exports started together on an empty store make one salt, not a race', async () => {
    const s = store(null);
    const [a, b] = await Promise.all([readSalt(s, () => new Uint8Array(16).fill(5)), readSalt(s, () => new Uint8Array(16).fill(9))]);
    expect(a).toBe(b);
  });
  // Fix round 1, I1 (ruling): the in-flight memoisation must be keyed by the STORE — two
  // different empty stores racing together must not have the second one silently receive the first
  // store's salt without ever calling its own `set`.
  it('two different empty stores racing together each get their own salt, written through their own set', async () => {
    const s1 = store(null);
    const s2 = store(null);
    const [a, b] = await Promise.all([readSalt(s1, () => new Uint8Array(16).fill(5)), readSalt(s2, () => new Uint8Array(16).fill(9))]);
    expect(a).not.toBe(b);
    expect(s1.m.v).toBe(a);
    expect(s2.m.v).toBe(b);
  });
});

// R3 (C), owner decision 20 Oct (multiple choice, option A): a film on a fit's scale has its fit in words in the
// `scale` column — the same words as the screen and the report's † note — and the fit's own mm per pixel; no new
// column. Calibrated and assumed films keep "calibrated" / "assumed".
describe('R3 (C): the scale column of a film on a fit\'s scale', () => {
  const cell = (csv: string, name: string, line = 1) => {
    const ls = lines(csv), head = ls[0].split(','), i = head.indexOf(name);
    // the G3 text holds a comma, so read the row with a quote-aware split
    const cells = ls[line].match(/("([^"]|"")*"|[^,]*)(,|$)/g)!.map((c) => c.replace(/,$/, ''));
    return cells[i];
  };
  it('tidy: "scaled to T1 on S–N (×1.042)" and mm_per_px at full precision, on every row', () => {
    const csv = measurementsCsv([synthFitModel()], opts());
    for (let l = 1; l <= 5; l++) expect(cell(csv, 'scale', l)).toBe('scaled to T1 on S–N (×1.042)');
    expect(cell(csv, 'mm_per_px')).toBe(String(0.1 * 1.042));
    expect(lines(csv)[0]).toBe(TIDY_COLUMNS.join(','));   // no new column
  });
  it('G3: ", assumed scale" is added (and the cell is quoted, it holds a comma)', () => {
    const csv = measurementsCsv([synthFitModel(true)], opts());
    expect(cell(csv, 'scale')).toBe('"scaled to T1 on S–N (×1.042), assumed scale"');
  });
  it('wide layout: the same words', () => {
    const csv = measurementsCsv([synthFitModel()], opts({ layout: 'wide' }));
    expect(cell(csv, 'scale')).toBe('scaled to T1 on S–N (×1.042)');
  });
  it('the fitted mm value is a plain number (no † inside a numeric cell)', () => {
    const csv = measurementsCsv([synthFitModel()], opts()), coa = lines(csv).find((l) => l.includes(',m10_CoA,'))!;
    expect(coa).toContain(',Co-A,95.3,95.3,mm,measured,');
    expect(coa).not.toContain('†');
  });
  it('calibrated and assumed: unchanged', () => {
    expect(cell(measurementsCsv([synthModel()], opts()), 'scale')).toBe('calibrated');
    expect(cell(measurementsCsv([synthModel({ scale: { mmPerPx: 0.1, source: 'assumed' } })], opts()), 'scale')).toBe('assumed');
  });
  it('a fine-tuned calibration (spec 2026-10-19 addendum 3): "calibrated scale, adjusted +1.0 %" on every row, quoted (it holds a comma)', () => {
    const csv = measurementsCsv([synthModel({ scale: { mmPerPx: 0.101, source: 'calibration', steps: 2 } })], opts());
    for (let l = 1; l <= 5; l++) expect(cell(csv, 'scale', l)).toBe('"calibrated scale, adjusted +1.0 %"');
    expect(cell(csv, 'mm_per_px')).toBe('0.101');
  });
});

// MS3 (owner, 20 Oct; decision 16): the scale column names a machine scale, the same words as `machineWords`
// (MS-4) — named: the source film's date as stored (not the operator's date format, unlike the report header);
// anonymised: no date (MQ4). Every other film (calibrated, assumed, fitted) prints as before (goldens above).
describe('the scale column names a machine scale (MS3); every other film prints as before (decision 16)', () => {
  const machine = { machineId: 'm1', machineName: 'Demo Radiology', spacingMm: 0.0998, widthPx: 2400, heightPx: 3000, source: 'film' as const,
    sourceCaseId: 'c9', sourceFilmDate: '2025-03-12', setAt: 'x', applies: true };
  const mm = synthModel({ scale: { mmPerPx: 0.0998, source: 'machine', machine } });
  const cell = (o: Partial<CsvOptions> = {}) => { const [h, r] = lines(measurementsCsv([mm], opts(o))); return parseRow(r)[h.split(',').indexOf('scale')]; };
  it('named: the source film\'s date as stored; anonymised: no date (MQ4)', () => {
    expect(cell()).toBe('calibrated scale (machine: Demo Radiology, from film of 2025-03-12)');
    expect(cell({ anonymise: true })).toBe('calibrated scale (machine: Demo Radiology, from a calibrated film)');
  });
  it('the cell is quoted (it holds a comma), and mm_per_px is the number', () => {
    expect(lines(measurementsCsv([mm], opts()))[1]).toContain('"calibrated scale (machine: Demo Radiology, from film of 2025-03-12)",0.0998');
  });
});

describe('age_years is the age the norms use; age_source says where it came from (ruling R12, 19 Oct)', () => {
  const cell = (m: ReturnType<typeof synthModel>, name: string, o: Partial<CsvOptions> = {}) => {
    const [head, row] = lines(measurementsCsv([m], opts(o)));
    return row.split(',')[head.split(',').indexOf(name)];
  };
  const noDob = synthModel({ doc: synthDoc({ dateOfBirth: null, ageOnFilm: '011Y', ageOnFilmYears: 11 }) });
  it('a no-DOB film printed "011Y": 11.00, film', () => {
    expect([cell(noDob, 'age_years'), cell(noDob, 'age_source')]).toEqual(['11.00', 'film']);
  });
  it('a film with a DOB: the DOB age, dob (the film\'s age is ignored)', () => {
    const m = synthModel({ doc: synthDoc({ ageOnFilm: '009Y', ageOnFilmYears: 9 }) });
    expect([cell(m, 'age_years'), cell(m, 'age_source')]).toEqual(['13.92', 'dob']);
  });
  it('no age at all, or a DOB with no film date (R1): both blank', () => {
    for (const d of [{ dateOfBirth: null, ageOnFilm: null, ageOnFilmYears: null }, { takenOn: null, ageOnFilm: '011Y', ageOnFilmYears: 11 }]) {
      const m = synthModel({ doc: synthDoc(d) });
      expect([cell(m, 'age_years'), cell(m, 'age_source')], JSON.stringify(d)).toEqual(['', '']);
    }
  });
  it('anonymised keeps the age and its source (ANON-1)', () => {
    expect([cell(noDob, 'age_years', { anonymise: true }), cell(noDob, 'age_source', { anonymise: true })]).toEqual(['11.00', 'film']);
  });
  it('the wide layout carries the same two columns', () => {
    expect([cell(noDob, 'age_years', { layout: 'wide' }), cell(noDob, 'age_source', { layout: 'wide' })]).toEqual(['11.00', 'film']);
  });
  it('a typed age of an exact whole year still prints two decimals (14.00, film)', () => {
    const m = synthModel({ doc: synthDoc({ dateOfBirth: null, ageOnFilm: '14', ageOnFilmYears: 14 }) });
    expect([cell(m, 'age_years'), cell(m, 'age_source')]).toEqual(['14.00', 'film']);
  });
});

describe('Part F: measurements CSV, points layout (one row per film × point; chain spec §5)', () => {
  const pts = [{ id: 'S', name: 'Sella', label: 'Aariz', model: 'aariz-cepha29', modelFile: 'fp-az', acceptKind: 'single' as const, pointCheck: '' as const, wholeFilmCheck: null, wholeFilmRegion: null },
    { id: 'N', name: 'Nasion', label: 'Placed by you', model: null, modelFile: null, acceptKind: 'hand' as const, pointCheck: '' as const, wholeFilmCheck: null, wholeFilmRegion: null }];
  it('the columns, and one row per point with the label and the structured columns', () => {
    expect(POINTS_COLUMNS.slice(11, 19)).toEqual(['point', 'point_name', 'placed_by_label', 'placed_by_model', 'model_file', 'personal_model_version', 'accept_kind', 'point_check']);
    expect(POINTS_COLUMNS).not.toContain('whole_film_check');   // the research switch is off by default: no whole-film column
    const out = lines(measurementsCsv([synthModel({ points: pts })], opts({ layout: 'points' })));
    expect(out[0]).toBe(POINTS_COLUMNS.join(','));
    expect(out.slice(1)).toEqual([`${FILM},S,Sella,Aariz,aariz-cepha29,fp-az,,single,,${TAIL}`, `${FILM},N,Nasion,Placed by you,,,,hand,,${TAIL}`]);
  });
  it('anonymised keeps the point columns (no patient data in them)', () => {
    const anon = lines(measurementsCsv([synthModel({ points: pts })], opts({ layout: 'points', anonymise: true })));
    expect(parseRow(anon[1]).slice(11, 19)).toEqual(['S', 'Sella', 'Aariz', 'aariz-cepha29', 'fp-az', '', 'single', '']);
  });
  // Final review (carried item): this test fails if `points` ever reaches the tidy or wide columns. It recomputes both
  // sides with today's code, so it cannot show "unchanged against before Part F": the pinned tidy and wide goldens and
  // the pinned PDF hash guard that.
  it('points never reach the tidy or wide layouts', () => {
    expect(measurementsCsv([synthModel({ points: pts })], opts())).toBe(measurementsCsv([synthModel()], opts()));
    expect(measurementsCsv([synthModel({ points: pts })], opts({ layout: 'wide' }))).toBe(measurementsCsv([synthModel()], opts({ layout: 'wide' })));
  });

  // Stage A task 8. Fails if `point_check` moves, is dropped, or changes any other cell.
  describe('the point_check column (Stage A)', () => {
    const at = POINTS_COLUMNS.indexOf('point_check');
    const checked = (cells: Array<'flagged' | 'film-unusual' | ''>, over: Partial<(typeof pts)[number]> = {}) =>
      pts.map((p, i) => ({ ...p, ...over, pointCheck: cells[i] }));
    // (the Task 9 cell stays blank in every point_check test below, so a point_check test cannot pass by reading the wrong column)
    it('sits after accept_kind; scale follows it (the whole-film columns come between only with the research switch on); nothing before it moves', () => {
      expect(at).toBe(POINTS_COLUMNS.indexOf('accept_kind') + 1);
      expect(POINTS_COLUMNS.indexOf('scale')).toBe(at + 1);
      expect(POINTS_COLUMNS_WHOLE.indexOf('whole_film_check')).toBe(at + 1);
      expect(POINTS_COLUMNS_WHOLE.indexOf('whole_film_region')).toBe(at + 2);
      expect(POINTS_COLUMNS_WHOLE.indexOf('whole_film_look_shape')).toBe(at + 3);
      expect(POINTS_COLUMNS_WHOLE.indexOf('scale')).toBe(at + 3 + 6);
      expect(POINTS_COLUMNS.slice(0, 18).join(',')).toBe('film,patient,library_patient_id,printed_patient_id,scan_id,date_of_birth,sex,film_date,age_years,age_source,timepoint,point,point_name,placed_by_label,placed_by_model,model_file,personal_model_version,accept_kind');
    });
    it('writes flagged / film-unusual / blank, and removing that column gives byte-for-byte the file without any check', () => {
      const withCheck = lines(measurementsCsv([synthModel({ points: checked(['flagged', 'film-unusual']) })], opts({ layout: 'points' })));
      const without = lines(measurementsCsv([synthModel({ points: checked(['', '']) })], opts({ layout: 'points' })));
      expect(parseRow(withCheck[1])[at]).toBe('flagged');
      expect(parseRow(withCheck[2])[at]).toBe('film-unusual');
      expect(withCheck.length).toBe(without.length);
      const strip = (l: string) => parseRow(l).filter((_, i) => i !== at).join('\u0001');
      expect(withCheck.map(strip)).toEqual(without.map(strip));          // every OTHER cell equal, row by row (3 rows compared)
      expect(withCheck.length).toBe(3);
    });
    it('a comma or a quote in a name is still escaped, and point_check stays in its own cell', () => {
      const rows = lines(measurementsCsv([synthModel({ points: checked(['flagged', ''], { name: 'Nasion, "left"', label: 'Aariz, "v2"' }) })], opts({ layout: 'points' })));
      const parsed = parseRow(rows[1]);
      console.log('escaped row:', rows[1].slice(0, 160));
      expect([parsed[POINTS_COLUMNS.indexOf('point_name')], parsed[POINTS_COLUMNS.indexOf('placed_by_label')], parsed[at]]).toEqual(['Nasion, "left"', 'Aariz, "v2"', 'flagged']);
      expect(parsed.length).toBe(POINTS_COLUMNS.length);
      expect(rows[1]).toContain('"Nasion, ""left"""');
    });
    it('the anonymised file keeps it (it holds no patient data)', () => {
      const anon = lines(measurementsCsv([synthModel({ points: checked(['flagged', 'film-unusual']) })], opts({ layout: 'points', anonymise: true })));
      expect([parseRow(anon[1])[at], parseRow(anon[2])[at]]).toEqual(['flagged', 'film-unusual']);
    });
  });
  // Task 9 (SC-1 Part 1, spec §11). Fails if `whole_film_check` is put anywhere but immediately after `point_check` (induced:
  // column before point_check), is dropped, or changes any other cell.
  describe('the whole_film_check column (SC-1 Part 1 task 9)', () => {
    const at = POINTS_COLUMNS_WHOLE.indexOf('whole_film_check');
    const withCell = (cell: string, region = '') => pts.map((p) => ({ ...p, wholeFilmCheck: cell, wholeFilmRegion: region }));
    it('is immediately after point_check; every column after it is one place to the right of where it was', () => {
      const before = POINTS_COLUMNS_WHOLE.filter((c) => !c.startsWith('whole_film'));          // the columns as they stood before this task
      expect(at).toBe(POINTS_COLUMNS_WHOLE.indexOf('point_check') + 1);
      expect(before.indexOf('scale')).toBe(POINTS_COLUMNS_WHOLE.indexOf('scale') - 8);
      expect(POINTS_COLUMNS_WHOLE.slice(at + 8)).toEqual(before.slice(before.indexOf('point_check') + 1));
      expect(POINTS_COLUMNS_WHOLE[at + 1]).toBe('whole_film_region');
      expect(POINTS_COLUMNS_WHOLE.length).toBe(before.length + 8);
      expect(POINTS_COLUMNS_WHOLE.slice(at, at + 8)).toEqual(['whole_film_check', 'whole_film_region', 'whole_film_look_shape', 'whole_film_look_regions', 'whole_film_look_size', 'whole_film_look_centre', 'whole_film_look_mirrored', 'whole_film_look_facing']);
      expect(before).toEqual(POINTS_COLUMNS);
    });
    it('writes the film\'s value on every row, and removing that column gives byte-for-byte the file with a blank one', () => {
      const flagged = lines(measurementsCsv([synthModel({ points: withCell('flagged:region-mandible+facing') })], opts({ layout: 'points', wholeFilm: true })));
      const blank = lines(measurementsCsv([synthModel({ points: withCell('') })], opts({ layout: 'points', wholeFilm: true })));
      expect(flagged.slice(1).map((l) => parseRow(l)[at])).toEqual(['flagged:region-mandible+facing', 'flagged:region-mandible+facing']);   // the same on every row
      expect(blank.slice(1).map((l) => parseRow(l)[at])).toEqual(['', '']);
      expect(parseRow(flagged[0])[at]).toBe('whole_film_check');
      const strip = (l: string) => parseRow(l).filter((_, i) => i !== at).join('\u0001');
      expect(flagged.map(strip)).toEqual(blank.map(strip));             // every OTHER cell equal, row by row
      console.log(`whole_film_check: compared ${flagged.length} lines x ${parseRow(flagged[0]).length - 1} other cells = ${flagged.length * (parseRow(flagged[0]).length - 1)} cells`);
      expect(flagged.length).toBe(3);
    });
    it('point_check\'s own value is unchanged beside it (a flag stays in its own cell)', () => {
      const both = lines(measurementsCsv([synthModel({ points: [{ ...pts[0], pointCheck: 'flagged' as const, wholeFilmCheck: 'clean' }, { ...pts[1], pointCheck: '' as const, wholeFilmCheck: 'clean' }] })], opts({ layout: 'points', wholeFilm: true })));
      const pc = POINTS_COLUMNS_WHOLE.indexOf('point_check');
      expect([parseRow(both[1])[pc], parseRow(both[1])[at], parseRow(both[2])[pc], parseRow(both[2])[at]]).toEqual(['flagged', 'clean', '', 'clean']);
    });
    it.each(['', 'clean', 'not-run', 'flagged:region-mandible', 'flagged:region-maxilla+region-mandible', 'flagged:mirrored+facing',
      'checked:tracing-right', 'checked:expected-variant', 'checked:corrected-tracing'])('the cell %j is written as it is, in one cell', (cell) => {
      const rows = lines(measurementsCsv([synthModel({ points: withCell(cell) })], opts({ layout: 'points', wholeFilm: true })));
      expect(parseRow(rows[1])[at]).toBe(cell);
      expect(parseRow(rows[1]).length).toBe(POINTS_COLUMNS_WHOLE.length);
    });
    // Research switch (owner, 6 Nov 2026). Fails if the region column is dropped, moved off `whole_film_check`, or its words change.
    it.each(['fine', 'region flagged', 'not checked', '', 'off'])('whole_film_region %j is written in its own cell, right after whole_film_check', (region) => {
      const rows = lines(measurementsCsv([synthModel({ points: withCell('flagged:region-mandible', region) })], opts({ layout: 'points', wholeFilm: true })));
      const ar = POINTS_COLUMNS_WHOLE.indexOf('whole_film_region');
      expect(ar).toBe(at + 1);
      expect(parseRow(rows[1])[ar]).toBe(region);
      expect(parseRow(rows[1])[at]).toBe('flagged:region-mandible');
      expect(parseRow(rows[1]).length).toBe(POINTS_COLUMNS_WHOLE.length);
    });
    it('each look\'s status is written on every row, in its own cell, as the film\'s value', () => {
      const looks = { shape: 'judged', regions: 'judged', size: 'not checked (not set up)', centre: 'judged', mirrored: 'judged', facing: 'judged' };
      const rows = lines(measurementsCsv([synthModel({ points: pts.map((p) => ({ ...p, wholeFilmCheck: 'clean', wholeFilmRegion: 'fine', wholeFilmLooks: looks })) })], opts({ layout: 'points', wholeFilm: true })));
      const col = (n: string) => POINTS_COLUMNS_WHOLE.indexOf(n);
      expect(rows.slice(1).map((r) => parseRow(r)[col('whole_film_look_size')])).toEqual(['not checked (not set up)', 'not checked (not set up)']);
      expect(rows.slice(1).map((r) => parseRow(r)[col('whole_film_look_shape')])).toEqual(['judged', 'judged']);
      expect(parseRow(rows[1]).length).toBe(POINTS_COLUMNS_WHOLE.length);
    });
    // Switch OFF (the default): neither column, and the file is byte-for-byte the one made from points carrying no whole-film cells at all.
    it('switch off: no whole_film_check and no whole_film_region column, whatever the points carry', () => {
      const off = measurementsCsv([synthModel({ points: withCell('flagged:region-mandible', 'region flagged') })], opts({ layout: 'points' }));
      const none = measurementsCsv([synthModel({ points: pts })], opts({ layout: 'points' }));
      expect(off).toBe(none);
      expect(off).not.toContain('whole_film');
      expect(off).not.toContain('region flagged');
      expect(off).not.toContain('flagged:region-mandible');
    });
    it('the anonymised file keeps it (it holds no patient data)', () => {
      const anon = lines(measurementsCsv([synthModel({ points: withCell('flagged:shape') })], opts({ layout: 'points', anonymise: true, wholeFilm: true })));
      expect(parseRow(anon[1])[at]).toBe('flagged:shape');
    });
    it('the tidy and wide layouts are unchanged by it (no whole_film_check column there)', () => {
      expect(TIDY_COLUMNS).not.toContain('whole_film_check');
      expect(measurementsCsv([synthModel({ points: withCell('flagged:shape') })], opts())).toBe(measurementsCsv([synthModel()], opts()));
      expect(measurementsCsv([synthModel({ points: withCell('flagged:shape') })], opts({ layout: 'wide' }))).toBe(measurementsCsv([synthModel()], opts({ layout: 'wide' })));
    });
  });
});
