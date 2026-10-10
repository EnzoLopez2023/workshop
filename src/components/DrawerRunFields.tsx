// "Wall run" settings for the Drawer Builder: copies of this cabinet, desk gaps and
// fillers across a wall, under one countertop (and the bookcase above, if it's on).

import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react';
import { Button, SegmentedControl } from './ui';
import { LengthField, Toggle } from './builderControls';
import { CORNER_FILLER, DEFAULT_CORNER, runNeedsWallWidth, type RunFields } from '../lib/drawerRun';
import type { DrawerPlan } from '../lib/drawerUnit';
import type { LengthUnit } from '../lib/shelving';

const END_OPTIONS = [
  { value: 'wall', label: 'Wall' },
  { value: 'open', label: 'Open' },
] as const;

const CORNER_STYLE_OPTIONS = [
  { value: 'blind', label: 'Blind cabinet' },
  { value: 'open', label: 'Open bay' },
] as const;

const CORNER_SIDE_OPTIONS = [
  { value: 'left', label: 'Left end' },
  { value: 'right', label: 'Right end' },
] as const;

type SectionField = RunFields['sections'][number];

interface Props {
  value: RunFields;
  units: LengthUnit;
  /** Errors keyed "wallWidth" or "sections.N". */
  errors: Partial<Record<string, string>>;
  plan: DrawerPlan | null;
  fmt: (inches: number) => string;
  /** The cabinet's width, as typed (every cabinet in the run is this design). */
  cabinetWidth: string;
  /** Why it can't be turned on right now. */
  conflict?: string;
  onChange: (patch: Partial<RunFields>) => void;
}

