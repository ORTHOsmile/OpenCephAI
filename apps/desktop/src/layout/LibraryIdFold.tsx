import { useEffect, useState } from 'react';
import type { CaseDoc } from '../ipc';
import type { DateFormat } from '../dates';
import { idsSeenLine, libraryHead, trailLines } from '../library/patientIds';

/** Owner D2 (19 Oct): the Library ID line is a fold heading in its own font and size, closed whenever a film opens
 *  (R8). Open, it shows the Patient IDs on this patient's X-rays (LIBID-1) and where its numbers went (L9-A). With
 *  nothing under it there is no triangle. */
export function LibraryIdFold({ doc, dateFormat, defaultOpen = false }: {
  doc: Pick<CaseDoc, 'id' | 'libraryId' | 'patientIdsSeen' | 'libraryTrail'>; dateFormat: DateFormat; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => { setOpen(defaultOpen); }, [doc.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const head = libraryHead(doc), ids = idsSeenLine(doc), trail = trailLines(doc, dateFormat);
  if (!ids && !trail.length) return <div className="library-fold"><div className="hint library-line">{head}</div></div>;
  return (
    <div className="library-fold">
      <button type="button" className="hint library-line toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <span className="tri" aria-hidden="true">{open ? '▾' : '▸'}</span>{head}</button>
      {open && ids && <div className="hint library-ids">{ids}</div>}
      {open && trail.length > 0 && <ul className="hint library-trail" aria-label="Library ID trail">
        {trail.map((t, i) => <li key={i}>{t}</li>)}</ul>}
    </div>
  );
}
