import { useCallback, useEffect, useRef, useState } from 'react';
import type { CaseDoc, CaseMeta, Gender } from '../ipc';
import type { DateFormat } from '../dates';
import type { CaseApi } from './useCase';
import { CHOOSE_LABELS, chosenValue, dateRefusal, dragSel, extendSel, isDetailField, labelMatcher, locate, nameAfterChoosing, selSpans, selText, unsureFields, type ChooseField, type NameParts, type Sel } from './choose';
import { CHOOSE_FIELD_OF, CHOOSE_TO_DETAIL, valueFor, type FilmDetail } from './filmTable';
import { splitTitle } from './title';
import { ageIn } from './age';

/** Choose mode (spec 2026-09-29 Part 1): open on the film, with a selection and, from a Pick button, a target field. */
export interface ChooseState { target: ChooseField | null; sel: Sel | null; hint: string | null; fromPick: boolean }

const metaOf = (d: CaseDoc): CaseMeta => ({ patientName: d.patientName, timepoint: d.timepoint, takenOn: d.takenOn, dateOfBirth: d.dateOfBirth, scanId: d.scanId });

/** Choose mode for the open case: opens by itself when a detail is blank or unsure, or from a Pick button. */
export function useChoose(kase: CaseApi, fmt: DateFormat) {
  const [choose, setChoose] = useState<ChooseState | null>(null);
  const [used, setUsed] = useState<Record<string, FilmDetail>>({});
  const [parts, setParts] = useState<NameParts>({ last: null, first: null });
  const opened = useRef<string | null>(null);
  const doc = kase.doc, lines = kase.filmText?.lines ?? [];
  const hasWords = lines.some((l) => l.words.length > 0);

  useEffect(() => { setChoose(null); setUsed({}); setParts({ last: null, first: null }); }, [doc?.id]);
  // Read the film again (owner, 30 Sep: M6): new lines, so the old 'used' tints would sit on the wrong words. Words
  // added by re-reading an area keep the lines before them, so their tints stay.
  useEffect(() => { setUsed({}); }, [lines[0]]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {                                                   // once per case: open when something needs choosing
    if (!doc || !hasWords || opened.current === doc.id) return;
    opened.current = doc.id;
    if (unsureFields(doc).length) setChoose({ target: null, sel: null, hint: null, fromPick: false });
  }, [doc, hasWords]);

  const onWord = useCallback((line: number, word: number, shift: boolean) =>
    setChoose((c) => c && { ...c, sel: extendSel(c.sel, line, word, shift), hint: null }), []);
  /** A press on a word dragged across others on the same line (owner, 30 Sep: M2). */
  const onDrag = useCallback((start: { line: number; word: number }, line: number, word: number) =>
    setChoose((c) => c && { ...c, sel: dragSel(start, line, word), hint: null }), []);
  const onEmpty = useCallback((p: { x: number; y: number }) => {
    setChoose((c) => c && { ...c, sel: null, hint: 'Reading that area…' });
    kase.readArea([p.x - 0.06, p.y - 0.03, 0.12, 0.06])
      .then((found) => setChoose((c) => c && { ...c, hint: found.length ? null : 'No text found here — type it instead' }))
      .catch(() => setChoose((c) => c && { ...c, hint: 'That area couldn’t be read — type it instead' }));
  }, [kase]);
  const onLabel = useCallback(async (field: ChooseField) => {
    const c = choose, d = kase.doc;
    if (!c?.sel || !d) return;
    const spans = selSpans(lines, c.sel), multi = spans.length > 1;   // a name wrapped onto the next line: value only, never learned
    const chosenText = selText(lines, c.sel);
    let v = chosenValue(field, chosenText, fmt), reread = false;
    if (!v) {
      // Owner, 5 Oct (I2): a refused cut-year shape (")24-Jan-12") must not be re-read — the re-read can drop the
      // very scrap that marked the year as cut, find a plausible-looking date in what is left ("24-Jan-12"), and
      // save the wrong one. Show the refusal hint and stop, instead of falling into the re-read below.
      if (dateRefusal(field, chosenText, fmt) === 'cut-year') { setChoose({ ...c, hint: `Those words aren’t a ${CHOOSE_LABELS[field]}` }); return; }
      // Owner, 30 Sep: back-to-front text can come through garbled. Re-read just those words, enlarged and both ways
      // round, and use what that finds; it teaches the machine through the value, not through the garbled words.
      setChoose({ ...c, hint: 'Reading those words again…' });
      const ws = spans.flatMap((p) => lines[p.line].words.slice(p.from, p.to + 1)).map((w) => w.bbox);
      const x0 = Math.min(...ws.map((b) => b[0])), y0 = Math.min(...ws.map((b) => b[1]));
      const x1 = Math.max(...ws.map((b) => b[0] + b[2])), y1 = Math.max(...ws.map((b) => b[1] + b[3]));
      const found = await kase.readArea([x0 - 0.01, y0 - 0.01, x1 - x0 + 0.02, y1 - y0 + 0.02]).catch(() => []);
      v = found.map((l) => chosenValue(field, l.text, fmt)).find((x) => x) ?? null;
      reread = true;
      if (!v) { setChoose({ ...c, hint: `Those words aren’t a ${CHOOSE_LABELS[field]}` }); return; }
    }
    if (isDetailField(field)) {                       // format 11 (spec 2026-10-17): its own single-field save, never CaseMeta
      const sel = c.sel;
      setUsed((u) => { const n = { ...u }; for (const p of spans) for (let w = p.from; w <= p.to; w++) n[`${p.line}:${w}`] = CHOOSE_TO_DETAIL[field]; return n; });
      setChoose(c.fromPick ? null : { ...c, sel: null, target: null, hint: null });
      if (!reread && !multi) await kase.learnSelection(field, sel.line, sel.from, sel.to, selText(lines, sel));
      await kase.setDetail(field, v, { learn: reread && !multi });
      return;
    }
    const m = metaOf(d);
    let waiting: string | null = null;
    let title: string | null = null;
    if (field === 'last' || field === 'first') {
      const r = nameAfterChoosing(field, v, d.patientName, parts);
      setParts(r.pending);
      if (r.save) m.patientName = r.save;
      else waiting = `Now choose the ${field === 'last' ? 'first name(s)' : 'last name'}`;
    } else if (field === 'full') { const s = splitTitle(v); m.patientName = s.rest; title = s.title; }
    else if (field === 'dob') m.dateOfBirth = v;
    else if (field === 'film_date') m.takenOn = v;
    else m.scanId = v;
    const sel = c.sel;
    setUsed((u) => { const n = { ...u }; for (const p of spans) for (let w = p.from; w <= p.to; w++) n[`${p.line}:${w}`] = CHOOSE_TO_DETAIL[field]; return n; });
    setChoose(c.fromPick && !waiting ? null : { ...c, sel: null, target: null, hint: waiting });
    if (!reread && !multi) await kase.learnSelection(field, sel.line, sel.from, sel.to, selText(lines, sel));
    if (!waiting) await kase.setMeta(m, { learn: reread && !multi });
    if (title) await kase.setPatientTitle(title);
  }, [choose, kase, lines, fmt, parts]);

  /** The chooser's drop-down (owner E, 19 Oct): one list for the panel and the film. A detail Choose already knew goes
   *  through `onLabel` unchanged (re-read, learning, Last/First). Gender and Referring practitioner are read exactly as
   *  the panel's drop-down reads them (`valueFor`) and saved on the patient; their saves teach the machine (useCase). */
  const onChoice = useCallback(async (d: FilmDetail) => {
    const f = CHOOSE_FIELD_OF[d];
    if (f) { await onLabel(f); return; }
    const c = choose; if (!c?.sel) return;
    const spans = selSpans(lines, c.sel);
    const r = valueFor(d, selText(lines, c.sel), fmt);
    if ('note' in r) { setChoose({ ...c, hint: r.note }); return; }
    setUsed((u) => { const n = { ...u }; for (const p of spans) for (let w = p.from; w <= p.to; w++) n[`${p.line}:${w}`] = d; return n; });
    setChoose(c.fromPick ? null : { ...c, sel: null, target: null, hint: null });
    if (d === 'gender') await kase.setPatientGender(r.value as Gender);
    else if (d === 'referrer') await kase.setPatientReferrer(r.value);
    else if (d === 'title') await kase.setPatientTitle(r.value);
    else if (d === 'age') { const a = ageIn(r.value); if (a) await kase.setFilmAge(a); }
  }, [choose, kase, lines, fmt, onLabel]);

  /** Pick next to a field: Choose mode aimed at that field. With no text read yet, the film is read first. */
  const pick = useCallback((field: ChooseField) => {
    if (!hasWords) void kase.readFilmText();
    setChoose({ target: field, sel: null, hint: null, fromPick: true });
  }, [hasWords, kase]);
  const open = useCallback(() => setChoose({ target: null, sel: null, hint: null, fromPick: false }), []);
  const cancel = useCallback(() => setChoose(null), []);
  const clearSel = useCallback(() => setChoose((c) => c && { ...c, sel: null }), []);
  const hint = !choose ? null : choose.hint ?? (!hasWords ? (kase.readingText ? 'Reading the film…' : 'Text on the film can’t be read on this Mac')
    : choose.target ? `Click the ${CHOOSE_LABELS[choose.target]} on the film, then press Enter · Esc cancels`
    : 'Click the words on the film, then choose what they are · Esc cancels');
  /** Where the label's own value is printed, for each field the label and the machine disagreed on (owner, 30 Sep: M1). */
  const labels = (kase.filmText?.conflicts ?? []).flatMap((c) => { const s = locate(lines, labelMatcher(c.field, c.label, fmt)); return s ? [{ field: c.field, sel: s }] : []; });
  return { choose, hint, lines, used, labels, suggestions: kase.filmText?.suggestions ?? [], onWord, onDrag, onEmpty, onLabel, onChoice, pick, open, cancel, clearSel };
}
export type ChooseApi = ReturnType<typeof useChoose>;
