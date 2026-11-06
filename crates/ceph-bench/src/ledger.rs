//! The test films are opened once (spec 2026-10-13 §7, owner O7): Aariz test and Ceph-400 Test2 are held back from
//! every bench mode except the single test run of Task 8, which is written here and refused a second time.

use std::path::Path;

/// (dataset folder name, split) pairs kept for the single test run (spec §7).
pub const HELD_BACK: [(&str, &str); 2] = [("aariz", "test"), ("ceph400", "test2")];

/// Whether `split` of a dataset folder called `name` includes held-back films. "all" includes every split. Both the
/// folder name and the split are compared without case (fix round 1: macOS and Windows file systems ignore case, so
/// `data/Aariz` IS `data/aariz`). This looks only at the name; `refuse_held_back` is the gate that resolves the path.
pub fn is_held_back(data: &Path, split: &str) -> bool {
    let name = data.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let split = split.to_lowercase();
    HELD_BACK.iter().any(|(d, s)| *d == name && (*s == split || split == "all"))
}

/// (dataset folder name, split) pairs SEALED until their one pre-registered run (spec 2026-11-03 §17.7, C5): PKU is the
/// fresh test set for SC1-1b-PKU. Only `--pku-prepare` (which makes the folder and runs no check) and `--sc1-1b-pku`
/// (Task F) may open it; every other mode is refused by `refuse_held_back` and `chainproof::refuse_held_back_cache`.
pub const SEALED: [(&str, &str); 1] = [("pku", "test")];

/// Whether `split` of a dataset folder called `name` is sealed; the same name rules as `is_held_back` ("all" included,
/// folder name and split without case).
pub fn is_sealed(data: &Path, split: &str) -> bool {
    let name = data.file_name().map(|n| n.to_string_lossy().to_lowercase()).unwrap_or_default();
    let split = split.to_lowercase();
    SEALED.iter().any(|(d, s)| *d == name && (*s == split || split == "all"))
}

/// The seal's refusal, in plain words (one wording for both gates).
pub fn sealed_message(data: &Path, split: &str) -> String {
    format!("{} {split} is sealed: PKU is the fresh test set for SC1-1b-PKU (spec 2026-11-03 §17.7, C5) and stays unseen until \
        its one run; only --pku-prepare (which makes the folder) and --sc1-1b-pku may open it", data.display())
}

/// Every name the folder goes by: as written, each link it passes through, and its real (canonical) location.
/// A folder that cannot be resolved is an error, so the caller refuses rather than allows.
fn names_of(data: &Path) -> anyhow::Result<Vec<std::path::PathBuf>> {
    let real = std::fs::canonicalize(data).map_err(|e| anyhow::anyhow!(
        "cannot find the data folder {} ({e}); refusing, because the held-back check needs the real folder", data.display()))?;
    let mut names = vec![data.to_path_buf()];
    let mut hop = data.to_path_buf();
    for _ in 0..40 {                                       // a link chain longer than the OS allows is not followed
        let Ok(next) = std::fs::read_link(&hop) else { break };
        hop = if next.is_absolute() { next } else { hop.parent().map(|p| p.join(&next)).unwrap_or(next) };
        names.push(hop.clone());
    }
    names.push(real);
    Ok(names)
}

pub fn refuse_held_back(data: &Path, split: &str) -> anyhow::Result<()> { refuse_held_back_unless(data, split, None) }

/// The key that opens the PKU seal for SC1-1b-PKU's one run (spec 2026-11-03 §17.7, §17.9; plan M19). Its field is
/// private and `open_seal` is its only maker, so no other module can hold one:
///
/// ```compile_fail
/// let _k = ceph_bench::ledger::SealKey { _private: () };
/// ```
#[derive(Debug)]
pub struct SealKey { _private: () }

