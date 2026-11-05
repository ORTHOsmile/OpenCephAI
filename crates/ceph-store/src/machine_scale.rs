//! A calibrated scale per X-ray machine (spec 2026-10-20; owner MS1–MS4): stored once on the machine (format 13) and
//! worked out for each film here, by ONE rule (`APPLIES`) that every reader and the change counter (MS-3) share.
use rusqlite::{Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use crate::library::{Library, NOW};
use anyhow::{anyhow, ensure};
use rusqlite::params;

/// True when machine `m`'s scale applies to film `c` (image `i`): the film is recognised as that machine and its
/// stored image is exactly the scale's width × height in pixels (MS2; no tolerance, no swapping, MQ1). Says nothing
/// about the film's own ruler: the screen's order puts a ruler first.
pub(crate) const APPLIES: &str = "(m.spacing_mm IS NOT NULL AND c.layout_machine_id = m.id AND i.width = m.width_px AND i.height = m.height_px)";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineRef { pub id: String, pub name: String }

/// A machine's calibrated scale as one film sees it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineScale {
    pub machine_id: String, pub machine_name: String, pub spacing_mm: f64, pub width_px: i64, pub height_px: i64,
    /// "film" (from a ruler-calibrated film, MS1) or "entered" (typed).
    pub source: String,
    pub source_case_id: Option<String>,
    /// The source film's film date, read live (MQ3); None when that film is gone or has no film date.
    pub source_film_date: Option<String>,
    pub set_at: String,
    /// This film is exactly `width_px` × `height_px` (MS2).
    pub applies: bool,
}

/// The SELECT list (after `m.`, the machine; `src`, the source film) shared by the readers.
const COLS: &str = "m.id, m.name, m.spacing_mm, m.width_px, m.height_px, m.scale_source, src.taken_on, m.scale_set_at";
const SRC: &str = "LEFT JOIN cases src ON src.id = substr(m.scale_source, 6) AND substr(m.scale_source, 1, 5) = 'film:'";

