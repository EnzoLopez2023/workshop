import { useEffect, useMemo, useState } from 'react';
import { planSheetsByThickness } from '../lib/buildGuide';
import {
  defaultDrawerPrices, drawerCostEstimate, drawerHardwareList, sheetPriceKey,
  type DrawerPriceKey, type DrawerPrices,
} from '../lib/drawerEstimate';
import type { DrawerConfig, DrawerPlan } from '../lib/drawerUnit';
import { formatLength, type LengthUnit } from '../lib/shelving';

const PRICES_KEY = 'workshop-drawer-prices';

/** Prices the user changed, remembered in this browser (per-viewer convenience only). */
function readPriceOverrides(): Partial<DrawerPrices> {
  try {
    const raw = localStorage.getItem(PRICES_KEY);
    return raw ? (JSON.parse(raw) as Partial<DrawerPrices>) : {};
  } catch {
    return {};
  }
}

const ROLE: Record<string, string> = { sheetCase: 'case and fronts', sheetBox: 'drawer boxes', sheetThin: 'back and bottoms' };

export function useDrawerEstimate(plan: DrawerPlan | null, config: DrawerConfig | null, units: LengthUnit) {
  const [overrides, setOverrides] = useState<Partial<DrawerPrices>>(readPriceOverrides);
  useEffect(() => {
    try { localStorage.setItem(PRICES_KEY, JSON.stringify(overrides)); } catch { /* convenience only */ }
  }, [overrides]);

  return useMemo(() => {
    if (!plan || !config) return null;
    const prices: DrawerPrices = { ...defaultDrawerPrices(), ...overrides };
    const hardware = drawerHardwareList(plan, config, units);
    const sheets = planSheetsByThickness(plan.parts, units).map(g => ({
      thickness: g.thickness,
      count: g.sheets.layouts.length,
      label: `${formatLength(g.thickness, units)} plywood (${g.sheets.sheetSize}) — ${ROLE[sheetPriceKey(g.thickness, config)]}`,
    }));
    const estimate = drawerCostEstimate(sheets, config, hardware, prices);
    return {
      hardware,
      estimate,
      prices,
      overridden: Object.keys(overrides) as DrawerPriceKey[],
      setPrice: (key: DrawerPriceKey, value: number | null) => setOverrides(prev => {
        const next = { ...prev };
        if (value === null) delete next[key]; else next[key] = value;
        return next;
      }),
      resetPrices: () => setOverrides({}),
    };
  }, [plan, config, units, overrides]);
}
