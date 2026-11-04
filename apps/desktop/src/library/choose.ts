// Choose on the film (spec 2026-09-29 Part 1): selecting recognised words and turning them into a field's value.
import type { CaseDoc, FilmLine } from '../ipc';
import type { DateFormat } from '../dates';
import { dateTokenIn, isCutYear, usesOf } from './filmText';

export type ChooseField = 'last' | 'first' | 'full' | 'dob' | 'film_date' | 'scan_id' | 'patient_id' | 'xray_type' | 'xray_size' | 'practice';
export const CHOOSE_LABELS: Record<ChooseField, string> = {
  last: 'Last name', first: 'First name(s)', full: 'Full name', dob: 'DOB', film_date: 'Film date', scan_id: 'Scan ID',
  patient_id: 'Patient ID', xray_type: 'X-ray type', xray_size: 'X-ray dimensions', practice: 'Radiography practice',
};
/** The Choose-on-the-film buttons, in order (Settings › Text on the film can hide some, Task 8). */
export const ALL_CHOOSE_FIELDS: ChooseField[] = ['last', 'first', 'full', 'dob', 'film_date', 'scan_id', 'patient_id', 'xray_type', 'xray_size', 'practice'];
/** Format 11 (spec 2026-10-17): the details saved by their own single-field saves, never through CaseMeta. */
export type DetailField = 'patient_id' | 'xray_type' | 'xray_size' | 'practice';
export const DETAIL_FIELDS: DetailField[] = ['patient_id', 'xray_type', 'xray_size', 'practice'];
// Fix round 1 (review M2): a second hand-written KNOWN_DETAIL table duplicated DETAIL_FIELDS and could drift from
// it silently. The one true list is DETAIL_FIELDS; this is just `.includes` on it. The real guard against "a field
// wrongly left off DETAIL_FIELDS" is the TEST (choose.test.ts, D2): a table of known ids → true/false asserted
// against THIS function directly, independent of how it is implemented — not `DETAIL_FIELDS.filter(isDetailField)`,
// which would be a guard that cannot fail (every element of DETAIL_FIELDS passes `includes` on itself by
// construction, so that style of check would hold even if `isDetailField` or the list were wrong).
export const isDetailField = (f: string): f is DetailField => (DETAIL_FIELDS as string[]).includes(f);
/** The longest value of a new detail; the library refuses longer (ceph_label::layout::DETAIL_MAX_CHARS). Measured
 *  in Unicode code points ([...s].length), not UTF-16 units (s.length) — an astral character (e.g. an emoji) is one
 *  code point but two UTF-16 units, so counting with `.length` would refuse 100 code points too early. */
export const DETAIL_MAX = 200;
/** As printed: spaces tidied, at least one letter or number, at most DETAIL_MAX characters. */
export function asPrinted(t: string): string | null {
  const v = t.replace(/\s+/g, ' ').trim().replace(/,+$/, '');
  return /[\p{L}\p{N}]/u.test(v) && [...v].length <= DETAIL_MAX ? v : null;
}
/** Words `from..to` of one recognised line; with `next`, the selection runs on from `from` to the end of that line and
 *  onto the line below, words 0..next (owner, 30 Sep: a name that wraps onto the next line). */
export interface Sel { line: number; from: number; to: number; next?: number }

/** A click selects one word; shift-click extends along the same line, or onto the line below; clicking the only selected
 *  word clears. */
export function extendSel(sel: Sel | null, line: number, word: number, shift: boolean): Sel | null {
  if (shift && sel && sel.line === line) return { line, from: Math.min(sel.from, word), to: Math.max(sel.next === undefined ? sel.to : sel.from, word) };
  if (shift && sel && line === sel.line + 1) return { line: sel.line, from: sel.from, to: sel.to, next: word };
  if (!shift && sel && sel.line === line && sel.next === undefined && sel.from === word && sel.to === word) return null;
  return { line, from: word, to: word };
}
/** A press on a word dragged to another word on the same line selects the words between (owner, 30 Sep). */
export const dragSel = (start: { line: number; word: number }, line: number, word: number): Sel =>
  line === start.line ? { line, from: Math.min(start.word, word), to: Math.max(start.word, word) } : { line: start.line, from: start.word, to: start.word };
/** The runs of words a selection covers, one per line. */
export const selSpans = (lines: FilmLine[], s: Sel): Sel[] => (s.next === undefined ? [{ line: s.line, from: s.from, to: s.to }]
  : [{ line: s.line, from: s.from, to: Math.max(s.to, (lines[s.line]?.words.length ?? 1) - 1) }, { line: s.line + 1, from: 0, to: s.next }]);
