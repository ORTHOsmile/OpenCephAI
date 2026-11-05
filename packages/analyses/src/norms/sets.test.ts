// Tests on the REAL committed norm sets (reference/norms/sets/). Grows with each extraction task
// (Part C Tasks 5-10). Every other norms test uses synthetic sets.
import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES } from '../analyses';
import { loadSets } from './load';
import { resolveNorm, zScore, populationsOffered } from './resolve';
import { POPULATIONS } from './load';
import type { NormSet } from './types';

const sets = loadSets();

const resolveOwn = (analysisId: string, measurement: string) =>
  resolveNorm({ measurement, analysisId, population: null, clinicDefault: null, sex: null, ageYears: null, sets, userNorms: [] });

describe('NUS (NDC sheet), Task 5', () => {
  const nus = ALL_ANALYSES.find((a) => a.id === 'nus')!;
  const ids = nus.measurements.map((m) => m.node as string);

  it('guard on the analysis definition: NUS (analyses.ts) still lists the sheet\'s 17 measurements', () => {
    expect(ids).toHaveLength(17);
  });

  it('every NUS measurement resolves to an ndc-sheet norm with a mean and an SD (gaps listed by id)', () => {
    const gaps = ids.filter((id) => {
      const r = resolveOwn('nus', id);
      return !(r.kind === 'norm' && r.setId === 'ndc-sheet' && r.mean !== null && r.sd !== null && r.colour);
    });
    expect(gaps).toEqual([]);
  });

  // Fix round 1: every mean/SD exactly as printed on the sheet (NDC Analysis.png, rows 1-17; the
  // review's transcription audit), so a transposed or mistyped value anywhere fails the suite.
  const SHEET: [string, number, number][] = [
    ['m01_SNA', 83.4, 3.5], ['m02_SNB', 80.1, 3.7], ['m03_ANB', 3.4, 2.5], ['m23_FHGoMe', 25.0, 5.0],
    ['m25_MMPA', 26.2, 5.1], ['m26_SNMxP', 7.5, 3.5], ['m13_Wits', -4.7, 3.9], ['m29_LAFHpct', 53.9, 2.1],
    ['m54_U1SN', 110.8, 7.4], ['m55_U1MxP', 118.0, 6.4], ['m57_IMPAgome', 99.7, 7.0], ['m53_Interincisal', 116.2, 9.2],
    ['m64_L1APog', 5.1, 2.2], ['m68_Overjet', 3.5, 1.7], ['m69_Overbite', 3.0, 1.8], ['m71_ULE', 3.2, 2.3],
    ['m72_LLE', 3.7, 2.5],
  ];

  it('the table covers exactly the NUS measurements', () => {
    expect(SHEET.map(([id]) => id)).toEqual(ids);
  });

  it.each(SHEET)('%s resolves to the sheet value: mean %s, SD %s', (id, mean, sd) => {
    const r = resolveOwn('nus', id);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.mean, r.sd]).toEqual(['ndc-sheet', mean, sd]);
  });

  it('the sheet is undated: its source line reads "NDC (undated)", never a placeholder year', () => {
    const r = resolveOwn('nus', 'm01_SNA');
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect(r.sourceLine.startsWith('NDC (undated), ')).toBe(true);
    expect(r.sourceLine).not.toMatch(/\b(19|20)\d\d\b/);
  });

  it('Wits is the sheet value, -4.7 mm (SD 3.9)', () => {
    const r = resolveOwn('nus', 'm13_Wits');
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect(r.mean).toBe(-4.7);
    expect(r.sd).toBe(3.9);
  });

  it('the sheet is true size (owner 8 Oct): mm entries are neither converted nor flagged scale-assumed', () => {
    const r = resolveOwn('nus', 'm64_L1APog');
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect(r.mean).toBe(5.1);
    expect(r.printed).toBeNull();
    expect(r.flags).not.toContain('scale-assumed');
    expect(r.flags).not.toContain('converted-to-true-size');
  });
});

// ---- Task 6: the analyses' own norms, part 1 (Steiner, Downs, McNamara, Wits, Kim). Each set was
// typed twice from its paper and every difference settled from the page image (task-6-report.md).
// What each paper covers as the analysis's OWN norm (settled from the papers, Task 6):
//  - Steiner 1953: every Steiner measurement except #18 Pog–NB (not in the 1953 paper);
//  - Downs 1948: all ten;
//  - McNamara 1984: his composite norms (Table II; medium face size rows for Co–Gn, the
//    differential and LAFH, p. 455/467; lower pharynx p. 468). No composite norm for #10 Co–A (it is
//    the size index of Table V) or #84 upper pharynx (only a threshold "less than 5 mm");
//  - Jacobson 1975: Wits; Kim 1974: ODI; Kim & Vietas 1978: APDI (#16/#17 are Task 8, website).
const OWN_COVER: Record<string, { set: Record<string, string>; notCovered: string[] }> = {
  steiner: { set: Object.fromEntries(['m01_SNA', 'm02_SNB', 'm03_ANB', 'm20_SNGoGn', 'm60_OPSN', 'm53_Interincisal', 'm46_U1NAmm', 'm47_U1NAdeg', 'm49_L1NBmm', 'm50_L1NBdeg', 'm59_L1GoGn', 'm70a_U6NA', 'm70b_L6NB'].map((m) => [m, 'steiner1953'])), notCovered: ['m18_PogNB'] },
  downs: { set: Object.fromEntries(['m04_FacialAngle', 'm05_Convexity', 'm06_ABPlane', 'm22_FHMPt', 'm24_YAxis', 'm61_CantOP', 'm53_Interincisal', 'm56_IMPAt', 'm62_L1OPdev', 'm63_U1APog'].map((m) => [m, 'downs1948'])), notCovered: [] },
  mcnamara: { set: Object.fromEntries(['m08_ANperp', 'm09_PogNperp', 'm11_CoGn', 'm12_MaxMandDiff', 'm28_LAFH', 'm23_FHGoMe', 'm31_FacAxisM', 'm67_U1Avert', 'm64_L1APog', 'm85_LowerPharynx'].map((m) => [m, 'mcnamara1984'])), notCovered: ['m10_CoA', 'm84_UpperPharynx'] },
  wits: { set: { m13_Wits: 'jacobson1975' }, notCovered: [] },
  kim: { set: { m15_ODI: 'kim1974', m14_APDI: 'kimvietas1978' }, notCovered: ['m16_CF', 'm17_ExtrIndex'] },
};

const resolveSexed = (analysisId: string, measurement: string, sex: 'M' | 'F' | null, useSets = sets) =>
  resolveNorm({ measurement, analysisId, population: null, clinicDefault: null, sex, ageYears: null, sets: useSets, userNorms: [] });

describe('own norms part 1 (Task 6): Steiner, Downs, McNamara, Wits, Kim', () => {
  describe.each(Object.entries(OWN_COVER))('%s', (analysisId, cover) => {
    const analysis = ALL_ANALYSES.find((a) => a.id === analysisId)!;
    const ids = analysis.measurements.map((m) => m.node as string);

    it('guard: the coverage table lists exactly the analysis\'s measurements', () => {
      expect([...Object.keys(cover.set), ...cover.notCovered].sort()).toEqual([...ids].sort());
    });

    it('every measurement the paper covers resolves to its own set (gaps listed by id)', () => {
      const gaps = Object.entries(cover.set).filter(([id, setId]) => {
        const r = resolveSexed(analysisId, id, 'F');
        return !(r.kind === 'norm' && r.setId === setId);
      }).map(([id]) => id);
      expect(gaps).toEqual([]);
    });

    it('measurements the paper does not cover take no norm from these sets', () => {
      const own = new Set(Object.values(cover.set));
      const wrong = cover.notCovered.filter((id) => {
        const r = resolveSexed(analysisId, id, 'F');
        return r.kind === 'norm' && own.has(r.setId);
      });
      expect(wrong).toEqual([]);
    });
  });

  const setById = (id: string) => sets.find((s) => s.id === id)!;

  it('Steiner: every entry is an ideal (centre ideal) with no SD of its own', () => {
    const s = setById('steiner1953');
    expect(s.entries.length).toBe(13);
    expect(s.entries.filter((e) => e.centre !== 'ideal' || e.sd !== undefined || e.sdSource !== undefined).map((e) => e.measurement)).toEqual([]);
  });

  it('Steiner, with only the committed own-norm sets loaded: not coloured, "no SD in this paper and no matching SD to borrow"', () => {
    const ownOnly = sets.filter((s) => s.kind === 'analysis-own');
    for (const id of Object.keys(OWN_COVER.steiner.set)) {
      const r = resolveSexed('steiner', id, null, ownOnly);
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') continue;
      expect([id, r.colour, r.sd]).toEqual([id, false, null]);
      // Ruling T4-1 (Task 4 fix round 1): an ideal that is not coloured carries 'ideal-uncoloured', not 'ideal'.
      expect([r.flags.includes('ideal-uncoloured'), r.flags.includes('ideal')]).toEqual([true, false]);
      expect(r.sourceLine).toContain('no SD in this paper and no matching SD to borrow');
    }
  });

  it('Steiner M1: the incisor-to-line mm rows are close, measured from the labial surface', () => {
    for (const id of ['m46_U1NAmm', 'm49_L1NBmm']) {
      const e = setById('steiner1953').entries.find((x) => x.measurement === id)!;
      expect(e.definitionMatch).toBe('close');
      expect(e.definitionNote).toMatch(/labial surface/);
    }
  });

  it('Downs: sample means, not ideals (no centre), with the sample range; #62 range ends at the text\'s +20', () => {
    const s = setById('downs1948');
    expect(s.entries.filter((e) => e.centre !== undefined).map((e) => e.measurement)).toEqual([]);
    expect(s.entries.filter((e) => !e.range).map((e) => e.measurement)).toEqual([]);
    expect(s.entries.find((e) => e.measurement === 'm62_L1OPdev')!.range).toEqual({ low: 3.5, high: 20 });
    expect(s.entries.find((e) => e.measurement === 'm06_ABPlane')!.mean).toBe(-4.6);
  });

  it('McNamara #31: stored as his value + 90°, and the note says so', () => {
    const rows = setById('mcnamara1984').entries.filter((e) => e.measurement === 'm31_FacAxisM');
    expect(rows.length).toBeGreaterThan(0);
    for (const e of rows) {
      expect(e.mean).toBe(90);
      expect(e.note).toMatch(/\+ 90°/);
    }
  });

  it('McNamara: 8% film enlargement (p. 451) — an mm norm is converted to true size, an angle is not', () => {
    expect(setById('mcnamara1984').scale).toEqual({ kind: 'enlarged', percent: 8, source: 'p. 451' });
    const mm = resolveSexed('mcnamara', 'm08_ANperp', 'F');
    expect(mm.kind).toBe('norm');
    if (mm.kind === 'norm') {
      expect(mm.flags).toContain('converted-to-true-size');
      expect(mm.printed?.mean).toBe(1);
    }
    const deg = resolveSexed('mcnamara', 'm23_FHGoMe', 'F');
    expect(deg.kind === 'norm' && deg.flags.includes('converted-to-true-size')).toBe(false);
  });

  it('McNamara M1: incisor mm rows are close, measured from the facial surface', () => {
    const rows = setById('mcnamara1984').entries.filter((x) => x.measurement === 'm67_U1Avert' || x.measurement === 'm64_L1APog');
    expect(rows.length).toBe(4); // mixed dentition + adult for each (fix round 1: a loop over nothing passes)
    for (const e of rows) {
      expect(e.definitionMatch).toBe('close');
      expect(e.definitionNote).toMatch(/facial surface/);
    }
  });

  // Fix round 1 (review, Critical): with the patient's age KNOWN the adult rows must be reachable.
  // Owner MN-1 (8 Oct): mixed dentition 6-12, adult values from 13 (permanent dentition).
  const MIXED = { m08_ANperp: { mean: 0 }, m09_PogNperp: { range: { low: -8, high: -6 } }, m23_FHGoMe: { mean: 25 } } as const;
  const ADULT = { m08_ANperp: { mean: 1 }, m09_PogNperp: { range: { low: -2, high: 4 } }, m23_FHGoMe: { mean: 22 } } as const;
  const AGES: [number | null, 'mixed' | 'adult'][] = [[9, 'mixed'], [15, 'adult'], [30, 'adult'], [null, 'adult']];
  describe.each(AGES)('McNamara at age %s: the %s-dentition row (MN-1)', (age, which) => {
    it.each(['m08_ANperp', 'm09_PogNperp', 'm23_FHGoMe'] as const)('%s', (id) => {
      const r = resolveNorm({ measurement: id, analysisId: 'mcnamara', population: null, clinicDefault: null, sex: 'M', ageYears: age, sets, userNorms: [] });
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') return;
      const want = (which === 'mixed' ? MIXED : ADULT)[id];
      const got = 'mean' in want ? { mean: r.entry.mean } : { range: r.entry.range };
      expect([r.setId, got]).toEqual(['mcnamara1984', want]);
      expect(r.entry.ageBand).toEqual(which === 'mixed' ? [6, 12] : [13, 99]);
      expect(r.flags).not.toContain('age-mismatched');
    });
  });

  it('McNamara MN-2: every clinical norm row is an ideal; only the lower pharynx average is not', () => {
    const notIdeal = setById('mcnamara1984').entries.filter((e) => e.centre !== 'ideal').map((e) => e.measurement);
    expect(notIdeal).toEqual(['m85_LowerPharynx']);
  });

  it('every Task 6 set except McNamara states no film scale', () => {
    for (const id of ['steiner1953', 'downs1948', 'jacobson1975', 'kim1974', 'kimvietas1978']) {
      expect([id, setById(id).scale]).toEqual([id, { kind: 'not-stated' }]);
    }
  });

  // Few rows: every mean/SD checked against the paper (Jacobson p. 474 and owner ruling 7 Oct;
  // Kim 1974 Table I p. 592; Kim & Vietas 1978 Table I p. 623, Group 1).
  const FEW: [string, string, 'M' | 'F' | null, string, number, number][] = [
    ['wits', 'm13_Wits', 'M', 'jacobson1975', -1.17, 1.9],
    ['wits', 'm13_Wits', 'F', 'jacobson1975', -0.1, 1.77],
    ['kim', 'm15_ODI', null, 'kim1974', 74.5, 6.07],
    ['kim', 'm14_APDI', null, 'kimvietas1978', 81.37, 3.79],
  ];
  it.each(FEW)('%s %s (%s) resolves to %s: mean %s, SD %s', (analysisId, id, sex, setId, mean, sd) => {
    const r = resolveSexed(analysisId, id, sex);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.mean, r.sd]).toEqual([setId, mean, sd]);
  });

  it('Jacobson: separate men\'s and women\'s Wits rows; the men\'s sign follows his text (owner ruling 7 Oct)', () => {
    const rows = setById('jacobson1975').entries.filter((e) => e.measurement === 'm13_Wits');
    expect(rows.map((e) => e.sex).sort()).toEqual(['F', 'M']);
    const men = rows.find((e) => e.sex === 'M')!;
    expect(men.range).toBeUndefined();
    expect(men.note).toMatch(/1\.17 without a sign/);
  });

  it('Kim: ODI comes from kim1974 and APDI from kimvietas1978, both own norms of the kim analysis', () => {
    expect(setById('kim1974').analyses).toEqual(['kim']);
    expect(setById('kimvietas1978').analyses).toEqual(['kim']);
    const odi = resolveSexed('kim', 'm15_ODI', null);
    expect(odi.kind === 'norm' && odi.setId).toBe('kim1974');
  });
});

// ---- Task 7: the analyses' own norms, part 2 (Ricketts 1981 and 1960, Tweed, Holdaway via
// AlBarakati, Eastman U1–MxP from Naini). Typed twice from the papers, every difference settled from
// the page images (task-7-report.md).
//  - Ricketts 1981: all eleven Ricketts measurements (cue sheet p. 124, Tables 1-7);
//  - Tweed 1954: all three; Holdaway 1983 (second-hand): all but #79 (not listed) and #82 (printed '–');
//  - Eastman: only #55 from Naini (the rest is Alassiry 2022, Task 10);
//  - E-line: Ricketts 1981 for the lower lip; Ricketts 1960 only for the upper lip, which 1981 gives no
//    number for (fix round 1, P37: Ricketts 1960's consecutive treatment patients rank after every
//    other selection, so they are the fallback, not the first choice).
const OWN_COVER_7: Record<string, { set: Record<string, string>; notCovered: string[] }> = {
  ricketts: { set: Object.fromEntries(['m30_FacAxisR', 'm04_FacialAngle', 'm22_FHMPt', 'm32_OralGnomon', 'm27_PalFH', 'm07_ANPog', 'm64_L1APog', 'm19_U6PTV', 'm53_Interincisal', 'm72_LLE', 'm33_MandBend'].map((m) => [m, 'ricketts1981'])), notCovered: [] },
  tweed: { set: { m22_FHMPt: 'tweed1954', m56_IMPAt: 'tweed1954', m58_FMIA: 'tweed1954' }, notCovered: [] },
  holdaway: {
    set: Object.fromEntries(['m73_STFacial', 'm74_NoseProm', 'm75_SupSulcus', 'm76_SnH', 'm07_ANPog', 'm77_BasicUL', 'm78_ULThick', 'm80_HAngle', 'm81_LLH', 'm83_ChinThick'].map((m) => [m, 'holdaway1983-via-albarakati2012'])),
    notCovered: ['m79_ULStrain', 'm82_InfSulcusH'],
  },
  // Task 10 (13 Oct): Alassiry 2022 (second-hand Eastman standards) covers eight more; for U1–MxP Naini 2011 (first-hand)
  // ranks before Alassiry's restatement of the same 109 ± 6 (owner FIRSTHAND-1); LAFH % has no Eastman value in either.
  eastman: {
    set: { ...Object.fromEntries(['m01_SNA', 'm02_SNB', 'm03_ANB', 'm26_SNMxP', 'm25_MMPA', 'm57_IMPAgome', 'm53_Interincisal'].map((m) => [m, 'alassiry2022-eastman'])), m55_U1MxP: 'eastman-naini' },
    notCovered: ['m29_LAFHpct'],
  },
  'e-line': { set: { m71_ULE: 'ricketts1960', m72_LLE: 'ricketts1981' }, notCovered: [] },
};

const resolveAged = (analysisId: string, measurement: string, sex: 'M' | 'F' | null, ageYears: number | null, useSets = sets) =>
  resolveNorm({ measurement, analysisId, population: null, clinicDefault: null, sex, ageYears, sets: useSets, userNorms: [] });

