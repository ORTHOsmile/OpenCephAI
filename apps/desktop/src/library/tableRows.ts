// Library ▸ Table rows, Grouped and Flat (owner, 29 Oct 2026, item B as revised). Pure functions, so the ordering rules
// are unit-tested without rendering React. Grouped: one row per PATIENT, expanding to its films in timepoint order; a
// column sort orders the PATIENTS — by their first film, or by the value their own row shows — and never splits a
// patient's films. Flat: every film its own row, sorted across all films.
import type { CaseSummary } from '../ipc';
import { patientIdOf } from './filter';
import { sortBy, type SortDir } from './tableSort';

export type Key = 'name' | 'dob' | 'timepoint' | 'scanDate' | 'sex' | 'age' | 'aiStatus' | 'report';
export interface Sort { key: Key; dir: SortDir }
export type FilmValue = (c: CaseSummary, key: Key) => string | number | null;

/** The film's date: the scan date, else the day it was imported. */
export const filmDate = (c: CaseSummary) => (c.takenOn ?? c.createdAt).slice(0, 10);

/** A stored timestamp → the local calendar day it happened on (YYYY-MM-DD); anything unreadable comes back unchanged.
 *  A report saved at 8 am in Sydney is 9 pm the day before in UTC: the clinician means today. */
export function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** A patient's films in timepoint order: by film date (T-numbers follow film date), then the label, then import time. */
export function timepointOrder(films: readonly CaseSummary[]): CaseSummary[] {
  return [...films].sort((a, b) => filmDate(a).localeCompare(filmDate(b))
    || a.timepoint.localeCompare(b.timepoint, undefined, { numeric: true }) || a.createdAt.localeCompare(b.createdAt));
}

export interface PatientGroup {
  /** `patientIdOf`: one name key and date of birth (spec Part 2). */
  id: string;
  /** In timepoint order; `films[0]` is the patient's first film. */
  films: CaseSummary[];
  /** The latest film date. */
  latestScan: string;
  /** How many of the films are signed off. */
  verified: number;
  /** The latest report saved for any of the films (a stored timestamp), or null. */
  latestReport: string | null;
}

/** "2 of 3 verified": the patient row's short AI summary. */
export const aiSummary = (g: PatientGroup) => `${g.verified} of ${g.films.length} verified`;

/** The value a patient row is sorted by: the value the row itself shows where it shows one (film count, latest scan,
 *  share verified, latest report), else the patient's first film's (name, DOB, M/F, age). */
export function patientValue(g: PatientGroup, key: Key, value: FilmValue): string | number | null {
  switch (key) {
    case 'timepoint': return g.films.length;
    case 'scanDate': return g.latestScan;
    case 'aiStatus': return g.verified / g.films.length;
    case 'report': return g.latestReport ? localDay(g.latestReport) : null;
    default: return value(g.films[0], key);
  }
}

/** Grouped view: one group per patient, films in timepoint order; with a sort, the patients ordered by `patientValue`
 *  (nulls last either way, ties keep the default order); with none, by patient (name key, then date of birth). */
export function groupPatients(rows: readonly CaseSummary[], sort: Sort | null, value: FilmValue): PatientGroup[] {
  const by = new Map<string, CaseSummary[]>();
  for (const c of rows) { const id = patientIdOf(c); by.set(id, [...(by.get(id) ?? []), c]); }
  const groups = [...by.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, films]): PatientGroup => {
    const inOrder = timepointOrder(films);
    const reports = inOrder.map((f) => f.reportSavedAt).filter((r): r is string => !!r).sort();
    return { id, films: inOrder, latestScan: filmDate(inOrder[inOrder.length - 1]), verified: inOrder.filter((f) => !!f.verifiedAt).length,
      latestReport: reports.length ? reports[reports.length - 1] : null };
  });
  return sort ? sortBy(groups, (g) => patientValue(g, sort.key, value), sort.dir) : groups;
}

/** Flat view: every film its own row; with a sort, across all films; with none, patients together, oldest film first. */
export function flatOrder(rows: readonly CaseSummary[], sort: Sort | null, value: FilmValue): CaseSummary[] {
  if (sort) return sortBy(rows, (c) => value(c, sort.key), sort.dir);
  return sortBy(rows, (c) => `${patientIdOf(c)}|${filmDate(c)}`, 'asc');
}

/** A patient row's arrow keys (owner, 29 Oct): Right opens a closed row, Left closes an open one. Enter and Space are the
 *  row's own <button> (native, so they toggle it like a click); this returns null for them and for anything else. */
export function patientKeyAction(key: string, open: boolean): 'expand' | 'collapse' | null {
  if (key === 'ArrowRight' && !open) return 'expand';
  if (key === 'ArrowLeft' && open) return 'collapse';
  return null;
}
