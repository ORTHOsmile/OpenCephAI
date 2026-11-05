import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { unconfirmedAiPointsLine } from '@ceph/analyses';
import type { MeasurementRow } from '../measurements';
import type { NormCell } from './normCell';
import { CompareTable } from './CompareTable';

// The compare dialog's table, pure (no settings reads), so what it shows can be checked directly. SYNTHETIC values.
const row: MeasurementRow = { analysis: 'Ricketts', analysisId: 'ricketts', normAnalysisId: 'ricketts', node: 'm64_L1APog', label: 'L1 to A–Pog', unit: 'mm', value: '3.0 mm', num: 3, hidden: false, needs: [], undefinedReason: null };
const cell = (o: Partial<NormCell> = {}): NormCell => ({ text: '1.0 ± 2.0 mm', band: 'neutral', badges: [], sourceLine: 'Synthetic 2000, p. 1', target: null, hint: null, choose: null, z: null, severity: null, mean: null, sd: null, normMean: null, normSd: null, auto: null, sourceTips: [], flags: [], citation: null, sdDonorCitation: null, normSex: null, normPopulation: null, normAgeRowUsed: null, ...o });
const html = (cells: NormCell[], o: Partial<Parameters<typeof CompareTable>[0]> = {}) => renderToStaticMarkup(
  <CompareTable compared={[{ row, cells }]} ticked={['saudi', 'chinese'].slice(0, cells.length)} labelOf={(id) => (id === 'saudi' ? 'Saudi' : 'Chinese')}
    unconfirmedFor={() => []} {...o} />);

describe('CompareTable', () => {
  // Final review I-2 / ruling: the compare window shows the patient's value, so it carries the same "uses unconfirmed
  // AI points" mark the Measurements tab does, from the one per-row list App computes.
  it('I-2: a measurement using an unconfirmed AI point is marked in the compare window too', () => {
    const out = html([cell()], { unconfirmedFor: (node) => (node === 'm64_L1APog' ? ['Pt', 'Cm'] : []) });
    expect(out).toContain(unconfirmedAiPointsLine(['Pt', 'Cm']));
    expect(html([cell()])).not.toContain('Uses AI points not yet accepted');
  });

  it('M-10: the clinical target is shown, as in the Inspector', () => {
    expect(html([cell({ target: '+1 mm ± 2.5' })])).toContain('clinical target: +1 mm ± 2.5');
  });

  it('AUTO-Q7: a column with no norm of its own shows "—" as plain text; no cell is ever a button', () => {
    const out = html([cell({ text: '—', band: null, sourceLine: 'No Saudi norm for this measurement.' }), cell()]);
    expect(out).toContain('<span class="pop-text">—</span>');
    expect(out).not.toContain('<button');
  });

  it('C1: a cell\'s hover is its source line, then the explanations of the tags kept off the screen', () => {
    const out = html([cell({ sourceLine: 'Steiner 1953', sourceTips: ['SYNTHETIC tip one.', 'SYNTHETIC tip two.'] })]);
    expect(out).toContain('title="Steiner 1953 — SYNTHETIC tip one. SYNTHETIC tip two."');
  });
});
