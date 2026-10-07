// "Wall run" settings for the Drawer Builder: copies of this cabinet, desk gaps and
// fillers across a wall, under one countertop (and the bookcase above, if it's on).

import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react';
import { Button, SegmentedControl } from './ui';
import { LengthField, Toggle } from './builderControls';
import type { RunFields } from '../lib/drawerRun';
import type { DrawerPlan } from '../lib/drawerUnit';
import type { LengthUnit } from '../lib/shelving';

const END_OPTIONS = [
  { value: 'wall', label: 'Wall' },
  { value: 'open', label: 'Open' },
] as const;

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
            <SegmentedControl label="Left end" value={r.leftEnd} options={END_OPTIONS} onChange={leftEnd => onChange({ leftEnd })} />
            <SegmentedControl label="Right end" value={r.rightEnd} options={END_OPTIONS} onChange={rightEnd => onChange({ rightEnd })} />
          </div>
          {(r.leftEnd === 'wall' || r.rightEnd === 'wall') && (
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
