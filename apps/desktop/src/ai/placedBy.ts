import { AARIZ, CWLACHAP, type MainPointSource } from './placement';
/** The words of the point's source line (spec §5.1 "Shown"), defined once. */
export const PLACED_BY_WORDS = {
  placed: (title: string) => `Placed by ${title}`,
  better: '(better than Aariz on this point on validation films)',
  fallback: '(cwlachap, better on this point, gave no point on this film)',
};
/** The source line for an AI point: the main placement only (Aariz, a chosen main model, or cwlachap for a point the
 *  source table gives it). Fill points keep their existing line (null). `fallback`: the table named cwlachap but Aariz
 *  placed the point. `source`: the per-point source table — the "better than Aariz" note is added only where the table
 *  actually gives the point to cwlachap; a point cwlachap placed as the main model of a case traced before the switch
 *  is named plainly (review I-1). */
export function placedByLine(id: string, placer: string | null, mainId: string | null, fallback: boolean, titleOf: (modelId: string) => string,
  source: MainPointSource | null): string | null {
  if (!placer || !mainId) return null;
  if (placer === mainId) return placer === AARIZ && fallback ? `${PLACED_BY_WORDS.placed(titleOf(placer))} ${PLACED_BY_WORDS.fallback}` : PLACED_BY_WORDS.placed(titleOf(placer));
  if (mainId === AARIZ && placer === CWLACHAP) {
    return source?.points[id] === CWLACHAP ? `${PLACED_BY_WORDS.placed(titleOf(placer))} ${PLACED_BY_WORDS.better}` : PLACED_BY_WORDS.placed(titleOf(placer));
  }
  return null;
}
/** The fallback note, derived where the line is drawn (never stored, so it survives closing and reopening; preflight
 *  a3): Aariz is main, Aariz placed the point, and the source table gives that point to cwlachap. */
export function isFallback(placer: string | null, mainId: string | null, source: MainPointSource | null, id: string): boolean {
  return placer === AARIZ && mainId === AARIZ && source?.points[id] === CWLACHAP;
}
