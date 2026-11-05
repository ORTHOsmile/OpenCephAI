//! Chain spec §6: nothing in the app reads the Ceph-400 proof. Fails if any app or library source names it.
//! Positive control: add the comment `// chain-proof` to apps/desktop/src/App.tsx → this fails; remove it.
//! A name guard only (final review M8): it looks for the proof's name in the app and library sources listed below. It
//! does not catch code that reads `reports/` under another name, and it does not read `apps/desktop/e2e`.
use std::path::{Path, PathBuf};
fn sources(dir: &Path, out: &mut Vec<PathBuf>) {
    for e in std::fs::read_dir(dir).unwrap() {
        let p = e.unwrap().path();
        let name = p.file_name().unwrap().to_string_lossy().to_string();
        if p.is_dir() { if !["node_modules", "target", "dist", "gen"].contains(&name.as_str()) { sources(&p, out); } }
        else if ["rs", "ts", "tsx", "json", "sql", "css"].iter().any(|x| name.ends_with(&format!(".{x}"))) { out.push(p); }
    }
}
#[test] fn no_app_or_library_source_names_the_chain_proof() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let mut all = vec![];
    for d in ["apps/desktop/src", "apps/desktop/src-tauri/src", "crates/ceph-store/src", "crates/ceph-model/src", "crates/ceph-infer/src", "crates/ceph-label/src"] {
        sources(&root.join(d), &mut all);
    }
    assert!(all.len() > 100, "the instrument reads {} files", all.len());
    let hits: Vec<&PathBuf> = all.iter().filter(|p| std::fs::read_to_string(p).map(|s| { let s = s.to_lowercase(); s.contains("chain-proof") || s.contains("chainproof") }).unwrap_or(false)).collect();
    assert!(hits.is_empty(), "app or library code names the chain proof: {hits:?}");
}
