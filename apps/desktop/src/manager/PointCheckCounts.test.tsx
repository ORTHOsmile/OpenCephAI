import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { LANDMARKS } from '@ceph/analyses';
import { countLine, PointCheckCountsView } from './PointCheckCounts';

// Stage A task 8. SYNTHETIC numbers only. Models…: per point, how often the check flagged it and how often you left it.
const html = (rows: Parameters<typeof PointCheckCountsView>[0]['rows'], error: string | null = null) => renderToStaticMarkup(<PointCheckCountsView rows={rows} error={error} />);

describe('Models…: the point check counts', () => {
  it('the line is the brief\'s words: "Nasion: flagged 12 times, you left it 5 times"', () => {
    expect(LANDMARKS.N.name).toBe('Nasion');
    expect(countLine('Nasion', 12, 5)).toBe('Nasion: flagged 12 times, you left it 5 times');
    expect(countLine('Nasion', 1, 1)).toBe('Nasion: flagged 1 time, you left it 1 time');
    // Review M4: "you left it 0 times" reads oddly; with none left, the clause is left out. Fails if it is printed for 0.
    expect(countLine('Nasion', 3, 0)).toBe('Nasion: flagged 3 times');
  });
  it('one line per point, named in the catalogue\'s order whatever order they arrive in', () => {
    const order = Object.keys(LANDMARKS);
    const [first, second] = order.indexOf('N') < order.indexOf('S') ? ['N', 'S'] : ['S', 'N'];
    const rows = [{ landmarkId: 'N', flagged: 12, left: 5 }, { landmarkId: 'S', flagged: 2, left: 0 }];
    const line = (id: string) => countLine(LANDMARKS[id as 'N'].name, rows.find((r) => r.landmarkId === id)!.flagged, rows.find((r) => r.landmarkId === id)!.left);
    for (const sent of [rows, [...rows].reverse()]) {
      const lines = [...html(sent).matchAll(/<li[^>]*>([^<]*)<\/li>/g)].map((m) => m[1]);
      console.log('lines:', lines);
      expect(lines).toEqual([line(first), line(second)]);
    }
    expect(line('N')).toBe('Nasion: flagged 12 times, you left it 5 times');
  });
  it('information only: no button, no input, and nothing says "wrong"', () => {
    const h = html([{ landmarkId: 'N', flagged: 12, left: 5 }]);
    expect(h).not.toMatch(/<button|<input|<select/);
    expect(h).not.toMatch(/wrong/i);
  });
  it('nothing flagged yet: one plain line, no list', () => {
    const h = html([]);
    expect(h).toContain('No point has been flagged yet.');
    expect(h).not.toContain('<li');
  });
  it('a read that failed says so, and shows no counts (never zeros)', () => {
    const h = html([], 'busy');
    expect(h).toContain('couldn&#x27;t be read');
    expect(h).not.toContain('No point has been flagged yet.');
  });
  it('a point id the catalogue does not know still shows, by its id', () => {
    expect(html([{ landmarkId: 'ZZ', flagged: 1, left: 0 }])).toContain('ZZ: flagged 1 time<');
  });
});
