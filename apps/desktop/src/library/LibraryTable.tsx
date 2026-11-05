import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CaseSummary } from '../ipc';
import type { DateFormat } from '../dates';
import { formatDate } from '../dates';
import { shownName } from './identity';
import { dobAge } from './age';
import { aiStatusLabel } from './aiStatus';
import type { SortDir } from './tableSort';
import { aiSummary, filmDate, flatOrder, groupPatients, localDay, patientKeyAction, type FilmValue, type Key, type Sort } from './tableRows';
import type { TableLayout } from './view';

/** Library ▸ Table (owner decisions, 29 Oct 2026, item B as revised): no images. Grouped (the default): one row per
 *  patient, collapsed, that opens (▸/▾, Enter, Space, →/←) to its films in timepoint order; a search opens every patient
 *  with a matching film. Flat: every film its own row. A film row opens its film (click, or Enter or Space on its name
 *  button); its Report date opens that film's PDF export. A header click sorts — the patients in Grouped, the films in
 *  Flat. */
interface Props {
  rows: CaseSummary[]; dateFormat: DateFormat; titleOf: (id: string) => string; inBin: boolean;
  selecting: boolean; chosen: ReadonlySet<string>; onToggle: (id: string) => void;
  onOpen: (id: string) => void; onDelete: (c: CaseSummary) => void; onRestore: (id: string) => void;
  layout: TableLayout;
  /** The search box's text: while it holds anything, every patient shown is open (the rows are already filtered). */
  query: string;
  /** The Report column's date: open this film at its PDF export, to save the report again. */
  onReport: (id: string) => void;
}
/** Final review I-1: the Patient panel's own age (`dobAge`, which `ageShown` reads): DOB to the SCAN date, calendar
 *  months; none (a dash) without a scan date or a DOB — never measured to the import date. */
const ageOf = (c: CaseSummary) => dobAge(c.dateOfBirth, c.takenOn);

const COLUMNS: { key: Key; label: string }[] = [
  { key: 'name', label: 'Name' }, { key: 'dob', label: 'DOB' }, { key: 'timepoint', label: 'Timepoint' },
  { key: 'scanDate', label: 'Date of scan' }, { key: 'sex', label: 'M/F' }, { key: 'age', label: 'Age' },
  { key: 'aiStatus', label: 'AI status' }, { key: 'report', label: 'Report' },
];

/** Review minor 3: the M/F column shows M or F only; anything else stored there, or nothing, reads as a dash. */
export const sexText = (g: string | null | undefined): string => (g === 'M' || g === 'F' ? g : '—');
/** Review minor 4: the arrow is decoration — `aria-sort` on the header already says which way — so screen readers skip it. */
export function SortArrow({ dir }: { dir: SortDir }) { return <span aria-hidden="true">{dir === 'asc' ? ' ▲' : ' ▼'}</span>; }

