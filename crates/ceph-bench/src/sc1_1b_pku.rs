//! SC-1 Part 1b Task F: SC1-1b-PKU, the one test of whole-film/3 on films it has never seen (spec 2026-11-03 §17.9,
//! §17.10, §17.15; owner rulings R1b-1 to R1b-6), pre-registered in `reference/sc1-1b-pku.json` (committed alone before
//! any of this code; its SHA-256 pinned in a test).
//!
//! **The picture.** Lay the region finder's five boxes on each of the 102 PKU films (a third hospital's machine, never
//! taught or tuned on), put a tracing on it, and ask the app's own check whether it sits on this film's anatomy, is the
//! right size for it, and looks like a human face the right way round. Spoil the tracing on purpose (mirrored, another
//! patient's, half or double size, one region moved 10-20 mm): each one flagged is a catch. Leave the doctors' tracing
//! untouched: each one flagged is a false alarm.
//!
//! **Compared with.** PKU's truth (the mean of its two doctors, `pku-truth/1`), judged by whole-film/3: the 1,000-tracing
//! reference (no PKU film in it), gate /4's tolerances, the size look and the cranial-base centre with the ruled line 0.08.
//!
//! **Marks.** At least 969 of 1,020 planted flagged and at most 2 of 102 untouched, every control holding: exit 0. Controls
//! hold, a mark missed: exit 3, the report naming which, to the owner, no re-run with new marks. A control fails or a
//! count or pin is off: exit 1, nothing concluded. The gate report in force says stop: exit 4.
//!
//! **What it cannot see.** One run of 102 films is a coarse instrument (spec §17.9). The scale (0.125 mm/px, a secondary
//! source) only sets the size of the planted moves; the check never reads it.
//!
//! **The seal.** Nothing reads `data/pku` before `ledger::open_seal` has returned the key: the pre-registration committed
//! as built, a clean tree, and no report yet. The report is written last, so a run that printed a verdict line shuts the
//! seal for good. Prints aggregates only, never a film id.
use crate::chainproof::shuffle;
use crate::ft_common::{self, case_rng, counted, no_homework, par_map, Pt};
use crate::sc1_1a::{self, Control, Kind, Plant};
use crate::sc1_dev::{CentreMedian, Looks};
use crate::sc1_gate::{self, Git};
use crate::{dataset, ledger, sc1_boxes, sc1_data, sc1_wf3};
use anyhow::{ensure, Context};
use ceph_infer::regions::{regions_manifest_path, Found, RegionEngine};
use ceph_model::pointcheck::{self as pc, Prior, RunCheck, ShapeScorer, ORDER};
use ceph_model::wholefilm::{box_quality, check_film, off_film, parse_calibration, parse_cb_calibration, parse_reference, parse_size_calibration, reference_name,
    teaching_boxes, BoxQuality, FilmBoxes, FilmCal, FilmCheck, FilmResult, Reason, Reference, Region, RegionLook, RegionTau, Regions, SizeRef,
    WholeScorer, REGIONS, RULE_VERSION};
use serde::Serialize;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub const PREREG: &str = include_str!("../../../reference/sc1-1b-pku.json");
pub const PREREG_PATH: &str = "reference/sc1-1b-pku.json";
pub const VERSION: &str = "sc1-1b-pku/1";
pub const REPORT: &str = "sc1-1b-pku.json";
/// The marks' sizes (spec §17.9, R1b-6): 10 kinds x 102 films planted; 102 untouched.
pub const PLANTED: usize = 1020;
pub const NORMAL: usize = 102;
/// The plants' seed, and P2's derangement salt (chainproof::Rng(SEED ^ 102)).
pub const SEED: u64 = 20261108;
pub const P2_SALT: u64 = 102;
pub const CONTROL_FILMS: usize = sc1_1a::CONTROL_FILMS;
pub const C2_FACTOR: f64 = 2.0;
pub const C3_SHIFT_MM: f64 = 40.0;
pub const C8_FACTOR: f64 = 1000.0;
pub const C10_FACTOR: f64 = 0.5;
pub const C11_SHIFT_MM: f64 = 20.0;
/// The reports this run reads in `--out` (reports/sc1): the gate report in force (gate /4 has none of its own; its tau
/// are gate /2's), and the size and centre calibration reports.
pub const GATE2_REPORT: &str = sc1_1a::GATE_REPORT;
pub const SIZE_REPORT: &str = "size-calibration.json";
pub const CB_REPORT: &str = "cb-centre-calibration.json";
pub const PASS: &str = sc1_1a::PASS;
pub const FAIL: &str = sc1_1a::FAIL;
pub const BROKEN: &str = sc1_1a::BROKEN;
pub const GATE_STOP: &str = sc1_1a::GATE_STOP;

/// ceil(19 x 1020 / 20) = 969, by SC1-1a's rule (M21: no second copy of the arithmetic).
pub fn needed() -> usize { sc1_1a::needed_of(PLANTED) }
/// floor(2 x 102 / 100) = 2, by SC1-1a's rule.
pub fn false_max() -> usize { sc1_1a::false_max_of(NORMAL) }
/// pass 0, fail 3, gate stop 4, broken 1 (SC1-1a's).
pub fn exit_code(v: &str) -> i32 { sc1_1a::exit_code(v) }

