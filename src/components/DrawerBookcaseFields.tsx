// "Bookcase above" settings for the Drawer Builder: a hutch-style bookcase on a
// countertop or straight on the case, with bays, shelves, doors, a cap or crown,
// and a task-light valance.

import { SegmentedControl } from './ui';
import { LengthField, Stepper, Toggle } from './builderControls';
import type { BookcaseFields } from '../lib/drawerBookcase';
import type { DrawerPlan } from '../lib/drawerUnit';
import type { LengthUnit } from '../lib/shelving';

const SEAT_OPTIONS = [
  { value: 'countertop', label: 'On a countertop' },
  { value: 'stacked', label: 'Straight on the case' },
] as const;

const COUNTER_OPTIONS = [
  { value: 'plywood', label: 'Plywood' },
  { value: 'butcher', label: 'Butcher block' },
] as const;

const LAYER_OPTIONS = [
  { value: '1', label: 'Single' },
  { value: '2', label: 'Double thickness' },
] as const;

const TOP_OPTIONS = [
  { value: 'none', label: 'Plain' },
  { value: 'cap', label: 'Top cap' },
  { value: 'crown', label: 'Crown molding' },
] as const;

interface Props {
  value: BookcaseFields;
  units: LengthUnit;
  /** Errors keyed by the bookcase field ("height", "depth"…). */
  errors: Partial<Record<string, string>>;
  plan: DrawerPlan | null;
  fmt: (inches: number) => string;
  onChange: (patch: Partial<BookcaseFields>) => void;
}