describe('own norms part 2 (Task 7): Ricketts, Tweed, E-line, Holdaway, Eastman', () => {
  describe.each(Object.entries(OWN_COVER_7))('%s', (analysisId, cover) => {
    const analysis = ALL_ANALYSES.find((a) => a.id === analysisId)!;
    const ids = analysis.measurements.map((m) => m.node as string);

    it('guard: the coverage table lists exactly the analysis\'s measurements', () => {
      expect([...Object.keys(cover.set), ...cover.notCovered].sort()).toEqual([...ids].sort());
    });

    it('every measurement the paper covers resolves to its own set, for a man of unknown age and a girl of 12 (gaps listed by id)', () => {
      const gaps = Object.entries(cover.set).filter(([id, setId]) => {
        const man = resolveAged(analysisId, id, 'M', null);
        const girl = resolveAged(analysisId, id, 'F', 12);
        return !(man.kind === 'norm' && man.setId === setId && girl.kind === 'norm' && girl.setId === setId);
      }).map(([id]) => id);
      expect(gaps).toEqual([]);
    });

    it('measurements the paper does not cover take no norm from these sets', () => {
      const own = new Set(Object.values(cover.set));
      const wrong = cover.notCovered.filter((id) => {
        const r = resolveAged(analysisId, id, 'F', null);
        return r.kind === 'norm' && own.has(r.setId);
      });
      expect(wrong).toEqual([]);
    });
  });

  const setById = (id: string) => sets.find((s) => s.id === id)!;
  const T7 = ['ricketts1981', 'ricketts1960', 'tweed1954', 'holdaway1983-via-albarakati2012', 'eastman-naini'];

  it('all five sets: verified, compared 2026-10-08, film scale not stated', () => {
    for (const id of T7) {
      const s = setById(id);
      expect([id, s.status, s.curation.comparedOn, s.scale]).toEqual([id, 'verified', '2026-10-08', { kind: 'not-stated' }]);
    }
  });

  it('Ricketts #27: 0° ± 3° (p. 131), the note gives the summary sheet\'s 2.5°', () => {
    const r = resolveAged('ricketts', 'm27_PalFH', null, null);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.mean, r.sd, r.entry.source]).toEqual(['ricketts1981', 0, 3, 'p. 131']);
    expect(r.entry.note).toMatch(/summary sheet p\. 124 gives 0° ± 2\.5°/);
  });

  // Owner R-1 (fix round 1, P38): Ricketts prints single ages; between two printed ages the norm is
  // interpolated (N2: the patient's own age). Owner R-2: adult women are compared with his men's rows.
  const fa = (age: number | null, sex: 'M' | 'F' | null) => {
    const r = resolveAged('ricketts', 'm04_FacialAngle', sex, age);
    if (r.kind !== 'norm') throw new Error('no norm');
    return r;
  };
  it('Ricketts is an interpolate set: every age band a printed age, open only for the facial angle\'s last men\'s (and women\'s) row', () => {
    const s = setById('ricketts1981');
    expect(s.ageRows).toBe('interpolate');
    const open = s.entries.filter((e) => e.ageBand && e.ageBand[1] >= 99).map((e) => [e.measurement, e.sex, e.ageBand]);
    expect(open).toEqual([['m04_FacialAngle', 'M', [24, 99]], ['m04_FacialAngle', 'F', [24, 99]]]);
    expect(s.entries.filter((e) => e.ageBand && e.ageBand[1] < 99 && e.ageBand[0] !== e.ageBand[1])).toEqual([]);
  });
  it('an 8-year-old: facial angle = value at 6 + (2/3)(value at 9 − value at 6), SD 3, flagged interpolated', () => {
    const r = fa(8, null);
    expect(r.mean).toBeCloseTo(84 + (2 / 3) * (85 - 84), 10);
    expect([r.sd, r.colour, r.ageRowUsed]).toEqual([3, true, '8 y (interpolated 6–9 y)']);
    expect(r.flags).toContain('interpolated');
    expect(r.flags).not.toContain('age-mismatched');
    expect(r.sourceLine).toContain("interpolated between Ricketts 1981's ages 6 and 9");
  });
  it.each([
    [9, null, 85, [9, 9]],
    [18, 'M', 88, [18, 18]],
    [30, 'M', 90, [24, 99]],
    [24, 'M', 90, [24, 99]],
  ] as const)('facial angle at age %s (%s), a printed or open row: %s, unflagged', (age, sex, mean, band) => {
    const r = fa(age, sex);
    expect([r.mean, r.entry.ageBand, r.sd, r.flags]).toEqual([mean, band, 3, []]);
  });
  it('facial angle at age 2: the age-3 row, flagged age-mismatched (no extrapolation)', () => {
    const r = fa(2, 'F');
    expect([r.mean, r.flags.includes('age-mismatched'), r.flags.includes('interpolated')]).toEqual([83, true, false]);
  });
  it('R-2: a woman of 30 gets his adult value, flagged other-sex-values, not age-mismatched; a man of 30 the same value unflagged', () => {
    const w = fa(30, 'F');
    expect([w.mean, w.flags.includes('other-sex-values'), w.flags.includes('age-mismatched')]).toEqual([90, true, false]);
    expect(w.sourceLine).toContain(' · Ricketts prints adult values for men only');
    const m = fa(30, 'M');
    expect([m.mean, m.flags.includes('other-sex-values')]).toEqual([90, false]);
  });
  it('R-2: every men-only adult row has a women\'s copy with the same age and values, fromOtherSex M', () => {
    const s = setById('ricketts1981');
    const key = (e: (typeof s.entries)[number]) => `${e.measurement}|${e.ageBand}|${e.mean}|${e.sd}`;
    const men = s.entries.filter((e) => e.sex === 'M').map(key).sort();
    const women = s.entries.filter((e) => e.sex === 'F');
    expect(women.map(key).sort()).toEqual(men);
    expect(women.every((e) => e.fromOtherSex === 'M' && /men only/.test(e.note ?? ''))).toBe(true);
    expect(men.length).toBeGreaterThan(0);
  });
  it('a girl of 12: interincisal interpolated between the pooled ages 8 and 13 (124 → 126), no other-sex flag', () => {
    const r = resolveAged('ricketts', 'm53_Interincisal', 'F', 12);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect(r.mean).toBeCloseTo(124 + (4 / 5) * 2, 10);
    expect([r.sd, r.flags.includes('interpolated'), r.flags.includes('other-sex-values')]).toEqual([5, true, false]);
  });
  it('U6–PTV at 10 y: 12 + (1/3)(15 − 12) = 13 mm, SD 3', () => {
    const r = resolveAged('ricketts', 'm19_U6PTV', 'M', 10);
    expect(r.kind === 'norm' && [r.mean, r.sd]).toEqual([13, 3]);
  });
  // Owner SEX-AVG-1 with ruling P9 (12 Oct): sex not recorded → the men's and women's rows at the adult age;
  // Ricketts' adult women's rows copy the men's, so the copy is used (not averaged), flagged "other sex's values". This
  // replaced review Important #2's age-15 pooled stand-in (87, age-mismatched); the SEX-AVG-1 before/after lists the row.
  it('SEX-AVG-1/P9: sex and age unknown → the age-18 adult row (88), as women get it, flagged other-sex-values, not age-mismatched', () => {
    const r = fa(null, null);
    expect([r.mean, r.entry.ageBand, r.flags.includes('age-mismatched'), r.flags.includes('other-sex-values'), r.flags.includes('sexes-averaged')]).toEqual([88, [18, 18], false, true, false]);
    expect(r.sourceLine).not.toContain('the oldest printed row');
  });

  it('Ricketts P7: a cue-sheet SD applies to every age row (MP 4, interincisal 5, lower lip 2); mandibular bend SD 4.7 at 8 only', () => {
    const s = setById('ricketts1981');
    const sdsOf = (m: string) => [...new Set(s.entries.filter((e) => e.measurement === m).map((e) => e.sd))];
    expect(sdsOf('m04_FacialAngle')).toEqual([3]);
    expect(sdsOf('m22_FHMPt')).toEqual([4]);
    expect(sdsOf('m53_Interincisal')).toEqual([5]);
    expect(sdsOf('m72_LLE')).toEqual([2]);
    const bend = s.entries.filter((e) => e.measurement === 'm33_MandBend');
    expect(bend.filter((e) => e.sd !== undefined).map((e) => [e.ageBand, e.sd])).toEqual([[[8, 8], 4.7]]);
    expect(bend.filter((e) => e.sd === undefined && e.centre !== 'ideal')).toEqual([]);
  });

  it('Ricketts B-2: SD-less clinical norms are ideals (convexity), rows with an SD are not', () => {
    const s = setById('ricketts1981');
    expect(s.entries.filter((e) => (e.sd === undefined) !== (e.centre === 'ideal')).map((e) => [e.measurement, e.ageBand])).toEqual([]);
    expect(s.entries.filter((e) => e.measurement === 'm07_ANPog').every((e) => e.centre === 'ideal')).toBe(true);
  });

  it('Ricketts P8: L1–A-Po 2 ± 2 mm (p. 135), his +1 mm ± 2.5 objective as the clinical target', () => {
    const r = resolveAged('ricketts', 'm64_L1APog', null, 12);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.mean, r.sd, r.entry.source]).toEqual([2, 2, 'p. 135']);
    expect(r.entry.clinicalTarget).toMatch(/\+1 mm ± 2\.5/);
  });

  it('Ricketts facial axis #30: 90 ± 3', () => {
    const r = resolveAged('ricketts', 'm30_FacAxisR', 'F', 40);
    expect(r.kind === 'norm' && [r.mean, r.sd]).toEqual([90, 3]);
  });

  it('P37: E-line\'s lower lip resolves to Ricketts 1981, not the treatment sample of 1960', () => {
    const r = resolveAged('e-line', 'm72_LLE', 'F', 12);
    expect(r.kind === 'norm' && r.setId).toBe('ricketts1981');
  });

  // Final review M-2: a girl of 10.5 was flagged sex-pooled because Ricketts splits #72 by sex at 18 and 23.
  it('M-2: a girl of 10.5 on E-line #72 (interpolated 8–13 y, pooled rows only there) is not flagged sex-pooled', () => {
    const r = resolveAged('e-line', 'm72_LLE', 'F', 10.5);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.flags.includes('interpolated'), r.flags.includes('sex-pooled')]).toEqual(['ricketts1981', -1.875, true, false]);
  });

  // Owner ruling P37-FIRST (12 Oct; final review I-1): before the fix a man of 30 got Ricketts 1960's
  // treatment sample (−4, borrowed SD) because its adult row covers 19–44 and 1981's last row is 23.
  it('P37-FIRST: a man of 30 and a woman of 40 get Ricketts 1981\'s age-23 row (−5 ± 2, own SD), flagged age-mismatched — not Ricketts 1960', () => {
    for (const [sex, age] of [['M', 30], ['F', 40]] as const) {
      const r = resolveAged('e-line', 'm72_LLE', sex, age);
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') continue;
      expect([r.setId, r.mean, r.sd, r.sdDonor, r.colour]).toEqual(['ricketts1981', -5, 2, null, true]);
      expect(r.flags).toContain('age-mismatched');
      expect(r.flags).not.toContain('sd-borrowed');
    }
  });

  it('P37-FIRST: when the treatment sample is the only set, it is still used (a man of 50, flagged age-mismatched)', () => {
    const no81 = sets.filter((x) => x.id !== 'ricketts1981');
    const r = resolveAged('e-line', 'm72_LLE', 'M', 50, no81);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.flags.includes('age-mismatched')]).toEqual(['ricketts1960', -4, true]);
  });

  it('Ricketts 1960 E-line (the fallback, 1981 not loaded): a child and an adult get their own Chart 2 lower-lip row, unflagged', () => {
    const no81 = sets.filter((x) => x.id !== 'ricketts1981');
    const child = resolveAged('e-line', 'm72_LLE', 'F', 12, no81);
    const adult = resolveAged('e-line', 'm72_LLE', 'M', 30, no81);
    for (const r of [child, adult]) {
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') continue;
      expect(r.setId).toBe('ricketts1960');
      expect(r.flags).not.toContain('age-mismatched');
    }
    if (child.kind === 'norm') expect([child.entry.ageBand, child.mean, child.entry.n]).toEqual([[11, 14], 0, 343]);
    if (adult.kind === 'norm') expect([adult.entry.ageBand, adult.mean, adult.entry.n]).toEqual([[19, 44], -4, 33]);
  });

  it('Ricketts 1960 P36a: the whole-sample lower lip (0.3 ± 3.0) is a caveat, not a row; the upper lip is one 3–44 row', () => {
    const s = setById('ricketts1960');
    expect(s.entries.map((e) => e.measurement).sort()).toEqual(['m71_ULE', 'm72_LLE', 'm72_LLE', 'm72_LLE', 'm72_LLE', 'm72_LLE']);
    expect(s.entries.filter((e) => e.measurement === 'm72_LLE' && e.ageBand?.[0] === 3 && e.ageBand?.[1] === 44)).toEqual([]);
    expect(s.caveats.some((c) => /0\.3 mm ahead of the E plane, SD 3\.0 mm/.test(c))).toBe(true);
    // Review Important #1: Chart 1 gives 61 + 497 + 343 = 901 aged 3–14, not 958.
    expect(s.caveats[0]).toMatch(/901 of them aged 3–14 \(61 \+ 497 \+ 343, Chart 1\)/);
    const ule = s.entries.find((e) => e.measurement === 'm71_ULE')!;
    expect([ule.ageBand, ule.mean, ule.n, ule.sd]).toEqual([[3, 44], -0.7, 800, undefined]);
  });

  it('Tweed N1: means are his 95-case averages, his targets in clinicalTarget, his rounded norms in the note', () => {
    const want: [string, number, RegExp, RegExp][] = [
      ['m58_FMIA', 68.2, /FMIA 65° minimum to aim for/, /69°/],
      ['m56_IMPAt', 86.93, /IMPA 90°/, /87°/],
      ['m22_FHMPt', 24.57, /FMA 25°/, /24°/],
    ];
    for (const [id, mean, target, rounded] of want) {
      const r = resolveAged('tweed', id, null, null);
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') continue;
      expect([id, r.setId, r.mean]).toEqual([id, 'tweed1954', mean]);
      expect(r.entry.sd).toBeUndefined();
      expect(r.entry.n).toBe(95);
      expect(r.entry.centre).toBeUndefined();
      expect(r.entry.clinicalTarget).toMatch(target);
      expect(r.entry.note).toMatch(rounded);
    }
  });

  it('Tweed: FMA and FMIA close (machine porion 4.5 mm above the ear rod), IMPA same; Chart I ranges', () => {
    const s = setById('tweed1954');
    const m = (id: string) => s.entries.find((e) => e.measurement === id)!;
    expect([m('m22_FHMPt').definitionMatch, m('m58_FMIA').definitionMatch, m('m56_IMPAt').definitionMatch]).toEqual(['close', 'close', 'same']);
    expect(m('m22_FHMPt').definitionNote).toMatch(/4\.5 mm above/);
    expect([m('m22_FHMPt').range, m('m56_IMPAt').range, m('m58_FMIA').range]).toEqual([{ low: 15, high: 36 }, { low: 76, high: 99 }, { low: 56, high: 80 }]);
  });

  it('Holdaway: every entry resolves flagged second-hand and ideal; no entry carries its own SD', () => {
    const s = setById('holdaway1983-via-albarakati2012');
    expect(s.secondHand).toEqual({ via: 'AlBarakati & Bindayel 2012, Table 3' });
    expect(s.entries.filter((e) => e.sd !== undefined || e.centre !== 'ideal').map((e) => e.measurement)).toEqual([]);
    for (const id of Object.keys(OWN_COVER_7.holdaway.set)) {
      const r = resolveAged('holdaway', id, null, null);
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') continue;
      expect([id, r.flags.includes('second-hand'), r.flags.includes('ideal')]).toEqual([id, true, true]);
    }
  });

  it('Holdaway P5: a single number in the SD/range column is his ± tolerance (face angle 84–98, Sub-H 3–7); P9: LL–H −1 to 2, ideal 0 to 0.5', () => {
    const s = setById('holdaway1983-via-albarakati2012');
    const m = (id: string) => s.entries.find((e) => e.measurement === id)!;
    expect([m('m73_STFacial').mean, m('m73_STFacial').range]).toEqual([91, { low: 84, high: 98 }]);
    expect([m('m76_SnH').mean, m('m76_SnH').range]).toEqual([5, { low: 3, high: 7 }]);
    expect([m('m81_LLH').mean, m('m81_LLH').range]).toEqual([undefined, { low: -1, high: 2 }]);
    expect(m('m81_LLH').clinicalTarget).toMatch(/ideal 0 to 0\.5 mm/);
  });

  it('Holdaway, with only the committed own-norm sets loaded: an SD-less ideal is uncoloured, "no matching SD to borrow"', () => {
    const ownOnly = sets.filter((s) => s.kind === 'analysis-own');
    const r = resolveAged('holdaway', 'm73_STFacial', null, null, ownOnly);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.colour, r.sd]).toEqual([false, null]);
    expect(r.sourceLine).toContain('no SD in this paper and no matching SD to borrow');
  });

  // Owner FIRSTHAND-1 (13 Oct): Naini (first-hand) ranks before Alassiry 2022's second-hand restatement of the same value.
  it('Eastman U1–MxP resolves from eastman-naini: 109 ± 6 (Naini Ch. 7, p. 111)', () => {
    const r = resolveAged('eastman', 'm55_U1MxP', 'F', 14);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.mean, r.sd]).toEqual(['eastman-naini', 109, 6]);
    expect(r.entry.source).toMatch(/p\. 111/);
    expect(setById('eastman-naini').entries).toHaveLength(1);
  });
});

// ---- Task 8: website values (owner N4). Five [source removed] pages (Björk–Jarabak also takes #44 from
// [source removed] Dental), typed twice from the live pages on 7 Oct and every difference settled by re-reading
// the page on 8 Oct (task-8-report.md). Website values are shown, marked "website value, not from a
// paper", and never coloured; a website entry never borrows an SD.
type WebRow = [id: string, mean: number | null, sd: number | null, range: [number, number] | null];
const WEB: Record<string, { set: string; rows: WebRow[]; none: string[] }> = {
  'bjork-jarabak': {
    set: 'onfile-bjork-jarabak',
    rows: [
      ['m34_Saddle', 123, 5, null], ['m35_Articular', 143, 6, null], ['m36_Gonial', 130, 7, null],
      ['m37_UpperGonial', null, null, [52, 55]], ['m38_LowerGonial', null, null, [70, 75]], ['m39_SumAngles', 396, 6, null],
      ['m40_SGo', 80, 5, null], ['m41_NMe', 122, 6, null], ['m42_Jarabak', null, null, [62, 65]], ['m44_ArStoArGo', 0.799, 0.063, null],
    ],
    none: ['m43_SNtoGoMe'], // no website norm: [source removed] prints only the inverse ratio (Go′–Me/S–N)
  },
  abo: {
    set: 'onfile-abo',
    rows: [
      ['m01_SNA', 82, 2, null], ['m02_SNB', 80, 2, null], ['m03_ANB', 2, 2, null], ['m90_SNMP_ABO', 32, 5, null],
      ['m91_FMA_ABO', 25, 4, null], ['m54_U1SN', 102, 2, null], ['m46_U1NAmm', 4, 2, null], ['m92_L1MP_ABO', 90, 5, null],
      ['m49_L1NBmm', 4, 2, null], ['m72_LLE', -2, 2, null],
    ],
    none: ['m47_U1NAdeg', 'm50_L1NBdeg'], // the page gives these two in mm only
  },
  nagasaki: {
    set: 'onfile-nagasaki',
    rows: [
      ['m01_SNA', 82, 2, null], ['m02_SNB', 80, 2, null], ['m03_ANB', 2, 2, null], ['m21_SNGoMe', 32, 5, null],
      ['m51_L1NAmm', 4, 2, null], ['m57_IMPAgome', 90, 3, null], ['m53_Interincisal', 131, 8, null], ['m13_Wits', 0, 2, null],
    ],
    none: [],
  },
  radney: {
    set: 'onfile-radney',
    rows: [['m47_U1NAdeg', 22, 2, null], ['m46_U1NAmm', 5, 2, null], ['m52_L1NAdeg', 22, 2, null], ['m51_L1NAmm', 0.5, 2, null]],
    none: [],
  },
};
const WEB_SETS = ['onfile-bjork-jarabak', 'onfile-abo', 'onfile-nagasaki', 'onfile-radney', 'onfile-kim-cf-ei'];

