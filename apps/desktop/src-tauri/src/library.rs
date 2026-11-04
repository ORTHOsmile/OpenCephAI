//! Library commands: thin wrappers over ceph_store::Library, run off the UI thread. Patient data stays in the app data folder.
use ceph_store::{AiRun, CaseDoc, CaseEdit, CaseMeta, CaseSummary, IdentityOutcome, IdentityRead, Imported, Library, PatientRef, Saved, UserNorm};
use std::{path::{Path, PathBuf}, sync::{Arc, Mutex}};
use tauri::Manager;

#[derive(Default, Clone)]
pub struct LibState(Arc<Mutex<Option<Library>>>);

/// Who is making a change, for the audit trail: the `operator` setting, else the macOS login name.
pub fn operator(lib: &Library) -> String {
    lib.setting("operator").ok().flatten().filter(|s| !s.trim().is_empty())
        .or_else(|| std::env::var("USER").ok()).unwrap_or_else(|| "unknown".into())
}

/// Settings key for the folder chosen with "Locate model…".
pub const MODEL_DIR_KEY: &str = "modelDir";

/// Settings key for the date-format preference: "AU" (DD/MM/YYYY, the default) or "US" (MM/DD/YYYY).
pub const DATE_FORMAT_KEY: &str = "dateFormat";

/// What ceph-label read, as the store's ISO fields.
fn identity_read(f: ceph_label::LabelFields) -> IdentityRead {
    IdentityRead { name: f.name, date_of_birth: f.date_of_birth.map(|d| d.iso()), scan_date: f.scan_date.map(|d| d.iso()), scan_id: f.scan_id }
}

/// A setting read synchronously (for start-up lookups); None if unset or the library can't be opened.
pub fn setting(app: &tauri::AppHandle, key: &str) -> Option<String> {
    let (st, root) = (app.state::<LibState>().0.clone(), root(app).ok()?);
    let mut g = st.lock().ok()?;
    if g.is_none() { *g = open_library(&root).ok(); }
    g.as_ref()?.setting(key).ok().flatten().filter(|v| !v.trim().is_empty())
}
/// Best-effort synchronous setting write (a failure only means it isn't remembered).
pub fn set_setting(app: &tauri::AppHandle, key: &str, value: &str) {
    let Ok(root) = root(app) else { return };
    let st = app.state::<LibState>().0.clone();
    let Ok(mut g) = st.lock() else { return };
    if g.is_none() { *g = open_library(&root).ok(); }
    if let Some(lib) = g.as_mut() { lib.set_setting(key, value).ok(); }
}

/// Opens the library; if opening upgraded its format, the safety copy's folder is kept for the one-time notice.
/// A library that can't be opened (including a refused upgrade, `ceph_store::UPGRADE_COPY_FAILED`) stays unopened and
/// its error reaches the screen through `with`, like any other open failure.
fn open_library(root: &Path) -> anyhow::Result<Library> { Ok(noting(Library::open(root)?)) }
static UPGRADE_COPY: Mutex<Option<String>> = Mutex::new(None);
fn noting(lib: Library) -> Library {
    if let Some(dir) = lib.upgrade_copy() { if let Ok(mut g) = UPGRADE_COPY.lock() { *g = Some(dir.display().to_string()); } }
    lib
}
fn library_upgrade_copy_take() -> Option<String> { UPGRADE_COPY.lock().ok()?.take() }
/// The folder of the safety copy made when this run upgraded the library's format, once; then None.
#[tauri::command] pub async fn library_upgrade_copy() -> Option<String> { library_upgrade_copy_take() }

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> { app.path().app_data_dir().map_err(|e| e.to_string()) }

/// Whether this licence version was accepted on this Mac (false if the library can't be read).
pub async fn licence_accepted(app: &tauri::AppHandle, id: &str, version: &str) -> bool {
    let (id, version) = (id.to_string(), version.to_string());
    with(app, move |l, _| l.licence_accepted(&id, &version)).await.unwrap_or(false)
}
/// Records the acceptance, by whoever is tracing.
pub async fn accept_licence(app: &tauri::AppHandle, id: &str, version: &str) -> Result<(), String> {
    let (id, version) = (id.to_string(), version.to_string());
    with(app, move |l, op| l.accept_licence(&id, &version, op)).await
}

/// Runs `f` on the library (opened on first use) on a blocking thread; errors become user-facing strings.
async fn with<T: Send + 'static>(app: &tauri::AppHandle, f: impl FnOnce(&mut Library, &str) -> anyhow::Result<T> + Send + 'static) -> Result<T, String> {
    let (st, root) = (app.state::<LibState>().0.clone(), root(app)?);
    tauri::async_runtime::spawn_blocking(move || {
        let mut g = st.lock().map_err(|_| "the library is unavailable after an earlier failure; restart OpenCephAI".to_string())?;
        if g.is_none() { *g = Some(open_library(&root).map_err(|e| format!("{e:#}"))?); }
        let lib = g.as_mut().expect("opened above");
        let op = operator(lib);
        f(lib, &op).map_err(|e| format!("{e:#}"))
    }).await.map_err(|e| e.to_string())?
}

#[tauri::command] pub async fn library_list(app: tauri::AppHandle, deleted: bool) -> Result<Vec<CaseSummary>, String> { with(&app, move |l, _| l.list(deleted)).await }
#[tauri::command] pub async fn library_import(app: tauri::AppHandle, path: String) -> Result<Imported, String> { with(&app, move |l, _| l.import(Path::new(&path))).await }
#[tauri::command] pub async fn library_open(app: tauri::AppHandle, case_id: String) -> Result<CaseDoc, String> { with(&app, move |l, _| l.load(&case_id)).await }
// Every write that can change what the learning record holds (a point, its verification, a model run, the ruler) is
// followed by `learn_or_log`, which never fails the write (spec 2026-10-13 "Parked" P5, preflight c8).
/// A save, then the learning record (which never fails the save).
pub(crate) fn save_and_learn(l: &mut Library, edit: &CaseEdit, op: &str) -> anyhow::Result<Saved> {
    let s = l.save(edit, op)?;
    crate::learning::learn_or_log(l, &edit.id, op);
    Ok(s)
}
/// Batch tracing's save; the record is rebuilt only if it wrote.
pub(crate) fn save_ai_if_untraced_and_learn(l: &mut Library, edit: &CaseEdit, op: &str) -> anyhow::Result<bool> {
    let done = l.save_ai_if_untraced(edit, op)?;
    if done { crate::learning::learn_or_log(l, &edit.id, op); }
    Ok(done)
}
/// A model run; a run recorded after you verified a point adds that model's row.
pub(crate) fn record_ai_and_learn(l: &mut Library, case_id: &str, run: &AiRun, points: &[ceph_store::AiPoint], op: &str) -> anyhow::Result<()> {
    l.record_ai_run(case_id, run, points)?;
    crate::learning::learn_or_log(l, case_id, op);
    Ok(())
}
/// "Mark tracing verified" (or its undo), then the record.
pub(crate) fn set_verified_and_learn(l: &mut Library, case_id: &str, verified: bool, op: &str) -> anyhow::Result<()> {
    l.set_verified(case_id, verified, op)?;
    crate::learning::learn_or_log(l, case_id, op);
    Ok(())
}
/// A ruler calibration changes every millimetre: the store drops the old rows, and they are rebuilt at the new scale.
pub(crate) fn calibrate_and_learn(l: &mut Library, case_id: &str, p1: (f64, f64), p2: (f64, f64), mm: f64, op: &str) -> anyhow::Result<f64> {
    let s = l.calibrate(case_id, p1, p2, mm, op)?;
    crate::learning::learn_or_log(l, case_id, op);
    Ok(s)
}

