import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScaleFineTune } from './ScaleFineTune';

const html = (canDown: boolean, canUp: boolean) => renderToStaticMarkup(<ScaleFineTune t={{ steps: 0, canDown, canUp, onStep: () => {} }} />);
describe('ScaleFineTune (spec 2026-10-19 addendum 3)', () => {
  it('two buttons, − then +, named for a screen reader', () => {
    const h = html(true, true);
    expect(h).toContain('aria-label="Fine-tune the calibration"');
    expect(h.indexOf('aria-label="Scale down 0.5 %"')).toBeLessThan(h.indexOf('aria-label="Scale up 0.5 %"'));
    expect(h).toContain('>−</button>'); expect(h).toContain('>+</button>');
    expect(h).not.toContain('disabled');
  });
  it('each one disabled on its own', () => {
    expect(html(true, false)).toMatch(/aria-label="Scale up 0.5 %"[^>]*disabled=""/);
    expect(html(true, false)).not.toMatch(/aria-label="Scale down 0.5 %"[^>]*disabled=""/);
    expect(html(false, true)).toMatch(/aria-label="Scale down 0.5 %"[^>]*disabled=""/);
  });
});
