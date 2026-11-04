import { useEffect, useState } from 'react';
import { operators, type Operators } from '../ipc';
import { announceClinician } from '../settings/useMeanings';
/** "Tracing: Dr A ▾" (spec Part 3): who verifies the tracings on this Mac. Clinicians' names only. */
export function OperatorPicker() {
  const [ops, setOps] = useState<Operators | null>(null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { operators.list().then(setOps).catch(() => {}); }, []);
  if (!ops) return null;
  // A name set as "Your name" in the Library may not be in the list yet: it is still shown as the one tracing.
  const names = ops.names.includes(ops.current) ? ops.names : [ops.current, ...ops.names];
  const save = async () => {
    try { setOps(await operators.add(name)); announceClinician(); setAdding(false); setName(''); setErr(null); } catch (e) { setErr(String(e)); }
  };
  return (
    <div className="operator">
      <label>Tracing:{' '}
        {adding
          ? <input autoFocus aria-label="New name" value={name} maxLength={60} onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') { setAdding(false); setErr(null); } }} />
          : <select aria-label="Who is tracing" value={ops.current} onChange={(e) => {
              const v = e.target.value;
              if (v === '__add') { setAdding(true); return; }
              operators.setCurrent(v).then(() => { setOps({ ...ops, current: v }); announceClinician(); }).catch((x) => setErr(String(x)));
            }}>
              {names.map((n) => <option key={n} value={n}>{n}</option>)}
              <option value="__add">Add…</option>
            </select>}
      </label>
      {adding && <><button type="button" onClick={() => void save()}>Add</button><button type="button" onClick={() => { setAdding(false); setErr(null); }}>Cancel</button></>}
      {err && <span className="error" role="alert">{err}</span>}
    </div>
  );
}
