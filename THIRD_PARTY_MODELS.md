# Third-party models

OpenCephAI's own code is licensed under the PolyForm Noncommercial License 1.0.0, for research and education only
(see `LICENSE`). The landmark-detection models it can use are other people's work, under their own
licences.

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
