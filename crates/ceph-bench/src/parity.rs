use crate::dataset::Points;
use anyhow::{bail, Context};
use std::collections::BTreeMap;

/// Distance in pixels between Rust and Python predictions for the same images and landmarks.
#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Parity { pub max_px: f64, pub mean_px: f64, pub n: usize, pub per_landmark: BTreeMap<String, (f64, f64)> }   // (max, mean)

impl Parity { pub fn passes(&self, max_px: f64) -> bool { self.max_px <= max_px } }

/// Every (image, landmark) in `rust` must exist in `python`; anything missing is an error, never a silent pass.
pub fn parity(rust: &Points, python: &Points) -> anyhow::Result<Parity> {
    let mut per: BTreeMap<String, Vec<f64>> = BTreeMap::new();
    for (iid, pts) in rust {
        let py = python.get(iid).with_context(|| format!("image {iid} missing from the Python predictions"))?;
        for (lm, x, y) in pts {
            let Some((_, px, pyy)) = py.iter().find(|(l, _, _)| l == lm) else { bail!("{iid}/{lm} missing from the Python predictions") };
            per.entry(lm.clone()).or_default().push((x - px).hypot(y - pyy));
        }
    }
    let all: Vec<f64> = per.values().flatten().copied().collect();
    if all.is_empty() { bail!("no predictions to compare"); }
    let stats = |v: &[f64]| (v.iter().copied().fold(0.0, f64::max), v.iter().sum::<f64>() / v.len() as f64);
    let (max_px, mean_px) = stats(&all);
    Ok(Parity { max_px, mean_px, n: all.len(), per_landmark: per.iter().map(|(k, v)| (k.clone(), stats(v))).collect() })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dataset::parse_points;
    #[test] fn measures_max_and_mean_distance_per_landmark() {
        let r = parse_points("i,l,x,y\n001,S,0,0\n001,N,10,10\n002,S,5,5\n002,N,0,0\n").unwrap();
        let p = parse_points("i,l,x,y,c\n001,S,0.3,0.4,1\n001,N,10,10,1\n002,S,5,5,1\n002,N,0,0.1,1\n").unwrap();
        let q = parity(&r, &p).unwrap();
        assert!((q.max_px - 0.5).abs() < 1e-12 && (q.mean_px - 0.15).abs() < 1e-12);
        assert!((q.per_landmark["S"].0 - 0.5).abs() < 1e-12 && (q.per_landmark["N"].0 - 0.1).abs() < 1e-12);
        assert!(q.passes(0.5) && !q.passes(0.4));
    }
    #[test] fn missing_image_or_landmark_is_an_error_not_a_pass() {
        let r = parse_points("i,l,x,y\n001,S,0,0\n002,S,0,0\n").unwrap();
        assert!(parity(&r, &parse_points("i,l,x,y\n001,S,0,0\n").unwrap()).is_err());
        assert!(parity(&r, &parse_points("i,l,x,y\n001,N,0,0\n002,S,0,0\n").unwrap()).is_err());
    }
}
