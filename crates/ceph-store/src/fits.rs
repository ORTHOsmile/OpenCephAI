//! Request G (spec 2026-10-17; owner G1–G3, 17 Oct): a film's fit to another film of the same patient on the
//! Superimposition page, stored with the film (format 12). A fit never touches `cases.spacing_mm`, the landmarks or the
//! learning record: a ruler-calibrated film keeps its ruler (G2), and a film with no fit is compared exactly as before.
use crate::library::{live_case, NOW};
use crate::Library;
use anyhow::{anyhow, bail, ensure};
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde::{Deserialize, Serialize};

/// Input limits, the same as the screen's (`compare/fit.ts`): reference points this far apart on each film, and the
/// size (reference px per film px) between SCALE_MIN and SCALE_MAX.
pub const MIN_PAIR_PX: f64 = 20.0;
pub const SCALE_MIN: f64 = 0.2;
pub const SCALE_MAX: f64 = 5.0;
/// The table's own limit on every point and on the move (012_film_fits.sql's CHECKs), image px either way. Far beyond
/// any film; checked here so a value past it is refused in plain words, never as a database error (ruling).
const LIMIT_PX: f64 = 1e6;

/// A fit as the screen saves it. Points are image px: `ref_points` on the reference film, `film_points` on this film.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FitSave {
    pub ref_case_id: String,
    /// "sn" (S–N, the default) or "points" (two points the operator picked).
    pub ref_kind: String,
    pub ref_points: [[f64; 2]; 2],
    pub film_points: [[f64; 2]; 2],
    /// The films face opposite ways, so this one is mirrored before it is placed.
    pub mirror: bool,
    /// Reference px per film px.
    pub scale: f64,
    /// Radians.
    pub rotation: f64,
    /// The move, reference px.
    pub dx: f64,
    pub dy: f64,
}
/// A saved fit as the library returns it: with "Use the scale from the fit" (owner G2), and the reference's timepoint
/// and ruler scale (None = no ruler) read live, so a ruler added to the reference later is used at once.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmFit {
    #[serde(flatten)] pub fit: FitSave,
    pub use_own: bool,
    pub ref_timepoint: String,
    pub ref_spacing_mm: Option<f64>,
    /// The reference's machine scale when it applies and the reference has no ruler (spec 2026-10-20); None otherwise.
    pub ref_machine_spacing_mm: Option<f64>,
    pub saved_by: String,
    pub saved_at: String,
}

