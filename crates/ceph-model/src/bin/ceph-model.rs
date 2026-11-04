//! Catalogue upkeep and CI: `inspect` lists a PyTorch file's tensors; `convert` runs the app's install conversion.
use ceph_model::{catalog, install, pth};
use std::path::Path;
fn arg(args: &[String], k: &str) -> Option<String> { args.iter().position(|a| a == k).and_then(|i| args.get(i + 1).cloned()) }
fn all(args: &[String], k: &str) -> Vec<String> { args.windows(2).filter(|w| w[0] == k).map(|w| w[1].clone()).collect() }
const USAGE: &str = "usage: ceph-model inspect <file> [--key K]… [--strip P]… | convert --id ID --source FILE --out DIR [--pin] [--catalog DIR]";
fn main() -> anyhow::Result<()> {
    let args: Vec<String> = std::env::args().collect();
    match args.get(1).map(String::as_str) {
        Some("inspect") => {
            let file = args.get(2).ok_or_else(|| anyhow::anyhow!(USAGE))?;
            let mut keys = all(&args, "--key");
            if keys.is_empty() { keys = vec!["model_state_dict".into(), "state_dict".into(), "".into()]; }
            let sd = pth::read_state_dict(Path::new(file), &keys, &all(&args, "--strip"))?;
            let out: serde_json::Map<String, serde_json::Value> = sd.iter().map(|(k, t)| (k.clone(), serde_json::json!({
                "dtype": t.dtype.onnx_name(), "shape": t.shape, "sha256": install::sha256_bytes(&t.data) }))).collect();
            println!("{}", serde_json::to_string_pretty(&out)?);
        }
        Some("convert") => {
            let id = arg(&args, "--id").ok_or_else(|| anyhow::anyhow!(USAGE))?;
            let models = match arg(&args, "--catalog") { Some(d) => catalog::load_dir(Path::new(&d))?, None => catalog::builtin() };
            let m = models.into_iter().find(|m| m.entry.id == id).ok_or_else(|| anyhow::anyhow!("no model {id} in the catalogue"))?;
            let (src, out) = (arg(&args, "--source").ok_or_else(|| anyhow::anyhow!(USAGE))?, arg(&args, "--out").ok_or_else(|| anyhow::anyhow!(USAGE))?);
            let dir = install::convert(&m, Path::new(&src), Path::new(&out), args.iter().any(|a| a == "--pin"))?;
            println!("source sha256   {}", install::sha256_file(Path::new(&src))?);
            if m.entry.format == catalog::Format::Pth {
                println!("skeleton sha256 {}", install::sha256_bytes(&m.skeleton));
                println!("weights sha256  {}", install::sha256_file(&dir.join(&m.layout.weights_file))?);
            }
            println!("model folder    {}", dir.display());
        }
        _ => anyhow::bail!(USAGE),
    }
    Ok(())
}
