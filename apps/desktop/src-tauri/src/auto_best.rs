//! "Automatic best": a model with no file of its
//! own, made from Part F's verdicts (rule best-point/4: judged against the base model, setting `auto_best_base`, Aariz
//! unless the owner chose another; spec 2026-10-29-auto-best-base-model-design.md). For each of the 19 points it uses the
//! model the rule offers, judged with Part F's answers left out (owner Q1) and with its own Undos in their place (owner
//! D3, spec §6a); every other point uses the base.
//! Nothing here places, moves or approves a point: it says which model's mark to use, records each change of that
//! choice (format 15's `auto_best_events`), and takes an Undo or a "Use … again".

use ceph_model::best::{self, Action, Decision, FilmKey, PairVerdict, PointVerdict};
use ceph_model::scores::ORIGINAL_19;
use ceph_store::{AutoBestEvent, Library, NewAutoBestEvent, AUTO_BEST};
use serde::Serialize;
use std::collections::BTreeMap;

/// Whether Automatic best's choices apply (spec §2; owner D1): the base is installed, and the main setting is blank (the
/// default) or names Automatic best.
pub fn auto_best_on(setting: Option<&str>, base_ready: bool) -> bool {
    base_ready && setting.map_or(true, |s| s.trim().is_empty() || s == AUTO_BEST)
}

/// The base model's setting (spec §6): blank or missing means Aariz, so every library from before reads as Aariz.
pub const BASE_KEY: &str = "auto_best_base";
/// The base a setting names: blank, missing, or Automatic best itself (never its own base) → `DEFAULT_BASE`.
pub fn base_from(setting: Option<&str>) -> String {
    match setting.map(str::trim) { Some(s) if !s.is_empty() && s != AUTO_BEST => s.to_string(), _ => best::DEFAULT_BASE.to_string() }
}
/// The base model now: the starting model and the yardstick of every verdict (spec §1, §3).
pub fn base_of(l: &Library) -> anyhow::Result<String> { Ok(base_from(l.setting(BASE_KEY)?.as_deref())) }
/// Whether the base is installed in the models folder (what the app asks: its manifest is there, as `is_ready`).
fn base_ready_at(l: &Library, root: &std::path::Path) -> anyhow::Result<bool> { Ok(crate::models::is_ready(root, &base_of(l)?)) }
/// A verdict's numbers with the base it was judged against (spec §6): `base`, and `baseFingerprint`, the base's file now
/// (null when the base is not installed). Numbers that are not an object are wrapped, never dropped.
pub fn with_base(numbers: serde_json::Value, base: &str, current: &BTreeMap<String, String>) -> serde_json::Value {
    let mut m = match numbers { serde_json::Value::Object(m) => m, other => { let mut m = serde_json::Map::new(); m.insert("value".into(), other); m } };
    m.insert("base".into(), base.into());
    m.insert("baseFingerprint".into(), current.get(base).map_or(serde_json::Value::Null, |f| f.clone().into()));
    serde_json::Value::Object(m)
}

/// The film a row names (its re-check's last film, or an Undo's anchor), if any.
fn film_of(e: &AutoBestEvent) -> Option<FilmKey> {
    e.last_imported_at.clone().zip(e.last_case_id.clone()).map(|(imported_at, case_id)| FilmKey { imported_at, case_id })
}

/// Automatic best's own Undos as the rule's declines (spec §6a): an `undone` declines that model at that point after its
/// anchor film; a later `redone` of the same point, model and film takes it back. Other rows change nothing.
pub fn decisions_of(events: &[AutoBestEvent]) -> Vec<Decision> {
    let mut out: Vec<Decision> = Vec::new();
    for e in events { decide(&mut out, &e.landmark_id, &e.model_id, &e.kind, film_of(e)); }
    out
}
/// One row's effect on the declines (`decisions_of`'s rule), for a stored row or one planned but not yet written.
fn decide(out: &mut Vec<Decision>, landmark_id: &str, model_id: &str, kind: &str, film: Option<FilmKey>) {
    match kind {
        "undone" => out.push(Decision { landmark_id: landmark_id.into(), model_id: model_id.into(), action: Action::Declined, last_film: film }),
        "redone" => {
            if let Some(i) = out.iter().rposition(|d| d.landmark_id == landmark_id && d.model_id == model_id && d.last_film == film) { out.remove(i); }
        }
        _ => {}
    }
}
/// `decisions_of` the stored rows, then the planned rows after them, in order (first-open step, M3: a later point sees
/// an earlier point's planned Undo).
fn decisions_with(events: &[AutoBestEvent], planned: &[NewAutoBestEvent]) -> Vec<Decision> {
    let mut out = decisions_of(events);
    for r in planned {
        let film = r.last_film.clone().map(|(imported_at, case_id)| FilmKey { imported_at, case_id });
        decide(&mut out, &r.landmark_id, &r.model_id, &r.kind, film);
    }
    out
}

/// What Automatic best uses at one point that has evidence: the rule's one offer (spec §3 item 1), the re-check's last
/// film, and the films that decided in Part F's words.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Uses { pub model_id: String, pub last: FilmKey, pub basis: String, pub films: usize, pub numbers: serde_json::Value }

/// Point → what Automatic best uses there, for each point whose verdict is an offer. A point with no offer is absent
/// (no evidence: Aariz as main, the main model as a ghost, owner Q2/Q4).
pub fn uses_of(verdicts: &[PointVerdict]) -> BTreeMap<String, Uses> {
    verdicts.iter().filter_map(|p| {
        let m = p.offer.as_ref()?;
        let pair = p.pairs.iter().find(|x| &x.model_id == m)?;
        let PairVerdict::Offer { check, .. } = &pair.verdict else { return None };
        Some((p.landmark_id.clone(), Uses { model_id: m.clone(), last: check.last.clone(), basis: best::basis_words(pair.basis?, pair.films),
            films: pair.films, numbers: serde_json::to_value(pair).ok()? }))
    }).collect()
}

/// The verdict per point now, with Automatic best's own Undos (never Part F's answers, owner Q1). `sync` and `map` read
/// it here; `undo` and `redo` ask the same rule with one Undo added or taken away (`uses_now`).
pub fn verdicts(l: &Library, current: &BTreeMap<String, String>) -> anyhow::Result<Vec<PointVerdict>> {
    crate::best::verdicts_for(l, current, &decisions_of(&l.auto_best_events()?), &base_of(l)?)
}

fn uses_now(l: &Library, current: &BTreeMap<String, String>, decisions: &[Decision]) -> anyhow::Result<BTreeMap<String, Uses>> {
    Ok(uses_of(&crate::best::verdicts_for(l, current, decisions, &base_of(l)?)?))
}

/// Spec §6a: compares the verdict now with the last one recorded, per point, and records each change. Returns the new
/// rows, oldest first (the notes to show). The user's own Undo and "Use … again" rows already carry what is used after
/// them, so they never cause a row here.
pub fn sync(l: &mut Library, current: &BTreeMap<String, String>, operator: &str) -> anyhow::Result<Vec<AutoBestEvent>> {
    sync_with(l, current, operator, None)
}

/// `sync`, with `cause` = (from, to) when a change of base caused it (spec 2026-10-29 §6): every row then carries
/// `numbers.cause = "base-changed"`, `baseFrom` and `baseTo`, every `returned` row reads `evidence` (against the new
/// yardstick the evidence no longer favours that model, also when it is now the base itself), and the rows are written
/// together in one transaction.
pub fn sync_with(l: &mut Library, current: &BTreeMap<String, String>, operator: &str, cause: Option<(&str, &str)>) -> anyhow::Result<Vec<AutoBestEvent>> {
    let base = base_of(l)?;
    let rows = changes(l, current, &base, cause)?;
    match cause {
        None => rows.iter().map(|r| l.add_auto_best_event(r, operator)).collect(),
        Some(_) if rows.is_empty() => Ok(vec![]),
        Some(_) => l.add_auto_best_events(&rows, operator),
    }
}

/// The rows a sync would write, judged against `base` (the base now, or the new base of a change not yet written).
fn changes(l: &Library, current: &BTreeMap<String, String>, base: &str, cause: Option<(&str, &str)>) -> anyhow::Result<Vec<NewAutoBestEvent>> {
    let events = l.auto_best_events()?;
    let uses = uses_of(&crate::best::verdicts_for(l, current, &decisions_of(&events), base)?);
    let mut batch = Vec::new();
    for p in ORIGINAL_19 {
        let last = events.iter().rev().find(|e| e.landmark_id == p);
        let was = last.and_then(|e| e.uses.clone());
        // The file recorded with the model in use: only an `adopted`/`redone` row names it (an `undone` row's
        // fingerprint is the undone model's, not the one used after it).
        let was_fp = last.filter(|e| e.uses.as_deref() == Some(e.model_id.as_str())).and_then(|e| e.fingerprint.clone());
        let now = uses.get(p);
        let now_fp = now.and_then(|u| current.get(&u.model_id).cloned());
        let changed = match (now, was.as_deref()) {
            (Some(u), Some(w)) => u.model_id != w || (was_fp.is_some() && now_fp != was_fp),
            (None, None) => false,
            _ => true,
        };
        if !changed { continue; }
        let new = match now {
            Some(u) => NewAutoBestEvent { landmark_id: p.into(), kind: "adopted".into(), model_id: u.model_id.clone(), fingerprint: now_fp,
                uses: Some(u.model_id.clone()), last_film: Some((u.last.imported_at.clone(), u.last.case_id.clone())), basis: Some(u.basis.clone()),
                reason: None, numbers: with_base(u.numbers.clone(), base, current), rule_version: best::RULE_VERSION.into() },
            None => {
                let w = was.clone().expect("a change from a model");
                let reason = if cause.is_some() { "evidence" } else if !current.contains_key(&w) { "not-installed" }
                    else if was_fp.is_some() && current.get(&w) != was_fp.as_ref() { "file-changed" } else { "evidence" };
                NewAutoBestEvent { landmark_id: p.into(), kind: "returned".into(), model_id: w, fingerprint: was_fp, uses: None, last_film: None,
                    basis: None, reason: Some(reason.into()), numbers: with_base(serde_json::json!({}), base, current), rule_version: best::RULE_VERSION.into() }
            }
        };
        let mut new = new;
        if let (Some((from, to)), serde_json::Value::Object(m)) = (cause, &mut new.numbers) {
            m.insert("cause".into(), "base-changed".into()); m.insert("baseFrom".into(), from.into()); m.insert("baseTo".into(), to.into());
        }
        batch.push(new);
    }
    Ok(batch)
}

/// The setting that lists every change of base, oldest first: a JSON list of {from, to, who, when} (spec §6; owner
/// answer 3, A: no format change). Not protected by never-change triggers, as `auto_best_events` is (accepted).
pub const BASE_LOG_KEY: &str = "auto_best_base_log";
/// A change of base: from, to, and the per-point rows it wrote (each `returned` or `adopted`, cause `base-changed`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BaseChanged { pub from: String, pub to: String, pub events: Vec<AutoBestEvent> }

/// Milliseconds since 1970 as the library writes times (`2026-10-29T01:02:03.456Z`, UTC).
pub(crate) fn utc_iso(ms: u128) -> String {
    let (secs, milli) = ((ms / 1000) as i64, (ms % 1000) as u32);
    let (days, rem) = (secs.div_euclid(86_400), secs.rem_euclid(86_400));
    // Civil date from days since 1970-01-01 (proleptic Gregorian).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{milli:03}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}
fn now_iso() -> String { utc_iso(std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis()).unwrap_or(0)) }

