import type { Unit } from '@ceph/geometry';

export type NormSex = 'M' | 'F' | 'pooled';
export type DefinitionMatch = 'same' | 'close' | 'different'; // appendix §4 wording
export type SetStatus = 'verified' | 'single-extracted' | 'pending' | 'website';
export type SetKind = 'analysis-own' | 'population' | 'research-sd';

/** How a paper's film-based mm values relate to true size (owner rulings M-1, M-2, 8 Oct).
 *  'true-size': the paper says its values are true size / corrected, or an owner ruling says so
 *  (e.g. the NUS sheet). 'enlarged': the paper says its mm values INCLUDE this film enlargement
 *  (0 < percent <= 20); the norm is reported at true size, printed ÷ (1 + percent/100).
 *  'not-stated': the paper says nothing about film scale; assumed true size, as modern papers
 *  report (owner M-2). Angular, '%' and ratio measurements are never affected by scale. */
export type FilmScale = { kind: 'true-size'; source: string } | { kind: 'enlarged'; percent: number; source: string } | { kind: 'not-stated' };

export interface NormEntry {
  measurement: string; // catalogue id, e.g. 'm01_SNA' (byId must resolve; not retired)
  sex: NormSex;
  ageBand?: [number, number]; // years, inclusive; absent = any age / adult sample
  mean?: number; // at least one of mean or range
  sd?: number; // > 0
  sdSource?: { set: string; source: string }; // N3: SD taken from another set's entry (its id and table/page)
  range?: { low: number; high: number }; // low < high
  n?: number;
  unit: Unit; // must equal the catalogue entry's unit ('' = a ratio, @ceph/geometry Unit)
  source: string; // mandatory exact location, e.g. 'Table 2, p. 4'
  definitionMatch: DefinitionMatch;
  definitionNote?: string; // required when definitionMatch is 'close' or 'different'
  clinicalTarget?: string; // N1
  /** Task 4c (owner B-2): what the mean is. Absent or 'sample-mean': the mean of the paper's own
   *  sample. 'ideal': the author's ideal or clinical target (Steiner's ideals, Holdaway's standards,
   *  Ricketts' clinical norms with no SD) — flagged 'ideal', and a range-only ideal is centred on its
   *  range's midpoint when an SD is borrowed for it. */
  centre?: 'sample-mean' | 'ideal';
  /** Owner R-2 (ruling P38, Task 7 fix round 1): this row repeats the OTHER sex's printed values
   *  because the author printed them for that sex only (Ricketts' adult rows are men's); flagged
   *  'other-sex-values' and said in the source line (the first clause of `note`, which is required). */
  fromOtherSex?: 'M' | 'F';
  note?: string; // e.g. the #31 +90° conversion, the #27 2.5° note
}

export interface NormSet {
  id: string; // 'zheng2026-adults', file name without .json
  kind: SetKind;
  analyses?: string[]; // for kind 'analysis-own': the analysis ids (ALL_ANALYSES ids) it is the own norm of
  status: SetStatus;
  citation: {
    authors: string;
    title: string;
    journal?: string;
    /** Required unless `undated` is true (validator). */
    year?: number;
    /** Task 5 fix round 1: the source prints no date (the NDC sheet). Then `year` must be absent; the
     *  source line reads "<name> (undated)" and the set ranks last on the year tie-break. */
    undated?: true;
    volume?: string;
    pages?: string;
    doi?: string;
    pmid?: string;
    pmcid?: string;
    url?: string;
    openAccess: boolean;
  };
  population: { id: string; label: string; ethnicity: string[]; country?: string; region?: string };
  sample: { n?: number; nMale?: number; nFemale?: number; ageMin?: number; ageMax?: number; ageMean?: number };
  selection: 'class-I-balanced' | 'class-I' | 'ideal-aesthetic' | 'random-unselected' | 'mixed-occlusion' | 'unknown';
  modality: 'film' | 'digital' | 'cbct-derived' | 'unknown';
  scale: FilmScale;
  headPosition: 'FH' | 'NHP' | 'unknown';
  secondHand?: { via: string }; // e.g. Holdaway 1983 via AlBarakati 2012 Table 3
  /** Owner R-1 (ruling P38, Task 7 fix round 1): the author printed values at single ages (each
   *  entry's ageBand is [a, a]; an open adult row [a, 99] is the point a, holding beyond it). For a
   *  known age between two printed ages the resolver interpolates linearly, flagged 'interpolated'. */
  ageRows?: 'interpolate';
  curation: { extractedBy: string[]; comparedOn?: string; date: string; notes?: string };
  caveats: string[];
  entries: NormEntry[];
}
