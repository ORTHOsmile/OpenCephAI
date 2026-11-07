import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckModelProgress, FAILED_LINE, progressLine } from './CheckModelProgress';
import { offerActions } from './CheckModelOffer';

// 1.2.1 review I2 (spec §6): after Download in the question, a small line under the film list follows the install.
// (The line under the live events, and closing when ready, are in the browser smoke e2e25.cjs.)
describe('the progress line under the film list', () => {
  it('says what the install is doing, with the percentage once it is known', () => {
    expect(progressLine({ stage: 'downloading', fraction: null })).toBe('Downloading the check model…');
    expect(progressLine({ stage: 'downloading', fraction: 0.376 })).toBe('Downloading the check model… 37%');
    expect(progressLine({ stage: 'checking', fraction: null })).toBe('Checking the check model…');
    expect(progressLine({ stage: 'testing', fraction: null })).toBe('Testing the check model…');
  });
  it('closes when the install is ready, and says nothing before any event', () => {
    expect(progressLine({ stage: 'ready', fraction: null })).toBeNull();
    expect(progressLine(null)).toBeNull();
  });
  it('a failure says nothing was installed and where to retry', () => {
    expect(FAILED_LINE).toBe('The check model did not download. Nothing was installed. Try again in Models…');
    expect(progressLine({ stage: 'failed', fraction: null })).toBe(FAILED_LINE);
  });
  it('shows nothing until Download was pressed; a refused install command shows the failure line', () => {
    expect(renderToStaticMarkup(<CheckModelProgress started={false} failedNow={false} />)).toBe('');
    expect(renderToStaticMarkup(<CheckModelProgress started={true} failedNow={false} />)).toBe('');   // started, no event yet
    expect(renderToStaticMarkup(<CheckModelProgress started={true} failedNow={true} />)).toContain(FAILED_LINE);
    expect(renderToStaticMarkup(<CheckModelProgress started={false} failedNow={true} />)).toBe('');
  });
});

describe('Download in the question starts the line', () => {
  const api = (install: () => Promise<void>) => ({ install: vi.fn(install), offerAnswered: vi.fn(() => Promise.resolve()) });
  it('tells the screen the install started, and that it was refused when it is', async () => {
    const seen: string[] = [];
    await offerActions(api(() => Promise.resolve()), () => seen.push('done'), { started: () => seen.push('started'), failed: () => seen.push('failed') }).download();
    expect(seen).toEqual(['started', 'done']);
    const seen2: string[] = [];
    const a = offerActions(api(() => Promise.reject('already being installed')), () => seen2.push('done'), { started: () => seen2.push('started'), failed: () => seen2.push('failed') });
    await a.download(); await new Promise((r) => setTimeout(r, 0));
    expect(seen2).toEqual(['started', 'failed', 'done']);
  });
  it('Later never starts it', async () => {
    const seen: string[] = [];
    await offerActions(api(() => Promise.resolve()), () => seen.push('done'), { started: () => seen.push('started'), failed: () => seen.push('failed') }).later();
    expect(seen).toEqual(['done']);
  });
});
