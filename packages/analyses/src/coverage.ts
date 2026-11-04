import { compile, type AnalysisDef, type Compiled } from '@ceph/geometry';
import { buildRegistry } from './registry';
import { LANDMARKS, type LandmarkId } from './landmarks';

/** Every landmark some measurement of `defs` actually needs, via `g.requiredLandmarks`. The one walk shared by the
 *  desktop's "Not placed" / "Other points" lists and `analysisCoverage`, so they can never disagree about "needed". */
export function neededLandmarks(defs: AnalysisDef[], g: Compiled): Set<string> {
  const needed = new Set<string>();
  for (const d of defs) for (const m of d.measurements) for (const l of g.requiredLandmarks(m.node)) needed.add(l);
  return needed;
}

/** Points some installed model places automatically: any status except `tooFar` (owner rulings R-B1, R-B2, 7 Oct). */
export function foundBy(table: { points: { id: string; status: { kind: string } }[] }[]): Set<LandmarkId> {
  const found = new Set<LandmarkId>();
  for (const r of table) for (const p of r.points) if (p.status.kind !== 'tooFar') found.add(p.id as LandmarkId);
  return found;
}

/** Whether the installed models trace everything `a`'s measurements need; `missing` lists the rest in `LANDMARKS` order. */
export function analysisCoverage(a: AnalysisDef, found: ReadonlySet<LandmarkId>): { automatic: boolean; missing: LandmarkId[] } {
  const needed = neededLandmarks([a], compile(buildRegistry([a])));
  const missing = (Object.keys(LANDMARKS) as LandmarkId[]).filter((k) => needed.has(k) && !found.has(k));
  return { automatic: missing.length === 0, missing };
}
