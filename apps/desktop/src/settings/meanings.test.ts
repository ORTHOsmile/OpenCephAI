import { describe, it, expect } from 'vitest';
import { DEFAULT_MEANINGS } from '@ceph/analyses';
import { clinicianSteps, meaningsKey, readOverrides, resetOverride, sameClinicianName, saveOverride, settleClinicianSteps, wordsFor, type ClinicianResolution, type Overrides, type SeqGuard } from './meanings';

// Owner MEANING-PER-CLINICIAN (16 Oct 2026): each clinician's own wording, saved on this Mac; none chosen = approved words.
const store = () => { const m = new Map<string, string>(); return { m, get: async (k: string) => m.get(k) ?? null, set: async (k: string, v: string) => { m.set(k, v); } }; };

describe('per-clinician meanings', () => {
  it('the key is per clinician; no clinician has no key', () => {
    expect(meaningsKey('Dr A')).toBe('meanings:Dr A');
    expect(meaningsKey('')).toBeNull();
  });
  it('no override: the approved words; an override replaces only the side that was changed', () => {
    expect(wordsFor('m03_ANB', {})).toEqual({ high: 'Class II', low: 'Class III' });
    expect(wordsFor('m03_ANB', { m03_ANB: { high: 'skeletal Class II' } })).toEqual({ high: 'skeletal Class II', low: 'Class III' });
    expect(wordsFor('m03_ANB', { m03_ANB: { high: '   ' } })).toEqual({ high: 'Class II', low: 'Class III' });   // blank = approved
    expect(wordsFor('nope', {})).toBeUndefined();
  });
  it('two clinicians keep their own words; reset puts the approved word back', async () => {
    const s = store();
    await saveOverride(s, 'Dr A', 'm03_ANB', 'high', 'Class II pattern');
    expect(wordsFor('m03_ANB', await readOverrides(s, 'Dr A'))?.high).toBe('Class II pattern');
    expect(wordsFor('m03_ANB', await readOverrides(s, 'Dr B'))?.high).toBe(DEFAULT_MEANINGS.m03_ANB.high);
    await resetOverride(s, 'Dr A', 'm03_ANB', 'high');
    expect(await readOverrides(s, 'Dr A')).toEqual({});
  });
  it('unreadable stored words or no clinician: no overrides, never an error', async () => {
    const s = store(); s.m.set('meanings:Dr A', '{not json');
    expect(await readOverrides(s, 'Dr A')).toEqual({});
    expect(await readOverrides(s, '')).toEqual({});
    const failing = { get: async () => { throw new Error('no settings'); }, set: async () => {} };
    expect(await readOverrides(failing, 'Dr A')).toEqual({} as Overrides);
  });
  // Review I-2: two changes made close together both survive (each write used to read the stored words first).
  it('two saves started together both stay saved', async () => {
    const s = store(); const slow = { get: async (k: string) => { const v = await s.get(k); await new Promise((r) => setTimeout(r, 5)); return v; }, set: s.set };   // both read before either writes
    await Promise.all([saveOverride(slow, 'Dr A', 'm03_ANB', 'high', 'one'), saveOverride(slow, 'Dr A', 'm01_SNA', 'low', 'two')]);
    expect(await readOverrides(s, 'Dr A')).toEqual({ m03_ANB: { high: 'one' }, m01_SNA: { low: 'two' } });
  });
  // Review M-3: a stored word that is not text is ignored, never a crash.
  it('stored words that are not text are ignored', async () => {
    const s = store(); s.m.set('meanings:Dr A', JSON.stringify({ m03_ANB: { high: 5, low: 'ok' } }));
    expect(wordsFor('m03_ANB', await readOverrides(s, 'Dr A'))).toEqual({ high: 'Class II', low: 'ok' });
  });
});

