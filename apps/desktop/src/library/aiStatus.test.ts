import { describe, it, expect } from 'vitest';
import type { CaseSummary } from '../ipc';
import { aiStatusLabel } from './aiStatus';

// Owner decision 4 (29 Oct 2026): the Table's AI status column gives the stage plus the model, in plain words —
// "Not traced" / "AI points to check · Automatic best" / "Verified 12 Oct 2026 · Automatic best" — using the app's
// existing model titles, never a raw file id.
const c = (o: Partial<CaseSummary>): CaseSummary => ({
  id: 'x', patientName: 'SYNTHETIC Demo', timepoint: 'T1', takenOn: null, createdAt: '2026-09-01T10:00:00.000Z',
  updatedAt: '2026-09-20T10:00:00.000Z', thumbPath: '/t.jpg', landmarks: 0, unverified: 0, verifiedAt: null, deletedAt: null, orientation: null,
  patientKey: 'synthetic demo', dateOfBirth: null, identityChecked: true, libraryId: null, formerLibraryIds: [], printedPatientId: null,
  gender: null, aiModelId: null, reportSavedAt: null, ...o,
});
const titleOf = (id: string) => (id === 'auto-best' ? 'Automatic best' : id === 'aariz-cepha29' ? 'Aariz' : id);

describe('aiStatusLabel (Library ▸ Table, AI status column)', () => {
  it('no landmarks at all: "Not traced", with no model named even if one is stored', () => {
    expect(aiStatusLabel(c({ landmarks: 0, aiModelId: 'aariz-cepha29' }), titleOf, 'AU')).toBe('Not traced');
  });
  it('every point AI and unverified: "AI points to check · <model>"', () => {
    expect(aiStatusLabel(c({ landmarks: 3, unverified: 3, aiModelId: 'auto-best' }), titleOf, 'AU')).toBe('AI points to check · Automatic best');
  });
  it('some verified, some not: still "AI points to check · <model>"', () => {
    expect(aiStatusLabel(c({ landmarks: 3, unverified: 1, aiModelId: 'aariz-cepha29' }), titleOf, 'AU')).toBe('AI points to check · Aariz');
  });
  it('every point accepted but not signed off: "Ready to sign off · <model>"', () => {
    expect(aiStatusLabel(c({ landmarks: 3, unverified: 0, aiModelId: 'auto-best' }), titleOf, 'AU')).toBe('Ready to sign off · Automatic best');
  });
  it('signed off: "Verified <date> · <model>", the date in the caller\'s format (dates.ts\'s formatDate, as every other Library date)', () => {
    const v = c({ landmarks: 3, unverified: 0, verifiedAt: '2026-10-12T03:00:00.000Z', aiModelId: 'auto-best' });
    expect(aiStatusLabel(v, titleOf, 'AU')).toBe('Verified 12/10/2026 · Automatic best');
    expect(aiStatusLabel(v, titleOf, 'US')).toBe('Verified 10/12/2026 · Automatic best');
  });
  it('no model known for this film (every point hand-placed): the stage alone, no dangling "· "', () => {
    expect(aiStatusLabel(c({ landmarks: 2, unverified: 0, verifiedAt: '2026-10-12T03:00:00.000Z', aiModelId: null, reportSavedAt: null }), titleOf, 'AU'))
      .toBe('Verified 12/10/2026');
    expect(aiStatusLabel(c({ landmarks: 2, unverified: 2, aiModelId: null, reportSavedAt: null }), titleOf, 'AU')).toBe('AI points to check');
  });
  // Positive control: swapping which branch runs (verified vs not) must change the word, proving the test can fail.
  it('positive control: verifiedAt alone flips "Ready to sign off" to "Verified …"', () => {
    const base = c({ landmarks: 1, unverified: 0, aiModelId: 'auto-best' });
    expect(aiStatusLabel(base, titleOf, 'AU')).toBe('Ready to sign off · Automatic best');
    expect(aiStatusLabel({ ...base, verifiedAt: '2026-01-02T00:00:00.000Z' }, titleOf, 'AU')).toBe('Verified 02/01/2026 · Automatic best');
  });
});
