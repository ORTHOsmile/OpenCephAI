import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { unconfirmedAiPointsLine } from '@ceph/analyses';
import type { MeasurementRow } from '../measurements';
import type { NormCell } from './normCell';
import { CompareTable } from './CompareTable';

// The compare dialog's table, pure (no settings reads), so what it shows can be checked directly. SYNTHETIC values.
const row: MeasurementRow = { analysis: 'Ricketts', analysisId: 'ricketts', normAnalysisId: 'ricketts', node: 'm64_L1APog', label: 'L1 to A–Pog', unit: 'mm', value: '3.0 mm', num: 3, hidden: false, needs: [], undefinedReason: null };
const cell = (o: Partial<NormCell> = {}): NormCell => ({ text: '1.0 ± 2.0 mm', band: 'neutral', badges: [], sourceLine: 'Synthetic 2000, p. 1', target: null, hint: null, choose: null, z: null, severity: null, mean: null, sd: null, ...o });
const html = (cells: NormCell[], o: Partial<Parameters<typeof CompareTable>[0]> = {}) => renderToStaticMarkup(
  <CompareTable compared={[{ row, cells }]} ticked={['saudi', 'chinese'].slice(0, cells.length)} labelOf={(id) => (id === 'saudi' ? 'Saudi' : 'Chinese')}
    unconfirmedFor={() => []} onChoose={null} open={null} renderChooser={() => null} {...o} />);

describe('CompareTable', () => {
  // Final review I-2 / ruling: the compare window shows the patient's value, so it carries the same "uses unconfirmed
  // AI points" mark the Measurements tab does, from the one per-row list App computes.
  it('I-2: a measurement using an unconfirmed AI point is marked in the compare window too', () => {
    const out = html([cell()], { unconfirmedFor: (node) => (node === 'm64_L1APog' ? ['Pt', 'Cm'] : []) });
    expect(out).toContain(unconfirmedAiPointsLine(['Pt', 'Cm']));
    expect(html([cell()])).not.toContain('uses unconfirmed AI points');
  });

  it('M-10: the clinical target is shown, as in the Inspector', () => {
    expect(html([cell({ target: '+1 mm ± 2.5' })])).toContain('clinical target: +1 mm ± 2.5');
  });

  it('NORM-PICK-1: "no <population> norm — choose one" is a button when choosing is allowed, plain text when not', () => {
    const c = cell({ text: 'no Saudi norm — choose one', band: null, sourceLine: '', choose: { population: 'saudi' } });
    expect(html([c], { onChoose: () => {} })).toMatch(/<button[^>]*class="link norm-choose"[^>]*>no Saudi norm — choose one<\/button>/);
    expect(html([c])).not.toContain('<button');
    expect(html([c])).toContain('no Saudi norm — choose one');
  });

  it('NORM-PICK-1: the open chooser is rendered under its own row', () => {
    const c = cell({ text: 'no Saudi norm — choose one', band: null, sourceLine: '', choose: { population: 'saudi' } });
    const out = html([c], { onChoose: () => {}, open: { node: 'm64_L1APog', analysisId: 'ricketts', population: 'saudi' }, renderChooser: () => <div className="SYNTHETIC-chooser" /> });
    expect(out).toContain('SYNTHETIC-chooser');
  });
});
