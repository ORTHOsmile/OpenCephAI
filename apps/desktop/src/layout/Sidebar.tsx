import type { ModelStatus } from '../ipc';
import type { Action, TracingState } from '../tracing/state';
import { machineSizeNote, type Scale } from '../tracing/spacing';
import type { CaseApi } from '../library/useCase';
import { PLANES } from '../canvas/overlayGeometry';
import { CasePanel, type GhostKey } from './CasePanel';
import { PanelSection } from './PanelSection';
import type { ChooseApi } from '../library/useChoose';
import type { DateFormat } from '../dates';
import type { Decimals } from '../format';
import type { MeasurementRow } from '../measurements';
import type { NormContext } from '../norms/normCell';
import type { NormExtras } from './CasePanel';

interface Props {
  chooser: ChooseApi;
  onImport: () => void; onModels: () => void; onAnalyses: () => void; onSettings: () => void; model: ModelStatus | null; kase: CaseApi; patients: string[];
  state: TracingState; dispatch: (a: Action) => void; scale: Scale; readOnly: boolean; error: string | null; dateFormat: DateFormat;
  /** The Superimposition page's film key (spec 2026-09-30). */
  series?: React.ReactNode;
  enhanceOpen: boolean; onEnhance: () => void;
  filmTextOpen: boolean; onFilmText: () => void;
  patientOpen: boolean; onPatient: () => void;
  ghostKey?: GhostKey;
  /** Part D task 11: the case's reference population picker and "Compare populations…" (CasePanel's Patient
   *  section, ruling P26). `norms` is the sets/userNorms/clinicDefault the resolver reads (N6, Task
   *  10); `compareRows` is the open film's enabled-analyses measurement rows, computed once in App.tsx. */
  norms: NormContext; decimals: Decimals; compareRows: MeasurementRow[];
  /** Request G (Task 10): "mm scaled to T1 on S–N (×1.042)." for Compare populations while a fit scales the mm. */
  scaleNote?: string | null;
  /** NORM-PICK-1 / I-2 / M-8, passed through to CasePanel (see `NormExtras`). */
  normExtras: NormExtras;
  /** The text after "Model: " (`modelLine`, spec 2026-10-29 §11): a name, never a file id. */
  modelLine?: string | null;
  /** Automatic best (spec §6a, §6b, D1/D3): the upgrade note and the per-change notes, built once in App.tsx. */
  autoBest?: React.ReactNode;
}

export function Sidebar({ onImport, onModels, onAnalyses, onSettings, model, kase, chooser, patients, state, dispatch, scale, readOnly, error, dateFormat, series, enhanceOpen, onEnhance, filmTextOpen, onFilmText, patientOpen, onPatient, ghostKey, norms, decimals, compareRows, scaleNote = null, normExtras, modelLine = null, autoBest = null }: Props) {
  return (
    <aside className="sidebar" data-tauri-drag-region>
      <div className="sidebar-scroll">
      <button className="primary" onClick={onImport} disabled={!!kase.busy}>{kase.busy ?? 'Import…'}</button>
      {kase.doc && <CasePanel kase={kase} chooser={chooser} patients={patients} state={state} dispatch={dispatch} readOnly={readOnly} dateFormat={dateFormat} enhanceOpen={enhanceOpen} onEnhance={onEnhance} filmTextOpen={filmTextOpen} onFilmText={onFilmText} patientOpen={patientOpen} onPatient={onPatient} ghostKey={ghostKey} norms={norms} decimals={decimals} compareRows={compareRows} scaleNote={scaleNote} normExtras={normExtras} />}
      {series && <PanelSection title="Comparison">{series}</PanelSection>}
      <PanelSection title="Overlays" action={<button type="button" onClick={() => dispatch({ type: 'toggleAllPlanes' })}>{Object.values(state.overlays.planes).some(Boolean) ? 'Hide all' : 'Show all'}</button>}>
      <div className="overlays">
        {PLANES.map((p) => (
          <label key={p.key}><input type="checkbox" checked={state.overlays.planes[p.key]} onChange={() => dispatch({ type: 'togglePlane', key: p.key })} />
            <span className="swatch" style={{ borderTopColor: p.colour, borderTopStyle: p.dash ? 'dashed' : 'solid' }} />{p.label}</label>
        ))}
        <label><input type="checkbox" checked={state.overlays.profilogram} onChange={() => dispatch({ type: 'toggleProfilogram' })} />Profilogram <kbd>G</kbd></label>
        <div className="segmented" role="radiogroup" aria-label="Background">
          {(['radiograph', 'grid'] as const).map((b) => (
            <button key={b} type="button" role="radio" aria-checked={state.overlays.background === b}
              onClick={() => dispatch({ type: 'setBackground', background: b })}>{b === 'radiograph' ? 'Radiograph' : 'mm grid'}</button>
          ))}
        </div>
        {scale.source === 'assumed' && <div className="hint warn">mm are hidden until the film is calibrated from its ruler (K).</div>}
        {kase.doc && machineSizeNote(kase.doc) && <div className="hint machine-size-note">{machineSizeNote(kase.doc)}</div>}
      </div>
      </PanelSection>
      {model && !model.loaded && (
        <div className="welcome-models">Install the standard models to trace films automatically.
          <button type="button" className="primary" onClick={onModels}>Models…</button></div>
      )}
      <div className="hint">{model?.loaded ? <>Model: <b>{modelLine ?? 'the model that runs first'}</b></> : <>No model installed.</>}</div>
      <ModelButtons onModels={onModels} onAnalyses={onAnalyses} onSettings={onSettings} />
      {kase.notice && <div className="hint" role="status">{kase.notice}</div>}
      {autoBest}
      {(kase.error ?? error) && <div className="error">{kase.error ?? error}</div>}
      </div>
      {/* Owner, 1 Nov 2026: always visible, pinned under the models and buttons; the part above it scrolls, this does not. */}
      <div className="sidebar-credit">Thanks to Dr Linton Nash</div>
    </aside>
  );
}

/** "Models…  Analyses…" in one row, then Settings… alone, centred and blue (owner, 29 Oct; spec 2026-10-29 §2): a single
 *  button on its own row reads as a different control from the two grey ones above it. */
export function ModelButtons({ onModels, onAnalyses, onSettings }: { onModels: () => void; onAnalyses: () => void; onSettings: () => void }) {
  return (
    <>
      <div className="row">
        <button type="button" onClick={onModels}>Models…</button>
        <button type="button" onClick={onAnalyses}>Analyses…</button>
      </div>
      <div className="row settings-row"><button type="button" className="primary" onClick={onSettings}>Settings…</button></div>
    </>
  );
}
