# Norm sources: verified reading list (plan §9)

Verified on 2026-09-28. Every row below was checked against PubMed (metadata and PMID→PMCID lookup) or Crossref, not taken from memory.
It supersedes the owner's uploaded "Cephalometric Norms – Racial/Ethnic Validation" PDF and the §9 seed table where they disagree (see *Corrections*).

**Where the papers go:** save each PDF, and any extraction notes, in `reference/norms/local/`. That folder is git-ignored and every `.pdf` is git-ignored anyway, so copyrighted papers never reach GitHub (decision 21). Name files by first author and year, e.g. `local/kim-vietas-1978.pdf`.

**No values are recorded here.** ~~A norm enters `reference/norms/local/<population>/*.yaml` (local, like the papers) only after double extraction from the paper's own tables (§9 curation protocol).~~

**Updated 8 Oct 2026 (Part C):** norm values now live **in git**, as JSON, in `reference/norms/sets/<population>/<id>.json`
(master plan decision 21a, revised 6 Oct; JSON not YAML, owner 7 Oct). Each value carries its citation, table and page;
the papers themselves stay in `reference/norms/local/` and never go in git. Field meanings and what each kind of norm
can and cannot tell you: `reference/norms/sets/README.md`. The extraction workflow (two independent readings, a compare
tool that must first catch a planted typo, every difference settled against the page image, `pnpm norms:check`):
`docs/norms/HOW-TO-ADD-NORMS.md`.

**The population rule (owner rulings and answers, 7 Nov 2026):** an Indian patient uses the Caucasian norms (no Indian
set is on file; `normsOf`); a Malay patient uses the Malay sets below wherever they have the measurement, and the Chinese
norms only where they do not (`fallsBackTo`). Research reports no significant norm difference between these pairs. Held
in `reference/norms/populations.json`. Rows it supplies read "Norms: Caucasian (population rule)" or "Norms: Chinese
(population rule)". What this can and cannot tell you: `docs/norms/SEVERITY.md`, "Indian and Malay patients".

In the tables below, **Extracted 8 Oct** marks a row whose values are now in `reference/norms/sets/` (set id given).

Status key:
- **SOURCE**: paywalled; the owner obtains the PDF.
- **OA**: free full text in PubMed Central, so it can be read in full for extraction.
- **LOCATE**: the citation can't be verified in PubMed or Crossref.

## Tier 0: analysis definitions (needed before each analysis is built in)

These papers define *how* each built-in analysis is measured: landmarks, planes and sign conventions. Kim's APDI, for example, is the facial angle, with the A-B plane angle and the palatal plane angle each added or subtracted (Kim & Vietas 1978, abstract), and the ± rules are only in the full text. Definitions are taken from these sources, never reconstructed from memory.

