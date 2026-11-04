import { describe, it, expect } from 'vitest';
import { LANDMARKS, ISBI19, MANUAL_ONLY, type LandmarkId } from './landmarks';
import { SYNTHETIC_SKULLS } from './fixtures';

/** Task 2 catalogue table (brief, task-2-brief.md). id -> [name, category, source]. */
const NEW_CATALOGUE: Record<string, [string, string, string]> = {
  D: ['Point D (centre of symphysis)', 'skeletal', 'Steiner via Naini Table 7.1; CL-Detection 2023 Fig 3 #20'],
  Cm: ['Columella', 'soft', 'CL-Detection 2023 Fig 3 #23'],
  PTM: ['Pterygomaxillary fissure, top-back point', 'skeletal', 'McNamara 1984 p460; CL-Detection #24'],
  PR: ['Back of pterygopalatine fossa (PTV point)', 'skeletal', 'Ricketts 1981 p136'],
  Bo: ['Bolton point', 'skeletal', 'Naini Table 7.1; CL-Detection #29'],
  G: ['Soft-tissue glabella', 'soft', 'Naini Table 7.3; CL-Detection #34'],
  GnS: ['Soft-tissue gnathion', 'soft', 'Naini Table 7.3; CL-Detection #32'],
  MeS: ['Soft-tissue menton', 'soft', 'Naini Table 7.3; CL-Detection #33'],
  Cerv: ['Cervical point', 'soft', 'Naini Table 7.3; CL-Detection #36'],
  ULs: ['Upper lip sulcus (soft-tissue A)', 'soft', "Naini Table 7.3 (supralabiale); CL-Detection #30 UL′, to confirm on films (Part B)"],
  LLs: ['Lower lip sulcus (soft-tissue B)', 'soft', "Naini Table 7.3 (sublabiale); CL-Detection #31 LL′, to confirm on films (Part B)"],
  St: ['Stomion', 'soft', 'Naini Table 7.3'],
  P4: ['Premolar cusp overlap', 'dental', 'Jacobson 1975 (functional occlusal plane)'],
  U6D: ['Upper first molar, distal surface', 'dental', 'Ricketts 1981 p136'],
  Tg: ['Lower-border tangent point (near the angle)', 'skeletal', 'Downs 1948 p150; Tweed 1946 p187; Kim 1974 p589'],
  RT: ['Ramus tangent point', 'skeletal', 'ABO 2025 slide 8 (constructed gonion)'],
  R1: ['Ramus point R1 (deepest point of the anterior ramus border)', 'skeletal', 'Ricketts 1981 p131'],
  R2: ['Ramus point R2 (posterior ramus border, opposite R1)', 'skeletal', 'Ricketts 1981 p131'],
  R3: ['Ramus point R3 (deepest point of the sigmoid notch)', 'skeletal', 'Ricketts 1981 p131'],
  R4: ['Ramus point R4 (lower border, below R3)', 'skeletal', 'Ricketts 1981 p131'],
  Pm: ['Protuberance menti', 'skeletal', 'Ricketts 1981 p131'],
  DC: ['Centre of the condyle neck', 'skeletal', 'Ricketts 1981 p130'],
  SPog: ['Suprapogonion', 'skeletal', 'AlBarakati 2012 (Ricketts 1957)'],
  SPogS: ['Soft tissue over suprapogonion', 'soft', 'AlBarakati 2012'],
  ULd: ['Upper lip drape, level with the point 3 mm below A', 'soft', 'AlBarakati 2012'],
  U1L: ['Most labial point of the U1 crown', 'dental', 'AlBarakati 2012 (upper lip thickness); Steiner 1953'],
  SPP: ['Back of the soft palate (front half)', 'soft', 'McNamara 1984 p463'],
  UPW: ['Upper pharyngeal wall point', 'soft', 'McNamara 1984 p463'],
  TM: ['Tongue × lower border of mandible', 'soft', 'McNamara 1984 p463'],
  LPW: ['Lower pharyngeal wall point', 'soft', 'McNamara 1984 p463'],
};

const NEW_IDS = Object.keys(NEW_CATALOGUE) as LandmarkId[];

describe('landmarks: Part A task 2 catalogue', () => {
  it('every new catalogue id exists in LANDMARKS with the right name, category and a non-empty source', () => {
    for (const id of NEW_IDS) {
      const entry = LANDMARKS[id] as unknown as { name: string; category: string; source: string } | undefined;
      expect(entry, `missing LANDMARKS entry for ${id}`).toBeDefined();
      const [name, category] = NEW_CATALOGUE[id];
      expect(entry!.name).toBe(name);
      expect(entry!.category).toBe(category);
      expect(entry!.source).toBeTruthy();
    }
  });

  it('every LANDMARKS entry (existing and new) has a non-empty source', () => {
    for (const id of Object.keys(LANDMARKS) as LandmarkId[]) {
      const entry = LANDMARKS[id] as unknown as { source: string };
      expect(entry.source, `missing source for ${id}`).toBeTruthy();
    }
  });

  it('every new id is in MANUAL_ONLY and has aiDetected: false', () => {
    for (const id of NEW_IDS) {
      expect(MANUAL_ONLY, `${id} missing from MANUAL_ONLY`).toContain(id);
      expect(LANDMARKS[id].aiDetected).toBe(false);
    }
  });

  it('ISBI19 is unchanged', () => {
    expect(ISBI19).toEqual(['S','N','Or','Po','A','B','Pog','Me','Gn','Go','L1T','U1T','UL','LL','Sn','PogS','PNS','ANS','Ar']);
  });

  it('every fixture skull has every LANDMARKS id (positive control: fixtures cover the catalogue)', () => {
    const allIds = Object.keys(LANDMARKS) as LandmarkId[];
    for (const skull of SYNTHETIC_SKULLS) {
      for (const id of allIds) {
        expect(skull.points[id], `${skull.name} is missing point ${id}`).toBeDefined();
      }
    }
  });
});

describe('landmarks: the points Aariz finds cite Aariz\'s own landmark title (final review M6)', () => {
  // Titles verbatim from the dataset's config.py (github.com/manwaarkhd/aariz-cephalometric-dataset). The dataset gives
  // titles only, no written definitions; our definition stays Naini's.
  const AARIZ_TITLE: Partial<Record<LandmarkId, string>> = {
    U6: 'Upper Molar Cusp Tip', L6: 'Lower Molar Cusp Tip', Ns: 'Soft Tissue Nasion', PogS: 'Soft Tissue Pogonion',
    U1A: 'Upper Incisor Apex', L1A: 'Lower Incisor Apex', Co: 'Condylion', Prn: 'Pronasale',
  };
  for (const [id, title] of Object.entries(AARIZ_TITLE)) {
    it(`${id} cites Aariz config.py "${title}"`, () => {
      expect(LANDMARKS[id as LandmarkId].source).toContain(`Aariz config.py "${title}"`);
    });
  }
});
