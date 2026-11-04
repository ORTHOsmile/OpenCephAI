//! Where a machine prints each detail, as a rule that reads names of any length (spec 2026-09-29 Part 3).
use crate::{dates::date_field_value, parse::{gender_in, id_token, referrer_in}, title_case, DateOrder, TextLine, Ymd};

/// Every field a machine learns the place of: the identity fields, then the film details (`DETAIL_FIELDS`), then the
/// patient details (`PATIENT_FIELDS`, owner Q6).
pub const FIELDS: [&str; 12] = ["last", "first", "full", "dob", "film_date", "scan_id", "patient_id", "xray_type", "xray_size", "practice", "gender", "referrer"];
/// A learned row matches a line whose centre is within this of it (0–1 of the film's height), and within ¾ of the
/// line's own height, so a neighbouring line is never read instead.
pub const ROW_TOL: f64 = 0.03;
/// The longest value of a new film detail (spec 2026-10-17): the library's CHECKs refuse longer, and so does the screen.
/// Counted in Unicode code points (Rust `chars().count()`, as SQLite's `length()` counts text), NOT UTF-16 units (JS
/// `.length`): the screen measures with `[...s].length`. Pinned with `DETAIL_FIELDS` to `tests/detail_fields.json`.
pub const DETAIL_MAX_CHARS: usize = 200;
/// The new film details a machine learns (spec 2026-10-17, D-LEARN-1): the one list of them (pre-flight D11).
/// `FIELDS[6..10]`; `PATIENT_FIELDS` follow. The screen's `choose.ts` `DETAIL_FIELDS` is pinned to the same fixture.
pub const DETAIL_FIELDS: [&str; 4] = ["patient_id", "xray_type", "xray_size", "practice"];
/// The patient details a machine learns per machine (owner Q6, addendum 2026-10-17): Gender and Referring
/// practitioner. They stay on the PATIENT (as typed), never the film; the last two of `FIELDS`.
pub const PATIENT_FIELDS: [&str; 2] = ["gender", "referrer"];

/// A word as a pattern token: lowercased, outer punctuation trimmed; None if it has a digit or under 2 characters.
pub fn token(word: &str) -> Option<String> {
    let t = word.trim_matches(|c: char| !c.is_alphanumeric()).to_lowercase();
    (t.chars().count() >= 2 && !t.chars().any(|c| c.is_ascii_digit())).then_some(t)
}

#[derive(Debug, Clone, PartialEq)]
pub struct FilmToken { pub token: String, pub text: String, pub cx: f64, pub cy: f64 }

/// Every token on the film with its word's centre.
pub fn film_tokens(lines: &[TextLine]) -> Vec<FilmToken> {
    lines.iter().flat_map(|l| l.words.iter()).filter_map(|w| token(&w.text).map(|t| FilmToken {
        token: t, text: w.text.trim_matches(|c: char| !c.is_alphanumeric()).to_string(),
        cx: w.bbox[0] + w.bbox[2] / 2.0, cy: w.bbox[1] + w.bbox[3] / 2.0 })).collect()
}

#[derive(Debug, Clone, PartialEq)]
pub enum Start { Line, Comma, After(String) }
#[derive(Debug, Clone, PartialEq)]
pub enum End { Line, Comma, Before(String), Words(usize) }

/// Field labels printed on films: a rule may start after or end before one of these (or one of the machine's anchors),
/// never after a word of the patient's own.
pub const LABEL_WORDS: [&str; 26] = ["name", "patient", "pt", "surname", "given", "first", "last", "dob", "birth", "born", "date",
    "sex", "age", "gender", "id", "pid", "mrn", "chart", "no", "acc", "accession", "se", "im", "exam", "study", "taken"];
impl Start {
    pub fn code(&self) -> String { match self { Start::Line => "line".into(), Start::Comma => "comma".into(), Start::After(t) => format!("after:{t}") } }
    pub fn parse(s: &str) -> Option<Self> {
        match s { "line" => Some(Start::Line), "comma" => Some(Start::Comma), _ => s.strip_prefix("after:").map(|t| Start::After(t.into())) }
    }
}
impl End {
    pub fn code(&self) -> String {
        match self { End::Line => "end".into(), End::Comma => "comma".into(), End::Before(t) => format!("before:{t}"), End::Words(n) => format!("words:{n}") }
    }
    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "end" => Some(End::Line), "comma" => Some(End::Comma),
            _ => s.strip_prefix("before:").map(|t| End::Before(t.into())).or_else(|| s.strip_prefix("words:")?.parse().ok().map(End::Words)),
        }
    }
}

