import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { choiceFacts, loadSets, normChoices, POPULATIONS, type NormQuery } from '@ceph/analyses';
import { NormChooser } from './NormChooser';

// Owner NORM-PICK-1: the list offered behind "no <population> norm — choose one" — every source that has the
// measurement, each with its value and the n and ages of the row used, all from the resolver (normChoices), never retyped.
const sets = loadSets();
const mine = { setName: 'SYNTHETIC Mine', measurement: 'm01_SNA', mean: 80, sd: 2, sourceNote: 'SYNTHETIC sample' };
const q: NormQuery = { measurement: 'm01_SNA', analysisId: 'eastman', population: 'saudi', clinicDefault: null, sex: 'M', ageYears: 30, sets, userNorms: [mine] };

describe('NormChooser', () => {
  it('lists every choice the resolver gives, each with its value, n and ages', () => {
    const choices = normChoices(q);
    expect(choices.length).toBeGreaterThan(2);   // positive control: Eastman SNA under Saudi really has several sources
    const out = renderToStaticMarkup(<NormChooser q={q} decimals={1} onPick={() => {}} onClose={() => {}} />);
    for (const c of choices) expect(out).toContain(c.label.replace(/'/g, '&#x27;'));
    expect(out).toContain('80.0 ± 2.0°');                          // the user norm's value, through normText
    expect(out).toContain('sexes pooled, n not stated · ages not stated');      // a user norm states neither
    // FR-1: the facts are the row's (choiceFacts), never the whole study's.
    for (const c of choices) expect(out).toContain(choiceFacts(c).replace(/'/g, '&#x27;'));
    expect(out).toContain(POPULATIONS.find((p) => p.id === 'chinese')!.label);
    expect((out.match(/class="norm-choice"/g) ?? []).length).toBe(choices.length);
  });
});
