import { useMemo } from 'react';
import BuildGuideView from './BuildGuideView';
import { buildGuideSteps, describeOpenings } from '../lib/buildGuide';
import { formatLength, type LengthUnit, type ShelfConfig, type ShelfPlan } from '../lib/shelving';

interface Props {
  plan: ShelfPlan;
  config: ShelfConfig;
  units: LengthUnit;
  /** Heading for the printed guide, e.g. the project name. */
  title?: string;
}

export default function ShelfBuildGuide({ plan, config, units, title = 'Shelving unit' }: Props) {
  const guide = useMemo(() => buildGuideSteps(plan, config, units), [plan, config, units]);
  const f = (inches: number) => formatLength(inches, units);
  const subtitle = `${f(plan.overallWidth)} wide × ${f(plan.overallHeight)} tall × ${f(plan.sideDepth)} deep · `
    + `${plan.bays.length} bay${plan.bays.length === 1 ? '' : 's'}, each ${f(config.bayWidth)} wide with ${describeOpenings(plan, f).phrase}`
    + ` · ${f(config.thickness)} plywood`;
  return (
    <BuildGuideView
      guide={guide}
      width={plan.overallWidth}
      height={plan.overallHeight}
      depth={plan.sideDepth}
      wallMounted={config.mounting === 'wall'}
      units={units}
      title={title}
      subtitle={subtitle}
    />
  );
}