describe('website values (Task 8, N4): Björk–Jarabak, ABO, Nagasaki, Radney, Kim #16/#17', () => {
  const setById = (id: string) => sets.find((s) => s.id === id);

  describe.each(Object.entries(WEB))('%s', (analysisId, web) => {
    const analysis = ALL_ANALYSES.find((a) => a.id === analysisId)!;
    const ids = analysis.measurements.map((m) => m.node as string);

    it('guard: the table lists exactly the analysis\'s measurements', () => {
      expect([...web.rows.map(([id]) => id), ...web.none].sort()).toEqual([...ids].sort());
    });

    // Task 9b-2: Björk–Jarabak now has a paper (Jarabak via Alshahrani 2018), which a website value never
    // beats; these website checks hold the analysis's paper sets out, so they still read the website set.
    const webOnly = sets.filter((s) => !(s.kind === 'analysis-own' && s.status !== 'website' && (s.analyses ?? []).includes(analysisId)));
    const resolveWeb = (id: string) =>
      resolveNorm({ measurement: id, analysisId, population: null, clinicDefault: null, sex: null, ageYears: null, sets: webOnly, userNorms: [] });

    it('with the analysis\'s papers held out, every measurement resolves to the website entry, flagged website and never coloured (gaps listed by id)', () => {
      const gaps = web.rows.filter(([id]) => {
        const r = resolveWeb(id);
        return !(r.kind === 'norm' && r.setId === web.set && r.flags.includes('website') && r.colour === false
          && r.sourceLine.includes('website value, not from a paper') && zScore(r.mean ?? 0, r) === null);
      }).map(([id]) => id);
      expect(gaps).toEqual([]);
    });

    it.each(web.rows)('%s: mean %s, SD %s, range %j as printed on the page', (id, mean, sd, range) => {
      const r = resolveWeb(id);
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') return;
      expect([r.setId, r.mean, r.sd, r.range ? [r.range.low, r.range.high] : null]).toEqual([web.set, mean, sd, range]);
    });

    // Owner decision 6 (29 Oct 2026): with no population at all, Auto now fills a row neither the analysis nor your
    // norms have (was: none). The page's set still never supplies these: each is either none or an Auto row from
    // another study, flagged as such.
    it('the measurements the page gives no number for never come from the page (none, or Auto from another study)', () => {
      expect(web.none.filter((id) => {
        const r = resolveOwn(analysisId, id);
        return r.kind === 'norm' && (r.setId === web.set || !r.flags.includes('auto-fallback'));
      })).toEqual([]);
    });
  });

  it('Task 9b-2: every Björk–Jarabak measurement Jarabak via Alshahrani 2018 prints now resolves to that paper, not the website; the rest stay on the website', () => {
    const paper = new Set(setById('jarabak-via-alshahrani2018')?.entries.map((e) => e.measurement) ?? []);
    expect([...paper].sort()).toEqual(['m34_Saddle', 'm35_Articular', 'm36_Gonial', 'm39_SumAngles', 'm40_SGo', 'm41_NMe', 'm42_Jarabak']);
    const got = WEB['bjork-jarabak']!.rows.map(([id]) => { const r = resolveOwn('bjork-jarabak', id); return [id, r.kind === 'norm' && r.setId]; });
    expect(got).toEqual(WEB['bjork-jarabak']!.rows.map(([id]) => [id, paper.has(id) ? 'jarabak-via-alshahrani2018' : 'onfile-bjork-jarabak']));
  });

  it('Kim #16 and #17 resolve to the website set; ODI and APDI still come from Kim\'s papers', () => {
    for (const id of ['m16_CF', 'm17_ExtrIndex']) {
      const r = resolveOwn('kim', id);
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') continue;
      expect([id, r.setId, r.flags.includes('website'), r.colour, r.mean]).toEqual([id, 'onfile-kim-cf-ei', true, false, 155.9]);
    }
    const cf = resolveOwn('kim', 'm16_CF');
    expect(cf.kind === 'norm' && cf.sd).toBe(6.24);
    const ei = resolveOwn('kim', 'm17_ExtrIndex');
    expect(ei.kind === 'norm' && [ei.sd, ei.range]).toEqual([null, null]);
    expect(ei.kind === 'norm' && ei.entry.note).toMatch(/< 149\.0° extraction; 149\.0°–155\.9° borderline; > 155\.9° non-extraction/);
    expect([resolveOwn('kim', 'm15_ODI'), resolveOwn('kim', 'm14_APDI')].map((r) => r.kind === 'norm' && r.setId)).toEqual(['kim1974', 'kimvietas1978']);
  });

  it('every website set: status website, compared 2026-10-08, scale not stated, cited to its page, accessed 2026-10-07, no sdSource', () => {
    for (const id of WEB_SETS) {
      const s = setById(id);
      expect(s, id).toBeDefined();
      if (!s) continue;
      expect([id, s.kind, s.status, s.curation.comparedOn, s.scale, s.population.id]).toEqual([id, 'analysis-own', 'website', '2026-10-08', { kind: 'not-stated' }, 'analysis-own']);
      expect(s.citation.url).toMatch(/^https:\/\/www\.onfile\.com\//);
      expect(s.curation.notes).toMatch(/accessed 2026-10-07/);
      expect(s.entries.filter((e) => e.sdSource !== undefined)).toEqual([]);
    }
  });

  it('a website ± not stated to be an SD carries the note; Björk–Jarabak and Kim print an SD column, so theirs do not', () => {
    for (const id of ['onfile-abo', 'onfile-nagasaki', 'onfile-radney']) {
      const missing = setById(id)!.entries.filter((e) => e.sd !== undefined && !/printed as ± on the website; not stated to be an SD/.test(e.note ?? ''));
      expect([id, missing.map((e) => e.measurement)]).toEqual([id, []]);
    }
    for (const id of ['onfile-bjork-jarabak', 'onfile-kim-cf-ei']) {
      const onfile = setById(id)!.entries.filter((e) => e.sd !== undefined && !e.source.startsWith('[source removed]'));
      expect(onfile.length).toBeGreaterThan(0);
      expect(onfile.filter((e) => /not stated to be an SD/.test(e.note ?? '')).map((e) => e.measurement)).toEqual([]);
    }
  });

  it('Björk–Jarabak: onfile constructs gonion, so every gonion measurement is close; saddle angle and N–Me are same', () => {
    const s = setById('onfile-bjork-jarabak')!;
    const match = Object.fromEntries(s.entries.map((e) => [e.measurement, e.definitionMatch]));
    expect(match).toEqual({
      m34_Saddle: 'same', m35_Articular: 'close', m36_Gonial: 'close', m37_UpperGonial: 'close', m38_LowerGonial: 'close',
      m39_SumAngles: 'close', m40_SGo: 'close', m41_NMe: 'same', m42_Jarabak: 'close', m44_ArStoArGo: 'close',
    });
    for (const e of s.entries.filter((x) => x.definitionMatch === 'close')) expect(e.definitionNote).toMatch(/constructed/);
  });

  it('Björk–Jarabak: the "mean norm" bands are ranges with the wider clinical range in the note; #44 is [source removed]\'s, said so', () => {
    const s = setById('onfile-bjork-jarabak')!;
    const e = (id: string) => s.entries.find((x) => x.measurement === id)!;
    expect(e('m37_UpperGonial').note).toMatch(/47°–60°/);
    expect(e('m38_LowerGonial').note).toMatch(/65°–80°/);
    expect(e('m42_Jarabak').note).toMatch(/59%–68%/);
    expect(e('m44_ArStoArGo').source).toMatch(/^[source removed] Dental/);
    expect(s.caveats.some((c) => /#44/.test(c) && /not from onfile/.test(c))).toBe(true);
    expect(s.caveats.some((c) => /#43/.test(c))).toBe(true);
  });

  it('Björk–Jarabak P15: the sum of angles, 396°, loads (its own plausibility window)', () => {
    expect(setById('onfile-bjork-jarabak')!.entries.find((x) => x.measurement === 'm39_SumAngles')!.mean).toBe(396);
  });

  it('caveats: Nagasaki\'s skeletal rows repeat the ABO page; Radney\'s two incisor angles are both 22 ± 2; Kim\'s attribution is garbled', () => {
    expect(setById('onfile-nagasaki')!.caveats.some((c) => /ABO page/.test(c))).toBe(true);
    expect(setById('onfile-radney')!.caveats.some((c) => /22 ± 2/.test(c))).toBe(true);
    expect(setById('onfile-kim-cf-ei')!.caveats.some((c) => /Kim IK \(1978, 1987\)/.test(c))).toBe(true);
  });

  it('edges: a chosen population with no ABO norm uses ABO\'s own (website) value, Auto, ungraded (N-A3, AUTO-Q5); with no population a girl of 12 or a man of unknown age gets the same pooled row, never coloured', () => {
    const jp = { measurement: 'm90_SNMP_ABO', analysisId: 'abo', clinicDefault: null, sets, userNorms: [], population: 'japanese', sex: 'F' as const, ageYears: 12 };
    const auto = resolveNorm(jp); expect(auto.kind === 'norm' && [auto.setId, auto.mean, auto.colour, auto.flags.includes('website'), auto.flags.includes('auto-fallback')]).toEqual(['onfile-abo', 32, false, true, true]);   // AUTO-Q5: the own norm is a website value — shown, not graded
    const picked = resolveNorm({ ...jp, picks: { japanese: { m90_SNMP_ABO: 'analysis-own' } } });
    expect(picked.kind === 'norm' && [picked.setId, picked.mean, picked.colour, picked.flags.includes('website'), picked.flags.includes('chosen-by-you')]).toEqual(['onfile-abo', 32, false, true, true]);
    const cases = [
      { population: null, sex: 'M' as const, ageYears: null },
      { population: null, sex: 'F' as const, ageYears: 12 },
    ];
    for (const c of cases) {
      const r = resolveNorm({ measurement: 'm90_SNMP_ABO', analysisId: 'abo', clinicDefault: null, sets, userNorms: [], ...c });
      expect(r.kind).toBe('norm');
      if (r.kind !== 'norm') continue;
      expect([c, r.setId, r.mean, r.colour, r.flags.includes('website')])
        .toEqual([c, 'onfile-abo', 32, false, true]);
    }
    const mm = resolveOwn('abo', 'm46_U1NAmm');
    expect(mm.kind === 'norm' && [mm.mean, mm.flags.includes('scale-assumed'), mm.printed]).toEqual([4, true, null]);
  });

  // A synthetic population set that measures SNA the same way, with its own SD: the donor a
  // non-website SD-less entry would borrow from (Task 4c rule 15).
  const donor: NormSet = {
    id: 'synthetic-donor', kind: 'population', status: 'verified',
    citation: { authors: 'SYNTHETIC A', title: 'Synthetic donor', year: 2026, openAccess: true },
    population: { id: 'caucasian', label: 'Caucasian', ethnicity: [] },
    sample: { n: 100 }, selection: 'class-I-balanced', modality: 'digital', scale: { kind: 'not-stated' }, headPosition: 'FH',
    curation: { extractedBy: ['SYNTHETIC'], date: '2026-10-08' }, caveats: [],
    entries: [{ measurement: 'm01_SNA', sex: 'pooled', mean: 81, sd: 3.3, unit: 'deg', source: 'SYNTHETIC', definitionMatch: 'same' }],
  };
  const naga = () => setById('onfile-nagasaki')!;
  const resolveIn = (useSets: NormSet[]) =>
    resolveNorm({ measurement: 'm01_SNA', analysisId: 'nagasaki', population: null, clinicDefault: null, sex: null, ageYears: null, sets: useSets, userNorms: [] });

  it('a website entry with its own SD is never coloured, and does not borrow from a matching population donor', () => {
    const r = resolveIn([...sets, donor]);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.sd, r.colour, r.sdDonor, r.flags.includes('sd-borrowed')]).toEqual(['onfile-nagasaki', 2, false, null, false]);
  });

  it('a website entry WITHOUT an SD also borrows nothing from that donor (rule 13)', () => {
    const noSd: NormSet = { ...naga(), entries: naga().entries.map((e) => (e.measurement === 'm01_SNA' ? { ...e, sd: undefined } : e)) };
    const r = resolveIn([...sets.filter((s) => s.id !== 'onfile-nagasaki'), noSd, donor]);
    expect(r.kind === 'norm' && [r.setId, r.sd, r.colour, r.sdDonor]).toEqual(['onfile-nagasaki', null, false, null]);
  });

  it('positive control: the same SD-less entry in a set that is NOT a website set does borrow the donor\'s SD', () => {
    const paper: NormSet = { ...naga(), status: 'verified', entries: naga().entries.map((e) => (e.measurement === 'm01_SNA' ? { ...e, sd: undefined } : e)) };
    // Task 9a-1: the committed population sets (Zheng 2026's SNA, n 120) are real donors too and
    // outrank this synthetic one, so they are left out: the control is about the website rule only.
    const r = resolveIn([...sets.filter((s) => s.id !== 'onfile-nagasaki' && s.kind !== 'population'), paper, donor]);
    expect(r.kind === 'norm' && [r.sd, r.colour, r.sdDonor?.setId]).toEqual([3.3, true, 'synthetic-donor']);
    // Fix round 1 (review minor): with EVERY committed set loaded, the same entry still finds a donor.
    const full = resolveIn([...sets.filter((s) => s.id !== 'onfile-nagasaki'), paper, donor]);
    expect(full.kind === 'norm' && full.sdDonor !== null && full.colour).toBe(true);
  });

  it('a website set is never a donor: with only website sets for SNA loaded, a paper\'s SD-less SNA borrows nothing', () => {
    const paper: NormSet = { ...donor, id: 'synthetic-paper', kind: 'analysis-own', analyses: ['nagasaki'], population: { id: 'analysis-own', label: 'own', ethnicity: [] }, entries: [{ ...donor.entries[0], sd: undefined }] };
    const websiteAsPopulation: NormSet = { ...naga(), id: 'synthetic-web-pop', kind: 'population', population: { id: 'caucasian', label: 'Caucasian', ethnicity: [] } };
    const r = resolveIn([...sets.filter((s) => s.kind !== 'population'), paper, websiteAsPopulation]);
    expect(r.kind === 'norm' && [r.setId, r.sdDonor, r.colour]).toEqual(['synthetic-paper', null, false]);
    // Positive control: the same set marked verified IS taken as the donor.
    const verifiedPop: NormSet = { ...websiteAsPopulation, status: 'verified' };
    const c = resolveIn([...sets.filter((s) => s.kind !== 'population'), paper, verifiedPop]);
    expect(c.kind === 'norm' && [c.setId, c.sdDonor?.setId, c.colour]).toEqual(['synthetic-paper', 'synthetic-web-pop', true]);
  });
});

// ---- Task 9a-1: population sets — Zheng 2026, Wu 2007, Gu 2011 (Chinese and Caucasian), Mohammad
// 2011. Typed twice from the papers; every difference settled from the page images
// (task-9a1-report.md). Every query below gives a real (SYNTHETIC) age, sex and population.
const resolvePop = (measurement: string, population: string, sex: 'M' | 'F' | null, ageYears: number | null, useSets = sets) =>
  resolveNorm({ measurement, analysisId: 'steiner', population, clinicDefault: null, sex, ageYears, sets: useSets, userNorms: [] });

const T9A1: Record<string, { population: string; scale: NormSet['scale'] }> = {
  zheng2026: { population: 'chinese', scale: { kind: 'not-stated' } },
  wu2007: { population: 'chinese', scale: { kind: 'not-stated' } },
  gu2011: { population: 'chinese', scale: { kind: 'enlarged', percent: 8, source: 'p. 206' } },
  'gu2011-caucasian': { population: 'caucasian', scale: { kind: 'enlarged', percent: 8, source: 'p. 206' } },
  mohammad2011: { population: 'malay', scale: { kind: 'not-stated' } },
  norman2020: { population: 'malay', scale: { kind: 'not-stated' } },
};

describe('population sets (Task 9a-1): Zheng, Wu, Gu (Chinese and Caucasian), Mohammad', () => {
  const setById = (id: string) => sets.find((s) => s.id === id);
  // Task 9a-2 added the Moate & Darendeliler 2002 Chinese sets. Where they cover the same ages, two of
  // them (Miao 1995, n 209; Fu 1975, n 144) now outrank Zheng (n 120) under rule 5, so the tests below
  // that choose BETWEEN Zheng, Wu and Gu run on the sets without Moate's, to keep testing that choice.
  // What the full pool now gives is stated in the Task 9a-2 block ('the Moate sets change ...').
  const pre9a2 = () => sets.filter((s) => !s.id.startsWith('moate2002-'));

  it.each(Object.entries(T9A1))('%s: population set, verified, compared 2026-10-08, its population and film scale, no centre, no sdSource', (id, want) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    expect([s.kind, s.status, s.curation.comparedOn, s.population.id, s.scale]).toEqual(['population', 'verified', '2026-10-08', want.population, want.scale]);
    expect(s.curation.extractedBy).toHaveLength(2);
    expect(s.entries.filter((e) => e.centre !== undefined || e.sdSource !== undefined).map((e) => e.measurement)).toEqual([]);
    expect(s.entries.filter((e) => e.sd === undefined).map((e) => e.measurement)).toEqual([]);
  });

  // One SYNTHETIC-age query per population, for a measurement the population's set covers.
  it('chinese: a man of 30 gets Zheng 2026\'s adult SNA row (18–41 y), 83.0 ± 3.7 (Table 4; Table 5 prints 3.6)', () => {
    const r = resolvePop('m01_SNA', 'chinese', 'M', 30, pre9a2());
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.entry.ageBand, r.mean, r.sd, r.colour]).toEqual(['zheng2026', [18, 41], 83, 3.7, true]);
    expect(r.flags).not.toContain('age-mismatched');
    expect(r.entry.note).toMatch(/Table 5.*3\.6/);
  });

  it('malay (AGE-1): a woman of 22 — Norman 2020 (15–30) and Mohammad 2011 (20–24) both cover her and are both class-I balanced, so the larger sample, Norman (n 100 > 60), gives her own-sex SNA 84.5 ± 3.0', () => {
    const r = resolvePop('m01_SNA', 'malay', 'F', 22);
    expect(r.kind === 'norm' && [r.setId, r.entry.sex, r.entry.ageBand, r.mean, r.sd, r.colour]).toEqual(['norman2020', 'F', [15, 30], 84.5, 3, true]);
    // Mohammad still gives what Norman does not measure (Steiner's SND).
    const snd = resolvePop('m87_SND', 'malay', 'F', 22);
    expect(snd.kind === 'norm' && [snd.setId, snd.mean]).toEqual(['mohammad2011', 77.5]);
  });

  it('malay: a Malay man of 25 gets Norman 2020\'s men\'s MMPA 24.7 ± 7.2, close (P42: Eastman named, plane not defined)', () => {
    const r = resolvePop('m25_MMPA', 'malay', 'M', 25);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.mean, r.sd, r.entry.definitionMatch, r.flags.includes('close')]).toEqual(['norman2020', 24.7, 7.2, 'close', true]);
  });

  it('caucasian: a man of 25 gets Gu 2011\'s Michigan Wits, −0.9 ± 2.6, close: occlusal plane not stated (owner 7 Oct)', () => {
    const r = resolvePop('m13_Wits', 'caucasian', 'M', 25);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    // Wits is mm, so the 8% film enlargement is taken off (printed −0.9 ± 2.6).
    expect([r.setId, r.printed?.mean, r.printed?.sd, r.entry.definitionMatch]).toEqual(['gu2011-caucasian', -0.9, 2.6, 'close']);
    expect(r.mean).toBeCloseTo(-0.9 / 1.08, 10);
    expect(r.flags).toContain('close');
    expect(r.entry.definitionNote).toMatch(/occlusal plane not stated in the paper/);
    expect(r.sourceLine).toContain('occlusal plane not stated in the paper');
    expect(r.sourceLine).toMatch(/^Gu 2011, Caucasian .*\(Michigan/);
  });

  it('AGE-1: a Chinese boy of 13 — Zheng (10–17) and Wu (11–13) both cover him, so rule 5 decides: Zheng\'s class-I balanced sample before Wu\'s random school sample', () => {
    const r = resolvePop('m01_SNA', 'chinese', 'M', 13, pre9a2());
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.entry.ageBand, r.mean, r.sd, r.ageRowUsed]).toEqual(['zheng2026', [10, 17], 82.7, 3.3, '10–17 y']);
    expect(r.flags).not.toContain('age-mismatched');
    // Positive control: the same boy with Zheng and Gu not loaded gets Wu's boys' row, unflagged
    // (13 is inside 11–13), so the preference above really chose between two covering rows.
    const wuOnly = resolvePop('m01_SNA', 'chinese', 'M', 13, pre9a2().filter((s) => s.id !== 'zheng2026' && s.id !== 'gu2011'));
    expect(wuOnly.kind === 'norm' && [wuOnly.setId, wuOnly.mean, wuOnly.flags.includes('age-mismatched')]).toEqual(['wu2007', 81.78, false]);
  });

  // Owner AGE-1 on the real Chinese sets: Co–Gn is in Wu (11–13) and Gu (16–30), not in Zheng.
  it.each([
    [12, 'M', 'wu2007', false, 'a boy of 12: Wu covers 11–13, so Wu before Gu'],
    [11, 'F', 'wu2007', false, 'a girl of 11 (Table 1 starts at 11.9; completed years): Wu'],
    [20, 'M', 'gu2011', false, 'a man of 20: Gu covers 16–30, Wu does not'],
    [15, 'M', 'gu2011', true, 'a boy of 15: neither covers; rule 5 (Gu, class-I balanced), flagged age-mismatched'],
    [14, 'M', 'wu2007', true, 'a boy of 14: neither covers; owner AGE-2 the nearest age, Wu (11–13, 1 y away) over Gu (16–30, 2 y away), flagged'],
    [null, 'M', 'gu2011', false, 'age unknown: rule 5 (Gu); its 16–30 band spans 18, so it is an adult row, unflagged (owner AGE-3)'],
  ] as const)('AGE-1 Co–Gn, Chinese, age %s %s → %s (age-mismatched %s): %s', (age, sex, setId, flagged, _why) => {
    const r = resolvePop('m11_CoGn', 'chinese', sex, age);
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('age-mismatched')]).toEqual([setId, flagged]);
  });

  it('AGE-3: age unknown — Gu (16–30) and Norman (15–30) rows span 18, so they are adult rows: not flagged, not said; the values do not change', () => {
    const gu = resolvePop('m11_CoGn', 'chinese', 'F', null);
    const norman = resolvePop('m01_SNA', 'malay', 'M', null);
    expect(gu.kind === 'norm' && [gu.setId, gu.entry.ageBand, gu.flags.includes('age-mismatched'), /age unknown/.test(gu.sourceLine)]).toEqual(['gu2011', [16, 30], false, false]);
    expect(norman.kind === 'norm' && [norman.setId, norman.entry.ageBand, norman.mean, norman.flags.includes('age-mismatched')]).toEqual(['norman2020', [15, 30], 84.6, false]);
  });

  it('AGE-1: a Chinese boy of 15 gets Zheng\'s adolescent SNA (10–17 covers him), not Gu (16–30)', () => {
    const r = resolvePop('m01_SNA', 'chinese', 'M', 15);
    expect(r.kind === 'norm' && [r.setId, r.entry.ageBand, r.flags.includes('age-mismatched')]).toEqual(['zheng2026', [10, 17], false]);
  });

  it('Zheng ages: 9 → the adolescent row flagged age-mismatched; 45 → the adult row flagged; unknown age → the adult row unflagged', () => {
    const at = (age: number | null) => resolvePop('m02_SNB', 'chinese', 'F', age, pre9a2());
    const nine = at(9), old = at(45), unknown = at(null);
    expect(nine.kind === 'norm' && [nine.entry.ageBand, nine.mean, nine.flags.includes('age-mismatched')]).toEqual([[10, 17], 80.1, true]);
    expect(old.kind === 'norm' && [old.entry.ageBand, old.mean, old.flags.includes('age-mismatched')]).toEqual([[18, 41], 81, true]);
    expect(unknown.kind === 'norm' && [unknown.entry.ageBand, unknown.mean, unknown.flags.includes('age-mismatched')]).toEqual([[18, 41], 81, false]);
  });

  it('Zheng L1/OP: stored as the deviation from 90° (113.0 → 23.0, 112.8 → 22.8), SD unchanged, close (functional plane), the note says so', () => {
    const rows = setById('zheng2026')!.entries.filter((e) => e.measurement === 'm62_L1OPdev');
    expect(rows.map((e) => [e.ageBand, e.mean, e.sd, e.definitionMatch])).toEqual([[[10, 17], 23, 7.1, 'close'], [[18, 41], 22.8, 2.1, 'close']]);
    for (const e of rows) expect(e.note).toMatch(/prints the full angle \(11[23]\.[08]°\); stored as the deviation from 90° to match the catalogue/);
    expect(setById('zheng2026')!.caveats.some((c) => /2\.1/.test(c) && /possible typesetting error in the source/.test(c))).toBe(true);
  });

  it('Zheng P47: Table 3 calls Go–Gn "the mandibular plane", so IMPA is L1–GoGn (#59, same); FMA stays on #22 close with that evidence; FMIA same; OP/FH and OP/SN close; Wits close since NUS-OP-1 (16 Oct 2026: the app measures Wits on the standard plane, Zheng on the functional)', () => {
    const s = setById('zheng2026')!;
    const m = (id: string) => [...new Set(s.entries.filter((e) => e.measurement === id).map((e) => e.definitionMatch))];
    expect([m('m22_FHMPt'), m('m59_L1GoGn'), m('m56_IMPAt'), m('m58_FMIA'), m('m61_CantOP'), m('m60_OPSN'), m('m13_Wits')]).toEqual([['close'], ['same'], [], ['same'], ['close'], ['close'], ['close']]);
    for (const e of s.entries.filter((x) => x.measurement === 'm22_FHMPt')) expect(e.definitionNote).toMatch(/Go–Gn/);
    for (const e of s.entries.filter((x) => x.measurement === 'm59_L1GoGn')) expect(e.note).toMatch(/GoGn\/SN.*the mandibular plane/);
    expect(s.entries.filter((x) => x.measurement === 'm59_L1GoGn').map((e) => [e.ageBand, e.mean, e.sd])).toEqual([[[10, 17], 96.2, 7.3], [[18, 41], 95.7, 6.8]]);
    expect(s.entries.find((x) => x.measurement === 'm24_YAxis')!.note).toMatch(/points not named; S–Gn assumed \(the conventional Y-axis\)/);
    expect(s.entries).toHaveLength(54);
    expect(s.caveats.some((c) => /SL/.test(c) && /SE/.test(c))).toBe(true);
  });

  it('Gu: an mm norm is converted to true size (÷ 1.08) with the disclosure — a Chinese man of 25\'s Co–Gn, printed 125.4 mm', () => {
    const r = resolvePop('m11_CoGn', 'chinese', 'M', 25);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect(r.setId).toBe('gu2011');
    expect(r.mean).toBeCloseTo(125.4 / 1.08, 10);
    expect(r.sd).toBeCloseTo(6.9 / 1.08, 10);
    expect([r.printed?.mean, r.printed?.sd]).toEqual([125.4, 6.9]);
    expect(r.flags).toContain('converted-to-true-size');
    expect(r.sourceLine).toContain('converted from 8% film enlargement (p. 206); printed 125.4 mm');
    const deg = resolvePop('m86_Nasolabial', 'chinese', 'M', 25);
    expect(deg.kind === 'norm' && [deg.setId, deg.mean, deg.printed, deg.flags.includes('converted-to-true-size')]).toEqual(['gu2011', 104.9, null, false]);
  });

  it('Gu (both sets): #31 stored as value + 90 and close; MP → #23 close; IMPA → #57 close; incisor mm rows close; AGE-1 bands Chinese 16–30, Caucasian 18–40 on every row, the note citing the mean ages', () => {
    const BAND: Record<string, [number, number]> = { gu2011: [16, 30], 'gu2011-caucasian': [18, 40] };
    for (const id of ['gu2011', 'gu2011-caucasian']) {
      const s = setById(id)!;
      const close = ['m31_FacAxisM', 'm23_FHGoMe', 'm57_IMPAgome', 'm67_U1Avert', 'm64_L1APog', 'm13_Wits'];
      expect([id, s.entries.filter((e) => close.includes(e.measurement) !== (e.definitionMatch === 'close')).map((e) => e.measurement)]).toEqual([id, []]);
      expect([id, s.entries.filter((e) => JSON.stringify(e.ageBand) !== JSON.stringify(BAND[id])).length]).toEqual([id, 0]);
      expect([id, s.entries.filter((e) => !/mean ages/.test(e.note ?? '')).length]).toEqual([id, 0]);
      expect(s.entries).toHaveLength(38);
      for (const e of s.entries.filter((x) => x.measurement === 'm31_FacAxisM')) expect(e.note).toMatch(/\+ 90°/);
    }
    const fa = (id: string, sex: 'M' | 'F') => setById(id)!.entries.find((e) => e.measurement === 'm31_FacAxisM' && e.sex === sex)!.mean;
    expect([fa('gu2011', 'F'), fa('gu2011', 'M'), fa('gu2011-caucasian', 'F'), fa('gu2011-caucasian', 'M')]).toEqual([87.8, 84.6, 88.4, 87.5]);
    // Review minor: the owner's 7 Oct ruling was the Caucasian Wits; the Chinese note does not cite it.
    for (const e of setById('gu2011')!.entries.filter((x) => x.measurement === 'm13_Wits')) expect(e.definitionNote).toBe('occlusal plane not stated in the paper');
  });

  it('Gu Caucasian men\'s maxillomandibular difference: Table 2\'s 37.2, the note gives Table 4\'s 37.3', () => {
    const e = setById('gu2011-caucasian')!.entries.find((x) => x.measurement === 'm12_MaxMandDiff' && x.sex === 'M')!;
    expect([e.mean, e.sd]).toEqual([37.2, 5.7]);
    expect(e.note).toMatch(/Table 4.*37\.3/);
  });

  // Few rows: every merged mean/SD for Wu (Table 3, p. 16 and Table 3 Extended, p. 17) and Mohammad
  // (Tables 1 and 2, p. 631), each resolved for a SYNTHETIC patient of the paper's own age. Zheng and
  // Gu are left out of the Wu query (they rank first in the Chinese population, rule 5).
  const WU: [string, number, number, number, number][] = [
    ['m08_ANperp', -0.75, 3.6, -0.53, 3.48], ['m01_SNA', 81.78, 3.65, 81.97, 3.5], ['m11_CoGn', 113.95, 5.73, 113.32, 5.43],
    ['m10_CoA', 87.9, 4.71, 85.93, 4.41], ['m12_MaxMandDiff', 26.06, 4.26, 27.39, 3.68], ['m28_LAFH', 66.14, 4.68, 64.39, 4.34],
    ['m23_FHGoMe', 27.81, 5.19, 26.1, 5.07], ['m31_FacAxisM', 84.49, 3.94, 86.17, 3.71], ['m09_PogNperp', -7.45, 6.93, -4.88, 6.51],
    ['m67_U1Avert', 7.34, 2.82, 7.86, 2.6], ['m64_L1APog', 6.35, 2.43, 6.26, 2.25],
  ];
  const wuSets = () => sets.filter((s) => s.id !== 'zheng2026' && s.id !== 'gu2011');
  it.each(WU)('Wu %s at 12 y: boys %s ± %s, girls %s ± %s', (id, mM, sdM, mF, sdF) => {
    const boy = resolvePop(id, 'chinese', 'M', 12, wuSets());
    const girl = resolvePop(id, 'chinese', 'F', 12.5, wuSets());
    expect(boy.kind === 'norm' && [boy.setId, boy.entry.sex, boy.entry.ageBand, boy.entry.mean, boy.entry.sd, boy.entry.n]).toEqual(['wu2007', 'M', [11, 13], mM, sdM, 200]);
    expect(girl.kind === 'norm' && [girl.setId, girl.entry.sex, girl.entry.ageBand, girl.entry.mean, girl.entry.sd, girl.entry.n]).toEqual(['wu2007', 'F', [11, 13], mF, sdF, 205]);
    expect(boy.kind === 'norm' && boy.flags.includes('age-mismatched')).toBe(false);
  });
  it('Wu: the table covers every entry (22 = 11 measurements × 2 sexes); AGE-1 band 11–13 for both sexes, the note quoting Table 1', () => {
    const s = setById('wu2007')!;
    expect(s.entries).toHaveLength(WU.length * 2);
    expect(s.entries.filter((e) => JSON.stringify(e.ageBand) !== '[11,13]')).toEqual([]);
    for (const e of s.entries) expect(e.note).toMatch(e.sex === 'M' ? /Table 1: boys 11\.0–13\.0/ : /Table 1: girls 11\.9–13\.0/);
  });

  it('Wu: #31 is value + 90 (the note says so); incisor rows close (facial surface); Co rows close (condylion = most posterior point); film scale caveat quotes 8.8%', () => {
    const s = setById('wu2007')!;
    for (const e of s.entries.filter((x) => x.measurement === 'm31_FacAxisM')) expect(e.note).toMatch(/Wu tabulates the difference from 90°; stored as value \+ 90° \(owner ruling 7 Oct\)/);
    for (const e of s.entries.filter((x) => x.measurement === 'm67_U1Avert' || x.measurement === 'm64_L1APog')) {
      expect([e.definitionMatch, /facial surface/.test(e.definitionNote ?? '')]).toEqual(['close', true]);
    }
    for (const e of s.entries.filter((x) => ['m10_CoA', 'm11_CoGn', 'm12_MaxMandDiff'].includes(x.measurement))) {
      expect([e.measurement, e.definitionMatch, /rearmost point on the condyle's outline/.test(e.definitionNote ?? '')]).toEqual([e.measurement, 'close', true]);
    }
    expect(s.caveats).toContain('Film magnification 8.8% is stated (p. 14) but not whether values were corrected; assumed true size (owner ruling 8 Oct)');
    const mm = resolvePop('m28_LAFH', 'chinese', 'F', 12, wuSets());
    expect(mm.kind === 'norm' && [mm.mean, mm.flags.includes('scale-assumed'), mm.printed]).toEqual([64.39, true, null]);
  });

  const MOH: [string, number, number][] = [
    ['m01_SNA', 83.7, 2.82], ['m02_SNB', 81.2, 2.86], ['m03_ANB', 2.5, 1.58], ['m87_SND', 77.5, 2.96], ['m53_Interincisal', 121, 8.29],
    ['m60_OPSN', 16.7, 3.73], ['m20_SNGoGn', 34.5, 4.27], ['m47_U1NAdeg', 24.1, 5.63], ['m54_U1SN', 107.3, 6.25], ['m50_L1NBdeg', 32.3, 5.2],
    ['m46_U1NAmm', 11.6, 4.09], ['m49_L1NBmm', 11, 2.94], ['m18_PogNB', 0.8, 2.75], ['m71_ULE', -2, 2.79], ['m72_LLE', 2.2, 3.32],
  ];
  const mohSets = () => sets.filter((s) => s.id !== 'norman2020'); // Norman ranks first where it measures (AGE-1, n)
  it.each(MOH)('Mohammad %s for a Malay man of 21: %s ± %s', (id, mean, sd) => {
    const r = resolvePop(id, 'malay', 'M', 21, mohSets());
    expect(r.kind === 'norm' && [r.setId, r.entry.sex, r.entry.ageBand, r.mean, r.sd, r.entry.n, r.flags.includes('age-mismatched')]).toEqual(['mohammad2011', 'pooled', [20, 24], mean, sd, 60, false]);
  });
  it('Mohammad: the table covers every entry; a Malay girl of 12 still gets the 20–24 y row, flagged age-mismatched', () => {
    expect(setById('mohammad2011')!.entries).toHaveLength(MOH.length);
    const r = resolvePop('m87_SND', 'malay', 'F', 12);
    expect(r.kind === 'norm' && [r.setId, r.entry.ageBand, r.flags.includes('age-mismatched')]).toEqual(['mohammad2011', [20, 24], true]);
  });

  it('Mohammad: U1–NA and L1–NB mm (11.6, 11.0) are close with a caveat that the method is not described; OP–SN close; caveats on scale and citation', () => {
    const s = setById('mohammad2011')!;
    const m = (id: string) => s.entries.find((e) => e.measurement === id)!;
    expect([m('m46_U1NAmm').definitionMatch, m('m49_L1NBmm').definitionMatch, m('m60_OPSN').definitionMatch]).toEqual(['close', 'close', 'close']);
    expect(s.caveats.some((c) => /11\.6/.test(c) && /11\.0/.test(c))).toBe(true);
    expect(s.caveats).toContain("Planmeca '1.13 magnifications' stated (p. 628) but not whether values were corrected; assumed true size (owner ruling 8 Oct)");
    expect(s.caveats).toContain("citation details differ from SOURCES.md; the paper's header is used");
    expect(s.citation.authors).toBe('Mohammad HA, Abu Hassan MI, Hussain SF');
    // Owner MAL-1: kept, with the paper's own wording and the Norman 2020 cross-check.
    for (const id of ['m46_U1NAmm', 'm49_L1NBmm']) expect(m(id).note).toMatch(/names no incisor point.*Holdaway ratio 10\.4 ≈ 11\.0 − 0\.8.*Norman et al\. 2020/);
    expect(s.caveats.some((c) => /Norman et al\. 2020 \(100 Malay adults\) agrees on SNA, SNB, ANB and the interincisal angle/.test(c))).toBe(true);
  });

  // Norman 2020 (ruling P42; owner MAL-1): Table 1 (pooled, p. 218) and Table 2 (by sex), 100 Malay
  // adults aged 15–30. Every mean/SD; the "Eastman mean" column is not entered.
  const NORMAN: [string, [number, number], [number, number], [number, number]][] = [
    ['m01_SNA', [84.5, 4.0], [84.6, 4.8], [84.5, 3.0]], ['m02_SNB', [81.2, 4.1], [81.3, 4.7], [81.2, 3.4]],
    ['m03_ANB', [3.2, 1.2], [3.1, 1.2], [3.3, 1.1]], ['m55_U1MxP', [117.3, 6.5], [117.7, 6.7], [116.8, 6.4]],
    ['m57_IMPAgome', [96.0, 7.1], [94.6, 7.7], [97.3, 6.3]], ['m53_Interincisal', [121.8, 8.8], [122.6, 10.2], [121.1, 7.1]],
    ['m25_MMPA', [24.8, 6.7], [24.7, 7.2], [24.9, 6.2]], ['m29_LAFHpct', [55.7, 2.3], [55.9, 2.4], [55.5, 2.1]],
  ];
  it.each(NORMAN)('Norman %s: pooled %j, men %j, women %j (15–30 y)', (id, pooled, men, women) => {
    const rows = setById('norman2020')!.entries.filter((e) => e.measurement === id);
    const get = (sex: string) => rows.find((e) => e.sex === sex);
    expect([get('pooled'), get('M'), get('F')].map((e) => e && [e.mean, e.sd, e.n, e.ageBand])).toEqual([
      [pooled[0], pooled[1], 100, [15, 30]], [men[0], men[1], 50, [15, 30]], [women[0], women[1], 50, [15, 30]],
    ]);
    const boy = resolvePop(id, 'malay', 'M', 17);
    expect(boy.kind === 'norm' && [boy.setId, boy.entry.sex, boy.flags.includes('age-mismatched')]).toEqual(['norman2020', 'M', false]);
  });
  it('Norman: 24 rows (8 × pooled, men, women); MMPA, IMPA and facial proportion close (P42; heights perpendicular to the maxillary plane, p. 219); the rest same; class-I balanced', () => {
    const s = setById('norman2020')!;
    expect(s.entries).toHaveLength(NORMAN.length * 3);
    const close = s.entries.filter((e) => e.definitionMatch === 'close').map((e) => e.measurement);
    expect([...new Set(close)].sort()).toEqual(['m25_MMPA', 'm29_LAFHpct', 'm57_IMPAgome']);
    expect(s.entries.find((e) => e.measurement === 'm29_LAFHpct')!.definitionNote).toMatch(/perpendicular/);
    expect(s.selection).toBe('class-I-balanced');
    expect(s.caveats.some((c) => /Eastman mean/.test(c))).toBe(true);
  });
});

