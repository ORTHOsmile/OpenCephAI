//! The point plausibility check (spec 2026-10-27 §14.3, §14.5), for FT-2 (§14.9): worst first (at most 3 rounds; a 4th
//! wild point flags the film and moves nothing), a move only below the move line and only to the placing model's own
//! next heat-map spot inside the 19-in-20 ring (the brightest that qualifies), then one re-assessment of the rest with
//! the move line as the flag line, flags only (owner P1 and Q-P5, 27 Oct). Bench only until Stage A.
use crate::ft_common::{dist, Pt};
use crate::shape::{fit_conditional, Conditional};
use ceph_infer::spec::ModelSpec;
use ceph_infer::transform::{heatmap_to_input, Geometry};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

/// One of a model's other heat-map spots for a point, in film px, with its brightness (the heat map's raw value).
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct Spot { pub x: f64, pub y: f64, pub brightness: f32 }

/// Which spots count as candidates (spec §14.5 item 2): at least `min_mm` from the pin, at least `min_share` as bright
/// as the top peak, the `keep` brightest.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Candidates { pub min_mm: f64, pub min_share: f64, pub keep: usize }

/// The local peaks of one channel other than its top one (cells higher than all 8 neighbours), at the cell's centre in
/// film px (no sub-cell refinement), brightest first. Chw heat maps only (the caller checks). A film with no width or
/// no height (a zero or non-finite geometry scale) is refused (ruling, 27 Oct).
#[allow(clippy::too_many_arguments)]
pub fn spots(ch: &[f32], m: &ModelSpec, g: &Geometry, img_w: u32, facing_left: bool, decoded: Pt, mm_per_px: f64, c: &Candidates) -> anyhow::Result<Vec<Spot>> {
    anyhow::ensure!(img_w > 0, "the film has no width (0 px): no spots");
    anyhow::ensure!(g.ax.is_finite() && g.ay.is_finite() && g.ax > 0.0 && g.ay > 0.0,
        "the film has no width or height (its geometry has scale {} × {}): no spots", g.ax, g.ay);
    let (rows, cols) = (m.output.height as usize, m.output.width as usize);
    let (mut top_i, mut top) = (0usize, f32::MIN);
    for (i, &v) in ch.iter().enumerate() { if v > top { top = v; top_i = i; } }
    let mut out = vec![];
    for r in 0..rows {
        for col in 0..cols {
            let i = r * cols + col;
            let v = ch[i];
            if i == top_i || v <= 0.0 || (v as f64) < c.min_share * top as f64 { continue; }
            let higher = (-1i64..=1).any(|dr| (-1i64..=1).any(|dc| {
                let (rr, cc) = (r as i64 + dr, col as i64 + dc);
                (dr, dc) != (0, 0) && rr >= 0 && cc >= 0 && (rr as usize) < rows && (cc as usize) < cols && ch[rr as usize * cols + cc as usize] >= v
            }));
            if higher { continue; }
            let (u, vv) = heatmap_to_input(col as f64, r as f64, m.output.stride as f64, m.output.heatmap_center);
            let (mut x, y) = g.to_image(u, vv);
            if facing_left { x = (img_w - 1) as f64 - x; }
            if dist((x, y), decoded) * mm_per_px < c.min_mm { continue; }
            out.push(Spot { x, y, brightness: v });
        }
    }
    out.sort_by(|a, b| b.brightness.total_cmp(&a.brightness));
    out.truncate(c.keep);
    Ok(out)
}

