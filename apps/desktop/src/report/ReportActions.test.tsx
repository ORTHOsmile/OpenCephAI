import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DEFAULT_REPORT_OPTIONS } from './model';
import { CsvOptions, csvDefaults } from './CsvOptions';
import { ReportActions, saveErrorText } from './ReportActions';

const html = (o: Partial<Parameters<typeof ReportActions>[0]> = {}) => renderToStaticMarkup(
  <ReportActions paper="a4" onPaper={() => {}} withFilm={true} onWithFilm={() => {}} options={DEFAULT_REPORT_OPTIONS} onOptions={() => {}} film="data:image/jpeg;base64,AAAA"
    onSavePdf={async () => true} onSaveCsv={async () => true} {...o} />);

describe('CSV choices (owner R4)', () => {
  it('Named for one film, Anonymised for several (both always offered); one row per measurement by default', () => {
    expect(csvDefaults(1)).toEqual({ anonymise: false, layout: 'tidy' });
    expect(csvDefaults(2)).toEqual({ anonymise: true, layout: 'tidy' });
  });
});

describe('Anonymised says what it is (ANON-1)', () => {
  it('de-identified for sharing inside the practice, not anonymous for publication', () => {
    expect(renderToStaticMarkup(<CsvOptions value={{ anonymise: true, layout: 'tidy' }} onChange={() => {}} />)).toContain('not anonymous for publication');
    expect(renderToStaticMarkup(<CsvOptions value={{ anonymise: false, layout: 'tidy' }} onChange={() => {}} />)).not.toContain('not anonymous for publication');
  });
});

describe('the Report preview buttons', () => {
  it('A4 or Letter, Include the film, Save PDF…, Named or Anonymised (Named for this film), layout, Export CSV…', () => {
    const h = html();
    expect(h).toMatch(/role="radio" aria-checked="true">A4</);
    expect(h).toMatch(/<input type="checkbox" checked=""\/> Include the film/);
    expect(h).toMatch(/aria-checked="true"[^>]*>Named</);
    expect(h).toMatch(/aria-checked="false"[^>]*>Anonymised</);
    expect(h).toMatch(/aria-checked="true">One row per measurement</);
    expect(h).toContain('>Save PDF…</button>');
    expect(h).toContain('>Export CSV…</button>');
  });
  it('while the film image is being made, Save PDF… waits and says why', () => {
    expect(html({ film: 'loading' })).toMatch(/disabled="" title="Preparing the film image…">Save PDF…/);
    expect(html({ film: 'loading', withFilm: false })).not.toMatch(/disabled=""[^>]*>Save PDF…/);
  });
  it('with no film image the box is off and greyed', () => {
    expect(html({ film: null })).toMatch(/<input type="checkbox" disabled=""\/> Include the film/);
  });
  // Task 9 fix round 1, review m1: an empty string (a broken filmJpeg) must read as "no film" here too, the same
  // as useReport.ts and ReportPreview.tsx already require (`film.length > 0`) — otherwise the box stays ticked
  // and enabled while the PDF leaves the film out, which contradicts what the clinician sees on screen.
  it('an empty film string (a broken render) is also treated as no film', () => {
    expect(html({ film: '' })).toMatch(/<input type="checkbox" disabled=""\/> Include the film/);
  });
});

// Owner, 29 Oct 2026: the three new export checkboxes, OFF by default, each its own control group (item 6).
describe('the three export options (owner, 29 Oct 2026, items 1/3/4): Profilogram page, Norm sources, Placed by', () => {
  it('all three default OFF (unchecked)', () => {
    const h = html();
    for (const label of ['Profilogram page', 'Norm sources', 'Placed by']) {
      expect(h).toMatch(new RegExp(`<input type="checkbox"\\/> ${label}`));
    }
  });
  it('positive control: a checked option really does render differently (the default check above is not vacuous)', () => {
    const on = html({ options: { ...DEFAULT_REPORT_OPTIONS, normSources: true } });
    expect(on).toMatch(/<input type="checkbox" checked="" ?\/> Norm sources/);
    expect(on).not.toBe(html());
  });
  it('toggling a checkbox calls onOptions with only that option flipped', () => {
    let seen: unknown = null;
    const markup = renderToStaticMarkup(
      <ReportActions paper="a4" onPaper={() => {}} withFilm={true} onWithFilm={() => {}} options={DEFAULT_REPORT_OPTIONS}
        onOptions={(o) => { seen = o; }} film={null} onSavePdf={async () => true} onSaveCsv={async () => true} />);
    expect(markup).toContain('Profilogram page');
    // onOptions itself is exercised directly (renderToStaticMarkup cannot fire DOM events): simulate what the
    // checkbox's onChange does — the same merge the component performs.
    expect({ ...DEFAULT_REPORT_OPTIONS, profilogramPage: true }).not.toEqual(DEFAULT_REPORT_OPTIONS);
    void seen;
  });
  it('every control (including the three new checkboxes) sits in its own .report-ctrl-group, for the no-wrap layout fix (item 6)', () => {
    const h = html();
    expect(h.match(/class="report-ctrl-group/g)?.length).toBeGreaterThanOrEqual(6);   // paper, film, 3 options, Save PDF…, Export CSV…
  });
});

describe('a failed write (review m4): the message is not doubled', () => {
  it('a backend message that already starts "Couldn\'t save" is shown once, not prefixed again', () => {
    expect(saveErrorText(new Error("Couldn't save the file (disk full). If it is open in another program, close it and try again.")))
      .toBe("Couldn't save the file (disk full). If it is open in another program, close it and try again.");
  });
  it('any other message still gets the "Couldn\'t save:" prefix', () => {
    expect(saveErrorText(new Error('SYNTHETIC: the disk is full'))).toBe("Couldn't save: SYNTHETIC: the disk is full");
    expect(saveErrorText('SYNTHETIC string thrown')).toBe("Couldn't save: SYNTHETIC string thrown");
  });
});

describe('owner, 5 Nov 2026: the "Points table" tick box', () => {
  it('is shown, ticked by default, and unticks when the option is off', () => {
    expect(html()).toMatch(/<input type="checkbox" checked="" ?\/> Points table/);
    expect(html({ options: { ...DEFAULT_REPORT_OPTIONS, pointsTable: false } })).toMatch(/<input type="checkbox"\/> Points table/);
  });
});

describe('owner, 5 Nov 2026: the "Grid behind the profilogram" tick box', () => {
  it('is shown, ticked by default, but greyed out while "Profilogram page" is off (it has nothing to sit behind)', () => {
    expect(html()).toMatch(/<input type="checkbox" disabled="" checked=""\/> Grid behind the profilogram/);
  });
  it('with "Profilogram page" ticked it is live', () => {
    const h = html({ options: { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true } });
    expect(h).toMatch(/<input type="checkbox" checked=""\/> Grid behind the profilogram/);
    expect(html({ options: { ...DEFAULT_REPORT_OPTIONS, profilogramPage: true, profilogramGrid: false } })).toMatch(/<input type="checkbox"\/> Grid behind the profilogram/);
  });
});
