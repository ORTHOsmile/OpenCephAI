import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { FitOwnLine, FitOwnLocked } from './ScaleAdvice';

const note = { ref: 'T1', kind: 'sn' as const, k: 1.04, refAssumed: false };
const line = (on: boolean, n = note) => renderToStaticMarkup(<FitOwnLine timepoint="T2" note={n} on={on} busy={false} onChange={() => {}} />);
describe('FitOwnLine (owner G2)', () => {
  it('off: the fit is for comparisons only, and says which', () => {
    const html = line(false);
    expect(html).toContain('<span>T2 has no ruler. Its fit to T1 is used for comparisons only (scaled to T1 on S–N (×1.040)).</span>');
    expect(html).not.toContain('checked');
    expect(html).toContain('Use the scale from the fit');
  });
  it('on: the owner’s sentence, word for word (G3 adds the reference’s missing ruler)', () => {
    expect(line(true)).toContain('<span>This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1.</span>');
    expect(line(true)).toContain('checked=""');
    expect(line(true, { ...note, refAssumed: true })).toContain('<span>This radiograph had no ruler, so it could not be calibrated; its mm come from scaling it to T1. T1 had no ruler either, so both are on the assumed scale.</span>');
  });
});
describe('FitOwnLocked (a ruler always wins, Task 5 carry; MS-4: so does a machine scale)', () => {
  it('a film with its own ruler is offered no switch, and says why', () => {
    const html = renderToStaticMarkup(<FitOwnLocked />);
    expect(html).toContain('“Use the scale from the fit” is not offered: this film has its own ruler.');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('scale-advice');
  });
  it('MS-4: a machine-scaled film is offered no switch, and says its own reason', () => {
    const html = renderToStaticMarkup(<FitOwnLocked why="machine" />);
    expect(html).toContain('“Use the scale from the fit” is not offered: this film has its machine&#x27;s calibrated scale.');
    expect(html).not.toContain('<input');
  });
});
