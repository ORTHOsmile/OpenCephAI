//! SC-1 Part 1, the whole-film check in the app (design
//! §4.3, §5, §7, §8, §12): each model run, right after it is recorded and Stage A has checked it, and the final tracing at
//! "Mark tracing verified", are checked as a whole (shape, regions, facing; rule `whole-film/1`). A note only: nothing
//! here moves, accepts or changes a point, a run or a sign-off, and an SC-1 note never holds sign-off (R3). It writes
//! only format 20's own rows. A check that fails is logged and never fails the run or the sign-off.
//!
//! The region finder runs at most once per film per detector fingerprint, off the async thread and outside the
//! library's lock (`plan_regions` reads inside the lock, `run_plan` finds outside it, its panic caught), and its boxes
//! are stored: reopening a film never re-runs it. The boxes are found on the film as stored, so nothing is mapped back
//! (if a flipped run is ever mapped, the rule is x' = (w - 1) - x with x0 and x1 swapped; ceph_infer::regions).
use ceph_infer::regions::{Found, RegionEngine, REGION_KEYS};
use ceph_model::pointcheck::Mark;
use ceph_model::wholefilm::{check_film, CbCalibration, ExtraLook, FilmCal, FilmCheck, FilmResult, Look, Reason, Region, RegionBox, RegionCalibration, RegionLook, Regions, SizeCalibration, WholeScorer, MIN_FILM_SIDE, RULE_VERSION};
use ceph_store::{Library, RegionBoxRow, RegionRunRecord, ResolveReason, WholeFilmReasonRow, WholeFilmRecord};
use serde::Serialize;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

/// The shape look's starting knowledge: the scorer (one per tracings file, kept for the app's life so its fitted lines
/// are reused), the file's SHA-256 and its film count.
pub struct ShapeLoaded { pub scorer: WholeScorer, pub sha256: String, pub films: usize }
/// The region finder and its calibration. `calibration` None: the model is installed but not set up (no calibration
/// file, a refused one, or one made for another detector fingerprint).
pub struct RegionLoaded { pub engine: RegionEngine, pub calibration: Option<RegionCalibration>,
    /// The size look's and the centre look's calibrations (whole-film/2), each only when made for this detector; else None
    /// and that look reads `not-set-up`.
    pub size: Option<SizeCalibration>, pub cb: Option<CbCalibration>,
    /// The folder the finder was read from (`<folder>/regions`).
    pub finder_dir: PathBuf,
    /// The folder the three calibrations were read from, always as one set: the finder's own folder, or (1.2.1, pairing)
    /// another folder when the finder passes the finder pins.
    pub calibration_dir: PathBuf }

/// The whole-film check's starting knowledge for this app run, loaded on first use (as Stage A's `PointCheckState`):
/// while a part is empty, each use looks again; once loaded it is never searched again. A load that panics is caught.
pub struct WholeFilmState { shape: Mutex<Option<Arc<ShapeLoaded>>>, regions: Mutex<Option<Arc<RegionLoaded>>>, fixed: bool, pins: Pins }
impl Default for WholeFilmState { fn default() -> Self { WholeFilmState { shape: Mutex::new(None), regions: Mutex::new(None), fixed: false, pins: Pins::shipped() } } }

/// The inputs whole-film/3 was tested with (PKU, 6 Nov 2026), which the app insists on before it gives any verdict: the
/// region calibration is gate /4's, with gate /4's record hash and τ (`check_gate4`); the centre calibration carries the
/// whole-film/3 ruling, line 0.08 (`check_ruled_centre`); the shape reference has the pre-registered SHA-256. A file that
/// is anything else (gate /1 to /3, the measured centre file, another reference) reads "not set up" for its look, never a
/// verdict stamped `whole-film/3`. The checks are the bench's own (`ceph_model::wholefilm::pins`).
#[derive(Clone, Debug)]
pub struct Pins { records: Option<ceph_model::wholefilm::Records>, reference_sha256: Option<String>, size_report_sha256: Option<String>,
    /// 1.2.1: the finder pins are in force (the shipped pins). Off only for the older tests' own fixtures (`of`, `open`).
    pin_finder: bool }
impl Pins {
    /// The shipped pins: the committed records and reference hash. If the records cannot be read, nothing is accepted.
    pub fn shipped() -> Pins { Pins::from_records(ceph_model::wholefilm::records()) }
    fn from_records(records: anyhow::Result<ceph_model::wholefilm::Records>) -> Pins {
        match records {
            Ok(r) => Pins { records: Some(r), reference_sha256: Some(ceph_model::wholefilm::REFERENCE_SHA256.into()), size_report_sha256: Some(ceph_model::wholefilm::SIZE_REPORT_SHA256.into()), pin_finder: true },
            Err(e) => { eprintln!("Whole-film check: the pre-registered records cannot be read, so no calibration is accepted: {e:#}"); Pins { records: None, reference_sha256: Some(String::new()), size_report_sha256: Some(String::new()), pin_finder: true } }
        }
    }
    /// Pins for a test fixture with its own records and reference hash.
    #[cfg(test)] fn of(records: ceph_model::wholefilm::Records, reference_sha256: &str) -> Pins { Pins { records: Some(records), reference_sha256: Some(reference_sha256.into()), size_report_sha256: Some("5".repeat(64)), pin_finder: false } }
    /// Accepts any file (the older tests' synthetic fixtures). Never built outside tests.
    #[cfg(test)] fn open() -> Pins { Pins { records: None, reference_sha256: None, size_report_sha256: None, pin_finder: false } }
    fn region_ok(&self, c: &RegionCalibration, fp: &str) -> anyhow::Result<()> {
        match &self.records { Some(r) => ceph_model::wholefilm::check_gate4(c, fp, r), None if self.reference_sha256.is_none() => Ok(()), None => Err(anyhow::anyhow!("the pre-registered records are unreadable")) }
    }
    fn centre_ok(&self, c: &CbCalibration, fp: &str) -> anyhow::Result<()> {
        match &self.records { Some(r) => ceph_model::wholefilm::check_ruled_centre(c, fp, r), None if self.reference_sha256.is_none() => Ok(()), None => Err(anyhow::anyhow!("the pre-registered records are unreadable")) }
    }
    /// The size calibration must be the pre-registered one (report SHA-256, regions used), as the PKU run required.
    fn size_ok(&self, c: &SizeCalibration, fp: &str) -> anyhow::Result<()> {
        match &self.size_report_sha256 {
            None => c.fits(fp),
            Some(want) if *want == ceph_model::wholefilm::SIZE_REPORT_SHA256 => ceph_model::wholefilm::check_size(c, fp),
            Some(want) => { c.fits(fp)?; anyhow::ensure!(c.report_sha256 == *want && c.uses == ceph_model::wholefilm::size_uses(), "the size calibration is not the pre-registered one"); Ok(()) }
        }
    }
    /// The finder pins (1.2.1): this `regions/manifest.json` names the gate /4 record's detector as its `model.onnx`
    /// (whose bytes `RegionEngine::load` checks against that name) and is itself the pinned file (SHA-256
    /// `REGION_MANIFEST_SHA256`). Only such a finder may be used with calibrations from another folder, or alone without
    /// its own. With the records unreadable, no finder passes. Off for the older tests' own fixtures.
    fn finder_ok(&self, manifest: &std::path::Path) -> anyhow::Result<()> {
        if !self.pin_finder { return Ok(()); }
        let r = self.records.as_ref().ok_or_else(|| anyhow::anyhow!("the pre-registered records are unreadable"))?;
        let bytes = std::fs::read(manifest).map_err(|e| anyhow::anyhow!("{}: {e}", manifest.display()))?;
        let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|e| anyhow::anyhow!("{}: {e}", manifest.display()))?;
        ceph_model::wholefilm::check_finder(v["sha256"].as_str().unwrap_or_default(), &ceph_model::install::sha256_bytes(&bytes), r)
    }
    fn reference_ok(&self, sha: &str) -> anyhow::Result<()> {
        match &self.reference_sha256 { Some(want) => { anyhow::ensure!(sha == want, "the shape reference has SHA-256 {sha}, not the pre-registered {want}"); Ok(()) } None => Ok(()) }
    }
}
impl WholeFilmState {
    /// A state holding exactly these (for one command's use, or a test). Never loads anything itself.
    pub fn with(shape: Option<Arc<ShapeLoaded>>, regions: Option<Arc<RegionLoaded>>) -> Self {
        WholeFilmState { shape: Mutex::new(shape), regions: Mutex::new(regions), fixed: true, pins: Pins::shipped() }
    }
    /// A state that loads from the model folders but accepts any calibration (the older synthetic tests). Tests only.
    #[cfg(test)] fn unpinned() -> Self {
        WholeFilmState { shape: Mutex::new(None), regions: Mutex::new(None), fixed: false, pins: Pins::open() }
    }
    #[cfg(test)] fn with_pins(pins: Pins) -> Self {
        WholeFilmState { shape: Mutex::new(None), regions: Mutex::new(None), fixed: false, pins }
    }
    pub fn shape(&self) -> Option<Arc<ShapeLoaded>> { self.shape.lock().unwrap_or_else(|p| p.into_inner()).clone() }
    pub fn regions(&self) -> Option<Arc<RegionLoaded>> { self.regions.lock().unwrap_or_else(|p| p.into_inner()).clone() }
    /// Drops the loaded region finder, so the next use looks in the folders again (the check model was just installed or
    /// removed). A check already holding its `Arc` finishes with that copy; the file handle is released when it ends
    /// (Windows can then delete the folder). No effect on a `fixed` state.
    pub fn forget_regions(&self) {
        if self.fixed { return; }
        *self.regions.lock().unwrap_or_else(|p| p.into_inner()) = None;
    }
    /// Loads each empty part from the model folders. Called on a blocking thread, never under the library's lock (the
    /// folder list reads the library's settings).
    pub fn ensure_loaded(&self, candidates: impl FnOnce() -> Vec<Option<PathBuf>>) {
        if self.fixed { return; }
        let mut s = self.shape.lock().unwrap_or_else(|p| p.into_inner());
        let mut r = self.regions.lock().unwrap_or_else(|p| p.into_inner());
        if s.is_some() && r.is_some() { return; }
        let c = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(candidates)) {
            Ok(c) => c,
            Err(_) => { eprintln!("Whole-film check not set up: listing the model folders panicked"); return; }
        };
        if s.is_none() { *s = caught("the tracings file", || load_shape_with(&c, &self.pins)); }
        if r.is_none() { *r = caught("the region finder", || load_regions_with(&c, &self.pins)); }
    }
}
fn caught<T>(what: &str, f: impl FnOnce() -> Option<T>) -> Option<T> {
    std::panic::catch_unwind(std::panic::AssertUnwindSafe(f)).unwrap_or_else(|_| { eprintln!("Whole-film check: loading {what} panicked"); None })
}

/// The whole-film reference (`whole-film-reference-v1.shape`, SC-1 Part 1b, spec §17.4) from the first candidate folder
/// holding one that passes the pins, as the shape scorer, its stored lines (the full 19 and each 18) seeded so none is
/// fitted here; a set with fewer points is fitted on first use by the warm-up, outside the library's lock. Stage A's
/// `ceph400-v1.shape` is never used in its place. A file that is refused (unreadable, or not the pre-registered SHA-256)
/// is logged and the next folder is looked in, so a stale file in the user's own folder falls back to the one inside the
/// app (6 Nov 2026); the pins admit only the one pre-registered file, so the fallback cannot change a verdict. None,
/// logged, when no folder holds one that passes (the shape look then reads `not-set-up`).
pub fn load_shape_with(candidates: &[Option<PathBuf>], pins: &Pins) -> Option<Arc<ShapeLoaded>> {
    let one = |path: &std::path::Path| -> anyhow::Result<ShapeLoaded> {
        let bytes = std::fs::read(path).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
        let r = ceph_model::wholefilm::parse_reference(&bytes).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
        pins.reference_ok(&r.sha256).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
        let scorer = WholeScorer::from_reference(&r)?;
        Ok(ShapeLoaded { scorer, sha256: r.sha256, films: r.names.len() })
    };
    let paths: Vec<PathBuf> = candidates.iter().flatten().map(|d| ceph_model::wholefilm::reference_path(d)).filter(|p| p.is_file()).collect();
    if paths.is_empty() { eprintln!("Whole-film check: shape not set up: no whole-film reference (shape/whole-film-reference-v1.shape) in the model folders"); return None; }
    for path in &paths {
        match one(path) {
            Ok(s) => { eprintln!("whole-film check shape set up: {} tracings, file sha256 {} ({})", s.films, s.sha256, path.display()); return Some(Arc::new(s)); }
            Err(e) => eprintln!("Whole-film check: this shape reference is not used: {e:#}; looking in the next folder"),
        }
    }
    eprintln!("Whole-film check: shape not set up: no folder holds the pre-registered reference");
    None
}
/// `load_shape_with` the shipped pins.
pub fn load_shape(candidates: &[Option<PathBuf>]) -> Option<Arc<ShapeLoaded>> { load_shape_with(candidates, &Pins::shipped()) }
/// The region finder and its three calibrations (6 Nov 2026; pairing, 1.2.1). The three calibrations always come as ONE
/// folder's set; only the finder may come from another folder, and only when both of its files pass the finder pins.
/// 1. Unchanged: each candidate folder holding `regions/manifest.json` is loaded in order with the calibrations beside it;
///    the first whose finder and three calibrations all pass the pins is used, alone. So a complete set in the user's own
///    folder (or a 1.2.0-style folder) wins as before, and a stale one is passed over.
/// 2. Pairing: if no folder is complete, the finder is the first one that loads and passes the finder pins
///    (`Pins::finder_ok`: `model.onnx` is the record's detector and `manifest.json` is the pinned file), and the three
///    calibrations are the first candidate folder's set that all pass the pins for that finder. With both of the finder's
///    files pinned, a pair is the same four files, byte for byte, that the PKU run tested and 1.2.0 shipped in one folder,
///    so which folder each came from cannot change a verdict.
/// 3. Otherwise the folder with the most looks set up is used (the first of equals), its missing looks reading
///    `not-set-up`: a folder's own finder with its own calibrations, or the pinned finder with a folder's own set; never
///    calibrations pieced together from two folders. A finder that fails the finder pins is not used here either, so a
///    finder whose manifest differs by one byte reads "no region finder" unless another folder has a good one.
/// None when no folder holds a finder that loads and passes the finder pins.
pub fn load_regions_with(candidates: &[Option<PathBuf>], pins: &Pins) -> Option<Arc<RegionLoaded>> {
    let dirs: Vec<PathBuf> = candidates.iter().flatten().cloned().collect();
    // Step 1, as before; what each folder's own finder loaded is kept for steps 2 and 3.
    let mut own: Vec<Option<(RegionEngine, Calibrations)>> = Vec::with_capacity(dirs.len());
    for d in &dirs {
        let manifest = ceph_infer::regions::regions_manifest_path(d);
        let loaded = if manifest.is_file() { load_engine(&manifest) } else { None };
        let Some(engine) = loaded else { own.push(None); continue };
        let cals = read_calibrations(&regions_dir(d), &engine.spec().fingerprint(), pins);
        log_loaded(&engine, &manifest, &cals);
        // 1.2.1 (review I1): the folder's own manifest must be the pinned file too, as in the pairing steps.
        if cals.count() == 3 && pins.finder_ok(&manifest).is_ok() { return Some(Arc::new(cals.with(engine, regions_dir(d), regions_dir(d)))); }
        eprintln!("Whole-film check: {} has {} of 3 calibrations set up; looking in the next folder", regions_dir(d).display(), cals.count());
        own.push(Some((engine, cals)));
    }
    // The finder pins, for each folder whose own finder loaded.
    let pinned: Vec<bool> = own.iter().zip(&dirs).map(|(o, d)| o.is_some() && match pins.finder_ok(&ceph_infer::regions::regions_manifest_path(d)) {
        Ok(()) => true,
        Err(e) => { eprintln!("Whole-film check: the region finder in {} is not used: {e:#}", regions_dir(d).display()); false }
    }).collect();
    let finder = pinned.iter().position(|p| *p);
    // The calibration set of each other folder, read for the pinned finder (None: that folder's own finder already passed
    // the finder pins, so its set was read above for the same detector, or the folder holds none of the three files).
    let paired: Vec<Option<Calibrations>> = dirs.iter().enumerate().map(|(j, d)| match &finder {
        Some(f) if !pinned[j] && has_calibrations(d) => own[*f].as_ref().map(|(e, _)| read_calibrations(&regions_dir(d), &e.spec().fingerprint(), pins)),
        _ => None,
    }).collect();
    // Step 2.
    if let (Some(f), Some(j)) = (finder, paired.iter().position(|c| c.as_ref().is_some_and(|c| c.count() == 3))) {
        let (engine, _) = own[f].take()?;
        let cals = paired.into_iter().nth(j).flatten()?;
        eprintln!("whole-film check: finder from {}, calibrations from {} (both pinned)", regions_dir(&dirs[f]).display(), regions_dir(&dirs[j]).display());
        return Some(Arc::new(cals.with(engine, regions_dir(&dirs[f]), regions_dir(&dirs[j]))));
    }
    // Step 3: the most looks set up, the first of equals.
    let mut best: Option<(usize, usize, bool)> = None;   // (looks set up, folder, the folder's own finder)
    for j in 0..dirs.len() {
        let n = match (&own[j], &paired[j]) {
            (Some((_, c)), _) if pinned[j] => Some((c.count(), true)),
            (_, Some(c)) => Some((c.count(), false)),
            _ => None,
        };
        if let Some((n, mine)) = n { if best.is_none_or(|(b, _, _)| n > b) { best = Some((n, j, mine)); } }
    }
    let (_, j, mine) = best?;
    if mine {
        let (engine, cals) = own[j].take()?;
        return Some(Arc::new(cals.with(engine, regions_dir(&dirs[j]), regions_dir(&dirs[j]))));
    }
    let f = finder?;
    let (engine, _) = own[f].take()?;
    let cals = paired.into_iter().nth(j).flatten()?;
    eprintln!("whole-film check: finder from {}, {} of 3 calibrations from {} (both pinned)", regions_dir(&dirs[f]).display(), cals.count(), regions_dir(&dirs[j]).display());
    Some(Arc::new(cals.with(engine, regions_dir(&dirs[f]), regions_dir(&dirs[j]))))
}
/// Whether any candidate folder holds a region finder that passes the finder pins (the shipped ones) with its
/// `model.onnx` beside it: what the one-time question asks about (1.2.1). Cheap: reads each manifest, never the 121 MB.
pub fn finder_pinned_in(candidates: &[Option<PathBuf>]) -> bool {
    let pins = Pins::shipped();
    candidates.iter().flatten().any(|d| {
        let m = ceph_infer::regions::regions_manifest_path(d);
        m.is_file() && regions_dir(d).join("model.onnx").is_file() && pins.finder_ok(&m).is_ok()
    })
}
/// `<folder>/regions`, where the finder and its calibrations sit.
fn regions_dir(folder: &std::path::Path) -> PathBuf { folder.join("regions") }
/// The folder holds at least one of the three calibration files.
fn has_calibrations(folder: &std::path::Path) -> bool {
    ["calibration.json", "size-calibration.json", "cb-centre-calibration.json"].iter().any(|f| regions_dir(folder).join(f).is_file())
}
/// The three calibrations read from one folder for one finder: each kept only when it passes the pins for that finder.
struct Calibrations { calibration: Option<RegionCalibration>, size: Option<SizeCalibration>, cb: Option<CbCalibration> }
impl Calibrations {
    fn count(&self) -> usize { [self.calibration.is_some(), self.size.is_some(), self.cb.is_some()].iter().filter(|x| **x).count() }
    fn with(self, engine: RegionEngine, finder_dir: PathBuf, calibration_dir: PathBuf) -> RegionLoaded {
        RegionLoaded { engine, calibration: self.calibration, size: self.size, cb: self.cb, finder_dir, calibration_dir }
    }
}
/// The region finder from this `regions/manifest.json`. None, logged, when refused.
fn load_engine(manifest: &std::path::Path) -> Option<RegionEngine> {
    match RegionEngine::load(manifest) {
        Ok(e) => Some(e),
        Err(e) => { eprintln!("Whole-film check: the region finder was refused: {e:#}"); None }
    }
}
/// `regions/calibration.json`, `size-calibration.json` and `cb-centre-calibration.json` in `dir`, each used only when
/// made for the finder `fp` (its fingerprint) and passing the pins; else that look is not set up.
fn read_calibrations(dir: &std::path::Path, fp: &str, pins: &Pins) -> Calibrations {
    let path = dir.join("calibration.json");
    let calibration = match std::fs::read(&path).map_err(anyhow::Error::from).and_then(|b| ceph_model::wholefilm::parse_calibration(&b)) {
        Ok(c) if c.detector_fingerprint == fp => match pins.region_ok(&c, fp) {
            Ok(()) => Some(c),
            Err(e) => { eprintln!("Whole-film check: regions not set up: this is not the region calibration whole-film/3 was tested with: {e:#}"); None }
        },
        Ok(c) => { eprintln!("Whole-film check: regions not set up: the calibration is for detector {}, the region finder is {fp}", c.detector_fingerprint); None }
        Err(e) => { eprintln!("Whole-film check: regions not set up: the calibration file: {e:#}"); None }
    };
    // The two whole-film/2 calibrations sit beside the region calibration. Each must name this detector, else that look is not set up.
    let size = optional_calibration("size", Some(dir.join("size-calibration.json")), ceph_model::wholefilm::parse_size_calibration, |c: &SizeCalibration| pins.size_ok(c, fp));
    let cb = optional_calibration("centre", Some(dir.join("cb-centre-calibration.json")), ceph_model::wholefilm::parse_cb_calibration, |c: &CbCalibration| c.fits(fp).and_then(|_| pins.centre_ok(c, fp)));
    Calibrations { calibration, size, cb }
}
fn log_loaded(engine: &RegionEngine, manifest: &std::path::Path, c: &Calibrations) {
    let on = |b: bool| if b { "set up" } else { "not set up" };
    eprintln!("whole-film check region finder loaded: {} ({}) from {}; calibration {}; size {}; centre {}", engine.spec().version, engine.spec().fingerprint(), manifest.display(),
        on(c.calibration.is_some()), on(c.size.is_some()), on(c.cb.is_some()));
}

/// One optional calibration file: read, checked, and kept only when it names the installed detector. A missing file is
/// quiet; a refused one or one for another detector is logged. Either way the look reads `not-set-up`.
fn optional_calibration<T>(what: &str, path: Option<PathBuf>, parse: fn(&[u8]) -> anyhow::Result<T>, fits: impl FnOnce(&T) -> anyhow::Result<()>) -> Option<T> {
    let path = path.filter(|p| p.is_file())?;
    let got = std::fs::read(&path).map_err(anyhow::Error::from).and_then(|b| parse(&b)).and_then(|c| fits(&c).map(|_| c));
    match got { Ok(c) => Some(c), Err(e) => { eprintln!("Whole-film check: the {what} look is not set up: {e:#}"); None } }
}

/// What the region look will use for one film: run the finder on this file, the boxes already stored for this
/// detector, or why it does not run.
#[derive(Debug)]
pub enum RegionPlan { Run { path: PathBuf }, Stored { id: i64, record: RegionRunRecord }, NotRun(Look) }
/// The region look's input to a check: boxes just found (stored by the check), stored boxes, or why not run.
#[derive(Debug)]
pub enum RegionInput { Found(Found), Stored { id: i64, record: RegionRunRecord }, NotRun(Look) }
/// Everything one check needs besides the library.
pub struct WholeFilmInput { pub shape: Option<Arc<ShapeLoaded>>, pub regions: RegionInput, pub calibration: Option<RegionCalibration>,
    pub size: Option<SizeCalibration>, pub cb: Option<CbCalibration>,
    /// Built while the switch read off: `check_and_store` writes nothing for it, even if the switch was ticked since (review M1).
    pub off: bool }

