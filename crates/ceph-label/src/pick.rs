//! A mirrored film has its label back to front; recognition runs both ways round and keeps the better reading (spec Part 1).
use crate::dates::{DateOrder, Ymd};

#[derive(Debug, Clone, PartialEq, Default)]
pub struct TextLine {
    pub text: String, pub confidence: f32,
    /// Where the line sits: [left, top, width, height], 0–1 from the top-left of the image it was read from.
    pub bbox: [f64; 4],
    /// The line's words with their boxes, in the same frame as bbox.
    pub words: Vec<crate::words::Word>,
}

use crate::dates::line_has_date;

/// Which reading to trust: the one with more words recognised at confidence ≥ 0.5; a tie goes to the reading that
/// contains a date. True means the mirrored reading. With nothing read either way, the as-is reading (empty) is kept.
pub fn prefer_mirrored(as_is: &[TextLine], mirrored: &[TextLine], order: DateOrder, today: Ymd) -> bool {
    let words = |ls: &[TextLine]| ls.iter().filter(|l| l.confidence >= 0.5).map(|l| l.text.split_whitespace().count()).sum::<usize>();
    let dated = |ls: &[TextLine]| ls.iter().any(|l| line_has_date(&l.text, order, today));
    let (a, m) = (words(as_is), words(mirrored));
    if a != m { return m > a; }
    dated(mirrored) && !dated(as_is)
}

/// Lines in reading order: the left side of the film top to bottom, then the right side, so a label down one side is not
/// interleaved with the viewer's details down the other.
pub fn reading_order(mut lines: Vec<TextLine>) -> Vec<TextLine> {
    let (left, top) = (|l: &TextLine| l.bbox[0], |l: &TextLine| l.bbox[1]);
    lines.sort_by(|a, b| (left(a) >= 0.5).cmp(&(left(b) >= 0.5)).then(top(a).total_cmp(&top(b))).then(left(a).total_cmp(&left(b))));
    lines
}

/// Most of the smaller box lies inside the other: the same text seen both ways round.
fn same_region(a: &[f64; 4], b: &[f64; 4]) -> bool {
    let w = (a[0] + a[2]).min(b[0] + b[2]) - a[0].max(b[0]);
    let h = (a[1] + a[3]).min(b[1] + b[3]) - a[1].max(b[1]);
    let smaller = (a[2] * a[3]).min(b[2] * b[3]);
    w > 0.0 && h > 0.0 && smaller > 0.0 && w * h / smaller > 0.5
}

