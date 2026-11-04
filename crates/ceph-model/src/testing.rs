//! Test helpers shared with the Tauri tests: pickles and PyTorch files written the way torch.save writes them.
//! Synthetic values only.
use std::io::Write;

/// A protocol-2 pickle builder.
pub struct P(pub Vec<u8>);
impl Default for P { fn default() -> Self { Self::new() } }
impl P {
    pub fn new() -> Self { P(vec![0x80, 2]) }
    pub fn op(mut self, b: u8) -> Self { self.0.push(b); self }
    pub fn global(mut self, m: &str, n: &str) -> Self { self.0.push(b'c'); self.0.extend(format!("{m}\n{n}\n").bytes()); self }
    pub fn s(mut self, v: &str) -> Self { self.0.push(b'X'); self.0.extend((v.len() as u32).to_le_bytes()); self.0.extend(v.bytes()); self }
    pub fn int(mut self, v: i32) -> Self { self.0.push(b'J'); self.0.extend(v.to_le_bytes()); self }
    pub fn mark(self) -> Self { self.op(b'(') }
    pub fn tuple(self) -> Self { self.op(b't') }
    pub fn reduce(self) -> Self { self.op(b'R') }
    pub fn od(self) -> Self { self.global("collections", "OrderedDict").op(b')').reduce() }
    /// _rebuild_tensor_v2(storage(key, numel), offset, size, stride, False, OrderedDict()); `legacy` adds the
    /// sixth persistent-id field (view metadata = None) that pre-1.6 files carry.
    fn tensor_with(self, storage: &str, numel: i32, offset: i32, size: &[i32], stride: &[i32], legacy: bool) -> Self {
        let mut p = self.global("torch._utils", "_rebuild_tensor_v2").mark()
            .mark().s("storage").global("torch", "FloatStorage").s(storage).s("cpu").int(numel);
        if legacy { p = p.op(b'N'); }
        p = p.tuple().op(b'Q').int(offset).mark();
        for v in size { p = p.int(*v); }
        p = p.tuple().mark();
        for v in stride { p = p.int(*v); }
        p.tuple().op(0x89).od().tuple().reduce()
    }
    pub fn tensor(self, storage: &str, numel: i32, offset: i32, size: &[i32], stride: &[i32]) -> Self { self.tensor_with(storage, numel, offset, size, stride, false) }
    pub fn legacy_tensor(self, storage: &str, numel: i32, offset: i32, size: &[i32], stride: &[i32]) -> Self { self.tensor_with(storage, numel, offset, size, stride, true) }
    pub fn stop(self) -> Vec<u8> { let mut v = self.0; v.push(b'.'); v }
}

/// A torch.save-style zip (torch ≥ 1.6): archive/data.pkl, archive/data/<key>, archive/byteorder.
pub fn write_pth(path: &std::path::Path, pkl: &[u8], storages: &[(&str, Vec<f32>)]) {
    let mut z = zip::ZipWriter::new(std::fs::File::create(path).unwrap());
    let o = zip::write::SimpleFileOptions::default().compression_method(zip::CompressionMethod::Stored);
    z.start_file("archive/data.pkl", o).unwrap(); z.write_all(pkl).unwrap();
    z.start_file("archive/byteorder", o).unwrap(); z.write_all(b"little").unwrap();
    for (k, vals) in storages {
        z.start_file(format!("archive/data/{k}"), o).unwrap();
        for v in vals { z.write_all(&v.to_le_bytes()).unwrap(); }
    }
    z.finish().unwrap();
}

/// A pre-1.6 torch.save file (GU2Net's best.pt): magic, protocol 1001, sys info, the main pickle, the storage keys,
/// then each storage as int64 element count + raw little-endian data.
pub fn write_legacy_pth(path: &std::path::Path, pkl: &[u8], storages: &[(&str, Vec<f32>)]) {
    let mut f = Vec::new();
    f.extend([0x80, 2, 0x8a, 10, 0x6c, 0xfc, 0x9c, 0x46, 0xf9, 0x20, 0x6a, 0xa8, 0x50, 0x19, b'.']);   // magic 0x1950a86a20f9469cfc6c
    f.extend([0x80, 2, b'M', 0xe9, 0x03, b'.']);                                                      // protocol 1001
    f.extend(P::new().op(b'}').stop());                                                               // sys info
    f.extend(pkl);
    let mut keys = P::new().op(b']').mark();
    for (k, _) in storages { keys = keys.s(k); }
    f.extend(keys.op(b'e').stop());
    for (_, vals) in storages {
        f.extend((vals.len() as i64).to_le_bytes());
        for v in vals { f.extend(v.to_le_bytes()); }
    }
    std::fs::write(path, f).unwrap();
}

/// {"model_state_dict": {"module.w": [2,3], "b": [3]}, "epoch": 3, "optimizer": <torch.optim.adam.Adam>}
pub fn checkpoint() -> Vec<u8> {
    P::new().op(b'}').mark()
        .s("model_state_dict").od().mark()
            .s("module.w").tensor("0", 6, 0, &[2, 3], &[3, 1])
            .s("b").tensor("1", 3, 0, &[3], &[1])
        .op(b'u')
        .s("epoch").int(3)
        .s("optimizer").global("torch.optim.adam", "Adam").op(b')').reduce()
    .op(b'u').stop()
}

