import type { Expr, NodeId, Value, ValueType, Unit } from './expr';
import { add, angleAt, angleBetween, dot, intersect, len, lineThrough, midpoint, mul, perpendicularThrough, project, signedDistance, sub, unit, type Line, type Vec2 } from './vec';

export class GraphError extends Error {
  constructor(message: string, readonly kind: 'cycle' | 'unknown-ref' | 'type', readonly node: NodeId) { super(message); }
}

/** Inputs of an expression, in field order, each with the value type it must have. */
function inputs(e: Expr): [NodeId, ValueType][] {
  switch (e.kind) {
    case 'landmark': return [];
    case 'midpoint': case 'line': case 'distance': return [[e.a, 'point'], [e.b, 'point']];
    case 'perpendicular': return [[e.through, 'point'], [e.line, 'line']];
    case 'intersection': case 'angleLines': return [[e.l1, 'line'], [e.l2, 'line']];
    case 'projection': return [[e.p, 'point'], [e.line, 'line']];
    case 'angle3': return [[e.a, 'point'], [e.vertex, 'point'], [e.b, 'point']];
    case 'signedDistance': return [[e.p, 'point'], [e.line, 'line'], [e.positiveAlong, 'line']];
    case 'difference': case 'ratio': return [[e.a, 'scalar'], [e.b, 'scalar']];
    case 'supplementSigned': return [[e.angle, 'scalar'], [e.signFrom, 'scalar']];
    case 'sum': return e.terms.map((t) => [t, 'scalar'] as [NodeId, ValueType]);
    case 'constant': return [];
    case 'alias': return [[e.of, 'scalar']];
    case 'parallelThrough': return [[e.through, 'point'], [e.line, 'line']];
    case 'offsetPoint': return [[e.p, 'point'], [e.along, 'line']];
    case 'withSign': return [[e.value, 'scalar'], [e.signFrom, 'scalar']];
    case 'xiPoint': return [[e.r1, 'point'], [e.r2, 'point'], [e.r3, 'point'], [e.r4, 'point'], [e.ref, 'line']];
  }
}
const outType = (e: Expr): ValueType =>
  e.kind === 'landmark' || e.kind === 'midpoint' || e.kind === 'intersection' || e.kind === 'projection'
    || e.kind === 'offsetPoint' || e.kind === 'xiPoint' ? 'point'
    : e.kind === 'line' || e.kind === 'perpendicular' || e.kind === 'parallelThrough' ? 'line' : 'scalar';

/** Unit of a scalar node, recursively through its first/only relevant input. */
function unitOf(nodes: Record<NodeId, Expr>, id: NodeId): Unit {
  const e = nodes[id];
  switch (e.kind) {
    case 'angle3': case 'angleLines': case 'supplementSigned': return 'deg';
    case 'distance': case 'signedDistance': return 'mm';
    case 'ratio': return e.percent ? '%' : '';
    case 'constant': return e.unit;
    case 'difference': return unitOf(nodes, e.a);
    case 'alias': return unitOf(nodes, e.of);
    case 'withSign': return unitOf(nodes, e.value);
    case 'sum': return unitOf(nodes, e.terms[0]);
    default: return '';
  }
}

export interface Compiled {
  order: NodeId[];
  evaluate(pos: Readonly<Record<string, Vec2 | undefined>>, mmPerPx: number): Record<NodeId, Value | null>;
  requiredLandmarks(id: NodeId): ReadonlySet<string>;
  typeOf(id: NodeId): ValueType;
}

