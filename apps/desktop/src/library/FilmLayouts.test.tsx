import { describe, expect, it } from 'vitest';
import { learnedText } from './FilmLayouts';

// Pre-flight ruling (Task 7, X9): FilmLayouts used to print the raw field name (`CHOOSE_LABELS[f] ?? f`) for a
// field that isn't a Choose-on-the-film button, which Gender and Referring practitioner (owner Q6) are not. The
// box words (owner Q12) must show instead.
describe('learnedText: Preferences > Film layouts reads learned fields with the box words', () => {
  it('a machine that has learned Gender reads "Gender learned"', () => {
    expect(learnedText({ id: 'm1', name: 'Machine 1', films: 3, learned: ['gender'] })).toBe('Gender learned');
  });
  it('a machine that has learned Referring practitioner reads the box words, not "referrer"', () => {
    expect(learnedText({ id: 'm1', name: 'Machine 1', films: 3, learned: ['referrer'] })).toBe('Referring practitioner learned');
  });
  it('several learned fields join with the same box words as Choose on the film', () => {
    expect(learnedText({ id: 'm1', name: 'Machine 1', films: 3, learned: ['full', 'gender', 'referrer'] }))
      .toBe('Full name, Gender, Referring practitioner learned');
  });
  it('nothing learned yet', () => {
    expect(learnedText({ id: 'm1', name: 'Machine 1', films: 0, learned: [] })).toBe('nothing learned yet');
  });
});