// ---- Task 9a-2: the Chinese studies compiled by Moate & Darendeliler 2002 (Aust Orthod J 18:19–26),
// one second-hand population set per underlying study. Typed twice from the compilation's page
// images; every difference settled from the page (task-9a2-report.md). The table below is a third,
// independent reading of Tables I–VI (pp. 20–24), so a mistyped or misplaced value anywhere fails.
// Ages are the table headers: a single age a → [a, a]; "18 Years +" → [18, 40] (P18); So 1990 → [10, 15].
type MoateRow = [string, 'M' | 'F' | 'pooled', [number, number], number, number | null];
const AD: [number, number] = [18, 40];
const at = (a: number): [number, number] => [a, a];
const MOATE: Record<string, { via: string; year: number; rows: MoateRow[] }> = {
  'moate2002-miao1995': {
    via: 'Moate & Darendeliler 2002, Tables I, III and IV', year: 1995,
    rows: [
      ['m01_SNA', 'M', at(7), 82, 1], ['m01_SNA', 'M', at(9), 81, 3], ['m01_SNA', 'M', at(13), 84, 2], ['m01_SNA', 'M', AD, 85, 4],
      ['m01_SNA', 'F', at(7), 80, 4], ['m01_SNA', 'F', at(9), 81, 3], ['m01_SNA', 'F', at(13), 83, 2], ['m01_SNA', 'F', AD, 85, 2],
      ['m02_SNB', 'M', at(7), 77, 2], ['m02_SNB', 'M', at(9), 77, 3], ['m02_SNB', 'M', at(13), 80, 1], ['m02_SNB', 'M', AD, 81, 4],
      ['m02_SNB', 'F', at(7), 75, 3], ['m02_SNB', 'F', at(9), 77, 3], ['m02_SNB', 'F', at(13), 79, 1], ['m02_SNB', 'F', AD, 81, 4],
      ['m03_ANB', 'M', at(7), 5, 1], ['m03_ANB', 'M', at(9), 4, 2], ['m03_ANB', 'M', at(13), 4, 2], ['m03_ANB', 'M', AD, 4, 2],
      ['m03_ANB', 'F', at(7), 5, 3], ['m03_ANB', 'F', at(9), 4, 2], ['m03_ANB', 'F', at(13), 3, 2], ['m03_ANB', 'F', AD, 4, 3],
      ['m21_SNGoMe', 'M', at(7), 35, 3], ['m21_SNGoMe', 'M', at(9), 30, 5], ['m21_SNGoMe', 'M', at(13), 32, 7], ['m21_SNGoMe', 'M', AD, 29, 4],
      ['m21_SNGoMe', 'F', at(7), 29, 5], ['m21_SNGoMe', 'F', at(9), 32, 3], ['m21_SNGoMe', 'F', at(13), 30, 7], ['m21_SNGoMe', 'F', AD, 30, 8],
      ['m57_IMPAgome', 'M', at(9), 97, 6], ['m57_IMPAgome', 'F', at(9), 97, 6],
      ['m53_Interincisal', 'M', at(9), 122, 6], ['m53_Interincisal', 'F', at(9), 122, 7], ['m53_Interincisal', 'F', at(13), 125, 10],
      ['m36_Gonial', 'M', at(7), 133, 2], ['m36_Gonial', 'M', at(9), 125, 5], ['m36_Gonial', 'M', at(13), 126, 5], ['m36_Gonial', 'M', AD, 123, 5],
      ['m36_Gonial', 'F', at(7), 123, 6], ['m36_Gonial', 'F', at(9), 128, 4], ['m36_Gonial', 'F', at(13), 124, 5], ['m36_Gonial', 'F', AD, 122, 6],
      ['m35_Articular', 'M', at(9), 146, 3], ['m35_Articular', 'M', at(13), 146, 10], ['m35_Articular', 'M', AD, 146, 6],
      ['m35_Articular', 'F', at(9), 141, 6], ['m35_Articular', 'F', at(13), 149, 6], ['m35_Articular', 'F', AD, 144, 9],
      ['m60_OPSN', 'M', at(9), 21, 4], ['m60_OPSN', 'M', at(13), 17, 3], ['m60_OPSN', 'F', at(9), 23, 10], ['m60_OPSN', 'F', at(13), 18, 4],
      ['m28_LAFH', 'M', at(7), 55, 4], ['m28_LAFH', 'M', at(9), 59, 3], ['m28_LAFH', 'M', at(13), 63, 5], ['m28_LAFH', 'M', AD, 73, 5],
      ['m28_LAFH', 'F', at(7), 51, 4], ['m28_LAFH', 'F', at(9), 57, 3], ['m28_LAFH', 'F', at(13), 64, 5], ['m28_LAFH', 'F', AD, 68, 6],
    ],
  },
  'moate2002-fu1975': {
    via: 'Moate & Darendeliler 2002, Tables I, II, III and IV', year: 1975,
    rows: [
      ['m01_SNA', 'M', at(9), 82, 3], ['m01_SNA', 'M', at(11), 83, 3], ['m01_SNA', 'M', at(13), 83, 3], ['m01_SNA', 'M', AD, 84, 4],
      ['m01_SNA', 'F', at(9), 82, 3], ['m01_SNA', 'F', at(11), 83, 3], ['m01_SNA', 'F', at(13), 83, 3], ['m01_SNA', 'F', AD, 84, 4],
      ['m02_SNB', 'M', at(9), 77, 3], ['m02_SNB', 'M', at(11), 79, 3], ['m02_SNB', 'M', at(13), 79, 3], ['m02_SNB', 'M', AD, 81, 4],
      ['m02_SNB', 'F', at(9), 77, 3], ['m02_SNB', 'F', at(11), 79, 3], ['m02_SNB', 'F', at(13), 79, 3], ['m02_SNB', 'F', AD, 81, 4],
      ['m03_ANB', 'M', at(9), 5, 2], ['m03_ANB', 'M', at(11), 4, 1], ['m03_ANB', 'M', at(13), 4, 2], ['m03_ANB', 'M', AD, 3, 2],
      ['m03_ANB', 'F', at(9), 5, 2], ['m03_ANB', 'F', at(11), 4, 2], ['m03_ANB', 'F', at(13), 4, 2], ['m03_ANB', 'F', AD, 3, 2],
      ['m21_SNGoMe', 'M', at(9), 32, 6], ['m21_SNGoMe', 'F', at(9), 32, 3],
      ['m57_IMPAgome', 'M', at(9), 96, 6], ['m57_IMPAgome', 'M', at(11), 97, 5], ['m57_IMPAgome', 'M', AD, 97, 7],
      ['m57_IMPAgome', 'F', at(9), 98, 6], ['m57_IMPAgome', 'F', at(11), 97, 5], ['m57_IMPAgome', 'F', AD, 97, 7],
      ['m53_Interincisal', 'M', at(9), 122, 8], ['m53_Interincisal', 'M', at(11), 124, 6], ['m53_Interincisal', 'M', at(13), 124, 7], ['m53_Interincisal', 'M', AD, 125, 8],
      ['m53_Interincisal', 'F', at(9), 122, 9], ['m53_Interincisal', 'F', at(11), 124, 6], ['m53_Interincisal', 'F', AD, 125, 8],
      ['m36_Gonial', 'F', at(11), 124, 9],
      ['m28_LAFH', 'M', at(9), 60, 5], ['m28_LAFH', 'M', at(11), 67, 5], ['m28_LAFH', 'M', at(13), 67, 5], ['m28_LAFH', 'M', AD, 72, 5],
      ['m28_LAFH', 'F', at(9), 58, 5], ['m28_LAFH', 'F', at(11), 62, 3], ['m28_LAFH', 'F', at(13), 62, 3], ['m28_LAFH', 'F', AD, 66, 4],
      ['m30_FacAxisR', 'M', at(11), 83, 1], ['m30_FacAxisR', 'M', at(13), 84, 3], ['m30_FacAxisR', 'M', AD, 85, 4],
      ['m30_FacAxisR', 'F', at(13), 84, 3], ['m30_FacAxisR', 'F', AD, 85, 4],
      ['m24_YAxis', 'M', at(11), 66, 3], ['m24_YAxis', 'M', at(13), 66, 3], ['m24_YAxis', 'M', AD, 66, 4],
      ['m24_YAxis', 'F', at(11), 66, 3], ['m24_YAxis', 'F', at(13), 66, 3], ['m24_YAxis', 'F', AD, 66, 4],
    ],
  },
  'moate2002-lou1981': {
    via: 'Moate & Darendeliler 2002, Table III', year: 1981,
    rows: [
      ['m01_SNA', 'M', at(13), 81, 5], ['m02_SNB', 'M', at(13), 78, 4], ['m03_ANB', 'M', at(13), 4, 2], ['m21_SNGoMe', 'M', at(13), 29, 4],
      ['m57_IMPAgome', 'M', at(13), 98, 6], ['m53_Interincisal', 'M', at(13), 118, 7], ['m28_LAFH', 'M', at(13), 60, 5],
      ['m01_SNA', 'F', at(13), 81, 5], ['m02_SNB', 'F', at(13), 77, 4], ['m03_ANB', 'F', at(13), 4, 2], ['m21_SNGoMe', 'F', at(13), 28, 4],
      ['m57_IMPAgome', 'F', at(13), 95, 5], ['m53_Interincisal', 'F', at(13), 124, 7], ['m28_LAFH', 'F', at(13), 60, 6],
    ],
  },
  'moate2002-chen1985': {
    via: 'Moate & Darendeliler 2002, Table II', year: 1985,
    rows: [
      ['m01_SNA', 'M', at(12), 81, 3], ['m02_SNB', 'M', at(12), 78, 3], ['m03_ANB', 'M', at(12), 3, 2], ['m21_SNGoMe', 'M', at(12), 35, 5],
      ['m57_IMPAgome', 'M', at(12), 94, 6], ['m53_Interincisal', 'M', at(12), 124, 7], ['m60_OPSN', 'M', at(12), 20, 4], ['m28_LAFH', 'M', at(12), 65, 5],
    ],
  },
  'moate2002-cooke1989': {
    via: 'Moate & Darendeliler 2002, Table II', year: 1989,
    rows: [
      ['m01_SNA', 'M', at(11), 84, 4], ['m02_SNB', 'M', at(11), 80, 4], ['m03_ANB', 'M', at(11), 4, 1], ['m57_IMPAgome', 'M', at(11), 101, 7],
      ['m53_Interincisal', 'M', at(11), 115, 11], ['m36_Gonial', 'M', at(11), 121, 6], ['m35_Articular', 'M', at(11), 151, 6],
      ['m63_U1APog', 'M', at(11), 5, 2], ['m30_FacAxisR', 'M', at(11), 84, 6], ['m24_YAxis', 'M', at(11), 66, 6],
    ],
  },
  'moate2002-yen1973': {
    via: 'Moate & Darendeliler 2002, Table II', year: 1973,
    rows: [['m53_Interincisal', 'M', at(11), 119, 8], ['m36_Gonial', 'M', at(11), 124, 9]],
  },
  'moate2002-wei1968': {
    via: 'Moate & Darendeliler 2002, Table IV', year: 1968,
    rows: [
      ['m01_SNA', 'M', AD, 81, 4], ['m02_SNB', 'M', AD, 79, 5], ['m03_ANB', 'M', AD, 2, 2],
      ['m01_SNA', 'F', AD, 81, 4], ['m02_SNB', 'F', AD, 80, 5], ['m03_ANB', 'F', AD, 1, 2],
    ],
  },
  'moate2002-chan1972': {
    via: 'Moate & Darendeliler 2002, Table IV', year: 1972,
    rows: [
      ['m01_SNA', 'M', AD, 84, 3], ['m02_SNB', 'M', AD, 80, 4], ['m03_ANB', 'M', AD, 4, 2], ['m21_SNGoMe', 'M', AD, 33, 4],
      ['m57_IMPAgome', 'M', AD, 98, 8], ['m53_Interincisal', 'M', AD, 122, 8], ['m54_U1SN', 'M', AD, 107, 9], ['m60_OPSN', 'M', AD, 16, 4],
      ['m63_U1APog', 'M', AD, 10, 2], ['m30_FacAxisR', 'M', AD, 80, 4],
    ],
  },
  'moate2002-cheng1986': {
    via: 'Moate & Darendeliler 2002, Table IV', year: 1986,
    rows: [
      ['m21_SNGoMe', 'M', AD, 29, 4], ['m57_IMPAgome', 'M', AD, 96, 7], ['m53_Interincisal', 'M', AD, 124, 10], ['m60_OPSN', 'M', AD, 13, 4],
      ['m63_U1APog', 'M', AD, 8, 4], ['m30_FacAxisR', 'M', AD, 85, 4],
      ['m21_SNGoMe', 'F', AD, 31, 4], ['m57_IMPAgome', 'F', AD, 95, 7], ['m53_Interincisal', 'F', AD, 123, 10], ['m60_OPSN', 'F', AD, 13, 4],
      ['m63_U1APog', 'F', AD, 8, 4], ['m30_FacAxisR', 'F', AD, 84, 4],
    ],
  },
  'moate2002-lew1992': {
    via: 'Moate & Darendeliler 2002, Tables IV and VI', year: 1992,
    rows: [
      ['m73_STFacial', 'pooled', AD, 92.5, 6.5], ['m74_NoseProm', 'pooled', AD, 6, 2], ['m75_SupSulcus', 'pooled', AD, 9, 1.5],
      ['m07_ANPog', 'pooled', AD, 1.5, 1.5], ['m77_BasicUL', 'pooled', AD, 15, 1.5], ['m79_ULStrain', 'pooled', AD, 1.5, 1.5],
      ['m80_HAngle', 'pooled', AD, 16, 1.5], ['m81_LLH', 'pooled', AD, 0.5, 1], ['m82_InfSulcusH', 'pooled', AD, 4, 1.5],
      ['m83_ChinThick', 'pooled', AD, 9, 1], ['m86_Nasolabial', 'M', AD, 95, null], ['m86_Nasolabial', 'F', AD, 95, null],
    ],
  },
  'moate2002-so1990': {
    via: 'Moate & Darendeliler 2002, Table V', year: 1990,
    rows: [['m13_Wits', 'M', [10, 15], -4.9, null], ['m13_Wits', 'F', [10, 15], -4.5, null]],
  },
};
const MOATE_IDS = Object.keys(MOATE);

