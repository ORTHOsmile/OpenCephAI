import { describe, it, expect } from 'vitest';
import { applies, commandFor, isMod, isSpacePan, modLabel, shortcut, type KeyLike } from './keymap';

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
    const none = { hasCase: false, hasActivePoint: false, calibrating: false, rulerPending: false };
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
    expect(applies({ t: 'calibrate' }, { hasCase: true, hasActivePoint: false, calibrating: true, rulerPending: false })).toBe(true);
    expect(applies({ t: 'calibrate' }, { hasCase: false, hasActivePoint: false, calibrating: false, rulerPending: false })).toBe(false);
  });
  // Final review m-1: ⌘Z / ⌘⇧Z while a ruler store is still being saved can leave the marks on screen different
  // from the library (a store queued behind it can land last and overwrite the drop the clinician just saw land).
  // `applies` is the one gate every keyboard command passes through (App.tsx), so this is where it is proven.
  it('m-1: undo and redo are inert while a ruler store is still pending, even with a case open and not calibrating', () => {
    const open = { hasCase: true, hasActivePoint: false, calibrating: false, rulerPending: false };
    expect(applies({ t: 'undo' }, open)).toBe(true);
    expect(applies({ t: 'redo' }, open)).toBe(true);
    expect(applies({ t: 'undo' }, { ...open, rulerPending: true })).toBe(false);
    expect(applies({ t: 'redo' }, { ...open, rulerPending: true })).toBe(false);
    expect(applies({ t: 'calibrate' }, { ...open, rulerPending: true })).toBe(true);   // only undo/redo are held back
  });
});

describe('the one ⌘/Ctrl helper (Windows-ready rule, master plan §13)', () => {
  it('names ⌘ on a Mac and Ctrl elsewhere', () => {
    expect([modLabel('MacIntel'), modLabel('Win32'), modLabel('Linux x86_64')]).toEqual(['⌘', 'Ctrl', 'Ctrl']);
  });
  it('writes a shortcut the platform way', () => { expect([shortcut('⌘', 'Z'), shortcut('Ctrl', 'Z')]).toEqual(['⌘Z', 'Ctrl+Z']); });
  it('takes ⌘ or Ctrl as the modifier, as the key commands always have', () => {
    expect([isMod({ metaKey: true, ctrlKey: false }), isMod({ metaKey: false, ctrlKey: true }), isMod({ metaKey: false, ctrlKey: false })]).toEqual([true, true, false]);
  });
});

describe('Space-drag pans the film (spec 2026-10-19 addendum, G)', () => {
  it('only Space, only with the pointer over the film, never while typing', () => {
    expect(isSpacePan(k(' '), true)).toBe(true);
    expect(isSpacePan(k(' '), false)).toBe(false);
    expect(isSpacePan(k(' ', { targetTag: 'INPUT', targetType: 'text' }), true)).toBe(false);
    expect(isSpacePan(k(' ', { targetTag: 'TEXTAREA' }), true)).toBe(false);
    expect(isSpacePan(k('a'), true)).toBe(false);
  });
});
