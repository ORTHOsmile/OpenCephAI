use crate::{catalog::{Format, Model}, fill::fill, pth::{read_state_dict, PthError}};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[derive(Debug)]
pub enum InstallError { Changed, NotWeights, Mismatch(String), Converted, Disk(u32), Io(std::io::Error) }
impl std::fmt::Display for InstallError {
    fn fmt(&self, f: &mut std::fmt::Formatter) -> std::fmt::Result {
        match self {   // spec 2026-10-01 Part 4, word for word
            Self::Changed => write!(f, "The authors' file has changed since this version of OpenCephAI was made, so it can't be checked. Nothing was installed."),
            Self::NotWeights => write!(f, "This file contains something other than model weights. Nothing was installed."),
            Self::Mismatch(t) => write!(f, "This file doesn't match {t}. Nothing was installed."),
            Self::Converted => write!(f, "Conversion didn't give the expected result. Nothing was installed."),
            Self::Disk(mb) => write!(f, "Not enough disk space: {mb} MB needed."),
            Self::Io(e) => write!(f, "{e}"),
        }
    }
}
impl std::error::Error for InstallError {}
impl From<std::io::Error> for InstallError {
    fn from(e: std::io::Error) -> Self { if e.kind() == std::io::ErrorKind::StorageFull { Self::Disk(0) } else { Self::Io(e) } }
}

pub fn sha256_bytes(b: &[u8]) -> String { Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect() }
pub fn sha256_file(p: &Path) -> std::io::Result<String> {
    let mut h = Sha256::new();
    std::io::copy(&mut std::fs::File::open(p)?, &mut h)?;
    Ok(h.finalize().iter().map(|x| format!("{x:02x}")).collect())
}

/// The authors' file → `work/model` (spec Part 2, steps 1–4). With `pin` the two SHA-256 checks are skipped (catalogue
/// upkeep only). On any error `work/model` is removed; the caller deletes `work`.
pub fn convert(m: &Model, source: &Path, work: &Path, pin: bool) -> Result<PathBuf, InstallError> {
    let e = &m.entry;
    let res = (|| {
        std::fs::create_dir_all(work)?;
        let src_sha = sha256_file(source)?;
        if !pin && !src_sha.eq_ignore_ascii_case(e.source.sha256()) { return Err(InstallError::Changed); }
        if e.format == Format::Onnx {
            let dir = work.join("model");
            let built = (|| {
                std::fs::create_dir_all(&dir)?;
                std::fs::copy(source, dir.join("model.onnx"))?;
                let mut man = e.manifest.clone();
                man["file"] = "model.onnx".into();
                man["sha256"] = src_sha.clone().into();
                std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(&man).expect("a JSON value serialises"))?;
                Ok(dir.clone())
            })();
            if built.is_err() { std::fs::remove_dir_all(&dir).ok(); }
            return built;
        }
        let pth = match e.source.zip_member() {
            Some(member) => {
                let mismatch = || InstallError::Mismatch(e.title.clone());
                let mut z = zip::ZipArchive::new(std::fs::File::open(source)?).map_err(|_| mismatch())?;
                let name = (0..z.len()).filter_map(|i| z.name_for_index(i).map(str::to_string)).find(|n| n.ends_with(member)).ok_or_else(mismatch)?;
                let out = work.join("checkpoint.pt");
                let mut r = z.by_name(&name).map_err(|_| mismatch())?;
                std::io::copy(&mut r, &mut std::fs::File::create(&out)?)?;
                out
            }
            None => source.to_path_buf(),
        };
        let tensors = read_state_dict(&pth, &e.state_dict, &e.strip_prefixes).map_err(|err| match err {
            PthError::Unsafe(_) => InstallError::NotWeights,
            _ => InstallError::Mismatch(e.title.clone()),
        })?;
        let dir = work.join("model");
        let built = (|| {
            std::fs::create_dir_all(&dir)?;
            if !pin && sha256_bytes(&m.skeleton) != e.skeleton_sha256 { return Err(InstallError::Converted); }
            std::fs::write(dir.join("model.onnx"), &m.skeleton)?;
            fill(&m.layout, &tensors, &dir.join(&m.layout.weights_file), &e.title)?;
            let w_sha = sha256_file(&dir.join(&m.layout.weights_file))?;
            if !pin && !w_sha.eq_ignore_ascii_case(&e.weights_sha256) { return Err(InstallError::Converted); }
            let mut man = e.manifest.clone();
            man["file"] = "model.onnx".into();
            man["sha256"] = sha256_bytes(&m.skeleton).into();
            man["weights"] = serde_json::json!({ "file": m.layout.weights_file, "sha256": w_sha });
            std::fs::write(dir.join("manifest.json"), serde_json::to_vec_pretty(&man).expect("a JSON value serialises"))?;
            Ok(dir.clone())
        })();
        if built.is_err() { std::fs::remove_dir_all(&dir).ok(); }
        built
    })();
    res.map_err(|err| match err { InstallError::Disk(_) => InstallError::Disk(e.size_mb * 2), other => other })   // room for the source and the result
}
