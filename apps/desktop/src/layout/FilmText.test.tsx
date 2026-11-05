import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { docOf } from '../library/fixtures';
import { toEdit } from '../library/persist';
import { initialTracing } from '../tracing/state';
import { FilmText } from './FilmText';

// Two different empty states must be told apart by their class (and not by their words): "Not read yet." (nothing
// has been read) and "No text was found on the film." (read, nothing there). Synthetic doc only.
const html = (lines: string[] | null) => renderToStaticMarkup(
  <FilmText lines={lines} reading={false} locked={false} dateFormat="AU" doc={docOf(toEdit('c1', 'right', initialTracing), {})}
    onRead={() => {}} onUse={() => null} />);
const count = (h: string, cls: string) => (h.match(new RegExp(`class="[^"]*\\b${cls}\\b`, 'g')) ?? []).length;

describe('FilmText empty states', () => {
  it('lines null: only film-text-unread, with its words', () => {
    const h = html(null);
    expect(count(h, 'film-text-unread')).toBe(1);
    expect(count(h, 'film-text-none')).toBe(0);
    expect(h).toContain('Not read yet.');
  });
  it('lines empty: only film-text-none, with its words', () => {
    const h = html([]);
    expect(count(h, 'film-text-none')).toBe(1);
    expect(count(h, 'film-text-unread')).toBe(0);
    expect(h).toContain('No text was found on the film.');
  });
  it('both keep the identity-note look', () => {
    expect(html(null)).toContain('identity-note film-text-unread');
    expect(html([])).toContain('identity-note film-text-none');
  });
});
