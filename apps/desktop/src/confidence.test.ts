import { describe, it, expect } from 'vitest';
import { aiLineShown, aiPointColour, AI_LINE, AI_POINT_LABEL } from './confidence';
import conf from '../src-tauri/tauri.conf.json';
describe('AI point appearance', () => {
  // Plan §11: colour by calibrated predicted error, never by a raw network score. Until §11 exists every AI point
  // looks the same. (The HRNet heatmap peak is 8.5–26.8 and correlates with error at ρ = −0.07 on Ceph-400.)
  it('does not depend on the raw heatmap score', () => {
    const colours = [0, 0.5, 1, 8.5, 26.8].map(aiPointColour);
    expect(new Set(colours).size).toBe(1);
  });
  it('is labelled as unverified', () => { expect(AI_POINT_LABEL).toMatch(/unverified/i); });
});
describe('the AI line under the film (spec 2026-10-19 addendum, H)', () => {
  const p = (source: 'ai' | 'ai-adjusted' | 'manual') => ({ source });
  it('keeps its words', () => { expect(AI_LINE).toBe('AI · unverified: clinician review required · not a diagnostic device'); });
  it('shows while a film with AI points is not signed off', () => { expect(aiLineShown({ S: p('ai'), Co: p('manual') }, false)).toBe(true); });
  it('hides once the tracing is signed off, and is back when the sign-off clears', () => {
    expect([aiLineShown({ S: p('ai') }, true), aiLineShown({ S: p('ai') }, false)]).toEqual([false, true]);
  });
  it('a moved AI point is still an AI point', () => { expect(aiLineShown({ S: p('ai-adjusted') }, false)).toBe(true); });
  it('never on a film with no AI points: none at all, or only hand-placed ones', () => {
    expect([aiLineShown({}, false), aiLineShown({ Co: p('manual') }, false)]).toEqual([false, false]);
  });
});
describe('"not a diagnostic device" stays in About (H, decision 10)', () => {
  it('the About panel shows bundle.copyright, which carries it', () => {
    // The owner's credit line (1 Nov 2026) comes first; the research statement stays at the end (version.test.ts pins the whole string).
    expect((conf.bundle as { copyright?: string }).copyright).toMatch(/Research tool — not a diagnostic device\.$/);
  });
});
