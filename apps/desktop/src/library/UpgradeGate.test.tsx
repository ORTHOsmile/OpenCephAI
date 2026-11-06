import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { UpgradeNotice, UPGRADE_NOTICE, startGate, pressContinue, pressQuit, type GateLib } from './UpgradeGate';

// Owner, 6 Nov 2026 (item 3): before a library upgrade, a notice with Continue and Quit. SYNTHETIC calls only.
const lib = (pending: { from: number; to: number } | null | 'throws'): GateLib & { calls: string[] } => {
  const calls: string[] = [];
  return { calls,
    upgradePending: async () => { calls.push('pending'); if (pending === 'throws') throw new Error('stub'); return pending; },
    upgradeConfirm: async () => { calls.push('confirm'); },
    upgradeQuit: async () => { calls.push('quit'); } };
};
describe('the upgrade notice', () => {
  /** Fails if the words drift from the owner's. */
  it('says the owner\'s words and offers Continue and Quit', () => {
    expect(UPGRADE_NOTICE).toBe('This version of OpenCephAI will upgrade your library. A checked safety copy is made first. For extra safety, back up your library yourself before continuing. To do that, choose Quit, then in Finder choose Go › Go to Folder… (⇧⌘G) and copy ~/Library/Application Support/app.cephtrace.desktop.');
    const h = renderToStaticMarkup(<UpgradeNotice onContinue={() => {}} onQuit={() => {}} busy={false} />);
    expect(h).toContain(UPGRADE_NOTICE);
    expect(h).toMatch(/<button[^>]*>Continue<\/button>/);
    expect(h).toMatch(/<button[^>]*>Quit<\/button>/);
    expect(h).toContain('role="alertdialog"');
  });
  it('while an answer is awaited both buttons are disabled (no double press)', () => {
    const h = renderToStaticMarkup(<UpgradeNotice onContinue={() => {}} onQuit={() => {}} busy />);
    expect(h.match(/<button[^>]*disabled/g)?.length).toBe(2);
  });
});
describe('the gate', () => {
  /** Fails if the notice is shown for a library that needs no upgrade (the back end says null), or the app is held when nothing is pending. */
  it('no upgrade needed (fresh install, or already current): straight on, no notice, nothing confirmed or quit', async () => {
    const l = lib(null);
    expect(await startGate(l)).toBe('go');
    expect(l.calls).toEqual(['pending']);
  });
  /** Fails if the gate lets the app (and so the library) start, or confirms, before Continue. */
  it('upgrade needed: the notice is asked for; nothing is confirmed until Continue is pressed', async () => {
    const l = lib({ from: 19, to: 20 });
    expect(await startGate(l)).toBe('ask');
    expect(l.calls).toEqual(['pending']);                 // the upgrade has NOT been allowed
    await pressContinue(l);
    expect(l.calls).toEqual(['pending', 'confirm']);
  });
  /** Fails if Quit confirms the upgrade (which would let the library be touched) or does not quit. */
  it('Quit quits and never confirms', async () => {
    const l = lib({ from: 19, to: 20 });
    await startGate(l);
    await pressQuit(l);
    expect(l.calls).toEqual(['pending', 'quit']);
  });
  /** A failed look is not a reason to hold the app: the back end itself still refuses to open an old library unconfirmed. */
  it('a failed look goes on (the back end still protects the library)', async () => {
    expect(await startGate(lib('throws'))).toBe('go');
  });
});
