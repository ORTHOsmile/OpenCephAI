import type { BestBlock, BestPair, BestPoint, BestVerdict, CheckPoint, ModelCheck, PointChoice, Tier, WeightsCheckProgress } from '../ipc';
import { formatDate, type DateFormat } from '../dates';
/** For the words only; the rule's own constants are BLOCK_FILMS and MIN_TIER_FILMS in crates/ceph-model/src/best.rs. */
const BLOCK = 30, MIN_TIER = 20;
const TIERS: Tier[] = ['ruler', 'machine', 'fit', 'assumed'];
const TIER_NOUN: Record<Tier, string> = { ruler: 'ruler', machine: 'machine-scaled', fit: 'fitted', assumed: 'assumed-scale' };
const mm = (x: number) => `${x.toFixed(2)} mm`;

/** The deciding group, in the record's own words (best.rs `basis_words`; owner E1: the measure that decided). */
export function basisWords(tier: Tier, films: number): string {
  switch (tier) {
    case 'ruler': return `mm, ${films} ruler films`;
    case 'machine': return `mm via machine scale, ${films} films`;
    case 'fit': return `mm via fit scale, ${films} films`;
    case 'assumed': return `mm via assumed scale (an estimate), ${films} films`;
  }
}
/** Part F: the rule's verdict for one point and model, in the owner's words (Part F design "The decision rule" item 5). */
export function verdictWords(p: BestPair, titleOf: (id: string) => string, baseTitle = 'Aariz'): string {
  const v = p.verdict;
  switch (v.kind) {
    case 'notEnough': return p.basis === null ? 'too few films on any one scale' : `not enough films (${v.films} of ${BLOCK})`;
    case 'reCheck': return `passed the first ${BLOCK}; re-checking (${v.films} of the next ${BLOCK})`;
    case 'keep': return `keep ${baseTitle} (next look: ${v.films} of ${BLOCK})`;
    case 'offer': return `offer: switch to ${titleOf(p.modelId)}`;
  }
}
/** Owner E2, E4: which films decided, and which were not used; or, with no scale group of 20, each group's count. */
export function pairBasisWords(p: BestPair): string {
  const a = p.available;
  if (p.basis === null) return `Too few films on any one scale: ruler ${a.ruler} · machine ${a.machine} · fit ${a.fit} · assumed ${a.assumed} (a scale group needs ${MIN_TIER})`;
  const unused = TIERS.filter((t) => t !== p.basis && a[t] > 0).map((t) => `${a[t]} ${TIER_NOUN[t]}`);
  return `Decided on ${basisWords(p.basis, p.films)}${unused.length ? ` · not used: ${unused.join(', ')}` : ''}`;
}
/** The block whose numbers explain the verdict. */
export function shownBlock(v: BestVerdict): BestBlock | null {
  switch (v.kind) {
    case 'offer': return v.check;
    case 'reCheck': return v.look;
    case 'keep': return v.check ?? v.look;
    case 'notEnough': return null;
  }
}
/** The block's numbers: the weighted medians that decide (owner E3) and, when the weighting moved them, the plain ones.
 *  The `incumbent` numbers are the base's (spec 2026-10-29 §3). */
export function blockWords(b: BestBlock, modelTitle: string, baseTitle = 'Aariz'): string {
  const base = `median ${baseTitle} ${mm(b.incumbentMedianMm)}, ${modelTitle} ${mm(b.challengerMedianMm)} · within 2 mm: ${baseTitle} ${b.incumbentWithin}, `
    + `${modelTitle} ${b.challengerWithin} of ${BLOCK} · ${b.acceptedUnmoved} of ${BLOCK} accepted unmoved`;
  const moved = mm(b.incumbentPlainMedianMm) !== mm(b.incumbentMedianMm) || mm(b.challengerPlainMedianMm) !== mm(b.challengerMedianMm);
  return moved ? `${base} · weighted by image resolution (plain median ${baseTitle} ${mm(b.incumbentPlainMedianMm)}, ${modelTitle} ${mm(b.challengerPlainMedianMm)})` : base;
}
/** The point's counted films per scale group, and how many ruler films were fine-tuned by eye; null with none. */
export function filmsWords(p: BestPoint): string | null {
  const f = p.filmsByScale, n = f.ruler + f.machine + f.fit + f.assumed;
  if (!n) return null;
  return `Films: ruler ${f.ruler} · machine ${f.machine} · fit ${f.fit} · assumed ${f.assumed}`
    + (p.fineTunedRuler ? ` (${p.fineTunedRuler} ruler films fine-tuned by eye)` : '');
}
export function leftOutWords(p: BestPoint): string | null {
  return p.leftOutOtherPlacer ? `Films left out — placed by another model: ${p.leftOutOtherPlacer}` : null;
}
/** Owner Q9: films left out for this model only, because a mark came from an earlier model file (Aariz's or this one's). */
export function pairLeftOutWords(p: BestPair): string | null {
  return p.leftOutEarlierFile ? `Films left out — measured with an earlier model file: ${p.leftOutEarlierFile}` : null;
}
/** The one line for a point with nothing to compare: switched, or no films yet. Null when it has rows to show. */
export function pointSummary(p: BestPoint, titleOf: (id: string) => string, base = 'aariz-cepha29'): string | null {
  if (p.current !== base) return `switched to ${titleOf(p.current)}`;
  return p.pairs.length ? null : 'no verified films yet';
}
/** The accepted switches still in force, one per point: the latest acceptance not undone after it. */
export function switchesInForce(choices: PointChoice[]): PointChoice[] {
  const inForce = new Map<string, PointChoice>();
  for (const c of choices) {
    if (c.action === 'accepted') inForce.set(c.landmarkId, c);
    else if (c.action === 'undone') inForce.delete(c.landmarkId);
  }
  return [...inForce.values()];
}
export function switchWords(c: PointChoice, titleOf: (id: string) => string, f: DateFormat): string {
  const v = (c.numbers as BestPair | null)?.verdict;
  const basis = c.basis ? ` — ${c.basis}` : '';
  const tail = v?.kind === 'offer' ? ` — re-check: ${blockWords(v.check, titleOf(c.modelId), recordedBaseTitle(c))}` : '';
  return `${c.landmarkId}: ${titleOf(c.modelId)} since ${formatDate(c.at, f)}, accepted by ${c.operator}${basis}${tail}`;
}

