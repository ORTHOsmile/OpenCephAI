//! Dates printed on film labels (spec Part 1, "Date parsing"). Pure: "today" is passed in.
//!
//! LABEL-1 (owner 13 Oct, rulings LB-1 and LB-2): the import reader and the screen ALWAYS agree on dates, using the
//! screen's rules, and a wrong date is worse than no date. This file is a line-for-line port of the screen's date
//! reader — `apps/desktop/src/library/filmText.ts` (`allReadings`, `dateTokenIn`, `scrapBefore`, `isCutYear`,
//! `dateIn`) and `choose.ts` (`completedYear`, `dateFieldValue`) — including the JavaScript regex details that
//! decide edge cases: `\d` is ASCII 0-9, `\s` is JavaScript's whitespace set, letters match case-insensitively in
//! ASCII only, `\b` is the ASCII word boundary, and the B1/B2 look-arounds are emulated exactly (`scan`), so a
//! shape that JavaScript skips at one position can still be found one character later, as it is on the screen.
//!
//! Every production path that fills a date goes through the two screen questions below, on the exact text the
//! screen would be asked about:
//! - `date_field_value` = `chosenValue('dob'|'film_date', text)`: the earliest reading, or nothing if it is
//!   impossible or a cut year; the 3-digit-year completion only when nothing reads at all.
//! - `date_in` = `usesOf(text).date`: the same without the trim and without the completion.
//! `read_dates` composes them for a piece of a label line (see `parse.rs`); `layout::field_value` calls
//! `date_field_value` directly. `test-fixtures/label-date-cases.json` is checked against both suites, and through
//! the production paths (`parse.rs`'s `shared_cases_agree_with_the_ui_through_every_production_path`).

use regex::{Captures, Regex};
use std::sync::LazyLock;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub struct Ymd { pub y: i32, pub m: u32, pub d: u32 }

fn days_in(y: i32, m: u32) -> u32 {
    match m { 1 | 3 | 5 | 7 | 8 | 10 | 12 => 31, 4 | 6 | 9 | 11 => 30, 2 if (y % 4 == 0 && y % 100 != 0) || y % 400 == 0 => 29, 2 => 28, _ => 0 }
}

impl Ymd {
    /// A real calendar date, or None.
    pub fn new(y: i32, m: u32, d: u32) -> Option<Self> { (d >= 1 && d <= days_in(y, m)).then_some(Ymd { y, m, d }) }
    pub fn iso(&self) -> String { format!("{:04}-{:02}-{:02}", self.y, self.m, self.d) }
    pub fn parse_iso(s: &str) -> Option<Self> {
        let mut it = s.splitn(3, '-');
        let (y, m, d) = (it.next()?.parse().ok()?, it.next()?.parse().ok()?, it.next()?.parse().ok()?);
        Ymd::new(y, m, d)
    }
}

/// The operator's date-format preference: Au = day first (DD/MM/YYYY), Us = month first (MM/DD/YYYY).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DateOrder { Au, Us }
impl DateOrder {
    /// The `dateFormat` setting: "US" is month first; anything else (default "AU") is day first.
    pub fn from_setting(v: Option<&str>) -> Self { if v == Some("US") { DateOrder::Us } else { DateOrder::Au } }
}

/// A two-digit year is 20yy unless that is after this year, then 19yy ("16" → 2016, "90" → 1990).
fn full_year(y: i32, digits: usize, today: Ymd) -> i32 {
    if digits != 2 { return y; }
    if 2000 + y > today.y { 1900 + y } else { 2000 + y }
}
const MONTHS: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
fn month_of(word: &str) -> u32 { let w = word.to_ascii_lowercase(); MONTHS.iter().position(|m| w.starts_with(m)).map_or(0, |i| i as u32 + 1) }
fn num(s: &str) -> i32 { s.parse().unwrap_or(0) }

