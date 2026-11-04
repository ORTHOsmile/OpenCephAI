import type { CaseDoc, Conflict, IdentityIssue, PatientRef } from '../ipc';
import { formatDate, type DateFormat } from '../dates';

/** A patient's name as shown: blank means nobody has entered it yet (owner, 29 Sep: blank beats a wrong name). */
export const shownName = (name: string) => name.trim() || 'Name needed';

const who = (p: PatientRef, f: DateFormat) => (p.dateOfBirth ? `${p.name} (born ${formatDate(p.dateOfBirth, f)})` : p.name);

/** One line per reason "Check patient details" asks (spec Part 1). */
export function issueText(i: IdentityIssue, f: DateFormat): string {
  switch (i.kind) {
    case 'nameNotRead': return 'No name could be read from the film label: type it in Patient, or use Text on the film.';
    case 'noDateOfBirth': return 'No date of birth was found.';
    case 'impossibleDate': return i.field === 'dateOfBirth' ? 'The date of birth is in the future or before 1900.' : 'The film date is in the future or before 1900.';
    case 'birthAfterScan': return 'The date of birth is after the film date.';
    case 'sameNameOtherBirth': return i.patient.dateOfBirth
      ? `${who(i.patient, f)} is already in the library with another date of birth.`
      : `${i.patient.name} is already in the library without a date of birth.`;
    case 'similarNameSameBirth': return `${who(i.patient, f)} has the same date of birth and a very similar name.`;
  }
}

/** The existing patients offered as "Same patient (use existing)", each once. */
export function sameAsCandidates(issues: IdentityIssue[]): PatientRef[] {
  const out: PatientRef[] = [];
  for (const i of issues) {
    if ((i.kind === 'sameNameOtherBirth' || i.kind === 'similarNameSameBirth')
      && !out.some((p) => p.name === i.patient.name && p.dateOfBirth === i.patient.dateOfBirth)) out.push(i.patient);
  }
  return out;
}

/** The grey note under Film date while the date came from the image file or the import date and nobody has confirmed it. */
export function filmDateNote(source: string | null): string | null {
  return source === 'image' ? 'From the image file' : source === 'import' ? 'Import date — please check' : null;
}

const CONFLICT_FIELDS: Record<string, string> = { name: 'Name', dob: 'Date of birth', scan_date: 'Film date', scan_id: 'Scan ID', patient_id: 'Patient ID' };
export const conflictFieldName = (field: string) => CONFLICT_FIELDS[field] ?? field;
/** Disagreements still open (owner, 30 Sep: M1): the detail is blank, or for the film date, still only the import day or
 *  the image file's own date (the label's date was not used), whether or not the details have been checked. Owner Q4
 *  (17 Oct): a Patient ID conflict is open only while this X-ray's own Patient ID is still blank. */
export function openConflicts(doc: Pick<CaseDoc, 'patientName' | 'dateOfBirth' | 'takenOnSource' | 'scanId' | 'printedPatientId'>, conflicts: Conflict[]): Conflict[] {
  const open: Record<string, boolean> = { name: !doc.patientName.trim(), dob: !doc.dateOfBirth,
    scan_date: doc.takenOnSource === 'import' || doc.takenOnSource === 'image', scan_id: !doc.scanId, patient_id: !doc.printedPatientId };
  return conflicts.filter((c) => open[c.field] ?? true);
}
/** One line for a field left blank because the label and this machine's learned default disagreed. */
export function conflictText(c: Conflict, f: DateFormat): string {
  const v = (x: string) => (c.field === 'dob' || c.field === 'scan_date' ? formatDate(x, f) : x);
  return `${CONFLICT_FIELDS[c.field] ?? c.field}: the film’s label says ${v(c.label)}; this machine usually has ${v(c.learned)} there.`;
}

/** Owner Q9/Q10 (addendum D2): the box words for each detail OK on the patient note can confirm, or a ✓ can accept. */
const LEARNED_WORDS: Record<string, string> = { name: 'name', dob: 'date of birth', scan_date: 'film date', scan_id: 'Scan ID',
  gender: 'Gender', patient_id: 'Patient ID', referrer: 'Referring practitioner', xray_type: 'X-ray type', xray_size: 'X-ray dimensions', practice: 'Radiography practice' };
/** Preflight ruling (Task 8, 8b): the addendum's own order ("name, date of birth, Gender, Patient ID, Referring
 *  practitioner, film date, X-ray type"), with Scan ID after film date and X-ray dimensions / Radiography practice
 *  after X-ray type. */
const NOTE_ORDER = ['name', 'dob', 'gender', 'patient_id', 'referrer', 'scan_date', 'scan_id', 'xray_type', 'xray_size', 'practice'];
/** Owner Q9: what OK on the patient note confirms — the details read from the film or learned, still unconfirmed. */
export function noteConfirms(d: CaseDoc): string[] {
  const fromFilm = d.identitySource === 'film';
  const on = new Set(d.learnedFields);
  if (fromFilm && d.patientName.trim()) on.add('name');
  if (fromFilm && d.dateOfBirth) on.add('dob');
  if (fromFilm && d.takenOnSource === 'label') on.add('scan_date');
  if (fromFilm && d.scanId) on.add('scan_id');
  return NOTE_ORDER.filter((f) => on.has(f)).map((f) => LEARNED_WORDS[f]);
}
/** Preflight ruling (Task 8, 8a): the note shows with a typed name too, once anything on this X-ray was learned. */
export const showsNote = (d: CaseDoc) => d.identityChecked && (d.identitySource === 'film' || d.learnedFields.length > 0);
