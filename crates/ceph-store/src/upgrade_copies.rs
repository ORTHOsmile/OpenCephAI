//! AUTOBACKUP-1 housekeeping (owner ruling a, 2 Nov 2026): keep the latest 3 safety copies plus anything from the last
//! 30 days. Only folders this app named, directly in `<library>/upgrade-backups/`, are ever touched.

use rusqlite::Connection;
use std::{fs, path::{Path, PathBuf}};

pub(crate) const COPY_PREFIX: &str = "OpenCephAI backup before upgrade ";
/// (year, month, day, hour, minute, second), local time, as in a copy's folder name.
pub(crate) type Stamp = (i32, u32, u32, u32, u32, u32);
const KEEP_NEWEST: usize = 3;
const KEEP_DAYS: i64 = 30;
/// A copy being removed is first renamed to `<name>.removing` (Windows-safe); one left behind is finished next time.
const REMOVING: &str = ".removing";

/// What a safety copy's folder name says: `OpenCephAI backup before upgrade {from}→{to} {YYYY-MM-DD HH-MM-SS}`, with an
/// optional ` ({n})` (n ≥ 2) when two copies were made in the same second; `n` is 1 without it. Made by
/// `library::copy_before_upgrade`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct CopyName { pub from: i64, pub to: i64, pub stamp: Stamp, pub n: u32 }

/// The parts of a folder name this app gives a finished safety copy, or None for any other name (including the same
/// name ending `.incomplete` or `.removing`, and a date that is not on the calendar).
pub(crate) fn parse_copy_name(name: &str) -> Option<CopyName> {
    let rest = name.strip_prefix(COPY_PREFIX)?;
    let (versions, rest) = rest.split_once(' ')?;
    let (from, to) = versions.split_once('→')?;
    let (from, to) = (from.parse::<i64>().ok()?, to.parse::<i64>().ok()?);
    if rest.len() < 19 || !rest.is_char_boundary(19) { return None; }
    let (s, tail) = rest.split_at(19);
    let n = match tail { "" => 1, t => t.strip_prefix(" (")?.strip_suffix(')')?.parse::<u32>().ok().filter(|n| *n >= 2)? };
    let b = s.as_bytes();
    if !(b[4] == b'-' && b[7] == b'-' && b[10] == b' ' && b[13] == b'-' && b[16] == b'-') { return None; }
    let num = |r: std::ops::Range<usize>| s.get(r).filter(|x| x.bytes().all(|c| c.is_ascii_digit()))?.parse::<u32>().ok();
    let stamp = (num(0..4)? as i32, num(5..7)?, num(8..10)?, num(11..13)?, num(14..16)?, num(17..19)?);
    let (y, mo, d, h, mi, se) = stamp;
    if !(1..=12).contains(&mo) || d < 1 || d > days_in_month(y, mo) || h > 23 || mi > 59 || se > 59 { return None; }
    Some(CopyName { from, to, stamp, n })
}

