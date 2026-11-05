// Owner NAP-Q3 (b), spec 2026-10-29 §4.8: the one-time note after the format-18 upgrade, in the spec's exact words.
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSets } from '@ceph/analyses';
import { aboutRowsIn, AutoSwitchNote, autoSwitchNoteWords, clinicDefaultShortLabel, SWITCHED_ROWS, SWITCHED_STAR_CHANGES } from './AutoSwitchNote';

const UNDO = 'To go back for one case: open it, and in Reference population choose "Clinic default (as before the upgrade)".';
// Owner R3 (3 Nov 2026): the undo's second sentence says what going back gives.
const UNDO_DEFAULT = `${UNDO} It uses your clinic default again, with the same grades as before.`;   // final review M8
const UNDO_OWN = `${UNDO} It uses each analysis's own norms again; rows those norms never covered now show another study's norm, marked ◆.`;
const SAVED = 'Reports you already saved as PDF are not changed.';
// Owner R3 (3 Nov 2026; spec 2026-11-03 §8.3): the words describe the combined adult norm and give the measured figure.
describe('owner NAP-Q3 (b) and R3: the one-time note after the upgrade (exact words)', () => {
  it('clinic default set, 37 cases (the spec\'s words)', () => {
    expect(autoSwitchNoteWords(37, 'Caucasian')).toEqual({ title: 'Auto norms now choose the population for 37 older cases.', body: [
      'These cases were on "Clinic default". Auto uses the patient\'s recorded background, else your clinic default (Caucasian), else for adults a combined norm from every adult study in the app and for children the largest study for their sex and age. No background is recorded yet, so for now they are graded against Caucasian exactly as before; the only change in their reports is the words "chosen automatically: clinic default". Recording a background later can change their grades.',
      SAVED, UNDO_DEFAULT] });
  });
  it('no clinic default, 37 cases (the spec\'s words)', () => {
    expect(autoSwitchNoteWords(37, null)).toEqual({ title: 'Auto norms now choose the population for 37 older cases.', body: [
      'These cases were graded against each analysis\'s own norms. Auto now grades them from the patient\'s demographics: adults (18 and over) against a combined norm from every adult study in the app, weighted by size, for men and women separately; children against the largest study for their sex and age. Expect many grades to change: in our test films about 2 rows in 7 changed their stars. To keep each analysis\'s own norms for all cases, set the clinic default to "The analysis\'s own norms" in Settings ▸ Norms.',
      SAVED, UNDO_OWN] });
  });
  it('one case: the same sentences in the singular', () => {
    expect(autoSwitchNoteWords(1, null)).toEqual({ title: 'Auto norms now choose the population for 1 older case.', body: [
      'This case was graded against each analysis\'s own norms. Auto now grades it from the patient\'s demographics: adults (18 and over) against a combined norm from every adult study in the app, weighted by size, for men and women separately; children against the largest study for their sex and age. Expect many grades to change: in our test films about 2 rows in 7 changed their stars. To keep each analysis\'s own norms for all cases, set the clinic default to "The analysis\'s own norms" in Settings ▸ Norms.',
      SAVED, UNDO_OWN] });
    expect(autoSwitchNoteWords(1, 'Chinese').body[0]).toBe('This case was on "Clinic default". Auto uses the patient\'s recorded background, else your clinic default (Chinese), else for adults a combined norm from every adult study in the app and for children the largest study for their sex and age. No background is recorded yet, so for now it is graded against Chinese exactly as before; the only change in its report is the words "chosen automatically: clinic default". Recording a background later can change its grades.');
  });
  it('the dialog: the title, the three paragraphs and OK', () => {
    const html = renderToStaticMarkup(<AutoSwitchNote n={2} defaultLabel={null} onClose={() => {}} />);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('Auto norms now choose the population for 2 older cases.');
    expect((html.match(/<p>/g) ?? []).length).toBe(3);
    expect(html).toContain('>OK</button>');
  });
  it('the clinic default as the note names it', () => {
    const sets = loadSets();
    expect([clinicDefaultShortLabel('caucasian', sets), clinicDefaultShortLabel('analysis-own', sets), clinicDefaultShortLabel('user:Mine', sets), clinicDefaultShortLabel(null, sets)])
      .toEqual(['Caucasian', "each analysis's own norms", 'Mine (your norms)', null]);
  });
  // Final review M4: the note's words are made from the measured figure (switchedCases.test.ts measures
  // SWITCHED_STAR_CHANGES against the export path), never typed separately.
  it('the figure in the words is made from the measured count, as the nearest simple fraction', () => {
    expect(aboutRowsIn(2015, 7020)).toBe('about 2 rows in 7');
    expect(aboutRowsIn(1178, 7020)).toBe('about 1 row in 6');
    expect(aboutRowsIn(3510, 7020)).toBe('about 1 row in 2');
    expect(aboutRowsIn(0, 7020)).toBe('no rows');
    expect(autoSwitchNoteWords(37, null).body[0]).toContain(`in our test films ${aboutRowsIn(SWITCHED_STAR_CHANGES, SWITCHED_ROWS)} changed their stars`);
  });
});