/// Changes the base (spec §4): refused unless `to` is a catalogue model that is installed (never Automatic best itself).
/// The base already in force writes nothing. Otherwise the log gains one entry, the setting names `to`, and every point
/// the change affects gets its own row (`sync_with` with the cause). If any step fails, the setting and the log are put
/// back as they were, so they never disagree with the rows. The way back is the same call with the earlier base.
pub fn set_base(l: &mut Library, current: &BTreeMap<String, String>, to: &str, operator: &str) -> anyhow::Result<BaseChanged> {
    let known = ceph_model::catalog::builtin().into_iter().any(|m| m.entry.id == to);
    anyhow::ensure!(known && to != AUTO_BEST, "{to:?} is not a model that can be the base");
    anyhow::ensure!(current.contains_key(to), "{} is not installed: install it in Models… first", crate::models::short_title(to));
    let from = base_of(l)?;
    if from == to { return Ok(BaseChanged { from, to: to.into(), events: vec![] }); }
    let old_log = l.setting(BASE_LOG_KEY)?;
    let mut entry = serde_json::json!({ "from": from, "to": to, "who": operator, "when": now_iso() });
    let mut log: Vec<serde_json::Value> = match old_log.as_deref().map(serde_json::from_str::<Vec<serde_json::Value>>) {
        None => vec![],
        Some(Ok(v)) => v,
        Some(Err(_)) => { entry["lostLog"] = old_log.clone().unwrap_or_default().into(); vec![] }   // kept, never silently dropped
    };
    log.push(entry);
    // The rows are judged against the NEW base before anything is written; then the setting, its log and the rows are
    // written in one transaction (final review M4), so they can never disagree, even after a crash part-way.
    let rows = changes(l, current, to, Some((&from, to)))?;
    let log_text = serde_json::to_string(&log)?;
    let events = l.add_auto_best_events_with_settings(&[(BASE_LOG_KEY, log_text.as_str()), (BASE_KEY, to)], &rows, operator)?;
    Ok(BaseChanged { from, to: to.into(), events })
}

/// The newest film in the learning record at this point (Recently deleted left out): an Undo's anchor (spec §6a, R1).
fn newest_film(l: &Library, landmark_id: &str) -> anyhow::Result<Option<FilmKey>> {
    Ok(l.learning_rows_all()?.into_iter().filter(|f| f.row.landmark_id == landmark_id)
        .map(|f| FilmKey { imported_at: f.imported_at, case_id: f.case_id }).max())
}

/// Records an Undo of `u` at this point, anchored on `anchor`, with what Automatic best uses after it. Refused if newer
/// films already show the same model closer after the anchor (that is a new verdict, not this one).
///
/// If the rule then offers a SECOND model at this point (spec §6a item 2, "or, if another model also has an offer, that
/// one"), that model's use is recorded at once as its own `adopted` row (ruling on Task 4's concern 2): it gets its own
/// note and its own Undo, and its file is tracked, so a later change of that file reads `file-changed`. Never a model
/// used with no record. Returns the rows written: the `undone` row, then the second model's `adopted` row if any (the
/// screen shows it as a note, final review I3).
pub(crate) fn write_undo(l: &mut Library, current: &BTreeMap<String, String>, events: &[AutoBestEvent], landmark_id: &str, u: &Uses, anchor: FilmKey,
    operator: &str) -> anyhow::Result<Vec<AutoBestEvent>> {
    let rows = undo_rows(l, current, &decisions_of(events), landmark_id, u, anchor)?;
    // One transaction: the Undo and the adoption it hands the point to are written together or not at all.
    Ok(l.add_auto_best_events(&rows, operator)?)
}

/// The planning half of `write_undo`: the rows an Undo of `u` at this point would write, given the declines in force
/// (`decisions`, which may include rows planned but not yet written). Writes nothing.
fn undo_rows(l: &Library, current: &BTreeMap<String, String>, decisions: &[Decision], landmark_id: &str, u: &Uses, anchor: FilmKey)
    -> anyhow::Result<Vec<NewAutoBestEvent>> {
    let mut d = decisions.to_vec();
    d.push(Decision { landmark_id: landmark_id.into(), model_id: u.model_id.clone(), action: Action::Declined, last_film: Some(anchor.clone()) });
    let after = uses_now(l, current, &d)?.remove(landmark_id);
    let base = base_of(l)?;
    anyhow::ensure!(after.as_ref().map(|x| x.model_id.as_str()) != Some(u.model_id.as_str()), "newer films already show {} closer at {landmark_id}", u.model_id);
    let mut rows = vec![NewAutoBestEvent { landmark_id: landmark_id.into(), kind: "undone".into(), model_id: u.model_id.clone(),
        fingerprint: current.get(&u.model_id).cloned(), uses: after.as_ref().map(|x| x.model_id.clone()), last_film: Some((anchor.imported_at, anchor.case_id)),
        basis: Some(u.basis.clone()), reason: None, numbers: with_base(u.numbers.clone(), &base, current), rule_version: best::RULE_VERSION.into() }];
    if let Some(o) = after {
        rows.push(NewAutoBestEvent { landmark_id: landmark_id.into(), kind: "adopted".into(), model_id: o.model_id.clone(),
            fingerprint: current.get(&o.model_id).cloned(), uses: Some(o.model_id.clone()), last_film: Some((o.last.imported_at.clone(), o.last.case_id.clone())),
            basis: Some(o.basis.clone()), reason: None, numbers: with_base(o.numbers.clone(), &base, current), rule_version: best::RULE_VERSION.into() });
    }
    Ok(rows)
}

/// Undo on a note (spec §6a): allowed while the point's latest row is the adoption (or a "Use … again") and today's
/// verdict still names that model. Anchored on the newest film at that point now (ruling R1). `event_id` is the row the
/// note or Recent changes line shows (final review I3): if that is no longer the point's latest change, the Undo is
/// refused, so a stale note can never undo a model it does not name. Returns every row written (`write_undo`).
pub fn undo(l: &mut Library, current: &BTreeMap<String, String>, landmark_id: &str, event_id: i64, operator: &str) -> anyhow::Result<Vec<AutoBestEvent>> {
    let events = l.auto_best_events()?;
    let last = events.iter().rev().find(|e| e.landmark_id == landmark_id).cloned()
        .ok_or_else(|| anyhow::anyhow!("Automatic best has made no change at {landmark_id}"))?;
    anyhow::ensure!(last.id == event_id, "That note is out of date: Automatic best has changed {landmark_id} since. See Settings › Best model › Recent changes.");
    anyhow::ensure!(matches!(last.kind.as_str(), "adopted" | "redone"), "the latest change at {landmark_id} cannot be undone");
    let u = uses_now(l, current, &decisions_of(&events))?.remove(landmark_id).filter(|u| u.model_id == last.model_id)
        .ok_or_else(|| anyhow::anyhow!("the evidence has changed since; see Recent changes"))?;
    let anchor = newest_film(l, landmark_id)?.into_iter().chain([u.last.clone()]).max().expect("the offer's own film");
    write_undo(l, current, &events, landmark_id, &u, anchor, operator)
}

/// The Undo in force at a point: the newest `undone` row there that no "Use … again" has taken back and whose model
/// is not the one used there now (newer films may have brought it back, which is a new verdict). `uses` is the
/// verdict now, with every Undo in its place. This is the Undo "Use … again" takes back, and the one Models… shows.
fn undo_in_force<'a>(events: &'a [AutoBestEvent], uses: &BTreeMap<String, Uses>, landmark_id: &str) -> Option<&'a AutoBestEvent> {
    let d = decisions_of(events);
    let used = uses.get(landmark_id).map(|u| u.model_id.as_str());
    events.iter().rev().filter(|e| e.landmark_id == landmark_id && e.kind == "undone").find(|e| {
        let film = film_of(e);
        Some(e.model_id.as_str()) != used && d.iter().any(|x| x.landmark_id == e.landmark_id && x.model_id == e.model_id && x.last_film == film)
    })
}

/// "Use … again" (spec §6a item 4; fix round 1): takes back the Undo in force at the point (`undo_in_force`), even when
/// a second model was adopted after it, if without it the verdict names that model again. The `redone` row records the
/// model used after it, so it supersedes whatever was used in between (the second model's adoption ends with it).
///
/// `event_id` is the `undone` row the button names (follow-up round, re-review): if that is no longer the Undo in force
/// at the point, the press is refused and nothing is written, so a stale button never brings back a model it does not name.
pub fn redo(l: &mut Library, current: &BTreeMap<String, String>, landmark_id: &str, event_id: i64, operator: &str) -> anyhow::Result<AutoBestEvent> {
    let events = l.auto_best_events()?;
    let now = uses_now(l, current, &decisions_of(&events))?;
    let last = undo_in_force(&events, &now, landmark_id).cloned().ok_or_else(|| anyhow::anyhow!("there is no Undo in force at {landmark_id}"))?;
    anyhow::ensure!(last.id == event_id, "That button is out of date: the Undo it names is no longer the one in force at {landmark_id}. See Settings › Best model › Recent changes.");
    let film = film_of(&last);
    let mut d = decisions_of(&events);
    if let Some(i) = d.iter().rposition(|x| x.landmark_id == landmark_id && x.model_id == last.model_id && x.last_film == film) { d.remove(i); }
    let u = uses_now(l, current, &d)?.remove(landmark_id).filter(|u| u.model_id == last.model_id)
        .ok_or_else(|| anyhow::anyhow!("the evidence has changed since; see Recent changes"))?;
    let f = film.ok_or_else(|| anyhow::anyhow!("an Undo names its film (format 15)"))?;
    l.add_auto_best_event(&NewAutoBestEvent { landmark_id: landmark_id.into(), kind: "redone".into(), model_id: u.model_id.clone(),
        fingerprint: current.get(&u.model_id).cloned(), uses: Some(u.model_id.clone()), last_film: Some((f.imported_at, f.case_id)),
        basis: Some(u.basis.clone()), reason: None, numbers: with_base(u.numbers.clone(), &base_of(l)?, current), rule_version: best::RULE_VERSION.into() }, operator)
}

/// A point's note: since when (the `adopted`/`redone` row in force) and the films that decided, in Part F's words.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBestNote { pub since: Option<String>, pub basis: String }
/// The Undo in force at a point (`undo_in_force`): the model undone and when; "Use … again" beside it takes it back.
/// The point may meanwhile use a second model the Undo handed it to.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KeptNote { pub model_id: String, pub since: String }
/// What the screen needs (placement, label, ghost, Models…): whether it is available and on, the base (spec §4: the
/// model that runs first and places every point without evidence), the model per point with evidence and its note, the
/// points kept by an Undo, and each point's latest change.
#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBestMap { pub available: bool, pub on: bool, pub base: String, pub uses: BTreeMap<String, String>, pub notes: BTreeMap<String, AutoBestNote>,
    pub kept: BTreeMap<String, KeptNote>, pub latest: Vec<AutoBestEvent> }

/// The map for the screen. `available`: the base is installed. Without it the map is empty but still names the base, so
/// the screen can say which model is missing: every verdict is a comparison with the base.
pub fn map(l: &Library, current: &BTreeMap<String, String>, available: bool, on: bool) -> anyhow::Result<AutoBestMap> {
    let base = base_of(l)?;
    if !available { return Ok(AutoBestMap { base, ..AutoBestMap::default() }); }
    let events = l.auto_best_events()?;
    let uses = uses_of(&verdicts(l, current)?);
    let latest: Vec<AutoBestEvent> = ORIGINAL_19.iter().filter_map(|p| events.iter().rev().find(|e| e.landmark_id == *p).cloned()).collect();
    let notes = uses.iter().map(|(p, u)| (p.clone(), AutoBestNote { basis: u.basis.clone(),
        since: events.iter().rev().find(|e| &e.landmark_id == p && e.model_id == u.model_id && matches!(e.kind.as_str(), "adopted" | "redone")).map(|e| e.at.clone()) }))
        .collect();
    let kept = ORIGINAL_19.iter().filter_map(|p| undo_in_force(&events, &uses, p))
        .map(|e| (e.landmark_id.clone(), KeptNote { model_id: e.model_id.clone(), since: e.at.clone() })).collect();
    Ok(AutoBestMap { available, on, base, uses: uses.into_iter().map(|(p, u)| (p, u.model_id)).collect(), notes, kept, latest })
}

