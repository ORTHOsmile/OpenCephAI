import { describe, it, expect } from 'vitest';
import { parseWords, readWords, reportWordsKey, resetWord, saveWord, shownMeaning, wordKey, WORD_MAX } from './words';

const memory = (init: Record<string, string> = {}, delayMs = 0) => {
  const m = { ...init };
  const wait = () => new Promise((r) => setTimeout(r, delayMs));
  return { m, get: async (k: string) => { await wait(); return m[k] ?? null; }, set: async (k: string, v: string) => { await wait(); m[k] = v; } };
};

describe('per-film report words (owner R2: kept with the film, no library format change)', () => {
  it('lives in the settings table under report_words:<caseId>, one entry per analysis and measurement', () => {
    expect(reportWordsKey('c1')).toBe('report_words:c1');
    expect(wordKey('steiner', 'm03_ANB')).toBe('steiner:m03_ANB');
  });
  it('anything stored that is not { key: { text, was } } is dropped, never thrown; long text is cut', () => {
    expect(parseWords(null)).toEqual({});
    expect(parseWords('not json')).toEqual({});
    expect(parseWords('[1,2]')).toEqual({});
    expect(parseWords(JSON.stringify({ a: { text: 'x' }, b: 'y', c: { text: 'ok', was: 'Mild Class II' }, d: { text: 'z'.repeat(400), was: '' } })))
      .toEqual({ c: { text: 'ok', was: 'Mild Class II' }, d: { text: 'z'.repeat(WORD_MAX), was: '' } });
  });
  it('saves the change with the words it replaced; typing the usual words back removes it; reset removes it', async () => {
    const s = memory();
    await saveWord(s, 'c1', 'steiner:m03_ANB', '  Mild Class II, dental compensation  ', 'Mild Class II');
    expect(JSON.parse(s.m['report_words:c1'])).toEqual({ 'steiner:m03_ANB': { text: 'Mild Class II, dental compensation', was: 'Mild Class II' } });
    await saveWord(s, 'c1', 'steiner:m03_ANB', 'Mild Class II', 'Mild Class II');
    expect(JSON.parse(s.m['report_words:c1'])).toEqual({});
    await saveWord(s, 'c1', 'downs:m04_FacialAngle', '', 'Within normal range');   // a deliberate blank is kept
    expect(JSON.parse(s.m['report_words:c1'])['downs:m04_FacialAngle']).toEqual({ text: '', was: 'Within normal range' });
    await resetWord(s, 'c1', 'downs:m04_FacialAngle');
    expect(JSON.parse(s.m['report_words:c1'])).toEqual({});
  });
  it('two changes made close together both land (each reads, changes and writes in turn)', async () => {
    const s = memory({}, 5);
    await Promise.all([saveWord(s, 'c1', 'a:1', 'one', 'x'), saveWord(s, 'c1', 'b:2', 'two', 'y')]);
    expect(Object.keys(JSON.parse(s.m['report_words:c1'])).sort()).toEqual(['a:1', 'b:2']);
  });
  it('a failed read shows the usual words and says why', async () => {
    const r = await readWords({ get: async () => { throw new Error('SYNTHETIC locked'); } }, 'c1');
    expect(r.value).toEqual({});
    expect(r.error).toMatch(/could not be read.*SYNTHETIC locked/);
  });
});

describe('what the report prints for a row', () => {
  it('the usual words when nothing was changed', () => {
    expect(shownMeaning('Mild Class II', undefined)).toEqual({ text: 'Mild Class II', edited: false, stale: null });
  });
  it("the clinician's words while the row still reads what they replaced", () => {
    expect(shownMeaning('Mild Class II', { text: 'compensated', was: 'Mild Class II' })).toEqual({ text: 'compensated', edited: true, stale: null });
    expect(shownMeaning('Within normal range', { text: '', was: 'Within normal range' })).toEqual({ text: '', edited: true, stale: null });
  });
  it('once the row reads differently, the usual words, with the old change offered back', () => {
    const old = { text: 'compensated', was: 'Mild Class II' };
    expect(shownMeaning('Severe Class II', old)).toEqual({ text: 'Severe Class II', edited: false, stale: old });
  });
});
