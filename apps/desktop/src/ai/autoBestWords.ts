import { LANDMARKS } from '@ceph/analyses';
import { formatDate, type DateFormat } from '../dates';
import type { AutoBestEvent, AutoBestMap, BaseChanged, IntroNote } from '../ipc';
import { ORIGINAL_19 } from './placement';
import { shortName } from './pointLabel';

/** Every sentence Automatic best shows (spec §2, §6a, §6b), in one place. */
export const AUTO_BEST_TITLE = 'Automatic best';
/** What Automatic best does, naming the base (spec 2026-10-29 §1: the starting model and the yardstick). */
export const autoBestWhat = (baseTitle: string): string =>
  `Places each point with the model your own verified films show is closest to your points there (Part F's rule); ${baseTitle} where no model has been shown closer yet. Nothing is approved for you.`;
/** Greyed out because the base is not installed (spec §2). */
export const needsBaseWords = (baseTitle: string): string => `Needs ${baseTitle}, the base model: install it, or choose another base in Settings › Best model.`;
/** Greyed out because no model is installed at all (spec §2). */
export const NO_MODEL = 'No model is installed yet: install one below.';
/** Part F's table while Automatic best is the main model: switches apply when the base is the fixed main model (final
 *  review C1, ruling A, 2 Nov). */
export const partFLine = (baseTitle: string): string =>
  `Automatic best is your main model: it uses each point's verdict by itself, with Undo. Your switches below apply when you choose ${baseTitle} as the main model.`;
/** Part F's table under a fixed main model that is not the base: the switches were judged against the base, so they do
 *  not apply (final review C1, ruling A). */
export const switchesApplyWords = (baseTitle: string): string =>
  `Switches apply when ${baseTitle} is the main model. ${baseTitle} is the yardstick every verdict below was measured against.`;
export const pointName = (id: string): string => { const n = (LANDMARKS as Record<string, { name: string }>)[id]?.name; return n ? `${n} (${id})` : id; };
const list = (ids: string[]) => (ids.length === 1 ? ids[0] : `${ids.slice(0, -1).join(', ')} and ${ids[ids.length - 1]}`);
/** Follow-up round (owner, 28 Oct): "Mark verified" pressed while a point is still coming waits for it. */
export const SIGN_WAITING = 'Waiting for a point still coming from another model before signing off.';
/** …and when it has come, the tracing is not signed off: you are asked to check the new point(s) first. */
export const signCheckWords = (ids: string[]): string =>
  `${list(ids.map(pointName))} arrived after you pressed Mark verified: check ${ids.length === 1 ? 'it' : 'them'}, then mark verified.`;
/** "mm, 60 ruler films" → "60 ruler films"; "mm via machine scale, 60 films" → "60 films (machine scale)". */
export function decidedOn(basis: string): string {
  const r = /^mm, (\d+) ruler films$/.exec(basis); if (r) return `${r[1]} ruler films`;
  const v = /^mm via (.+), (\d+) films$/.exec(basis); if (v) return `${v[2]} films (${v[1]})`;
  return basis;
}
/** Models…'s one line: which model it uses where, and the fallback for the rest. */
export function usesSummary(m: Pick<AutoBestMap, 'uses'>, fallback: string, titleOf: (m: string) => string): string {
  const by = new Map<string, string[]>();
  for (const id of ORIGINAL_19) { const u = m.uses[id]; if (u) by.set(u, [...(by.get(u) ?? []), id]); }
  const n = [...by.values()].reduce((a, v) => a + v.length, 0);
  if (!n) return `Uses ${fallback} for all 19 points: no point has enough evidence yet.`;
  const parts = [...by.entries()].map(([model, ids]) => `${shortName(model, titleOf)} for ${list([...ids].sort())}`);
  return `Uses ${parts.join(', ')}; ${fallback} for the other ${19 - n} point${19 - n === 1 ? '' : 's'}.`;
}
export function reasonWords(reason: AutoBestEvent['reason'], model: string): string {
  if (reason === 'file-changed') return `${model}'s file changed, so its evidence starts afresh`;
  if (reason === 'not-installed') return `${model} is no longer installed`;
  return `the evidence no longer favours ${model}`;
}
/** The base a row was written under, by name: its own `numbers.base` (best-point/4), else Aariz — every rule before /4
 *  had only Aariz as the yardstick (final review I2, M8). Never today's base: a change of base must not relabel history. */
