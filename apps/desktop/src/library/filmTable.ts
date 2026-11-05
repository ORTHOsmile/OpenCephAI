// Text on the film as a table (owner, 2 Oct; spec 2026-10-04): what choosing a detail for a line fills, and which detail
// each line already is. The lines themselves stay in memory only.
import type { CaseDoc } from '../ipc';
import type { DateFormat } from '../dates';
import { CHOOSE_LABELS, chosenValue, cleanedForLimit, DETAIL_MAX, type ChooseField, type DetailField } from './choose';
import { genderIn, referrerIn } from './filmText';
import { NOT_A_TITLE, splitTitle, titleIn } from './title';
import { ageIn, NOT_AN_AGE } from './age';

export type FilmChoice = 'none' | 'name' | 'last' | 'first' | 'dob' | 'date' | 'scan' | 'patientId' | 'xrayType' | 'xraySize' | 'practice' | 'referrer' | 'gender' | 'title' | 'age';
export type FilmDetail = Exclude<FilmChoice, 'none'>;
/** Drop-down choice → the Choose-on-the-film field it fills (none for Gender and Referring practitioner, which are
 *  read by valueFor). */
export const CHOOSE_FIELD_OF: Partial<Record<FilmDetail, ChooseField>> = { name: 'full', last: 'last', first: 'first', dob: 'dob', date: 'film_date', scan: 'scan_id',
  patientId: 'patient_id', xrayType: 'xray_type', xraySize: 'xray_size', practice: 'practice' };
/** Choose-on-the-film field → its drop-down choice: Settings › Text on the film switches both by this one id. */
export const CHOOSE_TO_DETAIL: Record<ChooseField, FilmDetail> = { full: 'name', last: 'last', first: 'first', dob: 'dob', film_date: 'date', scan_id: 'scan',
  patient_id: 'patientId', xray_type: 'xrayType', xray_size: 'xraySize', practice: 'practice' };
/** The box words (owner Q12): a detail's label is CHOOSE_LABELS' word for it (one source of words, shared with
 *  Choose on the film and Settings), via CHOOSE_FIELD_OF/CHOOSE_TO_DETAIL; Gender and Referring practitioner are not
 *  Choose-on-the-film fields, so they keep their own labels here (same words FilmLayouts.tsx uses, Task 7 X9). */
const DETAIL_LABEL: Record<FilmDetail, string> = {
  name: CHOOSE_LABELS.full, last: CHOOSE_LABELS.last, first: CHOOSE_LABELS.first, dob: CHOOSE_LABELS.dob, date: CHOOSE_LABELS.film_date,
  scan: CHOOSE_LABELS.scan_id, patientId: CHOOSE_LABELS.patient_id, xrayType: CHOOSE_LABELS.xray_type, xraySize: CHOOSE_LABELS.xray_size,
  practice: CHOOSE_LABELS.practice, gender: 'Gender', referrer: 'Referring practitioner', title: 'Title', age: 'Age',
};   // exhaustive over FilmDetail at compile time (no cast): a missing key here is a tsc error, not a silent `undefined` label.
/** One list for the "What it is" drop-down, the chooser on the X-ray and Settings › Text on the film, in the owner's
 *  order (E, 19 Oct). Title and Age join it with library format 13 (tasks 10, 11). */
export const FILM_CHOICES: { value: FilmChoice; label: string }[] = [
  { value: 'none', label: '—' }, { value: 'title', label: DETAIL_LABEL.title }, { value: 'name', label: DETAIL_LABEL.name }, { value: 'last', label: DETAIL_LABEL.last },
  { value: 'first', label: DETAIL_LABEL.first }, { value: 'dob', label: DETAIL_LABEL.dob }, { value: 'age', label: DETAIL_LABEL.age }, { value: 'gender', label: DETAIL_LABEL.gender },
  { value: 'date', label: DETAIL_LABEL.date }, { value: 'scan', label: DETAIL_LABEL.scan }, { value: 'patientId', label: DETAIL_LABEL.patientId },
  { value: 'xrayType', label: DETAIL_LABEL.xrayType }, { value: 'xraySize', label: DETAIL_LABEL.xraySize },
  { value: 'practice', label: DETAIL_LABEL.practice }, { value: 'referrer', label: DETAIL_LABEL.referrer },
];
/** Drop-down choice → the single-field save it uses (format 11). */
export const DETAIL_OF: Partial<Record<FilmDetail, DetailField>> = { patientId: 'patient_id', xrayType: 'xray_type', xraySize: 'xray_size', practice: 'practice' };
const NOT_A: Record<FilmDetail, string> = {
  name: "That line isn't a name", last: "That line isn't a name", first: "That line isn't a name", dob: "That line isn't a date",
  date: "That line isn't a date", scan: "That line isn't a Scan ID", patientId: "That line isn't an ID",
  xrayType: 'That line has no letters or numbers', xraySize: 'That line has no letters or numbers', practice: 'That line has no letters or numbers',
  referrer: "That line isn't a name", gender: "That line isn't F or M", title: NOT_A_TITLE, age: NOT_AN_AGE,
};

