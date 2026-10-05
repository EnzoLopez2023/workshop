import { useMemo } from 'react';
import CncExport from './CncExport';
import { planSheetsByThickness } from '../lib/buildGuide';
import { drawerFeatureSummary, drawerPartFaces } from '../lib/drawerExport';
import type { DrawerConfig, DrawerPlan } from '../lib/drawerUnit';
import { formatLength, type LengthUnit } from '../lib/shelving';

interface Props {
  plan: DrawerPlan;
  config: DrawerConfig;
  units: LengthUnit;
}

export default function DrawerExport({ plan, config, units }: Props) {
  const faces = useMemo(() => drawerPartFaces(plan, config), [plan, config]);
  const groups = useMemo(
    () => planSheetsByThickness(plan.parts, units).map(g => ({ label: formatLength(g.thickness, units), sheets: g.sheets })),
    [plan, units],
  );
  return (
    <CncExport
      faces={faces}
      sheetGroups={groups}
      units={units}
      prefix="drawer"
      summary={drawerFeatureSummary}
      pocketLegend="Pocket — rabbets, bottom grooves, T-nut holes (depth in each file)"
      guideLegend="Guide, not cut — sheet edge, slide lines, caster plates"
    />
  );
}
