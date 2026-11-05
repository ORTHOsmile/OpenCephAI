import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { CaseSummary } from '../ipc';
import { LibraryTable, SortArrow, sexText } from './LibraryTable';
import { ageShown } from './age';

// Library ▸ Table (owner decisions, 29 Oct 2026): one row per film, grouped by patient, no images. SYNTHETIC rows only.
const c = (o: Partial<CaseSummary>): CaseSummary => ({
  id: 'x', patientName: 'SYNTHETIC Demo', timepoint: 'T1', takenOn: '2026-05-01', createdAt: '2026-05-01T10:00:00.000Z',
  updatedAt: '2026-05-01T10:00:00.000Z', thumbPath: '/t.jpg', landmarks: 0, unverified: 0, verifiedAt: null, deletedAt: null, orientation: null,
  patientKey: 'synthetic demo', dateOfBirth: '2010-02-03', identityChecked: true, libraryId: null, formerLibraryIds: [], printedPatientId: null,
  gender: 'F', aiModelId: null, reportSavedAt: null, ...o,
});
const titleOf = (id: string) => (id === 'auto-best' ? 'Automatic best' : id);
const noop = () => {};
const render = (rows: CaseSummary[], extra: Partial<Parameters<typeof LibraryTable>[0]> = {}) => renderToStaticMarkup(
  <LibraryTable rows={rows} dateFormat="AU" titleOf={titleOf} inBin={false} selecting={false} chosen={new Set()}
    onToggle={noop} onOpen={noop} onDelete={noop} onRestore={noop} layout="flat" query="" onReport={noop} {...extra} />,
);