/// Spec §6b: the setting that records the first open after this feature, and what the main model was then.
pub const INTRO_KEY: &str = "auto_best_intro";
/// The upgrade's one line (spec §6b): the main model before (None: it was blank, so Aariz) and how many Part F declines
/// were kept (Q5 A).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IntroNote { pub before: Option<String>, pub kept_declines: usize }

/// Once per library (spec §6b; owner D1, D2). A new library (no films, live or deleted): every model's ghost starts off
/// unless a ghost choice was already made, and no note (blank already means Automatic best). A library with films and
/// the base installed: the main model becomes Automatic best, Part F declines still standing are kept (Q5, A), and the
/// note names what the main model was. Without the base it waits for a later open.
pub fn intro(l: &mut Library, current: &BTreeMap<String, String>, base_ready: bool, ghost_ids: &[String], operator: &str) -> anyhow::Result<Option<IntroNote>> {
    if l.setting(INTRO_KEY)?.is_some() { return Ok(None); }
    if l.list(false)?.is_empty() && l.list(true)?.is_empty() {
        if l.setting("ghosts_hidden")?.is_none() && l.setting("ghosts_shown")?.is_none() {
            l.set_setting("ghosts_hidden", &serde_json::to_string(ghost_ids)?)?;
        }
        l.set_setting(INTRO_KEY, &serde_json::json!({ "before": null, "new": true }).to_string())?;
        return Ok(None);
    }
    if !base_ready { return Ok(None); }
    let before = l.setting(crate::models::MAIN_KEY)?.filter(|s| !s.trim().is_empty());
    if before.as_deref() == Some(AUTO_BEST) {
        l.set_setting(INTRO_KEY, &serde_json::json!({ "before": AUTO_BEST, "new": false }).to_string())?;
        return Ok(None);
    }
    // M3 (leftovers Task 3): everything is planned first, then the main setting, the record of this step and every
    // carried Undo are written in ONE transaction, so a failure part-way leaves none of them (and the step runs again).
    let (rows, kept) = plan_declines(l, current)?;
    let record = serde_json::json!({ "before": before, "new": false }).to_string();
    l.add_auto_best_events_with_settings(&[(crate::models::MAIN_KEY, AUTO_BEST), (INTRO_KEY, record.as_str())], &rows, operator)?;
    Ok(Some(IntroNote { before, kept_declines: kept }))
}

/// Q5 (recommended A): each Part F decline that is the point's latest answer, and whose offer is still the one the rule
/// gives (same model, same re-check film), becomes an Automatic best Undo anchored on that film. Returns how many; a
/// decline already carried is skipped.
pub fn carry_declines(l: &mut Library, current: &BTreeMap<String, String>, operator: &str) -> anyhow::Result<usize> {
    let (rows, n) = plan_declines(l, current)?;
    if !rows.is_empty() { l.add_auto_best_events(&rows, operator)?; }
    Ok(n)
}

/// `carry_declines`' plan: the rows it would write and how many declines they carry. Writes nothing. Each decline is
/// judged with the Undos already planned before it in place; one that cannot be carried is skipped and logged.
fn plan_declines(l: &Library, current: &BTreeMap<String, String>) -> anyhow::Result<(Vec<NewAutoBestEvent>, usize)> {
    let choices = l.point_choices()?;
    let events = l.auto_best_events()?;
    let mut planned: Vec<NewAutoBestEvent> = Vec::new();
    let mut n = 0;
    for p in ORIGINAL_19 {
        let Some(c) = choices.iter().rev().find(|c| c.landmark_id == p) else { continue };
        if c.action != "declined" { continue; }
        let (Some(ia), Some(ci)) = (c.last_imported_at.clone(), c.last_case_id.clone()) else { continue };
        let carried = events.iter().any(|e| e.landmark_id == p && e.kind == "undone" && e.model_id == c.model_id && e.last_case_id.as_deref() == Some(ci.as_str()))
            || planned.iter().any(|e| e.landmark_id == p && e.kind == "undone" && e.model_id == c.model_id && e.last_film.as_ref().map(|f| f.1.as_str()) == Some(ci.as_str()));
        if carried { continue; }
        let d = decisions_with(&events, &planned);
        let Some(u) = uses_now(l, current, &d)?.remove(p) else { continue };
        if u.model_id != c.model_id || u.last.case_id != ci || u.last.imported_at != ia { continue; }
        let anchor = u.last.clone();
        match undo_rows(l, current, &d, p, &u, anchor) {
            Ok(rows) => { planned.extend(rows); n += 1; }
            Err(e) => eprintln!("Automatic best: your Part F decline at {p} was not carried over: {e:#}"),
        }
    }
    Ok((planned, n))
}

/// The upgrade note's way back (spec §6b): the main model it had before (Aariz if it was blank).
pub fn way_back(l: &mut Library) -> anyhow::Result<String> {
    let raw = l.setting(INTRO_KEY)?.ok_or_else(|| anyhow::anyhow!("there is no upgrade to go back from"))?;
    let v: serde_json::Value = serde_json::from_str(&raw)?;
    let to = v["before"].as_str().filter(|s| !s.trim().is_empty() && *s != AUTO_BEST).unwrap_or(best::DEFAULT_BASE).to_string();
    l.set_setting(crate::models::MAIN_KEY, &to)?;
    Ok(to)
}

/// Whether Automatic best's choices apply, once the first-open step is counted (leftovers Task 3, M2): `auto_best_on`,
/// and also the step has run (`intro_set`) or the library has no films, live or deleted. Until then a library with films
/// keeps the behaviour it had before the feature (Part F's switches apply; the base runs first when Ready).
pub fn on_with(setting: Option<&str>, intro_set: bool, has_films: bool, base_ready: bool) -> bool {
    (intro_set || !has_films) && auto_best_on(setting, base_ready)
}
/// Whether the library has any film, live or in Recently deleted.
fn has_films(l: &Library) -> anyhow::Result<bool> { Ok(!l.list(false)?.is_empty() || !l.list(true)?.is_empty()) }
/// `on_with` read inside a library call (`crate::library::setting` would wait on the same lock). The films are only
/// listed while the first-open step has not run (once per library).
pub fn on_in(l: &Library, base_ready: bool) -> anyhow::Result<bool> {
    let intro_set = l.setting(INTRO_KEY)?.is_some();
    let films = !intro_set && has_films(l)?;
    Ok(on_with(l.setting(crate::models::MAIN_KEY)?.as_deref(), intro_set, films, base_ready))
}
/// `on_in` with the base's readiness read from the models folder (Models…' list asks this).
pub(crate) fn on_at(l: &Library, root: &std::path::Path) -> anyhow::Result<bool> { let ready = base_ready_at(l, root)?; on_in(l, ready) }

/// What a sync returns to the screen: whether Automatic best is on (notes show only then) and the new rows.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Synced { pub on: bool, pub events: Vec<AutoBestEvent> }

