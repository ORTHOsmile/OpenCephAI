// Owner, 6 Nov 2026 (item 2): the installer window (the .dmg) shows a backup warning. This test ties the picture to the Tauri config and to the
// script that makes it (scripts/make-dmg-background.py), and to the words. Node's fs is read with a type-erased dynamic import (no @types/node).
import { describe, it, expect } from 'vitest';
import conf from '../src-tauri/tauri.conf.json';
import script from '../../../scripts/make-dmg-background.py?raw';

const FS = 'node:fs', PATHMOD = 'node:path', URLMOD = 'node:url';
const { readFileSync, existsSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (p: string) => Uint8Array; existsSync: (p: string) => boolean };
const { resolve, dirname } = (await import(/* @vite-ignore */ PATHMOD)) as { resolve: (...p: string[]) => string; dirname: (p: string) => string };
const { fileURLToPath } = (await import(/* @vite-ignore */ URLMOD)) as { fileURLToPath: (u: URL) => string };
const tauriDir = resolve(dirname(fileURLToPath(new URL(import.meta.url))), '..', 'src-tauri');
const dmg = (conf as unknown as { bundle: { targets: string[]; macOS: { dmg: { background: string; windowSize: { width: number; height: number }; appPosition: { x: number; y: number }; applicationFolderPosition: { x: number; y: number } } } } }).bundle;
const size = (path: string): [number, number] => {
  const b = readFileSync(path), v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  expect(Array.from(b.slice(1, 4))).toEqual([0x50, 0x4e, 0x47]);                  // a PNG
  return [v.getUint32(16), v.getUint32(20)];                                        // IHDR width, height
};

describe('the installer window\'s background (bundle.macOS.dmg)', () => {
  /** Fails if the dmg target is dropped, or any of the four keys is missing or moves off the picture. */
  it('the config names the picture, the window size and the two icon positions the picture is drawn for', () => {
    expect(dmg.targets).toContain('dmg');
    expect(dmg.macOS.dmg.background).toBe('icons/dmg/background.png');
    expect(dmg.macOS.dmg.windowSize).toEqual({ width: 660, height: 400 });
    expect(dmg.macOS.dmg.appPosition).toEqual({ x: 180, y: 170 });
    expect(dmg.macOS.dmg.applicationFolderPosition).toEqual({ x: 480, y: 170 });
  });
  /** Fails if the picture is missing or is not 660x400. Tauri's dmg config takes ONE background file (bundle_dmg.sh copies only that file), so there is no @2x twin. */
  it('the one picture exists at the window\'s size (660x400), and there is no unused @2x twin', () => {
    expect(existsSync(resolve(tauriDir, dmg.macOS.dmg.background))).toBe(true);
    expect(size(resolve(tauriDir, 'icons/dmg/background.png'))).toEqual([660, 400]);
    expect(existsSync(resolve(tauriDir, 'icons/dmg/background@2x.png'))).toBe(false);
  });
  /** Fails if the script and the config disagree about the window or the icon positions (the arrow would not sit between the icons). */
  it('the script that makes the picture is drawn for the same window and positions', () => {
    expect(script).toMatch(/W, H = 660, 400/);
    expect(script).toMatch(/APP_X, FOLDER_X, ICON_Y = 180, 480, 170/);
  });
  /** Fails if the words drift from the owner's, or the second line stops being true: the app has a Library "Back up…" button, and the library lives in
   *  ~/Library/Application Support/app.cephtrace.desktop (the app's identifier, tauri.conf.json). */
  it('the words are the owner\'s headline and a true second line', () => {
    expect(script).toContain('HEADLINE = "Back up your OpenCephAI library before installing a new version."');
    expect(script).toContain(`In Finder: Go › Go to Folder… (⇧⌘G), then ~/Library/Application Support/${conf.identifier}`);
    expect(script).toContain("In OpenCephAI, the Library screen's Back up… button makes a copy.");   // the Library screen's own button, not a menu path
    expect(script).not.toMatch(/Library ›/);
    expect(script).not.toMatch(/Settings/);                                          // Settings does not show where the library is
  });
});
