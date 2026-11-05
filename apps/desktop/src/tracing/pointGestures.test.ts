import { describe, it, expect } from 'vitest';
import { DOUBLE_MS, DOUBLE_PX, listClick, listDoubleClick, pressOnPoint } from './pointGestures';

const at = { x: 100, y: 100 };
describe('a press on a point on the film (spec 2026-10-19, V5, V6)', () => {
  it('⌘/Ctrl picks it and never starts a drag', () => { expect(pressOnPoint('S', at, 0, true, null)).toEqual({ act: 'pick', last: null }); });
  it('a first press drags, and is remembered', () => { expect(pressOnPoint('S', at, 1000, false, null)).toEqual({ act: 'drag', last: { id: 'S', at, t: 1000 } }); });
  it('a second press on the same point, soon after and close by, accepts it where it is: no drag', () => {
    const first = pressOnPoint('S', at, 1000, false, null);
    expect(pressOnPoint('S', { x: 100 + DOUBLE_PX, y: 100 }, 1000 + DOUBLE_MS, false, first.last)).toEqual({ act: 'accept', last: null });
  });
  it('too late, too far, or another point: a plain press (a drag)', () => {
    const last = { id: 'S', at, t: 1000 };
    expect(pressOnPoint('S', at, 1000 + DOUBLE_MS + 1, false, last).act).toBe('drag');
    expect(pressOnPoint('S', { x: 100 + DOUBLE_PX + 1, y: 100 }, 1100, false, last).act).toBe('drag');
    expect(pressOnPoint('N', at, 1100, false, last).act).toBe('drag');
  });
  it('a third quick press starts over (a drag), never a second accept', () => {
    const second = pressOnPoint('S', at, 1100, false, { id: 'S', at, t: 1000 });
    expect(pressOnPoint('S', at, 1200, false, second.last).act).toBe('drag');
  });
});
describe('the Landmarks list (V5, V6)', () => {
  it('a click selects; ⌘/Ctrl-click picks; on a read-only film it only selects', () => {
    expect([listClick('S', false, false), listClick('S', true, false), listClick('S', true, true)])
      .toEqual([{ type: 'select', id: 'S' }, { type: 'togglePick', id: 'S' }, { type: 'select', id: 'S' }]);
  });
  it('a double-click accepts the point where it is; nothing on a read-only film', () => {
    expect([listDoubleClick('S', false), listDoubleClick('S', true)]).toEqual([{ type: 'acceptMany', ids: ['S'], kind: 'double-click' }, null]);
  });
});