/// The counts a run is judged by; `real()` is the pre-registration's, the SYNTHETIC tests use fewer films by the same rule.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Marks {
    pub films: usize, pub planted: usize, pub needed: usize, pub normal: usize, pub false_max: usize,
    /// The switch's middle band (owner ruling, 6 Nov 2026): on below the marks when at least `ship_needed` are caught and
    /// at most `ship_false_max` untouched flagged. Real: 918 = ceil(9 x 1020 / 10) and 5 (the owner's number).
    pub ship_needed: usize, pub ship_false_max: usize,
}
impl Marks {
    /// Ten kinds on every film (P1a, P1b, P2, P3 x0.5, P3 x2, P4 x5 regions: every PKU film has a scale); one N per film.
    /// The band: ceil(9 x planted / 10) caught and floor(5 x n / 102) flagged (5 at 102; the SYNTHETIC tests' sizes only).
    pub fn for_films(n: usize) -> Marks {
        let planted = KINDS.len() * n;
        Marks { films: n, planted, needed: sc1_1a::needed_of(planted), normal: n, false_max: sc1_1a::false_max_of(n),
            ship_needed: (9 * planted + 9) / 10, ship_false_max: 5 * n / NORMAL }
    }
    pub fn real() -> Marks { Marks::for_films(NORMAL) }
}
/// The switch's default (owner ruling, 6 Nov 2026; the pre-registration's `verdicts.ships`): on and a pass; on below the
/// marks (at least 90% caught and at most 5 of 102 flagged), stated with the shortfall; off. Task H reads it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum Ships { OnPass, OnBelowMarks, Off }
/// The verdict, naming each mark (M29): Task H reads `marks_line` to fill the switch's line.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PkuVerdict { pub caught: usize, pub flagged: usize, pub catch_met: bool, pub false_alarm_met: bool }
impl PkuVerdict {
    pub fn of(caught: usize, flagged: usize, m: &Marks) -> PkuVerdict { PkuVerdict { caught, flagged, catch_met: caught >= m.needed, false_alarm_met: flagged <= m.false_max } }
    /// Broken when a control fails; pass when both marks are met; else fail.
    pub fn verdict(&self, controls_hold: bool) -> &'static str { if !controls_hold { BROKEN } else if self.catch_met && self.false_alarm_met { PASS } else { FAIL } }
    /// The switch's band; None when there is no verdict (a control failed: the switch stays off, "Not yet tested").
    pub fn ships(&self, m: &Marks, controls_hold: bool) -> Option<Ships> {
        if !controls_hold { None } else if self.catch_met && self.false_alarm_met { Some(Ships::OnPass) }
        else if self.caught >= m.ship_needed && self.flagged <= m.ship_false_max { Some(Ships::OnBelowMarks) } else { Some(Ships::Off) }
    }
    pub fn ships_line(&self, m: &Marks, controls_hold: bool) -> String {
        let bands = format!("(bands: pass; >= {} caught and <= {} flagged; else)", m.ship_needed, m.ship_false_max);
        match self.ships(m, controls_hold) {
            Some(Ships::OnPass) => format!("ships: on, a pass {bands}"),
            Some(Ships::OnBelowMarks) => format!("ships: on, below the pre-registered marks ({} catches short of {}; {} false alarms over {}) {bands}",
                m.needed.saturating_sub(self.caught), m.needed, self.flagged.saturating_sub(m.false_max), m.false_max),
            Some(Ships::Off) => format!("ships: off, with the result stated {bands}"),
            None => "ships: no band (no verdict): off, 'Not yet tested on new films.'".into(),
        }
    }
    pub fn marks_line(&self, m: &Marks) -> String {
        let w = |b: bool| if b { "met" } else { "missed" };
        format!("marks: catch {} ({}/{}, needed {}); false alarms {} ({}/{}, at most {})", w(self.catch_met), self.caught, m.planted, m.needed,
            w(self.false_alarm_met), self.flagged, m.normal, m.false_max)
    }
}

/// What the run requires of its inputs, read from the pre-registration.
#[derive(Clone, Debug, PartialEq)]
pub struct Pins {
    pub provenance: String, pub mm_per_px: f64, pub reference: String, pub line19: f64, pub fingerprint: String, pub gate4: String, pub tau: [f64; 5],
    pub score_line: f32, pub gate2_report: String, pub size_report: String, pub size_uses: Vec<Region>, pub cb_report: String, pub centre_ruling: String,
    pub cb_line: f64, pub cb_measured_line: f64,
}
impl Pins {
    pub fn from_text(text: &str) -> anyhow::Result<Pins> {
        let v: serde_json::Value = serde_json::from_str(text)?;
        let hex = |p: &serde_json::Value, k: &str| -> anyhow::Result<String> {
            let s = p[k].as_str().unwrap_or_default();
            ensure!(s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit() && !b.is_ascii_uppercase()), "{} pins no {k}", v["version"]);
            Ok(s.to_string())
        };
        let num = |p: &serde_json::Value, k: &str| p[k].as_f64().with_context(|| format!("{} has no number {k}", v["version"]));
        let (f, s, g, z, c) = (&v["films"], &v["shape"], &v["regions"], &v["size"], &v["cbCentre"]);
        let mut tau = [f64::NAN; 5];
        for r in REGIONS { tau[r.index()] = g["tau"][serde_json::to_value(r)?.as_str().unwrap_or_default()].as_f64().unwrap_or(f64::NAN); }
        ensure!(tau.iter().all(|t| t.is_finite()), "the pre-registration lacks a tolerance: {tau:?}");
        Ok(Pins { provenance: hex(f, "provenanceSha256")?, mm_per_px: num(f, "mmPerPx")?, reference: hex(s, "referenceSha256")?, line19: num(s, "line19")?,
            fingerprint: hex(g, "detectorFingerprint")?, gate4: hex(g, "gate4RecordSha256")?, tau, score_line: num(g, "scoreLine")? as f32,
            gate2_report: hex(g, "gate2ReportSha256")?, size_report: hex(z, "reportSha256")?,
            size_uses: serde_json::from_value(z["uses"].clone()).context("the pre-registration's size uses are not regions")?,
            cb_report: hex(c, "measuredReportSha256")?, centre_ruling: hex(c, "rulingRecordSha256")?, cb_line: num(c, "line")?, cb_measured_line: num(c, "measuredLine")? })
    }
    pub fn from_prereg() -> anyhow::Result<Pins> { Self::from_text(PREREG) }
}

/// Opens the seal for this run: `ledger::open_seal` on this pre-registration and `<out>/sc1-1b-pku.json`.
pub fn open_seal(git: &Git, out: &Path) -> anyhow::Result<ledger::SealKey> { ledger::open_seal(PREREG_PATH, PREREG, git, &out.join(REPORT)) }

/// One judged PKU film: its truth tracing (19 points in ORDER, film px as stored), its size, and the finder's boxes on it
/// at the score line. (SC1-1a's `Film` carries a Ceph-400 or Aariz `Dataset`; a PKU film is neither, so it has its own.)
#[derive(Clone, Debug)]
pub struct PkuFilm { pub id: String, pub pts: Vec<Pt>, pub w: u32, pub h: u32, pub regions: Regions }
/// The region finder as this run uses it: only with the seal's key.
pub trait PkuFinder { fn fingerprint(&self) -> String; fn boxes(&self, data: &Path, ids: &[String], flipped: bool, key: &ledger::SealKey) -> anyhow::Result<BTreeMap<String, Found>>; }
/// The real one: the installed model through `sc1_boxes::boxes_for_unless` (cache under reports/sc1/boxes), PKU's test split.
pub struct EngineFinder { pub engine: RegionEngine, pub cache: PathBuf }
impl PkuFinder for EngineFinder {
    fn fingerprint(&self) -> String { self.engine.spec().fingerprint() }
    fn boxes(&self, data: &Path, ids: &[String], flipped: bool, key: &ledger::SealKey) -> anyhow::Result<BTreeMap<String, Found>> {
        sc1_boxes::boxes_for_unless(&self.engine, data, crate::pku::PKU_SPLIT, ids, &self.cache, flipped, Some(key))
    }
}
fn regions_of(found: &Found, fp: &str, line: f32) -> anyhow::Result<Regions> {
    sc1_gate::best_scores(found)?;
    ensure!(found.fingerprint == fp, "a film's boxes are from detector {}, not {fp}", found.fingerprint);
    Regions::from_scored(&sc1_boxes::region_boxes(found), line, fp)
}

