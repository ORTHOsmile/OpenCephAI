// Title (owner T1, 19 Oct; spec 2026-10-19 E): stored with the patient as printed. Pinned with the library's
// details::title_value to crates/ceph-store/tests/fixtures/titles.json.
export const TITLES = ['Mr', 'Mrs', 'Ms', 'Miss', 'Mx', 'Master', 'Mast', 'Mstr', 'Dr', 'Prof'] as const;
export const NOT_A_TITLE = "That isn't a title (Mr, Mrs, Ms, Miss, Master, Dr…)";
// A word that is a prefix of another comes after it ("mrs" before "mr", "master" before "mast") — the regex backtracks
// anyway; the order only makes the first try the right one.
const WORD = '(?:mrs|mr|ms|miss|mx|master|mast|mstr|dr|prof)';
const ALONE = new RegExp(String.raw`^\s*(?:title\b\s*[:-]?\s*)?(${WORD}\.?)[\s,]*$`, 'i');
const LEADING = new RegExp(String.raw`^\s*(${WORD}\.?)(?:\s+|(?<=\.))(?=\p{L})`, 'iu');

/** A line that is a title and nothing else ("Mr", "dr.", "Title: Mrs"), as printed; else null. */
export function titleIn(line: string): string | null {
  return ALONE.exec(line)?.[1] ?? null;
}
/** A Full name that starts with a title ("Mr John Smith"): the title, and the name without it. A name with no title
 *  (or nothing after the title) comes back whole, with no title. */
export function splitTitle(full: string): { title: string | null; rest: string } {
  const m = LEADING.exec(full);
  const rest = m ? full.slice(m[0].length).trim() : '';
  return m && rest ? { title: m[1], rest } : { title: null, rest: full };
}
/** The title before the name, as the panel and the report show it ("Mr John Smith"). */
export const titledName = (title: string | null, name: string): string => (title ? `${title} ${name}` : name);
