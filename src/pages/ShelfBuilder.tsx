import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowLeft, BookOpen, Check, Clipboard, FolderOpen, Library, Loader2, Save, FolderPlus, Printer, RotateCcw,
} from 'lucide-react';
import { Button, PageFrame, PageHeader, SegmentedControl } from '../components/ui';
import { DimH, DimV, LengthField, Stat, Stepper, Toggle } from '../components/builderControls';
import CutPlanOptimizer from '../components/CutPlanOptimizer';
import ShelfAddToProject from '../components/ShelfAddToProject';
import ShelfBuildGuide from '../components/ShelfBuildGuide';
import { CostTable, HardwareTable, money, useShelfEstimate } from '../components/ShelfEstimate';
import ShelfExport from '../components/ShelfExport';
import ShelfLibrary from '../components/ShelfLibrary';
import { TutorialButton } from '../tour/TourLaunchers';
import { useWorkbenchTop } from '../components/useWorkbenchTop';
import type { ShelfTemplate } from '../lib/shelfTemplates';
import { createLibraryShelfDesign, getLibraryShelfDesign, getProject, getShelfDesign, updateLibraryShelfDesign } from '../services/api';
import { isDemoMode } from '../demo/demoMode';
import { formatSag, SHELF_LOADS, sagCheck, type SagResult } from '../lib/shelfEstimate';
import {
  buildShelfPlan,
  decimalString,
  formatLength,
  lengthToField,
  parseLength,
  heightAllowance,
  openingHeightFromOverall,
  PAIR_DOOR_WIDTH,
  overallFromOpeningHeight,
  readSavedShelfDesign,
  toSavedShelfDesign,
  shelfDesignToFields,
  type ShelfDesignFields,
  shelfSolids,
  type LengthUnit,
  type ShelfConfig,
  type ShelfPlan,
} from '../lib/shelving';
import type { CutListItem } from '../types/project';

const ShelfViewer3D = lazy(() => import('../components/ShelfViewer3D'));

const STORAGE_KEY = 'workshop-shelf-builder';
const VIEW_STORAGE_KEY = 'workshop-shelf-builder-view';
/** Which saved design is open (and its saved state), so returning to the page keeps the link. */
const SOURCE_STORAGE_KEY = 'workshop-shelf-builder-source';
/** The design that was in the builder before a project's design was opened over it. */
const PREVIOUS_STORAGE_KEY = 'workshop-shelf-builder-previous';
const MAX_BAYS = 12;
const MAX_SHELVES = 20;

type FormState = ShelfDesignFields;

const DEFAULT_FORM: FormState = {
  units: 'in',
  thickness: '3/4',
  bayWidth: '17 1/2',
  shelfDepth: '11 1/4',
  heightMode: 'opening',
  openingHeight: '8',
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
  bayWidthMode: 'same',
  bayWidths: ['17 1/2', '17 1/2', '17 1/2', '17 1/2'],
  adjustablePerBay: [0, 0, 0, 0],
  pinSystem: 'imperial',
  backJoint: 'inset',
  faceFrame: false,
  stileWidth: '1 1/2',
  railWidth: '1 1/2',
  frameThickness: '3/4',
  doorsPerBay: [false, false, false, false],
  shelfLoad: 'books',
  edgeBanding: false,
  bandingThickness: '0.5 mm',
};

// Each carries its unit, so it means the same in inch or millimeter mode.
const BANDING_PRESETS = [
  { value: '0.5 mm', label: '0.5 mm veneer' },
  { value: '1 mm', label: '1 mm PVC' },
  { value: '2 mm', label: '2 mm PVC' },
];

const BAY_WIDTH_OPTIONS = [
  { value: 'same', label: 'All the same' },
  { value: 'custom', label: 'Each bay' },
] as const;

const BACK_JOINT_OPTIONS = [
  { value: 'inset', label: 'Inset' },
  { value: 'rabbet', label: 'Rabbeted' },
] as const;

const PIN_OPTIONS = [
  { value: 'imperial', label: '1″ spacing' },
  { value: 'metric', label: '32 mm system' },
] as const;

/** Keep every per-bay list the same length as the bay count. */
function normalizeBays(form: FormState): FormState {
  const n = form.bays;
  const fit = <T,>(list: T[] | undefined, fill: T) => Array.from({ length: n }, (_, i) => list?.[i] ?? fill);
  return {
    ...form,
    shelvesPerBay: fit(form.shelvesPerBay, form.shelvesPerBay?.[form.shelvesPerBay.length - 1] ?? 4),
    bayWidths: fit(form.bayWidths, form.bayWidth),
    adjustablePerBay: fit(form.adjustablePerBay, 0),
    doorsPerBay: fit(form.doorsPerBay, false),
  };
}

// Each preset carries its own unit so it means the same thing in either mode.
const THICKNESS_PRESETS: Record<LengthUnit, string[]> = {
  in: ['3/4"', '23/32"', '1/2"', '15/32"', '18 mm'],
  mm: ['18 mm', '15 mm', '12 mm', '9 mm', '3/4"'],
};

