import tokens from '../../../../docs/design/tokens.json';

/** Print colours: the light theme of docs/design/tokens.json (SEVERITY.md: "a printed report will use black"). */
const L = tokens.color.light as Record<string, string>;
export const PRINT = { text: L.text, grey: L['text-3'], ok: L.ok, ai: L['mark-ai'], verified: L['mark-verified'], profile: L.profile, profileSoft: L['profile-soft'] };

/** "var(--plane-sn)" → that token's light colour (the screen draws planes with CSS variables). */
export function tokenColour(cssVar: string): string {
  const name = /var\(--([a-z0-9-]+)\)/.exec(cssVar)?.[1];
  return (name && L[name]) || PRINT.text;
}

/** `share` of `hex` over `into` — the screen's 18 % green band, as a solid colour a PDF can print. */
export function mix(hex: string, into: string, share: number): string {
  const c = (h: string, i: number) => parseInt(h.slice(1 + 2 * i, 3 + 2 * i), 16);
  return '#' + [0, 1, 2].map((i) => Math.round(c(hex, i) * share + c(into, i) * (1 - share)).toString(16).padStart(2, '0')).join('');
}
