// "Text on the film" (owner, 29 Sep): the recognised label lines, shown so they can be copied or put into a field.
// They live in memory only and are never saved or logged. These helpers only decide what each line could fill.
import type { DateFormat } from '../dates';
import type { Gender } from '../ipc';

export interface LineUses { name: string | null; date: string | null; id: string | null }

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
// P4 (owner 6 Oct, fix round 4): a month name must be a WHOLE word — "jan" is a month, but the first three letters
// of "Marcus", "Janine", "Decubitus" and "Marsden" are not. The old `[a-z]*\.?` consumed any trailing letters, so it
// read "Marcus 12 34" as 12 March 2034. Each month is spelled out (its abbreviation and its full name) with a word
// boundary right after, before the optional '.'; alternation backtracking tries every alternative at this position,
// so "January" still matches via the "january" branch even though "jan" is tried first and fails its own boundary.
const MON = '(jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|' +
  'oct|october|nov|november|dec|december)\\b\\.?';
// A date's own boundary: like \b, but '_' counts as a scrap (NOT a letter/digit) rather than a word character, so
// "_24/01/2012" is found at all (owner 6 Oct, fix round 3, item 4: "'_' counts as a scrap"). \b alone treats '_' as
// a word char and would refuse to match right after it.
const B1 = '(?<![A-Za-z0-9])', B2 = '(?![A-Za-z0-9])';
const iso = (y: number, m: number, d: number) =>
  m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate()
    ? `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` : null;
const month = (w: string) => MONTHS.indexOf(w.slice(0, 3).toLowerCase()) + 1;
/** A two-digit year is 20yy unless that is after this year, then 19yy ("16" → 2016, "90" → 1990), as the label reader. */
const fullYear = (y: string) => (y.length === 4 ? +y : 2000 + +y > new Date().getFullYear() ? 1900 + +y : 2000 + +y);

/** The first date on a line, its position, and whether its printed year had all 4 digits — so a caller can judge
 *  the DATE TOKEN itself (owner 6 Oct, item D), not scan the whole remainder for anything that merely looks like a
 *  cut year. `index` is where the date's own text starts in `line`. */
export interface DateToken { date: string; index: number; fourDigitYear: boolean }

/** Whether the character directly before `index` in `t` is a punctuation "scrap" glued onto a date's first
 *  character — a hint the year's leading digit(s) were sheared off by the film edge — UNLESS that character is a
 *  ':' directly after a letter, which is a label separator ("DOB:24-Jan-12"), not a cut (owner 6 Oct, item D). The
 *  one shared test, used by every date reader below and by `choose.ts`'s DOB/Film date logic — no second copy. */
export function scrapBefore(t: string, index: number): boolean {
  if (index <= 0) return false;                                       // nothing before the date: no cut possible
  const before = t[index - 1];
  if (/[A-Za-z0-9\s]/.test(before)) return false;                      // a letter, digit or space is not a scrap
  if (before === ':' && /[A-Za-z]/.test(t[index - 2] ?? '')) return false;   // a label separator, not a cut
  return true;
}

/** One match of a date shape before any filtering: `date` is null when the shape is syntactically a date (the
 *  right count of digit groups) but not a real calendar date — day 31 in April, month 13 — which the EARLIEST
 *  rule (below) must still see and block on, rather than skip past (owner 6 Oct, fix round 4, patch P1). */
interface Reading { date: string | null; index: number; fourDigitYear: boolean; yearDigits: number; year: number }

/** P3 (owner 6 Oct, fix round 4): a token followed by AM/PM (any case, optional space/dots), or a 2-digit
 *  "year" glued to ':' ';' or '.' and two digits, is a time's hour, not a year — discarded outright, never
 *  merely out-ranked. The ':' half of this is the pre-existing rule from fix round 3 (item 2: "Jan 24 12:30"
 *  must not read its "12" as a cut 2012); AM/PM and ';'/'.' are added here. */
