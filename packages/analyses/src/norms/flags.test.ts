import { describe, it, expect } from 'vitest';
import { FLAG_WORDS, SEX_NOT_RECORDED_HINT } from './flags';
import { AGE_NOT_ENTERED_WORDS, NORM_FLAGS } from './resolve';

describe('screen words for every resolver flag', () => {
  it('each flag has a short badge and a hover sentence', () => {
    for (const [flag, w] of Object.entries(FLAG_WORDS)) {
      expect(w.badge.length, flag).toBeGreaterThan(0);
      expect(w.badge.length, flag).toBeLessThanOrEqual(34);
      expect(w.tip, flag).toMatch(/\.$/);
    }
  });
  it('the owner\'s wording for an unstated film scale (M-2)', () => {
    expect(FLAG_WORDS['scale-assumed'].badge).toBe('assumed scale');   // owner, 16 Oct (B)
  });
  it("owner, addendum 2 J (19 Oct 2026): the paper-scale hover says it is the PAPER's X-rays, never the film's", () => {
    expect(FLAG_WORDS['scale-assumed'].tip).toBe('The paper did not say whether its X-rays were enlarged; its mm are taken as true size.');
  });
  it('every flag the resolver can emit (NORM_FLAGS, the list NormFlag is derived from) has words here — no more, no fewer', () => {
    // Review M-1 (fix round 1): one runtime list in resolve.ts, the type derived from it, so this compares two real
    // lists with no source parsing. Induced failure: adding a member to NORM_FLAGS without words turns this red.
    expect(Object.keys(FLAG_WORDS).sort()).toEqual([...NORM_FLAGS].sort());
  });
  it('the owner\'s wording for averaged sexes (SEX-AVG-1) and the one-line hint', () => {
    expect(FLAG_WORDS['sexes-averaged'].tip).toBe('Average of the male and female norms (sex not recorded) — record sex for the exact norm.');
    expect(SEX_NOT_RECORDED_HINT).toBe('Sex not recorded — record it for the exact norm.');
  });
  it('AGE-UNK-1: the age-not-entered words, plus the hint to enter the age', () => {
    // The resolver's own words (AGE_NOT_ENTERED_WORDS), only capitalised for the sentence start — never retyped.
    expect(FLAG_WORDS['age-assumed-adult'].tip.toLowerCase()).toContain(AGE_NOT_ENTERED_WORDS.toLowerCase());
    expect(FLAG_WORDS['age-assumed-adult'].tip).toContain('enter the age for the exact norm');
  });
  // Ruling T4-1 (Task 4 fix round 1): one meaning per flag, so each tip describes the one path that raises it.
  // These words are for owner approval (task-4-report.md, "For owner approval").
  it('T4-1: the borrowed-SD flags speak of the SD, not of the norm', () => {
    for (const f of ['sd-other-age', 'sd-sexes-pooled', 'sd-close', 'sd-converted'] as const) {
      expect(FLAG_WORDS[f].badge, f).toMatch(/^SD /);
      expect(FLAG_WORDS[f].tip, f).toMatch(/^The SD /);
    }
  });
  it('T4-1: no age entered and no usable adult row — says the age was not entered and asks for it; never "the nearest age"', () => {
    const w = FLAG_WORDS['age-unknown-oldest-row'];
    expect(w.tip).toMatch(/^Age not entered/);
    expect(w.tip).toContain('Enter the age for the exact norm.');
    expect(w.tip).not.toMatch(/nearest/);
  });
  it('T4-1: an ideal says whether it is coloured, and each word matches its flag', () => {
    expect(FLAG_WORDS.ideal.tip).toMatch(/Coloured/);
    expect(FLAG_WORDS['ideal-uncoloured'].tip).toMatch(/not coloured/);
    expect(FLAG_WORDS['ideal-uncoloured'].tip).not.toMatch(/Coloured|borrowed SD/);
  });
  it('owner, 16 Oct: no badge says "not coloured" (an uncoloured cell shows it); the ideal one reads just "ideal"', () => {
    expect(FLAG_WORDS['ideal-uncoloured'].badge).toBe('ideal');
    for (const [k, w] of Object.entries(FLAG_WORDS)) expect(w.badge, k).not.toMatch(/coloured/i);
  });
});

