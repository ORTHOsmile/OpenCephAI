import { describe, it, expect } from 'vitest';
import { compile, type Vec2 } from '@ceph/geometry';
import { buildRegistry } from './registry';
import { ALL_ANALYSES } from './analyses';
import { PLUS_WORDS } from './catalogue/screen-signs';
import { SYNTHETIC_SKULLS } from './fixtures';

/** Per-sign-rule behaviour guard (Task 2 re-review recommendation, owner approved 12 Oct). Each plain sign rule in
 *  PLUS_WORDS is checked against what the app computes: the phrase the case tests must be IN the words (so flipping a
 *  word fails the test), and moving the named point the stated way on a SYNTHETIC skull must move the value the way
 *  the words say. Every case runs on the right-facing skull and on its mirror image (a left-facing film, FACING-1),
 *  where "forward" is −x. "Down" is image +y on both. */
type Dir = 'forward' | 'back' | 'down' | 'up';
interface Case {
  phrase: string;       // must appear in PLUS_WORDS[no]
  id: string;           // catalogue node evaluated
  move: string[];       // points moved together
  dir: Dir;
  px: number;
  /** 'up' / 'down': the value increases / decreases when the points move the stated way; '+' / '−': it has that sign afterwards. */
  expect: 'up' | 'down' | '+' | '−';
}
const R = (phrase: string, id: string, move: string[], dir: Dir, px: number, expect: Case['expect']): Case => ({ phrase, id, move, dir, px, expect });

/** Catalogue number → its cases. Every PLUS_WORDS key must be here (checked below). */
const CASES: Record<string, Case[]> = {
  '14': [R('positive when it tips down', 'm14_APDI', ['ANS'], 'down', 40, 'up'),
         R('negative when B is behind A', 'm14_APDI', ['B'], 'back', 40, 'down')],
  '15': [R('added when it is positive (front tips down)', 'm15_ODI', ['ANS'], 'down', 40, 'up')],
  '30': [R('the chin point is up and forward', 'm30_FacAxisR', ['Pog', 'Gn', 'Me', 'B', 'Tg'], 'forward', 60, 'up')],
  '49': [R('+ when the lower incisor tip is ahead of N–B', 'm49_L1NBmm', ['L1T'], 'forward', 150, '+'),
         R('+ when the lower incisor tip is ahead of N–B', 'm49_L1NBmm', ['L1T'], 'back', 150, '−')],
  '51': [R('+ when the lower incisor tip is ahead of N–A', 'm51_L1NAmm', ['L1T'], 'forward', 150, '+'),
         R('+ when the lower incisor tip is ahead of N–A', 'm51_L1NAmm', ['L1T'], 'back', 150, '−')],
  '62': [R('+ when the lower incisor crown tips forward', 'm62_L1OPdev', ['L1T'], 'forward', 150, '+'),
         R('− when it tips back', 'm62_L1OPdev', ['L1T'], 'back', 150, '−')],
  '67': [R('+ when the upper incisor tip is ahead of the A-vertical', 'm67_U1Avert', ['U1T'], 'forward', 150, '+'),
         R('+ when the upper incisor tip is ahead of the A-vertical', 'm67_U1Avert', ['U1T'], 'back', 150, '−')],
  '68': [R('+ when the upper incisor tip is ahead of the lower incisor tip', 'm68_Overjet', ['U1T'], 'forward', 60, '+'),
         R('− when it is behind', 'm68_Overjet', ['U1T'], 'back', 60, '−')],
  '69': [R('+ when the upper incisor tip is lower (deeper) than the lower incisor tip', 'm69_Overbite', ['U1T'], 'down', 60, '+'),
         R('− for an open bite', 'm69_Overbite', ['U1T'], 'up', 60, '−')],
  '70': [R('+ when the molar is ahead of the line', 'm70a_U6NA', ['U6'], 'forward', 600, '+'),
         R('− when it is behind', 'm70a_U6NA', ['U6'], 'back', 100, '−'),
         R('+ when the molar is ahead of the line', 'm70b_L6NB', ['L6'], 'forward', 600, '+'),
         R('− when it is behind', 'm70b_L6NB', ['L6'], 'back', 100, '−')],
  '74': [R('+ when the nose tip is ahead of the Holdaway vertical', 'm74_NoseProm', ['Prn'], 'forward', 100, '+'),
         R('+ when the nose tip is ahead of the Holdaway vertical', 'm74_NoseProm', ['Prn'], 'back', 200, '−')],
  '75': [R('+ when the sulcus lies behind the Holdaway vertical', 'm75_SupSulcus', ['ULs'], 'back', 100, '+'),
         R('+ when the sulcus lies behind the Holdaway vertical', 'm75_SupSulcus', ['ULs'], 'forward', 100, '−')],
  '76': [R('+ when subnasale lies behind the H-line', 'm76_SnH', ['Sn'], 'back', 100, '+'),
         R('+ when subnasale lies behind the H-line', 'm76_SnH', ['Sn'], 'forward', 100, '−')],
  '81': [R('+ when the lower lip is ahead of the H-line', 'm81_LLH', ['LL'], 'forward', 100, '+'),
         R('+ when the lower lip is ahead of the H-line', 'm81_LLH', ['LL'], 'back', 100, '−')],
  '82': [R('+ when the sulcus lies behind the H-line', 'm82_InfSulcusH', ['LLs'], 'back', 100, '+'),
         R('+ when the sulcus lies behind the H-line', 'm82_InfSulcusH', ['LLs'], 'forward', 100, '−')],
};

