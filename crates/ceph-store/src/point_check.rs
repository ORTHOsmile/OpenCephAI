//! Format 19 — Stage A′, the point check (spec 2026-11-02 §14.13 U1, U4). Flag-only: these methods write the check's
//! own three tables and nothing else; no point is ever moved or changed here.
use crate::library::{Library, NOW};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

/// One model run's check, as the scorer decided it (Task 2's `score_run`). `outcome` is `clean`, `flagged`,
/// `film-unusual` or `not-run`; `not_run_reason` (`too-few-points` / `not-set-up`) is set exactly when not run.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointCheckRecord {
    pub run_id: i64, pub rule_version: String, pub prior_sha256: Option<String>, pub prior_films: Option<i64>,
    pub outcome: String, pub not_run_reason: Option<String>, pub present: Option<i64>,
    pub flags: Vec<PointCheckFlag>,
}
/// One flag: a point (`landmark_id` set, action `flagged`) or the film (`landmark_id` None, action `film-unusual`,
/// `points` the ids out of keeping as `N,S,Po,Ar`). Distances and the ring are in film px.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointCheckFlag {
    pub landmark_id: Option<String>, pub action: String, pub points: Option<String>, pub tail: Option<f64>,
    pub off_px: Option<f64>, pub expected_x: Option<f64>, pub expected_y: Option<f64>, pub ring_rx: Option<f64>, pub ring_ry: Option<f64>,
    pub ring_angle_deg: Option<f64>,
}
/// A stored flag with its row id (for `resolve_point_check`), its run and model, and how it was resolved, if it was.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PointCheckRow { pub id: i64, pub run_id: i64, pub model_id: String, pub flag: PointCheckFlag, pub resolved: Option<String> }

/// The app's ONE mapping of a check (`ceph_model::pointcheck::score_run`'s `RunCheck`) to the record the library stores,
/// called by the desktop after each run and by the acceptance on public films (Stage A Task 10), so both store exactly
/// the same thing. A flagged run is one row per point, worst first; a film that looks unusual is ONE film row naming the
/// points out of keeping, with no point rows (ruling F13: "flags the film, not the points"; the list can name a point
/// that was not wrong); clean and not-run have no rows. `present` is the count of the 19 points among the run's
/// `marks` (other ids ignored), except where the check says its own: clean and too few points. Not set up carries no
/// starting-knowledge fingerprint. `prior_sha256` and `prior_films` describe the tracings the check fitted from.
pub fn point_check_record(run_id: i64, prior_sha256: &str, prior_films: i64, marks: &[ceph_model::pointcheck::Mark],
                          rc: &ceph_model::pointcheck::RunCheck) -> PointCheckRecord {
    use ceph_model::pointcheck::{NotRun, RunCheck, ORDER, RULE_VERSION};
    let present = ORDER.iter().filter(|id| marks.iter().any(|m| m.landmark_id == **id)).count() as i64;
    let base = PointCheckRecord { run_id, rule_version: RULE_VERSION.into(), prior_sha256: Some(prior_sha256.into()), prior_films: Some(prior_films),
        outcome: String::new(), not_run_reason: None, present: Some(present), flags: vec![] };
    match rc {
        RunCheck::Clean { present } => PointCheckRecord { outcome: "clean".into(), present: Some(*present as i64), ..base },
        RunCheck::Flagged { flags } => PointCheckRecord { outcome: "flagged".into(), flags: flags.iter().map(point_check_flag).collect(), ..base },
        RunCheck::FilmUnusual { flags } => PointCheckRecord { outcome: "film-unusual".into(), flags: vec![PointCheckFlag {
            landmark_id: None, action: "film-unusual".into(), points: Some(flags.iter().map(|f| f.landmark_id.as_str()).collect::<Vec<_>>().join(",")),
            tail: None, off_px: None, expected_x: None, expected_y: None, ring_rx: None, ring_ry: None, ring_angle_deg: None }], ..base },
        RunCheck::NotRun { reason: NotRun::TooFewPoints { present } } =>
            PointCheckRecord { outcome: "not-run".into(), not_run_reason: Some("too-few-points".into()), present: Some(*present as i64), ..base },
        RunCheck::NotRun { reason: NotRun::NotSetUp } => PointCheckRecord { prior_sha256: None, prior_films: None, outcome: "not-run".into(),
            not_run_reason: Some("not-set-up".into()), present: None, ..base },
    }
}
/// One flagged point as its stored row (film px; the ring centre is the expected centre).
pub fn point_check_flag(f: &ceph_model::pointcheck::PointFlag) -> PointCheckFlag {
    PointCheckFlag { landmark_id: Some(f.landmark_id.clone()), action: "flagged".into(), points: None, tail: Some(f.tail), off_px: Some(f.off_px),
        expected_x: Some(f.expected_x), expected_y: Some(f.expected_y), ring_rx: Some(f.ring.rx), ring_ry: Some(f.ring.ry), ring_angle_deg: Some(f.ring.angle_deg) }
}

/// The newest run of each model on its film: the only run whose check is shown or read (spec U4). An older run's check
/// never stands in for a newer run, checked or not.
const LATEST: &str = "a.id = (SELECT MAX(id) FROM ai_runs WHERE case_id = a.case_id AND model_id = a.model_id)";
const FLAG_COLS: &str = "c.id, c.run_id, a.model_id, c.landmark_id, c.action, c.points, c.tail, c.off_px, c.expected_x, c.expected_y, \
    c.ring_rx, c.ring_ry, c.ring_angle_deg, r.how";

fn flag_from(r: &rusqlite::Row, at: usize) -> rusqlite::Result<PointCheckFlag> {
    Ok(PointCheckFlag { landmark_id: r.get(at)?, action: r.get(at + 1)?, points: r.get(at + 2)?, tail: r.get(at + 3)?, off_px: r.get(at + 4)?,
        expected_x: r.get(at + 5)?, expected_y: r.get(at + 6)?, ring_rx: r.get(at + 7)?, ring_ry: r.get(at + 8)?, ring_angle_deg: r.get(at + 9)? })
}