/// JavaScript's `\s` (WhiteSpace + LineTerminator), as a regex class body — NOT Rust's Unicode `\s`, which adds
/// U+0085 and drops U+FEFF. Used wherever the screen's patterns say `\s`, and by `is_js_space`/`js_trim`.
const JS_SPACE: &str = r"\t\n\x0B\x0C\r \x{A0}\x{1680}\x{2000}-\x{200A}\x{2028}\x{2029}\x{202F}\x{205F}\x{3000}\x{FEFF}";
pub(crate) fn is_js_space(c: char) -> bool {
    matches!(c, '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
        | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}
/// JavaScript's `String.prototype.trim`.
fn js_trim(s: &str) -> &str { s.trim_matches(is_js_space) }
/// A word matched case-insensitively in ASCII only, as JavaScript's `/i` without `/u` does ("ſ" is not "s").
fn ci(word: &str) -> String {
    word.chars().map(|c| if c.is_ascii_alphabetic() { format!("[{}{}]", c.to_ascii_lowercase(), c.to_ascii_uppercase()) } else { c.to_string() }).collect()
}
/// JavaScript's `\b` (ASCII word characters).
const WB: &str = r"(?-u:\b)";

// P4 (fix round 4, filmText.ts's `MON`): a month name must be a WHOLE word — "jan" is a month, but the first three
// letters of "Marcus", "Janine", "Decubitus" and "Marsden" are not. Each month is spelled out (abbreviation and full
// name) with a word boundary right after, before the optional '.'.
static MON: LazyLock<String> = LazyLock::new(|| {
    let words = ["jan", "january", "feb", "february", "mar", "march", "apr", "april", "may", "jun", "june", "jul", "july", "aug",
        "august", "sep", "sept", "september", "oct", "october", "nov", "november", "dec", "december"];
    format!(r"({}){WB}\.?", words.map(ci).join("|"))
});
static ORD: LazyLock<String> = LazyLock::new(|| format!("(?:{})?", ["st", "nd", "rd", "th"].map(ci).join("|")));

/// One of the screen's five date shapes, anchored at the start of the text it is tried on, with B2 (`(?![A-Za-z0-9])`)
/// as a trailing one-character-or-end group outside the named group `d` (the date itself). Leftmost-first matching
/// picks the same path through the pattern as JavaScript's backtracking does, so `d` is exactly the screen's match.
fn shape(body: &str) -> Regex { Regex::new(&format!(r"^(?P<d>{body})(?:[^A-Za-z0-9]|$)")).unwrap() }
static ISO: LazyLock<Regex> = LazyLock::new(|| shape(r"([0-9]{4})[-/.]([0-9]{1,2})[-/.]([0-9]{1,2})"));
static YEAR_MON: LazyLock<Regex> = LazyLock::new(|| shape(&format!(r"([0-9]{{4}})[{JS_SPACE}./\-]+{}[{JS_SPACE}./\-]+([0-9]{{1,2}})", *MON)));
static NUMERIC: LazyLock<Regex> = LazyLock::new(|| shape(r"([0-9]{1,2})[/.\-]([0-9]{1,2})[/.\-]([0-9]{4}|[0-9]{2})"));
static MON_DAY: LazyLock<Regex> = LazyLock::new(|| shape(&format!(r"{}[{JS_SPACE}]+([0-9]{{1,2}}){},?[{JS_SPACE}]+([0-9]{{4}}|[0-9]{{2}})", *MON, *ORD)));
static DAY_MON: LazyLock<Regex> = LazyLock::new(|| shape(&format!(r"([0-9]{{1,2}}){}[{JS_SPACE}.\-]*{}[{JS_SPACE}.,\-]*([0-9]{{4}}|[0-9]{{2}})", *ORD, *MON)));

/// P2 (fix round 4): a reading directly after one of these labels is not a date reading.
static NOT_A_DATE_LABEL: LazyLock<Regex> = LazyLock::new(|| {
    let words = ["patient id", "accession", "exam no", "scan id", "version", "chart", "pid", "acc", "mrn", "ver", "exp", "kv", "mas", "ma", "no", "id"];
    let alts: Vec<String> = words.iter().map(|w| w.split(' ').map(ci).collect::<Vec<_>>().join(&format!("[{JS_SPACE}]*"))).collect();
    Regex::new(&format!(r"{WB}(?:{})[:#.]?[{JS_SPACE}]*$", alts.join("|"))).unwrap()
});
static AMPM: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"^[{JS_SPACE}.]*[aApP]\.?[mM]\.?{WB}")).unwrap());
static HOURISH: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"^[:;.][0-9]{2}").unwrap());
/// `completedYear`'s `/^(\d{3})([\s./-].*)$/` (JavaScript's `.` stops at a line terminator).
static YEAR3: LazyLock<Regex> = LazyLock::new(|| Regex::new(&format!(r"^([0-9]{{3}})([{JS_SPACE}./\-][^\n\r\x{{2028}}\x{{2029}}]*)$")).unwrap());

