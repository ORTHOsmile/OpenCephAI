import { byId } from '../catalogue';
import { ALL_ANALYSES } from '../analyses';
import type { NormEntry } from './types';

/** Plausibility bounds per unit (a slipped decimal point or wrong sign should fail these).
 *  Range bounds (low/high) use the same mean bounds as their unit. */
export const PLAUSIBLE_BOUNDS: Record<string, { mean: [number, number]; sdMax: number }> = {
  deg: { mean: [-90, 200], sdMax: 20 },
  mm: { mean: [-30, 200], sdMax: 20 },
  '%': { mean: [0, 100], sdMax: 30 },
  '': { mean: [0, 5], sdMax: 2 },
};

/** Ruling P15 (Task 8): measurements whose real values lie outside their unit's bounds get their own
 *  window. #39 Björk's sum of angles (saddle + articular + gonial) is ~396°, above the 200° degree
 *  guard; every other angle keeps that guard. */
export const PLAUSIBLE_OVERRIDES: Record<string, { mean: [number, number]; sdMax: number }> = {
  m39_SumAngles: { mean: [300, 450], sdMax: 20 },
};

/** The plausibility check every published norm entry passes (Ruling T10-3, 12 Oct): a slipped decimal point, a
 *  wrong sign, or a range typed against the wrong bounds should fail this. Shared (never copied) by
 *  `validateEntry` below AND by `apps/desktop/src/settings/userNorm.ts`'s `checkUserNorm` — a user-entered norm
 *  is held to the exact same bounds as a published one, no new threshold. `measurement`'s own override
 *  (`PLAUSIBLE_OVERRIDES`) takes precedence over its unit's generic bounds (`PLAUSIBLE_BOUNDS`); with neither,
 *  nothing is checked (an unknown unit is caught elsewhere). */
export function plausibilityErrors(e: { measurement?: string; unit: string; mean?: number | null; sd?: number | null; range?: { low: number; high: number } | null }): string[] {
  const out: string[] = [];
  const override = typeof e.measurement === 'string' && Object.hasOwn(PLAUSIBLE_OVERRIDES, e.measurement)
    ? PLAUSIBLE_OVERRIDES[e.measurement]
    : undefined;
  const bounds = override ?? PLAUSIBLE_BOUNDS[e.unit];
  const what = override ? e.measurement : `unit "${e.unit}"`;
  if (!bounds) return out;
  if (e.mean !== undefined && e.mean !== null && (e.mean < bounds.mean[0] || e.mean > bounds.mean[1])) {
    out.push(`mean ${e.mean} is implausible for ${what}`);
  }
  if (e.sd !== undefined && e.sd !== null && e.sd > bounds.sdMax) {
    out.push(`sd ${e.sd} is implausible for ${what}`);
  }
  if (e.range !== undefined && e.range !== null) {
    const { low, high } = e.range;
    if (low < bounds.mean[0] || low > bounds.mean[1]) out.push(`range low ${low} is implausible for ${what}`);
    if (high < bounds.mean[0] || high > bounds.mean[1]) out.push(`range high ${high} is implausible for ${what}`);
  }
  return out;
}

const ANALYSIS_IDS = new Set(ALL_ANALYSES.map((a) => a.id));

const KINDS = ['analysis-own', 'population', 'research-sd'];
const STATUSES = ['verified', 'single-extracted', 'pending', 'website'];
const SELECTIONS = ['class-I-balanced', 'class-I', 'ideal-aesthetic', 'random-unselected', 'mixed-occlusion', 'unknown'];
const MODALITIES = ['film', 'digital', 'cbct-derived', 'unknown'];
const HEAD_POSITIONS = ['FH', 'NHP', 'unknown'];
const FILM_SCALE_KINDS = ['true-size', 'enlarged', 'not-stated'];
const CENTRES = ['sample-mean', 'ideal'];
const SEXES = ['M', 'F', 'pooled'];
const DEFINITION_MATCHES = ['same', 'close', 'different'];

/** Final review I-4 (12 Oct): the keys the format allows (types.ts), so a misspelt key ("ageband")
 *  is refused instead of silently ignored. Keep in step with NormSet / NormEntry in types.ts. */