/** The chosen words as one text; a name wrapped at its hyphen ("SMITH-" / "JONES") joins without a space (final review). */
export const selText = (lines: FilmLine[], s: Sel) =>
  selSpans(lines, s).map((p) => (lines[p.line]?.words ?? []).slice(p.from, p.to + 1).map((w) => w.text).join(' '))
    .reduce((a, b) => (a === '' ? b : a.endsWith('-') ? a + b : `${a} ${b}`), '');

/** Whether some words on the film read as the label's value for a field: dates by meaning, names and IDs by their
 *  letters and digits (case, commas and spacing ignored). */
export function labelMatcher(field: string, value: string, f: DateFormat): (text: string) => boolean {
  const norm = (t: string) => t.toLowerCase().replace(/[,\s]+/g, ' ').trim();
  if (field === 'dob' || field === 'scan_date') return (t) => usesOf(t, f).date === value;
  return (t) => norm(t) === norm(value);
}
/** The shortest run of words on one line that matches, first found top to bottom. */
export function locate(lines: FilmLine[], match: (text: string) => boolean): Sel | null {
  for (let n = 1; n <= 6; n++) for (const [i, l] of lines.entries()) for (let a = 0; a + n <= l.words.length; a++) {
    if (match(l.words.slice(a, a + n).map((w) => w.text).join(' '))) return { line: i, from: a, to: a + n - 1 };
  }
  return null;
}

/** A chosen DOB or Film date whose year lost its first digit as it was read ("987-Jan-02", owner 2 Oct; "024-Jan-12",
 *  owner 5 Oct — Film date gets the same completion as DOB): completed only when exactly one completion is a real
 *  date from 1900-01-01 to today, so "987" is 1987 and "012" is 2012; two valid completions, zero valid completions,
 *  or one landing after today all stay unread. */
function completedYear(t: string, f: DateFormat): string | null {
  const m = /^(\d{3})([\s./-].*)$/.exec(t);
  if (!m) return null;
  const n = new Date();   // LOCAL date (owner 5 Oct, M1): a film read in the evening in a zone ahead of UTC must not
  const today = `${n.getFullYear()}-${String(n.getMonth() + 1).padStart(2, '0')}-${String(n.getDate()).padStart(2, '0')}`;   // see "tomorrow" refused as "after today"
  const ok = ['1', '2'].map((c) => usesOf(c + m[1] + m[2], f).date).filter((d): d is string => !!d && d >= '1900-01-01' && d <= today);
  return ok.length === 1 ? ok[0] : null;
}
/** The value for a date field (DOB or Film date): a date whose own printed year is 2 digits AND is glued directly
 *  onto a cut-year scrap is refused (via `isCutYear`, filmText.ts — one shared decision, not a second copy of it
 *  here, reviewer fix round 4); the 3-digit cut-year completion (leading scraps ignored) stays as is. */
function dateFieldValue(t: string, f: DateFormat): string | null {
  const found = dateTokenIn(t, f);
  if (found) return isCutYear(t, found) ? null : found.date;
  const clean = t.replace(/^[^A-Za-z0-9]+/, '');
  return completedYear(clean, f);
}
/** Why a DOB or Film date choice came back null (owner 5 Oct, I2): 'cut-year' when the chosen words read as a date
 *  whose printed 2-digit year is glued to a cut-year scrap (item D) — a re-read of the SAME words (which can drop the
 *  scrap and find a plausible-looking date, e.g. ")24-Jan-12" re-read as "24-Jan-12") must not be trusted to fill the
 *  field; 'not-a-date' for anything else, where re-reading (a garbled OCR, not a cut year) is still worth trying.
 *  Sibling of `chosenValue`, which keeps its own signature for other callers (filmTable.ts). */
