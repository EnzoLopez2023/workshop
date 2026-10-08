// Top view of a room for Built-in Studio projects: walls with their windows, doors
// and closets, and the project's cabinets, which can be dragged (pointer or
// keyboard) and dropped in from the cabinet list.

import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { DimH, DimV } from './builderControls';
import {
  WALL_THICKNESS, clampPlacement, frontLine, nextRotation, placedRect, snapPlacement, wallBand, wallLength,
  type CabinetBox, type Placement, type Room, type RoomOpening, type Wall,
} from '../lib/builtinRoom';

export interface PlanCabinet {
  id: number;
  label: string;
  placement: Placement;
  box: CabinetBox;
  wallHung: boolean;
}

interface Props {
  room: Room;
  cabinets?: PlanCabinet[];
  fmt: (inches: number) => string;
  selectedId?: number | null;
  /** Cabinets named in a layout warning. */
  flagged?: Set<number>;
  editable?: boolean;
  onSelect?: (id: number | null) => void;
  /** A cabinet moved or turned. */
  onMove?: (id: number, placement: Placement) => void;
  /** Delete or Backspace on the selected cabinet. */
  onRemove?: (id: number) => void;
  /** Something from the cabinet list was dropped at plan point (x, y). */
  onDrop?: (id: number, x: number, y: number, others: PlanCabinet[]) => void;
  label: string;
}

/** The MIME type cabinet-list items carry when dragged onto the plan. */
export const CABINET_DRAG_TYPE = 'application/x-workshop-cabinet';

