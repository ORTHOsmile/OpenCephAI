import { useLayoutEffect, useState, type RefObject } from 'react';
import type { Unit } from '@ceph/geometry';
import type { Decimals } from '../format';
import { tickLabels, xOf } from './polygon';

/** One measurement row as the chart needs it: its z (null = no value or no usable SD) and its norm, for the ticks. */
export interface ChartItem { key: string; group: string; node: string; z: number | null; mean: number | null; sd: number | null; unit: Unit }
interface RowBox { top: number; mid: number; x0: number; w: number }

/** Owner CHART-TAB-1 (16 Oct 2026): the polygon chart, drawn over the Measurements table's Result and Mean ± SD cells
 *  (which stay in place, invisible), so its rows are the table's own rows — same order, same heights. Each row: a grey
 *  scale line in SD units around the norm's mean (±3 SD), the green ±1 SD band and mean, grey ticks at mean and ±2 SD
 *  in the row's own units, and a black dot; the dots are joined by one black line. A row with no z: grey line only. */
export function ChartOverlay({ box, items, decimals }: { box: RefObject<HTMLDivElement>; items: ChartItem[]; decimals: Decimals }) {
  // Review M-5: re-measure when the rows themselves change; size changes (a detail row opening, the window) come
  // through the ResizeObserver. A drag changes only z, which needs no new layout.
  const layoutKey = items.map((it) => it.key).join('|');
  const [rows, setRows] = useState<Record<string, RowBox>>({});
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const measure = () => {
      const b = el.getBoundingClientRect(), out: Record<string, RowBox> = {};
      el.querySelectorAll<HTMLTableRowElement>('tr.m-row[data-key]').forEach((tr) => {
        const v = tr.querySelector('td.m-value, td[data-band]'), n = tr.querySelector('td.m-norm');
        if (!v || !n) return;
        const r = tr.getBoundingClientRect(), a = v.getBoundingClientRect(), c = n.getBoundingClientRect();
        out[tr.dataset.key!] = { top: r.top - b.top, mid: r.top - b.top + r.height / 2, x0: a.left - b.left + 4, w: c.right - a.left - 8 };
      });
      setRows(out);
    };
    measure();
    const ro = new ResizeObserver(measure); ro.observe(el);
    return () => ro.disconnect();
  }, [box, layoutKey]);

  const pts = items.flatMap((it) => { const r = rows[it.key]; return r && r.w > 0 && it.z !== null ? [{ key: it.key, group: it.group, node: it.node, ...xOf(it.z, r.w), r }] : []; });
  return (
    <svg className="chart-overlay" aria-label="Polygon chart: each measurement against its norm, in SDs" role="img">
      {items.map((it) => {
        const r = rows[it.key]; if (!r || r.w <= 0) return null;   // a row not laid out yet: nothing to draw
        const at = (z: number) => r.x0 + xOf(z, r.w).x;
        const has = it.z !== null && it.mean !== null && it.sd !== null;
        return (
          <g key={it.key} className="chart-row" data-node={it.node} data-z={it.z === null ? '' : it.z.toFixed(3)}>
            <line className="scale" x1={r.x0} x2={r.x0 + r.w} y1={r.mid} y2={r.mid} />
            {has && <>
              <rect className="norm-band" x={at(-1)} width={at(1) - at(-1)} y={r.mid - 5} height={10} />
              <line className="norm-mean" x1={at(0)} x2={at(0)} y1={r.mid - 7} y2={r.mid + 7} />
              {tickLabels(it.mean!, it.sd!, it.unit, decimals).map((t, i) => (
                <text key={i} className="tick" x={at((i - 1) * 2)} y={r.top + 9} textAnchor="middle">{t}</text>))}
            </>}
          </g>
        );
      })}
      {/* Review M-8: one black line per analysis, as in the owner's example charts. */}
      {[...new Set(pts.map((p) => p.group))].map((g) => { const ps = pts.filter((p) => p.group === g);
        return ps.length > 1 ? <polyline key={g} className="patient" data-group={g} points={ps.map((p) => `${p.r.x0 + p.x},${p.r.mid}`).join(' ')} /> : null; })}
      {pts.map((p) => (
        <g key={p.key} data-node={p.node}>
          <circle className="patient-dot" cx={p.r.x0 + p.x} cy={p.r.mid} r={2.5} />
          {p.off !== 0 && <path className="off-scale" d={p.off > 0 ? `M${p.r.x0 + p.x - 6},${p.r.mid - 4} l6,4 l-6,4` : `M${p.r.x0 + p.x + 6},${p.r.mid - 4} l-6,4 l6,4`} />}
        </g>))}
    </svg>
  );
}
