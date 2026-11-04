import { useMemo, useState } from 'react';
import { NO_LONGER_AVAILABLE, byId, isLive, moveItem, normFromWords, originFor, searchGroups, type MyItem, type NormSet } from '@ceph/analyses';

export interface EditorDraft { id: string | null; name: string; items: MyItem[] }

/** Settings › Analyses › New analysis… / Edit… (owner B1; spec Option A): a name; the chosen measurements in order
 *  (↑ ↓, or drag); a searchable list of every catalogue measurement, grouped, with ticks. Built-ins never open here. */
export function MyAnalysisEditor({ initial, sets, error, onSave, onCancel }: {
  initial: EditorDraft; sets: NormSet[]; error: string | null; onSave: (d: EditorDraft) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [items, setItems] = useState<MyItem[]>(initial.items);
  const [query, setQuery] = useState('');
  const [drag, setDrag] = useState<number | null>(null);
  const groups = useMemo(() => searchGroups(query), [query]);
  const chosen = new Set(items.map((i) => i.id));
  const toggle = (id: string) => setItems((xs) => (xs.some((x) => x.id === id) ? xs.filter((x) => x.id !== id) : [...xs, { id, from: originFor(id, sets) }]));
  const label = (id: string) => (isLive(id) ? byId(id).label : `${id} — ${NO_LONGER_AVAILABLE}`);
  return (
    <div className="my-analysis-editor" role="group" aria-label={initial.id ? 'Edit analysis' : 'New analysis'}>
      <label>Name <input value={name} onChange={(e) => setName(e.target.value)} /></label>
      <h4>In this analysis ({items.length})</h4>
      {items.length === 0
        ? <p className="hint">Tick measurements below to add them.</p>
        : <ol className="my-chosen">{items.map((it, i) => (
          <li key={it.id} className={isLive(it.id) ? 'my-item' : 'my-item unavailable'} data-node={it.id} draggable
            onDragStart={() => setDrag(i)} onDragOver={(e) => e.preventDefault()}
            onDrop={() => { if (drag !== null) setItems((xs) => moveItem(xs, drag, i)); setDrag(null); }}>
            <span className="my-label">{label(it.id)}</span>
            {isLive(it.id) && <span className="my-norm hint">{normFromWords(it.from, it.id, sets)}</span>}
            <button type="button" aria-label={`Move ${label(it.id)} up`} disabled={i === 0} onClick={() => setItems((xs) => moveItem(xs, i, i - 1))}>↑</button>
            <button type="button" aria-label={`Move ${label(it.id)} down`} disabled={i === items.length - 1} onClick={() => setItems((xs) => moveItem(xs, i, i + 1))}>↓</button>
            <button type="button" aria-label={`Remove ${label(it.id)}`} onClick={() => setItems((xs) => xs.filter((_, j) => j !== i))}>✕</button>
          </li>))}</ol>}
      <label>Find a measurement <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="name, abbreviation or #number" /></label>
      {groups.length === 0 && <p className="hint">No measurement matches “{query}”.</p>}
      {groups.map((g) => (
        <fieldset key={g.title} className="my-group"><legend>{g.title}</legend>
          {g.entries.map((e) => (
            <label key={e.id} className="my-pick" data-node={e.id}>
              <input type="checkbox" checked={chosen.has(e.id)} onChange={() => toggle(e.id)} aria-label={`Include ${e.label}`} />
              {e.label} <span className="hint">#{e.no}</span>
            </label>))}
        </fieldset>))}
      {error && <div role="alert">{error}</div>}
      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" onClick={() => onSave({ id: initial.id, name, items })}>Save analysis</button>
      </div>
    </div>
  );
}
