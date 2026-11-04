import type { AnalysisDef } from '@ceph/geometry';
import { ALL_ANALYSES, MY_PREFIX, analysisCoverage, toAnalysisDef, type LandmarkId, type MyAnalysis } from '@ceph/analyses';

/** Which analyses this Mac shows (Part D picker; owner ANALYSES-1, 12 Oct: kept on this Mac for all cases); a setting,
 *  like Enhance. First use: Steiner, Downs and McNamara, the three shown before Part D. Owner B1/B2 (17 Oct): it also
 *  holds "My analysis" ids (`my:…`); each clinician sees only their own. */
export const ENABLED_KEY = 'analyses_enabled';
export const DEFAULT_ENABLED = ['steiner', 'downs', 'mcnamara'];
const BUILT_IN = new Set(ALL_ANALYSES.map((a) => a.id));

/** Built-ins in catalogue order, then `my:` ids in the order given; anything else dropped; each once. */
function orderIds(ids: string[]): string[] {
  const mine = ids.filter((id, i) => id.startsWith(MY_PREFIX) && ids.indexOf(id) === i);
  return [...ALL_ANALYSES.map((a) => a.id).filter((id) => ids.includes(id)), ...mine];
}
export function parseEnabled(json: string | null): string[] {
  let ids: unknown = null;
  try { ids = json ? JSON.parse(json) : null; } catch { ids = null; }
  const out = orderIds(Array.isArray(ids) ? ids.filter((x): x is string => typeof x === 'string') : []);
  return out.length ? out : DEFAULT_ENABLED;
}
export const enabledDefs = (ids: string[]): AnalysisDef[] => ALL_ANALYSES.filter((a) => ids.includes(a.id));

/** What the picker ticks and the screens show: built-ins and this clinician's own; nothing left → the three. */
export function visibleEnabled(ids: string[], mine: MyAnalysis[]): string[] {
  const v = ids.filter((id) => BUILT_IN.has(id) || mine.some((a) => a.id === id));
  return v.length ? v : DEFAULT_ENABLED;
}
/** The one list of shown analyses (Inspector, Chart, Change table, Compare populations; later the report and CSV). */
export function shownDefs(ids: string[], mine: MyAnalysis[]): AnalysisDef[] {
  const v = visibleEnabled(ids, mine);
  return [...ALL_ANALYSES.filter((a) => v.includes(a.id)), ...mine.filter((a) => v.includes(a.id)).map(toAnalysisDef)];
}
/** The stored list after this clinician changes their ticks: their choice, plus every other clinician's `my:` ids. */
export function mergeEnabled(stored: string[], visible: string[], mine: MyAnalysis[]): string[] {
  return orderIds([...visible, ...stored.filter((id) => id.startsWith(MY_PREFIX) && !mine.some((a) => a.id === id))]);
}
/** A newly saved analysis is shown at once, without hiding what was shown before. */
export const enableNew = (stored: string[], mine: MyAnalysis[], id: string): string[] =>
  orderIds([...visibleEnabled(stored, mine), ...stored.filter((x) => x.startsWith(MY_PREFIX)), id]);
/** A deleted analysis leaves the stored list (after the delete it is no longer "mine", so mergeEnabled would keep it). */
export function forgetEnabled(stored: string[], id: string): string[] {
  const out = stored.filter((x) => x !== id);
  return out.length ? out : DEFAULT_ENABLED;
}
/** "Automatic" when every point the analysis needs is found by an installed model (Part B, live); otherwise "partly
 *  automatic", naming the points no model finds and, of those, the ones not yet placed on this film. */
export function filmCoverage(a: AnalysisDef, found: ReadonlySet<LandmarkId>, placed: ReadonlySet<string>) {
  const c = analysisCoverage(a, found);
  return { automatic: c.automatic, handPoints: c.missing, stillToPlace: c.missing.filter((p) => !placed.has(p)) };
}
