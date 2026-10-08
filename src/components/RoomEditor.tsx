// Room set-up for a Built-in Studio project: required size and wall height, which
// walls exist, and the windows, doors, closets and doorways in them.

import { useMemo, useState } from 'react';
import { DoorOpen, Plus, Save, Trash2 } from 'lucide-react';
import { Button, IconButton, SegmentedControl } from './ui';
import { LengthField, Toggle } from './builderControls';
import RoomPlan from './RoomPlan';
import { formatLength, lengthToField, parseLength, type LengthUnit } from '../lib/shelving';
import {
  OPENING_LABELS, WALLS, WALL_LABELS, defaultRoom, newOpening, roomProblems,
  type OpeningKind, type Room, type RoomOpening, type Wall,
} from '../lib/builtinRoom';

type LengthKey = 'offset' | 'width' | 'height' | 'sill' | 'depth';
type OpeningForm = Omit<RoomOpening, LengthKey> & Record<LengthKey, string>;
interface RoomForm {
  units: LengthUnit;
  width: string;
  depth: string;
  height: string;
  walls: Record<Wall, boolean>;
  openings: OpeningForm[];
}

const OPENING_KEYS: LengthKey[] = ['offset', 'width', 'height', 'sill', 'depth'];

function toForm(room: Room): RoomForm {
  const u = room.units;
  return {
    units: u,
    width: lengthToField(room.width, u),
    depth: lengthToField(room.depth, u),
    height: lengthToField(room.height, u),
    walls: { ...room.walls },
    openings: room.openings.map(o => openingToForm(o, u)),
  };
}

function openingToForm(o: RoomOpening, u: LengthUnit): OpeningForm {
  return { ...o, offset: lengthToField(o.offset, u), width: lengthToField(o.width, u), height: lengthToField(o.height, u), sill: lengthToField(o.sill, u), depth: o.depth === undefined ? '' : lengthToField(o.depth, u) };
}

/** The room the form describes, plus what's missing. Lengths left blank are reported, not guessed. */
function fromForm(form: RoomForm): { room: Room | null; missing: string[] } {
  const p = (raw: string) => parseLength(raw, form.units);
  const missing: string[] = [];
  const width = p(form.width), depth = p(form.depth), height = p(form.height);
  if (width === null) missing.push('Enter the room’s width.');
  if (depth === null) missing.push('Enter the room’s depth.');
  if (height === null) missing.push('Enter the wall height.');
  const openings: RoomOpening[] = [];
  form.openings.forEach((o, i) => {
    const values = Object.fromEntries(OPENING_KEYS.map(k => [k, p(o[k])])) as Record<LengthKey, number | null>;
    const needs: LengthKey[] = ['offset', 'width', 'height', ...(o.kind === 'window' ? ['sill' as const] : []), ...(o.kind === 'closet' ? ['depth' as const] : [])];
    const blank = needs.filter(k => values[k] === null);
    if (blank.length) {
      missing.push(`${OPENING_LABELS[o.kind]} ${i + 1}: enter its ${blank.map(k => (k === 'offset' ? 'position' : k)).join(', ')}.`);
      return;
    }
    openings.push({
      id: o.id, kind: o.kind, wall: o.wall,
      offset: values.offset!, width: values.width!, height: values.height!, sill: o.kind === 'window' ? values.sill! : 0,
      ...(o.kind === 'door' ? { swing: o.swing ?? 'in', hinge: o.hinge ?? 'start' } : {}),
      ...(o.kind === 'closet' ? { depth: values.depth! } : {}),
    });
  });
  if (width === null || depth === null || height === null) return { room: null, missing };
  return { room: { version: 1, units: form.units, width, depth, height, walls: form.walls, openings }, missing };
}

const fromCorner = (wall: Wall) => (wall === 'north' || wall === 'south' ? 'from the left corner' : 'from the top corner');

interface Props {
  room: Room | null;
  readOnly: boolean;
  saving: boolean;
  onSave: (room: Room) => void;
  onRemove: () => void;
}

