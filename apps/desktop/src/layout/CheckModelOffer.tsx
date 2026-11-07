import { useEffect } from 'react';
import { checkModel } from '../ipc';

/** The one-time question (1.2.1), shown after the beta notice when the whole-film check is on and has no region finder. */
export const OFFER_TEXT = 'The whole-film check needs its model (121 MB, by Dr Linton Nash, CC BY 4.0). Download now?';

/** Whether to draw the question: the beta notice read and closed (`betaSeen` true), and the back end said to ask. */
export const showOffer = (betaSeen: boolean | null, offer: boolean | null): boolean => betaSeen === true && offer === true;

/** Download starts the install (its progress shows in a small line under the film list and in Models…) and records the answer; Later records
 *  it only. Either way the question is not asked again, and a refused install is shown on the Models… row, not here. */
export function offerActions(api: Pick<typeof checkModel, 'install' | 'offerAnswered'>, done: () => void, line: { started: () => void; failed: () => void } = { started: () => {}, failed: () => {} }) {
  return {
    // The small line under the film list follows the install from here (`started`); an install the back end refuses before
    // any event (`failed`) shows the same failure words.
    download: async () => { line.started(); const started = api.install().catch(() => line.failed()); await api.offerAnswered().catch(() => {}); done(); void started; },
    later: async () => { await api.offerAnswered().catch(() => {}); done(); },
  };
}

export function CheckModelOffer({ onDone, onStarted, onFailed }: { onDone: () => void; onStarted?: () => void; onFailed?: () => void }) {
  const { download, later } = offerActions(checkModel, onDone, { started: onStarted ?? (() => {}), failed: onFailed ?? (() => {}) });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.stopPropagation(); void later(); } };
    window.addEventListener('keydown', onKey, true); return () => window.removeEventListener('keydown', onKey, true);
  });  // eslint-disable-line react-hooks/exhaustive-deps -- the latest onDone each render
  return (
    <div className="modal-backdrop">
      <div className="settings-window beta-notice" role="dialog" aria-modal="true" aria-label="Whole-film check model">
        <button type="button" className="icon-close" aria-label="Close" onClick={() => void later()}>×</button>
        <p>{OFFER_TEXT}</p>
        <div className="report-actions">
          <button type="button" className="primary" autoFocus onClick={() => void download()}>Download</button>
          <button type="button" onClick={() => void later()}>Later</button>
        </div>
      </div>
    </div>
  );
}
