//! Plain text files the clinician chose in a save or open dialog (spec 2026-10-17 analysis builder, owner B4: an
//! analysis shared as a file, which is also how analyses move to a new Mac). `std::fs` and `Path` only: Windows-ready.
//!
//! Security (preflight-rulings Task 6 F18, the lessons from `export.rs`'s own fix rounds, and task-6-review.md's
//! fix round 1, all binding here too): `write_text` never writes through whatever is already at the destination
//! name — a symlink there would otherwise be followed, and a hard link would otherwise write through its *shared
//! inode* into whatever else that inode is named from (CWE-59/CWE-62). Instead a brand-new file is opened with
//! `create_new` (fails if anything is already there) in the same folder, written and synced, then renamed over the
//! destination: a rename replaces the directory entry itself, so it can never write through an existing symlink or
//! hard link. `write_text` also refuses any path whose parent folder is, or sits inside, the app's own data folder
//! (the library database, installed models) — decided by filesystem identity (device + inode of each ancestor, on
//! Unix), not by comparing path spelling, which a macOS firmlink, a `..` spelling or a symlinked ancestor could
//! otherwise be used to walk around. Only a leaf ending `.analysis.json` (any case) is accepted on write (review
//! I2) — `.json` alone would leave this command able to overwrite any configuration file the user can write, inside
//! or outside app data (another program's, or the "Locate model…" folder's `manifest.json`).
//!
//! **Known residual (review m1):** the app-data-folder check canonicalises the *parent folder* once, before the
//! write; the write itself still goes through that same resolved folder (`real_dir`), so a plain race (something
//! else renaming an ancestor folder to a fresh symlink between the check and the `rename`) is narrowed but not
//! fully closed — a `dirfd`-based open (relative to a held folder handle) would be needed to close it completely,
//! and that is not done here. Exploiting it needs concurrent local write access as the same user, who could already
//! write app data directly, so this is accepted as a known residual rather than fixed this round.
use std::path::{Path, PathBuf};

/// An analysis file is a few kilobytes; anything larger is not one, and is never read into memory (beyond one byte
/// over the limit — see `read_text`).
pub const MAX_TEXT_BYTES: u64 = 1024 * 1024;

/// Read side: any `.json` (case-insensitive) is accepted, since this only ever reads a file already filtered by
/// the open dialog to `.json`, and nothing sensitive in app data is a `.json` file (preflight F18).
fn is_json(path: &Path) -> bool {
    path.extension().is_some_and(|e| e.eq_ignore_ascii_case("json"))
}

/// Write side (review I2): only a leaf ending `.analysis.json` (case-insensitive) is accepted. `.json` alone would
/// make this command a general "write any configuration file the user can write" primitive — `exportFileName`
/// (`custom-file.ts`) and Task 7's default save name both always produce this suffix.
fn is_analysis_json(path: &Path) -> bool {
    path.file_name().and_then(|n| n.to_str()).is_some_and(|n| n.to_ascii_lowercase().ends_with(".analysis.json"))
}

/// True if `dir`, or any ancestor of `dir`, is the same folder on disk as `root` — compared by filesystem identity,
/// not by path spelling (see the module doc comment: a macOS firmlink spells the same folder two ways).
#[cfg(unix)]
pub(crate) fn is_inside(dir: &Path, root: &Path) -> bool {
    use std::os::unix::fs::MetadataExt;
    let Ok(root_meta) = std::fs::metadata(root) else { return false };
    let mut cur = Some(dir);
    while let Some(d) = cur {
        if let Ok(m) = std::fs::metadata(d) {
            if m.dev() == root_meta.dev() && m.ino() == root_meta.ino() { return true; }
        }
        cur = d.parent();
    }
    false
}

