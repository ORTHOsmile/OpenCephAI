import { describe, it, expect, vi } from 'vitest';
import type { AutoBestMap, BaseChanged } from '../ipc';
import { baseController } from './useBase';
// Plan 2026-10-29 Task 8; spec §2: the two drop-downs (Models… and Settings › Best model) are one setting. Both read this
// one instance, created once in App; neither keeps a copy. SYNTHETIC maps.
const AZ = 'aariz-cepha29', GU = 'gu2net-isbi19';
const map = (base: string): AutoBestMap => ({ available: true, on: true, base, uses: {}, notes: {}, kept: {}, latest: [] });
const flush = () => new Promise((r) => setTimeout(r, 0));
describe('one base state for both drop-downs', () => {
  it('nothing read yet: no base; then the base the back end reads', async () => {
    const c = baseController({ read: async () => map(AZ), set: async () => ({ from: AZ, to: AZ, events: [] }) }, () => {});
    expect(c.getState().base).toBeNull();
    await c.refresh();
    expect(c.getState().base).toBe(AZ);
  });
  it('a change made through one control is what every reader sees at once', async () => {
    let stored = AZ;
    const onChanged = vi.fn();
    const c = baseController({ read: async () => map(stored), set: async (id) => { const from = stored; stored = id; return { from, to: id, events: [] }; } }, onChanged);
    await c.refresh();
    const models: (string | null)[] = [], settings: (string | null)[] = [];
    c.subscribe(() => models.push(c.getState().base));
    c.subscribe(() => settings.push(c.getState().base));
    await c.choose(GU);
    expect([models.at(-1), settings.at(-1), c.getState().base]).toEqual([GU, GU, GU]);
    expect(c.getState().note).toEqual({ from: AZ, to: GU, events: [] });
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
  it('a refused change leaves the old base and says why; nothing else is re-read', async () => {
    const onChanged = vi.fn();
    const c = baseController({ read: async () => map(AZ), set: async () => { throw new Error('locked'); } }, onChanged);
    await c.refresh();
    await c.choose(GU);
    expect([c.getState().base, c.getState().error, c.getState().note]).toEqual([AZ, 'The base was not changed: Error: locked', null]);
    expect(onChanged).not.toHaveBeenCalled();
  });
  it('the base is never shown as changed before the back end says so', async () => {
    let release: (v: BaseChanged) => void = () => {};
    const c = baseController({ read: async () => map(AZ), set: () => new Promise<BaseChanged>((r) => { release = r; }) }, () => {});
    await c.refresh();
    const pending = c.choose(GU);
    await flush();
    expect(c.getState().base).toBe(AZ);
    release({ from: AZ, to: GU, events: [] });
    await pending;
  });
  it('choosing the base already in force shows no note; a read that fails says so and keeps the last base', async () => {
    let fail = false;
    const c = baseController({ read: async () => { if (fail) throw new Error('gone'); return map(AZ); }, set: async () => ({ from: AZ, to: AZ, events: [] }) }, () => {});
    await c.refresh();
    await c.choose(AZ);
    expect(c.getState().note).toBeNull();
    fail = true;
    await c.refresh();
    expect([c.getState().base, c.getState().error]).toEqual([AZ, "The base model couldn't be read: Error: gone"]);
    c.dismissNote();
  });
  it('a map from an older back end, or none, reads as Aariz', async () => {
    const c = baseController({ read: async () => null, set: async () => ({ from: AZ, to: AZ, events: [] }) }, () => {});
    await c.refresh();
    expect(c.getState().base).toBe(AZ);
  });
});

describe('the error sits beside the control that was used, and a good read clears it (final review M3, M7)', () => {
  it('a refusal from Models… is Models…\'s error, not Settings\'s', async () => {
    const c = baseController({ read: async () => map(AZ), set: async () => { throw new Error('locked'); } }, () => {});
    await c.refresh();
    await c.choose(GU, 'models');
    expect([c.errorFor('models'), c.errorFor('settings')]).toEqual(['The base was not changed: Error: locked', null]);
  });
  it('a failed read leaves the base unread; the next good read (opening Models… or Settings again) clears the error', async () => {
    let fail = true;
    const c = baseController({ read: async () => { if (fail) throw new Error('gone'); return map(GU); }, set: async () => ({ from: AZ, to: AZ, events: [] }) }, () => {});
    await c.refresh();
    expect([c.getState().base, c.errorFor('models'), c.errorFor('settings')]).toEqual([null, "The base model couldn't be read: Error: gone", "The base model couldn't be read: Error: gone"]);
    fail = false;
    await c.refresh();
    expect([c.getState().base, c.errorFor('models'), c.errorFor('settings')]).toEqual([GU, null, null]);
  });
});
