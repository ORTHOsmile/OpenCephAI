# Norm sets

Each file here is one `NormSet` (see `packages/analyses/src/norms/types.ts`), named `<id>.json` where
`<id>` matches the set's own `id` field exactly — `loadSets()` refuses a mismatch. Every set is checked
against `packages/analyses/src/norms/validate.ts` by `pnpm norms:check`; a set that fails validation
cannot be loaded, so nothing broken reaches the app.

Values are double-extracted from the cited paper (two independent reads compared, `curation.comparedOn`
recorded) before a set is committed here — see `docs/norms/HOW-TO-ADD-NORMS.md` for the process. Never hand-edit a
number in a committed set without re-running that comparison: a value changed by hand is a value nobody
has checked against the paper a second time.

## `scale` — film enlargement (owner rulings M-1, M-2, 8 Oct)

Every set carries `scale: FilmScale`, saying how its mm values relate to true size. A lateral film is
never life-size on the sensor: some older papers (hand-traced cephalograms, mostly) report their linear
measurements at the film's own enlargement — commonly 8-10% larger than the patient — rather than
correcting back to true size first. Degrees, `%` and ratio measurements are never affected: an angle
measured on an enlarged film is still the same angle (M-2).

One of three shapes, decided by what the paper itself says:

- `{ kind: 'true-size', source: '<page or ruling>' }` — the paper says its mm values are already true
  size or corrected for magnification, or the owner has ruled that the source is scaled correctly (e.g.
  the NUS teaching sheet). Stored and resolved unchanged.
- `{ kind: 'enlarged', percent: <0 < n ≤ 20>, source: '<page>' }` — the paper says its mm values
  **include** this film enlargement (quoted from the paper's own stated magnification, e.g. "8%
  enlargement, p. 451"). The JSON entry keeps the paper's own printed number; the resolver reports the
  norm at true size, `printed ÷ (1 + percent/100)`, and shows both: the converted value is what the
  patient's measurement is compared against, with the printed (paper) value and the percent and page
  named in the source line, flagged `converted-to-true-size`. That flag means the norm's **own** printed values
  were converted; when only a borrowed SD came from an enlarged film, the flag is `sd-converted` instead (T4-1).
- `{ kind: 'not-stated' }` — the paper never says what its film scale was. The value is used as printed
  (modern papers calibrate before publishing, so this is assumed true size, owner ruling M-2), flagged
  `scale-assumed` with that wording in the source line, so a reader can tell the difference from a paper
  that stated and was corrected.

A set where the paper states its film magnification but not whether the printed values were corrected
for it is `not-stated`, with the paper's own wording quoted in `caveats` (e.g. Wu 2007, Mohammad 2011) —
`not-stated` is never a claim that the paper said nothing about film scale, only that it did not say
whether its mm values were corrected.

An entry's copied `sd` with `sdSource` is the source paper's printed value; the resolver converts it
with the source set's scale (flagged `sd-converted`).

**One meaning per flag (ruling T4-1, 12 Oct).** A flag describes the norm's own row; when only the
row the SD was taken from differs, the SD has its own flag, so the words on screen never say the norm is something
it is not. An `sdSource` SD taken from that paper's row for another age is `sd-other-age` (not `age-mismatched`),
from its both-sexes row under a one-sex norm `sd-sexes-pooled` (not `sex-pooled`), from a row measured a little
differently `sd-close` (not `close`); a borrowed SD converted from an enlarged film is `sd-converted` (not
`converted-to-true-size`). No committed set uses `sdSource` today, so the first three are not yet raised by any
real norm; `sd-converted` is (708 + 154 results in the 12 Oct sweep, e.g. Ricketts 1960's E-line, whose SD is
borrowed from an enlarged-film paper). No norm value or source line changed with this ruling.

## `citation.undated` — a source with no date (Task 5 fix round 1)

A source that prints no date (the NUS/NDC teaching sheet) carries `citation.undated: true` and **no**
`year`; the validator refuses a set with both, and a set with neither. Never put in a placeholder year:
the source line shows the year to the reader, so a made-up one reads as the source's date. An undated
set's source line reads "<name> (undated)", and on the resolver's last tie-break (later paper first) it
ranks after every dated set.

## `centre` and borrowed SDs (Task 4c, owner rulings B-1, B-2, 8 Oct)

**`centre`** (on an entry; optional) says what the number in `mean` (or the middle of `range`) *is*:

- absent or `'sample-mean'` — the average of the paper's own measured sample (Downs 1948 is this: his
  means are sample means and his ranges are that sample's spread, so Downs is **not** an ideal);
- `'ideal'` — the author's ideal or clinical target rather than an average of real people: Steiner's
  ideals, Holdaway's standards, Ricketts' clinical norms printed without an SD. The resolver flags it
  `ideal` when it is coloured (an SD was found for it) and `ideal-uncoloured` when no SD could be used (T4-1),
  and the source line says "ideal value (<authors>)". Tweed's `clinicalTarget` stays a separate
  field (his means are sample means).

**An entry with no SD leaves `sd` out.** `"sd": null` is refused by the validator (fix round 1, P32);
the resolver also treats a stray null as no SD, never as 0.

**Borrowed SDs.** A norm can only be coloured (z-score, amber/red) when it has an SD. Many papers, and
every ideal, print none. When the chosen entry has no `sd` of its own and no `sdSource`, and its set is
not a website set, the resolver borrows the SD of the closest matching paper. Owner SDLEND-1 (13 Oct, settled in fix
round 1 as SDLEND-1a and 1b): **the lender comes from (1) the same population at a similar age, then (2) the same
population at any age, then (3) another population at a similar age, then (4) anything else.** A lender's row is of a
*similar age* (SDLEND-1b) when it is on the patient's side of 18 — a child under 18, an adult of 18 and over, and with
no age entered an adult (as everywhere else, AGE-UNK-1): its band holds the patient's age, or it has no band (it holds
for every age), or (a child) its band starts under 18, or (an adult) its band starts at 18 or more or reaches past 18.
A band spanning 18 (15–40) counts for both. The order, with the patient's own sex before both sexes pooled in each step:

