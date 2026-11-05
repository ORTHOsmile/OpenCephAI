import { useContext, useEffect } from 'react';
import type { Vec2 } from '@ceph/geometry';
import type { Box } from '../ipc';
import type { Dims } from './orientation';
import type { ChooseApi } from '../library/useChoose';
import { CHOOSE_LABELS, selSpans } from '../library/choose';
import { CHOOSE_TO_DETAIL, chooserChoices, type FilmDetail } from '../library/filmTable';
import { conflictFieldName } from '../library/identity';
import { FilmDetailsOff } from '../settings/filmDetails';

/** A tint per kind of detail, so the words used for each stay distinguishable (owner, 30 Sep: M2). Keyed by
 *  `FilmDetail` since Task 4: the chooser's drop-down saves the drop-down's own ids (Gender, Referring practitioner
 *  included), not only the Choose-on-the-film fields. */
const TINT: Record<FilmDetail, string> = { name: 'f-name', last: 'f-name', first: 'f-name', dob: 'f-dob', date: 'f-date', scan: 'f-id',
  patientId: 'f-id', xrayType: 'f-film', xraySize: 'f-film', practice: 'f-film', gender: 'f-film', referrer: 'f-film', title: 'f-name', age: 'f-dob' };

interface Props { api: ChooseApi; dims: Dims; S: (p: Vec2) => Vec2 }

/** A box (0–1 of the stored film) as its four screen corners: follows rotation, flip and zoom like the landmarks. */
function corners(b: Box, dims: Dims, S: (p: Vec2) => Vec2): Vec2[] {
  const px = (u: number, v: number) => S({ x: u * dims.W - 0.5, y: v * dims.H - 0.5 });
  return [px(b[0], b[1]), px(b[0] + b[2], b[1]), px(b[0] + b[2], b[1] + b[3]), px(b[0], b[1] + b[3])];
}
const pts = (c: Vec2[]) => c.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
const union = (bs: Box[]): Box => {
  const x0 = Math.min(...bs.map((b) => b[0])), y0 = Math.min(...bs.map((b) => b[1]));
  const x1 = Math.max(...bs.map((b) => b[0] + b[2])), y1 = Math.max(...bs.map((b) => b[1] + b[3]));
  return [x0, y0, x1 - x0, y1 - y0];
};
const below = (c: Vec2[]) => ({ left: Math.min(...c.map((p) => p.x)), top: Math.max(...c.map((p) => p.y)) + 6 });
const above = (c: Vec2[]) => ({ left: Math.min(...c.map((p) => p.x)), top: Math.min(...c.map((p) => p.y)) - 22 });

/** Choose mode on the film (spec 2026-09-29 Part 1): recognised words outlined, learned places tagged, and a chooser. */
export function ChooseLayer({ api, dims, S }: Props) {
  const { choose, lines, used, suggestions, labels } = api;
  const off = useContext(FilmDetailsOff);
  useEffect(() => {                                                   // from a Pick button, Enter uses the selection
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && choose?.target && choose.sel) { e.preventDefault(); void api.onLabel(choose.target); }
    };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [api, choose]);
  if (!choose) return null;
  const sel = choose.sel;
  const selBoxes = sel && lines[sel.line] ? selSpans(lines, sel).filter((p) => lines[p.line]?.words.length)
    .map((p) => corners(union(lines[p.line].words.slice(p.from, p.to + 1).map((w) => w.bbox)), dims, S)) : [];
  const selBox = selBoxes.length ? selBoxes[selBoxes.length - 1] : null;
  const onLabel = labels.map((l) => ({ l, c: corners(union(lines[l.sel.line].words.slice(l.sel.from, l.sel.to + 1).map((w) => w.bbox)), dims, S) }));
  const inSel = (i: number, j: number) => !!sel && selSpans(lines, sel).some((p) => p.line === i && j >= p.from && j <= p.to);
  const choices = chooserChoices(off, choose.target ? CHOOSE_TO_DETAIL[choose.target] : null);
  const tags = suggestions.filter((s) => lines[s.line]?.words.length > s.to).map((s) => ({
    s, c: corners(union(lines[s.line].words.slice(s.from, s.to + 1).map((w) => w.bbox)), dims, S) }));
  return (
    <>
      <svg className="overlay choose-layer" aria-hidden="true">
        {tags.map(({ s, c }) => <polygon key={`s${s.field}${s.line}${s.from}`} className="choose-place" points={pts(c)} />)}
        {onLabel.map(({ l, c }) => <polygon key={`l${l.field}`} className="choose-label" points={pts(c)} />)}
        {lines.map((l, i) => l.words.map((w, j) => {
          const on = inSel(i, j), u = used[`${i}:${j}`];
          return <polygon key={`${i}:${j}`} className={`choose-word${on ? ' selected' : ''}${u ? ` used ${TINT[u]}` : ''}`} points={pts(corners(w.bbox, dims, S))} />;
        }))}
      </svg>
      {tags.map(({ s, c }) => (
        <div key={`t${s.field}${s.line}${s.from}`} className="choose-suggested" style={above(c)}>
          {s.isDefault ? 'Learned' : 'Suggested'}: {CHOOSE_LABELS[s.field as keyof typeof CHOOSE_LABELS] ?? s.field}</div>))}
      {onLabel.map(({ l, c }) => <div key={`lt${l.field}`} className="choose-suggested choose-label-tag" style={below(c)}>On the label: {conflictFieldName(l.field)}</div>)}
      {selBox && <div className="chooser" role="group" aria-label="Use the selected words as" style={below(selBox)}
        onPointerDown={(e) => e.stopPropagation()}>
        {/* Owner E (19 Oct): one small drop-down with the panel's list, not a block of buttons. Choosing saves at once.
            Esc here clears the selection, as ✕ does (R9); the app's own Esc (Choose mode off) never sees a select. */}
        <select aria-label="Use the selected words as" value="" onChange={(e) => { if (e.target.value) void api.onChoice(e.target.value as FilmDetail); }}
          onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); api.clearSel(); } }}>
          <option value="">Use as…</option>
          {choices.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </select>
        <button type="button" className="icon-btn" aria-label="Cancel" title="Cancel (Esc)" onClick={api.clearSel}>✕</button>
      </div>}
    </>
  );
}
