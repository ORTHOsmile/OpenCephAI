import type { AnalysisDef, NodeId } from '@ceph/geometry';
import { ALL_ANALYSES } from './analyses';
import { CATALOGUE, DENTAL, SKELETAL_AP, SOFT, VERTICAL, byId } from './catalogue';
import type { CatalogueEntry } from './catalogue/types';
import type { NormSet } from './norms/types';
import { DEFAULT_MEANINGS } from './norms/meanings';

/** "My analysis" (spec 2026-10-17-analysis-builder-design.md, Option A; owner B1–B4, 17 Oct 2026): a clinician's own
 *  list of catalogue measurements, in their order, under their name. No new geometry: it becomes a plain AnalysisDef
 *  with `nodes: {}`, like every built-in, so its values are the catalogue's own, bit for bit (master plan §7). */
export const MY_PREFIX = 'my:';
export const NAME_MAX = 60;
export const NO_LONGER_AVAILABLE = 'no longer available';

/** One chosen measurement: its catalogue id, and `from` — the built-in analysis whose own norm it uses after the
 *  population's (owner B3) — or '' when no built-in analysis lists it. */
export interface MyItem { id: NodeId; from: string }
export interface MyAnalysis { id: string; name: string; items: MyItem[] }
/** What the screens get: an ordinary AnalysisDef, plus where each row's norm comes from and what is no longer available. */
export interface MyAnalysisDef extends AnalysisDef { mine: true; normFrom: Record<NodeId, string>; unavailable: NodeId[] }

/** In today's catalogue and not retired. A measurement removed later stays in the clinician's list, shown
 *  "no longer available" (spec edge case), and is never computed. */
export const isLive = (id: string): boolean => CATALOGUE.some((e) => e.id === id && !e.retired);
export const isMine = (d: AnalysisDef): d is MyAnalysisDef => (d as Partial<MyAnalysisDef>).mine === true;

/** The analysis id the norm resolver gets for one row (NormQuery.analysisId): a built-in's own id; a My-analysis row's
 *  item `from` ('' = no analysis's own norm). So each row resolves exactly as in its original analysis (owner B3). */
export const normAnalysisOf = (d: AnalysisDef, node: NodeId): string => (isMine(d) ? d.normFrom[node] ?? '' : d.id);

function hasOwnNorm(analysisId: string, node: NodeId, sets: NormSet[]): boolean {
  return sets.some((s) => s.kind === 'analysis-own' && s.status !== 'pending' && (s.analyses ?? []).includes(analysisId)
    && s.entries.some((e) => e.measurement === node && e.definitionMatch !== 'different'));
}

/** Owner B3 for a measurement ticked from the list: the first built-in analysis (app order) that lists it AND has its
 *  own norm for it; else the first that lists it; else '' (no built-in analysis lists it: population norms only). */
export function originFor(node: NodeId, sets: NormSet[]): string {
  const listing = ALL_ANALYSES.filter((a) => a.measurements.some((m) => m.node === node));
  return (listing.find((a) => hasOwnNorm(a.id, node, sets)) ?? listing[0])?.id ?? '';
}

/** Duplicate (built-ins are read-only): every measurement in order, each keeping that analysis's own norm. */
export const duplicateItems = (a: AnalysisDef): MyItem[] => a.measurements.map((m) => ({ id: m.node, from: a.id }));

/** The AnalysisDef the screens compute: live items only, labelled from the catalogue (as the built-ins are). */
export function toAnalysisDef(a: MyAnalysis): MyAnalysisDef {
  const live = a.items.filter((i) => isLive(i.id));
  return {
    id: a.id, name: a.name, nodes: {}, mine: true,
    measurements: live.map((i) => ({ node: i.id, label: byId(i.id).label })),
    normFrom: Object.fromEntries(live.map((i) => [i.id, i.from])),
    unavailable: a.items.filter((i) => !isLive(i.id)).map((i) => i.id),
  };
}

// A name-clash key: NFKC-normalised with format characters (zero-width space, joiners, …) stripped first, so a
// hidden `​` cannot make a typed name look different from a built-in it would otherwise be confused with in
// the picker (preflight review m10).
const key = (name: string) => name.trim().normalize('NFKC').replace(/\p{Cf}/gu, '').toLocaleLowerCase();

export const MY_ANALYSIS_WORDS = {
  noName: 'Give the analysis a name.',
  tooLong: `Keep the name to ${NAME_MAX} characters or fewer.`,
  empty: 'Choose at least one measurement. An empty analysis is not saved.',
  twice: (label: string) => `${label} is listed twice.`,
  taken: (name: string) => `There is already an analysis called “${name}”. Choose another name.`,
} as const;

export type AnalysisCheck = { ok: true; name: string } | { ok: false; error: string };

/** Spec edge cases: no name, too long, empty (no measurement still in the catalogue), a measurement twice, or a name
 *  already used by a built-in or by another of this clinician's analyses (any case). `selfId`: the one being edited. */
