//! Every model once per film, every guess with its spread for every tuning window (spec 2026-10-13 §7), cached so the
//! tuning and the single test run never reopen the films.
use ceph_infer::engine::{load_gray, points_from_heatmaps_with, Engine};
use std::{collections::BTreeMap, io::{BufRead, Write}, path::{Path, PathBuf}};

/// Every float in the cache is stored as its 16-hex-digit bit pattern (as `points-bits.csv`), because serde_json's
/// default float parser does not always give back the bits it wrote (Task 7 Step 7: about one value in four on the real
/// cache came back one step off, so the cache did not reproduce the bench). Bits in, the same bits out.
mod bits {
    pub fn serialize<S: serde::Serializer>(v: &f64, s: S) -> Result<S::Ok, S::Error> { s.serialize_str(&format!("{:016x}", v.to_bits())) }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<f64, D::Error> {
        let t: String = serde::Deserialize::deserialize(d)?;
        if t.len() != 16 { return Err(serde::de::Error::custom("not a 16-digit bit pattern")); }
        u64::from_str_radix(&t, 16).map(f64::from_bits).map_err(serde::de::Error::custom)
    }
}
mod cov_bits {
    use std::collections::BTreeMap;
    type Hex = Option<[String; 3]>;
    pub fn serialize<S: serde::Serializer>(v: &BTreeMap<usize, Option<[f64; 3]>>, s: S) -> Result<S::Ok, S::Error> {
        let m: BTreeMap<usize, Hex> = v.iter().map(|(k, c)| (*k, c.map(|c| c.map(|x| format!("{:016x}", x.to_bits()))))).collect();
        serde::Serialize::serialize(&m, s)
    }
    pub fn deserialize<'de, D: serde::Deserializer<'de>>(d: D) -> Result<BTreeMap<usize, Option<[f64; 3]>>, D::Error> {
        let m: BTreeMap<usize, Hex> = serde::Deserialize::deserialize(d)?;
        let one = |t: &str| -> Result<f64, D::Error> {
            if t.len() != 16 { return Err(serde::de::Error::custom("not a 16-digit bit pattern")); }
            u64::from_str_radix(t, 16).map(f64::from_bits).map_err(serde::de::Error::custom) };
        m.into_iter().map(|(k, c)| Ok((k, match c { None => None, Some([a, b, c]) => Some([one(&a)?, one(&b)?, one(&c)?]) }))).collect()
    }
}

