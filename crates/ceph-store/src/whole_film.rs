//! Format 20 — SC-1 Part 1, the whole-film check (spec 2026-11-03 §8). A note only: these methods write format 20's
//! own five tables and nothing else; no point is ever moved or changed here. Every row is append-only (020's triggers):
//! nothing is ever amended, and rows go only with their film, when Recently deleted is emptied.
use crate::library::{Library, NOW};
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};

/// One of a region finder run's five boxes, in film px. `found` false: no corners (NULL), as 020 requires. A box whose
/// corners are not strictly ordered (`x0 < x1`, `y0 < y1`) can never be stored found: the caller records it as not
/// found (Task 7 treats a degenerate box as "not found"), or the whole run is refused.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionBoxRow { pub region: String, pub found: bool, pub x0: Option<f64>, pub y0: Option<f64>, pub x1: Option<f64>, pub y1: Option<f64>, pub score: f64 }
/// One region finder run on a film: which model file (its fingerprint), its version, the facing it read, and its boxes.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionRunRecord { pub model_fingerprint: String, pub model_version: String, pub facing: Option<String>, pub boxes: Vec<RegionBoxRow> }
/// One reason a check flagged: `mirrored`, `shape`, `region` (with its region and a `detail`), `size`, `facing` or `no-ceph-found`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeFilmReasonRow { pub reason: String, pub region: Option<String>, pub detail: Option<String> }
/// One whole-film check as the check decided it (Tasks 2 and 7). `subject` is `run` (a model run, `run_id` set) or
/// `final` (the tracing at "Mark tracing verified", no run). `tau` is in the canonical region order: cranial base,
/// maxilla, mandible, incisors, soft-tissue profile (`tau_cranial_base` … `tau_soft_tissue`).
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeFilmRecord { pub subject: String, pub run_id: Option<i64>, pub rule_version: String,
    pub prior_sha256: Option<String>, pub prior_films: Option<i64>, pub region_run_id: Option<i64>, pub tau: Option<[f64; 5]>,
    pub outcome: String, pub shape_look: String, pub region_look: String, pub present: i64,
    pub d2: Option<f64>, pub d2_mirror: Option<f64>, pub line: Option<f64>,
    /// The size look (`sc1-size/1`): its status key (`judged`, `not-set-up`, `no-region-model`, `film-too-small`, `too-few`, as
    /// `ExtraLook`'s keys) and, when judged, (q, centre, line).
    pub size_look: String, pub size: Option<(f64, f64, f64)>,
    /// The cranial-base centre look (`sc1-cb-centre/1`): its status key (the same five as `size_look`) and, when judged, (distance, line).
    pub cb_look: String, pub cb: Option<(f64, f64)>,
    /// How many of S, N, Po, Ar, Or were traced (0 to 5; 0 on a whole-film/1 row): separates "a cranial-base point is missing" from "all five, but no cranial-base box" when `cb_look` is `too-few`.
    pub cb_present: i64,
    pub reasons: Vec<WholeFilmReasonRow> }
/// The reason given on `Checked` (RV-2), stored with 020's `CHECK`; one of three, never free text.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ResolveReason { TracingRight, ExpectedVariant, CorrectedTracing }
impl ResolveReason {
    /// The stored key, exactly as 020's `CHECK` lists it.
    pub fn key(self) -> &'static str {
        match self { Self::TracingRight => "tracing-right", Self::ExpectedVariant => "expected-variant", Self::CorrectedTracing => "corrected-tracing" }
    }
    pub fn from_key(k: &str) -> Option<Self> {
        [Self::TracingRight, Self::ExpectedVariant, Self::CorrectedTracing].into_iter().find(|r| r.key() == k)
    }
}
/// How a check was resolved: the reason key, who, and when.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeFilmResolution { pub reason: String, pub operator: String, pub resolved_at: String }
/// A stored check with its id, its run's model (None for a final check) and its resolution, if any.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeFilmRow { pub id: i64, pub model_id: Option<String>, pub checked_at: String, pub record: WholeFilmRecord, pub resolved: Option<WholeFilmResolution> }

/// The five regions in the canonical order (cranial base, maxilla, mandible, incisors, soft-tissue profile).
const REGION_ORDER: &str = "CASE region WHEN 'cranial-base' THEN 0 WHEN 'maxilla' THEN 1 WHEN 'mandible' THEN 2 WHEN 'incisors' THEN 3 ELSE 4 END";
const CHECK_COLS: &str = "w.id, a.model_id, w.checked_at, w.subject, w.run_id, w.rule_version, w.prior_sha256, w.prior_films, w.region_run_id, \
    w.tau_cranial_base, w.tau_maxilla, w.tau_mandible, w.tau_incisors, w.tau_soft_tissue, w.outcome, w.shape_look, w.region_look, w.present, \
    w.d2, w.d2_mirror, w.line, r.reason, r.operator, r.resolved_at, w.size_look, w.size_q, w.size_centre, w.size_line, w.cb_distance, w.cb_line, w.cb_look, w.cb_present";
/// The newest run of each model on its film: the only run whose check is shown or read (as Stage A's `LATEST`).
const LATEST_RUN: &str = "a.id = (SELECT MAX(id) FROM ai_runs WHERE case_id = a.case_id AND model_id = a.model_id)";

fn row_from(r: &rusqlite::Row) -> rusqlite::Result<WholeFilmRow> {
    let tau: [Option<f64>; 5] = [r.get(9)?, r.get(10)?, r.get(11)?, r.get(12)?, r.get(13)?];
    let tau = match tau { [Some(a), Some(b), Some(c), Some(d), Some(e)] => Some([a, b, c, d, e]), _ => None };
    let reason: Option<String> = r.get(21)?;
    let (sq, sc, sl): (Option<f64>, Option<f64>, Option<f64>) = (r.get(25)?, r.get(26)?, r.get(27)?);
    let (cd, cl): (Option<f64>, Option<f64>) = (r.get(28)?, r.get(29)?);
    Ok(WholeFilmRow { id: r.get(0)?, model_id: r.get(1)?, checked_at: r.get(2)?,
        record: WholeFilmRecord { subject: r.get(3)?, run_id: r.get(4)?, rule_version: r.get(5)?, prior_sha256: r.get(6)?, prior_films: r.get(7)?,
            region_run_id: r.get(8)?, tau, outcome: r.get(14)?, shape_look: r.get(15)?, region_look: r.get(16)?, present: r.get(17)?,
            d2: r.get(18)?, d2_mirror: r.get(19)?, line: r.get(20)?, size_look: r.get(24)?,
            size: match (sq, sc, sl) { (Some(a), Some(b), Some(c)) => Some((a, b, c)), _ => None },
            cb_look: r.get(30)?, cb_present: r.get(31)?, cb: match (cd, cl) { (Some(a), Some(b)) => Some((a, b)), _ => None }, reasons: vec![] },
        resolved: match reason { Some(reason) => Some(WholeFilmResolution { reason, operator: r.get(22)?, resolved_at: r.get(23)? }), None => None } })
}