/// Where a detail is printed: a row, a side, and where on that row's line it starts and ends.
#[derive(Debug, Clone, PartialEq)]
pub struct Rule { pub row_y: f64, pub right: bool, pub start: Start, pub end: End }
impl Rule {
    /// The same place on a film exported flipped.
    pub fn mirrored(&self) -> Rule { Rule { right: !self.right, ..self.clone() } }
}

fn centre_y(l: &TextLine) -> f64 { l.bbox[1] + l.bbox[3] / 2.0 }
fn on_right(l: &TextLine) -> bool { l.bbox[0] >= 0.5 }

/// The rule for words `from..=to` of `line` as `field`, or None when nothing on the film marks where it starts or ends.
/// A rule starts at the line's start, after a comma, or after a `known` word (a field label or one of the machine's
/// anchors) — never after one of the patient's own words (final review C1). A name ends at the line's end, a comma or a
/// known word, never after a count of words, since names differ in length (C2); dates and IDs may end after N words.
pub fn rule_from_selection(line: &TextLine, from: usize, to: usize, field: &str, known: &[String]) -> Option<Rule> {
    let w = &line.words;
    if from > to || to >= w.len() { return None; }
    let is_known = |x: &str| token(x).filter(|t| known.iter().any(|k| k == t));
    let start = if from == 0 { Start::Line }
        else if w[from - 1].text.ends_with(',') { Start::Comma }
        else { Start::After(is_known(&w[from - 1].text)?) };
    // A name, an X-ray type, a practice or a referrer can be any number of words (spec 2026-10-17; owner Q6): never
    // ended by a count.
    let name = matches!(field, "last" | "first" | "full" | "xray_type" | "practice" | "referrer");
    let end = if to + 1 >= w.len() { End::Line }
        else if w[to].text.ends_with(',') { End::Comma }
        else if let Some(t) = is_known(&w[to + 1].text) { End::Before(t) }
        else if !name { End::Words(to - from + 1) }
        else { return None };
    Some(Rule { row_y: centre_y(line), right: on_right(line), start, end })
}

#[derive(Debug, Clone, PartialEq)]
pub struct Picked { pub line: usize, pub from: usize, pub to: usize, pub text: String }

/// The words the rule describes on this film: on the nearest line in its row and side where it applies, else None.
pub fn read_rule(lines: &[TextLine], rule: &Rule) -> Option<Picked> {
    let mut rows: Vec<(usize, &TextLine)> = lines.iter().enumerate().filter(|(_, l)| {
        on_right(l) == rule.right && (centre_y(l) - rule.row_y).abs() <= ROW_TOL.min(0.75 * l.bbox[3])
    }).collect();
    rows.sort_by(|a, b| (centre_y(a.1) - rule.row_y).abs().total_cmp(&(centre_y(b.1) - rule.row_y).abs()));
    rows.into_iter().find_map(|(i, l)| {
        let w = &l.words;
        let from = match &rule.start {
            Start::Line => 0,
            Start::Comma => w.iter().position(|x| x.text.ends_with(','))? + 1,
            Start::After(t) => w.iter().position(|x| token(&x.text).as_deref() == Some(t.as_str()))? + 1,
        };
        if from >= w.len() { return None; }
        let to = match rule.end {
            End::Line => w.len() - 1,
            End::Comma => from + w[from..].iter().position(|x| x.text.ends_with(','))?,
            End::Before(ref t) => (from + w[from..].iter().position(|x| token(&x.text).as_deref() == Some(t.as_str()))?).checked_sub(1).filter(|to| *to >= from)?,
            End::Words(n) => (from + n.max(1) - 1).min(w.len() - 1),
        };
        let text = w[from..=to].iter().map(|x| x.text.as_str()).collect::<Vec<_>>().join(" ");
        Some(Picked { line: i, from, to, text: text.trim_end_matches(',').to_string() })
    })
}

