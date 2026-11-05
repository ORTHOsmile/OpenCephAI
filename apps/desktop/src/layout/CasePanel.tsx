import { useEffect, useMemo, useRef, useState } from 'react';
import { DISPLAY_DEFAULT, type Action, type TracingState } from '../tracing/state';
import type { CaseApi } from '../library/useCase';
import { datePlaceholder, formatDate, parseDateInput, type DateFormat } from '../dates';
import { IdentityCheck } from './IdentityCheck';
import { conflictText, filmDateNote, openConflicts as stillOpen } from '../library/identity';
import { FilmText } from './FilmText';
import { DETAIL_OF, type FilmDetail } from '../library/filmTable';
import { AgeRow } from './AgeRow';
import { ageIn } from '../library/age';
import { CHOOSE_LABELS, DETAIL_MAX, nameAfterChoosing, type DetailField, type NameParts } from '../library/choose';
import { differentIdNote, foldedPatientNote, matchText } from '../library/patientIds';
import { NOT_A_TITLE, splitTitle, titleIn } from '../library/title';
import type { Gender, LearnedField } from '../ipc';
import type { ChooseApi } from '../library/useChoose';
import type { ChooseField } from '../library/choose';
import { PanelSection } from './PanelSection';
import { LibraryIdFold } from './LibraryIdFold';
import type { Ghost } from '../ghosts/ghosts';
import { showAllState } from '../ghosts/ghosts';
import type { Decimals } from '../format';
import type { MeasurementRow } from '../measurements';
import type { NormContext } from '../norms/normCell';
import { populationOptions } from '../norms/compare';
import { casePopulationChoice, populationMissing, populationNote } from '../norms/normCell';
import { AUTO_CASE_POPULATION, OTHER_BACKGROUND, backgroundOptions, type NormPicks } from '@ceph/analyses';
import { ComparePopulations } from '../norms/ComparePopulations';

interface Props { kase: CaseApi; chooser: ChooseApi; patients: string[]; state: TracingState; dispatch: (a: Action) => void; readOnly: boolean; dateFormat: DateFormat;
  /** Enhance open or closed, held by the App so it doesn't flash open each time a case opens (owner, 30 Sep). */
  enhanceOpen: boolean; onEnhance: () => void;
  /** Text on the film open or closed, kept on this Mac like Enhance (owner, 2 Oct). */
  filmTextOpen: boolean; onFilmText: () => void;
  /** The Patient section open or folded, kept on this Mac (owner D1, 19 Oct). */
  patientOpen: boolean; onPatient: () => void;
  /** The key to the ghost marks: every other model's ghosts, which ids are hidden, and one sentence per model that gave no points on this film. */
  ghostKey?: GhostKey;
  /** Part D task 11 (case header, ruling P26): the case's reference population picker and "Compare
   *  populations…" live in this Patient section, next to the case's own details. `norms` is the resolver's
   *  sets/userNorms/clinicDefault (N6, Task 10); `compareRows` the open film's measurement rows. */
  norms: NormContext; decimals: Decimals; compareRows: MeasurementRow[]; normExtras: NormExtras;
  /** Request G (Task 10): where Compare populations' mm come from while a fit scales them; null otherwise. */
  scaleNote?: string | null }
/** Owner NORM-PICK-1: the case's chosen norm sources and saving one (null when choosing is not allowed); final review
 *  I-2: the per-row unconfirmed-AI-point list App computes; M-8: whether the clinician's own norms failed to read. */
export interface NormExtras { picks: NormPicks; onPick: ((population: string, measurement: string, source: string) => void) | null; unconfirmedFor: (node: string) => string[]; userNormsFailed: boolean }
/** Owner, 5 Oct: a tick-box per model (not one "Show other models" switch) plus a "Show all" that ticks or unticks
 *  every model listed here; `hidden` is the full, remembered set of hidden model ids. */
export interface GhostKey { ghosts: Ghost[]; hidden: ReadonlySet<string>; onToggleModel: (modelId: string) => void; onToggleAll: (listedIds: string[]) => void; errors: string[] }

