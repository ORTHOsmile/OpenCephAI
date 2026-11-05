import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import tauriConf from '../src-tauri/tauri.conf.json';
import indexHtml from '../index.html?raw';
import { BETA_NAME, BETA_NOTICE, BETA_NOTICE_KEY, parseBetaSeen } from './beta';
import { BetaNotice } from './layout/BetaNotice';

// Owner, 2 Nov 2026: the whole program is labelled Beta. The identifier must NOT change (the installed library lives under it).
describe('Beta label (owner, 2 Nov 2026)', () => {
  it('the name is exactly "OpenCephAI 1.1 Beta"', () => {
    expect(BETA_NAME).toBe('OpenCephAI 1.1 Beta');
  });
  it('the window title carries it; productName stays OpenCephAI so no second .app is built', () => {
    expect(tauriConf.productName).toBe('OpenCephAI');
    expect(tauriConf.app.windows[0].title).toBe(BETA_NAME);
  });
  it('index.html <title> carries it', () => {
    expect(indexHtml).toContain(`<title>${BETA_NAME}</title>`);
  });
  it('the bundle identifier is unchanged', () => {
    expect(tauriConf.identifier).toBe('app.cephtrace.desktop');
  });
  it('the Beta label does not touch the version number (1.1.0 since 2 Nov 2026; one number in three files)', () => {
    expect(tauriConf.version).toMatch(/^1\.1\.0$/);
  });
});

describe('the one-time Beta notice', () => {
  it('says exactly the owner’s words', () => {
    expect(BETA_NOTICE).toBe('OpenCephAI is beta research software, not a diagnostic device. Every point must be checked by a clinician. Please report any problem.');
  });
  it('is remembered once dismissed: only the stored "1" counts as seen; empty, missing or anything else shows it again', () => {
    expect(BETA_NOTICE_KEY).toBe('betaNoticeSeen');
    expect(parseBetaSeen('1')).toBe(true);
    for (const v of [null, undefined, '', '0', 'true', 'yes']) expect(parseBetaSeen(v)).toBe(false);
  });
  it('renders as a dialog with those words and a button that dismisses it', () => {
    const html = renderToStaticMarkup(<BetaNotice onDismiss={() => {}} />);
    expect(html).toContain(BETA_NOTICE);
    expect(html).toContain('role="dialog"');
    expect(html).toContain('>OK</button>');
    expect(html).toContain(BETA_NAME);
  });
});
