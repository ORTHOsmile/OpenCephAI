use crate::metrics::Summary;
use crate::parity::Parity;
use anyhow::Context;
use std::{collections::BTreeMap, fmt::Write as _, path::Path};

/// Global Constraints: every report records git SHA, model SHA-256, dataset revision, OS/chip and execution provider.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    pub git_sha: String,
    pub git_dirty: bool,
    pub dataset_revision: String,
    pub model_sha256: String,
    pub os: String,
    pub arch: String,
    pub generated_unix: u64,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub overall: Summary,
    pub per_landmark: BTreeMap<String, Summary>,
    pub per_split: BTreeMap<String, Summary>,
    pub worst10: Vec<(String, f64)>,                        // (image_id, image MRE mm)
    pub leakage_note: String,
    pub manifest: serde_json::Value,
    pub provider: String,
    pub mean_inference_ms: f64,
    pub parity: Option<Parity>,
    pub provenance: Provenance,
    pub not_in_dataset: BTreeMap<String, usize>,            // landmark id the model found -> count of films where the dataset lacked ground truth for it
    pub spacing: String,                                    // how pixel spacing was determined, for the report
    /// Aariz only: rule `aariz-scale/1` and its counts (used, excluded by reason and machine, flagged). Absent elsewhere.
    #[serde(skip_serializing_if = "Option::is_none")] pub aariz_scale: Option<crate::scale::ScaleCounts>,
    #[serde(skip)] pub predictions: Vec<(String, String, f64, f64, f32)>,   // image_id, landmark, x, y, confidence
    #[serde(skip)] pub point_bits: Vec<(String, String, u64, u64, u32)>,   // image_id, landmark, x, y, peak as bit patterns (spec 2026-10-13 §6.1 parity)
}

/// Writes `predictions.csv`, `metrics.json` and `report.md` into `dir` (a local, gitignored reports/<run>/ folder).
pub fn write(dir: &Path, r: &Report) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)?;
    let mut csv = String::from("image_id,landmark,x,y,confidence\n");
    for (i, l, x, y, c) in &r.predictions { writeln!(csv, "{i},{l},{x:.4},{y:.4},{c:.6}")?; }
    std::fs::write(dir.join("predictions.csv"), csv)?;
    std::fs::write(dir.join("metrics.json"), serde_json::to_string_pretty(r)?)?;
    let p = &r.provenance;
    let mut md = format!("# ceph-bench report\n\nModel `{}` (sha256 `{}`) · provider `{}` · mean inference {:.1} ms\n\n\
        Provenance: git `{}`{} · dataset `{}` · {}/{} · generated {} (unix)\n\nPixel spacing: {}\n\n{}\n\n",
        r.manifest.get("id").and_then(|v| v.as_str()).unwrap_or("?"), &p.model_sha256[..p.model_sha256.len().min(12)],
        r.provider, r.mean_inference_ms, p.git_sha, if p.git_dirty { " (uncommitted changes)" } else { "" },
        p.dataset_revision, p.os, p.arch, p.generated_unix, r.spacing, r.leakage_note);
    if let Some(c) = &r.aariz_scale { let _ = writeln!(md, "{}\n", scale_line(c)); }
    if !r.not_in_dataset.is_empty() {
        let parts: Vec<String> = r.not_in_dataset.iter().map(|(id, n)| format!("{id} ({n} films)")).collect();
        let _ = writeln!(md, "Points the model finds that this dataset doesn't have: {}\n", parts.join(", "));
    }
    let row = |md: &mut String, name: &str, s: &Summary| {
        let sdr: Vec<String> = s.sdr.iter().map(|(_, v)| format!("{:.1}%", v * 100.0)).collect();
        let _ = writeln!(md, "| {name} | {:.3} | {:.3} | {} |", s.mre, s.sd, sdr.join(" | "));
    };
    md.push_str("| landmark | MRE | SD | SDR2.0 | 2.5 | 3.0 | 4.0 |\n|---|---|---|---|---|---|---|\n");
    for (k, s) in &r.per_landmark { row(&mut md, k, s); }
    row(&mut md, "**overall**", &r.overall);
    md.push_str("\n| split | MRE | SD | SDR2.0 | 2.5 | 3.0 | 4.0 |\n|---|---|---|---|---|---|---|\n");
    for (k, s) in &r.per_split { row(&mut md, k, s); }
    if let Some(p) = &r.parity { writeln!(md, "\nRust↔Python parity: max {:.4} px, mean {:.4} px over {} points", p.max_px, p.mean_px, p.n)?; }
    std::fs::write(dir.join("report.md"), md)?;
    let mut bits = String::from("image_id,landmark,x_bits,y_bits,peak_bits\n");
    for (i, l, x, y, p) in &r.point_bits { writeln!(bits, "{i},{l},{x:016x},{y:016x},{p:08x}")?; }
    std::fs::write(dir.join("points-bits.csv"), bits)?;
    Ok(())
}