/// The check's lines (owner P1, 27 Oct): flag below `flag`, move only below `mv`, a candidate qualifies at `qualify`
/// or above; `rounds` worst-first rounds; at least `min_points` points present.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lines { pub flag: f64, pub mv: f64, pub qualify: f64, pub rounds: usize, pub min_points: usize }

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Move { pub point: usize, pub from: Pt, pub to: Pt, pub tail_before: f64, pub tail_after: f64, /** 2–5: the spot's rank (1 is the top peak) */ pub rank: usize }

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    /// Points set aside worst first, with their chance.
    pub flagged: Vec<(usize, f64)>,
    pub moved: Option<Move>,
    /// Points the one re-assessment found below the move line (flags only, Q-P5).
    pub reassessed: Vec<(usize, f64)>,
    pub film_unusual: bool,
    pub not_run: bool,
}
impl Outcome {
    pub fn is_flagged(&self, k: usize) -> bool { self.flagged.iter().chain(&self.reassessed).any(|(p, _)| *p == k) }
    pub fn is_moved(&self, k: usize) -> bool { self.moved.as_ref().is_some_and(|m| m.point == k) }
    /// Every flagged point once, in the order first flagged (the worst-first rounds, then the re-assessment's new
    /// ones). A point can sit in both `flagged` and `reassessed`: count flags with this, never by adding the two lists.
    pub fn flagged_points(&self) -> Vec<usize> {
        let mut v: Vec<usize> = vec![];
        for (p, _) in self.flagged.iter().chain(&self.reassessed) { if !v.contains(p) { v.push(*p); } }
        v
    }
}

/// Point `k`'s tail chance at `p`, given the points `used` (ascending) at `pts[j]`.
pub trait Scorer { fn tail(&self, k: usize, used: &[usize], pts: &[Pt], p: Pt) -> anyhow::Result<f64>; }

/// The check on one tracing (`pts[k]` None: the point was not found) with each point's candidate spots.
pub fn check(s: &dyn Scorer, pts: &[Option<Pt>], cands: &[Vec<Spot>], l: &Lines) -> anyhow::Result<Outcome> {
    let present: Vec<usize> = (0..pts.len()).filter(|&i| pts[i].is_some()).collect();
    if present.len() < l.min_points { return Ok(Outcome { not_run: true, ..Default::default() }); }
    let mut cur: Vec<Pt> = pts.iter().map(|p| p.unwrap_or((f64::NAN, f64::NAN))).collect();
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
                if round == l.rounds { return Ok(Outcome { flagged: aside, film_unusual: true, ..Default::default() }); }
            }
            _ => break,
        }
    }
    let mut out = Outcome { flagged: aside.clone(), ..Default::default() };
    let Some(&(w, tw)) = aside.first() else { return Ok(out) };
    if tw >= l.mv { return Ok(out); }
    let used: Vec<usize> = present.iter().copied().filter(|&j| j != w && !aside.iter().any(|(a, _)| *a == j)).collect();
    let mut best = None;
    for (i, c) in cands[w].iter().enumerate() {
        let t = s.tail(w, &used, &cur, (c.x, c.y))?;
        if t >= l.qualify { best = Some((i, *c, t)); break; }
    }
    let Some((i, c, t_after)) = best else { return Ok(out) };
    out.moved = Some(Move { point: w, from: cur[w], to: (c.x, c.y), tail_before: tw, tail_after: t_after, rank: i + 2 });
    cur[w] = (c.x, c.y);
    // The re-assessment (spec §14.5 item 8, with the ruling of 27 Oct, to be written into §14.5 at
    // records): the moved point joins the frame, but every OTHER point the worst-first rounds set aside stays out of
    // it, as in those rounds, so a wild point never bends the alignment the rest are re-scored in. Each set-aside point
    // is itself still re-scored (against the frame without it), flags only (Q-P5).
    let wild: Vec<usize> = aside.iter().map(|(a, _)| *a).filter(|&a| a != w).collect();
    for &k in &present {
        if k == w { continue; }
        let used: Vec<usize> = present.iter().copied().filter(|&j| j != k && !wild.contains(&j)).collect();
        let t = s.tail(k, &used, &cur, cur[k])?;
        if t < l.mv { out.reassessed.push((k, t)); }
    }
    Ok(out)
}

