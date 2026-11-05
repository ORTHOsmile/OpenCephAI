//! Stage A′, the point check (spec §14.3, §14.5,
//! §14.13): `point-check/2`, flag-only. Construct: given where the other points of this run sit, is this point far
//! outside where correctly traced points sit on faces like this one? A yes / no at a pinned line, with the distance. Not
//! the chance that the point is wrong, and not a literal chance (FT-2's D6 tripped). Nothing here moves a point.

use crate::scores::ORIGINAL_19;
use crate::shape::{fit_conditional, Conditional, Pt, Ring};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

pub const RULE_VERSION: &str = "point-check/2";
/// The flag line on the corrected tail (owner P1; FT-2b's `flagLine`). Never shown as "1 in 5,000" (D6 tripped).
pub const FLAG_LINE: f64 = 0.0002;
pub const ROUNDS: usize = 3;
pub const MIN_POINTS: usize = 12;
pub const ORDER: [&str; 19] = ORIGINAL_19;

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lines { pub flag: f64, pub rounds: usize, pub min_points: usize }
pub const LINES: Lines = Lines { flag: FLAG_LINE, rounds: ROUNDS, min_points: MIN_POINTS };

pub trait Scorer { fn tail(&self, k: usize, used: &[usize], pts: &[Pt], p: Pt) -> anyhow::Result<f64>; }

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome { pub flagged: Vec<(usize, f64)>, pub film_unusual: bool, pub not_run: bool, pub present: usize }

/// Worst first, at most `rounds` rounds; a point beyond the line in the round after the last flags the film. Exactly
/// the bench's `pointcheck::check` with the move line 0 and no candidate spots (FT-2b's `flag_only`).
pub fn check(s: &dyn Scorer, pts: &[Option<Pt>], l: &Lines) -> anyhow::Result<Outcome> {
    let present: Vec<usize> = (0..pts.len()).filter(|&i| pts[i].is_some()).collect();
    if present.len() < l.min_points { return Ok(Outcome { not_run: true, present: present.len(), ..Default::default() }); }
    let cur: Vec<Pt> = pts.iter().map(|p| p.unwrap_or((f64::NAN, f64::NAN))).collect();
    let mut aside: Vec<(usize, f64)> = vec![];
    for round in 0..=l.rounds {
        let active: Vec<usize> = present.iter().copied().filter(|i| !aside.iter().any(|(a, _)| a == i)).collect();
        let mut worst: Option<(usize, f64)> = None;
        for &k in &active {
            let used: Vec<usize> = active.iter().copied().filter(|&j| j != k).collect();
            let t = s.tail(k, &used, &cur, cur[k])?;
            if worst.is_none_or(|(_, w)| t < w) { worst = Some((k, t)); }
        }
        match worst {
            Some((k, t)) if t < l.flag => {
                aside.push((k, t));
                if round == l.rounds { return Ok(Outcome { flagged: aside, film_unusual: true, not_run: false, present: present.len() }); }
            }
            _ => break,
        }
    }
    Ok(Outcome { flagged: aside, film_unusual: false, not_run: false, present: present.len() })
}

/// The bench's `ShapeScorer`, made shareable across the app's threads (`Rc`/`RefCell` → `Arc`/`Mutex`; same fits).
pub struct ShapeScorer { train: Vec<Vec<Pt>>, cache: Mutex<HashMap<(usize, u32), Arc<Conditional>>> }
impl ShapeScorer {
    pub fn new(train: Vec<Vec<Pt>>) -> Self { ShapeScorer { train, cache: Mutex::new(HashMap::new()) } }
    /// The scorer from the starting-knowledge file: exactly `new` on its tracings, in the file's order.
    pub fn from_prior(p: &Prior) -> Self { ShapeScorer::new(p.tracings.clone()) }
    pub fn films(&self) -> usize { self.train.len() }
    pub fn conditional(&self, k: usize, used: &[usize]) -> anyhow::Result<Arc<Conditional>> {
        anyhow::ensure!(used.windows(2).all(|w| w[0] < w[1]), "the used points must be in ascending order (one set, one fit)");
        let key = (k, used.iter().fold(0u32, |m, j| m | 1 << j));
        if let Some(c) = self.cache.lock().map_err(|_| anyhow::anyhow!("the point check's cache is poisoned"))?.get(&key) { return Ok(c.clone()); }
        let c = Arc::new(fit_conditional(&self.train, k, used)?);
        self.cache.lock().map_err(|_| anyhow::anyhow!("the point check's cache is poisoned"))?.insert(key, c.clone());
        Ok(c)
    }
}
impl Scorer for ShapeScorer {
    fn tail(&self, k: usize, used: &[usize], pts: &[Pt], p: Pt) -> anyhow::Result<f64> {
        Ok(self.conditional(k, used)?.tail(&used.iter().map(|&j| pts[j]).collect::<Vec<_>>(), p))
    }
}