/** Patient, date of birth, timepoint, film date and scan ID; facing and re-detect; sign-off; save status. All saved in the library. */
export function CasePanel({ kase, chooser, patients, state, dispatch, readOnly, dateFormat, enhanceOpen, onEnhance, filmTextOpen, onFilmText, patientOpen, onPatient, ghostKey, norms, decimals, compareRows, normExtras, scaleNote = null }: Props) {
  const doc = kase.doc!;
  const fromDoc = () => ({ name: doc.patientName, dob: formatDate(doc.dateOfBirth, dateFormat), tp: doc.timepoint,
    date: formatDate(doc.takenOn, dateFormat), scan: doc.scanId ?? '' });
  const [v, setV] = useState(fromDoc);
  const [parts, setParts] = useState<NameParts>({ last: null, first: null });
  useEffect(() => { setParts({ last: null, first: null }); }, [doc.id]);
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { setV(fromDoc()); },
    [doc.id, doc.patientName, doc.dateOfBirth, doc.timepoint, doc.takenOn, doc.scanId, dateFormat]);   // eslint-disable-line react-hooks/exhaustive-deps
  // Fix round 1 (review Minor 1): returns whether a save was actually dispatched (false on a refused date, an
  // empty timepoint, or nothing to change), so a caller that teaches the machine after saving — Last/First below —
  // can skip teaching when the save did not happen.
  const commit = (next: typeof v = v, opts: { learn?: boolean } = {}): Promise<void> | null => {
    const dob = parseDateInput(next.dob, dateFormat), takenOn = parseDateInput(next.date, dateFormat);
    if (dob === undefined || takenOn === undefined) {                       // not a real date: put the old values back
      kase.setError(`Type dates as ${datePlaceholder(dateFormat)}.`); setV(fromDoc()); return null;
    }
    const m = { patientName: next.name.trim(), timepoint: next.tp.trim(), takenOn, dateOfBirth: dob, scanId: next.scan.trim() || null };
    if (!m.timepoint) { setV(fromDoc()); return null; }                     // an empty timepoint is refused: put the old value back
    const changed = m.patientName !== doc.patientName || m.timepoint !== doc.timepoint || m.takenOn !== doc.takenOn
      || m.dateOfBirth !== doc.dateOfBirth || m.scanId !== doc.scanId;
    return changed ? kase.setMeta(m, opts) : null;
  };
  // Owner T1 (19 Oct): Title, on the patient. Its own box, before the name; checked against the owner's words.
  const [title, setTitle] = useState(doc.title ?? '');
  useEffect(() => { setTitle(doc.title ?? ''); }, [doc.id, doc.title]);
  const commitTitle = () => {
    const t = title.trim();
    if (!t) { if (doc.title) void kase.setPatientTitle(null); return; }
    if (t === doc.title) return;
    if (!titleIn(t)) { kase.setError(NOT_A_TITLE); setTitle(doc.title ?? ''); return; }
    void kase.setPatientTitle(t);
  };
  /** A line of Text on the film chosen as a detail: saved at once, as if typed and left. Returns a note for the row,
   *  or null. Gender and Referrer go on the patient and teach nothing; the format-11 details save on their own and
   *  teach (D-LEARN-1); Last and First build "Last, First" (D-FIELDS-1) and teach their own places. */
  const use = (d: FilmDetail, value: string): string | null => {
    if (d === 'gender') { void kase.setPatientGender(value as Gender); return null; }
    if (d === 'referrer') { void kase.setPatientReferrer(value); return null; }
    if (d === 'title') { void kase.setPatientTitle(value); return null; }
    if (d === 'age') { const a = ageIn(value); if (a) void kase.setFilmAge(a); return null; }
    const detail = DETAIL_OF[d];
    if (detail) { void kase.setDetail(detail, value); return null; }
    if (d === 'last' || d === 'first') {
      const r = nameAfterChoosing(d, value, doc.patientName, parts);
      setParts(r.pending);
      if (!r.save) return d === 'last' ? 'Now choose the first name' : 'Now choose the last name';
      const next = { ...v, name: r.save }; setV(next);
      // Fix round 1 (review Minor 1): only teach the places once the save actually happened — not when `commit`
      // refused (an unfinished bad date elsewhere in the panel) or had nothing to change.
      if (commit(next, { learn: false })) {
        const c = r.save.indexOf(',');
        kase.learnValue('last', r.save.slice(0, c).trim()); kase.learnValue('first', r.save.slice(c + 1).trim());
      }
      return null;
    }
    // Fix round 1 (review Minor 4): choosing the full Patient line clears any Last/First still waiting for its
    // other half — otherwise a LATER First/Last choice would wrongly join onto a name from before this one.
    if (d === 'name') {
      setParts({ last: null, first: null });
      const s = splitTitle(value);                                   // owner T1: "Mr John Smith" → Title Mr, name John Smith
      const next = { ...v, name: s.rest }; setV(next);
      const saved = commit(next);
      if (s.title) { const t = s.title; void (saved ?? Promise.resolve()).then(() => kase.setPatientTitle(t)); }
      return null;
    }
    // Every FilmDetail is a key here, mapped to the box it fills or `null` for one of the branches above — so a
    // detail added to FilmDetail without being handled anywhere in `use` is a type error here, not a silent no-op
    // (M0: this replaces the cast that let the six new choices save nothing without the compiler noticing).
    const FIELD_OF: Record<FilmDetail, keyof typeof v | null> = {
      name: 'name', dob: 'dob', date: 'date', scan: 'scan',
      gender: null, referrer: null, last: null, first: null, patientId: null, xrayType: null, xraySize: null, practice: null, title: null, age: null,
    };
    const k = FIELD_OF[d]; if (!k) return null;
    const next = { ...v, [k]: d === 'dob' || d === 'date' ? formatDate(value, dateFormat) : value };
    setV(next); commit(next);
    return null;
  };
  const enter = (e: React.KeyboardEvent<HTMLInputElement>) => { if (e.key === 'Enter') e.currentTarget.blur(); };
  const field = (k: keyof typeof v) => ({ value: v[k], onChange: (e: React.ChangeEvent<HTMLInputElement>) => setV({ ...v, [k]: e.target.value }), onBlur: () => { void commit(); }, onKeyDown: enter });
  const [ref, setRef] = useState(doc.referringPractitioner ?? '');
  useEffect(() => { setRef(doc.referringPractitioner ?? ''); }, [doc.id, doc.referringPractitioner]);
  const commitRef = () => { const r = ref.trim() || null; if (r !== doc.referringPractitioner) void kase.setPatientReferrer(r); };
  // Format 11 (spec 2026-10-17; addendum D2 Q8): Patient ID, X-ray type, X-ray dimensions and Radiography practice, all
  // on this film. Each box keeps its own draft and resets only from its OWN saved value (pre-flight D5), so saving
  // one box — which refreshes the case — never wipes text still being typed in another.
  const savedDetail: Record<DetailField, string | null> = { patient_id: doc.printedPatientId, xray_type: doc.xrayType, xray_size: doc.xraySize, practice: doc.radiographyPractice };
  const [det, setDet] = useState<Record<DetailField, string>>(() => ({ patient_id: doc.printedPatientId ?? '', xray_type: doc.xrayType ?? '', xray_size: doc.xraySize ?? '', practice: doc.radiographyPractice ?? '' }));
  const resetDetail = (f: DetailField, v: string | null) => setDet((d) => ({ ...d, [f]: v ?? '' }));
  useEffect(() => { resetDetail('patient_id', doc.printedPatientId); }, [doc.id, doc.printedPatientId]);        // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { resetDetail('xray_type', doc.xrayType); }, [doc.id, doc.xrayType]);                       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { resetDetail('xray_size', doc.xraySize); }, [doc.id, doc.xraySize]);                       // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { resetDetail('practice', doc.radiographyPractice); }, [doc.id, doc.radiographyPractice]);  // eslint-disable-line react-hooks/exhaustive-deps
  /** Saved on leaving the box, on its own. Blank saves nothing (NULL); over DETAIL_MAX characters (code points) is
   *  refused with a note and the box goes back to its saved value. */
  const commitDetail = (f: DetailField) => {
    const t = det[f].trim();
    if ([...t].length > DETAIL_MAX) { kase.setError(`${CHOOSE_LABELS[f]} is too long (over ${DETAIL_MAX} characters).`); resetDetail(f, savedDetail[f]); return; }
    if ((t || null) !== savedDetail[f]) void kase.setDetail(f, t || null);
  };
  /** One row that grows with its text, so a long value wraps and shows whole (spec edge case; as FilmText's rows).
   *  The box is border-box with a 1px border, so its height is the text's scrollHeight PLUS the borders, or the last
   *  line's bottom is cut off by 2px (caught by e2e12 S2). */
  const autosize = (el: HTMLTextAreaElement | null) => {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight + el.offsetHeight - el.clientHeight}px`;
  };
  // As FilmText (M4): re-fit the boxes when the panel itself changes width, not only when React re-renders.
  const detailsObs = useRef<ResizeObserver | null>(null);
  const attachDetails = (el: HTMLDivElement | null) => {
    detailsObs.current?.disconnect();
    if (!el) return;
    detailsObs.current = new ResizeObserver(() => { el.querySelectorAll<HTMLTextAreaElement>('textarea.detail-box').forEach(autosize); });
    detailsObs.current.observe(el);
  };
  useEffect(() => () => detailsObs.current?.disconnect(), []);
  // Review fix round 1 (Minor): declared here, before its first use (`detailBox`/`learnedMark` below), rather than
  // after them — it worked either way (neither is called until the JSX render), but reading it top-down is clearer.
  const locked = !!kase.busy || readOnly;
  /** Pick next to a field: click its words on the film (spec 2026-09-29 Part 1). */
  const pickBtn = (label: string, f: ChooseField) => (
    <button type="button" className="pick" aria-label={`Pick ${label} on the film`} title={`Click the ${label.toLowerCase()} on the film`}
      disabled={locked} onClick={(e) => { e.preventDefault(); chooser.pick(f); }}>Pick</button>);
  // Owner Q8: this X-ray's own Patient ID differs from another X-ray's of the same patient — a subtle note, never a
  // general warning. LIBID-1: the same Patient ID on a DIFFERENT, named patient's X-ray(s) only suggests a link;
  // "Same patient" moves this X-ray alone (L4), "Not the same" hides the suggestion for this X-ray and that patient.
  const idDiffNote = differentIdNote(doc);
  const idNote = (
    <>
      {idDiffNote && <span className="hint id-note" role="note">{idDiffNote}</span>}
      {doc.idMatches.map((m) => (
        <div key={m.libraryId} className="identity-note id-link" role="group" aria-label="Same Patient ID">
          {matchText(m, doc.printedPatientId!, dateFormat)}
          <button type="button" disabled={locked} onClick={() => void kase.confirmIdentity(m.patient)}>Same patient</button>
          <button type="button" disabled={locked} onClick={() => void kase.notSamePatient(m.libraryId)}>Not the same</button>
        </div>))}
    </>
  );
  const detailBox = (f: DetailField) => (
    <label key={f}><span className="label-row">{CHOOSE_LABELS[f]}{pickBtn(CHOOSE_LABELS[f], f)}</span>
      <textarea ref={autosize} className="detail-box" rows={1} wrap="soft" spellCheck={false} value={det[f]} disabled={locked}
        // One line only: Enter leaves the box (and saves it), and a pasted or dropped line break becomes a space.
        onChange={(e) => { const v = e.target.value.replace(/\r\n|\r|\n/g, ' '); setDet((d) => ({ ...d, [f]: v })); }}
        onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.blur(); } }}
        onBlur={() => commitDetail(f)} />
      {learnedMark(f, CHOOSE_LABELS[f])}
      {f === 'patient_id' && idNote}
    </label>);
  // Owner Q10: the ✓ beside a "Learned for this machine" mark on Patient ID, X-ray type, X-ray dimensions,
  // Radiography practice, Gender or Referring practitioner — keeps the value, drops only that mark.
  const learnedMark = (f: LearnedField, label: string) => doc.learnedFields.includes(f) && (
    <span className="learned-tag">Learned for this machine
      <button type="button" className="accept-learned" aria-label={`Accept ${label} as it is`} title="Accept as it is"
        disabled={locked} onClick={() => void kase.acceptLearned(f)}>✓</button></span>);
  const openConflicts = stillOpen(doc, kase.filmText?.conflicts ?? []);
  // The lines handed to the table must keep their identity between renders, or its effect wipes the owner's edits.
  const filmLines = useMemo(() => kase.filmText?.lines.map((l) => l.text) ?? null, [kase.filmText?.lines]);
  // Part D task 11 (case header, ruling P26): the case's reference population (N6) and the
  // "Compare populations…" dialog. The picker is disabled on the read-only Superimposition page (`locked`,
  // same as every other field here) so that page can never change the case's population.
  const [compareOpen, setCompareOpen] = useState(false);
  // Fix round 1, ruling T11-4: true when the case's own population names a user-norm set that has
  // since been deleted — the same check `queryFor` (normCell.ts) uses to fall back to the clinic default.
  const missingPopulation = populationMissing(doc.population, norms.sets, norms.userNorms);
  return (
    <div className="case-panel">
      {/* Owner D1 + P3 (19 Oct): the heading folds everything down to "Compare populations…"; folded, it names the
          patient's Library ID. The fold hides, never edits, so it works on the read-only Superimposition page too. */}
      <PanelSection title="Patient" collapsible={{ open: patientOpen, onToggle: onPatient }} folded={foldedPatientNote(doc)}>
      <IdentityCheck doc={doc} dateFormat={dateFormat} busy={locked} onConfirm={(p) => void kase.confirmIdentity(p)}
        onEdit={() => nameRef.current?.focus()} onChoose={kase.filmText?.lines.length ? chooser.open : undefined} />
      {/* Label vs this machine's learned place (owner, 30 Sep: M1): listed while that detail is still blank, checked or not. */}
      {openConflicts.length > 0 && <ul className="identity-note conflicts" aria-label="Label and machine disagree">
        {openConflicts.map((c) => <li key={c.field}>{conflictText(c, dateFormat)}</li>)}</ul>}
      {/* Blank until read or typed (owner, 29 Sep: blank beats a wrong name), and highlighted until then. */}
      <div className="row title-row">
        <label className="title-box"><span className="label-row">Title</span><input value={title} disabled={locked} spellCheck={false}
          onChange={(e) => setTitle(e.target.value)} onBlur={commitTitle} onKeyDown={enter} /></label>
        <label className={v.name.trim() ? undefined : 'needs'}><span className="label-row">Patient{pickBtn('Patient', 'full')}</span><input ref={nameRef} list="cephtrace-patients" placeholder="Type the patient’s name" {...field('name')} /></label>
      </div>
      {/* Owner D2 (19 Oct): the Library ID is a fold heading over the Patient IDs on its X-rays (LIBID-1) and the trail (L9-A). */}
      <LibraryIdFold doc={doc} dateFormat={dateFormat} />
      <datalist id="cephtrace-patients">{patients.map((p) => <option key={p} value={p} />)}</datalist>
      <div className="row">
        <label><span className="label-row">Date of birth{pickBtn('Date of birth', 'dob')}</span><input placeholder={datePlaceholder(dateFormat)} inputMode="numeric" {...field('dob')} /></label>
        <label><span className="label-row">Scan ID{pickBtn('Scan ID', 'scan_id')}</span><input {...field('scan')} /></label>
      </div>
      <AgeRow doc={doc} locked={locked} onSave={(a) => void kase.setFilmAge(a)} onError={kase.setError} />
      <div className="row">
        <label>Timepoint<input {...field('tp')} /></label>
        <label><span className="label-row">Film date{pickBtn('Film date', 'film_date')}</span><input placeholder={datePlaceholder(dateFormat)} inputMode="numeric" {...field('date')} /></label>
      </div>
      {filmDateNote(doc.takenOnSource) && <div className="identity-note" role="status">{filmDateNote(doc.takenOnSource)}
        <button type="button" disabled={locked} onClick={() => void kase.confirmFilmDate()}>OK</button></div>}
      <div className="label-row">Gender</div>
      <div className="segmented" role="radiogroup" aria-label="Gender">
        {/* Owner, 5 Oct: "Not recorded" wrapped onto two lines; it reads N/A, with the full meaning on hover. */}
        {([['F', 'Female'], ['M', 'Male'], [null, 'N/A']] as const).map(([g, label]) => (
          <button key={label} type="button" role="radio" aria-checked={doc.gender === g} disabled={locked}
            title={g === null ? 'Not recorded' : undefined}
            onClick={() => { if (doc.gender !== g) void kase.setPatientGender(g); }}>{label}</button>))}
      </div>
      {learnedMark('gender', 'Gender')}
      {/* Spec 2026-10-29 §4.1 (owner NAP-Q2 (a)): the patient's background, saved on the patient like Gender; used only
          by Auto to choose the reference population; never read off the film, never taught, never exported. */}
      <label>Background
        <select aria-label="Patient's background" value={doc.background ?? ''} disabled={locked} onChange={(e) => void kase.setPatientBackground(e.target.value || null)}>
          <option value="">Not recorded</option>
          {backgroundOptions(norms.sets).map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          <option value={OTHER_BACKGROUND}>Other or mixed</option>
        </select>
      </label>
      <label>Referring practitioner<input value={ref} disabled={locked} onChange={(e) => setRef(e.target.value)} onBlur={commitRef} onKeyDown={enter} /></label>
      {learnedMark('referrer', 'Referring practitioner')}
      <div className="details" ref={attachDetails}>
        <div className="row">{detailBox('patient_id')}{detailBox('xray_type')}</div>
        {detailBox('xray_size')}
        {detailBox('practice')}
      </div>
      <label>Reference population
        <select value={missingPopulation ? '' : doc.population ?? ''} disabled={locked}
          onChange={(e) => void kase.setCasePopulation(e.target.value || null)}>
          {/* Owner decision 3 (29 Oct 2026): Auto first, saying what it chooses for this patient and why; the per-case
              undo on a case the upgrade switched (spec §4.8). A case on a deleted set of your norms reads as the old
              "Clinic default", which is what queryFor uses for it. */}
          {populationOptions(norms.sets, norms.userNorms, norms.clinicDefault, missingPopulation ? null : doc.population,
            casePopulationChoice({ ...doc, population: AUTO_CASE_POPULATION }, norms), doc.switchedFromClinicDefault)
            .map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </label>
      {/* Fix round 1, ruling T11-4: the case's population names a user-norm set that no longer exists
          (deleted in Settings ▸ Norms since the case was set to it) — the select has no matching option (so it
          would otherwise read blank with no explanation), and the resolver (queryFor, normCell.ts) already falls
          back to the clinic default for the same reason. Say so, rather than let the screen and the resolver
          merely happen to agree without saying why. */}
      {/* Final review M-8: a failed read of your norms is said as that, never as a deletion. */}
      {populationNote(missingPopulation, normExtras.userNormsFailed) && <p className="hint warn" role="status">{populationNote(missingPopulation, normExtras.userNormsFailed)}</p>}
      <button type="button" onClick={() => setCompareOpen(true)}>Compare populations…</button>
      </PanelSection>
      <PanelSection title="Text on the film" collapsible={{ open: filmTextOpen, onToggle: onFilmText }}>
      <FilmText key={doc.id} lines={filmLines} reading={kase.readingText} locked={locked} dateFormat={dateFormat}
        doc={doc} onRead={() => void kase.readFilmText()} onUse={use} />
      </PanelSection>
      <PanelSection title="Points">
      {/* Facing is automatic on import; the choice appears only when that call was a near tie (owner, 28 Sep). */}
      {kase.facingUnsure && <div className="segmented" role="radiogroup" aria-label="Patient faces">
        {(['right', 'left'] as const).map((f) => (
          <button key={f} type="button" role="radio" aria-checked={doc.facing === f} disabled={locked}
            onClick={() => { if (doc.facing !== f) void kase.redetect({ facing: f }); }}>Faces {f}</button>))}
      </div>}
      <div className="row">
        <button type="button" disabled={locked} title="New AI points and a fresh facing check; your placed, moved and accepted points are kept" onClick={() => void kase.redetect({})}>Re-detect</button>
        <button type="button" disabled={locked} title="Replace every point with new AI points (⌘Z undoes it)" onClick={() => void kase.redetect({ overwrite: true })}>Replace all…</button>
      </div>
      {ghostKey && (ghostKey.ghosts.length > 0 || ghostKey.errors.length > 0) && (() => {
        // Owner, 5 Oct: a tick-box per model, plus "Show all" (a dash — indeterminate — when only some are on).
        const listedIds = ghostKey.ghosts.map((g) => g.modelId);
        const all = showAllState(ghostKey.ghosts, ghostKey.hidden);
        return (
          <div className="ghost-key" aria-label="Other models">
            {ghostKey.ghosts.length > 0 && <label className="inline">
              <input type="checkbox" checked={all === 'all'} ref={(el) => { if (el) el.indeterminate = all === 'some'; }}
                onChange={() => ghostKey.onToggleAll(listedIds)} />Show all</label>}
            {ghostKey.ghosts.map((g) => (
              <label key={g.modelId} className="inline ghost-chip-row">
                <input type="checkbox" aria-label={`Show ${g.title}`} checked={!ghostKey.hidden.has(g.modelId)}
                  onChange={() => ghostKey.onToggleModel(g.modelId)} />
                <span className={`ghost-chip ghost-${g.shade}`}>{g.shade === 1 ? '◇' : '◆'} {g.title}</span>
              </label>))}
            {ghostKey.errors.map((e) => <div key={e} className="hint warn">{e}</div>)}
          </div>
        );
      })()}
      <div className={`save ${kase.save.status}`} role="status">
        {kase.save.status === 'error'
          ? <>Not saved: {kase.save.error} <button type="button" onClick={() => void kase.retrySave()}>Retry</button></>
          : kase.save.status === 'saved' ? 'All changes saved' : 'Saving…'}
      </div>
      </PanelSection>
      <PanelSection title="Enhance (display only)" collapsible={{ open: enhanceOpen, onToggle: onEnhance }}>
      <div className="enhance">
        <label>Brightness<input type="range" min={0.5} max={2} step={0.05} value={state.display.brightness}
          onChange={(e) => dispatch({ type: 'setDisplay', display: { brightness: Number(e.target.value) } })} /></label>
        <label>Contrast<input type="range" min={0.5} max={3} step={0.05} value={state.display.contrast}
          onChange={(e) => dispatch({ type: 'setDisplay', display: { contrast: Number(e.target.value) } })} /></label>
        <label>Sharpness<input type="range" min={0} max={2} step={0.1} value={state.display.sharpness}
          onChange={(e) => dispatch({ type: 'setDisplay', display: { sharpness: Number(e.target.value) } })} /></label>
        <label className="inline"><input type="checkbox" checked={state.display.invert}
          onChange={(e) => dispatch({ type: 'setDisplay', display: { invert: e.target.checked } })} />Invert</label>
        <button type="button" onClick={() => dispatch({ type: 'setDisplay', display: DISPLAY_DEFAULT })}>Reset</button>
      </div>
      </PanelSection>
      {compareOpen && <ComparePopulations rows={compareRows} doc={doc} ctx={norms} decimals={decimals}
        unconfirmedFor={normExtras.unconfirmedFor} onClose={() => setCompareOpen(false)} scaleNote={scaleNote} />}
    </div>
  );
}
