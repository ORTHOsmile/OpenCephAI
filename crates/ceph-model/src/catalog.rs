//! The models CephTrace offers (spec 2026-10-01 Part 2). Each entry ships with a weight-free ONNX skeleton and the
//! layout of its external weights; the weights themselves never ship.
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::Path};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub id: String, pub title: String, pub tier: Tier, pub citation: String, pub size_mb: u32,
    pub licence: Licence, pub source: Source,
    /// `Pth` (default): a weight-free skeleton here plus the authors' PyTorch checkpoint, filled in by `install::convert`.
    /// `Onnx`: the authors publish one finished ONNX file with its weights inside; install just copies and checks it.
    #[serde(default)]
    pub format: Format,
    /// Top-level keys to try for the weights, in order ("" = the top level itself). Unused for `Onnx`.
    #[serde(default)]
    pub state_dict: Vec<String>,
    #[serde(default)]
    pub strip_prefixes: Vec<String>,
    #[serde(default)]
    pub skeleton: String,
    #[serde(default)]
    pub skeleton_sha256: String,
    /// SHA-256 of the finished weights.bin: the same download always gives the same bytes. Unused for `Onnx`.
    #[serde(default)]
    pub weights_sha256: String,
    /// The final layer's tensor keys (groundwork for the personal network, spec Part 5). Unused for `Onnx`.
    #[serde(default)]
    pub head: Vec<String>,
    /// Dataset → "clean" | "leaked" | … for the bench report.
    pub leakage: BTreeMap<String, String>,
    /// Manifest v2 without its file and SHA fields; install fills them in.
    pub manifest: serde_json::Value,
}
/// How an entry's weights reach the app: `Pth` converts the authors' PyTorch checkpoint onto a weight-free skeleton
/// that ships here; `Onnx` ships as one finished ONNX file with its weights inside, installed by copying it after
/// the source SHA-256 check.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Format { #[default] Pth, Onnx }
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum Tier { Standard, Optional }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Licence { pub version: String, pub code: String, pub weights: String, pub summary: String, pub url: String, pub non_commercial: bool }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum Source {
    Huggingface { repo: String, revision: String, file: String, sha256: String },
    /// `zip_member`: the checkpoint is inside a zip (GU2Net's download).
    #[serde(rename_all = "camelCase")]
    Gdrive { id: String, sha256: String, #[serde(default)] zip_member: Option<String>, #[serde(default)] page: String },
}
impl Source {
    pub fn url(&self) -> String {
        match self {
            Self::Huggingface { repo, revision, file, .. } => format!("https://huggingface.co/{repo}/resolve/{revision}/{file}"),
            Self::Gdrive { id, .. } => format!("https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t"),
        }
    }
    /// Where a person downloads it by hand.
    pub fn page(&self) -> String {
        match self {
            Self::Huggingface { repo, .. } => format!("https://huggingface.co/{repo}"),
            Self::Gdrive { id, page, .. } => if page.is_empty() { format!("https://drive.google.com/file/d/{id}/view") } else { page.clone() },
        }
    }
    pub fn sha256(&self) -> &str { match self { Self::Huggingface { sha256, .. } | Self::Gdrive { sha256, .. } => sha256 } }
    pub fn zip_member(&self) -> Option<&str> { match self { Self::Gdrive { zip_member, .. } => zip_member.as_deref(), _ => None } }
}
#[derive(Clone, Debug, Default, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SkeletonLayout { pub weights_file: String, pub total: u64, pub tensors: Vec<LayoutTensor> }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct LayoutTensor {
    /// The checkpoint key (named "tensor" in the JSON so secret scanners do not read `"key": "…"` lines as API keys).
    #[serde(rename = "tensor")] pub key: String, pub dtype: String, pub shape: Vec<usize>, pub offset: u64, pub length: u64 }
#[derive(Clone, Debug)]
pub struct Model { pub entry: Entry, pub skeleton: Vec<u8>, pub layout: SkeletonLayout }

/// A catalogue folder: catalog.json (an array of entries) plus each entry's skeleton and `<id>.layout.json`.
pub fn load_dir(dir: &Path) -> anyhow::Result<Vec<Model>> {
    let entries: Vec<Entry> = serde_json::from_slice(&std::fs::read(dir.join("catalog.json"))?)?;
    entries.into_iter().map(|entry| {
        if entry.format == Format::Onnx { return Ok(Model { entry, skeleton: Vec::new(), layout: SkeletonLayout::default() }); }
        let skeleton = std::fs::read(dir.join(&entry.skeleton))?;
        let layout = serde_json::from_slice(&std::fs::read(dir.join(format!("{}.layout.json", entry.id)))?)?;
        Ok(Model { entry, skeleton, layout })
    }).collect()
}

const BUILTIN: &[(&str, &[u8], &str)] = &[
    ("cwlachap-hrnet-w32", include_bytes!("../catalog/cwlachap-hrnet-w32.onnx"), include_str!("../catalog/cwlachap-hrnet-w32.layout.json")),
    ("gu2net-isbi19", include_bytes!("../catalog/gu2net-isbi19.onnx"), include_str!("../catalog/gu2net-isbi19.layout.json")),
    ("srpose-cldet23", include_bytes!("../catalog/srpose-cldet23.onnx"), include_str!("../catalog/srpose-cldet23.layout.json")),
];
const CATALOG: &str = include_str!("../catalog/catalog.json");
/// The models CephTrace offers, in the Manager's order. Skeletons and layouts are built in; weights never are.
pub fn builtin() -> Vec<Model> {
    let entries: Vec<Entry> = serde_json::from_str(CATALOG).expect("catalog.json is valid (tests/catalog.rs)");
    entries.into_iter().map(|entry| {
        if entry.format == Format::Onnx { return Model { entry, skeleton: Vec::new(), layout: SkeletonLayout::default() }; }
        let (_, skeleton, layout) = BUILTIN.iter().find(|(id, _, _)| *id == entry.id).expect("every entry has a skeleton");
        Model { entry, skeleton: skeleton.to_vec(), layout: serde_json::from_str(layout).expect("layout is valid (tests/catalog.rs)") }
    }).collect()
}