impl Library {
    /// Records one model run's check and its flags, in one transaction. Returns false, writing nothing, when that run is
    /// already recorded (a run is checked once, right after it is made). A record the library refuses (a value its
    /// CHECKs refuse, a run of another film, an outcome that does not match its flags) is an error and writes nothing:
    /// `ON CONFLICT (run_id) DO NOTHING`, not `INSERT OR IGNORE`, which would also pass over a failed CHECK silently.
    pub fn record_point_check(&mut self, case_id: &str, r: &PointCheckRecord) -> anyhow::Result<bool> {
        self.record_point_check_fresh(case_id, r, &[])
    }
    /// `record_point_check`, naming the pins the run's detection has just put on the film fresh (`fresh`: every pin a
    /// Replace all replaced). No look is carried to them (re-review N1): the run is stored before the screen's autosave
    /// writes those pins, so the store may still hold the OLD verified pin, and a look at that pin is not a look at the
    /// new one. Told by the detection itself, so it holds however late, or whether, the save lands.
    pub fn record_point_check_fresh(&mut self, case_id: &str, r: &PointCheckRecord, fresh: &[String]) -> anyhow::Result<bool> {
        let tx = self.conn.transaction()?;
        let owner: Option<String> = tx.query_row("SELECT case_id FROM ai_runs WHERE id = ?1", [r.run_id], |x| x.get(0)).optional()?;
        anyhow::ensure!(owner.as_deref() == Some(case_id), "model run {} is not a run on film {case_id}", r.run_id);
        let films = r.flags.iter().filter(|f| f.landmark_id.is_none()).count();
        let fits = match r.outcome.as_str() {
            "clean" | "not-run" => r.flags.is_empty(),
            "flagged" => !r.flags.is_empty() && films == 0,
            "film-unusual" => films == 1,
            _ => true,                                         // any other outcome: the table's CHECK refuses it
        };
        anyhow::ensure!(fits, "a point check `{}` with {} flag(s), {films} for the film, can never be", r.outcome, r.flags.len());
        let n = tx.execute(&format!("INSERT INTO point_check_runs (run_id, case_id, rule_version, prior_sha256, prior_films, outcome, not_run_reason, present, checked_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, {NOW}) ON CONFLICT (run_id) DO NOTHING"),
            params![r.run_id, case_id, r.rule_version, r.prior_sha256, r.prior_films, r.outcome, r.not_run_reason, r.present])?;
        if n == 0 { return Ok(false); }
        {
            let mut st = tx.prepare("INSERT INTO point_checks (run_id, landmark_id, action, points, tail, off_px, expected_x, expected_y, ring_rx, ring_ry, ring_angle_deg)
                VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)")?;
            for f in &r.flags {
                st.execute(params![r.run_id, f.landmark_id, f.action, f.points, f.tail, f.off_px, f.expected_x, f.expected_y, f.ring_rx, f.ring_ry, f.ring_angle_deg])?;
            }
        }
        // Whole-branch review I3: a Re-detect by the same model usually flags the same point again. Where you already
        // looked at that point on its own (its flag in this model's previous run was resolved, and the pin is still
        // verified and was not verified by a bulk accept), that look is carried to the new run's flag: the same `how`,
        // operator and time. Without it the new flag was an unresolved row nothing could draw (the pin is verified) or
        // resolve, and the film left that model's habit for good (spec U4). Nothing else is carried: a point the earlier
        // run did not flag, a pin the detection has just replaced (`fresh`, re-review N1), a pin no longer verified
        // (it is shown again, so it is open again), a film note (its Checked is a look at that note, and a new note is
        // shown and can be pressed), or another model's resolution.
        tx.execute("INSERT INTO point_check_resolutions (check_id, how, operator, resolved_at)
            SELECT c.id, r.how, r.operator, r.resolved_at
            FROM point_checks c JOIN ai_runs a ON a.id = c.run_id
            JOIN landmarks l ON l.case_id = a.case_id AND l.id = c.landmark_id AND l.verified = 1 AND l.accept_kind IS NOT 'bulk'
            JOIN point_checks pc ON pc.landmark_id = c.landmark_id
                AND pc.run_id = (SELECT MAX(id) FROM ai_runs WHERE case_id = a.case_id AND model_id = a.model_id AND id < a.id)
            JOIN point_check_resolutions r ON r.check_id = pc.id AND r.how IN ('accepted', 'moved', 'placed')
            WHERE c.run_id = ?1 AND c.landmark_id IS NOT NULL AND instr(?2, ',' || c.landmark_id || ',') = 0
            ON CONFLICT (check_id) DO NOTHING", params![r.run_id, format!(",{},", fresh.join(","))])?;
        tx.commit()?;
        Ok(true)
    }

    /// One stored model run by its id, with the film it was made on (Task 5: the check scores exactly the run it was
    /// handed, never "the model's newest"). None when there is no such run. Read only.
    pub fn ai_run(&self, run_id: i64) -> anyhow::Result<Option<(String, crate::ModelPoints)>> {
        let run: Option<(String, String, String, String, String, Option<String>)> = self.conn.query_row(
            "SELECT case_id, model_id, ran_at, facing, execution_provider, model_sha256 FROM ai_runs WHERE id = ?1", [run_id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?))).optional()?;
        let Some((case_id, model_id, ran_at, facing, execution_provider, model_sha256)) = run else { return Ok(None) };
        let points = self.conn.prepare("SELECT channel, landmark_id, x, y, peak FROM ai_points WHERE run_id = ?1 ORDER BY channel")?
            .query_map([run_id], |r| Ok(crate::AiPoint { channel: r.get(0)?, landmark_id: r.get(1)?, x: r.get(2)?, y: r.get(3)?, peak: r.get(4)? }))?
            .collect::<Result<_, _>>()?;
        Ok(Some((case_id, crate::ModelPoints { model_id, ran_at, facing, points, execution_provider, model_sha256 })))
    }