function isTimeNotDate(line: string, end: number, yearDigits: number): boolean {
  if (/^[\s.]*[ap]\.?m\.?\b/i.test(line.slice(end))) return true;              // "12.30 PM", "10.02.24PM"
  return yearDigits === 2 && /^[:;.]\d{2}/.test(line.slice(end));              // "12:30", "12;30", "12.30"
}
/** P2 (owner 6 Oct, fix round 4): a reading directly after one of these labels (case-insensitive, optional ':'
 *  '#' '.') is not a date reading — it is skipped outright, and the EARLIEST rule (dateTokenIn) considers the
 *  next reading as if this one never matched (so P1's impossible-blanks rule does not apply to it either). */
const NOT_A_DATE_LABEL = /\b(?:patient\s*id|accession|exam\s*no|scan\s*id|version|chart|pid|acc|mrn|ver|exp|kv|mas|ma|no|id)[:#.]?\s*$/i;
/** P5 (owner 6 Oct, fix round 4): a printed 4-digit year outside 1900..(this year + 1), local time, is not a
 *  plausible date — that reading is skipped, as if it never matched ("1430 Feb 07, 2024": "1430 Feb 07" is
 *  skipped by this rule, leaving "Feb 07, 2024" to read). Only applies to a literally printed 4-digit year
 *  (fourDigitYear), never to a 2-digit year (those are already bounded into a plausible range by `fullYear`). */
const inPlausibleYearRange = (y: number): boolean => y >= 1900 && y <= new Date().getFullYear() + 1;

/** Every reading of the five date shapes, wherever it starts on the line, filtered down to the ones that are
 *  genuinely date-reading candidates at all — everything else here is removed outright, never merely out-ranked,
 *  so patch P1 (below) never sees it and can't block the line on its account (owner 6 Oct, fix round 4):
 *  - P2: a reading directly after a not-a-date label (PID, Acc, Exp, kV, No, Ver, …) is not a date reading.
 *  - P3: a token followed by AM/PM, or a 2-digit "year" glued to ':' ';' or '.' and two digits, is a time.
 *  - P5: a printed 4-digit year outside 1900..(this year + 1), local time, is not a plausible date.
 *  What remains can still be `date: null` (P1 catches that at the EARLIEST-reading step). More than one match of
 *  the same shape can occur on one line, so every pattern is scanned with a global flag, not just its first match. */
function allReadings(line: string, f: DateFormat): Reading[] {
  const out: Reading[] = [];
  const push = (re: RegExp, parse: (m: RegExpMatchArray) => { date: string | null; fourDigitYear: boolean; yearDigits: number; year: number }) => {
    for (const m of line.matchAll(re)) {
      const r = parse(m);
      const index = m.index ?? 0;
      const end = index + m[0].length;
      if (isTimeNotDate(line, end, r.yearDigits)) continue;             // P3
      if (NOT_A_DATE_LABEL.test(line.slice(0, index))) continue;        // P2
      if (r.fourDigitYear && !inPlausibleYearRange(r.year)) continue;   // P5
      out.push({ date: r.date, index, fourDigitYear: r.fourDigitYear, yearDigits: r.yearDigits, year: r.year });
    }
  };
  push(new RegExp(`${B1}(\\d{4})[-/.](\\d{1,2})[-/.](\\d{1,2})${B2}`, 'g'),
    (m) => ({ date: iso(+m[1], +m[2], +m[3]), fourDigitYear: true, yearDigits: 4, year: +m[1] }));
  push(new RegExp(`${B1}(\\d{4})[\\s./-]+${MON}[\\s./-]+(\\d{1,2})${B2}`, 'gi'), (m) =>   // 1987-Jan-02
    ({ date: iso(+m[1], month(m[2]), +m[3]), fourDigitYear: true, yearDigits: 4, year: +m[1] }));
  push(new RegExp(`${B1}(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{4}|\\d{2})${B2}`, 'g'), (m) => {
    const y = fullYear(m[3]);
    return { date: f === 'US' ? iso(y, +m[1], +m[2]) : iso(y, +m[2], +m[1]), fourDigitYear: m[3].length === 4, yearDigits: m[3].length, year: y };
  });
  push(new RegExp(`${B1}${MON}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4}|\\d{2})${B2}`, 'gi'), (m) =>
    ({ date: iso(fullYear(m[3]), month(m[1]), +m[2]), fourDigitYear: m[3].length === 4, yearDigits: m[3].length, year: fullYear(m[3]) }));
  push(new RegExp(`${B1}(\\d{1,2})(?:st|nd|rd|th)?[\\s.\\-]*${MON}[\\s.,\\-]*(\\d{4}|\\d{2})${B2}`, 'gi'), (m) =>
    ({ date: iso(fullYear(m[3]), month(m[2]), +m[1]), fourDigitYear: m[3].length === 4, yearDigits: m[3].length, year: fullYear(m[3]) }));
  return out;
}

/** The EARLIEST reading on the line, genuine or not, as ISO: 2024-02-07, 2024-Feb-07, 07/02/2024 or 07/02/24 (day
 *  or month first by the preference), Feb 07, 2024, 7 Feb 2024; with its position and printed year width (owner 6
 *  Oct, fix round 3: the old code tried its five shapes in a fixed PATTERN order and returned on the first one
 *  that matched anywhere on the line, so a later, unrelated shape — a time written with dots or dashes, or a
 *  second genuine date — could out-rank the real, and sometimes cut, date). An IMPOSSIBLE earliest reading (a
 *  date shape that is not a real calendar date) returns null — the line blanks, with no fall-through to a later,
 *  real date (owner 6 Oct, fix round 4, patch P1). Does NOT itself apply the cut-year rule: callers that need it
 *  call `scrapBefore`/`isCutYear` on the result (see `dateIn` below and `choose.ts`'s `dateFieldValue`), so
 *  `dateRefusal` can still tell a cut-year refusal from any other one. */
export function dateTokenIn(line: string, f: DateFormat): DateToken | null {
  const found = allReadings(line, f);
  if (!found.length) return null;
  const earliest = found.reduce((a, b) => (b.index < a.index ? b : a));
  return earliest.date === null ? null : { date: earliest.date, index: earliest.index, fourDigitYear: earliest.fourDigitYear };
}
/** Whether a found date token is a CUT YEAR (owner's ruling, 6 Oct, fix round 3, item 3): its printed year is 2
 *  digits AND it is glued directly onto a cut-year scrap (`scrapBefore`). The single shared decision behind
 *  `dateIn` here and `choose.ts`'s `dateFieldValue`/`dateRefusal` (reviewer, fix round 4: those two used to carry
 *  their own copy of this same `found.fourDigitYear || !scrapBefore(...)` expression — one copy now, used by all
 *  three; no caller else where decides the same question). */
export const isCutYear = (line: string, found: DateToken): boolean => !found.fourDigitYear && scrapBefore(line, found.index);
/** The earliest date reading, with the cut-year rule applied: a cut-year reading fills nothing — the line does
 *  NOT fall through to a later date. Shared by `usesOf` here and by `choose.ts`'s DOB/Film date value, so the
 *  rule lives in one place for every caller. */
const dateIn = (line: string, f: DateFormat): string | null => {
  const found = dateTokenIn(line, f);
  if (!found) return null;
  return isCutYear(line, found) ? null : found.date;
};

const ID = /\b(?:patient\s*id|pid|mrn|chart(?:\s*no)?|id|acc(?:ession)?(?:\s*(?:no|number))?)\b\.?\s*[:#]?\s*#?\s*([A-Za-z0-9][A-Za-z0-9.-]*)/i;
/** A labelled ID or accession number, or a line that is only a number. */
function idIn(line: string): string | null {
  const m = ID.exec(line) ?? /^\s*#?\s*([A-Za-z0-9][A-Za-z0-9.-]*)\s*$/.exec(line);
  const v = m?.[1].replace(/[.-]+$/, '');
  return v && /\d/.test(v) ? v : null;
}

/** Capitals become title case part by part ("DEMO" → "Demo", "McDEMO" → "McDemo"); anything else stays as printed. */
const titlePart = (p: string) => (/^\p{Lu}{2,}$/u.test(p) ? p[0] + p.slice(1).toLowerCase()
  : /^Mc\p{Lu}{2,}$/u.test(p) ? `Mc${p[2]}${p.slice(3).toLowerCase()}` : p);
/** A line without digits, its label dropped, with at least one word of two letters. */
function nameIn(line: string): string | null {
  if (/\d/.test(line)) return null;
  const v = line.replace(/^\s*(?:patient\s*name|patient|pt(?:\s*name)?|name)\b\s*[:-]?\s*/i, '').trim().replace(/[\s,;:/-]+$/, '');
  return /\p{L}{2,}/u.test(v) ? v.split(/([\s,'’-]+)/).map(titlePart).join('') : null;
}

/** What a line could fill: Patient, a date (Date of birth or Film date) or Scan ID. A date line offers only the date. */
export function usesOf(line: string, f: DateFormat): LineUses {
  const date = dateIn(line, f);
  return { name: nameIn(line), date, id: date ? null : idIn(line) };
}

const G_LABEL = String.raw`(?:(?:sex|gender)\b\s*[:-]?\s*)?`, G_WORD = '(female|male|f|m)';
const G_BRACKETED = new RegExp(String.raw`^\s*${G_LABEL}[(\[]\s*${G_WORD}\s*[)\]](?![\p{L}\p{N}])`, 'iu');   // "(M)", "Sex: [F]"
const G_DOTTED = new RegExp(String.raw`^\s*${G_LABEL}${G_WORD}\.\s*$`, 'iu');                                // "M." alone
const G_PLAIN = new RegExp(String.raw`^\s*${G_LABEL}${G_WORD}(?![\p{L}\p{N}.])`, 'iu');                       // "M, Y34", "Sex: F"
const G_ANOTHER = /(?<![\p{L}\p{N}])(?:female|male|f|m)(?![\p{L}\p{N}])/iu;
/** Gender printed on the film (spec 2026-10-04; owner E, 19 Oct): F or M (or Female, Male) at the start of the line,
 *  after an optional "Sex" or "Gender" label, standing alone ("M, Y34", "Sex: F"), in brackets ("(M)", "Sex: [F]") or
 *  with a full stop and nothing after ("M."). A line holding a second lone F or M ("M F", "F (M)") is refused, as is
 *  anything else: blank beats wrong. Pinned with Rust's `gender_in` to `gender_referrer_lines.json`. */
export function genderIn(line: string): Gender | null {
  const m = G_BRACKETED.exec(line) ?? G_DOTTED.exec(line) ?? G_PLAIN.exec(line);
  if (!m || G_ANOTHER.test(line.slice(m.index + m[0].length))) return null;
  return m[1][0].toUpperCase() as Gender;
}

const REF_LABEL = /^\s*(?:referred\s+by\b\s*:?|ref\.?\s*by\b\s*:?|referr(?:ing|al)?(?:\s+(?:doctor|practitioner|physician|dr\.?))?\s*:|ref\b\.?\s*:?)\s*/i;
/** A referring practitioner (spec 2026-10-04): the line without a leading label ("Ref:", "Ref. by", "Referred by",
 *  "Referring Dr:"), keeping "Dr"; null when no name is left. */
export function referrerIn(line: string): string | null {
  const v = line.replace(REF_LABEL, '').trim().replace(/[\s,;:]+$/, '');
  return /\p{L}{2,}/u.test(v) ? v : null;
}
