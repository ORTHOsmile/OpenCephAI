// The before/after compare for plan 2026-10-19-norms-auto (Tasks 1, 2, 3, 4, 5, 9).
// Usage: node probe/compareProbe.mjs <before.log> <after.log> <expected queries> [none|auto] [expected still-"choose"]
//   none: no difference is allowed.   auto: a difference is allowed only on a row that was "choose" before and is now a
//   norm flagged 'auto-fallback' whose source line says "· Auto (no …". The optional 5th argument, used with `auto`, is
//   the expected count of rows still "choose" after (Task 5/T9 pass 0): a Task 5 that changed nothing leaves every
//   "choose" row "still choose", which the allow-list alone cannot catch (fix round 1 I-2) — this argument can.
// Exit 0: every difference allowed. 1: a difference not allowed (each listed "NOT ALLOWED"), or the still-"choose" count
// given does not match. 2: the files do not hold the same rows (count, duplicate key, missing key, wrong column count).
// 3: nothing compared, or `auto` with no "choose" row before (the instrument would be blind). 4: a file could not be
// read (fix round 1 m-7 — distinct from 1, "a difference not allowed").
// Values are compared as the probe wrote them: numbers via String(), which round-trips a double exactly, so any change
// of any bit shows; NaN is written 'NaN' and so compares equal to NaN; −0 is written '-0'.
import { readFileSync } from 'node:fs';

const [bf, af, wantArg, mode = 'none', stillArg] = process.argv.slice(2);
const want = Number(wantArg);
if (!bf || !af || !Number.isInteger(want) || !['none', 'auto'].includes(mode) || (stillArg !== undefined && !Number.isInteger(Number(stillArg)))) {
  console.log('usage: node compareProbe.mjs <before.log> <after.log> <expected queries> [none|auto] [expected still-"choose"]');
  process.exit(2);
}
const expectedStill = stillArg === undefined ? null : Number(stillArg);
const COLS = 13; // kind, setId, text, mean, sd, flags, line, then six skull cells
const read = (f) => {
  let text;
  try { text = readFileSync(f, 'utf8'); } catch (e) { console.log(`CANNOT READ ${f}: ${e.message}`); process.exit(4); }
  const rows = new Map();
  let dup = 0, badCols = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('PROBE\t')) continue;
    const c = line.split('\t');
    const key = c.slice(1, 7).join(' | ');
    if (rows.has(key)) dup++;
    if (c.length - 7 !== COLS) badCols++;
    rows.set(key, c.slice(7));
  }
  return { rows, dup, badCols };
};
const B = read(bf), A = read(af);
console.log(`rows: before ${B.rows.size} (duplicate keys ${B.dup}, wrong column counts ${B.badCols}), after ${A.rows.size} (duplicate keys ${A.dup}, wrong column counts ${A.badCols}), expected ${want}`);
if (B.rows.size === 0 || A.rows.size === 0) { console.log('NOTHING COMPARED'); process.exit(3); }
if (B.dup || A.dup || B.badCols || A.badCols || B.rows.size !== want || A.rows.size !== want || [...B.rows.keys()].some((k) => !A.rows.has(k))) {
  console.log('ROW SETS DIFFER');
  process.exit(2);
}
const KIND = 0, FLAGS = 5, LINE = 6;
let compared = 0, cells = 0, changed = 0, chooseBefore = 0, stillChoose = 0, bad = 0;
for (const [k, b] of B.rows) {
  const a = A.rows.get(k);
  compared++;
  cells += COLS - 7;
  if (b[KIND] === 'choose') chooseBefore++;
  if (b.every((x, i) => x === a[i])) { if (b[KIND] === 'choose') stillChoose++; continue; }
  changed++;
  const ok = mode === 'auto' && b[KIND] === 'choose' && a[KIND] === 'norm' && a[FLAGS].split(',').includes('auto-fallback') && a[LINE].includes(' · Auto (no ');
  if (!ok) bad++;
  const z = (r) => r.slice(7).map((s) => s.split('|')[0]).join(',');
  console.log(`${ok ? 'CHANGED' : 'NOT ALLOWED'}\t${k}\t${b.slice(0, 6).join(' ¦ ')}  →  ${a.slice(0, 6).join(' ¦ ')}\tz ${z(b)} → ${z(a)}`);
}
console.log(`compared ${compared} queries, ${cells} skull cells; changed ${changed}; "choose" before ${chooseBefore}, still "choose" ${stillChoose}; not allowed ${bad}`);
if (mode === 'auto' && chooseBefore === 0) { console.log('BLIND: the before file holds no "choose" row'); process.exit(3); }
// Fix round 1 I-2: `changed + stillChoose === chooseBefore` always holds when bad === 0 (every allowed change is a
// former "choose" row, by construction of `ok` above), so that equality can never fail and is not a check. The real
// check is the caller's own known answer for how many "choose" rows should remain after — pass it as the 5th arg.
if (mode === 'auto' && expectedStill !== null && stillChoose !== expectedStill) {
  console.log(`MISMATCH: still "choose" is ${stillChoose}, expected ${expectedStill}`);
  process.exit(1);
}
process.exit(bad ? 1 : 0);
