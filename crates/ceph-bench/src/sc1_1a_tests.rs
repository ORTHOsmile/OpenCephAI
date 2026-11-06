//! SC1-1a's tests (SYNTHETIC faces and folders only; never data/ or models/). Each test names the production change that
//! would make it fail.
use super::*;
use ceph_infer::regions::FoundBox;
use ceph_model::shape::synthetic_faces as faces;
use ceph_model::wholefilm::calibration_json;
use std::sync::{Mutex, OnceLock};

// ---- SC-1 Part 1b Task E (M17, M20) ----

/// The seeded draws at SC1-1a's seed are SC1-1a's own, bit for bit, over 20 films x 5 regions (and the shift's over 20
/// films x both shifts); another seed gives other draws. Fails if: the seed argument is ignored (then the second half
/// fails), or the seeded form draws from another stream than `p4_draw` (the first half).
#[test] fn seeded_draws_equal_sc1_1a_at_its_seed() {
    let mut same = 0;
    for i in 0..20 {
        for r in REGIONS {
            let (a, b) = (p4_draw_seeded(SEED, i, r), p4_draw(i, r));
            assert!(a.0.to_bits() == b.0.to_bits() && a.1.0.to_bits() == b.1.0.to_bits() && a.1.1.to_bits() == b.1.1.to_bits(), "film {i} {r:?}: {a:?} vs {b:?}");
            if p4_draw_seeded(SEED + 1, i, r) == a { same += 1 }
        }
        for mm in SHIFTS_MM {
            let (a, b) = (shift_draw_seeded(SEED, i, mm), shift_draw(i, mm));
            assert!(a.0.to_bits() == b.0.to_bits() && a.1.to_bits() == b.1.to_bits(), "film {i} {mm} mm");
            assert_ne!(shift_draw_seeded(20261108, i, mm), a, "film {i} {mm} mm: another seed, the same direction");
        }
    }
    eprintln!("p4 draws equal at SEED + 1: {same} of 100 (expected 0)");
    assert_eq!(same, 0, "another seed gave the same P4 draw");
    let (d, u) = p4_draw_seeded(20261108, 0, Region::Maxilla);
    assert!((10.0..20.0).contains(&d) && (u.0.hypot(u.1) - 1.0).abs() < 1e-12, "{d} {u:?}");
}

/// `check_with` at τ only is `check` (fails if: it passes another facing, another tracing or other boxes); it refuses
/// homework under either name, bare id or `ceph400:` name (fails if: the guard is dropped or compares bare ids, M16).
#[test] fn check_with_is_check_and_refuses_homework_by_both_names() {
    let c = control_cases();
    let (f, r) = (&c.0[0], &c.1);
    for pts in [f.pts.clone(), scaled(&f.pts, 2.0), mirror_film(&f.pts, f.w)] {
        assert_eq!(check_with(f, &pts, &r.whole, &FilmCal::tau_only(&TAU)).unwrap(), check(f, &pts, r, &TAU).unwrap());
    }
    let bare = WholeScorer::from_prior(prior()).unwrap();
    let e = check_with(f, &f.pts, &bare, &FilmCal::tau_only(&TAU)).unwrap_err().to_string();
    eprintln!("bare-named reference holding the film: {e}");
    assert!(e.contains("homework"), "{e}");
    let names: Vec<String> = prior().names.iter().map(|n| format!("ceph400:{n}")).collect();
    let r2 = ceph_model::wholefilm::Reference { sha256: "SYNTHETIC".into(), names: names.clone(), tracings: prior().tracings.clone(), lines: vec![] };
    let prefixed = WholeScorer::from_reference(&r2).unwrap();
    let e = check_with(f, &f.pts, &prefixed, &FilmCal::tau_only(&TAU)).unwrap_err().to_string();
    eprintln!("prefixed reference holding ceph400:{}: {e}", f.id);
    assert!(e.contains("homework"), "{e}");
    let out = prefixed.leave_out_names(&[format!("ceph400:{}", f.id)]).unwrap();
    assert!(check_with(f, &f.pts, &out, &FilmCal::tau_only(&TAU)).is_ok(), "with its own name left out the film is judged");
}

/// The pre-registration's SHA-256, pinned when it was committed alone (9a0163b, before any SC1-1a code or run).
const PINNED_SHA256: &str = "26cc74f72fea63fab2807bef44479b78314bc892c3076e38a2e0ac2be5e6e706";
pub(crate) const FP: &str = "17171e68f9f7072062e2a3a2cbd4851618056f5136bed998f1782c49d4897b80";
const GATE_SHA: &str = "db1a67a0a1761ad5463ba64ff338be00423a3ae73f097009b7ab091919f9eae7";
pub(crate) const TAU2: [f64; 5] = [0.09, 0.02, 0.02, 0.01, 0.1];
const TAU1: [f64; 5] = [0.09, 0.01, 0.01, 0.01, 0.01];
const TAU: RegionTau = RegionTau(TAU2);
pub(crate) const W: u32 = 2000;
pub(crate) const H: u32 = 2400;

pub(crate) fn ids(r: std::ops::RangeInclusive<u32>) -> Vec<String> { r.map(|i| format!("{i:03}")).collect() }
pub(crate) fn named(pts: &[Pt]) -> Vec<(String, f64, f64)> { ORDER.iter().zip(pts).map(|(n, p)| (n.to_string(), p.0, p.1)).collect() }
/// The tracing's own teaching boxes as the detector's (score 0.9), at score line 0.5.
pub(crate) fn own(pts: &[Pt]) -> Regions {
    let b: Vec<_> = teaching_boxes(&named(pts), W, H).into_iter().map(|b| ceph_model::wholefilm::RegionBox { score: 0.9, ..b }).collect();
    Regions::from_scored(&b, 0.5, FP).unwrap()
}
/// 300 SYNTHETIC tracings named 001-300, as the shipped file names Train and Test1.
pub(crate) fn prior() -> &'static Prior {
    static P: OnceLock<Prior> = OnceLock::new();
    P.get_or_init(|| Prior { sha256: "SYNTHETIC".into(), films: 300, names: ids(1..=300), tracings: faces(300, 7) })
}
pub(crate) fn tracing_of(name: &str) -> Vec<Pt> { let p = prior(); p.tracings[p.names.iter().position(|n| n == name).unwrap()].clone() }
fn film(id: &str, dataset: Dataset, fold: Option<usize>, pts: Vec<Pt>, mm: Option<f64>) -> Film {
    Film { id: id.into(), dataset, fold, regions: own(&pts), pts, w: W, h: H, mm_per_px: mm }
}
fn test1_film(name: &str, fold: usize) -> Film { film(name, Dataset::Ceph400, Some(fold), tracing_of(name), Some(CEPH400_MM_PER_PX)) }
/// Ten Test1 films (151-160, folds of two) and their fold's reference set (the 298 others).
fn control_cases() -> &'static (Vec<Film>, RefSet) {
    static C: OnceLock<(Vec<Film>, RefSet)> = OnceLock::new();
    C.get_or_init(|| {
        let names = ids(151..=160);
        (names.iter().map(|n| test1_film(n, 0)).collect(), RefSet::new(prior(), &names).unwrap())
    })
}
fn pairs<'a>(c: &'a (Vec<Film>, RefSet)) -> Vec<(&'a Film, &'a RefSet)> { c.0.iter().map(|f| (f, &c.1)).collect() }

// ---- the pre-registration ----

/// Fails if reference/sc1-1a.json changes by one byte after its commit.
#[test] fn the_preregistration_is_pinned() {
    assert_eq!(ft_common::sha256_hex(PREREG.as_bytes()), PINNED_SHA256, "reference/sc1-1a.json changed: the owner's OK, then a new version");
}

