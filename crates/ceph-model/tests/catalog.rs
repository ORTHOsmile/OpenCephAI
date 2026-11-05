use ceph_model::{catalog::{builtin, Format}, install::sha256_bytes};
#[test] fn every_builtin_model_is_consistent() {
    let models = builtin();
    assert_eq!(models.iter().map(|m| m.entry.id.as_str()).collect::<Vec<_>>(), ["cwlachap-hrnet-w32", "gu2net-isbi19", "srpose-cldet23", "aariz-cepha29"]);
    for m in &models {
        // Mac runtime from real-film parity (2 Oct): exact and fastest. Default CoreML moved cwlachap points 20 px;
        // full-precision CoreML moved GU2Net's 36 px while its CPU run is exact and as fast. Aariz (7 Oct): coreml-fp32
        // matched onnxruntime CPU to 0.0001 px on the 150 Aariz test films.
        let want = if m.entry.id == "gu2net-isbi19" { "cpu" } else { "coreml-fp32" };
        assert_eq!(m.entry.manifest["runtime"], want, "{}: runtime", m.entry.id);
        if m.entry.format == Format::Onnx {
            let sha = m.entry.source.sha256();
            assert!(matches!(m.entry.source, ceph_model::catalog::Source::Huggingface { .. }), "{}: onnx entries ship from huggingface", m.entry.id);
            assert!(sha.len() == 64 && sha.chars().all(|c| c.is_ascii_hexdigit()), "{}: sha256 is not 64 hex chars", m.entry.id);
            continue;
        }
        assert_eq!(sha256_bytes(&m.skeleton), m.entry.skeleton_sha256, "{}: skeleton hash", m.entry.id);
        let mut end = 0;
        for t in &m.layout.tensors {
            assert_eq!(t.offset % 64, 0);
            assert!(t.offset >= end, "{}: {} overlaps", m.entry.id, t.key);
            end = t.offset + t.length;
        }
        assert!(m.layout.total >= end);
        for h in &m.entry.head { assert!(m.layout.tensors.iter().any(|t| &t.key == h), "{}: head key {h} not in the layout", m.entry.id); }
        let map = m.entry.manifest["landmarkMap"].as_array().unwrap();
        assert!(map.len() == 19 || map.len() == 38);
        assert!(m.entry.licence.non_commercial, "{}: the owner chose non-commercial labels for all three (1 Oct)", m.entry.id);
        let pinned = |s: &str| s.len() == 64 && s.chars().any(|c| c != '0');
        assert!(pinned(&m.entry.weights_sha256) && pinned(m.entry.source.sha256()), "{}: hashes pinned", m.entry.id);
    }
}
#[test] fn aariz_entry_is_cc_by_fp32_and_maps_its_29_channels_as_ruled() {
    let m = ceph_model::catalog::builtin().into_iter().find(|m| m.entry.id == "aariz-cepha29").expect("aariz entry");
    let e = &m.entry;
    assert_eq!(e.format, ceph_model::catalog::Format::Onnx);
    assert_eq!((e.licence.code.as_str(), e.licence.non_commercial), ("CC BY 4.0", false));
    assert_eq!(e.source.sha256(), "cacd38201ada69fa7d3ea2566cb63b315302f35e3c66fb483a6eed32c88f14c5");   // FP32 (owner, 7 Oct)
    let map: Vec<Option<String>> = serde_json::from_value(e.manifest["landmarkMap"].clone()).unwrap();
    let want = ["A","ANS","Ar","B","Co","Gn","Go","L1A","L1T","L6","","LL","UL","Me","N","Ns","Or","PNS","Prn","Po","Pog","PogS","","S","Sn","U1A","U1T","U6",""];
    assert_eq!(map.len(), 29);
    for (i, w) in want.iter().enumerate() { assert_eq!(map[i].as_deref().unwrap_or(""), *w, "channel {i}"); }
    assert_eq!(e.manifest["input"]["width"], 768);
    assert_eq!(e.manifest["output"]["width"], 192);
    // Parity with the uploader's own script (7 Oct): Pillow's BILINEAR, not cv2's (120 of 3900 Aariz test points moved).
    assert_eq!(e.manifest["input"]["resize"]["interp"], "pil-bilinear");
    // Decode chosen on the Aariz valid split (150 films, ruling P11): DARK 1.133 mm vs argmax 1.210 mm MRE.
    // Test stays held out: DARK scores 1.168 mm on the 150 Aariz test films.
    assert_eq!(e.manifest["output"]["decode"], serde_json::json!({"kind": "dark", "kernel": 11}));
}
#[test] fn srpose_map2_keeps_the_original_19_and_names_20_to_38_from_cl_detection_fig3() {
    let m = ceph_model::catalog::builtin().into_iter().find(|m| m.entry.id == "srpose-cldet23").unwrap();
    let map: Vec<Option<String>> = serde_json::from_value(m.entry.manifest["landmarkMap"].clone()).unwrap();
    let original = ["S","N","Or","Po","A","B","Pog","Me","Gn","Go","L1T","U1T","UL","LL","Sn","PogS","PNS","ANS","Ar"];
    let fig3 = ["D","U1A","L1A","Cm","PTM","Co","Prn","Ba","Pt","Bo","ULs","LLs","GnS","MeS","G","Ns","Cerv","U6","L6"];
    assert_eq!(map.len(), 38);
    for (i, id) in original.iter().chain(fig3.iter()).enumerate() { assert_eq!(map[i].as_deref(), Some(*id), "channel {i}"); }
    assert_eq!(m.entry.manifest["version"], "cldet23-trainval-map2");
}

// Owner 13 Oct (rename): the catalog's notes reach the bench report, so they say OpenCephAI, never the old name.
#[test] fn the_catalog_text_uses_the_new_app_name() {
    let text = include_str!("../catalog/catalog.json");
    let old: Vec<&str> = text.lines().filter(|l| l.contains("CephTrace")).collect();
    assert!(old.is_empty(), "old app name in catalog.json: {old:?}");
}
/// Automatic best spec §7: the virtual model is never a catalogue entry, so no proof, weights check or install can see it.
/// Positive control: add an entry with id "auto-best" to catalog/catalog.json → this fails; remove it.
#[test] fn the_catalogue_never_lists_automatic_best() {
    let ids: Vec<String> = ceph_model::catalog::builtin().into_iter().map(|m| m.entry.id).collect();
    assert!(ids.len() >= 4 && ids.contains(&"aariz-cepha29".to_string()), "the instrument reads the catalogue: {ids:?}");
    assert!(!ids.iter().any(|i| i == "auto-best"), "{ids:?}");
}
