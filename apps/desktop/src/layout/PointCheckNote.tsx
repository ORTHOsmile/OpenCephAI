import { CHECK_WORDS, filmNoteLine } from '../points/pointCheck';
import type { PointCheckFlag } from '../ipc';

interface Props {
  /** Every film-unusual row of the open film (resolved or not): one per model whose run looked unusual overall. */
  flags: PointCheckFlag[];
  /** False on a locked, signed-off or read-only page: the note shows, and offers no Checked press. */
  canCheck: boolean;
  /** Called with the ids of the unresolved film rows that carry the pressed note's words. */
  onChecked: (checkIds: number[]) => void;
}

/** Stage A task 7 (ruling F13): "This film looks unusual overall: <n> points out of keeping (<ids>)." with a Checked
 *  button, which is what resolves the film flag. The list can name a point that was not wrong, so the note never calls
 *  it "the wrong points". Two models with the same words show one note; one press covers both. Plain function, no hooks. */
export function PointCheckNote({ flags, canCheck, onChecked }: Props) {
  const lines: { line: string; open: number[] }[] = [];
  for (const f of flags) {
    const line = filmNoteLine(f);
    let l = lines.find((x) => x.line === line);
    if (!l) { l = { line, open: [] }; lines.push(l); }
    if (f.resolved == null) l.open.push(f.id);
  }
  if (!lines.length) return null;
  // The box lets the film beneath have the pointer (CSS `pointer-events: none`); only the button takes it, and its press must
  // not reach the stage (pan, placing, pointer capture), so stopPropagation is on the button alone.
  return (
    <div className="check-note">
      {lines.map(({ line, open }) => (
        <div key={line} className="check-note-line" data-resolved={open.length === 0 ? 'true' : 'false'}>
          <span>{line}</span>
          {open.length > 0 && canCheck && <button type="button" onPointerDown={(e) => e.stopPropagation()} onClick={() => onChecked(open)}>{CHECK_WORDS.checked}</button>}
        </div>
      ))}
    </div>
  );
}

/** Presses Checked: the command for each film row, then the screen re-reads the stored result (the note then shows
 *  resolved, without its button). A refused press (for example a row from an older run) is not an error on screen: the
 *  re-read shows what is stored. */
export async function pressChecked(caseId: string, ids: number[], command: (caseId: string, checkId: number) => Promise<unknown>, reread: () => Promise<unknown>): Promise<void> {
  for (const id of ids) { try { await command(caseId, id); } catch { /* one try per id; the re-read shows the stored state */ } }
  await reread();
}