fn nulls(v: &serde_json::Value, at: &str, out: &mut Vec<String>) {
    match v {
        serde_json::Value::Null => out.push(at.to_string()),
        serde_json::Value::Array(a) => for (i, x) in a.iter().enumerate() { nulls(x, &format!("{at}[{i}]"), out) },
        serde_json::Value::Object(o) => for (k, x) in o { nulls(x, &format!("{at}.{k}"), out) },
        _ => {}
    }
}
/// No null left; the four gate values, the calibration rule and the marks are the program's; the I1 disclosure is there.
/// Fails if a value is left null, if a pin differs from the gate /2 report's, or if a mark moves.
#[test] fn the_preregistration_is_complete() {
    let v: serde_json::Value = serde_json::from_str(PREREG).unwrap();
    let mut n = vec![];
    nulls(&v, "$", &mut n);
    assert!(n.is_empty(), "nulls left: {n:?}");
    assert_eq!(v["version"], VERSION);
    assert_eq!(Pins::from_prereg().unwrap(), Pins { fingerprint: FP.into(), gate_report_sha256: GATE_SHA.into(), score_line: 0.5, tau: TAU2, rule: "sc1-box-gate/2".into() });
    let m = &v["marks"];
    assert_eq!((m["planted"].as_u64(), m["needed"].as_u64(), m["normal"].as_u64(), m["falseAlarmMax"].as_u64()),
        (Some(PLANTED as u64), Some(NEEDED as u64), Some(NORMAL as u64), Some(FALSE_MAX as u64)));
    assert_eq!(v["plants"]["seed"].as_u64(), Some(SEED));
    assert!(v["shape"]["folds"].as_str().unwrap().contains(&FOLD_SEED.to_string()));
    assert!(v["regions"]["gateReport"].as_str().unwrap().contains("reports/sc1/box-gate-2.json"));
    assert!(v["disclosure"][0].as_str().unwrap().starts_with("SC1-1a's normal films were passed through the region finder once, by sc1-box-gate/1's information table (box agreement only, no flags computed); no threshold was set from them."));
    assert!(v["definitions"]["salts"].as_str().unwrap().contains("400 + fold index") && v["definitions"]["salts"].as_str().unwrap().contains("1 for Aariz valid"));
    assert_eq!((SALT_CEPH400, SALT_AARIZ, T_P4, T_SHIFT, T_CONTROL), (400, 1, 5, 6, 9));
}

/// Fails if the marks are computed in floating point or the totals change.
#[test] fn the_totals_are_whole_numbers() {
    assert_eq!((19 * 2740 + 19) / 20, 2603);
    assert_eq!(2 * 300 / 100, 6);
    assert_eq!(300 + 300 + 300 + 600 + 248 * 5, 2740);
    assert_eq!(Marks::real(), Marks { test1: 150, valid: 150, scaled_valid: 98, planted: 2740, needed: 2603, normal: 300, false_max: 6 });
    assert_eq!((needed_of(2740), needed_of(20), needed_of(21), needed_of(1)), (2603, 19, 20, 1), "ceil(19 n / 20)");
    assert_eq!((false_max_of(300), false_max_of(349), false_max_of(350)), (6, 6, 7), "floor(2 n / 100)");
    assert_eq!(Marks::for_films(10, 10, 5), Marks { test1: 10, valid: 10, scaled_valid: 5, planted: 175, needed: 167, normal: 20, false_max: 0 });
}

/// Fails if the seed, the sort, the fold size or the order of positions changes.
#[test] fn folds_are_five_of_thirty_seeded_and_disjoint() {
    let t1 = ids(151..=300);
    let f = folds(&t1);
    assert_eq!(f.iter().map(|x| x.len()).collect::<Vec<_>>(), vec![30; 5]);
    let all: BTreeSet<&String> = f.iter().flatten().collect();
    assert_eq!(all.len(), 150);
    assert!(t1.iter().all(|id| all.contains(id)));
    let mut want = t1.clone();
    shuffle(&mut want, &mut Rng::new(FOLD_SEED));
    assert_eq!(f.concat(), want, "positions 30i..30i+29 of the sorted ids shuffled with seed 20261103");
    let mut rev = t1.clone(); rev.reverse();
    assert_eq!(folds(&rev), f, "sorted first: the input order does not matter");
    let mut other = t1.clone(); shuffle(&mut other, &mut Rng::new(FOLD_SEED + 1));
    assert_ne!(other, want);
    eprintln!("fold 0 starts {:?}", &f[0][..3]);
}

/// Fails if a film can keep its own tracing, the permutation has two cycles, or the salt is ignored.
#[test] fn the_derangement_leaves_no_film_its_own_tracing() {
    for n in [30usize, 150, 2] {
        let v: Vec<String> = (0..n).map(|i| format!("SYNTHETIC-{i}")).collect();
        let d = derangement(&v, SEED, SALT_AARIZ);
        let mut seen = d.clone(); seen.sort();
        assert_eq!(seen, (0..n).collect::<Vec<_>>(), "a permutation");
        assert!(d.iter().enumerate().all(|(i, j)| i != *j), "no film keeps its own tracing");
        let (mut at, mut steps) = (0, 0);
        loop { at = d[at]; steps += 1; if at == 0 { break } }
        assert_eq!(steps, n, "one cycle through all {n}");
        assert_eq!(derangement(&v, SEED, SALT_AARIZ), d, "seeded");
        if n > 2 { assert_ne!(derangement(&v, SEED, SALT_CEPH400), d, "the salt changes it"); }
    }
    let mut r = Rng::new(SEED ^ SALT_CEPH400);
    let mut p: Vec<usize> = (0..30).collect();
    for i in (1..30).rev() { let j = r.below(i); p.swap(i, j); }
    assert_eq!(derangement(&ids(1..=30), SEED, SALT_CEPH400), p, "Sattolo with Rng(seed ^ salt), as pre-registered");
}

/// Fails if the control films are not the first 10 of the seeded shuffle of the sorted Test1 ids.
#[test] fn the_control_films_are_ten_seeded_test1_films() {
    let t1 = ids(151..=300);
    let c = control_films(&t1);
    let mut want = t1.clone();
    shuffle(&mut want, &mut case_rng(SEED, &[T_CONTROL]));
    assert_eq!(c, want[..10].to_vec());
    let mut rev = t1.clone(); rev.reverse();
    assert_eq!(control_films(&rev), c);
}

// ---- plants ----

/// Fails if a plant's geometry is not the pre-registered one (the mirror width, the centroid, the region moved, the
/// distance range or its conversion to pixels).
#[test] fn each_plant_moves_the_points_as_pre_registered() {
    let p = tracing_of("151");
    let c = centroid(&p);
    assert!(((c.0 - p.iter().map(|q| q.0).sum::<f64>() / 19.0).abs() < 1e-9) && ((c.1 - p.iter().map(|q| q.1).sum::<f64>() / 19.0).abs() < 1e-9));
    for (a, b) in p.iter().zip(mirror_film(&p, W)) { assert_eq!((b.0, b.1), ((W as f64 - 1.0) - a.0, a.1)); }
    for (a, b) in p.iter().zip(mirror_in_place(&p)) { assert!((b.0 - (2.0 * c.0 - a.0)).abs() < 1e-9 && b.1 == a.1); }
    for k in [0.5, 2.0] {
        let s = scaled(&p, k);
        let cs = centroid(&s);
        assert!((cs.0 - c.0).abs() < 1e-9 && (cs.1 - c.1).abs() < 1e-9, "about the centroid");
        for (a, b) in p.iter().zip(&s) { assert!((b.0 - (c.0 + k * (a.0 - c.0))).abs() < 1e-9 && (b.1 - (c.1 + k * (a.1 - c.1))).abs() < 1e-9); }
    }
    let m = moved(&p, Some(Region::Mandible), 400.0, -10.0);
    for (k, (a, b)) in p.iter().zip(&m).enumerate() {
        let mand = REGION_OF.iter().any(|(n, r)| *n == ORDER[k] && *r == Region::Mandible);
        assert_eq!(*b, if mand { (a.0 + 400.0, a.1 - 10.0) } else { *a }, "{}", ORDER[k]);
    }
    assert_eq!(moved(&p, None, 3.0, 4.0), p.iter().map(|q| (q.0 + 3.0, q.1 + 4.0)).collect::<Vec<_>>());
    let mut ds = vec![];
    for i in 0..300 { for r in REGIONS {
        let (d, u) = p4_draw(i, r);
        assert!((10.0..20.0).contains(&d), "{d}");
        assert!((u.0.hypot(u.1) - 1.0).abs() < 1e-12);
        ds.push(d);
    } }
    assert_eq!(p4_draw(7, Region::Maxilla), p4_draw(7, Region::Maxilla));
    assert_ne!(p4_draw(7, Region::Maxilla), p4_draw(7, Region::Mandible));
    let mut r = case_rng(SEED, &[T_P4, 7, Region::Maxilla.index() as u64]);
    let u = (r.next() >> 11) as f64 / (1u64 << 53) as f64;
    assert_eq!(p4_draw(7, Region::Maxilla), (10.0 + 10.0 * u, direction(&mut r)), "u first, then the direction, on case_rng(seed, [5, film, region])");
    assert_eq!(shift_draw(3, 20), direction(&mut case_rng(SEED, &[T_SHIFT, 3, 20])));
    eprintln!("P4 distances: min {:.2} max {:.2} mm", ds.iter().cloned().fold(f64::MAX, f64::min), ds.iter().cloned().fold(0.0, f64::max));
}

