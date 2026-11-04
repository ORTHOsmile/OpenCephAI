//! ceph-label: reads the patient name, date of birth, scan date and scan ID printed on a film (spec 2026-09-28 Part 1).
//! Parsing is pure and runs everywhere; recognition uses Apple Vision on this Mac. The raw text is never stored or logged.
pub mod dates;
pub mod layout;
pub mod ocr;
pub mod parse;
pub mod pick;
pub mod words;

pub use dates::{DateOrder, Ymd};
pub use parse::{parse_label, title_case, LabelFields};
pub use pick::{merge_readings, prefer_mirrored, reading_order, TextLine};
pub use words::{even_words, with_words, word_spans, Word};
use std::path::Path;

/// Internals exposed ONLY so an external harness (a standalone binary, path-dependent on this crate, that drives
/// the production date-reading paths against the screen's own code)
/// can reach the same pieces the test modules in `parse.rs`/`dates.rs` use, without widening the crate's normal
/// public API: `cargo build --features harness`. No in-repo caller may depend on this feature (re-review minor,
/// 13 Oct: these were briefly plain `pub`, which is how review finding C3 happened — a caller reached for
/// `find_dates` directly instead of the one shared field rule).
#[cfg(feature = "harness")]
pub use dates::{date_in, read_dates, DateRead, Rule};
#[cfg(feature = "harness")]
pub use parse::{labels, line_dates, Kind, PieceDate};

/// The fields from recognised lines.
pub fn fields_from(lines: &[TextLine], order: DateOrder, today: Ymd) -> LabelFields {
    let text: Vec<&str> = lines.iter().map(|l| l.text.as_str()).collect();
    parse_label(&text, order, today)
}

/// The text on the film at `path`: recognised as stored and mirrored, each region kept the way round it reads more
/// clearly (a label can be back to front while other text reads forwards). Held in memory only.
pub fn read_text(path: &Path, order: DateOrder, today: Ymd) -> anyhow::Result<Vec<TextLine>> {
    let img = image::open(path)?.to_luma8();
    let as_is = ocr::recognize(&img)?;
    let mirrored = ocr::recognize(&image::imageops::flip_horizontal(&img))?;
    Ok(merge_readings(&as_is, &mirrored, order, today).into_iter().map(with_words).collect())
}

/// Reads the label of the film at `path`: the text on the film, parsed.
pub fn read_label(path: &Path, order: DateOrder, today: Ymd) -> anyhow::Result<LabelFields> {
    Ok(fields_from(&read_text(path, order, today)?, order, today))
}

/// Boxes read from a crop at `rect` (0–1 of the film) moved back into the film's frame.
pub fn area_to_film(lines: Vec<TextLine>, rect: [f64; 4]) -> Vec<TextLine> {
    let map = |b: [f64; 4]| [rect[0] + b[0] * rect[2], rect[1] + b[1] * rect[3], b[2] * rect[2], b[3] * rect[3]];
    lines.into_iter().map(|l| TextLine {
        bbox: map(l.bbox),
        words: l.words.into_iter().map(|w| Word { bbox: map(w.bbox), ..w }).collect(),
        ..l
    }).collect()
}

/// Re-reads a small area of the film (spec 2026-09-29 Part 1, clicking where no text was recognised): cropped, enlarged
/// 2×, recognised both ways round and joined region by region, with boxes given in the film's frame.
pub fn read_area(path: &Path, rect: [f64; 4], order: DateOrder, today: Ymd) -> anyhow::Result<Vec<TextLine>> {
    let img = image::open(path)?.to_luma8();
    let (w, h) = (img.width(), img.height());
    let x = ((rect[0].clamp(0.0, 1.0) * w as f64) as u32).min(w - 1);
    let y = ((rect[1].clamp(0.0, 1.0) * h as f64) as u32).min(h - 1);
    let cw = ((rect[2].max(0.0) * w as f64) as u32).clamp(1, w - x);
    let ch = ((rect[3].max(0.0) * h as f64) as u32).clamp(1, h - y);
    let crop = image::imageops::crop_imm(&img, x, y, cw, ch).to_image();
    let big = image::imageops::resize(&crop, cw * 2, ch * 2, image::imageops::FilterType::CatmullRom);
    let as_is = ocr::recognize(&big)?;
    let mirrored = ocr::recognize(&image::imageops::flip_horizontal(&big))?;
    let lines = merge_readings(&as_is, &mirrored, order, today).into_iter().map(with_words).collect();
    Ok(area_to_film(lines, [x as f64 / w as f64, y as f64 / h as f64, cw as f64 / w as f64, ch as f64 / h as f64]))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn today() -> Ymd { Ymd { y: 2026, m: 9, d: 28 } }
    /// Review focus 2: a blank label (no text either way round) keeps the as-is reading and fills nothing.
    #[test] fn nothing_read_either_way_keeps_the_as_is_reading_and_parses_to_nothing() {
        assert!(!prefer_mirrored(&[], &[], DateOrder::Au, today()));
        assert_eq!(fields_from(&[], DateOrder::Au, today()), LabelFields::default());
    }
    #[test] fn fields_come_from_the_recognised_lines_in_order() {
        let lines = [TextLine { text: "Name: DEMO SYNTHETIC".into(), confidence: 0.9, ..Default::default() }, TextLine { text: "DOB: 07/03/1990".into(), confidence: 0.9, ..Default::default() }];   // SYNTHETIC
        let f = fields_from(&lines, DateOrder::Au, today());
        assert_eq!((f.name.as_deref(), f.date_of_birth.map(|d| d.iso())), (Some("Demo Synthetic"), Some("1990-03-07".into())));
    }
    #[cfg(not(target_os = "macos"))]
    #[test] fn without_macos_reading_a_label_is_an_error_not_a_guess() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("blank.png");
        image::GrayImage::new(20, 20).save(&p).unwrap();
        assert!(read_label(&p, DateOrder::Au, today()).unwrap_err().to_string().contains("needs macOS"));
    }
    #[cfg(not(target_os = "macos"))]
    #[test] fn without_macos_the_text_on_the_film_is_an_error_too() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join("blank.png");
        image::GrayImage::new(20, 20).save(&p).unwrap();
        assert!(read_text(&p, DateOrder::Au, today()).unwrap_err().to_string().contains("needs macOS"));
    }
    #[test] fn an_area_reading_is_placed_back_in_the_film_frame() {
        let l = with_words(TextLine { text: "SMITH, John".into(), confidence: 1.0, bbox: [0.5, 0.5, 0.5, 0.25], words: vec![] });   // SYNTHETIC
        let got = area_to_film(vec![l], [0.2, 0.4, 0.1, 0.04]);
        let b = got[0].bbox;
        assert!((b[0] - 0.25).abs() < 1e-9 && (b[1] - 0.42).abs() < 1e-9 && (b[2] - 0.05).abs() < 1e-9 && (b[3] - 0.01).abs() < 1e-9);
        assert!((got[0].words[0].bbox[0] - 0.25).abs() < 1e-9);
    }
}
