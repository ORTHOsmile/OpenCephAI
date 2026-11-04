# Pre-registration: the cross-check's pass mark and how it is tuned

Committed 15 Oct 2026, before any cross-check run on real films. Owner rulings O1, O7, Q9, VOTERS-2 and
SCALE-FIX, rule `aariz-scale/1` (cross-check design spec §7, §4 "Spread calibration", §6.2).
Changing anything below needs the owner's OK and a new version.

- Pass rule version: `crosscheck-pass/1`
- Voters: `srpose-cldet23`, `aariz-cepha29` (owner VOTERS-2, 15 Oct 2026). GU2Net and cwlachap never vote.

## What is measured, on which films

- Measured once, on **Aariz test** (150 films), with the values the owner approved after tuning. Also reported, not
  deciding: Ceph-400 Test2, once (SRPose's vote marked leaked).
- A **placed point** is the point on the film for a landmark the truth has: Aariz's, or cwlachap's for the original
  points `reference/main-point-source.json` gives it (Aariz's if cwlachap gave none), or, for a landmark Aariz does
  not place, the first installed model in catalogue order that finds it and passes the 2 mm gate (R-B2, R-B4).
- **Error** = radial distance of the placed point from the truth, in mm at each film's own pixel size **under rule
  `aariz-scale/1`** (owner SCALE-FIX): films the rule excludes are not scored, flagged films are;
  every run records `aarizScaleRule` and its counts (used, excluded by reason and machine, flagged). **Off** = error more than `2.0` mm.
- **Flagged** = review or conflict (with two voters review cannot occur, so flagged = conflict; owner X1: every
  disagreement is a conflict). **Checked** = anything but "not checked".
- **Sensitivity** = flagged ÷ placed points that are off, counting only landmarks at least two voters can detect
  (`reference/crosscheck-coverage.md`; with the two voters above, landmarks **both** voters can detect); an off point
  there that came out "not checked" counts as missed.
- **Burden** = flagged ÷ checked.
- **AUROC** = over checked points, the score is the placed point's largest D² to another voter that answered; the
  label is off / not off. Ties count half.
- Confidence intervals: bootstrap over films, Resamples: `2000`, Seed: `20261013`, SplitMix64, percentile interval
  (as in the main-point-source pre-registration).

## The pass mark (owner O1, fixed)

- Sensitivity at least `0.90`, and the lower end of its 95% interval at least `0.80`;
- Burden at most `0.30`;
- AUROC: the lower end of its 95% interval above `0.5`.

All three must hold. If any fails, the cross-check ships labelled "experimental". The numbers are reported as they
are. Nothing is re-tuned on the test films. The test films are opened once (owner Q9, O7).

## How the values are tuned, on Aariz valid only

1. Window and floor: every combination of window `7, 11, 15, 21` heat-map cells and σ₀ `0.1, 0.2, 0.3, 0.5` mm.
   For each, k is fitted per model (step 2) and every landmark uses T = 5.99; the combination with the highest
   valid AUROC wins (ties: the first in this order — windows in the order listed, and for each window σ₀ in the
   order listed).
2. k for `srpose-cldet23`, `aariz-cepha29` and `cwlachap-hrnet-w32` (the two voters, and cwlachap because it places
   the source table's points): the smallest k (bisection on log k between 0.001 and 1000, 60 steps) at which at least
   `0.95` of that model's points have D² to the truth ≤ `5.99`, the truth having no spread of its own. A point with
   no spread, a spread that is not a real oval, or no usable pixel size is not used for the fit and is counted. If even
   k = 1000 cannot reach 0.95, tuning stops and reports it. GU2Net's k stays 1 (it neither votes nor places a point
   unless chosen as main model).
3. T per landmark, from `2.0, 3.0, 4.0, 5.99, 7.0, 9.21, 11.0, 13.8, 16.0, 20.0, 25.0`: for a landmark with at least
   `10` placed points off on valid, the largest T whose valid sensitivity for that landmark is at least 0.90 (if none
   is, the smallest T); a landmark with fewer keeps T = 5.99.
4. Planted control, first: on a copy of the valid data, about one placed point in `10` (chosen with the seed above)
   is moved `5.0` mm in a seeded random direction; with the tuned values, more than `0.5` of the moved points must be
   flagged. If not, the instrument is blind and no result counts.
5. The tuned values, the valid metrics and the control result go to the owner, who approves them before the single
   test run.

## Decided here, by the plan, for the owner to see in Task 7

The spec left these open. They are fixed here so they cannot be chosen after a result is seen; the owner sees them
with the tuned values in Task 7 and may change them then (a new version of this document, before the test run).

- (a) A point more than 2 mm off that the cross-check could not check counts as **missed** when at least two voters
  (with two voters: both) can detect that landmark. Landmarks only one voter can detect are left out of the catch rate.
- (b) How T, the window and σ₀ are picked: steps 1–3 above.
- (c) "Catch most" of the planted points means more than half (step 4).
- (d) For the k fit, points with no spread, a spread that is not a real oval, or no usable pixel size are left out and
  counted, never treated as the tightest possible spread.
