//! Owner ruling L9-A (18 Oct): the Library ID invariants, checked after EVERY step of thousands of seeded random
//! sequences of moves (typed and corrected names, clearing, "Same patient", the label read, Delete, Restore, removal for
//! good, Patient IDs, "Not the same", backup and restore). Synthetic films and names only.
//!
//! Reproduce one sequence: `CEPH_L9A_ONLY=<index> cargo test -p ceph-store --test library_id_invariants -- --nocapture`.
//! Longer run: `CEPH_L9A_SEQUENCES=50000`. Every failure names the invariant, the seed, the step and the steps so far.
use ceph_store::{library_ids::TrailLine, CaseMeta, IdentityRead, Library, PatientRef};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// splitmix64: a fixed, seedable generator, so every sequence can be replayed exactly (no new dependency).
struct Rng(u64);
impl Rng {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }
    fn below(&mut self, n: usize) -> usize { (self.next() % n as u64) as usize }
}

const XRAYS: usize = 5;
const STEPS: usize = 24;
const SEED: u64 = 0x4C39_4100;
const NAMES: [&str; 4] = ["Demo A", "Demo B", "Demo C", "Demo D"];
const PIDS: [&str; 2] = ["5566", "ZQ-7781"];

#[derive(Debug, Clone)]
enum Step { Type(usize, String), Clear(usize), Same(usize, String), Label(usize, String), Delete(usize), Restore(usize),
    Purge, PatientId(usize, &'static str), NotSame(usize, i64), Backup, RestoreBackup }

fn random_step(r: &mut Rng, fresh: &mut u32) -> Step {
    let x = r.below(XRAYS);
    let name = |r: &mut Rng, fresh: &mut u32| if r.below(10) < 6 { NAMES[r.below(NAMES.len())].to_string() } else { *fresh += 1; format!("Demo N{fresh}") };
    match r.below(100) {
        0..=29 => Step::Type(x, name(r, fresh)),
        30..=35 => Step::Clear(x),
        36..=57 => Step::Same(x, NAMES[r.below(NAMES.len())].to_string()),
        58..=65 => Step::Label(x, NAMES[r.below(NAMES.len())].to_string()),
        66..=71 => Step::Delete(x),
        72..=77 => Step::Restore(x),
        78..=80 => Step::Purge,
        81..=86 => Step::PatientId(x, PIDS[r.below(PIDS.len())]),
        87..=94 => Step::NotSame(x, 1 + r.below(8) as i64),
        95..=97 => Step::Backup,
        _ => Step::RestoreBackup,
    }
}

type Row = (String, Option<i64>, Option<i64>, String, String);   // patient, number, merged_from, joined_at, how
/// The whole library state the invariants read, straight from the database.
#[derive(Clone, Debug, PartialEq)]
struct Snap {
    xray: BTreeMap<String, (String, Option<i64>, bool)>,             // case -> (patient, its number, in Recently deleted)
    patients: BTreeMap<String, (String, Option<i64>)>,               // patient -> (name, number)
    numbers: BTreeMap<i64, (Option<i64>, Option<String>)>,           // number -> (merged_into, merged_at)
    counter: i64,
    rows: BTreeMap<String, Vec<Row>>,
    answers: BTreeSet<(String, i64, String)>,
}
fn snap(lib: &Library) -> Snap {
    let c = lib.conn_for_tests();
    let q = |sql: &str| c.prepare(sql).unwrap();
    let xray = q("SELECT c.id, c.patient_id, p.library_no, c.deleted_at IS NOT NULL FROM cases c JOIN patients p ON p.id = c.patient_id")
        .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?)))).unwrap().map(Result::unwrap).collect();
    let patients = q("SELECT id, display_name, library_no FROM patients")
        .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?)))).unwrap().map(Result::unwrap).collect();
    let numbers = q("SELECT n, merged_into, merged_at FROM library_numbers")
        .query_map([], |r| Ok((r.get::<_, i64>(0)?, (r.get(1)?, r.get(2)?)))).unwrap().map(Result::unwrap).collect();
    let counter = c.query_row("SELECT COALESCE((SELECT seq FROM sqlite_sequence WHERE name = 'library_numbers'), 0)", [], |r| r.get(0)).unwrap();
    let mut rows: BTreeMap<String, Vec<Row>> = BTreeMap::new();
    for (case, row) in q("SELECT case_id, patient_id, library_no, merged_from, joined_at, how FROM xray_joins ORDER BY joined_at, id")
        .query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get(5)?)))).unwrap().map(Result::unwrap) {
        rows.entry(case).or_default().push(row);
    }
    let answers = q("SELECT case_id, library_no, answered_at FROM id_link_answers")
        .query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().map(Result::unwrap).collect();
    Snap { xray, patients, numbers, counter, rows, answers }
}
impl Snap {
    fn held(&self) -> BTreeSet<i64> { self.patients.values().filter_map(|p| p.1).collect() }
    fn retired(&self) -> BTreeSet<i64> { self.numbers.iter().filter(|(_, v)| v.0.is_some()).map(|(k, _)| *k).collect() }
    /// The number `n` leads to now, following merges (None: its patient is no longer in the library).
    fn lead(&self, mut n: i64) -> Option<i64> {
        for _ in 0..10_000 { match self.numbers.get(&n)?.0 { Some(m) => n = m, None => return self.held().contains(&n).then_some(n) } }
        panic!("merge chain does not end")
    }
    fn on(&self, pid: &str) -> Vec<&String> { self.xray.iter().filter(|(_, v)| v.0 == pid).map(|(k, _)| k).collect() }
}

