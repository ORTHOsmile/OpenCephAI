import { describe, it, expect } from 'vitest';
import appendix from '../../../docs/analyses-catalogue.md?raw';
import { CATALOGUE, byId } from './catalogue';
import { WHAT } from './catalogue/what';
import { stripScreenMarkup } from './catalogue/screen-words';
import { LANDMARKS, POINT_DEFINITIONS, UNCONFIRMED_POINTS, UNCONFIRMED_PATTERN, type LandmarkId } from './landmarks';
import { LINES, LINE_NAMES } from './lines';
import { measurementDefinition, pointDefinition, MARK_WORDS, APPENDIX_POINT_SOURCE, DEFINITION_TO_COME } from './definitions';
import { PLUS_WORDS, PLUS_IN_WHAT, CONSTRUCTION, NOTES } from './catalogue/screen-signs';
import { buildRegistry } from './registry';
import { ALL_ANALYSES } from './analyses';
import { exprRefs } from './steps';

/** The appendix §4 "What is measured" cell for each catalogue number, with dated correction notes removed: a bracket
 *  that starts "(corrected …)", or a "; corrected …" clause at the end of a bracket (pre-flight P4: #27's bracket keeps
 *  its Kim citations, which are the source of its sign). */
export function appendixWhat(md: string): Record<string, string> {
  const sec = md.slice(md.indexOf('## 4.'), md.indexOf('## 5.'));
  const out: Record<string, string> = {};
  for (const line of sec.split('\n')) {
    const m = line.match(/^\| (\d+) \|/);
    if (!m) continue;
    out[m[1]] = line.split('|').map((c) => c.trim())[3].replace(/\s*\(corrected [^()]*\)/g, '').replace(/;\s*corrected [^();]*(?=\))/g, '').trim();
  }
  return out;
}
/** Catalogue numbers whose words differ from the appendix (retired entries included, review fix round 1,
 *  Minor 3), compared net of screen-markup stripping, plus any key WHAT carries that the appendix does not. */
export function diffWhat(what: Record<string, string>, fromAppendix: Record<string, string>): string[] {
  const nums = [...new Set(CATALOGUE.map((e) => e.no))];
  const mismatched = nums.filter(
    (no) => !what[no] || stripScreenMarkup(what[no]) !== stripScreenMarkup(fromAppendix[no] ?? ''),
  );
  const extra = Object.keys(what).filter((k) => !(k in fromAppendix));
  return [...new Set([...mismatched, ...extra])];
}

/** Appendix §2 rows → the catalogue points each row defines. A row's words are shared by every point in it. */
const ROW_POINTS: Record<string, LandmarkId[]> = {
  'S, sella': ['S'], 'N, nasion': ['N'], 'Or, orbitale': ['Or'], 'Po, porion': ['Po'], 'A, subspinale': ['A'],
  'B, supramentale': ['B'], 'Pog, pogonion': ['Pog'], 'Gn, gnathion': ['Gn'], 'Me, menton': ['Me'], 'Go, gonion': ['Go'],
  'Ar, articulare': ['Ar'], 'ANS, PNS': ['ANS', 'PNS'], 'U1T, L1T': ['U1T', 'L1T'], 'UL, LL': ['UL', 'LL'],
  'Sn, subnasale': ['Sn'], 'Pog′, soft-tissue pogonion': ['PogS'], 'U1A, L1A, incisor apices': ['U1A', 'L1A'],
  'U1L, L1L, most labial crown point (**new**)': ['U1L'], 'U6, L6': ['U6', 'L6'], 'P, premolar cusp overlap (**new**)': ['P4'],
  'Co, condylion': ['Co'], 'Ba, basion': ['Ba'], 'Pt, pterygoid point': ['Pt'], 'Prn, pronasale': ['Prn'],
  'N′, soft-tissue nasion': ['Ns'], 'Spl, superior sulcus (**new**)': ['ULs'], 'Sbl, inferior sulcus (**new**)': ['LLs'],
  'Suprapogonion and its soft-tissue point (**new**)': ['SPog', 'SPogS'],
};
export function appendixPoints(md: string): Partial<Record<LandmarkId, string>> {
  const sec = md.slice(md.indexOf('## 2.'), md.indexOf('## 3.'));
  const out: Partial<Record<LandmarkId, string>> = {};
  for (const line of sec.split('\n')) {
    const cells = line.split('|').map((c) => c.trim());
    const ids = ROW_POINTS[cells[1] ?? ''];
    if (ids) for (const id of ids) out[id] = cells[2];
  }
  return out;
}
/** Points whose definition differs from the appendix (review fix round 1, Minor 7: the same standard as
 *  `diffWhat` for §4), compared net of screen-markup stripping. */
