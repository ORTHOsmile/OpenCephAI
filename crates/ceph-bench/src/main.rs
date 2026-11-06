use ceph_bench::{run, run_orient, BenchConfig, PARITY_MAX_PX};
use clap::{CommandFactory, FromArgMatches, Parser};
use std::path::{Path, PathBuf};

/// MRE/SDR benchmark on Ceph-Biometrics-400 using the same ceph-infer pipeline the app ships.
#[derive(Parser)]
struct Args {
    #[arg(long, default_value = "data/ceph400")] data: PathBuf,
    /// Any split name the dataset's splits.json has, or "all"
    #[arg(long, default_value = "test1")] split: String,
    /// One manifest, or several separated by commas (one report per model in <out>/<model id>)
    #[arg(long, default_value = "models/manifest.json")] manifest: PathBuf,
    /// Output folder, e.g. reports/2026-09-26 (gitignored). Not used by --shape-prior.
    #[arg(long, required_unless_present_any = ["shape_prior", "stage_a_acceptance", "sc1_split", "sc1_teaching_boxes", "sc1_box_gate", "sc1_region_probe", "sc1_box_gate_2", "sc1_box_gate_3", "sc1_size_calibrate", "sc1_cb_calibrate", "sc1_1a", "sc1_1b_dev", "sc1_1b_dev_decompose", "sc1_1b_dev3", "sc1_whole_film_3", "pku_prepare", "sc1_reference", "sc1_reference_lines", "sc1_1b_pku"])] out: Option<PathBuf>,
    /// Python reference predictions.csv; exit non-zero if any point differs by more than 0.5 px
    #[arg(long)] parity: Option<PathBuf>,
    /// Check automatic facing instead: every film as-is must read as facing right and mirrored as facing left
    #[arg(long)] orient: bool,
    /// Append this model's per-point scores (the shape Task 6 reads) to this JSON file
    #[arg(long = "scores-out")] scores_out: Option<PathBuf>,
    /// With --scores-out: clean, leaked or home-ground for this model on this split (spec 2026-10-13 §7)
    #[arg(long)] leakage: Option<String>,
    /// Debug instrument: run each film as-is AND mirrored (points mapped back) and print aggregates only (facing,
    /// film size/aspect/spacing buckets). Writes no scores and no per-film rows.
    #[arg(long = "diag-facing")] diag_facing: bool,
    /// With --diag-facing: positive control — mirror every film and its ground truth first, so every film faces left.
    #[arg(long = "diag-flip-control")] diag_flip_control: bool,
    /// With --diag-facing: head-size control — centre every film on a black canvas this many times as wide and high
    /// (ground truth shifted), so the head fills less of the frame. 1.0 = unchanged.
    #[arg(long = "diag-pad-control")] diag_pad_control: Option<f64>,
    /// With --diag-facing: ORACLE re-framing — scale and shift every film (using its ground-truth S and N) so the head
    /// sits where it sits in a median ISBI film, on an ISBI-sized canvas. Diagnosis only: real films have no truth.
    #[arg(long = "diag-reframe-control")] diag_reframe_control: bool,
    /// No model: print the pixel scale each selected film gets (Aariz: rule aariz-scale/1, its used / excluded / flagged
    /// counts) and the ground-truth S–N spread, scored and as-is. Aggregates only; writes nothing.
    #[arg(long = "scale-check")] scale_check: bool,
    /// Decide the per-point source table (spec 2026-10-13 §5.2) from an earlier run's predictions; no model is run
    #[arg(long = "decide-source")] decide_source: bool,
    /// --decide-source: folder holding aariz-cepha29/predictions.csv and cwlachap-hrnet-w32/predictions.csv
    #[arg(long)] runs: Option<PathBuf>,
    /// --decide-source: where the table goes (reference/main-point-source.json)
    #[arg(long = "source-out")] source_out: Option<PathBuf>,
    /// Run every --manifest model once per film and cache guesses and spreads (spec 2026-10-13 §7)
    #[arg(long = "crosscheck-run")] crosscheck_run: bool,
    /// Switched off (owner PARK-FLAGS, 15 Oct 2026: the test films stay closed); always refused. Was: the single test
    /// run of Task 8 on a held-back set, recorded in reference/aariz-test-ledger.json
    #[arg(long = "single-test-run")] single_test_run: bool,
    /// Tune on a cache (prereg rule); Aariz valid only
    #[arg(long = "crosscheck-tune")] crosscheck_tune: bool,
    /// The cache folder written by --crosscheck-run
    #[arg(long)] cache: Option<PathBuf>,
    /// The per-point source table (reference/main-point-source.json)
    #[arg(long, default_value = "reference/main-point-source.json")] source: PathBuf,
    /// With --crosscheck-run: compare the cache with Task 4's points-bits.csv in this folder (one subfolder per model)
    #[arg(long = "check-bits")] check_bits: Option<PathBuf>,
    /// Prove a chain stage on Ceph-400 (chain spec §6): "s1". Reads the caches named by --cache (comma-separated, each made
    /// by --crosscheck-run on an allowed split); writes <out>/chain-proof-s1.json. Nothing in the app reads it.
    #[arg(long = "chain-proof")] chain_proof: Option<String>,
    /// With --chain-proof s1 only: POST-HOC (owner 27 Oct, not pre-registered); cannot change the S1 result. Re-runs only
    /// P1.3 and its control with this many pretend clinicians (the same seed and pre-registration otherwise) and writes
    /// <out>/posthoc-p13-<N>.json; never chain-proof-s1.json. Reports shares with Wilson 95% intervals, never a pass.
    #[arg(long = "posthoc-clinicians")] posthoc_clinicians: Option<usize>,
    /// Stage A: write the point check's starting knowledge (the 300 Ceph-400 Train and Test1 tracings' point
    /// coordinates; no film, no image; Test2 never read) to this file, under the git-ignored models folder, e.g.
    /// models/shape/ceph400-v1.shape. Runs alone. Prints the film count, the coordinates checked and the SHA-256.
    #[arg(long = "shape-prior")] shape_prior: Option<PathBuf>,
    /// Stage A Task 10: the pre-registered acceptance of the app's point check on public films
    /// (reference/point-check-app-acceptance.json). Needs --cache <train cache>,<test1 cache> (FT-2's caches) and the
    /// starting-knowledge file under models/. Runs alone; writes reports/stage-a-acceptance/acceptance.json. Exit 0 pass,
    /// 3 fail, 1 broken.
    #[arg(long = "stage-a-acceptance")] stage_a_acceptance: bool,
    /// SC-1 Part 1: split Aariz TRAIN 80/10/10 by the pinned seed and write the split file here (a git-ignored folder, e.g.
    /// reports/sc1/sc1-aariz-split.json). Needs --data <the Aariz folder>. Runs alone. Prints counts and the SHA-256.
    #[arg(long = "sc1-split")] sc1_split: Option<PathBuf>,
    /// SC-1 Part 1: write the teaching boxes (COCO, each film and its mirror image) for the split in
    /// reference/sc1-aariz-split.json into this folder (outside the repo or git-ignored): <dir>/train (teach) and <dir>/valid
    /// (hold-out). Ignores --split (always Aariz train); an explicit --split other than train is refused. Runs alone.
    #[arg(long = "sc1-teaching-boxes")] sc1_teaching_boxes: Option<PathBuf>,
    /// SC-1 Part 1: the region finder's faithfulness on the Aariz train hold-out: the app's runtime (ONNX Runtime CPU fp32,
    /// models/regions/manifest.json) against the PyTorch reference in --pytorch (pytorch-boxes.json), every box corner
    /// within 0.5 px and the same region label. Needs --data <the Aariz folder>, --split-file, --boxes (the box cache
    /// root, e.g. reports/sc1/boxes) and --out (writes <out>/faithfulness.json). Runs alone. Exit 0 pass, 3 fail, 1 broken.
    #[arg(long = "sc1-faithfulness")] sc1_faithfulness: bool,
    /// The SC-1 split file (--sc1-faithfulness), e.g. reference/sc1-aariz-split.json.
    #[arg(long = "split-file")] split_file: Option<PathBuf>,
    /// The region finder's box cache root (--sc1-faithfulness), outside the repo or git-ignored.
    #[arg(long)] boxes: Option<PathBuf>,
    /// The PyTorch reference boxes, pytorch-boxes.json (--sc1-faithfulness).
    #[arg(long)] pytorch: Option<PathBuf>,
    /// SC-1 Part 1 Task 10: the box-quality gate (reference/sc1-box-gate.json, pre-registered) on the Aariz-train hold-out,
    /// through the app's region finder (models/regions), with the information table on Ceph-400 test1 (--ceph400) and Aariz
    /// valid. Needs --data <the Aariz folder> and a passed reports/sc1/faithfulness/faithfulness.json for the same model.
    /// Runs alone; writes reports/sc1/box-gate.json and, on a pass only, models/regions/calibration.json. Exit 0 pass,
    /// 4 stop (to the owner; SC1-1a does not run), 1 broken.
    #[arg(long = "sc1-box-gate")] sc1_box_gate: bool,
    /// SC-1 Part 1, before SC1-1a (owner, 5 Nov 2026): the region false-alarm probe (reference/sc1-region-probe.json,
    /// pre-registered) on Ceph-400 train 001-150 (--ceph400) and the Aariz-train hold-out (--data <the Aariz folder>),
    /// through the app's region path with the pinned calibration. Ceph-400 test1, Aariz valid, Test2 and Aariz test are
    /// refused. Runs alone; writes reports/sc1/region-probe.json. Exit 0 keep tau (at most 3 of 150 flagged), 3 to the
    /// owner, 1 broken.
    #[arg(long = "sc1-region-probe")] sc1_region_probe: bool,
    /// SC-1 Part 1, the box gate's second version (owner, 5 Nov 2026, "Set from both sets"; reference/sc1-box-gate-2.json,
    /// pre-registered): /1's gate, score line and C9 on the Aariz-train hold-out (--data <the Aariz folder>), with τ from
    /// the hold-out AND Ceph-400 train 001-150 (--ceph400). Ceph-400 test1, Aariz valid, Test2 and Aariz test are
    /// refused. Runs alone; writes reports/sc1/box-gate-2.json and, on a pass only, models/regions/calibration.json (rule
    /// sc1-box-gate/2; the /1 file kept as calibration-1.json). Exit 0 pass, 4 stop (to the owner), 1 broken.
    #[arg(long = "sc1-box-gate-2")] sc1_box_gate_2: bool,
    /// SC-1 Part 1b Task C0, the box gate's third version (owner OQ-1b-A = A, 5 Nov 2026; reference/sc1-box-gate-3.json,
    /// pre-registered): /2's gate, score line and C9 on the Aariz-train hold-out, with τ over the hold-out, Ceph-400 train
    /// 001-150 and the development films (Ceph-400 test1 151-300 and Aariz valid: SC1-1a's spent films, tuned on and
    /// stated). Test2, Aariz test and PKU are refused. Runs alone, no --split; writes reports/sc1/box-gate-3.json and, on a
    /// pass only, models/regions/calibration.json (rule sc1-box-gate/3; the /2 file kept as calibration-2.json). Exit 0
    /// pass, 4 stop (to the owner), 1 broken.
    #[arg(long = "sc1-box-gate-3")] sc1_box_gate_3: bool,
    /// SC-1 Part 1b Task C: the size look's calibration (rule sc1-size/1, reference/sc1-size.json, pre-registered): the
    /// centre and line of q = ln(tracing spread / box spread) per set of regions, over the 520 calibration films (the
    /// Aariz-train hold-out, Ceph-400 train 001-150, and the development films Ceph-400 test1 151-300 and Aariz valid,
    /// tuned on and stated), with the gate /3 calibration in force and the box cache. Test2, Aariz test, PKU, the teaching
    /// and tuning films are refused. Runs alone, no --split; writes reports/sc1/size-calibration.json and, on a pass only,
    /// models/regions/size-calibration.json. Exit 0 pass, 4 stop (to the owner), 1 broken.
    #[arg(long = "sc1-size-calibrate")] sc1_size_calibrate: bool,
    /// SC-1 Part 1b Task D: the cranial-base centre look's calibration (rule sc1-cb-centre/1, reference/sc1-cb-centre.json,
    /// pre-registered): the per-axis median offset of the traced cranial-base pin from the finder's cranial-base box pin,
    /// and the line, over the same 520 calibration films as the size look (development films included and stated), with
    /// the gate /3 calibration in force and the box cache; the cranial base moved 20 mm (control) and 10 mm (separation,
    /// in-sample) on the films with a scale. Runs alone, no --split; writes reports/sc1/cb-centre-calibration.json and, on
    /// a pass only, models/regions/cb-centre-calibration.json. Exit 0 pass, 4 stop (to the owner), 1 broken.
    #[arg(long = "sc1-cb-calibrate")] sc1_cb_calibrate: bool,
    /// SC-1 Part 1 Task 11, SC1-1a: the one-time pre-registered test of the whole-film check (reference/sc1-1a.json) on
    /// Ceph-400 test1 (--ceph400) and Aariz valid (--data <the Aariz folder>), with the gate /2 calibration. Needs
    /// reports/sc1/box-gate-2.json, models/regions and models/shape/ceph400-v1.shape. Optional --cache: caches of real
    /// model runs on those films (information). Test2 and Aariz test are refused. Runs alone; writes
    /// reports/sc1/sc1-1a.json. Exit 0 pass, 3 fail (to the owner), 1 broken, 4 gate stop.
    #[arg(long = "sc1-1a")] sc1_1a: bool,
    /// SC-1 Part 1b Task E: the development-film run (reference/sc1-1b-dev.json, pre-registered; information, not a test):
    /// SC1-1a's films, folds, seeds and plants judged by whole-film/1 (gate /2, the 300-tracing file) beside whole-film/2
    /// (gate /3, the 1,000-tracing reference, the size and centre looks), with the centre-line sensitivity. Reads Ceph-400
    /// test1 (--ceph400) and Aariz valid (--data); Test2, Aariz test and PKU refused. Runs alone, no --split; writes
    /// reports/sc1/sc1-1b-dev.json. Exit 0 printed, 3 the stop tripped (to the owner before PKU), 1 broken.
    #[arg(long = "sc1-1b-dev")] sc1_1b_dev: bool,
    /// SC-1 Part 1b Task E information (owner, 5 Nov 2026, "Find the cause first"): the development films judged by
    /// whole-film/2 five ways (gate /2 or /3 tau, the 300- or 1,000-tracing reference, and gate /3 with only the maxilla and
    /// mandible at /2's), SC1-1a's plants; P4 per region and the untouched films by look. Information only: no stored
    /// calibration or pre-registration changed. Runs alone; writes reports/sc1/sc1-1b-dev-decompose.json. Exit 0, 1 broken.
    #[arg(long = "sc1-1b-dev-decompose")] sc1_1b_dev_decompose: bool,
    /// whole-film/3 (owner ruling, 5 Nov 2026, spec §17.15): put the two ruling records in force under models/regions:
    /// calibration.json becomes sc1-box-gate/4 (gate /3's kept as calibration-3.json) and cb-centre-calibration.json gets
    /// the ruled line 0.08 (the measured file kept as cb-centre-calibration-1.json). Reads no film. Runs alone. Exit 0, 1 refused.
    #[arg(long = "sc1-whole-film-3")] sc1_whole_film_3: bool,
    /// Bundling the check inside the app (6 Nov 2026): make again, from the three pinned reports in this folder (box-gate-3.json,
    /// cb-centre-calibration.json, size-calibration.json, each checked by its pinned SHA-256), the gate /3 calibration, the
    /// measured centre calibration and the size calibration exactly as those runs wrote them, into <--out>/regions (a new
    /// folder, never models/). Then `--sc1-whole-film-3 --out <the same folder>` gives whole-film/3's files. Reads no film.
    /// Runs alone. Exit 0 written, 1 refused.
    #[arg(long = "sc1-calibrations-from-reports")] sc1_calibrations_from_reports: Option<PathBuf>,
    /// whole-film/3's confirmation run (reference/sc1-1b-dev3.json, pre-registered): SC1-1a's films, folds, seeds and
    /// plants judged by whole-film/1 beside whole-film/3. Reads Ceph-400 test1 (--ceph400) and Aariz valid (--data); Test2,
    /// Aariz test and PKU refused. Runs alone; writes reports/sc1/sc1-1b-dev3.json. Exit 0 printed, 3 the stop tripped (to
    /// the owner, no re-tuning), 1 broken.
    #[arg(long = "sc1-1b-dev3")] sc1_1b_dev3: bool,
    /// SC-1 Part 1b Task A: make the sealed PKU bench folder from the unpacked download given here
    /// (<...>/data/pku/unpacked/dental-cepha-dataset): writes <...>/data/pku/{images, gt.csv, gt-doctor1.csv,
    /// gt-doctor2.csv, splits.json, spacing.csv, provenance.json}. Needs --ceph400 (the C12 scale control reads Ceph-400
    /// train). Runs alone; runs no check, no region finder and no shape look. Prints counts, sizes, the S-N ratio, the
    /// doctor-gap figures and the provenance SHA-256 only. Exit 0 made, 1 refused.
    #[arg(long = "pku-prepare")] pku_prepare: Option<PathBuf>,
    /// SC-1 Part 1b Task F: SC1-1b-PKU, the one pre-registered test of whole-film/3 on the 102 sealed PKU films
    /// (reference/sc1-1b-pku.json). Needs --data <the pku folder> and --ceph400 <the Ceph-400 folder> (C12 reads its train
    /// tracings only). Runs alone. The PKU seal opens only with the pre-registration committed as built, a clean tree and no
    /// report yet; writes reports/sc1/sc1-1b-pku.json last. Exit 0 pass, 3 fail, 1 broken, 4 the gate report in force says stop.
    #[arg(long = "sc1-1b-pku")] sc1_1b_pku: bool,
    /// SC-1 Part 1b Task B: write the whole-film check's shape reference (`whole-film-reference/1`: Ceph-400 Train and
    /// Test1, 300 tracings, and all Aariz train tracings, with the full-19 and 18-point lines stored) to this file, under
    /// the git-ignored models folder (models/shape/whole-film-reference-v1.shape; never Stage A's ceph400-v1.shape).
    /// Needs --data <the Aariz folder> and --ceph400 <the Ceph-400 folder>. Ceph-400 Test2, Aariz valid, Aariz test and
    /// PKU are never read. Runs alone. Prints counts, the lines, the controls, the time and the SHA-256 only.
    #[arg(long = "sc1-reference")] sc1_reference: Option<PathBuf>,
    /// SC-1 Part 1b Task B fix round 1 (information only): read the whole-film reference file given (under models) and
    /// print the full-19 line fitted fresh, by the same rule, on Ceph-400 alone, 300 random Aariz, 300 random of all
    /// (seed 20261105), all Aariz and all. Reads no dataset and changes no file. Runs alone.
    #[arg(long = "sc1-reference-lines")] sc1_reference_lines: Option<PathBuf>,
    /// The Ceph-400 folder (--sc1-box-gate's information table reads its test1 films only; --sc1-region-probe its train films only).
    #[arg(long, default_value = "data/ceph400")] ceph400: PathBuf,
    /// Set by `parse_explicit`: whether --split was typed on the command line (its default is test1).
    #[arg(skip)] split_explicit: bool,
    /// Set by `parse_explicit`: whether --data and --ceph400 were typed (their defaults are data/ceph400).
    #[arg(skip)] data_explicit: bool,
    #[arg(skip)] ceph400_explicit: bool,
}