/// What the random walk reached: every count must be above zero, or the run is blind and fails.
#[derive(Default, Debug)]
struct Seen { sequences: usize, steps: usize, refused: usize, separations: usize, merges: usize,
    reinstate_shapes: usize, carried_shapes: usize, purges: usize, restores: usize, not_same_checks: usize, numbers_checked: usize,
    trail_merged: usize, trail_left: usize }

struct Fail(String);
macro_rules! ensure { ($c:expr, $($t:tt)*) => { if !$c { return Err(Fail(format!($($t)*))); } } }

/// Invariants that hold in every state.
fn state(lib: &Library, s: &Snap, seen: &mut Seen) -> Result<(), Fail> {
    // ONE: every named patient holds exactly one number; no number is held twice; no held number is retired.
    let mut held = BTreeSet::new();
    for (pid, (name, n)) in &s.patients {
        ensure!(name.trim().is_empty() || n.is_some(), "ONE: named patient {pid} ({name}) holds no number");
        if let Some(n) = n {
            ensure!(held.insert(*n), "ONE: L{n} is held by two patients");
            ensure!(s.numbers.get(n).is_some_and(|v| v.0.is_none()), "ONE: L{n} is held but retired or never issued");
        }
    }
    // RETIRED: a number is only ever merged into an OLDER (lower) one (owner L3).
    for (n, (into, at)) in &s.numbers {
        if let Some(m) = into { ensure!(m < n && at.is_some(), "RETIRED: L{n} merged into L{m}, not an older number"); }
    }
    // RESOLVES: every number ever issued is found, and leads to the patient holding where its chain ends, or nowhere.
    for &n in s.numbers.keys() {
        seen.numbers_checked += 1;
        let f = lib.find_library_id(&format!("L-{n:05}")).map_err(|e| Fail(format!("RESOLVES: L{n}: {e}")))?
            .ok_or_else(|| Fail(format!("RESOLVES: L{n} was issued but is not found")))?;
        let want = s.lead(n);
        ensure!(f.current == want.map(|m| format!("L-{m:05}")), "RESOLVES: L{n} -> {:?}, expected {want:?}", f.current);
        ensure!(f.merged == want.is_some_and(|m| m != n), "RESOLVES: L{n} merged flag {}", f.merged);
        let name = want.and_then(|m| s.patients.values().find(|p| p.1 == Some(m)).map(|p| p.0.clone()));
        ensure!(f.patient.map(|p| p.name) == name, "RESOLVES: L{n} names the wrong patient");
    }
    // RECORD: every X-ray's last join row is its patient and number now.
    for (case, (pid, n, _)) in &s.xray {
        let last = s.rows.get(case).and_then(|r| r.last()).ok_or_else(|| Fail(format!("RECORD: X-ray {case} has no join row")))?;
        ensure!((&last.0, last.1) == (pid, *n), "RECORD: X-ray {case}'s last row {last:?} is not its state ({pid}, {n:?})");
    }
    // NOT-SAME: no live X-ray is ever offered a patient its own "Not the same" answers lead to.
    for (case, n, _) in &s.answers {
        if s.xray.get(case).is_none_or(|x| x.2) { continue; }
        let Some(m) = s.lead(*n) else { continue };
        seen.not_same_checks += 1;
        let offered = lib.load(case).unwrap().id_matches.into_iter().any(|o| o.library_id == format!("L-{m:05}"));
        ensure!(!offered, "NOT-SAME: X-ray {case} answered Not the same to L{n} but is offered L{m}, where L{n} leads");
    }
    // TRAIL: on each patient's view, every number that leads to its number is listed once as merged (with the number
    // it was merged into), and every live X-ray now elsewhere that was under one of those numbers once as having left.
    let day = |t: &str| -> String { lib.conn_for_tests().query_row("SELECT date(?1, 'localtime')", [t], |r| r.get(0)).unwrap() };
    let text = |n: i64| format!("L-{n:05}");
    for (pid, (_, m)) in &s.patients {
        let Some(m) = *m else { continue };
        let Some(x) = s.xray.iter().find(|(_, v)| &v.0 == pid).map(|(k, _)| k) else { continue };
        let ours: BTreeSet<i64> = s.numbers.keys().copied().filter(|&n| s.lead(n) == Some(m)).collect();
        let mut want: Vec<String> = Vec::new();
        for &n in ours.iter().filter(|&&n| n != m) {
            let (into, at) = &s.numbers[&n];
            want.push(format!("{:?}", TrailLine::Merged { number: text(n), into: text(into.unwrap()), on: day(at.as_deref().unwrap()) }));
            seen.trail_merged += 1;
        }
        for (case, (p, now, deleted)) in &s.xray {
            if p == pid || *deleted { continue; }
            let rows = &s.rows[case];
            let Some(i) = rows.iter().rposition(|r| r.1.is_some_and(|k| ours.contains(&k))) else { continue };
            want.push(format!("{:?}", TrailLine::Left { number: text(rows[i].1.unwrap()), on: day(&rows[i + 1].3), now: now.map(text), name: s.patients[p].0.clone() }));
            seen.trail_left += 1;
        }
        let mut got: Vec<String> = lib.load(x).unwrap().library_trail.iter().map(|l| format!("{l:?}")).collect();
        want.sort(); got.sort();
        ensure!(got == want, "TRAIL: patient {pid} (L{m}) shows {got:?}, expected {want:?}");
    }
    Ok(())
}

