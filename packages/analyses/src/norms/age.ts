/** The patient's age on the day the film was taken, in decimal years (N2 picks the norm's age row
 *  from it). Whole years are counted on the calendar, so the film taken on a birthday gives an exact
 *  whole number; the part-year is the days since the last birthday divided by 365.2425 (the mean
 *  Gregorian year). A 29 February birthday falls on 1 March in a non-leap year.
 *
 *  Dates are ISO 'YYYY-MM-DD' (a full ISO timestamp is accepted; only its date part is read, so a
 *  time zone never shifts the day). Returns null when either date is missing or not a real calendar
 *  date, or when the film is dated before the birth. */
export function ageAt(dateOfBirth: string | null, filmDate: string | null): number | null {
  const b = parseDay(dateOfBirth);
  const f = parseDay(filmDate);
  if (!b || !f) return null;
  const birth = Date.UTC(b.y, b.m - 1, b.d);
  const film = Date.UTC(f.y, f.m - 1, f.d);
  if (film < birth) return null;

  let years = f.y - b.y;
  // Last birthday on or before the film date (Date.UTC rolls 29 Feb into 1 Mar in a non-leap year).
  let lastBirthday = Date.UTC(b.y + years, b.m - 1, b.d);
  if (lastBirthday > film) {
    years -= 1;
    lastBirthday = Date.UTC(b.y + years, b.m - 1, b.d);
  }
  const days = Math.round((film - lastBirthday) / 86_400_000);
  return days === 0 ? years : years + days / 365.2425;
}

const DAY = /^(\d{4})-(\d{2})-(\d{2})(T.*)?$/;

function parseDay(s: string | null): { y: number; m: number; d: number } | null {
  if (typeof s !== 'string') return null;
  const m = DAY.exec(s.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  // A day that rolls over (30 February) is not a real date.
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return { y, m: mo, d };
}
