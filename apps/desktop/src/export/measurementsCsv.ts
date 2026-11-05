import type { Unit } from '@ceph/geometry';
import type { settings } from '../ipc';
import { fmtNumber, type Decimals } from '../format';
import { patientIdOf } from '../library/filter';
import type { FilmFacts, ReportModel, ReportRow } from '../report/model';
import type { ReportPoint } from '../report/points';
import { adjustedWords, fitMark, machineWords, type Scale } from '../tracing/spacing';
import { toCsv, type Column } from './csv';
import { sha256Hex } from './sha256';

/** Measurements CSV (spec 2026-10-17 report-exports; master plan §8): tidy (one row per film × measurement) or wide
 *  (one row per film). The numbers are the report's — the screen's — so a hidden mm value is blank, never a number. */
export type CsvLayout = 'tidy' | 'wide' | 'points';
export interface CsvOptions { anonymise: boolean; layout: CsvLayout; salt: string; exportedAt: string; decimals: Decimals }
export const SALT_KEY = 'export_salt';

/** Anonymised (ANON-1): no name, DOB or IDs; a code per patient and per film, the same in every export from this library (the salt is kept in its
 *  settings), that cannot be turned back into a name without the salt.
 *  Final review Minor 5: `patientIdOf` gives the same string ("|") for EVERY film whose patient has no name read
 *  and no date of birth — fine for the Library's own "same patient?" grouping (the owner already treats that as
 *  one unknown patient to review), but wrong here: it would code two DIFFERENT unnamed patients as the SAME "one
 *  patient" in an Anonymised export, misleading any longitudinal analysis of it. With no name to key on, fall back
 *  to the film's own id, so each such film gets its OWN code — never collapsed into another patient's, even though
 *  that means two films of the SAME unnamed patient (if the practice has one) also get different codes here. */
export const patientCode = (salt: string, f: Pick<FilmFacts, 'patientKey' | 'dateOfBirth'> & { id?: string }) =>
  `P-${sha256Hex(`${salt}|patient|${f.patientKey ? patientIdOf(f) : `film:${f.id ?? ''}`}`).slice(0, 10)}`;
export const filmCode = (salt: string, id: string) => `F-${sha256Hex(`${salt}|film|${id}`).slice(0, 10)}`;

const UNIT_NAME: Record<Unit, string> = { deg: 'deg', mm: 'mm', '%': '%', '': 'ratio' };
type T = { m: ReportModel; r?: ReportRow; pt?: ReportPoint };

function filmColumns(o: CsvOptions): Column<T>[] {
  const f = (t: T) => t.m.film;
  return [
    { name: 'film', get: (t) => (o.anonymise ? filmCode(o.salt, f(t).id) : f(t).id), text: true },
    { name: 'patient', get: (t) => (o.anonymise ? patientCode(o.salt, f(t)) : f(t).patientName.trim()), text: true },
    // L2 (preflight-rulings Task 11): the library Patient ID, straight after patient; blank when anonymised (ANON-1).
    { name: 'library_patient_id', get: (t) => (o.anonymise ? null : f(t).libraryId), text: true },
    { name: 'printed_patient_id', get: (t) => (o.anonymise ? null : f(t).printedPatientId), text: true },
    { name: 'scan_id', get: (t) => (o.anonymise ? null : f(t).scanId), text: true },
    { name: 'date_of_birth', get: (t) => (o.anonymise ? null : f(t).dateOfBirth) },
    { name: 'sex', get: (t) => f(t).gender ?? '' },
    { name: 'film_date', get: (t) => f(t).takenOn },   // ANON-1: kept when anonymised
    // Fix round 1, m1 (ruling): the brief's "2 decimals" is a display guarantee, not just a
    // rounding rule, so an exact whole-year age must still print "14.00" — stay a string, never re-parsed
    // back to a number (which would drop the trailing zero(s)).
    // Ruling R12 (19 Oct): the age the norms use (`filmAge` via the report's film facts) — with a DOB exactly as
    // before; with none, the film's printed or typed age.
    { name: 'age_years', get: (t) => (f(t).age === null ? null : f(t).age!.toFixed(2)) },
    // Ruling R12 (19 Oct): where age_years came from — 'dob', 'film' (printed or typed on the film), or blank.
    // Kept when anonymised, as the age is (ANON-1).
    { name: 'age_source', get: (t) => f(t).ageSource },
    { name: 'timepoint', get: (t) => f(t).timepoint, text: true },
  ];
}
/** Owner decision (20 Oct): in an Anonymised export, `verified_by` becomes a stable code per clinician — "Clinician
 *  1", "Clinician 2", … — assigned in order of first appearance across the WHOLE file (every film, in the order
 *  `measurementsCsv` is given them), kept for the clinician each time they verify another film in it. `meaning`,
 *  `timepoint` and `analysis` are untouched by Anonymised (ANON-1, final review Minor 7): those can describe the
 *  PATIENT if written carelessly, but `verified_by` names a CLINICIAN, who by definition is not the patient being
 *  de-identified — coding it removes a real name from the file without losing the "who verified this" grouping a
 *  researcher needs (the same clinician's films still share one code). A film with no name recorded (verified, but
 *  `verifiedBy` blank) gets no code — there is nothing to code. */
