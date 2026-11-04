import { describe, it, expect } from 'vitest';
import { buildRegistry, BUILT_INS } from '@ceph/analyses';
import { mmGrid, planeSegments, profilogramPaths, PLANES } from './overlayGeometry';

const reg = buildRegistry(BUILT_INS);
const pos = { S: { x: 0, y: 0 }, N: { x: 700, y: -100 }, A: { x: 720, y: 300 }, B: { x: 690, y: 650 }, Po: { x: -200, y: 100 }, Or: { x: 560, y: 80 },
  Go: { x: 150, y: 700 }, Me: { x: 640, y: 850 }, Pog: { x: 700, y: 760 }, ANS: { x: 740, y: 220 }, PNS: { x: 260, y: 240 } };
const all = Object.fromEntries(PLANES.map((p) => [p.key, true])) as Record<(typeof PLANES)[number]['key'], boolean>;

describe('plane segments', () => {
  it('draws each visible plane between its two defining landmarks', () => {
    const sn = planeSegments(reg, pos, all).find((s) => s.key === 'sn')!;
    expect(sn.a).toEqual(pos.S); expect(sn.b).toEqual(pos.N);
  });
  it('skips hidden planes', () => { expect(planeSegments(reg, pos, { ...all, sn: false }).some((s) => s.key === 'sn')).toBe(false); });
  it('Review Focus 1: skips a plane whose landmark is missing, without failing', () => {
    const { PNS: _p, ...noPNS } = pos;
    const keys = planeSegments(reg, noPNS, all).map((s) => s.key);
    expect(keys).not.toContain('pp'); expect(keys).toContain('sn');
  });
});
describe('profilogram paths', () => {
  it('follow the fixed order and leave out missing points', () => {
    const p = profilogramPaths(pos);
    expect(p.hard[0]).toEqual(pos.S); expect(p.hard[1]).toEqual(pos.N); expect(p.hard.length).toBe(8);   // S N ANS A B Pog Me Go
    expect(p.palatal).toEqual([pos.PNS, pos.ANS]);
    expect(p.soft).toEqual([]);
  });
});
describe('mm grid (decision 15c)', () => {
  const mm = 0.1, g = mmGrid(pos.Po, pos.Or, mm, { W: 2000, H: 2000 })!;
  it('the 1 cm pitch equals 10 / mmPerPx image px', () => {
    expect(g.major.length).toBeGreaterThan(4);
    const u = { x: (pos.Or.x - pos.Po.x), y: (pos.Or.y - pos.Po.y) }, L = Math.hypot(u.x, u.y);
    const ticks = g.major.map((s) => ((s.a.x - pos.Po.x) * u.x + (s.a.y - pos.Po.y) * u.y) / L)
      .map((t) => Math.round(t * 1e6) / 1e6).filter((t, i, arr) => arr.indexOf(t) === i).sort((a, b) => a - b);
    const steps = ticks.slice(1).map((t, i) => t - ticks[i]).filter((d) => d > 1e-6);
    for (const d of steps) expect(d % (10 / mm)).toBeCloseTo(0, 6);
    expect(Math.min(...steps)).toBeCloseTo(10 / mm, 9);
  });
  it('Or lies on the grid x-axis', () => {
    const ax = g.axes[0], d = { x: ax.b.x - ax.a.x, y: ax.b.y - ax.a.y };
    const cross = (pos.Or.x - ax.a.x) * d.y - (pos.Or.y - ax.a.y) * d.x;
    expect(cross / Math.hypot(d.x, d.y)).toBeCloseTo(0, 9);
  });
  it('mmGrid is null, not NaN, when Po and Or coincide (Week 2 carry-over)', () => {
    expect(mmGrid({ x: 5, y: 5 }, { x: 5, y: 5 }, 0.1, { W: 100, H: 100 })).toBeNull();
  });
});
