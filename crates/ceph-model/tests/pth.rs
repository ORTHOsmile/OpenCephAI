use ceph_model::pth::{read_state_dict, DType, PthError};
use ceph_model::testing::*;

fn f32s(b: &[u8]) -> Vec<f32> { b.chunks(4).map(|c| f32::from_le_bytes(c.try_into().unwrap())).collect() }
fn keys(k: &[&str]) -> Vec<String> { k.iter().map(|s| s.to_string()).collect() }

#[test] fn reads_the_state_dict_and_ignores_the_optimiser_without_running_it() {
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("best.pt");
    write_pth(&f, &checkpoint(), &[("0", vec![1., 2., 3., 4., 5., 6.]), ("1", vec![7., 8., 9.])]);
    let sd = read_state_dict(&f, &keys(&["model_state_dict", "state_dict", ""]), &keys(&["module."])).unwrap();
    assert_eq!(sd.keys().collect::<Vec<_>>(), ["b", "w"]);
    assert_eq!((sd["w"].dtype, sd["w"].shape.clone()), (DType::F32, vec![2, 3]));
    assert_eq!(f32s(&sd["w"].data), [1., 2., 3., 4., 5., 6.]);
    assert_eq!(f32s(&sd["b"].data), [7., 8., 9.]);
}
#[test] fn reads_the_legacy_pre_1_6_format_too() {
    // GU2Net's best.pt (2021) is a legacy file: magic, protocol, sys info, pickle, storage keys, raw storages.
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("legacy.pt");
    let pkl = P::new().op(b'}').mark().s("model_state_dict").od().mark()
        .s("module.w").legacy_tensor("140", 6, 0, &[2, 3], &[3, 1])
        .s("b").legacy_tensor("141", 3, 0, &[3], &[1])
        .op(b'u').s("optimizer").global("torch.optim.adam", "Adam").op(b')').reduce().op(b'u').stop();
    write_legacy_pth(&f, &pkl, &[("140", vec![1., 2., 3., 4., 5., 6.]), ("141", vec![7., 8., 9.])]);
    let sd = read_state_dict(&f, &keys(&["model_state_dict"]), &keys(&["module."])).unwrap();
    assert_eq!(f32s(&sd["w"].data), [1., 2., 3., 4., 5., 6.]);
    assert_eq!(f32s(&sd["b"].data), [7., 8., 9.]);
}
#[test] fn a_file_that_calls_os_system_is_refused() {
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("evil.pt");
    let pkl = P::new().global("os", "system").mark().s("echo hi").tuple().reduce().stop();
    write_pth(&f, &pkl, &[]);
    assert!(matches!(read_state_dict(&f, &keys(&[""]), &[]), Err(PthError::Unsafe(g)) if g == "os.system"));
    for g in ["eval", "exec", "__import__", "open", "compile"] {
        write_pth(&f, &P::new().global("builtins", g).stop(), &[]);
        assert!(matches!(read_state_dict(&f, &keys(&[""]), &[]), Err(PthError::Unsafe(_))), "builtins.{g}");
    }
    let legacy = d.path().join("evil-legacy.pt");
    write_legacy_pth(&legacy, &P::new().global("subprocess", "Popen").stop(), &[]);
    assert!(matches!(read_state_dict(&legacy, &keys(&[""]), &[]), Err(PthError::Unsafe(_))));
}
#[test] fn a_strided_tensor_is_gathered_into_c_order() {
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("t.pt");
    // w = storage[0..6] viewed as 3 × 2 with stride (1, 3): the transpose of [[1,2,3],[4,5,6]]
    let pkl = P::new().od().mark().s("w").tensor("0", 6, 0, &[3, 2], &[1, 3]).op(b'u').stop();
    write_pth(&f, &pkl, &[("0", vec![1., 2., 3., 4., 5., 6.])]);
    let sd = read_state_dict(&f, &keys(&[""]), &[]).unwrap();
    assert_eq!(f32s(&sd["w"].data), [1., 4., 2., 5., 3., 6.]);
}
#[test] fn not_pytorch_and_no_state_dict_are_told_apart() {
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("x.pt");
    std::fs::write(&f, b"not a model file").unwrap();
    assert!(matches!(read_state_dict(&f, &keys(&[""]), &[]), Err(PthError::NotPyTorch)));
    write_pth(&f, &P::new().int(3).stop(), &[]);
    assert!(matches!(read_state_dict(&f, &keys(&["state_dict"]), &[]), Err(PthError::NoStateDict)));
}
#[test] fn a_pickled_scheduler_using_getattr_is_inert_and_accepted() {
    // GU2Net's best.pt pickles a CyclicLR scheduler whose bound method is stored as __builtin__.getattr(obj, name).
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("sched.pt");
    let pkl = P::new().op(b'}').mark()
        .s("model_state_dict").od().mark().s("w").tensor("0", 2, 0, &[2], &[1]).op(b'u')
        .s("scheduler").global("__builtin__", "getattr").mark()
            .global("torch.optim.lr_scheduler", "CyclicLR").op(b')').reduce().s("_triangular_scale_fn").tuple().reduce()
        .op(b'u').stop();
    write_pth(&f, &pkl, &[("0", vec![1., 2.])]);
    let sd = read_state_dict(&f, &keys(&["model_state_dict"]), &[]).unwrap();
    assert_eq!(sd["w"].shape, vec![2]);
}

