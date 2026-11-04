import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { initialTracing } from '../tracing/state';
import { Toolbar } from './Toolbar';

// Task 11, owner ruling BUTTON (15 Oct 2026): the greyed-out "Cross-check ›" button's
// tooltip must say the model-disagreement flags are on hold because they could not catch enough errors, and that
// they come back once the owner's own trained model passes the cross-check test — in short plain words, and never
// the literal "⌘" (that character belongs to the keyboard-shortcut tooltips elsewhere on this toolbar, not here).
const html = () => renderToStaticMarkup(
  <Toolbar state={initialTracing} dispatch={() => {}} canEdit={true} title="SYNTHETIC-001" page="tracing"
    onLibrary={() => {}} onPage={() => {}} onCalibrate={() => {}} calibrating={false} />,
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
