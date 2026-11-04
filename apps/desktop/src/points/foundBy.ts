import { FOUND_BY_WORDS } from '@ceph/analyses';
import type { ModelPointRow, PointStatus } from '../ipc';

const statusWords = (s: PointStatus): string => {
  switch (s.kind) {
    case 'original': return FOUND_BY_WORDS.original;
    case 'scored': return FOUND_BY_WORDS.scored(s.mre, s.n, s.dataset);
    case 'tooFar': return FOUND_BY_WORDS.tooFar(s.mre, s.n, s.dataset);
    case 'notScored': return FOUND_BY_WORDS.notScored;
  }
};
/** Which installed models find a point and how well (Part B's live table, main model first). */
export function foundByLines(id: string, table: ModelPointRow[] | null): string[] {
  if (!table) return [FOUND_BY_WORDS.tableUnreadable];
  const lines = table.flatMap((r) => r.points.filter((p) => p.id === id).map((p) => `${r.title}: ${statusWords(p.status)}`));
  return lines.length ? lines : [FOUND_BY_WORDS.noModel];
}
