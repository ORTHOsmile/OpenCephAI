import type { Expr, NodeId } from '@ceph/geometry';
import type { CatalogueEntry } from './types';
import { SKELETAL_AP } from './skeletal-ap';
import { VERTICAL } from './vertical';
import { DENTAL } from './dental';
import { SOFT } from './soft';

/** The whole analyses catalogue (appendix §4), #1-92: skeletal front-to-back, vertical and jaw
 *  shape, dental, soft tissue and airway (Tasks 4-7 of Part A). Part A task 8. */
export const CATALOGUE: CatalogueEntry[] = [...SKELETAL_AP, ...VERTICAL, ...DENTAL, ...SOFT];

/** Every catalogue entry's own node plus its private helper nodes, merged. Throws on a duplicate
 *  id (two entries must never define the same node id — each catalogue id is its own node). */
export function catalogueNodes(): Record<NodeId, Expr> {
  const out: Record<NodeId, Expr> = {};
  for (const entry of CATALOGUE) {
    for (const [id, expr] of Object.entries(entry.nodes)) {
      if (id in out) throw new Error(`Duplicate catalogue node id "${id}"`);
      out[id] = expr;
    }
  }
  return out;
}

/** Looks up a catalogue entry by its full node id (e.g. 'm01_SNA'). Throws if unknown. */
export function byId(id: NodeId): CatalogueEntry {
  const e = CATALOGUE.find((c) => c.id === id);
  if (!e) throw new Error(`Unknown catalogue id "${id}"`);
  return e;
}

/** Looks up a catalogue entry by its appendix number (e.g. '1', '70a'). Throws if unknown. Derives
 *  the number from each entry's id ('m01_SNA' -> '1', 'm70a_U6NA' -> '70a') rather than from `no`,
 *  because #70's two entries share one appendix number ('70') and are told apart only by id suffix. */
export function byNo(no: string): CatalogueEntry {
  const e = CATALOGUE.find((c) => {
    const m = c.id.match(/^m0*(\d+)([a-z])?_/);
    if (!m) throw new Error(`Bad catalogue id "${c.id}"`);
    return m[1] + (m[2] ?? '') === no;
  });
  if (!e) throw new Error(`Unknown catalogue number "${no}"`);
  return e;
}

export type { CatalogueEntry } from './types';
export { SKELETAL_AP, VERTICAL, DENTAL, SOFT };