/** The value a line gives for a detail, or the note shown when it can't be read as that detail (nothing is filled). */
export function valueFor(d: FilmDetail, text: string, f: DateFormat): { value: string } | { note: string } {
  if (!text.trim()) return { note: 'That line is empty' };
  // Fix round 1 (review M3): measured on the CLEANED value (label and trailing comma stripped), exactly as Choose
  // on the film measures it (`cleanedForLimit`, choose.ts) — not on the raw line, which used to refuse a value
  // Choose on the film would have accepted (e.g. "PID " + a 198-character ID).
  const cf = CHOOSE_FIELD_OF[d];
  if (DETAIL_OF[d] && cf && [...cleanedForLimit(cf, text)].length > DETAIL_MAX) return { note: `That line is too long (over ${DETAIL_MAX} characters)` };
  const v = d === 'gender' ? genderIn(text) : d === 'referrer' ? referrerIn(text) : d === 'title' ? titleIn(text)
    : d === 'age' ? ageIn(text)?.text ?? null : chosenValue(cf!, text, f);
  return v ? { value: v } : { note: NOT_A[d] };
}

export type SavedDetails = Pick<CaseDoc, 'patientName' | 'dateOfBirth' | 'takenOn' | 'scanId' | 'gender' | 'referringPractitioner'
  | 'printedPatientId' | 'xrayType' | 'xraySize' | 'radiographyPractice' | 'title' | 'ageOnFilm'>;
const norm = (t: string) => t.toLowerCase().replace(/[,\s]+/g, ' ').trim();
/** Which detail each line already is: a line whose value equals a saved detail (case, commas and spacing ignored)
 *  shows it; each detail shows on its first matching line only, top to bottom; every other line shows —. Last and
 *  First come from a saved "Last, First" name (D8 known limit: no second shared "pending" state here — a Last
 *  chosen in the drop-down and a First chosen on the film do not join). */
export function savedChoices(lines: string[], doc: SavedDetails, f: DateFormat): FilmChoice[] {
  const c = doc.patientName.indexOf(',');
  const part = (s: string) => s.trim() || null;
  const saved: [FilmDetail, string | null][] = [['title', doc.title ?? null], ['name', doc.patientName.trim() || null],
    ['last', c < 0 ? null : part(doc.patientName.slice(0, c))], ['first', c < 0 ? null : part(doc.patientName.slice(c + 1))],
    ['dob', doc.dateOfBirth], ['age', doc.ageOnFilm ?? null], ['date', doc.takenOn], ['scan', doc.scanId], ['patientId', doc.printedPatientId ?? null],
    ['xrayType', doc.xrayType ?? null], ['xraySize', doc.xraySize ?? null], ['practice', doc.radiographyPractice ?? null],
    ['gender', doc.gender], ['referrer', doc.referringPractitioner]];
  const out: FilmChoice[] = lines.map(() => 'none');
  for (const [d, want] of saved) {
    if (!want) continue;
    const i = lines.findIndex((l, j) => {
      if (out[j] !== 'none') return false;
      const r = valueFor(d, l, f); if (!('value' in r)) return false;
      const v = d === 'name' ? splitTitle(r.value).rest : r.value;   // owner T1: "MR JOHN DEMO" is the saved "John Demo"
      return norm(v) === norm(want);
    });
    if (i >= 0) out[i] = d;
  }
  return out;
}

/** The drop-down's choices for one line (Settings › Text on the film, spec Q2 A): switched-off details are hidden,
 *  except the one this line already shows, so the screen never shows the wrong thing. */
export const visibleChoices = (off: ReadonlySet<FilmDetail>, current: FilmChoice): { value: FilmChoice; label: string }[] =>
  FILM_CHOICES.filter((c) => c.value === 'none' || c.value === current || !off.has(c.value as FilmDetail));

/** The chooser on the X-ray (owner E, 19 Oct): the same list as the drop-down, without "—", switched-off details
 *  hidden; from a Pick button (`target`) that one detail only, as asked. */