const FIX: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures");
/// A checkpoint for the tiny skeleton, with a `module.` prefix and an extra tensor the skeleton doesn't use.
pub fn tiny_pth(dir: &std::path::Path) -> std::path::PathBuf {
    let f = dir.join("tiny.pt");
    let pkl = P::new().op(b'}').mark().s("state_dict").od().mark()
        .s("module.w").tensor("0", 6, 0, &[2, 3, 1, 1], &[3, 1, 1, 1]).s("module.b").tensor("1", 2, 0, &[2], &[1])
        .s("module.extra").tensor("2", 1, 0, &[1], &[1])
        .op(b'u').op(b'u').stop();
    write_pth(&f, &pkl, &[("0", vec![1., 0., 0., 0., 1., 0.]), ("1", vec![0.5, -0.5]), ("2", vec![9.])]);
    f
}
/// The tiny skeleton as a catalogue model with the given pins (input 8 × 8, two channels mapped to S and N).
pub fn tiny_model(source_sha: &str, weights_sha: &str) -> crate::catalog::Model {
    let skeleton = std::fs::read(format!("{FIX}/tiny.onnx")).unwrap();
    let layout = serde_json::from_str(&std::fs::read_to_string(format!("{FIX}/tiny.layout.json")).unwrap()).unwrap();
    let entry = serde_json::from_value(serde_json::json!({
        "id": "tiny", "title": "Tiny", "tier": "standard", "citation": "SYNTHETIC test", "sizeMb": 1,
        "licence": {"version": "1", "code": "MIT", "weights": "test", "summary": "test", "url": "https://example.invalid", "nonCommercial": false},
        "source": {"kind": "huggingface", "repo": "x/y", "revision": "r", "file": "tiny.pt", "sha256": source_sha},
        "stateDict": ["model_state_dict", "state_dict", ""], "stripPrefixes": ["module."],
        "skeleton": "tiny.onnx", "skeletonSha256": crate::install::sha256_bytes(&skeleton), "weightsSha256": weights_sha,
        "head": ["w", "b"], "leakage": {},
        "manifest": {"manifestVersion": 2, "id": "tiny", "version": "t", "title": "Tiny",
            "input": {"name": "image", "width": 8, "height": 8, "channels": 3, "resize": {"kind": "stretch"},
                      "normalize": {"kind": "fixed", "mean": [0, 0, 0], "std": [1, 1, 1], "scale": 255.0}},
            "output": {"name": "heatmaps", "width": 8, "height": 8, "stride": 1, "heatmapCenter": "corner", "decode": {"kind": "argmax"}},
            "landmarkMap": ["S", "N"]}
    })).unwrap();
    crate::catalog::Model { entry, skeleton, layout }
}
/// A finished ONNX file (weights inside) as a catalogue model with the given source pin: two channels mapped to
/// S and N, input 8 × 8, output 2 × 8 × 8, manifest otherwise like `tiny_model`.
pub fn tiny_full_model(source_sha: &str) -> crate::catalog::Model {
    let entry = serde_json::from_value(serde_json::json!({
        "id": "tiny-full", "title": "Tiny Full", "tier": "standard", "citation": "SYNTHETIC test", "sizeMb": 1,
        "licence": {"version": "1", "code": "MIT", "weights": "test", "summary": "test", "url": "https://example.invalid", "nonCommercial": false},
        "source": {"kind": "huggingface", "repo": "x/y", "revision": "r", "file": "tiny-full.onnx", "sha256": source_sha},
        "format": "onnx",
        "leakage": {},
        "manifest": {"manifestVersion": 2, "id": "tiny-full", "version": "t", "title": "Tiny Full",
            "input": {"name": "image", "width": 8, "height": 8, "channels": 3, "resize": {"kind": "stretch"},
                      "normalize": {"kind": "fixed", "mean": [0, 0, 0], "std": [1, 1, 1], "scale": 255.0}},
            "output": {"name": "heatmaps", "width": 8, "height": 8, "stride": 1, "heatmapCenter": "corner", "decode": {"kind": "argmax"}},
            "landmarkMap": ["S", "N"]}
    })).unwrap();
    crate::catalog::Model { entry, skeleton: Vec::new(), layout: crate::catalog::SkeletonLayout::default() }
}
/// The weights SHA-256 a conversion of `src` gives (checks skipped), for pinning the tiny model in tests.
pub fn pinned_weights(src: &std::path::Path) -> String {
    let work = tempfile_dir();
    let dir = crate::install::convert(&tiny_model("", ""), src, &work, true).unwrap();
    let sha = crate::install::sha256_file(&dir.join("weights.bin")).unwrap();
    std::fs::remove_dir_all(&work).ok();
    sha
}
fn tempfile_dir() -> std::path::PathBuf {
    use std::sync::atomic::{AtomicUsize, Ordering};
    static N: AtomicUsize = AtomicUsize::new(0);
    std::env::temp_dir().join(format!("ceph-model-pin-{}-{}", std::process::id(), N.fetch_add(1, Ordering::SeqCst)))
}
