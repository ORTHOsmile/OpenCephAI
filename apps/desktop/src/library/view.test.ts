import { describe, it, expect } from 'vitest';
import { LIBRARY_VIEW_KEY, TABLE_LAYOUT_KEY, parseLibraryView, parseTableLayout } from './view';

// Owner decision 2 (29 Oct 2026): Pictures/Table remembers the clinician's last choice, stored like any other UI
// choice (settings, per Mac — dates.ts's DATE_FORMAT_KEY is the pattern), never in the case data.
describe('parseLibraryView (Library ▸ Pictures/Table, remembered per Mac)', () => {
  it('reads back exactly "table" as table', () => { expect(parseLibraryView('table')).toBe('table'); });
  // Positive control: an unknown/garbled stored value must NOT also read as "table" — proves the guard checks the
  // value, not just "is a string".
  it('anything else — null, unset, or garbled storage — falls back to Pictures', () => {
    expect(parseLibraryView(null)).toBe('pictures');
    expect(parseLibraryView(undefined)).toBe('pictures');
    expect(parseLibraryView('')).toBe('pictures');
    expect(parseLibraryView('TABLE')).toBe('pictures');
    expect(parseLibraryView('pictures')).toBe('pictures');
    expect(parseLibraryView('garbled-\u0000-value')).toBe('pictures');
  });
  it('the settings key is stable (changing it would silently reset every clinician back to Pictures)', () => {
    expect(LIBRARY_VIEW_KEY).toBe('libraryView');
  });
});

// Owner, 29 Oct (item B as revised): the Table's Grouped/Flat choice is remembered the same way, per Mac.
describe('parseTableLayout (Library ▸ Table ▸ Grouped/Flat, remembered per Mac)', () => {
  it('reads back exactly "flat" as flat; anything else is Grouped, the default', () => {
    expect(parseTableLayout('flat')).toBe('flat');
    for (const v of [null, undefined, '', 'FLAT', 'grouped', 'garbled']) expect(parseTableLayout(v)).toBe('grouped');
  });
  it('the settings key is stable', () => { expect(TABLE_LAYOUT_KEY).toBe('libraryTableLayout'); });
});
