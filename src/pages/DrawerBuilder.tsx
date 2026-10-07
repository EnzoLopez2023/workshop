import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowLeft, BookOpen, Check, Clipboard, FolderOpen, FolderPlus, Loader2, Printer, RotateCcw, Save,
} from 'lucide-react';
import { Button, PageFrame, PageHeader, SegmentedControl } from '../components/ui';
import { DimH, DimV, LengthField, Stat, Stepper, Toggle } from '../components/builderControls';
import CutPlanOptimizer from '../components/CutPlanOptimizer';
import DrawerExport from '../components/DrawerExport';
import CuttingOrder from '../components/CuttingOrder';
import { drawerPacketHtml } from '../lib/buildPacket';
import { guidePrintHtml } from '../lib/buildGuide';
import { drawerGuideSteps } from '../lib/drawerGuide';
import { drawerJigs } from '../lib/drawerExport';
import { quantityLabel } from '../lib/shelfEstimate';
import GridfinityPlanner from '../components/GridfinityPlanner';
import ToolInsertEditor from '../components/ToolInsertEditor';
import { TutorialButton } from '../tour/TourLaunchers';
import { useDrawerEstimate } from '../components/DrawerEstimate';
import { CostTable, HardwareTable, money } from '../components/ShelfEstimate';
import { DRAWER_PRICE_LABELS } from '../lib/drawerEstimate';
import DrawerAddToProject from '../components/DrawerAddToProject';
import DrawerBuildGuide from '../components/DrawerBuildGuide';
import {
  createLibraryDrawerDesign, getDrawerDesign, getLibraryDrawerDesign, getProject, listLibraryDrawerDesigns, updateLibraryDrawerDesign,
} from '../services/api';
import { isDemoMode } from '../demo/demoMode';
import type { LibraryDrawerDesign } from '../types/project';
import { decimalString, formatLength, lengthToField, parseLength, type LengthUnit } from '../lib/shelving';
import {
  buildDrawerPlan,
  DEFAULT_CASTER_HEIGHT,
  DEFAULT_FOOT_HEIGHT,
  DEFAULT_PULL,
  drawerSolids,
  equalFronts,
  graduatedFronts,
  notchedOutline,
  frontNotch,
  handHole,
  pullReach,
  stadiumOutline,
  SLIDE_CAPACITY_LB,
  SLIDE_LENGTHS,
  drawerDesignToFields,
  readSavedDrawerDesign,
  toSavedDrawerDesign,
  deskSolids,
  finishColors,
  DEFAULT_FINISH,
  DRAWER_LOADS,
  EXTRA_FIELD_DEFAULTS,
  FINISH_COLORS,
  MIN_BOX_HEIGHT,
  BOX_CLEARANCE,
  BASE_LABELS,
  isKickBase,
  sheetParts,
  type DrawerBase,
  type DrawerConfig,
  type DrawerDesignFields,
  type DrawerPlan,
} from '../lib/drawerUnit';
import { DRAWER_TEMPLATES, drawerThumbnailDataUrl, type DrawerTemplate } from '../lib/drawerTemplates';
import { MARKER_PRESETS } from '../lib/drawerInserts';
import { PRINTER_BEDS } from '../lib/gridfinity';
import type { CutListItem } from '../types/project';

const ShelfViewer3D = lazy(() => import('../components/ShelfViewer3D'));

const STORAGE_KEY = 'workshop-drawer-builder';
const VIEW_STORAGE_KEY = 'workshop-drawer-builder-view';
/** The user's own product links for the hardware list. */
const LINKS_STORAGE_KEY = 'workshop-drawer-links';
/** Build-tracker progress for designs that aren't on a project. */
const PROGRESS_STORAGE_KEY = 'workshop-drawer-progress';
/** Which saved design is open (and its saved state), so returning to the page keeps the link. */
const SOURCE_STORAGE_KEY = 'workshop-drawer-builder-source';
/** The design that was in the builder before another was opened over it. */
const PREVIOUS_STORAGE_KEY = 'workshop-drawer-builder-previous';
const MAX_DRAWERS = 12;
const MAX_COLUMNS = 4;

type FormState = DrawerDesignFields;

const DEFAULT_FORM: FormState = {
  units: 'in',
  thickness: '3/4',
  width: '14 1/8',
  height: '27 1/2',
  depth: '22 7/8',
  heightMode: 'overall',
  drawers: 5,
  frontHeights: ['5', '5', '5', '5', '5'],
  gap: '1/8',
  pullEnabled: true,
  pullShape: DEFAULT_PULL.shape,
  pullWidth: '6 1/2',
  pullDepth: '1 1/8',
  frontStyle: 'inset',
  boxThickness: '1/2',
  bottomThickness: '1/4',
  backThickness: '1/4',
  base: 'none',
  footHeight: lengthToField(DEFAULT_FOOT_HEIGHT, 'in'),
  casterHeight: lengthToField(DEFAULT_CASTER_HEIGHT, 'in'),
  kickHeight: '4',
  kickSetback: '3',
  baseboardHeight: '',
  baseboardThickness: '1/2',
  exposedLeft: true,
  exposedRight: true,
  slideLength: 'auto',
  edgeBanding: false,
  bandingThickness: '0.5 mm',
  insertKinds: ['none', 'none', 'none', 'none', 'none'],
  gridColumns: [2, 2, 2, 2, 2],
  gridRows: [2, 2, 2, 2, 2],
  gridfinityBins: [[], [], [], [], []],
  toolPockets: [[], [], [], [], []],
  toolBoardThickness: '3/4',
  toolPocketDepth: '1/2',
  toolClearance: '1/32',
  toolFingerHoles: true,
  insertThickness: EXTRA_FIELD_DEFAULTS.insertThickness,
  markerDiameter: lengthToField(MARKER_PRESETS[0].diameter, 'in'),
  markerLength: lengthToField(MARKER_PRESETS[0].length, 'in'),
  markerSpacing: EXTRA_FIELD_DEFAULTS.markerSpacing,
  desk: false,
  deskLayout: EXTRA_FIELD_DEFAULTS.deskLayout,
  deskWidth: EXTRA_FIELD_DEFAULTS.deskWidth,
  deskHeight: EXTRA_FIELD_DEFAULTS.deskHeight,
  deskDepth: EXTRA_FIELD_DEFAULTS.deskDepth,
  deskTopLayers: EXTRA_FIELD_DEFAULTS.deskTopLayers,
  drawerSlides: ['', '', '', '', ''],
  load: 'medium',
  finishFront: DEFAULT_FINISH.front,
  finishCase: DEFAULT_FINISH.case,
  gridfinityBed: '256',
  columns: 1,
  columnWidthMode: 'equal',
  columnWidths: [],
  columnDrawers: [5],
  columnFronts: [['5', '5', '5', '5', '5']],
  mount: 'floor',
  mountHeight: '30',
  cleatHeight: '3',
};

const LENGTH_FIELDS = [
  'thickness', 'width', 'height', 'depth', 'gap', 'pullWidth', 'pullDepth',
  'boxThickness', 'bottomThickness', 'backThickness', 'footHeight', 'casterHeight',
  'insertThickness', 'markerDiameter', 'markerLength', 'markerSpacing', 'deskWidth', 'deskHeight', 'deskDepth',
  'mountHeight', 'cleatHeight', 'toolBoardThickness', 'toolPocketDepth', 'toolClearance',
  'kickHeight', 'kickSetback', 'baseboardHeight', 'baseboardThickness',
] as const;
type FieldKey = typeof LENGTH_FIELDS[number] | `frontHeights.${number}` | `columnFronts.${number}.${number}` | `columnWidths.${number}`;

const UNIT_OPTIONS = [
  { value: 'in', label: 'Inches' },
  { value: 'mm', label: 'Millimeters' },
] as const;

const HEIGHT_MODE_OPTIONS = [
  { value: 'overall', label: 'Overall height' },
  { value: 'fronts', label: 'Each front' },
] as const;

const MOUNT_OPTIONS = [
  { value: 'floor', label: 'On the floor' },
  { value: 'wall', label: 'Wall-hung' },
  { value: 'under-desk', label: 'Under a desk' },
] as const;

const BASE_HINTS: Record<DrawerBase, string> = {
  none: 'The case bottom sits right on the floor.',
  feet: 'MROCO 1/4″-20 levelers thread into T-nuts in the bottom; screw them out to level.',
  casters: 'Plate casters screw to the bottom; locking ones keep it put.',
  plinth: 'A plywood box under the case, set back at the front for your toes. Level it with shims before the case goes on.',
  kick: 'The sides run down to the floor, notched at the front, with a kick board set back between them — one piece, like a kitchen cabinet.',
  flush: 'A plinth flush with the case, wrapped in baseboard to match the room.',
};

const PULL_OPTIONS = [
  { value: 'alex', label: 'ALEX notch', hint: 'The IKEA ALEX scoop: a flat-bottomed cut-out in the top edge with smooth curves into it at each end.' },
  { value: 'arc', label: 'Round arc', hint: 'A shallow circular curve cut into the top edge.' },
  { value: 'slot', label: 'Slot notch', hint: 'A rounded-bottom slot in the top edge.' },
  { value: 'wide', label: 'Wide notch', hint: `A long slot across nearly the whole front, stopping 2″ from each end.` },
  { value: 'handhole', label: 'Hand hole', hint: 'A rounded hole cut through the front, just below the top edge.' },
] as const;

const FRONT_STYLE_OPTIONS = [
  { value: 'inset', label: 'Inset (ALEX)' },
  { value: 'overlay', label: 'Full overlay' },
] as const;

const COLUMN_WIDTH_OPTIONS = [
  { value: 'equal', label: 'All the same' },
  { value: 'custom', label: 'Each column' },
] as const;

const DESK_LAYOUT_OPTIONS = [
  { value: 'both', label: 'Unit at each end' },
  { value: 'left', label: 'Left only' },
  { value: 'right', label: 'Right only' },
] as const;

const TOP_LAYER_OPTIONS = [
  { value: '2', label: 'Double thickness' },
  { value: '1', label: 'Single' },
] as const;

const VIEW_OPTIONS = [
  { value: '3d', label: '3D' },
  { value: 'drawing', label: 'Drawing' },
] as const;
type PreviewMode = '3d' | 'drawing';

const THICKNESS_PRESETS: Record<LengthUnit, string[]> = {
  in: ['3/4"', '23/32"', '1/2"', '18 mm'],
  mm: ['18 mm', '15 mm', '12 mm', '3/4"'],
};

const BANDING_PRESETS = [
  { value: '0.5 mm', label: '0.5 mm veneer' },
  { value: '1 mm', label: '1 mm PVC' },
  { value: '2 mm', label: '2 mm PVC' },
];