fn from_row(r: &rusqlite::Row, applies: bool) -> rusqlite::Result<MachineScale> {
    let source: String = r.get(5)?;
    let (kind, case) = match source.strip_prefix("film:") { Some(id) => ("film", Some(id.to_string())), None => ("entered", None) };
    Ok(MachineScale { machine_id: r.get(0)?, machine_name: r.get(1)?, spacing_mm: r.get(2)?, width_px: r.get(3)?, height_px: r.get(4)?,
        source: kind.into(), source_case_id: case, source_film_date: r.get(6)?, set_at: r.get(7)?, applies })
}
/// The film's machine (None when not recognised).
pub(crate) fn machine_of(conn: &Connection, case_id: &str) -> rusqlite::Result<Option<MachineRef>> {
    conn.query_row("SELECT m.id, m.name FROM cases c JOIN layout_machines m ON m.id = c.layout_machine_id WHERE c.id = ?1", [case_id],
        |r| Ok(MachineRef { id: r.get(0)?, name: r.get(1)? })).optional()
}
/// The film's machine's scale, with whether it applies to this film; None when the machine has none.
pub(crate) fn scale_for_case(conn: &Connection, case_id: &str) -> rusqlite::Result<Option<MachineScale>> {
    conn.query_row(&format!("SELECT {COLS}, {APPLIES} FROM cases c JOIN images i ON i.sha256 = c.image_sha256
                             JOIN layout_machines m ON m.id = c.layout_machine_id {SRC} WHERE c.id = ?1 AND m.spacing_mm IS NOT NULL"),
        [case_id], |r| { let a: bool = r.get(8)?; from_row(r, a) }).optional()
}
/// The film's base mm per px, before any fit: its ruler, else its machine's scale when it applies, else None
/// (assumed). The one number MS-3 compares before and after a change.
pub(crate) fn base_spacing(conn: &Connection, case_id: &str) -> rusqlite::Result<Option<f64>> {
    conn.query_row(&format!("SELECT COALESCE(c.spacing_mm, (SELECT m.spacing_mm FROM layout_machines m WHERE {APPLIES}))
                             FROM cases c JOIN images i ON i.sha256 = c.image_sha256 WHERE c.id = ?1"), [case_id], |r| r.get(0))
}
/// A machine's scale for Library › Film layouts (`applies` false: no film in view), and how many live films with no
/// ruler use it now.
pub(crate) fn scale_of_machine(conn: &Connection, machine_id: &str) -> rusqlite::Result<(Option<MachineScale>, i64)> {
    let s = conn.query_row(&format!("SELECT {COLS} FROM layout_machines m {SRC} WHERE m.id = ?1 AND m.spacing_mm IS NOT NULL"),
        [machine_id], |r| from_row(r, false)).optional()?;
    let n: i64 = conn.query_row(&format!("SELECT COUNT(*) FROM cases c JOIN images i ON i.sha256 = c.image_sha256, layout_machines m
                                          WHERE m.id = ?1 AND c.deleted_at IS NULL AND c.spacing_mm IS NULL AND {APPLIES}"), [machine_id], |r| r.get(0))?;
    Ok((s, n))
}

/// A machine's scale as stored (MS1): `source` "entered" or "film:<case id>"; `set_at` None = now (an undo passes the
/// old time back, so it restores the value and nothing else).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MachineScaleRow { pub spacing_mm: f64, pub width_px: i64, pub height_px: i64, pub source: String, pub set_at: Option<String> }
/// What a change does (MS4): live films of the machine whose mm change, live films fitted to them with "Use the scale
/// from the fit" on, and how many more of either are in Recently deleted. Every one of them loses Tracing verified.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ScaleChange { pub films: Vec<String>, pub fitted: Vec<String>, pub deleted: i64 }

fn check(r: &MachineScaleRow) -> anyhow::Result<()> {
    ensure!(r.spacing_mm.is_finite() && r.spacing_mm > 0.0, "enter the machine's mm per pixel as a number above 0");
    ensure!(r.width_px > 0 && r.height_px > 0, "enter the film size in pixels, width and height above 0");
    ensure!(r.source == "entered" || r.source.strip_prefix("film:").is_some_and(|id| !id.is_empty()), "unknown scale source {:?}", r.source);
    Ok(())
}
/// Every film whose base mm (`base_spacing`) would differ if machine `machine_id` held `new`, worked out with the same
/// `APPLIES` rule the readers use: films of the machine with no ruler whose size matches the old or the new scale;
/// then films fitted to one of them with the switch on, no ruler, and no machine scale of their own after the change.
fn change(conn: &Connection, machine_id: &str, new: Option<&MachineScaleRow>) -> anyhow::Result<(ScaleChange, Vec<String>)> {
    let old: Option<(f64, i64, i64)> = conn.query_row("SELECT spacing_mm, width_px, height_px FROM layout_machines WHERE id = ?1",
        [machine_id], |r| Ok((r.get::<_, Option<f64>>(0)?, r.get::<_, Option<i64>>(1)?, r.get::<_, Option<i64>>(2)?)))
        .optional()?.ok_or_else(|| anyhow!("no machine {machine_id}"))
        .map(|(s, w, h)| s.zip(w).zip(h).map(|((s, w), h)| (s, w, h)))?;
    let at = |sc: Option<(f64, i64, i64)>, w: i64, h: i64| sc.filter(|s| s.1 == w && s.2 == h).map(|s| s.0.to_bits());
    let newv = new.map(|n| (n.spacing_mm, n.width_px, n.height_px));
    let mut changed: Vec<(String, bool)> = Vec::new();
    let mut st = conn.prepare("SELECT c.id, i.width, i.height, c.deleted_at IS NOT NULL FROM cases c JOIN images i ON i.sha256 = c.image_sha256
                               WHERE c.layout_machine_id = ?1 AND c.spacing_mm IS NULL ORDER BY c.created_at, c.rowid")?;
    for r in st.query_map([machine_id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?, r.get::<_, i64>(2)?, r.get::<_, bool>(3)?)))? {
        let (id, w, h, gone) = r?;
        if at(old, w, h) != at(newv, w, h) { changed.push((id, gone)); }
    }
    let ids: Vec<String> = changed.iter().map(|c| c.0.clone()).collect();
    // Counted once (already in `changed`), and skipped when its own scale comes from another machine: machine above
    // fit, and that machine is not changing. A film of THIS machine at another size has no machine scale before or
    // after, so its fit's mm move with the reference: counted.
    let fitted = fitted_to(conn, &ids, |f| Ok(ids.iter().any(|i| i == f) || {
        let other_machine: bool = conn.query_row("SELECT layout_machine_id IS NOT ?2 FROM cases WHERE id = ?1", params![f, machine_id], |r| r.get(0))?;
        other_machine && base_spacing(conn, f)?.is_some()
    }))?;
    let all: Vec<String> = ids.iter().cloned().chain(fitted.iter().map(|f| f.0.clone())).collect();
    let deleted = changed.iter().chain(&fitted).filter(|c| c.1).count() as i64;
    Ok((ScaleChange { films: changed.into_iter().filter(|c| !c.1).map(|c| c.0).collect(), fitted: fitted.into_iter().filter(|c| !c.1).map(|c| c.0).collect(), deleted }, all))
}
/// D-c, the one rule a scale change (`change`) and a re-match (`layouts.rs::match_machine`) share: the films fitted
/// to one of `refs` with "Use the scale from the fit" on and no ruler, live or in Recently deleted (the bool), each
/// once, in import order — their mm are the reference's mm × the fit's size, so they move with it. Left out: a film
/// `keeps_own` says has a base scale of its own after the change (a machine scale sits above a fit).
pub(crate) fn fitted_to(conn: &Connection, refs: &[String], keeps_own: impl Fn(&str) -> anyhow::Result<bool>) -> anyhow::Result<Vec<(String, bool)>> {
    let mut out: Vec<(String, bool)> = Vec::new();
    let mut q = conn.prepare("SELECT f.case_id, c.deleted_at IS NOT NULL FROM film_fits f JOIN cases c ON c.id = f.case_id
                              WHERE f.ref_case_id = ?1 AND f.use_own = 1 AND c.spacing_mm IS NULL ORDER BY c.created_at, c.rowid")?;
    for id in refs {
        for r in q.query_map([id], |r| Ok((r.get::<_, String>(0)?, r.get::<_, bool>(1)?)))? {
            let (f, gone) = r?;
            if !keeps_own(&f)? && !out.iter().any(|x| x.0 == f) { out.push((f, gone)); }
        }
    }
    Ok(out)
}
/// Clears Tracing verified on each listed film that has it. A film that was never signed off is not written at all,
/// so its last-edited date stays (final review M2): its only change is a derived scale, not an edit.
pub(crate) fn unverify_all(tx: &rusqlite::Transaction, ids: &[String]) -> rusqlite::Result<()> {
    for id in ids { tx.execute(&format!("UPDATE cases SET verified_at = NULL, verified_by = NULL, updated_at = {NOW} WHERE id = ?1 AND verified_at IS NOT NULL"), [id])?; }
    Ok(())
}
/// What deleting a machine would change: the same as removing its scale (`layouts.rs::delete_machine`).
pub(crate) fn change_for_delete(conn: &Connection, id: &str) -> anyhow::Result<(ScaleChange, Vec<String>)> { change(conn, id, None) }

impl Library {
    /// What setting machine `machine_id`'s scale to `new` (None: removing it) would change — the warning's count (MS4).
    pub fn machine_scale_change(&self, machine_id: &str, new: Option<&MachineScaleRow>) -> anyhow::Result<ScaleChange> {
        if let Some(n) = new { check(n)?; }
        Ok(change(&self.conn, machine_id, new)?.0)
    }
    /// Sets, changes or removes a machine's scale (MS1, MS4). Clears Tracing verified on exactly the films
    /// `machine_scale_change` lists (live and in Recently deleted), in the same transaction; writes nothing else on
    /// any film (a film that was not signed off is not written at all, so its last-edited date stays). Returns what it changed.
    pub fn set_machine_scale(&mut self, machine_id: &str, new: Option<&MachineScaleRow>) -> anyhow::Result<ScaleChange> {
        if let Some(n) = new { check(n)?; }
        let tx = self.conn.transaction()?;
        let (c, all) = change(&tx, machine_id, new)?;
        match new {
            Some(n) => tx.execute(&format!("UPDATE layout_machines SET spacing_mm = ?2, width_px = ?3, height_px = ?4, scale_source = ?5,
                                             scale_set_at = COALESCE(?6, {NOW}), updated_at = {NOW} WHERE id = ?1"),
                params![machine_id, n.spacing_mm, n.width_px, n.height_px, n.source, n.set_at])?,
            None => tx.execute(&format!("UPDATE layout_machines SET spacing_mm = NULL, width_px = NULL, height_px = NULL, scale_source = NULL,
                                          scale_set_at = NULL, updated_at = {NOW} WHERE id = ?1"), [machine_id])?,
        };
        unverify_all(&tx, &all)?;
        tx.commit()?;
        Ok(c)
    }
    /// "Use for this machine" (MS1): the film's own ruler scale (with its fine-tune) and exact pixel size, sourced to it.
    pub fn machine_scale_from_film(&self, case_id: &str) -> anyhow::Result<(String, MachineScaleRow)> {
        let (machine, spacing, w, h, gone): (Option<String>, Option<f64>, i64, i64, bool) = self.conn.query_row(
            "SELECT c.layout_machine_id, c.spacing_mm, i.width, i.height, c.deleted_at IS NOT NULL FROM cases c JOIN images i ON i.sha256 = c.image_sha256 WHERE c.id = ?1",
            [case_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).optional()?.ok_or_else(|| anyhow!("no case {case_id} in the library"))?;
        ensure!(!gone, "this film is in Recently deleted");
        let spacing = spacing.ok_or_else(|| anyhow!("this film has no ruler calibration to use for its machine"))?;
        let machine = machine.ok_or_else(|| anyhow!("this film was not recognised as an X-ray machine"))?;
        Ok((machine, MachineScaleRow { spacing_mm: spacing, width_px: w, height_px: h, source: format!("film:{case_id}"), set_at: None }))
    }
    /// What deleting machine `id` would change: the same as removing its scale.
    pub fn machine_delete_change(&self, id: &str) -> anyhow::Result<ScaleChange> { self.machine_scale_change(id, None) }
}
