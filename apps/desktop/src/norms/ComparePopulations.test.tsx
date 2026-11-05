import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { MeasurementRow } from '../measurements';
import { fitMark, scaleOf, type Scale } from '../tracing/spacing';
import { ComparePopulations, scaleNoteOf } from './ComparePopulations';

// Request G, Task 10 pre-flight ruling ("never silently"): with "Use the scale from the fit" on, the compare window's mm
// come from the fit, so it says so above its table. SYNTHETIC values.
const row: MeasurementRow = { analysis: 'Ricketts', analysisId: 'ricketts', normAnalysisId: 'ricketts', node: 'm64_L1APog', label: 'L1 to A–Pog', unit: 'mm', value: '3.0 mm', num: 3, hidden: false, needs: [], undefinedReason: null };
const html = (scaleNote: string | null) => renderToStaticMarkup(
  <ComparePopulations rows={[row]} doc={{ population: null, gender: null, dateOfBirth: null, takenOn: null }} ctx={{ sets: [], userNorms: [], clinicDefault: null }}
    decimals={1 as never} unconfirmedFor={() => []} onClose={() => {}} scaleNote={scaleNote} />);
const fit: Scale = { mmPerPx: 0.1042, source: 'fit', fit: { ref: 'T1', kind: 'sn', k: 1.0417, refAssumed: false } };

describe('Compare populations: the fitted mm are marked (Task 10 ruling)', () => {
  it('the note reads “mm scaled to T1 on S–N (×1.042).” for a fit scale', () => {
    expect(scaleNoteOf(fit)).toBe('mm scaled to T1 on S–N (×1.042).');
    const g3 = { ref: 'T1', kind: 'sn' as const, k: 1.0417, refAssumed: true };
    expect(scaleNoteOf({ mmPerPx: 0.1042, source: 'fit', fit: g3 })).toBe(`mm ${fitMark(g3)}.`);
    expect(scaleNoteOf({ mmPerPx: 0.1042, source: 'fit', fit: g3 })).toBe('mm scaled to T1 on S–N (×1.042), assumed scale.');
  });
  it('no note for a ruler calibration or the assumed scale', () => {
    expect(scaleNoteOf(scaleOf(0.1))).toBeNull();
    expect(scaleNoteOf(scaleOf(null))).toBeNull();
  });
  it('the window shows the note above its table, and none without one', () => {
    expect(html('mm scaled to T1 on S–N (×1.042).')).toContain('<p class="hint fit-note">mm scaled to T1 on S–N (×1.042).</p>');
    expect(html(null)).not.toContain('fit-note');
  });
});
