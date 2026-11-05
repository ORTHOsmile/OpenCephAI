// Spec 2026-10-19 Addendum 3 (N), plan Task 13: the before/after instrument. A film with no fine-tune must export
// exactly what it exported before Task 13. The golden is captured by THIS file, from the code at the commit before
// Task 13 (CAPTURE_N_GOLDEN=<that sha>), through the path a film's exports take (evaluateFilm → buildReport →
// headerLines / reportTexts / measurementsCsv). After Task 13 every artefact must equal it, each number by Object.is.
// SYNTHETIC films only.
// Owner ruling Q-B (24 Oct 2026), Task 7: the unstated-film-scale words changed ("film scale not stated in the
// paper; assumed true size" → "the paper did not state its X-ray enlargement; mm taken as true size", and the
// "source's"/"donor's" variants likewise) — a deliberate, words-only exception to "exactly what it exported",
// re-captured and diffed against the previous golden to confirm every number (`nums`, by Object.is) held and only
// that phrase moved in `texts`/`tidy`/`wide`. See normCell.ts's `rewordUnstatedScale`.
// Task 10 (addendum 2 J, owner ruling Q-A): two more deliberate exceptions, re-captured and diffed the same way
// (a programmatic cell-by-cell diff, not eyeballing): (1) `reportTexts` gains exactly one new line per film — the
// unstated-X-ray-enlargement list this fixture's real catalogue rows trigger (Steiner, Downs, Ricketts, Jarabak,
// Jacobson, Holdaway, [source removed] all have at least one row with no stated enlargement) — `autoNote` stays null (this
// fixture has no population, so Auto never fires: resolve.ts's "no population chosen at all" path). (2) the TIDY
// layout only (review I-1, fix round 1: wide carries no norm/z columns at all) gains a `norm_auto` column, blank on
// every row (confirmed: no Auto and no hand-picked row here). Diffed against the commit before Task 10 (`1bc690a`):
// nums (130 per film, ×3 = 390), header (9 per film, ×3 = 27) and EVERY common tidy/wide cell — 3 × (4,550 + 147) =
// **14,091**, 0 differ — held Object.is identical; only the one new `texts` line and the one new blank `norm_auto`
// column appeared (review M-3, fix round 1, 25 Oct 2026: corrects this comment's earlier "13,791", an arithmetic
// slip — the work itself was right, 0 differ, just miscounted).
// Fix round 1 (25 Oct 2026, M-1/M-2): the unstated-enlargement list's wording changed again (readable " · " joins,
// deduped, and now also naming a paper that supplied only a borrowed SD) — re-captured and diffed against the
// Task 10 commit (`bd0c57a`): nums/header unchanged, the column unchanged (already added), and EVERY common cell
// — 3 × (4,680 + 147) = 14,481 — held identical; only that one `texts` line's WORDING changed (not a line count
// change this time: the list already existed, this just reworded it). `capturedAt` records the commit the golden
// was captured FROM, kept as a short sha (never a free-text label) so later diffs know which code produced it
// (review m-2, final review, 25 Oct 2026) — this re-capture was made from the fix-round-1 working tree, committed
// as `2ba2864`; `capturedAt` still reads `bd0c57a`.
// Task 14 (ruling R12, 25 Oct 2026): both CSV layouts gain an `age_source` column after `age_years` ('dob' for
// these three films, each with a date of birth). Re-captured from the Task 14 working tree on top of `a6a8eff`
// (`capturedAt` now reads `a6a8eff`) and diffed against the previous golden with a quote-aware, cell-by-cell diff:
// nums 390, header lines 27, texts 2,047 and EVERY common tidy/wide cell — 3 × (131 × 36 + 2 × 147) = 15,030, of
// them 393 `age_years` cells — held identical (0 differ); the only addition is `age_source` = 'dob' on every row.
// Its control (one DOB `age_years` cell nudged 13.92 → 13.93) was caught, exit 1. R15 holds: the header is unchanged.
// Norms Auto population Task 3 (owner decision 6, 29 Oct 2026): this fixture has no population, and the no-population
// path now fills rows neither the analysis nor your norms have (Auto, steps 3-4). Re-captured from the Task 3 working
// tree on top of `890654c` (`capturedAt` reads `890654c`) and diffed cell by cell against the previous golden: nums
// 390 and header lines 27 identical; tidy 3 × 4,810 cells, of which 48 + 45 + 48 differ, every one on a row that read
// "No norm" before (Pog–NB, Co–A, Upper pharynx, LAFH %, Upper lip strain, Inferior sulcus to H-line, U1–NA (°),
// L1–NB (°)); wide 3 × 148 cells, 0 differ; texts gain the report sentence and the Auto footnote (5 lines per film).
// Node's fs/path/url are read with a type-erased dynamic import, like `report/testFonts.ts` — the repo has no
// `@types/node`, so a static `import … from 'node:fs'` fails `tsc` (confirmed by the Step 7 build check).
import { describe, it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import { ALL_ANALYSES, buildRegistry, loadSets } from '@ceph/analyses';
import type { CaseDoc } from '../ipc';
import { APP, headerLines, reportTexts } from '../report/model';
import { synthDoc, synthFittedDoc, synthModel } from '../report/fixtures';
import { evaluateFilm } from './film';
import { measurementsCsv, type CsvOptions } from './measurementsCsv';

const FS = 'node:fs', PATHMOD = 'node:path', URLMOD = 'node:url';
const { mkdirSync, readFileSync, writeFileSync } = (await import(/* @vite-ignore */ FS)) as {
  mkdirSync: (p: string, o?: { recursive?: boolean }) => void; readFileSync: (p: string, enc: string) => string; writeFileSync: (p: string, s: string) => void;
};
const { dirname } = (await import(/* @vite-ignore */ PATHMOD)) as { dirname: (p: string) => string };
const { fileURLToPath } = (await import(/* @vite-ignore */ URLMOD)) as { fileURLToPath: (u: URL) => string };
const captureGolden = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.CAPTURE_N_GOLDEN;

const GOLDEN = fileURLToPath(new URL('./golden/n-unadjusted.json', import.meta.url));
const compiled = compile(buildRegistry(ALL_ANALYSES));
const norms = { sets: loadSets(), userNorms: [], clinicDefault: null };
const opts: CsvOptions = { anonymise: false, layout: 'tidy', salt: '0123456789abcdef0123456789abcdef', exportedAt: '2026-10-18T02:00:00.000Z', decimals: 1 };
const unApp = (s: string) => s.split(APP).join('<APP>');   // a version bump is not a change of the export
const artefact = (doc: CaseDoc) => {
  const { rows, cells, scale } = evaluateFilm(doc, ALL_ANALYSES, compiled, 1, norms, {});
  const m = synthModel({ doc, rows, cells, scale, defs: ALL_ANALYSES });
  return { nums: rows.map((r) => r.num), header: headerLines(m.header).map(([k, v]) => `${k}: ${unApp(v)}`), texts: reportTexts(m).map(unApp),
    tidy: unApp(measurementsCsv([m], opts)), wide: unApp(measurementsCsv([m], { ...opts, layout: 'wide' })) };
};
// A ruler film (the one Task 13 touches), a film with no ruler, and a fitted film with the switch on (G): all with no press.
const FILMS: [string, CaseDoc][] = [['ruler 0.0937', synthDoc({ spacingMm: 0.0937 })], ['no ruler', synthDoc({ spacingMm: null })], ['fitted, switch on', synthFittedDoc()]];
type Art = ReturnType<typeof artefact>;

describe('a film with no fine-tune exports exactly what it did before Task 13 (spec 2026-10-19 addendum 3)', () => {
  if (captureGolden) {
    it('captures the golden from this commit', () => {
      mkdirSync(dirname(GOLDEN), { recursive: true });
      // Compact (one line), not pretty-printed: the privacy check's "Birth-date value" pattern is excluded only when the
      // same LINE also contains the literal word SYNTHETIC — a pretty-printed file puts the synthetic patient's
      // date of birth on a line by itself, with "SYNTHETIC" (the patient name, in patientKey, …) on a different
      // line, and the commit is blocked. One line keeps every field — including the synthetic patient's own
      // name/key — on the line the guard checks, which is exactly true: nothing in this file is real.
      writeFileSync(GOLDEN, JSON.stringify({ capturedAt: captureGolden, films: Object.fromEntries(FILMS.map(([k, d]) => [k, artefact(d)])) }) + '\n');
    });
    return;
  }
  const golden = JSON.parse(readFileSync(GOLDEN, 'utf8')) as { capturedAt: string; films: Record<string, Art> };
  for (const [name, doc] of FILMS) {
    it(`${name}: every number (Object.is), the header, the report text and both CSV layouts`, () => {
      const now = artefact(doc), then = golden.films[name];
      expect(now.nums.length).toBe(then.nums.length);
      let compared = 0;
      now.nums.forEach((v, i) => { expect(Object.is(v, then.nums[i])).toBe(true); if (v !== null) compared++; });
      expect(compared).toBeGreaterThan(0);
      expect(now.header).toEqual(then.header);
      expect(now.texts).toEqual(then.texts);
      expect(now.tidy).toBe(then.tidy);
      expect(now.wide).toBe(then.wide);
      expect(now.tidy.split('\r\n').filter(Boolean).length).toBe(now.nums.length + 1);   // rows compared = rows on the film
    });
  }
});
