//! Aariz pixel scale, rule `aariz-scale/1` (owner SCALE-FIX, option 2, 15 Oct 2026; rulings 15 Oct).
//!
//! Aariz gives one pixel size per X-ray machine, but four machines' films were resized before release without that
//! value being updated. The rule:
//! - ART Plus and both Planmeca ProMax: the dataset's machine pixel size (`spacing.csv`), as before. ProMax's header
//!   says 199 dpi (0.128 mm/px) against the CSV's 0.139; the owner kept the dataset's value (open note in the report).
//! - Hyperion X5 and Rotograph EVO: the resolution the ORIGINAL image file states in its own header, when it is real
//!   (not a software default), from `header_resolution.csv` (written by `tools/dataset/prepare_aariz.py`). No real
//!   header resolution: the film is excluded, counted under the CSV's reason.
//! - Smart3D and Veraviewepocs 2D: excluded (no source gives their true size).
//! - Any film whose ground-truth S–N falls outside 45–95 mm after the rule is FLAGGED (counted), never excluded.
//! Every excluded film is counted by reason and machine; nothing is dropped silently.

use anyhow::{bail, Context};
use std::{collections::{BTreeMap, HashMap}, path::Path};

pub const AARIZ_SCALE_RULE: &str = "aariz-scale/1";
/// Ground-truth S–N outside this range (mm, both ends allowed) is flagged as implausible.
pub const SN_RANGE_MM: (f64, f64) = (45.0, 95.0);
pub const CSV_SCALE_MACHINES: [&str; 3] = ["ART Plus", "ProMax 2D", "ProMax with ProTouch"];
pub const HEADER_SCALE_MACHINES: [&str; 2] = ["Hyperion X5", "Rotograph EVO"];
pub const NO_SCALE_MACHINES: [&str; 2] = ["Smart3D", "Veraviewepocs 2D"];
pub const NO_TRUE_SCALE: &str = "no source of true scale";
pub const HEADER_FILE: &str = "header_resolution.csv";
const HEADER_COLUMNS: &str = "image_id,machine,format,raw_x,raw_y,units,mm_per_px,reason";

/// One film's row of `header_resolution.csv`.
#[derive(Clone, Debug, PartialEq)]
pub struct HeaderRow { pub machine: String, pub mm_per_px: Option<f64>, pub reason: String }

/// What the rule does with one film.
#[derive(Clone, Debug, PartialEq)]
pub enum Scale { Use(f64), Exclude(String) }

/// The counts every Aariz output records.
#[derive(Clone, Debug, Default, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScaleCounts {
    pub aariz_scale_rule: String,
    pub films: usize,
    pub used: usize,
    pub used_by_machine: BTreeMap<String, usize>,
    pub excluded: usize,
    pub excluded_by_reason: BTreeMap<String, BTreeMap<String, usize>>,   // reason -> machine -> films
    pub flagged: usize,
    pub flagged_by_machine: BTreeMap<String, usize>,
    pub sn_range_mm: (f64, f64),
}

/// The films the rule keeps, in the order given, each with its mm per pixel; plus the counts.
#[derive(Clone, Debug, PartialEq)]
pub struct Plan { pub films: Vec<(String, f64)>, pub counts: ScaleCounts }

pub fn parse_header_resolution(text: &str) -> anyhow::Result<HashMap<String, HeaderRow>> {
    let mut lines = text.lines().enumerate().filter(|(_, l)| !l.trim().is_empty());
    match lines.next() {
        Some((_, h)) if h.trim() == HEADER_COLUMNS => {}
        other => bail!("{HEADER_FILE}: first line must be {HEADER_COLUMNS:?}, not {:?}", other.map(|(_, l)| l)),
    }
    let mut out = HashMap::new();
    for (i, line) in lines {
        let f: Vec<&str> = line.split(',').map(str::trim).collect();
        if f.len() != 8 { bail!("{HEADER_FILE} line {}: expected 8 columns", i + 1); }
        let reason = f[7].to_string();
        let mm_per_px = if f[6].is_empty() { None } else {
            let v: f64 = f[6].parse().with_context(|| format!("{HEADER_FILE} line {}: bad number {:?}", i + 1, f[6]))?;
            if !(v > 0.0 && v < 1.0) { bail!("{HEADER_FILE} line {}: mm_per_px {v} is out of range (0, 1)", i + 1); }
            Some(v)
        };
        if (reason == "real") != mm_per_px.is_some() {
            bail!("{HEADER_FILE} line {}: a value goes with reason \"real\" and only with it", i + 1);
        }
        out.insert(f[0].to_string(), HeaderRow { machine: f[1].to_string(), mm_per_px, reason });
    }
    Ok(out)
}