/// Inside the library's lock: reads only.
pub(crate) fn plan_regions(l: &Library, case_id: &str, st: &WholeFilmState) -> anyhow::Result<RegionPlan> {
    let Some(r) = st.regions() else { return Ok(RegionPlan::NotRun(Look::NoRegionModel)) };
    let Some(c) = r.calibration.as_ref() else { return Ok(RegionPlan::NotRun(Look::NotSetUp)) };
    let doc = l.load(case_id)?;
    if doc.image.width.min(doc.image.height) < MIN_FILM_SIDE { return Ok(RegionPlan::NotRun(Look::FilmTooSmall)) }
    if let Some((id, record)) = l.film_regions(case_id, &c.detector_fingerprint)? { return Ok(RegionPlan::Stored { id, record }) }
    Ok(RegionPlan::Run { path: PathBuf::from(doc.image.path) })
}
/// Outside the library's lock: runs the finder for a `Run`. An error or a panic is logged and becomes `NotSetUp` (the
/// check still runs on the shape).
pub(crate) fn run_plan(plan: RegionPlan, st: &WholeFilmState) -> RegionInput {
    match plan {
        RegionPlan::Stored { id, record } => RegionInput::Stored { id, record },
        RegionPlan::NotRun(l) => RegionInput::NotRun(l),
        RegionPlan::Run { path } => {
            let Some(r) = st.regions() else { return RegionInput::NotRun(Look::NoRegionModel) };
            let got = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                #[cfg(test)] tests::finder_panic_if_injected();
                let img = ceph_infer::engine::load_gray(&path)?;
                r.engine.find(&img)
            }));
            match got {
                Ok(Ok(f)) => { eprintln!("region finder {} ms", f.ms.round()); RegionInput::Found(f) }
                Ok(Err(e)) => { eprintln!("Whole-film check: the region finder failed: {e:#}"); RegionInput::NotRun(Look::NotSetUp) }
                Err(p) => { eprintln!("Whole-film check: the region finder panicked: {}", panic_text(&p)); RegionInput::NotRun(Look::NotSetUp) }
            }
        }
    }
}
/// The input from a state and the region look's input.
pub(crate) fn assemble(st: &WholeFilmState, regions: RegionInput) -> WholeFilmInput {
    WholeFilmInput { shape: st.shape(), regions, calibration: st.regions().and_then(|r| r.calibration.clone()),
        size: st.regions().and_then(|r| r.size.clone()), cb: st.regions().and_then(|r| r.cb.clone()), off: false }
}

/// Which tracing a check will look at, so the line for its present-point set can be fitted before the library is locked
/// for the check (Task 7 review: a new set's line costs n leave-one-out fits, seconds in a debug build, and every library
/// command waits while the lock is held).
pub(crate) enum Tracing { Run { marks: Vec<Mark>, facing_left: bool }, Final }
/// The marks a warm-up fits the line for: the same marks, facing and film width the check will use.
pub(crate) struct Warm { marks: Vec<Mark>, facing_left: bool, img_w: u32 }
/// The final tracing's marks, as `check_final` reads them (one derivation, so the set warmed is the set checked).
fn final_marks(doc: &ceph_store::CaseDoc) -> Vec<Mark> {
    doc.landmarks.iter().map(|m| Mark { landmark_id: m.id.clone(), x: m.x, y: m.y }).collect()
}
/// Inside the library's lock, reads only: the region plan and the tracing to warm. Each fails on its own, logged (a
/// failed plan is `NotSetUp`; a failed read warms nothing, and the check then fits the line itself, as before).
pub(crate) fn read_for_check(l: &Library, case_id: &str, st: &WholeFilmState, tracing: Tracing) -> (RegionPlan, Option<Warm>) {
    let plan = plan_regions(l, case_id, st).unwrap_or_else(|e| {
        eprintln!("Whole-film check: the region plan failed for {case_id}: {e:#}"); RegionPlan::NotRun(Look::NotSetUp) });
    let warm = (|| -> anyhow::Result<Warm> {
        let doc = l.load(case_id)?;
        Ok(match tracing {
            Tracing::Run { marks, facing_left } => Warm { marks, facing_left, img_w: doc.image.width },
            Tracing::Final => Warm { marks: final_marks(&doc), facing_left: doc.facing == "left", img_w: doc.image.width },
        })
    })().map_err(|e| eprintln!("Whole-film check: nothing warmed for {case_id}: {e:#}")).ok();
    (plan, warm)
}
/// Outside the library's lock (a blocking thread): fits the line for the tracing's present-point set into the scorer's
/// cache. Changes no number (the line is the same wherever it is fitted); a failure or a panic is logged and the check
/// fits the line itself, as before.
pub(crate) fn warm_line(st: &WholeFilmState, w: &Warm) {
    let Some(sh) = st.shape() else { return };
    let t = std::time::Instant::now();
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| sh.scorer.warm(&w.marks, w.facing_left, w.img_w))) {
        Ok(Ok(Some(p))) => eprintln!("whole-film check: line for {} points warmed in {} ms (outside the library lock)", p.len(), t.elapsed().as_millis()),
        Ok(Ok(None)) => {}
        Ok(Err(e)) => eprintln!("Whole-film check: the warm-up failed: {e:#}"),
        Err(p) => eprintln!("Whole-film check: the warm-up panicked: {}", panic_text(&p)),
    }
}
/// Outside the library's lock: the finder (for a `Run` plan), the warm-up, then the input.
pub(crate) fn outside_lock(plan: RegionPlan, warm: Option<Warm>, st: &WholeFilmState) -> WholeFilmInput {
    let regions = run_plan(plan, st);
    if let Some(w) = &warm { warm_line(st, w); }
    assemble(st, regions)
}
fn panic_text(p: &Box<dyn std::any::Any + Send>) -> String {
    p.downcast_ref::<&str>().map(|s| s.to_string()).or_else(|| p.downcast_ref::<String>().cloned()).unwrap_or_else(|| "(no message)".into())
}

/// A box that can be stored found: its corners numbers and strictly ordered, its score a number from 0 to 1.
fn storable(b: &ceph_infer::regions::FoundBox) -> bool {
    [b.x0, b.y0, b.x1, b.y1].iter().all(|v| v.is_finite()) && b.x1 > b.x0 && b.y1 > b.y0 && b.score.is_finite() && (0.0..=1.0).contains(&b.score)
}
/// The finder's five boxes as stored rows. A degenerate or non-finite box (corners or score) is stored not found, no
/// corners (the store refuses it otherwise, and with it the whole run); a score that is not a number is stored 0.
/// The facing is the detector's at the calibration's score line.
pub(crate) fn region_record(f: &Found, score_line: f32) -> RegionRunRecord {
    let boxes: Vec<RegionBoxRow> = f.boxes.iter().filter(|b| b.region < REGION_KEYS.len()).map(|b| {
        let region = REGION_KEYS[b.region].to_string();
        if storable(b) { RegionBoxRow { region, found: true, x0: Some(b.x0), y0: Some(b.y0), x1: Some(b.x1), y1: Some(b.y1), score: b.score as f64 } }
        else { RegionBoxRow { region, found: false, x0: None, y0: None, x1: None, y1: None, score: if b.score.is_finite() { b.score.clamp(0.0, 1.0) as f64 } else { 0.0 } } }
    }).collect();
    let mut rec = RegionRunRecord { model_fingerprint: f.fingerprint.clone(), model_version: f.version.clone(), facing: None, boxes };
    rec.facing = regions_of(&rec, score_line).ok().and_then(|r| r.facing_left).map(|l| if l { "left" } else { "right" }.to_string());
    rec
}
/// The stored boxes as the check's regions, at the calibration's score line.
fn regions_of(rec: &RegionRunRecord, score_line: f32) -> anyhow::Result<Regions> {
    let boxes: Vec<RegionBox> = rec.boxes.iter().filter(|b| b.found).map(|b| {
        let region = Region::from_key(&b.region).ok_or_else(|| anyhow::anyhow!("{} is not a region", b.region))?;
        match (b.x0, b.y0, b.x1, b.y1) {
            (Some(x0), Some(y0), Some(x1), Some(y1)) => Ok(RegionBox { region, x0, y0, x1, y1, score: b.score as f32 }),
            _ => anyhow::bail!("a found {} box without its corners", b.region),
        }
    }).collect::<anyhow::Result<_>>()?;
    Regions::from_scored(&boxes, score_line, &rec.model_fingerprint)
}

/// The marks of a run: each point with a landmark id.
pub(crate) fn marks_of(points: &[ceph_store::AiPoint]) -> Vec<Mark> {
    points.iter().filter_map(|p| p.landmark_id.as_ref().map(|id| Mark { landmark_id: id.clone(), x: p.x, y: p.y })).collect()
}
#[derive(Clone, Copy, Debug)]
pub(crate) enum Subject { Run(i64), Final }
fn look_key(l: Look) -> &'static str {
    match l { Look::Judged => "judged", Look::TooFewPoints => "too-few-points", Look::NotSetUp => "not-set-up", Look::NoRegionModel => "no-region-model", Look::FilmTooSmall => "film-too-small" }
}
fn finite(what: &str, v: f64) -> anyhow::Result<f64> {
    anyhow::ensure!(v.is_finite(), "the whole-film check's {what} is not a finite number ({v}); nothing is stored");
    Ok(v)
}
/// The result as the record stored. Never a NaN or an infinity in a stored number (an error instead: logged, no row).
pub(crate) fn to_record(subject: Subject, r: &FilmResult, shape: Option<&Arc<ShapeLoaded>>, region_run_id: Option<i64>, cal: Option<&RegionCalibration>, cb_present: usize) -> anyhow::Result<WholeFilmRecord> {
    let judged = r.region_look == Look::Judged;
    let (region_run_id, tau) = if judged {
        let c = cal.ok_or_else(|| anyhow::anyhow!("regions judged without a calibration"))?;
        let rr = region_run_id.ok_or_else(|| anyhow::anyhow!("regions judged without a region run"))?;
        for t in c.tau.0 { finite("tolerance τ", t)?; }
        (Some(rr), Some(c.tau.0))
    } else { (None, None) };
    let v = r.shape.filter(|_| r.shape_look == Look::Judged);
    let (d2, d2_mirror, line) = match v {
        Some(v) => (Some(finite("D²", v.d2)?), Some(finite("D² mirrored", v.d2_mirror)?), Some(finite("line", v.line)?)),
        None => (None, None, None),
    };
    let shape = shape.filter(|_| r.shape_look != Look::NotSetUp);
    // The size triple only for a judged look, the centre pair only for a judged look (020's CHECKs say the same).
    let size = match r.size.filter(|_| r.size_look == ExtraLook::Judged) {
        Some(v) => Some((finite("size number q", v.q)?, finite("size centre", v.centre)?, finite("size line", v.line)?)),
        None => None,
    };
    let cb = match r.cb.filter(|_| r.cb_look == ExtraLook::Judged) {
        Some(v) => Some((finite("centre distance", v.distance)?, finite("centre line", v.line)?)),
        None => None,
    };
    let (outcome, reasons) = match &r.check {
        FilmCheck::Clean => ("clean", vec![]),
        FilmCheck::NotRun { .. } => ("not-run", vec![]),
        FilmCheck::Flagged { reasons } => ("flagged", reasons.iter().map(reason_row).collect::<anyhow::Result<Vec<_>>>()?),
    };
    let (subject, run_id) = match subject { Subject::Run(id) => ("run", Some(id)), Subject::Final => ("final", None) };
    Ok(WholeFilmRecord { subject: subject.into(), run_id, rule_version: RULE_VERSION.into(), prior_sha256: shape.map(|s| s.sha256.clone()),
        prior_films: shape.map(|s| s.films as i64), region_run_id, tau, outcome: outcome.into(), shape_look: look_key(r.shape_look).into(),
        region_look: look_key(r.region_look).into(), present: r.present as i64, d2, d2_mirror, line,
        size_look: r.size_look.key().into(), size, cb_look: r.cb_look.key().into(), cb, cb_present: cb_present as i64, reasons })
}
/// One reason as stored: a region's detail is its points outside, `id=ratio` (3 decimals) or `id=off-film`, joined by
/// commas, and, when the cranial-base centre look flagged, a last part `centre=<distance>` (3 decimals); the shape's
/// detail is the named measures joined by commas (none when nothing is named); a size reason's detail is
/// `factor=<f>` (3 decimals). All within 020's 400 characters (at most 19 points of about 16 characters).
fn reason_row(x: &Reason) -> anyhow::Result<WholeFilmReasonRow> {
    let (region, detail) = match x {
        Reason::Region { region, outside, centre } => {
            let mut parts: Vec<String> = outside.iter().map(|(id, r)| match r { Some(v) => format!("{id}={v:.3}"), None => format!("{id}=off-film") }).collect();
            if let Some(d) = centre { parts.push(format!("centre={d:.3}")); }
            (Some(region.key().to_string()), Some(parts.join(",")))
        }
        Reason::Shape { named } if !named.is_empty() => (None, Some(named.join(","))),
        Reason::Size { factor } => (None, Some(format!("factor={factor:.3}"))),
        Reason::Mirrored | Reason::Shape { .. } | Reason::Facing | Reason::NoCephFound => (None, None),
    };
    Ok(WholeFilmReasonRow { reason: x.key().into(), region, detail })
}

/// The regions for a check from its input: a `Found` is stored first (the film's boxes for this detector; when a run
/// for it is already stored, that one is used), then read back. Returns (region run id, regions) or why not run.
fn region_look(l: &mut Library, case_id: &str, input: &WholeFilmInput, img: (u32, u32)) -> anyhow::Result<(Option<i64>, Result<Regions, Look>)> {
    let cal = match (&input.regions, &input.calibration) {
        (RegionInput::NotRun(look), _) => return Ok((None, Err(*look))),
        (_, None) => { eprintln!("Whole-film check: boxes without a calibration: regions not set up"); return Ok((None, Err(Look::NotSetUp))) }
        (_, Some(c)) => c,
    };
    let (id, rec) = match &input.regions {
        RegionInput::Found(f) => {
            if f.fingerprint != cal.detector_fingerprint || (f.image_width, f.image_height) != img {
                eprintln!("Whole-film check: boxes from detector {} on a {}×{} film do not fit calibration {} and film {:?}: regions not set up",
                    f.fingerprint, f.image_width, f.image_height, cal.detector_fingerprint, img);
                return Ok((None, Err(Look::NotSetUp)));
            }
            l.record_film_regions(case_id, &region_record(f, cal.score_line))?;
            l.film_regions(case_id, &cal.detector_fingerprint)?.ok_or_else(|| anyhow::anyhow!("the region run just stored is not there"))?
        }
        RegionInput::Stored { id, record } => {
            if record.model_fingerprint != cal.detector_fingerprint {
                eprintln!("Whole-film check: stored boxes of detector {} do not fit calibration {}: regions not set up", record.model_fingerprint, cal.detector_fingerprint);
                return Ok((None, Err(Look::NotSetUp)));
            }
            (*id, record.clone())
        }
        RegionInput::NotRun(_) => unreachable!("returned above"),
    };
    Ok((Some(id), Ok(regions_of(&rec, cal.score_line)?)))
}

/// One check on these marks, stored. Returns the new check's id (None: this run was already checked).
fn check_and_store(l: &mut Library, case_id: &str, subject: Subject, label: &str, marks: &[Mark], facing_left: bool, input: &WholeFilmInput) -> anyhow::Result<Option<i64>> {
    // The switch (Settings › Checks): off writes nothing, new or final. Stored checks stay, unshown (`view`).
    if input.off || !switch_of(l)?.on { return Ok(None); }
    let img = { let d = l.load(case_id)?; (d.image.width, d.image.height) };
    let (region_run_id, regions) = region_look(l, case_id, input, img)?;
    let tau = input.calibration.as_ref().map(|c| c.tau).unwrap_or(ceph_model::wholefilm::RegionTau([0.0; 5]));
    let t = std::time::Instant::now();
    // The library is locked while this runs: a panic is caught here, so it never poisons the library's lock.
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let look = match &regions { Ok(r) => RegionLook::Found(r), Err(l) => RegionLook::NotRun(*l) };
        check_film(input.shape.as_ref().map(|s| &s.scorer), marks, facing_left, img.0, img.1, look, &FilmCal { size: input.size.as_ref(), cb: input.cb.as_ref(), ..FilmCal::tau_only(&tau) })
    }));
    eprintln!("whole-film check {label} {} ms", t.elapsed().as_millis());
    let r = r.map_err(|p| anyhow::anyhow!("the whole-film check panicked: {}", panic_text(&p)))??;
    let rec = to_record(subject, &r, input.shape.as_ref(), region_run_id, input.calibration.as_ref(), ceph_model::wholefilm::cb_present(marks, img.0)?)?;
    l.record_whole_film_check(case_id, &rec)
}

/// The check of one model run on its own marks, stored. Returns whether a record was written.
pub(crate) fn check_run(l: &mut Library, case_id: &str, run_id: i64, input: &WholeFilmInput) -> anyhow::Result<bool> {
    let (film, run) = l.ai_run(run_id)?.ok_or_else(|| anyhow::anyhow!("no model run {run_id}"))?;
    anyhow::ensure!(film == case_id, "model run {run_id} is on {film}, not {case_id}");
    // An early exit only, to skip re-checking: the list holds each model's LATEST run. The guard that a run is checked
    // once is the store's unique index on the run (a second record writes nothing).
    if l.whole_film_checks(case_id)?.iter().any(|r| r.record.run_id == Some(run_id)) { return Ok(false); }
    let marks = marks_of(&run.points);
    Ok(check_and_store(l, case_id, Subject::Run(run_id), &run.model_id, &marks, run.facing == "left", input)?.is_some())
}
/// `check_run`, logging any failure; never fails the caller (the run stays recorded).
pub(crate) fn check_run_or_log(l: &mut Library, case_id: &str, run_id: i64, input: &WholeFilmInput) {
    if let Err(e) = check_run(l, case_id, run_id, input) { eprintln!("whole-film check not recorded for run {run_id} on {case_id}: {e:#}"); }
}
/// The check of the film's current tracing (its landmarks among the 19, any source, verified or not), `final`.
pub(crate) fn check_final(l: &mut Library, case_id: &str, input: &WholeFilmInput) -> anyhow::Result<Option<i64>> {
    let doc = l.load(case_id)?;
    check_and_store(l, case_id, Subject::Final, "final", &final_marks(&doc), doc.facing == "left", input)
}
/// `check_final`, logging any failure; never fails the sign-off.
pub(crate) fn check_final_or_log(l: &mut Library, case_id: &str, input: &WholeFilmInput) {
    if let Err(e) = check_final(l, case_id, input) { eprintln!("whole-film check of the final tracing not recorded on {case_id}: {e:#}"); }
}

/// One stored reason, for the screen: `ids` the points outside (a region), `named` the measures (the shape).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReasonView { pub reason: String, pub region: Option<String>, pub ids: Vec<String>, pub named: Vec<String>,
    /// A size reason's factor (×0.5, ×2.0), read from its stored `factor=` detail; None for every other reason.
    pub factor: Option<f64> }
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CheckView { pub id: i64, pub subject: String, pub model_id: Option<String>, pub outcome: String, pub shape_look: String,
    pub region_look: String, pub present: i64,
    /// The size look's status key; the cranial-base centre look's status key and how many of S, N, Po, Ar, Or were traced.
    pub size_look: String, pub cb_look: String, pub cb_present: i64, pub reasons: Vec<ReasonView>, pub resolved: Option<ceph_store::WholeFilmResolution>,
    /// Each of the 19 landmarks with its region's result from the region look (research switch, 6 Nov 2026): `fine`, `flagged` or `not-checked`.
    /// Read from what is stored (the check's region look and reasons, and the boxes of its region finder run); nothing is judged again.
    pub landmark_regions: Vec<LandmarkRegionView>,
    /// Whether the region finder gave a facing (stored with its run, read at the same score line): the facing look is judged by the regions only then.
    pub region_facing: bool }
/// One landmark's region result for the CSV: its region's stored key and `fine` | `flagged` | `not-checked`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LandmarkRegionView { pub id: String, pub region: String, pub result: String }
/// `shown`: the one note on screen; `checks`: every stored check of the film (each model's latest run, newest first,
/// then every final, newest first).
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeFilmView { pub shown: Option<CheckView>, pub checks: Vec<CheckView>,
    /// The switch is off (Settings › Checks): nothing is shown; the stored checks are kept.
    pub off: bool }

/// Every landmark with its region's result, from what the check stored (research switch, 6 Nov 2026; no threshold or judgement is touched):
/// `flagged` when the check stored a region reason for the landmark's region (a centre flag counts: it is the cranial base's region reason);
/// `not-checked` when the region look did not judge (not run, not set up, film too small, a check that was not run), when too few regions were
/// found (`no-ceph-found`), or when the finder gave no usable box for that region (`boxed` lists the regions that had one); otherwise `fine`.
/// A landmark the tracing does not have is `not-checked` too, but only the report knows which are traced, so it applies that.
pub fn landmark_regions(outcome: &str, region_look: &str, reasons: &[ReasonView], boxed: &[String], seen: &[String]) -> Vec<LandmarkRegionView> {
    let judged = outcome != "not-run" && region_look == "judged" && !reasons.iter().any(|x| x.reason == "no-ceph-found");
    ceph_model::wholefilm::REGION_OF.iter().map(|(id, reg)| {
        let key = reg.key();
        let result = if !judged || !seen.iter().any(|s| s == id) { "not-checked" }
            else if reasons.iter().any(|x| x.reason == "region" && x.region.as_deref() == Some(key)) { "flagged" }
            else if !boxed.iter().any(|b| b == key) { "not-checked" }
            else { "fine" };
        LandmarkRegionView { id: id.to_string(), region: key.to_string(), result: result.into() }
    }).collect()
}
/// The regions with a usable box in a check's stored region run, at the pre-registered score line (the gate /4 record's, the one the
/// calibration must equal): the boxes `check_film` used. Empty when the check has no region run or the records cannot be read.
fn boxed_regions(l: &Library, r: &ceph_store::WholeFilmRow) -> anyhow::Result<Vec<String>> {
    let (Some(run), Ok(rec)) = (r.record.region_run_id, ceph_model::wholefilm::records()) else { return Ok(vec![]) };
    Ok(l.region_run_boxes(run)?.into_iter().filter(|b| b.found && (b.score as f32) >= rec.score_line
        && matches!((b.x0, b.y0, b.x1, b.y1), (Some(x0), Some(y0), Some(x1), Some(y1)) if x1 > x0 && y1 > y0)).map(|b| b.region).collect())
}
/// The landmarks of the film now that the stored check actually saw, at the position it judged. A run check saw that run's own points
/// (`ai_points`, stored): a landmark counts only if it is among them and the tracing still holds it where the run put it (1e-6 px). So a point the
/// run did not have (placed later by hand or by another model) and a point moved since are not counted. A final check judged the signed-off tracing,
/// and is shown only while the film is signed off at or after that check, so every current landmark counts.
fn seen_landmarks(l: &Library, doc: &ceph_store::CaseDoc, r: &ceph_store::WholeFilmRow) -> anyhow::Result<Vec<String>> {
    if r.record.subject == "final" { return Ok(doc.landmarks.iter().map(|m| m.id.clone()).collect()); }
    let Some(run) = r.record.run_id else { return Ok(vec![]) };
    let Some((_, run)) = l.ai_run(run)? else { return Ok(vec![]) };
    Ok(doc.landmarks.iter().filter(|m| run.points.iter().any(|p| p.landmark_id.as_deref() == Some(m.id.as_str()) && (p.x - m.x).abs() < 1e-6 && (p.y - m.y).abs() < 1e-6))
        .map(|m| m.id.clone()).collect())
}
/// Whether the region finder gave a facing for this check: its region look judged, three or more regions were found (no `no-ceph-found`), and
/// the facing stored with its region run (read at the same score line) is not empty. Only then did the regions compare the tracing's facing with the film's.
fn region_facing_found(l: &Library, r: &ceph_store::WholeFilmRow) -> anyhow::Result<bool> {
    if r.record.region_look != "judged" || r.record.reasons.iter().any(|x| x.reason == "no-ceph-found") { return Ok(false); }
    let Some(run) = r.record.region_run_id else { return Ok(false) };
    Ok(l.region_run_facing(run)?.is_some())
}
fn check_view(r: ceph_store::WholeFilmRow, boxed: &[String], seen: &[String], region_facing: bool) -> CheckView {
    let reasons: Vec<ReasonView> = r.record.reasons.into_iter().map(|x| {
        let parts = || x.detail.as_deref().map(|d| d.split(',').map(String::from).collect::<Vec<_>>()).unwrap_or_default();
        let (ids, named) = match x.reason.as_str() {
            // `centre=<d>` is the cranial-base centre's distance, not a point.
            "region" => (parts().into_iter().filter(|p| !p.starts_with("centre=")).map(|p| p.split('=').next().unwrap_or_default().to_string()).collect(), vec![]),
            "shape" => (vec![], parts()),
            _ => (vec![], vec![]),
        };
        let factor = (x.reason == "size").then(|| x.detail.as_deref().and_then(|d| d.strip_prefix("factor=")).and_then(|f| f.parse::<f64>().ok())).flatten();
        ReasonView { reason: x.reason, region: x.region, ids, named, factor }
    }).collect();
    let landmark_regions = self::landmark_regions(&r.record.outcome, &r.record.region_look, &reasons, boxed, seen);
    CheckView { id: r.id, subject: r.record.subject, model_id: r.model_id, outcome: r.record.outcome, shape_look: r.record.shape_look,
        region_look: r.record.region_look, present: r.record.present, size_look: r.record.size_look, cb_look: r.record.cb_look, cb_present: r.record.cb_present, reasons, resolved: r.resolved, landmark_regions, region_facing }
}
/// The film's checks, and the one shown: the newest final when it is newer than every run check; else the latest run
/// check of the model that placed most of the film's current landmarks (a tie: the model whose run is newest); else none.
pub fn view(l: &Library, case_id: &str) -> anyhow::Result<WholeFilmView> {
    if !switch_of(l)?.on { return Ok(WholeFilmView { shown: None, checks: vec![], off: true }); }
    let mut rows = l.whole_film_checks(case_id)?;
    // A final check older than the film's last sign-off, or on a film no longer signed off, is about an earlier tracing:
    // never shown, never listed. Nothing is deleted. Review I1, N1.
    // A final check belongs to a sign-off: shown only while the film is signed off and the check is at or after it (N1).
    let doc = l.load(case_id)?;
    let signed = doc.verified_at.clone();
    rows.retain(|r| r.record.subject != "final" || signed.as_deref().is_some_and(|s| r.checked_at.as_str() >= s));
    let newest_run = rows.iter().filter(|r| r.record.subject == "run").map(|r| r.id).max();
    let newest_final = rows.iter().filter(|r| r.record.subject == "final").map(|r| r.id).max();
    let shown_id = match (newest_final, newest_run) {
        (Some(f), r) if r.is_none_or(|r| f > r) => Some(f),
        _ => {
            let doc = l.load(case_id)?;
            rows.iter().filter(|r| r.record.subject == "run").filter_map(|r| {
                let m = r.model_id.as_deref()?;
                let n = doc.landmarks.iter().filter(|x| x.placed_by.as_deref() == Some(m)).count();
                (n > 0).then_some((n, r.record.run_id.unwrap_or(0), r.id))
            }).max().map(|(_, _, id)| id)
        }
    };
    let mut checks = Vec::with_capacity(rows.len());
    for r in rows { let boxed = boxed_regions(l, &r)?; let seen = seen_landmarks(l, &doc, &r)?; let facing = region_facing_found(l, &r)?; checks.push(check_view(r, &boxed, &seen, facing)); }
    Ok(WholeFilmView { shown: checks.iter().find(|c| Some(c.id) == shown_id).cloned(), checks, off: false })
}
/// `Checked` with one of the three reasons (RV-2): only this film's shown check, flagged, the film not in Recently
/// deleted. Allowed on a signed-off film (OQ-6). False when already resolved (the first reason stays).
pub(crate) fn resolve(l: &mut Library, case_id: &str, check_id: i64, reason: &str, op: &str) -> anyhow::Result<bool> {
    let why = ResolveReason::from_key(reason).ok_or_else(|| anyhow::anyhow!("{reason:?} is not one of tracing-right, expected-variant, corrected-tracing"))?;
    anyhow::ensure!(!l.is_deleted(case_id)?, "film {case_id} is in Recently deleted");
    let shown = view(l, case_id)?.shown;
    anyhow::ensure!(shown.as_ref().is_some_and(|c| c.id == check_id), "whole-film check {check_id} is not the note shown on this film");
    anyhow::ensure!(shown.is_some_and(|c| c.outcome == "flagged"), "whole-film check {check_id} is not flagged");
    l.resolve_whole_film_check(check_id, why, op)
}