/// SYNTHETIC: 10 Test1 films (5 folds of 2) and 10 Aariz valid films (5 with a scale).
fn small_set() -> (Vec<Film>, Vec<Vec<String>>) {
    let t1 = ids(151..=160);
    let f = folds(&t1);
    let fold_of = |id: &str| f.iter().position(|x| x.iter().any(|y| y == id)).unwrap();
    let mut films: Vec<Film> = t1.iter().map(|id| test1_film(id, fold_of(id))).collect();
    for (i, pts) in faces(10, 99).into_iter().enumerate() {
        films.push(film(&format!("va-{i:04}"), Dataset::Aariz, None, pts, if i < 5 { Some(0.12) } else { None }));
    }
    (films, f)
}

/// The plant counts per type, P2 within the fold (Test1) or the dataset (Aariz) and never the film's own, P4 only on
/// scaled films with the distance in that film's pixels. Fails if any plant is made on the wrong films or by the wrong rule.
#[test] fn plants_are_counted_per_type_and_p2_stays_in_the_fold() {
    let (films, f) = small_set();
    let ps = plants(&films, &f).unwrap();
    let n = |k: Kind| ps.iter().filter(|p| p.kind == k).count();
    assert_eq!((n(Kind::P1a), n(Kind::P1b), n(Kind::P2), n(Kind::P3Half), n(Kind::P3Double), n(Kind::N)), (20, 20, 20, 20, 20, 20));
    for r in REGIONS { assert_eq!(n(Kind::P4(r)), 15, "{r:?}: 10 Test1 + 5 scaled Aariz"); }
    assert_eq!(ps.len(), Marks::for_films(10, 10, 5).planted + 20);
    for p in &ps {
        let film = &films[p.film];
        match p.kind {
            Kind::P1a => assert_eq!(p.pts, mirror_film(&film.pts, film.w)),
            Kind::P1b => assert_eq!(p.pts, mirror_in_place(&film.pts)),
            Kind::P3Half => assert_eq!(p.pts, scaled(&film.pts, 0.5)),
            Kind::P3Double => assert_eq!(p.pts, scaled(&film.pts, 2.0)),
            Kind::N => assert_eq!(p.pts, film.pts),
            Kind::P2 => {
                let src = films.iter().position(|g| g.pts == p.pts).expect("another film's tracing as it is");
                assert_ne!(src, p.film, "never its own");
                assert_eq!(films[src].dataset, film.dataset);
                if film.dataset == Dataset::Ceph400 { assert_eq!(films[src].fold, film.fold, "within the same Test1 fold"); }
            }
            Kind::P4(r) => {
                let mm = film.mm_per_px.expect("P4 only on films with a scale");
                let (d, u) = p4_draw(p.film, r);
                assert_eq!(p.pts, moved(&film.pts, Some(r), d / mm * u.0, d / mm * u.1));
            }
            Kind::Shift(_) => panic!("no information shift among the plants"),
        }
    }
    for (k, fold) in f.iter().enumerate() {
        let d = derangement(fold, SEED, SALT_CEPH400 + k as u64);
        for (i, id) in fold.iter().enumerate() {
            let at = films.iter().position(|g| &g.id == id).unwrap();
            let p2 = ps.iter().find(|p| p.film == at && p.kind == Kind::P2).unwrap();
            assert_eq!(p2.pts, films.iter().find(|g| g.id == fold[d[i]]).unwrap().pts, "fold {k}: salt 400 + {k}, over the fold's ids in fold order");
        }
    }
    // Folds of 2 have one derangement whatever the salt, so the salt per fold is checked on 30 Test1 films (folds of 6),
    // where the fixture itself shows that the salts give different derangements (else this check could not fail).
    let t30 = ids(151..=180);
    let f30 = folds(&t30);
    assert!(f30.iter().enumerate().any(|(k, fold)| derangement(fold, SEED, SALT_CEPH400 + k as u64) != derangement(fold, SEED, SALT_CEPH400)),
        "the fixture must tell the salts apart");
    let films30: Vec<Film> = t30.iter().map(|id| test1_film(id, f30.iter().position(|x| x.contains(id)).unwrap())).collect();
    let ps30 = plants(&films30, &f30).unwrap();
    for (k, fold) in f30.iter().enumerate() {
        let d = derangement(fold, SEED, SALT_CEPH400 + k as u64);
        for (i, id) in fold.iter().enumerate() {
            let at = films30.iter().position(|g| &g.id == id).unwrap();
            assert_eq!(ps30.iter().find(|p| p.film == at && p.kind == Kind::P2).unwrap().pts, tracing_of(&fold[d[i]]), "folds of 6: fold {k} uses salt 400 + {k}");
        }
    }
    let az: Vec<String> = films.iter().filter(|g| g.dataset == Dataset::Aariz).map(|g| g.id.clone()).collect();
    for (i, j) in derangement(&az, SEED, SALT_AARIZ).into_iter().enumerate() {
        let at = films.iter().position(|g| g.id == az[i]).unwrap();
        assert_eq!(ps.iter().find(|p| p.film == at && p.kind == Kind::P2).unwrap().pts, films.iter().find(|g| g.id == az[j]).unwrap().pts, "Aariz: salt 1");
    }
    let sh = info_shifts(&films).unwrap();
    assert_eq!(sh.len(), 2 * 15);
    for p in &sh {
        let Kind::Shift(mm) = p.kind else { panic!() };
        let film = &films[p.film];
        let u = shift_draw(p.film, mm);
        let px = mm as f64 / film.mm_per_px.unwrap();
        assert_eq!(p.pts, moved(&film.pts, None, px * u.0, px * u.1));
    }
}

/// The reference sets: a fold's leaves out exactly its films, by name; an unknown name is refused; a Test1 film gets its
/// fold's, an Aariz film all 300. Fails if the wrong set is handed to a film.
#[test] fn each_film_is_judged_by_its_folds_reference_set() {
    let (films, f) = small_set();
    let refs = Refs::new(prior(), &f).unwrap();
    for (i, r) in refs.folds.iter().enumerate() {
        assert_eq!((r.whole.films(), r.stage_a.films()), (298, 298));
        assert!(f[i].iter().all(|id| !r.whole.names().contains(id)));
    }
    assert_eq!(refs.all.whole.films(), 300);
    for film in &films {
        let r = refs.of(film);
        match film.fold { Some(k) => assert!(std::ptr::eq(r, &refs.folds[k])), None => assert!(std::ptr::eq(r, &refs.all)) }
    }
    assert!(RefSet::new(prior(), &["999".to_string()]).is_err(), "a name not in the file");
}

// ---- controls: each made to fail on purpose ----

/// The film with its `r` box shrunk to 0.3 of its size about its centre (so its untouched points read outside), or removed.
fn spoiled(f: &Film, r: Region, remove: bool) -> Film {
    let mut g = f.clone();
    if remove { g.regions.boxes.retain(|b| b.region != r) } else { for b in g.regions.boxes.iter_mut().filter(|b| b.region == r) { *b = b.inflated(0.3) } }
    g
}