/// The ten planted kinds, in the order they are printed.
pub const KINDS: [Kind; 10] = [Kind::P1a, Kind::P1b, Kind::P2, Kind::P3Half, Kind::P3Double, Kind::P4(Region::CranialBase), Kind::P4(Region::Maxilla),
    Kind::P4(Region::Mandible), Kind::P4(Region::Incisors), Kind::P4(Region::SoftTissue)];
fn check_order(films: &[PkuFilm]) -> anyhow::Result<()> {
    ensure!(films.iter().all(|f| f.pts.len() == 19), "every judged tracing must have 19 points");
    ensure!(films.windows(2).all(|w| w[0].id < w[1].id), "the films must be sorted by id, each once");
    Ok(())
}
/// Every plant and the untouched tracing, per film in order (SC1-1a's recipes, M20, under SEED, at PKU's scale).
pub fn plants(films: &[PkuFilm]) -> anyhow::Result<Vec<Plant>> {
    check_order(films)?;
    ensure!(films.len() >= 2, "{} film(s): P2's derangement needs at least 2", films.len());
    let ids: Vec<String> = films.iter().map(|f| f.id.clone()).collect();
    let d = sc1_1a::derangement(&ids, SEED, P2_SALT);
    let mm = crate::pku::PKU_MM_PER_PX;
    let mut out = Vec::new();
    for (i, f) in films.iter().enumerate() {
        ensure!(d[i] != i, "P2 would give a film its own tracing");
        out.push(Plant { film: i, kind: Kind::P1a, pts: sc1_1a::mirror_film(&f.pts, f.w) });
        out.push(Plant { film: i, kind: Kind::P1b, pts: sc1_1a::mirror_in_place(&f.pts) });
        out.push(Plant { film: i, kind: Kind::P2, pts: films[d[i]].pts.clone() });
        out.push(Plant { film: i, kind: Kind::P3Half, pts: sc1_1a::scaled(&f.pts, 0.5) });
        out.push(Plant { film: i, kind: Kind::P3Double, pts: sc1_1a::scaled(&f.pts, 2.0) });
        for r in REGIONS {
            let (dmm, u) = sc1_1a::p4_draw_seeded(SEED, i, r);
            out.push(Plant { film: i, kind: Kind::P4(r), pts: sc1_1a::moved(&f.pts, Some(r), dmm / mm * u.0, dmm / mm * u.1) });
        }
        out.push(Plant { film: i, kind: Kind::N, pts: f.pts.clone() });
    }
    Ok(out)
}
/// Information only: the whole tracing moved 10 and 20 mm in a seeded direction, every film.
pub fn info_shifts(films: &[PkuFilm]) -> anyhow::Result<Vec<Plant>> {
    check_order(films)?;
    let mm = crate::pku::PKU_MM_PER_PX;
    let mut out = Vec::new();
    for (i, f) in films.iter().enumerate() {
        for s in sc1_1a::SHIFTS_MM {
            let u = sc1_1a::shift_draw_seeded(SEED, i, s);
            let px = s as f64 / mm;
            out.push(Plant { film: i, kind: Kind::Shift(s), pts: sc1_1a::moved(&f.pts, None, px * u.0, px * u.1) });
        }
    }
    Ok(out)
}
/// The 10 control films: PKU ids sorted, shuffled with case_rng(20261108, [9]), the first 10.
pub fn control_films(ids: &[String]) -> Vec<String> {
    let mut v = ids.to_vec();
    v.sort();
    shuffle(&mut v, &mut case_rng(SEED, &[sc1_1a::T_CONTROL]));
    v.truncate(CONTROL_FILMS);
    v
}

/// The whole-film check on one PKU tracing, exactly as the app calls it (the film's own boxes, the stored facing right),
/// after the homework guard by both names a PKU film could carry (`pkuNNN`, `pku:pkuNNN`). This is
/// `sc1_1a::check_with` for a film that is neither Ceph-400 nor Aariz.
pub fn check(f: &PkuFilm, pts: &[Pt], whole: &WholeScorer, cal: &FilmCal) -> anyhow::Result<FilmResult> {
    no_homework(whole.names(), &[f.id.clone(), reference_name("pku", &f.id)?])?;
    check_film(Some(whole), &sc1_1a::marks_of(pts), false, f.w, f.h, RegionLook::Found(&f.regions), cal)
}
/// Information: Stage A (point-check/2) on the same tracing with a scorer of the same reference tracings.
fn stage_a(f: &PkuFilm, pts: &[Pt], s: &ShapeScorer) -> anyhow::Result<bool> {
    Ok(matches!(pc::score_run(s, &sc1_1a::marks_of(pts), false, f.w)?, RunCheck::Flagged { .. } | RunCheck::FilmUnusual { .. }))
}
/// One judged tracing.
#[derive(Clone, Debug)]
pub struct PkuCase { pub kind: Kind, pub result: FilmResult, pub stage_a: bool }
/// Every plant judged by whole-film/3 (and Stage A, for information), in the plants' order.
pub fn judge_all(films: &[PkuFilm], plants: &[Plant], whole: &WholeScorer, stage: &ShapeScorer, cal: &FilmCal) -> anyhow::Result<Vec<PkuCase>> {
    whole.line_for(&(0..19).collect::<Vec<_>>())?;
    par_map(plants, |p| -> anyhow::Result<PkuCase> {
        let f = films.get(p.film).context("a plant names no film")?;
        Ok(PkuCase { kind: p.kind, result: check(f, &p.pts, whole, cal)?, stage_a: stage_a(f, &p.pts, stage)? })
    }).into_iter().collect()
}

