# The cross-check: what was tried, what it showed, and what the learning record can and cannot tell you

Written 15 Oct 2026, for an orthodontic researcher reading the app's output or a case built from it. It does not
assume you can read Rust or TypeScript. Where a number is given, its source — a commit, a report, or a file — is
named so it can be checked again later.

## 1. The cross-check was tried and parked (15 Oct 2026)

**The picture.** Imagine two experienced colleagues each mark Gonion on the same film, without seeing each other's
marks. Each also draws a small oval around their mark — "I'm sure it's somewhere in here." On a sharp corner the
oval is a small circle; along a smooth curve, like the angle of the mandible, it is a long thin oval lying along
the bone, because they are sure *which* edge but less sure *where along it*. Two marks "agree" if each sits inside
the other's oval — so two marks 2 mm apart *along* the jaw border can still agree, while two marks 1 mm apart
*across* it may not. The idea was to flag a landmark for you to look at first whenever the two marks did not agree.

The two colleagues in the app are two of its four AI models: **SRPose** and **Aariz**. (Two other models, GU2Net and
cwlachap, are still drawn as faint grey "ghost" marks on screen, but they do not vote — trained on one film
machine only, they get lost badly on films from any other machine, so including their vote would have flagged the
wrong points. Owner ruling VOTERS-2, 15 Oct 2026.) The point actually placed on your film is Aariz's mark for all 19
original points: **cwlachap keeps none of the 19** (ruling TABLE, §4 below). Another installed model fills in a point
only where Aariz gave none on that film. The cross-check only asked whether the two voters agree with it.

**The planted control.** Before trusting any tuned result, the pre-registered rule required a sanity check: take
about one point in ten, move it 5 mm on purpose (a deliberately wrong mark), and confirm the check flags *more
than half* of these obviously-wrong points. **It flagged 92 of 213 (43%) — a fail.** By the rule signed off in
advance, an instrument that cannot see an obvious, known error is "blind", and none of its other numbers count.
(Source: the local task-7 report; commits `54be75e`, `730aef5`, `6649d5a`,
`c1673b3`.)

**What it caught anyway, for the record (not a passing result — the instrument above was already ruled blind).**
Tuned and measured on the same 98 films used to tune it (so a best case, not a fair test): of 399 points more than
2 mm from the truth, the check caught 0.21 of them while flagging 0.105 of all points checked, AUROC 0.686.

**The ceiling.** To find out whether any version of "do the two models disagree" could ever work here, a separate,
after-the-fact diagnostic (not a pre-registered result; it changes nothing that shipped) tried the simplest
possible score — the plain distance between SRPose's mark and Aariz's mark, with no oval at all. Even this best
case catches only **0.511** of the really-wrong points at a 30% flag rate, AUROC 0.692 [95% CI 0.665, 0.719]. Your
pre-registered pass mark was 90% caught at no more than 30% flagged — nowhere close.

**Why.** Of the 399 points where Aariz was more than 2 mm off the truth, SRPose erred **on the same side as Aariz
on 201 of them** — the two marks point in much the same wrong direction, within 90° of each other — and only on
about 109 of the 399 (27%) was SRPose clearly right where Aariz was wrong. Two colleagues who are usually drawn to
the same misleading shadow on the film will usually agree with each other even when they are both wrong, so a
disagreement check has little left to catch.

