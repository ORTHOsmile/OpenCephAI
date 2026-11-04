//! Patient identity (spec 2026-09-28 Parts 1–2): the name key that matches patients across X-ray vendors, and the checks
//! that decide when "Check patient details" asks the clinician.

use rusqlite::Connection;
use serde::{Deserialize, Serialize};

/// What the film's label gave (ceph-label parses it; the raw text is never stored). Dates are ISO YYYY-MM-DD.
#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityRead {
    pub name: Option<String>, pub date_of_birth: Option<String>, pub scan_date: Option<String>, pub scan_id: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PatientRef { pub name: String, pub date_of_birth: Option<String> }

/// Why "Check patient details" asks (spec Part 1, "When it asks").
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IdentityIssue {
    /// No name could be read from the label, so the name is blank until a person types it.
    NameNotRead,
    NoDateOfBirth,
    /// In the future or before 1900. `field` is "dateOfBirth" or "scanDate".
    ImpossibleDate { field: String },
    BirthAfterScan,
    /// Another patient has this name with a different date of birth, or none recorded.
    SameNameOtherBirth { patient: PatientRef },
    /// Another patient has this date of birth and a name that differs only slightly.
    SimilarNameSameBirth { patient: PatientRef },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentityOutcome { pub checked: bool, pub issues: Vec<IdentityIssue> }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Conflict { pub field: String, pub label: String, pub learned: String }

/// The fill table (spec 2026-09-29 Part 3): the label rules' value is used when the learned one agrees or is absent; a
/// learned value alone fills (and is noted); a disagreement fills nothing and is returned as a conflict to ask about.
/// Field names: "name", "dob", "scan_date", "scan_id".
pub fn merge_reads(label: &IdentityRead, learned: &IdentityRead) -> (IdentityRead, Vec<String>, Vec<Conflict>) {
    let (mut noted, mut conflicts) = (Vec::new(), Vec::new());
    let mut one = |field: &str, l: &Option<String>, d: &Option<String>, same: &dyn Fn(&str, &str) -> bool| -> Option<String> {
        let clean = |v: &Option<String>| v.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        match (clean(l), clean(d)) {
            (Some(a), Some(b)) if same(&a, &b) => Some(a),
            (Some(a), Some(b)) => { conflicts.push(Conflict { field: field.into(), label: a, learned: b }); None }
            (Some(a), None) => Some(a),
            (None, Some(b)) => { noted.push(field.to_string()); Some(b) }
            (None, None) => None,
        }
    };
    let names = |a: &str, b: &str| name_key(a) == name_key(b);
    let exact = |a: &str, b: &str| a == b;
    let out = IdentityRead {
        name: one("name", &label.name, &learned.name, &names),
        date_of_birth: one("dob", &label.date_of_birth, &learned.date_of_birth, &exact),
        scan_date: one("scan_date", &label.scan_date, &learned.scan_date, &exact),
        scan_id: one("scan_id", &label.scan_id, &learned.scan_id, &exact),
    };
    (out, noted, conflicts)
}

/// Latin letters with accents → their base letter, for matching only (the printed name keeps its accents).
fn fold(c: char) -> char {
    match c {
        'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' | 'ā' | 'ă' | 'ą' => 'a', 'ç' | 'ć' | 'č' => 'c', 'ď' | 'đ' => 'd',
        'è' | 'é' | 'ê' | 'ë' | 'ē' | 'ė' | 'ę' | 'ě' => 'e', 'ì' | 'í' | 'î' | 'ï' | 'ī' | 'į' => 'i', 'ł' => 'l',
        'ñ' | 'ń' | 'ň' => 'n', 'ò' | 'ó' | 'ô' | 'õ' | 'ö' | 'ø' | 'ō' | 'ő' => 'o', 'ř' => 'r', 'ś' | 'š' | 'ş' => 's',
        'ť' | 'ţ' => 't', 'ù' | 'ú' | 'û' | 'ü' | 'ū' | 'ů' | 'ű' => 'u', 'ý' | 'ÿ' => 'y', 'ź' | 'ż' | 'ž' => 'z',
        other => other,
    }
}

/// The name, lower case, accents removed, "Surname, Given" turned into "Given Surname", apostrophes and full stops
/// dropped (O'Brien = OBrien), other punctuation read as a space, single spaces.
pub fn name_key(name: &str) -> String {
    let ordered = match name.split_once(',') { Some((surname, given)) => format!("{given} {surname}"), None => name.to_string() };
    let mut out = String::with_capacity(ordered.len());
    for c in ordered.chars().flat_map(char::to_lowercase).map(fold) {
        if c.is_alphanumeric() { out.push(c) } else if matches!(c, '\'' | '’' | '.') {} else { out.push(' ') }
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Levenshtein distance over characters.
pub fn edit_distance(a: &str, b: &str) -> usize {
    let b: Vec<char> = b.chars().collect();
    let mut prev: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.chars().enumerate() {
        let mut cur = vec![i + 1; b.len() + 1];
        for (j, cb) in b.iter().enumerate() { cur[j + 1] = (prev[j] + usize::from(ca != *cb)).min(prev[j + 1] + 1).min(cur[j] + 1); }
        prev = cur;
    }
    prev[b.len()]
}

/// Two different name keys that are probably the same person: at most two edits apart, or the same words in another
/// order (given and surname swapped).
pub fn similar_names(a: &str, b: &str) -> bool {
    if a == b { return false; }
    fn words(s: &str) -> Vec<&str> { let mut w: Vec<&str> = s.split(' ').collect(); w.sort_unstable(); w }
    edit_distance(a, b) <= 2 || words(a) == words(b)
}

/// A real calendar date written YYYY-MM-DD.
pub fn iso_date_ok(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' { return false; }
    let num = |r: std::ops::Range<usize>| s.get(r).filter(|t| t.bytes().all(|c| c.is_ascii_digit())).and_then(|t| t.parse::<u32>().ok());
    let (Some(y), Some(m), Some(d)) = (num(0..4), num(5..7), num(8..10)) else { return false };
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let days = match m { 1 | 3 | 5 | 7 | 8 | 10 | 12 => 31, 4 | 6 | 9 | 11 => 30, 2 if leap => 29, 2 => 28, _ => return false };
    (1..=days).contains(&d)
}

/// The checks behind "Check patient details", for one case as it is now. `nameNotRead` applies while the case is
/// unchecked and its name did not come from the film. Other patients count only if they have a live case.
/// "Today" is the Mac's local date, so a film taken this morning in Australia is not "in the future".
pub(crate) fn issues_in(conn: &Connection, case_id: &str) -> rusqlite::Result<Vec<IdentityIssue>> {
    use IdentityIssue::*;
    let (pid, key, dob, scan, source, checked, name): (String, String, Option<String>, Option<String>, String, bool, String) = conn.query_row(
        "SELECT p.id, p.name_key, p.date_of_birth, c.taken_on, c.identity_source, c.identity_checked, p.display_name
         FROM cases c JOIN patients p ON p.id = c.patient_id WHERE c.id = ?1",
        [case_id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?, r.get::<_, i64>(5)? == 1, r.get(6)?)))?;
    let today: String = conn.query_row("SELECT date('now', 'localtime')", [], |r| r.get(0))?;
    let mut out = Vec::new();
    let unnamed = name.trim().is_empty();
    if unnamed || (source == "manual" && !checked) { out.push(NameNotRead); }
    if dob.is_none() { out.push(NoDateOfBirth); }
    for (field, d) in [("dateOfBirth", &dob), ("scanDate", &scan)] {
        if let Some(d) = d {
            if !iso_date_ok(d) || d.as_str() > today.as_str() || d.as_str() < "1900-01-01" { out.push(ImpossibleDate { field: field.into() }); }
        }
    }
    if let (Some(b), Some(s)) = (&dob, &scan) { if b > s { out.push(BirthAfterScan); } }
    let others: Vec<(String, String, Option<String>)> = conn.prepare(
        "SELECT display_name, name_key, date_of_birth FROM patients
         WHERE id != ?1 AND id IN (SELECT patient_id FROM cases WHERE deleted_at IS NULL) ORDER BY display_name")?
        .query_map([&pid], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?.collect::<Result<_, _>>()?;
    for (name, k, d) in others.into_iter().filter(|_| !unnamed) {
        let patient = PatientRef { name, date_of_birth: d.clone() };
        if k == key && d != dob { out.push(SameNameOtherBirth { patient }); }        // incl. a patient with no date of birth (Week 3)
        else if dob.is_some() && d == dob && similar_names(&key, &k) { out.push(SimilarNameSameBirth { patient }); }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn name_key_ignores_case_spacing_accents_and_surname_first_commas() {
        assert_eq!(name_key("Smith, John"), "john smith");
        assert_eq!(name_key("  JOHN   SMITH "), "john smith");
        assert_eq!(name_key("Zoë O'Brien-Núñez"), "zoe obrien nunez");
        assert_eq!(name_key("Zoe OBrien Nunez"), "zoe obrien nunez");
        assert_eq!(name_key("NGUYEN, Thi Lan"), "thi lan nguyen");
        assert_eq!(name_key("Dr. A. Jones"), "dr a jones");
    }
    #[test] fn similar_names_are_two_edits_apart_or_the_same_words_in_another_order() {
        assert!(similar_names("demo synthetic", "demo synthetik"));
        assert!(similar_names("john smith", "jon smyth"));
        assert!(similar_names("smith john", "john smith"));
        assert!(!similar_names("john smith", "john smith"));                  // identical keys are the same name, not "similar"
        assert!(!similar_names("john smith", "jane smithers"));
        assert_eq!(edit_distance("kitten", "sitting"), 3);
    }
    #[test] fn iso_dates_must_exist() {
        assert!(iso_date_ok("2024-02-29") && iso_date_ok("1990-03-07"));
        assert!(!iso_date_ok("2023-02-29") && !iso_date_ok("1990-13-01") && !iso_date_ok("07/03/1990") && !iso_date_ok("1990-3-7"));
    }
}
