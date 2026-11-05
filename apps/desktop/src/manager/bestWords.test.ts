import { describe, it, expect } from 'vitest';
import type { BestBlock, BestPair, BestPoint, CheckPoint, ModelCheck, PointChoice, TierCounts } from '../ipc';
import { basisWords, blockWords, checkPointWords, checkStatusWords, checkWarning, etaWords, filmsWords, goBackWords, leftOutWords, pairBasisWords, pairLeftOutWords, pointSummary, shownBlock, switchesInForce, switchWords, verdictWords } from './bestWords';
const AZ = 'aariz-cepha29', SR = 'srpose-cldet23';
const titleOf = (m: string) => ({ [AZ]: 'Aariz', [SR]: 'SRPose' } as Record<string, string>)[m] ?? m;
const k = { importedAt: 'x', caseId: 'c' };
const counts = (ruler: number, machine = 0, fit = 0, assumed = 0): TierCounts => ({ ruler, machine, fit, assumed });
const b = (am: number, cm: number, aw: number, cw: number, acc: number, plain: [number, number] = [am, cm]): BestBlock =>
  ({ caseIds: [], first: k, last: k, incumbentMedianMm: am, challengerMedianMm: cm, incumbentPlainMedianMm: plain[0], challengerPlainMedianMm: plain[1],
    incumbentMeanMm: am, challengerMeanMm: cm, incumbentPlainMeanMm: am, challengerPlainMeanMm: cm, incumbentWithin: aw, challengerWithin: cw,
    incumbentWithinShare: aw / 30, challengerWithinShare: cw / 30, acceptedUnmoved: acc, passed: true });
const pair = (verdict: BestPair['verdict'], o: Partial<BestPair> = {}): BestPair =>
  ({ modelId: SR, basis: 'ruler', films: 60, available: counts(60), acceptedUnmoved: 40, leftOutEarlierFile: 0, verdict, ...o });
const point = (o: Partial<BestPoint>): BestPoint => ({ landmarkId: 'Go', current: AZ, pairs: [], offer: null, offerBasis: null, filmsByScale: counts(0),
  fineTunedRuler: 0, leftOutOtherPlacer: 0, ...o });
const choice = (id: number, landmarkId: string, action: PointChoice['action'], numbers: unknown = null, basis: string | null = 'mm, 60 ruler films'): PointChoice =>
  ({ id, landmarkId, modelId: SR, action, ruleVersion: 'best-point/3', lastImportedAt: null, lastCaseId: null, basis, numbers, operator: 'Dr A', at: '2026-10-18T01:00:00.000Z' });

