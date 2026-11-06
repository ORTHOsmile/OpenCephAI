import { describe, it, expect } from 'vitest';
import { LANDMARKS } from '@ceph/analyses';
import { reportPoints } from './points';
import type { PointCheckFlag, PointCheckView, WholeCheckView, WholeFilmView } from '../ipc';

describe('Part F: the points the report and the CSV list (chain spec §5)', () => {
  it("each placed point in the catalogue's order, with the screen's label, its model, its file and how it was accepted", () => {
    const pts = { Go: { source: 'ai' as const, acceptKind: 'bulk' as const }, S: { source: 'ai-adjusted' as const, acceptKind: 'drag' as const },
      N: { source: 'manual' as const, acceptKind: 'hand' as const } };
    const placer = (id: string) => (id === 'Go' ? 'srpose-cldet23' : 'aariz-cepha29');
    const r = reportPoints(pts, placer, (m) => m, { Go: 'fp-sr', S: 'fp-az', N: 'fp-ignored' });
    const order = Object.keys(LANDMARKS), rank = (id: string) => order.indexOf(id);
    expect(r.map((p) => p.id)).toEqual(['Go', 'S', 'N'].sort((a, b) => rank(a) - rank(b)));
    const by = (id: string) => r.find((p) => p.id === id)!;
    expect([by('S').label, by('S').model, by('S').modelFile, by('S').acceptKind]).toEqual(['Moved by you · was: Aariz', 'aariz-cepha29', 'fp-az', 'drag']);
    expect([by('N').label, by('N').model, by('N').modelFile, by('N').acceptKind]).toEqual(['Placed by you', null, null, 'hand']);
    expect([by('Go').label, by('Go').model, by('Go').modelFile]).toEqual(['SRPose', 'srpose-cldet23', 'fp-sr']);
    expect(by('S').name).toBe(LANDMARKS.S.name);
    expect(reportPoints({}, placer, (m) => m, {})).toEqual([]);
  });

  it('Automatic best: its label in the report and the CSV; the model stays the real one (spec §5)', () => {
    const pts = { Go: { source: 'ai' as const }, S: { source: 'ai-adjusted' as const }, N: { source: 'ai' as const }, A: { source: 'manual' as const } };
    const placer = (id: string) => (id === 'Go' ? 'srpose-cldet23' : 'aariz-cepha29');
    const r = reportPoints(pts, placer, (m) => m, {}, (id) => (id === 'N' ? null : 'auto-best'));
    const by = (id: string) => r.find((p) => p.id === id)!;
    expect([by('Go').label, by('Go').model]).toEqual(['Automatic best · SRPose', 'srpose-cldet23']);
    expect([by('S').label, by('N').label, by('A').label]).toEqual(['Moved by you · was: Automatic best · Aariz', 'Aariz', 'Placed by you']);
  });

  // Stage A task 8. Fails if `reportPoints` reads a flag from any model rather than the one that placed the point.
  describe('the point_check cell', () => {
    const flagOf = (modelId: string, landmarkId: string | null, over: Partial<PointCheckFlag> = {}): PointCheckFlag => ({ id: 1, modelId, landmarkId,
      action: landmarkId ? 'flagged' : 'film-unusual', points: landmarkId ? null : 'N,S,Po,Ar', offPx: 100, expectedX: 1, expectedY: 1, ring: null, resolved: null, ...over });
    const pts = { Go: { source: 'ai' as const }, S: { source: 'ai-adjusted' as const }, N: { source: 'manual' as const } };
    const placer = (id: string) => (id === 'Go' ? 'srpose-cldet23' : 'aariz-cepha29');
    const cells = (v: PointCheckView | null) => Object.fromEntries(reportPoints(pts, placer, (m) => m, {}, undefined, v).map((p) => [p.id, p.pointCheck]));
    it('no check passed (an older film): every cell blank', () => { expect(cells(null)).toEqual({ Go: '', S: '', N: '' }); });
    it("each point carries ITS placing model's flag, and only that", () => {
      // Go was placed by SRPose, S by Aariz. SRPose flagged S (not its point) and Aariz flagged Go (not its point): both blank.
      expect(cells({ runs: [], flags: [flagOf('srpose-cldet23', 'S'), flagOf('aariz-cepha29', 'Go')] })).toEqual({ Go: '', S: '', N: '' });
      expect(cells({ runs: [], flags: [flagOf('srpose-cldet23', 'Go'), flagOf('aariz-cepha29', 'S')] })).toEqual({ Go: 'flagged', S: 'flagged', N: '' });
    });
    it('a hand-placed point reads flagged only when its flag was resolved `placed` (review I1)', () => {
      expect(cells({ runs: [], flags: [flagOf('aariz-cepha29', 'N', { resolved: 'placed' })] })).toEqual({ Go: '', S: '', N: 'flagged' });
      expect(cells({ runs: [], flags: [flagOf('aariz-cepha29', 'N')] })).toEqual({ Go: '', S: '', N: '' });
    });
    it('film-unusual marks every point of the flagged model, never the hand-placed one or the other model\'s', () => {
      expect(cells({ runs: [], flags: [flagOf('aariz-cepha29', null)] })).toEqual({ Go: '', S: 'film-unusual', N: '' });
    });
  });

  // Task 9. Fails if `reportPoints` stops passing the film's whole-film cell to every row, or reads it per point.
  describe('the whole_film_check cell (SC-1 Part 1 task 9)', () => {
    const pts = { Go: { source: 'ai' as const }, S: { source: 'ai-adjusted' as const }, N: { source: 'manual' as const } };
    const placer = (id: string) => (id === 'Go' ? 'srpose-cldet23' : 'aariz-cepha29');
    const cells = (w?: WholeFilmView | null) => Object.fromEntries(reportPoints(pts, placer, (m) => m, {}, undefined, null, w, true).map((p) => [p.id, p.wholeFilmCheck]));
    const shown = (over: Partial<WholeCheckView>): WholeFilmView => ({ shown: { id: 1, subject: 'run', modelId: 'm', outcome: 'flagged', shapeLook: 'judged', regionLook: 'judged', present: 19, reasons: [], resolved: null, sizeLook: 'not-set-up', cbLook: 'not-set-up', cbPresent: 0, ...over }, checks: [], off: false });
    it('no view passed (an older library, or other callers): blank on every row', () => { expect(cells()).toEqual({ Go: '', S: '', N: '' }); expect(cells(null)).toEqual({ Go: '', S: '', N: '' }); });
    it('the film\'s one value on every row, whoever placed the point', () => {
      const w = shown({ reasons: [{ reason: 'region', region: 'mandible', ids: ['Me'], named: [] }, { reason: 'facing', region: null, ids: [], named: [] }] });
      expect(cells(w)).toEqual({ Go: 'flagged:region-mandible+facing', S: 'flagged:region-mandible+facing', N: 'flagged:region-mandible+facing' });
    });
    it('clean, not-run and checked', () => {
      expect(cells(shown({ outcome: 'clean' })).S).toBe('clean');
      expect(cells(shown({ outcome: 'not-run' })).S).toBe('not-run');
      expect(cells(shown({ resolved: { reason: 'expected-variant', operator: 'SYNTHETIC', resolvedAt: 'x' } })).S).toBe('checked:expected-variant');
    });
    it('the other cells are unchanged by it', () => {
      const a = reportPoints(pts, placer, (m) => m, {}, undefined, null, null), b = reportPoints(pts, placer, (m) => m, {}, undefined, null, shown({ outcome: 'clean' }), true);
      expect(b.map(({ wholeFilmCheck: _w, wholeFilmRegion: _r, wholeFilmLooks: _l, ...rest }) => rest)).toEqual(a.map(({ wholeFilmCheck: _w, wholeFilmRegion: _r, wholeFilmLooks: _l, ...rest }) => rest));
    });
    // Research switch (6 Nov 2026). Fails if the film's value or the region result reaches a point while the switch is off.
    it('switch off (default): neither cell is set, whatever the view holds', () => {
      const w = shown({ outcome: 'clean', landmarkRegions: [{ id: 'S', region: 'cranial-base', result: 'fine' }] });
      const off = reportPoints(pts, placer, (m) => m, {}, undefined, null, w);
      expect(off.map((p) => [p.wholeFilmCheck, p.wholeFilmRegion])).toEqual([[null, null], [null, null], [null, null]]);
    });
    it('switch on: the region result is per landmark', () => {
      const w = shown({ outcome: 'clean', landmarkRegions: [{ id: 'S', region: 'cranial-base', result: 'fine' }, { id: 'Go', region: 'mandible', result: 'flagged' }] });
      const on = reportPoints(pts, placer, (m) => m, {}, undefined, null, w, true);
      expect(Object.fromEntries(on.map((p) => [p.id, p.wholeFilmRegion]))).toEqual({ Go: 'region flagged', S: 'fine', N: 'not checked' });
    });
  });
});
