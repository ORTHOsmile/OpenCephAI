//! SC-1 Part 1b Task D: the cranial-base centre look's calibration, rule `sc1-cb-centre/1` (spec §17.5 Option 1, owner
//! rulings OQ-1b-D = A and R1b-5), pre-registered in `reference/sc1-cb-centre.json` (committed alone before any run,
//! SHA-256 pinned in a test).
//!
//! **The picture.** On each calibration film, put a pin in the middle of the five traced cranial-base points (S, N, Po,
//! Ar, Or) and another in the middle of the rectangle the region finder drew round the cranial base. The offset is the
//! step from the box pin to the tracing pin, as a fraction of the box's longer side (`ceph_model::wholefilm::cb_offset`).
//! On correct expert tracings the offset sits near a usual value (the median, per axis); the line is how far from it the
//! worst correct tracing lies, rounded up. Move the traced cranial base 20 mm and its pin moves 20 mm while the box's
//! stays: about 0.18 of a 110 mm box.
//!
//! **Compared with what.** Each tracing against the box the finder drew on the same film; nothing in millimetres, except
//! the planted moves of the controls, which need a film's scale to be planted in mm.
//!
//! **The films (520):** as the size look (`sc1_size`, whose loading this uses, M27): the Aariz-train hold-out (70),
//! Ceph-400 Train 001-150, and the development films Ceph-400 Test1 151-300 and Aariz valid (SC1-1a's spent films, tuned
//! on by R1b-5, said so in the report). Every tracing is complete and read as stored, facing right. No shape is scored.
//!
//! **What it can say.** By construction no calibration film is beyond the line, so the moved-film rates here are
//! IN-SAMPLE separation: the line was set on these same films. Only the PKU run (Task F) tests the false alarms on films
//! the line never saw.
//!
//! **Writes.** `<out>/cb-centre-calibration.json` (pass or stop); on a pass only `<models>/regions/cb-centre-calibration.json`,
//! read back by `parse_cb_calibration` before it is written. Prints aggregates only, never a film id.
use crate::sc1_calib::{c7_by_set, control_holds, line_rounded_up, median_nearest_rank, CAL_SETS};
use crate::sc1_data::{self, Split};
use crate::sc1_gate::{self, Git};
use crate::sc1_size::{self, CalFilm, Prereg};
use crate::ft_common;
use anyhow::{ensure, Context};
use ceph_model::pointcheck::ORDER;
use ceph_model::shape::Pt;
use ceph_model::wholefilm::{beyond, cb_calibration_path, cb_distance, cb_offset, parse_cb_calibration, CbCalibration, Region, CB_CALIBRATION_VERSION,
    CB_LINE_FLOOR, CB_LINE_STOP, CB_RULE, REGION_OF};
use serde::Serialize;
use std::path::Path;

pub const PREREG: &str = include_str!("../../../reference/sc1-cb-centre.json");
pub const PREREG_PATH: &str = "reference/sc1-cb-centre.json";
pub const VERSION: &str = "sc1-cb-centre/1";
pub const PASS: &str = "pass";
pub const STOP: &str = "stop";
/// The pre-registration's SHA-256, pinned when it was committed (9613536).
pub const PINNED_SHA256: &str = "e7ae375c6e6d148ba1e0eb1c8ea172c9217a83b5b568040d2dfab575fc2080c3";
/// The positive control: the cranial base moved this far along +x (pre-registered).
pub const CONTROL_MM: f64 = 20.0;
/// The separation: the cranial base moved this far along +x (pre-registered: information, and a stop at half or fewer).
pub const SEPARATION_MM: f64 = 10.0;
/// Aariz valid films with a true scale under aariz-scale/1 (SC1-1a's pinned count).
pub const AARIZ_VALID_SCALED: usize = 98;
const CB_PREREG: Prereg<'static> = Prereg { path: PREREG_PATH, text: PREREG, version: VERSION, what: "the centre calibration" };

/// A planted move: over the films with a scale and a judged offset, how many flag; the smallest and median distance.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Moved { pub mm: f64, pub films: usize, pub flagged: usize, pub distance_min: Option<f64>, pub distance_median: Option<f64> }
/// Information per calibration set: films, judged, median offset, the worst and median distance from the full-set median,
/// and the two planted moves on its films with a scale.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SetCb { pub set: String, pub films: usize, pub judged: usize, pub scaled: usize, pub median: Option<(f64, f64)>, pub worst: Option<f64>,
    pub distance_median: Option<f64>, pub separation: Moved, pub control: Moved }