// NOCLIN-2 (ruling, 17 Oct 2026, item 34): whose MEANING WORDS are used — 1) the clinician chosen in
// the top bar; 2) else the open film's Referring practitioner, if THAT NAME has its own saved words; 3) else the
// Mac login name (NOCLIN-1's only rule). `resolveWords` below drives the exact loop `useMeanings.ts` runs
// (`clinicianSteps` for the candidate order, `settleClinicianSteps` for walking it) — both genuinely shared with
// the hook, not reimplemented here (review fix round 1, I2: the earlier comment claimed this but only
// `clinicianSteps` was actually shared; `settleClinicianSteps` is now exported from meanings.ts and used by both).
describe('NOCLIN-2: which clinician\'s words are in use', () => {
  const resolveWords = async (s: ReturnType<typeof store>, opts: { explicit: string | null; login: string; referrer: string | null; names: string[] }) => {
    const seq: SeqGuard = { current: 1 };
    let settled: ClinicianResolution | null = null;
    await settleClinicianSteps(s, seq, 1, clinicianSteps(opts.explicit, opts.login, opts.referrer, opts.names), (r) => { settled = r; });
    if (!settled) throw new Error('unreachable: the last step always settles');
    return settled as ClinicianResolution;
  };

  it('name matching ignores capitals and extra spaces', () => {
    expect(sameClinicianName('Dr B', 'dr b')).toBe(true);
    expect(sameClinicianName('Dr B', '  dr   b  ')).toBe(true);
    expect(sameClinicianName('Dr B', 'Dr Brown')).toBe(false);
  });

  it('rule 1: a top-bar clinician wins, even with a worded referrer waiting behind it', async () => {
    const s = store();
    await saveOverride(s, 'Dr A', 'm03_ANB', 'high', 'top-bar words');
    await saveOverride(s, 'Dr B', 'm03_ANB', 'high', 'referrer words');
    const r = await resolveWords(s, { explicit: 'Dr A', login: 'Dr A', referrer: 'Dr B', names: ['Dr A', 'Dr B'] });
    expect(r).toEqual({ clinician: 'Dr A', overrides: { m03_ANB: { high: 'top-bar words' } }, fromReferrer: false });
  });

  it('rule 2: no one chosen in the top bar — the open film\'s referrer is used when they have saved words', async () => {
    const s = store();
    await saveOverride(s, 'Dr B', 'm03_ANB', 'high', 'referrer words');
    const r = await resolveWords(s, { explicit: null, login: 'Dr A', referrer: 'Dr B', names: ['Dr A', 'Dr B'] });
    expect(r).toEqual({ clinician: 'Dr B', overrides: { m03_ANB: { high: 'referrer words' } }, fromReferrer: true });
  });

  it('rule 2 matches the referrer ignoring capitals and extra spaces', async () => {
    const s = store();
    await saveOverride(s, 'Dr B', 'm03_ANB', 'high', 'referrer words');
    const r = await resolveWords(s, { explicit: null, login: 'Dr A', referrer: '  dr   b  ', names: ['Dr A', 'Dr B'] });
    expect(r).toEqual({ clinician: 'Dr B', overrides: { m03_ANB: { high: 'referrer words' } }, fromReferrer: true });
  });

  it('a referrer without saved words falls through to the Mac login name (rule 3)', async () => {
    const s = store();
    const r = await resolveWords(s, { explicit: null, login: 'Dr A', referrer: 'Dr B', names: ['Dr A', 'Dr B'] });
    expect(r).toEqual({ clinician: 'Dr A', overrides: {}, fromReferrer: false });
  });

  it('a referrer who is not a known clinician at all falls through the same way', async () => {
    const s = store();
    await saveOverride(s, 'Dr B', 'm03_ANB', 'high', 'referrer words');   // never reached: the name does not match anyone known
    const r = await resolveWords(s, { explicit: null, login: 'Dr A', referrer: 'Someone Else', names: ['Dr A', 'Dr B'] });
    expect(r).toEqual({ clinician: 'Dr A', overrides: {}, fromReferrer: false });
  });

  it('no film open (no referrer): the Mac login name, same as rule 3', async () => {
    const s = store();
    const r = await resolveWords(s, { explicit: null, login: 'Dr A', referrer: null, names: ['Dr A', 'Dr B'] });
    expect(r).toEqual({ clinician: 'Dr A', overrides: {}, fromReferrer: false });
  });

  it('a film with a blank referrer field is treated the same as no film open', async () => {
    const s = store();
    const r = await resolveWords(s, { explicit: null, login: 'Dr A', referrer: '   ', names: ['Dr A', 'Dr B'] });
    expect(r).toEqual({ clinician: 'Dr A', overrides: {}, fromReferrer: false });
  });

  it('switching films updates the words: a referrer with words, then one without', async () => {
    const s = store();
    await saveOverride(s, 'Dr B', 'm03_ANB', 'high', 'referrer words');
    const opts = { explicit: null, login: 'Dr A', names: ['Dr A', 'Dr B'] };
    expect((await resolveWords(s, { ...opts, referrer: 'Dr B' })).fromReferrer).toBe(true);
    expect((await resolveWords(s, { ...opts, referrer: 'Dr C' })).fromReferrer).toBe(false);
  });

  it('closing the film (referrer back to null) falls back to the Mac login name', async () => {
    const s = store();
    await saveOverride(s, 'Dr B', 'm03_ANB', 'high', 'referrer words');
    const opts = { explicit: null, login: 'Dr A', names: ['Dr A', 'Dr B'] };
    const withFilm = await resolveWords(s, { ...opts, referrer: 'Dr B' });
    expect(withFilm).toEqual({ clinician: 'Dr B', overrides: { m03_ANB: { high: 'referrer words' } }, fromReferrer: true });
    const closed = await resolveWords(s, { ...opts, referrer: null });
    expect(closed).toEqual({ clinician: 'Dr A', overrides: {}, fromReferrer: false });
  });

  // Review fix round 1, I2: the one scenario the review was asked to probe — stale-words races on live
  // film-switching — had no test that could fail; `seq`/`token` in `settleClinicianSteps` was read against the
  // code, never exercised. A positive control: this test passed on arrival (the guard already
  // works), so the failure was INDUCED — the `if (seq.current !== token) return;` line in meanings.ts was
  // deleted, this test was run and failed for the right reason (`toEqual` saw both resolves commit, last one
  // 'Dr A' — exactly the stale overwrite the guard exists to stop), then the line was restored and this test
  // passed again. Not left as an "assume it works" comment: watched fail, then watched pass, both for real.
  it('overlapping resolves: a slower, earlier lookup must never overwrite a later one (the seq guard)', async () => {
    // Film A's own words take 30ms to arrive (a slow read); film B's (no override saved) are instant. The film is
    // switched from A to B before A's read returns, so by the time it does, it is stale and must be dropped.
    const delays: Record<string, number> = { 'meanings:Dr A': 30 };
    const s = { get: async (k: string) => { if (delays[k]) await new Promise((r) => setTimeout(r, delays[k])); return null; }, set: async () => {} };
    const seq: SeqGuard = { current: 0 };
    const commits: string[] = [];
    const commit = (r: { clinician: string }) => commits.push(r.clinician);
    const mineA = ++seq.current;
    const pendingA = settleClinicianSteps(s, seq, mineA, [{ clinician: 'Dr A', fromReferrer: false, settleOnEmpty: true }], commit);
    const mineB = ++seq.current;   // the film switched to B before A's slow read above resolves
    const pendingB = settleClinicianSteps(s, seq, mineB, [{ clinician: 'Dr B', fromReferrer: false, settleOnEmpty: true }], commit);
    await Promise.all([pendingA, pendingB]);
    expect(commits).toEqual(['Dr B']);   // never ['Dr B', 'Dr A'] or ['Dr A', 'Dr B'] — A's stale commit must be dropped entirely
  });
});
