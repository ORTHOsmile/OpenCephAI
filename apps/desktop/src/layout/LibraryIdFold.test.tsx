import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { TrailLine } from '../ipc';
import { LibraryIdFold } from './LibraryIdFold';

const trail: TrailLine[] = [{ kind: 'merged', number: 'L-00090', into: 'L-00042', on: '2026-10-16' }];
const fold = (patientIdsSeen: string[], libraryTrail: TrailLine[], defaultOpen = false, libraryId: string | null = 'L-00042') =>
  renderToStaticMarkup(<LibraryIdFold doc={{ id: 'c1', libraryId, patientIdsSeen, libraryTrail }} dateFormat="AU" defaultOpen={defaultOpen} />);

describe('LibraryIdFold (owner D2, 19 Oct)', () => {
  it('closed by default: the heading only, with a ▸', () => {
    const h = fold(['5566'], trail);
    expect(h).toContain('aria-expanded="false"');
    expect(h).toContain('▸</span>Library ID L-00042');
    expect(h).not.toContain('Patient IDs on');
    expect(h).not.toContain('library-trail');
  });
  it('open: the Patient IDs seen and the trail, under the heading', () => {
    const h = fold(['5566'], trail, true);
    expect(h).toContain('aria-expanded="true"');
    expect(h).toContain('<div class="hint library-ids">Patient IDs on this patient&#x27;s X-rays: 5566</div>');
    expect(h).toContain('<li>L-00090 was merged into this patient on 16/10/2026.</li>');
  });
  it('nothing to fold: no triangle, no button', () => {
    const h = fold([], [], true);
    expect(h).not.toContain('<button');
    expect(h).not.toContain('▸');
    expect(h).toContain('<div class="hint library-line">Library ID L-00042</div>');
  });
  it('IDs only, or trail only: each is something to fold', () => {
    expect(fold(['5566'], [])).toContain('<button');
    expect(fold([], trail)).toContain('<button');
  });
  it('unnamed: the waiting wording, folded like any other', () => {
    expect(fold(['5566'], [], false, null)).toContain('Library ID: given once the patient has a name');
  });
});
