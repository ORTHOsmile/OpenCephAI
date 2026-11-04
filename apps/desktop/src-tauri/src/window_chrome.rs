//! The macOS close / minimise / zoom buttons, centred on our own toolbar on any macOS version (owner, 19 Oct 2026).
//!
//! The window uses an "Overlay" title bar, so the system draws its buttons over our toolbar. tao/wry place them from
//! `traffic_light_position` but keep AppKit's own gap below the buttons, so the button centre lands at
//! `y + h/2 - b` from the top of the window (h = button height, b = AppKit's gap below it). Both change between macOS
//! versions: on 26.1 h = 14, b = 9 (measured), before Tahoe h ≈ 16, b ≈ 6 (inferred). A fixed y therefore centres on
//! one version only (y = 28 sat about 4 points low on macOS 15). So `setup()` reads h and b on this Mac from a hidden
//! throwaway window of the same style and asks for `y = toolbar/2 + b - h/2`. wry keeps re-applying that y on
//! resize and theme change exactly as before. Research: the project notes(option a1).
//!
//! The toolbar centre is taken as 26 (half of the 52-pt band, border included), not 25.5 (the centre of the
//! toolbar's content above its 1-px bottom border, where its own buttons sit). 26 reproduces exactly the y = 28 the
//! owner approved on 26.1; the 0.5-pt difference is within the check's tolerance and under one pixel at 1x.
//!
//! Only `--check-window-chrome` (below) proves the centring on a given Mac; the unit tests pin the arithmetic.
//!
//! RULE: re-run `--check-window-chrome` on each Mac after any tauri / tao / wry update. This relies on their inset
//! algorithm keeping AppKit's gap below the buttons (tao `platform_impl/macos/view.rs` `inset_traffic_lights`, wry
//! `wkwebview/class/wry_web_view_parent.rs` `inset_traffic_lights`); if they start setting the buttons' vertical
//! origin themselves, the formula is wrong and only the real-window check will show it.
#![cfg_attr(not(target_os = "macos"), allow(dead_code))]

use std::path::{Component, Path, PathBuf};

/// The toolbar's height in points. Must equal `--layout-toolbar` in `src/styles/tokens.css` (windowChrome.test.ts).
pub const TOOLBAR_PT: f64 = 52.0;
/// The buttons' left inset, unchanged from the hand-tuned value.
pub const BUTTONS_X: f64 = 18.0;
/// The check passes when the measured centre is within this many points of the toolbar centre.
pub const TOLERANCE_PT: f64 = 0.5;
/// If the button geometry cannot be read: the value measured on macOS 26.1 (h = 14, b = 9), i.e. the old fixed y.
/// Believed unreachable: `setup()` runs on the main thread (so `MainThreadMarker::new()` is Some), and a titled,
/// closable window always has a close button (`standardWindowButton` is only nil for a style without it). Kept so
/// that a future AppKit surprise degrades to the old behaviour instead of a crash.
pub const FALLBACK_Y: f64 = 28.0;

pub const CHECK_FLAG: &str = "--check-window-chrome";
/// Only honoured together with CHECK_FLAG: the positive control (a deliberately wrong y must fail the check).
pub const FORCE_Y_FLAG: &str = "--check-window-chrome-force-y=";

/// The `traffic_light_position` y that puts the button centre on the toolbar's centre line.
pub fn centring_y(toolbar: f64, h: f64, b: f64) -> f64 { toolbar / 2.0 + b - h / 2.0 }

/// Whether a measured button centre (points from the window top) sits on the toolbar centre line.
pub fn centred(measured_centre: f64) -> bool { (measured_centre - TOOLBAR_PT / 2.0).abs() <= TOLERANCE_PT }

#[derive(Debug, PartialEq)]
pub struct CheckMode { pub force_y: Option<f64> }

/// The real-window check is on only with its flag; a forced y is read only inside it.
pub fn check_mode<I: IntoIterator<Item = String>>(args: I) -> Option<CheckMode> {
    let args: Vec<String> = args.into_iter().collect();
    if !args.iter().any(|a| a == CHECK_FLAG) { return None; }
    let force_y = args.iter().find_map(|a| a.strip_prefix(FORCE_Y_FLAG)).and_then(|v| v.parse::<f64>().ok());
    Some(CheckMode { force_y })
}