/// Windows-ready: stable per-file identity on Windows needs an open handle (`BY_HANDLE_FILE_INFORMATION`), not a
/// plain `Metadata`; until there is a Windows build to test it against, fall back to the canonical-path ancestor
/// compare — correct there, since Windows has no macOS-style firmlink spelling to walk around it with.
#[cfg(windows)]
pub(crate) fn is_inside(dir: &Path, root: &Path) -> bool {
    let Ok(real_root) = root.canonicalize() else { return false };
    let mut cur = dir.canonicalize().ok();
    while let Some(d) = cur {
        if d == real_root { return true; }
        cur = d.parent().map(PathBuf::from);
    }
    false
}

/// Writes `text` to `path`, refusing a path under `app_data_dir` (F18) and never writing through whatever is
/// already at `path` (see the module doc comment). Only a leaf ending `.analysis.json` (I2): this command can
/// never overwrite a film, the library database, another program's configuration, or anything else by extension
/// alone either. Requires an absolute path that already exists as a folder (review m8): a relative path would
/// resolve against this process's own working folder, which the clinician never chose and never sees.
pub fn write_text(path: &Path, text: &str, app_data_dir: &Path) -> Result<(), String> {
    if !path.is_absolute() { return Err("Choose where to save the file.".into()); }
    let name = path.file_name().ok_or_else(|| "Choose a file name.".to_string())?;
    if !is_analysis_json(path) { return Err("An analysis is saved with a name ending .analysis.json.".into()); }
    let dir = path.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    let real_dir = dir.canonicalize().map_err(|_| "That folder does not exist.".to_string())?;
    if is_inside(&real_dir, app_data_dir) { return Err("Choose a folder outside OpenCephAI's own data.".into()); }
    // The destination and the temp file below are both built from `real_dir` (not the un-canonicalised `dir`), so
    // the write lands in the same folder the check above actually approved (review m1; residual noted above).
    let target = real_dir.join(name);
    // Defence in depth only (as in export.rs's C1): the create-new-then-rename below is what actually keeps a
    // write from ever going through an existing symlink or hard link. Telling the clinician their chosen name is
    // already a shortcut, rather than silently replacing it, is just a better message.
    if let Ok(meta) = std::fs::symlink_metadata(&target) {
        if meta.file_type().is_symlink() { return Err("That name is already a shortcut (symlink); choose a different name.".into()); }
    }
    let say = |e: std::io::Error| format!("The file could not be written: {e}");
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let tmp = real_dir.join(format!(".{}.{pid}-{nanos}-{n}.part", name.to_string_lossy()));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(say)?;
    use std::io::Write as _;
    if let Err(e) = file.write_all(text.as_bytes()).and_then(|_| file.sync_all()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(say(e));
    }
    drop(file);
    std::fs::rename(&tmp, &target).map_err(|e| { let _ = std::fs::remove_file(&tmp); say(e) })
}

/// Reads `path` back as text. Only `.json`, a plain regular file (review m3 — not a directory, FIFO, or device:
/// `File::open` + `is_file()` is checked before any byte is read, so a symlink to `/dev/zero` or a FIFO is refused
/// rather than read without limit or blocked on forever), under the size limit (capped by `take`, not by trusting
/// `metadata().len()` — a file can grow between the two), and valid UTF-8 — anything else is refused with a plain
/// reason rather than read partway.
pub fn read_text(path: &Path) -> Result<String, String> {
    if !is_json(path) { return Err("An analysis is read from a .json file.".into()); }
    let say_open = |e: std::io::Error| format!("The file could not be opened: {e}");
    let mut f = std::fs::File::open(path).map_err(say_open)?;
    let is_file = f.metadata().map_err(say_open)?.is_file();
    if !is_file { return Err("That is not a plain file, so it is not an analysis.".into()); }
    use std::io::Read as _;
    let mut buf = Vec::new();
    (&mut f).take(MAX_TEXT_BYTES + 1).read_to_end(&mut buf).map_err(say_open)?;
    if buf.len() as u64 > MAX_TEXT_BYTES { return Err("That file is too large to be an analysis (over 1 MB).".into()); }
    String::from_utf8(buf).map_err(|_| "That file is not text, so it is not an analysis.".into())
}