/// B1, `(?<![A-Za-z0-9])`: the character before `start` is not an ASCII letter or digit ('_' counts as a scrap).
fn b1(line: &str, start: usize) -> bool { line[..start].chars().next_back().map_or(true, |c| !c.is_ascii_alphanumeric()) }

/// JavaScript's `line.matchAll(/(?<![A-Za-z0-9])…(?![A-Za-z0-9])/g)`: from the end of the last match, the leftmost
/// position where B1 holds and the shape matches; the next search starts where that match (group `d`) ends.
fn scan(re: &Regex, line: &str, mut each: impl FnMut(usize, usize, &Captures)) {
    let mut from = 0;
    'outer: while from <= line.len() {
        for (i, _) in line[from..].char_indices() {
            let p = from + i;
            if !b1(line, p) { continue; }
            if let Some(c) = re.captures(&line[p..]) {
                let end = p + c.name("d").unwrap().end();
                each(p, end, &c);
                from = end;
                continue 'outer;
            }
        }
        break;
    }
}

/// `scrapBefore` (filmText.ts): the character directly before `start` is a punctuation "scrap" glued onto a date's
/// first character — a hint the year's leading digit(s) were sheared off by the film edge — UNLESS it is a ':' right
/// after an ASCII letter (a label separator, "DOB:24-Jan-12"). ASCII letters and digits and JavaScript whitespace are
/// never scraps; anything else is (review I1: an accented letter such as "é" is a scrap on the screen).
fn scrap_before(line: &str, start: usize) -> bool {
    let mut before = line[..start].chars().rev();
    match before.next() {
        None => false,
        Some(c) if c.is_ascii_alphanumeric() || is_js_space(c) => false,
        Some(':') => !matches!(before.next(), Some(c2) if c2.is_ascii_alphabetic()),
        Some(_) => true,
    }
}

/// One candidate reading (filmText.ts's `Reading`): `date` is None for a date shape that is not a real calendar date
/// (day 31 in April, month 13), which the EARLIEST rule must still see and block on (fix round 4, P1).
struct Reading { start: usize, end: usize, date: Option<Ymd>, four_digit_year: bool }

/// P3 (fix round 4): a token followed by AM/PM, or a 2-digit "year" glued to ':' ';' or '.' and two digits, is a time.
fn is_time_not_date(line: &str, end: usize, year_digits: usize) -> bool {
    AMPM.is_match(&line[end..]) || (year_digits == 2 && HOURISH.is_match(&line[end..]))
}
/// P5 (fix round 4): a printed 4-digit year outside 1900..(this year + 1) is not a plausible date.
fn in_plausible_year_range(y: i32, today: Ymd) -> bool { y >= 1900 && y <= today.y + 1 }

/// `allReadings` (filmText.ts): every reading of the five shapes, in the screen's order (ISO, year-month-day,
/// numeric, month-day-year, day-month-year), minus P2, P3 and P5. A numeric date is read STRICTLY in the operator's
/// order (review C4: the screen never swaps day and month to rescue an impossible reading).
fn all_readings(line: &str, order: DateOrder, today: Ymd) -> Vec<Reading> {
    let mut out = Vec::new();
    let mut push = |start: usize, end: usize, date: Option<Ymd>, year_digits: usize, year: i32| {
        if is_time_not_date(line, end, year_digits) { return; }                   // P3
        if NOT_A_DATE_LABEL.is_match(&line[..start]) { return; }                  // P2
        if year_digits == 4 && !in_plausible_year_range(year, today) { return; }   // P5
        out.push(Reading { start, end, date, four_digit_year: year_digits == 4 });
    };
    scan(&ISO, line, |s, e, c| push(s, e, Ymd::new(num(&c[2]), num(&c[3]) as u32, num(&c[4]) as u32), 4, num(&c[2])));
    scan(&YEAR_MON, line, |s, e, c| push(s, e, Ymd::new(num(&c[2]), month_of(&c[3]), num(&c[4]) as u32), 4, num(&c[2])));
    scan(&NUMERIC, line, |s, e, c| {
        let y = full_year(num(&c[4]), c[4].len(), today);
        let (a, b) = (num(&c[2]) as u32, num(&c[3]) as u32);
        push(s, e, if order == DateOrder::Us { Ymd::new(y, a, b) } else { Ymd::new(y, b, a) }, c[4].len(), y)
    });
    scan(&MON_DAY, line, |s, e, c| {
        let y = full_year(num(&c[4]), c[4].len(), today);
        push(s, e, Ymd::new(y, month_of(&c[2]), num(&c[3]) as u32), c[4].len(), y)
    });
    scan(&DAY_MON, line, |s, e, c| {
        let y = full_year(num(&c[4]), c[4].len(), today);
        push(s, e, Ymd::new(y, month_of(&c[3]), num(&c[2]) as u32), c[4].len(), y)
    });
    out
}