/// One printed line: the looks (as the development run counts them) and how many Stage A also flagged.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KindLine { #[serde(flatten)] pub looks: Looks, pub stage_a: usize }
fn kind_line(label: &str, cases: &[&PkuCase], tau: &RegionTau) -> KindLine {
    let rs: Vec<&FilmResult> = cases.iter().map(|c| &c.result).collect();
    KindLine { looks: crate::sc1_dev::looks_of_results(label, &rs, tau), stage_a: cases.iter().filter(|c| c.stage_a).count() }
}
fn flagged(r: &FilmResult) -> bool { matches!(r.check, FilmCheck::Flagged { .. }) }
fn reasons(r: &FilmResult) -> &[Reason] { match &r.check { FilmCheck::Flagged { reasons } => reasons, _ => &[] } }
/// C7's counts: every kind's total is the marks' films, the untouched too; anything else (an information case among
/// them included) stops the run with an error.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Counts { pub caught: usize, pub planted: usize, pub false_alarms: usize, pub normal: usize, pub kinds: Vec<KindLine>, pub untouched: KindLine }
pub fn count(cases: &[PkuCase], m: &Marks, tau: &RegionTau) -> anyhow::Result<Counts> {
    ensure!(m.planted > 0 && m.normal > 0, "a mark that counts nothing is an error, never a pass");
    ensure!(*m == Marks::for_films(m.films), "the marks {m:?} are not the pre-registered rule's for {} films", m.films);
    ensure!(!cases.iter().any(|c| matches!(c.kind, Kind::Shift(_))), "an information case is among the counted ones");
    let of = |k: Kind| -> Vec<&PkuCase> { cases.iter().filter(|c| c.kind == k).collect() };
    let mut kinds = Vec::new();
    for k in KINDS {
        let c = of(k);
        counted(&k.label(), c.len(), m.films)?;
        kinds.push(kind_line(&k.label(), &c, tau));
    }
    let n = of(Kind::N);
    counted(&Kind::N.label(), n.len(), m.normal)?;
    let planted: Vec<&PkuCase> = cases.iter().filter(|c| c.kind.planted()).collect();
    counted("planted, all kinds", planted.len(), m.planted)?;
    Ok(Counts { caught: planted.iter().filter(|c| flagged(&c.result)).count(), planted: planted.len(), false_alarms: n.iter().filter(|c| flagged(&c.result)).count(),
        normal: n.len(), kinds, untouched: kind_line(&Kind::N.label(), &n, tau) })
}

// ---- the controls (spec §17.10); each made to fail on purpose in a test ----

fn control(name: &str, what: &str, got: String, holds: bool) -> Control { Control { name: name.into(), what: what.into(), got, holds } }
fn has_region(r: &FilmResult, only: Option<Region>) -> bool { reasons(r).iter().any(|x| matches!(x, Reason::Region { region, .. } if only.is_none_or(|o| *region == o))) }
fn has_size(r: &FilmResult) -> bool { reasons(r).iter().any(|x| matches!(x, Reason::Size { .. })) }
/// On each control film: is the transformed tracing caught by `hit`, and is the untouched one flagged at all.
fn two_sided(name: &str, what: &str, films: &[&PkuFilm], whole: &WholeScorer, cal: &FilmCal, label: String,
             make: &dyn Fn(&PkuFilm) -> Vec<Pt>, hit: &dyn Fn(&FilmResult) -> bool) -> anyhow::Result<Control> {
    let (mut h, mut plain) = (0, 0);
    for f in films {
        if hit(&check(f, &make(f), whole, cal)?) { h += 1 }
        if flagged(&check(f, &f.pts, whole, cal)?) { plain += 1 }
    }
    let n = films.len();
    Ok(control(name, what, format!("{h} of {n} {label}; untouched {plain} of {n} flagged"), n == CONTROL_FILMS && h == n && plain < n))
}
/// C2: the control films' tracings x `factor`: 10 of 10 flagged by region or size; unscaled: not all 10.
pub fn c2(films: &[&PkuFilm], whole: &WholeScorer, cal: &FilmCal, factor: f64) -> anyhow::Result<Control> {
    two_sided("C2", "the 10 control films' tracings x2: 10 of 10 region or size; unscaled: not all 10", films, whole, cal, format!("region or size at x{factor}"),
        &|f| sc1_1a::scaled(&f.pts, factor), &|r| has_region(r, None) || has_size(r))
}
/// C3: the mandible moved `shift_mm` forward (+x) at `mm_per_px`: 10 of 10 mandible region; unmoved: not all 10.
pub fn c3(films: &[&PkuFilm], whole: &WholeScorer, cal: &FilmCal, shift_mm: f64, mm_per_px: f64) -> anyhow::Result<Control> {
    two_sided("C3", "the mandible moved 40 mm forward: 10 of 10 mandible region; unmoved: not all 10", films, whole, cal, format!("mandible region at {shift_mm} mm"),
        &|f| sc1_1a::moved(&f.pts, Some(Region::Mandible), shift_mm / mm_per_px, 0.0), &|r| has_region(r, Some(Region::Mandible)))
}
/// C8: the coordinates x `factor`: a region flag on all 10 and every point off the film.
pub fn c8(films: &[&PkuFilm], whole: &WholeScorer, cal: &FilmCal, factor: f64) -> anyhow::Result<Control> {
    let mut h = 0;
    for f in films {
        let p: Vec<Pt> = f.pts.iter().map(|q| (q.0 * factor, q.1 * factor)).collect();
        if has_region(&check(f, &p, whole, cal)?, None) && p.iter().all(|q| off_film(*q, f.w, f.h)) { h += 1 }
    }
    let n = films.len();
    Ok(control("C8", "coordinates x1000: 10 of 10 region, every point off the film", format!("{h} of {n} at x{factor}"), n == CONTROL_FILMS && h == n))
}
/// C10: the tracings x `factor`: 10 of 10 size; unscaled: not all 10.
pub fn c10(films: &[&PkuFilm], whole: &WholeScorer, cal: &FilmCal, factor: f64) -> anyhow::Result<Control> {
    two_sided("C10", "the 10 control films' tracings x0.5: 10 of 10 size; unscaled: not all 10", films, whole, cal, format!("size at x{factor}"),
        &|f| sc1_1a::scaled(&f.pts, factor), &has_size)
}
/// C11: the cranial base moved `shift_mm` forward (+x): 10 of 10 cranial-base region (an edge or the centre); unmoved: not all 10.
pub fn c11(films: &[&PkuFilm], whole: &WholeScorer, cal: &FilmCal, shift_mm: f64, mm_per_px: f64) -> anyhow::Result<Control> {
    two_sided("C11", "the cranial base moved 20 mm forward: 10 of 10 cranial-base region; unmoved: not all 10", films, whole, cal, format!("cranial-base region at {shift_mm} mm"),
        &|f| sc1_1a::moved(&f.pts, Some(Region::CranialBase), shift_mm / mm_per_px, 0.0), &|r| has_region(r, Some(Region::CranialBase)))
}
/// C5: Ceph-400 test2 and Aariz test refused as held back (both gates; Aariz by its folder name beside Ceph-400's); the
/// PKU folder refused by both gates without the seal's key.
pub fn c5(ceph400: &Path, pku: &Path) -> Control {
    let held = |r: anyhow::Result<()>| r.is_err_and(|e| e.to_string().contains("held back"));
    let sealed = |r: anyhow::Result<()>| r.is_err_and(|e| e.to_string().contains("sealed"));
    let aariz = ceph400.parent().map(|p| p.join("aariz")).unwrap_or_else(|| PathBuf::from("aariz"));
    let t2 = held(ledger::refuse_held_back(ceph400, "test2")) && held(crate::chainproof::refuse_held_back_cache(ceph400, "test2"));
    let at = ledger::is_held_back(&aariz, "test") && held(crate::chainproof::refuse_held_back_cache(&aariz, "test"));
    let pk = sealed(ledger::refuse_held_back(pku, crate::pku::PKU_SPLIT)) && sealed(crate::chainproof::refuse_held_back_cache(pku, crate::pku::PKU_SPLIT));
    control("C5", "Ceph-400 test2 and Aariz test refused; PKU refused without the seal's key", format!("test2 refused: {t2}; Aariz test refused: {at}; PKU refused without the key: {pk}"), t2 && at && pk)
}
/// C6: the reference holds no PKU name; a reference naming a PKU tracing is refused; a scorer holding the judged film's own
/// tracing under its PKU name is refused as homework.
pub fn c6(f: &PkuFilm, r: &Reference, cal: &FilmCal) -> Control {
    let none = !r.names.iter().any(|n| n.starts_with("pku:") || n.split_once(':').is_some_and(|(_, id)| id.starts_with("pku")) || n == &f.id);
    let name = reference_name("pku", &f.id).unwrap_or_default();
    let (mut names, mut tracings) = (r.names.clone(), r.tracings.clone());
    names.push(name);
    tracings.push(f.pts.clone());
    let refused_file = WholeScorer::from_reference(&Reference { sha256: "C6".into(), names: names.clone(), tracings: tracings.clone(), lines: vec![] })
        .is_err_and(|e| e.to_string().contains("PKU"));
    let prior = Prior { sha256: "C6".into(), films: names.len(), names, tracings };
    let homework = WholeScorer::from_prior(&prior).and_then(|s| check(f, &f.pts, &s, cal)).is_err_and(|e| e.to_string().contains("homework"));
    control("C6", "no PKU name in the reference; a reference naming a PKU tracing refused; a judged film in its own reference refused",
        format!("no PKU name: {none}; PKU name refused: {refused_file}; homework refused: {homework}"), none && refused_file && homework)
}
/// C12: recomputed at the run from the folder: the median S-N of gt.csv x spacing.csv over Ceph-400 Train's (gt.csv x 0.1),
/// within 1 +- 0.15; and provenance.json's SHA-256 the pinned one.
pub fn c12(pku: &Path, ceph400: &Path, provenance: &str) -> anyhow::Result<Control> {
    let prov = ft_common::sha256_hex(&std::fs::read(pku.join("provenance.json")).context("PKU's provenance.json")?);
    let gt = dataset::load_points(&pku.join("gt.csv"))?;
    let spacing = dataset::load_spacing(&pku.join("spacing.csv"))?;
    let sns = gt.iter().map(|(id, t)| Ok(crate::pku::sn_px(t)? * spacing.get(id).copied().with_context(|| "a PKU film has no spacing row")?)).collect::<anyhow::Result<Vec<f64>>>()?;
    let (p, c) = (crate::pku::median(&sns)?, crate::pku::ceph400_train_sn_mm(ceph400)?);
    let ratio = p / c;
    let (scale, same) = ((ratio - 1.0).abs() <= crate::pku::SN_TOLERANCE, prov == provenance);
    Ok(control("C12", "PKU's scale: median S-N (gt.csv x spacing.csv) within 15% of Ceph-400 Train's; provenance.json as pinned",
        format!("ratio {ratio:.4} (PKU {p:.2} mm, Ceph-400 Train {c:.2} mm; limit 1 +- {}); provenance as pinned: {same}", crate::pku::SN_TOLERANCE), scale && same))
}

