import regularUrl from './fonts/NotoSans-Regular.ttf?url';
import boldUrl from './fonts/NotoSans-Bold.ttf?url';
import { sha256Bytes } from '../export/sha256';
import { cmapCoverage, type Printable } from './pdfText';

/** Owner FONT-1 (18 Oct 2026): the PDF embeds Noto Sans, so names in Latin (with Vietnamese), Greek and Cyrillic print
 *  as written. Downloaded once from the official Noto release; SIL Open Font License 1.1 (fonts/OFL.txt beside the
 *  files). The values below are the ones recorded in Task 7 Step 1 — fonts.test.ts checks the files against them. */
export const NOTO_SANS = {
  name: 'Noto Sans',
  release: 'NotoSans-v2.015',
  source: 'https://github.com/notofonts/latin-greek-cyrillic/releases/tag/NotoSans-v2.015',
  licence: 'SIL Open Font License 1.1 (apps/desktop/src/report/fonts/OFL.txt)',
  sha256: {
    regular: 'f3961a9cde016d41a4879aecda1474d3a36d6bf54fa0e4643de029cc2248b0e8',
    bold: '87cb2d84472a7d66da659ee47b6cdb9552326e8c128245231f191b6ac72529d9',
  },
} as const;

/** Owner FONT-2 (18 Oct 2026): `cjk` is the computer's own font for Chinese, Japanese or Korean, found and
 *  attached by `useReport` (Task 9) once a report needs it — `fontsFrom` always starts with `cjk: null`. */
export interface PdfFonts { regular: Uint8Array; bold: Uint8Array; has: Printable; cjk: { ttf: Uint8Array; name: string; has: Printable } | null }
export function fontsFrom(regular: Uint8Array, bold: Uint8Array): PdfFonts {
  if (sha256Bytes(regular) !== NOTO_SANS.sha256.regular || sha256Bytes(bold) !== NOTO_SANS.sha256.bold)
    throw new Error('the PDF font file does not match the recorded Noto Sans release');
  return { regular, bold, has: cmapCoverage(regular), cjk: null };
}
/** The font files shipped with the app (Vite copies them into the build), read when the Report preview opens. */
export async function loadFonts(): Promise<PdfFonts> {
  const get = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(`the PDF font could not be read (${r.status})`); return new Uint8Array(await r.arrayBuffer()); };
  return fontsFrom(await get(regularUrl), await get(boldUrl));
}
export function toBase64(b: Uint8Array): string {
  let t = '';
  for (let i = 0; i < b.length; i += 0x8000) t += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(t);
}
