import type { Vec2 } from '@ceph/geometry';
import type { ExtraResult, ModelPointRow, ModelPoints, ModelRow } from '../ipc';
import type { TracingPoint } from '../tracing/state';
import { fmtValue, type Decimals } from '../format';
export interface Ghost { modelId: string; title: string; shade: 1 | 2; points: Record<string, Vec2>;
  /** Automatic best: each point's own title ("Automatic best · SRPose"); others use `title`. */ titles?: Record<string, string> }
/** What the extra models' run on this film leaves for the screen (Task 12, rulings T12-1, T12-2): `errors`, one whole
 *  sentence per model that gave no points (a model past its time limit, or still busy with an earlier film, says so in
 *  Rust's own words; one that errored keeps the short sentence), for the case panel; `failed`, those models' titles, so
 *  `ghostsFrom` draws none of their earlier stored points on this film. */
export function extraOutcome(extras: ExtraResult[]): { errors: string[]; failed: string[] } {
  const out = extras.filter((x) => x.error);
  return { errors: out.map((x) => (x.timedOut ? (x.error as string) : `${x.title} couldn't read this film.`)), failed: out.map((x) => x.title) };
}
/** The Ready extra models' newest points on this film (spec Part 3), in catalogue order: one shade per model. A model
 *  that couldn't read the film this time (`failed`, by title) shows none, whatever an older run stored (spec Part 4).
 *  The main model is not a ghost, except for `mainIds` (review I1, owner ruling R-B2): its own points over the 2 mm
 *  gate that nothing placed, shown as its suggestion only (`mainSuggestions`). */
export function ghostsFrom(stored: ModelPoints[], rows: ModelRow[], failed: string[] = [], mainIds: string[] = []): Ghost[] {
  return rows.filter((r) => r.status === 'ready' && (!r.main || mainIds.length > 0) && !failed.includes(r.title)).flatMap((r) => {
    const s = stored.find((m) => m.modelId === r.id);
    if (!s) return [];
    const points = Object.fromEntries(s.points.filter((p) => p.landmarkId && (!r.main || mainIds.includes(p.landmarkId)))
      .map((p) => [p.landmarkId as string, { x: p.x, y: p.y }]));
    if (r.main && !Object.keys(points).length) return [];
    return [{ modelId: r.id, title: r.title, points, shade: 1 as const }];
  }).map((g, i) => ({ ...g, shade: (i % 2 === 0 ? 1 : 2) as 1 | 2 }));
}
/** The main model's points over the 2 mm gate (`tooFar` in its own row of the points table) that no model placed: no AI
 *  point (placed, or placed and then moved) stands on the film for that id. A point the clinician placed by hand keeps
 *  the suggestion, for comparison. No table (it couldn't be read) or no main row: none (review I1, owner ruling R-B2). */
export function mainSuggestions(table: ModelPointRow[] | null, points: Record<string, Pick<TracingPoint, 'source'>>): string[] {
  const main = table?.find((r) => r.main);
  if (!main) return [];
  return main.points.filter((p) => p.status.kind === 'tooFar' && (!points[p.id] || points[p.id].source === 'manual')).map((p) => p.id);
}

/** "GU2Net: =1.2 mm from Sella (S)" on a calibrated case, "GU2Net: ≈1.2 mm from Sella (S)" when the case has no
 *  ruler calibration and the distance comes from the ASSUMED 0.1 mm/px scale (owner, 5 Oct, Task C — names the point
 *  instead of the generic "your point", for the on-canvas hover label that replaces the SVG `<title>` tooltip; owner,
 *  6 Oct, item S — mark the assumed scale instead of silently showing an assumed mm figure as if it were measured).
 *  `assumed` is passed by the caller (App/Overlay already knows whether this case has a ruler) rather than inferred
 *  here from `mmPerPx`, which is never null (scaleOf always substitutes the assumed default). A point with no
 *  catalogue name (shouldn't happen for a mapped landmark id, but the id always identifies it) shows the id alone.
 *  `decimals` is the operator's display setting (DEC-1): every number on screen goes through the one shared
 *  formatter (`format.ts`), this one included — it was still hardcoded to one decimal until Task 5. */
export function ghostLabel(title: string, ghost: Vec2, placed: Vec2 | undefined, mmPerPx: number, pointId: string, pointName: string | undefined, assumed: boolean, decimals: Decimals): string {
  if (!placed) return title;
  const d = Math.hypot(ghost.x - placed.x, ghost.y - placed.y) * mmPerPx;
  const dist = `${assumed ? '≈' : '='}${fmtValue(d, 'mm', decimals)}`;
  const point = pointName ? `${pointName} (${pointId})` : pointId;
  return `${title}: ${dist} from ${point}`;
}

/** Owner, 5 Oct: a tick-box per model, not just one "Show other models" — every ghost whose model id is not in the
 *  hidden set is drawn; unticking a model hides only its diamonds. */
export function visibleGhosts(ghosts: Ghost[], hidden: ReadonlySet<string>): Ghost[] {
  return ghosts.filter((g) => !hidden.has(g.modelId));
}

/** "Show all"'s own state (a dash — `indeterminate` — when only some are on), judged against the models actually
 *  listed in the key for this film (the ones with a chip to tick), not the whole catalogue: a model that has not
 *  yet produced a ghost for this film has nothing here to be "some" of. */
export function showAllState(ghosts: Ghost[], hidden: ReadonlySet<string>): 'all' | 'none' | 'some' {
  if (!ghosts.length) return 'all';
  const n = ghosts.filter((g) => hidden.has(g.modelId)).length;
  return n === 0 ? 'all' : n === ghosts.length ? 'none' : 'some';
}

/** The other models' ids worth the ghosts_shown→ghosts_hidden upgrade (owner, 5 Oct, I4): the main model is never a
 *  "ghost", and a model not yet Ready (not-installed, installing, or failed to install) has no diamonds to hide —
 *  including it would hide it the moment it finishes installing, which is backwards: a model installed LATER must
 *  start shown. A model that is Ready but failed to read THIS film (ghostsFrom's own `failed` list) is unaffected
 *  here — that is a per-film read failure, not an install state, so it stays in the upgrade. */
export function readyOtherIds(rows: ModelRow[]): string[] {
  return rows.filter((r) => !r.main && r.status === 'ready').map((r) => r.id);
}
/** The owner's upgrade rule (approved in chat, 5 Oct): `ghosts_hidden` (a JSON array of hidden model ids) replaces
 *  the old binary `ghosts_shown` ('0'/'1'). Once `ghosts_hidden` has been written it is the only truth — a model
 *  not in it (including one installed later) simply starts shown. Only while it has never been written does the
 *  old flag matter: `ghosts_shown === '0'` hides every model known at that moment (`allOtherModelIds`); anything
 *  else (unset or '1') starts every model shown. Malformed stored JSON is read as "nothing hidden", not a crash —
 *  an instrument that cannot parse its own state must not raise that as if it analysed something real, but it
 *  also must not stay silent about losing the owner's choice, so callers persist a fresh, valid value once seeded. */
export function upgradeHidden(storedHidden: string | null, ghostsShownFlag: string | null, allOtherModelIds: string[]): Set<string> {
  if (storedHidden !== null) {
    try {
      const ids = JSON.parse(storedHidden);
      return new Set(Array.isArray(ids) ? ids : []);
    } catch { return new Set(); }
  }
  return ghostsShownFlag === '0' ? new Set(allOtherModelIds) : new Set();
}
