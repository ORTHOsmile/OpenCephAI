// Design tokens → CSS custom properties. Pure and dependency-free so both the test and `pnpm tokens` use it.
// Source of truth: docs/design/tokens.json. Only erasable TypeScript here (Node runs it by stripping types).

export interface DesignTokens {
  color: { light: Record<string, string>; dark: Record<string, string> };
  font: Record<string, string>;
  size: Record<string, number>;
  weight: Record<string, number>;
  space: Record<string, number>;
  radius: Record<string, number>;
  shadow: Record<string, string>;
  layout: Record<string, number>;
}

const channel = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);

/** WCAG 2.x relative luminance of a #rgb or #rrggbb colour. */
export function luminance(hex: string): number {
  let h = hex.replace('#', '');
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`Not a hex colour: ${hex}`);
  const [r, g, b] = [0, 2, 4].map((i) => channel(parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrastRatio(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const block = (vars: [string, string][], indent: string) => vars.map(([k, v]) => `${indent}--${k}: ${v};`).join('\n');

/** The generated section of tokens.css, from its BEGIN to its END marker. */
export function generateCss(t: DesignTokens): string {
  const shared: [string, string][] = [
    ...Object.entries(t.font).map(([k, v]): [string, string] => [k === 'sans' ? 'font' : `font-${k}`, v]),
    ...Object.entries(t.size).map(([k, v]): [string, string] => [`size-${k}`, `${v}px`]),
    ...Object.entries(t.weight).map(([k, v]): [string, string] => [`weight-${k}`, String(v)]),
    ...Object.entries(t.space).map(([k, v]): [string, string] => [`space-${k}`, `${v}px`]),
    ...Object.entries(t.radius).map(([k, v]): [string, string] => [`radius-${k}`, `${v}px`]),
    ...Object.entries(t.shadow).map(([k, v]): [string, string] => [`shadow-${k}`, v]),
    ...Object.entries(t.layout).map(([k, v]): [string, string] => [`layout-${k}`, `${v}px`]),
  ];
  return [
    '/* BEGIN GENERATED TOKENS — from docs/design/tokens.json by `pnpm tokens`; do not edit by hand */',
    ':root {',
    block(shared, '  '),
    block(Object.entries(t.color.light), '  '),
    '}',
    '@media (prefers-color-scheme: dark) {',
    '  :root {',
    block(Object.entries(t.color.dark), '    '),
    '  }',
    '}',
    '/* END GENERATED TOKENS */',
  ].join('\n');
}
