import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { models, type AutoBestMap, type BaseChanged } from '../ipc';
import { baseOf } from './placement';

/** What both base drop-downs show (spec 2026-10-29 §2): the base (null until first read), the last error, and the note
 *  of the last change (null when nothing changed). */
export interface BaseState { base: string | null; error: string | null; note: BaseChanged | null;
  /** Which drop-down the error belongs to: the one used for a refused change; null (both) for a failed read. */
  errorFrom: BaseControlPlace | null }
/** The two places the base can be chosen (spec 2026-10-29 §2). */
export type BaseControlPlace = 'models' | 'settings';
export interface BaseApi { read: () => Promise<AutoBestMap | null>; set: (id: string) => Promise<BaseChanged> }

/** The one base state (owner, 29 Oct: "the two controls must stay in step"). Models… and Settings › Best model both read
 *  it; neither keeps a copy. `choose` shows the new base only after the back end saved it; a refused change leaves the
 *  old base and says why. `onChanged` re-reads what follows the base (labels, ghost, model line). */
export function baseController(api: BaseApi, onChanged: () => void) {
  let state: BaseState = { base: null, error: null, note: null, errorFrom: null };
  const listeners = new Set<() => void>();
  const set = (s: Partial<BaseState>) => { state = { ...state, ...s }; listeners.forEach((l) => l()); };
  const refresh = async () => {
    // A good read clears any error (final review M3); a failed one is shown beside both drop-downs, and the next open of
    // Models… or Settings reads again (M7), so a library re-opened mid-session is never left on "Reading…".
    try { set({ base: baseOf(await api.read()), error: null, errorFrom: null }); }
    catch (e) { set({ error: `The base model couldn't be read: ${String(e)}`, errorFrom: null }); }
  };
  return {
    getState: () => state,
    subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
    refresh,
    /** The error to show beside one drop-down: a refusal only beside the one used (spec §2, final review M3). */
    errorFor: (place: BaseControlPlace): string | null => (state.error && (state.errorFrom === null || state.errorFrom === place) ? state.error : null),
    choose: async (id: string, from: BaseControlPlace | null = null) => {
      let c: BaseChanged;
      try { c = await api.set(id); }
      catch (e) { set({ error: `The base was not changed: ${String(e)}`, errorFrom: from }); return; }
      set({ error: null, errorFrom: null, note: c.from !== c.to ? c : state.note });
      await refresh();
      onChanged();
    },
    dismissNote: () => set({ note: null }),
  };
}
export type BaseControl = ReturnType<typeof baseController> & BaseState;

/** One instance, made in App and passed to Models… and Settings › Best model. */
export function useBase(onChanged: () => void): BaseControl {
  const changed = useRef(onChanged); changed.current = onChanged;
  const [c] = useState(() => baseController({ read: models.autoBest, set: models.setBase }, () => changed.current()));
  const s = useSyncExternalStore(c.subscribe, c.getState);
  useEffect(() => { void c.refresh(); }, [c]);
  const refresh = useCallback(() => { void c.refresh(); }, [c]);
  return { ...c, ...s, refresh: async () => refresh() };
}