**Against the literature.** The usual pass line for "did the model find the point" is **2 mm** — the "successful
detection rate at 2 mm", used since the ISBI 2015 challenge. It is commonly cited to Wang, C.-W. et al. (2016),
"A benchmark for comparison of dental radiography analysis algorithms," *Medical Image Analysis* 31, pp. 63–76
(DOI 10.1016/j.media.2016.02.004; confirmed from the article's own indexed citation record, PubMed ID 26974042).
**The specific page inside that range was not checked this session** — the full text sits behind a journal
paywall this session could not reach — so no page number is given here; please treat the citation as
article-level only until someone with access confirms the page. Aariz's own mean error on these films is about
1.1–1.3 mm, comfortably inside that 2 mm line, which is exactly why the 399 points that are genuinely off matter
so much, and why a check that misses most of them is not a small gap.

**What would make these numbers wrong, and so the conclusion too optimistic or too pessimistic:**
- They are **in-sample** — tuned and scored on the very same 98 films. A genuinely new film would likely do worse,
  not better, so this is not a reason to expect a better real result.
- They rest on scale rule `aariz-scale/1`: 52 of 150 Aariz validation films were left out because their true pixel
  size could not be trusted, and the two ProMax machines (26 of the 98 kept films) use the dataset's stated pixel
  size, 0.139 mm/px, rather than that make's own file header, 0.128 mm/px — an open question (§5). If the header is
  right, ProMax distances read about 9% too long, which would move some points across the 2 mm line in either
  direction.
- The "truth" on these films is itself the average of a senior and a junior orthodontist's own marks — some of
  the 399 "off" points may be where the two human markers disagreed, not where the model was wrong.
- SRPose and Aariz were trained on slightly different definitions of Orbitale, Porion, Gonion and the lip points
  (0.5–1.5 mm apart by convention, not error). Part of what looks like disagreement is really two different
  textbook definitions, which makes the flags noisier — it does not explain away the *shared* errors above.

**The decision (owner ruling PARK-FLAGS, 15 Oct 2026, first-hand, binding).** The flags, the review screen, the
rings/spokes/chips/counts and the "experimental" label are **parked** — nothing on screen will flag a point
because two models disagree. Kept, because they cost nothing to keep and may be useful again: Aariz as the main
model with its per-point source table, the corrected Aariz pixel scale (`aariz-scale/1`), the engine that keeps
each model's heat-map spread, the rule code, and the bench tooling that tunes and scores it. The validation test
films (Aariz test, Ceph-400 Test2) were never opened and stay closed — nothing about the cross-check was tested on
them, because there was nothing worth testing once the tuning run failed its own planted control. **If the flags
ever return, it needs a new, dated pre-registration and a voter whose errors are independent of Aariz's** — for
example the owner's own trained model (Part G), checked for that independence first, before any run.

## 2. What a disagreement check cannot show

This is the one sentence to keep in mind whenever two AI marks on a film agree: **"the models agree" never means
"the point is right."** A disagreement check, however well tuned, can only flag an error that the two voters make
*differently*. An error they make the *same way* — both drawn to the same misleading shadow, the same double
contour, the same ear-rod reflection — produces two marks that sit right on top of each other, which is exactly
what "agree" looks like on screen. On these films that was true for about half of Aariz's real misses (§1). No
amount of re-tuning changes this; it is a property of what two correlated models can see, not a bug in the
arithmetic.

## 3. The learning record

**The picture.** Every time you verify a point (accept it, move it, or place it yourself), imagine the app quietly
writing one line per model that ran on that film: "On this landmark, on this film, this model's own guess was
*this far* from where you actually put the point." Nothing on screen changes because of this — no flag, no colour,
no number — it is a private ledger, building up behind the scenes, for later use (Part F: picking the best model
per point from your own verified cases; Part G: training your own model).

**What is compared with what.** **Your own final point** — the one you verified or placed — against one guess from
each model, on the same film and the same landmark. Which guess depends on the model (corrected 15 Oct 2026 after the
final branch review; built in commits `74a77e8` and `e31a4f5`):
- **The model that placed the point:** the guess it made in **the run that placed it**. Picture the AI's mark you
  started from, before you touched it. Accepted unmoved, the distance is 0 (see below); moved, it is how far you moved
  it. Re-running that model later does not change this row.
- **Every other model:** its **newest run on this film made with the film's current facing** (left or right). Picture
  each other model's latest mark, but only from a pass where the film was the right way round. A run made while the
  film faced the other way is never compared: it is like tracing a film put on the light box back to front, and its
  marks land far away (GU2Net and cwlachap 76–90 mm off when mirrored). Recording that
  as the model's accuracy would be wrong. A model with no run in the current facing has no row on that film.

Not against any "ground truth" file; your own clinical judgement, as recorded in your own library, is the reference.

**Numbers to read it against.** On public films a good model is about 1 mm from expert marks: Aariz's mean error on
the Aariz test films is 1.17 mm averaged over its 26 points (`reference/model-scores.json`, on the dataset's
uncorrected scale), and the field's usual success line is 2 mm (Wang et al. 2016, §1). So a row of 1–2 mm is an
ordinary guess. A row of tens of millimetres is not "a bit off": GU2Net and cwlachap, trained on one machine only,
average 21.1 mm and 7.6 mm over the 19 points on Aariz validation films (same file). Rows like that say the model is
lost on that kind of film, not where a point is hard to find.

**Units.** The distance is stored in film pixels, always exact, and in millimetres, exact only when the film
carries a ruler (a calibrated scale). A film with no ruler stores an **assumed** 0.1 mm per pixel and marks the row
as assumed, so a report built from these rows can show "≈" rather than claim an exactness it does not have.

**What it cannot show — read this before trusting any summary built from it:**
- **A point you accepted without moving it makes the placing model look perfect by construction.** If you accept
  Aariz's mark exactly as placed, Aariz's distance for that row is 0 mm — not because Aariz was necessarily right,
  but because you did not move it. That measures agreement, not accuracy. Every row records *how* your final point
  came about — accepted unmoved, moved, or hand-placed — and whether that particular model was the one that placed
  it, specifically so that a later "which model is most accurate" table can set the accepted-unmoved rows apart
  rather than averaging them in.
- **Re-running the placing model does not change its row; re-running any other model replaces that model's row**
  (with the new run's numbers, if the run was made with the film's current facing). The stored model fingerprint
  (its weights SHA-256) says which exact version of the model was actually measured, so a table built later can tell
  two different versions of "Aariz" apart.
- **A run made with the other facing is left out.** If a film was turned round (Re-detect re-checks the facing) and
  one model did not run again, that model's old pass is ignored; its row comes from its newest pass in the current
  facing, or there is no row. The placing model's row needs its placing run in the current facing too.
- **"Who" and "when" on a row mean who last rebuilt the rows, not who verified the point.** Every save, "Mark
  tracing verified", model run or calibration rebuilds all of the case's rows and stamps them with that person and
  that time. To know who verified a point and when, read the point's own history (`landmark_events`).
- **Cases verified before this record existed (schema 10) have no rows** until their next save, sign-off, model run
  or calibration. Nothing is filled in backwards.
- **A machine set later is picked up only at the next write.** Assigning a film's machine in film layouts does not
  rebuild the rows: they keep "unknown" (or the old machine) until the case is next saved, signed off, run or
  calibrated.
- **"How" follows the point's source.** A point you dragged away and then dragged back exactly onto the AI's mark
  still reads "moved", at 0 px. So "moved" means "touched", not "ended somewhere else"; use the distance for that.
- **A film machine recorded as "unknown" pools unlike films together.** The film's machine comes from your film
  layouts; where that is not known, the row is machine "unknown" rather than a guess, and any table grouped by
  machine should treat "unknown" as its own, uninformative group, not silently drop it or lump it with a named
  machine.
- **Old cases' placing model is a lookup, not a stored fact.** For a case traced before this schema change, the
  point's stored `placed_by` stays empty. Only the record's "this model placed it" flag uses a lookup: it matches the
  AI position kept on the point to a stored run's raw output, exactly. That is a best reconstruction, not a record
  made at the time.

## 4. The main-model change (13–15 Oct 2026)

**What changed.** New films are now traced by **Aariz** rather than cwlachap. `reference/main-point-source.json`
decides, for each of the 19 original cephalometric points, which model places it; the table was decided on 98
Aariz validation films (the ones with a trustworthy pixel size, rule `aariz-scale/1`), following a rule written
down and committed *before* the decision run (owner O6, "worse" rule, §5.2 of the design spec). The decision:
**Aariz places all 19 original points; cwlachap keeps none** (table committed `cbd1d7d`, SHA-256
`98b13903…93e8`, decided at `dc7910d`, approved by the owner, ruling TABLE, 15 Oct 2026).

**Never confirmed on the Aariz test films.** The table above was decided on *validation* films only, with a second
confirmation step on the held-back *test* films planned for Task 8. **Task 8 was cancelled** when the cross-check
itself was parked (owner ruling PARK-FLAGS), so that confirmation never happened. The table is approved and in use,
but it has not been checked against films it was not decided on.

**What this means for a study that pools cases from before and after the switch.** Cases traced before this change
were placed by cwlachap; cases traced since are placed by Aariz. **Any study that pools cases across this date is
pooling two different placing models for the same 19 points**, which is itself a source of systematic
disagreement between groups unrelated to any clinical difference. Each point's own source line on screen names
which model placed it. In the library, the stored `placed_by` field records it for every AI point placed from schema
10 onward (new films and Re-detect); points of cases traced earlier keep it empty, and only the learning record's
lookup (§3) stands in for it. So for new cases this can be checked rather than assumed; for old cases it is a
reconstruction. An existing case opened, closed and reopened keeps
its original placing model; only an explicit Re-detect would place it again under today's table.

## 5. Where the numbers live

- Local task report with the full numbers and every control:
  the task-7 report (not in git; commits `54be75e`, `730aef5`, `6649d5a`,
  `c1673b3`).
- `reference/model-scores.json` — every model's measured accuracy, by dataset split and leakage status.
- `reference/main-point-source.json` — the per-point source table (committed `cbd1d7d`).
- `reference/crosscheck.json` — the cross-check's own parameters, left at `crosscheck/0-draft`,
  `"testResult": "not-run"`. No flag uses it, but the app does read two of its values: the learning record's
  assumed 0.1 mm per pixel (`assumedMmPerPx`) and the window over which each detection's spread is measured
  (`spreadWindowCells`). Its `status` text ("tuned on Aariz valid in Task 7 and approved by the owner before Task 8")
  was written before PARK-FLAGS and describes a plan that was cancelled; the file is pinned, so the text is left as
  it was.
- The two pre-registration documents (the "worse" rule and the pass rule with its tuning rule), committed before
  any run that used them, unchanged as the record of what was fixed in advance.
- The Aariz pixel-scale rule, `aariz-scale/1`: on Aariz validation films, 98 of 150 are used (ART Plus 55,
  Hyperion X5 5, ProMax 2D 6, ProMax with ProTouch 20, Rotograph EVO 12); 52 excluded (Hyperion X5 16 — 12 default
  resolution, 4 no resolution in its file header; Smart3D 9; Veraviewepocs 27, no source of true scale); 0 films
  flagged for an implausible skull size (S–N outside 45–95 mm). Source: `crates/ceph-bench/src/scale.rs`; counts
  from `task-7-report.md` "Exclusion counts".
