import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ModelRow } from '../ipc';
import { BaseSelect } from './BaseSelect';
const AZ = 'aariz-cepha29', SR = 'srpose-cldet23', GU = 'gu2net-isbi19';
const row = (id: string, status: ModelRow['status']) => ({ id, title: id, status } as ModelRow);
const T = (m: string) => m;
const html = (base: string | null, rows: ModelRow[], disabled = false, error: string | null = null) =>
  renderToStaticMarkup(<BaseSelect id="b" base={base} rows={rows} titleOf={T} disabled={disabled} onChoose={() => {}} error={error} />);
const options = (h: string) => [...h.matchAll(/<option[^>]*>([^<]*)<\/option>/g)].map((m) => m[1]);
describe('the base drop-down (spec §2)', () => {
  it('lists installed models, Aariz recommended, never Automatic best, and keeps a missing base visible', () => {
    const h = html(GU, [row(AZ, 'ready'), row(SR, 'ready'), row(GU, 'not-installed'), row('auto-best', 'ready')]);
    expect(options(h)).toEqual(['Aariz (recommended)', 'SRPose', 'GU2Net (not installed)']);
    expect(h).toMatch(/<option value="gu2net-isbi19" disabled="" selected="">/);
    expect(h).toContain('Base model');
  });
  it('nothing read yet: disabled, "Reading…"; disabled when asked; the error beside it', () => {
    expect(html(null, [row(AZ, 'ready')])).toMatch(/<select[^>]*disabled=""/);
    expect(options(html(null, [row(AZ, 'ready')]))).toEqual(['Reading…']);
    expect(html(AZ, [row(AZ, 'ready')], true)).toMatch(/<select[^>]*disabled=""/);
    expect(html(AZ, [row(AZ, 'ready')], false, 'The base was not changed: locked')).toContain('The base was not changed: locked');
  });
});