/// The check must never run where it could reach a real library, so this is a POSITIVE check: the app data folder
/// is allowed only if it lies inside the temporary folder. The path is resolved first (links followed; the part
/// that does not exist yet appended), then compared by folder identity (`files::is_inside`, device + inode), never
/// by spelling. Everything else is refused: any home in /Users or elsewhere, a relative path, a path with "..".
/// Run the check with HOME set to a fresh temporary folder (`HOME=$(mktemp -d)`).
pub fn refuse_dir(app_data: &Path) -> Option<String> {
    let no = |why: &str| Some(format!("app_data_dir {} {why}; run with HOME set to a fresh temporary folder (HOME=$(mktemp -d))", app_data.display()));
    if !app_data.is_absolute() { return no("is not absolute"); }
    if app_data.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) { return no("contains . or .."); }
    let Some(real) = resolve(app_data) else { return no("cannot be resolved") };
    if temp_roots().iter().any(|root| crate::files::is_inside(&real, root)) { None } else { no("is not inside the temporary folder") }
}

/// The path with its existing part canonicalised (links resolved) and the not-yet-existing rest appended.
fn resolve(p: &Path) -> Option<PathBuf> {
    let (mut existing, mut rest) = (p, Vec::new());
    loop {
        if let Ok(real) = existing.canonicalize() { return Some(rest.iter().rev().fold(real, |acc, part| acc.join(part))); }
        rest.push(existing.file_name()?);
        existing = existing.parent()?;
    }
}

/// macOS's per-user temporary folders, and $TMPDIR (`std::env::temp_dir()`) when it lies inside them or in
/// /private/tmp; a $TMPDIR pointed anywhere else (a home, say) is not trusted.
fn temp_roots() -> Vec<PathBuf> {
    let fixed = [PathBuf::from("/private/var/folders"), PathBuf::from("/private/tmp")];
    let mut roots = vec![fixed[0].clone()];
    if let Ok(t) = std::env::temp_dir().canonicalize() {
        if fixed.iter().any(|f| crate::files::is_inside(&t, f)) { roots.push(t); }
    }
    roots
}

/// The check's verdict: (exit code, word). A window that is not on screen proves nothing, so it never passes.
pub fn verdict(centre: f64, visible: bool) -> (i32, &'static str) {
    if !visible { (2, "FAIL (window not visible)") } else if centred(centre) { (0, "PASS") } else { (1, "FAIL") }
}

/// Ends check mode: flushes what was printed (process::exit skips Rust's own flush at exit), then exits.
pub fn finish(code: i32) -> ! {
    use std::io::Write;
    let _ = std::io::stdout().flush();
    let _ = std::io::stderr().flush();
    std::process::exit(code)
}

#[cfg(target_os = "macos")]
pub mod mac {
    use objc2::{MainThreadMarker, MainThreadOnly};
    use objc2_app_kit::{NSBackingStoreType, NSWindow, NSWindowButton, NSWindowStyleMask, NSWindowTitleVisibility};
    use objc2_foundation::{NSPoint, NSRect, NSSize};

