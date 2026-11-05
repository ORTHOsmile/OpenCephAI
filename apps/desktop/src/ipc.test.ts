import { describe, it, expect, vi, beforeEach } from 'vitest';
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
import { detectExtras, detectLandmarks, files, library, models, operators } from './ipc';
import type { FitSave, MachineScaleRow } from './ipc';

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
    // Request G (format 12): save, remove (Reset) and "Use the scale from the fit" for one film.
    const fit: FitSave = { refCaseId: 'c0', refKind: 'sn', refPoints: [[0, 0], [100, 0]], filmPoints: [[0, 0], [96, 0]], mirror: false, scale: 1.04, rotation: 0, dx: 0, dy: 0 };
    await library.saveFit('c1', fit);
    expect(invoke).toHaveBeenLastCalledWith('library_save_fit', { caseId: 'c1', fit });
    await library.clearFit('c1');
    expect(invoke).toHaveBeenLastCalledWith('library_clear_fit', { caseId: 'c1' });
    await library.setFitOwn('c1', true);
    expect(invoke).toHaveBeenLastCalledWith('library_set_fit_own', { caseId: 'c1', on: true });
  });
  it('Stage A task 7: Checked on the film note calls point_check_film_checked with the case and the check id', async () => {
    await library.pointCheckFilmChecked('c1', 7);
    expect(invoke).toHaveBeenLastCalledWith('point_check_film_checked', { caseId: 'c1', checkId: 7 });
  });
  it('Stage A task 8: Models… counts call point_check_counts with no arguments and hand back the rows as sent', async () => {
    invoke.mockResolvedValueOnce([{ landmarkId: 'N', flagged: 12, left: 5 }]);
    expect(await library.pointCheckCounts()).toEqual([{ landmarkId: 'N', flagged: 12, left: 5 }]);
    expect(invoke).toHaveBeenLastCalledWith('point_check_counts');
  });
  it('Stage A: reads a film\'s stored point checks by case id', async () => {
    await library.pointChecksForCase('c1');
    expect(invoke).toHaveBeenLastCalledWith('point_checks_for_case', { caseId: 'c1' });
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
  it('starts the weights check in the background (Part F, owner Q4), with nothing to send', async () => {
    await models.weightsCheckRun();
    expect(invoke).toHaveBeenLastCalledWith('models_weights_check_run');
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
  it('library.ghosts: a null back-end answer (no runs stored yet) reads as [], never null (Task 10 review Important #1 — the source guard every consumer relies on)', async () => {
    invoke.mockResolvedValueOnce(null);
    expect(await library.ghosts('c1')).toEqual([]);
    expect(invoke).toHaveBeenLastCalledWith('library_ghosts', { caseId: 'c1' });
    // Positive control: a real answer passes through unchanged (the guard doesn't swallow actual runs).
    const real = [{ modelId: 'aariz', ranAt: 'x', facing: 'right' as const, points: [] }];
    invoke.mockResolvedValueOnce(real);
    expect(await library.ghosts('c1')).toBe(real);
  });
  // Final review I3: an Automatic best Undo names the change it undoes (the note's row id) and returns the rows the back
  // end wrote; a null answer reads as none. Positive control: send only the point -> the first expectation fails.
  it('models.autoBestUndo sends the point AND the change it undoes, and returns the rows written ([] for null)', async () => {
    const rows = [{ id: 8, kind: 'undone' }, { id: 9, kind: 'adopted' }];
    invoke.mockResolvedValueOnce(rows);
    expect(await models.autoBestUndo('Go', 7)).toBe(rows);
    expect(invoke).toHaveBeenLastCalledWith('models_auto_best_undo', { landmarkId: 'Go', eventId: 7 });
    invoke.mockResolvedValueOnce(null);
    expect(await models.autoBestUndo('Go', 7)).toEqual([]);
  });
  // Follow-up round: "Use … again" names the Undo it takes back. Positive control: send only the point -> this fails.
  it('models.autoBestRedo sends the point AND the Undo it takes back', async () => {
    await models.autoBestRedo('Go', 4);
    expect(invoke).toHaveBeenLastCalledWith('models_auto_best_redo', { landmarkId: 'Go', eventId: 4 });
  });
  it('reads the ruler marks as points (spec 2026-10-19 F), and none as null', async () => {
    invoke.mockResolvedValueOnce({ p1: [1, 2], p2: [3, 4], mm: 20 });
    expect(await library.ruler('c1')).toEqual({ p1: { x: 1, y: 2 }, p2: { x: 3, y: 4 }, mm: 20, steps: 0 });
    expect(invoke).toHaveBeenCalledWith('library_ruler', { caseId: 'c1' });
    expect(await library.ruler('c2')).toBeNull();
  });
  it('reads the presses with the ruler, and sends a press as whole presses (spec 2026-10-19 addendum 3)', async () => {
    invoke.mockResolvedValueOnce({ p1: [1, 2], p2: [3, 4], mm: 20, steps: -3 });
    expect((await library.ruler('c1'))!.steps).toBe(-3);
    invoke.mockResolvedValueOnce(0.101);
    expect(await library.recalibrate('c1', { x: 1, y: 2 }, { x: 3, y: 4 }, 20, 2)).toBe(0.101);
    expect(invoke).toHaveBeenLastCalledWith('library_recalibrate', { caseId: 'c1', p1: [1, 2], p2: [3, 4], mm: 20, steps: 2 });
  });
  it('a film read without the field has 0 presses', async () => {
    invoke.mockResolvedValueOnce({ id: 'c1', spacingMm: 0.1 });
    expect((await library.open('c1')).scaleSteps).toBe(0);
  });
  it('saves Patient ID and each film detail on its own (spec 2026-10-17)', async () => {
    await library.setPatientId('c1', 'ZQ-7781');
    expect(invoke).toHaveBeenLastCalledWith('library_set_patient_id', { caseId: 'c1', patientId: 'ZQ-7781' });
    await library.setFilmDetail('c1', 'practice', null);
    expect(invoke).toHaveBeenLastCalledWith('library_set_film_detail', { caseId: 'c1', field: 'practice', value: null });
  });
  it('saves Title on the patient and the age on the film, each on its own (spec 2026-10-19)', async () => {
    await library.setPatientTitle('c1', 'Mr');
    expect(invoke).toHaveBeenLastCalledWith('library_set_patient_title', { caseId: 'c1', title: 'Mr' });
    await library.setFilmAge('c1', '011Y', 11);
    expect(invoke).toHaveBeenLastCalledWith('library_set_film_age', { caseId: 'c1', printed: '011Y', years: 11 });
    await library.setFilmAge('c1', null, null);
    expect(invoke).toHaveBeenLastCalledWith('library_set_film_age', { caseId: 'c1', printed: null, years: null });
  });
  it('notSamePatient sends the case and the Library ID', async () => {
    await library.notSamePatient('c1', 'L-00002');
    expect(invoke).toHaveBeenLastCalledWith('library_not_same_patient', { caseId: 'c1', libraryId: 'L-00002' });
  });
  it('acceptLearned sends the case and the field (owner Q10)', async () => {
    await library.acceptLearned('c1', 'gender');
    expect(invoke).toHaveBeenLastCalledWith('library_accept_learned', { caseId: 'c1', field: 'gender' });
  });
  it('MS-4: the machine scale wrappers — "Use for this machine", the change it would make, setting it, and undoing a deleted machine', async () => {
    await library.machineScaleFromFilm('c1');
    expect(invoke).toHaveBeenLastCalledWith('library_machine_scale_from_film', { caseId: 'c1' });
    const row: MachineScaleRow = { spacingMm: 0.0998, widthPx: 2400, heightPx: 3000, source: 'film:c1', setAt: null };
    await library.machineScaleChange('m1', row);
    expect(invoke).toHaveBeenLastCalledWith('library_machine_scale_change', { machineId: 'm1', row });
    await library.machineScaleChange('m1', null);
    expect(invoke).toHaveBeenLastCalledWith('library_machine_scale_change', { machineId: 'm1', row: null });
    await library.setMachineScale('m1', row);
    expect(invoke).toHaveBeenLastCalledWith('library_set_machine_scale', { machineId: 'm1', row });
    await library.machineDeleteChange('ch1');
    expect(invoke).toHaveBeenLastCalledWith('library_machine_delete_change', { id: 'ch1' });
  });
});
