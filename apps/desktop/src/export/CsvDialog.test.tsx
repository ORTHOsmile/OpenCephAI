import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { CsvDialog } from './CsvDialog';

const html = (count: number) => renderToStaticMarkup(<CsvDialog count={count} onSave={async () => true} onClose={() => {}} />);
describe('Library ▸ Export CSV… (owner R4)', () => {
  it('several films: Anonymised chosen by default, Named offered', () => {
    expect(html(3)).toContain('3 films');
    expect(html(3)).toMatch(/aria-checked="true"[^>]*>Anonymised</);
    expect(html(3)).toMatch(/aria-checked="false"[^>]*>Named</);
  });
  it('one film: Named chosen by default, Anonymised offered', () => {
    expect(html(1)).toContain('1 film');
    expect(html(1)).not.toContain('1 films');
    expect(html(1)).toMatch(/aria-checked="true"[^>]*>Named</);
    expect(html(1)).toMatch(/aria-checked="false"[^>]*>Anonymised</);
  });
  it('no films: Save… is greyed', () => {
    expect(html(0)).toMatch(/<button[^>]*disabled=""[^>]*>Save…</);
    expect(html(2)).not.toMatch(/<button[^>]*disabled=""[^>]*>Save…</);
  });
});
