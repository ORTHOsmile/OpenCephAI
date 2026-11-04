//! The label's text, line by line (top to bottom), to the four fields (spec Part 1, "Field extraction").
use crate::dates::{DateOrder, Ymd};

#[derive(Debug, Clone, Default, PartialEq)]
pub struct LabelFields {
    pub name: Option<String>, pub date_of_birth: Option<Ymd>, pub scan_date: Option<Ymd>, pub scan_id: Option<String>,
    pub patient_id: Option<String>,
}

use crate::dates::{field_answer, has_reading, is_js_space, read_dates, DateRead, FieldAnswer, Rule};
use regex::Regex;
use std::sync::LazyLock;

// `pub(crate)` normally; `pub` only under the "harness" feature (an external acceptance harness, path-dependent
// on this crate — re-review minor, 13 Oct). Two cfg-gated declarations, never both compiled at once, rather than
// a `pub use` reexport: Rust's privacy rules refuse to reexport a `pub(crate)` item as `pub` (E0365), so the
// item's own declared visibility has to be the thing that changes.
#[cfg(not(feature = "harness"))]
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum Kind { Surname, Given, Dob, Id, Pid, Acc, Name, Scan, Other }
#[cfg(feature = "harness")]
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Kind { Surname, Given, Dob, Id, Pid, Acc, Name, Scan, Other }

/// Label words, in priority order at the same position ("Date of birth" is a birth label, "Patient ID" an ID label).
static LABEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?ix)
      (?P<surname> \b(?:surname|last\s*name|family\s*name)\b )
    | (?P<given>   \b(?:given\s*names?|given|first\s*names?|forenames?)\b )
    | (?P<dob>     \bd\.?\s?o\.?\s?b\b\.? | \bdate\s+of\s+birth\b | \bbirth\s*date\b | \bbirth\b | \bborn\b | \bgeb\b\.? )
    | (?P<pid>     \b(?:patient\s*id|pid)\b\.? )
    | (?P<id>      \b(?:mrn|chart(?:\s*no)?|id|no)\b\.? )
    | (?P<acc>     \bacc(?:ession)?(?:\s*(?:no|number))?\b\.? | ^\s*\# )
    | (?P<name>    \b(?:patient\s*name|patient|name|nom|pt)\b )
    | (?P<scan>    \b(?:exam(?:ination)?\s*date|study\s*date|scan\s*date|acq\w*\s*date|date|exam|study|scan|acq\w*|taken|se)\b )
").unwrap());
static ID_TOKEN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[A-Za-z0-9][A-Za-z0-9.\-]{0,19}\b").unwrap());

/// Words that are equipment or view text, never a patient's name.
const NOT_NAMES: [&str; 24] = ["opg", "dx", "planmeca", "promax", "sirona", "orthophos", "carestream", "kodak", "vatech", "pax", "lateral", "lat",
    "ceph", "cephalometric", "cephalogram", "left", "right", "kv", "ma", "mas", "sec", "mm", "scale", "magnification"];

/// A word before "Name" that makes it someone else's name (the practice's, a doctor's, a middle name).
const NOT_PATIENT: [&str; 20] = ["institution", "practice", "clinic", "hospital", "doctor", "dr", "physician", "referring", "referrer", "operator",
    "technician", "tech", "middle", "facility", "site", "study", "user", "file", "company", "department"];

fn labels_impl(line: &str) -> Vec<(Kind, usize, usize)> {
    LABEL.captures_iter(line).filter_map(|c| {
        let (kind, m) = [("surname", Kind::Surname), ("given", Kind::Given), ("dob", Kind::Dob), ("pid", Kind::Pid), ("id", Kind::Id), ("acc", Kind::Acc), ("name", Kind::Name), ("scan", Kind::Scan)]
            .into_iter().find_map(|(g, k)| c.name(g).map(|m| (k, m)))?;
        // "Institution Name:", "Middle Name:" … still end the previous value but are never the patient's name.
        let before = line[..m.start()].split(|ch: char| !ch.is_alphabetic()).rfind(|w| !w.is_empty()).map(str::to_lowercase);
        let kind = if kind == Kind::Name && before.is_some_and(|w| NOT_PATIENT.contains(&w.as_str())) { Kind::Other } else { kind };
        Some((kind, m.start(), m.end()))
    }).collect()
}
#[cfg(not(feature = "harness"))]
pub(crate) fn labels(line: &str) -> Vec<(Kind, usize, usize)> { labels_impl(line) }
#[cfg(feature = "harness")]
pub fn labels(line: &str) -> Vec<(Kind, usize, usize)> { labels_impl(line) }

/// Names on labels are often in capitals: "SMITH, JOHN" → "Smith, John". Every word part after a space, hyphen or
/// apostrophe is capitalised, and "Mc" keeps its capital (McDonald).
pub fn title_case(s: &str) -> String {
    let mut out: Vec<char> = Vec::with_capacity(s.len());
    let mut start = true;
    for c in s.chars() {
        if start { out.extend(c.to_uppercase()) } else { out.extend(c.to_lowercase()) }
        start = !c.is_alphabetic();
    }
    for i in 2..out.len() {
        if out[i - 2] == 'M' && out[i - 1] == 'c' && (i < 3 || !out[i - 3].is_alphabetic()) && out[i].is_alphabetic() {
            out[i] = out[i].to_uppercase().next().unwrap_or(out[i]);
        }
    }
    out.into_iter().collect()
}

/// A labelled name value: the text up to any digit, at least two letters, in title case.
fn person_name(value: &str) -> Option<String> {
    let cut = value.find(|c: char| c.is_ascii_digit()).map_or(value, |i| &value[..i]);
    let v = cut.trim().trim_end_matches([',', ';', ':', '-', '/']).trim();
    (v.chars().filter(|c| c.is_alphabetic()).count() >= 2).then(|| title_case(v))
}

/// A labelled ID value: one token of letters, digits and hyphens, up to 20 characters, with at least one digit.
pub fn id_token(value: &str) -> Option<String> {
    let t = ID_TOKEN.find(value.trim())?.as_str();
    t.chars().any(|c| c.is_ascii_digit()).then(|| t.to_string())
}

/// Gender printed on the film (owner Q6, addendum 2026-10-17): F or M standing as its own word at the start of the
/// line, after an optional "Sex" or "Gender" label ("M, Y34", "Sex: F", "female"). The screen's own `genderIn`
/// (filmText.ts) is the reference; both are pinned to `tests/gender_referrer_lines.json`. Rust's `regex` crate has no
/// lookahead, so the screen's `(?![\p{L}\p{N}.])` becomes the equivalent consuming group `(?:$|[^\p{L}\p{N}.])`.
static GENDER: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*(?:(?:sex|gender)\b\s*[:-]?\s*)?(female|male|f|m)(?:$|[^\p{L}\p{N}.])").unwrap());
pub fn gender_in(line: &str) -> Option<&'static str> {
    GENDER.captures(line).map(|c| if c[1].to_ascii_lowercase().starts_with('f') { "F" } else { "M" })
}

