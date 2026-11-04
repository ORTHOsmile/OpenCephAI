import { describe, it, expect } from 'vitest';
import { compile, GraphError } from './compile';
import type { Expr } from './expr';
const lm = (id: string): Expr => ({ kind: 'landmark', id });
// SYNTHETIC points (px, y down). Hand values; no patient data.
const P = { A: { x: 0, y: 0 }, B: { x: 10, y: 0 }, C: { x: 0, y: 10 }, D: { x: 4, y: 3 },
  R1: { x: 30, y: 50 }, R2: { x: 10, y: 40 }, R3: { x: 22, y: 20 }, R4: { x: 18, y: 80 } };
const nodes: Record<string, Expr> = {
  A: lm('A'), B: lm('B'), C: lm('C'), D: lm('D'), R1: lm('R1'), R2: lm('R2'), R3: lm('R3'), R4: lm('R4'),
  AB: { kind: 'line', a: 'A', b: 'B' }, AC: { kind: 'line', a: 'A', b: 'C' },
  angBAC: { kind: 'angle3', a: 'B', vertex: 'A', b: 'C' },              // 90
  angDAB: { kind: 'angle3', a: 'D', vertex: 'A', b: 'B' },              // atan(3/4) = 36.8699
  s: { kind: 'sum', terms: ['angBAC', 'angDAB'] },
  k: { kind: 'constant', v: 90, unit: 'deg' },
  dev: { kind: 'difference', a: 'angBAC', b: 'k' },
  al: { kind: 'alias', of: 'angDAB' },
  parD: { kind: 'parallelThrough', through: 'D', line: 'AB' },
  hitD: { kind: 'intersection', l1: 'parD', l2: 'AC' },                 // (0,3)
  off: { kind: 'offsetPoint', p: 'A', along: 'AC', mm: 2 },             // 2 mm down at 0.5 mm/px = 4 px → (0,4)
  sdDneg: { kind: 'distance', a: 'A', b: 'D' },                         // 5 mm at 1 mm/px
  sgnPos: { kind: 'withSign', value: 'angDAB', signFrom: 'k' },
  negK: { kind: 'constant', v: -1, unit: '' },
  sgnNeg: { kind: 'withSign', value: 'angDAB', signFrom: 'negK' },
  zero: { kind: 'constant', v: 0, unit: '' },
  sgnZero: { kind: 'withSign', value: 'angDAB', signFrom: 'zero' },
  xi: { kind: 'xiPoint', r1: 'R1', r2: 'R2', r3: 'R3', r4: 'R4', ref: 'AB' },  // u=(1,0), w=(0,1): x=(30+10)/2=20, y=(20+80)/2=50
};
describe('new expression kinds', () => {
  const g = compile(nodes);
  const v = g.evaluate(P, 0.5);
  const num = (id: string) => (v[id] as { v: number }).v;
  it('sum adds and keeps the unit', () => { expect(v.s).toEqual({ t: 'scalar', v: expect.closeTo(90 + Math.atan2(3, 4) * 180 / Math.PI, 10), unit: 'deg' }); });
  it('constant and difference give degrees from 90', () => { expect(num('dev')).toBeCloseTo(0, 12); });
  it('alias copies a scalar', () => { expect(num('al')).toBeCloseTo(num('angDAB'), 12); });
  it('parallelThrough keeps direction and passes through the point', () => {
    expect(v.hitD).toEqual({ t: 'point', v: { x: expect.closeTo(0, 12), y: expect.closeTo(3, 12) } });
    expect((v.parD as { v: { d: { x: number; y: number } } }).v.d).toEqual({ x: 10, y: 0 });
  });
  it('offsetPoint moves mm along a line using mm per px', () => {
    expect(v.off).toEqual({ t: 'point', v: { x: expect.closeTo(0, 12), y: expect.closeTo(4, 12) } });
  });
  it('offsetPoint gives null, never NaN, when mm per px is 0 or not finite', () => {
    expect(g.evaluate(P, 0).off).toBeNull(); expect(g.evaluate(P, Number.NaN).off).toBeNull();
  });
  it('withSign takes the sign of signFrom, + when signFrom is exactly 0', () => {
    expect(num('sgnPos')).toBeGreaterThan(0); expect(num('sgnNeg')).toBeCloseTo(-num('angDAB'), 12);
    expect(num('sgnZero')).toBeCloseTo(num('angDAB'), 12);
  });
  it('xiPoint is the centre of the R1–R4 rectangle in the ref frame (Ricketts 1981 p.131)', () => {
    expect(v.xi).toEqual({ t: 'point', v: { x: expect.closeTo(20, 12), y: expect.closeTo(50, 12) } });
  });
  it('xiPoint follows a rotated reference line', () => {
    const rot = (p: { x: number; y: number }) => ({ x: -p.y, y: p.x });   // rotate everything +90°
    const RP = Object.fromEntries(Object.entries(P).map(([k, p]) => [k, rot(p)]));
    expect(g.evaluate(RP, 0.5).xi).toEqual({ t: 'point', v: { x: expect.closeTo(-50, 12), y: expect.closeTo(20, 12) } });
  });
  it('a missing input nulls sum, withSign and xiPoint', () => {
    const { R4: _r, ...noR4 } = P; const w = g.evaluate(noR4, 0.5);
    expect(w.xi).toBeNull();
    const { D: _d, ...noD } = P; const x = g.evaluate(noD, 0.5);
    expect(x.s).toBeNull(); expect(x.sgnPos).toBeNull(); expect(x.al).toBeNull();
  });
  it('sum rejects mixed units and an empty list at compile', () => {
    expect(() => compile({ ...nodes, bad: { kind: 'sum', terms: ['angBAC', 'sdDneg'] } })).toThrow(GraphError);
    expect(() => compile({ ...nodes, bad: { kind: 'sum', terms: [] } })).toThrow(GraphError);
  });
});
