# The whole-film check: what it can and cannot tell you

Written 6 Nov 2026, after both of its tests (SC1-1a on 5 Nov, SC1-1b-PKU on 6 Nov). Rule in the app: **whole-film/3**.
This note is for the person who reads a whole-film note on a film, or a row of its CSV, and has to decide what it means.
The design and the work record are kept by the author. Every number here names its source file; section 7 lists
those files with their SHA-256 values.

## 0. Read this first

- **A quiet whole-film check is not a correct tracing.** It looks for whole-tracing mistakes of about 10 mm or more:
  a face traced the wrong way round, another patient's tracing, a tracing at the wrong size, a whole region on the wrong
  structure. It does not see the 2 mm error, the 5–10 mm miss at one point, or Gonion slid along the border. Those
  belong to the point check (its own note, not yet public), the cross-check and Part F.
- **It is a re-check before you approve the points. It is not a diagnosis.** A note moves nothing and never blocks
  sign-off. A true variant (cleft, syndrome, surgery) can raise a note on a correct tracing.
- **The result, in one paragraph.** The first test (SC1-1a, 5 Nov) **failed**. The check was then improved and tuned,
  openly, on the films that test had used. The improved check (whole-film/3) was then tested once on 102 films it had
  never seen (PKU) and **passed**: it caught 981 of 1,020 planted mistakes (95% interval 94.8–97.3%; needed 969) and
  flagged 0 of 102 correct tracings (95% interval 0.0–3.6%; at most 2 allowed). One run of 102 films is a coarse
  instrument. Section 1 says what that pass can and cannot tell you.
- **It ships switched on** (section 4), in Settings › Checks, "Whole-film check (beta)".

## 1. The two tests, and what happened between them

### 1.1 SC1-1a: failed (5 Nov 2026)

- **Films:** Ceph-400 Test1 (151–300) and Aariz valid (150): 300 films. Truth: the experts' own tracings.
- **Planted mistakes:** 2,740, of 10 kinds (the table in 1.4). Marks: at least 2,603 caught (95%), at most 6 of 300
  correct tracings flagged (2%).
- **Result: FAIL, exit 3.** Caught **2,289 of 2,740** (83.5%; 95% interval 82.1–84.9%). Correct tracings flagged
  **11 of 300** (95% interval 1.8–6.5%). Controls C1–C9 all held: the instrument worked; the check fell short.
- **Why.** Two weak spots carried most of the shortfall.
  - **A tracing shrunk to half size (P3 ×0.5): 15 of 300.** The shape look ignores size by design (section 2.2). A
    tracing shrunk about its own middle mostly stays inside the finder's generous boxes.
  - **The cranial base moved 10–20 mm (P4 cranial base): 149 of 248.** The cranial-base box is the biggest box, with
    the widest slack, so a 10–20 mm move often stays inside it.
  - And 6 of the 11 false alarms were the shape look on Aariz films, judged against Ceph-400 tracings only (Aariz marks
    Gonion, Porion and the lips by slightly different conventions).
- **Disclosure carried over.** SC1-1a's 300 correct films had passed through the region finder once before the test,
  in gate /1's information table (box agreement only; no flags computed, no threshold set from them).
- Sources: pre-registration `reference/sc1-1a.json` (SHA-256 `26cc74f7…6e706`); report
  `sc1-1a.json` (SHA-256 `c08556b2…24b6`).

### 1.2 The author's rulings (5 Nov 2026), and the price of tuning

The author ruled, by multiple choice: **improve, then re-test once on fresh films**; PKU now, CL-Detection
2023 later; judge size against the finder's boxes (no millimetres); widen the shape reference to Ceph-400 plus all of
Aariz train; **use SC1-1a's spent films to improve the check, and say so openly**; keep the same marks (95%; at most 2%).
Still: **there is no millimetre size check.**

So **SC1-1a's 300 films became the "development films", and the check was tuned on them three times:**

1. **Gate /3** re-set the five region tolerances over them.
2. **The size and cranial-base centre lines** were set on them, with 220 other non-test films.
3. **whole-film/3**, the author's ruling after the development run fell 3 short (section 1.3): maxilla and mandible
   tolerances back to 0.02, centre line 0.08.

Every number on those films is therefore **in-sample**: it shows the wiring, not how the check does on new films.

### 1.3 The development runs (in-sample; not a test)

| Run | Rule | Caught (of 2,740) | Correct flagged (of 300) | Source |
|---|---|---|---|---|
| SC1-1a | whole-film/1 | 2,289 | 11 | `sc1-1a.json` |
| Development run | whole-film/2 | 2,600 (needed 2,603: stop, to the author) | 2 | `sc1-1b-dev.json` `57dbbe39…1da4` |
| Cause-finding run (information) | four variants | 2,600 to 2,688 | 2 to 11 | `sc1-1b-dev-decompose.json` `45ea63ca…3b81` |
| Confirmation run | **whole-film/3** | **2,643** (95% interval 95.7–97.1%) | **5** (95% interval 0.5–3.8%) | `sc1-1b-dev3.json` `9cbf2c4a…96c4` |

