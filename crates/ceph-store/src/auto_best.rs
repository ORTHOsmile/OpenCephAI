//! Format 15 (Automatic best spec §6a, §9; owner D3): every change of Automatic best's verdict, every Undo and every
//! "Use … again". Append-only; the app reads them back oldest first.
use crate::library::{Library, NOW};
use rusqlite::params;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoBestEvent {
    pub id: i64, pub landmark_id: String, pub kind: String, pub model_id: String, pub fingerprint: Option<String>, pub uses: Option<String>,
    pub last_imported_at: Option<String>, pub last_case_id: Option<String>, pub basis: Option<String>, pub reason: Option<String>,
    pub numbers: serde_json::Value, pub rule_version: String, pub operator: String, pub at: String,
}
#[derive(Debug, Clone, PartialEq)]
pub struct NewAutoBestEvent {
    pub landmark_id: String, pub kind: String, pub model_id: String, pub fingerprint: Option<String>, pub uses: Option<String>,
    /// (import time, case id): the re-check's last film for `adopted`, the Undo's anchor for `undone` and `redone`; None for `returned`.
    pub last_film: Option<(String, String)>,
    pub basis: Option<String>, pub reason: Option<String>, pub numbers: serde_json::Value, pub rule_version: String,
}
impl Library {
    /// Every change, oldest first.
    pub fn auto_best_events(&self) -> anyhow::Result<Vec<AutoBestEvent>> {
        let mut st = self.conn.prepare("SELECT id, landmark_id, kind, model_id, fingerprint, uses, last_imported_at, last_case_id, basis, reason, numbers,
            rule_version, operator, at FROM auto_best_events ORDER BY id")?;
        let rows = st.query_map([], |r| Ok((AutoBestEvent { id: r.get(0)?, landmark_id: r.get(1)?, kind: r.get(2)?, model_id: r.get(3)?, fingerprint: r.get(4)?,
            uses: r.get(5)?, last_imported_at: r.get(6)?, last_case_id: r.get(7)?, basis: r.get(8)?, reason: r.get(9)?, numbers: serde_json::Value::Null,
            rule_version: r.get(11)?, operator: r.get(12)?, at: r.get(13)? }, r.get::<_, String>(10)?)))?.collect::<Result<Vec<_>, _>>()?;
        rows.into_iter().map(|(e, n)| Ok(AutoBestEvent { numbers: serde_json::from_str(&n)?, ..e })).collect()
    }
    /// Records one change; the table's CHECKs refuse a malformed one (nothing is written). Returns the row as stored.
    pub fn add_auto_best_event(&mut self, e: &NewAutoBestEvent, operator: &str) -> anyhow::Result<AutoBestEvent> {
        Ok(self.add_auto_best_events(std::slice::from_ref(e), operator)?.remove(0))
    }
    /// Records several changes as one (an Undo and the adoption it hands the point to): in one transaction, so if any
    /// row is refused none is written. Returns the rows as stored, in order.
    pub fn add_auto_best_events(&mut self, rows: &[NewAutoBestEvent], operator: &str) -> anyhow::Result<Vec<AutoBestEvent>> {
        self.add_auto_best_events_with_settings(&[], rows, operator)
    }
    /// `add_auto_best_events`, with settings written in the SAME transaction (a change of base: its setting, its log and
    /// its per-point rows are written together or not at all; final review M4).
    pub fn add_auto_best_events_with_settings(&mut self, settings: &[(&str, &str)], rows: &[NewAutoBestEvent], operator: &str) -> anyhow::Result<Vec<AutoBestEvent>> {
        let tx = self.conn.transaction()?;
        for (k, v) in settings {
            tx.execute("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET value = excluded.value", params![k, v])?;
        }
        let mut ids = Vec::new();
        for e in rows {
            let (at, case) = e.last_film.clone().map_or((None, None), |(a, c)| (Some(a), Some(c)));
            tx.execute(&format!("INSERT INTO auto_best_events (landmark_id, kind, model_id, fingerprint, uses, last_imported_at, last_case_id, basis, reason,
                numbers, rule_version, operator, at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, {NOW})"),
                params![e.landmark_id, e.kind, e.model_id, e.fingerprint, e.uses, at, case, e.basis, e.reason, e.numbers.to_string(), e.rule_version, operator])?;
            ids.push(tx.last_insert_rowid());
        }
        tx.commit()?;
        let all = self.auto_best_events()?;
        ids.iter().map(|id| all.iter().find(|x| x.id == *id).cloned().ok_or_else(|| anyhow::anyhow!("the change just recorded could not be read back"))).collect()
    }
}

#[cfg(test)]
mod tests {
    use crate::{Library, NewAutoBestEvent};
    fn lib() -> (tempfile::TempDir, Library, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        let png = t.path().join("SYNTHETIC.png");
        image::GrayImage::new(64, 64).save(&png).unwrap();
        let id = l.import(&png).unwrap().case_id;
        (t, l, id)
    }
    fn adopted(case: &str) -> NewAutoBestEvent {
        NewAutoBestEvent { landmark_id: "Go".into(), kind: "adopted".into(), model_id: "srpose-cldet23".into(), fingerprint: Some("fp".into()),
            uses: Some("srpose-cldet23".into()), last_film: Some(("2026-01-01T00:59:00.000Z".into(), case.into())), basis: Some("mm, 60 ruler films".into()),
            reason: None, numbers: serde_json::json!({ "films": 60 }), rule_version: "best-point/3".into() }
    }
    #[test] fn changes_are_kept_oldest_first_with_who_and_when() {
        let (_t, mut l, _) = lib();
        let a = l.add_auto_best_event(&adopted("c059"), "Dr A").unwrap();
        let u = l.add_auto_best_event(&NewAutoBestEvent { kind: "undone".into(), uses: None, ..adopted("c059") }, "Dr B").unwrap();
        assert!(u.id > a.id);
        let all = l.auto_best_events().unwrap();
        assert_eq!(all.iter().map(|e| (e.kind.as_str(), e.operator.as_str(), e.uses.as_deref())).collect::<Vec<_>>(),
            [("adopted", "Dr A", Some("srpose-cldet23")), ("undone", "Dr B", None)]);
        assert_eq!((all[0].numbers["films"].as_i64(), all[0].last_case_id.as_deref(), all[0].basis.as_deref()), (Some(60), Some("c059"), Some("mm, 60 ruler films")));
        assert!(all[0].at.starts_with("20"), "stamped by the library: {}", all[0].at);
        assert_eq!(all[0], a, "the row handed back is the row stored");
    }
    #[test] fn a_refused_change_writes_nothing() {
        let (_t, mut l, _) = lib();
        assert!(l.add_auto_best_event(&NewAutoBestEvent { fingerprint: None, ..adopted("c059") }, "Dr A").is_err());
        assert!(l.add_auto_best_event(&NewAutoBestEvent { kind: "returned".into(), ..adopted("c059") }, "Dr A").is_err());
        assert!(l.auto_best_events().unwrap().is_empty());
    }
    /// Several changes as one (Automatic best's Undo and the adoption it hands the point to): all or none. Positive
    /// control: write them one by one outside a transaction → the first row is left behind and this fails.
    #[test] fn changes_written_together_are_all_or_nothing() {
        let (_t, mut l, _) = lib();
        let undone = NewAutoBestEvent { kind: "undone".into(), uses: Some("gu2net-isbi19".into()), ..adopted("c059") };
        let bad = NewAutoBestEvent { fingerprint: None, model_id: "gu2net-isbi19".into(), uses: Some("gu2net-isbi19".into()), ..adopted("c059") };
        assert!(l.add_auto_best_events(&[undone.clone(), bad], "Dr A").is_err());
        assert!(l.auto_best_events().unwrap().is_empty(), "neither row");
        let good = NewAutoBestEvent { model_id: "gu2net-isbi19".into(), uses: Some("gu2net-isbi19".into()), ..adopted("c059") };
        let rows = l.add_auto_best_events(&[undone, good], "Dr A").unwrap();
        assert_eq!(rows.iter().map(|e| e.kind.as_str()).collect::<Vec<_>>(), ["undone", "adopted"]);
        assert_eq!(l.auto_best_events().unwrap(), rows, "the rows handed back are the rows stored, in order");
    }
    /// Final review M4: a change of base writes its settings and its rows in ONE transaction: a refused row leaves the
    /// settings as they were; a good batch writes both.
    #[test] fn settings_and_changes_written_together_are_all_or_nothing() {
        let (_t, mut l, _) = lib();
        let bad = NewAutoBestEvent { fingerprint: None, ..adopted("c059") };
        assert!(l.add_auto_best_events_with_settings(&[("auto_best_base", "gu2net-isbi19"), ("auto_best_base_log", "[1]")], &[bad], "Dr A").is_err());
        assert_eq!((l.setting("auto_best_base").unwrap(), l.setting("auto_best_base_log").unwrap(), l.auto_best_events().unwrap().len()), (None, None, 0));
        let rows = l.add_auto_best_events_with_settings(&[("auto_best_base", "gu2net-isbi19")], &[adopted("c059")], "Dr A").unwrap();
        assert_eq!((l.setting("auto_best_base").unwrap().as_deref(), rows.len()), (Some("gu2net-isbi19"), 1));
        l.add_auto_best_events_with_settings(&[("auto_best_base", "aariz-cepha29")], &[], "Dr A").unwrap();
        assert_eq!(l.setting("auto_best_base").unwrap().as_deref(), Some("aariz-cepha29"), "settings alone, no rows");
    }
    #[test] fn changes_outlive_the_film_they_name() {
        let (_t, mut l, id) = lib();
        l.add_auto_best_event(&adopted(&id), "Dr A").unwrap();
        l.delete(&id).unwrap();
        l.purge_deleted(0).unwrap();
        assert_eq!(l.auto_best_events().unwrap().len(), 1, "no foreign key: the record of the change stays");
    }
}