/// The screen's `referrerIn` (filmText.ts): the line without a leading label ("Ref:", "Ref. by", "Referred by",
/// "Referring Dr:"), keeping "Dr"; None when no name is left. Pinned to `tests/gender_referrer_lines.json`.
static REF_LABEL: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?i)^\s*(?:referred\s+by\b\s*:?|ref\.?\s*by\b\s*:?|referr(?:ing|al)?(?:\s+(?:doctor|practitioner|physician|dr\.?))?\s*:|ref\b\.?\s*:?)\s*").unwrap());
pub fn referrer_in(line: &str) -> Option<String> {
    let v = REF_LABEL.replace(line, "").trim().trim_end_matches(|c: char| c.is_whitespace() || ",;:".contains(c)).to_string();
    (v.chars().filter(|c| c.is_alphabetic()).count() >= 2 && v.chars().collect::<Vec<_>>().windows(2).any(|w| w[0].is_alphabetic() && w[1].is_alphabetic())).then_some(v)
}

/// Words that mark a practice, clinic or company line ("Demo Radiology Northside", "… Imaging Centre", "… Pty Ltd").
const PRACTICE: [&str; 26] = ["radiology", "radiologist", "radiologists", "imaging", "xray", "x-ray", "dental", "dentistry", "dentist",
    "orthodontic", "orthodontics", "orthodontist", "clinic", "medical", "centre", "center", "hospital", "diagnostic", "diagnostics",
    "health", "pty", "ltd", "group", "specialist", "specialists", "services"];
/// "SMITH, John": a surname in capitals, a comma, then the given name(s).
static SURNAME_COMMA: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^\p{Lu}[\p{Lu}'’\-]+(?:\s+\p{Lu}[\p{Lu}'’\-]+)*,\s*\p{L}").unwrap());

/// With no name label, the one unlabelled name taken: "SURNAME, Given" within three lines above the date of birth, on a
/// line that isn't equipment, practice or label text. Nothing else is ever guessed (owner, 29 Sep: a wrong name is worse
/// than a blank one, which the clinician is asked to fill).
fn unlabelled_name(lines: &[&str], dob_line: Option<usize>) -> Option<String> {
    let word = |w: &str| w.trim_matches(|c: char| !c.is_alphabetic() && c != '-').to_lowercase();
    let d = dob_line?;
    lines.iter().enumerate().take(d).skip(d.saturating_sub(3)).map(|(i, l)| (i, l.trim())).rfind(|(_, l)| {
        let words: Vec<&str> = l.split_whitespace().collect();
        (2..=4).contains(&words.len())
            && words.iter().all(|w| w.chars().any(char::is_alphabetic) && w.chars().all(|c| c.is_alphabetic() || matches!(c, '\'' | '’' | '-' | ',' | '.')))
            && !words.iter().any(|w| NOT_NAMES.contains(&word(w).as_str()) || PRACTICE.contains(&word(w).as_str()))
            && LABEL.find(l).is_none()
            && SURNAME_COMMA.is_match(l)
    }).map(|(_, l)| title_case(l))
}

fn strip_value(v: &str) -> &str { v.trim_start_matches(|c: char| c == ':' || c == '.' || c == '-' || c == '#' || c.is_whitespace()).trim() }

/// Whether a label's value is its own separate OCR word — a JS-whitespace character somewhere between the end of
/// the label match and the first alphanumeric character of its value. A label glued directly onto the value with
/// no space at all ("DOB:024-Jan-12") is one OCR word; the screen, asked about that exact word, can never isolate
/// the value from the label either (its own clean-up before completing a 3-digit year strips leading PUNCTUATION
/// only, never a leading letter), so the import reader must not be more generous (re-review minor, 13 Oct).
fn label_separated_by_space(line: &str, value: usize) -> bool {
    line[value..].chars().take_while(|c| !c.is_ascii_alphanumeric()).any(|c| is_js_space(c))
}

