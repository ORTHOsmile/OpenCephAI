/** Strips appendix-internal markup from screen-facing text (Part D Task 1, review fix round 1).
 *  The appendix (`docs/analyses-catalogue.md`) is written for whoever maintains the
 *  catalogue and carries three kinds of internal markup that mean nothing to a clinician reading the screen:
 *  - markdown emphasis, `**like this**`;
 *  - a reference to the appendix's own section numbering, "in §3";
 *  - a parenthetical ruling code, "(C1)", "(C3)", "(C5)", "(C7)" — sometimes alone, sometimes leading other
 *    words in the same bracket, e.g. "(C1; McNamara's paper used the facial surface)".
 *  This function removes all three, so `what.ts` and `landmarks.ts`'s `POINT_DEFINITIONS` can show the words
 *  without the editorial scaffolding. The appendix document itself is never changed by this — only the text the
 *  app builds from it. `definitions.test.ts` applies the same function to the appendix side before comparing, so
 *  the screen and the appendix are held equal net of exactly this markup, nothing else. */
export function stripScreenMarkup(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/\s+in §\d+/g, '')
    .replace(/\(C\d+[;,]\s*/g, '(')
    .replace(/\s*\(C\d+\)/g, '')
    .trim();
}