export const ALLOWED_KEYS = {
  set: ['id', 'kind', 'analyses', 'status', 'citation', 'population', 'sample', 'selection', 'modality', 'scale', 'headPosition', 'secondHand', 'ageRows', 'curation', 'caveats', 'entries'],
  citation: ['authors', 'title', 'journal', 'year', 'undated', 'volume', 'pages', 'doi', 'pmid', 'pmcid', 'url', 'openAccess'],
  population: ['id', 'label', 'ethnicity', 'country', 'region'],
  sample: ['n', 'nMale', 'nFemale', 'ageMin', 'ageMax', 'ageMean'],
  curation: ['extractedBy', 'comparedOn', 'date', 'notes'],
  scale: ['kind', 'percent', 'source'],
  secondHand: ['via'],
  entry: ['measurement', 'sex', 'ageBand', 'mean', 'sd', 'sdSource', 'range', 'n', 'nMale', 'nFemale', 'unit', 'source', 'definitionMatch', 'definitionNote', 'clinicalTarget', 'centre', 'fromOtherSex', 'note'],
  range: ['low', 'high'],
  sdSource: ['set', 'source'],
} as const;

/** Owner ruling P44-STRICT (12 Oct; final review I-5): record numbers with table and page, never the
 *  article's text. A quoted span — "…", “…”, ‘…’, or '…' opened after a space or bracket (so an
 *  apostrophe is not a quote) — of MAX_QUOTED_WORDS or more words in a prose field is refused.
 *  Short quoted labels (a row or column heading) stay allowed. */
export const MAX_QUOTED_WORDS = 8;
const QUOTED = /"([^"]+)"|“([^”]+)”|‘([^’]+)’|(?<=^|[\s(\[])'(.+?)'(?![\p{L}])/gu;
const WORD = /[\p{L}\p{N}][\p{L}\p{N}_'’.,–−-]*/gu;

/** The word counts of every quoted span of MAX_QUOTED_WORDS or more words in `text`. */
export function longQuotes(text: string): number[] {
  const out: number[] = [];
  for (const m of text.matchAll(QUOTED)) {
    const span = m[1] ?? m[2] ?? m[3] ?? m[4] ?? '';
    const words = span.match(WORD)?.length ?? 0;
    if (words >= MAX_QUOTED_WORDS) out.push(words);
  }
  return out;
}

function quoteProblems(text: unknown, where: string): string[] {
  if (typeof text !== 'string') return [];
  return longQuotes(text).map((n) => `${where}quoted span of ${n} words; paraphrase it with its page (P44: numbers only, never article text)`);
}

/** "unknown key" problems for a plain object; `where` is a prefix such as "citation: " ('' for none). */
function unknownKeys(obj: unknown, allowed: readonly string[], where: string): string[] {
  if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) return [];
  return Object.keys(obj).filter((k) => !allowed.includes(k)).map((k) => `${where}unknown key "${k}"`);
}

const isNonEmptyString = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';
const isStringArray = (v: unknown): boolean => Array.isArray(v) && v.every((x) => typeof x === 'string');

function entryKey(e: NormEntry): string {
  return `${e.measurement}|${e.sex}|${e.ageBand ? `${e.ageBand[0]}-${e.ageBand[1]}` : 'none'}`;
}

/** Validates one entry (within its set's status). Returns problem suffixes (without the
 *  "<setId>: entries[i]: " prefix, which the caller adds). */
