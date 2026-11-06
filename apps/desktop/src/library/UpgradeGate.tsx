import { useEffect, useState, type ReactNode } from 'react';
import { library } from '../ipc';

/** Owner, 6 Nov 2026: shown before a library upgrade, and only then. The words are the owner's 6 Nov 2026 wording (his ruling on the re-review's N1), exactly. */
export const UPGRADE_NOTICE = 'This version of OpenCephAI will upgrade your library. A checked safety copy is made first. For extra safety, back up your library yourself before continuing. To do that, choose Quit, then in Finder choose Go › Go to Folder… (⇧⌘G) and copy ~/Library/Application Support/app.cephtrace.desktop.';

/** What the gate needs of the back end (`library.upgradePending`, `upgradeConfirm`, `upgradeQuit`). */
export interface GateLib { upgradePending: () => Promise<{ from: number; to: number } | null>; upgradeConfirm: () => Promise<void>; upgradeQuit: () => Promise<void> }

/** `ask`: an upgrade is needed, show the notice (nothing has been opened or changed). `go`: no upgrade is needed, or it could not be looked at
 *  (the back end still refuses to open an old library until Continue). */
export async function startGate(l: GateLib): Promise<'ask' | 'go'> {
  try { return (await l.upgradePending()) ? 'ask' : 'go'; } catch { return 'go'; }
}
/** Continue: the back end may now open (and upgrade) the library, as before. */
export async function pressContinue(l: GateLib): Promise<void> { await l.upgradeConfirm(); }
/** Quit: close the app. Nothing was confirmed, so nothing was opened. */
export async function pressQuit(l: GateLib): Promise<void> { await l.upgradeQuit(); }

export function UpgradeNotice({ onContinue, onQuit, busy }: { onContinue: () => void; onQuit: () => void; busy: boolean }) {
  return (
    <div className="modal-backdrop">
      <div className="settings-window beta-notice" role="alertdialog" aria-modal="true" aria-label="Library upgrade">
        <h2>Library upgrade</h2>
        <p>{UPGRADE_NOTICE}</p>
        <div className="report-actions">
          <button type="button" disabled={busy} onClick={onQuit}>Quit</button>
          <button type="button" className="primary" autoFocus disabled={busy} onClick={onContinue}>Continue</button>
        </div>
      </div>
    </div>
  );
}

/** Wraps the whole app: nothing inside runs (so no library call is made) until the gate says go. */
export function UpgradeGate({ children, lib = library }: { children: ReactNode; lib?: GateLib }) {
  const [state, setState] = useState<'checking' | 'ask' | 'go'>('checking');
  const [busy, setBusy] = useState(false);
  useEffect(() => { let live = true; startGate(lib).then((s) => { if (live) setState(s); }); return () => { live = false; }; }, [lib]);
  if (state === 'go') return <>{children}</>;
  if (state === 'checking') return null;
  return <UpgradeNotice busy={busy}
    onContinue={() => { setBusy(true); pressContinue(lib).then(() => setState('go')).catch(() => setBusy(false)); }}
    onQuit={() => { setBusy(true); pressQuit(lib).catch(() => setBusy(false)); }} />;
}
