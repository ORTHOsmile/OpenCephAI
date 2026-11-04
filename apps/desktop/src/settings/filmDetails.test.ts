import { describe, expect, it } from 'vitest';
import { readOff, writeOff } from './filmDetails';

describe('Settings › Text on the film (spec 2026-10-17)', () => {
  it('starts with every detail on, and never crashes on a stored value it cannot read', () => {
    for (const raw of [null, '', 'garbage', '{}', '"xraySize"', '["shoe_size"]', '[1, null]']) expect([...readOff(raw)]).toEqual([]);
  });
  it('keeps the known details switched off, in the drop-down order', () => {
    expect([...readOff('["gender", "xraySize", "nope"]')].sort()).toEqual(['gender', 'xraySize']);
    expect(writeOff(new Set(['gender', 'last']))).toBe('["last","gender"]');
    expect([...readOff(writeOff(new Set(['practice'])))]).toEqual(['practice']);
  });
});