/// One piece of a label line that holds a date shape: the date read there (the screen's answer for the piece), or
/// `refused` when a date shape is printed there but the screen gives nothing for it (a cut year, an impossible date).
/// `pub(crate)` normally, `pub` only under the "harness" feature — see `Kind` above for why it is two declarations.
#[cfg(not(feature = "harness"))]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct PieceDate { pub owner: Option<Kind>, pub read: Option<DateRead>, pub refused: bool }
#[cfg(feature = "harness")]
#[derive(Debug, Clone, PartialEq)]
pub struct PieceDate { pub owner: Option<Kind>, pub read: Option<DateRead>, pub refused: bool }

/// The dates on one label line, each with the label that owns its piece (None: the date only counts as "another
/// date"). The line is cut into pieces the way the other fields are: the text before the first label (owned by a
/// label that ended the line above, if any), then each label up to the next one. A date label's piece (DOB,
/// Date/Exam/Se…) is read by the screen's field rule (`chosenValue`) on the label and its value — or, when no date
/// reads there, on the value alone, which is where the screen's 3-digit-year completion can apply ("DOB:
/// 024-Jan-12"). Every other piece is read by the screen's line rule (`usesOf(...).date`): no completion, so an ID or
/// version number is never completed into a date (review C2). Each piece gives at most ONE date, its first; a piece
/// whose first reading the screen refuses gives none and is marked `refused` (review C1). LABEL-1 fix round 2
/// (ruling LB-2): every date returned is the screen's own answer for the text recorded in its `DateRead` (byte
/// offsets relative to `line`).
#[cfg(not(feature = "harness"))]
pub(crate) fn line_dates(line: &str, found: &[(Kind, usize, usize)], pending: Option<Kind>, order: DateOrder, today: Ymd) -> Vec<PieceDate> {
    line_dates_impl(line, found, pending, order, today)
}
#[cfg(feature = "harness")]
pub fn line_dates(line: &str, found: &[(Kind, usize, usize)], pending: Option<Kind>, order: DateOrder, today: Ymd) -> Vec<PieceDate> {
    line_dates_impl(line, found, pending, order, today)
}
fn line_dates_impl(line: &str, found: &[(Kind, usize, usize)], pending: Option<Kind>, order: DateOrder, today: Ymd) -> Vec<PieceDate> {
    let first = found.first().map_or(line.len(), |l| l.1);
    let mut pieces: Vec<(Option<Kind>, usize, usize, usize)> = vec![(pending, 0, 0, first)];   // (owner, start, value start, stop)
    for (i, &(k, start, end)) in found.iter().enumerate() {
        pieces.push((Some(k), start, end, found.get(i + 1).map_or(line.len(), |l| l.1)));
    }
    let mut out = Vec::new();
    for (owner, start, value, stop) in pieces {
        let date_label = matches!(owner, Some(Kind::Dob | Kind::Scan));
        let piece = &line[start..stop];
        let mut read = read_dates(piece, if date_label { Rule::Field } else { Rule::Line }, order, today).into_iter().next();
        if read.is_none() && date_label && value > start && label_separated_by_space(line, value) {
            // The screen's answer for the value's words alone, when that is a completed 3-digit year ("DOB: 024-Jan-12").
            // Only when the label and the value are separate OCR words (a space between them): a label GLUED
            // directly onto the value with no space ("DOB:024-Jan-12") is one OCR word, and the screen — asked
            // about that exact word — can never isolate the value either, so it must agree (re-review minor).
            if let FieldAnswer::Completed(s, e, date) = field_answer(&line[value..stop], order, today) {
                read = Some(DateRead { date, start: value - start + s, end: value - start + e, text: (value - start, stop - start), rule: Rule::Field });
            }
        }
        let owner = if date_label { owner } else { None };
        match read {
            Some(mut r) => {
                (r.start, r.end, r.text) = (r.start + start, r.end + start, (r.text.0 + start, r.text.1 + start));
                out.push(PieceDate { owner, read: Some(r), refused: false });
            }
            None if has_reading(piece, order, today) => out.push(PieceDate { owner, read: None, refused: true }),
            None => {}
        }
    }
    out
}

