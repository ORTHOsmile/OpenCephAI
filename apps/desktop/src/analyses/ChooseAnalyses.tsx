import { useEffect } from 'react';
import type { AnalysisDef } from '@ceph/geometry';
import type { NormSet } from '@ceph/analyses';
import type { LandmarkId } from '@ceph/analyses';
import { AnalysisBrowser } from './AnalysisBrowser';

/** Library/Sidebar › Analyses…: choose any of the 15 built-ins or your own, each marked automatic or partly automatic
 *  for this film, each opening to its measurements' catalogue definitions (owner ANALYSES-1, 12 Oct). At least one
 *  analysis stays ticked — unticking the last one is ignored, the same as the model manager never leaves zero models
 *  installable from here (a picker with nothing shown is not a usable state). */
export function ChooseAnalyses({ enabled, found, placed, sets, analyses, onChange, onClose }: {
  enabled: string[]; found: ReadonlySet<LandmarkId> | null; placed: ReadonlySet<string> | null; sets: NormSet[];
  analyses?: AnalysisDef[]; onChange: (ids: string[]) => void; onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);
  const onToggle = (id: string) => {
    const on = enabled.includes(id);
    if (on && enabled.length === 1) return;   // at least one analysis stays ticked
    onChange(on ? enabled.filter((x) => x !== id) : [...enabled, id]);
  };
  return (
    <div className="modal-backdrop">
      <div className="analyses-picker" role="dialog" aria-modal="true" aria-label="Choose analyses">
        <h2>Choose analyses</h2>
        <p className="identity-note">Shown or hidden here is kept on this Mac, for every case. Each is marked automatic or partly
          automatic for the film open now; open one to see how it is measured.</p>
        <AnalysisBrowser found={found} placed={placed} sets={sets} enabled={enabled} analyses={analyses} onToggle={onToggle} />
        <div className="row">
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  );
}
