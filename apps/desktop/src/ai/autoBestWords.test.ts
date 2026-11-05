import { describe, it, expect } from 'vitest';
import { autoBestWhat, baseChangedWords, decidedOn, introWords, needsBaseWords, NO_MODEL, noteWords, reasonWords, recentWords, usesSummary, wayBackWords } from './autoBestWords';
import { event } from './autoBestFixtures';
const SR = 'srpose-cldet23', GU = 'gu2net-isbi19';
const titleOf = (m: string) => m;
describe('Automatic best words (spec §2, §6a)', () => {
  it('the summary: nothing yet; one point; several points by two models', () => {
    expect(usesSummary({ uses: {} }, 'Aariz', titleOf)).toBe('Uses Aariz for all 19 points: no point has enough evidence yet.');
    expect(usesSummary({ uses: { Go: SR } }, 'Aariz', titleOf)).toBe('Uses SRPose for Go; Aariz for the other 18 points.');
    expect(usesSummary({ uses: { Go: SR, B: SR, PNS: GU } }, 'GU2Net', titleOf)).toBe('Uses SRPose for B and Go, GU2Net for PNS; GU2Net for the other 16 points.');
  });
  it('the films that decided, in the note’s words', () => {
    expect([decidedOn('mm, 60 ruler films'), decidedOn('mm via machine scale, 60 films'), decidedOn('mm via assumed scale (an estimate), 60 films'), decidedOn('odd')])
      .toEqual(['60 ruler films', '60 films (machine scale)', '60 films (assumed scale (an estimate))', 'odd']);
  });
  it('why a model was dropped', () => {
    expect([reasonWords('file-changed', 'SRPose'), reasonWords('not-installed', 'SRPose'), reasonWords('evidence', 'SRPose')])
      .toEqual(["SRPose's file changed, so its evidence starts afresh", 'SRPose is no longer installed', 'the evidence no longer favours SRPose']);
  });
  it('Recent changes, one line each', () => {
    expect(recentWords(event(), titleOf, 'AU')).toBe('Gonion (Go): SRPose since 27/10/2026, decided on 60 ruler films.');
    expect(recentWords(event({ kind: 'undone', uses: null }), titleOf, 'AU')).toBe('Gonion (Go): you kept Aariz on 27/10/2026; SRPose again only when newer films show it closer.');
    expect(recentWords(event({ kind: 'returned', uses: null, basis: null, reason: 'file-changed' }), titleOf, 'AU'))
      .toBe("Gonion (Go): back to Aariz on 27/10/2026 — SRPose's file changed, so its evidence starts afresh.");
  });
});
describe('the notes (spec §6a, §6b)', () => {
  it('adopted and returned', () => {
    expect(noteWords(event(), (m) => m)).toBe('Automatic best: Gonion now from SRPose, decided on 60 ruler films.');
    expect(noteWords(event({ kind: 'returned', uses: null, basis: null, reason: 'file-changed' }), (m) => m))
      .toBe("Automatic best: Gonion back to Aariz — SRPose's file changed, so its evidence starts afresh.");
  });
  it('the upgrade note and its way back', () => {
    expect(introWords({ before: 'gu2net-isbi19', keptDeclines: 0 })).toBe('Automatic best now starts your tracings. It uses Aariz, except where your own verified films show another model is closer. Nothing is approved for you.');
    expect(introWords({ before: null, keptDeclines: 2 })).toContain(' Your Part F declines are kept.');
    expect([wayBackWords({ before: 'gu2net-isbi19', keptDeclines: 0 }, (m) => m), wayBackWords({ before: null, keptDeclines: 0 }, (m) => m)])
      .toEqual(['Go back to GU2Net', 'Go back to Aariz']);
  });
});

describe('the words name the base (plan 2026-10-29 Task 6)', () => {
  const T = (m: string) => m;
  const AZ = 'aariz-cepha29';
  it('Needs, no model, and what Automatic best does', () => {
    expect(needsBaseWords('GU2Net')).toBe('Needs GU2Net, the base model: install it, or choose another base in Settings › Best model.');
    expect(NO_MODEL).toBe('No model is installed yet: install one below.');
    expect(autoBestWhat('GU2Net')).toContain('GU2Net where no model has been shown closer yet');
  });
  it('Recent changes and notes say back to the base', () => {
    const gb = { base: 'gu2net-isbi19' };
    expect(recentWords(event({ kind: 'returned', uses: null, basis: null, reason: 'evidence', numbers: gb }), T, 'AU'))
      .toBe('Gonion (Go): back to GU2Net on 27/10/2026 — the evidence no longer favours SRPose.');
    expect(recentWords(event({ kind: 'undone', uses: null, numbers: gb }), T, 'AU')).toContain('you kept GU2Net on');
    expect(noteWords(event({ kind: 'returned', uses: null, reason: 'evidence', numbers: { ...gb, cause: 'base-changed' } }), T))
      .toBe('Automatic best: Gonion back to GU2Net — the base model changed, so it is judged again against GU2Net.');
    expect(recentWords(event({ kind: 'returned', uses: null, reason: 'evidence', numbers: { ...gb, cause: 'base-changed' } }), T, 'AU'))
      .toBe('Gonion (Go): back to GU2Net on 27/10/2026 — the base model changed, so it is judged again against GU2Net.');
  });
  it('a row from 0.8.0 (no numbers) keeps the old wording, no crash', () => {
    expect(noteWords(event({ kind: 'returned', uses: null, reason: 'evidence', numbers: null }), T)).toBe('Automatic best: Gonion back to Aariz — the evidence no longer favours SRPose.');
    expect(noteWords(event({ kind: 'returned', uses: null, reason: 'evidence', numbers: {} }), T)).toBe('Automatic best: Gonion back to Aariz — the evidence no longer favours SRPose.');
  });
  it('the base-change note lists the points that left a model, and says nothing more when none did', () => {
    const ret = (p: string) => event({ landmarkId: p, kind: 'returned', uses: null, reason: 'evidence', numbers: { cause: 'base-changed' } });
    expect(baseChangedWords({ from: AZ, to: 'gu2net-isbi19', events: [ret('Go')] }, T))
      .toBe('Base model is now GU2Net: every point starts from GU2Net. Go no longer uses SRPose: it was judged against Aariz.');
    expect(baseChangedWords({ from: AZ, to: 'gu2net-isbi19', events: [ret('Go'), ret('B')] }, T))
      .toBe('Base model is now GU2Net: every point starts from GU2Net. B and Go no longer use SRPose: they were judged against Aariz.');
    expect(baseChangedWords({ from: AZ, to: 'gu2net-isbi19', events: [] }, T)).toBe('Base model is now GU2Net: every point starts from GU2Net.');
    expect(baseChangedWords({ from: 'gu2net-isbi19', to: AZ, events: [event({ landmarkId: 'Go', numbers: { cause: 'base-changed' } })] }, T))
      .toBe('Base model is now Aariz: every point starts from Aariz. Go uses SRPose again.');
  });
});

describe('a row names the base it was written under (final review I2, M8)', () => {
  const T = (m: string) => m;
  it('rows from before best-point/4 (no numbers.base) are Aariz\'s, even when GU2Net is the base now', () => {
    expect(recentWords(event({ kind: 'returned', uses: null, reason: 'evidence', numbers: {} }), T, 'AU')).toContain('back to Aariz');
    expect(recentWords(event({ kind: 'undone', uses: null, numbers: null }), T, 'AU')).toContain('you kept Aariz on');
    expect(noteWords(event({ kind: 'returned', uses: null, reason: 'evidence', numbers: {} }), T)).toContain('back to Aariz');
  });
});
