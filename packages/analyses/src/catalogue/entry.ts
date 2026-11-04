import type { Expr, NodeId, Unit } from '@ceph/geometry';
import type { CatalogueEntry } from './types';

/** Builds one CatalogueEntry. `extra` may carry `sign`, `bands`, `source.where`, and/or extra helper
 *  `nodes` (merged under the entry's own `[id]: expr`).
 *
 *  Corrected from the version quoted in catalogue-pattern.md: there, `{ nodes: {...}, ...extra }`
 *  puts `...extra` LAST, so an `extra.nodes` (used by every multi-helper entry: #5, #6, #13, #15, #29,
 *  #43, #44) silently REPLACES the merged node map — discarding the entry's own `[id]: expr` — instead
 *  of adding to it. Caught in Task 4 before it shipped a single working helper node per entry; `nodes`
 *  is written last below so the merge actually survives the spread. Moved here from `skeletal-ap.ts`
 *  per the ruling after Task 4, so Tasks 5-7 share one helper instead of four copies. */
export const E = (
  id: NodeId, no: string, label: string, unit: Unit, expr: Expr, source: CatalogueEntry['source'],
  extra: Partial<Omit<CatalogueEntry, 'id' | 'no' | 'label' | 'unit' | 'source' | 'nodes'>> & { nodes?: Record<NodeId, Expr> } = {},
): CatalogueEntry => {
  const { nodes: extraNodes, ...rest } = extra;
  return { id, no, label, unit, source, ...rest, nodes: { [id]: expr, ...(extraNodes ?? {}) } };
};