// ---- the report ----

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PkuReport {
    pub version: String, pub rule: String, pub prereg_sha256: String, pub git_sha: String, pub detector_fingerprint: String, pub disclosure: Vec<String>,
    pub tau: [f64; 5], pub size_line: f64, pub centre_line: f64, pub line19: f64, pub marks: Marks, pub counts: Counts, pub verdict_marks: PkuVerdict,
    pub ships: Option<Ships>, pub caught_ci: (f64, f64), pub false_ci: (f64, f64), pub doctors: Vec<KindLine>, pub shifts: Vec<KindLine>, pub box_quality: Vec<BoxQuality>,
    pub centre_medians: Vec<CentreMedian>, pub controls: Vec<Control>, pub verdict: String, pub exit: i32, pub seconds: f64, pub summary: Vec<String>,
}
fn ci(x: (f64, f64)) -> String { format!("95% CI {:.1}% to {:.1}%", 100.0 * x.0, 100.0 * x.1) }
fn fmt_line(l: &KindLine) -> String {
    let k = &l.looks;
    format!("{}: {} of {} (mirrored {}, shape {}, region {}, size {}, centre {}, facing {}, no-ceph-found {}; only size/centre {}; size not judged {}, centre not judged {}; Stage A also flagged {})",
        k.label, k.flagged, k.cases, k.mirrored, k.shape, k.region, k.size, k.centre, k.facing, k.no_ceph_found, k.only_new, k.size_not_judged, k.centre_not_judged, l.stage_a)
}
fn num(x: f64) -> String { if x.is_finite() { format!("{x:.3}") } else { "none".into() } }
impl PkuReport {
    fn lines(&self) -> Vec<String> {
        let (m, c) = (&self.marks, &self.counts);
        let mut v = vec![
            format!("SC1-1b-PKU {} ({PREREG_PATH} sha256 {}); git HEAD {}; detector {}", self.version, self.prereg_sha256, self.git_sha, self.detector_fingerprint),
            format!("rule {}: the 1,000-tracing reference (full-19 line {:.1}), tau {}, size line {:.2}, centre line {:.2}", self.rule, self.line19,
                REGIONS.iter().map(|r| format!("{} {:.2}", r.words(), self.tau[r.index()])).collect::<Vec<_>>().join(", "), self.size_line, self.centre_line),
            format!("films: PKU {} (unseen until this run; truth the mean of the two doctors); seed {SEED}", m.films),
            "planted faults (each kind on its own line; no per-kind floor):".into(),
        ];
        v.extend(c.kinds.iter().map(|l| format!("  {}", fmt_line(l))));
        v.push(format!("POOLED caught: {} of {} ({}); needed {}", c.caught, c.planted, ci(self.caught_ci), m.needed));
        v.push(format!("untouched: {}", fmt_line(&c.untouched)));
        v.push(format!("POOLED untouched flagged: {} of {} ({}); at most {}", c.false_alarms, c.normal, ci(self.false_ci), m.false_max));
        v.push(self.verdict_marks.marks_line(m));
        v.push(self.verdict_marks.ships_line(m, self.verdict != BROKEN));
        v.push("information, the untouched line with one doctor's tracing:".into());
        v.extend(self.doctors.iter().map(|l| format!("  {}", fmt_line(l))));
        v.push("information, the whole tracing moved:".into());
        v.extend(self.shifts.iter().map(|l| format!("  {}", fmt_line(l))));
        v.push("information, box quality on PKU (expert boxes from the 19 traced points only):".into());
        for x in &self.box_quality {
            v.push(format!("  {:<20} films {:>3} not found {:>2} IoU median {} p90 {} centre error median {} p90 {} {}", x.region.words(), x.films, x.not_found,
                num(x.iou_median), num(x.iou_p90), num(x.centre_err_median), num(x.centre_err_p90), if x.in_mm { "mm" } else { "(fraction of the expert box's longer side)" }));
        }
        v.push("information, median cranial-base centre offset per set (nearest rank per axis; x forward, y down; fraction of the box's longer side):".into());
        for cm in &self.centre_medians {
            v.push(format!("  {:<16} {} films {}: {}", cm.set, cm.source, cm.films.map(|n| n.to_string()).unwrap_or("-".into()),
                cm.median.map(|x| format!("({:+.4}, {:+.4})", x.0, x.1)).unwrap_or("none".into())));
        }
        v.push("controls:".into());
        v.extend(self.controls.iter().map(|x| format!("  {} {}: {} -> {}", x.name, x.what, x.got, if x.holds { "holds" } else { "DOES NOT HOLD" })));
        v.extend(self.disclosure.iter().map(|d| format!("disclosure: {d}")));
        v.push("note: one run of 102 films is a coarse instrument (spec §17.9): a check whose true false-alarm rate is 2% meets the false-alarm mark about 67 times in 100".into());
        v.push(format!("verdict {} (exit {}: 0 pass, 3 fail, 1 broken, 4 gate stop); {:.0} s", self.verdict, self.exit, self.seconds));
        v
    }
}

