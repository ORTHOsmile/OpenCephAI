import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { pointDefinition, STILL_TO_CONFIRM_TEXT } from '@ceph/analyses';
import { PointAbout } from './PointAbout';

// Review Minor M2: the e2e covers only S (appendix-defined, confirmed). These exercise the Miyashita path, the
// "kept our own source" path (PTM/PR/U6D, owner ruling DEF-MIYA-1), and the id=null edge case the brief names.

describe('PointAbout', () => {
  it('no active point: renders nothing (brief edge case "no active point")', () => {
    const html = renderToStaticMarkup(<PointAbout id={null} table={null} />);
    expect(html).toBe('');
  });

  it('an id not in the catalogue: renders nothing (defensive — never shown by the real list)', () => {
    const html = renderToStaticMarkup(<PointAbout id="not-a-point" table={null} />);
    expect(html).toBe('');
  });

  it('a Miyashita-defined point (D) shows its text and "…, p. <page>" against the real catalogue entry, not a fixed copy', () => {
    const d = pointDefinition('D');
    expect(d.definitionSource).toMatch(/, p\. \d+$/);   // positive control: D really is Miyashita-sourced
    const html = renderToStaticMarkup(<PointAbout id="D" table={null} />);
    expect(html).toContain(d.definition!);
    expect(html).toContain(d.definitionSource!);
    expect(html).toContain(d.source);
  });

  it('PTM keeps our own source (owner ruling DEF-MIYA-1): "Definition to come." plus its own Source line, no Miyashita page', () => {
    const d = pointDefinition('PTM');
    expect(d.definition).toBeNull();           // positive control: the ruling really left this one undefined
    const html = renderToStaticMarkup(<PointAbout id="PTM" table={null} />);
    expect(html).toContain('Definition to come.');
    expect(html).toContain(d.source);
    expect(html).not.toContain('Definition:');  // no definitionSource line when there is no definition
  });

  it('PR and U6D (the other two DEF-MIYA-1 points) show the same pattern', () => {
    for (const id of ['PR', 'U6D'] as const) {
      const d = pointDefinition(id);
      expect(d.definition).toBeNull();
      const html = renderToStaticMarkup(<PointAbout id={id} table={null} />);
      expect(html).toContain('Definition to come.');
      expect(html).toContain(d.source);
    }
  });

  it('a point still to be confirmed on films (Pt) shows the standing note', () => {
    const d = pointDefinition('Pt');
    expect(d.unconfirmed).toBe(true);   // positive control
    const html = renderToStaticMarkup(<PointAbout id="Pt" table={null} />);
    expect(html).toContain(STILL_TO_CONFIRM_TEXT);
  });

  it('a confirmed point (S) does not show the still-to-confirm note', () => {
    const d = pointDefinition('S');
    expect(d.unconfirmed).toBe(false);   // positive control
    const html = renderToStaticMarkup(<PointAbout id="S" table={null} />);
    expect(html).not.toContain(STILL_TO_CONFIRM_TEXT);
  });
});
