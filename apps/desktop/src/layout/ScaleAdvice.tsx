import { adviceText, type Advice } from '../compare/advice';
import { fitMark, noRulerSentence, type FitNote } from '../tracing/spacing';
/** Owner G1: one line, the same on the Superimposition page and on the tracing page. */
export function ScaleAdvice({ a, onCalibrate, onScale }: { a: Advice; onCalibrate: () => void; onScale: () => void }) {
  return (
    <div className="scale-advice" role="note">
      <span>{adviceText(a)}</span>
      <span className="scale-advice-buttons">
        <button type="button" onClick={onCalibrate}>Calibrate now</button>
        <button type="button" onClick={onScale} disabled={!!a.block}>Scale now</button>
      </span>
      {a.block && <span className="scale-advice-why">{a.block}</span>}
    </div>);
}
/** Owner G2: a film with no ruler that has a fit keeps its own numbers unless this is on; then it says where its mm
 *  come from. Looks like the advice line (G1). */
export function FitOwnLine({ timepoint, note, on, busy, onChange }: { timepoint: string; note: FitNote; on: boolean; busy: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="scale-advice" role="note">
      <span>{on ? noRulerSentence(note) : `${timepoint} has no ruler. Its fit to ${note.ref} is used for comparisons only (${fitMark(note)}).`}</span>
      <label className="scale-advice-buttons"><input type="checkbox" checked={on} disabled={busy} onChange={(e) => onChange(e.target.checked)} /> Use the scale from the fit</label>
    </div>);
}
/** A ruler always wins (owner G2; Task 5: the library refuses the switch on a ruler film); MS-4: so does a machine's
 *  calibrated scale (MS-3 refuses the switch there too). A film with either, with a fit, is offered no switch, and
 *  says why. Not a `.scale-advice` line: there is nothing to act on. */
export function FitOwnLocked({ why = 'ruler' }: { why?: 'ruler' | 'machine' }) {
  return <p className="hint fit-own-locked">“Use the scale from the fit” is not offered: this film has its {why === 'machine' ? "machine's calibrated scale" : 'own ruler'}.</p>;
}
