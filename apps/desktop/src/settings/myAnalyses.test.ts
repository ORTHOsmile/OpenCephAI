import { describe, it, expect } from 'vitest';
import { MY_ANALYSIS_WORDS } from '@ceph/analyses';
import { MY_WORDS, deleteMyAnalysis, myAnalysesKey, parseStored, readMyAnalyses, saveMyAnalysis, storedJson } from './myAnalyses';

// Owner B2 (17 Oct 2026): each clinician's own analyses, saved on this Mac under their name, like the meanings.
const store = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } }; };
const A = 'Dr A SYNTHETIC', B = 'Dr B SYNTHETIC';
const sna = [{ id: 'm01_SNA', from: 'steiner' }];

describe('per-clinician "My analysis" storage', () => {
  it('the key is per clinician; no clinician has no key', () => {
    expect(myAnalysesKey(A)).toBe(`my_analyses:${A}`);
    expect(myAnalysesKey('  ')).toBeNull();
  });
  it('nothing stored yet: an empty list, no error', async () => {
    expect(await readMyAnalyses(store(), A)).toEqual({ list: [], error: null });
  });
  it('a new analysis gets a my: id and a trimmed name; two clinicians keep their own', async () => {
    const s = store();
    const saved = await saveMyAnalysis(s, A, { id: null, name: ' NOS clinic ', items: sna });
    expect(saved.id.startsWith('my:')).toBe(true); expect(saved.name).toBe('NOS clinic');
    expect((await readMyAnalyses(s, A)).list).toEqual([saved]);
    expect((await readMyAnalyses(s, B)).list).toEqual([]);
  });
  it('editing keeps the id and the position; the order of measurements is kept', async () => {
    const s = store();
    const one = await saveMyAnalysis(s, A, { id: null, name: 'One', items: sna });
    await saveMyAnalysis(s, A, { id: null, name: 'Two', items: sna });
    const items = [{ id: 'm02_SNB', from: 'steiner' }, { id: 'm01_SNA', from: 'steiner' }];
    await saveMyAnalysis(s, A, { id: one.id, name: 'One renamed', items });
    const { list } = await readMyAnalyses(s, A);
    expect(list.map((a) => a.name)).toEqual(['One renamed', 'Two']);
    expect(list[0]).toEqual({ id: one.id, name: 'One renamed', items });
  });
  it('an empty analysis and a duplicate name are refused, and nothing is written', async () => {
    const s = store();
    await saveMyAnalysis(s, A, { id: null, name: 'NOS clinic', items: sna });
    const before = s.m.get(`my_analyses:${A}`);
    await expect(saveMyAnalysis(s, A, { id: null, name: 'Empty', items: [] })).rejects.toThrow(MY_ANALYSIS_WORDS.empty);
    await expect(saveMyAnalysis(s, A, { id: null, name: 'nos clinic', items: sna })).rejects.toThrow(MY_ANALYSIS_WORDS.taken('NOS clinic'));
    await expect(saveMyAnalysis(s, A, { id: null, name: 'Downs', items: sna })).rejects.toThrow(MY_ANALYSIS_WORDS.taken('Downs'));
    expect(s.m.get(`my_analyses:${A}`)).toBe(before);
  });
  it('a measurement no longer in the catalogue survives a save and a read', async () => {
    const s = store();
    const items = [{ id: 'm99_Gone', from: '' }, ...sna];
    await saveMyAnalysis(s, A, { id: null, name: 'Old', items });
    expect((await readMyAnalyses(s, A)).list[0].items).toEqual(items);
  });
  it('delete removes only that analysis', async () => {
    const s = store();
    const one = await saveMyAnalysis(s, A, { id: null, name: 'One', items: sna });
    await saveMyAnalysis(s, A, { id: null, name: 'Two', items: sna });
    await deleteMyAnalysis(s, A, one.id);
    expect((await readMyAnalyses(s, A)).list.map((a) => a.name)).toEqual(['Two']);
  });
  it('unreadable or newer: the read says so, every write is refused, the stored text is untouched', async () => {
    for (const [raw, words] of [['{not json', MY_WORDS.unreadable], ['{"version":1,"analyses":5}', MY_WORDS.unreadable],
      [JSON.stringify({ version: 2, analyses: [] }), MY_WORDS.newer]] as const) {
      const s = store(); s.m.set(`my_analyses:${A}`, raw);
      expect(await readMyAnalyses(s, A)).toEqual({ list: [], error: words });
      await expect(saveMyAnalysis(s, A, { id: null, name: 'X', items: sna })).rejects.toThrow(words);
      await expect(deleteMyAnalysis(s, A, 'my:x')).rejects.toThrow(words);
      expect(s.m.get(`my_analyses:${A}`)).toBe(raw);
    }
  });
  it('a malformed analysis among good ones is left out; the rest are kept', () => {
    const good = { id: 'my:a', name: 'Good', items: [{ id: 'm01_SNA', from: 'steiner' }, { id: 7 }, { id: 'm02_SNB' }] };
    const r = parseStored(JSON.stringify({ version: 1, analyses: [good, { id: 'nope', name: 'x', items: [] }, { id: 'my:b', name: ' ', items: [] }, { id: 'my:a', name: 'Dup', items: [] }] }));
    expect(r).toEqual({ list: [{ id: 'my:a', name: 'Good', items: [{ id: 'm01_SNA', from: 'steiner' }, { id: 'm02_SNB', from: '' }] }], error: null });
    expect(parseStored(storedJson(r.list))).toEqual(r);   // round trip
  });
  it('no clinician: nothing read, a save refused', async () => {
    const s = store();
    expect(await readMyAnalyses(s, '')).toEqual({ list: [], error: null });
    await expect(saveMyAnalysis(s, '', { id: null, name: 'X', items: sna })).rejects.toThrow(MY_WORDS.noClinician);
    expect(s.m.size).toBe(0);
  });
  it('the settings read failing is reported, never thrown', async () => {
    const failing = { get: async () => { throw new Error('SYNTHETIC no settings'); }, set: async () => {} };
    expect(await readMyAnalyses(failing, A)).toEqual({ list: [], error: 'Your analyses could not be read (SYNTHETIC no settings).' });
  });
  it('two saves started together both stay saved (writes run one after another)', async () => {
    const s = store();
    const slow = { get: async (k: string) => { const v = await s.get(k); await new Promise((r) => setTimeout(r, 5)); return v; }, set: s.set };
    await Promise.all([saveMyAnalysis(slow, A, { id: null, name: 'One', items: sna }), saveMyAnalysis(slow, A, { id: null, name: 'Two', items: sna })]);
    expect((await readMyAnalyses(s, A)).list.map((a) => a.name).sort()).toEqual(['One', 'Two']);
  });
});
