import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AUTO_CHOICE_ID, choiceFacts, loadSets, normChoices, POPULATIONS, type NormQuery } from '@ceph/analyses';
import { NormChooser } from './NormChooser';
import { rewordUnstatedScale } from './normCell';

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

// Owner N-A2/N-A5 (19 Oct 2026): Auto first, marked ◆; the source in use marked aria-current — a stored pick that is
// still offered, else Auto. Eastman SNA under Saudi: Saudi has no SNA, Eastman's own norm does (Auto).
describe('NormChooser: Auto', () => {
  const inUse = (out: string) => (out.match(/<li class="norm-choice" aria-current="true">[\s\S]*?<\/li>/g) ?? []);
  it('no pick: ◆ Auto first and in use, the only one marked', () => {
    const out = renderToStaticMarkup(<NormChooser q={q} decimals={1} onPick={() => {}} onClose={() => {}} />);
    expect(normChoices(q)[0].id).toBe(AUTO_CHOICE_ID);
    expect(out).toMatch(/^<div[^>]*><ul><li class="norm-choice" aria-current="true"><span class="norm-auto-mark" aria-hidden="true">◆<\/span> <button[^>]*>Auto · Eastman&#x27;s own norm \(no Saudi norm\)<\/button>/);
    expect([inUse(out).length, (out.match(/◆/g) ?? []).length]).toEqual([1, 1]);
  });
  it('a stored pick still offered is in use; Auto stays first, not in use', () => {
    const out = renderToStaticMarkup(<NormChooser q={{ ...q, picks: { saudi: { m01_SNA: 'chinese' } } }} decimals={1} onPick={() => {}} onClose={() => {}} />);
    expect(inUse(out)).toHaveLength(1);
    expect(inUse(out)[0]).toContain('>Chinese</button>');
    expect(out.indexOf('◆')).toBeLessThan(out.indexOf('>Chinese</button>'));
  });
  it('a stale pick: Auto in use', () => {
    const out = renderToStaticMarkup(<NormChooser q={{ ...q, picks: { saudi: { m01_SNA: 'user:Gone' } } }} decimals={1} onPick={() => {}} onClose={() => {}} />);
    expect(inUse(out)[0]).toContain('Auto · ');
  });
  // Review I-1 (fix round 1, 24 Oct 2026): a candidate's hover is the resolver's raw Resolved.sourceLine
  // (c.resolved.sourceLine), bypassing normCell's rewordUnstatedScale — the one place that applies owner ruling
  // Q-B. Steiner's U1–NA (mm) under its own norm is scale-assumed (Steiner's own film-scale caveat), so opening
  // this row's chooser showed the pre-Q-B sentence. Real committed set, production normChoices.
  it('Q-B (fix round 1): a candidate whose source line carries the unstated-scale clause shows it reworded on hover', () => {
    const qq: NormQuery = { ...q, measurement: 'm46_U1NAmm', analysisId: 'steiner' };
    const own = normChoices(qq).find((c) => c.resolved.flags.includes('scale-assumed'));
    expect(own).toBeDefined();
    const line = own!.resolved.sourceLine;
    expect(line).toContain('film scale not stated in the paper');   // the resolver's own words, untouched
    const out = renderToStaticMarkup(<NormChooser q={qq} decimals={1} onPick={() => {}} onClose={() => {}} />);
    expect(out).toContain(rewordUnstatedScale(line).replace(/'/g, '&#x27;'));
    expect(out).not.toContain('film scale not stated in the paper');
  });
  it('AUTO-Q11 (only your own norm has it, so no Auto entry): no ◆ and nothing marked', () => {
    const qq = { ...q, measurement: 'm18_PogNB', analysisId: 'steiner', sets: q.sets.filter((s) => !s.entries.some((e) => e.measurement === 'm18_PogNB')),
      userNorms: [{ ...mine, measurement: 'm18_PogNB' }] };
    const out = renderToStaticMarkup(<NormChooser q={qq} decimals={1} onPick={() => {}} onClose={() => {}} />);
    expect([out.includes('◆'), inUse(out).length, normChoices(qq).length > 0]).toEqual([false, 0, true]);
  });
});
