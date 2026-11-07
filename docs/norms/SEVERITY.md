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
  each of those shows a tag on the row ("other age", "sexes pooled", "close"…); an author's ideal value and a borrowed
  SD are not tagged on the row (owner C1, 19 Oct 2026), nor is a paper that did not state its X-ray enlargement
  ("assumed scale", owner 19 Oct 2026, J) — hovering the source line explains them, and the source line and the
  report say them.
- **A borrowed or assumed SD.** The step size is only as good as the SD: a borrowed SD (from another paper) can make a
  value look one star better or worse than it is.
- **An assumed film scale** (mm rows): until the film is calibrated, mm values are hidden, so they get no stars.
- **A point in the wrong place.** Stars and the chart follow the points; an unconfirmed AI point shows the red AI
  bubble on its row.
- A norm with no usable SD gets no stars, no colour and no green on the chart — not "normal", just not graded.

## The note at 4 SD (Stage A task 9; owner-approved, spec 2026-11-02 §14.4)

**The picture.** On the same ruler, once the patient's value lands **4 steps (4 SD) or more** from the mean, on either side, the row
carries the small note "Extreme value for the norm" under the Result and its stars (exactly 4.0 counts). The stars, colour and words
are unchanged: past 3 SD they were already `***`, red, "Severe". **Compared with what:** this film's value against the mean and SD of the
norm shown in that row, the same z as the stars. It is only a note on the measurement: it never moves, flags or doubts a point (the point
check, spec §14.3, is separate) and says nothing about whether the tracing is wrong.

**Against the literature.** 4 SD is the owner's choice (spec §14.4, approved 2 Nov 2026: "rare enough to deserve a second look"), not a published
cut-off, in the same way as the 0.75 SD "tendency" band. The literature point is the reverse one: a norm describes the average patient and your
patients are referred because they are not, so a norms check set low flags genuine Class II and III faces. FT-2 measured it: at 2 SD, norms
would have flagged all 20 of the most extreme-ANB films. For scale, on this app's default ANB norm (2.0 ± 1.2°), an ANB of −3° is already 4.2 SD out and would carry the note; the note
means "far from this norm", not "wrong".

**Rarity, and why not to trust it.** On a normal curve about 1 in 16,000 values lies 4 SD or more out. Do not read the note that way: norm SDs
come from small, often borrowed samples, and referred patients are not the norm's population, so the note will be far more common than 1 in 16,000.

**What would make it wrong or silent.** A borrowed or mismatched norm moves the middle of the ruler and so decides which rows reach 4 SD. A norm with
no SD, no norm chosen, a value hidden for want of a ruler (mm rows), or a missing point gives no z and so **no note, which does not mean the value is
ordinary**. It asks for a look, not a correction.

**Where it shows.** On the screen's Measurements tab only. It is **not** drawn on the Chart tab, and it is **not** in the report preview, the PDF or the
CSV (a PDF row at 4.2 SD reads the same as one at 3.1 SD; the CSV's z column lets you tell). The owner ruled screen only, 3 Nov 2026.

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
norm; where your population has none, Auto, as for the built-ins — the original analysis's own norm, else the
Caucasian sample ranked best for that measurement, else the best study of any other population (the row's norm
list still lets you choose another); with no population chosen, the original analysis's own norm. "Original analysis" is the one you
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

## Auto's best-study ranking (owner I-1/I-2, 24 Oct 2026, keep-as-built) — what it can and cannot tell you

**The picture.** Auto looks across every published sample that has this measurement and picks the one row to compare
the patient against — a paper's table row, not a whole paper. Think of it thumbing through every norm table on file
for, say, "angle of convexity", and laying a ruler against the one row that best matches this patient's age and sex,
out of everyone who measured it.

**What is compared with what.**

- **A pooled (boys-and-girls) row can win over a sex-specific row of the same age, by having more people in it.** For
  a 12-year-old boy's angle of convexity, Auto compares him with Zheng 2026's 10–17 y row of **boys and girls together**
  (n 60) rather than Thilander 2005's 12–13 y row of **boys only** (n 53), because 60 people beats 53, even though the
  Thilander row is boys alone and the Zheng row is roughly half girls. The boy's number is being set against a mixed
  group, not a same-sex one, whenever the mixed row happens to hold more people. **Owner's choice, 24 Oct 2026: keep
  this (I-1).** No ruling changed it; nothing in Auto prefers a same-sex row over a larger pooled one.
- **The winning row can have no SD, so it shows a mean but no star, no colour and no grade — even when another
  candidate could have graded it.** For an adult's overbite, Auto can land on Bailey & Taylor 1998 (a both-sexes
  8–12 y row with **no SD and no n printed**) ahead of a candidate that does carry an SD, because nothing in the
  ranking looks at whether the row can be graded. The probe (70,200 queries on the real norm sets) found this in **49** of them. The
  row still prints its own mean — "the published average is X" — but carries no z, no stars, and no colour, exactly
  as a norm with no usable SD always has (see "What would make it wrong" above). **Owner's choice, 24 Oct 2026: keep
  this (I-2).** No ruling changed it; Auto does not prefer a gradeable candidate over an ungraded one that otherwise
  ranks higher (a row for the right sex and age, with more people, from the newer paper).

