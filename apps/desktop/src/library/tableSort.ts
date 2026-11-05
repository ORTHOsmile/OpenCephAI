// A small, generic, stable sort for Library ▸ Table's clickable column headers (owner decision 3, 29 Oct 2026).
// Pulled out of LibraryTable.tsx so the ordering rule itself is unit-tested without rendering React.
export type SortDir = 'asc' | 'desc';

/** Stable sort by `value(row)`: numbers compare as numbers (nulls/NaN last, either direction); strings compare
 *  case-insensitively by locale. Never mutates `rows`. */
export function sortBy<T>(rows: readonly T[], value: (r: T) => string | number | null, dir: SortDir): T[] {
  const withIndex = rows.map((r, i) => ({ r, i, v: value(r) }));
  withIndex.sort((a, b) => {
    const an = a.v === null || (typeof a.v === 'number' && Number.isNaN(a.v));
    const bn = b.v === null || (typeof b.v === 'number' && Number.isNaN(b.v));
    if (an || bn) return an && bn ? a.i - b.i : an ? 1 : -1;   // null/NaN always last, regardless of direction
    let c: number;
    if (typeof a.v === 'number' && typeof b.v === 'number') c = a.v - b.v;
    else c = String(a.v).localeCompare(String(b.v), undefined, { sensitivity: 'base', numeric: true });
    if (c === 0) c = a.i - b.i;                                // stable: ties keep their original order
    return dir === 'asc' ? c : -c;
  });
  return withIndex.map((x) => x.r);
}
