import type { Vec2 } from '@ceph/geometry';
import { AUTO_BEST, type AutoBestMap, type Detection, type MainPointSource, type ModelPoints, type ModelPointRow } from '../ipc';
import { AARIZ, baseOf, placeFromRuns } from '../ai/placement';
import { shortName } from '../ai/pointLabel';
import { autoBestUsesThisWords } from '../ai/autoBestWords';
import type { Ghost } from './ghosts';

const detectionOf = (m: ModelPoints): Detection => ({ modelId: m.modelId, imageWidth: 0, imageHeight: 0, executionProvider: m.executionProvider ?? '',
  timingsMs: { preprocess: 0, inference: 0, decode: 0, total: 0 }, raw: [],
  landmarks: m.points.filter((p) => p.landmarkId).map((p) => ({ id: p.landmarkId as string, x: p.x, y: p.y, confidence: p.peak })) });

/** Spec §4 (Q1; owner answer 2 of 29 Oct, which replaces Q2 of 27 Oct): beside a fixed main model, Automatic best's
 *  ghost is THE BASE's own placement from its stored run (Part F's switches not used; the built-in table only when the
 *  base is Aariz), with each point that has evidence replaced by the favoured model's stored mark. None while it is the
 *  main model, without its base installed, or without the base's run (with points) on this film. */
export function autoBestGhost(stored: ModelPoints[], mainId: string | null, map: AutoBestMap | null | undefined, table: ModelPointRow[] | null,
  src: MainPointSource | null, titleOf: (m: string) => string): Ghost | null {
  if (!map?.available || map.on || !mainId || !table) return null;
  const baseId = baseOf(map);
  const baseRun = stored.find((m) => m.modelId === baseId);
  if (!baseRun || !baseRun.points.some((p) => p.landmarkId)) return null;
  const others = stored.filter((m) => m.modelId !== baseId).map(detectionOf);
  const base = placeFromRuns(detectionOf(baseRun), others, table, baseId === AARIZ && src ? { ...src, ownerChoices: {}, autoBest: null } : null);
  const points: Record<string, Vec2> = {}, titles: Record<string, string> = {};
  const title = (m: string) => `Automatic best · ${shortName(m, titleOf)}`;
  for (const l of base.landmarks) { points[l.id] = { x: l.x, y: l.y }; titles[l.id] = title(base.source[l.id]); }
  for (const [id, m] of Object.entries(map.uses)) {
    const q = stored.find((s) => s.modelId === m)?.points.find((p) => p.landmarkId === id);
    if (q) { points[id] = { x: q.x, y: q.y }; titles[id] = title(m); }
  }
  return Object.keys(points).length ? { modelId: AUTO_BEST, title: 'Automatic best', shade: 1, points, titles } : null;
}
/** Automatic best first in the ghost key (spec §2), the shades re-alternated. */
export function withAutoBest(ghosts: Ghost[], auto: Ghost | null): Ghost[] {
  return auto ? [auto, ...ghosts].map((g, i) => ({ ...g, shade: (i % 2 === 0 ? 1 : 2) as 1 | 2 })) : ghosts;
}
/** Owner, 28 Oct ("one mark, both names" — review's Important finding): Automatic best's ghost point for an id is,
 *  whenever it names a model in `map.uses`, numerically the SAME pixel as that model's own ghost point there (both
 *  come from the same stored run). Drawing both diamonds on top of each other let the wrong one win the hover.
 *  Call this on the FINAL, already hidden-filtered ghost list (`visibleGhosts`'s result): where Automatic best's
 *  point coincides with a ghost that is actually in the list (so a model hidden in the ghost key never merges),
 *  drop Automatic best's own point there — the other ghost's diamond already stands on that pixel — and name both
 *  in THAT ghost's hover (`autoBestUsesThisWords`). Automatic best's own `points`/`titles` for every other id, and
 *  every other ghost's `points`, are untouched; when the source model's ghost is hidden, Automatic best's point for
 *  that id survives this call unchanged, so it shows alone with its own normal hover (spec, this owner ruling). */
export function mergeAutoBestOverlap(ghosts: Ghost[]): Ghost[] {
  const auto = ghosts.find((g) => g.modelId === AUTO_BEST);
  if (!auto) return ghosts;
  const autoPoints = { ...auto.points };
  const merged = ghosts.map((g) => {
    if (g.modelId === AUTO_BEST) return g;
    let titles: Record<string, string> | undefined;
    for (const [id, p] of Object.entries(auto.points)) {
      const q = g.points[id];
      if (q && q.x === p.x && q.y === p.y) { delete autoPoints[id]; titles = { ...(titles ?? g.titles), [id]: autoBestUsesThisWords(g.title) }; }
    }
    return titles ? { ...g, titles } : g;
  });
  return merged.map((g) => (g.modelId === AUTO_BEST ? { ...g, points: autoPoints } : g));
}