fn days_in_month(y: i32, m: u32) -> u32 {
    match m {
        2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Seconds since 1970-01-01 for a civil date-time with no time zone (both sides of every comparison use the same local
/// clock, so the zone cancels). Howard Hinnant's days_from_civil.
fn seconds(s: Stamp) -> i64 {
    let (y, m, d, h, mi, se) = s;
    let y = if m <= 2 { y as i64 - 1 } else { y as i64 };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m as i64 + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    (era * 146_097 + doe - 719_468) * 86_400 + h as i64 * 3600 + mi as i64 * 60 + se as i64
}

/// The rule (owner ruling a): newest first by (stamp, n), the 3 newest are kept; `just_made` is always kept; any other
/// copy goes only if its stamp is MORE than 30 whole days before `now` (exactly 30 days, or a future date, is kept).
/// Returns the copies to remove, newest first.
pub(crate) fn to_remove(copies: &[(PathBuf, CopyName)], just_made: &Path, now: Stamp) -> Vec<PathBuf> {
    let mut order: Vec<&(PathBuf, CopyName)> = copies.iter().collect();
    order.sort_by(|a, b| (b.1.stamp, b.1.n).cmp(&(a.1.stamp, a.1.n)));
    order.into_iter().skip(KEEP_NEWEST)
        .filter(|(p, _)| p.as_path() != just_made)
        .filter(|(_, c)| seconds(now) - seconds(c.stamp) > KEEP_DAYS * 86_400)
        .map(|(p, _)| p.clone()).collect()
}

/// The safety copies directly in `dir` (normally `<library>/upgrade-backups/`): real folders only — not symlinks, not
/// files, not `.incomplete` or `.removing` folders — whose names parse as an app copy name. Nothing else is listed.
/// An unreadable or missing `dir` lists nothing.
pub(crate) fn copies_in(dir: &Path) -> Vec<(PathBuf, CopyName)> {
    let Ok(rd) = fs::read_dir(dir) else { return vec![] };
    rd.flatten().filter_map(|e| {
        let ft = e.file_type().ok()?;                       // file_type does not follow symlinks
        if !ft.is_dir() { return None; }
        let c = parse_copy_name(&e.file_name().to_string_lossy())?;
        Some((e.path(), c))
    }).collect()
}

/// Rename aside in the same folder, then delete (Windows-safe). A failed rename leaves the copy as it was (false); a
/// failed delete leaves `<name>.removing` for the next `prune` to finish (true: the copy is no longer under its name).
fn remove_aside(p: &Path) -> bool {
    let aside = PathBuf::from(format!("{}{REMOVING}", p.display()));
    if let Err(e) = fs::rename(p, &aside) { eprintln!("safety copy {} not removed (rename): {e}", p.display()); return false; }
    match fs::remove_dir_all(&aside) {
        Ok(()) => true,
        Err(e) => { eprintln!("safety copy {} not fully removed; {} will be finished later: {e}", p.display(), aside.display()); true }
    }
}

/// Owner ruling a: in `<root>/upgrade-backups/`, removes the safety copies `to_remove` names (and finishes any earlier
/// removal left as `<app copy name>.removing`). Call only after an upgrade succeeded, with `just_made` the copy that
/// open made and checked. Never fails: every problem goes to the log. Returns the copies it took away.
pub(crate) fn prune(root: &Path, just_made: &Path, now: Stamp) -> Vec<PathBuf> {
    let dir = root.join(crate::library::UPGRADE_BACKUPS_DIR);
    // Finish any earlier removal left part-way (only names this app made).
    if let Ok(rd) = fs::read_dir(&dir) {
        for e in rd.flatten() {
            let n = e.file_name().to_string_lossy().into_owned();
            let is_dir = e.file_type().is_ok_and(|t| t.is_dir());
            if is_dir && n.strip_suffix(REMOVING).is_some_and(|b| parse_copy_name(b).is_some()) {
                if let Err(err) = fs::remove_dir_all(e.path()) { eprintln!("could not finish removing {n}: {err}"); }
            }
        }
    }
    let all = copies_in(&dir);
    to_remove(&all, just_made, now).into_iter().filter(|p| remove_aside(p)).collect()
}

/// Now, by the clock that names the copies (`library::stamp`: SQLite's `'now','localtime'`).
pub(crate) fn now_stamp(conn: &Connection) -> anyhow::Result<Stamp> {
    let s: String = conn.query_row("SELECT strftime('%Y-%m-%d %H-%M-%S', 'now', 'localtime')", [], |r| r.get(0))?;
    parse_copy_name(&format!("{COPY_PREFIX}0→0 {s}")).map(|c| c.stamp).ok_or_else(|| anyhow::anyhow!("bad clock {s}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn name(from: i64, to: i64, s: &str, n: u32) -> String {
        let base = format!("{COPY_PREFIX}{from}→{to} {s}");
        if n >= 2 { format!("{base} ({n})") } else { base }
    }
    fn c(s: &str) -> (PathBuf, CopyName) {
        let nm = name(17, 18, s, 1);
        (PathBuf::from(format!("/lib/upgrade-backups/{nm}")), parse_copy_name(&nm).unwrap())
    }
    const NOW: Stamp = (2026, 11, 2, 12, 0, 0);

    #[test] fn parses_the_names_the_app_makes_and_nothing_else() {
        assert_eq!(parse_copy_name(&name(8, 9, "2026-10-13 10-00-00", 1)),
            Some(CopyName { from: 8, to: 9, stamp: (2026, 10, 13, 10, 0, 0), n: 1 }));
        assert_eq!(parse_copy_name(&name(8, 9, "2026-10-13 10-00-00", 3)).map(|c| c.n), Some(3));
        for bad in ["notes.txt", "OpenCephAI backup before upgrade 8→9", "OpenCephAI backup before upgrade 8→9 2026-10-13",
            "OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00.incomplete",
            "OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00.removing",
            "OpenCephAI backup before upgrade x→9 2026-10-13 10-00-00", "OpenCephAI backup before upgrade 8→9 2026-13-40 10-00-00",
            "My OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00", "OpenCephAI backup before upgrade 8→9 2026-10-13 10-00-00 (x)"] {
            assert_eq!(parse_copy_name(bad), None, "{bad}");
        }
    }
    #[test] fn keeps_the_3_newest_and_the_last_30_days_and_removes_only_what_is_both_old_and_not_newest() {
        let all = vec![c("2026-11-02 11-00-00"), c("2026-09-01 10-00-00"), c("2026-08-01 10-00-00"),
            c("2026-07-01 10-00-00"), c("2026-06-01 10-00-00")];
        let gone = to_remove(&all, &all[0].0, NOW);
        assert_eq!(gone, vec![all[3].0.clone(), all[4].0.clone()]);
    }
    #[test] fn exactly_3_copies_all_old_none_removed() {
        let all = vec![c("2026-11-02 11-00-00"), c("2025-01-01 10-00-00"), c("2024-01-01 10-00-00")];
        assert!(to_remove(&all, &all[0].0, NOW).is_empty());
    }
    #[test] fn thirty_days_exactly_is_kept_and_thirty_days_and_one_second_is_not() {
        let all = vec![c("2026-11-02 11-00-00"), c("2026-11-01 10-00-00"), c("2026-10-31 10-00-00"),
            c("2026-10-03 12-00-00"), c("2026-10-03 11-59-59")];
        assert_eq!(to_remove(&all, &all[0].0, NOW), vec![all[4].0.clone()]);
    }
    #[test] fn a_copy_dated_in_the_future_is_kept() {
        let all = vec![c("2026-11-02 11-00-00"), c("2026-11-01 10-00-00"), c("2026-10-31 10-00-00"), c("2027-05-01 10-00-00"), c("2026-01-01 10-00-00")];
        let gone = to_remove(&all, &all[0].0, NOW);
        assert_eq!(gone, vec![all[4].0.clone()], "the future one is among the 3 newest, and is never 'older than 30 days'");
    }
    #[test] fn the_copy_just_made_is_kept_even_when_a_clock_set_back_makes_it_look_oldest() {
        let mut all = vec![c("2026-11-02 11-00-00"), c("2026-11-01 10-00-00"), c("2026-10-31 10-00-00"), c("2026-10-30 10-00-00")];
        all.push(c("2020-01-01 10-00-00"));            // made now, by a clock set back to 2020
        let just = all[4].0.clone();
        let gone = to_remove(&all, &just, (2020, 1, 1, 10, 0, 1));
        assert!(gone.is_empty(), "nothing is older than 30 days by the set-back clock, and the new copy is kept: {gone:?}");
    }
    // Positive-control gap (planted rule 4, "drop the just_made filter", passed every test above): the new copy is
    // kept even when it is outside the 3 newest AND more than 30 days old by `now` (e.g. three copies dated ahead by a
    // clock that once ran fast, or Task 2's re-checked copy from an earlier failed upgrade).
    #[test] fn the_copy_just_made_is_kept_even_when_it_is_old_and_not_among_the_3_newest() {
        let all = vec![c("2027-03-01 10-00-00"), c("2027-02-01 10-00-00"), c("2027-01-01 10-00-00"), c("2026-01-01 10-00-00"), c("2025-12-01 10-00-00")];
        let just = all[3].0.clone();
        assert_eq!(to_remove(&all, &just, NOW), vec![all[4].0.clone()], "only the other old one goes");
    }
    #[test] fn a_clock_jumped_forward_a_year_keeps_only_the_3_newest_and_the_new_copy() {
        let all = vec![c("2027-11-02 11-00-00"), c("2026-11-01 10-00-00"), c("2026-10-31 10-00-00"), c("2026-10-30 10-00-00"), c("2026-10-29 10-00-00")];
        assert_eq!(to_remove(&all, &all[0].0, (2027, 11, 2, 12, 0, 0)), vec![all[3].0.clone(), all[4].0.clone()]);
    }
    #[test] fn copies_with_the_same_stamp_are_ordered_by_their_number() {
        let nm = |n| { let s = name(17, 18, "2026-01-01 10-00-00", n); (PathBuf::from(&s), parse_copy_name(&s).unwrap()) };
        let all = vec![nm(1), nm(2), nm(3), nm(4)];
        assert_eq!(to_remove(&all, &all[3].0, NOW), vec![all[0].0.clone()], "(4), (3), (2) are the 3 newest");
    }
    #[test] fn a_date_not_on_the_calendar_is_not_a_copy_name() {
        for bad in ["2026-02-30 10-00-00", "2025-02-29 10-00-00", "2026-04-31 10-00-00", "2026-11-00 10-00-00", "2026-11-02 24-00-00"] {
            assert_eq!(parse_copy_name(&name(17, 18, bad, 1)), None, "{bad}");
        }
        assert!(parse_copy_name(&name(17, 18, "2024-02-29 10-00-00", 1)).is_some(), "a leap day is a real date");
    }
    #[test] fn nothing_to_judge_removes_nothing() { assert!(to_remove(&[], Path::new("/x"), NOW).is_empty()); }

    fn mk(root: &Path, s: &str) -> PathBuf {
        let p = root.join("upgrade-backups").join(name(17, 18, s, 1));
        fs::create_dir_all(p.join("images")).unwrap(); fs::write(p.join("library.sqlite3"), b"SYNTHETIC").unwrap(); p
    }
    #[cfg(unix)]
    #[test] fn prune_touches_only_app_copies_in_upgrade_backups() {
        let t = tempfile::tempdir().unwrap(); let r = t.path();
        let keep = mk(r, "2026-11-02 11-00-00");
        for s in ["2026-11-01 10-00-00", "2026-10-31 10-00-00"] { mk(r, s); }
        let old = mk(r, "2025-01-01 10-00-00");
        let ub = r.join("upgrade-backups");
        fs::write(ub.join("notes.txt"), b"mine").unwrap();
        fs::create_dir(ub.join("My own folder")).unwrap();
        fs::create_dir(ub.join(format!("My own folder{REMOVING}"))).unwrap();
        fs::create_dir(ub.join(format!("{} 2020-01-01 10-00-00.incomplete", format!("{COPY_PREFIX}17→18")))).unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::os::unix::fs::symlink(outside.path(), ub.join(name(17, 18, "2019-01-01 10-00-00", 1))).unwrap();
        fs::write(outside.path().join("keep-me"), b"x").unwrap();
        let gone = prune(r, &keep, NOW);
        assert_eq!(gone, vec![old.clone()]);
        assert!(!old.exists() && !PathBuf::from(format!("{}{REMOVING}", old.display())).exists());
        let mut left: Vec<String> = fs::read_dir(&ub).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        left.sort();
        println!("prune removed {gone:?}; left in upgrade-backups: {left:#?}");
        assert_eq!(left.len(), 8, "3 kept copies, the file, the folder, its .removing namesake, the .incomplete, the symlink: {left:?}");
        assert!(outside.path().join("keep-me").exists(), "a symlink's target is never followed");
    }
    #[test] fn prune_with_no_folder_or_an_empty_folder_does_nothing() {
        let t = tempfile::tempdir().unwrap();
        let none = prune(t.path(), Path::new("/none"), NOW);
        println!("no upgrade-backups folder: removed {none:?}");
        assert!(none.is_empty());
        fs::create_dir(t.path().join("upgrade-backups")).unwrap();
        let empty = prune(t.path(), Path::new("/none"), NOW);
        println!("empty upgrade-backups folder: removed {empty:?}");
        assert!(empty.is_empty());
    }
    #[cfg(unix)]
    #[test] fn a_copy_that_cannot_be_deleted_is_left_renamed_and_finished_next_time() {
        use std::os::unix::fs::PermissionsExt;
        let t = tempfile::tempdir().unwrap(); let r = t.path();
        let keep = mk(r, "2026-11-02 11-00-00");
        for s in ["2026-11-01 10-00-00", "2026-10-31 10-00-00"] { mk(r, s); }
        let old = mk(r, "2025-01-01 10-00-00");
        fs::write(old.join("images/a.png"), b"x").unwrap();
        fs::set_permissions(old.join("images"), fs::Permissions::from_mode(0o500)).unwrap();   // its file can't be deleted
        let first = prune(r, &keep, NOW);
        let removing = PathBuf::from(format!("{}{REMOVING}", old.display()));
        println!("locked: removed {first:?}; .removing left = {}", removing.exists());
        assert!(removing.exists() && !old.exists(), "renamed aside, delete failed, left for later");
        fs::set_permissions(removing.join("images"), fs::Permissions::from_mode(0o755)).ok();
        let second = prune(r, &keep, NOW);
        println!("unlocked: second prune removed {second:?}; .removing left = {}", removing.exists());
        assert!(!removing.exists() && !old.exists(), "the next prune finished it");
    }
}