/// The scorer FT-2 uses: rings fitted from expert tracings, one per (point, set of other points), kept once fitted.
pub struct ShapeScorer { train: Vec<Vec<Pt>>, cache: RefCell<HashMap<(usize, u32), Rc<Conditional>>> }
impl ShapeScorer {
    pub fn new(train: Vec<Vec<Pt>>) -> Self { ShapeScorer { train, cache: RefCell::new(HashMap::new()) } }
    fn model(&self, k: usize, used: &[usize]) -> anyhow::Result<Rc<Conditional>> {
        anyhow::ensure!(used.windows(2).all(|w| w[0] < w[1]), "the used points must be in ascending order (one set, one fit)");
        let key = (k, used.iter().fold(0u32, |m, j| m | 1 << j));
        if let Some(c) = self.cache.borrow().get(&key) { return Ok(c.clone()); }
        let c = Rc::new(fit_conditional(&self.train, k, used)?);
        self.cache.borrow_mut().insert(key, c.clone());
        Ok(c)
    }
    /// Point `k`'s ring spread on this tracing, film px.
    pub fn sd_px(&self, k: usize, used: &[usize], pts: &[Pt]) -> anyhow::Result<f64> {
        Ok(self.model(k, used)?.sd_px(&used.iter().map(|&j| pts[j]).collect::<Vec<_>>()))
    }
}
impl Scorer for ShapeScorer {
    fn tail(&self, k: usize, used: &[usize], pts: &[Pt], p: Pt) -> anyhow::Result<f64> {
        Ok(self.model(k, used)?.tail(&used.iter().map(|&j| pts[j]).collect::<Vec<_>>(), p))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fake { good: Vec<Pt>, bad: Vec<f64> }
    impl Scorer for Fake {
        fn tail(&self, k: usize, _used: &[usize], _pts: &[Pt], p: Pt) -> anyhow::Result<f64> {
            Ok(if dist(p, self.good[k]) < 1e-9 { 0.5 } else { self.bad[k] })
        }
    }
    fn lines() -> Lines { Lines { flag: 1.0 / 5_000.0, mv: 1.0 / 50_000.0, qualify: 0.05, rounds: 3, min_points: 12 } }
    fn good() -> Vec<Pt> { (0..19).map(|i| (100.0 * i as f64, 50.0)).collect() }
    fn off(p: Pt) -> Pt { (p.0 + 7.0, p.1 + 9.0) }
    fn spot(p: Pt, b: f32) -> Spot { Spot { x: p.0, y: p.1, brightness: b } }
    fn some(v: &[Pt]) -> Vec<Option<Pt>> { v.iter().map(|p| Some(*p)).collect() }
    fn none() -> Vec<Vec<Spot>> { vec![vec![]; 19] }
    #[test] fn a_clean_tracing_is_left_alone() {
        let f = Fake { good: good(), bad: vec![1e-9; 19] };
        assert_eq!(check(&f, &some(&good()), &none(), &lines()).unwrap(), Outcome::default());
    }
    #[test] fn a_point_between_the_lines_is_flagged_not_moved() {
        let mut pts = good(); pts[3] = off(pts[3]);
        let mut bad = vec![1e-9; 19]; bad[3] = 1e-4;
        let mut c = none(); c[3] = vec![spot(good()[3], 0.9)];
        let o = check(&Fake { good: good(), bad }, &some(&pts), &c, &lines()).unwrap();
        assert_eq!((o.flagged.clone(), o.moved.clone()), (vec![(3, 1e-4)], None));
    }
    #[test] fn below_the_move_line_it_moves_to_the_brightest_spot_that_qualifies() {
        let mut pts = good(); pts[3] = off(pts[3]);
        let mut bad = vec![1e-9; 19]; bad[3] = 1e-6;
        let mut c = none(); c[3] = vec![spot(off(off(good()[3])), 0.9), spot(good()[3], 0.5)];
        let o = check(&Fake { good: good(), bad: bad.clone() }, &some(&pts), &c, &lines()).unwrap();
        let m = o.moved.clone().expect("moved");
        assert_eq!((m.point, m.to, m.rank, m.tail_after), (3, good()[3], 3, 0.5), "the first spot does not qualify; the second (rank 3) does");
        assert!(o.reassessed.is_empty() && o.is_flagged(3) && o.is_moved(3));
        let mut c2 = none(); c2[3] = vec![spot(off(off(good()[3])), 0.9)];
        let o = check(&Fake { good: good(), bad }, &some(&pts), &c2, &lines()).unwrap();
        assert!(o.moved.is_none() && o.is_flagged(3), "no qualifying spot: flagged only");
    }
    #[test] fn four_wild_points_flag_the_film_and_move_nothing() {
        let mut pts = good(); let mut bad = vec![1e-9; 19];
        for k in [1, 4, 9, 12] { pts[k] = off(pts[k]); bad[k] = 1e-7; }
        let mut c = none(); for k in [1, 4, 9, 12] { c[k] = vec![spot(good()[k], 0.9)]; }
        let o = check(&Fake { good: good(), bad }, &some(&pts), &c, &lines()).unwrap();
        assert!(o.film_unusual && o.moved.is_none() && o.flagged.len() == 4, "{o:?}");
    }
    /// Q-P5 (owner, 27 Oct): the re-assessment never moves a second point.
    /// The boundary (Task 3 review, folded into Task 5): exactly 3 wild points are the 3 worst-first rounds, so the film
    /// is NOT unusual and the worst is still moved; a 4th makes it unusual. Positive control: let the 3rd round end the
    /// check (`round + 1 == l.rounds`, the code's form of `> 3` → `>= 3`) → the 3-point half fails.
    #[test] fn exactly_three_wild_points_leave_the_film_usual_and_four_do_not() {
        let run = |wild: &[usize]| {
            let mut pts = good(); let mut bad = vec![1e-9; 19];
            for &k in wild { pts[k] = off(pts[k]); bad[k] = 1e-7; }
            let mut c = none(); for &k in wild { c[k] = vec![spot(good()[k], 0.9)]; }
            check(&Fake { good: good(), bad }, &some(&pts), &c, &lines()).unwrap()
        };
        let three = run(&[1, 4, 9]);
        eprintln!("3 wild: {three:?}");
        assert!(!three.film_unusual && three.flagged.len() == 3 && three.is_moved(1), "{three:?}");
        let four = run(&[1, 4, 9, 12]);
        eprintln!("4 wild: {four:?}");
        assert!(four.film_unusual && four.flagged.len() == 4 && four.moved.is_none(), "{four:?}");
    }
    #[test] fn two_wild_points_get_one_move_and_one_flag() {
        let mut pts = good(); let mut bad = vec![1e-9; 19];
        pts[3] = off(pts[3]); bad[3] = 1e-7;
        pts[8] = off(pts[8]); bad[8] = 1e-6;
        let mut c = none(); c[3] = vec![spot(good()[3], 0.9)]; c[8] = vec![spot(good()[8], 0.9)];
        let o = check(&Fake { good: good(), bad }, &some(&pts), &c, &lines()).unwrap();
        assert_eq!(o.moved.as_ref().map(|m| m.point), Some(3), "the worst is moved");
        assert!(o.is_flagged(8) && !o.is_moved(8), "{o:?}");
        assert_eq!(o.reassessed.iter().map(|r| r.0).collect::<Vec<_>>(), vec![8], "the re-assessment flags the second, at the move line");
    }
    #[test] fn too_few_points_and_the_exact_lines() {
        let mut pts = some(&good()); for k in 0..8 { pts[k] = None; }
        assert!(check(&Fake { good: good(), bad: vec![1e-9; 19] }, &pts, &none(), &lines()).unwrap().not_run, "11 points: not run");
        let mut p = good(); p[3] = off(p[3]);
        let mut bad = vec![1e-9; 19]; bad[3] = 1.0 / 5_000.0;
        assert_eq!(check(&Fake { good: good(), bad: bad.clone() }, &some(&p), &none(), &lines()).unwrap(), Outcome::default(), "exactly at the flag line is not below it");
        bad[3] = 1.0 / 50_000.0;
        let mut c = none(); c[3] = vec![spot(good()[3], 0.9)];
        let o = check(&Fake { good: good(), bad }, &some(&p), &c, &lines()).unwrap();
        assert!(o.is_flagged(3) && o.moved.is_none(), "exactly at the move line: flagged, not moved");
    }
    fn small_spec() -> ModelSpec {
        serde_json::from_value(serde_json::json!({"manifestVersion": 2, "id": "SYNTHETIC", "version": "v", "file": "m", "sha256": "s",
            "input": {"name": "image", "width": 160, "height": 200, "channels": 3, "resize": {"kind": "stretch"},
                      "normalize": {"kind": "fixed", "mean": [0, 0, 0], "std": [1, 1, 1], "scale": 255.0}},
            "output": {"name": "heatmaps", "width": 40, "height": 50, "stride": 4, "heatmapCenter": "half-pixel", "decode": {"kind": "argmax"}},
            "landmarkMap": ["S"], "runtime": "cpu"})).unwrap()
    }
    /// SYNTHETIC heat map, 40 × 50 cells: the top at (20, 25) = 3.0; a peak 2 cells away (2 mm at 0.05 mm/px: too close);
    /// five more peaks of 1.5, 1.0, 0.9, 0.8 and 0.76 (four kept), and one of 0.5 (below a quarter of 3.0).
    #[test] fn spots_are_the_next_peaks_far_enough_and_bright_enough_brightest_first() {
        let m = small_spec();
        let g = Geometry::for_input(800, 1000, &m.input);
        let mut h = vec![0f32; 40 * 50];
        for (c, r, v) in [(20, 25, 3.0), (22, 25, 2.0), (5, 5, 1.5), (30, 10, 1.0), (10, 40, 0.9), (2, 30, 0.8), (25, 2, 0.76), (35, 45, 0.5)] { h[r * 40 + c] = v; }
        let at = |c: usize, r: usize| { let (u, v) = heatmap_to_input(c as f64, r as f64, 4.0, m.output.heatmap_center); g.to_image(u, v) };
        let cand = Candidates { min_mm: 3.0, min_share: 0.25, keep: 4 };
        let s = spots(&h, &m, &g, 800, false, at(20, 25), 0.05, &cand).unwrap();
        let want = [(5, 5, 1.5f32), (30, 10, 1.0), (10, 40, 0.9), (2, 30, 0.8)];
        assert_eq!(s.len(), 4, "{s:?}");
        for (got, (c, r, b)) in s.iter().zip(want) { let p = at(c, r); assert!((got.x - p.0).abs() < 1e-9 && (got.y - p.1).abs() < 1e-9 && got.brightness == b, "{got:?}"); }
        let left = spots(&h, &m, &g, 800, true, (799.0 - at(20, 25).0, at(20, 25).1), 0.05, &cand).unwrap();
        assert!((left[0].x - (799.0 - at(5, 5).0)).abs() < 1e-9, "a left-facing film's spots come back unflipped");
    }
    #[test] fn the_shape_scorer_needs_the_used_points_in_order() {
        let s = ShapeScorer::new(crate::shape::synthetic::faces(60, 4));
        let t = crate::shape::synthetic::faces(1, 5).remove(0);
        let used: Vec<usize> = (1..19).collect();
        assert!(s.tail(0, &used, &t, t[0]).unwrap() > 0.0);
        let mut back = used.clone(); back.reverse();
        assert!(s.tail(0, &back, &t, t[0]).unwrap_err().to_string().contains("ascending"));
    }
    /// The CARRY (Task 2, 27 Oct): every line is read on the CORRECTED chance (`shape::Conditional::tail`), never on the
    /// large-sample e^(−d²/2) or a fixed d. B is planted where the large-sample chance is already below the move line but
    /// the corrected one sits between the lines: the check must flag it and NOT move it, though a qualifying spot waits
    /// at B's true place. Reading e^(−d²/2) (or "d = 4.65") anywhere in the scorer or the check moves it, and fails here.
    #[test] fn the_lines_are_read_on_the_corrected_chance_not_on_e_to_the_minus_d2_over_2() {
        let train = crate::shape::synthetic::faces(240, 4);
        let s = ShapeScorer::new(train.clone());
        let face = crate::shape::synthetic::faces(1, 7).remove(0);
        let b = 5usize;
        let used: Vec<usize> = (0..19).filter(|&j| j != b).collect();
        let c = fit_conditional(&train, b, &used).unwrap();
        let others: Vec<Pt> = used.iter().map(|&j| face[j]).collect();
        let l = lines();
        let mut found = None;
        for step in 0..400 {
            let p = (face[b].0 + step as f64, face[b].1);
            let (d2, _) = c.d2(&others, p);
            let t = s.tail(b, &used, &face, p).unwrap();
            assert_eq!(t, c.tail(&others, p), "the scorer reads the shape model's corrected tail");
            if (-d2 / 2.0).exp() < l.mv && t >= l.mv && t < l.flag { found = Some((p, d2, t)); break; }
        }
        let (p, d2, t) = found.expect("a plant whose large-sample chance is below the move line and corrected chance between the lines");
        eprintln!("plant {:.0} px forward: d = {:.3}, e^(-d²/2) = {:.3e}, corrected tail = {t:.3e}", p.0 - face[b].0, d2.sqrt(), (-d2 / 2.0).exp());
        let mut pts: Vec<Option<Pt>> = face.iter().map(|q| Some(*q)).collect();
        pts[b] = Some(p);
        let mut cands = none(); cands[b] = vec![spot(face[b], 0.9)];
        let o = check(&s, &pts, &cands, &l).unwrap();
        assert!(o.is_flagged(b) && o.moved.is_none(), "between the corrected lines: flagged, not moved: {o:?}");
        assert_eq!(o.flagged.len(), 1, "{o:?}");
    }
    /// The whole check with the real scorer: B 20 mm off on a SYNTHETIC face, a brighter spot 30 mm away that does not
    /// qualify, and a dimmer one at B's true place that does. B is flagged, moved to the true place (rank 3), its new
    /// chance at or above the 19-in-20 line; nothing else is flagged. A still dimmer spot 1 mm from the true place also
    /// qualifies and must lose: the brightest qualifying spot wins (the brief's own fixture has only one qualifying spot,
    /// so removing the `break` could not fail it).
    #[test] fn the_real_scorer_moves_a_wild_point_to_its_plausible_spot() {
        let s = ShapeScorer::new(crate::shape::synthetic::faces(240, 4));
        let face = crate::shape::synthetic::faces(1, 7).remove(0);
        let b = 5usize;
        let mut pts: Vec<Option<Pt>> = face.iter().map(|q| Some(*q)).collect();
        pts[b] = Some((face[b].0 + 200.0, face[b].1));
        let mut cands = none(); cands[b] = vec![spot((face[b].0 - 300.0, face[b].1), 0.95), spot(face[b], 0.6), spot((face[b].0, face[b].1 + 10.0), 0.4)];
        let o = check(&s, &pts, &cands, &lines()).unwrap();
        eprintln!("{o:?}");
        let m = o.moved.clone().expect("moved");
        assert_eq!((m.point, m.to, m.rank), (b, face[b], 3), "{o:?}");
        assert!(m.tail_before < lines().mv && m.tail_after >= lines().qualify, "{m:?}");
        assert_eq!(o.flagged.iter().map(|f| f.0).collect::<Vec<_>>(), vec![b]);
        assert!(o.reassessed.is_empty() && !o.film_unusual && !o.not_run, "{o:?}");
    }
    /// Worst first by chance, not by index: the later point (8) is the worse one and is the one moved.
    #[test] fn the_worst_is_moved_whatever_its_place_in_the_list() {
        let mut pts = good(); let mut bad = vec![1e-9; 19];
        pts[3] = off(pts[3]); bad[3] = 1e-4;
        pts[8] = off(pts[8]); bad[8] = 1e-7;
        let mut c = none(); c[3] = vec![spot(good()[3], 0.9)]; c[8] = vec![spot(good()[8], 0.9)];
        let o = check(&Fake { good: good(), bad }, &some(&pts), &c, &lines()).unwrap();
        assert_eq!(o.flagged, vec![(8, 1e-7), (3, 1e-4)], "set aside worst first: {o:?}");
        assert_eq!(o.moved.as_ref().map(|m| m.point), Some(8), "{o:?}");
        assert!(o.is_flagged(3) && !o.is_moved(3));
    }
    /// The re-assessment's line is the MOVE line (owner P1): a second point between the lines stays flagged from the
    /// worst-first rounds but is not re-raised by the re-assessment.
    #[test] fn the_re_assessment_reads_the_move_line_not_the_flag_line() {
        let mut pts = good(); let mut bad = vec![1e-9; 19];
        pts[3] = off(pts[3]); bad[3] = 1e-7;
        pts[8] = off(pts[8]); bad[8] = 1e-4;
        let mut c = none(); c[3] = vec![spot(good()[3], 0.9)];
        let o = check(&Fake { good: good(), bad }, &some(&pts), &c, &lines()).unwrap();
        assert!(o.is_moved(3) && o.is_flagged(8) && !o.is_moved(8), "{o:?}");
        assert!(o.reassessed.is_empty(), "1 in 10,000 is not below the move line: {o:?}");
    }
    /// The other side of the 11-point edge: 12 points present is enough, and the check runs (a wild one is flagged).
    #[test] fn twelve_points_present_is_enough() {
        let mut p = good(); p[10] = off(p[10]);
        let mut pts = some(&p); for k in 0..7 { pts[k] = None; }
        let mut bad = vec![1e-9; 19]; bad[10] = 1e-4;
        let o = check(&Fake { good: good(), bad }, &pts, &none(), &lines()).unwrap();
        assert!(!o.not_run && o.is_flagged(10), "{o:?}");
    }
    /// "At least a quarter as bright" on its own (in the brief's fixture `keep` also drops the dim peak, so it could not
    /// tell): SYNTHETIC top 3.0; a peak of exactly 0.75 (a quarter) is kept; one of 0.74 is not, though `keep` has room.
    #[test] fn a_spot_below_a_quarter_of_the_top_is_not_a_candidate() {
        let m = small_spec();
        let g = Geometry::for_input(800, 1000, &m.input);
        let mut h = vec![0f32; 40 * 50];
        for (c, r, v) in [(20, 25, 3.0), (5, 5, 0.74), (30, 10, 0.75)] { h[r * 40 + c] = v; }
        let at = |c: usize, r: usize| { let (u, v) = heatmap_to_input(c as f64, r as f64, 4.0, m.output.heatmap_center); g.to_image(u, v) };
        let s = spots(&h, &m, &g, 800, false, at(20, 25), 0.05, &Candidates { min_mm: 3.0, min_share: 0.25, keep: 4 }).unwrap();
        assert_eq!(s.iter().map(|x| x.brightness).collect::<Vec<_>>(), vec![0.75f32], "{s:?}");
    }
    /// Ruling 1 (27 Oct): the re-assessment's frame leaves out the points the worst-first rounds set aside
    /// (other than the moved one, which now joins it). Here point 12 is fine, but reads 1e-6 (below the move line)
    /// whenever wild point 8 is in its frame. Worst first: 3 (1e-8) then 8 (1e-7) set aside, 12 then clean; 3 moved.
    /// The re-assessment must flag 8 again and leave 12 alone.
    struct Bent { good: Vec<Pt>, bad: Vec<f64> }
    impl Scorer for Bent {
        fn tail(&self, k: usize, used: &[usize], pts: &[Pt], p: Pt) -> anyhow::Result<f64> {
            if k == 12 && used.contains(&8) && dist(pts[8], self.good[8]) > 1e-9 { return Ok(1e-6); }
            Ok(if dist(p, self.good[k]) < 1e-9 { 0.5 } else { self.bad[k] })
        }
    }
    #[test] fn the_re_assessment_leaves_the_set_aside_points_out_of_the_frame() {
        let mut pts = good(); let mut bad = vec![1e-9; 19];
        pts[3] = off(pts[3]); bad[3] = 1e-8;
        pts[8] = off(pts[8]); bad[8] = 1e-7;
        let mut c = none(); c[3] = vec![spot(good()[3], 0.9)];
        let o = check(&Bent { good: good(), bad }, &some(&pts), &c, &lines()).unwrap();
        assert_eq!(o.flagged, vec![(3, 1e-8), (8, 1e-7)], "{o:?}");
        assert!(o.is_moved(3), "{o:?}");
        assert_eq!(o.reassessed, vec![(8, 1e-7)], "a set-aside wild point must not bend the re-assessment of the rest: {o:?}");
        assert!(!o.is_flagged(12), "{o:?}");
    }
    /// Ruling 2: flag counts are over unique points. In the two-wild case 8 is in both lists.
    #[test] fn flagged_points_counts_each_point_once() {
        let mut pts = good(); let mut bad = vec![1e-9; 19];
        pts[3] = off(pts[3]); bad[3] = 1e-7;
        pts[8] = off(pts[8]); bad[8] = 1e-6;
        let mut c = none(); c[3] = vec![spot(good()[3], 0.9)];
        let o = check(&Fake { good: good(), bad }, &some(&pts), &c, &lines()).unwrap();
        assert_eq!((o.flagged.len(), o.reassessed.len()), (2, 1), "8 is in both lists: {o:?}");
        assert_eq!(o.flagged_points(), vec![3, 8]);
        assert_eq!(Outcome::default().flagged_points(), Vec::<usize>::new());
        let r = Outcome { reassessed: vec![(11, 1e-6)], ..o.clone() };
        assert_eq!(r.flagged_points(), vec![3, 8, 11], "a point only the re-assessment found counts too");
    }
    /// Ruling 3: a film with no width or no height is refused, never underflowed or divided by.
    #[test] fn spots_refuse_a_film_with_no_width_or_height() {
        let m = small_spec();
        let mut h = vec![0f32; 40 * 50]; h[25 * 40 + 20] = 3.0; h[5 * 40 + 5] = 1.5;
        let cand = Candidates { min_mm: 3.0, min_share: 0.25, keep: 4 };
        let g = Geometry::for_input(800, 1000, &m.input);
        let e = spots(&h, &m, &g, 0, true, (0.0, 0.0), 0.05, &cand).unwrap_err().to_string();
        assert!(e.contains("width"), "{e}");
        let g0 = Geometry::for_input(800, 0, &m.input);
        let e = spots(&h, &m, &g0, 800, false, (0.0, 0.0), 0.05, &cand).unwrap_err().to_string();
        assert!(e.contains("height"), "{e}");
        assert_eq!(spots(&h, &m, &g, 800, true, (400.0, 500.0), 0.05, &cand).unwrap().len(), 1, "a real film still works");
    }
}
