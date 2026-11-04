import { MARK_WORDS, measurementDefinition, normSourcesFor, type NormSet } from '@ceph/analyses';

/** One measurement as the app computes it (owner, 7 Oct; headings fixed 12 Oct, T6-1): plain
 *  words, the points, the named lines and built points it reaches, a plain note on how any private helper works,
 *  which way is plus, an owner-approved note (NOTE-1), the source and mark, and the norm sources available.
 *  Every word comes from @ceph/analyses (never retyped); a heading is shown only when its section is non-empty. */
export function MeasurementDefinitionView({ id, sets }: { id: string; sets: NormSet[] }) {
  const d = measurementDefinition(id), sources = normSourcesFor(id, sets);
  return (
    <div className="definition">
      <p className="def-what">What is measured: {d.what}</p>
      {d.points.length > 0 && <p>Points: {d.points.map((p) => `${p.id} ${p.name}`).join(' · ')}</p>}
      {d.lines.length > 0 && <p>Lines: {d.lines.map((l) => l.name).join(' · ')}</p>}
      {d.builtPoints.length > 0 && <p>Built points: {d.builtPoints.map((p) => p.name).join(' · ')}</p>}
      {d.construction.length > 0 && <p>How it is built: {d.construction.join(' ')}</p>}
      {d.plus && <p>Which way is plus: {d.plus}</p>}
      {d.note && <p>Note: {d.note}</p>}
      <p>Source and mark: {d.mark} — {d.cite}{d.where ? `, ${d.where}` : ''} ({d.markWords})</p>
      {/* Fix round 1 (review M1): hidden entirely when empty, not shown as "Norms available: none" — every other
          section here is shown only when non-empty, and the brief gives no reason for this one to be the exception. */}
      {sources.length > 0 && <>
        <p>Norm sources:</p>
        <ul className="norm-sources">{sources.map((s) => (
          <li key={s.setId}>{s.citation} · {s.population}{s.status === 'website' ? ` · ${MARK_WORDS.W}` : ''}{s.via ? ` · via ${s.via}` : ''}{s.match === 'close' ? ` · close: ${s.note ?? ''}` : ''}</li>))}</ul>
      </>}
    </div>
  );
}