1. same population, the patient's own sex, an age band that **contains** the patient's age;
2. same population, the patient's own sex, a similar age, the nearest band — a row with no age band ("all
   ages") belongs here, never in tier 1, because it does not say it covers this patient's age; when
   the age is unknown, the adult row comes first;
3. same population, sexes pooled, a similar age — a band containing the age first, then the nearest;
4. same population, the patient's own sex, another age, the nearest band;
5. same population, sexes pooled, another age, the nearest band;
6. any other population, the patient's own sex, a similar age, the nearest age;
7. any other population, sexes pooled, a similar age, the nearest age;
8. any other population, the patient's own sex, another age, the nearest age;
9. any other population, sexes pooled, another age, the nearest age.

*Picture it* (Bailey & Taylor 1998, African-American children of 8–12, printed SNA 86.08° with no SD). The only other
African-American paper with an SNA SD is Kim 2025, Philadelphia **adults** (3.6°). Population comes first, so a boy of 10
is judged against Kim's adult spread (step 2), not against Swedish or Hong Kong children's (3.2°, 3.65°, step 3). Where
the patient's own population has nothing at all, age decides among the others: McNamara 1984's ideals (FH–GoMe, facial
axis) for a 17-year-old with no population borrow Wu 2007's 11–13-year-olds' spread (5.19° for FH–GoMe) rather than Ann
Arbor's 18–40 adults' (3.9°). The source line always names the lender and its age row. *What would make it wrong:* an
adult's spread lent to a children's mean is a mixed yardstick — read amber or red on Bailey & Taylor's seven as "unusual
against 8–12-year-olds' average, with an adult sample's spread"; and the line at 18 is a hard line — a 17-year-old
counts as a child, so he can get a 12-year-olds' spread over an adult one only a year older than him.

"Same population" means the chosen paper's population; when the chosen norm is an analysis's own
norm (Steiner, Ricketts…, which belong to no population) it means the patient's population — the
case's, else the clinic default — and with neither only tiers 6 to 9 apply. When the patient's sex is
not recorded only the pooled tiers (3, 5, 7, 9) are used. A donor of the other
sex is never used. Among similar-age lenders of the same population, a boys' SD is preferred to a pooled SD whose
band holds the age (ruling P31, from the owner's wording "same population, same sex and age"); a boys' SD of
**another** age is not — it comes after every similar-age lender of the same population (SDLEND-1a). Within a
tier: the nearer age, then the larger n (the row's own n, else the paper's count of that sex —
`nMale`/`nFemale` — else its whole sample), then the later paper (undated last), then set id. A donor must measure the **same**
thing (`definitionMatch: 'same'`), carry its **own** SD (never an `sdSource` or borrowed one — no
chains), and come from a verified or single-extracted population set. An explicit `sdSource` in the
data always wins over this search. A mm donor SD is converted to true size by the **donor's** `scale`
(and the conversion is named in the line); a mm SD from a donor whose scale is `not-stated` is used
as printed and the line says "(donor's X-ray enlargement not stated; mm taken as true size)" (owner ruling Q-B, 24
Oct 2026 — the words only; the shape is unchanged). The result is flagged `sd-borrowed`, `Resolved.sdDonor`
names the donor, and the source line reads e.g. "… · SD borrowed from Tan 2015, Chinese, 11–14 y, boys,
Table 3", or for an ideal "… · ideal value (Steiner C); SD borrowed from …". A range-only ideal is
centred on the midpoint of the author's range (the line says so, and `printed.mean` holds the
printed midpoint when the set is enlarged); a range-only sample entry gets no
borrowed SD (it has no centre). With no donor the norm stays uncoloured and the line says "no SD in this
paper and no matching SD to borrow" (an ideal is then flagged `ideal-uncoloured`).

