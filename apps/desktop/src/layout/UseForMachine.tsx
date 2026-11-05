// Spec 2026-10-20 (MS6): offered on a calibrated (ruler) film beside its scale line, when the film has a machine
// and is not read-only — makes this film's ruler the whole machine's scale (MS3's "use for this machine" command).
export function UseForMachine({ name, onUse }: { name: string; onUse: () => void }) {
  return <button type="button" className="link use-for-machine"
    title={`Every film from ${name} of this size without its own ruler will use this film's scale`}
    onClick={onUse}>Use for this machine</button>;
}
