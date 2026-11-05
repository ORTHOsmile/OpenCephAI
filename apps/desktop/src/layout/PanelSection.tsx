import type { ReactNode } from 'react';

/** A titled part of the left panel with a divider above (owner, 30 Sep: Patient, Points, Enhance, Comparison, Overlays).
 *  Titles are passed in normal case (CSS shows them in capitals) so screen readers say words, not letters. `folded`
 *  (owner P3, 19 Oct) follows the title while the section is folded: "PATIENT · L-00002". */
export function PanelSection({ title, action, collapsible, folded, children }: { title: string; action?: ReactNode;
  collapsible?: { open: boolean; onToggle: () => void }; folded?: string; children: ReactNode }) {
  return (
    <section className="panel-section" aria-label={title}>
      {collapsible
        ? <h2 className="section-head"><button type="button" className="toggle" aria-expanded={collapsible.open} onClick={collapsible.onToggle}>
            <span className="tri" aria-hidden="true">{collapsible.open ? '▾' : '▸'}</span>{title}
            {!collapsible.open && folded && <span className="fold-note">{` · ${folded}`}</span>}</button></h2>
        : <div className="section-head"><h2>{title}</h2>{action}</div>}
      {(!collapsible || collapsible.open) && children}
    </section>
  );
}
