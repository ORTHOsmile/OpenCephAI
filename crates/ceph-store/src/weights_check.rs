//! Format 14 (Part F, owner Q4): the weights check's results. When a model's file changes, its new file is run on the
//! older films its earlier file measured (apps/desktop/src-tauri/src/weights_check.rs); each film is recorded once per
//! new file, with its points. Never read by the learning record or by the rule.
use crate::library::{Library, NOW};
use rusqlite::params;
use serde::{Deserialize, Serialize};

/// One film's outcome: `measured` (points below), `nothing-to-check` (no point on it qualified, so nothing was run) or
/// `failed` (`detail` says why).
pub struct CheckFilm<'a> { pub model_id: &'a str, pub fingerprint: &'a str, pub case_id: &'a str, pub outcome: &'a str, pub detail: &'a str }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightsCheckFilm { pub case_id: String, pub outcome: String, pub detail: String, pub ran_at: String, pub deleted: bool }
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeightsCheckRow { pub case_id: String, pub landmark_id: String, pub old_mm: f64, pub new_mm: Option<f64> }

impl Library {
    /// One film of a weights check and its points (landmark, earlier file's mm, new file's mm or None), in one
    /// transaction. A distance that is not a finite number ≥ 0 refuses the whole film: NaN would bind as NULL and read
    /// as "the new file gave no point".
    pub fn add_weights_check(&mut self, f: &CheckFilm, points: &[(String, f64, Option<f64>)]) -> anyhow::Result<()> {
        let ok = |d: f64| d.is_finite() && d >= 0.0;
        for (lm, old, new) in points { anyhow::ensure!(ok(*old) && new.map_or(true, ok), "weights check, {lm}: a distance is not a number ≥ 0"); }
        let tx = self.conn.transaction()?;
        tx.execute(&format!("INSERT INTO weights_check_films (model_id, fingerprint, case_id, outcome, detail, ran_at) VALUES (?1, ?2, ?3, ?4, ?5, {NOW})"),
            params![f.model_id, f.fingerprint, f.case_id, f.outcome, f.detail])?;
        {
            let mut st = tx.prepare("INSERT INTO weights_check (model_id, fingerprint, case_id, landmark_id, old_mm, new_mm) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")?;
            for (lm, old, new) in points { st.execute(params![f.model_id, f.fingerprint, f.case_id, lm, old, new])?; }
        }
        tx.commit()?;
        Ok(())
    }
    /// Every film checked for this model file, films in Recently deleted included and marked (so a restore never runs one again).
    pub fn weights_check_films(&self, model_id: &str, fingerprint: &str) -> anyhow::Result<Vec<WeightsCheckFilm>> {
        Ok(self.conn.prepare("SELECT w.case_id, w.outcome, w.detail, w.ran_at, c.deleted_at IS NOT NULL
            FROM weights_check_films w JOIN cases c ON c.id = w.case_id WHERE w.model_id = ?1 AND w.fingerprint = ?2 ORDER BY w.case_id")?
            .query_map(params![model_id, fingerprint], |r| Ok(WeightsCheckFilm { case_id: r.get(0)?, outcome: r.get(1)?, detail: r.get(2)?,
                ran_at: r.get(3)?, deleted: r.get(4)? }))?
            .collect::<Result<_, _>>()?)
    }
    /// The points measured for this model file, films in Recently deleted left out.
    pub fn weights_check_rows(&self, model_id: &str, fingerprint: &str) -> anyhow::Result<Vec<WeightsCheckRow>> {
        Ok(self.conn.prepare("SELECT w.case_id, w.landmark_id, w.old_mm, w.new_mm FROM weights_check w JOIN cases c ON c.id = w.case_id
            WHERE w.model_id = ?1 AND w.fingerprint = ?2 AND c.deleted_at IS NULL ORDER BY w.case_id, w.landmark_id")?
            .query_map(params![model_id, fingerprint], |r| Ok(WeightsCheckRow { case_id: r.get(0)?, landmark_id: r.get(1)?, old_mm: r.get(2)?, new_mm: r.get(3)? }))?
            .collect::<Result<_, _>>()?)
    }
}

#[cfg(test)]
mod tests {
    use crate::{CheckFilm, Library};
    const SR: &str = "srpose-cldet23";
    fn lib() -> (tempfile::TempDir, Library, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        let png = t.path().join("SYNTHETIC.png");
        image::GrayImage::new(64, 64).save(&png).unwrap();
        let id = l.import(&png).unwrap().case_id;
        (t, l, id)
    }
    fn film<'a>(case_id: &'a str, fingerprint: &'a str, outcome: &'a str, detail: &'a str) -> CheckFilm<'a> {
        CheckFilm { model_id: SR, fingerprint, case_id, outcome, detail }
    }
    #[test] fn a_checked_film_and_its_points_are_kept_per_model_file() {
        let (_t, mut l, id) = lib();
        l.add_weights_check(&film(&id, "fp-new", "measured", ""), &[("Go".into(), 1.0, Some(1.2)), ("S".into(), 0.5, None)]).unwrap();
        let rows = l.weights_check_rows(SR, "fp-new").unwrap();
        assert_eq!(rows.iter().map(|r| (r.landmark_id.as_str(), r.old_mm, r.new_mm)).collect::<Vec<_>>(), [("Go", 1.0, Some(1.2)), ("S", 0.5, None)]);
        let films = l.weights_check_films(SR, "fp-new").unwrap();
        assert_eq!(films.iter().map(|f| (f.case_id.as_str(), f.outcome.as_str(), f.deleted)).collect::<Vec<_>>(), [(id.as_str(), "measured", false)]);
        assert!(l.weights_check_rows(SR, "fp-other").unwrap().is_empty(), "another file's check is separate");
        assert!(l.weights_check_rows("gu2net-isbi19", "fp-new").unwrap().is_empty(), "another model's check is separate");
    }
    #[test] fn a_refused_point_writes_nothing_for_that_film() {
        let (_t, mut l, id) = lib();
        for bad in [f64::NAN, -1.0, f64::INFINITY] {
            assert!(l.add_weights_check(&film(&id, "fp", "measured", ""), &[("Go".into(), 1.0, Some(1.0)), ("S".into(), 1.0, Some(bad))]).is_err(), "new {bad}");
            assert!(l.add_weights_check(&film(&id, "fp", "measured", ""), &[("Go".into(), bad, Some(1.0))]).is_err(), "old {bad}");
        }
        assert!(l.add_weights_check(&film(&id, "fp", "maybe", ""), &[]).is_err(), "an unknown outcome");
        assert!(l.weights_check_films(SR, "fp").unwrap().is_empty() && l.weights_check_rows(SR, "fp").unwrap().is_empty());
    }
    #[test] fn a_film_with_nothing_to_check_or_that_failed_is_kept_without_points_and_never_checked_twice() {
        let (t, mut l, a) = lib();
        let png = t.path().join("SYNTHETIC-2.png");
        image::GrayImage::new(64, 65).save(&png).unwrap();
        let b = l.import(&png).unwrap().case_id;
        l.add_weights_check(&film(&a, "fp", "nothing-to-check", ""), &[]).unwrap();
        l.add_weights_check(&film(&b, "fp", "failed", "SRPose took longer than 15 s on this film"), &[]).unwrap();
        assert!(l.add_weights_check(&film(&b, "fp", "measured", ""), &[]).is_err(), "a film is checked once per model file");
        let f = l.weights_check_films(SR, "fp").unwrap();
        assert_eq!(f.len(), 2);
        assert!(f.iter().any(|x| x.outcome == "failed" && x.detail == "SRPose took longer than 15 s on this film"));
        assert!(l.weights_check_rows(SR, "fp").unwrap().is_empty());
    }
    #[test] fn a_film_in_recently_deleted_is_left_out_of_the_numbers_and_emptying_it_removes_its_check() {
        let (_t, mut l, id) = lib();
        l.add_weights_check(&film(&id, "fp", "measured", ""), &[("Go".into(), 1.0, Some(1.2))]).unwrap();
        l.delete(&id).unwrap();
        assert!(l.weights_check_rows(SR, "fp").unwrap().is_empty(), "left out of the numbers");
        assert!(l.weights_check_films(SR, "fp").unwrap()[0].deleted, "still known as checked, so a restore does not run it again");
        l.restore(&id).unwrap();
        assert_eq!(l.weights_check_rows(SR, "fp").unwrap().len(), 1, "restored: counted again");
        l.delete(&id).unwrap();
        l.purge_deleted(0).unwrap();
        assert!(l.weights_check_films(SR, "fp").unwrap().is_empty() && l.weights_check_rows(SR, "fp").unwrap().is_empty(), "emptied with the film");
    }
}
