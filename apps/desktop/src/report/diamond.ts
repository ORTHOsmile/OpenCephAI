import type { jsPDF } from 'jspdf';

/** Owner N-A5, AUTO-Q10 (19 Oct 2026): the Auto mark, drawn — the embedded Noto Sans has no ◆ glyph. A filled
 *  diamond of half-width r mm centred on (cx, cy), as two triangles. Ruling I4 (preflight-rulings.md): jsPDF 4 puts
 *  `triangle` on each instance (not on `jsPDF.prototype`), so `vi.spyOn(jsPDF.prototype, 'triangle')` cannot see it —
 *  this function lives in its own module so a test can wrap it directly instead. */
export function diamond(doc: Pick<jsPDF, 'setFillColor' | 'triangle'>, cx: number, cy: number, r: number): void {
  doc.setFillColor(20, 20, 20);
  doc.triangle(cx - r, cy, cx, cy - r, cx + r, cy, 'F');
  doc.triangle(cx - r, cy, cx, cy + r, cx + r, cy, 'F');
}
