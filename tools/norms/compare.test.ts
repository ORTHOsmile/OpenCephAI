import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareSets, localIsoDate, plantTypo, selfTest } from './compare.ts';

const set = () => ({
  id: 'synthetic2026',
  population: { id: 'chinese' },
  sample: { n: 60 },
  citation: { year: 2026 },
  curation: { extractedBy: ['a'] },
  entries: [
    { measurement: 'm01_SNA', sex: 'pooled', mean: 82.1, sd: 3.5, unit: 'deg', source: 'Table 2, p. 4', definitionMatch: 'same' },
    { measurement: 'm02_SNB', sex: 'pooled', mean: 79.4, sd: 3.2, unit: 'deg', source: 'Table 2, p. 4', definitionMatch: 'same' },
  ],
});

test('identical copies agree', () => assert.deepEqual(compareSets(set(), set()), []));

test('entry order does not matter', () => {
  const b = set();
  b.entries.reverse();
  assert.deepEqual(compareSets(set(), b), []);
});

test('a one-digit change in a mean is caught and located', () => {
  const b = set();
  b.entries[1].mean = 79.7;
  const d = compareSets(set(), b);
  assert.equal(d.length, 1);
  assert.match(d[0].where, /m02_SNB/);
  assert.match(d[0].where, /mean/);
});

test('a lost minus sign is caught', () => {
  const a = set();
  const b = set();
  a.entries[0].mean = -1;
  b.entries[0].mean = 1;
  assert.equal(compareSets(a, b).length, 1);
});

test('a missing entry is caught', () => {
  const b = set();
  b.entries.pop();
  assert.equal(compareSets(set(), b).length, 1);
});

test('a different definitionMatch is caught', () => {
  const b = set();
  b.entries[0].definitionMatch = 'close';
  assert.equal(compareSets(set(), b).length, 1);
});

test('plantTypo changes exactly one digit of one number and says where', () => {
  const { set: t, where } = plantTypo(set(), 1);
  const d = compareSets(set(), t);
  assert.equal(d.length, 1);
  assert.equal(d[0].where, where);
});

test('selfTest passes on a real set and would fail if compare saw nothing', () => assert.equal(selfTest(set()), true));

// --- edge cases ---

test('sd present in one file, absent in the other, is caught', () => {
  const a = set();
  const b = set();
  delete (b.entries[0] as any).sd;
  const d = compareSets(a, b);
  assert.equal(d.length, 1);
  assert.match(d[0].where, /m01_SNA/);
  assert.match(d[0].where, /sd/);
});

test('a duplicate key inside one file is reported as a difference', () => {
  const a = set();
  const b = set();
  // Duplicate the SNA entry in a (same measurement/sex/ageBand twice).
  a.entries.push({ ...a.entries[0] });
  const d = compareSets(a, b);
  assert.equal(d.length, 1);
  assert.match(d[0].where, /duplicate/i);
  assert.match(d[0].where, /m01_SNA/);
});

test('empty entries arrays agree when everything else matches', () => {
  const a = { ...set(), entries: [] };
  const b = { ...set(), entries: [] };
  assert.deepEqual(compareSets(a, b), []);
});

test('selfTest fails (and does not throw) on a set with no numeric values to plant into', () => {
  const noNumbers = { ...set(), entries: [] };
  assert.equal(selfTest(noNumbers), false);
});

test('plantTypo returns undefined on a set with no numeric values', () => {
  const noNumbers = { ...set(), entries: [] };
  assert.equal(plantTypo(noNumbers, 1), undefined);
});

// --- CLI ---

const here = path.dirname(fileURLToPath(import.meta.url));
const cliPath = path.join(here, 'compare.ts');

function writeTmpJson(name: string, obj: unknown): string {
  const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'norms-compare-')), name);
  fs.writeFileSync(p, JSON.stringify(obj));
  return p;
}

