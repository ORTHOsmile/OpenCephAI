//! Report and CSV exports (spec 2026-10-17 report-exports): writes the bytes the screen made to the file the clinician
//! chose in the save dialog. This is the only way the report and CSV leave the app, and only where the clinician puts them.

use std::path::{Component, Path, PathBuf};

/// The `path` header arrives percent-encoded: header values must be ASCII, and a folder name may not be.
pub fn percent_decode(s: &str) -> Result<String, String> {
    const BAD: &str = "The file name arrived damaged; choose the file again.";
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' {
            let hex = s.get(i + 1..i + 3).ok_or(BAD)?;
            // preflight-rulings Task 1 (Minor): `u8::from_str_radix` accepts a leading `+`, so check both
            // characters are hex digits first — otherwise "%+1" silently decodes to byte 0x01.
            if !hex.bytes().all(|c| c.is_ascii_hexdigit()) { return Err(BAD.to_string()); }
            out.push(u8::from_str_radix(hex, 16).map_err(|_| BAD)?);
            i += 3;
        } else {
            out.push(b[i]);
            i += 1;
        }
    }
    String::from_utf8(out).map_err(|_| BAD.to_string())
}

/// True if `dir`, or any ancestor of `dir`, is the same folder on disk as `root` — compared by filesystem
/// identity, not by path spelling. Fix round 2, O1: on macOS, `/System/Volumes/Data/...` names the very same
/// folder as its ordinary path (an APFS firmlink), but `Path::canonicalize` does not fold the two spellings
/// together, so comparing canonicalised path *strings* can be walked around by spelling the library folder (or
/// a symlinked parent that points at it) that way. Comparing the (device, inode) pair that the filesystem
/// itself assigns is immune to spelling, case and Unicode form.
#[cfg(unix)]
fn is_inside(dir: &Path, root: &Path) -> bool {
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

/// Windows-ready: stable per-file identity on Windows needs an open handle (`BY_HANDLE_FILE_INFORMATION`), not
/// a plain `Metadata`; until there is a Windows build to test it against, fall back to the canonical-path
/// ancestor compare this check used before O1 — correct there, since Windows has no macOS-style firmlink
/// spelling to walk around it with.
#[cfg(windows)]
fn is_inside(dir: &Path, root: &Path) -> bool {
    let Ok(real_root) = root.canonicalize() else { return false };
    let mut cur = dir.canonicalize().ok();
    while let Some(d) = cur {
        if d == real_root { return true; }
        cur = d.parent().map(PathBuf::from);
    }
    false
}

/// Where an export may be written: an absolute path, no `..`, ending `.pdf` or `.csv`, in a folder that exists, and
/// never inside the app's own library folder — so no mistake can ever overwrite the library.
pub fn export_target(path: &str, library_root: &Path) -> Result<PathBuf, String> {
    let p = PathBuf::from(path.trim());
    if path.trim().is_empty() || !p.is_absolute() || p.components().any(|c| matches!(c, Component::ParentDir)) {
        return Err("Choose where to save the file.".into());
    }
    let ext = p.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase());
    if !matches!(ext.as_deref(), Some("pdf" | "csv")) { return Err("Only .pdf and .csv files are saved here.".into()); }
    let name = p.file_name().ok_or("Choose a file name.")?;
    let parent = p.parent().filter(|d| d.is_dir()).ok_or("That folder does not exist.")?;
    let real_parent = parent.canonicalize().map_err(|e| format!("That folder can't be used ({e})."))?;
    // Fix round 1, I1: if the library folder itself can't be canonicalised (e.g. a fresh install, before any
    // case has been opened), refuse rather than fall back to a check that could let an export through it
    // should have refused.
    if library_root.canonicalize().is_err() {
        return Err("Couldn't check the app's library folder; open a case first, then try again.".into());
    }
    // Fix round 2, O1: identity-based check (see `is_inside`), not a canonical-path comparison.
    if is_inside(&real_parent, library_root) {
        return Err("Save exports outside the app's library folder.".into());
    }
    let out = real_parent.join(name);
    // Fix round 1, C1: tell the clinician plainly if their chosen name is already a shortcut (symlink), rather
    // than silently replacing it. `write_export`'s temp-file-then-rename (fix round 2, N1) does not rely on
    // this check for safety — a rename can never write through an existing symlink or hard link at the
    // destination — but leaving an existing shortcut untouched and explained is better than silently replacing
    // it without saying so.
    if let Ok(meta) = std::fs::symlink_metadata(&out) {
        if meta.file_type().is_symlink() {
            return Err("That name is already a shortcut (symlink); choose a different name.".into());
        }
    }
    Ok(out)
}

