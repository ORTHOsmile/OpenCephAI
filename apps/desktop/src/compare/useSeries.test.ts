import { describe, it, expect } from 'vitest';
import type { CaseDoc, SeriesFilm } from '../ipc';
import { failedOf, filmsToOpen } from './useSeries';

// SYNTHETIC: four films of one patient; ids only.
const film = (id: string, inSeries: boolean, fitRef: string | null = null): SeriesFilm => ({ id, timepoint: id.toUpperCase(), takenOn: null,
  takenOnSource: 'label', createdAt: id, stage: null, inSeries, nameOnly: false, fitRef, calibrated: false });
const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('useSeries: which films the Superimposition page opens (request G, plan Task 6)', () => {
  it('opens every ticked film but the open one, as before, when nothing is fitted', () => {
    const r = filmsToOpen([film('t1', true), film('t2', true), film('t3', false)], 't1');
    expect(sorted(r.want)).toEqual(['t2']);
    expect(sorted(r.need)).toEqual(['t2']);
  });
  it('also opens the reference of a ticked fitted film, and of the fitted open film, even when unticked', () => {
    const r = filmsToOpen([film('t1', false), film('t2', true, 't1'), film('t3', true), film('t4', false), film('t5', true, 't4')], 't3');
    expect(sorted(r.want)).toEqual(['t2', 't5']);
    expect(sorted(r.need)).toEqual(['t1', 't2', 't4', 't5']);
    const open = filmsToOpen([film('t1', false), film('t2', false, 't1')], 't2');   // the open film is fitted to an unticked t1
    expect(sorted(open.need)).toEqual(['t1']);
  });
  it('does not open the reference of an UNTICKED fitted film, nor the open film itself', () => {
    expect(sorted(filmsToOpen([film('t1', false), film('t2', false, 't1'), film('t3', true)], 't3').need)).toEqual([]);
    expect(sorted(filmsToOpen([film('t1', true), film('t2', true, 't1')], 't1').need)).toEqual(['t2']);
  });
  it('pre-flight ruling: a reference that cannot be opened is not "failed" unless it is ticked', () => {
    const got: (readonly [string, CaseDoc | null])[] = [['t1', null], ['t2', null], ['t3', {} as CaseDoc]];   // t1: an unticked reference
    expect(sorted(failedOf(got, ['t2', 't3']))).toEqual(['t2']);
  });
});
