//! Apple Vision on a synthetic label drawn at test time with a system font (never a patient film).
#![cfg(target_os = "macos")]
use ab_glyph::{point, Font, FontVec, PxScale, ScaleFont};
use ceph_label::{read_area, read_label, read_text, DateOrder, Ymd};
use image::{GrayImage, Luma};

fn system_font() -> FontVec {
    for p in ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Supplemental/Verdana.ttf", "/Library/Fonts/Arial Unicode.ttf"] {
        if let Ok(bytes) = std::fs::read(p) { return FontVec::try_from_vec(bytes).expect("a TrueType font"); }
    }
    panic!("no system TrueType font found");
}

/// Draws light text on a dark "film", like a burned-in label.
fn draw(img: &mut GrayImage, font: &FontVec, text: &str, x0: f32, baseline: f32, px: f32) {
    let sf = font.as_scaled(PxScale::from(px));
    let mut x = x0;
    for ch in text.chars() {
        let mut g = sf.scaled_glyph(ch);
        let advance = sf.h_advance(g.id);
        g.position = point(x, baseline);
        if let Some(o) = font.outline_glyph(g) {
            let b = o.px_bounds();
            o.draw(|gx, gy, c| {
                let (px, py) = (b.min.x as i64 + gx as i64, b.min.y as i64 + gy as i64);
                if px >= 0 && py >= 0 && (px as u32) < img.width() && (py as u32) < img.height() {
                    let p = img.get_pixel_mut(px as u32, py as u32);
                    p.0[0] = p.0[0].max((c * 235.0) as u8 + 20);
                }
            });
        }
        x += advance;
    }
}

fn synthetic_label() -> GrayImage {
    let mut img = GrayImage::from_pixel(1600, 1200, Luma([20]));
    let font = system_font();
    for (i, line) in ["Name: SYNTHETIC Demo", "DOB: 07/03/1990", "Date: 12/09/2026", "ID: 4471"].iter().enumerate() {   // SYNTHETIC
        draw(&mut img, &font, line, 60.0, 90.0 + 56.0 * i as f32, 40.0);
    }
    img
}

#[test] fn vision_reads_the_synthetic_label_as_is_and_mirrored() {
    let dir = tempfile::tempdir().unwrap();
    let img = synthetic_label();
    let (as_is, mirrored) = (dir.path().join("as-is.png"), dir.path().join("mirrored.png"));
    img.save(&as_is).unwrap();
    image::imageops::flip_horizontal(&img).save(&mirrored).unwrap();
    let today = Ymd { y: 2026, m: 9, d: 28 };
    for path in [&as_is, &mirrored] {
        let f = read_label(path, DateOrder::Au, today).unwrap();
        assert_eq!(f.name.as_deref(), Some("Synthetic Demo"), "{}", path.display());
        assert_eq!(f.date_of_birth.map(|d| d.iso()).as_deref(), Some("1990-03-07"), "{}", path.display());
        assert_eq!(f.scan_date.map(|d| d.iso()).as_deref(), Some("2026-09-12"), "{}", path.display());
        assert_eq!(f.scan_id.as_deref(), Some("4471"), "{}", path.display());
    }
}

/// Spec 2026-09-29 Part 1: every line has word boxes inside it, and re-reading a small area finds the text in it.
#[test] fn vision_gives_word_boxes_and_rereads_an_area() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("label.png");
    synthetic_label().save(&path).unwrap();
    let today = Ymd { y: 2026, m: 9, d: 28 };
    let lines = read_text(&path, DateOrder::Au, today).unwrap();
    assert!(!lines.is_empty());
    for l in &lines {
        assert!(!l.words.is_empty(), "{}", l.text);
        for w in &l.words {
            assert!(w.bbox[0] >= l.bbox[0] - 0.02 && w.bbox[0] + w.bbox[2] <= l.bbox[0] + l.bbox[2] + 0.02, "{} in {}", w.text, l.text);
            assert!(w.bbox[1] >= l.bbox[1] - 0.02 && w.bbox[1] + w.bbox[3] <= l.bbox[1] + l.bbox[3] + 0.02, "{} in {}", w.text, l.text);
        }
    }
    let name = lines.iter().find(|l| l.text.contains("SYNTHETIC")).expect("the name line");
    let b = name.bbox;
    let area = read_area(&path, [b[0] - 0.02, b[1] - 0.02, b[2] + 0.04, b[3] + 0.04], DateOrder::Au, today).unwrap();
    assert!(area.iter().any(|l| l.text.contains("SYNTHETIC")), "{:?}", area.iter().map(|l| &l.text).collect::<Vec<_>>());
}