/** For the words only; the check's own constant is MIN_CHECK_FILMS in crates/ceph-model/src/regress.rs (owner Q15). */
const MIN_CHECK = 30;
/** Owner Q4: one point, the earlier file beside the new one over the same older films. */
export function checkPointWords(p: CheckPoint): string {
  const v = p.verdict;
  if (v.kind === 'noFilms' || p.oldMedianMm === null || p.newMedianMm === null) return `${p.landmarkId}: no older film to compare`;
  const base = `${p.landmarkId}: median ${p.oldMedianMm.toFixed(2)} → ${p.newMedianMm.toFixed(2)} mm · within 2 mm ${p.oldWithin} → ${p.newWithin} of ${p.films}`
    + (p.noNewPoint ? ` · no point from the new file on ${p.noNewPoint}` : '');
  if (v.kind === 'tooFew') return `${base} · too few films to judge (${p.films} of ${MIN_CHECK})`;
  if (v.kind === 'noWorse') return `${base} · no worse`;
  const why = [v.medianUp ? `median up ${(p.newMedianMm - p.oldMedianMm).toFixed(2)} mm` : '', v.fewerWithin ? 'fewer within 2 mm' : ''].filter(Boolean).join(', ');
  return `${base} · worse (${why})`;
}
/** The time a number of films should take at the model's measured speed (Models…), or null when unknown. */
export function etaWords(films: number, msPerFilm: number | null): string | null {
  if (!msPerFilm || films <= 0) return null;
  const s = Math.ceil((films * msPerFilm) / 1000);
  return s < 90 ? `${s} s` : `${Math.round(s / 60)} min`;
}
/** The model's line: the check's progress while it runs, then how many older films it covered. */
export function checkStatusWords(c: ModelCheck, titleOf: (id: string) => string, msPerFilm: number | null, progress: WeightsCheckProgress | null): string {
  const failed = c.filmsFailed ? ` · could not run on ${c.filmsFailed}${c.failedDetail ? ` (${c.failedDetail})` : ''}` : '';
  if (c.filmsDue > 0) {
    const mine = progress?.modelId === c.modelId ? progress : null;
    const done = mine ? mine.done : 0, total = mine ? mine.total : c.filmsDue, eta = etaWords(total - done, msPerFilm);
    return `${titleOf(c.modelId)} has a new file: checking it on your older films, ${done} of ${total}${eta ? ` (about ${eta} left)` : ''}${failed}`;
  }
  return `${titleOf(c.modelId)} has a new file: checked on ${c.filmsChecked} of your older films${failed}`;
}
const listWords = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);
/** A clear warning when the new file is worse on any point; it never switches anything. */
export function checkWarning(c: ModelCheck, titleOf: (id: string) => string): string | null {
  const worse = c.points.filter((p) => p.verdict.kind === 'worse').map((p) => p.landmarkId);
  return worse.length ? `Warning: ${titleOf(c.modelId)}'s new file is worse than its earlier one on your older films for ${listWords(worse)}. Nothing was switched.` : null;
}
export const goBackWords = (landmarkId: string, baseTitle = 'Aariz') => `Go back to ${baseTitle} for ${landmarkId}`;
/** The base an answer was judged against: its own record (`numbers.base`, from best-point/4), else Aariz — every rule
 *  before /4 (best-point/1 to /3) had only Aariz as the yardstick (final review I2). Never today's base. */
function recordedBaseTitle(c: PointChoice): string {
  const b = (c.numbers as { base?: unknown } | null)?.base;
  if (typeof b !== 'string' || !b) return 'Aariz';
  return ({ 'aariz-cepha29': 'Aariz', 'srpose-cldet23': 'SRPose', 'gu2net-isbi19': 'GU2Net', 'cwlachap-hrnet-w32': 'cwlachap' } as Record<string, string>)[b] ?? b;
}
