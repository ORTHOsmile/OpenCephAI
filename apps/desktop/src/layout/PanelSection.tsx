import type { ReactNode } from 'react';

/** A titled part of the left panel with a divider above (owner, 30 Sep: Patient, Points, Enhance, Comparison, Overlays).
 *  Titles are passed in normal case (CSS shows them in capitals) so screen readers say words, not letters. */
export function PanelSection({ title, action, collapsible, children }: { title: string; action?: ReactNode;
  collapsible?: { open: boolean; onToggle: () => void }; children: ReactNode }) {
  return (
    <section className="panel-section" aria-label={title}>
      {collapsible
        ? <h2 className="section-head"><button type="button" className="toggle" aria-expanded={collapsible.open} onClick={collapsible.onToggle}>
            <span className="tri" aria-hidden="true">{collapsible.open ? '▾' : '▸'}</span>{title}</button></h2>
        : <div className="section-head"><h2>{title}</h2>{action}</div>}
      {(!collapsible || collapsible.open) && children}
    </section>
  );
}
