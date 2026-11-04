import { useMemo, useState, type ReactNode } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { CaseSummary } from '../ipc';
import type { DateFormat } from '../dates';
import { caseStatus, cardMeta, filterCases, patientsOf, STATUS_CHIP, thumbTransform, type LibraryFilter, type Nav } from './filter';
import { shownName } from './identity';
import { FilmLayouts } from './FilmLayouts';

interface Props {
  cases: CaseSummary[]; deleted: CaseSummary[]; batch: string[]; busy: string | null; error: string | null; notice: string | null; modelNote: ReactNode;
  onOpen: (id: string) => void; onImport: () => void; onDelete: (c: CaseSummary) => void; onRestore: (id: string) => void;
  onBackup: () => void; onRestoreBackup: () => void;
  operator: string; onOperator: (name: string) => void;
  dateFormat: DateFormat; onDateFormat: (f: DateFormat) => void;
}
const NAV: [Nav, string][] = [['all', 'All cases'], ['recent', 'Recent'], ['review', 'Review queue'], ['batch', 'Last batch'], ['deleted', 'Recently deleted']];
const STATUS: [LibraryFilter['status'], string][] = [['all', 'All'], ['review', 'To review'], ['ai', 'AI only'], ['verified', 'Verified']];

/** Board 2: every case on this Mac, by patient and status. Cards open the case; nothing here leaves the machine. */
export function LibraryView(p: Props) {
  const [f, setF] = useState<LibraryFilter>({ query: '', status: 'all', nav: 'all', patient: null, batch: [] });
  const inBin = f.nav === 'deleted';
  const shown = useMemo(() => (inBin ? filterCases(p.deleted, { ...f, nav: 'all', status: 'all', patient: null, batch: [] }, Date.now(), p.dateFormat)
    : filterCases(p.cases, { ...f, batch: p.batch }, Date.now(), p.dateFormat)), [inBin, p.cases, p.deleted, p.batch, f, p.dateFormat]);
  const patients = useMemo(() => patientsOf(p.cases, p.dateFormat), [p.cases, p.dateFormat]);
  const count = (n: Nav) => (n === 'deleted' ? p.deleted.length : filterCases(p.cases, { query: '', status: 'all', nav: n, patient: null, batch: p.batch }).length);
  const title = f.patient ? patients.find((x) => x.id === f.patient)?.label ?? '' : NAV.find(([n]) => n === f.nav)![1];
  return (
    <div className="library">
      <header className="toolbar lib-toolbar" data-tauri-drag-region>
        <div className="title brand-title" role="img" aria-label="OpenCephAI library" data-tauri-drag-region></div>
        <input type="search" aria-label="Search the library" placeholder="Search patients, dates of birth, timepoints, dates" value={f.query} onChange={(e) => setF({ ...f, query: e.target.value })} />
        <button type="button" onClick={p.onBackup}>Back up…</button>
        <button type="button" onClick={p.onRestoreBackup}>Restore…</button>
        <button type="button" className="primary" disabled={!!p.busy} onClick={p.onImport}>Import…</button>
      </header>
      <nav className="lib-nav" aria-label="Library">
        <div className="lib-head">LIBRARY</div>
        {NAV.map(([n, label]) => (
          <button key={n} type="button" aria-current={f.nav === n && !f.patient} onClick={() => setF({ ...f, nav: n, patient: null })}>{label}<span>{count(n)}</span></button>))}
        <div className="lib-head">PATIENTS</div>
        {patients.map((x) => (
          <button key={x.id} type="button" aria-current={f.patient === x.id} onClick={() => setF({ ...f, nav: 'all', patient: x.id })}>{x.label}<span>{x.count}</span></button>))}
        <div className="lib-head">PREFERENCES</div>
        <label className="lib-operator">Your name (audit trail)
          <input key={p.operator} defaultValue={p.operator} placeholder="macOS login name" aria-label="Your name for the audit trail"
            onBlur={(e) => { if (e.target.value.trim() !== p.operator) p.onOperator(e.target.value.trim()); }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} /></label>
        <div className="lib-operator">Dates
          <div className="segmented" role="radiogroup" aria-label="Date format">
            {(['AU', 'US'] as const).map((d) => (
              <button key={d} type="button" role="radio" aria-checked={p.dateFormat === d} onClick={() => p.onDateFormat(d)}>
                {d === 'AU' ? 'DD/MM/YYYY' : 'MM/DD/YYYY'}</button>))}
          </div></div>
        <FilmLayouts />
        <div className="hint lib-model">{p.modelNote}</div>
      </nav>
      <main className="lib-main">
        <div className="lib-title">
          <h1>{title}</h1><span className="hint">{shown.length} {shown.length === 1 ? 'case' : 'cases'} · most recent first</span>
          {!inBin && <div className="segmented" role="radiogroup" aria-label="Status">{STATUS.map(([s, label]) => (
            <button key={s} type="button" role="radio" aria-checked={f.status === s} onClick={() => setF({ ...f, status: s })}>{label}</button>))}</div>}
        </div>
        {p.busy && <div className="hint" role="status">{p.busy}</div>}
        {p.notice && <div className="hint" role="status">{p.notice}</div>}
        {p.error && <div className="error">{p.error}</div>}
        {shown.length === 0
          ? <div className="lib-empty">{p.cases.length || inBin ? 'No cases match. Try another search or filter.' : 'Drop cephalograms anywhere in this window to import them, or press ⌘O.'}</div>
          : <ul className="cards">{shown.map((c) => {
              const st = caseStatus(c);
              return (
                <li key={c.id} className="card">
                  <button type="button" className="open" disabled={inBin} aria-label={`Open ${shownName(c.patientName)} ${c.timepoint}`} onClick={() => p.onOpen(c.id)}>
                    <span className="thumb"><img src={convertFileSrc(c.thumbPath)} alt="" style={{ transform: thumbTransform(c.orientation) }} /></span>
                    <span className={`lib-chip ${st}`}>{STATUS_CHIP[st]}</span>
                    {!c.identityChecked && <span className="lib-chip check">Check details</span>}
                    <b className={c.patientName.trim() ? undefined : 'needs'}>{shownName(c.patientName)}</b><span className="tp">{c.timepoint}</span>
                    <span className="meta">{cardMeta(c, p.dateFormat)}</span>
                  </button>
                  {inBin ? <button type="button" className="card-action" onClick={() => p.onRestore(c.id)}>Restore</button>
                    : <button type="button" className="card-action del" title="Move to Recently deleted" aria-label={`Delete ${shownName(c.patientName)} ${c.timepoint}`} onClick={() => p.onDelete(c)}>Delete</button>}
                </li>);
            })}</ul>}
        <p className="hint">Cases live only on this Mac, never in git or the cloud. Recently deleted cases are removed after 30 days.</p>
      </main>
    </div>
  );
}
