import { Fragment } from 'react';
import { unconfirmedAiPointsLine } from '@ceph/analyses';
import { rowKey, type MeasurementRow } from '../measurements';
import { CALIBRATE_TO_SHOW, clinicalTargetText, firstHint, type NormCell } from './normCell';

/** The compare window's table (master plan §9), pure, so what it shows is testable without the dialog's settings reads.
 *  Each row: the measurement with its "uses an AI point not yet accepted" mark (final review I-2: the same per-row list App
 *  computes for the Inspector), the patient's value, then one cell per ticked population — its value, its badges, its
 *  clinical target (M-10); a population with no norm of its own shows '—' (ruling AUTO-Q7). */
export function CompareTable({ compared, ticked, labelOf, unconfirmedFor }: {
  compared: { row: MeasurementRow; cells: NormCell[] }[];
  ticked: string[];
  labelOf: (id: string) => string;
  unconfirmedFor: (node: string) => string[];
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
            return (
              <Fragment key={rowKey(row)}>
                <tr className="m-row">
                  <td className="m-label">{row.label}
                    {/* Owner, 16 Oct (F): the same small red "AI" as the Measurements tab; the points on hover. */}
                    {u.length > 0 && <span className="ai-tag warn" title={unconfirmedAiPointsLine(u)}>AI</span>}</td>
                  <td className="m-value">{row.hidden ? CALIBRATE_TO_SHOW : row.value ?? '—'}</td>
                  {cells.map((cell, i) => (
                    <td key={ticked[i]} className={cell.band && cell.band !== 'neutral' ? `pop-value norm-${cell.band}` : 'pop-value'} title={[cell.sourceLine, cell.sourceTips.join(' ')].filter(Boolean).join(' — ')}>
                      <span className="pop-text">{cell.text}</span>
                      {/* T11-1: every badge the resolver raises for THIS population's cell, visibly. */}
                      {cell.badges.map((b) => <span key={b.flag} className="norm-badge" title={b.tip}>{b.badge}</span>)}
                      {cell.target && <div className="pop-target">{clinicalTargetText(cell.target)}</div>}
                    </td>
                  ))}
                </tr>
                {hint && <tr className="pop-hint-row"><td colSpan={2 + cells.length} className="hint warn">{hint}</td></tr>}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
