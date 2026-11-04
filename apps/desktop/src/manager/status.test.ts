import { describe, expect, it } from 'vitest';
import { statusText, blocked } from './status';
import type { ModelRow } from '../ipc';
const row = (o: Partial<ModelRow>): ModelRow => ({ id: 'gu2net-isbi19', title: 'GU2Net', tier: 'standard', citation: 'c', sizeMb: 60,
  licence: { version: '1', code: 'MIT', weights: 'w', summary: 's', url: 'u', nonCommercial: false }, licenceAccepted: false,
  status: 'not-installed', stage: null, error: null, main: false, msPerFilm: null, page: 'p', notice: null, recommended: false, ...o });
describe('statusText', () => {
  it('names each state in plain words', () => {
    expect(statusText(row({}))).toBe('Not installed');
    expect(statusText(row({ status: 'installing', stage: 'downloading' }), { id: 'gu2net-isbi19', stage: 'downloading', fraction: 0.452 })).toBe('Downloading 45%');
    expect(statusText(row({ status: 'installing', stage: 'checking' }))).toBe('Checking');
    expect(statusText(row({ status: 'installing', stage: 'converting' }))).toBe('Converting');
    expect(statusText(row({ status: 'installing', stage: 'testing' }))).toBe('Checking');
    expect(statusText(row({ status: 'ready', msPerFilm: 412 }))).toBe('Ready · 0.4 s per film');
    expect(statusText(row({ status: 'failed', error: 'This file doesn’t match GU2Net. Nothing was installed.' }))).toBe('Failed');
  });
  it('tells a blocked download apart', () => {
    expect(blocked(row({ status: 'failed', error: 'DOWNLOAD_BLOCKED' }))).toBe(true);
    expect(blocked(row({ status: 'failed', error: 'Not enough disk space: 0 MB needed.' }))).toBe(false);
  });
});
