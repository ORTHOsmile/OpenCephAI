import { barText, type Bar } from './modelBars';

/** Owner, 16 Oct: one line per model at the top of the film while it is traced: its name, a bar, then how it ended.
 *  An extra model's bar fills over its time limit (it gives up when full); the main model has no limit, so its bar
 *  just moves until it is done. */
export function ModelBars({ bars }: { bars: Bar[] }) {
  if (!bars.length) return null;
  return (
    <div className="model-bars" role="status" aria-label="Models reading this film">
      {bars.map((b) => (
        <div key={b.id} className={`model-bar ${b.state}`} data-model={b.id}>
          <span className="mb-name">{b.title}</span>
          <span className="mb-track" aria-hidden="true">
            <span className={b.state === 'working' ? (b.limitMs ? 'mb-fill timed' : 'mb-fill open') : 'mb-fill ended'}
              style={b.state === 'working' && b.limitMs ? { animationDuration: `${b.limitMs}ms` } : undefined} /></span>
          <span className="mb-state">{barText(b)}</span>
        </div>))}
    </div>
  );
}
