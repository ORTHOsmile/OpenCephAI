import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { TextOptionsLight } from 'jspdf';
import type { Decimals } from '../format';
import { sha256Hex } from '../export/sha256';
import { diamond } from './diamond';
import { allChartRows, DEFAULT_REPORT_OPTIONS, headerLines, reportTexts, visibleChartRows, type ReportModel, type ReportOptions } from './model';
import { chartShapes, layoutChart, type Box, type Shape } from './shapes';
import { chartContinuationBox, HEADER_STEP, HEADER_TOP, MARGIN, PAGE, pageOneBoxes, type Paper } from './page';
import { printPlan, type PrintFonts } from './pdfText';
import { toBase64, type PdfFonts } from './fonts';

/** The PDF report (spec 2026-10-17 report-exports; master plan §8 as updated by the spec): vector, made on this
 *  computer, the same bytes for the same film and time. Owner FONT-2 (18 Oct 2026): Chinese, Japanese and Korean
 *  names print through `fonts.cjk` — this computer's own font, found by Task 9 — when one is attached and covers
 *  them; otherwise, as before, through the embedded Noto Sans (FONT-1), "?" for anything neither can print.
 *  Owner, 29 Oct 2026: `options` gates the profilogram page, the long per-row norm-source paragraph and "placed
 *  by" (all OFF by default; see model.ts `DEFAULT_REPORT_OPTIONS`). `profilogram` is the already-positioned
 *  shapes for its own page (null: the option is off, or there is nothing to draw) — computed by the caller, the
 *  same way `figure.shapes` always has been, so pdf.ts never needs `TracingPoint`/`Orientation` types itself. */
export interface PdfInput { model: ReportModel; paper: Paper; decimals: Decimals; fonts: PdfFonts; options?: ReportOptions;
  figure: { shapes: Shape[]; film: ({ jpeg: string } & Box) | null }; profilogram?: Shape[] | null }
const FOOT = 10, NEW_BLOCK_MIN = 60, PT_PER_MM = 72 / 25.4;

/** m1 (integration-review.md): when a header value wraps (`buildPdf`'s header loop), everything the figure box
 *  already placed below the header — the film image and its drawn shapes — moves down by the same extra height, so
 *  a wrapped Scale line still clears the figure rather than running under it. */
function shiftShape(s: Shape, dy: number): Shape {
  if (dy === 0) return s;
  switch (s.t) {
    case 'line': return { ...s, y1: s.y1 + dy, y2: s.y2 + dy };
    case 'rect': return { ...s, y: s.y + dy };
    case 'circle': return { ...s, cy: s.cy + dy };
    case 'poly': return { ...s, pts: s.pts.map(([x, y]) => [x, y + dy]) };
    case 'text': return { ...s, y: s.y + dy };
  }
}

export function drawShapes(doc: jsPDF, shapes: Shape[], fonts: PrintFonts): void {
  for (const s of shapes) {
    if (s.t === 'text') {
      const plan = printPlan(s.s, fonts);
      doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal'); doc.setTextColor(s.fill); doc.setFontSize(s.size);
      doc.text(plan.text, s.x, s.y, { align: s.anchor === 'middle' ? 'center' : s.anchor === 'end' ? 'right' : 'left' });
      continue;
    }
    doc.setLineDashPattern(('dash' in s && s.dash) || [], 0);
    if (s.t === 'line') { doc.setDrawColor(s.stroke); doc.setLineWidth(s.width); doc.line(s.x1, s.y1, s.x2, s.y2); }
    else if (s.t === 'poly') {
      doc.setDrawColor(s.stroke); doc.setLineWidth(s.width);
      const p = s.closed ? [...s.pts, s.pts[0]] : s.pts;
      for (let i = 1; i < p.length; i++) doc.line(p[i - 1][0], p[i - 1][1], p[i][0], p[i][1]);
    } else {
      if (s.fill) doc.setFillColor(s.fill);
      if (s.stroke) { doc.setDrawColor(s.stroke); doc.setLineWidth(s.width ?? 0.2); }
      const mode = s.fill && s.stroke ? 'FD' : s.fill ? 'F' : 'S';
      if (s.t === 'rect') doc.rect(s.x, s.y, s.w, s.h, mode); else doc.circle(s.cx, s.cy, s.r, mode);
    }
  }
  doc.setLineDashPattern([], 0);
}

