import type { CaseSummary } from '../ipc';

/** Library ▸ Select (spec 2026-10-17 report-exports): the films chosen for one CSV. */
export function toggle(chosen: ReadonlySet<string>, id: string): Set<string> {
  const next = new Set(chosen);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
}
/** The chosen films still in the library, in library order (a film deleted since it was chosen is left out). */
export const exportable = (chosen: ReadonlySet<string>, live: CaseSummary[]): string[] => live.filter((c) => chosen.has(c.id)).map((c) => c.id);
