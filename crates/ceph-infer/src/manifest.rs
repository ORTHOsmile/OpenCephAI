use crate::transform::{HeatmapCenter, ResizeMode};
use serde::Deserialize;
use sha2::{Digest, Sha256};
use std::path::Path;

/// `models/manifest.json`, written by tools/model/convert_hrnet_to_onnx.py. Unknown keys are ignored.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Manifest {
    pub id: String,
    pub version: String,
    pub file: String,
    pub sha256: String,
    pub input: InputSpec,
    pub output: OutputSpec,
    pub landmarks: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
pub struct InputSpec { pub name: String, pub size: u32, pub resize: ResizeMode, pub mean: [f32; 3], pub std: [f32; 3] }
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutputSpec { pub name: String, pub stride: u32, pub size: u32, pub heatmap_center: HeatmapCenter, pub window: usize }

impl Manifest {
    /// Refuse a model file whose SHA-256 does not match the manifest (tampered, truncated or mismatched).
    pub fn verify_sha256(&self, model: &Path) -> anyhow::Result<()> {
        let got: String = Sha256::digest(std::fs::read(model)?).iter().map(|b| format!("{b:02x}")).collect();
        anyhow::ensure!(got.eq_ignore_ascii_case(&self.sha256),
            "model {} has sha256 {got}, manifest expects {}", model.display(), self.sha256);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::transform::{HeatmapCenter, ResizeMode};
    const JSON: &str = r#"{"id": "hrnet-w32-isbi19", "version": "v", "file": "m.onnx", "sha256": "SHA",
        "input": {"name": "image", "size": 768, "resize": "letterbox", "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
        "output": {"name": "heatmaps", "stride": 4, "size": 192, "heatmapCenter": "corner", "window": 11},
        "landmarks": ["S", "N"], "trainingNote": "ignored"}"#;

    #[test] fn parses_the_converter_manifest_format() {
        let m: Manifest = serde_json::from_str(JSON).unwrap();
        assert_eq!((m.input.resize, m.output.heatmap_center), (ResizeMode::Letterbox, HeatmapCenter::Corner));
        assert_eq!((m.input.size, m.output.stride, m.output.size, m.output.window), (768, 4, 192, 11));
        assert_eq!(m.landmarks, vec!["S", "N"]);
    }
    #[test] fn verify_sha256_accepts_match_and_refuses_mismatch() {
        let dir = std::env::temp_dir().join(format!("ceph-infer-test-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let f = dir.join("m.onnx"); std::fs::write(&f, b"abc").unwrap();
        let mut m: Manifest = serde_json::from_str(JSON).unwrap();
        m.sha256 = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad".into();   // sha256("abc")
        assert!(m.verify_sha256(&f).is_ok());
        m.sha256 = "00".repeat(32);
        assert!(m.verify_sha256(&f).is_err());
        std::fs::remove_dir_all(&dir).ok();
    }
}