const g = compile(buildRegistry(ALL_ANALYSES));
const val = (pts: Record<string, Vec2>, id: string): number => {
  const r = g.evaluate(pts, 0.1)[id];
  if (!r || r.t !== 'scalar') throw new Error(`${id} did not compute`);
  return r.v;
};
const mirror = (pts: Record<string, Vec2>) => Object.fromEntries(Object.entries(pts).map(([k, v]) => [k, { x: 1000 - v.x, y: v.y }]));
const step = (dir: Dir, px: number, facing: 1 | -1): Vec2 =>
  dir === 'forward' ? { x: facing * px, y: 0 } : dir === 'back' ? { x: -facing * px, y: 0 } : dir === 'down' ? { x: 0, y: px } : { x: 0, y: -px };
const moved = (pts: Record<string, Vec2>, c: Case, facing: 1 | -1) => {
  const d = step(c.dir, c.px, facing);
  return { ...pts, ...Object.fromEntries(c.move.map((k) => [k, { x: pts[k].x + d.x, y: pts[k].y + d.y }])) };
};

describe('each plain sign rule matches what the app computes (moving the named point the stated way)', () => {
  it('every plain sign rule has behaviour cases, and every case belongs to one (15 rules)', () => {
    expect(Object.keys(CASES).sort()).toEqual(Object.keys(PLUS_WORDS).sort());
    expect(Object.keys(CASES)).toHaveLength(15);
  });
  for (const [no, cases] of Object.entries(CASES)) {
    it(`#${no}: ${cases.map((c) => `${c.move.join('+')} ${c.dir} → ${c.expect}`).join('; ')}`, () => {
      let checked = 0;
      for (const c of cases) {
        expect(PLUS_WORDS[no], `#${no} words must say "${c.phrase}"`).toContain(c.phrase);
        for (const [facing, base] of [[1, SYNTHETIC_SKULLS[0].points], [-1, mirror(SYNTHETIC_SKULLS[0].points)]] as const) {
          const before = val(base, c.id), after = val(moved(base, c, facing), c.id);
          const tag = `#${no} ${c.id} ${c.move.join('+')} ${c.dir} ${c.px}px facing ${facing > 0 ? 'right' : 'left'}: ${before} → ${after}`;
          if (c.expect === 'up') expect(after, tag).toBeGreaterThan(before);
          else if (c.expect === 'down') expect(after, tag).toBeLessThan(before);
          else if (c.expect === '+') expect(after, tag).toBeGreaterThan(0);
          else expect(after, tag).toBeLessThan(0);
          checked++;
        }
      }
      expect(checked).toBe(cases.length * 2);
    });
  }
});