export function buildPdf({ model, paper, decimals, fonts, options = DEFAULT_REPORT_OPTIONS, figure, profilogram = null }: PdfInput, now: Date): Uint8Array {
  const P = PAGE[paper], W = P.w - 2 * MARGIN;
  const doc = new jsPDF({ unit: 'mm', format: paper, compress: true });
  doc.setCreationDate(now);
  doc.setFileId(sha256Hex(`${model.caseId}|${now.toISOString()}`).slice(0, 32).toUpperCase());
  doc.setProperties({ title: 'Cephalometric report', creator: model.app });
  // Owner FONT-1: Noto Sans embedded (jsPDF keeps only the letters used).
  doc.addFileToVFS('NotoSans-Regular.ttf', toBase64(fonts.regular)); doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFileToVFS('NotoSans-Bold.ttf', toBase64(fonts.bold)); doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');

  const printFonts: PrintFonts = { noto: fonts.has, cjk: fonts.cjk ? { has: fonts.cjk.has, name: fonts.cjk.name } : null };
  // Owner FONT-2: register the system CJK font ONLY when some text in this report actually resolves to it — a
  // report with no CJK letters must produce the SAME bytes with or without `fonts.cjk` supplied, and this is what
  // makes that true (nothing about the file changes when the font is never embedded into it).
  const needsSystemCjk = !!fonts.cjk && reportTexts(model).some((t) => printPlan(t, printFonts).font === 'SystemCJK');
  if (needsSystemCjk) {
    doc.addFileToVFS('SystemCJK.ttf', toBase64(fonts.cjk!.ttf));
    doc.addFont('SystemCJK.ttf', 'SystemCJK', 'normal');
    doc.addFont('SystemCJK.ttf', 'SystemCJK', 'bold');
  }
  // Every piece of report text goes through this: it decides Noto vs. the system CJK font (or Noto with "?") and
  // sets the right one before drawing, so no call site has to know the rule.
  const put = (text: string, x: number, y: number, opts: TextOptionsLight | undefined, style: 'normal' | 'bold'): void => {
    const plan = printPlan(text, printFonts);
    doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', style);
    doc.text(plan.text, x, y, opts);
  };
  const planCell = (text: string) => { const plan = printPlan(text, printFonts); return { content: plan.text, styles: { font: plan.font } }; };

  // Page 1: the header and the figure.
  doc.setTextColor('#000000'); doc.setFontSize(16);
  put('Cephalometric report', MARGIN, MARGIN + 6, undefined, 'bold');
  doc.setFontSize(10);
  // m1: a value that wraps (e.g. a two-point G3 fit's Scale line, naming a long reference timepoint) must push
  // every later header row — and the figure below the header — down by its extra lines, not print over them. A
  // value that fits on one line adds nothing, so a short header prints at exactly today's y (byte-for-byte).
  let extraY = 0;
  headerLines(model.header).forEach(([k, v], i) => {
    const y = HEADER_TOP + i * HEADER_STEP + extraY;
    put(k, MARGIN, y, undefined, 'bold');
    put(v, MARGIN + 32, y, { maxWidth: W - 32 }, 'normal');
    const plan = printPlan(v, printFonts);
    doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal');
    const lineCount = (doc.splitTextToSize(plan.text, W - 32) as string[]).length;
    // `getLineHeight()` returns the same points-scale number jsPDF itself steps by when it wraps text inside
    // `doc.text(..., { maxWidth })` above; PT_PER_MM converts that to the mm the header's own y arguments use.
    if (lineCount > 1) extraY += (lineCount - 1) * doc.getLineHeight() / PT_PER_MM;
  });
  if (figure.film) doc.addImage(figure.film.jpeg, 'JPEG', figure.film.x, figure.film.y + extraY, figure.film.w, figure.film.h);
  drawShapes(doc, figure.shapes.map((s) => shiftShape(s, extraY)), printFonts);
  // Owner, 29 Oct 2026 (the zig-zag plot); fix round, ruling (29 Oct 2026): the measurement chart
  // beside the ceph, long and thin like the app's own Chart column — every switched-on analysis's NON-BLANK row,
  // one chart, dots joined with no gap where a blank row was dropped. A printed report must never quietly lose a
  // row: `layoutChart` (shared with the preview, so the two can never disagree) shrinks the row pitch down to a
  // minimum readable height before it lets the chart run off this page, and only once even that cannot fit every
  // row does it continue onto its own further page(s), each headed "Measurement chart, continued".
  const chartBox = pageOneBoxes(paper, headerLines(model.header).length).chart;
  const visible = visibleChartRows(allChartRows(model));
  const chartPages = layoutChart(visible, chartBox.h, chartContinuationBox(paper).h);
  if (chartPages.length) {
    const chart = chartShapes(chartPages[0].rows, { x: chartBox.x, y: chartBox.y, w: chartBox.w }, decimals, chartPages[0].rowH);
    drawShapes(doc, chart.shapes.map((s) => shiftShape(s, extraY)), printFonts);
  }
  for (const pg of chartPages.slice(1)) {
    doc.addPage(paper);
    doc.setFontSize(12); doc.setTextColor('#000000');
    put('Measurement chart, continued', MARGIN, MARGIN + 6, undefined, 'bold');
    const box = chartContinuationBox(paper);
    const chart = chartShapes(pg.rows, { x: box.x, y: box.y, w: box.w }, decimals, pg.rowH);
    drawShapes(doc, chart.shapes, printFonts);
  }
  // Pages 2+: one block per analysis switched on.
  doc.addPage(paper);
  let y = MARGIN;
  const room = () => P.h - FOOT - 12 - y;
  if (!model.blocks.length) {
    doc.setFontSize(10); doc.setTextColor('#000000');
    put('No analyses are switched on (Analyses… in the left panel).', MARGIN, y + 5, undefined, 'normal'); y += 12;
  }
  model.blocks.forEach((b, i) => {
    if (i > 0 && room() < NEW_BLOCK_MIN) { doc.addPage(paper); y = MARGIN; }
    doc.setFontSize(12); doc.setTextColor('#000000');
    put(b.name, MARGIN, y + 5, undefined, 'bold');
    let tableStartY = y + 8;
    // Owner B1-equivalent for the report (final-review.md, merge-second follow-up (c)): a "My analysis" block whose
    // clinician dropped a no-longer-catalogued item names it once, under the heading — never a row (Inspector.tsx's
    // `gone`, same wording).
    if (b.unavailable) {
      doc.setFontSize(8); doc.setTextColor('#555555');
      const plan = printPlan(b.unavailable, printFonts);
      doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal');
      const lines = doc.splitTextToSize(plan.text, W) as string[];
      lines.forEach((line, k) => put(line, MARGIN, y + 9 + k * 3.2, undefined, 'normal'));
      tableStartY = y + 9 + lines.length * 3.2 + 1;
    }
    autoTable(doc, {
      startY: tableStartY, margin: { left: MARGIN, right: MARGIN, bottom: FOOT + 12 }, theme: 'grid',
      head: [['Measurement', 'Mean ± SD', 'Result', 'Meaning']],
      body: b.rows.map((r) => [r.label, r.norm, r.stars ? `${r.result} ${r.stars}` : r.result, r.meaning].map(planCell)),
      styles: { font: 'NotoSans', fontSize: 9, cellPadding: 1.5, textColor: 20 },
      headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 55 }, 1: { cellWidth: 32 }, 2: { cellWidth: 30 } },
      // M6 (preflight-rulings.md): the in-cell diamond sits 1.1 mm inside column 1's right edge, inside the 1.5 mm
      // padding — widen the right padding on an Auto row's norm cell so its text wraps before the mark, rather
      // than overlapping it.
      didParseCell: (d) => { if (d.section === 'body' && d.column.index === 1 && b.rows[d.row.index]?.auto) d.cell.styles.cellPadding = { top: 1.5, bottom: 1.5, left: 1.5, right: 3.5 }; },
      // Owner N-A5, AUTO-Q10: a drawn ◆ on every Auto row's norm cell, including an ungraded Auto row (task-5-review
      // §"What Task 10 must do" 1) — the mark follows `b.rows[...].auto`, never the row's z/stars/meaning.
      didDrawCell: (d) => { if (d.section === 'body' && d.column.index === 1 && b.rows[d.row.index]?.auto) diamond(doc, d.cell.x + d.cell.width - 2, d.cell.y + d.cell.height / 2, 0.9); },
    });
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 2;
    // Owner, 29 Oct 2026 (item 3): the long per-row norm-source paragraph, OFF by default — the "Norm sources"
    // tick-box. The one-sentence `model.normSummary` above is unconditional and is not this.
    if (options.normSources) {
      doc.setFontSize(7); doc.setTextColor('#555555');
      for (const src of b.sources) {
        const plan = printPlan(src, printFonts);
        doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal');
        for (const line of doc.splitTextToSize(plan.text, W) as string[]) {
          if (room() < 4) { doc.addPage(paper); y = MARGIN; }
          put(line, MARGIN, y + 3, undefined, 'normal'); y += 3.2;
        }
      }
    }
  });
  // Owner report request (29 Oct 2026): the one-sentence norm summary, shown by default, once, before the Auto
  // footnote and the CONTEXT-LINE.
  if (model.normSummary) {
    doc.setFontSize(9); doc.setTextColor('#000000');
    const plan = printPlan(model.normSummary, printFonts);
    doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal');
    const lines = doc.splitTextToSize(plan.text, W) as string[];
    if (room() < lines.length * 4 + 2) { doc.addPage(paper); y = MARGIN; }
    lines.forEach((line, i) => put(line, MARGIN, y + 4 + i * 4, undefined, 'normal'));
    y += 4 + lines.length * 4;
  }
  // Owner N-A5, AUTO-Q10 (M7): the ◆ Auto footnote, once, under the tables and before the CONTEXT-LINE — a drawn
  // diamond beside its first line (never a typed ◆: Noto Sans has no glyph for it), the words at MARGIN + 3.
  if (model.autoNote) {
    doc.setFontSize(7); doc.setTextColor('#555555');
    const plan = printPlan(model.autoNote, printFonts);
    doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal');
    const lines = doc.splitTextToSize(plan.text, W - 3) as string[];
    let first = true;
    for (const line of lines) {
      if (room() < 4) { doc.addPage(paper); y = MARGIN; }
      if (first) { diamond(doc, MARGIN + 1, y + 3, 0.9); first = false; }
      put(line, MARGIN + 3, y + 3, undefined, 'normal'); y += 3.2;
    }
  }
  // Owner, addendum 2 J (M7): the unstated-X-ray-enlargement list, once, after the Auto footnote and before the
  // CONTEXT-LINE — no diamond (it is not an Auto mark).
  if (model.scaleNote) {
    doc.setFontSize(7); doc.setTextColor('#555555');
    const plan = printPlan(model.scaleNote, printFonts);
    doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal');
    for (const line of doc.splitTextToSize(plan.text, W) as string[]) {
      if (room() < 4) { doc.addPage(paper); y = MARGIN; }
      put(line, MARGIN, y + 3, undefined, 'normal'); y += 3.2;
    }
  }
  // The CONTEXT-LINE once, under the tables.
  doc.setFontSize(9); doc.setTextColor('#000000');
  const ctxPlan = printPlan(model.contextLine, printFonts);
  doc.setFont(ctxPlan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal');
  const ctx = doc.splitTextToSize(ctxPlan.text, W) as string[];
  if (room() < ctx.length * 4 + 2) { doc.addPage(paper); y = MARGIN; }
  ctx.forEach((line, i) => put(line, MARGIN, y + 4 + i * 4, undefined, 'normal'));
  y += 4 + ctx.length * 4;
  // R3 (B): the fit's note (what the † on each mm value means), once, under the context line.
  if (model.fitNote) {
    const plan = printPlan(model.fitNote, printFonts);
    doc.setFont(plan.font === 'SystemCJK' ? 'SystemCJK' : 'NotoSans', 'normal');
    const lines = doc.splitTextToSize(plan.text, W) as string[];
    if (room() < lines.length * 4 + 2) { doc.addPage(paper); y = MARGIN; }
    lines.forEach((line, i) => put(line, MARGIN, y + 4 + i * 4, undefined, 'normal'));
    y += 4 + lines.length * 4;
  }
  // Chain spec §5 (Part F Task 13): the Points table — each point and its label as it stood when it was placed. Only
  // when the model carries points, so a report made without them prints the same bytes as before.
  if (model.points.length) {
    if (room() < NEW_BLOCK_MIN) { doc.addPage(paper); y = MARGIN; }
    doc.setFontSize(12); doc.setTextColor('#000000');
    put('Points', MARGIN, y + 5, undefined, 'bold');
    // Owner, 29 Oct 2026 (item 4): who placed each point, OFF by default — the "Placed by" tick-box; the Point
    // and Name columns always show.
    autoTable(doc, {
      startY: y + 8, margin: { left: MARGIN, right: MARGIN, bottom: FOOT + 12 }, theme: 'grid',
      head: [options.placedBy ? ['Point', 'Name', 'Placed by', 'Point check'] : ['Point', 'Name', 'Point check']],
      body: model.points.map((p) => (options.placedBy ? [p.id, p.name, p.label, p.pointCheck] : [p.id, p.name, p.pointCheck]).map(planCell)),
      styles: { font: 'NotoSans', fontSize: 9, cellPadding: 1.5, textColor: 20 },
      headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
      columnStyles: { 0: { cellWidth: 20 }, 1: { cellWidth: 75 } },
    });
  }
  // Owner, 29 Oct 2026 (item 1): the profilogram, on its own page, never over the film — only when the
  // "Profilogram page" tick-box is on AND there is something to draw (the caller already gates this: `profilogram`
  // is null when the option is off or there is nothing to show, so a report with it off prints the same bytes as
  // before this feature existed).
  if (profilogram && profilogram.length) {
    doc.addPage(paper);
    doc.setFontSize(16); doc.setTextColor('#000000');
    put('Profilogram', MARGIN, MARGIN + 6, undefined, 'bold');
    drawShapes(doc, profilogram, printFonts);
  }
  // The footer on every page.
  const n = doc.getNumberOfPages();
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFontSize(8); doc.setTextColor('#666666');
    put(`${model.footer} · ${model.app}`, MARGIN, P.h - FOOT, undefined, 'normal');
    doc.text(`Page ${i} of ${n}`, P.w - MARGIN, P.h - FOOT, { align: 'right' });
  }
  return new Uint8Array(doc.output('arraybuffer'));
}