**Against the literature.** Both behaviours follow directly from the ranking the owner set for Auto (N-A1/N-A4,
AUTO-Q1/Q2/Q6, 19 Oct 2026): sex-and-age coverage, then the row's own n, then the newer paper — in that order, with
no separate check for "own sex" ahead of "pooled", or for "has an SD" ahead of "has none". Neither behaviour is a
bug; both are the ranking working as the owner specified, on cases the nine hand-worked examples did not cover.

**What would make it wrong to read past this.** Treat an Auto row the same as any other norm row, with one addition:
check whether its badges say "sexes pooled" — a pooled row compared against one sex can be the paper's own
intentional design (many papers only publish pooled numbers) or, under Auto, the accidental winner of a size contest
between a pooled sample and a same-sex one. And check whether the row has no stars at all: under Auto that can mean
"this is the best-matching study, and it simply did not print an SD" — not "this patient is normal" and not "no
study exists". A clinician relying on the drop-down count ("choose one" offered N sources) rather than the row's own
badges will not see either of these.

## Auto norms (owner N-A1 to N-A5 and AUTO-Q1, Q2, Q6, 19 Oct 2026) — what they can and cannot tell you

Auto norms: when a patient's population has no norm, the row is compared with the analysis's ideal value or a
Caucasian sample (the largest for that measurement). Such a comparison mixes a difference of background with a
difference of form; it cannot by itself show a skeletal discrepancy. (Owner, 19 Oct: when neither exists, the best
study of any other population is used, marked the same way.)

