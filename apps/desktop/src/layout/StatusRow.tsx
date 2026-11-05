import { remaining, type Action, type TracingState } from '../tracing/state';
import type { SignOff } from '../tracing/signOff';
import { AI_POINT_LABEL, POINT_ACCEPTED } from '../confidence';
import { modLabel, shortcut } from '../input/keymap';
import { CHECK_WORDS } from '../points/pointCheck';

/** The words for points left out of a bulk accept (the same in "Accept Positions" and "Accept remaining"). */
export const flaggedClause = (n: number): string => `${n} flagged point${n === 1 ? '' : 's'} to check on ${n === 1 ? 'its' : 'their'} own`;
/** "Accept remaining" hover text: what it does, how many of those points no shown analysis uses, and how to undo it. */
export function remainingTitle(outside: number, mod: string, flagged = 0): string {
  const out = outside ? ` ${outside} of them ${outside === 1 ? 'is' : 'are'} not used by the analyses shown.` : '';
  return `Accept every point not yet accepted, where it is.${out}${flagged ? ` ${flaggedClause(flagged)}.` : ''} ${shortcut(mod, 'Z')} undoes it.`;
}
interface Props { state: TracingState; dispatch: (a: Action) => void; signOff: SignOff | null; readOnly: boolean;
  /** How many of the points not yet accepted no shown analysis uses (they still count, and are accepted too). */
  outside: number; mod?: string }

/** Spec 2026-10-19: the selected point's state, Accept position / Positions (n), Accept remaining (n), and the sign-off. */
export function StatusRow({ state, dispatch, signOff, readOnly, outside, mod = modLabel() }: Props) {
  const id = state.active, p = id ? state.points[id] : null;
  const locked = readOnly || !!signOff?.busy;
  const picked = state.picked.filter((k) => state.points[k]), left = remaining(state), total = Object.keys(state.points).length;
  // Stage A: flagged points are left out of both bulk accepts, so they are not counted in either button.
  const flaggedIn = (ids: string[]) => ids.filter((k) => state.flagged.includes(k)).length;
  const leftBulk = left.length - flaggedIn(left), pickedBulk = picked.filter((k) => !state.flagged.includes(k));
  const pickedFlagged = flaggedIn(picked);
  const flaggedTitle = pickedFlagged ? flaggedClause(pickedFlagged) : undefined;
  const waiting = state.checkPending;                          // the film's check is still being read: no bulk accept yet
  return (
    <div className="status-row">
      <span className={p?.verified ? 'chip verified' : 'chip ai'}>{p?.verified ? POINT_ACCEPTED : AI_POINT_LABEL}</span>
      {picked.length >= 2
        ? <button type="button" className="primary" title={flaggedTitle} disabled={locked || waiting || pickedBulk.every((k) => state.points[k].verified)}
            onClick={() => dispatch({ type: 'acceptMany', ids: picked })}>{`Accept Positions (${pickedBulk.length})`}</button>
        : <button type="button" className="primary" disabled={locked || !p || p.verified} title={`${mod}-click points to accept several together`}
            onClick={() => dispatch({ type: 'accept' })}>Accept position</button>}
      {leftBulk > 0 && <button type="button" disabled={locked || waiting} title={remainingTitle(outside, mod, flaggedIn(left))}
        onClick={() => dispatch({ type: 'acceptRemaining' })}>{`Accept remaining (${leftBulk})`}</button>}
      {signOff && (signOff.verifiedAt
        ? <span className="verified-note">{`Tracing verified by ${signOff.verifiedBy ?? 'unknown'} on ${signOff.verifiedAt.slice(0, 10)}. `}
            <button type="button" disabled={locked} onClick={signOff.onReopen}>Reopen</button></span>
        : <span className="sign-off">
            <button type="button" className="primary" disabled={locked || !total || left.length > 0 || !!signOff.filmHeld}
              title={signOff.filmHeld && signOff.holdLine ? signOff.holdLine : left.length ? `${left.length} point${left.length === 1 ? ' is' : 's are'} not accepted yet` : 'Sign off this tracing'}
              onClick={signOff.onSign}>Mark tracing verified</button>
            {signOff.holdLine && <span className="hint warn hold-line" role="status">{signOff.holdLine}</span>}
            {signOff.retryCheck && <button type="button" onClick={signOff.retryCheck}>{CHECK_WORDS.tryAgain}</button>}
          </span>)}
    </div>
  );
}