function validateEntry(e: any, status: string): string[] {
  const out: string[] = [];

  out.push(...unknownKeys(e, ALLOWED_KEYS.entry, ''));
  out.push(...unknownKeys(e.range, ALLOWED_KEYS.range, 'range: '));
  out.push(...unknownKeys(e.sdSource, ALLOWED_KEYS.sdSource, 'sdSource: '));
  for (const k of ['note', 'definitionNote', 'source', 'clinicalTarget'] as const) out.push(...quoteProblems(e[k], k === 'source' ? 'source: ' : `${k}: `));
  if (!SEXES.includes(e.sex)) out.push(`sex must be one of ${SEXES.join(', ')}`);
  if (!DEFINITION_MATCHES.includes(e.definitionMatch)) out.push(`definitionMatch must be one of ${DEFINITION_MATCHES.join(', ')}`);

  let catalogueUnit: string | undefined;
  let catalogueOk = false;
  if (typeof e?.measurement !== 'string') {
    out.push('measurement is required');
  } else {
    try {
      const cat = byId(e.measurement as any);
      if (cat.retired) {
        out.push(`catalogue id "${e.measurement}" is retired`);
      } else {
        catalogueOk = true;
        catalogueUnit = cat.unit;
      }
    } catch {
      out.push(`unknown catalogue id "${e.measurement}"`);
    }
  }

  if (catalogueOk && e.unit !== catalogueUnit) {
    out.push(`unit "${e.unit}" differs from the catalogue unit "${catalogueUnit}"`);
  }

  const hasMean = e.mean !== undefined && e.mean !== null;
  const hasRange = e.range !== undefined && e.range !== null;
  if (!hasMean && !hasRange) {
    out.push('an entry needs a mean or a range');
  }

  if (e.sd === null) {
    out.push('sd is null: leave sd out when the paper prints none');
  } else if (e.sd !== undefined) {
    if (!(e.sd > 0)) out.push('sd must be > 0');
  }

  if (hasRange) {
    const { low, high } = e.range;
    if (!(low < high)) out.push('range low must be below high');
  }

  if (!e.source || typeof e.source !== 'string' || e.source.trim() === '') {
    out.push('source is mandatory');
  }

  if (e.definitionMatch === 'close' || e.definitionMatch === 'different') {
    if (!e.definitionNote || typeof e.definitionNote !== 'string' || e.definitionNote.trim() === '') {
      out.push(`definitionMatch "${e.definitionMatch}" needs a definitionNote`);
    }
  }

  if (e.ageBand !== undefined && e.ageBand !== null) {
    const [low, high] = e.ageBand;
    if (!(low <= high)) out.push('ageBand must be [low, high] with low <= high');
  }

  out.push(...plausibilityErrors({ measurement: e.measurement, unit: e.unit, mean: hasMean ? e.mean : null, sd: e.sd, range: hasRange ? e.range : null }));

  if (e.centre !== undefined && !CENTRES.includes(e.centre)) {
    out.push(`centre must be one of ${CENTRES.join(', ')} when present`);
  }

  if (e.fromOtherSex !== undefined) {
    // Owner R-2 (P38): a row that repeats the other sex's printed values.
    if (e.fromOtherSex !== 'M' && e.fromOtherSex !== 'F') out.push("fromOtherSex must be 'M' or 'F'");
    else if (e.sex === 'pooled' || e.fromOtherSex === e.sex) out.push("fromOtherSex must name the other sex of a 'M' or 'F' row");
    if (typeof e.note !== 'string' || e.note.trim() === '') out.push('a fromOtherSex row needs a note saying why');
  }

  // Owner I1 (a), 3 Nov 2026: a both-sexes row's own men/women split — both or neither, whole people, adding up to n.
  if (e.nMale !== undefined || e.nFemale !== undefined) {
    const whole = (x: unknown) => typeof x === 'number' && Number.isInteger(x) && x >= 1;
    if (e.sex !== 'pooled') out.push("nMale/nFemale belong on a both-sexes ('pooled') row");
    else if (!whole(e.nMale) || !whole(e.nFemale)) out.push('nMale and nFemale must both be given, each a whole number of at least 1');
    else if (e.n !== undefined && e.nMale + e.nFemale !== e.n) out.push(`nMale + nFemale (${e.nMale + e.nFemale}) must equal n (${e.n})`);
  }

  const hasSdSource = e.sdSource !== undefined && e.sdSource !== null;
  if (hasSdSource) {
    if (status === 'website') {
      out.push('a website set may not carry sdSource');
    } else if (!e.sdSource.set || !e.sdSource.source) {
      out.push('sdSource must name a set id and a location');
    }
  }

  return out;
}

/** Validates every set-level field of the format (everything except `entries`, which the caller
 *  handles separately). Returns problem suffixes without the "<setId>: " prefix. */