/// What the calibration found.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbOutcome {
    pub judged: usize, pub not_judged: usize, pub median: (f64, f64), pub worst: f64, pub distance_median: f64, pub line: f64,
    pub normal_flagged: usize, pub control: Moved, pub separation: Moved, pub detector_facing_left: usize, pub c7: String,
    pub per_set: Vec<SetCb>, pub verdict: String, pub exit: i32,
}

/// The verdict: stop (exit 4) when the line is above 0.10, the 20 mm control is under 95%, or the 10 mm move flags on
/// half or fewer of its films (2 × flagged ≤ films); otherwise pass (exit 0). Controls are (flagged, films); a control
/// over no films proves nothing and stops.
pub fn verdict(line: f64, control: (usize, usize), separation: (usize, usize)) -> (&'static str, i32) {
    let control_ok = control_holds(control.0, control.1).unwrap_or(false);
    let separated = separation.1 > 0 && 2 * separation.0 > separation.1;
    if line > CB_LINE_STOP || !control_ok || !separated { (STOP, 4) } else { (PASS, 0) }
}

/// The cranial-base points (S, N, Po, Ar, Or) moved `dx` px along +x, every other point as it was.
fn moved_cb(pts: &[Option<Pt>], dx: f64) -> Vec<Option<Pt>> {
    pts.iter().zip(ORDER).map(|(p, id)| if REGION_OF.iter().any(|(n, g)| *n == id && *g == Region::CranialBase) { p.map(|q| (q.0 + dx, q.1)) } else { *p }).collect()
}
/// The offset of a calibration film as stored, facing right (every calibration film is).
fn offset(f: &CalFilm) -> Option<(f64, f64)> { cb_offset(&f.pts, &f.regs, false) }
fn median_opt(v: &[f64]) -> anyhow::Result<Option<f64>> { if v.is_empty() { Ok(None) } else { Ok(Some(median_nearest_rank(v)?)) } }
/// The cranial base moved `mm` along +x on each of `films` with a scale and a judged offset: how many flag under `cal`.
fn moved(films: &[&CalFilm], cal: &CbCalibration, mm: f64) -> anyhow::Result<Moved> {
    let d: Vec<f64> = films.iter().filter_map(|f| { let s = f.mm_per_px?; offset(f)?; cb_offset(&moved_cb(&f.pts, mm / s), &f.regs, false) })
        .map(|o| cb_distance(o, cal)).collect();
    Ok(Moved { mm, films: d.len(), flagged: d.iter().filter(|x| beyond(**x, cal.line)).count(), distance_min: d.iter().copied().reduce(f64::min), distance_median: median_opt(&d)? })
}

/// The calibration on these films (no file read, nothing written): C7 by set; the per-axis nearest-rank median of the
/// offsets of the films with a cranial-base box (a film without one is counted, not judged); the line; the 20 mm control
/// and the 10 mm separation on the films with a scale; per-set information. An error is broken.
pub fn calibrate(films: &[CalFilm]) -> anyhow::Result<CbOutcome> {
    let got: Vec<(&str, usize)> = {
        let mut names: Vec<&str> = films.iter().map(|f| f.set).collect();
        names.sort(); names.dedup();
        names.iter().map(|n| (*n, films.iter().filter(|f| f.set == *n).count())).collect()
    };
    let c7 = c7_by_set(&got, &CAL_SETS)?;
    let o: Vec<(f64, f64)> = films.iter().filter_map(offset).collect();
    ensure!(!o.is_empty(), "no calibration film has a cranial-base box: nothing to calibrate");
    let median = (median_nearest_rank(&o.iter().map(|p| p.0).collect::<Vec<_>>())?, median_nearest_rank(&o.iter().map(|p| p.1).collect::<Vec<_>>())?);
    let mut cal = CbCalibration { version: CB_CALIBRATION_VERSION.into(), rule: CB_RULE.into(), detector_fingerprint: "0".repeat(64), median, line: f64::NAN, report_sha256: "0".repeat(64), ruling: None };
    let d: Vec<f64> = o.iter().map(|x| cb_distance(*x, &cal)).collect();
    let worst = d.iter().copied().fold(0.0, f64::max);
    cal.line = line_rounded_up(worst, CB_LINE_FLOOR)?;
    let normal_flagged = d.iter().filter(|x| beyond(**x, cal.line)).count();
    ensure!(normal_flagged == 0, "{normal_flagged} calibration film(s) beyond the line they set: the rule is broken");
    let all: Vec<&CalFilm> = films.iter().collect();
    let (control, separation) = (moved(&all, &cal, CONTROL_MM)?, moved(&all, &cal, SEPARATION_MM)?);
    let per_set = CAL_SETS.iter().map(|(set, _)| {
        let fs: Vec<&CalFilm> = films.iter().filter(|f| f.set == *set).collect();
        let os: Vec<(f64, f64)> = fs.iter().filter_map(|f| offset(f)).collect();
        let ds: Vec<f64> = os.iter().map(|x| cb_distance(*x, &cal)).collect();
        let m = match (median_opt(&os.iter().map(|p| p.0).collect::<Vec<_>>())?, median_opt(&os.iter().map(|p| p.1).collect::<Vec<_>>())?) { (Some(x), Some(y)) => Some((x, y)), _ => None };
        Ok(SetCb { set: set.to_string(), films: fs.len(), judged: os.len(), scaled: fs.iter().filter(|f| f.mm_per_px.is_some()).count(), median: m,
            worst: ds.iter().copied().reduce(f64::max), distance_median: median_opt(&ds)?, separation: moved(&fs, &cal, SEPARATION_MM)?, control: moved(&fs, &cal, CONTROL_MM)? })
    }).collect::<anyhow::Result<Vec<_>>>()?;
    let (verdict, exit) = verdict(cal.line, (control.flagged, control.films), (separation.flagged, separation.films));
    Ok(CbOutcome { judged: o.len(), not_judged: films.len() - o.len(), median, worst, distance_median: median_nearest_rank(&d)?, line: cal.line, normal_flagged,
        control, separation, detector_facing_left: films.iter().filter(|f| f.regs.facing_left == Some(true)).count(), c7, per_set, verdict: verdict.into(), exit })
}