#[tauri::command] pub async fn library_save(app: tauri::AppHandle, edit: CaseEdit) -> Result<Saved, String> { with(&app, move |l, op| save_and_learn(l, &edit, op)).await }
#[tauri::command] pub async fn library_save_ai_if_untraced(app: tauri::AppHandle, edit: CaseEdit) -> Result<bool, String> { with(&app, move |l, op| save_ai_if_untraced_and_learn(l, &edit, op)).await }
#[tauri::command] pub async fn library_record_ai(app: tauri::AppHandle, case_id: String, run: AiRun, points: Vec<ceph_store::AiPoint>) -> Result<(), String> {
    with(&app, move |l, op| record_ai_and_learn(l, &case_id, &run, &points, op)).await
}
#[tauri::command] pub async fn library_ghosts(app: tauri::AppHandle, case_id: String) -> Result<Vec<ceph_store::ModelPoints>, String> {
    with(&app, move |l, _| l.latest_ai_points(&case_id)).await
}

/// Adds the name if new and makes it the one who traces (setting "operator").
pub fn set_current_operator(lib: &mut Library, name: &str) -> anyhow::Result<String> {
    let n = lib.add_operator(name)?;
    lib.set_setting("operator", &n)?;
    Ok(n)
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Operators { current: String, names: Vec<String> }

#[tauri::command] pub async fn operators_list(app: tauri::AppHandle) -> Result<Operators, String> {
    with(&app, |l, op| Ok(Operators { current: op.to_string(), names: l.operators(op)? })).await
}
#[tauri::command] pub async fn operators_add(app: tauri::AppHandle, name: String) -> Result<Operators, String> {
    // Seed the list with today's name first, so the first orthodontist is never lost from it.
    with(&app, move |l, op| { l.operators(op)?; let n = set_current_operator(l, &name)?; Ok(Operators { names: l.operators(&n)?, current: n }) }).await
}
#[tauri::command] pub async fn operators_set_current(app: tauri::AppHandle, name: String) -> Result<(), String> {
    with(&app, move |l, op| { anyhow::ensure!(l.operators(op)?.contains(&name), "{name} is not in the list"); l.set_setting("operator", &name) }).await
}
#[tauri::command] pub async fn library_set_meta(app: tauri::AppHandle, case_id: String, meta: CaseMeta) -> Result<(), String> {
    let id = case_id.clone();
    with(&app, move |l, _| l.set_meta(&id, &meta)).await?;
    after_confirm(&app, case_id).await;
    Ok(())
}
/// Gender (spec 2026-10-04): saved on the patient; never teaches the machine. A single-field save (final-review fix
/// round, Important 1) so it can never overwrite a Referrer edit that landed out of order with it.
#[tauri::command] pub async fn library_set_patient_gender(app: tauri::AppHandle, case_id: String, gender: Option<String>) -> Result<(), String> {
    with(&app, move |l, _| l.set_patient_gender(&case_id, gender.as_deref())).await
}
/// Referring practitioner (spec 2026-10-04): saved on the patient; never teaches the machine. A single-field save
/// (see `library_set_patient_gender`).
#[tauri::command] pub async fn library_set_patient_referrer(app: tauri::AppHandle, case_id: String, referring_practitioner: Option<String>) -> Result<(), String> {
    with(&app, move |l, _| l.set_patient_referrer(&case_id, referring_practitioner.as_deref())).await
}
/// Patient ID (spec 2026-10-17; addendum D2, Q8): saved on this X-ray, never the patient; a single-field save (the
/// Gender/Referrer race lesson).
#[tauri::command] pub async fn library_set_patient_id(app: tauri::AppHandle, case_id: String, patient_id: Option<String>) -> Result<(), String> {
    with(&app, move |l, _| l.set_patient_id(&case_id, patient_id.as_deref())).await
}
/// X-ray type, X-ray dimensions or Radiography practice ("xray_type", "xray_size", "practice"), on this film; single-field.
#[tauri::command] pub async fn library_set_film_detail(app: tauri::AppHandle, case_id: String, field: String, value: Option<String>) -> Result<(), String> {
    with(&app, move |l, _| l.set_film_detail(&case_id, &field, value.as_deref())).await
}
/// "Not the same" on a Patient ID link suggestion (addendum D2, LIBID-1): remembered for this X-ray and that
/// patient's Library ID only.
#[tauri::command] pub async fn library_not_same_patient(app: tauri::AppHandle, case_id: String, library_id: String) -> Result<(), String> {
    with(&app, move |l, _| l.not_same_patient(&case_id, &library_id)).await
}
/// Owner Q10: the ✓ beside a "Learned for this machine" mark. Keeps the value, drops only that mark.
#[tauri::command] pub async fn library_accept_learned(app: tauri::AppHandle, case_id: String, field: String) -> Result<(), String> {
    with(&app, move |l, _| l.accept_learned(&case_id, &field)).await
}
/// The recognised text of each film read this session, by case id: memory only, never written to disk or logged.
#[derive(Default, Clone)]
pub struct FilmTexts(Arc<Mutex<std::collections::HashMap<String, Vec<ceph_label::TextLine>>>>);
fn remember(app: &tauri::AppHandle, case_id: &str, lines: Vec<ceph_label::TextLine>, append: bool) {
    if let Ok(mut m) = app.state::<FilmTexts>().0.lock() {
        if append { m.entry(case_id.to_string()).or_default().extend(lines); } else { m.insert(case_id.to_string(), lines); }
    }
}
fn remembered(app: &tauri::AppHandle, case_id: &str) -> Vec<ceph_label::TextLine> {
    app.state::<FilmTexts>().0.lock().ok().and_then(|m| m.get(case_id).cloned()).unwrap_or_default()
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct WordOut { text: String, bbox: [f64; 4] }
/// A recognised line for the window: its text and box, and each word's box (0–1 of the stored film).
#[derive(Debug, Clone, serde::Serialize)]
pub struct LineOut { text: String, bbox: [f64; 4], words: Vec<WordOut> }
fn line_out(l: &ceph_label::TextLine) -> LineOut {
    LineOut { text: l.text.clone(), bbox: l.bbox, words: l.words.iter().map(|w| WordOut { text: w.text.clone(), bbox: w.bbox }).collect() }
}
/// A learned place that reads something on this film: shown as "Suggested" (or "Learned" when it is the default).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Suggestion { field: String, line: usize, from: usize, to: usize, value: String, is_default: bool }

/// Values from the machine's default places (the fill table's "learned" column), and every learned place that reads
/// something on this film as a suggestion. Last + First make "Last, First"; Full is used otherwise.
fn learned_read(lines: &[ceph_label::TextLine], places: &[ceph_store::Place], order: ceph_label::DateOrder, today: ceph_label::Ymd)
    -> (IdentityRead, ceph_store::FilmDetailsRead, Vec<Suggestion>) {
    let mut sugg: Vec<Suggestion> = Vec::new();
    for p in places {
        let Some(pk) = ceph_label::layout::read_rule(lines, &p.rule) else { continue };
        let Some(v) = ceph_label::layout::field_value(&p.field, &pk.text, order, today) else { continue };
        if !sugg.iter().any(|s| s.field == p.field && (s.line, s.from, s.to) == (pk.line, pk.from, pk.to)) {
            sugg.push(Suggestion { field: p.field.clone(), line: pk.line, from: pk.from, to: pk.to, value: v, is_default: p.default });
        }
    }
    let def = |f: &str| sugg.iter().find(|s| s.field == f && s.is_default).map(|s| s.value.clone());
    let name = match (def("last"), def("first")) { (Some(l), Some(f)) => Some(format!("{l}, {f}")), _ => def("full") };
    // The new details (spec 2026-10-17, D-LEARN-1) come from default places only, beside the identity fields.
    let details = ceph_store::FilmDetailsRead { printed_patient_id: def("patient_id"), xray_type: def("xray_type"),
        xray_size: def("xray_size"), practice: def("practice"), gender: def("gender"), referrer: def("referrer") };
    (IdentityRead { name, date_of_birth: def("dob"), scan_date: def("film_date"), scan_id: def("scan_id") }, details, sugg)
}

/// Where a confirmed value is printed: the shortest run of words on one line (up to 6) that reads as that value (names by
/// name key, dates and IDs by the field's own reading, either day/month order) — its own words, not the label before it,
/// so choosing and confirming teach the same place (final review I3).
fn find_value(lines: &[ceph_label::TextLine], field: &str, value: &str) -> Option<(usize, usize, usize)> {
    let today = ceph_label::Ymd { y: 9999, m: 12, d: 31 };
    let key = ceph_store::identity::name_key(value);
    let reads = |text: &str| match field {
        "last" | "first" | "full" => !key.is_empty() && ceph_store::identity::name_key(text.trim_end_matches(',')) == key,
        // As printed (spec 2026-10-17; owner Q6 adds referrer): case, commas and spacing ignored.
        "xray_type" | "xray_size" | "practice" | "referrer" => {
            let squash = |s: &str| s.trim_end_matches(',').split_whitespace().collect::<Vec<_>>().join(" ").to_lowercase();
            !value.trim().is_empty() && squash(text) == squash(value)
        }
        _ => [ceph_label::DateOrder::Au, ceph_label::DateOrder::Us].iter()
            .any(|o| ceph_label::layout::field_value(field, text, *o, today).as_deref() == Some(value)),
    };
    for len in 1..=6 {
        for (i, l) in lines.iter().enumerate() {
            for from in 0..l.words.len().saturating_sub(len - 1) {
                let to = from + len - 1;
                let text = l.words[from..=to].iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ");
                if reads(&text) { return Some((i, from, to)); }
            }
        }
    }
    None
}

/// Words a rule may start after or end before: the field labels and this machine's pattern words.
fn known(anchors: &[String]) -> Vec<String> {
    ceph_label::layout::LABEL_WORDS.iter().map(|w| w.to_string()).chain(anchors.iter().cloned()).collect()
}

/// A confirmed film's tokens for its machine's pattern, without any line that carries the patient's name (middle names
/// and name parts included; final review I4).
fn confirm_tokens(lines: &[ceph_label::TextLine], name: &str) -> Vec<ceph_label::layout::FilmToken> {
    let own: Vec<String> = name.split_whitespace().flat_map(|w| std::iter::once(w).chain(w.split(|c: char| !c.is_alphanumeric())))
        .filter_map(ceph_label::layout::token).collect();
    let mine = |w: &str| std::iter::once(w).chain(w.split(|c: char| !c.is_alphanumeric()))
        .filter_map(ceph_label::layout::token).any(|t| own.contains(&t));
    let kept: Vec<ceph_label::TextLine> = lines.iter().filter(|l| !l.words.iter().any(|w| mine(&w.text))).cloned().collect();
    ceph_label::layout::film_tokens(&kept)
}

/// The case's film, the operator's date order and today's date on this Mac.
async fn film_context(app: &tauri::AppHandle, case_id: String) -> Result<(String, ceph_label::DateOrder, ceph_label::Ymd), String> {
    with(app, move |l, _| {
        let path = l.load(&case_id)?.image.path;
        let today = l.today_local()?;
        let today = ceph_label::Ymd::parse_iso(&today).ok_or_else(|| anyhow::anyhow!("the Mac's date could not be read"))?;
        Ok((path, ceph_label::DateOrder::from_setting(l.setting(DATE_FORMAT_KEY)?.as_deref()), today))
    }).await
}
/// Recognises the text on the case's film on its own thread, outside the library lock.
async fn film_text(app: &tauri::AppHandle, case_id: String) -> Result<(anyhow::Result<Vec<ceph_label::TextLine>>, ceph_label::DateOrder, ceph_label::Ymd), String> {
    let (path, order, today) = film_context(app, case_id).await?;
    let read = tauri::async_runtime::spawn_blocking(move || ceph_label::read_text(Path::new(&path), order, today)).await.map_err(|e| e.to_string())?;
    Ok((read, order, today))
}

/// The check after reading a label, with the text on the film, the fields filled from this machine's learned defaults,
/// any disagreement between the label and a default, and the learned places as suggestions. The text goes to the
/// window only: it is never stored or logged.
#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LabelOutcome {
    #[serde(flatten)] outcome: IdentityOutcome,
    lines: Vec<LineOut>, learned_fields: Vec<String>, conflicts: Vec<ceph_store::Conflict>, suggestions: Vec<Suggestion>,
}