/// Opens the PKU seal once: the pre-registration at HEAD is `prereg` byte for byte (committed as built), the tree is
/// clean, and `report` (the run's one report) is not there yet. Each refusal names its reason; nothing is read.
pub fn open_seal(prereg_path: &str, prereg: &str, git: &crate::sc1_gate::Git, report: &Path) -> anyhow::Result<SealKey> {
    anyhow::ensure!(!git.dirty, "the PKU seal stays shut: the tree is not clean (commit first; {prereg_path} runs only from a clean tree)");
    crate::ft_common::committed_as_built(prereg_path, prereg, git.prereg_at_head.clone()).map_err(|e| anyhow::anyhow!("the PKU seal stays shut: {e}"))?;
    anyhow::ensure!(!report.exists(), "the PKU seal stays shut: {} already exists, so the one run has happened (PKU is opened once)", report.display());
    Ok(SealKey { _private: () })
}

/// `refuse_held_back`, except that with a key a SEALED split named exactly (not "all") passes. Held-back splits are
/// refused with or without a key.
pub fn refuse_held_back_unless(data: &Path, split: &str, key: Option<&SealKey>) -> anyhow::Result<()> {
    let names = names_of(data)?;
    anyhow::ensure!(!names.iter().any(|n| is_held_back(n, split)),
        "{} {split} is held back for the single test run (spec 2026-10-13 §7, owner O7); it is opened only by `--crosscheck-run --single-test-run` in Task 8",
        data.display());
    anyhow::ensure!(!names.iter().any(|n| is_sealed(n, split)) || opens(key, split), "{}", sealed_message(data, split));
    Ok(())
}
/// A key opens a sealed split named exactly ("test"), never "all".
pub(crate) fn opens(key: Option<&SealKey>, split: &str) -> bool {
    key.is_some() && SEALED.iter().any(|(_, s)| s.eq_ignore_ascii_case(split))
}

/// The ledger's one place: `reference/aariz-test-ledger.json` at the repo root, whatever folder the bench runs from
/// (preflight c10). Outside a git checkout this is an error, never a ledger in the current folder.
pub fn path() -> anyhow::Result<std::path::PathBuf> {
    let o = std::process::Command::new("git").args(["rev-parse", "--show-toplevel"]).output()?;
    anyhow::ensure!(o.status.success(), "not inside the repo: the test-run ledger lives at <repo>/reference/aariz-test-ledger.json");
    Ok(std::path::PathBuf::from(String::from_utf8_lossy(&o.stdout).trim()).join("reference").join("aariz-test-ledger.json"))
}

/// Whether this held-back set's single test run has happened (its cache may then be evaluated, Task 8).
pub fn opened(ledger: &Path, data: &Path, split: &str) -> anyhow::Result<bool> {
    if !ledger.exists() { return Ok(false); }
    let all: Vec<Opening> = serde_json::from_slice(&std::fs::read(ledger)?)?;
    let name = data.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    Ok(all.iter().any(|o| o.dataset == name && o.split == split))
}

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Opening { pub dataset: String, pub split: String, pub git_sha: String, pub unix: u64 }

/// Records that a held-back set was opened; refuses if it already was. A ledger that is not this tool's array is left
/// untouched and is an error (never overwritten). Written to `<ledger>.tmp` and then moved into place, never renamed
/// over an existing file (Windows-safe); a leftover `.tmp` means an earlier write was interrupted, and is refused for a
/// person to look at, because it may hold the only record that a test set was opened.
pub fn open_once(ledger: &Path, o: &Opening) -> anyhow::Result<()> {
    let tmp = ledger.with_extension(match ledger.extension().and_then(|e| e.to_str()) { Some(ext) => format!("{ext}.tmp"), None => "tmp".to_string() });
    anyhow::ensure!(!tmp.exists(), "{} exists: an earlier ledger write was interrupted; refusing until a person checks it and {}", tmp.display(), ledger.display());
    let before = if ledger.exists() { Some(std::fs::read(ledger)?) } else { None };
    let mut all: Vec<Opening> = match &before {
        Some(bytes) => serde_json::from_slice(bytes).map_err(|e| anyhow::anyhow!("{}: not the ledger this tool writes ({e}); refusing to touch it", ledger.display()))?,
        None => Vec::new(),
    };
    if let Some(prev) = all.iter().find(|p| p.dataset == o.dataset && p.split == o.split) {
        anyhow::bail!("{} {} was already opened (git {}, unix {}); the test films are used once only", o.dataset, o.split, prev.git_sha, prev.unix);
    }
    all.push(o.clone());
    if let Some(dir) = ledger.parent() { std::fs::create_dir_all(dir)?; }
    {
        use std::io::Write;
        let mut f = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp)
            .map_err(|e| anyhow::anyhow!("{}: {e}", tmp.display()))?;
        f.write_all((serde_json::to_string_pretty(&all)? + "\n").as_bytes())?;
        f.sync_all()?;
    }
    swap_in(&tmp, ledger, before.as_deref())
}

