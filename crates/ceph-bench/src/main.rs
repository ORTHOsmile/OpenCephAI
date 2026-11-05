use ceph_bench::{run, run_orient, BenchConfig, PARITY_MAX_PX};
use clap::Parser;
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
    #[arg(long, required_unless_present_any = ["shape_prior", "stage_a_acceptance"])] out: Option<PathBuf>,
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
}

impl Args {
    /// `--out`; clap requires it unless `--shape-prior` is given, and `--shape-prior` returns before any mode uses it.
    fn out(&self) -> &PathBuf { self.out.as_ref().expect("clap requires --out unless --shape-prior or --stage-a-acceptance is given") }
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
fn preflight(a: &Args) -> anyhow::Result<()> {
    // Owner PARK-FLAGS (15 Oct 2026): Task 8 is cancelled and the test films stay closed. The single test run is refused
    // first, before the ledger or the data are looked at (final review m6). The opening code below stays for a future
    // pre-registration (crosscheck-pass/2), which needs the owner's OK and must remove this line on purpose.
    anyhow::ensure!(!a.single_test_run, "--single-test-run is switched off: the Aariz test films stay closed (owner PARK-FLAGS, 15 Oct 2026; \
        Task 8 cancelled). It can come back only with a new pre-registration and the owner's OK. Nothing was read or written.");
    if let Some(out) = &a.shape_prior {
        anyhow::ensure!(!(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
            || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some()),
            "--shape-prior runs alone (no other mode, and no --out: the file goes where --shape-prior says)");
        ceph_bench::shape_prior::check_out(out)?;
    }
    anyhow::ensure!(!a.stage_a_acceptance || !(a.crosscheck_run || a.crosscheck_tune || a.decide_source || a.scale_check || a.orient || a.diag_facing
        || a.chain_proof.is_some() || a.parity.is_some() || a.scores_out.is_some() || a.out.is_some() || a.shape_prior.is_some()),
        "--stage-a-acceptance runs alone (no other mode, and no --out: the report goes to reports/stage-a-acceptance)");
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

fn main() -> anyhow::Result<()> {
    let a = Args::parse();
    let list = manifests(&a.manifest);
    preflight(&a)?;
    if let Some(out) = &a.shape_prior { return shape_prior(&a, out); }
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
