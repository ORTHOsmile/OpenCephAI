import { useRef, useState } from 'react';
import type { Vec2 } from '@ceph/geometry';
import { checkCalibration, clampPanel } from '../tracing/calibration';

interface Props { p1: Vec2; p2: Vec2; onSave: (mm: number) => Promise<void>; onCancel: () => void }

/** Second half of calibration (decision 17): the true distance between the two ruler marks just clicked. */
export function CalibrateDialog({ p1, p2, onSave, onCancel }: Props) {
  const [text, setText] = useState(''), [err, setErr] = useState<string | null>(null), [saving, setSaving] = useState(false);
  // Drag the panel by its title so it never hides the ruler (owner, 28 Sep).
  const panel = useRef<HTMLDivElement>(null), grab = useRef<Vec2 | null>(null);
  const [pos, setPos] = useState<Vec2 | null>(null);
  const onGrab = (e: React.PointerEvent) => {
    const r = panel.current!.getBoundingClientRect();
    grab.current = { x: e.clientX - r.left, y: e.clientY - r.top };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDrag = (e: React.PointerEvent) => {
    if (!grab.current || !panel.current) return;
    const r = panel.current.getBoundingClientRect();
    setPos(clampPanel({ x: e.clientX - grab.current.x, y: e.clientY - grab.current.y }, { w: r.width, h: r.height }, { w: window.innerWidth, h: window.innerHeight }));
  };
  const mm = text.trim() ? Number(text.trim().replace(',', '.')) : NaN, check = checkCalibration(p1, p2, mm);
  const save = async () => {
    if (!check.ok || saving) return;
    setSaving(true);
    try { await onSave(mm); } catch (e) { setErr(String(e)); setSaving(false); }
  };
  return (
    <div className="calibrate-dialog" role="dialog" aria-label="Calibrate scale" ref={panel}
      style={pos ? { left: pos.x, top: pos.y, transform: 'none' } : undefined}>
      <b className="drag-handle" title="Drag to move" onPointerDown={onGrab} onPointerMove={onDrag}
        onPointerUp={() => { grab.current = null; }} onPointerCancel={() => { grab.current = null; }}>Calibrate scale <span aria-hidden="true">⠿</span></b>
      <p className="hint">The marks are {Math.hypot(p2.x - p1.x, p2.y - p1.y).toFixed(1)} px apart on the film.</p>
      <label>True distance between the marks
        <span className="row"><input autoFocus inputMode="decimal" aria-label="Distance in millimetres" value={text}
          onChange={(e) => { setText(e.target.value); setErr(null); }}
          onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') onCancel(); }} /> mm</span></label>
      {check.ok
        ? <p className="hint">{check.mmPerPx.toFixed(4)} mm per px{check.warning && <><br /><span className="warn">{check.warning}</span></>}</p>
        : (text.trim() || check.error.includes('px apart')) && <p className="error">{check.error}</p>}
      {err && <p className="error">{err}</p>}
      <div className="row">
        <button type="button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={!check.ok || saving} onClick={() => void save()}>Save</button>
      </div>
    </div>
  );
}
