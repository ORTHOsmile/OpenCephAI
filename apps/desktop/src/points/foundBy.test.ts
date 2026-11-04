import { describe, it, expect } from 'vitest';
import { foundByLines } from './foundBy';
const table = [
  { modelId: 'main', title: 'SRPose', main: true, points: [{ id: 'S', status: { kind: 'original' as const } }, { id: 'Pt', status: { kind: 'notScored' as const } }] },
  { modelId: 'aariz', title: 'Aariz', main: false, points: [{ id: 'U1A', status: { kind: 'scored' as const, mre: 1.27, n: 150, dataset: 'aariz' } },
    { id: 'Co', status: { kind: 'tooFar' as const, mre: 2.13, n: 150, dataset: 'aariz' } }] },
];
describe('which installed models find a point', () => {
  it('an original point', () => expect(foundByLines('S', table)).toEqual(['SRPose: one of its original points']));
  it('a scored point gives its score', () => expect(foundByLines('U1A', table)).toEqual(['Aariz: 1.3 mm on 150 aariz test films']));
  it('over the gate: suggested only', () => expect(foundByLines('Co', table)).toEqual(['Aariz: suggested only (2.1 mm on 150 aariz test films, over the gate)']));
  it('not scored', () => expect(foundByLines('Pt', table)).toEqual(['SRPose: not scored on any test set']));
  it('no model: say so', () => expect(foundByLines('R1', table)).toEqual(['No installed model finds this point: place it by hand.']));
  it('table unreadable: say so', () => expect(foundByLines('S', null)).toEqual(['Which models find this point could not be read.']));
});
