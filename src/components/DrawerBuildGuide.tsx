import { useMemo } from 'react';
import BuildGuideView from './BuildGuideView';
import { drawerGuideSteps } from '../lib/drawerGuide';
import type { DrawerConfig, DrawerPlan } from '../lib/drawerUnit';
import { formatLength, type LengthUnit } from '../lib/shelving';

interface Props {
  plan: DrawerPlan;
  config: DrawerConfig;
  units: LengthUnit;
  /** Heading for the printed guide, e.g. the project name. */
  title?: string;
}

export default function DrawerBuildGuide({ plan, config, units, title = 'Drawer unit' }: Props) {
  const guide = useMemo(() => drawerGuideSteps(plan, config, units), [plan, config, units]);
  const f = (inches: number) => formatLength(inches, units);
  const subtitle = `${f(plan.overallWidth)} wide × ${f(plan.overallHeight)} tall × ${f(plan.overallDepth)} deep · `
    + `${plan.drawers.length} drawer${plan.drawers.length === 1 ? '' : 's'} on ${f(plan.slideLength)} slides · ${f(config.thickness)} case, ${f(config.boxThickness)} boxes`;
  return (
    <BuildGuideView
      guide={guide}
      width={plan.overallWidth}
      height={plan.overallHeight}
      depth={plan.caseDepth}
      wallMounted={false}
      units={units}
      title={title}
      subtitle={subtitle}
    />
  );
}