impl Args {
    /// Parses like `Parser::try_parse_from`, and records whether `--split` was typed (the SC-1 modes ignore the default).
    fn parse_explicit<I: IntoIterator<Item = T>, T: Into<std::ffi::OsString> + Clone>(it: I) -> Result<Args, clap::Error> {
        let m = Args::command().try_get_matches_from(it)?;
        let mut a = Args::from_arg_matches(&m)?;
        a.split_explicit = m.value_source("split") == Some(clap::parser::ValueSource::CommandLine);
        a.data_explicit = m.value_source("data") == Some(clap::parser::ValueSource::CommandLine);
        a.ceph400_explicit = m.value_source("ceph400") == Some(clap::parser::ValueSource::CommandLine);
        Ok(a)
    }
    /// `--out`; clap requires it unless `--shape-prior` is given, and `--shape-prior` returns before any mode uses it.
    fn out(&self) -> &PathBuf { self.out.as_ref().expect("clap requires --out unless a mode that runs alone is given") }
}

/// `--shape-prior <out>` (Stage A Task 3): build, write, read the written file back with the app's loader, and print
/// three lines: films, coordinates checked, SHA-256. Nothing else is printed (no film ids, no coordinates).
fn shape_prior(a: &Args, out: &Path) -> anyhow::Result<()> {
    let b = ceph_bench::shape_prior::build_counted(&a.data)?;
    let dir = out.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    ceph_bench::ft_common::ensure_ignored(dir)?;
    std::fs::write(out, &b.text)?;
    let p = ceph_model::pointcheck::load_prior(out)?;
    anyhow::ensure!(p.sha256 == ceph_bench::ft_common::sha256_hex(b.text.as_bytes()), "{}: the written file is not the text that was checked", out.display());
    anyhow::ensure!(p.films == b.films, "{}: read back {} films, built {}", out.display(), p.films, b.films);
    println!("films {}", p.films);
    println!("coordinates checked {}", b.coordinates_checked);
    println!("sha256 {}", p.sha256);
    Ok(())
}

/// `--sc1-reference <out>` (SC-1 Part 1b Task B): build (read-back inside), the positive controls, the slice counts, then
/// write and read the written file back. Stage A's `models/shape/ceph400-v1.shape` is hashed before and after (it must
/// not change), loaded, and its 300 tracings compared with the reference's Ceph-400 300; its full-19 line (Part 1's) is
/// printed beside the new one. Aggregates only: counts, lines, times, SHA-256s.
fn sc1_reference(a: &Args, out: &Path) -> anyhow::Result<()> {
    use anyhow::Context;
    use ceph_bench::{ft_common::sha256_hex, sc1_data, sc1_reference as r};
    use ceph_model::wholefilm::{parse_reference, WholeScorer};
    let stage_a = ceph_model::pointcheck::prior_path(Path::new("models"));
    let hash = |p: &Path| std::fs::read(p).ok().map(|b| sha256_hex(&b));
    let before = hash(&stage_a);
    let b = r::build(&a.ceph400, &a.data)?;
    let built = parse_reference(b.text.as_bytes())?;
    let c = r::controls(&built)?;
    let sp = sc1_data::split_path()?;
    let split = sc1_data::load_split(&std::fs::read_to_string(&sp).with_context(|| sp.display().to_string())?)?;
    let (teach, hold, tune, outside) = r::slices(&built.names, &split);
    println!("films {} (Ceph-400 {}, Aariz train {}: teach {teach}, hold-out {hold}, tuning {tune}, in no slice {outside})", b.films, b.ceph400, b.aariz);
    println!("coordinates checked {}", b.coordinates_checked);
    println!("lines stored {} (full 19 and each 18); full-19 line {}", built.lines.len(), b.line19);
    println!("lines fitted cold in {:.1} s", b.seconds_cold);
    println!("control: mirrored over the full-19 line {} of {}; scrambled over it {} of {}", c.mirrored_over, c.tracings, c.scrambled_over, c.tracings);
    anyhow::ensure!(outside == 0 && (teach, hold, tune) == (split.teach.len(), split.holdout.len(), split.tuning.len()),
        "the reference must hold all Aariz train, each slice whole (R1b-4): teach {teach} of {}, hold-out {hold} of {}, tuning {tune} of {}, in no slice {outside}; nothing written",
        split.teach.len(), split.holdout.len(), split.tuning.len());
    anyhow::ensure!(c.mirrored_over == c.tracings && c.scrambled_over == c.tracings, "a positive control did not hold (above); nothing written");
    let sn = r::sanity(&built)?;
    println!("data check: fit better mirrored than as stored (each against the others) {} of {}; over the full-19 line as stored {} of {}", sn.better_mirrored, sn.tracings, sn.over_line_as_stored, sn.tracings);
    println!("data check: tracings failing any of Task A's nine order and facing rules {} of {}; by rule: {}", sn.failing_any, sn.tracings,
        sn.rules.iter().map(|(n, k)| format!("{n} {k}")).collect::<Vec<_>>().join(", "));
    anyhow::ensure!(sn.better_mirrored == 0, "{} reference tracing(s) fit better mirrored than as stored: STOP, to the coordinator (none dropped); nothing written", sn.better_mirrored);
    let dir = out.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    std::fs::create_dir_all(dir)?;
    ceph_bench::ft_common::ensure_ignored(dir)?;
    std::fs::write(out, &b.text)?;
    let written = std::fs::read_to_string(out)?;
    anyhow::ensure!(r::read_back(&written, &built.names, &built.tracings, &built.lines)? == b.coordinates_checked, "{}: the written file is not the text that was checked", out.display());
    let back = parse_reference(written.as_bytes())?;
    anyhow::ensure!(back.sha256 == sha256_hex(b.text.as_bytes()), "{}: the written file is not the text that was checked", out.display());
    println!("sha256 {}", back.sha256);
    let after = hash(&stage_a);
    anyhow::ensure!(before == after, "Stage A's {} changed during this run", stage_a.display());
    match after {
        None => println!("Stage A's file {}: not present here (nothing to compare)", stage_a.display()),
        Some(h) => {
            let p = ceph_model::pointcheck::load_prior(&stage_a)?;
            let same = p.names.iter().zip(&p.tracings).filter(|(n, t)| {
                built.names.iter().position(|m| *m == format!("ceph400:{n}")).is_some_and(|i| built.tracings[i].iter().zip(t.iter())
                    .all(|(x, y)| x.0.to_bits() == y.0.to_bits() && x.1.to_bits() == y.1.to_bits()))
            }).count();
            let t0 = std::time::Instant::now();
            let line300 = WholeScorer::from_prior(&p)?.line_for(&(0..19).collect::<Vec<_>>())?;
            println!("Stage A's file unchanged: sha256 {h}, loads, {} films; its tracings equal to the reference's Ceph-400 ones, bit for bit: {same} of {}", p.films, p.films);
            println!("Part 1's 300-tracing full-19 line {line300} (fitted in {:.1} s); this reference's {}", t0.elapsed().as_secs_f64(), b.line19);
        }
    }
    Ok(())
}

/// `--sc1-reference-lines <file>` (Task B fix round 1, F2; information only): the full-19 line on subsets of the stored
/// reference, each fitted fresh by the same rule. Reads only the file; writes nothing.
fn sc1_reference_lines(f: &Path) -> anyhow::Result<()> {
    let r = ceph_model::wholefilm::parse_reference(&std::fs::read(f).map_err(|e| anyhow::anyhow!("{}: {e}", f.display()))?)?;
    println!("reference {} tracings, sha256 {}, stored full-19 line {}", r.names.len(), r.sha256, r.lines[0].1);
    let t0 = std::time::Instant::now();
    for (what, n, line) in ceph_bench::sc1_reference::line_decomposition(&r, 300, 20261105)? { println!("full-19 line on {what}: {n} tracings, line {line}"); }
    println!("fitted in {:.1} s", t0.elapsed().as_secs_f64());
    Ok(())
}

/// `--chain-proof s1` (Part F Task 14): the pass marks must be committed as built, and every cache's header is checked
/// for a held-back split BEFORE any cache's films are read (owner O7; question 8). Exit 0 only when the control holds and
/// every pre-registered mark is met.
fn chain_proof(a: &Args, stage: &str) -> anyhow::Result<()> {
    use anyhow::Context;
    anyhow::ensure!(stage == "s1", "--chain-proof knows only s1 (S2 and S3 come with their own plans), not {stage:?}");
    let dirs = manifests(a.cache.as_ref().context("--chain-proof needs --cache: caches made by --crosscheck-run on Ceph-400 train and test1, comma-separated")?);
    anyhow::ensure!(!dirs.is_empty(), "--cache names no cache");
    // Every header first: one held-back cache refuses the run before any film of any cache is read.
    for d in &dirs { ceph_bench::chainproof::cache_header(&a.data, d)?; }
    anyhow::ensure!(!ceph_bench::provenance(&a.data, "").git_dirty, "commit first: the pass marks are pre-registered (reference/chain-proof-s1.json) and must be committed before the run");
    let head = std::process::Command::new("git").args(["show", "HEAD:reference/chain-proof-s1.json"]).output().ok()
        .filter(|o| o.status.success()).map(|o| o.stdout);
    ceph_bench::chainproof::committed_as_built(head)?;
    let (mut films, mut splits) = (Vec::new(), Vec::new());
    for d in &dirs {
        let (h, f) = ceph_bench::xcache::read_cache(d)?;
        ceph_bench::chainproof::refuse_held_back_cache(&a.data, &h.split)?;
        anyhow::ensure!(h.models.contains_key(ceph_model::best::DEFAULT_BASE), "{}: the cache has no Aariz run", d.display());
        splits.push((h.split.clone(), f.iter().map(|x| x.film.clone()).collect::<Vec<_>>()));
        films.extend(f);
    }
    let gt = ceph_bench::dataset::load_points(&a.data.join("gt.csv"))?;
    let p: ceph_bench::chainproof::Prereg = serde_json::from_str(ceph_bench::chainproof::PREREG)?;
    if let Some(n) = a.posthoc_clinicians { return posthoc_finish(a.out(), &films, &gt, &p, n).map(|_| ()); }
    let report = ceph_bench::chainproof::run_s1(&films, &splits, &gt, &p)?;
    std::fs::create_dir_all(a.out())?;
    let path = a.out().join("chain-proof-s1.json");
    std::fs::write(&path, serde_json::to_string_pretty(&report)?)?;
    println!("{}", report.summary());
    anyhow::ensure!(report.control_ok, "S1 proof: the control was not offered every time, so the instrument is broken; see {}", path.display());
    anyhow::ensure!(report.passed, "S1 proof: a pre-registered pass mark was missed; see {}", path.display());
    Ok(())
}

/// `--chain-proof s1 --posthoc-clinicians N` after every guard of the proof: P1.3 and its control only, written to
/// <out>/posthoc-p13-<N>.json (never chain-proof-s1.json), every line labelled post-hoc, no pass or fail. Ok (exit 0) when
/// the control held and films were analysed; an error (exit 1) when the control broke or nothing was analysed.
fn posthoc_finish(out: &Path, films: &[ceph_bench::xcache::FilmRun], gt: &ceph_bench::dataset::Points, p: &ceph_bench::chainproof::Prereg, n: usize) -> anyhow::Result<PathBuf> {
    use ceph_bench::chainproof::{run_posthoc_p13, write_posthoc, POSTHOC_LABEL};
    let r = run_posthoc_p13(films, gt, p, n)?;
    let path = write_posthoc(out, &r)?;
    println!("{}", r.summary());
    println!("{POSTHOC_LABEL} | written to {}", path.display());
    anyhow::ensure!(r.films > 0, "{POSTHOC_LABEL} | nothing was analysed");
    anyhow::ensure!(r.control_held, "{POSTHOC_LABEL} | the control was not offered every time, so the instrument is broken; see {}", path.display());
    Ok(path)
}

/// `--manifest a/manifest.json,b/manifest.json` → each path.
fn manifests(arg: &Path) -> Vec<PathBuf> {
    arg.to_string_lossy().split(',').map(str::trim).filter(|p| !p.is_empty()).map(PathBuf::from).collect()
}

/// The model id in a manifest; a missing or unreadable manifest is named in the error (Task 2 edge case).
fn model_id(manifest: &Path) -> anyhow::Result<String> {
    use anyhow::Context;
    Ok(ceph_infer::spec::ModelSpec::load(manifest).with_context(|| format!("model manifest {}", manifest.display()))?.id)
}

/// Checks made before any film is opened: the held-back test splits are refused (spec 2026-10-13 §7, owner O7), and
/// `--scores-out` needs one of the three leakage words, checked here so a wrong word fails at once, not after the run.
/// The models folder `--sc1-whole-film-3` sets up: `--out` when given (a new folder, for bundling the check inside the
/// app), else `models`.
fn wf3_models(a: &Args) -> PathBuf { a.out.clone().unwrap_or_else(|| PathBuf::from("models")) }