/// Writes the export without ever writing through whatever is already at `target`. Fix round 2, N1: the old
/// `std::fs::write(target, …)` opens `target` directly (`O_CREAT|O_TRUNC`, no `O_NOFOLLOW`), so it follows a
/// symlink there and, for a hard link, writes through the *shared inode* straight into whatever else that
/// inode is named from (CWE-59/CWE-62) — the one thing this task exists to prevent. Instead, a brand-new temp
/// file is written and fsynced in the same folder, then renamed over `target`: a rename replaces the directory
/// entry itself, so it can never write through an existing symlink or hard link, and there is no window between
/// checking the path (`export_target`) and writing it. On Windows a file open in Excel still can't be replaced,
/// so the message says what to do.
pub fn write_export(target: &Path, bytes: &[u8]) -> Result<(), String> {
    let say = |e: std::io::Error| format!("Couldn't save the file ({e}). If it is open in another program, close it and try again.");
    let dir = target.parent().filter(|d| !d.as_os_str().is_empty()).unwrap_or_else(|| Path::new("."));
    static COUNTER: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    let n = COUNTER.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    let pid = std::process::id();
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let leaf = target.file_name().and_then(|n| n.to_str()).unwrap_or("export");
    let tmp = dir.join(format!(".{leaf}.tmp-{pid}-{nanos}-{n}"));
    let mut file = std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(say)?;
    use std::io::Write as _;
    if let Err(e) = file.write_all(bytes).and_then(|_| file.sync_all()) {
        let _ = std::fs::remove_file(&tmp);
        return Err(say(e));
    }
    drop(file);
    std::fs::rename(&tmp, target).map_err(|e| { let _ = std::fs::remove_file(&tmp); say(e) })
}

/// Writes the export (`export_target`, then `write_export`), and only once the file is written, for a PDF report of a
/// film (`case`), calls `record` with that film's id (Library ▸ Table "Report" column, owner 29 Oct; format 16). A refused
/// or failed write returns its error and records nothing. A failed record is logged and the save still reads as done:
/// the clinician's file is on disk, and saying otherwise would send them to save it again for nothing.
pub fn save_export(path: &str, library_root: &Path, bytes: &[u8], case: Option<&str>, record: impl FnOnce(&str) -> Result<(), String>) -> Result<(), String> {
    let target = export_target(path, library_root)?;
    write_export(&target, bytes)?;
    let is_pdf = target.extension().and_then(|e| e.to_str()).is_some_and(|e| e.eq_ignore_ascii_case("pdf"));
    if let (true, Some(id)) = (is_pdf, case) {
        if let Err(e) = record(id) { eprintln!("report saved, but its date was not recorded in the library: {e}"); }
    }
    Ok(())
}

