import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { AutoBestMap, ModelRow } from '../ipc';
import { AutoBestRow } from './AutoBestRow';
import { event } from '../ai/autoBestFixtures';
const SR = 'srpose-cldet23';
const map = (o: Partial<AutoBestMap> = {}): AutoBestMap => ({ available: true, on: true, base: 'aariz-cepha29', uses: { Go: SR }, notes: {}, kept: {}, latest: [event()], ...o } as AutoBestMap);
const html = (state: AutoBestMap | null, error: string | null = null, _mainTitle = 'Aariz') => renderToStaticMarkup(<AutoBestRow state={state} error={error}
  titleOf={(m) => m} onMain={() => {}} />);
describe('Models… › Automatic best (spec §2)', () => {
  it('on: chosen, what it does, its summary; Recent changes now live in Settings › Best model (spec 2026-10-29 §2)', () => {
    const out = html(map());
    expect(out).toContain('Automatic best');
    expect(out).toMatch(/type="radio"[^>]*checked/);
    expect(out).toContain('Uses SRPose for Go; Aariz for the other 18 points.');
    expect(out).not.toContain('Recent changes');
    expect(out).not.toContain('>Undo<');
  });
  it('a fixed main model: points without evidence use the base (owner answer 2 of 29 Oct), not the main model', () => {
    const out = html(map({ on: false }), null, 'GU2Net');
    expect(out).not.toMatch(/type="radio"[^>]*checked/);
    expect(out).not.toContain('Points without evidence use your main model');
    expect(out).toContain('Aariz for the other 18 points.');
    expect(html(map({ on: false, base: 'gu2net-isbi19' }), null, 'cwlachap')).toContain('GU2Net for the other 18 points.');
  });
  it('without Aariz: Needs Aariz, the choice greyed out; unreadable: its error; an old back end: nothing', () => {
    const none = html({ available: false, on: false, base: 'aariz-cepha29', uses: {}, notes: {}, kept: {}, latest: [] });
    expect(none).toContain('Needs Aariz, the base model: install it, or choose another base in Settings › Best model.');
    expect(html({ ...map(), available: false, on: false, base: 'gu2net-isbi19' })).toContain('Needs GU2Net, the base model');
    expect(none).toMatch(/<input type="radio"[^>]*disabled=""/);
    expect(html(null, "Automatic best couldn't be read: locked")).toContain('Automatic best couldn&#x27;t be read: locked');
    expect(html(null)).toBe('');
  });
});

describe('Models… row: the base drop-down beside it, greyed out with a plain reason (plan 2026-10-29 Task 8)', () => {
  const AZ = 'aariz-cepha29', GU = 'gu2net-isbi19';
  const r = (id: string, status: ModelRow['status']) => ({ id, title: id, status } as ModelRow);
  const row8 = (state: AutoBestMap, rows: ModelRow[]) => renderToStaticMarkup(<AutoBestRow state={state} error={null} titleOf={(m) => m}
    rows={rows} baseSelect={<span className="the-select" />} onOpenSettings={() => {}} onMain={() => {}} />);
  it('no model installed: the choice is greyed out and says so', () => {
    const h = row8(map({ available: false, on: false }), [r(AZ, 'not-installed')]);
    expect(h).toMatch(/<input type="radio"[^>]*disabled=""/);
    expect(h).toContain('No model is installed yet: install one below.');
  });
  it('the base not installed: greyed out, naming the base', () => {
    const h = row8(map({ available: false, on: false, base: GU }), [r(AZ, 'ready'), r(GU, 'not-installed')]);
    expect(h).toMatch(/<input type="radio"[^>]*disabled=""/);
    expect(h).toContain('Needs GU2Net, the base model: install it, or choose another base in Settings › Best model.');
  });
  it('control: base installed: the choice can be made; the drop-down and the settings button are beside it', () => {
    const h = row8(map({}), [r(AZ, 'ready')]);
    expect(h).not.toMatch(/<input type="radio"[^>]*disabled=""/);
    expect(h).toContain('class="the-select"');
    expect(h).toContain('>Best model settings…<');
  });
});

// Owner, 5 Nov 2026: the "Made from your verified films" label was white on white (a bare .chip has colour
// var(--on-fill) and no background; only .model-row .chip gave it the neutral look). It sits in the Automatic best
// section, not in a .model-row, so it carries the neutral modifier.
describe('the "Made from your verified films" label is readable (owner, 5 Nov 2026)', () => {
  it('is a neutral chip, never a bare .chip (white text, no background)', () => {
    const out = html(map());
    expect(out).toMatch(/<span class="chip neutral">Made from your verified films<\/span>/);
    expect(out).not.toMatch(/<span class="chip">Made from your verified films/);
  });
  it('is still there when the state cannot be read (the error path draws the same head)', () => {
    expect(html(map(), 'SYNTHETIC: could not read')).toMatch(/<span class="chip neutral">Made from your verified films<\/span>/);
  });
});
