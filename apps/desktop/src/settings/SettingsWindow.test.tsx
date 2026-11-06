import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSets, toAnalysisDef } from '@ceph/analyses';
import { SettingsWindow } from './SettingsWindow';
import { DECIMALS_KEY, readDecimals, type Decimals } from '../format';
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

// Owner, addendum 2 I (19 Oct 2026): "The decimals setting moves from Settings › Analyses to the Norms page of Settings.
// Same setting, same stored value; only its place changes."
describe('Settings: the decimals setting lives on the Norms page (I)', () => {
  const render = (tab: 'norms' | 'analyses', decimals: Decimals, onDecimals: (d: Decimals) => void) => renderToStaticMarkup(
    <SettingsWindow tab={tab} found={null} norms={norms(null, null)} decimals={decimals} onDecimals={onDecimals} onClose={() => {}}
      meanings={{ clinician: '', overrides: {}, refresh: () => {} }} filmDetails={{ off: new Set(), toggle: async () => {} }}
      mine={{ clinician: '', list: [], defs: [], error: null, refresh: () => {} }} onMineSaved={() => {}} onMineDeleted={() => {}} dateFormat="AU" />);
  const selected = (html: string) => /<label class="dec-control">Decimals shown<select>([\s\S]*?)<\/select>/.exec(html)?.[1].match(/<option value="(\d)" selected="">/)?.[1] ?? null;
  it('the stored value (SYNTHETIC store holding 3) shows selected on the Norms page; opening it writes nothing', async () => {
    const store = { get: async (k: string) => (k === DECIMALS_KEY ? '3' : null) };
    const writes: Decimals[] = [];
    const html = render('norms', await readDecimals(store), (d) => writes.push(d));
    expect([selected(html), writes]).toEqual(['3', []]);
    expect(html).toContain('Clinic default population');   // the rest of the Norms page is still there
  });
  it('owner decision 2 (29 Oct 2026): the unset clinic default reads "Not set", with the Auto hint', () => {
    const html = render('norms', 1, () => {});
    expect(/<label>Clinic default population<select>(<option value="" selected="">|<option value="">)Not set<\/option>/.test(html)).toBe(true);
    // Owner R3 (3 Nov 2026; spec 2026-11-03 §8.3).
    expect(html).toContain("Auto uses: the patient&#x27;s background, else this default, else for patients 18 and over (or with no age entered) a combined adult norm (every adult study, weighted by size, men and women separately) and for children the largest study for their sex and age. Cases switched to Auto at the upgrade follow this rule too. Only cases you put back on &quot;Clinic default (as before the upgrade)&quot; use each analysis&#x27;s own norms when this is not set.");
    expect(html).not.toContain('(none set)');
  });
  it('the Analyses page no longer has it', () => {
    expect(render('analyses', 1, () => {})).not.toContain('Decimals shown');
  });
  it('the stored key and its reading are unchanged (a broken value still reads as the default 1)', async () => {
    expect(DECIMALS_KEY).toBe('display_decimals');
    expect(await readDecimals({ get: async () => '7' })).toBe(1);
  });
});

// Plan 2026-10-29 Task 9; spec §2, §2a: Settings › Best model. SYNTHETIC rows and maps.
import { BestModelSettingsView, foldOpen, foldValue } from './BestModelSettings';
import type { AutoBestMap, BestPerPoint, ModelRow } from '../ipc';
import { event } from '../ai/autoBestFixtures';
const AZ9 = 'aariz-cepha29', SR9 = 'srpose-cldet23';
const rows9 = [{ id: AZ9, title: 'Aariz', status: 'ready' }, { id: SR9, title: 'SRPose', status: 'ready' }] as ModelRow[];
const map9: AutoBestMap = { available: true, on: true, base: AZ9, uses: { Go: SR9 }, notes: {}, kept: {}, latest: [event()] };
const best9: BestPerPoint = { ruleVersion: 'best-point/4', choices: [], checks: [], points: [] };
const settings9 = (tab: 'analyses' | 'bestModel' | 'checks') => renderToStaticMarkup(<SettingsWindow tab={tab} found={null} norms={norms(null, null)} decimals={1} onDecimals={() => {}} onClose={() => {}}
  meanings={{ clinician: '', overrides: {}, refresh: () => {} }} filmDetails={{ off: new Set(), toggle: async () => {} }}
  mine={{ clinician: '', list: [], defs: [], error: null, refresh: () => {} }} onMineSaved={() => {}} onMineDeleted={() => {}} dateFormat="AU"
  bestModel={<p className="best-model-stub">the Best model tab</p>} wholeFilm={<p className="checks-stub">the Checks tab</p>} />);
const view9 = (o: Partial<Parameters<typeof BestModelSettingsView>[0]> = {}) => renderToStaticMarkup(<BestModelSettingsView base={AZ9} baseError={null} rows={rows9} titleOf={(m) => m}
  map={map9} mapError={null} dateFormat="AU" tableOpen best={{ data: best9, error: null, notice: null, progress: null }} onChoose={() => {}} onTable={() => {}}
  onAnswer={() => {}} onUndo={() => {}} onRedo={() => {}} {...o} />);
