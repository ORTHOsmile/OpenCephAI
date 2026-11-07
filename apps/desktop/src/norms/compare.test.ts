import { describe, it, expect } from 'vitest';
import { loadSets, resolveNorm, type PopulationChoice } from '@ceph/analyses';
import { DEFAULT_DECIMALS } from '../format';
import { normCell, queryFor } from './normCell';
import { autoOptionLabel, compareCells, parseCompare, populationOptions, readCompare, ticksAfterRead } from './compare';

const sets = loadSets();
const ctx = { sets, userNorms: [], clinicDefault: null };
const doc = { population: null, gender: 'M' as const, dateOfBirth: '2000-01-02', takenOn: '2026-01-10' };   // SYNTHETIC
const sna = { analysis: 'Steiner', analysisId: 'steiner', normAnalysisId: 'steiner', node: 'm01_SNA', label: 'SNA', unit: 'deg' as const, value: '84.0°', num: 84, hidden: false, needs: [], undefinedReason: null };
describe('the population picker', () => {
  // Owner decision 3 (29 Oct 2026): Auto first; the old "Clinic default (…)" entry only while the case holds NULL.
  it('on a case on "Clinic default": Auto, then the clinic default saying what it is, then every population with a usable set', () => {
    const o = populationOptions(sets, [], 'chinese', null, null);
    expect(o[0].value).toBe('auto');
    expect(o[1]).toEqual({ value: '', label: 'Clinic default (Chinese)' });
    expect(o.map((x) => x.value)).toEqual(expect.arrayContaining(['chinese', 'caucasian', 'analysis-own']));
  });
  it('no clinic default: the analysis\'s own norms', () => {
    expect(populationOptions(sets, [], null, null, null)[1].label).toBe("Clinic default (each analysis's own norms)");
  });
});
describe('owner decision 3 (29 Oct 2026): Auto in the chooser', () => {
  const choice = (o: Partial<PopulationChoice>): PopulationChoice => ({ population: 'swedish', how: 'best-evidence', setId: 'thilander2005', ageCovered: true, label: 'Swedish', ...o });
  // Owner ruling 7 Nov 2026: an Indian or Malay background says on screen which norms it uses.
  it('an aliased background says which norms Auto uses, in the chooser and in the population list', () => {
    // Malay has its own studies (owner answer B, 7 Nov 2026: Chinese only where they have no row).
    expect(autoOptionLabel(choice({ population: 'malay', how: 'background' }), sets, [])).toBe("Auto — Malay (patient's background)");
    // Owner answer C: the Auto option names the norms, never the recorded background; the list still offers Indian.
    expect(autoOptionLabel(choice({ population: 'indian', how: 'background' }), sets, [])).toBe("Auto — Caucasian (patient's background; population rule)");
    expect(populationOptions(sets, [], null, 'auto', null).map((o) => o.label)).toContain('Indian (Caucasian norms, population rule)');
  });
  it('Auto first, saying what it chose and why', () => {
    expect(autoOptionLabel(choice({}), sets, [])).toBe('Auto — Swedish (largest study for this sex and age)');
    expect(autoOptionLabel(choice({ ageCovered: false }), sets, [])).toBe('Auto — Swedish (largest study for this sex, nearest age)');
    expect(autoOptionLabel(choice({ population: 'chinese', how: 'background' }), sets, [])).toBe("Auto — Chinese (patient's background)");
    expect(autoOptionLabel(choice({ population: 'caucasian', how: 'clinic-default' }), sets, [])).toBe('Auto — Caucasian (clinic default)');
    expect(autoOptionLabel(choice({ population: 'analysis-own', how: 'clinic-default' }), sets, [])).toBe("Auto — each analysis's own norms (clinic default)");
    expect(autoOptionLabel(choice({ population: 'user:Mine', how: 'clinic-default' }), sets, [{ setName: 'Mine', measurement: 'm01_SNA', mean: 82, sd: 3, sourceNote: 'SYNTHETIC' }])).toBe('Auto — Mine (your norms) (clinic default)');
    expect(autoOptionLabel(choice({ population: null, how: 'none' }), sets, [])).toBe("Auto — each analysis's own norms (nothing to choose from)");
    // Owner R1/R5 (3 Nov 2026; spec 2026-11-03 §8.2).
    expect(autoOptionLabel(choice({ population: 'combined-adult', how: 'combined', setId: null, label: 'combined adult' }), sets, [])).toBe('Auto — combined adult norm (no background or clinic default)');
  });
  it('the "Clinic default" entries: the undo on a switched case, the old entry on a NULL case, none on a new case', () => {
    const onAuto = populationOptions(sets, [], 'chinese', 'auto', choice({})).map((o) => o.value);
    expect(onAuto[0]).toBe('auto');
    expect(onAuto).not.toContain('');
    const switched = populationOptions(sets, [], 'chinese', 'auto', choice({}), true);
    expect(switched[1]).toEqual({ value: '', label: 'Clinic default (as before the upgrade)' });
    const old = populationOptions(sets, [], 'chinese', null, choice({}));
    expect(old.slice(0, 2).map((o) => [o.value, o.label])).toEqual([['auto', 'Auto — Swedish (largest study for this sex and age)'], ['', 'Clinic default (Chinese)']]);
    expect(populationOptions(sets, [], 'chinese', 'japanese', choice({}), false).map((o) => o.value)).not.toContain('');
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

  // Ruling AUTO-Q7 (19 Oct 2026): Eastman's SNA under Saudi (Saudi has no SNA): the Saudi column shows "—",
  // uncoloured, no tag, no choice — not Eastman's own norm, not a pick; the Chinese column is exactly the Inspector's.
  it('AUTO-Q7: a population with no norm of its own shows "—"; one with its own norm shows it as the Inspector would', () => {
    const e = { ...sna, analysis: 'Eastman', analysisId: 'eastman', normAnalysisId: 'eastman' };
    const [r] = compareCells([e], ['saudi', 'chinese'], doc, ctx);
    expect([r.cells[0].text, r.cells[0].band, r.cells[0].badges, r.cells[0].choose]).toEqual(['—', null, [], null]);
    const q = queryFor(e.node, e.normAnalysisId, { ...doc, population: 'chinese' }, ctx);
    expect(r.cells[1]).toEqual(normCell(e.num, resolveNorm(q), q, DEFAULT_DECIMALS));
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
