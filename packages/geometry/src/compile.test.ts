import { describe, it, expect } from 'vitest';
import { compile, GraphError } from './compile';
import type { Expr } from './expr';

const lm = (id: string): Expr => ({ kind: 'landmark', id });
// SYNTHETIC skull (image px, y down). Values chosen by hand; no patient data.
const P = { S: { x: 0, y: 0 }, N: { x: 700, y: -100 }, A: { x: 720, y: 300 }, B: { x: 690, y: 650 } };
const nodes: Record<string, Expr> = {
  S: lm('S'), N: lm('N'), A: lm('A'), B: lm('B'), Co: lm('Co'),
  SN: { kind: 'line', a: 'S', b: 'N' },
  SNA: { kind: 'angle3', a: 'S', vertex: 'N', b: 'A' },
  SNB: { kind: 'angle3', a: 'S', vertex: 'N', b: 'B' },
  ANB: { kind: 'difference', a: 'SNA', b: 'SNB' },
  CoA: { kind: 'distance', a: 'Co', b: 'A' },
  NA_mm: { kind: 'distance', a: 'N', b: 'A' },
};
// Independent reference: acos of the normalised dot product (the engine uses atan2).
const ref = (a: { x: number; y: number }, v: { x: number; y: number }, b: { x: number; y: number }) => {
  const u = { x: a.x - v.x, y: a.y - v.y }, w = { x: b.x - v.x, y: b.y - v.y };
  return Math.acos((u.x * w.x + u.y * w.y) / (Math.hypot(u.x, u.y) * Math.hypot(w.x, w.y))) * 180 / Math.PI;
};

describe('compile / evaluate', () => {
  const g = compile(nodes);
  const val = g.evaluate(P, 0.1);
  it('computes SNA, SNB and ANB like a hand calculation', () => {
    const sna = ref(P.S, P.N, P.A), snb = ref(P.S, P.N, P.B);
    expect(val.SNA).toEqual({ t: 'scalar', v: expect.closeTo(sna, 10), unit: 'deg' });
    expect(val.SNB).toEqual({ t: 'scalar', v: expect.closeTo(snb, 10), unit: 'deg' });
    expect(val.ANB).toEqual({ t: 'scalar', v: expect.closeTo(sna - snb, 10), unit: 'deg' });
  });
  it('converts distances with mm per px', () => {
    expect(val.NA_mm).toEqual({ t: 'scalar', v: expect.closeTo(Math.hypot(20, 400) * 0.1, 10), unit: 'mm' });
  });
  it('a missing landmark nulls everything downstream, never NaN', () => {
    expect(val.Co).toBeNull(); expect(val.CoA).toBeNull();
  });
  it('knows which landmarks a node needs', () => {
    expect([...g.requiredLandmarks('ANB')].sort()).toEqual(['A', 'B', 'N', 'S']);
    expect([...g.requiredLandmarks('CoA')].sort()).toEqual(['A', 'Co']);
  });
  it('orders every node after its inputs', () => {
    const at = (id: string) => g.order.indexOf(id);
    expect(at('SNA')).toBeGreaterThan(at('N')); expect(at('ANB')).toBeGreaterThan(at('SNB'));
  });
  it('two landmarks on top of each other give null angles, not a crash', () => {
    const v = compile({ ...nodes, SN_SNangle: { kind: 'angleLines', l1: 'SN', l2: 'SN' } })
      .evaluate({ ...P, N: { ...P.S } }, 0.1);
    expect(v.SN).toBeNull(); expect(v.SNA).toBeNull(); expect(v.SN_SNangle).toBeNull(); expect(v.ANB).toBeNull();
  });
  it('a cycle is a GraphError', () => {
    expect(() => compile({ a: { kind: 'line', a: 'b', b: 'c' }, b: { kind: 'intersection', l1: 'a', l2: 'a' }, c: lm('C') }))
      .toThrowError(expect.objectContaining({ kind: 'cycle' }));
  });
  it('an unknown reference is a GraphError', () => {
    expect(() => compile({ x: { kind: 'distance', a: 'nope', b: 'S' }, S: lm('S') }))
      .toThrowError(expect.objectContaining({ kind: 'unknown-ref', node: 'x' }));
  });
  it('a wrong input type is a GraphError', () => {
    expect(() => compile({ S: lm('S'), N: lm('N'), SN: { kind: 'line', a: 'S', b: 'N' }, bad: { kind: 'angle3', a: 'S', vertex: 'SN', b: 'N' } }))
      .toThrowError(GraphError);
  });
});
