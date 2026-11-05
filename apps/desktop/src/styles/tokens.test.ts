import { describe, it, expect } from 'vitest';
import tokensJson from '../../../../docs/design/tokens.json';
import tokensCss from './tokens.css?raw';
import { contrastRatio, generateCss, type DesignTokens } from './tokens';

const tokens: DesignTokens = tokensJson;

describe('contrastRatio (WCAG 2.x)', () => {
  it('matches the reference values', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
  it('is symmetric and accepts 3-digit hex', () => {
    expect(contrastRatio('#fff', '#0071e3')).toBeCloseTo(contrastRatio('#0071e3', '#ffffff'), 10);
  });
});

describe('design tokens (docs/design/tokens.json)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const c = tokens.color[theme];
    // Text must reach AA (4.5:1) on every surface it sits on; so must white text on every filled control.
    const text: [string, string][] = [];
    for (const fg of ['text', 'text-2', 'text-3', 'link'] as const)
      for (const bg of ['bg', 'panel', 'raised'] as const) text.push([fg, bg]);
    for (const fill of ['accent-fill', 'danger-fill', 'ai-fill', 'ok-fill'] as const) text.push(['on-fill', fill]);
    it.each(text)(`${theme}: %s on %s reaches 4.5:1`, (fg, bg) => {
      expect(contrastRatio(c[fg], c[bg])).toBeGreaterThanOrEqual(4.5);
    });
    // Landmark marks and their labels are drawn on the radiograph canvas, which is dark in both themes.
    const marks = ['mark-ai', 'mark-verified', 'mark-conflict', 'mark-b'] as const;
    it.each(marks.map((m) => [m]))(`${theme}: %s is readable on the radiograph (4.5:1, it also colours labels)`, (m) => {
      expect(contrastRatio(c[m], c.canvas)).toBeGreaterThanOrEqual(4.5);
    });
    it(`${theme}: the comparison tracing reads on the mm-grid paper (3:1)`, () => {
      expect(contrastRatio(c.compare, c.paper)).toBeGreaterThanOrEqual(3);
    });
    it.each(['stage-initial', 'stage-progress', 'stage-final', 'stage-retention'] as const)(`${theme}: %s reaches 3:1 on paper and is the same in both themes`, (k) => {
      expect(contrastRatio(c[k], c.paper)).toBeGreaterThanOrEqual(3);
      expect(c[k]).toBe(tokens.color.light[k]);
    });
    it(`${theme}: focus ring and control borders reach 3:1 against the panel`, () => {
      expect(contrastRatio(c.focus, c.panel)).toBeGreaterThanOrEqual(3);
    });
  }
  it('defines the same colour names in both themes', () => {
    expect(Object.keys(tokens.color.light).sort()).toEqual(Object.keys(tokens.color.dark).sort());
  });
});

describe('tokens.css', () => {
  it('is generated from tokens.json (run `pnpm tokens`, never edit by hand)', () => {
    const css = tokensCss;
    const start = css.indexOf('/* BEGIN GENERATED TOKENS');
    const end = css.indexOf('/* END GENERATED TOKENS */');
    expect(start).toBeGreaterThanOrEqual(0);
    expect(css.slice(start, end + '/* END GENERATED TOKENS */'.length)).toBe(generateCss(tokens));
  });
  it('emits light values on :root and dark values under prefers-color-scheme', () => {
    const css = generateCss(tokens);
    expect(css).toContain(`--accent-fill: ${tokens.color.light['accent-fill']};`);
    expect(css).toMatch(/@media \(prefers-color-scheme: dark\) \{\s*:root \{[^}]*--accent-fill: /);
    expect(css).toContain(`--space-4: ${tokens.space['4']}px;`);
  });
});

describe('tokens.css uses only defined custom properties (review M5)', () => {
  it('every var(--x) has a --x: definition in the file', () => {
    const defined = new Set([...tokensCss.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const used = [...new Set([...tokensCss.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))];
    expect(used.length).toBeGreaterThan(10);                    // the scan sees the file's real uses
    expect(used.filter((v) => !defined.has(v))).toEqual([]);
  });
});

// Plan 2026-10-29 Task 10; spec §2a (owner, 29 Oct: "Next to these words, and blue"): the Settings tab text is --link,
// never --accent, which fails AA as small text on the Settings window. Scoped to the Settings window: the Inspector's
// tabs share `.tabs` and must not change.
describe('blue Settings tabs (spec §2a)', () => {
  for (const theme of ['light', 'dark'] as const) {
    const c = tokens.color[theme];
    it(`${theme}: the Settings tab text (--link) reaches 4.5:1 on the window, a selected tab and the panel`, () => {
      for (const bg of ['raised', 'control', 'panel'] as const) expect(contrastRatio(c.link, c[bg])).toBeGreaterThanOrEqual(4.5);
    });
  }
  it('the instrument can fail: --accent as tab text on the dark Settings window is 3.92:1, below 4.5', () => {
    const r = contrastRatio(tokens.color.dark.accent, tokens.color.dark.raised);
    expect(r).toBeLessThan(4.5);
    expect(r).toBeCloseTo(3.92, 2);
  });
  it('the CSS gives the Settings tabs --link with an underlined selected tab, and only the Settings tabs', () => {
    expect(tokensCss).toMatch(/\.settings-window \.tabs button \{ color: var\(--link\); \}/);
    expect(tokensCss).toMatch(/\.settings-window \.tabs button\[aria-selected="true"\] \{ color: var\(--link\); box-shadow: inset 0 -2px 0 var\(--link\); \}/);
    expect(tokensCss).not.toMatch(/^\.tabs button[^{]*\{[^}]*--link/m);
  });
  it('the left panel centres its Settings… row', () => {
    expect(tokensCss).toMatch(/\.sidebar \.row\.settings-row \{[^}]*justify-content: center;[^}]*\}/);
  });
});
