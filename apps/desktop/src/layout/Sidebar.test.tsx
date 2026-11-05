import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import tokensCss from '../styles/tokens.css?raw';
import { ModelButtons, Sidebar } from './Sidebar';
import { initialTracing } from '../tracing/state';
import type { CaseApi } from '../library/useCase';
import type { ChooseApi } from '../library/useChoose';
import type { ModelStatus } from '../ipc';
import type { NormContext } from '../norms/normCell';
import type { NormExtras } from './CasePanel';

// Owner, 1 Nov 2026: a visible, always-there thanks to Dr Linton Nash under the models/buttons in the left
// sidebar. Minimal fixture: kase.doc is null/undefined so CasePanel never renders, which keeps every other
// prop a harmless stub — this test is only about the footer line, not the panel it sits below.
const baseProps = {
  onImport: () => {}, onModels: () => {}, onAnalyses: () => {}, onSettings: () => {},
  enhanceOpen: false, onEnhance: () => {}, filmTextOpen: false, onFilmText: () => {}, patientOpen: false, onPatient: () => {},
  model: null as ModelStatus | null,
  kase: { busy: null, doc: null, notice: null, error: null } as unknown as CaseApi,
  chooser: {} as unknown as ChooseApi,
  patients: [] as string[],
  state: initialTracing,
  dispatch: () => {},
  scale: { mmPerPx: 0.1, source: 'assumed' as const },
  readOnly: false,
  error: null,
  dateFormat: 'AU' as const,
  norms: { sets: [], userNorms: [], clinicDefault: null } as NormContext,
  decimals: 1 as const,
  compareRows: [],
  normExtras: { picks: {} as never, onPick: null, unconfirmedFor: () => [] as string[], userNormsFailed: false } as NormExtras,
};

const html = () => renderToStaticMarkup(<Sidebar {...baseProps} />);

describe('Sidebar: thanks to Dr Linton Nash (owner, 1 Nov 2026)', () => {
  it('shows the exact words "Thanks to Dr Linton Nash"', () => {
    expect(html()).toContain('Thanks to Dr Linton Nash');
  });

  it('is its own element, last in the sidebar, right after the scrolling content closes', () => {
    const h = html();
    const creditTag = '<div class="sidebar-credit">Thanks to Dr Linton Nash</div>';
    const idx = h.indexOf(creditTag);
    expect(idx).toBeGreaterThan(0);
    // immediately precedes the aside's own closing tag — nothing (in particular no further scroll content) follows it
    expect(h.slice(idx + creditTag.length)).toBe('</aside>');
    // immediately follows the scroll wrapper's close — a sibling, not a descendant, of the part that scrolls
    expect(h.slice(0, idx).endsWith('</div>')).toBe(true);
    expect(h).toContain('<div class="sidebar-scroll"');
  });

  it('never says anything else — no other name, and no mention of assistant/AI/tooling', () => {
    const h = html();
    expect(h).not.toMatch(/assistant|company|ai assist/i);
  });

  it('CSS: the footer is pinned (does not shrink) while a sibling wrapper owns the scrolling', () => {
    const creditRule = /\.sidebar-credit\s*\{[^}]*\}/.exec(tokensCss)?.[0] ?? '';
    const scrollRule = /\.sidebar-scroll\s*\{[^}]*\}/.exec(tokensCss)?.[0] ?? '';
    const sidebarRule = /(?<!-)\.sidebar\s*\{[^}]*\}/.exec(tokensCss)?.[0] ?? '';
    expect(creditRule).toMatch(/flex-shrink:\s*0/);
    expect(scrollRule).toMatch(/overflow:\s*auto/);
    expect(sidebarRule).not.toMatch(/overflow:\s*auto/);
  });

  it('CSS: uses the muted text token already proven AA-readable on the sidebar surface (tokens.test.ts)', () => {
    const creditRule = /\.sidebar-credit\s*\{[^}]*\}/.exec(tokensCss)?.[0] ?? '';
    expect(creditRule).toMatch(/color:\s*var\(--text-3\)/);
  });
});

// Plan 2026-10-29 Task 10 (owner, 29 Oct): the left panel's Settings… is blue (button.primary) and alone on its own row,
// centred, under "Models…  Analyses…".
describe('the left panel buttons', () => {
  it('Models… and Analyses… in one row; Settings… alone in the next, blue', () => {
    const h = renderToStaticMarkup(<ModelButtons onModels={() => {}} onAnalyses={() => {}} onSettings={() => {}} />);
    const rows = [...h.matchAll(/<div class="(row[^"]*)">(.*?)<\/div>/g)].map((m) => [m[1], [...m[2].matchAll(/<button([^>]*)>([^<]*)</g)].map((b) => [b[2], b[1].includes('class="primary"')])]);
    expect(rows).toEqual([['row', [['Models…', false], ['Analyses…', false]]], ['row settings-row', [['Settings…', true]]]]);
  });
});