- **What the cause-finding run showed.** Two changes each cost catches. Gate /3's wider maxilla and mandible slack
  (each set by one Ceph-400 film) cost 50 catches and saved 3 false alarms. The 1,000-tracing shape reference cost 60
  catches and saved 5 false alarms. On these films, catches traded one for one with false alarms. The author kept the
  1,000 reference and put the maxilla and mandible back to 0.02 (gate /2's values exactly, recorded as gate /4).
- **What these runs cannot show.** By construction, the size and centre looks raise no false alarm on these films,
  because these films set their lines (under whole-film/3 the region slack is gate /2's again, set on other films, so
  the region looks' 4 flags here are the only false alarms not zeroed by design, beside the shape look's). The 5 of 300 is the third tuning on the same films and is optimistic. Only PKU can measure the
  check on films it has never seen.

### 1.4 SC1-1b-PKU: passed (6 Nov 2026, run once)

- **Films:** the 102 PKU films (Zeng et al., *Medical Image Analysis* 2021, 101904; Figshare 13265471 v6), sealed in
  the code until this one run. No PKU film was taught, tuned on or seen by the check before it. Truth: the mean of the
  two doctors (section 5).
- **Pre-registered** (`reference/sc1-1b-pku.json`, SHA-256 `02366f72…22d9f`) before PKU was opened; one run, from a clean tree, exit 0. Report
  `sc1-1b-pku.json`, SHA-256 `7dd1cef6…212f`.
- **Marks:** at least 969 of 1,020 caught; at most 2 of 102 correct tracings flagged. Counted in whole numbers.
- **Result: PASS.** Caught **981 of 1,020** (96.2%; 95% interval 94.8–97.3%). Flagged **0 of 102** (95% interval
  0.0–3.6%); no look flagged any. Controls C1–C12 all held.

| Planted mistake (102 each) | What it is, on the film | Caught | 95% interval | Caught by (a case can count under several) |
|---|---|---|---|---|
| P1a mirrored with the film | the tracing flipped left-right across the film | 102 | 96.4–100% | mirrored 102, facing 102 |
| P1b mirrored in place | flipped about its own middle, so it still sits over the skull | 102 | 96.4–100% | mirrored 102, facing 102 |
| P2 another film's tracing | another PKU patient's tracing, coordinates as they are | **90** | 80.4–93.8% | region 85, centre 35, size 33, shape 0 |
| P3 ×0.5 | the tracing shrunk to half about its middle | 102 | 96.4–100% | size 102, centre 102, region 2 |
| P3 ×2 | doubled about its middle | 102 | 96.4–100% | region 102, size 102 |
| P4 cranial base 10–20 mm | S, N, Po, Ar, Or moved together | 102 | 96.4–100% | centre 102, shape 62, size 59, region 17 |
| P4 maxilla 10–20 mm | A, ANS, PNS moved together | 102 | 96.4–100% | shape 100, region 90 |
| P4 mandible 10–20 mm | Go, Me, Pog, B, Gn moved together | 98 | 90.3–98.9% | region 86, shape 77, size 37 |
| P4 incisors 10–20 mm | U1T and L1T moved together | **91** | 81.5–94.5% | shape 81, region 45, size 13 |
| P4 soft tissue 10–20 mm | Sn, UL, LL, PogS moved together | **90** | 80.4–93.8% | shape 90, region 1 |

Each P4 move is 10–20 mm in a random direction, planted at 0.125 mm per pixel (section 5). The per-kind intervals are
computed here from the report's counts (exact binomial); the report prints the pooled ones.

**Information printed beside the marks (not judged):**
- Correct tracings with **doctor1 alone: 2 of 102 flagged** (both region; 95% interval 0.2–6.9%). Doctor2 alone: 0 of
  102.
- The whole tracing moved 10 mm: 102 of 102 flagged; 20 mm: 102 of 102.
- The point check (Stage A) on the same cases flagged P4 incisors 101, maxilla 95, mandible 90, soft tissue 89,
  cranial base 78, and none of P2, P3 or the correct tracings. The two checks see different things; together they miss
  less than either.
- PKU's cranial-base centre median, beside the calibration films' (section 2.4).

### 1.5 What one pass on 102 films can and cannot tell you

- **The catch rate.** 96.2%, with a 95% interval of 94.8–97.3%. The lower end is **below** 95%. So this run does not
  prove the true catch rate is at least 95%; it shows it is probably near 96%, and the development films (in-sample)
  said 96.5%.
- **The false-alarm rate. Zero of 102 is not "never".** The 95% interval runs to 3.6%: one correct tracing in about 28
  could still be flagged. Zero is not even unusual: if the true rate were the development films' 1.7%, a run of 102
  films would show zero about 1 time in 6. Before the run, the chance of meeting this mark was about 92 in 100 at a
  true rate of 1%, 76 at 1.7%, 67 at 2%, and 27 at SC1-1a's 3.7% (computed from the exact binomial).
- **The false-alarm figure is likely optimistic, because of PKU's truth.** The "correct" tracing was the mean of two
  doctors. An average of two people's points is smoother than either person's, so it looks more typical to the shape
  look and sits more neatly in the boxes. Against doctor1's own tracing alone, 2 of 102 were flagged, exactly at the
  limit. Your own tracings are one person's, so expect something between the two.
- **Pooled, not per kind.** The mark is pooled. Three kinds sat near 9 in 10, and their intervals
  reach down to about 80%. A pooled pass does not say each kind is caught 95% of the time.
- **One machine, one population.** PKU is one hospital's machine (Peking University). A new machine whose boxes sit
  differently against the anatomy is exactly what the check has not seen twice.

## 2. Each look: what it cannot show, then the picture, the numbers and what would make it wrong

The check has five looks and a gate on the region finder itself. Any look can raise the note. Each look's "cannot
show" comes first, because it is what a quiet note does not rule out.

### 2.1 The region finder and its box gate (before any look runs)

- **What it cannot show.** A box can sit on the right structure and still be the wrong size. The gate measures the
  finder on held-out Aariz films only; on Ceph-400 its boxes sat 2–7 mm further off (information table). The
  PKU box table (below) **cannot** be read as a box failure for four of the five regions (see "compared with what").
- **Picture.** A program (RF-DETR) draws five rectangles on the film: round the cranial base, the maxilla, the mandible,
  the incisors and the soft-tissue profile. It never sees the tracing. It was taught on 560 Aariz films; each teaching
  rectangle was drawn round that region's expert points, plus extra Aariz points (molars, root apices, soft-tissue
  points) and a margin.
