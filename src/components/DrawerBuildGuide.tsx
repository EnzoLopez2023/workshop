import { useMemo } from 'react';
import BuildGuideView from './BuildGuideView';
import { drawerGuideSteps } from '../lib/drawerGuide';
import { boxedDrawers, finishColors, type DrawerConfig, type DrawerPlan } from '../lib/drawerUnit';
import { formatLength, type LengthUnit } from '../lib/shelving';

interface Props {
  plan: DrawerPlan;
  config: DrawerConfig;
  units: LengthUnit;
  /** Heading for the printed guide, e.g. the project name. */
  title?: string;
  /** Build tracker: finished step ids and where to save them. */
  progress?: { done: string[]; onChange: (done: string[]) => void; status?: string };
}

export default function DrawerBuildGuide({ plan, config, units, progress, title = 'Drawer unit' }: Props) {
  const guide = useMemo(() => drawerGuideSteps(plan, config, units), [plan, config, units]);
  const f = (inches: number) => formatLength(inches, units);
  const subtitle = `${f(plan.overallWidth)} wide × ${f(plan.overallHeight)} tall × ${f(plan.overallDepth)} deep · `
    + `${boxedDrawers(plan).length} drawer${boxedDrawers(plan).length === 1 ? '' : 's'} on ${f(plan.slideLength)} slides · ${f(config.thickness)} case, ${f(config.boxThickness)} boxes`;
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
      progress={progress}
      colors={finishColors(config.finish)}
    />
  );
}
