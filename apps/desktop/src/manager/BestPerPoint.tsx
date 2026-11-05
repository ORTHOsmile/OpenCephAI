import { useCallback, useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { ask } from '@tauri-apps/plugin-dialog';
import { models, WEIGHTS_CHECK_EVENT, type BestPerPoint, type ModelCheck, type WeightsCheckProgress } from '../ipc';
import type { DateFormat } from '../dates';
import { partFLine, switchesApplyWords } from '../ai/autoBestWords';
import { blockWords, checkPointWords, checkStatusWords, checkWarning, filmsWords, goBackWords, leftOutWords, pairBasisWords, pairLeftOutWords, pointSummary, shownBlock, switchesInForce, switchWords, verdictWords } from './bestWords';

type Answer = 'accept' | 'decline' | 'undo';

/** Owner Q4: each model whose file changed, checked on your older films. Never switches anything by itself. */
export function WeightsChecks({ checks, titleOf, msPerFilmOf, progress, onGoBack, baseTitle = 'Aariz' }: {
  checks: ModelCheck[]; baseTitle?: string; titleOf: (id: string) => string; msPerFilmOf: (id: string) => number | null; progress: WeightsCheckProgress | null;
  onGoBack: (landmarkId: string, modelId: string) => void;
}) {
  if (!checks.length) return null;
  return (
    <div className="best-checks">
      <h4>Model file checks</h4>
      {checks.map((c) => {
        const warn = checkWarning(c, titleOf);
        return (
          <div key={`${c.modelId}-${c.fingerprint}`} data-model={c.modelId}>
            <p className="identity-note">{checkStatusWords(c, titleOf, msPerFilmOf(c.modelId), progress)}</p>
            {warn && <p className="error" role="alert">{warn}</p>}
            <ul>{c.points.filter((p) => p.films > 0 || p.noNewPoint > 0).map((p) => <li key={p.landmarkId} data-point={p.landmarkId}>{checkPointWords(p)}</li>)}</ul>
            {c.goBack.map((lm) => <button type="button" key={lm} onClick={() => onGoBack(lm, c.modelId)}>{goBackWords(lm, baseTitle)}</button>)}
          </div>
        );
      })}
    </div>
  );
}

/** Part F: Library › Models… › "Best model per point" (Part F design "What you will see"; owner E1–E4). Numbers from your
 *  own verified films, ruler films first; Accept / Decline on an offer, Undo on a switch. Nothing switches unless you
 *  click, and points already placed on your films never change. */
export function BestPerPointView({ data, error, notice, titleOf, dateFormat, onAnswer, progress, msPerFilmOf, autoBestMain, base = 'aariz-cepha29', baseTitle = 'Aariz', headed = true, fixedMain = null }: {
  data: BestPerPoint | null; error: string | null; notice: string | null; titleOf: (id: string) => string; dateFormat: DateFormat;
  onAnswer: (landmarkId: string, modelId: string, answer: Answer) => void;
  progress?: WeightsCheckProgress | null; msPerFilmOf?: (id: string) => number | null;
  /** D3: while Automatic best is the main model, Part F's own Accept/Decline switches do not apply. */
  autoBestMain?: boolean;
  /** The base model (spec 2026-10-29): every verdict is a comparison with it. Aariz unless chosen. */
  base?: string; baseTitle?: string;
  /** false inside Settings › Best model, whose fold already carries the title (spec §2a). */
  headed?: boolean;
  /** The fixed main model (null while Automatic best is main, or unknown): switches apply only when it is the base. */
  fixedMain?: string | null;
}) {
  const head = headed ? <h3>Best model per point</h3> : null;
  if (error) return <section className="best-per-point" aria-label="Best model per point">{head}<p className="error">{error}</p></section>;
  if (!data) return <section className="best-per-point" aria-label="Best model per point">{head}<p className="identity-note">Reading your verified films…</p></section>;
  const switches = switchesInForce(data.choices);
  return (
    <section className="best-per-point" aria-label="Best model per point">
      {head}
      <p className="identity-note">From your own verified films, in the order you imported them, measured in millimetres with each film's own scale.
        Ruler films decide when a point has 20 of them; otherwise machine-scaled, then fitted, then assumed-scale films (an estimate).
        Sharper images count more. {baseTitle} places every point unless you accept a switch. Points already placed on your films never change.
        Rule {data.ruleVersion}.</p>
      {autoBestMain && <p className="identity-note auto-best-line">{partFLine(baseTitle)}</p>}
      {!autoBestMain && fixedMain && fixedMain !== base && <p className="identity-note auto-best-line">{switchesApplyWords(baseTitle)}</p>}
      {notice && <p className="error">{notice}</p>}
      <table className="best-table">
        <thead><tr><th>Point</th><th>Model</th><th>Films</th><th>Result</th><th /></tr></thead>
        <tbody>
          {data.points.flatMap((p) => {
            const left = leftOutWords(p), films = filmsWords(p), one = pointSummary(p, titleOf, base);
            if (one) return [<tr key={p.landmarkId} data-point={p.landmarkId}><td>{p.landmarkId}</td><td colSpan={3}>{one}
              {films && <div className="identity-note">{films}</div>}{left && <div className="identity-note">{left}</div>}</td><td /></tr>];
            return p.pairs.map((pr) => {
              const b = shownBlock(pr.verdict), offered = p.offer === pr.modelId, pairLeft = pairLeftOutWords(pr);
              return (
                <tr key={`${p.landmarkId}-${pr.modelId}`} data-point={p.landmarkId} data-model={pr.modelId}>
                  <td>{p.landmarkId}</td><td>{titleOf(pr.modelId)}</td><td>{pr.films}</td>
                  <td><div className="verdict">{verdictWords(pr, titleOf, baseTitle)}</div>
                    <div className="identity-note">{pairBasisWords(pr)}</div>
                    {b && <div className="identity-note">{blockWords(b, titleOf(pr.modelId), baseTitle)}</div>}
                    {films && <div className="identity-note">{films}</div>}
                    {left && <div className="identity-note">{left}</div>}
                    {pairLeft && <div className="identity-note">{pairLeft}</div>}</td>
                  <td>{offered && !autoBestMain && <span className="row">
                    <button type="button" className="primary" onClick={() => onAnswer(p.landmarkId, pr.modelId, 'accept')}>Accept</button>
                    <button type="button" onClick={() => onAnswer(p.landmarkId, pr.modelId, 'decline')}>Decline</button></span>}</td>
                </tr>
              );
            });
          })}
        </tbody>
      </table>
      <h4>Your switches</h4>
      {switches.length === 0 ? <p className="identity-note">None: {baseTitle} places every point.</p> : (
        <ul className="best-switches">{switches.map((c) => (
          <li key={c.id} data-point={c.landmarkId}>{switchWords(c, titleOf, dateFormat)}{' '}
            <button type="button" onClick={() => onAnswer(c.landmarkId, c.modelId, 'undo')}>Undo</button></li>))}</ul>)}
      <WeightsChecks checks={data.checks ?? []} baseTitle={baseTitle} titleOf={titleOf} msPerFilmOf={msPerFilmOf ?? (() => null)} progress={progress ?? null} onGoBack={(l, m) => onAnswer(l, m, 'undo')} />
    </section>
  );
}

/** Reads the verdicts on mount and after every answer. Accept asks first (it changes which model places new points). */
export function useBestPerPoint(titleOf: (id: string) => string) {
  const [data, setData] = useState<BestPerPoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const refresh = useCallback(() => {
    models.bestPerPoint().then((d) => { setData(d); setError(null); }).catch((e) => setError(`Best model per point couldn't be read: ${String(e)}`));
  }, []);
  useEffect(refresh, [refresh]);
  const [progress, setProgress] = useState<WeightsCheckProgress | null>(null);
  useEffect(() => {
    models.weightsCheckRun().catch(() => {});
    let unlisten: (() => void) | undefined, gone = false;
    listen<WeightsCheckProgress>(WEIGHTS_CHECK_EVENT, (e) => {
      setProgress(e.payload.modelId ? e.payload : null);
      if (!e.payload.modelId || e.payload.done === e.payload.total) refresh();
    }).then((u) => { if (gone) u(); else unlisten = u; }).catch(() => {});
    return () => { gone = true; unlisten?.(); };
  }, [refresh]);
  const answer = useCallback(async (landmarkId: string, modelId: string, a: Answer) => {
    if (a === 'accept' && !(await ask(`From now on, ${titleOf(modelId)} places ${landmarkId} on new tracings and when you Re-detect. `
      + 'Points already placed on your films do not change. You can undo this.', { title: 'Switch this point', kind: 'info' }))) return;
    try { await models.answerPoint(landmarkId, modelId, a); setNotice(null); } catch (e) { setNotice(`That answer was not saved: ${String(e)}`); }
    refresh();
  }, [refresh, titleOf]);
  return { data, error, notice, progress, answer };
}