/// Moves `tmp` to `target`. `read_before` is what `target` held when it was read (`None`: it did not exist). If the
/// target has appeared or changed since, nothing is touched and it is an error. The old file is removed first, so the
/// rename never lands on an existing file; a crash between the two leaves only `tmp`, which `open_once` then refuses.
fn swap_in(tmp: &Path, target: &Path, read_before: Option<&[u8]>) -> anyhow::Result<()> {
    let now = if target.exists() { Some(std::fs::read(target)?) } else { None };
    anyhow::ensure!(now.as_deref() == read_before,
        "{} changed while the ledger was being written; refusing, nothing touched ({} kept)", target.display(), tmp.display());
    if now.is_some() { std::fs::remove_file(target)?; }
    std::fs::rename(tmp, target).map_err(|e| anyhow::anyhow!("moving {} to {}: {e}", tmp.display(), target.display()))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    #[test] fn aariz_test_and_ceph400_test2_are_held_back_and_nothing_else_is() {
        assert!(is_held_back(Path::new("data/aariz"), "test"));
        assert!(is_held_back(Path::new("/x/data/ceph400"), "test2"));
        assert!(!is_held_back(Path::new("data/aariz"), "valid"));
        assert!(!is_held_back(Path::new("data/ceph400"), "test1"));
        assert!(is_held_back(Path::new("data/aariz"), "all"), "\"all\" includes test, so it is held back too");
        assert!(is_held_back(Path::new("data/Aariz"), "test") && is_held_back(Path::new("data/CEPH400"), "test2"),
            "the folder name is compared without case, before any path is resolved");
    }
    /// Synthetic dataset folders in a tempdir (never the real data/): <tmp>/data/aariz and <tmp>/data/ceph400, empty.
    fn fixture() -> tempfile::TempDir {
        let d = tempfile::tempdir().unwrap();
        for n in ["aariz/sub", "ceph400"] { std::fs::create_dir_all(d.path().join("data").join(n)).unwrap(); }
        d
    }
    #[test] fn refusing_says_why_in_plain_words() {
        let d = fixture();
        let e = refuse_held_back(&d.path().join("data/aariz"), "test").unwrap_err().to_string();
        assert!(e.contains("held back") && e.contains("single test run"), "{e}");
        assert!(refuse_held_back(&d.path().join("data/aariz"), "valid").is_ok());
        assert!(refuse_held_back(&d.path().join("data/ceph400"), "test1").is_ok());
        assert!(refuse_held_back(&d.path().join("data/ceph400"), "Test1").is_ok(), "case-folding must not refuse an open split");
    }
    // Fix round 1, C1/I2: the same folder or split written differently must still be refused.
    #[test] fn the_folder_written_another_way_is_still_refused() {
        let d = fixture();
        for p in ["data/Aariz", "data/AARIZ", "data/aariz/", "data/./../data/aariz", "./data/../data/aariz", "data/aariz/sub/.."] {
            let r = refuse_held_back(&d.path().join(p), "test");
            assert!(r.is_err(), "{p} test must be refused");
        }
    }
    #[test] fn the_split_word_is_compared_without_case() {
        let d = fixture();
        for (n, s) in [("aariz", "TEST"), ("aariz", "Test"), ("aariz", "ALL"), ("ceph400", "Test2"), ("ceph400", "TEST2"), ("ceph400", "All")] {
            let e = refuse_held_back(&d.path().join("data").join(n), s).map_err(|e| e.to_string());
            assert!(e.as_ref().is_err_and(|e| e.contains("held back")), "{n} {s}: {e:?}");
            assert!(is_held_back(Path::new(n), s), "{n} {s}");
        }
    }
    #[test] fn a_folder_that_cannot_be_found_is_refused_not_allowed() {
        let d = fixture();
        let e = refuse_held_back(&d.path().join("data/not-there"), "valid").unwrap_err().to_string();
        assert!(e.contains("cannot find") && e.contains("not-there"), "{e}");
    }
    #[cfg(unix)]
    #[test] fn a_symlink_under_another_name_is_still_refused() {
        use std::os::unix::fs::symlink;
        let d = fixture();
        let t = d.path();
        // a link named "foo" pointing at the aariz folder
        std::fs::create_dir_all(t.join("elsewhere")).unwrap();
        symlink(t.join("data/aariz"), t.join("elsewhere/foo")).unwrap();
        // a folder named "aariz" that is a link to a folder with another name
        std::fs::create_dir_all(t.join("store/xyz")).unwrap();
        std::fs::create_dir_all(t.join("data2")).unwrap();
        symlink(t.join("store/xyz"), t.join("data2/aariz")).unwrap();
        // a chain: foo -> aariz -> store/xyz2, where only the middle hop carries the name
        std::fs::create_dir_all(t.join("store/xyz2")).unwrap();
        std::fs::create_dir_all(t.join("links")).unwrap();
        symlink(t.join("store/xyz2"), t.join("links/ceph400")).unwrap();
        symlink(t.join("links/ceph400"), t.join("links/foo")).unwrap();
        for (p, s) in [("elsewhere/foo", "test"), ("data2/aariz", "test"), ("links/foo", "test2")] {
            let e = refuse_held_back(&t.join(p), s).map_err(|e| e.to_string());
            assert!(e.as_ref().is_err_and(|e| e.contains("held back")), "{p} {s}: {e:?}");
        }
        assert!(refuse_held_back(&t.join("elsewhere/foo"), "valid").is_ok(), "an open split through a link is still allowed");
    }
    /// SC-1 Part 1b Task A (C5): PKU test is sealed for every mode. Fails if `SEALED` is not consulted by
    /// `refuse_held_back`, if "all" or another case of the name or split passes, or if a link hides the name.
    #[test] fn pku_test_is_sealed_for_every_mode() {
        let d = tempfile::tempdir().unwrap();
        let t = d.path();
        std::fs::create_dir_all(t.join("pku")).unwrap();
        std::fs::create_dir_all(t.join("aariz")).unwrap();
        for s in ["test", "all", "Test", "ALL"] {
            let e = refuse_held_back(&t.join("pku"), s).unwrap_err().to_string();
            eprintln!("pku {s}: {e}");
            assert!(e.contains("sealed"), "pku {s}: {e}");
        }
        assert!(refuse_held_back(&t.join("PKU"), "test").is_err(), "the folder written in capitals");
        assert!(is_sealed(Path::new("x/PKU"), "test") && is_sealed(Path::new("x/pku"), "Test") && is_sealed(Path::new("pku"), "all"));
        assert!(!is_sealed(Path::new("x/pku"), "train") && !is_sealed(Path::new("x/aariz"), "test"), "only pku test");
        #[cfg(unix)] {
            std::os::unix::fs::symlink(t.join("pku"), t.join("x")).unwrap();
            let e = refuse_held_back(&t.join("x"), "test").unwrap_err().to_string();
            eprintln!("a link named x -> pku: {e}");
            assert!(e.contains("sealed"), "{e}");
        }
        assert!(refuse_held_back(&t.join("aariz"), "valid").is_ok(), "aariz valid is still allowed");
        assert!(!is_held_back(Path::new("x/pku"), "test"), "sealed is its own list, not HELD_BACK");
    }
    #[test] fn a_set_is_opened_once_and_a_second_opening_is_refused() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("ledger.json");
        let o = Opening { dataset: "aariz".into(), split: "test".into(), git_sha: "abc".into(), unix: 1 };
        open_once(&p, &o).unwrap();
        let e = open_once(&p, &Opening { git_sha: "def".into(), ..o.clone() }).unwrap_err().to_string();
        assert!(e.contains("already opened") && e.contains("abc"), "{e}");
        open_once(&p, &Opening { dataset: "ceph400".into(), split: "test2".into(), ..o }).unwrap();
        let v: Vec<Opening> = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
        assert_eq!(v.len(), 2);
    }
    #[test] fn a_corrupt_ledger_is_never_overwritten() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("ledger.json");
        std::fs::write(&p, "{not json").unwrap();
        assert!(open_once(&p, &Opening { dataset: "aariz".into(), split: "test".into(), git_sha: "a".into(), unix: 1 }).is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "{not json");
    }
    // Fix round 1, I1: written through a temp file and a rename, never over an existing file.
    fn tmp_of(p: &Path) -> std::path::PathBuf { p.with_extension("json.tmp") }
    fn op(d: &str, s: &str) -> Opening { Opening { dataset: d.into(), split: s.into(), git_sha: "g".into(), unix: 1 } }
    #[test] fn no_temp_file_is_left_after_a_good_write() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("ledger.json");
        open_once(&p, &op("aariz", "test")).unwrap();
        open_once(&p, &op("ceph400", "test2")).unwrap();
        assert!(!tmp_of(&p).exists());
        let v: Vec<Opening> = serde_json::from_slice(&std::fs::read(&p).unwrap()).unwrap();
        assert_eq!(v, vec![op("aariz", "test"), op("ceph400", "test2")]);
    }
    #[test] fn a_temp_file_left_by_an_interrupted_write_is_refused_and_kept() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("ledger.json");
        // interrupted after the old ledger was removed: only the temp file holds the record
        std::fs::write(tmp_of(&p), "[]").unwrap();
        let e = open_once(&p, &op("aariz", "test")).unwrap_err().to_string();
        assert!(e.contains("interrupted"), "{e}");
        assert!(!p.exists(), "nothing written");
        assert_eq!(std::fs::read_to_string(tmp_of(&p)).unwrap(), "[]");
        // interrupted before the old ledger was removed: both kept as they are
        open_once(&d.path().join("other.json"), &op("aariz", "test")).unwrap();
        let q = d.path().join("other.json");
        let before = std::fs::read(&q).unwrap();
        std::fs::write(tmp_of(&q), "partial").unwrap();
        assert!(open_once(&q, &op("ceph400", "test2")).is_err());
        assert_eq!((std::fs::read(&q).unwrap(), std::fs::read_to_string(tmp_of(&q)).unwrap()), (before, "partial".to_string()));
    }
    #[test] fn a_ledger_that_appears_or_changes_during_the_write_is_refused_untouched() {
        let d = tempfile::tempdir().unwrap();
        let (p, t) = (d.path().join("ledger.json"), d.path().join("ledger.json.tmp"));
        // read as absent, but it appeared before the rename
        std::fs::write(&t, "[new]").unwrap();
        std::fs::write(&p, "[someone else]").unwrap();
        assert!(swap_in(&t, &p, None).is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "[someone else]");
        // read as "[old]", but it changed before the swap
        std::fs::write(&p, "[changed]").unwrap();
        assert!(swap_in(&t, &p, Some(b"[old]")).is_err());
        assert_eq!(std::fs::read_to_string(&p).unwrap(), "[changed]");
        // the normal swap
        std::fs::write(&p, "[old]").unwrap();
        swap_in(&t, &p, Some(b"[old]")).unwrap();
        assert_eq!((std::fs::read_to_string(&p).unwrap(), t.exists()), ("[new]".to_string(), false));
    }
    /// Task 7: a held-back set's cache may be evaluated only after its single opening is in the ledger (Task 8).
    #[test] fn opened_is_false_before_the_opening_true_after_and_false_for_another_split() {
        let d = tempfile::tempdir().unwrap();
        let l = d.path().join("ledger.json");
        let data = d.path().join("aariz");
        assert!(!opened(&l, &data, "test").unwrap(), "no ledger yet");
        open_once(&l, &Opening { dataset: "aariz".into(), split: "test".into(), git_sha: "g".into(), unix: 1 }).unwrap();
        assert!(opened(&l, &data, "test").unwrap());
        assert!(!opened(&l, &data, "valid").unwrap());
        assert!(!opened(&l, &d.path().join("ceph400"), "test").unwrap());
    }
    /// Preflight c10: one ledger at the repo root, wherever the bench runs from.
    #[test] fn the_ledger_path_is_absolute_at_the_repo_root() {
        let p = path().unwrap();
        assert!(p.is_absolute() && p.ends_with("reference/aariz-test-ledger.json"), "{}", p.display());
    }
}
