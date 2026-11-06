# Third-party models

OpenCephAI's own code is licensed under the PolyForm Noncommercial License 1.0.0, for research and education only
(see `LICENSE`; the clinical-use permission was withdrawn by the owner on 5 Nov 2026). The landmark-detection
models it can use are other people's work, under their own licences.

**CephTrace never bundles or redistributes model weights.** Each person downloads them from the authors' own link in
**Models…**, accepts the licence on their own Mac, and CephTrace converts and checks them there. Only each network's
structure, with every weight removed, ships with the app.

This is not legal advice. Check that your use is allowed, in particular before using a non-commercial model in a
practice that charges fees.

## HRNet-W32 (cwlachap)

- **Catalogue id:** `cwlachap-hrnet-w32` (standard)
- **Authors' link:** <https://huggingface.co/cwlachap/hrnet-cephalometric-landmark-detection>
  (file `best_model.pth`, revision `2079887432b6db7f7a26ec1041b8e55689575b88`)
- **Citation:** cwlachap, hrnet-cephalometric-landmark-detection (Hugging Face, 2025)
- **Code licence:** MIT
- **Weights:** trained on the ISBI 2015 challenge films. Their organisers published no licence, so CephTrace treats
  them as CC BY-NC 4.0 (unconfirmed): non-commercial use only.
- **Leakage note:** trained on a random 70/15/15 split of ISBI 2015, which overlaps Ceph-Biometrics-400, so its scores
  on Ceph-400 are optimistic.

## GU2Net

