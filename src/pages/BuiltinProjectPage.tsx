import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft, Box, Copy, ExternalLink, LayoutGrid, MapPin, Pencil, Plus, RotateCcw, RotateCw, Trash2, Undo2,
} from 'lucide-react';
import { Button, IconButton, PageFrame, PageHeader, SegmentedControl, StatePanel } from '../components/ui';
import RoomEditor from '../components/RoomEditor';
import { useWorkbenchTop } from '../components/useWorkbenchTop';
import RoomPlan, { CABINET_DRAG_TYPE, type PlanCabinet } from '../components/RoomPlan';
import {
  addBuiltinCabinet, deleteBuiltinCabinet, getBuiltinProject, listLibraryDrawerDesigns, saveBuiltinLayout,
  updateBuiltinCabinet, updateBuiltinProject,
} from '../services/api';
import { isDemoMode } from '../demo/demoMode';
import { buildDrawerPlan, deskSolids, drawerSolids, finishColors, readSavedDrawerDesign, runSolids } from '../lib/drawerUnit';
import { drawerThumbnailDataUrl } from '../lib/drawerTemplates';
import { formatLength, type LengthUnit, type Solid, type SolidKind } from '../lib/shelving';
import {
  autoPlace, cabinetBox, clampPlacement, layoutIssues, nextRotation, placedRect, readRoom, snapPlacement,
  OPENING_LABELS, WALL_LABELS, type CabinetBox, type Placement, type Room,
} from '../lib/builtinRoom';
import type { BuiltinProject, BuiltinProjectCabinet, LibraryDrawerDesign } from '../types/project';

const RoomViewer3D = lazy(() => import('../components/RoomViewer3D'));

type Step = 'cabinets' | 'room' | 'layout' | '3d';
const STEPS: { value: Step; label: string }[] = [
  { value: 'cabinets', label: '1 · Cabinets' },
  { value: 'room', label: '2 · Room' },
  { value: 'layout', label: '3 · Layout' },
  { value: '3d', label: '4 · 3D' },
];

/** What a saved design builds into, for the plan, 3D and the list. */
interface CabinetModel {
  solids: Solid[];
  box: CabinetBox;
  thumb: string;
  summary: string;
  wallHung: boolean;
  colors: Partial<Record<SolidKind, number>>;
  units: LengthUnit;
}

function buildModel(raw: unknown): CabinetModel | null {
  const saved = readSavedDrawerDesign(raw);
  if (!saved) return null;
  const plan = buildDrawerPlan(saved.config);
  if (plan.errors.length) return null;
  const solids = plan.run ? runSolids(plan, saved.config) : plan.desk ? deskSolids(plan, saved.config) : drawerSolids(plan, saved.config);
  const box = cabinetBox(solids);
  if (!box) return null;
  const f = (inches: number) => formatLength(inches, saved.units);
  const width = box.maxX - box.minX;
  return {
    solids,
    box,
    thumb: drawerThumbnailDataUrl(plan, saved.config.pull, 96, saved.config.finish?.front),
    summary: `${f(width)} W × ${f(box.maxZ - box.minZ)} D × ${f(plan.totalHeight)} H${plan.mount === 'wall' ? ` · hung ${f(plan.lift)} up` : ''}`,
    wallHung: plan.mount === 'wall',
    colors: finishColors(saved.config.finish),
    units: saved.units,
  };
}

const message = (err: unknown) => (err instanceof Error && err.message ? err.message : 'the request failed');
const readStep = (v: string | null): Step => (v === 'room' || v === 'layout' || v === '3d' ? v : 'cabinets');

type SaveState = 'idle' | 'saving' | 'saved' | 'error';