/// The screen hands over the file's bytes as the raw body, the chosen path in the `path` header and, for a film's PDF
/// report, the film in the `case` header (both percent-encoded).
/// Final review m4: `async`, so Tauri runs it off the main thread — it may wait for the library lock to record the date.
#[tauri::command(async)]
pub fn export_write(app: tauri::AppHandle, request: tauri::ipc::Request) -> Result<(), String> {
    use tauri::Manager;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else { return Err("The file's contents did not arrive.".into()) };
    let raw = request.headers().get("path").and_then(|v| v.to_str().ok()).ok_or("No file name arrived.")?;
    // Final review m3: a damaged `case` header only means no date is recorded; it never stops the clinician's save.
    let case = request.headers().get("case").and_then(|v| v.to_str().ok()).and_then(|c| percent_decode(c).ok());
    let root = app.path().app_data_dir().map_err(|e| e.to_string())?;
    save_export(&percent_decode(raw)?, &root, bytes, case.as_deref(), |id| {
        let lib = crate::library::shared(&app)?;
        let mut g = lib.lock().map_err(|_| "the library is unavailable".to_string())?;
        g.as_mut().ok_or("the library is not open")?.record_report_saved(id).map(|_| ()).map_err(|e| format!("{e:#}"))
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // Library ▸ Table "Report" column (owner, 29 Oct; format 16): the report's date is recorded ONLY after the PDF file
    // itself was written. Production change that fails these: recording before `write_export`, or whatever it returns.
    #[test] fn a_pdf_written_for_a_film_records_its_report_date_after_the_file_is_on_disk() {
        let (out, lib) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let path = out.path().join("report.pdf");
        let seen = std::cell::RefCell::new(Vec::new());
        save_export(path.to_str().unwrap(), lib.path(), b"%PDF-SYNTHETIC", Some("c1"), |id| {
            seen.borrow_mut().push((id.to_string(), std::fs::read(&path).ok()));   // what is on disk at the moment it records
            Ok(())
        }).unwrap();
        assert_eq!(seen.into_inner(), vec![("c1".to_string(), Some(b"%PDF-SYNTHETIC".to_vec()))], "recorded once, with the file already written");
    }
    #[test] fn a_failed_write_records_nothing() {
        let (out, lib) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let calls = std::cell::Cell::new(0);
        // Refused before writing: a folder that does not exist, and a path inside the library.
        for bad in [out.path().join("missing").join("r.pdf"), lib.path().join("r.pdf")] {
            assert!(save_export(bad.to_str().unwrap(), lib.path(), b"%PDF-", Some("c1"), |_| { calls.set(calls.get() + 1); Ok(()) }).is_err());
        }
        // Fails while writing: a folder the app may not write into.
        #[cfg(unix)] {
            use std::os::unix::fs::PermissionsExt;
            let ro = out.path().join("ro");
            std::fs::create_dir(&ro).unwrap();
            std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o555)).unwrap();
            let r = save_export(ro.join("r.pdf").to_str().unwrap(), lib.path(), b"%PDF-", Some("c1"), |_| { calls.set(calls.get() + 1); Ok(()) });
            std::fs::set_permissions(&ro, std::fs::Permissions::from_mode(0o755)).unwrap();
            assert!(r.is_err(), "the write itself failed");
            assert!(!ro.join("r.pdf").exists());
        }
        assert_eq!(calls.get(), 0, "no report date for a file that was not written");
    }
    #[test] fn only_a_pdf_for_a_named_film_records_and_a_failed_record_still_reports_the_file_saved() {
        let (out, lib) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
        let calls = std::cell::Cell::new(0);
        let count = |_: &str| { calls.set(calls.get() + 1); Ok(()) };
        save_export(out.path().join("m.csv").to_str().unwrap(), lib.path(), b"a,b", Some("c1"), count).unwrap();
        save_export(out.path().join("r.pdf").to_str().unwrap(), lib.path(), b"%PDF-", None, count).unwrap();
        assert_eq!(calls.get(), 0, "a CSV, or a PDF named for no film, records nothing");
        // The file is saved even if the library can't take the date (logged); the save itself must not read as failed.
        save_export(out.path().join("r2.pdf").to_str().unwrap(), lib.path(), b"%PDF-", Some("c1"), |_| Err("SYNTHETIC: library busy".into())).unwrap();
        assert_eq!(std::fs::read(out.path().join("r2.pdf")).unwrap(), b"%PDF-");
    }

    #[test] fn decodes_the_path_header_including_spaces_and_non_ascii_folder_names() {
        assert_eq!(percent_decode("%2FUsers%2Fdemo%2FR%C3%B6ntgen%20SYNTHETIC%2Freport.pdf").unwrap(), "/Users/demo/Röntgen SYNTHETIC/report.pdf");
        assert_eq!(percent_decode("plain").unwrap(), "plain");
        for bad in ["%2", "%ZZ", "%C3", "%+1"] { assert!(percent_decode(bad).is_err(), "{bad}"); }   // %C3 alone is half a letter; %+1 is not hex
    }

    #[test] fn an_export_goes_only_to_a_pdf_or_csv_in_an_existing_folder_outside_the_library() {
        let out = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let real_out = out.path().canonicalize().unwrap();
        assert_eq!(export_target(out.path().join("report.PDF").to_str().unwrap(), lib.path()).unwrap(), real_out.join("report.PDF"));
        assert_eq!(export_target(out.path().join("m.csv").to_str().unwrap(), lib.path()).unwrap(), real_out.join("m.csv"));
        for bad in ["", "   ", "report.pdf", "relative/report.pdf"] { assert!(export_target(bad, lib.path()).is_err(), "{bad:?}"); }
        assert!(export_target(out.path().join("x.sqlite3").to_str().unwrap(), lib.path()).is_err());
        assert!(export_target(out.path().join("x").to_str().unwrap(), lib.path()).is_err());
        assert!(export_target(out.path().join("missing").join("x.pdf").to_str().unwrap(), lib.path()).is_err());
        assert!(export_target(out.path().join("sub").join("..").join("x.pdf").to_str().unwrap(), lib.path()).is_err());
        // Positive control for the library rule: the same file name is fine outside, refused inside.
        assert!(export_target(lib.path().join("x.pdf").to_str().unwrap(), lib.path()).is_err());
        let inner = lib.path().join("images");
        std::fs::create_dir(&inner).unwrap();
        assert!(export_target(inner.join("x.csv").to_str().unwrap(), lib.path()).is_err());
    }

    // Fix round 1, C1: a symlink at the chosen file name must never be followed for a write — whether it
    // points into the library (the one thing this task exists to prevent) or anywhere else (an arbitrary
    // local-file overwrite). CWE-59.
    // Fix round 2, N2: calls the full `export_target` → `write_export` path, exactly as `export_write` does
    // (`and_then`), rather than stopping at `export_target` alone — so this exercises the command's actual
    // behaviour, not just one of its two functions.
    // Final review I1: std::os::unix::fs::symlink does not exist off Unix, so this must not even be compiled on
    // Windows (master plan §13, Windows-ready) — same cfg pattern as system_font.rs's unix-only tests.
    #[cfg(unix)]
    #[test] fn a_symlinked_leaf_pointing_into_the_library_is_refused_and_nothing_is_written_there() {
        let out = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let secret = lib.path().join("secret.txt");
        std::fs::write(&secret, b"library data, never exported").unwrap();
        let evil = out.path().join("report.pdf");
        std::os::unix::fs::symlink(&secret, &evil).unwrap();
        let err = export_target(evil.to_str().unwrap(), lib.path()).and_then(|t| write_export(&t, b"EXPORT")).unwrap_err();
        assert!(err.to_lowercase().contains("symlink") || err.to_lowercase().contains("shortcut"), "{err}");
        assert_eq!(std::fs::read(&secret).unwrap(), b"library data, never exported", "nothing may be written through the symlink");
    }

    // Final review I1: unix-only, same reason as above.
    #[cfg(unix)]
    #[test] fn a_symlinked_leaf_pointing_elsewhere_is_refused() {
        let out = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let arbitrary = elsewhere.path().join("anything.bin");
        std::fs::write(&arbitrary, b"arbitrary file, must not be overwritten").unwrap();
        let evil = out.path().join("m.csv");
        std::os::unix::fs::symlink(&arbitrary, &evil).unwrap();
        let err = export_target(evil.to_str().unwrap(), lib.path()).and_then(|t| write_export(&t, b"EXPORT")).unwrap_err();
        assert!(err.to_lowercase().contains("symlink") || err.to_lowercase().contains("shortcut"), "{err}");
        assert_eq!(std::fs::read(&arbitrary).unwrap(), b"arbitrary file, must not be overwritten");
    }

    // Fix round 1, I1: when the library folder can't be canonicalised (e.g. not created yet on a fresh
    // install), the check must refuse, not fall back to a weaker raw comparison that could let an export
    // through it should have refused.
    // Fix round 2, N3: assert the exact refusal message, so a different refusal further down the function
    // (e.g. the generic "outside the library folder" one) can't be mistaken for this one.
    #[test] fn when_the_library_folder_cannot_be_canonicalised_the_export_is_refused() {
        let out = tempfile::tempdir().unwrap();
        let base = tempfile::tempdir().unwrap();
        let missing_lib = base.path().join("not-created-yet");
        assert!(missing_lib.canonicalize().is_err(), "the test needs this path to not exist");
        let err = export_target(out.path().join("report.pdf").to_str().unwrap(), &missing_lib).unwrap_err();
        assert_eq!(err, "Couldn't check the app's library folder; open a case first, then try again.");
    }

    // Fix round 2, O1: on this Mac, `/System/Volumes/Data<realpath>` names the very same folder as `<realpath>`
    // (an APFS firmlink) — confirmed directly before writing this test (`stat -f '%d %i'` on both spellings
    // gives the same device and inode). `Path::canonicalize` does not fold the two spellings together, so the
    // old canonical-path-string check could be walked around by spelling the library folder that way.
    // Final review I1: /System/Volumes/Data is a macOS-specific APFS firmlink; the same spelling is not a real
    // folder on Linux or Windows, so this would fail outright off macOS.
    #[cfg(target_os = "macos")]
    #[test] fn a_macos_firmlink_spelling_of_the_library_folder_is_still_refused() {
        let lib = tempfile::tempdir().unwrap();
        let real_lib = lib.path().canonicalize().unwrap();
        let firmlink_spelling = PathBuf::from(format!("/System/Volumes/Data{}", real_lib.display()));
        assert!(firmlink_spelling.is_dir(), "this test needs the /System/Volumes/Data firmlink to exist on this Mac");
        assert_ne!(
            firmlink_spelling.canonicalize().unwrap(), real_lib,
            "the test needs these two spellings of the same folder to differ as strings after canonicalising"
        );
        let target = firmlink_spelling.join("firm.pdf");
        let err = export_target(target.to_str().unwrap(), lib.path()).unwrap_err();
        assert_eq!(err, "Save exports outside the app's library folder.");
    }

    // Fix round 2, N1 (CWE-62): a hard link shares its *inode* with the file it was linked from, so opening the
    // link and truncating it (the old `std::fs::write`) writes through to the library file too. Renaming a
    // fresh temp file over the link's directory entry never touches that shared inode.
    #[test] fn write_export_never_writes_through_a_hard_link_into_the_library() {
        let lib = tempfile::tempdir().unwrap();
        let out = tempfile::tempdir().unwrap();
        let secret = lib.path().join("secret.sqlite");
        std::fs::write(&secret, b"library data, never exported").unwrap();
        let target = out.path().join("report.pdf");
        std::fs::hard_link(&secret, &target).unwrap();   // same inode as the library file; not a symlink
        write_export(&target, b"EXPORT").unwrap();
        assert_eq!(std::fs::read(&secret).unwrap(), b"library data, never exported", "the library file must be untouched");
        assert_eq!(std::fs::read(&target).unwrap(), b"EXPORT", "the export itself must still succeed");
    }

    // Fix round 2, N1 (CWE-367, TOCTOU): simulates the race window between `export_target` saying Ok (nothing
    // existed yet at `target`) and `write_export` actually running, by planting a symlink in between.
    // Final review I1: unix-only, same reason as above.
    #[cfg(unix)]
    #[test] fn write_export_never_writes_through_a_symlink_planted_after_the_check() {
        let out = tempfile::tempdir().unwrap();
        let lib = tempfile::tempdir().unwrap();
        let target = out.path().join("race.pdf");
        assert!(export_target(target.to_str().unwrap(), lib.path()).is_ok(), "nothing exists at target yet");
        let model = lib.path().join("w.onnx");
        std::fs::write(&model, b"model weights, never exported").unwrap();
        std::os::unix::fs::symlink(&model, &target).unwrap();   // the race: planted after the check above
        write_export(&target, b"EXPORT").unwrap();
        assert_eq!(std::fs::read(&model).unwrap(), b"model weights, never exported", "the planted symlink's target must be untouched");
        assert_eq!(std::fs::read(&target).unwrap(), b"EXPORT", "the export itself must still succeed");
    }

    #[test] fn writes_the_bytes_and_a_failure_says_what_to_do() {
        let out = tempfile::tempdir().unwrap();
        let f = out.path().join("r.pdf");
        write_export(&f, b"%PDF-1.3 SYNTHETIC").unwrap();
        assert_eq!(std::fs::read(&f).unwrap(), b"%PDF-1.3 SYNTHETIC");
        write_export(&f, b"second").unwrap();   // replacing an earlier export is allowed
        assert_eq!(std::fs::read(&f).unwrap(), b"second");
        let err = write_export(out.path(), b"x").unwrap_err();   // a folder, not a file
        assert!(err.contains("close it and try again"), "{err}");
    }
}
