import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadSets, measurementDefinition, normSourcesFor } from '@ceph/analyses';
import { MeasurementDefinitionView } from './MeasurementDefinitionView';

// renderToStaticMarkup HTML-escapes text (e.g. "'" -> "&#x27;"); decode the handful of entities that show up in
// catalogue prose before comparing against the raw strings measurementDefinition()/normSourcesFor() return.
const decode = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');

/** Fix round 1 (review m2): the definition view's text against the catalogue entry itself
 * (`measurementDefinition`/`normSourcesFor`), not fixed strings — so a change to the catalogue's
 * own words, points or source is what this test tracks, not a copy of today's words. */
describe('MeasurementDefinitionView renders what measurementDefinition says, not a fixed copy', () => {
  it('SNA (#1, Steiner): the plain words, every point, and the source line all come from the catalogue entry', () => {
    const d = measurementDefinition('m01_SNA');
    const html = decode(renderToStaticMarkup(<MeasurementDefinitionView id="m01_SNA" sets={[]} />));
    expect(html).toContain(d.what);
    for (const p of d.points) { expect(html).toContain(p.id); expect(html).toContain(p.name); }
    expect(html).toContain(d.cite);
    expect(html).toContain(d.markWords);
  });

  it('#13 Wits: construction notes (AO/BO) appear verbatim', () => {
    const d = measurementDefinition('m13_Wits');
    const html = decode(renderToStaticMarkup(<MeasurementDefinitionView id="m13_Wits" sets={[]} />));
    expect(d.construction.length).toBeGreaterThan(0);   // positive control: this id really has construction notes
    for (const note of d.construction) expect(html).toContain(note);
  });

  it('#34 Saddle: a norm source with a "via" set shows the via text from normSourcesFor, not a fixed string', () => {
    const sets = loadSets();
    const sources = normSourcesFor('m34_Saddle', sets);
    const viaSource = sources.find((s) => s.via);
    expect(viaSource).toBeTruthy();   // the real committed sets must still carry one, or this test proves nothing
    const html = decode(renderToStaticMarkup(<MeasurementDefinitionView id="m34_Saddle" sets={sets} />));
    expect(html).toContain(`via ${viaSource!.via}`);
  });

  it('a measurement with no norm source anywhere (#43) shows no "Norm sources" heading at all (review M1: hidden, not "none")', () => {
    const sets = loadSets();
    const sources = normSourcesFor('m43_SNtoGoMe', sets);
    expect(sources.length).toBe(0);   // positive control: this id really has none, so the assertion below is real
    const html = decode(renderToStaticMarkup(<MeasurementDefinitionView id="m43_SNtoGoMe" sets={sets} />));
    expect(html).not.toContain('Norm sources');
    expect(html).not.toContain('none');
  });
});
