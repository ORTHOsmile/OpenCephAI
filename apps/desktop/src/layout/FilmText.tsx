import { useContext, useEffect, useRef, useState } from 'react';
import { formatDate, type DateFormat } from '../dates';
import type { CaseDoc } from '../ipc';
import { fresh, importDay, notesAfterRemove, notesAfterReread, reread, waitingAfterReread, savedChoices, valueFor, visibleChoices, type FilmChoice, type FilmDetail, type FilmRow } from '../library/filmTable';
import { FilmDetailsOff } from '../settings/filmDetails';

interface Props {
  lines: string[] | null; reading: boolean; locked: boolean; dateFormat: DateFormat; doc: CaseDoc;
  onRead: () => void; onUse: (detail: FilmDetail, value: string) => string | null;
}

/** Text on the film as a table (owner, 2 Oct; spec 2026-10-04): each line read off the film, editable, and what it is.
 *  The lines and any edits are held in memory only: never saved or logged. Only the details they fill are saved. */
export function FilmText({ lines, reading, locked, dateFormat, doc, onRead, onUse }: Props) {
  const off = useContext(FilmDetailsOff);
  const [rows, setRows] = useState<FilmRow[]>(() => fresh(lines ?? []));
  const [notes, setNotes] = useState<Record<number, string>>({});
  const waiting = useRef<number | null>(null);   // the row whose note says "Now choose the …" (Last/First, spec 2026-10-17)
  const [copied, setCopied] = useState<number | 'all' | null>(null);
  /** Owner's rule (approved in chat, 5 Oct): a line the owner edited is human-entered and is never overwritten by a
   *  re-read; a re-read only refreshes lines nobody edited. Covers both a full "Read the film again" and a
   *  Choose-on-the-film spot re-read (lines appended, useCase.ts readArea) with the one `reread` function. */
  useEffect(() => {
    const next = lines ?? [];
    const nextRows = reread(rows, next);
    setRows(nextRows);
    setNotes((prevNotes) => notesAfterReread(rows, nextRows, prevNotes));   // a note follows its row when that row is still the owner's edit
    waiting.current = waitingAfterReread(rows, nextRows, waiting.current);   // the "Now choose the …" row moves with its row
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines]);
  const texts = rows.map((r) => r.text);
  const shown = savedChoices(texts, doc, dateFormat);
  const copy = (text: string, which: number | 'all') => {
    void navigator.clipboard?.writeText(text).then(() => { setCopied(which); setTimeout(() => setCopied(null), 1200); }).catch(() => {});
  };
  const choose = (i: number, c: FilmChoice) => {
    if (c === 'none') return;                                              // — never clears a saved detail
    const r = valueFor(c, texts[i], dateFormat);
    if ('note' in r) { setNotes((n) => ({ ...n, [i]: r.note })); return; }
    const note = onUse(c, r.value);
    const prevWaiting = waiting.current;   // read before the ref is retargeted below — the updater may run after this function returns
    setNotes((n) => {
      const next = { ...n };
      if (prevWaiting !== null) delete next[prevWaiting];
      delete next[i];
      if (note) next[i] = note;
      return next;
    });
    waiting.current = note ? i : null;
  };
  /** The ↺ button: on an edited row, undoes the edit (the row becomes unedited); on a `kept` row (its film line is
   *  no longer in the latest reading) there is nothing to undo TO, so it removes the row instead. */
  const undo = (i: number) => {
    const removes = rows[i].kept;
    setRows((rs) => (rs[i].kept ? rs.filter((_, j) => j !== i) : rs.map((r, j) => (j === i ? { original: r.original, text: r.original } : r))));
    if (!removes) { setNotes((n) => { const next = { ...n }; delete next[i]; return next; }); return; }
    setNotes((n) => notesAfterRemove(n, i));   // the row is gone: notes below it move up with their rows
    const w = waiting.current;                 // and so does the row that is waiting for "Now choose the …"
    if (w !== null) waiting.current = w === i ? null : w > i ? w - 1 : w;
  };
  /** Auto-grows the row's textarea to its content, so a long line is shown whole with no scrollbar (spreadsheet
   *  look, owner 5 Oct). Re-runs on every render — rows are few, and it has to see edits as they come in. */
  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  };
  /** M4 (owner, 5 Oct): autosize above only recalcs on React re-render — a long line can be cut off after the panel
   *  (not the content) resizes, e.g. the window narrowing wraps a line onto an extra row without any row re-render.
   *  A ResizeObserver on the table recalcs every row's textarea whenever the table's own box changes size. */
  const resizeObs = useRef<ResizeObserver | null>(null);
  const attachTable = (el: HTMLTableElement | null) => {
    resizeObs.current?.disconnect();
    if (!el) return;
    resizeObs.current = new ResizeObserver(() => { el.querySelectorAll<HTMLTextAreaElement>('.film-line').forEach(autosize); });
    resizeObs.current.observe(el);
  };
  useEffect(() => () => resizeObs.current?.disconnect(), []);
  return (
    <div className="film-text">
      {lines === null ? <p className="identity-note film-text-unread">Not read yet.</p>
        : !lines.length && !rows.length ? <p className="identity-note film-text-none">No text was found on the film.</p>
        : <table ref={attachTable} className="film-table" aria-label="Text on the film">
            <thead><tr><th>Text</th><th>What it is</th><th aria-label="Copy" /></tr></thead>
            <tbody>{rows.flatMap((row, i) => {
              const edited = row.text !== row.original;
              const label = row.kept ? `Remove your edit for line ${i + 1}` : `Use the film's text for line ${i + 1}`;
              const shaded = i % 2 === 1;
              const out = [
                <tr key={i} className={shaded ? 'film-row shade' : 'film-row'}>
                  <td><textarea ref={autosize} className="film-line" aria-label={`Line ${i + 1}`} value={row.text} disabled={locked}
                        spellCheck={false} rows={1} wrap="soft"
                        onChange={(e) => {
                          // N (owner, 6 Oct): a newline can land here by more paths than onPaste's own handling
                          // covers — a paste of a bare "\r" (no "\n", which that regex missed), drag-and-drop (no
                          // "paste" event at all), Ctrl+O (an Emacs-style "insert newline" some browsers honour in a
                          // textarea). Stripping CR/LF here, on every change, closes all of them in one place.
                          const v = e.target.value.replace(/\r\n|\r|\n/g, ' ');
                          setRows((rs) => rs.map((r, j) => (j === i ? { ...r, text: v } : r)));
                        }}
                        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && e.nativeEvent.keyCode !== 229) e.preventDefault(); }}
                        onPaste={(e) => {
                          // M3 (owner, 5 Oct): one film line is one spreadsheet cell — a pasted multi-line value is
                          // flattened to spaces, never turned into extra lines inside the cell.
                          const text = e.clipboardData.getData('text');
                          if (!/\r?\n/.test(text)) return;
                          e.preventDefault();
                          const el = e.currentTarget, clean = text.replace(/\r?\n/g, ' ');
                          const start = el.selectionStart ?? el.value.length, end = el.selectionEnd ?? el.value.length;
                          const v = el.value.slice(0, start) + clean + el.value.slice(end);
                          setRows((rs) => rs.map((r, j) => (j === i ? { ...r, text: v } : r)));
                        }} /></td>
                  <td><select aria-label={`What line ${i + 1} is`} value={shown[i]} disabled={locked}
                        onChange={(e) => choose(i, e.target.value as FilmChoice)}>
                        {visibleChoices(off, shown[i]).map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</select></td>
                  <td className="film-actions">
                    <button type="button" className="icon-btn" aria-label={`Copy line ${i + 1}`} title="Copy" onClick={() => copy(row.text, i)}>{copied === i ? '✓' : '⧉'}</button>
                    {edited && <button type="button" className="film-undo icon-btn" aria-label={label} title={label} onClick={() => undo(i)}>↺</button>}
                  </td>
                </tr>,
              ];
              if (row.kept || notes[i]) out.push(
                <tr key={`${i}-note`} className={shaded ? 'shade film-note-row' : 'film-note-row'}><td colSpan={3}>
                  {row.kept && <div className="kept-hint" role="status">Your edit — this line wasn't in the latest reading</div>}
                  {notes[i] && <div className="hint warn" role="status">{notes[i]}</div>}
                </td></tr>,
              );
              return out;
            })}</tbody>
          </table>}
      <p className="film-imported">Imported {formatDate(importDay(doc.createdAt), dateFormat)}</p>
      <div className="row wrap">
        {!!texts.length && <button type="button" onClick={() => copy(texts.join('\n'), 'all')}>{copied === 'all' ? 'Copied' : 'Copy all'}</button>}
        <button type="button" disabled={locked || reading} onClick={onRead}>{reading ? 'Reading…' : lines === null ? 'Read the film' : 'Read the film again'}</button>
      </div>
    </div>
  );
}
