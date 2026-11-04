// Dates in the operator's format (spec 2026-09-28): stored ISO YYYY-MM-DD, shown and typed day first (AU) or month first (US).
export type DateFormat = 'AU' | 'US';
export const DATE_FORMAT_KEY = 'dateFormat';
export const parseDateFormat = (v: string | null | undefined): DateFormat => (v === 'US' ? 'US' : 'AU');
export const datePlaceholder = (f: DateFormat) => (f === 'US' ? 'MM/DD/YYYY' : 'DD/MM/YYYY');

/** ISO date (or timestamp) → DD/MM/YYYY or MM/DD/YYYY; anything else is returned unchanged. */
export function formatDate(iso: string | null | undefined, f: DateFormat): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
  if (!m) return iso ?? '';
  return f === 'US' ? `${m[2]}/${m[3]}/${m[1]}` : `${m[3]}/${m[2]}/${m[1]}`;
}

const real = (y: number, m: number, d: number) => m >= 1 && m <= 12 && d >= 1 && d <= new Date(Date.UTC(y, m, 0)).getUTCDate();

/** A typed date → ISO. Day/month order follows the preference; ISO is always accepted; four-digit years only.
 *  null = the field was left blank; undefined = not a real date (the field keeps its old value). */
export function parseDateInput(text: string, f: DateFormat): string | null | undefined {
  const t = text.trim();
  if (!t) return null;
  let y: number, mo: number, d: number, m: RegExpExecArray | null;
  if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t))) [y, mo, d] = [+m[1], +m[2], +m[3]];
  else if ((m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(t))) [y, mo, d] = f === 'US' ? [+m[3], +m[1], +m[2]] : [+m[3], +m[2], +m[1]];
  else return undefined;
  return real(y, mo, d) ? `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` : undefined;
}