    /// (h, b): the close button's height and AppKit's gap below it, read from a hidden throwaway window with the
    /// main window's style (titled, closable, miniaturisable, resizable, full-size content, transparent title bar,
    /// hidden title). The window is deferred, never shown, and closed at once.
    pub fn button_geometry(mtm: MainThreadMarker) -> Option<(f64, f64)> {
        let style = NSWindowStyleMask::Titled | NSWindowStyleMask::Closable | NSWindowStyleMask::Miniaturizable
            | NSWindowStyleMask::Resizable | NSWindowStyleMask::FullSizeContentView;
        let rect = NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(400.0, 300.0));
        // SAFETY: a freshly allocated NSWindow on the main thread, with valid arguments.
        let w = unsafe { NSWindow::initWithContentRect_styleMask_backing_defer(NSWindow::alloc(mtm), rect, style, NSBackingStoreType::Buffered, true) };
        // SAFETY: we hold the only reference (Retained); AppKit must not also release it on close.
        unsafe { w.setReleasedWhenClosed(false) };
        w.setTitlebarAppearsTransparent(true);
        w.setTitleVisibility(NSWindowTitleVisibility::Hidden);
        let f = w.standardWindowButton(NSWindowButton::CloseButton).map(|c| c.frame());
        w.close();
        f.map(|f| (f.size.height, f.origin.y)).filter(|(h, b)| h.is_finite() && b.is_finite() && *h > 0.0)
    }

    pub struct Measured { pub centre: f64, pub left: f64, pub visible: bool }

    /// The real close button's centre (points from the window top) and left edge, on the real window, after
    /// making sure any pending draw (which is where wry re-applies the inset) has run.
    ///
    /// # Safety
    /// `ns_window` must be a live NSWindow pointer, called on the main thread.
    pub unsafe fn close_button(ns_window: *mut std::ffi::c_void) -> Option<Measured> {
        let w: &NSWindow = unsafe { (ns_window as *const NSWindow).as_ref()? };
        w.displayIfNeeded();
        let c = w.standardWindowButton(NSWindowButton::CloseButton)?;
        let r = c.convertRect_toView(c.bounds(), None);   // window coordinates, origin at the window's bottom-left
        Some(Measured { centre: w.frame().size.height - (r.origin.y + r.size.height / 2.0), left: r.origin.x, visible: w.isVisible() })
    }
}

/// Creates the main window (tauri.conf.json has `"create": false` for it) with the centring y computed on this Mac.
/// In check mode the window shows a blank page, so the app's screens never load and no library is ever opened.
pub fn create_main(app: &tauri::App, check: Option<&CheckMode>) -> tauri::Result<(tauri::WebviewWindow, Option<(f64, f64)>, f64)> {
    let mut cfg = app.config().app.windows.iter().find(|w| w.label == "main").cloned()
        .ok_or_else(|| tauri::Error::WindowNotFound)?;
    if check.is_some() { cfg.url = tauri::WebviewUrl::External("about:blank".parse().expect("about:blank is a URL")); }
    #[cfg(target_os = "macos")]
    let (geometry, y) = {
        let geometry = objc2::MainThreadMarker::new().and_then(mac::button_geometry);
        let y = check.and_then(|c| c.force_y).unwrap_or_else(|| geometry.map_or(FALLBACK_Y, |(h, b)| centring_y(TOOLBAR_PT, h, b)));
        if geometry.is_none() { eprintln!("window-chrome: could not read the button geometry; using y = {FALLBACK_Y}"); }
        // Through the config, as the hard-coded value went before: tauri passes it to both tao and wry unchanged.
        cfg.traffic_light_position = Some(tauri::utils::config::LogicalPosition { x: BUTTONS_X, y });
        (geometry, y)
    };
    #[cfg(not(target_os = "macos"))]
    let (geometry, y) = (None, 0.0);
    let win = tauri::WebviewWindowBuilder::from_config(app.handle(), &cfg)?.build()?;
    Ok((win, geometry, y))
}

