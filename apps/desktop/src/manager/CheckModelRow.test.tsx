import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CheckRow } from '../ipc';
import { CheckModelRow, checkStatusText } from './CheckModelRow';

// 1.2.1 Task 8: what Models… shows for the whole-film check's region finder, in each state. SYNTHETIC rows. (Clicks are in the
// browser smoke e2e25.cjs: there is no DOM test renderer here.)
const CITATION = 'Nash L (2026). OpenCephAI region finder for lateral cephalograms. Zenodo. doi:10.5281/zenodo.23949953 (all versions). Licence: CC BY 4.0.';
const row = (o: Partial<CheckRow> = {}): CheckRow => ({ title: 'Region finder for the whole-film check', author: 'Dr Linton Nash', licence: 'CC BY 4.0', citation: CITATION,
  page: 'https://zenodo.org/records/23965907', sizeMb: 121, status: 'not-installed', byHand: false, stage: null, error: null, ...o });
const html = (o: Partial<CheckRow> = {}, progress = {}) => renderToStaticMarkup(<CheckModelRow row={row(o)} progress={progress} onChanged={() => Promise.resolve()} setErr={() => {}} />);
// Every state starts with the DOI's own Copy link button; `buttons` leaves it out, `all` keeps it.
const all = (h: string) => [...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);
const buttons = (h: string) => all(h).slice(all(h)[0] === 'Copy link' ? 1 : 0);

describe('the check model row', () => {
  it('names the model, its author and licence, size, citation and a copyable all-versions DOI link', () => {
    const h = html();
    expect(h).toContain('Region finder for the whole-film check');
    expect(h).toContain('Region finder for the whole-film check, by Dr Linton Nash, CC BY 4.0');
    expect(h).toContain('~121 MB');
    expect(h).toContain(CITATION);
    expect(h).toContain('value="https://doi.org/10.5281/zenodo.23949953"');
    expect(all(h)[0]).toBe('Copy link');
    expect(h).not.toMatch(/v1/);
    expect(h).not.toContain('23965907"');   // the version record is never the credit; the page link appears only after a refused download
  });
  it('not installed: Download and Add files…', () => expect(buttons(html())).toEqual(['Download', 'Add files…']));
  it('installing: the percentage and no buttons', () => {
    const h = html({ status: 'installing', stage: 'downloading' }, { 'check-regions': { id: 'check-regions', stage: 'downloading', fraction: 0.376 } });
    expect(h).toContain('Downloading 37%');
    expect(buttons(h)).toEqual([]);
  });
  it('ready: Remove', () => { const h = html({ status: 'ready' }); expect(buttons(h)).toEqual(['Remove']); expect(h).toContain('Ready'); });
  it('ready, a finder put there by hand (no install record): Ready (added by hand), and Remove', () => {
    const h = html({ status: 'ready', byHand: true });
    expect(h).toContain('Ready (added by hand)');
    expect(buttons(h)).toEqual(['Remove']);
    expect(html({ status: 'ready' })).not.toContain('added by hand');
  });
  it('failed: the error and Retry (and Add files…)', () => {
    const h = html({ status: 'failed', error: 'No internet connection. Nothing was installed. Try again when you are online, or use Add files…' });
    expect(buttons(h)).toEqual(['Retry', 'Add files…']);
    expect(h).toContain('No internet connection.');
  });
  it('a refused download also gives the page to fetch the two files by hand', () => {
    const h = html({ status: 'failed', error: 'DOWNLOAD_BLOCKED' });
    expect(all(h)).toEqual(['Copy link', 'Retry', 'Add files…', 'Copy link']);
    expect(buttons(h)).toEqual(['Retry', 'Add files…', 'Copy link']);
    expect(h).toContain('value="https://zenodo.org/records/23965907"');
    expect(h).not.toContain('>DOWNLOAD_BLOCKED<');
  });
  it('a file that does not match is refused in the words the app wrote', () => {
    const h = html({ status: 'failed', error: "The file doesn't match the one this version of OpenCephAI was made for. Nothing was installed." });
    expect(h).toContain('Nothing was installed.');
    expect(buttons(h)).toEqual(['Retry', 'Add files…']);
  });
  it('damaged: says to download it again, with Retry', () => {
    const h = html({ status: 'damaged' });
    expect(h).toContain('Damaged: download it again');
    expect(buttons(h)).toEqual(['Retry', 'Add files…', 'Remove']);
  });
  it('nothing read yet: a quiet line and no buttons', () => {
    const h = renderToStaticMarkup(<CheckModelRow row={null} progress={{}} onChanged={() => Promise.resolve()} setErr={() => {}} />);
    expect(h).toContain('Reading…');
    expect(buttons(h)).toEqual([]);
  });
  it('status words per stage', () => {
    expect(checkStatusText(row({ status: 'installing', stage: 'checking' }), undefined)).toBe('Checking');
    expect(checkStatusText(row({ status: 'installing', stage: 'testing' }), undefined)).toBe('Testing');
    expect(checkStatusText(row({ status: 'installing', stage: 'downloading' }), undefined)).toBe('Downloading');
    expect(checkStatusText(row({ status: 'not-installed' }), undefined)).toBe('Not installed');
  });
});