- **Compared with what.** Each found rectangle against the rectangle drawn round the experts' points on the same film:
  how much they overlap (IoU: shared area over combined area, 1 = identical) and how far apart their centres are.
- **The numbers.** Gate: on 70 held-out Aariz films the median overlap was 0.913–0.966 across the five regions, against
  a pre-registered floor of 0.5. Control C9: the same boxes inflated 2× scored 0.244–0.250 and tripped the gate on every
  region (`box-gate-2.json` `db1a67a0…eae7`). On PKU (information): **cranial base median overlap
  0.94, centre error 1.25 mm median, 2.2 mm at the 90th percentile**, as good as on Aariz valid (0.85 / 2.2 mm) and
  better than on Ceph-400 Test1 (2.3 / 4.4 mm). The other four PKU figures (maxilla 0.45, mandible 0.83, incisors 0.014,
  soft tissue 0.28) compare the finder's rectangle with one drawn round the 19 traced points only, without the molars,
  root apices and extra soft points the finder was taught to include. The incisor "expert box" is a box round two tips.
  Those four numbers measure the mismatch of the two drawing rules, not the finder.
- **Literature.** DETR-family detection: Carion et al. 2020 (ECCV); RF-DETR: Robinson et al., arXiv 2025 (citation still
  to be confirmed). **No published paper checks a cephalometric tracing against regions detected on the
  same film.** No published box-accuracy figure on cephs to compare with.
- **What would make it wrong.** A film unlike the teaching films (child, edentulous, poor contrast, a cropped film)
  where a box lands on a neighbouring structure. If fewer than 3 of the 5 regions are found, the note says "no skull
  found" and no region, size or centre look runs. If the region finder cannot be loaded, only the shape look runs.

### 2.2 Shape: "is this a human lateral face, the right way round?"

- **What it cannot show.** **Size**: it removes size on purpose, so a half-size or double tracing looks normal to it (P3
  ×0.5: shape caught 0 of 102 on PKU). **Another patient's tracing**: a real person's normal face is a normal face
  (P2: shape caught 0 of 102). Anything that keeps the proportions: a whole tracing slid or turned. A single point out by
  5–10 mm. A wrong mm-per-pixel number.
- **Picture.** Lay the tracing on a light box over a stack of 1,000 expert tracings. Slide it, turn it, enlarge or
  shrink it until it sits as well as it can. Does it look like one of them? Then turn the sheet over and try again: if it
  fits far better face-down, it is mirrored.
- **Compared with what.** 1,000 expert tracings: Ceph-400's 300 (one senior doctor) and all 700 Aariz training
  tracings (the mean of two orthodontists), in their own file `whole-film-reference/1` (file SHA-256
  `6f0f066a…81bd`). Never PKU. The point check keeps its own 300-tracing file, unchanged.
- **The numbers.** Distance from the stack (Mahalanobis D² after a Procrustes fit). The line is the 99.5th percentile
  of each reference tracing scored against the other 999: **95.9** for a full 19-point tracing (the 300-tracing file
  gave 110.1). The line dropped because there are more tracings, not because the sets were mixed: 300 random tracings
  from the 1,000 give 131.1. By design about 1 correct tracing in 200 sits beyond the line. On PKU it
  flagged 0 of 102 correct tracings, and caught the soft-tissue moves almost on its own (90 of 102).
- **Literature.** Shape models: Cootes et al. 1995; Procrustes alignment: Gower 1975; shrunk covariance: Ledoit & Wolf
  2004. For the proportions it reads (for example SNA, about 82° in Steiner's norms: Steiner 1953, citation still to be
  confirmed). No published false-alarm figure for a whole-tracing D² check.
- **What would make it wrong.** A true variant (cleft, syndrome, surgery, severe asymmetry) sits beyond the line: a note
  on a correct tracing. A marking convention unlike both Ceph-400's and Aariz's (where Gonion or Porion goes) raises the
  distance a little on every film: more notes, not fewer. **What it costs to have 1,000 tracings:** a wider stack
  forgives more, so a moved region that Ceph-400 alone would call odd can now look like a plausible Aariz tracing (60
  catches lost on the development films, section 1.3).

