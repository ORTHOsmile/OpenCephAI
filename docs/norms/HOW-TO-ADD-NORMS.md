# How to add a norm set to CephTrace

For people and for AI agents. Written 8 Oct 2026, after Part C put the first 40-odd sets in.
What each field *means* is in `reference/norms/sets/README.md`; this page is the *process*.

A **norm set** is one source's values (one paper, one sample, one web page) as a JSON file in
`reference/norms/sets/<population>/<id>.json`, with the citation, table and page for every number.
The app looks a patient's measurement up in these files (`packages/analyses/src/norms/resolve.ts`).

---

## The rules that never bend

1. **Every number comes from the source itself** — read off the table or the page image. Never from
   memory, never from another paper's restatement (unless the set says `secondHand`), never from a
   website (unless the set is `status: "website"`).
2. **Two independent readings.** Two people or agents extract the same source without seeing each
   other's file. A tool compares them; every difference is settled by looking at the page again.
3. **Papers never go in git.** PDFs live in `reference/norms/local/` (git-ignored). Only the JSON
   with the citation goes in. Never save the text of an article either — record numbers only, with
   their table and page. In notes and caveats say what the paper says in your own words; a short
   quoted label (a row or column heading) is fine. The validator refuses any quoted span of 8 or more
   words in a set's prose fields (owner ruling P44-STRICT, 12 Oct; `MAX_QUOTED_WORDS` in
   `packages/analyses/src/norms/validate.ts`).
4. **Nothing invented.** No SD that was not printed (the app borrows one — see "SDs" below). An
   unreadable digit means the entry is left out with a note saying so.
5. **Owner decisions are the owner's.** Anything that changes a measured number, a threshold or what
   a measurement means goes to the owner as a multiple-choice question first.
6. **Never** open `data/`, `models/`, `reports/` or the app library; never use `npx`; never push to
   GitHub without the owner asking.

---

## Step by step (a person)

1. **Get the paper** into `reference/norms/local/` (a PDF; or a page image for a sheet).
2. **Decide what kind of set it is**
   - `population`: a sample of a people (Chinese adults, Saudi teenagers). Goes under that population's
     folder. Population ids are in `reference/norms/populations.json`.
   - `analysis-own`: an analysis's own published norms (Steiner's ideals, McNamara's norms). Lists the
     analyses it belongs to in `analyses`.
   - Values from a web page ([source removed]) are not a separate kind: they are an `analysis-own` set with
     `status: "website"`. Shown but never coloured.
3. **Extract it twice**, independently, into `reference/norms/local/extract/<id>.a.json` and `.b.json`
   (give both the same written instructions).
4. **Compare:** `pnpm norms:compare reference/norms/local/extract/<id>.a.json reference/norms/local/extract/<id>.b.json`
   - exit 0 = the two agree; exit 1 = differences (listed); exit 2 = the tool's own self-test failed
     (do not trust anything until fixed). Judge by the exit code, not by reading the output.
5. **Settle every difference** against the page (page image for a scan). Record each decision and the
   page in `curation.notes`. A value only one reader found is checked against the page before it stays.
6. **Merge:** `pnpm norms:compare <a> <b> --merge reference/norms/sets/<population>/<id>.json`, then
   fix the prose fields by hand.
7. **Check:** `pnpm norms:check` must exit 0 (it runs the validator over every committed set).
8. **Test first, then commit:** add a test to `packages/analyses/src/norms/sets.test.ts` that fails
   before the set exists (e.g. "a Saudi 20-year-old's saddle angle resolves to this set, with an SD"),
   watch it fail, add the set, watch it pass. Then run the full checks (below) and commit.
9. **Review:** someone who did not extract it checks every entry against the page. Only then is it done.
10. **Records:** a line in the project notes; if the set changes what a measurement can tell a
    researcher, a line in the methods notes too.

### The full checks (all must exit 0)

```bash
export PATH="/opt/homebrew/opt/node@22/bin:$HOME/.cargo/bin:$PATH"
pnpm -r test
cargo test -p cephtrace-desktop -p ceph-infer -p ceph-store -p ceph-bench -p ceph-label -p ceph-model
(cd apps/desktop && pnpm build)
apps/desktop/node_modules/.bin/tsc --noEmit -p packages/analyses
pnpm norms:check
```

Report each as collected / passed / skipped / failed with its exit code. Capture to a log; never pipe
through `tail`.

### Reading a PDF

```bash
swift tools/norms/pdf/pdftext.swift <pdf>                       # the text layer
mkdir -p <dir> && swift tools/norms/pdf/pdfpng.swift <pdf> <dir> 2000   # page images (make the folder first)
swift tools/norms/pdf/ocr.swift <image>                         # OCR, to FIND text only
```

