import { describe, it, expect, vi, beforeEach } from 'vitest';
import { chooseAndSave, safeFileName, withExtension } from './save';

describe('export file names (spec 2026-10-17 report-exports)', () => {
  it('adds the ending the dialog may leave off, keeping one already there in any case', () => {
    expect(withExtension('/Users/demo/out/report', 'pdf')).toBe('/Users/demo/out/report.pdf');
    expect(withExtension('/Users/demo/out/report.PDF', 'pdf')).toBe('/Users/demo/out/report.PDF');
    expect(withExtension('/Users/demo/out/m.csv', 'csv')).toBe('/Users/demo/out/m.csv');
    expect(withExtension('/Users/demo/out/m.pdf', 'csv')).toBe('/Users/demo/out/m.pdf.csv');
  });
  it('a default name holds nothing a Mac or Windows folder refuses, and is never empty', () => {
    expect(safeFileName('OpenCephAI report SYNTHETIC Demo T1 07/02/2024')).toBe('OpenCephAI report SYNTHETIC Demo T1 07 02 2024');
    expect(safeFileName('a:b*c?d"e<f>g|h\\i')).toBe('a b c d e f g h i');
    expect(safeFileName('  ///  ')).toBe('OpenCephAI export');
    expect(safeFileName('x'.repeat(300))).toHaveLength(120);
  });
});

// Library ▸ Table "Report" column (owner, 29 Oct; format 16): a PDF report names its film to `export_write`, which
// records the date only after the file is written (src-tauri export.rs `save_export`). A cancelled dialog never reaches
// `export_write`; a failed write rejects. Production change that fails these: dropping the `case` header, or invoking
// before the dialog answers.
const calls: { cmd: string; headers: Record<string, string> }[] = [];
let picked: string | null = null;
let failWrite: string | null = null;
vi.mock('@tauri-apps/plugin-dialog', () => ({ save: async () => picked }));
vi.mock('@tauri-apps/api/core', () => ({
  invoke: async (cmd: string, _body: unknown, opts?: { headers: Record<string, string> }) => {
    calls.push({ cmd, headers: opts?.headers ?? {} });
    if (failWrite) throw new Error(failWrite);
    return null;
  },
}));

describe('chooseAndSave and the report date (format 16)', () => {
  beforeEach(() => { calls.length = 0; picked = null; failWrite = null; });
  it('a saved PDF report names its film in the case header', async () => {
    picked = '/Users/demo/out/SYNTHETIC report';
    expect(await chooseAndSave('pdf', 'r', new Uint8Array([1]), 'case-1')).toBe(true);
    expect(calls).toEqual([{ cmd: 'export_write', headers: { path: encodeURIComponent('/Users/demo/out/SYNTHETIC report.pdf'), case: 'case-1' } }]);
  });
  it('a cancelled dialog writes nothing and so records nothing', async () => {
    picked = null;
    expect(await chooseAndSave('pdf', 'r', new Uint8Array([1]), 'case-1')).toBe(false);
    expect(calls).toEqual([]);
  });
  it('a failed write rejects (the back end records nothing for it)', async () => {
    picked = '/Users/demo/out/x.pdf'; failWrite = 'SYNTHETIC: the disk is full';
    await expect(chooseAndSave('pdf', 'r', new Uint8Array([1]), 'case-1')).rejects.toThrow('SYNTHETIC: the disk is full');
  });
  it('a CSV, or a save with no film, sends no case header', async () => {
    picked = '/Users/demo/out/m.csv';
    await chooseAndSave('csv', 'm', new Uint8Array([1]), 'case-1');
    picked = '/Users/demo/out/r.pdf';
    await chooseAndSave('pdf', 'r', new Uint8Array([1]));
    expect(calls.map((c) => 'case' in c.headers)).toEqual([false, false]);
  });
});