const UNIT_OPTIONS = [
  { value: 'in', label: 'Inches' },
  { value: 'mm', label: 'Millimeters' },
] as const;

const LENGTH_FIELDS = ['thickness', 'bayWidth', 'shelfDepth', 'openingHeight', 'height', 'dadoDepth', 'toeKick', 'cleatHeight', 'stileWidth', 'railWidth', 'frameThickness'] as const;

const HEIGHT_MODE_OPTIONS = [
  { value: 'opening', label: 'Opening height' },
  { value: 'overall', label: 'Overall height' },
] as const;

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
  next.bayWidths = form.bayWidths.map(raw => {
    const inches = parseLength(raw, form.units);
    return inches === null ? raw : lengthToField(inches, units);
  });
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
    const parsed = JSON.parse(raw) as Omit<Partial<FormState>, 'heightMode'> & { heightMode?: string; bayHeight?: string };
    const merged: FormState = { ...DEFAULT_FORM, ...parsed } as FormState;
    if (merged.units !== 'mm') merged.units = 'in';
    if (parsed.heightMode === 'bay') {
      // A short-lived mode where the height field meant the bay's total clear height.
      // Turn it into the overall height it produced so the design keeps its size.
      const unit = merged.units;
      const bay = parseLength(parsed.bayHeight ?? '', unit);
      const thickness = parseLength(merged.thickness, unit) ?? 0;
      const kick = parseLength(merged.toeKick, unit) ?? 0;
      if (bay !== null) {
        merged.height = lengthToField(bay + heightAllowance({
          thickness, topPanel: merged.topPanel, bottomPanel: merged.bottomPanel, mounting: merged.mounting, toeKick: kick,
        }), unit);
      }
      merged.heightMode = 'overall';
    } else if (parsed.heightMode !== 'opening' && parsed.heightMode !== 'overall') {
      // Designs from before opening height existed typed the overall height; keep that meaning.
      merged.heightMode = 'overall';
    }
    delete (merged as { bayHeight?: string }).bayHeight;
    if (!Array.isArray(merged.shelvesPerBay)) merged.shelvesPerBay = DEFAULT_FORM.shelvesPerBay;
    return normalizeBays(merged);
  } catch {
    return DEFAULT_FORM;
  }
}

type FieldKey = typeof LENGTH_FIELDS[number] | `bayWidths.${number}`;

function toConfig(form: FormState): { config: ShelfConfig | null; fieldErrors: Partial<Record<FieldKey, string>> } {
  const fieldErrors: Partial<Record<FieldKey, string>> = {};
  const num = (key: FieldKey, { allowZero = false } = {}) => {
    const raw = (key.startsWith('bayWidths.') ? form.bayWidths[Number(key.split('.')[1])] ?? '' : form[key as typeof LENGTH_FIELDS[number]]).trim();
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
  const dadoDepth = form.joinery === 'dado' ? num('dadoDepth') : 0;
  const toeKick = form.mounting === 'floor' && form.bottomPanel ? num('toeKick', { allowZero: true }) : 0;
  // In opening mode the overall height is built up from the openings, shelves, panels and toe kick.
  const height = form.heightMode === 'opening'
    ? overallFromOpeningHeight(num('openingHeight'), form.shelvesPerBay, {
      thickness, topPanel: form.topPanel, bottomPanel: form.bottomPanel, mounting: form.mounting, toeKick,
    })
    : num('height');
  const cleatHeight = form.mounting === 'wall' && form.frenchCleat ? num('cleatHeight') : 3;
  const bayWidths = form.bayWidthMode === 'custom'
    ? form.bayWidths.slice(0, form.bays).map((_, i) => num(`bayWidths.${i}`))
    : undefined;
  const faceFrame = form.faceFrame
    ? { enabled: true, stileWidth: num('stileWidth'), railWidth: num('railWidth'), thickness: num('frameThickness') }
    : undefined;
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
      bayWidths,
      adjustablePerBay: form.adjustablePerBay.slice(0, form.bays),
      pinSystem: form.pinSystem,
      backJoint: form.backJoint,
      faceFrame,
      doorsPerBay: form.doorsPerBay.slice(0, form.bays),
      shelfLoad: form.shelfLoad,
      edgeBanding: form.edgeBanding,
      bandingThickness: parseLength(form.bandingThickness, form.units) ?? 0.02,
    },
    fieldErrors,
  };
}

