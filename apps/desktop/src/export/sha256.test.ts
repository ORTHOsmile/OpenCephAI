import { describe, it, expect } from 'vitest';
import { sha256Bytes, sha256Hex } from './sha256';

describe('SHA-256 (FIPS 180-4 test vectors)', () => {
  it('matches the published digests', () => {
    expect(sha256Hex('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Bytes(new Uint8Array([0x61, 0x62, 0x63]))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(sha256Hex('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')).toBe('248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1');
  });
  it('a long input crosses many blocks', () => {
    expect(sha256Hex('a'.repeat(1_000_000))).toBe('cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0');
  });
  it('hashes text as UTF-8', () => {
    expect(sha256Hex('ö')).not.toBe(sha256Hex('o'));
    expect(sha256Hex('ö')).toHaveLength(64);
  });
});
