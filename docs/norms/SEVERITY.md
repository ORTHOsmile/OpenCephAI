# Severity stars, the words, and the polygon chart — what they can and cannot tell you

Set by the owner on 16 Oct 2026 (rulings SEVERITY-1, SEVERITY-2, CHART-TAB-1). Code: `packages/analyses/src/norms/severity.ts`,
`apps/desktop/src/chart/`.

## The picture

Lay a ruler under each measurement. Put the population's average (the norm's mean) in the middle, and mark it off in
steps of one standard deviation (SD) each way. The stars say how many whole steps out the patient's value lands:

| How far from the mean | Stars | Word | Colour (unchanged) |
|---|---|---|---|
| less than 0.75 SD | — | within normal range | green |
| 0.75 to 1 SD | — | tendency (e.g. "Class II tendency") | green |
| more than 1 SD, up to 2 | `*` | Mild | amber |
| more than 2 SD, up to 3 | `**` | Moderate | red |
| more than 3 SD | `***` | Severe | red |

Exactly 1, 2 or 3 SD stay in the lower row, as the colours always have. The number used is
z = (patient's value − norm mean) ÷ norm SD, the same z the colours have used since Part D.

The Chart tab draws the same ruler for every row: the grey line runs from −3 SD to +3 SD, the green strip is ±1 SD
with the mean marked, the small grey numbers are the mean and ±2 SD in the measurement's own units, and the black line
joins the patient's values row to row. A value beyond 3 SD sits at the edge with an arrow.

## What is compared with what

The patient's value on this film, against the mean and SD of the norm shown in the same row (the population chosen for
the case, its sex and age row where the paper has one). Change the population and the stars and the chart change with
it; the measured value does not.

## Against the literature

Grading by whole SDs is the convention of the cephalometric tables the owner showed (a Jarabak table with `*`, `**`,
`***` beside each result). The 0.75 SD "tendency" band is the owner's own choice (16 Oct 2026), not a published cut-off.

## What would make it wrong

- **The wrong norm.** A norm from another population, another age, or both sexes pooled moves the middle of the ruler;
  each of those already shows a badge on the row ("other age", "sexes pooled", "SD borrowed", "close"…).
- **A borrowed or assumed SD.** The step size is only as good as the SD: a borrowed SD (from another paper) can make a
  value look one star better or worse than it is.
- **An assumed film scale** (mm rows): until the film is calibrated, mm values are hidden, so they get no stars.
- **A point in the wrong place.** Stars and the chart follow the points; an unconfirmed AI point shows the red AI
  bubble on its row.
- A norm with no usable SD gets no stars, no colour and no green on the chart — not "normal", just not graded.

## Notes

- **Your own norms** (Settings ▸ Norms) with an SD are graded exactly like a published norm: stars, colour and green.
- **Dark mode:** the patient's line is drawn in the text colour — black on the light theme, near-white on the dark
  theme. A printed report will use black.
- **One line per analysis:** the black line joins the rows of one analysis; each analysis has its own line.

## The meaning words (owner MEANING-APPROVE, MEANING-PER-CLINICIAN, CONTEXT-LINE, 16 Oct 2026)

- Each measurement has an approved clinical term for a value above and below the norm's mean
  (`docs/norms/meanings-draft.md`, checked against StatPearls, a literature search, a health AI and a second review; the
  app's data is generated from it and a test keeps the two equal).
- The app adds the severity word: "Mild Class II", "Moderate …", "Severe …", "Class II tendency"; nothing within 0.75 SD.
  It leads the row's detail line, e.g. "Mild Class II · 1.34 SD above the mean · <source>".
- Each clinician can change the words for themselves in Settings › Meanings, saved under their name in the library's
  settings (so they travel with library backups). **Whose words show on a film (ruling NOCLIN-2, 17 Oct 2026, owner
  answer to item 34 — current; replaces NOCLIN-1):** the clinician chosen in the top bar, if any; otherwise the open
  film's Referring practitioner, but only if that person currently has their own words saved in Settings ›
  Meanings (a referrer with none saved right now — never saved any, or has since reset every one — just falls
  through to the next rule); otherwise the Mac's login name, as before.
  Settings › Meanings always changes **your own** words — the clinician chosen in the top bar, or the Mac's login
  name when none is chosen — never the referrer's; if a film is currently showing the referrer's words instead of
  yours, Settings › Meanings says so in one line, so it is clear why what you edit and what the film shows can differ.
- What the words cannot tell you: they describe this film against the chosen norm, not a diagnosis. The report will
  carry the line "Meanings compare this film with the chosen norm; interpret with the clinical examination and the
  patient's age, sex, ethnicity and growth stage." (CONTEXT-LINE; report only, by the owner's choice).

## "My analysis" (owner B1–B4, 17 Oct 2026) — what it can and cannot tell you

**The picture.** Your own analysis is a list you choose from the catalogue's measurements. Nothing is measured
differently: SNA in "NOS clinic" is the same angle at N, between S and A, as SNA in Steiner, to the last digit.

**What is compared with what.** Each row's norm is the one its original analysis would show: your population's
norm; where your population has none, the same "choose one" list as the built-ins, which offers the original
analysis's own norm; with no population chosen, the original analysis's own norm. "Original analysis" is the one you
duplicated; for a measurement you ticked, the first built-in (in the app's order) that has its own norm for it, or,
when no built-in that lists it has one, the first that lists it. Where the original analysis has no own norm for a
measurement (for example Co-A in McNamara), that row has no own norm to fall back on, exactly as in the original
analysis, and Settings › Analyses says so under the measurement ("McNamara lists it but has no norm of its own for
it") rather than naming an own norm that does not exist. A
measurement no built-in analysis lists (for example the nasolabial angle) has population norms only.

**What would make it wrong.** Two analyses can list the same measurement with different own norms. For SNA: Steiner's
own norm is 82° (Steiner CC, "Cephalometrics for you and me", American Journal of Orthodontics 1953;39:729-755,
Fig. 9 "Average" column — an ideal centre, no SD printed), while Eastman's own norm, as reported for a Caucasian
sample, is 81° ± 3° (Alassiry AM, "Cephalometric comparison of Eastman standards among caucasians and saudi
population in the Najran region", Bioinformation 2022;18(12):1173-1176, Table 2). Your analysis shows ONE of
them — the one named under the measurement in Settings › Analyses — so the same SNA may read against a different
own norm in your analysis than in Eastman's. The value never differs.

**What it cannot show.** A measurement later removed from the catalogue stays in your list as "no longer available"
and shows no value.
