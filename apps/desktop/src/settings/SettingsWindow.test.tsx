import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSets, toAnalysisDef } from '@ceph/analyses';
import { SettingsWindow } from './SettingsWindow';
import { APP_VERSION, BUILD_DATE, versionLine } from '../version';
import pkg from '../../package.json';

// Final review M-5: Settings ▸ Norms showed `loadError ?? settingsError` — the settings error vanished when both were
// set, and the load error lost its "Norms couldn't be loaded:" prefix. It now uses the Inspector's normsErrorMessage.
const norms = (loadError: string | null, settingsError: string | null) => ({ sets: loadSets(), loadError, settingsError, userNorms: [], userNormsFailed: false,
  clinicDefault: null, refresh: () => {}, setClinicDefault: async () => {} });
const html = (n: ReturnType<typeof norms>) => renderToStaticMarkup(<SettingsWindow tab="norms" found={null} norms={n} decimals={1} onDecimals={() => {}} onClose={() => {}} meanings={{ clinician: '', overrides: {}, refresh: () => {} }} filmDetails={{ off: new Set(), toggle: async () => {} }}
  mine={{ clinician: '', list: [], defs: [], error: null, refresh: () => {} }} onMineSaved={() => {}} onMineDeleted={() => {}} dateFormat="AU" />);
describe('SettingsWindow: the version line at its foot (owner, 19 Oct)', () => {
  it('names the app, its version and the build day, on every tab', () => {
    for (const tab of ['analyses', 'norms', 'meanings', 'filmText'] as const) {
      const out = renderToStaticMarkup(<SettingsWindow tab={tab} found={null} norms={norms(null, null)} decimals={1} onDecimals={() => {}} onClose={() => {}} meanings={{ clinician: '', overrides: {}, refresh: () => {} }} filmDetails={{ off: new Set(), toggle: async () => {} }}
        mine={{ clinician: '', list: [], defs: [], error: null, refresh: () => {} }} onMineSaved={() => {}} onMineDeleted={() => {}} dateFormat="US" />);
      expect(out).toContain(`<p class="settings-version">${versionLine(APP_VERSION, BUILD_DATE, 'US')}</p>`);
      expect(out).toContain(`OpenCephAI ${pkg.version} · built `);
    }
  });
});

describe('SettingsWindow ▸ Norms: both read failures shown', () => {
  it('both failed: both messages, the load error with its prefix', () => {
    const out = html(norms('SYNTHETIC bad JSON', 'Your own norms could not be read (SYNTHETIC), so none are used.'));
    expect(out).toContain('Norms couldn&#x27;t be loaded: SYNTHETIC bad JSON');
    expect(out).toContain('Your own norms could not be read (SYNTHETIC), so none are used.');
  });
  it('neither failed: no error box', () => expect(html(norms(null, null))).not.toContain('class="error"'));
});

const mineOf = (clinician: string, error: string | null = null) => {
  const list = clinician ? [{ id: 'my:a', name: 'NOS clinic SYNTHETIC', items: [{ id: 'm01_SNA', from: 'steiner' }, { id: 'm99_Gone', from: '' }] }] : [];
  return { clinician, list, defs: list.map(toAnalysisDef), error, refresh: () => {} };
};
const analysesTab = (m: ReturnType<typeof mineOf>) => renderToStaticMarkup(<SettingsWindow tab="analyses" found={null} norms={norms(null, null)} decimals={1}
  onDecimals={() => {}} onClose={() => {}} meanings={{ clinician: m.clinician, overrides: {}, refresh: () => {} }} filmDetails={{ off: new Set(), toggle: async () => {} }}
  mine={m} onMineSaved={() => {}} onMineDeleted={() => {}} dateFormat="AU" />);
describe('Settings ▸ Analyses: your analyses (owner B1, B2)', () => {
  it('no clinician: how to choose one, and no buttons', () => {
    const out = analysesTab(mineOf(''));
    expect(out).toContain('Choose who is tracing (top bar) to keep your own analyses.');
    expect(out).not.toContain('New analysis…');
  });
  it('a clinician: their analysis with its counts, New and Duplicate; theirs is listed in the browser too', () => {
    const out = analysesTab(mineOf('Dr A SYNTHETIC'));
    expect(out).toContain('NOS clinic SYNTHETIC');
    expect(out).toContain('1 measurement, 1 no longer available');
    expect(out).toContain('New analysis…'); expect(out).toContain('Duplicate');
    expect((out.match(/class="analysis-row/g) ?? []).length).toBe(16);
  });
  it('their stored list unreadable: the reason, and every change button off', () => {
    const out = analysesTab(mineOf('Dr A SYNTHETIC', 'Your analyses could not be read, so nothing will be saved over them.'));
    expect(out).toContain('Your analyses could not be read');
    expect(out).toMatch(/<button[^>]*disabled=""[^>]*>New analysis…<\/button>/);
  });
});