#[derive(Clone, Debug, PartialEq, Serialize)] #[serde(rename_all = "camelCase")]
pub struct Mark { pub landmark_id: String, pub x: f64, pub y: f64 }
#[derive(Clone, Debug, PartialEq, Serialize)] #[serde(rename_all = "camelCase")]
pub struct PointFlag { pub landmark_id: String, pub tail: f64, pub expected_x: f64, pub expected_y: f64, pub off_px: f64, pub ring: Ring }
#[derive(Clone, Debug, PartialEq, Serialize)] #[serde(tag = "kind", rename_all = "camelCase")]
pub enum NotRun { TooFewPoints { present: usize }, NotSetUp }
#[derive(Clone, Debug, PartialEq, Serialize)] #[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunCheck { Clean { present: usize }, Flagged { flags: Vec<PointFlag> }, FilmUnusual { flags: Vec<PointFlag> }, NotRun { reason: NotRun } }

/// One model run's marks (film px, the film as stored), scored facing right. Ids outside the 19 are ignored; an id
/// given twice or a coordinate that is not a number is an error (the caller logs it; nothing is flagged).
pub fn score_run(s: &ShapeScorer, marks: &[Mark], facing_left: bool, img_w: u32) -> anyhow::Result<RunCheck> {
    let flip = |x: f64| if facing_left { (img_w as f64 - 1.0) - x } else { x };
    let mut pts: Vec<Option<Pt>> = vec![None; 19];
    for m in marks {
        let Some(k) = ORDER.iter().position(|id| *id == m.landmark_id) else { continue };
        anyhow::ensure!(m.x.is_finite() && m.y.is_finite(), "{} is not a number ({}, {})", m.landmark_id, m.x, m.y);
        anyhow::ensure!(pts[k].is_none(), "{} is given twice", m.landmark_id);
        pts[k] = Some((flip(m.x), m.y));
    }
    let o = check(s, &pts, &LINES)?;
    if o.not_run { return Ok(RunCheck::NotRun { reason: NotRun::TooFewPoints { present: o.present } }); }
    if o.flagged.is_empty() { return Ok(RunCheck::Clean { present: o.present }); }
    let present: Vec<usize> = (0..19).filter(|&i| pts[i].is_some()).collect();
    let cur: Vec<Pt> = pts.iter().map(|p| p.unwrap_or((f64::NAN, f64::NAN))).collect();
    let mut flags = vec![];
    for (r, &(k, tail)) in o.flagged.iter().enumerate() {
        // The frame this point was judged in: the points still active in its round, without it.
        let used: Vec<usize> = present.iter().copied().filter(|&j| j != k && !o.flagged[..r].iter().any(|(a, _)| *a == j)).collect();
        let c = s.conditional(k, &used)?;
        let others: Vec<Pt> = used.iter().map(|&j| cur[j]).collect();
        let (_, centre) = c.d2(&others, cur[k]);
        let ring = c.ring(&others, FLAG_LINE);
        let off_px = ((cur[k].0 - centre.0).powi(2) + (cur[k].1 - centre.1).powi(2)).sqrt();
        let ring = if facing_left { Ring { cx: flip(ring.cx), angle_deg: -ring.angle_deg, ..ring } } else { ring };
        flags.push(PointFlag { landmark_id: ORDER[k].to_string(), tail, expected_x: flip(centre.0), expected_y: centre.1, off_px, ring });
    }
    Ok(if o.film_unusual { RunCheck::FilmUnusual { flags } } else { RunCheck::Flagged { flags } })
}

// ---- The starting knowledge (spec §14.13 U5, owner ruling OQ-2 as revised 2 Nov 2026) ----
// What it is: the point coordinates of the 300 Ceph-400 expert tracings the check was tested on (FT-2b): Train 001-150
// and Test1 151-300, 19 points each, in film pixels, facing right. No film, no image, no patient detail, and no film
// name beyond its number (kept only so a Test2 number, 301-400, can be refused). The check fits its rings from these
// tracings at run time, exactly as FT-2b did, because it re-aligns them for each point and each set of other points
// present; a mean and a covariance could not. Written by `ceph-bench --shape-prior` on the owner's Mac into the
// git-ignored models folder. Whether it may be redistributed is recorded in THIRD_PARTY_MODELS.md (the licence check).

pub const PRIOR_VERSION: &str = "shape-prior/2";
pub const PRIOR_FILMS: usize = 300;
pub const PRIOR_SOURCE: &str = "Ceph-400 expert tracings, Train 001-150 and Test1 151-300; Test2 never read. Point coordinates only: no film, no image.";

/// `<models>/shape/ceph400-v1.shape`, built with joins only (Windows-ready).
pub fn prior_path(models_dir: &Path) -> PathBuf { models_dir.join("shape").join("ceph400-v1.shape") }

/// The loaded file: its SHA-256 (of the file's bytes), the film count, and each tracing's 19 points in `ORDER`.
#[derive(Clone, Debug, PartialEq)]
pub struct Prior { pub sha256: String, pub films: usize, pub tracings: Vec<Vec<Pt>> }

