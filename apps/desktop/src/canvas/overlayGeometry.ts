import type { Expr, NodeId, Vec2 } from '@ceph/geometry';
import type { PlaneKey } from '../tracing/state';
import type { Dims } from './orientation';

export const PLANES: { key: PlaneKey; label: string; node: NodeId; colour: string; dash?: string; weight: 'major' | 'minor' }[] = [
  { key: 'sn', label: 'S–N', node: 'SN', colour: 'var(--plane-sn)', dash: '6 4', weight: 'major' },
  { key: 'fh', label: 'Frankfort', node: 'FH', colour: 'var(--plane-fh)', weight: 'major' },
  { key: 'pp', label: 'Palatal', node: 'PP', colour: 'var(--plane-pp)', weight: 'major' },
  { key: 'mp', label: 'Mandibular', node: 'GoMe', colour: 'var(--plane-mp)', weight: 'major' },
  { key: 'na', label: 'N–A', node: 'NA', colour: 'var(--plane-sn)', weight: 'minor' },
  { key: 'nb', label: 'N–B', node: 'NB', colour: 'var(--plane-sn)', weight: 'minor' },
  { key: 'fp', label: 'Facial (N–Pog)', node: 'NPog', colour: 'var(--plane-fp)', dash: '3 3', weight: 'minor' },
];

/** Segments between each visible plane's two defining landmarks; planes with a missing point are skipped. */
export function planeSegments(registry: Record<NodeId, Expr>, pos: Readonly<Record<string, Vec2 | undefined>>, visible: Record<PlaneKey, boolean>) {
  const pointOf = (id: NodeId): Vec2 | undefined => { const e = registry[id]; return e?.kind === 'landmark' ? pos[e.id] : undefined; };
  return PLANES.filter((p) => visible[p.key]).flatMap((p) => {
    const e = registry[p.node]; if (e?.kind !== 'line') return [];
    const a = pointOf(e.a), b = pointOf(e.b);
    return a && b && (a.x !== b.x || a.y !== b.y) ? [{ key: p.key, a, b, colour: p.colour, dash: p.dash, weight: p.weight }] : [];
  });
}

export const PROFILE_HARD = ['S', 'N', 'ANS', 'A', 'U1T', 'L1T', 'B', 'Pog', 'Gn', 'Me', 'Go', 'Ar'];
export const PROFILE_SOFT = ['Sn', 'UL', 'LL', 'PogS'];
export function profilogramPaths(pos: Readonly<Record<string, Vec2 | undefined>>) {
  const pick = (ids: string[]) => ids.map((id) => pos[id]).filter((p): p is Vec2 => !!p);
  return { hard: pick(PROFILE_HARD), palatal: pick(['PNS', 'ANS']), soft: pick(PROFILE_SOFT) };
}

type Seg = { a: Vec2; b: Vec2 };
/** Grid in true millimetres (1 mm = 1/mmPerPx image px), aligned with Frankfort and anchored at Po (decision 15c). */
export function mmGrid(Po: Vec2, Or: Vec2, mmPerPx: number, dims: Dims) {
  const L = Math.hypot(Or.x - Po.x, Or.y - Po.y);
  if (!(L > 0)) return null;                               // Po on Or: no Frankfort direction, so no grid
  const u = { x: (Or.x - Po.x) / L, y: (Or.y - Po.y) / L }, v = { x: -u.y, y: u.x };
  const px = 1 / mmPerPx, at = (s: number, t: number): Vec2 => ({ x: Po.x + (s * u.x + t * v.x) * px, y: Po.y + (s * u.y + t * v.y) * px });
  const loc = [[-0.5, -0.5], [dims.W - 0.5, -0.5], [-0.5, dims.H - 0.5], [dims.W - 0.5, dims.H - 0.5]].map(([x, y]) => {
    const dx = x - Po.x, dy = y - Po.y; return { s: (dx * u.x + dy * u.y) / px, t: (dx * v.x + dy * v.y) / px };
  });
  const s0 = Math.floor(Math.min(...loc.map((q) => q.s)) / 10) * 10, s1 = Math.ceil(Math.max(...loc.map((q) => q.s)) / 10) * 10;
  const t0 = Math.floor(Math.min(...loc.map((q) => q.t)) / 10) * 10, t1 = Math.ceil(Math.max(...loc.map((q) => q.t)) / 10) * 10;
  const out = { minor: [] as Seg[], mid: [] as Seg[], major: [] as Seg[], axes: [] as Seg[] };
  const bucket = (m: number) => (m % 10 === 0 ? out.major : m % 5 === 0 ? out.mid : out.minor);
  for (let m = s0; m <= s1; m++) bucket(m).push({ a: at(m, t0), b: at(m, t1) });
  for (let m = t0; m <= t1; m++) bucket(m).push({ a: at(s0, m), b: at(s1, m) });
  out.axes.push({ a: at(s0, 0), b: at(s1, 0) }, { a: at(0, t0), b: at(0, t1) });
  return out;
}
