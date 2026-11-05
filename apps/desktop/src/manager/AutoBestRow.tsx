import type { ReactNode } from 'react';
import type { AutoBestMap, ModelRow } from '../ipc';
import { shortName } from '../ai/pointLabel';
import { baseOf } from '../ai/placement';
import { AUTO_BEST_TITLE, autoBestWhat, needsBaseWords, NO_MODEL, usesSummary } from '../ai/autoBestWords';

/** Models… › Automatic best (spec §2): above the real models; its "Starts the tracing" shares their radio group. Beside
 *  it, the base drop-down (spec 2026-10-29 §2, owner answer 4 B) and the way to Settings › Best model. Greyed out, with a
 *  plain reason, when no model is installed or the base is not. Recent changes and "Best model per point" live in
 *  Settings › Best model (spec 2026-10-29 §2). */
export function AutoBestRow({ state, error, titleOf, onMain, rows, baseSelect = null, onOpenSettings }: {
  state: AutoBestMap | null; error: string | null; titleOf: (m: string) => string;
  onMain: () => void;
  /** Models…'s rows (to tell "no model installed" from "the base is not installed"); absent: not known. */
  rows?: ModelRow[]; baseSelect?: ReactNode; onOpenSettings?: () => void;
}) {
  const head = <div className="model-head"><b>{AUTO_BEST_TITLE}</b><span className="chip">Made from your verified films</span></div>;
  if (error) return <section className="auto-best-row" aria-label={AUTO_BEST_TITLE}>{head}<p className="error">{error}</p></section>;
  if (!state) return null;
  // Points without evidence use the base, as the main model and as a ghost beside a fixed one (owner answer 2, 29 Oct).
  const baseTitle = shortName(baseOf(state), titleOf);
  const noModel = rows !== undefined && !rows.some((r) => r.status === 'ready');
  return (
    <section className="auto-best-row" aria-label={AUTO_BEST_TITLE} data-id="auto-best">
      {head}
      <div className="identity-note">{autoBestWhat(baseTitle)}</div>
      <div className="row"><label><input type="radio" name="main-model" checked={state.on} disabled={!state.available} onChange={onMain} />Starts the tracing</label>
        {baseSelect}{onOpenSettings && <button type="button" onClick={onOpenSettings}>Best model settings…</button>}</div>
      {!state.available ? <p className="identity-note auto-best-greyed">{noModel ? NO_MODEL : needsBaseWords(baseTitle)}</p> : <>
        <p className="identity-note auto-best-summary">{usesSummary(state, baseTitle, titleOf)}</p>
      </>}
    </section>
  );
}
