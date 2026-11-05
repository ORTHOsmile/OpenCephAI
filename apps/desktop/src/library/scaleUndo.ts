import type { MachineScale, MachineScaleRow, MachineSummary, ScaleChange } from '../ipc';
import { changeWarning } from './machineScale';

/** The machine's stored scale as a row to write back (MQ10's Undo passes the old set time, so it restores the value and
 *  nothing else). */
export const rowOf = (s: MachineScale | null | undefined): MachineScaleRow | null => (s ? { spacingMm: s.spacingMm, widthPx: s.widthPx, heightPx: s.heightPx,
  source: s.source === 'film' ? `film:${s.sourceCaseId}` : 'entered', setAt: s.setAt } : null);

type Ask = (message: string, options: { title: string; kind: 'warning' }) => Promise<boolean>;
type ScaleLib = { machineScaleChange: (id: string, r: MachineScaleRow | null) => Promise<ScaleChange>; setMachineScale: (id: string, r: MachineScaleRow | null) => Promise<ScaleChange> };

/** Spec 2026-10-20 (MS4): count first (`library.machineScaleChange`), warn with the owner's words, then write the
 *  row (`library.setMachineScale`) — in that order, every time, so the operator is never warned about a change
 *  already made. Returns the old row, or `'cancelled'` when the operator said No to a warning (nothing saved). A
 *  `null` old row means the machine had no scale before this change. Records nothing (see `changeScale`). */
export async function applyScaleChange(lib: ScaleLib, askFn: Ask, m: MachineSummary, row: MachineScaleRow | null): Promise<MachineScaleRow | null | 'cancelled'> {
  const words = changeWarning(await lib.machineScaleChange(m.id, row));
  if (words && !(await askFn(words, { title: `Scale for ${m.name}`, kind: 'warning' }))) return 'cancelled';
  const old = rowOf(m.scale);
  await lib.setMachineScale(m.id, row);
  return old;
}

// ---- Undo (MQ10; final review I4, ruling 25 Oct) ----
// The LAST change of each machine, per library: recorded for every scale write (Film layouts' Enter scale…, Remove
// scale, and "Use for this machine"), so Undo never jumps back past a later change. Discarded when Film layouts
// closes for any reason (its own fold, or leaving the Library page, which unmounts it: `leftPage`), when the library
// is replaced (a restore, or a library switch if one is ever added: `libraryReplaced`). Module scope, not component
// state: "Use for this machine" is pressed on the tracing page, while Film layouts is not mounted.
interface Rec { before: MachineScaleRow | null; after: MachineScaleRow | null }
let epoch = 0;
let recs: Record<string, Rec> = {};
let version = 0;
const listeners = new Set<() => void>();
const changed = () => { version++; listeners.forEach((l) => l()); };
const key = (at: number, machineId: string) => `${at}|${machineId}`;
/** For `useSyncExternalStore`: re-render Film layouts when a record is made or discarded. */
export const subscribeScaleUndo = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };
export const scaleUndoVersion = () => version;
/** Which library the records belong to; a write captures it before its awaits, so a write that lands after a restore
 *  never records into the restored library. */
export const scaleUndoEpoch = () => epoch;
function record(at: number, machineId: string, before: MachineScaleRow | null, after: MachineScaleRow | null) {
  if (at !== epoch) return;
  recs = { ...recs, [key(at, machineId)]: { before, after } }; changed();
}
const forget = (machineId: string) => { const { [key(epoch, machineId)]: _gone, ...rest } = recs; recs = rest; changed(); };
/** Film layouts closed (its fold, or the page it lives on was left). */
export const discardScaleUndo = () => { recs = {}; changed(); };
/** The library was replaced (a restore; a library switch). */
export const libraryReplaced = () => { epoch++; discardScaleUndo(); };
/** App's page change: leaving the Library page unmounts Film layouts, which closes it. */
export const leftPage = (from: string, to: string) => { if (from === 'library' && to !== 'library') discardScaleUndo(); };

const same = (a: MachineScaleRow | null, b: MachineScaleRow | null) => (a === null || b === null ? a === b
  : a.spacingMm === b.spacingMm && a.widthPx === b.widthPx && a.heightPx === b.heightPx && a.source === b.source && (b.setAt === null || a.setAt === b.setAt));
/** The row Undo would write for machine `m` (null: remove its scale), or undefined when no Undo is offered: nothing
 *  recorded, or the machine's scale is no longer the one the recorded change left (some other write since). */
export function undoRowFor(m: MachineSummary): MachineScaleRow | null | undefined {
  const r = recs[key(epoch, m.id)];
  return r && same(rowOf(m.scale), r.after) ? r.before : undefined;
}

/** A scale write from Film layouts (Enter scale…, Remove scale): warned, written, and recorded for Undo. */
export async function changeScale(lib: ScaleLib, askFn: Ask, m: MachineSummary, row: MachineScaleRow | null): Promise<'cancelled' | 'done'> {
  const at = epoch;
  const old = await applyScaleChange(lib, askFn, m, row);
  if (old === 'cancelled') return 'cancelled';
  record(at, m.id, old, row);
  return 'done';
}
/** Undo: writes back the row before the last change, after the same warning. No to the warning keeps the Undo (M1);
 *  a done Undo is not itself undoable (the change it undid is gone). */
export async function undoScaleChange(lib: ScaleLib, askFn: Ask, m: MachineSummary): Promise<'none' | 'cancelled' | 'done'> {
  const back = undoRowFor(m);
  if (back === undefined) return 'none';
  const at = epoch;
  if ((await applyScaleChange(lib, askFn, m, back)) === 'cancelled') return 'cancelled';
  if (at === epoch) forget(m.id);
  return 'done';
}
/** Spec 2026-10-20 (MS6): "Use for this machine" — the film's own ruler and size become its machine's scale, after the
 *  same count-first warning; recorded for Undo like any other scale write (final review I4). */
export async function useForMachineFlow(lib: ScaleLib & {
  machineScaleFromFilm: (caseId: string) => Promise<[string, MachineScaleRow]>; machines: () => Promise<MachineSummary[] | null> },
askFn: (message: string, options: { title: string; kind: 'warning' }) => Promise<boolean>, caseId: string): Promise<'cancelled' | 'done'> {
  const at = epoch;
  const [mid, row] = await lib.machineScaleFromFilm(caseId);
  const words = changeWarning(await lib.machineScaleChange(mid, row));
  if (words && !(await askFn(words, { title: 'Use for this machine', kind: 'warning' }))) return 'cancelled';
  const before = rowOf(((await lib.machines()) ?? []).find((x) => x.id === mid)?.scale);
  await lib.setMachineScale(mid, row);
  record(at, mid, before, row);
  return 'done';
}