export function diffPoints(
  defs: Partial<Record<LandmarkId, string>>,
  fromAppendix: Partial<Record<LandmarkId, string>>,
): LandmarkId[] {
  const ids = Object.keys(fromAppendix) as LandmarkId[];
  return ids.filter(
    (id) => !defs[id] || stripScreenMarkup(defs[id]!) !== stripScreenMarkup(fromAppendix[id]!),
  );
}
/** No screen word carries the appendix's own editorial markup (review fix round 1, Minor 4). */
function markupIn(values: string[]): string[] {
  return values.filter((v) => v.includes('**') || v.includes('§') || /\(C\d+\)/.test(v));
}

describe('plain words for each measurement (appendix §4)', () => {
  const fromAppendix = appendixWhat(appendix);
  it('the appendix parse finds all 93 rows (positive control on the parser; #93 BaSN added 7 Nov 2026)', () => {
    expect(Object.keys(fromAppendix)).toHaveLength(93);
    expect(fromAppendix['1']).toBe('Angle at N between S and A');
    expect(fromAppendix['27']).not.toMatch(/corrected/);
    expect(fromAppendix['27']).toMatch(/Kim 1974 p\. 590/);   // P4: the citation stays
  });
  it('WHAT keeps #27\'s Kim citations', () => {
    expect(WHAT['27']).toMatch(/Kim 1974 p\. 590/);
  });
  it('every catalogue entry, including retired ones, has words equal to its appendix row (review Minor 3)', () => {
    expect(diffWhat(WHAT, fromAppendix)).toEqual([]);
  });
  it('the check fails when the appendix and the app disagree (planted change)', () => {
    const planted = appendix.replace('| Angle at N between S and A |', '| Angle at N between S and B |');
    expect(diffWhat(WHAT, appendixWhat(planted))).toEqual(['1']);
  });
  it('the check fails on a retired entry too (planted change on #45, review Minor 3)', () => {
    const planted = appendix.replace(
      '| 45 | U1–NA (mm), labial point | Not used: C1 ruled the tip for all (#46) |',
      '| 45 | U1–NA (mm), labial point | Not used: C9 ruled the tip for all (#46) |',
    );
    expect(diffWhat(WHAT, appendixWhat(planted))).toEqual(['45']);
  });
  it('a key WHAT carries that the appendix does not is caught (review Minor 3)', () => {
    expect(diffWhat({ ...WHAT, '999': 'invented' }, fromAppendix)).toEqual(['999']);
  });
  it('no WHAT value carries appendix markup (review Minor 4: strip **, §N, ruling codes)', () => {
    expect(markupIn(Object.values(WHAT))).toEqual([]);
  });
});

