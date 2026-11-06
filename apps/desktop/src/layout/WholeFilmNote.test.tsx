import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactElement } from 'react';
import { WholeFilmNote } from './WholeFilmNote';
import { CephCanvas } from '../canvas/CephCanvas';
import { initialTracing } from '../tracing/state';
import { ALL_ANALYSES, buildRegistry } from '@ceph/analyses';
import { WHOLE_WORDS } from '../points/wholeFilm';
import type { WholeCheckView } from '../ipc';

// SC-1 Part 1 task 8: the whole-film note. SYNTHETIC ids only. Hook-free like PointCheckNote, so a press is read off the tree.
const flagged = (over: Partial<WholeCheckView> = {}): WholeCheckView => ({ id: 5, subject: 'run', modelId: 'SYNTHETIC-m', outcome: 'flagged', shapeLook: 'judged', regionLook: 'judged',
  present: 19, reasons: [{ reason: 'region', region: 'mandible', ids: ['Me', 'Gn', 'Pog'], named: [], factor: null }], resolved: null, sizeLook: 'judged', cbLook: 'judged', cbPresent: 5, ...over });
const html = (check: WholeCheckView | null, canCheck = true, asking = false) =>
  renderToStaticMarkup(<WholeFilmNote check={check} canCheck={canCheck} asking={asking} onAsk={() => {}} onResolve={() => {}} />);
const buttons = (h: string) => h.match(/<button[^>]*>[^<]*<\/button>/g) ?? [];
function find(el: unknown, pred: (e: ReactElement) => boolean, out: ReactElement[] = []): ReactElement[] {
  if (Array.isArray(el)) { el.forEach((c) => find(c, pred, out)); return out; }
  if (el && typeof el === 'object' && 'props' in (el as ReactElement)) {
    const e = el as ReactElement;
    if (pred(e)) out.push(e);
    find((e.props as { children?: unknown }).children, pred, out);
  }
  return out;
}

