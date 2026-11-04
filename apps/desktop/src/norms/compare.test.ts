import { describe, it, expect } from 'vitest';
import { loadSets, resolveNorm } from '@ceph/analyses';
import { DEFAULT_DECIMALS } from '../format';
import { normCell, queryFor } from './normCell';
import { compareCells, parseCompare, populationOptions, readCompare, ticksAfterRead } from './compare';

const sets = loadSets();
const ctx = { sets, userNorms: [], clinicDefault: null };
const doc = { population: null, gender: 'M' as const, dateOfBirth: '2000-01-02', takenOn: '2026-01-10' };   // SYNTHETIC
const sna = { analysis: 'Steiner', analysisId: 'steiner', normAnalysisId: 'steiner', node: 'm01_SNA', label: 'SNA', unit: 'deg' as const, value: '84.0°', num: 84, hidden: false, needs: [], undefinedReason: null };
describe('the population picker', () => {
  it('first the clinic default, saying what it is; then every population with a usable set', () => {
    const o = populationOptions(sets, [], 'chinese');
    expect(o[0]).toEqual({ value: '', label: 'Clinic default (Chinese)' });
    expect(o.map((x) => x.value)).toEqual(expect.arrayContaining(['chinese', 'caucasian', 'analysis-own']));
  });
  it('no clinic default: the analysis\'s own norms', () => {
    expect(populationOptions(sets, [], null)[0].label).toBe("Clinic default (each analysis's own norms)");
  });
});
describe('compare populations (master plan §9: 2–4 side by side)', () => {
  it('one cell per population, each from its own set', () => {
    const [r] = compareCells([sna], ['chinese', 'caucasian'], doc, ctx);
    expect(r.cells).toHaveLength(2);
    expect(r.cells[0].sourceLine).not.toBe(r.cells[1].sourceLine);
  });
  it('the stored choice keeps only offered populations, at most 4', () => {
    expect(parseCompare('["x","chinese","malay","saudi","swedish","japanese"]', ['chinese', 'malay', 'saudi', 'swedish', 'japanese'])).toEqual(['chinese', 'malay', 'saudi', 'swedish']);
    expect(parseCompare('{', ['chinese'])).toEqual([]);
  });
  it('a hidden mm value is never coloured in the comparison', () => {
    const pog = { ...sna, node: 'm18_PogNB', label: 'Pog to NB (mm)', unit: 'mm' as const, value: null, num: null, hidden: true };
    expect(compareCells([pog], ['chinese'], doc, ctx)[0].cells[0].band).toBeNull();
  });

  // Fix round 1, ruling T11-2: the construct itself is pinned, not just that two populations differ.
  // A compare cell must equal exactly what the Inspector would show for a case actually SET to that population —
  // same text, colour, badges, hint and source line — across sex recorded/unknown and age entered/not entered,
  // so SEX-AVG-1 and AGE-UNK-1 are both exercised, not just the plain path.
  type Doc = { population: string | null; gender: 'M' | 'F' | null; dateOfBirth: string | null; takenOn: string | null };
  const docCases: Array<[string, Doc]> = [
    ['sex M, age entered', doc],
    ['sex unknown (SEX-AVG-1)', { ...doc, gender: null }],
    ['age not entered (AGE-UNK-1)', { ...doc, dateOfBirth: null, takenOn: null }],
  ];
  const pops = ['chinese', 'caucasian', 'swedish', 'malay'];
  it('T11-2: every compare cell equals the Inspector\'s own cell for a case set to that population', () => {
    let compared = 0;
    for (const [, d] of docCases) {
      for (const p of pops) {
        const [r] = compareCells([sna], [p], d, ctx);
        const q = queryFor(sna.node, sna.normAnalysisId, { ...d, population: p }, ctx);
        const expected = normCell(sna.num, resolveNorm(q), q, DEFAULT_DECIMALS);
        expect(r.cells[0]).toEqual(expected);
        compared++;
      }
    }
    expect(compared).toBe(docCases.length * pops.length);   // 12: every row actually compared, not a loop that ran zero times
  });

  // Owner NORM-PICK-1 (12 Oct): each ticked population's cell asks for (and keeps) its OWN choice. Eastman has no own
  // norm and Saudi has no SNA in the committed sets, so Eastman SNA under Saudi needs a choice.
  it('NORM-PICK-1: a population with nothing asks for a choice for itself; a pick saved for it is used under its heading only', () => {
    const e = { ...sna, analysis: 'Eastman', analysisId: 'eastman', normAnalysisId: 'eastman' };
    const [r] = compareCells([e], ['saudi', 'chinese'], doc, ctx);
    expect([r.cells[0].text, r.cells[0].choose, r.cells[1].choose]).toEqual(['no Saudi norm — choose one', { population: 'saudi' }, null]);
    const picks = { saudi: { m01_SNA: 'caucasian' } };
    const [p] = compareCells([e], ['saudi', 'chinese'], doc, ctx, DEFAULT_DECIMALS, picks);
    expect([p.cells[0].badges.map((b) => b.flag), p.cells[0].choose, p.cells[1].badges.some((b) => b.flag === 'chosen-by-you')])
      .toEqual([['chosen-by-you'], { population: 'saudi' }, false]);
    // The same as the Inspector shows for a case set to Saudi with that pick (T11-2's construct, with picks).
    const q = queryFor(e.node, e.normAnalysisId, { ...doc, population: 'saudi' }, ctx, picks);
    expect(p.cells[0]).toEqual(normCell(e.num, resolveNorm(q), q, DEFAULT_DECIMALS));
  });
});

// Final review M-10: the stored tick-list is read once on open. A failed read was swallowed, and a tick made before the
// read came back was overwritten by it.
describe('compare: reading the stored ticks (M-10)', () => {
  it('a failed read is a sentence, never swallowed; the ticks start empty', async () => {
    const r = await readCompare({ get: async () => { throw new Error('SYNTHETIC disk error'); } }, ['chinese']);
    expect(r).toEqual({ value: [], error: 'Your compare choice could not be read (SYNTHETIC disk error).' });
  });
  it('a good read gives the offered ticks', async () => {
    expect(await readCompare({ get: async () => '["chinese","x"]' }, ['chinese'])).toEqual({ value: ['chinese'], error: null });
  });
  it('a tick made before the read returned is kept: the read never overwrites it', () => {
    expect(ticksAfterRead(true, ['malay'], ['chinese', 'saudi'])).toEqual(['malay']);
    expect(ticksAfterRead(false, [], ['chinese', 'saudi'])).toEqual(['chinese', 'saudi']);
  });
});
