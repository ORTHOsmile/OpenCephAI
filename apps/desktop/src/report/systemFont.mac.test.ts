// Real system fonts, read-only (preflight-rulings Task 7A) — allowed (reviewer-common.md): this reads a font file
// already installed on the OS, never patient data, never anything under data/, models/ or the app's Application
// Support folder. Read the SAME type-erased `node:fs` import as `testFonts.ts` (the repo has no `@types/node`).
import { describe, it, expect } from 'vitest';
import { ALL_ANALYSES, buildRegistry } from '@ceph/analyses';
import { initialTracing } from '../tracing/state';
import { NOW, SYNTH_POINTS, synthDoc, synthModel } from './fixtures';
import { headerLines } from './model';
import { figure } from './shapes';
import { figureBox } from './page';
import { buildPdf } from './pdf';
import { readPdf } from './readPdf';
import { testFonts } from './testFonts';
import { extractFace, faceInfo, pickFace, sfntFaces } from './systemFont';

const FS = 'node:fs';
const { readFileSync, existsSync } = (await import(/* @vite-ignore */ FS)) as {
  readFileSync: (p: string) => Uint8Array; existsSync: (p: string) => boolean;
};

const ARIAL_UNICODE = '/System/Library/Fonts/Supplemental/Arial Unicode.ttf';
const HIRAGINO = '/System/Library/Fonts/ヒラギノ角ゴシック W3.ttc';
const SONGTI = '/System/Library/Fonts/Supplemental/Songti.ttc';
const hasArial = existsSync(ARIAL_UNICODE);
const hasHiragino = existsSync(HIRAGINO);
const hasSongti = existsSync(SONGTI);

const titled = (base: string, present: boolean) => (present ? base : `${base} — skipped: not on this computer`);

describe('systemFont.mac.test.ts: the real macOS fonts named in preflight-rulings Task 7A', () => {
  it.skipIf(!hasArial)(titled('Arial Unicode.ttf is accepted for 李 明 あ 한, and a PDF made with it reads the name back', hasArial), async () => {
    const bytes = new Uint8Array(readFileSync(ARIAL_UNICODE));
    const needed = [...'李明あ한'].map((c) => c.codePointAt(0)!);
    const picked = pickFace(bytes, needed);
    expect(picked).not.toBeNull();
    expect(needed.every((c) => picked!.has(c))).toBe(true);

    const registry = buildRegistry(ALL_ANALYSES);
    const pts = Object.fromEntries(Object.entries(SYNTH_POINTS).map(([id, p]) => [id, { ...p, source: 'ai' as const, verified: id === 'S' }]));
    const model = synthModel({ doc: synthDoc({ patientName: '李明 SYNTHETIC' }) }); // SYNTHETIC
    const fig = figure({ points: pts, registry, overlays: initialTracing.overlays, orientation: { mirror: false, rotDeg: 0, source: 'none' },
      dims: { W: 1200, H: 1400 }, scale: { mmPerPx: 0.1, source: 'calibration', steps: 0 } }, figureBox('a4', headerLines(model.header).length), false);
    const base = await testFonts();
    const pdfBytes = buildPdf({
      model, paper: 'a4', decimals: 1,
      fonts: { ...base, cjk: { ttf: picked!.ttf, name: picked!.name, has: picked!.has } },
      figure: { shapes: fig.shapes, film: null },
    }, NOW);
    const r = await readPdf(pdfBytes);
    expect(r.pages[0]).toContain('李明 SYNTHETIC');
  }, 60_000);

  // The known answer that shows the check CAN fail ("every instrument gets a positive control"):
  // Hiragino Sans GB / ヒラギノ角ゴシック is an OTTO (CFF-outline) collection — jsPDF can only embed TrueType
  // outlines, so every face in it must be refused, never silently accepted as "good enough".
  it.skipIf(!hasHiragino)(titled('ヒラギノ角ゴシック W3.ttc is refused as not TrueType', hasHiragino), () => {
    const bytes = new Uint8Array(readFileSync(HIRAGINO));
    const faces = sfntFaces(bytes);
    expect(faces.length).toBeGreaterThan(0);
    for (const off of faces) expect(faceInfo(extractFace(bytes, off)).trueType).toBe(false);
    expect(pickFace(bytes, [...'李明'].map((c) => c.codePointAt(0)!))).toBeNull();
  }, 60_000);

  // Design fact (preflight-rulings Task 7A): Songti.ttc is TrueType, but its Black face is licence-restricted
  // (OS/2 fsType 2) and must be skipped even though it is otherwise perfectly usable — confirmed directly against
  // this Mac's real file: of its 8 faces, exactly the one named "宋體-簡 黑體" (Songti SC Black) is not embeddable.
  it.skipIf(!hasSongti)(titled('Songti.ttc\'s Black face is refused (OS/2 fsType 2 = restricted); its other faces are not', hasSongti), () => {
    const bytes = new Uint8Array(readFileSync(SONGTI));
    const faces = sfntFaces(bytes).map((off) => faceInfo(extractFace(bytes, off)));
    expect(faces.length).toBeGreaterThan(1);
    const black = faces.find((f) => f.name.includes('黑體'));
    expect(black).toBeDefined();
    expect(black!.trueType).toBe(true);
    expect(black!.embeddable).toBe(false); // the restricted face: skipped
    expect(faces.filter((f) => f.trueType && f.embeddable).length).toBeGreaterThan(0); // its siblings are not refused
  }, 60_000);
});
