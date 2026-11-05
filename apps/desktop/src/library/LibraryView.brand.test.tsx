import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LibraryView } from './LibraryView';

// Owner, 15 Oct 2026: the "OPEN CEPH AI" title replaces the word "Library" at the top of the library window — in
// the same place, at the same height, so nothing is added. It is drawn in the text colour (light and dark mode).
const noop = () => {};
const html = () => renderToStaticMarkup(
  <LibraryView cases={[]} deleted={[]} batch={[]} busy={null} error={null} notice={null} modelNote={null}
    onOpen={noop} onImport={noop} onDelete={noop} onRestore={noop} onBackup={noop} onRestoreBackup={noop}
    operator="" onOperator={noop} dateFormat="AU" onDateFormat={noop} view="pictures" onView={noop} layout="grouped" onLayout={noop} onReport={noop} />,
);

describe('library toolbar title (owner, 15 Oct 2026)', () => {
  it('shows the OpenCephAI title mark, named for screen readers, where "Library" used to be', () => {
    const toolbar = html().match(/<header class="toolbar lib-toolbar"[^>]*>(.*?)<input/)?.[1] ?? '';
    expect(toolbar).toMatch(/<div class="title brand-title" role="img" aria-label="OpenCephAI library"[^>]*><\/div>/);
    expect(toolbar).not.toContain('>Library<');
  });
});
