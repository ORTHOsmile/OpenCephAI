use anyhow::{bail, Context};
use std::{collections::HashMap, path::Path};

/// image_id → [(landmark, x, y)] in file order. Accepts gt.csv (`image_id,landmark,x,y`) and
/// predictions.csv (`image_id,landmark,x,y,confidence`); extra columns are ignored.
pub type Points = HashMap<String, Vec<(String, f64, f64)>>;
pub type Splits = HashMap<String, Vec<String>>;

pub fn parse_points(text: &str) -> anyhow::Result<Points> {
    let mut out = Points::new();
    for (i, line) in text.lines().enumerate().skip(1).filter(|(_, l)| !l.trim().is_empty()) {
        let f: Vec<&str> = line.split(',').collect();
        if f.len() < 4 { bail!("line {}: expected image_id,landmark,x,y", i + 1); }
        let num = |s: &str| s.trim().parse::<f64>().with_context(|| format!("line {}: bad number {s:?}", i + 1));
        out.entry(f[0].to_string()).or_default().push((f[1].to_string(), num(f[2])?, num(f[3])?));
    }
    Ok(out)
}
pub fn load_points(path: &Path) -> anyhow::Result<Points> {
    parse_points(&std::fs::read_to_string(path).with_context(|| path.display().to_string())?)
}

pub fn parse_splits(text: &str) -> anyhow::Result<Splits> { Ok(serde_json::from_str(text)?) }
pub fn load_splits(path: &Path) -> anyhow::Result<Splits> {
    parse_splits(&std::fs::read_to_string(path).with_context(|| path.display().to_string())?)
}

/// Image ids for any split name the dataset has, plus `all`. `all` keeps Ceph-400's historical
/// `train, test1, test2` order when those keys are present, then any other keys in sorted order.
pub fn select(s: &Splits, split: &str) -> anyhow::Result<Vec<String>> {
    if split != "all" {
        let ids = s.get(split).cloned().ok_or_else(|| {
            let mut keys: Vec<&str> = s.keys().map(String::as_str).collect();
            keys.sort();
            anyhow::anyhow!("no split {split:?}; this dataset has {}", keys.join(", "))
        })?;
        if ids.is_empty() { bail!("split {split:?} selects no images"); }
        return Ok(ids);
    }
    let preferred = ["train", "test1", "test2"];
    let mut rest: Vec<&str> = s.keys().map(String::as_str).filter(|k| !preferred.contains(k)).collect();
    rest.sort();
    let names: Vec<&str> = preferred.iter().filter(|k| s.contains_key(**k)).copied().chain(rest).collect();
    let ids: Vec<String> = names.iter().flat_map(|n| s.get(*n).cloned().unwrap_or_default()).collect();
    if ids.is_empty() { bail!("split {split:?} selects no images"); }
    Ok(ids)
}

/// Per-film pixel spacing: `<data>/spacing.csv` with header `image_id,mm_per_px`. Every value must be
/// `0 < mm_per_px < 1` (a sane film spacing); a zero, negative or implausible value is refused by line.
pub fn load_spacing(path: &Path) -> anyhow::Result<HashMap<String, f64>> {
    let text = std::fs::read_to_string(path).with_context(|| path.display().to_string())?;
    let mut out = HashMap::new();
    for (i, line) in text.lines().enumerate().skip(1).filter(|(_, l)| !l.trim().is_empty()) {
        let f: Vec<&str> = line.split(',').collect();
        if f.len() < 2 { bail!("line {}: expected image_id,mm_per_px", i + 1); }
        let v: f64 = f[1].trim().parse().with_context(|| format!("line {}: bad number {:?}", i + 1, f[1]))?;
        if !(v > 0.0 && v < 1.0) { bail!("line {}: mm_per_px {v} is out of range (0, 1)", i + 1); }
        out.insert(f[0].to_string(), v);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn parses_gt_csv_in_file_order() {
        let gt = parse_points("image_id,landmark,x,y\n001,S,834.0,995.0\n001,N,1472.0,1028.0\n").unwrap();
        assert_eq!(gt["001"], vec![("S".to_string(), 834.0, 995.0), ("N".to_string(), 1472.0, 1028.0)]);
    }
    #[test] fn parses_predictions_csv_ignoring_extra_columns() {
        let p = parse_points("image_id,landmark,x,y,confidence\n007,S,1.5,2.5,0.93\n").unwrap();
        assert_eq!(p["007"], vec![("S".to_string(), 1.5, 2.5)]);
    }
    #[test] fn rejects_a_malformed_row() { assert!(parse_points("image_id,landmark,x,y\n001,S,oops,1\n").is_err()); }
    #[test] fn selects_split_ids() {
        let s = parse_splits(r#"{"train":["001"],"test1":["151","152"],"test2":["301"]}"#).unwrap();
        assert_eq!(select(&s, "test1").unwrap(), vec!["151", "152"]);
        assert_eq!(select(&s, "all").unwrap(), vec!["001", "151", "152", "301"]);
        assert!(select(&s, "nope").is_err());
        let empty = parse_splits(r#"{"train":[],"test1":["151"],"test2":[]}"#).unwrap();
        assert!(select(&empty, "train").is_err(), "an empty selection must fail, not report MRE = NaN");
    }
    #[test] fn select_accepts_any_named_split_and_all_in_key_order() {
        let s: Splits = serde_json::from_str(r#"{"train":["a"],"valid":["b"],"test":["c","d"]}"#).unwrap();
        assert_eq!(select(&s, "test").unwrap(), vec!["c", "d"]);
        assert_eq!(select(&s, "valid").unwrap(), vec!["b"]);
        assert_eq!(select(&s, "all").unwrap().len(), 4);
        assert!(select(&s, "test1").is_err());                       // a name the dataset doesn't have is an error, not empty
    }
    #[test] fn spacing_csv_reads_id_and_mm_per_px_and_rejects_bad_rows() {
        let d = tempfile::tempdir().unwrap(); let p = d.path().join("spacing.csv");
        std::fs::write(&p, "image_id,mm_per_px\nx1,0.1\nx2,0.127\n").unwrap();
        let m = load_spacing(&p).unwrap();
        assert_eq!((m["x1"], m["x2"]), (0.1, 0.127));
        std::fs::write(&p, "image_id,mm_per_px\nx1,0\n").unwrap();
        assert!(load_spacing(&p).is_err());                           // zero or negative spacing is refused
    }
}