describe('LibraryTable', () => {
  it('has every column the owner named (Report last, owner 29 Oct), in order, each sortable (a button, keyboard-reachable) and un-sorted at first', () => {
    const h = render([]);
    const heads = [...h.matchAll(/<th[^>]*aria-sort="([^"]*)"[^>]*><button[^>]*>([^<]*)<\/button><\/th>/g)].map((m) => [m[2], m[1]]);
    expect(heads).toEqual([['Name', 'none'], ['DOB', 'none'], ['Timepoint', 'none'], ['Date of scan', 'none'],
      ['M/F', 'none'], ['Age', 'none'], ['AI status', 'none'], ['Report', 'none']]);
  });
  it('one row per film, with the DOB, scan date, sex, age and AI status columns filled in', () => {
    const h = render([c({ id: 'c1' })]);
    expect(h).toContain('>SYNTHETIC Demo<');
    expect(h).toContain('>03/02/2010<');     // DOB, AU format
    expect(h).toContain('>01/05/2026<');     // scan date, AU format
    expect(h).toContain('>F<');
    expect(h).toContain('>16 y 2 m<');        // age at the scan (2010-02-03 -> 2026-05-01)
    expect(h).toContain('>Not traced<');      // landmarks: 0
  });
  it('the AI status column names the model by its title, never a raw id', () => {
    const h = render([c({ id: 'c1', landmarks: 2, unverified: 2, aiModelId: 'auto-best' })]);
    expect(h).toContain('AI points to check · Automatic best');
    expect(h).not.toContain('>auto-best<');
  });
  it('a row opens its film on click, named for screen readers, and nothing opens from Recently deleted', () => {
    const h = render([c({ id: 'c1' })]);
    expect(h).toContain('aria-label="Open SYNTHETIC Demo T1"');
    const hBin = render([c({ id: 'c1' })], { inBin: true });
    expect(hBin).not.toContain('aria-label="Open');
  });
  it('selecting shows a tick-box column and "Choose", not "Open"', () => {
    const h = render([c({ id: 'c1' })], { selecting: true, chosen: new Set(['c1']) });
    expect(h).toContain('aria-label="Choose SYNTHETIC Demo T1"');
    expect(h).toContain('class="pick on"');
  });
  it('Recently deleted rows offer Restore; live rows offer Delete', () => {
    expect(render([c({ id: 'c1' })], { inBin: true })).toContain('>Restore<');
    expect(render([c({ id: 'c1' })])).toContain('aria-label="Delete SYNTHETIC Demo T1"');
  });
  it('Flat, with no column clicked: a patient\'s films are together and ordered oldest first (T1 before T2), earlier-imported patients not interleaved', () => {
    const rows = [
      c({ id: 'b2', patientName: 'SYNTHETIC Alpha', patientKey: 'alpha', dateOfBirth: '2010-01-01', timepoint: 'T2', takenOn: '2027-01-01', createdAt: '2027-01-01T00:00:00Z' }),
      c({ id: 'z1', patientName: 'SYNTHETIC Zeta', patientKey: 'zeta', dateOfBirth: '2011-01-01', timepoint: 'T1', takenOn: '2020-01-01', createdAt: '2020-01-01T00:00:00Z' }),
      c({ id: 'a1', patientName: 'SYNTHETIC Alpha', patientKey: 'alpha', dateOfBirth: '2010-01-01', timepoint: 'T1', takenOn: '2026-01-01', createdAt: '2026-01-01T00:00:00Z' }),
    ];
    const h = render(rows);
    const openOrder = [...h.matchAll(/aria-label="Open ([^"]*)"/g)].map((m) => m[1]);
    expect(openOrder).toEqual(['SYNTHETIC Alpha T1', 'SYNTHETIC Alpha T2', 'SYNTHETIC Zeta T1']);
  });
  // Review I1 (29 Oct): a row opens its film like a Pictures card — through a real <button> (role button, named
  // "Open <name> <timepoint>"), so Enter AND Space work natively and a screen reader announces something to press.
  // Production change that fails it: back to a bare <tr tabIndex={0} onKeyDown={Enter only}>.
  it('each film row holds a real button named "Open <name> <timepoint>", and the row itself is not a fake button', () => {
    const h = render([c({ id: 'c1' })]);
    expect(h).toMatch(/<button type="button" class="lib-open"[^>]*aria-label="Open SYNTHETIC Demo T1"/);
    expect(h).not.toMatch(/<tr[^>]*tabindex/i);
    expect(h).not.toMatch(/<tr[^>]*aria-pressed/i);
    const sel = render([c({ id: 'c1' })], { selecting: true, chosen: new Set(['c1']) });
    expect(sel).toMatch(/<button type="button" class="lib-open"[^>]*aria-pressed="true"[^>]*aria-label="Choose SYNTHETIC Demo T1"/);
    expect(render([c({ id: 'c1' })], { inBin: true })).not.toContain('class="lib-open"');
  });
  // Review minor 3: the M/F column shows only M or F; anything else, or nothing, shows a dash.
  it('M/F shows M or F only, a dash for anything else or nothing', () => {
    expect(['M', 'F', 'X', '', null, 'Other', 'm'].map((g) => sexText(g))).toEqual(['M', 'F', '—', '—', '—', '—', '—']);
    expect(render([c({ id: 'c1', gender: 'Other' as unknown as 'F' })])).toContain('<td>—</td>');
  });
  // Review minor 4: the sort arrow is hidden from screen readers (aria-sort already says which way).
  it('the sort arrow is aria-hidden', () => {
    expect(renderToStaticMarkup(<SortArrow dir="asc" />)).toBe('<span aria-hidden="true"> ▲</span>');
    expect(renderToStaticMarkup(<SortArrow dir="desc" />)).toBe('<span aria-hidden="true"> ▼</span>');
  });

  // ---- Grouped (owner, 29 Oct, item B as revised): one row per PATIENT, opening to its films. ----
  const beta2 = c({ id: 'b2', patientName: 'SYNTHETIC Beta', patientKey: 'beta', dateOfBirth: '2011-03-04', gender: 'M', timepoint: 'T2', takenOn: '2026-03-01',
    landmarks: 2, unverified: 0, verifiedAt: '2026-03-02T00:00:00Z', reportSavedAt: '2026-03-05T01:00:00.000Z' });
  const beta1 = c({ id: 'b1', patientName: 'SYNTHETIC Beta', patientKey: 'beta', dateOfBirth: '2011-03-04', gender: 'M', timepoint: 'T1', takenOn: '2026-02-01' });
  const alpha = c({ id: 'a1', patientName: 'SYNTHETIC Alpha', patientKey: 'alpha', dateOfBirth: '2010-01-02', gender: null, timepoint: 'T1', takenOn: '2026-01-10' });
  const grouped = (extra: Partial<Parameters<typeof LibraryTable>[0]> = {}) => render([beta2, alpha, beta1], { layout: 'grouped', ...extra });
  const opens = (h: string) => [...h.matchAll(/aria-label="Open ([^"]*)"/g)].map((m) => m[1]);
  it('Grouped starts with one collapsed row per patient and no film rows', () => {
    const h = grouped();
    expect([...h.matchAll(/<button type="button" class="lib-open lib-toggle" aria-expanded="([^"]*)" aria-label="([^"]*)"/g)].map((m) => [m[2], m[1]]))
      .toEqual([['SYNTHETIC Alpha, 1 film', 'false'], ['SYNTHETIC Beta, 2 films', 'false']]);
    expect(opens(h)).toEqual([]);
  });
  it('a patient row shows name, DOB, M/F, the number of films, the latest scan, "n of m verified" and the latest report', () => {
    const h = grouped();
    const row = /<tr class="lib-patient"[^>]*>(.*?)<\/tr>/g;
    const beta = [...h.matchAll(row)].map((m) => m[1]).find((r) => r.includes('SYNTHETIC Beta'))!;
    const cells = [...beta.matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((m) => m[1].replace(/<[^>]+>/g, ''));
    expect(cells.slice(1, 8)).toEqual(['04/03/2011', '2 films', '01/03/2026', 'M', '', '1 of 2 verified', '05/03/2026']);
    expect(cells[0]).toContain('SYNTHETIC Beta');
  });
  it('the ▸/▾ is decoration: hidden from screen readers (aria-expanded says it)', () => {
    expect(grouped()).toContain('<span aria-hidden="true">▸</span>');
  });
  it('a search shows every patient with a matching film expanded, listing only the films given (the matching ones)', () => {
    const h = render([beta2], { layout: 'grouped', query: 'T2' });
    expect(h).toContain('aria-expanded="true" aria-label="SYNTHETIC Beta, 1 film"');
    expect(opens(h)).toEqual(['SYNTHETIC Beta T2']);
  });
  it('Flat lists every film as its own row and no patient rows', () => {
    const h = render([beta2, alpha, beta1], { layout: 'flat' });
    expect(h).not.toContain('lib-patient');
    expect(opens(h)).toEqual(['SYNTHETIC Alpha T1', 'SYNTHETIC Beta T1', 'SYNTHETIC Beta T2']);
  });
  // ---- The Report column (owner, 29 Oct; format 16). ----
  it('a film with a saved report shows its date as a button to that film\'s PDF export; none shows a blank', () => {
    const h = render([beta2, beta1], { layout: 'flat' });
    expect(h).toContain('<button type="button" class="lib-report" aria-label="Save the report again for SYNTHETIC Beta T2 (last saved 05/03/2026)">05/03/2026</button>');
    expect((h.match(/class="lib-report"/g) ?? []).length).toBe(1);
    expect(render([beta2], { layout: 'flat', inBin: true })).not.toContain('lib-report');
  });

  // ---- Final review I-1 (29 Oct): the Age column is the Patient panel's own age (ageShown), nothing else. ----
  const ageCells = (h: string) => [...h.matchAll(/<tr class="lib-film"[^>]*>(.*?)<\/tr>/g)]
    .map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((x) => x[1])[5]);
  it('Age counts calendar months as the Patient panel does: DOB 2009-01-31, scan 2026-03-01 is "17 y 1 m"', () => {   // SYNTHETIC
    expect(ageCells(render([c({ id: 'm', dateOfBirth: '2009-01-31', takenOn: '2026-03-01' })]))).toEqual(['17 y 1 m']);
    expect(ageShown({ dateOfBirth: '2009-01-31', takenOn: '2026-03-01' })?.text).toBe('Age 17 y 1 m at the scan (from the DOB)');
  });
  it('no scan date (or no DOB): no age, a dash — never an age to the import date', () => {
    expect(ageCells(render([c({ id: 'n', takenOn: null, createdAt: '2026-05-01T10:00:00.000Z' })]))).toEqual(['—']);
    expect(ageCells(render([c({ id: 'd', dateOfBirth: null })]))).toEqual(['—']);
  });
  // Property: over 1,460 (DOB, scan) pairs — 20 birthdays, many on month ends and 29 Feb, against 73 scan days spread over
  // 2014–2026 — every Age cell equals the Patient panel's age for the same film. Fails on the old decimal-year floor.
  it('Table age equals the Patient panel age over 1,460 date pairs', () => {
    const dobs = ['2009-01-31', '2010-02-15', '2008-02-29', '2011-03-31', '2007-05-31', '2012-08-30', '2006-12-31', '2010-01-01', '2009-07-15', '2005-10-31',   // SYNTHETIC
      '2013-04-30', '2004-02-28', '2011-11-30', '2008-06-01', '2003-09-30', '2012-02-29', '2010-03-01', '2007-01-30', '2009-12-15', '2006-08-31'];
    // Scan days alternate the 1st and the 28th, two months apart from Jan 2014: the days where calendar months and
    // decimal years part company after a month-end birthday.
    const scans = Array.from({ length: 73 }, (_, i) => new Date(Date.UTC(2014, i * 2, i % 2 ? 28 : 1)).toISOString().slice(0, 10));
    const pairs = dobs.flatMap((dob) => scans.map((scan) => ({ dob, scan })));
    expect(pairs.length).toBe(1460);
    const rows = pairs.map(({ dob, scan }, i) => c({ id: `p${i}`, patientKey: `k${String(i).padStart(5, '0')}`, dateOfBirth: dob, takenOn: scan }));
    const table = ageCells(render(rows));
    const panel = pairs.map(({ dob, scan }) => ageShown({ dateOfBirth: dob, takenOn: scan })?.text.replace(/^Age /, '').replace(/ at the scan \(from the DOB\)$/, '') ?? '—');
    const differ = pairs.map((p, i) => (table[i] !== panel[i] ? `${p.dob}→${p.scan}: ${table[i]} vs ${panel[i]}` : null)).filter((x) => x !== null);
    console.log(`age property: compared ${table.length} rows, ${differ.length} differ`);
    expect(table.length).toBe(1460);
    expect(differ).toEqual([]);
  });
});
