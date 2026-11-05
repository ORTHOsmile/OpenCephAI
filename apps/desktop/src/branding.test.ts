import { describe, it, expect } from 'vitest';
import tauriConf from '../src-tauri/tauri.conf.json';
import indexHtml from '../index.html?raw';

// Rename (owner, 13 Oct 2026): the app's user-visible name is "OpenCephAI". The bundle identifier stays
// "app.cephtrace.desktop" — the clinician's installed library and models live under it, and changing it
// would empty their library — so these two must disagree, on purpose, forever.
describe('app branding (apps/desktop/src-tauri/tauri.conf.json)', () => {
  it('productName stays OpenCephAI (one app bundle, not a second beside it); the window title says 1.1 Beta (owner, 2 Nov 2026; beta.test.tsx)', () => {
    expect(tauriConf.productName).toBe('OpenCephAI');
    expect(tauriConf.app.windows[0].title).toBe('OpenCephAI 1.1 Beta');
  });
  it('the bundle identifier is unchanged, so the installed library is not orphaned', () => {
    expect(tauriConf.identifier).toBe('app.cephtrace.desktop');
  });
});

describe('apps/desktop/index.html', () => {
  it('<title> reads OpenCephAI 1.1 Beta', () => {
    expect(indexHtml).toMatch(/<title>OpenCephAI 1\.1 Beta<\/title>/);
  });
});

// Guard (owner, 13 Oct 2026): no user-visible string under apps/desktop/src should still say "CephTrace" —
// that was the renamed app's old name. A file listed here is a deliberate, judged exception, not an oversight.
const ALLOW_CEPHTRACE: ReadonlySet<string> = new Set<string>([
  './branding.test.ts', // this guard: the word appears only in prose/comments about the rename, never rendered
]);

const sourceFiles = import.meta.glob('./**/*.{ts,tsx}', { query: '?raw', import: 'default' });

describe('no stray "CephTrace" string remains under apps/desktop/src', () => {
  for (const [rel, loader] of Object.entries(sourceFiles)) {
    if (ALLOW_CEPHTRACE.has(rel)) continue;
    it(`${rel} does not mention CephTrace`, async () => {
      const text = (await loader()) as string;
      expect(text.includes('CephTrace')).toBe(false);
    });
  }
});