/// Invariants about one step: `b` before, `a` after, `mover` the X-ray the step moved (if it moved one).
fn step(b: &Snap, a: &Snap, mover: Option<&str>, seen: &mut Seen) -> Result<(), Fail> {
    // ISSUED-ONCE: no number is forgotten, the counter never goes down, a new number is above every earlier one.
    for n in b.numbers.keys() { ensure!(a.numbers.contains_key(n), "ISSUED-ONCE: L{n} disappeared"); }
    ensure!(a.counter >= b.counter, "ISSUED-ONCE: the counter went down {} -> {}", b.counter, a.counter);
    let fresh: BTreeSet<i64> = a.numbers.keys().filter(|n| !b.numbers.contains_key(n)).copied().collect();
    for n in &fresh { ensure!(*n > b.counter, "ISSUED-ONCE: L{n} issued at or below the counter {}", b.counter); }
    // NO-GIVE-BACK: a number not held just before a step is never held after it, unless issued in that step.
    for n in a.held() { ensure!(b.held().contains(&n) || fresh.contains(&n), "NO-GIVE-BACK: L{n} was not held before this step and is held after it"); }
    // RETIRED-FOREVER: a retired number stays retired, pointing where it pointed, from the moment it was retired.
    let mut retired_now = BTreeSet::new();
    for (n, v) in &a.numbers {
        match b.numbers.get(n) {
            Some(old) if old.0.is_some() => ensure!(old == v, "RETIRED-FOREVER: L{n} changed {old:?} -> {v:?}"),
            _ if v.0.is_some() => { retired_now.insert(*n); }
            _ => {}
        }
    }
    if !retired_now.is_empty() { seen.merges += 1; }
    // KEPT (task 17 review I1): a held number stops being held only when this step retired it or every X-ray showing
    // it is gone (removed for good). So a number is never lost or orphaned while its patient is still in the library.
    for n in b.held().difference(&a.held()) {
        let gone = b.xray.iter().filter(|(_, x)| x.1 == Some(*n)).all(|(c, _)| !a.xray.contains_key(c));
        ensure!(retired_now.contains(n) || gone, "KEPT: L{n} was held, is no longer, and was neither retired nor removed with its X-rays");
    }
    // ANSWERS: a "Not the same" answer is never rewritten; only a new one appears, and only a purged X-ray's go.
    for ans in &b.answers { ensure!(a.answers.contains(ans) || !a.xray.contains_key(&ans.0), "ANSWERS: {ans:?} was rewritten or dropped"); }
    // RECORD: rows are only ever added, one for each X-ray whose patient or number changed; a non-mover's row is a
    // "merge" row written by a step that retired a number.
    for (case, now) in &a.xray {
        let (old_rows, new_rows) = (b.rows.get(case).cloned().unwrap_or_default(), a.rows.get(case).cloned().unwrap_or_default());
        ensure!(new_rows.starts_with(&old_rows), "RECORD: X-ray {case}'s earlier rows changed");
        let changed = b.xray.get(case).is_none_or(|o| (&o.0, o.1) != (&now.0, now.1));
        ensure!(new_rows.len() - old_rows.len() == usize::from(changed), "RECORD: X-ray {case} gained {} rows (changed: {changed})", new_rows.len() - old_rows.len());
        if changed && Some(case.as_str()) != mover {
            let r = new_rows.last().unwrap();
            ensure!(r.4 == "merge" && a.numbers.values().any(|v| v.1.as_deref() == Some(r.3.as_str())), "RECORD: X-ray {case} got a {:?} row outside a merge", r.4);
        }
    }
    // ONLY-THE-MOVED: only the moved X-ray changes number, and X-rays on its destination when the step retired the
    // destination's number (they then show the moved X-ray's previous number, the older: L3).
    for (case, now) in &a.xray {
        let Some(old) = b.xray.get(case) else { continue };
        if Some(case.as_str()) == mover || old.1 == now.1 { continue; }
        let mv = mover.and_then(|m| b.xray.get(m).map(|x| x.1)).flatten();
        let ok = old.1.is_some_and(|n| retired_now.contains(&n)) && now.1 == mv && mover.is_some_and(|m| a.xray.get(m).is_some_and(|x| x.0 == now.0));
        ensure!(ok, "ONLY-THE-MOVED: X-ray {case} went from {:?} to {:?}", old.1, now.1);
    }
    // SPLIT-IS-NEW: an X-ray that leaves a patient keeping other X-rays, for a patient that had no number, gets a
    // number issued in this step (or none, while unnamed); the patient it left keeps its number.
    if let Some(m) = mover {
        let ((p0, n0, _), (p1, n1, _)) = (b.xray[m].clone(), a.xray[m].clone());
        let p1_before = b.patients.get(&p1).and_then(|p| p.1);
        if p0 != p1 && b.on(&p0).len() > 1 && p1_before.is_none() {
            seen.separations += 1;
            let named = !a.patients[&p1].0.trim().is_empty();
            ensure!(if named { n1.is_some_and(|n| fresh.contains(&n)) } else { n1.is_none() },
                "SPLIT-IS-NEW: X-ray {m} left {p0} (L{n0:?}) and shows {n1:?}, not a new number");
            ensure!(a.patients.get(&p0).map(|p| p.1) == Some(n0), "SPLIT-IS-NEW: the patient {m} left changed number");
            // The shapes the withdrawn give-back acted on, so a blind walk cannot pass (counts asserted at the end).
            let rows = &b.rows[m];
            if rows.iter().any(|r| r.1.is_some_and(|k| Some(k) != n0 && b.retired().contains(&k) && b.lead(k) == n0)) { seen.reinstate_shapes += 1; }
            let stay = rows.iter().rposition(|r| r.0 != p0);
            if stay.is_some_and(|i| rows[i].1 == n0) { seen.carried_shapes += 1; }
        }
    }
    Ok(())
}