/// Whether any date shape reads on `text` at all, possible or not (after P2, P3 and P5).
pub(crate) fn has_reading(text: &str, order: DateOrder, today: Ymd) -> bool { !all_readings(text, order, today).is_empty() }

/// A found reading with its position (filmText.ts's `DateToken`).
struct DateToken { start: usize, end: usize, date: Ymd, four_digit_year: bool }
/// `dateTokenIn`: the EARLIEST reading (the first pushed, on a tie), or None when there is none or it is impossible.
fn date_token_in(line: &str, order: DateOrder, today: Ymd) -> Option<DateToken> {
    let earliest = all_readings(line, order, today).into_iter().min_by_key(|r| r.start)?;
    earliest.date.map(|date| DateToken { start: earliest.start, end: earliest.end, date, four_digit_year: earliest.four_digit_year })
}
/// `isCutYear`: a 2-digit printed year glued onto a cut-year scrap.
fn is_cut_year(line: &str, token: &DateToken) -> bool { !token.four_digit_year && scrap_before(line, token.start) }

/// `dateIn` / `usesOf(line).date`: the earliest reading, or nothing if it is impossible or a cut year.
/// `pub(crate)` normally, `pub` only under the "harness" feature (see `parse::Kind` for why there are two
/// declarations rather than a `pub use` reexport — Rust's privacy rules refuse to widen a `pub(crate)` item that
/// way, E0365).
#[cfg(not(feature = "harness"))]
pub(crate) fn date_in(line: &str, order: DateOrder, today: Ymd) -> Option<Ymd> { date_in_impl(line, order, today) }
#[cfg(feature = "harness")]
pub fn date_in(line: &str, order: DateOrder, today: Ymd) -> Option<Ymd> { date_in_impl(line, order, today) }
fn date_in_impl(line: &str, order: DateOrder, today: Ymd) -> Option<Ymd> {
    date_token_in(line, order, today).filter(|t| !is_cut_year(line, t)).map(|t| t.date)
}

/// `completedYear` (choose.ts): a text starting with a 3-digit year whose first digit was cut off ("987-Jan-02",
/// "024-Jan-12") is completed only when exactly one of "1…" and "2…" reads (by `date_in`) as a real date from
/// 1900-01-01 to today.
fn completed_year(t: &str, order: DateOrder, today: Ymd) -> Option<Ymd> {
    let m = YEAR3.captures(t)?;
    let min = Ymd { y: 1900, m: 1, d: 1 };
    let ok: Vec<Ymd> = ['1', '2'].iter()
        .filter_map(|c| date_in(&format!("{c}{}{}", &m[1], &m[2]), order, today))
        .filter(|d| *d >= min && *d <= today).collect();
    (ok.len() == 1).then(|| ok[0])
}