export function LibraryTable(p: Props) {
  const [sort, setSort] = useState<Sort | null>(null);
  // Grouped: which patients are open. Without a search, the clinician's own choice (all start closed); with one, every
  // patient shown starts open and `closedInSearch` holds the ones closed by hand, forgotten when the search changes.
  const [open, setOpen] = useState<ReadonlySet<string>>(new Set());
  const [closedInSearch, setClosedInSearch] = useState<ReadonlySet<string>>(new Set());
  const searching = p.query.trim() !== '';
  useEffect(() => setClosedInSearch(new Set()), [p.query]);
  const isOpen = (id: string) => (searching ? !closedInSearch.has(id) : open.has(id));
  const setOpenTo = (id: string, to: boolean) => {
    const flip = (s: ReadonlySet<string>, add: boolean) => { const n = new Set(s); if (add) n.add(id); else n.delete(id); return n; };
    if (searching) setClosedInSearch((s) => flip(s, !to)); else setOpen((s) => flip(s, to));
  };

  const reportDay = (c: CaseSummary) => (c.reportSavedAt ? localDay(c.reportSavedAt) : null);
  const value: FilmValue = (c, key) => {
    switch (key) {
      case 'name': return shownName(c.patientName).toLowerCase();
      case 'dob': return c.dateOfBirth;
      case 'timepoint': return c.timepoint;
      case 'scanDate': return filmDate(c);
      case 'sex': return c.gender === 'M' || c.gender === 'F' ? c.gender : null;
      case 'age': return ageOf(c)?.months ?? null;
      case 'aiStatus': return aiStatusLabel(c, p.titleOf, p.dateFormat);
      case 'report': return reportDay(c);
    }
  };
  const groups = useMemo(() => (p.layout === 'grouped' ? groupPatients(p.rows, sort, value) : []), [p.rows, sort, p.layout, p.titleOf, p.dateFormat]);   // eslint-disable-line react-hooks/exhaustive-deps
  const flat = useMemo(() => (p.layout === 'flat' ? flatOrder(p.rows, sort, value) : []), [p.rows, sort, p.layout, p.titleOf, p.dateFormat]);   // eslint-disable-line react-hooks/exhaustive-deps
  const onSort = (key: Key) => setSort((s) => (s?.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: 'asc' }));
  const ariaSort = (key: Key): 'ascending' | 'descending' | 'none' =>
    (sort?.key === key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none');

  const openRow = (c: CaseSummary) => (p.selecting ? p.onToggle(c.id) : p.onOpen(c.id));
  const filmRow = (c: CaseSummary, inGroup: boolean): ReactNode => {
    const age = ageOf(c);
    const chosen = p.chosen.has(c.id);
    const name = shownName(c.patientName), day = reportDay(c);
    return (
      <tr key={c.id} className={inGroup ? 'lib-film in-group' : 'lib-film'} onClick={p.inBin ? undefined : () => openRow(c)}>
        {p.selecting && <td className={chosen ? 'pick on' : 'pick'} aria-hidden="true">{chosen ? '✓' : ''}</td>}
        <td>{p.inBin ? name
          // Review I1: a real button, so Enter and Space both open the film and it is announced as a button. Its click
          // bubbles to the row's own onClick (one handler, not two).
          : <button type="button" className="lib-open" aria-pressed={p.selecting ? chosen : undefined}
              aria-label={`${p.selecting ? 'Choose' : 'Open'} ${name} ${c.timepoint}`}>{name}</button>}</td>
        <td>{formatDate(c.dateOfBirth, p.dateFormat)}</td>
        <td>{c.timepoint}</td>
        <td>{formatDate(filmDate(c), p.dateFormat)}</td>
        <td>{sexText(c.gender)}</td>
        <td>{age?.text ?? '—'}</td>
        <td>{aiStatusLabel(c, p.titleOf, p.dateFormat)}</td>
        <td>{day && (p.inBin ? formatDate(day, p.dateFormat)
          : <button type="button" className="lib-report" aria-label={`Save the report again for ${name} ${c.timepoint} (last saved ${formatDate(day, p.dateFormat)})`}
              onClick={(e) => { e.stopPropagation(); p.onReport(c.id); }}>{formatDate(day, p.dateFormat)}</button>)}</td>
        <td>
          {p.inBin ? <button type="button" onClick={(e) => { e.stopPropagation(); p.onRestore(c.id); }}>Restore</button>
            : !p.selecting && <button type="button" className="del" title="Move to Recently deleted"
                aria-label={`Delete ${name} ${c.timepoint}`}
                onClick={(e) => { e.stopPropagation(); p.onDelete(c); }}>Delete</button>}
        </td>
      </tr>);
  };
  return (
    <table className="lib-table">
      <thead>
        <tr>
          {p.selecting && <th scope="col" aria-label="Choose" />}
          {COLUMNS.map(({ key, label }) => (
            <th key={key} scope="col" aria-sort={ariaSort(key)}>
              <button type="button" onClick={() => onSort(key)}>{label}{sort?.key === key && <SortArrow dir={sort.dir} />}</button>
            </th>))}
          <th scope="col" aria-label="Actions" />
        </tr>
      </thead>
      <tbody>
        {p.layout === 'flat' ? flat.map((c) => filmRow(c, false)) : groups.map((g) => {
          const first = g.films[0], name = shownName(first.patientName), n = g.films.length, on = isOpen(g.id);
          return [
            // The patient row: its name is a disclosure button (Enter/Space toggle it natively; →/← open and close).
            <tr key={g.id} className="lib-patient" onClick={() => setOpenTo(g.id, !on)}>
              {p.selecting && <td />}
              <td><button type="button" className="lib-open lib-toggle" aria-expanded={on} aria-label={`${name}, ${n} ${n === 1 ? 'film' : 'films'}`}
                onKeyDown={(e) => { const a = patientKeyAction(e.key, on); if (a) { e.preventDefault(); setOpenTo(g.id, a === 'expand'); } }}>
                <span aria-hidden="true">{on ? '▾' : '▸'}</span> {name}</button></td>
              <td>{formatDate(first.dateOfBirth, p.dateFormat)}</td>
              <td>{n} {n === 1 ? 'film' : 'films'}</td>
              <td>{formatDate(g.latestScan, p.dateFormat)}</td>
              <td>{sexText(first.gender)}</td>
              <td />
              <td>{aiSummary(g)}</td>
              <td>{g.latestReport ? formatDate(localDay(g.latestReport), p.dateFormat) : ''}</td>
              <td />
            </tr>,
            ...(on ? g.films.map((c) => filmRow(c, true)) : []),
          ];
        })}
      </tbody>
    </table>
  );
}