/// The field's value from the text a rule read, tidied the way the label reader does: names in title case, dates as
/// ISO (the operator's day/month order), IDs as their token; the new film details as printed, spaces tidied.
pub fn field_value(field: &str, text: &str, order: DateOrder, today: Ymd) -> Option<String> {
    let t = text.trim().trim_end_matches(',').trim();
    match field {
        "last" | "first" | "full" => (t.chars().filter(|c| c.is_alphabetic()).count() >= 2 && !t.chars().any(|c| c.is_ascii_digit()))
            .then(|| title_case(t)),
        "dob" | "film_date" => date_field_value(text, order, today).map(|d| d.iso()),
        "scan_id" => id_token(t.trim_start_matches('#')),
        // A learned Patient ID is never a truncated value (S4 + ruling I-1, spec 2026-10-17): exactly one word holding a
        // digit, taken whole, up to DETAIL_MAX_CHARS; anything else learns nothing.
        "patient_id" => {
            let w = t.trim_start_matches('#');
            (!w.is_empty() && !w.chars().any(char::is_whitespace) && w.chars().any(|c| c.is_ascii_digit())
                && w.chars().count() <= DETAIL_MAX_CHARS).then(|| w.to_string())
        }
        // As printed (spec 2026-10-17): spaces tidied, nothing worked out from it. Sizes are never read as dates.
        "xray_type" | "xray_size" | "practice" => {
            let v = t.split_whitespace().collect::<Vec<_>>().join(" ");
            (v.chars().any(char::is_alphanumeric) && v.chars().count() <= DETAIL_MAX_CHARS).then_some(v)
        }
        // Owner Q6 (addendum 2026-10-17): read exactly as the screen reads them (`genderIn`/`referrerIn`,
        // filmText.ts), pinned to tests/gender_referrer_lines.json.
        "gender" => gender_in(t).map(str::to_string),
        "referrer" => referrer_in(t).filter(|v| v.chars().count() <= DETAIL_MAX_CHARS),
        _ => None,
    }
}

/// A pattern word of a machine: seen in this place on films of two different patients.
#[derive(Debug, Clone, PartialEq)]
pub struct Anchor { pub token: String, pub cx: f64, pub cy: f64 }
pub const ANCHOR_TOL: f64 = 0.04;
pub const MATCH_SCORE: f64 = 0.6;
pub const MATCH_MIN_ANCHORS: usize = 2;

pub fn near(ax: f64, ay: f64, bx: f64, by: f64) -> bool { (ax - bx).hypot(ay - by) <= ANCHOR_TOL }