### 2.3 Regions: "do the mandible points sit on the mandible this film shows?"

- **What it cannot show.** A region moved **inside its own box**: a mandible 6 mm forward stays inside a box about
  60 mm long. A single point off by 5–10 mm. Anything finer than the box's slack. A soft-tissue profile 10–20 mm off
  (region caught 1 of 102 on PKU): its box is large and its slack is a tenth of the box. Incisor tips moved along the
  teeth: the incisor box reaches up to the root apices, so a tip moved towards the root can stay inside it (region caught
  45 of 102; the shape look caught most of the rest).
- **Picture.** Each traced point belongs to one rectangle: S, N, Po, Ar, Or to the cranial base; A, ANS, PNS to the
  maxilla; Go, Me, Pog, B, Gn to the mandible; U1T, L1T to the incisors; Sn, UL, LL, PogS to the soft profile. Is each
  pin inside its own rectangle, or within a small allowance outside it?
- **Compared with what.** The finder's rectangles on **this film**, never another film and never a millimetre value.
  The allowance (τ) is a fraction of the rectangle's longer side.
- **The numbers.** τ under whole-film/3 (gate /4, the same as gate /2): **cranial base 0.09, maxilla 0.02, mandible
  0.02, incisors 0.01, soft tissue 0.10**, at score line 0.50 (`reference/sc1-box-gate-4.json` `ca3b3ecf…7cb6`).
  In picture terms: a soft-tissue point must sit about a tenth of its box outside it (about 6 mm on a box about 60 mm
  tall; an estimate of the box size, not measured); a maxillary point about 2% of its box. Each value is the largest
  outside-ratio any correct expert tracing showed on the films that set it, rounded up. Doubling the tracing (P3 ×2) and
  coordinates ×1000 (C8, corrupted numbers) put every point outside: 102 of 102 and 10 of 10.
- **Literature.** None for this measure; own data only.
- **What would make it wrong.** A box drawn short or long on a new machine (the soft-tissue box drifted most on
  Ceph-400: 13 of the region probe's 16 false alarms, which is why its slack is 0.10). Under whole-film/3 the maxilla and
  mandible slack (0.02) was set without the two Ceph-400 Test1 films that once pushed them to 0.07 and 0.10: on the
  development films, region flags on correct tracings went from 0 to 4 of 300 when it was put back. PKU flagged none, but against doctor1 alone 2 of
  102 were region flags.

### 2.4 Size: "is this tracing the right size for this film?" (new in Part 1b)

- **What it cannot show.** **A slight size error.** The line is about ±9% (below). A tracing at ×0.9 moves the score by
  0.105, just past the line for a film that sits on the centre, but not for one whose own score sits about 0.015 or more
  towards the large side. **×0.9 was never planted, so how often it is seen is not known;** ×0.95 is never seen. **A
  wrong mm-per-pixel number** with the points untouched: no scale is read. **A whole tracing slid without resizing**: the
  spreads do not change (the region and centre looks catch it). **Another patient's tracing of about the same size**
  (P2: size caught 33 of 102). **A tracing with fewer than 19 points is not judged at all** ("size not judged: incomplete
  tracing"), because a missing point moves its region's pin (a synthetic 11-point tracing read 0.165 against 0.029
  complete, more than the line).
- **Picture.** Stick a pin in the middle of each of the finder's rectangles. Stick another pin in the middle of each
  group of traced points (one for S, N, Po, Ar, Or; one for A, ANS, PNS; and so on). Measure how far the rectangle pins
  spread out from their own middle, and how far the tracing pins spread from theirs. On a correct tracing the two spreads
  keep a steady proportion, because both come from the same skull on the same film. Halve the tracing and its pins
  huddle at half the spread; double it and they sprawl to twice. The film's ruler, its magnification and the patient's
  size all cancel.
- **Compared with what.** This tracing's pins against the rectangles **on this film**. The usual proportion (the
  "centre") and the line come from correct expert tracings on 520 non-test films (70 Aariz hold-out, Ceph-400 Train
  150, and the 300 development films).
- **The numbers.** Score q = ln(tracing spread ÷ box spread), so ×0.5 and ×2 sit 0.69 either side. Four regions (the
  soft-tissue box left out by the written rule, because it drifts most): **centre +0.1203, line 0.09** (×1.09 or ×0.91
  about the usual proportion); five regions gave 0.10 (`size-calibration.json` `836b8c34…1cab`).
  A film with only three of the four regions found uses that set's own line: 0.08–0.11, except **0.32 when the
  cranial-base box is the one missing** (a half-size tracing still flags there, but only just: ln 2 − 0.32 = 0.37).
  Per-set medians: Ceph-400 about
  +0.127, Aariz about +0.112, 0.015 apart. On PKU: ×0.5 102 of 102, ×2 102 of 102, correct tracings 0 of 102 by size.
- **Literature.** The spread is the "centroid size" of shape statistics (Bookstein 1991; Dryden & Mardia 2016), here
  over five region centres. No paper is known that checks a tracing's size against regions detected on the same film.
  For scale: adult skull size varies by roughly 5% (about 0.05 in these units), and that cancels here.
