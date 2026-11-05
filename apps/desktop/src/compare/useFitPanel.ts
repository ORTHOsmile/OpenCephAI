import { useCallback, useEffect, useMemo, useState } from 'react';
import { convertFileSrc } from '@tauri-apps/api/core';
import type { Vec2 } from '@ceph/geometry';
import { library, type CaseDoc, type FilmFit, type FitSave } from '../ipc';
import type { Orientation } from '../canvas/orientation';
import { nudgeVector } from '../canvas/dragMath';
import { commandFor } from '../input/keymap';
import { simOf, type Sim } from './fit';
import { draftReducer, startDraft, toSave, type Draft, type DraftAction } from './fitDraft';

const pointsOf = (d: CaseDoc) => Object.fromEntries(d.landmarks.map((l) => [l.id, { x: l.x, y: l.y }]));
/** The saved fields of a fit as the library reads it back (who/when and the reference's own spacing dropped). */
const saveOf = ({ refCaseId, refKind, refPoints, filmPoints, mirror, scale, rotation, dx, dy }: FitSave): FitSave =>
  ({ refCaseId, refKind, refPoints, filmPoints, mirror, scale, rotation, dx, dy });
/** Owner D-f (18 Oct): ⌘Z after "Remove fit" puts the removed fit back as it was — its placement and its "Use the scale
 *  from the fit" switch. (The store clears Tracing verified on that film whenever the switch is on, plan D-c.) */
export async function putBack(lib: Pick<typeof library, 'saveFit' | 'setFitOwn'>, film: string, f: FilmFit): Promise<void> {
  await lib.saveFit(film, saveOf(f));
  if (f.useOwn) await lib.setFitOwn(film, true);
}

/** Request G panel: one film fitted onto the open film (its reference), its picture loaded, the draft, Save fit, Reset
 *  (back to the last saved fit, no library write) and Remove fit (undoable with ⌘Z) — owner D-f, 18 Oct. */
export function useFitPanel(o: { open: CaseDoc | null; openPoints: Record<string, Vec2>; onChanged: () => Promise<void> | void; orientation: Orientation }) {
  const [target, setTarget] = useState<{ film: string; ref: string } | null>(null);
  const [filmDoc, setFilmDoc] = useState<CaseDoc | null>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // The fit "Remove fit" took away, kept while the panel stays on this film so ⌘Z can put it back.
  const [removed, setRemoved] = useState<FilmFit | null>(null);
  const active = !!target && !!o.open && o.open.id === target.ref;
  useEffect(() => {
    let live = true; setFilmDoc(null); setImage(null); setDraft(null); setError(null); setNotice(null); setRemoved(null);
    if (!target) return;
    (async () => {
      try {
        const d = await library.open(target.film);
        const bmp = await createImageBitmap(await (await fetch(convertFileSrc(d.image.path))).blob());
        if (live) { setFilmDoc(d); setImage(bmp); }
      } catch (e) { if (live) setError(`Couldn’t open the film to fit: ${String(e)}`); }
    })();
    return () => { live = false; };
  }, [target?.film, target?.ref]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const r = o.open;
    if (!active || !filmDoc || !r || draft) return;
    setDraft(startDraft(
      { id: r.id, label: r.timepoint, points: o.openPoints, facing: r.facing, spacingMm: r.spacingMm, dims: { W: r.image.width, H: r.image.height }, machineScale: r.machineScale },
      { id: filmDoc.id, label: filmDoc.timepoint, points: pointsOf(filmDoc), facing: filmDoc.facing, spacingMm: filmDoc.spacingMm,
        dims: { W: filmDoc.image.width, H: filmDoc.image.height }, machineScale: filmDoc.machineScale },
      filmDoc.fit ?? null));
  }, [active, filmDoc, draft, o.open?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const act = useCallback((a: DraftAction) => setDraft((s) => (s ? draftReducer(s, a) : s)), []);
  // Arrow keys nudge the film 1 px (⇧ 10) in the screen's directions; Esc cancels. Never while typing (keymap's rule).
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const c = commandFor({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, shiftKey: e.shiftKey, altKey: e.altKey,
        targetTag: t?.tagName, targetType: (t as HTMLInputElement | null)?.type, targetEditable: !!t?.isContentEditable });
      if (c?.t === 'nudge') { e.preventDefault(); act({ type: 'move', d: nudgeVector(o.orientation, c.dx, c.dy) }); }
      else if (c?.t === 'cancel') { e.preventDefault(); setTarget(null); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, o.orientation, act]);
  const begin = useCallback((film: string, ref: string) => setTarget({ film, ref }), []);
  const close = useCallback(() => setTarget(null), []);
  const save = useCallback(async () => {
    const f = draft && toSave(draft); if (!draft || !f) return;
    setBusy(true); setError(null);
    try { await library.saveFit(draft.film, f); await o.onChanged(); setTarget(null); }
    catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, [draft, o.onChanged]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Owner D-f: Reset only discards unsaved changes — back to the last saved fit, else the S–N start. No library write.
  const reset = useCallback(() => { setError(null); setNotice(null); act({ type: 'restart' }); }, [act]);
  // Owner D-f: "Remove fit" (shown only while a fit is saved) removes it through the clear-fit command; the store clears
  // a switched-on film's Tracing verified (plan D-c), so nothing here does.
  const remove = useCallback(async () => {
    const f = filmDoc?.fit ?? null; if (!draft || !filmDoc || !f) return;
    setBusy(true); setError(null);
    try {
      await library.clearFit(draft.film);
      setRemoved(f); setFilmDoc({ ...filmDoc, fit: null }); act({ type: 'saved', fit: null });
      setNotice(`${draft.filmLabel}'s fit was removed: it is back on the plain S–N superimposition at its own scale.`);
      await o.onChanged();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, [draft, filmDoc, o.onChanged, act]);   // eslint-disable-line react-hooks/exhaustive-deps
  // ⌘Z after Remove fit: the removed fit back, exactly as it was saved, and the draft back on it.
  const undoRemove = useCallback(async () => {
    if (!draft || !filmDoc || !removed || busy) return;
    setBusy(true); setError(null);
    try {
      await putBack(library, draft.film, removed);
      setFilmDoc({ ...filmDoc, fit: removed }); setRemoved(null); act({ type: 'saved', fit: removed });
      setNotice(`${draft.filmLabel}'s fit is back as it was saved.`);
      await o.onChanged();
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }, [draft, filmDoc, removed, busy, o.onChanged, act]);   // eslint-disable-line react-hooks/exhaustive-deps
  // One matrix per pose, so the canvas redraws only when the film actually moves.
  const sim: Sim | null = useMemo(() => (draft ? simOf(draft.pose) : null), [draft?.pose]);   // eslint-disable-line react-hooks/exhaustive-deps
  return { target, active, draft, image, sim, busy, error, notice, canUndo: active && !!removed, begin, close, act, save, reset, remove, undoRemove };
}