/** Keep every per-drawer list the same length as the drawer count (with columns, their total). */
function normalizeDrawers(input: FormState): FormState {
  let form = input;
  if (form.columns > 1) {
    const k = Math.min(Math.max(Math.floor(form.columns), 2), MAX_COLUMNS);
    const counts = Array.from({ length: k }, (_, c) => form.columnDrawers?.[c] ?? form.columnDrawers?.[c - 1] ?? form.drawers);
    const fronts = counts.map((count, c) => {
      const list = form.columnFronts?.[c] ?? form.columnFronts?.[c - 1] ?? form.frontHeights;
      return Array.from({ length: count }, (_, i) => list?.[i] ?? list?.[list.length - 1] ?? '5');
    });
    form = {
      ...form, columns: k, columnDrawers: counts, columnFronts: fronts,
      columnWidths: Array.from({ length: k }, (_, c) => form.columnWidths?.[c] ?? ''),
      drawers: counts.reduce((a, b) => a + b, 0),
    };
  }
  const n = form.drawers;
  const list = Array.isArray(form.frontHeights) ? form.frontHeights : [];
  const last = list[list.length - 1] ?? DEFAULT_FORM.frontHeights[0];
  const fit = <T,>(values: T[] | undefined, fill: T) => Array.from({ length: n }, (_, i) => values?.[i] ?? fill);
  return {
    ...form,
    frontHeights: Array.from({ length: n }, (_, i) => list[i] ?? last),
    insertKinds: fit(form.insertKinds, 'none'),
    gridColumns: fit(form.gridColumns, 2),
    gridRows: fit(form.gridRows, 2),
    gridfinityBins: fit(form.gridfinityBins, []),
    toolPockets: fit(form.toolPockets, []),
    drawerSlides: fit(form.drawerSlides, ''),
  };
}

function convertForm(form: FormState, units: LengthUnit): FormState {
  if (form.units === units) return form;
  const convert = (raw: string) => {
    const inches = parseLength(raw, form.units);
    return inches === null ? raw : lengthToField(inches, units);
  };
  const next: FormState = { ...form, units };
  for (const key of LENGTH_FIELDS) next[key] = convert(form[key]);
  next.frontHeights = form.frontHeights.map(convert);
  next.columnFronts = form.columnFronts.map(list => list.map(convert));
  next.columnWidths = form.columnWidths.map(w => (w.trim() ? convert(w) : w));
  return next;
}

/**
 * Splices a per-drawer list when one column's drawer count changes: drawers are listed
 * column by column, so the column's slice grows or shrinks in place.
 */
function resizeColumnSlice<T>(list: T[], counts: number[], column: number, count: number, fill: (last: T | undefined) => T): T[] {
  const start = counts.slice(0, column).reduce((a, b) => a + b, 0);
  const slice = list.slice(start, start + counts[column]);
  const resized = Array.from({ length: count }, (_, i) => slice[i] ?? fill(slice[slice.length - 1]));
  return [...list.slice(0, start), ...resized, ...list.slice(start + counts[column])];
}

function readStoredForm(): FormState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_FORM;
    const merged = { ...DEFAULT_FORM, ...(JSON.parse(raw) as Partial<FormState>) };
    if (merged.units !== 'mm') merged.units = 'in';
    return normalizeDrawers(merged);
  } catch {
    return DEFAULT_FORM;
  }
}

function readStoredView(): PreviewMode {
  try {
    return localStorage.getItem(VIEW_STORAGE_KEY) === 'drawing' ? 'drawing' : '3d';
  } catch {
    return '3d';
  }
}

/** Zero is allowed for the gap; everything else must be a positive length. */
function toConfig(form: FormState): { config: DrawerConfig | null; fieldErrors: Partial<Record<FieldKey, string>> } {
  const fieldErrors: Partial<Record<FieldKey, string>> = {};
  const num = (key: FieldKey, { allowZero = false } = {}) => {
    const parts = key.split('.');
    const raw = (key.startsWith('frontHeights.') ? form.frontHeights[Number(parts[1])] ?? ''
      : key.startsWith('columnFronts.') ? form.columnFronts[Number(parts[1])]?.[Number(parts[2])] ?? ''
        : key.startsWith('columnWidths.') ? form.columnWidths[Number(parts[1])] ?? ''
          : form[key as typeof LENGTH_FIELDS[number]]).trim();
    if (allowZero && (raw === '' || Number(raw) === 0)) return 0;
    const value = parseLength(raw, form.units);
    if (value === null) {
      fieldErrors[key] = form.units === 'mm'
        ? 'Enter millimeters, e.g. 358, or inches like 14 1/8"'
        : 'Enter inches, e.g. 14 1/8 or 14.125, or millimeters like 358mm';
    }
    return value ?? 0;
  };
  const fronts = form.heightMode === 'fronts';
  const thickness = num('thickness');
  const desk = form.desk
    ? { enabled: true, layout: form.deskLayout, width: num('deskWidth'), height: num('deskHeight'), depth: num('deskDepth'), topLayers: form.deskTopLayers }
    : undefined;
  const usesMarkers = form.insertKinds.slice(0, form.drawers).includes('markers');
  const usesTools = form.insertKinds.slice(0, form.drawers).includes('tools');
  const toolBoard = usesTools ? num('toolBoardThickness') : null;
  const toolDepth = usesTools ? num('toolPocketDepth') : null;
  if (usesTools) num('toolClearance');
  const marker = usesMarkers
    ? { kind: 'markers' as const, diameter: num('markerDiameter'), length: num('markerLength'), spacing: num('markerSpacing', { allowZero: true }) }
    : null;
  const config: DrawerConfig = {
    units: form.units,
    thickness,
    width: num('width'),
    // Under a desk the units are as tall as the space beneath the top.
    height: fronts ? 0 : desk ? desk.height - desk.topLayers * thickness : num('height'),
    depth: num('depth'),
    drawers: form.drawers,
    frontHeights: fronts && form.columns <= 1 ? form.frontHeights.slice(0, form.drawers).map((_, i) => num(`frontHeights.${i}`)) : undefined,
    columns: form.columns > 1
      ? form.columnDrawers.map((count, c) => ({
        drawers: count,
        frontHeights: fronts ? Array.from({ length: count }, (_, i) => num(`columnFronts.${c}.${i}`)) : undefined,
        width: form.columnWidthMode === 'custom' && c < form.columns - 1 ? num(`columnWidths.${c}`) : undefined,
      }))
      : undefined,
    gap: num('gap', { allowZero: true }),
    frontStyle: form.frontStyle,
    pull: {
      enabled: form.pullEnabled,
      shape: form.pullShape,
      width: form.pullEnabled ? num('pullWidth') : 0,
      depth: form.pullEnabled ? num('pullDepth') : 0,
    },
    boxThickness: num('boxThickness'),
    bottomThickness: num('bottomThickness'),
    backThickness: num('backThickness'),
    base: form.base,
    footHeight: form.base === 'feet' ? num('footHeight', { allowZero: true }) : DEFAULT_FOOT_HEIGHT,
    casterHeight: form.base === 'casters' ? num('casterHeight') : DEFAULT_CASTER_HEIGHT,
    ...(form.mount === 'floor' && isKickBase(form.base) ? {
      kickHeight: num('kickHeight'),
      kickSetback: form.base === 'flush' ? undefined : num('kickSetback', { allowZero: true }),
      baseboardHeight: form.base === 'flush' && form.baseboardHeight.trim() ? num('baseboardHeight') : undefined,
      baseboardThickness: form.base === 'flush' ? num('baseboardThickness') : undefined,
    } : {}),
    exposedSides: { left: form.exposedLeft, right: form.exposedRight },
    slideLength: form.slideLength === 'auto' ? undefined : Number(form.slideLength),
    edgeBanding: form.edgeBanding,
    bandingThickness: parseLength(form.bandingThickness, form.units) ?? 0.02,
    openSlots: form.insertKinds.slice(0, form.drawers).includes('cubby') ? form.insertKinds.slice(0, form.drawers).map(k => k === 'cubby') : undefined,
    inserts: form.insertKinds.slice(0, form.drawers).map((kind, i) =>
      kind === 'grid' ? { kind: 'grid', columns: form.gridColumns[i] ?? 2, rows: form.gridRows[i] ?? 2 }
        : kind === 'markers' ? marker
          : kind === 'gridfinity' ? { kind: 'gridfinity', bins: form.gridfinityBins[i]?.length ? form.gridfinityBins[i] : undefined }
            : kind === 'tools' ? { kind: 'tools', tools: form.toolPockets[i] ?? [], boardThickness: toolBoard!, pocketDepth: toolDepth!, fingerHoles: form.toolFingerHoles }
            : null),
    gridfinityBed: Number(form.gridfinityBed) || 256,
    insertThickness: form.insertKinds.slice(0, form.drawers).some(k => k !== 'none') ? num('insertThickness') : 1 / 4,
    desk,
    slideLengths: form.drawerSlides.slice(0, form.drawers).some(Boolean)
      ? form.drawerSlides.slice(0, form.drawers).map(v => (v ? Number(v) : null))
      : undefined,
    load: form.load,
    mount: form.mount,
    mountHeight: form.mount === 'floor' ? undefined : num('mountHeight'),
    cleatHeight: form.mount === 'wall' ? num('cleatHeight') : 3,
    finish: { front: form.finishFront, case: form.finishCase },
  };
  if (Object.keys(fieldErrors).length > 0) return { config: null, fieldErrors };
  return { config, fieldErrors };
}