- **What would make it wrong.** A rectangle on the wrong structure moves its pin, and the box spread with it. A machine
  whose boxes sit differently against the anatomy (PKU was that test, once). **The pre-registration's wording:**
  `reference/sc1-size.json` says the measure needs "at least 3 regions". The code also needs all 19 points (since
  5 Nov). The file is pre-registered and is not edited; the 19-point rule only ever judges fewer tracings,
  never flags more.

### 2.5 The cranial-base centre: "has the traced cranial base drifted off the cranial base this film shows?" (new in Part 1b)

- **What it cannot show.** **A cranial base moved by less than about 9 mm** (the line, below). **One cranial-base point
  off on its own** (say Porion on the wrong ear rod): it moves the middle by a fifth of its error. **A tracing missing
  any of S, N, Po, Ar, Or is not judged** ("cranial-base centre not judged: S, N, Po, Ar and Or all needed"; dropping N
  alone moves the middle about 12 mm, more than the line). The note says which: points missing, no cranial-base box
  found, or not set up (stored as `cb_look` and `cb_present`).
- **Picture.** Put a pin in the middle of the five traced cranial-base points (S, N, Po, Ar, Or). Put another in the
  middle of the finder's cranial-base rectangle. On a correct tracing the two pins sit in about the same place relative
  to each other on every film. Move the traced cranial base 15 mm and its pin moves 15 mm; the rectangle's stays.
- **Compared with what.** The rectangle on this film, and the usual offset between the two pins on 520 non-test films.
  The offset is measured as a fraction of the rectangle's longer side (no millimetres).
- **The numbers.** Usual offset (median): **(−0.0457, +0.0048)** of the box side. Measured line **0.06**; **in force
  0.08 by the author's ruling** (whole-film/3), for margin on a new machine (ruling
  `reference/sc1-cb-centre-ruling.json` `463ef936…00b5`). The cranial-base box is about 11 cm wide on an adult film (an
  estimate from S–N and Po, not measured), so 0.08 is roughly 9 mm. On PKU: the cranial base moved 10–20 mm was caught
  102 of 102 by this look; correct tracings 0 of 102.
- **The per-set shift.** The usual up-down offset differs by source: Aariz about +0.018 to +0.020 of the box side,
  Ceph-400 about −0.005 to −0.006, about 0.025 apart. **PKU's own median was (−0.0471, −0.0036)**, between the two and
  about 0.0085 from the calibrated median: about a tenth of the line. A future machine may sit further off; a shift of
  0.03 would bring ordinary films close to the line. That is why the line was widened to 0.08.
- **Literature.** None for this measure; own data only (the calibration run, the development run, the PKU run).
- **What would make it wrong.** A cranial-base rectangle drawn short or long moves its pin (the finder's centre error:
  1.25 mm median on PKU, 2.3 mm on Ceph-400 Test1). A Porion or Orbitale convention unlike the calibration films' moves
  the traced pin by a millimetre or two.

### 2.6 Facing and mirrored: "does the face point the way the film says?"

- **What it cannot show.** If the stored facing, the finder and the tracing were all wrong in the same way, nothing would
  disagree and no note would be raised. One mistake alone cannot do that, but two together can.
- **Picture.** On a film facing right, the soft-tissue profile is to the right of the cranial base. Three witnesses must
  agree: the facing stored for the film, the finder's facing (where it put the profile box against the cranial-base
  box), and the tracing's facing (does it fit the stack better as is, or mirrored?). Any disagreement raises a facing
  note.
- **The numbers.** PKU: P1a and P1b mirrored 102 of 102 each; control C4 (films flipped) the finder's facing flipped on
  10 of 10; C1, 50 synthetic mirrored faces, 50 of 50. The point check alone had read all 50 mirrored faces as clean
  (the point check's own note, not yet public): this look exists to close that gap.
- **What would make it wrong.** A finder that put the profile box on the wrong side (C4 shows it flips with the film).
- **Left-facing films were never tested on real data.** Every PKU film faces right, and the calibration films had none facing
  left. The mirroring for a left-facing film is written and tested on synthetic faces only (it needs real left-facing
  films before it is trusted).

## 3. The limits in one list

- **No millimetre size check**. Nothing in the check reads the film's scale; a wrong mm-per-pixel number
  with the points untouched is invisible to it.
- **The size look needs all 19 points; the centre look needs all five of S, N, Po, Ar, Or.** A partial tracing gets
  neither, and the note says so. Both lines were set on complete expert tracings.
- **`reference/sc1-size.json` says "at least 3 regions"**; the code also needs 19 points (2.4).
- **The per-set centre shift** (2.5): the centre look is the look most likely to drift on a new machine.
- **Left-facing films have only synthetic tests** (2.6): no real left-facing film has been through the check.
- **Under 10 mm, it is blind by design.** Every planted move was 10–20 mm. A region off by 5–8 mm is not this check's job.
- **The kinds of real mistake it misses most, in clinical terms** (PKU, about 1 in 9 each; intervals in 1.4):
  - a tracing saved on the wrong patient's film, from the same machine, when the two patients are of similar size and
    sit similarly in the head holder (P2: 12 of 102 missed);
  - the soft-tissue profile traced 1–2 cm off (on a shadow, or with the lips drawn on the wrong line): only the shape
    look sees it (12 of 102 missed);
  - both incisor tips placed 1–2 cm off together, especially along the teeth towards the roots (11 of 102 missed); the
    point check caught 101 of 102 of these.
- **A quiet note is not a correct tracing; a note is not a diagnosis.**

## 4. The switch, its default and its line

- **Where:** Settings › Checks, **"Whole-film check (beta)"**, with one plain line under it giving the PKU result.
- **Its default comes from the PKU run, by the author's ruling of 6 Nov 2026, set before PKU was opened** (in the
  pre-registration):
  - PASS (at least 969 caught and at most 2 flagged) → **on, called a pass**;
  - not a pass, but at least 918 of 1,020 caught and at most 5 of 102 flagged → on, stated as missing the marks with the
    exact shortfall;
  - anything else → off, with the result stated;
  - no verdict → off, "Not yet tested on new films."
  - The author's reason: the check is a re-check before the user approves the points, so a missed catch is no worse than
    no check, but too many notes on correct films teach people to ignore it.