describe('point definitions (appendix §2)', () => {
  const fromAppendix = appendixPoints(appendix);
  it('every appendix §2 row was found (positive control on the parser)', () => {
    expect(Object.keys(fromAppendix).sort()).toEqual(Object.values(ROW_POINTS).flat().sort());
  });
  it('every §2 data row is mapped: a new appendix row cannot be skipped silently (P5)', () => {
    const sec = appendix.slice(appendix.indexOf('## 2.'), appendix.indexOf('## 3.'));
    const firstCells = sec.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| Point |') && !l.startsWith('| ---'))
      .map((l) => l.split('|').map((c) => c.trim())[1]);
    expect(firstCells).toHaveLength(28);
    expect(firstCells).toHaveLength(Object.keys(ROW_POINTS).length);
    expect(firstCells.filter((c) => !(c in ROW_POINTS))).toEqual([]);
  });
  it('POINT_DEFINITIONS holds exactly the appendix words, and nothing the appendix does not give', () => {
    expect(diffPoints(POINT_DEFINITIONS, fromAppendix)).toEqual([]);
  });
  it('a planted change is caught by the same comparison the equality test uses (review Minor 7)', () => {
    const planted = appendix.replace('Geometric centre of the pituitary fossa', 'Centre of the fossa');
    expect(diffPoints(POINT_DEFINITIONS, appendixPoints(planted))).toEqual(['S']);
  });
  it('no POINT_DEFINITIONS value carries appendix markup (review Minor 4: strip **, §N, ruling codes)', () => {
    expect(markupIn(Object.values(POINT_DEFINITIONS) as string[])).toEqual([]);
  });
  it('the points whose meaning is still to be confirmed on films are found from their own words', () => {
    expect([...UNCONFIRMED_POINTS].sort()).toEqual(['L6', 'LLs', 'Pt', 'U6', 'ULs']);
  });
  it('a point newly confirmed on films is not flagged (review Minor 6: "confirmed" must not match)', () => {
    expect(UNCONFIRMED_PATTERN.test('confirmed on films, 14 Oct')).toBe(false);
    expect(UNCONFIRMED_PATTERN.test('still to confirm on films')).toBe(true);
    expect(UNCONFIRMED_PATTERN.test('this point is unconfirmed')).toBe(true);
  });
});

describe('a plain name for every shared line and built point', () => {
  const unnamed = (lines: Record<string, unknown>) =>
    Object.keys(lines).filter((k) => !(k in LANDMARKS) && !LINE_NAMES[k]);
  it('no shared line is left with only its internal id', () => {
    expect(unnamed(LINES)).toEqual([]);
  });
  it('a new line without a name is caught (planted)', () => {
    expect(unnamed({ ...LINES, NewLine: { kind: 'line', a: 'S', b: 'N' } })).toEqual(['NewLine']);
  });
  it('no name is given to something that is not a shared line', () => {
    expect(Object.keys(LINE_NAMES).filter((k) => !(k in LINES))).toEqual([]);
  });
});

describe('a measurement definition is built from what the app computes', () => {
  it('SNA: words, points in the order the computation uses them, its source', () => {
    const d = measurementDefinition('m01_SNA');
    expect(d.what).toBe('Angle at N between S and A');
    expect(d.points.map((p) => p.id)).toEqual(['S', 'N', 'A']);
    expect(d.points[0].name).toBe(LANDMARKS.S.name);
    expect(d.lines).toEqual([]);
    expect([d.mark, d.cite, d.notChecked]).toEqual(['P', 'Steiner 1953', false]);
    expect(d.markWords).toBe(MARK_WORDS.P);
  });
  it('a line-based measurement lists its named lines (FMA, tangent: FH and the lower-border tangent)', () => {
    const d = measurementDefinition('m22_FHMPt');
    expect(d.lines.map((l) => l.name)).toEqual(expect.arrayContaining([LINE_NAMES.FH, LINE_NAMES.MPt]));
    expect(d.points.map((p) => p.id)).toEqual(expect.arrayContaining(['Po', 'Or', 'Tg', 'Me']));
  });
  it('the points listed are exactly the points the computation needs (no more, no fewer)', async () => {
    const { compile } = await import('@ceph/geometry');
    const { buildRegistry } = await import('./registry');
    const { ALL_ANALYSES } = await import('./analyses');
    const g = compile(buildRegistry(ALL_ANALYSES));
    for (const e of CATALOGUE.filter((x) => !x.retired)) {
      expect(measurementDefinition(e.id).points.map((p) => p.id).sort()).toEqual([...g.requiredLandmarks(e.id)].sort());
    }
  });
  it('the sign rule is shown only when the plain words do not already say it (#3, #18, and the owner\'s 12 Oct words #8, #9, #71, #72)', () => {
    for (const id of ['m03_ANB', 'm18_PogNB', 'm08_ANperp', 'm09_PogNperp', 'm71_ULE', 'm72_LLE']) expect(measurementDefinition(id).plus).toBeNull();
    const fa = measurementDefinition('m30_FacAxisR');                   // its sign ('above 90° …') is not in its words
    expect(fa.plus).toBe(PLUS_WORDS['30']);
    expect(fa.plus).toMatch(/90/);
    expect(fa.what).not.toMatch(/90/);
  });
  it('a second-hand entry is marked not checked against the original', () => {
    const d = measurementDefinition('m46_U1NAmm');
    expect([d.mark, d.notChecked]).toEqual(['S', true]);
    expect(d.markWords).toMatch(/not checked against the original/);
  });
});