fn read(p: &Path, what: &str) -> anyhow::Result<Vec<u8>> { std::fs::read(p).with_context(|| format!("{}: SC1-1b-PKU needs {what}", p.display())) }
fn pinned(bytes: &[u8], pin: &str, what: &str) -> anyhow::Result<()> {
    let sha = ft_common::sha256_hex(bytes);
    ensure!(sha == pin, "{what}'s SHA-256 is {sha}, the pre-registered one {pin}");
    Ok(())
}
fn median_of(o: &[(f64, f64)]) -> anyhow::Result<Option<(f64, f64)>> {
    if o.is_empty() { return Ok(None) }
    let ax = |f: fn(&(f64, f64)) -> f64| { let mut v: Vec<f64> = o.iter().map(f).collect(); v.sort_by(f64::total_cmp); crate::sc1_calib::median_nearest_rank(&v) };
    Ok(Some((ax(|x| x.0)?, ax(|x| x.1)?)))
}
fn tracings(gt: &dataset::Points, ids: &[String], what: &str) -> anyhow::Result<Vec<Vec<Pt>>> {
    sc1_gate::complete(gt, ids, what)?;
    ids.iter().map(|id| {
        let rows = gt.get(id).with_context(|| format!("a {what} film has no tracing"))?;
        ORDER.iter().map(|n| rows.iter().find(|(p, _, _)| p == n).map(|(_, x, y)| (*x, *y)).with_context(|| format!("a {what} tracing lacks a point"))).collect()
    }).collect()
}

enum Outcome { Stop, Report(Box<PkuReport>) }