#[test] fn a_tensor_whose_shape_overflows_is_refused_not_allocated() {
    // Three dimensions of i32::MAX: their product does not fit in a usize (the pickle's shape numbers are 32-bit).
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("huge.pt");
    let pkl = P::new().op(b'}').mark().s("w").tensor("0", 6, 0, &[i32::MAX, i32::MAX, i32::MAX], &[2, 1, 1]).op(b'u').stop();
    write_pth(&f, &pkl, &[("0", vec![1., 2., 3., 4., 5., 6.])]);
    let e = read_state_dict(&f, &keys(&[""]), &[]).unwrap_err();
    assert!(matches!(e, PthError::Format(ref m) if m.contains("too large")), "{e}");
}
#[test] fn a_tensor_bigger_than_its_storage_is_refused_before_it_is_allocated() {
    // 2^32 floats claimed against a 6-float storage: the byte count fits, but cannot be read.
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("big.pt");
    let pkl = P::new().op(b'}').mark().s("w").tensor("0", 6, 0, &[i32::MAX, 2], &[2, 1]).op(b'u').stop();
    write_pth(&f, &pkl, &[("0", vec![1., 2., 3., 4., 5., 6.])]);
    let t = std::time::Instant::now();
    let e = read_state_dict(&f, &keys(&[""]), &[]).unwrap_err();
    assert!(matches!(e, PthError::Format(ref m) if m.contains("too large")), "{e}");
    assert!(t.elapsed().as_secs() < 1);
}
#[test] fn a_legacy_storage_count_past_the_cap_is_refused_quickly() {
    assert_eq!(ceph_model::pth::MAX_ENTRY_BYTES, 2 << 30);
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("legacy-huge.pt");
    let pkl = P::new().op(b'}').mark().s("w").legacy_tensor("140", 6, 0, &[2, 3], &[3, 1]).op(b'u').stop();
    write_legacy_pth(&f, &pkl, &[("140", vec![1., 2., 3., 4., 5., 6.])]);
    // Overwrite the storage's int64 count (the 8 bytes before its data, at the end of the file) with 2^40.
    let mut b = std::fs::read(&f).unwrap(); let at = b.len() - 6 * 4 - 8;
    b[at..at + 8].copy_from_slice(&(1u64 << 40).to_le_bytes()); std::fs::write(&f, &b).unwrap();
    let t = std::time::Instant::now();
    let e = read_state_dict(&f, &keys(&[""]), &[]).unwrap_err();
    assert!(matches!(e, PthError::Format(ref m) if m.contains("too large")), "{e}");
    assert!(t.elapsed().as_secs() < 1);
}
#[test] fn a_legacy_storage_count_of_u64_max_is_refused_without_panic() {
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("legacy-max.pt");
    let pkl = P::new().op(b'}').mark().s("w").legacy_tensor("140", 6, 0, &[2, 3], &[3, 1]).op(b'u').stop();
    write_legacy_pth(&f, &pkl, &[("140", vec![1., 2., 3., 4., 5., 6.])]);
    let mut b = std::fs::read(&f).unwrap(); let at = b.len() - 6 * 4 - 8;
    b[at..at + 8].copy_from_slice(&u64::MAX.to_le_bytes()); std::fs::write(&f, &b).unwrap();
    let e = read_state_dict(&f, &keys(&[""]), &[]).unwrap_err();
    assert!(matches!(e, PthError::Format(ref m) if m.contains("too large")), "{e}");
}
#[test] fn an_empty_tensor_still_reads() {
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("empty.pt");
    let pkl = P::new().op(b'}').mark().s("w").tensor("0", 0, 0, &[0, 3], &[3, 1]).op(b'u').stop();
    write_pth(&f, &pkl, &[("0", vec![])]);
    let sd = read_state_dict(&f, &keys(&[""]), &[]).unwrap();
    assert_eq!((sd["w"].shape.clone(), sd["w"].data.len()), (vec![0, 3], 0));
}
#[test] fn an_expanded_stride_zero_view_still_reads_every_copy() {
    // One float in storage, viewed as shape [4] with stride [0]: 16 bytes of tensor over a 4-byte storage, all reads inside it.
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("expand.pt");
    let pkl = P::new().op(b'}').mark().s("w").tensor("0", 1, 0, &[4], &[0]).op(b'u').stop();
    write_pth(&f, &pkl, &[("0", vec![2.5])]);
    let sd = read_state_dict(&f, &keys(&[""]), &[]).unwrap();
    assert_eq!((sd["w"].shape.clone(), f32s(&sd["w"].data)), (vec![4], vec![2.5; 4]));
}
#[test] fn a_view_whose_last_element_lies_past_the_storage_is_refused_in_constant_time() {
    let d = tempfile::tempdir().unwrap(); let f = d.path().join("past.pt");
    let pkl = P::new().op(b'}').mark().s("w").tensor("0", 1, 0, &[4], &[1]).op(b'u').stop();
    write_pth(&f, &pkl, &[("0", vec![2.5])]);
    let e = read_state_dict(&f, &keys(&[""]), &[]).unwrap_err();
    assert!(matches!(e, PthError::Format(ref m) if m.contains("too large")), "{e}");
}