/// SQL that is true while film `a` and film `b` are one patient's films and `b` is live — the rule `Library::series`
/// uses (same name key, not unnamed, dates of birth equal or either blank). Plan decision D-e.
fn together(a: &str, b: &str) -> String {
    format!("EXISTS (SELECT 1 FROM cases fa JOIN patients pa ON pa.id = fa.patient_id, cases fb JOIN patients pb ON pb.id = fb.patient_id
              WHERE fa.id = {a} AND fb.id = {b} AND fb.deleted_at IS NULL AND substr(pa.name_key, 1, 1) != '~' AND pa.name_key = pb.name_key
                AND (pa.date_of_birth IS pb.date_of_birth OR pa.date_of_birth IS NULL OR pb.date_of_birth IS NULL))")
}
/// Removes every fit whose two films are no longer one patient's live films (spec G: deleting the reference clears
/// the fit; D-e: so does moving either film away). Called inside the transaction of every change that can do that.
/// A film whose fit goes while "Use the scale from the fit" is on has its own mm change back, so its Tracing verified
/// is cleared first (D-c extension, pre-flight ruling; owner confirmed 18 Oct).
pub(crate) fn prune(tx: &Transaction) -> rusqlite::Result<usize> {
    let gone = format!("NOT {}", together("film_fits.case_id", "film_fits.ref_case_id"));
    tx.execute(&format!("UPDATE cases SET verified_at = NULL, verified_by = NULL, updated_at = {NOW}
                         WHERE id IN (SELECT case_id FROM film_fits WHERE use_own = 1 AND {gone})"), [])?;
    tx.execute(&format!("DELETE FROM film_fits WHERE {gone}"), [])
}
/// The film's fit, if it still applies (the same rule, so a row `prune` never saw is never read).
pub(crate) fn fit_of(conn: &Connection, case_id: &str) -> rusqlite::Result<Option<FilmFit>> {
    conn.query_row(&format!(
        "SELECT f.ref_case_id, f.ref_kind, f.ref_x1, f.ref_y1, f.ref_x2, f.ref_y2, f.film_x1, f.film_y1, f.film_x2, f.film_y2,
                f.mirror, f.scale, f.rotation, f.dx, f.dy, f.use_own, r.timepoint, r.spacing_mm,
                CASE WHEN r.spacing_mm IS NULL THEN (SELECT m.spacing_mm FROM cases c JOIN images i ON i.sha256 = c.image_sha256, layout_machines m WHERE c.id = r.id AND {}) END,
                f.saved_by, f.saved_at
         FROM film_fits f JOIN cases r ON r.id = f.ref_case_id WHERE f.case_id = ?1 AND {}", crate::machine_scale::APPLIES, together("f.case_id", "f.ref_case_id")),
        [case_id], |r| Ok(FilmFit {
            fit: FitSave { ref_case_id: r.get(0)?, ref_kind: r.get(1)?, ref_points: [[r.get(2)?, r.get(3)?], [r.get(4)?, r.get(5)?]],
                film_points: [[r.get(6)?, r.get(7)?], [r.get(8)?, r.get(9)?]], mirror: r.get::<_, i64>(10)? == 1, scale: r.get(11)?,
                rotation: r.get(12)?, dx: r.get(13)?, dy: r.get(14)? },
            use_own: r.get::<_, i64>(15)? == 1, ref_timepoint: r.get(16)?, ref_spacing_mm: r.get(17)?, ref_machine_spacing_mm: r.get(18)?,
            saved_by: r.get(19)?, saved_at: r.get(20)? }))
        .optional()
}
/// The ref id of a film's fit, if it still applies (for `Library::series`).
pub(crate) fn fit_ref_sql(case_col: &str) -> String {
    format!("(SELECT ff.ref_case_id FROM film_fits ff WHERE ff.case_id = {case_col} AND {})", together("ff.case_id", "ff.ref_case_id"))
}
fn unverify(tx: &Transaction, case_id: &str) -> rusqlite::Result<()> {
    tx.execute(&format!("UPDATE cases SET verified_at = NULL, verified_by = NULL, updated_at = {NOW} WHERE id = ?1"), [case_id]).map(|_| ())
}

impl Library {
    /// "Save fit" (spec G step 2): this film's placement on another film of the same patient. A comparison choice: it
    /// never changes the film's points, its ruler calibration or the learning record, and on its own never clears
    /// "Tracing verified". Refused: a film or reference in Recently deleted; a reference that is this film or not one of
    /// this patient's films; a reference that is itself fitted, or a film another film is fitted to (no chains, D-d);
    /// reference points closer than MIN_PAIR_PX; a size outside SCALE_MIN–SCALE_MAX; a number that is not finite.
    /// Saving again replaces the fit and keeps "Use the scale from the fit"; while that is on the film's own mm may
    /// change, so "Tracing verified" is cleared (D-c).
    pub fn save_fit(&mut self, case_id: &str, f: &FitSave, operator: &str) -> anyhow::Result<()> {
        ensure!(f.ref_kind == "sn" || f.ref_kind == "points", "unknown reference {:?}", f.ref_kind);
        let all = [f.scale, f.rotation, f.dx, f.dy].into_iter().chain(f.ref_points.iter().chain(f.film_points.iter()).flatten().copied());
        ensure!(all.into_iter().all(f64::is_finite), "the fit holds a number that is not finite");
        ensure!((SCALE_MIN..=SCALE_MAX).contains(&f.scale), "the size ×{:.3} is outside ×{SCALE_MIN}–×{SCALE_MAX}", f.scale);
        ensure!(f.rotation.abs() <= std::f64::consts::PI + 1e-9, "the turn {:.3} rad is not between −π and π", f.rotation);
        ensure!(f.dx.abs() <= LIMIT_PX && f.dy.abs() <= LIMIT_PX,
            "the move ({:.1} px across, {:.1} px down) is too far: at most 1,000,000 px each way", f.dx, f.dy);
        let inside = |p: &[[f64; 2]; 2]| p.iter().flatten().all(|v| v.abs() <= LIMIT_PX);
        ensure!(inside(&f.ref_points), "a point on the reference film is too far out: at most 1,000,000 px from its corner");
        ensure!(inside(&f.film_points), "a point on this film is too far out: at most 1,000,000 px from its corner");
        let apart = |p: &[[f64; 2]; 2]| (p[1][0] - p[0][0]).hypot(p[1][1] - p[0][1]);
        ensure!(apart(&f.ref_points) >= MIN_PAIR_PX && apart(&f.film_points) >= MIN_PAIR_PX,
            "pick two points at least {MIN_PAIR_PX} px apart on each film");
        ensure!(f.ref_case_id != case_id, "a film can’t be fitted to itself");
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        live_case(&tx, &f.ref_case_id)?;
        let one: bool = tx.query_row(&format!("SELECT {}", together("?1", "?2")), params![case_id, f.ref_case_id], |r| r.get(0))?;
        ensure!(one, "the reference is not one of this patient’s films");
        // No chains (D-d). Each refusal names the other film by its timepoint, and says when it is in Recently deleted:
        // a deleted fitted film keeps its fit for Restore, and the screen's series lists live films only (pre-flight ruling).
        let timepoint = |id: &str| tx.query_row("SELECT timepoint FROM cases WHERE id = ?1", [id], |r| r.get::<_, String>(0));
        let fitted: Option<String> = tx.query_row("SELECT ref_case_id FROM film_fits WHERE case_id = ?1", [&f.ref_case_id], |r| r.get(0)).optional()?;
        if let Some(to) = fitted {
            bail!("{} is itself fitted to {}; remove its fit first", timepoint(&f.ref_case_id)?, timepoint(&to)?);
        }
        let is_ref: Option<(String, bool)> = tx.query_row(
            "SELECT c.timepoint, c.deleted_at IS NOT NULL FROM film_fits ff JOIN cases c ON c.id = ff.case_id WHERE ff.ref_case_id = ?1
             ORDER BY c.deleted_at IS NOT NULL, c.timepoint LIMIT 1", [case_id], |r| Ok((r.get(0)?, r.get(1)?))).optional()?;
        if let Some((by, deleted)) = is_ref {
            let gone = if deleted { " (in Recently deleted: restore it and reset its fit, or empty Recently deleted)" } else { "" };
            bail!("{by} is fitted to this film; remove that fit first{gone}");
        }
        let own = tx.query_row("SELECT use_own FROM film_fits WHERE case_id = ?1", [case_id], |r| r.get::<_, i64>(0)).optional()? == Some(1);
        tx.execute("DELETE FROM film_fits WHERE case_id = ?1", [case_id])?;
        tx.execute(&format!("INSERT INTO film_fits (case_id, ref_case_id, ref_kind, ref_x1, ref_y1, ref_x2, ref_y2, film_x1, film_y1, film_x2, film_y2,
                                 mirror, scale, rotation, dx, dy, use_own, saved_by, saved_at)
                             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, {NOW})"),
            params![case_id, f.ref_case_id, f.ref_kind, f.ref_points[0][0], f.ref_points[0][1], f.ref_points[1][0], f.ref_points[1][1],
                f.film_points[0][0], f.film_points[0][1], f.film_points[1][0], f.film_points[1][1], f.mirror, f.scale, f.rotation, f.dx, f.dy, own, operator])?;
        if own { unverify(&tx, case_id)?; }
        tx.commit()?;
        Ok(())
    }
    /// "Reset" (spec G step 2, D-f): the film goes back to the plain S–N superimposition at its own scale. Clears
    /// "Tracing verified" only if "Use the scale from the fit" was on (its own mm change back, D-c). No fit: nothing to do.
    pub fn clear_fit(&mut self, case_id: &str) -> anyhow::Result<()> {
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        let own = tx.query_row("SELECT use_own FROM film_fits WHERE case_id = ?1", [case_id], |r| r.get::<_, i64>(0)).optional()? == Some(1);
        tx.execute("DELETE FROM film_fits WHERE case_id = ?1", [case_id])?;
        if own { unverify(&tx, case_id)?; }
        tx.commit()?;
        Ok(())
    }
    /// Owner G2: "Use the scale from the fit" for this film's own measurements. Refused for a ruler-calibrated film (it is
    /// locked) and for a film with no fit. A real change clears "Tracing verified" (its own mm change, D-c).
    pub fn set_fit_own(&mut self, case_id: &str, on: bool) -> anyhow::Result<()> {
        let tx = self.conn.transaction()?;
        live_case(&tx, case_id)?;
        let ruler: Option<f64> = tx.query_row("SELECT spacing_mm FROM cases WHERE id = ?1", [case_id], |r| r.get(0))?;
        ensure!(ruler.is_none(), "this film was calibrated from its ruler, so it keeps its own scale");
        let machine = crate::machine_scale::scale_for_case(&tx, case_id)?.is_some_and(|m| m.applies);
        ensure!(!machine, "this film has its machine's calibrated scale, so it keeps it");
        let cur: i64 = tx.query_row(&format!("SELECT use_own FROM film_fits WHERE case_id = ?1 AND {}", together("film_fits.case_id", "film_fits.ref_case_id")),
            [case_id], |r| r.get(0)).optional()?.ok_or_else(|| anyhow!("this film has no fit; scale it on the Superimposition page first"))?;
        if (cur == 1) != on {
            tx.execute("UPDATE film_fits SET use_own = ?2 WHERE case_id = ?1", params![case_id, on])?;
            unverify(&tx, case_id)?;
        }
        tx.commit()?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    /// The screen sends and reads exactly ipc.ts's `FitSave` / `FilmFit` (camelCase, nested point arrays, flattened).
    #[test] fn the_wire_shape_is_ipc_ts() {
        let f: FitSave = serde_json::from_str(r#"{"refCaseId":"r","refKind":"sn","refPoints":[[1,2],[3,4]],"filmPoints":[[5,6],[7,8]],
            "mirror":true,"scale":1.04,"rotation":0.1,"dx":-1.5,"dy":2}"#).unwrap();
        assert_eq!(f, FitSave { ref_case_id: "r".into(), ref_kind: "sn".into(), ref_points: [[1.0, 2.0], [3.0, 4.0]], film_points: [[5.0, 6.0], [7.0, 8.0]],
            mirror: true, scale: 1.04, rotation: 0.1, dx: -1.5, dy: 2.0 });
        let out = serde_json::to_value(FilmFit { fit: f, use_own: true, ref_timepoint: "T1".into(), ref_spacing_mm: None, ref_machine_spacing_mm: None, saved_by: "x".into(), saved_at: "y".into() }).unwrap();
        let mut keys: Vec<&str> = out.as_object().unwrap().keys().map(String::as_str).collect(); keys.sort();
        assert_eq!(keys, ["dx", "dy", "filmPoints", "mirror", "refCaseId", "refKind", "refMachineSpacingMm", "refPoints", "refSpacingMm", "refTimepoint", "rotation", "savedAt", "savedBy", "scale", "useOwn"]);
    }
}