export function compile(nodes: Record<NodeId, Expr>): Compiled {
  const order: NodeId[] = [], state = new Map<NodeId, 'visiting' | 'done'>(), req = new Map<NodeId, Set<string>>();
  const visit = (id: NodeId, from: NodeId) => {
    const e = nodes[id];
    if (!e) throw new GraphError(`“${from}” refers to unknown node “${id}”`, 'unknown-ref', from);
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') throw new GraphError(`Cycle through “${id}”`, 'cycle', id);
    state.set(id, 'visiting');
    const need = new Set<string>(e.kind === 'landmark' ? [e.id] : []);
    for (const [dep, want] of inputs(e)) {
      visit(dep, id);
      if (outType(nodes[dep]) !== want) throw new GraphError(`“${id}” needs a ${want} for “${dep}”, which is a ${outType(nodes[dep])}`, 'type', id);
      req.get(dep)!.forEach((l) => need.add(l));
    }
    if (e.kind === 'sum') {
      if (e.terms.length === 0) throw new GraphError(`“${id}” sums nothing`, 'type', id);
      const units = new Set(e.terms.map((t) => unitOf(nodes, t)));
      if (units.size > 1) throw new GraphError(`“${id}” adds different units`, 'type', id);
    }
    req.set(id, need); state.set(id, 'done'); order.push(id);
  };
  for (const id of Object.keys(nodes)) visit(id, id);

  const evaluate = (pos: Readonly<Record<string, Vec2 | undefined>>, mmPerPx: number) => {
    const out: Record<NodeId, Value | null> = {};
    const P = (id: NodeId): Vec2 | null => { const v = out[id]; return v && v.t === 'point' ? v.v : null; };
    const Ln = (id: NodeId): Line | null => { const v = out[id]; return v && v.t === 'line' ? v.v : null; };
    const S = (id: NodeId): { v: number; unit: Unit } | null => { const v = out[id]; return v && v.t === 'scalar' ? v : null; };
    const pt = (v: Vec2 | null): Value | null => (v ? { t: 'point', v } : null);
    const ln = (v: Line | null): Value | null => (v ? { t: 'line', v } : null);
    const sc = (v: number | null, unit: Unit): Value | null => (v === null || !Number.isFinite(v) ? null : { t: 'scalar', v, unit });
    for (const id of order) {
      const e = nodes[id];
      let r: Value | null = null;
      switch (e.kind) {
        case 'landmark': { const p = pos[e.id]; r = p ? pt(p) : null; break; }
        case 'midpoint': { const a = P(e.a), b = P(e.b); r = a && b ? pt(midpoint(a, b)) : null; break; }
        case 'line': { const a = P(e.a), b = P(e.b); r = a && b ? ln(lineThrough(a, b)) : null; break; }
        case 'perpendicular': { const p = P(e.through), l = Ln(e.line); r = p && l ? ln(perpendicularThrough(p, l)) : null; break; }
        case 'intersection': { const a = Ln(e.l1), b = Ln(e.l2); r = a && b ? pt(intersect(a, b)) : null; break; }
        case 'projection': { const p = P(e.p), l = Ln(e.line); r = p && l ? pt(project(p, l)) : null; break; }
        case 'angle3': { const a = P(e.a), v = P(e.vertex), b = P(e.b);
          r = a && v && b && len(sub(a, v)) > 1e-9 && len(sub(b, v)) > 1e-9 ? sc(angleAt(a, v, b), 'deg') : null; break; }
        case 'angleLines': { const a = Ln(e.l1), b = Ln(e.l2); r = a && b ? sc(angleBetween(a.d, b.d), 'deg') : null; break; }
        case 'distance': { const a = P(e.a), b = P(e.b); r = a && b ? sc(len(sub(a, b)) * mmPerPx, 'mm') : null; break; }
        case 'signedDistance': { const p = P(e.p), l = Ln(e.line), s = Ln(e.positiveAlong);
          r = p && l && s ? sc(signedDistance(p, l, s.d) * mmPerPx, 'mm') : null; break; }
        case 'difference': { const a = S(e.a), b = S(e.b); r = a && b ? sc(a.v - b.v, a.unit) : null; break; }
        case 'ratio': { const a = S(e.a), b = S(e.b);
          r = a && b && b.v !== 0 ? sc((a.v / b.v) * (e.percent ? 100 : 1), e.percent ? '%' : '') : null; break; }
        case 'supplementSigned': { const a = S(e.angle), s = S(e.signFrom);
          r = a && s ? sc((s.v < 0 ? -1 : 1) * (180 - a.v), 'deg') : null; break; }
        case 'sum': { const xs = e.terms.map(S); r = xs.every(Boolean) ? sc(xs.reduce((a, x) => a + x!.v, 0), xs[0]!.unit) : null; break; }
        case 'constant': r = sc(e.v, e.unit); break;
        case 'alias': { const a = S(e.of); r = a ? sc(a.v, a.unit) : null; break; }
        case 'parallelThrough': { const p = P(e.through), l = Ln(e.line); r = p && l ? ln({ p, d: l.d }) : null; break; }
        case 'offsetPoint': { const p = P(e.p), l = Ln(e.along);
          r = p && l && Number.isFinite(mmPerPx) && mmPerPx > 0 ? pt(add(p, mul(unit(l.d), e.mm / mmPerPx))) : null; break; }
        case 'withSign': { const a = S(e.value), s = S(e.signFrom); r = a && s ? sc((s.v < 0 ? -1 : 1) * Math.abs(a.v), a.unit) : null; break; }
        case 'xiPoint': { const q = [P(e.r1), P(e.r2), P(e.r3), P(e.r4)], l = Ln(e.ref);
          if (q.every(Boolean) && l) { const u = unit(l.d), w = { x: -u.y, y: u.x };
            const a = (dot(q[0]!, u) + dot(q[1]!, u)) / 2, b = (dot(q[2]!, w) + dot(q[3]!, w)) / 2;
            r = pt(add(mul(u, a), mul(w, b))); } else r = null; break; }
      }
      out[id] = r;
    }
    return out;
  };
  return { order, evaluate, requiredLandmarks: (id) => req.get(id) ?? new Set(), typeOf: (id) => outType(nodes[id]) };
}
