//! Part F, "Best model per point" (chain spec §6 S1): reads the
//! learning record, each film's scale now and the owner's answers, runs the rule (`ceph_model::best::decide`,
//! best-point/4), and records an answer only when the rule offers that switch at that moment (the screen's numbers are
//! never trusted).
use ceph_model::best::{self, Action, Decision, FilmKey, Files, PointVerdict, RecordRow, Tier};
use ceph_model::fingerprint::{earlier_films, normalise};
use ceph_model::source::ChoiceNote;
use ceph_store::{FilmScale, LearningFilmRow, Library, NewPointChoice, PointChoice, ScaleSource};
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet};

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BestPerPoint { pub rule_version: String, pub points: Vec<PointVerdict>, pub choices: Vec<PointChoice>, pub checks: Vec<crate::weights_check::ModelCheck> }

fn decisions(choices: &[PointChoice]) -> anyhow::Result<Vec<Decision>> {
    choices.iter().map(|c| {
        let action = match c.action.as_str() { "accepted" => Action::Accepted, "declined" => Action::Declined, "undone" => Action::Undone,
            a => anyhow::bail!("unknown answer {a:?} in the library") };
        let last_film = match (&c.last_imported_at, &c.last_case_id) {
            (Some(i), Some(id)) => Some(FilmKey { imported_at: i.clone(), case_id: id.clone() }), _ => None };
        Ok(Decision { landmark_id: c.landmark_id.clone(), model_id: c.model_id.clone(), action, last_film })
    }).collect()
}

fn tier(s: ScaleSource) -> Tier { match s { ScaleSource::Ruler => Tier::Ruler, ScaleSource::Machine => Tier::Machine, ScaleSource::Fit => Tier::Fit, ScaleSource::Assumed => Tier::Assumed } }

/// Which model files count (owner Q9): `current`, each installed model's file now (`models::installed_fingerprints`),
/// and every film an earlier file ran on, from the stored runs.
pub fn files(l: &Library, current: &BTreeMap<String, String>) -> anyhow::Result<Files> {
    Ok(Files { current: current.clone(), earlier: earlier_films(current, &l.run_fingerprints()?) })
}

/// The rule's input rows (owner rule, 26 Oct; Task 5 carry): each row's raw pixel distance `dist_px` with its film's
/// scale NOW and that scale's source, from `scales` (`Library::film_scales`: ruler → machine → fit → assumed). Never
/// the stored `dist_mm` (ruler, else 0.1 mm per px: its old meaning) and never the row's stored scale (the scale when
/// the row was written). A row whose film has no scale entry is left out, and its film returned (never happens: both
/// reads leave out Recently deleted).
fn record_rows(all: Vec<LearningFilmRow>, scales: &BTreeMap<String, FilmScale>) -> (Vec<RecordRow>, BTreeSet<String>) {
    let mut no_scale = BTreeSet::new();
    let rows = all.into_iter().filter_map(|f| {
        let Some(s) = scales.get(&f.case_id) else { no_scale.insert(f.case_id); return None };
        let fingerprint = normalise(&f.row.model_id, f.row.model_sha256.as_deref());
        Some(RecordRow { case_id: f.case_id, imported_at: f.imported_at, landmark_id: f.row.landmark_id, model_id: f.row.model_id,
            dist_px: f.row.dist_px, mm_per_px: s.mm_per_px, tier: tier(s.source), fine_tuned: s.fine_tuned, how: f.row.how, placer: f.row.placer, fingerprint })
    }).collect();
    (rows, no_scale)
}