describe('a point definition', () => {
  it('a point the appendix defines', () => {
    expect(pointDefinition('S')).toEqual({ id: 'S', name: 'Sella', definition: 'Geometric centre of the pituitary fossa', definitionSource: APPENDIX_POINT_SOURCE, source: LANDMARKS.S.source, unconfirmed: false });
  });
  it('a point the appendix does not define, and Miyashita does not define either (owner question, Task 8): name and source only', () => {
    const d = pointDefinition('PTM');
    expect([d.definition, d.definitionSource, d.unconfirmed]).toEqual([null, null, false]);
    expect(d.name).toBe(LANDMARKS.PTM.name);
  });
  it('the words for "no definition yet" are one constant', () => expect(DEFINITION_TO_COME).toBe('Definition to come.'));
  it('an unconfirmed point says so', () => {
    expect(pointDefinition('U6').unconfirmed).toBe(true);
  });
});

/** Words that belong to the code, not to a clinician: expression kinds, internal ids, ruling codes (ruling T2-1). */
const REG = buildRegistry(ALL_ANALYSES);
/** Ids of built nodes that are not already screen vocabulary (FH, SN, PTV are both an id and a clinical name). */
const ON_SCREEN = new Set([...Object.values(WHAT), ...Object.values(LINE_NAMES)].flatMap((t) => t.split(/[^A-Za-z0-9_]+/)));
const INTERNAL_IDS = new Set(Object.keys(REG).filter((k) => REG[k].kind !== 'landmark' && !ON_SCREEN.has(k)));
function devTerms(text: string): string[] {
  const vocab = /\b(angle3|angleLines|signedDistance|supplementSigned|withSign|parallelThrough|offsetPoint|projection|unsigned|caps|expr|helper|node|registry|positiveAlong)\b|\(C\d+\)/gi;
  const tags = /\([A-Z]+(?:-[A-Z0-9]+)*-\d+\)/g;   // owner-ruling tags like (NUS-OP-1); case-exact (review M-2)
  const hits = [...text.matchAll(vocab), ...text.matchAll(tags)].map((m) => m[0]);
  for (const tok of text.split(/[^A-Za-z0-9_]+/)) if (INTERNAL_IDS.has(tok)) hits.push(tok);
  return hits;
}
const LIVE = CATALOGUE.filter((x) => !x.retired);
const LINE_KINDS = new Set(['line', 'perpendicular', 'parallelThrough']);
const POINT_KINDS = new Set(['midpoint', 'intersection', 'projection', 'offsetPoint', 'xiPoint']);

