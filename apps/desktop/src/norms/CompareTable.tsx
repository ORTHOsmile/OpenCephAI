import { Fragment, type ReactNode } from 'react';
import { unconfirmedAiPointsLine } from '@ceph/analyses';
import { rowKey, type MeasurementRow } from '../measurements';
import { CALIBRATE_TO_SHOW, clinicalTargetText, firstHint, type NormCell } from './normCell';

export interface OpenChoice { node: string; analysisId: string; population: string }

/** The compare window's table (master plan §9), pure, so what it shows is testable without the dialog's settings reads.
 *  Each row: the measurement with its "uses unconfirmed AI points" mark (final review I-2: the same per-row list App
 *  computes for the Inspector), the patient's value, then one cell per ticked population — its value, its badges, its
 *  clinical target (M-10), and for a population with no norm the resolver's "no <population> norm — choose one" as a
 *  button (owner NORM-PICK-1 and OWNFALL-1 — never another source's value under that heading, so T11-1's fallback
 *  sentence is gone with the fallback; plain text when choosing is not allowed). */
export function CompareTable({ compared, ticked, labelOf, unconfirmedFor, onChoose, open, renderChooser }: {
  compared: { row: MeasurementRow; cells: NormCell[] }[];
  ticked: string[];
  labelOf: (id: string) => string;
  unconfirmedFor: (node: string) => string[];
  onChoose: ((row: MeasurementRow, population: string) => void) | null;
  open: OpenChoice | null;
  renderChooser: (row: MeasurementRow, population: string) => ReactNode;
}) {
  return (
    <div className="measures-wrap">
      <table className="measures compare-table">
        <thead>
          <tr>
            <th>Measurement</th>
            <th>Patient</th>
            {ticked.map((id) => <th key={id} className="pop">{labelOf(id)}</th>)}
          </tr>
        </thead>
        <tbody>
          {compared.map(({ row, cells }) => {
            // Fix round 1, ruling T11-1: the one sex/age hint this row's cells raise (the same `firstHint`
            // the Inspector uses, never re-derived).
            const hint = firstHint(cells);
            const u = unconfirmedFor(row.node);
            const chooserHere = open && open.node === row.node && open.analysisId === row.analysisId ? open.population : null;
            return (
              <Fragment key={rowKey(row)}>
                <tr className="m-row">
                  <td className="m-label">{row.label}
                    {/* Owner, 16 Oct (F): the same small red "AI" as the Measurements tab; the points on hover. */}
                    {u.length > 0 && <span className="ai-tag warn" title={unconfirmedAiPointsLine(u)}>AI</span>}</td>
                  <td className="m-value">{row.hidden ? CALIBRATE_TO_SHOW : row.value ?? '—'}</td>
                  {cells.map((cell, i) => {
                    const text = cell.choose && onChoose
                      ? <button type="button" className="link norm-choose" onClick={() => onChoose(row, cell.choose!.population)}>{cell.text}</button>
                      : <span className="pop-text">{cell.text}</span>;
                    return (
                      <td key={ticked[i]} className={cell.band && cell.band !== 'neutral' ? `pop-value norm-${cell.band}` : 'pop-value'} title={cell.sourceLine}>
                        {text}
                        {/* T11-1: every badge the resolver raises for THIS population's cell, visibly. */}
                        {cell.badges.map((b) => <span key={b.flag} className="norm-badge" title={b.tip}>{b.badge}</span>)}
                        {cell.target && <div className="pop-target">{clinicalTargetText(cell.target)}</div>}
                      </td>
                    );
                  })}
                </tr>
                {hint && <tr className="pop-hint-row"><td colSpan={2 + cells.length} className="hint warn">{hint}</td></tr>}
                {chooserHere && <tr className="pop-chooser-row"><td colSpan={2 + cells.length}>{renderChooser(row, chooserHere)}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
