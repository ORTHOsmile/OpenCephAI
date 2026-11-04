import type { AnalysisDef, NodeId } from '@ceph/geometry';
import { byId, byNo } from './catalogue';

/** Builds one catalogue-based analysis. No private nodes of its own (decision: every node lives
 *  once, in the catalogue); its measurements are exactly its listed catalogue ids, in order,
 *  labelled from the catalogue (so a label change in the catalogue is the only place to make it). */
export function analysis(id: string, name: string, ids: NodeId[]): AnalysisDef {
  return { id, name, nodes: {}, measurements: ids.map((i) => ({ node: i, label: byId(i).label })) };
}

/** Turns a comma-separated list of appendix numbers ('1,2,3,70a,70b') into catalogue ids, in the
 *  given order. The lists below are the appendix §5 rows verbatim (catalogue numbers), kept in that
 *  form so they can be checked against the appendix by eye; `byNo` resolves each to its real id. */
const ids = (nos: string): NodeId[] => nos.split(',').map((no) => byNo(no.trim()).id);

/** The 15 analyses (appendix §5), each a plain list of catalogue ids. Part A task 8. */
export const ALL_ANALYSES: AnalysisDef[] = [
  analysis('steiner', 'Steiner', ids('1,2,3,20,60,53,46,47,49,50,59,70a,70b,18')),
  analysis('downs', 'Downs', ids('4,5,6,22,24,61,53,56,62,63')),
  analysis('mcnamara', 'McNamara', ids('8,9,10,11,12,28,23,31,67,64,84,85')),
  analysis('ricketts', 'Ricketts', ids('30,4,22,32,27,7,64,19,53,72,33')),
  analysis('tweed', 'Tweed', ids('22,56,58')),
  analysis('bjork-jarabak', 'Björk–Jarabak', ids('34,35,36,37,38,39,40,41,42,43,44')),
  analysis('wits', 'Wits', ids('13')),
  analysis('eastman', 'Eastman', ids('1,2,3,26,25,55,57,53,29')),
  analysis('holdaway', 'Holdaway', ids('73,74,75,76,7,77,78,79,80,81,82,83')),
  analysis('e-line', 'E-line', ids('71,72')),
  analysis('kim', 'Kim', ids('15,14,16,17')),
  analysis('abo', 'ABO', ids('1,2,3,90,91,54,46,47,92,49,50,72')),
  analysis('nagasaki', 'Nagasaki', ids('1,2,3,21,51,57,53,13')),
  analysis('radney', 'Radney', ids('47,46,52,51')),
  analysis('nus', 'NUS', ids('1,2,3,23,25,26,13,29,54,55,57,53,64,68,69,71,72')),
];

const BUILT_IN_IDS = ['steiner', 'downs', 'mcnamara'];
/** The app shows the same three analyses until Part D (appendix §5 decision). */
export const BUILT_INS: AnalysisDef[] = ALL_ANALYSES.filter((a) => BUILT_IN_IDS.includes(a.id));

export const STEINER = ALL_ANALYSES.find((a) => a.id === 'steiner')!;
export const DOWNS = ALL_ANALYSES.find((a) => a.id === 'downs')!;
export const MCNAMARA = ALL_ANALYSES.find((a) => a.id === 'mcnamara')!;
