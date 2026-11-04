import { describe, it, expect, vi, beforeEach } from 'vitest';
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
import { detectExtras, detectLandmarks, files, library, models, operators } from './ipc';

describe('ipc wrappers', () => {
  beforeEach(() => { invoke.mockReset(); invoke.mockResolvedValue(null); });
  it('asks Rust to detect the facing when the caller says auto', async () => {
    await detectLandmarks('/x.png', 'auto');
    expect(invoke).toHaveBeenCalledWith('detect_landmarks', { path: '/x.png', facing: null });
    await detectLandmarks('/x.png', 'left');
    expect(invoke).toHaveBeenLastCalledWith('detect_landmarks', { path: '/x.png', facing: 'left' });
  });
  it('reads a label, confirms identity and asks for a patient’s series by case id', async () => {
    await library.readLabel('c1');
    expect(invoke).toHaveBeenLastCalledWith('library_read_label', { caseId: 'c1' });
    await library.confirmIdentity('c1', { name: 'Demo Synthetic', dateOfBirth: '1990-03-07' });
    expect(invoke).toHaveBeenLastCalledWith('library_confirm_identity', { caseId: 'c1', sameAs: { name: 'Demo Synthetic', dateOfBirth: '1990-03-07' } });
    await library.confirmIdentity('c1', null);
    expect(invoke).toHaveBeenLastCalledWith('library_confirm_identity', { caseId: 'c1', sameAs: null });
    await library.setStage('c1', null);
    expect(invoke).toHaveBeenLastCalledWith('library_set_stage', { caseId: 'c1', stage: null });
    await library.setInSeries('c1', false);
    expect(invoke).toHaveBeenLastCalledWith('library_set_in_series', { caseId: 'c1', on: false });
    await library.confirmFilmDate('c1');
    expect(invoke).toHaveBeenLastCalledWith('library_confirm_film_date', { caseId: 'c1' });
    await library.series('c1');
    expect(invoke).toHaveBeenLastCalledWith('library_series', { caseId: 'c1' });
  });
  it('writes and reads the text file the clinician chose (owner B4: an analysis as a file)', async () => {
    await files.writeText('/Users/demo/NOS SYNTHETIC.analysis.json', '{"x":1}\n');
    expect(invoke).toHaveBeenLastCalledWith('text_file_write', { path: '/Users/demo/NOS SYNTHETIC.analysis.json', text: '{"x":1}\n' });
    await files.readText('/Users/demo/NOS SYNTHETIC.analysis.json');
    expect(invoke).toHaveBeenLastCalledWith('text_file_read', { path: '/Users/demo/NOS SYNTHETIC.analysis.json' });
  });
  it('installs a model from its link or a downloaded file, and runs the extra models', async () => {
    await models.install('gu2net-isbi19');
    expect(invoke).toHaveBeenLastCalledWith('models_install', { id: 'gu2net-isbi19' });
    await models.addFile('gu2net-isbi19', '/Users/demo/SYNTHETIC-best.zip');
    expect(invoke).toHaveBeenLastCalledWith('models_add_file', { id: 'gu2net-isbi19', path: '/Users/demo/SYNTHETIC-best.zip' });
    await detectExtras('/x.png', true);
    expect(invoke).toHaveBeenLastCalledWith('detect_extras', { path: '/x.png', facingLeft: true, run: null });   // a batch: no run, no bars
    await detectExtras('/x.png', false, 7);
    expect(invoke).toHaveBeenLastCalledWith('detect_extras', { path: '/x.png', facingLeft: false, run: 7 });   // review I-1
    await models.points();
    expect(invoke).toHaveBeenLastCalledWith('models_points');
  });
  it('adds a tracer by name and switches who is tracing', async () => {
    await operators.add('Dr B');
    expect(invoke).toHaveBeenLastCalledWith('operators_add', { name: 'Dr B' });
    await operators.setCurrent('Dr A');
    expect(invoke).toHaveBeenLastCalledWith('operators_set_current', { name: 'Dr A' });
  });
  it('sends calibration points as [x, y] pairs', async () => {
    await library.calibrate('c1', { x: 1, y: 2 }, { x: 3, y: 4 }, 10);
    expect(invoke).toHaveBeenCalledWith('library_calibrate', { caseId: 'c1', p1: [1, 2], p2: [3, 4], mm: 10 });
  });
  it('saves Patient ID and each film detail on its own (spec 2026-10-17)', async () => {
    await library.setPatientId('c1', 'ZQ-7781');
    expect(invoke).toHaveBeenLastCalledWith('library_set_patient_id', { caseId: 'c1', patientId: 'ZQ-7781' });
    await library.setFilmDetail('c1', 'practice', null);
    expect(invoke).toHaveBeenLastCalledWith('library_set_film_detail', { caseId: 'c1', field: 'practice', value: null });
  });
  it('notSamePatient sends the case and the Library ID', async () => {
    await library.notSamePatient('c1', 'L-00002');
    expect(invoke).toHaveBeenLastCalledWith('library_not_same_patient', { caseId: 'c1', libraryId: 'L-00002' });
  });
  it('acceptLearned sends the case and the field (owner Q10)', async () => {
    await library.acceptLearned('c1', 'gender');
    expect(invoke).toHaveBeenLastCalledWith('library_accept_learned', { caseId: 'c1', field: 'gender' });
  });
});
