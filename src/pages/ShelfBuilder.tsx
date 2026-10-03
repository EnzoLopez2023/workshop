import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowLeft, Check, Clipboard, FolderPlus, Minus, Plus, Printer, RotateCcw,
} from 'lucide-react';
import { Button, IconButton, PageFrame, PageHeader, SegmentedControl } from '../components/ui';
import CutPlanOptimizer from '../components/CutPlanOptimizer';
import ShelfAddToProject from '../components/ShelfAddToProject';
import {
  buildShelfPlan,
  decimalString,
  formatLength,
  lengthToField,
  parseLength,
  shelfSolids,
  type Joinery,
  type LengthUnit,
  type Mounting,
  type ShelfConfig,
  type ShelfPlan,
} from '../lib/shelving';
import type { CutListItem } from '../types/project';

const ShelfViewer3D = lazy(() => import('../components/ShelfViewer3D'));

const STORAGE_KEY = 'workshop-shelf-builder';
const VIEW_STORAGE_KEY = 'workshop-shelf-builder-view';
const MAX_BAYS = 12;
const MAX_SHELVES = 20;

interface FormState {
  units: LengthUnit;
  thickness: string;
  bayWidth: string;
  shelfDepth: string;
  height: string;
  bays: number;
  shelvesPerBay: number[];
  topPanel: boolean;
  bottomPanel: boolean;
  backPanel: boolean;
  joinery: Joinery;
  dadoDepth: string;
  mounting: Mounting;
  toeKick: string;
  frenchCleat: boolean;
  cleatHeight: string;
}

const DEFAULT_FORM: FormState = {
  units: 'in',
  thickness: '3/4',
  bayWidth: '17 1/2',
  shelfDepth: '11 1/4',
  height: '74',
  bays: 4,
  shelvesPerBay: [6, 7, 2, 5],
  topPanel: true,
  bottomPanel: true,
  backPanel: true,
  joinery: 'dado',
  dadoDepth: '1/4',
  mounting: 'floor',
  toeKick: '3',
  frenchCleat: false,
  cleatHeight: '3',
};

// Each preset carries its own unit so it means the same thing in either mode.
const THICKNESS_PRESETS: Record<LengthUnit, string[]> = {
  in: ['3/4"', '23/32"', '1/2"', '15/32"', '18 mm'],
  mm: ['18 mm', '15 mm', '12 mm', '9 mm', '3/4"'],
};

const UNIT_OPTIONS = [
  { value: 'in', label: 'Inches' },
  { value: 'mm', label: 'Millimeters' },
] as const;

const LENGTH_FIELDS = ['thickness', 'bayWidth', 'shelfDepth', 'height', 'dadoDepth', 'toeKick', 'cleatHeight'] as const;

/** Rewrites every size field into the other unit; values that don't parse are left as typed. */
function convertForm(form: FormState, units: LengthUnit): FormState {
  if (form.units === units) return form;
  const next: FormState = { ...form, units };
  for (const key of LENGTH_FIELDS) {
    const raw = form[key].trim();
    if (key === 'toeKick' && (raw === '' || Number(raw) === 0)) continue;
    const inches = parseLength(raw, form.units);
    if (inches !== null) next[key] = lengthToField(inches, units);
  }
  return next;
}

const JOINERY_OPTIONS = [
  { value: 'dado', label: 'Dadoed' },
  { value: 'butt', label: 'Butt joint' },
] as const;

type PreviewMode = '3d' | 'drawing';

const VIEW_OPTIONS = [
  { value: '3d', label: '3D' },
  { value: 'drawing', label: 'Drawing' },
] as const;

function readStoredView(): PreviewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'drawing' ? 'drawing' : '3d';
  } catch {
    return '3d';
  }
}

const MOUNTING_OPTIONS = [
  { value: 'floor', label: 'Floor unit' },
  { value: 'wall', label: 'Wall mount' },
] as const;

function readStoredForm(): FormState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORM;
    const parsed = JSON.parse(raw) as Partial<FormState>;
    const merged = { ...DEFAULT_FORM, ...parsed };
    if (merged.units !== 'mm') merged.units = 'in';
    if (!Array.isArray(merged.shelvesPerBay)) merged.shelvesPerBay = DEFAULT_FORM.shelvesPerBay;
    return merged;
  } catch {
    return DEFAULT_FORM;
  }
}

