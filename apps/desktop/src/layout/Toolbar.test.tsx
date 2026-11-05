import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialTracing } from '../tracing/state';
import { Toolbar } from './Toolbar';

// Task 11, owner ruling BUTTON (15 Oct 2026): the greyed-out "Cross-check ›" button's
// tooltip must say the model-disagreement flags are on hold because they could not catch enough errors, and that
// they come back once the owner's own trained model passes the cross-check test — in short plain words, and never
// the literal "⌘" (that character belongs to the keyboard-shortcut tooltips elsewhere on this toolbar, not here).
// preflight-rulings Task 8, Minor: a default so the three existing tests keep calling html().
const html = (canExport = true, rulerPending = false) => renderToStaticMarkup(
  <Toolbar state={initialTracing} dispatch={() => {}} canEdit={true} title="SYNTHETIC-001" page="tracing"
    onLibrary={() => {}} onPage={() => {}} onCalibrate={() => {}} calibrating={false} onExport={() => {}} canExport={canExport} rulerPending={rulerPending} />,
);
// A tracing with one past snapshot, so the Undo button would otherwise be enabled.
const withPast = { ...initialTracing, past: [{ points: {}, orientation: initialTracing.orientation, ruler: null }] };
const htmlWithPast = (rulerPending: boolean) => renderToStaticMarkup(
  <Toolbar state={withPast} dispatch={() => {}} canEdit={true} title="SYNTHETIC-001" page="tracing"
    onLibrary={() => {}} onPage={() => {}} onCalibrate={() => {}} calibrating={false} onExport={() => {}} canExport={true} rulerPending={rulerPending} />,
);

describe('Toolbar ▸ Cross-check button tooltip (owner ruling BUTTON, 15 Oct 2026)', () => {
  it('says the flags are on hold and why, in place of "Arrives with the cross-check"', () => {
    const out = html();
    const navButton = out.match(/<button type="button" disabled="" title="([^"]*)">Cross-check ›<\/button>/);
    expect(navButton).not.toBeNull();
    expect(navButton![1]).not.toBe('Arrives with the cross-check');
    expect(navButton![1]).toContain('On hold: model-disagreement flags could not catch enough errors.');
    expect(navButton![1]).toContain('They return once your own trained model passes the cross-check test.');
  });

  it('never contains the literal "⌘" (this is a status note, not a keyboard-shortcut hint)', () => {
    const out = html();
    const button = out.match(/<button type="button" disabled="" title="([^"]*)">Cross-check ›<\/button>/);
    expect(button).not.toBeNull();
    expect(button![1]).not.toContain('⌘');
  });

  it('leaves the older "Model B" tool button\'s own title untouched (a different, older feature)', () => {
    const out = html();
    expect(out).toContain('title="Arrives with the cross-check"');
    expect(out).toContain('>Model B</button>');
  });
});

describe('Toolbar ▸ Undo (final review m-1)', () => {
  it('is enabled with a past snapshot and no ruler store pending', () => {
    expect(htmlWithPast(false)).toMatch(/<button type="button" class="tool" title="Undo \(⌘Z\)">Undo<\/button>/);
  });
  it('is disabled while a ruler store is pending, even with a past snapshot', () => {
    expect(htmlWithPast(true)).toMatch(/<button type="button" class="tool" disabled="" title="Undo \(⌘Z\)">Undo<\/button>/);
  });
});

describe('Toolbar ▸ Export › (spec 2026-10-17 report-exports)', () => {
  it('opens the report when a film is open on the Tracing page', () => {
    const out = html(true);
    expect(out).toMatch(/<button type="button" class="primary" title="Report and CSV for this film">Export ›<\/button>/);
  });
  it('is greyed with a reason otherwise (no film, or the Superimposition page)', () => {
    expect(html(false)).toMatch(/<button type="button" class="primary" disabled="" title="Open a film on the Tracing page to make its report">Export ›<\/button>/);
  });
});