/// `cb-centre-calibration.json` (the report).
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CbReport {
    pub version: String, pub prereg_sha256: String, pub git_sha: String, pub detector_fingerprint: String, pub score_line: f32,
    pub tau_rule: String, pub gate_report_sha256: String, pub disclosure: String, pub in_sample: String, pub films: usize, pub scales: String,
    #[serde(flatten)] pub outcome: CbOutcome,
}
fn moved_line(m: &Moved) -> String {
    let pct = if m.films == 0 { 0.0 } else { 100.0 * m.flagged as f64 / m.films as f64 };
    format!("{} mm: flagged {} of {} ({pct:.1}%); distance smallest {}, median {}", m.mm, m.flagged, m.films,
        m.distance_min.map(|x| format!("{x:.4}")).unwrap_or("none".into()), m.distance_median.map(|x| format!("{x:.4}")).unwrap_or("none".into()))
}
impl CbReport {
    pub fn summary(&self) -> Vec<String> {
        let o = &self.outcome;
        let mut v = vec![format!("centre calibration {} ({PREREG_PATH} sha256 {}); git HEAD {}; detector {}; score line {:.2}", self.version, self.prereg_sha256, self.git_sha, self.detector_fingerprint, self.score_line),
            format!("tau in force: {} (gate report sha256 {})", self.tau_rule, self.gate_report_sha256),
            format!("{}: Ceph-400 test1 151-300 and Aariz valid", self.disclosure),
            format!("C7 {}", o.c7),
            format!("scales: {}", self.scales),
            format!("judged {} (films without a cranial-base box: {}); detector facing left on {} (information; every film is read as stored, facing right)", o.judged, o.not_judged, o.detector_facing_left),
            format!("median offset ({:+.4}, {:+.4}) (nearest rank per axis); distance median {:.4}, worst {:.4}; line {:.2} (worst rounded up, floor {CB_LINE_FLOOR}, stop above {CB_LINE_STOP})", o.median.0, o.median.1, o.distance_median, o.worst, o.line),
            format!("normal: flagged {} of {}", o.normal_flagged, o.judged),
            format!("control, cranial base moved {}", moved_line(&o.control)),
            format!("separation ({}), cranial base moved {}", self.in_sample, moved_line(&o.separation))];
        for s in &o.per_set {
            v.push(format!("  {}: films {}, judged {}, scaled {}; median offset {}; distance median {}, worst {}", s.set, s.films, s.judged, s.scaled,
                s.median.map(|m| format!("({:+.4}, {:+.4})", m.0, m.1)).unwrap_or("none".into()),
                s.distance_median.map(|x| format!("{x:.4}")).unwrap_or("none".into()), s.worst.map(|x| format!("{x:.4}")).unwrap_or("none".into())));
            v.push(format!("    {}", moved_line(&s.separation)));
            v.push(format!("    {}", moved_line(&s.control)));
        }
        v.push(format!("verdict {} (exit {}: 0 pass, 4 stop, 1 broken)", o.verdict, o.exit));
        v
    }
}