describe('population sets (Task 9a-2): the Chinese studies compiled by Moate & Darendeliler 2002', () => {
  const setById = (id: string) => sets.find((s) => s.id === id);
  const rowKey = (r: MoateRow) => JSON.stringify(r);

  it('the table names the 11 studies of the compilation\'s Tables I–VI', () => {
    expect(MOATE_IDS).toHaveLength(11);
  });

  it.each(MOATE_IDS)('%s: Chinese population set, verified, compared 2026-10-08, second-hand via the table(s) it comes from, film scale not stated', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    expect([s.kind, s.status, s.curation.comparedOn, s.population.id, s.scale, s.secondHand?.via, s.citation.year]).toEqual(
      ['population', 'verified', '2026-10-08', 'chinese', { kind: 'not-stated' }, MOATE[id]!.via, MOATE[id]!.year],
    );
    expect(s.curation.extractedBy).toHaveLength(2);
    expect(s.entries.filter((e) => e.centre !== undefined || e.sdSource !== undefined).map((e) => e.measurement)).toEqual([]);
  });

  it.each(MOATE_IDS)('%s: every entry exactly as printed (measurement, sex, age band, mean, SD) — none missing, none extra', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    const got = s.entries.map((e): MoateRow => [e.measurement, e.sex, e.ageBand ?? [-1, -1], e.mean ?? NaN, e.sd ?? null]);
    const want = MOATE[id]!.rows;
    expect(got.map(rowKey).filter((k) => !want.map(rowKey).includes(k)), 'extra or wrong').toEqual([]);
    expect(want.map(rowKey).filter((k) => !got.map(rowKey).includes(k)), 'missing').toEqual([]);
    expect(got).toHaveLength(want.length);
  });

  it.each(MOATE_IDS)('%s: resolves flagged second-hand, and the source line names the compilation', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    const e = s.entries[0]!;
    const r = resolvePop(e.measurement, 'chinese', e.sex === 'pooled' ? null : e.sex, e.ageBand![0], [s]);
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('second-hand'), r.sourceLine.includes('quoted second-hand via Moate & Darendeliler 2002')]).toEqual([id, true, true]);
  });

  it('definitions the compilation does not give are close, with the reason: mandibular plane (#21, #57), occlusal plane (#60), gonial points (#36), incisor point (#63), Y-axis (#24)', () => {
    const why: Record<string, RegExp> = {
      m21_SNGoMe: /mandibular plane not stated/, m57_IMPAgome: /mandibular plane not stated/, m60_OPSN: /occlusal plane not stated/,
      m36_Gonial: /points not stated/, m63_U1APog: /incisor point not stated/, m24_YAxis: /S–Gn to SN/,
    };
    const all = MOATE_IDS.flatMap((id) => setById(id)?.entries ?? []);
    const wrong = all
      .filter((e) => e.measurement in why)
      .filter((e) => e.definitionMatch !== 'close' || !why[e.measurement]!.test(e.definitionNote ?? ''))
      .map((e) => e.measurement);
    expect(wrong).toEqual([]);
    expect(all.filter((e) => e.measurement in why).length).toBeGreaterThan(0);
  });

  it('AGE-1: a Chinese girl of 7 — only Miao 1995 has a 7-year row, so her SNA is Miao\'s girls\' 80 ± 4, not flagged age-mismatched', () => {
    const r = resolvePop('m01_SNA', 'chinese', 'F', 7);
    expect(r.kind === 'norm' && [r.setId, r.entry.ageBand, r.mean, r.sd, r.flags.includes('age-mismatched'), r.flags.includes('second-hand')]).toEqual(
      ['moate2002-miao1995', [7, 7], 80, 4, false, true],
    );
  });

  it('AGE-1: a Chinese boy of 9 — Miao (9 y) and Fu (9 y) both cover him, both class-I balanced, so the larger sample (Miao 209 > Fu 144) gives SNA 81 ± 3', () => {
    const r = resolvePop('m01_SNA', 'chinese', 'M', 9);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd]).toEqual(['moate2002-miao1995', 81, 3]);
    // Positive control: without Miao, Fu's 9-year row (82 ± 3) is chosen, so the rule really chose.
    const noMiao = resolvePop('m01_SNA', 'chinese', 'M', 9, sets.filter((s) => s.id !== 'moate2002-miao1995'));
    expect(noMiao.kind === 'norm' && [noMiao.setId, noMiao.mean, noMiao.sd]).toEqual(['moate2002-fu1975', 82, 3]);
  });

  it('So 1990 Wits (Table V; text p. 22): −4.9 boys, −4.5 girls, 10–15 y, no SD, Jacobson\'s sign and the functional occlusal plane (close since NUS-OP-1, 16 Oct 2026: the app uses the standard plane), n 55 and 46', () => {
    const s = setById('moate2002-so1990')!;
    expect(s.entries.map((e) => [e.sex, e.ageBand, e.mean, e.sd, e.n, e.definitionMatch])).toEqual([
      ['M', [10, 15], -4.9, undefined, 55, 'close'], ['F', [10, 15], -4.5, undefined, 46, 'close'],
    ]);
    expect(s.caveats.some((c) => /18 Years \+/.test(c) && /10 to 15/.test(c))).toBe(true);
  });

  it('So 1990 Wits for a Chinese boy of 12: Zheng (10–17, class-I balanced) ranks first; without Zheng, So is chosen with no SD of its own and no real donor (uncoloured, said)', () => {
    const full = resolvePop('m13_Wits', 'chinese', 'M', 12);
    expect(full.kind === 'norm' && full.setId).toBe('zheng2026');
    const r = resolvePop('m13_Wits', 'chinese', 'M', 12, sets.filter((s) => s.id !== 'zheng2026'));
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.colour, r.flags.includes('second-hand')]).toEqual(['moate2002-so1990', -4.9, null, false, true]);
    expect(r.kind === 'norm' && r.sourceLine).toMatch(/no matching SD to borrow/);
  });

  it('So 1990 Wits borrows an SD when a matching Chinese donor exists (Task 4c): flagged sd-borrowed and second-hand, the donor named', () => {
    // SYNTHETIC donor: a Chinese boys' Wits row with its own SD, a smaller sample than So's (so So still ranks first).
    const donor: NormSet = {
      ...setById('moate2002-so1990')!, id: 'synthetic-chinese-wits-donor', secondHand: undefined, selection: 'unknown',
      sample: { n: 10 }, entries: [{ measurement: 'm13_Wits', sex: 'M', ageBand: [10, 15], mean: -3, sd: 2.5, unit: 'mm', source: 'SYNTHETIC', definitionMatch: 'same' }],
    };
    const pool = [...sets.filter((s) => s.id !== 'zheng2026'), donor];
    const r = resolvePop('m13_Wits', 'chinese', 'M', 12, pool);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.colour, r.sdDonor?.setId, r.flags.includes('sd-borrowed'), r.flags.includes('second-hand')]).toEqual(
      ['moate2002-so1990', -4.9, 2.5, true, 'synthetic-chinese-wits-donor', true, true],
    );
  });

  it('Lew 1992 (Singapore): Table VI pooled soft tissue with SDs, Table IV nasolabial 95° by sex with none; every entry close (method not in the compilation; upper lip strain close by owner LIP-3)', () => {
    const s = setById('moate2002-lew1992')!;
    const rest = s.entries.filter((e) => e.measurement !== 'm79_ULStrain');
    expect([s.population.region, s.selection]).toEqual(['Singapore', 'ideal-aesthetic']);
    expect(s.entries.filter((e) => e.definitionMatch !== 'close').map((e) => e.measurement)).toEqual([]);
    expect(rest.filter((e) => !/method not in the compilation/.test(e.definitionNote ?? '')).map((e) => e.measurement)).toEqual([]);
  });

  it('Lew 1992: Table IV/V "upper lip strain 14 mm" and "upper lip 15 mm" are not entered (caveats say why); Table VI\'s 15.0 ± 1.5 is basic upper lip thickness (#77), not length (#89) or vermilion thickness (#78)', () => {
    const s = setById('moate2002-lew1992')!;
    expect(s.entries.filter((e) => ['m89_ULLength', 'm78_ULThick'].includes(e.measurement))).toEqual([]);
    expect(s.entries.filter((e) => e.measurement === 'm79_ULStrain').map((e) => e.mean)).toEqual([1.5]);
    expect(s.caveats.some((c) => /strain/.test(c) && /14/.test(c) && /not entered/i.test(c))).toBe(true);
    expect(s.caveats.some((c) => /Upper lip 15/.test(c) && /length/.test(c) && /not entered/i.test(c))).toBe(true);
    expect(s.entries.find((e) => e.measurement === 'm77_BasicUL')!.definitionNote).toMatch(/Holdaway/);
  });

  it('the compilation\'s misprinted reference numbers (Yen¹¹, Chan¹⁴, Cheng¹³, Lew¹⁰) are named in a caveat of each affected set', () => {
    const misprint: Record<string, RegExp> = {
      'moate2002-yen1973': /Yen11/, 'moate2002-chan1972': /Chan14/, 'moate2002-cheng1986': /Cheng13/, 'moate2002-lew1992': /Lew10/,
    };
    for (const [id, re] of Object.entries(misprint)) expect([id, setById(id)?.caveats.some((c) => re.test(c) && /author name/.test(c))]).toEqual([id, true]);
  });

  it('owner LIP-3 (8 Oct, replaces LIP-1): Lew\'s upper lip strain is used — close, the note gives the ruling and the Table IV caution; a Chinese woman of 30\'s #79 resolves to it', () => {
    const e = setById('moate2002-lew1992')!.entries.find((x) => x.measurement === 'm79_ULStrain')!;
    expect([e.definitionMatch, e.mean, e.sd]).toEqual(['close', 1.5, 1.5]);
    expect(e.definitionNote).toBe("Owner ruling 8 Oct: used after the catalogue was flipped to Holdaway's direction (LIP-2). Caution: Moate also prints '14' for Lew's strain (Table IV) — the 1.5 ± 1.5 (Table VI) matches Holdaway's convention and Moate's Caucasian column.");
    const r = resolvePop('m79_ULStrain', 'chinese', 'F', 30);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.flags.includes('close')]).toEqual(['moate2002-lew1992', 1.5, 1.5, true]);
  });

  it('owner FAX-1 (8 Oct): every facial axis (#30) row (Fu, Cooke, Chan, Cheng) is different, with the ruling\'s note; none is chosen for a Chinese patient; the Y-axis rows stay close', () => {
    const NOTE = "Not used (owner ruling 8 Oct): 80–85° with no definition in the compilation; Ricketts' facial axis is 90 ± 3.5, and these values fit Downs' facial angle at least as well — likely a different measurement.";
    const rows = MOATE_IDS.flatMap((id) => (setById(id)?.entries ?? []).filter((e) => e.measurement === 'm30_FacAxisR').map((e) => [id, e.definitionMatch, e.definitionNote]));
    expect(rows).toHaveLength(9); // Fu 5, Cooke 1, Chan 1, Cheng 2 (the MOATE table above)
    expect(rows.filter(([, dm, note]) => dm !== 'different' || note !== NOTE)).toEqual([]);
    expect([...new Set(rows.map(([id]) => id))].sort()).toEqual(['moate2002-chan1972', 'moate2002-cheng1986', 'moate2002-cooke1989', 'moate2002-fu1975']);
    for (const [sex, age] of [['M', 11], ['F', 13], ['M', 30]] as const) {
      const r = resolvePop('m30_FacAxisR', 'chinese', sex, age);
      expect([sex, age, r.kind === 'norm' && r.setId.startsWith('moate2002-')]).toEqual([sex, age, false]);
    }
    const y = MOATE_IDS.flatMap((id) => (setById(id)?.entries ?? []).filter((e) => e.measurement === 'm24_YAxis'));
    expect(y.length).toBeGreaterThan(0);
    expect(y.filter((e) => e.definitionMatch !== 'close')).toEqual([]);
  });

  it('Fu\'s 11-year rows each carry the note that the column may not be a separate group', () => {
    const rows = setById('moate2002-fu1975')!.entries.filter((e) => e.ageBand?.[0] === 11);
    expect(rows.length).toBe(16);
    expect(rows.filter((e) => !(e.note ?? '').includes("Fu & Mao's text names groups at 9, 13.9 and 18.6 y; this 11-year column largely repeats the 13-year one — may not be a separate group")).map((e) => e.measurement)).toEqual([]);
    expect(setById('moate2002-fu1975')!.entries.filter((e) => e.ageBand?.[0] !== 11 && /11-year column/.test(e.note ?? ''))).toEqual([]);
  });

  // What adding the Moate sets changes for real Chinese queries (owner AGE-1 rule 5 compares whole-study
  // sample sizes: Miao 209 and Fu 144 against Zheng 120; all three class-I balanced). Raised with the owner.
  it.each([
    ['m01_SNA', 'M', 30, 'moate2002-miao1995', [18, 40], 85, 4, false, 'a man of 30: Miao and Zheng both cover him; Miao (n 209) before Zheng (n 120)'],
    ['m01_SNA', 'M', 13, 'moate2002-miao1995', [13, 13], 84, 2, false, 'a boy of 13: Miao, Fu, Lou, Zheng and Wu all cover him; Miao is the largest class-I balanced sample'],
    ['m02_SNB', 'F', 9, 'moate2002-miao1995', [9, 9], 77, 3, false, 'a girl of 9: Miao and Fu cover her (Zheng starts at 10); Miao (209) before Fu (144)'],
    ['m02_SNB', 'F', null, 'moate2002-miao1995', [18, 40], 81, 4, false, 'a woman of unknown age: rule 5 alone; Miao before Zheng, its adult row'],
    ['m01_SNA', 'M', 15, 'zheng2026', [10, 17], 82.7, 3.3, false, 'a boy of 15: no Moate study has a 15-year row, so Zheng (10–17) still'],
    ['m01_SNA', 'M', 45, 'zheng2026', [18, 41], 83, 3.7, true, 'a man of 45: no set covers him; owner AGE-2 the nearest age, Zheng (18–41, 4 y away) before the Moate adults (18–40, 5 y away), flagged'],
  ] as const)('the Moate sets change real Chinese queries: %s %s age %s → %s %j, %s ± %s (age-mismatched %s): %s', (id, sex, age, setId, band, mean, sd, flagged, _why) => {
    const r = resolvePop(id, 'chinese', sex, age);
    expect(r.kind === 'norm' && [r.setId, r.entry.ageBand, r.mean, r.sd, r.flags.includes('age-mismatched')]).toEqual([setId, band, mean, sd, flagged]);
  });

  it('ages follow the table headers, the text quoted in a caveat where it differs: Miao 13 (text 12.5), Cooke 11 (text 12), Fu 11 (no such group in the text)', () => {
    expect(setById('moate2002-miao1995')?.caveats.some((c) => /12\.5/.test(c))).toBe(true);
    expect(setById('moate2002-cooke1989')?.caveats.some((c) => /aged 12 years/.test(c))).toBe(true);
    expect(setById('moate2002-fu1975')?.caveats.some((c) => /11-year/.test(c) && /13\.9/.test(c))).toBe(true);
    for (const id of MOATE_IDS) {
      for (const e of setById(id)?.entries ?? []) if (e.ageBand?.[0] === 18) expect([id, e.ageBand[1], /upper bound not stated/.test(e.note ?? '')]).toEqual([id, 40, true]);
    }
  });
});

// ---- Task 9b-1 part 1: AlBarakati 2012 (Saudi, Holdaway) and Alcalde 1998 / 2000 (Japanese).
// Typed twice; every value re-read from the page images (task-9b1-report.md). The tables below are a
// third reading of the pages: a mistyped, missing or extra row fails. Real (SYNTHETIC) ages throughout.
type Row9b = [string, 'M' | 'F' | 'pooled', number, number, 'same' | 'close' | 'different'];
const ALBARAKATI: Row9b[] = [
  // Table 1, p. 29 (pooled, n 61) and Table 2, p. 30 (women n 30, men n 31); 20–24 y.
  ...([
    ['m07_ANPog', [1.75, 2.3], [2.05, 2.14], [1.47, 2.45]], ['m73_STFacial', [89.66, 3.54], [90.44, 3.03], [88.9, 3.87]],
    ['m74_NoseProm', [13.46, 3.22], [12.54, 3.0], [14.36, 3.21]], ['m75_SupSulcus', [2.92, 1.37], [2.43, 1.02], [3.39, 1.51]],
    ['m76_SnH', [5.03, 2.09], [4.51, 2.14], [5.53, 1.95]], ['m77_BasicUL', [15.69, 2.09], [14.57, 1.58], [16.76, 1.98]],
    ['m78_ULThick', [12.36, 2.17], [11.07, 1.65], [13.6, 1.89]], ['m80_HAngle', [15.16, 3.22], [15.03, 3.45], [15.28, 3.04]],
    ['m81_LLH', [0.86, 1.55], [0.73, 1.36], [0.98, 1.73]], ['m82_InfSulcusH', [4.22, 1.55], [4.03, 1.56], [4.4, 1.53]],
    ['m83_ChinThick', [11.33, 2.24], [10.78, 2.25], [11.86, 2.13]],
  ] as [string, [number, number], [number, number], [number, number]][]).flatMap(([id, p, f, m]): Row9b[] => [
    [id, 'pooled', p[0], p[1], 'same'], [id, 'F', f[0], f[1], 'same'], [id, 'M', m[0], m[1], 'same'],
  ]),
];
const ALCALDE1998: Row9b[] = [
  // Table 4, p. 133 (men n 98, women n 119); Table 3, p. 132 (pooled, n 217); 20–28 y.
  ...([
    ['m05_Convexity', [4.24, 5.36], [5.65, 6.1], 'same'], ['m08_ANperp', [-1.96, 4.76], [-1.98, 4.0], 'close'],
    ['m09_PogNperp', [-8.0, 8.62], [-9.16, 8.16], 'close'], ['m28_LAFH', [68.83, 4.99], [63.86, 4.98], 'close'],
    ['m23_FHGoMe', [25.21, 5.49], [27.08, 6.27], 'close'], ['m36_Gonial', [117.97, 6.05], [119.77, 7.27], 'close'],
    ['m61_CantOP', [8.77, 5.02], [10.85, 4.8], 'close'], ['m13_Wits', [0.4, 3.16], [1.3, 3.05], 'close'],
    ['m55_U1MxP', [116.35, 6.62], [114.7, 6.96], 'close'], ['m57_IMPAgome', [95.09, 6.67], [94.32, 6.99], 'close'],
  ] as [string, [number, number], [number, number], Row9b[4]][]).flatMap(([id, m, f, dm]): Row9b[] => [[id, 'M', m[0], m[1], dm], [id, 'F', f[0], f[1], dm]]),
  ['m86_Nasolabial', 'pooled', 102.34, 11.63, 'same'], ['m88_STConvexity', 'pooled', 169.91, 5.75, 'same'],
];
const ALCALDE2000: Row9b[] = [
  // Table II, p. 87, the Japanese normal group (n 211, pooled), 20–28 y.
  ['m72_LLE', 'pooled', 0.13, 2.51, 'same'], ['m73_STFacial', 'pooled', 90.16, 3.22, 'same'], ['m74_NoseProm', 'pooled', 14.54, 1.94, 'same'],
  ['m75_SupSulcus', 'pooled', 4.46, 2.25, 'same'], ['m76_SnH', 'pooled', 9.06, 2.86, 'same'], ['m07_ANPog', 'pooled', 2.42, 3.22, 'same'],
  ['m77_BasicUL', 'pooled', 15.11, 2.48, 'close'], ['m79_ULStrain', 'pooled', 2.57, 2.73, 'same'], ['m80_HAngle', 'pooled', 15.51, 4.28, 'same'],
  ['m81_LLH', 'pooled', 1.62, 1.75, 'same'], ['m82_InfSulcusH', 'pooled', 3.78, 2.03, 'same'], ['m83_ChinThick', 'pooled', 13.58, 2.31, 'same'],
  ['m89_ULLength', 'pooled', 23.4, 2.58, 'close'],
];
const T9B1: Record<string, { population: string; scale: NormSet['scale']; band: [number, number]; selection: NormSet['selection']; rows: Row9b[] }> = {
  albarakati2012: { population: 'saudi', scale: { kind: 'true-size', source: 'p. 28: calibrated in Dolphin' }, band: [20, 24], selection: 'class-I-balanced', rows: ALBARAKATI },
  alcalde1998: { population: 'japanese', scale: { kind: 'not-stated' }, band: [20, 28], selection: 'class-I', rows: ALCALDE1998 },
  alcalde2000: { population: 'japanese', scale: { kind: 'not-stated' }, band: [20, 28], selection: 'class-I', rows: ALCALDE2000 },
};

describe('population sets (Task 9b-1 part 1): AlBarakati 2012 (Saudi), Alcalde 1998 and 2000 (Japanese)', () => {
  const setById = (id: string) => sets.find((s) => s.id === id);
  const key = (r: Row9b) => JSON.stringify(r);

  it.each(Object.keys(T9B1))('%s: population set, verified, compared 2026-10-08, two extractors, its population, film scale and selection', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    const want = T9B1[id]!;
    expect([s.kind, s.status, s.curation.comparedOn, s.curation.extractedBy.length, s.population.id, s.scale, s.selection]).toEqual(
      ['population', 'verified', '2026-10-08', 2, want.population, want.scale, want.selection],
    );
    expect(s.entries.filter((e) => e.centre !== undefined || e.sdSource !== undefined || e.range !== undefined).map((e) => e.measurement)).toEqual([]);
    expect(s.entries.filter((e) => JSON.stringify(e.ageBand) !== JSON.stringify(want.band)).map((e) => e.measurement)).toEqual([]);
  });

  it.each(Object.keys(T9B1))('%s: every entry exactly as printed (measurement, sex, mean, SD, definition match) — none missing, none extra', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    const got = s.entries.map((e): Row9b => [e.measurement, e.sex, e.mean ?? NaN, e.sd ?? NaN, e.definitionMatch]);
    const want = T9B1[id]!.rows;
    expect(got.map(key).filter((k) => !want.map(key).includes(k)), 'extra or wrong').toEqual([]);
    expect(want.map(key).filter((k) => !got.map(key).includes(k)), 'missing').toEqual([]);
    expect(got).toHaveLength(want.length);
  });

  // One SYNTHETIC-age query per new population.
  it('saudi: a Saudi woman of 22 gets AlBarakati\'s women\'s H-angle 15.03 ± 3.45, same (a Holdaway measurement), not an ideal, coloured', () => {
    const r = resolvePop('m80_HAngle', 'saudi', 'F', 22);
    expect(r.kind === 'norm' && [r.setId, r.entry.sex, r.entry.ageBand, r.mean, r.sd, r.entry.definitionMatch, r.colour]).toEqual(
      ['albarakati2012', 'F', [20, 24], 15.03, 3.45, 'same', true],
    );
    expect(r.kind === 'norm' && [r.flags.includes('ideal'), r.flags.includes('close'), r.flags.includes('age-mismatched')]).toEqual([false, false, false]);
  });

  it('saudi: AlBarakati is true size (P27, Dolphin calibration) — an mm norm is neither converted nor flagged scale-assumed', () => {
    const r = resolvePop('m83_ChinThick', 'saudi', 'M', 23);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.printed, r.flags.includes('converted-to-true-size'), r.flags.includes('scale-assumed')]).toEqual(
      ['albarakati2012', 11.86, 2.13, null, false, false],
    );
  });

  it('saudi, Holdaway analysis: a Saudi patient\'s Holdaway norm is the Saudi sample, not Holdaway\'s own ideal', () => {
    const r = resolveNorm({ measurement: 'm76_SnH', analysisId: 'holdaway', population: 'saudi', clinicDefault: null, sex: 'M', ageYears: 21, sets, userNorms: [] });
    expect(r.kind === 'norm' && [r.setId, r.mean, (r.flags as string[]).includes('own-norm-fallback')]).toEqual(['albarakati2012', 5.53, false]);
  });

  it('saudi: a boy of 12 still gets the 20–24 y row, flagged age-mismatched (no other Saudi set yet)', () => {
    const r = resolvePop('m81_LLH', 'saudi', 'M', 12);
    expect(r.kind === 'norm' && [r.setId, r.entry.ageBand, r.flags.includes('age-mismatched')]).toEqual(['albarakati2012', [20, 24], true]);
  });

  it('AlBarakati: SS depth pooled SD 1.37 (Tables 1, 3), Table 2\'s 1.367 in the note; min/max columns a caveat; #79 not entered', () => {
    const s = setById('albarakati2012')!;
    expect(s.entries.find((e) => e.measurement === 'm75_SupSulcus' && e.sex === 'pooled')!.note).toMatch(/1\.367/);
    expect(s.caveats.some((c) => /minimum and maximum/.test(c) && /not entered/.test(c))).toBe(true);
    expect(s.entries.filter((e) => e.measurement === 'm79_ULStrain')).toEqual([]);
    expect([s.modality, s.headPosition]).toEqual(['film', 'unknown']);
  });

  it('japanese: a Japanese woman of 25 gets Alcalde 1998\'s women\'s Wits 1.30 ± 3.05, close (occlusal plane not stated), film scale not stated', () => {
    const r = resolvePop('m13_Wits', 'japanese', 'F', 25);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.flags.includes('close'), r.flags.includes('scale-assumed')]).toEqual(['alcalde1998', 1.3, 3.05, true, true]);
    expect(r.kind === 'norm' && r.entry.definitionNote).toMatch(/occlusal plane not stated/);
  });

  it('Alcalde 1998: women\'s ANS-Gn is Table 4\'s 63.86 (Table 2 prints 63.20, in the note); #88 stored as 180 − 10.09, the note says so', () => {
    const s = setById('alcalde1998')!;
    expect(s.entries.find((e) => e.measurement === 'm28_LAFH' && e.sex === 'F')!.note).toMatch(/63\.20.*63\.86/);
    const cx = s.entries.find((e) => e.measurement === 'm88_STConvexity')!;
    expect(cx.definitionNote).toMatch(/180 − 10\.09 = 169\.91/);
    expect(cx.definitionNote).toMatch(/conversion is ours/);
  });

  it('Alcalde 2000: lower lip to E-line +0.13 (printed −0.13 with + behind; the text says the Japanese lip is more prominent), the note says so', () => {
    const r = resolvePop('m72_LLE', 'japanese', 'M', 22);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd]).toEqual(['alcalde2000', 0.13, 2.51]);
    expect(r.kind === 'norm' && r.entry.note).toMatch(/prints −0\.13.*MORE prominent/);
  });

  // Owner LIP-4 (12 Oct; final review I-3): Holdaway's printed "upper lip thickness" row is the basic
  // thickness #77 everywhere. Alcalde's own Whites column: 15.0 for this row, 1.5 for strain (= basic −
  // vermilion, 15 − 13.5), so the row is the basic thickness. Was #78 (same) until 12 Oct.
  it('Alcalde 2000 (owner LIP-4): the one "upper lip thickness" row is #77 (basic thickness), close, with the reason; no #78; upper lip length close (Sn–UL St)', () => {
    const s = setById('alcalde2000')!;
    expect(s.entries.filter((e) => e.measurement === 'm78_ULThick')).toEqual([]);
    const e = s.entries.find((x) => x.measurement === 'm77_BasicUL')!;
    expect([e.mean, e.sd, e.definitionMatch, e.source]).toEqual([15.11, 2.48, 'close', 'Table II, p. 87']);
    expect(e.note).toMatch(/LIP-4/);
    expect(e.note).toMatch(/15\.0 − 13\.5 = 1\.5/);
    const r = resolvePop('m77_BasicUL', 'japanese', 'F', 24);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.flags.includes('close')]).toEqual(['alcalde2000', 15.11, 2.48, true]);
    expect(s.entries.find((e) => e.measurement === 'm89_ULLength')!.definitionNote).toMatch(/Sn-UL St/);
  });

  it('Alcalde 2000 #79 (owner LIP-2): as printed (2.57), same now that the catalogue computes Holdaway\'s direction (#77 − #78); a Japanese woman of 24 gets it; the note records the flip', () => {
    const e = setById('alcalde2000')!.entries.find((x) => x.measurement === 'm79_ULStrain')!;
    expect([e.mean, e.definitionMatch]).toEqual([2.57, 'same']);
    expect(e.definitionNote).toMatch(/LIP-2/);
    expect(e.definitionNote).toMatch(/#77 minus #78/);
    const r = resolvePop('m79_ULStrain', 'japanese', 'F', 24);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.colour]).toEqual(['alcalde2000', 2.57, 2.73, true]);
  });

  it('ruling P49: Alcalde 1998 #88 is same (an exact 180 − x conversion on the catalogue\'s own points is not a definition difference); the conversion note stays', () => {
    const cx = setById('alcalde1998')!.entries.find((e) => e.measurement === 'm88_STConvexity')!;
    expect(cx.definitionMatch).toBe('same');
    expect(cx.definitionNote).toMatch(/P49/);
  });

  it('Alcalde 2000: the supernormal group (Tables III–IV) is not entered (P19), said in a caveat; age unknown → the 20–28 adult row, unflagged', () => {
    const s = setById('alcalde2000')!;
    expect(s.caveats.some((c) => /supernormal/.test(c) && /Not entered/.test(c))).toBe(true);
    expect(s.entries.some((e) => e.mean === 1.09 || e.mean === 14.86)).toBe(false); // supernormal E-line and lip thickness
    const r = resolvePop('m80_HAngle', 'japanese', null, null);
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('age-mismatched')]).toEqual(['alcalde2000', false]);
  });
});

