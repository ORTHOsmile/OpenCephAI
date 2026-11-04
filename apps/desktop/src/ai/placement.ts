import type { DetectedLandmark, Detection, MainPointSource, ModelPointRow, PointStatus } from '../ipc';

export type { MainPointSource } from '../ipc';     // the per-point source table (reference/main-point-source.json, owner O6)
export const AARIZ = 'aariz-cepha29', CWLACHAP = 'cwlachap-hrnet-w32';
/** `fallback`: original points the table gives to cwlachap that Aariz placed because cwlachap gave no point on this film. */
export interface Placement { landmarks: DetectedLandmark[]; source: Record<string, string>; fallback: string[] }

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
  const byTable = main.modelId === AARIZ && pointSource ? pointSource.points : null;
  const cw = byTable ? extras.find((d) => d.modelId === CWLACHAP) : undefined;
  const landmarks: DetectedLandmark[] = [], source: Record<string, string> = {}, fallback: string[] = [];
  for (const d of [main, ...ordered]) for (const l of d.landmarks) {
    if (l.id in source || statusOf(d.modelId, l.id) === 'tooFar') continue;
    if (d === main && byTable?.[l.id] === CWLACHAP && ORIGINAL_19.includes(l.id)) {
      const c = cw?.landmarks.find((q) => q.id === l.id);
      if (c) { landmarks.push({ id: c.id, x: c.x, y: c.y, confidence: c.confidence }); source[l.id] = CWLACHAP; continue; }
      fallback.push(l.id);
    }
    landmarks.push({ id: l.id, x: l.x, y: l.y, confidence: l.confidence });
    source[l.id] = d.modelId;
  }
  return { landmarks, source, fallback };
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
  loadSource: () => Promise<MainPointSource> = async () => { throw new Error('no source table'); }): Promise<Placement> {
  let table: ModelPointRow[] | null = null;
  try { const t = await loadTable(); if (Array.isArray(t)) table = t; else throw new Error('no table'); }
  catch (e) { if (!tableWarned) { tableWarned = true; console.warn(`Who finds which point couldn't be read; using the main model only: ${String(e)}`); } }
  if (!table) return placeFromRuns({ ...main, landmarks: main.landmarks.filter((l) => ORIGINAL_19.includes(l.id)) }, [], []);
  let src: MainPointSource | null = null;
  if (main.modelId === AARIZ) {
    try { const s = await loadSource(); if (s && typeof s.points === 'object') src = s; else throw new Error('no table'); }
    catch (e) { if (!sourceWarned) { sourceWarned = true; console.warn(`The per-point source table couldn't be read; Aariz places every point: ${String(e)}`); } }
  }
  return placeFromRuns(main, extras.flatMap((x) => (x.detection ? [x.detection] : [])), table, src);
}