function validateSetLevel(s: any): string[] {
  const out: string[] = [];

  // magnificationCorrected has its own, clearer message below.
  out.push(...unknownKeys(s, [...ALLOWED_KEYS.set, 'magnificationCorrected'], ''));
  for (const k of ['citation', 'population', 'sample', 'curation', 'scale', 'secondHand'] as const) {
    out.push(...unknownKeys(s[k], ALLOWED_KEYS[k], `${k}: `));
  }

  if (Array.isArray(s.caveats)) s.caveats.forEach((c: unknown, i: number) => out.push(...quoteProblems(c, `caveats[${i}]: `)));
  out.push(...quoteProblems(s.curation?.notes, 'curation.notes: '));
  out.push(...quoteProblems(s.scale?.source, 'scale.source: '));
  out.push(...quoteProblems(s.secondHand?.via, 'secondHand.via: '));

  if (!KINDS.includes(s.kind)) out.push(`kind must be one of ${KINDS.join(', ')}`);
  if (!STATUSES.includes(s.status)) out.push(`status must be one of ${STATUSES.join(', ')}`);

  if (typeof s.citation !== 'object' || s.citation === null) {
    out.push('citation is required');
  } else {
    const c = s.citation;
    if (!isNonEmptyString(c.authors)) out.push('citation.authors must be a non-empty string');
    if (!isNonEmptyString(c.title)) out.push('citation.title must be a non-empty string');
    if (c.undated !== undefined && c.undated !== true) {
      out.push('citation.undated must be true when present');
    }
    if (c.undated === true) {
      if (c.year !== undefined) out.push('citation.year: an undated source has no year');
    } else if (!(typeof c.year === 'number' && Number.isInteger(c.year) && c.year >= 1900 && c.year <= 2100)) {
      out.push('citation.year must be an integer in [1900, 2100] (or mark the source undated: true)');
    }
    if (typeof c.openAccess !== 'boolean') out.push('citation.openAccess must be a boolean');
    for (const field of ['journal', 'volume', 'pages', 'doi', 'pmid', 'pmcid', 'url'] as const) {
      if (c[field] !== undefined && typeof c[field] !== 'string') {
        out.push(`citation.${field} must be a string when present`);
      }
    }
  }

  if (typeof s.population !== 'object' || s.population === null) {
    // "unknown population id" (checked by the caller) already covers a missing population.
  } else {
    if (!isNonEmptyString(s.population.label)) out.push('population.label must be a non-empty string');
    if (!isStringArray(s.population.ethnicity)) out.push('population.ethnicity must be an array of strings');
  }

  if (typeof s.sample !== 'object' || s.sample === null) {
    out.push('sample is required');
  } else {
    for (const field of ['n', 'nMale', 'nFemale', 'ageMin', 'ageMax', 'ageMean'] as const) {
      const v = s.sample[field];
      if (v !== undefined && !(typeof v === 'number' && v >= 0)) {
        out.push(`sample.${field} must be >= 0 when present`);
      }
    }
  }

  if (!SELECTIONS.includes(s.selection)) out.push(`selection must be one of ${SELECTIONS.join(', ')}`);
  if (!MODALITIES.includes(s.modality)) out.push(`modality must be one of ${MODALITIES.join(', ')}`);
  if (!HEAD_POSITIONS.includes(s.headPosition)) out.push(`headPosition must be one of ${HEAD_POSITIONS.join(', ')}`);
  if (Object.prototype.hasOwnProperty.call(s, 'magnificationCorrected')) {
    out.push('magnificationCorrected is replaced by scale (Task 4b)');
  }

  if (s.scale === undefined || s.scale === null) {
    out.push('scale is required');
  } else if (typeof s.scale !== 'object') {
    out.push("scale must be an object { kind: 'true-size' | 'enlarged' | 'not-stated' }");
  } else {
    const sc = s.scale;
    if (!FILM_SCALE_KINDS.includes(sc.kind)) {
      out.push(`scale.kind must be one of ${FILM_SCALE_KINDS.join(', ')}`);
    } else {
      if (sc.kind === 'true-size' || sc.kind === 'enlarged') {
        if (!isNonEmptyString(sc.source)) out.push('scale.source must be a non-empty string');
      }
      if (sc.kind === 'enlarged') {
        if (!(typeof sc.percent === 'number' && Number.isFinite(sc.percent) && sc.percent > 0 && sc.percent <= 20)) {
          out.push('scale.percent must be a finite number > 0 and <= 20');
        }
      } else if (sc.percent !== undefined) {
        out.push("percent only belongs to an 'enlarged' scale");
      }
    }
  }

  if (typeof s.curation !== 'object' || s.curation === null) {
    out.push('curation is required');
  } else {
    const cu = s.curation;
    if (!Array.isArray(cu.extractedBy) || cu.extractedBy.length === 0 || !isStringArray(cu.extractedBy)) {
      out.push('curation.extractedBy must be a non-empty array of strings');
    }
    if (!isNonEmptyString(cu.date)) out.push('curation.date is mandatory');
  }

  if (!isStringArray(s.caveats)) out.push('caveats must be an array of strings');

  if (s.secondHand !== undefined) {
    if (typeof s.secondHand !== 'object' || s.secondHand === null || !isNonEmptyString(s.secondHand.via)) {
      out.push('secondHand.via must be a non-empty string when secondHand is present');
    }
  }

  if (s.analyses !== undefined && s.kind !== 'analysis-own') {
    out.push('analyses is only allowed for kind "analysis-own"');
  }

  return out;
}