export function checkAnalysis(draft: { name: string; items: MyItem[] }, mine: { id: string; name: string }[], selfId: string | null): AnalysisCheck {
  const name = draft.name.trim();
  if (!name) return { ok: false, error: MY_ANALYSIS_WORDS.noName };
  if (name.length > NAME_MAX) return { ok: false, error: MY_ANALYSIS_WORDS.tooLong };
  if (!draft.items.some((i) => isLive(i.id))) return { ok: false, error: MY_ANALYSIS_WORDS.empty };
  const seen = new Set<string>();
  for (const i of draft.items) {
    if (seen.has(i.id)) return { ok: false, error: MY_ANALYSIS_WORDS.twice(isLive(i.id) ? byId(i.id).label : i.id) };
    seen.add(i.id);
  }
  const names = [...ALL_ANALYSES.map((a) => a.name), ...mine.filter((a) => a.id !== selfId).map((a) => a.name)];
  const clash = names.find((n) => key(n) === key(name));
  return clash !== undefined ? { ok: false, error: MY_ANALYSIS_WORDS.taken(clash) } : { ok: true, name };
}

/** "Steiner (copy)", then "Steiner (copy 2)", … — the first not already taken (any case). */
export function copyName(base: string, taken: string[]): string {
  const t = new Set(taken.map(key));
  for (let n = 1; ; n++) {
    const c = n === 1 ? `${base} (copy)` : `${base} (copy ${n})`;
    if (!t.has(key(c))) return c;
  }
}

/** A new id, never one already taken. No crypto API needed (works in every webview and in tests). */
export function newAnalysisId(taken: string[], rand: () => number = Math.random, now: () => number = Date.now): string {
  for (;;) {
    const id = `${MY_PREFIX}${now().toString(36)}-${rand().toString(36).slice(2, 10)}`;
    if (!taken.includes(id)) return id;
  }
}

export interface MeasurementGroup { title: string; entries: CatalogueEntry[] }
const AIRWAY = new Set(['m84_UpperPharynx', 'm85_LowerPharynx']);
const live = (xs: CatalogueEntry[]) => xs.filter((e) => !e.retired);

/** The editor's list (spec: grouped skeletal front-to-back, vertical, dental, soft tissue, airway), catalogue order. */
export function measurementGroups(): MeasurementGroup[] {
  return [
    { title: 'Skeletal: front-to-back', entries: live(SKELETAL_AP) },
    { title: 'Vertical and jaw shape', entries: live(VERTICAL) },
    { title: 'Dental', entries: live(DENTAL) },
    { title: 'Soft tissue', entries: live(SOFT).filter((e) => !AIRWAY.has(e.id)) },
    { title: 'Airway', entries: live(SOFT).filter((e) => AIRWAY.has(e.id)) },
  ];
}

/** Search by name or approved abbreviation (any case); "#22" finds catalogue number 22 only. Empty groups dropped. */
export function searchGroups(query: string): MeasurementGroup[] {
  const q = query.trim().toLocaleLowerCase();
  if (!q) return measurementGroups();
  const hit = q.startsWith('#')
    ? (e: CatalogueEntry) => e.no === q.slice(1).trim()
    : (e: CatalogueEntry) => e.label.toLocaleLowerCase().includes(q) || (DEFAULT_MEANINGS[e.id]?.abbr ?? '').toLocaleLowerCase().includes(q);
  return measurementGroups().map((g) => ({ ...g, entries: g.entries.filter(hit) })).filter((g) => g.entries.length > 0);
}

/** Reorder (↑ ↓ and drag); an index out of range changes nothing. */
export function moveItem<T>(items: T[], from: number, to: number): T[] {
  if (from < 0 || from >= items.length || to < 0 || to >= items.length || from === to) return items.slice();
  const out = items.slice();
  const [x] = out.splice(from, 1);
  out.splice(to, 0, x);
  return out;
}

/** The words under a chosen measurement in the editor (owner B3). An analysis is named as the norm's source only when
 *  the norm sets hold its own norm for this measurement (final review M1); otherwise only the population's is offered. */
export function normFromWords(from: string, node: NodeId, sets: NormSet[]): string {
  const a = ALL_ANALYSES.find((x) => x.id === from);
  if (!a) return "Norm: your population's (no built-in analysis lists it)";
  return hasOwnNorm(a.id, node, sets) ? `Norm: your population's, else ${a.name}'s own`
    : `Norm: your population's, else Auto (${a.name} lists it but has no norm of its own for it)`;
}

/** The line the Measurements and Chart tabs show when some of an analysis's measurements are no longer available. */
export function unavailableLine(d: MyAnalysisDef): string | null {
  const n = d.unavailable.length;
  return n ? `${d.name}: ${n === 1 ? '1 measurement' : `${n} measurements`} ${NO_LONGER_AVAILABLE} (${d.unavailable.join(', ')}).` : null;
}
