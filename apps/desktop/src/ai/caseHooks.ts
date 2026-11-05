import type { CaseHooks } from '../library/useCase';
import { extraShownBy } from '../library/twoStep';
import { beforePlacingOf } from './useAutoBest';

/** The part of Automatic best the open case uses (spec §6a): its launch step and its check. */
export interface AutoBestForCase { ready: Promise<void>; sync: () => Promise<void> }

/** What the screen tells the open case (spec §3, §6a; owner D2). Both are read through refs, so the hooks see them as
 *  they are now: `useCase` is declared before `useAutoBest` in App.tsx, and the ghost settings load later. */
export function caseHooksOf(autoBestRef: { current: AutoBestForCase | null }, hiddenGhostsRef: { current: ReadonlySet<string> | null }): CaseHooks {
  return {
    extraShown: (id) => extraShownBy(hiddenGhostsRef.current)(id),
    beforePlacing: () => beforePlacingOf(autoBestRef.current),   // M1: after the first-open step
    afterSignOff: () => { void autoBestRef.current?.sync(); },
  };
}
