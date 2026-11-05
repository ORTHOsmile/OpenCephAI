import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CaseSummary } from '../ipc';
import { LibraryView } from './LibraryView';
import type { LibraryView as Mode, TableLayout } from './view';

vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p, invoke: async () => [] }));

// Owner, 29 Oct 2026 (item B as revised): a Grouped/Flat choice beside the Table, shown only with the Table. SYNTHETIC rows.
const noop = () => {};
const c = (id: string, tp: string): CaseSummary => ({ id, patientName: 'SYNTHETIC Demo', timepoint: tp, takenOn: `2026-0${tp.slice(1)}-01`, createdAt: '', updatedAt: '',
  thumbPath: '', landmarks: 0, unverified: 0, verifiedAt: null, deletedAt: null, orientation: null, dateOfBirth: null, patientKey: 'synthetic demo',
  identityChecked: true, libraryId: null, formerLibraryIds: [], printedPatientId: null, gender: null, aiModelId: null, reportSavedAt: null });
const html = (view: Mode, layout: TableLayout) => renderToStaticMarkup(
  <LibraryView cases={[c('c1', 'T1'), c('c2', 'T2')]} deleted={[]} batch={[]} busy={null} error={null} notice={null} modelNote={null}
    onOpen={noop} onImport={noop} onDelete={noop} onRestore={noop} onBackup={noop} onRestoreBackup={noop}
    operator="" onOperator={noop} dateFormat="AU" onDateFormat={noop} view={view} onView={noop}
    layout={layout} onLayout={noop} onReport={noop} />,
);
const choice = (h: string) => h.match(/<div class="segmented" role="radiogroup" aria-label="Grouped or Flat">(.*?)<\/div>/)?.[1] ?? null;

describe('Library ▸ Table ▸ Grouped/Flat', () => {
  it('shows beside the Table, with the remembered choice checked', () => {
    expect(choice(html('table', 'grouped'))).toBe('<button type="button" role="radio" aria-checked="true">Grouped</button><button type="button" role="radio" aria-checked="false">Flat</button>');
    expect(choice(html('table', 'flat'))).toContain('aria-checked="true">Flat<');
  });
  it('is not shown with Pictures', () => { expect(choice(html('pictures', 'grouped'))).toBeNull(); });
  it('the Table follows it: Grouped shows a patient row, Flat the films', () => {
    expect(html('table', 'grouped')).toContain('aria-label="SYNTHETIC Demo, 2 films"');
    expect(html('table', 'flat')).toContain('aria-label="Open SYNTHETIC Demo T2"');
    expect(html('table', 'flat')).not.toContain('lib-patient');
  });
});