/// `dateFieldValue` / `chosenValue('dob'|'film_date', text)`: the value of a date field from ONE piece of text —
/// trimmed, trailing commas dropped; the earliest reading unless it is impossible or a cut year; the 3-digit-year
/// completion (leading scraps ignored) only when no date shape reads at all. THE shared date rule: every production
/// path that fills a date field uses it (`layout::field_value` directly, `parse_label` through `read_dates`).
pub fn date_field_value(text: &str, order: DateOrder, today: Ymd) -> Option<Ymd> {
    match field_answer(text, order, today) { FieldAnswer::Read(_, _, d) | FieldAnswer::Completed(_, _, d) => Some(d), FieldAnswer::Nothing => None }
}
/// How `date_field_value` answered, with the date's byte span in the text it was given.
#[derive(Debug, Clone, Copy, PartialEq)]
pub(crate) enum FieldAnswer {
    /// The earliest reading.
    Read(usize, usize, Ymd),
    /// No valid earliest reading (none at all, or an impossible one), and the 3-digit-year completion succeeded.
    Completed(usize, usize, Ymd),
    /// Nothing: a cut year, or no valid reading and no completion.
    Nothing,
}
pub(crate) fn field_answer(text: &str, order: DateOrder, today: Ymd) -> FieldAnswer {
    let lead = text.len() - text.trim_start_matches(is_js_space).len();
    let t = js_trim(text).trim_end_matches(',');
    if let Some(token) = date_token_in(t, order, today) {
        return if is_cut_year(t, &token) { FieldAnswer::Nothing } else { FieldAnswer::Read(lead + token.start, lead + token.end, token.date) };
    }
    let clean = t.trim_start_matches(|c: char| !c.is_ascii_alphanumeric());
    completed_year(clean, order, today).map_or(FieldAnswer::Nothing, |d| FieldAnswer::Completed(lead + t.len() - clean.len(), lead + t.len(), d))
}

/// Which screen question a reading answers: `Field` = `chosenValue('dob'|'film_date', text)`, `Line` =
/// `usesOf(text).date`. With `DateRead::text`, it lets a checker put the very same question to the screen.
/// `pub(crate)` normally, `pub` only under the "harness" feature — see `parse::Kind` for why there are two
/// declarations rather than a `pub use` reexport.
#[cfg(not(feature = "harness"))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Rule { Field, Line }
#[cfg(feature = "harness")]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Rule { Field, Line }
/// One date read from a piece of a label line: `start..end` is where it is printed, `text` is the byte range of the
/// text the screen question (`rule`) was asked of — both relative to the text given to `read_dates`.
#[cfg(not(feature = "harness"))]
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct DateRead { pub date: Ymd, pub start: usize, pub end: usize, pub text: (usize, usize), pub rule: Rule }
#[cfg(feature = "harness")]
#[derive(Debug, Clone, PartialEq)]
pub struct DateRead { pub date: Ymd, pub start: usize, pub end: usize, pub text: (usize, usize), pub rule: Rule }

/// The dates in one piece of a label line, left to right: the first is the screen's answer for the whole piece (by
/// `first`), and each later one is the screen's line answer (`date_in`) for the rest of the piece after the date
/// before it. A blocked reading (impossible, or a cut year) ENDS the piece: nothing after it is read, so a blocked
/// date of birth never hands a later date to anyone (review C1). A completed 3-digit year is the piece's only date.
#[cfg(not(feature = "harness"))]
pub(crate) fn read_dates(text: &str, first: Rule, order: DateOrder, today: Ymd) -> Vec<DateRead> { read_dates_impl(text, first, order, today) }
#[cfg(feature = "harness")]
pub fn read_dates(text: &str, first: Rule, order: DateOrder, today: Ymd) -> Vec<DateRead> { read_dates_impl(text, first, order, today) }
fn read_dates_impl(text: &str, first: Rule, order: DateOrder, today: Ymd) -> Vec<DateRead> {
    let mut out = Vec::new();
    let mut from = match first {
        Rule::Field => match field_answer(text, order, today) {
            FieldAnswer::Read(start, end, date) => { out.push(DateRead { date, start, end, text: (0, text.len()), rule: Rule::Field }); end }
            FieldAnswer::Completed(start, end, date) => { out.push(DateRead { date, start, end, text: (0, text.len()), rule: Rule::Field }); return out; }
            FieldAnswer::Nothing => return out,
        },
        Rule::Line => 0,
    };
    loop {
        let rest = &text[from..];
        let Some(token) = date_token_in(rest, order, today) else { break };
        if is_cut_year(rest, &token) { break; }
        out.push(DateRead { date: token.date, start: from + token.start, end: from + token.end, text: (from, text.len()), rule: Rule::Line });
        from += token.end;
    }
    out
}