// ---- Task 9b-1 parts 2-5: Thilander, Persson & Adolfsson 2005 (Swedish, 5-31 y, by sex). Tables 5-8,
// pp. 375-378. Every value checked against the page images (task-9b1-report.md). Per measurement:
// [definitionMatch, men's [mean, SD] at 5, 7, 10, 13, 16, 19, 31 y, women's likewise]. Convexity (#5)
// is stored as 180 − the printed full angle. Committed in parts (size): THIL_IN_GIT names the
// measurements in git so far.
type ThilRow = ['same' | 'close' | 'different', [number, number][], [number, number][]];
const THIL: Record<string, ThilRow> = {
  m34_Saddle: ['same', [[121.9, 4.4], [122.3, 5], [122.2, 4.5], [121.9, 4.6], [121.9, 4.6], [122.3, 3.8], [120.7, 4.5]], [[123.9, 5], [123.8, 5], [123.5, 4.1], [123.2, 4.1], [123.2, 4.8], [122.4, 4.6], [122.3, 3.5]]],
  m01_SNA: ['same', [[81.8, 3], [81.3, 3.2], [81.2, 3.2], [82.3, 3.4], [82.7, 3.7], [82.5, 3.9], [82.2, 3.3]], [[82.6, 2.7], [81.8, 3], [82.6, 2.7], [83.4, 3], [83.5, 4.1], [83.1, 2.8], [83.2, 3]]],
  m02_SNB: ['same', [[77.2, 3], [77.7, 3.1], [78.5, 3.1], [79.7, 3], [80.6, 2.9], [80.8, 3.7], [80.9, 2.8]], [[77.5, 2.6], [77.8, 2.6], [79, 2.6], [80.5, 2.8], [81.5, 3.5], [81.3, 2.9], [81.5, 2.3]]],
  m03_ANB: ['same', [[4.6, 1.2], [3.6, 1.8], [2.8, 1.8], [2.6, 1.8], [2, 2.6], [1.7, 2.7], [1.3, 2.9]], [[5.1, 1.7], [4, 2.3], [3.6, 1.8], [2.9, 1.7], [2, 1.7], [1.9, 1.2], [1.7, 2.1]]],
  m05_Convexity: ['same', [[9.8, 3.4], [6.5, 4.5], [3.7, 4.7], [2.8, 4.3], [1.2, 5.9], [0.8, 4.5], [-1.2, 7.7]], [[11.3, 4.3], [6.4, 5.6], [5.9, 4.7], [3.8, 4.4], [1.4, 4.4], [0.5, 4.5], [-1.4, 5.1]]],
  m26_SNMxP: ['close', [[6.9, 2.6], [6.3, 3.3], [6.7, 2.8], [6.3, 2.7], [6.8, 2.5], [6.6, 2.6], [6.4, 2.5]], [[7.3, 2.5], [7.5, 2.9], [7.7, 2.8], [6.8, 3.2], [5.9, 2.7], [6, 2.6], [5.3, 2.7]]],
  m90_SNMP_ABO: ['close', [[35.2, 4.1], [33.5, 5.3], [32.2, 5.3], [30.7, 4.3], [28.6, 3.9], [28.8, 4.6], [27.8, 5.1]], [[34.2, 4], [32.8, 4.2], [31.7, 4.2], [29.9, 4.3], [28.2, 5.4], [28.3, 4.3], [26.4, 4.8]]],
  m25_MMPA: ['close', [[28.3, 3.3], [27.3, 4.9], [25.5, 4.9], [24.4, 4.5], [21.9, 4.5], [22.2, 5.7], [21.3, 5.9]], [[26.8, 4], [25.2, 4.6], [24, 4.2], [23.1, 4.4], [22.3, 5.1], [21.3, 4.2], [21.1, 4.9]]],
  m36_Gonial: ['close', [[132.1, 2.9], [128.4, 4.6], [126.6, 4.6], [125.1, 4.2], [121.4, 4.9], [121, 3.8], [120.2, 5.9]], [[132.3, 4.9], [127.4, 5.7], [125.4, 5.4], [124.5, 5.1], [121.6, 6.3], [120.8, 3.1], [117.3, 5.6]]],
  m35_Articular: ['close', [[141.1, 4.8], [142.7, 5.8], [143.5, 5.8], [143.7, 6.1], [144.9, 5.9], [145.5, 6.5], [146.8, 6.5]], [[138, 6.7], [141.6, 6.5], [142.8, 5.8], [142.2, 5.1], [143.5, 5], [145.5, 6.4], [146.8, 5.1]]],
  m40_SGo: ['close', [[61.3, 3.5], [67.5, 4.6], [73.5, 4.9], [79.4, 4.5], [88.7, 4.4], [92.2, 4.9], [93.5, 4.2]], [[59.2, 3.6], [65.1, 4.1], [70.8, 4.7], [75.8, 4.4], [81.2, 3.8], [82.8, 3.5], [84.6, 4.3]]],
  m41_NMe: ['close', [[96.8, 4.9], [103.7, 4.9], [110.6, 5.1], [116.4, 5.6], [126.5, 5.8], [131, 5.1], [132.5, 4.6]], [[92, 2.6], [99.5, 4], [106.5, 4.6], [110.8, 4.9], [116.5, 5.1], [118, 4.9], [118.3, 6]]],
  m28_LAFH: ['close', [[54.1, 3], [57.4, 2.9], [60.4, 2.6], [63, 4], [68.3, 4.9], [72.6, 3.7], [73.4, 4.5]], [[50.5, 2.3], [54, 2.9], [57.1, 3.4], [59.8, 3.9], [64, 4.5], [64.9, 3.2], [65.9, 4.8]]],
  m29_LAFHpct: ['close', [[55.9, 2.3], [55.3, 1.8], [54.6, 2.1], [54.1, 1.9], [54, 2.3], [55.2, 1.9], [54.8, 2.1]], [[54.9, 2.3], [54.3, 1.8], [53.6, 2.1], [54, 1.9], [54.9, 2.3], [55.2, 1.9], [55.7, 2.1]]],
  m55_U1MxP: ['close', [[99.6, 5.4], [106.2, 6], [110.4, 5.3], [110.7, 5.4], [111.5, 4.7], [107.2, 7.9], [109.1, 8.4]], [[102, 4.7], [108.2, 5.1], [110.9, 4.8], [110.6, 5], [109.4, 4.4], [110, 4.7], [107.9, 5.3]]],
  m56_IMPAt: ['same', [[86, 5.8], [90.1, 6.7], [91.3, 6.8], [94.5, 6.2], [95.6, 7.1], [92.2, 6.1], [91.6, 7]], [[88.9, 4.6], [93.5, 4.1], [96, 4.4], [95.1, 5.1], [93.4, 5.3], [90.9, 6.7], [96.3, 5.1]]],
  m53_Interincisal: ['same', [[146.1, 8.4], [137.1, 9.1], [130.7, 8.3], [130.4, 8.4], [131, 8.3], [134.5, 8.7], [137.9, 8.9]], [[142.3, 6.6], [133.3, 7.5], [129.2, 6.8], [131.2, 7.6], [134.8, 7.5], [132.9, 7.7], [134.6, 6.1]]],
  m47_U1NAdeg: ['same', [[10.9, 6.2], [18.6, 6.1], [22.5, 5.1], [22.1, 5.9], [22, 5.2], [19.7, 6.8], [20.5, 8.2]], [[12, 5.1], [18.8, 5.7], [20.6, 5.4], [20.4, 4.9], [20.1, 4.8], [19.9, 6], [18.5, 4.3]]],
  m50_L1NBdeg: ['same', [[18.4, 5.8], [21.2, 5.8], [24, 5.8], [24.9, 6.1], [24.9, 7], [23.1, 5.1], [20.3, 8]], [[20.5, 3.9], [24.1, 4.3], [26.6, 4.1], [25.5, 4.8], [23.1, 5.4], [22.9, 5], [24.2, 4.9]]],
  m46_U1NAmm: ['close', [[-0.2, 1.6], [1.3, 2.3], [3.9, 2], [4.1, 2], [4, 2.2], [4.1, 2.8], [3.7, 2.7]], [[0.2, 1.5], [1.6, 2.1], [3.1, 2], [4.6, 1.7], [4, 1.8], [3.2, 2], [3.4, 1.7]]],
  m49_L1NBmm: ['close', [[2.3, 1.3], [2.8, 1.6], [4.2, 1.6], [4.4, 2.4], [4.4, 2.8], [5.1, 2.1], [3.1, 2.7]], [[2.8, 1.8], [3.5, 1.6], [4.7, 1.5], [4.5, 1.8], [4.1, 1.9], [3.7, 1.8], [4.5, 2]]],
  m83_ChinThick: ['close', [[10.1, 1.4], [10.4, 1.7], [10.8, 1.8], [11.2, 1.2], [11.5, 2.2], [11.6, 1.6], [12.3, 1.7]], [[9.8, 1.6], [9.7, 1.6], [10.5, 1.7], [11.3, 1.5], [11.7, 1.3], [12.2, 2], [12.3, 1.7]]],
};
const THIL_BANDS: [number, number][] = [[4, 5], [6, 8], [9, 11], [12, 13], [14, 17], [18, 20], [29, 32]];
const THIL_N = { M: [20, 37, 43, 53, 25, 16, 11], F: [27, 46, 56, 69, 30, 17, 19] };
const THIL_IN_GIT = [
  'm34_Saddle', 'm01_SNA', 'm02_SNB', 'm03_ANB', 'm05_Convexity', 'm41_NMe', // part 2
  'm26_SNMxP', 'm90_SNMP_ABO', 'm25_MMPA', 'm36_Gonial', 'm35_Articular', 'm40_SGo', // part 3
  'm28_LAFH', 'm29_LAFHpct', 'm55_U1MxP', 'm56_IMPAt', 'm53_Interincisal', // part 4
  'm47_U1NAdeg', 'm50_L1NBdeg', 'm46_U1NAmm', 'm49_L1NBmm', 'm83_ChinThick', // part 5
];

describe('population sets (Task 9b-1 parts 2-5): Thilander 2005 (Swedish)', () => {
  const thil = () => sets.find((s) => s.id === 'thilander2005');

  it('the table holds the 22 catalogue measurements Thilander tables (Tables 5-8)', () => {
    expect(Object.keys(THIL)).toHaveLength(22);
  });

  it('thilander2005: Swedish population set, verified, compared 2026-10-08, two extractors, 10% enlargement (p. 372), class-I balanced (straight profile)', () => {
    const s = thil();
    expect(s).toBeDefined();
    if (!s) return;
    expect([s.kind, s.status, s.curation.comparedOn, s.curation.extractedBy.length, s.population.id, s.scale, s.selection]).toEqual(
      ['population', 'verified', '2026-10-08', 2, 'swedish', { kind: 'enlarged', percent: 10, source: 'p. 372' }, 'class-I-balanced'],
    );
    expect(s.entries.filter((e) => e.centre !== undefined || e.sdSource !== undefined || e.range !== undefined)).toEqual([]);
    expect(s.caveats.some((c) => /radiographs, not people/.test(c))).toBe(true);
  });

  it('thilander2005 holds exactly the measurements committed so far', () => {
    expect([...new Set((thil()?.entries ?? []).map((e) => e.measurement))].sort()).toEqual([...THIL_IN_GIT].sort());
  });

  it('every Thilander entry exactly as printed: 14 rows per measurement (7 ages × 2 sexes), its band, n (Table 3), mean, SD and definition match — none extra', () => {
    const s = thil();
    expect(s).toBeDefined();
    if (!s) return;
    const want = (id: string) =>
      (['M', 'F'] as const).flatMap((sex) => THIL[id]![sex === 'M' ? 1 : 2].map(([mean, sd], i) => JSON.stringify([id, sex, THIL_BANDS[i], THIL_N[sex][i], mean, sd, THIL[id]![0]])));
    const got = s.entries.map((e) => JSON.stringify([e.measurement, e.sex, e.ageBand, e.n, e.mean, e.sd, e.definitionMatch]));
    const wanted = [...new Set(s.entries.map((e) => e.measurement))].flatMap((id) => (THIL[id] ? want(id) : [`${id}: not in the table`]));
    expect(got.filter((k) => !wanted.includes(k)), 'extra or wrong').toEqual([]);
    expect(wanted.filter((k) => !got.includes(k)), 'missing').toEqual([]);
  });

  it('swedish: a Swedish boy of 10 gets Thilander\'s boys\' 9–11 y SNA (the 10-year group, observed 9.5–11.2 y), 81.2 ± 3.2, unflagged', () => {
    const r = resolvePop('m01_SNA', 'swedish', 'M', 10);
    expect(r.kind === 'norm' && [r.setId, r.entry.ageBand, r.mean, r.sd, r.entry.n, r.flags.includes('age-mismatched')]).toEqual(['thilander2005', [9, 11], 81.2, 3.2, 43, false]);
  });

  it('Thilander mm values are converted to true size (÷ 1.10) with the disclosure: a Swedish man of 19\'s N–Me, printed 131.0 ± 5.1', () => {
    const r = resolvePop('m41_NMe', 'swedish', 'M', 19);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.printed?.mean, r.printed?.sd, r.flags.includes('converted-to-true-size'), r.flags.includes('close')]).toEqual(['thilander2005', 131, 5.1, true, true]);
    expect(r.mean).toBeCloseTo(131 / 1.1, 10);
    expect(r.sd).toBeCloseTo(5.1 / 1.1, 10);
    expect(r.sourceLine).toContain('converted from 10% film enlargement (p. 372); printed 131 mm');
    const deg = resolvePop('m02_SNB', 'swedish', 'M', 19);
    expect(deg.kind === 'norm' && [deg.mean, deg.printed, deg.flags.includes('converted-to-true-size')]).toEqual([80.8, null, false]);
  });

  it('Thilander convexity: stored as 180 − the printed full angle (men 5 y: 170.2 → 9.8), SD unchanged, same, the note says so', () => {
    const e = thil()?.entries.find((x) => x.measurement === 'm05_Convexity' && x.sex === 'M' && x.ageBand?.[0] === 4);
    expect(e && [e.mean, e.sd, e.definitionMatch]).toEqual([9.8, 3.4, 'same']);
    expect(e?.note).toMatch(/printed 170\.2\); stored as 180 − 170\.2 = 9\.8/);
  });

  it('Thilander Björk landmarks: constructed gonion (tgo) rows and the nasal line through pm are close, each with its reason; ML/NSL on #90', () => {
    const why: Record<string, RegExp> = {
      m35_Articular: /tgo is constructed/, m40_SGo: /tgo is constructed/, m36_Gonial: /constructed point tgo/,
      m26_SNMxP: /through sp and pm/, m25_MMPA: /through sp and pm/, m90_SNMP_ABO: /no SN-to-tangent id/,
    };
    const rows = (thil()?.entries ?? []).filter((e) => e.measurement in why);
    expect(rows).toHaveLength(Object.keys(why).length * 14);
    expect(rows.filter((e) => e.definitionMatch !== 'close' || !why[e.measurement]!.test(e.definitionNote ?? '')).map((e) => e.measurement)).toEqual([]);
    const r = resolvePop('m40_SGo', 'swedish', 'F', 31);
    expect(r.kind === 'norm' && [r.setId, r.printed?.mean, r.flags.includes('close'), r.flags.includes('converted-to-true-size')]).toEqual(['thilander2005', 84.6, true, true]);
  });

  it('Thilander: sp′–gn → #28 and sp′–gn/n–gn → #29 close (sp′ and gn); a % is never converted for film scale; LIL/ML is IMPA on the tangent (#56, same)', () => {
    for (const id of ['m28_LAFH', 'm29_LAFHpct']) {
      expect((thil()?.entries ?? []).filter((e) => e.measurement === id && !(e.definitionMatch === 'close' && /sp′/.test(e.definitionNote ?? ''))).length).toBe(0);
    }
    const pct = resolvePop('m29_LAFHpct', 'swedish', 'F', 16);
    expect(pct.kind === 'norm' && [pct.setId, pct.mean, pct.sd, pct.printed, pct.flags.includes('converted-to-true-size')]).toEqual(['thilander2005', 54.9, 2.3, null, false]);
    const impa = resolvePop('m56_IMPAt', 'swedish', 'M', 13);
    expect(impa.kind === 'norm' && [impa.setId, impa.mean, impa.sd, impa.entry.definitionMatch]).toEqual(['thilander2005', 94.5, 6.2, 'same']);
    expect(impa.kind === 'norm' && impa.entry.note).toMatch(/lower-border tangent/);
  });

  it('Thilander complete: all 22 measurements of the table, 308 rows (22 × 7 ages × 2 sexes)', () => {
    expect([...THIL_IN_GIT].sort()).toEqual(Object.keys(THIL).sort());
    expect(thil()?.entries).toHaveLength(308);
  });

  it('Thilander incisor mm (UIL/n–ss, LIL/n–sm): close (point and sign not stated), converted ÷ 1.10 — a Swedish girl of 13\'s U1–NA, printed 4.6 mm', () => {
    const r = resolvePop('m46_U1NAmm', 'swedish', 'F', 13);
    expect(r.kind === 'norm' && [r.setId, r.printed?.mean, r.entry.definitionMatch, r.flags.includes('converted-to-true-size')]).toEqual(['thilander2005', 4.6, 'close', true]);
    expect(r.kind === 'norm' && r.mean).toBeCloseTo(4.6 / 1.1, 10);
    expect(r.kind === 'norm' && r.entry.definitionNote).toMatch(/incisor point/);
  });

  it('ruling P50: Thilander SPg–npgL is #83 close (the same quantity, soft-tissue chin thickness, at another level and direction; the note says so): a Swedish man of 19 gets it, converted', () => {
    const rows = (thil()?.entries ?? []).filter((e) => e.measurement === 'm83_ChinThick');
    expect(rows).toHaveLength(14);
    expect(rows.filter((e) => e.definitionMatch !== 'close' || !/suprapogonion/.test(e.definitionNote ?? '') || !/P50/.test(e.definitionNote ?? ''))).toEqual([]);
    const r = resolvePop('m83_ChinThick', 'swedish', 'M', 19);
    expect(r.kind === 'norm' && [r.setId, r.printed?.mean, r.flags.includes('close'), r.flags.includes('converted-to-true-size')]).toEqual(['thilander2005', 11.6, true, true]);
    expect((thil()?.caveats ?? []).some((c) => /SPg–npgL/.test(c) && /never used/.test(c))).toBe(false);
  });

  it('Thilander sp′–gn/n–gn (%): the identical men\'s and women\'s SDs at all seven ages are as printed and said in a caveat (possibly a misprint)', () => {
    const sds = (sex: 'M' | 'F') => (thil()?.entries ?? []).filter((e) => e.measurement === 'm29_LAFHpct' && e.sex === sex).map((e) => e.sd);
    expect(sds('M')).toEqual(sds('F'));
    expect((thil()?.caveats ?? []).some((c) => /sp′–gn\/n–gn/.test(c) && /identical male and female SDs in all seven age groups/.test(c) && /possibly a misprint/.test(c))).toBe(true);
  });

  it('Thilander ages (completed years, P12): a girl of 6 y 9 m is in the 6–8 band (observed 6.6–8.2); 21 → 18–20 flagged; 25 → 29–32 flagged (AGE-2 within the set: 4 y vs 5 y); unknown → 18–20 unflagged', () => {
    const at = (age: number | null) => resolvePop('m02_SNB', 'swedish', 'F', age);
    const row = (r: ReturnType<typeof at>) => (r.kind === 'norm' ? [r.entry.ageBand, r.flags.includes('age-mismatched')] : null);
    expect([row(at(6.75)), row(at(21)), row(at(25)), row(at(null))]).toEqual([[[6, 8], false], [[18, 20], true], [[29, 32], true], [[18, 20], false]]);
    expect(thil()?.entries.find((e) => e.ageBand?.[0] === 6)?.note).toMatch(/observed ages 6\.6–8\.2 \(Table 4, p\. 373\), as completed years 6–8/);
  });
});

// ---- Batch 9b-2 preliminary (8 Oct): owner AGE-2 applies within a people's population only; the
// analyses' own norms keep their old order (rule 5). SYNTHETIC sets and a real (SYNTHETIC) age.
describe('owner AGE-2 exclusion: the analyses\' own norms are not ranked by the nearest age band', () => {
  const ownSet = (id: string, n: number, band: [number, number]): NormSet => ({
    ...sets.find((s) => s.id === 'steiner1953')!, id, analyses: ['synthetic-own-analysis'], sample: { n },
    entries: [{ measurement: 'm01_SNA', sex: 'pooled', ageBand: band, mean: band[0] === 5 ? 80 : 84, sd: 3, unit: 'deg', source: 'SYNTHETIC', definitionMatch: 'same' }],
  });
  // A: the larger sample, its band 7 y below the boy; B: a small sample, its band 1 y above him.
  // Neither covers 13; by sample size A wins, by nearest band B would.
  const pool = [ownSet('synthetic-own-far-large', 200, [5, 6]), ownSet('synthetic-own-near-small', 10, [14, 16])];
  it.each([['analysis-own'], [null]] as const)('population %s: a boy of 13 gets the larger sample (old order), flagged age-mismatched, not the nearer band', (population) => {
    const r = resolveNorm({ measurement: 'm01_SNA', analysisId: 'synthetic-own-analysis', population, clinicDefault: null, sex: 'M', ageYears: 13, sets: pool, userNorms: [] });
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('age-mismatched')]).toEqual(['synthetic-own-far-large', true]);
  });
  it('positive control: the same two sets as a people\'s population ARE ranked by the nearest band (B, 1 y away)', () => {
    const asPop = pool.map((s) => ({ ...s, kind: 'population' as const, population: { id: 'synthetic-pop', label: 'Synthetic', ethnicity: [] } }));
    const r = resolveNorm({ measurement: 'm01_SNA', analysisId: 'steiner', population: 'synthetic-pop', clinicDefault: null, sex: 'M', ageYears: 13, sets: asPop, userNorms: [] });
    expect(r.kind === 'norm' && r.setId).toBe('synthetic-own-near-small');
  });
});

// ---- Task 9b-2 part 1: Bailey & Taylor 1998 and Obamiyi 2019 (African-American), Caballero-Purizaga 2019
// (Latin American), Alshahrani 2018 (Saudi Björk–Jarabak), Jarabak's own norms via Alshahrani 2018, Cheong
// 2024 (Malay women). Typed twice; every value re-read from the page images (PDF sources) or the PMC full
// text (PubMed tool, P44). The tables below are a third reading: a mistyped, missing or extra row fails.
// [measurement, sex, ageBand (null = none), mean, SD (null = none printed), n (null = none), definition match]
type Row9b2 = [string, 'M' | 'F' | 'pooled', [number, number] | null, number, number | null, number | null, 'same' | 'close' | 'different'];
const BAILEY: Row9b2[] = [
  // Table VI, p. 222 (two decimals; Table V's rounded values in the notes, P25); interincisal Table V only, p. 221.
  ['m01_SNA', 'pooled', [8, 12], 86.08, null, null, 'same'], ['m02_SNB', 'pooled', [8, 12], 80.48, null, null, 'same'],
  ['m03_ANB', 'pooled', [8, 12], 5.6, null, null, 'same'], ['m20_SNGoGn', 'pooled', [8, 12], 31.84, null, null, 'same'],
  ['m47_U1NAdeg', 'pooled', [8, 12], 22.35, null, null, 'same'], ['m54_U1SN', 'pooled', [8, 12], 108.68, null, null, 'same'],
  ['m59_L1GoGn', 'pooled', [8, 12], 100.92, null, null, 'same'], ['m53_Interincisal', 'pooled', [8, 12], 118.2, null, null, 'same'],
  ['m69_Overbite', 'pooled', [8, 12], 2.51, null, null, 'close'],
];
const OBAMIYI: Row9b2[] = [
  // Table 1, p. 899: by age, sexes pooled. Table 3, p. 900: age × sex. ODI close (Go–Me), APDI same.
  ...([
    [[7, 7], 33, [68.1, 4.4], [76.4, 4.4]], [[8, 9], 32, [72.0, 5.5], [77.1, 3.9]], [[10, 11], 31, [71.1, 5.8], [79.2, 3.6]],
    [[12, 12], 17, [70.9, 5.9], [77.6, 3.8]], [[13, 13], 17, [69.4, 6.2], [79.9, 4.9]], [[14, 14], 30, [73.2, 6.4], [79.2, 4.1]],
  ] as [[number, number], number, [number, number], [number, number]][]).flatMap(([band, n, odi, apdi]): Row9b2[] => [
    ['m15_ODI', 'pooled', band, odi[0], odi[1], n, 'close'], ['m14_APDI', 'pooled', band, apdi[0], apdi[1], n, 'same'],
  ]),
  ...([
    ['F', [7, 7], 16, [67.4, 4.5], [76.1, 5.2]], ['F', [8, 9], 16, [71.3, 5.6], [77.4, 3.8]], ['F', [10, 11], 15, [71.0, 5.7], [80.5, 3.9]],
    ['F', [12, 14], 16, [71.7, 4.3], [80.7, 4.4]], ['M', [7, 7], 17, [68.6, 4.2], [76.6, 3.6]], ['M', [8, 9], 16, [72.7, 5.5], [76.8, 4.2]],
    ['M', [10, 11], 16, [71.3, 6.0], [78.1, 3.1]], ['M', [12, 12], 16, [70.9, 5.9], [77.6, 3.8]], ['M', [13, 13], 16, [69.4, 6.2], [79.9, 4.9]],
    ['M', [14, 14], 16, [74.8, 7.9], [77.6, 3.1]],
  ] as ['M' | 'F', [number, number], number, [number, number], [number, number]][]).flatMap(([sex, band, n, odi, apdi]): Row9b2[] => [
    ['m15_ODI', sex, band, odi[0], odi[1], n, 'close'], ['m14_APDI', sex, band, apdi[0], apdi[1], n, 'same'],
  ]),
];
const CABALLERO: Row9b2[] = [
  // Table 4, p. 51, the balanced group (n 50), sexes pooled.
  ['m15_ODI', 'pooled', [15, 40], 72.1, 4.84, 50, 'same'], ['m14_APDI', 'pooled', [15, 40], 83.18, 1.71, 50, 'same'],
];
const ALSHAHRANI: Row9b2[] = [
  // Table III (men) and Table IV (women), PMC6191777; n 50 each, 17–22 y. Constructed gonion → rows with Go close.
  ...([
    ['m34_Saddle', [125.65, 5.163], [125.842, 6.661], 'same'], ['m35_Articular', [139.806, 6.302], [139.328, 7.916], 'close'],
    ['m36_Gonial', [130.412, 6.413], [130.182, 4.134], 'close'], ['m39_SumAngles', [395.932, 4.604], [397.302, 4.504], 'close'],
    ['m40_SGo', [78.448, 7.09], [72.02, 6.192], 'close'], ['m41_NMe', [120.608, 6.009], [112.118, 6.099], 'same'],
    ['m42_Jarabak', [65.04, 3], [64.28, 3], 'close'],
  ] as [string, [number, number], [number, number], Row9b2[6]][]).flatMap(([id, m, f, dm]): Row9b2[] => [
    [id, 'M', [17, 22], m[0], m[1], 50, dm], [id, 'F', [17, 22], f[0], f[1], 50, dm],
  ]),
];
const JARABAK_OWN: Row9b2[] = [
  // The 'Jarabak norms' column of Tables III–IV (identical in both but the ratio: 63.51 / 63.5).
  ['m34_Saddle', 'pooled', null, 123, 6, null, 'same'], ['m35_Articular', 'pooled', null, 143, 5, null, 'close'],
  ['m36_Gonial', 'pooled', null, 130, 6, null, 'close'], ['m39_SumAngles', 'pooled', null, 396, 5, null, 'close'],
  ['m40_SGo', 'pooled', null, 77.5, 7.5, null, 'close'], ['m41_NMe', 'pooled', null, 112.5, 7.5, null, 'same'],
  ['m42_Jarabak', 'pooled', null, 63.5, 1.5, null, 'close'],
];
const CHEONG: Row9b2[] = [['m80_HAngle', 'F', [20, 40], 15.75, 4.16, 85, 'same']]; // Table 1, PMC11750322
const T9B2: Record<string, { kind: NormSet['kind']; population: string; scale: NormSet['scale']; selection: NormSet['selection']; rows: Row9b2[] }> = {
  baileytaylor1998: { kind: 'population', population: 'african-american', scale: { kind: 'not-stated' }, selection: 'class-I-balanced', rows: BAILEY },
  obamiyi2019: { kind: 'population', population: 'african-american', scale: { kind: 'not-stated' }, selection: 'class-I', rows: OBAMIYI },
  caballero2019: { kind: 'population', population: 'latin-american', scale: { kind: 'true-size', source: 'p. 48: radiographs 1:1 calibrated' }, selection: 'class-I-balanced', rows: CABALLERO },
  alshahrani2018: { kind: 'population', population: 'saudi', scale: { kind: 'true-size', source: 'Methods: calibrated with the Dolphin ruler' }, selection: 'class-I', rows: ALSHAHRANI },
  'jarabak-via-alshahrani2018': { kind: 'analysis-own', population: 'analysis-own', scale: { kind: 'not-stated' }, selection: 'unknown', rows: JARABAK_OWN },
  cheong2024: { kind: 'population', population: 'malay', scale: { kind: 'not-stated' }, selection: 'class-I', rows: CHEONG },
};