describe('Settings › Best model (spec §2)', () => {
  it('the tabs are Analyses, Norms, Meanings, Text on the film, Best model, Checks, in that order', () => {
    expect([...settings9('analyses').matchAll(/role="tab"[^>]*>([^<]+)</g)].map((m) => m[1])).toEqual(['Analyses', 'Norms', 'Meanings', 'Text on the film', 'Best model', 'Checks']);
  });
  /** SC-1 Part 1b Task D2: Settings › Checks holds the Whole-film check switch (App's `WholeFilmSettings`). Fails if the tab is missing, not selected, or shows another tab's body. */
  it('opened at Checks, it shows that tab, selected, and not the Best model tab', () => {
    const h = settings9('checks');
    expect(h).toContain('the Checks tab');
    expect(h).not.toContain('the Best model tab');
    expect(h).toMatch(/aria-selected="true"[^>]*>Checks</);
    expect(settings9('analyses')).not.toContain('the Checks tab');
  });
  it('opened at Best model, it shows that tab, selected', () => {
    const h = settings9('bestModel');
    expect(h).toContain('the Best model tab');
    expect(h).toMatch(/aria-selected="true"[^>]*>Best model</);
  });
  it('the base, the summary, Recent changes with Undo, and the table in an open fold', () => {
    const h = view9();
    expect(h).toContain('Base model');
    expect(h).toMatch(/<option value="aariz-cepha29" selected="">Aariz \(recommended\)/);
    expect(h).toContain('Uses SRPose for Go; Aariz for the other 18 points.');
    expect(h).toContain('>Undo<');
    expect(h).toMatch(/aria-expanded="true"[^>]*>.*Best model per point/);
    expect(h).toContain('class="best-per-point"');
  });
  it('Recent changes, moved from Models…: the adoption with Undo; after an Undo, Use SRPose again; after a return, no button', () => {
    expect(view9()).toContain('Gonion (Go): SRPose since 27/10/2026, decided on 60 ruler films.');
    expect(view9({ map: { ...map9, latest: [event({ kind: 'undone', uses: null })] } })).toContain('>Use SRPose again<');
    const recent = (h: string) => /<ul class="auto-best-recent">(.*?)<\/ul>/.exec(h)?.[1] ?? '';
    expect(recent(view9())).toContain('>Undo<');
    expect(recent(view9({ map: { ...map9, latest: [event({ kind: 'returned', uses: null, basis: null, reason: 'evidence' })] } }))).not.toContain('<button');
  });
  it('a folded table is not drawn; the fold stays', () => {
    const h = view9({ tableOpen: false });
    expect(h).toMatch(/aria-expanded="false"[^>]*>.*Best model per point/);
    expect(h).not.toContain('class="best-per-point"');
  });
  it('edge cases: still reading; an error; no model installed (drop-down greyed, the reason, the table still readable)', () => {
    expect(view9({ best: { data: null, error: null, notice: null, progress: null } })).toContain('Reading your verified films…');
    expect(view9({ best: { data: null, error: 'locked', notice: null, progress: null } })).toContain('locked');
    const none = view9({ rows: [{ id: AZ9, title: 'Aariz', status: 'not-installed' }] as ModelRow[], map: { ...map9, available: false, on: false } });
    expect(none).toMatch(/<select[^>]*disabled=""/);
    expect(none).toContain('No model is installed yet');
    expect(none).toContain('class="best-per-point"');
  });
  it('the fold is remembered as "0"/"1" and starts open', () => {
    expect([foldOpen(null), foldOpen('1'), foldOpen('0'), foldOpen('x')]).toEqual([true, true, false, true]);
    expect([foldValue(true), foldValue(false)]).toEqual(['1', '0']);
  });
});

// Owner, 6 Nov 2026: "Move to the next point automatically", on by default.
describe('SettingsWindow: the auto-advance switch', () => {
  const tab = (autoAdvance?: boolean) => renderToStaticMarkup(<SettingsWindow tab="norms" found={null} norms={norms(null, null)} decimals={1} onDecimals={() => {}} onClose={() => {}}
    meanings={{ clinician: '', overrides: {}, refresh: () => {} }} filmDetails={{ off: new Set(), toggle: async () => {} }} mine={mineOf('')} onMineSaved={() => {}} onMineDeleted={() => {}} dateFormat="AU"
    autoAdvance={autoAdvance} onAutoAdvance={() => {}} />);
  /** Fails if the label drifts or the box is not ticked by default. */
  it('"Move to the next point automatically" is ticked by default and unticked when off', () => {
    const on = tab(), off = tab(false);
    expect(on).toContain('Move to the next point automatically');
    expect(on.match(/<input[^>]*auto-advance|<label class="auto-advance-control"><input[^>]*>/)?.[0]).toMatch(/checked/);
    expect(off.match(/<label class="auto-advance-control"><input[^>]*>/)?.[0]).not.toMatch(/checked/);
  });
});
