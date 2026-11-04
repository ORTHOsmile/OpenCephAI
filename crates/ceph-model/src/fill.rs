use crate::{catalog::SkeletonLayout, install::InstallError, pth::Tensor};
use std::{collections::BTreeMap, io::{Seek, SeekFrom, Write}, path::Path};

/// Writes weights.bin: each skeleton tensor's bytes at its offset, zeros between, so the same download always gives
/// the same bytes. Every skeleton tensor must be found once, with the same type and shape. Extra tensors in the file
/// (another task's branch, optimiser state) are ignored.
pub fn fill(layout: &SkeletonLayout, tensors: &BTreeMap<String, Tensor>, out: &Path, title: &str) -> Result<(), InstallError> {
    let mismatch = || InstallError::Mismatch(title.to_string());
    let mut f = std::fs::File::create(out)?;
    f.set_len(layout.total)?;
    for t in &layout.tensors {
        let src = tensors.get(&t.key).ok_or_else(mismatch)?;
        if src.dtype.onnx_name() != t.dtype || src.shape != t.shape || src.data.len() as u64 != t.length { return Err(mismatch()); }
        f.seek(SeekFrom::Start(t.offset))?;
        f.write_all(&src.data)?;
    }
    f.sync_all()?;
    Ok(())
}
