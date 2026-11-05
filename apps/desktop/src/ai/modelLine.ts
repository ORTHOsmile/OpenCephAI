import type { AutoBestMap } from '../ipc';
import { baseOf } from './placement';
import { SHORT_NAMES, shortName } from './pointLabel';

/** Spec 2026-10-29 §11 (fix of 29 Oct): the text after "Model: " under the tracing. Always a name the owner knows, never
 *  a file id. With Automatic best on, it names the actual base, the model that runs first. A model from "Use a model
 *  folder…" with no title is described in words. */
export function modelLine(loadedId: string | null, autoBest: AutoBestMap | null | undefined, titleOf: (id: string) => string): string {
  if (autoBest?.on) return `Automatic best (starts from ${shortName(baseOf(autoBest), titleOf)})`;
  if (!loadedId) return 'no model';
  if (SHORT_NAMES[loadedId]) return SHORT_NAMES[loadedId];
  const t = titleOf(loadedId);
  return t && t !== loadedId ? t : 'the model from your model folder';
}