#[tauri::command]
pub async fn text_file_write(app: tauri::AppHandle, path: String, text: String) -> Result<(), String> {
    use tauri::Manager;
    let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    write_text(Path::new(&path), &text, &app_data_dir)
}

#[tauri::command] pub async fn text_file_read(path: String) -> Result<String, String> { read_text(Path::new(&path)) }

#[cfg(test)]
mod tests {
    use super::*;

    fn leftovers(d: &Path) -> Vec<String> {
        std::fs::read_dir(d).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).filter(|n| n.ends_with(".part")).collect()
    }

    #[test] fn writes_reads_back_and_overwrites_leaving_no_part_file() {
        let d = tempfile::tempdir().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let p = d.path().join("NOS clinic SYNTHETIC — ✓.analysis.json");
        write_text(&p, "first", appdata.path()).unwrap();
        write_text(&p, "{\"name\":\"Ünïcode SYNTHETIC\"}\n", appdata.path()).unwrap();
        assert_eq!(read_text(&p).unwrap(), "{\"name\":\"Ünïcode SYNTHETIC\"}\n");
        assert!(leftovers(d.path()).is_empty());
    }

    // m8: refuse when the parent folder cannot be canonicalised (does not exist), rather than silently skipping
    // the app-data check and only failing later, with a confusing low-level message, at the write itself.
    #[test] fn a_missing_folder_is_refused_before_any_write_is_attempted() {
        let d = tempfile::tempdir().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let p = d.path().join("nope").join("a.analysis.json");
        assert_eq!(write_text(&p, "x", appdata.path()).unwrap_err(), "That folder does not exist.");
        assert!(!d.path().join("nope").exists());
    }

    // Final review M8: `/` is absolute only on Unix; on Windows it is relative to the current drive, so the refusal
    // would be "Choose where to save the file." instead. Unix-only, like the other path-shape tests here.
    #[cfg(unix)]
    #[test] fn a_path_with_no_file_name_is_refused() {
        let appdata = tempfile::tempdir().unwrap();
        assert_eq!(write_text(Path::new("/"), "x", appdata.path()).unwrap_err(), "Choose a file name.");
    }

    // m8: a relative path would resolve against this *process's* working folder, which the clinician never chose.
    // The chosen relative name does not exist under any working folder this test could run from, so — both before
    // and after the fix — nothing is ever actually created; only the refusal reason differs.
    #[test] fn a_relative_path_is_refused_without_touching_the_working_directory() {
        let appdata = tempfile::tempdir().unwrap();
        let err = write_text(Path::new("not-created-by-this-test/rel.analysis.json"), "x", appdata.path()).unwrap_err();
        assert_eq!(err, "Choose where to save the file.");
    }

    // I2: `.json` alone still let this command write any configuration file the user can write — another
    // program's, or the "Locate model…" folder's `manifest.json` — not only the library's own. Only a leaf ending
    // `.analysis.json` (any case) is accepted.
    #[test] fn write_text_refuses_a_leaf_not_ending_analysis_json_case_insensitively() {
        let appdata = tempfile::tempdir().unwrap();
        let d = tempfile::tempdir().unwrap();
        for n in ["manifest.json", "package.json", "settings.json", "library.sqlite", "film.png", "analysis"] {
            assert_eq!(write_text(&d.path().join(n), "x", appdata.path()).unwrap_err(), "An analysis is saved with a name ending .analysis.json.");
        }
        assert!(write_text(&d.path().join("X.Analysis.JSON"), "x", appdata.path()).is_ok());   // any case
        assert_eq!(std::fs::read_dir(d.path()).unwrap().count(), 1);
    }

    #[test] fn reading_a_missing_too_large_binary_or_non_json_file_says_why() {
        let d = tempfile::tempdir().unwrap();
        assert!(read_text(&d.path().join("missing.json")).unwrap_err().starts_with("The file could not be opened"));
        let big = d.path().join("big.json");
        std::fs::write(&big, vec![b' '; (MAX_TEXT_BYTES + 1) as usize]).unwrap();
        assert_eq!(read_text(&big).unwrap_err(), "That file is too large to be an analysis (over 1 MB).");
        let exact = d.path().join("exact.json");
        std::fs::write(&exact, vec![b' '; MAX_TEXT_BYTES as usize]).unwrap();
        assert!(read_text(&exact).is_ok());   // the boundary: exactly 1 MB is read
        let bin = d.path().join("bin.json");
        std::fs::write(&bin, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(read_text(&bin).unwrap_err(), "That file is not text, so it is not an analysis.");
        let txt = d.path().join("notes.txt");
        std::fs::write(&txt, "hello").unwrap();
        assert_eq!(read_text(&txt).unwrap_err(), "An analysis is read from a .json file.");
    }

    // m3: a directory given a `.json`-looking name. The old `metadata().len()` (a few dozen bytes for the
    // directory entry itself) passed the size check, and `std::fs::read` then failed with a confusing low-level
    // error ("Is a directory") instead of a plain refusal. `File::open` + `is_file()` catches this before any read
    // is attempted — and, by the same check, a symlink to a non-regular file (see the device test below).
    #[cfg(unix)]
    #[test] fn a_directory_named_like_a_json_file_is_refused_cleanly() {
        let d = tempfile::tempdir().unwrap();
        let dir_as_json = d.path().join("looks-like-a-file.json");
        std::fs::create_dir(&dir_as_json).unwrap();
        assert_eq!(read_text(&dir_as_json).unwrap_err(), "That is not a plain file, so it is not an analysis.");
    }

    // m3: a symlink to a character device. `/dev/null` is used rather than `/dev/zero` or a FIFO deliberately:
    // reading `/dev/zero` without a limit allocates without bound, and opening a FIFO for read blocks until a
    // writer appears — this test must not risk hanging or exhausting memory on the machine running it. `/dev/null`
    // exercises the same gap safely: its `metadata().len()` is 0 (true of every character device), which the old
    // code's size check let straight through, and reading it returns EOF immediately with zero bytes — so the old
    // code did not hang here, it did something arguably worse: it silently accepted the symlink as a valid *empty*
    // analysis file (`Ok("")`). `is_file()` refuses it outright, before any read is attempted.
    #[cfg(unix)]
    #[test] fn a_symlink_to_a_character_device_is_refused_not_silently_accepted_as_empty() {
        let d = tempfile::tempdir().unwrap();
        let link = d.path().join("evil.json");
        std::os::unix::fs::symlink("/dev/null", &link).unwrap();
        assert_eq!(read_text(&link).unwrap_err(), "That is not a plain file, so it is not an analysis.");
    }

    // F18: refuse any path under the app's data folder (the library, installed models) — decided by filesystem
    // identity, not path spelling. Positive control (as in export.rs): the same leaf name is fine just outside,
    // refused just inside.
    #[test] fn write_text_refuses_a_path_inside_the_apps_data_folder() {
        let appdata = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        assert!(write_text(&outside.path().join("x.analysis.json"), "x", appdata.path()).is_ok());
        assert!(write_text(&appdata.path().join("x.analysis.json"), "x", appdata.path()).is_err());
        let inner = appdata.path().join("library");
        std::fs::create_dir(&inner).unwrap();
        let err = write_text(&inner.join("x.analysis.json"), "x", appdata.path()).unwrap_err();
        assert_eq!(err, "Choose a folder outside OpenCephAI's own data.");
    }

    // m11: a symlinked ancestor folder that itself resolves into app data, not just the folder named directly.
    #[cfg(unix)]
    #[test] fn a_symlinked_parent_folder_pointing_into_app_data_is_refused() {
        let appdata = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let link = out.path().join("link");
        std::os::unix::fs::symlink(appdata.path(), &link).unwrap();
        let err = write_text(&link.join("x.analysis.json"), "x", appdata.path()).unwrap_err();
        assert_eq!(err, "Choose a folder outside OpenCephAI's own data.");
    }

    // m11: a `..` spelling that resolves straight back into app data, not just the folder spelled directly.
    #[test] fn a_dot_dot_spelling_that_resolves_into_app_data_is_refused() {
        let appdata = tempfile::tempdir().unwrap();
        let sub = appdata.path().join("sub");
        std::fs::create_dir(&sub).unwrap();
        let dotdot = sub.join("..").join("x.analysis.json");
        let err = write_text(&dotdot, "x", appdata.path()).unwrap_err();
        assert_eq!(err, "Choose a folder outside OpenCephAI's own data.");
    }

    #[cfg(unix)]
    #[test] fn a_symlinked_json_name_is_refused_and_nothing_is_written_through_it() {
        let out = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let arbitrary = elsewhere.path().join("anything.bin");
        std::fs::write(&arbitrary, b"arbitrary file, must not be overwritten").unwrap();
        let evil = out.path().join("report.analysis.json");
        std::os::unix::fs::symlink(&arbitrary, &evil).unwrap();
        let err = write_text(&evil, "EXPORT", appdata.path()).unwrap_err();
        assert!(err.to_lowercase().contains("symlink") || err.to_lowercase().contains("shortcut"), "{err}");
        assert_eq!(std::fs::read(&arbitrary).unwrap(), b"arbitrary file, must not be overwritten");
    }

    // CWE-62: a hard link shares its *inode* with the file it was linked from, so opening the link and truncating
    // it (the old `std::fs::write`) would write through to whatever else that inode is named from. Renaming a
    // fresh temp file over the link's directory entry never touches that shared inode.
    #[test] fn write_text_never_writes_through_a_hard_link() {
        let secret_dir = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let appdata = tempfile::tempdir().unwrap();
        let secret = secret_dir.path().join("secret.json");
        std::fs::write(&secret, b"someone else's data, never overwritten").unwrap();
        let target = out.path().join("report.analysis.json");
        std::fs::hard_link(&secret, &target).unwrap();   // same inode as `secret`; not a symlink
        write_text(&target, "MINE", appdata.path()).unwrap();
        assert_eq!(std::fs::read(&secret).unwrap(), b"someone else's data, never overwritten");
        assert_eq!(std::fs::read(&target).unwrap(), b"MINE");
    }

    // On this Mac, `/System/Volumes/Data<realpath>` names the very same folder as `<realpath>` (an APFS firmlink),
    // which only exists on macOS (m7: gated by `target_os`, not merely `unix` — this would fail its own
    // precondition assert on Linux). `Path::canonicalize` does not fold the two spellings together, so a check
    // that compared canonicalised path *strings* could be walked around by spelling the app data folder that way;
    // the dev+ino identity check cannot.
    #[cfg(target_os = "macos")]
    #[test] fn a_macos_firmlink_spelling_of_the_app_data_folder_is_still_refused() {
        let appdata = tempfile::tempdir().unwrap();
        let real_appdata = appdata.path().canonicalize().unwrap();
        let firmlink_spelling = PathBuf::from(format!("/System/Volumes/Data{}", real_appdata.display()));
        assert!(firmlink_spelling.is_dir(), "this test needs the /System/Volumes/Data firmlink to exist on this Mac");
        assert_ne!(
            firmlink_spelling.canonicalize().unwrap(), real_appdata,
            "the test needs these two spellings of the same folder to differ as strings after canonicalising"
        );
        let target = firmlink_spelling.join("firm.analysis.json");
        let err = write_text(&target, "x", appdata.path()).unwrap_err();
        assert_eq!(err, "Choose a folder outside OpenCephAI's own data.");
    }
}