/** Plywood parts only — the face frame is solid wood, bought as boards, not cut from sheets. */
function toCutList(plan: ShelfPlan): CutListItem[] {
  return plan.parts.filter(part => part.material !== 'solid').map((part, index) => ({
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

type DesignSource = { kind: 'project' | 'library'; id: number; title: string } | { kind: 'template'; title: string };

function readStoredSource(): { source: DesignSource | null; snapshot: string | null } {
  try {
    const raw = localStorage.getItem(SOURCE_STORAGE_KEY);
    if (!raw) return { source: null, snapshot: null };
    const parsed = JSON.parse(raw) as { source?: DesignSource; snapshot?: string };
    // Only a library design is worth remembering: it's the one with "unsaved changes" to track.
    return parsed.source?.kind === 'library' && typeof parsed.snapshot === 'string'
      ? { source: parsed.source, snapshot: parsed.snapshot }
      : { source: null, snapshot: null };
  } catch {
    return { source: null, snapshot: null };
  }
}

export default function ShelfBuilder() {
  const navigate = useNavigate();
  // Desktop workbench: the settings and preview fill the window below the page header.
  const layoutRef = useRef<HTMLDivElement>(null);
  useWorkbenchTop(layoutRef);
  const [form, setForm] = useState<FormState>(readStoredForm);
  const [copyStatus, setCopyStatus] = useState('');
  const [view, setView] = useState<PreviewMode>(readStoredView);
  const [addingToProject, setAddingToProject] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();
  /** Where the design on screen came from: a project, a saved library design, or a template. */
  const [storedSource] = useState(readStoredSource);
  const [source, setSource] = useState<DesignSource | null>(storedSource.source);
  /** The open library design as last saved (or opened), to tell when there are unsaved changes. */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(storedSource.snapshot);
  const pendingSnapshot = useRef(false);
  const [naming, setNaming] = useState<'new' | null>(null);
  const [designName, setDesignName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [loadNotice, setLoadNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [hasPrevious, setHasPrevious] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;

  // ?design=<id> opens a saved library design to edit (from the Projects page).
  const designParam = searchParams.get('design');
  useEffect(() => {
    if (designParam == null) return;
    const id = Number(designParam);
    let cancelled = false;
    const finish = () => setSearchParams(prev => { prev.delete('design'); return prev; }, { replace: true });
    if (!Number.isInteger(id) || id <= 0) {
      setLoadNotice({ tone: 'error', text: `“${designParam}” isn’t a design number, so nothing was opened.` });
      finish();
      return;
    }
    setLoadNotice({ tone: 'info', text: 'Opening the saved design…' });
    getLibraryShelfDesign(id)
      .then(entry => {
        if (cancelled) return;
        const saved = readSavedShelfDesign(entry.design);
        if (!saved) {
          setLoadNotice({ tone: 'error', text: `“${entry.name}” couldn’t be read, so your current design was kept.` });
          return;
        }
        applyDesign(shelfDesignToFields(saved), { kind: 'library', id: entry.id, title: entry.name });
      })
      .catch(err => {
        if (cancelled) return;
        const reason = err instanceof Error && err.message ? err.message : 'the request failed';
        setLoadNotice({ tone: 'error', text: `That design couldn’t be opened (${reason}), so your current design was kept.` });
      })
      .finally(() => !cancelled && finish());
    return () => { cancelled = true; };
  }, [designParam, setSearchParams]);

  // ?project=<id> opens that project's saved design (from its 3D preview).
  const projectParam = searchParams.get('project');
  useEffect(() => {
    if (projectParam == null) return;
    const id = Number(projectParam);
    let cancelled = false;
    const finish = () => setSearchParams(prev => { prev.delete('project'); return prev; }, { replace: true });
    if (!Number.isInteger(id) || id <= 0) {
      setLoadNotice({ tone: 'error', text: `“${projectParam}” isn’t a project number, so nothing was opened.` });
      finish();
      return;
    }
    setLoadNotice({ tone: 'info', text: 'Opening the project’s design…' });
    Promise.all([getProject(id), getShelfDesign(id)])
      .then(([project, { design }]) => {
        if (cancelled) return;
        const saved = design == null ? null : readSavedShelfDesign(design);
        if (!saved) {
          setLoadNotice({
            tone: 'error',
            text: design == null
              ? `“${project.title}” has no Shelf Builder design saved, so your current design was kept.`
              : `The design saved on “${project.title}” couldn’t be read, so your current design was kept.`,
          });
          return;
        }
        applyDesign(shelfDesignToFields(saved), { kind: 'project', id, title: project.title });
      })
      .catch(err => {
        if (cancelled) return;
        console.error('Opening project design failed', err);
        const reason = err instanceof Error && err.message ? err.message : 'the request failed';
        setLoadNotice({ tone: 'error', text: `Project ${id}’s design couldn’t be opened (${reason}), so your current design was kept.` });
      })
      .finally(() => !cancelled && finish());
    return () => { cancelled = true; };
  }, [projectParam, setSearchParams]);

  // Opening anything sets the current design aside first, so it can be restored.
  function applyDesign(fields: FormState, origin: NonNullable<typeof source>) {
    try {
      localStorage.setItem(PREVIOUS_STORAGE_KEY, JSON.stringify(formRef.current));
      setHasPrevious(true);
    } catch {
      setHasPrevious(false);
    }
    setForm(normalizeBays(fields));
    setSource(origin);
    // A library design's reference copy is taken from the form once it renders (see below).
    pendingSnapshot.current = origin.kind === 'library';
    setSavedSnapshot(null);
    setNaming(null);
    setSaveMessage(null);
    setLoadNotice(null);
    setShowLibrary(false);
    setAddingToProject(false);
  }

  // Template fields are inches; fill in the defaults for anything they leave out.
  const templateConfig = useCallback(
    (template: ShelfTemplate) => toConfig(normalizeBays({ ...DEFAULT_FORM, ...template.fields, units: 'in' })).config,
    [],
  );

  const restorePrevious = () => {
    try {
      const raw = localStorage.getItem(PREVIOUS_STORAGE_KEY);
      if (raw) setForm({ ...DEFAULT_FORM, ...(JSON.parse(raw) as Partial<FormState>) });
      localStorage.removeItem(PREVIOUS_STORAGE_KEY);
    } catch {
      setLoadNotice({ tone: 'error', text: 'Your previous design couldn’t be restored from this browser.' });
    }
    setHasPrevious(false);
    setSource(null);
    setAddingToProject(false);
  };
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
  const shelfEstimate = useShelfEstimate(plan && valid ? plan : null, valid ? config : null, units);
  const sagResults = useMemo(() => (plan && config && valid ? sagCheck(plan, config, form.shelfLoad) : []), [plan, config, valid, form.shelfLoad]);

  // ── Saved design state ─────────────────────────────────────────────────────
  const demo = isDemoMode();
  const currentSnapshot = useMemo(
    () => (config && valid ? JSON.stringify(toSavedShelfDesign(config, units, form.heightMode)) : null),
    [config, valid, units, form.heightMode],
  );
  useEffect(() => {
    if (pendingSnapshot.current && currentSnapshot) {
      pendingSnapshot.current = false;
      setSavedSnapshot(currentSnapshot);
    }
  }, [currentSnapshot]);
  useEffect(() => {
    try {
      if (source?.kind === 'library' && savedSnapshot) localStorage.setItem(SOURCE_STORAGE_KEY, JSON.stringify({ source, snapshot: savedSnapshot }));
      else localStorage.removeItem(SOURCE_STORAGE_KEY);
    } catch { /* convenience only */ }
  }, [source, savedSnapshot]);
  const openDesign = source?.kind === 'library' ? source : null;
  const dirty = Boolean(openDesign && currentSnapshot && savedSnapshot && currentSnapshot !== savedSnapshot);

  // Leaving with unsaved changes to a saved design asks first (the form itself is kept in this browser).
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const saveErrorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'the request failed');

  const saveDesignChanges = async () => {
    if (!openDesign || !config || saving) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const snapshot = currentSnapshot;
      const entry = await updateLibraryShelfDesign(openDesign.id, { design: toSavedShelfDesign(config, units, form.heightMode) });
      setSavedSnapshot(snapshot);
      setSource({ kind: 'library', id: entry.id, title: entry.name });
      setSaveMessage({ ok: true, text: `Saved “${entry.name}”.` });
    } catch (err) {
      setSaveMessage({ ok: false, text: `Your changes weren’t saved: ${saveErrorText(err)}. They’re still here — try again.` });
    } finally {
      setSaving(false);
    }
  };

  const saveDesignAsNew = async () => {
    if (!config || saving) return;
    const name = designName.trim();
    if (!name) { setSaveMessage({ ok: false, text: 'Give the design a name first.' }); return; }
    setSaving(true);
    setSaveMessage(null);
    try {
      const snapshot = currentSnapshot;
      const entry = await createLibraryShelfDesign(name, toSavedShelfDesign(config, units, form.heightMode));
      setSource({ kind: 'library', id: entry.id, title: entry.name });
      setSavedSnapshot(snapshot);
      setNaming(null);
      setDesignName('');
      setSaveMessage({ ok: true, text: `Saved as “${entry.name}”. Find it on the Projects page or in the Library.` });
    } catch (err) {
      setSaveMessage({ ok: false, text: `The design wasn’t saved: ${saveErrorText(err)}` });
    } finally {
      setSaving(false);
    }
  };
  const sagWarnings = sagResults.filter(r => !r.ok).map(r =>
    `Bay ${r.bay + 1}: ${r.kind === 'adjustable' ? 'adjustable shelves' : 'shelves'} span ${fmt(r.span)} and will sag about ${formatSag(r.sag, units)} under ${SHELF_LOADS[form.shelfLoad].label.split(' —')[0].toLowerCase()} — more than the ${formatSag(r.limit, units)} that looks flat. `
    + (r.thicknessNeeded ? `Use ${fmt(r.thicknessNeeded)} plywood, ` : '')
    + 'narrow the bay, or glue a 1 1/2″ solid-wood strip under the front edge.');

  const update = (patch: Partial<FormState>) => {
    setCopyStatus('');
    setForm(prev => ({ ...prev, ...patch }));
  };

  // Switching fills the newly active height from the current design, so nothing changes size.
  const setHeightMode = (heightMode: FormState['heightMode']) => {
    if (heightMode === form.heightMode) return;
    const patch: Partial<FormState> = { heightMode };
    if (config) {
      if (heightMode === 'opening') patch.openingHeight = lengthToField(openingHeightFromOverall(config.height, config.shelvesPerBay, config), units);
      else patch.height = lengthToField(config.height, units);
    }
    update(patch);
  };

  const setBays = (bays: number) => {
    const next = Math.min(MAX_BAYS, Math.max(1, bays));
    setForm(prev => normalizeBays({ ...prev, bays: next }));
  };

  const setAtBay = <K extends 'bayWidths' | 'adjustablePerBay' | 'doorsPerBay'>(key: K, bay: number, value: FormState[K][number]) => {
    setCopyStatus('');
    setForm(prev => ({ ...prev, [key]: (prev[key] as FormState[K][number][]).map((v, i) => (i === bay ? value : v)) }));
  };

  // Switching to per-bay widths starts every bay at the shared width.
  const setBayWidthMode = (bayWidthMode: FormState['bayWidthMode']) => {
    setForm(prev => ({
      ...prev,
      bayWidthMode,
      bayWidths: bayWidthMode === 'custom' && prev.bayWidthMode === 'same' ? prev.bayWidths.map(() => prev.bayWidth) : prev.bayWidths,
    }));
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
    <PageFrame maxWidth={1200} className="shelf-page builder-workbench">
      <Button variant="ghost" onClick={() => navigate(-1)} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </Button>

      <PageHeader
        title="Shelf Builder"
        description="Design a plywood shelving unit by bay, then take the exact cut list, shelf positions, and sheet layout to the saw."
        actions={(
          <>
            <TutorialButton tour="shelves" />
            <Button variant={showLibrary ? 'secondary' : 'ghost'} onClick={() => setShowLibrary(open => !open)} aria-expanded={showLibrary} aria-controls="shelf-library">
              <Library size={16} aria-hidden="true" /> Library
            </Button>
            <Button variant="ghost" onClick={() => setForm(convertForm(DEFAULT_FORM, units))}>
              <RotateCcw size={16} aria-hidden="true" /> Reset design
            </Button>
          </>
        )}
      />

      {showLibrary && (
        <div id="shelf-library">
          <ShelfLibrary
            config={valid ? config : null}
            units={units}
            heightMode={form.heightMode}
            openId={source?.kind === 'library' ? source.id : null}
            templateConfig={templateConfig}
            onUseTemplate={template => applyDesign(
              convertForm(normalizeBays({ ...DEFAULT_FORM, ...template.fields, units: 'in' }), units),
              { kind: 'template', title: template.name },
            )}
            onOpen={({ id, name, saved }) => applyDesign(shelfDesignToFields(saved), { kind: 'library', id, title: name })}
            onSaved={({ id, name }) => { setSource({ kind: 'library', id, title: name }); setSavedSnapshot(currentSnapshot); }}
            onClose={() => setShowLibrary(false)}
          />
        </div>
      )}

      <div className="shelf-layout" ref={layoutRef}>
        <section className="shelf-config" aria-labelledby="shelf-config-title">
          <div className="builder-config-top">
      {loadNotice && (
        <p className={`shelf-source-banner ${loadNotice.tone === 'error' ? 'is-error' : ''}`} role={loadNotice.tone === 'error' ? 'alert' : 'status'}>
          {loadNotice.tone === 'error' && <AlertCircle size={16} aria-hidden="true" />}
          <span>{loadNotice.text}</span>
        </p>
      )}
      <div className="shelf-design-bar" role="region" aria-label="Saved design">
        <div className="shelf-design-bar-name">
          <Save size={16} aria-hidden="true" />
          <strong>{openDesign ? openDesign.title : 'Untitled design'}</strong>
          <span className={`shelf-design-status ${openDesign ? (dirty ? 'is-dirty' : 'is-saved') : ''}`}>
            {openDesign ? (dirty ? 'Unsaved changes' : 'Saved') : 'Not saved yet'}
          </span>
        </div>
        {demo ? (
          <span className="is-muted">Demo mode is read-only — sign in to save designs.</span>
        ) : naming === 'new' ? (
          <form className="shelf-design-bar-form" onSubmit={e => { e.preventDefault(); void saveDesignAsNew(); }}>
            <input
              value={designName}
              onChange={e => setDesignName(e.target.value)}
              placeholder="Name this design"
              aria-label="Design name"
              maxLength={120}
              autoFocus
            />
            <Button type="submit" variant="primary" disabled={saving || !config}>
              {saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Save
            </Button>
            <Button variant="ghost" onClick={() => { setNaming(null); setSaveMessage(null); }}>Cancel</Button>
          </form>
        ) : (
          <span className="shelf-design-bar-actions">
            {openDesign ? (
              <Button variant="primary" onClick={() => void saveDesignChanges()} disabled={saving || !dirty || !config}>
                {saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Save
              </Button>
            ) : null}
            <Button
              variant={openDesign ? 'ghost' : 'primary'}
              onClick={() => { setNaming('new'); setDesignName(openDesign ? `${openDesign.title} copy` : ''); setSaveMessage(null); }}
              disabled={!config}
            >
              <Save size={16} aria-hidden="true" /> {openDesign ? 'Save as new…' : 'Save design…'}
            </Button>
            {openDesign && hasPrevious && (
              <Button variant="ghost" onClick={restorePrevious}><RotateCcw size={16} aria-hidden="true" /> Restore previous design</Button>
            )}
          </span>
        )}
        {saveMessage && (
          <p className={saveMessage.ok ? 'shelf-add-project-ok' : 'shelf-add-project-error'} role="status">
            {saveMessage.ok ? <Check size={16} aria-hidden="true" /> : <AlertCircle size={16} aria-hidden="true" />}
            <span>{saveMessage.text}</span>
          </p>
        )}
      </div>

      {source && source.kind !== 'library' && (
        <div className="shelf-source-banner" role="status">
          <FolderOpen size={16} aria-hidden="true" />
          <span>
            {source.kind === 'project' && (
              <>Editing the design from <Link to={`/projects/${source.id}`}>“{source.title}”</Link>. Changes stay here until
              you save them back with <strong>Add to project → Replace them</strong>.</>
            )}
            {source.kind === 'template' && <>Started from the “{source.title}” template. Change anything, then save it to your library.</>}
          </span>
          <span className="shelf-source-actions">
            {source.kind === 'project' ? (
              <Button variant="ghost" onClick={() => setAddingToProject(true)}>
                <FolderPlus size={16} aria-hidden="true" /> Save back to project
              </Button>
            ) : (
              <Button variant="ghost" onClick={() => { setNaming('new'); setDesignName(''); }}>
                <Save size={16} aria-hidden="true" /> Save design…
              </Button>
            )}
            {hasPrevious && (
              <Button variant="ghost" onClick={restorePrevious}>
                <RotateCcw size={16} aria-hidden="true" /> Restore previous design
              </Button>
            )}
          </span>
        </div>
      )}

          </div>
          <h2 id="shelf-config-title" className="sr-only">Design</h2>

          <fieldset className="shelf-group" data-tour="fs-units">
            <legend>Units</legend>
            <SegmentedControl label="Units" value={units} options={UNIT_OPTIONS} onChange={next => setForm(prev => convertForm(prev, next))} />
            <p className="shelf-group-note">
              Switching converts every size. Any box also takes the other unit: type <kbd>18mm</kbd> or <kbd>3/4"</kbd>.
            </p>
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-material">
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

          <fieldset className="shelf-group" data-tour="fs-bays">
            <legend>Bays</legend>
            <div className="shelf-height-mode">
              <SegmentedControl label="Set the height by" value={form.heightMode} options={HEIGHT_MODE_OPTIONS} onChange={setHeightMode} />
              <small>
                {form.heightMode === 'opening'
                  ? 'The clear height of each shelf opening. The overall height adds up the openings, the shelves between them, the top, bottom and toe kick — it grows as you add openings.'
                  : 'The total height of the unit. The openings share whatever space is inside.'}
              </small>
            </div>
            <div className="shelf-height-mode">
              <span className="form-field-label" id="bay-width-mode-label">Bay widths</span>
              <SegmentedControl label="Bay widths" value={form.bayWidthMode} options={BAY_WIDTH_OPTIONS} onChange={setBayWidthMode} />
            </div>
            <div className="shelf-field-grid">
              {form.bayWidthMode === 'same' && (
                <LengthField unit={units} label="Bay width (clear)" value={form.bayWidth} error={fieldErrors.bayWidth} onChange={bayWidth => update({ bayWidth })} />
              )}
              <LengthField unit={units} label="Shelf depth" value={form.shelfDepth} error={fieldErrors.shelfDepth} onChange={shelfDepth => update({ shelfDepth })} />
              {form.heightMode === 'opening' ? (
                <LengthField
                  unit={units}
                  label="Opening height (clear)"
                  value={form.openingHeight}
                  error={fieldErrors.openingHeight}
                  hint={config ? `Overall ${fmt(config.height)}` : undefined}
                  onChange={openingHeight => update({ openingHeight })}
                />
              ) : (
                <LengthField
                  unit={units}
                  label="Overall height"
                  value={form.height}
                  error={fieldErrors.height}
                  hint={config ? `Openings ${fmt(openingHeightFromOverall(config.height, config.shelvesPerBay, config))} clear` : undefined}
                  onChange={height => update({ height })}
                />
              )}
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

            <div className="shelf-bay-cards">
              {form.shelvesPerBay.map((count, i) => {
                const bay = plan?.bays[i];
                const sag = sagResults.filter(r => r.bay === i);
                const worst = sag.reduce<SagResult | null>((w, r) => (!w || r.sag / r.limit > w.sag / w.limit ? r : w), null);
                const pair = bay ? bay.width > PAIR_DOOR_WIDTH : false;
                return (
                  <div className="shelf-bay-card" key={i}>
                    <div className="shelf-bay-card-head">
                      <strong id={`bay-${i}-label`}>Bay {i + 1}</strong>
                      {bay && bay.openingHeight > 0 && (
                        <small>{fmt(bay.openingHeight)} {bay.adjustableYs.length ? 'between fixed shelves' : 'openings'}</small>
                      )}
                    </div>
                    <div className="shelf-bay-card-controls">
                      {form.bayWidthMode === 'custom' && (
                        <LengthField
                          unit={units}
                          label="Width (clear)"
                          value={form.bayWidths[i] ?? ''}
                          error={fieldErrors[`bayWidths.${i}`]}
                          onChange={value => setAtBay('bayWidths', i, value)}
                        />
                      )}
                      <div className="form-field">
                        <span className="form-field-label" id={`bay-${i}-openings`}>Openings</span>
                        {/* Openings = fixed shelves + 1: the bottom and each shelf are a level to put things on. */}
                        <Stepper
                          labelledBy={`bay-${i}-openings`}
                          value={count + 1}
                          min={1}
                          max={MAX_SHELVES + 1}
                          onChange={value => setShelves(i, value - 1)}
                          noun="opening"
                        />
                      </div>
                      <div className="form-field">
                        <span className="form-field-label" id={`bay-${i}-adjustable`}>Adjustable shelves</span>
                        <Stepper
                          labelledBy={`bay-${i}-adjustable`}
                          value={form.adjustablePerBay[i] ?? 0}
                          min={0}
                          max={MAX_SHELVES}
                          onChange={value => setAtBay('adjustablePerBay', i, Math.max(0, Math.min(MAX_SHELVES, value)))}
                          noun="adjustable shelf"
                        />
                      </div>
                      <label className="shelf-toggle shelf-bay-door">
                        <input type="checkbox" checked={form.doorsPerBay[i] ?? false} onChange={e => setAtBay('doorsPerBay', i, e.target.checked)} />
                        <span><span className="shelf-toggle-label">{pair ? 'Pair of doors' : 'Door'}</span></span>
                      </label>
                    </div>
                    {worst && (
                      <p className={`shelf-sag ${worst.ok ? 'is-ok' : 'is-bad'}`}>
                        {worst.ok
                          ? `Sag ${formatSag(worst.sag, units)} under ${SHELF_LOADS[form.shelfLoad].label.split(' —')[0].toLowerCase()} — fine`
                          : `${worst.kind === 'adjustable' ? 'Adjustable shelves' : 'Shelves'} sag ${formatSag(worst.sag, units)} — over the ${formatSag(worst.limit, units)} limit`}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>

            {form.adjustablePerBay.slice(0, form.bays).some(a => a > 0) && (
              <div className="shelf-height-mode">
                <span className="form-field-label">Shelf-pin holes</span>
                <SegmentedControl label="Shelf-pin spacing" value={form.pinSystem} options={PIN_OPTIONS} onChange={pinSystem => update({ pinSystem })} />
                <small>Columns {fmt(plan?.pinHoles[0]?.frontInset ?? 1.5)} in from the front and back edges, starting 2″ clear of each fixed shelf.</small>
              </div>
            )}

            <label className="form-field">
              <span className="form-field-label">Shelf load (for the sag check)</span>
              <select value={form.shelfLoad} onChange={e => update({ shelfLoad: e.target.value as FormState['shelfLoad'] })}>
                {(Object.keys(SHELF_LOADS) as (keyof typeof SHELF_LOADS)[]).map(key => (
                  <option key={key} value={key}>{SHELF_LOADS[key].label}</option>
                ))}
              </select>
            </label>
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-case">
            <legend>Case</legend>
            <Toggle label="Top panel" checked={form.topPanel} onChange={topPanel => update({ topPanel })} />
            <Toggle label="Bottom panel" checked={form.bottomPanel} onChange={bottomPanel => update({ bottomPanel })} />
            <Toggle
              label="Back panel"
              checked={form.backPanel || cleat}
              disabled={cleat}
              hint={cleat ? 'Required for the French cleat.' : 'Behind the shelves; the sides grow by its thickness.'}
              onChange={backPanel => update({ backPanel })}
            />
            {(form.backPanel || cleat) && (
              <div className="shelf-height-mode">
                <span className="form-field-label">Back fits</span>
                <SegmentedControl label="How the back fits" value={form.backJoint} options={BACK_JOINT_OPTIONS} onChange={backJoint => update({ backJoint })} />
                <small>
                  {form.backJoint === 'rabbet'
                    ? `In a ${cleat ? 'groove' : 'rabbet'} cut into each side${config ? `, ${fmt(config.thickness / 2)} deep` : ''} — stronger and hides the back's edges.`
                    : 'Between the sides, fastened to the back edges of the shelves.'}
                </small>
              </div>
            )}
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-face-frame-doors-edges">
            <legend>Face frame, doors &amp; edges</legend>
            <Toggle
              label="Face frame"
              checked={form.faceFrame}
              hint="Solid-wood stiles and rails on the front. Hides the plywood edges and stiffens the case."
              onChange={faceFrame => update({ faceFrame })}
            />
            {form.faceFrame && (
              <div className="shelf-field-grid">
                <LengthField unit={units} label="Stile width" value={form.stileWidth} error={fieldErrors.stileWidth} onChange={stileWidth => update({ stileWidth })} />
                <LengthField unit={units} label="Rail width" value={form.railWidth} error={fieldErrors.railWidth} onChange={railWidth => update({ railWidth })} />
                <LengthField unit={units} label="Frame thickness" value={form.frameThickness} error={fieldErrors.frameThickness} onChange={frameThickness => update({ frameThickness })} />
              </div>
            )}
            <Toggle
              label="Edge banding"
              checked={form.edgeBanding}
              hint={form.faceFrame
                ? 'The face frame already covers the case fronts, so only door edges are banded.'
                : 'Bands the front edges of the sides, top, bottom, dividers and shelves, and every door edge. Parts are cut smaller by the banding so they finish at size.'}
              onChange={edgeBanding => update({ edgeBanding })}
            />
            {form.edgeBanding && (
              <div className="shelf-chips" role="group" aria-label="Edge banding thickness">
                {BANDING_PRESETS.map(p => (
                  <button
                    key={p.value}
                    type="button"
                    className="shelf-chip"
                    aria-pressed={form.bandingThickness === p.value}
                    onClick={() => update({ bandingThickness: p.value })}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <div className="shelf-height-mode">
              <span className="form-field-label">Doors</span>
              <small>
                Turn doors on for each bay above. {form.faceFrame ? `They overlay the frame by ${fmt(1 / 2)}` : 'They cover the case (full overlay)'};
                bays wider than {fmt(PAIR_DOOR_WIDTH)} get a pair.
              </small>
              <span className="shelf-source-actions">
                <Button variant="ghost" onClick={() => update({ doorsPerBay: form.doorsPerBay.map(() => true) })}>All bays</Button>
                <Button variant="ghost" onClick={() => update({ doorsPerBay: form.doorsPerBay.map(() => false) })}>No doors</Button>
              </span>
            </div>
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-joinery">
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

          <fieldset className="shelf-group" data-tour="fs-mounting">
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
                <div className="builder-drawings">
                  <FrontElevation plan={plan} thickness={config!.thickness} fmt={fmt} />
                  <SideSection plan={plan} config={config!} fmt={fmt} />
                </div>
              )}
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
      {plan && plan.warnings.length + sagWarnings.length > 0 && (
        <ul className="shelf-warnings" role="status">
          {[...plan.warnings, ...sagWarnings].map(w => (
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
                <ShelfAddToProject
                  plan={plan}
                  config={config!}
                  units={units}
                  initialProjectId={source?.kind === 'project' ? source.id : undefined}
                  heightMode={form.heightMode}
                  costLines={shelfEstimate?.estimate.lines}
                  onClose={() => setAddingToProject(false)}
                />
              </div>
            )}
          </section>

          <section className="shelf-section" aria-labelledby="shelf-export-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="shelf-export-title">CNC &amp; Shaper export</h2>
                <p>Cut files for every part, with the dados, rabbets, pin holes and hinge cups as pockets.</p>
              </div>
            </header>
            <ShelfExport plan={plan} config={config!} units={units} />
          </section>

          {shelfEstimate && (
            <>
              <section className="shelf-section" aria-labelledby="shelf-hardware-title">
                <header className="shelf-section-head">
                  <div>
                    <h2 id="shelf-hardware-title">Hardware</h2>
                    <p>Everything besides plywood, counted from this design.</p>
                  </div>
                </header>
                <HardwareTable items={shelfEstimate.hardware} />
              </section>

              <section className="shelf-section" aria-labelledby="shelf-cost-title">
                <header className="shelf-section-head">
                  <div>
                    <h2 id="shelf-cost-title">Cost estimate</h2>
                    <p>About {money(shelfEstimate.estimate.total)} with the optional items; {money(shelfEstimate.estimate.required)} without.</p>
                  </div>
                </header>
                <CostTable
                  estimate={shelfEstimate.estimate}
                  prices={shelfEstimate.prices}
                  overridden={shelfEstimate.overridden}
                  onPrice={shelfEstimate.setPrice}
                  onReset={shelfEstimate.resetPrices}
                />
              </section>
            </>
          )}

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

          <section className="shelf-section" aria-labelledby="shelf-guide-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="shelf-guide-title">Build guide</h2>
                <p>Step-by-step instructions with an illustration of every stage, using this design’s measurements.</p>
              </div>
              <div className="shelf-section-actions">
                <Button
                  variant={showGuide ? 'secondary' : 'primary'}
                  onClick={() => setShowGuide(open => !open)}
                  aria-expanded={showGuide}
                  aria-controls="shelf-guide"
                >
                  <BookOpen size={16} aria-hidden="true" /> {showGuide ? 'Hide guide' : 'Show build guide'}
                </Button>
              </div>
            </header>
            {showGuide && (
              <div id="shelf-guide">
                <ShelfBuildGuide plan={plan} config={config!} units={units} title={source?.title} />
              </div>
            )}
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