describe('which way is plus: one screen-ready rule per signed entry (ruling T2-1, review I-1)', () => {
  it('every entry with a sign has exactly one of: sign already in its words, or screen words for it — and nothing else does', () => {
    const signed = [...new Set(LIVE.filter((e) => e.sign).map((e) => e.no))].sort();
    const inWhat = Object.keys(PLUS_IN_WHAT), words = Object.keys(PLUS_WORDS);
    expect([...inWhat, ...words].sort()).toEqual(signed);
    expect(inWhat.filter((n) => words.includes(n))).toEqual([]);
  });
  it('an entry marked "sign already in the words" really carries that phrase in its words', () => {
    for (const [no, phrase] of Object.entries(PLUS_IN_WHAT)) expect(WHAT[no], `#${no}`).toContain(phrase);
  });
  it('plus is exactly the screen words, or null when the words carry the sign', () => {
    for (const e of LIVE) expect(measurementDefinition(e.id).plus, e.id).toBe(PLUS_WORDS[e.no] ?? null);
  });
  it('no sign or construction text on screen uses developer words or internal ids', () => {
    const shown = [...Object.values(PLUS_WORDS), ...Object.values(CONSTRUCTION).filter((x): x is string => !!x)];
    expect(shown.length).toBeGreaterThan(0);
    for (const t of shown) expect(devTerms(t), t).toEqual([]);
  });
  it('the developer-word check catches what the old sign fields showed (positive control: #88, #61, #68)', () => {
    expect(devTerms(byId('m88_STConvexity').sign!)).toEqual(expect.arrayContaining(['angle3', 'unsigned', 'caps']));
    expect(devTerms(byId('m61_CantOP').sign!)).toEqual(expect.arrayContaining(['MInc', 'M6']));
    expect(devTerms(byId('m68_Overjet').sign!)).toEqual(['(NUS-OP-1)']);   // was (C7) until NUS-OP-1 (16 Oct)
    // Review M-2 (16 Oct): capitalised developer words are caught too (the check is case-blind for words, exact for tags).
    expect(devTerms('Projection of A onto the Node')).toEqual(['Projection', 'Node']);
    expect(devTerms('a plane (see C7) and (NUS-OP-1)')).toEqual(['(NUS-OP-1)']);
  });
  // Review M-1 (16 Oct): the source shown as "Source and mark" carries no ruling tags either.
  it('no source shown on screen carries a ruling tag like (C7) or NUS-OP-1', () => {
    const tag = /\(C\d+\)|\b[A-Z]+(?:-[A-Z0-9]+)*-\d+\b/;
    for (const e of LIVE) expect(e.source.cite, e.id).not.toMatch(tag);
  });
});

