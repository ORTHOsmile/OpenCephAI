import 'pdfjs-dist/legacy/build/pdf.worker.mjs';   // runs pdfjs's worker in-process under Vitest (node)
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

export interface ReadItem { page: number; str: string; x: number; y: number }
/** Test helper: each page's text (one text call per line), its size in points, and where each text sits. */
export async function readPdf(bytes: Uint8Array): Promise<{ pages: string[]; sizes: [number, number][]; items: ReadItem[] }> {
  const pdf = await getDocument({ data: bytes.slice(), isEvalSupported: false, useSystemFonts: false, disableFontFace: true }).promise;
  const pages: string[] = [], sizes: [number, number][] = [], items: ReadItem[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const p = await pdf.getPage(i);
    const c = await p.getTextContent();
    const texts = c.items.flatMap((it) => ('str' in it ? [it] : []));
    pages.push(texts.map((it) => it.str).join('\n'));
    texts.forEach((it) => items.push({ page: i, str: it.str, x: it.transform[4], y: it.transform[5] }));
    sizes.push([Math.round(p.view[2] - p.view[0]), Math.round(p.view[3] - p.view[1])]);
  }
  await pdf.destroy();
  return { pages, sizes, items };
}
