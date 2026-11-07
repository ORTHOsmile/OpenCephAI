import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CheckModelOffer, OFFER_TEXT, offerActions, showOffer } from './CheckModelOffer';

// 1.2.1 Task 8: the one-time question. (The Escape key and the close button's click are in the browser smoke e2e25.cjs.)
const api = () => { const calls: string[] = []; return { calls, api: { install: vi.fn(() => { calls.push('install'); return Promise.resolve(); }), offerAnswered: vi.fn(() => { calls.push('answered'); return Promise.resolve(); }) } }; };

describe('the one-time question', () => {
  it('has the exact words, a close button and two choices, Download and Later', () => {
    const h = renderToStaticMarkup(<CheckModelOffer onDone={() => {}} />);
    expect(OFFER_TEXT).toBe('The whole-film check needs its model (121 MB, by Dr Linton Nash, CC BY 4.0). Download now?');
    expect(h).toContain(OFFER_TEXT);
    expect([...h.matchAll(/<button[^>]*>([^<]*)<\/button>/g)].map((m) => m[1])).toEqual(['×', 'Download', 'Later']);   // the close button, then the two choices
    expect(h).toContain('role="dialog"');
  });
  it('Download starts the install, then records the answer', async () => {
    const { calls, api: a } = api(); let closed = 0;
    await offerActions(a, () => { closed += 1; }).download();
    expect(calls).toEqual(['install', 'answered']);
    expect(closed).toBe(1);
  });
  it('Later only records the answer: install is never called (Escape and the close button, which call the same action, are checked in e2e25 b3 and b4)', async () => {
    const { calls, api: a } = api(); let closed = 0;
    await offerActions(a, () => { closed += 1; }).later();
    expect(calls).toEqual(['answered']);
    expect(a.install).not.toHaveBeenCalled();
    expect(closed).toBe(1);
  });
  it('a refused install does not stop the answer being recorded or the dialog closing', async () => {
    const { calls, api: a } = api(); a.install.mockImplementation(() => { calls.push('install'); return Promise.reject('No internet connection.'); });
    let closed = 0;
    await offerActions(a, () => { closed += 1; }).download();
    expect(calls).toEqual(['install', 'answered']);
    expect(closed).toBe(1);
  });
  it('is not shown while the beta notice is open, nor before the beta notice is read, nor when the answer is no', () => {
    expect(showOffer(false, true)).toBe(false);   // the beta notice is open
    expect(showOffer(null, true)).toBe(false);    // not read yet
    expect(showOffer(true, null)).toBe(false);    // the question not asked yet
    expect(showOffer(true, false)).toBe(false);
    expect(showOffer(true, true)).toBe(true);
  });
});
