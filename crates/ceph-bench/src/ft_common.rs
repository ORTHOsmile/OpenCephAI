//! Shared by the Tier 3 feasibility tests FT-0, FT-1 and FT-2 (spec
//! model-design.md §9, §14.9). Bench only: nothing in the app reads these tests
//! (tests/no_app_reads_the_feasibility_tests.rs). Ceph-400 Train and Test1 only; Test2 stays closed (owner, 27 Oct).
use crate::chainproof::Rng;
use std::collections::BTreeSet;
use std::path::Path;

/// A point in film pixels (x right, y down).
pub type Pt = (f64, f64);

/// A standard normal number from the seeded stream (Box–Muller). Uses exactly two numbers of the stream per call.
pub fn normal(r: &mut Rng) -> f64 {
    let u1 = ((r.next() >> 11) as f64 + 0.5) / (1u64 << 53) as f64;     // in (0, 1): never 0, so the log is finite
    let u2 = (r.next() >> 11) as f64 / (1u64 << 53) as f64;
    (-2.0 * u1.ln()).sqrt() * (std::f64::consts::TAU * u2).cos()
}

/// A direction, uniform round the circle, as a unit vector. Uses one number of the stream.
pub fn direction(r: &mut Rng) -> (f64, f64) {
    let a = (r.next() >> 11) as f64 / (1u64 << 53) as f64 * std::f64::consts::TAU;
    (a.cos(), a.sin())
}

/// A stream of its own for one case, from the pre-registered seed and the case's numbers, so a case's draws never
/// depend on which other cases ran before it (or on which thread).
pub fn case_rng(seed: u64, parts: &[u64]) -> Rng {
    let mut s = seed;
    for (i, p) in parts.iter().enumerate() {
        s ^= p.wrapping_add(1).wrapping_mul(0x9E37_79B9_7F4A_7C15).rotate_left(7 * (i as u32 + 1));
        s = s.wrapping_mul(0xBF58_476D_1CE4_E5B9);
    }
    let mut r = Rng::new(s);
    r.next();
    r
}

/// The median. Nothing measured is an error, never a number; so is a NaN.
pub fn median(v: &[f64]) -> anyhow::Result<f64> {
    anyhow::ensure!(!v.is_empty(), "median of nothing: nothing was measured");
    anyhow::ensure!(v.iter().all(|x| !x.is_nan()), "median of a list holding NaN");
    let mut s = v.to_vec();
    s.sort_by(f64::total_cmp);
    let n = s.len();
    Ok(if n % 2 == 1 { s[n / 2] } else { (s[n / 2 - 1] + s[n / 2]) / 2.0 })
}

/// The distance between two points, in the same units as the points.
pub fn dist(a: Pt, b: Pt) -> f64 { (a.0 - b.0).hypot(a.1 - b.1) }

/// No film may be both learned from and judged on ("homework", chain spec §3). Names the first one found.
pub fn no_homework(learned: &[String], judged: &[String]) -> anyhow::Result<()> {
    let l: BTreeSet<&str> = learned.iter().map(String::as_str).collect();
    let both: Vec<&str> = judged.iter().map(String::as_str).filter(|f| l.contains(f)).collect();
    anyhow::ensure!(both.is_empty(), "homework: {} film(s) are both learned from and judged on (first: {}); nothing is reported", both.len(), both[0]);
    Ok(())
}

/// Every comparison says how many it compared; a count other than the one expected stops the run.
pub fn counted(what: &str, got: usize, want: usize) -> anyhow::Result<String> {
    anyhow::ensure!(got == want, "{what}: compared {got}, expected {want}; refusing to report");
    Ok(format!("{what}: compared {got} (expected {want})"))
}

/// The pass marks are pre-registered: `rel` at HEAD (None when it is not committed) must be the very bytes this
/// program was built with (Part F's pattern, chainproof::committed_as_built).
pub fn committed_as_built(rel: &str, built: &str, at_head: Option<Vec<u8>>) -> anyhow::Result<()> {
    let at_head = at_head.ok_or_else(|| anyhow::anyhow!("{rel} is not committed: the pass marks are pre-registered, commit them before the run"))?;
    anyhow::ensure!(at_head == built.as_bytes(), "{rel} at HEAD differs from the one this program was built with: rebuild from the committed tree");
    Ok(())
}

/// `git show HEAD:<rel>`, or None when git fails or the file is not committed.
pub fn at_head(rel: &str) -> Option<Vec<u8>> {
    std::process::Command::new("git").args(["show", &format!("HEAD:{rel}")]).output().ok().filter(|o| o.status.success()).map(|o| o.stdout)
}

/// A folder git ignores, judged by git itself (`git check-ignore -q` on a file inside it; exit 0 = ignored). Anything
/// else, git failing included, refuses.
pub fn ensure_ignored(dir: &Path) -> anyhow::Result<()> {
    let probe = dir.join("probe-file");
    let st = std::process::Command::new("git").args(["check-ignore", "-q", "--no-index"]).arg(&probe).status()?;
    anyhow::ensure!(st.code() == Some(0), "{} is not git-ignored (git check-ignore exit {:?}): refusing to write there", dir.display(), st.code());
    Ok(())
}

/// Where a derived weights file (the tapped copy of Aariz) may go: only a git-ignored folder named `models` (spec §11; never committed, bundled or uploaded).
pub fn ensure_weights_dir(dir: &Path) -> anyhow::Result<()> {
    anyhow::ensure!(dir.components().any(|c| c.as_os_str() == "models"),
        "{} is not inside a folder named models: a tapped copy of Aariz is a derived weights file and lives only in the git-ignored models/", dir.display());
    ensure_ignored(dir)
}