/** Every part comes from sheets; the optimizer matches each to a sheet of its thickness. */
function toCutList(plan: DrawerPlan): CutListItem[] {
  return sheetParts(plan.parts).map((part, index) => ({
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

const errorText = (err: unknown) => (err instanceof Error && err.message ? err.message : 'the request failed');

/** "12" or "12–35". */
function loadRange(pounds: number[]): string {
  const lo = Math.round(Math.min(...pounds));
  const hi = Math.round(Math.max(...pounds));
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

/** Rounds fronts to 1/16" (or 0.5 mm), letting the bottom one take up the difference so the total holds. */
function roundedFronts(heights: number[], units: LengthUnit): string[] {
  const step = units === 'mm' ? 0.5 / 25.4 : 1 / 16;
  const total = heights.reduce((a, b) => a + b, 0);
  const rounded = heights.map(h => Math.round(h / step) * step);
  rounded[rounded.length - 1] += total - rounded.reduce((a, b) => a + b, 0);
  return rounded.map(h => lengthToField(h, units));
}

export default function DrawerBuilder() {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(readStoredForm);
  const [view, setView] = useState<PreviewMode>(readStoredView);
  const [copyStatus, setCopyStatus] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const [storedSource] = useState(readStoredSource);
  /** Where the design on screen came from: a project, a saved library design, or a template. */
  const [source, setSource] = useState<DesignSource | null>(storedSource.source);
  /** The open library design as last saved (or opened), to tell when there are unsaved changes. */
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(storedSource.snapshot);
  const pendingSnapshot = useRef(false);
  const [naming, setNaming] = useState(false);
  const [designName, setDesignName] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [loadNotice, setLoadNotice] = useState<{ tone: 'info' | 'error'; text: string } | null>(null);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [library, setLibrary] = useState<LibraryDrawerDesign[]>([]);
  const [addingToProject, setAddingToProject] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const formRef = useRef(form);
  formRef.current = form;
  const demo = isDemoMode();
  const units = form.units;
  const fmt = (inches: number) => formatLength(inches, units);
  const otherUnit = (inches: number) => formatLength(inches, units === 'mm' ? 'in' : 'mm');

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(form)); } catch { /* convenience only */ }
  }, [form]);
  useEffect(() => {
    try { localStorage.setItem(VIEW_STORAGE_KEY, view); } catch { /* convenience only */ }
  }, [view]);

  const { config, fieldErrors } = useMemo(() => toConfig(form), [form]);
  const plan = useMemo(() => (config ? buildDrawerPlan(config) : null), [config]);
  const valid = plan !== null && plan.errors.length === 0;
  const solids = useMemo(() => (plan && config && valid ? (plan.desk ? deskSolids(plan, config) : drawerSolids(plan, config)) : []), [plan, config, valid]);
  const cutList = useMemo(() => (plan && valid ? toCutList(plan) : []), [plan, valid]);
  const estimate = useDrawerEstimate(plan && valid ? plan : null, valid ? config : null, units);

  // Build packet: cut list, cutting order, hardware, jigs and prints ahead of the illustrated guide, in one printable page.
  const [packetBusy, setPacketBusy] = useState(false);
  const printPacket = async () => {
    if (!plan || !config || packetBusy) return;
    const win = window.open('', '_blank');
    if (!win) {
      setLoadNotice({ tone: 'error', text: 'Pop-up blocked — allow pop-ups for Workshop and try again.' });
      return;
    }
    win.document.write('<p style="font:16px system-ui;padding:24px;color:#15332e">Preparing the build packet — drawing the illustrations…</p>');
    setPacketBusy(true);
    try {
      const guide = drawerGuideSteps(plan, config, units);
      let images = new Map<string, string>();
      try {
        const { renderGuideScenes } = await import('../lib/shelfRender');
        const drawn = guide.steps.filter(step => step.scene !== null);
        const urls = await renderGuideScenes({
          solids: guide.solids, scenes: drawn.map(step => step.scene!), width: plan.overallWidth, height: plan.overallHeight + plan.lift,
          depth: plan.caseDepth, wallMounted: plan.mount === 'wall', colors: finishColors(config.finish),
        });
        images = new Map(drawn.map((step, i) => [step.id, urls[i]]));
      } catch (err) {
        console.error('Packet illustrations failed', err);
      }
      const extra = drawerPacketHtml({
        plan, config, units, jigs: drawerJigs(plan, config, fmt), quantity: quantityLabel,
        hardware: estimate?.hardware ?? [],
        cost: estimate ? { lines: estimate.estimate.lines, total: estimate.estimate.total } : undefined,
      });
      const title = source?.title ?? 'Drawer unit';
      const subtitle = `${fmt(plan.overallWidth)} wide × ${fmt(plan.overallHeight)} tall × ${fmt(plan.overallDepth)} deep · build packet`;
      win.document.open();
      win.document.write(guidePrintHtml(guide, images, title, subtitle, fmt, extra));
      win.document.close();
    } finally {
      setPacketBusy(false);
    }
  };

  // Build tracker: finished guide steps, kept in this browser per design.
  const progressKey = `${PROGRESS_STORAGE_KEY}:${source && source.kind !== 'template' ? `${source.kind}-${source.id}` : 'current'}`;
  const [guideDone, setGuideDone] = useState<string[]>([]);
  useEffect(() => {
    try { setGuideDone(JSON.parse(localStorage.getItem(progressKey) ?? '[]') as string[]); } catch { setGuideDone([]); }
  }, [progressKey]);
  const saveGuideDone = (done: string[]) => {
    setGuideDone(done);
    try { localStorage.setItem(progressKey, JSON.stringify(done)); } catch { /* convenience only */ }
  };

  const drawerLabel = (i: number) => plan?.drawers[i]?.label ?? `Drawer ${i + 1}`;

  const update = (patch: Partial<FormState>) => {
    setCopyStatus('');
    setForm(prev => ({ ...prev, ...patch }));
  };

  const templatePlans = useMemo(() => DRAWER_TEMPLATES.map(t => {
    const c = toConfig(normalizeDrawers({ ...DEFAULT_FORM, ...t.fields, units: 'in' })).config;
    return c ? { plan: buildDrawerPlan(c), pull: c.pull } : null;
  }), []);

  // Opening anything sets the current design aside first, so it can be restored.
  function applyDesign(fields: FormState, origin: DesignSource) {
    try {
      localStorage.setItem(PREVIOUS_STORAGE_KEY, JSON.stringify(formRef.current));
      setHasPrevious(true);
    } catch {
      setHasPrevious(false);
    }
    setForm(normalizeDrawers(fields));
    setSource(origin);
    // A library design's reference copy is taken from the form once it renders (see below).
    pendingSnapshot.current = origin.kind === 'library';
    setSavedSnapshot(null);
    setNaming(false);
    setSaveMessage(null);
    setLoadNotice(null);
    setAddingToProject(false);
  }

  const applyTemplate = (template: DrawerTemplate) => {
    applyDesign(convertForm(normalizeDrawers({ ...DEFAULT_FORM, ...template.fields, units: 'in' }), units), { kind: 'template', title: template.name });
  };

  const restorePrevious = () => {
    try {
      const raw = localStorage.getItem(PREVIOUS_STORAGE_KEY);
      if (raw) setForm(normalizeDrawers({ ...DEFAULT_FORM, ...(JSON.parse(raw) as Partial<FormState>) }));
      localStorage.removeItem(PREVIOUS_STORAGE_KEY);
    } catch {
      setLoadNotice({ tone: 'error', text: 'Your previous design couldn’t be restored from this browser.' });
    }
    setHasPrevious(false);
    setSource(null);
    setAddingToProject(false);
  };

  // Saved designs, for the "Start from" strip.
  useEffect(() => {
    let cancelled = false;
    listLibraryDrawerDesigns()
      .then(list => !cancelled && setLibrary(list))
      .catch(err => console.error('Saved drawer designs failed to load', err));
    return () => { cancelled = true; };
  }, [source]);

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
    getLibraryDrawerDesign(id)
      .then(entry => {
        if (cancelled) return;
        const saved = readSavedDrawerDesign(entry.design);
        if (!saved) {
          setLoadNotice({ tone: 'error', text: `“${entry.name}” couldn’t be read, so your current design was kept.` });
          return;
        }
        applyDesign(drawerDesignToFields(saved), { kind: 'library', id: entry.id, title: entry.name });
      })
      .catch(err => {
        if (!cancelled) setLoadNotice({ tone: 'error', text: `That design couldn’t be opened (${errorText(err)}), so your current design was kept.` });
      })
      .finally(() => !cancelled && finish());
    return () => { cancelled = true; };
  }, [designParam, setSearchParams]);

  // ?project=<id> opens that project's saved drawer design (from its 3D preview).
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
    Promise.all([getProject(id), getDrawerDesign(id)])
      .then(([project, { design }]) => {
        if (cancelled) return;
        const saved = design == null ? null : readSavedDrawerDesign(design);
        if (!saved) {
          setLoadNotice({
            tone: 'error',
            text: design == null
              ? `“${project.title}” has no Drawer Builder design saved, so your current design was kept.`
              : `The design saved on “${project.title}” couldn’t be read, so your current design was kept.`,
          });
          return;
        }
        applyDesign(drawerDesignToFields(saved), { kind: 'project', id, title: project.title });
      })
      .catch(err => {
        if (!cancelled) setLoadNotice({ tone: 'error', text: `Project ${id}’s design couldn’t be opened (${errorText(err)}), so your current design was kept.` });
      })
      .finally(() => !cancelled && finish());
    return () => { cancelled = true; };
  }, [projectParam, setSearchParams]);

  // ── Saved design state ─────────────────────────────────────────────────────
  const currentSnapshot = useMemo(
    () => (config && valid ? JSON.stringify(toSavedDrawerDesign(config, units, form.heightMode)) : null),
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

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const saveDesignChanges = async () => {
    if (!openDesign || !config || saving) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const snapshot = currentSnapshot;
      const entry = await updateLibraryDrawerDesign(openDesign.id, { design: toSavedDrawerDesign(config, units, form.heightMode) });
      setSavedSnapshot(snapshot);
      setSource({ kind: 'library', id: entry.id, title: entry.name });
      setSaveMessage({ ok: true, text: `Saved “${entry.name}”.` });
    } catch (err) {
      setSaveMessage({ ok: false, text: `Your changes weren’t saved: ${errorText(err)}. They’re still here — try again.` });
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
      const entry = await createLibraryDrawerDesign(name, toSavedDrawerDesign(config, units, form.heightMode));
      setSource({ kind: 'library', id: entry.id, title: entry.name });
      setSavedSnapshot(snapshot);
      setNaming(false);
      setDesignName('');
      setSaveMessage({ ok: true, text: `Saved as “${entry.name}”. Find it on the Projects page or under Start from.` });
    } catch (err) {
      setSaveMessage({ ok: false, text: `The design wasn’t saved: ${errorText(err)}` });
    } finally {
      setSaving(false);
    }
  };

  // Switching fills the newly active height from the current design, so nothing changes size.
  const setHeightMode = (heightMode: FormState['heightMode']) => {
    if (heightMode === form.heightMode) return;
    const patch: Partial<FormState> = { heightMode };
    if (plan) {
      if (heightMode === 'fronts') {
        patch.frontHeights = roundedFronts(plan.drawers.filter(d => d.column === 0).map(d => d.front.height), units);
        patch.columnFronts = plan.columns.map(c => roundedFronts(c.drawers.map(i => plan.drawers[i].front.height), units));
      } else {
        patch.height = lengthToField(plan.overallHeight, units);
      }
    }
    update(patch);
  };

  /** One column ↔ several: drawer lists are copied column by column so nothing is lost. */
  const setColumns = (count: number) => {
    const k = Math.min(Math.max(count, 1), MAX_COLUMNS);
    setForm(prev => {
      if (k === prev.columns) return prev;
      const was = prev.columns > 1 ? prev.columnDrawers : [prev.drawers];
      const wasFronts = prev.columns > 1 ? prev.columnFronts : [prev.frontHeights];
      const counts = Array.from({ length: k }, (_, c) => was[c] ?? was[was.length - 1]);
      const fronts = Array.from({ length: k }, (_, c) => wasFronts[c] ?? wasFronts[wasFronts.length - 1]);
      // Per-drawer lists: keep each existing column's slice; new columns copy the last one.
      const regroup = <T,>(list: T[]): T[] => {
        const slices: T[][] = [];
        let at = 0;
        for (const n of was) { slices.push(list.slice(at, at + n)); at += n; }
        return counts.flatMap((_, c) => slices[c] ?? slices[slices.length - 1]);
      };
      const next: FormState = {
        ...prev,
        columns: k,
        columnDrawers: counts,
        columnFronts: fronts,
        columnWidths: Array.from({ length: k }, (_, c) => prev.columnWidths[c] ?? ''),
        drawers: counts.reduce((a, b) => a + b, 0),
        insertKinds: regroup(prev.insertKinds),
        gridColumns: regroup(prev.gridColumns),
        gridRows: regroup(prev.gridRows),
        gridfinityBins: regroup(prev.gridfinityBins),
        toolPockets: regroup(prev.toolPockets),
        drawerSlides: regroup(prev.drawerSlides),
      };
      if (k === 1) { next.drawers = counts[0]; next.frontHeights = fronts[0]; }
      return normalizeDrawers(next);
    });
  };

  const setColumnDrawers = (column: number, count: number) => {
    const n = Math.min(Math.max(count, 1), MAX_DRAWERS);
    // Typing each front: re-spread the changed column over the current case height so it still fits.
    const caseHeight = plan ? (plan.desk ? plan.desk.height - plan.desk.topThickness - plan.baseHeight : plan.caseHeight) : null;
    const respread = form.heightMode === 'fronts' && caseHeight && config
      ? roundedFronts(equalFronts(n, caseHeight - n * config.gap), units)
      : null;
    setForm(prev => {
      const counts = prev.columnDrawers;
      const next: FormState = {
        ...prev,
        insertKinds: resizeColumnSlice(prev.insertKinds, counts, column, n, () => 'none' as const),
        gridColumns: resizeColumnSlice(prev.gridColumns, counts, column, n, last => last ?? 2),
        gridRows: resizeColumnSlice(prev.gridRows, counts, column, n, last => last ?? 2),
        gridfinityBins: resizeColumnSlice(prev.gridfinityBins, counts, column, n, () => []),
        toolPockets: resizeColumnSlice(prev.toolPockets, counts, column, n, () => []),
        drawerSlides: resizeColumnSlice(prev.drawerSlides, counts, column, n, () => ''),
        columnDrawers: counts.map((c, i) => (i === column ? n : c)),
        columnFronts: prev.columnFronts.map((list, i) => (i !== column ? list
          : respread ?? Array.from({ length: n }, (_, j) => list[j] ?? list[list.length - 1] ?? '5'))),
      };
      return normalizeDrawers(next);
    });
  };

  const setColumnFront = (column: number, index: number, value: string) => {
    setCopyStatus('');
    setForm(prev => ({ ...prev, columnFronts: prev.columnFronts.map((list, c) => (c === column ? list.map((v, i) => (i === index ? value : v)) : list)) }));
  };

  const setColumnWidth = (column: number, value: string) =>
    setForm(prev => ({ ...prev, columnWidths: prev.columnWidths.map((v, c) => (c === column ? value : v)) }));

  const setDrawers = (count: number) => {
    const drawers = Math.min(MAX_DRAWERS, Math.max(1, count));
    setForm(prev => normalizeDrawers({ ...prev, drawers }));
  };

  const setInsert = (index: number, patch: { insertKinds?: FormState['insertKinds'][number]; gridColumns?: number; gridRows?: number }) => {
    setCopyStatus('');
    setForm(prev => {
      const next = { ...prev };
      for (const key of Object.keys(patch) as (keyof typeof patch)[]) {
        const list = [...(prev[key] as unknown[])];
        list[index] = patch[key];
        (next as Record<string, unknown>)[key] = list;
      }
      return next;
    });
  };

  const copyInsertToAll = () => setForm(prev => ({
    ...prev,
    insertKinds: prev.insertKinds.map(() => prev.insertKinds[0]),
    gridColumns: prev.gridColumns.map(() => prev.gridColumns[0]),
    gridRows: prev.gridRows.map(() => prev.gridRows[0]),
  }));

  const [perDrawerSlides, setPerDrawerSlides] = useState(() => form.drawerSlides.some(Boolean));
  const setDrawerSlide = (index: number, value: string) =>
    setForm(prev => ({ ...prev, drawerSlides: prev.drawerSlides.map((v, i) => (i === index ? value : v)) }));

  // Your own product links for the hardware, remembered in this browser.
  const [links, setLinks] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem(LINKS_STORAGE_KEY) ?? '{}') as Record<string, string>; } catch { return {}; }
  });
  const setLink = (key: string, url: string | null) => setLinks(prev => {
    const next = { ...prev };
    if (url) next[key] = url; else delete next[key];
    try { localStorage.setItem(LINKS_STORAGE_KEY, JSON.stringify(next)); } catch { /* convenience only */ }
    return next;
  });

  // A shallow top drawer: the smallest front whose box still takes the slides; the rest share what's left.
  // With columns, every column gets the same shallow top drawer.
  const shallowTopDrawer = () => {
    if (!plan || !config) return;
    const caseHeight = plan.desk ? plan.desk.height - plan.desk.topThickness - plan.baseHeight : plan.caseHeight;
    const counts = form.columns > 1 ? form.columnDrawers : [form.drawers];
    if (counts.some(n => n < 2)) return;
    const forBox = MIN_BOX_HEIGHT + 2 * BOX_CLEARANCE + config.thickness - config.gap;
    const forPull = pullReach(config.pull, Math.min(...plan.drawers.map(d => d.front.width))) + 1.25;
    // Start from the box and pull minimums, then grow in 1/8" steps until no top drawer
    // has problems of its own (a hand hole, say, needs room for its box-front notch).
    let top = Math.ceil(Math.max(forBox, forPull, 3) * 8) / 8;
    const heightsFor = (h: number, n: number) => [h, ...equalFronts(n - 1, caseHeight - n * config.gap - h)];
    const tryConfig = (h: number): DrawerConfig => (form.columns > 1
      ? { ...config, columns: config.columns!.map((c, i) => ({ ...c, frontHeights: heightsFor(h, counts[i]) })) }
      : { ...config, frontHeights: heightsFor(h, counts[0]) });
    const topOk = (h: number) => !buildDrawerPlan(tryConfig(h)).errors.some(e => /^(Column \d+ )?[Dd]rawer 1(’s|:)/.test(e));
    while (!topOk(top) && top < caseHeight / Math.max(...counts)) top += 1 / 8;
    update({
      heightMode: 'fronts',
      frontHeights: roundedFronts(heightsFor(top, counts[0]), units),
      columnFronts: counts.map(n => roundedFronts(heightsFor(top, n), units)),
    });
  };

  const setFront = (index: number, value: string) => {
    setCopyStatus('');
    setForm(prev => ({ ...prev, frontHeights: prev.frontHeights.map((v, i) => (i === index ? value : v)) }));
  };

  // Spread the fronts over the current case height, equally or growing toward the floor.
  const spreadFronts = (kind: 'equal' | 'graduated', column?: number) => {
    if (!plan || !config) return;
    const caseHeight = plan.desk ? plan.desk.height - plan.desk.topThickness - plan.baseHeight : plan.caseHeight;
    const spread = (n: number) => {
      const available = caseHeight - n * config.gap;
      return roundedFronts(kind === 'equal' ? equalFronts(n, available) : graduatedFronts(n, available), units);
    };
    if (form.columns > 1) {
      update({ columnFronts: form.columnDrawers.map((n, c) => (column === undefined || column === c ? spread(n) : form.columnFronts[c])) });
    } else {
      update({ frontHeights: spread(form.drawers) });
    }
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

  const thicknessChips = (field: 'thickness' | 'boxThickness', presets: string[]) => (
    <div className="shelf-chips" role="group" aria-label="Common plywood thicknesses">
      {presets.map(preset => {
        const inches = parseLength(preset, units)!;
        const current = parseLength(form[field], units);
        return (
          <button
            key={preset}
            type="button"
            className="shelf-chip"
            aria-pressed={current !== null && Math.abs(current - inches) < 0.002}
            onClick={() => update({ [field]: lengthToField(inches, units) })}
          >
            {preset}
          </button>
        );
      })}
    </div>
  );

  return (
    <PageFrame maxWidth={1200} className="shelf-page">
      <Button variant="ghost" onClick={() => navigate(-1)} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" />
        Back
      </Button>

      <PageHeader
        title="Drawer Builder"
        description="Design an ALEX-style plywood drawer unit with finger-pull fronts, sized to standard IKEA units or any width you need, then take the cut list and sheet layout to the saw."
        actions={(
          <>
          <TutorialButton tour="drawers" />
          <Button variant="ghost" onClick={() => { setForm(convertForm(DEFAULT_FORM, units)); setSource(null); }}>
            <RotateCcw size={16} aria-hidden="true" /> Reset design
          </Button>
          </>
        )}
      />

      <section className="drawer-templates" aria-labelledby="drawer-templates-title">
        <h2 id="drawer-templates-title">Start from</h2>
        <ul>
          {DRAWER_TEMPLATES.map((t, i) => {
            const thumb = templatePlans[i];
            return (
              <li key={t.id}>
                <button type="button" className="drawer-template" onClick={() => applyTemplate(t)} title={t.description}>
                  {thumb && <img src={drawerThumbnailDataUrl(thumb.plan, thumb.pull, 72)} alt="" />}
                  <span>
                    <strong>{t.name}</strong>
                    <small>{thumb ? `${fmt(thumb.plan.overallWidth)} × ${fmt(thumb.plan.overallHeight)}` : ''}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {library.length > 0 && (
          <>
            <h2>Saved designs</h2>
            <ul>
              {library.map(entry => {
                const saved = readSavedDrawerDesign(entry.design);
                const p = saved ? buildDrawerPlan(saved.config) : null;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      className="drawer-template"
                      disabled={!saved}
                      onClick={() => saved && applyDesign(drawerDesignToFields(saved), { kind: 'library', id: entry.id, title: entry.name })}
                    >
                      {p && saved && p.errors.length === 0 && <img src={drawerThumbnailDataUrl(p, saved.config.pull, 72, saved.config.finish?.front)} alt="" />}
                      <span>
                        <strong>{entry.name}</strong>
                        <small>{p ? `${formatLength(p.overallWidth, saved!.units)} × ${formatLength(p.overallHeight, saved!.units)}` : 'Can’t be read'}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </section>

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
        ) : naming ? (
          <form className="shelf-design-bar-form" onSubmit={e => { e.preventDefault(); void saveDesignAsNew(); }}>
            <input value={designName} onChange={e => setDesignName(e.target.value)} placeholder="Name this design" aria-label="Design name" maxLength={120} autoFocus />
            <Button type="submit" variant="primary" disabled={saving || !config}>
              {saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Save
            </Button>
            <Button variant="ghost" onClick={() => { setNaming(false); setSaveMessage(null); }}>Cancel</Button>
          </form>
        ) : (
          <span className="shelf-design-bar-actions">
            {openDesign && (
              <Button variant="primary" onClick={() => void saveDesignChanges()} disabled={saving || !dirty || !config}>
                {saving ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Save size={16} aria-hidden="true" />} Save
              </Button>
            )}
            <Button
              variant={openDesign ? 'ghost' : 'primary'}
              onClick={() => { setNaming(true); setDesignName(openDesign ? `${openDesign.title} copy` : ''); setSaveMessage(null); }}
              disabled={!config || !valid}
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
            {source.kind === 'template' && (
              <>Started from {source.title}.{source.title.startsWith('ALEX') ? ' Sizes come from IKEA’s listing and are approximate — measure one if you’re matching it.' : ''}</>
            )}
          </span>
          <span className="shelf-source-actions">
            {source.kind === 'project' && (
              <Button variant="ghost" onClick={() => setAddingToProject(true)}>
                <FolderPlus size={16} aria-hidden="true" /> Save back to project
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

      <div className="shelf-layout">
        <section className="shelf-config" aria-labelledby="drawer-config-title">
          <h2 id="drawer-config-title" className="sr-only">Design</h2>

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
              label="Case and front plywood"
              value={form.thickness}
              error={fieldErrors.thickness}
              hint="Sides, top, bottom and the drawer fronts."
              onChange={thickness => update({ thickness })}
            />
            {thicknessChips('thickness', THICKNESS_PRESETS[units])}
            <div className="shelf-field-grid">
              <LengthField unit={units} label="Drawer box plywood" value={form.boxThickness} error={fieldErrors.boxThickness} onChange={boxThickness => update({ boxThickness })} />
              <LengthField unit={units} label="Drawer bottoms" value={form.bottomThickness} error={fieldErrors.bottomThickness} onChange={bottomThickness => update({ bottomThickness })} />
              <LengthField unit={units} label="Case back" value={form.backThickness} error={fieldErrors.backThickness} onChange={backThickness => update({ backThickness })} />
            </div>
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-size">
            <legend>Size</legend>
            <div className="shelf-field-grid">
              <LengthField
                unit={units}
                label="Overall width"
                value={form.width}
                error={fieldErrors.width}
                hint={plan ? `Drawer boxes ${fmt(plan.interiorWidth - 1)} wide` : undefined}
                onChange={width => update({ width })}
              />
              <LengthField
                unit={units}
                label="Overall depth"
                value={form.depth}
                error={fieldErrors.depth}
                hint={plan && plan.slideLength > 0 ? `Fits ${fmt(plan.slideLength)} slides` : 'Fronts included'}
                onChange={depth => update({ depth })}
              />
              {form.heightMode === 'overall' && !form.desk && (
                <LengthField
                  unit={units}
                  label="Overall height"
                  value={form.height}
                  error={fieldErrors.height}
                  hint={plan && plan.baseHeight > 0 ? `Includes the ${fmt(plan.baseHeight)} ${form.base === 'feet' ? 'feet' : form.base === 'casters' ? 'casters' : form.base === 'flush' ? 'plinth' : 'toe kick'}` : undefined}
                  onChange={height => update({ height })}
                />
              )}
            </div>
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-drawers">
            <legend>Drawers</legend>
            <div className="shelf-height-mode">
              <SegmentedControl label="Set the height by" value={form.heightMode} options={HEIGHT_MODE_OPTIONS} onChange={setHeightMode} />
              <small>
                {form.heightMode === 'overall'
                  ? 'Equal fronts share the overall height.'
                  : `Type each front’s height. The overall height adds up the fronts, a ${fmt(config?.gap ?? 0.125)} gap per drawer and the base${plan ? ` — ${fmt(plan.overallHeight)} now` : ''}.`}
              </small>
            </div>
            <div className="shelf-field-grid">
              <div className="form-field">
                <span className="form-field-label" id="column-count-label">Columns</span>
                <Stepper labelledBy="column-count-label" value={form.columns} min={1} max={MAX_COLUMNS} onChange={setColumns} noun="column" />
              </div>
              {form.columns === 1 && (
                <div className="form-field">
                  <span className="form-field-label" id="drawer-count-label">Number of drawers</span>
                  <Stepper labelledBy="drawer-count-label" value={form.drawers} min={1} max={MAX_DRAWERS} onChange={setDrawers} noun="drawer" />
                </div>
              )}
              <LengthField
                unit={units}
                label="Gap between fronts"
                value={form.gap}
                error={fieldErrors.gap}
                hint="Half of it shows at the top, bottom and sides."
                onChange={gap => update({ gap })}
              />
            </div>
            {form.columns > 1 && (
              <>
                <div className="shelf-height-mode">
                  <span className="form-field-label">Column widths</span>
                  <SegmentedControl label="Column widths" value={form.columnWidthMode} options={COLUMN_WIDTH_OPTIONS} onChange={columnWidthMode => update({ columnWidthMode })} />
                  <small>Partitions between columns are {fmt(config?.thickness ?? 0.75)} case plywood; the slides screw to both faces.</small>
                </div>
                <div className="drawer-columns">
                  {form.columnDrawers.map((count, c) => {
                    const layout = plan?.columns[c];
                    const last = c === form.columns - 1;
                    return (
                      <div className="shelf-bay-card" key={c}>
                        <div className="shelf-bay-card-head">
                          <strong id={`column-${c}-label`}>Column {c + 1}</strong>
                          {layout && <small>{fmt(layout.width)} opening</small>}
                        </div>
                        <div className="shelf-bay-card-controls">
                          <div className="form-field">
                            <span className="form-field-label" id={`column-${c}-drawers`}>Drawers</span>
                            <Stepper labelledBy={`column-${c}-drawers`} value={count} min={1} max={MAX_DRAWERS} onChange={v => setColumnDrawers(c, v)} noun="drawer" />
                          </div>
                          {form.columnWidthMode === 'custom' && !last && (
                            <LengthField unit={units} label="Opening width" value={form.columnWidths[c] ?? ''} error={fieldErrors[`columnWidths.${c}`]} onChange={v => setColumnWidth(c, v)} />
                          )}
                          {form.columnWidthMode === 'custom' && last && <small>Takes the rest{layout ? `: ${fmt(layout.width)}` : ''}.</small>}
                        </div>
                        {form.heightMode === 'fronts' && (
                          <>
                            <div className="drawer-fronts">
                              {(form.columnFronts[c] ?? []).map((value, i) => (
                                <LengthField
                                  key={i}
                                  unit={units}
                                  label={`Drawer ${i + 1}${i === 0 ? ' (top)' : i === count - 1 ? ' (bottom)' : ''}`}
                                  value={value}
                                  error={fieldErrors[`columnFronts.${c}.${i}`]}
                                  onChange={v => setColumnFront(c, i, v)}
                                />
                              ))}
                            </div>
                            <span className="shelf-source-actions">
                              <Button variant="ghost" onClick={() => spreadFronts('equal', c)} disabled={!plan}>Make equal</Button>
                            </span>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
                {form.heightMode === 'fronts' && (
                  <span className="shelf-source-actions">
                    <Button variant="ghost" onClick={() => spreadFronts('equal')} disabled={!plan}>Make all equal</Button>
                    <Button variant="ghost" onClick={() => spreadFronts('graduated')} disabled={!plan}>Graduate every column</Button>
                  </span>
                )}
              </>
            )}
            {form.heightMode === 'fronts' && form.columns === 1 && (
              <>
                <div className="drawer-fronts">
                  {form.frontHeights.map((value, i) => (
                    <LengthField
                      key={i}
                      unit={units}
                      label={`Drawer ${i + 1}${i === 0 ? ' (top)' : i === form.drawers - 1 ? ' (bottom)' : ''}`}
                      value={value}
                      error={fieldErrors[`frontHeights.${i}`]}
                      hint={plan?.drawers[i] ? (plan.drawers[i].open ? 'Open cubby' : `Box ${fmt(plan.drawers[i].box.height)} tall`) : undefined}
                      onChange={v => setFront(i, v)}
                    />
                  ))}
                </div>
                <span className="shelf-source-actions">
                  <Button variant="ghost" onClick={() => spreadFronts('equal')} disabled={!plan}>Make equal</Button>
                  <Button variant="ghost" onClick={() => spreadFronts('graduated')} disabled={!plan}>Graduate toward the floor</Button>
                </span>
              </>
            )}
            {form.heightMode === 'overall' && plan && plan.drawers.length > 0 && plan.columns.length === 1 && (
              <p className="shelf-group-note">
                Fronts {fmt(plan.drawers[0].front.height)} tall; boxes {[...new Set(plan.drawers.filter(d => !d.open).map(d => fmt(d.box.height)))].join(' and ')}.
              </p>
            )}
            <span className="shelf-source-actions">
              <Button variant="ghost" onClick={shallowTopDrawer} disabled={!plan || (form.columns > 1 ? form.columnDrawers.some(n => n < 2) : form.drawers < 2)}>
                Shallow top drawer{form.columns > 1 ? 's' : ''} (pencil tray)
              </Button>
            </span>
            <label className="form-field">
              <span className="form-field-label">What goes in them (for the load check)</span>
              <select value={form.load} onChange={e => update({ load: e.target.value as FormState['load'] })}>
                {(Object.keys(DRAWER_LOADS) as (keyof typeof DRAWER_LOADS)[]).map(key => (
                  <option key={key} value={key}>{DRAWER_LOADS[key].label}</option>
                ))}
              </select>
              {plan && plan.loads.length > 0 && (
                <small>
                  Full, a drawer holds about {loadRange(plan.loads.map(l => l.pounds))} lb — slides are rated {SLIDE_CAPACITY_LB} lb a pair.
                  {' '}Bottoms sag {plan.loads.every(l => !l.sags) ? `at most ${Math.max(...plan.loads.map(l => l.sag)).toFixed(3)}″ — fine` : 'too much in some drawers (see below)'}.
                </small>
              )}
            </label>
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-finger-pull">
            <legend>Finger pull</legend>
            <div className="shelf-height-mode">
              <span className="form-field-label">Fronts</span>
              <SegmentedControl label="Front style" value={form.frontStyle} options={FRONT_STYLE_OPTIONS} onChange={frontStyle => update({ frontStyle })} />
              <small>
                {form.frontStyle === 'inset'
                  ? 'Inset: the fronts sit inside the case, flush with its edges, and the case shows around them — the ALEX look.'
                  : 'Full overlay: the fronts cover the case edges, with only the gaps showing.'}
              </small>
            </div>
            <Toggle
              label="Built-in pull"
              checked={form.pullEnabled}
              hint="The ALEX look: no handles, just a cut-out to hook a finger behind the front. The box front behind gets a matching notch."
              onChange={pullEnabled => update({ pullEnabled })}
            />
            {form.pullEnabled && (
              <>
                <label className="form-field">
                  <span className="form-field-label">Style</span>
                  <select value={form.pullShape} onChange={e => update({ pullShape: e.target.value as FormState['pullShape'] })}>
                    {PULL_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                  <small>{PULL_OPTIONS.find(o => o.value === form.pullShape)?.hint}</small>
                </label>
                <div className="shelf-field-grid">
                  {form.pullShape !== 'wide' && (
                    <LengthField unit={units} label={form.pullShape === 'handhole' ? 'Hole width' : 'Pull width'} value={form.pullWidth} error={fieldErrors.pullWidth} onChange={pullWidth => update({ pullWidth })} />
                  )}
                  <LengthField
                    unit={units}
                    label={form.pullShape === 'handhole' ? 'Hole height' : 'Pull depth'}
                    value={form.pullDepth}
                    error={fieldErrors.pullDepth}
                    hint={form.pullShape === 'handhole' ? `Its top is ${fmt(3 / 4)} below the top edge.` : 'Down from the top edge.'}
                    onChange={pullDepth => update({ pullDepth })}
                  />
                </div>
              </>
            )}
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-inside-the-drawers">
            <legend>Inside the drawers</legend>
            <p className="shelf-group-note">An egg-crate divider grid, a tray of notched ribs that holds markers lying front to back, or a printed Gridfinity baseplate for modular bins.</p>
            <div className="drawer-inserts">
              {form.insertKinds.slice(0, form.drawers).map((kind, i) => {
                const layout = plan?.inserts[i];
                return (
                  <div className="drawer-insert-row" key={i}>
                    <span className="form-field-label" id={`insert-${i}`}>{drawerLabel(i)}</span>
                    <select aria-labelledby={`insert-${i}`} value={kind} onChange={e => setInsert(i, { insertKinds: e.target.value as FormState['insertKinds'][number] })}>
                      <option value="none">Empty</option>
                      <option value="grid">Divider grid</option>
                      <option value="markers">Marker tray</option>
                      <option value="gridfinity">Gridfinity baseplate</option>
                      <option value="tools">Tool shadow board</option>
                      <option value="cubby">Open cubby (no drawer)</option>
                    </select>
                    {kind === 'grid' && (
                      <span className="drawer-insert-grid">
                        <Stepper labelledBy={`insert-${i}`} value={form.gridColumns[i] ?? 2} min={1} max={12} onChange={v => setInsert(i, { gridColumns: Math.max(1, Math.min(12, v)) })} noun="column" />
                        <span aria-hidden="true">×</span>
                        <Stepper labelledBy={`insert-${i}`} value={form.gridRows[i] ?? 2} min={1} max={12} onChange={v => setInsert(i, { gridRows: Math.max(1, Math.min(12, v)) })} noun="row" />
                      </span>
                    )}
                    {kind === 'tools' && (
                      <ToolInsertEditor
                        tools={form.toolPockets[i] ?? []}
                        onChange={tools => setForm(prev => ({ ...prev, toolPockets: prev.toolPockets.map((v, k) => (k === i ? tools : v)) }))}
                        board={layout?.toolBoard}
                        clearance={parseLength(form.toolClearance, units) ?? 1 / 32}
                        units={units}
                        label={drawerLabel(i)}
                      />
                    )}
                    {kind === 'gridfinity' && layout?.gridfinity && !layout.gridfinity.error && (
                      <GridfinityPlanner
                        layout={layout.gridfinity}
                        packing={layout.binPacking}
                        bins={form.gridfinityBins[i] ?? []}
                        onChange={bins => setForm(prev => ({ ...prev, gridfinityBins: prev.gridfinityBins.map((v, k) => (k === i ? bins : v)) }))}
                        label={drawerLabel(i)}
                      />
                    )}
                    {layout && !layout.error && (
                      <small className="is-muted">
                        {kind === 'grid' ? `${layout.cells} compartment${layout.cells === 1 ? '' : 's'}`
                          : kind === 'gridfinity' && layout.gridfinity
                            ? `${layout.gridfinity.columns} × ${layout.gridfinity.rows} grid · bins up to ${layout.gridfinity.maxUnitsWithLip}u with a lip (${layout.gridfinity.maxUnits}u without)`
                            : `Holds ${layout.capacity} marker${layout.capacity === 1 ? '' : 's'}`}
                      </small>
                    )}
                  </div>
                );
              })}
            </div>
            <span className="shelf-source-actions">
              <Button variant="ghost" onClick={() => copyInsertToAll()} disabled={form.insertKinds[0] === undefined}>Use drawer 1’s for all</Button>
              <Button variant="ghost" onClick={() => update({ insertKinds: form.insertKinds.map(() => 'none') })}>Clear all</Button>
            </span>
            {form.insertKinds.slice(0, form.drawers).includes('tools') && (
              <div className="shelf-field-grid">
                <LengthField unit={units} label="Shadow board plywood" value={form.toolBoardThickness} error={fieldErrors.toolBoardThickness} onChange={toolBoardThickness => update({ toolBoardThickness })} />
                <LengthField unit={units} label="Pocket depth" value={form.toolPocketDepth} error={fieldErrors.toolPocketDepth} onChange={toolPocketDepth => update({ toolPocketDepth })} />
                <LengthField unit={units} label="Clearance around tools" value={form.toolClearance} error={fieldErrors.toolClearance} hint="Applied when you import an outline." onChange={toolClearance => update({ toolClearance })} />
                <Toggle label="Finger holes" checked={form.toolFingerHoles} hint="A round scoop beside each pocket to lift the tool out." onChange={toolFingerHoles => update({ toolFingerHoles })} />
              </div>
            )}
            {form.insertKinds.slice(0, form.drawers).includes('gridfinity') && (
              <label className="form-field">
                <span className="form-field-label">Printer for the baseplates</span>
                <select value={form.gridfinityBed} onChange={e => update({ gridfinityBed: e.target.value })}>
                  {PRINTER_BEDS.map(b => <option key={b.mm} value={String(b.mm)}>{b.label}</option>)}
                </select>
                <small>Baseplates are split into tiles that fit the bed; download the STLs in the CNC section. Bins are standard 42 mm Gridfinity, heights in 7 mm units.</small>
              </label>
            )}
            {form.insertKinds.slice(0, form.drawers).some(k => k === 'grid' || k === 'markers') && (
              <LengthField unit={units} label="Divider and rib plywood" value={form.insertThickness} error={fieldErrors.insertThickness} onChange={insertThickness => update({ insertThickness })} />
            )}
            {form.insertKinds.slice(0, form.drawers).includes('markers') && (
              <>
                <label className="form-field">
                  <span className="form-field-label">Marker size</span>
                  <select
                    value=""
                    onChange={e => {
                      const preset = MARKER_PRESETS.find(p => p.id === e.target.value);
                      if (preset) update({ markerDiameter: lengthToField(preset.diameter, units), markerLength: lengthToField(preset.length, units) });
                    }}
                  >
                    <option value="">Fill from a typical size…</option>
                    {MARKER_PRESETS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  <small>Brands vary — measure one of yours, at its widest (usually the cap).</small>
                </label>
                <div className="shelf-field-grid">
                  <LengthField unit={units} label="Marker diameter" value={form.markerDiameter} error={fieldErrors.markerDiameter} onChange={markerDiameter => update({ markerDiameter })} />
                  <LengthField unit={units} label="Marker length" value={form.markerLength} error={fieldErrors.markerLength} onChange={markerLength => update({ markerLength })} />
                  <LengthField unit={units} label="Space between" value={form.markerSpacing} error={fieldErrors.markerSpacing} onChange={markerSpacing => update({ markerSpacing })} />
                </div>
              </>
            )}
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-desk">
            <legend>Desk</legend>
            <Toggle
              label="Put the units under a desk top"
              checked={form.desk}
              hint="Like a desk on two ALEX units: a plywood top on one unit at each end, or one unit at one end. The units are sized to fit under it."
              onChange={desk => update({ desk })}
            />
            {form.desk && (
              <>
                <SegmentedControl label="Units" value={form.deskLayout} options={DESK_LAYOUT_OPTIONS} onChange={deskLayout => update({ deskLayout })} />
                <div className="shelf-field-grid">
                  <LengthField unit={units} label="Desk width" value={form.deskWidth} error={fieldErrors.deskWidth}
                    hint={plan?.desk ? `${fmt(plan.desk.knee)} knee space` : undefined} onChange={deskWidth => update({ deskWidth })} />
                  <LengthField unit={units} label="Desk height" value={form.deskHeight} error={fieldErrors.deskHeight}
                    hint={plan?.desk ? `Units ${fmt(plan.desk.height - plan.desk.topThickness)} tall` : 'Floor to the top; 29–30″ is typical.'} onChange={deskHeight => update({ deskHeight })} />
                  <LengthField unit={units} label="Desk depth" value={form.deskDepth} error={fieldErrors.deskDepth} onChange={deskDepth => update({ deskDepth })} />
                </div>
                <SegmentedControl label="Top" value={String(form.deskTopLayers) as '1' | '2'} options={TOP_LAYER_OPTIONS} onChange={v => update({ deskTopLayers: v === '1' ? 1 : 2 })} />
                {form.heightMode === 'fronts' && (
                  <small>With “Each front”, the fronts must add up to the space under the top — use “Make equal” to fit them.</small>
                )}
              </>
            )}
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-slides">
            <legend>Slides</legend>
            <label className="form-field">
              <span className="form-field-label">LONTAN slide length</span>
              <select value={form.slideLength} onChange={e => update({ slideLength: e.target.value })}>
                <option value="auto">Longest that fits{plan && plan.slideLength > 0 && form.slideLength === 'auto' ? ` (${fmt(plan.slideLength)})` : ''}</option>
                {SLIDE_LENGTHS.map(l => <option key={l} value={String(l)}>{fmt(l)}</option>)}
              </select>
              <small>Soft-close, full extension, side mount: {fmt(1 / 2)} each side, {SLIDE_CAPACITY_LB} lb a pair. The drawer box is as deep as the slide.</small>
            </label>
            <Toggle
              label="Different lengths per drawer"
              checked={perDrawerSlides}
              hint="A shorter slide makes a shallower box — handy for a pencil drawer, or one that clears something at the back."
              onChange={on => { setPerDrawerSlides(on); if (!on) update({ drawerSlides: form.drawerSlides.map(() => '') }); }}
            />
            {perDrawerSlides && plan && (
              <div className="drawer-inserts">
                {form.drawerSlides.slice(0, form.drawers).map((value, i) => (
                  <div className="drawer-insert-row" key={i}>
                    <span className="form-field-label" id={`slide-${i}`}>{drawerLabel(i)}</span>
                    <select aria-labelledby={`slide-${i}`} value={value} onChange={e => setDrawerSlide(i, e.target.value)}>
                      <option value="">Same as the rest ({fmt(plan.slideLength)})</option>
                      {SLIDE_LENGTHS.filter(l => l < plan.slideLength).map(l => <option key={l} value={String(l)}>{fmt(l)}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-base-mounting">
            <legend>Base &amp; mounting</legend>
            <SegmentedControl
              label="Mounting"
              value={form.mount}
              options={MOUNT_OPTIONS}
              onChange={mount => update({ mount, mountHeight: form.mount === mount ? form.mountHeight : lengthToField(mount === 'under-desk' ? 27.5 : 30, units) })}
            />
            {form.mount === 'wall' && (
              <div className="shelf-field-grid">
                <LengthField unit={units} label="Bottom above the floor" value={form.mountHeight} error={fieldErrors.mountHeight} hint="Where it hangs, for the 3D view and the hanging step." onChange={mountHeight => update({ mountHeight })} />
                <LengthField unit={units} label="Cleat height" value={form.cleatHeight} error={fieldErrors.cleatHeight} hint="The back moves forward by the cleat’s thickness; the sides hide it." onChange={cleatHeight => update({ cleatHeight })} />
              </div>
            )}
            {form.mount === 'under-desk' && (
              <LengthField unit={units} label="Desk underside above the floor" value={form.mountHeight} error={fieldErrors.mountHeight} hint="It’s screwed up through its top into the desk." onChange={mountHeight => update({ mountHeight })} />
            )}
            {form.mount === 'floor' && (
              <label className="form-field">
                <span className="form-field-label">Base</span>
                <select value={form.base} onChange={e => update({ base: e.target.value as DrawerBase })}>
                  {(Object.keys(BASE_LABELS) as DrawerBase[]).map(key => <option key={key} value={key}>{BASE_LABELS[key]}</option>)}
                </select>
                <small>{BASE_HINTS[form.base]}</small>
              </label>
            )}
            {form.mount === 'floor' && isKickBase(form.base) && (
              <div className="shelf-field-grid">
                <LengthField unit={units} label={form.base === 'flush' ? 'Plinth height' : 'Toe-kick height'} value={form.kickHeight} error={fieldErrors.kickHeight} hint="Floor to the underside of the case; 4″ is typical." onChange={kickHeight => update({ kickHeight })} />
                {form.base !== 'flush' && (
                  <LengthField unit={units} label="Kick setback" value={form.kickSetback} error={fieldErrors.kickSetback} hint="How far the kick board sits behind the case front." onChange={kickSetback => update({ kickSetback })} />
                )}
                {form.base === 'flush' && (
                  <>
                    <LengthField unit={units} label="Baseboard height" value={form.baseboardHeight} error={fieldErrors.baseboardHeight} placeholder="Auto" hint={plan?.base?.baseboard ? `Leave blank for ${fmt(plan.base.baseboard.height)}: just over the plinth joint, clear of the fronts.` : 'Leave blank to lap just over the plinth joint.'} onChange={baseboardHeight => update({ baseboardHeight })} />
                    <LengthField unit={units} label="Baseboard thickness" value={form.baseboardThickness} error={fieldErrors.baseboardThickness} onChange={baseboardThickness => update({ baseboardThickness })} />
                  </>
                )}
              </div>
            )}
            {form.mount === 'floor' && (form.base === 'plinth' || form.base === 'flush') && (
              <div className="shelf-field-grid">
                <Toggle label="Left end shows" checked={form.exposedLeft} hint={form.base === 'flush' ? 'The baseboard wraps around it.' : 'The plinth sets back on this side too.'} onChange={exposedLeft => update({ exposedLeft })} />
                <Toggle label="Right end shows" checked={form.exposedRight} hint="Off when it’s against a wall or another cabinet." onChange={exposedRight => update({ exposedRight })} />
              </div>
            )}
            {form.mount === 'floor' && form.base === 'feet' && (
              <LengthField
                unit={units}
                label="Gap under the case"
                value={form.footHeight}
                error={fieldErrors.footHeight}
                onChange={footHeight => update({ footHeight })}
              />
            )}
            {form.mount === 'floor' && form.base === 'casters' && (
              <LengthField
                unit={units}
                label="Caster height"
                value={form.casterHeight}
                error={fieldErrors.casterHeight}
                hint="Mounted height, floor to the top of the plate."
                onChange={casterHeight => update({ casterHeight })}
              />
            )}
            {plan && plan.supports > 0 && (
              <p className="shelf-group-note">{plan.supports} {form.base === 'feet' ? 'feet' : 'casters'}{plan.supports === 6 ? ' — a middle pair, since the unit is wide' : ''}.</p>
            )}
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-finish">
            <legend>Finish</legend>
            {([['finishFront', 'Drawer fronts'], ['finishCase', 'Case and top']] as const).map(([key, label]) => (
              <div className="shelf-height-mode" key={key}>
                <span className="form-field-label">{label}</span>
                <div className="drawer-swatches" role="group" aria-label={`${label} colour`}>
                  {FINISH_COLORS.map(c => (
                    <button
                      key={c.id}
                      type="button"
                      className="drawer-swatch"
                      style={{ background: c.hex }}
                      aria-pressed={form[key].toLowerCase() === c.hex}
                      aria-label={c.label}
                      title={c.label}
                      onClick={() => update({ [key]: c.hex })}
                    />
                  ))}
                  <label className="drawer-swatch is-custom" title="Any colour">
                    <input type="color" value={form[key]} onChange={e => update({ [key]: e.target.value })} aria-label={`Custom ${label.toLowerCase()} colour`} />
                  </label>
                </div>
              </div>
            ))}
            <p className="shelf-group-note">For the 3D view and build guide; the cost estimate counts paint or clear finish either way.</p>
          </fieldset>

          <fieldset className="shelf-group" data-tour="fs-edges">
            <legend>Edges</legend>
            <Toggle
              label="Edge banding"
              checked={form.edgeBanding}
              hint="Bands the case front edges and the straight edges of each drawer front; parts are cut smaller so they finish at size. Sand and finish the pull notch instead."
              onChange={edgeBanding => update({ edgeBanding })}
            />
            {form.edgeBanding && (
              <div className="shelf-chips" role="group" aria-label="Edge banding thickness">
                {BANDING_PRESETS.map(p => (
                  <button key={p.value} type="button" className="shelf-chip" aria-pressed={form.bandingThickness === p.value} onClick={() => update({ bandingThickness: p.value })}>
                    {p.label}
                  </button>
                ))}
              </div>
            )}
          </fieldset>
        </section>

        <section className="shelf-preview" aria-labelledby="drawer-preview-title">
          <header className="shelf-preview-head">
            <h2 id="drawer-preview-title">Preview</h2>
            <SegmentedControl label="Preview mode" value={view} options={VIEW_OPTIONS} onChange={setView} />
          </header>
          {plan && config ? (
            <>
              <dl className="shelf-summary">
                {plan.desk ? (
                  <>
                    <Stat label="Desk" value={`${fmt(plan.desk.width)} × ${fmt(plan.desk.height)}`} />
                    <Stat label="Units" value={`${plan.unitCount} × ${fmt(plan.overallWidth)}`} />
                    <Stat label="Knee space" value={fmt(plan.desk.knee)} />
                  </>
                ) : (
                  <>
                    <Stat label="Overall width" value={fmt(plan.overallWidth)} />
                    <Stat label="Overall height" value={fmt(plan.overallHeight)} />
                    <Stat label="Overall depth" value={fmt(plan.overallDepth)} />
                  </>
                )}
                <Stat
                  label="Slides"
                  value={plan.slideLength > 0
                    ? [...new Set(plan.drawers.filter(d => !d.open).map(d => d.box.depth))].sort((a, b) => b - a)
                      .map(l => `${plan.drawers.filter(d => !d.open && d.box.depth === l).length * plan.unitCount} × ${fmt(l)}`).join(' + ') || '—'
                    : '—'}
                  accent
                />
              </dl>
              {view === '3d' && valid ? (
                <Suspense fallback={<div className="shelf-viewer"><p className="shelf-viewer-status">Loading 3D view…</p></div>}>
                  <ShelfViewer3D
                    solids={solids}
                    width={plan.desk ? plan.desk.width : plan.overallWidth}
                    height={plan.desk ? plan.desk.height : plan.overallHeight + plan.lift + (plan.mount === 'under-desk' ? 1.5 : 0)}
                    depth={plan.desk ? plan.desk.depth : plan.caseDepth}
                    wallMounted={plan.mount === 'wall'}
                    colors={finishColors(config.finish)}
                    label={plan.desk
                      ? `3D view of a ${fmt(plan.desk.width)} desk on ${plan.unitCount} drawer unit${plan.unitCount === 1 ? '' : 's'}`
                      : `3D view of a ${fmt(plan.overallWidth)} wide, ${fmt(plan.overallHeight)} tall drawer unit with ${plan.drawers.length} drawers`}
                  />
                </Suspense>
              ) : (
                <DrawerElevation plan={plan} config={config} fmt={fmt} />
              )}
              <DrawerSection plan={plan} config={config} fmt={fmt} />
            </>
          ) : (
            <p className="shelf-placeholder">Fix the highlighted measurements to see the drawing.</p>
          )}
        </section>
      </div>

      {plan && plan.errors.length > 0 && (
        <div className="inline-error shelf-banner" role="alert">
          <AlertCircle size={16} aria-hidden="true" />
          <ul className="drawer-error-list">{plan.errors.map(e => <li key={e}>{e}</li>)}</ul>
        </div>
      )}
      {plan && plan.warnings.length > 0 && (
        <ul className="shelf-warnings" role="status">
          {plan.warnings.map(w => (
            <li key={w}><AlertTriangle size={16} aria-hidden="true" /> {w}</li>
          ))}
        </ul>
      )}

      {plan && config && valid && (
        <>
          <section className="shelf-section" aria-labelledby="drawer-cutlist-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="drawer-cutlist-title">Cut list</h2>
                <p>
                  {fmt(config.thickness)} case and fronts · {fmt(config.boxThickness)} boxes · {fmt(config.bottomThickness)} bottoms · {fmt(config.backThickness)} back
                  {plan.banding ? ` · banded parts cut ${fmt(plan.banding.thickness)} short per edge` : ''}
                </p>
              </div>
              <div className="shelf-section-actions">
                <Button
                  variant={addingToProject ? 'secondary' : 'ghost'}
                  onClick={() => setAddingToProject(open => !open)}
                  aria-expanded={addingToProject}
                  aria-controls="drawer-add-project"
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
              <div id="drawer-add-project">
                <DrawerAddToProject
                  plan={plan}
                  config={config}
                  units={units}
                  heightMode={form.heightMode}
                  initialProjectId={source?.kind === 'project' ? source.id : undefined}
                  costLines={estimate?.estimate.lines}
                  onClose={() => setAddingToProject(false)}
                />
              </div>
            )}
          </section>

          <section className="shelf-section" aria-labelledby="drawer-order-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="drawer-order-title">Cutting order</h2>
                <p>The cut list as saw setups — every cut at one fence or stop setting before you move it.</p>
              </div>
            </header>
            <CuttingOrder parts={sheetParts(plan.parts)} units={units} />
          </section>

          <section className="shelf-section" aria-labelledby="drawer-export-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="drawer-export-title">CNC &amp; Shaper export</h2>
                <p>Cut files for every part: fronts with the finger-pull notch, box rabbets and bottom grooves, the back rabbet, and slide lines.</p>
              </div>
            </header>
            <DrawerExport plan={plan} config={config} units={units} />
          </section>

          {estimate && (
            <>
              <section className="shelf-section" aria-labelledby="drawer-hardware-title">
                <header className="shelf-section-head">
                  <div>
                    <h2 id="drawer-hardware-title">Hardware</h2>
                    <p>Slides, feet or casters, and everything else besides plywood, counted from this design.</p>
                  </div>
                </header>
                <HardwareTable items={estimate.hardware} links={links} onLink={setLink} />
              </section>

              <section className="shelf-section" aria-labelledby="drawer-cost-title">
                <header className="shelf-section-head">
                  <div>
                    <h2 id="drawer-cost-title">Cost estimate</h2>
                    <p>About {money(estimate.estimate.total)} with the optional items; {money(estimate.estimate.required)} without.</p>
                  </div>
                </header>
                <CostTable
                  estimate={estimate.estimate}
                  prices={estimate.prices}
                  overridden={estimate.overridden}
                  onPrice={estimate.setPrice}
                  onReset={estimate.resetPrices}
                  labels={DRAWER_PRICE_LABELS}
                />
              </section>
            </>
          )}

          <section className="shelf-section" aria-labelledby="drawer-marks-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="drawer-marks-title">Slide positions</h2>
                <p>
                  Bottom edge of each slide, measured up from the bottom edge of the case sides. Mark both sides from one story stick,
                  with each slide flush to the front edge.
                </p>
              </div>
            </header>
            <ul className="shelf-marks">
              {plan.drawers.filter(d => !d.open).map(d => (
                <li key={d.index}>
                  <strong>Drawer {d.index + 1}</strong>
                  <span className="is-muted">front {fmt(d.front.height)} · box {fmt(d.box.height)}</span>
                  <span className="shelf-mark-values">{fmt(d.slideMark)}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="shelf-section" aria-labelledby="drawer-guide-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="drawer-guide-title">Build guide</h2>
                <p>Step-by-step instructions with an illustration of every stage, using this design’s measurements.</p>
              </div>
              <div className="shelf-section-actions">
                <Button variant="ghost" onClick={() => void printPacket()} disabled={packetBusy}>
                  {packetBusy ? <Loader2 size={16} className="spin" aria-hidden="true" /> : <Printer size={16} aria-hidden="true" />} Print build packet
                </Button>
                <Button variant={showGuide ? 'secondary' : 'primary'} onClick={() => setShowGuide(open => !open)} aria-expanded={showGuide} aria-controls="drawer-guide">
                  <BookOpen size={16} aria-hidden="true" /> {showGuide ? 'Hide guide' : 'Show build guide'}
                </Button>
              </div>
            </header>
            {showGuide && (
              <div id="drawer-guide">
                <DrawerBuildGuide
                  plan={plan}
                  config={config}
                  units={units}
                  title={source?.title}
                  progress={{ done: guideDone, onChange: saveGuideDone, status: source?.kind === 'project' ? 'saved in this browser — open the project to track it there' : 'saved in this browser' }}
                />
              </div>
            )}
          </section>

          <section className="shelf-section shelf-optimizer" aria-labelledby="drawer-optimizer-title">
            <header className="shelf-section-head">
              <div>
                <h2 id="drawer-optimizer-title">Sheet layout</h2>
                <p>There’s a sheet row for each plywood thickness — fill in the sizes and generate a plan. Regenerate after changing the design.</p>
              </div>
            </header>
            <CutPlanOptimizer
              cutList={cutList}
              units={units}
              defaultThickness={config.thickness}
              extraThicknesses={[...new Set([config.boxThickness, config.bottomThickness, config.backThickness])].filter(t => Math.abs(t - config.thickness) > 1e-4)}
            />
          </section>
        </>
      )}
    </PageFrame>
  );
}

// ── Drawings ──────────────────────────────────────────────────────────────────

function DrawerElevation({ plan, config, fmt }: { plan: DrawerPlan; config: DrawerConfig; fmt: (inches: number) => string }) {
  const W = plan.overallWidth;
  const H = plan.overallHeight;
  const B = plan.baseHeight;
  const T = config.thickness;
  const bp = plan.base;
  const pad = Math.max(W, H) * 0.12;
  const fs = Math.max(W, H) * 0.03;
  const y = (v: number) => H - v;
  const pull = config.pull.enabled ? config.pull : null;
  return (
    <figure className="shelf-drawing">
      <svg
        viewBox={`${-pad * 0.4} ${-pad * 0.6} ${W + pad * 1.9} ${H + pad * 1.6}`}
        role="img"
        aria-label={`Front elevation, ${fmt(W)} wide by ${fmt(H)} tall with ${plan.drawers.length} drawers`}
      >
        <rect className="shelf-ply" x={0} y={0} width={W} height={H - B} />
        {B > 0 && !bp && (config.base === 'feet'
          ? [config.thickness + 1.5, W - config.thickness - 2.75].map(x => <rect key={x} className="drawer-foot" x={x} y={y(B)} width={1.25} height={B} />)
          : [config.thickness + 1.5, W - config.thickness - 4].map(x => <circle key={x} className="drawer-foot" cx={x + 1.25} cy={H - B / 2} r={B / 2 * 0.9} />))}
        {bp?.kind === 'kick' && (
          <>
            <rect className="drawer-foot" x={T} y={y(B)} width={W - 2 * T} height={B} />
            <rect className="shelf-ply" x={0} y={y(B)} width={T} height={B} />
            <rect className="shelf-ply" x={W - T} y={y(B)} width={T} height={B} />
          </>
        )}
        {bp && bp.kind !== 'kick' && (
          <rect className="drawer-foot" x={bp.sideSetbacks[0]} y={y(B)} width={W - bp.sideSetbacks[0] - bp.sideSetbacks[1]} height={B} />
        )}
        {bp?.baseboard && (() => {
          const bb = bp.baseboard;
          const l = bb.faces.includes('left') ? bb.thickness : 0;
          const r = bb.faces.includes('right') ? bb.thickness : 0;
          return <rect className="shelf-ply drawer-baseboard" x={-l} y={y(bb.height)} width={W + l + r} height={bb.height} />;
        })()}
        {plan.drawers.map(d => {
          const hole = handHole(pull);
          if (d.open) {
            const c = plan.columns[d.column];
            return (
              <g key={d.index}>
                <rect className="drawer-notch" x={c.x} y={y(d.front.y + d.front.height + config.gap / 2)} width={c.width} height={d.front.height + config.gap} />
                {d.shelfY !== null && <rect className="shelf-ply" x={c.x} y={y(d.shelfY + config.thickness)} width={c.width} height={config.thickness} />}
              </g>
            );
          }
          return (
            <g key={d.index}>
              <polygon
                className="drawer-front-shape"
                style={{ fill: config.finish?.front }}
                points={notchedOutline(d.front.x, d.front.y, d.front.width, d.front.height, frontNotch(pull, d.front.width)).map(([px, py]) => `${px},${y(py)}`).join(' ')}
              />
              {hole && (
                <polygon
                  className="drawer-notch"
                  points={stadiumOutline(d.front.x + d.front.width / 2, d.front.y + d.front.height - hole.top, hole.width, hole.height).map(([px, py]) => `${px},${y(py)}`).join(' ')}
                />
              )}
            </g>
          );
        })}
        {plan.drawers.map(d => (
          <DimV key={d.index} y1={y(d.front.y + d.front.height)} y2={y(d.front.y)} x={W + pad * 0.3} fs={fs * 0.75} label={fmt(d.front.height)} />
        ))}
        <DimH x1={0} x2={W} y={H + pad * 0.45} fs={fs} label={fmt(W)} />
        <DimV y1={0} y2={H} x={W + pad * 1.05} fs={fs} label={fmt(H)} />
      </svg>
    </figure>
  );
}

function DrawerSection({ plan, config, fmt }: { plan: DrawerPlan; config: DrawerConfig; fmt: (inches: number) => string }) {
  const T = config.thickness;
  const d = plan.drawers.find(x => !x.open);
  if (!d) return null;
  const depth = plan.overallDepth;
  const Hs = Math.max(d.front.height + T * 2, 6);
  const top = d.front.y + d.front.height;
  const base = top - Hs + T; // local origin for the cropped section
  const yy = (v: number) => Hs - (v - base);
  // Overlay fronts stand in front of the case (x 0–T); inset ones fill the opening's first T.
  const zf = plan.frontInset;
  const x = (z: number) => z + T - zf;
  const pad = depth * 0.12;
  const fs = depth * 0.04;
  const reach = pullReach(config.pull, d.front.width);
  const hole = handHole(config.pull);
  const slide = d.box.depth;
  return (
    <figure className="shelf-drawing is-section">
      <svg viewBox={`${-pad} ${-pad} ${depth + pad * 2} ${Hs + pad * 2.4}`} role="img"
        aria-label={`Side section of the top drawer: ${fmt(slide)} slide, ${fmt(d.box.height)} box behind a ${fmt(d.front.height)} front`}>
        <rect className="shelf-side-outline" x={x(0)} y={yy(plan.overallHeight)} width={plan.caseDepth} height={Hs - yy(plan.overallHeight)} />
        <rect className="shelf-ply" x={x(0)} y={yy(plan.overallHeight)} width={plan.interiorDepth} height={T} />
        <rect className="shelf-ply" x={x(plan.interiorDepth)} y={yy(plan.overallHeight)} width={config.backThickness} height={Hs - yy(plan.overallHeight)} />
        <rect className="drawer-front-shape" x={0} y={yy(top)} width={T} height={d.front.height} />
        {reach > 0 && (hole
          ? <rect className="drawer-notch" x={0} y={yy(top - hole.top)} width={T} height={hole.height} />
          : <rect className="drawer-notch" x={0} y={yy(top)} width={T} height={reach} />)}
        <rect className="shelf-ply is-shelf" x={x(zf)} y={yy(d.box.y + d.box.height)} width={config.boxThickness} height={d.box.height} />
        {d.boxNotchDepth > 0 && <rect className="drawer-notch" x={x(zf)} y={yy(d.box.y + d.box.height)} width={config.boxThickness} height={d.boxNotchDepth} />}
        <rect className="shelf-ply is-shelf" x={x(zf + slide - config.boxThickness)} y={yy(d.box.y + d.box.height)} width={config.boxThickness} height={d.box.height} />
        <rect className="shelf-ply" x={x(zf + config.boxThickness)} y={yy(d.box.y + 0.5 + config.bottomThickness)} width={slide - 2 * config.boxThickness} height={config.bottomThickness} />
        <rect className="drawer-slide" x={x(zf)} y={yy(d.slideY + 45 / 25.4)} width={slide} height={45 / 25.4} />
        <DimH x1={x(zf)} x2={x(zf + slide)} y={Hs + pad * 0.6} fs={fs} label={`Slide ${fmt(slide)}`} />
        <DimH x1={0} x2={depth} y={Hs + pad * 1.5} fs={fs} label={fmt(depth)} />
      </svg>
      <figcaption>Side section through the top drawer{reach > 0 ? ': the box front is notched below the pull so fingers can hook the front' : ''}</figcaption>
    </figure>
  );
}

