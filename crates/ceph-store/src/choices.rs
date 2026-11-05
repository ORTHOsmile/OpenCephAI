//! Format 14 (Part F): the owner's answers to "Best model per point" offers. Append-only; the rule
//! (ceph_model::best) reads them back oldest first.
use crate::library::{Library, NOW};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointChoice {
    pub id: i64, pub landmark_id: String, pub model_id: String, pub action: String, pub rule_version: String,
    pub last_imported_at: Option<String>, pub last_case_id: Option<String>,
    /// The films that decided, in words ("mm, 60 ruler films"); None for an undo.
    pub basis: Option<String>,
    pub numbers: serde_json::Value, pub operator: String, pub at: String,
}
pub struct NewPointChoice<'a> {
    pub landmark_id: &'a str, pub model_id: &'a str, pub action: &'a str, pub rule_version: &'a str,
    /// (import time, case id) of the re-check's last film; None for an undo.
    pub last_film: Option<(&'a str, &'a str)>,
    pub basis: Option<&'a str>,
    pub numbers: &'a serde_json::Value,
}
impl Library {
    /// Every answer, oldest first.
    pub fn point_choices(&self) -> anyhow::Result<Vec<PointChoice>> {
        let mut st = self.conn.prepare("SELECT id, landmark_id, model_id, action, rule_version, last_imported_at, last_case_id, basis, numbers, operator, at
            FROM point_choices ORDER BY id")?;
        let rows = st.query_map([], |r| Ok((r.get::<_, i64>(0)?, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?,
            r.get::<_, String>(4)?, r.get::<_, Option<String>>(5)?, r.get::<_, Option<String>>(6)?, r.get::<_, Option<String>>(7)?,
            r.get::<_, String>(8)?, r.get::<_, String>(9)?, r.get::<_, String>(10)?)))?
            .collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().map(|(id, landmark_id, model_id, action, rule_version, last_imported_at, last_case_id, basis, numbers, operator, at)|
            Ok(PointChoice { id, landmark_id, model_id, action, rule_version, last_imported_at, last_case_id, basis, numbers: serde_json::from_str(&numbers)?, operator, at }))
            .collect()
    }
    /// Records one answer; the table's CHECKs refuse a malformed one (nothing is written).
    pub fn add_point_choice(&mut self, c: &NewPointChoice, operator: &str) -> anyhow::Result<i64> {
        let (last_at, last_case) = c.last_film.map_or((None, None), |(a, b)| (Some(a), Some(b)));
        self.conn.execute(&format!("INSERT INTO point_choices (landmark_id, model_id, action, rule_version, last_imported_at, last_case_id, basis, numbers, operator, at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, {NOW})"),
            params![c.landmark_id, c.model_id, c.action, c.rule_version, last_at, last_case, c.basis, c.numbers.to_string(), operator])?;
        Ok(self.conn.last_insert_rowid())
    }
}

#[cfg(test)]
mod tests {
    use crate::{Library, NewPointChoice};
    fn lib() -> (tempfile::TempDir, Library, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        let png = t.path().join("SYNTHETIC.png");
        image::GrayImage::new(64, 64).save(&png).unwrap();
        let id = l.import(&png).unwrap().case_id;
        (t, l, id)
    }
    fn new<'a>(action: &'a str, last: Option<(&'a str, &'a str)>, basis: Option<&'a str>, numbers: &'a serde_json::Value) -> NewPointChoice<'a> {
        NewPointChoice { landmark_id: "Go", model_id: "srpose-cldet23", action, rule_version: "best-point/3", last_film: last, basis, numbers }
    }
    #[test] fn answers_are_kept_oldest_first_with_who_when_the_basis_and_the_numbers() {
        let (_t, mut l, _) = lib();
        let n = serde_json::json!({ "films": 60 });
        let a = l.add_point_choice(&new("accepted", Some(("2026-01-01T00:59:00.000Z", "c059")), Some("mm, 60 ruler films"), &n), "Dr A").unwrap();
        let u = l.add_point_choice(&new("undone", None, None, &serde_json::json!({})), "Dr B").unwrap();
        assert!(u > a);
        let all = l.point_choices().unwrap();
        assert_eq!(all.iter().map(|c| (c.action.as_str(), c.operator.as_str(), c.basis.as_deref())).collect::<Vec<_>>(),
            [("accepted", "Dr A", Some("mm, 60 ruler films")), ("undone", "Dr B", None)]);
        assert_eq!((all[0].numbers["films"].as_i64(), all[0].last_case_id.as_deref(), all[1].last_imported_at.clone()), (Some(60), Some("c059"), None));
        assert!(all[0].at.starts_with("20"), "stamped by the library: {}", all[0].at);
    }
    #[test] fn a_refused_answer_changes_nothing() {
        let (_t, mut l, _) = lib();
        assert!(l.add_point_choice(&new("maybe", Some(("t", "c")), Some("b"), &serde_json::json!({})), "Dr A").is_err());
        assert!(l.add_point_choice(&new("accepted", None, Some("b"), &serde_json::json!({})), "Dr A").is_err());
        assert!(l.add_point_choice(&new("accepted", Some(("t", "c")), None, &serde_json::json!({})), "Dr A").is_err());
        assert!(l.point_choices().unwrap().is_empty());
    }
    #[test] fn answers_outlive_the_film_they_were_given_on() {
        let (_t, mut l, id) = lib();
        l.add_point_choice(&new("declined", Some(("2026-01-01T00:00:00.000Z", id.as_str())), Some("mm, 60 ruler films"), &serde_json::json!({})), "Dr A").unwrap();
        l.delete(&id).unwrap();
        l.purge_deleted(0).unwrap();
        assert_eq!(l.point_choices().unwrap().len(), 1, "no foreign key: the record of the answer stays");
    }
}
