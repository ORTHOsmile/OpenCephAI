import { describe, it, expect } from 'vitest';
import { loadSets } from './norms';
import { originFor } from './custom';
import { CATALOGUE } from './catalogue';
import { ANALYSIS_FILE_FORMAT, FILE_WORDS, analysisFile, exportFileName, parseAnalysisFile } from './custom-file';

const sets = loadSets();
const a = { id: 'my:a', name: 'NOS clinic SYNTHETIC', items: [{ id: 'm03_ANB', from: 'steiner' }, { id: 'm99_Gone', from: '' }, { id: 'm01_SNA', from: 'eastman' }] };
const file = (o: object) => JSON.stringify({ format: ANALYSIS_FILE_FORMAT, version: 1, name: 'X', items: [{ id: 'm01_SNA', from: 'steiner' }], ...o });

describe('an analysis as a file (owner B4)', () => {
  it('readable by eye, and read back exactly (order, norm source, the unavailable one kept)', () => {
    const text = analysisFile(a);
    const o = JSON.parse(text);
    expect(o).toEqual({ format: 'opencephai-analysis', version: 1, name: 'NOS clinic SYNTHETIC', items: [
      { id: 'm03_ANB', label: 'ANB', from: 'steiner' }, { id: 'm99_Gone', label: null, from: '' }, { id: 'm01_SNA', label: 'SNA', from: 'eastman' }] });
    expect(parseAnalysisFile(text, sets)).toEqual({ ok: true, name: a.name, items: a.items });
  });
  it('not an analysis: not JSON, another program\'s JSON, items not a list, no name', () => {
    for (const t of ['{nope', '{"hello":1}', file({ items: 5 }), file({ name: 3 }), file({ format: 'other' })]) expect(parseAnalysisFile(t, sets)).toEqual({ ok: false, error: FILE_WORDS.notOurs });
  });
  it('saved by a newer OpenCephAI: says so', () => {
    expect(parseAnalysisFile(file({ version: 2 }), sets)).toEqual({ ok: false, error: FILE_WORDS.newer });
  });
  it('duplicates and non-text ids are dropped; an unknown or wrong `from` becomes the one this app would choose', () => {
    const p = parseAnalysisFile(file({ items: [{ id: 'm01_SNA', from: 'nope' }, { id: 'm01_SNA', from: 'steiner' }, { id: 4 }, { id: 'm02_SNB', from: 'wits' }] }), sets);
    expect(p).toEqual({ ok: true, name: 'X', items: [{ id: 'm01_SNA', from: originFor('m01_SNA', sets) }, { id: 'm02_SNB', from: originFor('m02_SNB', sets) }] });
  });
  it('a kept `from` of \'\' is only honoured when this app would also choose none (I1, owner B3)', () => {
    const p = parseAnalysisFile(file({ items: [{ id: 'm01_SNA', from: '' }] }), sets);
    expect(p).toEqual({ ok: true, name: 'X', items: [{ id: 'm01_SNA', from: originFor('m01_SNA', sets) }] });
  });
  it('a UTF-8 BOM (older Windows Notepad) does not stop the file reading as an analysis (m4)', () => {
    const withBom = `﻿${file({})}`;
    expect(parseAnalysisFile(withBom, sets)).toEqual({ ok: true, name: 'X', items: [{ id: 'm01_SNA', from: 'steiner' }] });
  });
  it('a non-integer or non-positive version is not ours (m5)', () => {
    for (const v of [0.5, -3, 0]) expect(parseAnalysisFile(file({ version: v }), sets)).toEqual({ ok: false, error: FILE_WORDS.notOurs });
  });
  it('ids outside the catalogue\'s own shape are skipped, and a huge junk list is refused outright (m6)', () => {
    const p = parseAnalysisFile(file({ items: [{ id: 'm01_SNA', from: 'steiner' }, { id: 'not-an-id' }, { id: 'm999_StillShaped' }] }), sets);
    expect(p.ok).toBe(true);
    if (p.ok) expect(p.items.map((i) => i.id)).toEqual(['m01_SNA', 'm999_StillShaped']);
    const junk = Array.from({ length: 2 * CATALOGUE.length + 1 }, (_, i) => ({ id: `m${i}_Junk`, from: '' }));
    expect(parseAnalysisFile(file({ items: junk }), sets)).toEqual({ ok: false, error: FILE_WORDS.notOurs });
  });
  it('nothing this app knows: refused', () => {
    expect(parseAnalysisFile(file({ items: [{ id: 'm99_Gone', from: '' }] }), sets)).toEqual({ ok: false, error: FILE_WORDS.nothingKnown });
    expect(parseAnalysisFile(file({ items: [] }), sets)).toEqual({ ok: false, error: FILE_WORDS.nothingKnown });
  });
  it('the file name: characters Windows forbids replaced, never blank, never hidden', () => {
    expect(exportFileName('A/B: "C"')).toBe('A-B- -C-.analysis.json');
    expect(exportFileName('a\\b*c?d<e>f|g')).toBe('a-b-c-d-e-f-g.analysis.json');
    expect(exportFileName('   ')).toBe('analysis.analysis.json');
    expect(exportFileName('..hidden')).toBe('hidden.analysis.json');
    expect(exportFileName('NOS clinic')).toBe('NOS clinic.analysis.json');
  });
  it('the file name: a Windows reserved device name is prefixed so the saved file is still usable there (F19)', () => {
    expect(exportFileName('con')).toBe('_con.analysis.json');
  });
  it('a Windows reserved device name is still caught before a dot (m9)', () => {
    expect(exportFileName('con.x')).toBe('_con.x.analysis.json');
    expect(exportFileName('COM1')).toBe('_COM1.analysis.json');
    expect(exportFileName('Lpt9')).toBe('_Lpt9.analysis.json');
    expect(exportFileName('nul.x')).toBe('_nul.x.analysis.json');
  });
});
