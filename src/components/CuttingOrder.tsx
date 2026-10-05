import { useMemo } from 'react';
import { cuttingOrder } from '../lib/cuttingOrder';
import { formatLength, type LengthUnit, type ShelfPart } from '../lib/shelving';

interface Props {
  parts: ShelfPart[];
  units: LengthUnit;
}

/** The cut list as saw setups: one fence setting at a time, then stop-block crosscuts. */
export default function CuttingOrder({ parts, units }: Props) {
  const f = (inches: number) => formatLength(inches, units);
  const metric = units === 'mm';
  const order = useMemo(() => cuttingOrder(parts, metric ? 2440 / 25.4 : 96, metric ? 3.2 / 25.4 : 1 / 8), [parts, metric]);
  return (
    <div className="cutting-order">
      {order.map(group => (
        <section key={group.thickness} aria-label={`${f(group.thickness)} plywood`}>
          <h3>
            {f(group.thickness)} plywood
            <small> · {group.fenceSettings} fence setting{group.fenceSettings === 1 ? '' : 's'}, {group.stopSettings} stop setting{group.stopSettings === 1 ? '' : 's'}</small>
          </h3>
          <ol className="cutting-order-rips">
            {group.rips.map(rip => (
              <li key={rip.width}>
                <strong>Rip fence at {f(rip.width)}</strong> — rip {rip.strips} strip{rip.strips === 1 ? '' : 's'} for {rip.pieces} piece{rip.pieces === 1 ? '' : 's'}
                <ul>
                  {rip.crosscuts.map(c => (
                    <li key={c.length}>
                      Stop at <strong>{f(c.length)}</strong>: cut {c.qty} — <span className="is-muted">{c.parts.join(', ')}</span>
                      {c.parts.some(p => p.startsWith('Drawer front')) && (
                        <small className="cutting-order-note"> Cut the fronts in order from one strip and number them, so the grain runs on across the unit.</small>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        </section>
      ))}
      <p className="shelf-group-note">
        Widest rips first, so the offcuts can still give the narrower strips. Set the fence and stop once per line and cut everything at that setting before moving on.
      </p>
    </div>
  );
}
