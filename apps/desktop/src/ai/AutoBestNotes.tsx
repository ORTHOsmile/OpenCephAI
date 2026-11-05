import type { AutoBestEvent, BaseChanged, IntroNote } from '../ipc';
import { baseChangedWords, introWords, noteWords, wayBackWords } from './autoBestWords';
import { shortName } from './pointLabel';
import { baseOf } from './placement';

/** Spec §6a (owner D3): one small line per change, with Undo on an adoption; dismissed with ×. */
export function AutoBestNotes({ notes, error, titleOf, onUndo, onDismiss }: { notes: AutoBestEvent[]; error: string | null; titleOf: (m: string) => string;
  onUndo: (e: AutoBestEvent) => void; onDismiss: (id: number) => void }) {
  if (!notes.length && !error) return null;
  return (
    <div className="auto-best-notes" aria-label="Automatic best changes">
      {notes.map((e) => (
        <div key={e.id} className="hint auto-best-note" role="status" data-point={e.landmarkId}>{noteWords(e, titleOf)}{' '}
          {e.kind === 'adopted' && <button type="button" onClick={() => onUndo(e)}>Undo</button>}
          <button type="button" aria-label="Dismiss" onClick={() => onDismiss(e.id)}>×</button></div>))}
      {error && <div className="error">{error}</div>}
    </div>
  );
}
/** Spec §6b (owner D1): shown once, on the first open after this feature, with the way back. */
export function AutoBestIntro({ note, titleOf, onWayBack, onDismiss }: { note: IntroNote | null; titleOf: (m: string) => string; onWayBack: () => void; onDismiss: () => void }) {
  if (!note) return null;
  return (
    <div className="hint auto-best-intro" role="status">{introWords(note)}{' '}
      <button type="button" onClick={onWayBack}>{wayBackWords(note, titleOf)}</button>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>×</button></div>
  );
}
/** Spec 2026-10-29 §4: after a change of base, one line saying what changed, with the way back to the earlier base. */
export function BaseChangeNote({ note, titleOf, onBack, onDismiss }: { note: BaseChanged | null; titleOf: (m: string) => string; onBack: () => void; onDismiss: () => void }) {
  if (!note) return null;
  return (
    <div className="hint auto-best-base-note" role="status">{baseChangedWords(note, titleOf)}{' '}
      <button type="button" onClick={onBack}>Back to {shortName(note.from, titleOf)}</button>
      <button type="button" aria-label="Dismiss" onClick={onDismiss}>×</button></div>
  );
}
/** Owner ruling M4 (2 Nov 2026): one plain note while Automatic best's choices cannot be read; the base places every point. */
export function AutoBestUnreadableNote({ unreadable, base, titleOf }: { unreadable: boolean; base: string | null; titleOf: (m: string) => string }) {
  if (!unreadable) return null;
  return (
    <div className="hint auto-best-unreadable" role="status">{`Automatic best's choices couldn't be read, so ${shortName(baseOf({ base }), titleOf)} placed this film's points (any it doesn't find come from another model). This clears at the next tracing once the choices can be read.`}</div>
  );
}