/// The four fields from the label's lines (top to bottom). Each date belongs to the nearest label before it on its line,
/// or to a label that ended the previous line. A name comes from Name/Patient/Pt/Nom, else Surname + Given ("Surname,
/// Given"), else the unlabelled-name rule. With no scan-date label, the one other date that isn't the birth date is used.
pub fn parse_label(lines: &[&str], order: DateOrder, today: Ymd) -> LabelFields {
    let mut f = LabelFields::default();
    let (mut surname, mut given): (Option<String>, Option<String>) = (None, None);
    let mut accession: Option<String> = None;             // an accession number or a line-start '#': used only with no ID
    let mut other_dates: Vec<Ymd> = Vec::new();         // dates not under a DOB label, for the "one other date" rule
    let (mut refused_dob, mut refused_scan) = (false, false);
    let mut pending: Option<Kind> = None;
    let mut dob_line: Option<usize> = None;
    for (n, line) in lines.iter().enumerate() {
        let found = labels(line);
        let mut text = |k: Kind, v: &str, f: &mut LabelFields| match k {
            Kind::Name if f.name.is_none() => f.name = person_name(v),
            Kind::Surname => surname = person_name(v).or(surname.take()),
            Kind::Given => given = person_name(v).or(given.take()),
            Kind::Id if f.scan_id.is_none() => f.scan_id = id_token(v),
            Kind::Pid if f.patient_id.is_none() => f.patient_id = id_token(v),
            Kind::Acc => accession = accession.take().or_else(|| id_token(v)),
            _ => {}
        };
        if let Some(k) = pending {                                            // the previous line ended with this label
            let stop = found.first().map_or(line.len(), |l| l.1);
            text(k, strip_value(&line[..stop]), &mut f);
        }
        for (i, &(k, _, end)) in found.iter().enumerate() {
            let stop = found.get(i + 1).map_or(line.len(), |l| l.1);
            text(k, strip_value(&line[end..stop]), &mut f);
        }
        for pd in line_dates(line, &found, pending, order, today) {
            let Some(read) = pd.read else {
                // The FIRST date label of a kind decides that field, as the earliest reading decides on the screen: if
                // the screen refuses its date, the field stays empty and no later label or other date fills it (C1).
                match pd.owner {
                    Some(Kind::Dob) if f.date_of_birth.is_none() => refused_dob = true,
                    Some(Kind::Scan) if f.scan_date.is_none() => refused_scan = true,
                    _ => {}
                }
                continue;
            };
            if pd.owner != Some(Kind::Dob) { other_dates.push(read.date); }   // a date under a DOB label is never the film date
            match pd.owner {
                Some(Kind::Dob) if f.date_of_birth.is_none() && !refused_dob => { f.date_of_birth = Some(read.date); dob_line = Some(n); }
                Some(Kind::Scan) if f.scan_date.is_none() && !refused_scan => f.scan_date = Some(read.date),
                _ => {}
            }
        }
        pending = found.last().filter(|l| strip_value(&line[l.2..]).is_empty()).map(|l| l.0);
    }
    if f.name.is_none() {
        f.name = match (surname, given) {
            (Some(s), Some(g)) => Some(format!("{s}, {g}")),
            (Some(s), None) => Some(s),
            (None, Some(g)) => Some(g),
            (None, None) => unlabelled_name(lines, dob_line),
        };
    }
    if f.scan_id.is_none() { f.scan_id = accession; }
    if f.scan_date.is_none() && !refused_scan {
        let mut others: Vec<Ymd> = other_dates.into_iter().filter(|d| Some(*d) != f.date_of_birth).collect();
        others.dedup();
        if others.len() == 1 { f.scan_date = Some(others[0]); }
    }
    f
}

#[cfg(test)]
mod tests {
    use super::*;
    use DateOrder::*;
    fn today() -> Ymd { Ymd { y: 2026, m: 9, d: 28 } }
    fn p(lines: &[&str], o: DateOrder) -> LabelFields { parse_label(lines, o, today()) }
    fn ymd(s: &str) -> Option<Ymd> { Ymd::parse_iso(s) }

