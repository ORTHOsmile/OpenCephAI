import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { WholeFilmSettingsView, applyWholeSwitch, WHOLE_IN_REPORTS_LABEL } from './WholeFilmSettings';
import type { WholeSwitch } from '../ipc';

// SC-1 Part 1b Task D2 (owner ruling 5 Nov 2026): Settings › Checks, "Whole-film check (beta)". SYNTHETIC values.
const off: WholeSwitch = { on: false, isDefault: true, line: 'Not yet tested on new films.' };
const on: WholeSwitch = { on: true, isDefault: false, line: 'Tested once on 102 new films (PKU, 2026): SYNTHETIC line.' };
function find(el: unknown, pred: (e: ReactElement) => boolean, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(el)) { el.forEach((c) => find(c, pred, out)); return out; }
  if (el && typeof el === 'object' && 'props' in (el as ReactElement)) {
    const e = el as ReactElement;
    if (pred(e)) out.push(e);
    find((e.props as { children?: unknown }).children, pred, out);
  }
  return out;
}
describe('WholeFilmSettingsView', () => {
  /** Fails if the label words drift, the line is missing, or the box is not ticked per `on`. */
  it('shows the checkbox with its label, ticked per on, and the result line under it', () => {
    const h0 = renderToStaticMarkup(<WholeFilmSettingsView state={off} error={null} onChange={() => {}} />);
    expect(h0).toContain('Whole-film check (beta)');
    expect(h0).toContain('Not yet tested on new films.');
    expect(h0).toMatch(/<input[^>]*type="checkbox"/);
    expect(h0).not.toMatch(/<input[^>]*checked/);
    const h1 = renderToStaticMarkup(<WholeFilmSettingsView state={on} error={null} onChange={() => {}} />);
    expect(h1).toMatch(/<input[^>]*checked/);
    expect(h1).toContain('Tested once on 102 new films (PKU, 2026): SYNTHETIC line.');
    expect(h1.indexOf('Whole-film check (beta)')).toBeLessThan(h1.indexOf('Tested once'));
  });
  /** Nothing read yet: no checkbox that could be pressed before the state is known. */
  it('nothing read yet: the box is disabled, no line, no error', () => {
    const h = renderToStaticMarkup(<WholeFilmSettingsView state={null} error={null} onChange={() => {}} />);
    expect(h).toMatch(/<input[^>]*disabled/);
    expect(h).not.toContain('Tested once');
  });
  /** A failed read or write is shown on screen. */
  it('an error is shown', () => {
    expect(renderToStaticMarkup(<WholeFilmSettingsView state={off} error="SYNTHETIC could not be saved" onChange={() => {}} />)).toContain('SYNTHETIC could not be saved');
  });
  /** Fails if a press on the box does not hand the new state (the opposite of `on`) to `onChange`. */
  it('a change passes the ticked state on', () => {
    const seen: boolean[] = [];
    const el = WholeFilmSettingsView({ state: off, error: null, onChange: (v) => seen.push(v) });
    const box = find(el, (e) => e.type === 'input')[0];
    (box.props as { onChange: (e: { target: { checked: boolean } }) => void }).onChange({ target: { checked: true } });
    expect(seen).toEqual([true]);
  });
});
describe('the research switch (owner, 6 Nov 2026)', () => {
  /** Fails if the label words drift or the box is ticked by default. */
  it('"Include the whole-film check in reports and CSV (research)": unticked by default, beside the check\'s own switch', () => {
    expect(WHOLE_IN_REPORTS_LABEL).toBe('Include the whole-film check in reports and CSV (research)');
    const h = renderToStaticMarkup(<WholeFilmSettingsView state={on} error={null} onChange={() => {}} onInReports={() => {}} />);
    const boxes = h.match(/<input[^>]*type="checkbox"[^>]*>/g)!;
    expect(boxes.length).toBe(2);
    expect(boxes[1]).not.toMatch(/checked/);
    expect(h.indexOf('Whole-film check (beta)')).toBeLessThan(h.indexOf(WHOLE_IN_REPORTS_LABEL));
    expect(renderToStaticMarkup(<WholeFilmSettingsView state={on} error={null} onChange={() => {}} inReports onInReports={() => {}} />).match(/<input[^>]*type="checkbox"[^>]*>/g)![1]).toMatch(/checked/);
  });
  it('a change passes the ticked state on', () => {
    const seen: boolean[] = [];
    const el = WholeFilmSettingsView({ state: on, error: null, onChange: () => {}, onInReports: (v) => seen.push(v) });
    const box = find(el, (e) => e.type === 'input')[1];
    (box.props as { onChange: (e: { target: { checked: boolean } }) => void }).onChange({ target: { checked: true } });
    expect(seen).toEqual([true]);
  });
});
describe('applyWholeSwitch', () => {
  /** Fails if it does not call `whole_film_switch_set` with the new value, or does not tell the open film to re-read. */
  it('writes through the command and then asks the film to re-read', async () => {
    const calls: string[] = [];
    const lib = { wholeFilmSwitchSet: async (v: boolean): Promise<WholeSwitch> => { calls.push(`set ${v}`); return { ...on, on: v }; } };
    const r = await applyWholeSwitch(lib, true, () => calls.push('reread'));
    expect(calls).toEqual(['set true', 'reread']);
    expect(r.on).toBe(true);
  });
  /** A failed write leaves the film alone (no re-read claiming a change) and the error goes up. */
  it('a failed write does not re-read and throws', async () => {
    const calls: string[] = [];
    const lib = { wholeFilmSwitchSet: async (): Promise<WholeSwitch> => { throw new Error('SYNTHETIC refused'); } };
    await expect(applyWholeSwitch(lib, false, () => calls.push('reread'))).rejects.toThrow('SYNTHETIC refused');
    expect(calls).toEqual([]);
  });
});
