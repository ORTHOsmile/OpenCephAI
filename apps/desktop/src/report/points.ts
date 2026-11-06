import { LANDMARKS } from '@ceph/analyses';
import { pointLabel } from '../ai/pointLabel';
import type { AcceptKind, Source } from '../tracing/state';
import type { PointCheckView, WholeFilmView } from '../ipc';
import { wholeFilmCell, wholeFilmLooks, wholeFilmRegionCell, type WholeFilmLooks } from '../points/wholeFilm';
import { pointCheckCell, type PointCheckCell } from '../points/pointCheck';

/** Chain spec §5 (Part F Task 13): one point as the report's Points table and the points CSV show it. */
export interface ReportPoint { id: string; name: string; label: string; model: string | null; modelFile: string | null; acceptKind: AcceptKind | null;
  /** Stage A: `flagged`, `film-unusual` or blank (the placing model's point check; blank for a film never checked). */
  pointCheck: PointCheckCell;
  /** SC-1 Part 1 task 9: the film's shown whole-film check, the same on every row (`wholeFilmCell`): blank, `clean`, `not-run`, `flagged:<reasons>` or `checked:<reason>`. */
  wholeFilmCheck: string | null;
  /** Research switch (6 Nov 2026): this landmark's region result (`fine`, `region flagged`, `not checked`). `null` with `wholeFilmCheck`: the
   *  switch is off, and neither the PDF nor the CSV shows the whole-film check at all. */
  wholeFilmRegion: string | null;
  /** The status of each look (`wholeFilmLooks`), the same on every row; null with the two above when the switch is off. Absent reads as null. */
  wholeFilmLooks?: WholeFilmLooks | null }

/** Every placed point, in the catalogue's order: its label (the screen's own words, `pointLabel`), the model that placed
 *  it, that model's file, and how it was accepted. `placer` is always `pointPlacer` (final review I-2: one placer for the
 *  screen, the report and both CSVs); `files` is `library_point_files`. */
export function reportPoints(points: Record<string, { source: Source; acceptKind?: AcceptKind | null }>, placer: (id: string) => string | null,
  titleOf: (modelId: string) => string, files: Record<string, string>, via: (id: string) => string | null = () => null, check: PointCheckView | null = null, whole: WholeFilmView | null = null, includeWhole = false): ReportPoint[] {
  const wholeCell = includeWhole ? wholeFilmCell(whole) : null, looks = includeWhole ? wholeFilmLooks(whole) : null;
  const order = Object.keys(LANDMARKS);
  const rank = (id: string) => { const i = order.indexOf(id); return i < 0 ? order.length : i; };
  return Object.keys(points).sort((a, b) => rank(a) - rank(b) || a.localeCompare(b)).map((id) => {
    const p = points[id], model = p.source === 'manual' ? null : placer(id);
    return { id, name: (LANDMARKS as Record<string, { name: string }>)[id]?.name ?? '', label: pointLabel(p.source, model, titleOf, via(id)), model,
      modelFile: model ? files[id] ?? null : null, acceptKind: p.acceptKind ?? null, pointCheck: pointCheckCell(check, id, model), wholeFilmCheck: wholeCell, wholeFilmRegion: includeWhole ? wholeFilmRegionCell(whole, id) : null, wholeFilmLooks: includeWhole ? looks : null };
  });
}