#[derive(Serialize)]
struct PriorFile { version: String, source: String, order: Vec<String>, films: usize, tracings: Vec<PriorTracing> }
#[derive(Serialize)]
struct PriorTracing { film: String, points: Vec<[f64; 2]> }
/// Reading: each coordinate kept as its literal text and parsed by `str::parse::<f64>`, which is correctly rounded, so
/// it reads back to the last bit what serde_json wrote (serde_json's own default f64 parser can miss by 1 ULP).
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PriorFileIn { version: String, #[allow(dead_code)] source: String, order: Vec<String>, films: usize, tracings: Vec<PriorTracingIn> }
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PriorTracingIn { film: String, points: Vec<[Box<serde_json::value::RawValue>; 2]> }

/// A Ceph-400 film number, 001-300. 301-400 is Test2, which never enters the starting knowledge.
fn film_number(name: &str) -> anyhow::Result<u32> {
    anyhow::ensure!(!name.is_empty() && name.len() <= 3 && name.bytes().all(|b| b.is_ascii_digit()),
        "film {name:?} is not a Ceph-400 film number (001-300); the file holds no film name beyond its number");
    let n: u32 = name.parse()?;
    anyhow::ensure!(n <= 300, "film {name} is a Test2 film (301-400): Test2 is never read into the starting knowledge");
    anyhow::ensure!(n >= 1, "film {name:?} is not a Ceph-400 film number (001-300)");
    Ok(n)
}

/// The checks shared by writing and reading: exactly 300 films, each a number 001-300 given once, each with 19
/// points that are all numbers.
fn check_films<'a>(films: impl ExactSizeIterator<Item = (&'a str, &'a [Pt])>) -> anyhow::Result<()> {
    anyhow::ensure!(films.len() == PRIOR_FILMS,
        "the starting knowledge holds exactly {PRIOR_FILMS} tracings (Ceph-400 Train 001-150 and Test1 151-300), not {}", films.len());
    let mut seen = std::collections::BTreeSet::new();
    for (name, pts) in films {
        let n = film_number(name)?;
        anyhow::ensure!(seen.insert(n), "film {name} is given twice");
        anyhow::ensure!(pts.len() == 19, "film {name} has {} points; every tracing must have all 19 ({})", pts.len(), ORDER.join(", "));
        for (k, p) in pts.iter().enumerate() {
            anyhow::ensure!(p.0.is_finite() && p.1.is_finite(), "film {name}: {} is not a number ({}, {})", ORDER[k], p.0, p.1);
        }
    }
    Ok(())
}

/// The file's text from the tracings (film number, 19 points in `ORDER`, film px). Every `f64` is written by
/// `serde_json`, which reads back to the last bit. Refused unless it is exactly what was tested (see `check_films`).
pub fn prior_json(films: &[(String, Vec<Pt>)]) -> anyhow::Result<String> {
    check_films(films.iter().map(|(n, p)| (n.as_str(), p.as_slice())))?;
    let f = PriorFile {
        version: PRIOR_VERSION.into(), source: PRIOR_SOURCE.into(), order: ORDER.iter().map(|s| s.to_string()).collect(),
        films: films.len(),
        tracings: films.iter().map(|(n, p)| PriorTracing { film: n.clone(), points: p.iter().map(|q| [q.0, q.1]).collect() }).collect(),
    };
    Ok(serde_json::to_string_pretty(&f)? + "\n")
}

/// The file's bytes, read and checked: version `shape-prior/2` (checked first, before the rest of the layout),
/// no unknown field, the 19 names in `ORDER`, and the same film checks as writing.
pub fn parse_prior(bytes: &[u8]) -> anyhow::Result<Prior> {
    let v: serde_json::Value = serde_json::from_slice(bytes).map_err(|e| anyhow::anyhow!("not a starting-knowledge file ({e})"))?;
    let version = v.get("version").and_then(|x| x.as_str()).unwrap_or("(none)");
    anyhow::ensure!(version == PRIOR_VERSION, "version {version:?} is not {PRIOR_VERSION}, the only version this app reads");
    let f: PriorFileIn = serde_json::from_slice(bytes).map_err(|e| anyhow::anyhow!("not a {PRIOR_VERSION} file ({e})"))?;
    debug_assert_eq!(f.version, PRIOR_VERSION);
    anyhow::ensure!(f.order.iter().map(String::as_str).eq(ORDER.iter().copied()),
        "the point order is {:?}, not the check's order {:?}", f.order, ORDER);
    anyhow::ensure!(f.films == PRIOR_FILMS, "the file says {} films; the starting knowledge holds exactly {PRIOR_FILMS}", f.films);
    let num = |film: &str, k: usize, raw: &serde_json::value::RawValue| -> anyhow::Result<f64> {
        raw.get().parse::<f64>().map_err(|_| anyhow::anyhow!("film {film}: {} has {} where a number should be; not a number",
            ORDER.get(k).copied().unwrap_or("a point past the 19th"), raw.get()))
    };
    let tracings: Vec<Vec<Pt>> = f.tracings.iter().map(|t| t.points.iter().enumerate()
        .map(|(k, p)| Ok((num(&t.film, k, &p[0])?, num(&t.film, k, &p[1])?))).collect::<anyhow::Result<Vec<Pt>>>())
        .collect::<anyhow::Result<_>>()?;
    check_films(f.tracings.iter().zip(&tracings).map(|(t, p)| (t.film.as_str(), p.as_slice())))?;
    Ok(Prior { sha256: crate::install::sha256_bytes(bytes), films: f.films, tracings })
}

