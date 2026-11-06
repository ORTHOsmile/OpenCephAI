import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ALL_ANALYSES, buildRegistry } from '@ceph/analyses';
import { compile } from '@ceph/geometry';
import { initialTracing, tracingReducer as r } from '../tracing/state';
import { Inspector, type SeriesChange } from './Inspector';

// Owner, 5 Nov 2026: the Steps tab is gone from the right panel. Synthetic points only.
const registry = buildRegistry(ALL_ANALYSES), compiled = compile(registry);
const loaded = r(initialTracing, { type: 'load', landmarks: [{ id: 'S', x: 1, y: 1 }, { id: 'N', x: 50, y: 1 }, { id: 'A', x: 50, y: 50 }] });
const html = (o: Partial<Parameters<typeof Inspector>[0]> = {}) => renderToStaticMarkup(
  <Inspector bitmap={null} state={loaded} dispatch={() => {}} defs={ALL_ANALYSES} registry={registry} compiled={compiled} values={{}} scale={{ mmPerPx: 0.1, source: 'calibration', steps: 0 }}
    otherPointsOpen={false} onOtherPoints={() => {}} decimals={1} normFor={null} normsError={null} onCalibrate={() => {}} readOnly={false} found={new Set()} pointTable={null}
    unconfirmedFor={() => []} normQueryFor={null} onPickNorm={null} placedLineFor={() => null} dateFormat="AU" {...o} />);
const tabs = (out: string) => [...out.matchAll(/role="tab"[^>]*>([^<]*)</g)].map((m) => m[1]);

describe('the right panel tabs (owner, 5 Nov 2026)', () => {
  it('Landmarks, Measurements and Chart: no Steps tab', () => {
    expect(tabs(html())).toEqual(['Landmarks', 'Measurements', 'Chart']);
  });
  it('the Superimposition Change tab comes after them, still without Steps', () => {
    const change = { heads: [], ids: [], rows: [], pair: { from: 'a', to: 'b' }, labels: {}, onPair: () => {}, note: null } as SeriesChange;
    expect(tabs(html({ change }))).toEqual(['Landmarks', 'Measurements', 'Chart', 'Change']);
  });
  it('the panel opens on Landmarks, with its list and no guided-steps list', () => {
    const out = html();
    expect(out).toMatch(/aria-selected="true">Landmarks</);
    expect(out).toContain('class="lm-list"');
    expect(out).not.toContain('class="steps"');
  });
  it('no film open: the panel still draws, without Steps and without a "Place them" link', () => {
    const out = html({ state: initialTracing, readOnly: true });
    expect(tabs(out)).toEqual(['Landmarks', 'Measurements', 'Chart']);
    expect(out).not.toContain('Place them');
  });
});
