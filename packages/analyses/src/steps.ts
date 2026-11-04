import type { AnalysisDef, Expr, NodeId } from '@ceph/geometry';
import { LINE_NAMES } from './lines';

export interface Step { kind: 'place' | 'draw' | 'calculate'; node: NodeId; label: string; landmarks: string[] }

export const exprRefs = (e: Expr): NodeId[] => {
  switch (e.kind) {
    case 'landmark': return [];
    case 'midpoint': case 'line': case 'distance': case 'difference': case 'ratio': return [e.a, e.b];
    case 'perpendicular': return [e.through, e.line];
    case 'intersection': case 'angleLines': return [e.l1, e.l2];
    case 'projection': return [e.p, e.line];
    case 'angle3': return [e.a, e.vertex, e.b];
    case 'signedDistance': return [e.p, e.line, e.positiveAlong];
    case 'supplementSigned': return [e.angle, e.signFrom];
    case 'sum': return e.terms;
    case 'constant': return [];
    case 'alias': return [e.of];
    case 'parallelThrough': return [e.through, e.line];
    case 'offsetPoint': return [e.p, e.along];
    case 'withSign': return [e.value, e.signFrom];
    case 'xiPoint': return [e.r1, e.r2, e.r3, e.r4, e.ref];
  }
};

/** "Place X / Draw line / Calculate M" in dependency (post-)order across the enabled analyses.
 *  Part D task 7: when `found` is given (the points an installed model places), every point it finds is walked
 *  first — it only needs checking, never a hand placement — so the guided steps never send the operator to place
 *  a point a model already found. A line is one step whichever way its two points are named (`a`, `b` sorted), and
 *  its label is the plain name from `LINE_NAMES` whenever that line has one — never an internal node id like
 *  `M6`/`MInc`, and never a raw `A–B` id pair when a name exists (fix round 1, ruling T7-2 Minor 1: two-landmark
 *  lines such as `U1ax` ("U1 long axis (apex to tip)") used to fall through to `U1A–U1T`). The `${a}–${b}` fallback
 *  only fires for a line with no `LINE_NAMES` entry at all (none exists in the real catalogue today — see
 *  steps.test.ts). */
export function guidedSteps(defs: AnalysisDef[], registry: Record<NodeId, Expr>, found?: ReadonlySet<string>): Step[] {
  const out: Step[] = [], seen = new Set<NodeId>(), labels = new Map<NodeId, string>(), drawn = new Set<string>();
  defs.forEach((d) => d.measurements.forEach((m) => labels.set(m.node, m.label)));
  const need = (id: NodeId): string[] => {
    const e = registry[id];
    return e.kind === 'landmark' ? [e.id] : [...new Set(exprRefs(e).flatMap(need))];
  };
  const lineLabel = (id: NodeId, a: NodeId, b: NodeId) => LINE_NAMES[id] ?? `${a}–${b}`;
  const walk = (id: NodeId) => {
    if (seen.has(id)) return; seen.add(id);
    const e = registry[id];
    exprRefs(e).forEach(walk);
    if (e.kind === 'landmark') out.push({ kind: 'place', node: id, label: `Place ${e.id}`, landmarks: [e.id] });
    else if (e.kind === 'line') {
      const key = [e.a, e.b].sort().join('|');           // both directions of a line are one step
      if (!drawn.has(key)) { drawn.add(key); out.push({ kind: 'draw', node: id, label: `Draw ${lineLabel(id, e.a, e.b)}`, landmarks: need(id) }); }
    } else if (labels.has(id)) out.push({ kind: 'calculate', node: id, label: `Calculate ${labels.get(id)}`, landmarks: need(id) });
  };
  // Points a model finds first (they arrive placed and only need checking), then the walk as before.
  if (found) defs.forEach((d) => d.measurements.forEach((m) => need(m.node).filter((l) => found.has(l)).forEach(walk)));
  defs.forEach((d) => d.measurements.forEach((m) => walk(m.node)));
  return out;
}
export const stepDone = (s: Step, verified: ReadonlySet<string>) => s.landmarks.every((l) => verified.has(l));
export const nextStep = (steps: Step[], verified: ReadonlySet<string>) => steps.find((s) => !stepDone(s, verified)) ?? null;
