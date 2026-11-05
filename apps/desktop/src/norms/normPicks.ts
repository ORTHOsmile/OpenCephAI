import { AUTO_CHOICE_ID, type NormPicks } from '@ceph/analyses';
import type { settings } from '../ipc';

// Owner NORM-PICK-1 (12 Oct): where the case's population (or a ticked compare population) has no norm for a
// measurement, the clinician chooses a source, and the choice is saved ON THE CASE. It is kept in the library's existing
// settings table (`settings_get`/`settings_set`), one key per case, as JSON { <population>: { <measurement>: <source> } }
// — no library schema change. Keyed by population, so a choice made for "no Chinese norm" never answers "no Japanese norm".

const why = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const normPicksKey = (caseId: string) => `norm_picks:${caseId}`;

/** The stored value; anything that is not { string: { string: string } } is dropped, never thrown. */
export function parsePicks(json: string | null): NormPicks {
  let v: unknown = null;
  try { v = json ? JSON.parse(json) : null; } catch { v = null; }
  const out: NormPicks = {};
  if (!v || typeof v !== 'object' || Array.isArray(v)) return out;
  for (const [pop, byM] of Object.entries(v as Record<string, unknown>)) {
    if (!byM || typeof byM !== 'object' || Array.isArray(byM)) continue;
    const kept = Object.entries(byM as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string');
    if (kept.length) out[pop] = Object.fromEntries(kept);
  }
  return out;
}

/** Stores the clinician's choice for one population and measurement. Owner N-A2 (19 Oct 2026): choosing Auto removes
 *  it (and the population's entry when nothing is left), so Auto is never stored. */
export function withPick(p: NormPicks, population: string, measurement: string, source: string): NormPicks {
  if (source !== AUTO_CHOICE_ID) return { ...p, [population]: { ...(p[population] ?? {}), [measurement]: source } };
  const rest = Object.fromEntries(Object.entries(p[population] ?? {}).filter(([m]) => m !== measurement));
  const out: NormPicks = { ...p };
  if (Object.keys(rest).length) out[population] = rest;
  else delete out[population];
  return out;
}

export async function readPicks(s: Pick<typeof settings, 'get'>, caseId: string): Promise<{ value: NormPicks; error: string | null }> {
  try {
    return { value: parsePicks(await s.get(normPicksKey(caseId))), error: null };
  } catch (e) {
    return { value: {}, error: `The norms you chose for this case could not be read (${why(e)}).` };
  }
}

export async function savePicks(s: Pick<typeof settings, 'set'>, caseId: string, picks: NormPicks): Promise<string | null> {
  try {
    await s.set(normPicksKey(caseId), JSON.stringify(picks));
    return null;
  } catch (e) {
    return `Your choice of norm could not be saved (${why(e)}).`;
  }
}
