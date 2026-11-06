import { noteLines, RESOLVE_REASONS, WHOLE_WORDS } from '../points/wholeFilm';
import type { ResolveReason, WholeCheckView } from '../ipc';

interface Props {
  /** The shown check (`WholeFilmView.shown`); null: nothing read yet, no record, or no landmarks saved yet. No note. */
  check: WholeCheckView | null;
  /** False on a read-only page (another operator's film, Recently deleted): the note shows and offers no press. A signed-off
   *  film is NOT read-only here: `Checked` stays available after sign-off (OQ-6). */
  canCheck: boolean;
  /** True after `Checked` was pressed and before a reason is chosen: the three reasons are shown in place of the button. */
  asking: boolean;
  onAsk: (checkId: number) => void;
  onResolve: (checkId: number, reason: ResolveReason) => void;
}

/** What the canvas hands the note as `canCheck`: the page lets the film be checked, and the page is not read-only. Never the
 *  film's signed-off state (OQ-6). */
export function wholeNoteCanCheck({ canCheck, readOnly }: { canCheck: boolean; readOnly: boolean }): boolean { return canCheck && !readOnly; }

/** SC-1 Part 1 task 8 (spec §3.5): the whole-film note under Stage A's film note. A note, not a verdict: it never holds
 *  sign-off and never changes a bulk accept. `Checked` asks one of three reasons in the page (no confirm box). Plain function, no hooks;
 *  the "asking" state lives in App. */
export function WholeFilmNote({ check, canCheck, asking, onAsk, onResolve }: Props) {
  const lines = noteLines(check);
  const flaggedNoWords = !!check && check.outcome === 'flagged' && !lines.length;
  // A flagged check always has a stored reason. If none came, say so in the console and keep the note (and Checked) rather than vanish.
  if (flaggedNoWords) console.warn(`whole-film check ${check!.id} is flagged but has no stored reasons`);
  if (!check || (!lines.length && !flaggedNoWords)) return null;
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation();
  const resolved = check.resolved;
  const open = !resolved && check.outcome === 'flagged' && canCheck;
  // Like Stage A's note, the box and its text let the film beneath have the pointer (CSS `pointer-events: none`): a press on a line
  // places a waiting landmark, grabs a pin or starts a pan. Only the "?" marker (the hover words) and the buttons take the pointer,
  // and stop their presses from reaching the stage.
  return (
    <div className="check-note whole-film-note" data-resolved={resolved ? 'true' : 'false'}>
      {lines.map((line) => <div key={line} className="check-note-line"><span>{line}</span></div>)}
      {resolved && <div className="check-note-line whole-film-resolved" data-resolved="true"><span>{WHOLE_WORDS.resolvedAs(resolved.reason)}</span></div>}
      {lines.length > 0 && <div className="check-note-line"><span className="whole-film-hover" title={WHOLE_WORDS.hover} aria-label={WHOLE_WORDS.hover} onPointerDown={stop}>?</span></div>}
      {open && (
        <div className="check-note-line whole-film-actions">
          {asking
            ? RESOLVE_REASONS.map((r) => <button key={r} type="button" onPointerDown={stop} onClick={() => onResolve(check.id, r)}>{WHOLE_WORDS.reasons[r]}</button>)
            : <button type="button" onPointerDown={stop} onClick={() => onAsk(check.id)}>{WHOLE_WORDS.checked}</button>}
        </div>
      )}
    </div>
  );
}