    #[test] fn labelled_fields_on_separate_lines_in_either_date_order() {
        let lines = ["Name: SMITH, JOHN", "DOB: 07/03/1990", "Date: 12/09/2026", "ID: 4471"];   // SYNTHETIC
        assert_eq!(p(&lines, Au), LabelFields { name: Some("Smith, John".into()), date_of_birth: ymd("1990-03-07"), scan_date: ymd("2026-09-12"), scan_id: Some("4471".into()), patient_id: None });   // SYNTHETIC
        let us = p(&lines, Us);
        assert_eq!((us.date_of_birth, us.scan_date), (ymd("1990-07-03"), ymd("2026-12-09")));   // SYNTHETIC
    }
    #[test] fn labelled_fields_on_one_line() {
        let f = p(&["Patient: Jane O'BRIEN-McDONALD  DOB 1990-03-07  Exam 12 Sep 2026  MRN AB-1234"], Au);   // SYNTHETIC
        assert_eq!(f, LabelFields { name: Some("Jane O'Brien-McDonald".into()), date_of_birth: ymd("1990-03-07"), scan_date: ymd("2026-09-12"), scan_id: Some("AB-1234".into()), patient_id: None });   // SYNTHETIC
    }
    #[test] fn surname_and_given_labels_and_a_value_on_the_next_line() {
        let f = p(&["Surname: NGUYEN", "Given names: THI LAN", "Birth date:", "7 Mar 1990"], Au);
        assert_eq!((f.name.as_deref(), f.date_of_birth, f.scan_date), (Some("Nguyen, Thi Lan"), ymd("1990-03-07"), None));   // SYNTHETIC
        let f = p(&["Patient Name:", "DEMO SYNTHETIC", "Date of birth: 07/03/1990"], Au);
        assert_eq!((f.name.as_deref(), f.date_of_birth), (Some("Demo Synthetic"), ymd("1990-03-07")));   // SYNTHETIC
    }
    #[test] fn unlabelled_lines_and_unlabelled_dates_are_never_guessed() {
        let f = p(&["Planmeca ProMax", "LATERAL CEPH", "JOHN SMITH", "07.03.1990", "12.09.2026"], Au);
        assert_eq!(f.name, None, "no name label and no SURNAME, Given above a date of birth");
        assert_eq!((f.date_of_birth, f.scan_date), (None, None), "unlabelled dates are not guessed");
    }
    #[test] fn the_one_other_date_is_the_scan_date() {
        let f = p(&["Name: Demo Synthetic", "DOB: 07/03/1990", "12/09/2026"], Au);   // SYNTHETIC
        assert_eq!(f.scan_date, ymd("2026-09-12"));
    }
    /// LABEL-1 (owner 13 Oct): the screen's date rule must reach `parse_label` —
    /// not just the regex unit — since that is the actual import-time path (report.md §7). SYNTHETIC: a DOB line
    /// whose year was cut off by the film edge, same shape as the owner's screenshot.
    #[test] fn a_cut_year_dob_is_completed_through_parse_label_too() {
        let f = p(&["Name: Demo Synthetic", "DOB: 024-Jan-12"], Au);   // SYNTHETIC
        assert_eq!(f.date_of_birth, ymd("2024-01-12"));   // SYNTHETIC
    }
    /// Re-review minor (13 Oct): a single glued OCR word with NO space between the label and the date
    /// ("DOB:024-Jan-12") must agree with the screen — null. The screen, asked about that one word (there is no
    /// separate "024-Jan-12" word to select), never strips a leading label before completing a 3-digit year
    /// (`completedYear`'s own clean-up only strips LEADING PUNCTUATION, never a leading letter), so it never even
    /// tries the completion on text that starts with "DOB". The import reader must stop being more generous than
    /// the screen: it may only strip the label before completing when a space actually separates them in the OCR
    /// text (the screen's equivalent of the operator being able to select the date on its own). With a space
    /// ("DOB: 024-Jan-12") the two are separate OCR words either way, so completion still applies, unchanged.
    #[test] fn a_glued_label_with_no_space_before_the_date_is_never_completed_through_parse_label() {
        let f = p(&["Name: Demo Synthetic", "DOB:024-Jan-12"], Au);   // SYNTHETIC
        assert_eq!(f.date_of_birth, None);
        let f = p(&["Name: Demo Synthetic", "DOB: 024-Jan-12"], Au);   // SYNTHETIC: unchanged, a space separates them
        assert_eq!(f.date_of_birth, ymd("2024-01-12"));
    }
    /// LABEL-1: a scrap glued directly onto the day digits must leave the DOB unfilled, not misread as a day-first
    /// date (the exact defect the UI's `isCutYear` blocks).
    #[test] fn a_glued_scrap_before_the_date_leaves_dob_unfilled_through_parse_label() {
        let f = p(&["Name: Demo Synthetic", "DOB: )24-Jan-12"], Au);   // SYNTHETIC
        assert_eq!(f.date_of_birth, None);
    }
    /// LABEL-1 fix round 2, review C1: a DOB reading that is blocked (a cut year, an impossible date) leaves the DOB
    /// unfilled and never hands the NEXT date on the line to the DOB label — the screen gives null for the DOB's own
    /// text in all three, so the import reader must too.
    #[test] fn a_blocked_dob_reading_never_hands_the_next_date_on_the_line_to_the_dob() {
        for line in ["DOB: )24-Jan-12 07/02/2024 SYNTHETIC", "DOB )24-Jan-12 10.02.24 SYNTHETIC", "DOB 31/04/1990 12/01/2024 SYNTHETIC"] {
            let f = p(&["Name: Demo Synthetic", line], Au);
            assert_eq!((f.date_of_birth, f.scan_date), (None, None), "{line}");
        }
    }
    /// LABEL-1 fix round 2, review C2: the 3-digit-year completion is the screen's (only at the START of a date
    /// label's value, only when nothing else reads), so an ID, version or lot number is never completed into a date.
    #[test] fn ids_versions_and_numbers_are_never_completed_into_a_date() {
        for line in ["PID 012-03-04", "ID 012-03-04", "Acc 019-05-06", "Exam no 019-05-06", "Ver 010.2.3", "Version 010.2.3",
            "Lot 020/11/03", "mAs 012.5.6", "Ph 024-05-06", "Ser 001.02.03", "Scan 07/03/024-05-06"] {
            let f = p(&["Name: Demo Synthetic", line], Au);
            assert_eq!((f.date_of_birth, f.scan_date), (None, None), "{line}");
        }
        let f = p(&["DOB: Ver 010.2.3 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (None, None));
        let f = p(&["DOB 12/03/024 Jan 05 SYNTHETIC"], Au);   // a 3-digit year INSIDE a numeric date: the true year is unknown
        assert_eq!((f.date_of_birth, f.scan_date), (None, None));
    }
    /// LABEL-1 fix round 2, review C3: the learned-layout path (`layout::field_value`, called at import by
    /// `src-tauri/src/library.rs`) reads a date field exactly as the screen does: the earliest reading or nothing.
    #[test] fn the_learned_layout_path_reads_a_date_field_as_the_screen_does() {
        use crate::layout::field_value;
        assert_eq!(field_value("dob", ")24-Jan-12 10.02.24", Au, today()), None);   // SYNTHETIC
        assert_eq!(field_value("film_date", "Software 010.2.3 Exam 12/03/2024", Au, today()).as_deref(), Some("2024-03-12"));
        assert_eq!(field_value("dob", "07/13/1990", Au, today()), None);                     // C4: no day/month swap   // SYNTHETIC
        assert_eq!(field_value("dob", "é24-Jan-12", Au, today()), None);                     // I1: an accented scrap
    }
    /// LABEL-1 fix round 2, review C4: a numeric date is read strictly in the operator's order (the screen never swaps
    /// day and month to rescue an impossible reading), so a time such as "12.30.00" is never a film date.
    #[test] fn a_numeric_date_is_read_strictly_in_the_operators_order() {
        let f = p(&["DOB 07/03/1990 12.30.00 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (ymd("1990-03-07"), None));   // SYNTHETIC
        assert_eq!(p(&["DOB 03/25/1990 SYNTHETIC"], Au).date_of_birth, None);
        assert_eq!(p(&["DOB 25/03/1990 SYNTHETIC"], Us).date_of_birth, None);
    }
    /// LABEL-1 fix round 2: a label's text gives ONE date, the screen's answer for it. A second date-shaped token after
    /// the DOB ("12.30.00", a time the screen reads as 2000-12-30 in US order when it is chosen ON ITS OWN) is not the (SYNTHETIC)
    /// screen's answer for any label's text, so it never becomes the film date by the "one other date" rule.
    #[test] fn a_second_date_after_the_dob_on_its_line_is_not_read() {
        let f = p(&["DOB Feb 07, 1990 12.30.00 SYNTHETIC"], Us);
        assert_eq!((f.date_of_birth, f.scan_date), (ymd("1990-02-07"), None));   // SYNTHETIC
        let f = p(&["DOB 07/03/1990 12/01/2024 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (ymd("1990-03-07"), None));   // SYNTHETIC
    }
    /// LABEL-1 fix round 2 (review C1, ruling LB-2): the FIRST date label of a kind decides its field, as the earliest
    /// reading decides on the screen. When the screen refuses that label's date (a cut year, an impossible date), the
    /// field stays empty — a later label of the same kind, or the "one other date" rule, never fills it instead. A
    /// later refused label does not undo an earlier good one. A date read under a DOB label is never the film date.
    #[test] fn a_refused_date_label_refuses_its_field_and_dob_dates_are_never_the_film_date() {
        let f = p(&["DOB: 12.30.00 SYNTHETIC", "DOB 07/03/1990 SYNTHETIC"], Au);
        assert_eq!(f.date_of_birth, None);
        let f = p(&["DOB 07/03/1990 SYNTHETIC", "DOB )24-Jan-12 SYNTHETIC"], Au);
        assert_eq!(f.date_of_birth, ymd("1990-03-07"));   // SYNTHETIC
        let f = p(&["Date: 31/04/2024", "Exam 12/01/2024", "DOB 07/03/1990 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (ymd("1990-03-07"), None));   // SYNTHETIC
        let f = p(&["Date: 31/04/2024", "12/01/2024"], Au);
        assert_eq!(f.scan_date, None);
        let f = p(&["DOB 07/03/1990 SYNTHETIC", "DOB 01/02/2003 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (ymd("1990-03-07"), None));   // SYNTHETIC
    }
    /// LABEL-1 fix round 2, review I1: the scrap test is ASCII, as the screen's (`[A-Za-z0-9\s]`): an accented letter
    /// glued to a 2-digit-year date is a scrap, so the date is a cut year and fills nothing.
    #[test] fn a_non_ascii_letter_glued_to_the_date_is_a_scrap() {
        for line in ["DOB é24-Jan-12 SYNTHETIC", "DOB ü07/03/90 SYNTHETIC"] {
            assert_eq!(p(&[line], Au).date_of_birth, None, "{line}");
        }
    }
    /// LABEL-1 fix round 2, review (2) / NOT-SHARED §1: two labelled dates on one line. Each label reads its OWN text
    /// (from the label to the next label) by the screen's rule, so an impossible DOB blanks the DOB only.
    #[test] fn two_labelled_dates_on_one_line_are_each_read_from_their_own_text() {
        let f = p(&["DOB 01/13/2010 Date 07/02/2024 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (None, ymd("2024-02-07")));   // SYNTHETIC
        let f = p(&["DOB 31/04/1990 Exam 12/01/2024 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (None, ymd("2024-01-12")));   // SYNTHETIC
        let f = p(&["DOB: 13/01/2010 Scan: 02/07/2024 SYNTHETIC"], Us);   // SCANLABEL-1: "Scan" is its own label now
        assert_eq!((f.date_of_birth, f.scan_date), (None, ymd("2024-02-07")));
        let f = p(&["DOB: 07/03/1990   Date: 12/09/2026 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (ymd("1990-03-07"), ymd("2026-09-12")));   // SYNTHETIC
    }
    /// SCANLABEL-1 (owner 13 Oct): "Scan", "Exam" and "Study" (with ':' or a space, case-insensitive, exactly as the
    /// other film-date labels are matched) mark the film date on the import reader, as they already do on the
    /// screen's own reading of the words (the screen never excludes "Scan" from a date it is asked about — see the
    /// shared-fixture cases below). "Exam" and "Study" already worked (`scan(?:...)|exam|study|...` in `LABEL`);
    /// only "Scan" was missing.
    #[test] fn scan_exam_and_study_mark_the_film_date() {
        for (line, want) in [
            ("Scan: 12/01/2024 SYNTHETIC", "2024-01-12"), ("Scan 12/01/2024 SYNTHETIC", "2024-01-12"),
            ("SCAN: 12/01/2024 SYNTHETIC", "2024-01-12"), ("Exam: 12/01/2024 SYNTHETIC", "2024-01-12"),
            ("Study: 12/01/2024 SYNTHETIC", "2024-01-12"),
        ] {
            assert_eq!(p(&["Name: Demo Synthetic", line], Au).scan_date, ymd(want), "{line}");
        }
        // The owner's own example: a DOB label AND a Scan label on the SAME line. Before this fix "Scan" was not a
        // label, so the whole line from "DOB" onward was one piece and only the DOB's own (first) reading was kept
        // — the trailing date was silently dropped, not even reaching the "one other date" rule.
        let f = p(&["DOB: 07/03/1990 Scan: 12/01/2024 SYNTHETIC"], Au);
        assert_eq!((f.date_of_birth, f.scan_date), (ymd("1990-03-07"), ymd("2024-01-12")));
    }
    /// SCANLABEL-1 review: "Scan"/"Exam"/"Study" must not clash with "Scan ID", "Study ID" or "Exam no." (these are
    /// ID labels, not dates). A date label followed by non-date text — no digits at all — gives no date, exactly as
    /// it already does for the pre-existing "Exam"/"Study"/"Date" labels (`ids_versions_and_numbers_are_never_…`
    /// above); adding "Scan" to the same alternation does not change that rule.
    #[test] fn scan_exam_and_study_never_clash_with_their_own_id_labels() {
        for line in ["Scan ID: AB-1234", "Study ID: AB-1234", "Exam no. AB-1234", "Exam No: AB-1234"] {
            let f = p(&["Name: Demo Synthetic", line], Au);
            assert_eq!((f.date_of_birth, f.scan_date), (None, None), "{line}");
        }
        // The ID itself is still read correctly (through the Id label that follows the date-label piece).
        assert_eq!(p(&["Scan ID: AB-1234"], Au).scan_id.as_deref(), Some("AB-1234"));
    }
    /// LABEL-1 fix round 2, review C3 / ruling LB-2: every case in the shared file is read through the PRODUCTION
    /// paths, not a test-only twin: the learned-layout `field_value` must give exactly the screen's answer, and a
    /// DOB label (on the same line, or ending the line above) must give the screen's answer for label-free text and
    /// never a different date for text carrying labels of its own (those labels own their part of the line).
    #[test] fn shared_cases_agree_with_the_ui_through_every_production_path() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../../test-fixtures/label-date-cases.json")).unwrap();
        let today = Ymd::parse_iso(v["today"].as_str().unwrap()).unwrap();
        let cases = v["cases"].as_array().unwrap();
        let mut exact = 0;
        for case in cases {
            let text = case["text"].as_str().unwrap();
            let order = if case["order"].as_str().unwrap() == "US" { Us } else { Au };
            let want = case["want"].as_str().map(|s| s.to_string());
            for field in ["dob", "film_date"] {
                assert_eq!(crate::layout::field_value(field, text, order, today), want, "layout {field} text={text:?} {order:?}");
            }
            let same_line = format!("DOB: {text}");
            for lines in [vec!["DOB:", text], vec![same_line.as_str()]] {
                let got = parse_label(&lines, order, today).date_of_birth.map(|d| d.iso());
                if labels(text).is_empty() {
                    exact += 1;
                    assert_eq!(got, want, "parse_label {lines:?} {order:?}");
                } else {
                    assert!(got.is_none() || got == want, "parse_label {lines:?} {order:?}: {got:?} where the screen reads {want:?}");
                }
            }
        }
        assert!(exact > 80, "most cases must be compared exactly, got {exact}");
    }
    #[test] fn a_scan_id_needs_a_digit_and_at_most_20_characters() {
        assert_eq!(p(&["ID: ABC"], Au).scan_id, None);
        assert_eq!(p(&["Chart No. 00123"], Au).scan_id.as_deref(), Some("00123"));
        assert_eq!(p(&["# 77-12"], Au).scan_id.as_deref(), Some("77-12"));
        assert_eq!(p(&["ID: 123456789012345678901"], Au).scan_id, None);
    }
    /// Owner Q4 (17 Oct) + L5 A: "PID" and "Patient ID" fill the Patient ID, not the Scan ID; MRN, Chart No., ID,
    /// No., Scan ID stay Scan ID. A "PID" label at a line's end takes the next line, as other labels do.
    #[test] fn a_pid_or_patient_id_label_fills_the_patient_id_not_the_scan_id() {
        for (line, pid) in [("PID 12345", "12345"), ("Patient ID: AB-1234", "AB-1234"), ("PID. 5566", "5566"), ("patient id 77-12", "77-12")] {
            let f = p(&[line], Au);
            assert_eq!((f.patient_id.as_deref(), f.scan_id.as_deref()), (Some(pid), None), "{line}");
        }
        for line in ["MRN AB-1234", "Chart No. 00123", "ID: 4471", "Scan ID: AB-1234", "No. 4471"] {
            let f = p(&[line], Au);
            assert!(f.patient_id.is_none() && f.scan_id.is_some(), "{line}: {f:?}");
        }
        assert_eq!(p(&["PID", "5566"], Au).patient_id.as_deref(), Some("5566"));
        assert_eq!(p(&["PID ABC"], Au).patient_id, None, "an ID needs a digit, as Scan ID does");
    }
    /// Final review, important 1: a practice's, doctor's or middle name is never taken as the patient's.
    #[test] fn non_patient_name_labels_are_never_the_patient() {
        let f = p(&["Institution Name: SMILE ORTHO", "Patient Name: SMITH, JOHN", "DOB: 07/03/1990"], Au);   // SYNTHETIC
        assert_eq!(f.name.as_deref(), Some("Smith, John"));
        let f = p(&["Last Name: SMITH", "First Name: JOHN", "Middle Name: PAUL", "DOB: 07/03/1990"], Au);   // SYNTHETIC
        assert_eq!(f.name.as_deref(), Some("Smith, John"));
        let f = p(&["Referring Doctor Name: DR JONES", "Name: DEMO SYNTHETIC"], Au);
        assert_eq!(f.name.as_deref(), Some("Demo Synthetic"));
    }
    /// Owner, 29 Sep: "J.Morita Miig" (the X-ray machine) was filled as the patient. A wrong name is worse than none, so an
    /// unlabelled line is never taken as the name; the only unlabelled name used is "SURNAME, Given" just above the DOB.
    #[test] fn an_unlabelled_line_is_never_filled_as_the_name() {
        for lines in [&["J.Morita Miig", "DOB 01/01/2000"][..], &["SMILE ORTHODONTICS NASH", "JOHN SMITH", "DOB: 07/03/1990"],   // SYNTHETIC
            &["SMITH, John", "PID 12345"], &["SMITH, John", "a", "b", "c", "DOB 01/01/2000"], &["DOB 01/01/2000", "SMITH, John"]] {   // SYNTHETIC
            assert_eq!(p(lines, Au).name, None, "{lines:?}");
        }
    }
    /// Owner, 29 Sep: a radiology practice's label. The practice line comes first and has no label; the patient is
    /// "SURNAME, Given" just above the date of birth; the ID is "PID". (Made-up practice and patient.)
    #[test] fn a_practice_header_is_never_the_patient_and_surname_comma_given_above_the_dob_is() {
        let f = p(&["Demo Radiology Northside", "SMITH, John", "M, Y26", "DOB 01/01/2000", "PID 12345"], Au);   // SYNTHETIC
        assert_eq!(f.name.as_deref(), Some("Smith, John"), "SURNAME, Given right above the date of birth is the patient's name");
        assert_eq!((f.date_of_birth, f.patient_id.as_deref(), f.scan_id), (ymd("2000-01-01"), Some("12345"), None));   // SYNTHETIC
    }
    #[test] fn a_practice_line_is_never_the_patient_even_in_surname_comma_form() {
        for practice in ["DEMO, Imaging Centre", "NORTHSIDE DENTAL, Clinic", "DEMO X-RAY, Group", "DEMO RADIOLOGY, Pty Ltd"] {
            assert_eq!(p(&[practice, "DOB 01/01/2000"], Au).name, None, "{practice}");   // SYNTHETIC
        }
    }
    /// Owner, 29 Sep: the film's other corner is a viewer overlay ("Se: <date>", "Se: DX #1", "Im: 1/1", "Acc #…").
    /// Made-up values; left corner then right corner, as recognition returns them. Owner Q4 (17 Oct): "PID" fills
    /// the Patient ID, in its own box next to the Scan ID (the accession number); the two never compete.
    #[test] fn a_viewer_overlay_gives_the_patient_id_and_the_accession_number_their_own_boxes() {
        let left = ["Demo Radiology Northside", "SMITH, John", "M, Y26", "DOB 01/01/2000", "PID 12345"];   // SYNTHETIC
        let right = ["OPG & CEPHALOGRAM", "1 hour, 20 mins ago", "Se: Feb 07, 2024 01:36 PM", "Se: DX #1", "Im: 1/1", "Acc #12.3456789"];
        let f = p(&[&left[..], &right[..]].concat(), Au);
        assert_eq!(f.name.as_deref(), Some("Smith, John"));
        assert_eq!((f.date_of_birth, f.scan_date), (ymd("2000-01-01"), ymd("2024-02-07")));   // SYNTHETIC
        assert_eq!((f.patient_id.as_deref(), f.scan_id.as_deref()), (Some("12345"), Some("12.3456789")));
        let f = p(&[&left[..4], &right[..]].concat(), Au);
        assert_eq!((f.patient_id.as_deref(), f.scan_id.as_deref()), (None, Some("12.3456789")), "with no Patient ID, the whole accession number; never 'DX #1'");
    }
    #[test] fn an_empty_label_gives_nothing() { assert_eq!(p(&[], Au), LabelFields::default()); }
    /// Review focus 3.
    #[test] fn title_case_keeps_mc_apostrophes_and_hyphens() {
        assert_eq!(title_case("SMITH, JOHN"), "Smith, John");
        assert_eq!(title_case("jane o'brien-mcdonald"), "Jane O'Brien-McDonald");
        assert_eq!(title_case("ZOË NÚÑEZ"), "Zoë Núñez");
        assert_eq!(title_case("MACDONALD"), "Macdonald");
    }
}