fn synthetic_png(dir: &Path, name: &str, seed: u8) -> PathBuf {
    let img = image::GrayImage::from_fn(400, 300, |x, y| image::Luma([((x + y) as u8).wrapping_add(seed)]));
    let p = dir.join(name); img.save(&p).unwrap(); p
}
fn copy_dir(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for e in std::fs::read_dir(from).unwrap() {
        let e = e.unwrap();
        if e.file_type().unwrap().is_dir() { copy_dir(&e.path(), &to.join(e.file_name())); } else { std::fs::copy(e.path(), to.join(e.file_name())).unwrap(); }
    }
}
fn meta(name: &str) -> CaseMeta { CaseMeta { patient_name: name.into(), timepoint: "T1".into(), taken_on: None, date_of_birth: None, scan_id: None } }

/// Runs one sequence from the template library; Err names the invariant and the step.
fn run(template: &Path, ids: &[String], seed: u64, seen: &mut Seen) -> Result<(), String> {
    let (t, out) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    copy_dir(template, t.path());
    let mut lib = Some(Library::open(t.path()).unwrap());
    let (mut r, mut fresh, mut steps, mut backup) = (Rng(seed), 0u32, Vec::new(), None::<(PathBuf, Snap)>);
    let mut b = snap(lib.as_ref().unwrap());
    for i in 0..STEPS {
        let s = random_step(&mut r, &mut fresh);
        steps.push(s.clone());
        let l = lib.as_mut().unwrap();
        let mut mover = None;
        let done = match &s {
            Step::Type(x, n) => { mover = Some(&ids[*x]); l.set_meta(&ids[*x], &meta(n)).is_ok() }
            Step::Clear(x) => { mover = Some(&ids[*x]); l.set_meta(&ids[*x], &meta("")).is_ok() }
            Step::Same(x, n) => { mover = Some(&ids[*x]); l.confirm_identity(&ids[*x], Some(&PatientRef { name: n.clone(), date_of_birth: None })).is_ok() }
            Step::Label(x, n) => { mover = Some(&ids[*x]); l.apply_label(&ids[*x], &IdentityRead { name: Some(n.clone()), ..Default::default() }).is_ok() }
            Step::Delete(x) => l.delete(&ids[*x]).is_ok(),
            Step::Restore(x) => l.restore(&ids[*x]).is_ok(),
            Step::Purge => { let n = l.purge_deleted(0).unwrap(); if n > 0 { seen.purges += 1; } true }
            Step::PatientId(x, p) => l.set_patient_id(&ids[*x], Some(p)).is_ok(),
            Step::NotSame(x, n) => l.not_same_patient(&ids[*x], &format!("L-{n:05}")).is_ok(),
            Step::Backup => { let d = out.path().join(format!("b{i}")); std::fs::create_dir(&d).unwrap(); backup = Some((l.backup(&d).unwrap(), b.clone())); true }
            Step::RestoreBackup => match &backup {
                Some((path, at)) => {
                    drop(lib.take());
                    lib = Some(Library::restore_backup(t.path(), path).unwrap());
                    seen.restores += 1;
                    let a = snap(lib.as_ref().unwrap());
                    // A restore is not a move: the library is as it was at the backup, but no number is forgotten and
                    // the counter is carried, so a number issued after the backup is never issued again.
                    let fail = |m: String| format!("seed {seed:#x} step {i} {s:?}: {m}\nsteps: {steps:?}");
                    if a.counter < b.counter || b.numbers.keys().any(|n| !a.numbers.contains_key(n)) { return Err(fail("ISSUED-ONCE: the restore forgot a number".into())); }
                    if (&a.xray, &a.patients, &a.rows) != (&at.xray, &at.patients, &at.rows) { return Err(fail("RESTORE: not the library as it was at the backup".into())); }
                    state(lib.as_ref().unwrap(), &a, seen).map_err(|Fail(m)| fail(m))?;
                    b = a;
                    continue;
                }
                None => true,
            },
        };
        seen.steps += 1;
        let l = lib.as_ref().unwrap();
        let a = snap(l);
        let fail = |m: String| format!("seed {seed:#x} step {i} {s:?}: {m}\nsteps: {steps:?}");
        if !done {
            seen.refused += 1;
            if a != b { return Err(fail("REFUSED: a refused step changed the library".into())); }
        }
        let moved = mover.filter(|m| b.xray.get(*m).is_some_and(|x| !x.2)).map(String::as_str);
        step(&b, &a, if done { moved } else { None }, seen).map_err(|Fail(m)| fail(m))?;
        state(l, &a, seen).map_err(|Fail(m)| fail(m))?;
        b = a;
    }
    Ok(())
}

