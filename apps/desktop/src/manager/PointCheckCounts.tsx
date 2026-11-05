import { useEffect, useState } from 'react';
import { LANDMARKS } from '@ceph/analyses';
import { library, type PointCheckCount } from '../ipc';

const times = (n: number) => `${n} ${n === 1 ? 'time' : 'times'}`;
/** "Nasion: flagged 12 times, you left it 5 times" (spec §14.5; the second part is left out when you left none). "Left it" = the flag was resolved by accepting the point
 *  as the model placed it. Information only. */
export const countLine = (name: string, flagged: number, left: number) => `${name}: flagged ${times(flagged)}${left > 0 ? `, you left it ${times(left)}` : ''}`;

/** Models… › the point check's counts, per point, over each model's latest run on your live films (films in Recently
 *  deleted are not counted). Nothing here changes anything: it is a record of how often the check spoke and how often you
 *  kept the point anyway. */
export function PointCheckCountsView({ rows, error }: { rows: PointCheckCount[]; error: string | null }) {
  const order = Object.keys(LANDMARKS), rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  const sorted = [...rows].sort((a, b) => rank(a.landmarkId) - rank(b.landmarkId) || a.landmarkId.localeCompare(b.landmarkId));
  return (
    <section className="point-check-counts" aria-label="Point check">
      <h3>Point check</h3>
      {error ? <p className="identity-note">The point check counts couldn't be read.</p>
        : !sorted.length ? <p className="identity-note">No point has been flagged yet.</p>
        : <ul>{sorted.map((r) => <li key={r.landmarkId} data-point={r.landmarkId}>
            {countLine((LANDMARKS as Record<string, { name: string }>)[r.landmarkId]?.name ?? r.landmarkId, r.flagged, r.left)}</li>)}</ul>}
    </section>
  );
}

/** Reads the counts when Models… opens. A failed read shows the plain line, never zeros. */
export function PointCheckCounts() {
  const [rows, setRows] = useState<PointCheckCount[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    library.pointCheckCounts().then((r) => { if (live) { setRows(r ?? []); setError(null); } }).catch((e) => { if (live) setError(String(e)); });
    return () => { live = false; };
  }, []);
  if (rows === null && error === null) return null;   // not read yet
  return <PointCheckCountsView rows={rows ?? []} error={error} />;
}
