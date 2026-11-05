import { formatDate, type DateFormat } from '../dates';
import { AUTO_BEST } from '../ipc';
import type { Source } from '../tracing/state';
import { AARIZ, baseOf, CWLACHAP, ORIGINAL_19, type MainPointSource } from './placement';

/** Chain spec §5 (owner answer 14 as changed 25 Oct): the short names a label uses. A model not listed (a later catalogue
 *  entry) goes by its Models… title. */
export const SHORT_NAMES: Readonly<Record<string, string>> = { [AARIZ]: 'Aariz', 'srpose-cldet23': 'SRPose', 'gu2net-isbi19': 'GU2Net', [CWLACHAP]: 'cwlachap' };
export const shortName = (modelId: string, titleOf: (modelId: string) => string): string => SHORT_NAMES[modelId] ?? titleOf(modelId);
export const LABEL_WORDS = { hand: 'Placed by you', moved: 'Moved by you', was: (name: string) => `Moved by you · was: ${name}`, unknown: 'AI (model not recorded)' };

/** The one label a point carries (chain spec §5): the model that placed it; after you move it, "Moved by you · was:
 *  <model>"; placed by hand, "Placed by you". The same text on screen, in the report's Points table and in the CSV's
 *  `placed_by_label`. Derived from the stored point (its source and placed_by), never stored itself, so it reads the
 *  same closed and reopened. */
export function pointLabel(source: Source, placer: string | null, titleOf: (modelId: string) => string, via: string | null = null): string {
  const named = (m: string) => (via === AUTO_BEST ? `Automatic best · ${shortName(m, titleOf)}` : shortName(m, titleOf));
  if (source === 'manual') return LABEL_WORDS.hand;
  if (source === 'ai-adjusted') return placer ? LABEL_WORDS.was(named(placer)) : LABEL_WORDS.moved;
  return placer ? named(placer) : LABEL_WORDS.unknown;
}

/** The hover that spells out why (chain spec §5). `src`: the point-source table plus your accepted switches and their
 *  notes; a switch names the date and the films that decided it (owner E1). */
export function pointWhy(id: string, source: Source, placer: string | null, mainId: string | null, src: MainPointSource | null,
  titleOf: (modelId: string) => string, f: DateFormat, via: string | null = null): string {
  if (source === 'manual') return 'You placed this point by hand.';
  if (via === AUTO_BEST && placer) return autoBestWhy(id, source, placer, src, titleOf, f);
  const name = placer ? shortName(placer, titleOf) : null;
  if (source === 'ai-adjusted') return name ? `${name} put this point here first; you moved it.` : 'You moved this point; the model that first put it here is not recorded.';
  if (!placer || !name) return 'An AI model placed this point; which one is not recorded.';
  // Final review C1 (ruling A): your switches apply when the main model is the base they were judged against.
  const base = baseOf(src?.autoBest);
  const chosen = mainId === base && ORIGINAL_19.includes(id) ? src?.ownerChoices?.[id] : undefined;
  if (chosen && chosen === placer) {
    const note = src?.ownerChoiceNotes?.[id];
    return `Switched to ${name}${note ? ` on ${formatDate(note.since, f)}` : ''}: closer to your points${note?.basis ? ` (${note.basis})` : ''}.`;
  }
  if (chosen && placer === base) return `${shortName(base, titleOf)} placed this point. Your switch to ${shortName(chosen, titleOf)} applies to new tracings and a Re-detect; on this film it gave no point, or the film was traced before the switch.`;
  if (placer === mainId) return isFallback(placer, mainId, src, id)
    ? `${name} places this point here: cwlachap, better on this point on validation films, gave no point on this film.` : `${name} places this point.`;
  if (mainId === AARIZ && placer === CWLACHAP && src?.points[id] === CWLACHAP) return 'cwlachap places this point (better than Aariz on this point on validation films).';
  if (mainId && !ORIGINAL_19.includes(id)) return `${shortName(mainId, titleOf)} did not find this point; ${name} did.`;
  return `${name} placed this point.`;
}

/** Spec §5: the hover of a point Automatic best placed, read against today's verdict. */
function autoBestWhy(id: string, source: Source, placer: string, src: MainPointSource | null, titleOf: (m: string) => string, f: DateFormat): string {
  const name = shortName(placer, titleOf), ab = src?.autoBest ?? null, base = baseOf(ab), baseName = shortName(base, titleOf);
  if (source === 'ai-adjusted') return `${name} (chosen by Automatic best) put this point here first; you moved it.`;
  if (!ORIGINAL_19.includes(id)) return `Automatic best uses Part F's rule for the 19 points only; ${pointWhy(id, source, placer, base, src, titleOf, f)}`;
  const today = ab?.uses[id] ?? null, note = ab?.notes[id], kept = ab?.kept[id];
  const basis = note ? ` (${note.basis})` : '';
  if (placer !== base) return today === placer
    ? `Part F's rule favours ${name} here: closer to your points than ${baseName}${basis}.`
    : `Placed by ${name}, chosen by Automatic best when traced; today it would use ${shortName(today ?? base, titleOf)}.`;
  if (today) { const t = shortName(today, titleOf); return `Part F's rule favours ${t} here${basis}, but ${t} gave no point on this film, or the film was traced before the rule favoured it.`; }
  if (kept) return `You kept ${baseName} here on ${formatDate(kept.since, f)}. Automatic best will use ${shortName(kept.modelId, titleOf)} again only when newer films show it closer.`;
  return `No model has been shown closer to your points than ${baseName} here yet, so Automatic best uses ${baseName}.`;
}

/** The table's fallback, derived where the hover is made (never stored, preflight a3): Aariz is main, Aariz placed the
 *  point, and the source table gives that point to cwlachap. (Moved unchanged from the old placedBy.ts.) */
export function isFallback(placer: string | null, mainId: string | null, source: MainPointSource | null, id: string): boolean {
  return placer === AARIZ && mainId === AARIZ && source?.points[id] === CWLACHAP;
}