describe('Task 9b-2 part 1: Bailey & Taylor, Obamiyi, Caballero, Alshahrani, Jarabak via Alshahrani, Cheong', () => {
  const setById = (id: string) => sets.find((s) => s.id === id);
  const key = (r: Row9b2) => JSON.stringify(r);

  it.each(Object.keys(T9B2))('%s: verified, compared 2026-10-08, two extractors, its kind, population, film scale and selection', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    const want = T9B2[id]!;
    expect([s.kind, s.status, s.curation.comparedOn, s.curation.extractedBy.length, s.population.id, s.scale, s.selection]).toEqual(
      [want.kind, 'verified', '2026-10-08', 2, want.population, want.scale, want.selection],
    );
    expect(s.entries.filter((e) => e.centre !== undefined || e.sdSource !== undefined || e.range !== undefined).map((e) => e.measurement)).toEqual([]);
  });

  it.each(Object.keys(T9B2))('%s: every entry exactly as printed (measurement, sex, band, mean, SD, n, definition match) — none missing, none extra', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    const got = s.entries.map((e): Row9b2 => [e.measurement, e.sex, e.ageBand ?? null, e.mean ?? NaN, e.sd ?? null, e.n ?? null, e.definitionMatch]);
    const want = T9B2[id]!.rows;
    expect(got.map(key).filter((k) => !want.map(key).includes(k)), 'extra or wrong').toEqual([]);
    expect(want.map(key).filter((k) => !got.map(key).includes(k)), 'missing').toEqual([]);
    expect(got).toHaveLength(want.length);
  });

  it('african-american: an African-American girl of 8 y 6 m gets Obamiyi\'s girls\' 8–9 y ODI 71.3 ± 5.6, close, the line naming Go–Me', () => {
    const r = resolvePop('m15_ODI', 'african-american', 'F', 8.5);
    expect(r.kind === 'norm' && [r.setId, r.entry.sex, r.entry.ageBand, r.mean, r.sd, r.entry.n, r.flags.includes('close'), r.flags.includes('age-mismatched')]).toEqual(
      ['obamiyi2019', 'F', [8, 9], 71.3, 5.6, 16, true, false],
    );
    expect(r.kind === 'norm' && r.sourceLine).toMatch(/Go–Me/);
  });

  it('Obamiyi: APDI same (measured directly as A-B to palatal plane, the note says so); a boy of 13 gets the M13 row, a boy of 15 the M14 row flagged', () => {
    const r = resolvePop('m14_APDI', 'african-american', 'M', 13);
    expect(r.kind === 'norm' && [r.setId, r.entry.sex, r.mean, r.sd, r.entry.definitionMatch]).toEqual(['obamiyi2019', 'M', 79.9, 4.9, 'same']);
    expect(r.kind === 'norm' && r.entry.note).toMatch(/directly/);
    const old = resolvePop('m14_APDI', 'african-american', 'M', 15);
    expect(old.kind === 'norm' && [old.entry.ageBand, old.flags.includes('age-mismatched')]).toEqual([[14, 14], true]);
  });

  it('Obamiyi: Table 2\'s whole-sample sex rows and Table 1\'s Total row are not entered (they overlap the single-age rows), kept in a caveat with their ranges; rows 12 and 13 equal to M12/M13 said', () => {
    const s = setById('obamiyi2019')!;
    expect(s.entries.filter((e) => e.ageBand?.[0] === 7 && e.ageBand?.[1] === 14)).toEqual([]);
    expect(s.caveats.some((c) => /Table 2/.test(c) && /70\.3/.test(c) && /71\.2/.test(c) && /56–90/.test(c) && /not entered/i.test(c))).toBe(true);
    expect(s.caveats.some((c) => /12 and 13/.test(c) && /M12/.test(c) && /17/.test(c) && /16/.test(c))).toBe(true);
  });

  it('african-american: a boy of 10\'s SNA is Bailey & Taylor\'s 8–12 y 86.08, printed without an SD (it borrows one, said), Table V\'s 86.0 in the note', () => {
    const r = resolvePop('m01_SNA', 'african-american', 'M', 10);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.entry.sd, r.flags.includes('sd-borrowed'), r.colour]).toEqual(['baileytaylor1998', 86.08, undefined, true, true]);
    expect(r.kind === 'norm' && r.entry.note).toMatch(/86\.0/);
  });

  it('Kim 1974 overbite: same since owner ruling KIM-OB-1 (16 Oct 2026; his line, like the app\'s, runs from the incisor overlap to the first molars)', () => {
    const e = setById('kim1974')!.entries.find((x) => x.measurement === 'm69_Overbite')!;
    expect([e.definitionMatch, e.definitionNote, /incisal overlap/.test(e.note ?? '')]).toEqual(['same', undefined, true]);
  });

  it('Bailey & Taylor: L1–MP is Steiner\'s Go–Gn (p. 223) → #59 same; overbite close; no SD anywhere said in a caveat', () => {
    const s = setById('baileytaylor1998')!;
    expect(s.entries.find((e) => e.measurement === 'm59_L1GoGn')!.note).toMatch(/p\. 223/);
    expect(s.entries.find((e) => e.measurement === 'm69_Overbite')!.definitionNote).toMatch(/occlusal plane/);
    expect(s.caveats.some((c) => /No SD/.test(c))).toBe(true);
  });

  it('latin-american: a Peruvian woman of 25 gets Caballero\'s balanced-group ODI 72.10 ± 4.84, same (Kim\'s tangent, Table 1 and Fig. 4), and APDI 83.18 ± 1.71', () => {
    const odi = resolvePop('m15_ODI', 'latin-american', 'F', 25);
    expect(odi.kind === 'norm' && [odi.setId, odi.mean, odi.sd, odi.flags.includes('close'), odi.flags.includes('age-mismatched')]).toEqual(['caballero2019', 72.1, 4.84, false, false]);
    expect(odi.kind === 'norm' && odi.entry.note).toMatch(/Fig\. 4/);
    const apdi = resolvePop('m14_APDI', 'latin-american', 'M', 30);
    expect(apdi.kind === 'norm' && [apdi.setId, apdi.mean, apdi.sd]).toEqual(['caballero2019', 83.18, 1.71]);
    expect(setById('caballero2019')!.caveats.some((c) => /open bite/.test(c) && /not entered/i.test(c))).toBe(true);
  });

  it('saudi: a Saudi woman of 20\'s saddle angle is Alshahrani\'s 125.842 ± 6.661 (same); her S–Go is close (constructed gonion) and true size (Dolphin calibration)', () => {
    const r = resolvePop('m34_Saddle', 'saudi', 'F', 20);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.entry.definitionMatch]).toEqual(['alshahrani2018', 125.842, 6.661, 'same']);
    const go = resolvePop('m40_SGo', 'saudi', 'F', 20);
    expect(go.kind === 'norm' && [go.setId, go.mean, go.printed, go.flags.includes('close'), go.flags.includes('scale-assumed')]).toEqual(['alshahrani2018', 72.02, null, true, false]);
    expect(go.kind === 'norm' && go.sourceLine).toMatch(/constructed/);
  });

  it('Alshahrani: women\'s sum 397.302 as printed (parts add to 395.352, said); ratio SD 3 as printed; the men\'s Go–Me SD "6626" a caveat; authors as PubMed lists them', () => {
    const s = setById('alshahrani2018')!;
    expect(s.entries.find((e) => e.measurement === 'm39_SumAngles' && e.sex === 'F')!.note).toMatch(/395\.352/);
    expect(s.caveats.some((c) => /6626/.test(c))).toBe(true);
    expect(s.citation.authors).toBe('Alshahrani I, Kamran MA, Alhaizaey A, Abumelha N');
    expect(s.entries.every((e) => /PMC6191777/.test(e.source))).toBe(true);
  });

  it('Björk–Jarabak: the saddle angle (own norms) resolves to Jarabak via Alshahrani 2018 — second-hand, coloured — not the onfile website value', () => {
    const r = resolveOwn('bjork-jarabak', 'm34_Saddle');
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.colour, r.flags.includes('second-hand'), r.flags.includes('website')]).toEqual(
      ['jarabak-via-alshahrani2018', 123, 6, true, true, false],
    );
    expect(r.kind === 'norm' && r.sourceLine).toMatch(/quoted second-hand via Alshahrani et al\. 2018, Tables III–IV/);
  });

  it('positive control: without the Jarabak set, the same query falls back to the onfile website value', () => {
    const r = resolveNorm({ measurement: 'm34_Saddle', analysisId: 'bjork-jarabak', population: null, clinicDefault: null, sex: null, ageYears: null, sets: sets.filter((s) => s.id !== 'jarabak-via-alshahrani2018'), userNorms: [] });
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('website')]).toEqual(['onfile-bjork-jarabak', true]);
  });

  it('Jarabak via Alshahrani: ratio 63.5 (Table IV; Table III 63.51 in the note); the four lengths and the missing #37/#38 in caveats; no centre', () => {
    const s = setById('jarabak-via-alshahrani2018')!;
    expect([s.analyses, s.secondHand]).toEqual([['bjork-jarabak'], { via: 'Alshahrani et al. 2018, Tables III–IV' }]);
    expect(s.entries.find((e) => e.measurement === 'm42_Jarabak')!.note).toMatch(/63\.51/);
    expect(s.caveats.some((c) => /S–N/.test(c) && /71/.test(c) && /Go–Me/.test(c))).toBe(true);
  });

  it('malay: a Malay woman of 30\'s H-angle is Cheong\'s 15.75 ± 4.16 (same); a Malay man\'s is not (women only); ANB not entered (an inclusion criterion, P45), its value in a caveat', () => {
    const r = resolvePop('m80_HAngle', 'malay', 'F', 30);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.entry.n, r.flags.includes('age-mismatched')]).toEqual(['cheong2024', 15.75, 4.16, 85, false]);
    const m = resolvePop('m80_HAngle', 'malay', 'M', 30);
    expect(m.kind === 'norm' && m.setId).not.toBe('cheong2024');
    const s = setById('cheong2024')!;
    expect(s.caveats.some((c) => /ANB/.test(c) && /3\.15/.test(c) && /inclusion/.test(c))).toBe(true);
    expect(s.caveats.some((c) => /hard tissue/.test(c) && /11\.64/.test(c))).toBe(true);
  });
});

// ---- Task 9b-2 parts 2-3: McNamara 1984's three samples as population sets (ruling P23), Caucasian, 8%
// film enlargement (p. 451). Ann Arbor (Table I, p. 451) and Bolton (Tables III, p. 453, and VI, p. 462)
// were compared against the independent Task 6 extractions, Burlington (Table IV, p. 454) against its own
// second extraction (ruling P24); the tables below are a further reading of the page images.
const MCN_AGES = [6, 9, 12, 14, 16, 18];
const ANNARBOR: Row9b2[] = ([
  // [id, unit-free definition match, women (n 73) [mean, SD], men (n 38) [mean, SD]]; facial axis stored + 90°.
  ['m08_ANperp', 'same', [0.4, 2.3], [1.1, 2.7]], ['m01_SNA', 'same', [82.4, 3.0], [83.9, 3.2]],
  ['m11_CoGn', 'same', [120.2, 5.3], [134.3, 6.8]], ['m10_CoA', 'same', [91.0, 4.3], [99.8, 6.0]],
  ['m12_MaxMandDiff', 'same', [29.2, 3.3], [34.5, 4.0]], ['m28_LAFH', 'same', [66.7, 4.1], [74.6, 5.0]],
  ['m23_FHGoMe', 'same', [22.7, 4.3], [21.3, 3.9]], ['m31_FacAxisM', 'same', [90.2, 3.2], [90.5, 3.5]],
  ['m09_PogNperp', 'same', [-1.8, 4.5], [-0.3, 3.8]], ['m67_U1Avert', 'close', [5.4, 1.7], [5.3, 2.0]],
  ['m64_L1APog', 'close', [2.7, 1.7], [2.3, 2.1]], ['m84_UpperPharynx', 'same', [17.4, 3.4], [17.4, 4.3]],
  ['m85_LowerPharynx', 'same', [11.3, 3.3], [13.5, 4.3]],
] as [string, Row9b2[6], [number, number], [number, number]][]).flatMap(([id, dm, f, m]): Row9b2[] => [
  [id, 'F', [18, 40], f[0], f[1], 73, dm], [id, 'M', [18, 40], m[0], m[1], 38, dm],
]);
// Bolton: per measurement, women's then men's [mean, SD] at 6, 9, 12, 14, 16, 18 y; n 16 per sex per age.
const BOLTON_T: [string, Row9b2[6], [number, number][], [number, number][]][] = [
  ['m11_CoGn', 'same', [[97.7, 3.4], [106.1, 3.4], [113.1, 3.6], [118.9, 5.0], [120.0, 3.4], [121.6, 4.5]], [[99.3, 3.6], [107.7, 3.8], [114.4, 4.3], [120.6, 4.3], [126.8, 4.7], [131.0, 4.6]]],
  ['m10_CoA', 'same', [[79.8, 2.2], [85.0, 2.3], [89.6, 2.4], [92.1, 2.7], [92.7, 2.3], [93.6, 3.2]], [[81.7, 3.4], [87.7, 4.1], [92.1, 4.1], [95.2, 3.2], [98.9, 4.4], [100.9, 3.9]]],
  ['m12_MaxMandDiff', 'same', [[17.9, 8.1], [21.0, 2.7], [23.4, 3.0], [26.7, 4.1], [27.3, 3.0], [28.0, 3.2]], [[17.5, 2.2], [20.0, 2.6], [22.2, 3.1], [25.3, 3.5], [27.9, 3.3], [30.0, 3.9]]],
  ['m28_LAFH', 'same', [[57.9, 3.7], [60.0, 2.9], [62.6, 4.5], [65.6, 4.9], [66.1, 4.3], [67.2, 4.7]], [[58.4, 3.1], [61.1, 3.6], [64.3, 3.6], [66.8, 3.9], [69.7, 4.3], [71.6, 4.9]]],
  ['m67_U1Avert', 'close', [[-2.1, 1.4], [2.9, 0.9], [3.3, 1.0], [4.2, 1.5], [4.0, 1.3], [4.2, 1.3]], [[0.8, 1.4], [3.1, 1.3], [3.8, 1.3], [3.8, 1.4], [4.1, 2.1], [3.7, 1.3]]],
  ['m64_L1APog', 'close', [[0.02, 1.4], [0.9, 1.1], [1.3, 0.7], [1.4, 1.6], [1.1, 1.6], [1.2, 1.4]], [[0.5, 1.3], [1.1, 1.5], [1.4, 1.6], [1.4, 1.8], [1.3, 2.3], [0.4, 1.8]]],
];
const BOLTON: Row9b2[] = BOLTON_T.flatMap(([id, dm, f, m]) => (['F', 'M'] as const).flatMap((sex) =>
  (sex === 'F' ? f : m).map(([mean, sd], i): Row9b2 => [id, sex, [MCN_AGES[i]!, MCN_AGES[i]!], mean, sd, 16, dm])));
const MCN_SCALE: NormSet['scale'] = { kind: 'enlarged', percent: 8, source: 'p. 451' };
const T9B2_MCN: Record<string, { region: string; selection: NormSet['selection']; rows: Row9b2[] }> = {
  'mcnamara1984-annarbor': { region: 'Ann Arbor, Michigan', selection: 'class-I-balanced', rows: ANNARBOR },
  'mcnamara1984-bolton': { region: 'Cleveland, Ohio', selection: 'class-I-balanced', rows: BOLTON }, // owner MCN-1 (p. 462)
};

describe('Task 9b-2 part 2: McNamara 1984\'s Ann Arbor and Bolton samples (Caucasian)', () => {
  const setById = (id: string) => sets.find((s) => s.id === id);
  const key = (r: Row9b2) => JSON.stringify(r);

  it('the tables hold Ann Arbor\'s 13 measurements × 2 sexes and Bolton\'s 6 measurements × 2 sexes × 6 ages', () => {
    expect([ANNARBOR.length, BOLTON.length]).toEqual([26, 72]);
  });

  it.each(Object.keys(T9B2_MCN))('%s: Caucasian population set, verified, compared 2026-10-08, two readings, 8%% enlargement (p. 451), its city and selection; "Caucasian" is our label (caveat)', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    const want = T9B2_MCN[id]!;
    expect([s.kind, s.status, s.curation.comparedOn, s.curation.extractedBy.length, s.population.id, s.population.region, s.scale, s.selection]).toEqual(
      ['population', 'verified', '2026-10-08', 2, 'caucasian', want.region, MCN_SCALE, want.selection],
    );
    expect(s.caveats.some((c) => /Caucasian/.test(c) && /our label/.test(c))).toBe(true);
    expect(s.entries.filter((e) => e.centre !== undefined || e.sdSource !== undefined || e.range !== undefined).map((e) => e.measurement)).toEqual([]);
  });

  it.each(Object.keys(T9B2_MCN))('%s: every entry exactly as printed — none missing, none extra', (id) => {
    const s = setById(id);
    expect(s, id).toBeDefined();
    if (!s) return;
    const got = s.entries.map((e): Row9b2 => [e.measurement, e.sex, e.ageBand ?? null, e.mean ?? NaN, e.sd ?? null, e.n ?? null, e.definitionMatch]);
    const want = T9B2_MCN[id]!.rows;
    expect(got.map(key).filter((k) => !want.map(key).includes(k)), 'extra or wrong').toEqual([]);
    expect(want.map(key).filter((k) => !got.map(key).includes(k)), 'missing').toEqual([]);
    expect(got).toHaveLength(want.length);
  });

  it('caucasian, Gu 2011 Michigan held out: a woman of 27\'s Co–Gn is Ann Arbor\'s women\'s 120.2 ± 5.3 as printed, shown ÷ 1.08 with the disclosure', () => {
    const r = resolvePop('m11_CoGn', 'caucasian', 'F', 27, sets.filter((s) => s.id !== 'gu2011-caucasian'));
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.printed?.mean, r.printed?.sd, r.flags.includes('converted-to-true-size')]).toEqual(['mcnamara1984-annarbor', 120.2, 5.3, true]);
    expect(r.mean).toBeCloseTo(120.2 / 1.08, 10);
    expect(r.sourceLine).toContain('converted from 8% film enlargement (p. 451)');
  });

  it('full pool: Ann Arbor (n 111) now outranks Gu 2011 Michigan (n 90) for a Caucasian adult — both class-I balanced, both cover 27 (rule 5, larger sample)', () => {
    const r = resolvePop('m11_CoGn', 'caucasian', 'F', 27);
    expect(r.kind === 'norm' && r.setId).toBe('mcnamara1984-annarbor');
    const held = resolvePop('m11_CoGn', 'caucasian', 'F', 27, sets.filter((s) => s.id !== 'mcnamara1984-annarbor'));
    expect(held.kind === 'norm' && held.setId).toBe('gu2011-caucasian');
  });

  it('Ann Arbor facial axis stored + 90 (printed 0.2 / 0.5, owner ruling 7 Oct), same; incisor mm close (facial surface, M1); FH–GoMe same', () => {
    const s = setById('mcnamara1984-annarbor')!;
    const ax = s.entries.find((e) => e.measurement === 'm31_FacAxisM' && e.sex === 'F')!;
    expect([ax.mean, ax.definitionMatch]).toEqual([90.2, 'same']);
    expect(ax.note).toMatch(/\+ 90/);
    expect(s.entries.filter((e) => e.definitionMatch === 'close' && !/facial surface/.test(e.definitionNote ?? ''))).toEqual([]);
  });

  it('McNamara Bolton mm converted ÷ 1.08: a Caucasian girl of 12\'s U1 to A-vertical, printed 3.3 ± 1.0 (Table VI), close', () => {
    const r = resolvePop('m67_U1Avert', 'caucasian', 'F', 12);
    expect(r.kind).toBe('norm');
    if (r.kind !== 'norm') return;
    expect([r.setId, r.entry.ageBand, r.printed?.mean, r.printed?.sd, r.flags.includes('converted-to-true-size'), r.flags.includes('close')]).toEqual(
      ['mcnamara1984-bolton', [12, 12], 3.3, 1.0, true, true],
    );
    expect(r.mean).toBeCloseTo(3.3 / 1.08, 10);
    expect(r.sd).toBeCloseTo(1.0 / 1.08, 10);
  });

  it('Bolton: the girls\' 6-year differential SD 8.1 is as printed, its note says possibly a misprint', () => {
    const e = setById('mcnamara1984-bolton')!.entries.find((x) => x.measurement === 'm12_MaxMandDiff' && x.sex === 'F' && x.ageBand?.[0] === 6)!;
    expect([e.mean, e.sd]).toEqual([17.9, 8.1]);
    expect(e.note).toMatch(/possibly a misprint/);
  });

  it('a Caucasian boy of 7 (no Bolton age) gets the nearest printed age, 6 y, flagged age-mismatched', () => {
    const r = resolvePop('m64_L1APog', 'caucasian', 'M', 7);
    expect(r.kind === 'norm' && [r.setId, r.entry.ageBand, r.flags.includes('age-mismatched')]).toEqual(['mcnamara1984-bolton', [6, 6], true]);
  });
});

// ---- Task 9b-2 part 3: McNamara 1984's Burlington sample (Table IV, p. 454), 6-20 y at single ages.
const BUR_AGES = [6, 9, 12, 14, 16, 18, 20];
const BUR_N = { F: [56, 57, 56, 48, 54, 22, 44], M: [58, 49, 50, 51, 50, 17, 38] };
const BUR_T: [string, (number | null)[][], (number | null)[][]][] = [
  ['m11_CoGn', [[94.1, 3.3], [103.3, 5.3], [110.2, 6.4], [114.9, 7.1], [117.7, 4.5], [118.9, 4.7], [116.8, 7.3]], [[96.6, 3.83], [105.0, 4.15], [113.0, 5.11], [119.2, 5.7], [124.5, 5.97], [127.2, 6.0], [128.2, 4.2]]],
  ['m10_CoA', [[78.6, 3.1], [88.3, 4.0], [87.3, 4.6], [89.2, 5.2], [90.9, 4.1], [91.1, 3.1], [90.7, 5.2]], [[80.5, 2.4], [84.9, 2.5], [90.3, 3.6], [93.9, 4.6], [96.6, 4.4], [96.6, 4.7], [98.8, 4.3]]],
  ['m12_MaxMandDiff', [[15.5, null], [15.0, null], [22.9, null], [25.7, null], [26.8, null], [27.8, null], [26.1, null]], [[16.1, null], [20.1, null], [22.7, null], [25.3, null], [27.9, null], [30.6, null], [29.4, null]]],
  ['m28_LAFH', [[57.2, 3.4], [61.2, 3.9], [63.4, 4.7], [66.2, 5.1], [66.6, 4.7], [68.5, 4.7], [66.7, 5.7]], [[59.9, 2.7], [63.0, 3.0], [65.7, 2.5], [68.8, 4.0], [71.3, 4.4], [73.1, 4.4], [72.0, 3.0]]],
];
const BURLINGTON: Row9b2[] = BUR_T.flatMap(([id, f, m]) => (['F', 'M'] as const).flatMap((sex) =>
  (sex === 'F' ? f : m).map(([mean, sd], i): Row9b2 => [id, sex, [BUR_AGES[i]!, BUR_AGES[i]!], mean!, sd, BUR_N[sex][i]!, 'same'])));

