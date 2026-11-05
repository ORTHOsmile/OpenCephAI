import type { CsvLayout } from '../export/measurementsCsv';

/** Owner R4 + ANON-1 (17–18 Oct): both are always offered — Named, or Anonymised (a coded patient and film; no name,
 *  date of birth or IDs; the film date and age kept) — Anonymised chosen for several films, Named for one. */
export interface CsvChoice { anonymise: boolean; layout: CsvLayout }
export const csvDefaults = (films: number): CsvChoice => ({ anonymise: films > 1, layout: 'tidy' });

export function CsvOptions({ value, onChange }: { value: CsvChoice; onChange: (v: CsvChoice) => void }) {
  return (
    <span className="csv-options">
      <span className="segmented" role="radiogroup" aria-label="Patient details in the file">
        <button type="button" role="radio" aria-checked={!value.anonymise} title="Name, date of birth, Patient ID, library ID and scan ID"
          onClick={() => onChange({ ...value, anonymise: false })}>Named</button>
        <button type="button" role="radio" aria-checked={value.anonymise} title="A coded patient and film; no name, date of birth or IDs"
          onClick={() => onChange({ ...value, anonymise: true })}>Anonymised</button>
      </span>
      <span className="segmented" role="radiogroup" aria-label="CSV layout">{(['tidy', 'wide', 'points'] as const).map((l) => (
        <button key={l} type="button" role="radio" aria-checked={value.layout === l} onClick={() => onChange({ ...value, layout: l })}>
          {l === 'tidy' ? 'One row per measurement' : l === 'wide' ? 'One row per film' : 'One row per point'}</button>))}</span>
      {value.anonymise && <span className="hint">No name, date of birth or IDs. The film date and age are kept, so this is de-identified for sharing inside the practice, not anonymous for publication.</span>}
    </span>
  );
}
