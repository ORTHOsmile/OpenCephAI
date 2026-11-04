/** Spec 2026-10-13 §5.3 "Placement before/after": the production placeFromRuns on the stored Aariz valid bench runs, main =
 *  cwlachap (before) against main = Aariz with the source table (after). Reads reports/ itself and prints only counts and
 *  point names (nobody opens the files). Skipped unless CEPH_XC_RUNS names the folder holding
 *  <model id>/predictions.csv for the four models. */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { placeFromRuns, ORIGINAL_19, AARIZ, CWLACHAP, type MainPointSource, type Placement } from '../src/ai/placement';
import type { Detection, ModelPointRow, PointStatus } from '../src/ipc';

const dir = process.env.CEPH_XC_RUNS;
const root = fileURLToPath(new URL('../../../', import.meta.url));
const MODELS = [CWLACHAP, 'gu2net-isbi19', 'srpose-cldet23', AARIZ];          // catalogue order

type Runs = Map<string, Map<string, Detection>>;
let cache: { runs: Runs; source: MainPointSource; scores: { dataset: string; split: string; modelId: string; points: Record<string, { n: number; mre: number }> }[] } | null = null;
function load() {
  if (cache) return cache;
  const runs: Runs = new Map();
  for (const m of MODELS) {
    const films = new Map<string, Detection>();
    for (const line of readFileSync(`${dir}/${m}/predictions.csv`, 'utf8').split('\n').slice(1)) {
      if (!line.trim()) continue;
      const [film, id, x, y, c] = line.split(',');
      if (!films.has(film)) films.set(film, { modelId: m, imageWidth: 0, imageHeight: 0, executionProvider: 'bench', timingsMs: { preprocess: 0, inference: 0, decode: 0, total: 0 }, landmarks: [], raw: [] });
      films.get(film)!.landmarks.push({ id, x: Number(x), y: Number(y), confidence: Number(c) });
    }
    runs.set(m, films);
  }
  const j = JSON.parse(readFileSync(`${root}reference/main-point-source.json`, 'utf8'));
  const source: MainPointSource = { ruleVersion: j.ruleVersion, confirmationPending: j.confirmation === 'pending',
    points: Object.fromEntries(Object.entries(j.points as Record<string, { chosen: string }>).map(([k, v]) => [k, v.chosen])) };
  cache = { runs, source, scores: JSON.parse(readFileSync(`${root}reference/model-scores.json`, 'utf8')) };
  return cache;
}
/** The gate table placeFromRuns reads, built as ceph-model's scores.rs builds it (Aariz test rows; ≤ 2.0 mm placed). */
function gateTable(main: string): ModelPointRow[] {
  const { runs, scores } = load();
  const statusOf = (m: string, id: string): PointStatus => {
    if (ORIGINAL_19.includes(id)) return { kind: 'original' };
    const r = scores.find((q) => q.modelId === m && q.dataset === 'aariz' && q.split === 'test')?.points[id];
    return !r ? { kind: 'notScored' } : r.mre <= 2.0 ? { kind: 'scored', mre: r.mre, n: r.n, dataset: 'aariz' } : { kind: 'tooFar', mre: r.mre, n: r.n, dataset: 'aariz' };
  };
  const ids = (m: string) => [...new Set([...runs.get(m)!.values()].flatMap((d) => d.landmarks.map((l) => l.id)))];
  return [main, ...MODELS.filter((m) => m !== main)].map((m) => ({ modelId: m, title: m, main: m === main, points: ids(m).map((id) => ({ id, status: statusOf(m, id) })) }));
}
function placeAll(main: string, src: MainPointSource | null, nudge?: { film: string; id: string }): Map<string, Placement> {
  const { runs } = load(), table = gateTable(main), out = new Map<string, Placement>();
  for (const film of [...runs.get(AARIZ)!.keys()].sort()) {
    const det = (m: string): Detection | null => {
      const d = runs.get(m)!.get(film); if (!d) return null;
      return nudge && nudge.film === film && m === main ? { ...d, landmarks: d.landmarks.map((l) => (l.id === nudge.id ? { ...l, x: l.x + 1 } : l)) } : d;
    };
    const m = det(main); if (!m) continue;
    out.set(film, placeFromRuns(m, MODELS.filter((x) => x !== main).map(det).filter((d): d is Detection => !!d), table, src));
  }
  return out;
}
/** Points whose placing model or position differ between two placements, counted per point. */
function changes(a: Map<string, Placement>, b: Map<string, Placement>): { total: number; byPoint: Record<string, number>; sourceChanged: Record<string, number> } {
  const byPoint: Record<string, number> = {}, sourceChanged: Record<string, number> = {};
  let total = 0;
  for (const [film, p] of a) {
    const q = b.get(film)!;
    for (const id of new Set([...Object.keys(p.source), ...Object.keys(q.source)])) {
      const [x, y] = [p.landmarks.find((l) => l.id === id), q.landmarks.find((l) => l.id === id)];
      const moved = !x || !y || x.x !== y.x || x.y !== y.y;
      if (p.source[id] !== q.source[id]) sourceChanged[id] = (sourceChanged[id] ?? 0) + 1;
      if (moved || p.source[id] !== q.source[id]) { byPoint[id] = (byPoint[id] ?? 0) + 1; total++; }
    }
  }
  return { total, byPoint, sourceChanged };
}

