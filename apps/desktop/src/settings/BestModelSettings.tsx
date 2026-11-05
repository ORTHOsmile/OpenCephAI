import { useCallback, useEffect, useState } from 'react';
import { models, type AutoBestEvent, type AutoBestMap, type ModelRow, type WeightsCheckProgress, type BestPerPoint } from '../ipc';
import type { DateFormat } from '../dates';
import { baseOf } from '../ai/placement';
import { shortName } from '../ai/pointLabel';
import { AUTO_BEST_TITLE, needsBaseWords, NO_MODEL, recentWords, usesSummary } from '../ai/autoBestWords';
import type { BaseControl } from '../ai/useBase';
import { BaseSelect } from '../manager/BaseSelect';
import { BestPerPointView, useBestPerPoint } from '../manager/BestPerPoint';
import { PanelSection } from '../layout/PanelSection';

/** The fold of "Best model per point" (spec §2a): setting `best_table_open`, '0' folded, anything else open. */
export const BEST_TABLE_KEY = 'best_table_open';
export const foldOpen = (v: string | null | undefined): boolean => v !== '0';
export const foldValue = (open: boolean): string => (open ? '1' : '0');

type Answer = 'accept' | 'decline' | 'undo';
/** Settings › Best model, the view (spec 2026-10-29 §2): from the top, Automatic best with the base drop-down, one line
 *  on what it uses today, Recent changes with Undo and "Use … again" (moved from Models…), then "Best model per point"
 *  in a fold, followed by the model file checks. */
export function BestModelSettingsView({ base, baseError, rows, titleOf, map, mapError, dateFormat, tableOpen, best, onChoose, onTable, onAnswer, onUndo, onRedo }: {
  base: string | null; baseError: string | null; rows: ModelRow[]; titleOf: (id: string) => string; map: AutoBestMap | null; mapError: string | null;
  dateFormat: DateFormat; tableOpen: boolean;
  best: { data: BestPerPoint | null; error: string | null; notice: string | null; progress: WeightsCheckProgress | null };
  onChoose: (id: string) => void; onTable: () => void; onAnswer: (landmarkId: string, modelId: string, a: Answer) => void;
  onUndo: (e: AutoBestEvent) => void; onRedo: (e: AutoBestEvent) => void;
}) {
  const anyModel = rows.some((r) => r.status === 'ready');
  const baseId = base ?? baseOf(map), baseTitle = shortName(baseId, titleOf);
  return (
    <div className="settings-best-model">
      <div className="row best-model-head"><h3>{AUTO_BEST_TITLE}</h3>
        <BaseSelect id="base-settings" base={base} rows={rows} titleOf={titleOf} disabled={!anyModel} onChoose={onChoose} error={baseError} /></div>
      {mapError && <p className="error">{mapError}</p>}
      {map && !map.available && <p className="identity-note auto-best-greyed">{anyModel ? needsBaseWords(baseTitle) : NO_MODEL}</p>}
      {map && map.available && <p className="identity-note auto-best-summary">{usesSummary(map, baseTitle, titleOf)}</p>}
      {map && map.latest.length > 0 && <>
        <h4>Recent changes</h4>
        <ul className="auto-best-recent">{map.latest.map((e) => (
          <li key={e.id} data-point={e.landmarkId}>{recentWords(e, titleOf, dateFormat)}{' '}
            {(e.kind === 'adopted' || e.kind === 'redone') && <button type="button" onClick={() => onUndo(e)}>Undo</button>}
            {e.kind === 'undone' && <button type="button" onClick={() => onRedo(e)}>Use {shortName(e.modelId, titleOf)} again</button>}</li>))}</ul>
      </>}
      <PanelSection title="Best model per point" collapsible={{ open: tableOpen, onToggle: onTable }}>
        <BestPerPointView headed={false} data={best.data} error={best.error} notice={best.notice} titleOf={titleOf} dateFormat={dateFormat} onAnswer={onAnswer}
          progress={best.progress} msPerFilmOf={(id) => rows.find((r) => r.id === id)?.msPerFilm ?? null} autoBestMain={!!map?.on} base={baseId} baseTitle={baseTitle}
          fixedMain={rows.find((r) => r.main)?.id ?? null} />
      </PanelSection>
    </div>
  );
}

/** Settings › Best model, wired: the one base state from App (`base`, shared with Models…), Automatic best's map read
 *  here and again after every change, Part F's table, and the fold kept by App (`tableOpen`, `onTable`). */
export function BestModelSettings({ base, rows, titleOf, tableOpen, onTable, onAutoBestUndone, dateFormat }: {
  base: BaseControl; rows: ModelRow[]; titleOf: (id: string) => string; tableOpen: boolean; onTable: () => void;
  onAutoBestUndone?: (e: AutoBestEvent, rows: AutoBestEvent[]) => unknown; dateFormat: DateFormat;
}) {
  const best = useBestPerPoint(titleOf);
  const [map, setMap] = useState<AutoBestMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const readMap = useCallback(() => {
    models.autoBest().then((m) => { setMap(m ?? null); setMapError(null); }).catch((e) => setMapError(`Automatic best couldn't be read: ${String(e)}`));
  }, []);
  useEffect(readMap, [readMap, base.base]);
  const act = (f: () => Promise<unknown>) => { f().catch((e) => setMapError(`That was not saved: ${String(e)}`)).finally(() => { readMap(); void base.refresh(); }); };
  useEffect(() => { void base.refresh(); }, []);   // eslint-disable-line react-hooks/exhaustive-deps -- read the base again on every open (final review M7)
  return <BestModelSettingsView base={base.base} baseError={base.errorFor('settings')} rows={rows} titleOf={titleOf} map={map} mapError={mapError} dateFormat={dateFormat}
    tableOpen={tableOpen} best={best} onChoose={(id) => void base.choose(id, 'settings')} onTable={onTable} onAnswer={(l, m, a) => void best.answer(l, m, a)}
    onUndo={(e) => act(async () => onAutoBestUndone?.(e, await models.autoBestUndo(e.landmarkId, e.id)))}
    onRedo={(e) => act(() => models.autoBestRedo(e.landmarkId, e.id))} />;
}
