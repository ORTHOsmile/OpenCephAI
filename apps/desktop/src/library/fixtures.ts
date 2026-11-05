import type { CaseDoc, CaseEdit, DetectResult } from '../ipc';

export const docOf = (e: CaseEdit, over: Partial<CaseDoc> = {}): CaseDoc => ({
  id: e.id, patientName: 'Demo patient 01', timepoint: 'T1', takenOn: null,
  image: { sha256: 'synthetic', ext: 'png', width: 2000, height: 2400, originalName: 'demo.png', path: '/tmp/demo.png' },
  facing: e.facing, orientation: e.orientation, display: e.display, spacingMm: null, scaleSteps: 0, verifiedAt: null, verifiedBy: null,
  landmarks: e.landmarks, createdAt: '', updatedAt: '',
  patientKey: 'demo patient 01', dateOfBirth: null, scanId: null, identitySource: 'manual', identityChecked: true, identityIssues: [], takenOnSource: null, learnedFields: [],
  gender: null, referringPractitioner: null, population: null, background: null, switchedFromClinicDefault: false,
  printedPatientId: null, xrayType: null, xraySize: null, radiographyPractice: null,
  libraryId: null, patientIdsSeen: [], idMatches: [], libraryTrail: [],
  title: null, ageOnFilm: null, ageOnFilmYears: null, ...over,
});
export const detection = (facingLeft: boolean): DetectResult => ({
  modelId: 'hrnet-w32-isbi19', imageWidth: 2000, imageHeight: 2400, executionProvider: 'cpu',
  timingsMs: { preprocess: 1, inference: 2, decode: 3, total: 6 }, facingLeft, meanPeakRight: 0.2, meanPeakLeft: 0.6,
  landmarks: [{ id: 'Po', x: 1700, y: 1100, confidence: 0.7 }, { id: 'Or', x: 500, y: 1010, confidence: 0.8 }, { id: 'S', x: 1300, y: 800, confidence: 0.9 }],
  raw: [{ channel: 0, landmarkId: 'S', x: 1300, y: 800, peak: 0.9 }, { channel: 1, landmarkId: null, x: 10, y: 20, peak: 0.1 }],
});
