//! Proves the "harness" feature's surface (re-review minor, 13 Oct): an external harness, built as a standalone
//! binary with a path dependency on this crate, needs `labels`, `Kind`, `line_dates`, `PieceDate`, `Rule`,
//! `DateRead`, `read_dates` and `date_in` to drive the production date-reading paths directly — the same pieces
//! the in-crate test modules use. Those are `pub(crate)` by default now (review C3: a plain `pub` is how a caller
//! once reached for the lower-level `find_dates` instead of the one shared field rule); this integration test is
//! an EXTERNAL crate from `ceph-label`'s own point of view, so it can only see what the "harness" feature exposes.
//! `cargo test -p ceph-label --features harness --test harness_api`.
#![cfg(feature = "harness")]
use ceph_label::{date_in, labels, line_dates, read_dates, DateOrder, DateRead, Kind, PieceDate, Rule, Ymd};

fn today() -> Ymd { Ymd { y: 2026, m: 10, d: 13 } }

#[test]
fn the_harness_feature_reaches_labels_and_line_dates() {
    let line = "DOB: 07/03/1990 Scan: 12/01/2024 SYNTHETIC";
    let found = labels(line);
    assert_eq!(found.len(), 2, "{found:?}");
    assert_eq!(found[0].0, Kind::Dob);
    assert_eq!(found[1].0, Kind::Scan);
    let dates = line_dates(line, &found, None, DateOrder::Au, today());
    let pieces: Vec<(Option<Kind>, Option<String>)> =
        dates.iter().map(|p: &PieceDate| (p.owner, p.read.as_ref().map(|r| r.date.iso()))).collect();
    assert_eq!(pieces, [(Some(Kind::Dob), Some("1990-03-07".into())), (Some(Kind::Scan), Some("2024-01-12".into()))]);   // SYNTHETIC
}

#[test]
fn the_harness_feature_reaches_read_dates_and_date_in() {
    // SYNTHETIC
    let reads: Vec<DateRead> = read_dates("07/03/1990 12/01/2024 SYNTHETIC", Rule::Field, DateOrder::Au, today());
    assert_eq!(reads.first().map(|r| r.date.iso()), Some("1990-03-07".into()));
    assert_eq!(date_in("12/01/2024", DateOrder::Au, today()).map(|d| d.iso()), Some("2024-01-12".into()));
}