/// C1: fails if the mirror step is removed (0 of 50) or the shape look stops seeing a mirrored face.
#[test] fn c1_sees_50_mirrored_faces_and_not_without_the_mirror() {
    let c = c1(&|p: &[Pt], w: u32| mirror_film(p, w), &TAU).unwrap();
    eprintln!("C1: {c:?}");
    assert!(c.holds && c.got.starts_with("50 of 50"), "{c:?}");
    let c = c1(&|p: &[Pt], _| p.to_vec(), &TAU).unwrap();
    eprintln!("C1 without the mirror: {c:?}");
    assert!(!c.holds && c.got.starts_with("0 of 50"), "{c:?}");
    let c = c1(&|p: &[Pt], _| { let mut q = p.to_vec(); q[7].0 += 600.0; q }, &TAU).unwrap();
    eprintln!("C1 with Me moved 60 mm instead of a mirror (flagged, not mirrored): {c:?}");
    assert!(!c.holds && c.got.starts_with("0 of 50"), "only the mirrored reason counts: {c:?}");
    let first = ceph_model::shape::synthetic_faces(C1_JUDGED.0, C1_JUDGED.1)[0].clone();
    let c = c1(&move |p: &[Pt], w: u32| if p == first.as_slice() { p.to_vec() } else { mirror_film(p, w) }, &TAU).unwrap();
    eprintln!("C1 with one face not mirrored: {c:?}");
    assert!(!c.holds && c.got.starts_with("49 of 50"), "{c:?}");
}
/// C2: fails if the factor is lost (x1: not 10 of 10).
#[test] fn c2_needs_ten_of_ten_at_x2_and_fails_at_x1() {
    let cc = control_cases();
    let c = c2(&pairs(cc), C2_FACTOR, &TAU).unwrap();
    eprintln!("C2 x2: {c:?}");
    assert!(c.holds, "{c:?}");
    let c = c2(&pairs(cc), 1.0, &TAU).unwrap();
    eprintln!("C2 x1: {c:?}");
    assert!(!c.holds, "{c:?}");
    let all_flagged: Vec<Film> = cc.0.iter().map(|f| spoiled(f, Region::Maxilla, false)).collect();
    let c = c2(&all_flagged.iter().map(|f| (f, &cc.1)).collect::<Vec<_>>(), C2_FACTOR, &TAU).unwrap();
    eprintln!("C2 when the untouched tracings are all flagged too: {c:?}");
    assert!(!c.holds, "the plant must be what moved: {c:?}");
    let c = c2(&pairs(cc)[..9], C2_FACTOR, &TAU).unwrap();
    assert!(!c.holds, "9 films are not the 10: {c:?}");
}
/// C3: fails if the shift is lost (0 mm) or another region than the mandible is credited.
#[test] fn c3_needs_the_mandible_flag_at_40_mm_and_fails_at_0() {
    let cc = control_cases();
    let c = c3(&pairs(cc), C3_SHIFT_MM, &TAU).unwrap();
    eprintln!("C3 40 mm: {c:?}");
    assert!(c.holds, "{c:?}");
    let c = c3(&pairs(cc), 0.0, &TAU).unwrap();
    eprintln!("C3 0 mm: {c:?}");
    assert!(!c.holds, "{c:?}");
    // Nine films whose mandible box is missing and whose maxilla box is shrunk: after the shift they are flagged, but in
    // the maxilla, not the mandible. Only the tenth gives a mandible flag, so C3 must not hold.
    let mixed: Vec<Film> = cc.0.iter().enumerate().map(|(i, f)| if i < 9 { spoiled(&spoiled(f, Region::Mandible, true), Region::Maxilla, false) } else { f.clone() }).collect();
    let c = c3(&mixed.iter().map(|f| (f, &cc.1)).collect::<Vec<_>>(), C3_SHIFT_MM, &TAU).unwrap();
    eprintln!("C3 when nine films flag the maxilla instead: {c:?}");
    assert!(!c.holds && c.got.starts_with("1 of 10"), "{c:?}");
    let all_flagged: Vec<Film> = cc.0.iter().map(|f| spoiled(f, Region::Maxilla, false)).collect();
    let c = c3(&all_flagged.iter().map(|f| (f, &cc.1)).collect::<Vec<_>>(), C3_SHIFT_MM, &TAU).unwrap();
    eprintln!("C3 when the untouched tracings are all flagged too: {c:?}");
    assert!(!c.holds, "{c:?}");
    let fine: Vec<Film> = cc.0.iter().map(|f| Film { mm_per_px: Some(0.01), ..f.clone() }).collect();
    let c = c3(&fine.iter().map(|f| (f, &cc.1)).collect::<Vec<_>>(), C3_SHIFT_MM, &TAU).unwrap();
    eprintln!("C3 at 0.01 mm/px (40 mm = 4000 px): {c:?}");
    assert!(c.holds, "the shift is in the film's own pixels: {c:?}");
}
/// C4: fails if the flip is skipped (the same boxes twice) or a missing facing counts as flipped.
#[test] fn c4_needs_the_detectors_facing_to_flip_on_every_film() {
    let films = &control_cases().0;
    let flipped: Vec<(Regions, Regions)> = films.iter().map(|f| (f.regions.clone(), own(&mirror_film(&f.pts, W)))).collect();
    let c = c4(&flipped);
    eprintln!("C4: {c:?}");
    assert!(c.holds && c.got.starts_with("10 of 10"), "{c:?}");
    let skipped: Vec<(Regions, Regions)> = films.iter().map(|f| (f.regions.clone(), f.regions.clone())).collect();
    let c = c4(&skipped);
    eprintln!("C4 flip skipped: {c:?}");
    assert!(!c.holds && c.got.starts_with("0 of 10"), "{c:?}");
    let mut none = flipped.clone();
    none[3].1.facing_left = None;
    assert!(!c4(&none).holds, "a facing the detector could not read is not a flip");
    assert!(!c4(&flipped[..9]).holds, "9 films are not the 10");
}
/// C5: the held-back folders are refused; with folders not named as the datasets the refusal cannot fire, so C5 does
/// not hold. Also a Test1 list naming a Test2 film is refused. Fails if the held-back check is removed.
#[test] fn c5_refuses_test2_and_aariz_test() {
    let d = tempfile::tempdir().unwrap();
    let (c4, az) = (d.path().join("ceph400"), d.path().join("aariz"));
    for p in [&c4, &az] { std::fs::create_dir_all(p).unwrap(); }
    let c = c5(&c4, &az);
    eprintln!("C5: {c:?}");
    assert!(c.holds, "{c:?}");
    let e = ledger::refuse_held_back(&c4, "test2").unwrap_err().to_string();
    eprintln!("test2 folder: {e}");
    let (x, y) = (d.path().join("c4x"), d.path().join("azx"));
    for p in [&x, &y] { std::fs::create_dir_all(p).unwrap(); }
    let c = c5(&x, &y);
    eprintln!("C5 on folders that are not the datasets: {c:?}");
    assert!(!c.holds);
    let (mx, my) = (d.path().join("missing").join("ceph400"), d.path().join("missing").join("aariz"));
    let c = c5(&mx, &my);
    eprintln!("C5 on folders that do not exist: {c:?}");
    assert!(!c.holds, "an error that is not a held-back refusal is not C5");
    let mut l = ids(151..=300); l[4] = "301".into();
    let e = sc1_gate::refuse_outside_test1(&l).unwrap_err().to_string();
    eprintln!("a Test1 list naming 301: {e}");
    assert!(e.contains("Test2"), "{e}");
}
/// C6: a film judged by a reference set holding its own tracing is refused (nothing reported); the control holds on a
/// Test1 film and cannot hold on a film the file does not name. Fails if the homework guard is removed from `check`.
#[test] fn c6_refuses_a_film_in_its_own_reference_set() {
    let f = test1_film("155", 0);
    let full = RefSet::new(prior(), &[]).unwrap();
    let e = check(&f, &f.pts, &full, &TAU).unwrap_err().to_string();
    eprintln!("Test1 film 155 judged by all 300: {e}");
    assert!(e.contains("homework"), "{e}");
    assert!(stage_a(&f, &f.pts, &full).unwrap_err().to_string().contains("homework"), "Stage A's information too");
    let c = c6(&f, prior(), &TAU);
    eprintln!("C6: {c:?}");
    assert!(c.holds, "{c:?}");
    let stranger = film("SYNTHETIC-va", Dataset::Aariz, None, tracing_of("155"), None);
    assert!(!c6(&stranger, prior(), &TAU).holds, "the guard cannot fire on a film the file does not hold");
    let small = Prior { sha256: "SYNTHETIC".into(), films: 10, names: ids(151..=160), tracings: faces(10, 7) };
    assert!(!c6(&f, &small, &TAU).holds, "an error that is not the homework refusal is not C6");
    // Through the judging of the plants: a fold list that leaves film 155 in its own fold's set is refused.
    let (films, f5) = small_set();
    let mut wrong = f5.clone();
    let k = films.iter().find(|g| g.id == "155").unwrap().fold.unwrap();
    wrong[k].retain(|id| id != "155");
    let refs = Refs::new(prior(), &wrong).unwrap();
    let e = judge_all(&films, &plants(&films, &f5).unwrap(), &refs, &TAU).unwrap_err().to_string();
    eprintln!("film 155 left in its own fold's reference set: {e}");
    assert!(e.contains("homework") && e.contains("155"), "{e}");
}