OCR and old text layers drop minus signs and decimal points: every number you keep is read from the
page image. Put page images under `reference/norms/local/extract/pages/` (git-ignored).

---

## The decisions you will meet, and what we decided

| Situation | What to do | Why |
|---|---|---|
| The paper's definition differs from the catalogue's (other points, other plane) | `definitionMatch: "close"` with a note saying how; a different quantity → `"different"` (kept, never used) | The app shows "close" so the reader knows |
| The paper doesn't name its mandibular / occlusal plane | `close`, "plane not stated" — but read the paper's own wording first (Zheng's Table 3 calls Go–Gn "the mandibular plane") | |
| Incisor distances measured from the labial/facial surface | `close` — the catalogue measures from the incisal tip (owner C1) | |
| Film enlargement | `scale`: `enlarged` with the % and page **only** if the paper says its values include it; `true-size` if it says they are corrected; else `not-stated`. Never divide the numbers yourself — the app converts at display (owner M-1, M-2) | Published numbers stay as printed |
| No SD printed | Leave `sd` out (never `"sd": null`). The app borrows the closest matching SD at display time and says so (owner B-1) | |
| The values are ideals or targets, not a sample's average | `centre: "ideal"`; a target that differs from the average goes in `clinicalTarget` (owner B-2, N1) | |
| Ages | A stated range → `ageBand`; one age "12 y" → `[12, 12]`; adults with no upper age → `[18, 40]` with a note; bands of one measurement and sex must not overlap and must not sit beside a band-less row | The validator refuses both |
| Values printed at single ages that change with age (Ricketts) | `ageRows: "interpolate"` — the app works out the value at the patient's exact age between two printed ages (owner R-1) | |
| A paper prints adult values for men only | Copy them as women's rows with `fromOtherSex: "M"` and a note — only when the owner rules it (owner R-2) | |
| Several groups in one paper (normal and malocclusion) | Only the normal/control group is a norm; the others go in `caveats` | A norm describes normal |
| Both pooled and by-sex rows printed | Enter both; the app prefers the patient's sex | |
| A measurement was used to pick the sample ("ANB 1–5°") | Do not enter it as a norm — its spread is cut by the selection; put it in `caveats` | It would make normal patients look abnormal |
| A sample of consecutive patients seeking treatment | `selection: "mixed-occlusion"` — the app ranks it last | Not a norm sample |
| A paper restates another author's norms | A separate set with `secondHand: { via: "<paper, table>" }` | |
| A sheet or source with no date | `citation.undated: true`, no `year` | |
| Several sets for one population | Set order: (1) a paper before a website value; (2) any other sample before a sample of treatment-seeking patients (P37, applied before age, owner P37-FIRST); (3) a set whose ages cover the patient before one that does not (AGE-1) — with no age entered, a set with an adult row (a band from 18, or reaching past 18, or a row with no age band) before one with child rows only (owner AGE-UNK-1, 12 Oct; a step inside this order, after (1) and (2), never ahead of them); (4) among sets that do not, the nearest age (AGE-2; people's populations only); (5) a class-I balanced sample, then the larger sample, then the later paper (undated last). Within the chosen set: the patient's age row first, then own sex over pooled; when the sex is not recorded and the set gives only men's and women's rows at that age, the two are averaged (mean of the means; SD of an equal-sized mixed group), marked 'average of male and female' (owner SEX-AVG-1, 12 Oct; worded 'sexes averaged' until 29 Oct 2026, owner decision 5); a both-sexes row for the age always wins, and a row copied from the other sex is never averaged with the row it copies (rulings P7, P9); with no age entered, the chosen set's adult row is used, marked 'age not entered — adult norms assumed' (AGE-UNK-1). A population chosen with no norm for the measurement and no pick saved: Auto — the analysis's own norm, else the best Caucasian set (bestCaucasian: a row for the patient's sex and age, the nearest age, the most people in the row compared, the newer paper, then the usual order), else the same ranking over every other population (bestStudy, owner AUTO-Q6; never a `kind: "analysis-own"` set filed under a population id, owner ruling Q-T5-1), flagged 'auto-fallback' (owner N-A1–N-A5, 19 Oct 2026); only your own norms have it → "choose one". The Compare window shows each population's own norm or "—" (AUTO-Q7). | |

---

## What is on file but not yet extracted

Nothing (13 Oct 2026): Kim 2025, Alassiry 2022 and Al Maaitah 2022, listed here on 8 Oct, are merged
(`kim2025`, `alassiry2022-eastman`, `almaaitah2022`).