export function dateRefusal(field: ChooseField, text: string, f: DateFormat): 'cut-year' | 'not-a-date' | null {
  if (field !== 'dob' && field !== 'film_date') return null;
  const t = text.trim().replace(/,+$/, '');
  if (dateFieldValue(t, f) !== null) return null;
  const found = dateTokenIn(t, f);
  return found && isCutYear(t, found) ? 'cut-year' : 'not-a-date';
}
/** A Scan ID's label in front of it on the film ("Scan ID:", "Exam No.", "Accession #"). */
const ID_LABEL = /^\s*(?:(?:scan|exam(?:ination)?|study|patient|pt|acc(?:ession)?|image|chart|mrn|pid|id|no|nr|num(?:ber)?)\b\.?\s*)+[:#]?\s*|^\s*#\s*/i;

/** The text a field's 200-character limit is measured against: for Patient ID, the line with its printed label
 *  ("PID", "Patient ID:", …) and trailing comma stripped — the same text `chosenValue` reads the ID from; for
 *  X-ray type/dimensions/practice, spaces tidied and trimmed — the same text `asPrinted` tests. Fix round 1 (review
 *  M3): the drop-down (`filmTable.ts` `valueFor`) used to measure the limit on the RAW line, before this cleaning,
 *  so "PID " + a 198-character ID was refused there while Choose on the film (which always measured the cleaned
 *  value) accepted the very same value. One function now backs both paths. */
export function cleanedForLimit(field: ChooseField, text: string): string {
  const t = text.trim().replace(/,+$/, '');
  if (field === 'patient_id') return t.replace(ID_LABEL, '').trim();
  if (field === 'xray_type' || field === 'xray_size' || field === 'practice') return t.replace(/\s+/g, ' ').trim().replace(/,+$/, '');
  return t;
}
/** The field's value from the chosen words: names in title case, dates as ISO (by the date preference), a Scan ID as
 *  printed without its label (owner 2 Oct: IDs may hold letters, spaces, slashes or underscores). */
export function chosenValue(field: ChooseField, text: string, f: DateFormat): string | null {
  const t = text.trim().replace(/,+$/, '');
  if (field === 'dob' || field === 'film_date') return dateFieldValue(t, f);
  // D7 (preflight rulings): the 200-character limit applies to the new details (Patient ID included) ONLY — never
  // to Scan ID, which keeps its old, uncapped behaviour.
  if (field === 'scan_id') { const v = t.replace(ID_LABEL, '').trim(); return /[A-Za-z0-9]/.test(v) ? v : null; }
  if (field === 'patient_id') { const v = t.replace(ID_LABEL, '').trim(); return /[A-Za-z0-9]/.test(v) && [...v].length <= DETAIL_MAX ? v : null; }
  if (field === 'xray_type' || field === 'xray_size' || field === 'practice') return asPrinted(t);
  const name = usesOf(t, f).name;
  // Last/First are chosen as one name part on their own (unlike Full name, which keeps a multi-word OCR reading
  // exactly as printed — "van Demo, Anna" must stay "van" — see nameIn, filmText.ts): a part read as all-lowercase
  // ("john") has lost its casing outright and is capitalised here, local to the single-part fields.
  return (field === 'last' || field === 'first') && name && /^[\p{Ll}\s'’-]+$/u.test(name)
    ? name.replace(/\p{Ll}/u, (c) => c.toUpperCase()) : name;
}
export const composeName = (last: string | null, first: string | null) => (last && first ? `${last}, ${first}` : last ?? first ?? null);

/** The parts of a name chosen so far on the film but not yet saved. */
export interface NameParts { last: string | null; first: string | null }
/** Choosing a Last or First name (final review I5): either may come first. With the other part known — chosen earlier,
 *  or from a saved "Last, First" name — the whole name is saved; otherwise nothing is saved yet and the part waits. */
export function nameAfterChoosing(field: 'last' | 'first', value: string, current: string, pending: NameParts): { save: string | null; pending: NameParts } {
  const i = current.indexOf(',');
  const saved: NameParts = i < 0 ? { last: null, first: null } : { last: current.slice(0, i).trim() || null, first: current.slice(i + 1).trim() || null };
  const parts: NameParts = { last: pending.last ?? saved.last, first: pending.first ?? saved.first, [field]: value };
  return parts.last && parts.first ? { save: composeName(parts.last, parts.first), pending: { last: null, first: null } }
    : { save: null, pending: { last: field === 'last' ? value : pending.last, first: field === 'first' ? value : pending.first } };
}

/** The recognised word under a point (0–1 of the stored film), if any. */
export function wordAt(lines: FilmLine[], p: { x: number; y: number }): { line: number; word: number } | null {
  for (const [i, l] of lines.entries()) for (const [j, w] of l.words.entries()) {
    const [x, y, bw, bh] = w.bbox;
    if (p.x >= x && p.x <= x + bw && p.y >= y && p.y <= y + bh) return { line: i, word: j };
  }
  return null;
}

/** Fields to offer in Choose mode: blank ones, and ones filled from a learned default and not yet confirmed. */
export function unsureFields(doc: CaseDoc): ChooseField[] {
  const out: ChooseField[] = [];
  const learned = (f: string) => doc.learnedFields.includes(f);
  if (!doc.patientName.trim() || learned('name')) out.push('full');
  if (!doc.dateOfBirth || learned('dob')) out.push('dob');
  if (doc.takenOnSource === 'import' || learned('scan_date')) out.push('film_date');
  if (!doc.scanId || learned('scan_id')) out.push('scan_id');
  return out;
}