**The picture.** Every row lays the patient's value on a ruler marked out from a group of people. Normally the group is
the patient's own population (the case's, or the clinic default). Sometimes no paper on that population measured the
quantity: no Japanese paper on file reports SNA, and no Chinese paper reports McNamara's upper pharynx. Auto then lays
down a ruler made from someone else: first the analysis author's own value (Steiner's SNA of 82° — a target he set, not
the average of people he measured); when the analysis has none, a Caucasian sample (North Americans of European
background); and when no Caucasian paper has it either, the best study of any other population on file (for Steiner's
Pog to NB in a Saudi adult: Zheng 2026's Beijing adults, n = 60). The row is graded as usual. Its source line carries
the words "Auto (no … norm)"; a ◆ beside "Auto" in the row's norm list (Task 6) marks it there too. The PDF and preview
report (Task 10) carry a ◆ on every such row's norm cell (drawn in the PDF — the embedded Noto Sans has no ◆ glyph) and
a footnote under the tables naming every row Auto filled, by population and by which step filled it; the CSV's
`norm_auto` column (owner ruling Q-A) says the same, machine-readably, per row. **The chart under each table does
not** (review M-5, fix round 1, 25 Oct 2026): it plots an Auto row like any other, with no mark on the bar itself —
the ◆ is on the table row directly above it, and in the footnote; the screen's own Chart tab is unmarked the same way.

**What is compared with what.** The patient's value on this film against (1) the analysis's own norm — Steiner
1953's SNA 82°, whose SD is borrowed from a measured sample named in the source line; or (2) the Caucasian set with the
most people in the row the patient is compared with, among sets with a row for the patient's sex and age (the nearest
age when none has); or (3) the same choice among every other population's papers — never an analysis's own norm or
a teaching sheet filed under a population (owner Q-T5-1, 24 Oct 2026: the NUS/NDC sheet has no described sample, so
it is not "a study"; it stays NUS's own norm and a manual choice; this changed no row on the current catalogue). The Caucasian sets: McNamara 1984's Ann Arbor adults (73 women, 38 men, 18–40 y), the Burlington children (17 to 58 per
sex and age, 6–20 y), the Bolton children (16 per sex and age, 6–18 y), or Gu 2011's Michigan adults (60 women, 30 men).
Ties go to the newer paper, then to the population order and each population's usual order. Example: a Chinese man of 30 — no Chinese paper on file
measured the upper pharynx and McNamara's own norms have none, so the row compares him with McNamara 1984's Ann Arbor
men: 17.4 ± 4.3 mm as printed, 16.1 ± 4.0 mm at true size, n = 38.

**Against the literature.** Gu et al. 2011 (Eur J Orthod 33:205–211) measured Chinese (n = 65) and Caucasian (n = 90)
young adults the same way, in one paper. The mandibular plane (FH to Go–Me) of the Chinese women averaged 30.4 ± 5.9°;
of the Caucasian women 23.5 ± 4.8° — 6.9° apart, 1.4 Caucasian SDs. A Chinese woman exactly at her own population's
average would read "Mild" (one star) against the Caucasian norm, with nothing wrong. For SNB the same paper found 79.7°
against 79.9°: nothing to see. How far Auto can mislead depends on the measurement.

**What would make it wrong.** (1) Real differences between populations — the reason this entry exists. (2) An author's
ideal is a target, not an average, and its SD is borrowed. (3) The ranking prefers the row that covers the patient's age
and then the larger sample, not the closer population or the closer method: a child can be compared with Burlington's
Canadian children (girls of 12: n = 56) rather than Bolton's (n = 16), while a case set to Caucasian uses Bolton
(class-I balanced samples first); and an adult's upper lip strain is compared with Lew 1992's 48 Singapore Chinese
adults (measured a little differently, quoted second-hand) rather than Alcalde 2000's 211 Japanese, whose rows stop at
28 years. (4) Some rows are small (Burlington men at 18 y: 17) and the children were filmed decades ago.

**No population at all (owner decision 6, 29 Oct 2026, superseding the 19 Oct edge case).** A case on the old "Clinic
default" with no clinic default set has no population: each row uses the analysis's own norm, then your own norms —
and now, where neither has one, Auto too (the best Caucasian sample, else the best study of any other population),
marked ◆ and "Auto (no Steiner's own norm)" as above. Before 29 Oct such rows read "No norm". Steiner's Pog to NB is the
example the owner saw blank: Steiner 1953 has no Pog–NB norm, so a man of 30 is now compared with Zheng 2026's Beijing
adults, 1.7 ± 1.1 mm (n = 60). Across the SYNTHETIC before/after (54 films with no population), only the 432 rows that
read "No norm" gained a norm — Pog to NB, Co–A, upper pharynx, LAFH %, upper lip strain, inferior sulcus to H-line,
U1–NA° and L1–NB° — and every other row's own numbers stayed identical
(`docs/norms/evidence/2026-10-29-norms-auto-population-before-after.md`). Those 432 rows now carry a grade (286 gained
stars): for example Eastman's LAFH % on the SYNTHETIC test film (a girl of 13) compared with Thilander 2005 reads Severe (***), where it
read nothing before.

**What it cannot show.** Whether the patient's population really differs from the norm's on this measurement. Nothing
in the app judges whether Caucasian (or the author's ideal) is a fair stand-in. The clinician can choose a closer
population on the row (its norm list), and a choice saved before Auto existed still wins. The Compare-populations
window never uses Auto: each column is that population's own norm or "—" (ruling AUTO-Q7).

**How often.** For a man of 30, across the 15 analyses' 130 rows and the 11 population choices (1,430 rows), 882 read
"choose one" before Auto. With Auto, 816 use the analysis's own norm, 19 a Caucasian sample, and 47 the best study of
another population: Steiner's Pog to NB and ABO's U1–NA° and L1–NB° → Zheng 2026 (Chinese, n = 60); Eastman's LAFH % →
Norman 2020 (Malay men, n = 50); Holdaway's upper lip strain and inferior sulcus → Lew 1992 (Chinese, Singapore, n = 48).
None is left asking; "choose one" remains only for a measurement that only your own norms hold. Since 7 Nov 2026 (owner
rulings: Indian patients use the Caucasian norms; Malay patients the Malay studies, then the Chinese) there are 12 population choices
and the NUS BaSN row (1,572 rows): 855 use the analysis's own norm, 18 a Caucasian sample, 51 another population's best
study. Indian reads exactly as Caucasian; Malay uses its own studies, then the Chinese ones where those have no row;
every other population's rows are unchanged. `auto.test.ts` keeps these numbers true. The whole before/after (six SYNTHETIC skulls, every population, sex, age and pick state; 70,200
queries): only former "choose one" rows changed (35,718 of them), every other row bit-identical
(`docs/norms/evidence/2026-10-19-norms-auto-before-after.md`).

## Auto population (owner, 29 Oct 2026) — what it can and cannot tell you

**The picture.** Every row lays the patient's value on a ruler made from a group of people. Auto chooses that group
for the whole case: the people of the patient's recorded background (a Chinese patient against Chinese samples); if no
background is recorded, the clinic's chosen default (for example Caucasian); if there is no default either, **for an
adult (18 and over, or no age entered) the combined adult norm** (next section, owner R1/R5, 3 Nov 2026), and **for a
child** the biggest study on file that measured children of the patient's sex and age — today Thilander 2005's Swedish
sample, followed from 5 to 31 years. Rows that group never measured are filled from another group and marked ◆, as
before.

**What is compared with what.** The patient's value on this film, against the mean and SD of the group Auto chose, in
the row for the patient's sex and age. The report says which group and why, for a child: "We used the norms for the female
Swedish population for children aged 12 years (chosen automatically: no background or clinic default recorded, so the
largest study with norms for this sex and age)." A recorded background reads "(chosen automatically from the
patient's demographics)" (owner R6, 3 Nov 2026), so the report never gives the background away. When the clinician chooses the population by hand, nothing about the grading changes
from before — proved through the export path on 51,480 SYNTHETIC rows, 0 changed
(`docs/norms/evidence/2026-10-29-norms-auto-population-before-after.md`).

How Auto ranks "the largest study" for a child (owner NAP-Q1 (a)): among samples of people (never an analysis's own norm, a
teaching sheet, a website value or a sample marked as consecutive patients taken whatever their bite), the studies with a row for the patient's
sex and age; the largest count for the patient's sex (sex not recorded: the whole study); ties to the newer paper. When
no study has a row for the age, the study whose row reaches nearest. On the sets on file today: Thilander 2005 for
girls and boys of 8, a boy of 12 and a patient of unknown sex at 15. Thilander 2005 holds 22 measurements; the rest are
filled per row, ◆. (Until 3 Nov 2026 the same ranking chose adults' group too; for ages 33–40 it picked Fu 1975 or
Miao 1995, second-hand compilations — final review C1. Adults now get the combined adult norm.)

**Against the literature.** Differences between populations are real and sometimes large: Gu et al. 2011 measured
Chinese and Caucasian young adults the same way and found the women's mandibular plane 30.4 ± 5.9° against
23.5 ± 4.8°, 6.9° apart (1.4 Caucasian SDs); a Chinese woman at her own population's average reads one star against
the Caucasian norm. For SNB the same paper found 79.7° against 79.9°: nothing. The best-evidence step uses Thilander
2005 (Eur J Orthod 27:370–389; 205 men, 264 women): large and longitudinal, but Swedish, and with small rows at the
oldest ages (11 men in the 29–32 y row).

**What would make it wrong.**
1. **The recorded background is not who the paper sampled.** "Chinese" here means samples from Beijing, Hong Kong and
   elsewhere; a patient of mixed or different background is still laid against them. The source line names the
   sample's place; read it.
2. **The clinic default is a convention.** An unrecorded patient is graded against the clinic's usual population,
   whatever their real background. The report says so; record the background to avoid it.
3. **The best-evidence step is not about the patient at all.** For a child it picks the biggest study for the sex
   and age — today, Swedish. For an adult the combined adult norm is mostly East and South-East Asian people (next
   section). Either way a patient can read "retrusive" or "Class II" because of a population difference, not a
   malocclusion. Record the background or set a clinic default.
4. **Sex not recorded widens and moves the ruler.** The averaged norm is centred halfway between men and women and is
   wider than either (Gu 2011 SNB: 80.95 ± 3.28° against men's 82.0 ± 2.9° and women's 79.9 ± 3.3°). A man with SNB
   76° reads Mild instead of Moderate; a woman with the same value reads further out (z −1.51 instead of −1.18). Record
   the sex for the exact norm.
5. **Turning 18 changes the group.** With nothing recorded, a patient filmed at 17 is graded against the largest
   study for the age (Thilander 2005); filmed at 18, against the combined adult norm. Two films of one patient either
   side of 18 can read differently for that reason alone.

**What it cannot show.** Whether the patient really resembles the group used. Nothing in the app judges that.

**Older cases and reports already printed (owner NAP-Q3 (b), 29 Oct 2026).** Cases that were on "Clinic default" were
switched to Auto when the library was upgraded (format 18); the library keeps a record of each one and when. **A PDF
already saved is a file on disk and is never changed.** **Printing or exporting a switched case again uses Auto**, so
its stars and words can differ from the copy in the patient's file: with a clinic default set they match (only the
sentence adds "chosen automatically: clinic default") until a background is recorded; with none, the case is now
graded by Auto (adults: the combined adult norm; children: the largest study for the sex and age) instead of each
analysis's own values. To go back for one case, open it and choose "Clinic default (as before the upgrade)" in
Reference population.
How much this moves, on the SYNTHETIC before/after (54 films that were on "Clinic default"; 7,020 rows): with a clinic
default set, 0 numbers changed — only the sentence; with none (re-measured 3 Nov 2026 with the combined adult norm),
4,812 rows changed a number on every film, and **2,015 of 7,020 rows changed their stars — about 2 rows in 7**
(adult and age-unknown films 1,639 of 4,680; child films 376 of 2,340; re-measured after the final-review fixes).
Example: SNA for a woman of 30, Steiner 1953 82.0 ± 4.0° → the combined adult norm for women (8 studies, 290 people). **No route reproduces an old report
exactly:** "Clinic default (as before the upgrade)" uses each analysis's own norms again, but rows those norms never
covered now show another study's norm, marked ◆. Keep the saved PDF.

## Indian and Malay patients, and the NUS analysis's two column sets (owner rulings and answers, 7 Nov 2026) — what they can and cannot tell you

**The picture.** The population rule lends a patient another group's ruler where their own group has none. An
**Indian** patient is laid against the **Caucasian** ruler for every row: the app holds no Indian study. A **Malay**
patient is laid against the **Malay** studies (Norman 2020, Mohammad 2011, Cheong 2024) wherever they measured the row,
and against the **Chinese** ruler only where no Malay study did. The owner's reason: research reports no significant norm
difference between these pairs. The rule applies in every analysis and wherever the app chooses a group: the case's
population, the clinic default, Auto's recorded background, the Compare window, the SD a row borrows, and the ◆
fall-backs. It is held in one place (`reference/norms/populations.json`: Indian `normsOf` Caucasian, Malay `fallsBackTo`
Chinese).

The **NUS analysis** has two columns on its sheet. **Set 1** (the existing NUS sheet values, unchanged) is used for
Chinese and Malay patients, and for anyone else; **set 2** for Caucasian and Indian patients. Set 2 is one reading of the
sheet plus the owner's confirmation, so it shows as unverified. Set 2 has six values the sheet left out: **U1 to SN
102 ± 2°**, the ABO norm already in the app (it agrees with set 2's own rows: U1 to MxPA 108° − SN to MxP 8° = 100°,
within one SD); **L1 to APo 2.42 ± 1.68 mm**, pooled from the adult Caucasian studies on file (Gu 2011 and McNamara 1984
Ann Arbor, N = 201; McNamara's Bolton children are left out because they are the same 32 children at six ages); and the
SDs of **Wits 3.9, LAFH % 2.1, overjet 1.7, overbite 1.8**, taken from set 1 ("SD borrowed from NUS Chinese"). The
lip-to-E-line SDs are borrowed by the usual rule (Gu 2011, Caucasian). **BaSN** (the cranial base angle at S between Ba and
N, #93, new, last in the NUS list) has no norm in either set: no study on file holds it.

**What is compared with what.** The patient's value against the mean and SD of the group the row names. Where the rule
supplied the row, the source line, and the report sentence once, say only "Norms: Caucasian (population rule)" or
"Norms: Chinese (population rule)" (owner answer C): the words never name the patient's recorded background. A NUS set 2
row reads "Data on file (NUS norms, undated), …, set 2". Remember the usual order: a case set to Caucasian (or Indian) is
first measured against the Caucasian studies; the NUS own norm is used where those studies have no row (for a Caucasian
man of 30: MMPA, SN–MxP, LAFH %, U1–MxP, the interincisal angle, overjet and overbite), or with no population chosen
(then set 1).

**Against the literature.** On the app's own Malay and Chinese studies the two are close for the rows they share: SNA
84.5 ± 4.0° in Norman 2020's 100 Malay adults against 83.0 ± 3.7° in Zheng 2026's 60 Chinese adults (1.5° apart, 0.4
of an SD); SNB 81.2° against 81.0°; the interincisal angle 121.8° against 123.2°. The Malay studies cover 20 of the
catalogue's measurements; for the rest (for example Wits, the facial angle, Y-axis) a Malay patient gets the Chinese
studies. The app holds no Indian sample, so it cannot show the Indian–Caucasian pair; the ruling rests on the owner's
reading of the literature, not yet a cited paper in the app (Lew 1994, Chinese, Malay and Indian women, is listed in
SOURCES.md but not extracted). Set 2's L1 to APo is built from papers that place the lower incisor differently from the
app's tip point, so it is marked "close". Set 2's U1 to SN is a website value (ABO, "data on file") with a narrow SD of
2°: a Caucasian incisor 4° off reads two SDs out.

**What would make it wrong.**
1. **A real difference in one measurement.** "No significant difference" in a paper is about the averages it tested;
   one measurement can still differ. A Malay patient's Wits, measured against Chinese studies, carries the Chinese
   ruler's centre.
2. **The patient's background is a label.** An Indian patient of mixed descent is laid against Caucasian samples from
   Ann Arbor and elsewhere; read the source line's place.
3. **The NUS fills are not on the sheet.** Set 2's U1 to SN, L1 to APo and the four borrowed SDs are the app's own,
   owner-ruled numbers, not NUS's.

**What it cannot show.** Whether an Indian or a Malay patient really resembles the Caucasian or the Chinese samples.
Nothing in the app judges that. Before/after on the resolver grid against main `18ce649` (15 analyses × 94 measurements ×
13 populations × 3 sexes × 3 ages): only 4,815 Malay rows (Auto before, the Chinese norm by the rule now), 63 NUS
Caucasian rows and the new Indian (12,555) and BaSN (1,755) rows moved; every other row's numbers identical
(`docs/norms/evidence/2026-11-07-nus-record.md` §8).

## Combined adult norm (owner R1/R5, NAP-P1 to P4, 3 Nov 2026) — what it can and cannot tell you

Code: `packages/analyses/src/norms/combined.ts`
and `fromCombined` in `resolve.ts`. Used only when Auto has nothing recorded to go on: no background, no clinic
default, and the patient is 18 or over (or no age is entered). A population chosen by hand never uses it.

**The picture.** Put every adult study in the app on one ruler for one measurement — say SNA. Each study is a crowd of
people with its own centre (its mean) and its own spread (its SD). Ask all those crowds to stand together, each person
counting once (a study of 60 men brings 60, a study of 11 brings 11), and read off the centre and the spread of the
whole crowd. That is the combined adult norm. Men and women stand on separate rulers. A study that never measured SNA
brings nobody to the SNA ruler, so each measurement has its own crowd.

**What is compared with what.** The patient's value on this film, against the centre and spread of that combined crowd
of adults of the patient's sex (each study's adult group; four of them start at 15–17 — Norman 2020, Gu 2011 Beijing,
Caballero 2019, Alshahrani 2018 — so "18 y and over" on the row is the patient's rule, not every study's floor): everyone in the app's adult studies measured for that one measurement. Who is in the
crowd: one row per study (its oldest adult row, so people filmed twice — Thilander 2005 at 18–20 and again at 29–32 —
count once); its own number of people (Thilander's adult row: 11 men, 19 women, not its 469 films); studies that print
one row for both sexes join both crowds for angles, percentages and ratios only, counting that row's own men or women
(never for millimetres, where men and women differ by several mm). Zheng 2026's adult row is 60 people, 30 men and 30
women, so it brings 30 to each crowd — not the study's 60 of each, half of whom are adolescents (owner I1 (a), 3 Nov
2026); a both-sexes row whose split cannot be told, in a study that also holds children, is left out; the same students reported twice count once (Alcalde 1998
and 2000; Gu 2011's Michigan adults and McNamara 1984's Ann Arbor adults are probably the same people). Mohammad 2011
and Norman 2020 (both Malay, both UiTM, Selangor) were considered and kept as separate studies: their samples were
collected about a decade apart (owner M7, 3 Nov 2026). Beauty-
selected samples (Wei 1968) stay in (owner R4); rows measured a little differently ("close") stay in and mark the
norm close, saying how many (owner R2). Millimetre rows are converted to true size before combining. Never in it: an
analysis's own norm, a teaching sheet, a website value, a sample marked as consecutive patients taken whatever their
bite (none today), a row without its own SD or without a count of its people (Fu 1975, Miao 1995, Chan 1972, Cheng
1986, Lew 1992). **Clinic patients can be in it:** Kim 2025, Al Maaitah 2022 and Zheng 2026 are patients selected for
normal occlusion, and Cheong 2024's 85 women (women's H angle only) are patients who sought treatment, selected only
for a Class I skeletal pattern (ANB 1–5°), not for normal occlusion or a balanced profile. The owner kept Cheong in
(KIMRANK-1 extended, 3 Nov 2026); without it women's H angle is 15.41 ± 4.12° instead of 15.54 ± 4.13°. The source line names every study:
"Combined adult norm, men: 8 studies, 277 people (…)". With only one study for the measurement, that study's own row
is used and marked ◆ "single study" (owner NAP-P3 (b): two studies of any size combine). With none, Auto's usual
fall-back (◆). The report: "We used combined adult norms for women, from every adult study in the app weighted by size
(chosen automatically from the patient's demographics)."

**Against the literature.** The method is the standard formula for combining groups — Cochrane Handbook for Systematic
Reviews of Interventions, section 6.5.2.10, Table 6.5.a: mean = Σ nᵢmᵢ / N; SD = √{[Σ(nᵢ−1)sᵢ² + Σ nᵢ(mᵢ−M)²] /
(N−1)}. The second part is how far each study's centre sits from the combined centre, so studies that disagree widen
the normal range (owner NAP-P1 (a)). The app already used the same formula for two equal groups when it averages men
and women (SEX-AVG-1). On the sets today: men's SNA 83.1 ± 4.1° (8 studies, 277 people), against Thilander 2005's men
of 29–32, 82.2 ± 3.3°; men's U1–SN 110.4 ± 7.6° (5 studies, 124), between Zheng 2026's Chinese adults (105.9 ± 7.5°)
and Gu 2011's Michigan Caucasians (113.8 ± 6.7°). The spread matters: a man at U1–SN 125° is 1.91 SD out (one star,
Mild); with each study's own spread only (± 6.7°) he would be 2.16 SD out (two stars).

**What would make it wrong.**
1. **The mix decides the answer.** The crowd is weighted by who published, not by who walks into the clinic. Adding
   one large study moves every combined norm it measured.
2. **Close definitions are averaged, not corrected.** Every IMPA (Go–Me) study in it states no mandibular plane; the
   combined value is an average of four unstated planes.
3. **Probable duplicates.** If two studies counted as one cohort are really different people (or two counted
   separately are the same people), the spread and centre shift a little. The pairs are a judgement from the papers'
   descriptions, not a confirmed fact.
4. **A single study is one population.** About a third of measurements (22 of 70 for each sex) have one adult study
   today; that row carries its own population, whatever it is (◆, "single study").

**What it cannot tell you.** Whether a value is typical for this patient's own background. **For the key measurements
(SNA, SNB, ANB, MMPA, FMA, U1–SN, IMPA Go–Me) the combined crowd is 54–85 % East and South-East Asian people (Chinese,
Malay, Japanese) by number, because that is where the app's adult samples come from** (men's SNA 79 %, women's SNA
60 %, men's U1–SN 69 %); across all measurements it runs from 0 % to 100 %, depending on who measured each one. It is not a neutral or "average human"
norm. For a patient of European background, recording the background or setting a clinic default gives the closer
match.

## Sex not recorded: the average of male and female (owner decision 5 = SEX-AVG-1; words changed 29 Oct 2026)

**The picture.** When the patient's sex is not recorded, the ruler is drawn for "a person who is equally likely to be
a man or a woman": its middle is halfway between the men's and the women's average, and it is wider than either,
because it must cover both. A paper's own both-sexes row for the age is used when it has one; otherwise its men's and
women's rows at that age are averaged. The row is marked **"average of male and female"** (until 29 Oct the badge read
"sexes averaged" and the source line "men's and women's rows averaged"; only the words changed, never a number), and
the hint "Sex not recorded — record it for the exact norm." shows above the table. The report sentence still says
"pooled" for such a row (owner NAP-Q4 (b)).

