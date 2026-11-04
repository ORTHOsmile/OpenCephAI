import { useState } from 'react';
import type { AnalysisDef } from '@ceph/geometry';
import type { NormSet } from '@ceph/analyses';
import { ALL_ANALYSES, isMine, NO_LONGER_AVAILABLE, type LandmarkId } from '@ceph/analyses';
import { filmCoverage } from './enabled';
import { MeasurementDefinitionView } from './MeasurementDefinitionView';

/** One row per analysis: the 15 built-ins and the clinician's own: an optional tick-box, a disclosure for the
 *  name, and the coverage text for this film. Opened, it lists one `.measure-row` disclosure per measurement, each
 *  showing its catalogue definition (`MeasurementDefinitionView`); a My analysis also lists what it needs that is
 *  no longer in the catalogue. Used by `ChooseAnalyses` (ticking) and, read-only, by anywhere else that wants to
 *  show what an analysis needs. */
export function AnalysisBrowser({ found, placed, sets, enabled, analyses = ALL_ANALYSES, onToggle }: {
  found: ReadonlySet<LandmarkId> | null; placed: ReadonlySet<string> | null; sets: NormSet[];
  enabled?: string[]; analyses?: AnalysisDef[]; onToggle?: (id: string) => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [openMeasures, setOpenMeasures] = useState<Set<string>>(new Set());
  const toggleOpen = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleMeasure = (key: string) => setOpenMeasures((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  return (
    <div className="analysis-browser">
      {analyses.map((a) => {
        const coverage = found ? filmCoverage(a, found, placed ?? new Set()) : null;
        const isOpen = open.has(a.id);
        return (
          <section key={a.id} className={isMine(a) ? 'analysis-row mine' : 'analysis-row'} data-id={a.id}>
            <div className="analysis-head">
              {onToggle && <input type="checkbox" aria-label={`Show ${a.name}`} checked={!!enabled?.includes(a.id)} onChange={() => onToggle(a.id)} />}
              <button type="button" className="disclosure" aria-expanded={isOpen} onClick={() => toggleOpen(a.id)}>
                <span className="tri" aria-hidden="true">{isOpen ? '▾' : '▸'}</span>{a.name}
              </button>
              {isMine(a) && <span className="mine-tag">yours</span>}
              {coverage && <span className="coverage">
                {coverage.automatic ? 'Automatic' : `Partly automatic — needs points no model finds: ${coverage.handPoints.join(', ')}`}
                {!coverage.automatic && placed && coverage.stillToPlace.length > 0 ? `; still to place on this film: ${coverage.stillToPlace.join(', ')}` : ''}
              </span>}
            </div>
            {isOpen && (
              <div className="measures">
                {a.measurements.map((m) => {
                  const key = `${a.id}:${m.node}`, mOpen = openMeasures.has(key);
                  return (
                    <div key={key} className="measure-row" data-node={m.node}>
                      <button type="button" className="disclosure" aria-expanded={mOpen} onClick={() => toggleMeasure(key)}>
                        <span className="tri" aria-hidden="true">{mOpen ? '▾' : '▸'}</span>{m.label}
                      </button>
                      {mOpen && <MeasurementDefinitionView id={m.node} sets={sets} />}
                    </div>
                  );
                })}
                {isMine(a) && a.unavailable.map((id) => (
                  <div key={`${a.id}:${id}`} className="measure-row unavailable" data-node={id}>{id} — {NO_LONGER_AVAILABLE}</div>))}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
