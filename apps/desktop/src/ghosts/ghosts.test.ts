import { describe, expect, it } from 'vitest';
import { extraOutcome, ghostLabel, ghostsFrom, mainSuggestions, readyOtherIds, showAllState, upgradeHidden, visibleGhosts } from './ghosts';
import type { ExtraResult, ModelPoints, ModelRow } from '../ipc';
const row = (id: string, status: ModelRow['status'], main = false) => ({ id, title: id.toUpperCase(), status, main } as ModelRow);
const mp = (modelId: string, x: number): ModelPoints => ({ modelId, ranAt: 't', facing: 'right',
  points: [{ channel: 0, landmarkId: 'S', x, y: 10, peak: 1 }, { channel: 19, landmarkId: null, x: 1, y: 1, peak: 1 }] });
describe('ghostsFrom', () => {
  it('shows the Ready extra models only, mapped points only, one shade each in catalogue order', () => {
    const rows = [row('cwl', 'ready', true), row('gu2', 'ready'), row('srp', 'ready'), row('old', 'not-installed')];
    const g = ghostsFrom([mp('cwl', 1), mp('gu2', 2), mp('srp', 3), mp('old', 4)], rows);
    expect(g.map((x) => [x.modelId, x.shade])).toEqual([['gu2', 1], ['srp', 2]]);
    expect(g[0].points).toEqual({ S: { x: 2, y: 10 } });
  });
  it('draws no ghosts for a model that couldn\u2019t read this film, even if an older run is stored (spec Part 4)', () => {
    const rows = [row('cwl', 'ready', true), row('gu2', 'ready'), row('srp', 'ready')];
    expect(ghostsFrom([mp('gu2', 2), mp('srp', 3)], rows, ['SRP']).map((g) => g.modelId)).toEqual(['gu2']);
  });
  // Task 12 (MODEL-LIMIT-1, rulings T12-1, T12-2): an extra model past its time limit, or still busy with an earlier film.
  const ex = (title: string, over: Partial<ExtraResult>): ExtraResult => ({ modelId: title.toLowerCase(), title, detection: null, error: null, timedOut: false, ...over });
  const late = ex('GU2', { error: 'GU2 took longer than 15 s on this film; its points were not used.', timedOut: true });
  const busy = ex('GU2', { error: 'GU2 is still busy with an earlier film; its points are not used on this one.', timedOut: true });
  const broke = ex('SRP', { error: 'SRP couldn\u2019t read this film: SYNTHETIC' });
  const fine = ex('OK', { detection: {} as ExtraResult['detection'] });
  it('a timed-out (or still busy) model draws none of its earlier stored ghosts on this film', () => {
    const rows = [row('cwl', 'ready', true), row('gu2', 'ready'), row('srp', 'ready')];
    for (const x of [late, busy]) expect(ghostsFrom([mp('gu2', 2), mp('srp', 3)], rows, extraOutcome([x]).failed).map((g) => g.modelId)).toEqual(['srp']);
  });
  it('the case panel gets whole sentences: the timed-out or busy one as Rust wrote it, an error as the short sentence', () => {
    expect(extraOutcome([late, broke, fine, busy])).toEqual({
      errors: ['GU2 took longer than 15 s on this film; its points were not used.', "SRP couldn't read this film.",
        'GU2 is still busy with an earlier film; its points are not used on this one.'],
      failed: ['GU2', 'SRP', 'GU2'] });
    expect(extraOutcome([])).toEqual({ errors: [], failed: [] });
  });
  it('draws nothing for a model with no stored run', () => {
    expect(ghostsFrom([], [row('gu2', 'ready')])).toEqual([]);
  });
});
describe('the main model\'s own over-2-mm points (owner ruling R-B2, 7 Oct: above the gate a point is a ghost suggestion only)', () => {
  const rows = [row('srp', 'ready', true), row('gu2', 'ready')];
  const mainRun: ModelPoints = { modelId: 'srp', ranAt: 't', facing: 'right', points: [{ channel: 0, landmarkId: 'S', x: 5, y: 10, peak: 1 },
    { channel: 1, landmarkId: 'U1A', x: 7, y: 8, peak: 1 }, { channel: 2, landmarkId: null, x: 1, y: 1, peak: 1 }] };
  it('shows the main model\'s stored point for exactly the ids it was not allowed to place, and nothing else of it', () => {
    const g = ghostsFrom([mainRun, mp('gu2', 2)], rows, [], ['U1A']);
    expect(g.map((x) => x.modelId)).toEqual(['srp', 'gu2']);
    expect(g[0].points).toEqual({ U1A: { x: 7, y: 8 } });
    expect(g[0].title).toBe('SRP');
  });
  it('without such ids the main model is still never a ghost', () => {
    expect(ghostsFrom([mainRun, mp('gu2', 2)], rows).map((x) => x.modelId)).toEqual(['gu2']);
  });
  const table = [{ modelId: 'srp', title: 'SRP', main: true, points: [{ id: 'S', status: { kind: 'original' } }, { id: 'U1A', status: { kind: 'tooFar', mre: 2.3, n: 150, dataset: 'aariz' } },
    { id: 'L6', status: { kind: 'tooFar', mre: 3.4, n: 150, dataset: 'aariz' } }, { id: 'Ba', status: { kind: 'notScored' } }] },
    { modelId: 'gu2', title: 'GU2', main: false, points: [{ id: 'U1A', status: { kind: 'tooFar', mre: 9, n: 1, dataset: 'aariz' } }] }] as any;
  it('suggests the main model\'s tooFar ids that no AI placement covers; a point placed by hand keeps its suggestion', () => {
    expect(mainSuggestions(table, {})).toEqual(['U1A', 'L6']);
    expect(mainSuggestions(table, { L6: { source: 'ai' } as any })).toEqual(['U1A']);
    expect(mainSuggestions(table, { L6: { source: 'ai-adjusted' } as any, U1A: { source: 'manual' } as any })).toEqual(['U1A']);
  });
  it('no table, or no main row: no suggestions', () => {
    expect(mainSuggestions(null, {})).toEqual([]);
    expect(mainSuggestions([table[1]], {})).toEqual([]);
  });
});
describe('ghostLabel (owner, 5 Oct, Task C: names the point, not just "your point"; owner 6 Oct, item S: a marker for an assumed scale)', () => {
  it('a calibrated case: "=" and mm, from the point’s name and id', () => {
    expect(ghostLabel('GU2Net', { x: 3, y: 4 }, { x: 0, y: 0 }, 0.1, 'S', 'Sella', false, 1)).toBe('GU2Net: =0.5 mm from Sella (S)');
  });
  it('an uncalibrated case (no ruler — assumed scale): "≈" instead of "=", NOT a separate "assumed scale" note', () => {
    expect(ghostLabel('GU2Net', { x: 3, y: 4 }, { x: 0, y: 0 }, 0.1, 'S', 'Sella', true, 1)).toBe('GU2Net: ≈0.5 mm from Sella (S)');
  });
  it('shows the id alone when the point has no catalogue name (edge case)', () => {
    expect(ghostLabel('GU2Net', { x: 3, y: 4 }, { x: 0, y: 0 }, 0.1, 'Zz', undefined, false, 1)).toBe('GU2Net: =0.5 mm from Zz');
    expect(ghostLabel('GU2Net', { x: 3, y: 4 }, { x: 0, y: 0 }, 0.1, 'Zz', undefined, true, 1)).toBe('GU2Net: ≈0.5 mm from Zz');
  });
  it('falls back to the model’s title alone when the operator has not placed that point (either scale)', () => {
    expect(ghostLabel('GU2Net', { x: 3, y: 4 }, undefined, 0.1, 'S', 'Sella', false, 1)).toBe('GU2Net');
    expect(ghostLabel('GU2Net', { x: 3, y: 4 }, undefined, 0.1, 'S', 'Sella', true, 1)).toBe('GU2Net');
  });
  // Owner DEC-1 (carried into Task 5): the distance uses the operator's decimals setting through the one shared
  // formatter (format.ts), like every other number on screen — not a hardcoded toFixed(1).
  it('DEC-1: the operator decimals setting reaches the distance (0 decimals: "1 mm", not "0.9 mm")', () => {
    expect(ghostLabel('GU2Net', { x: 9, y: 0 }, { x: 0, y: 0 }, 0.1, 'S', 'Sella', false, 0)).toBe('GU2Net: =1 mm from Sella (S)');
  });
  it('DEC-1: 3 decimals shows the full figure', () => {
    expect(ghostLabel('GU2Net', { x: 3, y: 4 }, { x: 0, y: 0 }, 0.1, 'S', 'Sella', false, 3)).toBe('GU2Net: =0.500 mm from Sella (S)');
  });
});
describe('visibleGhosts (owner, 5 Oct: a tick-box per model, not just one "Show other models")', () => {
  const g1 = { modelId: 'gu2', title: 'GU2Net', shade: 1 as const, points: {} };
  const g2 = { modelId: 'srp', title: 'SRPose', shade: 2 as const, points: {} };
  it('keeps every ghost whose model is not in the hidden set', () => {
    expect(visibleGhosts([g1, g2], new Set())).toEqual([g1, g2]);
  });
  it('drops only the hidden model’s ghost, keeping the other', () => {
    expect(visibleGhosts([g1, g2], new Set(['gu2']))).toEqual([g2]);
  });
  it('drops every ghost when every model is hidden', () => {
    expect(visibleGhosts([g1, g2], new Set(['gu2', 'srp']))).toEqual([]);
  });
});
describe('showAllState ("Show all": all on, all off, or the dash when only some are)', () => {
  const g1 = { modelId: 'gu2', title: 'GU2Net', shade: 1 as const, points: {} };
  const g2 = { modelId: 'srp', title: 'SRPose', shade: 2 as const, points: {} };
  it('reads "all" when nothing is hidden', () => { expect(showAllState([g1, g2], new Set())).toBe('all'); });
  it('reads "none" when every listed model is hidden', () => { expect(showAllState([g1, g2], new Set(['gu2', 'srp']))).toBe('none'); });
  it('reads "some" (the dash) when only one of several is hidden', () => { expect(showAllState([g1, g2], new Set(['gu2']))).toBe('some'); });
  it('reads "all" with no models listed at all (no other models installed)', () => { expect(showAllState([], new Set())).toBe('all'); });
  it('ignores a hidden id for a model not currently listed', () => { expect(showAllState([g1], new Set(['srp']))).toBe('all'); });
});
describe('upgradeHidden (owner’s upgrade rule, 5 Oct: ghosts_hidden replaces ghosts_shown)', () => {
  it('reads the stored ghosts_hidden ids when that setting exists, ignoring the old flag', () => {
    expect(upgradeHidden('["gu2"]', '0', ['gu2', 'srp'])).toEqual(new Set(['gu2']));
    expect(upgradeHidden('[]', '0', ['gu2', 'srp'])).toEqual(new Set());
  });
  it('hides every known model when ghosts_hidden has never been set and the old flag was ‘0’ (today’s "all hidden")', () => {
    expect(upgradeHidden(null, '0', ['gu2', 'srp'])).toEqual(new Set(['gu2', 'srp']));
  });
  it('starts every model shown when ghosts_hidden has never been set and the old flag is unset or ‘1’', () => {
    expect(upgradeHidden(null, null, ['gu2', 'srp'])).toEqual(new Set());
    expect(upgradeHidden(null, '1', ['gu2', 'srp'])).toEqual(new Set());
  });
  it('a model installed later (not in the id list when ghosts_hidden was written) starts shown', () => {
    // ghosts_hidden already holds only the models known at the time it was written/upgraded; a newer model's id
    // is simply absent from it, so it is never in the hidden set.
    expect(upgradeHidden('["gu2"]', '0', ['gu2', 'srp', 'new-model']).has('new-model')).toBe(false);
  });
  it('malformed JSON in ghosts_hidden is treated as no models hidden, not a crash', () => {
    expect(upgradeHidden('not json', '0', ['gu2'])).toEqual(new Set());
  });
});
describe('readyOtherIds (owner, 5 Oct, I4: the upgrade must not hide a model that is not installed yet)', () => {
  it('takes only the non-main, Ready rows — not installing, not failed, not not-installed', () => {
    const rows = [row('cwl', 'ready', true), row('gu2', 'ready'), row('srp', 'installing'), row('old', 'not-installed'), row('bad', 'failed')];
    expect(readyOtherIds(rows)).toEqual(['gu2']);
  });
  it('a model not Ready at upgrade time, installed later, is simply absent here — upgradeHidden then starts it shown', () => {
    const atUpgradeTime = [row('cwl', 'ready', true), row('gu2', 'ready'), row('srp', 'installing')];
    const hidden = upgradeHidden(null, '0', readyOtherIds(atUpgradeTime));   // the old "hide every other model" flag
    expect(hidden).toEqual(new Set(['gu2']));                                // srp was not Ready, so never hidden
    const afterInstall = [row('cwl', 'ready', true), row('gu2', 'ready'), row('srp', 'ready')];
    expect(readyOtherIds(afterInstall).every((id) => !hidden.has(id) || id === 'gu2')).toBe(true);
    expect(hidden.has('srp')).toBe(false);                                  // srp starts shown once installed
  });
});