**The formula.** mean = (mM + mF)/2; SD = √((sdM² + sdF²)/2 + ((mM − mF)/2)²). In one line: by the law of total
variance, the spread of an equal mix is the average spread within each sex plus the spread of the two sexes' means
around their midpoint.

**Worked example** (Gu et al. 2011, Eur J Orthod 33:205–211, Table 2 p. 207, Caucasian young adults, SNB, 18–40 y):
men 82.0 ± 2.9° (n 30), women 79.9 ± 3.3° (n 60) → mean (82.0 + 79.9)/2 = 80.95°, SD √((8.41 + 10.89)/2 + 1.05²) =
3.279° — exactly what the app computes (`sexavg.test.ts`). What it does to a grade (more than 1 SD Mild, more than 2
Moderate):

| Patient's SNB | True sex | Own-sex z (grade) | Averaged z (grade) |
|---|---|---|---|
| 76° | man | −2.07 (Moderate) | −1.51 (Mild) — more lenient |
| 76° | woman | −1.18 (Mild) | −1.51 (Mild) — stricter in z |
| 88° | man | +2.07 (Moderate) | +2.15 (Moderate) |

**What it cannot show.** It is not the paper's own pooled sample (30 men and 60 women would give 80.6 ± 3.32°, weighted
by the sample's sex ratio); it describes a patient of unknown sex. Record the sex for the exact norm.