    /// Each model's latest run on the film that has a check, with its flags (by model id; flags in the order recorded).
    pub fn point_check_runs(&self, case_id: &str) -> anyhow::Result<Vec<(String, PointCheckRecord)>> {
        let runs: Vec<(String, PointCheckRecord)> = self.conn.prepare(&format!(
            "SELECT a.model_id, p.run_id, p.rule_version, p.prior_sha256, p.prior_films, p.outcome, p.not_run_reason, p.present
             FROM point_check_runs p JOIN ai_runs a ON a.id = p.run_id WHERE a.case_id = ?1 AND {LATEST} ORDER BY a.model_id"))?
            .query_map([case_id], |r| Ok((r.get(0)?, PointCheckRecord { run_id: r.get(1)?, rule_version: r.get(2)?, prior_sha256: r.get(3)?,
                prior_films: r.get(4)?, outcome: r.get(5)?, not_run_reason: r.get(6)?, present: r.get(7)?, flags: vec![] })))?
            .collect::<Result<_, _>>()?;
        let mut st = self.conn.prepare("SELECT landmark_id, action, points, tail, off_px, expected_x, expected_y, ring_rx, ring_ry, ring_angle_deg
            FROM point_checks WHERE run_id = ?1 ORDER BY id")?;
        runs.into_iter().map(|(m, rec)| {
            let flags = st.query_map([rec.run_id], |r| flag_from(r, 0))?.collect::<Result<_, _>>()?;
            Ok((m, PointCheckRecord { flags, ..rec }))
        }).collect()
    }

    fn point_check_rows(&self, case_id: &str, model_id: Option<&str>, unresolved: bool) -> anyhow::Result<Vec<PointCheckRow>> {
        let sql = format!("SELECT {FLAG_COLS} FROM point_checks c JOIN ai_runs a ON a.id = c.run_id
            LEFT JOIN point_check_resolutions r ON r.check_id = c.id
            WHERE a.case_id = ?1 AND {LATEST} AND (?2 IS NULL OR a.model_id = ?2) AND (NOT ?3 OR r.check_id IS NULL)
            ORDER BY a.model_id, c.id");
        Ok(self.conn.prepare(&sql)?.query_map(params![case_id, model_id, unresolved], |r| Ok(PointCheckRow {
            id: r.get(0)?, run_id: r.get(1)?, model_id: r.get(2)?, flag: flag_from(r, 3)?, resolved: r.get(13)? }))?
            .collect::<Result<_, _>>()?)
    }
    /// Every flag of each model's latest run on the film, with how it was resolved (by model id, then as recorded).
    pub fn point_checks(&self, case_id: &str) -> anyhow::Result<Vec<PointCheckRow>> { self.point_check_rows(case_id, None, false) }
    /// The habit offset's one read (spec U4): the flags of `model_id`'s latest run on the film not yet resolved. A film
    /// flag stays here until it is resolved `film-checked`.
    pub fn unresolved_point_checks(&self, case_id: &str, model_id: &str) -> anyhow::Result<Vec<PointCheckRow>> {
        self.point_check_rows(case_id, Some(model_id), true)
    }

    /// Records how a flag was resolved, once (spec U4: never undone by a later edit). Returns false, changing nothing,
    /// when it is already resolved. A point flag is resolved `accepted`, `moved` or `placed`; the film flag only
    /// `film-checked`. Allowed on a signed-off film: resolving is looking, not editing. Refused (an error, nothing written) for a flag of a
    /// superseded run: only the latest run's flags are shown or read.
    pub fn resolve_point_check(&mut self, check_id: i64, how: &str, operator: &str) -> anyhow::Result<bool> {
        let tx = self.conn.transaction()?;
        let row: Option<(bool, bool)> = tx.query_row(&format!("SELECT c.landmark_id IS NULL, {LATEST} FROM point_checks c JOIN ai_runs a ON a.id = c.run_id WHERE c.id = ?1"),
            [check_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        let (film, latest) = row.ok_or_else(|| anyhow::anyhow!("no point check {check_id}"))?;
        // A superseded run's flags are not shown or read (`LATEST`): a resolution written there would be one nobody sees.
        anyhow::ensure!(latest, "point check {check_id} is from an older run of that model; only the latest run's flags are resolved");
        anyhow::ensure!(film == (how == "film-checked"), "a {} flag is never resolved `{how}`", if film { "film" } else { "point" });
        let n = tx.execute(&format!("INSERT INTO point_check_resolutions (check_id, how, operator, resolved_at) VALUES (?1, ?2, ?3, {NOW})
            ON CONFLICT (check_id) DO NOTHING"), params![check_id, how, operator])?;
        tx.commit()?;
        Ok(n == 1)
    }

    /// Models… counts (spec §14.5): per point, how many point flags were shown and how many of those you left as placed
    /// (resolved `accepted` by `operator`, the one who is tracing now: "you left it"). Only the flag of the model that
    /// placed the point is counted (whole-branch review I4: the flag the screen draws and the report prints; another
    /// model's flag at that point is never shown), once per point per film; a point you then placed by hand (`placed`,
    /// no placer any more) still counts its flag once, as the report's cell does. Each model's LATEST run on each live
    /// film (ruling for Task 8: a superseded run's flags are not counted); films in Recently deleted are not
    /// counted. By point id.
    pub fn point_check_counts(&self, operator: &str) -> anyhow::Result<Vec<(String, i64, i64)>> {
        Ok(self.conn.prepare(&format!("SELECT landmark_id, COUNT(*), SUM(left_it) FROM (
                SELECT c.landmark_id, a.case_id, MAX(CASE WHEN r.how = 'accepted' AND r.operator = ?1 THEN 1 ELSE 0 END) AS left_it
                FROM point_checks c JOIN ai_runs a ON a.id = c.run_id JOIN cases k ON k.id = a.case_id
                JOIN landmarks l ON l.case_id = a.case_id AND l.id = c.landmark_id
                LEFT JOIN point_check_resolutions r ON r.check_id = c.id
                WHERE c.landmark_id IS NOT NULL AND k.deleted_at IS NULL AND {LATEST}
                  AND (l.placed_by = a.model_id OR (l.placed_by IS NULL AND r.how = 'placed'))
                GROUP BY a.case_id, c.landmark_id)
            GROUP BY landmark_id ORDER BY landmark_id"))?
            .query_map([operator], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?)
    }
    /// Owner ruling "Hold sign-off" (2 Nov), enforced here as well as on the screen (whole-branch review I2): whether any
    /// model's latest run on the film holds a film note not yet Checked. Read inside the sign-off's own transaction.
    pub(crate) fn film_note_open(tx: &rusqlite::Connection, case_id: &str) -> anyhow::Result<bool> {
        Ok(tx.query_row(&format!("SELECT EXISTS (SELECT 1 FROM point_checks c JOIN ai_runs a ON a.id = c.run_id
            LEFT JOIN point_check_resolutions r ON r.check_id = c.id
            WHERE a.case_id = ?1 AND c.landmark_id IS NULL AND r.check_id IS NULL AND {LATEST})"), [case_id], |r| r.get(0))?)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AiRun;
    use std::path::Path;

    /// The one mapping from the app's check to its stored record (shared by the desktop and the acceptance driver).
    /// Each field of every outcome, and `present` counted from the run's marks (ids outside the 19 ignored). Fails if a
    /// field is mapped from the wrong source, an outcome word changes, the film row is split into point rows, or
    /// `present` is taken from anywhere but the marks.
    #[test] fn the_check_maps_to_its_record_field_by_field() {
        use ceph_model::pointcheck::{Mark, NotRun, PointFlag, RunCheck};
        use ceph_model::shape::Ring;
        let mark = |id: &str| Mark { landmark_id: id.into(), x: 1.0, y: 2.0 };
        let marks: Vec<Mark> = ["S", "N", "B", "Ba"].iter().map(|id| mark(id)).collect();       // Ba is not one of the 19
        let f = |id: &str, k: f64| PointFlag { landmark_id: id.into(), tail: 1e-5 * k, expected_x: 100.0 + k, expected_y: 200.0 + k, off_px: 30.0 + k,
            ring: Ring { cx: 100.0 + k, cy: 200.0 + k, rx: 11.0 + k, ry: 7.0 + k, angle_deg: -20.0 + k } };
        let sha = "a".repeat(64);
        let rec = |rc: &RunCheck| point_check_record(9, &sha, 300, &marks, rc);
        let flagged = rec(&RunCheck::Flagged { flags: vec![f("B", 1.0), f("N", 2.0)] });
        assert_eq!((flagged.run_id, flagged.rule_version.as_str(), flagged.prior_sha256.as_deref(), flagged.prior_films, flagged.outcome.as_str(), flagged.not_run_reason.as_deref(), flagged.present),
                   (9, "point-check/2", Some(sha.as_str()), Some(300), "flagged", None, Some(3)));
        let b = &flagged.flags[0];
        assert_eq!((b.landmark_id.as_deref(), b.action.as_str(), b.points.as_deref(), b.tail, b.off_px, b.expected_x, b.expected_y, b.ring_rx, b.ring_ry, b.ring_angle_deg),
                   (Some("B"), "flagged", None, Some(1e-5), Some(31.0), Some(101.0), Some(201.0), Some(12.0), Some(8.0), Some(-19.0)));
        assert_eq!(flagged.flags.iter().map(|x| x.landmark_id.as_deref()).collect::<Vec<_>>(), [Some("B"), Some("N")], "worst first, as scored");
        let film = rec(&RunCheck::FilmUnusual { flags: vec![f("N", 1.0), f("S", 2.0), f("B", 3.0), f("Po", 4.0)] });
        assert_eq!((film.outcome.as_str(), film.present, film.flags.len()), ("film-unusual", Some(3), 1));
        let ff = &film.flags[0];
        assert_eq!((ff.landmark_id.as_deref(), ff.action.as_str(), ff.points.as_deref(), ff.tail, ff.off_px, ff.expected_x, ff.expected_y, ff.ring_rx, ff.ring_ry, ff.ring_angle_deg),
                   (None, "film-unusual", Some("N,S,B,Po"), None, None, None, None, None, None, None));
        let clean = rec(&RunCheck::Clean { present: 18 });
        assert_eq!((clean.outcome.as_str(), clean.present, clean.flags.len(), clean.prior_films), ("clean", Some(18), 0, Some(300)));
        let few = rec(&RunCheck::NotRun { reason: NotRun::TooFewPoints { present: 11 } });
        assert_eq!((few.outcome.as_str(), few.not_run_reason.as_deref(), few.present, few.prior_sha256.is_some()), ("not-run", Some("too-few-points"), Some(11), true));
        let unset = rec(&RunCheck::NotRun { reason: NotRun::NotSetUp });
        assert_eq!((unset.outcome.as_str(), unset.not_run_reason.as_deref(), unset.present, unset.prior_sha256.clone(), unset.prior_films), ("not-run", Some("not-set-up"), None, None, None));
        // Every one of them is a record the library accepts.
        let (_t, mut l, a) = lib();
        for (i, r) in [flagged, film, clean, few, unset].into_iter().enumerate() {
            let id = run(&mut l, &a, &format!("SYNTHETIC-model-{i}"));
            assert!(l.record_point_check(&a, &PointCheckRecord { run_id: id, ..r }).unwrap(), "record {i}");
        }
    }

    /// A new library with one synthetic film; returns (folder, library, film id).
    fn lib() -> (tempfile::TempDir, Library, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        let id = film(&mut l, t.path(), "SYNTHETIC-a.png", 64);
        (t, l, id)
    }
    fn film(l: &mut Library, dir: &Path, name: &str, px: u32) -> String {
        let png = dir.join(name);
        image::GrayImage::new(px, px).save(&png).unwrap();
        l.import(&png).unwrap().case_id
    }
    fn run(l: &mut Library, case_id: &str, model: &str) -> i64 {
        l.record_ai_run(case_id, &AiRun { model_id: model.into(), execution_provider: "cpu".into(), facing: "right".into(), total_ms: 1.0, model_sha256: None }, &[]).unwrap()
    }
    fn point(id: &str) -> PointCheckFlag {
        PointCheckFlag { landmark_id: Some(id.into()), action: "flagged".into(), points: None, tail: Some(0.0001), off_px: Some(150.0),
            expected_x: Some(100.0), expected_y: Some(120.0), ring_rx: Some(30.0), ring_ry: Some(20.0), ring_angle_deg: Some(-12.5) }
    }
    fn film_flag(points: &str) -> PointCheckFlag {
        PointCheckFlag { landmark_id: None, action: "film-unusual".into(), points: Some(points.into()), tail: None, off_px: None,
            expected_x: None, expected_y: None, ring_rx: None, ring_ry: None, ring_angle_deg: None }
    }
    fn record(run_id: i64, outcome: &str, flags: Vec<PointCheckFlag>) -> PointCheckRecord {
        PointCheckRecord { run_id, rule_version: "point-check/2".into(), prior_sha256: Some("a".repeat(64)), prior_films: Some(300),
            outcome: outcome.into(), not_run_reason: None, present: Some(19), flags }
    }
    fn count(l: &Library, table: &str) -> i64 { l.conn.query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap() }
    fn counts(l: &Library) -> [i64; 3] { [count(l, "point_check_runs"), count(l, "point_checks"), count(l, "point_check_resolutions")] }
    fn ids(rows: &[PointCheckRow]) -> Vec<(String, Option<String>)> { rows.iter().map(|r| (r.model_id.clone(), r.flag.landmark_id.clone())).collect() }

    /// Test 7: a film's checks go with it. Purging the film removes its check runs, flags and resolutions; removing one
    /// model run removes that run's check (the cascade through `ai_runs`) and leaves the other run's. Positive control:
    /// drop `ON DELETE CASCADE` from `point_check_runs.run_id` in 019 → the run removal is refused, and this fails.
    #[test] fn deleting_a_film_deletes_its_checks() {
        let (t, mut l, a) = lib();
        let b = film(&mut l, t.path(), "SYNTHETIC-b.png", 80);
        let (ra, rb1, rb2) = (run(&mut l, &a, "aariz-cepha29"), run(&mut l, &b, "aariz-cepha29"), run(&mut l, &b, "srpose-cldet23"));
        for (case, r) in [(&a, ra), (&b, rb1), (&b, rb2)] {
            assert!(l.record_point_check(case, &record(r, "film-unusual", vec![point("N"), film_flag("N,S,Po,Ar")])).unwrap());
        }
        for row in l.point_checks(&a).unwrap().into_iter().chain(l.point_checks(&b).unwrap()) { assert!(l.resolve_point_check(row.id, if row.flag.landmark_id.is_some() { "accepted" } else { "film-checked" }, "Dr A").unwrap()); }
        assert_eq!(counts(&l), [3, 6, 6]);
        l.delete(&a).unwrap();
        assert_eq!(counts(&l), [3, 6, 6], "Recently deleted keeps them, so a restore brings them back");
        l.conn.execute("UPDATE cases SET deleted_at = '2000-01-01T00:00:00.000Z' WHERE id = ?1", [&a]).unwrap();
        assert_eq!(l.purge_deleted(crate::KEEP_DELETED_DAYS).unwrap(), 1);
        println!("after emptying film a: runs, flags, resolutions = {:?}", counts(&l));
        assert_eq!(counts(&l), [2, 4, 4], "film a's run, flags and resolutions gone; film b's kept");
        let removed = l.conn.execute("DELETE FROM ai_runs WHERE id = ?1", [rb1]);
        println!("removing one run of film b: {removed:?}; runs, flags, resolutions = {:?}", counts(&l));
        assert_eq!(removed.unwrap(), 1);
        assert_eq!(counts(&l), [1, 2, 2], "that run's check went with it; the other model's stayed");
        assert_eq!(ids(&l.point_checks(&b).unwrap()), [("srpose-cldet23".to_string(), Some("N".to_string())), ("srpose-cldet23".to_string(), None)]);
    }

    /// Test 8a: a run is checked once. A second record for the same run returns false and writes nothing, even with
    /// different flags. Positive control: drop the existence answer (always true) → fails.
    #[test] fn a_run_is_recorded_once() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(r, "flagged", vec![point("N")])).unwrap());
        let before = (counts(&l), l.point_check_runs(&a).unwrap(), l.point_checks(&a).unwrap());
        let again = l.record_point_check(&a, &record(r, "flagged", vec![point("S"), point("Go")])).unwrap();
        println!("second record of run {r}: {again}; runs, flags, resolutions = {:?}", counts(&l));
        assert!(!again);
        assert_eq!((counts(&l), l.point_check_runs(&a).unwrap(), l.point_checks(&a).unwrap()), before, "nothing written");
        assert_eq!(l.point_check_runs(&a).unwrap()[0].1.flags, vec![point("N")], "the first record kept");
    }
    /// Test 8a, the refusal path: a record the tables refuse is an error, never "already recorded", and writes nothing
    /// (one transaction). Positive control: write it with `INSERT OR IGNORE` (which also ignores a failed CHECK) →
    /// the bad outcome comes back Ok(false) and this fails.
    #[test] fn a_record_the_library_refuses_is_an_error_and_writes_nothing() {
        let (t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        let b = film(&mut l, t.path(), "SYNTHETIC-b.png", 80);
        let bad: Vec<(&str, String, PointCheckRecord)> = vec![
            ("outcome `moved`", a.clone(), record(r, "moved", vec![])),
            ("a 63-character SHA", a.clone(), PointCheckRecord { prior_sha256: Some("a".repeat(63)), ..record(r, "clean", vec![]) }),
            ("a flag the table refuses (tail 1)", a.clone(), record(r, "flagged", vec![point("N"), PointCheckFlag { tail: Some(1.0), ..point("S") }])),
            ("the same point twice", a.clone(), record(r, "flagged", vec![point("N"), point("N")])),
            ("a run of another film", b.clone(), record(r, "clean", vec![])),
            ("a run that does not exist", a.clone(), record(r + 99, "clean", vec![])),
            ("`clean` with a flag", a.clone(), record(r, "clean", vec![point("N")])),
            ("`flagged` with no flag", a.clone(), record(r, "flagged", vec![])),
            ("`flagged` with a film flag", a.clone(), record(r, "flagged", vec![point("N"), film_flag("N,S,Po,Ar")])),
            ("`film-unusual` with no film flag", a.clone(), record(r, "film-unusual", vec![point("N")])),
            ("`not-run` with a flag", a.clone(), PointCheckRecord { not_run_reason: Some("too-few-points".into()), present: Some(11), ..record(r, "not-run", vec![point("N")]) }),
        ];
        for (why, case, rec) in &bad {
            let e = l.record_point_check(case, rec);
            println!("{why}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{why} must be refused, not answered {e:?}");
            assert_eq!(counts(&l), [0, 0, 0], "{why}: nothing written");
        }
        assert!(l.record_point_check(&a, &record(r, "clean", vec![])).unwrap(), "the run can still be recorded properly");
    }

    /// Test 8b: `point_check_runs` and `point_checks` give each model's LATEST run on the film only (spec U4: the flags of
    /// that model's latest run), model by model. A model whose latest run has no check gives nothing (an older run's
    /// flags never stand in for it). Positive control: drop the latest-run condition → the older run's N appears.
    #[test] fn point_checks_gives_each_models_latest_run_only() {
        let (_t, mut l, a) = lib();
        let a1 = run(&mut l, &a, "aariz-cepha29");
        let s1 = run(&mut l, &a, "srpose-cldet23");
        let a2 = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(a1, "flagged", vec![point("N")])).unwrap());
        assert!(l.record_point_check(&a, &record(s1, "flagged", vec![point("Go")])).unwrap());
        assert!(l.record_point_check(&a, &record(a2, "flagged", vec![point("S")])).unwrap());
        let rows = l.point_checks(&a).unwrap();
        println!("latest per model: {:?}", ids(&rows));
        assert_eq!(ids(&rows), [("aariz-cepha29".to_string(), Some("S".to_string())), ("srpose-cldet23".to_string(), Some("Go".to_string()))]);
        assert_eq!(rows.iter().map(|r| r.run_id).collect::<Vec<_>>(), [a2, s1]);
        let runs = l.point_check_runs(&a).unwrap();
        assert_eq!(runs.iter().map(|(m, r)| (m.as_str(), r.run_id)).collect::<Vec<_>>(), [("aariz-cepha29", a2), ("srpose-cldet23", s1)]);
        assert_eq!(runs[0].1, record(a2, "flagged", vec![point("S")]), "read back exactly as recorded");
        let a3 = run(&mut l, &a, "aariz-cepha29");                       // a newer run, not checked
        println!("after an unchecked newer run {a3}: {:?}", ids(&l.point_checks(&a).unwrap()));
        assert_eq!(ids(&l.point_checks(&a).unwrap()), [("srpose-cldet23".to_string(), Some("Go".to_string()))]);
        assert_eq!(l.point_check_runs(&a).unwrap().len(), 1);
    }

    /// Test 8c: a flag is resolved once; the second answer is false and the first resolution is kept. A resolution the
    /// table refuses is an error. Positive control: write it with `INSERT OR REPLACE` → the second wins, fails.
    #[test] fn a_flag_is_resolved_once_and_the_first_resolution_is_kept() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(r, "flagged", vec![point("N")])).unwrap());
        let id = l.point_checks(&a).unwrap()[0].id;
        assert!(l.resolve_point_check(id, "moved", "Dr A").unwrap());
        let again = l.resolve_point_check(id, "accepted", "Dr B").unwrap();
        let who: (String, String) = l.conn.query_row("SELECT how, operator FROM point_check_resolutions WHERE check_id = ?1", [id], |r| Ok((r.get(0)?, r.get(1)?))).unwrap();
        println!("second resolution: {again}; kept {who:?}");
        assert!(!again);
        assert_eq!(who, ("moved".to_string(), "Dr A".to_string()));
        assert_eq!(l.point_checks(&a).unwrap()[0].resolved.as_deref(), Some("moved"));
        for (how, op) in [("bulk", "Dr A"), ("accepted", "")] {
            let e = l.resolve_point_check(id, how, op);
            println!("resolve {how:?} by {op:?}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{how:?}/{op:?} must be refused, not answered {e:?}");
        }
        let e = l.resolve_point_check(id + 99, "accepted", "Dr A");
        println!("resolve a flag that does not exist: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
        assert!(e.is_err());
    }

    /// Task 7 carried item 1: a flag of a superseded (not latest) run is never resolved. Nobody sees that run's flags, so
    /// a resolution written there would be one nobody sees. Fails if `resolve_point_check` writes it (a row appears).
    #[test] fn a_flag_of_an_older_run_is_never_resolved() {
        let (_t, mut l, a) = lib();
        let r1 = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(r1, "flagged", vec![point("N")])).unwrap());
        let old = l.point_checks(&a).unwrap()[0].id;
        let r2 = run(&mut l, &a, "aariz-cepha29");                            // a re-detect: a newer run supersedes r1
        assert!(l.record_point_check(&a, &record(r2, "flagged", vec![point("N")])).unwrap());
        let e = l.resolve_point_check(old, "accepted", "Dr A");
        println!("resolve a flag of the superseded run: {:?}; resolutions = {}", e.as_ref().map_err(|e| format!("{e:#}")), count(&l, "point_check_resolutions"));
        assert!(e.is_err());
        assert_eq!(count(&l, "point_check_resolutions"), 0, "nothing written");
        let new = l.point_checks(&a).unwrap()[0].id;
        assert_ne!(new, old);
        assert!(l.resolve_point_check(new, "accepted", "Dr A").unwrap(), "control: the latest run's flag still resolves");
    }

    /// Test 8d: `unresolved_point_checks` (the habit offset's one read, spec U4) gives that model's latest run's flags
    /// not yet resolved; a film flag stays until `film-checked`. Positive control: drop the "not resolved" condition →
    /// the resolved N stays, fails.
    #[test] fn unresolved_point_checks_keeps_a_film_flag_until_it_is_checked() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        let other = run(&mut l, &a, "srpose-cldet23");
        assert!(l.record_point_check(&a, &record(r, "film-unusual", vec![point("N"), film_flag("N,S,Po,Ar")])).unwrap());
        assert!(l.record_point_check(&a, &record(other, "flagged", vec![point("Me")])).unwrap());
        let open = |l: &Library| ids(&l.unresolved_point_checks(&a, "aariz-cepha29").unwrap());
        assert_eq!(open(&l), [("aariz-cepha29".to_string(), Some("N".to_string())), ("aariz-cepha29".to_string(), None)], "only this model's flags");
        let rows = l.point_checks(&a).unwrap();
        let (n, film) = (rows.iter().find(|x| x.flag.landmark_id.as_deref() == Some("N")).unwrap().id, rows.iter().find(|x| x.flag.landmark_id.is_none()).unwrap().id);
        assert!(l.resolve_point_check(n, "accepted", "Dr A").unwrap());
        println!("N accepted: {:?}", open(&l));
        assert_eq!(open(&l), [("aariz-cepha29".to_string(), None)], "the film flag stays");
        for (id, how) in [(film, "accepted"), (film, "moved"), (film, "placed")] {
            let e = l.resolve_point_check(id, how, "Dr A");
            println!("the film flag resolved {how:?}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "only Checked resolves a film flag");
        }
        let e = l.resolve_point_check(n, "film-checked", "Dr A");
        println!("a point flag resolved \"film-checked\": {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
        assert!(e.is_err(), "a point flag is never film-checked");
        assert!(l.resolve_point_check(film, "film-checked", "Dr A").unwrap());
        println!("film checked: {:?}", open(&l));
        assert!(open(&l).is_empty());
        assert_eq!(ids(&l.unresolved_point_checks(&a, "srpose-cldet23").unwrap()), [("srpose-cldet23".to_string(), Some("Me".to_string()))]);
        assert!(l.unresolved_point_checks(&a, "no-such-model").unwrap().is_empty());
    }

    /// Test 8e: Models… counts (Task 8): per point, how often it was flagged and how often you left it ("accepted"),
    /// live films only. Positive control: drop `deleted_at IS NULL` → film b's flags are counted, fails.
    #[test] fn point_check_counts_ignores_films_in_recently_deleted() {
        let (t, mut l, a) = lib();
        let b = film(&mut l, t.path(), "SYNTHETIC-b.png", 80);
        let (ra, rb) = (run(&mut l, &a, "aariz-cepha29"), run(&mut l, &b, "aariz-cepha29"));
        assert!(l.record_point_check(&a, &record(ra, "film-unusual", vec![point("N"), point("Go"), film_flag("N,Go,Po,Ar")])).unwrap());
        assert!(l.record_point_check(&b, &record(rb, "flagged", vec![point("N")])).unwrap());
        for row in l.point_checks(&a).unwrap() {
            if row.flag.landmark_id.as_deref() == Some("N") { l.resolve_point_check(row.id, "accepted", "Dr A").unwrap(); }
            if row.flag.landmark_id.as_deref() == Some("Go") { l.resolve_point_check(row.id, "moved", "Dr A").unwrap(); }
        }
        for (case, id, kind) in [(&a, "N", "single"), (&a, "Go", "drag"), (&b, "N", "single")] { pin(&l, case, id, Some("aariz-cepha29"), Some(kind)); }   // Aariz placed them (review I4)
        let n_b = l.point_checks(&b).unwrap()[0].id;
        l.resolve_point_check(n_b, "accepted", "Dr A").unwrap();
        let both = l.point_check_counts("Dr A").unwrap();
        println!("both films live: {both:?}");
        assert_eq!(both, [("Go".to_string(), 1, 0), ("N".to_string(), 2, 2)]);
        l.delete(&b).unwrap();
        let live = l.point_check_counts("Dr A").unwrap();
        println!("film b in Recently deleted: {live:?}");
        assert_eq!(live, [("Go".to_string(), 1, 0), ("N".to_string(), 1, 1)], "the film flag is not a point; film b not counted");
    }

    /// Task 8 ruling: Models… counts the LATEST run of each (film, model) on live films, the flags the screen
    /// shows, never a superseded run's. Positive control: drop `{LATEST}` from `point_check_counts` -> the older run's N
    /// (flagged, accepted) is counted again and this fails. Also: a model's older run on a film whose newer run is clean
    /// counts nothing, and a second model's flag on the same film is counted separately.
    #[test] fn point_check_counts_reads_only_the_latest_run_of_each_model() {
        let (_t, mut l, a) = lib();
        let old = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(old, "flagged", vec![point("N"), point("Go")])).unwrap());
        for row in l.point_checks(&a).unwrap() { l.resolve_point_check(row.id, "accepted", "Dr A").unwrap(); }
        for id in ["N", "Go"] { pin(&l, &a, id, Some("aariz-cepha29"), None); }   // Aariz placed both (counted: review I4); unverified, so nothing is carried
        let before = l.point_check_counts("Dr A").unwrap();
        println!("one run, N and Go flagged and accepted: {before:?}");
        assert_eq!(before, [("Go".to_string(), 1, 1), ("N".to_string(), 1, 1)]);
        let newer = run(&mut l, &a, "aariz-cepha29");                          // a re-detect: the older run is superseded
        assert!(l.record_point_check(&a, &record(newer, "flagged", vec![point("N")])).unwrap());
        let other = run(&mut l, &a, "srpose-cldet23");
        assert!(l.record_point_check(&a, &record(other, "flagged", vec![point("N")])).unwrap());
        let after = l.point_check_counts("Dr A").unwrap();
        println!("older run superseded; newer run flags N (unresolved); a second model flags N: {after:?}");
        assert_eq!(after, [("N".to_string(), 1, 0)], "the older run's N and Go are not counted; of the two latest runs' N, only the placer's (review I4)");
        let clean = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(clean, "clean", vec![])).unwrap());
        let last = l.point_check_counts("Dr A").unwrap();
        println!("the first model's newest run is clean: {last:?}");
        assert_eq!(last, [], "the second model's N is never shown: Aariz placed N (review I4)");
    }

    /// Edge: a locked (signed-off) film. Reads are never refused, and resolving is looking, not editing, so it is
    /// allowed on a signed-off film and leaves the sign-off as it was.
    #[test] fn a_signed_off_film_reads_and_resolves() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(r, "flagged", vec![point("N")])).unwrap());
        l.set_verified(&a, true, "Dr A").unwrap();
        let signed = l.load(&a).unwrap().verified_at.clone();
        assert!(signed.is_some());
        let rows = l.point_checks(&a).unwrap();
        let resolved = l.resolve_point_check(rows[0].id, "accepted", "Dr A").unwrap();
        println!("signed-off film: {} flag(s) read; resolved = {resolved}; still signed off = {:?}", rows.len(), l.load(&a).unwrap().verified_at);
        assert!(resolved);
        assert_eq!(l.load(&a).unwrap().verified_at, signed, "the sign-off is untouched");
        assert!(l.unresolved_point_checks(&a, "aariz-cepha29").unwrap().is_empty());
    }
    /// Edge: closed then reopened — the same runs, flags and resolutions come back.
    #[test] fn a_check_survives_closing_and_reopening() {
        let (t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(r, "film-unusual", vec![point("N"), film_flag("N,S,Po,Ar")])).unwrap());
        let n = l.point_checks(&a).unwrap()[0].id;
        l.resolve_point_check(n, "placed", "Dr A").unwrap();
        let (runs, rows) = (l.point_check_runs(&a).unwrap(), l.point_checks(&a).unwrap());
        drop(l);
        let l = Library::open(t.path()).unwrap();
        println!("reopened: {} run(s), {} flag(s), resolved {:?}", l.point_check_runs(&a).unwrap().len(), l.point_checks(&a).unwrap().len(),
            l.point_checks(&a).unwrap().iter().map(|r| r.resolved.clone()).collect::<Vec<_>>());
        assert_eq!((l.point_check_runs(&a).unwrap(), l.point_checks(&a).unwrap()), (runs, rows));
    }
    /// Edge: too few points — a `not-run` record with 11 present and no flag, read back as recorded; and `not-set-up`.
    #[test] fn a_run_with_too_few_points_is_recorded_as_not_run() {
        let (_t, mut l, a) = lib();
        let (r, s) = (run(&mut l, &a, "aariz-cepha29"), run(&mut l, &a, "srpose-cldet23"));
        let few = PointCheckRecord { not_run_reason: Some("too-few-points".into()), present: Some(11), ..record(r, "not-run", vec![]) };
        let unset = PointCheckRecord { prior_sha256: None, prior_films: None, not_run_reason: Some("not-set-up".into()), present: None, ..record(s, "not-run", vec![]) };
        assert!(l.record_point_check(&a, &few).unwrap());
        assert!(l.record_point_check(&a, &unset).unwrap());
        let runs = l.point_check_runs(&a).unwrap();
        println!("not run: {runs:?}");
        assert_eq!(runs, [("aariz-cepha29".to_string(), few), ("srpose-cldet23".to_string(), unset)]);
        assert!(l.point_checks(&a).unwrap().is_empty());
    }

    /// Task 5: the check reads exactly the run it was given, by id (never "the model's newest"), with its film. Fails if
    /// the read picked the newest run of the model (the second run's points would come back for the first id) or lost
    /// the facing.
    #[test] fn a_run_is_read_by_its_id_with_its_film() {
        let (_t, mut l, a) = lib();
        let p = |x: f64| crate::AiPoint { channel: 0, landmark_id: Some("N".into()), x, y: 2.0, peak: 1.0 };
        let first = l.record_ai_run(&a, &AiRun { model_id: "aariz-cepha29".into(), execution_provider: "cpu".into(), facing: "left".into(), total_ms: 1.0, model_sha256: None }, &[p(1.0)]).unwrap();
        let second = l.record_ai_run(&a, &AiRun { model_id: "aariz-cepha29".into(), execution_provider: "cpu".into(), facing: "right".into(), total_ms: 1.0, model_sha256: None }, &[p(9.0)]).unwrap();
        let (film, run) = l.ai_run(first).unwrap().expect("the first run");
        assert_eq!((film.as_str(), run.model_id.as_str(), run.facing.as_str(), run.points[0].x), (a.as_str(), "aariz-cepha29", "left", 1.0));
        assert_eq!(l.ai_run(second).unwrap().unwrap().1.points[0].x, 9.0);
        assert_eq!(l.ai_run(second + 99).unwrap(), None);
    }

    // ---- Final fix wave (whole-branch review I2, I3, I4, M9) ----

    /// A pin on the film, written straight into `landmarks` (the store's own tests; a save would also write events).
    /// `placed_by` None is a hand-placed point; `kind` is how it was accepted (None: not verified).
    fn pin(l: &Library, case: &str, id: &str, placed_by: Option<&str>, kind: Option<&str>) {
        let source = match (placed_by, kind) { (None, _) | (_, Some("hand")) => "manual", (_, Some("drag")) => "ai-adjusted", _ => "ai" };
        l.conn.execute(&format!("INSERT INTO landmarks (case_id, id, x, y, source, verified, ai_x, ai_y, confidence, placed_by, accept_kind, updated_at)
            VALUES (?1, ?2, 1.0, 2.0, ?3, ?4, 1.0, 2.0, NULL, ?5, ?6, {NOW})
            ON CONFLICT (case_id, id) DO UPDATE SET source = excluded.source, verified = excluded.verified, placed_by = excluded.placed_by, accept_kind = excluded.accept_kind"),
            params![case, id, source, kind.is_some() as i64, placed_by, kind]).unwrap();
    }

    /// I2 (owner ruling "Hold sign-off", enforced in the store): while the latest check of any model on the film holds an
    /// unresolved film note, `set_verified(true)` is refused with the screen's own words and nothing changes; reopening is
    /// never refused; once Checked is pressed it signs. A superseded run's unresolved note holds nothing (only the latest
    /// run is shown). Induced failure: remove the film-note query from `set_verified` -> the first sign-off succeeds and
    /// this fails.
    #[test] fn the_store_refuses_sign_off_while_a_film_note_is_unresolved() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(r, "film-unusual", vec![film_flag("N,S,Po,Ar")])).unwrap());
        let e = l.set_verified(&a, true, "Dr A");
        println!("I2, film note unresolved: {:?}; signed = {:?}", e.as_ref().map_err(|e| format!("{e:#}")), l.load(&a).unwrap().verified_at);
        assert_eq!(format!("{:#}", e.unwrap_err()), "Press Checked on the film note first.");
        assert_eq!(l.load(&a).unwrap().verified_at, None, "nothing signed");
        l.set_verified(&a, false, "Dr A").unwrap();                         // reopening is never held
        let film = l.point_checks(&a).unwrap()[0].id;
        assert!(l.resolve_point_check(film, "film-checked", "Dr A").unwrap());
        l.set_verified(&a, true, "Dr A").unwrap();
        println!("I2, after Checked: signed = {:?}", l.load(&a).unwrap().verified_at);
        assert!(l.load(&a).unwrap().verified_at.is_some());
        // A second model's unresolved note holds it too; a newer clean run of that model supersedes its note.
        l.set_verified(&a, false, "Dr A").unwrap();
        let s = run(&mut l, &a, "srpose-cldet23");
        assert!(l.record_point_check(&a, &record(s, "film-unusual", vec![film_flag("Go,Ar,Po,Or")])).unwrap());
        assert!(l.set_verified(&a, true, "Dr A").is_err(), "any model's unresolved note holds the sign-off");
        let s2 = run(&mut l, &a, "srpose-cldet23");
        assert!(l.record_point_check(&a, &record(s2, "clean", vec![])).unwrap());
        l.set_verified(&a, true, "Dr A").unwrap();
        // Another film's note never holds this one.
        let (_t2, mut l2, b) = lib();
        let rb = run(&mut l2, &b, "aariz-cepha29");
        assert!(l2.record_point_check(&b, &record(rb, "flagged", vec![point("N")])).unwrap());
        l2.set_verified(&b, true, "Dr A").unwrap();                          // a point flag never holds the sign-off
    }

    /// I3: a Re-detect by the same model that flags a point you already looked at (verified on its own) carries that look
    /// to the new run's flag: same `how`, same operator, same time, so the habit offset's read and Models… stay right.
    /// The failure it guards: the new flag was a fresh unresolved row that nothing could draw or resolve, so the film
    /// left that model's habit for good. Induced failure: remove the carry from `record_point_check` -> the unresolved
    /// read has N again and this fails. Edges: a pin verified by a bulk accept, a pin no longer verified, and a point
    /// the earlier run did not flag carry nothing; another model's resolution is not carried to this model.
    #[test] fn a_redetect_carries_the_resolution_of_a_point_you_looked_at() {
        let (_t, mut l, a) = lib();
        let r1 = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(r1, "flagged", vec![point("N"), point("Go"), point("Me")])).unwrap());
        let rows = l.point_checks(&a).unwrap();
        let by = |id: &str| rows.iter().find(|x| x.flag.landmark_id.as_deref() == Some(id)).unwrap().id;
        assert!(l.resolve_point_check(by("N"), "accepted", "Dr A").unwrap());
        assert!(l.resolve_point_check(by("Go"), "moved", "Dr B").unwrap());
        pin(&l, &a, "N", Some("aariz-cepha29"), Some("single"));
        pin(&l, &a, "Go", Some("aariz-cepha29"), Some("drag"));
        pin(&l, &a, "Me", Some("aariz-cepha29"), Some("bulk"));             // never looked at on its own
        pin(&l, &a, "B", Some("aariz-cepha29"), None);                      // not verified
        let then: Vec<(String, String, String)> = l.conn.prepare("SELECT how, operator, resolved_at FROM point_check_resolutions ORDER BY check_id").unwrap()
            .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(|r| r.unwrap()).collect();
        let r2 = run(&mut l, &a, "aariz-cepha29");                            // Re-detect: the same marks, the same flags, and B
        assert!(l.record_point_check(&a, &record(r2, "flagged", vec![point("N"), point("Go"), point("Me"), point("B")])).unwrap());
        let now = l.point_checks(&a).unwrap();
        let open: Vec<_> = l.unresolved_point_checks(&a, "aariz-cepha29").unwrap().into_iter().filter_map(|x| x.flag.landmark_id).collect();
        println!("I3, after Re-detect: {:?}; unresolved = {open:?}", now.iter().map(|x| (x.flag.landmark_id.clone(), x.resolved.clone())).collect::<Vec<_>>());
        assert!(now.iter().all(|x| x.run_id == r2), "the instrument reads the new run");
        assert_eq!(now.len(), 4, "rows compared: 4");
        assert_eq!(open, ["Me", "B"], "N and Go carried; Me (bulk) and B (not verified) stay open");
        let carried: Vec<(String, String, String)> = l.conn.prepare("SELECT r.how, r.operator, r.resolved_at FROM point_check_resolutions r
            JOIN point_checks c ON c.id = r.check_id WHERE c.run_id = ?1 ORDER BY c.id").unwrap()
            .query_map([r2], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(carried, then, "the same look: how, who and when");
        // Another model flagging N for the first time carries nothing (its own earlier run never flagged N).
        let s = run(&mut l, &a, "srpose-cldet23");
        assert!(l.record_point_check(&a, &record(s, "flagged", vec![point("N")])).unwrap());
        assert_eq!(l.unresolved_point_checks(&a, "srpose-cldet23").unwrap().len(), 1);
        // The pin later un-verified (⌘Z): a further Re-detect carries nothing for it.
        pin(&l, &a, "N", Some("aariz-cepha29"), None);
        let r3 = run(&mut l, &a, "aariz-cepha29");
        assert!(l.record_point_check(&a, &record(r3, "flagged", vec![point("N")])).unwrap());
        assert_eq!(l.unresolved_point_checks(&a, "aariz-cepha29").unwrap().len(), 1, "N is shown again, so it is open again");
    }

    /// I4 and M9: Models… counts only the flag of the model that placed the point (the one the screen draws and the report
    /// prints), once per point per film, and "you left it" counts only the current operator's accepts. A point placed by
    /// hand after its flag (`placed`) still counts as flagged once. Induced failure: drop the join to `landmarks` -> the
    /// non-placing model's flag at N is counted (N flagged 2) and this fails; drop the operator filter -> Dr B's accept
    /// counts for Dr A.
    #[test] fn point_check_counts_count_only_the_placing_models_flag_and_your_own_accepts() {
        let (t, mut l, a) = lib();
        let b = film(&mut l, t.path(), "SYNTHETIC-b.png", 80);
        let (az, sr) = (run(&mut l, &a, "aariz-cepha29"), run(&mut l, &a, "srpose-cldet23"));
        assert!(l.record_point_check(&a, &record(az, "flagged", vec![point("N")])).unwrap());
        assert!(l.record_point_check(&a, &record(sr, "flagged", vec![point("N"), point("Go"), point("Me")])).unwrap());
        pin(&l, &a, "N", Some("aariz-cepha29"), Some("single"));           // Aariz placed N: its flag is the one shown
        pin(&l, &a, "Go", Some("aariz-cepha29"), None);                     // SRPose flagged Go, but Aariz placed it: never shown
        pin(&l, &a, "Me", None, Some("hand"));                              // placed by hand after SRPose's flag
        for row in l.point_checks(&a).unwrap() {
            let how = if row.flag.landmark_id.as_deref() == Some("Me") { "placed" } else { "accepted" };
            if row.flag.landmark_id.as_deref() != Some("Go") { l.resolve_point_check(row.id, how, "Dr A").unwrap(); }
        }
        let rb = run(&mut l, &b, "aariz-cepha29");
        assert!(l.record_point_check(&b, &record(rb, "flagged", vec![point("N")])).unwrap());
        pin(&l, &b, "N", Some("aariz-cepha29"), Some("single"));
        l.resolve_point_check(l.point_checks(&b).unwrap()[0].id, "accepted", "Dr B").unwrap();
        let mine = l.point_check_counts("Dr A").unwrap();
        println!("I4/M9, Dr A: {mine:?}; Dr B: {:?}", l.point_check_counts("Dr B").unwrap());
        assert_eq!(mine, [("Me".to_string(), 1, 0), ("N".to_string(), 2, 1)], "Go (never shown) not counted; N once per film; Dr B's accept not yours");
        assert_eq!(l.point_check_counts("Dr B").unwrap(), [("Me".to_string(), 1, 0), ("N".to_string(), 2, 1)]);
    }
}