const rowBaseTitle = (e: AutoBestEvent, titleOf: (m: string) => string): string => {
  const b = (e.numbers as { base?: unknown } | null)?.base;
  return shortName(typeof b === 'string' && b ? b : 'aariz-cepha29', titleOf);
};
/** Whether a row was written by a change of base (spec 2026-10-29 §6: `numbers.cause`); rows from 0.8.0 have none. */
const byBaseChange = (e: AutoBestEvent): boolean => (e.numbers as { cause?: unknown } | null)?.cause === 'base-changed';
/** Why a point went back to the base, in words. */
const returnWhy = (e: AutoBestEvent, m: string, baseTitle: string): string =>
  byBaseChange(e) ? `the base model changed, so it is judged again against ${baseTitle}` : reasonWords(e.reason, m);
/** Recent changes: the latest change at one point, naming the base the row was written under (`rowBaseTitle`). */
export function recentWords(e: AutoBestEvent, titleOf: (m: string) => string, f: DateFormat): string {
  const m = shortName(e.modelId, titleOf), at = formatDate(e.at, f), p = pointName(e.landmarkId), baseTitle = rowBaseTitle(e, titleOf);
  if (e.kind === 'undone') return `${p}: you kept ${e.uses ? shortName(e.uses, titleOf) : baseTitle} on ${at}; ${m} again only when newer films show it closer.`;
  if (e.kind === 'returned') return `${p}: back to ${baseTitle} on ${at} — ${returnWhy(e, m, baseTitle)}.`;
  return `${p}: ${m} since ${at}, decided on ${decidedOn(e.basis ?? '')}.`;
}
/** The note near the case panel (spec §6a): only adoptions and returns; the user's own Undo writes none. */
export function noteWords(e: AutoBestEvent, titleOf: (m: string) => string): string {
  const name = (LANDMARKS as Record<string, { name: string }>)[e.landmarkId]?.name ?? e.landmarkId, m = shortName(e.modelId, titleOf);
  const baseTitle = rowBaseTitle(e, titleOf);
  return e.kind === 'returned' ? `Automatic best: ${name} back to ${baseTitle} — ${returnWhy(e, m, baseTitle)}.`
    : `Automatic best: ${name} now from ${m}, decided on ${decidedOn(e.basis ?? '')}.`;
}
/** The one-line note after a change of base (spec §4), e.g. "Base model is now GU2Net: every point starts from GU2Net.
 *  Go and B no longer use SRPose: they were judged against Aariz." Points the change gave to a model are named too. */
export function baseChangedWords(c: BaseChanged, titleOf: (m: string) => string): string {
  const to = shortName(c.to, titleOf), from = shortName(c.from, titleOf);
  const head = `Base model is now ${to}: every point starts from ${to}.`;
  const group = (kind: string) => {
    const by = new Map<string, string[]>();
    for (const e of c.events.filter((x) => x.kind === kind)) by.set(e.modelId, [...(by.get(e.modelId) ?? []), e.landmarkId]);
    return [...by.entries()].map(([m, ids]) => [shortName(m, titleOf), [...ids].sort()] as const);
  };
  const left = group('returned').map(([m, ids]) => `${list(ids)} no longer ${ids.length === 1 ? 'uses' : 'use'} ${m}: ${ids.length === 1 ? 'it was' : 'they were'} judged against ${from}.`);
  const gained = group('adopted').map(([m, ids]) => `${list(ids)} ${ids.length === 1 ? 'uses' : 'use'} ${m} again.`);
  return [head, ...left, ...gained].join(' ');
}
/** The one-line upgrade note (spec §6b; owner D1; Q5 A adds the last sentence). */
export const introWords = (n: IntroNote): string => 'Automatic best now starts your tracings. It uses Aariz, except where your own verified films show another model is closer. Nothing is approved for you.'
  + (n.keptDeclines ? ' Your Part F declines are kept.' : '');
export const wayBackWords = (n: IntroNote, titleOf: (m: string) => string): string => `Go back to ${shortName(n.before ?? 'aariz-cepha29', titleOf)}`;
/** Owner, 28 Oct ("one mark, both names"): where Automatic best's ghost point coincides with the shown ghost of the
 *  model it uses there, one mark is drawn (the source model's), and this names both — e.g. "SRPose (Automatic best
 *  uses this)". Only the source model's own title goes in; Automatic best's own `title`/`titles` stay untouched
 *  (they are what shows when the source model's ghost is hidden and Automatic best's own mark stands alone). */
export const autoBestUsesThisWords = (sourceTitle: string): string => `${sourceTitle} (Automatic best uses this)`;
