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
    /// One file of a Zenodo VERSION record (never the all-versions DOI, which always points at the newest version: a new
    /// version would fail the SHA-256 check and break every install). The whole-film check's region finder (1.2.1).
    Zenodo { record: String, file: String, sha256: String },
}
impl Source {
    pub fn url(&self) -> String {
        match self {
            Self::Huggingface { repo, revision, file, .. } => format!("https://huggingface.co/{repo}/resolve/{revision}/{file}"),
            Self::Gdrive { id, .. } => format!("https://drive.usercontent.google.com/download?id={id}&export=download&confirm=t"),
            Self::Zenodo { record, file, .. } => format!("https://zenodo.org/api/records/{record}/files/{file}/content"),
        }
    }
    /// Where a person downloads it by hand.
    pub fn page(&self) -> String {
        match self {
            Self::Huggingface { repo, .. } => format!("https://huggingface.co/{repo}"),
            Self::Gdrive { id, page, .. } => if page.is_empty() { format!("https://drive.google.com/file/d/{id}/view") } else { page.clone() },
            Self::Zenodo { record, .. } => format!("https://zenodo.org/records/{record}"),
        }
    }
    pub fn sha256(&self) -> &str { match self { Self::Huggingface { sha256, .. } | Self::Gdrive { sha256, .. } | Self::Zenodo { sha256, .. } => sha256 } }
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

/// The whole-film check's region finder (1.2.1): downloaded in Models…, kept apart from the landmark catalogue so it is
/// never offered as a tracing model (`builtin()` holds no `check-regions`). `files` are fetched in order (the small
/// manifest first) into `<models>/<folder>`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CheckEntry {
    pub id: String, pub title: String, pub author: String, pub size_mb: u32, pub licence: Licence,
    pub citation: String, pub folder: String, pub files: Vec<Source>,
}
const CHECK: &str = include_str!("../catalog/check.json");
/// The check model's one entry.
pub fn check_model() -> CheckEntry { serde_json::from_str(CHECK).expect("check.json is valid (tests)") }

#[cfg(test)]
mod tests {
    use super::*;
    /// The check model downloads from the VERSION record (23965907), never the all-versions DOI. Fails if the URL or the
    /// page takes any other form.
    #[test] fn the_zenodo_source_gives_the_version_records_download_and_page() {
        let s = Source::Zenodo { record: "23965907".into(), file: "model.onnx".into(), sha256: "a".repeat(64) };
        assert_eq!(s.url(), "https://zenodo.org/api/records/23965907/files/model.onnx/content");
        assert_eq!(s.page(), "https://zenodo.org/records/23965907");
        assert_eq!(s.sha256(), "a".repeat(64));
        assert_eq!(s.zip_member(), None);
    }
    /// The check model has its own entry, never offered as a tracing model. Fails if `builtin()` holds it, or the entry's
    /// words, size, licence, folder or files change.
    #[test] fn the_check_model_is_not_a_landmark_model() {
        assert!(builtin().iter().all(|m| m.entry.id != "check-regions"), "never offered as a tracing model");
        let c = check_model();
        assert_eq!((c.id.as_str(), c.title.as_str(), c.author.as_str(), c.size_mb, c.folder.as_str()),
            ("check-regions", "Region finder for the whole-film check", "Dr Linton Nash", 121, "regions"));
        assert_eq!((c.licence.code.as_str(), c.licence.non_commercial), ("CC BY 4.0", false));
        let names: Vec<_> = c.files.iter().map(|f| match f { Source::Zenodo { record, file, .. } => (record.as_str(), file.as_str()), _ => panic!("not zenodo") }).collect();
        assert_eq!(names, [("23965907", "manifest.json"), ("23965907", "model.onnx")], "manifest first, then the model; the version record");
        assert!(c.citation.contains("10.5281/zenodo.23949953"));
        assert!(!c.citation.contains("v1"), "the credit gives the all-versions DOI and no version name: {}", c.citation);
        assert!(!c.citation.contains("23965907"), "the version record is where the files come from, not the credit");
    }
    /// Edge: an entry whose source kind is unknown does not parse.
    #[test] fn a_check_entry_with_an_unknown_source_kind_fails_to_parse() {
        let bad = CHECK.replace("\"zenodo\"", "\"ftp\"");
        let e = serde_json::from_str::<CheckEntry>(&bad).unwrap_err();
        println!("unknown kind: {e}");
        assert!(e.to_string().contains("unknown variant"), "{e}");
    }
}
