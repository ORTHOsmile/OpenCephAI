//! Part F (owner E1, 26 Oct): the scale a film's own pages use, in the app's order (spec 2026-10-20 "a film's scale, in
//! order"; the screen's twin is apps/desktop/src/compare/fit.ts `ownPages`, pinned to this by
//! tests/film_scale_cases.json): its ruler (with any fine-tune), else its machine's calibrated scale when that applies
//! (exact pixel size), else the scale from its fit when "Use the scale from the fit" is on, else assumed. A fit to a
//! film with neither a ruler nor a machine scale is on the assumed scale (owner G3) and is classed `Assumed`, with the
//! fit's size applied (what the film's pages show).
//!
//! The one Rust source of this order (plan Global Constraints): Part F's rule and the cross-check (S2) call it; nothing
//! else may define the order again. Every scale it returns is finite and above 0 (Task 1 review M3: the rule's
//! resolution weight divides by it): a ruler, machine scale, reference scale or fit size that is not a number above 0
//! reads as none, and the step below is used.
use crate::CaseDoc;
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ScaleSource { Ruler, Machine, Fit, Assumed }
impl ScaleSource {
    /// The word stored in the learning record's `scale_source` (format 14).
    pub fn as_str(&self) -> &'static str { match self { Self::Ruler => "ruler", Self::Machine => "machine", Self::Fit => "fit", Self::Assumed => "assumed" } }
}
/// A film's scale now. `fine_tuned`: a ruler adjusted by eye (± presses); only ever true on a
/// ruler film (Task 1 fix-round ruling): presses with no ruler under them, or a fit to a fine-tuned film, count for nothing.
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilmScale { pub mm_per_px: f64, pub source: ScaleSource, pub fine_tuned: bool }

/// A number that can be a scale: finite and above 0 (the screen's `scaleOf` / `baseScale` test, and the store's
/// `scale_ok`).
fn ok(s: f64) -> bool { s.is_finite() && s > 0.0 }

