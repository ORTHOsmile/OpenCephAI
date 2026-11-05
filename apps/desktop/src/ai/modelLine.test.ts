import { describe, it, expect, vi } from 'vitest';
import type { AutoBestMap } from '../ipc';
import { modelLine } from './modelLine';
import { runIntro } from './useAutoBest';
// Plan 2026-10-29 Task 7; spec §11: the text after "Model: ". SYNTHETIC maps.
const T = (id: string) => ({ 'aariz-cepha29': 'Aariz (CEPHA29, HRNet-W32)', 'gu2net-isbi19': 'GU2Net', 'my-model': 'My clinic model' } as Record<string, string>)[id] ?? id;
const m = (o: Partial<AutoBestMap>): AutoBestMap => ({ available: true, on: true, base: 'aariz-cepha29', uses: {}, notes: {}, kept: {}, latest: [], ...o });
describe('the model line (spec §11)', () => {
  it('names Automatic best and the actual base', () => {
    expect(modelLine('gu2net-isbi19', m({ base: 'gu2net-isbi19' }), T)).toBe('Automatic best (starts from GU2Net)');
    expect(modelLine('aariz-cepha29', m({}), T)).toBe('Automatic best (starts from Aariz)');
  });
  it('a fixed main model is named by its short name or title, never its file id', () => {
    expect(modelLine('aariz-cepha29', m({ on: false }), T)).toBe('Aariz');
    expect(modelLine('aariz-cepha29', null, T)).toBe('Aariz');
    expect(modelLine('my-model', null, T)).toBe('My clinic model');
    expect(modelLine('my-folder-model', null, (id) => id)).toBe('the model from your model folder');
  });
  it('never prints a raw file id', () => {
    for (const id of ['aariz-cepha29', 'gu2net-isbi19', 'srpose-cldet23', 'cwlachap-hrnet-w32', 'x-y'])
      expect(modelLine(id, null, (x) => x)).not.toMatch(/-/);
  });
  it('edge cases: nothing loaded; the map not read yet; the base not installed (the fixed fallback model by name)', () => {
    expect(modelLine(null, null, T)).toBe('no model');
    expect(modelLine('aariz-cepha29', undefined, T)).toBe('Aariz');
    expect(modelLine('gu2net-isbi19', m({ available: false, on: false, base: 'srpose-cldet23' }), T)).toBe('GU2Net');
  });
});
describe('a first-open step that fails is shown (spec §11, path b)', () => {
  it('the error says what failed and that it will try again; the console still logs', async () => {
    const setIntro = vi.fn(), setError = vi.fn(), warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await runIntro(() => Promise.reject('locked'), setIntro, setError);
    expect(setError).toHaveBeenCalledWith('Automatic best could not be switched on: locked. It will try again the next time you open the app.');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(setIntro).not.toHaveBeenCalled();
    warn.mockRestore();
  });
  it('control: a step that works shows its note and no error', async () => {
    const setIntro = vi.fn(), setError = vi.fn();
    await runIntro(() => Promise.resolve({ before: null, keptDeclines: 0 }), setIntro, setError);
    expect([setIntro.mock.calls.length, setError.mock.calls.length]).toEqual([1, 0]);
  });
});