export function chooserChoices(off: ReadonlySet<FilmDetail>, target: FilmDetail | null): { value: FilmDetail; label: string }[] {
  const all = FILM_CHOICES.filter((c): c is { value: FilmDetail; label: string } => c.value !== 'none');
  return target ? all.filter((c) => c.value === target) : all.filter((c) => !off.has(c.value));
}

/** A row of "Text on the film": `original` is what was last read off the film for this row, `text` is what is
 *  shown (the owner's edit, or `original` when untouched). A row is EDITED when `text !== original`. `kept` marks
 *  an edited row whose film line is no longer in the latest reading — the owner's edit with nowhere to attach. */
export interface FilmRow { original: string; text: string; kept?: boolean }

/** The first reading of the film: every row unedited. */
export const fresh = (lines: string[]): FilmRow[] => lines.map((line) => ({ original: line, text: line }));

/** Owner's rule (approved in chat, 5 Oct): a line the owner edited is human-entered and is never overwritten by a
 *  re-read; a re-read only refreshes lines nobody edited. Covers both a full "Read the film again" and a
 *  Choose-on-the-film spot re-read (lines appended) with the one function — no "was this an append?" guess.
 *  Starts from `next` as the new reading. Each EDITED row of `prev`, in order, attaches its `text` to the first row
 *  of that new reading whose `original` matches and that no earlier edited row has already claimed; with no match,
 *  the edit is appended at the end, marked `kept: true`. Unedited rows of `prev` are simply replaced by the new
 *  reading (they claim nothing, so they don't need special handling). */
export function reread(prev: FilmRow[], next: string[]): FilmRow[] {
  const result: FilmRow[] = next.map((line) => ({ original: line, text: line }));
  const claimed = result.map(() => false);
  const kept: FilmRow[] = [];
  for (const row of prev) {
    if (row.text === row.original) continue;   // unedited: the new reading already replaces it
    const i = result.findIndex((r, j) => !claimed[j] && r.original === row.original);
    if (i >= 0) { result[i] = { original: result[i].original, text: row.text }; claimed[i] = true; }
    else kept.push({ original: row.original, text: row.text, kept: true });
  }
  return [...result, ...kept];
}

/** Where each EDITED row of `prev` sits in `next` (the result of `reread(prev, …)`), by the rule `reread` itself uses:
 *  the first still-unclaimed new row with the same `original`, else the next `kept` row at the end. Index = old index. */
export function editedRowsNow(prev: FilmRow[], next: FilmRow[]): Map<number, number> {
  const fresh_ = next.filter((r) => !r.kept).length;   // reread puts the new reading first, kept edits after it
  const claimed = new Array<boolean>(fresh_).fill(false);
  const out = new Map<number, number>();
  let keptAt = fresh_;
  prev.forEach((row, i) => {
    if (row.text === row.original) return;   // unedited: replaced by the new reading
    const j = next.findIndex((r, k) => k < fresh_ && !claimed[k] && r.original === row.original);
    if (j >= 0) { claimed[j] = true; out.set(i, j); } else out.set(i, keptAt++);
  });
  return out;
}

/** After a re-read, a note goes with its row when that row is still the owner's edit (in place or kept at the end);
 *  a note under an unedited row goes, as that row is refreshed from the new reading. */
export function notesAfterReread(prev: FilmRow[], next: FilmRow[], notes: Record<number, string>): Record<number, string> {
  const where = editedRowsNow(prev, next);
  const out: Record<number, string> = {};
  for (const [iStr, note] of Object.entries(notes)) {
    const j = where.get(+iStr);
    if (j !== undefined) out[j] = note;
  }
  return out;
}

/** The row waiting for "Now choose the ..." goes where its row went; null when that row is not an edit any more. */
export function waitingAfterReread(prev: FilmRow[], next: FilmRow[], waiting: number | null): number | null {
  return waiting === null ? null : editedRowsNow(prev, next).get(waiting) ?? null;
}

/** After ↺ removes a row, its note goes and every note below it moves up by one, to stay under its own row. */
export function notesAfterRemove(notes: Record<number, string>, removed: number): Record<number, string> {
  const out: Record<number, string> = {};
  for (const [iStr, note] of Object.entries(notes)) {
    const i = +iStr;
    if (i < removed) out[i] = note; else if (i > removed) out[i - 1] = note;
  }
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');
/** The local calendar day of a stored timestamp, as YYYY-MM-DD ("Imported …" under the table). */
export function importDay(createdAt: string): string {
  const d = new Date(createdAt);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
