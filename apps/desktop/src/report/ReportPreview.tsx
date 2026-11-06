import { looksLine } from '../points/wholeFilm';
import { useEffect, type ReactNode } from 'react';
import type { Decimals } from '../format';
import { allChartRows, DEFAULT_REPORT_OPTIONS, headerLines, reportTexts, visibleChartRows, type ReportModel, type ReportOptions } from './model';
import { chartShapes, figure, layoutChart, toSvg, type FigureInput } from './shapes';
import { chartContinuationBox, pageOneBoxes, profilogramBox, type Paper } from './page';
import { profilogramPageShapes as profilogramPageShapesOf } from './profilogramPage';
import { printProblems, type PrintFonts } from './pdfText';
import { isCjk } from './systemFont';
import { WORD_MAX } from './words';

export interface ReportPreviewProps {
  model: ReportModel | null; problem: string | null; decimals: Decimals; figureInput: FigureInput | null;
  /** The film as a JPEG data URL; 'loading' while it is made; null when there is none (or it could not be made). */
  film: string | null | 'loading';
  words: { ready: boolean; error: string | null; save: (key: string, text: string, was: string) => void; reset: (key: string) => void };
  onClose: () => void; actions?: ReactNode; paper: Paper; withFilm: boolean;
  /** Owner, 29 Oct 2026: the profilogram page, the long per-row norm-source paragraph and "placed by", each OFF
   *  by default (`DEFAULT_REPORT_OPTIONS`). */
  options?: ReportOptions;
  /** FONT-2 (18 Oct 2026, preflight-rulings Task 8): what the PDF can print right now — the embedded Noto Sans, this
   *  computer's own font for Chinese/Japanese/Korean when Task 9 has found one (`cjk`, else null), and whether that
   *  search is still running. */
  print: PrintFonts & { searching: boolean };
}

/** Spec 2026-10-17 report-exports: the report as it will print — page 1 (header, tracing, 10 mm bar, the chart
 *  beside the film), one block per analysis switched on (table + sources), the CONTEXT-LINE once, the footer. Each
 *  Meaning is editable for this film (owner R2); Settings › Meanings stays the place for the clinician's usual
 *  words. Owner, 29 Oct 2026: the profilogram moved to its own page (never over the film); the chart moved beside
 *  the (now narrower) film, one consolidated chart for every switched-on row, blank rows dropped. */