/// Reads the patient label off a freshly imported film and fills the case (spec 2026-09-28 Part 1), matching the film
/// to its machine and using that machine's learned defaults (spec 2026-09-29 Parts 2–3). If recognition fails (not
/// macOS, a Vision error, no text), nothing is filled and the clinician is asked; import carries on either way.
#[tauri::command] pub async fn library_read_label(app: tauri::AppHandle, case_id: String) -> Result<LabelOutcome, String> {
    let (read, order, today) = film_text(&app, case_id.clone()).await?;
    let lines = read.unwrap_or_default();
    remember(&app, &case_id, lines.clone(), false);
    let label = ceph_label::fields_from(&lines, order, today);
    let label_pid = label.patient_id.clone();
    let fields = identity_read(label);
    let tokens = ceph_label::layout::film_tokens(&lines);
    let l2 = lines.clone();
    let (applied, suggestions) = with(&app, move |l, _| fill_from_label(l, &case_id, &fields, label_pid, &tokens, &l2, order, today)).await?;
    Ok(LabelOutcome { outcome: applied.outcome, lines: lines.iter().map(line_out).collect(), learned_fields: applied.learned_fields,
        conflicts: applied.conflicts, suggestions })
}

/// The label's fields, with the film's machine's learned defaults where the machine is known. A failure while
/// recognising the machine leaves the film without one and never loses the label's own reading (owner, 30 Sep: M8);
/// nor does a failure filling the new details from the machine's defaults (pre-flight D9, spec 2026-10-17).
///
/// `label_patient_id` is the film's own "PID"/"Patient ID" label (owner Q4), read straight off this film — never a
/// learned place. By the Q4 fill table (`merge_patient_id`): agreeing with, or alone against, the machine's learned
/// Patient ID fills this X-ray's own Patient ID directly and is never marked "Learned for this machine" (it is the
/// label's own reading); a learned place alone still fills through `apply_learned_details` below, marked learned as
/// before; a disagreement fills nothing and is returned as a conflict.
fn fill_from_label(l: &mut Library, case_id: &str, fields: &IdentityRead, label_patient_id: Option<String>, tokens: &[ceph_label::layout::FilmToken],
    lines: &[ceph_label::TextLine], order: ceph_label::DateOrder, today: ceph_label::Ymd) -> anyhow::Result<(ceph_store::LabelApplied, Vec<Suggestion>)> {
    let matched = !lines.is_empty() && l.match_machine(case_id, tokens).is_ok();
    let places = if matched { l.places(case_id).unwrap_or_default() } else { vec![] };
    let (learned, mut details, sugg) = learned_read(lines, &places, order, today);
    let mut applied = l.apply_label_with(case_id, fields, &learned)?;
    let (v, from_learned, conflict) = ceph_store::merge_patient_id(label_patient_id.as_deref(), details.printed_patient_id.as_deref());
    if let Some(c) = conflict { applied.conflicts.push(c); }
    if from_learned {
        details.printed_patient_id = v;   // falls through to apply_learned_details below, marked learned as before
    } else {
        // The label's own PID fills this X-ray's own Patient ID directly (never marked learned); an error here is
        // logged (never the value) and never loses the label's own identity reading, already saved above (D9).
        if let Err(e) = l.apply_label_patient_id(case_id, v.as_deref()) { eprintln!("label patient id not applied: {e:#}"); }
        details.printed_patient_id = None;
    }
    // After the label has moved the film to its patient, so a learned Patient ID lands on that patient (only if blank).
    // An error here is logged (never a value) and counts as nothing learned: the label's reading is saved (pre-flight D9).
    applied.learned_fields.extend(l.apply_learned_details(case_id, &details).unwrap_or_else(|e| {
        eprintln!("learned film details not applied: {e:#}");
        vec![]
    }));
    Ok((applied, sugg))
}

