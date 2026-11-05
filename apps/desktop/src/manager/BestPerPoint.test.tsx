import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { BestBlock, BestPerPoint, TierCounts } from '../ipc';
import { BestPerPointView } from './BestPerPoint';
const AZ = 'aariz-cepha29', SR = 'srpose-cldet23';
const titleOf = (m: string) => ({ [AZ]: 'Aariz', [SR]: 'SRPose' } as Record<string, string>)[m] ?? m;
const k = { importedAt: 'x', caseId: 'c' };
const counts = (ruler: number, machine = 0, fit = 0, assumed = 0): TierCounts => ({ ruler, machine, fit, assumed });
const blk: BestBlock = { caseIds: [], first: k, last: k, incumbentMedianMm: 2, challengerMedianMm: 1.5, incumbentPlainMedianMm: 2, challengerPlainMedianMm: 1.5,
  incumbentMeanMm: 2, challengerMeanMm: 1.5, incumbentPlainMeanMm: 2, challengerPlainMeanMm: 1.5, incumbentWithin: 19, challengerWithin: 24,
  incumbentWithinShare: 19 / 30, challengerWithinShare: 24 / 30, acceptedUnmoved: 21, passed: true };
const data = (over: Partial<BestPerPoint> = {}): BestPerPoint => ({ ruleVersion: 'best-point/3', choices: [], checks: [], points: [
  { landmarkId: 'Go', current: AZ, offer: SR, offerBasis: 'ruler', filmsByScale: counts(60, 0, 0, 4), fineTunedRuler: 0, leftOutOtherPlacer: 2,
    pairs: [{ modelId: SR, basis: 'ruler', films: 60, available: counts(60, 0, 0, 4), acceptedUnmoved: 42, leftOutEarlierFile: 0, verdict: { kind: 'offer', look: blk, check: blk } }] },
  { landmarkId: 'S', current: AZ, offer: null, offerBasis: null, filmsByScale: counts(12), fineTunedRuler: 0, leftOutOtherPlacer: 0,
    pairs: [{ modelId: SR, basis: null, films: 0, available: counts(12, 5), acceptedUnmoved: 0, leftOutEarlierFile: 30, verdict: { kind: 'notEnough', films: 0 } }] },
  { landmarkId: 'N', current: AZ, offer: null, offerBasis: null, filmsByScale: counts(0), fineTunedRuler: 0, leftOutOtherPlacer: 0, pairs: [] },
], ...over });
const html = (d: BestPerPoint | null, error: string | null = null, notice: string | null = null) =>
  renderToStaticMarkup(<BestPerPointView data={d} error={error} notice={notice} titleOf={titleOf} dateFormat="AU" onAnswer={() => {}} />);