/// SHA-256 as lower-case hex.
pub fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    Sha256::digest(bytes).iter().map(|b| format!("{b:02x}")).collect()
}

/// `f` on every item, spread over the Mac's cores, results in the items' order (so a run gives the same numbers every
/// time, whatever the thread timing).
pub fn par_map<T: Sync, R: Send>(items: &[T], f: impl Fn(&T) -> R + Sync) -> Vec<R> {
    if items.is_empty() { return Vec::new(); }
    let threads = std::thread::available_parallelism().map(|n| n.get()).unwrap_or(1).max(1);
    let chunk = items.len().div_ceil(threads).max(1);
    std::thread::scope(|s| {
        let f = &f;
        let handles: Vec<_> = items.chunks(chunk).map(|c| s.spawn(move || c.iter().map(f).collect::<Vec<R>>())).collect();
        handles.into_iter().flat_map(|h| h.join().expect("a worker thread panicked")).collect()
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn normal_draws_have_mean_0_and_spread_1_and_repeat_by_seed() {
        let mut r = Rng::new(11);
        let v: Vec<f64> = (0..20_000).map(|_| normal(&mut r)).collect();
        let m = v.iter().sum::<f64>() / v.len() as f64;
        let sd = (v.iter().map(|x| (x - m).powi(2)).sum::<f64>() / v.len() as f64).sqrt();
        assert!(m.abs() < 0.03 && (sd - 1.0).abs() < 0.03, "mean {m} sd {sd}");
        let (mut a, mut b) = (Rng::new(5), Rng::new(5));
        assert_eq!(normal(&mut a).to_bits(), normal(&mut b).to_bits());
    }
    #[test] fn a_direction_is_a_unit_vector_and_each_case_has_its_own_stream() {
        let mut r = Rng::new(3);
        for _ in 0..100 { let (x, y) = direction(&mut r); assert!((x.hypot(y) - 1.0).abs() < 1e-12); }
        let first = |parts: &[u64]| case_rng(9, parts).next();
        assert_eq!(first(&[1, 2]), first(&[1, 2]));
        assert_ne!(first(&[1, 2]), first(&[2, 1]));
        assert_ne!(first(&[1, 2]), first(&[1, 3]));
        assert_ne!(case_rng(9, &[1]).next(), case_rng(10, &[1]).next());
    }
    #[test] fn the_median_refuses_nothing_and_nan() {
        assert_eq!(median(&[3.0, 1.0, 2.0]).unwrap(), 2.0);
        assert_eq!(median(&[4.0, 1.0, 2.0, 3.0]).unwrap(), 2.5);
        assert!(median(&[]).unwrap_err().to_string().contains("nothing"));
        assert!(median(&[1.0, f64::NAN]).unwrap_err().to_string().contains("NaN"));
    }
    #[test] fn homework_is_refused_by_name() {
        let s = |v: &[&str]| v.iter().map(|x| x.to_string()).collect::<Vec<_>>();
        assert!(no_homework(&s(&["001", "002"]), &s(&["151"])).is_ok());
        let e = no_homework(&s(&["001", "151"]), &s(&["151", "152"])).unwrap_err().to_string();
        assert!(e.contains("151") && e.contains("homework"), "{e}");
    }
    #[test] fn a_count_other_than_expected_stops_the_run() {
        assert!(counted("points", 2850, 2850).unwrap().contains("2850"));
        let e = counted("points", 2849, 2850).unwrap_err().to_string();
        assert!(e.contains("2849") && e.contains("2850"), "{e}");
    }
    #[test] fn the_pass_marks_must_be_committed_as_built() {
        let built = "{\"version\": \"SYNTHETIC\"}";
        assert!(committed_as_built("reference/x.json", built, Some(built.as_bytes().to_vec())).is_ok());
        assert!(committed_as_built("reference/x.json", built, None).unwrap_err().to_string().contains("not committed"));
        let mut other = built.as_bytes().to_vec(); other[3] ^= 1;
        assert!(committed_as_built("reference/x.json", built, Some(other)).unwrap_err().to_string().contains("differs"));
    }
    /// Judged by git itself: `/models/` and `/reports/*/` are ignored at the repo root; a folder merely NAMED models
    /// elsewhere is not; reports/ is ignored but is not a weights folder.
    #[test] fn derived_weights_go_only_into_an_ignored_models_folder() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap();
        assert!(ensure_weights_dir(&root.join("models/tier3-tap")).is_ok(), "control: models/ is git-ignored");
        assert!(ensure_weights_dir(&root.join("crates/ceph-bench/models")).unwrap_err().to_string().contains("not git-ignored"));
        assert!(ensure_weights_dir(&root.join("reports/tier3")).unwrap_err().to_string().contains("models"));
        assert!(ensure_ignored(&root.join("reports/tier3")).is_ok(), "control: reports/<run>/ is git-ignored");
        assert!(ensure_ignored(&root.join("crates/ceph-bench/src")).is_err());
    }
    #[test] fn par_map_keeps_the_order_and_takes_an_empty_list() {
        let v: Vec<u64> = (0..1000).collect();
        assert_eq!(par_map(&v, |x| x * 2), v.iter().map(|x| x * 2).collect::<Vec<_>>());
        assert!(par_map(&Vec::<u64>::new(), |x| *x).is_empty());
    }
    #[test] fn the_hash_is_sha256() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    }
}
