//! SC-1 Part 1b, whole-film/3 (owner ruling, 5 Nov 2026, spec §17.15): the two committed records and the setup that puts
//! them in force.
//!
//! **The picture.** The owner set two numbers by ruling, after the development run and its decomposition: the maxilla and
//! mandible tolerances back to 0.02 (gate /2's values, recorded as `sc1-box-gate/4`), and the cranial-base centre line at
//! 0.08 instead of the measured 0.06 (the measured median kept). This module reads those two records and writes them into
//! the stored calibrations the app and the bench read, keeping the files they replace byte for byte beside them
//! (`calibration-3.json`, `cb-centre-calibration-1.json`). It reads no film.
//!
//! **What it cannot say.** Nothing here is measured: both numbers are rulings, chosen on the development films (the third
//! tuning on them). Only SC1-1b-PKU measures whole-film/3 on unseen films.
use crate::ft_common;
use anyhow::{ensure, Context};
use ceph_model::wholefilm::{CbCalibration, RegionCalibration};
use std::path::Path;

pub use ceph_model::wholefilm::{check_gate4, check_ruled_centre, records, Records, CENTRE_PATH, CENTRE_RECORD, GATE4, GATE4_PATH, GATE4_RECORD, WHOLE_FILM_3};
/// The files kept beside the ones whole-film/3 replaces.
pub const KEPT_TAU: &str = "calibration-3.json";
pub const KEPT_CENTRE: &str = "cb-centre-calibration-1.json";