/// M16 (Task B). The 1,000-tracing reference names its tracings with their dataset (`ceph400:151`), so the homework
/// guard must check the judged film under both names. A SYNTHETIC reference with prefixed names holding `ceph400:151`
/// judges Ceph-400 Test1 film 151: refused as homework, by the whole-film check and Stage A's information alike. An
/// Aariz film whose bare id is also "151", judged by the same reference, is NOT refused (its name is aariz:151). Fails if
/// `check_marks` or `stage_a` compares the bare id only (today's code before Task B), or matches names without their
/// prefix.
#[test] fn homework_is_refused_under_the_prefixed_name() {
    let p = prior();
    let names: Vec<String> = p.names.iter().map(|n| format!("ceph400:{n}")).collect();
    let r = ceph_model::wholefilm::Reference { sha256: "SYNTHETIC".into(), names, tracings: p.tracings.clone(), lines: vec![] };
    let set = RefSet { whole: WholeScorer::from_reference(&r).unwrap(), stage_a: ShapeScorer::new(p.tracings.clone()) };
    let f = test1_film("151", 0);
    let e = check(&f, &f.pts, &set, &TAU).unwrap_err().to_string();
    eprintln!("Test1 film 151 judged by a prefixed reference holding ceph400:151: {e}");
    assert!(e.contains("homework") && e.contains("ceph400:151"), "{e}");
    let e = stage_a(&f, &f.pts, &set).unwrap_err().to_string();
    assert!(e.contains("homework"), "Stage A's information too: {e}");
    // The negative control (review F3): the SAME reference, which holds ceph400:151, judging an Aariz film whose bare id is
    // also "151" (aariz:151): not homework. Fails if the guard matches names without their dataset (a prefix stripped).
    let aariz_151 = film("151", Dataset::Aariz, None, tracing_of("151"), None);
    let ok = check(&aariz_151, &aariz_151.pts, &set, &TAU);
    eprintln!("an Aariz film with the bare id 151 against a reference holding ceph400:151: {:?}", ok.as_ref().map(|x| &x.check));
    assert!(ok.is_ok(), "{ok:?}");
    assert!(stage_a(&aariz_151, &aariz_151.pts, &set).is_ok(), "Stage A's information too");
    assert_eq!((Dataset::Ceph400.reference_key(), Dataset::Aariz.reference_key()), ("ceph400", "aariz"));
}

fn result(flagged: bool) -> FilmResult {
    FilmResult { check: if flagged { FilmCheck::Flagged { reasons: vec![Reason::Facing] } } else { FilmCheck::Clean }, shape_look: Look::Judged, region_look: Look::Judged, shape: None, present: 19, size: None, size_look: ceph_model::wholefilm::ExtraLook::NotSetUp, cb: None, cb_look: ceph_model::wholefilm::ExtraLook::NotSetUp }
}
/// A full set of cases for `m`: the first `caught` planted ones flagged, the first `false_alarms` normal ones flagged.
fn full_cases(m: &Marks, caught: usize, false_alarms: usize) -> Vec<Case> {
    let mut v = vec![];
    let per = |ds: Dataset, n: usize, kinds: &[Kind], v: &mut Vec<Case>| for k in kinds { for _ in 0..n { v.push(Case { kind: *k, dataset: ds, result: result(false), stage_a: false }) } };
    let five = [Kind::P1a, Kind::P1b, Kind::P2, Kind::P3Half, Kind::P3Double];
    per(Dataset::Ceph400, m.test1, &five, &mut v);
    per(Dataset::Aariz, m.valid, &five, &mut v);
    let p4: Vec<Kind> = REGIONS.iter().map(|r| Kind::P4(*r)).collect();
    per(Dataset::Ceph400, m.test1, &p4, &mut v);
    per(Dataset::Aariz, m.scaled_valid, &p4, &mut v);
    for c in v.iter_mut().take(caught) { c.result = result(true); }
    let mut n = vec![];
    per(Dataset::Ceph400, m.test1, &[Kind::N], &mut n);
    per(Dataset::Aariz, m.valid, &[Kind::N], &mut n);
    for c in n.iter_mut().take(false_alarms) { c.result = result(true); }
    v.extend(n);
    v
}
/// C7: every count is its expected total; one plant missing, one too many, or a type that counted nothing stops the run.
/// Fails if a count check is dropped.
#[test] fn c7_one_plant_missing_is_an_error() {
    let m = Marks::real();
    let all = full_cases(&m, 2740, 0);
    let c = count(&all, &m).unwrap();
    assert_eq!((c.caught, c.planted, c.false_alarms, c.normal), (2740, 2740, 0, 300));
    assert_eq!(c.lines.len(), 10, "P1a, P1b, P2, P3 x0.5, P3 x2, P4 by region");
    assert_eq!(c.normal_lines.len(), 2, "N by dataset");
    let mut less = all.clone();
    less.remove(17);
    let e = count(&less, &m).unwrap_err().to_string();
    eprintln!("one plant missing: {e}");
    assert!(e.contains("compared 299, expected 300") || e.contains("compared 2739"), "{e}");
    let mut more = all.clone();
    more.push(all[0].clone());
    assert!(count(&more, &m).is_err(), "one too many");
    let mut moved = all.clone();
    moved.iter_mut().filter(|c| c.kind == Kind::P4(Region::Incisors)).for_each(|c| c.kind = Kind::P4(Region::Maxilla));
    let e = count(&moved, &m).unwrap_err().to_string();
    eprintln!("a type that counted nothing: {e}");
    let mut sh = all.clone();
    sh.push(Case { kind: Kind::Shift(10), ..all[0].clone() });
    let mut swapped = all.clone();
    swapped[0].dataset = Dataset::Aariz;
    let e = count(&swapped, &m).unwrap_err().to_string();
    eprintln!("one P1a moved from Ceph-400 to Aariz (the type's total unchanged): {e}");
    assert!(e.contains("on Ceph-400 test1: compared 149"), "{e}");
    let mut no_n = all.clone();
    let k = no_n.iter().position(|c| c.kind == Kind::N && c.dataset == Dataset::Aariz).unwrap();
    no_n.remove(k);
    let e = count(&no_n, &m).unwrap_err().to_string();
    eprintln!("one untouched Aariz tracing missing: {e}");
    assert!(e.contains("N on Aariz valid: compared 149"), "{e}");
    let e = count(&sh, &m).unwrap_err().to_string();
    assert!(e.contains("information case"), "{e}");
    let e = count(&[], &Marks::for_films(0, 0, 0)).unwrap_err().to_string();
    eprintln!("marks that count nothing: {e}");
    assert!(e.contains("counts nothing"), "{e}");
    let e = count(&all, &Marks { needed: 2602, ..m }).unwrap_err().to_string();
    eprintln!("marks off the rule: {e}");
    assert!(e.contains("not the pre-registered rule"), "{e}");
}
/// C8: fails if the factor is lost (x1) or the off-film test is not applied to every point.
#[test] fn c8_needs_every_point_off_the_film_at_x1000() {
    let cc = control_cases();
    let c = c8(&pairs(cc), C8_FACTOR, &TAU).unwrap();
    eprintln!("C8 x1000: {c:?}");
    assert!(c.holds, "{c:?}");
    let c = c8(&pairs(cc), 1.0, &TAU).unwrap();
    eprintln!("C8 x1: {c:?}");
    assert!(!c.holds, "{c:?}");
    let c = c8(&pairs(cc), 1.1, &TAU).unwrap();
    eprintln!("C8 x1.1 (region flags, points still on the film): {c:?}");
    assert!(!c.holds, "every point must be off the film: {c:?}");
}
/// C9: carried from the gate report; a report whose control did not trip (or says nothing) does not hold.
#[test] fn c9_needs_the_gate_reports_control_tripped() {
    assert!(c9(&serde_json::json!({"controlTripped": true})).holds);
    for v in [serde_json::json!({"controlTripped": false}), serde_json::json!({}), serde_json::json!({"controlTripped": "true"})] {
        let c = c9(&v);
        eprintln!("C9 on {v}: {c:?}");
        assert!(!c.holds);
    }
}

// ---- the verdict ----

/// Fails if the marks move by one either way, the controls are not consulted, or the exit codes change.
#[test] fn the_verdict_and_its_exit_codes() {
    let m = Marks::real();
    let v = |caught, fa, controls| { let c = count(&full_cases(&m, caught, fa), &m).unwrap(); verdict(controls, &c, &m) };
    assert_eq!((v(2740, 0, true), exit_code(v(2740, 0, true))), (PASS, 0));
    assert_eq!(v(2603, 6, true), PASS, "the edges: 2603 caught and 6 false alarms pass");
    assert_eq!((v(2602, 0, true), exit_code(v(2602, 0, true))), (FAIL, 3));
    assert_eq!((v(2740, 7, true), exit_code(v(2740, 7, true))), (FAIL, 3));
    assert_eq!((v(2740, 0, false), exit_code(v(2740, 0, false))), (BROKEN, 1), "a control that fails is broken even when the marks hold");
    assert_eq!(exit_code(GATE_STOP), 4);
    assert_eq!(exit_code("anything"), 1);
}

