import { useEffect, useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { Button } from './ui';
import { planGuideSheets } from '../lib/buildGuide';
import {
  costEstimate, defaultPrices, hardwareList, PRICE_LABELS, quantityLabel,
  type HardwareItem, type PriceKey, type Prices,
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

export function HardwareTable({
  items, links = {}, onLink,
}: {
  items: Omit<HardwareItem, 'priceKey'>[];
  /** The user's own product links, by item key; they replace the store search. */
  links?: Record<string, string>;
  onLink?: (key: string, url: string | null) => void;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const shoppable = items.some(i => i.url);
  return (
    <div className="shelf-table-scroll" tabIndex={0} aria-label="Hardware list">
      <table className="shelf-table">
        <thead>
          <tr><th scope="col">Item</th><th scope="col">Buy</th><th scope="col">Notes</th>{shoppable && <th scope="col">Shop</th>}</tr>
        </thead>
        <tbody>
          {items.map(item => {
            const own = links[item.key];
            const href = own || item.url;
            return (
              <tr key={item.key}>
                <th scope="row">{item.name}{item.optional ? <span className="shelf-optional"> optional</span> : null}</th>
                <td>{quantityLabel(item.qty, item.unit)}{item.uses && /^(box|pack) of/.test(item.unit) ? ` (uses ${item.uses})` : ''}</td>
                <td className="is-muted">{item.note}</td>
                {shoppable && (
                  <td className="shelf-shop-cell">
                    {item.url && editing === item.key ? (
                      <form onSubmit={e => { e.preventDefault(); onLink?.(item.key, safeUrl(draft)); setEditing(null); }}>
                        <input value={draft} onChange={e => setDraft(e.target.value)} placeholder="Paste your product link" aria-label={`Your link for ${item.name}`} autoFocus />
                        <Button type="submit" variant="ghost">Save</Button>
                      </form>
                    ) : item.url ? (
                      <>
                        <a href={href} target="_blank" rel="noopener noreferrer">{own ? 'Your link' : 'Search Amazon'}</a>
                        {onLink && (
                          <button type="button" className="shelf-link-button" onClick={() => { setEditing(item.key); setDraft(own ?? ''); }}>
                            {own ? 'Change' : 'Use my link'}
                          </button>
                        )}
                      </>
                    ) : null}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** Only http(s) links are kept; anything else clears the link. */
function safeUrl(text: string): string | null {
  try {
    const url = new URL(text.trim());
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function CostTable<K extends string = PriceKey>({
  estimate, prices, overridden, onPrice, onReset, labels = PRICE_LABELS as Record<K, string>,
}: {
  estimate: { lines: { key: string; name: string; qtyLabel: string; total: number; priceKey: K; optional: boolean }[]; total: number; required: number };
  prices: Record<K, number>;
  overridden: K[];
  onPrice: (key: K, value: number | null) => void;
  onReset: () => void;
  labels?: Record<K, string>;
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
                      aria-label={labels[line.priceKey]}
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
