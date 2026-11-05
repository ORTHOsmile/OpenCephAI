import { describe, it, expect } from 'vitest';
import { sha256Bytes } from '../export/sha256';
import { fontsFrom, NOTO_SANS } from './fonts';
import { testFonts } from './testFonts';

describe('the embedded PDF font (owner FONT-1)', () => {
  it('is the recorded Noto Sans release, byte for byte, under its open licence', async () => {
    const f = await testFonts();
    expect([sha256Bytes(f.regular), sha256Bytes(f.bold)]).toEqual([NOTO_SANS.sha256.regular, NOTO_SANS.sha256.bold]);
    expect(NOTO_SANS.source).toMatch(/^https:\/\/github\.com\/notofonts\/latin-greek-cyrillic\/releases\//);
    expect(NOTO_SANS.licence).toMatch(/Open Font License 1\.1/);
  });
  it('a changed file is refused', async () => {
    const f = await testFonts(), bad = f.regular.slice();
    bad[100] ^= 1;
    expect(() => fontsFrom(bad, f.bold)).toThrow(/does not match/);
  });
});
