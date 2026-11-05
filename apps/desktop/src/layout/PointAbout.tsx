import { DEFINITION_TO_COME, STILL_TO_CONFIRM_TEXT, pointDefinition, type LandmarkId, LANDMARKS } from '@ceph/analyses';
import type { ModelPointRow } from '../ipc';
import { foundByLines } from '../points/foundBy';

/** The active point as the catalogue defines it (owner, 7 Oct): definition and where it comes from (appendix §2, or
 *  Miyashita with its page, Task 8; else "Definition to come." — owner DEF-MIYA-1), the point's source, the
 *  still-to-confirm note, and which installed models find it. Name and source show for every point. */
export function PointAbout({ id, table, placedLine, placedWhy }: { id: string | null; table: ModelPointRow[] | null; placedLine?: string | null; placedWhy?: string | null }) {
  if (!id || !(id in LANDMARKS)) return null;
  const d = pointDefinition(id as LandmarkId);
  return (
    <div className="point-about" aria-label="About this point">
      <b>{d.id} · {d.name}</b>
      <p>{d.definition ?? DEFINITION_TO_COME}</p>
      {d.definitionSource && <p className="muted">Definition: {d.definitionSource}</p>}
      <p className="muted">Source: {d.source}</p>
      {placedLine && <p className="placed-by" title={placedWhy ?? undefined}>{placedLine}</p>}
      {d.unconfirmed && <p className="hint warn">{STILL_TO_CONFIRM_TEXT}</p>}
      <ul>{foundByLines(d.id, table).map((l) => <li key={l}>{l}</li>)}</ul>
    </div>
  );
}