/// The run on given folders, split, git state and pins: prints the summary; writes the report on a pass or a stop and,
/// on a pass only, the centre calibration (read back first). Exit 0 pass, 4 stop, 1 broken (nothing written).
pub fn run_with(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git) -> anyhow::Result<i32> {
    let broken = |e: anyhow::Error| { eprintln!("centre calibration {VERSION} broken (nothing written): {e:#}"); Ok(1) };
    let rep = match cb_run(aariz, ceph400, models, out, split, git) { Ok(r) => r, Err(e) => return broken(e) };
    for l in rep.summary() { println!("{l}"); }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let sha = ft_common::sha256_hex(text.as_bytes());
    let cal = if rep.outcome.exit == 0 {
        let c = CbCalibration { version: CB_CALIBRATION_VERSION.into(), rule: CB_RULE.into(), detector_fingerprint: rep.detector_fingerprint.clone(),
            median: rep.outcome.median, line: rep.outcome.line, report_sha256: sha.clone(), ruling: None };
        let t = serde_json::to_string_pretty(&c)? + "\n";
        match parse_cb_calibration(t.as_bytes()) { Ok(back) if back == c => Some(t), Ok(_) => return broken(anyhow::anyhow!("the centre calibration does not read back as written")), Err(e) => return broken(e) }
    } else { None };
    std::fs::create_dir_all(out)?;
    let path = out.join("cb-centre-calibration.json");
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {sha})", path.display());
    match cal {
        Some(t) => { std::fs::write(cb_calibration_path(models), t)?; println!("centre calibration (rule {CB_RULE}) written to {}", cb_calibration_path(models).display()); }
        None => println!("no centre calibration written (the run stopped: to the owner)"),
    }
    Ok(rep.outcome.exit)
}

/// Task E3 review M1: never write over a centre calibration that carries the owner's ruling (whole-film/3's line 0.08,
/// spec §17.15, `reference/sc1-cb-centre-ruling.json`); checked before any film is read. A file in place that is not
/// JSON is refused too (it is never replaced unread).
pub fn refuse_to_replace_a_ruling(models: &Path) -> anyhow::Result<()> {
    let p = cb_calibration_path(models);
    let Ok(bytes) = std::fs::read(&p) else { return Ok(()) };
    let v: serde_json::Value = serde_json::from_slice(&bytes).with_context(|| format!("{}: the centre calibration in place does not load; refusing to replace it", p.display()))?;
    ensure!(v.get("ruling").is_none_or(|r| r.is_null()), "{}: the centre calibration in place carries the owner's ruling ({}): this run would overwrite it; refused",
        p.display(), v["ruling"]["rule"].as_str().unwrap_or("a ruling"));
    Ok(())
}