/// Whether this line holds a date at all, by the screen's own rule — used only to tell which way round a film
/// reads (`pick.rs`). Deliberately a bare `bool`, never the date or its position: review C3 happened because a
/// previous version of this helper (`find_dates`) returned the dates themselves and a caller used `.first()` to
/// fill a field with them, bypassing the one shared field rule (`date_field_value`/`layout::field_value`). Renamed
/// and narrowed (re-review minor, 13 Oct) so that mistake cannot be repeated: this can only ever answer yes or no.
pub(crate) fn line_has_date(line: &str, order: DateOrder, today: Ymd) -> bool {
    !read_dates(line, Rule::Field, order, today).is_empty()
}

#[cfg(test)]
mod tests {
    use super::*;
    use DateOrder::*;
    fn today() -> Ymd { Ymd { y: 2026, m: 9, d: 28 } }
    // Test-only: every date on the line, left to right, as ISO strings (what `find_dates` gave before it was
    // narrowed to `line_has_date`'s plain bool — review C3, re-review minor 13 Oct). Calls `read_dates` directly,
    // same as `line_has_date` does; this helper exists only so these tests can keep checking an actual sequence
    // of dates, not just whether one is present.
    fn dates(line: &str, o: DateOrder) -> Vec<String> { read_dates(line, Rule::Field, o, today()).into_iter().map(|d| d.date.iso()).collect() }
    fn field(line: &str, o: DateOrder) -> Option<String> { date_field_value(line, o, today()).map(|d| d.iso()) }

