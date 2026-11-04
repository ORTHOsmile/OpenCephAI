import { describe, it, expect } from 'vitest';
import { applies, commandFor, type KeyLike } from './keymap';

const k = (key: string, mods: Partial<KeyLike> = {}): KeyLike => ({ key, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods });
describe('keymap (§2 controls table, decision 18)', () => {
  it.each([
    [k('o', { metaKey: true }), { t: 'import' }], [k('z', { metaKey: true }), { t: 'undo' }], [k('z', { metaKey: true, shiftKey: true }), { t: 'redo' }],
    [k('=', { metaKey: true }), { t: 'zoom', factor: 1.25 }], [k('-', { metaKey: true }), { t: 'zoom', factor: 0.8 }], [k('0', { metaKey: true }), { t: 'fit' }],
    [k('l', { metaKey: true }), { t: 'level' }], [k('m', { metaKey: true, shiftKey: true }), { t: 'flip' }], [k('0', { metaKey: true, shiftKey: true }), { t: 'restore' }],
    [k('['), { t: 'rotate', deg: -0.5 }], [k(']'), { t: 'rotate', deg: 0.5 }], [k('{', { shiftKey: true }), { t: 'rotate', deg: -5 }], [k('}', { shiftKey: true }), { t: 'rotate', deg: 5 }],
    [k('ArrowLeft'), { t: 'nudge', dx: -1, dy: 0 }], [k('ArrowDown', { shiftKey: true }), { t: 'nudge', dx: 0, dy: 10 }],
    [k('p'), { t: 'togglePlanes' }], [k('g'), { t: 'toggleProfilogram' }],
  ])('%j → %j', (e, want) => { expect(commandFor(e)).toEqual(want); });
  it('Ctrl works like ⌘ (non-Mac keyboards)', () => { expect(commandFor(k('z', { ctrlKey: true }))).toEqual({ t: 'undo' }); });
  it('Review Focus 5: nothing fires while typing in a field', () => {
    for (const key of ['p', 'g', '[', 'ArrowLeft']) {
      expect(commandFor(k(key, { targetTag: 'INPUT' }))).toBeNull();
      expect(commandFor(k(key, { targetEditable: true }))).toBeNull();
    }
    expect(commandFor(k('z', { metaKey: true, targetTag: 'TEXTAREA' }))).toBeNull();
  });
  it('unmapped keys give null', () => { expect(commandFor(k('q'))).toBeNull(); });
  it.each([[k('Escape'), { t: 'cancel' }], [k('Backspace'), { t: 'remove' }], [k('Delete'), { t: 'remove' }]])('%j → %j', (e, want) => {
    expect(commandFor(e)).toEqual(want);
  });
  it('a focused checkbox or button does not swallow P, G or the arrows (Week 2 carry-over)', () => {
    expect(commandFor(k('p', { targetTag: 'INPUT', targetType: 'checkbox' }))).toEqual({ t: 'togglePlanes' });
    expect(commandFor(k('ArrowLeft', { targetTag: 'BUTTON' }))).toEqual({ t: 'nudge', dx: -1, dy: 0 });
    expect(commandFor(k('ArrowLeft', { targetTag: 'INPUT', targetType: 'range' }))).toBeNull();
    expect(commandFor(k('Backspace', { targetTag: 'INPUT', targetType: 'text' }))).toBeNull();
    expect(commandFor(k('Backspace', { targetTag: 'INPUT', targetType: 'date' }))).toBeNull();
  });
  it('keys that would do nothing are left to the browser (Week 2 carry-over)', () => {
    const none = { hasCase: false, hasActivePoint: false, calibrating: false };
    expect(applies({ t: 'nudge', dx: 1, dy: 0 }, { ...none, hasCase: true })).toBe(false);
    expect(applies({ t: 'nudge', dx: 1, dy: 0 }, { ...none, hasCase: true, hasActivePoint: true })).toBe(true);
    expect(applies({ t: 'remove' }, { ...none, hasCase: true })).toBe(false);
    expect(applies({ t: 'togglePlanes' }, none)).toBe(false);                   // the Library page
    expect(applies({ t: 'import' }, none)).toBe(true);
    expect(applies({ t: 'cancel' }, { ...none, calibrating: true })).toBe(true);
    expect(applies({ t: 'undo' }, { ...none, hasCase: true, calibrating: true })).toBe(false);
  });
  it('K calibrates, and K or Esc still work while calibrating', () => {
    expect(commandFor(k('k'))).toEqual({ t: 'calibrate' });
    expect(applies({ t: 'calibrate' }, { hasCase: true, hasActivePoint: false, calibrating: true })).toBe(true);
    expect(applies({ t: 'calibrate' }, { hasCase: false, hasActivePoint: false, calibrating: false })).toBe(false);
  });
});
