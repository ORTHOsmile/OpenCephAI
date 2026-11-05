import { useEffect, useState } from 'react';
import type { CaseDoc } from '../ipc';
import { ageIn, ageShown, NOT_AN_AGE, type FilmAge } from '../library/age';

/** Owner AG1 (19 Oct): the age under the patient details. With a DOB it is worked out (no box: the DOB wins); with no
 *  DOB the film's age, printed or typed, is in a box. The line says where the age came from; the note, when the film's
 *  age and the DOB disagree by more than a year, or the DOB cannot be checked. */
export function AgeRow({ doc, locked, onSave, onError }: {
  doc: Pick<CaseDoc, 'id' | 'dateOfBirth' | 'takenOn' | 'ageOnFilm' | 'ageOnFilmYears'>; locked: boolean;
  onSave: (a: FilmAge | null) => void; onError: (message: string) => void }) {
  const [draft, setDraft] = useState(doc.ageOnFilm ?? '');
  useEffect(() => { setDraft(doc.ageOnFilm ?? ''); }, [doc.id, doc.ageOnFilm]);
  const commit = () => {
    const t = draft.trim();
    if (!t) { if (doc.ageOnFilm) onSave(null); return; }
    if (t === doc.ageOnFilm) return;
    const a = ageIn(t, true);
    if (!a) { onError(NOT_AN_AGE); setDraft(doc.ageOnFilm ?? ''); return; }
    onSave(a);
  };
  const shown = ageShown(doc);
  return (
    <div className="age-row">
      {!doc.dateOfBirth && <label><span className="label-row">Age</span><input value={draft} disabled={locked} placeholder="e.g. 11 y 3 m"
        spellCheck={false} onChange={(e) => setDraft(e.target.value)} onBlur={commit}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>}
      {shown && <div className="hint age-line">{shown.text}</div>}
      {shown?.note && <div className="hint warn age-note" role="note">{shown.note}</div>}
    </div>
  );
}