    #[test] fn reads_every_written_form() {
        for (line, want) in [("07/03/1990", "1990-03-07"), ("07-03-1990", "1990-03-07"), ("07.03.1990", "1990-03-07"), ("1990-03-07", "1990-03-07"),
                             ("7 Mar 1990", "1990-03-07"), ("07-MAR-1990", "1990-03-07"), ("12 September 2026", "2026-09-12"), ("Sep 12, 2026", "2026-09-12")] {
            assert_eq!(dates(line, Au), [want], "{line}");
        }
        for line in ["1987-Jan-02", "1987 JAN 02", "1987/jan/2", "1987-January-02"] { assert_eq!(dates(line, Au), ["1987-01-02"], "{line}"); }   // SYNTHETIC
        assert_eq!(dates("DOB: 07/03/1990   Date: 12/09/2026", Au), ["1990-03-07", "2026-09-12"]);   // SYNTHETIC
    }
    /// LABEL-1 fix round 2, review C4: day and month follow the preference STRICTLY, as the screen does — an
    /// impossible reading in the operator's order is not rescued by swapping day and month (2bd703e and round 1 did).
    #[test] fn day_and_month_follow_the_preference_strictly() {
        assert_eq!(dates("03/04/1990", Au), ["1990-04-03"]);
        assert_eq!(dates("03/04/1990", Us), ["1990-03-04"]);
        assert!(dates("25/03/1990", Us).is_empty(), "no month 25, and no swap to day-first");
        assert!(dates("03/25/1990", Au).is_empty(), "no month 25, and no swap to month-first");
        assert!(dates("31/02/2020", Au).is_empty() && dates("13/13/2020", Us).is_empty());
        assert_eq!(field("12.30.00", Au), None, "a time is not 2000-12-30");
        assert_eq!(field("024-Jan-12 12.30.00", Au).as_deref(), Some("2024-01-12"));
    }
    #[test] fn two_digit_years_are_this_century_unless_that_is_in_the_future() {
        assert_eq!(dates("07/03/90", Au), ["1990-03-07"]);
        assert_eq!(dates("12/09/26", Au), ["2026-09-12"]);
        assert_eq!(dates("01/01/16", Au), ["2016-01-01"]);
        assert_eq!(dates("7 Mar 27", Au), ["1927-03-07"]);
    }
    #[test] fn numbers_that_are_not_dates_are_ignored() {
        assert!(dates("68 kV 10 mA 1.5 s ID 4471", Au).is_empty());
        assert!(dates("0991/30/70 :BOD", Au).is_empty(), "a label read back to front has no date");
    }
    #[test] fn iso_round_trips_and_rejects_impossible_days() {
        assert_eq!(Ymd::parse_iso("2024-02-29").unwrap().iso(), "2024-02-29");
        assert!(Ymd::parse_iso("2023-02-29").is_none() && Ymd::new(2026, 4, 31).is_none());
    }
    #[test] fn the_setting_picks_the_order() {
        assert_eq!(DateOrder::from_setting(Some("US")), Us);
        assert_eq!(DateOrder::from_setting(Some("AU")), Au);
        assert_eq!(DateOrder::from_setting(None), Au);
    }

    // LABEL-1 (owner 13 Oct, ruling LB-1): find_dates must share the screen's cut-year
    // and 3-digit-year-completion rule (apps/desktop/src/library/choose.ts's `completedYear`/`dateFieldValue`,
    // apps/desktop/src/library/filmText.ts's `scrapBefore`/`isCutYear`).
    #[test] fn a_3_digit_year_with_its_first_digit_cut_is_completed_same_as_the_ui() {
        // SYNTHETIC: "024-Jan-12" with the leading '2' sheared off by the film edge — "1024" is before 1900, so
        // only "2024" survives; the UI's `completedYear` reads the identical shape to `2024-01-12`.
        assert_eq!(dates("024-Jan-12", Au), ["2024-01-12"]);
        assert_eq!(dates("987-Jan-02", Au), ["1987-01-02"]);   // SYNTHETIC: "1987" survives, "2987" is after today
    }
    #[test] fn a_leading_scrap_separated_by_a_space_is_stripped_before_completing() {
        assert_eq!(dates(") 024-Jan-12", Au), ["2024-01-12"]);   // SYNTHETIC
    }
    #[test] fn a_scrap_glued_directly_to_the_first_digit_gives_no_date_not_a_wrong_day() {
        // SYNTHETIC: ")24-Jan-12" must NOT read as 2012-01-24 (the year was cut, not "24-Jan-12").
        assert!(dates(")24-Jan-12", Au).is_empty());
    }
    #[test] fn a_plain_two_digit_year_with_no_leading_scrap_still_reads_as_a_genuine_date() {
        assert_eq!(dates("24-Jan-12", Au), ["2012-01-24"]);   // SYNTHETIC: must stay — nothing glued in front
    }
    #[test] fn a_letter_glued_to_the_date_is_not_a_scrap() {
        assert_eq!(dates("DOB:24-Jan-12", Au), ["2012-01-24"]);   // SYNTHETIC: a label, not a cut
    }
    #[test] fn both_completions_out_of_range_refuse_with_zero_valid_completions() {
        assert!(dates("500-Jan-01", Au).is_empty());   // 1500 before 1900, 2500 after today: neither valid
    }
    #[test] fn empty_and_whitespace_lines_stay_empty() {
        assert!(dates("", Au).is_empty());
        assert!(dates("   ", Au).is_empty());
    }

    // LABEL-1 fix round 1 (owner 13 Oct, ruling LB-1): full parity with the UI's later fix rounds
    // — earliest reading wins, time-vs-date, label/plausibility patches, whole-word months.
    #[test] fn earliest_reading_wins_over_a_later_unrelated_time_or_date() {
        // `find_dates` (used only to tell whether a line holds a date, pick.rs) is the screen's answer for the line
        // and then for the rest of the line after each date. LABEL-1 fix round 2 (review C1/C3): a blocked earliest
        // reading (here the cut year ")24-Jan-12") ends the line's dates, as on the screen — nothing after it is read.
        assert!(dates(")24-Jan-12 10.02.24", Au).is_empty());   // SYNTHETIC
        assert_eq!(field(")24-Jan-12 10.02.24", Au), None);
        // After a GOOD date, the rest of the line is read again ("10.02.24" alone reads as 2024-02-10 on the screen);
        // a field's value (`date_field_value`) is only the earliest.
        assert_eq!(dates("12-Jan-2024 10.02.24", Au), ["2024-01-12", "2024-02-10"]);   // SYNTHETIC
        assert_eq!(field("12-Jan-2024 10.02.24", Au), Some("2024-01-12".to_string()));
        // "Acc 12-03-45" IS filtered by P2 (a not-a-date label), so only the one real date survives here.
        assert_eq!(dates("12 Jan 2024 Acc 12-03-45", Au), ["2024-01-12"]);   // SYNTHETIC
    }
    #[test] fn p2_a_reading_after_a_not_a_date_label_is_skipped() {
        assert_eq!(dates("ID 99-99-99 12/01/2024", Au), ["2024-01-12"]);
        assert_eq!(dates("PID 12-03-45 2024-01-12", Au), ["2024-01-12"]);              // SYNTHETIC
        assert_eq!(dates("Acc 1-2-34 2024-01-12", Au), ["2024-01-12"]);                // SYNTHETIC
        assert_eq!(dates("Ver 3.10.24 Se: 12/01/2024", Au), ["2024-01-12"]);
        assert_eq!(dates("Exp 1.2.24 0.8 s 12/01/2024", Au), ["2024-01-12"]);
        assert_eq!(dates("PID 12-03-45 02/07/2024", Us), ["2024-02-07"]);              // SYNTHETIC
    }
    #[test] fn p3_am_pm_and_a_glued_two_digit_hour_are_times_not_dates() {
        assert_eq!(dates("10.02.24 PM 2024-01-12", Au), ["2024-01-12"]);
        for line in ["Wed Jan 24 12.30.00 2024", "Wed Jan 24 12;30;00 2024", "Mon, 24 Jan 12.30 2024",
            "24 Jan 12.30 2024", "Jan 24 12.30 PM 2024"] {
            assert!(!dates(line, Au).contains(&"2012-01-24".to_string()), "{line}");   // never the old bug
        }
    }
    #[test] fn p4_a_month_name_must_be_a_whole_word() {
        for line in ["Marcus 12 34", "DEMO, Janine 12 05", "Decubitus 12 34", "Room 1 Marsden 12"] {
            assert!(dates(line, Au).is_empty(), "{line}");
        }
    }
    #[test] fn p5_a_printed_year_outside_the_plausible_range_is_skipped() {
        assert_eq!(dates("1430 Feb 07, 2024", Au), ["2024-02-07"]);
        assert_eq!(dates("PID 5566 Dec 3 2024", Au), ["2024-12-03"]);
    }
    #[test] fn ordinal_day_suffixes_are_accepted() {
        assert_eq!(dates("12th Jan 2024", Au), ["2024-01-12"]);   // SYNTHETIC
        assert_eq!(dates("Jan 1st, 2024", Au), ["2024-01-01"]);   // SYNTHETIC
    }

    /// Positive control for the shared-case battery below: the file is not empty and it does have cases this
    /// engine can fail on ("every instrument gets a positive control") — proven by the ordinary
    /// RED/GREEN runs above, and re-asserted here directly against the file's own content.
    #[test] fn shared_case_file_is_non_trivial() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../../test-fixtures/label-date-cases.json")).unwrap();
        let cases = v["cases"].as_array().unwrap();
        assert!(cases.len() > 40, "expected a substantial shared case file, got {}", cases.len());
        assert!(cases.iter().any(|c| c["want"].is_string()), "expected at least one non-null case (a positive control)");
        assert!(cases.iter().any(|c| c["want"].is_null()), "expected at least one null case too");
    }
    /// LABEL-1 fix round 1: every case in `test-fixtures/label-date-cases.json` must read the same through
    /// `date_field_value` here as through `chosenValue` in the TS suite (round 2: and through the production paths,
    /// `parse.rs`'s `shared_cases_agree_with_the_ui_through_every_production_path`) (owner's ruling LB-1 — see
    /// `apps/desktop/src/library/choose.test.ts`'s `shared cut-year/date cases (LB-1)` describe block for the
    /// TS side of this same file).
    #[test] fn shared_cases_agree_with_the_ui() {
        let v: serde_json::Value = serde_json::from_str(include_str!("../../../test-fixtures/label-date-cases.json")).unwrap();
        let today = Ymd::parse_iso(v["today"].as_str().unwrap()).unwrap();
        for case in v["cases"].as_array().unwrap() {
            let text = case["text"].as_str().unwrap();
            let order = if case["order"].as_str().unwrap() == "US" { Us } else { Au };
            let want = case["want"].as_str().map(|s| s.to_string());
            let got = date_field_value(text, order, today).map(|d| d.iso());
            assert_eq!(got, want, "text={text:?} order={:?}", case["order"]);
        }
    }
}