describe('Part F words (Part F design "What you will see"; owner E1–E4, 26 Oct)', () => {
  it('the deciding group in the same words as the record (best.rs basis_words)', () => {
    expect([basisWords('ruler', 60), basisWords('machine', 45), basisWords('fit', 30), basisWords('assumed', 61)]).toEqual(
      ['mm, 60 ruler films', 'mm via machine scale, 45 films', 'mm via fit scale, 30 films', 'mm via assumed scale (an estimate), 61 films']);
  });
  it("each verdict in the rule's words", () => {
    expect(verdictWords(pair({ kind: 'notEnough', films: 12 }), titleOf)).toBe('not enough films (12 of 30)');
    expect(verdictWords(pair({ kind: 'notEnough', films: 0 }, { basis: null, films: 0 }), titleOf)).toBe('too few films on any one scale');
    expect(verdictWords(pair({ kind: 'reCheck', look: b(2, 1, 1, 1, 1), films: 8 }), titleOf)).toBe('passed the first 30; re-checking (8 of the next 30)');
    expect(verdictWords(pair({ kind: 'keep', look: b(2, 2, 1, 1, 1), check: null, films: 3 }), titleOf)).toBe('keep Aariz (next look: 3 of 30)');
    expect(verdictWords(pair({ kind: 'offer', look: b(2, 1, 1, 1, 1), check: b(2, 1, 1, 1, 1) }), titleOf)).toBe('offer: switch to SRPose');
  });
  it('which films decided, and which were not used; none with 20', () => {
    expect(pairBasisWords(pair({ kind: 'notEnough', films: 0 }))).toBe('Decided on mm, 60 ruler films');
    expect(pairBasisWords(pair({ kind: 'notEnough', films: 0 }, { films: 25, available: counts(25, 40, 0, 12) })))
      .toBe('Decided on mm, 25 ruler films · not used: 40 machine-scaled, 12 assumed-scale');
    expect(pairBasisWords(pair({ kind: 'notEnough', films: 0 }, { basis: null, films: 0, available: counts(12, 15, 0, 8) })))
      .toBe('Too few films on any one scale: ruler 12 · machine 15 · fit 0 · assumed 8 (a scale group needs 20)');
  });
  it('the block shown: the re-check for an offer, the look while re-checking, the failed block for keep, none when short', () => {
    const look = b(2.1, 1.4, 18, 25, 22), check = b(2, 1.5, 19, 24, 21);
    expect(shownBlock({ kind: 'offer', look, check })).toBe(check);
    expect(shownBlock({ kind: 'reCheck', look, films: 2 })).toBe(look);
    expect(shownBlock({ kind: 'keep', look, check, films: 0 })).toBe(check);
    expect(shownBlock({ kind: 'keep', look, check: null, films: 0 })).toBe(look);
    expect(shownBlock({ kind: 'notEnough', films: 4 })).toBeNull();
  });
  it('the numbers, both models, the accepted-unmoved share, and the plain medians when the weighting moved them', () => {
    expect(blockWords(b(2, 1.5, 19, 24, 21), 'SRPose'))
      .toBe('median Aariz 2.00 mm, SRPose 1.50 mm · within 2 mm: Aariz 19, SRPose 24 of 30 · 21 of 30 accepted unmoved');
    expect(blockWords(b(2.5, 1.5, 15, 15, 0, [2, 2]), 'SRPose'))
      .toBe('median Aariz 2.50 mm, SRPose 1.50 mm · within 2 mm: Aariz 15, SRPose 15 of 30 · 0 of 30 accepted unmoved · weighted by image resolution (plain median Aariz 2.00 mm, SRPose 2.00 mm)');
  });
  it('films per scale, with fine-tuned rulers; films left out', () => {
    expect(filmsWords(point({}))).toBeNull();
    expect(filmsWords(point({ filmsByScale: counts(50, 0, 0, 10) }))).toBe('Films: ruler 50 · machine 0 · fit 0 · assumed 10');
    expect(filmsWords(point({ filmsByScale: counts(50), fineTunedRuler: 6 }))).toBe('Films: ruler 50 · machine 0 · fit 0 · assumed 0 (6 ruler films fine-tuned by eye)');
    expect(leftOutWords(point({}))).toBeNull();
    expect(leftOutWords(point({ leftOutOtherPlacer: 2 }))).toBe('Films left out — placed by another model: 2');
  });
  it('films left out for one model because a mark came from an earlier model file (owner Q9): none, some', () => {
    expect(pairLeftOutWords(pair({ kind: 'notEnough', films: 0 }))).toBeNull();
    expect(pairLeftOutWords(pair({ kind: 'notEnough', films: 0 }, { leftOutEarlierFile: 30 }))).toBe('Films left out — measured with an earlier model file: 30');
  });
  it('a point with no pairs, and a switched point', () => {
    expect(pointSummary(point({}), titleOf)).toBe('no verified films yet');
    expect(pointSummary(point({ current: SR }), titleOf)).toBe('switched to SRPose');
    expect(pointSummary(point({ pairs: [pair({ kind: 'notEnough', films: 1 })] }), titleOf)).toBeNull();
  });
  it('switches in force: an undone one is gone, the later acceptance wins, declines never count', () => {
    const cs = [choice(1, 'Go', 'accepted'), choice(2, 'PNS', 'declined'), choice(3, 'Go', 'undone', null, null), choice(4, 'Or', 'accepted'), choice(5, 'Or', 'accepted')];
    expect(switchesInForce(cs).map((c) => c.id)).toEqual([5]);
    expect(switchesInForce([])).toEqual([]);
  });
  it('a switch in words, with its basis and re-check numbers, and without them when they are missing', () => {
    const numbers = pair({ kind: 'offer', look: b(2.1, 1.4, 18, 25, 22), check: b(2, 1.5, 19, 24, 21) });
    expect(switchWords(choice(1, 'Go', 'accepted', numbers), titleOf, 'AU'))
      .toBe('Go: SRPose since 18/10/2026, accepted by Dr A — mm, 60 ruler films — re-check: median Aariz 2.00 mm, SRPose 1.50 mm · within 2 mm: Aariz 19, SRPose 24 of 30 · 21 of 30 accepted unmoved');
    expect(switchWords(choice(1, 'Go', 'accepted', null, null), titleOf, 'US')).toBe('Go: SRPose since 10/18/2026, accepted by Dr A');
  });
});