export default function RoomEditor({ room, readOnly, saving, onSave, onRemove }: Props) {
  const [form, setForm] = useState<RoomForm | null>(() => (room ? toForm(room) : null));
  const [confirmRemove, setConfirmRemove] = useState(false);

  const result = useMemo(() => (form ? fromForm(form) : null), [form]);
  const fmt = (inches: number) => formatLength(inches, form?.units ?? 'in');
  const problems = result ? [...result.missing, ...(result.room ? roomProblems(result.room, fmt) : [])] : [];
  const dirty = useMemo(() => {
    if (!result?.room) return true;
    return JSON.stringify(result.room) !== JSON.stringify(room);
  }, [result, room]);

  if (!form) {
    return (
      <section className="card builtin-room-empty">
        <DoorOpen size={28} aria-hidden="true" />
        <h2>Add the room (optional)</h2>
        <p>
          Measure the space the cabinets go in: its width, depth and wall height, which walls are there, and any windows,
          doors or closets. A pantry cubby or an entertainment wall only needs the walls it actually has.
        </p>
        {!readOnly && (
          <Button variant="primary" onClick={() => setForm(toForm(defaultRoom()))}>
            <Plus size={16} aria-hidden="true" /> Set up the room
          </Button>
        )}
      </section>
    );
  }

  const set = (patch: Partial<RoomForm>) => setForm(f => (f ? { ...f, ...patch } : f));
  const setOpening = (id: string, patch: Partial<OpeningForm>) =>
    set({ openings: form.openings.map(o => (o.id === id ? { ...o, ...patch } : o)) });
  const changeUnits = (units: LengthUnit) => {
    if (units === form.units) return;
    const { room: current } = fromForm(form);
    if (current) setForm(toForm({ ...current, units }));
    else set({ units });
  };
  const addOpening = (kind: OpeningKind) => {
    const base = result?.room ?? defaultRoom(form.units);
    const wall = WALLS.find(w => form.walls[w]) ?? 'north';
    const id = `o${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    set({ openings: [...form.openings, openingToForm(newOpening(kind, wall, base, id), form.units)] });
  };

  const save = () => { if (result?.room && problems.length === 0) onSave(result.room); };

  return (
    <div className="builtin-room-editor">
      <section className="card builtin-room-fields" aria-labelledby="room-size-title">
        <div className="builtin-room-head">
          <h2 id="room-size-title">Room size</h2>
          <SegmentedControl label="Units" value={form.units} onChange={changeUnits} options={[{ value: 'in', label: 'in' }, { value: 'mm', label: 'mm' }]} />
        </div>
        <fieldset disabled={readOnly} className="builtin-room-grid">
          <LengthField unit={form.units} label="Width (left to right)" value={form.width} onChange={width => set({ width })} error={form.width.trim() ? undefined : 'Required'} />
          <LengthField unit={form.units} label="Depth (top to bottom)" value={form.depth} onChange={depth => set({ depth })} error={form.depth.trim() ? undefined : 'Required'} />
          <LengthField unit={form.units} label="Wall height" value={form.height} onChange={height => set({ height })} error={form.height.trim() ? undefined : 'Required'} />
        </fieldset>

        <h3>Walls</h3>
        <p className="builtin-hint">Turn off any side that’s open — a cubby might have three walls, an entertainment wall just one.</p>
        <fieldset disabled={readOnly} className="builtin-wall-toggles">
          {WALLS.map(w => (
            <Toggle key={w} label={WALL_LABELS[w]} checked={form.walls[w]} onChange={on => set({ walls: { ...form.walls, [w]: on } })} />
          ))}
        </fieldset>

        <h3>Windows, doors and closets</h3>
        {form.openings.length === 0 && <p className="builtin-hint">None yet. Add each one so cabinets can steer clear of them.</p>}
        <ol className="builtin-openings">
          {form.openings.map((o, i) => (
            <li key={o.id} className="builtin-opening">
              <div className="builtin-opening-head">
                <strong>{OPENING_LABELS[o.kind]} {i + 1}</strong>
                <label className="builtin-select">
                  <span className="sr-only">Wall</span>
                  <select value={o.wall} disabled={readOnly} onChange={e => setOpening(o.id, { wall: e.target.value as Wall })}>
                    {WALLS.map(w => <option key={w} value={w} disabled={!form.walls[w]}>{WALL_LABELS[w]}</option>)}
                  </select>
                </label>
                {!readOnly && (
                  <IconButton label={`Remove ${OPENING_LABELS[o.kind].toLowerCase()} ${i + 1}`} onClick={() => set({ openings: form.openings.filter(x => x.id !== o.id) })}>
                    <Trash2 size={16} aria-hidden="true" />
                  </IconButton>
                )}
              </div>
              <fieldset disabled={readOnly} className="builtin-room-grid">
                <LengthField unit={form.units} label={`Position ${fromCorner(o.wall)}`} value={o.offset} onChange={offset => setOpening(o.id, { offset })} />
                <LengthField unit={form.units} label="Width" value={o.width} onChange={width => setOpening(o.id, { width })} />
                <LengthField unit={form.units} label="Height" value={o.height} onChange={height => setOpening(o.id, { height })} />
                {o.kind === 'window' && <LengthField unit={form.units} label="Sill above the floor" value={o.sill} onChange={sill => setOpening(o.id, { sill })} />}
                {o.kind === 'closet' && <LengthField unit={form.units} label="Closet depth" value={o.depth} onChange={depth => setOpening(o.id, { depth })} />}
                {o.kind === 'door' && (
                  <>
                    <label className="form-field">
                      <span className="form-field-label">Swings</span>
                      <select value={o.swing ?? 'in'} onChange={e => setOpening(o.id, { swing: e.target.value as 'in' | 'out' })}>
                        <option value="in">Into the room</option>
                        <option value="out">Out of the room</option>
                      </select>
                    </label>
                    <label className="form-field">
                      <span className="form-field-label">Hinges</span>
                      <select value={o.hinge ?? 'start'} onChange={e => setOpening(o.id, { hinge: e.target.value as 'start' | 'end' })}>
                        <option value="start">{o.wall === 'north' || o.wall === 'south' ? 'Left side' : 'Top side'}</option>
                        <option value="end">{o.wall === 'north' || o.wall === 'south' ? 'Right side' : 'Bottom side'}</option>
                      </select>
                    </label>
                  </>
                )}
              </fieldset>
            </li>
          ))}
        </ol>
        {!readOnly && (
          <div className="builtin-add-openings">
            {(Object.keys(OPENING_LABELS) as OpeningKind[]).map(kind => (
              <Button key={kind} variant="ghost" onClick={() => addOpening(kind)}>
                <Plus size={16} aria-hidden="true" /> {OPENING_LABELS[kind]}
              </Button>
            ))}
          </div>
        )}
      </section>

      <section className="card builtin-room-preview" aria-labelledby="room-preview-title">
        <h2 id="room-preview-title">Top view</h2>
        {result?.room ? (
          <RoomPlan room={result.room} fmt={fmt} label={`Top view of a ${fmt(result.room.width)} by ${fmt(result.room.depth)} room`} />
        ) : (
          <p className="builtin-hint">Enter the width, depth and wall height to see the room.</p>
        )}
        {problems.length > 0 && (
          <ul className="drawer-error-list" role="status">{problems.map(p => <li key={p}>{p}</li>)}</ul>
        )}
        {!readOnly && (
          <div className="builtin-room-actions">
            <Button variant="primary" onClick={save} disabled={problems.length > 0 || saving || (!dirty && room !== null)}>
              <Save size={16} aria-hidden="true" /> {saving ? 'Saving…' : room ? (dirty ? 'Save room' : 'Room saved') : 'Save room'}
            </Button>
            {room && (confirmRemove ? (
              <>
                <Button variant="danger" onClick={() => { setConfirmRemove(false); onRemove(); setForm(null); }}>Remove room</Button>
                <Button variant="ghost" onClick={() => setConfirmRemove(false)}>Keep it</Button>
              </>
            ) : (
              <Button variant="ghost" onClick={() => setConfirmRemove(true)}>Remove room</Button>
            ))}
            {!room && <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>}
          </div>
        )}
      </section>
    </div>
  );
}