// ---- The switch (owner, 5 Nov 2026: Settings › Checks, "Whole-film check (beta)") ----

/// The settings key; its value is `on` or `off`. Absent, or any other value, reads as the default.
pub const SWITCH_KEY: &str = "whole_film_check";
/// SC1-1b-PKU's counts: `caught` of `planted` plants flagged (the mark is `needed`), `flagged` of `normal` untouched films
/// flagged (the mark is at most `false_max`).
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PkuResult { pub caught: u32, pub planted: u32, pub needed: u32, pub flagged: u32, pub normal: u32, pub false_max: u32 }
/// SC1-1b-PKU's counts, from reports/sc1/sc1-1b-pku.json (SHA-256 7dd1cef60bb7ac9c9462aa731b5da8b4661afcd6e83d5ff5074f6fa27d7f212f):
/// 981 of 1,020 caught, 0 of 102 untouched films flagged. None would mean no verdict (switch off).
pub const PKU_RESULT: Option<PkuResult> = Some(PkuResult { caught: 981, planted: 1020, needed: 969, flagged: 0, normal: 102, false_max: 2 });
/// The owner's middle band (6 Nov 2026, set before PKU was opened): not a pass, but at least this many of the 1,020 caught
/// (ceil(9 x 1020 / 10)) and at most `SHIP_FALSE_MAX` of the 102 untouched flagged.
pub const SHIP_NEEDED: u32 = 918;
pub const SHIP_FALSE_MAX: u32 = 5;
/// The owner's three bands (6 Nov 2026): a pass (both marks) is on; otherwise on if at least `SHIP_NEEDED` caught and at most
/// `SHIP_FALSE_MAX` flagged; otherwise off. No result: off.
pub fn default_on(r: Option<&PkuResult>) -> bool {
    r.is_some_and(|r| (r.caught >= r.needed && r.flagged <= r.false_max) || (r.caught >= SHIP_NEEDED && r.flagged <= SHIP_FALSE_MAX))
}
fn thousands(n: u32) -> String { if n >= 1000 { format!("{},{:03}", n / 1000, n % 1000) } else { n.to_string() } }
/// The one plain line under the switch: the counts, then the band with the exact shortfall.
pub fn result_line(r: Option<&PkuResult>) -> String {
    let Some(r) = r else { return "Not yet tested on new films.".into() };
    let (short, extra) = (r.needed.saturating_sub(r.caught), r.flagged.saturating_sub(r.false_max));
    let verdict = if short == 0 && extra == 0 { "A pass.".to_string() } else {
        let mut gaps = Vec::new();
        if short > 0 { gaps.push(format!("{short} short on caught")); }
        if extra > 0 { gaps.push(format!("{extra} too many flagged")); }
        let why = if default_on(Some(r)) { format!("On, because it caught at least {SHIP_NEEDED} and flagged at most {SHIP_FALSE_MAX}.") } else {
            let mut w = Vec::new();
            if r.caught < SHIP_NEEDED { w.push(format!("caught fewer than {SHIP_NEEDED}")); }
            if r.flagged > SHIP_FALSE_MAX { w.push(format!("flagged more than {SHIP_FALSE_MAX}")); }
            format!("Off, because it {}.", w.join(" and "))
        };
        format!("Not a pass: {}. {why}", gaps.join(" and "))
    };
    format!("Tested once on {} new films (PKU, 2026): it caught {} of {} planted mistakes (needed {}) and flagged {} of {} correct tracings (at most {} allowed). {verdict}",
        r.normal, thousands(r.caught), thousands(r.planted), r.needed, r.flagged, r.normal, r.false_max)
}
/// What the Settings tab shows: whether the check is on, whether that is the default (nothing stored, or a stored value
/// other than `on`/`off`), and the result line.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeSwitch { pub on: bool, pub is_default: bool, pub line: String }
/// The stored value, else `default_on(PKU_RESULT)`. The default and the line both come from `PKU_RESULT`, nowhere else.
pub fn switch_of(l: &Library) -> anyhow::Result<WholeSwitch> {
    let line = result_line(PKU_RESULT.as_ref());
    Ok(match l.setting(SWITCH_KEY)?.as_deref() {
        Some("on") => WholeSwitch { on: true, is_default: false, line },
        Some("off") => WholeSwitch { on: false, is_default: false, line },
        _ => WholeSwitch { on: default_on(PKU_RESULT.as_ref()), is_default: true, line },
    })
}
/// Writes `on` or `off`. Deletes nothing: stored checks stay (and are shown again on switching on).
pub fn set_switch(l: &mut Library, on: bool) -> anyhow::Result<WholeSwitch> {
    l.set_setting(SWITCH_KEY, if on { "on" } else { "off" })?;
    switch_of(l)
}
#[tauri::command] pub async fn whole_film_switch(app: tauri::AppHandle) -> Result<WholeSwitch, String> {
    crate::library::with(&app, move |l, _| switch_of(l)).await
}
#[tauri::command] pub async fn whole_film_switch_set(app: tauri::AppHandle, on: bool) -> Result<WholeSwitch, String> {
    crate::library::with(&app, move |l, _| set_switch(l, on)).await
}

/// What is set up: `shape` (the tracings file loaded) and `regions`: `ready`, `no-region-model` or `not-set-up`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WholeFilmStatus { pub shape: bool, pub regions: String }
pub fn status(st: &WholeFilmState) -> WholeFilmStatus {
    let regions = match st.regions() { None => "no-region-model", Some(r) if r.calibration.is_none() => "not-set-up", Some(_) => "ready" };
    WholeFilmStatus { shape: st.shape().is_some(), regions: regions.into() }
}

/// The app's state, loaded on a blocking thread (never the async runtime's, never under the library's lock).
async fn loaded(app: &tauri::AppHandle) -> Arc<WholeFilmState> {
    let app = app.clone();
    let r = tauri::async_runtime::spawn_blocking(move || {
        use tauri::Manager;
        let st = app.state::<WholeFilmState>();
        st.ensure_loaded(|| crate::whole_film_candidates(&app));
        (st.shape(), st.regions())
    }).await;
    let (s, r) = r.unwrap_or_else(|e| { eprintln!("Whole-film check not set up: {e}"); (None, None) });
    Arc::new(WholeFilmState::with(s, r))
}
/// The input for one check of this film, as the commands make it: the state loaded; the plan and the tracing read
/// inside the library's lock (reads only); the finder run and the tracing's line fitted outside it on a blocking thread,
/// so the check under the lock reads the line from the cache. Never fails: a failure is logged and the regions read
/// `not-set-up` (a failed warm-up only means the check fits the line itself).
pub(crate) async fn prepare(app: &tauri::AppHandle, case_id: &str, tracing: Tracing) -> WholeFilmInput {
    // Switched off: no finder run, no warm-up (the check itself writes nothing, `check_and_store`).
    if !crate::library::with(app, move |l, _| switch_of(l).map(|s| s.on)).await.unwrap_or(false) {
        return WholeFilmInput { shape: None, regions: RegionInput::NotRun(Look::NotSetUp), calibration: None, size: None, cb: None, off: true };
    }
    let st = loaded(app).await;
    let (s, c) = (st.clone(), case_id.to_string());
    let (plan, warm) = crate::library::with(app, move |l, _| Ok(read_for_check(l, &c, &s, tracing))).await.unwrap_or_else(|e| {
        eprintln!("Whole-film check: the region plan failed for {case_id}: {e}"); (RegionPlan::NotRun(Look::NotSetUp), None) });
    let s = st.clone();
    tauri::async_runtime::spawn_blocking(move || outside_lock(plan, warm, &s)).await.unwrap_or_else(|e| {
        eprintln!("Whole-film check: the region finder's thread failed: {e}"); assemble(&st, RegionInput::NotRun(Look::NotSetUp)) })
}

