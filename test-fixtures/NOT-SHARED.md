# Date-reading cases NOT in `label-date-cases.json`, and why

`label-date-cases.json` holds cases where the screen's `chosenValue('dob'|'film_date', text, order)` and the label
reader (`crates/ceph-label`) MUST give the same answer. The Rust side checks every case through the production
paths: `layout::field_value` (a learned place) must give exactly the screen's answer, and `parse_label` with a DOB
label in front must give exactly the screen's answer when the text carries no labels of its own (see
`parse.rs`'s `shared_cases_agree_with_the_ui_through_every_production_path`). Rewritten in LABEL-1 fix round 2
(ruling LB-2); the round-1 version of §1 described behaviour the code did not have (review I2).

## 1. Two labelled dates on ONE label line (now in the shared file, and pinned in `parse.rs`)

The screen answers ONE field from ONE chosen text: the earliest reading, or nothing if that reading is impossible
or a cut year. On these three texts the screen gives null for the whole text, and so does `layout::field_value`
(they are in the shared file):

- `DOB 01/13/2010 Date 07/02/2024 SYNTHETIC` (AU) — month 13 is impossible.
- `DOB: 13/01/2010 Scan: 02/07/2024 SYNTHETIC` (US) — month 13 is impossible.
- `DOB 31/04/1990 Exam 12/01/2024 SYNTHETIC` (AU) — April has no 31st.

What `parse_label` does with a whole label line (round 2): it cuts the line into one piece per label (a label up to
the next label; the text before the first label belongs to a label that ended the line above, if any) and asks each
date label's piece the screen's own question. So each label gets the screen's answer for ITS words:

| text | DOB | Film date | why |
|---|---|---|---|
| `DOB 01/13/2010 Date 07/02/2024` (AU) | none | 2024-02-07 | "DOB 01/13/2010" is impossible; "Date 07/02/2024" is its own label (SYNTHETIC) |
| `DOB: 13/01/2010 Scan: 02/07/2024` (US) | none | 2024-02-07 | "Scan" is its own label (SCANLABEL-1, 13 Oct); the DOB's own reading is impossible (SYNTHETIC) |
| `DOB 31/04/1990 Exam 12/01/2024` (AU) | none | 2024-01-12 | as the first row (SYNTHETIC) |

SCANLABEL-1 (owner 13 Oct) added "Scan" to the same label alternation "Exam"/"Study"/"Date" already matched —
this table's middle row changed from `(none, none)` to `(none, 2024-02-07)` in that change (the row above was
wrong before it, per the old comment "Scan is not a label"; see `parse.rs`'s
`scan_exam_and_study_mark_the_film_date`, which also pins the owner's own one-line example — `DOB: 07/03/1990 Scan: 12/01/2024` SYNTHETIC — and `scan_exam_and_study_never_clash_with_their_own_id_labels`, which checks "Scan
ID"/"Study ID"/"Exam no." still give no date).

Before round 2 (`bc5c24f`) the first two rows gave DOB **2010-01-13** (a day/month swap the screen never does, SYNTHETIC
review C4), and a DOB whose own reading was refused handed the NEXT date on the line to the DOB (review C1).
Now: a label's piece gives at most one date; a refused reading gives none; the first date label of a kind decides
its field, so a refused DOB is never filled by a later DOB label or by the "one other date" rule; and a date under
a DOB label is never used as the film date. Pinned in `parse.rs`'s
`two_labelled_dates_on_one_line_are_each_read_from_their_own_text`,
`a_blocked_dob_reading_never_hands_the_next_date_on_the_line_to_the_dob` and
`a_refused_date_label_refuses_its_field_and_dob_dates_are_never_the_film_date`.

## 2. Cases that test the screen's "today" plumbing itself, not a date-reading rule

- M1 (`choose.test.ts`): a completed year landing on the LOCAL date even though it is after UTC today — this tests
  `completedYear` building "today" from `new Date()` in a given timezone. The Rust side takes `today` as an
  argument, so there is no clock read inside the date reader to get wrong.
- M2 (`choose.test.ts`): the same "after today" refusal under `vi.setSystemTime`.

The shared file's `today` is read by the Rust side only; the screen side reads the real clock. So no shared case
may depend on dates between the file's `today` and the real date (none does: the completions in the file land
well inside 1900..today, and the 2-digit years are not near the century turn).

## 3a. A label glued to its date with no space at all (parity minor, 13 Oct, not in the shared file)

`DOB:024-Jan-12` as ONE glued OCR word (no space between the label and the date) gives null on the screen, since
`completedYear`'s own clean-up strips leading PUNCTUATION only, never a leading letter — asked about that exact
word, it never even tries the 3-digit-year completion. The import reader now agrees: it only strips a label
before trying that completion when a JS-whitespace character actually separates the label from the value in the
OCR text (`parse.rs`'s `label_separated_by_space`); with a space (`DOB: 024-Jan-12`), the two are separate OCR
words either way, so the completion still applies, unchanged. Not in the shared file because the shared file's
harness (`shared_cases_agree_with_the_ui_through_every_production_path`) always inserts a label with either a
real space (`format!("DOB: {text}")`) or a separate line (`["DOB:", text]`) — it cannot express the glued,
no-space case at all. Pinned in `parse.rs`'s
`a_glued_label_with_no_space_before_the_date_is_never_completed_through_parse_label`. The `date_field_value`/
`layout::field_value` path (no label-stripping at all) already agreed before this change and still does — pinned
in the shared file as `DOB:024-Jan-12` (single text, no DOB label added in front), `want: null`.

## 3. Cases with no single expected answer on the screen side

Five "never read as 2012-01-24" lines in `filmText.test.ts`/`choose.test.ts` (`'Wed Jan 24 12.30.00 2024'` and
four siblings) assert only that the answer is not 2012-01-24 (null or 2024-01-24 both pass). Both readers do give a
deterministic answer for each; they are not pinned in the shared file because the screen tests deliberately leave
the choice open. The Rust side checks the same "never 2012" bug class in `dates.rs`
(`p3_am_pm_and_a_glued_two_digit_hour_are_times_not_dates`), and the acceptance harness compares both readers on
all five (no disagreement).