describe('Task 9b-2 part 3: McNamara 1984\'s Burlington sample (Caucasian)', () => {
  const bur = () => sets.find((s) => s.id === 'mcnamara1984-burlington');
  const key = (r: Row9b2) => JSON.stringify(r);

  it('mcnamara1984-burlington: Caucasian population set, verified, compared 2026-10-08, two readings, 8% enlargement (p. 451), Burlington, selection unknown; "Caucasian" our label', () => {
    const s = bur();
    expect(s).toBeDefined();
    if (!s) return;
    expect([s.kind, s.status, s.curation.comparedOn, s.curation.extractedBy.length, s.population.id, s.population.region, s.scale, s.selection]).toEqual(
      ['population', 'verified', '2026-10-08', 2, 'caucasian', 'Burlington, Ontario', MCN_SCALE, 'unknown'],
    );
    expect(s.caveats.some((c) => /Caucasian/.test(c) && /our label/.test(c))).toBe(true);
  });

  it('every Burlington entry exactly as printed: 4 measurements × 2 sexes × 7 ages, n per age from Table IV, the differential without an SD', () => {
    const s = bur();
    expect(s).toBeDefined();
    if (!s) return;
    expect(BURLINGTON).toHaveLength(56);
    const got = s.entries.map((e): Row9b2 => [e.measurement, e.sex, e.ageBand ?? null, e.mean ?? NaN, e.sd ?? null, e.n ?? null, e.definitionMatch]);
    expect(got.map(key).filter((k) => !BURLINGTON.map(key).includes(k)), 'extra or wrong').toEqual([]);
    expect(BURLINGTON.map(key).filter((k) => !got.map(key).includes(k)), 'missing').toEqual([]);
    expect(got).toHaveLength(56);
  });

  it('Burlington girls\' Co–A 88.3 at 9 y and 87.3 at 12 y as printed, both noted', () => {
    const rows = (bur()?.entries ?? []).filter((e) => e.measurement === 'm10_CoA' && e.sex === 'F' && [9, 12].includes(e.ageBand![0]));
    expect(rows.map((e) => [e.mean, /88\.3 at 9 y and 87\.3 at 12 y|88\.3 at 9 y to 87\.3 at 12 y/.test(e.note ?? '')])).toEqual([[88.3, true], [87.3, true]]);
  });

  it('with Bolton held out, a Caucasian girl of 12\'s Co–A is Burlington\'s printed 87.3 ÷ 1.08; her differential has no SD of its own and borrows one, said', () => {
    const pool = sets.filter((s) => s.id !== 'mcnamara1984-bolton');
    const r = resolvePop('m10_CoA', 'caucasian', 'F', 12, pool);
    expect(r.kind === 'norm' && [r.setId, r.printed?.mean, r.flags.includes('converted-to-true-size')]).toEqual(['mcnamara1984-burlington', 87.3, true]);
    const d = resolvePop('m12_MaxMandDiff', 'caucasian', 'F', 12, pool);
    expect(d.kind === 'norm' && [d.setId, d.entry.sd, d.flags.includes('sd-borrowed')]).toEqual(['mcnamara1984-burlington', undefined, true]);
    expect(d.kind === 'norm' && d.sourceLine).toMatch(/SD borrowed from/);
  });
});

// ---- Task 9b-2 fix round 1 (owner rulings JAR-1, MCN-1, 8 Oct).
describe('Task 9b-2 fix round 1', () => {
  const setById = (id: string) => sets.find((s) => s.id === id);
  const JAR1 = "These ± values equal the half-widths of Jarabak's usually quoted ranges (70–85 mm, 105–120 mm, 62–65 %); Alshahrani heads the column 'Mean ± SD', so they are kept as SDs (owner ruling 8 Oct) — they may be half-ranges.";

  it('owner JAR-1: Jarabak\'s face heights and ratio keep their ± as SDs (77.5 ± 7.5, 112.5 ± 7.5, 63.5 ± 1.5), each with the ruling\'s note; caveats for the half-ranges and the angle SDs', () => {
    const s = setById('jarabak-via-alshahrani2018')!;
    const rows = ['m40_SGo', 'm41_NMe', 'm42_Jarabak'].map((id) => s.entries.find((e) => e.measurement === id)!);
    expect(rows.map((e) => [e.mean, e.sd, (e.note ?? '').includes(JAR1)])).toEqual([[77.5, 7.5, true], [112.5, 7.5, true], [63.5, 1.5, true]]);
    expect(s.caveats).toContain(JAR1);
    expect(s.caveats.some((c) => /saddle 6, articular 5, gonial 6, sum 5/.test(c) && /5 \/ 6 \/ 7 \/ 6/.test(c))).toBe(true);
  });

  it('owner MCN-1: a Caucasian girl of 9\'s Co–Gn comes from Bolton (class-I balanced, p. 462) over Burlington by rule 5 — whatever order the files load in', () => {
    for (const pool of [sets, [...sets].reverse()]) {
      const r = resolvePop('m11_CoGn', 'caucasian', 'F', 9, pool);
      expect(r.kind === 'norm' && [r.setId, r.printed?.mean]).toEqual(['mcnamara1984-bolton', 106.1]);
    }
    expect(setById('mcnamara1984-bolton')!.curation.notes).toMatch(/p\. 462 gives the Bolton standards \(Table VI\) as an example of well-balanced faces/);
  });

  it('Burlington still supplies a row when no other set covers the age: with the adult sets (Ann Arbor, Gu 2011 Michigan) held out, a man of 20\'s Co–Gn is Burlington\'s 20-year row (Bolton stops at 18); in the full pool Ann Arbor covers 20', () => {
    const r = resolvePop('m11_CoGn', 'caucasian', 'M', 20, sets.filter((s) => !['mcnamara1984-annarbor', 'gu2011-caucasian'].includes(s.id)));
    expect(r.kind === 'norm' && [r.setId, r.entry.ageBand, r.printed?.mean, r.flags.includes('age-mismatched')]).toEqual(['mcnamara1984-burlington', [20, 20], 128.2, false]);
    const full = resolvePop('m11_CoGn', 'caucasian', 'M', 20);
    expect(full.kind === 'norm' && full.setId).toBe('mcnamara1984-annarbor');
  });

  it('Bailey & Taylor: sample n is 41 (groups 1 + 2, 8–12 y, which every entry stands on); the full study\'s 71 is said', () => {
    const s = setById('baileytaylor1998')!;
    expect([s.sample.n, s.sample.ageMin, s.sample.ageMax]).toEqual([41, 8, 12]);
    expect(s.caveats.some((c) => /71/.test(c) && /41/.test(c))).toBe(true);
  });

  it.each(['abo', 'nagasaki', 'radney'])('real pool: every %s measurement with no paper own-norm resolves to its website set, flagged website', (analysisId) => {
    const web = WEB[analysisId]!;
    const paper = new Set(sets.filter((s) => s.kind === 'analysis-own' && s.status !== 'website' && (s.analyses ?? []).includes(analysisId)).flatMap((s) => s.entries.map((e) => e.measurement)));
    const rows = web.rows.filter(([id]) => !paper.has(id));
    expect(rows.length).toBeGreaterThan(0);
    const wrong = rows.filter(([id]) => { const r = resolveOwn(analysisId, id); return !(r.kind === 'norm' && r.setId === web.set && r.flags.includes('website')); }).map(([id]) => id);
    expect(wrong).toEqual([]);
  });
});


// ---- Final fix wave (12 Oct): citations and cross-set rules from the final review.
describe('final review fixes: citations, the lip-thickness label, the NUS sheet as a population', () => {
  const byId = (id: string) => sets.find((s) => s.id === id)!;

  it('I-2: Jarabak\'s own norms cite Jarabak & Fizzell 1972; Alshahrani 2018 stays the carrier in secondHand.via; no value moves', () => {
    const s = byId('jarabak-via-alshahrani2018');
    expect([s.citation.authors, s.citation.year]).toEqual(['Jarabak JR, Fizzell JA', 1972]);
    expect(s.secondHand).toEqual({ via: 'Alshahrani et al. 2018, Tables III–IV' });
    expect(s.caveats.some((c) => /PMC6191777/.test(c) && /10\.12669\/pjms\.345\.15556/.test(c))).toBe(true);
    const r = resolveNorm({ measurement: 'm42_Jarabak', analysisId: 'bjork-jarabak', population: null, clinicDefault: null, sex: null, ageYears: null, sets, userNorms: [] });
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd]).toEqual(['jarabak-via-alshahrani2018', 63.5, 1.5]);
    expect(r.kind === 'norm' && r.sourceLine).toMatch(/^Jarabak 1972, /);
    expect(r.kind === 'norm' && r.sourceLine).toMatch(/quoted second-hand via Alshahrani et al\. 2018/);
  });

  it('M-1: Jacobson 1975 carries the 1975 DOI (SOURCES.md); the 2003 reprint DOI stays in a caveat', () => {
    const s = byId('jacobson1975');
    expect(s.citation.doi).toBe('10.1016/0002-9416(75)90065-2');
    expect(s.caveats.some((c) => c.includes('10.1016/S0889-5406(03)00540-7'))).toBe(true);
  });

  it('I-3 (owner LIP-4): every entry labelled with Holdaway\'s printed row "Upper lip thickness" is #77, in every set', () => {
    const labelled = sets.flatMap((s) => s.entries.filter((e) => /'upper lip thickness/i.test(`${e.source} ${e.note ?? ''} ${e.definitionNote ?? ''}`)).map((e) => [s.id, e.measurement]));
    expect(labelled.length).toBeGreaterThanOrEqual(2); // Lew 1992 via Moate, Alcalde 2000
    expect(labelled.filter(([, m]) => m !== 'm77_BasicUL')).toEqual([]);
  });

  it('M-7: choosing the Singapore (NUS) population for any analysis uses the NDC teaching sheet as that population\'s norm', () => {
    const r = resolveNorm({ measurement: 'm01_SNA', analysisId: 'steiner', population: 'singapore-nus', clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [] });
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, (r.flags as string[]).includes('own-norm-fallback')]).toEqual(['ndc-sheet', 83.4, 3.5, false]);
  });
});

// ---- Task 10 (deferred papers, owner 13 Oct): Kim 2025 (African-American adults), Alassiry 2022 (Eastman standards,
// second-hand), Al Maaitah 2022 (Björk polygon, Class I group). Every value read twice (a = text layer / page image,
// b = page image) and every Kim value re-read on the page image of Tables 1-5 (pp. 481-482) at merge.
// Owner ruling KIMRANK-1 (13 Oct): Kim 2025 and Al Maaitah
// 2022 rank as ordinary Class I samples (selection class-I, as Cheong 2024), replacing the P37 ruling;
// jarabak-via-almaaitah2022 is NOT a set (the paper quotes only two cut-offs for Jarabak's sum of angles, no mean or SD).
describe('deferred papers (Task 10): kim2025, alassiry2022-eastman, almaaitah2022', () => {
  const byId = (id: string) => sets.find((s) => s.id === id);
  const row = (setId: string, m: string) => byId(setId)?.entries.find((e) => e.measurement === m);

  // Kim et al. 2025, Tables 1-5, pp. 481-482: [measurement, mean, SD]; every row pooled, n 34, adults [18, 40].
  const KIM: [string, number, number][] = [
    ['m01_SNA', 84.6, 3.6], ['m02_SNB', 81.0, 3.2], ['m03_ANB', 3.7, 2.0], ['m47_U1NAdeg', 28.8, 7.0], ['m46_U1NAmm', 7.7, 2.6],
    ['m50_L1NBdeg', 38.0, 7.2], ['m49_L1NBmm', 10.4, 2.6], ['m53_Interincisal', 109.5, 10.3], ['m60_OPSN', 15.2, 4.6],
    ['m20_SNGoGn', 32.0, 6.4], ['m18_PogNB', -1.2, 2.0], ['m22_FHMPt', 25.2, 5.6], ['m58_FMIA', 52.3, 7.0], ['m56_IMPAt', 102.5, 8.4],
    ['m30_FacAxisR', 91.0, 4.6], ['m33_MandBend', 35.4, 5.6], ['m07_ANPog', 4.3, 2.6], ['m32_OralGnomon', 43.8, 3.7],
    ['m63_U1APog', 11.2, 2.6], ['m19_U6PTV', 21.9, 3.3], ['m64_L1APog', 8.5, 2.3], ['m34_Saddle', 127.2, 6.0], ['m35_Articular', 144.7, 8.4],
    ['m36_Gonial', 122.7, 7.6], ['m39_SumAngles', 394.6, 6.5], ['m37_UpperGonial', 49.4, 5.3], ['m38_LowerGonial', 73.2, 5.4],
    ['m42_Jarabak', 64.3, 5.6], ['m54_U1SN', 113.4, 6.8], ['m04_FacialAngle', 89.8, 2.7], ['m05_Convexity', 8.9, 5.1],
    ['m06_ABPlane', -4.8, 3.0], ['m24_YAxis', 58.8, 3.4], ['m61_CantOP', 5.8, 3.6], ['m62_L1OPdev', 31.8, 7.2], ['m71_ULE', 0.4, 3.0],
    ['m72_LLE', 4.4, 3.6],
  ];
  // Alassiry 2022, Table 2, p. 1175, Eastman columns: [measurement, mean, SD]; pooled, no age band, no n.
  const ALASSIRY: [string, number, number][] = [
    ['m01_SNA', 81, 3], ['m02_SNB', 78, 3], ['m03_ANB', 3, 2], ['m55_U1MxP', 109, 6], ['m57_IMPAgome', 93, 6],
    ['m53_Interincisal', 131, 6], ['m25_MMPA', 27, 4], ['m26_SNMxP', 8, 3], ['m64_L1APog', 1, 2],
  ];
  // Al Maaitah et al. 2022, Table 3, p. 615, Class I column: [measurement, mean, SD]; pooled, n 94, adults [18, 40].
  const MAAITAH: [string, number, number][] = [
    ['m34_Saddle', 124.12, 5.08], ['m35_Articular', 146.65, 7.03], ['m36_Gonial', 126.45, 6.72], ['m39_SumAngles', 397.21, 7.65],
  ];

  it('the three sets are on file in their folders; jarabak-via-almaaitah2022 is not (two quoted cut-offs, no mean or SD)', () => {
    expect([byId('kim2025')?.population.id, byId('alassiry2022-eastman')?.population.id, byId('almaaitah2022')?.population.id])
      .toEqual(['african-american', 'analysis-own', 'jordanian']);
    expect(byId('jarabak-via-almaaitah2022')).toBeUndefined();
  });

  it.each(KIM)('kim2025 %s: %s ± %s, pooled, n 34, ages 18-40, as printed', (m, mean, sd) => {
    const e = row('kim2025', m);
    expect(e && [e.mean, e.sd, e.n, e.sex, e.ageBand]).toEqual([mean, sd, 34, 'pooled', [18, 40]]);
  });

  it.each(ALASSIRY)('alassiry2022-eastman %s: %s ± %s, pooled, no age band', (m, mean, sd) => {
    const e = row('alassiry2022-eastman', m);
    expect(e && [e.mean, e.sd, e.sex, e.ageBand, e.n]).toEqual([mean, sd, 'pooled', undefined, undefined]);
  });

  it.each(MAAITAH)('almaaitah2022 %s: %s ± %s, pooled Class I, n 94, ages 18-40', (m, mean, sd) => {
    const e = row('almaaitah2022', m);
    expect(e && [e.mean, e.sd, e.n, e.sex, e.ageBand]).toEqual([mean, sd, 94, 'pooled', [18, 40]]);
  });

  it('the tables cover every entry of each set exactly (an added or dropped row fails here)', () => {
    const ids = (id: string) => byId(id)?.entries.map((e) => e.measurement).sort();
    expect(ids('kim2025')).toEqual(KIM.map(([m]) => m).sort());
    expect(ids('alassiry2022-eastman')).toEqual(ALASSIRY.map(([m]) => m).sort());
    expect(ids('almaaitah2022')).toEqual(MAAITAH.map(([m]) => m).sort());
  });

  it('set-level rulings: Kim and Al Maaitah ordinary Class I samples (owner KIMRANK-1); Alassiry second-hand for the Eastman analysis; years; scales', () => {
    const k = byId('kim2025')!, a = byId('alassiry2022-eastman')!, j = byId('almaaitah2022')!;
    expect([k.selection, k.citation.year, k.sample.n, k.sample.nMale, k.sample.nFemale, k.scale.kind]).toEqual(['class-I', 2025, 34, 9, 25, 'not-stated']);
    expect(k.caveats.some((c) => /2026;?\s*87:477/.test(c))).toBe(true);
    expect([a.kind, a.analyses, a.secondHand?.via, a.scale.kind]).toEqual(['analysis-own', ['eastman'], 'Alassiry 2022, Table 2 (Eastman columns), p. 1175', 'not-stated']);
    expect([j.selection, j.sample.n, j.scale.kind]).toEqual(['class-I', 94, 'true-size']);
    // P45: the measurement that picked the sample is never a norm row.
    expect(row('almaaitah2022', 'm03_ANB')).toBeUndefined();
    expect([row('kim2025', 'm68_Overjet'), row('kim2025', 'm69_Overbite')]).toEqual([undefined, undefined]);
  });

  it('definition rulings: Alassiry MMPA and L1–APog close; Al Maaitah gonial and sum close (Ar-Go-Gn); Kim #33 close with the catalogue note answered', () => {
    expect(['m25_MMPA', 'm64_L1APog', 'm57_IMPAgome'].map((m) => row('alassiry2022-eastman', m)?.definitionMatch)).toEqual(['close', 'close', 'close']);
    expect(['m34_Saddle', 'm35_Articular', 'm36_Gonial', 'm39_SumAngles'].map((m) => row('almaaitah2022', m)?.definitionMatch)).toEqual(['same', 'same', 'close', 'close']);
    const bend = row('kim2025', 'm33_MandBend');
    expect(bend?.definitionMatch).toBe('close');
    expect(bend?.definitionNote).toMatch(/mandibular bend/i);
    expect(bend?.definitionNote).toMatch(/p\. 130/);
  });

  // African-American: Bailey & Taylor 1998 (8-12 y) and Obamiyi 2019 (7-14 y) are child samples; Kim 2025 is the only
  // adult one. Owner KIMRANK-1 (13 Oct): Kim 2025 ranks as an ordinary Class I sample (as Cheong 2024 does), not as a P37
  // treatment sample, so for a man of 30 its adult row covers his age (AGE-1) and wins every one of its 37 measurements —
  // including the seven Bailey & Taylor also print, which before the ruling stayed on Bailey & Taylor's children's row.
  const BAILEY_HAS = ['m01_SNA', 'm02_SNB', 'm03_ANB', 'm20_SNGoGn', 'm47_U1NAdeg', 'm53_Interincisal', 'm54_U1SN'];

  it.each(KIM)('KIMRANK-1: an African-American man of 30, %s: Kim 2025 (%s ± %s, own SD, his age)', (m, mean, sd) => {
    const r = resolvePop(m, 'african-american', 'M', 30);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.colour, r.flags.includes('age-mismatched')]).toEqual(['kim2025', mean, sd, true, false]);
  });

  it('KIMRANK-1: a child of 10 still gets Bailey & Taylor (class-I-balanced, covers the age) for the seven it prints', () => {
    const wrong = BAILEY_HAS.filter((m) => {
      const r = resolvePop(m, 'african-american', 'M', 10);
      return !(r.kind === 'norm' && r.setId === 'baileytaylor1998');
    });
    expect(wrong).toEqual([]);
  });

  // Owner SDLEND-1a (13 Oct, fix round 1): Bailey & Taylor print no SD for these seven. The same population's lender
  // comes before any other population's, at any age, so a child's row borrows Kim 2025's adult SD (the only
  // African-American lender) rather than another population's children's SD.
  it.each(BAILEY_HAS)('SDLEND-1a: an African-American boy of 10, %s: Bailey & Taylor with Kim 2025\'s SD (same population, adults)', (m) => {
    const r = resolvePop(m, 'african-american', 'M', 10);
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('sd-borrowed'), r.sdDonor?.setId, r.sdDonor?.ageRowUsed]).toEqual(['baileytaylor1998', true, 'kim2025', '18–40 y']);
  });

  it('positive control for KIMRANK-1: with Kim 2025 relabelled a treatment sample (P37), the same man\'s SNA goes back to Bailey & Taylor', () => {
    const relabelled = sets.map((s) => (s.id === 'kim2025' ? { ...s, selection: 'mixed-occlusion' as const } : s));
    const r = resolvePop('m01_SNA', 'african-american', 'M', 30, relabelled);
    expect(r.kind === 'norm' && [r.setId, r.flags.includes('age-mismatched')]).toEqual(['baileytaylor1998', true]);
  });

  it('an African-American adult with no age entered: saddle angle is Kim 2025\'s adult row, marked age not entered', () => {
    const r = resolvePop('m34_Saddle', 'african-american', null, null);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.flags.includes('age-assumed-adult')]).toEqual(['kim2025', 127.2, 6.0, true]);
  });

  it('Eastman own norms (no population): every Alassiry row but U1–MxP (Naini first-hand, FIRSTHAND-1) resolves to alassiry2022-eastman, flagged second-hand, via Alassiry', () => {
    const wrong = ALASSIRY.filter(([m]) => m !== 'm55_U1MxP').filter(([m, mean, sd]) => {
      const r = resolveAged('eastman', m, 'F', 30);
      return !(r.kind === 'norm' && r.setId === 'alassiry2022-eastman' && r.mean === mean && r.sd === sd && r.flags.includes('second-hand') && /via Alassiry 2022/.test(r.sourceLine));
    }).map(([m]) => m);
    expect(wrong).toEqual([]);
  });

  // Owner FIRSTHAND-1 (13 Oct): a first-hand source beats a second-hand restatement, before the year. Before the ruling
  // Alassiry 2022 (second-hand) won here as the later paper.
  it('FIRSTHAND-1: Eastman U1–MxP is Naini 2011 (first-hand, 109 ± 6), not Alassiry 2022\'s restatement of the same value', () => {
    const r = resolveAged('eastman', 'm55_U1MxP', 'F', 14);
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.flags.includes('second-hand')]).toEqual(['eastman-naini', 109, 6, false]);
    // Without Naini, Alassiry's restatement is used, flagged.
    const via = resolveAged('eastman', 'm55_U1MxP', 'F', 14, sets.filter((s) => s.id !== 'eastman-naini'));
    expect(via.kind === 'norm' && [via.setId, via.mean, via.sd, via.flags.includes('second-hand')]).toEqual(['alassiry2022-eastman', 109, 6, true]);
  });

  // Owner JORDAN-1 (13 Oct): Al Maaitah's subjects are Jordanian adults, so the set moved from 'caucasian' (whose label
  // speaks of European background) to its own population 'jordanian', labelled Middle-Eastern / Jordanian.
  it('JORDAN-1: Al Maaitah 2022 is the Jordanian population; its label and the picker list (after Saudi) say so', () => {
    const j = byId('almaaitah2022')!;
    expect([j.population.id, j.population.label, j.population.country]).toEqual(['jordanian', 'Middle-Eastern / Jordanian', 'Jordan']);
    expect(POPULATIONS.find((p) => p.id === 'jordanian')?.label).toBe('Middle-Eastern / Jordanian');
    const offered = populationsOffered(sets, []).map((p) => p.id);
    expect(offered).toContain('jordanian');
    expect(offered.indexOf('jordanian')).toBe(offered.indexOf('saudi') + 1);
    expect(sets.filter((s) => s.population.id === 'caucasian').map((s) => s.id).sort())
      .toEqual(['gu2011-caucasian', 'mcnamara1984-annarbor', 'mcnamara1984-bolton', 'mcnamara1984-burlington']);
  });

  it('JORDAN-1: Björk–Jarabak sum of angles — a Jordanian man of 30 gets Al Maaitah 2022 (397.21 ± 7.65); a Caucasian man gets Jarabak\'s own norm (Auto)', () => {
    const r = resolveNorm({ measurement: 'm39_SumAngles', analysisId: 'bjork-jarabak', population: 'jordanian', clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [] });
    expect(r.kind === 'norm' && [r.setId, r.mean, r.sd, r.colour, r.flags.includes('close')]).toEqual(['almaaitah2022', 397.21, 7.65, true, true]);
    expect(r.kind === 'norm' && r.sourceLine).toMatch(/^Al Maaitah 2022, Middle-Eastern \/ Jordanian \(Irbid\), 18–40 y/);
    // N-A3: Caucasian has no sum of angles; step 2, Jarabak's own norm (step 3 is the same population).
    const cau = resolveNorm({ measurement: 'm39_SumAngles', analysisId: 'bjork-jarabak', population: 'caucasian', clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [] });
    expect(cau.kind === 'norm' && [cau.setId, cau.mean, cau.flags.includes('auto-fallback')]).toEqual(['jarabak-via-alshahrani2018', 396, true]);
    // No population: Jarabak's own norm, unchanged.
    const own = resolveAged('bjork-jarabak', 'm39_SumAngles', 'M', 30);
    expect(own.kind === 'norm' && own.setId).toBe('jarabak-via-alshahrani2018');
  });

  it('every set file sits in the folder named after its population id (a moved population with an unmoved file fails here)', () => {
    const files = Object.entries(import.meta.glob('../../../../reference/norms/sets/**/*.json', { eager: true, import: 'default' }) as Record<string, NormSet>);
    expect(files.length).toBe(sets.length);
    const misplaced = files.filter(([path, set]) => path.split('/').slice(-2)[0] !== set.population.id).map(([path]) => path);
    expect(misplaced).toEqual([]);
  });
});