export default function DrawerBookcaseFields({ value: b, units, errors, plan, fmt, onChange }: Props) {
  const bp = plan?.bookcase ?? null;
  const setBays = (bays: number) => onChange({ bays, doors: Array.from({ length: bays }, (_, i) => b.doors[i] ?? false) });
  return (
    <fieldset className="shelf-group" data-tour="fs-bookcase">
      <legend>Bookcase above</legend>
      <Toggle
        label="Put a bookcase on top"
        checked={b.enabled}
        hint="A built-in hutch: shelves and doors above the drawers, on a countertop or straight on the case. Floor-standing units only."
        onChange={enabled => onChange({ enabled })}
      />
      {b.enabled && (
        <>
          <SegmentedControl label="Sits" value={b.seat} options={SEAT_OPTIONS} onChange={seat => onChange({ seat })} />
          {b.seat === 'countertop' && (
            <>
              <SegmentedControl label="Countertop" value={b.counterMaterial} options={COUNTER_OPTIONS} onChange={counterMaterial => onChange({ counterMaterial })} />
              <div className="shelf-field-grid">
                {b.counterMaterial === 'plywood'
                  ? <SegmentedControl label="Thickness" value={String(b.counterLayers) as '1' | '2'} options={LAYER_OPTIONS} onChange={v => onChange({ counterLayers: v === '2' ? 2 : 1 })} />
                  : <LengthField unit={units} label="Top thickness" value={b.counterThickness} error={errors.counterThickness} hint="1 1/2″ is common." onChange={counterThickness => onChange({ counterThickness })} />}
                <LengthField unit={units} label="Front overhang" value={b.overhangFront} error={errors.overhangFront} hint="Past the drawer fronts." onChange={overhangFront => onChange({ overhangFront })} />
                <LengthField unit={units} label="End overhang" value={b.overhangSides} error={errors.overhangSides} hint="Only over the ends that show." onChange={overhangSides => onChange({ overhangSides })} />
              </div>
            </>
          )}
          <div className="shelf-field-grid">
            <LengthField unit={units} label="Bookcase height" value={b.height} error={errors.height}
              hint={bp ? `Top at ${fmt(bp.totalHeight)} from the floor` : 'Its own height, above the counter or case.'} onChange={height => onChange({ height })} />
            <LengthField unit={units} label="Bookcase depth" value={b.depth} error={errors.depth}
              hint={b.seat === 'countertop' ? 'Back included; 10–12″ suits books and leaves a work surface.' : 'Back included; up to the case depth.'} onChange={depth => onChange({ depth })} />
            <LengthField unit={units} label="Ceiling height" value={b.ceilingHeight} error={errors.ceilingHeight} placeholder="Optional"
              hint="Checks it fits, and that you can tilt it up in place." onChange={ceilingHeight => onChange({ ceilingHeight })} />
          </div>
          <div className="shelf-field-grid">
            <div className="form-field">
              <span className="form-field-label" id="bookcase-bays">Bays</span>
              <Stepper labelledBy="bookcase-bays" value={b.bays} min={1} max={6} onChange={setBays} noun="bay" />
              {bp && <small>{fmt(bp.shelfConfig.bayWidth)} clear each</small>}
            </div>
            <div className="form-field">
              <span className="form-field-label" id="bookcase-shelves">Fixed shelves per bay</span>
              <Stepper labelledBy="bookcase-shelves" value={b.shelves} min={0} max={8} onChange={shelves => onChange({ shelves })} noun="shelf" />
            </div>
            <div className="form-field">
              <span className="form-field-label" id="bookcase-adjustable">Adjustable shelves per bay</span>
              <Stepper labelledBy="bookcase-adjustable" value={b.adjustable} min={0} max={8} onChange={adjustable => onChange({ adjustable })} noun="shelf" />
            </div>
          </div>
          <Toggle
            label="Open space above the counter"
            checked={b.openSpace === true}
            hint="The sides run down to the counter, but the bottom and the shelves start higher — room for a monitor, a lamp or a sewing machine."
            onChange={openSpace => onChange({ openSpace, openHeight: b.openHeight || '18' })}
          />
          {b.openSpace && (
            <LengthField unit={units} label="Open space height" value={b.openHeight ?? ''} error={errors.openHeight}
              hint={bp ? `Shelves from ${fmt(bp.y0 + bp.config.openBelow)} up from the floor; 15–18″ is typical.` : '15–18″ is typical.'} onChange={openHeight => onChange({ openHeight })} />
          )}
          <div className="form-field">
            <span className="form-field-label">Doors</span>
            <div className="shelf-field-grid">
              {Array.from({ length: b.bays }, (_, i) => (
                <Toggle key={i} label={b.bays === 1 ? 'Door over the bay' : `Bay ${i + 1}`} checked={b.doors[i] === true}
                  onChange={on => onChange({ doors: Array.from({ length: b.bays }, (_, j) => (j === i ? on : b.doors[j] === true)) })} />
              ))}
            </div>
          </div>
          <SegmentedControl label="Top trim" value={b.top} options={TOP_OPTIONS} onChange={top => onChange({ top })} />
          {b.top === 'cap' && (
            <LengthField unit={units} label="Cap overhang" value={b.capProjection} error={errors.capProjection} hint="Past the front and the ends that show." onChange={capProjection => onChange({ capProjection })} />
          )}
          {b.top === 'crown' && (
            <div className="shelf-field-grid">
              <LengthField unit={units} label="Crown height" value={b.crownHeight} error={errors.crownHeight} onChange={crownHeight => onChange({ crownHeight })} />
              <LengthField unit={units} label="Crown projection" value={b.crownProjection} error={errors.crownProjection} hint="How far it stands out from the face." onChange={crownProjection => onChange({ crownProjection })} />
            </div>
          )}
          <Toggle
            label="Task light"
            checked={b.taskLight}
            hint="A valance under the bookcase bottom hides an LED strip over the counter, with a cord grommet through the countertop."
            onChange={taskLight => onChange({ taskLight })}
          />
          {b.taskLight && (
            <LengthField unit={units} label="Valance height" value={b.valanceHeight} error={errors.valanceHeight} onChange={valanceHeight => onChange({ valanceHeight })} />
          )}
        </>
      )}
    </fieldset>
  );
}
