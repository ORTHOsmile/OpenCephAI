// Regenerates the token section of src/styles/tokens.css from docs/design/tokens.json.
// Usage: pnpm tokens   (plain `node`: Node 22 strips the types)
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { generateCss, type DesignTokens } from '../src/styles/tokens.ts';

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const cssPath = at('../src/styles/tokens.css');
const tokens: DesignTokens = JSON.parse(readFileSync(at('../../../docs/design/tokens.json'), 'utf8'));
const css = readFileSync(cssPath, 'utf8');
const BEGIN = '/* BEGIN GENERATED TOKENS', END = '/* END GENERATED TOKENS */';
const s = css.indexOf(BEGIN), e = css.indexOf(END);
if (s < 0 || e < 0) throw new Error('tokens.css has no generated-token markers');
writeFileSync(cssPath, css.slice(0, s) + generateCss(tokens) + css.slice(e + END.length));
console.log('tokens.css updated from docs/design/tokens.json');