/// The remembered line holding exactly the chosen words: the given line if its words `from..=to` read `text`, else the
/// first line that does (owner, 30 Sep: M4 — quick re-reads can shift the line numbers under a selection).
fn pick_line<'a>(lines: &'a [ceph_label::TextLine], line: usize, from: usize, to: usize, text: &str) -> Option<&'a ceph_label::TextLine> {
    let holds = |l: &&ceph_label::TextLine| from <= to && to < l.words.len()
        && l.words[from..=to].iter().map(|w| w.text.as_str()).collect::<Vec<_>>().join(" ") == text;
    lines.get(line).filter(holds).or_else(|| lines.iter().find(holds))
}

#[derive(Debug, serde::Serialize)]
pub struct FilmTextOut { lines: Vec<LineOut>, suggestions: Vec<Suggestion> }
/// "Read the film again": the text on the film and the learned places on it; nothing is filled or stored. A film
/// imported before machines were learned is matched to one now.
#[tauri::command] pub async fn library_label_text(app: tauri::AppHandle, case_id: String) -> Result<FilmTextOut, String> {
    let (read, order, today) = film_text(&app, case_id.clone()).await?;
    let lines = read.map_err(|e| format!("{e:#}"))?;
    remember(&app, &case_id, lines.clone(), false);
    let tokens = ceph_label::layout::film_tokens(&lines);
    let l2 = lines.clone();
    let suggestions = with(&app, move |l, _| {
        if !l2.is_empty() && l.machine_of(&case_id)?.is_none() { l.match_machine(&case_id, &tokens)?; }
        Ok(learned_read(&l2, &l.places(&case_id)?, order, today).2)
    }).await?;
    Ok(FilmTextOut { lines: lines.iter().map(line_out).collect(), suggestions })
}

/// Re-reads a small area of the film ([x, y, w, h], 0–1 of the stored film) enlarged, both ways round; the lines found
/// are added to the case's text in memory, so they can be chosen and learned from.
#[tauri::command] pub async fn library_read_area(app: tauri::AppHandle, case_id: String, rect: [f64; 4]) -> Result<Vec<LineOut>, String> {
    let (path, order, today) = film_context(&app, case_id.clone()).await?;
    let lines = tauri::async_runtime::spawn_blocking(move || ceph_label::read_area(Path::new(&path), rect, order, today))
        .await.map_err(|e| e.to_string())?.map_err(|e| format!("{e:#}"))?;
    remember(&app, &case_id, lines.clone(), true);
    Ok(lines.iter().map(line_out).collect())
}

/// Words chosen on the film for a field (Choose mode): teaches the film's machine where that field is printed.
#[tauri::command] pub async fn library_learn_selection(app: tauri::AppHandle, case_id: String, field: String, line: usize, from: usize, to: usize, text: String) -> Result<(), String> {
    let lines = remembered(&app, &case_id);
    let l = pick_line(&lines, line, from, to, &text).ok_or("those words are no longer on the film's text; read the film again")?.clone();
    with(&app, move |lib, _| {
        // Nothing on the film marks where these words start or end: the value is kept, but no place is learned.
        match ceph_label::layout::rule_from_selection(&l, from, to, &field, &known(&lib.anchor_tokens(&case_id)?)) {
            Some(rule) => lib.learn(&case_id, &field, &rule),
            None => Ok(()),
        }
    }).await
}
/// A value the clinician confirmed (typed, a Text on the film button, or OK): if it is printed on the film, teaches the
/// machine where. Returns whether it was found.
#[tauri::command] pub async fn library_learn_value(app: tauri::AppHandle, case_id: String, field: String, value: String) -> Result<bool, String> {
    let lines = remembered(&app, &case_id);
    let Some((i, from, to)) = find_value(&lines, &field, &value) else { return Ok(false) };
    let l = lines[i].clone();
    with(&app, move |lib, _| {
        let Some(rule) = ceph_label::layout::rule_from_selection(&l, from, to, &field, &known(&lib.anchor_tokens(&case_id)?)) else { return Ok(false) };
        lib.learn(&case_id, &field, &rule)?;
        Ok(true)
    }).await
}
/// After a person confirms a case, its film teaches its machine's printing pattern (spec Part 2). Best-effort: a
/// failure here never fails the save.
async fn after_confirm(app: &tauri::AppHandle, case_id: String) {
    let lines = remembered(app, &case_id);
    if lines.is_empty() { return; }
    let _ = with(app, move |l, _| {
        let name = l.load(&case_id)?.patient_name;
        l.record_confirmed_film(&case_id, &confirm_tokens(&lines, &name))
    }).await;
}
#[tauri::command] pub async fn library_machines(app: tauri::AppHandle) -> Result<Vec<ceph_store::MachineSummary>, String> { with(&app, |l, _| l.list_machines()).await }
#[tauri::command] pub async fn library_rename_machine(app: tauri::AppHandle, id: String, name: String) -> Result<(), String> { with(&app, move |l, _| l.rename_machine(&id, &name)).await }
#[tauri::command] pub async fn library_reset_machine(app: tauri::AppHandle, id: String) -> Result<(), String> { with(&app, move |l, _| l.reset_machine(&id)).await }
#[tauri::command] pub async fn library_delete_machine(app: tauri::AppHandle, id: String) -> Result<(), String> { with(&app, move |l, _| l.delete_machine(&id)).await }
#[tauri::command] pub async fn library_confirm_identity(app: tauri::AppHandle, case_id: String, same_as: Option<PatientRef>) -> Result<(), String> {
    let id = case_id.clone();
    with(&app, move |l, _| l.confirm_identity(&id, same_as.as_ref())).await?;
    after_confirm(&app, case_id).await;
    Ok(())
}
#[tauri::command] pub async fn library_confirm_film_date(app: tauri::AppHandle, case_id: String) -> Result<(), String> {
    with(&app, move |l, _| l.confirm_film_date(&case_id)).await
}
#[tauri::command] pub async fn library_series(app: tauri::AppHandle, case_id: String) -> Result<Vec<ceph_store::SeriesFilm>, String> {
    with(&app, move |l, _| l.series(&case_id)).await
}
#[tauri::command] pub async fn library_set_stage(app: tauri::AppHandle, case_id: String, stage: Option<String>) -> Result<(), String> {
    with(&app, move |l, _| l.set_stage(&case_id, stage.as_deref())).await
}
#[tauri::command] pub async fn library_set_in_series(app: tauri::AppHandle, case_id: String, on: bool) -> Result<(), String> {
    with(&app, move |l, _| l.set_in_series(&case_id, on)).await
}
#[tauri::command] pub async fn library_set_verified(app: tauri::AppHandle, case_id: String, verified: bool) -> Result<(), String> { with(&app, move |l, op| set_verified_and_learn(l, &case_id, verified, op)).await }
#[tauri::command] pub async fn library_calibrate(app: tauri::AppHandle, case_id: String, p1: [f64; 2], p2: [f64; 2], mm: f64) -> Result<f64, String> {
    with(&app, move |l, op| calibrate_and_learn(l, &case_id, (p1[0], p1[1]), (p2[0], p2[1]), mm, op)).await
}
#[tauri::command] pub async fn library_delete(app: tauri::AppHandle, case_id: String) -> Result<(), String> { with(&app, move |l, _| l.delete(&case_id)).await }
#[tauri::command] pub async fn library_restore(app: tauri::AppHandle, case_id: String) -> Result<(), String> { with(&app, move |l, _| l.restore(&case_id)).await }
#[tauri::command] pub async fn library_backup(app: tauri::AppHandle, dest: String) -> Result<String, String> {
    with(&app, move |l, _| l.backup(Path::new(&dest)).map(|p| p.display().to_string())).await
}
/// Swaps in a verified backup: the open library is closed first, then reopened from the restored files.
#[tauri::command] pub async fn library_restore_backup(app: tauri::AppHandle, dir: String) -> Result<(), String> {
    let (st, root) = (app.state::<LibState>().0.clone(), root(&app)?);
    tauri::async_runtime::spawn_blocking(move || restore_into(&st, &root, Path::new(&dir))).await.map_err(|e| e.to_string())?
}
/// The restore itself, off the UI thread: close, restore, reopen (also after a failure, which put the library back).
fn restore_into(st: &Mutex<Option<Library>>, root: &Path, dir: &Path) -> Result<(), String> {
    let mut g = st.lock().map_err(|_| "the library is unavailable; restart OpenCephAI".to_string())?;
    *g = None;                                                                // close before the files move
    match Library::restore_backup(root, dir) {
        Ok(lib) => { *g = Some(noting(lib)); Ok(()) }
        Err(e) => { *g = open_library(root).ok(); Err(format!("{e:#}")) }     // the library was put back: reopen it
    }
}
#[tauri::command] pub async fn settings_get(app: tauri::AppHandle, key: String) -> Result<Option<String>, String> { with(&app, move |l, _| l.setting(&key)).await }
#[tauri::command] pub async fn settings_set(app: tauri::AppHandle, key: String, value: String) -> Result<(), String> { with(&app, move |l, _| l.set_setting(&key, &value)).await }

