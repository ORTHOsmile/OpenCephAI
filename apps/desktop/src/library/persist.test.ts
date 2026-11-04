import { describe, it, expect } from 'vitest';
import { aiEdit, aiRunOf, detectionAction, hydrateAction, identityFields, parseOverlays, toEdit, toRow } from './persist';
import { DISPLAY_DEFAULT, initialTracing, tracingReducer as r } from '../tracing/state';
import { detection, docOf } from './fixtures';

describe('persistence mapping', () => {
  it('state → edit → stored doc → hydrate gives the same points, orientation and display', () => {
    let s = r(initialTracing, { type: 'load', landmarks: detection(false).landmarks });
    s = r(r(r(s, { type: 'beginDrag', id: 'S' }), { type: 'dragTo', pos: { x: 1310.5, y: 805.25 } }), { type: 'endDrag' });
    s = r(r(s, { type: 'place', id: 'Co', pos: { x: 1650, y: 900 } }), { type: 'setDisplay', display: { contrast: 1.4 } });
    const back = r(initialTracing, hydrateAction(docOf(toEdit('c1', 'right', s))));
    expect(back.points).toEqual(s.points);
    expect(back.orientation).toEqual(s.orientation);
    expect(back.display).toEqual(s.display);
    expect(back.points.S.ai).toEqual({ x: 1300, y: 800 });                  // the AI proposal survives the edit
  });
  it('a doc from an older build without orientation or display fields opens with the defaults', () => {
    const a = hydrateAction(docOf(toEdit('c1', 'right', initialTracing), { orientation: {}, display: {} }));
    expect(a).toMatchObject({ orientation: { mirror: false, rotDeg: 0, source: 'none' }, display: { brightness: 1, contrast: 1, invert: false } });
  });
  it('the first save of a left-facing film is mirrored, levelled and all-AI', () => {
    const e = aiEdit('c1', detection(true));
    expect(e.facing).toBe('left');
    expect(e.orientation).toMatchObject({ mirror: true, source: 'auto-FH' });
    expect(e.landmarks.map((l) => [l.id, l.source, l.verified, l.aiX === l.x, l.confidence])).toEqual([
      ['Po', 'ai', false, true, 0.7], ['Or', 'ai', false, true, 0.8], ['S', 'ai', false, true, 0.9]]);
    expect(aiRunOf(detection(true))).toEqual({ modelId: 'hrnet-w32-isbi19', executionProvider: 'cpu', facing: 'left', totalMs: 6, modelSha256: null });
  });
  it('overlay settings: unreadable → null, partial → merged with the defaults', () => {
    expect(parseOverlays(null)).toBeNull();
    expect(parseOverlays('{not json')).toBeNull();
    const o = parseOverlays('{"planes":{"pp":true,"sn":"yes"},"background":"sepia"}')!;
    expect(o.planes).toEqual({ ...initialTracing.overlays.planes, pp: true });
    expect([o.profilogram, o.background]).toEqual([false, 'radiograph']);
  });
  it('the first detection keeps what was placed or adjusted while it ran, as one undo step (review #4)', () => {
    let s = r(initialTracing, { type: 'place', id: 'Co', pos: { x: 1650, y: 900 } });
    s = r(s, { type: 'setDisplay', display: { brightness: 1.4 } });
    const after = r(s, detectionAction('first', detection(false).landmarks));
    expect(after.points.Co).toMatchObject({ source: 'manual', verified: true });
    expect(after.points.S).toMatchObject({ source: 'ai', verified: false });
    expect(after.display.brightness).toBe(1.4);
    expect(r(after, { type: 'undo' }).points).toEqual(s.points);
    expect(detectionAction('overwrite', [])).toEqual({ type: 'redetect', landmarks: [], overwrite: true });
  });
});

describe('identityFields', () => {
  it('copies what the case panel shows about the patient, and nothing about the tracing', () => {
    const d = docOf({ id: 'c1', facing: 'right', orientation: { mirror: false, rotDeg: 0, source: 'none' }, display: DISPLAY_DEFAULT, landmarks: [] },
      { patientName: 'Demo Synthetic', dateOfBirth: '1990-03-07', scanId: '4471', identitySource: 'film', identityChecked: false, takenOnSource: 'image',
        identityIssues: [{ kind: 'noDateOfBirth' }], learnedFields: ['dob'], gender: 'F', referringPractitioner: 'Dr Demo',
        printedPatientId: 'ZQ-7781', xrayType: 'Lateral Ceph', xraySize: '8x10', radiographyPractice: 'Demo Radiology Northside',
        libraryTrail: [{ kind: 'merged', number: 'L-00002', into: 'L-00001', on: '2026-10-17' }] });
    expect(identityFields(d)).toEqual({ patientName: 'Demo Synthetic', patientKey: 'demo patient 01', timepoint: 'T1', takenOn: null,
      dateOfBirth: '1990-03-07', scanId: '4471', identitySource: 'film', identityChecked: false, identityIssues: [{ kind: 'noDateOfBirth' }], takenOnSource: 'image',
      learnedFields: ['dob'], gender: 'F', referringPractitioner: 'Dr Demo',
      printedPatientId: 'ZQ-7781', xrayType: 'Lateral Ceph', xraySize: '8x10', radiographyPractice: 'Demo Radiology Northside',
      libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [{ kind: 'merged', number: 'L-00002', into: 'L-00001', on: '2026-10-17' }] });
  });
});

describe('placed_by and the model fingerprint (Task 10, schema 10)', () => {
  const pt = (source: 'ai' | 'ai-adjusted' | 'manual') => ({ x: 1, y: 2, source, verified: false, ai: { x: 1, y: 2 } }) as any;
  it('a row carries who placed it; a hand-placed point carries nobody; no entry means null', () => {
    expect(toRow('S', pt('ai'), 'aariz-cepha29').placedBy).toBe('aariz-cepha29');
    expect(toRow('S', pt('ai-adjusted'), 'aariz-cepha29').placedBy).toBe('aariz-cepha29');
    expect(toRow('S', pt('manual'), 'aariz-cepha29').placedBy).toBeNull();
    expect(toRow('S', pt('ai')).placedBy).toBeNull();
  });
  it('toEdit and aiEdit pass the map through', () => {
    const s = r(initialTracing, { type: 'load', landmarks: [{ id: 'S', x: 1, y: 2 }, { id: 'N', x: 3, y: 4 }] });
    expect(toEdit('c1', 'right', s, { S: 'aariz-cepha29' }).landmarks.map((l) => l.placedBy)).toEqual(['aariz-cepha29', null]);
    expect(aiEdit('c1', detection(false), { [detection(false).landmarks[0].id]: 'aariz-cepha29' }).landmarks[0].placedBy).toBe('aariz-cepha29');
  });
  it('a run carries the model fingerprint when the engine gave one', () => {
    expect(aiRunOf({ ...detection(true), modelSha256: 'abc' }).modelSha256).toBe('abc');
    expect(aiRunOf(detection(true)).modelSha256).toBeNull();
  });
});
