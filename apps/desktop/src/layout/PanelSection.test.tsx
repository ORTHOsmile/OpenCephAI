import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PanelSection } from './PanelSection';

// Owner D1/P3 (19 Oct): folded, the PATIENT heading says whose film is open ("PATIENT · L-00002").
const html = (open: boolean, folded?: string) => renderToStaticMarkup(
  <PanelSection title="Patient" collapsible={{ open, onToggle: () => {} }} folded={folded}><p>inside</p></PanelSection>);

describe('PanelSection folded note (owner P3)', () => {
  it('folded: the note follows the title, and the body is hidden', () => {
    const h = html(false, 'L-00002');
    expect(h).toContain('Patient<span class="fold-note"> · L-00002</span>');
    expect(h).not.toContain('inside');
    expect(h).toContain('aria-label="Patient"');                 // the section keeps its plain name
  });
  it('open: no note, the body shows', () => {
    const h = html(true, 'L-00002');
    expect(h).not.toContain('fold-note');
    expect(h).toContain('inside');
  });
  it('no note given: a folded heading is its title alone (Enhance, Text on the film unchanged)', () => {
    expect(html(false)).not.toContain('fold-note');
  });
});