**What a borrowed SD can and cannot tell you.** Picture the norm as a target with rings around it: the
author supplies the bullseye (their mean or ideal), and a *different* paper supplies the ring spacing
(how far a typical person in a similar group sits from their own group's average). So a borrowed SD
tells you how unusual the patient's value would be **in a group like the donor's**. It cannot tell
you:

- the spread of the author's own sample — that sample's people may have varied more or less;
- for an ideal, how far from the ideal is still acceptable to that author — an ideal has no spread of
  its own; the rings measure variation among real people, not the author's tolerance;
- anything about a different age or sex than the donor row named in the line (a boys' 11–14 SD lent to
  a pooled adult mean is the donor's spread, not the adult's).

Read an amber or red against a borrowed SD as "unusual for a group like the donor's, measured from this
author's centre", never as "outside this paper's normal range". The donor and its row are always
named in the source line, so the reader can judge how close the match is.

## Which paper is chosen — age first, then sample quality (owner AGE-1, 8 Oct)

Set order: (1) a paper before a website value; (2) any other sample before a sample of treatment-seeking patients (P37, applied before age, owner P37-FIRST); (3) a set whose ages cover the patient before one that does not (AGE-1) — with no age entered, a set with an adult row (a band from 18, or reaching past 18, or a row with no age band) before one with child rows only (owner AGE-UNK-1, 12 Oct; a step inside this order, after (1) and (2), never ahead of them); (4) among sets that do not, the nearest age (AGE-2; people's populations only); (5) a class-I balanced sample, then the larger sample, then a first-hand source before a second-hand restatement (owner FIRSTHAND-1, 13 Oct), then the later paper (undated last). Within the chosen set: the patient's age row first, then own sex over pooled; when the sex is not recorded and the set gives only men's and women's rows at that age, the two are averaged (mean of the means; SD of an equal-sized mixed group), marked 'sexes averaged' (owner SEX-AVG-1, 12 Oct); a both-sexes row for the age always wins, and a row copied from the other sex is never averaged with the row it copies (rulings P7, P9); with no age entered, the chosen set's adult row is used, marked 'age not entered — adult norms assumed' (AGE-UNK-1).

When several papers of the patient's population give the same measurement, the app first asks **which of them
studied people of this patient's age** (a row for the patient's sex, or both sexes pooled, whose age band holds
the patient's age in completed years; when the sex is not recorded, a men's row and a women's row printed for the
same band count too, since the app averages them — SEX-AVG-1; for a paper printed at single ages, an age between its first and last
printed age). Those papers come first; among them, and among the rest, the old order stands: a Class I sample
with balanced faces first, then the larger sample, then the later paper. Two demotions come before age: a website
value always last, and a sample of patients seeking treatment (Ricketts 1960) after every other sample (owner
P37-FIRST, 12 Oct). With the age not entered, an adult is assumed (owner AGE-UNK-1, 12 Oct), and this takes the place
of the age step, after the two demotions: among the papers left after them, those with an adult row for the patient —
a band from 18, or one reaching past 18 (an open adult row, or a band spanning 18 such as Gu's 16–30), or a row with no
age band — come before papers with child rows only, and then the old order decides. A website or treatment-sample
paper with adults still comes after an ordinary paper of children.

**A treatment sample is used only when no other paper has the measurement (owner P37-FIRST, 12 Oct).** Picture the
E-line lower lip for a man of 30. Ricketts 1981 printed lip positions at single ages up to 23, Ricketts 1960 measured
consecutive orthodontic patients including adults of 19–44. Before this ruling the 1960 adults "covered" him and won;
now Ricketts 1981's age-23 row (−5 ± 2 mm, its own SD) is used, marked as not his age. What it cannot tell you: the
lip keeps moving back after 23 in Ricketts' own account, so his age-23 value is the nearest printed point, not a
value for a 30-year-old. For a patient whose sex is not entered, an adult of unknown sex gets Ricketts 1981's adult men's row — the row women get, since his adult women's rows copy the men's — flagged 'other sex's values' and, past 23, not the patient's age (age 23, −5 ± 2 mm; age 18, −3.75 ± 2 mm when no age is entered). Owner SEX-AVG-1 with ruling P9, 12 Oct: a copied row is not averaged with the row it copies.

**An African-American adult since 13 Oct (Kim 2025, owner KIMRANK-1).** Kim et al. 2025 measured 34 Philadelphia adults with normal bites and balanced faces, chosen from records of people attending a university orthodontic clinic. The owner ruled (KIMRANK-1, 13 Oct) that it ranks as an ordinary Class I sample, like Cheong 2024 (Malay women also picked from clinic patients for a Class I pattern), not as a treatment sample. Picture a man of 30 and his SNA: Bailey & Taylor 1998 printed SNA only for children of 8–12 (86.08°, no SD); Kim printed 84.6 ± 3.6° for adults. His age is inside Kim's adult band and outside Bailey & Taylor's, so he is compared with Kim's adults, with Kim's own SD — for all 37 of Kim's measurements, including the seven Bailey & Taylor also print (SNA, SNB, ANB, SN–GoGn, U1–NA°, interincisal, U1–SN). A child of 8–12 is still compared with Bailey & Taylor's children; their missing SD is still borrowed from Kim's adults, because the same population comes before age (SDLEND-1a, above). A boy of 15 is in neither band (3 years from each); Bailey & Taylor's balanced Class I sample wins that tie and is marked not his age. *What it cannot tell you:* Kim's sample is small (9 men, 25 women; n 34) and its age spread is wide (mean 28.4 ± 12.7 y, no range printed; the 18–40 band is the P18 convention), so its SD is a mixed-age adult spread; and it says nothing about African-American patients outside Philadelphia's clinic population.

**Jordanian patients since 13 Oct (Al Maaitah 2022, owner JORDAN-1).** Al Maaitah et al. 2022 measured the Björk polygon (saddle, articular, gonial angles and their sum) on 94 Jordanian adults with a skeletal Class I pattern (ANB 2–4°), the Class I group of 288 patients before treatment at Irbid. The paper calls them Caucasians of the Jordanian population; they were first filed under 'Caucasian', whose label speaks of European background. The owner moved them to their own population, **Middle-Eastern / Jordanian**. Picture a Jordanian man of 30: his sum of angles is compared with 397.21 ± 7.65° (Al Maaitah, Table 3); a Caucasian patient is no longer compared with Jordanians — for those four angles the app asks the clinician to choose a source, as it did before this paper. *What it cannot tell you:* the whole sample was also limited to an average MMPA (27 ± 5°), and the sum of angles tracks vertical pattern, so its spread is narrower than an unselected sample's would be; and it has no other measurement for a Jordanian patient — every other cell asks the clinician to choose.

**First-hand before second-hand (owner FIRSTHAND-1, 13 Oct).** When two papers give the same measurement and nothing else separates them (same selection class, same sample size), the one that measured it itself ranks before one that only restates someone else's value — then the year decides. Picture Eastman U1–MxP: Naini 2011 (Eastman standards, first-hand) and Alassiry 2022 (which restates the Eastman standards in its Table 2) both give 109 ± 6°. Before the ruling Alassiry won as the later paper; now Naini does. The number is the same; the source line names Naini and the 'second-hand' mark goes. *What it cannot tell you:* "first-hand" means the paper is not marked as quoting another; it does not mean the first-hand paper's sample is larger or better (sample size and selection still rank first).

Picture two Chinese tables for Co–Gn: Wu 2007 measured 405 Hong Kong 12-year-olds (11–13 y); Gu 2011 measured 65
Beijing young adults with balanced faces (16–30 y). A boy of 12 is compared with Wu's 12-year-olds, a man of 20 with
Gu's adults. A boy of 15 is in neither table: Gu's band starts 1 year above him and Wu's ended 2 years below, so
he gets Gu's adult row, marked as not his age (the nearest age, AGE-2 below).

What it cannot tell you: a row that "covers" the age is only as good as the paper's band. Gu printed only mean
ages (19.3 ± 3.0 and 20.3 ± 3.4 years), so its 16–30 band is the owner's reading of those means, not a printed
range; Wu's 11–13 band is the actual spread of a sample of 12-year-olds. A row with no age band at all covers no
age for this choice (it says nothing about who was measured).

**When no paper covers the age, the nearest one (owner AGE-2, 8 Oct).** If none of the population's papers studied
people of the patient's age, the papers are ranked by how far their nearest age band is from the patient's age (in
completed years: a boy of 14 is 1 year past Wu's 11–13 and 2 years short of Gu's 16–30), nearest first; papers at
the same distance fall back to the old order. So a Chinese boy of 14 is compared with Wu's 12-year-olds, not Gu's
adults, and a Chinese man of 45 with Zheng's adults (18–41, 4 years away) rather than Miao's (18–40, 5 years away).
The row is still marked as not his age. Only the patient's own-sex or pooled rows count for the distance (sex not
recorded: pooled rows, and men's and women's rows printed for the same ages, SEX-AVG-1); a paper with
no age band at all comes after every paper that has one. This applies within a people's population; the analyses'
own norms (Steiner, Ricketts…) keep their old order.

What it cannot tell you: the nearest paper is the least distant sample, not a sample of the patient's age. One year
past a band of 12-year-olds is still a year of growth the paper never measured.

**An adult band that starts below 18 is not a warning when the age is unknown (owner AGE-3, 8 Oct).** With no age
entered, the app takes a paper's adult row; when a paper's only (or oldest) band starts below 18 but runs past it —
Gu's 16–30, Norman's 15–30 — that band is treated as the adult row and is not marked "not his age". Nothing else
changes: the same row and the same numbers are used. A band that stops at 18 or below (a 15–18 band) is still a
child's row standing in, and is still marked and said.

**No age entered: an adult is assumed (owner AGE-UNK-1, 12 Oct).** *The picture:* the age box is empty, so the app
treats the patient as a grown-up. This is a step inside the usual ranking, not an override of it: website values still
come last and samples of patients seeking treatment after every other sample (P37-FIRST); within what is left, papers
that measured adults come before papers of children only. So a children-only paper is used when no ordinary paper of
the population has adults — even if a website or a treatment sample does. In the chosen paper the adult row is used (a band spanning 18
counts as adult, AGE-3; if the adult rows start above 18, the youngest adult row). The source line says "age not
entered — adult norms assumed". That is a different note from "age unknown; the oldest printed row was used", which
still marks a child's row standing in when the chosen paper has no usable adult row; that stand-in has its own flag,
`age-unknown-oldest-row` (since T4-1, 12 Oct; it used to share `age-mismatched`, which means "the nearest age to the
patient's" and needs an age). A row with no age band (Steiner's ideals) gets no note: it holds for every age.
*Against the literature:* a Chinese patient's interincisal angle with no age entered was compared with Miao 1995's
9-year-old boys (122 ± 6°) — the largest Chinese sample, but children only for this angle; now with Fu 1975's adults
(Beijing, 18–40 y, 125 ± 8°), which outranks Zheng 2026's adults (123.2 ± 8.6°) by sample size (144 against 120).
*What it cannot show:* a child whose age was simply not typed in is compared with adults, and the angles and lengths
that change with growth will read off-norm. The note on the source line is the only warning; entering the age gives
the right row. When the date of birth is entered but the film date is not, the same adult row is used and the words name the
missing field instead: "film date missing — adult norms assumed" (owner FILMDATE-1, 12 Oct; flag `film-date-missing`),
so a clinician who sees the date of birth filled in is pointed at the film date, not told the age was never entered.

**Second-hand and first-hand papers rank the same way: sample size decides (owner SH-1, 8 Oct).** A set quoted
second-hand from a compilation (Moate & Darendeliler 2002's Chinese studies) is not ranked below a paper read first
hand. So a Chinese man of 30 is compared with Miao 1995's adults (209 people, via Moate) rather than Zheng 2026's
(120), because both cover his age and are class-I balanced samples. The source line always says "quoted second-hand
via …", so the reader can see it. What this cannot tell you: the sample size compared is the whole study's. Miao's 209
are spread over four ages and both sexes, so the row actually used stands on far fewer people, and a compilation
prints rounded values (whole degrees and millimetres).

## Upper lip strain (#79) changed sign on 8 Oct 2026 (owner LIP-2)

**Before 8 Oct 2026 the app computed #79 as #78 − #77 (the thickness at the vermilion minus the basic
thickness); from 8 Oct it computes #77 − #78, Holdaway's direction.** The same lip now reads with the
opposite sign: a strained lip that read −1.5 mm in an export made before 8 Oct reads +1.5 mm after it.
Anyone comparing old exports with new ones must flip the sign of the old #79 values.

Picture the upper lip in profile: Holdaway measures how thick it is near its base (about 3 mm below
point A, #77) and how thick it is at the red of the lip (#78). When the lip is stretched over
proclined incisors it thins at the vermilion, so basic minus vermilion grows. Holdaway's normal is
about +1 to +2 mm (Alcalde 2000's whites 1.50; Lew 1992 via Moate, Table VI, 1.5 ± 1.5), and every
paper on file prints the strain that way, positive. With the old sign every paper's strain was the
wrong way round, so none could be used (Alcalde 2000 and Lew were marked `different`). After the flip,
Alcalde 2000 is `same` and Lew is `close` (owner LIP-3; Moate also prints a doubtful "14" for Lew).

What it cannot tell you: the strain is a difference of two thicknesses, each with its own landmark
error (the lip drape point and the vermilion are placed by hand), so its spread is wide (SD about
1.5–2.7 mm against a mean of 1.5–2.6).

## "Upper lip thickness" is the basic thickness, #77 (owner LIP-4, 12 Oct 2026)

Picture the upper lip in profile again. #77, the **basic** thickness, is measured near the lip's base,
about 3 mm below point A, from the bone to the skin. #78 is the thickness at the **vermilion**, the red
of the lip, from the front of the upper incisor to the lip's outer edge. Holdaway's standards put the basic
thickness at about 15 mm and the vermilion thickness at about 13–14 mm (Holdaway 1983 via AlBarakati 2012).

Papers that print Holdaway's analysis often give one row headed "upper lip thickness" with no landmarks.
Every such row is entered as **#77** (basic), `close`: Alcalde 2000 (Japanese, 15.11 ± 2.48, Table II p. 87)
and Lew 1992 via Moate (Chinese, 15.0 ± 1.5, Table VI p. 24). The evidence is Alcalde's own comparison
column for whites: 15.0 for this row and 1.5 for the strain. Since the strain is basic minus vermilion
thickness, 15.0 − 13.5 = 1.5 only works if the 15.0 is the basic thickness. AlBarakati 2012 restates
Alcalde's value under a vermilion label; that is why the rows are `close`, not `same`. Until 12 Oct
Alcalde's value was entered as #78, so a Japanese patient's vermilion thickness (typically 11–14 mm) was
compared with 15.11 and read about one SD thin when it may have been normal.

What it cannot tell you: neither paper says where it measured. If a paper did in fact measure at the
vermilion, its "upper lip thickness" compared with the basic thickness reads about 1.5 mm (one strain)
too thick. A test (`sets.test.ts`, "every entry labelled with Holdaway's printed row") keeps every set
on the same reading.

## The NUS (NDC) sheet is also the Singapore population's norm

The NDC teaching sheet (`singapore-nus/ndc-sheet.json`) is the NUS analysis's own norm (`kind:
analysis-own`) and sits in the `singapore-nus` population. So when a case's population is set to
Singapore (NUS), every analysis that measures one of its 17 rows (Steiner's SNA, for example) is
compared with the sheet: SNA 83.4 ± 3.5, not Steiner's 82. This is intended (the spec lists the sheet
under populations) and is pinned by a test. What it cannot tell you: the sheet does not say who was
measured, how many, or at what age; it is a teaching standard, not a described sample.

## Second-hand sets cite the original author

A set that restates another author's norms cites that author and names the paper that carried them in
`secondHand.via`, so the source line reads "Holdaway 1983 … quoted second-hand via AlBarakati". Jarabak's
own norms, printed by Alshahrani et al. 2018 beside their Saudi values, cite Jarabak & Fizzell 1972
(owner ruling 12 Oct); before that the line began "Alshahrani 2018", which could be read as the Saudi sample
(`saudi/alshahrani2018`, a different set with different values).

## `ageRows: 'interpolate'` — values printed at single ages (owner ruling R-1, 8 Oct; ruling P38)

Some authors print a norm at single ages rather than for age groups: Ricketts 1981 gives the facial
angle at ages 3, 6, 9, 12, 15, 18, 21 and 24, nothing in between. Such a set carries
`ageRows: 'interpolate'`, and each of its entries has `ageBand: [a, a]` — the one age the author
printed. A row that the author says holds for every older age (Ricketts' facial angle "by adulthood …
about 90°", p. 127) is written as an open adult row `[a, 99]`; it counts as the point `a` and is used
for every age after it. The validator refuses any other band shape in such a set.

What the resolver does with a patient's age:

- **On a printed age** — that row, as printed, no flag.
- **Between two printed ages** — a straight line between them: an 8-year-old's facial angle is the
  age-6 value plus two thirds of the step to the age-9 value. The mean, the SD and both ends of a range
  are interpolated, each only when both rows have one (an SD on one row only gives no SD — never one
  number made of two kinds). Flagged `interpolated`; the age row reads "8 y (interpolated 6–9 y)" and
  the source line "interpolated between Ricketts 1981's ages 6 and 9".
- **Before the first printed age, or after a last row that is not open** — the end row, flagged
  `age-mismatched`. Nothing is extrapolated.
- **Age unknown** — the usual adult rule (the youngest row from 18, or an open adult row), marked "age not entered — adult norms assumed" (AGE-UNK-1); no interpolation.

The patient's series is, at each printed age, the row of the patient's own sex if there is one, else
the pooled row (never the other sex's): a boy of 16 is interpolated between Ricketts' pooled age-15 row
and his men's age-18 row. With the sex not recorded, each sex's series is interpolated first and the two
are then averaged (SEX-AVG-1); in Ricketts 1981 the adult women's rows copy the men's, so the copied
series is used as it is, not averaged (P9).

Interpolation uses the patient's exact (fractional) age at the film date — an 8-year-9-month-old
patient is age 8.75, not 8 — while a set with age bands (every other set) places a patient by
completed years, so that same patient is simply "8" for band lookup (P12).

**What an interpolated value can and cannot tell you.** It is a number the author did not print,
computed between two he did. It is exactly right only if the measurement changes evenly between his two
ages; Ricketts himself describes his values as changing at a steady rate (1° every three years for the
facial angle), so for his tables the straight line is his own model. It cannot show a growth spurt
between the printed ages, and the SD used is his stated clinical deviation, not a spread measured at
that age.

## `fromOtherSex` — one sex compared with the other's printed values (owner ruling R-2, 8 Oct; P38)

Ricketts prints his adult rows (18 and over) for men only. The owner ruled that adult women are compared
with those values rather than with a child's row. Each such row is copied as a women's row with the same
age and values and `fromOtherSex: 'M'` (the sex whose values it repeats), with a `note` saying why; the
validator requires the note and refuses `fromOtherSex` on a pooled row or naming the row's own sex. The
resolver flags it `other-sex-values` and adds the note's first clause to the source line ("Ricketts
prints adult values for men only"). What it cannot tell you: whether the author's women would have
matched his men — it is a comparison with men, said as such.

## Sex not recorded — men's and women's rows averaged (owner SEX-AVG-1, 12 Oct)

**The picture.** A patient's sex is not entered, and the chosen paper printed one table for men and one for women
but no table for both together. Imagine pouring the paper's men and its women at the patient's age into one room, the
same number of each, and measuring everyone. The norm is that room's average, and its SD is that room's spread.

**What is compared with what.** The patient's value, against the men's row and the women's row the paper prints at the
same age (the rows a man or a woman of that age would get), mixed half and half. Mean = (men + women) / 2. SD =
√((SD men² + SD women²) / 2 + ((mean men − mean women) / 2)²): the two spreads, plus the gap between the sexes. Marked
"sexes averaged" in the source line. A row printed for both sexes at that age always wins, since it is the paper's own
figure (P7) — including when the patient is outside every band and the paper printed a both-sexes row at the same
band as the men's and women's rows (equal distance: the paper's own figure wins, ruling T3-1). Only ages printed
for BOTH sexes are used: Miao 1995 (Chinese, via Moate 2002) prints interincisal for boys at 9 and girls at 9 and 13,
so for an unknown sex only its age-9 pair is usable — never a 9-year-old boy mixed with a 13-year-old girl — and the
set chosen is the one a boy or a girl gets (ruling T3-3). If either row's SD is borrowed from another paper (`sdSource`), the
average keeps an SD only when both rows borrow from the same paper; otherwise it has none of its own and the usual
borrowed-SD rule (B-1) finds one, named in the source line (P11, T3-2). Where the two rows carry different
definition notes or clinical targets, both are kept, each named "men's row: …; women's row: …". A row copied from the other sex (Ricketts 1981's adult women, `fromOtherSex`) is never averaged with the
row it copies; the copy is used, marked "other sex's values" (P9). Interpolated sets interpolate each sex first, then
average. Enlarged-film mm are averaged as printed, then divided by the enlargement.

**The owner's worked example.** Men −4 ± 2, women −6 ± 2 → mean −5; SD √((2² + 2²)/2 + ((−4 − (−6))/2)²) = √(4 + 1)
= √5 = 2.236. Each sex alone spreads 2 either side; the mixed room spreads further (2.24) because half of it sits
1 unit above the centre and half 1 unit below.

**Against the literature.** Thilander et al. 2005 (Swedish, Tables 5–6) print n–gn (anterior face height) at 31 years as
132.5 ± 4.6 mm for men and 118.3 ± 6.0 mm for women, on film enlarged 10%. A 30-year-old of unknown sex is compared with
114.0 ± 8.1 mm at true size: between the two sexes (120.5 and 107.5 at true size), with an SD wider than either
sex's own because the gap between them (14 mm as printed) is part of the spread. For SNA, where Thilander's sexes nearly agree
(82.7 ± 3.7° and 83.5 ± 4.1° at 16), the mix is 83.1 ± 3.9°, close to either.

**What it cannot show.** It is a 50/50 mix, so for a measurement where men and women differ a lot (face heights, lip and
nose lengths) it sits between both and its SD is wide: a woman with a short face and a man with a long one can both
read "within 1 SD" when each would be flagged against their own sex's row. It also assumes an equal number of each sex,
whatever the paper's sample held. Recording the sex gives the exact norm; the averaged norm is a stand-in for a missing
entry, not a norm for a population of mixed sex. And it inherits the paper choice a man or a woman would get, so the
two can only differ in the row, never in the paper.

## No norm in the case's population — Auto, or you choose (owner N-A1 to N-A5 and AUTO-Q6, 19 Oct 2026; was NORM-PICK-1)

**The picture.** The case is set to a population (or the clinic default is one), and that population's papers never
measured this angle or distance. The row is filled automatically ("Auto"): the analysis's own norm (Steiner's, Ricketts'
…), else the Caucasian sample with the most people in the row the patient is compared with, among those with a row for
the patient's sex and age (the nearest age when none has; ties to the newer paper, then the usual order), else the same
choice among every other population's papers (owner AUTO-Q6, "best evidence anywhere"). The
source line ends "Auto (no Saudi norm)"; a ◆ beside "Auto" marks it in the row's norm list too (Task 6, present); the report marks every such row with a ◆ and names it in a footnote under the tables, and the tidy CSV's `norm_auto` column says which step filled it (tidy only). Clicking the norm lists Auto first (marked ◆, and marked as the source in
use when nothing else is chosen), then every other
source that has the measurement —
the other populations, the analysis's own norm, your own norm sets — each with its value and the row you would be
compared with (who, its age band and its n — both rows' n when men's and women's rows are averaged; ruling FR-1). The
one you click is saved on the case, for that population and that measurement only, and wins over Auto: the cell shows
that source's norm, marked **"chosen by you"**, and that source is marked as in use in the list. Clicking "Auto" removes
the stored pick (nothing is stored for "Auto" — N-A2) — so the cell and the list both show Auto in use again, even
closed and reopened.

**When Auto has nothing.** Only when your own norm sets are the sole source of the measurement does the cell say **"no
Saudi norm — choose one"**, with no number and no colour, as before (your own norms are never used without your choice,
NORM-PICK-1). With nothing anywhere: "No norm". The Compare-populations window never uses Auto or a choice: each column
is that population's own norm, or "—" (ruling AUTO-Q7, 19 Oct 2026).

**What is compared with what.** The patient's value against the source used, resolved exactly as if the case were set to
it (its own age row, sex row, film-scale and SD rules). A choice made for "no Saudi norm" never answers "no Japanese
norm". Unchanged: a case with no population at all uses the analysis's own norm — the default then, not Auto — and your
own norms when the analysis has none.

**Against the literature.** Eastman's SN–MxP for a Saudi adult: no Saudi paper has it; Auto uses Eastman's own norm,
8 ± 3° (Alassiry 2022, quoted second-hand). The list also offers Thilander 2005 (Swedish, 29–32 y, measured to the nasal
line sp–pm rather than ANS–PNS, "close") and the NUS sheet (Singapore teaching, 7.5 ± 3.5°).

**What it cannot show.** Auto's norm is another group's: it says how the patient compares with that author's target or
with Caucasians or another population's study, not with Saudis. Nothing in the app judges whether that is a fair stand-in. What the comparison can and
cannot tell you is in `docs/norms/SEVERITY.md` ("Auto norms"). Before/after: only former "choose one" rows changed; every
other result is bit-identical (`docs/norms/evidence/2026-10-19-norms-auto-before-after.md`).

For a Saudi man of 30 at 9°: 0.3 SD above Eastman's 8 ± 3° ("within normal range"), but 1.04 SD above Thilander 2005's
Swedish men of 29–32 y, 6.4 ± 2.5° (n = 11) — "Mild", one star. The source chosen changes the grade.

## `status: "website"` — values from a web page, not a paper (owner N4; Task 8, 8 Oct)

Four analyses (Björk–Jarabak, ABO, Nagasaki, Radney) and Kim's combination factor and extraction index
have no paper on file, so their norms come from [source removed] (and one Björk–Jarabak ratio, #44, from [source removed]
Dental). Picture it as a number copied off a teaching web page: it says where the middle of "normal" is,
but nothing about who was measured — no sample, no sex, no age, and the page never says whether its "± x"
is a standard deviation. So these values are shown, marked "website value, not from a paper", and never
coloured; a website entry never borrows an SD from a paper, and a paper never borrows one from a website.
A paper's value always beats a website's for the same measurement.

What a website value cannot tell you: how far from normal a patient is in SD terms (no z-score), whether
the value suits the patient's population, age or sex, or even whether the page measured the same thing —
onfile constructs gonion on its Björk–Jarabak page (the app uses the AI's anatomical gonion, so those rows
are `close`), writes the ABO mandibular plane as "Go–Me" without saying which gonion, and defines its ODI
differently from Kim 1974, so its combination factor is not the app's sum (`close`). Some pages repeat
each other's numbers (Nagasaki's skeletal rows equal the ABO page's) or print two rows alike (Radney's
U1–NA° and L1–NA° are both 22 ± 2); these are kept as printed, with a caveat.

Plausibility check (ruling P15): a degree norm outside −90…200° is refused as a likely slipped decimal
point, except #39 Björk's sum of angles (saddle + articular + gonial, about 396°), which has its own window
of 300–450° with SD at most 20.

## A measurement used to pick the sample is not a norm (ruling P45, 8 Oct; checked for every set in Task 11)

Some papers choose their people by a measurement: Cheong 2024 took only Malay women whose ANB was 1–5°. Picture a
class photo where only children between 120 and 140 cm were allowed in: the average height in that photo is real,
but its spread is not — nobody shorter or taller could appear. A patient 2 cm outside the window would look
"abnormal" against that narrow spread although many normal children are that height. So when a paper states a
numeric inclusion range for a measurement, that measurement is **not entered** as a norm; its printed value goes in
the set's `caveats` instead (Cheong's ANB 3.15 ± 0.77°).

On 8 Oct every population set was checked against its paper's inclusion criteria. None enters a measurement it was
selected on. Numeric criteria exist in Cheong (ANB), Caballero-Purizaga (ANB, FMP, overjet, overbite), Thilander
(overjet and overbite 1–3 mm), Gu 2011 (spacing and midline under 1 mm) and Zheng 2026 (an expert harmony score);
none of those measurements is in its set. Re-verified by the Task 11 reviewer (12 Oct) reading the JSON directly,
spot-checking 8 of the 29 sets.

**Full table (re-derived 12 Oct from each set's own `caveats`/`sample.selection`).** "Criterion measurement(s)"
names the catalogue id(s) the paper used a number on to pick its sample, where one exists; "verdict" is `not
entered` when that id (or everything it could map to) is absent from the set's entries, or `no numeric criterion`
when the paper's selection has no number on a catalogue measurement (a word-only selection such as "Class I" or
"balanced profile", or a numeric cutoff on something outside the catalogue, e.g. spacing, midline or an expert
harmony score).

| Set id | Criterion measurement(s) | Verdict |
|---|---|---|
| baileytaylor1998 | — | no numeric criterion |
| obamiyi2019 | — | no numeric criterion |
| gu2011-caucasian | — (spacing, midline; not catalogue ids) | no numeric criterion |
| mcnamara1984-annarbor | — | no numeric criterion |
| mcnamara1984-bolton | — | no numeric criterion |
| mcnamara1984-burlington | — | no numeric criterion |
| gu2011 (chinese) | — (spacing, midline; not catalogue ids) | no numeric criterion |
| moate2002-chan1972 | — | no numeric criterion |
| moate2002-chen1985 | — | no numeric criterion |
| moate2002-cheng1986 | — | no numeric criterion |
| moate2002-cooke1989 | — | no numeric criterion |
| moate2002-fu1975 | — | no numeric criterion |
| moate2002-lew1992 | — | no numeric criterion |
| moate2002-lou1981 | — | no numeric criterion |
| moate2002-miao1995 | — | no numeric criterion |
| moate2002-so1990 | — | no numeric criterion |
| moate2002-wei1968 | — | no numeric criterion |
| moate2002-yen1973 | — | no numeric criterion |
| wu2007 | — | no numeric criterion |
| zheng2026 | — (expert harmony score < 3.30; not a catalogue id) | no numeric criterion |
| alcalde1998 | — | no numeric criterion |
| alcalde2000 | — | no numeric criterion |
| caballero2019 | m03_ANB, m22_FHMPt, m68_Overjet, m69_Overbite (selection); m14_APDI, m15_ODI entered with narrowed spread | not entered |
| cheong2024 | m03_ANB | not entered |
| mohammad2011 | — | no numeric criterion |
| norman2020 | — | no numeric criterion |
| albarakati2012 | — | no numeric criterion |
| alshahrani2018 | — | no numeric criterion |
| thilander2005 | m68_Overjet, m69_Overbite | not entered |

What this cannot tell you: a sample chosen by words — "skeletal Class I", "balanced profile", "normal overjet" — is
also narrowed, only by an unstated amount. Most norm papers select that way, so their SDs for ANB, the profile
angles and the incisor overlaps are likely somewhat smaller than in the general population. Caballero-Purizaga's ODI
and APDI are the clearest case: they were not selection criteria but depend on ones that were (the mandibular plane,
overbite, the A–B relation), and its APDI SD of 1.71 is less than half Kim & Vietas's 3.79.
