// Tests only: the embedded fonts, read from disk (Vitest runs in Node; no Node types needed).
// preflight-rulings Task 7: Vitest 2.1.9 runs the transform pipeline on a nested Vite whose `?inline` asset import
// returns a URL path in serve mode, not a data URL — confirmed by the RED run (`atob` on a path throws). Read the
// files directly with a type-erased `node:fs` import instead (the repo has no `@types/node`).
import { fontsFrom, type PdfFonts } from './fonts';
const FS = 'node:fs';
export async function testFonts(): Promise<PdfFonts> {
  const { readFileSync } = (await import(/* @vite-ignore */ FS)) as { readFileSync: (u: URL) => Uint8Array };
  const read = (n: string) => new Uint8Array(readFileSync(new URL(`./fonts/${n}`, import.meta.url)));
  return fontsFrom(read('NotoSans-Regular.ttf'), read('NotoSans-Bold.ttf'));
}
