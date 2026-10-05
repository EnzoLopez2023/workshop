import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  AlertCircle, AlertTriangle, ArrowLeft, BookOpen, Check, Clipboard, FolderOpen, FolderPlus, Loader2, Printer, RotateCcw, Save,
} from 'lucide-react';
import { Button, PageFrame, PageHeader, SegmentedControl } from '../components/ui';
import { DimH, DimV, LengthField, Stat, Stepper, Toggle } from '../components/builderControls';
import CutPlanOptimizer from '../components/CutPlanOptimizer';
import DrawerExport from '../components/DrawerExport';
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
  SLIDE_CAPACITY_LB,
  SLIDE_LENGTHS,
  drawerDesignToFields,
  readSavedDrawerDesign,
  toSavedDrawerDesign,
  type DrawerConfig,
  type DrawerDesignFields,
  type DrawerPlan,
} from '../lib/drawerUnit';
import { DRAWER_TEMPLATES, drawerThumbnailDataUrl, type DrawerTemplate } from '../lib/drawerTemplates';
import type { CutListItem } from '../types/project';

const ShelfViewer3D = lazy(() => import('../components/ShelfViewer3D'));

const STORAGE_KEY = 'workshop-drawer-builder';
const VIEW_STORAGE_KEY = 'workshop-drawer-builder-view';
/** Which saved design is open (and its saved state), so returning to the page keeps the link. */
const SOURCE_STORAGE_KEY = 'workshop-drawer-builder-source';
/** The design that was in the builder before another was opened over it. */
const PREVIOUS_STORAGE_KEY = 'workshop-drawer-builder-previous';
const MAX_DRAWERS = 12;

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
  pullWidth: '4 3/4',
  pullDepth: '1',
  boxThickness: '1/2',
  bottomThickness: '1/4',
  backThickness: '1/4',
  base: 'none',
  footHeight: lengthToField(DEFAULT_FOOT_HEIGHT, 'in'),
  casterHeight: lengthToField(DEFAULT_CASTER_HEIGHT, 'in'),
  slideLength: 'auto',
  edgeBanding: false,
  bandingThickness: '0.5 mm',
};

const LENGTH_FIELDS = [
  'thickness', 'width', 'height', 'depth', 'gap', 'pullWidth', 'pullDepth',
  'boxThickness', 'bottomThickness', 'backThickness', 'footHeight', 'casterHeight',
] as const;
type FieldKey = typeof LENGTH_FIELDS[number] | `frontHeights.${number}`;

const UNIT_OPTIONS = [
  { value: 'in', label: 'Inches' },
  { value: 'mm', label: 'Millimeters' },
] as const;

const HEIGHT_MODE_OPTIONS = [
  { value: 'overall', label: 'Overall height' },
  { value: 'fronts', label: 'Each front' },
] as const;

const BASE_OPTIONS = [
  { value: 'none', label: 'On the floor' },
  { value: 'feet', label: 'Leveling feet' },
  { value: 'casters', label: 'Casters' },
] as const;