function clinicianCoder(): (name: string) => string {
  const codes = new Map<string, string>();
  return (name: string) => {
    let c = codes.get(name);
    if (c === undefined) { c = `Clinician ${codes.size + 1}`; codes.set(name, c); }
    return c;
  };
}
// Spec 2026-10-20 MS3: a machine's calibrated scale, named, with its source — anonymised drops the source film's
// date (MQ4); as stored, not the operator's date format (unlike the report header, which reads through `fmt`).
const scaleCell = (s: Scale, anonymise: boolean): string =>
  s.source === 'machine' ? machineWords(s.machine, (iso) => iso, anonymise)
    : s.source === 'calibration' ? (s.steps === 0 ? 'calibrated' : `calibrated scale${adjustedWords(s.steps)}`)
      : s.source === 'fit' ? fitMark(s.fit) : 'assumed';
function tailColumns(o: CsvOptions, clinicianOf: (name: string) => string): Column<T>[] {
  const f = (t: T) => t.m.film;
  return [
    // R3 (C), owner decision 20 Oct (option A): a fit's scale is named in words, the same as the screen and the
    // report's † note ("scaled to T1 on S–N (×1.042)", ", assumed scale" for G3); no new column.
    { name: 'scale', get: (t) => scaleCell(f(t).scale, o.anonymise) },
    { name: 'mm_per_px', get: (t) => f(t).scale.mmPerPx },
    { name: 'verified_by', get: (t) => {
        if (!f(t).verifiedAt) return null;
        const name = f(t).verifiedBy ?? '';
        return !name ? '' : o.anonymise ? clinicianOf(name) : name;
      }, text: true },
    { name: 'verified_at', get: (t) => f(t).verifiedAt },
    { name: 'models', get: (t) => f(t).models.join('; '), text: true },
    { name: 'exported_at', get: () => o.exportedAt },
    { name: 'app_version', get: (t) => t.m.app, text: true },
  ];
}
function measureColumns(o: CsvOptions): Column<T>[] {
  const r = (t: T) => t.r!;
  return [
    { name: 'analysis_id', get: (t) => r(t).analysisId },
    { name: 'analysis', get: (t) => t.m.blocks.find((b) => b.analysisId === r(t).analysisId)!.name, text: true },
    { name: 'measurement_id', get: (t) => r(t).node },
    { name: 'measurement', get: (t) => r(t).label, text: true },
    { name: 'value', get: (t) => r(t).num },
    { name: 'value_display', get: (t) => (r(t).num === null ? null : fmtNumber(r(t).num!, r(t).unit, o.decimals)) },
    { name: 'unit', get: (t) => UNIT_NAME[r(t).unit] },
    { name: 'status', get: (t) => r(t).status, text: true },
    { name: 'norm', get: (t) => r(t).norm, text: true },
    { name: 'norm_mean', get: (t) => r(t).mean },
    { name: 'norm_sd', get: (t) => r(t).sd },
    { name: 'z', get: (t) => r(t).z },
    { name: 'stars', get: (t) => r(t).stars },
    { name: 'severity', get: (t) => r(t).severity },
    { name: 'side', get: (t) => r(t).side },
    { name: 'meaning', get: (t) => r(t).meaning, text: true },
    { name: 'meaning_edited', get: (t) => (r(t).edited ? 'yes' : 'no') },
    { name: 'norm_source', get: (t) => r(t).sourceLine, text: true },
    // Owner ruling Q-A (24 Oct 2026): blank for a row the case's chosen population covers, and for a film with no
    // population at all, otherwise the AutoNote
    // step ('analysis-own' | 'caucasian' | 'anywhere') or, review I-4 + owner ruling (fix round 1, 25 Oct 2026),
    // 'chosen' when the clinician picked another population's source by hand (resolve.ts's `chosen-by-you` path) —
    // that row also compares the patient with another group's norm. Tidy layout only (I-1, fix round 1): the wide
    // layout has no norm, z or source columns at all, so Auto changes no number there to filter on. See
    // docs/norms/SEVERITY.md "In the report and the CSV".
    { name: 'norm_auto', get: (t) => r(t).autoStep ?? '', text: true },
  ];
}
/** Chain spec §5 (Part F Task 13): one row per point — its label and the structured columns. The anonymised file keeps
 *  them: they hold no patient data. `personal_model_version` stays blank until Tier 3 (S3). */
