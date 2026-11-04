//! Words of a recognised line and their boxes (spec 2026-09-29 Part 1, "Words, not just lines").
use crate::pick::TextLine;

#[derive(Debug, Clone, PartialEq, Default)]
pub struct Word { pub text: String, pub bbox: [f64; 4] }

/// Each whitespace-separated word as (byte range, UTF-16 range). Vision's NSRange counts UTF-16 units.
pub fn word_spans(text: &str) -> Vec<(std::ops::Range<usize>, std::ops::Range<usize>)> {
    let mut out = Vec::new();
    let (mut start, mut u16_start, mut u16) = (None::<usize>, 0usize, 0usize);
    for (i, c) in text.char_indices() {
        if c.is_whitespace() {
            if let Some(s) = start.take() { out.push((s..i, u16_start..u16)); }
        } else if start.is_none() { start = Some(i); u16_start = u16; }
        u16 += c.len_utf16();
    }
    if let Some(s) = start { out.push((s..text.len(), u16_start..u16)); }
    out
}

/// Word boxes estimated from each word's share of the line's characters (spaces included). Used when Vision gives
/// no box for a range, and for synthetic lines in tests.
pub fn even_words(text: &str, bbox: [f64; 4]) -> Vec<Word> {
    let n = text.chars().count().max(1) as f64;
    word_spans(text).into_iter().map(|(b, _)| {
        let (c0, c1) = (text[..b.start].chars().count() as f64, text[..b.end].chars().count() as f64);
        Word { text: text[b].to_string(), bbox: [bbox[0] + bbox[2] * c0 / n, bbox[1], bbox[2] * (c1 - c0) / n, bbox[3]] }
    }).collect()
}

/// The line with its words filled in (even boxes) when recognition gave none.
pub fn with_words(mut l: TextLine) -> TextLine {
    if l.words.is_empty() { l.words = even_words(&l.text, l.bbox); }
    l
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn words_are_runs_between_spaces_with_byte_and_utf16_ranges() {
        let s = "Zoë  O'BRIEN, Jo";
        let spans = word_spans(s);
        let words: Vec<&str> = spans.iter().map(|(b, _)| &s[b.clone()]).collect();
        assert_eq!(words, ["Zoë", "O'BRIEN,", "Jo"]);
        assert_eq!(spans[0].1, 0..3, "ë is one UTF-16 unit");
        assert_eq!(spans[1].1, 5..13);
    }
    #[test] fn even_words_share_the_line_box_by_characters() {
        let w = even_words("AB CDEF", [0.1, 0.2, 0.7, 0.05]);
        assert_eq!(w.len(), 2);
        assert_eq!(w[0].text, "AB");
        assert!((w[0].bbox[0] - 0.1).abs() < 1e-9 && (w[0].bbox[2] - 0.2).abs() < 1e-9);
        assert!((w[1].bbox[0] - 0.4).abs() < 1e-9 && (w[1].bbox[2] - 0.4).abs() < 1e-9);
        assert_eq!((w[1].bbox[1], w[1].bbox[3]), (0.2, 0.05));
    }
    #[test] fn a_line_without_words_gets_even_words() {
        let l = with_words(TextLine { text: "DEMO, Synthetic".into(), confidence: 0.9, bbox: [0.0, 0.0, 0.5, 0.1], words: vec![] });
        assert_eq!(l.words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(), ["DEMO,", "Synthetic"]);
    }
}
