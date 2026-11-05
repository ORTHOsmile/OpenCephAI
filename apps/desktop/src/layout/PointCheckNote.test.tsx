import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { PointCheckNote, pressChecked } from './PointCheckNote';
import { CHECK_WORDS } from '../points/pointCheck';
import type { PointCheckFlag } from '../ipc';

// Stage A task 7: the film note (ruling F13). SYNTHETIC ids only.
const film = (over: Partial<PointCheckFlag> = {}): PointCheckFlag => ({
  id: 7, modelId: 'aariz-cepha29', landmarkId: null, action: 'film-unusual', points: 'N,S,Po,Ar', offPx: null, expectedX: null, expectedY: null, ring: null, resolved: null, ...over });
const html = (flags: PointCheckFlag[], canCheck = true, onChecked: (ids: number[]) => void = () => {}) =>
  renderToStaticMarkup(<PointCheckNote flags={flags} canCheck={canCheck} onChecked={onChecked} />);
const buttons = (h: string) => h.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
/** The elements of a (hook-free) component's tree, to press a button without a DOM. */
function find(el: unknown, pred: (e: ReactElement) => boolean, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(el)) { el.forEach((c) => find(c, pred, out)); return out; }
  if (el && typeof el === 'object' && 'props' in (el as ReactElement)) {
    const e = el as ReactElement;
    if (pred(e)) out.push(e);
    find((e.props as { children?: unknown }).children, pred, out);
  }
  return out;
}

describe('PointCheckNote', () => {
  /** Fails if the line is not the brief's words with the count and ids, or has no Checked button. */
  it('shows the brief\'s line and a Checked button', () => {
    const h = html([film()]);
    expect(h).toContain(CHECK_WORDS.film(4, 'N, S, Po, Ar'));
    expect(h).toContain('This film looks unusual overall: 4 points out of keeping (N, S, Po, Ar).');
    expect(buttons(h)).toHaveLength(1);
    expect(buttons(h)[0]).toContain('>Checked<');
  });
  /** Fails if the note calls the listed points wrong (carried item 7). */
  it('never calls its listed points the wrong points', () => { expect(html([film()])).not.toMatch(/wrong|incorrect|error/i); });
  /** Fails if a locked or read-only page offers Checked. */
  it('read-only or locked: the note shows, no button', () => {
    const h = html([film()], false);
    expect(h).toContain('This film looks unusual overall');
    expect(buttons(h)).toHaveLength(0);
  });
  /** Fails if a resolved note still offers Checked. */
  it('a resolved note keeps its line and has no button', () => {
    const h = html([film({ resolved: 'film-checked' })]);
    expect(h).toContain('This film looks unusual overall');
    expect(h).toContain('data-resolved="true"');
    expect(buttons(h)).toHaveLength(0);
  });
  it('nothing read yet or no film flag: no note at all', () => {
    expect(html([])).toBe('');
  });
  /** Fails if pressing Checked does not hand over the flag's id. */
  it('pressing Checked passes the unresolved flag ids', () => {
    const onChecked = vi.fn();
    const root = PointCheckNote({ flags: [film()], canCheck: true, onChecked });
    const [b] = find(root, (e) => e.type === 'button');
    (b.props as { onClick: () => void }).onClick();
    expect(onChecked).toHaveBeenCalledWith([7]);
  });
  /** Two models both looked unusual: the same words once, one press resolves both. */
  it('two models with the same words show one note, and one press covers both', () => {
    const h = html([film({ id: 7 }), film({ id: 8, modelId: 'other-model' })]);
    expect(h.match(/This film looks unusual overall/g)).toHaveLength(1);
    const onChecked = vi.fn();
    const [b] = find(PointCheckNote({ flags: [film({ id: 7 }), film({ id: 8, modelId: 'other-model' })], canCheck: true, onChecked }), (e) => e.type === 'button');
    (b.props as { onClick: () => void }).onClick();
    expect(onChecked).toHaveBeenCalledWith([7, 8]);
  });
});

describe('pressChecked: calls the command for each film flag, then re-reads', () => {
  /** Fails if the command is not called with the case and the check id, or the re-read comes before it. */
  it('calls the command per flag in order, then re-reads once', async () => {
    const calls: string[] = [];
    await pressChecked('case-1', [7, 8], async (c, id) => { calls.push(`cmd ${c} ${id}`); }, async () => { calls.push('reread'); });
    expect(calls).toEqual(['cmd case-1 7', 'cmd case-1 8', 'reread']);
  });
  /** Fails if a refused press (an older run's id) leaves the screen unrefreshed: the note must be re-read either way. */
  it('re-reads even when the command is refused, and does not throw', async () => {
    const reread = vi.fn(async () => {});
    await expect(pressChecked('case-1', [7], async () => { throw new Error('older run'); }, reread)).resolves.toBeUndefined();
    expect(reread).toHaveBeenCalledTimes(1);
  });
});

describe('pressChecked: one try per id (fix round 1, minor 5)', () => {
  /** Fails if a refused first id skips the later ids of the same note (one try around the whole loop). */
  it('a refused id does not stop the next one', async () => {
    const tried: number[] = [];
    await pressChecked('case-1', [7, 8, 9], async (_c, id) => { tried.push(id); if (id === 7) throw new Error('older run'); }, async () => {});
    expect(tried).toEqual([7, 8, 9]);
  });
});

describe('the note box does not take the film\'s pointer (fix round 1, minor 3)', () => {
  /** Fails if the stop sits on the whole box (the box can then no longer be panned or placed through) instead of the button. */
  it('stopPropagation is on the button only', () => {
    const root = PointCheckNote({ flags: [film()], canCheck: true, onChecked: () => {} });
    expect((root!.props as { onPointerDown?: unknown }).onPointerDown).toBeUndefined();
    const [b] = find(root, (e) => e.type === 'button');
    const stop = vi.fn();
    (b.props as { onPointerDown: (e: { stopPropagation: () => void }) => void }).onPointerDown({ stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});

