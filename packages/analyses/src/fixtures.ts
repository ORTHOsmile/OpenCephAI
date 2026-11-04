import type { Vec2 } from '@ceph/geometry';
/** SYNTHETIC skulls for tests: hand-made coordinates in image px (y down, facing right). Not patient data. */
const base: Record<string, Vec2> = {
  S: { x: 0, y: 0 }, N: { x: 700, y: -100 }, A: { x: 720, y: 300 }, B: { x: 690, y: 650 }, Pog: { x: 700, y: 760 },
  Gn: { x: 680, y: 820 }, Me: { x: 640, y: 850 }, Go: { x: 150, y: 700 }, Po: { x: -200, y: 100 }, Or: { x: 560, y: 80 },
  ANS: { x: 740, y: 220 }, PNS: { x: 260, y: 240 }, Co: { x: -50, y: 150 }, Ar: { x: -40, y: 200 },
  U1T: { x: 745, y: 520 }, L1T: { x: 735, y: 530 }, UL: { x: 800, y: 440 }, LL: { x: 790, y: 590 }, Sn: { x: 790, y: 280 }, PogS: { x: 770, y: 800 },
  U1A: { x: 690, y: 300 }, L1A: { x: 660, y: 740 }, U6: { x: 470, y: 520 }, L6: { x: 470, y: 540 }, P4: { x: 590, y: 525 },
  U6D: { x: 440, y: 520 }, D: { x: 650, y: 760 }, Cm: { x: 820, y: 250 }, Prn: { x: 880, y: 200 }, Ba: { x: -120, y: 300 },
  Pt: { x: 280, y: 150 }, PTM: { x: 270, y: 170 }, PR: { x: 275, y: 160 }, Bo: { x: -200, y: 280 }, G: { x: 760, y: -250 },
  Ns: { x: 740, y: -100 }, GnS: { x: 740, y: 860 }, MeS: { x: 680, y: 900 }, Cerv: { x: 500, y: 1000 },
  ULs: { x: 785, y: 360 }, LLs: { x: 760, y: 690 }, St: { x: 792, y: 515 }, Tg: { x: 300, y: 800 }, RT: { x: 110, y: 600 },
  R1: { x: 270, y: 500 }, R2: { x: 90, y: 480 }, R3: { x: 180, y: 330 }, R4: { x: 200, y: 760 }, Pm: { x: 665, y: 720 },
  DC: { x: -30, y: 260 }, SPog: { x: 705, y: 740 }, SPogS: { x: 775, y: 780 }, ULd: { x: 800, y: 330 }, U1L: { x: 760, y: 480 },
  SPP: { x: 250, y: 300 }, UPW: { x: 150, y: 310 }, TM: { x: 380, y: 720 }, LPW: { x: 280, y: 730 },
};
const shift = (dx: number, dy: number, only: string[]) =>
  Object.fromEntries(Object.entries(base).map(([k, v]) => [k, only.includes(k) ? { x: v.x + dx, y: v.y + dy } : v]));
export const SYNTHETIC_SKULLS: { name: string; points: Record<string, Vec2> }[] = [
  { name: 'SYNTHETIC balanced', points: base },
  { name: 'SYNTHETIC retrusive mandible', points: shift(-60, 0, ['B', 'Pog', 'Gn', 'Me']) },
  { name: 'SYNTHETIC protrusive maxilla', points: shift(40, 0, ['A', 'ANS', 'U1T']) },
  { name: 'SYNTHETIC long face', points: shift(0, 90, ['Me', 'Gn', 'Pog', 'B']) },
  // 'Tg' added here (ruling, Task 6 fix round 1): without it, Me rose above the
  // lower-border tangent point Tg (300,800), making the jaw's lower border slope backwards —
  // not a real mandible. Tg now moves with Me/Gn/Pog/B so the tangent keeps its real direction.
  { name: 'SYNTHETIC short face', points: shift(0, -70, ['Me', 'Gn', 'Pog', 'B', 'Tg']) },
  { name: 'SYNTHETIC proclined incisors', points: shift(30, 0, ['U1T', 'L1T', 'U1L']) },
];
