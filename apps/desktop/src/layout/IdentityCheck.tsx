import type { CaseDoc, PatientRef } from '../ipc';
import { formatDate, type DateFormat } from '../dates';
import { issueText, noteConfirms, sameAsCandidates, showsNote } from '../library/identity';

interface Props {
  doc: CaseDoc; dateFormat: DateFormat; busy: boolean; onConfirm: (sameAs: PatientRef | null) => void; onEdit: () => void;
  /** Opens Choose mode on the film, when the film's text has been read. */
  onChoose?: () => void;
}

/** The patient's own learned details (identity::merge_reads): only these make the patient note read "Learned for
 *  this machine". A learned Patient ID, X-ray type, dimensions or practice has its own tag on its own box (film
 *  details, pre-flight S3), so it never relabels a name that came from the label. */
const PATIENT_LEARNED = ['name', 'dob', 'scan_date', 'scan_id'];

/**
 * "Check patient details" (spec Part 1, option C): shown only when the label read was unsure. Otherwise, details that
 * came from the film carry a small "Read from the film" note until a person edits them or presses OK.
 */
export function IdentityCheck({ doc, dateFormat, busy, onConfirm, onEdit, onChoose }: Props) {
  if (doc.identityChecked) {
    if (!showsNote(doc)) return null;
    // Preflight ruling (Task 8, 8a): a typed name with something learned on this X-ray still reads "Learned for
    // this machine" — only a film-sourced name with nothing patient-level learned keeps "Read from the film".
    const heading = doc.identitySource === 'film' && !doc.learnedFields.some((f) => PATIENT_LEARNED.includes(f))
      ? 'Read from the film' : 'Learned for this machine';
    const confirms = noteConfirms(doc);
    return (
      <div className="identity-note" role="status">
        {heading}{confirms.length > 0 && ` · OK confirms: ${confirms.join(', ')}`}{' '}
        <button type="button" disabled={busy} onClick={() => onConfirm(null)}>OK</button>
      </div>
    );
  }
  const same = sameAsCandidates(doc.identityIssues);
  return (
    <div className="identity-check" role="alert">
      <b>Check patient details</b>
      <ul>{doc.identityIssues.map((i, k) => <li key={k}>{issueText(i, dateFormat)}</li>)}</ul>
      <div className="row wrap">
        {same.map((p) => (
          <button key={`${p.name}|${p.dateOfBirth ?? ''}`} type="button" disabled={busy} onClick={() => onConfirm(p)}>
            Same patient: {p.name}{p.dateOfBirth ? ` · ${formatDate(p.dateOfBirth, dateFormat)}` : ''}</button>))}
        {doc.patientName.trim()
          ? <><button type="button" disabled={busy} onClick={() => onConfirm(null)}>{same.length ? 'Different patient' : 'Details are right'}</button>
            <button type="button" disabled={busy} onClick={onEdit}>Edit</button></>
          : <button type="button" className="primary" disabled={busy} onClick={onEdit}>Type the name</button>}
        {onChoose && <button type="button" disabled={busy} onClick={onChoose}>Choose on the film</button>}
      </div>
    </div>
  );
}
