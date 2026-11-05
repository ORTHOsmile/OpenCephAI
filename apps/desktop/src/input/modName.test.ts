import { afterEach, describe, expect, it, vi } from 'vitest';
import { ALT, CMD, isMacLike } from './modName';

afterEach(() => { vi.unstubAllGlobals(); });

/** Preflight ruling, Task 8 (Windows-ready, master plan §13): shortcut hints name the modifier through one helper,
 *  not hard-coded ⌥/⌘, so a Windows build reads Alt/Ctrl instead. */
describe('modName (Windows-ready modifier names, preflight Task 8)', () => {
  it('names the Mac modifiers on a Mac-like platform', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(isMacLike()).toBe(true);
    expect(ALT()).toBe('⌥');
    expect(CMD()).toBe('⌘');
  });
  it('names the Windows modifiers elsewhere', () => {
    vi.stubGlobal('navigator', { platform: 'Win32' });
    expect(isMacLike()).toBe(false);
    expect(ALT()).toBe('Alt');
    expect(CMD()).toBe('Ctrl');
  });
});