## In the report and the CSV (spec 2026-10-17 report-exports)

- **The 4 SD note is not here.** "Extreme value for the norm" is screen-only (see its section above); the report, PDF and CSV carry the stars and z but not the note.
- **What the Meaning column is.** The same words as the row's detail line on screen: the severity word plus the
  clinician's (or approved) term for that side of the mean — "Mild Class II" for ANB more than 1 SD above its norm,
  "Within normal range" within 0.75 SD. It compares this film with the norm chosen for it; it is not a diagnosis
  (the report's last line says so: CONTEXT-LINE).
- **Whose words these are.** The report and the CSV use exactly the words the film's screen is showing right now —
  never a fixed "the practice's" wording — by the same rule as above (NOCLIN-2): the clinician chosen in the top
  bar; else the film's referring practitioner, but only while that person has their own words saved in Settings ›
  Meanings; else the Mac's login name. Two exports of the same film made under different logins can print different
  Meaning text for the same row; the measured value and stars never change.
- **Words changed in a report** belong to that film. They print only while the row still reads what they replaced:
  if a point is moved and ANB goes from "Mild Class II" to "Severe Class II", the report prints "Severe Class II" and
  offers the old words back. The CSV marks changed words (`meaning_edited = yes`).
- **What it cannot show.** A row with no usable SD has no stars, no colour and no meaning. An mm value on a film that
  was not calibrated from its ruler is not printed and not exported ("calibrate to show"): the assumed 0.1 mm per
  pixel can be off by the film's magnification.
- **The CSV's numbers are the screen's numbers**: `value` and `z` at full precision, `value_display` as shown,
  `stars`/`severity` from the same z as the colours.
- **`norm_mean` and `norm_sd` hold the norm whenever the `norm` text column shows a value** (owner decision, 20 Oct)
  — a "Needs: …" row (no value placed) and a hidden mm row on an assumed scale (not calibrated) both still name
  their norm in text ("87.8 ± 3.6°"), and now in these two numeric columns too, even though neither row has a `z`,
  stars, colour or meaning. An SD-less norm (a website value, an ideal with no SD, a mean given only as a range)
  fills `norm_mean` and leaves `norm_sd` blank, the same split `norm` itself shows ("82.4°" with no "±").
  Both stay blank only when there is no norm to name at all ("No norm", or — only when your own norm sets are the sole
  source — "no … norm — choose one"). `z`, `stars`, `severity` and `side` stay blank wherever no grade is possible — a
  row with no value shown, or a norm with no usable SD — exactly as before; only `norm_mean`/`norm_sd` changed.
- **Auto norms in the CSV (owner N-A3, AUTO-Q6, 19 Oct 2026; column added by owner ruling Q-A, 24 Oct 2026).** A row
  Auto filled (its population had no norm for that measurement) exports the Auto norm in `norm`, `norm_mean` and
  `norm_sd` exactly as the screen grades it — the analysis author's own value, a Caucasian sample, or another
  population's study. `norm_source` still ends "· Auto (no Saudi norm)" and names the paper, and now a dedicated
  `norm_auto` column — **tidy layout only** (Named and Anonymised alike; review I-1, fix round 1, 25 Oct 2026): the
  wide layout has no `norm`, `norm_mean`, `norm_sd`, `z` or `norm_source` column at all — one column per
  `analysis.measurement`, the value only — so Auto changes no number there for a researcher to filter on. In the
  tidy layout, `norm_auto` reads machine-readably which step filled the row: `analysis-own` (the analysis author's
  own value), `caucasian` or `anywhere` (another population's study) — or, review I-4 + owner ruling (fix round 1),
  **`chosen`** for a row the clinician picked by hand with the norm drop-down (NORM-PICK-1): that row also compares
  the patient with another group's norm, even though Auto never touched it. Before pooling `norm_mean` or `z` across patients **in the tidy export**, drop the rows whose `norm_auto` is
  non-blank: any of the four values means the row compares the patient with a group other than the population
  chosen for the case. **A blank does not prove the reverse.** A film with no population chosen (and no clinic
  default) is compared with the analysis's own norm (an author's target) or your own norms, and its `norm_auto` is
  blank there; since 29 Oct 2026 (owner decision 6) a row neither has reads `analysis-own`, `caucasian` or `anywhere`
  on that film too. **And a case on Auto (owner decisions 1 and 3, 29 Oct 2026) has its population chosen by the rule**
  — the patient's background, else the clinic default, else the largest study for the patient's sex and age — so a
  blank `norm_auto` there means "the population Auto chose", which can differ from film to film. The CSV has no
  population column (and never the background), so check `norm_source` for which population each row used. `chosen` rows carry no ◆
  and are not in the report's Auto footnote (the clinician chose them; the source line says "chosen by you").
- **`age_years` and `age_source` (ruling R12, 19 Oct 2026; Task 14, 25 Oct 2026).** `age_years` is the age the
  norms used to choose this film's age row — the same number, from the same function (`filmAge`), not a separate
  reading. **The picture:** with a date of birth, count from the birthday to the scan date written on the film (never
  today) — `age_source` = `dob`; with no date of birth, take the age printed on the film ("011Y") or typed into the
  panel — `age_source` = `film`; with neither, both cells are blank. **What is compared with what:** nothing new is
  compared — the column only records which age the norm row was picked for, so a researcher can filter or adjust for
  it. **Against the standard:** a `dob` age is exact to the day (e.g. 13.92); a `film` age is in DICOM Age String whole
  units (PS3.5 §6.2), so "011Y" exports `11.00` and, if the machine writes completed years, means anything from 11.00
  to 11.99 — a typed "11 yrs 3 mths" exports `11.25`. Do not pool the two as if equally precise. **What would make it
  wrong:** a stale or mistyped film age (nothing checks it without a date of birth); and **a blank cell does not mean
  "no age known"** — a film with a date of birth but no scan date (or a scan date before the birth) exports both blank
  even when the film carries an age, because the norms used no age there either (R1); the report shows that film's
  printed age with a note, the CSV does not. **Before/after:** for every film with a date of birth `age_years` is
  bit-identical to the export before Task 14 (Task 14 report: 132 DOB age cells over 11 synthetic DOB films, and the
  393 in the unadjusted golden, 0 changed); only no-DOB films with an age change, from blank to the film's age.
  Both columns are in the tidy and the wide layout, and both are kept in an Anonymised export.
- **An Anonymised CSV is de-identified, not anonymous** (ANON-1): it drops the name, date of birth and every ID
  (library, scan, patient — these are codes such as "L-00042", not numbers), but keeps the film date and the exact
  age, from which a date of birth can be worked back to within days (a `dob` age; a `film` age is whole units, and
  `age_source` says which). It also keeps three free-text columns as
  written — `timepoint`, the `meaning` text (whose words, above), and the `analysis` name (a clinician's own typed
  name for a "My analysis") — none of these is blanked by choosing Anonymised, because each describes the FILM, not
  the clinician, even though it can still name or describe the PATIENT if written carelessly (a timepoint of
  "post-op right condyle fracture", a Meaning edited to include a name, an analysis called "Jane's 2nd opinion").
  **The `scale` cell of a fitted film (m4, integration-review.md 20 Oct):** it names the reference film's timepoint
  too, for example "scaled to T1 on S–N (×1.042)" — the same kind of free text as the `timepoint` column above, and
  never a name, date of birth or ID. If a clinician typed a date as a timepoint, it now appears in two cells.
  **`verified_by` is different: owner decision, 20 Oct.** It names a clinician, not the patient, so an Anonymised
  export codes it instead of keeping or blanking it — "Clinician 1", "Clinician 2", … — a stable code per
  clinician within the file, assigned the first time their name is seen in it (every film they verified in that
  same file keeps sharing their one code, so "did the same clinician verify these two films" still answers
  without their name appearing anywhere). A film not yet verified still has no `verified_by` at all (blank, as in
  Named); a verified film with no name recorded stays blank too (there is nothing to code).

## Which age row: the DOB, else the age on the film (owner AG1, 19 Oct 2026; library format 13)

**The picture.** A norm table often has a row per age: the 11-year-olds' mean and SD, the 12-year-olds', the adults'.
The app picks the row from the patient's age on the day of THIS X-ray. With a date of birth, that age is counted from
the birthday to the scan date written on the film — never today's date. With no date of birth, it now uses the age
printed on the film (for example "011Y", which X-ray machines write for 11 years) or an age typed into the panel.

**What is compared with what.** The patient's value on this film, against the row for the age at this film. Before
19 Oct a film with no date of birth was always compared with the adult row ("age not entered — adult norms assumed"),
or, in a table with no adult row, its oldest row ("age not entered, no adult row"). Now, if the film carries an age,
it is compared with that age's row; only those films change (the before/after over every analysis, population and
synthetic skull, `apps/desktop/src/norms/ageRowSweep.test.ts`: 84240 rows compared, 0 changed for any film with a
date of birth). Measured on that sweep (main `94fe3e4` against this branch, 9360 cells per synthetic film):