/** Validates a norm set (unknown input: may be anything). Returns an empty array when the set is
 *  valid, otherwise one string per problem, each naming the set id and the entry index
 *  ("<id>: entries[i]: <problem>"), or "<id>: <problem>" for set-level problems. */
export function validateSet(set: unknown, ctx: { populations: string[] }): string[] {
  if (typeof set !== 'object' || set === null) return ['norm set is not an object'];
  const s = set as any;
  const id = typeof s.id === 'string' && s.id.trim() !== '' ? s.id : '(no id)';
  const problems: string[] = [];

  if (typeof s.id !== 'string' || s.id.trim() === '') problems.push(`${id}: id is required`);

  for (const p of validateSetLevel(s)) problems.push(`${id}: ${p}`);

  if (s.ageRows !== undefined && s.ageRows !== 'interpolate') problems.push(`${id}: ageRows must be 'interpolate' when present`);

  if (s.kind === 'analysis-own') {
    if (!Array.isArray(s.analyses) || s.analyses.length === 0) {
      problems.push(`${id}: an analysis-own set must name at least one analysis id`);
    } else {
      for (const a of s.analyses) {
        if (!ANALYSIS_IDS.has(a)) problems.push(`${id}: unknown analysis id "${a}"`);
      }
    }
  }

  if (!s.population || !ctx.populations.includes(s.population.id)) {
    problems.push(`${id}: unknown population id "${s.population?.id}"`);
  }

  if (!Array.isArray(s.entries)) {
    problems.push(`${id}: entries must be an array`);
  } else {
    const seen = new Map<string, number>();
    s.entries.forEach((e: any, i: number) => {
      if (typeof e !== 'object' || e === null) {
        problems.push(`${id}: entries[${i}]: entry must be an object`);
        return;
      }
      for (const p of validateEntry(e, s.status)) {
        problems.push(`${id}: entries[${i}]: ${p}`);
      }
      const key = entryKey(e);
      if (seen.has(key)) {
        problems.push(`${id}: entries[${i}]: duplicates entries[${seen.get(key)}] (same measurement, sex and age band)`);
      } else {
        seen.set(key, i);
      }
    });
    // Ruling P34 (Task 6 fix round 1): the resolver takes a band-less row only for a sex with no age
    // bands of its own, so beside banded rows of the same measurement and sex it is unreachable
    // whenever the patient's age is known.
    const bandedKeys = new Set(
      s.entries.filter((e: any) => e && typeof e === 'object' && Array.isArray(e.ageBand)).map((e: any) => `${e.measurement}|${e.sex}`),
    );
    s.entries.forEach((e: any, i: number) => {
      if (e && typeof e === 'object' && e.ageBand === undefined && bandedKeys.has(`${e.measurement}|${e.sex}`)) {
        problems.push(`${id}: entries[${i}]: a band-less row is unreachable when the patient's age is known; give it an age band`);
      }
    });
    // Owner R-1 (P38): an 'interpolate' set holds printed ages only — [a, a], or an open adult row [a, 99].
    if (s.ageRows === 'interpolate') {
      s.entries.forEach((e: any, i: number) => {
        if (e && typeof e === 'object' && Array.isArray(e.ageBand) && !(e.ageBand[0] === e.ageBand[1] || e.ageBand[1] >= 99)) {
          problems.push(`${id}: entries[${i}]: in an 'interpolate' set an age band is one printed age [a, a] or an open adult row [a, 99]`);
        }
      });
    }
    // Ruling P36 (Task 7): two age bands of one measurement and sex that overlap (bands are inclusive,
    // so sharing an end year is an overlap) leave the resolver unable to tell which applies.
    s.entries.forEach((e: any, i: number) => {
      if (!e || typeof e !== 'object' || !Array.isArray(e.ageBand)) return;
      for (let j = 0; j < i; j++) {
        const o = s.entries[j];
        if (!o || typeof o !== 'object' || !Array.isArray(o.ageBand) || o.measurement !== e.measurement || o.sex !== e.sex) continue;
        if (entryKey(o) === entryKey(e)) continue; // an exact duplicate is reported above
        if (e.ageBand[0] <= o.ageBand[1] && o.ageBand[0] <= e.ageBand[1]) {
          problems.push(`${id}: entries[${i}]: age bands of one measurement and sex must not overlap (entries[${j}]); the resolver could not tell which applies`);
        }
      }
    });
  }

  return problems;
}