export default function BuiltinProjectPage() {
  const { id } = useParams();
  const projectId = Number(id);
  const navigate = useNavigate();
  const demo = isDemoMode();
  const [searchParams, setSearchParams] = useSearchParams();
  const step = readStep(searchParams.get('step'));
  const setStep = (next: Step) => setSearchParams(prev => { const p = new URLSearchParams(prev); p.set('step', next); return p; }, { replace: true });

  const [project, setProject] = useState<BuiltinProject | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryDrawerDesign[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savingRoom, setSavingRoom] = useState(false);
  const [placements, setPlacements] = useState<Map<number, Placement | null>>(new Map());
  const [selected, setSelected] = useState<number | null>(null);
  const [layoutSave, setLayoutSave] = useState<SaveState>('idle');
  const [renaming, setRenaming] = useState<string | null>(null);
  const saveTimer = useRef<number | undefined>(undefined);
  const pendingLayout = useRef<Map<number, Placement | null> | null>(null);
  const layoutRef = useRef<HTMLDivElement>(null);
  useWorkbenchTop(layoutRef);

  useEffect(() => {
    if (!Number.isInteger(projectId)) { setLoadError('That isn’t a project.'); return; }
    let cancelled = false;
    getBuiltinProject(projectId)
      .then(p => {
        if (cancelled) return;
        setProject(p);
        setPlacements(new Map(p.cabinets.map(c => [c.id, c.placement])));
      })
      .catch(err => !cancelled && setLoadError(message(err)));
    listLibraryDrawerDesigns()
      .then(list => !cancelled && setLibrary(list))
      .catch(() => !cancelled && setLibrary([]));
    return () => { cancelled = true; };
  }, [projectId]);

  // Save any layout change still waiting when the page goes away.
  const flushLayout = useCallback(() => {
    window.clearTimeout(saveTimer.current);
    const pending = pendingLayout.current;
    if (!pending) return;
    pendingLayout.current = null;
    setLayoutSave('saving');
    saveBuiltinLayout(projectId, [...pending].map(([cid, placement]) => ({ id: cid, placement })))
      .then(() => setLayoutSave(pendingLayout.current ? 'saving' : 'saved'))
      .catch(err => { setLayoutSave('error'); setError(`The layout wasn’t saved: ${message(err)}`); });
  }, [projectId]);
  useEffect(() => () => flushLayout(), [flushLayout]);

  // Windows, doors and closets dragged on the layout plan: shown at once, saved shortly after.
  const roomTimer = useRef<number | undefined>(undefined);
  const pendingRoom = useRef<Room | null>(null);
  const flushRoom = useCallback(() => {
    window.clearTimeout(roomTimer.current);
    const next = pendingRoom.current;
    if (!next) return;
    pendingRoom.current = null;
    setLayoutSave('saving');
    updateBuiltinProject(projectId, { room: next })
      .then(updated => {
        if (pendingRoom.current) return;
        setLayoutSave('saved');
        setProject(p => (p ? { ...p, updated_at: updated.updated_at } : p));
      })
      .catch(err => { setLayoutSave('error'); setError(`The room wasn’t saved: ${message(err)}`); });
  }, [projectId]);
  useEffect(() => () => flushRoom(), [flushRoom]);
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null);

  const room = useMemo(() => readRoom(project?.room ?? null), [project?.room]);
  const units: LengthUnit = room?.units ?? 'in';
  const fmt = useCallback((inches: number) => formatLength(inches, units), [units]);

  // Each design is built once, however many times it's used.
  const models = useMemo(() => {
    const map = new Map<number, CabinetModel | null>();
    for (const c of project?.cabinets ?? []) if (!map.has(c.design_id)) map.set(c.design_id, buildModel(c.design.design));
    return map;
  }, [project?.cabinets]);

  const labelFor = useMemo(() => {
    const cabinets = project?.cabinets ?? [];
    const seen = new Map<number, number>();
    const totals = new Map<number, number>();
    for (const c of cabinets) totals.set(c.design_id, (totals.get(c.design_id) ?? 0) + 1);
    const labels = new Map<number, string>();
    for (const c of cabinets) {
      const n = (seen.get(c.design_id) ?? 0) + 1;
      seen.set(c.design_id, n);
      labels.set(c.id, c.label || ((totals.get(c.design_id) ?? 0) > 1 ? `${c.design.name} #${n}` : c.design.name));
    }
    return labels;
  }, [project?.cabinets]);

  const planCabinets: PlanCabinet[] = useMemo(() => (project?.cabinets ?? []).flatMap(c => {
    const model = models.get(c.design_id);
    const placement = placements.get(c.id);
    return model && placement ? [{ id: c.id, label: labelFor.get(c.id) ?? c.design.name, placement, box: model.box, wallHung: model.wallHung }] : [];
  }), [project?.cabinets, models, placements, labelFor]);

  const issues = useMemo(() => (room ? layoutIssues(room, planCabinets, fmt) : []), [room, planCabinets, fmt]);
  const flagged = useMemo(() => new Set(issues.flatMap(i => i.ids)), [issues]);

  if (loadError) {
    return (
      <PageFrame maxWidth={1200}>
        <StatePanel tone="danger" title="This project couldn’t be opened" description={loadError} action={<Button onClick={() => navigate('/built-ins/projects')}>All projects</Button>} />
      </PageFrame>
    );
  }
  if (!project) {
    return <PageFrame maxWidth={1200}><p className="is-muted" role="status">Loading the project…</p></PageFrame>;
  }

  // ── Layout changes: applied at once, saved shortly after ──────────────────────
  const setPlacement = (cabinetId: number, placement: Placement | null) => {
    const next = new Map(placements);
    next.set(cabinetId, placement);
    setPlacements(next);
    if (demo) return;
    pendingLayout.current = next;
    setLayoutSave('saving');
    window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(flushLayout, 500);
  };

  const othersFor = (cabinetId: number) => planCabinets.filter(c => c.id !== cabinetId);
  const placeAuto = (cabinet: BuiltinProjectCabinet) => {
    const model = models.get(cabinet.design_id);
    if (!room || !model) return;
    const others = othersFor(cabinet.id).map(o => ({ rect: placedRect(o.placement, o.box), bottom: o.box.minY, top: o.box.maxY }));
    setPlacement(cabinet.id, autoPlace(room, model.box, others));
    setSelected(cabinet.id);
  };
  const dropAt = (cabinetId: number, x: number, y: number, others: PlanCabinet[]) => {
    const cabinet = project.cabinets.find(c => c.id === cabinetId);
    const model = cabinet && models.get(cabinet.design_id);
    if (!room || !model) return;
    const snapped = snapPlacement({ room, box: model.box, x, y, rotation: placements.get(cabinetId)?.rotation ?? 0, others: others.map(o => ({ rect: placedRect(o.placement, o.box), bottom: o.box.minY, top: o.box.maxY })) });
    setPlacement(cabinetId, { x: snapped.x, y: snapped.y, rotation: snapped.rotation });
    setSelected(cabinetId);
  };
  const turn = (cabinetId: number, step: 1 | -1) => {
    const cabinet = project.cabinets.find(c => c.id === cabinetId);
    const model = cabinet && models.get(cabinet.design_id);
    const p = placements.get(cabinetId);
    if (!room || !model || !p) return;
    setPlacement(cabinetId, clampPlacement(room, model.box, { ...p, rotation: nextRotation(p.rotation, step) }));
  };

  // ── Project edits ─────────────────────────────────────────────────────────────
  const rename = async () => {
    const name = renaming?.trim();
    setRenaming(null);
    if (!name || name === project.name) return;
    try {
      const updated = await updateBuiltinProject(project.id, { name });
      setProject(p => (p ? { ...p, name: updated.name, updated_at: updated.updated_at } : p));
    } catch (err) {
      setError(`The project wasn’t renamed: ${message(err)}`);
    }
  };

  const addCabinet = async (designId: number) => {
    setError(null);
    try {
      const cabinet = await addBuiltinCabinet(project.id, designId);
      setProject(p => (p ? { ...p, cabinets: [...p.cabinets, cabinet] } : p));
      setPlacements(prev => new Map(prev).set(cabinet.id, null));
    } catch (err) {
      setError(`The cabinet wasn’t added: ${message(err)}`);
    }
  };

  const removeCabinet = async (cabinet: BuiltinProjectCabinet) => {
    setError(null);
    try {
      await deleteBuiltinCabinet(project.id, cabinet.id);
      pendingLayout.current?.delete(cabinet.id);
      setProject(p => (p ? { ...p, cabinets: p.cabinets.filter(c => c.id !== cabinet.id) } : p));
      setPlacements(prev => { const next = new Map(prev); next.delete(cabinet.id); return next; });
      if (selected === cabinet.id) setSelected(null);
    } catch (err) {
      setError(`The cabinet wasn’t removed: ${message(err)}`);
    }
  };

  const relabel = async (cabinet: BuiltinProjectCabinet, label: string) => {
    if (label.trim() === cabinet.label) return;
    try {
      const updated = await updateBuiltinCabinet(project.id, cabinet.id, { label: label.trim() });
      setProject(p => (p ? { ...p, cabinets: p.cabinets.map(c => (c.id === cabinet.id ? { ...c, label: updated.label } : c)) } : p));
    } catch (err) {
      setError(`The name wasn’t saved: ${message(err)}`);
    }
  };

  const saveRoom = async (next: Room | null) => {
    setSavingRoom(true);
    setError(null);
    try {
      const updated = await updateBuiltinProject(project.id, { room: next });
      setProject(p => (p ? { ...p, room: updated.room, updated_at: updated.updated_at } : p));
    } catch (err) {
      setError(`The room wasn’t saved: ${message(err)}`);
    } finally {
      setSavingRoom(false);
    }
  };

  const moveOpening = (id: string, offset: number) => {
    if (!room) return;
    const next: Room = { ...room, openings: room.openings.map(o => (o.id === id ? { ...o, offset } : o)) };
    setProject(p => (p ? { ...p, room: next } : p));
    pendingRoom.current = next;
    setLayoutSave('saving');
    window.clearTimeout(roomTimer.current);
    roomTimer.current = window.setTimeout(flushRoom, 600);
  };
  const selectCabinet = (id: number | null) => { setSelected(id); if (id !== null) setSelectedOpening(null); };
  const selectOpening = (id: string | null) => { setSelectedOpening(id); if (id !== null) setSelected(null); };
  const openingIndex = room ? room.openings.findIndex(o => o.id === selectedOpening) : -1;
  const shownOpening = room && openingIndex >= 0 ? room.openings[openingIndex] : null;

  const cabinets = project.cabinets;
  const placedCount = cabinets.filter(c => placements.get(c.id) && models.get(c.design_id)).length;
  const selectedCabinet = cabinets.find(c => c.id === selected) ?? null;
  const selectedPlacement = selectedCabinet ? placements.get(selectedCabinet.id) ?? null : null;
  const selectedRect = selectedCabinet && selectedPlacement && models.get(selectedCabinet.design_id)
    ? placedRect(selectedPlacement, models.get(selectedCabinet.design_id)!.box) : null;

  return (
    <PageFrame maxWidth={1280} className={`builtin-project-page${step === 'room' || step === 'layout' ? ' is-workbench' : ''}`}>
      <Button variant="ghost" onClick={() => navigate('/built-ins/projects')} className="workflow-back">
        <ArrowLeft size={16} aria-hidden="true" /> All projects
      </Button>
      {renaming !== null ? (
        <form className="builtin-rename" onSubmit={e => { e.preventDefault(); void rename(); }}>
          <label className="form-field">
            <span className="form-field-label">Project name</span>
            <input autoFocus value={renaming} maxLength={120} onChange={e => setRenaming(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setRenaming(null); }} />
          </label>
          <Button type="submit" variant="primary" disabled={!renaming.trim()}>Save</Button>
          <Button variant="ghost" onClick={() => setRenaming(null)}>Cancel</Button>
        </form>
      ) : (
        <PageHeader
          title={project.name}
          description={`${cabinets.length} cabinet${cabinets.length === 1 ? '' : 's'}${room ? ` · ${fmt(room.width)} × ${fmt(room.depth)} room, ${placedCount} placed` : ' · no room yet'}`}
          actions={!demo && (
            <Button variant="ghost" onClick={() => setRenaming(project.name)}>
              <Pencil size={16} aria-hidden="true" /> Rename
            </Button>
          )}
        />
      )}

      <div className="builtin-steps">
        <SegmentedControl label="Project step" value={step} onChange={setStep} options={STEPS} />
        {step === 'layout' && !demo && (
          <span className={`builtin-save-state is-${layoutSave}`} role="status">
            {layoutSave === 'saving' ? 'Saving…' : layoutSave === 'saved' ? 'Layout saved' : layoutSave === 'error' ? 'Not saved' : ''}
          </span>
        )}
      </div>
      {error && <p className="inline-error" role="alert">{error}</p>}

      {step === 'cabinets' && (
        <div className="builtin-cabinets-step">
          <section className="card" aria-labelledby="project-cabinets-title">
            <h2 id="project-cabinets-title">In this project</h2>
            {cabinets.length === 0 ? (
              <p className="builtin-hint">Nothing yet — add cabinets from your saved designs. Add the same design more than once for a run of matching cabinets.</p>
            ) : (
              <ul className="builtin-cabinet-list">
                {cabinets.map(c => {
                  const model = models.get(c.design_id);
                  return (
                    <li key={c.id} className="builtin-cabinet-row">
                      {model ? <img src={model.thumb} alt="" /> : <span className="shelf-library-nothumb" aria-hidden="true" />}
                      <div>
                        <label className="sr-only" htmlFor={`cabinet-label-${c.id}`}>Name for {labelFor.get(c.id)}</label>
                        <input
                          id={`cabinet-label-${c.id}`}
                          className="builtin-cabinet-name"
                          defaultValue={c.label}
                          placeholder={labelFor.get(c.id)}
                          maxLength={120}
                          disabled={demo}
                          onBlur={e => void relabel(c, e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                        />
                        <small>{model ? model.summary : 'This design can’t be built as saved — open it in the Studio to fix it.'}{c.label ? ` · ${c.design.name}` : ''}</small>
                      </div>
                      <span className="builtin-row-actions">
                        <Link className="btn btn-ghost" to={`/built-ins?design=${c.design_id}`} title="Edit this design in the Built-in Studio — every copy updates">
                          <ExternalLink size={16} aria-hidden="true" /> Edit design
                        </Link>
                        {!demo && (
                          <>
                            <IconButton label={`Add another ${c.design.name}`} onClick={() => void addCabinet(c.design_id)}><Copy size={16} aria-hidden="true" /></IconButton>
                            <IconButton label={`Remove ${labelFor.get(c.id)} from the project`} onClick={() => void removeCabinet(c)}><Trash2 size={16} aria-hidden="true" /></IconButton>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
            {cabinets.length > 0 && (
              <div className="builtin-step-next">
                <Button variant="next" onClick={() => setStep(room ? 'layout' : 'room')}>{room ? 'Lay them out' : 'Next: the room'}</Button>
              </div>
            )}
          </section>

          {!demo && (
            <section className="card" aria-labelledby="library-title">
              <h2 id="library-title">Your saved designs</h2>
              {library === null && <p className="is-muted" role="status">Loading…</p>}
              {library?.length === 0 && (
                <p className="builtin-hint">Design a cabinet in the <Link to="/built-ins">Built-in Studio</Link> and save it to your library, then add it here.</p>
              )}
              {library && library.length > 0 && (
                <ul className="builtin-library-list">
                  {library.map(d => {
                    const model = buildModel(d.design);
                    return (
                      <li key={d.id}>
                        {model ? <img src={model.thumb} alt="" /> : <span className="shelf-library-nothumb" aria-hidden="true" />}
                        <span><strong>{d.name}</strong><small>{model ? model.summary : 'Can’t be built as saved'}</small></span>
                        <Button variant="ghost" onClick={() => void addCabinet(d.id)} disabled={!model}>
                          <Plus size={16} aria-hidden="true" /> Add
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="builtin-hint"><Link to="/built-ins">Design a new cabinet</Link> — save it to your library and it shows up here.</p>
            </section>
          )}
        </div>
      )}

      {step === 'room' && (
        <RoomEditor key={project.room ? JSON.stringify(project.room) : 'none'} room={room} readOnly={demo} saving={savingRoom} onSave={r => void saveRoom(r)} onRemove={() => void saveRoom(null)} />
      )}

      {step === 'layout' && (!room ? (
        <StatePanel title="Set up the room first" description="The layout needs the room’s size and walls." action={<Button variant="primary" onClick={() => setStep('room')}>Set up the room</Button>} />
      ) : (
        <div ref={layoutRef} className="builtin-layout">
          <aside className="card builtin-palette" aria-labelledby="palette-title">
            <h2 id="palette-title">Cabinets</h2>
            {cabinets.length === 0 && <p className="builtin-hint">Add cabinets in step 1 first.</p>}
            {cabinets.length > 0 && !demo && <p className="builtin-hint">Drag a cabinet onto the room, or use Place. Near a wall it turns and snaps flush.</p>}
            <ul className="builtin-palette-list">
              {cabinets.map(c => {
                const model = models.get(c.design_id);
                const placed = Boolean(placements.get(c.id));
                return (
                  <li
                    key={c.id}
                    className={`builtin-palette-item${placed ? ' is-placed' : ''}${selected === c.id ? ' is-selected' : ''}`}
                    draggable={!demo && Boolean(model)}
                    onDragStart={e => { e.dataTransfer.setData(CABINET_DRAG_TYPE, String(c.id)); e.dataTransfer.effectAllowed = 'move'; }}
                  >
                    {model ? <img src={model.thumb} alt="" draggable={false} /> : <span className="shelf-library-nothumb" aria-hidden="true" />}
                    <span>
                      <strong>{labelFor.get(c.id)}</strong>
                      <small>{model ? model.summary : 'Can’t be built as saved'}</small>
                    </span>
                    {!demo && model && (placed ? (
                      <IconButton label={`Take ${labelFor.get(c.id)} out of the room`} onClick={() => setPlacement(c.id, null)}><Undo2 size={16} aria-hidden="true" /></IconButton>
                    ) : (
                      <IconButton label={`Place ${labelFor.get(c.id)}`} onClick={() => placeAuto(c)}><MapPin size={16} aria-hidden="true" /></IconButton>
                    ))}
                  </li>
                );
              })}
            </ul>
            <div className="builtin-step-next">
              <Button variant="next" onClick={() => { flushLayout(); setStep('3d'); }} disabled={placedCount === 0}>
                <Box size={16} aria-hidden="true" /> Render in 3D
              </Button>
            </div>
          </aside>

          <section className="card builtin-plan" aria-labelledby="plan-title">
            <div className="builtin-plan-head">
              <h2 id="plan-title"><LayoutGrid size={16} aria-hidden="true" /> Top view</h2>
              {shownOpening && (
                <div className="builtin-selection" aria-label={`${OPENING_LABELS[shownOpening.kind]} ${openingIndex + 1} selected`}>
                  <strong>{OPENING_LABELS[shownOpening.kind]} {openingIndex + 1}</strong>
                  <small>
                    {WALL_LABELS[shownOpening.wall]} · {fmt(shownOpening.offset)} {shownOpening.wall === 'north' || shownOpening.wall === 'south' ? 'from the left corner' : 'from the top corner'} · {fmt(shownOpening.width)} wide
                  </small>
                </div>
              )}
              {selectedCabinet && selectedPlacement && !demo && (
                <div className="builtin-selection" aria-label={`${labelFor.get(selectedCabinet.id)} selected`}>
                  <strong>{labelFor.get(selectedCabinet.id)}</strong>
                  {selectedRect && <small>{fmt(selectedRect.x0)} from left · {fmt(selectedRect.y0)} from top</small>}
                  <IconButton label="Turn left" onClick={() => turn(selectedCabinet.id, -1)}><RotateCcw size={16} aria-hidden="true" /></IconButton>
                  <IconButton label="Turn right" onClick={() => turn(selectedCabinet.id, 1)}><RotateCw size={16} aria-hidden="true" /></IconButton>
                  <IconButton label="Take out of the room" onClick={() => { setPlacement(selectedCabinet.id, null); setSelected(null); }}><Undo2 size={16} aria-hidden="true" /></IconButton>
                </div>
              )}
            </div>
            <RoomPlan
              room={room}
              cabinets={planCabinets}
              fmt={fmt}
              selectedId={selected}
              flagged={flagged}
              editable={!demo}
              onSelect={selectCabinet}
              selectedOpeningId={selectedOpening}
              onSelectOpening={selectOpening}
              onMoveOpening={moveOpening}
              openingDims
              onMove={(cid, p) => setPlacement(cid, p)}
              onRemove={cid => { setPlacement(cid, null); setSelected(null); }}
              onDrop={dropAt}
              label={`Top view of the room with ${planCabinets.length} cabinet${planCabinets.length === 1 ? '' : 's'} placed. The front of each cabinet is the heavy edge.`}
            />
            <p className="builtin-hint">The heavy edge is each cabinet’s front. Dashed cabinets hang on the wall. Cabinets snap to the walls and to each other as you drag (hold Alt to place freely). Select one and use the arrow keys to nudge (Shift for 12″), R to turn. Windows, doors and closets slide along their wall the same way.</p>
            {issues.length > 0 && (
              <ul className="builder-notes builtin-issues" role="status">{issues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>
            )}
          </section>
        </div>
      ))}

      {step === '3d' && (!room ? (
        <StatePanel title="Set up the room first" description="The 3D view shows the cabinets in their room." action={<Button variant="primary" onClick={() => setStep('room')}>Set up the room</Button>} />
      ) : placedCount === 0 ? (
        <StatePanel title="Place some cabinets first" description="Drag cabinets into the room’s top view, then come back here." action={<Button variant="primary" onClick={() => setStep('layout')}>Go to layout</Button>} />
      ) : (
        <section className="builtin-3d" aria-label="3D view">
          <Suspense fallback={<div className="shelf-viewer room-viewer"><p className="shelf-viewer-status">Loading 3D view…</p></div>}>
            <RoomViewer3D
              room={room}
              imageName={project.name}
              label={`3D view of ${project.name}: a ${fmt(room.width)} by ${fmt(room.depth)} room with ${placedCount} cabinet${placedCount === 1 ? '' : 's'}`}
              cabinets={cabinets.flatMap(c => {
                const model = models.get(c.design_id);
                const placement = placements.get(c.id);
                return model && placement ? [{ id: c.id, label: labelFor.get(c.id) ?? c.design.name, solids: model.solids, box: model.box, placement, colors: model.colors }] : [];
              })}
            />
          </Suspense>
          {placedCount < cabinets.length && (
            <p className="builtin-hint">{cabinets.length - placedCount} cabinet{cabinets.length - placedCount === 1 ? ' isn’t' : 's aren’t'} placed yet and {cabinets.length - placedCount === 1 ? 'isn’t' : 'aren’t'} shown.</p>
          )}
          {issues.length > 0 && <ul className="builder-notes builtin-issues" role="status">{issues.map((i, n) => <li key={n}>{i.message}</li>)}</ul>}
        </section>
      ))}
    </PageFrame>
  );
}
