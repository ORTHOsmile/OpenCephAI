export interface AutoSignLib {
  open: (caseId: string) => Promise<{ verifiedAt: string | null; verifiedBy: string | null }>;
  setVerified: (caseId: string, verified: boolean) => Promise<void>;
}
export type AutoSignOutcome =
  | { kind: 'stale' }
  | { kind: 'alreadySignedOrNotReady'; verifiedAt: string | null; verifiedBy: string | null }
  | { kind: 'held' }
  | { kind: 'signed' };

/**
 * V2's job: by the time it runs, is the open film still the one it was queued for, still unsigned, still fully
 * accepted, and still allowed to sign (no hold has landed meanwhile)? Final review m-2: queued through the SAME
 * serial chain as the ruler stores (`rulerRunRef` in `useCase.ts`'s `setVerified`), so it can never land in the
 * gap between a ruler drop's `calibrate` IPC and the hold that drop sets once it lands — it now runs strictly
 * after any ruler store already queued, so `stillAllowed` sees that hold if the drop landed first.
 */
export async function runAutoSignOff(id: string, verified: boolean, getOpenId: () => string | undefined,
  lib: AutoSignLib, isAccepted: () => boolean, stillAllowed: () => boolean): Promise<AutoSignOutcome> {
  if (getOpenId() !== id) return { kind: 'stale' };
  const now = await lib.open(id);
  if (now.verifiedAt || !isAccepted()) return { kind: 'alreadySignedOrNotReady', verifiedAt: now.verifiedAt, verifiedBy: now.verifiedBy };
  if (!stillAllowed()) return { kind: 'held' };
  if (getOpenId() !== id) return { kind: 'stale' };
  await lib.setVerified(id, verified);
  return { kind: 'signed' };
}