impl Library {
    /// Records one region finder run on a film and its boxes, in one transaction; returns the run's id. A run already
    /// stored for this film and model file (fingerprint) returns that run's id and writes nothing (`ON CONFLICT DO
    /// NOTHING` on the pair; a CHECK refusal is still an error). A box 020 refuses (a found box whose corners are not
    /// strictly ordered, a score outside 0–1) refuses the whole run: the caller stores a degenerate box as not found.
    pub fn record_film_regions(&mut self, case_id: &str, r: &RegionRunRecord) -> anyhow::Result<i64> {
        let tx = self.conn.transaction()?;
        let n = tx.execute(&format!("INSERT INTO film_regions (case_id, model_fingerprint, model_version, facing, found_at)
            VALUES (?1, ?2, ?3, ?4, {NOW}) ON CONFLICT (case_id, model_fingerprint) DO NOTHING"),
            params![case_id, r.model_fingerprint, r.model_version, r.facing])?;
        let id: i64 = tx.query_row("SELECT id FROM film_regions WHERE case_id = ?1 AND model_fingerprint = ?2", params![case_id, r.model_fingerprint], |x| x.get(0))?;
        if n == 1 {
            let mut st = tx.prepare("INSERT INTO film_region_boxes (run_id, region, found, x0, y0, x1, y1, score) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")?;
            for b in &r.boxes { st.execute(params![id, b.region, b.found, b.x0, b.y0, b.x1, b.y1, b.score])?; }
        }
        tx.commit()?;
        Ok(id)
    }
    /// The film's region finder run by that model file, with its boxes in the canonical region order; None when there
    /// is none.
    pub fn film_regions(&self, case_id: &str, fingerprint: &str) -> anyhow::Result<Option<(i64, RegionRunRecord)>> {
        let run: Option<(i64, String, String, Option<String>)> = self.conn.query_row(
            "SELECT id, model_fingerprint, model_version, facing FROM film_regions WHERE case_id = ?1 AND model_fingerprint = ?2",
            params![case_id, fingerprint], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?))).optional()?;
        let Some((id, model_fingerprint, model_version, facing)) = run else { return Ok(None) };
        let boxes = self.conn.prepare(&format!("SELECT region, found, x0, y0, x1, y1, score FROM film_region_boxes WHERE run_id = ?1 ORDER BY {REGION_ORDER}"))?
            .query_map([id], |r| Ok(RegionBoxRow { region: r.get(0)?, found: r.get(1)?, x0: r.get(2)?, y0: r.get(3)?, x1: r.get(4)?, y1: r.get(5)?, score: r.get(6)? }))?
            .collect::<Result<_, _>>()?;
        Ok(Some((id, RegionRunRecord { model_fingerprint, model_version, facing, boxes })))
    }

    /// The facing a stored region finder run read (`left` / `right`), None when it read none or there is no such run.
    pub fn region_run_facing(&self, run_id: i64) -> anyhow::Result<Option<String>> {
        Ok(self.conn.query_row("SELECT facing FROM film_regions WHERE id = ?1", [run_id], |r| r.get::<_, Option<String>>(0)).optional()?.flatten())
    }
    /// The boxes of one stored region finder run, by the run's id (as a check's `region_run_id` names it); empty when there is no such run.
    pub fn region_run_boxes(&self, run_id: i64) -> anyhow::Result<Vec<RegionBoxRow>> {
        let v = self.conn.prepare(&format!("SELECT region, found, x0, y0, x1, y1, score FROM film_region_boxes WHERE run_id = ?1 ORDER BY {REGION_ORDER}"))?
            .query_map([run_id], |r| Ok(RegionBoxRow { region: r.get(0)?, found: r.get(1)?, x0: r.get(2)?, y0: r.get(3)?, x1: r.get(4)?, y1: r.get(5)?, score: r.get(6)? }))?
            .collect::<Result<_, _>>()?;
        Ok(v)
    }

    /// Records one whole-film check and its reasons, in one transaction; returns its id, or None, writing nothing, when
    /// that model run was already checked (a run is checked once). A final check (no run) is always a new row. Refused,
    /// writing nothing: `flagged` with no reason, `clean` or `not-run` with a reason, a run or a region run of another
    /// film, and anything 020's CHECKs or unique indexes refuse (one reason twice, for one).
    pub fn record_whole_film_check(&mut self, case_id: &str, r: &WholeFilmRecord) -> anyhow::Result<Option<i64>> {
        let tx = self.conn.transaction()?;
        if let Some(run) = r.run_id {
            let owner: Option<String> = tx.query_row("SELECT case_id FROM ai_runs WHERE id = ?1", [run], |x| x.get(0)).optional()?;
            anyhow::ensure!(owner.as_deref() == Some(case_id), "model run {run} is not a run on film {case_id}");
        }
        if let Some(rr) = r.region_run_id {
            let owner: Option<String> = tx.query_row("SELECT case_id FROM film_regions WHERE id = ?1", [rr], |x| x.get(0)).optional()?;
            anyhow::ensure!(owner.as_deref() == Some(case_id), "region finder run {rr} is not a run on film {case_id}");
        }
        let fits = match r.outcome.as_str() { "flagged" => !r.reasons.is_empty(), "clean" | "not-run" => r.reasons.is_empty(), _ => true };
        anyhow::ensure!(fits, "a whole-film check `{}` with {} reason(s) can never be", r.outcome, r.reasons.len());
        let t = r.tau.map(|t| t.map(Some)).unwrap_or([None; 5]);
        let n = tx.execute(&format!("INSERT INTO whole_film_checks (case_id, subject, run_id, rule_version, prior_sha256, prior_films, region_run_id,
                tau_cranial_base, tau_maxilla, tau_mandible, tau_incisors, tau_soft_tissue, outcome, shape_look, region_look, present, d2, d2_mirror, line,
                size_look, size_q, size_centre, size_line, cb_distance, cb_line, cb_look, cb_present, checked_at)
            VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, {NOW}) ON CONFLICT DO NOTHING"),
            params![case_id, r.subject, r.run_id, r.rule_version, r.prior_sha256, r.prior_films, r.region_run_id, t[0], t[1], t[2], t[3], t[4],
                r.outcome, r.shape_look, r.region_look, r.present, r.d2, r.d2_mirror, r.line,
                r.size_look, r.size.map(|x| x.0), r.size.map(|x| x.1), r.size.map(|x| x.2), r.cb.map(|x| x.0), r.cb.map(|x| x.1), r.cb_look, r.cb_present])?;
        if n == 0 { return Ok(None); }
        let id = tx.last_insert_rowid();
        {
            let mut st = tx.prepare("INSERT INTO whole_film_check_reasons (check_id, reason, region, detail) VALUES (?1, ?2, ?3, ?4)")?;
            for x in &r.reasons { st.execute(params![id, x.reason, x.region, x.detail])?; }
        }
        tx.commit()?;
        Ok(Some(id))
    }

    fn whole_film_rows(&self, sql_where: &str, args: &[&dyn rusqlite::ToSql]) -> anyhow::Result<Vec<WholeFilmRow>> {
        let rows: Vec<WholeFilmRow> = self.conn.prepare(&format!("SELECT {CHECK_COLS} FROM whole_film_checks w
                LEFT JOIN ai_runs a ON a.id = w.run_id LEFT JOIN whole_film_check_resolutions r ON r.check_id = w.id
                WHERE {sql_where} ORDER BY w.subject = 'final', w.id DESC"))?
            .query_map(args, row_from)?.collect::<Result<_, _>>()?;
        let mut st = self.conn.prepare("SELECT reason, region, detail FROM whole_film_check_reasons WHERE check_id = ?1 ORDER BY rowid")?;
        rows.into_iter().map(|row| {
            let reasons = st.query_map([row.id], |r| Ok(WholeFilmReasonRow { reason: r.get(0)?, region: r.get(1)?, detail: r.get(2)? }))?
                .collect::<Result<_, _>>()?;
            Ok(WholeFilmRow { record: WholeFilmRecord { reasons, ..row.record }, ..row })
        }).collect()
    }
    /// The film's checks: each model's latest run's check (an older run's check never stands in), then every final
    /// check; each group newest first. Reasons in the order recorded.
    pub fn whole_film_checks(&self, case_id: &str) -> anyhow::Result<Vec<WholeFilmRow>> {
        self.whole_film_rows(&format!("w.case_id = ?1 AND (w.subject = 'final' OR {LATEST_RUN})"), &[&case_id])
    }
    /// Records `Checked` on a flagged check with one of the three reasons (RV-2), once: false, changing nothing, when
    /// it is already resolved (the first reason and who stay; never amended). Allowed on a signed-off film (OQ-6:
    /// looking, not editing). Refused (an error) for no such check, or a check that is not flagged.
    pub fn resolve_whole_film_check(&mut self, check_id: i64, reason: ResolveReason, operator: &str) -> anyhow::Result<bool> {
        let tx = self.conn.transaction()?;
        let outcome: Option<String> = tx.query_row("SELECT outcome FROM whole_film_checks WHERE id = ?1", [check_id], |r| r.get(0)).optional()?;
        let outcome = outcome.ok_or_else(|| anyhow::anyhow!("no whole-film check {check_id}"))?;
        anyhow::ensure!(outcome == "flagged", "whole-film check {check_id} is `{outcome}`: only a flagged check is Checked");
        let n = tx.execute(&format!("INSERT INTO whole_film_check_resolutions (check_id, how, reason, operator, resolved_at) VALUES (?1, 'checked', ?2, ?3, {NOW})
            ON CONFLICT (check_id) DO NOTHING"), params![check_id, reason.key(), operator])?;
        tx.commit()?;
        Ok(n == 1)
    }
    /// The habit's read (spec §7): the flagged checks not yet resolved among (a) `model_id`'s latest run's check on the
    /// film and (b) the film's latest final check. Resolved with any reason → not returned (RV-2). A film checked before
    /// format 20 has no row and returns nothing. The run's check first, then the final's. A final check belongs to a sign-off:
    /// it is read only while the film is signed off and the check was made at or after that sign-off (N1/N5).
    pub fn unresolved_whole_film_checks(&self, case_id: &str, model_id: &str) -> anyhow::Result<Vec<WholeFilmRow>> {
        self.whole_film_rows(&format!("w.case_id = ?1 AND w.outcome = 'flagged' AND r.check_id IS NULL AND (
                (w.subject = 'run' AND a.model_id = ?2 AND {LATEST_RUN})
             OR (w.subject = 'final' AND w.id = (SELECT MAX(id) FROM whole_film_checks WHERE case_id = w.case_id AND subject = 'final')
                 AND EXISTS (SELECT 1 FROM cases c WHERE c.id = w.case_id AND c.verified_at IS NOT NULL AND w.checked_at >= c.verified_at)))"),
            &[&case_id, &model_id])
    }
    /// Whether the film is in Recently deleted. An error for a film the library does not hold.
    pub fn is_deleted(&self, case_id: &str) -> anyhow::Result<bool> {
        let d: Option<bool> = self.conn.query_row("SELECT deleted_at IS NOT NULL FROM cases WHERE id = ?1", [case_id], |r| r.get(0)).optional()?;
        d.ok_or_else(|| anyhow::anyhow!("no film {case_id}"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::AiRun;
    use std::path::Path;

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
    const REGIONS: [&str; 5] = ["cranial-base", "maxilla", "mandible", "incisors", "soft-tissue"];
    /// Five boxes in the canonical order; the soft-tissue profile not found.
    fn regions(fp: char) -> RegionRunRecord {
        RegionRunRecord { model_fingerprint: fp.to_string().repeat(64), model_version: "rf-detr-m/1".into(), facing: Some("right".into()),
            boxes: REGIONS.iter().enumerate().map(|(i, r)| if *r == "soft-tissue" {
                RegionBoxRow { region: (*r).into(), found: false, x0: None, y0: None, x1: None, y1: None, score: 0.2 }
            } else {
                let k = i as f64 * 10.0;
                RegionBoxRow { region: (*r).into(), found: true, x0: Some(k), y0: Some(k + 1.0), x1: Some(k + 20.0), y1: Some(k + 30.0), score: 0.9 }
            }).collect() }
    }
    fn mirrored() -> WholeFilmReasonRow { WholeFilmReasonRow { reason: "mirrored".into(), region: None, detail: None } }
    fn region_reason(region: &str, detail: &str) -> WholeFilmReasonRow { WholeFilmReasonRow { reason: "region".into(), region: Some(region.into()), detail: Some(detail.into()) } }
    /// A check with the shape judged and no region model; `subject` `run` takes `run_id`.
    fn check(run_id: Option<i64>, outcome: &str, reasons: Vec<WholeFilmReasonRow>) -> WholeFilmRecord {
        WholeFilmRecord { subject: if run_id.is_some() { "run" } else { "final" }.into(), run_id, rule_version: "whole-film/1".into(),
            prior_sha256: Some("a".repeat(64)), prior_films: Some(300), region_run_id: None, tau: None, outcome: outcome.into(),
            shape_look: "judged".into(), region_look: "no-region-model".into(), present: 19, d2: Some(12.0), d2_mirror: Some(80.0), line: Some(30.0),
            size_look: "not-set-up".into(), size: None, cb_look: "not-set-up".into(), cb: None, cb_present: 0, reasons }
    }
    /// `check`, with the regions judged on region run `region_run_id`.
    fn with_regions(r: WholeFilmRecord, region_run_id: i64) -> WholeFilmRecord {
        WholeFilmRecord { region_run_id: Some(region_run_id), tau: Some([0.11, 0.12, 0.13, 0.14, 0.15]), region_look: "judged".into(), ..r }
    }
    const TABLES: [&str; 5] = ["film_regions", "film_region_boxes", "whole_film_checks", "whole_film_check_reasons", "whole_film_check_resolutions"];
    /// Rows of the five tables that belong to `case_id`, in `TABLES` order.
    fn counts(l: &Library, case_id: &str) -> [i64; 5] {
        let q = |sql: &str| l.conn.query_row(sql, [case_id], |r| r.get::<_, i64>(0)).unwrap();
        [q("SELECT COUNT(*) FROM film_regions WHERE case_id = ?1"),
         q("SELECT COUNT(*) FROM film_region_boxes b JOIN film_regions r ON r.id = b.run_id WHERE r.case_id = ?1"),
         q("SELECT COUNT(*) FROM whole_film_checks WHERE case_id = ?1"),
         q("SELECT COUNT(*) FROM whole_film_check_reasons x JOIN whole_film_checks w ON w.id = x.check_id WHERE w.case_id = ?1"),
         q("SELECT COUNT(*) FROM whole_film_check_resolutions x JOIN whole_film_checks w ON w.id = x.check_id WHERE w.case_id = ?1")]
    }
    fn all_counts(l: &Library) -> [i64; 5] { TABLES.map(|t| l.conn.query_row(&format!("SELECT COUNT(*) FROM {t}"), [], |r| r.get(0)).unwrap()) }
    /// A film holding a row in each of the five tables: a region run with five boxes, a flagged run check with two
    /// reasons and its resolution, and a flagged final check with one reason. Returns (region run id, run check id).
    fn fill(l: &mut Library, case_id: &str) -> (i64, i64) {
        let rr = l.record_film_regions(case_id, &regions('f')).unwrap();
        let r = run(l, case_id, "aariz-cepha29");
        let c = l.record_whole_film_check(case_id, &with_regions(check(Some(r), "flagged", vec![mirrored(), region_reason("mandible", "Me=0.214,Gn=0.198,Pog=off-film")]), rr)).unwrap().unwrap();
        assert!(l.resolve_whole_film_check(c, ResolveReason::TracingRight, "Dr A").unwrap());
        l.record_whole_film_check(case_id, &check(None, "flagged", vec![WholeFilmReasonRow { reason: "shape".into(), region: None, detail: Some("ANB,SNB".into()) }])).unwrap().unwrap();
        (rr, c)
    }

    /// Test 4's instrument: every UPDATE and every DELETE of a live film's row in the five tables, each tried inside a
    /// savepoint that is always rolled back. Returns (what, Ok(rows changed) or Err(message)).
    fn try_to_change(l: &Library, case_id: &str) -> Vec<(&'static str, Result<usize, String>)> {
        let id = |sql: &str| l.conn.query_row(sql, [case_id], |r| r.get::<_, i64>(0)).unwrap();
        let rr = id("SELECT MIN(id) FROM film_regions WHERE case_id = ?1");
        let c = id("SELECT MIN(id) FROM whole_film_checks WHERE case_id = ?1");
        let tries: Vec<(&'static str, String)> = vec![
            ("update a region run", format!("UPDATE film_regions SET model_version = 'other/1' WHERE id = {rr}")),
            ("update a box", format!("UPDATE film_region_boxes SET score = 0.5 WHERE run_id = {rr} AND region = 'maxilla'")),
            ("update a check", format!("UPDATE whole_film_checks SET outcome = 'clean' WHERE id = {c}")),
            ("update a reason", format!("UPDATE whole_film_check_reasons SET detail = 'Me=0.100' WHERE check_id = {c} AND reason = 'region'")),
            ("update a resolution", format!("UPDATE whole_film_check_resolutions SET reason = 'expected-variant' WHERE check_id = {c}")),
            ("delete a resolution", format!("DELETE FROM whole_film_check_resolutions WHERE check_id = {c}")),
            ("delete a reason", format!("DELETE FROM whole_film_check_reasons WHERE check_id = {c} AND reason = 'mirrored'")),
            ("delete a check", format!("DELETE FROM whole_film_checks WHERE id = {c}")),
            ("delete a box", format!("DELETE FROM film_region_boxes WHERE run_id = {rr} AND region = 'maxilla'")),
            ("delete a region run", format!("DELETE FROM film_regions WHERE id = {rr}")),
        ];
        tries.into_iter().map(|(what, sql)| {
            l.conn.execute_batch("SAVEPOINT try").unwrap();
            let e = l.conn.execute(&sql, []).map_err(|e| e.to_string());
            l.conn.execute_batch("ROLLBACK TO try; RELEASE try").unwrap();
            (what, e)
        }).collect()
    }
    const REFUSALS: [&str; 10] = ["a region finder run is never changed", "a region box is never changed", "a whole-film check is never changed",
        "a whole-film reason is never changed", "a resolution and its reason are never amended", "a resolution is removed only with its film",
        "a whole-film reason is removed only with its film", "a whole-film check is removed only with its film", "a region box is removed only with its film",
        "a region finder run is removed only with its film"];

    /// Test 4: nothing in the five tables is ever changed, and nothing of a live film is removed; emptying Recently
    /// deleted removes every one of the film's rows (cascade); a film restored from Recently deleted keeps its rows.
    /// Fails if a trigger is dropped (`format_20_control_without_the_triggers_the_refusals_pass`), or a cascade from the
    /// film is dropped (the purge is refused, or leaves rows).
    #[test] fn format_20_is_append_only() {
        let (t, mut l, a) = lib();
        let b = film(&mut l, t.path(), "SYNTHETIC-b.png", 80);
        fill(&mut l, &a);
        fill(&mut l, &b);
        let tried = try_to_change(&l, &a);
        for (what, e) in &tried { println!("{what}: {e:?}"); }
        assert_eq!(tried.len(), 10);
        for ((what, e), msg) in tried.iter().zip(REFUSALS) {
            assert!(e.as_ref().is_err_and(|e| e.contains(msg)), "{what} must be refused with `{msg}`: {e:?}");
        }
        let (ca, cb) = (counts(&l, &a), counts(&l, &b));
        println!("before: film a {ca:?}, film b {cb:?}");
        assert_eq!(ca, [1, 5, 2, 3, 1]);
        l.delete(&a).unwrap();
        l.delete(&b).unwrap();
        assert!(l.is_deleted(&a).unwrap());
        assert_eq!(counts(&l, &a), ca, "Recently deleted keeps the rows");
        l.restore(&b).unwrap();
        assert_eq!(l.purge_deleted(0).unwrap(), 1, "film a emptied from Recently deleted");
        println!("after emptying film a: film a {:?}, film b {:?}, all {:?}", counts(&l, &a), counts(&l, &b), all_counts(&l));
        assert_eq!(counts(&l, &a), [0; 5], "every one of film a's rows went with it");
        assert_eq!(all_counts(&l), cb, "film b, restored, keeps every row and is the only one left");
        assert_eq!(l.whole_film_checks(&b).unwrap().len(), 2);
    }
    /// Test 4's positive control: with the ten triggers dropped (in this test's own library), every refusal above passes
    /// through, so the test above would fail.
    #[test] fn format_20_control_without_the_triggers_the_refusals_pass() {
        let (_t, mut l, a) = lib();
        fill(&mut l, &a);
        let triggers: Vec<String> = l.conn.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' AND (tbl_name LIKE 'film_region%' OR tbl_name LIKE 'whole_film_check%')").unwrap()
            .query_map([], |r| r.get(0)).unwrap().collect::<Result<_, _>>().unwrap();
        assert_eq!(triggers.len(), 10, "{triggers:?}");
        for tr in &triggers { l.conn.execute_batch(&format!("DROP TRIGGER {tr}")).unwrap(); }
        let tried = try_to_change(&l, &a);
        println!("without the triggers: {tried:?}");
        assert!(tried.iter().all(|(_, e)| e == &Ok(1)), "{tried:#?}");
    }

    /// Test 9a and the edge case "a region model that changes": one run per (film, fingerprint); the same fingerprint
    /// again returns the same id and writes nothing (even with other boxes); a second fingerprint is a second run, both
    /// kept; boxes read back in the canonical order. Fails if the conflict writes or errors, or a run is replaced.
    #[test] fn a_region_run_is_recorded_once_per_model_file() {
        let (_t, mut l, a) = lib();
        let first = l.record_film_regions(&a, &regions('f')).unwrap();
        let mut other = regions('f');
        other.boxes.truncate(2);
        other.model_version = "rf-detr-m/2".into();
        let again = l.record_film_regions(&a, &other).unwrap();
        println!("same fingerprint twice: {first} then {again}; rows {:?}", counts(&l, &a));
        assert_eq!((again, counts(&l, &a)), (first, [1, 5, 0, 0, 0]));
        let second = l.record_film_regions(&a, &regions('e')).unwrap();
        println!("a region model that changes: runs {first} and {second}; rows {:?}", counts(&l, &a));
        assert_ne!(second, first);
        assert_eq!(counts(&l, &a), [2, 10, 0, 0, 0], "both kept");
        let (id, read) = l.film_regions(&a, &"f".repeat(64)).unwrap().unwrap();
        assert_eq!((id, read), (first, regions('f')), "read back exactly, boxes in the canonical order");
        assert_eq!(l.film_regions(&a, &"e".repeat(64)).unwrap().map(|x| x.0), Some(second));
        assert_eq!(l.film_regions(&a, &"d".repeat(64)).unwrap(), None);
    }
    /// Ruling P16: a degenerate found box (x0 >= x1) is refused by 020, and with it the whole run: nothing is written.
    /// The caller stores such a box as not found (no corners). Fails if a run is half-written.
    #[test] fn a_degenerate_found_box_refuses_the_whole_run_and_writes_nothing() {
        let (_t, mut l, a) = lib();
        let mut bad = regions('f');
        bad.boxes[1].x1 = bad.boxes[1].x0;
        let e = l.record_film_regions(&a, &bad);
        println!("degenerate maxilla box: {:?}; rows {:?}", e.as_ref().map_err(|e| format!("{e:#}")), counts(&l, &a));
        assert!(e.is_err());
        assert_eq!(counts(&l, &a), [0; 5]);
        bad.boxes[1] = RegionBoxRow { region: "maxilla".into(), found: false, x0: None, y0: None, x1: None, y1: None, score: bad.boxes[1].score };
        l.record_film_regions(&a, &bad).expect("the same box stored as not found");
        assert_eq!(counts(&l, &a), [1, 5, 0, 0, 0]);
    }
    /// Test 9b: a run is checked once; a second record returns None and writes nothing, even with other reasons.
    #[test] fn a_run_is_checked_once() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        let id = l.record_whole_film_check(&a, &check(Some(r), "flagged", vec![mirrored()])).unwrap();
        let again = l.record_whole_film_check(&a, &check(Some(r), "flagged", vec![mirrored(), region_reason("maxilla", "A=0.300")])).unwrap();
        println!("run {r} checked twice: {id:?} then {again:?}; rows {:?}", counts(&l, &a));
        assert!(id.is_some());
        assert_eq!((again, counts(&l, &a)), (None, [0, 0, 1, 1, 0]));
        assert_eq!(l.whole_film_checks(&a).unwrap()[0].record.reasons, vec![mirrored()]);
    }
    /// The store refuses a record that can never be, and writes nothing: flagged with no reason, clean or not-run with a
    /// reason, a run of another film, a region run of another film, a duplicated reason (the reasons' unique index:
    /// the check is rolled back with it). Fails if any is written.
    #[test] fn the_store_refuses_a_check_that_can_never_be_and_writes_nothing() {
        let (t, mut l, a) = lib();
        let b = film(&mut l, t.path(), "SYNTHETIC-b.png", 80);
        let (ra, rb) = (run(&mut l, &a, "aariz-cepha29"), run(&mut l, &b, "aariz-cepha29"));
        let rr_b = l.record_film_regions(&b, &regions('f')).unwrap();
        let mut not_run = check(Some(ra), "not-run", vec![mirrored()]);
        not_run.shape_look = "too-few-points".into(); not_run.d2 = None; not_run.d2_mirror = None; not_run.line = None;
        let cases = vec![
            ("flagged with no reason", check(Some(ra), "flagged", vec![])),
            ("clean with a reason", check(Some(ra), "clean", vec![mirrored()])),
            ("not-run with a reason", not_run),
            ("a run of another film", check(Some(rb), "flagged", vec![mirrored()])),
            ("a region run of another film", with_regions(check(Some(ra), "flagged", vec![mirrored()]), rr_b)),
            ("one reason twice", check(Some(ra), "flagged", vec![mirrored(), mirrored()])),
            ("a CHECK refusal (an outcome `moved`)", check(Some(ra), "moved", vec![])),
        ];
        for (why, r) in cases {
            let e = l.record_whole_film_check(&a, &r);
            println!("{why}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{why} must be refused");
            assert_eq!(counts(&l, &a), [0; 5], "{why}: nothing written");
        }
        assert!(l.record_whole_film_check(&a, &check(Some(ra), "flagged", vec![mirrored()])).unwrap().is_some(), "the good record after");
    }
    /// Test 9c: two final checks are both kept, newest first; of run checks only each model's latest run's check is
    /// returned (an older run's check never stands in). Order: run checks newest first, then final checks newest first.
    #[test] fn whole_film_checks_reads_each_models_latest_run_then_every_final_newest_first() {
        let (_t, mut l, a) = lib();
        let (m1, m2) = (run(&mut l, &a, "aariz-cepha29"), run(&mut l, &a, "srpose-cldet23"));
        let c_m1 = l.record_whole_film_check(&a, &check(Some(m1), "clean", vec![])).unwrap().unwrap();
        let c_m2 = l.record_whole_film_check(&a, &check(Some(m2), "flagged", vec![mirrored()])).unwrap().unwrap();
        let f1 = l.record_whole_film_check(&a, &check(None, "clean", vec![])).unwrap().unwrap();
        let f2 = l.record_whole_film_check(&a, &check(None, "flagged", vec![mirrored()])).unwrap().unwrap();
        let m1b = run(&mut l, &a, "aariz-cepha29");                             // a newer aariz run, checked
        let c_m1b = l.record_whole_film_check(&a, &check(Some(m1b), "flagged", vec![mirrored()])).unwrap().unwrap();
        let rows = l.whole_film_checks(&a).unwrap();
        let seen: Vec<(i64, Option<String>)> = rows.iter().map(|r| (r.id, r.model_id.clone())).collect();
        println!("whole_film_checks: {seen:?} (older aariz check {c_m1} not shown)");
        assert_eq!(seen, vec![(c_m1b, Some("aariz-cepha29".into())), (c_m2, Some("srpose-cldet23".into())), (f2, None), (f1, None)]);
        assert!(rows.iter().all(|r| r.checked_at.len() >= 20 && r.resolved.is_none()));
        assert_eq!(rows[0].record, check(Some(m1b), "flagged", vec![mirrored()]), "read back exactly");
        let m2b = run(&mut l, &a, "srpose-cldet23");                            // a newer run, not yet checked
        let after: Vec<i64> = l.whole_film_checks(&a).unwrap().iter().map(|r| r.id).collect();
        println!("after srpose's newer unchecked run {m2b}: {after:?}");
        assert_eq!(after, vec![c_m1b, f2, f1], "an older run's check never stands in for a newer run");
    }
    /// Test 9d and the edge case "two operators": a check is resolved once; the second call returns false and the first
    /// reason and operator stay; each resolution records who. A clean check has nothing to resolve.
    #[test] fn a_check_is_resolved_once_and_keeps_its_first_reason_and_who() {
        let (_t, mut l, a) = lib();
        let c1 = l.record_whole_film_check(&a, &check(None, "flagged", vec![mirrored()])).unwrap().unwrap();
        let c2 = l.record_whole_film_check(&a, &check(None, "flagged", vec![mirrored()])).unwrap().unwrap();
        let clean = l.record_whole_film_check(&a, &check(None, "clean", vec![])).unwrap().unwrap();
        assert!(l.resolve_whole_film_check(c1, ResolveReason::ExpectedVariant, "Dr A").unwrap());
        let again = l.resolve_whole_film_check(c1, ResolveReason::CorrectedTracing, "Dr B").unwrap();
        assert!(l.resolve_whole_film_check(c2, ResolveReason::CorrectedTracing, "Dr B").unwrap());
        let res = |id: i64| l.whole_film_checks(&a).unwrap().into_iter().find(|r| r.id == id).unwrap().resolved.unwrap();
        println!("second resolve of {c1}: {again}; {c1}: {:?}; {c2}: {:?}", res(c1), res(c2));
        assert!(!again);
        assert_eq!((res(c1).reason.as_str(), res(c1).operator.as_str()), ("expected-variant", "Dr A"));
        assert_eq!((res(c2).reason.as_str(), res(c2).operator.as_str()), ("corrected-tracing", "Dr B"));
        let e = l.resolve_whole_film_check(clean, ResolveReason::TracingRight, "Dr A");
        println!("resolve a clean check: {:?}", e.as_ref().map_err(|e| e.to_string()));
        assert!(e.is_err());
        assert!(l.resolve_whole_film_check(9999, ResolveReason::TracingRight, "Dr A").is_err(), "no such check");
    }
    /// Test 9e, the habit's read (spec §7): the flagged, unresolved checks among the model's latest run's check and the
    /// film's latest final check. Resolved with any of the three reasons → gone; another model's run ignored; a film with
    /// no row → nothing; an older final check is not read.
    #[test] fn the_habit_reads_the_unresolved_flags_of_the_models_latest_run_and_the_latest_final() {
        let (t, mut l, a) = lib();
        l.set_verified(&a, true, "Dr A").unwrap();                  // a final check is current only while the film is signed off (N1/N5)
        let empty = film(&mut l, t.path(), "SYNTHETIC-b.png", 80);
        assert!(l.unresolved_whole_film_checks(&empty, "aariz-cepha29").unwrap().is_empty(), "a film with no row (as before format 20)");
        for reason in [ResolveReason::TracingRight, ResolveReason::ExpectedVariant, ResolveReason::CorrectedTracing] {
            let r = run(&mut l, &a, "aariz-cepha29");
            let c = l.record_whole_film_check(&a, &check(Some(r), "flagged", vec![mirrored()])).unwrap().unwrap();
            let before: Vec<i64> = l.unresolved_whole_film_checks(&a, "aariz-cepha29").unwrap().iter().map(|x| x.id).collect();
            assert!(l.resolve_whole_film_check(c, reason, "Dr A").unwrap());
            let after: Vec<i64> = l.unresolved_whole_film_checks(&a, "aariz-cepha29").unwrap().iter().map(|x| x.id).collect();
            println!("{}: before {before:?}, after {after:?}", reason.key());
            assert_eq!((before, after), (vec![c], vec![]));
        }
        let other = run(&mut l, &a, "srpose-cldet23");
        l.record_whole_film_check(&a, &check(Some(other), "flagged", vec![mirrored()])).unwrap();
        assert!(l.unresolved_whole_film_checks(&a, "aariz-cepha29").unwrap().is_empty(), "another model's run is ignored");
        let old_final = l.record_whole_film_check(&a, &check(None, "flagged", vec![mirrored()])).unwrap().unwrap();
        let ids = |l: &Library| l.unresolved_whole_film_checks(&a, "aariz-cepha29").unwrap().iter().map(|x| x.id).collect::<Vec<_>>();
        assert_eq!(ids(&l), vec![old_final], "the latest final check's flag");
        let new_final = l.record_whole_film_check(&a, &check(None, "clean", vec![])).unwrap().unwrap();
        println!("after a newer clean final {new_final}: {:?}", ids(&l));
        assert!(ids(&l).is_empty(), "an older final check is not read");
        let r = run(&mut l, &a, "aariz-cepha29");
        let c = l.record_whole_film_check(&a, &check(Some(r), "flagged", vec![mirrored()])).unwrap().unwrap();
        let f = l.record_whole_film_check(&a, &check(None, "flagged", vec![mirrored()])).unwrap().unwrap();
        assert_eq!(ids(&l), vec![c, f], "the run's check, then the final's");
        assert_eq!(l.unresolved_whole_film_checks(&a, "srpose-cldet23").unwrap().iter().map(|x| x.id).collect::<Vec<_>>().len(), 2, "srpose's own, and the final");
    }
    /// Test 9f: `is_deleted` is true only in Recently deleted. Fails if it reads another column, or a missing film as live.
    #[test] fn is_deleted_is_true_only_in_recently_deleted() {
        let (_t, mut l, a) = lib();
        assert!(!l.is_deleted(&a).unwrap());
        l.delete(&a).unwrap();
        assert!(l.is_deleted(&a).unwrap());
        l.restore(&a).unwrap();
        assert!(!l.is_deleted(&a).unwrap());
        assert!(l.is_deleted("no-such-film").is_err());
    }
    /// Edge case "a locked film" (OQ-6: looking, not editing): a check is recorded and resolved on a signed-off film,
    /// and the film stays signed off. Fails if the store refuses either on a verified film.
    #[test] fn a_signed_off_film_takes_a_check_and_its_resolution() {
        let (_t, mut l, a) = lib();
        l.set_verified(&a, true, "Dr A").unwrap();
        let c = l.record_whole_film_check(&a, &check(None, "flagged", vec![mirrored()])).unwrap().unwrap();
        let ok = l.resolve_whole_film_check(c, ResolveReason::TracingRight, "Dr A").unwrap();
        let doc = l.load(&a).unwrap();
        println!("signed-off film: resolved {ok}; verified_at {:?}", doc.verified_at);
        assert!(ok && doc.verified_at.is_some());
    }
    /// Edge case "closed then reopened": the checks and region runs read the same after the library is dropped and
    /// opened again.
    #[test] fn closed_then_reopened_reads_the_same() {
        let (t, mut l, a) = lib();
        fill(&mut l, &a);
        let (checks, regs) = (l.whole_film_checks(&a).unwrap(), l.film_regions(&a, &"f".repeat(64)).unwrap());
        drop(l);
        let l = Library::open(t.path()).unwrap();
        println!("reopened: {} checks, region run {:?}", checks.len(), regs.as_ref().map(|r| r.0));
        assert_eq!((l.whole_film_checks(&a).unwrap(), l.film_regions(&a, &"f".repeat(64)).unwrap()), (checks, regs));
    }
    /// Edge cases "too few points" and "no region model": a not-run check with 9 points present and no region model
    /// (no region run, no τ), and a not-set-up one, are stored and read back exactly.
    #[test] fn too_few_points_and_no_region_model_are_stored_as_not_run() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        let few = WholeFilmRecord { present: 9, shape_look: "too-few-points".into(), d2: None, d2_mirror: None, line: None, ..check(Some(r), "not-run", vec![]) };
        let unset = WholeFilmRecord { prior_sha256: None, prior_films: None, shape_look: "not-set-up".into(), region_look: "not-set-up".into(),
            d2: None, d2_mirror: None, line: None, ..check(None, "not-run", vec![]) };
        l.record_whole_film_check(&a, &few).unwrap().unwrap();
        l.record_whole_film_check(&a, &unset).unwrap().unwrap();
        let rows = l.whole_film_checks(&a).unwrap();
        println!("stored: {:#?}", rows.iter().map(|r| (&r.record.outcome, &r.record.shape_look, &r.record.region_look, r.record.present, r.record.region_run_id, r.record.tau)).collect::<Vec<_>>());
        assert_eq!(rows.iter().map(|r| r.record.clone()).collect::<Vec<_>>(), vec![few, unset]);
        assert!(l.unresolved_whole_film_checks(&a, "aariz-cepha29").unwrap().is_empty(), "not-run is not a flag");
    }
    fn size_reason() -> WholeFilmReasonRow { WholeFilmReasonRow { reason: "size".into(), region: None, detail: Some("factor=0.500".into()) } }
    /// A flagged check carrying the two new looks (rule `whole-film/2`): size judged, centre judged.
    fn new_looks(run_id: Option<i64>, region_run: i64) -> WholeFilmRecord {
        with_regions(WholeFilmRecord { rule_version: "whole-film/2".into(), size_look: "judged".into(), size: Some((-0.693_147_180_559_945_3, 0.120_3, 0.09)),
            cb_look: "judged".into(), cb: Some((0.107_000_000_000_000_01, 0.06)), cb_present: 5, ..check(run_id, "flagged", vec![size_reason()]) }, region_run)
    }
    /// Format 20 amended (Task D2): a `size` reason is accepted and stored; `sizes` and a seventh, unknown reason are
    /// refused, nothing written. Fails if 020's reason CHECK does not list `size` (the first write errors), or lists any
    /// prefix/other word (the refusals pass).
    #[test] fn a_size_reason_is_accepted_and_a_sixth_or_seventh_is_refused() {
        let (_t, mut l, a) = lib();
        let (r1, r2, r3) = (run(&mut l, &a, "m1"), run(&mut l, &a, "m2"), run(&mut l, &a, "m3"));
        for (why, run_id, word) in [("sizes", r1, "sizes"), ("a seventh, unknown reason", r2, "upside-down")] {
            let bad = WholeFilmReasonRow { reason: word.into(), region: None, detail: None };
            let e = l.record_whole_film_check(&a, &check(Some(run_id), "flagged", vec![bad]));
            println!("{why}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{why} must be refused");
            assert_eq!(counts(&l, &a), [0; 5]);
        }
        let id = l.record_whole_film_check(&a, &check(Some(r3), "flagged", vec![size_reason()])).unwrap().unwrap();
        assert_eq!(l.whole_film_checks(&a).unwrap()[0].record.reasons, vec![size_reason()]);
        println!("size reason stored on check {id}");
    }
    /// Rule `whole-film/2` with both new looks is stored and read back bit for bit. Fails if a column is not written or
    /// not read (the numbers come back None), or if a number is rounded on the way.
    #[test] fn a_whole_film_2_record_reads_back_its_size_and_cb_numbers_bit_for_bit() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        let rr = l.record_film_regions(&a, &regions('f')).unwrap();
        let rec = new_looks(Some(r), rr);
        l.record_whole_film_check(&a, &rec).unwrap().unwrap();
        let back = l.whole_film_checks(&a).unwrap().remove(0).record;
        println!("read back: rule {}, size {:?}, cb {:?}", back.rule_version, back.size, back.cb);
        assert_eq!(back, rec);
        let (q, c, ln) = back.size.unwrap();
        assert_eq!((q.to_bits(), c.to_bits(), ln.to_bits()), ((-0.693_147_180_559_945_3f64).to_bits(), 0.120_3f64.to_bits(), 0.09f64.to_bits()));
        assert_eq!(back.cb.unwrap().0.to_bits(), 0.107_000_000_000_000_01f64.to_bits());
    }
    /// Each of the five `size_look` keys is written and read back; a sixth is refused. A judged look holds its three
    /// numbers; each other key holds none. Fails if 020's list misses or adds a key.
    #[test] fn each_size_look_key_is_stored_and_a_sixth_is_refused() {
        let (_t, mut l, a) = lib();
        let rr = l.record_film_regions(&a, &regions('f')).unwrap();
        for key in ["judged", "not-set-up", "no-region-model", "film-too-small", "too-few"] {
            let r = run(&mut l, &a, "aariz-cepha29");
            let rec = with_regions(WholeFilmRecord { size_look: key.into(), size: (key == "judged").then_some((0.01, 0.12, 0.09)), ..check(Some(r), "clean", vec![]) }, rr);
            l.record_whole_film_check(&a, &rec).unwrap_or_else(|e| panic!("{key}: {e:#}")).unwrap();
            let back = l.whole_film_checks(&a).unwrap().into_iter().find(|x| x.record.run_id == Some(r)).unwrap().record;
            assert_eq!((back.size_look.as_str(), back.size), (key, rec.size));
        }
        let r = run(&mut l, &a, "aariz-cepha29");
        let e = l.record_whole_film_check(&a, &WholeFilmRecord { size_look: "guessed".into(), ..check(Some(r), "clean", vec![]) });
        println!("a sixth key `guessed`: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
        assert!(e.is_err());
    }
    /// The size triple is all-or-nothing and tied to `judged`: judged with no numbers is refused, and `too-few` with
    /// numbers is refused. Fails if the size triple CHECK is dropped.
    #[test] fn a_judged_size_needs_its_numbers_and_a_not_judged_one_has_none() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        let judged_empty = WholeFilmRecord { size_look: "judged".into(), size: None, ..check(Some(r), "clean", vec![]) };
        let few_with = WholeFilmRecord { size_look: "too-few".into(), size: Some((0.0, 0.1, 0.09)), ..check(Some(r), "clean", vec![]) };
        for (why, rec) in [("judged with a NULL size_q", judged_empty), ("too-few with a size_q", few_with)] {
            let e = l.record_whole_film_check(&a, &rec);
            println!("{why}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{why} must be refused");
            assert_eq!(counts(&l, &a), [0; 5]);
        }
    }
    /// A whole-film/1 row, as the old code wrote it (no new columns named), still reads: not-set-up, no numbers.
    /// Fails if the new columns have no default (the old INSERT is refused) or the read gives the numbers anything else.
    #[test] fn a_whole_film_1_row_written_by_the_old_code_still_reads() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        l.conn.execute(&format!("INSERT INTO whole_film_checks (case_id, subject, run_id, rule_version, prior_sha256, prior_films, outcome, shape_look, region_look, present, d2, d2_mirror, line, checked_at)
            VALUES (?1, 'run', ?2, 'whole-film/1', ?3, 300, 'clean', 'judged', 'no-region-model', 19, 12.0, 80.0, 30.0, {NOW})"), params![a, r, "a".repeat(64)]).unwrap();
        let back = l.whole_film_checks(&a).unwrap().remove(0).record;
        println!("old row: rule {}, size_look {}, size {:?}, cb {:?}, d2 {:?}", back.rule_version, back.size_look, back.size, back.cb, back.d2);
        assert_eq!((back.rule_version.as_str(), back.size_look.as_str(), back.size, back.cb, back.d2), ("whole-film/1", "not-set-up", None, None, Some(12.0)));
        assert_eq!(back, check(Some(r), "clean", vec![]));
    }
    /// Fix round 1 (review concern 3): the centre look's status is stored: each of the five keys is written and read back, a
    /// judged one holds its pair and the others none, a sixth key is refused. Fails if `cb_look` is not written or read, or its list is wrong.
    #[test] fn each_cb_look_key_is_stored_and_a_sixth_is_refused() {
        let (_t, mut l, a) = lib();
        let rr = l.record_film_regions(&a, &regions('f')).unwrap();
        for key in ["judged", "not-set-up", "no-region-model", "film-too-small", "too-few"] {
            let r = run(&mut l, &a, "aariz-cepha29");
            let rec = with_regions(WholeFilmRecord { cb_look: key.into(), cb: (key == "judged").then_some((0.02, 0.06)), cb_present: if key == "judged" { 5 } else { 3 }, ..check(Some(r), "clean", vec![]) }, rr);
            l.record_whole_film_check(&a, &rec).unwrap_or_else(|e| panic!("{key}: {e:#}")).unwrap();
            let back = l.whole_film_checks(&a).unwrap().into_iter().find(|x| x.record.run_id == Some(r)).unwrap().record;
            assert_eq!((back.cb_look.as_str(), back.cb), (key, rec.cb));
        }
        let r = run(&mut l, &a, "aariz-cepha29");
        let e = l.record_whole_film_check(&a, &with_regions(WholeFilmRecord { cb_look: "guessed".into(), ..check(Some(r), "clean", vec![]) }, rr));
        println!("a sixth cb key `guessed`: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
        assert!(e.is_err());
    }
    /// The centre's status and its numbers go together: judged with no pair, and a not-judged look with a pair, are refused.
    /// Fails if the cb_look/pair CHECK is dropped.
    #[test] fn a_judged_centre_needs_its_pair_and_a_not_judged_one_has_none() {
        let (_t, mut l, a) = lib();
        let rr = l.record_film_regions(&a, &regions('f')).unwrap();
        let r = run(&mut l, &a, "aariz-cepha29");
        let cases = [("judged with no pair", WholeFilmRecord { cb_look: "judged".into(), cb: None, cb_present: 5, ..check(Some(r), "clean", vec![]) }),
            ("too-few with a pair", WholeFilmRecord { cb_look: "too-few".into(), cb: Some((0.1, 0.06)), cb_present: 5, ..check(Some(r), "clean", vec![]) })];
        for (why, rec) in cases {
            let e = l.record_whole_film_check(&a, &with_regions(rec, rr));
            println!("{why}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{why}");
            assert_eq!(counts(&l, &a)[2], 0);
        }
    }
    /// Review M5: a size or centre look cannot be `judged` on a row whose regions were not looked at. Fails if the CHECK is dropped.
    #[test] fn a_look_cannot_be_judged_without_the_regions_being_judged() {
        let (_t, mut l, a) = lib();
        let r = run(&mut l, &a, "aariz-cepha29");
        let size = WholeFilmRecord { size_look: "judged".into(), size: Some((0.0, 0.1, 0.09)), ..check(Some(r), "clean", vec![]) };   // region_look is `no-region-model`
        let cb = WholeFilmRecord { cb_look: "judged".into(), cb: Some((0.0, 0.06)), cb_present: 5, ..check(Some(r), "clean", vec![]) };
        for (why, rec) in [("size judged, regions not", size), ("centre judged, regions not", cb)] {
            let e = l.record_whole_film_check(&a, &rec);
            println!("{why}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{why}");
        }
    }
    /// Review N5 (and the N1 ruling): the habit's read returns a film's final check only while the film is signed off and the
    /// check was made at or after the sign-off. Fails if the sign-off is not consulted (an unsigned film's old final is read),
    /// or if the check is not compared with the sign-off time.
    #[test] fn the_habit_reads_a_final_check_only_while_the_film_is_signed_off_and_it_is_current() {
        let (_t, mut l, a) = lib();
        let nap = || std::thread::sleep(std::time::Duration::from_millis(15));
        let ids = |l: &Library| l.unresolved_whole_film_checks(&a, "aariz-cepha29").unwrap().iter().map(|x| x.id).collect::<Vec<_>>();
        l.set_verified(&a, true, "Dr A").unwrap(); nap();
        let f = l.record_whole_film_check(&a, &check(None, "flagged", vec![mirrored()])).unwrap().unwrap();
        assert_eq!(ids(&l), vec![f], "signed off, final made after the sign-off: read");
        l.set_verified(&a, false, "Dr A").unwrap();
        println!("unsigned: {:?}", ids(&l));
        assert!(ids(&l).is_empty(), "an unsigned film has no current final");
        nap();
        l.set_verified(&a, true, "Dr A").unwrap();
        println!("signed again, final older than the sign-off: {:?}", ids(&l));
        assert!(ids(&l).is_empty(), "a final older than the last sign-off is not read");
        nap();
        let g = l.record_whole_film_check(&a, &check(None, "flagged", vec![mirrored()])).unwrap().unwrap();
        assert_eq!(ids(&l), vec![g], "a fresh final after the re-sign is read");
        assert_eq!(counts(&l, &a)[2], 2, "nothing deleted");
    }
    /// The traced cranial-base count is stored and read back; it is 0 to 5, and a judged centre look needs all 5.
    /// Fails if `cb_present` is not written or read, or its CHECKs are dropped.
    #[test] fn the_cranial_base_point_count_is_stored_and_a_judged_centre_needs_all_five() {
        let (_t, mut l, a) = lib();
        let rr = l.record_film_regions(&a, &regions('f')).unwrap();
        let r = run(&mut l, &a, "aariz-cepha29");
        let few = with_regions(WholeFilmRecord { cb_look: "too-few".into(), cb_present: 4, ..check(Some(r), "clean", vec![]) }, rr);
        l.record_whole_film_check(&a, &few).unwrap().unwrap();
        assert_eq!(l.whole_film_checks(&a).unwrap()[0].record.cb_present, 4);
        let r2 = run(&mut l, &a, "aariz-cepha29");
        for (why, rec) in [("judged with 4 points", WholeFilmRecord { cb_look: "judged".into(), cb: Some((0.0, 0.06)), cb_present: 4, ..check(Some(r2), "clean", vec![]) }),
                           ("6 points", WholeFilmRecord { cb_present: 6, ..check(Some(r2), "clean", vec![]) }),
                           ("-1 points", WholeFilmRecord { cb_present: -1, ..check(Some(r2), "clean", vec![]) })] {
            let e = l.record_whole_film_check(&a, &with_regions(rec, rr));
            println!("{why}: {:?}", e.as_ref().map_err(|e| format!("{e:#}")));
            assert!(e.is_err(), "{why}");
        }
        let ok = with_regions(WholeFilmRecord { cb_look: "judged".into(), cb: Some((0.0, 0.06)), cb_present: 5, ..check(Some(r2), "clean", vec![]) }, rr);
        assert!(l.record_whole_film_check(&a, &ok).unwrap().is_some());
    }
    /// The reason keys are exactly 020's, both ways, and serde writes the same keys. Fails if a key is renamed.
    #[test] fn resolve_reason_keys_are_020s() {
        for (r, k) in [(ResolveReason::TracingRight, "tracing-right"), (ResolveReason::ExpectedVariant, "expected-variant"), (ResolveReason::CorrectedTracing, "corrected-tracing")] {
            assert_eq!((r.key(), ResolveReason::from_key(k), serde_json::to_value(r).unwrap()), (k, Some(r), serde_json::json!(k)));
        }
        assert_eq!(ResolveReason::from_key("looked-fine"), None);
    }
}