/// The models folder and each installed model's file now. Whether the base is installed is read inside each library
/// call (`base_ready_at`), with the base setting it reads there.
fn installed(app: &tauri::AppHandle) -> Result<(std::path::PathBuf, BTreeMap<String, String>), String> {
    let root = crate::models::root(app)?;
    let cur = crate::models::installed_fingerprints(&root);
    Ok((root, cur))
}
/// The map as the screen reads it (also `models_main_point_source`).
pub(crate) fn map_now(l: &Library, root: &std::path::Path, cur: &BTreeMap<String, String>) -> anyhow::Result<AutoBestMap> {
    let ready = base_ready_at(l, root)?;
    let on = on_in(l, ready)?;
    map(l, cur, ready, on)
}
#[tauri::command] pub async fn models_auto_best(app: tauri::AppHandle) -> Result<AutoBestMap, String> {
    let (root, cur) = installed(&app)?;
    crate::library::with(&app, move |l, _| map_now(l, &root, &cur)).await
}
#[tauri::command] pub async fn models_auto_best_sync(app: tauri::AppHandle) -> Result<Synced, String> {
    let (root, cur) = installed(&app)?;
    crate::library::with(&app, move |l, op| {
        let ready = base_ready_at(l, &root)?;
        if !ready { return Ok(Synced { on: false, events: vec![] }); }
        let on = on_in(l, ready)?;
        Ok(Synced { on, events: sync(l, &cur, op)? })
    }).await
}
/// Undo names the change it undoes (`event_id`, final review I3) and returns the rows written, so the screen can show
/// a second model's adoption as a note.
#[tauri::command] pub async fn models_auto_best_undo(app: tauri::AppHandle, landmark_id: String, event_id: i64) -> Result<Vec<AutoBestEvent>, String> {
    let (_, cur) = installed(&app)?;
    crate::library::with(&app, move |l, op| undo(l, &cur, &landmark_id, event_id, op)).await
}
/// "Use … again" names the Undo it takes back (`event_id`, follow-up round).
#[tauri::command] pub async fn models_auto_best_redo(app: tauri::AppHandle, landmark_id: String, event_id: i64) -> Result<(), String> {
    let (_, cur) = installed(&app)?;
    crate::library::with(&app, move |l, op| redo(l, &cur, &landmark_id, event_id, op).map(|_| ())).await
}
#[tauri::command] pub async fn models_auto_best_intro(app: tauri::AppHandle) -> Result<Option<IntroNote>, String> {
    let (root, cur) = installed(&app)?;
    let mut ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    ids.push(AUTO_BEST.into());
    crate::library::with(&app, move |l, op| { let ready = base_ready_at(l, &root)?; intro(l, &cur, ready, &ids, op) }).await
}
/// Changes the base from Models… or Settings › Best model (both drop-downs; spec §2). A refusal changes nothing.
#[tauri::command] pub async fn models_auto_best_set_base(app: tauri::AppHandle, id: String) -> Result<BaseChanged, String> {
    let (_, cur) = installed(&app)?;
    crate::library::with(&app, move |l, op| set_base(l, &cur, &id, op)).await
}
#[tauri::command] pub async fn models_auto_best_way_back(app: tauri::AppHandle) -> Result<String, String> {
    crate::library::with(&app, |l, _| way_back(l)).await
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::best::tests::{add_films, library, pinned};
    const SR: &str = "srpose-cldet23";
    fn ev(l: &Library) -> Vec<(String, String, String, Option<String>)> {
        l.auto_best_events().unwrap().into_iter().map(|e| (e.landmark_id, e.kind, e.model_id, e.uses)).collect()
    }
    fn uses_go(l: &Library, cur: &BTreeMap<String, String>) -> Option<String> { map(l, cur, true, true).unwrap().uses.get("Go").cloned() }
    /// "Use … again" as Models… sends it (follow-up round): it names the Undo its row shows, the point's newest `undone` row.
    fn redo_now(l: &mut Library, cur: &BTreeMap<String, String>, p: &str, op: &str) -> anyhow::Result<AutoBestEvent> {
        let id = l.auto_best_events()?.iter().rev().find(|e| e.landmark_id == p && e.kind == "undone").map_or(0, |e| e.id);
        redo(l, cur, p, id, op)
    }
    /// The Undo as the screen sends it (final review I3): it names the change it undoes, the point's latest row.
    fn undo_now(l: &mut Library, cur: &BTreeMap<String, String>, p: &str, op: &str) -> anyhow::Result<AutoBestEvent> {
        let id = l.auto_best_events()?.iter().rev().find(|e| e.landmark_id == p).map_or(0, |e| e.id);
        Ok(undo(l, cur, p, id, op)?.remove(0))
    }

    /// Task 1 of plan 2026-10-29: Automatic best's map, its change rows and Part F's table on fixed libraries, captured under
    /// best-point/3. `normalise` blanks only what the clock writes (`at`, `since`); the case ids, which `import` draws at
    /// random, are replaced by each film's import order (`film-<library>-<n>`) before it, so the bytes repeat run to run.
    fn normalise(mut v: serde_json::Value) -> serde_json::Value {
        match &mut v {
            serde_json::Value::Object(m) => {
                for (k, x) in m.iter_mut() { if k == "at" || k == "since" { if !x.is_null() { *x = "<time>".into(); } } else { *x = normalise(x.take()); } }
            }
            serde_json::Value::Array(a) => { for x in a.iter_mut() { *x = normalise(x.take()); } }
            _ => {}
        }
        v
    }
    /// Each random case id → its library and import order. Ids are UUIDs, so a plain text swap cannot hit anything else.
    fn name_films(v: serde_json::Value, libraries: &[(&str, &[String])]) -> serde_json::Value {
        let mut text = v.to_string();
        for (name, ids) in libraries { for (n, id) in ids.iter().enumerate() { text = text.replace(id.as_str(), &format!("film-{name}-{n:02}")); } }
        serde_json::from_str(&text).unwrap()
    }
    fn golden_desktop() -> serde_json::Value {
        let cur = pinned();
        let (_t1, mut none, ids0) = library(59, 1.0, true);
        let s0 = sync(&mut none, &cur, "Dr A").unwrap();
        let (_t2, mut l, ids1) = library(60, 1.0, true);
        let s1 = sync(&mut l, &cur, "Dr A").unwrap();
        let m1 = map(&l, &cur, true, true).unwrap();
        let u = undo_now(&mut l, &cur, "Go", "Dr A").unwrap();
        let m2 = map(&l, &cur, true, true).unwrap();
        let (_t3, mut l3, ids3) = library(60, 1.0, false);
        let part_f = crate::best::verdicts(&l3, &cur).unwrap();
        crate::best::answer(&mut l3, &cur, "Go", SR, "decline", "Dr A").unwrap();
        let declined = crate::best::verdicts(&l3, &cur).unwrap();
        let v = serde_json::json!({ "no evidence": { "sync": s0, "map": map(&none, &cur, true, true).unwrap() },
            "sixty ruler films": { "sync": s1, "map": m1, "undo": u, "map after undo": m2 },
            "part f, assumed scale": { "ruleVersion": part_f.rule_version, "points": part_f.points, "choices": part_f.choices },
            "part f, after a decline": { "points": declined.points, "choices": declined.choices } });
        normalise(name_films(v, &[("none", &ids0), ("sixty", &ids1), ("assumed", &ids3)]))
    }
    /// What best-point/4 adds to these bytes, and nothing else (spec §6): the rule-version string on each row,
    /// `numbers.base` and `numbers.baseFingerprint` on each row, and the map's `base`. Each removed value is collected, so the test can assert it is Aariz's
    /// and the removal can hide nothing.
    fn strip_base(v: &mut serde_json::Value, seen: &mut Vec<(String, serde_json::Value)>) {
        match v {
            serde_json::Value::Object(m) => {
                if let Some(serde_json::Value::Object(n)) = m.get_mut("numbers") {
                    for k in ["base", "baseFingerprint"] { if let Some(x) = n.remove(k) { seen.push((k.into(), x)); } }
                }
                // The map's own `base` (an Automatic best map is the object that has `available`).
                if m.contains_key("available") { if let Some(x) = m.remove("base") { seen.push(("base".into(), x)); } }
                if m.get("ruleVersion").and_then(|x| x.as_str()) == Some("best-point/4") { m.insert("ruleVersion".into(), "best-point/3".into()); }
                for x in m.values_mut() { strip_base(x, seen); }
            }
            serde_json::Value::Array(a) => { for x in a.iter_mut() { strip_base(x, seen); } }
            _ => {}
        }
    }
    const GOLDEN_AB3: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/src/golden/auto-best-3.json");
    #[test] fn with_aariz_as_the_base_the_map_and_table_give_best_point_3s_bytes() {
        let (mut v, mut seen) = (golden_desktop(), vec![]);
        strip_base(&mut v, &mut seen);
        assert!(!seen.is_empty(), "best-point/4 rows carry their base: the strip must find some");
        let az_fp = pinned()["aariz-cepha29"].clone();
        for (k, x) in &seen {
            match k.as_str() { "base" => assert_eq!(x.as_str(), Some("aariz-cepha29")), _ => assert_eq!(x.as_str(), Some(az_fp.as_str()), "{k}") }
        }
        println!("[golden] stripped {} base values, every one Aariz's", seen.len());
        let got = serde_json::to_string_pretty(&v).unwrap() + "\n";
        // Final review M5: writing never passes, so a run with the variable set can never be taken for a check.
        if std::env::var("BEST_GOLDEN_WRITE").is_ok() { std::fs::write(GOLDEN_AB3, &got).unwrap(); panic!("golden written to {GOLDEN_AB3}; re-run without BEST_GOLDEN_WRITE"); }
        let want = std::fs::read_to_string(GOLDEN_AB3).expect("golden file: run once with BEST_GOLDEN_WRITE=1 on best-point/3");
        assert!(got == want, "Automatic best's map or Part F's table moved from best-point/3's (compare {GOLDEN_AB3})");
    }


    // ---- The base (plan 2026-10-29 Task 3; spec §4, §6, §7) ----
    #[test] fn the_base_is_aariz_unless_set() {
        let (_t, mut l, _) = library(1, 1.0, true);
        assert_eq!(base_of(&l).unwrap(), "aariz-cepha29");
        l.set_setting(BASE_KEY, "  ").unwrap();
        assert_eq!(base_of(&l).unwrap(), "aariz-cepha29", "blank reads as Aariz");
        l.set_setting(BASE_KEY, AUTO_BEST).unwrap();
        assert_eq!(base_of(&l).unwrap(), "aariz-cepha29", "Automatic best is never its own base");
        l.set_setting(BASE_KEY, GU).unwrap();
        assert_eq!(base_of(&l).unwrap(), GU);
        assert_eq!((base_from(None), base_from(Some("")), base_from(Some(" gu2net-isbi19 "))), ("aariz-cepha29".to_string(), "aariz-cepha29".to_string(), GU.to_string()));
    }
    #[test] fn every_new_row_names_its_base() {
        let (_t, mut l, _) = library(60, 1.0, true);
        let a = sync(&mut l, &pinned(), "Dr A").unwrap().remove(0);
        assert_eq!((a.numbers["base"].as_str(), a.numbers["baseFingerprint"].as_str(), a.rule_version.as_str()),
            (Some("aariz-cepha29"), pinned().get("aariz-cepha29").map(String::as_str), "best-point/4"));
        let u = undo_now(&mut l, &pinned(), "Go", "Dr A").unwrap();
        assert_eq!(u.numbers["base"].as_str(), Some("aariz-cepha29"), "the Undo row too");
        let r = redo_now(&mut l, &pinned(), "Go", "Dr A").unwrap();
        assert_eq!(r.numbers["base"].as_str(), Some("aariz-cepha29"), "the Use again row too");
        let mut gone = pinned(); gone.remove(SR);
        let back = sync(&mut l, &gone, "Dr A").unwrap().remove(0);
        assert_eq!((back.kind.as_str(), back.numbers["base"].as_str()), ("returned", Some("aariz-cepha29")), "a returned row too");
        let (_t2, mut l2, _) = library(60, 1.0, true);
        crate::best::answer(&mut l2, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        let c = l2.point_choices().unwrap().pop().unwrap();
        assert_eq!((c.numbers["base"].as_str(), c.rule_version.as_str()), (Some("aariz-cepha29"), "best-point/4"));
    }
    #[test] fn with_gu2net_as_base_aariz_placed_films_stop_counting() {
        let (_t, mut l, _) = library(60, 1.0, true);
        assert_eq!(uses_go(&l, &pinned()).as_deref(), Some(SR), "control: Aariz as base, SRPose adopted");
        l.set_setting(BASE_KEY, GU).unwrap();
        assert_eq!(uses_go(&l, &pinned()), None, "Aariz placed every film: none counts against GU2Net (rule item 1)");
        let pf = crate::best::verdicts(&l, &pinned()).unwrap();
        assert!(pf.points.iter().all(|p| p.offer.is_none() && p.current == GU), "Part F reads the base too");
    }
    #[test] fn without_the_base_installed_it_is_not_available() {
        let (_t, mut l, _) = library(60, 1.0, true);
        l.set_setting(BASE_KEY, GU).unwrap();
        let mut cur = pinned(); cur.remove(GU);
        // Final review M1: the live path (`base_ready_at`, the models folder), not a helper production never called.
        let models = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(models.path().join("aariz-cepha29")).unwrap();
        std::fs::write(models.path().join("aariz-cepha29").join("manifest.json"), "{}").unwrap();
        let _ = &cur;
        assert!(!base_ready_at(&l, models.path()).unwrap(), "GU2Net is not installed in the models folder");
        std::fs::create_dir_all(models.path().join(GU)).unwrap();
        std::fs::write(models.path().join(GU).join("manifest.json"), "{}").unwrap();
        assert!(base_ready_at(&l, models.path()).unwrap(), "control: installed");
        assert_eq!(map_now(&l, models.path(), &pinned()).unwrap().available, true, "the map the screen reads says so too");
        assert!(!auto_best_on(None, false));
        let m = map(&l, &cur, false, true).unwrap();
        assert_eq!((m.available, m.on, m.base.as_str(), m.uses.len()), (false, false, GU, 0), "the screen still learns which base is missing");
        l.set_setting(BASE_KEY, "none-such").unwrap();
        assert!(!base_ready_at(&l, models.path()).unwrap(), "an unknown id is never ready");
        assert_eq!(map(&l, &pinned(), false, true).unwrap().base, "none-such");
    }


    // ---- Changing the base (plan 2026-10-29 Task 4; spec §4, §6, §7) ----
    fn log_of(l: &Library) -> Vec<serde_json::Value> { serde_json::from_str(&l.setting(BASE_LOG_KEY).unwrap().unwrap()).unwrap() }
    #[test] fn changing_the_base_records_each_point_it_changes_and_the_log() {
        let (_t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        let c = set_base(&mut l, &pinned(), GU, "Dr B").unwrap();
        assert_eq!((c.from.as_str(), c.to.as_str()), ("aariz-cepha29", GU));
        assert_eq!(c.events.iter().map(|e| (e.landmark_id.as_str(), e.kind.as_str(), e.reason.as_deref())).collect::<Vec<_>>(), [("Go", "returned", Some("evidence"))]);
        assert_eq!((c.events[0].numbers["cause"].as_str(), c.events[0].numbers["baseFrom"].as_str(), c.events[0].numbers["baseTo"].as_str(), c.events[0].numbers["base"].as_str()),
            (Some("base-changed"), Some("aariz-cepha29"), Some(GU), Some(GU)));
        assert_eq!(l.setting(BASE_KEY).unwrap().as_deref(), Some(GU));
        let log = log_of(&l);
        assert_eq!((log.len(), log[0]["from"].as_str(), log[0]["to"].as_str(), log[0]["who"].as_str()), (1, Some("aariz-cepha29"), Some(GU), Some("Dr B")));
        assert!(log[0]["when"].as_str().is_some_and(|w| w.len() == 24 && w.ends_with('Z')), "{:?}", log[0]["when"]);
        // The way back is the same command: Go is adopted again, with its own row.
        let back = set_base(&mut l, &pinned(), "aariz-cepha29", "Dr B").unwrap();
        assert_eq!(back.events.iter().map(|e| (e.landmark_id.as_str(), e.kind.as_str())).collect::<Vec<_>>(), [("Go", "adopted")]);
        assert_eq!(back.events[0].numbers["cause"].as_str(), Some("base-changed"));
        assert_eq!(log_of(&l).len(), 2);
        assert_eq!(uses_go(&l, &pinned()).as_deref(), Some(SR));
    }
    #[test] fn undos_and_part_f_declines_survive_a_change_of_base() {
        let (_t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        undo_now(&mut l, &pinned(), "Go", "Dr A").unwrap();
        set_base(&mut l, &pinned(), GU, "Dr A").unwrap();
        set_base(&mut l, &pinned(), "aariz-cepha29", "Dr A").unwrap();
        assert_eq!(uses_go(&l, &pinned()), None, "the Undo still holds after two changes of base");
        let (_t2, mut l2, _) = library(60, 1.0, true);
        crate::best::answer(&mut l2, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        set_base(&mut l2, &pinned(), GU, "Dr A").unwrap();
        set_base(&mut l2, &pinned(), "aariz-cepha29", "Dr A").unwrap();
        assert_eq!(crate::best::verdicts(&l2, &pinned()).unwrap().points.iter().find(|p| p.landmark_id == "Go").unwrap().offer, None, "the Part F decline still holds");
    }
    #[test] fn a_base_that_cannot_be_used_is_refused_and_nothing_is_written() {
        let (_t, mut l, _) = library(60, 1.0, true);
        let mut cur = pinned(); cur.remove(GU);
        for bad in [GU, "auto-best", "", "none-such"] { assert!(set_base(&mut l, &cur, bad, "Dr A").is_err(), "{bad:?}"); }
        assert_eq!(set_base(&mut l, &cur, GU, "Dr A").unwrap_err().to_string(), "GU2Net is not installed: install it in Models… first");
        assert!(l.setting(BASE_KEY).unwrap().is_none() && l.setting(BASE_LOG_KEY).unwrap().is_none() && l.auto_best_events().unwrap().is_empty());
    }
    #[test] fn choosing_the_base_already_in_force_writes_nothing() {
        let (_t, mut l, _) = library(1, 1.0, true);
        let c = set_base(&mut l, &pinned(), "aariz-cepha29", "Dr A").unwrap();
        assert!(c.events.is_empty() && c.from == c.to && l.setting(BASE_LOG_KEY).unwrap().is_none() && l.setting(BASE_KEY).unwrap().is_none());
    }
    /// Edge cases (plan Task 4 Step 6): no evidence anywhere (no rows, one log entry); a log that is not JSON is kept in the
    /// new entry under `lostLog`, never dropped; a failure part-way restores the base and the log.
    #[test] fn a_change_with_no_evidence_writes_one_log_entry_and_no_rows() {
        let (_t, mut l, _) = library(1, 1.0, true);
        let c = set_base(&mut l, &pinned(), GU, "Dr A").unwrap();
        assert!(c.events.is_empty() && l.auto_best_events().unwrap().is_empty());
        assert_eq!(log_of(&l).len(), 1);
    }
    #[test] fn a_log_that_cannot_be_read_is_kept_not_dropped() {
        let (_t, mut l, _) = library(1, 1.0, true);
        l.set_setting(BASE_LOG_KEY, "not json").unwrap();
        set_base(&mut l, &pinned(), GU, "Dr A").unwrap();
        let log = log_of(&l);
        assert_eq!((log.len(), log[0]["lostLog"].as_str(), log[0]["to"].as_str()), (1, Some("not json"), Some(GU)));
    }
    #[test] fn a_change_that_fails_part_way_leaves_the_base_and_the_log_as_they_were() {
        let (_t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        l.conn_for_tests().execute_batch("CREATE TEMP TRIGGER inject BEFORE INSERT ON main.auto_best_events BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
        let e = set_base(&mut l, &pinned(), GU, "Dr A").unwrap_err();
        assert!(format!("{e:#}").contains("injected failure"), "{e:#}");
        assert_eq!((l.setting(BASE_KEY).unwrap(), l.setting(BASE_LOG_KEY).unwrap(), l.auto_best_events().unwrap().len()), (None, None, 1));
        l.conn_for_tests().execute_batch("DROP TRIGGER temp.inject;").unwrap();
        assert_eq!(set_base(&mut l, &pinned(), GU, "Dr A").unwrap().events.len(), 1, "control: without the failure the change is made");
    }
    #[test] fn a_library_that_cannot_be_written_refuses_the_change() {
        let (_t, mut l, _) = library(60, 1.0, true);
        l.conn_for_tests().execute_batch("PRAGMA query_only = ON;").unwrap();
        assert!(set_base(&mut l, &pinned(), GU, "Dr A").is_err());
        l.conn_for_tests().execute_batch("PRAGMA query_only = OFF;").unwrap();
        assert_eq!((l.setting(BASE_KEY).unwrap(), l.setting(BASE_LOG_KEY).unwrap()), (None, None), "nothing changed");
    }
    #[test] fn the_utc_clock_reads_as_the_library_writes_times() {
        assert_eq!(utc_iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(utc_iso(1_761_955_200_123), "2025-11-01T00:00:00.123Z");
        assert_eq!(utc_iso(951_782_400_000), "2000-02-29T00:00:00.000Z", "a leap day");
    }

    #[test] fn on_means_aariz_installed_and_the_setting_blank_or_auto_best() {
        assert!(auto_best_on(None, true) && auto_best_on(Some(""), true) && auto_best_on(Some("  "), true) && auto_best_on(Some("auto-best"), true));
        assert!(!auto_best_on(Some("aariz-cepha29"), true) && !auto_best_on(Some("gu2net-isbi19"), true));
        assert!(!auto_best_on(None, false) && !auto_best_on(Some("auto-best"), false), "never without Aariz");
    }
    #[test] fn its_own_undos_are_declines_and_a_redo_takes_one_back() {
        let e = |id: i64, kind: &str, case: &str| AutoBestEvent { id, landmark_id: "Go".into(), kind: kind.into(), model_id: SR.into(), fingerprint: Some("fp".into()),
            uses: None, last_imported_at: Some("t".into()), last_case_id: Some(case.into()), basis: Some("b".into()), reason: None, numbers: serde_json::json!({}),
            rule_version: "best-point/3".into(), operator: "Dr A".into(), at: "x".into() };
        let d = decisions_of(&[e(1, "adopted", "c059"), e(2, "undone", "c070")]);
        assert_eq!(d.len(), 1);
        assert_eq!((d[0].action, d[0].last_film.as_ref().map(|f| f.case_id.as_str())), (Action::Declined, Some("c070")));
        assert!(decisions_of(&[e(1, "undone", "c070"), e(2, "redone", "c070")]).is_empty(), "Use again takes the Undo back");
        assert_eq!(decisions_of(&[e(1, "undone", "c070"), e(2, "redone", "c999")]).len(), 1, "a redo of another Undo takes nothing back");
    }
    #[test] fn no_evidence_records_nothing_and_sixty_films_record_one_adoption_once() {
        let (_t, mut short, _) = library(59, 1.0, true);
        assert!(sync(&mut short, &pinned(), "Dr A").unwrap().is_empty() && short.auto_best_events().unwrap().is_empty());
        let (_t2, mut l, _) = library(60, 1.0, true);
        let new = sync(&mut l, &pinned(), "Dr A").unwrap();
        assert_eq!(new.len(), 1, "control: the same check sees the offer");
        let a = &new[0];
        assert_eq!((a.landmark_id.as_str(), a.kind.as_str(), a.model_id.as_str(), a.uses.as_deref(), a.basis.as_deref(), a.last_case_id.is_some()),
            ("Go", "adopted", SR, Some(SR), Some("mm, 60 ruler films"), true));
        assert_eq!(a.fingerprint.as_deref(), pinned().get(SR).map(String::as_str));
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty(), "nothing changed: nothing written");
        assert_eq!(uses_go(&l, &pinned()).as_deref(), Some(SR));
    }
    #[test] fn part_f_answers_do_not_steer_it() {
        let (_t, mut l, _) = library(60, 1.0, true);
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        assert_eq!(uses_go(&l, &pinned()).as_deref(), Some(SR), "a Part F decline is ignored (Q1)");
        let (_t2, mut l2, _) = library(60, 1.0, true);
        crate::best::answer(&mut l2, &pinned(), "Go", SR, "accept", "Dr A").unwrap();
        assert_eq!(uses_go(&l2, &pinned()).as_deref(), Some(SR), "a Part F accept changes nothing here either");
    }
    #[test] fn undo_keeps_the_point_until_newer_films_decide_again() {
        let (t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        let u = undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap();
        assert_eq!((u.kind.as_str(), u.uses.clone(), u.last_case_id.is_some()), ("undone", None, true));
        let m = map(&l, &pinned(), true, true).unwrap();
        assert!(m.uses.get("Go").is_none() && m.kept.get("Go").is_some_and(|k| k.model_id == SR));
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty(), "your own Undo writes no note");
        add_films(t.path(), &mut l, 60, 59, 1.0, true);
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty(), "59 newer films: not yet");
        add_films(t.path(), &mut l, 119, 1, 1.0, true);
        let again = sync(&mut l, &pinned(), "Dr A").unwrap();
        assert_eq!(again.iter().map(|e| (e.kind.as_str(), e.model_id.as_str())).collect::<Vec<_>>(), [("adopted", SR)], "60 newer films: back, with a note");
        assert_ne!(again[0].last_case_id, u.last_case_id, "decided on the newer films");
    }
    /// Plan ruling R1: an Undo pressed after newer films have arrived is anchored on the newest film then, not on the
    /// offer's own re-check film, so the films already there cannot override it at once. Positive control: anchor on
    /// `u.last` in `undo` → the Undo is refused ("newer films already show …").
    #[test] fn an_undo_pressed_later_is_anchored_on_the_newest_film() {
        let (t, mut l, ids) = library(60, 1.0, true);
        let a = sync(&mut l, &pinned(), "Dr A").unwrap();
        assert_eq!(a[0].last_case_id.as_deref(), Some(ids[59].as_str()));
        let more = add_films(t.path(), &mut l, 60, 60, 1.0, true);
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty(), "the same verdict: nothing written");
        let u = undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap();
        assert_eq!(u.last_case_id.as_deref(), Some(more[59].as_str()), "anchored on the newest film");
        assert_eq!(uses_go(&l, &pinned()), None, "kept as it was");
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty());
    }
    #[test] fn undo_is_refused_when_there_is_nothing_to_undo_and_writes_nothing() {
        let (_t, mut l, _) = library(60, 1.0, true);
        assert!(undo_now(&mut l, &pinned(), "Go", "Dr A").is_err(), "no change recorded yet");
        sync(&mut l, &pinned(), "Dr A").unwrap();
        undo_now(&mut l, &pinned(), "Go", "Dr A").unwrap();
        let n = l.auto_best_events().unwrap().len();
        assert!(undo_now(&mut l, &pinned(), "Go", "Dr A").is_err(), "already undone");
        assert!(undo_now(&mut l, &pinned(), "S", "Dr A").is_err(), "no change at S");
        assert_eq!(l.auto_best_events().unwrap().len(), n);
    }
    /// Spec §6a: Undo only while today's verdict still names the model adopted. Here SRPose's file changed after the
    /// adoption and before any check: its evidence starts afresh, so there is nothing to undo.
    #[test] fn undo_and_use_again_are_refused_when_the_evidence_has_moved() {
        let (_t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        let mut changed = pinned(); changed.insert(SR.into(), "fp-new".into());
        let e = undo_now(&mut l, &changed, "Go", "Dr A").unwrap_err().to_string();
        assert!(e.contains("the evidence has changed since"), "{e}");
        assert_eq!(l.auto_best_events().unwrap().len(), 1, "nothing written");
        undo_now(&mut l, &pinned(), "Go", "Dr A").unwrap();
        let e = redo_now(&mut l, &changed, "Go", "Dr A").unwrap_err().to_string();
        assert!(e.contains("the evidence has changed since"), "{e}");
        assert_eq!(l.auto_best_events().unwrap().len(), 2, "nothing written");
    }
    #[test] fn use_again_restores_the_model_and_is_refused_without_an_undo() {
        let (_t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        assert!(redo_now(&mut l, &pinned(), "Go", "Dr A").is_err(), "no Undo in force");
        undo_now(&mut l, &pinned(), "Go", "Dr A").unwrap();
        let r = redo_now(&mut l, &pinned(), "Go", "Dr A").unwrap();
        assert_eq!((r.kind.as_str(), r.uses.as_deref()), ("redone", Some(SR)));
        assert_eq!(uses_go(&l, &pinned()).as_deref(), Some(SR));
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty());
        assert_eq!(ev(&l).iter().map(|e| e.1.as_str()).collect::<Vec<_>>(), ["adopted", "undone", "redone"]);
    }
    #[test] fn a_file_change_or_a_removed_model_returns_the_point_with_its_reason() {
        let (_t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        let mut changed = pinned(); changed.insert(SR.into(), "fp-new".into());
        let r = sync(&mut l, &changed, "Dr A").unwrap();
        assert_eq!((r[0].kind.as_str(), r[0].reason.as_deref(), r[0].uses.clone()), ("returned", Some("file-changed"), None));
        let (_t2, mut l2, _) = library(60, 1.0, true);
        sync(&mut l2, &pinned(), "Dr A").unwrap();
        let mut gone = pinned(); gone.remove(SR);
        assert_eq!(sync(&mut l2, &gone, "Dr A").unwrap()[0].reason.as_deref(), Some("not-installed"));
    }
    /// Spec §6a: "the same model with a different file" is a change. SRPose adopted on its pinned file; its file is
    /// replaced and 60 films made by the new file decide for it again before any check ran: a new `adopted` naming the
    /// new file. Positive control: drop the fingerprint half of `changed` in `sync` → nothing is written and this fails.
    #[test] fn the_same_model_with_a_new_file_is_a_new_adoption() {
        let (t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        let more = add_films(t.path(), &mut l, 60, 60, 1.0, true);
        for id in &more {
            l.conn_for_tests().execute("UPDATE learning_record SET model_sha256 = 'fp-new' WHERE case_id = ?1 AND model_id = ?2", rusqlite::params![id, SR]).unwrap();
        }
        let mut changed = pinned(); changed.insert(SR.into(), "fp-new".into());
        let r = sync(&mut l, &changed, "Dr A").unwrap();
        assert_eq!(r.iter().map(|e| (e.kind.as_str(), e.fingerprint.as_deref(), e.last_case_id.as_deref())).collect::<Vec<_>>(),
            [("adopted", Some("fp-new"), Some(more[59].as_str()))]);
        assert!(sync(&mut l, &changed, "Dr A").unwrap().is_empty());
    }
    /// A film moved to Recently deleted stops counting (Part F's reads leave it out): the evidence for SRPose drops
    /// below 60, so Gonion returns to Aariz with reason `evidence`. Control: before the deletion, the same library adopts.
    #[test] fn a_deleted_film_can_take_the_evidence_away() {
        let (_t, mut l, ids) = library(60, 1.0, true);
        assert_eq!(sync(&mut l, &pinned(), "Dr A").unwrap().len(), 1);
        l.delete(&ids[59]).unwrap();
        let r = sync(&mut l, &pinned(), "Dr A").unwrap();
        assert_eq!(r.iter().map(|e| (e.kind.as_str(), e.reason.as_deref())).collect::<Vec<_>>(), [("returned", Some("evidence"))]);
        assert_eq!(uses_go(&l, &pinned()), None);
    }
    #[test] fn the_map_is_empty_without_aariz_and_carries_on_notes_and_latest() {
        let (_t, mut l, _) = library(60, 1.0, true);
        assert_eq!(map(&l, &pinned(), false, true).unwrap(), AutoBestMap { base: "aariz-cepha29".into(), ..AutoBestMap::default() });
        sync(&mut l, &pinned(), "Dr A").unwrap();
        let m = map(&l, &pinned(), true, false).unwrap();
        assert!(!m.on && m.available);
        assert_eq!(m.notes.get("Go").map(|n| (n.basis.as_str(), n.since.is_some())), Some(("mm, 60 ruler films", true)));
        assert_eq!(m.latest.iter().map(|e| e.landmark_id.as_str()).collect::<Vec<_>>(), ["Go"]);
    }

    fn ids() -> Vec<String> { vec!["aariz-cepha29".into(), SR.into(), "gu2net-isbi19".into(), "cwlachap-hrnet-w32".into(), AUTO_BEST.into()] }
    #[test] fn the_first_open_of_a_library_with_films_switches_to_automatic_best_once_with_a_way_back() {
        let (_t, mut l, _) = library(3, 1.0, true);
        l.set_setting(crate::models::MAIN_KEY, "gu2net-isbi19").unwrap();
        let n = intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap();
        assert_eq!(n, Some(IntroNote { before: Some("gu2net-isbi19".into()), kept_declines: 0 }));
        assert_eq!(l.setting(crate::models::MAIN_KEY).unwrap().as_deref(), Some(AUTO_BEST));
        assert!(l.setting(INTRO_KEY).unwrap().is_some());
        assert_eq!(intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap(), None, "only once");
        assert_eq!(way_back(&mut l).unwrap(), "gu2net-isbi19");
        assert_eq!(l.setting(crate::models::MAIN_KEY).unwrap().as_deref(), Some("gu2net-isbi19"));
    }
    #[test] fn the_way_back_from_a_blank_setting_is_aariz_and_an_auto_best_setting_needs_no_note() {
        let (_t, mut l, _) = library(1, 1.0, true);
        assert_eq!(intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap(), Some(IntroNote { before: None, kept_declines: 0 }));
        assert_eq!(way_back(&mut l).unwrap(), "aariz-cepha29");
        let (_t2, mut l2, _) = library(1, 1.0, true);
        l2.set_setting(crate::models::MAIN_KEY, AUTO_BEST).unwrap();
        assert_eq!(intro(&mut l2, &pinned(), true, &ids(), "Dr A").unwrap(), None);
        assert!(l2.setting(INTRO_KEY).unwrap().is_some(), "recorded, so it never runs again");
    }
    #[test] fn a_new_library_starts_with_every_ghost_off_and_no_note() {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        assert_eq!(intro(&mut l, &pinned(), false, &ids(), "Dr A").unwrap(), None);
        let hidden: Vec<String> = serde_json::from_str(&l.setting("ghosts_hidden").unwrap().unwrap()).unwrap();
        assert_eq!(hidden, ids());
        assert_eq!(l.setting(crate::models::MAIN_KEY).unwrap(), None, "blank means Automatic best (D1)");
        let t2 = tempfile::tempdir().unwrap();
        let mut l2 = Library::open(t2.path()).unwrap();
        l2.set_setting("ghosts_hidden", "[]").unwrap();
        intro(&mut l2, &pinned(), true, &ids(), "Dr A").unwrap();
        assert_eq!(l2.setting("ghosts_hidden").unwrap().as_deref(), Some("[]"), "a choice already made is kept");
    }
    #[test] fn without_aariz_the_upgrade_waits_and_writes_nothing() {
        let (_t, mut l, _) = library(1, 1.0, true);
        l.set_setting(crate::models::MAIN_KEY, "gu2net-isbi19").unwrap();
        assert_eq!(intro(&mut l, &pinned(), false, &ids(), "Dr A").unwrap(), None);
        assert_eq!((l.setting(crate::models::MAIN_KEY).unwrap().as_deref(), l.setting(INTRO_KEY).unwrap()), (Some("gu2net-isbi19"), None));
        assert!(intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap().is_some(), "then Aariz is installed: the note");
    }
    #[test] fn q5_a_standing_part_f_decline_is_kept_once() {
        let (_t, mut l, _) = library(60, 1.0, true);
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        let n = intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap().unwrap();
        assert_eq!(n.kept_declines, 1);
        let m = map(&l, &pinned(), true, true).unwrap();
        assert!(m.uses.get("Go").is_none() && m.kept.get("Go").is_some());
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty(), "no note for a point you had declined");
        assert_eq!(carry_declines(&mut l, &pinned(), "Dr A").unwrap(), 0, "carried once");
        let (_t2, mut l2, _) = library(60, 1.0, true);
        assert_eq!(carry_declines(&mut l2, &pinned(), "Dr A").unwrap(), 0, "control: no decline, nothing carried");
    }
    // M3 (leftovers Task 3): the first-open writes are one transaction. A planted failure on the intro setting (written
    // after the main setting, inside the transaction) leaves NOTHING written; without it, the next run writes all three.
    #[test] fn the_first_open_step_writes_all_or_nothing() {
        let (dir, mut l, _) = library(60, 1.0, true);
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        let raw = rusqlite::Connection::open(dir.path().join("library.sqlite3")).unwrap();
        raw.execute_batch("CREATE TRIGGER planted BEFORE INSERT ON settings WHEN NEW.key = 'auto_best_intro'
            BEGIN SELECT RAISE(ABORT, 'planted'); END;").unwrap();
        let before_main = l.setting(crate::models::MAIN_KEY).unwrap();
        let before_rows = l.auto_best_events().unwrap().len();
        let err = intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap_err();
        eprintln!("edge: planted failure on the intro setting -> {err:#}");
        assert_eq!(l.setting(crate::models::MAIN_KEY).unwrap(), before_main, "main model unchanged");
        assert_eq!(l.auto_best_events().unwrap().len(), before_rows, "no Undo carried");
        assert_eq!(l.setting(INTRO_KEY).unwrap(), None);
        assert!(!on_in(&l, true).unwrap(), "still off: the step has not run");
        raw.execute_batch("DROP TRIGGER planted;").unwrap();
        let n = intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap().unwrap();
        assert_eq!((n.before.clone(), n.kept_declines), (before_main.filter(|s| !s.trim().is_empty()), 1), "the way back is kept");
        assert_eq!((l.setting(crate::models::MAIN_KEY).unwrap().as_deref(), l.setting(INTRO_KEY).unwrap().is_some()), (Some(AUTO_BEST), true));
        assert_eq!(ev(&l).iter().map(|e| (e.0.as_str(), e.1.as_str())).collect::<Vec<_>>(), [("Go", "undone")]);
        eprintln!("edge: trigger dropped, next run -> note {n:?}, main {:?}, rows {:?}", l.setting(crate::models::MAIN_KEY).unwrap(), ev(&l));
    }
    /// The same with the failure on the LAST write of the transaction (the carried Undo row): nothing written either.
    #[test] fn a_failure_on_the_carried_undo_row_leaves_the_settings_unwritten() {
        let (dir, mut l, _) = library(60, 1.0, true);
        l.set_setting(crate::models::MAIN_KEY, GU).unwrap();
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        let raw = rusqlite::Connection::open(dir.path().join("library.sqlite3")).unwrap();
        raw.execute_batch("CREATE TRIGGER planted BEFORE INSERT ON auto_best_events BEGIN SELECT RAISE(ABORT, 'planted'); END;").unwrap();
        let err = intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap_err();
        eprintln!("edge: planted failure on the Undo row -> {err:#}");
        assert_eq!((l.setting(crate::models::MAIN_KEY).unwrap().as_deref(), l.setting(INTRO_KEY).unwrap()), (Some(GU), None));
        assert!(l.auto_best_events().unwrap().is_empty());
        raw.execute_batch("DROP TRIGGER planted;").unwrap();
        assert_eq!(intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap(), Some(IntroNote { before: Some(GU.into()), kept_declines: 1 }));
    }
    // M2: with films and no first-open step yet, Automatic best is off even once the base is installed.
    #[test] fn automatic_best_is_off_until_the_first_open_step_has_run() {
        let (_dir, mut l, _) = library(1, 1.0, true);                        // films; MAIN_KEY blank; INTRO_KEY unset
        assert_eq!(intro(&mut l, &pinned(), false, &ids(), "Dr A").unwrap(), None, "no base: waits");
        assert!(!on_in(&l, true).unwrap(), "base installed now, step not run: off");
        assert!(!map(&l, &pinned(), true, on_in(&l, true).unwrap()).unwrap().on, "the screen's map says off");
        assert!(intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap().is_some());
        assert!(on_in(&l, true).unwrap(), "after the step: on");
        assert_eq!(intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap(), None, "run again: no second note");
    }
    /// Only deleted films still count as a library with films (spec §6b: "no films, live or deleted").
    #[test] fn a_library_whose_only_film_is_deleted_also_waits_for_the_step() {
        let (_dir, mut l, ids) = library(1, 1.0, true);
        l.delete(&ids[0]).unwrap();
        assert!(l.list(false).unwrap().is_empty() && !l.list(true).unwrap().is_empty());
        assert!(!on_in(&l, true).unwrap());
        intro(&mut l, &pinned(), true, &self::ids(), "Dr A").unwrap();
        assert!(on_in(&l, true).unwrap());
    }
    #[test] fn a_new_library_is_on_once_its_first_open_step_has_recorded_it() {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();                         // no films, live or deleted
        assert!(on_in(&l, true).unwrap(), "no films: on as today, even before the step");
        intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap();
        assert!(l.setting(INTRO_KEY).unwrap().is_some(), "written at once");
        assert!(on_in(&l, true).unwrap());
    }
    /// The main setting already Automatic best: the unchanged branch (one setting written, no note), on before and after.
    #[test] fn a_main_setting_already_automatic_best_is_the_unchanged_branch() {
        let (_dir, mut l, _) = library(1, 1.0, true);
        l.set_setting(crate::models::MAIN_KEY, AUTO_BEST).unwrap();
        assert!(!on_in(&l, true).unwrap(), "films and no step yet: off, whatever the setting says");
        assert_eq!(intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap(), None);
        assert!(on_in(&l, true).unwrap());
        assert!(l.auto_best_events().unwrap().is_empty());
    }
    /// The base changed to a non-Aariz model before the first-open step: the step runs against that base (its readiness
    /// is the caller's `base_ready`), Part F's SRPose decline is not carried (SRPose is the base, so the rule offers it
    /// nothing to decline), and Automatic best is off until then and on after.
    #[test] fn the_base_changed_to_another_model_before_the_first_open_step() {
        let (_dir, mut l, _) = library(60, 1.0, true);
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        l.set_setting(BASE_KEY, SR).unwrap();
        assert!(!on_in(&l, true).unwrap());
        let n = intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap();
        eprintln!("edge: base {SR} before the step -> note {n:?}, rows {:?}", ev(&l));
        assert_eq!(n, Some(IntroNote { before: None, kept_declines: 0 }));
        assert!(l.auto_best_events().unwrap().is_empty());
        assert!(on_in(&l, true).unwrap());
    }
    /// A copy of every Gonion learning row at Menton, so the rule offers SRPose at both points.
    fn go_and_me() -> (tempfile::TempDir, Library, Vec<String>) {
        let (t, mut l, ids) = library(60, 1.0, true);
        for id in &ids {
            let mut rows = l.learning_rows(id).unwrap();
            let me: Vec<_> = rows.iter().filter(|r| r.landmark_id == "Go").map(|r| ceph_store::LearningRow { landmark_id: "Me".into(), ..r.clone() }).collect();
            rows.extend(me);
            l.replace_learning(id, &rows, "Dr A").unwrap();
        }
        (t, l, ids)
    }
    /// Two declines carried in the one transaction; a planted failure leaves neither.
    #[test] fn two_carried_declines_are_written_together_or_not_at_all() {
        let (dir, mut l, _) = go_and_me();
        assert_eq!(map(&l, &pinned(), true, true).unwrap().uses.keys().cloned().collect::<Vec<_>>(), ["Go", "Me"], "control: SRPose offered at both");
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        crate::best::answer(&mut l, &pinned(), "Me", SR, "decline", "Dr A").unwrap();
        let raw = rusqlite::Connection::open(dir.path().join("library.sqlite3")).unwrap();
        raw.execute_batch("CREATE TRIGGER planted BEFORE INSERT ON auto_best_events WHEN NEW.landmark_id = 'Go'
            BEGIN SELECT RAISE(ABORT, 'planted'); END;").unwrap();
        assert!(intro(&mut l, &pinned(), true, &ids(), "Dr A").is_err());
        assert!(l.auto_best_events().unwrap().is_empty(), "Menton's row is not left behind");
        raw.execute_batch("DROP TRIGGER planted;").unwrap();
        assert_eq!(intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap(), Some(IntroNote { before: None, kept_declines: 2 }));
        let mut got = ev(&l).into_iter().map(|e| (e.0, e.1)).collect::<Vec<_>>(); got.sort();
        assert_eq!(got, [("Go".to_string(), "undone".to_string()), ("Me".into(), "undone".into())]);
    }
    /// A decline that cannot be carried (Menton's, on an older offer) is skipped; Gonion's is still carried, in the same
    /// transaction as the settings.
    #[test] fn a_decline_that_cannot_be_carried_leaves_the_others_carried() {
        let (_dir, mut l, films) = go_and_me();
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        l.add_point_choice(&ceph_store::NewPointChoice { landmark_id: "Me", model_id: SR, action: "declined", rule_version: best::RULE_VERSION,
            last_film: Some(("2026-01-01T00:40:00.000Z", &films[40])), basis: Some("mm, 60 ruler films"), numbers: &serde_json::json!({}) }, "Dr A").unwrap();
        let n = intro(&mut l, &pinned(), true, &ids(), "Dr A").unwrap();
        eprintln!("edge: one decline not carriable -> note {n:?}, rows {:?}", ev(&l));
        assert_eq!(n, Some(IntroNote { before: None, kept_declines: 1 }));
        assert_eq!(ev(&l).iter().map(|e| (e.0.as_str(), e.1.as_str())).collect::<Vec<_>>(), [("Go", "undone")]);
        assert_eq!(map(&l, &pinned(), true, true).unwrap().uses.get("Me").map(String::as_str), Some(SR), "Menton still uses SRPose");
    }
    /// Brief edge case: a decline on an older offer (its film is not the re-check film the rule gives now) is not carried.
    /// Control: the same decline written on the offer's own film (film 59) is carried.
    #[test] fn a_part_f_decline_on_an_older_offer_is_not_carried() {
        let decline_on = |film: usize| {
            let (t, mut l, ids) = library(60, 1.0, true);
            let at = format!("2026-01-01T00:{film:02}:00.000Z");
            l.add_point_choice(&ceph_store::NewPointChoice { landmark_id: "Go", model_id: SR, action: "declined", rule_version: best::RULE_VERSION,
                last_film: Some((&at, &ids[film])), basis: Some("mm, 60 ruler films"), numbers: &serde_json::json!({}) }, "Dr A").unwrap();
            (t, l)
        };
        let (_t, mut older) = decline_on(40);
        assert_eq!(carry_declines(&mut older, &pinned(), "Dr A").unwrap(), 0);
        assert!(older.auto_best_events().unwrap().is_empty());
        let (_t2, mut same) = decline_on(59);
        assert_eq!(carry_declines(&mut same, &pinned(), "Dr A").unwrap(), 1, "control: on the offer's own film, carried");
    }

    /// "Carried once" with teeth: after a carried decline, the carried Undo itself removes the offer, so a second carry
    /// finds nothing to match whatever the already-carried check says. The check matters after "Use SRPose again": the
    /// offer is back on the same film, and without the check the Part F decline would be carried again, undoing the
    /// user's own choice. Positive control: drop the already-carried check in `carry_declines` → this fails (count 1).
    #[test] fn a_carried_decline_taken_back_with_use_again_is_not_carried_again() {
        let (_t, mut l, _) = library(60, 1.0, true);
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        assert_eq!(carry_declines(&mut l, &pinned(), "Dr A").unwrap(), 1);
        redo_now(&mut l, &pinned(), "Go", "Dr A").unwrap();
        assert_eq!(uses_go(&l, &pinned()).as_deref(), Some(SR));
        assert_eq!(carry_declines(&mut l, &pinned(), "Dr A").unwrap(), 0, "your Use again stands");
        assert_eq!(uses_go(&l, &pinned()).as_deref(), Some(SR));
    }
    const GU: &str = "gu2net-isbi19";
    /// Two models beat Aariz at Gonion (SRPose 1 mm closer, GU2Net 0.5 mm closer): the fixture of Part F's
    /// `only_the_one_model_the_rule_offers_can_be_accepted`.
    fn two_challengers() -> (tempfile::TempDir, Library) {
        let (t, mut l, ids) = library(60, 1.0, true);
        for id in &ids {
            let mut rows = l.learning_rows(id).unwrap();
            let az = rows.iter().find(|r| r.model_id == best::DEFAULT_BASE).unwrap().clone();
            let d = |x: f64| if az.how == "accepted-unmoved" { 1.0 } else { x - 0.5 };
            rows.push(ceph_store::LearningRow { model_id: GU.into(), placer: false, dist_px: d(az.dist_px), dist_mm: d(az.dist_mm), ..az });
            l.replace_learning(id, &rows, "Dr A").unwrap();
        }
        (t, l)
    }
    /// Ruling (Task 4 concern 2): an Undo that leaves a SECOND challenger in use records it as its own adoption — a note,
    /// an Undo of its own, and its file tracked — so a later change of its file reads `file-changed`, not `evidence`.
    /// Positive control: without the adoption row, the file change below reads `evidence` and no `adopted` GU2Net row exists.
    #[test] fn an_undo_that_hands_the_point_to_a_second_challenger_records_its_adoption() {
        let (_t, mut l) = two_challengers();
        assert_eq!(sync(&mut l, &pinned(), "Dr A").unwrap().iter().map(|e| e.model_id.as_str()).collect::<Vec<_>>(), [SR], "control: SRPose first");
        undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap();
        let rows = l.auto_best_events().unwrap();
        assert_eq!(rows.iter().map(|e| (e.kind.as_str(), e.model_id.as_str(), e.uses.as_deref())).collect::<Vec<_>>(),
            [("adopted", SR, Some(SR)), ("undone", SR, Some(GU)), ("adopted", GU, Some(GU))]);
        let g = &rows[2];
        assert_eq!((g.fingerprint.as_deref(), g.basis.as_deref(), g.last_case_id.is_some()), (pinned().get(GU).map(String::as_str), Some("mm, 60 ruler films"), true));
        let m = map(&l, &pinned(), true, true).unwrap();
        assert_eq!(m.uses.get("Go").map(String::as_str), Some(GU));
        assert!(m.notes.get("Go").is_some_and(|n| n.since.is_some()), "GU2Net's note");
        assert_eq!(m.latest.last().map(|e| (e.kind.as_str(), e.model_id.as_str())), Some(("adopted", GU)));
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty(), "already recorded: nothing more");
        let mut changed = pinned(); changed.insert(GU.into(), "fp-new".into());
        let r = sync(&mut l, &changed, "Dr A").unwrap();
        assert_eq!(r.iter().map(|e| (e.kind.as_str(), e.model_id.as_str(), e.reason.as_deref())).collect::<Vec<_>>(), [("returned", GU, Some("file-changed"))]);
    }
    /// The second challenger's adoption has an Undo of its own: Undo it and nothing is used at Gonion (both kept).
    #[test] fn the_second_challengers_adoption_can_be_undone_too() {
        let (_t, mut l) = two_challengers();
        sync(&mut l, &pinned(), "Dr A").unwrap();
        undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap();
        let u = undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap();
        assert_eq!((u.kind.as_str(), u.model_id.as_str(), u.uses.clone()), ("undone", GU, None));
        assert_eq!(l.auto_best_events().unwrap().len(), 4, "no further adoption: no model is left with an offer");
        assert_eq!(uses_go(&l, &pinned()), None);
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty());
    }
    /// A carried Part F decline that hands Gonion to a second challenger records that adoption the same way.
    #[test] fn a_carried_decline_that_hands_the_point_to_a_second_challenger_records_its_adoption() {
        let (_t, mut l) = two_challengers();
        crate::best::answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        assert_eq!(carry_declines(&mut l, &pinned(), "Dr A").unwrap(), 1);
        assert_eq!(ev(&l).iter().map(|e| (e.1.as_str(), e.2.as_str())).collect::<Vec<_>>(), [("undone", SR), ("adopted", GU)]);
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty());
    }
    /// Fix round 1 (concern 2): "Use … again" takes back the Undo still in force at the point even when a second
    /// challenger was adopted after it. The `redone` row records what is used after it (SRPose), which supersedes GU2Net's
    /// adoption; GU2Net is then no longer used or tracked there. Positive control: `redo` reading only the point's latest
    /// row (as before) → "there is no Undo in force at Go".
    #[test] fn use_again_after_a_second_challenger_was_adopted_brings_the_first_back() {
        let (_t, mut l) = two_challengers();
        sync(&mut l, &pinned(), "Dr A").unwrap();
        undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap();
        let m = map(&l, &pinned(), true, true).unwrap();
        assert_eq!((m.uses.get("Go").map(String::as_str), m.kept.get("Go").map(|k| k.model_id.as_str())), (Some(GU), Some(SR)),
            "GU2Net in use, with \"Use SRPose again\" beside the Undo in force");
        let r = redo_now(&mut l, &pinned(), "Go", "Dr C").unwrap();
        assert_eq!((r.kind.as_str(), r.model_id.as_str(), r.uses.as_deref(), r.fingerprint.as_deref()), ("redone", SR, Some(SR), pinned().get(SR).map(String::as_str)));
        assert_eq!(ev(&l).iter().map(|e| (e.1.as_str(), e.2.as_str(), e.3.as_deref())).collect::<Vec<_>>(),
            [("adopted", SR, Some(SR)), ("undone", SR, Some(GU)), ("adopted", GU, Some(GU)), ("redone", SR, Some(SR))]);
        let m = map(&l, &pinned(), true, true).unwrap();
        assert_eq!(m.uses.get("Go").map(String::as_str), Some(SR));
        assert!(m.kept.get("Go").is_none(), "nothing left to Use again");
        assert_eq!(m.notes.get("Go").and_then(|n| n.since.clone()), Some(r.at.clone()), "SRPose's note dates from the Use again");
        assert_eq!(m.latest.last().map(|e| e.kind.as_str()), Some("redone"));
        assert!(sync(&mut l, &pinned(), "Dr A").unwrap().is_empty(), "the record already says what is used");
        let mut gu_changed = pinned(); gu_changed.insert(GU.into(), "fp-new".into());
        assert!(sync(&mut l, &gu_changed, "Dr A").unwrap().is_empty(), "GU2Net is no longer used at Go: its file is not tracked there");
        // When SRPose's file changes, its evidence starts afresh and GU2Net's offer is the verdict again: recorded as a
        // new adoption naming GU2Net's file, with its own note and Undo. (SRPose's file is on the `redone` row above.)
        let mut sr_changed = pinned(); sr_changed.insert(SR.into(), "fp-new".into());
        assert_eq!(sync(&mut l, &sr_changed, "Dr A").unwrap().iter().map(|e| (e.kind.as_str(), e.model_id.as_str(), e.fingerprint.as_deref())).collect::<Vec<_>>(),
            [("adopted", GU, pinned().get(GU).map(String::as_str))]);
    }
    /// An Undo whose model newer films have brought back is no longer "in force" for the screen: no "Use … again" is
    /// offered for the model already in use. Positive control: `undo_in_force` without its "not the model used now"
    /// filter → `kept` names SRPose here and this fails.
    #[test] fn an_undo_overtaken_by_newer_films_offers_no_use_again() {
        let (t, mut l, _) = library(60, 1.0, true);
        sync(&mut l, &pinned(), "Dr A").unwrap();
        undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap();
        add_films(t.path(), &mut l, 60, 60, 1.0, true);
        assert_eq!(sync(&mut l, &pinned(), "Dr A").unwrap().len(), 1, "control: SRPose adopted again on newer films");
        let m = map(&l, &pinned(), true, true).unwrap();
        assert_eq!((m.uses.get("Go").map(String::as_str), m.kept.get("Go")), (Some(SR), None));
        assert!(redo_now(&mut l, &pinned(), "Go", "Dr A").is_err(), "nothing to Use again");
    }
    /// Fix round 1 (concern 3): an Undo and the second challenger's adoption are one change: if the second row is refused,
    /// neither is written. The failure is injected with a temporary trigger. Positive control: write the two rows one by
    /// one, outside a transaction → the `undone` row is left behind and this fails.
    #[test] fn an_undo_and_the_second_adoption_are_written_together_or_not_at_all() {
        let (_t, mut l) = two_challengers();
        sync(&mut l, &pinned(), "Dr A").unwrap();
        l.conn_for_tests().execute_batch("CREATE TEMP TRIGGER inject BEFORE INSERT ON main.auto_best_events WHEN NEW.kind = 'adopted' AND NEW.model_id = 'gu2net-isbi19'
            BEGIN SELECT RAISE(ABORT, 'injected failure'); END;").unwrap();
        let e = undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap_err();
        assert!(format!("{e:#}").contains("injected failure"), "{e:#}");
        assert_eq!(ev(&l).iter().map(|e| e.1.as_str()).collect::<Vec<_>>(), ["adopted"], "neither row written");
        l.conn_for_tests().execute_batch("DROP TRIGGER temp.inject;").unwrap();
        undo_now(&mut l, &pinned(), "Go", "Dr B").unwrap();
        assert_eq!(ev(&l).len(), 3, "control: without the injected failure both rows are written");
    }

    /// Final review I3: an Undo names the change it undoes (its note's row). A stale note -- "Gonion now from SRPose"
    /// after Gonion was handed on to GU2Net -- is refused with a plain message and writes nothing; it never undoes GU2Net.
    /// The Undo returns every row it wrote, so the adoption it hands the point to can be shown as a note (spec §6a).
    /// Positive control: drop the "names the latest change" check in `undo` -> the stale Undo undoes GU2Net and this fails.
    #[test] fn an_undo_from_a_stale_note_is_refused_and_never_undoes_another_model() {
        let (_t, mut l) = two_challengers();
        let sr = sync(&mut l, &pinned(), "Dr A").unwrap().remove(0);
        let rows = undo(&mut l, &pinned(), "Go", sr.id, "Dr B").unwrap();
        assert_eq!(rows.iter().map(|e| (e.kind.as_str(), e.model_id.as_str())).collect::<Vec<_>>(), [("undone", SR), ("adopted", GU)],
            "the Undo returns the adoption it handed Gonion to");
        let n = l.auto_best_events().unwrap().len();
        let e = undo(&mut l, &pinned(), "Go", sr.id, "Dr B").unwrap_err().to_string();
        assert!(e.contains("That note is out of date"), "{e}");
        assert_eq!((l.auto_best_events().unwrap().len(), uses_go(&l, &pinned()).as_deref()), (n, Some(GU)), "nothing written; GU2Net still used");
        let gu = undo(&mut l, &pinned(), "Go", rows[1].id, "Dr B").unwrap();
        assert_eq!(gu.iter().map(|e| (e.kind.as_str(), e.model_id.as_str())).collect::<Vec<_>>(), [("undone", GU)], "control: GU2Net's own note undoes it");
    }
    /// The same check for a note older than a "returned": SRPose's note, then its file changed (Gonion back to Aariz).
    #[test] fn an_undo_of_a_note_followed_by_a_return_is_refused() {
        let (_t, mut l, _) = library(60, 1.0, true);
        let sr = sync(&mut l, &pinned(), "Dr A").unwrap().remove(0);
        let mut changed = pinned(); changed.insert(SR.into(), "fp-new".into());
        assert_eq!(sync(&mut l, &changed, "Dr A").unwrap()[0].kind, "returned");
        let e = undo(&mut l, &pinned(), "Go", sr.id, "Dr A").unwrap_err().to_string();
        assert!(e.contains("That note is out of date"), "{e}");
        assert_eq!(l.auto_best_events().unwrap().len(), 2);
    }

    /// Follow-up round (re-review, Important): "Use … again" names the Undo it takes back. Stacked Undos at Gonion (SRPose
    /// undone, handing it to GU2Net; then GU2Net undone): the Undo in force is GU2Net's. A stale "Use SRPose again"
    /// naming SRPose's Undo is refused in plain words and writes nothing; it never brings back GU2Net under SRPose's
    /// name. Positive control: drop the "names the Undo in force" check in `redo` -> the stale press restores GU2Net and
    /// this fails.
    #[test] fn a_use_again_naming_an_undo_no_longer_in_force_is_refused() {
        let (_t, mut l) = two_challengers();
        let sr = sync(&mut l, &pinned(), "Dr A").unwrap().remove(0);
        let u1 = undo(&mut l, &pinned(), "Go", sr.id, "Dr B").unwrap();
        let u2 = undo(&mut l, &pinned(), "Go", u1[1].id, "Dr B").unwrap().remove(0);
        assert_eq!((u1[0].model_id.as_str(), u2.model_id.as_str()), (SR, GU));
        let n = l.auto_best_events().unwrap().len();
        let e = redo(&mut l, &pinned(), "Go", u1[0].id, "Dr C").unwrap_err().to_string();
        assert!(e.contains("That button is out of date"), "{e}");
        assert_eq!((l.auto_best_events().unwrap().len(), uses_go(&l, &pinned())), (n, None), "nothing written; nothing used");
        let r = redo(&mut l, &pinned(), "Go", u2.id, "Dr C").unwrap();
        assert_eq!((r.kind.as_str(), r.model_id.as_str()), ("redone", GU), "control: the Undo in force is taken back");
    }
}