fn cb_run(aariz: &Path, ceph400: &Path, models: &Path, out: &Path, split: &Split, git: &Git) -> anyhow::Result<CbReport> {
    refuse_to_replace_a_ruling(models)?;
    let l = sc1_size::load_cal_films(aariz, ceph400, models, out, split, git, &CB_PREREG)?;
    // The scales (C7 on the films the controls move): every Ceph-400 film; Aariz valid as SC1-1a pinned; the hold-out printed.
    let scaled = |set: &str| (l.films.iter().filter(|f| f.set == set && f.mm_per_px.is_some()).count(), l.films.iter().filter(|f| f.set == set).count());
    let (h, t, t1, v) = (scaled(CAL_SETS[0].0), scaled(CAL_SETS[1].0), scaled(CAL_SETS[2].0), scaled(CAL_SETS[3].0));
    let scales = [ft_common::counted("Ceph-400 train films with a scale (0.1 mm/px)", t.0, t.1)?, ft_common::counted("Ceph-400 test1 films with a scale (0.1 mm/px)", t1.0, t1.1)?,
        ft_common::counted(&format!("Aariz valid films with a scale ({})", crate::scale::AARIZ_SCALE_RULE), v.0, AARIZ_VALID_SCALED)?,
        format!("hold-out films with a scale ({}): {} of {}", crate::scale::AARIZ_SCALE_RULE, h.0, h.1)].join("; ");
    let outcome = calibrate(&l.films)?;
    Ok(CbReport { version: VERSION.into(), prereg_sha256: ft_common::sha256_hex(PREREG.as_bytes()), git_sha: git.sha.clone(), detector_fingerprint: l.fp,
        score_line: sc1_size::SCORE_LINE, tau_rule: l.tau_rule, gate_report_sha256: l.gate_sha256, disclosure: sc1_size::DISCLOSURE.into(),
        in_sample: "in-sample: the line is set on these same films, the development films among them".into(), films: l.films.len(), scales, outcome })
}
/// `--sc1-cb-calibrate`: the refusals, the pinned split, the git state, then `run_with`. Exit 0 pass, 4 stop, 1 broken.
pub fn run_cli(aariz: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Split, Git)> {
        sc1_size::refuse_reads(aariz, ceph400)?;
        let p = sc1_data::split_path()?;
        let text = std::fs::read_to_string(&p).with_context(|| p.display().to_string())?;
        ensure!(ft_common::sha256_hex(text.as_bytes()) == sc1_data::PINNED_SPLIT_SHA256, "{} is not the pinned split (SHA-256 differs)", p.display());
        Ok((sc1_data::load_split(&text)?, sc1_gate::git_state(PREREG_PATH)?))
    };
    match pre() {
        Ok((split, git)) => run_with(aariz, ceph400, models, out, &split, &git),
        Err(e) => { eprintln!("centre calibration {VERSION} broken (nothing written): {e:#}"); Ok(1) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ft_common::{case_rng, normal, sha256_hex};
    use ceph_model::wholefilm::{teaching_boxes, RegionBox, Regions};

    const FP: &str = "17171e68f9f7072062e2a3a2cbd4851618056f5136bed998f1782c49d4897b80";

    /// A SYNTHETIC 520-film stand-in (70 + 150 + 150 + 150): faces from the shared generator (film px on a 2400 px film),
    /// boxes drawn round each face by the teaching rule, the cranial-base box's centre moved by `jitter` × its longer side
    /// (a normal draw per axis, seeded); each film's scale `mm(k)`.
    fn stand_in(jitter: f64, seed: u64, mm: impl Fn(usize) -> Option<f64>) -> Vec<CalFilm> {
        let faces = ceph_model::shape::synthetic_faces(520, seed);
        let mut k = 0usize;
        let mut out = Vec::new();
        for (set, n) in CAL_SETS {
            for _ in 0..n {
                let f = &faces[k];
                let named: Vec<(String, f64, f64)> = ORDER.iter().zip(f).map(|(id, p)| (id.to_string(), p.0, p.1)).collect();
                let mut r = case_rng(seed, &[k as u64]);
                let boxes: Vec<RegionBox> = teaching_boxes(&named, 2400, 2400).into_iter().map(|b| {
                    let j = if b.region == Region::CranialBase { jitter * b.longer_side() } else { 0.0 };
                    let (dx, dy) = (normal(&mut r) * j, normal(&mut r) * j);
                    RegionBox { x0: b.x0 + dx, x1: b.x1 + dx, y0: b.y0 + dy, y1: b.y1 + dy, score: 0.9, ..b }
                }).collect();
                out.push(CalFilm { set, pts: f.iter().map(|p| Some(*p)).collect(), regs: Regions::from_scored(&boxes, 0.5, FP).unwrap(), mm_per_px: mm(k) });
                k += 1;
            }
        }
        out
    }
    fn all_scaled(_: usize) -> Option<f64> { Some(0.1) }
    fn offsets(films: &[CalFilm]) -> Vec<(f64, f64)> { films.iter().filter_map(|f| cb_offset(&f.pts, &f.regs, false)).collect() }
    fn moved_cb(pts: &[Option<Pt>], dx: f64) -> Vec<Option<Pt>> {
        pts.iter().zip(ORDER).map(|(p, id)| if REGION_OF.iter().any(|(n, g)| *n == id && *g == Region::CranialBase) { p.map(|q| (q.0 + dx, q.1)) } else { *p }).collect()
    }

    /// The rule recomputed here independently: the median per axis is the ⌈n/2⌉-th smallest x and, separately, y; the
    /// line the largest |o − m| rounded up to the next 0.01, never below 0.02. Fails if: the median is a mean, taken
    /// jointly, or the line not rounded up.
    #[test] fn the_median_is_nearest_rank_per_axis_and_the_line_the_worst_rounded_up() {
        let films = stand_in(0.01, 21, all_scaled);
        let o = calibrate(&films).unwrap();
        let v = offsets(&films);
        let rank = |mut a: Vec<f64>| { a.sort_by(f64::total_cmp); a[(a.len() + 1) / 2 - 1] };
        let m = (rank(v.iter().map(|p| p.0).collect()), rank(v.iter().map(|p| p.1).collect()));
        let worst = v.iter().map(|p| (p.0 - m.0).hypot(p.1 - m.1)).fold(0.0, f64::max);
        let line = crate::sc1_gate::ceil_hundredth(worst).max(0.02);
        eprintln!("median {m:?}, worst {worst:.4}, line {line}; outcome median {:?} line {} control {:?} separation {:?} exit {}", o.median, o.line, o.control, o.separation, o.exit);
        assert_eq!((o.median, o.worst, o.line, o.judged, o.normal_flagged), (m, worst, line, 520, 0));
        let mean = v.iter().map(|p| p.0).sum::<f64>() / v.len() as f64;
        assert!(mean != m.0, "the fixture: a mean would differ from the nearest-rank median");
    }
    /// The floor: 520 copies of one film give a worst of 0, so the line is the floor 0.02. Fails if: the floor is dropped
    /// or is 0.05 (the size look's).
    #[test] fn the_line_is_never_below_0_02() {
        let base = stand_in(0.0, 22, all_scaled).remove(0);
        let films: Vec<CalFilm> = CAL_SETS.iter().flat_map(|(set, n)| std::iter::repeat_n(CalFilm { set, ..base.clone() }, *n)).collect();
        let o = calibrate(&films).unwrap();
        eprintln!("one film 520 times: worst {}, line {}", o.worst, o.line);
        assert_eq!((o.worst, o.line), (0.0, 0.02));
        assert_eq!(CB_LINE_FLOOR, 0.02);
    }
    /// The stop above 0.10: 0.11 stops (exit 4); 0.10 itself passes. Through calibrate: cranial-base boxes thrown about
    /// widely give a line above 0.10, exit 4. Fails if: `>=` is used, or the stop is dropped.
    #[test] fn a_line_above_0_10_stops_with_exit_4() {
        assert_eq!(CB_LINE_STOP, 0.10);
        assert_eq!(verdict(0.11, (100, 100), (100, 100)), (STOP, 4));
        assert_eq!(verdict(0.10, (100, 100), (100, 100)), (PASS, 0));
        let o = calibrate(&stand_in(0.08, 23, all_scaled)).unwrap();
        eprintln!("wide boxes: line {}, exit {}", o.line, o.exit);
        assert!(o.line > CB_LINE_STOP && o.exit == 4);
    }
    /// The 20 mm control under 95% stops: in integers (94 of 100 stop, 95 pass). Through calibrate: a scale of 10 mm/px
    /// makes 20 mm a 2 px move, which no film flags: exit 4 by the control alone (the line is the floor). Fails if: the
    /// control is skipped or read as a float rate.
    #[test] fn the_20mm_control_under_95_percent_stops() {
        assert_eq!(verdict(0.05, (94, 100), (100, 100)), (STOP, 4));
        assert_eq!(verdict(0.05, (95, 100), (100, 100)), (PASS, 0));
        assert_eq!(verdict(0.05, (494, 520), (520, 520)), (PASS, 0));
        assert_eq!(verdict(0.05, (493, 520), (520, 520)), (STOP, 4));
        let o = calibrate(&stand_in(0.01, 24, |_| Some(10.0))).unwrap();
        eprintln!("20 mm = 2 px: line {}, control {:?}, exit {}", o.line, o.control, o.exit);
        assert!(o.line <= CB_LINE_STOP && o.control.flagged * 20 < o.control.films * 19 && o.exit == 4);
    }
    /// The separation stop: the 10 mm move flagged on half or fewer stops (50 of 100 stops, 51 passes). Fails if: the
    /// separation is not a stop, or `<` is used for `≤`.
    #[test] fn the_10mm_separation_at_half_or_fewer_stops() {
        assert_eq!(verdict(0.05, (100, 100), (50, 100)), (STOP, 4));
        assert_eq!(verdict(0.05, (100, 100), (51, 100)), (PASS, 0));
        assert_eq!(verdict(0.05, (100, 100), (0, 0)), (STOP, 4), "a separation over no films proves nothing");
    }
    /// Positive control, before any real run: on the SYNTHETIC stand-in (0.1 mm/px, the cranial-base box's centre off by
    /// 1% of its side), the 20 mm control flags every film, and one film's cranial base moved 15 mm (150 px) scores far
    /// outside the line. Fails if: the move is not seen (e.g. the box moved with the tracing, or the offset not divided).
    #[test] fn a_cranial_base_moved_15mm_scores_far_outside_the_line() {
        let films = stand_in(0.01, 25, all_scaled);
        let o = calibrate(&films).unwrap();
        let cal = CbCalibration { version: CB_CALIBRATION_VERSION.into(), rule: CB_RULE.into(), detector_fingerprint: FP.into(), median: o.median, line: o.line, report_sha256: "0".repeat(64), ruling: None };
        let f = &films[200];
        let d0 = cb_distance(cb_offset(&f.pts, &f.regs, false).unwrap(), &cal);
        let d15 = cb_distance(cb_offset(&moved_cb(&f.pts, 150.0), &f.regs, false).unwrap(), &cal);
        eprintln!("line {}; the film {d0:.4}; moved 15 mm {d15:.4}; control {:?}; separation {:?}", o.line, o.control, o.separation);
        assert!(!beyond(d0, o.line) && d15 > 3.0 * o.line, "15 mm must sit far outside the line");
        assert_eq!((o.control.flagged, o.control.films, o.separation.films), (520, 520, 520));
        assert_eq!(o.exit, 0);
    }
    /// Films without a scale are not moved and not counted in the controls; the per-set rows say how many were. Fails if:
    /// an unscaled film is moved (with what scale?) or counted.
    #[test] fn only_films_with_a_scale_are_moved() {
        let films = stand_in(0.01, 26, |k| if (70..370).contains(&k) || k % 3 == 0 { Some(0.1) } else { None });
        let scaled = films.iter().filter(|f| f.mm_per_px.is_some()).count();
        let o = calibrate(&films).unwrap();
        eprintln!("{scaled} scaled: control {:?}; per set {:?}", o.control, o.per_set.iter().map(|s| (&s.set, s.scaled, s.control.films)).collect::<Vec<_>>());
        assert_eq!((o.control.films, o.separation.films), (scaled, scaled));
        assert_eq!(o.per_set.iter().map(|s| s.scaled).sum::<usize>(), scaled);
        assert_eq!(o.per_set.iter().find(|s| s.set == "ceph400Train").unwrap().scaled, 150);
    }
    /// C7: 70 + 150 + 150 + 150 = 520 films; a set short is broken, naming it.
    #[test] fn c7_counts_520_films_by_set() {
        let films = stand_in(0.01, 27, all_scaled);
        let o = calibrate(&films).unwrap();
        assert!(o.c7.ends_with("calibration films in all: compared 520 (expected 520)"), "{}", o.c7);
        let short: Vec<CalFilm> = films.iter().enumerate().filter(|(i, _)| *i != 400).map(|(_, f)| f.clone()).collect();
        let e = calibrate(&short).unwrap_err().to_string();
        eprintln!("519 films: {e}");
        assert!(e.contains("aarizValid"), "{e}");
    }
    /// A film whose cranial-base box was not found is not judged: counted and printed, never in the median. Fails if: it
    /// is counted as judged.
    #[test] fn a_film_without_a_cranial_base_box_is_counted_not_judged() {
        let mut films = stand_in(0.01, 28, all_scaled);
        films[5].regs.boxes.retain(|b| b.region != Region::CranialBase);
        let o = calibrate(&films).unwrap();
        eprintln!("judged {}, not judged {}", o.judged, o.not_judged);
        assert_eq!((o.judged, o.not_judged), (519, 1));
    }
    /// The refusals before any read: Ceph-400 Test2, Aariz test, PKU (sealed) and "all" (through the shared refusals); a
    /// teaching or tuning-slice film is refused. Fails if: a refusal is dropped.
    #[test] fn refuses_test2_aariz_test_pku_and_teaching_films() {
        let d = tempfile::tempdir().unwrap();
        let (az, c4, pku) = (d.path().join("aariz"), d.path().join("ceph400"), d.path().join("pku"));
        for p in [&az, &c4, &pku] { std::fs::create_dir_all(p).unwrap(); }
        assert!(sc1_size::refuse_reads(&az, &c4).is_ok());
        for (a, c) in [(&az, &pku), (&pku, &c4)] {
            for s in ["test", "test2", "all"] {
                let e = crate::sc1_gate2::refuse_reads_for(&crate::sc1_gate2::GATE3, &[(a.as_path(), s), (c.as_path(), s)]);
                assert!(e.is_err(), "{s}");
            }
        }
        let ids: Vec<String> = (0..100).map(|i| format!("tr-{i:04}")).collect();
        let split = crate::sc1_data::split(&ids).unwrap();
        let mut v = split.holdout.clone();
        v.push(split.teach[0].clone());
        assert!(sc1_size::refuse_films(&split, &v).is_err());
    }
    /// The run scores no shape (no film judged against its own tracing in the reference) and copies none of the shared
    /// rule arithmetic (M27). Fails if: a shape scorer, or a private median, rounding or 95% rule, appears here.
    #[test] fn the_centre_calibration_scores_no_shape_and_copies_no_rule() {
        let code = include_str!("sc1_cb.rs");
        let body = &code[..code.find("#[cfg(test)]").unwrap()];
        for word in [concat!("Whole", "Scorer"), concat!("check", "_film"), concat!("shape", "("), concat!("from", "_reference"),
                     concat!("ceil_", "hundredth"), concat!("total", "_cmp"), concat!("19 ", "*")] {
            assert!(!body.contains(word), "{word} in sc1_cb.rs");
        }
    }
    /// Task E3 review M1: the centre calibration never writes over a file that carries the owner's ruling (whole-film/3's
    /// line 0.08, spec §17.15), before any film is read. Fails if: `cb_run` does not refuse first (it then fails later on
    /// the folders, with another message), or refuses a measured file with no ruling.
    #[test] fn the_centre_calibration_never_replaces_a_ruled_file() {
        let d = tempfile::tempdir().unwrap();
        let models = d.path().join("models");
        std::fs::create_dir_all(models.join("regions")).unwrap();
        let ruled = CbCalibration { version: CB_CALIBRATION_VERSION.into(), rule: CB_RULE.into(), detector_fingerprint: FP.into(),
            median: (-0.0457, 0.0048), line: 0.08, report_sha256: "1".repeat(64),
            ruling: Some(ceph_model::wholefilm::CbRuling { rule: "whole-film/3".into(), measured_line: 0.06, record_sha256: "2".repeat(64) }) };
        let text = serde_json::to_string_pretty(&ruled).unwrap() + "\n";
        std::fs::write(cb_calibration_path(&models), &text).unwrap();
        let (aariz, ceph400, out) = (d.path().join("nowhere-aariz"), d.path().join("nowhere-ceph400"), d.path().join("out"));
        let split = Split { version: "SYNTHETIC".into(), seed: 0, rule: "SYNTHETIC".into(), dataset: "SYNTHETIC".into(), teach: vec![], holdout: vec![], tuning: vec![] };
        let git = Git { prereg_at_head: None, dirty: true, sha: "SYNTHETIC".into() };
        let e = format!("{:#}", cb_run(&aariz, &ceph400, &models, &out, &split, &git).unwrap_err());
        eprintln!("a ruled centre file in place: {e}");
        assert!(e.contains("ruling") && e.contains("refused"), "{e}");
        assert_eq!(std::fs::read_to_string(cb_calibration_path(&models)).unwrap(), text, "untouched");
        // control: a measured file (no ruling) is not refused by this guard; the run fails later, on the folders
        let measured = CbCalibration { ruling: None, line: 0.06, ..ruled };
        std::fs::write(cb_calibration_path(&models), serde_json::to_string_pretty(&measured).unwrap()).unwrap();
        let e = format!("{:#}", cb_run(&aariz, &ceph400, &models, &out, &split, &git).unwrap_err());
        eprintln!("a measured centre file in place: {e}");
        assert!(!e.contains("ruling"), "{e}");
    }
    /// The pre-registration is the committed one, and its numbers are the program's.
    #[test] fn the_preregistration_is_pinned() {
        assert_eq!(sha256_hex(PREREG.as_bytes()), PINNED_SHA256, "{PREREG_PATH} changed: the owner's OK, then a new version");
        let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
        assert_eq!(v["version"], VERSION);
        assert_eq!(VERSION, CB_RULE);
        assert_eq!(sc1_size::hex64_after(v["boxes"].as_str().unwrap(), "region finder"), FP);
        let size: serde_json::Value = serde_json::from_str(sc1_size::PREREG).unwrap();
        assert_eq!(v["tau"], size["tau"], "the same gate /3 report as the size look");
        assert!(v["line"].as_str().unwrap().contains("never below 0.02"));
        assert!(v["stop"].as_str().unwrap().contains("above 0.10"));
        assert!(v["control"].as_str().unwrap().contains("20 mm") && v["control"].as_str().unwrap().contains("20 × flagged ≥ 19 × films"));
        assert!(v["separation"].as_str().unwrap().contains("10 mm") && v["separation"].as_str().unwrap().contains("2 × flagged ≤ films"));
        assert!(v["scales"].as_str().unwrap().contains("Aariz valid: 98"));
        assert!(v["judged"].as_str().unwrap().contains("all five"));
        assert!(v["counts"].as_str().unwrap().contains("70 + 150 + 150 + 150 = 520"));
        assert!(v["films"]["development"].as_str().unwrap().contains("tuned on"));
        assert_eq!((CONTROL_MM, SEPARATION_MM, AARIZ_VALID_SCALED), (20.0, 10.0, 98));
    }
}