- **The band reached: "on, a pass".** The app ships the check **on**.
- **The line**, as the app's `result_line` writes it: "Tested once on 102 new films
  (PKU, 2026): it caught 981 of 1,020 planted mistakes (needed 969) and flagged 0 of 102 correct tracings (at most 2
  allowed). A pass." In the middle band the line instead reads "Not a pass: <n> short on caught and/or <n> too many
  flagged. On, because it caught at least 918 and flagged at most 5."; in the off band, "Off, because it caught fewer
  than 918 and/or flagged more than 5."
- **Off** writes no new whole-film check and shows no note; the report and CSV cell read `off`; nothing stored is
  deleted, and switching back on shows the stored checks again.

## 5. PKU's truth, scale and overlap

- **Truth: the mean of doctor1 and doctor2** (rule `pku-truth/1`). PKU's two doctors are both described as senior, so
  there was no senior to pick; the mean is what this code does for Aariz too. **Its bias:** a mean is smoother than one
  person's tracing, which favours the check on false alarms (1.5). The two doctors were far apart on some points: 95th
  percentile 4.3 mm, 65 points more than 5 mm apart (information).
- **Scale: 0.125 mm per pixel, from a secondary source** (Self-CephaloNet, arXiv 2501.10984, 2025; ruling 5 Nov
  2026). The PKU readme gives no pixel size. The first figure tried, 0.096 mm (CL-Detection 2023 paper, Table I), gave a
  median S–N of 0.81 times Ceph-400 Train's and stopped the loader. At 0.125 the median S–N is 61.5 mm against Ceph-400
  Train's 58.6 mm (ratio 1.05; control C12, limit ±15%). The scale is used only to plant the 10–20 mm moves; the check
  never reads it. If the true figure were 0.096, the planted moves would have been about 23% smaller in millimetres
  than stated. Zeng et al.'s own figure is still to be confirmed.
- **CL-Detection 2023 overlap.** Its 600 films are the ISBI 400 (Ceph-400, including the closed Test2),
  PKU's 102, and about 98 from Shenzhen. After PKU only the Shenzhen films are fresh, so the later re-test uses them
  alone, with any film matching an ISBI or PKU film left out. At about 98 films the false-alarm mark would be at most 1.

## 6. Next: the author's two-tier intent for Part 2 (later work, not this release)

Recorded by the author on 6 Nov 2026 (pre-registration `verdicts.laterIntent`):
- **An internal re-check** runs more often, at a lower bar, and points the AI model at a region to look at again.
- **A note to the user** shows only when the check is more sure: about 95%.
Neither tier is built. Each will need its own design and its own pre-registered test.

## 7. Evidence: files and SHA-256 values

Files marked "in the repository" are published beside the app. Reports stay with the author (they hold run output and
are not in the repository); their SHA-256 values let a reader confirm a copy.

