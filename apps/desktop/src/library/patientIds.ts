// Library ID and Patient IDs on screen (addendum D2, LIBID-1): the patient's own number, the Patient IDs printed on
// its X-rays, the differing-ID note (owner Q8) and the link-suggestion text. SYNTHETIC values in the tests only.
import type { CaseDoc, IdMatch, TrailLine } from '../ipc';
import { formatDate, type DateFormat } from '../dates';
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
/** Owner L8: two printed Patient IDs are the same when equal ignoring spaces and capitals; never a near miss. */
export const sameId = (a: string, b: string) => norm(a) === norm(b);
/** Owner P3 (19 Oct): what the folded PATIENT heading names, so it is never unclear whose film is open (R7: an unnamed
 *  patient has no Library ID yet). */
export const foldedPatientNote = (d: Pick<CaseDoc, 'libraryId'>): string => d.libraryId ?? 'no Library ID yet';
/** LIBID-1, owner D2 (19 Oct): the Library ID fold's heading. */
export const libraryHead = (d: Pick<CaseDoc, 'libraryId'>): string =>
  (d.libraryId ? `Library ID ${d.libraryId}` : 'Library ID: given once the patient has a name');
/** LIBID-1: every Patient ID printed on the patient's X-rays, inside the Library ID fold; null when there is none. */
export const idsSeenLine = (d: Pick<CaseDoc, 'patientIdsSeen'>): string | null =>
  (d.patientIdsSeen.length ? `Patient IDs on this patient's X-rays: ${d.patientIdsSeen.join(', ')}` : null);
/** Owner Q8: this X-ray's ID differs from another X-ray's of the same patient — a subtle note, never a warning (Q5). */
export function differentIdNote(d: Pick<CaseDoc, 'printedPatientId' | 'patientIdsSeen'>): string | null {
  const own = d.printedPatientId; if (!own) return null;
  const others = d.patientIdsSeen.filter((x) => !sameId(x, own));
  return others.length ? `Other X-rays of this patient show Patient ID ${others.join(', ')}. This X-ray may be of a different patient, or taken on another machine or by another radiography company.` : null;
}
/** Owner L9-A: where this patient's numbers went, one plain line each, oldest first, dates in the operator's format.
 *  "this patient" stands for the patient's own number, so the line reads as the owner's example. */
export function trailLines(d: Pick<CaseDoc, 'libraryId' | 'libraryTrail'>, f: DateFormat): string[] {
  const here = (n: string) => (n === d.libraryId ? 'this patient' : n);
  return d.libraryTrail.map((t: TrailLine) => {
    const on = formatDate(t.on, f);
    if (t.kind === 'merged') return `${t.number} was merged into ${here(t.into)} on ${on}.`;
    const now = t.now ? `It is now ${t.now} (${t.name.trim() || 'no name yet'}).` : 'It has no name now, so it has no Library ID.';
    return `An X-ray left ${here(t.number)} on ${on}. ${now}`;
  });
}
/** LIBID-1: the same Patient ID on another patient's X-ray(s): a suggestion, never a join. */
export function matchText(m: IdMatch, own: string, f: DateFormat): string {
  const who = m.patient.dateOfBirth ? `${m.patient.name} · ${formatDate(m.patient.dateOfBirth, f)}` : m.patient.name;
  return `Patient ID ${own} is also on ${m.films} X-ray${m.films === 1 ? '' : 's'} of ${who} (${m.libraryId}).`;
}