#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
/// One model's guess for one landmark: film px (the decoded point, as `detect` gives it) and its spread for each window.
pub struct CachedPoint { #[serde(with = "bits")] pub x: f64, #[serde(with = "bits")] pub y: f64, #[serde(with = "cov_bits")] pub cov: BTreeMap<usize, Option<[f64; 3]>> }
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
/// One film: its mm per px (rule `aariz-scale/1` on Aariz) and each model's points, or the error that model gave on it.
pub struct FilmRun { pub film: String, #[serde(with = "bits")] pub mm_per_px: f64, pub models: BTreeMap<String, Result<BTreeMap<String, CachedPoint>, String>> }
#[derive(Clone, Debug, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheHeader { pub dataset: String, pub split: String, pub git_sha: String, pub models: BTreeMap<String, String>, pub providers: BTreeMap<String, String>, pub windows: Vec<usize>, pub films: usize,
    /// Aariz only: rule `aariz-scale/1` and its counts, from `crate::films_to_score`. None off Aariz.
    #[serde(default)] pub aariz_scale: Option<crate::scale::ScaleCounts> }

pub fn write_cache(dir: &Path, h: &CacheHeader, films: &[FilmRun]) -> anyhow::Result<()> {
    std::fs::create_dir_all(dir)?;
    std::fs::write(dir.join("cache-header.json"), serde_json::to_string_pretty(h)?)?;
    let mut f = std::io::BufWriter::new(std::fs::File::create(dir.join("detections.jsonl"))?);
    for r in films { writeln!(f, "{}", serde_json::to_string(r)?)?; }
    f.flush()?;
    Ok(())
}

pub fn read_cache(dir: &Path) -> anyhow::Result<(CacheHeader, Vec<FilmRun>)> {
    let h: CacheHeader = serde_json::from_slice(&std::fs::read(dir.join("cache-header.json"))?)?;
    let films = std::io::BufReader::new(std::fs::File::open(dir.join("detections.jsonl"))?).lines()
        .map(|l| Ok(serde_json::from_str::<FilmRun>(&l?)?)).collect::<anyhow::Result<Vec<_>>>()?;
    anyhow::ensure!(films.len() == h.films, "the cache holds {} films, its header says {}", films.len(), h.films);
    Ok((h, films))
}

/// One model, by id, as a function from a film to its points (a real engine in `run_models`; a stand-in in tests).
pub type Runner<'a> = (String, &'a dyn Fn(&image::GrayImage) -> anyhow::Result<BTreeMap<String, CachedPoint>>);

/// Every model on every film. A model that fails on a film is recorded as that model not answering on that film (its
/// error kept), never a crash; a film that cannot be opened stops the run (a dataset fault, not a model's).
pub fn cache_films(images: &Path, films: &[(String, f64)], models: &[Runner], progress: &dyn Fn(usize, usize)) -> anyhow::Result<Vec<FilmRun>> {
    let mut out = Vec::with_capacity(films.len());
    for (n, (iid, mm_per_px)) in films.iter().enumerate() {
        let img = load_gray(&images.join(format!("{iid}.png")))?;
        let models = models.iter().map(|(id, run)| (id.clone(), run(&img).map_err(|e| format!("{e:#}")))).collect();
        out.push(FilmRun { film: iid.clone(), mm_per_px: *mm_per_px, models });
        progress(n + 1, films.len());
    }
    Ok(out)
}

/// One engine on one film, facing as the dataset gives it (as `run`), through `run_raw` + `points_from_heatmaps_with`
/// — the same lines `detect` uses — with the spread for each window. The decoded point must not move with the window.
pub fn engine_points(e: &Engine, img: &image::GrayImage, windows: &[usize]) -> anyhow::Result<BTreeMap<String, CachedPoint>> {
    let (_, hm, g) = e.run_raw(img, false)?;
    let mut pts: BTreeMap<String, CachedPoint> = BTreeMap::new();
    for &w in windows {
        let (lms, _) = points_from_heatmaps_with(e.manifest(), &g, &hm, img.width(), false, w);
        for l in lms {
            let c = pts.entry(l.id.clone()).or_insert_with(|| CachedPoint { x: l.x, y: l.y, cov: BTreeMap::new() });
            anyhow::ensure!(c.x.to_bits() == l.x.to_bits() && c.y.to_bits() == l.y.to_bits(), "the window moved a decoded point");
            c.cov.insert(w, l.cov);
        }
    }
    Ok(pts)
}

/// Every model once per film, with the spread for each tuning window, written to `out`. The films and their scale come
/// first (aariz-scale/1 on Aariz: films it excludes are not run, counts recorded; each film's spacing elsewhere), so a
/// refusal about the data costs no model load and writes nothing.
pub fn run_models(data: &Path, split: &str, manifests: &[PathBuf], out: &Path, progress: impl Fn(usize, usize)) -> anyhow::Result<CacheHeader> {
    let ids = crate::dataset::select(&crate::dataset::load_splits(&data.join("splits.json"))?, split)?;
    let gt = crate::dataset::load_points(&data.join("gt.csv"))?;
    let (scored, aariz_scale) = crate::films_to_score(data, &ids, &gt)?;
    let engines: Vec<Engine> = manifests.iter().map(|m| Engine::load(m)).collect::<anyhow::Result<_>>()?;
    let windows = crate::tune::WINDOWS.to_vec();
    let fns: Vec<Box<dyn Fn(&image::GrayImage) -> anyhow::Result<BTreeMap<String, CachedPoint>> + '_>> =
        engines.iter().map(|e| Box::new(|img: &image::GrayImage| engine_points(e, img, &windows)) as Box<dyn Fn(&image::GrayImage) -> _>).collect();
    let runners: Vec<Runner> = engines.iter().zip(&fns).map(|(e, f)| (e.manifest().id.clone(), f.as_ref() as &dyn Fn(&image::GrayImage) -> _)).collect();
    let films = cache_films(&data.join("images"), &scored, &runners, &progress)?;
    let name = data.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
    let h = CacheHeader { dataset: name, split: split.into(), git_sha: crate::provenance(data, "").git_sha,
        models: engines.iter().map(|e| (e.manifest().id.clone(), e.manifest().sha256.clone())).collect(),
        providers: engines.iter().map(|e| (e.manifest().id.clone(), e.provider().to_string())).collect(),   // preflight a1
        windows: windows.clone(), films: films.len(), aariz_scale };
    write_cache(out, &h, &films)?;
    Ok(h)
}

/// `model`'s cache against a bench `points-bits.csv` (Task 4): points compared, points that differ, and the bits file's
/// points with no cached point (film missing from the cache, or the model failed on it there), with those films.
#[derive(Debug, Clone, PartialEq)]
pub struct BitsAgree { pub compared: usize, pub differ: usize, pub missing: usize, pub missing_films: Vec<String> }

/// Compares `model`'s cached points with a bench `points-bits.csv` (Task 4). A bits line with no cached point is counted
/// as missing, never skipped (final review m8).
pub fn bits_agree(films: &[FilmRun], model: &str, bits_csv: &Path) -> anyhow::Result<BitsAgree> {
    let mut a = BitsAgree { compared: 0, differ: 0, missing: 0, missing_films: Vec::new() };
    for line in std::fs::read_to_string(bits_csv)?.lines().skip(1).filter(|l| !l.trim().is_empty()) {
        let f: Vec<&str> = line.split(',').collect();
        anyhow::ensure!(f.len() >= 4, "bad bits line in {}", bits_csv.display());
        let Some(p) = films.iter().find(|r| r.film == f[0]).and_then(|r| r.models.get(model)).and_then(|m| m.as_ref().ok()).and_then(|m| m.get(f[1])) else {
            a.missing += 1;
            if !a.missing_films.iter().any(|x| x == f[0]) { a.missing_films.push(f[0].to_string()); }
            continue
        };
        a.compared += 1;
        if format!("{:016x}", p.x.to_bits()) != f[2] || format!("{:016x}", p.y.to_bits()) != f[3] { a.differ += 1; }
    }
    Ok(a)
}

/// Every model's cache against `<dir>/<model>/points-bits.csv`: (model, compared, differing). Stops, naming the model,
/// if nothing was compared (a comparison that saw nothing is not a pass), if any of the bench's points is missing from
/// the cache (a cache lacking films cannot be shown to reproduce them), or if any point differs.
pub fn bits_reproduced(films: &[FilmRun], models: &[String], dir: &Path) -> anyhow::Result<Vec<(String, usize, usize)>> {
    let mut out = Vec::new();
    for id in models {
        let a = bits_agree(films, id, &dir.join(id).join("points-bits.csv"))?;
        let (n, diff) = (a.compared, a.differ);
        anyhow::ensure!(n > 0, "{id}: 0 points compared with the bench's bits: the cache cannot be shown to reproduce the bench");
        anyhow::ensure!(a.missing == 0, "{id}: {} of {} points in the bench's bits are missing from the cache, on {} films (first: {}): \
            the cache cannot be shown to reproduce the bench", a.missing, a.missing + n, a.missing_films.len(),
            a.missing_films.iter().take(5).cloned().collect::<Vec<_>>().join(", "));
        anyhow::ensure!(diff == 0, "{id}: {diff} differ of {n} points compared: the cache does not reproduce the bench's points");
        out.push((id.clone(), n, diff));
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn a_cache_round_trips_and_a_failed_model_stays_a_failure() {
        let d = tempfile::tempdir().unwrap();
        let h = CacheHeader { dataset: "aariz".into(), split: "valid".into(), git_sha: "g".into(), models: [("m".to_string(), "sha".to_string())].into(),
            providers: [("m".to_string(), "cpu".to_string())].into(), windows: vec![7, 15], films: 1, aariz_scale: None };
        let f = FilmRun { film: "f1".into(), mm_per_px: 0.1, models: [("m".to_string(), Ok([("S".to_string(), CachedPoint { x: 1.5, y: 2.5, cov: [(7usize, Some([1.0, 0.0, 1.0])), (15, None)].into() })].into())),
            ("n".to_string(), Err("SYNTHETIC".to_string()))].into() };
        write_cache(d.path(), &h, &[f.clone()]).unwrap();
        let (h2, films) = read_cache(d.path()).unwrap();
        assert_eq!((h2, films), (h, vec![f]));
    }
    /// Task 7 Step 7 finding: serde_json's default float parser does not always give back the bits it wrote (about one
    /// value in four came back one step off on the real cache). The cache must give back every point, spread and scale
    /// bit for bit, or it does not reproduce the bench.
    #[test] fn every_value_survives_the_cache_bit_for_bit() {
        let d = tempfile::tempdir().unwrap();
        let mut rng = crate::stats::SplitMix64::new(7);
        let mut v = || f64::from_bits(rng.next_u64() >> 2 | 0x3ff0_0000_0000_0000) * 1234.567;   // varied, finite
        let h = CacheHeader { dataset: "aariz".into(), split: "valid".into(), git_sha: "g".into(), models: BTreeMap::new(), providers: BTreeMap::new(), windows: vec![15], films: 200, aariz_scale: None };
        let films: Vec<FilmRun> = (0..200).map(|i| FilmRun { film: format!("f{i}"), mm_per_px: v() / 1e4,
            models: [("m".to_string(), Ok([("S".to_string(), CachedPoint { x: v(), y: v(), cov: [(15usize, Some([v(), -v() / 9.0, v()])), (7, None)].into() })].into()))].into() }).collect();
        write_cache(d.path(), &h, &films).unwrap();
        let (_, back) = read_cache(d.path()).unwrap();
        let bits = |f: &[FilmRun]| f.iter().map(|r| { let p = &r.models["m"].as_ref().unwrap()["S"]; let c = p.cov[&15].unwrap();
            [r.mm_per_px, p.x, p.y, c[0], c[1], c[2]].map(f64::to_bits) }).collect::<Vec<_>>();
        let (a, b) = (bits(&films), bits(&back));
        let differ = a.iter().flatten().zip(b.iter().flatten()).filter(|(x, y)| x != y).count();
        assert_eq!((a.len() * 6, differ), (1200, 0), "values compared, values differing");
        let h1 = CacheHeader { films: 1, ..h };
        write_cache(d.path(), &h1, &films[..1]).unwrap();
        std::fs::write(d.path().join("detections.jsonl"), r#"{"film":"f0","mmPerPx":0.1,"models":{}}"#).unwrap();
        assert!(read_cache(d.path()).is_err(), "a cache with decimal floats (the old format) is refused, not read with drift");
    }
    #[test] fn bits_agree_counts_compared_and_differing_points() {
        let d = tempfile::tempdir().unwrap();
        let p = d.path().join("points-bits.csv");
        std::fs::write(&p, format!("image_id,landmark,x_bits,y_bits,peak_bits\nf1,S,{:016x},{:016x},0\nf1,N,{:016x},{:016x},0\n", 1.5f64.to_bits(), 2.5f64.to_bits(), 9.0f64.to_bits(), 9.0f64.to_bits())).unwrap();
        let f = FilmRun { film: "f1".into(), mm_per_px: 0.1, models: [("m".to_string(), Ok([("S".to_string(), CachedPoint { x: 1.5, y: 2.5, cov: BTreeMap::new() }),
            ("N".to_string(), CachedPoint { x: 9.0, y: 9.5, cov: BTreeMap::new() })].into()))].into() };
        assert_eq!(bits_agree(&[f], "m", &p).unwrap(), BitsAgree { compared: 2, differ: 1, missing: 0, missing_films: vec![] });
    }
    /// Final review m8: a bits-file line with no cached point (the film is missing from the cache, or the model failed on
    /// it there) used to be skipped, so "0 differ of n" could not show a cache that lacks half a model's films. Such a
    /// cache now stops, saying how many points and films are missing and naming the first films.
    #[test] fn a_cache_missing_films_that_the_bench_bits_have_stops_and_counts_them() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("m")).unwrap();
        let line = |f: &str, l: &str| format!("{f},{l},{:016x},{:016x},0\n", 1.5f64.to_bits(), 2.5f64.to_bits());
        std::fs::write(d.path().join("m").join("points-bits.csv"), format!("image_id,landmark,x_bits,y_bits,peak_bits\n{}{}{}{}",
            line("f1", "S"), line("f2", "S"), line("f2", "N"), line("f3", "S"))).unwrap();
        let ok = |film: &str| FilmRun { film: film.into(), mm_per_px: 0.1, models: [("m".to_string(), Ok([("S".to_string(), CachedPoint { x: 1.5, y: 2.5, cov: BTreeMap::new() })].into()))].into() };
        let failed = FilmRun { film: "f3".into(), mm_per_px: 0.1, models: [("m".to_string(), Err("SYNTHETIC failure".to_string()))].into() };
        let e = bits_reproduced(&[ok("f1"), failed], &["m".to_string()], d.path()).map(|v| format!("passed: {v:?}")).unwrap_or_else(|e| e.to_string());
        assert!(e.contains("m:") && e.contains("3 of 4") && e.contains("2 films") && e.contains("f2") && e.contains("f3"), "{e}");
        // Positive control: the same bits against a cache holding every point pass, 4 compared, 0 differ, 0 missing.
        let full = |film: &str| FilmRun { film: film.into(), mm_per_px: 0.1, models: [("m".to_string(), Ok([("S".to_string(), CachedPoint { x: 1.5, y: 2.5, cov: BTreeMap::new() }),
            ("N".to_string(), CachedPoint { x: 1.5, y: 2.5, cov: BTreeMap::new() })].into()))].into() };
        assert_eq!(bits_reproduced(&[full("f1"), full("f2"), full("f3")], &["m".to_string()], d.path()).unwrap(), vec![("m".to_string(), 4, 0)]);
    }
    /// SYNTHETIC dataset folder named `name` (aariz or ceph400): three 4 × 4 films f1–f3 with S and N.
    fn dataset(root: &Path, name: &str, aariz: bool, header: bool) -> PathBuf {
        let d = root.join(name);
        std::fs::create_dir_all(d.join("images")).unwrap();
        for f in ["f1", "f2", "f3"] { image::GrayImage::from_pixel(4, 4, image::Luma([9])).save(d.join("images").join(format!("{f}.png"))).unwrap(); }
        let split = if aariz { "valid" } else { "test1" };
        std::fs::write(d.join("splits.json"), format!(r#"{{"{split}": ["f1", "f2", "f3"]}}"#)).unwrap();
        std::fs::write(d.join("gt.csv"), "image_id,landmark,x,y\nf1,S,0,0\nf1,N,700,0\nf2,S,0,0\nf2,N,700,0\nf3,S,0,0\nf3,N,350,0\n").unwrap();
        if aariz {
            std::fs::write(d.join("spacing.csv"), "image_id,mm_per_px\nf1,0.1\nf2,0.1\nf3,0.1\n").unwrap();
            if header { std::fs::write(d.join("header_resolution.csv"), "image_id,machine,format,raw_x,raw_y,units,mm_per_px,reason\n\
                f1,ART Plus,jpeg,1,1,aspect only,,no resolution in header\nf2,Smart3D,jpeg,1,1,aspect only,,no resolution in header\n\
                f3,Hyperion X5,bmp,4907,4906,px/m,0.2,real\n").unwrap(); }
        }
        d
    }
    /// Edge case (brief): the header records aariz-scale/1 and its counts on Aariz (films it excludes are not cached), and
    /// none on Ceph-400. No model is needed to show it.
    #[test] fn the_cache_header_records_the_aariz_scale_rule_on_aariz_and_none_on_ceph400() {
        let t = tempfile::tempdir().unwrap();
        let az = dataset(t.path(), "aariz", true, true);
        let h = run_models(&az, "valid", &[], &t.path().join("c1"), |_, _| {}).unwrap();
        let c = h.aariz_scale.clone().expect("Aariz: the rule is recorded");
        assert_eq!((c.aariz_scale_rule.as_str(), c.films, c.used, c.excluded), ("aariz-scale/1", 3, 2, 1));
        let (h2, films) = read_cache(&t.path().join("c1")).unwrap();
        assert_eq!(h2, h, "the counts survive the round trip");
        assert_eq!(films.iter().map(|f| (f.film.as_str(), f.mm_per_px)).collect::<Vec<_>>(), [("f1", 0.1), ("f3", 0.2)], "Smart3D's f2 is not cached");
        let c4 = dataset(t.path(), "ceph400", false, false);
        let h = run_models(&c4, "test1", &[], &t.path().join("c2"), |_, _| {}).unwrap();
        assert_eq!((h.aariz_scale, h.films), (None, 3));
    }
    #[test] fn an_aariz_set_with_no_header_resolution_stops_saying_how_to_make_it() {
        let t = tempfile::tempdir().unwrap();
        let az = dataset(t.path(), "aariz", true, false);
        let e = format!("{:#}", run_models(&az, "valid", &[], &t.path().join("c"), |_, _| {}).unwrap_err());
        assert!(e.contains("header_resolution.csv") && e.contains("prepare_aariz.py"), "{e}");
        assert!(!t.path().join("c").exists(), "nothing written");
    }
    #[test] fn a_film_with_no_spacing_row_stops_naming_the_film() {
        let t = tempfile::tempdir().unwrap();
        let az = dataset(t.path(), "aariz", true, true);
        std::fs::write(az.join("spacing.csv"), "image_id,mm_per_px\nf1,0.1\nf3,0.1\n").unwrap();
        let e = format!("{:#}", run_models(&az, "valid", &[], &t.path().join("c"), |_, _| {}).unwrap_err());
        assert!(e.contains("f2") && e.contains("spacing.csv"), "{e}");
    }
    /// Edge case (brief): a model that errors on a film is recorded as not answering on that film, never a crash; the
    /// other models' answers on that film and its other films are kept.
    #[test] fn a_model_that_errors_on_one_film_is_recorded_as_not_answering_there() {
        let t = tempfile::tempdir().unwrap();
        let d = dataset(t.path(), "ceph400", false, false);
        let ok = |_: &image::GrayImage| -> anyhow::Result<BTreeMap<String, CachedPoint>> { Ok([("S".to_string(), CachedPoint { x: 1.0, y: 2.0, cov: BTreeMap::new() })].into()) };
        let flaky = |im: &image::GrayImage| -> anyhow::Result<BTreeMap<String, CachedPoint>> {
            anyhow::ensure!(im.get_pixel(0, 0)[0] != 7, "SYNTHETIC failure"); Ok(BTreeMap::new()) };
        image::GrayImage::from_pixel(4, 4, image::Luma([7])).save(d.join("images").join("f2.png")).unwrap();
        let films = [("f1".to_string(), 0.1), ("f2".to_string(), 0.1), ("f3".to_string(), 0.1)];
        let runners: [Runner; 2] = [("good".to_string(), &ok), ("flaky".to_string(), &flaky)];
        let out = cache_films(&d.join("images"), &films, &runners, &|_, _| {}).unwrap();
        assert_eq!(out.len(), 3);
        assert!(out[1].models["flaky"].as_ref().unwrap_err().contains("SYNTHETIC failure"));
        assert!(out[0].models["flaky"].is_ok() && out[2].models["flaky"].is_ok());
        assert!(out[1].models["good"].is_ok(), "the other model still answered on that film");
    }
    /// Edge case (brief): a cache whose points differ from Task 4's bits stops, naming the model; so does a comparison
    /// that compared nothing (a null from an instrument that saw nothing is not a pass).
    #[test] fn a_cache_that_does_not_reproduce_the_bench_bits_stops() {
        let d = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(d.path().join("m")).unwrap();
        let bits = |x: f64| format!("image_id,landmark,x_bits,y_bits,peak_bits\nf1,S,{:016x},{:016x},0\n", x.to_bits(), 2.5f64.to_bits());
        let f = FilmRun { film: "f1".into(), mm_per_px: 0.1, models: [("m".to_string(), Ok([("S".to_string(), CachedPoint { x: 1.5, y: 2.5, cov: BTreeMap::new() })].into()))].into() };
        std::fs::write(d.path().join("m").join("points-bits.csv"), bits(1.5)).unwrap();
        assert_eq!(bits_reproduced(&[f.clone()], &["m".to_string()], d.path()).unwrap(), vec![("m".to_string(), 1, 0)]);
        std::fs::write(d.path().join("m").join("points-bits.csv"), bits(1.5000000000000002)).unwrap();
        let e = bits_reproduced(&[f.clone()], &["m".to_string()], d.path()).unwrap_err().to_string();
        assert!(e.contains("m:") && e.contains("1 differ"), "{e}");
        std::fs::write(d.path().join("m").join("points-bits.csv"), "image_id,landmark,x_bits,y_bits,peak_bits\nother,S,0,0,0\n").unwrap();
        let e = bits_reproduced(&[f], &["m".to_string()], d.path()).unwrap_err().to_string();
        assert!(e.contains("0 points compared"), "{e}");
    }
}