const PULL_OPTIONS = [
  { value: 'arc', label: 'Arc (ALEX)' },
  { value: 'slot', label: 'Slot' },
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

/** Keep the front-height list the same length as the drawer count. */
function normalizeDrawers(form: FormState): FormState {
  const n = form.drawers;
  const list = Array.isArray(form.frontHeights) ? form.frontHeights : [];
  const last = list[list.length - 1] ?? DEFAULT_FORM.frontHeights[0];
  return { ...form, frontHeights: Array.from({ length: n }, (_, i) => list[i] ?? last) };
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
  return next;
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
    const raw = (key.startsWith('frontHeights.') ? form.frontHeights[Number(key.split('.')[1])] ?? '' : form[key as typeof LENGTH_FIELDS[number]]).trim();
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
  const config: DrawerConfig = {
    units: form.units,
    thickness: num('thickness'),
    width: num('width'),
    height: fronts ? 0 : num('height'),
    depth: num('depth'),
    drawers: form.drawers,
    frontHeights: fronts ? form.frontHeights.slice(0, form.drawers).map((_, i) => num(`frontHeights.${i}`)) : undefined,
    gap: num('gap', { allowZero: true }),
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
    slideLength: form.slideLength === 'auto' ? undefined : Number(form.slideLength),
    edgeBanding: form.edgeBanding,
    bandingThickness: parseLength(form.bandingThickness, form.units) ?? 0.02,
  };
  if (Object.keys(fieldErrors).length > 0) return { config: null, fieldErrors };
  return { config, fieldErrors };
}

/** Every part comes from sheets; the optimizer matches each to a sheet of its thickness. */
function toCutList(plan: DrawerPlan): CutListItem[] {
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
  const solids = useMemo(() => (plan && config && valid ? drawerSolids(plan, config) : []), [plan, config, valid]);
  const cutList = useMemo(() => (plan && valid ? toCutList(plan) : []), [plan, valid]);
  const estimate = useDrawerEstimate(plan && valid ? plan : null, valid ? config : null, units);

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
      if (heightMode === 'fronts') patch.frontHeights = roundedFronts(plan.drawers.map(d => d.front.height), units);
      else patch.height = lengthToField(plan.overallHeight, units);
    }
    update(patch);
  };

  const setDrawers = (count: number) => {
    const drawers = Math.min(MAX_DRAWERS, Math.max(1, count));
    setForm(prev => normalizeDrawers({ ...prev, drawers }));
  };

  const setFront = (index: number, value: string) => {
    setCopyStatus('');
    setForm(prev => ({ ...prev, frontHeights: prev.frontHeights.map((v, i) => (i === index ? value : v)) }));
  };

  // Spread the fronts over the current case height, equally or growing toward the floor.
  const spreadFronts = (kind: 'equal' | 'graduated') => {
    if (!plan || !config) return;
    const available = plan.caseHeight - form.drawers * config.gap;
    const heights = kind === 'equal' ? equalFronts(form.drawers, available) : graduatedFronts(form.drawers, available);
    update({ frontHeights: roundedFronts(heights, units) });
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
          <Button variant="ghost" onClick={() => { setForm(convertForm(DEFAULT_FORM, units)); setSource(null); }}>
            <RotateCcw size={16} aria-hidden="true" /> Reset design
          </Button>
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
                      {p && saved && p.errors.length === 0 && <img src={drawerThumbnailDataUrl(p, saved.config.pull, 72)} alt="" />}
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

          <fieldset className="shelf-group">
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
              {form.heightMode === 'overall' && (
                <LengthField
                  unit={units}
                  label="Overall height"
                  value={form.height}
                  error={fieldErrors.height}
                  hint={plan && plan.baseHeight > 0 ? `Includes the ${fmt(plan.baseHeight)} ${form.base === 'feet' ? 'feet' : 'casters'}` : undefined}
                  onChange={height => update({ height })}
                />
              )}
            </div>
          </fieldset>

          <fieldset className="shelf-group">
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
                <span className="form-field-label" id="drawer-count-label">Number of drawers</span>
                <Stepper labelledBy="drawer-count-label" value={form.drawers} min={1} max={MAX_DRAWERS} onChange={setDrawers} noun="drawer" />
              </div>
              <LengthField
                unit={units}
                label="Gap between fronts"
                value={form.gap}
                error={fieldErrors.gap}
                hint="Half of it shows at the top, bottom and sides."
                onChange={gap => update({ gap })}
              />
            </div>
            {form.heightMode === 'fronts' && (
              <>
                <div className="drawer-fronts">
                  {form.frontHeights.map((value, i) => (
                    <LengthField
                      key={i}
                      unit={units}
                      label={`Drawer ${i + 1}${i === 0 ? ' (top)' : i === form.drawers - 1 ? ' (bottom)' : ''}`}
                      value={value}
                      error={fieldErrors[`frontHeights.${i}`]}
                      hint={plan?.drawers[i] ? `Box ${fmt(plan.drawers[i].box.height)} tall` : undefined}
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
            {form.heightMode === 'overall' && plan && plan.drawers.length > 0 && (
              <p className="shelf-group-note">
                Fronts {fmt(plan.drawers[0].front.height)} tall; boxes {[...new Set(plan.drawers.map(d => fmt(d.box.height)))].join(' and ')}.
              </p>
            )}
          </fieldset>

          <fieldset className="shelf-group">
            <legend>Finger pull</legend>
            <Toggle
              label="Notch in each front"
              checked={form.pullEnabled}
              hint="The ALEX look: no handles, just a cut-out in the top edge to hook a finger behind the front. The box front behind gets a matching notch."
              onChange={pullEnabled => update({ pullEnabled })}
            />
            {form.pullEnabled && (
              <>
                <SegmentedControl label="Pull shape" value={form.pullShape} options={PULL_OPTIONS} onChange={pullShape => update({ pullShape })} />
                <div className="shelf-field-grid">
                  <LengthField unit={units} label="Pull width" value={form.pullWidth} error={fieldErrors.pullWidth} onChange={pullWidth => update({ pullWidth })} />
                  <LengthField unit={units} label="Pull depth" value={form.pullDepth} error={fieldErrors.pullDepth} hint="Down from the top edge." onChange={pullDepth => update({ pullDepth })} />
                </div>
              </>
            )}
          </fieldset>

          <fieldset className="shelf-group">
            <legend>Slides</legend>
            <label className="form-field">
              <span className="form-field-label">LONTAN slide length</span>
              <select value={form.slideLength} onChange={e => update({ slideLength: e.target.value })}>
                <option value="auto">Longest that fits{plan && plan.slideLength > 0 && form.slideLength === 'auto' ? ` (${fmt(plan.slideLength)})` : ''}</option>
                {SLIDE_LENGTHS.map(l => <option key={l} value={String(l)}>{fmt(l)}</option>)}
              </select>
              <small>Soft-close, full extension, side mount: {fmt(1 / 2)} each side, {SLIDE_CAPACITY_LB} lb a pair. The drawer box is as deep as the slide.</small>
            </label>
          </fieldset>

          <fieldset className="shelf-group">
            <legend>Base</legend>
            <SegmentedControl label="Base" value={form.base} options={BASE_OPTIONS} onChange={base => update({ base })} />
            {form.base === 'feet' && (
              <LengthField
                unit={units}
                label="Gap under the case"
                value={form.footHeight}
                error={fieldErrors.footHeight}
                hint="MROCO 1/4″-20 levelers thread into T-nuts in the bottom; screw them out to level."
                onChange={footHeight => update({ footHeight })}
              />
            )}
            {form.base === 'casters' && (
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

          <fieldset className="shelf-group">
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
                <Stat label="Overall width" value={fmt(plan.overallWidth)} />
                <Stat label="Overall height" value={fmt(plan.overallHeight)} />
                <Stat label="Overall depth" value={fmt(plan.overallDepth)} />
                <Stat label="Slides" value={plan.slideLength > 0 ? `${plan.drawers.length} × ${fmt(plan.slideLength)}` : '—'} accent />
              </dl>
              {view === '3d' && valid ? (
                <Suspense fallback={<div className="shelf-viewer"><p className="shelf-viewer-status">Loading 3D view…</p></div>}>
                  <ShelfViewer3D
                    solids={solids}
                    width={plan.overallWidth}
                    height={plan.overallHeight}
                    depth={plan.caseDepth}
                    wallMounted={false}
                    label={`3D view of a ${fmt(plan.overallWidth)} wide, ${fmt(plan.overallHeight)} tall drawer unit with ${plan.drawers.length} drawers`}
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
                <HardwareTable items={estimate.hardware} />
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
              {plan.drawers.map(d => (
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
                <Button variant={showGuide ? 'secondary' : 'primary'} onClick={() => setShowGuide(open => !open)} aria-expanded={showGuide} aria-controls="drawer-guide">
                  <BookOpen size={16} aria-hidden="true" /> {showGuide ? 'Hide guide' : 'Show build guide'}
                </Button>
              </div>
            </header>
            {showGuide && (
              <div id="drawer-guide">
                <DrawerBuildGuide plan={plan} config={config} units={units} title={source?.title} />
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
        {B > 0 && (config.base === 'feet'
          ? [config.thickness + 1.5, W - config.thickness - 2.75].map(x => <rect key={x} className="drawer-foot" x={x} y={y(B)} width={1.25} height={B} />)
          : [config.thickness + 1.5, W - config.thickness - 4].map(x => <circle key={x} className="drawer-foot" cx={x + 1.25} cy={H - B / 2} r={B / 2 * 0.9} />))}
        {plan.drawers.map(d => (
          <polygon
            key={d.index}
            className="drawer-front-shape"
            points={notchedOutline(d.front.x, d.front.y, d.front.width, d.front.height, pull).map(([px, py]) => `${px},${y(py)}`).join(' ')}
          />
        ))}
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
  const d = plan.drawers[0];
  if (!d) return null;
  const depth = plan.overallDepth;
  const Hs = Math.max(d.front.height + T * 2, 6);
  const top = d.front.y + d.front.height;
  const base = top - Hs + T; // local origin for the cropped section
  const yy = (v: number) => Hs - (v - base);
  const x = (z: number) => z + T; // fronts start at x = 0
  const pad = depth * 0.12;
  const fs = depth * 0.04;
  const pull = config.pull.enabled ? config.pull.depth : 0;
  return (
    <figure className="shelf-drawing is-section">
      <svg viewBox={`${-pad} ${-pad} ${depth + pad * 2} ${Hs + pad * 2.4}`} role="img"
        aria-label={`Side section of the top drawer: ${fmt(plan.slideLength)} slide, ${fmt(d.box.height)} box behind a ${fmt(d.front.height)} front`}>
        <rect className="shelf-side-outline" x={x(0)} y={yy(plan.overallHeight)} width={plan.caseDepth} height={Hs - yy(plan.overallHeight)} />
        <rect className="shelf-ply" x={x(0)} y={yy(plan.overallHeight)} width={plan.interiorDepth} height={T} />
        <rect className="shelf-ply" x={x(plan.interiorDepth)} y={yy(plan.overallHeight)} width={config.backThickness} height={Hs - yy(plan.overallHeight)} />
        <rect className="drawer-front-shape" x={0} y={yy(top)} width={T} height={d.front.height} />
        {pull > 0 && <rect className="drawer-notch" x={0} y={yy(top)} width={T} height={pull} />}
        <rect className="shelf-ply is-shelf" x={x(0)} y={yy(d.box.y + d.box.height)} width={config.boxThickness} height={d.box.height} />
        {d.boxNotchDepth > 0 && <rect className="drawer-notch" x={x(0)} y={yy(d.box.y + d.box.height)} width={config.boxThickness} height={d.boxNotchDepth} />}
        <rect className="shelf-ply is-shelf" x={x(plan.slideLength - config.boxThickness)} y={yy(d.box.y + d.box.height)} width={config.boxThickness} height={d.box.height} />
        <rect className="shelf-ply" x={x(config.boxThickness)} y={yy(d.box.y + 0.5 + config.bottomThickness)} width={plan.slideLength - 2 * config.boxThickness} height={config.bottomThickness} />
        <rect className="drawer-slide" x={x(0)} y={yy(d.slideY + 45 / 25.4)} width={plan.slideLength} height={45 / 25.4} />
        <DimH x1={x(0)} x2={x(plan.slideLength)} y={Hs + pad * 0.6} fs={fs} label={`Slide ${fmt(plan.slideLength)}`} />
        <DimH x1={0} x2={depth} y={Hs + pad * 1.5} fs={fs} label={fmt(depth)} />
      </svg>
      <figcaption>Side section through the top drawer{pull > 0 ? ': the box front is notched below the pull so fingers can hook the front' : ''}</figcaption>
    </figure>
  );
}

