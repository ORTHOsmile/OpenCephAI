import { useState } from 'react';
import type { Paper } from './page';
import type { ReportOptions } from './model';
import { CsvOptions, csvDefaults, type CsvChoice } from './CsvOptions';

/** A failed save's message, as shown to the clinician (review m4): the backend's own write error already reads
 *  "Couldn't save the file (…). If it is open in another program, close it and try again." — prefixing it again
 *  would read as "Couldn't save: Couldn't save the file (…)". Only a message that does not already say so gets
 *  the prefix (the smoke's synthetic error, or an unexpected thrown value). Exported for its own unit test — the
 *  smoke's synthetic error never starts with "Couldn't save", so it could never catch this doubling. */
export const saveErrorText = (e: unknown): string => {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.startsWith("Couldn't save") ? msg : `Couldn't save: ${msg}`;
};

/** The Report preview's buttons (spec 2026-10-17): paper, with or without the film, the owner's export options
 *  (29 Oct 2026: Profilogram page, Norm sources, Placed by — each OFF by default and remembered per Mac, the same
 *  as `withFilm`), Save PDF…, the CSV choices and Export CSV…. A cancelled save says nothing; a failed one says
 *  why. Item 6 (owner, 29 Oct 2026): every control sits in its own named group (`.report-ctrl-group`) so narrowing
 *  the window drops a WHOLE group onto its own line rather than squeezing a label mid-word (tokens.css). */
export function ReportActions({ paper, onPaper, withFilm, onWithFilm, options, onOptions, film, onSavePdf, onSaveCsv }: {
  paper: Paper; onPaper: (p: Paper) => void; withFilm: boolean; onWithFilm: (on: boolean) => void;
  options: ReportOptions; onOptions: (o: ReportOptions) => void; film: string | null | 'loading';
  onSavePdf: () => Promise<boolean>; onSaveCsv: (c: CsvChoice) => Promise<boolean>;
}) {
  const [csv, setCsv] = useState<CsvChoice>(csvDefaults(1));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const act = async (what: 'pdf' | 'csv') => {
    setBusy(true); setMsg(null);
    try {
      if (await (what === 'pdf' ? onSavePdf() : onSaveCsv(csv))) setMsg({ ok: true, text: what === 'pdf' ? 'PDF saved.' : 'CSV saved.' });
    } catch (e) {
      setMsg({ ok: false, text: saveErrorText(e) });
    } finally { setBusy(false); }
  };
  const waiting = withFilm && film === 'loading';
  // review m1: an empty string (a broken `filmJpeg`) is also "no film" here — the same rule useReport.ts and
  // ReportPreview.tsx already apply, so the checkbox never disagrees with what the PDF actually contains.
  const noFilm = film === null || film === '';
  // Owner, 5 Nov 2026: the grid sits behind the profilogram page, so its box is greyed out (still showing its choice)
  // while that page is off.
  const opt = (k: keyof ReportOptions) => <label className="report-ctrl-group"><input type="checkbox" checked={options[k]} disabled={k === 'profilogramGrid' && !options.profilogramPage} onChange={(e) => onOptions({ ...options, [k]: e.target.checked })} /> {
    k === 'profilogramPage' ? 'Profilogram page' : k === 'normSources' ? 'Norm sources' : k === 'placedBy' ? 'Placed by' : k === 'pointsTable' ? 'Points table' : 'Grid behind the profilogram'}</label>;
  return (
    <>
      <span className="report-ctrl-group segmented" role="radiogroup" aria-label="Paper">{(['a4', 'letter'] as const).map((p) => (
        <button key={p} type="button" role="radio" aria-checked={paper === p} onClick={() => onPaper(p)}>{p === 'a4' ? 'A4' : 'Letter'}</button>))}</span>
      <label className="report-ctrl-group"><input type="checkbox" checked={withFilm && !noFilm} disabled={noFilm} onChange={(e) => onWithFilm(e.target.checked)} /> Include the film</label>
      {opt('profilogramPage')}
      {opt('profilogramGrid')}
      {opt('normSources')}
      {opt('placedBy')}
      {opt('pointsTable')}
      <button type="button" className="primary report-ctrl-group" disabled={busy || waiting} title={waiting ? 'Preparing the film image…' : undefined} onClick={() => void act('pdf')}>Save PDF…</button>
      <span className="sep" />
      <CsvOptions value={csv} onChange={setCsv} />
      <button type="button" className="report-ctrl-group" disabled={busy} onClick={() => void act('csv')}>Export CSV…</button>
      {msg && <span className={msg.ok ? 'hint' : 'report-error'} role="status">{msg.text}</span>}
    </>
  );
}
