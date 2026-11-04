import type { Action, TracingState } from '../tracing/state';
import { OperatorPicker } from './OperatorPicker';

interface Props {
  state: TracingState; dispatch: (a: Action) => void; canEdit: boolean; title: string; page: 'tracing' | 'superimposition';
  onLibrary: () => void; onPage: (p: 'tracing' | 'superimposition') => void; onCalibrate: () => void; calibrating: boolean;
}
const Tool = ({ label, onClick, pressed, disabled, title }: { label: string; onClick: () => void; pressed?: boolean; disabled?: boolean; title: string }) =>
  <button type="button" className={pressed ? 'tool pressed' : 'tool'} aria-pressed={pressed} disabled={disabled} title={title} onClick={onClick}>{label}</button>;

/** Tool buttons left of the case title; the page links grouped to its right (decision 19). */
export function Toolbar({ state, dispatch, canEdit, title, page, onLibrary, onPage, onCalibrate, calibrating }: Props) {
  const o = state.orientation, planesOn = Object.values(state.overlays.planes).some(Boolean), edit = canEdit && page === 'tracing';
  return (
    <header className="toolbar" data-tauri-drag-region>
      <Tool label="‹ Library" title="Back to the library (everything is saved)" onClick={onLibrary} />
      <span className="sep" />
      <Tool label="Undo" title="Undo (⌘Z)" disabled={!edit || !state.past.length} onClick={() => dispatch({ type: 'undo' })} />
      <Tool label="Flip" title="Flip horizontally (⌘⇧M)" pressed={o.mirror} disabled={!edit} onClick={() => dispatch({ type: 'orient', op: 'flip' })} />
      <span className="sep" />
      <Tool label="Level to FH" title="Level to Frankfort (⌘L)" pressed={o.source === 'auto-FH'} disabled={!edit} onClick={() => dispatch({ type: 'orient', op: 'level' })} />
      <Tool label="Restore original" title="Restore original (⌘⇧0)" disabled={!edit} onClick={() => dispatch({ type: 'orient', op: 'restore' })} />
      <span className="sep" />
      <Tool label="Calibrate…" title="Calibrate the scale from the ruler (K)" pressed={calibrating} disabled={!edit} onClick={onCalibrate} />
      <Tool label="Model B" title="Arrives with the cross-check" disabled onClick={() => {}} />
      <Tool label="Planes" title="Show or hide all planes (P)" pressed={planesOn} disabled={!edit} onClick={() => dispatch({ type: 'toggleAllPlanes' })} />
      <div className="title" data-tauri-drag-region>{title}</div>
      <OperatorPicker />
      <nav className="navgroup" aria-label="Go to">
        <button type="button" disabled title="On hold: model-disagreement flags could not catch enough errors. They return once your own trained model passes the cross-check test.">Cross-check ›</button>
        <button type="button" aria-current={page === 'superimposition' ? 'page' : undefined} disabled={!canEdit}
          title={page === 'superimposition' ? 'Back to tracing' : 'Superimposition: this patient\u2019s films lined up on S\u2013N'}
          onClick={() => onPage(page === 'superimposition' ? 'tracing' : 'superimposition')}>
          {page === 'superimposition' ? '‹ Tracing' : 'Superimposition ›'}</button>
        <button type="button" className="primary" disabled title="Arrives in Week 5">Export ›</button>
      </nav>
    </header>
  );
}