/// The rule's verdict for each of the 19 points with `decisions` as the answers (Part F's own, or Automatic best's Undos),
/// judged against `base` (spec 2026-10-29 §3).
pub(crate) fn verdicts_for(l: &Library, current: &BTreeMap<String, String>, decisions: &[Decision], base: &str) -> anyhow::Result<Vec<PointVerdict>> {
    let scales = l.film_scales(ceph_infer::crosscheck::params().assumed_mm_per_px)?;
    let (rows, no_scale) = record_rows(l.learning_rows_all()?, &scales);
    if !no_scale.is_empty() { eprintln!("Part F: {} film(s) had learning rows but no scale (left out): {:?}", no_scale.len(), no_scale); }
    let ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    let catalogue: Vec<&str> = ids.iter().map(String::as_str).collect();
    Ok(best::decide(&ceph_model::scores::ORIGINAL_19, &catalogue, &rows, decisions, &files(l, current)?, base))
}

/// The rule's verdict for each of the 19 original points, and every answer given so far. Each row's distance is its raw
/// pixel distance; its film's scale is read now (`film_scales`), so a machine scale or a fit set later counts at once.
pub fn verdicts(l: &Library, current: &BTreeMap<String, String>) -> anyhow::Result<BestPerPoint> {
    let choices = l.point_choices()?;
    let d = decisions(&choices)?;
    let checks = crate::weights_check::checks(l, current, &best::current_choices(&d))?;
    let base = crate::auto_best::base_of(l)?;
    Ok(BestPerPoint { rule_version: best::RULE_VERSION.into(), points: verdicts_for(l, current, &d, &base)?, choices, checks })
}

/// The switches in force, point → model, for placement (`models_main_point_source`), and each one's note: the date of
/// the acceptance in force and the words of the films that decided it.
pub fn owner_choices(l: &Library) -> anyhow::Result<(BTreeMap<String, String>, BTreeMap<String, ChoiceNote>)> {
    let choices = l.point_choices()?;
    let in_force = best::current_choices(&decisions(&choices)?);
    let mut notes = BTreeMap::new();
    for c in choices.iter().filter(|c| c.action == "accepted" && in_force.get(&c.landmark_id) == Some(&c.model_id)) {
        notes.insert(c.landmark_id.clone(), ChoiceNote { since: c.at.clone(), basis: c.basis.clone().unwrap_or_default() });   // the latest acceptance wins
    }
    Ok((in_force, notes))
}

/// "accept" or "decline" the offer the rule makes for this point right now, or "undo" the switch in force.
pub fn answer(l: &mut Library, current: &BTreeMap<String, String>, landmark_id: &str, model_id: &str, answer: &str, operator: &str) -> anyhow::Result<()> {
    let now = verdicts(l, current)?;
    let p = now.points.iter().find(|p| p.landmark_id == landmark_id).ok_or_else(|| anyhow::anyhow!("{landmark_id} is not one of the 19 points"))?;
    match answer {
        "accept" | "decline" => {
            anyhow::ensure!(p.offer.as_deref() == Some(model_id), "there is no offer to switch {landmark_id} to {model_id} now");
            let pair = p.pairs.iter().find(|x| x.model_id == model_id).ok_or_else(|| anyhow::anyhow!("no numbers for {model_id}"))?;
            let best::PairVerdict::Offer { check, .. } = &pair.verdict else { anyhow::bail!("there is no offer to switch {landmark_id} to {model_id} now") };
            let basis = pair.basis.ok_or_else(|| anyhow::anyhow!("no scale group decided {landmark_id}"))?;
            let words = best::basis_words(basis, pair.films);
            let numbers = crate::auto_best::with_base(serde_json::to_value(pair)?, &crate::auto_best::base_of(l)?, current);
            l.add_point_choice(&NewPointChoice { landmark_id, model_id, action: if answer == "accept" { "accepted" } else { "declined" },
                rule_version: best::RULE_VERSION, last_film: Some((&check.last.imported_at, &check.last.case_id)), basis: Some(&words), numbers: &numbers }, operator)?;
        }
        "undo" => {
            let base = crate::auto_best::base_of(l)?;
            anyhow::ensure!(model_id != base && p.current == model_id, "{landmark_id} is not switched to {model_id}");
            l.add_point_choice(&NewPointChoice { landmark_id, model_id, action: "undone", rule_version: best::RULE_VERSION, last_film: None, basis: None,
                numbers: &crate::auto_best::with_base(serde_json::json!({}), &base, current) }, operator)?;
        }
        other => anyhow::bail!("unknown answer {other:?}"),
    }
    Ok(())
}