/// One line for people: the Aariz scale rule and its counts (aggregates only).
pub fn scale_line(c: &crate::scale::ScaleCounts) -> String {
    let by = |m: &BTreeMap<String, usize>| m.iter().map(|(k, n)| format!("{k} {n}")).collect::<Vec<_>>().join(", ");
    let ex: Vec<String> = c.excluded_by_reason.iter().map(|(why, m)| format!("{why}: {}", by(m))).collect();
    format!("Aariz scale: {} · used {} of {} ({}) · excluded {} ({}) · flagged {} (S–N outside {}–{} mm{}{})",
        c.aariz_scale_rule, c.used, c.films, by(&c.used_by_machine), c.excluded, ex.join("; "), c.flagged,
        c.sn_range_mm.0, c.sn_range_mm.1, if c.flagged > 0 { ": " } else { "" }, by(&c.flagged_by_machine))
}

/// The three words every score row and table cell carries (spec §7).
pub const LEAKAGE: [&str; 3] = ["clean", "leaked", "home-ground"];

/// One scores row: the shape `reference/model-scores.json` holds (P4) plus `leakage`.
#[allow(clippy::too_many_arguments)]
pub fn scores_entry(per_landmark: &BTreeMap<String, Summary>, dataset: &str, split: &str, model_id: &str, model_sha256: &str,
    git_sha: &str, spacing: &str, leakage: &str, aariz_scale: Option<&crate::scale::ScaleCounts>) -> anyhow::Result<serde_json::Value> {
    anyhow::ensure!(LEAKAGE.contains(&leakage), "leakage must be one of {LEAKAGE:?}, not {leakage:?}");
    let sdr2 = |s: &Summary| s.sdr.iter().find(|(t, _)| (*t - 2.0).abs() < 1e-9).map(|(_, v)| *v).unwrap_or(0.0);
    let points: BTreeMap<String, serde_json::Value> = per_landmark.iter()
        .map(|(id, s)| (id.clone(), serde_json::json!({ "n": s.n, "mre": s.mre, "sd": s.sd, "sdr2": sdr2(s) }))).collect();
    let mut row = serde_json::json!({ "dataset": dataset, "split": split, "modelId": model_id, "modelSha256": model_sha256,
        "gitSha": git_sha, "spacing": spacing, "leakage": leakage, "points": points });
    if let Some(c) = aariz_scale { row["aarizScale"] = serde_json::to_value(c)?; }     // Aariz only (task 2b)
    Ok(row)
}

/// Appends one row to the scores array at `path` (created if missing); a file that is not that array is refused, untouched.
/// Written to a temp file beside it, then renamed, so a crash never leaves a half-written file (kept from the old
/// `write_scores`; preflight c11).
pub fn append_scores(path: &Path, entry: serde_json::Value) -> anyhow::Result<()> {
    let mut all: Vec<serde_json::Value> = if path.exists() {
        let bytes = std::fs::read(path).with_context(|| path.display().to_string())?;
        serde_json::from_slice(&bytes).with_context(|| {
            format!("{}: exists but is not the scores array this tool writes (corrupt or truncated); refusing to overwrite it", path.display())
        })?
    } else { Vec::new() };
    all.push(entry);
    let tmp = path.with_extension(match path.extension().and_then(|e| e.to_str()) { Some(ext) => format!("{ext}.tmp"), None => "tmp".to_string() });
    std::fs::write(&tmp, serde_json::to_string_pretty(&all)?).with_context(|| tmp.display().to_string())?;
    std::fs::rename(&tmp, path).with_context(|| format!("renaming {} to {}", tmp.display(), path.display()))?;
    Ok(())
}