fn preflight(a: &Args) -> anyhow::Result<()> {
    // Owner PARK-FLAGS (15 Oct 2026): Task 8 is cancelled and the test films stay closed. The single test run is refused
    // first, before the ledger or the data are looked at (final review m6). The opening code below stays for a future
    // pre-registration (crosscheck-pass/2), which needs the owner's OK and must remove this line on purpose.
    anyhow::ensure!(!a.single_test_run, "--single-test-run is switched off: the Aariz test films stay closed (owner PARK-FLAGS, 15 Oct 2026; \
        Task 8 cancelled). It can come back only with a new pre-registration and the owner's OK. Nothing was read or written.");
    if a.sc1_1b_pku {
        // SC-1 Part 1b Task F: checked first, before any other mode's branch, so no combination slips past. It runs alone
        // (no other mode, no --out, --split or --cache), reads the folder named pku given as --data (the seal opens inside the
        // run, never here) and Ceph-400 train (--ceph400, C12 only). It returns here, so the generic --data gate below (which
        // refuses the sealed PKU folder) is not consulted.
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3
            || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev || a.sc1_1b_dev_decompose || a.sc1_1b_dev3 || a.sc1_whole_film_3
            || a.pku_prepare.is_some() || a.sc1_reference.is_some() || a.sc1_reference_lines.is_some()
            || a.split_explicit || a.posthoc_clinicians.is_some() || a.runs.is_some() || a.source_out.is_some() || a.check_bits.is_some()
            || a.split_file.is_some() || a.boxes.is_some() || a.pytorch.is_some()),
            "--sc1-1b-pku runs alone (no other mode, and no --out, --split or --cache: it reads PKU's test films and writes reports/sc1/sc1-1b-pku.json)");
        anyhow::ensure!(a.data_explicit && a.data.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("pku")),
            "--sc1-1b-pku needs --data <the pku folder> (the folder the seal covers); {} is not it", a.data.display());
        anyhow::ensure!(a.ceph400_explicit, "--sc1-1b-pku needs --ceph400 <the Ceph-400 folder>: C12 compares PKU's S-N with Ceph-400 train's");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-1b-pku needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::ledger::refuse_held_back(&a.ceph400, "train")?;
        return Ok(());
    }
    if let Some(f) = &a.sc1_reference_lines {
        // SC-1 Part 1b Task B fix round 1: information only, reads the one reference file under models and nothing else.
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2
            || a.sc1_box_gate_3 || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev || a.sc1_1b_dev_decompose || a.sc1_1b_dev3 || a.sc1_whole_film_3 || a.pku_prepare.is_some() || a.sc1_reference.is_some()
            || a.split_explicit || a.data_explicit || a.ceph400_explicit || a.posthoc_clinicians.is_some() || a.runs.is_some()
            || a.source_out.is_some() || a.check_bits.is_some() || a.split_file.is_some() || a.boxes.is_some() || a.pytorch.is_some()),
            "--sc1-reference-lines runs alone (no other mode, no --out, --data, --ceph400 or --split: it reads the reference file only)");
        ceph_bench::sc1_reference::check_out(f)?;
        return Ok(());
    }
    if a.pku_prepare.is_some() {
        // SC-1 Part 1b Task A: before any file, it runs alone (no other mode, no --out, no --split, no --data, no --cache),
        // and needs --ceph400 typed (C12 reads Ceph-400 train). It returns here, so the generic --data gate below (whose
        // default is data/ceph400) is not consulted; the loader refuses Ceph-400's held-back splits itself.
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3 || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev || a.sc1_1b_dev_decompose || a.sc1_1b_dev3 || a.sc1_whole_film_3
            || a.split_explicit || a.data_explicit || a.posthoc_clinicians.is_some() || a.runs.is_some() || a.source_out.is_some()
            || a.check_bits.is_some() || a.split_file.is_some() || a.boxes.is_some() || a.pytorch.is_some() || a.sc1_reference.is_some()),
            "--pku-prepare runs alone (no other mode, no --out, --split or --data: it reads the folder it is given and writes the pku folder two levels above it)");
        anyhow::ensure!(a.ceph400_explicit, "--pku-prepare needs --ceph400 <the Ceph-400 folder>: the scale control C12 compares PKU's S-N with Ceph-400 train's");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--pku-prepare needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::ledger::refuse_held_back(&a.ceph400, "train")?;
        return Ok(());
    }
    if let Some(out) = &a.sc1_reference {
        // SC-1 Part 1b Task B: before any file, it runs alone, reads exactly Ceph-400 train and test1 and Aariz train (no
        // --split: Aariz valid and test and Ceph-400 Test2 are refused, held-back ones by the ledger's own words), and
        // writes only under models, never Stage A's file. It returns here, so the generic --ceph400 gate below is not consulted.
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3 || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev || a.sc1_1b_dev_decompose || a.sc1_1b_dev3 || a.sc1_whole_film_3
            || a.pku_prepare.is_some() || a.posthoc_clinicians.is_some() || a.runs.is_some() || a.source_out.is_some()
            || a.check_bits.is_some() || a.split_file.is_some() || a.boxes.is_some() || a.pytorch.is_some() || a.sc1_reference_lines.is_some()),
            "--sc1-reference runs alone (no other mode, and no --out: the file goes where --sc1-reference says)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            ceph_bench::ledger::refuse_held_back(&a.ceph400, &a.split)?;
            anyhow::bail!("--sc1-reference reads Ceph-400 train and test1 and Aariz train, as ruled (R1b-4); --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-reference needs --data <the Aariz folder>: the reference's other tracings are all Aariz train");
        anyhow::ensure!(a.ceph400_explicit, "--sc1-reference needs --ceph400 <the Ceph-400 folder>: the reference's first 300 tracings are Ceph-400 Train and Test1");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-reference needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::sc1_reference::check_out(out)?;
        return Ok(());
    }
    if a.sc1_1b_dev {
        // SC-1 Part 1b Task E: before any file, it runs alone, writes only reports/sc1/sc1-1b-dev.json (no --out), takes no
        // --split (SC1-1a's films: Ceph-400 test1 and Aariz valid; Test2, Aariz test and PKU refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3
            || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev_decompose || a.sc1_1b_dev3 || a.sc1_whole_film_3 || a.pku_prepare.is_some() || a.sc1_reference.is_some() || a.sc1_reference_lines.is_some()
            || a.posthoc_clinicians.is_some() || a.runs.is_some() || a.source_out.is_some() || a.check_bits.is_some() || a.split_file.is_some()
            || a.boxes.is_some() || a.pytorch.is_some()),
            "--sc1-1b-dev runs alone (no other mode, and no --out: the report goes to reports/sc1/sc1-1b-dev.json)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            ceph_bench::ledger::refuse_held_back(&a.ceph400, &a.split)?;
            anyhow::bail!("--sc1-1b-dev reads SC1-1a's films (Ceph-400 test1 and Aariz valid), as pre-registered; --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-1b-dev needs --data <the Aariz folder>: Aariz valid");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-1b-dev needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::sc1_gate2::refuse_reads_for(&ceph_bench::sc1_gate2::GATE3, &[(&a.data, "valid"), (&a.ceph400, "test1")])?;
        return Ok(());
    }
    if a.sc1_1b_dev3 {
        // whole-film/3's confirmation run: before any file, it runs alone, writes only reports/sc1/sc1-1b-dev3.json (no --out), takes no
        // --split (SC1-1a's films: Ceph-400 test1 and Aariz valid; Test2, Aariz test and PKU refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3
            || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev_decompose || a.sc1_1b_dev || a.sc1_whole_film_3 || a.pku_prepare.is_some() || a.sc1_reference.is_some() || a.sc1_reference_lines.is_some()
            || a.posthoc_clinicians.is_some() || a.runs.is_some() || a.source_out.is_some() || a.check_bits.is_some() || a.split_file.is_some()
            || a.boxes.is_some() || a.pytorch.is_some()),
            "--sc1-1b-dev3 runs alone (no other mode, and no --out: the report goes to reports/sc1/sc1-1b-dev3.json)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            ceph_bench::ledger::refuse_held_back(&a.ceph400, &a.split)?;
            anyhow::bail!("--sc1-1b-dev3 reads SC1-1a's films (Ceph-400 test1 and Aariz valid), as pre-registered; --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-1b-dev3 needs --data <the Aariz folder>: Aariz valid");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-1b-dev3 needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::sc1_gate2::refuse_reads_for(&ceph_bench::sc1_gate2::GATE3, &[(&a.data, "valid"), (&a.ceph400, "test1")])?;
        return Ok(());
    }
    if a.sc1_calibrations_from_reports.is_some() {
        // Bundling the check (6 Nov 2026): before any file, it runs alone and reads no film (no --data, --ceph400 or --split).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3
            || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev || a.sc1_1b_dev_decompose || a.sc1_1b_dev3 || a.sc1_whole_film_3 || a.pku_prepare.is_some()
            || a.sc1_reference.is_some() || a.sc1_reference_lines.is_some() || a.split_explicit || a.data_explicit || a.ceph400_explicit
            || a.posthoc_clinicians.is_some() || a.runs.is_some() || a.source_out.is_some() || a.check_bits.is_some() || a.split_file.is_some()
            || a.boxes.is_some() || a.pytorch.is_some()),
            "--sc1-calibrations-from-reports runs alone (no other mode, and no --data, --ceph400 or --split: it reads no film, only the three pinned reports)");
        return Ok(());
    }
    if a.sc1_whole_film_3 {
        // whole-film/3's setup: before any file, it runs alone and reads no film (no --data, --ceph400 or --split; --out
        // names the models folder to set up, default models).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.cache.is_some() || a.sc1_calibrations_from_reports.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3
            || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev || a.sc1_1b_dev_decompose || a.sc1_1b_dev3 || a.pku_prepare.is_some()
            || a.sc1_reference.is_some() || a.sc1_reference_lines.is_some() || a.split_explicit || a.data_explicit || a.ceph400_explicit
            || a.posthoc_clinicians.is_some() || a.runs.is_some() || a.source_out.is_some() || a.check_bits.is_some() || a.split_file.is_some()
            || a.boxes.is_some() || a.pytorch.is_some()),
            "--sc1-whole-film-3 runs alone (no other mode, and no --data, --ceph400 or --split: it reads no film and writes only under <--out or models>/regions)");
        return Ok(());
    }
    if a.sc1_1b_dev_decompose {
        // SC-1 Part 1b Task E information: before any file, it runs alone, writes only reports/sc1/sc1-1b-dev-decompose.json (no --out), takes no
        // --split (SC1-1a's films: Ceph-400 test1 and Aariz valid; Test2, Aariz test and PKU refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.diag_flip_control || a.diag_reframe_control || a.diag_pad_control.is_some()
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3
            || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.sc1_1b_dev3 || a.sc1_whole_film_3 || a.sc1_1b_dev || a.pku_prepare.is_some() || a.sc1_reference.is_some() || a.sc1_reference_lines.is_some()
            || a.posthoc_clinicians.is_some() || a.runs.is_some() || a.source_out.is_some() || a.check_bits.is_some() || a.split_file.is_some()
            || a.boxes.is_some() || a.pytorch.is_some()),
            "--sc1-1b-dev-decompose runs alone (no other mode, and no --out: the report goes to reports/sc1/sc1-1b-dev-decompose.json)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            ceph_bench::ledger::refuse_held_back(&a.ceph400, &a.split)?;
            anyhow::bail!("--sc1-1b-dev-decompose reads SC1-1a's films (Ceph-400 test1 and Aariz valid), as pre-registered; --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-1b-dev-decompose needs --data <the Aariz folder>: Aariz valid");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-1b-dev-decompose needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::sc1_gate2::refuse_reads_for(&ceph_bench::sc1_gate2::GATE3, &[(&a.data, "valid"), (&a.ceph400, "test1")])?;
        return Ok(());
    }
    if let Some(out) = &a.shape_prior {
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some()
            || a.sc1_split.is_some() || a.sc1_teaching_boxes.is_some()),
            "--shape-prior runs alone (no other mode, and no --out: the file goes where --shape-prior says)");
        ceph_bench::shape_prior::check_out(out)?;
    }
    anyhow::ensure!(!a.stage_a_acceptance || !(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
        || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.shape_prior.is_some() || a.sc1_split.is_some() || a.sc1_teaching_boxes.is_some()),
        "--stage-a-acceptance runs alone (no other mode, and no --out: the report goes to reports/stage-a-acceptance)");
    if a.sc1_split.is_some() || a.sc1_teaching_boxes.is_some() {
        // Before the ledger and before any file: the Aariz test films and Test2 are refused for every split, and these modes
        // read Aariz train only (ruling P1: the default --split is ignored; one typed on the command line must be train).
        let mode = if a.sc1_split.is_some() { "--sc1-split" } else { "--sc1-teaching-boxes" };
        anyhow::ensure!(!(a.sc1_split.is_some() && a.sc1_teaching_boxes.is_some()), "--sc1-split and --sc1-teaching-boxes each run alone");
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some()),
            "{mode} runs alone (no other mode and no --out: the files go where {mode} says)");
        ceph_bench::ledger::refuse_held_back(&a.data, "train")?;
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            anyhow::ensure!(a.split == "train", "{mode} reads Aariz train only; --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "{mode} needs --data <the Aariz folder>: it splits and boxes Aariz train only");
    }
    if a.sc1_size_calibrate {
        // Before any file: it runs alone, writes only where the pre-registration says (no --out), takes no --split (the
        // films are fixed by reference/sc1-size.json; Test2, Aariz test and PKU refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3
            || a.sc1_1a || a.sc1_cb_calibrate || a.pku_prepare.is_some() || a.sc1_reference.is_some()),
            "--sc1-size-calibrate runs alone (no other mode, and no --out: the report goes to reports/sc1/size-calibration.json)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            ceph_bench::ledger::refuse_held_back(&a.ceph400, &a.split)?;
            anyhow::bail!("--sc1-size-calibrate reads the 520 calibration films fixed by reference/sc1-size.json; --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-size-calibrate needs --data <the Aariz folder>: the hold-out and Aariz valid");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-size-calibrate needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::sc1_size::refuse_reads(&a.data, &a.ceph400)?;
        return Ok(());
    }
    if a.sc1_cb_calibrate {
        // Before any file: it runs alone, writes only where the pre-registration says (no --out), takes no --split (the
        // films are fixed by reference/sc1-cb-centre.json; Test2, Aariz test and PKU refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3
            || a.sc1_size_calibrate || a.sc1_1a || a.pku_prepare.is_some() || a.sc1_reference.is_some()),
            "--sc1-cb-calibrate runs alone (no other mode, and no --out: the report goes to reports/sc1/cb-centre-calibration.json)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            ceph_bench::ledger::refuse_held_back(&a.ceph400, &a.split)?;
            anyhow::bail!("--sc1-cb-calibrate reads the 520 calibration films fixed by reference/sc1-cb-centre.json; --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-cb-calibrate needs --data <the Aariz folder>: the hold-out and Aariz valid");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-cb-calibrate needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::sc1_size::refuse_reads(&a.data, &a.ceph400)?;
        return Ok(());
    }
    if a.sc1_box_gate_3 {
        // Before any file: it runs alone, writes only where the pre-registration says (no --out), takes no --split (it reads
        // Aariz train and valid and Ceph-400 train and test1, as pre-registered; Test2, Aariz test and PKU refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_1a
            || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.pku_prepare.is_some() || a.sc1_reference.is_some()),
            "--sc1-box-gate-3 runs alone (no other mode, and no --out: the report goes to reports/sc1/box-gate-3.json)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            ceph_bench::ledger::refuse_held_back(&a.ceph400, &a.split)?;
            anyhow::bail!("--sc1-box-gate-3 reads Aariz train and valid and Ceph-400 train and test1, as pre-registered; --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-box-gate-3 needs --data <the Aariz folder>: the gate runs on the Aariz-train hold-out");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-box-gate-3 needs --ceph400 <the Ceph-400 folder> for tau; {} is not Ceph-400", a.ceph400.display());
        ceph_bench::sc1_gate2::refuse_reads_for(&ceph_bench::sc1_gate2::GATE3, &[(&a.data, "train"), (&a.data, "valid"), (&a.ceph400, "train"), (&a.ceph400, "test1")])?;
        return Ok(());
    }
    anyhow::ensure!(a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2 || a.sc1_box_gate_3 || a.sc1_size_calibrate || a.sc1_cb_calibrate || a.sc1_1a || a.ceph400 == Path::new("data/ceph400"), "--ceph400 goes only with --sc1-box-gate, --sc1-region-probe, --sc1-box-gate-2 or --sc1-1a");
    if a.sc1_1a {
        // Before any file: it runs alone (only --cache, the real-runs information, may go with it), writes only
        // reports/sc1/sc1-1a.json (no --out), and reads exactly Ceph-400 test1 and Aariz valid (no --split; Test2 and Aariz
        // test refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe || a.sc1_box_gate_2),
            "--sc1-1a runs alone (no other mode, and no --out: the report goes to reports/sc1/sc1-1a.json)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            ceph_bench::ledger::refuse_held_back(&a.ceph400, &a.split)?;
            anyhow::bail!("--sc1-1a reads Ceph-400 test1 and Aariz valid, as pre-registered; --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-1a needs --data <the Aariz folder>: its Aariz films are Aariz valid");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-1a needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
    }
    if a.sc1_box_gate_2 {
        // Before any file: it runs alone, writes only where the pre-registration says (no --out), and reads the train
        // splits only (SC1-1a's Ceph-400 test1 and Aariz valid, Test2 and Aariz test refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_region_probe),
            "--sc1-box-gate-2 runs alone (no other mode, and no --out: the report goes to reports/sc1/box-gate-2.json)");
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            anyhow::ensure!(a.split == "train", "--sc1-box-gate-2 reads train only (the Aariz-train hold-out and Ceph-400 train); --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-box-gate-2 needs --data <the Aariz folder>: the gate runs on the Aariz-train hold-out");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-box-gate-2 needs --ceph400 <the Ceph-400 folder> for tau; {} is not Ceph-400", a.ceph400.display());
    }
    if a.sc1_region_probe {
        // Before any file: it runs alone, writes only reports/sc1/region-probe.json (no --out), and reads the train splits
        // only (SC1-1a's Ceph-400 test1 and Aariz valid, Test2 and Aariz test refused).
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_box_gate || a.sc1_box_gate_2),
            "--sc1-region-probe runs alone (no other mode, and no --out: the report goes to reports/sc1/region-probe.json)");
        ceph_bench::sc1_probe::refuse_reads(&[(&a.data, "train"), (&a.ceph400, "train")])?;
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            anyhow::ensure!(a.split == "train", "--sc1-region-probe reads train only (Ceph-400 train and the Aariz-train hold-out); --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-region-probe needs --data <the Aariz folder>: its information set is the Aariz-train hold-out");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-region-probe needs --ceph400 <the Ceph-400 folder>; {} is not Ceph-400", a.ceph400.display());
    }
    if a.sc1_box_gate {
        // Before any file: it runs alone, writes only where the pre-registration says (no --out), reads Aariz train for the
        // gate (Aariz test and Test2 refused) and Ceph-400 test1 for the information table.
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.cache.is_some()
            || a.single_test_run || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some()
            || a.sc1_teaching_boxes.is_some() || a.sc1_faithfulness || a.sc1_region_probe || a.sc1_box_gate_2),
            "--sc1-box-gate runs alone (no other mode, and no --out: the report goes to reports/sc1/box-gate.json)");
        ceph_bench::sc1_gate::refuse_reads(&[(&a.data, "train"), (&a.data, "valid"), (&a.ceph400, "test1")])?;
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            anyhow::ensure!(a.split == "train", "--sc1-box-gate reads Aariz train only for the gate (its hold-out); --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-box-gate needs --data <the Aariz folder>: the gate runs on the Aariz-train hold-out");
        anyhow::ensure!(ceph_bench::sc1_gate::is_ceph400(&a.ceph400), "--sc1-box-gate needs --ceph400 <the Ceph-400 folder> for its information table; {} is not Ceph-400", a.ceph400.display());
    }
    anyhow::ensure!(a.sc1_faithfulness || (a.split_file.is_none() && a.boxes.is_none() && a.pytorch.is_none()),
        "--split-file, --boxes and --pytorch go only with --sc1-faithfulness");
    if a.sc1_faithfulness {
        // Before any file: the paths are all given, it runs alone, and it reads Aariz train only (Aariz test and Test2 refused).
        anyhow::ensure!(a.split_file.is_some() && a.boxes.is_some() && a.pytorch.is_some() && a.out.is_some(),
            "--sc1-faithfulness needs --split-file, --boxes, --pytorch and --out");
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.cache.is_some() || a.single_test_run
            || a.leakage.is_some() || a.shape_prior.is_some() || a.stage_a_acceptance || a.sc1_split.is_some() || a.sc1_teaching_boxes.is_some()),
            "--sc1-faithfulness runs alone (no other mode)");
        ceph_bench::ledger::refuse_held_back(&a.data, "train")?;
        if a.split_explicit {
            ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
            anyhow::ensure!(a.split == "train", "--sc1-faithfulness reads Aariz train only (its hold-out); --split {} is refused (leave --split out)", a.split);
        }
        anyhow::ensure!(ceph_bench::scale::is_aariz(&a.data), "--sc1-faithfulness needs --data <the Aariz folder>: it runs on the Aariz train hold-out only");
    }
    anyhow::ensure!(a.posthoc_clinicians.is_none() || a.chain_proof.as_deref() == Some("s1"),
        "--posthoc-clinicians goes only with --chain-proof s1 (POST-HOC, owner 27 Oct, not pre-registered; cannot change the S1 result)");
    anyhow::ensure!(a.posthoc_clinicians != Some(0), "--posthoc-clinicians needs at least 1 clinician");
    anyhow::ensure!(a.chain_proof.is_none() || !(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient), "--chain-proof runs alone");
    // Held back (owner O7): refused, except the single test run (Task 8) and, after it, its cache (`opened`).
    anyhow::ensure!(!a.single_test_run || a.crosscheck_run, "--single-test-run goes only with --crosscheck-run");
    if a.crosscheck_run && a.single_test_run {
        anyhow::ensure!(ceph_bench::ledger::is_held_back(&a.data, &a.split), "--single-test-run is only for a held-back set");
    } else if !(a.cache.is_some() && ceph_bench::ledger::opened(&ceph_bench::ledger::path()?, &a.data, &a.split)?) {
        ceph_bench::ledger::refuse_held_back(&a.data, &a.split)?;
    }
    anyhow::ensure!(!(a.scale_check && (a.scores_out.is_some() || a.diag_facing || a.orient || a.parity.is_some())),
        "--scale-check runs no model and writes nothing; drop --scores-out, --diag-facing, --orient and --parity");
    anyhow::ensure!(!(a.diag_facing && a.scores_out.is_some()), "--diag-facing is a debug instrument and writes no scores; drop --scores-out");
    anyhow::ensure!(!a.diag_flip_control || a.diag_facing, "--diag-flip-control only works with --diag-facing");
    anyhow::ensure!(!a.diag_reframe_control || a.diag_facing, "--diag-reframe-control only works with --diag-facing");
    if let Some(f) = a.diag_pad_control {
        anyhow::ensure!(a.diag_facing, "--diag-pad-control only works with --diag-facing");
        anyhow::ensure!((1.0..=4.0).contains(&f), "--diag-pad-control must be between 1 and 4, not {f}");
    }
    anyhow::ensure!(a.scores_out.is_none() || a.leakage.is_some(), "--scores-out needs --leakage clean|leaked|home-ground");
    if let Some(l) = &a.leakage {
        anyhow::ensure!(ceph_bench::report::LEAKAGE.contains(&l.as_str()), "--leakage must be one of {:?}, not {l:?}", ceph_bench::report::LEAKAGE);
    }
    Ok(())
}