function pointColumns(): Column<T>[] {
  const p = (t: T) => t.pt!;
  return [
    { name: 'point', get: (t) => p(t).id, text: true },
    { name: 'point_name', get: (t) => p(t).name, text: true },
    { name: 'placed_by_label', get: (t) => p(t).label, text: true },
    { name: 'placed_by_model', get: (t) => p(t).model, text: true },
    { name: 'model_file', get: (t) => p(t).modelFile, text: true },
    { name: 'personal_model_version', get: () => null },
    { name: 'accept_kind', get: (t) => p(t).acceptKind, text: true },
    // Stage A: the placing model's point check at this point (`flagged`, `film-unusual`, or blank). The last point column.
    { name: 'point_check', get: (t) => p(t).pointCheck, text: true },
  ];
}
const blank: CsvOptions = { anonymise: false, layout: 'tidy', salt: '', exportedAt: '', decimals: 1 };
export const TIDY_COLUMNS = [...filmColumns(blank), ...measureColumns(blank), ...tailColumns(blank, clinicianCoder())].map((c) => c.name);
export const POINTS_COLUMNS = [...filmColumns(blank), ...pointColumns(), ...tailColumns(blank, clinicianCoder())].map((c) => c.name);

export function measurementsCsv(models: ReportModel[], o: CsvOptions): string {
  // One coder per export call, shared by every column/row it produces below — so a clinician's code is stable
  // across every film and every row of THIS file, assigned in the order their films are first seen in `models`.
  const clinicianOf = clinicianCoder();
  if (o.layout === 'points') {
    const rows: T[] = models.flatMap((m) => m.points.map((pt) => ({ m, pt })));
    return toCsv([...filmColumns(o), ...pointColumns(), ...tailColumns(o, clinicianOf)], rows);
  }
  if (o.layout === 'tidy') {
    const rows: T[] = models.flatMap((m) => m.blocks.flatMap((b) => b.rows.map((r) => ({ m, r }))));
    return toCsv([...filmColumns(o), ...measureColumns(o), ...tailColumns(o, clinicianOf)], rows);
  }
  const keys: { key: string; name: string }[] = [];
  for (const m of models) for (const b of m.blocks) for (const r of b.rows) {
    const name = `${r.analysisId}.${r.node}`;
    if (!keys.some((k) => k.name === name)) keys.push({ key: r.key, name });
  }
  const values: Column<T>[] = keys.map((k) => ({ name: k.name, get: (t) => t.m.blocks.flatMap((b) => b.rows).find((r) => r.key === k.key)?.num ?? null }));
  return toCsv([...filmColumns(o), ...values, ...tailColumns(o, clinicianOf)], models.map((m) => ({ m })));
}

/** The library's anonymising salt: made once from 16 random bytes and kept in its settings. A failed write stops the
 *  export rather than use a salt that would give different codes next time.
 *  Task 5 preflight ruling (Minor): two exports started together on an empty store must not race two different
 *  salts into existence — the in-flight read/write is memoised, cleared once settled (success or failure), so
 *  every concurrent caller on the SAME empty store waits for the SAME write and gets the SAME salt.
 *  Fix round 1, I1 (ruling): memoising with a single module-level variable leaked across DIFFERENT
 *  stores (two unrelated libraries racing would make one salt and silently skip the second store's own write).
 *  Keyed by the store object itself (`WeakMap<object, Promise<string>>`) so two different stores never share
 *  an in-flight promise, and the entry is deleted once settled (never pins the store in memory). */
const pending = new WeakMap<object, Promise<string>>();
export async function readSalt(s: Pick<typeof settings, 'get' | 'set'>, random: () => Uint8Array = () => crypto.getRandomValues(new Uint8Array(16))): Promise<string> {
  const have = await s.get(SALT_KEY);
  if (have && /^[0-9a-f]{32}$/.test(have)) return have;
  let p = pending.get(s);
  if (!p) {
    p = (async () => {
      const salt = [...random()].map((b) => b.toString(16).padStart(2, '0')).join('');
      await s.set(SALT_KEY, salt);
      return salt;
    })().finally(() => { pending.delete(s); });
    pending.set(s, p);
  }
  return p;
}
