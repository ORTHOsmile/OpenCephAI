// Library ▸ Pictures/Table (owner decision 2, 29 Oct 2026): which the window shows, remembered as the clinician's
// last choice — stored like any other UI choice (settings, per Mac; `dates.ts`'s DATE_FORMAT_KEY is the pattern),
// never in the case data, so it travels with this Mac, not with the library folder.
export type LibraryView = 'pictures' | 'table';
export const LIBRARY_VIEW_KEY = 'libraryView';
export const parseLibraryView = (v: string | null | undefined): LibraryView => (v === 'table' ? 'table' : 'pictures');

// Library ▸ Table ▸ Grouped/Flat (owner, 29 Oct 2026, item B as revised): one row per patient that opens to its films,
// or every film its own row. Remembered exactly as Pictures/Table is (settings, per Mac). Grouped is the default.
export type TableLayout = 'grouped' | 'flat';
export const TABLE_LAYOUT_KEY = 'libraryTableLayout';
export const parseTableLayout = (v: string | null | undefined): TableLayout => (v === 'flat' ? 'flat' : 'grouped');