describe('Best model per point (Part F)', () => {
  it('an offer shows its words, the films that decided, its numbers, the films, Accept and Decline', () => {
    const out = html(data());
    expect(out).toContain('offer: switch to SRPose');
    expect(out).toContain('Decided on mm, 60 ruler films · not used: 4 assumed-scale');
    expect(out).toContain('median Aariz 2.00 mm, SRPose 1.50 mm · within 2 mm: Aariz 19, SRPose 24 of 30 · 21 of 30 accepted unmoved');
    expect(out).toContain('Films: ruler 60 · machine 0 · fit 0 · assumed 4');
    expect(out).toContain('Films left out — placed by another model: 2');
    expect(out.match(/>Accept</g)?.length).toBe(1);
    expect(out.match(/>Decline</g)?.length).toBe(1);
  });
  it('a point with no scale group of 20 has no buttons and names its counts; a point with nothing has its one line', () => {
    const out = html(data());
    expect(out).toContain('too few films on any one scale');
    expect(out).toContain('Too few films on any one scale: ruler 12 · machine 5 · fit 0 · assumed 0 (a scale group needs 20)');
    expect(out).toContain('Films left out — measured with an earlier model file: 30');
    expect(out).toContain('no verified films yet');
  });
  it('no switches: says Aariz places every point; a switch: listed with its basis and Undo', () => {
    expect(html(data())).toContain('None: Aariz places every point.');
    const sw = html(data({ choices: [{ id: 1, landmarkId: 'Go', modelId: SR, action: 'accepted', ruleVersion: 'best-point/3', lastImportedAt: 'x', lastCaseId: 'c',
      basis: 'mm, 60 ruler films', numbers: null, operator: 'Dr A', at: '2026-10-18T01:00:00.000Z' }] }));
    expect(sw).toContain('Go: SRPose since 18/10/2026, accepted by Dr A — mm, 60 ruler films');
    expect(sw).toContain('>Undo<');
  });
  it('nothing read yet, a read failure, and a refused answer', () => {
    expect(html(null)).toContain('Reading your verified films…');
    const failed = html(null, "Best model per point couldn't be read: SYNTHETIC");
    expect(failed).toContain('class="error"');
    expect(failed).not.toContain('<table');
    const refused = html(data(), null, 'That answer was not saved: SYNTHETIC');
    expect(refused).toContain('That answer was not saved: SYNTHETIC');
    expect(refused).toContain('<table');
  });
  it('the weights check: the warning, the numbers side by side, the way back for a switched point; no section when no file changed', () => {
    const check = { modelId: SR, fingerprint: 'fp', version: 'weights-check/1', filmsChecked: 60, filmsDue: 0, filmsFailed: 0, failedDetail: null, goBack: ['Go'],
      points: [{ landmarkId: 'Go', films: 50, noNewPoint: 0, oldMedianMm: 1.1, newMedianMm: 1.45, oldWithin: 48, newWithin: 41, verdict: { kind: 'worse' as const, medianUp: true, fewerWithin: true } },
        { landmarkId: 'N', films: 0, noNewPoint: 0, oldMedianMm: null, newMedianMm: null, oldWithin: 0, newWithin: 0, verdict: { kind: 'noFilms' as const } }] };
    const out = html(data({ checks: [check] }));
    expect(out).toContain('new file is worse than its earlier one on your older films for Go. Nothing was switched.');
    expect(out).toContain('Go: median 1.10 → 1.45 mm · within 2 mm 48 → 41 of 50 · worse (median up 0.35 mm, fewer within 2 mm)');
    expect(out).not.toContain('N: no older film to compare');
    expect(out.match(/>Go back to Aariz for Go</g)?.length).toBe(1);
    expect(html(data())).not.toContain('best-checks');
  });
  it('Automatic best is the main model: the numbers stay, Accept and Decline go, and one line says why (D3)', () => {
    const out = renderToStaticMarkup(<BestPerPointView data={data()} error={null} notice={null} titleOf={titleOf} dateFormat="AU" onAnswer={() => {}} autoBestMain />);
    expect(out).toContain('offer: switch to SRPose');
    expect(out).not.toContain('>Accept<');
    expect(out).not.toContain('>Decline<');
    expect(out).toContain('Automatic best is your main model: it uses each point&#x27;s verdict by itself, with Undo. Your switches below apply when you choose Aariz as the main model.');
  });
});

describe('the table names the base (plan 2026-10-29 Task 6)', () => {
  it('GU2Net as the base: the intro and the empty switches line say GU2Net', () => {
    const h = renderToStaticMarkup(<BestPerPointView data={data()} error={null} notice={null} titleOf={titleOf} dateFormat="AU" onAnswer={() => {}} baseTitle="GU2Net" />);
    expect(h).toContain('GU2Net places every point unless you accept a switch.');
    expect(h).toContain('None: GU2Net places every point.');
    expect(h).not.toContain('Aariz places every point');
  });
});

describe('where switches apply (final review C1, ruling A)', () => {
  const h = (o: Record<string, unknown>) => renderToStaticMarkup(<BestPerPointView data={data()} error={null} notice={null} titleOf={titleOf} dateFormat="AU" onAnswer={() => {}} {...o} />);
  it('a fixed main model that is not the base: the table says switches apply only when the base is the main model', () =>
    expect(h({ base: 'gu2net-isbi19', baseTitle: 'GU2Net', fixedMain: AZ })).toContain('Switches apply when GU2Net is the main model.'));
  it('control: the base is the main model: no such line', () =>
    expect(h({ base: 'gu2net-isbi19', baseTitle: 'GU2Net', fixedMain: 'gu2net-isbi19' })).not.toContain('Switches apply when'));
  it('Automatic best main: its own line names the base', () =>
    expect(h({ base: 'gu2net-isbi19', baseTitle: 'GU2Net', autoBestMain: true })).toContain('Your switches below apply when you choose GU2Net as the main model.'));
});