| What | File | SHA-256 |
|---|---|---|
| SC1-1a, pre-registration | in the repository: `reference/sc1-1a.json` | `26cc74f7…6e706` |
| SC1-1a, report | `sc1-1a.json` (author's copy) | `c08556b2…24b6` |
| Box gate /2 (= gate /4's tolerances), report | `box-gate-2.json` (author's copy) | `db1a67a0…eae7` |
| Box gate /4, record | in the repository: `reference/sc1-box-gate-4.json` | `ca3b3ecf…7cb6` |
| Shape reference, 1,000 tracings (`whole-film-reference/1`) | in the repository and inside the app (all versions): `apps/desktop/src-tauri/resources/check/shape/whole-film-reference-v1.shape` (coordinates only, no images; Ceph-400 CC BY-NC 4.0 and Aariz CC BY 4.0, credited) | `6f0f066a…81bd` |
| The three calibrations in force | in the repository and inside the app: `apps/desktop/src-tauri/resources/check/regions/` `calibration.json` (gate /4), `cb-centre-calibration.json` (ruled, line 0.08), `size-calibration.json` | `724e6b45…d20`, `704d97fb…654`, `d3973360…664` |
| Region finder, model | downloaded once in Models… (from 1.2.1; not in the app or the repository: 121 MB); Zenodo doi:10.5281/zenodo.23965907 `model.onnx` | `17171e68…7b80` |
| Region finder, manifest | downloaded with the model; Zenodo doi:10.5281/zenodo.23965907 `manifest.json` | `0e5cfb0a…7d2a` |
| Size look | in the repository: `reference/sc1-size.json`; calibration `size-calibration.json` (author's copy) | `836b8c34…1cab` |
| Cranial-base centre | in the repository: `reference/sc1-cb-centre.json`, ruling `reference/sc1-cb-centre-ruling.json`; calibration `cb-centre-calibration.json` (author's copy) | ruling `463ef936…00b5`; calibration `111776c2…e797` |
| Development runs (tuning films) | `sc1-1b-dev.json` (`57dbbe39…1da4`), `sc1-1b-dev-decompose.json` (`45ea63ca…3b81`), `sc1-1b-dev3.json` (`9cbf2c4a…96c4`) (author's copies) | as listed |
| SC1-1b-PKU, pre-registration | in the repository: `reference/sc1-1b-pku.json` | `02366f72…22d9f` |
| SC1-1b-PKU, report | `sc1-1b-pku.json` (author's copy) | `7dd1cef6…212f` |
| The app's looks and switch | in the repository: `apps/desktop/src-tauri/src/whole_film.rs`, `crates/ceph-model/src/wholefilm.rs`, `crates/ceph-store/migrations/020_whole_film_check.sql` | the repository's own history |

## 8. What the report and CSV cell says

**The cell appears only with the research switch** (owner, 6 Nov 2026). By default the whole-film check's result is in
neither the PDF report nor any CSV: the Points table has no "Whole-film check" column and the points CSV has no
`whole_film_check`, `whole_film_region` or `whole_film_look_*` column, and nothing of the whole-film check appears in either file. Tick "Include the whole-film check in reports and CSV (research)" in
Settings > Checks (beside the check's own switch; off by default; remembered) and the film's result, each look's status and each landmark's region result appear. The note on the film is
unchanged either way. The two switches are separate: with the check itself off and this one on, every cell reads `off`.

With the research switch on, the Points table of the report, and the `whole_film_check` column of the points CSV, carry one value per film (the same on
every point row). It states the outcome. **It does not state which looks ran**; the note on the film does. The values:

| Cell | Meaning |
|---|---|
| blank | No record: a film never checked (made before library format 20), or no check read. Not a clean check. |
| `off` | The switch in Settings > Checks was off: nothing was checked or shown. |
| `not-run` | Neither the shape look nor the region look could run: fewer than 12 points (the shape look's minimum, `MIN_POINTS`) and no region look, or no look set up. A tracing of 12 to 18 points IS judged (shape and regions on the points present); only the size look needs all 19. |
| `clean` | **No look that ran raised a flag.** It does not say that all five looks ran. Read the film's note for the looks that did not: shape not set up; regions not checked (no region finder, not set up, or film too small); size not judged (fewer than all 19 points, or fewer than 3 regions found); centre not judged (any of S, N, Po, Ar, Or missing). |
| `flagged:<reasons>` | At least one look flagged. Reasons are joined by `+` in stored order: `shape`, `mirrored`, `facing`, `size`, `no-ceph-found`, and `region-<name>` (cranial-base, maxilla, mandible, incisors, soft-tissue). Every reason is named, unlike the note, which says `mirrored` for a mirrored tracing and hides `facing`. |
| `flagged` | Flagged with no stored reason (should not occur). |
| `checked:<reason>` | A flag the clinician has pressed Checked on, with the reason chosen: `tracing-right`, `expected-variant` or `corrected-tracing`. The flag is not removed from the record. |

### Each look's status (research switch on)

The points CSV also carries six columns, `whole_film_look_shape`, `_regions`, `_size`, `_centre`, `_mirrored` and `_facing`
(the same on every row of a film), and the PDF prints them as one line under the Points table. Each reads `judged` or
`not checked (<why>)`: too few points, too few points or regions, not set up, no region finder, film too small (and, for facing, no facing found). They are
what makes `clean` readable: `clean` with `size not checked (not set up)` means the size look never ran. `mirrored` is the shape
look's own test, so it reads as the shape look does. `facing` reads `judged` only when something actually compared the tracing's facing with the film's: the shape look ran, or the
region finder gave a facing (it does so only with at least 3 regions found, the cranial-base and soft-tissue boxes both found, and not level; the
facing it read is stored with its run and read here at the same score line). Otherwise it reads `not checked (no facing found)`. **With only the shape look, facing is compared with the facing recorded for the film (the film's stored facing setting), not with the image:** a film whose recorded facing is wrong is seen as a mirrored tracing, and the shape look cannot tell which of the two is wrong. Blank: no record. `off`: the whole-film check is off.

### The per-landmark region result (research switch on: the points CSV, and the PDF's Region column)

Next to `whole_film_check` the points CSV has `whole_film_region`, one value for each landmark row. It answers a narrower
question than the film's cell: **did the region look find this landmark's region (cranial base, maxilla, mandible,
incisors, soft-tissue profile) to be where the tracing says it is?** Picture the region finder drawing a box round the
mandible on the film; the look asks whether the tracing's mandible points sit inside that box, give or take the tolerance fixed in advance.
The tolerances, the box finder and the judging are exactly those of the film-level check; nothing is judged again for this column.
A landmark takes the result of its region (the same for all five mandible points; `REGION_OF` in the code lists which points belong to which region).

| Cell | Meaning |
|---|---|
| `fine` | The region look ran, it found a box for this landmark's region, **the check saw this landmark at the position it still holds**, and it stored no flag for that region. It does not say this point is correct: an error under about 10 mm stays inside the box. |
| `region flagged` | The check stored a flag for this landmark's region. **The whole region is marked, not the one point:** the flag may be caused by one point (the note on the film names it) and the others in the region are marked too. A cranial-base centre flag also marks the cranial base. |
| `not checked` | The region look did not judge this landmark: no region finder, not set up, film too small, fewer than 3 regions found (`no-ceph-found`), a check that was not run (neither shape nor region look could run), the finder gave no usable box for this region, **or the check never saw this landmark where it is now** (it was not among the points checked, it was placed later by hand or by another model, or it has been moved since). Not a clean result. |
| blank | No record (never checked). |
| `off` | The whole-film check itself was switched off. |

**Before sign-off the result describes the model run's points, not the current tracing.** The check shown then is the latest run of the model that placed most of
the film's landmarks, and it judged that run's own points. A landmark counts as seen only if that run had it and the tracing still holds it where the run put it
(within a millionth of a pixel); a point accepted unmoved counts, a point nudged or placed by hand does not. After sign-off the shown check is the final one, which
judged the signed-off tracing, so every landmark counts.

What it cannot show: a landmark that is not traced has no row, so it has no cell. A tracing of 12 to 18 points is still judged (the shape look needs at least 12 points,
the region look judges the points present), so its present landmarks can read `fine` or `region flagged`; fewer than 12 points with no region look is "not run" and
every landmark reads `not checked`. Only the size look needs all 19, and the centre look needs S, N, Po, Ar and Or. A `fine` landmark in a flagged film can still sit
in the wrong place for a reason the region look does not test (shape, size, facing); read `whole_film_check` beside it.

So `clean` is "nothing seen by the looks that ran", the weakest claim a quiet check can make. A researcher counting
`clean` films as "passed the whole-film check" would be counting films where some looks may not have run. Until a
separate coverage value exists, filter on the film's note, not on the cell alone.

## 9. What the app insists on

The app gives a verdict only with the inputs the PKU run tested; anything else reads "not set up" for that look and
never a verdict. The region calibration must be gate /4's (rule `sc1-box-gate/4`, with the record's hash and
tolerances); the centre calibration must carry the whole-film/3 ruling (line 0.08); the shape reference must have the
SHA-256 in section 7; the size calibration must be the pre-registered one (its report's SHA-256 in section 7, and the four
regions it uses). A gate /1 to /3 file, the measured (line 0.06) centre file, another reference, or another size
calibration gives no verdict for that look.

**Where the files come from (1.2.1, 7 Nov 2026).** The check has two kinds of file, and they sit on two shelves.

- *The user's shelf* holds the region finder: the author's own model (CC BY 4.0, Zenodo doi:10.5281/zenodo.23949953), which
  finds the five regions on the film. It is 121 MB, so it is not built into the app. It is downloaded once, in **Models…**
  (the app asks once, when the whole-film check is on and no finder is found; after Download or Later it does not ask again, and Models… always offers it), from Zenodo record 23965907. It
  can also be added from a folder. The app checks both of its files, `manifest.json` and `model.onnx`, against fingerprints
  (SHA-256, section 7) before it keeps them.
- *The app's own shelf* holds four small files: the three calibrations and the shape reference. They come inside the app.

What is compared to what. Each calibration was measured with one particular finder. Before the app pairs a finder with
the calibrations it checks the finder's two files against the pinned fingerprints, the same ones the calibrations were made
with. The calibrations themselves are checked as before (gate /4, the whole-film/3 ruling, the pinned shape reference and
size calibration), so which shelf a calibration came from cannot change a verdict. The app looks at the user's shelf first;
a complete set there that passes every check is used. A set there that fails any check is passed over, and the app takes
the calibrations from its own shelf, never half from each.

The number against its source. The pairing is exactly the one the PKU test used: with these same bytes the check found 981
of 1,020 planted mistakes and 0 of 102 false alarms on the correct ones (the PKU run's report; the calibrations here were
made again from the run reports it pinned, each report's SHA-256 checked, and the shape reference was rebuilt byte for byte,
SHA-256 `6f0f066a…81bd`, so they are the files the PKU run used, not copies of them).

What would make it wrong. A finder with the same `model.onnx` but another `manifest.json` would read the five regions with
different settings (another input size or class order) and give boxes the calibrations were never measured on. The manifest
fingerprint refuses it: such a finder is "not set up", never a verdict. A model file damaged in the download is refused
the same way by its own fingerprint.

**What the check cannot show without the check model.** Without the finder, the region, size and centre looks do not run, and a quiet note then says nothing about region, size or centre errors. The note on the film says so ("Whole-film check: regions not checked (not set up: download the check model in Models…)."). The other looks still run. Models… reads the size of the stored model file, not its fingerprint, so a damaged file of exactly the right size would read "Ready" there while the check itself refuses it as not set up.