- **Catalogue id:** `gu2net-isbi19` (standard)
- **Authors' link:** <https://github.com/MIRACLE-Center/YOLO_Universal_Anatomical_Landmark_Detection>
  (weights: <https://drive.google.com/file/d/1yQLjZTCqn_fWzyPPJSRxFycrnIoe4U3U/view>)
- **Citation:** Zhu et al., You Only Learn Once: Universal Anatomical Landmark Detection, MICCAI 2021
- **Code licence:** MIT
- **Weights:** trained on the ISBI 2015 challenge films, treated as CC BY-NC 4.0 (unconfirmed): non-commercial use only.
- **Leakage note:** trained on ISBI 2015 training films 001–150, so Ceph-400's Test1 and Test2 are clean.

## SRPose (CL-Detection 2023)

- **Catalogue id:** `srpose-cldet23` (optional)
- **Authors' link:** <https://github.com/5k5000/CLdetection2023>
  (weights: <https://drive.google.com/file/d/10HrNDBBpuECTcgNgcWNUt7kM6m4ZMXM4/view>)
- **Citation:** Wu et al., arXiv:2309.17143 (MICCAI CL-Detection 2023)
- **Code licence:** Apache-2.0
- **Weights:** trained on the CL-Detection 2023 data, licensed CC BY-NC-ND 4.0: non-commercial use only, and changed
  versions may not be shared. **A converted copy must not be shared**: CephTrace converts it on your Mac for your own
  use only.
- **Leakage note:** trained on CL-Detection 2023 train and validation, which include the ISBI 2015 films, so its scores
  on Ceph-400 are optimistic.

## Aariz CEPHA29 HRNet-W32

- **Catalogue id:** `aariz-cepha29` (optional)
- **Authors' link:** <https://huggingface.co/MuhammadNabeelSh/cephalometry-landmarks>
  (file `landmarks-cepha29.onnx`, the full-precision FP32 file, revision `99229d507ed072dca8ec78b442299aa452753e9e`,
  SHA-256 `cacd38201ada69fa7d3ea2566cb63b315302f35e3c66fb483a6eed32c88f14c5`, 114,226,363 bytes). CephTrace never uses
  the INT8 file in the same repository (owner, 7 Oct 2026).
- **How it installs:** the authors publish one finished ONNX file with its weights inside, so nothing of it ships with
  CephTrace (no skeleton). The app downloads it from the link above, checks the SHA-256 and copies it into place.
- **Licence:** CC BY 4.0. Free to use, including in a practice, **with credit to the authors**.
- **Attribution (CC BY 4.0 requires this credit):** "Aariz CEPHA29 cephalometric landmark model (HRNet-W32) by
  M. N. Sh., <https://huggingface.co/MuhammadNabeelSh/cephalometry-landmarks>, licensed CC BY 4.0. Trained on the
  Aariz Cephalometric Dataset (CEPHA29), Figshare, doi:10.6084/m9.figshare.27986417, CC BY 4.0."
- **Dataset citation:** Khalid et al., Aariz dataset, Sci Data 2025, doi:10.1038/s41597-025-05542-3.
- **Credits from the model card:** training code CephaloHRNet (MIT); backbone HRNet-W32 ImageNet weights
  (`hrnet_w32.ms_in1k`, Apache-2.0).
- **Reference code:** `tools/model/reference_aariz.py` (in the private development repository, not in this copy) copies the preprocessing and decoder of the uploader's
  `scripts/eval-landmark-model.py` from <https://github.com/Muhammad-Nabeel-Sh/CephalometryStudio> (MIT,
  © 2026 Cephalometry Studio contributors), with its licence notice, to check CephTrace reads the model the same way.
- **Not a medical device:** research and education only; not for diagnosis or treatment (the authors' disclaimer).
- **Leakage note:** trained on the Aariz train split (the valid split gave its reported score, MRE 1.24 mm); the
  uploader did not use the test split. Not trained on the ISBI 2015 films, so it is clean on Ceph-Biometrics-400.

# Third-party data

## Ceph-400 expert tracings (the point check's starting knowledge)

Licence check made 2 Nov 2026 for Stage A Task 3 (spec §14.13 U5, owner ruling OQ-2 as revised). It covers one question: may we redistribute the point coordinates of the
dataset's expert tracings with the app? This was a licence check only. Nothing was downloaded, and nothing under
`data/` was opened.

- **What the file holds:** `models/shape/ceph400-v1.shape`, written by `ceph-bench --shape-prior`. It holds the 19
  point coordinates of 300 expert tracings (Train 001–150 and Test1 151–300; Test2 is never read), in film pixels. It
  holds no film, no image, no patient detail and no film name beyond its number.
- **Dataset:** Ceph-Biometrics-400, Hugging Face `YongchengYAO/Ceph-Biometrics-400`, the revision the repo pins
  (`fc579acad063a0108990fa10fac151fc90a73105`, in `tools/dataset/prepare_ceph400.py`). The page says it is "a modified
  version of [data](https://figshare.com/s/37ec464af8e81ae6ebbf) for the paper: Fully Automatic System for Accurate
  Localisation and Analysis of Cephalometric Landmarks in Lateral Cephalograms" (Lindner et al., *Sci Rep* 6, 33581,
  2016, doi:10.1038/srep33581), and that "We used the landmark annotations from the folder `400_senior` in the
  original dataset." These are the ISBI 2015 challenge films.
- **Terms, as read (2 Nov 2026):**
  - The dataset card at the pinned revision
    (<https://huggingface.co/datasets/YongchengYAO/Ceph-Biometrics-400/raw/fc579acad063a0108990fa10fac151fc90a73105/README.md>):
    its header says `license: cc-by-nc-4.0`, and its last section says: "## License — This dataset is released under
    the `CC BY-NC 4.0` license." The Hugging Face record for that revision carries the tag `license:cc-by-nc-4.0`.
  - The same card, "Data Usage Agreement": "By using the dataset, you agree to the terms as follow. — You must cite the
    paper: Fully Automatic System for Accurate Localisation and Analysis of Cephalometric Landmarks in Lateral
    Cephalograms — You must refer to the source of this dataset in any publication:
    `https://huggingface.co/datasets/YongchengYAO/Ceph-Biometrics-400`".
  - The paper (read through Europe PMC, PMC5028843) says the data "are available from
    https://figshare.com/s/37ec464af8e81ae6ebbf". Its own licence, "This work is licensed under a Creative Commons
    Attribution 4.0 International License", covers the article, not the data.
  - The original organisers' figshare page (<https://figshare.com/s/37ec464af8e81ae6ebbf>) could not be read: it
    answered HTTP 403. Their own terms are therefore **not confirmed**. (The model entries above already note that the
    organisers published no licence; a 2026 paper reported CC BY-SA 4.0, a secondary source.)
- **What CC BY-NC 4.0 allows:** sharing the data and adapted material (the coordinates are adapted material), with
  credit and a link to the licence, **for non-commercial purposes only**.
- **Verdict: `not allowed`** (for shipping the coordinates with the app). A copy shipped inside the app could not be
  kept to non-commercial use, which is what CC BY-NC 4.0 requires; and the original organisers' own terms could not
  be read. This is not legal advice.
- **So:** the file is **never redistributed by us**. It is built and kept only on this Mac, in the git-ignored
  `models/` folder. The fallback is a **first-use download**: each user's app downloads the tracings from the
  dataset's own public link (the Hugging Face page above), after the user accepts its licence, as with the models, and
  builds the same file there. That download is a follow-up, not built in the Stage A plan.
- **Credit wherever the coordinates are used** (the data usage agreement asks for the paper and the source; CC BY-NC
  4.0 asks for credit and the licence): Lindner, C. et al., *Scientific Reports* 6, 33581 (2016); source
  <https://huggingface.co/datasets/YongchengYAO/Ceph-Biometrics-400>, CC BY-NC 4.0. The challenge itself: Wang, C.-W.
  et al., *Medical Image Analysis* 31, 63–76 (2016).

## Ceph-400 and Aariz train expert tracings (the whole-film check's shape reference)

Added 5 Nov 2026 for SC-1 Part 1b Task B (design
§17.4, owner ruling R1b-4 "Ceph-400 + all Aariz train").

- **What the file holds:** `models/shape/whole-film-reference-v1.shape` (`whole-film-reference/1`), written by
  `ceph-bench --sc1-reference`. It holds the 19 point coordinates of 1,000 expert tracings, in film pixels, facing
  right: Ceph-400 Train 001–150 and Test1 151–300 (the senior doctor's tracings, named `ceph400:NNN`; the same 300 as
  Stage A's file above), and all 700 Aariz train tracings (the mean of Aariz's senior and junior orthodontists, as
  `tools/dataset/prepare_aariz.py` makes them; named `aariz:<id>`). It also holds 20 numbers: the shape look's line for
  the full 19 points and for each set of 18. No film, no image, no patient detail. Ceph-400 Test2, Aariz valid, Aariz
  test and PKU are never read. Stage A's `ceph400-v1.shape` is a separate file and is not changed.
- **Licences:** Ceph-400 as above, **CC BY-NC 4.0** (the organisers' own terms not confirmed); Aariz **CC BY 4.0**
  (credit required). The file mixes both, so it carries the stricter terms: **non-commercial use only**, with both
  credits. As with Stage A's file, it is **never redistributed by us**: built and kept only on this Mac, in the
  git-ignored `models/` folder. Sharing it with other users is an open question.
- **Credit wherever the coordinates are used:** Lindner, C. et al., *Scientific Reports* 6, 33581 (2016); source
  <https://huggingface.co/datasets/YongchengYAO/Ceph-Biometrics-400>, CC BY-NC 4.0; the challenge itself: Wang, C.-W.
  et al., *Medical Image Analysis* 31, 63–76 (2016). And: Aariz Cephalometric Dataset (CEPHA29), Khalid et al.,
  *Scientific Data* 2025, doi:10.1038/s41597-025-05542-3; Figshare doi:10.6084/m9.figshare.27986417, CC BY 4.0.

# The region finder (SC-1 Part 1, whole-film check)

The run record below was filled from the teaching run's own logs on 4 Nov 2026. The weights are never committed, bundled or uploaded.

## RF-DETR (Roboflow)

- **What it is used for:** only to start the teaching of the region finder: the network and its COCO-trained Medium
  base weights are the starting point; CephTrace's region finder is what is taught from there (next entry).
- **Package:** `rfdetr` 1.11.2 (PyPI), run in a separate Python environment outside the repository (versions in `tools/sc1/requirements.txt`).
  Nothing of it is bundled with the app; the app runs the exported ONNX file on ONNX Runtime CPU at full precision.
- **Code licence:** Apache License 2.0. Read on 3 Nov 2026 from the installed package's own files:
  `rfdetr-1.11.2.dist-info/METADATA` line 6 (`License: Apache License 2.0`) and line 135 ("The open-source `rfdetr`
  package and Apache-designated models are released under Apache 2.0, while Plus components ... are licensed under
  PML 1.0"); `rfdetr-1.11.2.dist-info/licenses/LICENSE` (the Apache License, Version 2.0, January 2004, full text);
  the README size table in the same METADATA, line 329: `| M | RFDETRMedium | rfdetr-medium | 73.6 | 54.7 | 4.4 | 33.7 |
  576x576 | Apache 2.0 |`. Only Apache-licensed sizes are used (Medium); the PML 1.0 sizes are not.
- **Base weights (Medium):** file `rf-detr-medium.pth`, 404,992,918 bytes, SHA-256
  `749ff6071828aaffac63e204c4f4135ed3d6cdae4d702e086c360edc3b5768c8` (MD5 `7223f764a87b863f02eb8d52bf0ce2ee`, the value
  `rfdetr` itself checks). Source URL in the package (`rfdetr/assets/model_weights.py`, `RF_DETR_MEDIUM`):
  <https://storage.googleapis.com/rfdetr/medium_coco/checkpoint_best_regular.pth>. Licence: Apache 2.0, as the README
  table states for the Medium size. Where the file was obtained and when: rfdetr's own download (from the URL above, into `~/.roboflow/models/` on the main Mac), 2 Nov 2026.
- **Notice:** RF-DETR, Copyright (c) 2025 Roboflow, licensed under the Apache License, Version 2.0
  (<https://github.com/roboflow/rf-detr>).

## The region finder taught here (`rfdetr-m-aariz-regions`)

- **What it is:** RF-DETR Medium, taught to draw a box round each of five regions (cranial base, maxilla, mandible,
  incisors, soft-tissue profile) on lateral cephalograms. Used by the whole-film check. In the app it lives in the
  git-ignored `models/regions/`. Its master copy is in the owner's separate `OpenCephAI-models` repository (local).
- **Published openly (owner; version 1 on 5 Nov 2026, version 2 on 6 Nov 2026):** Zenodo, doi:10.5281/zenodo.23949953 (all
  versions; version 2 is doi:10.5281/zenodo.23965907, version 1 doi:10.5281/zenodo.23949954), CC BY 4.0, with RF-DETR's Apache-2.0
  licence and the Aariz credit. The record holds the ONNX file above, the PyTorch weights as safetensors, the film split
  and a model card. It does not hold the films.
- **Taught on the Aariz dataset, Khalid et al., Sci Data 2025, doi:10.1038/s41597-025-05542-3, CC BY 4.0 (credit
  required).** Design, to be confirmed by the run record below: only Aariz **train** films, the 80% teaching slice of
  `reference/sc1-aariz-split.json` (seeded 80/10/10 split), each with a mirror image; the 10% hold-out chooses the
  checkpoint; the tuning slice and Aariz valid are not used in teaching; Aariz test is never opened. Attribution to
  carry with it: "Region finder taught on the Aariz Cephalometric Dataset (CEPHA29), Khalid et al., Sci Data 2025,
  Figshare doi:10.6084/m9.figshare.27986417, CC BY 4.0. Started from RF-DETR Medium (Roboflow, Apache 2.0)."
- **Run record (from the run's own logs, 4 Nov 2026):**
  - epochs: 110 (`Trainer.fit` stopped: `max_epochs=110` reached; 0 error or traceback lines in `sc1-run1.log`, SHA-256 `5025f16d8e2c73939369b65ab42375fefc157c442330a74ed19ef8fb0894c619`). Images: 1,120 teaching (560 films plus mirror copies), 140 hold-out (70 plus mirror copies).
  - hours and device: 22,572 s (6.27 h), 205 s per epoch, on `mps` on a peer Mac (Apple M2 Max, 32 GB, macOS 15.7.4), rfdetr 1.11.2. The teaching ran on a second Mac because the 16 GB main Mac ran out of memory (one pass ran 5 h 13 min with 7.1 of 8 GB swap used and never finished, so it was stopped).
  - best checkpoint file and its SHA-256: `checkpoint_best_total.pth` (rfdetr's best on the hold-out, from EMA), SHA-256 `7b480b751f3180b8c5738d941712707dbab3538ce710f1074cdda29f12459434`.
  - ONNX SHA-256 and manifest fingerprint (the same value; `models/regions/manifest.json`): `17171e68f9f7072062e2a3a2cbd4851618056f5136bed998f1782c49d4897b80`. Version `rfdetr-m-aariz-regions/1 (2026-11-04)`, input 576, 6 classes.
  - ONNX Runtime CPU against PyTorch on the hold-out, worst corner difference in px: 0.340 px (rule 0.5 px), over 70 of 70 films and 350 of 350 box pairs; region labels agree 70 of 70; largest score difference 1.11e-3; verdict pass.
- **Format:** ONNX opset 17, full precision (fp32), run on ONNX Runtime CPU (owner ruling OQ-1).
