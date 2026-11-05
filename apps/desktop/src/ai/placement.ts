import type { DetectedLandmark, Detection, MainPointSource, ModelPointRow, PointStatus } from '../ipc';
import { AUTO_BEST } from '../ipc';

export type { MainPointSource } from '../ipc';     // the per-point source table (reference/main-point-source.json, owner O6)
export const AARIZ = 'aariz-cepha29', CWLACHAP = 'cwlachap-hrnet-w32';
/** Automatic best's base (spec 2026-10-29): the map's, or Aariz for a map from an older back end that names none. */
export const baseOf = (m: { base?: string | null } | null | undefined): string => m?.base || AARIZ;
/** `fallback`: original points given to another model (by the table, by your switch, or by Automatic best's map) that
 *  Aariz placed because that model gave no point on this film. */
export interface Placement { landmarks: DetectedLandmark[]; source: Record<string, string>; fallback: string[];
  /** 'auto-best' when Automatic best chose the models (spec §3); null otherwise. */
  via: string | null;
  /** For each point in `fallback`: the model it waited for (spec §6, owner D2: that model's bar and errors show). */
  wanted: Record<string, string> }

/**
 * Which model places each point on a film (owner rulings R-B1, R-B2, R-B4, 7 Oct; R-B4 as amended by O6, 13 Oct). The
 * main placement — the main model, or, when Aariz is the main model, cwlachap for the original points the source table
 * gives it — places every point it finds unless the point is over the 2 mm gate (`tooFar`); points it lacks or fails the
 * gate on are filled from the other installed models in catalogue order, first that passes. The main placement is never
 * overridden. A point missing from the gate table counts as not scored, and not-scored points are placed.
 */
export function placeFromRuns(main: Detection, extras: Detection[], table: ModelPointRow[], pointSource: MainPointSource | null = null): Placement {
  const statusOf = (modelId: string, id: string): PointStatus['kind'] =>
    table.find((r) => r.modelId === modelId)?.points.find((p) => p.id === id)?.status.kind ?? 'notScored';
  const rank = (modelId: string) => { const i = table.findIndex((r) => r.modelId === modelId); return i < 0 ? table.length : i; };
  const ordered = extras.map((d, i) => ({ d, i })).sort((a, b) => rank(a.d.modelId) - rank(b.d.modelId) || a.i - b.i).map((x) => x.d);
  // Automatic best (spec §3; Q1): when it is on and its base ran first (spec 2026-10-29 §4), its map replaces your Part F
  // switches. Otherwise your accepted switch applies only when the main model IS the base: the switch was judged against
  // the base, never against another model (final review C1, ruling A, 2 Nov). The built-in table (cwlachap's points) is
  // Aariz's, so it applies only when Aariz ran first.
  const ab = pointSource?.autoBest;
  const base = baseOf(ab);
  const auto = ab?.on && main.modelId === base ? ab : null;
  const wanted = (id: string): string | undefined => {
    if (!pointSource || !ORIGINAL_19.includes(id)) return undefined;
    // Owner ruling M4 (2 Nov 2026): Automatic best's choices could not be read, so the plain base places every point:
    // no Part F switch and no built-in switch. Gaps are still filled under the 2 mm gate, as for any main model.
    if (pointSource.autoBestUnreadable) return undefined;
    const table = main.modelId === AARIZ ? pointSource.points[id] : undefined;
    if (auto) return auto.uses[id] ?? table;
    return (main.modelId === base ? pointSource.ownerChoices?.[id] : undefined) ?? table;
  };
  const landmarks: DetectedLandmark[] = [], source: Record<string, string> = {}, fallback: string[] = [], waited: Record<string, string> = {};
  for (const d of [main, ...ordered]) for (const l of d.landmarks) {
    if (l.id in source || statusOf(d.modelId, l.id) === 'tooFar') continue;
    const want = d === main ? wanted(l.id) : undefined;
    if (want && want !== main.modelId) {
      const c = extras.find((x) => x.modelId === want)?.landmarks.find((q) => q.id === l.id);
      if (c) { landmarks.push({ id: c.id, x: c.x, y: c.y, confidence: c.confidence }); source[l.id] = want; continue; }
      fallback.push(l.id); waited[l.id] = want;
    }
    landmarks.push({ id: l.id, x: l.x, y: l.y, confidence: l.confidence });
    source[l.id] = d.modelId;
  }
  return { landmarks, source, fallback, via: auto ? AUTO_BEST : null, wanted: waited };
}

let tableWarned = false;
/** The 19 points every model had before Part B; never gated (owner ruling R-B2). Same list as ceph-model's ORIGINAL_19. */
export const ORIGINAL_19 = ['S', 'N', 'Or', 'Po', 'A', 'B', 'Pog', 'Me', 'Gn', 'Go', 'L1T', 'U1T', 'UL', 'LL', 'Sn', 'PogS', 'PNS', 'ANS', 'Ar'];

let sourceWarned = false;
/**
 * The import and re-detect paths: the main run plus the extra models' runs (an extra that errored has no detection and is
 * skipped), placed under the gate and the source table. If the gate table can't be read, only the main model's original
 * 19 points are placed (Part B's fail-safe). If the source table can't be read, the main model places every point it
 * finds; logged once. The import is never blocked.
 */
export async function placeOnFilm(main: Detection, extras: { detection: Detection | null }[], loadTable: () => Promise<ModelPointRow[]>,
  loadSource: (() => Promise<MainPointSource>) | null = null): Promise<Placement> {
  let table: ModelPointRow[] | null = null;
  try { const t = await loadTable(); if (Array.isArray(t)) table = t; else throw new Error('no table'); }
  catch (e) { if (!tableWarned) { tableWarned = true; console.warn(`Who finds which point couldn't be read; using the main model only: ${String(e)}`); } }
  if (!table) return placeFromRuns({ ...main, landmarks: main.landmarks.filter((l) => ORIGINAL_19.includes(l.id)) }, [], []);
  let src: MainPointSource | null = null;
  // Read for every main model (it is cheap): Automatic best's map applies when its base, whichever model that is, ran first.
  // No reader given (a caller with no source table): the main model places every point, with nothing to warn about.
  if (loadSource) {
    try { const s = await loadSource(); if (s && typeof s.points === 'object') src = s; else throw new Error('no table'); }
    catch (e) { if (!sourceWarned) { sourceWarned = true; console.warn(`The per-point source table couldn't be read; the main model places every point: ${String(e)}`); } }
  }
  return placeFromRuns(main, extras.flatMap((x) => (x.detection ? [x.detection] : [])), table, src);
}