/// Reads and checks the file at `path` (an error names the path; a missing file is an error).
pub fn load_prior(path: &Path) -> anyhow::Result<Prior> {
    let bytes = std::fs::read(path).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))?;
    parse_prior(&bytes).map_err(|e| anyhow::anyhow!("{}: {e}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::shape::Pt;

    fn s240() -> ShapeScorer { ShapeScorer::new(crate::shape::synthetic::faces(240, 4)) }
    fn face() -> Vec<Pt> { crate::shape::synthetic::faces(1, 7).remove(0) }
    fn marks(f: &[Pt]) -> Vec<Mark> { ORDER.iter().zip(f).map(|(id, p)| Mark { landmark_id: id.to_string(), x: p.0, y: p.1 }).collect() }
    const W: u32 = 2400;

    /// Fails if any pinned constant moves (e.g. `ROUNDS = 4`).
    #[test] fn the_constants_are_ft2bs_and_never_tuned() {
        // Pinned (owner ruling OQ-1); each value is FT-2b's pre-registration's. Changing one needs the owner and point-check/3.
        // (Never write that file's name here: the name guard forbids it in ceph-model.)
        assert_eq!((RULE_VERSION, FLAG_LINE, ROUNDS, MIN_POINTS), ("point-check/2", 0.0002, 3, 12));
        assert_eq!(LINES, Lines { flag: 0.0002, rounds: 3, min_points: 12 });
    }
    /// Fails if the scoring flags ordinary points (e.g. the flag line raised, or the tail uncorrected).
    #[test] fn a_clean_synthetic_face_is_clean() {
        assert_eq!(score_run(&s240(), &marks(&face()), false, W).unwrap(), RunCheck::Clean { present: 19 });
    }
    /// SYNTHETIC faces like `synthetic::faces` but with each point wobbling 5 px (0.5 mm) instead of 15: nasion's flag
    /// ring then sits about 2.5–3 mm out, so a 10 mm plant is far outside it on every face. (On the 15 px faces the bench
    /// measured B at 10 mm flagged only 93.5%: a control there could fail by chance, which is why it is not used.)
    fn tight_faces(n: usize, seed: u64) -> Vec<Vec<Pt>> {
        use crate::shape::synthetic::{normal, Rng, OUTLINE};
        let mut r = Rng::new(seed);
        (0..n).map(|_| {
            let (turn, size) = (normal(&mut r) * 0.03, 1.0 + normal(&mut r) * 0.05);
            let (tx, ty) = (normal(&mut r) * 30.0, normal(&mut r) * 30.0);
            let s = crate::shape::Sim { a: size * turn.cos(), b: size * turn.sin(), tx, ty };
            OUTLINE.iter().map(|p| s.apply((p.0 + normal(&mut r) * 5.0, p.1 + normal(&mut r) * 5.0))).collect()
        }).collect()
    }
    /// Ruling OQ-4: the planted 10 mm nasion, on tight SYNTHETIC faces where 10 mm is far outside nasion's ring. It cannot
    /// fail to move: unplanted it is never flagged, at 10 mm always. Fails if the plant is 0 mm or the check flags nothing.
    #[test] fn a_nasion_planted_10_mm_off_is_flagged_on_every_synthetic_face() {
        let s = ShapeScorer::new(tight_faces(240, 4));
        let n = 1usize;
        let mut flagged = 0;
        for (i, f) in tight_faces(50, 99).iter().enumerate() {
            let a = (i as f64) * 0.7;                                        // a different direction each face
            let mut m = f.clone(); m[n] = (m[n].0 + 100.0 * a.cos(), m[n].1 + 100.0 * a.sin());   // 10 mm at 0.1 mm/px
            match score_run(&s, &marks(&m), false, W).unwrap() {
                RunCheck::Flagged { flags } if flags.iter().any(|x| x.landmark_id == "N") => flagged += 1,
                o => panic!("face {i}: nasion 10 mm off not flagged: {o:?}"),
            }
            assert_eq!(score_run(&s, &marks(f), false, W).unwrap(), RunCheck::Clean { present: 19 }, "face {i} unplanted");
        }
        assert_eq!(flagged, 50);
    }
    /// Fails if MIN_POINTS moves or the comparison becomes `<=`.
    #[test] fn too_few_points_does_not_run_and_says_how_many() {
        let mut m = marks(&face()); m.truncate(11);
        assert_eq!(score_run(&s240(), &m, false, W).unwrap(), RunCheck::NotRun { reason: NotRun::TooFewPoints { present: 11 } });
        let mut m = marks(&face()); m.truncate(12);                          // the other side of the edge
        assert!(matches!(score_run(&s240(), &m, false, W).unwrap(), RunCheck::Clean { present: 12 }));
    }
    /// Fails if the check required S and N (an S–N frame) or mis-indexed points when one is absent.
    #[test] fn s_or_n_missing_still_runs_on_the_rest_and_never_needs_an_s_n_frame() {
        let f = face();
        for gone in ["S", "N"] {
            let m: Vec<Mark> = marks(&f).into_iter().filter(|x| x.landmark_id != gone).collect();
            assert_eq!(score_run(&s240(), &m, false, W).unwrap(), RunCheck::Clean { present: 18 }, "{gone} missing");
            let mut wild = f.clone(); wild[5].0 += 200.0;                       // B 20 mm off
            let m: Vec<Mark> = marks(&wild).into_iter().filter(|x| x.landmark_id != gone).collect();
            assert!(matches!(score_run(&s240(), &m, false, W).unwrap(), RunCheck::Flagged { ref flags } if flags[0].landmark_id == "B"), "{gone} missing");
        }
    }
    /// Fails if the mirror step is removed (the left film reads as unusual) or the ring is not mirrored back.
    #[test] fn a_left_facing_film_is_mirrored_first_and_the_ring_mirrored_back() {
        let s = s240();
        let mut wild = face(); wild[5].0 += 200.0;
        let mirror = |v: &[Pt]| v.iter().map(|p| ((W - 1) as f64 - p.0, p.1)).collect::<Vec<_>>();
        let right = score_run(&s, &marks(&wild), false, W).unwrap();
        let left = score_run(&s, &marks(&mirror(&wild)), true, W).unwrap();
        let (RunCheck::Flagged { flags: r }, RunCheck::Flagged { flags: l }) = (&right, &left) else { panic!("{right:?} {left:?}") };
        // Same points, same order, exactly. Numbers within 1e-12 relative, not bit for bit: (W−1)−((W−1)−x) is not always
        // x to the last bit for a fractional x, so a bit-for-bit test here could fail on rounding alone.
        let ids = |v: &[PointFlag]| v.iter().map(|f| f.landmark_id.clone()).collect::<Vec<_>>();
        assert_eq!(ids(r), ids(l));
        // Truly 1e-12 relative: equal values (including both zero) pass; otherwise the gap must be within 1e-12 of the
        // larger magnitude, with no absolute floor that would let a small number drift.
        let close = |a: f64, b: f64| a == b || (a - b).abs() <= 1e-12 * a.abs().max(b.abs());
        let m = |x: f64| (W - 1) as f64 - x;
        for (fr, fl) in r.iter().zip(l) {
            let pairs = [("tail", fl.tail, fr.tail), ("off_px", fl.off_px, fr.off_px),
                ("expected_x", fl.expected_x, m(fr.expected_x)), ("expected_y", fl.expected_y, fr.expected_y),
                ("ring.cx", fl.ring.cx, m(fr.ring.cx)), ("ring.cy", fl.ring.cy, fr.ring.cy),
                ("ring.rx", fl.ring.rx, fr.ring.rx), ("ring.ry", fl.ring.ry, fr.ring.ry),
                ("ring.angle_deg", fl.ring.angle_deg, -fr.ring.angle_deg)];
            for (what, left, right) in pairs { assert!(close(left, right), "{} {what}: left {left} vs right mirrored {right}", fr.landmark_id); }
        }
        // A known limit, pinned (coordinator ruling, option A): the same left-facing marks scored as if facing right
        // read CLEAN, not unusual. A turn/size/shift alignment cannot undo a mirror, so the other points sit far from
        // their mean; the leverage h becomes very large (about 559 for Me on this face) and the small-sample
        // correction divides d² by n(1 + h), shrinking a plain d² of about 3,700 to a tail of about 0.06. The check
        // cannot see a whole-face anomaly, which is why the mirror step must run first. The guard on that step is the
        // `let … else` above: remove the flip and `left` reads Clean, so the test fails there.
        assert_eq!(score_run(&s, &marks(&mirror(&face())), false, W).unwrap(), RunCheck::Clean { present: 19 });
    }
    /// A known limit, pinned so a change to it shows up as a test change: a wild point INSIDE a whole-face anomaly is
    /// hidden. A mirrored face with B 20 mm off, scored as if facing right, reads Clean (unmirrored, B is flagged).
    /// Same cause as above: the huge leverage of the mirrored others widens every ring. The whole-film check (SC-1) is
    /// to cover this. Fails if the correction or the alignment changes how a mirrored face is scored.
    #[test] fn a_wild_point_inside_a_mirrored_face_is_hidden_a_known_limit() {
        let s = s240();
        let mut wild = face(); wild[5].0 += 200.0;                           // B 20 mm off
        assert!(matches!(score_run(&s, &marks(&wild), false, W).unwrap(), RunCheck::Flagged { ref flags } if flags[0].landmark_id == "B"));
        let mirrored: Vec<Pt> = wild.iter().map(|p| ((W - 1) as f64 - p.0, p.1)).collect();
        assert_eq!(score_run(&s, &marks(&mirrored), false, W).unwrap(), RunCheck::Clean { present: 19 });
    }
    /// Fails if the alignment stopped undoing shift, turn or size (e.g. scoring in raw film px).
    #[test] fn every_point_offset_turned_or_resized_together_changes_nothing() {
        let (s, f) = (s240(), face());
        let base = score_run(&s, &marks(&f), false, W).unwrap();
        for (dx, dy, turn, size) in [(300.0, -200.0, 0.0, 1.0), (0.0, 0.0, 0.15, 1.0), (0.0, 0.0, 0.0, 1.3)] {
            let sim = crate::shape::Sim { a: size * f64::cos(turn), b: size * f64::sin(turn), tx: dx, ty: dy };
            let moved: Vec<Pt> = f.iter().map(|p| sim.apply(*p)).collect();
            assert_eq!(score_run(&s, &marks(&moved), false, W).unwrap(), base, "{dx} {dy} {turn} {size}");
        }
        // A clean result has no numbers in it, so also move a face with B 20 mm off: B is flagged first, with the same
        // points flagged and the same tail (within 1e-9) however the face is moved.
        let mut wild = f.clone(); wild[5].0 += 200.0;
        let RunCheck::Flagged { flags: b0 } = score_run(&s, &marks(&wild), false, W).unwrap() else { panic!("B 20 mm off not flagged") };
        for (dx, dy, turn, size) in [(300.0, -200.0, 0.0, 1.0), (0.0, 0.0, 0.15, 1.0), (0.0, 0.0, 0.0, 1.3)] {
            let sim = crate::shape::Sim { a: size * f64::cos(turn), b: size * f64::sin(turn), tx: dx, ty: dy };
            let moved: Vec<Pt> = wild.iter().map(|p| sim.apply(*p)).collect();
            let RunCheck::Flagged { flags } = score_run(&s, &marks(&moved), false, W).unwrap() else { panic!("{dx} {dy} {turn} {size}") };
            let ids = |v: &[PointFlag]| v.iter().map(|x| x.landmark_id.clone()).collect::<Vec<_>>();
            assert_eq!((flags[0].landmark_id.as_str(), ids(&flags)), ("B", ids(&b0)));
            assert!((flags[0].tail / b0[0].tail - 1.0).abs() < 1e-9, "{dx} {dy} {turn} {size}");
        }
    }
    /// Fails if unknown ids were refused, a duplicate overwrote silently, or a NaN reached the maths.
    #[test] fn a_model_with_fewer_points_or_other_ids_is_scored_on_the_19_it_has() {
        let f = face();
        let mut m = marks(&f); m.retain(|x| !["Po", "Or", "Ar", "PNS"].contains(&x.landmark_id.as_str()));
        m.push(Mark { landmark_id: "Ba".into(), x: 10.0, y: 10.0 });          // a point outside the 19: ignored
        assert_eq!(score_run(&s240(), &m, false, W).unwrap(), RunCheck::Clean { present: 15 });
        let mut d = marks(&f); d.push(d[0].clone());
        assert!(score_run(&s240(), &d, false, W).unwrap_err().to_string().contains("twice"));
        let mut nan = marks(&f); nan[3].x = f64::NAN;
        assert!(score_run(&s240(), &nan, false, W).unwrap_err().to_string().contains("not a number"));
    }
    /// Fails if ROUNDS moves (4 → a 4th wild point stays a point flag) or the film-unusual branch is lost.
    #[test] fn four_wild_points_flag_the_film_and_three_do_not() {
        let s = s240();
        let mut f = face(); for k in [0, 1, 3] { f[k].1 -= 250.0; }
        assert!(matches!(score_run(&s, &marks(&f), false, W).unwrap(), RunCheck::Flagged { ref flags } if flags.len() == 3));
        f[18].1 -= 250.0;
        assert!(matches!(score_run(&s, &marks(&f), false, W).unwrap(), RunCheck::FilmUnusual { ref flags } if flags.len() == 4));
    }
    /// Fails if the ring's radius formula (d²* from the corrected tail) or its turn/size undo is wrong.
    #[test] fn the_flag_ring_is_where_the_tail_reaches_the_flag_line() {
        let s = s240();
        let f = face();
        let used: Vec<usize> = (0..19).filter(|&j| j != 5).collect();
        let c = s.conditional(5, &used).unwrap();
        let others: Vec<Pt> = used.iter().map(|&j| f[j]).collect();
        let r = c.ring(&others, FLAG_LINE);
        let t = r.angle_deg.to_radians();
        for (ax, ay) in [(r.rx, 0.0), (0.0, r.ry), (-r.rx, 0.0)] {
            let p = (r.cx + ax * t.cos() - ay * t.sin(), r.cy + ax * t.sin() + ay * t.cos());
            assert!((c.tail(&others, p) / FLAG_LINE - 1.0).abs() < 1e-9, "{p:?}");
        }
    }
    /// Fails if the check stops ordering worst first or flags a tail exactly on the line (`<=`).
    #[test] fn the_flag_only_check_matches_the_bench_draft_with_no_move_line() {
        // check(...) is the bench's pointcheck::check with mv = 0 and no candidate spots (FT-2b's `flag_only`), restated.
        struct Fake(Vec<f64>);
        impl Scorer for Fake { fn tail(&self, k: usize, _: &[usize], _: &[Pt], _: Pt) -> anyhow::Result<f64> { Ok(self.0[k]) } }
        let pts: Vec<Option<Pt>> = (0..19).map(|i| Some((i as f64, 0.0))).collect();
        let mut t = vec![0.5; 19]; t[8] = 1e-7; t[3] = 1e-4;
        let o = check(&Fake(t), &pts, &LINES).unwrap();
        assert_eq!(o.flagged, vec![(8, 1e-7), (3, 1e-4)]);
        let mut t = vec![0.5; 19]; t[2] = FLAG_LINE;                           // exactly on the line: not flagged
        assert!(check(&Fake(t), &pts, &LINES).unwrap().flagged.is_empty());
    }

    // ---- Task 3: the starting knowledge (spec §14.13 U5, ruling OQ-2 as revised): the 300 tracings' coordinates ----
    /// `n` SYNTHETIC tracings numbered 001, 002, … (the real file: Train 001-150 and Test1 151-300), full-precision f64.
    fn good_films(n: usize) -> Vec<(String, Vec<Pt>)> {
        crate::shape::synthetic::faces(n, 31).into_iter().enumerate().map(|(i, f)| (format!("{:03}", i + 1), f)).collect()
    }
    fn write(dir: &std::path::Path, text: &str) -> std::path::PathBuf { let p = dir.join("t.shape"); std::fs::write(&p, text).unwrap(); p }
    fn value(films: &[(String, Vec<Pt>)]) -> serde_json::Value { serde_json::from_str(&prior_json(films).unwrap()).unwrap() }

    /// Fails if a coordinate is rounded on the way (e.g. written as `f32`), a film is dropped or reordered, or the
    /// sha256 is not of the file's own bytes.
    #[test] fn a_prior_round_trips_exactly_with_its_sha256() {
        let films = good_films(300);
        let text = prior_json(&films).unwrap();
        let d = tempfile::tempdir().unwrap();
        let p = load_prior(&write(d.path(), &text)).unwrap();
        assert_eq!((p.films, p.tracings.len()), (300, 300));
        let mut compared = 0usize;
        for ((_, want), got) in films.iter().zip(&p.tracings) {
            assert_eq!(got.len(), 19);
            for (a, b) in want.iter().zip(got) {
                assert_eq!((a.0.to_bits(), a.1.to_bits()), (b.0.to_bits(), b.1.to_bits()));
                compared += 2;
            }
        }
        eprintln!("coordinates compared bit for bit: {compared}");
        assert_eq!(compared, 300 * 19 * 2, "the instrument compared {compared}, not 11,400");
        assert_eq!(p.sha256, crate::install::sha256_bytes(text.as_bytes()));
        let v: serde_json::Value = serde_json::from_str(&text).unwrap();
        assert_eq!((v["version"].as_str(), v["source"].as_str(), v["films"].as_u64()), (Some(PRIOR_VERSION), Some(PRIOR_SOURCE), Some(300)));
        assert_eq!(v["order"], serde_json::json!(ORDER));
        assert_eq!((v["tracings"][0]["film"].as_str(), v["tracings"][299]["film"].as_str()), (Some("001"), Some("300")));
        assert_eq!(v["tracings"][0].as_object().unwrap().len(), 2, "a tracing holds its film number and its points, nothing else");
    }

    /// Each refusal named by the brief, on writing and on reading. Fails if any check is dropped (e.g. the Test2 check,
    /// the 300 check, the duplicate check, the order or version check).
    #[test] fn a_prior_is_refused_when_it_is_not_what_was_tested() {
        let d = tempfile::tempdir().unwrap();
        let on_write = |f: &[(String, Vec<Pt>)]| prior_json(f).unwrap_err().to_string();
        let on_read = |v: &serde_json::Value| format!("{:#}", load_prior(&write(d.path(), &serde_json::to_string_pretty(v).unwrap())).unwrap_err());
        let show = |what: &str, e: &str| eprintln!("{what}: {e}");
        // Writing.
        let mut f = good_films(300); f[299].0 = "301".into();
        let e = on_write(&f); show("write, a Test2 film", &e); assert!(e.contains("Test2"), "{e}");
        let e = on_write(&good_films(299)); show("write, 299 films", &e); assert!(e.contains("300"), "{e}");
        let mut f = good_films(300); f[1].0 = "001".into();
        let e = on_write(&f); show("write, a film twice", &e); assert!(e.contains("twice"), "{e}");
        let mut f = good_films(300); f[7].1.pop();
        let e = on_write(&f); show("write, 18 points", &e); assert!(e.contains("19"), "{e}");
        for (k, name) in [(0, "S"), (1, "N")] {
            let mut f = good_films(300); f[9].1.remove(k);
            let e = on_write(&f); show(&format!("write, {name} missing"), &e); assert!(e.contains("19"), "{e}");
        }
        let mut f = good_films(300); f[7].1[3].0 = f64::NAN;
        let e = on_write(&f); show("write, a NaN", &e); assert!(e.contains("not a number"), "{e}");
        let mut f = good_films(300); f[7].1[3].1 = f64::INFINITY;
        assert!(on_write(&f).contains("not a number"));
        let mut f = good_films(300); f[4].0 = "film-005".into();
        let e = on_write(&f); show("write, a name that is not a film number", &e); assert!(e.contains("film number"), "{e}");
        let mut f = good_films(300); f[4].0 = "000".into();
        assert!(on_write(&f).contains("film number"));
        // Reading: a good file edited one way at a time.
        let good = value(&good_films(300));
        let mut v = good.clone(); v["tracings"][299]["film"] = "301".into();
        let e = on_read(&v); show("read, a Test2 film", &e); assert!(e.contains("Test2"), "{e}");
        let mut v = good.clone(); v["tracings"].as_array_mut().unwrap().pop(); v["films"] = 299.into();
        let e = on_read(&v); show("read, 299 films", &e); assert!(e.contains("300"), "{e}");
        let mut v = good.clone(); v["tracings"].as_array_mut().unwrap().pop();
        let e = on_read(&v); show("read, says 300 but holds 299", &e); assert!(e.contains("300"), "{e}");
        let mut v = good.clone(); v["tracings"][1]["film"] = "001".into();
        let e = on_read(&v); show("read, a film twice", &e); assert!(e.contains("twice"), "{e}");
        let mut v = good.clone(); v["order"][0] = "Sella".into();
        let e = on_read(&v); show("read, a changed order", &e); assert!(e.contains("order"), "{e}");
        let mut v = good.clone(); v["order"].as_array_mut().unwrap().swap(0, 1);
        assert!(on_read(&v).contains("order"));
        let mut v = good.clone(); v["tracings"][5]["points"].as_array_mut().unwrap().pop();
        let e = on_read(&v); show("read, 18 points", &e); assert!(e.contains("19"), "{e}");
        let mut v = good.clone(); v["tracings"][5]["points"][2][0] = "12.5".into();
        let e = on_read(&v); show("read, a coordinate that is a string", &e);
        let mut v = good.clone(); v["tracings"][5]["points"][2][0] = serde_json::Value::Null;
        let e = on_read(&v); show("read, a coordinate that is null", &e);
        let mut v = good.clone(); v["tracings"][5]["points"][2] = serde_json::json!([1.0, 2.0, 3.0]);
        let e = on_read(&v); show("read, a point with 3 numbers", &e);
        for bad in ["shape-prior/1", "shape-prior/3", "", "nope"] {
            let mut v = good.clone(); v["version"] = bad.into();
            let e = on_read(&v); show(&format!("read, version {bad:?}"), &e); assert!(e.contains("shape-prior/2"), "{e}");
        }
        let mut v = good.clone(); v.as_object_mut().unwrap().remove("version");
        assert!(on_read(&v).contains("shape-prior/2"));
        let mut v = good.clone(); v["image"] = "x".into();
        let e = on_read(&v); show("read, an extra field", &e);
        let mut v = good.clone(); v["tracings"][0]["patient"] = "x".into();
        let e = on_read(&v); show("read, an extra field in a tracing", &e);
        let gone = d.path().join("not-there.shape");
        let e = format!("{:#}", load_prior(&gone).unwrap_err()); show("read, a missing file", &e); assert!(e.contains("not-there.shape"), "{e}");
        assert!(load_prior(&write(d.path(), "{not json")).is_err());
        // And the good file itself still loads (the edits above are what was refused).
        assert_eq!(load_prior(&write(d.path(), &serde_json::to_string_pretty(&good).unwrap())).unwrap().films, 300);
    }

    /// Windows-ready (master plan §13): the path is built with `join` only, never a `/` in a string. Fails if
    /// `prior_path` is written as `models_dir.join("shape/ceph400-v1.shape")` (on a Mac that gives the same PathBuf,
    /// which is why the source line itself is checked).
    #[test] fn the_prior_path_is_built_with_joins_only() {
        let m = std::path::Path::new("some-models-dir");
        assert_eq!(prior_path(m), m.join("shape").join("ceph400-v1.shape"));
        let src = include_str!("pointcheck.rs");
        let line = src.lines().find(|l| l.contains("pub fn prior_path(")).expect("prior_path is defined on one line");
        assert!(!line.contains('/'), "a / in prior_path: {line}");
    }

    /// The file gives exactly the flags the tracings give. Fails if the file loses a bit of any coordinate (e.g. written
    /// as `f32`), drops or reorders films, or `from_prior` builds anything other than `new(p.tracings)`.
    #[test] fn the_file_gives_the_same_flags_as_the_tracings() {
        let films = good_films(300);
        let d = tempfile::tempdir().unwrap();
        let direct = ShapeScorer::new(films.iter().map(|f| f.1.clone()).collect());
        let from_file = ShapeScorer::from_prior(&load_prior(&write(d.path(), &prior_json(&films).unwrap())).unwrap());
        assert_eq!(from_file.films(), 300);
        let base = face();
        let mirror = |v: &[Pt]| v.iter().map(|p| ((W - 1) as f64 - p.0, p.1)).collect::<Vec<_>>();
        let mut runs: Vec<(&str, Vec<Mark>, bool)> = vec![];
        for k in 0..19 { let mut f = base.clone(); f[k].0 += 120.0; f[k].1 -= 90.0; runs.push(("plant", marks(&f), false)); }
        let mut m = marks(&base); m.remove(4); runs.push(("a point not found", m, false));
        let mut f = base.clone(); f[5].0 += 200.0; runs.push(("a flipped film", marks(&mirror(&f)), true));
        let mut f = base.clone(); for k in [0, 1, 3, 18] { f[k].1 -= 250.0; } runs.push(("4 wild points", marks(&f), false));
        runs.push(("clean", marks(&base), false));
        let mut m = marks(&base); m.truncate(11); runs.push(("11 points", m, false));
        let mut kinds = std::collections::BTreeMap::<&str, usize>::new();
        for (what, m, left) in &runs {
            let (a, b) = (score_run(&direct, m, *left, W).unwrap(), score_run(&from_file, m, *left, W).unwrap());
            assert_eq!(serde_json::to_vec(&a).unwrap(), serde_json::to_vec(&b).unwrap(), "{what}");
            assert_eq!(a, b, "{what}");
            *kinds.entry(match a { RunCheck::Clean { .. } => "clean", RunCheck::Flagged { .. } => "flagged", RunCheck::FilmUnusual { .. } => "film unusual", RunCheck::NotRun { .. } => "not run" }).or_default() += 1;
        }
        eprintln!("runs compared as bytes: {} ({kinds:?})", runs.len());
        assert_eq!(runs.len(), 24);
        assert_eq!(kinds.len(), 4, "every outcome must be among the compared runs: {kinds:?}");
        assert!(kinds["flagged"] >= 10, "{kinds:?}");
    }
}