/// A bench report's per-point scores as one row (Task 6 of Part B, plus `leakage`, spec 2026-10-13 §7).
pub fn write_scores(path: &Path, r: &Report, dataset: &str, split: &str, leakage: &str) -> anyhow::Result<()> {
    let id = r.manifest.get("id").and_then(|v| v.as_str()).unwrap_or("?");
    append_scores(path, scores_entry(&r.per_landmark, dataset, split, id, &r.provenance.model_sha256, &r.provenance.git_sha, &r.spacing, leakage, r.aariz_scale.as_ref())?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::metrics::summarize;
    #[test] fn writes_predictions_metrics_and_markdown() {
        let dir = std::env::temp_dir().join(format!("ceph-bench-report-{}", std::process::id()));
        let s = summarize(&[1.0, 3.0], &[2.0, 2.5, 3.0, 4.0]);
        let r = Report {
            overall: s.clone(), per_landmark: [("S".into(), s.clone())].into(), per_split: [("test1".into(), s.clone())].into(),
            worst10: vec![("151".into(), 3.0)], leakage_note: "note".into(), manifest: serde_json::json!({"id": "m"}),
            provider: "cpu".into(), mean_inference_ms: 12.5, parity: None,
            provenance: Provenance { git_sha: "abc1234".into(), git_dirty: false, dataset_revision: "fc579ac".into(),
                                     model_sha256: "16f2".into(), os: "linux".into(), arch: "x86_64".into(), generated_unix: 1 },
            not_in_dataset: BTreeMap::new(), spacing: "0.1 mm/px fixed (Ceph-400)".into(), aariz_scale: None,
            predictions: vec![("151".into(), "S".into(), 1.0, 2.0, 0.9)], point_bits: vec![],
        };
        write(&dir, &r).unwrap();
        let csv = std::fs::read_to_string(dir.join("predictions.csv")).unwrap();
        assert_eq!(csv.lines().collect::<Vec<_>>(), vec!["image_id,landmark,x,y,confidence", "151,S,1.0000,2.0000,0.900000"]);
        let m: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("metrics.json")).unwrap()).unwrap();
        for k in ["overall", "perLandmark", "perSplit", "worst10", "leakageNote", "manifest", "provider", "meanInferenceMs", "provenance"] {
            assert!(m.get(k).is_some(), "metrics.json lacks {k}");
        }
        assert_eq!(m["provenance"]["gitSha"], "abc1234"); assert_eq!(m["provenance"]["datasetRevision"], "fc579ac");
        let md = std::fs::read_to_string(dir.join("report.md")).unwrap();
        assert!(md.contains("git `abc1234`") && md.contains("dataset `fc579ac`") && md.contains("linux/x86_64"));
        assert!(md.contains("| landmark | MRE | SD | SDR2.0 | 2.5 | 3.0 | 4.0 |") && md.contains("| S | 2.000 |"));
        std::fs::remove_dir_all(&dir).ok();
    }
    #[test] fn report_md_names_points_the_dataset_lacks() {
        let dir = std::env::temp_dir().join(format!("ceph-bench-report-nid-{}", std::process::id()));
        let s = summarize(&[1.0], &[2.0, 2.5, 3.0, 4.0]);
        let r = Report {
            overall: s.clone(), per_landmark: [("S".into(), s.clone())].into(), per_split: BTreeMap::new(),
            worst10: vec![], leakage_note: String::new(), manifest: serde_json::json!({"id": "m"}),
            provider: "cpu".into(), mean_inference_ms: 1.0, parity: None,
            provenance: Provenance { git_sha: "abc".into(), git_dirty: false, dataset_revision: "r".into(),
                                     model_sha256: "16f2".into(), os: "linux".into(), arch: "x86_64".into(), generated_unix: 1 },
            not_in_dataset: [("U1A".to_string(), 150usize)].into(), spacing: "per film, spacing.csv".into(), aariz_scale: None,
            predictions: vec![], point_bits: vec![],
        };
        write(&dir, &r).unwrap();
        let md = std::fs::read_to_string(dir.join("report.md")).unwrap();
        assert!(md.contains("U1A (150 films)"));
        assert!(md.contains("Pixel spacing: per film, spacing.csv"));
        std::fs::remove_dir_all(&dir).ok();
    }
    #[test] fn write_scores_produces_the_shape_task6_reads() {
        let dir = std::env::temp_dir().join(format!("ceph-bench-scores-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("scores.json");
        let s = summarize(&[1.0, 3.0], &[2.0, 2.5, 3.0, 4.0]);
        let r = Report {
            overall: s.clone(), per_landmark: [("U1A".into(), s.clone())].into(), per_split: BTreeMap::new(),
            worst10: vec![], leakage_note: String::new(), manifest: serde_json::json!({"id": "srpose-cldet23"}),
            provider: "cpu".into(), mean_inference_ms: 1.0, parity: None,
            provenance: Provenance { git_sha: "deadbee".into(), git_dirty: false, dataset_revision: "r".into(),
                                     model_sha256: "sha123".into(), os: "linux".into(), arch: "x86_64".into(), generated_unix: 1 },
            not_in_dataset: BTreeMap::new(), spacing: "per film, spacing.csv".into(), aariz_scale: None,
            predictions: vec![], point_bits: vec![],
        };
        write_scores(&path, &r, "aariz", "test", "clean").unwrap();
        let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        let entry = &v.as_array().unwrap()[0];
        assert_eq!(entry["dataset"], "aariz"); assert_eq!(entry["split"], "test");
        assert_eq!(entry["modelId"], "srpose-cldet23"); assert_eq!(entry["modelSha256"], "sha123"); assert_eq!(entry["gitSha"], "deadbee");
        assert_eq!(entry["spacing"], "per film, spacing.csv");
        assert_eq!(entry["points"]["U1A"]["n"], 2); assert_eq!(entry["points"]["U1A"]["sdr2"], 0.5);
        // a second call appends a new entry rather than overwriting
        write_scores(&path, &r, "aariz", "valid", "clean").unwrap();
        let v2: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap();
        assert_eq!(v2.as_array().unwrap().len(), 2);
        std::fs::remove_dir_all(&dir).ok();
    }
    #[test] fn write_scores_refuses_to_overwrite_a_corrupt_file() {
        let dir = std::env::temp_dir().join(format!("ceph-bench-scores-corrupt-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let s = summarize(&[1.0, 3.0], &[2.0, 2.5, 3.0, 4.0]);
        let r = Report {
            overall: s.clone(), per_landmark: [("U1A".into(), s.clone())].into(), per_split: BTreeMap::new(),
            worst10: vec![], leakage_note: String::new(), manifest: serde_json::json!({"id": "m"}),
            provider: "cpu".into(), mean_inference_ms: 1.0, parity: None,
            provenance: Provenance { git_sha: "g".into(), git_dirty: false, dataset_revision: "r".into(),
                                     model_sha256: "s".into(), os: "linux".into(), arch: "x86_64".into(), generated_unix: 1 },
            not_in_dataset: BTreeMap::new(), spacing: "per film, spacing.csv".into(), aariz_scale: None,
            predictions: vec![], point_bits: vec![],
        };
        // Case 1: valid JSON, but not an array — not the shape write_scores produces.
        let p1 = dir.join("not_an_array.json");
        std::fs::write(&p1, r#"{"not":"an array"}"#).unwrap();
        let before1 = std::fs::read(&p1).unwrap();
        let err1 = write_scores(&p1, &r, "aariz", "test", "clean").unwrap_err();
        assert!(err1.to_string().contains(&p1.display().to_string()), "error should name the file: {err1}");
        assert_eq!(std::fs::read(&p1).unwrap(), before1, "a corrupt file must be left untouched, not overwritten");
        // Case 2: truncated JSON (as a crashed prior run might leave behind).
        let p2 = dir.join("truncated.json");
        std::fs::write(&p2, r#"[{"dataset":"#).unwrap();
        let before2 = std::fs::read(&p2).unwrap();
        let err2 = write_scores(&p2, &r, "aariz", "test", "clean").unwrap_err();
        assert!(err2.to_string().contains(&p2.display().to_string()), "error should name the file: {err2}");
        assert_eq!(std::fs::read(&p2).unwrap(), before2, "a corrupt file must be left untouched, not overwritten");
        std::fs::remove_dir_all(&dir).ok();
    }
    #[test] fn a_scores_entry_carries_its_leakage_word_and_refuses_any_other() {
        let s = summarize(&[1.0, 3.0], &[2.0, 2.5, 3.0, 4.0]);
        let per: BTreeMap<String, Summary> = [("S".to_string(), s)].into();
        let e = scores_entry(&per, "aariz", "valid", "gu2net-isbi19", "sha", "git", "per film, spacing.csv", "clean", None).unwrap();
        assert_eq!((e["leakage"].as_str(), e["split"].as_str(), e["points"]["S"]["n"].as_u64()), (Some("clean"), Some("valid"), Some(2)));
        assert!(scores_entry(&per, "aariz", "valid", "m", "s", "g", "x", "fine", None).is_err());
    }
    fn counts() -> crate::scale::ScaleCounts {
        crate::scale::ScaleCounts { aariz_scale_rule: crate::scale::AARIZ_SCALE_RULE.into(), films: 150, used: 98, excluded: 52, flagged: 2,
            used_by_machine: [("ART Plus".to_string(), 55)].into(), flagged_by_machine: [("Rotograph EVO".to_string(), 2)].into(),
            excluded_by_reason: [(crate::scale::NO_TRUE_SCALE.to_string(), [("Smart3D".to_string(), 9)].into())].into(),
            sn_range_mm: crate::scale::SN_RANGE_MM }
    }
    #[test] fn an_aariz_scores_row_records_the_scale_rule_and_its_counts_and_a_ceph400_row_does_not() {
        let s = summarize(&[1.0, 3.0], &[2.0, 2.5, 3.0, 4.0]);
        let per: BTreeMap<String, Summary> = [("S".to_string(), s)].into();
        let c = counts();
        let e = scores_entry(&per, "aariz", "valid", "gu2net-isbi19", "sha", "git", "x", "clean", Some(&c)).unwrap();
        assert_eq!(e["aarizScale"]["aarizScaleRule"], "aariz-scale/1");
        assert_eq!((e["aarizScale"]["used"].as_u64(), e["aarizScale"]["excluded"].as_u64(), e["aarizScale"]["flagged"].as_u64()), (Some(98), Some(52), Some(2)));
        assert_eq!(e["aarizScale"]["excludedByReason"]["no source of true scale"]["Smart3D"], 9);
        let e = scores_entry(&per, "ceph400", "test1", "gu2net-isbi19", "sha", "git", "x", "clean", None).unwrap();
        assert!(e.get("aarizScale").is_none(), "a Ceph-400 row is unchanged: {e}");
    }
    #[test] fn metrics_json_and_report_md_record_the_aariz_scale_rule_only_for_aariz() {
        let dir = std::env::temp_dir().join(format!("ceph-bench-report-scale-{}", std::process::id()));
        let s = summarize(&[1.0], &[2.0, 2.5, 3.0, 4.0]);
        let mut r = Report {
            overall: s.clone(), per_landmark: [("S".into(), s.clone())].into(), per_split: BTreeMap::new(),
            worst10: vec![], leakage_note: String::new(), manifest: serde_json::json!({"id": "m"}),
            provider: "cpu".into(), mean_inference_ms: 1.0, parity: None,
            provenance: Provenance { git_sha: "abc".into(), git_dirty: false, dataset_revision: "r".into(),
                                     model_sha256: "16f2".into(), os: "linux".into(), arch: "x86_64".into(), generated_unix: 1 },
            not_in_dataset: BTreeMap::new(), spacing: "x".into(), aariz_scale: Some(counts()), predictions: vec![], point_bits: vec![],
        };
        write(&dir, &r).unwrap();
        let m: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("metrics.json")).unwrap()).unwrap();
        assert_eq!((m["aarizScale"]["aarizScaleRule"].as_str(), m["aarizScale"]["used"].as_u64()), (Some("aariz-scale/1"), Some(98)));
        let md = std::fs::read_to_string(dir.join("report.md")).unwrap();
        assert!(md.contains("aariz-scale/1") && md.contains("used 98 of 150") && md.contains("flagged 2"), "{md}");
        r.aariz_scale = None;
        write(&dir, &r).unwrap();
        let m: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(dir.join("metrics.json")).unwrap()).unwrap();
        assert!(m.get("aarizScale").is_none());
        assert!(!std::fs::read_to_string(dir.join("report.md")).unwrap().contains("aariz-scale"));
        std::fs::remove_dir_all(&dir).ok();
    }
    #[test] fn write_records_every_points_bits() {
        let d = tempfile::tempdir().unwrap();
        let s = summarize(&[1.0], &[2.0, 2.5, 3.0, 4.0]);
        let r = Report { overall: s.clone(), per_landmark: BTreeMap::new(), per_split: BTreeMap::new(), worst10: vec![], leakage_note: String::new(),
            manifest: serde_json::json!({"id": "m"}), provider: "cpu".into(), mean_inference_ms: 1.0, parity: None,
            provenance: Provenance { git_sha: "g".into(), git_dirty: false, dataset_revision: "r".into(), model_sha256: "s".into(), os: "o".into(), arch: "a".into(), generated_unix: 1 },
            not_in_dataset: BTreeMap::new(), spacing: "x".into(), aariz_scale: None, predictions: vec![], point_bits: vec![("f".into(), "S".into(), 1.5f64.to_bits(), 2.0f64.to_bits(), 3.0f32.to_bits())] };
        write(d.path(), &r).unwrap();
        assert_eq!(std::fs::read_to_string(d.path().join("points-bits.csv")).unwrap(), "image_id,landmark,x_bits,y_bits,peak_bits\nf,S,3ff8000000000000,4000000000000000,40400000\n");
    }
}