/// Each installed model's file now (Task 3), read afresh on every call: a model installed, removed or updated since
/// the last call is seen at once.
fn current(app: &tauri::AppHandle) -> Result<BTreeMap<String, String>, String> { Ok(crate::models::installed_fingerprints(&crate::models::root(app)?)) }

#[tauri::command]
pub async fn models_best_per_point(app: tauri::AppHandle) -> Result<BestPerPoint, String> {
    let cur = current(&app)?;
    crate::library::with(&app, move |l, _| verdicts(l, &cur)).await
}

#[tauri::command]
pub async fn models_point_choice(app: tauri::AppHandle, landmark_id: String, model_id: String, answer: String) -> Result<(), String> {
    let cur = current(&app)?;
    crate::library::with(&app, move |l, op| self::answer(l, &cur, &landmark_id, &model_id, &answer, op)).await
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use ceph_store::LearningRow;
    const SR: &str = "srpose-cldet23";
    /// A library of `n` synthetic films imported in order, each with a learning record for Gonion: every fifth accepted
    /// unmoved (Aariz 0, SRPose 1), the rest moved, SRPose `gain` closer. `ruler`: each film calibrated at exactly 1 mm
    /// per px (100 mm over 100 px), so a pixel distance is the same number in mm; else no ruler (the assumed 0.1).
    pub(crate) fn library(n: usize, gain: f64, ruler: bool) -> (tempfile::TempDir, Library, Vec<String>) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        let ids = add_films(t.path(), &mut l, 0, n, gain, ruler);
        (t, l, ids)
    }
    /// The body of `library`'s import loop, for films `from..from + n` (Task 3: shared with Task 4's tests).
    pub(crate) fn add_films(t: &std::path::Path, l: &mut Library, from: usize, n: usize, gain: f64, ruler: bool) -> Vec<String> {
        let mut ids = vec![];
        for i in from..from + n {
            let png = t.join(format!("SYNTHETIC-{i}.png"));
            image::GrayImage::new(16, 16 + i as u32).save(&png).unwrap();
            let id = l.import(&png).unwrap().case_id;
            l.conn_for_tests().execute("UPDATE cases SET created_at = ?2 WHERE id = ?1",
                rusqlite::params![id, format!("2026-01-01T{:02}:{:02}:00.000Z", i / 60, i % 60)]).unwrap();
            if ruler { l.calibrate(&id, (0.0, 0.0), (100.0, 0.0), 100.0, "Dr A").unwrap(); }
            let (how, az, sr) = if i % 5 == 0 { ("accepted-unmoved", 0.0, 1.0) } else { let az = 1.5 + 0.05 * (i % 30) as f64; ("moved", az, (az - gain).max(0.0)) };
            let row = |m: &str, d: f64, placer: bool| LearningRow { landmark_id: "Go".into(), model_id: m.into(), model_sha256: None,
                execution_provider: "cpu".into(), dist_px: if ruler { d } else { d * 10.0 }, dist_mm: d, mm_assumed: !ruler, machine: "unknown".into(),
                how: how.into(), placer, mm_per_px: None, scale_source: None };
            l.replace_learning(&id, &[row(best::DEFAULT_BASE, az, true), row(SR, sr, false)], "Dr A").unwrap();
            ids.push(id);
        }
        ids
    }
    /// The files installed when every model is the one its catalogue pinned before Part F (the rows above store no
    /// file, as a library made before schema 10 would, and read as these).
    pub(crate) fn pinned() -> BTreeMap<String, String> {
        ceph_model::fingerprint::BEFORE_13.iter().map(|b| (b.model_id.to_string(), b.fingerprint.to_string())).collect()
    }
    fn go_with(l: &Library, current: &BTreeMap<String, String>) -> PointVerdict {
        verdicts(l, current).unwrap().points.into_iter().find(|p| p.landmark_id == "Go").unwrap()
    }
    fn go(l: &Library) -> PointVerdict { go_with(l, &pinned()) }

    #[test] fn sixty_films_offer_go_to_srpose_and_nothing_switches_by_itself() {
        let (_t, l, _) = library(60, 1.0, true);
        let b = verdicts(&l, &pinned()).unwrap();
        assert_eq!((b.rule_version.as_str(), b.points.len(), b.choices.len()), ("best-point/4", 19, 0));
        assert!(b.checks.is_empty(), "no model file changed: no weights check");
        let g = go(&l);
        assert_eq!((g.offer.as_deref(), g.offer_basis, g.current.as_str()), (Some(SR), Some(best::Tier::Ruler), best::DEFAULT_BASE));
        assert!(owner_choices(&l).unwrap().0.is_empty(), "an offer never switches by itself");
    }
    #[test] fn accept_stores_the_numbers_and_the_basis_and_switches_go_and_undo_switches_it_back() {
        let (_t, mut l, _) = library(60, 1.0, true);
        answer(&mut l, &pinned(), "Go", SR, "accept", "Dr A").unwrap();
        let (choices, notes) = owner_choices(&l).unwrap();
        assert_eq!(choices, BTreeMap::from([("Go".to_string(), SR.to_string())]));
        assert_eq!(notes["Go"].basis, "mm, 60 ruler films");
        let c = l.point_choices().unwrap().remove(0);
        assert_eq!((c.action.as_str(), c.operator.as_str(), c.rule_version.as_str(), c.last_imported_at.as_deref(), c.basis.as_deref()),
            ("accepted", "Dr A", "best-point/4", Some("2026-01-01T00:59:00.000Z"), Some("mm, 60 ruler films")));
        assert_eq!(notes["Go"].since, c.at);
        assert_eq!((c.numbers["verdict"]["kind"].as_str(), c.numbers["verdict"]["check"]["challengerMedianMm"].as_f64(), c.numbers["basis"].as_str()),
            (Some("offer"), Some(1.075), Some("ruler")));
        let g = go(&l);
        assert_eq!((g.current.as_str(), g.offer.clone()), (SR, None));
        answer(&mut l, &pinned(), "Go", SR, "undo", "Dr A").unwrap();
        assert!(owner_choices(&l).unwrap().0.is_empty() && owner_choices(&l).unwrap().1.is_empty());
        assert_eq!(l.point_choices().unwrap().len(), 2, "the undo is a new row; the acceptance stays on record");
    }
    #[test] fn decline_is_recorded_and_the_offer_goes() {
        let (_t, mut l, _) = library(60, 1.0, true);
        answer(&mut l, &pinned(), "Go", SR, "decline", "Dr A").unwrap();
        let g = go(&l);
        assert_eq!((g.offer.clone(), g.current.as_str()), (None, best::DEFAULT_BASE));
        assert!(owner_choices(&l).unwrap().0.is_empty());
    }
    #[test] fn an_answer_with_no_offer_behind_it_is_refused_and_writes_nothing() {
        let (_t, mut short, _) = library(59, 1.0, true);
        assert!(answer(&mut short, &pinned(), "Go", SR, "accept", "Dr A").is_err(), "re-check one film short");
        let (_t2, mut equal, _) = library(60, 0.0, true);
        for (lm, a) in [("Go", "accept"), ("Go", "decline"), ("Go", "undo"), ("Go", "maybe"), ("Co", "accept")] {
            assert!(answer(&mut equal, &pinned(), lm, SR, a, "Dr A").is_err(), "{lm} {a}");
        }
        assert!(short.point_choices().unwrap().is_empty() && equal.point_choices().unwrap().is_empty());
    }
    /// Two models beat Aariz on Gonion: SRPose (1 mm closer) and GU2Net (0.5 mm closer). The rule offers one model per
    /// point, the better (SRPose); GU2Net's own pair passes too, but there is no offer to switch to it, so accepting or
    /// declining it is refused and nothing is written. (The `ensure!(p.offer …)` guard is what refuses it: the pair's
    /// own verdict is an offer, so without that guard GU2Net would be switched in.)
    #[test] fn only_the_one_model_the_rule_offers_can_be_accepted() {
        const GU: &str = "gu2net-isbi19";
        let (_t, mut l, ids) = library(60, 1.0, true);
        for id in &ids {
            let mut rows = l.learning_rows(id).unwrap();
            let az = rows.iter().find(|r| r.model_id == best::DEFAULT_BASE).unwrap().clone();
            rows.push(LearningRow { model_id: GU.into(), placer: false, dist_px: if az.how == "accepted-unmoved" { 1.0 } else { az.dist_px - 0.5 },
                dist_mm: if az.how == "accepted-unmoved" { 1.0 } else { az.dist_mm - 0.5 }, ..az });
            l.replace_learning(id, &rows, "Dr A").unwrap();
        }
        let g = go(&l);
        let offered: Vec<&str> = g.pairs.iter().filter(|p| matches!(p.verdict, best::PairVerdict::Offer { .. })).map(|p| p.model_id.as_str()).collect();
        assert_eq!((offered.len(), g.offer.as_deref()), (2, Some(SR)), "both pairs pass; SRPose is the one offered: {offered:?}");
        for a in ["accept", "decline"] { assert!(answer(&mut l, &pinned(), "Go", GU, a, "Dr A").is_err(), "{a} GU2Net"); }
        assert!(l.point_choices().unwrap().is_empty());
        answer(&mut l, &pinned(), "Go", SR, "accept", "Dr A").unwrap();
        assert_eq!(owner_choices(&l).unwrap().0["Go"], SR);
    }
    #[test] fn a_film_in_recently_deleted_is_not_counted() {
        let (_t, mut l, ids) = library(60, 1.0, true);
        l.delete(&ids[59]).unwrap();
        let g = go(&l);
        assert_eq!(g.offer, None);
        assert!(matches!(g.pairs[0].verdict, best::PairVerdict::ReCheck { films: 29, .. }));
    }
    /// Owner E1, E4 (26 Oct): with no ruler on any film, the assumed group decides (60 ≥ 20), and the answer's record
    /// says the millimetres are an estimate.
    #[test] fn with_no_ruler_the_assumed_group_decides_and_the_record_says_estimate() {
        let (_t, mut l, _) = library(60, 1.0, false);
        let g = go(&l);
        assert_eq!((g.offer.as_deref(), g.offer_basis, g.films_by_scale.assumed), (Some(SR), Some(best::Tier::Assumed), 60));
        answer(&mut l, &pinned(), "Go", SR, "accept", "Dr A").unwrap();
        assert_eq!(l.point_choices().unwrap()[0].basis.as_deref(), Some("mm via assumed scale (an estimate), 60 films"));
    }
    /// Owner Q9: a new SRPose file. Its earlier marks stop counting (left out, and counted), so nothing is offered; a
    /// film its earlier file ran on is found from the stored runs, and is not "earlier" while the pinned file is current.
    #[test] fn a_new_srpose_file_starts_afresh_and_the_films_its_earlier_file_ran_on_are_found() {
        let (_t, mut l, ids) = library(60, 1.0, true);
        let mut current = pinned();
        current.insert(SR.into(), "fp-new".into());
        let g = go_with(&l, &current);
        assert_eq!((g.pairs[0].films, g.pairs[0].left_out_earlier_file, g.offer.clone()), (0, 60, None));
        let run = ceph_store::AiRun { model_id: SR.into(), execution_provider: "cpu".into(), facing: "right".into(), total_ms: 1.0,
            model_sha256: Some(ceph_model::fingerprint::BEFORE_13[2].recorded.into()) };   // SRPose's network-file hash, as stored before Part F
        l.record_ai_run(&ids[0], &run, &[]).unwrap();
        assert_eq!(files(&l, &current).unwrap().earlier, std::collections::BTreeSet::from([(ids[0].clone(), SR.to_string())]));
        assert!(files(&l, &pinned()).unwrap().earlier.is_empty(), "the pinned file is still current: nothing earlier");
    }

    /// Task 5 carry (owner rule, 26 Oct): a film's distance is its raw pixel distance times the film's scale NOW
    /// (`Library::film_scales`), never the learning record's `dist_mm`, which keeps its old meaning (ruler, else 0.1 mm
    /// per px). Sixty films with no ruler, each on an X-ray machine whose calibrated scale is 0.15 mm per px; the rows
    /// store no scale (as before format 14), so only the film's scale now can say "machine". SRPose is 2.5 px closer
    /// than Aariz on every film: 2.5 × 0.15 = 0.375 mm, an offer (0.3 needed). Read through `dist_mm` (px × 0.1) the
    /// same gain is 0.25 mm and nothing is offered; passed as `dist_px` it is 0.0375 mm. Either swap fails here.
    #[test] fn a_machine_scaled_film_counts_its_pixels_times_the_machine_scale_never_dist_mm() {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        l.conn_for_tests().execute("INSERT INTO layout_machines (id, name, named_by_user, width, height, created_at, updated_at, spacing_mm, width_px, height_px, scale_source, scale_set_at)
            VALUES ('m1', 'Demo Radiology', 1, 64, 64, 'x', 'x', 0.15, 64, 64, 'entered', '2026-10-27T00:00:00.000Z')", []).unwrap();
        for i in 0..60u8 {
            let png = t.path().join(format!("SYNTHETIC-{i}.png"));
            image::GrayImage::from_pixel(64, 64, image::Luma([i])).save(&png).unwrap();
            let id = l.import(&png).unwrap().case_id;
            l.conn_for_tests().execute("UPDATE cases SET created_at = ?2, layout_machine_id = 'm1' WHERE id = ?1",
                rusqlite::params![id, format!("2026-01-01T00:{:02}:00.000Z", i)]).unwrap();
            let az = 10.0 + 0.2 * (i % 30) as f64;
            let row = |m: &str, px: f64, placer: bool| LearningRow { landmark_id: "Go".into(), model_id: m.into(), model_sha256: None,
                execution_provider: "cpu".into(), dist_px: px, dist_mm: px * 0.1, mm_assumed: true, machine: "m1".into(),
                how: "moved".into(), placer, mm_per_px: None, scale_source: None };
            l.replace_learning(&id, &[row(best::DEFAULT_BASE, az, true), row(SR, az - 2.5, false)], "Dr A").unwrap();
        }
        // The instrument: every film really is on its machine's scale now (else this test proves nothing).
        let scales = l.film_scales(0.1).unwrap();
        assert_eq!(scales.len(), 60);
        assert!(scales.values().all(|s| (s.mm_per_px, s.source) == (0.15, ScaleSource::Machine)), "{scales:?}");
        let g = go(&l);
        assert_eq!((g.offer.as_deref(), g.offer_basis, g.films_by_scale.machine, g.films_by_scale.assumed), (Some(SR), Some(best::Tier::Machine), 60, 0));
        let best::PairVerdict::Offer { check, .. } = &g.pairs[0].verdict else { panic!("{:?}", g.pairs[0].verdict) };
        // Films 30–59: Aariz 10.0 … 15.8 px, median 12.9 px = 1.935 mm; SRPose 10.4 px = 1.56 mm.
        assert!((check.incumbent_median_mm - 1.935).abs() < 1e-9 && (check.challenger_median_mm - 1.56).abs() < 1e-9,
            "{} {}", check.incumbent_median_mm, check.challenger_median_mm);
        answer(&mut l, &pinned(), "Go", SR, "accept", "Dr A").unwrap();
        assert_eq!(l.point_choices().unwrap()[0].basis.as_deref(), Some("mm via machine scale, 60 films"));
    }

    /// A learning row whose film has no scale entry never happens (both reads leave out Recently deleted); if it does,
    /// the row is left out and its film is named, never counted at some other scale. Each kept row carries the raw
    /// pixel distance (never `dist_mm`), the film's scale and its source, and the file read through `normalise`.
    #[test] fn a_row_whose_film_has_no_scale_is_left_out_and_named() {
        let film = |c: &str, model_sha256: Option<&str>| ceph_store::LearningFilmRow { case_id: c.into(), imported_at: "t".into(), row: LearningRow {
            landmark_id: "Go".into(), model_id: SR.into(), model_sha256: model_sha256.map(str::to_string), execution_provider: "cpu".into(),
            dist_px: 8.0, dist_mm: 0.8, mm_assumed: true, machine: "unknown".into(), how: "moved".into(), placer: false, mm_per_px: None, scale_source: None } };
        let scales = BTreeMap::from([("a".to_string(), ceph_store::FilmScale { mm_per_px: 0.15, source: ScaleSource::Machine, fine_tuned: false })]);
        let (rows, missing) = record_rows(vec![film("a", None), film("b", None), film("b", None)], &scales);
        assert_eq!(missing, BTreeSet::from(["b".to_string()]));
        assert_eq!(rows.len(), 1);
        let r = &rows[0];
        assert_eq!((r.case_id.as_str(), r.dist_px, r.mm_per_px, r.tier, r.fingerprint.as_deref()),
            ("a", 8.0, 0.15, best::Tier::Machine, Some(ceph_model::fingerprint::BEFORE_13[2].fingerprint)));
        let (none, missing) = record_rows(vec![], &scales);
        assert!(none.is_empty() && missing.is_empty());
    }

    /// Choices that cannot be read: placement falls back to the built-in table (logged), as before Part F.
    #[test] fn choices_that_cannot_be_read_leave_the_built_in_table() {
        let (_t, mut l, _) = library(60, 1.0, true);
        answer(&mut l, &pinned(), "Go", SR, "accept", "Dr A").unwrap();
        let read = |l: &Library| owner_choices(l).map_err(|e| format!("{e:#}"));
        let s = crate::models::with_owner_choices(ceph_model::source::main_point_source(), read(&l));
        assert_eq!(s.owner_choices, BTreeMap::from([("Go".to_string(), SR.to_string())]));
        assert_eq!(s.owner_choice_notes["Go"].basis, "mm, 60 ruler films");
        l.conn_for_tests().execute_batch("DROP TABLE point_choices").unwrap();
        assert!(read(&l).is_err());
        assert_eq!(crate::models::with_owner_choices(ceph_model::source::main_point_source(), read(&l)), ceph_model::source::main_point_source());
    }
    /// Q1 and spec §7: Automatic best's own Undos never reach Part F's table: with an Undo recorded for Go, Part F still
    /// offers SRPose and lists no answer. Positive control: make `decisions` in `verdicts` also read `l.auto_best_events()`
    /// as declines → this fails.
    #[test] fn automatic_best_undos_never_steer_part_f() {
        let (_t, mut l, _) = library(60, 1.0, true);
        l.add_auto_best_event(&ceph_store::NewAutoBestEvent { landmark_id: "Go".into(), kind: "undone".into(), model_id: SR.into(), fingerprint: Some("fp".into()),
            uses: None, last_film: Some(("2026-01-01T00:59:00.000Z".into(), "c059".into())), basis: Some("mm, 60 ruler films".into()), reason: None,
            numbers: serde_json::json!({}), rule_version: best::RULE_VERSION.into() }, "Dr A").unwrap();
        let b = verdicts(&l, &pinned()).unwrap();
        assert_eq!(go(&l).offer.as_deref(), Some(SR));
        assert!(b.choices.is_empty() && owner_choices(&l).unwrap().0.is_empty());
        assert!(b.points.iter().all(|p| p.pairs.iter().all(|x| x.model_id != ceph_store::AUTO_BEST)), "Automatic best is never a contestant");
    }
}