/// `--pku-prepare <raw>` (SC-1 Part 1b Task A): the bench folder is `<raw>/../..` (data/pku beside its download).
/// Prints aggregates only: counts, sizes, each rule's failures, the S-N ratio, the doctor-gap figures, the provenance hash.
fn pku_prepare(raw: &Path, ceph400: &Path) -> anyhow::Result<()> {
    use anyhow::Context;
    let real = std::fs::canonicalize(raw).with_context(|| format!("the PKU download folder {}", raw.display()))?;
    let out = real.parent().and_then(Path::parent).ok_or_else(|| anyhow::anyhow!("{}: no folder two levels above it", real.display()))?;
    let p = ceph_bench::pku::prepare(&real, out, ceph400)?;
    println!("films {} (split {}, ids pku001-pku{:03})", p.films, ceph_bench::pku::PKU_SPLIT, p.films);
    for ((w, h), n) in &p.sizes { println!("size {w} x {h} px: {n} films"); }
    for o in &p.order { println!("rule {}: {} failures", o.rule, o.failures); }
    println!("C12 S-N ratio (PKU median at {} mm/px / Ceph-400 train median at 0.1 mm/px): {:.4} (limit 1 +/- {})",
        ceph_bench::pku::PKU_MM_PER_PX, p.sn_ratio, ceph_bench::pku::SN_TOLERANCE);
    println!("doctor1 vs doctor2: 95th percentile {:.3} mm over {} points; {} points more than 5 mm apart", p.doctor_gap_p95_mm, p.films * 19, p.doctor_gap_over_5mm);
    println!("rule {}; truth {}; provenance.json sha256 {}", ceph_bench::pku::PREPARE_RULE, ceph_bench::pku::TRUTH_RULE, p.provenance_sha256);
    Ok(())
}

