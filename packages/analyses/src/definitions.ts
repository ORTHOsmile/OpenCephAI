import type { NodeId, Unit } from '@ceph/geometry';
import { byId } from './catalogue';
import { WHAT } from './catalogue/what';
import type { SourceMark } from './catalogue/types';
import { LANDMARKS, POINT_DEFINITIONS, UNCONFIRMED_POINTS, type LandmarkId } from './landmarks';
import { MIYASHITA, MIYASHITA_SOURCE } from './point-definitions-miyashita';
import { LINE_NAMES } from './lines';
import { buildRegistry } from './registry';
import { ALL_ANALYSES } from './analyses';
import { exprRefs } from './steps';
import { CONSTRUCTION, NOTES, PLUS_WORDS } from './catalogue/screen-signs';

/** What each source mark means to a reader. P, T and S follow the catalogue appendix's "How to read this page";
 *  the appendix has no W mark, so W's words are new here (no catalogue entry uses W today; review M-6). */
export const MARK_WORDS: Record<SourceMark, string> = {
  P: "the analysis's own paper, on file and read",
  T: 'the textbook (Naini, Facial Aesthetics, Ch. 7)',
  S: 'second-hand only: not checked against the original',
  W: 'a website value, not from a paper',
};

/** `plus`: which way is plus, in screen words, or null when `what` already says it (PLUS_WORDS, ruling T2-1).
 *  `lines`: the named shared lines the computation draws, each name once (FH and FH_post are one line).
 *  `builtPoints`: the named constructed points it uses (molar overlap, constructed gonion/gnathion, Xi).
 *  `construction`: plain notes for the private helpers behind it (Wits' AO and BO, Kim's palatal sign, …), each once.
 *  Together with `points` these name everything the computation reaches (ruling T2-2; definitions.test.ts).
 *  `note`: an owner-approved note (NOTE-1, 12 Oct; `NOTES` in screen-signs.ts), present only where one exists. */
export interface MeasurementDefinition {
  id: string; no: string; label: string; unit: Unit; what: string; plus: string | null;
  points: { id: LandmarkId; name: string }[]; lines: { id: string; name: string }[];
  builtPoints: { id: string; name: string }[]; construction: string[];
  mark: SourceMark; markWords: string; cite: string; where: string | null; notChecked: boolean;
  note?: string;
}
export interface PointDefinition { id: LandmarkId; name: string; definition: string | null; definitionSource: string | null; source: string; unconfirmed: boolean }

let registry: ReturnType<typeof buildRegistry> | null = null;
const reg = () => (registry ??= buildRegistry(ALL_ANALYSES));

const LINE_KINDS = new Set(['line', 'perpendicular', 'parallelThrough']);
const POINT_KINDS = new Set(['midpoint', 'intersection', 'projection', 'offsetPoint', 'xiPoint']);

/** One measurement as a reader sees it (Part D, owner 7 Oct): its plain words and sign, and the points, named lines,
 *  built points and construction notes found by walking the very expression the app evaluates. Points are guarded
 *  against the compiler's own list; lines, built points and notes by a whole-catalogue test that every node reached
 *  is named in one of them. */
export function measurementDefinition(id: NodeId): MeasurementDefinition {
  const e = byId(id), r = reg();
  const what = WHAT[e.no] ?? '';
  const points: LandmarkId[] = [], lines: string[] = [], built: string[] = [], notes: string[] = [], seen = new Set<string>();
  const walk = (n: NodeId) => {
    if (seen.has(n)) return; seen.add(n);
    const x = r[n];
    if (!x) return;
    if (x.kind === 'landmark') { points.push(x.id as LandmarkId); return; }
    const note = CONSTRUCTION[n];
    if (n in CONSTRUCTION) { if (note && !notes.includes(note)) notes.push(note); }
    else if (n !== id && LINE_NAMES[n] && LINE_KINDS.has(x.kind)) { if (!lines.some((l) => LINE_NAMES[l] === LINE_NAMES[n])) lines.push(n); }
    else if (n !== id && LINE_NAMES[n] && POINT_KINDS.has(x.kind)) built.push(n);
    exprRefs(x).forEach(walk);
  };
  walk(id);
  return {
    id: e.id, no: e.no, label: e.label, unit: e.unit, what,
    plus: PLUS_WORDS[e.no] ?? null,
    points: points.map((p) => ({ id: p, name: LANDMARKS[p].name })),
    lines: lines.map((l) => ({ id: l, name: LINE_NAMES[l] })),
    builtPoints: built.map((p) => ({ id: p, name: LINE_NAMES[p] })),
    construction: notes,
    mark: e.source.mark, markWords: MARK_WORDS[e.source.mark], cite: e.source.cite, where: e.source.where ?? null,
    notChecked: e.source.mark === 'S',
    ...(NOTES[e.no] !== undefined ? { note: NOTES[e.no] } : {}),
  };
}

/** What the screen says for a point with no definition yet (owner DEF-MIYA-1). One place, used by every view (P15). */
export const DEFINITION_TO_COME = 'Definition to come.';
/** Where a definition from POINT_DEFINITIONS comes from. */
export const APPENDIX_POINT_SOURCE = 'Catalogue appendix §2 (Naini Tables 7.1–7.3)';

/** One point as a reader sees it: name, its definition and where that comes from (or null: "definition to come"), the
 *  point's own source, and whether it is still to be confirmed. Task 8 adds the Miyashita definitions as a second source. */
export function pointDefinition(id: LandmarkId): PointDefinition {
  const p = LANDMARKS[id], own = POINT_DEFINITIONS[id] ?? null, miya = own ? null : MIYASHITA[id] ?? null;
  return { id, name: p.name, definition: own ?? miya?.text ?? null,
    definitionSource: own ? APPENDIX_POINT_SOURCE : miya ? `${MIYASHITA_SOURCE}, p. ${miya.page}` : null,
    source: p.source, unconfirmed: UNCONFIRMED_POINTS.has(id) };
}

/** Shown under a point's catalogue definition (`PointAbout`) when its meaning is still to be confirmed on
 *  films (owner, 7 Oct) — one place, so the screen never retypes it (global constraint). */
export const STILL_TO_CONFIRM_TEXT = 'Still to be confirmed on films.';
/** Owner, 7 Oct: the one-line warning a measurement carries when it uses an AI-placed, unverified point that
 *  is either not scored on any test set, whose definition is still to be confirmed, or whose placing model's
 *  status could not be determined (fail-safe, owner ruling T9-2) — one place, never retyped in the screen. */
export const unconfirmedAiPointsLine = (ids: string[]): string => `uses unconfirmed AI points: ${ids.join(', ')}`;
/** The plain words for which installed models find a point and how well (Part B's live `models_points` table)
 *  — one place, so `foundByLines` (apps/desktop/src/points/foundBy.ts) never retypes them. */
export const FOUND_BY_WORDS = {
  original: 'one of its original points',
  notScored: 'not scored on any test set',
  noModel: 'No installed model finds this point: place it by hand.',
  tableUnreadable: 'Which models find this point could not be read.',
  scored: (mre: number, n: number, dataset: string) => `${mre.toFixed(1)} mm on ${n} ${dataset} test films`,
  tooFar: (mre: number, n: number, dataset: string) => `suggested only (${mre.toFixed(1)} mm on ${n} ${dataset} test films, over the gate)`,
} as const;
