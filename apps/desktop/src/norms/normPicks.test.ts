import { describe, it, expect } from 'vitest';
import { normPicksKey, parsePicks, readPicks, savePicks, withPick } from './normPicks';

// Owner NORM-PICK-1 (12 Oct): the source the clinician chooses where the case's population has no norm is saved on the
// case — in the library's existing settings table under one key per case (no schema change), as JSON
// { <population>: { <measurement>: <source> } }.
describe('normPicks: the case\'s chosen sources', () => {
  it('one key per case', () => expect(normPicksKey('case-1')).toBe('norm_picks:case-1'));
  it('nothing saved yet: no picks', () => expect(parsePicks(null)).toEqual({}));
  it('a saved value reads back', () => {
    expect(parsePicks('{"chinese":{"m13_Wits":"caucasian"},"saudi":{"m01_SNA":"user:Mine"}}'))
      .toEqual({ chinese: { m13_Wits: 'caucasian' }, saudi: { m01_SNA: 'user:Mine' } });
  });
  it('broken JSON, a non-object, or non-string entries are dropped, never thrown', () => {
    expect(parsePicks('{oops')).toEqual({});
    expect(parsePicks('[1,2]')).toEqual({});
    expect(parsePicks('{"chinese":{"m13_Wits":3,"m01_SNA":"caucasian"},"x":[1],"y":"z"}')).toEqual({ chinese: { m01_SNA: 'caucasian' } });
  });
  it('withPick adds or replaces one pick and leaves the rest', () => {
    const a = withPick({}, 'chinese', 'm13_Wits', 'caucasian');
    const b = withPick(a, 'chinese', 'm01_SNA', 'user:Mine');
    const c = withPick(b, 'chinese', 'm13_Wits', 'analysis-own');
    expect([a, c]).toEqual([{ chinese: { m13_Wits: 'caucasian' } }, { chinese: { m13_Wits: 'analysis-own', m01_SNA: 'user:Mine' } }]);
  });
  it('read: the value, or a sentence when the read fails (never swallowed)', async () => {
    const ok = await readPicks({ get: async (k: string) => (k === 'norm_picks:c1' ? '{"chinese":{"m13_Wits":"caucasian"}}' : null) }, 'c1');
    expect(ok).toEqual({ value: { chinese: { m13_Wits: 'caucasian' } }, error: null });
    const bad = await readPicks({ get: async () => { throw new Error('SYNTHETIC disk error'); } }, 'c1');
    expect(bad).toEqual({ value: {}, error: 'The norms you chose for this case could not be read (SYNTHETIC disk error).' });
  });
  it('save: writes the JSON under the case\'s key; a failed write is a sentence', async () => {
    const seen: [string, string][] = [];
    expect(await savePicks({ set: async (k: string, v: string) => { seen.push([k, v]); } }, 'c1', { chinese: { m13_Wits: 'caucasian' } })).toBeNull();
    expect(seen).toEqual([['norm_picks:c1', '{"chinese":{"m13_Wits":"caucasian"}}']]);
    expect(await savePicks({ set: async () => { throw new Error('SYNTHETIC full'); } }, 'c1', {}))
      .toBe('Your choice of norm could not be saved (SYNTHETIC full).');
  });
});
