// Library ▸ Table ▸ AI status (owner decision 4, 29 Oct 2026): the stage plus the model, in plain words — "Not
// traced" / "AI points to check · Automatic best" / "Verified 12/10/2026 · Automatic best". Reuses filter.ts's
// stage words (chipLabel/caseStatus/READY_TO_SIGN_OFF) so the Table says the same thing the Pictures chip does.
import type { CaseSummary } from '../ipc';
import type { DateFormat } from '../dates';
import { formatDate } from '../dates';
import { caseStatus, READY_TO_SIGN_OFF } from './filter';

const NOT_TRACED = 'Not traced';
const TO_CHECK = 'AI points to check';

/** `titleOf`: an id → the app's existing model title (never a raw file id); covers `AUTO_BEST` → "Automatic best". */
export function aiStatusLabel(c: CaseSummary, titleOf: (id: string) => string, fmt: DateFormat): string {
  const model = c.aiModelId ? titleOf(c.aiModelId) : null;
  const tail = (stage: string) => (model ? `${stage} · ${model}` : stage);
  const st = caseStatus(c);
  if (st === 'none') return NOT_TRACED;
  if (st === 'verified') return tail(`Verified ${formatDate(c.verifiedAt, fmt)}`);
  if (st === 'review' && c.unverified === 0) return tail(READY_TO_SIGN_OFF);
  return tail(TO_CHECK);
}
