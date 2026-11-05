import { writeFileSync } from 'node:fs';
import { it, expect } from 'vitest';
import { compile } from '@ceph/geometry';
import { ALL_ANALYSES, buildRegistry, loadSets, POPULATIONS, resolveNorm, SYNTHETIC_SKULLS, type NormPicks } from '@ceph/analyses';
import { measurementRows } from '../src/measurements';
import { normCell, queryFor } from '../src/norms/normCell';
import { DEFAULT_DECIMALS } from '../src/format';

// Plan 2026-10-19-norms-auto, Task 1: the production path of a Measurements row — App.tsx's normFor is
// normCell(row.num, resolveNorm(queryFor(row.node, row.normAnalysisId, doc, norms, picks)), q, decimals) — for every
// analysis row × population state × sex × age × pick state, on the six SYNTHETIC skulls. "Population state" is the
// case's own population (none, each of populations.json, one SYNTHETIC user set — 13 states) PLUS, fix round 1 I-1:
// two states where the case has no population of its own and the CLINIC default applies instead (`doc.population =
// null`, `ctx.clinicDefault` set) — one real population (japanese) and the SYNTHETIC user set — because
// `resolveNorm`/`normCell` resolve the effective population as `q.population ?? q.clinicDefault`
// (`packages/analyses/src/norms/resolve.ts:116`) and a wrong fallback there would leave every row bit-identical
// otherwise (no probe row had ever varied the clinic default). 15 population states total. resolveNorm is pure: it
// is called once per query and the same result goes to normCell for each skull (a skull changes only the patient's
// value). Expected: 70,200 queries, 421,200 cells (counted by hand: 130 rows × 15 population states × 3 sexes × 6
// ages × 2 picks = 70,200; × 6 skulls = 421,200).
it('norms before/after probe', () => {
  const out = process.env.NORMS_PROBE_OUT;
  if (!out) throw new Error('set NORMS_PROBE_OUT to the log file to write');
  const sets = loadSets();
  const userNorms = [{ setName: 'SYNTHETIC Mine', measurement: 'm01_SNA', mean: 80, sd: 2, sourceNote: 'SYNTHETIC sample' }];
  const g = compile(buildRegistry(ALL_ANALYSES));
  const scale = { mmPerPx: 0.1, source: 'calibration' as const };   // calibrated, so mm values are shown and graded
  const basePops: (string | null)[] = [null, ...POPULATIONS.map((p) => p.id), 'user:SYNTHETIC Mine'];
  // Fix round 1 I-1: each state is (key for the PROBE log, the case's own population, the clinic default). The 13
  // base states carry no clinic default (ctx.clinicDefault stays null, as Task 1 originally had it); the two
  // "-@…" states carry no case population at all, so resolveNorm/normCell fall through to the clinic default —
  // reviewer's "cheaper variant".
  const popStates: { key: string; population: string | null; clinicDefault: string | null }[] = [
    ...basePops.map((p) => ({ key: p ?? '-', population: p, clinicDefault: null })),
    { key: '-@japanese', population: null, clinicDefault: 'japanese' },
    { key: '-@user:SYNTHETIC Mine', population: null, clinicDefault: 'user:SYNTHETIC Mine' },
  ];
  const sexes = ['M', 'F', null] as const;
  const ages = [   // SYNTHETIC dates; the film 10 Jan 2026
    { tag: 'none', dateOfBirth: null, takenOn: '2026-01-10' },
    { tag: 'filmdate-missing', dateOfBirth: '1996-01-09', takenOn: null },
    { tag: '9', dateOfBirth: '2017-01-09', takenOn: '2026-01-10' },
    { tag: '13', dateOfBirth: '2013-01-09', takenOn: '2026-01-10' },
    { tag: '20', dateOfBirth: '2006-01-09', takenOn: '2026-01-10' },
    { tag: '30', dateOfBirth: '1996-01-09', takenOn: '2026-01-10' },
  ];
  const nodes = [...new Set(ALL_ANALYSES.flatMap((a) => a.measurements.map((m) => m.node)))];
  // Every population "picks" Swedish for every measurement (Chinese for Swedish itself): where Swedish has it the row is
  // "chosen by you"; where it has not, the pick is stale and the row falls through — both paths, every row. Keyed by
  // population id (the resolver's effective popId, `q.population ?? q.clinicDefault`), so the clinic-default states
  // reuse the same pick table as their id already appears in `basePops`.
  const swedishPicks: NormPicks = Object.fromEntries(basePops.filter((p): p is string => p !== null)
    .map((p) => [p, Object.fromEntries(nodes.map((m) => [m, p === 'swedish' ? 'chinese' : 'swedish']))]));
  const pickStates: [string, NormPicks][] = [['none', {}], ['swedish', swedishPicks]];
  const skullRows = SYNTHETIC_SKULLS.map((s) =>
    measurementRows(ALL_ANALYSES, g, g.evaluate(s.points, scale.mmPerPx), new Set(Object.keys(s.points)), DEFAULT_DECIMALS, scale));
  const num = (x: number | null) => (x === null ? 'null' : Number.isNaN(x) ? 'NaN' : Object.is(x, -0) ? '-0' : String(x));
  const clean = (s: string) => s.replace(/[\t\n]/g, ' ');
  const lines = [`SIZES\tskulls=${SYNTHETIC_SKULLS.length}\trows=${skullRows[0].length}\tpops=${popStates.length}\tsexes=${sexes.length}\tages=${ages.length}\tpicks=${pickStates.length}`];
  let queries = 0, cells = 0;
  for (const [pickTag, picks] of pickStates) for (const ps of popStates) for (const sex of sexes) for (const age of ages) {
    const doc = { population: ps.population, gender: sex, dateOfBirth: age.dateOfBirth, takenOn: age.takenOn };
    const ctx = { sets, userNorms, clinicDefault: ps.clinicDefault };
    skullRows[0].forEach((row0, i) => {
      const q = queryFor(row0.node, row0.normAnalysisId, doc, ctx, picks);
      const r = resolveNorm(q);
      const perSkull = skullRows.map((rows) => {
        const c = normCell(rows[i].num, r, q, DEFAULT_DECIMALS);
        cells++;
        return [num(c.z), c.band ?? 'null', c.severity?.stars ?? '', c.severity?.word ?? ''].join('|');
      });
      const text = normCell(skullRows[0][i].num, r, q, DEFAULT_DECIMALS).text;
      lines.push(['PROBE', row0.analysisId, row0.node, ps.key, sex ?? '-', age.tag, pickTag,
        r.kind, r.kind === 'norm' ? r.setId : '', clean(text), r.kind === 'norm' ? num(r.mean) : '', r.kind === 'norm' ? num(r.sd) : '',
        r.kind === 'norm' ? r.flags.join(',') : '', clean(r.kind === 'norm' ? r.sourceLine : r.reason), ...perSkull].join('\t'));
      queries++;
    });
  }
  lines.push(`COUNTS\tqueries=${queries}\tcells=${cells}`);
  writeFileSync(out, lines.join('\n') + '\n');
  expect(queries).toBe(70200);   // the hand count; a loop that ran short fails here
  expect(cells).toBe(421200);
});