/// The case's chosen reference population (spec 2026-10-06 Part C, N6; schema 9); `None` = use the clinic default.
#[tauri::command] pub async fn library_set_case_population(app: tauri::AppHandle, case_id: String, population: Option<String>) -> Result<(), String> {
    with(&app, move |l, _| l.set_case_population(&case_id, population.as_deref())).await
}
/// Every clinician-entered norm, never in git, always labelled "user norm" by the caller.
#[tauri::command] pub async fn library_user_norms(app: tauri::AppHandle) -> Result<Vec<UserNorm>, String> { with(&app, |l, _| l.user_norms()).await }
#[tauri::command] pub async fn library_save_user_norm(app: tauri::AppHandle, norm: UserNorm) -> Result<(), String> { with(&app, move |l, _| l.save_user_norm(&norm)).await }
#[tauri::command] pub async fn library_delete_user_norm(app: tauri::AppHandle, set_name: String, measurement: String) -> Result<(), String> {
    with(&app, move |l, _| l.delete_user_norm(&set_name, &measurement)).await
}
/// The clinic default reference population (Settings; N6); `None` = not set.
#[tauri::command] pub async fn settings_default_population_get(app: tauri::AppHandle) -> Result<Option<String>, String> { with(&app, |l, _| l.default_population()).await }
#[tauri::command] pub async fn settings_default_population_set(app: tauri::AppHandle, population: Option<String>) -> Result<(), String> {
    with(&app, move |l, _| l.set_default_population(population.as_deref())).await
}