type FieldKey = typeof LENGTH_FIELDS[number];

function toConfig(form: FormState): { config: ShelfConfig | null; fieldErrors: Partial<Record<FieldKey, string>> } {
  const fieldErrors: Partial<Record<FieldKey, string>> = {};
  const num = (key: FieldKey, { allowZero = false } = {}) => {
    const raw = form[key].trim();
    if (allowZero && (raw === '' || Number(raw) === 0)) return 0;
    const value = parseLength(raw, form.units);
    if (value === null) {
      fieldErrors[key] = form.units === 'mm'
        ? 'Enter millimeters, e.g. 286, or inches like 11 1/4"'
        : 'Enter inches, e.g. 11 1/4 or 11.25, or millimeters like 286mm';
    }
    return value ?? 0;
  };
  const thickness = num('thickness');
  const bayWidth = num('bayWidth');
  const shelfDepth = num('shelfDepth');
  const height = num('height');
  const dadoDepth = form.joinery === 'dado' ? num('dadoDepth') : 0;
  const toeKick = form.mounting === 'floor' && form.bottomPanel ? num('toeKick', { allowZero: true }) : 0;
  const cleatHeight = form.mounting === 'wall' && form.frenchCleat ? num('cleatHeight') : 3;
  if (Object.keys(fieldErrors).length > 0) return { config: null, fieldErrors };
  return {
    config: {
      thickness, bayWidth, shelfDepth, height,
      bays: form.bays,
      shelvesPerBay: form.shelvesPerBay,
      topPanel: form.topPanel,
      bottomPanel: form.bottomPanel,
      backPanel: form.backPanel,
      joinery: form.joinery,
      dadoDepth,
      mounting: form.mounting,
      toeKick,
      frenchCleat: form.frenchCleat,
      cleatHeight,
      units: form.units,
    },
    fieldErrors,
  };
}

function toCutList(plan: ShelfPlan): CutListItem[] {
  return plan.parts.map((part, index) => ({
    id: index + 1,
    project_id: null,
    part_name: part.name,
    qty: part.qty,
    length: decimalString(part.length),
    width: decimalString(part.width),
    thickness: decimalString(part.thickness),
    material: 'plywood',
    sort_order: index,
  }));
}

