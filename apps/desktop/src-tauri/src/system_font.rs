//! Task 7A (owner FONT-2, 18 Oct 2026): finds a TrueType font already installed on this computer that can print
//! Chinese, Japanese or Korean, so the PDF report never needs to download, bundle or commit one. Only paths this
//! module's own `candidates()` names right now are ever read — never an arbitrary file the caller asks for.
//! Windows-ready: `font_dirs`/`candidates` take `os`/`env` so both lists are exercised from this Mac; the actual
//! Windows file names are unverified until the Windows build (the TS side decides what to do with whatever a real
//! Windows machine answers).

use std::path::PathBuf;

/// macOS: start → ja/ko add nothing more; zh adds three more. Windows: unverified file names (preflight-rulings
/// Task 7A), kept here only so `candidates` has something to look up once a Windows build can test them for real.
const MAC_FILES: &[(&str, &[&str])] = &[
    ("zh", &["Arial Unicode.ttf", "STHeiti Medium.ttc", "STHeiti Light.ttc", "Songti.ttc"]),
    ("ja", &["Arial Unicode.ttf"]),
    ("ko", &["Arial Unicode.ttf"]),
];
const WIN_FILES: &[(&str, &[&str])] = &[
    ("zh", &["msyh.ttc", "simsun.ttc", "simhei.ttf"]),
    ("ja", &["YuGothR.ttc", "meiryo.ttc", "msgothic.ttc"]),
    ("ko", &["malgun.ttf", "gulim.ttc"]),
];
/// Never read a font file bigger than this (a 50 MB+ read must not block the window either way — see `system_font_read`).
const MAX_FONT_BYTES: u64 = 100 * 1024 * 1024;

/// Joins a Windows base path with `\`-separated parts, regardless of the HOST platform building this binary
/// (so a Windows path can be constructed and tested correctly from a Mac test run).
fn win_join(base: &std::ffi::OsStr, parts: &[&str]) -> PathBuf {
    let mut s = base.to_string_lossy().into_owned();
    for p in parts {
        if !s.ends_with('\\') { s.push('\\'); }
        s.push_str(p);
    }
    PathBuf::from(s)
}

/// Where this OS keeps its fonts. Pure (env is passed in) so both OS's lists can be exercised from this Mac.
pub fn font_dirs(os: &str, env: impl Fn(&str) -> Option<std::ffi::OsString>) -> Vec<PathBuf> {
    match os {
        "macos" => {
            let mut v = vec![
                PathBuf::from("/System/Library/Fonts"),
                PathBuf::from("/System/Library/Fonts/Supplemental"),
                PathBuf::from("/Library/Fonts"),
            ];
            if let Some(home) = env("HOME") { v.push(PathBuf::from(home).join("Library").join("Fonts")); }
            v
        }
        "windows" => {
            // Built with an explicit `\` rather than `PathBuf::join` (which joins with the HOST's own
            // separator): this runs under test on a Mac, where `Path::join` would use `/` and silently
            // produce a path no real Windows machine has — caught by `font_dirs_windows_with_windir_and_localappdata_set`.
            let fonts = match env("WINDIR") {
                Some(w) => win_join(&w, &["Fonts"]),
                None => PathBuf::from(r"C:\Windows\Fonts"),
            };
            let mut v = vec![fonts];
            if let Some(local) = env("LOCALAPPDATA") { v.push(win_join(&local, &["Microsoft", "Windows", "Fonts"])); }
            v
        }
        _ => vec![],
    }
}

/// `script`'s own list first, then the other two (fixed zh/ja/ko order after it).
fn script_order(script: &str) -> [&'static str; 3] {
    match script {
        "zh" => ["zh", "ja", "ko"],
        "ja" => ["ja", "zh", "ko"],
        "ko" => ["ko", "zh", "ja"],
        _ => ["zh", "ja", "ko"],
    }
}

