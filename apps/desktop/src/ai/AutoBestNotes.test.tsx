import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AutoBestIntro, AutoBestNotes, AutoBestUnreadableNote, BaseChangeNote } from './AutoBestNotes';
import { event } from './autoBestFixtures';
const t = (m: string) => m;
describe('notes on screen (D3) and the upgrade note (D1)', () => {
  it('an adoption with Undo; a return without; an error; nothing to show', () => {
    const out = renderToStaticMarkup(<AutoBestNotes notes={[event(), event({ id: 2, landmarkId: 'B', kind: 'returned', uses: null, basis: null, reason: 'evidence' })]}
      error="That Undo was not saved: locked" titleOf={t} onUndo={() => {}} onDismiss={() => {}} />);
    expect(out).toContain('Automatic best: Gonion now from SRPose, decided on 60 ruler films.');
    expect(out).toContain('back to Aariz — the evidence no longer favours SRPose.');
    expect(out.match(/>Undo</g)?.length).toBe(1);
    expect(out).toContain('That Undo was not saved: locked');
    expect(renderToStaticMarkup(<AutoBestNotes notes={[]} error={null} titleOf={t} onUndo={() => {}} onDismiss={() => {}} />)).toBe('');
  });
  it('the upgrade note with its way back', () => {
    const out = renderToStaticMarkup(<AutoBestIntro note={{ before: 'gu2net-isbi19', keptDeclines: 0 }} titleOf={t} onWayBack={() => {}} onDismiss={() => {}} />);
    expect(out).toContain('Automatic best now starts your tracings.');
    expect(out).toContain('>Go back to GU2Net<');
    expect(renderToStaticMarkup(<AutoBestIntro note={null} titleOf={t} onWayBack={() => {}} onDismiss={() => {}} />)).toBe('');
  });
});

describe('the notes name the base (plan 2026-10-29 Task 6)', () => {
  it('a return names the base it went back to: its own row\'s base', () => {
    const h = renderToStaticMarkup(<AutoBestNotes notes={[event({ kind: 'returned', uses: null, reason: 'evidence', numbers: { base: 'gu2net-isbi19' } })]} error={null} titleOf={(m) => m} onUndo={() => {}} onDismiss={() => {}} />);
    expect(h).toContain('Automatic best: Gonion back to GU2Net');
  });
});

describe('the base-change note (spec 2026-10-29 §4)', () => {
  it('says what changed, with the way back to the earlier base; nothing without a change', () => {
    const h = renderToStaticMarkup(<BaseChangeNote note={{ from: 'aariz-cepha29', to: 'gu2net-isbi19', events: [event({ kind: 'returned', uses: null, reason: 'evidence', numbers: { cause: 'base-changed' } })] }}
      titleOf={(m) => m} onBack={() => {}} onDismiss={() => {}} />);
    expect(h).toContain('Base model is now GU2Net: every point starts from GU2Net. Go no longer uses SRPose: it was judged against Aariz.');
    expect(h).toContain('>Back to Aariz<');
    expect(renderToStaticMarkup(<BaseChangeNote note={null} titleOf={(m) => m} onBack={() => {}} onDismiss={() => {}} />)).toBe('');
  });
});

describe('M4: the note when Automatic best\'s choices could not be read', () => {
  it('names the base and says nothing is lost; nothing shown when the choices read', () => {
    const on = renderToStaticMarkup(<AutoBestUnreadableNote unreadable base="gu2net-isbi19" titleOf={t} />);
    expect(on).toContain("Automatic best&#x27;s choices couldn&#x27;t be read, so GU2Net placed this film&#x27;s points (any it doesn&#x27;t find come from another model). This clears at the next tracing once the choices can be read.");
    expect(renderToStaticMarkup(<AutoBestUnreadableNote unreadable={false} base="gu2net-isbi19" titleOf={t} />)).toBe('');
    expect(renderToStaticMarkup(<AutoBestUnreadableNote unreadable base={null} titleOf={t} />)).toContain('so Aariz placed this film&#x27;s points');
  });
});