#[allow(clippy::too_many_arguments)]
fn pku_run(pku: &Path, ceph400: &Path, models: &Path, out: &Path, git: &Git, pins: &Pins, m: &Marks, finder: &dyn PkuFinder) -> anyhow::Result<Outcome> {
    let t0 = std::time::Instant::now();
    // The seal first: nothing under the PKU folder is read before the key exists.
    let key = open_seal(git, out)?;
    ensure!(pku.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("pku")), "{}: SC1-1b-PKU reads the folder named pku (the one the seal covers)", pku.display());
    ledger::refuse_held_back_unless(pku, crate::pku::PKU_SPLIT, Some(&key))?;
    crate::chainproof::refuse_held_back_cache_unless(pku, crate::pku::PKU_SPLIT, Some(&key))?;
    ensure!(sc1_gate::is_ceph400(ceph400), "{}: C12 reads Ceph-400 train, and this folder is not Ceph-400", ceph400.display());
    ledger::refuse_held_back(ceph400, "train")?;
    sc1_data::ensure_outside_or_ignored(out)?;
    sc1_data::ensure_outside_or_ignored(models)?;
    let pre: serde_json::Value = serde_json::from_str(PREREG)?;
    ensure!(pre["version"] == VERSION && pre["rule"] == RULE_VERSION, "{PREREG_PATH} is not {VERSION} for {RULE_VERSION}");
    ensure!(pins.mm_per_px == crate::pku::PKU_MM_PER_PX, "the pinned scale {} is not the loader's {} (pku-prepare/2)", pins.mm_per_px, crate::pku::PKU_MM_PER_PX);
    // The gate report in force (gate /4's tau are gate /2's; gate /4 is a ruling with no report): a stop is exit 4.
    let g2 = read(&out.join(GATE2_REPORT), "the gate report in force (box-gate-2.json)")?;
    let gp = sc1_1a::Pins { fingerprint: pins.fingerprint.clone(), gate_report_sha256: pins.gate2_report.clone(), score_line: pins.score_line, tau: pins.tau, rule: sc1_1a::GATE_RULE.into() };
    let gate = match sc1_1a::check_gate(&g2, &gp)? { sc1_1a::Gate::Stop => return Ok(Outcome::Stop), sc1_1a::Gate::Pass(v) => v };
    // whole-film/3 in force: gate /4's tau, the ruled centre, the size look, each against its record and report.
    let fp = finder.fingerprint();
    ensure!(fp == pins.fingerprint, "the installed region finder is {fp}; SC1-1b-PKU is pinned to {}", pins.fingerprint);
    let rec = sc1_wf3::Records { gate4_sha: pins.gate4.clone(), centre_sha: pins.centre_ruling.clone(), measured_report: pins.cb_report.clone(), ..sc1_wf3::records()? };
    ensure!(rec.tau == pins.tau && rec.score_line == pins.score_line && rec.centre_line == pins.cb_line && rec.measured_line == pins.cb_measured_line,
        "the pre-registration's tau, score line or centre lines are not the whole-film/3 records' ({:?} at {}, lines {} and {})", rec.tau, rec.score_line, rec.centre_line, rec.measured_line);
    let cal = parse_calibration(&read(&ceph_model::wholefilm::calibration_path(models), "calibration.json (gate /4's tau)")?)?;
    sc1_wf3::check_gate4(&cal, &fp, &rec)?;
    let cb = parse_cb_calibration(&read(&ceph_model::wholefilm::cb_calibration_path(models), "the ruled centre calibration")?)?;
    sc1_wf3::check_ruled_centre(&cb, &fp, &rec)?;
    let cbr = read(&out.join(CB_REPORT), "the centre calibration report")?;
    pinned(&cbr, &pins.cb_report, "the centre calibration report")?;
    let cbr: serde_json::Value = serde_json::from_slice(&cbr)?;
    let med: (f64, f64) = serde_json::from_value(cbr["median"].clone()).context("the centre calibration report has no median")?;
    ensure!(med == cb.median, "the centre calibration's median {:?} is not its report's {med:?}", cb.median);
    let size = parse_size_calibration(&read(&ceph_model::wholefilm::size_calibration_path(models), "the size calibration")?)?;
    size.fits(&fp)?;
    ensure!(size.report_sha256 == pins.size_report, "the size calibration names report {}, the pre-registered one {}", size.report_sha256, pins.size_report);
    ensure!(size.uses == pins.size_uses, "the size calibration uses {:?}, the pre-registered {:?}", size.uses, pins.size_uses);
    let sr = read(&out.join(SIZE_REPORT), "the size calibration report")?;
    pinned(&sr, &pins.size_report, "the size calibration report")?;
    let sr: serde_json::Value = serde_json::from_slice(&sr)?;
    let (uses, refs): (Vec<Region>, Vec<SizeRef>) = (serde_json::from_value(sr["uses"].clone())?, serde_json::from_value(sr["refs"].clone())?);
    ensure!(uses == size.uses && refs == size.refs, "the size calibration's region sets, centres or lines are not its report's");
    let size_line = size.refs.iter().find(|r| r.regions == size.uses).map(|r| r.line).context("the size calibration has no line for the regions it uses")?;
    // The 1,000-tracing reference and its stored full-19 line.
    let rb = read(&ceph_model::wholefilm::reference_path(models), "the 1,000-tracing reference (whole-film-reference-v1.shape)")?;
    pinned(&rb, &pins.reference, "the 1,000-tracing reference")?;
    let reference = parse_reference(&rb)?;
    let line19 = reference.lines.iter().find(|(s, _)| *s == (0..19).collect::<Vec<_>>()).map(|(_, l)| *l).context("the reference stores no full-19 line")?;
    ensure!(line19 == pins.line19, "the reference's stored full-19 line is {line19}, the pre-registered one {}", pins.line19);
    // The PKU folder: provenance, the list, the scale, the three tracing files.
    pinned(&read(&pku.join("provenance.json"), "PKU's provenance.json")?, &pins.provenance, "PKU's provenance.json")?;
    let mut ids = dataset::select(&dataset::load_splits(&pku.join("splits.json"))?, crate::pku::PKU_SPLIT)?;
    ids.sort();
    ensure!(ids.windows(2).all(|w| w[0] != w[1]), "PKU's test list names a film twice");
    ensure!(ids.iter().all(|id| id.len() == 6 && id.starts_with("pku") && id[3..].bytes().all(|b| b.is_ascii_digit())), "a PKU id is not pkuNNN");
    counted("PKU test films", ids.len(), m.films)?;
    let spacing = dataset::load_spacing(&pku.join("spacing.csv"))?;
    let at_scale = ids.iter().filter(|id| spacing.get(*id) == Some(&pins.mm_per_px)).count();
    counted(&format!("PKU films at {} mm/px in spacing.csv", pins.mm_per_px), at_scale, m.films)?;
    let gt = tracings(&dataset::load_points(&pku.join("gt.csv"))?, &ids, "PKU (gt.csv)")?;
    let g1 = tracings(&dataset::load_points(&pku.join("gt-doctor1.csv"))?, &ids, "PKU (gt-doctor1.csv)")?;
    let g2d = tracings(&dataset::load_points(&pku.join("gt-doctor2.csv"))?, &ids, "PKU (gt-doctor2.csv)")?;
    // The region finder: once per film (cached), with the key.
    let found = finder.boxes(pku, &ids, false, &key)?;
    let films: Vec<PkuFilm> = ids.iter().zip(&gt).map(|(id, pts)| {
        let f = found.get(id).context("a PKU film has no boxes")?;
        Ok(PkuFilm { id: id.clone(), pts: pts.clone(), w: f.image_width, h: f.image_height, regions: regions_of(f, &fp, cal.score_line)? })
    }).collect::<anyhow::Result<_>>()?;
    let whole = WholeScorer::from_reference(&reference)?;
    let stage = ShapeScorer::new(reference.tracings.clone());
    let fc = FilmCal { tau: &cal.tau, size: Some(&size), cb: Some(&cb) };
    // The controls.
    let ctrl = control_films(&ids);
    let cf: Vec<&PkuFilm> = ctrl.iter().map(|id| films.iter().find(|f| &f.id == id).context("a control film is not judged")).collect::<anyhow::Result<_>>()?;
    let flip = finder.boxes(pku, &ctrl, true, &key)?;
    let flips: Vec<(Regions, Regions)> = cf.iter().map(|f| Ok((f.regions.clone(), regions_of(flip.get(&f.id).context("a control film has no flipped boxes")?, &fp, cal.score_line)?)))
        .collect::<anyhow::Result<_>>()?;
    let mm = pins.mm_per_px;
    let mut controls = vec![sc1_1a::c1(&|p: &[Pt], w: u32| sc1_1a::mirror_film(p, w), &cal.tau)?, c2(&cf, &whole, &fc, C2_FACTOR)?, c3(&cf, &whole, &fc, C3_SHIFT_MM, mm)?,
        sc1_1a::c4(&flips), c5(ceph400, pku), c6(cf[0], &reference, &fc)];
    // The plants, judged and counted (C7).
    let ps = plants(&films)?;
    let judged = judge_all(&films, &ps, &whole, &stage, &fc)?;
    let counts = count(&judged, m, &cal.tau)?;
    controls.push(control("C7", "1,020 planted, 102 untouched, 10 kinds, as stated; a mark that counted nothing is an error",
        format!("planted {} of {}, untouched {} of {}, {} kinds of {} each", counts.planted, m.planted, counts.normal, m.normal, counts.kinds.len(), m.films), true));
    controls.extend([c8(&cf, &whole, &fc, C8_FACTOR)?, sc1_1a::c9(&gate), c10(&cf, &whole, &fc, C10_FACTOR)?, c11(&cf, &whole, &fc, C11_SHIFT_MM, mm)?, c12(pku, ceph400, &pins.provenance)?]);
    // Information.
    let sh = judge_all(&films, &info_shifts(&films)?, &whole, &stage, &fc)?;
    let shifts: Vec<KindLine> = sc1_1a::SHIFTS_MM.iter().map(|s| kind_line(&Kind::Shift(*s).label(), &sh.iter().filter(|c| c.kind == Kind::Shift(*s)).collect::<Vec<_>>(), &cal.tau)).collect();
    for l in &shifts { counted(&l.looks.label, l.looks.cases, m.films)?; }
    let mut doctors = Vec::new();
    for (who, t) in [("N with doctor1 alone", &g1), ("N with doctor2 alone", &g2d)] {
        let p: Vec<Plant> = t.iter().enumerate().map(|(i, pts)| Plant { film: i, kind: Kind::N, pts: pts.clone() }).collect();
        let j = judge_all(&films, &p, &whole, &stage, &fc)?;
        let l = kind_line(who, &j.iter().collect::<Vec<_>>(), &cal.tau);
        counted(who, l.looks.cases, m.films)?;
        doctors.push(l);
    }
    let fb: Vec<FilmBoxes> = films.iter().map(|f| FilmBoxes { detected: f.regions.clone(),
        expert: teaching_boxes(&ORDER.iter().zip(&f.pts).map(|(n, p)| (n.to_string(), p.0, p.1)).collect::<Vec<_>>(), f.w, f.h), mm_per_px: Some(mm) }).collect();
    let quality = box_quality(&fb)?;
    let offsets: Vec<(f64, f64)> = judged.iter().filter(|c| c.kind == Kind::N).filter_map(|c| c.result.cb.map(|v| v.offset)).collect();
    let mut medians = vec![CentreMedian { set: "PKU".into(), source: "this run (untouched)".into(), films: Some(offsets.len()), median: median_of(&offsets)? }];
    for s in cbr["perSet"].as_array().context("the centre calibration report has no perSet")? {
        let m2 = s["median"].as_array().and_then(|a| Some((a.first()?.as_f64()?, a.get(1)?.as_f64()?)));
        medians.push(CentreMedian { set: s["set"].as_str().unwrap_or_default().into(), source: CB_REPORT.into(), films: s["judged"].as_u64().map(|n| n as usize), median: m2 });
    }
    let holds = controls.iter().all(|c| c.holds);
    let vm = PkuVerdict::of(counts.caught, counts.false_alarms, m);
    let verdict = vm.verdict(holds);
    let disclosure: Vec<String> = pre["disclosure"].as_array().context("the pre-registration has no disclosure")?.iter().filter_map(|d| d.as_str().map(String::from)).collect();
    let mut rep = PkuReport { version: VERSION.into(), rule: RULE_VERSION.into(), prereg_sha256: ft_common::sha256_hex(PREREG.as_bytes()), git_sha: git.sha.clone(),
        detector_fingerprint: fp, disclosure, tau: cal.tau.0, size_line, centre_line: cb.line, line19, marks: *m,
        caught_ci: crate::stats::clopper_pearson(counts.caught, counts.planted)?, false_ci: crate::stats::clopper_pearson(counts.false_alarms, counts.normal)?,
        counts, verdict_marks: vm, ships: vm.ships(m, holds), doctors, shifts, box_quality: quality, centre_medians: medians, controls, verdict: verdict.into(), exit: exit_code(verdict),
        seconds: t0.elapsed().as_secs_f64(), summary: vec![] };
    rep.summary = rep.lines();
    Ok(Outcome::Report(Box::new(rep)))
}