describe('WholeFilmNote', () => {
  /** Fails if the lines, the hover in `title`, or the single Checked button are missing. */
  it('a flagged check shows its line, the hover words, and exactly one Checked button', () => {
    const h = html(flagged());
    expect(h).toContain(WHOLE_WORDS.region('mandible', 'Me, Gn, Pog'));
    expect(h).toContain(`title="${WHOLE_WORDS.hover}"`);
    expect(buttons(h)).toHaveLength(1);
    expect(buttons(h)[0]).toContain('>Checked<');
  });
  /** Fails if the note is drawn when there is no shown check (nothing read yet), or for a clean judged check. */
  it('nothing read yet, or a clean judged check: no note at all', () => {
    expect(html(null)).toBe('');
    expect(html(flagged({ outcome: 'clean', reasons: [] }))).toBe('');
  });
  /** Fails if pressing Checked does not ask (onAsk) for the reason in the page. */
  it('pressing Checked asks, with the check id', () => {
    const onAsk = vi.fn();
    const root = WholeFilmNote({ check: flagged(), canCheck: true, asking: false, onAsk, onResolve: () => {} });
    const [b] = find(root, (e) => e.type === 'button');
    (b.props as { onClick: () => void }).onClick();
    expect(onAsk).toHaveBeenCalledWith(5);
  });
  /** Fails if asking does not show exactly the three reason buttons with the plan's words and no other (no Checked, no cancel). */
  it('asking: exactly three buttons, the three reasons', () => {
    const h = html(flagged(), true, true);
    const b = buttons(h);
    expect(b).toHaveLength(3);
    expect(b.map((x) => x.replace(/<[^>]*>/g, ''))).toEqual(['Tracing is right', 'Expected variant (cleft, syndrome, surgery)', 'I corrected the tracing']);
  });
  /** Fails if the pressed reason is not handed over with the check id as the stored key. */
  it('pressing a reason calls onResolve(id, key)', () => {
    const onResolve = vi.fn();
    const root = WholeFilmNote({ check: flagged(), canCheck: true, asking: true, onAsk: () => {}, onResolve });
    const btns = find(root, (e) => e.type === 'button');
    const v = btns.find((x) => (x.props as { children?: unknown }).children === 'Expected variant (cleft, syndrome, surgery)')!;
    (v.props as { onClick: () => void }).onClick();
    expect(onResolve).toHaveBeenCalledWith(5, 'expected-variant');
  });
  /** Fails if a resolved check shows no resolution words, or still offers a button. */
  it('a resolved check shows "Checked: <reason>" and no button', () => {
    const h = html(flagged({ resolved: { reason: 'expected-variant', operator: 'SYNTHETIC-op', resolvedAt: '2026-11-03T00:00:00Z' } }), true, true);
    expect(h).toContain('Checked: Expected variant (cleft, syndrome, surgery)');
    expect(h).toContain(WHOLE_WORDS.region('mandible', 'Me, Gn, Pog'));
    expect(buttons(h)).toHaveLength(0);
  });
  /** Fails if a read-only page (canCheck false) offers a button, or drops the lines. */
  it('canCheck false (a read-only page): the note shows, no button', () => {
    const h = html(flagged(), false);
    expect(h).toContain('Whole-film check: the mandible points');
    expect(buttons(h)).toHaveLength(0);
    expect(buttons(html(flagged(), false, true))).toHaveLength(0);
  });
  /** Fails if a not-run or regions-not-checked note offers Checked (the back end refuses it: only a flagged check is checked). */
  it('a not-run or regions-not-checked note has its line and no button', () => {
    const h = html(flagged({ outcome: 'not-run', shapeLook: 'too-few-points', reasons: [], present: 9 }));
    expect(h).toContain(WHOLE_WORDS.tooFew(9));
    expect(buttons(h)).toHaveLength(0);
    const g = html(flagged({ outcome: 'clean', regionLook: 'no-region-model', reasons: [] }));
    expect(g).toContain(WHOLE_WORDS.regionsOff['no-region-model']);
    expect(buttons(g)).toHaveLength(0);
  });
  /** Fix round 1 (I1). Fails if the note's lines take the pointer (a stop or a title on them): a press on the text must reach the stage,
   *  as Stage A's note does. Only the "?" marker and the buttons take it. */
  it('the box and its lines let the film have the pointer; only the ? marker and the buttons stop it', () => {
    const root = WholeFilmNote({ check: flagged(), canCheck: true, asking: false, onAsk: () => {}, onResolve: () => {} })!;
    expect((root.props as { onPointerDown?: unknown }).onPointerDown).toBeUndefined();
    const lineSpans = find(root, (e) => e.type === 'span' && (e.props as { className?: string }).className !== 'whole-film-hover');
    expect(lineSpans.length).toBeGreaterThan(0);
    for (const sp of lineSpans) { expect((sp.props as { onPointerDown?: unknown }).onPointerDown).toBeUndefined(); expect((sp.props as { title?: unknown }).title).toBeUndefined(); }
    const [marker] = find(root, (e) => e.type === 'span' && (e.props as { className?: string }).className === 'whole-film-hover');
    expect((marker.props as { title: string }).title).toBe(WHOLE_WORDS.hover);
    const stop = vi.fn();
    (marker.props as { onPointerDown: (e: { stopPropagation: () => void }) => void }).onPointerDown({ stopPropagation: stop });
    const [b] = find(root, (e) => e.type === 'button');
    (b.props as { onPointerDown: (e: { stopPropagation: () => void }) => void }).onPointerDown({ stopPropagation: stop });
    expect(stop).toHaveBeenCalledTimes(2);
  });
  /** Fix round 1 (I1). Fails if the hover words are not on a "?" marker at the end of the note. */
  it('the hover is on a ? marker after the lines', () => {
    const h = html(flagged());
    expect(h).toMatch(/<span class="whole-film-hover" title="A note, not a verdict[^"]*"[^>]*>\?<\/span>/);
  });
  /** Fix round 1 (M1). Fails if a flagged check with no reasons makes the note vanish or loses Checked; also warns once in the console. */
  it('flagged with no stored reasons: Checked is still offered, no words, a console warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const h = html(flagged({ reasons: [] }));
    expect(buttons(h)).toHaveLength(1);
    expect(buttons(h)[0]).toContain('>Checked<');
    expect(h).not.toContain('Whole-film check');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
  /** Fix round 1 (M3). Fails if a flagged check with no region finder drops the regions-not-checked line from the note. */
  it('flagged with no region finder: both the reason and the regions-not-checked line, one Checked', () => {
    const h = html(flagged({ regionLook: 'no-region-model', reasons: [{ reason: 'mirrored', region: null, ids: [], named: [] }] }));
    expect(h).toContain(WHOLE_WORDS.mirrored);
    expect(h).toContain(WHOLE_WORDS.regionsOff['no-region-model']);
    expect(buttons(h)).toHaveLength(1);
  });
});

describe('the canvas branch: what it hands the note as canCheck', () => {
  const canvas = (extra: Record<string, unknown>) => renderToStaticMarkup(
    <CephCanvas bitmap={null} state={initialTracing} dispatch={() => {}} view={null} setView={() => {}} registry={buildRegistry(ALL_ANALYSES)} mmPerPx={0.1} assumedScale={false} readOnly={false} calib={null} onCalibrationClick={() => {}}
      wholeCheck={flagged()} canCheckWhole onWholeResolve={() => {}} {...extra} />);
  /** Fails if the canvas hides Checked on a signed-off film: it must pass `!readOnly`, never `!signedOff` / `!locked` (OQ-6). */
  it('a signed-off film (locked) that is not read-only keeps the Checked button', () => {
    const h = canvas({ signedOff: true, readOnly: false });
    expect(h).toContain('Whole-film check: the mandible points');
    expect(buttons(h)).toHaveLength(1);
    expect(buttons(h)[0]).toContain('>Checked<');
  });
  /** Fails if a read-only page (another operator's film, Recently deleted, Superimposition) offers Checked. */
  it('a read-only page shows the note and no button', () => {
    const h = canvas({ readOnly: true });
    expect(h).toContain('Whole-film check: the mandible points');
    expect(buttons(h)).toHaveLength(0);
  });
  /** Fails if the note is drawn when the page has no shown check. */
  it('no shown check: no note on the canvas', () => { expect(canvas({ wholeCheck: null })).not.toContain('whole-film-note'); });
  /** Fails if Stage A's film note loses its own rule (it stays hidden when signed off: canCheck false) beside the SC-1 note. */
  it('Stage A\'s film note beside it keeps its own rule: no button when its page says no', () => {
    const film = [{ id: 7, modelId: 'SYNTHETIC-m', landmarkId: null, action: 'film-unusual' as const, points: 'N,S,B,Me', offPx: null, expectedX: null, expectedY: null, ring: null, resolved: null }];
    const h = canvas({ filmChecks: film, canCheck: false, onFilmChecked: () => {}, signedOff: true });
    expect(h).toContain('This film looks unusual overall');
    expect(buttons(h)).toHaveLength(1);   // only the SC-1 note's
    const h2 = canvas({ filmChecks: film, canCheck: true, onFilmChecked: () => {} });
    expect(buttons(h2)).toHaveLength(2);
  });
});

// SC-1 Part 1b Task D2.
describe('WholeFilmNote: the size line and the switch', () => {
  /** Fails if the size line is not drawn, or the note still offers Checked for a size flag. */
  it('a size flag shows its line and one Checked button', () => {
    const h = html(flagged({ reasons: [{ reason: 'size', region: null, ids: [], named: [], factor: 0.5 }] }));
    expect(h).toContain('this tracing is about ×0.5 the size of the anatomy on this film. Look at the whole tracing.');
    expect(buttons(h).filter((b) => b.includes('>Checked<'))).toHaveLength(1);
  });
  /** Fails if a nothing-shown note (the switch off hands the note null) draws anything. */
  it('off: nothing shown, no note', () => { expect(html(null)).toBe(''); });
});
