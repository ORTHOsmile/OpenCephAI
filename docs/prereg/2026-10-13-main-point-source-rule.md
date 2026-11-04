# Pre-registration: which model places each original point when Aariz is the main model

Committed 13 Oct 2026, before any comparison of Aariz with cwlachap was run. Owner rulings O6 and O7
(cross-check design spec §5.2). Changing anything below needs the owner's OK
and a new rule version.

- Rule version: `main-point-source/1`
- Films that decide: Aariz **valid** only (150 films, 7 machines). Neither model trained on them. Aariz test is not
  used to decide, and no cwlachap or GU2Net result on Aariz test is looked at until the confirmation run.
- Points: the original 19 only (`S N Or Po A B Pog Me Gn Go L1T U1T UL LL Sn PogS PNS ANS Ar`).
- Measure: for each point, on each film, the radial error of each model against the truth, in mm at that film's own
  pixel spacing (`spacing.csv`). Then the per-film difference, Aariz minus cwlachap (paired: same film, same point).
  A film where either model gave no point, or the truth lacks the point, is left out for that point and counted.
- Statistic: the mean of those differences, with a 95% bootstrap confidence interval over films.
- Bootstrap: Resamples: `2000`. Seed: `20261013` (the same seed for every point). Generator: SplitMix64. Films are
  resampled whole, with replacement, as many as there are films. The interval is the percentile interval: the draws
  sorted, lower end at index floor(0.025 × m), upper end at index ceil(0.975 × m) − 1, m = the number of draws.
- Rule: Aariz is **worse** on a point only if the whole interval is above zero (lower end > 0). Then cwlachap places
  that point. Otherwise — every tie, every interval touching or crossing zero — Aariz places it.
- Positive control, before the real result is believed: the same code, on a copy of the data where cwlachap's error
  on one point is set 2 mm lower, must name that point. The point is the one whose real mean difference is closest to
  zero (chosen by the tool, printed by name). With nothing planted, two runs must give the same table.
- Confirmation, once, on Aariz test (in the same session as the cross-check's single test run): the same measure and
  statistic per original point. A point given to cwlachap fails if its whole test interval is below zero; a point
  given to Aariz fails if its whole test interval is above zero. A failed point is reported to the owner by name; the
  table is never changed from test results automatically.

## Amendment, 15 Oct 2026 — the pixel scale rule (owner, first-hand: "Yes, amend it")

Made before any decision run (Task 3 Step A6), in its own commit. The rule version stays `main-point-source/1`.

Why: after this document was committed, four machines' Aariz films were found to have been resized before release
without their pixel size being updated (SCALE-INV). The owner settled it with the scale rule **`aariz-scale/1`**
(SCALE-FIX, `crates/ceph-bench/src/scale.rs`, Task 2b). Every Aariz millimetre is now computed under that rule.

What changes, and only this:

- **Films that decide:** Aariz valid, the films the scale rule keeps — **98 of the 150**. The other 52 have no
  trustworthy pixel size and are left out (counted by reason in the decision's output, `aarizScale`).
- **Measure:** the radial error in mm at each film's pixel size **under `aariz-scale/1`**, in place of "that film's
  own pixel spacing (`spacing.csv`)".
- **No minimum film count** (owner ruling, 15 Oct): the rule runs on the films kept, whatever their number.

Everything else above — the 19 points, the paired difference, the bootstrap (2000 resamples, seed 20261013,
SplitMix64, percentile interval), the "whole interval above zero" rule, the positive control and the confirmation on
Aariz test — is unchanged.
