import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { docOf } from '../library/fixtures';
import { toEdit } from '../library/persist';
import { initialTracing } from '../tracing/state';
import { IdentityCheck } from './IdentityCheck';

// Film details Task 7 (pre-flight S3): the patient note says "Learned for this machine" only when the patient's own
// details (name, DOB, film date, Scan ID) were learned. A learned X-ray type, dimensions, practice or Patient ID has
// its own tag on its own box, and must not relabel a name that came from the label.
const note = (learnedFields: string[], over: Partial<import('../ipc').CaseDoc> = {}) => renderToStaticMarkup(
  <IdentityCheck doc={docOf(toEdit('c1', 'right', initialTracing), { identitySource: 'film', identityChecked: true, learnedFields, ...over })}
    dateFormat="AU" busy={false} onConfirm={() => {}} onEdit={() => {}} />);

describe('IdentityCheck patient note', () => {
  it.each([['name'], ['dob'], ['scan_date'], ['scan_id']])('a learned %s says "Learned for this machine"', (f) => {
    expect(note([f])).toContain('Learned for this machine');
  });
  it.each([['patient_id'], ['xray_type'], ['xray_size'], ['practice']])('a learned %s alone keeps "Read from the film"', (f) => {
    const html = note([f]);
    expect(html).toContain('Read from the film');
    expect(html).not.toContain('Learned for this machine');
  });
  it('nothing learned reads "Read from the film"', () => { expect(note([])).toContain('Read from the film'); });
  // Preflight ruling (Task 8, 8a): a typed name (identitySource manual) with a learned film detail now shows the
  // note too, reading "Learned for this machine" and saying what OK confirms.
  it('a typed name with a learned X-ray type shows "Learned for this machine" and what OK confirms', () => {
    const html = note(['xray_type'], { identitySource: 'manual' });
    expect(html).toContain('Learned for this machine');
    expect(html).toContain('OK confirms: X-ray type');
  });
  // Fix round 1 (review I2), brief Step 6 edge case: "OK when the name is blank: Check patient details shows
  // instead; the note is not shown." A blank name means `identityChecked` is false (name typed or confirmed is
  // what sets it true), so the component's own `if (doc.identityChecked) … else …` branch is the guard; this test
  // pins that even when something else on the X-ray was learned (xray_type), a blank, unconfirmed name still
  // shows "Check patient details", never the learned-mark note or its OK button.
  it('a blank name shows "Check patient details" instead of the note, even with something else learned', () => {
    const html = renderToStaticMarkup(
      <IdentityCheck doc={docOf(toEdit('c1', 'right', initialTracing), { identitySource: 'film', identityChecked: false, patientName: '',
        identityIssues: [{ kind: 'nameNotRead' }], learnedFields: ['xray_type'] })}
        dateFormat="AU" busy={false} onConfirm={() => {}} onEdit={() => {}} />);
    expect(html).toContain('Check patient details');
    expect(html).toContain('Type the name');
    expect(html).not.toContain('identity-note');
    expect(html).not.toContain('OK confirms');
  });
});