/// `<data>/header_resolution.csv`; a missing file is refused with a message that says how to make it.
pub fn load_header_resolution(data: &Path) -> anyhow::Result<HashMap<String, HeaderRow>> {
    let path = data.join(HEADER_FILE);
    let text = std::fs::read_to_string(&path).with_context(|| format!(
        "{} is missing or unreadable: an Aariz run needs it for {AARIZ_SCALE_RULE}. Make it by re-running \
         tools/dataset/prepare_aariz.py --zip <the Aariz zip>", path.display()))?;
    parse_header_resolution(&text)
}

pub fn decide(csv_mm_per_px: f64, h: &HeaderRow) -> anyhow::Result<Scale> {
    let m = h.machine.as_str();
    if CSV_SCALE_MACHINES.contains(&m) { return Ok(Scale::Use(csv_mm_per_px)); }
    if HEADER_SCALE_MACHINES.contains(&m) {
        return Ok(match h.mm_per_px { Some(v) => Scale::Use(v), None => Scale::Exclude(h.reason.clone()) });
    }
    if NO_SCALE_MACHINES.contains(&m) { return Ok(Scale::Exclude(NO_TRUE_SCALE.into())); }
    bail!("machine {m:?} is not one {AARIZ_SCALE_RULE} knows; refusing rather than guessing its scale")
}

/// Flagged when S–N is missing or outside `SN_RANGE_MM` (both ends allowed).
pub fn flagged(sn_mm: Option<f64>) -> bool {
    match sn_mm { Some(v) => !(SN_RANGE_MM.0..=SN_RANGE_MM.1).contains(&v), None => true }
}

pub fn plan(ids: &[String], spacing: &HashMap<String, f64>, header: &HashMap<String, HeaderRow>, gt: &crate::dataset::Points) -> anyhow::Result<Plan> {
    let mut c = ScaleCounts { aariz_scale_rule: AARIZ_SCALE_RULE.into(), films: ids.len(), sn_range_mm: SN_RANGE_MM, ..Default::default() };
    let mut films = Vec::new();
    for iid in ids {
        let csv = *spacing.get(iid).ok_or_else(|| anyhow::anyhow!("no spacing.csv row for {iid}"))?;
        let h = header.get(iid).ok_or_else(|| anyhow::anyhow!("no {HEADER_FILE} row for {iid}"))?;
        match decide(csv, h)? {
            Scale::Use(mm) => {
                c.used += 1;
                *c.used_by_machine.entry(h.machine.clone()).or_default() += 1;
                let sn = gt.get(iid).and_then(|t| crate::diag::truth_distance_mm(t, "S", "N", mm));
                if flagged(sn) { c.flagged += 1; *c.flagged_by_machine.entry(h.machine.clone()).or_default() += 1; }
                films.push((iid.clone(), mm));
            }
            Scale::Exclude(reason) => {
                c.excluded += 1;
                *c.excluded_by_reason.entry(reason).or_default().entry(h.machine.clone()).or_default() += 1;
            }
        }
    }
    if films.is_empty() { bail!("{AARIZ_SCALE_RULE} leaves no film to score in this selection ({} excluded)", c.excluded); }
    Ok(Plan { films, counts: c })
}