| Analysis | Paper | PMID | DOI | Status |
|---|---|---|---|---|
| Steiner | Steiner CC. Cephalometrics for you and me. *Am J Orthod* 1953;39(10):729–755 | not indexed | 10.1016/0002-9416(53)90082-7 (Crossref ✓) | SOURCE: **saved locally 5 Oct 2026** (scan, `STEINER 1953.pdf`, with OCR text beside it). `steiner-1959.pdf` is a different paper (*Angle Orthod* 1959). **Extracted 8 Oct** (`steiner1953`) |
| Downs | Downs WB. *Am J Orthod* 1948;34(10):812–40 | 18882558 | 10.1016/0002-9416(48)90015-3 | SOURCE. **Extracted 8 Oct** from the *Angle Orthod* 1949 reprint on file (`downs1948`) |
| McNamara | McNamara JA. A method of cephalometric evaluation. *Am J Orthod* 1984;86(6):449–69 | 6594933 | 10.1016/s0002-9416(84)90352-x | SOURCE. **Extracted 8 Oct** (`mcnamara1984`) |
| Ricketts | Ricketts RM. A foundation for cephalometric communication. *Am J Orthod* 1960;46(5):330–357 | not indexed | 10.1016/0002-9416(60)90047-6 (Crossref ✓) | SOURCE. **Extracted 8 Oct**, E-line only (`ricketts1960`) |
| Ricketts (later summary) | Ricketts RM. Perspectives in the clinical application of cephalometrics. The first fifty years. *Angle Orthod* 1981;51(2):115–50 | 6942666 | 10.1043/0003-3219(1981)051<0115:PITCAO>2.0.CO;2 | SOURCE. **Extracted 8 Oct** (`ricketts1981`) |
| E-line (Ricketts) | Ricketts RM. Planning treatment on the basis of the facial pattern and an estimate of its growth. *Angle Orthod* 1957;27:14–37 | not indexed | not found in Crossref | **LOCATE** |
| Tweed (FMA) | Tweed CH. The Frankfort-mandibular plane angle in orthodontic diagnosis, classification, treatment planning, and prognosis. *Am J Orthod Oral Surg* 1946;32(4):175–230 | not indexed | 10.1016/0096-6347(46)90001-4 (Crossref ✓) | SOURCE |
| Tweed triangle (FMIA) | Tweed CH. The Frankfort-mandibular incisor angle (FMIA) in orthodontic diagnosis, treatment planning and prognosis. *Angle Orthod* 1954;24:121–169 | not indexed | not found in Crossref | **LOCATE**; PDF on file (`tweed-1954.pdf`). **Extracted 8 Oct** (`tweed1954`) |
| Björk (growth rotation) | Björk A. Prediction of mandibular growth rotation. *Am J Orthod* 1969;55(6):585–99 | 5253957 | 10.1016/0002-9416(69)90036-0 | SOURCE |
| Jarabak | Jarabak JR, Fizzell JA. *Technique and Treatment with Light-Wire Edgewise Appliances.* 2nd ed. Mosby, 1972 (book) | — | — | **LOCATE** (book). His values **extracted 8 Oct second-hand** via Alshahrani et al. 2018 Tables III–IV (`jarabak-via-alshahrani2018`) |
| Holdaway I | Holdaway RA. A soft-tissue cephalometric analysis and its use in orthodontic treatment planning. Part I. *Am J Orthod* 1983;84(1):1–28 | 6575614 | 10.1016/0002-9416(83)90144-6 | SOURCE. His values **extracted 8 Oct second-hand** via AlBarakati 2012 Table 3 (`holdaway1983-via-albarakati2012`) |
| Holdaway II | Holdaway RA. … Part II. *Am J Orthod* 1984;85(4):279–93 | 6585146 | 10.1016/0002-9416(84)90185-4 | SOURCE |
| Kim ODI | Kim YH. Overbite depth indicator with particular reference to anterior open-bite. *Am J Orthod* 1974;65(6):586–611 | 4524490 | 10.1016/0002-9416(74)90255-3 | SOURCE. **Extracted 8 Oct** (`kim1974`) |
| Kim APDI (and CF = ODI + APDI) | Kim YH, Vietas JJ. Anteroposterior dysplasia indicator: an adjunct to cephalometric differential diagnosis. *Am J Orthod* 1978;73(6):619–33 | 276266 | 10.1016/0002-9416(78)90223-3 | SOURCE. Confirm where CF is defined when you have the text. **Extracted 8 Oct**, APDI (`kimvietas1978`); CF and extraction index still website values (`onfile-kim-cf-ei`) |
| Wits | Jacobson A. The "Wits" appraisal of jaw disharmony. *Am J Orthod* 1975;67(2):125–38 | 1054214 | 10.1016/0002-9416(75)90065-2 | SOURCE. **Extracted 8 Oct** (`jacobson1975`; men −1.17 by owner ruling 7 Oct) |

### Landmark definitions (owner, 5 Oct 2026)

