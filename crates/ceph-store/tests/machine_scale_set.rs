//! Task MS-7 (spec 2026-10-20): the "after" state of the before/after. Opens the SYNTHETIC library that
//! `machine_scale_sweep.rs build_library` made on main (format 12), which upgrades it to format 13 with one safety
//! copy, and sets machine m1's scale to 0.0998 mm/px for films of 400 × 300 px, as Film layouts would. Branch only;
//! env-driven and `#[ignore]`d. Synthetic films only.
use ceph_store::{Library, MachineScaleRow};
use std::path::PathBuf;

#[test] #[ignore] fn set_scale() {
    let root = PathBuf::from(std::env::var("MS_LIB").expect("set MS_LIB"));
    let mut lib = Library::open(&root).unwrap();
    let copy = lib.upgrade_copy().expect("opening a format-12 library makes one safety copy").to_path_buf();
    let name = copy.file_name().unwrap().to_string_lossy().to_string();
    assert!(name.starts_with("OpenCephAI backup before upgrade 12→13 "), "{name}");
    assert_eq!(std::fs::read_dir(copy.parent().unwrap()).unwrap().count(), 1, "one safety copy");
    let change = lib.set_machine_scale("m1", Some(&MachineScaleRow { spacing_mm: 0.0998, width_px: 400, height_px: 300, source: "entered".into(), set_at: None })).unwrap();
    let tp = |id: &str| lib.load(id).unwrap().timepoint;
    let films: Vec<String> = change.films.iter().map(|id| tp(id)).collect();
    let fitted: Vec<String> = change.fitted.iter().map(|id| tp(id)).collect();
    println!("set_scale: m1 = 0.0998 mm/px at 400 × 300; ScaleChange films {films:?}, fitted {fitted:?}, deleted {}; safety copy {name}", change.deleted);
    assert_eq!((films, fitted, change.deleted), (vec!["b-match".to_string(), "c-match".to_string()], vec!["e-fitted".to_string()], 1));
}