/// Whether the data folder is Aariz: its name, or its real (canonical) folder's name, is `aariz` in any case.
pub fn is_aariz(data: &Path) -> bool {
    let named = |p: &Path| p.file_name().is_some_and(|n| n.to_string_lossy().eq_ignore_ascii_case("aariz"));
    named(data) || std::fs::canonicalize(data).is_ok_and(|r| named(&r))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn row(machine: &str, mm: Option<f64>, reason: &str) -> HeaderRow { HeaderRow { machine: machine.into(), mm_per_px: mm, reason: reason.into() } }

    #[test] fn art_plus_and_promax_keep_the_dataset_value_even_when_the_header_has_one() {
        assert_eq!(decide(0.1, &row("ART Plus", None, "no resolution in header")).unwrap(), Scale::Use(0.1));
        assert_eq!(decide(0.139, &row("ProMax 2D", Some(0.127638), "real")).unwrap(), Scale::Use(0.139));
        assert_eq!(decide(0.139, &row("ProMax with ProTouch", Some(0.127638), "real")).unwrap(), Scale::Use(0.139));
    }
    #[test] fn hyperion_and_rotograph_use_the_header_value_not_the_dataset_value() {
        assert_eq!(decide(0.089, &row("Hyperion X5", Some(0.088531), "real")).unwrap(), Scale::Use(0.088531));
        assert_eq!(decide(0.089, &row("Hyperion X5", Some(0.2038), "real")).unwrap(), Scale::Use(0.2038));
        assert_eq!(decide(0.135, &row("Rotograph EVO", Some(0.073621), "real")).unwrap(), Scale::Use(0.073621));
    }
    #[test] fn hyperion_and_rotograph_without_a_real_header_are_excluded_under_the_header_reason() {
        assert_eq!(decide(0.089, &row("Hyperion X5", None, "default resolution")).unwrap(), Scale::Exclude("default resolution".into()));
        assert_eq!(decide(0.135, &row("Rotograph EVO", None, "no resolution in header")).unwrap(), Scale::Exclude("no resolution in header".into()));
    }
    #[test] fn smart3d_and_veraviewepocs_are_excluded_whatever_their_header_says() {
        assert_eq!(decide(0.1, &row("Smart3D", Some(0.25), "real")).unwrap(), Scale::Exclude(NO_TRUE_SCALE.into()));
        assert_eq!(decide(0.144, &row("Veraviewepocs 2D", None, "no resolution in header")).unwrap(), Scale::Exclude(NO_TRUE_SCALE.into()));
    }
    #[test] fn an_unknown_or_missing_machine_is_refused_by_name() {
        let e = decide(0.1, &row("Mystery 9000", None, "x")).unwrap_err().to_string();
        assert!(e.contains("Mystery 9000"), "{e}");
        assert!(decide(0.1, &row("", None, "x")).is_err());
    }
    #[test] fn the_flag_bounds_are_45_and_95_mm_inclusive() {
        assert!(flagged(Some(44.9)));
        assert!(!flagged(Some(45.0)));
        assert!(!flagged(Some(70.0)));
        assert!(!flagged(Some(95.0)));
        assert!(flagged(Some(95.1)));
        assert!(flagged(None));                                  // no S or N: cannot be checked, so it is flagged
    }

    fn truth(sn_px: f64) -> Vec<(String, f64, f64)> { vec![("S".into(), 100.0, 100.0), ("N".into(), 100.0 + sn_px, 100.0)] }
    fn fixture() -> (Vec<String>, HashMap<String, f64>, HashMap<String, HeaderRow>, crate::dataset::Points) {
        let films = [
            // id, machine, csv mm/px, header mm/px, header reason, S–N px
            ("a1", "ART Plus", 0.1, None, "no resolution in header", 700.0),
            ("h1", "Hyperion X5", 0.089, Some(0.25), "real", 280.0),                   // 70 mm at the header value
            ("h2", "Hyperion X5", 0.089, None, "default resolution", 280.0),
            ("r1", "Rotograph EVO", 0.135, Some(0.169333), "real", 880.0),              // 149 mm: flagged, still used
            ("s1", "Smart3D", 0.1, None, "no resolution in header", 280.0),
            ("v1", "Veraviewepocs 2D", 0.144, None, "default resolution", 300.0),
        ];
        let ids = films.iter().map(|f| f.0.to_string()).collect();
        let spacing = films.iter().map(|f| (f.0.to_string(), f.2)).collect();
        let header = films.iter().map(|f| (f.0.to_string(), row(f.1, f.3, f.4))).collect();
        let gt = films.iter().map(|f| (f.0.to_string(), truth(f.5))).collect();
        (ids, spacing, header, gt)
    }
    #[test] fn plan_keeps_the_used_films_in_order_with_their_scale() {
        let (ids, sp, hd, gt) = fixture();
        let p = plan(&ids, &sp, &hd, &gt).unwrap();
        assert_eq!(p.films, vec![("a1".to_string(), 0.1), ("h1".to_string(), 0.25), ("r1".to_string(), 0.169333)]);
    }
    #[test] fn plan_counts_every_film_by_machine_and_reason() {
        let (ids, sp, hd, gt) = fixture();
        let c = plan(&ids, &sp, &hd, &gt).unwrap().counts;
        assert_eq!((c.aariz_scale_rule.as_str(), c.films, c.used, c.excluded, c.flagged), (AARIZ_SCALE_RULE, 6, 3, 3, 1));
        assert_eq!(c.used_by_machine, [("ART Plus".to_string(), 1), ("Hyperion X5".to_string(), 1), ("Rotograph EVO".to_string(), 1)].into());
        assert_eq!(c.excluded_by_reason[NO_TRUE_SCALE], [("Smart3D".to_string(), 1), ("Veraviewepocs 2D".to_string(), 1)].into());
        assert_eq!(c.excluded_by_reason["default resolution"], [("Hyperion X5".to_string(), 1)].into());
        assert_eq!(c.flagged_by_machine, [("Rotograph EVO".to_string(), 1)].into());
        assert_eq!(c.sn_range_mm, SN_RANGE_MM);
    }
    #[test] fn a_flagged_film_is_still_scored() {
        let (ids, sp, hd, gt) = fixture();
        let p = plan(&ids, &sp, &hd, &gt).unwrap();
        assert!(p.films.iter().any(|(id, _)| id == "r1"), "flagged r1 must stay in the scored films");
        assert_eq!(p.counts.used + p.counts.excluded, p.counts.films);
    }
    #[test] fn plan_refuses_a_film_without_a_header_row_or_spacing_row_or_when_nothing_is_left() {
        let (ids, sp, mut hd, gt) = fixture();
        let mut sp2 = sp.clone(); sp2.remove("a1");
        assert!(plan(&ids, &sp2, &hd, &gt).unwrap_err().to_string().contains("spacing"));
        hd.remove("h1");
        assert!(plan(&ids, &sp, &hd, &gt).unwrap_err().to_string().contains(HEADER_FILE));
        let (_, sp, hd, gt) = fixture();
        let only_excluded = vec!["s1".to_string(), "v1".to_string()];
        let e = plan(&only_excluded, &sp, &hd, &gt).unwrap_err().to_string();
        assert!(e.contains("no film"), "{e}");
    }
    #[test] fn header_csv_parses_and_refuses_bad_rows() {
        let ok = format!("{HEADER_COLUMNS}\nx1,Hyperion X5,bmp,4907,4906,px/m,0.203810,real\nx2,Smart3D,jpeg,1,1,aspect only,,no resolution in header\n");
        let m = parse_header_resolution(&ok).unwrap();
        assert_eq!(m["x1"], row("Hyperion X5", Some(0.20381), "real"));
        assert_eq!(m["x2"], row("Smart3D", None, "no resolution in header"));
        assert!(parse_header_resolution("image_id,mm_per_px\nx1,0.1\n").is_err(), "wrong columns");
        assert!(parse_header_resolution(&format!("{HEADER_COLUMNS}\nx1,Hyperion X5,bmp,1,1,px/m,,real\n")).is_err(), "real without a value");
        assert!(parse_header_resolution(&format!("{HEADER_COLUMNS}\nx1,Hyperion X5,bmp,1,1,px/m,1.5,real\n")).is_err(), "out of (0, 1)");
        assert!(parse_header_resolution(&format!("{HEADER_COLUMNS}\nx1,Hyperion X5,bmp,1,1,px/m,0.2,default resolution\n")).is_err(), "a value on a row that is not real");
    }
    #[test] fn a_missing_header_csv_is_refused_with_how_to_make_it() {
        let d = tempfile::tempdir().unwrap();
        let e = load_header_resolution(d.path()).unwrap_err().to_string();
        assert!(e.contains(HEADER_FILE) && e.contains("prepare_aariz.py"), "{e}");
    }
    #[test] fn is_aariz_reads_the_folder_name_in_any_case_and_through_a_link() {
        let d = tempfile::tempdir().unwrap();
        for n in ["aariz", "Aariz2", "ceph400"] { std::fs::create_dir_all(d.path().join(n)).unwrap(); }
        assert!(is_aariz(&d.path().join("aariz")));
        assert!(is_aariz(&d.path().join("AARIZ")), "the name is compared without case (macOS and Windows ignore it)");
        assert!(!is_aariz(&d.path().join("ceph400")));
        assert!(!is_aariz(&d.path().join("Aariz2")));
        #[cfg(unix)] {
            std::os::unix::fs::symlink(d.path().join("aariz"), d.path().join("other")).unwrap();
            assert!(is_aariz(&d.path().join("other")), "a link to the Aariz folder is still Aariz");
        }
    }
}
