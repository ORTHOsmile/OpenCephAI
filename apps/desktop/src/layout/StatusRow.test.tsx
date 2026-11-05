import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialTracing, tracingReducer as r, type TracingState } from '../tracing/state';
import type { SignOff } from '../tracing/signOff';
import { StatusRow, remainingTitle } from './StatusRow';

// Synthetic points only.
const loaded = r(initialTracing, { type: 'load', landmarks: [{ id: 'S', x: 1, y: 1 }, { id: 'N', x: 50, y: 1 }, { id: 'A', x: 50, y: 50 }] });   // active S
const open: SignOff = { verifiedAt: null, verifiedBy: null, holdLine: null, busy: false, onSign: () => {}, onReopen: () => {} };
const html = (state: TracingState, o: { signOff?: SignOff | null; readOnly?: boolean; outside?: number } = {}) =>
  renderToStaticMarkup(<StatusRow state={state} dispatch={() => {}} signOff={o.signOff === undefined ? open : o.signOff} readOnly={o.readOnly ?? false} outside={o.outside ?? 0} mod="⌘" />);
const button = (out: string, label: string) => out.match(new RegExp(`<button[^>]*>${label.replace(/[()]/g, '\\$&')}</button>`))?.[0] ?? null;
const isDisabled = (b: string | null) => !!b && b.includes('disabled=""');
const buttons = (out: string) => out.match(/<button[^>]*>/g) ?? [];

describe('the status row (spec 2026-10-19)', () => {
  it('P1: an accepted point reads "Accepted", an AI one "AI · unverified"; a point never reads "Verified"', () => {
    expect(html(loaded)).toContain('>AI · unverified<');
    const acc = html(r(loaded, { type: 'accept' }));
    expect(acc).toContain('>Accepted<');
    expect(acc).not.toMatch(/>Verified</);
  });
  it('V4: "Accept remaining (n)" counts what is left, shows at 1, hides at 0', () => {
    expect(button(html(loaded), 'Accept remaining (3)')).not.toBeNull();
    expect(button(html(r(loaded, { type: 'acceptMany', ids: ['S', 'N'] })), 'Accept remaining (1)')).not.toBeNull();
    expect(html(r(loaded, { type: 'acceptRemaining' }))).not.toContain('Accept remaining');
  });
  it('its hover text says how many are outside the analyses shown, and names undo the platform way', () => {
    expect(html(loaded, { outside: 2 })).toContain(`title="${remainingTitle(2, '⌘')}"`);
    expect(remainingTitle(0, '⌘')).toBe('Accept every point not yet accepted, where it is. ⌘Z undoes it.');
    expect(remainingTitle(1, 'Ctrl')).toBe('Accept every point not yet accepted, where it is. 1 of them is not used by the analyses shown. Ctrl+Z undoes it.');
  });
  it('V6: two or more picked points make it "Accept Positions (n)"; one picked keeps "Accept position"', () => {
    const two = r(r(loaded, { type: 'togglePick', id: 'N' }), { type: 'togglePick', id: 'A' });
    expect(button(html(two), 'Accept Positions (2)')).not.toBeNull();
    expect(button(html(r(loaded, { type: 'togglePick', id: 'N' })), 'Accept position')).not.toBeNull();
    const bothDone = r(r(r(loaded, { type: 'acceptMany', ids: ['N', 'A'] }), { type: 'togglePick', id: 'N' }), { type: 'togglePick', id: 'A' });
    expect(isDisabled(button(html(bothDone), 'Accept Positions (2)'))).toBe(true);
    expect(isDisabled(button(html(two), 'Accept Positions (2)'))).toBe(false);          // control
  });
  it('V1: "Mark tracing verified" sits here, enabled only when every point is accepted, never with no points', () => {
    expect(isDisabled(button(html(loaded), 'Mark tracing verified'))).toBe(true);
    expect(isDisabled(button(html(r(loaded, { type: 'acceptRemaining' })), 'Mark tracing verified'))).toBe(false);
    expect(isDisabled(button(html(initialTracing), 'Mark tracing verified'))).toBe(true);
  });
  it('signed off: "Tracing verified by … on …" with Reopen; the hold line shows when there is one', () => {
    const done = r(loaded, { type: 'acceptRemaining' });
    const signed = html(done, { signOff: { ...open, verifiedAt: '2026-10-19T09:00:00Z', verifiedBy: 'SYNTHETIC-operator' } });
    expect(signed).toContain('Tracing verified by SYNTHETIC-operator on 2026-10-19.');
    expect(button(signed, 'Reopen')).not.toBeNull();
    expect(signed).not.toContain('Mark tracing verified');
    expect(html(done, { signOff: { ...open, holdLine: 'The mm changed — check, then mark verified.' } })).toContain('The mm changed — check, then mark verified.');
    expect(html(done)).not.toContain('hold-line');                                        // control: no line, no element
  });
  it('locked (busy) or read-only: every control here is disabled', () => {
    const two = r(r(loaded, { type: 'togglePick', id: 'N' }), { type: 'togglePick', id: 'A' });
    expect(buttons(html(two)).some((b) => !b.includes('disabled=""'))).toBe(true);        // control
    for (const o of [{ readOnly: true }, { signOff: { ...open, busy: true } }]) expect(buttons(html(two, o)).every((b) => b.includes('disabled=""'))).toBe(true);
    const signed = { ...open, verifiedAt: '2026-10-19T09:00:00Z', verifiedBy: 'x' };
    expect(isDisabled(button(html(two, { signOff: signed, readOnly: true }), 'Reopen'))).toBe(true);
  });
  it('no case open: no sign-off controls', () => { expect(html(loaded, { signOff: null })).not.toContain('Mark tracing verified'); });
});

