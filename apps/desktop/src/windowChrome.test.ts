import { describe, it, expect } from 'vitest';
import tauriConf from '../src-tauri/tauri.conf.json';
import tokensCss from './styles/tokens.css?raw';
import windowChromeRs from '../src-tauri/src/window_chrome.rs?raw';

// The macOS close / minimise / zoom buttons are drawn by the system over our own toolbar ("Overlay" title bar). Their
// centre lands at y + h/2 − b from the window top (h = button height, b = AppKit's gap below it), and h and b differ
// between macOS versions, so no fixed y centres them everywhere (owner, 19 Oct 2026: centred on 26.1, low on 15).
// The app now reads h and b on the Mac it runs on and asks for y = toolbar/2 + b − h/2 (window_chrome.rs).
// These tests pin only the wiring and the arithmetic. Only `cephtrace-desktop --check-window-chrome`, run on a given Mac,
// proves the buttons are centred there.
const cssToolbar = () => Number(/--layout-toolbar:\s*(\d+(?:\.\d+)?)px/.exec(tokensCss)?.[1]);
const rustToolbar = () => Number(/pub const TOOLBAR_PT: f64 = (\d+(?:\.\d+)?);/.exec(windowChromeRs)?.[1]);
const centringY = (toolbar: number, h: number, b: number) => toolbar / 2 + b - h / 2;

describe('window buttons sit on the toolbar centre line (macOS)', () => {
  it('tauri.conf.json hard-codes no button position; the main window is made at startup instead', () => {
    const main = tauriConf.app.windows[0] as Record<string, unknown>;
    expect(main).not.toHaveProperty('trafficLightPosition');
    expect(main.create).toBe(false);
  });

  it('the Rust toolbar height is the CSS --layout-toolbar', () => {
    expect(cssToolbar()).toBeGreaterThan(0);
    expect(rustToolbar()).toBe(cssToolbar());
  });

  it('measured on macOS 26.1 (h 14, b 9): y is the 28 the owner approved there', () => {
    expect(centringY(cssToolbar(), 14, 9)).toBe(28);
  });

  it('inferred, pre-Tahoe (h 16, b 6; not measured): y is 24, 4 points higher than the old fixed 28', () => {
    expect(centringY(cssToolbar(), 16, 6)).toBe(24);
  });
});
