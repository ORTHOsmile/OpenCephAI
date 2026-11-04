import type { Line, Vec2 } from './vec';

export type NodeId = string;
export type Expr =
  | { kind: 'landmark'; id: string }
  | { kind: 'midpoint'; a: NodeId; b: NodeId }
  | { kind: 'line'; a: NodeId; b: NodeId }                            // directed a→b
  | { kind: 'perpendicular'; through: NodeId; line: NodeId }
  | { kind: 'intersection'; l1: NodeId; l2: NodeId }
  | { kind: 'projection'; p: NodeId; line: NodeId }
  | { kind: 'angle3'; a: NodeId; vertex: NodeId; b: NodeId }          // deg [0,180]
  | { kind: 'angleLines'; l1: NodeId; l2: NodeId }                    // deg between directed lines [0,180]
  | { kind: 'distance'; a: NodeId; b: NodeId }                        // mm
  | { kind: 'signedDistance'; p: NodeId; line: NodeId; positiveAlong: NodeId } // mm
  | { kind: 'difference'; a: NodeId; b: NodeId }                      // a − b, unit of a
  | { kind: 'ratio'; a: NodeId; b: NodeId; percent: boolean }
  | { kind: 'supplementSigned'; angle: NodeId; signFrom: NodeId }     // sign(signFrom)·(180 − angle)
  | { kind: 'sum'; terms: NodeId[] }                                   // scalar, unit of terms[0]; all terms same unit
  | { kind: 'constant'; v: number; unit: Unit }                        // scalar
  | { kind: 'alias'; of: NodeId }                                      // scalar copy of `of`
  | { kind: 'parallelThrough'; through: NodeId; line: NodeId }         // line, same direction as `line`
  | { kind: 'offsetPoint'; p: NodeId; along: NodeId; mm: number }      // point p + unit(along.d)·mm/mmPerPx
  | { kind: 'withSign'; value: NodeId; signFrom: NodeId }              // scalar: (signFrom < 0 ? −1 : +1)·|value|, unit of value
  | { kind: 'xiPoint'; r1: NodeId; r2: NodeId; r3: NodeId; r4: NodeId; ref: NodeId }; // point

export type ValueType = 'point' | 'line' | 'scalar';
export type Unit = 'deg' | 'mm' | '%' | '';
export type Value = { t: 'point'; v: Vec2 } | { t: 'line'; v: Line } | { t: 'scalar'; v: number; unit: Unit };

/** Norms are deliberately absent: they come only from the verified §9 database (decision 7). */
export interface MeasurementDef { node: NodeId; label: string }
export interface AnalysisDef { id: string; name: string; nodes: Record<NodeId, Expr>; measurements: MeasurementDef[] }