/// The film's scale now, in the app's order. `assumed_mm_per_px`: the caller's assumed scale
/// (`ceph_infer::crosscheck::params().assumed_mm_per_px`, 0.1; the screen's `ASSUMED_MM_PER_PX`). Panics when that is
/// not finite and above 0: a wrong constant is a programming error, refused on every film rather than returned as a
/// scale.
pub fn film_scale(doc: &CaseDoc, assumed_mm_per_px: f64) -> FilmScale {
    assert!(ok(assumed_mm_per_px), "film_scale: the assumed scale {assumed_mm_per_px} is not a number above 0");
    let at = |mm_per_px: f64, source: ScaleSource| FilmScale { mm_per_px, source, fine_tuned: false };
    if let Some(s) = doc.spacing_mm.filter(|s| ok(*s)) { return FilmScale { mm_per_px: s, source: ScaleSource::Ruler, fine_tuned: doc.scale_steps != 0 }; }
    if let Some(m) = doc.machine_scale.as_ref().filter(|m| m.applies && ok(m.spacing_mm)) { return at(m.spacing_mm, ScaleSource::Machine); }
    if let Some(f) = doc.fit.as_ref().filter(|f| f.use_own && f.fit.scale >= crate::fits::SCALE_MIN && f.fit.scale <= crate::fits::SCALE_MAX) {
        // As the screen's `refScaleOf`: the reference's ruler when it has one (a bad one reads as none, not as its
        // machine), else its machine scale, else assumed.
        let reference = match f.ref_spacing_mm { Some(s) => Some(s).filter(|s| ok(*s)), None => f.ref_machine_spacing_mm.filter(|s| ok(*s)) };
        return match reference {
            Some(r) => at(r * f.fit.scale, ScaleSource::Fit),
            None => at(assumed_mm_per_px * f.fit.scale, ScaleSource::Assumed),
        };
    }
    at(assumed_mm_per_px, ScaleSource::Assumed)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn doc(c: &serde_json::Value, steps: i64) -> crate::CaseDoc {
        let mut d = serde_json::json!({ "id": "c", "patientName": "Demo Synthetic", "timepoint": "T1", "takenOn": null, "facing": "right",   // SYNTHETIC
            "patientKey": "", "identitySource": "manual", "identityChecked": true, "identityIssues": [], "learnedFields": [],
            "orientation": {}, "display": {}, "spacingMm": c["spacingMm"], "scaleSteps": steps, "verifiedAt": null, "verifiedBy": null, "createdAt": "x", "updatedAt": "x",
            "image": { "sha256": "s", "ext": "png", "width": 10, "height": 10, "originalName": "SYNTHETIC.png", "path": "/x" }, "landmarks": [] });
        if let Some(m) = c["machine"].as_object() {
            d["machineScale"] = serde_json::json!({ "machineId": "m", "machineName": "Demo Radiology", "spacingMm": m["spacingMm"], "widthPx": 1, "heightPx": 1,
                "source": "entered", "sourceCaseId": null, "sourceFilmDate": null, "setAt": "x", "applies": m["applies"] });
        }
        if let Some(f) = c["fit"].as_object() {
            d["fit"] = serde_json::json!({ "refCaseId": "r", "refKind": "sn", "refPoints": [[0.0, 0.0], [1.0, 1.0]], "filmPoints": [[0.0, 0.0], [1.0, 1.0]],
                "mirror": false, "scale": f["scale"], "rotation": 0.0, "dx": 0.0, "dy": 0.0, "useOwn": f["useOwn"], "refTimepoint": "T1",
                "refSpacingMm": f["refSpacingMm"], "refMachineSpacingMm": f["refMachineSpacingMm"], "savedBy": "x", "savedAt": "x" });
        }
        serde_json::from_value(d).unwrap()
    }
    fn fixture() -> serde_json::Value { serde_json::from_str(include_str!("../tests/film_scale_cases.json")).unwrap() }
    /// One rule, two languages: every case of the shared fixture, the same answer the screen's `ownPages` gives
    /// (apps/desktop/src/compare/filmScale.test.ts). Positive control: swap the machine and fit branches → "machine beats
    /// fit" fails here, and the same swap in fit.ts fails the TypeScript twin.
    #[test] fn the_scale_order_matches_the_screens_case_by_case() {
        let fx = fixture();
        let assumed = fx["assumedMmPerPx"].as_f64().unwrap();
        let cases = fx["cases"].as_array().unwrap();
        assert!(cases.len() >= 29, "the instrument compares {} cases", cases.len());
        let mut compared = 0;
        for c in cases {
            let got = film_scale(&doc(c, c["scaleSteps"].as_i64().unwrap_or(0)), assumed);
            let e = &c["expect"];
            assert_eq!((got.mm_per_px, got.source.as_str(), got.fine_tuned),
                (e["mmPerPx"].as_f64().unwrap(), e["source"].as_str().unwrap(), e["fineTuned"].as_bool().unwrap_or(false)), "{}", c["name"]);
            compared += 1;
        }
        assert_eq!(compared, cases.len());
    }
    #[test] fn a_fine_tuned_ruler_is_still_a_ruler_and_says_so() {
        let c = serde_json::json!({ "spacingMm": 0.1005, "machine": null, "fit": null });
        assert_eq!(film_scale(&doc(&c, 1), 0.1), FilmScale { mm_per_px: 0.1005, source: ScaleSource::Ruler, fine_tuned: true });
        assert_eq!(film_scale(&doc(&c, -10), 0.1).fine_tuned, true, "a press down counts too");
        let none = serde_json::json!({ "spacingMm": null, "machine": null, "fit": null });
        assert!(!film_scale(&doc(&none, 0), 0.1).fine_tuned, "no ruler: nothing to fine-tune");
        assert!(!film_scale(&doc(&none, 4), 0.1).fine_tuned, "presses with no ruler under them count for nothing (Task 1 ruling)");
    }

    /// The values that are not a scale: zero, both signed zeros, negative, NaN, both infinities.
    const BAD: [f64; 6] = [0.0, -0.0, -0.125, f64::NAN, f64::INFINITY, f64::NEG_INFINITY];
    fn ok(s: &FilmScale) -> bool { s.mm_per_px.is_finite() && s.mm_per_px > 0.0 }
    fn base(spacing: Option<f64>, machine: bool, fit: bool) -> crate::CaseDoc {
        let m = if machine { serde_json::json!({ "spacingMm": 0.0625, "applies": true }) } else { serde_json::Value::Null };
        let f = if fit { serde_json::json!({ "useOwn": true, "scale": 1.5, "refSpacingMm": 0.125, "refMachineSpacingMm": null }) } else { serde_json::Value::Null };
        let mut d = doc(&serde_json::json!({ "spacingMm": null, "machine": m, "fit": f }), 0);
        d.spacing_mm = spacing; d
    }
    /// Task 1 review M3 (carried): `shares()` divides by the scale with no guard, so every scale `film_scale` returns is
    /// finite and above 0. Each source is fed every bad value and is passed over to the next source down. Positive
    /// control: drop the `ok` check on a source → its line fails here.
    #[test] fn a_bad_ruler_is_passed_over_for_the_machine_then_assumed() {
        for bad in BAD {
            let s = film_scale(&base(Some(bad), true, false), 0.1);
            assert_eq!((s.mm_per_px, s.source, s.fine_tuned), (0.0625, ScaleSource::Machine, false), "ruler {bad}");
            let s = film_scale(&base(Some(bad), false, false), 0.1);
            assert_eq!((s.mm_per_px, s.source), (0.1, ScaleSource::Assumed), "ruler {bad}, nothing else");
        }
    }
    #[test] fn a_bad_machine_scale_is_passed_over_for_the_fit_then_assumed() {
        for bad in BAD {
            let mut d = base(None, true, true);
            d.machine_scale.as_mut().unwrap().spacing_mm = bad;
            let s = film_scale(&d, 0.1);
            assert_eq!((s.mm_per_px, s.source), (0.1875, ScaleSource::Fit), "machine {bad}");
            d.fit = None;
            let s = film_scale(&d, 0.1);
            assert_eq!((s.mm_per_px, s.source), (0.1, ScaleSource::Assumed), "machine {bad}, no fit");
        }
    }
    #[test] fn a_bad_fit_size_is_passed_over_for_assumed() {
        for bad in BAD {
            let mut d = base(None, false, true);
            d.fit.as_mut().unwrap().fit.scale = bad;
            let s = film_scale(&d, 0.1);
            assert_eq!((s.mm_per_px, s.source), (0.1, ScaleSource::Assumed), "fit size {bad}");
        }
    }
    /// A reference whose ruler or machine scale is not a scale reads as a reference with none (G3): assumed × the fit's
    /// size, classed Assumed. A bad ruler is read as no scale at all, never as its machine (as the screen's `refScaleOf`).
    #[test] fn a_bad_reference_scale_reads_as_a_reference_with_none() {
        for bad in BAD {
            let mut d = base(None, false, true);
            d.fit.as_mut().unwrap().ref_spacing_mm = Some(bad);
            d.fit.as_mut().unwrap().ref_machine_spacing_mm = Some(0.0625);
            let s = film_scale(&d, 0.1);
            assert_eq!((s.mm_per_px, s.source), (0.1 * 1.5, ScaleSource::Assumed), "reference ruler {bad}");
            d.fit.as_mut().unwrap().ref_spacing_mm = None;
            d.fit.as_mut().unwrap().ref_machine_spacing_mm = Some(bad);
            let s = film_scale(&d, 0.1);
            assert_eq!((s.mm_per_px, s.source), (0.1 * 1.5, ScaleSource::Assumed), "reference machine {bad}");
        }
    }
    /// The assumed scale is the caller's constant (reference/crosscheck.json, checked > 0 when read). A bad one is a
    /// programming error: refused loudly, on every film (not only those that reach the assumed step), never returned.
    #[test] fn a_bad_assumed_scale_is_refused_on_every_film() {
        for bad in BAD {
            for d in [base(None, false, false), base(Some(0.125), false, false), base(None, true, false), base(None, false, true)] {
                let r = std::panic::catch_unwind(|| film_scale(&d, bad));
                assert!(r.is_err(), "assumed {bad} was not refused");
            }
        }
    }
    /// Every combination of good and bad inputs at every source: whatever comes back is a usable scale. Positive
    /// control: return the reference's scale without its `ok` check → a NaN reference reaches the product and this fails.
    #[test] fn every_mix_of_good_and_bad_inputs_gives_a_finite_scale_above_zero() {
        let vals: Vec<Option<f64>> = std::iter::once(None).chain([0.125].into_iter().chain(BAD).map(Some)).collect();
        let (tpl, mut n) = (base(None, true, true), 0);
        for ruler in &vals { for machine in &vals { for applies in [true, false] { for size in [Some(1.5), Some(0.2), Some(5.0), Some(f64::NAN), Some(-1.0), None] {
            for ref_ruler in &vals { for ref_machine in &vals { for own in [true, false] {
                let mut d = tpl.clone();
                d.spacing_mm = *ruler;
                match machine { Some(v) => { let m = d.machine_scale.as_mut().unwrap(); m.spacing_mm = *v; m.applies = applies; } None => d.machine_scale = None }
                match size {
                    Some(k) => { let f = d.fit.as_mut().unwrap(); f.fit.scale = k; f.ref_spacing_mm = *ref_ruler; f.ref_machine_spacing_mm = *ref_machine; f.use_own = own; }
                    None => d.fit = None,
                }
                let s = film_scale(&d, 0.1);
                assert!(ok(&s), "{s:?} from ruler {ruler:?} machine {machine:?}/{applies} size {size:?} ref {ref_ruler:?}/{ref_machine:?} on {own}");
                n += 1;
            } } }
        } } } }
        assert_eq!(n, 8 * 8 * 2 * 6 * 8 * 8 * 2, "every combination was tried");
    }
    #[test] fn the_source_words_are_the_records() {
        assert_eq!([ScaleSource::Ruler, ScaleSource::Machine, ScaleSource::Fit, ScaleSource::Assumed].map(|s| s.as_str()), ["ruler", "machine", "fit", "assumed"]);
        assert_eq!(serde_json::to_value(FilmScale { mm_per_px: 0.125, source: ScaleSource::Fit, fine_tuned: false }).unwrap(),
            serde_json::json!({ "mmPerPx": 0.125, "source": "fit", "fineTuned": false }));
    }
}