/// Two films can come from one machine only if their pixel sizes agree within 2% (or do so turned a quarter).
pub fn same_size(a: (u32, u32), b: (u32, u32)) -> bool {
    let close = |x: u32, y: u32| (x as f64 - y as f64).abs() <= 0.02 * x.max(y) as f64;
    (close(a.0, b.0) && close(a.1, b.1)) || (close(a.0, b.1) && close(a.1, b.0))
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Score {
    pub fraction: f64, pub matched: usize, pub mirrored: bool,
    /// How far down this film sits from the machine's pattern (median over the matched anchors; 0 with none).
    pub dy: f64,
}

/// The median of some offsets, 0 when there are none.
pub fn median(mut v: Vec<f64>) -> f64 {
    if v.is_empty() { return 0.0; }
    v.sort_by(f64::total_cmp);
    let n = v.len();
    if n % 2 == 1 { v[n / 2] } else { (v[n / 2 - 1] + v[n / 2]) / 2.0 }
}

/// How much of a machine's pattern is on this film, as printed or mirrored, whichever is more, and how far it is shifted.
pub fn anchor_score(anchors: &[Anchor], film: &[FilmToken]) -> Score {
    let hits = |mirror: bool| -> Vec<f64> { anchors.iter().filter_map(|a| {
        let ax = if mirror { 1.0 - a.cx } else { a.cx };
        film.iter().find(|t| t.token == a.token && near(ax, a.cy, t.cx, t.cy)).map(|t| t.cy - a.cy)
    }).collect() };
    let (plain, flipped) = (hits(false), hits(true));
    let (dys, mirrored) = if flipped.len() > plain.len() { (flipped, true) } else { (plain, false) };
    let matched = dys.len();
    Score { fraction: if anchors.is_empty() { 0.0 } else { matched as f64 / anchors.len() as f64 }, matched, mirrored, dy: median(dys) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{even_words, DateOrder, TextLine, Ymd};
    fn line(text: &str, bbox: [f64; 4]) -> TextLine { TextLine { text: text.into(), confidence: 1.0, bbox, words: even_words(text, bbox) } }
    fn today() -> Ymd { Ymd { y: 2026, m: 9, d: 29 } }
    fn known() -> Vec<String> { LABEL_WORDS.iter().map(|w| w.to_string()).collect() }
    fn film(name: &str) -> Vec<TextLine> {   // Demo Ceph A: practice line, name, sex/age, DOB, PID down the left
        vec![line("Demo Radiology Northside", [0.02, 0.02, 0.3, 0.02]), line(name, [0.02, 0.05, 0.3, 0.02]),
             line("M, Y26", [0.02, 0.08, 0.1, 0.02]), line("DOB 01/01/2000 SYNTHETIC", [0.02, 0.11, 0.25, 0.02]),   // SYNTHETIC
             line("PID 12345", [0.02, 0.14, 0.12, 0.02]), line("Se: Feb 07, 2024 01:36 PM", [0.70, 0.05, 0.28, 0.02])]
    }
    #[test] fn tokens_drop_digits_single_letters_and_punctuation() {
        assert_eq!(token("J.Morita"), Some("j.morita".into()));
        assert_eq!(token("DOB:"), Some("dob".into()));
        assert_eq!((token("01/01/2000"), token("Y26"), token("M,")), (None, None, None));
    }
    #[test] fn a_selection_becomes_a_rule_from_its_line_start_comma_or_anchor() {
        let f = film("SMITH, John");   // SYNTHETIC
        let last = rule_from_selection(&f[1], 0, 0, "last", &known()).unwrap();
        assert_eq!((last.start.code(), last.end.code(), last.right), ("line".into(), "comma".into(), false));
        let first = rule_from_selection(&f[1], 1, 1, "first", &known()).unwrap();
        assert_eq!((first.start.code(), first.end.code()), ("comma".into(), "end".into()));
        let id = rule_from_selection(&f[4], 1, 1, "scan_id", &known()).unwrap();
        assert_eq!((id.start.code(), id.end.code()), ("after:pid".into(), "end".into()));
        let date = rule_from_selection(&f[5], 1, 3, "film_date", &known()).unwrap();
        assert_eq!((date.start.code(), date.end.code(), date.right), ("after:se".into(), "words:3".into(), true));
        assert!((last.row_y - 0.06).abs() < 1e-9);
    }
    #[test] fn a_rule_reads_names_of_any_length_and_nothing_when_its_row_is_missing() {
        let learned = rule_from_selection(&film("SMITH, John")[1], 0, 0, "last", &known()).unwrap();   // SYNTHETIC
        for (name, want) in [("LI, Jo", "LI"), ("VAN DER BERG-SMITH, Mary Anne", "VAN DER BERG-SMITH"), ("NGUYEN THI, Lan", "NGUYEN THI")] {
            assert_eq!(read_rule(&film(name), &learned).map(|p| p.text), Some(want.to_string()), "{name}");
        }
        let first = rule_from_selection(&film("SMITH, John")[1], 1, 1, "first", &known()).unwrap();   // SYNTHETIC
        assert_eq!(read_rule(&film("VAN DER BERG, Mary Anne"), &first).map(|p| p.text), Some("Mary Anne".into()));
        let mut no_row = film("SMITH, John"); no_row.remove(1);   // SYNTHETIC
        assert_eq!(read_rule(&no_row, &learned), None, "the lines above and below are never read instead");
        assert_eq!(read_rule(&film("SMITH John"), &learned), None, "no comma: the rule does not apply");   // SYNTHETIC
    }
    #[test] fn a_mirrored_rule_reads_the_other_side() {
        let r = rule_from_selection(&film("SMITH, John")[4], 1, 1, "scan_id", &known()).unwrap().mirrored();   // SYNTHETIC
        let flipped = vec![line("PID 777", [0.86, 0.14, 0.12, 0.02])];
        assert_eq!(read_rule(&flipped, &r).map(|p| p.text), Some("777".into()));
    }
    #[test] fn field_values_are_tidied_like_the_label_reader() {
        assert_eq!(field_value("last", "SMITH,", DateOrder::Au, today()), Some("Smith".into()));
        assert_eq!(field_value("full", "SMITH, John", DateOrder::Au, today()), Some("Smith, John".into()));
        assert_eq!(field_value("film_date", "Feb 07, 2024", DateOrder::Au, today()), Some("2024-02-07".into()));
        assert_eq!(field_value("dob", "01/02/2000", DateOrder::Us, today()), Some("2000-01-02".into()));   // SYNTHETIC
        assert_eq!(field_value("scan_id", "#12345", DateOrder::Au, today()), Some("12345".into()));
        assert_eq!(field_value("dob", "no date", DateOrder::Au, today()), None);
    }
    #[test] fn film_tokens_are_word_centres() {
        let t = film_tokens(&film("SMITH, John"));   // SYNTHETIC
        let demo = t.iter().find(|t| t.token == "demo").unwrap();
        assert!((demo.cy - 0.03).abs() < 1e-9 && demo.cx < 0.1 && demo.text == "Demo");
        assert!(!t.iter().any(|t| t.token.chars().any(|c| c.is_ascii_digit())));
    }
    fn anchors() -> Vec<Anchor> {
        ["demo", "radiology", "northside", "dob", "pid"].iter().zip([(0.05, 0.03), (0.15, 0.03), (0.27, 0.03), (0.04, 0.12), (0.04, 0.15)])
            .map(|(t, (x, y))| Anchor { token: t.to_string(), cx: x, cy: y }).collect()
    }
    fn toks(v: &[(&str, f64, f64)]) -> Vec<FilmToken> { v.iter().map(|(t, x, y)| FilmToken { token: t.to_string(), text: t.to_string(), cx: *x, cy: *y }).collect() }
    #[test] fn a_film_with_the_pattern_scores_high_and_a_different_one_low() {
        let same = toks(&[("demo", 0.05, 0.03), ("radiology", 0.16, 0.03), ("northside", 0.27, 0.035), ("dob", 0.04, 0.12), ("pid", 0.04, 0.15), ("smith", 0.05, 0.06)]);
        let s = anchor_score(&anchors(), &same);
        assert_eq!((s.matched, s.mirrored), (5, false)); assert!((s.fraction - 1.0).abs() < 1e-9);
        let other = toks(&[("planmeca", 0.5, 0.9), ("dob", 0.8, 0.5)]);
        assert!(anchor_score(&anchors(), &other).fraction < MATCH_SCORE);
    }
    #[test] fn a_flipped_film_scores_as_mirrored() {
        let flipped = toks(&[("demo", 0.95, 0.03), ("radiology", 0.85, 0.03), ("northside", 0.73, 0.03), ("dob", 0.96, 0.12)]);
        let s = anchor_score(&anchors(), &flipped);
        assert!(s.mirrored && s.matched == 4);
    }
    #[test] fn sizes_match_within_2_percent_either_way_round() {
        assert!(same_size((2000, 1600), (2030, 1590)) && same_size((2000, 1600), (1600, 2000)));
        assert!(!same_size((2000, 1600), (2100, 1600)));
    }
    /// Final review C1: a rule never records a patient's own word ("after:smith").
    #[test] fn a_rule_after_a_patients_own_word_is_never_learned() {
        let l = line("SMITH JOHN", [0.02, 0.05, 0.3, 0.02]);   // SYNTHETIC
        assert_eq!(rule_from_selection(&l, 1, 1, "first", &known()), None);
        let with_anchor = [known(), vec!["northside".to_string()]].concat();
        let l = line("Northside SMITH, John", [0.02, 0.05, 0.3, 0.02]);   // SYNTHETIC
        assert_eq!(rule_from_selection(&l, 1, 1, "last", &with_anchor).map(|r| r.start.code()), Some("after:northside".to_string()));
    }
    /// Final review C2: a name rule ends at the line end, a comma or a label — never after N words.
    #[test] fn a_name_rule_ends_at_a_label_not_after_a_count_of_words() {
        let r = rule_from_selection(&line("Name: SMITH John Sex: M", [0.02, 0.05, 0.4, 0.02]), 1, 2, "full", &known()).unwrap();   // SYNTHETIC
        assert_eq!((r.start.code(), r.end.code()), ("after:name".to_string(), "before:sex".to_string()));
        let other = vec![line("Name: VAN DER BERG Mary Anne Sex: F", [0.02, 0.05, 0.5, 0.02])];   // SYNTHETIC
        assert_eq!(read_rule(&other, &r).map(|p| p.text), Some("VAN DER BERG Mary Anne".to_string()));
        assert_eq!(rule_from_selection(&line("SMITH John 4471", [0.02, 0.05, 0.3, 0.02]), 0, 1, "full", &known()), None,   // SYNTHETIC
            "nothing marks where a name ends");
    }
    /// Final review C2: a rule never starts wider than the selection.
    #[test] fn a_rule_never_starts_wider_than_the_selection() {
        assert_eq!(rule_from_selection(&line("ID 4471 SMITH, John", [0.02, 0.05, 0.3, 0.02]), 2, 3, "full", &known()), None);   // SYNTHETIC
    }
    #[test] fn a_name_value_never_has_digits() {
        assert_eq!(field_value("full", "Id 5555 Jones, Ann", DateOrder::Au, today()), None);
    }
    /// Final review C3: a film that matches its machine but sits a little lower reports how far, so rules move with it.
    #[test] fn a_shifted_film_reports_its_offset() {
        let shifted: Vec<FilmToken> = anchors().iter().map(|a| FilmToken { token: a.token.clone(), text: a.token.clone(), cx: a.cx + 0.01, cy: a.cy + 0.025 }).collect();
        let s = anchor_score(&anchors(), &shifted);
        assert!(s.matched == 5 && (s.dy - 0.025).abs() < 1e-9, "{s:?}");
        assert_eq!(anchor_score(&anchors(), &toks(&[("planmeca", 0.5, 0.9)])).dy, 0.0);
    }
    /// Spec 2026-10-17 (D-LEARN-1): the new details are learned like the old ones. A practice name or X-ray type can be
    /// any number of words, so (like a name) its place never ends after a count of words; IDs and sizes may.
    #[test] fn the_new_details_read_as_printed_and_practice_and_type_never_end_after_a_count() {
        let f = vec![line("Demo Radiology Northside", [0.02, 0.02, 0.3, 0.02]), line("PID 5566", [0.02, 0.14, 0.12, 0.02]),
                     line("LATERAL CEPH 24 x 30 cm", [0.6, 0.9, 0.3, 0.02])];
        let mut k = known(); k.push("ceph".into());                          // a machine anchor
        let practice = rule_from_selection(&f[0], 0, 2, "practice", &k).unwrap();
        assert_eq!((practice.start.code(), practice.end.code()), ("line".into(), "end".into()));
        assert_eq!(rule_from_selection(&f[0], 0, 1, "practice", &k), None, "a practice never ends after a count of words");
        assert_eq!(rule_from_selection(&f[2], 0, 1, "xray_type", &k), None, "nor does an X-ray type (\"24\" is no label)");
        assert_eq!(rule_from_selection(&f[2], 2, 5, "xray_size", &k).unwrap().start.code(), "after:ceph", "dimensions next to the type on one line");
        assert_eq!(rule_from_selection(&f[1], 1, 1, "patient_id", &k).unwrap().start.code(), "after:pid");
        assert_eq!(field_value("practice", "  Demo   Radiology Northside, ", DateOrder::Au, today()), Some("Demo Radiology Northside".into()));
        assert_eq!(field_value("xray_size", "24 x 30 cm", DateOrder::Au, today()), Some("24 x 30 cm".into()));
        assert_eq!(field_value("xray_size", "10/12", DateOrder::Au, today()), Some("10/12".into()), "never read as a date");
        assert_eq!(field_value("patient_id", "#5566", DateOrder::Au, today()), Some("5566".into()));
        assert_eq!(field_value("xray_type", " - ", DateOrder::Au, today()), None);
        assert_eq!(field_value("xray_type", "", DateOrder::Au, today()), None);
        assert_eq!(field_value("practice", &"x".repeat(201), DateOrder::Au, today()), None);
        assert_eq!(field_value("practice", &"é".repeat(200), DateOrder::Au, today()), Some("é".repeat(200)), "200 code points, not bytes");
        assert!(["patient_id", "xray_type", "xray_size", "practice"].iter().all(|f| FIELDS.contains(f)));
    }
    /// S4 known limit + ruling I-1 (spec 2026-10-17): a learned Patient ID is never a truncated value. It is
    /// learned only when the text at its learned place is exactly one word holding a digit, taken whole (up to 200
    /// characters); anything else learns nothing, and the ID can still be typed or chosen.
    #[test] fn a_learned_patient_id_is_one_whole_word_with_a_digit_or_nothing() {
        let v = |t: &str| field_value("patient_id", t, DateOrder::Au, today());
        assert_eq!(v("A1234"), Some("A1234".into()));
        assert_eq!(v("ZQ-7781"), Some("ZQ-7781".into()));
        assert_eq!(v("7781 ZQ"), None, "two words: never just the first");
        assert_eq!(v("ZQ 7781"), None);
        assert_eq!(v("ABC"), None, "no digit");
        let long = "PID-123456789012345678901234";
        assert_eq!(v(long), Some(long.to_string()), "a long hyphenated ID is taken whole, never a prefix");
        let over = format!("PID-{}", "1".repeat(197));
        assert_eq!(over.chars().count(), 201);
        assert_eq!(v(&over), None, "over 200: nothing, never a prefix");
        assert_eq!(v(&over[..200]).map(|s| s.chars().count()), Some(200));
    }
    /// Pre-flight D11: ONE list of the learnable new details and ONE length limit, pinned to the fixture the screen's
    /// `choose.ts` (`DETAIL_FIELDS`, `DETAIL_MAX`) is also pinned to, so the two languages cannot drift apart.
    #[test] fn the_detail_fields_and_limit_match_the_shared_fixture() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../tests/detail_fields.json")).unwrap();
        let fields: Vec<&str> = v["fields"].as_array().unwrap().iter().map(|f| f.as_str().unwrap()).collect();
        assert_eq!(fields, DETAIL_FIELDS);
        assert_eq!(v["maxChars"].as_u64(), Some(DETAIL_MAX_CHARS as u64));
        assert_eq!(v["counts"].as_str(), Some("code points"));
        // Preflight ruling (Task 7, X8): FIELDS gained gender/referrer after DETAIL_FIELDS, so the old
        // `FIELDS[FIELDS.len() - DETAIL_FIELDS.len()..]` slice now lands on the wrong four fields. DETAIL_FIELDS is
        // FIELDS[6..10]; PATIENT_FIELDS follow.
        assert_eq!(&FIELDS[6..10], DETAIL_FIELDS, "every new detail is learnable");
    }
    /// Q6: Gender and Referring practitioner read exactly as the screen reads them (shared fixture).
    #[test] fn gender_and_referrer_read_as_the_screen_reads_them() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../tests/gender_referrer_lines.json")).unwrap();
        for row in v["gender"].as_array().unwrap() {
            let (line, want) = (row[0].as_str().unwrap(), row[1].as_str());
            assert_eq!(field_value("gender", line, DateOrder::Au, today()).as_deref(), want, "gender {line:?}");
        }
        for row in v["referrer"].as_array().unwrap() {
            let (line, want) = (row[0].as_str().unwrap(), row[1].as_str());
            assert_eq!(field_value("referrer", line, DateOrder::Au, today()).as_deref(), want, "referrer {line:?}");
        }
        assert_eq!(FIELDS.len(), 12);
        assert_eq!(&FIELDS[10..], &PATIENT_FIELDS);
    }
    /// A referrer, like a name, is any number of words: its place never ends after a count of words. Preflight
    /// ruling (Task 7, 7a): the selection starts at the line's start, as the screen offers a referrer line
    /// (`referrer_in` strips "Ref:" itself).
    #[test] fn a_referrer_place_never_ends_after_a_count_of_words() {
        let l = line("Dr Jane Demo 5566", [0.02, 0.5, 0.3, 0.02]);
        assert!(rule_from_selection(&l, 0, 2, "referrer", &known()).is_none(), "ends before a non-label word: no rule");
        assert_eq!(rule_from_selection(&l, 0, 3, "referrer", &known()).map(|r| r.end), Some(End::Line));
    }
}
