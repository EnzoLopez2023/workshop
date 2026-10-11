// "Wall run" settings for the Drawer Builder: copies of this cabinet, desk gaps and
// fillers across a wall, under one countertop (and the bookcase above, if it's on).

import { ArrowLeft, ArrowRight, Plus, X } from 'lucide-react';
import { Button, SegmentedControl } from './ui';
import { scrollToSetting } from './scrollToSetting';
import { LengthField, Toggle } from './builderControls';
import { CORNER_FILLER, DEFAULT_CORNER, RUN_CABINET_LAYOUTS, runNeedsWallWidth, type RunCabinetLayout, type RunFields, type RunPosition } from '../lib/drawerRun';
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
  /** The design's own positions, top to bottom: a custom cabinet starts from them. */
  designPositions: RunPosition[];
  onChange: (patch: Partial<RunFields>) => void;
}

export default function DrawerRunFields({ value: r, units, errors, plan, fmt, cabinetWidth, conflict, designPositions, onChange }: Props) {
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
  // The main run's section that becomes the blind corner cabinet.
  const blindIndex = corner.enabled && (corner.style ?? 'open') === 'blind' ? (corner.side === 'right' ? r.sections.length - 1 : 0) : -1;
  // Jump links to each part of the run, so the cabinets, the return and the uppers are a click apart.
  const jumps: { id: string; label: string }[] = [];
  {
    let c = 0;
    let d = 0;
    r.sections.forEach((s, i) => jumps.push({ id: `run-section-${i}`, label: s.kind === 'cabinet' ? `Cabinet ${++c}` : `Desk ${++d}` }));
    if (corner.enabled) {
      jumps.push({ id: 'run-corner', label: 'Corner' });
      let rc = 0;
      let rd = 0;
      corner.sections.forEach((s, i) => jumps.push({ id: `run-return-${i}`, label: s.kind === 'cabinet' ? `Return ${++rc}` : `Return desk ${++rd}` }));
    }
    jumps.push({ id: 'drawer-bookcase', label: 'Uppers' });
  }
  const jumpTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) scrollToSetting(el);
  };
  let cab = 0;
  let desk = 0;
  return (
    <fieldset className="shelf-group" data-tour="fs-wall-run" data-part="run">
      <legend>Wall run</legend>
      <Toggle
        label="Build a wall of built-ins"
        disabledReason={r.enabled ? undefined : conflict}
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
          <nav className="drawer-run-jump" aria-label="Parts of the run">
            {jumps.map(j => <button key={j.id} type="button" onClick={() => jumpTo(j.id)}>{j.label}</button>)}
          </nav>
          <ol className="drawer-run-sections">
            {r.sections.map((s, i) => {
              const label = s.kind === 'cabinet' ? `Cabinet ${++cab}` : `Desk gap ${++desk}`;
              return (
                <li key={i} className="drawer-run-section" id={`run-section-${i}`} data-part={`run:${i}`}>
                  <span className="form-field-label">{label}{i === blindIndex ? ' · blind corner' : ''}</span>
                  {s.kind === 'cabinet'
                    ? <CabinetControls s={s} label={label} units={units} cabinetWidth={cabinetWidth} designPositions={designPositions} widthError={errors[`sections.${i}.width`]} blind={i === blindIndex} onChange={patch => setSection(i, patch)} />
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
            <div className="drawer-run-corner" id="run-corner" data-part="corner">
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
                designPositions={designPositions}
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
          <Toggle label="Cord grommet over each desk gap" checked={r.grommets === true}
            hint="A 2″ hole through the countertop, centred over each desk gap near the back, for monitor and charger cords."
            onChange={grommets => onChange({ grommets })} />
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
function SectionList({ label, sections, max, units, cabinetWidth, errors, designPositions, onChange }: {
  designPositions: RunPosition[];
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
            <li key={i} className="drawer-run-section" id={`run-return-${i}`} data-part={`ret:${i}`}>
              <span className="form-field-label">{name}</span>
              {s.kind === 'cabinet'
                ? <CabinetControls s={s} label={name} units={units} cabinetWidth={cabinetWidth} designPositions={designPositions} widthError={errors[`sections.${i}.width`]} onChange={patch => set(i, patch)} />
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

/**
 * One cabinet in a run: its fronts (this design's, or drawers, a door, a drawer over a door,
 * open shelves), its own width if it differs, and mirroring. The blind corner cabinet is
 * always one full-height door, so it only takes a width.
 */
const POSITION_OPTIONS: { value: RunPosition; label: string }[] = [
  { value: 'drawer', label: 'Drawer' },
  { value: 'door', label: 'Door' },
  { value: 'open', label: 'Open shelf' },
];

const describePositions = (list: RunPosition[]) => {
  const n = (k: RunPosition) => list.filter(x => x === k).length;
  return [
    n('drawer') && `${n('drawer')} drawer${n('drawer') === 1 ? '' : 's'}`,
    n('door') && `${n('door')} door${n('door') === 1 ? '' : 's'}`,
    n('open') && `${n('open')} open`,
  ].filter(Boolean).join(' + ');
};

function CabinetControls({ s, label, units, cabinetWidth, widthError, blind = false, designPositions, onChange }: {
  s: SectionField;
  label: string;
  units: LengthUnit;
  cabinetWidth: string;
  widthError?: string;
  blind?: boolean;
  designPositions: RunPosition[];
  onChange: (patch: Partial<SectionField>) => void;
}) {
  const positions = s.cabinetPositions?.length ? s.cabinetPositions : designPositions;
  const setPosition = (i: number, value: RunPosition) => onChange({ cabinetPositions: positions.map((p, k) => (k === i ? value : p)) });
  const editDesign = () => {
    const el = document.querySelector<HTMLElement>('[data-tour="fs-drawers"]');
    if (el) scrollToSetting(el);
  };
  return (
    <>
      {blind
        ? <small className="drawer-run-blind-note">One full-height door into the corner — a drawer would block reaching the blind space.</small>
        : (
          <span className="drawer-run-cabinet">
            <label className="drawer-run-fronts">
              <span>Drawers &amp; doors</span>
              <select aria-label={`${label} drawers and doors`} value={s.cabinetLayout ?? ''}
                onChange={e => {
                  const layout = e.target.value as RunCabinetLayout | '';
                  // Custom starts from what the cabinet has now (the design's positions).
                  onChange(layout === 'custom' && !s.cabinetPositions?.length ? { cabinetLayout: layout, cabinetPositions: designPositions } : { cabinetLayout: layout });
                }}>
                <option value="">Same as this design ({describePositions(designPositions)})</option>
                {RUN_CABINET_LAYOUTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
            {s.cabinetLayout === 'drawers' && (
              <label className="drawer-run-fronts">
                <span>How many</span>
                <select aria-label={`${label} drawer count`} value={s.cabinetDrawers ?? 4} onChange={e => onChange({ cabinetDrawers: Number(e.target.value) })}>
                  {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n} drawer{n === 1 ? '' : 's'}</option>)}
                </select>
              </label>
            )}
          </span>
        )}
      {!blind && !s.cabinetLayout && (
        <button type="button" className="drawer-run-link" onClick={editDesign}>Edit this design’s drawers &amp; doors</button>
      )}
      {!blind && s.cabinetLayout === 'custom' && (
        <ol className="drawer-run-positions" aria-label={`${label} positions, top to bottom`}>
          {positions.map((p, i) => (
            <li key={i}>
              <span>{i === 0 ? 'Top' : i === positions.length - 1 ? 'Bottom' : `Position ${i + 1}`}</span>
              <select aria-label={`${label} position ${i + 1}`} value={p} onChange={e => setPosition(i, e.target.value as RunPosition)}>
                {POSITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
              <Button variant="ghost" aria-label={`Remove ${label} position ${i + 1}`} disabled={positions.length <= 1}
                onClick={() => onChange({ cabinetPositions: positions.filter((_, k) => k !== i) })}><X size={14} aria-hidden="true" /></Button>
            </li>
          ))}
          <li>
            <Button variant="ghost" disabled={positions.length >= 8} onClick={() => onChange({ cabinetPositions: [...positions, 'drawer'] })}>
              <Plus size={14} aria-hidden="true" /> Add a position
            </Button>
          </li>
        </ol>
      )}
      <LengthField unit={units} label="Width" value={s.cabinetWidth ?? ''} placeholder={cabinetWidth} error={widthError}
        hint={s.cabinetWidth?.trim() ? 'Its own width; its upper matches it.' : 'Blank: this design’s width.'}
        onChange={cabinetWidth => onChange({ cabinetWidth })} />
      {!blind && <Toggle label="Mirrored" checked={s.mirror} hint="Doors hinge the other way." onChange={mirror => onChange({ mirror })} />}
    </>
  );
}
