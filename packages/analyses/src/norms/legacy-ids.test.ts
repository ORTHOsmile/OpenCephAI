import { describe, it, expect } from 'vitest';
import { LEGACY_SET_IDS, canonicalSetId } from './legacy-ids';
import { loadSets } from './load';
import fixture from './fixtures/pre-rename-set-numbers.json';

// Owner, 7 Nov 2026: the five website-sourced sets were renamed. The old ids are built from pieces (this file may not
// spell the old name either: tools/norms/no-website-names.test.ts). The fixture holds the five sets' numbers exactly as
// they stood on main before the rename (measurement, sex, mean, sd, range, n, unit), keyed by the id's last part, so an
// old id that maps to the WRONG set is caught by its numbers, not just by the target existing.
const OLD_PREFIX = ['bc', 'eph'].join('') + '-';
const PARTS = Object.keys(fixture) as (keyof typeof fixture)[];

describe('old set ids still resolve to the same set, with the numbers they had', () => {
  it('the map holds exactly the five pairs', () => {
    expect(Object.keys(LEGACY_SET_IDS).sort()).toEqual(PARTS.map((p) => OLD_PREFIX + p).sort());
    expect(canonicalSetId('steiner1953')).toBe('steiner1953');
    expect(canonicalSetId('onfile-abo')).toBe('onfile-abo');
    expect(canonicalSetId('toString')).toBe('toString'); // not an inherited object key
  });
  it('each old id gives the set whose numbers are the numbers the old set had (34 rows)', () => {
    const sets = loadSets();
    let rows = 0;
    for (const part of PARTS) {
      const s = sets.find((x) => x.id === canonicalSetId(OLD_PREFIX + part));
      expect(s, part).toBeDefined();
      expect(s!.id).toBe('onfile-' + part);
      expect(s!.analyses).toEqual(fixture[part].analyses);
      const now = s!.entries.map((e) => [e.measurement, e.sex, e.mean ?? null, e.sd ?? null, e.range ?? null, e.n ?? null, e.unit]);
      const was = (fixture[part].entries as unknown[][]).map((r) => r.map((v) => (v === undefined ? null : v)));
      expect(now, part).toEqual(was);
      rows += was.length;
    }
    expect(rows).toBe(34);
  });
});