| Use | Source | Status |
|---|---|---|
| The official definition of each lateral cephalometric landmark (the landmark catalogue, master plan §3.1) | Miyashita K, ed. Dixon AD. *Contemporary Cephalometric Radiography*. Quintessence. "Glossary of Cephalometric Terms and Definitions" (16-page excerpt; year and pages to confirm from the book's title page) | Used for point definitions, Part D Task 8, own words, double-read |

## Tier 1: the first verified norm sets (Week 5)

| # | Population | Paper | PMID | DOI | Status | Sample / analyses (from the PubMed abstract) |
|---|---|---|---|---|---|---|
| 1 | Caucasian (classic) | Downs WB. Variations in facial relationships; their significance in treatment and prognosis. *Am J Orthod* 1948;34(10):812–40 | 18882558 | 10.1016/0002-9416(48)90015-3 | SOURCE. **Extracted 8 Oct** (`downs1948`) | Origin of the Downs norms (no abstract in PubMed) |
| 2 | Caucasian (classic) | Steiner CC. Cephalometrics for you and me. *Am J Orthod* 1953;39(10):729–755 | not indexed | 10.1016/0002-9416(53)90082-7 (Crossref ✓) | SOURCE. **Extracted 8 Oct** (`steiner1953`) | Origin of the Steiner norms |
| 3 | Caucasian (classic) | McNamara JA. A method of cephalometric evaluation. *Am J Orthod* 1984;86(6):449–69 | 6594933 | 10.1016/s0002-9416(84)90352-x | SOURCE. **Extracted 8 Oct** (`mcnamara1984` own norms; `mcnamara1984-annarbor`, `-bolton`, `-burlington` Caucasian samples) | Standards for maxilla, mandible, incisors, airway |
| 4 | Caucasian, age × sex | Bishara SE, Peterson LC, Bishara EC. *Am J Orthod* 1984;85(3):238–52 | 6584033 | 10.1016/0002-9416(84)90063-0 | SOURCE | 20 M / 15 F, 5–25.5 y, longitudinal. The abstract doesn't say "Iowa"; confirm in the text |
| 5 | European (Swedish) | Thilander B, Persson M, Adolfsson U. *Eur J Orthod* 2005;27(4):370–89 | 16043474 | 10.1093/ejo/cji033 | SOURCE. **Extracted 8 Oct** (`thilander2005`) | 469 cephalograms, 5–31 y, both sexes, untreated normal occlusion. NSL/ML framework, so `definitionMatch` needs care |
| 6 | Chinese (Hong Kong) | Wu J, Hägg U, Rabie ABM. Chinese norms of McNamara's cephalometric analysis. *Angle Orthod* 2007;77(1):12–20 | 17029538 | 10.2319/021606-62R.1 | SOURCE. **Extracted 8 Oct** (`wu2007`) | 200 M / 205 F random 12-year-olds, plus 43 / 43 Caucasian; McNamara |
| 7 | Chinese (southern) | Cooke MS, Wei SH. Cephalometric standards for the southern Chinese. *Eur J Orthod* 1988;**10(3)**:264–72 | 3053214 | 10.1093/ejo/**10.3**.264 | SOURCE | No abstract in PubMed |
| 8 | Chinese (Peking adults) | Gu Y, McNamara JA, Sigler LM, et al. *Eur J Orthod* 2011;33(2):205–11 (e-published 2010) | 20709723 | 10.1093/ejo/cjq054 | SOURCE. **Extracted 8 Oct** (`gu2011` Chinese, `gu2011-caucasian` Michigan group) | 25 M / 40 F, about 19–20 y, normal occlusion; compared with 90 Caucasians |
| 9 | Chinese (mainland, broadest) | Zheng et al. *Chin J Dent Res* 2026;29(2):151–161 | 42377374 | 10.3290/j.cjdr.b7044059 | SOURCE. **Extracted 8 Oct** (`zheng2026`) | 60 adolescents + 60 adults, 1:1 sex, expert-rated harmony; Tweed / Downs / Steiner / PKU / soft tissue |
| 10 | Chinese (compilation) | Moate SJ, Darendeliler MA. Cephalometric norms for the Chinese: a compilation of existing data. *Aust Orthod J* 2002;18(1):19–26 | 12502125 | — | SOURCE. **Extracted 8 Oct**: 11 second-hand sets `moate2002-<study>` (primaries not on file) | A review, so secondary: use it to find primary sources, and prefer the primaries' values |
| 11 | Singaporean Chinese | Yeong P, Huggare J. Morphology of Singapore Chinese. *Eur J Orthod* 2004;26(6):605–12 | 15650070 | 10.1093/ejo/26.6.605 | SOURCE | 31 M / 50 F, about 12.6 y, Class I incisors; 27 variables |
| 12 | Singapore Chinese / Malay / Indian | Lew KK. Cephalometric ideals in Chinese, Malay and Indian ethnic groups. *Asian J Aesthet Dent* 1994;2(1):35–8 | 9063112 | — | SOURCE | 105 F (35 per group); Steiner. Women only |
| 13 | Singaporean Chinese (soft tissue) | Lew KK, Ho KK, Keng SB, et al. *J Oral Maxillofac Surg* 1992;50(11):1184–9 | 1403274 | 10.1016/0278-2391(92)90151-o | SOURCE | 48 adults judged esthetic; Legan–Burstone, Holdaway |
| 14 | Malay (women) | Cheong et al. *Eur J Dent* 2025;19(1):214–219 (e-published 2024) | 39013444 | 10.1055/s-0044-1787005 | **OA** (PMC11750322). **Extracted 8 Oct** (`cheong2024`; ANB not entered, it was an inclusion criterion) | 85 F, 20–40 y, skeletal Class I; H angle |
| 15 | Malay (both sexes) | Mohammad HA, Hassan A, Hussain SF. Cephalometric evaluation for Malaysian Malay by Steiner analysis. *Scientific Research and Essays* 2011;6(3):627–634 | not indexed | not found in Crossref | **LOCATE**; PDF on file 8 Oct (doi 10.5897/SRE10.869). **Extracted 8 Oct** (`mohammad2011`) | Claimed 30 M / 30 F (confirmed: 60 analysed, 20–24 y). The only both-sex Malay Steiner set, but unverified. Please find the PDF |
| 16 | African-American | Kim et al. *J Orofac Orthop* 2025;87(5):477–489 | 40664770 | 10.1007/s00056-025-00598-7 | **OA** (PMC13503480); PDF on file. **Extracted 13 Oct** (`kim2025`, 37 entries; status in app: verified, ranked as an ordinary Class I sample, owner KIMRANK-1, 13 Oct — first merged as a treatment-seeking sample, P37) | 25 F / 9 M, mean 28.4 y, Class I; Steiner / Tweed / Downs / Ricketts / Björk–Jarabak. Small n, so flag it |
| 17 | African-American | Connor AM, Moshiri F. *Am J Orthod* 1985;87(2):119–34 | 3855605 | 10.1016/0002-9416(85)90021-1 | SOURCE | 25 M / 25 F Black + 50 White, 18–50 y, Class I; 24 measures |
| 18 | African-American (growth) | Bailey KL, Taylor RW. *Am J Orthod Dentofacial Orthop* 1998;114(2):218–23 | 9714287 | 10.1053/od.1998.v114.a87104 | SOURCE. **Extracted 8 Oct** (`baileytaylor1998`) | 71 subjects, 8–20 y, 4 age/sex groups, Class I; mesh diagram. *(8 Oct: the paper prints no SDs; the entered means are the 41 children aged 8–12 y, sexes pooled)* |

## Tier 2: further populations (after Tier 1)

| Population | Paper (PMID · DOI) | Status | Note |
|---|---|---|---|
| Norwegian | el-Batouti, Øgaard, Bishara 1994, *Eur J Orthod* 16(6):501–9 (7720795 · 10.1093/ejo/16.6.501) | SOURCE | 39 F / 35 M, 6–18 y; Oslo measurements |
| Polish | Obłój, Fudalej, Dudkiewicz 2008, *Angle Orthod* 78(2):262–9 (18251596 · 10.2319/011207-14.1) | SOURCE | 39 M / 34 F, 10 y, Class I |
| Turkish adults | Başçiftçi, Uysal, Büyükerkmen 2004, *AJODO* 125(3):366–72 (15014417 · 10.1016/j.ajodo.2003.04.004) | SOURCE | 50 M / 55 F, 19–25 y |
| Japanese | Miyajima et al. 1996, *AJODO* 110(4):431–8 (8876496 · 10.1016/s0889-5406(96)70047-1) | SOURCE | 26 M / 28 F adults, ideal occlusion |
| Japanese | Ioi, Nakata, Nakasima, Counts 2007, *Eur J Orthod* 29(5):493–9 (17974539 · 10.1093/ejo/cjm059) | SOURCE | 25 M / 24 F, ANB 2–5° |
| Japanese | Alcalde et al. 1998, *J Oral Maxillofac Surg* 56(2):129–34 (9461133 · 10.1016/s0278-2391(98)90849-7) | SOURCE. **Extracted 8 Oct** (`alcalde1998`) | 217 adults; Burstone / Legan |
| Japanese soft tissue | Alcalde et al. 2000, *AJODO* 118(1):84–9 (10893477 · 10.1067/mod.2000.104411) | SOURCE. **Extracted 8 Oct** (`alcalde2000`) | 211 adults; Ricketts / Epker / Holdaway / Legan |
| Korean | Park, Bowman, Klapper 1989, *AJODO* 96(1):54–9 (2750721 · 10.1016/0889-5406(89)90229-1) | SOURCE | 35 M / 45 F, 18 y |
| Korean | Jeong et al. 2024, *Sci Rep* 14:9660 (38671196 · 10.1038/s41598-024-60410-1) | **OA** (PMC11053105) | 368 M / 367 F, but a network-correlation study; check it has norm tables |
| North Indian | Singh, Utreja, Jena 2013, *Contemp Clin Dent* 4(4):460–6 (24403789 · 10.4103/0976-237X.123041) | **OA** (PMC3883324) | 46 M / 54 F, 14–24 y |
| Nepalese | Sharma 2011, *J Orthod* 38(1):21–31 (21367825 · 10.1179/14653121141209) | SOURCE | 120 subjects, 16–21 y; Steiner |
| South Indian soft tissue | Kalha, Latif, Govardhan 2008, *AJODO* 133(6):876–81 (18538252 · 10.1016/j.ajodo.2006.05.043) | SOURCE | 30 M / 30 F |
| Filipino | Moldez et al. 2006, *Angle Orthod* 76(5):800–5 (17029513) | SOURCE | 78 M / 79 F |
| Filipino | Naranjilla, Rudzki-Janson 2005, *Angle Orthod* 75(1):63–8 (15747817) | SOURCE | 44 M / 37 F adults |
| Indonesian (Deutero-Malay) | Munandar, Snow 1995, *Aust Dent J* 40(6):381–8 (8615744 · 10.1111/j.1834-7819.1995.tb04837.x) | SOURCE | 50 subjects, mixed ages; Downs |
| Thai | Suchato, Chaiwat 1984, *J Dent Assoc Thai* 34(5):233–43 (6599548) | SOURCE | No abstract; hard to obtain |
| Mexican-American | Swlerenga, Oesterle, Messersmith 1994, *AJODO* 106(2):146–55 (8059750 · 10.1016/s0889-5406(94)70032-x) | SOURCE | 23 M / 25 F adults |
| Mexican | Bishara, Fernandez 1985, *Am J Orthod* 88(4):314–22 (3863489 · 10.1016/0002-9416(85)90131-9) | SOURCE | 36 M / 45 F, about 13 y |
| Saudi | Al-Jasser 2005, *J Contemp Dent Pract* 6(2):52–63 (15915204 · 10.5005/jcdp-6-2-52) | SOURCE | 30 M / 30 F, 20–30 y; Downs / Steiner |
| Saudi | Hassan 2006, *Angle Orthod* 76(1):109–13 (16448278) | SOURCE | 38 M / 32 F, 18–28 y |
| Iranian | Azarbayejani et al. 2014, *Dent Res J* 11(3):327–35 (25097642) | **OA** (PMC4119365) | 96 M / 142 F, 6–17 y |
| Nigerian | Ajayi 2005, *AJODO* 128(5):653–6 (16286214 · 10.1016/j.ajodo.2005.07.002) | SOURCE | 100 Igbo children, 11–13 y |
| British vs Chinese | Cooke, Wei 1989, *Angle Orthod* 59(2):131–8 (2729666) | SOURCE | 12-year-old boys only, a comparison study; **not** a British norm set |

## Added during Part C (7–8 Oct 2026), not on the 28 Sep list

| Population | Paper | Status |
|---|---|---|
| Saudi (Holdaway) | AlBarakati SF, Bindayel NA. *King Saud Univ J Dent Sci* 2012;3:27–32 (doi 10.1016/j.ksujds.2011.10.004) | **Extracted 8 Oct** (`albarakati2012`; also gives Holdaway's own values, `holdaway1983-via-albarakati2012`) |
| Saudi (Björk–Jarabak) | Alshahrani I, Kamran MA, Alhaizaey A, Abumelha N. *Pak J Med Sci* 2018;34(5):1104–9 (PMC6191777, doi 10.12669/pjms.345.15556). Earlier notes called it "Khan" — wrong | **Extracted 8 Oct** (`alshahrani2018`; Jarabak's own values from Tables III–IV, `jarabak-via-alshahrani2018`) |
| Malay (Eastman) | Norman NH et al. *Int Med J* 2020;27(2):216–9 (owner's cross-check link, MAL-1) | **Extracted 8 Oct** (`norman2020`) |
| African-American (Kim indices) | Obamiyi S et al. *Angle Orthod* 2019;89(6):897–902 (doi 10.2319/021619-116.1) | **Extracted 8 Oct** (`obamiyi2019`) |
| Latin American (Kim indices) | Caballero-Purizaga PJ et al. *Dental Press J Orthod* 2019;24(3):46–54 (doi 10.1590/2177-6709.24.3.046-054.oar) | **Extracted 8 Oct** (`caballero2019`) |
| Eastman (own norm, U1–MxP) | Naini FB 2011, *Facial Aesthetics*, Ch. 7 p. 111 | **Extracted 8 Oct** (`eastman-naini`) |
| NUS (own norms), set 1: Chinese and Malay patients | Data on file (NUS norms): the NUS teaching sheet, first column set (no author, year or sample printed; earlier called the NDC sheet, the same source) | **Extracted 8 Oct** (`ndc-sheet`); reworded "Data on file (NUS norms)" and assigned to Chinese and Malay patients, owner ruling 7 Nov 2026; no number changed |
| NUS (own norms), set 2: Caucasian and Indian patients | Data on file (NUS norms): the same sheet, second column set | **Transcribed 7 Nov** by the owner (`nus-set2`, single-extracted, shown as unverified); switched on 7 Nov 2026. Filled by owner ruling: U1 to SN from the app's ABO norm (102 ± 2°; agrees with 108 − 8 = 100°); L1 to APo pooled from Gu 2011 + McNamara 1984 Ann Arbor adults (2.42 ± 1.68 mm, N 201); SDs of Wits, LAFH %, OJ, OB from set 1. BaSN blank |
| Eastman standards | Alassiry Ahmed 2022, *Bioinformation* (PMC10492906) | **Extracted 13 Oct** (`alassiry2022-eastman`, 9 entries, second-hand Eastman standards; status in app: verified) |
| Björk–Jarabak, Middle-Eastern / Jordanian | Al Maaitah et al. 2022, *Angle Orthod* (PMC9374356) | **Extracted 13 Oct** (`jordanian/almaaitah2022`, Class I group, 4 entries; status in app: verified, ranked as an ordinary Class I sample, owner KIMRANK-1; own population 'jordanian', owner JORDAN-1, 13 Oct — first merged under Caucasian as a treatment-seeking sample, P37) |
| Jarabak via Al Maaitah 2022 | Al Maaitah et al. 2022 (same paper) | Checked 13 Oct, no usable Jarabak values — only two quoted cut-offs (`jarabak-via-almaaitah2022` not created) |

## Added for Part E (13 Oct 2026): committed-set and design-spec citations not yet listed above

Found by checking every citation in `reference/norms/sets/**/*.json` and the 6 Oct design spec
(§"Part E") against this file.

### Data on file (primary source being confirmed)

Used, `status: "website"` (shown, never coloured), where no paper gives the measurement. The primary paper for
each set is still to be found. Each set's citation year (2026) records when the values were
copied, not a publication date:

| Set id | Analysis |
|---|---|
| `onfile-abo` | ABO |
| `onfile-bjork-jarabak` | Björk–Jarabak (and one ratio, #44, from a second source on file) |
| `onfile-nagasaki` | Nagasaki |
| `onfile-radney` | Radney |
| `onfile-kim-cf-ei` | Kim (combination factor, extraction index) |

Also cited (S mark, catalogue §6 second-hand list; no committed norm set, no values — definitions
and Björk–Jarabak #43's "no norm of any kind" note only): the same "data on file".

### Moate & Darendeliler 2002's primaries (second-hand only; primaries not on file)

Each is cited inside a committed `moate2002-<study>.json` set with `secondHand.via` pointing at a
table in Moate SJ, Darendeliler MA. Cephalometric norms for the Chinese: a compilation of existing
data. *Aust Orthod J* 2002;18(1):19–26 (PMID 12502125; already listed, Tier 1 #10). The primary
papers themselves were never obtained — Moate's compiled numbers are used, marked second-hand.

| Set id | Paper | Via |
|---|---|---|
| `moate2002-chan1972` | Chan GK. A cephalometric appraisal of the Chinese. *Am J Orthod* 1972;61(3):279–85 | Moate Table IV |
| `moate2002-chen1985` | Chen YX. Lateral cephalometry in 100 Harbin children with normal occlusion. *Chung-Hua Kou Chiang Ko Tsa Chih* 1985;20(1):45–8 | Moate Table II |
| `moate2002-cheng1986` | Cheng FG. A cephalometric study of the Chinese in profile. *Aust Orthod J* 1986;9(3):285–8 | Moate Table IV |
| `moate2002-fu1975` | Fu M-K, Mao ST. A roentgenographic cephalometric study of 144 Chinese with normal occlusion. *Chung-Hua Kou Chiang Ko Tsa Chih* 1975;12:865–7 | Moate Tables I, II, III, IV |
| `moate2002-lou1981` | Lou ZH. Roentgenographic cephalometric study of 128 children with normal occlusion in Shanghai (author's translation). *Chung-Hua Kou Chiang Ko Tsa Chih* 1981;16(2):100–3 | Moate Table III |
| `moate2002-miao1995` | Miao Y, Xuerong T, Yiyue X. A study of craniofacial structure of normal occlusion in the south of China. *Chinese Journal of Orthodontics* 1995;3(4):109–111 | Moate Tables I, III, IV |
| `moate2002-so1990` | So LL, Davis PJ, King NM. Wits appraisal in southern Chinese children. *Angle Orthod* 1990;60(1):43–8 | Moate Table V |
| `moate2002-wei1968` | Wei SH. A roentgenographic cephalometric study of prognathism in Chinese males and females. *Angle Orthod* 1968;38(4):305–20 | Moate Table IV |
| `moate2002-yen1973` | Yen PK. The facial configuration in a sample of Chinese boys. *Angle Orthod* 1973;43(3):301–4 | Moate Table II |

None of these nine has a PMID or DOI recorded in its set JSON; DOI not recorded for any of them here
either (none invented). No PDF for any of the nine is on file — only Moate's restatement is used.

### Named in the 6 Oct design spec, not yet in this file

| Paper | PMID | DOI | Status |
|---|---|---|---|
| AlBarakati 2012 | — | — | Already listed above (Tier 1 "Added during Part C", `albarakati2012`) — no action needed, listed here only because the design spec names it again |
| Naini Ch. 7 | — | — | Already listed above (Tier 0 "Landmark definitions" and "Added during Part C", `eastman-naini`) — no action needed |
| Gu, McNamara. [title not recorded]. *Angle Orthod* 2007;77:947–53 | not recorded | not recorded | SOURCE, on file (`2007 Gu and McNamara.pdf`). **Not** the Chinese/Caucasian adult set already extracted as `gu2011`/`gu2011-caucasian` (Gu Y, McNamara JA, Sigler LM, et al. *Eur J Orthod* 2011 — a different paper by an overlapping author list). This 2007 paper is a Caucasian growth set (20 Californian children, UCSF Mathews–Ware sample; the paper does not state ethnicity — Caucasian by owner ruling) giving mandibular lengths (e.g. Co–Gn) as mean ± SD at each CVM stage CS1–CS6. Not yet extracted into `reference/norms/sets/`; reserved for McNamara's age-based norms and for the CVM spec |
| Arnett [given names not recorded] 1999. [title not recorded] | not recorded | not recorded | **LOCATE.** Named only in the 6 Oct design spec's Part E reading list; no PDF on file, not cited by any built analysis or committed norm set yet. Not located during this pass — flagging for the owner rather than guessing a title or DOI |
| Oh et al. [*Craniofacial growth percentile curves*], Craniofacial Growth Consortium Study. *AJODO* 2026 | not recorded | not recorded | **Deferred** (owner 7 Oct; `percentileModel`, its own task). Paper not on file. Curve-parameter supplement: figshare `10.6084/m9.figshare.29424749` (cited in the design spec; licence not yet read) |

## Gaps (no suitable paper found in PubMed)

- **Australian Caucasian radiographic norms:** none indexed. The closest are Grave et al. 1999 (PMID 10327736; Adelaide dental students used as controls) and Wei et al. 2011 (PMID 21623804; 3D facial scans, not radiographs), and neither is a norm set. The owner confirmed on 2026-09-28 that no local set exists. Australian patients of European ancestry are therefore compared with the European and North American Caucasian sets (Tier 1 #1–5), and the app labels them as such, not as Australian norms.
- **Malay adults, both sexes, n ≥ 50:** none indexed. Mohammad 2011 is the only candidate, and it is unverified. *(8 Oct: Mohammad 2011's PDF is on file (n 60) and Norman 2020 (n 100, 15–30 y) is a second both-sex set.)*
- **Singaporean adults, both sexes:** none found. Lew 1994 is women only; Yeong 2004 covers children.

## Corrections to earlier lists

- **Cooke & Wei 1988** is in volume 10, **issue 3**, pages 264–72, so its DOI is `10.1093/ejo/10.3.264`. The uploaded PDF gives issue 1 and `10.1093/ejo/10.1.264`, which is wrong.
- The uploaded PDF's **"Paper 9"** (soft-tissue norms in Japanese adults, 2000) lists no authors. It is **Alcalde RE, Jinno T, Orsini MG, et al.**, *AJODO* 118(1):84–9, PMID 10893477.
- **Cheong:** the e-publication date is 2024 (§9 said 2025). **Gu:** e-published 2010, printed 2011.
- **Mohammad 2011:** the uploaded PDF's journal correction (*Scientific Research and Essays*) can't be confirmed. The paper isn't in PubMed or Crossref, so it stays **LOCATE**.
- The uploaded PDF's other corrections hold: Moate & Darendeliler 2002 (not "Hagg & Cooke 2003"), Lew 1994 = PMID 9063112, and Wu/Hägg/Rabie 2007 as a separate paper.
- **Bishara 1984** and **Jeong 2024** carry caveats (see the tables above); read the full text before relying on them.
- **`McNamara2003.pdf` and `McNamara 2003 Exp + long term arch changes.pdf`** (local only, not in git) are the
  same file, an arch-width study with no cephalometric norms. One copy can be deleted; nothing is missing from
  this reading list because of it.
- **Gu & McNamara, *Angle Orthod* 2007;77:947–53** (`2007 Gu and McNamara.pdf`, local only) is a **Caucasian**
  growth set by CVM stage (20 Californian children), **not** a Chinese set — do not confuse it with Gu, McNamara,
  Sigler, et al. *Eur J Orthod* 2011 (Tier 1 #8, the Chinese/Caucasian adult comparison, `gu2011`/`gu2011-caucasian`).
  See "Named in the 6 Oct design spec" above.
