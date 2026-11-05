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