// ---- the gate report and the calibration (review I2) ----

pub(crate) fn gate_json(version: &str, verdict: &str, tripped: bool, fp: &str, line: f64, tau: [f64; 5]) -> Vec<u8> {
    serde_json::to_vec_pretty(&serde_json::json!({"version": version, "verdict": verdict, "controlTripped": tripped, "detectorFingerprint": fp, "scoreLine": line,
        "tau": {"cranialBase": tau[0], "maxilla": tau[1], "mandible": tau[2], "incisors": tau[3], "softTissue": tau[4]}})).unwrap()
}
pub(crate) fn pins_for(gate: &[u8]) -> Pins { Pins { fingerprint: FP.into(), gate_report_sha256: ft_common::sha256_hex(gate), score_line: 0.5, tau: TAU2, rule: GATE_RULE.into() } }
pub(crate) fn cal(rule: Option<&str>, tau: [f64; 5], line: f32, fp: &str, sha: &str) -> Vec<u8> {
    calibration_json(&RegionCalibration { version: "region-calibration/1".into(), detector_fingerprint: fp.into(), score_line: line, tau: RegionTau(tau),
        gate_report_sha256: sha.into(), rule: rule.map(String::from) }).unwrap().into_bytes()
}
/// Each pin refuses on its own. Fails if any one comparison is dropped, if the /1 report or /1 calibration is accepted,
/// or if a stop is not told apart from a broken report.
#[test] fn the_gate_report_and_calibration_must_be_the_gate_2_ones() {
    let g = gate_json(GATE_RULE, "pass", true, FP, 0.5, TAU2);
    let p = pins_for(&g);
    assert!(matches!(check_gate(&g, &p).unwrap(), Gate::Pass(_)));
    let sha = p.gate_report_sha256.clone();
    let ok = cal(Some(GATE_RULE), TAU2, 0.5, FP, &sha);
    assert_eq!(check_calibration(&ok, FP, &p).unwrap().tau.0, TAU2);
    let other = "0".repeat(64);
    let bad_gates: Vec<(&str, Vec<u8>)> = vec![
        ("the /1 report (version only)", gate_json("sc1-box-gate/1", "pass", true, FP, 0.5, TAU2)),
        ("another detector in the report", gate_json(GATE_RULE, "pass", true, &other, 0.5, TAU2)),
        ("the report's tau moved", gate_json(GATE_RULE, "pass", true, FP, 0.5, TAU1)),
        ("the report's score line moved", gate_json(GATE_RULE, "pass", true, FP, 0.49, TAU2)),
        ("C9 did not trip", gate_json(GATE_RULE, "pass", false, FP, 0.5, TAU2)),
        ("broken verdict", gate_json(GATE_RULE, "broken", true, FP, 0.5, TAU2)),
        ("not JSON", b"not json".to_vec()),
    ];
    for (what, b) in bad_gates {
        let e = check_gate(&b, &pins_for(&b)).unwrap_err().to_string();
        eprintln!("gate report, {what}: {e}");
    }
    let e = check_gate(&gate_json(GATE_RULE, "pass", true, FP, 0.5, TAU2), &Pins { gate_report_sha256: other.clone(), ..p.clone() }).unwrap_err().to_string();
    eprintln!("gate report bytes differ from the pinned SHA-256: {e}");
    assert!(e.contains("SHA-256"), "{e}");
    let stop = gate_json(GATE_RULE, "stop", false, FP, 0.5, TAU2);
    assert_eq!(check_gate(&stop, &p).unwrap(), Gate::Stop, "a stop is a stop, whatever its hash");
    assert!(check_gate(&gate_json("sc1-box-gate/1", "stop", false, FP, 0.5, TAU2), &p).is_err(), "a /1 stop is not /2's stop");
    let bad_cals: Vec<(&str, Vec<u8>, &str)> = vec![
        ("the /1 calibration (no rule, /1 tau)", cal(None, TAU1, 0.5, FP, &sha), FP),
        ("rule /1 named", cal(Some("sc1-box-gate/1"), TAU2, 0.5, FP, &sha), FP),
        ("/2 rule but /1 tau", cal(Some(GATE_RULE), TAU1, 0.5, FP, &sha), FP),
        ("score line 0.49", cal(Some(GATE_RULE), TAU2, 0.49, FP, &sha), FP),
        ("calibration for another detector", cal(Some(GATE_RULE), TAU2, 0.5, &other, &sha), FP),
        ("calibration names another gate report", cal(Some(GATE_RULE), TAU2, 0.5, FP, &other), FP),
        ("another detector installed", ok.clone(), other.as_str()),
        ("not a calibration", b"{}".to_vec(), FP),
    ];
    for (what, b, fp) in bad_cals {
        let e = check_calibration(&b, fp, &p).unwrap_err().to_string();
        eprintln!("calibration, {what}: {e}");
    }
}

/// The boxes of a film must come from the pinned detector; a box set that is not five finite boxes is refused.
/// Fails if `regions_of` stops checking the fingerprint or the boxes.
#[test] fn a_films_boxes_must_be_the_pinned_detectors() {
    let s = StandIn { gt: [("151".to_string(), tracing_of("151"))].into_iter().collect(), calls: Mutex::new(0), skip: None };
    let f = &s.boxes(Path::new("."), "test1", &["151".to_string()], false).unwrap()["151"];
    assert_eq!(regions_of(f, FP, 0.5).unwrap().found(), 5);
    let e = regions_of(&Found { fingerprint: "0".repeat(64), ..f.clone() }, FP, 0.5).unwrap_err().to_string();
    eprintln!("boxes from another detector: {e}");
    assert!(e.contains("from detector"), "{e}");
    let mut four = f.clone(); four.boxes.pop();
    assert!(regions_of(&four, FP, 0.5).is_err(), "four boxes");
}

// ---- run_with on SYNTHETIC folders (a stand-in region finder: each film's own teaching boxes) ----

