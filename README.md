# OpenCephAI 1.1 Beta

**Beta:** OpenCephAI is beta research software, not a diagnostic device. Every point must be checked by a clinician.
See the legal disclaimer below: research and education only, not a medical device.

A lateral cephalogram tracing app for macOS, for research and education only. Source-available under a noncommercial
licence; see `LICENSE`.

## Credits

Program and Design: Dr Linton Nash

## Website, how-to guide and references

- Website and step-by-step how-to guide, with the keyboard commands: https://orthosmile.github.io/OpenCephAI/
- Download the signed Mac app: [Releases](https://github.com/ORTHOsmile/OpenCephAI/releases/latest)
- Every research paper, dataset and AI model the app draws on: `REFERENCES.md`

## About

OpenCephAI is a source-available app for tracing lateral cephalograms (side-on skull X-rays used in orthodontics) on a
Mac. You import a film, mark or check the landmarks, and the app works out the cephalometric measurements and
compares them with published norms for the patient's population, age and sex. It can also superimpose a patient's
films over time.

The app can use landmark-detection AI models. These are other people's work under their own licences; see
"Model weights" below.

**Research and education only — not a medical device.** OpenCephAI is beta research software for research and
education. It is not approved for diagnosis or treatment planning. Check every landmark and every number yourself. See
"Legal disclaimer and terms of use" below.

## What is in this repository

- `apps/desktop` — the app: a Tauri 2 shell (`src-tauri`, Rust) around a React and TypeScript screen (`src`), plus
  its browser smoke tests (`e2e`).
- `crates` — the Rust libraries: the library store, model installation and inference, the label reader and the
  bench tools.
- `packages` — the TypeScript libraries: geometry and the analyses (measurements, norms, severity).
- `reference` — the published norm sets (one JSON file per paper, with citation, table and page for every number)
  and the reference tables the app reads.
- `docs` — methodology notes: how norms are added and checked, what the severity marks can and cannot tell you, the
  cross-check method, the analyses catalogue and two pre-registered rules.
- `test-fixtures` — synthetic test cases shared by the Rust and TypeScript tests.
- `REFERENCES.md` — the research papers, datasets, AI models and software the app draws on.

All test data is synthetic. Test fixtures mark made-up patient details with the word SYNTHETIC. No patient data is
in this repository, and none should ever be added.

## Building and testing

You need macOS, Node.js 22, pnpm 10 and a current stable Rust toolchain.

```bash
pnpm install --frozen-lockfile

# TypeScript tests (every package)
pnpm -r test

# Rust tests
cargo test -p cephtrace-desktop -p ceph-infer -p ceph-store -p ceph-bench -p ceph-label -p ceph-model
cargo test -p ceph-label --features harness

# Build the screen
cd apps/desktop && pnpm build

# Build the Mac app (from apps/desktop)
pnpm tauri build --bundles app,dmg
```

The browser smoke tests drive Google Chrome against a built preview, with the Tauri runtime stubbed out. They
need `playwright-core`, which is not a dependency of this repository; install it in a separate folder and point
`PLAYWRIGHT_MODULE` at it. From `apps/desktop`:

```bash
./node_modules/.bin/vite build
./node_modules/.bin/vite preview --port 4173 --strictPort &
PLAYWRIGHT_MODULE=/path/to/node_modules/playwright-core \
CHROMIUM_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" node e2e/run.cjs
```

## Model weights

**Model weights are not included in this repository, and the app never bundles them.** Only each network's
structure ships, with every weight removed (`crates/ceph-model/catalog/*.onnx`; the weights live in a separate
`weights.bin` that is never part of the app).

To use a model, open **Models…** in the app. Each model's entry gives the authors' own download link and licence.
You download the weights from the authors, accept their licence on your own Mac, and the app converts and checks
them there. `THIRD_PARTY_MODELS.md` lists every model, its source, its licence and its known limits. Several models
are licensed for non-commercial use only; check that your use is allowed.

## Licences

- OpenCephAI's own code: PolyForm Noncommercial License 1.0.0, for research and education only. Any commercial use
  needs prior written permission from Dr Linton Nash. Required Notice: Copyright © 2026 Dr Linton Nash. OpenCephAI.
  See `LICENSE` for the full terms.
- Fonts: the PDF report embeds two Noto Sans font files (`apps/desktop/src/report/fonts`), under the SIL Open Font
  License (OFL), with its licence file beside them.
- AI models and their weights: their authors' own licences (`THIRD_PARTY_MODELS.md`).
- Norm values: each set cites the paper it comes from (`reference/norms/sets`, `reference/norms/SOURCES.md`).

## Roadmap

### Now (1.1 Beta)

- AI tracing with several models. You verify every point.
- Automatic best: for each point it picks the model that is closest on your own verified films, with a choice of
  base model.
- Analyses and norms. The population is chosen automatically from the patient's details, with an automatic
  fallback when a norm is missing.
- A "far outside the usual position" warning on a point.
- The profilogram.
- Superimposition.
- The PDF report and CSV export.
- The Library table.

### Next

- A whole-film check (beta): does the tracing fit its film? It looks for a tracing on the wrong film, a mirrored
  tracing, or one at the wrong size.
- Report options: leave out the Points table, and the mm grid behind the profilogram.

### Later

- Your own personal AI model that learns your habits, always verified by you.
- Outline tracing.
- CVM staging.
- Soft-tissue profile.
- Windows.

## Legal disclaimer and terms of use

**1. Educational and research use only.**
OpenCephAI (the "Software") is a cephalometric tracing and analysis application for education, academic research and
teaching in orthodontics. It includes AI models that suggest landmark positions. Its tracings, landmark positions,
measurements, analyses, norm comparisons, reports, exports and any other outputs (collectively, "Content") are
intended solely for education and research.

**2. No medical advice or diagnostic function.**
The Software does not practise medicine, dentistry or orthodontics. It does not give medical or clinical advice and
does not diagnose. The Content does not constitute, and must not be used as a substitute for, professional
examination, diagnosis, prognosis or treatment planning. Using the Software creates no clinician–patient relationship.

**3. Clinician responsibility and independent judgement.**
A licensed clinician, dentist or orthodontist who uses the Software accepts that it is at most a research aid. The
user keeps sole and full professional responsibility for every clinical decision, diagnosis and treatment plan. The
user must check every landmark, tracing, measurement, norm and cited source independently, against the radiograph
and the primary literature, before relying on it in any setting. The AI models were tested only on the public
datasets named in `THIRD_PARTY_MODELS.md`. They may perform worse, or fail, on other machines, populations, age
groups or film types.

**4. Not a medical device.**
The Software is not registered, cleared, approved or otherwise regulated as a medical device or as Software as a
Medical Device (SaMD) by any regulator. That includes the Therapeutic Goods Administration (TGA, Australia), the
U.S. Food and Drug Administration (FDA), the European Medicines Agency (EMA) and EU notified bodies. It is
explicitly prohibited to use the Software to automate, dictate or bypass the independent diagnostic process of a
qualified health professional.

**5. No warranty and limitation of liability.**
The Software and its Content are provided "as is" and "as available", without warranties of any kind, express or
implied. That includes any implied warranty of medical accuracy, completeness or fitness for a particular purpose. To
the maximum extent permitted by applicable law, the developers, creators and distributors of the Software are not
liable for any direct, indirect, incidental, consequential or punitive damages arising out of or related to the use
of, or reliance on, the Software or its Content. That includes clinical complications, malpractice claims and
patient injury. This adds to the "No Liability" terms of the licence in `LICENSE`.