// Stage A task 7: the status row with flagged points. SYNTHETIC points only.
describe('the status row with flagged points (Stage A)', () => {
  const flagged = r(loaded, { type: 'setFlagged', ids: ['N'] });          // S, N, A placed; N flagged
  /** Fails if "Accept remaining (n)" counts the flagged point (it would read 3). */
  it('"Accept remaining (n)" counts without the flagged point', () => {
    expect(button(html(flagged), 'Accept remaining (2)')).not.toBeNull();
    expect(html(flagged)).not.toContain('Accept remaining (3)');
  });
  /** Fails if the button stays when only flagged points are left (it would offer an accept that does nothing). */
  it('when only flagged points are left there is no "Accept remaining", and the sign-off waits for them', () => {
    const rest = r(flagged, { type: 'acceptRemaining' });
    expect(html(rest)).not.toContain('Accept remaining');
    expect(isDisabled(button(html(rest), 'Mark tracing verified'))).toBe(true);
    expect(html(rest)).toContain('1 point is not accepted yet');
  });
  /** Fails if the count or the title ignore the flagged point in a ⌘-pick. */
  it('"Accept Positions (n)" counts without the flagged point and says why', () => {
    const two = r(r(flagged, { type: 'togglePick', id: 'N' }), { type: 'togglePick', id: 'A' });
    const out = html(two);
    expect(button(out, 'Accept Positions (1)')).not.toBeNull();
    expect(out).toContain('title="1 flagged point to check on its own"');
    expect(isDisabled(button(out, 'Accept Positions (1)'))).toBe(false);
  });
  it('picking only flagged points leaves nothing to accept: disabled, with the plural title', () => {
    const f2 = r(loaded, { type: 'setFlagged', ids: ['N', 'A'] });
    const two = r(r(f2, { type: 'togglePick', id: 'N' }), { type: 'togglePick', id: 'A' });
    expect(isDisabled(button(html(two), 'Accept Positions (0)'))).toBe(true);
    expect(html(two)).toContain('title="2 flagged points to check on their own"');
  });
  /** Control: with no flag nothing changes (also fails if the title is always present). */
  it('no flags: the plain labels, no flagged title', () => {
    const two = r(r(loaded, { type: 'togglePick', id: 'N' }), { type: 'togglePick', id: 'A' });
    expect(button(html(two), 'Accept Positions (2)')).not.toBeNull();
    expect(html(two)).not.toContain('flagged point');
  });
  /** Fails if a flagged active point cannot be accepted on its own with the single button. */
  it('the single Accept position button is enabled on a flagged point', () => {
    const onN = r(flagged, { type: 'select', id: 'N' });
    expect(isDisabled(button(html(onN), 'Accept position'))).toBe(false);
  });
});

// Stage A task 7, fix round 1.
describe('the status row: the check read, the hold, the flagged clause', () => {
  const flagged = r(loaded, { type: 'setFlagged', ids: ['N'] });
  /** Fails if a bulk button is live before the check is read. */
  it('while the check read is pending both bulk buttons are disabled', () => {
    const p = r(loaded, { type: 'setFlagged', ids: [], pending: true });
    expect(isDisabled(button(html(p), 'Accept remaining (3)'))).toBe(true);
    const two = r(r(p, { type: 'togglePick', id: 'N' }), { type: 'togglePick', id: 'A' });
    expect(isDisabled(button(html(two), 'Accept Positions (2)'))).toBe(true);
    expect(isDisabled(button(html(loaded), 'Accept remaining (3)'))).toBe(false);            // control
  });
  /** Fails if the Accept remaining title does not say flagged points are left out, in the same words as Accept Positions. */
  it('the "Accept remaining" title carries the same flagged clause', () => {
    expect(html(flagged)).toContain(`title="${remainingTitle(0, '⌘', 1)}"`);
    expect(remainingTitle(0, '⌘', 1)).toBe('Accept every point not yet accepted, where it is. 1 flagged point to check on its own. ⌘Z undoes it.');
    expect(remainingTitle(0, '⌘', 2)).toContain('2 flagged points to check on their own.');
    expect(remainingTitle(0, '⌘')).toBe('Accept every point not yet accepted, where it is. ⌘Z undoes it.');
  });
  /** Fails if the film note does not hold "Mark tracing verified" with the owner's exact line. */
  it('film note unresolved: "Mark tracing verified" is disabled with exactly the line', () => {
    const done = r(loaded, { type: 'acceptRemaining' });
    const held = html(done, { signOff: { ...open, filmHeld: true, holdLine: 'Press Checked on the film note first.' } });
    expect(isDisabled(button(held, 'Mark tracing verified'))).toBe(true);
    expect(held).toContain('Press Checked on the film note first.');
    expect(isDisabled(button(html(done), 'Mark tracing verified'))).toBe(false);              // control: no hold
  });
  /** Whole-branch review I2 (fail closed): a failed read holds the sign-off and offers "Try again". Fails if the retry
   *  is not offered, or is offered while nothing failed (no `retryCheck`). */
  it('the check could not be read: held, with the words and a "Try again" button', () => {
    const done = r(loaded, { type: 'acceptRemaining' });
    const failed = html(done, { signOff: { ...open, filmHeld: true, holdLine: 'The point check could not be read.', retryCheck: () => {} } });
    expect(isDisabled(button(failed, 'Mark tracing verified'))).toBe(true);
    expect(failed).toContain('The point check could not be read.');
    const retry = button(failed, 'Try again');
    expect(retry).not.toBeNull();
    expect(isDisabled(retry)).toBe(false);
    expect(button(html(done, { signOff: { ...open, filmHeld: true, holdLine: 'Reading the point check…' } }), 'Try again')).toBeNull();   // control
  });
});

