import type { CaseSummary } from '../ipc';
import type { Orientation } from '../canvas/orientation';
import { formatDate, type DateFormat } from '../dates';
import { shownName } from './identity';

export type CaseStatus = 'none' | 'ai' | 'review' | 'verified';
export const STATUS_CHIP: Record<CaseStatus, string> = { review: 'To review', ai: 'AI · unverified', verified: 'Verified', none: 'Not traced' };
export type Nav = 'all' | 'recent' | 'review' | 'batch' | 'deleted';
export interface LibraryFilter { query: string; status: 'all' | 'review' | 'ai' | 'verified'; nav: Nav; patient: string | null; batch: string[] }
const RECENT_DAYS = 14;

export function caseStatus(c: CaseSummary): CaseStatus {
  if (c.verifiedAt) return 'verified';
  if (c.landmarks === 0) return 'none';
  return c.unverified === c.landmarks ? 'ai' : 'review';
}
const dateOf = (c: CaseSummary) => (c.takenOn ?? c.createdAt).slice(0, 10);
export function cardMeta(c: CaseSummary, fmt: DateFormat = 'AU'): string {
  const st = caseStatus(c), n = c.unverified, date = formatDate(dateOf(c), fmt);
  const tail = st === 'verified' ? 'verified' : st === 'ai' ? 'AI only'
    : st === 'review' ? (n ? `${n} landmark${n === 1 ? '' : 's'} to review` : 'ready to sign off') : '';
  return tail ? `${date} · ${tail}` : date;
}

/** One patient is one name key and date of birth (spec Part 2). */
export const patientIdOf = (c: Pick<CaseSummary, 'patientKey' | 'dateOfBirth'>) => `${c.patientKey}|${c.dateOfBirth ?? ''}`;
/** "Name · DOB" (spec Part 2), or the name alone when no date of birth is known. */
export const patientLabel = (name: string, dob: string | null, fmt: DateFormat) => (dob ? `${shownName(name)} · ${formatDate(dob, fmt)}` : shownName(name));

/**
 * The cases shown for a nav item, patient, status pill and search (case-insensitive substring of name, timepoint, dates
 * and date of birth, in ISO and the operator's format). The Review queue includes cases whose details need checking.
 */
/** A query that parses as a Library ID (e.g. "l-2", "L 1"), normalised to "L-" + its 5-digit form, lowercased to
 *  match the already-lowercased searched text (preflight 9a: comparing the raw normalised form against lowercased
 *  text never matched). */
const LIBRARY_ID_QUERY = /^\s*l-?\s*0*(\d+)\s*$/i;
function normalisedQuery(raw: string): string {
  const m = LIBRARY_ID_QUERY.exec(raw);
  return (m ? `L-${m[1].padStart(5, '0')}` : raw).toLowerCase();
}

export function filterCases(cases: CaseSummary[], f: LibraryFilter, now = Date.now(), fmt: DateFormat = 'AU'): CaseSummary[] {
  const q = normalisedQuery(f.query.trim());
  // Preflight 9b: a Patient-ID query must find every card of the patient it names, not only the card that carries
  // that ID itself — so each patient's full set of printed Patient IDs is searched for every one of its cards.
  const idsByPatient = new Map<string, string>();
  for (const c of cases) if (c.printedPatientId) {
    const key = patientIdOf(c);
    idsByPatient.set(key, `${idsByPatient.get(key) ?? ''} ${c.printedPatientId}`);
  }
  return cases.filter((c) => {
    const st = caseStatus(c);
    if (f.status !== 'all' && st !== f.status) return false;
    if (f.patient && patientIdOf(c) !== f.patient) return false;
    if (f.nav === 'review' && st !== 'review' && st !== 'ai' && c.identityChecked) return false;
    if (f.nav === 'recent' && now - Date.parse(c.updatedAt) > RECENT_DAYS * 864e5) return false;
    if (f.nav === 'batch' && !f.batch.includes(c.id)) return false;
    const dob = c.dateOfBirth ? `${c.dateOfBirth} ${formatDate(c.dateOfBirth, fmt)}` : '';
    const patientIds = idsByPatient.get(patientIdOf(c)) ?? '';
    return !q || `${c.patientName} ${c.timepoint} ${dateOf(c)} ${formatDate(dateOf(c), fmt)} ${c.createdAt.slice(0, 10)} ${dob} ${c.libraryId ?? ''} ${c.formerLibraryIds.join(' ')} ${patientIds}`
      .toLowerCase().includes(q);
  });
}
export function patientsOf(cases: CaseSummary[], fmt: DateFormat = 'AU'): { id: string; name: string; label: string; count: number }[] {
  const m = new Map<string, { id: string; name: string; label: string; count: number; dob: string }>();
  for (const c of cases) {
    const id = patientIdOf(c), e = m.get(id);
    if (e) e.count++;
    else m.set(id, { id, name: c.patientName, label: patientLabel(c.patientName, c.dateOfBirth, fmt), count: 1, dob: c.dateOfBirth ?? '' });
  }
  return [...m.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.dob.localeCompare(b.dob))
    .map(({ dob: _dob, ...p }) => p);
}

/**
 * CSS transform that shows a card's thumbnail as the case opens (decision 14): mirrored to face right, levelled to FH.
 * Mirror first, then rotate (D = R·M), then zoom just enough that the rotated film still fills its square.
 */
export function thumbTransform(o: Partial<Orientation> | null | undefined): string {
  const mirror = !!o?.mirror, deg = o?.rotDeg ?? 0;
  if (!mirror && !deg) return 'none';
  const t = (deg * Math.PI) / 180, zoom = Math.abs(Math.cos(t)) + Math.abs(Math.sin(t));
  return `rotate(${deg}deg)${mirror ? ' scaleX(-1)' : ''} scale(${Number.isInteger(zoom) ? zoom : zoom.toFixed(4)})`;
}
