import { describe, it, expect } from 'vitest';
import { isFallback, pointLabel, pointWhy } from './pointLabel';
import type { MainPointSource } from './placement';

const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19', CW = 'cwlachap-hrnet-w32';
const titleOf = (m: string) => ({ [AZ]: 'Aariz (CEPHA29, HRNet-W32)', [SR]: 'SRPose (CL-Detection 2023)', 'later-model': 'Later Model' } as Record<string, string>)[m] ?? m;
const table = (over: Partial<MainPointSource> = {}): MainPointSource => ({ ruleVersion: 'main-point-source/1', confirmationPending: true, points: { Go: AZ, S: AZ, PNS: AZ }, ...over });

describe('the label (chain spec §5)', () => {
  it("the placing model's short name; a model not in the list goes by its title", () => {
    expect([pointLabel('ai', AZ, titleOf), pointLabel('ai', SR, titleOf), pointLabel('ai', GU, titleOf), pointLabel('ai', CW, titleOf), pointLabel('ai', 'later-model', titleOf)])
      .toEqual(['Aariz', 'SRPose', 'GU2Net', 'cwlachap', 'Later Model']);
  });
  it('moved by you, with the model it was; placed by you; a model not recorded', () => {
    expect(pointLabel('ai-adjusted', AZ, titleOf)).toBe('Moved by you · was: Aariz');
    expect(pointLabel('ai-adjusted', null, titleOf)).toBe('Moved by you');
    expect(pointLabel('manual', AZ, titleOf)).toBe('Placed by you');
    expect(pointLabel('ai', null, titleOf)).toBe('AI (model not recorded)');
  });
});
describe('the hover says why (chain spec §5)', () => {
  const sw = table({ ownerChoices: { Go: SR }, ownerChoiceNotes: { Go: { since: '2026-11-12T03:00:00.000Z', basis: 'mm, 60 ruler films' } } });
  it('Aariz places this point', () => expect(pointWhy('S', 'ai', AZ, AZ, table(), titleOf, 'AU')).toBe('Aariz places this point.'));
  it('your switch, with its date and the films that decided (owner E1)', () =>
    expect(pointWhy('Go', 'ai', SR, AZ, sw, titleOf, 'AU')).toBe('Switched to SRPose on 12/11/2026: closer to your points (mm, 60 ruler films).'));
  it('a switch with no note (an older back end) still says it, without a date', () =>
    expect(pointWhy('Go', 'ai', SR, AZ, table({ ownerChoices: { Go: SR } }), titleOf, 'AU')).toBe('Switched to SRPose: closer to your points.'));
  it('Aariz on a switched point says the switch applies to new tracings', () =>
    expect(pointWhy('Go', 'ai', AZ, AZ, sw, titleOf, 'AU')).toBe('Aariz placed this point. Your switch to SRPose applies to new tracings and a Re-detect; on this film it gave no point, or the film was traced before the switch.'));
  it('a point Aariz did not find', () => expect(pointWhy('Ba', 'ai', GU, AZ, table(), titleOf, 'AU')).toBe('Aariz did not find this point; GU2Net did.'));
  it('cwlachap by the table, its fallback, and an old case placed by cwlachap', () => {
    expect(pointWhy('PNS', 'ai', CW, AZ, table({ points: { PNS: CW } }), titleOf, 'AU')).toBe('cwlachap places this point (better than Aariz on this point on validation films).');
    expect(pointWhy('PNS', 'ai', AZ, AZ, table({ points: { PNS: CW } }), titleOf, 'AU')).toBe('Aariz places this point here: cwlachap, better on this point on validation films, gave no point on this film.');
    expect(pointWhy('S', 'ai', CW, AZ, table(), titleOf, 'AU')).toBe('cwlachap placed this point.');
  });
  it('moved, hand-placed, not recorded', () => {
    expect(pointWhy('S', 'ai-adjusted', AZ, AZ, table(), titleOf, 'AU')).toBe('Aariz put this point here first; you moved it.');
    expect(pointWhy('S', 'manual', null, AZ, table(), titleOf, 'AU')).toBe('You placed this point by hand.');
    expect(pointWhy('S', 'ai', null, AZ, table(), titleOf, 'AU')).toBe('An AI model placed this point; which one is not recorded.');
  });
  it('isFallback only where the table gives the point to cwlachap and Aariz placed it', () => {
    expect([isFallback(AZ, AZ, table({ points: { PNS: CW } }), 'PNS'), isFallback(AZ, AZ, table(), 'PNS'), isFallback(CW, AZ, table({ points: { PNS: CW } }), 'PNS')])
      .toEqual([true, false, false]);
  });
});
describe('Automatic best: the label and the hover (spec §5)', () => {
  const ab = (over: Record<string, unknown> = {}) => table({ ownerChoices: { Go: GU }, autoBest: { available: true, on: true, base: 'aariz-cepha29', uses: { Go: SR },
    notes: { Go: { since: '2026-11-12T03:00:00.000Z', basis: 'mm, 60 ruler films' } }, kept: {}, latest: [], ...over } });
  it('the label names Automatic best and the model behind it', () => {
    expect([pointLabel('ai', SR, titleOf, 'auto-best'), pointLabel('ai', AZ, titleOf, 'auto-best'), pointLabel('ai-adjusted', SR, titleOf, 'auto-best'),
      pointLabel('manual', null, titleOf, 'auto-best'), pointLabel('ai', SR, titleOf)])
      .toEqual(['Automatic best · SRPose', 'Automatic best · Aariz', 'Moved by you · was: Automatic best · SRPose', 'Placed by you', 'SRPose']);
  });
  const why = (id: string, source: 'ai' | 'ai-adjusted', placer: string, src = ab()) => pointWhy(id, source, placer, AZ, src, titleOf, 'AU', 'auto-best');
  it('favoured', () => expect(why('Go', 'ai', SR)).toBe("Part F's rule favours SRPose here: closer to your points than Aariz (mm, 60 ruler films)."));
  it('with GU2Net as the base, the hovers name GU2Net', () => {
    const g = ab({ base: GU, uses: { Go: SR } });
    expect(pointWhy('Go', 'ai', SR, GU, g, titleOf, 'AU', 'auto-best')).toBe("Part F's rule favours SRPose here: closer to your points than GU2Net (mm, 60 ruler films).");
    expect(pointWhy('S', 'ai', GU, GU, g, titleOf, 'AU', 'auto-best')).toBe('No model has been shown closer to your points than GU2Net here yet, so Automatic best uses GU2Net.');
    expect(pointWhy('Go', 'ai', GU, GU, ab({ base: GU, uses: {}, notes: {}, kept: { Go: { modelId: SR, since: '2026-11-12T03:00:00.000Z' } } }), titleOf, 'AU', 'auto-best'))
      .toBe('You kept GU2Net here on 12/11/2026. Automatic best will use SRPose again only when newer films show it closer.');
  });
  it('no evidence yet', () => expect(why('S', 'ai', AZ)).toBe('No model has been shown closer to your points than Aariz here yet, so Automatic best uses Aariz.'));
  it('kept by your Undo', () => expect(why('Go', 'ai', AZ, ab({ uses: {}, notes: {}, kept: { Go: { modelId: SR, since: '2026-11-12T03:00:00.000Z' } } })))
    .toBe('You kept Aariz here on 12/11/2026. Automatic best will use SRPose again only when newer films show it closer.'));
  it('favoured but gave no point', () => expect(why('Go', 'ai', AZ))
    .toBe("Part F's rule favours SRPose here (mm, 60 ruler films), but SRPose gave no point on this film, or the film was traced before the rule favoured it."));
  it('the verdict changed since', () => expect(why('Go', 'ai', SR, ab({ uses: {}, notes: {} }))).toBe('Placed by SRPose, chosen by Automatic best when traced; today it would use Aariz.'));
  it('the map unreadable', () => expect(why('Go', 'ai', SR, table())).toBe('Placed by SRPose, chosen by Automatic best when traced; today it would use Aariz.'));
  it('moved', () => expect(why('Go', 'ai-adjusted', SR)).toBe('SRPose (chosen by Automatic best) put this point here first; you moved it.'));
  it('beyond the 19', () => expect(why('Ba', 'ai', GU)).toBe("Automatic best uses Part F's rule for the 19 points only; Aariz did not find this point; GU2Net did."));
  it('control: without via, your Part F switch hover is unchanged', () =>
    expect(pointWhy('Go', 'ai', GU, AZ, ab(), titleOf, 'AU')).toBe('Switched to GU2Net: closer to your points.'));
});

describe('switches apply when the main model is the base (final review C1, ruling A)', () => {
  const gb = (over: Partial<MainPointSource> = {}) => table({ ownerChoices: { Go: SR }, autoBest: { available: true, on: false, base: GU, uses: {}, notes: {}, kept: {}, latest: [] }, ...over });
  it('base GU2Net, main GU2Net: the switch is named', () =>
    expect(pointWhy('Go', 'ai', SR, GU, gb(), titleOf, 'AU')).toBe('Switched to SRPose: closer to your points.'));
  it('base GU2Net, main GU2Net, the switch gave no point: GU2Net placed it, and the hover says so', () =>
    expect(pointWhy('Go', 'ai', GU, GU, gb(), titleOf, 'AU')).toContain('GU2Net placed this point. Your switch to SRPose applies'));
  it('base GU2Net, main Aariz: no switch is claimed', () =>
    expect(pointWhy('Go', 'ai', AZ, AZ, gb(), titleOf, 'AU')).not.toContain('switch'));
});
