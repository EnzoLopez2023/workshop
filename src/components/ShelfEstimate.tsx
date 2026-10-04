import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from './ui';
import { planGuideSheets } from '../lib/buildGuide';
import {
  costEstimate, defaultPrices, hardwareList, PRICE_LABELS, quantityLabel,
  type CostEstimate, type HardwareItem, type PriceKey, type Prices,
} from '../lib/shelfEstimate';
import { formatLength, type LengthUnit, type ShelfConfig, type ShelfPlan } from '../lib/shelving';

const PRICES_KEY = 'workshop-shelf-prices';

/** Prices the user changed, remembered in this browser (per-viewer convenience only). */
function readPriceOverrides(): Partial<Prices> {
  try {
    const raw = localStorage.getItem(PRICES_KEY);
    return raw ? (JSON.parse(raw) as Partial<Prices>) : {};
  } catch {
    return {};
  }
}

export function useShelfEstimate(plan: ShelfPlan | null, config: ShelfConfig | null, units: LengthUnit) {
  const [overrides, setOverrides] = useState<Partial<Prices>>(readPriceOverrides);
  useEffect(() => {
    try { localStorage.setItem(PRICES_KEY, JSON.stringify(overrides)); } catch { /* convenience only */ }
  }, [overrides]);

  return useMemo(() => {
    if (!plan || !config) return null;
    const prices: Prices = { ...defaultPrices(config.thickness), ...overrides };
    const hardware = hardwareList(plan, config, units);
    const sheets = planGuideSheets(plan, config, units);
    const sheetLabel = `${formatLength(config.thickness, units)} plywood (${sheets.sheetSize})`;
    const estimate = costEstimate(plan, sheets.layouts.length, sheetLabel, hardware, prices);
    return {
      hardware,
      estimate,
      prices,
      overridden: Object.keys(overrides) as PriceKey[],
      setPrice: (key: PriceKey, value: number | null) => setOverrides(prev => {
        const next = { ...prev };
        if (value === null) delete next[key]; else next[key] = value;
        return next;
      }),
      resetPrices: () => setOverrides({}),
    };
  }, [plan, config, units, overrides]);
}

export function money(value: number, symbol = '$'): string {
  return `${symbol}${value.toFixed(2)}`;
}

export function HardwareTable({ items }: { items: HardwareItem[] }) {
  return (
    <div className="shelf-table-scroll" tabIndex={0} aria-label="Hardware list">
      <table className="shelf-table">
        <thead>
          <tr><th scope="col">Item</th><th scope="col">Buy</th><th scope="col">Notes</th></tr>
        </thead>
        <tbody>
          {items.map(item => (
            <tr key={item.key}>
              <th scope="row">{item.name}{item.optional ? <span className="shelf-optional"> optional</span> : null}</th>
              <td>{quantityLabel(item.qty, item.unit)}{item.uses && item.unit.startsWith('box') ? ` (uses ${item.uses})` : ''}</td>
              <td className="is-muted">{item.note}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CostTable({
  estimate, prices, overridden, onPrice, onReset,
}: {
  estimate: CostEstimate;
  prices: Prices;
  overridden: PriceKey[];
  onPrice: (key: PriceKey, value: number | null) => void;
  onReset: () => void;
}) {
  return (
    <div className="shelf-cost">
      <div className="shelf-table-scroll" tabIndex={0} aria-label="Cost estimate">
        <table className="shelf-table shelf-cost-table">
          <thead>
            <tr><th scope="col">Item</th><th scope="col">Qty</th><th scope="col">Unit price</th><th scope="col">Total</th></tr>
          </thead>
          <tbody>
            {estimate.lines.map(line => (
              <tr key={line.key}>
                <th scope="row">{line.name}{line.optional ? <span className="shelf-optional"> optional</span> : null}</th>
                <td>{line.qtyLabel}</td>
                <td>
                  <label className="shelf-price">
                    <span aria-hidden="true">$</span>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      inputMode="decimal"
                      value={String(prices[line.priceKey])}
                      aria-label={PRICE_LABELS[line.priceKey]}
                      onChange={e => {
                        const value = Number.parseFloat(e.target.value);
                        onPrice(line.priceKey, Number.isFinite(value) && value >= 0 ? value : null);
                      }}
                    />
                  </label>
                </td>
                <td className="shelf-money">{money(line.total)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><th scope="row" colSpan={3}>Without optional items</th><td className="shelf-money">{money(estimate.required)}</td></tr>
            <tr className="is-total"><th scope="row" colSpan={3}>Estimated total</th><td className="shelf-money">{money(estimate.total)}</td></tr>
          </tfoot>
        </table>
      </div>
      <div className="shelf-cost-actions">
        <small>Prices are typical US retail; change any of them — your prices are remembered in this browser.</small>
        {overridden.length > 0 && (
          <Button variant="ghost" onClick={onReset}><RotateCcw size={16} aria-hidden="true" /> Reset prices</Button>
        )}
      </div>
    </div>
  );
}