#[cfg(test)]
mod tests {
    use super::*;
    /// Tests that open an old library share the process-wide `UPGRADE_COPY` note, so they take turns (review Minor 3).
    static NOTE_LOCK: Mutex<()> = Mutex::new(());
    fn schema_7_library(root: &Path) {
        let c = rusqlite::Connection::open(root.join("library.sqlite3")).unwrap();
        for (i, sql) in ceph_store::schema::MIGRATIONS.iter().take(7).enumerate() { c.execute_batch(sql).unwrap(); c.pragma_update(None, "user_version", i as i64 + 1).unwrap(); }
    }
    /// AUTOBACKUP-1 reaching the screen: opening an old library leaves the copy's folder for the notice, once; a
    /// current library leaves none.
    #[test] fn opening_an_old_library_leaves_the_copy_location_for_the_notice_once() {
        let _turn = NOTE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let t = tempfile::tempdir().unwrap();
        schema_7_library(t.path());
        let lib = open_library(t.path()).unwrap();
        let copy = lib.upgrade_copy().expect("a copy was made").to_path_buf();
        assert!(copy.starts_with(t.path().join(ceph_store::UPGRADE_BACKUPS_DIR)));
        assert_eq!(library_upgrade_copy_take(), Some(copy.display().to_string()));
        assert_eq!(library_upgrade_copy_take(), None, "shown once");
        drop(lib);
        let _again = open_library(t.path()).unwrap();                      // now current: no copy, no notice
        assert_eq!(library_upgrade_copy_take(), None);
    }
    /// AB-2 (4): File ▸ Restore with a safety copy from upgrade-backups restores it, reopens the library, and (the
    /// restored database being old) leaves the new copy's folder for the notice.
    #[test] fn restoring_an_upgrade_copy_reopens_the_library() {
        let _turn = NOTE_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let t = tempfile::tempdir().unwrap();
        schema_7_library(t.path());
        drop(open_library(t.path()).unwrap());
        let copy = std::fs::read_dir(t.path().join(ceph_store::UPGRADE_BACKUPS_DIR)).unwrap().next().unwrap().unwrap().path();
        library_upgrade_copy_take();
        let st = Mutex::new(Some(open_library(t.path()).unwrap()));
        restore_into(&st, t.path(), &copy).unwrap();
        assert_eq!(st.lock().unwrap().as_ref().expect("reopened").setting("x").unwrap(), None);
        let again = library_upgrade_copy_take().expect("the restored schema-7 database was copied before its upgrade");
        assert_ne!(again, copy.display().to_string());
        assert!(copy.is_dir());
    }
    #[test] fn the_picked_operator_is_who_verifies() {
        let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let mut lib = Library::open(t.path()).unwrap();
        let p = src.path().join("a.png");
        image::GrayImage::from_fn(200, 150, |x, y| image::Luma([((x + y) % 200) as u8])).save(&p).unwrap();
        let id = lib.import(&p).unwrap().case_id;
        set_current_operator(&mut lib, "Dr B").unwrap();
        assert!(lib.operators(&operator(&lib)).unwrap().contains(&"Dr B".to_string()));
        lib.set_verified(&id, true, &operator(&lib)).unwrap();
        assert_eq!(lib.load(&id).unwrap().verified_by.as_deref(), Some("Dr B"));
        assert!(set_current_operator(&mut lib, "  ").is_err());
    }
    /// Owner, 30 Sep (M8): a failure while recognising the film's machine must not lose the plain label reading.
    #[test] fn a_machine_matching_error_still_fills_from_the_label() {
        let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let png = src.path().join("film.png");
        image::GrayImage::from_fn(400, 300, |x, y| image::Luma([(x + y) as u8])).save(&png).unwrap();
        let mut lib = Library::open(t.path()).unwrap();
        let case = lib.import(&png).unwrap().case_id;
        rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap().execute_batch("DROP TABLE layout_candidates").unwrap();
        let lines = vec![l("DEMO, Synthetic", [0.1, 0.1, 0.3, 0.02])];
        let fields = IdentityRead { name: Some("Demo Synthetic".into()), ..IdentityRead::default() };
        let tokens = ceph_label::layout::film_tokens(&lines);
        assert!(lib.match_machine(&case, &tokens).is_err(), "the test breaks machine matching");
        fill_from_label(&mut lib, &case, &fields, None, &tokens, &lines, ceph_label::DateOrder::Au, ceph_label::Ymd::new(2026, 9, 30).unwrap()).unwrap();
        assert_eq!(lib.load(&case).unwrap().patient_name, "Demo Synthetic");
    }
    /// A library whose one machine prints "Demo Radiology Northside" and "PID 5566" and has learned (3 films each) the
    /// practice line and the Patient ID after "PID" as its defaults; and that film's text. Synthetic only.
    fn machine_with_detail_defaults(root: &Path, src: &Path) -> (Library, Vec<ceph_label::TextLine>) {
        use ceph_label::layout::rule_from_selection;
        let lines = vec![l("Demo Radiology Northside", [0.02, 0.02, 0.3, 0.02]), l("DOB 01/01/2000 SYNTHETIC", [0.02, 0.11, 0.25, 0.02]),   // SYNTHETIC
                         l("PID 5566", [0.02, 0.14, 0.12, 0.02])];
        let tokens = ceph_label::layout::film_tokens(&lines);
        let mut lib = Library::open(root).unwrap();
        for i in 0..3u8 {
            let png = src.join(format!("machine-{i}.png"));
            image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(i * 50)])).save(&png).unwrap();
            let c = lib.import(&png).unwrap().case_id;
            lib.match_machine(&c, &tokens).unwrap();
            let name = ["Demo Alpha", "Demo Beta", "Demo Gamma"][i as usize];
            lib.set_meta(&c, &CaseMeta { patient_name: name.into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None }).unwrap();
            lib.record_confirmed_film(&c, &tokens).unwrap();
            let k = known(&lib.anchor_tokens(&c).unwrap());
            lib.learn(&c, "practice", &rule_from_selection(&lines[0], 0, 2, "practice", &k).unwrap()).unwrap();
            lib.learn(&c, "patient_id", &rule_from_selection(&lines[2], 1, 1, "patient_id", &k).unwrap()).unwrap();
        }
        (lib, lines)
    }
    fn new_film(lib: &mut Library, src: &Path) -> String {
        let png = src.join("new.png");
        image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x * 2 + y) as u8).wrapping_add(7)])).save(&png).unwrap();
        lib.import(&png).unwrap().case_id
    }
    /// D-LEARN-1 (spec 2026-10-17): reading a film's label also fills its blank new details from the machine's defaults.
    /// Addendum D2, Q8 (Task 2 rewrite): each X-ray keeps its own Patient ID, so a film moved onto a patient by the
    /// label learns its OWN Patient ID from its own film's text; it never takes, and never overwrites, another film's.
    #[test] fn reading_the_label_fills_the_new_details_from_the_machines_defaults() {
        let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (mut lib, lines) = machine_with_detail_defaults(t.path(), src.path());
        let case = new_film(&mut lib, src.path());
        let fields = IdentityRead { name: Some("Demo Beta".into()), ..IdentityRead::default() };
        let tokens = ceph_label::layout::film_tokens(&lines);
        let (applied, _) = fill_from_label(&mut lib, &case, &fields, None, &tokens, &lines, ceph_label::DateOrder::Au, ceph_label::Ymd::new(2026, 10, 17).unwrap()).unwrap();
        let d = lib.load(&case).unwrap();
        assert_eq!((d.patient_name.as_str(), d.radiography_practice.as_deref(), d.printed_patient_id.as_deref()),
            ("Demo Beta", Some("Demo Radiology Northside"), Some("5566")));
        assert!(applied.learned_fields.iter().any(|f| f == "practice") && applied.learned_fields.iter().any(|f| f == "patient_id"), "{:?}", applied.learned_fields);
        assert_eq!(d.learned_fields, applied.learned_fields, "the screen and the library agree on what was learned");
        // A person types this film's own ID over its learned one.
        lib.set_patient_id(&case, Some("H-1")).unwrap();
        // A second, new film joins the same patient by the label. Its own blank Patient ID is filled from its OWN
        // film's text (the same synthetic "PID 5566" line, reused for this fixture) — never from the first film's H-1,
        // and it never overwrites the first film's H-1 either.
        let png = src.path().join("second.png");
        image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x * 3 + y) as u8).wrapping_add(9)])).save(&png).unwrap();
        let second = lib.import(&png).unwrap().case_id;
        fill_from_label(&mut lib, &second, &fields, None, &tokens, &lines, ceph_label::DateOrder::Au, ceph_label::Ymd::new(2026, 10, 17).unwrap()).unwrap();
        assert_eq!(lib.load(&second).unwrap().printed_patient_id.as_deref(), Some("5566"),
            "the label moved it to Demo Beta; its own 5566 is learned from its own film");
        assert_eq!(lib.load(&case).unwrap().printed_patient_id.as_deref(), Some("H-1"), "H-1 stays on the first film");
    }
    /// Carried from Task 3's review (Task 9 sweep): reading the SAME film's label a second time (e.g. a retry) must
    /// not disturb a detail it already learned and filled. `apply_label_with` rebuilds `learned_fields` from only the
    /// identity fields (name/DOB/film date/Scan ID) it just merged, so a second call used to overwrite the whole
    /// column and silently drop "patient_id"/"practice" even though `apply_learned_details` (run straight after, in
    /// the same `fill_from_label` call) only re-marks a field it actually just filled — and the second time round the
    /// value is no longer blank, so it fills, and re-marks, nothing. The VALUE is never touched either way; only the
    /// "Learned for this machine" tag is at risk.
    #[test] fn a_second_label_read_keeps_the_learned_mark_as_well_as_the_value() {
        let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (mut lib, lines) = machine_with_detail_defaults(t.path(), src.path());
        let case = new_film(&mut lib, src.path());
        let fields = IdentityRead { name: Some("Demo Beta".into()), ..IdentityRead::default() };
        let tokens = ceph_label::layout::film_tokens(&lines);
        let now = || ceph_label::Ymd::new(2026, 10, 17).unwrap();
        let (applied1, _) = fill_from_label(&mut lib, &case, &fields, None, &tokens, &lines, ceph_label::DateOrder::Au, now()).unwrap();
        let d1 = lib.load(&case).unwrap();
        assert_eq!((d1.radiography_practice.as_deref(), d1.printed_patient_id.as_deref()), (Some("Demo Radiology Northside"), Some("5566")));
        assert!(applied1.learned_fields.iter().any(|f| f == "practice") && applied1.learned_fields.iter().any(|f| f == "patient_id"),
            "first read marks both learned: {:?}", applied1.learned_fields);
        // Read the same film's label again (nothing on the film or in the library changed in between).
        let (_applied2, _) = fill_from_label(&mut lib, &case, &fields, None, &tokens, &lines, ceph_label::DateOrder::Au, now()).unwrap();
        let d2 = lib.load(&case).unwrap();
        assert_eq!((d2.radiography_practice.as_deref(), d2.printed_patient_id.as_deref()), (Some("Demo Radiology Northside"), Some("5566")),
            "a second label read never changes a value that stayed filled");
        assert!(d2.learned_fields.iter().any(|f| f == "practice") && d2.learned_fields.iter().any(|f| f == "patient_id"),
            "a value that stays filled keeps its \"Learned for this machine\" mark (spec: typing, choosing or OK removes it, not re-reading the label): {:?}",
            d2.learned_fields);
    }
    /// Pre-flight D9: an error while filling the learned details is logged and treated as nothing learned; the label's
    /// own reading, already saved, is never lost (as M8 for machine matching).
    #[test] fn an_error_filling_learned_details_still_keeps_the_label_reading() {
        let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let (mut lib, lines) = machine_with_detail_defaults(t.path(), src.path());
        let case = new_film(&mut lib, src.path());
        rusqlite::Connection::open(t.path().join("library.sqlite3")).unwrap().execute_batch(
            "CREATE TRIGGER forced_detail_error BEFORE UPDATE OF radiography_practice ON cases BEGIN SELECT RAISE(ABORT, 'forced for a test'); END;").unwrap();
        let fields = IdentityRead { name: Some("Demo Synthetic".into()), scan_id: Some("4471".into()), ..IdentityRead::default() };
        let tokens = ceph_label::layout::film_tokens(&lines);
        assert!(lib.apply_learned_details(&case, &ceph_store::FilmDetailsRead { practice: Some("X Ray".into()), ..Default::default() }).is_err(),
            "the test breaks filling the learned details");
        let (applied, _) = fill_from_label(&mut lib, &case, &fields, None, &tokens, &lines, ceph_label::DateOrder::Au, ceph_label::Ymd::new(2026, 10, 17).unwrap())
            .expect("a learned-details error never fails reading the label");
        let d = lib.load(&case).unwrap();
        assert_eq!((d.patient_name.as_str(), d.scan_id.as_deref()), ("Demo Synthetic", Some("4471")), "the label's reading is kept");
        assert_eq!((d.radiography_practice, d.printed_patient_id), (None, None), "nothing half-filled");
        assert!(!applied.learned_fields.iter().any(|f| f == "practice" || f == "patient_id"), "{:?}", applied.learned_fields);
    }
    /// Owner, 30 Sep (M4): the words chosen are checked, not just the line number.
    #[test] fn pick_line_uses_the_words_not_just_the_index() {
        let lines = vec![l("Demo Radiology", [0.0, 0.0, 0.3, 0.02]), l("DEMO, Synthetic", [0.0, 0.1, 0.3, 0.02])];
        assert_eq!(pick_line(&lines, 1, 0, 0, "DEMO,").map(|x| x.text.as_str()), Some("DEMO, Synthetic"));
        assert_eq!(pick_line(&lines, 0, 0, 0, "DEMO,").map(|x| x.text.as_str()), Some("DEMO, Synthetic"), "a stale index finds the words' line");
        assert!(pick_line(&lines, 1, 0, 1, "Somebody Else").is_none());
        assert!(pick_line(&lines, 1, 1, 5, "Synthetic").is_none(), "out of range");
    }
    #[test] fn label_fields_become_iso_identity_fields() {
        let f = ceph_label::LabelFields { name: Some("Demo Synthetic".into()), date_of_birth: ceph_label::Ymd::new(1990, 3, 7),
            scan_date: ceph_label::Ymd::new(2026, 9, 12), scan_id: Some("4471".into()), patient_id: None };
        assert_eq!(identity_read(f), ceph_store::IdentityRead { name: Some("Demo Synthetic".into()), date_of_birth: Some("1990-03-07".into()),
            scan_date: Some("2026-09-12".into()), scan_id: Some("4471".into()) });
        assert_eq!(identity_read(ceph_label::LabelFields::default()), ceph_store::IdentityRead::default());
    }
    fn l(text: &str, bbox: [f64; 4]) -> ceph_label::TextLine {
        ceph_label::with_words(ceph_label::TextLine { text: text.into(), confidence: 1.0, bbox, words: vec![] })
    }
    #[test] fn the_label_outcome_carries_lines_with_words() {
        let o = LabelOutcome { outcome: IdentityOutcome { checked: false, issues: vec![] }, lines: vec![line_out(&l("DEMO, Synthetic", [0.1, 0.1, 0.3, 0.02]))],
            learned_fields: vec![], conflicts: vec![], suggestions: vec![] };
        let v = serde_json::to_value(&o).unwrap();
        assert_eq!((v["checked"].clone(), v["lines"][0]["words"][0]["text"].clone()), (serde_json::json!(false), serde_json::json!("DEMO,")));
        assert!(v["lines"][0]["words"][1]["bbox"].is_array() && v["learnedFields"].is_array());
    }
    #[test] fn learned_values_come_from_default_places_and_compose_last_first() {
        use ceph_label::layout::rule_from_selection;
        let lines = vec![l("SMITH, John", [0.02, 0.05, 0.3, 0.02]), l("DOB 01/01/2000 SYNTHETIC", [0.02, 0.11, 0.25, 0.02])];   // SYNTHETIC
        let places = vec![
            ceph_store::Place { field: "last".into(), rule: rule_from_selection(&lines[0], 0, 0, "last", &known(&[])).unwrap(), count: 3, default: true },
            ceph_store::Place { field: "first".into(), rule: rule_from_selection(&lines[0], 1, 1, "first", &known(&[])).unwrap(), count: 3, default: true },
            ceph_store::Place { field: "dob".into(), rule: rule_from_selection(&lines[1], 1, 1, "dob", &known(&[])).unwrap(), count: 2, default: false },
        ];
        let today = ceph_label::Ymd { y: 2026, m: 9, d: 29 };
        let (read, _, sugg) = learned_read(&lines, &places, ceph_label::DateOrder::Au, today);
        assert_eq!((read.name.as_deref(), read.date_of_birth), (Some("Smith, John"), None), "only defaults fill");   // SYNTHETIC
        let dob = sugg.iter().find(|s| s.field == "dob").unwrap();
        assert_eq!((dob.value.as_str(), dob.is_default, dob.line, dob.from), ("2000-01-01", false, 1, 1));   // SYNTHETIC
    }
    /// Final review I3: the value's own words, not the label before it, so choosing and confirming teach one place.
    #[test] fn a_value_is_found_as_its_shortest_run_of_words() {
        let lines = vec![l("DOB 07/03/1990 SYNTHETIC", [0.02, 0.11, 0.25, 0.02]), l("Se: Feb 07, 2024 01:36 PM", [0.7, 0.05, 0.28, 0.02])];   // SYNTHETIC
        assert_eq!(find_value(&lines, "dob", "1990-03-07"), Some((0, 1, 1)));   // SYNTHETIC
        assert_eq!(find_value(&lines, "film_date", "2024-02-07"), Some((1, 1, 3)));
    }
    /// Final review I4: the line the patient's name is printed on teaches nothing to the machine's pattern.
    #[test] fn the_name_line_never_joins_the_pattern() {
        let lines = vec![l("Demo Radiology Northside", [0.02, 0.02, 0.3, 0.02]), l("O'BRIEN, Liam Patrick", [0.02, 0.05, 0.3, 0.02])];   // SYNTHETIC
        let t = confirm_tokens(&lines, "O'Brien, Liam");   // SYNTHETIC
        assert_eq!(t.iter().map(|t| t.token.as_str()).collect::<Vec<_>>(), ["demo", "radiology", "northside"]);
    }
    #[test] fn a_typed_value_is_found_among_the_words() {
        let lines = vec![l("PID 12345", [0.02, 0.14, 0.12, 0.02]), l("SMITH, John", [0.02, 0.05, 0.3, 0.02])];   // SYNTHETIC
        assert_eq!(find_value(&lines, "scan_id", "12345"), Some((0, 1, 1)));
        assert_eq!(find_value(&lines, "full", "Smith, John"), Some((1, 0, 1)));   // SYNTHETIC
        assert_eq!(find_value(&lines, "full", "Nobody Here"), None);
    }
    /// D-LEARN-1: the new details come from default places only, beside (not inside) the identity fields. Owner Q6
    /// (addendum 2026-10-17) extends this to Gender and Referring practitioner: default places on "M, Y26" and
    /// "Ref: Dr Demo" fill `details.gender`/`details.referrer`, the same as the film details.
    #[test] fn learned_values_fill_the_new_details_from_default_places() {
        use ceph_label::layout::rule_from_selection;
        let lines = vec![l("Demo Radiology Northside", [0.02, 0.02, 0.3, 0.02]), l("PID 5566", [0.02, 0.14, 0.12, 0.02]),
                         l("LATERAL CEPH", [0.6, 0.9, 0.2, 0.02]), l("M, Y26", [0.02, 0.08, 0.1, 0.02]),
                         l("Ref: Dr Demo", [0.02, 0.2, 0.2, 0.02])];
        let place = |f: &str, i: usize, from: usize, to: usize, default: bool| ceph_store::Place {
            field: f.into(), rule: rule_from_selection(&lines[i], from, to, f, &known(&[])).unwrap(), count: 3, default };
        let places = vec![place("practice", 0, 0, 2, true), place("patient_id", 1, 1, 1, true), place("xray_type", 2, 0, 1, false),
            place("gender", 3, 0, 0, true), place("referrer", 4, 0, 2, true)];
        let (read, details, sugg) = learned_read(&lines, &places, ceph_label::DateOrder::Au, ceph_label::Ymd { y: 2026, m: 10, d: 17 });
        assert_eq!(read, IdentityRead::default(), "the identity fields are untouched");
        assert_eq!((details.practice.as_deref(), details.printed_patient_id.as_deref(), details.xray_type),
            (Some("Demo Radiology Northside"), Some("5566"), None), "only defaults fill");
        assert_eq!((details.gender.as_deref(), details.referrer.as_deref()), (Some("M"), Some("Dr Demo")));
        assert!(sugg.iter().any(|s| s.field == "xray_type" && s.value == "LATERAL CEPH" && !s.is_default), "{sugg:?}");
    }
    /// Owner Q4 (17 Oct): a "PID" on the film fills this X-ray's own Patient ID directly (never marked learned — it
    /// is the label's own reading, not a learned place), and a disagreeing learned Patient ID is a conflict to show.
    #[test] fn a_label_pid_fills_the_xrays_patient_id_and_a_disagreeing_learned_one_is_a_conflict() {
        use ceph_label::layout::rule_from_selection;
        let (t, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let lines = vec![l("Demo Radiology Northside", [0.02, 0.02, 0.3, 0.02]), l("DOB 01/01/2000 SYNTHETIC", [0.02, 0.11, 0.25, 0.02])];   // SYNTHETIC
        let tokens = ceph_label::layout::film_tokens(&lines);
        let mut lib = Library::open(t.path()).unwrap();
        let fields = IdentityRead { name: Some("Demo Synthetic".into()), ..IdentityRead::default() };

        // No learned place for patient_id at all: the label's own PID fills the X-ray's Patient ID, not learned.
        let case = new_film(&mut lib, src.path());
        let (applied, _) = fill_from_label(&mut lib, &case, &fields, Some("5566".into()), &tokens, &lines, ceph_label::DateOrder::Au, ceph_label::Ymd::new(2026, 10, 17).unwrap()).unwrap();
        let d = lib.load(&case).unwrap();
        assert_eq!(d.printed_patient_id.as_deref(), Some("5566"));
        assert!(!applied.learned_fields.iter().any(|f| f == "patient_id"), "the label's own PID is never marked learned: {:?}", applied.learned_fields);
        assert!(applied.conflicts.is_empty());

        // A machine whose default patient_id place reads a DIFFERENT value: a disagreement fills nothing and is a conflict.
        let pid_lines = vec![l("Demo Radiology Northside", [0.02, 0.02, 0.3, 0.02]), l("PID 7788", [0.02, 0.14, 0.12, 0.02])];
        let pid_tokens = ceph_label::layout::film_tokens(&pid_lines);
        for i in 0..3u8 {
            let png = src.path().join(format!("conflict-machine-{i}.png"));
            image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(i * 60)])).save(&png).unwrap();
            let c = lib.import(&png).unwrap().case_id;
            lib.match_machine(&c, &pid_tokens).unwrap();
            lib.set_meta(&c, &CaseMeta { patient_name: ["Demo A", "Demo B", "Demo C"][i as usize].into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None }).unwrap();
            lib.record_confirmed_film(&c, &pid_tokens).unwrap();
            let k = known(&lib.anchor_tokens(&c).unwrap());
            lib.learn(&c, "patient_id", &rule_from_selection(&pid_lines[1], 1, 1, "patient_id", &k).unwrap()).unwrap();
        }
        // A fresh film with different pixel content from `case` above (the library dedups imports by content hash,
        // so reusing `new_film`'s fixed pixels here would silently return the SAME case as `case`).
        let png2 = src.path().join("conflict.png");
        image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x * 5 + y) as u8).wrapping_add(13)])).save(&png2).unwrap();
        let conflict_case = lib.import(&png2).unwrap().case_id;
        let (applied, _) = fill_from_label(&mut lib, &conflict_case, &fields, Some("5566".into()), &pid_tokens, &pid_lines, ceph_label::DateOrder::Au, ceph_label::Ymd::new(2026, 10, 17).unwrap()).unwrap();
        assert_eq!(lib.load(&conflict_case).unwrap().printed_patient_id, None, "a disagreement fills nothing");
        assert!(applied.conflicts.iter().any(|c| c.field == "patient_id"), "{:?}", applied.conflicts);
    }
    /// S7: Patient ID is found as a whole word with a digit; practice/xray_type ignore case and spacing.
    #[test] fn a_typed_film_detail_is_found_among_the_words_ignoring_case_and_spacing() {
        let lines = vec![l("Demo Radiology Northside", [0.02, 0.02, 0.3, 0.02]), l("PID 5566", [0.02, 0.14, 0.12, 0.02])];
        assert_eq!(find_value(&lines, "practice", "demo  radiology northside"), Some((0, 0, 2)));
        assert_eq!(find_value(&lines, "patient_id", "5566"), Some((1, 1, 1)));
        assert_eq!(find_value(&lines, "xray_type", "Lateral Ceph"), None, "not on the film: nothing to learn");
    }
    #[test] fn operator_is_the_setting_then_the_login_name() {
        let t = std::env::temp_dir().join(format!("cephtrace-op-{}", std::process::id()));
        let mut lib = Library::open(&t).unwrap();
        let login = std::env::var("USER").unwrap_or_else(|_| "unknown".into());
        assert_eq!(operator(&lib), login);
        lib.set_setting("operator", "  ").unwrap();
        assert_eq!(operator(&lib), login);                                    // blank counts as unset
        lib.set_setting("operator", "Dr A").unwrap();
        assert_eq!(operator(&lib), "Dr A");
        drop(lib); std::fs::remove_dir_all(&t).ok();
    }
}