export function ReportPreview({ model, problem, decimals, figureInput, film, words, onClose, actions, paper, withFilm, options = DEFAULT_REPORT_OPTIONS, print }: ReportPreviewProps) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !(e.target instanceof HTMLInputElement)) onClose(); };
    window.addEventListener('keydown', k); return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  if (!model) return (
    <div className="modal-backdrop"><div className="report-preview" role="dialog" aria-modal="true" aria-label="Report preview">
      <p className="report-error">{problem ?? 'Preparing the report…'}</p>
      <div className="report-actions report-close-row"><button type="button" className="primary" onClick={onClose}>Close</button></div>
    </div></div>);
  const lines = headerLines(model.header), { film: box, chart: chartBox } = pageOneBoxes(paper, lines.length);
  // A falsy OR empty film string both mean "no film" — found debugging a Task 9 positive control: `filmJpeg`
  // returning '' (a broken canvas) still satisfied `typeof film === 'string'`, so the preview (and savePdf, same
  // guard in useReport.ts) would have tried to show/embed an empty image rather than falling back to none.
  const onFilm = withFilm && typeof film === 'string' && film !== 'loading' && film.length > 0;
  const fig = figureInput ? figure(figureInput, box, onFilm) : null;
  // Owner, 29 Oct 2026 (item 5); fix round, ruling (29 Oct 2026): the one consolidated chart, every
  // switched-on NON-BLANK row, beside the film — never per analysis block, and NEVER silently dropped: the same
  // `layoutChart` pdf.ts uses decides the row pitch and any "continued" page break, so the preview and the saved
  // file can never disagree about which rows print where.
  const visibleRows = visibleChartRows(allChartRows(model));
  const chartPages = layoutChart(visibleRows, chartBox.h, chartContinuationBox(paper).h);
  const ch = chartPages.length ? chartShapes(chartPages[0].rows, { x: chartBox.x, y: chartBox.y, w: chartBox.w }, decimals, chartPages[0].rowH) : null;
  // Owner, 29 Oct 2026 (item 1): the profilogram, on its own page, never over the film.
  const profilogramPageShapes = profilogramPageShapesOf(figureInput ?? null, paper, options);
  // FONT-2: every letter the PDF prints, split into "a CJK font could have carried this" and everything else —
  // Arabic/Hebrew/Indic/Thai never go through the system font (pdfText.ts's own rule), so they always land in
  // `otherBad` even when a found font happens to cover them.
  // Task 8 review Minor 1 -> Task 9 carry-over (c): this used to exclude the three fixed, app-wide strings
  // (contextLine, footer, app) ONLY because Task 8's `useReport` still returned the Latin-1 PLACEHOLDER font, which
  // cannot print the footer's own em dash (U+2014) — every report would otherwise have warned about its own
  // boilerplate. Now that Task 9 wires the real, loaded Noto Sans into `print.noto` (it covers that dash;
  // pdfText.test.ts pins this with a positive control against the old placeholder), the full `reportTexts(model)`
  // runs through the check with nothing carved out — the same list `pdf.ts` itself prints — so a fixed string can
  // never again escape unnoticed just because it happened to be one of these three.
  const texts = reportTexts(model, options);
  const bad = printProblems(texts, print);
  const isCjkLetter = (ch: string) => isCjk(ch.codePointAt(0)!);
  const hasCjkLetter = texts.some((t) => [...t].some(isCjkLetter));
  const cjkBad = bad.filter(isCjkLetter);
  const otherBad = bad.filter((ch) => !isCjkLetter(ch));
  return (
    <div className="modal-backdrop">
      <div className="report-preview" role="dialog" aria-modal="true" aria-label="Report preview">
        <div className="report-actions">{actions}</div>
        {words.error && <p className="report-error">{words.error}</p>}
        {!print.searching && hasCjkLetter && cjkBad.length === 0 && print.cjk &&
          <p className="report-note">Chinese, Japanese and Korean letters print with this computer's own font ({print.cjk.name}).</p>}
        {!print.searching && cjkBad.length > 0 &&
          <p className="report-warn">This computer has no font the PDF can use for {cjkBad.join(' ')}; they will print as ?. The CSV keeps every letter.</p>}
        {otherBad.length > 0 && <p className="report-warn">These letters can't be printed with the PDF's font and will print as ?: {otherBad.join(' ')}</p>}
        <section className="report-page report-page-one">
          <h2>Cephalometric report</h2>
          <dl className="report-header">{lines.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
          <div className="report-page-one-figure">
            {fig && <div className="report-figure" dangerouslySetInnerHTML={{ __html: toSvg(fig.shapes, box, onFilm ? { href: film as string, ...fig.img } : null) }} />}
            {/* Owner, 29 Oct 2026 (item 5): the zig-zag plot, beside the (now narrower) ceph — long and thin, like
                the app's own Chart column; one consolidated chart, blank rows dropped. */}
            {ch && <div className="report-chart report-chart-beside" dangerouslySetInnerHTML={{ __html: toSvg(ch.shapes, { x: chartBox.x, y: chartBox.y, w: chartBox.w, h: chartBox.h }) }} />}
          </div>
        </section>
        {/* Fix round, ruling (29 Oct 2026): more switched-on rows than even the minimum readable row
            height can fit beside the film — the rest continue here, on their own page(s), never dropped. */}
        {chartPages.slice(1).map((pg, i) => {
          const cbox = chartContinuationBox(paper), pch = chartShapes(pg.rows, { x: cbox.x, y: cbox.y, w: cbox.w }, decimals, pg.rowH);
          return (
            <section key={i} className="report-page report-chart-continued">
              <h2>Measurement chart, continued</h2>
              <div className="report-chart" dangerouslySetInnerHTML={{ __html: toSvg(pch.shapes, cbox) }} />
            </section>
          );
        })}
        <section className="report-page">
          {!model.blocks.length && <p>No analyses are switched on (Analyses… in the left panel).</p>}
          {model.blocks.map((b) => (
            <div key={b.analysisId} className="report-block">
              <h3>{b.name}</h3>
              {/* Ruling (final-review.md's "known gap"): a "My analysis" block names a dropped item here,
                  once, under the heading — never a row — the same wording and placement as Inspector.tsx's `gone`. */}
              {b.unavailable && <p className="r-unavailable">{b.unavailable}</p>}
              <table>
                <thead><tr><th>Measurement</th><th>Mean ± SD</th><th>Result</th><th>Meaning</th></tr></thead>
                <tbody>{b.rows.map((r) => (
                  <tr key={r.key} className="r-row" data-key={r.key} data-screen-key={`${b.name}:${r.node}`} data-node={r.node}>
                    <td>{r.label}</td><td>{r.norm}{r.auto &&
                      <span className="r-auto" title="Auto: no norm in the population chosen for this case — see the note below"> ◆</span>}</td>
                    <td>{r.result}{r.stars && <> <span className="stars">{r.stars}</span></>}</td>
                    <td className="r-meaning">
                      <input key={`${r.key}|${r.meaning}`} aria-label={`Meaning for ${r.label} (${b.name})`} defaultValue={r.meaning} maxLength={WORD_MAX} disabled={!words.ready}
                        onBlur={(e) => { if (e.target.value.trim() !== r.meaning) words.save(r.key, e.target.value, r.usual); }}
                        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); if (e.key === 'Escape') { e.currentTarget.value = r.meaning; e.currentTarget.blur(); } }} />
                      {r.edited && <button type="button" className="link" onClick={() => words.reset(r.key)}>Reset to my words</button>}
                      {r.stale && <p className="stale-note">Your words "{r.stale.text}" were written when this read "{r.stale.was || 'nothing'}".{' '}
                        <button type="button" className="link" onClick={() => words.save(r.key, r.stale!.text, r.usual)}>Use them</button></p>}
                    </td>
                  </tr>))}</tbody>
              </table>
              {/* Owner, 29 Oct 2026 (item 3): the long per-row norm-source paragraph, OFF by default. */}
              {options.normSources && b.sources.length > 0 && <p className="r-sources">{b.sources.join(' · ')}</p>}
            </div>))}
          {/* Owner report request (29 Oct 2026): the one-sentence norm summary, shown by default. */}
          {model.normSummary && <p className="report-norm-summary">{model.normSummary}</p>}
          {/* Owner N-A5, AUTO-Q10 (M7): the Auto footnote, then addendum 2 J's unstated-enlargement list, before the
              context line. */}
          {model.autoNote && <p className="report-auto-note">◆ {model.autoNote}</p>}
          {model.scaleNote && <p className="report-scale-note">{model.scaleNote}</p>}
          <p className="report-context">{model.contextLine}</p>
          {/* R3 (B): with "Use the scale from the fit" on, what the † on each mm value means, once, under the tables. */}
          {model.fitNote && <p className="report-fit-note">{model.fitNote}</p>}
          {/* Chain spec §5 (Part F Task 13): each point and its label as it stood when it was placed. Owner, 29 Oct
              2026 (item 4): who placed it is OFF by default. */}
          {options.pointsTable && model.points.length > 0 && <div className="report-block report-points"><h3>Points</h3>
            <table><thead><tr><th>Point</th><th>Name</th>{options.placedBy && <th>Placed by</th>}<th>Point check</th>{model.points.some((p) => p.wholeFilmCheck !== null) && <><th>Whole-film check</th><th>Region</th></>}</tr></thead>
              <tbody>{model.points.map((p) => <tr key={p.id} data-point={p.id}><td>{p.id}</td><td>{p.name}</td>{options.placedBy && <td>{p.label}</td>}<td>{p.pointCheck}</td>{p.wholeFilmCheck !== null && <><td>{p.wholeFilmCheck}</td><td className="whole-region">{p.wholeFilmRegion}</td></>}</tr>)}</tbody></table>
            {model.points.find((p) => p.wholeFilmLooks)?.wholeFilmLooks && <p className="report-whole-looks">Whole-film check, each look: {looksLine(model.points.find((p) => p.wholeFilmLooks)!.wholeFilmLooks!)}.</p>}</div>}
          <p className="report-footer">{model.footer} · {model.app}</p>
        </section>
        {/* Owner, 29 Oct 2026 (items 1-2): the profilogram, on its own page, never over the film — only when the
            "Profilogram page" tick-box is on and there is something to draw. */}
        {options.profilogramPage && profilogramPageShapes.length > 0 && (
          <section className="report-page report-profilogram-page">
            <h2>Profilogram</h2>
            <div className="report-figure" dangerouslySetInnerHTML={{ __html: toSvg(profilogramPageShapes, profilogramBox(paper)) }} />
          </section>
        )}
        <div className="report-actions report-close-row"><button type="button" className="primary" onClick={onClose}>Close</button></div>
      </div>
    </div>
  );
}
