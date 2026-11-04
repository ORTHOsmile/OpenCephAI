import { describe, it, expect } from 'vitest';
import { aiPointColour, AI_POINT_LABEL } from './confidence';
describe('AI point appearance', () => {
  // Plan §11: colour by calibrated predicted error, never by a raw network score. Until §11 exists every AI point
  // looks the same. (The HRNet heatmap peak is 8.5–26.8 and correlates with error at ρ = −0.07 on Ceph-400.)
  it('does not depend on the raw heatmap score', () => {
    const colours = [0, 0.5, 1, 8.5, 26.8].map(aiPointColour);
    expect(new Set(colours).size).toBe(1);
  });
  it('is labelled as unverified', () => { expect(AI_POINT_LABEL).toMatch(/unverified/i); });
});