export default function ShelfBuilder() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(readStoredForm);
  const [copyStatus, setCopyStatus] = useState('');
  const [view, setView] = useState<PreviewMode>(readStoredView);
  const [addingToProject, setAddingToProject] = useState(false);
  const units = form.units;
  const fmt = (inches: number) => formatLength(inches, units);
  const otherUnit = (inches: number) => formatLength(inches, units === 'mm' ? 'in' : 'mm');

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(form));
    } catch {
      // Browser storage is a convenience only.
    }
  }, [form]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch {
      // Browser storage is a convenience only.
    }
  }, [view]);

  const { config, fieldErrors } = useMemo(() => toConfig(form), [form]);
  const plan = useMemo(() => (config ? buildShelfPlan(config) : null), [config]);
  const valid = plan !== null && plan.errors.length === 0;
  const cutList = useMemo(() => (plan && valid ? toCutList(plan) : []), [plan, valid]);
  const solids = useMemo(() => (plan && config && valid ? shelfSolids(plan, config) : []), [plan, config, valid]);

  const update = (patch: Partial<FormState>) => {
    setCopyStatus('');
    setForm(prev => ({ ...prev, ...patch }));
  };

  const setBays = (bays: number) => {
    const next = Math.min(MAX_BAYS, Math.max(1, bays));
    setForm(prev => {
      const fill = prev.shelvesPerBay[prev.shelvesPerBay.length - 1] ?? 4;
      const shelvesPerBay = Array.from({ length: next }, (_, i) => prev.shelvesPerBay[i] ?? fill);
      return { ...prev, bays: next, shelvesPerBay };
    });
  };

  const setShelves = (bay: number, count: number) => {
    setForm(prev => ({
      ...prev,
      shelvesPerBay: prev.shelvesPerBay.map((c, i) => (i === bay ? Math.min(MAX_SHELVES, Math.max(0, count)) : c)),
    }));
  };

  const copyCutList = async () => {
    if (!plan) return;
    const lines = [
      ['Part', 'Qty', 'Length', 'Width', 'Thickness', 'Notes'].join('\t'),
      ...plan.parts.map(p => [p.name, p.qty, fmt(p.length), fmt(p.width), fmt(p.thickness), p.note ?? ''].join('\t')),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopyStatus('Cut list copied.');
    } catch (error) {
      console.error('Cut list copy failed', error);
      setCopyStatus('The cut list could not be copied. Select the table instead.');
    }
  };

  const wall = form.mounting === 'wall';
  const cleat = wall && form.frenchCleat;

  return (
    <PageFrame maxWidth={1200} className="shelf-page">
      <Button variant="ghost" onClick={() => navigate(-1)} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </Button>

      <PageHeader
        title="Shelf Builder"
        description="Design a plywood shelving unit by bay, then take the exact cut list, shelf positions, and sheet layout to the saw."
        actions={(
          <Button variant="ghost" onClick={() => setForm(convertForm(DEFAULT_FORM, units))}>
            <RotateCcw size={16} aria-hidden="true" /> Reset design
          </Button>
        )}
      />

      <div className="shelf-layout">
        <section className="shelf-config" aria-labelledby="shelf-config-title">
          <h2 id="shelf-config-title" className="sr-only">Design</h2>

          <fieldset className="shelf-group">
            <legend>Units</legend>
            <SegmentedControl label="Units" value={units} options={UNIT_OPTIONS} onChange={next => setForm(prev => convertForm(prev, next))} />
            <p className="shelf-group-note">
              Switching converts every size. Any box also takes the other unit: type <kbd>18mm</kbd> or <kbd>3/4"</kbd>.
            </p>
          </fieldset>

          <fieldset className="shelf-group">
            <legend>Material</legend>
            <LengthField
              unit={units}
              label="Plywood thickness"
              value={form.thickness}
              error={fieldErrors.thickness}
              hint="Use the actual thickness. The back and French cleat use the same stock."
              onChange={thickness => update({ thickness })}
            />
            <div className="shelf-chips" role="group" aria-label="Common plywood thicknesses">
              {THICKNESS_PRESETS[units].map(preset => {
                const inches = parseLength(preset, units)!;
                const current = parseLength(form.thickness, units);
                return (
                  <button
                    key={preset}
                    type="button"
                    className="shelf-chip"
                    aria-pressed={current !== null && Math.abs(current - inches) < 0.002}
                    onClick={() => update({ thickness: lengthToField(inches, units) })}
                  >
                    {preset}
                  </button>
                );
              })}
            </div>
          </fieldset>

          <fieldset className="shelf-group">
            <legend>Bays</legend>
            <div className="shelf-field-grid">
              <LengthField unit={units} label="Bay width (clear)" value={form.bayWidth} error={fieldErrors.bayWidth} onChange={bayWidth => update({ bayWidth })} />
              <LengthField unit={units} label="Shelf depth" value={form.shelfDepth} error={fieldErrors.shelfDepth} onChange={shelfDepth => update({ shelfDepth })} />
              <LengthField unit={units} label="Overall height" value={form.height} error={fieldErrors.height} onChange={height => update({ height })} />
              <div className="form-field">
                <span className="form-field-label" id="bay-count-label">Number of bays</span>
                <Stepper
                  labelledBy="bay-count-label"
                  value={form.bays}
                  min={1}
                  max={MAX_BAYS}
                  onChange={setBays}
                  noun="bay"
                />
              </div>
            </div>
            <div className="shelf-bay-list">
              <span className="form-field-label">Fixed shelves per bay</span>
              {form.shelvesPerBay.map((count, i) => (
                <div className="shelf-bay-row" key={i}>
                  <span id={`bay-${i}-label`}>Bay {i + 1}</span>
                  <Stepper
                    labelledBy={`bay-${i}-label`}
                    value={count}
                    min={0}
                    max={MAX_SHELVES}
                    onChange={value => setShelves(i, value)}
                    noun="shelf"
                  />
                  {plan && plan.bays[i] && plan.bays[i].openingHeight > 0 && (
                    <small>{fmt(plan.bays[i].openingHeight)} openings</small>
                  )}
                </div>
              ))}
            </div>
          </fieldset>

          <fieldset className="shelf-group">
            <legend>Case</legend>
            <Toggle label="Top panel" checked={form.topPanel} onChange={topPanel => update({ topPanel })} />
            <Toggle label="Bottom panel" checked={form.bottomPanel} onChange={bottomPanel => update({ bottomPanel })} />
            <Toggle
              label="Back panel"
              checked={form.backPanel || cleat}
              disabled={cleat}
              hint={cleat ? 'Required for the French cleat.' : 'Inset between the sides; the sides grow by its thickness.'}
              onChange={backPanel => update({ backPanel })}
            />
          </fieldset>

          <fieldset className="shelf-group">
            <legend>Joinery</legend>
            <SegmentedControl label="Shelf joinery" value={form.joinery} options={JOINERY_OPTIONS} onChange={joinery => update({ joinery })} />
            {form.joinery === 'dado' && (
              <LengthField
                unit={units}
                label="Dado depth"
                value={form.dadoDepth}
                error={fieldErrors.dadoDepth}
                hint="Shelves, top, and bottom grow by twice this depth. About 1/3 of the thickness is typical."
                onChange={dadoDepth => update({ dadoDepth })}
              />
            )}
          </fieldset>

          <fieldset className="shelf-group">
            <legend>Mounting</legend>
            <SegmentedControl label="Mounting" value={form.mounting} options={MOUNTING_OPTIONS} onChange={mounting => update({ mounting })} />
            {!wall && (
              <LengthField
                unit={units}
                label="Toe kick height"
                value={form.toeKick}
                error={fieldErrors.toeKick}
                disabled={!form.bottomPanel}
                hint={form.bottomPanel ? 'Raises the bottom panel off the floor. Use 0 for none.' : 'Needs a bottom panel.'}
                onChange={toeKick => update({ toeKick })}
              />
            )}
            {wall && (
              <>
                <Toggle
                  label="French cleat"
                  checked={form.frenchCleat}
                  hint="Insets the back by the cleat thickness and deepens the sides to hide it."
                  onChange={frenchCleat => update({ frenchCleat })}
                />
                {form.frenchCleat && (
                  <LengthField
                unit={units}
                    label="Cleat height"
                    value={form.cleatHeight}
                    error={fieldErrors.cleatHeight}
                    onChange={cleatHeight => update({ cleatHeight })}
                  />
                )}
              </>
            )}
          </fieldset>
        </section>

        <section className="shelf-preview" aria-labelledby="shelf-preview-title">
          <header className="shelf-preview-head">
            <h2 id="shelf-preview-title">Preview</h2>
            <SegmentedControl label="Preview mode" value={view} options={VIEW_OPTIONS} onChange={setView} />
          </header>
          {plan ? (
            <>
              <dl className="shelf-summary">
                <Stat label="Overall width" value={fmt(plan.overallWidth)} />
                <Stat label="Overall height" value={fmt(plan.overallHeight)} />
                <Stat label="Side depth" value={fmt(plan.sideDepth)} accent={plan.sideDepth !== config?.shelfDepth} />
                <Stat label="Parts" value={String(plan.parts.reduce((s, p) => s + p.qty, 0))} />
              </dl>
              {view === '3d' && valid ? (
                <Suspense fallback={<div className="shelf-viewer"><p className="shelf-viewer-status">Loading 3D view…</p></div>}>
                  <ShelfViewer3D
                    solids={solids}
                    width={plan.overallWidth}
                    height={plan.overallHeight}
                    depth={plan.sideDepth}
                    wallMounted={config!.mounting === 'wall'}
                    label={`3D view of a ${fmt(plan.overallWidth)} wide, ${fmt(plan.overallHeight)} tall shelving unit with ${plan.bays.length} bays`}
                  />
                </Suspense>
              ) : (
                <FrontElevation plan={plan} thickness={config!.thickness} fmt={fmt} />
              )}
              <SideSection plan={plan} config={config!} fmt={fmt} />
            </>
          ) : (
            <p className="shelf-placeholder">Fix the highlighted measurements to see the drawing.</p>
          )}
        </section>
      </div>

      {plan && plan.errors.length > 0 && (
        <div className="inline-error shelf-banner" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <span>{plan.errors.join(' ')}</span>
        </div>
      )}
      {plan && plan.warnings.length > 0 && (
        <ul className="shelf-warnings" role="status">
          {plan.warnings.map(w => (
            <li key={w}><AlertTriangle size={16} aria-hidden="true" /> {w}</li>
          ))}
        </ul>
      )}

      {plan && valid && (
        <>
          <section className="shelf-section" aria-labelledby="shelf-cutlist-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="shelf-cutlist-title">Cut list</h2>
                <p>
                  {fmt(config!.thickness)} plywood
                  {plan.dadoDepth > 0 ? ` · ${fmt(plan.dadoDepth)} dados included in lengths` : ' · butt joints'}
                  {plan.cleatGap > 0 ? ` · back inset ${fmt(plan.cleatGap)} for the cleat` : ''}
                </p>
              </div>
              <div className="shelf-section-actions">
                <Button
                  variant={addingToProject ? 'secondary' : 'ghost'}
                  onClick={() => setAddingToProject(open => !open)}
                  aria-expanded={addingToProject}
                  aria-controls="shelf-add-project"
                >
                  <FolderPlus size={16} aria-hidden="true" /> Add to project
                </Button>
                <Button variant="ghost" onClick={() => void copyCutList()}>
                  {copyStatus === 'Cut list copied.' ? <Check size={16} aria-hidden="true" /> : <Clipboard size={16} aria-hidden="true" />}
                  Copy
                </Button>
                <Button variant="ghost" onClick={() => window.print()}>
                  <Printer size={16} aria-hidden="true" /> Print
                </Button>
                <span className="sr-only" role="status">{copyStatus}</span>
              </div>
            </header>
            <div className="shelf-table-scroll" tabIndex={0} aria-label="Cut list table">
              <table className="shelf-table">
                <thead>
                  <tr>
                    <th scope="col">Part</th>
                    <th scope="col">Qty</th>
                    <th scope="col">Length</th>
                    <th scope="col">Width</th>
                    <th scope="col">Thick</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {plan.parts.map(p => (
                    <tr key={p.name}>
                      <th scope="row">{p.name}</th>
                      <td>{p.qty}</td>
                      <td title={otherUnit(p.length)}>{fmt(p.length)}</td>
                      <td title={otherUnit(p.width)}>{fmt(p.width)}</td>
                      <td title={otherUnit(p.thickness)}>{fmt(p.thickness)}</td>
                      <td className="is-muted">{p.note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {addingToProject && (
              <div id="shelf-add-project">
                <ShelfAddToProject plan={plan} config={config!} units={units} onClose={() => setAddingToProject(false)} />
              </div>
            )}
          </section>

          <section className="shelf-section" aria-labelledby="shelf-marks-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="shelf-marks-title">{plan.dadoDepth > 0 ? 'Dado layout' : 'Shelf positions'}</h2>
                <p>
                  Distances to the bottom edge of each {plan.dadoDepth > 0 ? `${fmt(config!.thickness)}-wide dado` : 'shelf'}.
                  Mark matching parts together to keep shelves level.
                </p>
              </div>
            </header>
            <ul className="shelf-marks">
              {plan.marks.map(m => (
                <li key={`${m.part}-${m.reference}`}>
                  <strong>{m.part}</strong>
                  <span className="is-muted">{m.reference}</span>
                  <span className="shelf-mark-values">{m.positions.map(v => fmt(v)).join(' · ')}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="shelf-section shelf-optimizer" aria-labelledby="shelf-optimizer-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="shelf-optimizer-title">Sheet layout</h2>
                <p>Add your sheets and generate a plan. Regenerate after changing the design.</p>
              </div>
            </header>
            <CutPlanOptimizer cutList={cutList} units={units} defaultThickness={config!.thickness} />
          </section>
        </>
      )}
    </PageFrame>
  );
}

// ── Controls ──────────────────────────────────────────────────────────────────

function LengthField({
  unit, label, value, onChange, hint, error, disabled,
}: {
  unit: LengthUnit;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <label className="form-field">
      <span className="form-field-label">{label}</span>
      <span className="shelf-inch-input">
        <input
          value={value}
          inputMode="decimal"
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          onChange={e => onChange(e.target.value)}
        />
        <span aria-hidden="true">{unit}</span>
      </span>
      {error ? <small className="shelf-field-error">{error}</small> : hint && <small>{hint}</small>}
    </label>
  );
}

function Stepper({
  value, min, max, onChange, labelledBy, noun,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
  labelledBy: string;
  noun: string;
}) {
  return (
    <div className="shelf-stepper" role="group" aria-labelledby={labelledBy}>
      <IconButton label={`Remove a ${noun}`} onClick={() => onChange(value - 1)} disabled={value <= min}>
        <Minus size={16} aria-hidden="true" />
      </IconButton>
      <output aria-live="polite">{value}</output>
      <IconButton label={`Add a ${noun}`} onClick={() => onChange(value + 1)} disabled={value >= max}>
        <Plus size={16} aria-hidden="true" />
      </IconButton>
    </div>
  );
}

function Toggle({
  label, checked, onChange, hint, disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  hint?: string;
  disabled?: boolean;
}) {
  return (
    <label className="shelf-toggle">
      <input type="checkbox" checked={checked} disabled={disabled} onChange={e => onChange(e.target.checked)} />
      <span>
        <span className="shelf-toggle-label">{label}</span>
        {hint && <small>{hint}</small>}
      </span>
    </label>
  );
}

function Stat({ label, value, accent = false }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={accent ? 'is-accent' : undefined}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// ── Drawings ──────────────────────────────────────────────────────────────────

function FrontElevation({ plan, thickness: t, fmt }: { plan: ShelfPlan; thickness: number; fmt: (inches: number) => string }) {
  const W = plan.overallWidth;
  const H = plan.overallHeight;
  const pad = Math.max(W, H) * 0.09;
  const fs = Math.max(W, H) * 0.026;
  const y = (v: number) => H - v; // floor at the bottom of the drawing
  const hasTop = plan.interiorTop < H;
  const hasBottom = plan.interiorBottom > 0;

  return (
    <figure className="shelf-drawing">
      <svg
        viewBox={`${-pad * 0.4} ${-pad * 0.6} ${W + pad * 1.6} ${H + pad * 1.9}`}
        role="img"
        aria-label={`Front elevation, ${fmt(W)} wide by ${fmt(H)} tall with ${plan.bays.length} bays`}
      >
        {/* Sides and dividers */}
        <rect className="shelf-ply" x={0} y={0} width={t} height={H} />
        <rect className="shelf-ply" x={W - t} y={0} width={t} height={H} />
        {plan.dividerXs.map(x => (
          <rect
            key={x}
            className="shelf-ply"
            x={x}
            y={hasTop ? t : 0}
            width={t}
            height={(hasBottom ? y(plan.interiorBottom) : H) - (hasTop ? t : 0)}
          />
        ))}
        {hasTop && <rect className="shelf-ply" x={t} y={0} width={W - 2 * t} height={t} />}
        {hasBottom && <rect className="shelf-ply" x={t} y={y(plan.interiorBottom)} width={W - 2 * t} height={t} />}
        {plan.kick > 0 && <rect className="shelf-ply is-kick" x={t} y={y(plan.kick)} width={W - 2 * t} height={plan.kick} />}

        {/* Shelves */}
        {plan.bays.map(bay => bay.shelfYs.map(sy => (
          <rect key={`${bay.index}-${sy}`} className="shelf-ply is-shelf" x={bay.x} y={y(sy + t)} width={bay.width} height={t} />
        )))}

        {/* Bay width dimensions */}
        {plan.bays.map(bay => (
          <DimH key={bay.index} x1={bay.x} x2={bay.x + bay.width} y={H + pad * 0.45} fs={fs * 0.8} label={fmt(bay.width)} />
        ))}
        <DimH x1={0} x2={W} y={H + pad * 1.05} fs={fs} label={fmt(W)} />
        <DimV y1={0} y2={H} x={W + pad * 0.55} fs={fs} label={fmt(H)} />
      </svg>
    </figure>
  );
}

function SideSection({ plan, config, fmt }: { plan: ShelfPlan; config: ShelfConfig; fmt: (inches: number) => string }) {
  const t = config.thickness;
  const D = config.shelfDepth;
  const depth = plan.sideDepth;
  const H = Math.min(plan.overallHeight, Math.max(depth * 1.6, 14));
  const pad = depth * 0.22;
  const fs = depth * 0.075;
  const cleatH = Math.min(config.cleatHeight, H / 3);

  return (
    <figure className="shelf-drawing is-section">
      <svg
        viewBox={`${-pad} ${-pad * 1.2} ${depth + pad * 2.4} ${H + pad * 2.6}`}
        role="img"
        aria-label={`Side section: ${fmt(D)} shelf, ${fmt(plan.backThickness)} back, ${fmt(plan.cleatGap)} cleat gap, ${fmt(depth)} side`}
      >
        <rect className="shelf-side-outline" x={0} y={0} width={depth} height={H} />
        <rect className="shelf-ply is-shelf" x={0} y={H * 0.45} width={D} height={t} />
        {plan.backThickness > 0 && <rect className="shelf-ply" x={D} y={0} width={plan.backThickness} height={H} />}
        {plan.cleatGap > 0 && (
          <>
            <polygon
              className="shelf-ply is-cleat"
              points={`${D + t},${t} ${depth},${t} ${depth},${t + cleatH - plan.cleatGap} ${D + t},${t + cleatH}`}
            />
            <rect className="shelf-ply is-cleat" x={D + t} y={H - cleatH * 0.8} width={plan.cleatGap} height={cleatH * 0.8} />
          </>
        )}
        <line className="shelf-wall" x1={depth} y1={-pad * 0.6} x2={depth} y2={H + pad * 0.3} />
        <text className="shelf-dim-text" x={0} y={-pad * 0.55} fontSize={fs}>Front</text>
        <text className="shelf-dim-text" x={depth} y={-pad * 0.75} fontSize={fs} textAnchor="end">{config.mounting === 'wall' ? 'Wall' : 'Back'}</text>
        <DimH x1={0} x2={D} y={H + pad * 0.5} fs={fs} label={fmt(D)} />
        <DimH x1={0} x2={depth} y={H + pad * 1.2} fs={fs} label={`Side ${fmt(depth)}`} />
      </svg>
      <figcaption>
        Side section{plan.cleatGap > 0 ? ': back inset for the French cleat' : ''}
      </figcaption>
    </figure>
  );
}

function DimH({ x1, x2, y, label, fs }: { x1: number; x2: number; y: number; label: string; fs: number }) {
  const tick = fs * 0.5;
  return (
    <g className="shelf-dim">
      <line x1={x1} y1={y} x2={x2} y2={y} />
      <line x1={x1} y1={y - tick} x2={x1} y2={y + tick} />
      <line x1={x2} y1={y - tick} x2={x2} y2={y + tick} />
      <text className="shelf-dim-text" x={(x1 + x2) / 2} y={y - tick * 0.6} fontSize={fs} textAnchor="middle">{label}</text>
    </g>
  );
}

function DimV({ y1, y2, x, label, fs }: { y1: number; y2: number; x: number; label: string; fs: number }) {
  const tick = fs * 0.5;
  const cy = (y1 + y2) / 2;
  return (
    <g className="shelf-dim">
      <line x1={x} y1={y1} x2={x} y2={y2} />
      <line x1={x - tick} y1={y1} x2={x + tick} y2={y1} />
      <line x1={x - tick} y1={y2} x2={x + tick} y2={y2} />
      <text className="shelf-dim-text" x={x + tick * 0.8} y={cy} fontSize={fs} transform={`rotate(90 ${x + tick * 0.8} ${cy})`} textAnchor="middle">{label}</text>
    </g>
  );
}
