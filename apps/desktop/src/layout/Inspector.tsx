import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { AnalysisDef, Compiled, Expr, NodeId, Value } from '@ceph/geometry';
import { DEFAULT_MEANINGS, DEFINITION_TO_COME, guidedSteps, isMine, meaningPhrase, nextStep, pointDefinition, stepDone, unavailableLine, unconfirmedAiPointsLine, LANDMARKS, type LandmarkId, type NormQuery } from '@ceph/analyses';
import type { ModelPointRow } from '../ipc';
import type { Action, TracingState } from '../tracing/state';
import { verifiedSet } from '../tracing/state';
import { AI_POINT_LABEL } from '../confidence';
import { scaleLabel, type Scale } from '../tracing/spacing';
import { Loupe, type Ruler } from '../loupe/Loupe';
import { ChartOverlay } from '../chart/ChartOverlay';
import { useStepAdvance } from '../tracing/advance';
import { measurementRows, missingPoints, missingText, otherLandmarks, rowKey, unplacedLandmarks, type MeasurementRow } from '../measurements';
import { fmtDelta, fmtValue, type Decimals } from '../format';
import { changeOf, pairs, type SeriesRow } from '../compare/series';
import { CALIBRATE_TO_SHOW, clinicalTargetText, firstHint, valueClass, type NormCell } from '../norms/normCell';
import { NormChooser } from '../norms/NormChooser';
import { PointAbout } from './PointAbout';

interface Props { bitmap: ImageBitmap | null; state: TracingState; dispatch: (a: Action) => void;
  defs: AnalysisDef[]; registry: Record<NodeId, Expr>; compiled: Compiled; values: Record<NodeId, Value | null>; scale: Scale;
  /** Serial superimposition (spec 2026-09-30): a value per ticked film, oldest first, and the chosen Change pair. */
  change?: SeriesChange | null;
  /** "Other points" (Part A task 9, fix round 1): collapsed by default, remembered on this Mac the
   *  same way Enhance/Text on the film are (App.tsx owns the setting, like those two). */
  otherPointsOpen: boolean; onOtherPoints: () => void;
  /** Owner DEC-1: decimals shown, the operator's setting on this Mac (App.tsx reads it). Display only. */
  decimals: Decimals;
  /** Task 5 (N1/N4/N5): the norm cell for a Measurements row — null with no case open, or when the committed norm
   *  sets failed to load (`normsError` then says why instead). */
  normFor: ((r: MeasurementRow) => NormCell | null) | null;
  /** Task 5: either failed read `useNorms()` reports (a broken norm-set load, or a failed settings read), joined
   *  into one line; never swallowed. */
  normsError: string | null;
  /** N5: opens the ruler tool from the "calibrate to show" link. */
  onCalibrate: () => void;
  /** Fix round 1 (review, decision 5): true on the read-only Superimposition page. There the toolbar's own
   *  Calibrate button is already disabled (`Toolbar.tsx`'s `edit = canEdit && page === 'tracing'`); the
   *  Inspector's "calibrate to show" link must not quietly offer a working shortcut around that — it reads as
   *  plain text there instead of a button, consistent with the Change table's hidden cell (which is also
   *  plain text, because the Change table only ever appears on this page). */
  readOnly: boolean;
  /** Part D task 7: the points some installed model places (Task 6's `found`), so the guided steps put them
   *  first and the Measurements tab can name what no model finds. */
  found: ReadonlySet<string>;
  /** Part D task 9: Part B's live models table ("could not be read" when null), for "who finds this point". */
  pointTable: ModelPointRow[] | null;
  /** Final review I-2 (ruling): the unconfirmed AI points each measurement uses, computed once in App.tsx for every
   *  screen that shows the value (here and the compare window). */
  unconfirmedFor: (node: string) => string[];
  /** Owner NORM-PICK-1: the query behind a row's norm cell (for the "choose one" list), and saving a choice — null when
   *  choosing is not allowed (the read-only Superimposition page, or the case's choices not read yet). */
  normQueryFor: ((r: MeasurementRow) => NormQuery | null) | null;
  onPickNorm: ((population: string, measurement: string, source: string) => void) | null;
  /** Task 3 (spec 2026-10-13 §5.1 "Shown"): the point's source line ("Placed by Aariz", …), derived in App.tsx; null
   *  for points the main placement did not place. */
  placedLineFor: (id: string) => string | null;
  /** Owner, 16 Oct (C): the ruler marks while calibrating (the magnifier works on them); null otherwise. */
  ruler?: Ruler | null;
  /** Owner MEANING-PER-CLINICIAN (16 Oct): the current clinician's (or the approved) words for a measurement. */
  meaningWords?: (id: string) => { high: string; low: string } | undefined;
}
export interface SeriesChange {
  heads: string[]; ids: string[]; rows: SeriesRow[]; pair: { from: string; to: string }; labels: Record<string, string>;
  onPair: (p: { from: string; to: string }) => void; note: string | null;
}

