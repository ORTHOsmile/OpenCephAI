import { describe, it, expect } from 'vitest';
import type { CaseSummary } from '../ipc';
import { exportable, toggle } from './select';

const c = (id: string): CaseSummary => ({ id, patientName: 'SYNTHETIC Demo', timepoint: 'T1', takenOn: null, createdAt: '', updatedAt: '', thumbPath: '',
  landmarks: 0, unverified: 0, verifiedAt: null, deletedAt: null, orientation: null, dateOfBirth: null, patientKey: 'synthetic demo', identityChecked: true,
  libraryId: null, formerLibraryIds: [], printedPatientId: null, gender: null, aiModelId: null, reportSavedAt: null });

describe('choosing films in the Library', () => {
  it('a click adds a film, a second click removes it', () => {
    const a = toggle(new Set(), 'c1');
    expect([...a]).toEqual(['c1']);
    expect([...toggle(a, 'c1')]).toEqual([]);
  });
  it('toggle never changes the set it was given', () => {
    const a: ReadonlySet<string> = new Set(['c1']);
    toggle(a, 'c2'); toggle(a, 'c1');
    expect([...a]).toEqual(['c1']);
  });
  it('exports the chosen films still in the library, in library order; a film deleted since is left out', () => {
    expect(exportable(new Set(['c3', 'c1', 'gone']), [c('c1'), c('c2'), c('c3')])).toEqual(['c1', 'c3']);
    expect(exportable(new Set(), [c('c1')])).toEqual([]);
  });
});