fn main() -> anyhow::Result<()> {
    let a = Args::parse_explicit(std::env::args_os()).unwrap_or_else(|e| e.exit());
    let list = manifests(&a.manifest);
    preflight(&a)?;
    if a.sc1_1b_pku {
        let code = ceph_bench::sc1_1b_pku::run_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if let Some(out) = &a.shape_prior { return shape_prior(&a, out); }
    if let Some(out) = &a.sc1_reference { return sc1_reference(&a, out); }
    if let Some(f) = &a.sc1_reference_lines { return sc1_reference_lines(f); }
    if let Some(raw) = &a.pku_prepare { return pku_prepare(raw, &a.ceph400); }
    if let Some(out) = &a.sc1_split { ceph_bench::sc1_data::write_split_cli(&a.data, out)?; return Ok(()); }
    if let Some(dir) = &a.sc1_teaching_boxes {
        use anyhow::Context;
        let p = ceph_bench::sc1_data::split_path()?;
        let split = ceph_bench::sc1_data::load_split(&std::fs::read_to_string(&p).with_context(|| format!("{} (made by --sc1-split and pinned in Task 5)", p.display()))?)?;
        ceph_bench::sc1_data::teaching_boxes_cli(&a.data, &split, dir)?;
        return Ok(());
    }
    if a.sc1_box_gate {
        let code = ceph_bench::sc1_gate::run_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_cb_calibrate {
        let code = ceph_bench::sc1_cb::run_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_size_calibrate {
        let code = ceph_bench::sc1_size::run_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_box_gate_3 {
        let code = ceph_bench::sc1_gate2::run_cli_spec(&ceph_bench::sc1_gate2::GATE3, &a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_box_gate_2 {
        let code = ceph_bench::sc1_gate2::run_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if let Some(reports) = &a.sc1_calibrations_from_reports {
        let code = ceph_bench::sc1_wf3::from_reports_cli(reports, a.out())?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_whole_film_3 {
        let code = ceph_bench::sc1_wf3::setup_cli(&wf3_models(&a))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_1b_dev3 {
        let code = ceph_bench::sc1_dev::run3_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_1b_dev_decompose {
        let code = ceph_bench::sc1_dev::decompose_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_1b_dev {
        let code = ceph_bench::sc1_dev::run_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_1a {
        let caches = a.cache.as_ref().map(|c| manifests(c)).unwrap_or_default();
        let code = ceph_bench::sc1_1a::run_cli(&a.ceph400, &a.data, Path::new("models"), &Path::new("reports").join("sc1"), &caches)?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_region_probe {
        let code = ceph_bench::sc1_probe::run_cli(&a.data, &a.ceph400, Path::new("models"), &Path::new("reports").join("sc1"))?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.sc1_faithfulness {
        use anyhow::Context;
        let (sf, boxes, pytorch) = (a.split_file.as_ref().unwrap(), a.boxes.as_ref().unwrap(), a.pytorch.as_ref().unwrap());
        let split = ceph_bench::sc1_data::load_split(&std::fs::read_to_string(sf).with_context(|| sf.display().to_string())?)?;
        let code = ceph_bench::sc1_boxes::faithfulness_cli(&a.data, &split, Path::new("models"), boxes, pytorch, a.out())?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if a.stage_a_acceptance {
        let caches = a.cache.as_ref().map(|c| manifests(c)).unwrap_or_default();
        let code = ceph_bench::stage_a_accept::run_cli(&a.data, &caches, Path::new("models"), Path::new("reports").join("stage-a-acceptance").as_path())?;
        if code != 0 { std::process::exit(code); }
        return Ok(());
    }
    if let Some(stage) = &a.chain_proof { return chain_proof(&a, stage); }
    if a.crosscheck_run && a.single_test_run {
        use anyhow::Context;
        let prov = ceph_bench::provenance(&a.data, "");
        anyhow::ensure!(!prov.git_dirty, "commit first (the approved values and the code)");
        let name = a.data.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        // Preflight c10: every model must load and pass its SHA check BEFORE the set is marked opened, so a missing or
        // tampered model file can never use up the single opening with no film read.
        for m in &list {
            let spec = ceph_infer::spec::ModelSpec::load(m).with_context(|| format!("{}: cannot read the manifest", m.display()))?;
            spec.verify(m.parent().unwrap_or(std::path::Path::new(".")))?;
        }
        ceph_bench::ledger::open_once(&ceph_bench::ledger::path()?,
            &ceph_bench::ledger::Opening { dataset: name, split: a.split.clone(), git_sha: prov.git_sha, unix: prov.generated_unix })?;
    }
    if a.crosscheck_run { return crosscheck_run(&a, &list); }
    if a.crosscheck_tune { return crosscheck_tune(&a); }
    if a.decide_source { return decide_source(&a); }
    if a.scale_check {
        let name = a.data.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        ceph_bench::print_scale_check(&format!("{name} {}", a.split), &ceph_bench::scale_check(&a.data, &a.split)?);
        return Ok(());
    }
    anyhow::ensure!(!list.is_empty(), "--manifest names no model");
    anyhow::ensure!(list.len() == 1 || (a.parity.is_none() && !a.orient), "--parity and --orient take a single manifest");
    if a.diag_facing {
        for manifest in list {
            let id = model_id(&manifest)?;
            let cfg = BenchConfig { data: a.data.clone(), split: a.split.clone(), manifest, out: a.out().clone(), parity: None };
            eprintln!("{id} (diag-facing{}{})", if a.diag_flip_control { ", FLIP CONTROL: every film and its truth mirrored" } else { "" },
                a.diag_pad_control.map(|f| format!(", PAD CONTROL: every film centred on a black canvas {f}× as wide and high")).unwrap_or_default()
                + if a.diag_reframe_control { ", ORACLE REFRAME: head moved to the median ISBI position and size" } else { "" });
            let films = ceph_bench::run_diag_facing(&cfg, a.diag_flip_control, a.diag_pad_control.unwrap_or(1.0), a.diag_reframe_control, |done, total| if done % 50 == 0 || done == total { eprintln!("  {done}/{total}") })?;
            ceph_bench::print_diag_facing(&id, &films);
        }
        return Ok(());
    }
    if a.orient {
        let cfg = BenchConfig { out: a.out().clone(), data: a.data, split: a.split, manifest: list[0].clone(), parity: None };
        let r = run_orient(&cfg, |done, total| if done % 50 == 0 || done == total { eprintln!("  {done}/{total}") })?;
        println!("facing: as-is right {}/{} · mirrored left {}/{} · max mirror diff {:.2e} px · {:.0} ms per auto-detect",
            r.right_correct, r.n, r.left_correct, r.n, r.max_mirror_diff_px, r.mean_auto_ms);
        for w in &r.wrong { println!("  wrong: {w}"); }
        if !r.passes() { std::process::exit(1); }
        return Ok(());
    }
    let several = list.len() > 1;
    for manifest in list {
        let id = model_id(&manifest)?;
        // A single model keeps writing to <out> as before; several write one report each to <out>/<model id>.
        let out = if several { a.out().join(&id) } else { a.out().clone() };
        let cfg = BenchConfig { data: a.data.clone(), split: a.split.clone(), manifest, out: out.clone(), parity: a.parity.clone() };
        eprintln!("{id}");
        let r = run(&cfg, |done, total| if done % 50 == 0 || done == total { eprintln!("  {done}/{total}") })?;
        if let Some(scores_out) = &a.scores_out {
            let dataset = a.data.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            ceph_bench::report::write_scores(scores_out, &r, &dataset, &a.split, a.leakage.as_deref().unwrap_or(""))?;
        }
        if let Some(c) = &r.aariz_scale { println!("{}", ceph_bench::report::scale_line(c)); }
        for (split, s) in &r.per_split { println!("{split:6} MRE {:.3} ± {:.3} mm  SDR@2mm {:.1}%", s.mre, s.sd, s.sdr[0].1 * 100.0); }
        println!("overall MRE {:.3} mm · provider {} · {:.1} ms/image · report in {}", r.overall.mre, r.provider, r.mean_inference_ms, out.display());
        let note = if r.leakage_note.is_empty() { "no training note".to_string() } else { r.leakage_note.clone() };
        println!("{id:20} MRE {:.3} mm  SDR@2mm {:.1}%  ({note})", r.overall.mre, r.overall.sdr[0].1 * 100.0);
        if let Some(p) = &r.parity {
            println!("parity vs Python: max {:.4} px, mean {:.4} px over {} points", p.max_px, p.mean_px, p.n);
            if !p.passes(PARITY_MAX_PX) { eprintln!("PARITY FAILED: max {:.4} px > {PARITY_MAX_PX} px", p.max_px); std::process::exit(1); }
        }
    }
    Ok(())
}

fn decide_source(a: &Args) -> anyhow::Result<()> {
    use anyhow::Context;
    use ceph_bench::{dataset, runs, source};
    let prov = ceph_bench::provenance(&a.data, "");
    anyhow::ensure!(!prov.git_dirty, "commit first: the rule and the code must be committed before a decision run (pre-registration)");
    let dir = a.runs.as_ref().context("--decide-source needs --runs")?;
    let out = a.source_out.as_ref().context("--decide-source needs --source-out")?;
    let gt = dataset::load_points(&a.data.join("gt.csv"))?;
    let selected = dataset::select(&dataset::load_splits(&a.data.join("splits.json"))?, &a.split)?;
    // aariz-scale/1 (Task 2b): on Aariz only the films the rule keeps, each at the rule's mm/px, plus the rule's counts;
    // on any other dataset every selected film at its spacing.csv row (or 0.1 fixed) and no counts — the bench's own path.
    let (scored, scale) = ceph_bench::films_to_score(&a.data, &selected, &gt)?;
    if let Some(c) = &scale { println!("{}", ceph_bench::report::scale_line(c)); }
    // Both runs must have been scored under exactly this rule and these counts (a Task 2 run on the old scale, or a run
    // on another selection, is refused, naming the run).
    runs::same_scale(&[dir.join(source::AARIZ), dir.join(source::CWLACHAP)], scale.as_ref())?;
    let ids: Vec<String> = scored.iter().map(|(iid, _)| iid.clone()).collect();
    let mm: std::collections::HashMap<String, f64> = scored.into_iter().collect();
    let az = dataset::load_points(&dir.join(source::AARIZ).join("predictions.csv"))?;
    let cw = dataset::load_points(&dir.join(source::CWLACHAP).join("predictions.csv"))?;
    let (pairs, left) = runs::paired_errors(&az, &cw, &gt, &|iid| mm.get(iid).copied().ok_or_else(|| anyhow::anyhow!("no scale for {iid}")), &ids, &source::ORIGINAL_19)?;
    let (control, named) = source::plant_control(&pairs)?;
    println!("positive control: cwlachap 2 mm lower on {control}: {}", if named { "named (the rule can see)" } else { "NOT named" });
    anyhow::ensure!(named, "positive control failed: the rule did not name the planted point, so no result counts");
    let (d1, d2) = (source::decide_all(&pairs)?, source::decide_all(&pairs)?);
    anyhow::ensure!(d1 == d2, "two decisions on the same data disagree");
    let name = a.data.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    // The runtime each model's run used (preflight a1): from each run's metrics.json `provider`.
    let provider_of = |id: &str| -> anyhow::Result<String> {
        let m: serde_json::Value = serde_json::from_slice(&std::fs::read(dir.join(id).join("metrics.json"))?)?;
        Ok(m["provider"].as_str().unwrap_or("unknown").to_string())
    };
    let providers: std::collections::BTreeMap<String, String> = [source::AARIZ, source::CWLACHAP].iter()
        .map(|id| Ok((id.to_string(), provider_of(id)?))).collect::<anyhow::Result<_>>()?;
    println!("providers: {providers:?}");
    let mut j = source::table_json(&d1, &name, &a.split, ids.len(), &runs::films_sha256(&ids), &prov.git_sha, &control, &left, &providers);
    if let Some(c) = &scale { j["aarizScale"] = serde_json::to_value(c)?; }   // every Aariz output records the rule (Task 2b)
    std::fs::write(out, serde_json::to_string_pretty(&j)? + "\n")?;
    println!("decided on {name} {} ({} films, git {}), rule {}", a.split, ids.len(), prov.git_sha, source::RULE_VERSION);
    for (id, d) in &d1 {
        println!("{id:5} Aariz {:.3}  cwlachap {:.3}  diff {:+.3} [{:+.3}, {:+.3}]  n {:3}  left out {:2}  -> {}",
            d.mean_aariz, d.mean_cwlachap, d.diff.estimate, d.diff.lo, d.diff.hi, d.films, left[id], d.chosen);
    }
    Ok(())
}

fn crosscheck_run(a: &Args, manifests: &[PathBuf]) -> anyhow::Result<()> {
    anyhow::ensure!(!manifests.is_empty(), "--manifest names no model");
    // The cache records the git SHA it ran at; on an uncommitted tree that SHA would not say what code made it.
    anyhow::ensure!(!ceph_bench::provenance(&a.data, "").git_dirty, "commit first: the cache records the git SHA of the code that made it");
    let h = ceph_bench::xcache::run_models(&a.data, &a.split, manifests, a.out(), |d, t| if d % 25 == 0 || d == t { eprintln!("  {d}/{t}") })?;
    println!("cached {} films x {} models ({} {}), windows {:?}, git {}, providers {:?}", h.films, h.models.len(), h.dataset, h.split, h.windows, h.git_sha, h.providers);
    if let Some(c) = &h.aariz_scale { println!("{}", ceph_bench::report::scale_line(c)); }
    let (_, films) = ceph_bench::xcache::read_cache(a.out())?;
    let errors: usize = films.iter().map(|f| f.models.values().filter(|m| m.is_err()).count()).sum();
    println!("model runs that failed on a film (recorded as not answering): {errors}");
    if let Some(dir) = &a.check_bits {
        let ids: Vec<String> = h.models.keys().cloned().collect();
        for (id, n, diff) in ceph_bench::xcache::bits_reproduced(&films, &ids, dir)? {
            println!("{id}: {n} points compared with Task 4's bits, 0 missing from the cache, {diff} differ");
        }
    }
    Ok(())
}

fn crosscheck_tune(a: &Args) -> anyhow::Result<()> {
    use anyhow::Context;
    use ceph_bench::{dataset, xcache, xeval};
    use ceph_infer::crosscheck::Outcome;
    anyhow::ensure!(a.split == "valid" && ceph_bench::scale::is_aariz(&a.data), "tuning uses Aariz valid only (owner O7), not {} {}", a.data.display(), a.split);
    anyhow::ensure!(!ceph_bench::provenance(&a.data, "").git_dirty, "commit first: the tuning rule and the code must be committed before the run");
    let (h, films) = xcache::read_cache(a.cache.as_ref().context("--crosscheck-tune needs --cache")?)?;
    anyhow::ensure!(h.split == "valid" && h.dataset.eq_ignore_ascii_case("aariz"), "this cache is {} {}, not Aariz valid", h.dataset, h.split);
    // Decision runs are on cpu (plan Global Constraints): a cache made on another runtime is refused.
    anyhow::ensure!(!h.providers.is_empty() && h.providers.values().all(|p| p == "cpu"), "the cache was not made on cpu ({:?}): re-run with CEPHTRACE_PROVIDER=cpu", h.providers);
    let gt = dataset::load_points(&a.data.join("gt.csv"))?;
    // aariz-scale/1: the cache's films, scales and counts must be the ones the rule gives these films now.
    let ids = dataset::select(&dataset::load_splits(&a.data.join("splits.json"))?, &a.split)?;
    let (scored, counts) = ceph_bench::films_to_score(&a.data, &ids, &gt)?;
    anyhow::ensure!(counts == h.aariz_scale, "the cache's aariz-scale counts differ from the rule's on these films: re-run --crosscheck-run");
    anyhow::ensure!(scored.len() == films.len() && scored.iter().zip(&films).all(|((i, m), f)| *i == f.film && m.to_bits() == f.mm_per_px.to_bits()),
        "the cache's films or their scales differ from aariz-scale/1 on these films: re-run --crosscheck-run");
    let source = ceph_model::source::parse(&std::fs::read_to_string(&a.source).with_context(|| a.source.display().to_string())?)?.points;
    let order: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    let placeable = |m: &str, lm: &str| !matches!(ceph_model::scores::status(m, lm), ceph_model::scores::PointStatus::TooFar { .. });
    let p = ceph_infer::crosscheck::params().clone();
    let voters = p.voters.clone();
    // Landmarks both voters detect (on any film): the catch rate's landmarks (prereg (a)). Computed once.
    let landmarks: std::collections::BTreeSet<String> = gt.values().flatten().map(|(l, _, _)| l.clone()).collect();
    let seen_set: std::collections::BTreeSet<String> = landmarks.iter().filter(|lm| voters.iter()
        .filter(|v| films.iter().any(|f| xeval::guess(f, v, lm, p.spread_window_cells).is_some())).count() >= 2).cloned().collect();
    let seen = |lm: &str| seen_set.contains(lm);
    println!("voters {voters:?}; landmarks both voters detect: {} of {}", seen_set.len(), landmarks.len());
    let s = xeval::Setup { main: ceph_bench::source::AARIZ, source: &source, order: &order, placeable: &placeable, voters: &voters, window: p.spread_window_cells, params: &p };
    // The planted control with the untuned draft values, first: recorded with its verdict. It does not gate (Task 7
    // Step 7 finding, a deviation from the brief for the owner to rule on): the draft k of 1 makes Aariz's ovals about
    // three times its real error, so it is blind by construction. Prereg step 4's control, with the TUNED values, below,
    // is the hard stop: if it fails, nothing is written.
    let (moved, caught) = xeval::planted_control(&films, &gt, &s);
    let draft_control = xeval::draft_control_record(moved, caught);
    println!("planted control (draft values, recorded, not gating): {caught} of {moved} points moved 5 mm were flagged ({:.1}%){}",
        caught as f64 / moved.max(1) as f64 * 100.0, if draft_control["blind"] == true { " -- BLIND at the draft values" } else { "" });
    let tuned = xeval::tune(&films, &gt, &s, &seen)?;
    // The tuned values, on valid, and the same control with them.
    let tp = ceph_infer::crosscheck::Params { rule_version: "crosscheck/1".into(), spread_window_cells: tuned["window"].as_u64().context("window")? as usize,
        sigma0_mm: tuned["sigma0Mm"].as_f64().context("sigma0")?, t: serde_json::from_value(tuned["t"].clone())?, k: serde_json::from_value(tuned["k"].clone())?, ..p.clone() };
    let ts = xeval::Setup { window: tp.spread_window_cells, params: &tp, ..s };
    let valid_rows = xeval::rows(&films, &gt, &ts);
    let valid = xeval::metrics(&valid_rows, &seen)?;
    let (moved2, caught2) = xeval::planted_control(&films, &gt, &ts);
    println!("planted control (tuned values): {caught2} of {moved2} flagged ({:.1}%)", caught2 as f64 / moved2.max(1) as f64 * 100.0);
    // Prereg step 4 (preflight a2): the control must pass WITH THE TUNED VALUES, or no result counts.
    xeval::not_blind(moved2, caught2)?;
    let outcomes: std::collections::BTreeMap<&str, usize> = valid_rows.iter().fold(Default::default(), |mut m, r| {
        *m.entry(match &r.check.outcome { Outcome::Agree => "agree", Outcome::Review { .. } => "review", Outcome::Conflict { .. } => "conflict",
            Outcome::NotChecked { why } => match why { ceph_infer::crosscheck::NotCheckedWhy::TooFewAnswered => "not checked: too few answered",
                ceph_infer::crosscheck::NotCheckedWhy::NoSpread => "not checked: no spread", ceph_infer::crosscheck::NotCheckedWhy::BadScale => "not checked: bad scale" } }).or_default() += 1; m });
    // Best single model per point on valid (Q2, measured early): lowest valid mean error among the voters.
    let mut best = std::collections::BTreeMap::new();
    for lm in &landmarks {
        let mre = |m: &str| { let e: Vec<f64> = films.iter().filter_map(|f| { let g = xeval::guess(f, m, lm, ts.window)?; let t = gt.get(&f.film)?.iter().find(|x| &x.0 == lm)?;
            Some(ceph_bench::metrics::radial_error_mm((g.x, g.y), (t.1, t.2), f.mm_per_px)) }).collect(); (!e.is_empty()).then(|| e.iter().sum::<f64>() / e.len() as f64) };
        if let Some((m, _)) = voters.iter().filter_map(|m| mre(m).map(|v| (m.clone(), v))).min_by(|a, b| a.1.total_cmp(&b.1)) { best.insert(lm.clone(), m); }
    }
    let out = serde_json::json!({ "tuning": tuned, "validMetrics": valid, "validOutcomes": outcomes, "inSample": "tuned on these films (Aariz valid)",
        "plantedControl": { "draft": draft_control, "tuned": { "moved": moved2, "flagged": caught2, "gating": true } },
        "bestPerPoint": best, "combining": xeval::combining(&films, &gt, &ts, Some(&best)),
        "combiningNote": "bench only: the app never places a combined point",
        "seenByBothVoters": seen_set,
        "leakage": "Aariz valid: SRPose, GU2Net, cwlachap clean; Aariz clean (not trained on, used by its authors for model selection)",
        "voters": voters, "cache": { "gitSha": h.git_sha, "models": h.models, "providers": h.providers, "aarizScale": h.aariz_scale },
        "aarizScale": h.aariz_scale, "gitSha": ceph_bench::provenance(&a.data, "").git_sha });
    std::fs::create_dir_all(a.out())?;
    std::fs::write(a.out().join("tuning.json"), serde_json::to_string_pretty(&out)? + "\n")?;
    if let Some(c) = &h.aariz_scale { println!("{}", ceph_bench::report::scale_line(c)); }
    println!("cache git {}, providers {:?}", h.git_sha, h.providers);
    println!("window {} cells, sigma0 {} mm, k {}, T per landmark {}", tuned["window"], tuned["sigma0Mm"], tuned["k"], tuned["t"]);
    println!("valid: sensitivity {:.3} [{:.3}, {:.3}]  burden {:.3} [{:.3}, {:.3}]  AUROC {:.3} [{:.3}, {:.3}]  Spearman {:?}  (in-sample: tuned on these films)",
        valid.sensitivity.estimate, valid.sensitivity.lo, valid.sensitivity.hi, valid.burden.estimate, valid.burden.lo, valid.burden.hi, valid.auroc.estimate, valid.auroc.lo, valid.auroc.hi, valid.spearman);
    println!("rows compared: {} placed points on {} films; off {}; checked {}; flagged {}; outcomes {:?}", valid.placed, valid.films, valid.off, valid.checked, valid.flagged, outcomes);
    println!("checked points with no finite D2 (left out of the AUROC): {}; k-fit points left out, by model and reason: {}", valid.checked_unscored, tuned["kExcluded"]);
    // Ruling (Task 6 fix round 1): the catch-target table, valid only, for the owner (per landmark in tuning.json).
    for c in tuned["catchTargets"].as_array().context("catchTargets")? {
        println!("catch target {}{}: sensitivity {:.3} [{:.3}, {:.3}]  burden {:.3}  T differs from 5.99 on {} landmarks",
            c["catchTarget"], if c["preRegistered"].as_bool() == Some(true) { " (pre-registered)" } else { "" },
            c["sensitivity"]["estimate"].as_f64().unwrap_or(f64::NAN), c["sensitivity"]["lo"].as_f64().unwrap_or(f64::NAN), c["sensitivity"]["hi"].as_f64().unwrap_or(f64::NAN),
            c["burden"]["estimate"].as_f64().unwrap_or(f64::NAN), c["t"].as_object().map_or(0, |t| t.values().filter(|v| v.as_f64() != Some(5.99)).count()));
    }
    println!("valid verdict (in-sample, not the test): {:?}", valid.verdict);
    println!("written {}", a.out().join("tuning.json").display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn several_manifests_are_separated_by_commas() {
        assert_eq!(manifests(Path::new("a/manifest.json,b/manifest.json")), [PathBuf::from("a/manifest.json"), PathBuf::from("b/manifest.json")]);
        assert_eq!(manifests(Path::new("models/manifest.json")), [PathBuf::from("models/manifest.json")]);
    }
    #[test] fn a_missing_manifest_is_named_in_the_error() {
        let e = format!("{:#}", model_id(Path::new("models/no-such-model/manifest.json")).unwrap_err());
        assert!(e.contains("models/no-such-model/manifest.json"), "{e}");
    }
    fn args(v: &[&str]) -> Args { Args::parse_from([&["ceph-bench", "--out", "/tmp/x"], v].concat()) }
    /// Synthetic empty dataset folders (never the real data/), as `--data` strings.
    fn fixture() -> (tempfile::TempDir, String, String) {
        let d = tempfile::tempdir().unwrap();
        for n in ["aariz", "ceph400"] { std::fs::create_dir_all(d.path().join(n)).unwrap(); }
        let s = |n: &str| d.path().join(n).to_string_lossy().to_string();
        let (a, c) = (s("aariz"), s("ceph400"));
        (d, a, c)
    }
    /// Stage A Task 3: `--shape-prior <out>` needs no `--out`, runs alone, and writes only under a folder named `models`.
    /// Fails if it could be combined with another mode, or if an output outside `models` passed the preflight.
    #[test] fn shape_prior_runs_alone_and_only_into_a_models_folder() {
        let (_d, _, c4) = fixture();
        let sp = |v: &[&str]| Args::try_parse_from([&["ceph-bench", "--data", &c4], v].concat());
        let a = sp(&["--shape-prior", "models/shape/ceph400-v1.shape"]).unwrap();
        assert!(preflight(&a).is_ok());
        assert!(Args::try_parse_from(["ceph-bench"]).is_err(), "without --shape-prior, --out is still required");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--decide-source"], &["--crosscheck-run"],
                      &["--diag-facing"], &["--out", "/tmp/x"], &["--chain-proof", "s1"], &["--parity", "p.csv"]] {
            let e = preflight(&sp(&[&["--shape-prior", "models/shape/x.shape"][..], other].concat()).unwrap()).unwrap_err().to_string();
            eprintln!("--shape-prior with {other:?}: {e}");
            assert!(e.contains("--shape-prior runs alone"), "{other:?}: {e}");
        }
        let e = preflight(&sp(&["--shape-prior", "reports/ceph400-v1.shape"]).unwrap()).unwrap_err().to_string();
        eprintln!("--shape-prior reports/ceph400-v1.shape: {e}");
        assert!(e.contains("git-ignored models folder"), "{e}");
    }
    /// SC-1 Task 3: both modes need no `--out`, run alone, ignore the default `--split` (test1), refuse a typed one other
    /// than train, and refuse Aariz test, Test2 and any non-Aariz folder BEFORE any file is read (the fixture folders are
    /// empty: a read would fail with "No such file", not with these messages). Fails if any check is removed.
    #[test] fn the_sc1_modes_run_alone_read_train_only_and_refuse_held_back_folders() {
        let (_d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        for mode in ["--sc1-split", "--sc1-teaching-boxes"] {
            let ok = sc(&["--data", &az, mode, "/tmp/sc1-x"]).unwrap();
            assert!(preflight(&ok).is_ok(), "{mode}: the default --split (test1) is ignored");
            assert!(preflight(&sc(&["--data", &az, "--split", "train", mode, "/tmp/sc1-x"]).unwrap()).is_ok(), "{mode}: --split train is fine");
            for bad in ["valid", "test", "test1", "all"] {
                let e = preflight(&sc(&["--data", &az, "--split", bad, mode, "/tmp/sc1-x"]).unwrap()).unwrap_err().to_string();
                eprintln!("{mode} --split {bad}: {e}");
                assert!(e.contains("held back") || e.contains("train only"), "{bad}: {e}");
            }
            let e = preflight(&sc(&["--data", &c4, mode, "/tmp/sc1-x"]).unwrap()).unwrap_err().to_string();
            eprintln!("{mode} on ceph400: {e}");
            assert!(e.contains("Aariz"), "{e}");
            let e = preflight(&sc(&["--data", &c4, "--split", "test2", mode, "/tmp/sc1-x"]).unwrap()).unwrap_err().to_string();
            eprintln!("{mode} on ceph400 test2: {e}");
            assert!(e.contains("held back"), "{e}");
            for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--decide-source"], &["--crosscheck-run"],
                          &["--diag-facing"], &["--out", "/tmp/x"], &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--shape-prior", "models/shape/x.shape"]] {
                let e = preflight(&sc(&[&["--data", &az, mode, "/tmp/sc1-x"][..], other].concat()).unwrap()).unwrap_err().to_string();
                assert!(e.contains("runs alone"), "{mode} with {other:?}: {e}");
            }
        }
        let e = preflight(&sc(&["--data", &az, "--sc1-split", "/tmp/a", "--sc1-teaching-boxes", "/tmp/b"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("each run alone"), "{e}");
        assert!(sc(&["--data", &az, "--sc1-split", "/tmp/sc1-x"]).unwrap().out.is_none(), "no --out needed");
    }
    /// SC-1 Task 4: `--sc1-faithfulness` needs its four paths, runs alone, reads Aariz train only (the default --split is
    /// ignored, a typed one must be train) and refuses Aariz test, Test2 and non-Aariz folders before any file is read (the
    /// fixture folders are empty). Fails if any of those checks is removed, or if its paths are accepted without the mode.
    #[test] fn sc1_faithfulness_needs_its_paths_runs_alone_and_reads_aariz_train_only() {
        let (_d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let paths = ["--split-file", "s.json", "--boxes", "/tmp/sc1-boxes", "--pytorch", "p.json", "--out", "/tmp/sc1-f"];
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--sc1-faithfulness"][..], &paths, extra].concat()).unwrap();
        assert!(preflight(&with(&[])).is_ok(), "the default --split (test1) is ignored");
        assert!(preflight(&with(&["--split", "train"])).is_ok());
        for (i, flag) in ["--split-file", "--boxes", "--pytorch", "--out"].iter().enumerate() {
            let mut v: Vec<&str> = vec!["--data", &az, "--sc1-faithfulness"];
            for (j, pair) in paths.chunks(2).enumerate() { if j != i { v.extend_from_slice(pair); } }
            if *flag == "--out" { assert!(sc(&v).is_err(), "clap requires --out for this mode"); eprintln!("without --out: clap refuses (--out required)"); continue; }
            let e = preflight(&sc(&v).unwrap()).unwrap_err().to_string();
            eprintln!("--sc1-faithfulness without {flag}: {e}");
            assert!(e.contains("needs --split-file, --boxes, --pytorch and --out"), "{flag}: {e}");
        }
        for bad in ["valid", "test", "test1", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-faithfulness --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("train only"), "{bad}: {e}");
        }
        let on = |data: &str, extra: &[&str]| sc(&[&["--data", data, "--sc1-faithfulness"][..], &paths, extra].concat()).unwrap();
        let e = preflight(&on(&c4, &[])).unwrap_err().to_string();
        eprintln!("--sc1-faithfulness on ceph400: {e}");
        assert!(e.contains("Aariz"), "{e}");
        assert!(preflight(&on(&c4, &["--split", "test2"])).unwrap_err().to_string().contains("held back"));
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--crosscheck-run"], &["--diag-facing"],
                      &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"],
                      &["--stage-a-acceptance"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
        }
        let e = preflight(&sc(&["--data", &az, "--out", "/tmp/x", "--pytorch", "p.json"]).unwrap()).unwrap_err().to_string();
        eprintln!("--pytorch without the mode: {e}");
        assert!(e.contains("only with --sc1-faithfulness"), "{e}");
    }
    /// SC-1 Task 10: `--sc1-box-gate` needs no `--out` (it writes reports/sc1), runs alone, reads Aariz train for the gate
    /// (the default --split is ignored, a typed one must be train), takes Ceph-400 from `--ceph400` (default data/ceph400),
    /// and refuses Aariz test, Test2, a non-Aariz --data and a non-Ceph-400 --ceph400 before any file is read (the fixture
    /// folders are empty). Fails if any of those checks is removed, or if --ceph400 is accepted without the mode.
    #[test] fn sc1_box_gate_runs_alone_and_reads_the_aariz_hold_out() {
        let (_d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-box-gate"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "the default --split (test1) is ignored");
        assert!(ok.out.is_none() && ok.ceph400 == PathBuf::from(&c4));
        assert_eq!(sc(&["--data", &az, "--sc1-box-gate"]).unwrap().ceph400, PathBuf::from("data/ceph400"));
        assert!(preflight(&with(&["--split", "train"])).is_ok());
        for bad in ["valid", "test", "test1", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-box-gate --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("train only"), "{bad}: {e}");
        }
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-box-gate"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-box-gate with --data ceph400: {e}");
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &az, "--ceph400", &az, "--sc1-box-gate"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-box-gate with --ceph400 aariz: {e}");
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--crosscheck-run"], &["--diag-facing"], &["--out", "/tmp/x"],
                      &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"],
                      &["--stage-a-acceptance"], &["--sc1-faithfulness"], &["--shape-prior", "models/shape/x.shape"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
        }
        let e = preflight(&sc(&["--data", &az, "--out", "/tmp/x", "--ceph400", &c4]).unwrap()).unwrap_err().to_string();
        eprintln!("--ceph400 without the mode: {e}");
        assert!(e.contains("only with --sc1-box-gate, --sc1-region-probe, --sc1-box-gate-2 or --sc1-1a"), "{e}");
    }
    /// The region probe (owner, 5 Nov): `--sc1-region-probe` needs no `--out`, runs alone, reads train only (a typed
    /// --split other than train is refused: SC1-1a's test1 and valid, the held-back test and test2, and all), and needs
    /// --data Aariz and --ceph400 Ceph-400.
    #[test] fn sc1_region_probe_runs_alone_and_reads_train_only() {
        let (_d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-region-probe"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "the default --split (test1) is ignored");
        assert!(ok.out.is_none() && ok.ceph400 == PathBuf::from(&c4) && ok.sc1_region_probe);
        assert!(preflight(&with(&["--split", "train"])).is_ok());
        for bad in ["valid", "test", "test1", "test2", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-region-probe --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("train only"), "{bad}: {e}");
        }
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-region-probe"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-region-probe with --data ceph400: {e}");
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &az, "--ceph400", &az, "--sc1-region-probe"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-region-probe with --ceph400 aariz: {e}");
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--crosscheck-run"], &["--diag-facing"], &["--out", "/tmp/x"],
                      &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"],
                      &["--stage-a-acceptance"], &["--sc1-faithfulness"], &["--shape-prior", "models/shape/x.shape"], &["--sc1-box-gate"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
        }
    }
    /// The box gate /2 (owner, 5 Nov): `--sc1-box-gate-2` needs no `--out`, runs alone (and /1 and the probe refuse it
    /// beside them), reads train only (a typed --split other than train is refused), and needs --data Aariz and --ceph400
    /// Ceph-400. Fails if any of those checks is removed.
    /// SC1-1a (Task 11): `--sc1-1a` needs no `--out`, runs alone (only `--cache` may go with it), takes no `--split`
    /// (it reads Ceph-400 test1 and Aariz valid, fixed by the pre-registration), and needs --data Aariz and --ceph400
    /// Ceph-400; Test2 and Aariz test are refused before any file is read. Fails if any of those checks is removed.
    #[test] fn sc1_1a_runs_alone_and_reads_test1_and_valid_only() {
        let (_d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-1a"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.ceph400 == PathBuf::from(&c4) && ok.sc1_1a);
        assert!(preflight(&with(&["--cache", "/tmp/sc1-cache-a,/tmp/sc1-cache-b"])).is_ok(), "--cache goes with it (the real-runs line)");
        for bad in ["test1", "valid", "test", "test2", "train", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-1a --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("leave --split out"), "{bad}: {e}");
        }
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-1a"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-1a with --data ceph400: {e}");
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &az, "--ceph400", &az, "--sc1-1a"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-1a with --ceph400 aariz: {e}");
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--crosscheck-run"], &["--diag-facing"], &["--out", "/tmp/x"],
                      &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"],
                      &["--stage-a-acceptance"], &["--sc1-faithfulness"], &["--shape-prior", "models/shape/x.shape"], &["--sc1-box-gate"],
                      &["--sc1-region-probe"], &["--sc1-box-gate-2"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
        }
    }
    #[test] fn sc1_box_gate_2_runs_alone_and_reads_train_only() {
        let (_d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-box-gate-2"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "the default --split (test1) is ignored: {:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.ceph400 == PathBuf::from(&c4) && ok.sc1_box_gate_2);
        assert!(preflight(&with(&["--split", "train"])).is_ok());
        for bad in ["valid", "test", "test1", "test2", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-box-gate-2 --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("train only"), "{bad}: {e}");
        }
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-box-gate-2"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-box-gate-2 with --data ceph400: {e}");
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &az, "--ceph400", &az, "--sc1-box-gate-2"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-box-gate-2 with --ceph400 aariz: {e}");
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--crosscheck-run"], &["--diag-facing"], &["--out", "/tmp/x"],
                      &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"],
                      &["--stage-a-acceptance"], &["--sc1-faithfulness"], &["--shape-prior", "models/shape/x.shape"], &["--sc1-box-gate"], &["--sc1-region-probe"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
            if other[0].starts_with("--sc1-box-gate") || other[0] == "--sc1-region-probe" || other[0] == "--out" {
                assert!(e.contains("--sc1-box-gate-2 runs alone"), "/2's own check, not another mode's: {other:?}: {e}");
            }
        }
    }
    /// SC-1 Part 1b Task C0 (owner OQ-1b-A = A): `--sc1-box-gate-3` needs no `--out`, runs alone, takes no `--split` (it
    /// reads Aariz train and valid, Ceph-400 train and test1, fixed by the pre-registration), needs --data Aariz and
    /// --ceph400 Ceph-400; Test2, Aariz test and PKU are refused before any file is read. Fails if any check is removed.
    #[test] fn sc1_box_gate_3_runs_alone_and_takes_no_split() {
        let (d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-box-gate-3"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "the default --split is ignored: {:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.sc1_box_gate_3);
        for bad in ["train", "valid", "test1", "test", "test2", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-box-gate-3 --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("leave --split out"), "{bad}: {e}");
        }
        let pku = d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        let e = preflight(&sc(&["--data", &pku.to_string_lossy(), "--ceph400", &c4, "--sc1-box-gate-3", "--split", "test"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-box-gate-3 on PKU: {e}");
        assert!(e.contains("sealed"), "{e}");
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-box-gate-3"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &az, "--ceph400", &az, "--sc1-box-gate-3"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--diag-facing"], &["--out", "/tmp/x"], &["--cache", "/tmp/c"],
                      &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"],
                      &["--stage-a-acceptance"], &["--sc1-faithfulness"], &["--shape-prior", "models/shape/x.shape"], &["--sc1-box-gate"],
                      &["--sc1-region-probe"], &["--sc1-box-gate-2"], &["--sc1-1a"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("--sc1-box-gate-3 runs alone"), "with {other:?}: {e}");
        }
    }
    /// SC-1 Part 1b Task C: `--sc1-size-calibrate` needs no `--out`, runs alone, takes no `--split` (it reads the 520
    /// calibration films fixed by reference/sc1-size.json), needs --data Aariz and --ceph400 Ceph-400; Test2, Aariz test
    /// and PKU are refused before any file is read. Fails if any of those checks is removed.
    #[test] fn sc1_size_calibrate_runs_alone_and_takes_no_split() {
        let (d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-size-calibrate"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.sc1_size_calibrate);
        for bad in ["train", "valid", "test1", "test", "test2", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-size-calibrate --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("leave --split out"), "{bad}: {e}");
        }
        let pku = d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        let e = preflight(&sc(&["--data", &pku.to_string_lossy(), "--ceph400", &c4, "--sc1-size-calibrate", "--split", "test"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("sealed"), "{e}");
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-size-calibrate"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &az, "--ceph400", &az, "--sc1-size-calibrate"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--diag-facing"], &["--out", "/tmp/x"], &["--cache", "/tmp/c"],
                      &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"],
                      &["--stage-a-acceptance"], &["--sc1-faithfulness"], &["--shape-prior", "models/shape/x.shape"], &["--sc1-box-gate"],
                      &["--sc1-region-probe"], &["--sc1-box-gate-2"], &["--sc1-box-gate-3"], &["--sc1-1a"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("--sc1-size-calibrate runs alone"), "with {other:?}: {e}");
        }
    }
    /// whole-film/3 (owner ruling, 5 Nov 2026): `--sc1-1b-dev3` runs alone, takes no `--split` or `--out`, needs --data
    /// Aariz and --ceph400 Ceph-400; Test2, Aariz test and PKU refused. `--sc1-whole-film-3` runs alone and takes no
    /// --data, --ceph400, --split or --out (it reads no film). Fails if any check is removed.
    #[test] fn sc1_whole_film_3_and_its_confirmation_run_run_alone() {
        let (d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-1b-dev3"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.sc1_1b_dev3);
        for bad in ["train", "valid", "test1", "test", "test2", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            assert!(e.contains("held back") || e.contains("leave --split out"), "{bad}: {e}");
        }
        let pku = d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        let e = preflight(&sc(&["--data", &pku.to_string_lossy(), "--ceph400", &c4, "--sc1-1b-dev3", "--split", "test"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-1b-dev3 on PKU test: {e}");
        assert!(e.contains("sealed"), "{e}");
        for other in [&["--out", "/tmp/x"][..], &["--cache", "/tmp/c"], &["--sc1-1b-dev"], &["--sc1-1b-dev-decompose"], &["--sc1-whole-film-3"], &["--sc1-1a"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "--sc1-1b-dev3 with {other:?}: {e}");
        }
        let w = sc(&["--sc1-whole-film-3"]).unwrap();
        assert!(preflight(&w).is_ok(), "{:?}", preflight(&w).err());
        assert!(w.sc1_whole_film_3 && w.out.is_none());
        for other in [&["--data", &az][..], &["--ceph400", &c4], &["--split", "valid"], &["--sc1-1b-dev3"], &["--sc1-cb-calibrate"], &["--sc1-calibrations-from-reports", "/tmp/r"]] {
            let e = preflight(&sc(&[&["--sc1-whole-film-3"][..], other].concat()).unwrap()).unwrap_err().to_string();
            eprintln!("--sc1-whole-film-3 with {other:?}: {e}");
            assert!(e.contains("runs alone"), "--sc1-whole-film-3 with {other:?}: {e}");
        }
        // Bundling the check (6 Nov 2026): --out names the models folder to set up (a new folder outside models/); default models.
        let w = sc(&["--sc1-whole-film-3", "--out", "/tmp/check-files/models"]).unwrap();
        assert!(preflight(&w).is_ok(), "{:?}", preflight(&w).err());
        assert_eq!(wf3_models(&w), PathBuf::from("/tmp/check-files/models"));
        assert_eq!(wf3_models(&sc(&["--sc1-whole-film-3"]).unwrap()), PathBuf::from("models"));
    }
    /// Bundling the check (6 Nov 2026): `--sc1-calibrations-from-reports <reports>` needs --out (the new models folder),
    /// runs alone and reads no film (no --data, --ceph400 or --split). Fails if any check is removed.
    #[test] fn sc1_calibrations_from_reports_runs_alone_with_out() {
        let (_d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let ok = sc(&["--sc1-calibrations-from-reports", "/tmp/r", "--out", "/tmp/m"]).unwrap();
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(sc(&["--sc1-calibrations-from-reports", "/tmp/r"]).is_err(), "clap requires --out");
        for other in [&["--data", &az][..], &["--ceph400", &c4], &["--split", "valid"], &["--sc1-whole-film-3"], &["--sc1-size-calibrate"]] {
            let e = preflight(&sc(&[&["--sc1-calibrations-from-reports", "/tmp/r", "--out", "/tmp/m"][..], other].concat()).unwrap()).unwrap_err().to_string();
            eprintln!("--sc1-calibrations-from-reports with {other:?}: {e}");
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
        }
    }
    /// SC-1 Part 1b Task E information (owner, 5 Nov 2026): `--sc1-1b-dev-decompose` runs alone, takes no `--split` or
    /// `--out`, needs --data Aariz and --ceph400 Ceph-400; Test2, Aariz test and PKU refused. Fails if any check is removed.
    #[test] fn sc1_1b_dev_decompose_runs_alone() {
        let (d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-1b-dev-decompose"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.sc1_1b_dev_decompose);
        for bad in ["train", "valid", "test1", "test", "test2", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            assert!(e.contains("held back") || e.contains("leave --split out"), "{bad}: {e}");
        }
        let pku = d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        let e = preflight(&sc(&["--data", &pku.to_string_lossy(), "--ceph400", &c4, "--sc1-1b-dev-decompose", "--split", "test"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-1b-dev-decompose on PKU test: {e}");
        assert!(e.contains("sealed"), "{e}");
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-1b-dev-decompose"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Aariz"), "{e}");
        for other in [&["--out", "/tmp/x"][..], &["--cache", "/tmp/c"], &["--sc1-1b-dev"], &["--sc1-1a"], &["--sc1-cb-calibrate"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
        }
    }
    /// SC-1 Part 1b Task E: `--sc1-1b-dev` needs no `--out`, runs alone, takes no `--split` (it reads SC1-1a's films,
    /// fixed by reference/sc1-1b-dev.json), needs --data Aariz and --ceph400 Ceph-400; Test2, Aariz test and PKU are refused
    /// before any file is read. Fails if any of those checks is removed.
    #[test] fn sc1_1b_dev_runs_alone_and_takes_no_split() {
        let (d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-1b-dev"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.sc1_1b_dev);
        for bad in ["train", "valid", "test1", "test", "test2", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-1b-dev --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("leave --split out"), "{bad}: {e}");
        }
        let pku = d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        let e = preflight(&sc(&["--data", &pku.to_string_lossy(), "--ceph400", &c4, "--sc1-1b-dev", "--split", "test"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-1b-dev on PKU test: {e}");
        assert!(e.contains("sealed"), "{e}");
        let e = preflight(&sc(&["--data", &pku.to_string_lossy(), "--ceph400", &c4, "--sc1-1b-dev"]).unwrap()).unwrap_err().to_string();
        eprintln!("--sc1-1b-dev on PKU, no split: {e}");
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-1b-dev"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &az, "--ceph400", &az, "--sc1-1b-dev"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--out", "/tmp/x"], &["--cache", "/tmp/c"], &["--sc1-1a"], &["--sc1-cb-calibrate"],
                      &["--sc1-size-calibrate"], &["--sc1-box-gate-3"], &["--sc1-box-gate-2"], &["--stage-a-acceptance"], &["--shape-prior", "models/shape/x.shape"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
        }
    }
    /// SC-1 Part 1b Task D: `--sc1-cb-calibrate` needs no `--out`, runs alone, takes no `--split` (it reads the 520
    /// calibration films fixed by reference/sc1-cb-centre.json), needs --data Aariz and --ceph400 Ceph-400; Test2, Aariz test
    /// and PKU are refused before any file is read. Fails if any of those checks is removed.
    #[test] fn sc1_cb_calibrate_runs_alone_and_takes_no_split() {
        let (d, az, c4) = fixture();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--data", &az, "--ceph400", &c4, "--sc1-cb-calibrate"][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.sc1_cb_calibrate);
        for bad in ["train", "valid", "test1", "test", "test2", "all"] {
            let e = preflight(&with(&["--split", bad])).unwrap_err().to_string();
            eprintln!("--sc1-cb-calibrate --split {bad}: {e}");
            assert!(e.contains("held back") || e.contains("leave --split out"), "{bad}: {e}");
        }
        let pku = d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        let e = preflight(&sc(&["--data", &pku.to_string_lossy(), "--ceph400", &c4, "--sc1-cb-calibrate", "--split", "test"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("sealed"), "{e}");
        let e = preflight(&sc(&["--data", &c4, "--ceph400", &c4, "--sc1-cb-calibrate"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Aariz"), "{e}");
        let e = preflight(&sc(&["--data", &az, "--ceph400", &az, "--sc1-cb-calibrate"]).unwrap()).unwrap_err().to_string();
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--crosscheck-tune"][..], &["--scale-check"], &["--orient"], &["--diag-facing"], &["--out", "/tmp/x"], &["--cache", "/tmp/c"],
                      &["--chain-proof", "s1"], &["--parity", "p.csv"], &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"],
                      &["--stage-a-acceptance"], &["--sc1-faithfulness"], &["--shape-prior", "models/shape/x.shape"], &["--sc1-box-gate"],
                      &["--sc1-region-probe"], &["--sc1-box-gate-2"], &["--sc1-box-gate-3"], &["--sc1-1a"], &["--sc1-size-calibrate"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            assert!(e.contains("runs alone"), "with {other:?}: {e}");
        }
    }
    /// SC-1 Part 1b Task A: `--pku-prepare <raw>` needs no `--out`, runs alone (no other mode, no --split, no --data), and
    /// needs --ceph400 typed (C12); refused before any file is read (the fixture folders are empty). Fails if any of
    /// those checks is removed.
    /// SC-1 Part 1b Task F: `--sc1-1b-pku` runs alone, needs --data naming the pku folder and --ceph400, and refuses
    /// --split, --out and every other mode before anything is read (the seal itself opens only inside the run). Fails if:
    /// its branch is not first, a mode or flag is let through, or --data may be another folder.
    #[test] fn sc1_1b_pku_runs_alone() {
        let (d, _az, c4) = fixture();
        let pku = d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        let pku = pku.to_string_lossy().to_string();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--sc1-1b-pku", "--data", &pku, "--ceph400", &c4][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.sc1_1b_pku);
        for (what, v) in [("no --ceph400", vec!["--sc1-1b-pku", "--data", &pku]), ("no --data", vec!["--sc1-1b-pku", "--ceph400", &c4]),
                          ("--data not the pku folder", vec!["--sc1-1b-pku", "--data", &c4, "--ceph400", &c4]),
                          ("--ceph400 not Ceph-400", vec!["--sc1-1b-pku", "--data", &pku, "--ceph400", &pku])] {
            let e = preflight(&sc(&v).unwrap()).unwrap_err().to_string();
            eprintln!("--sc1-1b-pku, {what}: {e}");
            assert!(e.contains("--sc1-1b-pku needs"), "{what}: {e}");
        }
        for other in [&["--split", "test"][..], &["--split", "all"], &["--sc1-1a"], &["--sc1-1b-dev3"], &["--sc1-box-gate-3"], &["--sc1-cb-calibrate"],
                      &["--out", "/tmp/x"], &["--cache", "/tmp/c"], &["--crosscheck-run"], &["--scale-check"], &["--orient"], &["--chain-proof", "s1"],
                      &["--pku-prepare", "/tmp/r"], &["--sc1-whole-film-3"], &["--sc1-size-calibrate"], &["--stage-a-acceptance"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            eprintln!("--sc1-1b-pku with {other:?}: {e}");
            assert!(e.contains("--sc1-1b-pku runs alone"), "with {other:?}: {e}");
        }
    }
    #[test] fn pku_prepare_runs_alone() {
        let (d, _az, c4) = fixture();
        let raw = d.path().join("pku").join("unpacked").join("dental-cepha-dataset");
        std::fs::create_dir_all(&raw).unwrap();
        let raw = raw.to_string_lossy().to_string();
        let sc = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat());
        let with = |extra: &[&str]| sc(&[&["--pku-prepare", &raw, "--ceph400", &c4][..], extra].concat()).unwrap();
        let ok = with(&[]);
        assert!(preflight(&ok).is_ok(), "{:?}", preflight(&ok).err());
        assert!(ok.out.is_none() && ok.pku_prepare.is_some());
        let e = preflight(&sc(&["--pku-prepare", &raw]).unwrap()).unwrap_err().to_string();
        eprintln!("--pku-prepare without --ceph400: {e}");
        assert!(e.contains("--ceph400"), "{e}");
        let e = preflight(&sc(&["--pku-prepare", &raw, "--ceph400", &raw]).unwrap()).unwrap_err().to_string();
        eprintln!("--pku-prepare with --ceph400 not Ceph-400: {e}");
        assert!(e.contains("Ceph-400"), "{e}");
        for other in [&["--split", "test"][..], &["--split", "test1"], &["--data", &c4], &["--sc1-1a"], &["--sc1-box-gate"], &["--sc1-box-gate-2"],
                      &["--sc1-region-probe"], &["--sc1-faithfulness"], &["--crosscheck-tune"], &["--scale-check"], &["--orient"],
                      &["--crosscheck-run"], &["--diag-facing"], &["--out", "/tmp/x"], &["--chain-proof", "s1"], &["--parity", "p.csv"],
                      &["--sc1-split", "/tmp/a"], &["--sc1-teaching-boxes", "/tmp/b"], &["--stage-a-acceptance"],
                      &["--shape-prior", "models/shape/x.shape"], &["--cache", "/tmp/c"]] {
            let e = preflight(&with(other)).unwrap_err().to_string();
            eprintln!("--pku-prepare with {other:?}: {e}");
            assert!(e.contains("--pku-prepare runs alone"), "with {other:?}: {e}");
        }
    }
    /// C5 through the command line: the PKU folder as --data is refused by the ordinary modes (the seal), for its test
    /// split and for "all". Fails if the generic gate stops consulting the seal.
    /// SC-1 Part 1b Task B: `--sc1-reference <out>` runs alone, needs the Aariz and Ceph-400 folders, refuses Aariz valid
    /// and test and Ceph-400 Test2 before any read, and writes only under `models`, never Stage A's file. Fails if any of
    /// these gates is dropped from the preflight.
    #[test] fn sc1_reference_runs_alone_and_refuses_closed_splits_before_any_read() {
        let (d, az, c4) = fixture();
        let sr = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat()).unwrap();
        let out = "models/shape/whole-film-reference-v1.shape";
        let base = ["--data", az.as_str(), "--ceph400", c4.as_str(), "--sc1-reference", out];
        assert!(preflight(&sr(&base)).is_ok(), "{:?}", preflight(&sr(&base)));
        for (split, want) in [("valid", "--split valid is refused"), ("test", "held back"), ("test2", "held back"), ("all", "held back")] {
            let e = preflight(&sr(&[&base[..], &["--split", split]].concat())).unwrap_err().to_string();
            eprintln!("--sc1-reference --split {split}: {e}");
            assert!(e.contains(want), "{split}: {e}");
        }
        for other in [&["--out", "/tmp/x"][..], &["--sc1-1a"], &["--shape-prior", "models/shape/x.shape"], &["--crosscheck-run"], &["--scale-check"]] {
            let e = preflight(&sr(&[&base[..], other].concat())).unwrap_err().to_string();
            eprintln!("--sc1-reference with {other:?}: {e}");
            assert!(e.contains("--sc1-reference runs alone"), "{other:?}: {e}");
        }
        for (bad, want) in [("reports/w.shape", "models"), ("models/shape/ceph400-v1.shape", "Stage A")] {
            let e = preflight(&sr(&["--data", &az, "--ceph400", &c4, "--sc1-reference", bad])).unwrap_err().to_string();
            eprintln!("--sc1-reference {bad}: {e}");
            assert!(e.contains(want), "{bad}: {e}");
        }
        let pku = d.path().join("pku"); std::fs::create_dir_all(&pku).unwrap();
        let pku = pku.to_string_lossy().to_string();
        for (v, want) in [(["--data", c4.as_str(), "--ceph400", c4.as_str()], "Aariz"), (["--data", pku.as_str(), "--ceph400", c4.as_str()], "Aariz"),
                          (["--data", az.as_str(), "--ceph400", az.as_str()], "Ceph-400")] {
            let e = preflight(&sr(&[&v[..], &["--sc1-reference", out]].concat())).unwrap_err().to_string();
            eprintln!("--sc1-reference {v:?}: {e}");
            assert!(e.contains(want), "{v:?}: {e}");
        }
        let e = preflight(&sr(&["--data", &az, "--sc1-reference", out])).unwrap_err().to_string();
        eprintln!("--sc1-reference without --ceph400: {e}");
        assert!(e.contains("--ceph400"), "{e}");
    }
    /// Fix round 1 (F2): `--sc1-reference-lines <file>` runs alone and only on a file under models. Fails if it could be
    /// combined with another mode (or --data, --split) or read a file outside models.
    #[test] fn sc1_reference_lines_runs_alone_on_a_file_under_models() {
        let (_d, az, _) = fixture();
        let sl = |v: &[&str]| Args::parse_explicit([&["ceph-bench"][..], v].concat()).unwrap();
        let f = "models/shape/whole-film-reference-v1.shape";
        assert!(preflight(&sl(&["--sc1-reference-lines", f])).is_ok());
        for other in [&["--out", "/tmp/x"][..], &["--sc1-reference", f], &["--data", az.as_str()], &["--split", "train"], &["--sc1-1a"]] {
            let e = preflight(&sl(&[&["--sc1-reference-lines", f][..], other].concat())).unwrap_err().to_string();
            eprintln!("--sc1-reference-lines with {other:?}: {e}");
            assert!(e.contains("--sc1-reference-lines runs alone"), "{other:?}: {e}");
        }
        let e = preflight(&sl(&["--sc1-reference-lines", "reports/w.shape"])).unwrap_err().to_string();
        eprintln!("--sc1-reference-lines reports/w.shape: {e}");
        assert!(e.contains("models"), "{e}");
    }
    #[test] fn the_pku_folder_is_refused_by_the_other_modes() {
        let d = tempfile::tempdir().unwrap();
        let pku = d.path().join("pku");
        std::fs::create_dir_all(&pku).unwrap();
        let p = pku.to_string_lossy().to_string();
        for v in [&["--data", &p, "--split", "test"][..], &["--data", &p, "--split", "all", "--scale-check"], &["--data", &p, "--split", "test", "--orient"]] {
            let e = preflight(&args(v)).unwrap_err().to_string();
            eprintln!("{v:?}: {e}");
            assert!(e.contains("sealed"), "{v:?}: {e}");
        }
    }
    #[test] fn the_held_back_splits_are_refused_before_anything_runs() {
        let (_d, az, c4) = fixture();
        let e = preflight(&args(&["--data", &az, "--split", "test"])).unwrap_err().to_string();
        assert!(e.contains("held back"), "{e}");
        assert!(preflight(&args(&["--data", &c4, "--split", "test2"])).is_err());
        assert!(preflight(&args(&["--data", &az, "--split", "valid"])).is_ok());
    }
    #[test] fn diag_facing_writes_no_scores_and_its_control_needs_it() {
        let (_d, az, _) = fixture();
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--diag-facing", "--scores-out", "/tmp/s.json", "--leakage", "clean"]))
            .unwrap_err().to_string();
        assert!(e.contains("--diag-facing"), "{e}");
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--diag-flip-control"])).unwrap_err().to_string();
        assert!(e.contains("--diag-flip-control"), "{e}");
        assert!(preflight(&args(&["--data", &az, "--split", "valid", "--diag-facing", "--diag-flip-control"])).is_ok());
        assert!(preflight(&args(&["--data", &az, "--split", "test", "--diag-facing"])).is_err());     // held back still refused
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--diag-pad-control", "1.5"])).unwrap_err().to_string();
        assert!(e.contains("--diag-pad-control"), "{e}");
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--diag-facing", "--diag-pad-control", "0.8"])).unwrap_err().to_string();
        assert!(e.contains("0.8"), "{e}");
        assert!(preflight(&args(&["--data", &az, "--split", "valid", "--diag-facing", "--diag-pad-control", "1.5"])).is_ok());
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--diag-reframe-control"])).unwrap_err().to_string();
        assert!(e.contains("--diag-reframe-control"), "{e}");
        assert!(preflight(&args(&["--data", &az, "--split", "valid", "--diag-facing", "--diag-reframe-control"])).is_ok());
    }
    #[test] fn scale_check_runs_no_model_writes_no_scores_and_still_refuses_held_back_splits() {
        let (_d, az, _) = fixture();
        assert!(preflight(&args(&["--data", &az, "--split", "valid", "--scale-check"])).is_ok());
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--scale-check", "--scores-out", "/tmp/s.json", "--leakage", "clean"])).unwrap_err().to_string();
        assert!(e.contains("--scale-check"), "{e}");
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--scale-check", "--diag-facing"])).unwrap_err().to_string();
        assert!(e.contains("--scale-check"), "{e}");
        assert!(preflight(&args(&["--data", &az, "--split", "test", "--scale-check"])).unwrap_err().to_string().contains("held back"));
    }
    #[test] fn scores_out_needs_a_leakage_word_from_the_three() {
        let (_d, az, _) = fixture();
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--scores-out", "/tmp/s.json"])).unwrap_err().to_string();
        assert!(e.contains("--leakage"), "{e}");
        let e = preflight(&args(&["--data", &az, "--split", "valid", "--scores-out", "/tmp/s.json", "--leakage", "fine"])).unwrap_err().to_string();
        assert!(e.contains("fine"), "{e}");
        assert!(preflight(&args(&["--data", &az, "--split", "valid", "--scores-out", "/tmp/s.json", "--leakage", "home-ground"])).is_ok());
    }
    fn try_args(v: &[&str]) -> Args { Args::try_parse_from([&["ceph-bench", "--out", "/tmp/x"], v].concat()).expect("these flags exist") }
    /// Task 7 edge cases: Aariz test or Ceph-400 Test2 asked of the cross-check modes is refused before anything runs;
    /// a cache does not unlock a held-back set unless the ledger records its single opening (Task 8).
    #[test] fn the_crosscheck_modes_refuse_the_held_back_sets() {
        let (_d, az, c4) = fixture();
        for (data, split) in [(&az, "test"), (&c4, "test2")] {
            let e = preflight(&try_args(&["--data", data, "--split", split, "--crosscheck-tune", "--cache", "/tmp/no-cache"])).unwrap_err().to_string();
            assert!(e.contains("held back"), "{e}");
            let e = preflight(&try_args(&["--data", data, "--split", split, "--crosscheck-run"])).unwrap_err().to_string();
            assert!(e.contains("held back"), "{e}");
        }
        assert!(preflight(&try_args(&["--data", &az, "--split", "valid", "--crosscheck-tune", "--cache", "/tmp/no-cache"])).is_ok(), "control: valid passes");
    }
    /// Final review m6 (owner PARK-FLAGS, 15 Oct 2026: Task 8 cancelled, the test films stay closed). Every use of
    /// `--single-test-run` is refused in plain words before the ledger or the data are looked at: the held-back set it
    /// used to open, a valid split, without `--crosscheck-run`, and a data folder that does not exist (the refusal comes
    /// before any data check). The ledger file is neither created nor changed.
    #[test] fn single_test_run_is_refused_while_the_test_films_stay_closed() {
        let (d, az, _) = fixture();
        let missing = d.path().join("no-such-dataset").to_string_lossy().to_string();
        let ledger = ceph_bench::ledger::path().unwrap();
        let before = std::fs::read(&ledger).ok();
        for v in [["--data", az.as_str(), "--split", "test", "--crosscheck-run", "--single-test-run"].as_slice(),
                  &["--data", &az, "--split", "valid", "--crosscheck-run", "--single-test-run"],
                  &["--data", &az, "--split", "test", "--single-test-run"],
                  &["--data", &missing, "--split", "test", "--crosscheck-run", "--single-test-run"]] {
            let e = preflight(&try_args(v)).map(|_| "allowed".to_string()).unwrap_or_else(|e| e.to_string());
            assert!(e.contains("test films stay closed") && e.contains("PARK-FLAGS"), "{v:?}: {e}");
        }
        assert_eq!(std::fs::read(&ledger).ok(), before, "the ledger is not touched");
        assert!(preflight(&try_args(&["--data", &az, "--split", "valid", "--crosscheck-run"])).is_ok(), "control: a plain run on valid passes");
    }
    /// Task 14 edge cases: --chain-proof runs alone, knows only s1, needs --cache, and refuses a Test2 or `all` cache from
    /// its header before any film is read (the synthetic films file below cannot be parsed) and before the git checks.
    #[test] fn chain_proof_runs_alone_and_refuses_held_back_caches_first() {
        let (d, _, c4) = fixture();
        let e = preflight(&try_args(&["--data", &c4, "--split", "train", "--crosscheck-run", "--chain-proof", "s1"])).unwrap_err().to_string();
        assert!(e.contains("runs alone"), "{e}");
        assert!(preflight(&try_args(&["--data", &c4, "--chain-proof", "s1", "--cache", "/tmp/no-cache"])).is_ok(), "control: alone, it passes preflight");
        let e = chain_proof(&try_args(&["--data", &c4, "--chain-proof", "s2"]), "s2").unwrap_err().to_string();
        assert!(e.contains("only s1"), "{e}");
        let e = chain_proof(&try_args(&["--data", &c4, "--chain-proof", "s1"]), "s1").unwrap_err().to_string();
        assert!(e.contains("needs --cache"), "{e}");
        let cache = |name: &str, split: &str| {
            let c = d.path().join(name);
            std::fs::create_dir_all(&c).unwrap();
            std::fs::write(c.join("cache-header.json"), format!(r#"{{"dataset":"ceph400","split":"{split}","gitSha":"SYNTHETIC","models":{{}},"providers":{{}},"windows":[],"films":1}}"#)).unwrap();
            std::fs::write(c.join("detections.jsonl"), "SYNTHETIC: not a film\n").unwrap();
            c.to_string_lossy().to_string()
        };
        let train = cache("cache-train", "train");
        for split in ["test2", "all"] {
            let held = cache(&format!("cache-{split}"), split);
            let e = chain_proof(&try_args(&["--data", &c4, "--chain-proof", "s1", "--cache", &format!("{train},{held}")]), "s1").unwrap_err().to_string();
            assert!(e.contains("held back"), "{split}: {e}");
        }
        let e = chain_proof(&try_args(&["--data", &c4, "--chain-proof", "s1", "--cache", &train]), "s1").unwrap_err().to_string();
        assert!(!e.contains("held back"), "control: an allowed cache gets past the held-back check: {e}");
    }
    /// The post-hoc P1.3 follow-up (owner 27 Oct): `--posthoc-clinicians` goes only with `--chain-proof s1`, needs at
    /// least one clinician, and keeps every guard of the proof (a Test2 or `all` cache is refused from its header).
    #[test] fn posthoc_clinicians_goes_only_with_the_chain_proof_and_keeps_its_guards() {
        let (d, _, c4) = fixture();
        let e = preflight(&try_args(&["--data", &c4, "--split", "train", "--posthoc-clinicians", "2000"])).unwrap_err().to_string();
        assert!(e.contains("--posthoc-clinicians") && e.contains("--chain-proof s1"), "{e}");
        let e = preflight(&try_args(&["--data", &c4, "--split", "train", "--crosscheck-run", "--posthoc-clinicians", "2000"])).unwrap_err().to_string();
        assert!(e.contains("--chain-proof s1"), "{e}");
        let e = preflight(&try_args(&["--data", &c4, "--chain-proof", "s1", "--cache", "/tmp/no-cache", "--posthoc-clinicians", "0"])).unwrap_err().to_string();
        assert!(e.contains("at least 1"), "{e}");
        assert!(preflight(&try_args(&["--data", &c4, "--chain-proof", "s1", "--cache", "/tmp/no-cache", "--posthoc-clinicians", "2000"])).is_ok(), "control: with the proof it passes preflight");
        let c = d.path().join("cache-test2");
        std::fs::create_dir_all(&c).unwrap();
        std::fs::write(c.join("cache-header.json"), r#"{"dataset":"ceph400","split":"test2","gitSha":"SYNTHETIC","models":{},"providers":{},"windows":[],"films":1}"#).unwrap();
        std::fs::write(c.join("detections.jsonl"), "SYNTHETIC: not a film\n").unwrap();
        let e = chain_proof(&try_args(&["--data", &c4, "--chain-proof", "s1", "--cache", &c.to_string_lossy(), "--posthoc-clinicians", "2000"]), "s1").unwrap_err().to_string();
        assert!(e.contains("held back"), "{e}");
    }
    /// SYNTHETIC films (uniform wobble of ±25 px about the answer, 0.1 mm per px) carrying Aariz on Go, Po and B.
    fn synthetic_films(n: usize) -> (Vec<ceph_bench::xcache::FilmRun>, ceph_bench::dataset::Points) {
        use ceph_bench::xcache::{CachedPoint, FilmRun};
        let mut r = ceph_bench::chainproof::Rng::new(5);
        let mut g = || ((r.next() >> 11) as f64 / (1u64 << 53) as f64 - 0.5) * 50.0;
        let (mut films, mut gt) = (vec![], ceph_bench::dataset::Points::new());
        for i in 0..n {
            let film = format!("SYNTHETIC-{i:03}");
            let pts: std::collections::BTreeMap<String, CachedPoint> = ["Go", "Po", "B"].iter().map(|p| (p.to_string(), CachedPoint { x: 500.0 + g(), y: 500.0 + g(), cov: Default::default() })).collect();
            films.push(FilmRun { film: film.clone(), mm_per_px: 0.1, models: [(ceph_model::best::DEFAULT_BASE.to_string(), Ok(pts))].into_iter().collect() });
            gt.insert(film, ["Go", "Po", "B"].iter().map(|p| (p.to_string(), 500.0, 500.0)).collect());
        }
        (films, gt)
    }
    /// The post-hoc run's ending: it writes posthoc-p13-<N>.json beside, never over, chain-proof-s1.json; exits 0 when the
    /// control held and films were analysed; and exits 1 (an error) when the control broke or nothing was analysed.
    #[test] fn posthoc_finish_writes_its_own_file_and_errs_on_a_broken_control_or_no_films() {
        let (films, gt) = synthetic_films(80);
        let p = ceph_bench::chainproof::Prereg { clinicians: 20, ..serde_json::from_str(ceph_bench::chainproof::PREREG).unwrap() };
        let out = tempfile::tempdir().unwrap();
        let s1 = out.path().join("chain-proof-s1.json");
        std::fs::write(&s1, "SYNTHETIC S1 RESULT").unwrap();
        let path = posthoc_finish(out.path(), &films, &gt, &p, 30).unwrap();
        assert_eq!(path, out.path().join("posthoc-p13-30.json"));
        assert_eq!(std::fs::read_to_string(&s1).unwrap(), "SYNTHETIC S1 RESULT", "the S1 report is never touched");
        let broken = ceph_bench::chainproof::Prereg { control_offset_mm: 0.0, ..p.clone() };
        let e = posthoc_finish(out.path(), &films, &gt, &broken, 30).unwrap_err().to_string();
        assert!(e.contains("instrument is broken") && e.contains(ceph_bench::chainproof::POSTHOC_LABEL), "{e}");
        let e = posthoc_finish(out.path(), &[], &gt, &p, 30).unwrap_err().to_string();
        assert!(e.contains("only 0"), "{e}");
        assert_eq!(std::fs::read_to_string(&s1).unwrap(), "SYNTHETIC S1 RESULT");
    }
    #[test] fn crosscheck_tune_takes_aariz_valid_only() {
        let (_d, _, c4) = fixture();
        let e = crosscheck_tune(&try_args(&["--data", &c4, "--split", "train", "--crosscheck-tune", "--cache", "/tmp/no-cache"])).unwrap_err().to_string();
        assert!(e.contains("Aariz valid only"), "{e}");
        let e = crosscheck_tune(&try_args(&["--data", &c4, "--split", "valid", "--crosscheck-tune", "--cache", "/tmp/no-cache"])).unwrap_err().to_string();
        assert!(e.contains("Aariz valid only"), "a valid split of another dataset: {e}");
    }
}