#[tauri::command] pub async fn whole_film_check(app: tauri::AppHandle, case_id: String) -> Result<WholeFilmView, String> {
    crate::library::with(&app, move |l, _| view(l, &case_id)).await
}
#[tauri::command] pub async fn whole_film_check_resolve(app: tauri::AppHandle, case_id: String, check_id: i64, reason: String) -> Result<bool, String> {
    crate::library::with(&app, move |l, op| resolve(l, &case_id, check_id, &reason, op)).await
}
#[tauri::command] pub async fn whole_film_status(app: tauri::AppHandle) -> Result<WholeFilmStatus, String> {
    Ok(status(&*loaded(&app).await))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::point_check::PointCheckState;
    use ceph_infer::regions::{regions_manifest_path, Found, FoundBox};
    use ceph_model::pointcheck::{ShapeScorer, ORDER};
    use ceph_model::shape::Pt;
    use ceph_model::wholefilm::{teaching_boxes, Look, RegionCalibration, RegionTau, CALIBRATION_VERSION};
    use ceph_store::{AiPoint, AiRun, Library};
    use std::sync::{Arc, OnceLock};

    const W: u32 = 2400;
    const SHA: &str = "0000000000000000000000000000000000000000000000000000000000000000";
    /// A SYNTHETIC detector fingerprint (64 hex), for the stand-in `Found`s built from the face's own teaching boxes.
    const FP: &str = "5ec15ec15ec15ec15ec15ec15ec15ec15ec15ec15ec15ec15ec15ec15ec15ec1";
    /// The SYNTHETIC tiny region model's real fingerprint (crates/ceph-infer/tests/fixtures/tiny-regions.onnx).
    const TINY: &str = "3f7b76f846c897e9c43ad88295e04bca25e2d67c1edae4a262dcac00c8cf0a88";
    const AZ: &str = "aariz-cepha29";
    const GU: &str = "gu2net-isbi2015";

    fn shape() -> Arc<ShapeLoaded> {
        static S: OnceLock<Arc<ShapeLoaded>> = OnceLock::new();
        S.get_or_init(|| Arc::new(ShapeLoaded { scorer: ceph_model::wholefilm::WholeScorer::new(ceph_model::shape::synthetic_faces(120, 4)).unwrap(), sha256: SHA.into(), films: 120 })).clone()
    }
    /// Stage A's starting knowledge (so `point_checks` has rows for the nothing-moves instrument).
    fn stage_a() -> PointCheckState {
        static L: OnceLock<Arc<crate::point_check::Loaded>> = OnceLock::new();
        PointCheckState::with(Some(L.get_or_init(|| Arc::new((ShapeScorer::new(ceph_model::shape::synthetic_faces(240, 4)), SHA.to_string(), 240))).clone()))
    }
    fn cal(fp: &str) -> RegionCalibration {
        RegionCalibration { version: CALIBRATION_VERSION.into(), detector_fingerprint: fp.into(), score_line: 0.5, tau: RegionTau([0.05; 5]), gate_report_sha256: SHA.into(), rule: None }
    }
    fn face() -> Vec<Pt> { ceph_model::shape::synthetic_faces(1, 7).remove(0) }
    fn at(id: &str) -> usize { ORDER.iter().position(|x| *x == id).unwrap() }
    fn mirror(f: &[Pt]) -> Vec<Pt> { f.iter().map(|p| ((W - 1) as f64 - p.0, p.1)).collect() }
    /// The mandible's five points 40 mm (400 px at 0.1 mm/px) lower.
    fn mandible_40mm() -> Vec<Pt> { let mut f = face(); for id in ["Go", "Me", "Pog", "B", "Gn"] { f[at(id)].1 += 400.0; } f }
    fn points(f: &[Pt], leave_out: &[&str]) -> Vec<AiPoint> {
        ORDER.iter().zip(f).enumerate().filter(|(_, (id, _))| !leave_out.contains(id))
            .map(|(i, (id, p))| AiPoint { channel: i as u32, landmark_id: Some(id.to_string()), x: p.0, y: p.1, peak: 1.0 }).collect()
    }
    fn ai_run(model: &str, facing: &str) -> AiRun {
        AiRun { model_id: model.into(), execution_provider: "cpu".into(), facing: facing.into(), total_ms: 1.0, model_sha256: None }
    }
    /// A stand-in `Found`: the boxes the teaching rule draws round these points (score 1), as the region finder would give.
    fn found_for(f: &[Pt], fp: &str) -> Found {
        let named: Vec<(String, f64, f64)> = ORDER.iter().zip(f).map(|(id, p)| (id.to_string(), p.0, p.1)).collect();
        let boxes = teaching_boxes(&named, W, W).into_iter().map(|b| FoundBox { region: b.region.index(), x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, score: 1.0 }).collect();
        Found { boxes, fingerprint: fp.into(), version: "synthetic-1".into(), image_width: W, image_height: W, ms: 0.0 }
    }
    fn input(regions: RegionInput) -> WholeFilmInput { WholeFilmInput { shape: Some(shape()), regions, calibration: Some(cal(FP)), size: None, cb: None, off: false } }
    fn boxed(f: &[Pt]) -> WholeFilmInput { input(RegionInput::Found(found_for(f, FP))) }
    fn no_regions() -> WholeFilmInput { input(RegionInput::NotRun(Look::NoRegionModel)) }

    fn lib() -> (tempfile::TempDir, Library, String) {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        l.set_setting(SWITCH_KEY, "on").unwrap();          // the switch's default is off until the PKU result is in (Task D2)
        let id = film(&mut l, t.path(), "SYNTHETIC-a.png", W, W);
        (t, l, id)
    }
    fn film(l: &mut Library, dir: &std::path::Path, name: &str, w: u32, h: u32) -> String {
        let png = dir.join(name);
        let mut img = image::GrayImage::new(w, h);
        img.put_pixel(0, 0, image::Luma([name.bytes().fold(0u8, |a, b| a.wrapping_add(b))]));
        img.save(&png).unwrap();
        l.import(&png).unwrap().case_id
    }
    fn count(l: &Library, table: &str) -> i64 { l.conn_for_tests().query_row(&format!("SELECT COUNT(*) FROM {table}"), [], |r| r.get(0)).unwrap() }
    const OURS: [&str; 5] = ["film_regions", "film_region_boxes", "whole_film_checks", "whole_film_check_reasons", "whole_film_check_resolutions"];
    fn ours(l: &Library) -> [i64; 5] { OURS.map(|t| count(l, t)) }
    fn record(l: &mut Library, case: &str, model: &str, facing: &str, pts: &[AiPoint], wf: &WholeFilmInput) {
        crate::library::record_ai_and_learn_checked(l, case, &ai_run(model, facing), pts, &PointCheckState::default(), Some(wf), "Dr A", &[]).unwrap();
    }
    fn last_run(l: &Library) -> i64 { l.conn_for_tests().query_row("SELECT MAX(id) FROM ai_runs", [], |r| r.get(0)).unwrap() }
    /// The check of one run (any run, not only the latest), read straight from the table.
    fn check_of(l: &Library, case: &str, run_id: i64) -> ceph_store::WholeFilmRow {
        let id: i64 = l.conn_for_tests().query_row("SELECT id FROM whole_film_checks WHERE run_id = ?1", [run_id], |r| r.get(0)).unwrap();
        l.whole_film_checks(case).unwrap().into_iter().find(|r| r.id == id).unwrap_or_else(|| panic!("check {id} is not among the film's latest"))
    }
    fn only(l: &Library, case: &str) -> ceph_store::WholeFilmRow {
        let rows = l.whole_film_checks(case).unwrap();
        assert_eq!(rows.len(), 1, "{rows:#?}");
        rows.into_iter().next().unwrap()
    }
    fn reasons(r: &ceph_store::WholeFilmRow) -> Vec<(String, Option<String>)> { r.record.reasons.iter().map(|x| (x.reason.clone(), x.region.clone())).collect() }
    fn looks(r: &ceph_store::WholeFilmRow) -> (&str, &str, &str, i64) { (r.record.outcome.as_str(), r.record.shape_look.as_str(), r.record.region_look.as_str(), r.record.present) }
    fn lm(id: &str, p: Pt, by: Option<&str>) -> ceph_store::LandmarkRow {
        ceph_store::LandmarkRow { id: id.into(), x: p.0, y: p.1, source: if by.is_some() { "ai" } else { "manual" }.into(), verified: true,
            ai_x: by.map(|_| p.0), ai_y: by.map(|_| p.1), confidence: None, placed_by: by.map(String::from), accept_kind: None, placed_via: None }
    }
    /// Saves these landmarks, all verified; `by(i)` names who placed the i-th (None: by hand).
    fn traced(l: &mut Library, case: &str, f: &[Pt], facing: &str, by: impl Fn(usize) -> Option<&'static str>) {
        let landmarks = ORDER.iter().zip(f).enumerate().map(|(i, (id, p))| lm(id, *p, by(i))).collect();
        let e = ceph_store::CaseEdit { id: case.into(), facing: facing.into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks };
        crate::library::save_and_learn(l, &e, "Dr A").unwrap();
    }

    /// `<models>` holding the SYNTHETIC tiny region model and, when given, a calibration for that fingerprint.
    fn tiny_models(cal_fp: Option<&str>) -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        let p = regions_manifest_path(d.path());
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        let onnx = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..").join("crates").join("ceph-infer").join("tests").join("fixtures").join("tiny-regions.onnx");
        std::fs::copy(onnx, p.parent().unwrap().join("tiny-regions.onnx")).unwrap();
        let m = serde_json::json!({"manifestVersion": 2, "kind": "regions", "id": "tiny-regions", "version": "synthetic-1",
            "title": "SYNTHETIC tiny region finder", "file": "tiny-regions.onnx", "sha256": TINY,
            "input": {"name": "input", "width": 8, "height": 8, "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
            "outputs": {"boxes": "dets", "logits": "labels", "boxFormat": "cxcywh-normalised", "score": "sigmoid"},
            "classes": [{"region": "cranial-base", "logitIndex": 1}, {"region": "maxilla", "logitIndex": 2},
                        {"region": "mandible", "logitIndex": 3}, {"region": "incisors", "logitIndex": 4},
                        {"region": "soft-tissue", "logitIndex": 5}],
            "runtime": "cpu", "trainingNote": "SYNTHETIC: constants only"});
        std::fs::write(&p, serde_json::to_vec_pretty(&m).unwrap()).unwrap();
        if let Some(fp) = cal_fp {
            std::fs::write(ceph_model::wholefilm::calibration_path(d.path()), ceph_model::wholefilm::calibration_json(&cal(fp)).unwrap()).unwrap();
        }
        d
    }
    /// A state with the synthetic shape and the tiny region model loaded from a models folder.
    fn tiny(cal_fp: Option<&str>) -> (tempfile::TempDir, WholeFilmState) {
        let d = tiny_models(cal_fp);
        let regions = load_regions_with(&[Some(d.path().to_path_buf())], &Pins::open());
        (d, WholeFilmState::with(Some(shape()), regions))
    }
    fn runs(st: &WholeFilmState) -> usize { st.regions().map(|r| r.engine.runs()).unwrap_or(0) }
    /// What the commands do around the library's lock: plan inside it, find outside it, then the input.
    fn prepared(l: &Library, case: &str, st: &WholeFilmState) -> WholeFilmInput { prepared_for(l, case, st, Tracing::Final) }
    fn prepared_for(l: &Library, case: &str, st: &WholeFilmState, tracing: Tracing) -> WholeFilmInput {
        let (plan, warm) = read_for_check(l, case, st, tracing);
        outside_lock(plan, warm, st)
    }

    /// Test 1. Fails if the hook does not call the whole-film check (no row), if the found boxes are not stored, or if a
    /// second check of the same run writes again.
    #[test] fn each_new_run_is_checked_once_and_its_boxes_stored() {
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        let row = only(&l, &a);
        println!("test 1: {:?}; rows in the five tables {:?}", row.record, ours(&l));
        assert_eq!(looks(&row), ("clean", "judged", "judged", 19));
        assert_eq!((row.record.subject.as_str(), row.model_id.as_deref(), row.record.tau, row.record.rule_version.as_str()), ("run", Some(AZ), Some([0.05; 5]), "whole-film/3"));
        assert_eq!((row.record.prior_sha256.as_deref(), row.record.prior_films), (Some(SHA), Some(120)));
        assert_eq!(ours(&l), [1, 5, 1, 0, 0]);
        let (rid, rec) = l.film_regions(&a, FP).unwrap().unwrap();
        assert_eq!((row.record.region_run_id, rec.facing.as_deref(), rec.boxes.iter().filter(|b| b.found).count()), (Some(rid), Some("right"), 5));
        let before = ours(&l);
        let r = last_run(&l);
        check_run_or_log(&mut l, &a, r, &boxed(&face()));
        assert_eq!(ours(&l), before, "a second check of the same run writes nothing");
    }

    /// whole-film/3 (owner ruling, 5 Nov 2026, spec §17.15). A check stored under whole-film/2 before the change still
    /// reads, with its rule as stored, beside a new check written as whole-film/3; the film's view lists both. (The note on
    /// screen shows no rule version: it is kept in the row, and read back unchanged here.) Fails if: a new check is not
    /// written as /3, or a stored rule is rewritten or refused on read.
    #[test] fn an_older_whole_film_2_check_still_reads_as_stored() {
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        let newer = last_run(&l);
        let n = check_of(&l, &a, newer);
        // An older app's check (stored checks are never changed, so it is written as that app wrote it): another model's
        // run with no check yet, then its check stored with rule whole-film/2 through the store's own insert.
        crate::library::record_ai_and_learn_checked(&mut l, &a, &ai_run(GU, "right"), &points(&face(), &[]), &PointCheckState::default(), None, "Dr A", &[]).unwrap();
        let older = last_run(&l);
        l.record_whole_film_check(&a, &WholeFilmRecord { rule_version: "whole-film/2".into(), run_id: Some(older), ..n.record.clone() }).unwrap();
        let o = check_of(&l, &a, older);
        println!("older check: rule {}, outcome {}, looks {:?}; newer check: rule {}, outcome {}", o.record.rule_version, o.record.outcome, looks(&o), n.record.rule_version, n.record.outcome);
        assert_eq!((o.record.rule_version.as_str(), n.record.rule_version.as_str()), ("whole-film/2", "whole-film/3"));
        assert_eq!(looks(&o), looks(&n), "the older row reads in full");
        let v = view(&l, &a).unwrap();
        println!("view: {} checks, shown {:?}", v.checks.len(), v.shown.as_ref().map(|c| (c.model_id.clone(), c.outcome.clone())));
        assert_eq!(v.checks.len(), 2);
    }

    /// Every row of a table as text, sorted.
    fn rows(l: &Library, table: &str) -> Vec<String> {
        let c = l.conn_for_tests();
        let mut st = c.prepare(&format!("SELECT * FROM {table}")).unwrap();
        let n = st.column_count();
        let mut v: Vec<String> = st.query_map([], |r| Ok((0..n).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|")))
            .unwrap().map(|r| r.unwrap()).collect();
        v.sort();
        v
    }
    const UNTOUCHED: [&str; 10] = ["landmarks", "landmark_events", "ai_points", "ai_runs", "learning_record", "point_choices", "auto_best_events",
        "point_check_runs", "point_checks", "point_check_resolutions"];
    fn snapshot(l: &Library, case: &str) -> Vec<(&'static str, Vec<String>)> {
        let mut v: Vec<(&'static str, Vec<String>)> = UNTOUCHED.iter().map(|t| (*t, rows(l, t))).collect();
        // The film's whole `cases` row, every column (none is changed by a check: the sign-off's own `verified_at` is
        // written before the check runs, and `nothing_moves` calls the checks directly, outside any sign-off).
        let c = l.conn_for_tests();
        let mut st = c.prepare("SELECT * FROM cases WHERE id = ?1").unwrap();
        let n = st.column_count();
        let row: Vec<String> = st.query_map([case], |r| Ok((0..n).map(|i| format!("{:?}", r.get::<_, rusqlite::types::Value>(i).unwrap())).collect::<Vec<_>>().join("|")))
            .unwrap().map(|r| r.unwrap()).collect();
        assert_eq!(row.len(), 1, "the film's cases row");
        v.push(("cases", row));
        v
    }

    /// Test 2: nothing moves. Every row of the ten tables a check must never touch, and the film's whole `cases` row (every
    /// column), are the same before and after a run check and a final check that both flag (mandible 40 mm). The
    /// instrument says how much it compared. Positive controls: make `check_run_or_log` run `UPDATE landmarks SET x = x + 1`
    /// → this fails; make `check_final_or_log` run `UPDATE cases SET facing = 'left'` → this fails (Task 7 review minor).
    #[test] fn nothing_moves() {
        let (_t, mut l, a) = lib();
        // Stage A flags B on a first run, so point_checks has rows; then a verified tracing (landmarks, events, learning).
        let mut wild_b = face(); wild_b[at("B")].0 += 200.0;
        crate::library::record_ai_and_learn(&mut l, &a, &ai_run(AZ, "right"), &points(&wild_b, &[]), &stage_a(), "Dr A").unwrap();
        traced(&mut l, &a, &mandible_40mm(), "right", |_| Some(AZ));
        let r = l.record_ai_run(&a, &ai_run(AZ, "right"), &points(&mandible_40mm(), &[])).unwrap();
        let before = snapshot(&l, &a);
        check_run_or_log(&mut l, &a, r, &boxed(&face()));
        check_final_or_log(&mut l, &a, &boxed(&face()));
        let after = snapshot(&l, &a);
        let rows_ = l.whole_film_checks(&a).unwrap();
        println!("test 2: checks {:?}", rows_.iter().map(|r| (r.record.subject.clone(), r.record.outcome.clone(), reasons(r))).collect::<Vec<_>>());
        assert_eq!(rows_.iter().filter(|r| r.record.outcome == "flagged").count(), 2, "both checks flagged, so each had something to write");
        let sizes: Vec<(&str, usize)> = before.iter().map(|(t, v)| (*t, v.len())).collect();
        println!("test 2: rows compared per table: {sizes:?}");
        for t in ["landmarks", "ai_points", "point_checks", "cases"] {
            assert!(sizes.iter().find(|(n, _)| *n == t).unwrap().1 > 0, "the instrument compared nothing in {t}: {sizes:?}");
        }
        for ((t, b), (_, a)) in before.iter().zip(&after) { assert_eq!(b, a, "{t} changed"); }
    }

    /// Test 3: no region model. Fails if the shape look is skipped without regions, if a region run is written, or if a
    /// mirrored run is not flagged on the shape alone.
    #[test] fn without_a_region_model_the_shape_still_runs() {
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &no_regions());
        let row = only(&l, &a);
        println!("test 3, face: {:?}", row.record);
        assert_eq!(looks(&row), ("clean", "judged", "no-region-model", 19));
        assert_eq!((row.record.region_run_id, row.record.tau, count(&l, "film_regions")), (None, None, 0));
        record(&mut l, &a, AZ, "right", &points(&mirror(&face()), &[]), &no_regions());
        let row = check_of(&l, &a, last_run(&l));
        println!("test 3, mirrored: {:?}", reasons(&row));
        assert_eq!(looks(&row), ("flagged", "judged", "no-region-model", 19));
        assert_eq!(reasons(&row), [("mirrored".into(), None), ("facing".into(), None)]);
    }

    /// Test 4: nothing set up. Fails if an empty state errors (no row) or reads as judged.
    #[test] fn with_nothing_set_up_the_check_is_not_run() {
        let (_t, mut l, a) = lib();
        let wf = WholeFilmInput { shape: None, regions: RegionInput::NotRun(Look::NoRegionModel), calibration: None, size: None, cb: None, off: false };
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &wf);
        let row = only(&l, &a);
        println!("test 4: {:?}", row.record);
        assert_eq!(looks(&row), ("not-run", "not-set-up", "no-region-model", 19));
        assert_eq!((row.record.prior_sha256.as_deref(), row.record.d2, row.record.reasons.len()), (None, None, 0));
        // The status the screen reads for an empty state.
        let s = status(&WholeFilmState::with(None, None));
        println!("test 4: status {}", serde_json::to_string(&s).unwrap());
        assert_eq!(serde_json::to_string(&s).unwrap(), r#"{"shape":false,"regions":"no-region-model"}"#);
    }

    /// Test 5: a film under 256 px on its shorter side is not boxed. Fails if `plan_regions` drops the size rule (the
    /// engine is then called: its count moves).
    #[test] fn a_film_too_small_is_not_boxed() {
        let (_m, st) = tiny(Some(TINY));
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        l.set_setting(SWITCH_KEY, "on").unwrap();
        let a = film(&mut l, t.path(), "SYNTHETIC-small.png", 200, 300);
        let plan = plan_regions(&l, &a, &st).unwrap();
        println!("test 5: plan {plan:?}");
        assert!(matches!(plan, RegionPlan::NotRun(Look::FilmTooSmall)), "{plan:?}");
        let wf = assemble(&st, run_plan(plan, &st));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &wf);
        let row = only(&l, &a);
        println!("test 5: {:?}; engine calls {}", looks(&row), runs(&st));
        assert_eq!((row.record.region_look.as_str(), row.record.shape_look.as_str()), ("film-too-small", "judged"));
        assert_eq!(runs(&st), 0, "the region finder was never called");
    }

    /// Test 6: boxes found once per film and reused, also after closing and reopening. Fails if `plan_regions` ignores
    /// the stored run (the engine is called again) or if a calibration for another fingerprint is used.
    #[test] fn boxes_are_found_once_per_film_and_reused() {
        let (_m, st) = tiny(Some(TINY));
        let (t, mut l, a) = lib();
        let wf = prepared(&l, &a, &st);
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &wf);
        let plan = plan_regions(&l, &a, &st).unwrap();
        println!("test 6: second plan {plan:?}");
        assert!(matches!(plan, RegionPlan::Stored { .. }), "{plan:?}");
        let wf = assemble(&st, run_plan(plan, &st));
        record(&mut l, &a, GU, "right", &points(&face(), &[]), &wf);
        let rows_ = l.whole_film_checks(&a).unwrap();
        println!("test 6: checks {:?}; engine calls {}; region runs {}", rows_.iter().map(|r| (r.model_id.clone(), r.record.region_run_id, r.record.outcome.clone(), reasons(r))).collect::<Vec<_>>(), runs(&st), count(&l, "film_regions"));
        assert_eq!((runs(&st), count(&l, "film_regions"), rows_.len()), (1, 1, 2));
        assert!(rows_.iter().all(|r| r.record.region_look == "judged" && r.record.region_run_id == rows_[0].record.region_run_id));
        drop(l);
        let l = Library::open(t.path()).unwrap();
        let plan = plan_regions(&l, &a, &st).unwrap();
        println!("test 6: after reopening {plan:?}; engine calls {}", runs(&st));
        assert!(matches!(plan, RegionPlan::Stored { .. }) && runs(&st) == 1);
        let other = "a".repeat(64);
        let (_m2, st2) = tiny(Some(&other));
        let plan = plan_regions(&l, &a, &st2).unwrap();
        println!("test 6: a calibration for another fingerprint: calibration {:?}, plan {plan:?}, status {}", st2.regions().map(|r| r.calibration.is_some()), serde_json::to_string(&status(&st2)).unwrap());
        assert!(st2.regions().is_some_and(|r| r.calibration.is_none()));
        assert!(matches!(plan, RegionPlan::NotRun(Look::NotSetUp)), "{plan:?}");
        assert_eq!(serde_json::to_string(&status(&st2)).unwrap(), r#"{"shape":true,"regions":"not-set-up"}"#);
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"ready"}"#);
    }

    /// Test 7: a new region model (another fingerprint) re-boxes the film and the old boxes are kept. Fails if a stored
    /// run of any fingerprint is taken as this model's, or if the new run replaces the old.
    #[test] fn a_new_region_model_reboxes_the_film_and_keeps_the_old_boxes() {
        let (_m, st) = tiny(Some(TINY));
        let (_t, mut l, a) = lib();
        let old = "b".repeat(64);
        let mut f = found_for(&face(), &old);
        f.version = "synthetic-old".into();
        let rec = region_record(&f, 0.5);
        let old_id = l.record_film_regions(&a, &rec).unwrap();
        let plan = plan_regions(&l, &a, &st).unwrap();
        println!("test 7: with only the old model's boxes stored, the plan is {plan:?}");
        assert!(matches!(plan, RegionPlan::Run { .. }), "{plan:?}");
        let wf = assemble(&st, run_plan(plan, &st));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &wf);
        let (new_id, _) = l.film_regions(&a, TINY).unwrap().unwrap();
        println!("test 7: region runs {} (old {old_id}, new {new_id}); the check used {:?}", count(&l, "film_regions"), only(&l, &a).record.region_run_id);
        assert_eq!((count(&l, "film_regions"), runs(&st)), (2, 1));
        assert_eq!(l.film_regions(&a, &old).unwrap().unwrap(), (old_id, rec), "the old boxes are kept as they were");
        assert_eq!(only(&l, &a).record.region_run_id, Some(new_id));
    }

    thread_local! { static FINDER_PANICS: std::cell::Cell<bool> = const { std::cell::Cell::new(false) }; }
    /// The test seam: a region finder that panics.
    pub(super) fn finder_panic_if_injected() { if FINDER_PANICS.with(|p| p.get()) { panic!("injected panic in the region finder (test seam)"); } }

    /// Test 8: a failed check never fails the run. A mark that is not a number (infinity: the library refuses a NaN run
    /// outright, as Stage A's test 6 shows) → the run recorded, the error logged, no check row; a finder that panics → the
    /// run recorded and checked on the shape, `region_look` `not-set-up`. Fails if the hook passes the error up, or a
    /// panic in the finder escapes `run_plan`.
    #[test] fn a_failed_check_never_fails_the_run() {
        let (_t, mut l, a) = lib();
        let mut bad = points(&face(), &[]); bad[3].x = f64::INFINITY;
        let r = crate::library::record_ai_and_learn_checked(&mut l, &a, &ai_run(AZ, "right"), &bad, &PointCheckState::default(), Some(&boxed(&face())), "Dr A", &[]);
        println!("test 8 (not a number): {r:?}; runs {}, rows {:?}", count(&l, "ai_runs"), ours(&l));
        assert!(r.is_ok() && count(&l, "ai_runs") == 1 && count(&l, "whole_film_checks") == 0);
        let r = last_run(&l);
        let e = check_run(&mut l, &a, r, &boxed(&face())).unwrap_err();
        println!("test 8: the logged error: {e:#}");
        assert!(format!("{e:#}").contains("not a number"), "{e:#}");
        let (_m, st) = tiny(Some(TINY));
        let plan = plan_regions(&l, &a, &st).unwrap();
        FINDER_PANICS.with(|p| p.set(true));
        let got = run_plan(plan, &st);
        FINDER_PANICS.with(|p| p.set(false));
        println!("test 8 (finder panics): {got:?}");
        assert!(matches!(got, RegionInput::NotRun(Look::NotSetUp)), "{got:?}");
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &assemble(&st, got));
        let row = check_of(&l, &a, last_run(&l));
        println!("test 8: the run after the panic: {:?}", looks(&row));
        assert_eq!(looks(&row), ("clean", "judged", "not-set-up", 19));
        // One region run: the first (failed) check stored the film's boxes before checking (a `Found` is stored first);
        // the panicking finder stored none.
        assert_eq!((count(&l, "ai_runs"), count(&l, "film_regions")), (2, 1));
    }

    /// Task 6 review ruling: a degenerate (zero or negative size) or non-finite box (a corner or its score) is stored
    /// `found: false` with no corners, and the region run and the check are still written. Fails if such a box is stored
    /// found (the store refuses the whole run: no region run, and the check reads `not-set-up`).
    #[test] fn a_degenerate_or_non_finite_box_is_stored_not_found() {
        let (_t, mut l, a) = lib();
        let mut f = found_for(&face(), FP);
        f.boxes[1].x1 = f.boxes[1].x0;                        // maxilla: zero width
        f.boxes[2].y0 = f64::NAN;                             // mandible: a corner not a number
        f.boxes[3].score = f32::NAN;                          // incisors: a score not a number
        f.boxes[4].y1 = f.boxes[4].y0 - 5.0;                  // soft tissue: negative height
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &input(RegionInput::Found(f)));
        let (_, rec) = l.film_regions(&a, FP).unwrap().unwrap();
        for b in &rec.boxes { println!("stored box: {b:?}"); }
        assert_eq!(rec.boxes.iter().map(|b| b.found).collect::<Vec<_>>(), [true, false, false, false, false]);
        assert!(rec.boxes[1..].iter().all(|b| b.x0.is_none() && b.y0.is_none() && b.x1.is_none() && b.y1.is_none() && b.score.is_finite()));
        let row = only(&l, &a);
        println!("the check: {:?} {:?}", looks(&row), reasons(&row));
        assert_eq!((row.record.region_look.as_str(), reasons(&row)), ("judged", vec![("no-ceph-found".into(), None)]));
    }

    /// Task 6 review ruling: no check field is ever stored as NaN or infinity (SQLite binds NaN as NULL and would refuse
    /// the whole check). Fails if `to_record` lets a non-finite D², D² mirrored, line or τ through.
    #[test] fn a_number_that_is_not_finite_is_never_stored() {
        let (_t, mut l, a) = lib();
        let r = l.record_ai_run(&a, &ai_run(AZ, "right"), &points(&face(), &[])).unwrap();
        let good = ceph_model::wholefilm::check_film(Some(&shape().scorer), &marks_of(&points(&face(), &[])), false, W, W, ceph_model::wholefilm::RegionLook::NotRun(Look::NoRegionModel), &FilmCal::tau_only(&RegionTau([0.05; 5]))).unwrap();
        let ok = to_record(Subject::Run(r), &good, Some(&shape()), None, None, 0).unwrap();
        println!("finite: {ok:?}");
        for (what, v) in [("d2 NaN", f64::NAN), ("d2_mirror infinity", f64::INFINITY), ("line -infinity", f64::NEG_INFINITY)] {
            let mut bad = good.clone();
            let s = bad.shape.as_mut().unwrap();
            match what.split(' ').next().unwrap() { "d2" => s.d2 = v, "d2_mirror" => s.d2_mirror = v, _ => s.line = v }
            let e = to_record(Subject::Run(r), &bad, Some(&shape()), None, None, 0).unwrap_err();
            println!("{what}: {e:#}");
            assert!(format!("{e:#}").contains("not a finite number"), "{e:#}");
        }
        let mut c = cal(FP); c.tau.0[2] = f64::NAN;
        let mut judged = good.clone(); judged.region_look = Look::Judged;
        let e = to_record(Subject::Run(r), &judged, Some(&shape()), Some(1), Some(&c), 0).unwrap_err();
        println!("tau NaN: {e:#}");
        assert!(format!("{e:#}").contains("not a finite number"), "{e:#}");
        // Through the hook: all 19 marks on one pixel (the shape cannot be scaled) → no row, the run kept.
        let one: Vec<Pt> = vec![(1000.0, 1000.0); 19];
        record(&mut l, &a, AZ, "right", &points(&one, &[]), &no_regions());
        let r1 = last_run(&l);
        let e = check_run(&mut l, &a, r1, &no_regions());
        println!("19 marks on one pixel: {e:?}; checks {}", count(&l, "whole_film_checks"));
        let stored: Vec<(Option<f64>, Option<f64>, Option<f64>)> = l.whole_film_checks(&a).unwrap().iter().map(|r| (r.record.d2, r.record.d2_mirror, r.record.line)).collect();
        assert!(stored.iter().all(|(a, b, c)| [a, b, c].iter().all(|v| v.is_none_or(f64::is_finite))), "{stored:?}");
    }

    /// Test 9: "Mark tracing verified" checks the final tracing. Fails if `set_verified_checked` skips the final check,
    /// checks on undo, re-runs the finder for a film already boxed, or holds the sign-off when the final check flags.
    #[test] fn mark_tracing_verified_checks_the_final_tracing() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        crate::library::set_verified_checked(&mut l, &a, true, Some(&boxed(&face())), "Dr A").unwrap();
        let row = only(&l, &a);
        println!("test 9: final {:?}", row.record);
        assert_eq!((row.record.subject.as_str(), row.record.run_id, row.model_id.as_deref(), looks(&row)), ("final", None, None, ("clean", "judged", "judged", 19)));
        crate::library::set_verified_checked(&mut l, &a, false, Some(&boxed(&face())), "Dr A").unwrap();
        assert_eq!(count(&l, "whole_film_checks"), 1, "undoing the sign-off checks nothing");
        // A hand-traced film with no model run: the regions are found then, once.
        let (_m, st) = tiny(Some(TINY));
        let t2 = tempfile::tempdir().unwrap();
        let mut l2 = Library::open(t2.path()).unwrap();
        l2.set_setting(SWITCH_KEY, "on").unwrap();
        let b = film(&mut l2, t2.path(), "SYNTHETIC-b.png", W, W);
        traced(&mut l2, &b, &face(), "right", |_| None);
        for _ in 0..2 {
            let wf = prepared(&l2, &b, &st);
            crate::library::set_verified_checked(&mut l2, &b, true, Some(&wf), "Dr A").unwrap();
            crate::library::set_verified_checked(&mut l2, &b, false, None, "Dr A").unwrap();
        }
        println!("test 9: hand-traced film: finals {}, region runs {}, engine calls {}", count(&l2, "whole_film_checks"), count(&l2, "film_regions"), runs(&st));
        assert_eq!((count(&l2, "whole_film_checks"), count(&l2, "film_regions"), runs(&st)), (2, 1, 1));
        // R3: a final check that flags never holds the sign-off.
        let (_t3, mut l3, c) = lib();
        traced(&mut l3, &c, &mandible_40mm(), "right", |_| Some(AZ));
        let r = crate::library::set_verified_checked(&mut l3, &c, true, Some(&boxed(&face())), "Dr A");
        let row = only(&l3, &c);
        println!("test 9: sign-off {r:?} with the final check {} {:?}; verified_at {:?}", row.record.outcome, reasons(&row), l3.load(&c).unwrap().verified_at);
        assert!(r.is_ok() && row.record.outcome == "flagged" && l3.load(&c).unwrap().verified_at.is_some());
    }

    /// Test 10: `Checked` asks one of three reasons and stays available after sign-off (OQ-6). Fails if resolving is
    /// refused on a signed-off film, if a fourth reason is accepted, if an older run's check or a film in Recently deleted
    /// can be resolved, or if resolving twice writes twice.
    #[test] fn checked_asks_a_reason_and_stays_available_after_sign_off() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let old = check_of(&l, &a, last_run(&l)).id;
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let new = check_of(&l, &a, last_run(&l)).id;
        crate::library::set_verified_checked(&mut l, &a, true, None, "Dr A").unwrap();
        assert!(l.load(&a).unwrap().verified_at.is_some(), "signed off");
        assert_eq!(view(&l, &a).unwrap().shown.map(|c| c.id), Some(new));
        let older = l.conn_for_tests().query_row("SELECT outcome FROM whole_film_checks WHERE id = ?1", [old], |r| r.get::<_, String>(0)).unwrap();
        let e = resolve(&mut l, &a, old, "expected-variant", "Dr A");
        println!("test 10: an older run's check ({older}): {e:?}");
        assert!(e.is_err() && older == "flagged");
        let e = resolve(&mut l, &a, new, "looked-fine", "Dr A");
        println!("test 10: a fourth reason: {e:?}");
        assert!(e.is_err());
        l.delete(&a).unwrap();
        let e = resolve(&mut l, &a, new, "expected-variant", "Dr A");
        println!("test 10: in Recently deleted: {e:?}");
        assert!(e.is_err());
        l.restore(&a).unwrap();
        assert!(resolve(&mut l, &a, new, "expected-variant", "Dr A").unwrap());
        let res = view(&l, &a).unwrap().shown.unwrap().resolved.unwrap();
        println!("test 10: resolved on the signed-off film: {res:?}");
        assert_eq!((res.reason.as_str(), res.operator.as_str()), ("expected-variant", "Dr A"));
        assert!(!resolve(&mut l, &a, new, "tracing-right", "Dr B").unwrap(), "again: false, nothing changed");
        assert_eq!(view(&l, &a).unwrap().shown.unwrap().resolved.unwrap().reason, "expected-variant");
        // A clean check is not Checked.
        let (_t2, mut l2, b) = lib();
        traced(&mut l2, &b, &face(), "right", |_| Some(AZ));
        record(&mut l2, &b, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        let clean = only(&l2, &b).id;
        let e = resolve(&mut l2, &b, clean, "tracing-right", "Dr A");
        println!("test 10: a clean check: {e:?}");
        assert!(e.is_err());
    }

    /// Test 11: the note shown is the base model's run (the one that placed most of the film's points) until sign-off,
    /// then the final, then a later re-detect's. Fails if the newest run is shown regardless, or the final is not shown
    /// when newest, or a final older than a run check is still shown.
    #[test] fn the_shown_check_is_the_base_runs_until_sign_off_then_the_final() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |i| Some(if i < 15 { AZ } else { GU }));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        let az = check_of(&l, &a, last_run(&l)).id;
        record(&mut l, &a, GU, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let v = view(&l, &a).unwrap();
        println!("test 11: shown {:?}; checks {:?}", v.shown.as_ref().map(|c| (c.id, c.model_id.clone())), v.checks.iter().map(|c| (c.id, c.subject.clone(), c.model_id.clone())).collect::<Vec<_>>());
        assert_eq!(v.shown.map(|c| c.id), Some(az));
        assert_eq!(v.checks.len(), 2);
        l.set_verified(&a, true, "Dr A").unwrap();                       // a final check belongs to a sign-off (N1)
        std::thread::sleep(std::time::Duration::from_millis(15));
        check_final_or_log(&mut l, &a, &boxed(&face()));
        let v = view(&l, &a).unwrap();
        println!("test 11: after the final: shown {:?}", v.shown.as_ref().map(|c| (c.id, c.subject.clone())));
        assert_eq!(v.shown.as_ref().map(|c| c.subject.as_str()), Some("final"));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        let redetect = check_of(&l, &a, last_run(&l)).id;
        let v = view(&l, &a).unwrap();
        println!("test 11: after a re-detect: shown {:?}", v.shown.as_ref().map(|c| (c.id, c.subject.clone())));
        assert_eq!(v.shown.map(|c| c.id), Some(redetect));
        // A tie in points placed goes to the model whose run is newest.
        let (_t2, mut l2, b) = lib();
        traced(&mut l2, &b, &face(), "right", |i| if i == 18 { None } else { Some(if i % 2 == 0 { AZ } else { GU }) });
        record(&mut l2, &b, GU, "right", &points(&face(), &[]), &boxed(&face()));
        record(&mut l2, &b, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        let newest = check_of(&l2, &b, last_run(&l2)).id;
        assert_eq!(view(&l2, &b).unwrap().shown.map(|c| (c.id, c.model_id)), Some((newest, Some(AZ.to_string()))), "9 each: the newest run's model");
        // No checks: nothing shown.
        let (_t3, l3, c) = lib();
        assert_eq!(view(&l3, &c).unwrap(), WholeFilmView { shown: None, checks: vec![], off: false });
    }

    /// Test 12: what the screen reads is the same after closing and reopening, and its shape on the wire is camelCase.
    /// Fails if `view` read anything held only in memory, or a field name changes.
    #[test] fn closed_and_reopened_reads_the_same() {
        let (t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let id = check_of(&l, &a, last_run(&l)).id;
        resolve(&mut l, &a, id, "corrected-tracing", "Dr A").unwrap();
        let before = view(&l, &a).unwrap();
        drop(l);
        let l = Library::open(t.path()).unwrap();
        let after = view(&l, &a).unwrap();
        let json = serde_json::to_value(&after).unwrap();
        println!("test 12: {}", serde_json::to_string_pretty(&json).unwrap());
        assert_eq!(before, after);
        let shown = &json["shown"];
        for k in ["id", "subject", "modelId", "outcome", "shapeLook", "regionLook", "present", "reasons", "resolved"] { assert!(shown.get(k).is_some(), "{k}"); }
        let rs = shown["reasons"].as_array().unwrap();
        let region = rs.iter().find(|r| r["reason"] == "region").unwrap();
        assert_eq!(region["region"], "mandible");
        assert_eq!(region["ids"], serde_json::json!(["Me", "Pog", "B", "Gn"]));                 // Go stays inside its box (as Task 2's C3)
        assert_eq!(region["named"], serde_json::json!([]));
        assert_eq!(shown["resolved"]["reason"], "corrected-tracing");
        assert!(shown["resolved"].get("resolvedAt").is_some());
    }

    /// Test 13: a left-facing film is checked on its own facing. Fails if `facing_left` is not passed from the run
    /// (Step 4 control: always false → the left run reads mirrored).
    #[test] fn a_left_facing_film_is_checked_on_its_own_facing() {
        let (_t, mut l, a) = lib();
        let left = mirror(&face());
        record(&mut l, &a, AZ, "left", &points(&left, &[]), &boxed(&left));
        let row = check_of(&l, &a, last_run(&l));
        println!("test 13, left run on a left film: {:?} {:?}; detector facing {:?}", looks(&row), reasons(&row), l.film_regions(&a, FP).unwrap().unwrap().1.facing);
        assert_eq!((row.record.outcome.as_str(), row.record.region_look.as_str()), ("clean", "judged"));
        assert_eq!(l.film_regions(&a, FP).unwrap().unwrap().1.facing.as_deref(), Some("left"));
        let (_t2, mut l2, b) = lib();
        record(&mut l2, &b, AZ, "right", &points(&left, &[]), &boxed(&left));
        let row = check_of(&l2, &b, last_run(&l2));
        println!("test 13, the same marks stored as facing right: {:?}", reasons(&row));
        assert_eq!(reasons(&row), [("mirrored".into(), None), ("facing".into(), None)]);
    }

    /// Test 14: the habit's read sees the flag until `Checked`. Fails if the read ignores the resolution.
    #[test] fn the_habit_read_sees_the_flag_until_checked() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let open = l.unresolved_whole_film_checks(&a, AZ).unwrap();
        println!("test 14: unresolved before {:?}", open.iter().map(|r| r.id).collect::<Vec<_>>());
        assert_eq!(open.len(), 1);
        resolve(&mut l, &a, open[0].id, "corrected-tracing", "Dr A").unwrap();
        let after = l.unresolved_whole_film_checks(&a, AZ).unwrap();
        println!("test 14: after corrected-tracing {:?}", after.iter().map(|r| r.id).collect::<Vec<_>>());
        assert!(after.is_empty());
    }

    /// Loading: shape and regions from the first model folder that holds each; a calibration for another detector is
    /// not set up; nothing found leaves each part empty, and an empty state looks again. Fails if the calibration's
    /// fingerprint is not compared, or a folder without the file is taken.
    #[test] fn the_state_is_loaded_from_the_model_folders() {
        let both = tiny_models(Some(TINY));
        write_reference_file(both.path());
        let empty = tempfile::tempdir().unwrap();
        let st = WholeFilmState::unpinned();
        st.ensure_loaded(|| vec![Some(empty.path().to_path_buf())]);
        println!("nothing: {}", serde_json::to_string(&status(&st)).unwrap());
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":false,"regions":"no-region-model"}"#);
        let t0 = std::time::Instant::now();
        st.ensure_loaded(|| vec![None, Some(empty.path().to_path_buf()), Some(both.path().to_path_buf())]);
        println!("looked again: {} (load; the stored lines seeded: {} ms)", serde_json::to_string(&status(&st)).unwrap(), t0.elapsed().as_millis());
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"ready"}"#);
        assert_eq!((st.shape().unwrap().films, st.shape().unwrap().sha256.len()), (40, 64));
        st.ensure_loaded(|| panic!("a loaded state never looks again"));
        let no_cal = tiny_models(None);
        let s2 = WholeFilmState::unpinned();
        s2.ensure_loaded(|| vec![Some(no_cal.path().to_path_buf())]);
        println!("a region model and no calibration: {}", serde_json::to_string(&status(&s2)).unwrap());
        assert_eq!(serde_json::to_string(&status(&s2)).unwrap(), r#"{"shape":false,"regions":"not-set-up"}"#);
        let fixed = WholeFilmState::with(None, None);
        fixed.ensure_loaded(|| panic!("a state made with `with` never loads"));
    }

    /// SYNTHETIC `whole-film-reference/1` text: 40 tracings named ceph400:001-040 and their 20 stored lines, fitted by
    /// `WholeScorer::new` (not by the loader under test). Built once.
    fn reference_text() -> &'static String {
        static T: OnceLock<String> = OnceLock::new();
        T.get_or_init(|| {
            let tr = ceph_model::shape::synthetic_faces(40, 4);
            let s = ceph_model::wholefilm::WholeScorer::new(tr.clone()).unwrap();
            let lines: Vec<(Vec<usize>, f64)> = ceph_model::wholefilm::stored_line_sets().into_iter().map(|set| { let l = s.line_for(&set).unwrap(); (set, l) }).collect();
            let names: Vec<String> = (1..=40).map(|i| format!("ceph400:{i:03}")).collect();
            ceph_model::wholefilm::reference_json(&names, &tr, &lines).unwrap()
        })
    }
    fn write_stage_a_file(models: &std::path::Path) {
        let films: Vec<(String, Vec<Pt>)> = ceph_model::shape::synthetic_faces(300, 4).into_iter().enumerate().map(|(i, f)| (format!("{:03}", i + 1), f)).collect();
        let p = ceph_model::pointcheck::prior_path(models);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, ceph_model::pointcheck::prior_json(&films).unwrap()).unwrap();
    }
    fn write_reference_file(models: &std::path::Path) {
        let p = ceph_model::wholefilm::reference_path(models);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(&p, reference_text()).unwrap();
    }
    /// SC-1 Part 1b Task B (spec §17.4): the whole-film check's shape look loads `whole-film-reference-v1.shape`, its
    /// stored lines seeded (none fitted at load); with only Stage A's `ceph400-v1.shape` present the shape look is
    /// `not-set-up`, never a silent fall-back to the 300. A 17-point tracing's line is fitted on first use, by the
    /// warm-up outside the library's lock (its time printed). Fails if `load_shape` still reads Stage A's file, falls back
    /// to it, or refits (or ignores) the stored lines.
    #[test] fn whole_film_check_uses_the_new_file() {
        let stage_a_only = tempfile::tempdir().unwrap();
        write_stage_a_file(stage_a_only.path());
        let st = WholeFilmState::unpinned();
        st.ensure_loaded(|| vec![Some(stage_a_only.path().to_path_buf())]);
        println!("only ceph400-v1.shape: {}", serde_json::to_string(&status(&st)).unwrap());
        assert!(st.shape().is_none(), "Stage A's file is not the whole-film reference");
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &WholeFilmInput { shape: st.shape(), regions: RegionInput::NotRun(Look::NoRegionModel), calibration: None, size: None, cb: None, off: false });
        let row = only(&l, &a);
        println!("only ceph400-v1.shape, a run: {:?}", looks(&row));
        assert_eq!(looks(&row), ("not-run", "not-set-up", "no-region-model", 19));

        let both = tempfile::tempdir().unwrap();
        write_stage_a_file(both.path());
        write_reference_file(both.path());
        let st2 = WholeFilmState::unpinned();
        st2.ensure_loaded(|| vec![Some(both.path().to_path_buf())]);
        let sh = st2.shape().expect("the new file loads");
        let mut stored = ceph_model::wholefilm::stored_line_sets(); stored.sort();
        assert_eq!((sh.films, sh.sha256.as_str()), (40, ceph_model::install::sha256_bytes(reference_text().as_bytes()).as_str()));
        assert_eq!(sh.scorer.cached_line_sets(), stored, "the 20 stored lines are seeded, and nothing else is fitted at load");
        assert_eq!(sh.scorer.names()[0], "ceph400:001");
        let (_t2, mut l2, b) = lib();
        record(&mut l2, &b, AZ, "right", &points(&face(), &[]), &WholeFilmInput { shape: Some(sh.clone()), regions: RegionInput::NotRun(Look::NoRegionModel), calibration: None, size: None, cb: None, off: false });
        let row = only(&l2, &b);
        println!("with the new file, a run: {:?}, prior_films {:?}", looks(&row), row.record.prior_films);
        assert_eq!(looks(&row), ("clean", "judged", "no-region-model", 19));
        assert_eq!((row.record.prior_films, row.record.prior_sha256.as_deref()), (Some(40), Some(sh.sha256.as_str())));
        // A 17-point tracing: its set is not stored; the warm-up (outside the lock) fits it, once.
        let marks: Vec<Mark> = ORDER.iter().zip(face()).filter(|(id, _)| **id != "Po" && **id != "PNS")
            .map(|(id, p)| Mark { landmark_id: id.to_string(), x: p.0, y: p.1 }).collect();
        let t0 = std::time::Instant::now();
        warm_line(&st2, &Warm { marks, facing_left: false, img_w: W });
        println!("17 points: line fitted on first use, outside the lock, in {} ms (40 SYNTHETIC tracings)", t0.elapsed().as_millis());
        assert_eq!(sh.scorer.cached_line_sets().len(), 21);
    }

    // ---- Edge cases (brief Task 7); each prints its output ----

    #[test] fn edge_too_few_points() {
        let keep = &ORDER[..9];
        let leave: Vec<&str> = ORDER.iter().copied().filter(|x| !keep.contains(x)).collect();
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &leave), &no_regions());
        let row = only(&l, &a);
        println!("9 points, no region model: {:?}", looks(&row));
        assert_eq!(looks(&row), ("not-run", "too-few-points", "no-region-model", 9));
        let (_t2, mut l2, b) = lib();
        let mut f = face();
        f[at("S")].0 -= 900.0;                                 // S off its region, so a present point is seen to be judged
        record(&mut l2, &b, AZ, "right", &points(&f, &leave), &boxed(&face()));
        let row = only(&l2, &b);
        println!("9 points, with regions (S moved 90 mm): {:?} {:?}", looks(&row), row.record.reasons);
        assert_eq!(looks(&row), ("flagged", "too-few-points", "judged", 9));
        assert_eq!(reasons(&row), [("region".into(), Some("cranial-base".into()))]);
    }
    #[test] fn edge_a_run_without_n_is_checked_on_18() {
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &["N"]), &boxed(&face()));
        let row = only(&l, &a);
        println!("without N: {:?}", row.record);
        assert_eq!(looks(&row), ("clean", "judged", "judged", 18));
    }
    #[test] fn edge_a_run_shifted_300_px() {
        let (_t, mut l, a) = lib();
        let f: Vec<Pt> = face().iter().map(|p| (p.0 + 300.0, p.1 + 300.0)).collect();
        record(&mut l, &a, AZ, "right", &points(&f, &[]), &boxed(&face()));
        let row = only(&l, &a);
        println!("shifted 300 px: {:?}; d2 {:?} line {:?}; reasons {:?}", looks(&row), row.record.d2, row.record.line, row.record.reasons);
        assert_eq!(row.record.shape_look, "judged");
    }
    #[test] fn edge_a_model_with_15_points() {
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &["Po", "Or", "UL", "LL"]), &boxed(&face()));
        let row = only(&l, &a);
        println!("15 of 19: {:?}", looks(&row));
        assert_eq!(looks(&row), ("clean", "judged", "judged", 15));
    }
    #[test] fn edge_a_signed_off_film_is_still_checked_and_stays_signed_off() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        crate::library::set_verified_checked(&mut l, &a, true, None, "Dr A").unwrap();
        let signed = l.load(&a).unwrap().verified_at;
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let row = check_of(&l, &a, last_run(&l));
        let ok = resolve(&mut l, &a, row.id, "tracing-right", "Dr A");
        println!("signed-off film: run check {:?}; verified_at {:?} → {:?}; Checked {ok:?}", looks(&row), signed, l.load(&a).unwrap().verified_at);
        assert!(signed.is_some() && l.load(&a).unwrap().verified_at == signed && row.record.outcome == "flagged" && ok.unwrap());
    }
    #[test] fn edge_no_ceph_found() {
        let (_t, mut l, a) = lib();
        let mut f = found_for(&face(), FP);
        for b in f.boxes.iter_mut().skip(2) { b.score = 0.1; }          // two boxes above the line
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &input(RegionInput::Found(f)));
        let row = only(&l, &a);
        println!("two regions above the line: {:?} {:?}", looks(&row), reasons(&row));
        assert_eq!((row.record.region_look.as_str(), reasons(&row)), ("judged", vec![("no-ceph-found".into(), None)]));
    }
    #[test] fn edge_metre_scale() {
        let (_t, mut l, a) = lib();
        let f: Vec<Pt> = face().iter().map(|p| (p.0 * 1000.0, p.1 * 1000.0)).collect();
        record(&mut l, &a, AZ, "right", &points(&f, &[]), &boxed(&face()));
        let row = only(&l, &a);
        println!("×1000: {:?}; {:#?}", looks(&row), row.record.reasons);
        let regions: Vec<Option<String>> = row.record.reasons.iter().filter(|r| r.reason == "region").map(|r| r.region.clone()).collect();
        assert_eq!(regions, ["cranial-base", "maxilla", "mandible", "incisors", "soft-tissue"].map(|k| Some(k.to_string())));
        let off = row.record.reasons.iter().filter_map(|r| r.detail.as_deref()).flat_map(|d| d.split(',')).filter(|x| x.ends_with("=off-film")).count();
        assert_eq!(off, 19, "every point off the film");
    }
    /// A scorer of its own (its own line cache, nothing fitted yet), so a test can see what was fitted and when.
    fn fresh_shape() -> Arc<ShapeLoaded> {
        Arc::new(ShapeLoaded { scorer: ceph_model::wholefilm::WholeScorer::new(ceph_model::shape::synthetic_faces(120, 4)).unwrap(), sha256: SHA.into(), films: 120 })
    }
    const MISSING: [&str; 2] = ["Po", "PNS"];
    fn seventeen() -> Vec<usize> { (0..19).filter(|&k| !MISSING.contains(&ORDER[k])).collect() }
    fn lines(st: &WholeFilmState) -> Vec<Vec<usize>> { st.shape().unwrap().scorer.cached_line_sets() }

    /// Lock fix (Task 7 review must-fix), a model run: after `prepare`'s steps (read under the lock, then outside it), the
    /// line for the run's new present set (17 points) is already cached, so the check under the lock fits nothing. Fails
    /// if `outside_lock` does not call `warm_line` (the set is not cached before the check), or if the warm-up uses other
    /// marks than the run's. Also: the stored record is the same as a check that fitted the line under the lock.
    #[test] fn a_run_s_new_point_set_is_fitted_before_the_lock() {
        let pts = points(&mandible_40mm(), &MISSING);
        let st = WholeFilmState::with(Some(fresh_shape()), None);
        let (_t, mut l, a) = lib();
        let t0 = std::time::Instant::now();
        let wf = prepared_for(&l, &a, &st, Tracing::Run { marks: marks_of(&pts), facing_left: false });
        let warm_ms = t0.elapsed().as_millis();
        println!("lock fix, run: cached before the check {:?}", lines(&st));
        assert!(lines(&st).contains(&seventeen()), "the run's 17-point line is not fitted before the lock: {:?}", lines(&st));
        let before = lines(&st);
        let t1 = std::time::Instant::now();
        record(&mut l, &a, AZ, "right", &pts, &wf);
        let locked_ms = t1.elapsed().as_millis();
        assert_eq!(lines(&st), before, "the check under the lock fitted a line");
        // Before the fix: the same run with nothing warmed, so the check fits the line under the lock.
        let cold = WholeFilmState::with(Some(fresh_shape()), None);
        let (_t2, mut l2, b) = lib();
        let t2 = std::time::Instant::now();
        record(&mut l2, &b, AZ, "right", &pts, &assemble(&cold, RegionInput::NotRun(Look::NoRegionModel)));
        let cold_ms = t2.elapsed().as_millis();
        println!("lock fix, run: warm-up outside the lock {warm_ms} ms; under the lock {locked_ms} ms warmed vs {cold_ms} ms cold (120 SYNTHETIC tracings; whole hook)");
        let (w, c) = (only(&l, &a), only(&l2, &b));
        println!("lock fix, run: warmed {:?}", w.record);
        assert_eq!(looks(&w), ("flagged", "judged", "no-region-model", 17));
        assert_eq!(format!("{:?}", w.record), format!("{:?}", c.record), "warmed and cold checks stored different records");
    }
    /// Saves these landmarks less the ones named, all verified, by hand.
    fn traced_without(l: &mut Library, case: &str, f: &[Pt], leave: &[&str]) {
        let landmarks = ORDER.iter().zip(f).filter(|(id, _)| !leave.contains(id)).map(|(id, p)| lm(id, *p, None)).collect();
        let e = ceph_store::CaseEdit { id: case.into(), facing: "right".into(), orientation: serde_json::json!({}), display: serde_json::json!({}), landmarks };
        crate::library::save_and_learn(l, &e, "Dr A").unwrap();
    }
    /// Lock fix, the final check at sign-off: `prepare` with `Tracing::Final` reads the current landmarks (reads only) and
    /// fits their set's line before the lock is taken to sign off and check. Fails if `outside_lock` does not call
    /// `warm_line`, or if `read_for_check` warms other marks than the film's current landmarks. Also: the stored final
    /// record is the same as one whose line was fitted under the lock.
    #[test] fn the_final_check_s_point_set_is_fitted_before_the_lock() {
        let st = WholeFilmState::with(Some(fresh_shape()), None);
        let (_t, mut l, a) = lib();
        traced_without(&mut l, &a, &mandible_40mm(), &MISSING);
        let wf = prepared_for(&l, &a, &st, Tracing::Final);
        println!("lock fix, final: cached before the sign-off {:?}", lines(&st));
        assert!(lines(&st).contains(&seventeen()), "the final tracing's 17-point line is not fitted before the lock: {:?}", lines(&st));
        let before = lines(&st);
        crate::library::set_verified_checked(&mut l, &a, true, Some(&wf), "Dr A").unwrap();
        assert_eq!(lines(&st), before, "the final check under the lock fitted a line");
        let cold = WholeFilmState::with(Some(fresh_shape()), None);
        let (_t2, mut l2, b) = lib();
        traced_without(&mut l2, &b, &mandible_40mm(), &MISSING);
        crate::library::set_verified_checked(&mut l2, &b, true, Some(&assemble(&cold, RegionInput::NotRun(Look::NoRegionModel))), "Dr A").unwrap();
        let (w, c) = (only(&l, &a), only(&l2, &b));
        println!("lock fix, final: warmed {:?}", w.record);
        assert_eq!((w.record.subject.as_str(), looks(&w)), ("final", ("flagged", "judged", "no-region-model", 17)));
        assert_eq!(format!("{:?}", w.record), format!("{:?}", c.record), "warmed and cold final checks stored different records");
    }
    /// Edges of the warm-up: too few points warms nothing (and the check still reads too-few-points); no shape set up
    /// warms nothing and does not fail; a film that cannot be read warms nothing and `read_for_check` still answers.
    #[test] fn the_warm_up_s_edges() {
        let st = WholeFilmState::with(Some(fresh_shape()), None);
        let (_t, l, a) = lib();
        let few = points(&face(), &ORDER[..8]);
        let wf = prepared_for(&l, &a, &st, Tracing::Run { marks: marks_of(&few), facing_left: false });
        println!("warm edges: 11 points: cached {:?}", lines(&st));
        assert!(lines(&st).is_empty(), "11 points: nothing to fit");
        assert!(wf.shape.is_some());
        let none = WholeFilmState::with(None, None);
        let wf = prepared_for(&l, &a, &none, Tracing::Final);
        assert!(wf.shape.is_none(), "no shape: nothing warmed, nothing failed");
        let (plan, warm) = read_for_check(&l, "no-such-film", &st, Tracing::Final);
        println!("warm edges: unknown film: plan {plan:?}, warm {}", warm.is_some());
        assert!(warm.is_none());
    }
    /// Timing (Step 3): the shape check cold (a new present-point set: its line is fitted) and warm, and the region finder
    /// on the tiny model. Raises if a warm shape check takes over 50 ms.
    #[test] fn timing_of_one_check() {
        let (_m, st) = tiny(Some(TINY));
        let (_t, mut l, a) = lib();
        let leave = ["Po", "Or", "PNS"];
        let t0 = std::time::Instant::now();
        record(&mut l, &a, AZ, "right", &points(&face(), &leave), &no_regions());
        let cold = t0.elapsed().as_millis();
        let t1 = std::time::Instant::now();
        record(&mut l, &a, GU, "right", &points(&face(), &leave), &no_regions());
        let warm = t1.elapsed().as_millis();
        let t2 = std::time::Instant::now();
        let wf = prepared(&l, &a, &st);
        let finder = t2.elapsed().as_millis();
        println!("timing: shape check cold {cold} ms, warm {warm} ms (whole hook, record and learning included); region finder plan + find on the tiny model {finder} ms ({:?})", matches!(wf.regions, RegionInput::Found(_)));
        assert!(warm <= 50, "a warm shape check took {warm} ms (over 50 ms): raise it");
    }

    // ---- SC-1 Part 1b Task D2: the app stores and shows the size look and the cranial-base centre; the switch ----
    use ceph_model::wholefilm::{CbCalibration, SizeCalibration, SizeRef, CB_RULE, REGIONS, SIZE_CALIBRATION_VERSION, SIZE_RULE};
    fn size_cal(fp: &str, centre: f64, line: f64) -> SizeCalibration {
        SizeCalibration { version: SIZE_CALIBRATION_VERSION.into(), rule: SIZE_RULE.into(), detector_fingerprint: fp.into(), uses: REGIONS.to_vec(),
            refs: vec![SizeRef { regions: REGIONS.to_vec(), centre, line }], report_sha256: SHA.into() }
    }
    fn cb_cal(fp: &str, median: (f64, f64), line: f64) -> CbCalibration {
        CbCalibration { version: "cb-centre-calibration/1".into(), rule: CB_RULE.into(), detector_fingerprint: fp.into(), median, line, report_sha256: SHA.into(), ruling: None }
    }
    fn looked(regions: RegionInput, size: Option<SizeCalibration>, cb: Option<CbCalibration>) -> WholeFilmInput { WholeFilmInput { size, cb, ..input(regions) } }
    /// The face shrunk or grown about its own mean.
    fn scaled(f: &[Pt], k: f64) -> Vec<Pt> {
        let n = f.len() as f64;
        let m = (f.iter().map(|p| p.0).sum::<f64>() / n, f.iter().map(|p| p.1).sum::<f64>() / n);
        f.iter().map(|p| (m.0 + k * (p.0 - m.0), m.1 + k * (p.1 - m.1))).collect()
    }
    /// The size number q the clean face scores on its own boxes (read back from a stored record, line 10 so nothing flags).
    fn clean_q() -> f64 {
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), Some(size_cal(FP, 0.0, 10.0)), None));
        only(&l, &a).record.size.expect("size judged on the clean face").0
    }
    fn detail_of(r: &ceph_store::WholeFilmRow, reason: &str) -> Option<String> { r.record.reasons.iter().find(|x| x.reason == reason).and_then(|x| x.detail.clone()) }

    /// A SYNTHETIC film at ×0.5 gives a `size` reason with factor 0.5, stored as `factor=0.500`, with the size numbers and
    /// rule `whole-film/2`; the note's view carries the factor. Fails if: `reason_row` has no Size arm (the check errors
    /// and no row is written), `to_record` does not carry the size numbers, or `check_and_store` does not pass the
    /// calibration to `check_film`.
    #[test] fn a_half_size_tracing_stores_a_size_reason_with_its_factor() {
        let q0 = clean_q();
        let (_t, mut l, a) = lib();
        let half = scaled(&face(), 0.5);
        traced(&mut l, &a, &half, "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&half, &[]), &looked(RegionInput::Found(found_for(&face(), FP)), Some(size_cal(FP, q0, 0.09)), None));
        let row = only(&l, &a);
        println!("×0.5: {:?}; size {:?}; reasons {:?}", looks(&row), row.record.size, row.record.reasons);
        assert_eq!(detail_of(&row, "size").as_deref(), Some("factor=0.500"));
        assert_eq!((row.record.size_look.as_str(), row.record.rule_version.as_str(), row.record.outcome.as_str()), ("judged", "whole-film/3", "flagged"));
        let (q, c, ln) = row.record.size.unwrap();
        assert_eq!((c, ln), (q0, 0.09));
        assert!(((q - c).exp() - 0.5).abs() < 1e-9, "q {q} centre {c}");
        let v = view(&l, &a).unwrap();
        let sz = v.shown.unwrap().reasons.into_iter().find(|r| r.reason == "size").unwrap();
        assert_eq!(sz.factor, Some(0.5));
        // size comes after every region reason (the stored order: regions, size, facing, no-ceph)
        let keys: Vec<&str> = row.record.reasons.iter().map(|r| r.reason.as_str()).collect();
        let size_at = keys.iter().position(|k| *k == "size").unwrap();
        assert!(keys.iter().rposition(|k| *k == "region").is_none_or(|r| r < size_at), "{keys:?}");
    }
    /// The calibration of another detector reads `not-set-up`: no size numbers, no size reason, even on a film at ×0.5.
    /// Fails if the fingerprint is not compared (the half-size film then flags `size`).
    #[test] fn the_calibration_of_another_detector_leaves_the_size_look_not_set_up() {
        let (_t, mut l, a) = lib();
        let other = "9".repeat(64);
        record(&mut l, &a, AZ, "right", &points(&scaled(&face(), 0.5), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), Some(size_cal(&other, 0.0, 0.09)), Some(cb_cal(&other, (0.0, 0.0), 0.06))));
        let row = only(&l, &a);
        println!("another detector's calibrations: size {} {:?}, cb {:?}; reasons {:?}", row.record.size_look, row.record.size, row.record.cb, reasons(&row));
        assert_eq!((row.record.size_look.as_str(), row.record.size, row.record.cb), ("not-set-up", None, None));
        assert!(detail_of(&row, "size").is_none());
    }
    /// A centre flag adds `centre=<d>` (3 decimals) to the cranial-base region reason's detail; the screen's point list
    /// does not take it for a point. The distance is the stored `cb` number. Fails if `reason_row` ignores `centre`, or
    /// `check_view` lists `centre` among the points.
    #[test] fn a_centre_flag_stores_its_distance_in_the_detail() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), None, Some(cb_cal(FP, (0.0, 0.0), 0.001))));
        let row = only(&l, &a);
        let d = detail_of(&row, "region").unwrap();
        println!("centre flag: cb {:?}; region detail {d}", row.record.cb);
        let (dist, line) = row.record.cb.expect("the centre look judged");
        assert_eq!(line, 0.001);
        assert!(d.ends_with(&format!(",centre={dist:.3}")), "{d}");
        assert_eq!(reasons(&row), [("region".into(), Some("cranial-base".into()))]);
        let ids = view(&l, &a).unwrap().shown.unwrap().reasons[0].ids.clone();
        println!("ids on the screen: {ids:?}");
        assert_eq!(ids, ["S", "N", "Po", "Ar", "Or"]);
    }
    /// With the cranial base not flagged, no `centre=` is written and the numbers still store. Fails if `centre=` is
    /// written for every region reason.
    #[test] fn a_clean_centre_stores_its_numbers_and_no_detail() {
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), None, Some(cb_cal(FP, (-0.05, 0.0), 10.0))));
        let row = only(&l, &a);
        assert!(row.record.cb.is_some());
        assert!(row.record.reasons.iter().all(|r| !r.detail.as_deref().unwrap_or("").contains("centre=")), "{:?}", row.record.reasons);
    }
    /// Edge cases of the two looks, printed: no region model; a film under 256 px; a calibration missing; an incomplete
    /// tracing (18 points); fewer than 3 regions found; a left-facing film (same factor as facing right). Fails if a look
    /// is copied wrongly from the region look, or a not-judged look is stored with numbers.
    #[test] fn edge_the_new_looks_on_the_standing_cases() {
        let q0 = clean_q();
        let sz = || Some(size_cal(FP, q0, 0.09));
        let cb = || Some(cb_cal(FP, (-0.05, 0.0), 0.5));
        let show = |name: &str, r: &ceph_store::WholeFilmRow| println!("{name}: size {} {:?}, cb {:?}, present {}, reasons {:?}", r.record.size_look, r.record.size, r.record.cb, r.record.present, reasons(r));
        // no region model
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::NotRun(Look::NoRegionModel), sz(), cb()));
        let r = only(&l, &a); show("no region model", &r);
        assert_eq!((r.record.size_look.as_str(), r.record.size, r.record.cb), ("no-region-model", None, None));
        // a film under 256 px
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::NotRun(Look::FilmTooSmall), sz(), cb()));
        let r = only(&l, &a); show("film too small", &r);
        assert_eq!((r.record.size_look.as_str(), r.record.size, r.record.cb), ("film-too-small", None, None));
        // calibrations missing
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), None, None));
        let r = only(&l, &a); show("calibrations missing", &r);
        assert_eq!((r.record.size_look.as_str(), r.record.size, r.record.cb), ("not-set-up", None, None));
        // an incomplete tracing: 18 of 19
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &["Or"]), &looked(RegionInput::Found(found_for(&face(), FP)), sz(), cb()));
        let r = only(&l, &a); show("18 points (Or missing)", &r);
        assert_eq!((r.record.size_look.as_str(), r.record.size, r.record.cb, r.record.present), ("too-few", None, None, 18));
        // fewer than 3 regions found (no-ceph-found)
        let (_t, mut l, a) = lib();
        let mut f = found_for(&face(), FP);
        for b in f.boxes.iter_mut().skip(2) { b.score = 0.1; }
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::Found(f), sz(), cb()));
        let r = only(&l, &a); show("two regions found", &r);
        assert_eq!((r.record.size_look.as_str(), r.record.size, r.record.cb), ("too-few", None, None));
        assert_eq!(reasons(&r), [("no-ceph-found".into(), None)]);
        // a left-facing film: the same size number and factor as the film facing right
        let (_t, mut l, a) = lib();
        let left = mirror(&face());
        record(&mut l, &a, AZ, "left", &points(&scaled(&left, 0.5), &[]), &looked(RegionInput::Found(found_for(&left, FP)), sz(), cb()));
        let rl = only(&l, &a); show("left-facing ×0.5", &rl);
        let (_t, mut l2, b) = lib();
        record(&mut l2, &b, AZ, "right", &points(&scaled(&face(), 0.5), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), sz(), cb()));
        let rr = only(&l2, &b); show("right-facing ×0.5", &rr);
        assert_eq!(detail_of(&rl, "size"), Some("factor=0.500".into()));
        assert!((rl.record.size.unwrap().0 - rr.record.size.unwrap().0).abs() < 1e-9);
    }

    /// Records for the SYNTHETIC tiny region model: gate /4 as the pre-registered one would be, if it were for TINY.
    fn tiny_records() -> ceph_model::wholefilm::Records {
        ceph_model::wholefilm::Records { tau: [0.05; 5], fingerprint: TINY.into(), score_line: 0.5, from_gate3: "3".repeat(64), gate4_sha: "4".repeat(64),
            centre_line: 0.08, measured_line: 0.06, measured_report: "6".repeat(64), centre_sha: "8".repeat(64) }
    }
    fn gate4_cal(fp: &str) -> RegionCalibration { RegionCalibration { rule: Some("sc1-box-gate/4".into()), gate_report_sha256: "4".repeat(64), ..cal(fp) } }
    fn ruled_cb(fp: &str) -> CbCalibration {
        CbCalibration { report_sha256: "6".repeat(64), ruling: Some(ceph_model::wholefilm::CbRuling { rule: "whole-film/3".into(), measured_line: 0.06, record_sha256: "8".repeat(64) }), ..cb_cal(fp, (0.0, 0.0), 0.08) }
    }
    /// I1 (final review): the app gives a verdict ONLY with the inputs PKU tested. Each wrong file reads "not set up" for its
    /// look; the right files set it up. Fails if `load_regions_with` stops asking `check_gate4` or `check_ruled_centre`
    /// (the induced failure: drop either call and the matching rows below go red).
    #[test] fn only_the_tested_calibrations_give_a_verdict() {
        let pins = Pins::of(tiny_records(), "r");
        let load = |region: Option<RegionCalibration>, cb: Option<CbCalibration>| {
            let d = tiny_models(None);
            if let Some(c) = region { std::fs::write(ceph_model::wholefilm::calibration_path(d.path()), ceph_model::wholefilm::calibration_json(&c).unwrap()).unwrap(); }
            if let Some(c) = cb { std::fs::write(ceph_model::wholefilm::cb_calibration_path(d.path()), serde_json::to_vec(&c).unwrap()).unwrap(); }
            let r = load_regions_with(&[Some(d.path().to_path_buf())], &pins).unwrap();
            (r.calibration.is_some(), r.cb.is_some())
        };
        let gate3 = RegionCalibration { rule: Some("sc1-box-gate/3".into()), ..gate4_cal(TINY) };
        let gate1 = RegionCalibration { rule: None, ..gate4_cal(TINY) };
        let wrong_hash = RegionCalibration { gate_report_sha256: "9".repeat(64), ..gate4_cal(TINY) };
        let wrong_tau = RegionCalibration { tau: RegionTau([0.01; 5]), ..gate4_cal(TINY) };
        let measured = CbCalibration { ruling: None, line: 0.06, ..ruled_cb(TINY) };
        let line06 = CbCalibration { line: 0.06, ..ruled_cb(TINY) };
        let other_rule = CbCalibration { ruling: Some(ceph_model::wholefilm::CbRuling { rule: "whole-film/2".into(), measured_line: 0.06, record_sha256: "8".repeat(64) }), ..ruled_cb(TINY) };
        let other_record = CbCalibration { ruling: Some(ceph_model::wholefilm::CbRuling { rule: "whole-film/3".into(), measured_line: 0.06, record_sha256: "7".repeat(64) }), ..ruled_cb(TINY) };
        let got = [
            ("the right files", load(Some(gate4_cal(TINY)), Some(ruled_cb(TINY))), (true, true)),
            ("gate /3 region file", load(Some(gate3), Some(ruled_cb(TINY))), (false, true)),
            ("gate /1 region file (no rule)", load(Some(gate1), Some(ruled_cb(TINY))), (false, true)),
            ("gate /4 file with another record hash", load(Some(wrong_hash), Some(ruled_cb(TINY))), (false, true)),
            ("gate /4 file with other tau", load(Some(wrong_tau), Some(ruled_cb(TINY))), (false, true)),
            ("the measured centre file (no ruling)", load(Some(gate4_cal(TINY)), Some(measured)), (true, false)),
            ("a ruled centre file at line 0.06", load(Some(gate4_cal(TINY)), Some(line06)), (true, false)),
            ("a ruling of another rule", load(Some(gate4_cal(TINY)), Some(other_rule)), (true, false)),
            ("a ruling naming another record", load(Some(gate4_cal(TINY)), Some(other_record)), (true, false)),
            ("neither file", load(None, None), (false, false)),
        ];
        for (why, g, want) in got { println!("{why}: (regions set up, centre set up) = {g:?}"); assert_eq!(g, want, "{why}"); }
    }
    /// N1 (re-review): the size calibration is pinned like the others: the pre-registered report SHA-256 and the four regions
    /// it uses. A wrong one reads "not set up" for the size look only (regions and centre unaffected). Fails if
    /// `Pins::size_ok` stops comparing either.
    #[test] fn only_the_tested_size_calibration_gives_a_verdict() {
        let pins = Pins { size_report_sha256: Some("5".repeat(64)), ..Pins::of(tiny_records(), "r") };
        let four = ceph_model::wholefilm::size_uses();
        let good = SizeCalibration { report_sha256: "5".repeat(64), uses: four.clone(), refs: vec![SizeRef { regions: four, centre: 0.1, line: 0.09 }], ..size_cal(TINY, 0.1, 0.09) };
        let load = |size: Option<SizeCalibration>| {
            let d = tiny_models(None);
            std::fs::write(ceph_model::wholefilm::calibration_path(d.path()), ceph_model::wholefilm::calibration_json(&gate4_cal(TINY)).unwrap()).unwrap();
            std::fs::write(ceph_model::wholefilm::cb_calibration_path(d.path()), serde_json::to_vec(&ruled_cb(TINY)).unwrap()).unwrap();
            if let Some(c) = size { std::fs::write(ceph_model::wholefilm::size_calibration_path(d.path()), serde_json::to_vec(&c).unwrap()).unwrap(); }
            let r = load_regions_with(&[Some(d.path().to_path_buf())], &pins).unwrap();
            (r.calibration.is_some(), r.size.is_some(), r.cb.is_some())
        };
        let got = [
            ("the right size file", load(Some(good.clone())), (true, true, true)),
            ("another report hash", load(Some(SizeCalibration { report_sha256: "9".repeat(64), ..good.clone() })), (true, false, true)),
            ("all five regions used (report hash also differs from the pin)", load(Some(SizeCalibration { report_sha256: "5".repeat(64), ..size_cal(TINY, 0.1, 0.09) })), (true, false, true)),
            ("another detector", load(Some(SizeCalibration { detector_fingerprint: FP.into(), ..good.clone() })), (true, false, true)),
            ("no size file", load(None), (true, false, true)),
        ];
        for (why, g, want) in got { println!("{why}: (regions, size, centre) set up = {g:?}"); assert_eq!(g, want, "{why}"); }
    }
    /// The shipped size pins are the pre-registration's.
    #[test] fn the_shipped_size_pins_are_the_pre_registered_ones() {
        let pre: serde_json::Value = serde_json::from_str(include_str!("../../../../reference/sc1-1b-pku.json")).unwrap();
        assert_eq!(pre["size"]["reportSha256"], ceph_model::wholefilm::SIZE_REPORT_SHA256);
        let uses: Vec<Region> = serde_json::from_value(pre["size"]["uses"].clone()).unwrap();
        assert_eq!(uses, ceph_model::wholefilm::size_uses());
    }
    /// I1: the shape reference must be the pre-registered file (SHA-256). A synthetic reference of another hash is "not set up".
    /// Fails if `load_shape_with` stops comparing the SHA-256.
    #[test] fn only_the_tested_shape_reference_is_set_up() {
        let d = tempfile::tempdir().unwrap();
        write_reference_file(d.path());
        let sha = ceph_model::install::sha256_bytes(reference_text().as_bytes());
        let c = [Some(d.path().to_path_buf())];
        println!("the shipped pin against a synthetic reference: {:?}", load_shape(&c).map(|s| s.sha256.clone()));
        assert!(load_shape(&c).is_none(), "a reference that is not 6f0f066a…81bd is not set up");
        assert!(load_shape_with(&c, &Pins::of(tiny_records(), "0".repeat(64).as_str())).is_none());
        assert_eq!(load_shape_with(&c, &Pins::of(tiny_records(), &sha)).map(|s| s.sha256.clone()), Some(sha));
    }
    /// The shipped pins are the committed ones (the bench PKU run's): the reference hash is the pre-registered one.
    #[test] fn the_shipped_pins_are_the_pre_registered_ones() {
        let pre: serde_json::Value = serde_json::from_str(include_str!("../../../../reference/sc1-1b-pku.json")).unwrap();
        assert_eq!(pre["shape"]["referenceSha256"], ceph_model::wholefilm::REFERENCE_SHA256);
        let p = Pins::shipped();
        assert!(p.records.is_some(), "the committed records read");
        assert!(p.reference_ok(ceph_model::wholefilm::REFERENCE_SHA256).is_ok() && p.reference_ok(&"0".repeat(64)).is_err());
    }
    /// M6 (final review): the switch's 918 / 5 and the pass marks are read from the committed pre-registration, not from a
    /// copy of themselves. Fails if `SHIP_NEEDED`, `SHIP_FALSE_MAX` or a `PKU_RESULT` mark drifts from that file.
    #[test] fn the_switch_constants_are_the_pre_registered_marks() {
        let pre: serde_json::Value = serde_json::from_str(include_str!("../../../../reference/sc1-1b-pku.json")).unwrap();
        let m = &pre["marks"];
        let r = PKU_RESULT.unwrap();
        assert_eq!((m["planted"].as_u64(), m["needed"].as_u64(), m["normal"].as_u64(), m["falseAlarmMax"].as_u64()),
            (Some(r.planted as u64), Some(r.needed as u64), Some(r.normal as u64), Some(r.false_max as u64)));
        let on = pre["verdicts"]["ships"]["onBelowMarks"].as_str().expect("the ships bands are in the pre-registration");
        assert!(on.contains(&format!("caught >= {SHIP_NEEDED} of {}", r.planted)), "{on}");
        assert!(on.contains(&format!("flagged <= {SHIP_FALSE_MAX} of {}", r.normal)), "{on}");
    }

    /// The size and centre calibrations load from beside the region calibration, each only when it names the installed
    /// detector (its fingerprint); a refused file or another detector's leaves that look not set up and the other look
    /// alone. Fails if the fingerprint is not compared, a file is read from another folder, or one bad file spoils both.
    #[test] fn the_state_loads_the_size_and_centre_calibrations_beside_the_region_one() {
        let load = |size: Option<&SizeCalibration>, cb: Option<&CbCalibration>, junk_cb: bool| {
            let d = tiny_models(Some(TINY));
            if let Some(c) = size { std::fs::write(ceph_model::wholefilm::size_calibration_path(d.path()), serde_json::to_vec(c).unwrap()).unwrap(); }
            if let Some(c) = cb { std::fs::write(ceph_model::wholefilm::cb_calibration_path(d.path()), serde_json::to_vec(c).unwrap()).unwrap(); }
            if junk_cb { std::fs::write(ceph_model::wholefilm::cb_calibration_path(d.path()), b"not json").unwrap(); }
            let r = load_regions_with(&[Some(d.path().to_path_buf())], &Pins::open()).unwrap();
            (r.size.is_some(), r.cb.is_some(), r.calibration.is_some())
        };
        let (s_ok, c_ok) = (size_cal(TINY, 0.1, 0.09), cb_cal(TINY, (0.0, 0.0), 0.06));
        let (s_other, c_other) = (size_cal(FP, 0.1, 0.09), cb_cal(FP, (0.0, 0.0), 0.06));
        let got = [("both for this detector", load(Some(&s_ok), Some(&c_ok), false)), ("none present", load(None, None, false)),
            ("size for another detector", load(Some(&s_other), Some(&c_ok), false)), ("centre for another detector", load(Some(&s_ok), Some(&c_other), false)),
            ("centre file unreadable", load(Some(&s_ok), None, true))];
        for (why, g) in &got { println!("{why}: (size, centre, region calibration) = {g:?}"); }
        assert_eq!(got.iter().map(|g| g.1).collect::<Vec<_>>(), [(true, true, true), (false, false, true), (false, true, true), (true, false, true), (true, false, true)]);
    }

    // ---- D2 fix round 1 ----
    /// Review I1: the sequence switch on, sign off (a flagged final is stored), switch off, un-sign, correct the tracing,
    /// sign off again (no final written while off), switch on. The old final is OLDER than the last sign-off, so it is never
    /// shown: no note, no `Checked`, an empty CSV cell, and not in the checks list. Fails if `view` shows the newest final
    /// whatever the sign-off time (the mutant: no `verified_at` comparison).
    #[test] fn a_final_check_older_than_the_last_sign_off_is_never_shown() {
        let (_t, mut l, a) = lib();
        let nap = || std::thread::sleep(std::time::Duration::from_millis(15));
        traced(&mut l, &a, &mandible_40mm(), "right", |_| Some(AZ));
        crate::library::set_verified_checked(&mut l, &a, true, Some(&boxed(&face())), "Dr A").unwrap();
        let v = view(&l, &a).unwrap();
        println!("signed off, switch on: shown {:?}", v.shown.as_ref().map(|c| (c.subject.clone(), c.outcome.clone())));
        assert_eq!(v.shown.as_ref().map(|c| (c.subject.as_str(), c.outcome.as_str())), Some(("final", "flagged")));
        nap();
        set_switch(&mut l, false).unwrap();
        crate::library::set_verified_checked(&mut l, &a, false, None, "Dr A").unwrap();
        nap();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));                    // corrected
        nap();
        crate::library::set_verified_checked(&mut l, &a, true, Some(&boxed(&face())), "Dr A").unwrap();
        assert_eq!(ours(&l)[2], 1, "no final written while off");
        nap();
        set_switch(&mut l, true).unwrap();
        let v = view(&l, &a).unwrap();
        println!("after the corrected sign-off, switch on: shown {:?}, checks {}", v.shown.as_ref().map(|c| c.id), v.checks.len());
        assert!(v.shown.is_none(), "the old final is older than the sign-off: not shown");
        assert!(v.checks.iter().all(|c| c.subject != "final"), "and not listed");
        assert_eq!(wholeFilmCellProbe(&v), "");
        assert_eq!(ours(&l)[2], 1, "nothing deleted");
        // control: the same film signed off with the switch on stores a fresh final, which is shown
        crate::library::set_verified_checked(&mut l, &a, false, None, "Dr A").unwrap();
        nap();
        crate::library::set_verified_checked(&mut l, &a, true, Some(&boxed(&face())), "Dr A").unwrap();
        let v = view(&l, &a).unwrap();
        assert_eq!(v.shown.as_ref().map(|c| (c.subject.as_str(), c.outcome.as_str())), Some(("final", "clean")), "a final written at this sign-off is shown");
    }
    /// D2 fix round 2, N1 (ruling): a final check belongs to a sign-off. Switch on, sign off (a flagged final is written), then
    /// edit a point (the save clears the sign-off) and do not sign again: no final is shown or listed, so no note, no `Checked`,
    /// and the CSV cell is blank. Nothing is deleted; signing off again with the switch on shows a fresh final. Fails if `view`
    /// shows a final on an unsigned film (the mutant: the sign-off test only when `verified_at` is set).
    #[test] fn an_unsigned_film_shows_no_final_check() {
        let (_t, mut l, a) = lib();
        let nap = || std::thread::sleep(std::time::Duration::from_millis(15));
        traced(&mut l, &a, &mandible_40mm(), "right", |_| Some(AZ));
        crate::library::set_verified_checked(&mut l, &a, true, Some(&boxed(&face())), "Dr A").unwrap();
        assert_eq!(view(&l, &a).unwrap().shown.as_ref().map(|c| c.subject.as_str()), Some("final"));
        nap();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));                      // a point is edited: the sign-off is cleared
        assert!(l.load(&a).unwrap().verified_at.is_none(), "the edit cleared the sign-off");
        let v = view(&l, &a).unwrap();
        println!("edited, not re-signed: shown {:?}, checks {}", v.shown.as_ref().map(|c| c.id), v.checks.len());
        assert!(v.shown.is_none() && v.checks.iter().all(|c| c.subject != "final"), "an unsigned film has no current final");
        assert_eq!(ours(&l)[2], 1, "nothing deleted");
        nap();
        crate::library::set_verified_checked(&mut l, &a, true, Some(&boxed(&face())), "Dr A").unwrap();
        assert_eq!(view(&l, &a).unwrap().shown.as_ref().map(|c| (c.subject.as_str(), c.outcome.as_str())), Some(("final", "clean")), "a fresh final after re-signing is shown");
    }
    /// D2 fix round 2, N2: the stored count of traced cranial-base points separates "a point is missing" from "all five, no box".
    /// An 18-point tracing missing Me with no cranial-base box: 5. Missing N, with the box: 4. Fails if the count is a constant
    /// or counts the other points.
    #[test] fn the_cranial_base_point_count_is_stored_with_the_check() {
        let (_t, mut l, a) = lib();
        let mut f = found_for(&face(), FP);
        f.boxes.retain(|b| b.region != 0);
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&face(), &["Me"]), &looked(RegionInput::Found(f), None, Some(cb_cal(FP, (0.0, 0.0), 0.5))));
        let r = only(&l, &a);
        println!("Me missing, no box: cb_look {} cb_present {} present {}", r.record.cb_look, r.record.cb_present, r.record.present);
        assert_eq!((r.record.cb_look.as_str(), r.record.cb_present, r.record.present), ("too-few", 5, 18));
        assert_eq!(view(&l, &a).unwrap().shown.unwrap().cb_present, 5, "the screen's view carries it");
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &["N"]), &looked(RegionInput::Found(found_for(&face(), FP)), None, Some(cb_cal(FP, (0.0, 0.0), 0.5))));
        let r = only(&l, &a);
        println!("N missing, box found: cb_look {} cb_present {}", r.record.cb_look, r.record.cb_present);
        assert_eq!((r.record.cb_look.as_str(), r.record.cb_present), ("too-few", 4));
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), None, Some(cb_cal(FP, (-0.05, 0.0), 0.5))));
        assert_eq!((only(&l, &a).record.cb_look.as_str(), only(&l, &a).record.cb_present), ("judged", 5));
    }
    /// What the CSV cell would read for a view with nothing shown (the front end's rule: blank).
    #[allow(non_snake_case)] fn wholeFilmCellProbe(v: &WholeFilmView) -> &'static str { if v.off { "off" } else if v.shown.is_none() { "" } else { "shown" } }

    /// The centre look's status is stored and shown (`cb_look` on the check view): judged with the pair; a full tracing whose
    /// calibration is missing reads `not-set-up`; boxes absent, `no-region-model`. Fails if `to_record` writes a constant.
    #[test] fn the_centre_looks_status_is_stored() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), None, Some(cb_cal(FP, (-0.05, 0.0), 0.5))));
        let r = only(&l, &a);
        println!("judged: cb_look {} {:?}", r.record.cb_look, r.record.cb);
        assert_eq!((r.record.cb_look.as_str(), r.record.cb.is_some()), ("judged", true));
        assert_eq!(view(&l, &a).unwrap().shown.unwrap().cb_look, "judged");
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::Found(found_for(&face(), FP)), None, None));
        assert_eq!(only(&l, &a).record.cb_look, "not-set-up");
        let (_t, mut l, a) = lib();
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::NotRun(Look::NoRegionModel), None, Some(cb_cal(FP, (0.0, 0.0), 0.5))));
        assert_eq!(only(&l, &a).record.cb_look, "no-region-model");
        // a full tracing with no cranial-base box: too-few (the case the screen could not show before)
        let (_t, mut l, a) = lib();
        let mut f = found_for(&face(), FP);
        f.boxes.retain(|b| b.region != 0);
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &looked(RegionInput::Found(f), None, Some(cb_cal(FP, (0.0, 0.0), 0.5))));
        let r = only(&l, &a);
        println!("no cranial-base box, 19 points: cb_look {} present {}", r.record.cb_look, r.record.present);
        assert_eq!((r.record.cb_look.as_str(), r.record.present, r.record.cb), ("too-few", 19, None));
    }
    /// Review M1: an input built while the switch read off writes nothing even if the switch is ticked before the write.
    /// Fails if `check_and_store` ignores `input.off`.
    #[test] fn an_input_made_while_off_writes_nothing_even_if_the_switch_is_on_by_the_write() {
        let (_t, mut l, a) = lib();
        let off_input = WholeFilmInput { off: true, ..boxed(&face()) };
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &off_input);
        assert_eq!(ours(&l)[2], 0);
        let r = last_run(&l);
        assert_eq!(check_run(&mut l, &a, r, &boxed(&face())).unwrap(), true, "the run can still be checked later");
    }
    /// Review M2: when Task H fills `PKU_RESULT`, its four pre-registered numbers are the ruling's. Fails (then) if a typo moves the default.
    #[test] fn a_filled_in_pku_result_carries_the_pre_registered_marks() {
        let r = PKU_RESULT.expect("Task H filled PKU_RESULT from reports/sc1/sc1-1b-pku.json");
        assert_eq!((r.planted, r.needed, r.normal, r.false_max), (1020, 969, 102, 2));
    }

    // ---- the switch ----
    fn pku(caught: u32, flagged: u32) -> PkuResult { PkuResult { caught, planted: 1020, needed: 969, flagged, normal: 102, false_max: 2 } }
    /// The owner's three bands (6 Nov 2026), with every boundary. Fails if: the catch mark or the false-alarm mark is read
    /// with `<` for `<=`/`>=`, the middle band is missing (918 caught and 5 flagged would be off), or a missing result defaults on.
    #[test] fn the_default_follows_the_three_bands() {
        let cases = [
            ("pass", Some(pku(1000, 1)), true), ("pass at the edge 969/2", Some(pku(969, 2)), true),
            ("one short of a pass: 968/2 is the middle band", Some(pku(968, 2)), true), ("3 flagged: middle band", Some(pku(1000, 3)), true),
            ("middle band, both edges 918/5", Some(pku(918, 5)), true), ("917 caught: off", Some(pku(917, 5)), false),
            ("6 flagged: off", Some(pku(1000, 6)), false), ("both missed", Some(pku(900, 6)), false),
            ("918/6 off", Some(pku(918, 6)), false), ("917/0 off", Some(pku(917, 0)), false), ("nothing flagged, nothing caught", Some(pku(0, 0)), false),
            ("no result", None, false)];
        for (why, r, want) in cases { println!("{why}: default_on = {}", default_on(r.as_ref())); assert_eq!(default_on(r.as_ref()), want, "{why}"); }
    }
    /// The one line under the switch, for no result and each band. Fails if a count, the band or the shortfall wording is wrong.
    #[test] fn the_result_line_states_the_counts_and_the_band() {
        assert_eq!(result_line(None), "Not yet tested on new films.");
        let line = |c, f| result_line(Some(&pku(c, f)));
        let head = |c: &str, f: &str| format!("Tested once on 102 new films (PKU, 2026): it caught {c} of 1,020 planted mistakes (needed 969) and flagged {f} of 102 correct tracings (at most 2 allowed).");
        for (c, f, tail) in [
            (981, 0, "A pass."), (969, 2, "A pass."),
            (968, 2, "Not a pass: 1 short on caught. On, because it caught at least 918 and flagged at most 5."),
            (1000, 3, "Not a pass: 1 too many flagged. On, because it caught at least 918 and flagged at most 5."),
            (918, 5, "Not a pass: 51 short on caught and 3 too many flagged. On, because it caught at least 918 and flagged at most 5."),
            (917, 5, "Not a pass: 52 short on caught and 3 too many flagged. Off, because it caught fewer than 918."),
            (1000, 6, "Not a pass: 4 too many flagged. Off, because it flagged more than 5."),
            (900, 6, "Not a pass: 69 short on caught and 4 too many flagged. Off, because it caught fewer than 918 and flagged more than 5.")] {
            println!("{}", line(c, f));
            assert_eq!(line(c, f), format!("{} {tail}", head(&group(c), &f.to_string())));
        }
    }
    fn group(n: u32) -> String { if n >= 1000 { format!("{},{:03}", n / 1000, n % 1000) } else { n.to_string() } }
    /// What the shipped default and line are: one place. Until Task H fills `PKU_RESULT` there is none: off, and the line
    /// says so. Fails if `switch_of` reads the default from anywhere but `default_on(PKU_RESULT)` and `result_line(PKU_RESULT)`.
    #[test] fn the_shipped_default_and_line_come_from_one_result() {
        let t = tempfile::tempdir().unwrap();
        let l = Library::open(t.path()).unwrap();
        let s = switch_of(&l).unwrap();
        println!("fresh library: {s:?}");
        assert_eq!((s.on, s.is_default, s.line.as_str()), (default_on(PKU_RESULT.as_ref()), true, result_line(PKU_RESULT.as_ref()).as_str()));
        // reports/sc1/sc1-1b-pku.json (SHA-256 7dd1cef60bb7ac9c9462aa731b5da8b4661afcd6e83d5ff5074f6fa27d7f212f): caught 981, untouched flagged 0.
        assert_eq!(PKU_RESULT, Some(PkuResult { caught: 981, planted: 1020, needed: 969, flagged: 0, normal: 102, false_max: 2 }));
        assert!(s.on, "a pass ships on");
    }
    /// A value other than `on` or `off` is read as the default (and so is none). Fails if anything else counts as on.
    #[test] fn a_settings_value_other_than_on_or_off_is_read_as_the_default() {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        for v in ["yes", "ON", "1", "", "true"] {
            l.set_setting(SWITCH_KEY, v).unwrap();
            let s = switch_of(&l).unwrap();
            println!("stored {v:?}: {s:?}");
            assert_eq!((s.on, s.is_default), (default_on(PKU_RESULT.as_ref()), true), "{v:?}");
        }
        l.set_setting(SWITCH_KEY, "on").unwrap();
        assert_eq!(switch_of(&l).unwrap().on, true);
        l.set_setting(SWITCH_KEY, "off").unwrap();
        let s = switch_of(&l).unwrap();
        assert_eq!((s.on, s.is_default), (false, false));
    }
    /// Off: a run is not checked (nothing written), the final check at sign-off is not written either, and the view is
    /// `off: true, shown: null`. On again: the checks written before are shown, and new runs are checked. Nothing is
    /// ever deleted. Fails if `check_and_store` ignores the switch, `view` ignores it, or switching off removes rows.
    #[test] fn off_stops_the_check_and_the_note_and_on_brings_them_back() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let before = ours(&l);
        let shown_before = view(&l, &a).unwrap();
        assert!(shown_before.shown.is_some() && !shown_before.off);
        assert_eq!(set_switch(&mut l, false).unwrap().on, false);
        let off = view(&l, &a).unwrap();
        println!("off: shown {:?}, checks {}, off {}", off.shown.is_some(), off.checks.len(), off.off);
        assert!((off.off, off.shown.is_none(), off.checks.is_empty()) == (true, true, true));
        assert_eq!(ours(&l), before, "switching off deletes nothing");
        assert!(resolve(&mut l, &a, shown_before.shown.as_ref().unwrap().id, "tracing-right", "Dr A").is_err(), "nothing is shown, so nothing can be Checked");
        assert_eq!(set_switch(&mut l, true).unwrap().on, true);
        let on = view(&l, &a).unwrap();
        println!("on again: shown {:?}, checks {}", on.shown.as_ref().map(|c| c.id), on.checks.len());
        assert_eq!((on.off, on.shown.as_ref().map(|c| c.id)), (false, shown_before.shown.as_ref().map(|c| c.id)), "the old check is shown again");
        assert!(resolve(&mut l, &a, on.shown.as_ref().unwrap().id, "tracing-right", "Dr A").unwrap(), "and can be Checked again");
        // A run recorded while off is not checked; with the switch on again it is checked when asked.
        set_switch(&mut l, false).unwrap();
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let r = last_run(&l);
        assert_eq!(check_run(&mut l, &a, r, &boxed(&face())).unwrap(), false);
        assert_eq!(ours(&l)[2], before[2], "a run recorded while off is not checked");
        set_switch(&mut l, true).unwrap();
        assert_eq!(check_run(&mut l, &a, r, &boxed(&face())).unwrap(), true, "on again: the run is checked");
        assert_eq!(ours(&l)[2], before[2] + 1);
    }
    /// A signed-off film with the switch off: the sign-off stays, and no final check is written; its stored note is shown
    /// again on switching on, `Checked` offered (OQ-6). Fails if the final check ignores the switch.
    #[test] fn off_on_a_locked_film() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &mandible_40mm(), "right", |_| Some(AZ));
        crate::library::set_verified_checked(&mut l, &a, true, Some(&boxed(&face())), "Dr A").unwrap();
        let on = ours(&l)[2];
        assert_eq!(on, 1, "the final check, switch on");
        // off and on again with the sign-off untouched: the stored final is shown again, Checked offered
        set_switch(&mut l, false).unwrap();
        assert!(view(&l, &a).unwrap().off);
        set_switch(&mut l, true).unwrap();
        let v = view(&l, &a).unwrap().shown.unwrap();
        assert_eq!((v.subject.as_str(), v.outcome.as_str(), v.resolved.is_none()), ("final", "flagged", true));
        // off, un-sign and sign again: no second final while off; the sign-off itself is untouched
        std::thread::sleep(std::time::Duration::from_millis(15));
        set_switch(&mut l, false).unwrap();
        crate::library::set_verified_checked(&mut l, &a, false, Some(&boxed(&face())), "Dr A").unwrap();
        std::thread::sleep(std::time::Duration::from_millis(15));
        crate::library::set_verified_checked(&mut l, &a, true, Some(&boxed(&face())), "Dr A").unwrap();
        println!("off: checks {} (was {on}); verified {:?}; view off {}", ours(&l)[2], l.load(&a).unwrap().verified_at.is_some(), view(&l, &a).unwrap().off);
        assert_eq!(ours(&l)[2], on, "no second final while off");
        assert!(l.load(&a).unwrap().verified_at.is_some(), "the sign-off itself is untouched");
        // on again: the first final is older than this sign-off, so it is not shown (review I1; the full sequence is
        // `a_final_check_older_than_the_last_sign_off_is_never_shown`)
        set_switch(&mut l, true).unwrap();
        assert!(view(&l, &a).unwrap().shown.is_none());
    }
    /// Closed and reopened: the setting is kept. Fails if the switch is held in memory only.
    #[test] fn the_switch_survives_closing_and_reopening() {
        let t = tempfile::tempdir().unwrap();
        let mut l = Library::open(t.path()).unwrap();
        set_switch(&mut l, true).unwrap();
        drop(l);
        let mut l = Library::open(t.path()).unwrap();
        assert!(switch_of(&l).unwrap().on);
        set_switch(&mut l, false).unwrap();
        drop(l);
        let l = Library::open(t.path()).unwrap();
        let s = switch_of(&l).unwrap();
        println!("reopened: {s:?}");
        assert_eq!((s.on, s.is_default), (false, false));
    }

    // ---- Research switch (6 Nov 2026): each landmark's region result, read from what the check stored ----
    const ORDER_IDS: [&str; 19] = ["S","N","Po","Ar","Or","A","ANS","PNS","Go","Me","Pog","B","Gn","U1T","L1T","Sn","UL","LL","PogS"];
    fn region_of(v: &CheckView, id: &str) -> String { v.landmark_regions.iter().find(|x| x.id == id).unwrap().result.clone() }
    fn region_summary(v: &CheckView) -> Vec<(String, String)> { v.landmark_regions.iter().map(|x| (x.id.clone(), x.result.clone())).collect() }
    /// A clean full check: all 19 landmarks `fine`. Fails if `fine` is not the result of a judged, boxed, unflagged region.
    #[test] fn a_clean_full_check_reads_every_landmark_fine() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        let v = view(&l, &a).unwrap().shown.unwrap();
        println!("clean: {:?}", region_summary(&v));
        assert_eq!(v.outcome, "clean");
        assert_eq!(v.landmark_regions.len(), 19);
        assert!(v.landmark_regions.iter().all(|x| x.result == "fine"), "{:?}", v.landmark_regions);
    }
    /// The mandible 40 mm out: its five landmarks are `flagged`, the other fourteen `fine`. Fails if a flag is not carried to its region's landmarks, or spreads to other regions.
    #[test] fn a_flagged_region_marks_exactly_its_landmarks() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &mandible_40mm(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&mandible_40mm(), &[]), &boxed(&face()));
        let v = view(&l, &a).unwrap().shown.unwrap();
        println!("mandible out: {:?}", region_summary(&v));
        let flagged: Vec<&str> = v.landmark_regions.iter().filter(|x| x.result == "flagged").map(|x| x.id.as_str()).collect();
        assert_eq!(flagged, ["Go", "Me", "Pog", "B", "Gn"]);
        assert_eq!(v.landmark_regions.iter().filter(|x| x.result == "fine").count(), 14);
    }
    /// The region look did not run (no finder): all 19 `not-checked`, never `fine`. Fails if a landmark with no region judgement reads fine.
    #[test] fn a_region_look_that_did_not_run_checks_nothing() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &no_regions());
        let v = view(&l, &a).unwrap().shown.unwrap();
        println!("no finder: region look {}, {:?}", v.region_look, region_summary(&v));
        assert_eq!(v.region_look, "no-region-model");
        assert!(v.landmark_regions.iter().all(|x| x.result == "not-checked"));
    }
    /// A region the finder gave no box for is `not-checked` (its landmarks cannot be flagged, so `fine` would be untrue); the others stay `fine`.
    /// Fails if a missing box reads fine.
    #[test] fn a_region_with_no_box_is_not_checked() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        let mut f = found_for(&face(), FP);
        f.boxes.retain(|b| b.region != 3);   // no incisors box
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &input(RegionInput::Found(f)));
        let v = view(&l, &a).unwrap().shown.unwrap();
        println!("no incisors box: {:?}", region_summary(&v));
        assert_eq!(region_of(&v, "U1T"), "not-checked");
        assert_eq!(region_of(&v, "L1T"), "not-checked");
        assert_eq!(region_of(&v, "S"), "fine");
        assert_eq!(v.landmark_regions.iter().filter(|x| x.result == "not-checked").count(), 2);
    }
    /// Fewer than three regions found (`no-ceph-found`): nothing is judged, so nothing reads fine.
    #[test] fn too_few_regions_found_checks_nothing() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        let mut f = found_for(&face(), FP);
        f.boxes.retain(|b| b.region < 2);   // two boxes only
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &input(RegionInput::Found(f)));
        let v = view(&l, &a).unwrap().shown.unwrap();
        println!("two boxes: {:?} {:?}", v.reasons.iter().map(|r| r.reason.clone()).collect::<Vec<_>>(), region_summary(&v));
        assert!(v.reasons.iter().any(|r| r.reason == "no-ceph-found"));
        assert!(v.landmark_regions.iter().all(|x| x.result == "not-checked"));
    }
    /// The pure rule on a not-run check even if its region look says judged: not-checked.
    #[test] fn a_not_run_check_checks_nothing_whatever_its_look() {
        let r = landmark_regions("not-run", "judged", &[], &["cranial-base".into(), "maxilla".into(), "mandible".into(), "incisors".into(), "soft-tissue".into()], &ORDER_IDS.map(String::from));
        assert!(r.iter().all(|x| x.result == "not-checked"));
    }


    // ---- Fix round 1 (review I1, I3): only a point the stored check actually saw can read fine; facing from the stored finder facing ----
    /// Landmarks the checked run did not have (placed later by hand): `not checked`, never `fine`; the checked ones stay `fine`.
    #[test] fn a_landmark_the_checked_run_did_not_have_reads_not_checked() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |i| if ORDER[i] == "U1T" || ORDER[i] == "L1T" { None } else { Some(AZ) });   // the two incisor points were put in by hand
        record(&mut l, &a, AZ, "right", &points(&face(), &["U1T", "L1T"]), &boxed(&face()));
        let v = view(&l, &a).unwrap().shown.unwrap();
        println!("run without U1T, L1T: {:?}", region_summary(&v));
        assert_eq!(region_of(&v, "U1T"), "not-checked");
        assert_eq!(region_of(&v, "L1T"), "not-checked");
        assert_eq!(v.landmark_regions.iter().filter(|x| x.result == "fine").count(), 17);
    }
    /// A landmark moved since the run: the check judged another position, so `not checked`.
    #[test] fn a_landmark_moved_since_the_check_reads_not_checked() {
        let (_t, mut l, a) = lib();
        let mut moved = face(); moved[at("S")].0 += 25.0;
        traced(&mut l, &a, &moved, "right", |_| Some(AZ));              // the tracing now holds S 25 px from where the run put it
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        let v = view(&l, &a).unwrap().shown.unwrap();
        println!("S moved: {:?}", region_summary(&v));
        assert_eq!(region_of(&v, "S"), "not-checked");
        assert_eq!(region_of(&v, "N"), "fine");
    }
    /// The final check judged the signed-off tracing: every current landmark was seen.
    #[test] fn a_final_check_saw_every_current_landmark() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        let input = boxed(&face());
        check_final(&mut l, &a, &input).unwrap();
        let v = view_ignoring_sign_off(&l, &a);
        println!("final: {:?}", v.as_ref().map(|c| (c.subject.clone(), c.landmark_regions.iter().filter(|x| x.result == "fine").count())));
        let c = v.expect("a final check");
        assert_eq!(c.subject, "final");
        assert_eq!(c.landmark_regions.iter().filter(|x| x.result == "fine").count(), 19);
    }
    fn view_ignoring_sign_off(l: &Library, a: &str) -> Option<CheckView> {
        // the film is not signed off here, so `view` hides a final check; read it straight from the stored row with the same derivation
        let row = l.whole_film_checks(a).unwrap().into_iter().find(|r| r.record.subject == "final")?;
        let doc = l.load(a).unwrap();
        let seen = seen_landmarks(l, &doc, &row).unwrap();
        let boxed = boxed_regions(l, &row).unwrap();
        let facing = region_facing_found(l, &row).unwrap();
        Some(check_view(row, &boxed, &seen, facing))
    }
    /// The finder's facing is stored with its run: `region_facing` is true when it gave one, false when the cranial-base or soft-tissue box is missing.
    #[test] fn the_view_carries_whether_the_finder_gave_a_facing() {
        let (_t, mut l, a) = lib();
        traced(&mut l, &a, &face(), "right", |_| Some(AZ));
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &boxed(&face()));
        assert!(view(&l, &a).unwrap().shown.unwrap().region_facing, "all five boxes: a facing");
        let (_t2, mut l2, b) = lib();
        traced(&mut l2, &b, &face(), "right", |_| Some(AZ));
        let mut f = found_for(&face(), FP);
        f.boxes.retain(|x| x.region != 4);              // no soft-tissue box: 4 regions found, no facing
        record(&mut l2, &b, AZ, "right", &points(&face(), &[]), &input(RegionInput::Found(f)));
        let v = view(&l2, &b).unwrap().shown.unwrap();
        println!("no soft-tissue box: region look {}, facing found {}", v.region_look, v.region_facing);
        assert_eq!(v.region_look, "judged");
        assert!(!v.region_facing);
    }

    // ---- The check's files inside the app (6 Nov 2026): resources/check, looked in after the user's own folders ----

    /// The bundled folder as the source tree holds it: the app's resource folder is `src-tauri` here, so this is
    /// `apps/desktop/src-tauri/resources/check` (the layout of a models folder: regions/ and shape/).
    fn bundled() -> PathBuf { crate::model_dir::bundled_check_dir(std::path::Path::new(env!("CARGO_MANIFEST_DIR"))) }
    /// The real region finder for the tests (1.2.1: no longer inside the app): `<repo>/target/check-finder`, a models-layout
    /// folder holding `regions/model.onnx` and `regions/manifest.json`, put there (git-ignored, SHA-256 checked) by
    /// `bash scripts/fetch-check-model.sh`.
    fn test_finder() -> PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("..").join("..").join("..").join("target").join("check-finder")
    }
    /// Missing: these tests FAIL, unless CEPHTRACE_NO_CHECK_FINDER=1 says this machine cannot have it (a CI test job), and
    /// then only the finder's part is left out, with the reason printed.
    fn finder_here() -> bool {
        if regions_manifest_path(&test_finder()).is_file() && test_finder().join("regions").join("model.onnx").is_file() { return true; }
        if std::env::var("CEPHTRACE_NO_CHECK_FINDER").as_deref() == Ok("1") {
            eprintln!("SKIPPED (the finder's part): {} has no region finder and CEPHTRACE_NO_CHECK_FINDER=1", test_finder().display());
            return false;
        }
        panic!("{} has no region finder (model.onnx and manifest.json): run bash scripts/fetch-check-model.sh, or set CEPHTRACE_NO_CHECK_FINDER=1 where it cannot be fetched", test_finder().display());
    }
    /// A copy of the bundled folder (its three calibrations and the shape reference; hard-linked, or copied when it cannot be).
    fn bundled_copy() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        fn copy(from: &std::path::Path, to: &std::path::Path) {
            std::fs::create_dir_all(to).unwrap();
            for e in std::fs::read_dir(from).unwrap().flatten() {
                let (f, t) = (e.path(), to.join(e.file_name()));
                if f.is_dir() { copy(&f, &t) } else if std::fs::hard_link(&f, &t).is_err() { std::fs::copy(&f, &t).unwrap(); }
            }
        }
        copy(&bundled(), d.path());
        d
    }
    /// The folders a fresh app looks in: the user's own (all empty here), then the bundled one.
    fn fresh(user: &std::path::Path, bundle: &std::path::Path) -> Vec<Option<PathBuf>> {
        crate::model_dir::with_bundled(crate::model_dir::candidates(None, None, Some(user.to_path_buf()), None), Some(bundle.to_path_buf()))
    }
    /// Rewrites one file of a copied bundle (its text, changed by `f`), never the bundled original; panics if `f` changed nothing.
    fn edit(dir: &std::path::Path, rel: &[&str], f: impl Fn(&str) -> String) {
        let p = rel.iter().fold(dir.to_path_buf(), |p, r| p.join(r));
        let old = std::fs::read_to_string(&p).unwrap();
        let t = f(&old);
        assert_ne!(t, old, "{}: the edit changed nothing", p.display());
        std::fs::remove_file(&p).unwrap();                        // break a hard link first: the original stays as it was
        std::fs::write(&p, t).unwrap();
    }

    /// The test finder's two files hard-linked (or copied) into `<dir>/regions`, beside whatever is there.
    fn link_finder_into(dir: &std::path::Path) {
        let to = dir.join("regions");
        std::fs::create_dir_all(&to).unwrap();
        for f in ["manifest.json", "model.onnx"] {
            let from = test_finder().join("regions").join(f);
            if std::fs::hard_link(&from, to.join(f)).is_err() { std::fs::copy(&from, to.join(f)).unwrap(); }
        }
    }
    /// A user's models folder holding only the downloaded finder (`regions/model.onnx` and `regions/manifest.json`), as
    /// the 1.2.1 install leaves it: no calibrations beside it.
    fn finder_only() -> tempfile::TempDir { let d = tempfile::tempdir().unwrap(); link_finder_into(d.path()); d }
    /// Every row of a table as `column=value` text, sorted, for comparing two libraries: the film's id (a fresh uuid per
    /// library) reads `<film>`, and the clock columns (`*_at`) are left out. Returns the rows and the columns left out.
    fn rows_comparable(l: &Library, table: &str, film: &str) -> (Vec<String>, Vec<String>) {
        let c = l.conn_for_tests();
        let mut st = c.prepare(&format!("SELECT * FROM {table}")).unwrap();
        let names: Vec<String> = st.column_names().into_iter().map(String::from).collect();
        let keep: Vec<usize> = (0..names.len()).filter(|i| !names[*i].ends_with("_at")).collect();
        let dropped = names.iter().filter(|n| n.ends_with("_at")).cloned().collect();
        let mut v: Vec<String> = st.query_map([], |r| Ok(keep.iter().map(|i| {
            let x = format!("{:?}", r.get::<_, rusqlite::types::Value>(*i).unwrap());
            format!("{}={}", names[*i], x.replace(film, "<film>"))
        }).collect::<Vec<_>>().join("|"))).unwrap().map(|r| r.unwrap()).collect();
        v.sort();
        (v, dropped)
    }

    /// The bundled files are the pre-registered ones (1.2.1: four, no finder): each calibration passes the app's own pins
    /// (gate /4's record, the ruled centre at 0.08, the size report's SHA-256 and regions) and the reference has SHA-256
    /// 6f0f066a…81bd. When the test finder is here, it passes the finder pins (its manifest names the record's detector,
    /// and its manifest.json is 0e5cfb0a…7d2a). Fails if a bundled file is missing or another, or the finder pins refuse
    /// the published finder.
    #[test] fn the_bundled_check_files_pass_the_apps_pins() {
        let pins = Pins::shipped();
        let fp = ceph_model::wholefilm::records().unwrap().fingerprint;
        let b = bundled();
        let read = |p: PathBuf| std::fs::read(&p).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
        pins.region_ok(&ceph_model::wholefilm::parse_calibration(&read(ceph_model::wholefilm::calibration_path(&b))).unwrap(), &fp).unwrap();
        pins.centre_ok(&ceph_model::wholefilm::parse_cb_calibration(&read(ceph_model::wholefilm::cb_calibration_path(&b))).unwrap(), &fp).unwrap();
        pins.size_ok(&ceph_model::wholefilm::parse_size_calibration(&read(ceph_model::wholefilm::size_calibration_path(&b))).unwrap(), &fp).unwrap();
        let empty = tempfile::tempdir().unwrap();
        let sh = load_shape_with(&fresh(empty.path(), &b), &pins).expect("the bundled reference loads with the shipped pins");
        println!("bundled reference: {} tracings, sha256 {}", sh.films, sh.sha256);
        assert_eq!((sh.sha256.as_str(), sh.films), (ceph_model::wholefilm::REFERENCE_SHA256, 1000));
        assert!(!regions_manifest_path(&b).exists(), "the app carries no finder (1.2.1)");
        if finder_here() {
            let m = regions_manifest_path(&test_finder());
            let v: serde_json::Value = serde_json::from_slice(&read(m.clone())).unwrap();
            assert_eq!(v["sha256"].as_str(), Some(fp.as_str()), "the published finder is the pinned detector");
            pins.finder_ok(&m).unwrap();
            println!("the published finder passes the finder pins");
        }
    }

    /// The update from 1.2.0 (and a new user): no finder anywhere, the real bundle. The shape look still runs and the
    /// region look reads no-region-model; a check stores the shape judged and the regions not run. Fails if the bundle
    /// is not looked in for the shape, or a verdict on the regions is given without a finder.
    /// 1.2.1 Task 5: an install changes what a fresh load would find, so the loaded finder must be dropped. The state
    /// first loads WITH a finder (in folder A), so `regions` is Some; the finder then "moves" to folder B (what an install
    /// does to the folder list's content). Without `forget_regions` the stale Some is kept and A's copy is used.
    #[test] fn after_install_the_next_check_loads_the_finder() {
        if !finder_here() { return; }
        let a = finder_only();
        let b = tempfile::tempdir().unwrap();
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(a.path(), &bundled()));
        let first = st.regions().expect("loaded from folder A");
        link_finder_into(b.path());                                         // what the install does
        st.ensure_loaded(|| fresh(b.path(), &bundled()));
        assert!(Arc::ptr_eq(&first, &st.regions().unwrap()), "a loaded part is never searched again, so far");
        st.forget_regions();
        assert!(st.regions().is_none(), "dropped at once");
        st.ensure_loaded(|| fresh(b.path(), &bundled()));
        let now = st.regions().expect("loaded again");
        assert!(!Arc::ptr_eq(&first, &now), "a fresh load, not the old copy");
        println!("after install: {}", serde_json::to_string(&status(&st)).unwrap());
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"ready"}"#);
    }
    #[test] fn after_remove_the_finder_is_dropped() {
        if !finder_here() { return; }
        let user = finder_only();
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        let held = st.regions().unwrap();                                   // a check mid-way keeps its copy
        std::fs::remove_dir_all(user.path().join("regions")).unwrap();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        assert!(st.regions().is_some(), "without forgetting, the removed finder is still in use");
        st.forget_regions();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        println!("after remove: {}", serde_json::to_string(&status(&st)).unwrap());
        assert!(st.regions().is_none());
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"no-region-model"}"#);
        assert!(held.calibration.is_some(), "the held copy is still whole");
    }
    #[test] fn forgetting_the_finder_on_a_fixed_state_changes_nothing() {
        let st = WholeFilmState::with(None, None);
        st.forget_regions();
        assert!(st.regions().is_none() && st.shape().is_none());
        if !finder_here() { return; }
        let user = finder_only();
        let loaded = WholeFilmState::default();
        loaded.ensure_loaded(|| fresh(user.path(), &bundled()));
        let held = loaded.regions().unwrap();
        let fixed = WholeFilmState::with(loaded.shape(), Some(held.clone()));
        fixed.forget_regions();
        assert!(Arc::ptr_eq(&held, &fixed.regions().unwrap()), "a fixed state keeps its finder");
        println!("fixed state after forget: finder kept");
    }
    #[test] fn without_a_finder_the_shape_still_runs_and_regions_read_no_region_model() {
        let user = tempfile::tempdir().unwrap();
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        println!("no finder: {}", serde_json::to_string(&status(&st)).unwrap());
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"no-region-model"}"#);
        let (_t, mut l, a) = lib();
        let wf = prepared(&l, &a, &st);
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &wf);
        let row = only(&l, &a);
        println!("stored: {:?}", looks(&row));
        assert_eq!((row.record.shape_look.as_str(), row.record.region_look.as_str(), row.record.rule_version.as_str()), ("judged", "no-region-model", "whole-film/3"));
    }

    /// THE KEY TEST (1.2.1). The finder in the user's folder, the calibrations inside the app: a whole-film/3 verdict, the
    /// finder read from the user's folder and the three calibrations from the app's. Fails under the old "one folder"
    /// rule (it reads not-set-up), or if the calibrations are taken from anywhere else.
    #[test] fn a_downloaded_finder_pairs_with_the_bundled_calibrations() {
        if !finder_here() { return; }
        let user = finder_only();
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        println!("paired: {}", serde_json::to_string(&status(&st)).unwrap());
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"ready"}"#);
        let r = st.regions().unwrap();
        assert!(r.size.is_some() && r.cb.is_some(), "the size and centre looks are set up");
        println!("finder from {}, calibrations from {}", r.finder_dir.display(), r.calibration_dir.display());
        assert_eq!((r.finder_dir.clone(), r.calibration_dir.clone()), (user.path().join("regions"), bundled().join("regions")));
        let (_t, mut l, a) = lib();
        let wf = prepared(&l, &a, &st);
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &wf);
        let row = only(&l, &a);
        println!("verdict: {:?}; reasons {:?}; finder runs {}", looks(&row), reasons(&row), runs(&st));
        assert_eq!(runs(&st), 1, "the downloaded finder ran on the film");
        assert_eq!((row.record.shape_look.as_str(), row.record.region_look.as_str(), row.record.rule_version.as_str()), ("judged", "judged", "whole-film/3"));
    }

    /// No verdict moves: the same SYNTHETIC films, checked once with one complete folder (a 1.2.0-style set) and once with
    /// the finder in the user's folder paired with the app's calibrations, store identical rows in all five of the check's
    /// tables (the film's id and the clock columns aside). The instrument says how many rows it compared. Fails if pairing
    /// changes any stored number, box, reason or look.
    #[test] fn a_paired_verdict_equals_the_single_folder_verdict() {
        if !finder_here() { return; }
        let whole = bundled_copy(); link_finder_into(whole.path());
        let user = finder_only();
        let mut seen = Vec::new();
        let mut cals = Vec::new();
        for (how, cands) in [("one folder", vec![Some(whole.path().to_path_buf())]), ("paired", fresh(user.path(), &bundled()))] {
            let st = WholeFilmState::default();
            st.ensure_loaded(|| cands.clone());
            let r = st.regions().unwrap();
            cals.push((r.calibration.clone(), r.size.clone(), r.cb.clone()));
            println!("{how}: {} (finder {}, calibrations {}, provider {})", serde_json::to_string(&status(&st)).unwrap(), r.finder_dir.display(), r.calibration_dir.display(), r.engine.provider());
            let (_t, mut l, a) = lib();
            for (f, facing) in [(face(), "right"), (mirror(&face()), "right"), (mandible_40mm(), "right")] {
                let wf = prepared(&l, &a, &st);
                record(&mut l, &a, AZ, facing, &points(&f, &[]), &wf);
            }
            let mut all = Vec::new();
            for t in OURS { let (rows, dropped) = rows_comparable(&l, t, &a); println!("  {t}: {} rows (left out: {dropped:?})", rows.len()); all.extend(rows.into_iter().map(|r| format!("{t}: {r}"))); }
            seen.push(all);
        }
        println!("rows compared: {} and {}", seen[0].len(), seen[1].len());
        for r in seen[0].iter().filter(|r| r.starts_with("whole_film_checks") || r.starts_with("film_region_boxes")) { println!("  {r}"); }
        assert!(seen[0].len() >= 3 + 5, "compared nothing: at least three checks and one film's five boxes");
        assert_eq!(seen[0], seen[1]);
        // The values the size and centre looks use, which the rows cannot show on these films (both read too-few).
        assert!(cals[0].0.is_some() && cals[0].1.is_some() && cals[0].2.is_some(), "all three set up");
        assert_eq!(cals[0], cals[1], "the calibration, size and centre calibrations are the same values either way");
    }

    /// Positive control for the manifest pin: one byte changed in manifest.json (still valid JSON, the ONNX and its
    /// SHA-256 field unchanged, so the finder itself still loads) is never paired: regions read no-region-model.
    #[test] fn a_finder_with_a_changed_manifest_is_not_paired() {
        if !finder_here() { return; }
        let user = finder_only();
        edit(user.path(), &["regions", "manifest.json"], |t| t.replacen('{', "{ ", 1));
        assert!(RegionEngine::load(&regions_manifest_path(user.path())).is_ok(), "the changed manifest still loads as a finder");
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        println!("changed manifest: {}", serde_json::to_string(&status(&st)).unwrap());
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"no-region-model"}"#);
    }

    /// 1.2.1 Task 7: "a finder is found" for the one-time question = a finder passing the finder pins in ANY candidate folder.
    #[test] fn a_finder_is_found_when_any_folder_holds_a_pinned_one() {
        if !finder_here() { return; }
        let none = tempfile::tempdir().unwrap();
        let (user, stray) = (finder_only(), tempfile::tempdir().unwrap());
        let found = |c: Vec<Option<PathBuf>>| finder_pinned_in(&c);
        println!("nothing: {}", found(fresh(none.path(), &bundled())));
        assert!(!found(fresh(none.path(), &bundled())), "no finder anywhere (the app holds none): ask");
        assert!(found(fresh(user.path(), &bundled())), "in the user's folder");
        link_finder_into(stray.path());                                    // a stray 1.2.0 build: the finder in its bundled folder
        assert!(found(fresh(none.path(), stray.path())), "only in the bundled folder of a stray 1.2.0 build: found, no question");
        assert!(!found(vec![None, Some(none.path().to_path_buf())]));
        let changed = finder_only();
        edit(changed.path(), &["regions", "manifest.json"], |t| t.replacen('{', "{ ", 1));
        assert!(!found(fresh(changed.path(), &bundled())), "a finder whose manifest is not the pinned one is not a finder");
        let no_onnx = finder_only(); std::fs::remove_file(no_onnx.path().join("regions").join("model.onnx")).unwrap();
        assert!(!found(fresh(no_onnx.path(), &bundled())), "a manifest without its model.onnx is not a finder");
        assert!(found(vec![Some(changed.path().to_path_buf()), Some(user.path().to_path_buf())]), "a good one in a later folder counts");
        println!("finder_pinned_in: user {}, stray {}, changed {}", true, true, false);
    }
    /// Review I1: a folder holding the real ONNX, an EDITED manifest and the three pinned calibrations is a complete set by
    /// the old rule, but its manifest is not the pinned file, so it must give no verdict. Fails if step 1 skips the finder pins.
    #[test] fn a_complete_one_folder_set_with_a_changed_manifest_gives_no_verdict() {
        if !finder_here() { return; }
        let whole = bundled_copy(); link_finder_into(whole.path());
        let st = WholeFilmState::default();
        st.ensure_loaded(|| vec![Some(whole.path().to_path_buf())]);
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"ready"}"#, "control: the unedited folder is accepted");
        edit(whole.path(), &["regions", "manifest.json"], |t| t.replacen('{', "{ ", 1));
        assert!(RegionEngine::load(&regions_manifest_path(whole.path())).is_ok(), "the edited manifest still loads as a finder");
        let st = WholeFilmState::default();
        st.ensure_loaded(|| vec![Some(whole.path().to_path_buf())]);
        println!("complete set, edited manifest: {}", serde_json::to_string(&status(&st)).unwrap());
        assert!(st.regions().is_none(), "no verdict from an unpinned manifest");
    }
    /// The calibrations come as one folder's set, never pieced together. Two copies of the app's folder, A with its size
    /// file and B with its centre file naming another detector; the finder only in the user's folder. No folder's set is
    /// whole, so nothing pairs; the most-set-up folder's own set is used (A's, 2 of 3, the first), never A's centre with
    /// B's size. Fails if a size from one folder and a centre from another are used together.
    #[test] fn calibrations_are_never_split_across_folders() {
        if !finder_here() { return; }
        let user = finder_only();
        let (a, b) = (bundled_copy(), bundled_copy());
        edit(a.path(), &["regions", "size-calibration.json"], |t| t.replacen("17171e68", "27171e68", 1));
        edit(b.path(), &["regions", "cb-centre-calibration.json"], |t| t.replacen("17171e68", "27171e68", 1));
        let st = WholeFilmState::default();
        st.ensure_loaded(|| vec![Some(user.path().to_path_buf()), Some(a.path().to_path_buf()), Some(b.path().to_path_buf())]);
        let r = st.regions().unwrap();
        println!("split: {}; calibrations from {} (region {}, size {}, centre {})", serde_json::to_string(&status(&st)).unwrap(), r.calibration_dir.display(), r.calibration.is_some(), r.size.is_some(), r.cb.is_some());
        assert_eq!(r.finder_dir, user.path().join("regions"));
        assert_eq!(r.calibration_dir, a.path().join("regions"), "the first most-set-up folder's own set");
        assert!(r.calibration.is_some() && r.size.is_none() && r.cb.is_some(), "A's own set, 2 of 3; B's size is never used with A's centre");
    }

    /// Today's rule, step 1, unchanged: a complete set in the user's folder is used alone, even with the app's set present.
    #[test] fn a_complete_user_set_still_wins_over_pairing() {
        if !finder_here() { return; }
        let user = bundled_copy(); link_finder_into(user.path());
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        let r = st.regions().unwrap();
        println!("complete user set: {}; finder {}, calibrations {}", serde_json::to_string(&status(&st)).unwrap(), r.finder_dir.display(), r.calibration_dir.display());
        assert_eq!((r.finder_dir.clone(), r.calibration_dir.clone()), (user.path().join("regions"), user.path().join("regions")));
    }

    /// Induced failures on a copy of the bundle, with the finder in the user's folder: each file changed in turn makes only
    /// its own look read not set up (the region calibration: regions not-set-up; the size or centre file: that look None;
    /// the reference: shape not set up). Never a verdict from a changed file. Fails if a changed file is still accepted.
    #[test] fn a_changed_bundled_file_reads_not_set_up_for_its_look() {
        let user = tempfile::tempdir().unwrap();
        let c = bundled_copy();
        edit(c.path(), &["shape", "whole-film-reference-v1.shape"], |t| t.replacen("95.9", "96.0", 1));
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), c.path()));
        println!("reference changed: shape {}", st.shape().is_some());
        assert!(st.shape().is_none(), "a changed reference is refused");
        if !finder_here() { return; }
        let user = finder_only();
        let cases: [(&str, &[&str], fn(&RegionLoaded) -> bool); 3] = [
            ("the region calibration", &["regions", "calibration.json"], |r| r.calibration.is_none() && r.size.is_some() && r.cb.is_some()),
            ("the size calibration", &["regions", "size-calibration.json"], |r| r.calibration.is_some() && r.size.is_none() && r.cb.is_some()),
            ("the centre calibration", &["regions", "cb-centre-calibration.json"], |r| r.calibration.is_some() && r.size.is_some() && r.cb.is_none()),
        ];
        for (what, rel, only_that) in cases {
            let c = bundled_copy();
            edit(c.path(), rel, |t| t.replacen("17171e68", "27171e68", 1));
            let st = WholeFilmState::default();
            st.ensure_loaded(|| fresh(user.path(), c.path()));
            let r = st.regions().expect("the finder still loads");
            println!("{what} changed: {} (calibration {}, size {}, centre {}; from {})", serde_json::to_string(&status(&st)).unwrap(), r.calibration.is_some(), r.size.is_some(), r.cb.is_some(), r.calibration_dir.display());
            assert!(only_that(&r), "{what}: only its own look is not set up");
            assert_eq!(r.calibration_dir, c.path().join("regions"), "{what}: the app's own set, as one");
        }
    }

    /// The user's own folder is looked in first and wins when its set passes the pins; a user set that does not (here a
    /// region calibration with another τ) is passed over: its finder pairs with the app's set, never with its own other
    /// files; and with no app folder a wrong user set still reads not set up. The same for the shape reference. Fails if
    /// the app's folder is looked in first, a refused user file is used, or a user's calibration is mixed with the app's.
    #[test] fn the_users_own_files_win_and_a_wrong_one_falls_back_to_the_bundled_set() {
        let other_user = bundled_copy();
        edit(other_user.path(), &["shape", "whole-film-reference-v1.shape"], |t| t.replacen("95.9", "96.0", 1));
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(other_user.path(), &bundled()));
        assert_eq!(st.shape().unwrap().sha256, ceph_model::wholefilm::REFERENCE_SHA256, "a refused user reference falls back to the bundled one");
        let st = WholeFilmState::default();
        st.ensure_loaded(|| vec![Some(other_user.path().to_path_buf())]);
        assert!(st.shape().is_none(), "no bundled folder: the refused user reference reads not set up");
        if !finder_here() { return; }
        let user = bundled_copy(); link_finder_into(user.path());
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        assert_eq!(st.regions().unwrap().calibration_dir, user.path().join("regions"), "a user set that passes the pins wins");
        edit(user.path(), &["regions", "calibration.json"], |t| t.replacen("0.02", "0.03", 1));
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), &bundled()));
        let r = st.regions().unwrap();
        println!("a wrong user calibration: finder {}, calibrations {} ({})", r.finder_dir.display(), r.calibration_dir.display(), serde_json::to_string(&status(&st)).unwrap());
        assert_eq!((r.finder_dir.clone(), r.calibration_dir.clone()), (user.path().join("regions"), bundled().join("regions")), "passed over for the bundled set");
        assert!(r.calibration.is_some() && r.size.is_some() && r.cb.is_some());
        let st = WholeFilmState::default();
        st.ensure_loaded(|| vec![Some(user.path().to_path_buf())]);
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"not-set-up"}"#, "no bundled folder: the wrong user set reads not set up");
    }

    /// Edge cases of the pairing, each printed: the finder only in the folder remembered by "Locate model…" (pairs); the
    /// finder in two folders, the first with a changed manifest (the second is used); the records unreadable (nothing is
    /// paired and nothing set up). Fails if any of these pairs differently.
    #[test] fn pairing_edges() {
        if !finder_here() { return; }
        let empty = tempfile::tempdir().unwrap();
        let located = finder_only();
        let st = WholeFilmState::default();
        st.ensure_loaded(|| crate::model_dir::with_bundled(crate::model_dir::candidates(None, Some(located.path().to_path_buf()), Some(empty.path().to_path_buf()), None), Some(bundled())));
        let r = st.regions().unwrap();
        println!("finder only in the Locate model folder: {}; finder {}", serde_json::to_string(&status(&st)).unwrap(), r.finder_dir.display());
        assert_eq!((status(&st).regions.as_str(), r.finder_dir.clone(), r.calibration_dir.clone()), ("ready", located.path().join("regions"), bundled().join("regions")));

        let bad = finder_only();
        edit(bad.path(), &["regions", "manifest.json"], |t| t.replacen('{', "{ ", 1));
        let good = finder_only();
        let st = WholeFilmState::default();
        st.ensure_loaded(|| vec![Some(bad.path().to_path_buf()), Some(good.path().to_path_buf()), Some(bundled())]);
        let r = st.regions().unwrap();
        println!("finder in two folders, the first changed: {}; finder {}", serde_json::to_string(&status(&st)).unwrap(), r.finder_dir.display());
        assert_eq!((status(&st).regions.as_str(), r.finder_dir.clone()), ("ready", good.path().join("regions")));

        let unreadable = Pins::from_records(Err(anyhow::anyhow!("SYNTHETIC: the records cannot be read")));
        let got = load_regions_with(&fresh(good.path(), &bundled()), &unreadable);
        println!("records unreadable: {:?}", got.as_ref().map(|r| (r.calibration.is_some(), r.size.is_some(), r.cb.is_some())));
        assert!(got.as_ref().is_none_or(|r| r.calibration.is_none() && r.size.is_none() && r.cb.is_none()), "nothing accepted");
    }

    /// Smoke check of a BUILT app (run by hand, ignored otherwise): CEPHTRACE_BUILT_RESOURCES=<OpenCephAI.app/Contents/Resources>
    /// is the resource folder the app resolves at run time; the same lookup the app makes finds the four files there, pairs
    /// them with the test finder as the user's download, and gives a verdict. Fails if the built app's resources lack a file,
    /// still carry a finder, or the lookup path differs from where Tauri put them.
    #[test] #[ignore] fn the_built_apps_resources_give_a_verdict() {
        let res = PathBuf::from(std::env::var("CEPHTRACE_BUILT_RESOURCES").expect("set CEPHTRACE_BUILT_RESOURCES to <app>/Contents/Resources"));
        let b = crate::model_dir::bundled_check_dir(&res);
        assert!(finder_here(), "the test finder is needed: bash scripts/fetch-check-model.sh");
        let user = finder_only();
        let st = WholeFilmState::default();
        st.ensure_loaded(|| fresh(user.path(), &b));
        println!("built app {}: {}", b.display(), serde_json::to_string(&status(&st)).unwrap());
        assert_eq!(serde_json::to_string(&status(&st)).unwrap(), r#"{"shape":true,"regions":"ready"}"#);
        let r = st.regions().unwrap();
        assert!(r.size.is_some() && r.cb.is_some());
        assert_eq!((r.finder_dir.clone(), r.calibration_dir.clone()), (user.path().join("regions"), b.join("regions")));
        assert!(!regions_manifest_path(&b).exists(), "the built app carries no finder (1.2.1)");
        let (_t, mut l, a) = lib();
        let wf = prepared(&l, &a, &st);
        record(&mut l, &a, AZ, "right", &points(&face(), &[]), &wf);
        let row = only(&l, &a);
        println!("built app verdict: {:?}", looks(&row));
        assert_eq!((row.record.shape_look.as_str(), row.record.region_look.as_str()), ("judged", "judged"));
    }
}
