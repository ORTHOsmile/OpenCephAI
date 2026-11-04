import { describe, it, expect } from 'vitest';
import { initialTracing, tracingReducer as r } from '../tracing/state';
import { aiEdit, hydrateAction, toEdit } from './persist';
import { createSaver } from './saver';
import { detection, docOf } from './fixtures';
import type { CaseDoc, CaseEdit } from '../ipc';

/** Stand-in for ceph-store with the contract its Rust tests pin: save replaces the case's rows; open returns them. */
function fakeLibrary() {
  const docs = new Map<string, CaseDoc>();
  return {
    importCase(id: string) { docs.set(id, docOf({ id, facing: 'right', orientation: { mirror: false, rotDeg: 0, source: 'none' }, display: { brightness: 1, contrast: 1, invert: false, sharpness: 0 }, landmarks: [] }, { orientation: {}, display: {} })); },
    save: async (e: CaseEdit) => { const d = docs.get(e.id)!; docs.set(e.id, structuredClone({ ...d, facing: e.facing, orientation: e.orientation, display: e.display, landmarks: e.landmarks })); },
    open: async (id: string) => structuredClone(docs.get(id)!),
  };
}

describe('Week 3 acceptance: import → detect → drag → undo → save → reload', () => {
  it('reopens exactly what was left, for a film that faces left', async () => {
    const lib = fakeLibrary(); lib.importCase('c1');
    await lib.save(aiEdit('c1', detection(true)));                            // import + automatic detection
    let doc = await lib.open('c1');
    let s = r(initialTracing, hydrateAction(doc));
    const saver = createSaver(lib.save, () => {}, 0);
    saver.prime(toEdit('c1', doc.facing, s));
    s = r(r(r(s, { type: 'beginDrag', id: 'S' }), { type: 'dragTo', pos: { x: 1310, y: 805 } }), { type: 'endDrag' });
    s = r(r(r(s, { type: 'beginDrag', id: 'Po' }), { type: 'dragTo', pos: { x: 1690, y: 1120 } }), { type: 'endDrag' });
    s = r(s, { type: 'undo' });                                               // Po goes back, and so does the level
    s = r(s, { type: 'place', id: 'Co', pos: { x: 1650, y: 900 } });
    saver.schedule(toEdit('c1', doc.facing, s)); await saver.flush();
    doc = await lib.open('c1');                                               // quit and reopen
    const back = r(initialTracing, hydrateAction(doc));
    expect(back.points).toEqual(s.points);
    expect(back.orientation).toEqual(s.orientation);
    expect(back.display).toEqual(s.display);
    expect([doc.facing, back.orientation.mirror, back.points.Po.x]).toEqual(['left', true, 1700]);
  });
});
