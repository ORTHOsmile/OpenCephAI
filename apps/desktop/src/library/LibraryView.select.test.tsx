import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CaseSummary } from '../ipc';
import { LibraryView } from './LibraryView';

// The cards' thumbnails go through Tauri's convertFileSrc, which needs a window; the test renders without one.
vi.mock('@tauri-apps/api/core', () => ({ convertFileSrc: (p: string) => p }));

// Library ▸ Select (spec 2026-10-17 report-exports, Task 10). Choosing itself is clicked through in e2e14.cjs (L1-L10);
// here, what the Library shows before anything is clicked.
const noop = () => {};
const c = (id: string): CaseSummary => ({ id, patientName: 'SYNTHETIC Demo', timepoint: 'T1', takenOn: null, createdAt: '', updatedAt: '', thumbPath: '',
  landmarks: 0, unverified: 0, verifiedAt: null, deletedAt: null, orientation: null, dateOfBirth: null, patientKey: 'synthetic demo', identityChecked: true,
  libraryId: null, formerLibraryIds: [], printedPatientId: null, gender: null, aiModelId: null, reportSavedAt: null });
const html = (onExportCsv?: (ids: string[]) => void) => renderToStaticMarkup(
  <LibraryView cases={[c('c1'), c('c2')]} deleted={[]} batch={[]} busy={null} error={null} notice={null} modelNote={null}
    onOpen={noop} onImport={noop} onDelete={noop} onRestore={noop} onBackup={noop} onRestoreBackup={noop}
    operator="" onOperator={noop} dateFormat="AU" onDateFormat={noop} onExportCsv={onExportCsv} view="pictures" onView={noop} layout="grouped" onLayout={noop} onReport={noop} />,
);
const toolbar = (h: string) => h.match(/<header class="toolbar lib-toolbar"[^>]*>(.*?)<\/header>/)?.[1] ?? '';

describe('Library ▸ Select', () => {
  it('the toolbar offers Select (and no Export CSV… until choosing starts)', () => {
    expect(toolbar(html(noop))).toMatch(/<button[^>]*>Select<\/button>/);
    expect(toolbar(html(noop))).not.toContain('Export CSV…');
  });
  it('positive control: with no export wired, no Select', () => {
    expect(toolbar(html())).not.toContain('>Select<');
  });
  it('before choosing, the cards open films and show no tick boxes', () => {
    const h = html(noop);
    expect(h).toContain('aria-label="Open SYNTHETIC Demo T1"');
    expect(h).not.toContain('class="pick');
    expect(h).not.toContain('aria-pressed');
  });
});