describe.skipIf(!dir)('placement before/after on the Aariz valid bench runs (spec §5.3)', () => {
  it('positive control: identical inputs report zero changes; one point 1 px off reports exactly one', () => {
    const { source, runs } = load();
    expect(changes(placeAll(AARIZ, source), placeAll(AARIZ, source)).total).toBe(0);
    const film = [...runs.get(AARIZ)!.keys()].sort()[0];
    // Nudge an original point the table gives to Aariz, so the nudge is on the placed point (preflight c12).
    const id = ORIGINAL_19.find((p) => source.points[p] !== CWLACHAP && runs.get(AARIZ)!.get(film)!.landmarks.some((l) => l.id === p))!;
    expect(changes(placeAll(AARIZ, source), placeAll(AARIZ, source, { film, id })).total).toBe(1);
  });
  it('after: every original point equals the raw point of the model the table names, exactly', () => {
    const { source, runs } = load();
    let checked = 0;
    for (const [film, p] of placeAll(AARIZ, source)) for (const id of ORIGINAL_19) {
      const l = p.landmarks.find((q) => q.id === id); if (!l) continue;
      const want = source.points[id] === CWLACHAP && !p.fallback.includes(id) ? CWLACHAP : AARIZ;
      const raw = runs.get(want)!.get(film)!.landmarks.find((q) => q.id === id)!;
      expect([l.x, l.y, p.source[id]]).toEqual([raw.x, raw.y, want]);
      checked++;
    }
    console.log(`original points checked against the named model's raw point: ${checked}`);
    expect(checked).toBeGreaterThan(0);
  });
  it('lists every point whose source model changed, cwlachap-main before against Aariz-plus-table after', () => {
    const { source } = load();
    const c = changes(placeAll(CWLACHAP, null), placeAll(AARIZ, source));
    console.log(`films ${placeAll(AARIZ, source).size}; points changed ${c.total}; source changed per point ${JSON.stringify(c.sourceChanged)}`);
    // Which model places how many points, before and after (counts only), so every change above can be read off.
    const tally = (m: Map<string, Placement>) => { const t: Record<string, number> = {}; for (const p of m.values()) for (const s of Object.values(p.source)) t[s] = (t[s] ?? 0) + 1; return t; };
    console.log(`placed by, before: ${JSON.stringify(tally(placeAll(CWLACHAP, null)))}; after: ${JSON.stringify(tally(placeAll(AARIZ, source)))}`);
    const by = (m: Map<string, Placement>, model: string) => [...new Set([...m.values()].flatMap((p) => Object.entries(p.source).filter(([, s]) => s === model).map(([id]) => id)))].sort();
    console.log(`points SRPose places, before: ${by(placeAll(CWLACHAP, null), 'srpose-cldet23').join(' ')}; after: ${by(placeAll(AARIZ, source), 'srpose-cldet23').join(' ')}`);
    expect(Object.keys(c.byPoint).length).toBeGreaterThan(0);
  });
});
