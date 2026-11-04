import type { Expr, NodeId, Unit } from '@ceph/geometry';

export type SourceMark = 'P' | 'T' | 'S' | 'W';

/** One row of the analyses catalogue (appendix §4). No norms here (decision 7: norms only from §9). */
export interface CatalogueEntry {
  id: NodeId;                       // 'm01_SNA'
  no: string;                       // '1', '70a'
  label: string;                    // owner-facing name, as in the appendix
  unit: Unit;
  sign?: string;                    // plain-words sign rule, e.g. '+ when A is ahead of B'
  source: { mark: SourceMark; cite: string; where?: string };  // cite 'Steiner 1953', where 'chart p.741'
  nodes: Record<NodeId, Expr>;      // its own node (id) plus any private helper nodes; ids must be unique in the catalogue
  retired?: true;                   // #45, #48, #65: nodes = {}
  bands?: { max: number; label: string }[];   // #17 extraction index categories (onfile)
}