/// Existing files only, in `script_order` order, no duplicate paths (the mac lists all start with the same file).
/// `dirs` is searched in order for each file name; the first directory that has it wins.
pub fn candidates(script: &str, os: &str, dirs: &[PathBuf]) -> Vec<PathBuf> {
    let table: &[(&str, &[&str])] = match os {
        "macos" => MAC_FILES,
        "windows" => WIN_FILES,
        _ => return vec![],
    };
    let mut out: Vec<PathBuf> = Vec::new();
    for s in script_order(script) {
        let Some((_, files)) = table.iter().find(|(k, _)| *k == s) else { continue };
        for &name in *files {
            for dir in dirs {
                let p = dir.join(name);
                if p.is_file() {
                    if !out.contains(&p) { out.push(p); }
                    break; // the first directory on the list that has this name wins
                }
            }
        }
    }
    out
}

/// Task 7A review m1: true when `p`, once every symlink in it is resolved, still lives DIRECTLY inside one of
/// `dirs` (also canonicalised). `candidates()` uses `is_file()`, which follows symlinks, so a symlink sitting in
/// a listed font folder under a real candidate's NAME would otherwise be read straight through to its target —
/// this refuses it even though the path-text match in `is_candidate` alone would have allowed it.
fn resolves_inside(p: &std::path::Path, dirs: &[PathBuf]) -> bool {
    let Ok(real) = std::fs::canonicalize(p) else { return false };
    let Some(real_parent) = real.parent() else { return false };
    dirs.iter().any(|d| std::fs::canonicalize(d).map(|cd| cd == real_parent).unwrap_or(false))
}

/// `path` is usable only if it is exactly one of `candidates(script, os, dirs)`, computed fresh right now — never
/// an arbitrary file the caller names — AND its real, symlink-resolved location still sits directly inside one of
/// `dirs` (m1). Factored out so the guard itself (not just the command around it) is tested directly, without
/// depending on what happens to exist on the real machine running the test.
fn is_candidate(script: &str, os: &str, dirs: &[PathBuf], path: &std::path::Path) -> bool {
    candidates(script, os, dirs).iter().any(|c| c == path) && resolves_inside(path, dirs)
}

#[tauri::command]
pub fn system_font_list(script: String) -> Vec<String> {
    let os = std::env::consts::OS;
    let dirs = font_dirs(os, |k| std::env::var_os(k));
    candidates(&script, os, &dirs).into_iter().map(|p| p.display().to_string()).collect()
}

/// Task 7A review I3: opens the file ONCE and checks `is_file()` on that same HANDLE (not a separate stat by
/// path, which a swap between the check and the read could race past — a growing file, a symlink to `/dev/zero`,
/// or a FIFO would all have passed the old `fs::metadata` + `fs::read` pair). Reads at most `max + 1` bytes
/// (`Read::take`), so a file that is actually larger never has to be read in full before being refused, and
/// refuses anything over `max`. Pure `&Path`/`max` so the limit itself can be tested (I4) without a 100 MB file.
fn read_font(p: &std::path::Path, max: u64) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let mut f = std::fs::File::open(p).map_err(|_| "That file is not one of this computer's own fonts.".to_string())?;
    let is_file = f.metadata().map_err(|e| e.to_string())?.is_file();
    if !is_file {
        return Err("That file is not one of this computer's own fonts.".into());
    }
    let mut v = Vec::new();
    f.by_ref().take(max + 1).read_to_end(&mut v).map_err(|e| e.to_string())?;
    if v.len() as u64 > max {
        return Err("That font file is too large to use.".into());
    }
    Ok(v)
}