/// The run on given folders, git state, pins, marks and finder: prints every line and writes `<out>/sc1-1b-pku.json`
/// last (pass, fail, or broken by a control). Exit 0 pass, 3 fail, 4 gate stop (nothing judged, nothing written), 1
/// broken (on an error: no verdict line, nothing written).
#[allow(clippy::too_many_arguments)]
pub fn run_with(pku: &Path, ceph400: &Path, models: &Path, out: &Path, git: &Git, pins: &Pins, m: &Marks, finder: &dyn PkuFinder) -> anyhow::Result<i32> {
    println!("SC1-1b-PKU {VERSION}: PKU folder {}; Ceph-400 folder {} (C12 only)", pku.display(), ceph400.display());
    let rep = match pku_run(pku, ceph400, models, out, git, pins, m, finder) {
        Ok(Outcome::Report(r)) => r,
        Ok(Outcome::Stop) => { println!("SC1-1b-PKU: the gate report in force says stop: no verdict, nothing judged, nothing written (exit 4: to the owner)"); return Ok(4) }
        Err(e) => { eprintln!("SC1-1b-PKU broken before any verdict (nothing written, nothing concluded): {e:#}"); return Ok(1) }
    };
    for l in &rep.summary { println!("{l}"); }
    let text = serde_json::to_string_pretty(&rep)? + "\n";
    let path = out.join(REPORT);
    std::fs::write(&path, &text)?;
    println!("written to {} (sha256 {})", path.display(), ft_common::sha256_hex(text.as_bytes()));
    Ok(rep.exit)
}

/// `--sc1-1b-pku`: the git state, the pre-registration's pins, the installed region finder (boxes cached under
/// reports/sc1/boxes), then the run on the real marks. Nothing here reads PKU; the seal opens inside the run.
pub fn run_cli(pku: &Path, ceph400: &Path, models: &Path, out: &Path) -> anyhow::Result<i32> {
    let pre = || -> anyhow::Result<(Git, Pins, EngineFinder)> {
        let engine = RegionEngine::load(&regions_manifest_path(models))?;
        Ok((sc1_gate::git_state(PREREG_PATH)?, Pins::from_prereg()?, EngineFinder { engine, cache: out.join("boxes") }))
    };
    match pre() {
        Ok((git, pins, finder)) => run_with(pku, ceph400, models, out, &git, &pins, &Marks::real(), &finder),
        Err(e) => { eprintln!("SC1-1b-PKU broken before any verdict (nothing written, nothing concluded): {e:#}"); Ok(1) }
    }
}

#[cfg(test)]
#[path = "sc1_1b_pku_tests.rs"]
mod tests;

