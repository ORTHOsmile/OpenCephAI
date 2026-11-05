// Owner NAP-Q3 (b), spec 2026-10-29 §4.8: shown once after the format-18 upgrade switched old "Clinic default" cases
// to Auto. The words are the spec's (plural); one case reads the same sentences in the singular.
import { OWN_NORMS_LABEL, populationsOffered, type NormSet } from '@ceph/analyses';

const UNDO = 'To go back for one case: open it, and in Reference population choose "Clinic default (as before the upgrade)".';
const SAVED = 'Reports you already saved as PDF are not changed.';
/** Owner R3 (3 Nov 2026): the measured figure behind "about 2 rows in 7" — switchedCases.test.ts, the 54 SYNTHETIC
 *  "Clinic default" films switched to Auto with no clinic default: rows whose stars changed, of every row. */
export const SWITCHED_STAR_CHANGES = 2015;
export const SWITCHED_ROWS = 7020;
/** Final review M4: a count as the nearest simple fraction, "about 2 rows in 7" — the denominator 2 to 10 that comes
 *  closest (the smaller on a tie). */
export function aboutRowsIn(changed: number, total: number): string {
  if (changed <= 0) return 'no rows';
  const r = changed / total;
  let best = { a: 1, b: 2, err: Infinity };
  for (let b = 2; b <= 10; b++) { const a = Math.max(1, Math.round(r * b)); const err = Math.abs(a / b - r); if (err < best.err - 1e-12) best = { a, b, err }; }
  return `about ${best.a} ${best.a === 1 ? 'row' : 'rows'} in ${best.b}`;
}

/** The note's title and paragraphs, for `n` switched cases and the clinic default's short label (null: none set). */
export function autoSwitchNoteWords(n: number, clinicDefaultLabel: string | null): { title: string; body: string[] } {
  const one = n === 1;
  const title = `Auto norms now choose the population for ${n} older ${one ? 'case' : 'cases'}.`;
  const these = one ? 'This case was' : 'These cases were';
  const first = clinicDefaultLabel !== null
    ? `${these} on "Clinic default". Auto uses the patient's recorded background, else your clinic default (${clinicDefaultLabel}), else for adults a combined norm from every adult study in the app and for children the largest study for their sex and age. No background is recorded yet, so for now ${one ? 'it is' : 'they are'} graded against ${clinicDefaultLabel} exactly as before; the only change in ${one ? 'its report' : 'their reports'} is the words "chosen automatically: clinic default". Recording a background later can change ${one ? 'its' : 'their'} grades.`
    // Owner R3 (3 Nov 2026; spec 2026-11-03 §8.3): what Auto now does, and the measured figure.
    : `${these} graded against each analysis's own norms. Auto now grades ${one ? 'it' : 'them'} from the patient's demographics: adults (18 and over) against a combined norm from every adult study in the app, weighted by size, for men and women separately; children against the largest study for their sex and age. Expect many grades to change: in our test films ${aboutRowsIn(SWITCHED_STAR_CHANGES, SWITCHED_ROWS)} changed their stars. To keep each analysis's own norms for all cases, set the clinic default to "The analysis's own norms" in Settings ▸ Norms.`;
  // Owner R3: the undo says what going back gives — the clinic default when one is set; else each analysis's own norms,
  // which no longer reproduces an old report exactly (rows they never covered now carry another study's norm).
  const undo = clinicDefaultLabel !== null ? `${UNDO} It uses your clinic default again, with the same grades as before.`
    : `${UNDO} It uses each analysis's own norms again; rows those norms never covered now show another study's norm, marked ◆.`;
  return { title, body: [first, SAVED, undo] };
}

/** The dialog; OK closes it (the caller records that it was shown). */
export function AutoSwitchNote({ n, defaultLabel, onClose }: { n: number; defaultLabel: string | null; onClose: () => void }) {
  const w = autoSwitchNoteWords(n, defaultLabel);
  return (
    <div className="modal-backdrop">
      <div className="settings-window auto-switch-note" role="dialog" aria-modal="true" aria-label="Auto norms">
        <h2>{w.title}</h2>
        {w.body.map((p) => <p key={p}>{p}</p>)}
        <div className="row"><button type="button" className="primary" autoFocus onClick={onClose}>OK</button></div>
      </div>
    </div>
  );
}

/** The clinic default as the note names it: a population's short label (before " ("), the analyses' own norms in the
 *  app's usual words, one of your norm sets by its name; null when none is set. */
export function clinicDefaultShortLabel(id: string | null, sets: NormSet[]): string | null {
  if (id === null) return null;
  if (id === 'analysis-own') return OWN_NORMS_LABEL;
  if (id.startsWith('user:')) return `${id.slice(5)} (your norms)`;
  return (populationsOffered(sets, []).find((p) => p.id === id)?.label ?? id).split(' (')[0];
}