/// Reads ONLY a path `candidates(script, …)` returns right now; refuses anything else, and anything over
/// `MAX_FONT_BYTES`. `async` so a large read never blocks the window (the blocking I/O itself runs off the async
/// executor's own thread via `spawn_blocking`, the same pattern `detect_landmarks` uses elsewhere in this crate).
#[tauri::command]
pub async fn system_font_read(script: String, path: String) -> Result<tauri::ipc::Response, String> {
    let os = std::env::consts::OS;
    let dirs = font_dirs(os, |k| std::env::var_os(k));
    let p = PathBuf::from(&path);
    if !is_candidate(&script, os, &dirs, &p) {
        return Err("That file is not one of this computer's own fonts.".into());
    }
    tauri::async_runtime::spawn_blocking(move || read_font(&p, MAX_FONT_BYTES))
        .await
        .map_err(|e| e.to_string())?
        .map(tauri::ipc::Response::new)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri::ipc::{InvokeResponseBody, IpcResponse};

    fn env_of(pairs: &'static [(&'static str, &'static str)]) -> impl Fn(&str) -> Option<std::ffi::OsString> {
        move |k: &str| pairs.iter().find(|(n, _)| *n == k).map(|(_, v)| std::ffi::OsString::from(*v))
    }

    #[test]
    fn font_dirs_macos_is_the_four_folders_in_order_with_home_last() {
        let dirs = font_dirs("macos", env_of(&[("HOME", "/Users/demo")]));
        assert_eq!(dirs, vec![
            PathBuf::from("/System/Library/Fonts"),
            PathBuf::from("/System/Library/Fonts/Supplemental"),
            PathBuf::from("/Library/Fonts"),
            PathBuf::from("/Users/demo/Library/Fonts"),
        ]);
    }

    #[test]
    fn font_dirs_macos_without_home_skips_the_per_user_folder() {
        assert_eq!(font_dirs("macos", env_of(&[])), vec![
            PathBuf::from("/System/Library/Fonts"),
            PathBuf::from("/System/Library/Fonts/Supplemental"),
            PathBuf::from("/Library/Fonts"),
        ]);
    }

    #[test]
    fn font_dirs_windows_with_windir_and_localappdata_set() {
        let dirs = font_dirs("windows", env_of(&[("WINDIR", r"D:\Win"), ("LOCALAPPDATA", r"C:\Users\demo\AppData\Local")]));
        assert_eq!(dirs, vec![
            PathBuf::from(r"D:\Win\Fonts"),
            PathBuf::from(r"C:\Users\demo\AppData\Local\Microsoft\Windows\Fonts"),
        ]);
    }

    #[test]
    fn font_dirs_windows_with_neither_set_falls_back_to_the_default_fonts_folder_only() {
        assert_eq!(font_dirs("windows", env_of(&[])), vec![PathBuf::from(r"C:\Windows\Fonts")]);
    }

    #[test]
    fn font_dirs_other_os_is_empty() {
        assert_eq!(font_dirs("linux", env_of(&[])), Vec::<PathBuf>::new());
    }

    /// macOS candidates, from a temp folder of empty stand-in files: script's own list first, missing files
    /// skipped, and the file shared by all three scripts' lists (Arial Unicode.ttf) never repeated.
    #[test]
    fn mac_candidates_are_in_script_order_missing_skipped_no_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["Arial Unicode.ttf", "STHeiti Light.ttc", "Songti.ttc"] {
            std::fs::write(dir.path().join(name), b"").unwrap(); // STHeiti Medium.ttc deliberately missing
        }
        let dirs = vec![dir.path().to_path_buf()];
        assert_eq!(
            candidates("zh", "macos", &dirs),
            vec![dir.path().join("Arial Unicode.ttf"), dir.path().join("STHeiti Light.ttc"), dir.path().join("Songti.ttc")],
        );
        // ja's and ko's own lists are just Arial Unicode.ttf — already placed first by zh above when asked for zh;
        // asked for ja/ko directly, each one's own (single-file) list comes first, same path either way here.
        assert_eq!(candidates("ja", "macos", &dirs), vec![dir.path().join("Arial Unicode.ttf"), dir.path().join("STHeiti Light.ttc"), dir.path().join("Songti.ttc")]);
        assert_eq!(candidates("ko", "macos", &dirs), vec![dir.path().join("Arial Unicode.ttf"), dir.path().join("STHeiti Light.ttc"), dir.path().join("Songti.ttc")]);
    }

    #[test]
    fn candidates_for_an_unknown_os_is_always_empty() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("Arial Unicode.ttf"), b"").unwrap();
        assert_eq!(candidates("zh", "linux", &[dir.path().to_path_buf()]), Vec::<PathBuf>::new());
    }

    /// Windows candidates from the same kind of temp stand-ins (unverified real names, but the order/skip/dedupe
    /// logic is OS-agnostic and testable on this Mac).
    #[test]
    fn windows_candidates_are_in_script_order_missing_skipped() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["msyh.ttc", "simhei.ttf"] { std::fs::write(dir.path().join(name), b"").unwrap(); } // simsun.ttc missing
        let dirs = vec![dir.path().to_path_buf()];
        assert_eq!(candidates("zh", "windows", &dirs), vec![dir.path().join("msyh.ttc"), dir.path().join("simhei.ttf")]);
    }

    #[test]
    fn a_file_present_in_an_earlier_dir_is_not_also_taken_from_a_later_one() {
        let first = tempfile::tempdir().unwrap();
        let second = tempfile::tempdir().unwrap();
        std::fs::write(first.path().join("Arial Unicode.ttf"), b"FIRST").unwrap();
        std::fs::write(second.path().join("Arial Unicode.ttf"), b"SECOND").unwrap();
        let dirs = vec![first.path().to_path_buf(), second.path().to_path_buf()];
        assert_eq!(candidates("ja", "macos", &dirs), vec![first.path().join("Arial Unicode.ttf")]);
    }

    /// The read guard — positive control: the very same file name sitting in a folder `candidates` was not given
    /// is refused; the one `candidates` actually lists is allowed.
    #[test]
    fn is_candidate_refuses_the_same_file_name_in_a_folder_not_on_the_list() {
        let allowed_dir = tempfile::tempdir().unwrap();
        let other_dir = tempfile::tempdir().unwrap();
        let name = "Arial Unicode.ttf";
        std::fs::write(allowed_dir.path().join(name), b"ALLOWED").unwrap();
        std::fs::write(other_dir.path().join(name), b"NOT ALLOWED").unwrap();
        let dirs = vec![allowed_dir.path().to_path_buf()];
        let listed = candidates("zh", "macos", &dirs);
        assert_eq!(listed, vec![allowed_dir.path().join(name)]);
        assert!(is_candidate("zh", "macos", &dirs, &listed[0]), "the listed path must be allowed");
        assert!(!is_candidate("zh", "macos", &dirs, &other_dir.path().join(name)), "the same name elsewhere must be refused");
    }

    /// Task 7A review I4: the old version of this test asserted constant arithmetic (`MAX + 1 > MAX`), which no
    /// change to the real guard could ever fail. This drives the actual read through a parameterised limit.
    #[test]
    fn read_font_refuses_over_the_limit_and_allows_exactly_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let max = 10u64;
        let ok_path = dir.path().join("ok.ttf");
        std::fs::write(&ok_path, vec![0u8; max as usize]).unwrap();
        assert_eq!(read_font(&ok_path, max).unwrap().len(), max as usize);
        let over_path = dir.path().join("over.ttf");
        std::fs::write(&over_path, vec![0u8; (max + 1) as usize]).unwrap();
        assert!(read_font(&over_path, max).is_err());
    }

    /// Task 7A review I4 ("a directory or FIFO is refused"): the handle-level `is_file()` check in `read_font`
    /// (not a path-level stat, which could race) must refuse a directory outright.
    #[cfg(unix)]
    #[test]
    fn read_font_refuses_a_directory() {
        let dir = tempfile::tempdir().unwrap();
        assert!(read_font(dir.path(), MAX_FONT_BYTES).is_err());
    }

    /// Task 7A review I3: compared with the stat-then-reopen pattern this replaces, `read_font` opens the file
    /// ONCE and checks `is_file()` on that same handle — so a symlink whose target is a non-regular file (here,
    /// the null device) is refused instead of being read until memory runs out or a pool thread blocks forever.
    #[cfg(unix)]
    #[test]
    fn read_font_refuses_a_symlink_to_a_non_regular_file() {
        let dir = tempfile::tempdir().unwrap();
        let link = dir.path().join("Arial Unicode.ttf");
        std::os::unix::fs::symlink("/dev/null", &link).unwrap();
        assert!(read_font(&link, MAX_FONT_BYTES).is_err());
    }

    /// Task 7A review m1: `candidates()` still lists a symlink whose NAME matches (it uses `is_file()`, which
    /// follows symlinks) — but `is_candidate` must refuse one whose real (canonicalised) location is not a
    /// listed font directory, even though its target is a perfectly real font file elsewhere.
    #[cfg(unix)]
    #[test]
    fn is_candidate_refuses_a_symlink_even_when_its_target_is_a_real_font_elsewhere() {
        let allowed_dir = tempfile::tempdir().unwrap();
        let elsewhere = tempfile::tempdir().unwrap();
        let real_target = elsewhere.path().join("real.ttf");
        std::fs::write(&real_target, b"REAL FONT BYTES").unwrap();
        let link = allowed_dir.path().join("Arial Unicode.ttf");
        std::os::unix::fs::symlink(&real_target, &link).unwrap();
        let dirs = vec![allowed_dir.path().to_path_buf()];
        assert_eq!(candidates("zh", "macos", &dirs), vec![link.clone()]); // listed (is_file follows the symlink)
        assert!(!is_candidate("zh", "macos", &dirs, &link)); // but refused: its real parent isn't an allowed dir
    }

    /// Task 7A review I4: the mac/ja/ko lists all happen to share their first file name (`Arial Unicode.ttf`), so
    /// the old Windows test (zh only) could not tell "ja"/"ko" apart from "zh" — giving ja and ko the zh order
    /// left all 13 old tests green (the report's induced failure 2). These Windows stand-ins have distinct names
    /// per script, so they can.
    #[test]
    fn windows_candidates_put_each_scripts_own_list_first_ja_and_ko_included() {
        let dir = tempfile::tempdir().unwrap();
        for name in ["msyh.ttc", "simsun.ttc", "simhei.ttf", "YuGothR.ttc", "meiryo.ttc", "msgothic.ttc", "malgun.ttf", "gulim.ttc"] {
            std::fs::write(dir.path().join(name), b"").unwrap();
        }
        let dirs = vec![dir.path().to_path_buf()];
        let ja = candidates("ja", "windows", &dirs);
        assert_eq!(&ja[..3], &[dir.path().join("YuGothR.ttc"), dir.path().join("meiryo.ttc"), dir.path().join("msgothic.ttc")]);
        let ko = candidates("ko", "windows", &dirs);
        assert_eq!(&ko[..2], &[dir.path().join("malgun.ttf"), dir.path().join("gulim.ttc")]);
    }

    /// Exercises the actual async command end to end: refuses a real file sitting outside any candidate folder.
    #[test]
    fn system_font_read_refuses_a_path_outside_every_real_candidate_folder() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("Arial Unicode.ttf");
        std::fs::write(&p, b"not actually a system font").unwrap();
        let result = tauri::async_runtime::block_on(system_font_read("zh".to_string(), p.display().to_string()));
        let err = match result { Err(e) => e, Ok(_) => panic!("expected the read to be refused") };
        assert_eq!(err, "That file is not one of this computer's own fonts.");
    }

    /// On this Mac (preflight-rulings Task 7A), Arial Unicode.ttf is a real, currently-listed zh/ja/ko candidate:
    /// the command reads it and returns non-empty bytes — the positive half of the guard, through the real command.
    /// Task 7A review m8: `#[ignore]` (not a silent `eprintln!` + `return`) makes the skip visible in the normal
    /// `cargo test` summary as "ignored", matching this crate's own convention elsewhere; run explicitly with
    /// `cargo test -- --ignored` on a real Mac. Once a caller HAS opted in that way, a missing font FAILS this
    /// test loudly instead of returning as a silent pass.
    #[cfg(target_os = "macos")]
    #[ignore = "needs the real Arial Unicode.ttf on this Mac; run with `cargo test -- --ignored`"]
    #[test]
    fn system_font_read_reads_a_real_listed_file_on_this_mac() {
        let dirs = font_dirs("macos", |k| std::env::var_os(k));
        let listed = candidates("zh", "macos", &dirs);
        let p = listed.into_iter().find(|p| p.file_name().and_then(|n| n.to_str()) == Some("Arial Unicode.ttf"))
            .expect("Arial Unicode.ttf not found on this Mac — this --ignored test needs it");
        let resp = tauri::async_runtime::block_on(system_font_read("zh".to_string(), p.display().to_string())).unwrap();
        let bytes = match resp.body().expect("response body") {
            InvokeResponseBody::Raw(b) => b,
            InvokeResponseBody::Json(_) => panic!("expected raw bytes, got JSON"),
        };
        assert!(!bytes.is_empty());
    }
}
