import type { AnalysisDef, Expr, NodeId } from '@ceph/geometry';
import { LINES } from './lines';
import { catalogueNodes } from './catalogue';

/** LINES, plus the whole catalogue's nodes (merged once), plus every analysis's own nodes. The
 *  same id may appear twice only with an identical expression. */
export function buildRegistry(defs: AnalysisDef[]): Record<NodeId, Expr> {
  const out: Record<NodeId, Expr> = { ...LINES, ...catalogueNodes() };
  for (const d of defs) for (const [id, e] of Object.entries(d.nodes)) {
    if (out[id] && JSON.stringify(out[id]) !== JSON.stringify(e)) throw new Error(`Node “${id}” in ${d.name} conflicts with an existing definition`);
    out[id] = e;
  }
  return out;
}