test('the CLI exits 0 on agreement, 1 on a mismatch, writes the merge, and refuses a set it cannot plant into', () => {
  // Agreement -> exit 0, and --merge writes a merged file with both extractedBy names.
  const a = set();
  a.curation.extractedBy = ['alice'];
  const b = set();
  b.curation.extractedBy = ['bob'];
  const aPath = writeTmpJson('a.json', a);
  const bPath = writeTmpJson('b.json', b);
  const mergeOut = path.join(path.dirname(aPath), 'nested', 'merged.json');

  const agree = spawnSync(process.execPath, [cliPath, aPath, bPath, '--merge', mergeOut], { encoding: 'utf8' });
  assert.equal(agree.status, 0, agree.stdout + agree.stderr);
  const merged = JSON.parse(fs.readFileSync(mergeOut, 'utf8'));
  assert.deepEqual(merged.curation.extractedBy, ['alice', 'bob']);
  assert.equal(typeof merged.curation.comparedOn, 'string');
  assert.equal(fs.readFileSync(mergeOut, 'utf8').endsWith('\n'), true);

  // Mismatch -> exit 1, no merge file written for this pair.
  const c = set();
  c.entries[1].mean = 1234;
  const cPath = writeTmpJson('c.json', c);
  const mismatchOut = path.join(path.dirname(aPath), 'should-not-exist.json');
  const mismatch = spawnSync(process.execPath, [cliPath, aPath, cPath, '--merge', mismatchOut], { encoding: 'utf8' });
  assert.equal(mismatch.status, 1, mismatch.stdout + mismatch.stderr);
  assert.match(mismatch.stdout, /m02_SNB/);
  assert.equal(fs.existsSync(mismatchOut), false);

  // A set with no numeric values anywhere -> self-test cannot plant -> exit 2.
  const empty = { ...set(), entries: [] };
  const emptyPath = writeTmpJson('empty.json', empty);
  const otherPath = writeTmpJson('other.json', set());
  const noPlant = spawnSync(process.execPath, [cliPath, emptyPath, otherPath], { encoding: 'utf8' });
  assert.equal(noPlant.status, 2, noPlant.stdout + noPlant.stderr);

  // Bad JSON -> exit 2.
  const badPath = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'norms-compare-')), 'bad.json');
  fs.writeFileSync(badPath, '{ this is not json');
  const badJson = spawnSync(process.execPath, [cliPath, badPath, otherPath], { encoding: 'utf8' });
  assert.equal(badJson.status, 2, badJson.stdout + badJson.stderr);
});

// Fix round 1 (Task 5 review): comparedOn is the LOCAL calendar date, not the UTC one. TZ is pinned
// for the test so it does not depend on this machine's zone: 08:03 on 8 Oct in Sydney is 21:03 on
// 7 Oct UTC, so a toISOString-based date would read 2026-10-07.
test('localIsoDate gives the local calendar day, zero-padded, where UTC is a day behind', () => {
  const saved = process.env.TZ;
  process.env.TZ = 'Australia/Sydney';
  try {
    const d = new Date(2026, 9, 8, 8, 3);
    assert.equal(d.toISOString().slice(0, 10), '2026-10-07'); // the control: UTC really is the day before
    assert.equal(localIsoDate(d), '2026-10-08');
    assert.equal(localIsoDate(new Date(2026, 0, 5, 9, 0)), '2026-01-05'); // month and day zero-padded
  } finally {
    if (saved === undefined) delete process.env.TZ;
    else process.env.TZ = saved;
  }
});

// Task 4c (carried from the Task 5 review): `citation.undated` decides the year shown and the
// year tie-break, so two extractions differing only there must not agree.
test('two extractions differing only in citation.undated are reported as a difference', () => {
  const a: any = set();
  const b: any = set();
  delete a.citation.year;
  delete b.citation.year;
  a.citation.undated = true;
  const d = compareSets(a, b);
  assert.equal(d.length, 1);
  assert.equal(d[0].where, 'citation.undated');
});

// Task 4c (owner B-2): an entry's `centre` decides whether it is an ideal (marked, line says so).
test("two extractions differing only in an entry's centre are reported as a difference", () => {
  const b: any = set();
  b.entries[0].centre = 'ideal';
  const d = compareSets(set(), b);
  assert.equal(d.length, 1);
  assert.match(d[0].where, /m01_SNA.*centre/);
});