export default function RoomPlan({ room, cabinets = [], fmt, selectedId = null, flagged, editable = false, onSelect, onMove, onRemove, onDrop, label }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: number; dx: number; dy: number; placement: Placement; moved: boolean } | null>(null);
  const [dropHover, setDropHover] = useState(false);

  const T = WALL_THICKNESS;
  const closetDepth = Math.max(0, ...room.openings.filter(o => o.kind === 'closet').map(o => o.depth ?? 0));
  const fs = Math.max(room.width, room.depth) / 38;
  const margin = T + closetDepth + fs * 3.2;
  const viewBox = `${-margin} ${-margin} ${room.width + margin * 2} ${room.depth + margin * 2}`;

  const toPlan = (clientX: number, clientY: number): [number, number] | null => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return [p.x, p.y];
  };

  const others = (id: number) => cabinets.filter(c => c.id !== id);

  const onPointerDown = (e: PointerEvent<SVGGElement>, c: PlanCabinet) => {
    onSelect?.(c.id);
    if (!editable || e.button !== 0) return;
    const at = toPlan(e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    svgRef.current?.setPointerCapture(e.pointerId);
    setDrag({ id: c.id, dx: at[0] - c.placement.x, dy: at[1] - c.placement.y, placement: c.placement, moved: false });
  };
  const onPointerMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const at = toPlan(e.clientX, e.clientY);
    const c = cabinets.find(x => x.id === drag.id);
    if (!at || !c) return;
    const snapped = snapPlacement({
      room, box: c.box, x: at[0] - drag.dx, y: at[1] - drag.dy, rotation: drag.placement.rotation,
      others: others(c.id).map(o => ({ rect: placedRect(o.placement, o.box) })),
    });
    setDrag({ ...drag, placement: { x: snapped.x, y: snapped.y, rotation: snapped.rotation }, moved: true });
  };
  const endDrag = () => {
    if (drag?.moved) onMove?.(drag.id, drag.placement);
    setDrag(null);
  };

  const onKeyDown = (e: KeyboardEvent<SVGGElement>, c: PlanCabinet) => {
    if (!editable) return;
    const step = e.shiftKey ? 12 : e.altKey ? 0.25 : 1;
    const move: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (move[e.key]) {
      e.preventDefault();
      const [dx, dy] = move[e.key];
      onMove?.(c.id, clampPlacement(room, c.box, { ...c.placement, x: c.placement.x + dx, y: c.placement.y + dy }));
    } else if (e.key === 'r' || e.key === 'R') {
      e.preventDefault();
      onMove?.(c.id, clampPlacement(room, c.box, { ...c.placement, rotation: nextRotation(c.placement.rotation, e.shiftKey ? -1 : 1) }));
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      onRemove?.(c.id);
    } else if (e.key === 'Escape') {
      onSelect?.(null);
    }
  };

  const dropping = editable && onDrop;
  const onDragOver = (e: DragEvent<SVGSVGElement>) => {
    if (!dropping || !e.dataTransfer.types.includes(CABINET_DRAG_TYPE)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropHover(true);
  };
  const onDropEvent = (e: DragEvent<SVGSVGElement>) => {
    setDropHover(false);
    if (!dropping) return;
    const id = Number(e.dataTransfer.getData(CABINET_DRAG_TYPE));
    const at = toPlan(e.clientX, e.clientY);
    if (!Number.isInteger(id) || !at) return;
    e.preventDefault();
    onDrop(id, at[0], at[1], others(id));
  };

  return (
    <svg
      ref={svgRef}
      className={`room-plan${editable ? ' is-editable' : ''}${dropHover ? ' is-drop-target' : ''}${drag ? ' is-dragging' : ''}`}
      viewBox={viewBox}
      role="group"
      aria-label={label}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={e => { if (e.target === e.currentTarget || (e.target as Element).classList.contains('room-plan-floor')) onSelect?.(null); }}
      onDragOver={onDragOver}
      onDragLeave={() => setDropHover(false)}
      onDrop={onDropEvent}
    >
      <rect className="room-plan-floor" x={0} y={0} width={room.width} height={room.depth} />
      {/* Missing walls: a dashed edge so the room's extent still reads. */}
      {(['north', 'east', 'south', 'west'] as Wall[]).filter(w => !room.walls[w]).map(w => {
        const b = wallBand(room, w, 0, wallLength(room, w), 0);
        return <line key={w} className="room-plan-open-side" x1={b.x0} y1={b.y0} x2={b.x1} y2={b.y1} />;
      })}
      {(['north', 'east', 'south', 'west'] as Wall[]).filter(w => room.walls[w]).map(w => {
        const ns = w === 'north' || w === 'south';
        const b = wallBand(room, w, ns && room.walls.west ? -T : 0, wallLength(room, w) + (ns && room.walls.east ? T : 0));
        return <rect key={w} className="room-plan-wall" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />;
      })}
      {room.openings.filter(o => room.walls[o.wall]).map(o => <OpeningMark key={o.id} room={room} opening={o} fs={fs} />)}

      <DimH x1={0} x2={room.width} y={-T - closetDepthOn(room, 'north') - fs * 1.6} label={fmt(room.width)} fs={fs} />
      <DimV y1={0} y2={room.depth} x={-T - closetDepthOn(room, 'west') - fs * 1.6} label={fmt(room.depth)} fs={fs} />

      {cabinets.map(c => {
        const p = drag?.id === c.id ? drag.placement : c.placement;
        const r = placedRect(p, c.box);
        const [[fx0, fy0], [fx1, fy1]] = frontLine(p, c.box);
        const selected = c.id === selectedId;
        const cls = ['room-plan-cabinet', selected && 'is-selected', c.wallHung && 'is-hung', flagged?.has(c.id) && 'is-flagged'].filter(Boolean).join(' ');
        return (
          <g
            key={c.id}
            className={cls}
            tabIndex={0}
            role="button"
            aria-pressed={selected}
            aria-label={`${c.label}, ${fmt(r.x0)} from the left wall and ${fmt(r.y0)} from the top wall${editable ? '. Arrow keys move it, R turns it, Delete takes it out of the room.' : ''}`}
            onPointerDown={e => onPointerDown(e, c)}
            onFocus={() => onSelect?.(c.id)}
            onKeyDown={e => onKeyDown(e, c)}
          >
            <title>{c.label}{c.wallHung ? ' (wall-hung)' : ''}</title>
            <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} />
            <line className="room-plan-front" x1={fx0} y1={fy0} x2={fx1} y2={fy1} />
            <text x={(r.x0 + r.x1) / 2} y={(r.y0 + r.y1) / 2} fontSize={Math.min(fs * 0.9, (r.x1 - r.x0) / 4, (r.y1 - r.y0) / 1.6)} textAnchor="middle" dominantBaseline="central">
              {c.label.length > 18 ? `${c.label.slice(0, 17)}…` : c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function closetDepthOn(room: Room, wall: Wall): number {
  return Math.max(0, ...room.openings.filter(o => o.kind === 'closet' && o.wall === wall).map(o => o.depth ?? 0));
}

/** A point `n` inches into the room from the wall's inside face, `a` along it. Negative n is outside. */
function wallPoint(room: Room, wall: Wall, a: number, n: number): [number, number] {
  if (wall === 'north') return [a, n];
  if (wall === 'south') return [a, room.depth - n];
  if (wall === 'west') return [n, a];
  return [room.width - n, a];
}

function OpeningMark({ room, opening: o, fs }: { room: Room; opening: RoomOpening; fs: number }) {
  const T = WALL_THICKNESS;
  const a0 = o.offset;
  const a1 = o.offset + o.width;
  const gap = wallBand(room, o.wall, a0, a1);
  const gapRect = <rect className="room-plan-gap" x={gap.x0} y={gap.y0} width={gap.x1 - gap.x0} height={gap.y1 - gap.y0} />;
  const line = (p: [number, number], q: [number, number], cls: string, key?: string) => <line key={key} className={cls} x1={p[0]} y1={p[1]} x2={q[0]} y2={q[1]} />;

  if (o.kind === 'window') {
    return (
      <g className="room-plan-window">
        {gapRect}
        {line(wallPoint(room, o.wall, a0, -T * 0.35), wallPoint(room, o.wall, a1, -T * 0.35), 'room-plan-glass')}
        {line(wallPoint(room, o.wall, a0, -T * 0.65), wallPoint(room, o.wall, a1, -T * 0.65), 'room-plan-glass')}
        <title>Window</title>
      </g>
    );
  }
  if (o.kind === 'door') {
    const inward = o.swing !== 'out';
    const n0 = inward ? 0 : -T;
    const s = inward ? 1 : -1;
    const hingeA = o.hinge === 'end' ? a1 : a0;
    const sa = o.hinge === 'end' ? -1 : 1;
    const arc: [number, number][] = [];
    for (let i = 0; i <= 16; i++) {
      const t = (Math.PI / 2) * (i / 16);
      arc.push(wallPoint(room, o.wall, hingeA + sa * o.width * Math.cos(t), n0 + s * o.width * Math.sin(t)));
    }
    return (
      <g className="room-plan-door">
        {gapRect}
        {line(wallPoint(room, o.wall, hingeA, n0), wallPoint(room, o.wall, hingeA, n0 + s * o.width), 'room-plan-leaf')}
        <polyline className="room-plan-swing" points={arc.map(p => p.join(',')).join(' ')} />
        <title>Door</title>
      </g>
    );
  }
  if (o.kind === 'closet') {
    const depth = o.depth ?? 24;
    const back = wallBand(room, o.wall, a0, a1, T + depth);
    const [lx, ly] = wallPoint(room, o.wall, (a0 + a1) / 2, -T - depth / 2);
    return (
      <g className="room-plan-closet">
        <rect className="room-plan-closet-space" x={back.x0} y={back.y0} width={back.x1 - back.x0} height={back.y1 - back.y0} />
        {gapRect}
        <text x={lx} y={ly} fontSize={fs * 0.8} textAnchor="middle" dominantBaseline="central">Closet</text>
      </g>
    );
  }
  return <g className="room-plan-opening">{gapRect}<title>Open doorway</title></g>;
}
