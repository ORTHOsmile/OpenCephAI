import { DEFAULT_MEANINGS } from '@ceph/analyses';

/** Owner MEANING-PER-CLINICIAN (16 Oct 2026): each clinician's own wording for the meanings, saved on this Mac under
 *  their name; a side left blank (or never changed) uses the approved default. With no clinician chosen there is
 *  nothing to save, and the approved words show. */
export type Side = 'high' | 'low';
export type Overrides = Record<string, Partial<Record<Side, string>>>;
interface Store { get: (key: string) => Promise<string | null>; set: (key: string, value: string) => Promise<void> }

export const meaningsKey = (clinician: string): string | null => (clinician.trim() ? `meanings:${clinician}` : null);

export async function readOverrides(s: Pick<Store, 'get'>, clinician: string): Promise<Overrides> {
  const key = meaningsKey(clinician);
  if (!key) return {};
  try {
    const v = JSON.parse((await s.get(key)) ?? '{}');
    if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
    // Review M-3: keep only text words; anything else stored is ignored, never a crash.
    const out: Overrides = {};
    for (const [id, w] of Object.entries(v as Record<string, unknown>)) {
      if (!w || typeof w !== 'object') continue;
      const keep: Partial<Record<Side, string>> = {};
      for (const side of ['high', 'low'] as const) { const t = (w as Record<string, unknown>)[side]; if (typeof t === 'string') keep[side] = t; }
      if (Object.keys(keep).length) out[id] = keep;
    }
    return out;
  } catch { return {}; }
}

/** The words shown for one measurement: the clinician's where set (and not blank), else the approved default. */
export function wordsFor(id: string, o: Overrides): { high: string; low: string } | undefined {
  const d = DEFAULT_MEANINGS[id];
  if (!d) return undefined;
  const pick = (side: Side) => (o[id]?.[side]?.trim() ? o[id]![side]!.trim() : d[side]);
  return { high: pick('high'), low: pick('low') };
}

/** NOCLIN-2 (ruling, 17 Oct 2026, item 34): names match ignoring capitals and extra spaces. */
export const sameClinicianName = (a: string, b: string): boolean => normalizeName(a) === normalizeName(b);
const normalizeName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** One candidate in NOCLIN-2's resolution order, in the order they are tried. `settleOnEmpty`: stop here even if
 *  this clinician has no saved words (an empty Overrides is still "their" words — the approved ones); false only
 *  for the referrer step, who must have saved words of their OWN or the chain carries on to the login name. */
export interface ClinicianStep { clinician: string; fromReferrer: boolean; settleOnEmpty: boolean }

/** Whose MEANING WORDS are used, in order (NOCLIN-2, ruling 17 Oct, item 34):
 *  1. the clinician chosen in the top bar, if any;
 *  2. else the open film's Referring practitioner, if that name has its own saved words (matched against every
 *     clinician this Mac has ever added, ignoring capitals and extra spaces);
 *  3. else the Mac login name (NOCLIN-1's only rule).
 *  `explicit` is the raw `operator` setting — non-empty only when the top bar chose someone; Rust's `operator()`
 *  (and so `operators.list().current`, `login` below) falls back to the login name even when it is unset, so the
 *  raw setting is the only way to tell "chosen" from "defaulted" apart. The caller reads each step's overrides in
 *  order (readOverrides) and stops at the first one that settles — see useMeanings.ts. */
export function clinicianSteps(explicit: string | null, login: string, referrer: string | null, knownNames: readonly string[]): ClinicianStep[] {
  const exp = explicit?.trim();
  if (exp) return [{ clinician: exp, fromReferrer: false, settleOnEmpty: true }];
  const steps: ClinicianStep[] = [];
  const ref = referrer?.trim();
  if (ref) {
    const match = knownNames.find((n) => sameClinicianName(n, ref));
    if (match) steps.push({ clinician: match, fromReferrer: true, settleOnEmpty: false });
  }
  steps.push({ clinician: login, fromReferrer: false, settleOnEmpty: true });
  return steps;
}

/** A token shared by every in-flight resolve (fix round 1, I2): `current` is bumped each time a new resolve
 *  starts, and a resolve whose own `token` no longer matches must not commit — a slower, earlier lookup (e.g. an
 *  older film's) can never land after, and overwrite, a later one's (e.g. the film switched to meanwhile). */
export interface SeqGuard { current: number }
export interface ClinicianResolution { clinician: string; overrides: Overrides; fromReferrer: boolean }

/** Walks `steps` in order, reading each candidate's words, and commits the first that settles — the loop
 *  `useMeanings.ts` runs after computing its step list, shared here (not re-implemented) so a test can drive it
 *  with controlled timing. Checks `seq` against `token` after every read, same as `useMeanings.ts`'s own guard
 *  (review fix round 1, I2 — not a paraphrase of it, the one function both call). */
export async function settleClinicianSteps(s: Pick<Store, 'get'>, seq: SeqGuard, token: number, steps: readonly ClinicianStep[],
  commit: (r: ClinicianResolution) => void): Promise<void> {
  for (const step of steps) {
    const w = await readOverrides(s, step.clinician);
    if (seq.current !== token) return;   // a newer resolve has started; this one is stale and must not commit
    if (step.settleOnEmpty || Object.keys(w).length) { commit({ clinician: step.clinician, overrides: w, fromReferrer: step.fromReferrer }); return; }
  }
}

// Review I-2: changes run one after another (each reads the stored words, changes them and writes them back), so two
// made close together can never overwrite each other.
let queue: Promise<unknown> = Promise.resolve();
function write(s: Store, clinician: string, change: (o: Overrides) => void): Promise<Overrides> {
  const run = async () => {
    const key = meaningsKey(clinician);
    if (!key) return {};
    const o = await readOverrides(s, clinician);
    change(o);
    await s.set(key, JSON.stringify(o));
    return o;
  };
  const next = queue.then(run, run);
  queue = next.catch(() => undefined);
  return next;
}
export const saveOverride = (s: Store, clinician: string, id: string, side: Side, words: string) =>
  write(s, clinician, (o) => { o[id] = { ...o[id], [side]: words }; });
export const resetOverride = (s: Store, clinician: string, id: string, side: Side) =>
  write(s, clinician, (o) => { if (o[id]) { delete o[id][side]; if (!Object.keys(o[id]).length) delete o[id]; } });