/// Gate /4's calibration from gate /3's in force (rule /3, its report the record's, this detector, the record's score
/// line): the same file with rule /4, the record's τ, and the record's hash where the gate report's was.
pub fn gate4_calibration(gate3: &RegionCalibration, r: &Records) -> anyhow::Result<RegionCalibration> {
    ensure!(gate3.gate_rule() == "sc1-box-gate/3", "the calibration in force was set by {}, not sc1-box-gate/3: whole-film/3 replaces gate /3's", gate3.gate_rule());
    ensure!(gate3.gate_report_sha256 == r.from_gate3, "the calibration in force names gate /3 report {}, the record names {}", gate3.gate_report_sha256, r.from_gate3);
    ensure!(gate3.detector_fingerprint == r.fingerprint && gate3.score_line == r.score_line, "the calibration in force is for detector {} at score line {}, the record for {} at {}",
        gate3.detector_fingerprint, gate3.score_line, r.fingerprint, r.score_line);
    Ok(RegionCalibration { tau: ceph_model::wholefilm::RegionTau(r.tau), gate_report_sha256: r.gate4_sha.clone(), rule: Some(GATE4.into()), ..gate3.clone() })
}
/// The ruled centre calibration from the measured one (no ruling, the measured report and line, this detector): the line
/// the record's, the median kept, and a ruling naming the record and the measured line.
pub fn ruled_centre(measured: &CbCalibration, r: &Records) -> anyhow::Result<CbCalibration> {
    ensure!(measured.ruling.is_none(), "the centre calibration in force is already ruled ({:?}), not the measured one", measured.ruling);
    ensure!(measured.report_sha256 == r.measured_report, "the measured centre calibration names report {}, the record names {}", measured.report_sha256, r.measured_report);
    ensure!(measured.line == r.measured_line, "the measured centre line is {}, the record says {}", measured.line, r.measured_line);
    ensure!(measured.detector_fingerprint == r.fingerprint, "the centre calibration is for detector {}, the record for {}", measured.detector_fingerprint, r.fingerprint);
    Ok(CbCalibration { line: r.centre_line, ruling: Some(ceph_model::wholefilm::CbRuling { rule: WHOLE_FILM_3.into(), measured_line: r.measured_line, record_sha256: r.centre_sha.clone() }), ..measured.clone() })
}
/// The git state of the two records.
#[derive(Clone, Debug)]
pub struct RecordsGit { pub gate4_at_head: Option<Vec<u8>>, pub centre_at_head: Option<Vec<u8>>, pub dirty: bool }
/// Writes `new` at `path` after keeping `old` (the bytes there now) at `kept` (or finding it there already, byte for
/// byte), then reads it back through `parse` and compares.
fn replace<T: PartialEq + std::fmt::Debug>(path: &Path, kept: &Path, old: &[u8], text: &str, back: impl Fn(&[u8]) -> anyhow::Result<T>, want: &T) -> anyhow::Result<()> {
    match std::fs::read(kept) {
        Ok(k) => ensure!(k == old, "{} exists and differs from the file it would keep: refused", kept.display()),
        Err(_) => std::fs::write(kept, old).with_context(|| kept.display().to_string())?,
    }
    std::fs::write(path, text)?;
    ensure!(&back(&std::fs::read(path)?)? == want, "{} does not read back as written", path.display());
    Ok(())
}
/// The setup on a models folder: the records committed as built from a clean tree; then gate /3's calibration → gate /4
/// (gate /3's kept as `calibration-3.json`), and the measured centre → the ruled one (kept as `cb-centre-calibration-1.json`).
/// Already in place (the same files the records give): nothing written. Reads no film. Every refusal writes nothing.
pub fn setup_with(models: &Path, r: &Records, git: &RecordsGit) -> anyhow::Result<Vec<String>> {
    ensure!(!git.dirty, "commit first: whole-film/3 is recorded ({GATE4_PATH}, {CENTRE_PATH}) and set up only from a clean tree");
    ft_common::committed_as_built(GATE4_PATH, GATE4_RECORD, git.gate4_at_head.clone())?;
    ft_common::committed_as_built(CENTRE_PATH, CENTRE_RECORD, git.centre_at_head.clone())?;
    let reg = models.join("regions");
    let (tp, kt) = (ceph_model::wholefilm::calibration_path(models), reg.join(KEPT_TAU));
    let (cp, kc) = (ceph_model::wholefilm::cb_calibration_path(models), reg.join(KEPT_CENTRE));
    let tau_now = std::fs::read(&tp).with_context(|| format!("{}: whole-film/3 needs gate /3's calibration in force", tp.display()))?;
    let cb_now = std::fs::read(&cp).with_context(|| format!("{}: whole-film/3 needs the measured centre calibration", cp.display()))?;
    let (t, c) = (ceph_model::wholefilm::parse_calibration(&tau_now)?, ceph_model::wholefilm::parse_cb_calibration(&cb_now)?);
    // Work out both files before writing either, so a refusal of the second writes nothing.
    let (tau_old, tau_new) = if t.gate_rule() == GATE4 {
        let kept = std::fs::read(&kt).with_context(|| format!("gate /4 is in force but {} is missing", kt.display()))?;
        let want = gate4_calibration(&ceph_model::wholefilm::parse_calibration(&kept)?, r)?;
        ensure!(t == want, "the gate /4 calibration in force is not the one the records give");
        (None, want)
    } else { (Some(tau_now.clone()), gate4_calibration(&t, r)?) };
    let (cb_old, cb_new) = if c.ruling.is_some() {
        let kept = std::fs::read(&kc).with_context(|| format!("a ruled centre is in force but {} is missing", kc.display()))?;
        let want = ruled_centre(&ceph_model::wholefilm::parse_cb_calibration(&kept)?, r)?;
        ensure!(c == want, "the ruled centre calibration in force is not the one the records give");
        (None, want)
    } else { (Some(cb_now.clone()), ruled_centre(&c, r)?) };
    for (old, kept) in [(&tau_old, &kt), (&cb_old, &kc)] {
        if let (Some(o), Ok(k)) = (old, std::fs::read(kept)) { ensure!(&k == o, "{} exists and differs from the file it would keep: refused", kept.display()); }
    }
    let mut out = Vec::new();
    match tau_old {
        Some(o) => { replace(&tp, &kt, &o, &ceph_model::wholefilm::calibration_json(&tau_new)?, ceph_model::wholefilm::parse_calibration, &tau_new)?;
            out.push(format!("{} written: rule {GATE4}, tau {:?}, gate record {}; gate /3's kept as {}", tp.display(), tau_new.tau.0, tau_new.gate_report_sha256, kt.display())); }
        None => out.push(format!("{} already gate /4's: nothing written", tp.display())),
    }
    match cb_old {
        Some(o) => { replace(&cp, &kc, &o, &(serde_json::to_string_pretty(&cb_new)? + "\n"), ceph_model::wholefilm::parse_cb_calibration, &cb_new)?;
            out.push(format!("{} written: line {} by ruling (measured {}), median {:?} kept, record {}; the measured file kept as {}", cp.display(), cb_new.line, r.measured_line, cb_new.median, r.centre_sha, kc.display())); }
        None => out.push(format!("{} already ruled: nothing written", cp.display())),
    }
    Ok(out)
}
/// `--sc1-whole-film-3`: the records' git state, then `setup_with` on `models`. Exit 0 set up (or already), 1 refused.
pub fn setup_cli(models: &Path) -> anyhow::Result<i32> {
    let run = || -> anyhow::Result<Vec<String>> {
        let g = crate::sc1_gate::git_state(GATE4_PATH)?;
        let git = RecordsGit { gate4_at_head: g.prereg_at_head, centre_at_head: ft_common::at_head(CENTRE_PATH), dirty: g.dirty };
        setup_with(models, &records()?, &git)
    };
    match run() {
        Ok(lines) => { println!("whole-film/3 set up (owner ruling, 5 Nov 2026, spec §17.15; reads no film):"); for l in lines { println!("  {l}"); } Ok(0) }
        Err(e) => { eprintln!("whole-film/3 setup refused (nothing written): {e:#}"); Ok(1) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ceph_model::wholefilm::{calibration_json, calibration_path, cb_calibration_path, parse_calibration, parse_cb_calibration, RegionTau, CALIBRATION_VERSION, CB_CALIBRATION_VERSION, CB_RULE};

    /// The two records' SHA-256, pinned when they were committed alone (d89baf7, before any code or run).
    const GATE4_SHA: &str = "ca3b3ecfa7a59c7cbfa23c4342b9a34ca1aa01d1625a0acf14f5f592be757cb6";
    const CENTRE_SHA: &str = "463ef936923682085f4a979e4aa0e394fa554b732dcd28a4aa09cb8d753300b5";
    const FP: &str = "17171e68f9f7072062e2a3a2cbd4851618056f5136bed998f1782c49d4897b80";

    /// Fails if: either record changes by a byte after it was committed.
    #[test] fn the_records_are_pinned() {
        assert_eq!((ft_common::sha256_hex(GATE4_RECORD.as_bytes()), ft_common::sha256_hex(CENTRE_RECORD.as_bytes())), (GATE4_SHA.to_string(), CENTRE_SHA.to_string()));
    }
    /// The records hold the ruling: gate /4's τ is gate /2's exactly (SC1-1a's pins); the detector, the gate /3 report and
    /// the measured centre report are the development run's pins; the line 0.08 widens the measured 0.06; each record's
    /// own hash is the one the confirmation run pins. Fails if: a number is read from the wrong key, or τ is not gate /2's.
    #[test] fn the_records_hold_the_ruling() {
        let r = records().unwrap();
        eprintln!("{r:?}");
        let g2 = crate::sc1_1a::Pins::from_prereg().unwrap();
        let dev = crate::sc1_dev::DevPins::from_prereg().unwrap();
        assert_eq!(r.tau, g2.tau, "gate /4's tolerances are gate /2's");
        assert_eq!(r.tau, [0.09, 0.02, 0.02, 0.01, 0.10]);
        assert_eq!((r.fingerprint.as_str(), r.score_line), (dev.fingerprint.as_str(), 0.5));
        assert_eq!((r.from_gate3.as_str(), r.measured_report.as_str()), (dev.gate3.as_str(), dev.cb.as_str()));
        assert_eq!((r.centre_line, r.measured_line), (0.08, 0.06));
        assert_eq!((r.gate4_sha.as_str(), r.centre_sha.as_str()), (GATE4_SHA, CENTRE_SHA));
        let d3 = crate::sc1_dev::DevPins::from_text(crate::sc1_dev::PREREG3).unwrap();
        assert_eq!((d3.gate4.as_deref(), d3.centre.as_deref()), (Some(GATE4_SHA), Some(CENTRE_SHA)), "the confirmation run pins these records");
    }

    /// SYNTHETIC records (the same numbers, other hashes) and a models folder holding gate /3's calibration and the
    /// measured centre file, as the development run left them.
    fn synthetic() -> (tempfile::TempDir, Records, Vec<u8>, Vec<u8>) {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("regions")).unwrap();
        let r = Records { tau: [0.09, 0.02, 0.02, 0.01, 0.10], fingerprint: FP.into(), score_line: 0.5, from_gate3: "3".repeat(64), gate4_sha: "4".repeat(64),
            centre_line: 0.08, measured_line: 0.06, measured_report: "6".repeat(64), centre_sha: "8".repeat(64) };
        let g3 = calibration_json(&RegionCalibration { version: CALIBRATION_VERSION.into(), detector_fingerprint: FP.into(), score_line: 0.5,
            tau: RegionTau([0.09, 0.07, 0.10, 0.01, 0.10]), gate_report_sha256: "3".repeat(64), rule: Some("sc1-box-gate/3".into()) }).unwrap().into_bytes();
        let cb = serde_json::to_vec_pretty(&CbCalibration { version: CB_CALIBRATION_VERSION.into(), rule: CB_RULE.into(), detector_fingerprint: FP.into(),
            median: (-0.0457, 0.0048), line: 0.06, report_sha256: "6".repeat(64), ruling: None }).unwrap();
        std::fs::write(calibration_path(d.path()), &g3).unwrap();
        std::fs::write(cb_calibration_path(d.path()), &cb).unwrap();
        (d, r, g3, cb)
    }
    fn committed() -> RecordsGit { RecordsGit { gate4_at_head: Some(GATE4_RECORD.as_bytes().to_vec()), centre_at_head: Some(CENTRE_RECORD.as_bytes().to_vec()), dirty: false } }

    /// The setup writes gate /4's calibration (rule /4, the record's τ, the record's hash as its report) and the ruled
    /// centre (line 0.08, the measured median and report, the ruling naming the record), keeps the two files it replaces
    /// byte for byte, reads back what it wrote, and is a no-op the second time. Fails if: a kept file is not the original,
    /// τ is not the record's, or the ruling is not written.
    #[test] fn the_setup_writes_whole_film_3_and_keeps_what_it_replaces() {
        let (d, r, g3, cb) = synthetic();
        for l in setup_with(d.path(), &r, &committed()).unwrap() { eprintln!("  {l}"); }
        let reg = d.path().join("regions");
        assert_eq!(std::fs::read(reg.join(KEPT_TAU)).unwrap(), g3, "gate /3's file kept byte for byte");
        assert_eq!(std::fs::read(reg.join(KEPT_CENTRE)).unwrap(), cb, "the measured centre file kept byte for byte");
        let c = parse_calibration(&std::fs::read(calibration_path(d.path())).unwrap()).unwrap();
        assert_eq!((c.gate_rule(), c.tau.0, c.gate_report_sha256.as_str(), c.score_line, c.detector_fingerprint.as_str()), (GATE4, r.tau, r.gate4_sha.as_str(), 0.5, FP));
        let z = parse_cb_calibration(&std::fs::read(cb_calibration_path(d.path())).unwrap()).unwrap();
        let ru = z.ruling.clone().unwrap();
        assert_eq!((z.line, z.median, z.report_sha256.as_str(), ru.rule.as_str(), ru.measured_line, ru.record_sha256.as_str()),
            (0.08, (-0.0457, 0.0048), r.measured_report.as_str(), WHOLE_FILM_3, 0.06, r.centre_sha.as_str()));
        check_gate4(&c, FP, &r).unwrap();
        check_ruled_centre(&z, FP, &r).unwrap();
        let (a, b) = (std::fs::read(calibration_path(d.path())).unwrap(), std::fs::read(cb_calibration_path(d.path())).unwrap());
        for l in setup_with(d.path(), &r, &committed()).unwrap() { eprintln!("  again: {l}"); }
        assert_eq!((std::fs::read(calibration_path(d.path())).unwrap(), std::fs::read(cb_calibration_path(d.path())).unwrap()), (a, b), "a second setup changes nothing");
    }
    /// Refused, with nothing written: the records not committed, or changed, or the tree dirty; a calibration in force
    /// that is not gate /3's (a /2 file), or names another gate /3 report; a measured centre file with another report or
    /// already ruled differently; a kept file that differs from the one it would keep. And the checks used by the
    /// confirmation run refuse a /3 calibration and an unruled centre. Fails if any of these comparisons is dropped.
    #[test] fn the_setup_and_its_checks_refuse_what_is_not_whole_film_3() {
        let (_, r, _, _) = synthetic();
        let refused = |what: &str, prep: &dyn Fn(&Path), git: RecordsGit, says: &str| {
            let (d, _, g3, cb) = synthetic();
            prep(d.path());
            let before = (std::fs::read(calibration_path(d.path())).ok(), std::fs::read(cb_calibration_path(d.path())).ok());
            let e = setup_with(d.path(), &r, &git).map(|_| "accepted".to_string()).unwrap_or_else(|e| format!("{e:#}"));
            eprintln!("{what}: {e}");
            assert!(e.contains(says), "{what}: {e}");
            assert_eq!((std::fs::read(calibration_path(d.path())).ok(), std::fs::read(cb_calibration_path(d.path())).ok()), before, "{what}: nothing written");
            let _ = (g3, cb);
        };
        refused("the gate /4 record not committed", &|_| {}, RecordsGit { gate4_at_head: None, ..committed() }, "not committed");
        refused("the centre record changed at HEAD", &|_| {}, RecordsGit { centre_at_head: Some(b"x".to_vec()), ..committed() }, "differs");
        refused("a dirty tree", &|_| {}, RecordsGit { dirty: true, ..committed() }, "clean tree");
        refused("gate /2's calibration in force", &|p| { std::fs::write(calibration_path(p), calibration_json(&RegionCalibration { version: CALIBRATION_VERSION.into(), detector_fingerprint: FP.into(),
            score_line: 0.5, tau: RegionTau([0.09, 0.02, 0.02, 0.01, 0.10]), gate_report_sha256: "2".repeat(64), rule: Some("sc1-box-gate/2".into()) }).unwrap()).unwrap(); }, committed(), "sc1-box-gate/3");
        refused("gate /3 naming another report", &|p| { let t = std::fs::read_to_string(calibration_path(p)).unwrap().replace(&"3".repeat(64), &"7".repeat(64)); std::fs::write(calibration_path(p), t).unwrap(); }, committed(), "gate /3 report");
        refused("a measured centre with another report", &|p| { let t = std::fs::read_to_string(cb_calibration_path(p)).unwrap().replace(&"6".repeat(64), &"7".repeat(64)); std::fs::write(cb_calibration_path(p), t).unwrap(); }, committed(), "centre");
        refused("a kept tau file that differs", &|p| { std::fs::write(p.join("regions").join(KEPT_TAU), b"other").unwrap(); }, committed(), KEPT_TAU);
        refused("a kept centre file that differs", &|p| { std::fs::write(p.join("regions").join(KEPT_CENTRE), b"other").unwrap(); }, committed(), KEPT_CENTRE);
        let (d, _, _, _) = synthetic();
        let g3 = parse_calibration(&std::fs::read(calibration_path(d.path())).unwrap()).unwrap();
        let e = check_gate4(&g3, FP, &r).unwrap_err().to_string();
        eprintln!("gate /3 in force, checked as /4: {e}");
        assert!(e.contains(GATE4), "{e}");
        let m = parse_cb_calibration(&std::fs::read(cb_calibration_path(d.path())).unwrap()).unwrap();
        let e = check_ruled_centre(&m, FP, &r).unwrap_err().to_string();
        eprintln!("the measured centre, checked as ruled: {e}");
        assert!(e.contains("ruling"), "{e}");
        let mut other = gate4_calibration(&g3, &r).unwrap();
        other.tau.0[2] = 0.10;
        let e = check_gate4(&other, FP, &r).unwrap_err().to_string();
        eprintln!("a /4 calibration with the mandible at 0.10: {e}");
        assert!(e.contains("tau"), "{e}");
        let wrong = CbCalibration { line: 0.09, ..ruled_centre(&m, &r).unwrap() };
        assert!(check_ruled_centre(&wrong, FP, &r).unwrap_err().to_string().contains("0.08"), "a ruled line other than the record's");
    }
}