pub(crate) struct StandIn { pub(crate) gt: BTreeMap<String, Vec<Pt>>, pub(crate) calls: Mutex<usize>, pub(crate) skip: Option<String> }
impl Finder for StandIn {
    fn fingerprint(&self) -> String { FP.into() }
    fn boxes(&self, _data: &Path, _split: &str, ids: &[String], flipped: bool) -> anyhow::Result<BTreeMap<String, Found>> {
        *self.calls.lock().unwrap() += 1;
        Ok(ids.iter().filter(|id| self.skip.as_ref() != Some(*id)).map(|id| {
            let pts = if flipped { mirror_film(&self.gt[id], W) } else { self.gt[id].clone() };
            let boxes = teaching_boxes(&named(&pts), W, H).into_iter().map(|b| FoundBox { region: b.region.index(), x0: b.x0, y0: b.y0, x1: b.x1, y1: b.y1, score: 0.9 }).collect();
            (id.clone(), Found { boxes, fingerprint: FP.into(), version: "SYNTHETIC".into(), image_width: W, image_height: H, ms: 0.0 })
        }).collect())
    }
}
pub(crate) struct Sx { pub(crate) _d: tempfile::TempDir, pub(crate) ceph400: PathBuf, pub(crate) aariz: PathBuf, pub(crate) models: PathBuf, pub(crate) out: PathBuf, pub(crate) git: Git, pub(crate) pins: Pins, pub(crate) marks: Marks, pub(crate) finder: StandIn }
impl Sx {
    fn run(&self) -> i32 { run_with(&self.ceph400, &self.aariz, &self.models, &self.out, &[], &self.git, &self.pins, &self.marks, &self.finder).unwrap() }
    fn report(&self) -> PathBuf { self.out.join(REPORT) }
    fn calls(&self) -> usize { *self.finder.calls.lock().unwrap() }
    fn write_gate(&mut self, b: &[u8]) { std::fs::write(self.out.join(GATE_REPORT), b).unwrap(); }
    fn write_cal(&self, b: &[u8]) { std::fs::write(calibration_path(&self.models), b).unwrap(); }
}
pub(crate) fn csv(rows: &[(String, Vec<Pt>)]) -> String {
    let mut s = String::from("image_id,landmark,x,y\n");
    for (id, p) in rows { for (n, q) in ORDER.iter().zip(p) { s += &format!("{id},{n},{},{}\n", q.0, q.1); } }
    s
}
/// SYNTHETIC Ceph-400 (train 001-150 listed, test1 151-160, test2 301 listed and never given anything) and Aariz (train
/// 5, valid 10 of which 5 on a machine with a scale, test 1 listed), the 300-tracing file, the /2 gate report and calibration.
pub(crate) fn sx() -> Sx {
    let d = tempfile::tempdir().unwrap();
    let (ceph400, aariz) = (d.path().join("ceph400"), d.path().join("aariz"));
    for p in [&ceph400, &aariz] { std::fs::create_dir_all(p).unwrap(); }
    let t1 = ids(151..=160);
    let valid: Vec<String> = (1..=10).map(|i| format!("va-{i:04}")).collect();
    let train: Vec<String> = (1..=5).map(|i| format!("tr-{i:04}")).collect();
    let vt: Vec<(String, Vec<Pt>)> = valid.iter().cloned().zip(faces(10, 99)).collect();
    let tt: Vec<(String, Vec<Pt>)> = t1.iter().map(|id| (id.clone(), tracing_of(id))).collect();
    let tr: Vec<(String, Vec<Pt>)> = train.iter().cloned().zip(faces(5, 98)).collect();
    std::fs::write(ceph400.join("gt.csv"), csv(&tt)).unwrap();
    std::fs::write(ceph400.join("splits.json"), serde_json::json!({"train": ids(1..=150), "test1": t1, "test2": ["301"]}).to_string()).unwrap();
    std::fs::write(aariz.join("gt.csv"), csv(&[tr.clone(), vt.clone()].concat())).unwrap();
    std::fs::write(aariz.join("splits.json"), serde_json::json!({"train": train, "valid": valid, "test": ["te-0001"]}).to_string()).unwrap();
    let all: Vec<&String> = train.iter().chain(&valid).collect();
    std::fs::write(aariz.join("spacing.csv"), std::iter::once("image_id,mm_per_px".to_string()).chain(all.iter().map(|id| format!("{id},0.12"))).collect::<Vec<_>>().join("\n") + "\n").unwrap();
    std::fs::write(aariz.join(scale::HEADER_FILE), std::iter::once("image_id,machine,format,raw_x,raw_y,units,mm_per_px,reason".to_string())
        .chain(all.iter().enumerate().map(|(i, id)| format!("{id},{},png,,,,,no resolution in header", if i < 5 + 5 { "ART Plus" } else { "Smart3D" })))
        .collect::<Vec<_>>().join("\n") + "\n").unwrap();
    let models = d.path().join("models");
    std::fs::create_dir_all(models.join("regions")).unwrap();
    std::fs::create_dir_all(models.join("shape")).unwrap();
    let p = prior();
    std::fs::write(pc::prior_path(&models), pc::prior_json(&p.names.iter().cloned().zip(p.tracings.iter().cloned()).collect::<Vec<_>>()).unwrap()).unwrap();
    let out = d.path().join("reports").join("sc1");
    std::fs::create_dir_all(&out).unwrap();
    let gate = gate_json(GATE_RULE, "pass", true, FP, 0.5, TAU2);
    let pins = pins_for(&gate);
    let gt: BTreeMap<String, Vec<Pt>> = tt.iter().chain(&vt).cloned().collect();
    let mut s = Sx { ceph400, aariz, models, out, pins, marks: Marks::for_films(10, 10, 5), finder: StandIn { gt, calls: Mutex::new(0), skip: None },
        git: Git { prereg_at_head: Some(PREREG.as_bytes().to_vec()), dirty: false, sha: "SYNTHETIC".into() }, _d: d };
    s.write_gate(&gate);
    s.write_cal(&cal(Some(GATE_RULE), TAU2, 0.5, FP, &s.pins.gate_report_sha256.clone()));
    s
}

/// The whole run on SYNTHETIC folders: every control holds, every count is its expected total, the report is written
/// with the pre-registration's SHA-256, and the exit code is the verdict's. Fails if any part of the run is skipped.
#[test] fn run_with_judges_every_plant_and_writes_the_report() {
    let s = sx();
    let t = std::time::Instant::now();
    let code = s.run();
    let v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(s.report()).unwrap()).unwrap();
    eprintln!("exit {code} in {:.1} s; verdict {}; caught {} of {} (needed {}); false alarms {} of {} (at most {})", t.elapsed().as_secs_f64(), v["verdict"],
        v["counts"]["caught"], v["counts"]["planted"], v["marks"]["needed"], v["counts"]["falseAlarms"], v["counts"]["normal"], v["marks"]["falseMax"]);
    for c in v["controls"].as_array().unwrap() { eprintln!("  {} {}: {} -> {}", c["name"], c["what"], c["got"], c["holds"]); }
    for l in v["counts"]["lines"].as_array().unwrap().iter().chain(v["counts"]["normalLines"].as_array().unwrap()).chain(v["shifts"].as_array().unwrap()) { eprintln!("  {l}"); }
    assert_eq!(v["controls"].as_array().unwrap().len(), 9, "C1-C9");
    assert!(v["controls"].as_array().unwrap().iter().all(|c| c["holds"] == true), "every control holds on the synthetic set");
    assert_eq!((v["counts"]["planted"].as_u64(), v["counts"]["normal"].as_u64()), (Some(175), Some(20)));
    assert_eq!(v["shifts"].as_array().unwrap().len(), 2);
    assert_eq!(v["preregSha256"], PINNED_SHA256);
    assert_eq!((v["calibrationRule"].as_str(), v["gateReportSha256"].as_str()), (Some(GATE_RULE), Some(s.pins.gate_report_sha256.as_str())));
    assert!(v["realRuns"][0].as_str().unwrap().contains("no cache was given"));
    assert_eq!(v["boxQuality"].as_array().unwrap().len(), 2);
    let want = exit_code(v["verdict"].as_str().unwrap());
    assert_eq!(code, want);
    assert!(code == 0 || code == 3, "controls hold, so pass or fail: {code}");
}

/// The gate report says stop: exit 4, the finder never called, nothing written.
#[test] fn run_with_a_gate_stop_is_exit_4_and_judges_nothing() {
    let mut s = sx();
    s.write_gate(&gate_json(GATE_RULE, "stop", false, FP, 0.5, TAU2));
    let code = s.run();
    eprintln!("gate stop: exit {code}; finder calls {}; report {}", s.calls(), s.report().exists());
    assert_eq!((code, s.calls(), s.report().exists()), (4, 0, false));
}

