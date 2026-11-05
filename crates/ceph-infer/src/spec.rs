use crate::manifest::Manifest;
use crate::transform::{HeatmapCenter, ResizeMode};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::path::Path;

/// Manifest v2 (spec 2026-10-01 Part 2), one per installed model. v1 (Week 1's `models/manifest.json`) is still read.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelSpec {
    pub manifest_version: u32,
    pub id: String,
    pub version: String,
    #[serde(default)] pub title: String,
    pub file: String,
    pub sha256: String,
    /// External weights beside `file` (ONNX external data); None for a model with its weights inside.
    #[serde(default)] pub weights: Option<FileRef>,
    pub input: Input,
    pub output: Output,
    /// One entry per output channel: our landmark id, or None for a channel not used yet (e.g. SRPose's 20–38).
    pub landmark_map: Vec<Option<String>>,
    #[serde(default)] pub training_note: String,
    /// Where it runs on a Mac, chosen per model from real-film parity (Mac peer, 2 Oct 2026). Absent: full-precision
    /// CoreML, measured exact for the HRNet that Week 1's v1 manifest carries.
    #[serde(default)] pub runtime: Runtime,
}
/// `Coreml`: CoreML's default, which may compute in half precision (moved cwlachap landmarks up to 20 px).
/// `CoremlFp32`: ML Program on CPU and GPU without half-precision accumulation. `Cpu`: ONNX Runtime's CPU kernels.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Runtime { Cpu, Coreml, #[default] CoremlFp32 }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct FileRef { pub file: String, pub sha256: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct Input { pub name: String, pub width: u32, pub height: u32, pub channels: u32, #[serde(default)] pub layout: Layout, pub resize: Resize, pub normalize: Normalize }
/// `Cwh`: the image is transposed before it goes in (GU2Net), so tensor axis 2 is x.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Layout { #[default] Chw, Cwh }
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Resize {
    Letterbox { #[serde(default)] interp: Interp },
    Stretch { #[serde(default)] interp: Interp, #[serde(default)] coords: Coords },
    /// MMPose top-down on the whole film: box [0, 0, w, h] × `padding`, widened to the input's aspect, warpAffine.
    Topdown { padding: f64 },
}
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Interp { #[default] Cv2Linear, PilBicubic, PilBilinear }
/// How input pixels map to film pixels: half-pixel centres (cv2 / §2), or corners (GU2Net's labels: x · new / old).
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Coords { #[default] HalfPixel, Corner }
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Normalize {
    /// (v / scale − mean_c) / std_c, the grey film copied to each channel.
    Fixed { mean: [f32; 3], std: [f32; 3], scale: f32 },
    /// (v − mean) / (sd + 1e-20) over the resized film (GU2Net).
    Zscore,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Output { pub name: String, pub width: u32, pub height: u32, pub stride: u32, pub heatmap_center: HeatmapCenter, pub decode: Decode }
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Decode { Softargmax { window: usize }, Argmax, Dark { kernel: usize } }

impl ModelSpec {
    pub fn from_v1(m: Manifest) -> Self {
        let resize = match m.input.resize {
            ResizeMode::Letterbox => Resize::Letterbox { interp: Interp::Cv2Linear },
            ResizeMode::Stretch => Resize::Stretch { interp: Interp::Cv2Linear, coords: Coords::HalfPixel },
        };
        Self {
            manifest_version: 2, id: m.id, version: m.version, title: String::new(), file: m.file, sha256: m.sha256, weights: None,
            input: Input { name: m.input.name, width: m.input.size, height: m.input.size, channels: 3, layout: Layout::Chw, resize,
                normalize: Normalize::Fixed { mean: m.input.mean, std: m.input.std, scale: 255.0 } },
            output: Output { name: m.output.name, width: m.output.size, height: m.output.size, stride: m.output.stride,
                heatmap_center: m.output.heatmap_center, decode: Decode::Softargmax { window: m.output.window } },
            landmark_map: m.landmarks.into_iter().map(Some).collect(),
            training_note: String::new(), runtime: Runtime::default(),
        }
    }
    /// A v2 manifest, or a v1 one converted.
    pub fn load(path: &Path) -> anyhow::Result<Self> {
        let v: serde_json::Value = serde_json::from_slice(&std::fs::read(path)?)?;
        if v.get("manifestVersion").and_then(|x| x.as_u64()) == Some(2) { Ok(serde_json::from_value(v)?) }
        else { Ok(Self::from_v1(serde_json::from_value(v)?)) }
    }
    /// Refuses a model or weights file whose SHA-256 differs from the manifest (tampered, truncated or mismatched).
    pub fn verify(&self, dir: &Path) -> anyhow::Result<()> {
        check(&dir.join(&self.file), &self.sha256)?;
        if let Some(w) = &self.weights { check(&dir.join(&w.file), &w.sha256)?; }
        Ok(())
    }
    /// This model's fingerprint (`fingerprint`), from the hashes `verify` checks at every load.
    pub fn fingerprint(&self) -> String { fingerprint(&self.sha256, self.weights.as_ref().map(|w| w.sha256.as_str())) }
}

/// Which version of a model this is (Part F, owner Q9): the SHA-256 of its one file, or, when its weights sit in a
/// second file, the SHA-256 of "<network file SHA-256>+<weights file SHA-256>" (lower case), so a new weights file under
/// the same name changes it. Every run stores this (`Detection.model_sha256`).
pub fn fingerprint(file_sha256: &str, weights_sha256: Option<&str>) -> String {
    let f = file_sha256.to_ascii_lowercase();
    match weights_sha256 {
        None => f,
        Some(w) => Sha256::digest(format!("{f}+{}", w.to_ascii_lowercase()).as_bytes()).iter().map(|b| format!("{b:02x}")).collect(),
    }
}

/// Streams the file through SHA-256 (weights can be hundreds of MB).
pub fn sha256_file(path: &Path) -> anyhow::Result<String> {
    let mut h = Sha256::new();
    std::io::copy(&mut std::fs::File::open(path)?, &mut h)?;
    Ok(h.finalize().iter().map(|b| format!("{b:02x}")).collect())
}
fn check(path: &Path, want: &str) -> anyhow::Result<()> {
    let got = sha256_file(path)?;
    anyhow::ensure!(got.eq_ignore_ascii_case(want), "{} has sha256 {got}, the manifest expects {want}", path.display());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    const V1: &str = r#"{"id": "hrnet-w32-isbi19", "version": "v", "file": "m.onnx", "sha256": "SHA",
        "input": {"name": "image", "size": 768, "resize": "letterbox", "mean": [0.485, 0.456, 0.406], "std": [0.229, 0.224, 0.225]},
        "output": {"name": "heatmaps", "stride": 4, "size": 192, "heatmapCenter": "corner", "window": 11}, "landmarks": ["S", "N"]}"#;
    const V2: &str = r#"{"manifestVersion": 2, "id": "gu2net-isbi19", "version": "best.pt", "title": "GU2Net", "file": "model.onnx", "sha256": "A",
        "weights": {"file": "weights.bin", "sha256": "B"},
        "input": {"name": "image", "width": 416, "height": 512, "channels": 1, "layout": "cwh",
                  "resize": {"kind": "stretch", "interp": "pil-bicubic", "coords": "corner"}, "normalize": {"kind": "zscore"}},
        "output": {"name": "heatmaps", "width": 416, "height": 512, "stride": 1, "heatmapCenter": "corner", "decode": {"kind": "argmax"}},
        "landmarkMap": ["S", null]}"#;
    #[test] fn a_v1_manifest_reads_as_v2() {
        let m = ModelSpec::from_v1(serde_json::from_str(V1).unwrap());
        assert_eq!((m.input.width, m.input.height, m.input.channels, m.input.layout), (768, 768, 3, Layout::Chw));
        assert_eq!(m.input.normalize, Normalize::Fixed { mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225], scale: 255.0 });
        assert_eq!(m.output.decode, Decode::Softargmax { window: 11 });
        assert_eq!(m.landmark_map, vec![Some("S".to_string()), Some("N".to_string())]);
    }
    #[test] fn pil_bilinear_is_read_from_the_manifest() {
        let r: Resize = serde_json::from_str(r#"{"kind": "stretch", "interp": "pil-bilinear", "coords": "corner"}"#).unwrap();
        assert_eq!(r, Resize::Stretch { interp: Interp::PilBilinear, coords: Coords::Corner });
    }
    #[test] fn load_tells_v1_from_v2() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join("a.json"), V1).unwrap();
        std::fs::write(d.path().join("b.json"), V2).unwrap();
        assert_eq!(ModelSpec::load(&d.path().join("a.json")).unwrap().id, "hrnet-w32-isbi19");
        let b = ModelSpec::load(&d.path().join("b.json")).unwrap();
        assert_eq!((b.input.layout, b.output.decode, b.landmark_map[1].clone()), (Layout::Cwh, Decode::Argmax, None));
    }
    /// Part F Task 3 (owner Q9): the fingerprint covers the weights file, so a new weights file under the same name is
    /// seen. Values: SRPose's pinned network and weights files (catalog.json, 18 Oct).
    #[test] fn the_fingerprint_covers_both_files_and_a_one_file_model_keeps_its_hash() {
        const NET: &str = "61b601aa6194e1142a39e5159fd498611257d82af0c68106bc18cc983228e368";
        const W: &str = "70fe793b5a70a3bf419f0ab68168d455d3ee9de219ded109968fcd9e6fc5f40c";
        let srpose = fingerprint(NET, Some(W));
        assert_eq!(srpose, "09e6d41d36cac80eafc5af2b8d493f8e00203bd50dcb08fd24ca3fd2a8bf08ae");
        assert_eq!(fingerprint(&NET.to_uppercase(), Some(&W.to_uppercase())), srpose, "case does not matter");
        assert_ne!(fingerprint(NET, Some(&"0".repeat(64))), srpose, "a new weights file, same network: a new fingerprint");
        assert_ne!(fingerprint(&"1".repeat(64), Some(W)), srpose, "a new network file, same weights: a new fingerprint");
        assert_eq!(fingerprint("CACD38", None), "cacd38", "one file: its own hash, as stored before");
    }
}
