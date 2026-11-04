//! CI parity helper (plan ruling 2): one film through a model exactly as the app runs it.
//! Usage: dump <manifest.json> <film> <out dir> → input.f32, heatmaps.f32, points.json (every channel, film pixels),
//! provider.txt (provider and ms for the run; CEPHTRACE_PROVIDER=cpu or coreml-fp32 picks one, see Engine::load).
use ceph_infer::engine::{load_gray, points_from_heatmaps, Engine};
use std::path::{Path, PathBuf};
fn main() -> anyhow::Result<()> {
    let a: Vec<String> = std::env::args().collect();
    anyhow::ensure!(a.len() == 4, "usage: dump <manifest.json> <film> <out dir>");
    let (engine, out) = (Engine::load(Path::new(&a[1]))?, PathBuf::from(&a[3]));
    let img = load_gray(Path::new(&a[2]))?;
    let t = std::time::Instant::now();
    let (input, hm, g) = engine.run_raw(&img, false)?;
    let ms = t.elapsed().as_secs_f64() * 1e3;                  // after Engine::load's warm-up run
    std::fs::create_dir_all(&out)?;
    let bytes = |v: &[f32]| v.iter().flat_map(|f| f.to_le_bytes()).collect::<Vec<u8>>();
    std::fs::write(out.join("input.f32"), bytes(&input))?;
    std::fs::write(out.join("heatmaps.f32"), bytes(&hm))?;
    let (_, raw) = points_from_heatmaps(engine.manifest(), &g, &hm, img.width(), false);
    std::fs::write(out.join("points.json"), serde_json::to_vec(&raw)?)?;
    std::fs::write(out.join("provider.txt"), format!("{} {ms:.0}", engine.provider()))?;
    Ok(())
}