#[test] fn the_library_id_invariants_hold_after_every_step_of_random_sequences() {
    let env = |k: &str| std::env::var(k).ok().and_then(|v| v.parse::<u64>().ok());
    let (template, src) = (tempfile::tempdir().unwrap(), tempfile::tempdir().unwrap());
    let ids: Vec<String> = {
        let mut lib = Library::open(template.path()).unwrap();
        (0..XRAYS).map(|i| lib.import(&synthetic_png(src.path(), &format!("synthetic-{i}.png"), (i as u8).wrapping_mul(9))).unwrap().case_id).collect()
    };
    let seqs: Vec<u64> = match env("CEPH_L9A_ONLY") { Some(i) => vec![i], None => (0..env("CEPH_L9A_SEQUENCES").unwrap_or(2000)).collect() };
    let mut seen = Seen::default();
    for i in &seqs {
        seen.sequences += 1;
        if let Err(e) = run(template.path(), &ids, SEED + i, &mut seen) { panic!("sequence {i}: {e}\nseen so far: {seen:?}"); }
    }
    println!("{seen:?}");
    if seqs.len() > 1 {
        for (what, n) in [("separations", seen.separations), ("merges", seen.merges), ("reinstate shapes", seen.reinstate_shapes),
            ("carried shapes", seen.carried_shapes), ("purges", seen.purges), ("backup restores", seen.restores),
            ("Not the same checks", seen.not_same_checks), ("refused steps", seen.refused),
            ("trail merged lines", seen.trail_merged), ("trail left lines", seen.trail_left)] {
            assert!(n > 0, "the walk never reached any {what}: it cannot have tested them ({seen:?})");
        }
    }
}