/// Both readings of a film joined region by region (owner, 29 Sep: a label can be back to front while the viewer's
/// details read forwards). `mirrored` was read from the flipped image; its boxes are turned back to the stored frame.
/// The better whole reading (`prefer_mirrored`) is the base; a line from the other reading with confidence ≥ 0.5 is
/// added where the base has nothing, or replaces the base's lines in its region when it is more confident than all of them.
pub fn merge_readings(as_is: &[TextLine], mirrored: &[TextLine], order: DateOrder, today: Ymd) -> Vec<TextLine> {
    let flip = |b: [f64; 4]| [1.0 - b[0] - b[2], b[1], b[2], b[3]];
    let unflipped: Vec<TextLine> = mirrored.iter().map(|l| TextLine {
        bbox: flip(l.bbox),
        words: l.words.iter().map(|w| crate::words::Word { text: w.text.clone(), bbox: flip(w.bbox) }).collect(),
        ..l.clone()
    }).collect();
    let (mut out, other) = if prefer_mirrored(as_is, mirrored, order, today) { (unflipped, as_is.to_vec()) } else { (as_is.to_vec(), unflipped) };
    for s in other.into_iter().filter(|s| s.confidence >= 0.5) {
        let there: Vec<usize> = (0..out.len()).filter(|&i| same_region(&out[i].bbox, &s.bbox)).collect();
        // More confident wins; on a tie, the reading that is a date (owner, 30 Sep: a back-to-front DOB).
        let dated = |l: &TextLine| line_has_date(&l.text, order, today);
        let better = |i: usize| s.confidence > out[i].confidence || (s.confidence == out[i].confidence && dated(&s) && !dated(&out[i]));
        if there.iter().all(|&i| better(i)) {
            for i in there.into_iter().rev() { out.remove(i); }
            out.push(s);
        }
    }
    reading_order(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn l(t: &str, c: f32) -> TextLine { TextLine { text: t.into(), confidence: c, ..Default::default() } }
    /// A line at [left, top, width, height] in the frame of the image it was read from.
    fn at(t: &str, c: f32, bbox: [f64; 4]) -> TextLine { TextLine { text: t.into(), confidence: c, bbox, words: vec![] } }
    fn texts(ls: &[TextLine]) -> Vec<&str> { ls.iter().map(|l| l.text.as_str()).collect() }
    fn today() -> Ymd { Ymd { y: 2026, m: 9, d: 28 } }
    #[test] fn the_reading_with_more_confident_words_wins() {
        let as_is = [l("0991/30/70 :BOD", 0.3), l("HTIMS NHOJ", 0.4)];
        let mirrored = [l("DOB: 07/03/1990", 0.9), l("JOHN SMITH", 0.95)];   // SYNTHETIC
        assert!(prefer_mirrored(&as_is, &mirrored, DateOrder::Au, today()));
        assert!(!prefer_mirrored(&mirrored, &as_is, DateOrder::Au, today()));
    }
    #[test] fn the_reversed_string_loses_to_the_forward_one_on_a_tie() {
        let reversed = [l("0991/30/70 :BOD", 0.9)];
        let forward = [l("DOB: 07/03/1990", 0.9)];   // SYNTHETIC
        assert!(prefer_mirrored(&reversed, &forward, DateOrder::Au, today()));
        assert!(!prefer_mirrored(&forward, &reversed, DateOrder::Au, today()));
    }
    /// Owner, 29 Sep: names back to front were missed. The patient's label is mirrored on this film while the viewer's
    /// details read forwards, so neither whole reading has both. Each region keeps whichever reading of it is clearer.
    /// Mirrored boxes are in the flipped image's frame: a line at left 0.05 there sits at 1 - 0.05 - width here.
    #[test] fn each_region_of_a_mixed_film_is_read_the_way_round_that_is_clearer() {
        let as_is = [at("nhoL ,HTIMS", 0.3, [0.75, 0.05, 0.2, 0.03]), at("0002/10/10 BOD", 0.3, [0.75, 0.10, 0.2, 0.03]),   // SYNTHETIC
            at("Se: Feb 07, 2024 01:36 PM", 1.0, [0.05, 0.05, 0.3, 0.03]), at("Im: 1/1", 1.0, [0.05, 0.10, 0.1, 0.03])];
        let mirrored = [at("SMITH, John", 1.0, [0.05, 0.05, 0.2, 0.03]), at("DOB 01/01/2000", 1.0, [0.05, 0.10, 0.2, 0.03]),   // SYNTHETIC
            at("MP 63:10 4202 ,70 beF :eS", 0.3, [0.65, 0.05, 0.3, 0.03]), at("1/1 :mI", 0.3, [0.85, 0.10, 0.1, 0.03])];
        let got = merge_readings(&as_is, &mirrored, DateOrder::Au, today());
        assert_eq!(texts(&got), ["Se: Feb 07, 2024 01:36 PM", "Im: 1/1", "SMITH, John", "DOB 01/01/2000"]);   // SYNTHETIC
        assert_eq!(got[2].bbox, [0.75, 0.05, 0.2, 0.03], "a mirrored line's box is given in the stored image's frame");
        let f = crate::fields_from(&got, DateOrder::Au, today());
        assert_eq!((f.name.as_deref(), f.date_of_birth.map(|d| d.iso()), f.scan_date.map(|d| d.iso())),
            (Some("Smith, John"), Some("2000-01-01".into()), Some("2024-02-07".into())));
    }
    #[test] fn a_film_read_one_way_round_is_unchanged_by_merging() {
        let fwd = [at("Name: DEMO SYNTHETIC", 1.0, [0.05, 0.05, 0.3, 0.03]), at("DOB: 07/03/1990", 1.0, [0.05, 0.10, 0.2, 0.03])];   // SYNTHETIC
        let back = [at("CITEHTNYS OMED :emaN", 0.3, [0.65, 0.05, 0.3, 0.03]), at("0991/30/70 :BOD", 0.5, [0.75, 0.10, 0.2, 0.03])];   // SYNTHETIC
        assert_eq!(texts(&merge_readings(&fwd, &back, DateOrder::Au, today())), texts(&fwd));
        assert_eq!(texts(&merge_readings(&back, &fwd, DateOrder::Au, today())), texts(&fwd), "the stored film is itself back to front");
    }
    #[test] fn text_found_only_the_other_way_round_is_kept_when_confident_and_dropped_when_not() {
        let as_is = [at("Name: DEMO SYNTHETIC", 1.0, [0.05, 0.05, 0.3, 0.03]), at("DOB: 07/03/1990", 1.0, [0.05, 0.10, 0.2, 0.03])];   // SYNTHETIC
        let mirrored = [at("PID 5566", 1.0, [0.05, 0.9, 0.1, 0.03]), at("xq!", 0.3, [0.4, 0.5, 0.05, 0.03])];
        assert_eq!(texts(&merge_readings(&as_is, &mirrored, DateOrder::Au, today())),
            ["Name: DEMO SYNTHETIC", "DOB: 07/03/1990", "PID 5566"]);   // SYNTHETIC
    }
    /// Owner, 29 Sep: the label sits down one side and the viewer's series details down the other. Read row by row
    /// they interleave ("DEMO, Synthetic", "Se: …", "DOB …"); each side must come through whole.
    #[test] fn the_left_side_is_read_top_to_bottom_before_the_right_side() {
        let got = reading_order(vec![
            at("OPG & CEPHALOGRAM", 0.9, [0.70, 0.02, 0.2, 0.02]), at("Demo Radiology Northside", 0.9, [0.02, 0.01, 0.3, 0.02]),
            at("DEMO, Synthetic", 0.9, [0.02, 0.05, 0.2, 0.02]), at("Se: Feb 07, 2024 01:36 PM", 0.9, [0.72, 0.06, 0.2, 0.02]),
            at("DOB 07/03/1990 SYNTHETIC", 0.9, [0.02, 0.09, 0.2, 0.02]), at("Im: 1/1", 0.9, [0.72, 0.10, 0.1, 0.02]),
        ]);
        assert_eq!(texts(&got), ["Demo Radiology Northside", "DEMO, Synthetic", "DOB 07/03/1990 SYNTHETIC",   // SYNTHETIC
            "OPG & CEPHALOGRAM", "Se: Feb 07, 2024 01:36 PM", "Im: 1/1"]);
    }
    #[test] fn words_on_one_row_of_a_side_keep_left_to_right_order() {
        let got = reading_order(vec![at("Synthetic", 0.9, [0.30, 0.5, 0.1, 0.02]), at("DEMO,", 0.9, [0.05, 0.5, 0.1, 0.02])]);
        assert_eq!(texts(&got), ["DEMO,", "Synthetic"]);
    }
    #[test] fn merging_mirrors_word_boxes_too() {
        let mut m = at("SMITH, John", 1.0, [0.05, 0.05, 0.2, 0.03]);   // SYNTHETIC
        m.words = crate::words::even_words(&m.text, m.bbox);
        let got = merge_readings(&[], &[m], DateOrder::Au, today());
        assert!((got[0].words[0].bbox[0] - (1.0 - 0.05 - got[0].words[0].bbox[2])).abs() < 1e-9);
        assert!(got[0].words[1].bbox[0] < got[0].words[0].bbox[0], "reversed side: the later word is further left");
    }
    /// Owner, 30 Sep: a back-to-front DOB could not be chosen. When both readings of a region are equally confident,
    /// the one that reads as a date is the text of that region.
    #[test] fn an_equally_confident_region_keeps_the_reading_that_is_a_date() {
        let as_is = [at("Name: DEMO SYNTHETIC", 1.0, [0.05, 0.05, 0.3, 0.03]), at("Clinic Demo Northside", 1.0, [0.05, 0.02, 0.3, 0.02]),
            at("09\\30\\70", 1.0, [0.70, 0.10, 0.10, 0.03])];
        let mirrored = [at("07/03/90", 1.0, [0.20, 0.10, 0.10, 0.03])];   // SYNTHETIC
        let got = merge_readings(&as_is, &mirrored, DateOrder::Au, today());
        assert!(texts(&got).contains(&"07/03/90") && !texts(&got).contains(&"09\\30\\70"), "{:?}", texts(&got));   // SYNTHETIC
    }
}