/** The hover label of a point in the Landmarks list, with its source line when there is one. */
const withPlaced = (title: string, line: string | null) => (line ? `${title} — ${line}` : title);

export function Inspector({ bitmap, state, dispatch, defs, registry, compiled, values, scale, change, otherPointsOpen, onOtherPoints, decimals, normFor, normsError, onCalibrate, readOnly, found, pointTable, unconfirmedFor, normQueryFor, onPickNorm, placedLineFor, ruler = null, meaningWords }: Props) {
  const [tab, setTab] = useState<'steps' | 'landmarks' | 'measures' | 'chart' | 'change'>('landmarks');
  // Owner CHART-TAB-1 (16 Oct): the Chart tab is the Measurements table with the chart drawn over its Result and
  // Mean ± SD cells, so its rows are the same rows.
  const table = tab === 'measures' || tab === 'chart', tableBox = useRef<HTMLDivElement>(null);
  // NORM-PICK-1: the row (and population) whose "choose one" list is open.
  const [choosing, setChoosing] = useState<{ key: string; population: string } | null>(null);
  // Owner, 16 Oct: a norm's source line shows only when its row is clicked (or Enter/Space on the focused row).
  const [openSrc, setOpenSrc] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => { setOpenSrc(new Set()); }, [bitmap]);   // review M-5: another film opens with every source line closed
  const toggleSrc = (k: string) => setOpenSrc((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  useEffect(() => { if (change) setTab('change'); else setTab((t) => (t === 'change' ? 'landmarks' : t)); }, [!!change]);   // eslint-disable-line react-hooks/exhaustive-deps
  const id = state.active, p = id ? state.points[id] : null, verified = verifiedSet(state);
  const steps = useMemo(() => guidedSteps(defs, registry, found), [defs, registry, found]);
  const shown = useStepAdvance(state, steps, dispatch), next = nextStep(steps, shown);   // highlight moves with the magnifier, after a pause
  // Part A task 9: "Not placed" lists only the points some enabled analysis of `defs` actually
  // needs, not every catalogue point (~59) — e.g. Co (McNamara) and U1A (Steiner) show, a
  // Holdaway-only point like SPogS does not, until Holdaway is enabled too.
  const unplaced = useMemo(() => unplacedLandmarks(defs, compiled, new Set(Object.keys(state.points))), [defs, compiled, state.points]);
  // Fix round 1 (review): the filter above also removed the only way to place a point
  // no enabled analysis needs (e.g. SPogS) — kept reachable here, collapsed by default, under
  // "Other points".
  const other = useMemo(() => otherLandmarks(defs, compiled, new Set(Object.keys(state.points))), [defs, compiled, state.points]);
  const rows = measurementRows(defs, compiled, values, new Set(Object.keys(state.points)), decimals, scale);
  // Part D task 7: the points no installed model finds and that are not placed yet, and what they'd complete.
  const miss = useMemo(() => missingPoints(defs, compiled, found, new Set(Object.keys(state.points))), [defs, compiled, found, state.points]);
  // One norm cell per row, computed once per render (the sex hint above the table and every row's cell share it).
  const cells = rows.map((r) => normFor?.(r) ?? null);
  // Fix round 1, ruling T5-1: the resolver's own hint, not a re-derivation from one flag.
  const hint = firstHint(cells);
  // Owner B1 (17 Oct): a My analysis measurement no longer in the catalogue is named once, above the table — never a row.
  const gone = defs.filter(isMine).map(unavailableLine).filter((t): t is string => t !== null);
  return (
    <aside className="inspector">
      <div className="active-head">{ruler ? <><b>Ruler</b><span>Calibrating the scale</span></> : <><b>{id ?? '—'}</b><span>{id && LANDMARKS[id as LandmarkId]?.name}</span></>}</div>
      <Loupe bitmap={bitmap} state={state} dispatch={dispatch} ruler={ruler} />
      <p className="hint">{ruler   // review M-3: while calibrating, the magnifier is on the ruler
        ? (ruler.marks.length < 2 ? `Click the ${ruler.marks.length ? 'second' : 'first'} ruler mark, on the film or in the magnifier. Esc cancels.` : 'Drag a ruler mark, on the film or in the magnifier, to fine-tune it.')
        : id && !p ? `Click the film to place ${id}. Esc cancels.` : `Drag the ring or press in the magnifier to place ${id ?? 'a point'}. Arrow keys nudge 1 px (⇧ 10). ⌫ removes it.`}</p>
      {/* Re-review M-3: while calibrating there is no landmark to accept. */}
      {!ruler && <div className="status-row">
        <span className={p?.verified ? 'chip verified' : 'chip ai'}>{p?.verified ? 'Verified' : AI_POINT_LABEL}</span>
        <button type="button" className="primary" disabled={!p || p.verified} onClick={() => dispatch({ type: 'accept' })}>Accept position</button>
      </div>}
      <div role="tablist" className="tabs">
        {(['steps', 'landmarks', 'measures', 'chart'] as const).map((t) => (
          <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t === 'steps' ? 'Steps' : t === 'landmarks' ? 'Landmarks' : t === 'measures' ? 'Measurements' : 'Chart'}</button>
        ))}
        {change && <button role="tab" aria-selected={tab === 'change'} onClick={() => setTab('change')}>Change</button>}
      </div>
      {/* Owner, 16 Oct: the name, magnifier, Accept and tabs stay put; only what is under the tabs scrolls. */}
      <div className="inspector-scroll">
      {tab === 'steps' && <ol className="steps">{steps.map((s) => (
        <li key={s.node + s.kind} className={stepDone(s, shown) ? 'done' : s === next ? 'next' : ''}>
          <button type="button" onClick={() => { const l = s.landmarks.find((x) => !verified.has(x)) ?? s.landmarks[0]; if (l) dispatch({ type: 'select', id: l }); }}>{s.label}</button>
        </li>))}</ol>}
      {tab === 'landmarks' && <ul className="lm-list">
        {Object.entries(state.points).map(([k, q]) => (
          <li key={k}><button type="button" aria-current={k === id} title={withPlaced(pointDefinition(k as LandmarkId).definition ?? `${LANDMARKS[k as LandmarkId]?.name} — ${DEFINITION_TO_COME}`, placedLineFor(k))} onClick={() => dispatch({ type: 'select', id: k })}>
            <b>{k}</b><span>{LANDMARKS[k as LandmarkId]?.name}</span><span className={q.verified ? 'st verified' : 'st ai'}>{q.verified ? 'Verified' : 'AI'}</span></button></li>))}
        {unplaced.length > 0 && <li className="lm-head">Not placed</li>}
        {unplaced.map((k) => (
          <li key={k}><button type="button" aria-current={k === id} title={withPlaced(pointDefinition(k).definition ?? `${LANDMARKS[k].name} — ${DEFINITION_TO_COME}`, placedLineFor(k))} onClick={() => dispatch({ type: 'select', id: k })}>
            <b>{k}</b><span>{LANDMARKS[k].name}</span><span className="st todo">Place</span></button></li>))}
        {other.length > 0 && <li className="lm-head collapsible"><button type="button" className="toggle" aria-expanded={otherPointsOpen} onClick={onOtherPoints}>
          <span className="tri" aria-hidden="true">{otherPointsOpen ? '▾' : '▸'}</span>Other points ({other.length})</button></li>}
        {otherPointsOpen && other.map((k) => (
          <li key={k}><button type="button" aria-current={k === id} title={withPlaced(pointDefinition(k).definition ?? `${LANDMARKS[k].name} — ${DEFINITION_TO_COME}`, placedLineFor(k))} onClick={() => dispatch({ type: 'select', id: k })}>
            <b>{k}</b><span>{LANDMARKS[k].name}</span><span className="st todo">Place</span></button></li>))}
      </ul>}
      {tab === 'landmarks' && <PointAbout id={id} table={pointTable} placedLine={id ? placedLineFor(id) : null} />}
      {table && normsError && <p className="hint warn">{normsError}</p>}
      {table && hint && <p className="hint warn sex-hint">{hint}</p>}
      {table && gone.map((t) => <p key={t} className="hint warn unavailable">{t}</p>)}
      {/* Fix round 1 (Minor 3): by analogy with "calibrate to show" (decision 5), the read-only Superimposition
         page still NAMES what is missing but never offers the placing shortcut there — readOnly means no editing,
         and "Place them" switches to Steps and selects a point to edit. */}
      {table && miss.points.length > 0 && <p className="hint warn missing-points">{missingText(miss)}
        {!readOnly && <>{' '}<button type="button" className="link" onClick={() => { setTab('steps'); dispatch({ type: 'select', id: miss.points[0] }); }}>Place them</button></>}</p>}
      {table && <div className="measures-box" ref={tableBox}>
      <table className={tab === 'chart' ? 'measures chart' : 'measures'}>
        {/* Owner TABLE-2 (16 Oct): no "Measurement" heading (the tab says it); Result, then Mean ± SD. */}
        <thead><tr><th aria-label="Measurement"></th><th>Result</th><th>Mean ± SD</th></tr></thead>
        <tbody>{rows.map((r, i) => { const c = cells[i];
          const u = unconfirmedFor(r.node);
          const q = c?.choose && onPickNorm ? normQueryFor?.(r) ?? null : null;
          const open = q && choosing?.key === rowKey(r) ? choosing.population : null;
          // SEVERITY-2: the detail line opens with how far off the value is (e.g. "Moderate · 2.3 SD above the mean").
          // MEANING-APPROVE: the phrase ("Mild Class II", "Class II tendency") leads when the measurement has words.
          const phrase = meaningPhrase(c?.severity ?? null, meaningWords?.(r.node));
          const sevWord = c?.severity ? phrase ?? `${c.severity.word[0].toUpperCase()}${c.severity.word.slice(1)}` : null;
          const sev = c?.severity && c.z !== null && c.severity.word !== 'within normal range' ? `${sevWord} · ${Math.abs(c.z).toFixed(2)} SD ${c.severity.side} the mean` : null;   // review M-3: 2 decimals, so 1.04 never reads "1.0"
          const src = c && (c.sourceLine || c.target) ? [sev, c.sourceLine, c.target ? clinicalTargetText(c.target) : null].filter(Boolean).join(' · ') : null;
          const k = rowKey(r), srcOpen = !!src && openSrc.has(k);
          // A click on a link or button inside the row (calibrate, choose a norm) does its own job, not this toggle.
          const onRow = (e: React.MouseEvent) => { if (src && !(e.target as HTMLElement).closest('button, a, select, input')) toggleSrc(k); };
          const onRowKey = (e: React.KeyboardEvent) => { if (src && e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggleSrc(k); } };
          return (<Fragment key={k}>
          <tr className={src ? 'm-row has-src' : 'm-row'} data-node={r.node} data-key={k} {...(src ? { 'aria-expanded': srcOpen, tabIndex: 0, title: srcOpen ? 'Hide where this norm comes from' : 'Show where this norm comes from', onClick: onRow, onKeyDown: onRowKey } : {})}>
            {tab === 'chart'   // MEANING-APPROVE: the Chart shows the approved abbreviation; the hidden full name keeps the row height
              ? <td className="m-label"><span className="sizer" aria-hidden="true">{r.label}</span><span className="abbr" title={r.label}>{DEFAULT_MEANINGS[r.node]?.abbr ?? r.label}</span></td>
              : <td className="m-label">{r.label}</td>}
            <td className={valueClass(c)} data-band={c?.band ?? ''}>
              {r.hidden
                ? (readOnly ? <span>{CALIBRATE_TO_SHOW}</span> : <button type="button" className="link" onClick={onCalibrate}>{CALIBRATE_TO_SHOW}</button>)
                : r.value ?? <span className="needs">{r.undefinedReason ?? `Needs: ${r.needs.join(', ')}`}</span>}
              {/* Owner SEVERITY-1/TABLE-2: the stars straight after the Result. */}
              {c?.severity?.stars && !r.hidden && <span className="stars" aria-label={`${c.severity.word}, ${c.severity.side} the norm`}> {c.severity.stars}</span>}</td>
            <td className="m-norm">{c ? <>{q && c.choose
              ? <button type="button" className="link norm-choose" onClick={() => setChoosing({ key: rowKey(r), population: c.choose!.population })}>{c.text}</button>
              : c.text}{c.badges.map((b) => <span key={b.flag} className="norm-badge" title={b.tip}>{b.badge}</span>)}</> : null}
              {/* Owner, 16 Oct (F): a small red "AI" at the row's end instead of a line under the label; it names the
                 points on hover and, where editing is allowed, selects the first one to check. */}
              {u.length > 0 && (readOnly
                ? <span className="ai-tag warn" title={unconfirmedAiPointsLine(u)}>AI</span>
                : <button type="button" className="ai-tag warn" title={`${unconfirmedAiPointsLine(u)} — click to check ${u[0]}`} aria-label={`AI: ${unconfirmedAiPointsLine(u)}. Check ${u[0]}`}
                    onClick={() => dispatch({ type: 'select', id: u[0] })}>AI</button>)}</td>
          </tr>
          {open && q && <tr className="norm-choose-row"><td colSpan={3}>
            <NormChooser q={{ ...q, population: open }} decimals={decimals} onClose={() => setChoosing(null)}
              onPick={(source) => { onPickNorm?.(open, r.node, source); setChoosing(null); }} /></td></tr>}
          {srcOpen && <tr className="norm-src"><td colSpan={3}>{src}</td></tr>}
        </Fragment>); })}</tbody>
      </table>
      {tab === 'chart' && <ChartOverlay box={tableBox} decimals={decimals} items={rows.map((r, i) => ({ key: rowKey(r), group: r.analysisId, node: r.node, z: r.hidden ? null : cells[i]?.z ?? null,
        mean: cells[i]?.mean ?? null, sd: cells[i]?.sd ?? null, unit: r.unit }))} />}
      </div>}
      {tab === 'change' && change && <>
        <label className="pair">Change <select aria-label="Change between" value={`${change.pair.from}>${change.pair.to}`}
          onChange={(e) => { const [from, to] = e.target.value.split('>'); change.onPair({ from, to }); }}>
          {pairs(change.ids).map((p) => <option key={`${p.from}>${p.to}`} value={`${p.from}>${p.to}`}>{change.labels[p.from]} → {change.labels[p.to]}</option>)}
        </select></label>
        <div className="change-wrap"><table className="measures">
          <thead><tr><th>Measurement</th>{change.heads.map((h, i) => { const [tp, date] = h.split(' · ');
            return <th key={change.ids[i]} title={h}>{tp}{date && <small>{date}</small>}</th>; })}<th>Change</th></tr></thead>
          {/* Fix round 1 (review Minor 4, decision 5): plain text, never a link — the Change table only ever
             appears on the read-only Superimposition page, where "calibrate to show" must not offer a working
             shortcut (the toolbar's own Calibrate button is disabled there). Confirmed by testing: see e2e10's
             Superimposition checks. */}
          <tbody>{change.rows.map((r) => { const d = changeOf(r, change.ids.indexOf(change.pair.from), change.ids.indexOf(change.pair.to));
            return <tr key={r.node}><td>{r.label}</td>{r.values.map((v, i) => <td key={i}>{r.hidden?.[i] ? CALIBRATE_TO_SHOW : v === null ? '—' : fmtValue(v, r.unit, decimals)}</td>)}
              <td>{d === null ? '' : fmtDelta(d, r.unit, decimals)}</td></tr>; })}</tbody>
        </table></div>
        {change.note && <p className="hint warn">{change.note}</p>}
      </>}
      {tab === 'measures' && <p className="hint">Scale {scaleLabel(scale)}. Levelling, mirroring or enhancing the film never changes a value.</p>}
      </div>
    </aside>
  );
}