/// `--check-window-chrome`: after the first draw, read the real close button, print one line, and exit 0 if its
/// centre is on the toolbar centre line (±0.5 pt), 1 if not, 2 if it could not be measured.
#[cfg(target_os = "macos")]
pub fn start_check(win: tauri::WebviewWindow, geometry: Option<(f64, f64)>, y: f64) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1500));   // the window is shown and has drawn
        let w = win.clone();
        let sent = win.run_on_main_thread(move || {
            let m = w.ns_window().ok().and_then(|p| unsafe { mac::close_button(p) });
            let (h, b) = geometry.map_or(("?".into(), "?".into()), |(h, b)| (format!("{h}"), format!("{b}")));
            let os = objc2_foundation::NSProcessInfo::processInfo().operatingSystemVersionString().to_string();
            let code = match &m {
                Some(m) => {
                    let (code, word) = verdict(m.centre, m.visible);
                    println!("window-chrome: {os} h={h} b={b} y={y} toolbar_centre={} measured_centre={:.2} left={:.2} visible={} -> {word}",
                        TOOLBAR_PT / 2.0, m.centre, m.left, m.visible);
                    code
                }
                None => { println!("window-chrome: {os} h={h} b={b} y={y} -> FAIL (could not read the close button)"); 2 }
            };
            finish(code);
        });
        if sent.is_err() { eprintln!("window-chrome: could not reach the main thread"); finish(2); }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn measured_on_macos_26_1_gives_the_hand_tuned_28() { assert_eq!(centring_y(52.0, 14.0, 9.0), 28.0); }
    #[test] fn inferred_pre_tahoe_geometry_gives_24() { assert_eq!(centring_y(52.0, 16.0, 6.0), 24.0); }   // inferred, pre-Tahoe (not measured)
    #[test] fn the_fallback_is_the_26_1_answer() { assert_eq!(FALLBACK_Y, centring_y(TOOLBAR_PT, 14.0, 9.0)); }

    #[test] fn the_check_passes_within_half_a_point_of_the_toolbar_centre_and_fails_beyond() {
        assert!(centred(26.0)); assert!(centred(25.5)); assert!(centred(26.5));
        assert!(!centred(25.4)); assert!(!centred(26.6));
        assert!(!centred(20.0));            // y = 22 on 26.1: the positive control's expected centre
        assert!(!centred(30.0));            // y = 28 on pre-Tahoe geometry: the macOS 15 report
        assert!(!centred(f64::NAN));        // nothing measured is never a pass
    }

    #[test] fn check_mode_only_with_its_flag_and_the_forced_y_only_inside_it() {
        let a = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<Vec<_>>();
        assert_eq!(check_mode(a(&["OpenCephAI"])), None);
        assert_eq!(check_mode(a(&["OpenCephAI", "--check-window-chrome-force-y=22"])), None);   // never moves the buttons in normal use
        assert_eq!(check_mode(a(&["OpenCephAI", "--check-window-chrome"])), Some(CheckMode { force_y: None }));
        assert_eq!(check_mode(a(&["OpenCephAI", "--check-window-chrome", "--check-window-chrome-force-y=22"])), Some(CheckMode { force_y: Some(22.0) }));
        assert_eq!(check_mode(a(&["OpenCephAI", "--check-window-chrome", "--check-window-chrome-force-y=x"])), Some(CheckMode { force_y: None }));
    }

    const LIB: &str = "Library/Application Support/app.cephtrace.desktop";

    #[test] fn the_check_runs_in_a_fresh_temp_home() {
        let t = tempfile::tempdir().unwrap();   // under $TMPDIR, i.e. /var/folders/…/T on macOS
        assert_eq!(refuse_dir(&t.path().join(LIB)), None);   // the app data folder does not exist yet
        std::fs::create_dir_all(t.path().join(LIB)).unwrap();
        assert_eq!(refuse_dir(&t.path().join(LIB)), None);   // and once it does
    }

    #[test] fn the_check_refuses_everything_outside_the_temp_folder() {
        for p in ["/Users/x", "/Users/demo", "/Volumes/y/Users/x", "/opt/home/x", "/"] {
            assert!(refuse_dir(&Path::new(p).join(LIB)).is_some(), "{p} must be refused");
        }
        assert!(refuse_dir(Path::new(LIB)).is_some());                     // relative: HOME unset or odd
        let t = tempfile::tempdir().unwrap();
        // ".." walking out of the temp folder
        assert!(refuse_dir(&t.path().join("../../../../../../../../Users/x").join(LIB)).is_some());
    }

    #[cfg(unix)]
    #[test] fn a_temp_home_that_is_a_link_to_a_real_home_is_refused() {
        // The link points at /Users/Shared (no file in it is read or listed); the path through the link is refused.
        let t = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink("/Users/Shared", t.path().join("home")).unwrap();
        assert!(refuse_dir(&t.path().join("home").join(LIB)).is_some());
    }

    #[test] fn a_window_that_is_not_visible_never_passes() {
        assert_eq!(verdict(26.0, true), (0, "PASS"));
        assert_eq!(verdict(20.0, true), (1, "FAIL"));
        assert_eq!(verdict(f64::NAN, true), (1, "FAIL"));
        assert_eq!(verdict(26.0, false), (2, "FAIL (window not visible)"));
        assert_eq!(verdict(20.0, false), (2, "FAIL (window not visible)"));
    }
}