export default function DrawerRunFields({ value: r, units, errors, plan, fmt, cabinetWidth, conflict, onChange }: Props) {
  const run = plan?.run ?? null;
  const setSection = (i: number, patch: Partial<RunFields['sections'][number]>) =>
    onChange({ sections: r.sections.map((s, k) => (k === i ? { ...s, ...patch } : s)) });
  const move = (i: number, by: number) => {
    const next = [...r.sections];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    onChange({ sections: next });
  };
  const add = (kind: 'cabinet' | 'desk') => onChange({ sections: [...r.sections, { kind, width: kind === 'desk' ? '48' : '', mirror: false }] });
  const corner = r.corner ?? {
    enabled: false, side: DEFAULT_CORNER.side, wallLength: String(DEFAULT_CORNER.wallLength),
    sections: DEFAULT_CORNER.sections.map(x => ({ kind: x.kind, width: '30', mirror: false })), end: DEFAULT_CORNER.end,
  };
  const setCorner = (patch: Partial<typeof corner>) => onChange({ corner: { ...corner, ...patch } });
  const cornerPlan = run?.corner ?? null;
  const cornerSide = corner.enabled ? corner.side : null;
  let cab = 0;
  let desk = 0;
  return (
    <fieldset className="shelf-group" data-tour="fs-wall-run">
      <legend>Wall run</legend>
      {conflict && !r.enabled && <p className="shelf-group-note">{conflict}</p>}
      <Toggle
        label="Build a wall of built-ins"
        disabled={!!conflict && !r.enabled}
        checked={r.enabled}
        hint="Copies of this cabinet with desk gaps between them and fillers scribed to the walls, under one countertop — and the bookcase over each, if it’s on."
        onChange={enabled => onChange({ enabled })}
      />
      {r.enabled && (
        <>
          <div className="shelf-field-grid">
            {cornerSide === 'left'
              ? <p className="shelf-group-note">Left end: turns the corner</p>
              : <SegmentedControl label="Left end" value={r.leftEnd} options={END_OPTIONS} onChange={leftEnd => onChange({ leftEnd })} />}
            {cornerSide === 'right'
              ? <p className="shelf-group-note">Right end: turns the corner</p>
              : <SegmentedControl label="Right end" value={r.rightEnd} options={END_OPTIONS} onChange={rightEnd => onChange({ rightEnd })} />}
          </div>
          {runNeedsWallWidth({ ...r, corner }) && (
            <LengthField unit={units} label="Wall width" value={r.wallWidth} error={errors.wallWidth}
              hint={run?.fillers.length ? `Fillers ${fmt(run.fillers[0].width)} at each wall (cut ${fmt(run.fillers[0].width + 0.5)} and scribed).` : 'Wall to wall, measured at the height of the countertop.'}
              onChange={wallWidth => onChange({ wallWidth })} />
          )}
          <ol className="drawer-run-sections">
            {r.sections.map((s, i) => {
              const label = s.kind === 'cabinet' ? `Cabinet ${++cab}` : `Desk gap ${++desk}`;
              return (
                <li key={i} className="drawer-run-section">
                  <span className="form-field-label">{label}</span>
                  {s.kind === 'cabinet'
                    ? (
                      <>
                        <small>{cabinetWidth}{units === 'mm' ? ' mm' : '″'} wide — this design</small>
                        <Toggle label="Mirrored" checked={s.mirror} hint="Doors hinge the other way." onChange={mirror => setSection(i, { mirror })} />
                      </>
                    )
                    : <LengthField unit={units} label="Knee space" value={s.width} error={errors[`sections.${i}`]} onChange={width => setSection(i, { width })} />}
                  <span className="drawer-run-actions">
                    <Button variant="ghost" aria-label={`Move ${label} left`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft size={15} aria-hidden="true" /></Button>
                    <Button variant="ghost" aria-label={`Move ${label} right`} disabled={i === r.sections.length - 1} onClick={() => move(i, 1)}><ArrowRight size={15} aria-hidden="true" /></Button>
                    <Button variant="ghost" aria-label={`Remove ${label}`} disabled={r.sections.length <= 1} onClick={() => onChange({ sections: r.sections.filter((_, k) => k !== i) })}><X size={15} aria-hidden="true" /></Button>
                  </span>
                </li>
              );
            })}
          </ol>
          <span className="shelf-source-actions">
            <Button variant="ghost" onClick={() => add('cabinet')} disabled={r.sections.length >= 8}><Plus size={15} aria-hidden="true" /> Cabinet</Button>
            <Button variant="ghost" onClick={() => add('desk')} disabled={r.sections.length >= 8}><Plus size={15} aria-hidden="true" /> Desk gap</Button>
          </span>
          <Toggle label="Turn a corner" checked={corner.enabled}
            hint={`The run carries on along the side wall: an open corner square under the countertop, a ${CORNER_FILLER}″ corner filler, then the return’s cabinets and desk gaps.`}
            onChange={enabled => setCorner({ enabled })} />
          {corner.enabled && (
            <div className="drawer-run-corner">
              <SegmentedControl label="Corner at the" value={corner.side} options={CORNER_SIDE_OPTIONS} onChange={side => setCorner({ side })} />
              <SegmentedControl label="Return ends at" value={corner.end} options={END_OPTIONS} onChange={end => setCorner({ end })} />
              <SegmentedControl label="Corner square" value={corner.style ?? 'open'} options={CORNER_STYLE_OPTIONS} onChange={style => setCorner({ style })} />
              <small>{(corner.style ?? 'open') === 'blind'
                ? `The main run’s ${corner.side === 'right' ? 'last' : 'first'} cabinet becomes a blind corner cabinet: its case runs on into the corner, so the door beside it reaches the corner space.`
                : 'An open square under the countertop: knee space when a desk gap meets it, otherwise dead space you lean in to reach.'}</small>
              {corner.end === 'wall' && (
                <LengthField unit={units} label="Side wall length" value={corner.wallLength} error={errors['corner.wallLength']}
                  hint={cornerPlan?.filler ? `From the back wall to the far wall. End filler ${fmt(cornerPlan.filler.width)}.` : 'From the back wall to the wall the return stops at.'}
                  onChange={wallLength => setCorner({ wallLength })} />
              )}
              <SectionList
                label="Return"
                sections={corner.sections}
                max={6}
                units={units}
                cabinetWidth={cabinetWidth}
                errors={Object.fromEntries(Object.entries(errors).filter(([k]) => k.startsWith('corner.sections.')).map(([k, v]) => [k.slice('corner.'.length), v]))}
                onChange={sections => setCorner({ sections })}
              />
              {cornerPlan && (
                <p className="shelf-group-note">
                  Return: {fmt(cornerPlan.end - cornerPlan.start)} of sections starting {fmt(cornerPlan.start)} from the back wall; countertop {fmt(cornerPlan.countertop.x1 - cornerPlan.countertop.x0)} long.
                </p>
              )}
            </div>
          )}
          <Toggle label="Bookcase over the desk gaps too" checked={r.deskUppers}
            hint="Needs the bookcase on (below). Off leaves the wall over the desk open." onChange={deskUppers => onChange({ deskUppers })} />
          {run && (
            <p className="shelf-group-note">
              {fmt(run.width)} wide: {run.cabinetCount} cabinet{run.cabinetCount === 1 ? '' : 's'}
              {run.sections.some(x => x.kind === 'desk') ? `, ${run.sections.filter(x => x.kind === 'desk').length} desk gap${run.sections.filter(x => x.kind === 'desk').length === 1 ? '' : 's'}` : ''}
              {run.fillers.length ? `, ${fmt(run.fillers[0].width)} fillers` : ''}; countertop {fmt(run.countertop.x1 - run.countertop.x0)} long{run.countertop.pieces > 1 ? ` in ${run.countertop.pieces} pieces` : ''}.
            </p>
          )}
        </>
      )}
    </fieldset>
  );
}

/** The return's sections: cabinets (this design) and desk gaps, in order from the corner. */
function SectionList({ label, sections, max, units, cabinetWidth, errors, onChange }: {
  label: string;
  sections: SectionField[];
  max: number;
  units: LengthUnit;
  cabinetWidth: string;
  errors: Partial<Record<string, string>>;
  onChange: (sections: SectionField[]) => void;
}) {
  const set = (i: number, patch: Partial<SectionField>) => onChange(sections.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const move = (i: number, by: number) => {
    const next = [...sections];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s);
    onChange(next);
  };
  let cab = 0;
  let desk = 0;
  return (
    <>
      <ol className="drawer-run-sections">
        {sections.map((s, i) => {
          const name = s.kind === 'cabinet' ? `${label} cabinet ${++cab}` : `${label} desk gap ${++desk}`;
          return (
            <li key={i} className="drawer-run-section">
              <span className="form-field-label">{name}</span>
              {s.kind === 'cabinet'
                ? (
                  <>
                    <small>{cabinetWidth}{units === 'mm' ? ' mm' : '″'} wide — this design</small>
                    <Toggle label="Mirrored" checked={s.mirror} hint="Doors hinge the other way." onChange={mirror => set(i, { mirror })} />
                  </>
                )
                : <LengthField unit={units} label="Knee space" value={s.width} error={errors[`sections.${i}`]} onChange={width => set(i, { width })} />}
              <span className="drawer-run-actions">
                <Button variant="ghost" aria-label={`Move ${name} toward the corner`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowLeft size={15} aria-hidden="true" /></Button>
                <Button variant="ghost" aria-label={`Move ${name} away from the corner`} disabled={i === sections.length - 1} onClick={() => move(i, 1)}><ArrowRight size={15} aria-hidden="true" /></Button>
                <Button variant="ghost" aria-label={`Remove ${name}`} disabled={sections.length <= 1} onClick={() => onChange(sections.filter((_, k) => k !== i))}><X size={15} aria-hidden="true" /></Button>
              </span>
            </li>
          );
        })}
      </ol>
      <span className="shelf-source-actions">
        <Button variant="ghost" onClick={() => onChange([...sections, { kind: 'cabinet', width: '', mirror: false }])} disabled={sections.length >= max}><Plus size={15} aria-hidden="true" /> {label} cabinet</Button>
        <Button variant="ghost" onClick={() => onChange([...sections, { kind: 'desk', width: '30', mirror: false }])} disabled={sections.length >= max}><Plus size={15} aria-hidden="true" /> {label} desk gap</Button>
      </span>
    </>
  );
}