describe('lines, built points and construction notes (ruling T2-2, review I-2)', () => {
  it('lines are named shared lines only; built points are named constructed points', () => {
    for (const e of LIVE) {
      const d = measurementDefinition(e.id);
      for (const l of d.lines) expect(LINE_KINDS.has(REG[l.id].kind) && l.name === LINE_NAMES[l.id], `${e.id} ${l.id}`).toBe(true);
      for (const p of d.builtPoints) expect(POINT_KINDS.has(REG[p.id].kind) && p.name === LINE_NAMES[p.id], `${e.id} ${p.id}`).toBe(true);
    }
  });
  it('FH and FH_post, reached both ways in #14 APDI, are listed once (review I-3)', () => {
    const d = measurementDefinition('m14_APDI');
    expect(d.lines.filter((l) => l.name === LINE_NAMES.FH)).toHaveLength(1);
    expect(d.lines.map((l) => l.id)).toEqual(expect.arrayContaining(['NPog', 'AB', 'MxP']));
    expect(d.lines.some((l) => l.id.startsWith('PalKim'))).toBe(false);
    expect(d.construction.join(' ')).toMatch(/PNS parallel to FH/);
  });
  it('constructed points are listed as built points, not lines (#30 constructed gnathion, #60 molar and incisor overlap, #33 Xi)', () => {
    expect(measurementDefinition('m30_FacAxisR').builtPoints.map((p) => p.id)).toEqual(['GncR']);
    expect(measurementDefinition('m60_OPSN').builtPoints.map((p) => p.id).sort()).toEqual(['M6', 'MInc']);
    expect(measurementDefinition('m33_MandBend').builtPoints.map((p) => p.id)).toEqual(['Xi']);
    expect(measurementDefinition('m30_FacAxisR').lines.some((l) => l.id === 'GncR')).toBe(false);
  });
  it('private helpers read as plain construction notes (#13 AO/BO, #77 the point below A, #70a the molar point)', () => {
    expect(measurementDefinition('m13_Wits').construction.join(' ')).toMatch(/AO and BO/);
    expect(measurementDefinition('m77_BasicUL').construction.join(' ')).toMatch(/3 mm below A/);
    expect(measurementDefinition('m70a_U6NA').construction.join(' ')).toMatch(/mesial/);
    expect(measurementDefinition('m01_SNA').construction).toEqual([]);
  });
  it('every line, point or helper the computation reaches is named somewhere on screen, or marked as told by the words', () => {
    const unnamed: string[] = [];
    for (const e of LIVE) {
      const d = measurementDefinition(e.id), seen = new Set<string>();
      const names = new Set(d.lines.map((l) => l.name)), built = new Set(d.builtPoints.map((p) => p.id));
      const walk = (n: string) => {
        if (seen.has(n)) return; seen.add(n);
        const x = REG[n];
        if (x.kind === 'landmark') return;
        const ok = n in CONSTRUCTION || built.has(n) || names.has(LINE_NAMES[n]) || (n !== e.id && LIVE.some((c) => c.id === n)) || n === e.id;
        if (!ok) unnamed.push(`${e.id}: ${n}`);
        exprRefs(x).forEach(walk);
      };
      walk(e.id);
    }
    expect(unnamed).toEqual([]);
  });
  it('every construction key is a real node, and every note is reached by some measurement', () => {
    const reached = new Set(LIVE.flatMap((e) => measurementDefinition(e.id).construction));
    for (const [k, note] of Object.entries(CONSTRUCTION)) {
      expect(REG[k], k).toBeDefined();
      if (note) expect(reached.has(note), k).toBe(true);
    }
  });
});

describe('Task 2 follow-ups (owner approved 12 Oct)', () => {
  const W62 = '+ when the lower incisor crown tips forward (labially) of a right angle to the occlusal plane; − when it tips back (Downs 1948, p. 151)';
  it('#62 shows the owner\'s sign rule as a plain sign rule, no longer an in-words phrase', () => {
    expect(PLUS_WORDS['62']).toBe(W62);
    expect(PLUS_IN_WHAT['62']).toBeUndefined();
    expect(measurementDefinition('m62_L1OPdev').plus).toBe(W62);
  });
  it('there are 15 plain sign rules', () => expect(Object.keys(PLUS_WORDS)).toHaveLength(15));

  const OWNER_NOTES: Record<string, string> = {
    m31_FacAxisM: '90° is the balanced reference (McNamara).',
    m56_IMPAt: "Shown as the raw angle; Downs wrote it as degrees above or below 90. Tweed's triangle: FMA + IMPA + FMIA = 180.",
    m58_FMIA: "Tweed's triangle: FMA + IMPA + FMIA = 180.",
    m19_U6PTV: "The sign direction is the app's choice; the source gives none.",
  };
  it('NOTE-1: the four owner-approved notes reach the definition, word for word', () => {
    for (const [id, note] of Object.entries(OWNER_NOTES)) expect(measurementDefinition(id).note, id).toBe(note);
  });
  it('NOTE-1: every other measurement has no note, and every note key is a live catalogue number', () => {
    const withNote = LIVE.filter((e) => measurementDefinition(e.id).note !== undefined).map((e) => e.id).sort();
    expect(withNote).toEqual(Object.keys(OWNER_NOTES).sort());
    for (const no of Object.keys(NOTES)) expect(LIVE.some((e) => e.no === no), `#${no}`).toBe(true);
  });
});
