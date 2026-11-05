import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModelRow } from '../ipc';
import { Row, runAction } from './ModelManager';

// Leftovers Task 7: what the Install / Retry button says on each row. SYNTHETIC rows. (The click behaviour is in
// useBusyRun.test.ts and the browser smoke e2e7.cjs: there is no DOM test renderer here.)
const row = (o: Partial<ModelRow>): ModelRow => ({ id: 'gu2net-isbi19', title: 'GU2Net', tier: 'standard', citation: 'c', sizeMb: 60,
  licence: { version: '1', code: 'MIT', weights: 'w', summary: 's', url: 'u', nonCommercial: false }, licenceAccepted: true,
  status: 'not-installed', stage: null, error: null, main: false, msPerFilm: null, page: 'p', notice: null, recommended: false, ...o });
const html = (o: Partial<ModelRow>) => renderToStaticMarkup(<Row r={row(o)} progress={{}} onChanged={() => Promise.resolve()} setErr={() => {}} />);
const buttons = (h: string) => [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

describe('Models… row buttons', () => {
  it('not installed: Install', () => expect(buttons(html({}))).toEqual(['Install']));
  it('a failed install says why and the button says Retry', () => {
    const h = html({ status: 'failed', error: 'Not enough disk space: 60 MB needed.' });
    expect(buttons(h)).toEqual(['Retry']);
    expect(h).toContain('Not enough disk space: 60 MB needed.');
  });
  it('a blocked download keeps its own panel and also says Retry', () => {
    const h = html({ status: 'failed', error: 'DOWNLOAD_BLOCKED' });
    expect(buttons(h)).toEqual(['Retry', 'Copy link', 'Add downloaded file…']);
  });
  it('installing: no button', () => expect(buttons(html({ status: 'installing', stage: 'starting' }))).toEqual([]));
});

// Final review I1: a refused Remove must reach the screen in the app's own words, then the list is read again.
describe('Models… Remove / Starts the tracing refusals', () => {
  it('a rejected call is handed to the screen as the words it came with, and the list is still read again', async () => {
    const words = 'Aariz is in use right now (a tracing or the weights check). Wait for it to finish, then press Remove again.';
    const setErr = vi.fn(), onChanged = vi.fn(() => Promise.resolve());
    await runAction(() => Promise.reject(words), setErr, onChanged);
    expect(setErr.mock.calls.map((c) => c[0])).toEqual([null, words]);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
  it('a call that works shows nothing', async () => {
    const setErr = vi.fn();
    await runAction(() => Promise.resolve(), setErr, () => Promise.resolve());
    expect(setErr.mock.calls.map((c) => c[0])).toEqual([null]);
  });
});