/// Broken, nothing judged and nothing written: no gate report; the /1 calibration (review I2: the induced failure); a
/// calibration with another tau; the pre-registration not committed, changed at HEAD, or the tree dirty; a Test1 list
/// naming a Test2 film; the wrong film count. Then the control: the same folders with every guard satisfied run.
#[test] fn run_with_is_broken_and_judges_nothing_on_any_guard() {
    let mut s = sx();
    let gate = std::fs::read(s.out.join(GATE_REPORT)).unwrap();
    let good_cal = std::fs::read(calibration_path(&s.models)).unwrap();
    let check = |s: &Sx, what: &str, says: &str| {
        let e = match sc1a_run(&s.ceph400, &s.aariz, &s.models, &s.out, &[], &s.git, &s.pins, &s.marks, &s.finder) { Err(e) => format!("{e:#}"), Ok(_) => "no error".into() };
        let code = s.run();
        eprintln!("{what}: exit {code}; finder calls {}; report {}; {e}", s.calls(), s.report().exists());
        assert_eq!((code, s.calls(), s.report().exists()), (1, 0, false), "{what}");
        assert!(e.contains(says), "{what}: the guard's own message ({says:?}), not another's: {e}");
    };
    std::fs::remove_file(s.out.join(GATE_REPORT)).unwrap();
    check(&s, "no gate report", "needs the gate /2 report");
    s.write_gate(&gate);
    std::fs::write(s.out.join("box-gate.json"), &gate_json("sc1-box-gate/1", "pass", true, FP, 0.5, TAU1)).unwrap();
    s.write_cal(&cal(None, TAU1, 0.5, FP, &s.pins.gate_report_sha256.clone()));
    check(&s, "the /1 calibration in place (box-gate.json beside it)", "a /1 calibration is refused");
    s.write_cal(&cal(Some(GATE_RULE), [0.09, 0.02, 0.02, 0.01, 0.11], 0.5, FP, &s.pins.gate_report_sha256.clone()));
    check(&s, "a /2 calibration with another tau", "tau");
    s.write_cal(&good_cal);
    let mut changed = PREREG.as_bytes().to_vec(); changed[20] ^= 1;
    for (what, head, dirty, says) in [("not committed", None, false, "not committed"), ("changed at HEAD", Some(changed), false, "differs"), ("dirty tree", Some(PREREG.as_bytes().to_vec()), true, "clean tree")] {
        s.git = Git { prereg_at_head: head, dirty, sha: "SYNTHETIC".into() };
        check(&s, &format!("pre-registration {what}"), says);
    }
    s.git = Git { prereg_at_head: Some(PREREG.as_bytes().to_vec()), dirty: false, sha: "SYNTHETIC".into() };
    let sp = std::fs::read_to_string(s.ceph400.join("splits.json")).unwrap();
    std::fs::write(s.ceph400.join("splits.json"), sp.replace("\"160\"", "\"301\"")).unwrap();
    check(&s, "a Test1 list naming 301", "Test2");
    std::fs::write(s.ceph400.join("splits.json"), &sp).unwrap();
    for (marks, says) in [(Marks::for_films(11, 10, 5), "Ceph-400 test1 films: compared 10, expected 11"), (Marks::for_films(10, 11, 5), "Aariz valid films: compared 10, expected 11"),
                          (Marks::for_films(10, 10, 6), "with a scale (aariz-scale/1): compared 5, expected 6")] {
        s.marks = marks;
        check(&s, &format!("marks for {} / {} / {} films", marks.test1, marks.valid, marks.scaled_valid), says);
    }
    s.marks = Marks::for_films(10, 10, 5);
    let asp = std::fs::read_to_string(s.aariz.join("splits.json")).unwrap();
    std::fs::write(s.aariz.join("splits.json"), asp.replace("\"va-0010\"", "\"tr-0001\"")).unwrap();
    check(&s, "Aariz valid naming a train film", "shares films with train");
    std::fs::write(s.aariz.join("splits.json"), &asp).unwrap();
    std::fs::write(s.ceph400.join("splits.json"), sp.replace("\"159\"", "\"160\"")).unwrap();
    check(&s, "a Test1 list naming 160 twice", "names a film twice");
    std::fs::write(s.ceph400.join("splits.json"), sp.replace(",\"160\"", "")).unwrap();
    s.marks = Marks::for_films(9, 10, 5);
    check(&s, "9 Test1 films", "equal folds");
    s.marks = Marks::for_films(10, 10, 5);
    std::fs::write(s.ceph400.join("splits.json"), &sp).unwrap();
    let gt = std::fs::read_to_string(s.ceph400.join("gt.csv")).unwrap();
    std::fs::write(s.ceph400.join("gt.csv"), gt.lines().filter(|l| !l.starts_with("151,S,")).collect::<Vec<_>>().join("\n") + "\n").unwrap();
    check(&s, "a Test1 expert tracing without S", "lack expert points");
    std::fs::write(s.ceph400.join("gt.csv"), &gt).unwrap();
    s.pins.rule = "sc1-box-gate/1".into();
    s.write_cal(&cal(None, TAU2, 0.5, FP, &s.pins.gate_report_sha256.clone()));
    check(&s, "pins and calibration both naming /1", "SC1-1a is pinned to sc1-box-gate/2");
    s.pins.rule = GATE_RULE.into();
    s.write_cal(&good_cal);
    let (c4, az) = (s.ceph400.clone(), s.aariz.clone());
    (s.ceph400, s.aariz) = (az.clone(), c4.clone());
    check(&s, "the two folders swapped", "is not Ceph-400");
    (s.ceph400, s.aariz) = (c4.clone(), c4.clone());
    check(&s, "Ceph-400 given as the Aariz folder", "is not Aariz");
    (s.ceph400, s.aariz) = (c4, az);
    s.finder.skip = Some("157".into());
    let e = match sc1a_run(&s.ceph400, &s.aariz, &s.models, &s.out, &[], &s.git, &s.pins, &s.marks, &s.finder) { Err(e) => format!("{e:#}"), Ok(_) => "no error".into() };
    eprintln!("the finder gives no boxes for one film: {e}");
    assert!(e.contains("has no boxes") && !s.report().exists(), "{e}");
    s.finder.skip = None;
    let code = s.run();
    eprintln!("control, every guard satisfied: exit {code}");
    assert!(code == 0 || code == 3, "{code}");
}

/// The real-runs information line: a cache of Ceph-400 test1 runs is read, each model's films split by whether any point
/// is more than 10 mm off; a Test2 cache and a train cache are refused before any film is read.
#[test] fn real_runs_split_flag_rates_by_a_10_mm_error() {
    let (films, f) = small_set();
    let refs = Refs::new(prior(), &f).unwrap();
    let d = tempfile::tempdir().unwrap();
    let (c4, az) = (d.path().join("ceph400"), d.path().join("aariz"));
    for p in [&c4, &az] { std::fs::create_dir_all(p).unwrap(); }
    let pts = |p: &[Pt], dx: f64| -> BTreeMap<String, xcache::CachedPoint> {
        ORDER.iter().zip(p).map(|(n, q)| (n.to_string(), xcache::CachedPoint { x: q.0 + dx, y: q.1, cov: BTreeMap::new() })).collect() };
    let runs = vec![
        xcache::FilmRun { film: films[0].id.clone(), mm_per_px: 0.1, models: [("m1".to_string(), Ok(pts(&films[0].pts, 0.0)))].into_iter().collect() },
        xcache::FilmRun { film: films[1].id.clone(), mm_per_px: 0.1, models: [("m1".to_string(), Ok(pts(&films[1].pts, 300.0)))].into_iter().collect() },
        xcache::FilmRun { film: films[2].id.clone(), mm_per_px: 0.1, models: [("m1".to_string(), Err("SYNTHETIC failure".to_string()))].into_iter().collect() },
        xcache::FilmRun { film: films[3].id.clone(), mm_per_px: 0.1, models: [("m1".to_string(), Ok(pts(&films[3].pts, 50.0)))].into_iter().collect() },
        xcache::FilmRun { film: "SYNTHETIC-not-judged".into(), mm_per_px: 0.1, models: [("m1".to_string(), Ok(pts(&films[3].pts, 0.0)))].into_iter().collect() },
    ];
    let header = |ds: &str, split: &str| xcache::CacheHeader { dataset: ds.into(), split: split.into(), git_sha: "SYNTHETIC".into(), models: BTreeMap::new(),
        providers: BTreeMap::new(), windows: vec![], films: 5, aariz_scale: None };
    let ok = d.path().join("cache-test1");
    xcache::write_cache(&ok, &header("ceph400", "test1"), &runs).unwrap();
    let hs = cache_headers(&[ok.clone()], &c4, &az).unwrap();
    let lines = real_runs(&hs, &films, &refs, &TAU).unwrap();
    for l in &lines { eprintln!("{l}"); }
    let l = lines.iter().find(|l| l.contains("m1")).unwrap();
    assert!(l.contains("more than 10 mm off: 1 of 1 flagged") && l.contains("of 2 flagged") && l.contains("no answer 1") && l.contains("outside SC1-1a's set 1"),
        "the 30 mm film far, the exact and the 5 mm (50 px at 0.1 mm/px) films within 10 mm: {l}");
    for (ds, split) in [("ceph400", "test2"), ("ceph400", "train"), ("aariz", "test"), ("aariz", "train")] {
        let bad = d.path().join(format!("cache-{ds}-{split}"));
        xcache::write_cache(&bad, &header(ds, split), &runs).unwrap();
        std::fs::remove_file(bad.join("detections.jsonl")).unwrap();
        let e = cache_headers(&[ok.clone(), bad], &c4, &az).unwrap_err().to_string();
        eprintln!("{ds} {split} cache: {e}");
        assert!(e.contains("held back") || e.contains("SC1-1a's films"), "{e}");
    }
    assert!(real_runs(&[], &films, &refs, &TAU).unwrap()[0].contains("no cache was given"));
}

/// M3 (SC-1 Part 1b Task C): SC1-1a's report on its SYNTHETIC folders, git SHA and timing blanked, equals the copy
/// captured at 40cb634, before Task C touched `check_film`. Task D2 compares against it again. Re-capture only with the
/// owner's OK: `SC1_WRITE_V1_FIXTURE=1` writes the file. Fails if: anything SC1-1a reports moves.
#[test] fn the_synthetic_report_is_the_v1_fixture() {
    let s = sx();
    s.run();
    let mut v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(s.report()).unwrap()).unwrap();
    v["gitSha"] = "SYNTHETIC".into();
    v["seconds"] = 0.into();
    let text = serde_json::to_string_pretty(&v).unwrap() + "\n";
    if std::env::var_os("SC1_WRITE_V1_FIXTURE").is_some() {
        std::fs::write(std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src").join("fixtures").join("sc1-1a-synthetic-v1.json"), &text).unwrap();
    }
    assert!(text == include_str!("fixtures/sc1-1a-synthetic-v1.json"), "SC1-1a's synthetic report moved from the v1 fixture");
}
