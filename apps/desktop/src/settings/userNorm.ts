import type { Unit } from '@ceph/geometry';
import { byId, CATALOGUE, plausibilityErrors, type UserNorm } from '@ceph/analyses';

export interface UserNormDraft { setName: string; measurement: string; mean: string; sd: string; sourceNote: string }
export const MEASUREMENT_CHOICES = CATALOGUE.filter((e) => !e.retired).map((e) => ({ id: e.id, label: e.label, unit: e.unit as Unit }));
/** A user norm as typed: the set name, a live catalogue measurement, a numeric mean, an SD above 0 or blank (no SD,
 *  so no colour), and where it comes from. The store refuses the same blanks (ceph-store tests/norms.rs). */
/** Final review M-5 (Task 10 M3): a plain decimal only — never Number()'s hex (0x10), binary, octal, exponent (1e1) or
 *  "Infinity" forms; a typed minus sign "−" is read as "-". null when the text is not one. */
export function parseDecimal(text: string): number | null {
  const t = text.trim().replace(/^−/, '-');
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : null;
}
export function checkUserNorm(d: UserNormDraft): { ok: true; norm: UserNorm } | { ok: false; error: string } {
  const setName = d.setName.trim(), sourceNote = d.sourceNote.trim(), meanOrNull = parseDecimal(d.mean), sdText = d.sd.trim();
  if (!setName) return { ok: false, error: 'Name the set' };
  if (!MEASUREMENT_CHOICES.some((m) => m.id === d.measurement)) return { ok: false, error: 'Choose a measurement' };
  if (meanOrNull === null) return { ok: false, error: 'Type the mean as a number' };
  const mean = meanOrNull;
  const sd = sdText === '' ? null : parseDecimal(sdText);
  if (sdText !== '' && !(sd !== null && sd > 0)) return { ok: false, error: 'The SD must be more than 0' };
  if (!sourceNote) return { ok: false, error: 'Say where the norm comes from' };
  // Ruling T10-3 (12 Oct, review I3): the same plausibility check a published norm entry must pass — not a new
  // threshold, the shared PLAUSIBLE_BOUNDS/PLAUSIBLE_OVERRIDES (via `plausibilityErrors`, never copied).
  const unit = MEASUREMENT_CHOICES.find((m) => m.id === d.measurement)!.unit;
  const implausible = plausibilityErrors({ measurement: d.measurement, unit, mean, sd });
  if (implausible.length > 0) return { ok: false, error: implausible[0] };
  return { ok: true, norm: { setName, measurement: d.measurement, mean, sd, sourceNote } };
}
export function normSets(norms: UserNorm[]): { setName: string; rows: UserNorm[] }[] {
  const names = [...new Set(norms.map((n) => n.setName))].sort((a, b) => a.localeCompare(b));
  return names.map((setName) => ({ setName, rows: norms.filter((n) => n.setName === setName) }));
}
/** A measurement's catalogue label, falling back to its raw id if the id is unknown or was retired after a user
 *  norm was saved against it (edge case: a stored norm on a now-retired measurement must still render, not crash
 *  the whole Settings ▸ Norms list). */
export function measurementLabel(id: string): string {
  try { return byId(id).label; } catch { return id; }
}

/** Final review M-5 (Task 10 M4): deletes every row of one set, one at a time; a failure part-way says how many of how
 *  many went and why (the caller refreshes the list whatever happened). null when every row was deleted. */
export async function deleteSetRows(del: (setName: string, measurement: string) => Promise<unknown>, setName: string, rows: UserNorm[]): Promise<string | null> {
  let n = 0;
  try {
    for (const row of rows) { await del(row.setName, row.measurement); n++; }
    return null;
  } catch (e) {
    return `Only ${n} of ${rows.length} norms in “${setName}” were deleted (${e instanceof Error ? e.message : String(e)}).`;
  }
}
