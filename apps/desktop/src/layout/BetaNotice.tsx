import { BETA_NAME, BETA_NOTICE } from '../beta';

/** The one-time notice on first open (owner, 2 Nov 2026). App.tsx shows it until the clinician presses OK. */
export function BetaNotice({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div className="modal-backdrop">
      <div className="settings-window beta-notice" role="dialog" aria-modal="true" aria-label={BETA_NAME}>
        <h2>{BETA_NAME}</h2>
        <p>{BETA_NOTICE}</p>
        <div className="report-actions">
          <button type="button" className="primary" autoFocus onClick={onDismiss}>OK</button>
        </div>
      </div>
    </div>
  );
}
