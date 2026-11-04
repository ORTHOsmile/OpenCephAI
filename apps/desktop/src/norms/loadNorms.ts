import { loadSets, OWN_NORMS_LABEL, type NormSet, type UserNorm } from '@ceph/analyses';
import type { library, settings } from '../ipc';

// Ruling T4-3 / review M-2 (Task 4 fix round 1): the three reads useNorms makes, as plain functions (stub loaders
// in tests). A failed read returns a message for the screen; it is never swallowed into "nothing there", because
// then the clinician would be shown a different norm with no warning.

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** The committed norm sets; a set that fails validation stops the load — no sets, and the message (the app opens). */
export function safeLoadSets(load: () => NormSet[] = loadSets): { sets: NormSet[]; loadError: string | null } {
  try {
    return { sets: load(), loadError: null };
  } catch (e) {
    return { sets: [], loadError: String(e) };
  }
}

/** The clinician's own norms. A failed read (or a reply that is not a list) uses none and says so. */
export async function readUserNorms(lib: Pick<typeof library, 'userNorms'>): Promise<{ value: UserNorm[]; error: string | null }> {
  try {
    const u = await lib.userNorms();
    if (!Array.isArray(u)) throw new Error('the reply was not a list');
    return { value: u, error: null };
  } catch (e) {
    return { value: [], error: `Your own norms could not be read (${why(e)}), so none are used.` };
  }
}

/** The clinic default population. A failed read uses no default, so a case without its own population is compared
 *  with each analysis's own norms — and the screen says so. */
export async function readClinicDefault(s: Pick<typeof settings, 'defaultPopulation'>): Promise<{ value: string | null; error: string | null }> {
  try {
    return { value: (await s.defaultPopulation()) ?? null, error: null };
  } catch (e) {
    return { value: null, error: `The clinic's default population could not be read (${why(e)}), so a case with no population of its own shows ${OWN_NORMS_LABEL}.` };
  }
}