| Synthetic film, no date of birth | Cells changed | Same paper, another age row (mean/SD moved) | Another paper or Auto source | Figures unchanged, only the age tag/words |
|---|---|---|---|---|
| film says 11 y | 4800 | 2580 | 552 | 1668 |
| film says 11 y 3 m | 4806 | 2556 | 540 | 1710 |
| film says 30 y | 4218 | 978 | 102 | 3138 |
| film says 8 y, no scan date | 4572 | 2142 | 588 | 1842 |

Three things a reader would not guess from "the age row": (1) an adult's age moves the figures too, wherever a paper
has more than one adult row (Thilander 2005's SD for 30 y comes from its 29–32 y row, not the 18–20 y row the "adult
assumed" rule took); (2) an age can change which **paper** is used, not only the row — where the chosen population's
paper has no row near the age, the resolver or Auto goes to another one, and the source line names it; (3) a child's
age can swap the "age not entered" tag for "other age" (no row for that exact age; the nearest one was used).

**Against the standard.** DICOM's Age String ("nnnD/W/M/Y", PS3.5 §6.2) is whole units. The standard does not say how
a machine rounds; if, as is usual for an age, it writes completed years, "011Y" means 11.0 up to 11.99 years. A table
with one-year rows can therefore sit one row young; a table with wide bands (8–12 y) rarely moves. A date of birth
gives the exact age and always wins.

**What would make it wrong.**
- **A wrong or stale age on the film** (a machine that prints the age at booking, or a typing slip): the row is chosen
  from it. With a date of birth the panel shows "The film says 11 y; DOB gives 12 y 6 m at the scan date." when they
  are more than a year apart; with none, nothing can check it.
- **A date of birth without a scan date**: the row stays the adult row ("film date missing"), as before; the film's
  age is shown but not used (R1).
- **What it cannot show:** whether the patient's growth matches their age. An 11-year-old's row is an average
  11-year-old; skeletal maturity can be years apart from it.