describe('Part F weights check words (owner Q4)', () => {
  const pt = (o: Partial<CheckPoint>): CheckPoint => ({ landmarkId: 'Go', films: 50, noNewPoint: 0, oldMedianMm: 1.1, newMedianMm: 1.45, oldWithin: 48, newWithin: 41,
    verdict: { kind: 'worse', medianUp: true, fewerWithin: true }, ...o });
  const chk = (o: Partial<ModelCheck>): ModelCheck => ({ modelId: SR, fingerprint: 'fp', version: 'weights-check/1', filmsChecked: 60, filmsDue: 0, filmsFailed: 0,
    failedDetail: null, points: [pt({})], goBack: [], ...o });
  it('a point: worse, no worse, too few, no films, and films with no point from the new file', () => {
    expect(checkPointWords(pt({}))).toBe('Go: median 1.10 → 1.45 mm · within 2 mm 48 → 41 of 50 · worse (median up 0.35 mm, fewer within 2 mm)');
    expect(checkPointWords(pt({ newMedianMm: 1.2, newWithin: 48, verdict: { kind: 'noWorse' } }))).toBe('Go: median 1.10 → 1.20 mm · within 2 mm 48 → 48 of 50 · no worse');
    expect(checkPointWords(pt({ films: 12, oldWithin: 11, newWithin: 10, verdict: { kind: 'tooFew' } })))
      .toBe('Go: median 1.10 → 1.45 mm · within 2 mm 11 → 10 of 12 · too few films to judge (12 of 30)');
    expect(checkPointWords(pt({ films: 0, oldMedianMm: null, newMedianMm: null, verdict: { kind: 'noFilms' } }))).toBe('Go: no older film to compare');
    expect(checkPointWords(pt({ noNewPoint: 3, verdict: { kind: 'worse', medianUp: false, fewerWithin: true } })))
      .toBe('Go: median 1.10 → 1.45 mm · within 2 mm 48 → 41 of 50 · no point from the new file on 3 · worse (fewer within 2 mm)');
  });
  it('the model line: running with the time left, running with no speed known, finished, and films that could not be run', () => {
    expect(checkStatusWords(chk({ filmsDue: 60, filmsChecked: 0 }), titleOf, 600, { modelId: SR, done: 12, total: 60 }))
      .toBe('SRPose has a new file: checking it on your older films, 12 of 60 (about 29 s left)');
    expect(checkStatusWords(chk({ filmsDue: 60, filmsChecked: 0 }), titleOf, null, null)).toBe('SRPose has a new file: checking it on your older films, 0 of 60');
    expect(checkStatusWords(chk({ filmsFailed: 2, failedDetail: 'took longer than 15 s on this film' }), titleOf, 600, null))
      .toBe('SRPose has a new file: checked on 60 of your older films · could not run on 2 (took longer than 15 s on this film)');
  });
  it('the time: seconds under a minute and a half, minutes above, nothing when unknown or done', () => {
    expect([etaWords(60, 600), etaWords(60, 2000), etaWords(60, null), etaWords(0, 600)]).toEqual(['36 s', '2 min', null, null]);
  });
  it('the warning names the worse points and says nothing was switched; none when nothing is worse', () => {
    expect(checkWarning(chk({}), titleOf)).toBe("Warning: SRPose's new file is worse than its earlier one on your older films for Go. Nothing was switched.");
    expect(checkWarning(chk({ points: [pt({}), pt({ landmarkId: 'S' }), pt({ landmarkId: 'N' })] }), titleOf))
      .toBe("Warning: SRPose's new file is worse than its earlier one on your older films for Go, S and N. Nothing was switched.");
    expect(checkWarning(chk({ points: [pt({ verdict: { kind: 'noWorse' } }), pt({ landmarkId: 'S', verdict: { kind: 'tooFew' } })] }), titleOf)).toBeNull();
    expect(goBackWords('Go')).toBe('Go back to Aariz for Go');
  });
});

describe('Part F words name the base (plan 2026-10-29 Task 6)', () => {
  it('the block, keep, summary and go back', () => {
    expect(blockWords(b(2.1, 1.4, 20, 25, 3), 'SRPose', 'GU2Net')).toContain('median GU2Net 2.10 mm, SRPose 1.40 mm · within 2 mm: GU2Net 20');
    expect(verdictWords(pair({ kind: 'keep', look: b(2, 2, 1, 1, 0), check: null, films: 5 }), titleOf, 'GU2Net')).toBe('keep GU2Net (next look: 5 of 30)');
    expect(goBackWords('Go', 'GU2Net')).toBe('Go back to GU2Net for Go');
  });
  it('a point on the base is not a switch; a point on Aariz is one when GU2Net is the base', () => {
    const p = (current: string): BestPoint => ({ landmarkId: 'Go', current, offer: null, offerBasis: null, filmsByScale: counts(0), fineTunedRuler: 0, leftOutOtherPlacer: 0, pairs: [] });
    expect(pointSummary(p('gu2net-isbi19'), titleOf, 'gu2net-isbi19')).toBe('no verified films yet');
    expect(pointSummary(p(AZ), titleOf, 'gu2net-isbi19')).toBe('switched to Aariz');
  });
});

describe('an older switch names the base it was judged against (final review I2)', () => {
  const offer = { modelId: SR, basis: 'ruler', films: 60, available: counts(60), acceptedUnmoved: 0, leftOutEarlierFile: 0,
    verdict: { kind: 'offer', look: b(2.15, 1.45, 14, 21, 8), check: b(2.15, 1.75, 14, 18, 8) } };
  it('a best-point/2 record with no numbers.base, shown under a GU2Net base, reads "median Aariz"', () => {
    const c = { ...choice(1, 'Go', 'accepted', offer), ruleVersion: 'best-point/2' };
    const w = switchWords(c, titleOf, 'AU');
    expect(w).toContain('median Aariz 2.15 mm');
    expect(w).not.toContain('GU2Net');
  });
  it('a best-point/4 record names its own base, whatever the base is now', () => {
    const c = { ...choice(1, 'Go', 'accepted', { ...offer, base: 'gu2net-isbi19' }), ruleVersion: 'best-point/4' };
    expect(switchWords(c, titleOf, 'AU')).toContain('median GU2Net 2.15 mm');
  });
});
