// Top view of a room for Built-in Studio projects: walls with their windows, doors
// and closets, and the project's cabinets, which can be dragged (pointer or
// keyboard) and dropped in from the cabinet list. Windows, doors, closets and doorways
// can be dragged along their wall, with their positions dimensioned outside it.

import { useRef, useState, type DragEvent, type KeyboardEvent, type PointerEvent } from 'react';
import { DimH, DimV } from './builderControls';
import {
  WALL_THICKNESS, clampPlacement, frontLine, modelToPlan, nextRotation, placedRect, snapPlacement, rectsTouch, wallBand, wallLength, wallsTouching,
  type CabinetBox, type Placement, type Room, type RoomOpening, type Wall,
} from '../lib/builtinRoom';

export interface PlanCabinet {
  id: number;
  label: string;
  placement: Placement;
  box: CabinetBox;
  wallHung: boolean;
  /** A corner design's L from above (model x and z); otherwise its box is drawn. */
  outline?: [number, number][] | null;
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
  /** The selected window, door, closet or doorway. */
  selectedOpeningId?: string | null;
  onSelectOpening?: (id: string | null) => void;
  /** An opening was dragged (or nudged) along its wall to `offset` from its start corner. */
  onMoveOpening?: (id: string, offset: number) => void;
  /** Dimension each opening's position along its wall. */
  openingDims?: boolean;
  label: string;
}

/** The MIME type cabinet-list items carry when dragged onto the plan. */
export const CABINET_DRAG_TYPE = 'application/x-workshop-cabinet';

export default function RoomPlan({ room, cabinets = [], fmt, selectedId = null, flagged, editable = false, onSelect, onMove, onRemove, onDrop,
  selectedOpeningId = null, onSelectOpening, onMoveOpening, openingDims = false, label }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ id: number; dx: number; dy: number; placement: Placement; moved: boolean } | null>(null);
  const [dropHover, setDropHover] = useState(false);
  const [openingDrag, setOpeningDrag] = useState<{ id: string; grab: number; offset: number; moved: boolean } | null>(null);

  const T = WALL_THICKNESS;
  const closetDepth = Math.max(0, ...room.openings.filter(o => o.kind === 'closet').map(o => o.depth ?? 0));
  const fs = Math.max(room.width, room.depth) / 38;
  const chainWalls = new Set(openingDims ? room.openings.filter(o => room.walls[o.wall]).map(o => o.wall) : []);
  // Room for a row of position dimensions outside a wall, inside the overall one.
  const chainRoom = (wall: Wall) => (chainWalls.has(wall) ? fs * 1.3 : 0);
  const margin = T + closetDepth + fs * 3.2 + (chainWalls.size ? fs * 1.3 : 0);
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

  // While an opening is dragged, the plan draws it where it's been dragged to.
  const shown: Room = openingDrag
    ? { ...room, openings: room.openings.map(o => (o.id === openingDrag.id ? { ...o, offset: openingDrag.offset } : o)) }
    : room;
  const along = (wall: Wall, [x, y]: [number, number]) => (wall === 'north' || wall === 'south' ? x : y);
  const clampOffset = (o: RoomOpening, offset: number) =>
    Math.min(Math.max(0, wallLength(room, o.wall) - o.width), Math.max(0, Math.round(offset * 4) / 4));

  const onOpeningPointerDown = (e: PointerEvent<SVGGElement>, o: RoomOpening) => {
    onSelectOpening?.(o.id);
    if (!editable || !onMoveOpening || e.button !== 0) return;
    const at = toPlan(e.clientX, e.clientY);
    if (!at) return;
    e.preventDefault();
    e.stopPropagation();
    svgRef.current?.setPointerCapture(e.pointerId);
    setOpeningDrag({ id: o.id, grab: along(o.wall, at) - o.offset, offset: o.offset, moved: false });
  };
  const onOpeningKeyDown = (e: KeyboardEvent<SVGGElement>, o: RoomOpening) => {
    if (e.key === 'Escape') { onSelectOpening?.(null); return; }
    if (!editable || !onMoveOpening) return;
    const step = e.shiftKey ? 12 : e.altKey ? 0.25 : 1;
    const by: Record<string, number> = { ArrowLeft: -step, ArrowUp: -step, ArrowRight: step, ArrowDown: step };
    if (by[e.key] === undefined) return;
    e.preventDefault();
    onMoveOpening(o.id, clampOffset(o, o.offset + by[e.key]));
  };

  const others = (id: number) => cabinets.filter(c => c.id !== id);
  // While a cabinet is dragged, the walls it's snapped against light up.
  const dragged = drag?.moved ? cabinets.find(c => c.id === drag.id) : undefined;
  const draggedRect = dragged && drag ? placedRect(drag.placement, dragged.box) : null;
  const snappedWalls = new Set(draggedRect ? wallsTouching(room, draggedRect) : []);
  // ...and so do the cabinets it's butted up against.
  const snappedCabinets = new Set(draggedRect ? cabinets.filter(c => c.id !== drag?.id && rectsTouch(draggedRect, placedRect(c.placement, c.box))).map(c => c.id) : []);

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
    if (openingDrag) {
      const at = toPlan(e.clientX, e.clientY);
      const o = room.openings.find(x => x.id === openingDrag.id);
      if (!at || !o) return;
      const offset = clampOffset(o, along(o.wall, at) - openingDrag.grab);
      if (offset !== openingDrag.offset) setOpeningDrag({ ...openingDrag, offset, moved: true });
      return;
    }
    if (!drag) return;
    const at = toPlan(e.clientX, e.clientY);
    const c = cabinets.find(x => x.id === drag.id);
    if (!at || !c) return;
    const x = at[0] - drag.dx;
    const y = at[1] - drag.dy;
    // Alt places it freely; otherwise it snaps to walls within about 28px on screen, neighbours within 12px.
    const perPx = 1 / (svgRef.current?.getScreenCTM()?.a || 1);
    const snapped = e.altKey
      ? clampPlacement(room, c.box, { x, y, rotation: drag.placement.rotation })
      : snapPlacement({
        room, box: c.box, x, y, rotation: drag.placement.rotation,
        others: others(c.id).map(o => ({ rect: placedRect(o.placement, o.box), bottom: o.box.minY, top: o.box.maxY })),
        wallSnap: 28 * perPx, edgeSnap: 12 * perPx,
      });
    setDrag({ ...drag, placement: { x: snapped.x, y: snapped.y, rotation: snapped.rotation }, moved: true });
  };
  const endDrag = () => {
    if (openingDrag) {
      if (openingDrag.moved) onMoveOpening?.(openingDrag.id, openingDrag.offset);
      setOpeningDrag(null);
      return;
    }
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
      className={`room-plan${editable ? ' is-editable' : ''}${dropHover ? ' is-drop-target' : ''}${drag || openingDrag ? ' is-dragging' : ''}`}
      viewBox={viewBox}
      role="group"
      aria-label={label}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerDown={e => {
        if (e.target === e.currentTarget || (e.target as Element).classList.contains('room-plan-floor')) { onSelect?.(null); onSelectOpening?.(null); }
      }}
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
        return <rect key={w} className={`room-plan-wall${snappedWalls.has(w) ? ' is-snapped' : ''}`} x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />;
      })}
      {shown.openings.filter(o => room.walls[o.wall]).map((o, i) => {
        const interactive = Boolean(onSelectOpening || (editable && onMoveOpening));
        const selected = o.id === selectedOpeningId;
        const hit = wallBand(room, o.wall, o.offset, o.offset + o.width, T + fs * 0.9);
        const inner = wallBand(room, o.wall, o.offset, o.offset + o.width, fs * 0.9);
        // The wall band plus a little of the room in front of it, so a thin window is easy to grab.
        const box = {
          x0: Math.min(hit.x0, inner.x0, wallPoint(room, o.wall, o.offset, fs * 0.9)[0]),
          x1: Math.max(hit.x1, inner.x1, wallPoint(room, o.wall, o.offset + o.width, fs * 0.9)[0]),
          y0: Math.min(hit.y0, inner.y0, wallPoint(room, o.wall, o.offset, fs * 0.9)[1]),
          y1: Math.max(hit.y1, inner.y1, wallPoint(room, o.wall, o.offset + o.width, fs * 0.9)[1]),
        };
        const name = `${OPENING_NAMES[o.kind]} ${room.openings.findIndex(x => x.id === o.id) + 1 || i + 1}`;
        const mark = <OpeningMark room={shown} opening={o} fs={fs} />;
        if (!interactive) return <g key={o.id}>{mark}</g>;
        return (
          <g
            key={o.id}
            className={`room-plan-opening-item${selected ? ' is-selected' : ''}`}
            tabIndex={0}
            role="button"
            aria-pressed={selected}
            aria-label={`${name} on the ${WALL_NAMES[o.wall]} wall, ${fmt(o.offset)} ${o.wall === 'north' || o.wall === 'south' ? 'from the left corner' : 'from the top corner'}${editable && onMoveOpening ? '. Drag it or use the arrow keys to slide it along the wall.' : ''}`}
            onPointerDown={e => onOpeningPointerDown(e, o)}
            onFocus={() => onSelectOpening?.(o.id)}
            onKeyDown={e => onOpeningKeyDown(e, o)}
          >
            <rect className="room-plan-hit" x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />
            {mark}
          </g>
        );
      })}

      {[...chainWalls].map(w => <ChainDims key={w} room={shown} wall={w} fs={fs} fmt={fmt} selectedId={selectedOpeningId} />)}

      <DimH x1={0} x2={room.width} y={-T - closetDepthOn(room, 'north') - chainRoom('north') - fs * 1.6} label={fmt(room.width)} fs={fs} />
      <DimV y1={0} y2={room.depth} x={-T - closetDepthOn(room, 'west') - chainRoom('west') - fs * 1.6} label={fmt(room.depth)} fs={fs} />

      {cabinets.map(c => {
        const p = drag?.id === c.id ? drag.placement : c.placement;
        const r = placedRect(p, c.box);
        const [[fx0, fy0], [fx1, fy1]] = frontLine(p, c.box);
        const selected = c.id === selectedId;
        const cls = ['room-plan-cabinet', selected && 'is-selected', c.wallHung && 'is-hung', flagged?.has(c.id) && 'is-flagged', snappedCabinets.has(c.id) && 'is-snapped'].filter(Boolean).join(' ');
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
            {c.outline
              ? <polygon points={c.outline.map(([x, z]) => modelToPlan(p, c.box, x, z).join(',')).join(' ')} />
              : <rect x={r.x0} y={r.y0} width={r.x1 - r.x0} height={r.y1 - r.y0} />}
            {!c.outline && <line className="room-plan-front" x1={fx0} y1={fy0} x2={fx1} y2={fy1} />}
            <text x={(r.x0 + r.x1) / 2} y={(r.y0 + r.y1) / 2} fontSize={Math.min(fs * 0.9, (r.x1 - r.x0) / 4, (r.y1 - r.y0) / 1.6)} textAnchor="middle" dominantBaseline="central">
              {c.label.length > 18 ? `${c.label.slice(0, 17)}…` : c.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

const OPENING_NAMES: Record<RoomOpening['kind'], string> = { window: 'Window', door: 'Door', closet: 'Closet', opening: 'Doorway' };
const WALL_NAMES: Record<Wall, string> = { north: 'top', east: 'right', south: 'bottom', west: 'left' };

/**
 * A row of dimensions just outside a wall: corner to each opening, each opening's width,
 * and on to the far corner. The selected opening's numbers are highlighted.
 */
function ChainDims({ room, wall, fs, fmt, selectedId }: { room: Room; wall: Wall; fs: number; fmt: (inches: number) => string; selectedId: string | null }) {
  const len = wallLength(room, wall);
  const ops = room.openings.filter(o => o.wall === wall).sort((a, b) => a.offset - b.offset);
  const marks = new Set<number>([0, len]);
  for (const o of ops) { marks.add(o.offset); marks.add(o.offset + o.width); }
  const pts = [...marks].filter(a => a >= 0 && a <= len).sort((a, b) => a - b);
  const n = -WALL_THICKNESS - closetDepthOn(room, wall) - fs * 1.1;
  const sel = ops.find(o => o.id === selectedId);
  const small = fs * 0.78;
  return (
    <g className="room-plan-chain">
      {pts.slice(1).map((b, i) => {
        const a = pts[i];
        if (b - a < 0.01) return null;
        const isSel = sel !== undefined && a >= sel.offset - 0.01 && b <= sel.offset + sel.width + 0.01;
        const touches = sel !== undefined && (Math.abs(a - sel.offset - sel.width) < 0.01 || Math.abs(b - sel.offset) < 0.01);
        const cls = isSel || touches ? 'is-selected' : undefined;
        // Too short for its label: keep the line and let the title carry the number.
        const label = b - a < small * 2.2 ? '' : fmt(b - a);
        const [p, q] = [wallPoint(room, wall, a, n), wallPoint(room, wall, b, n)];
        return (
          <g key={`${a}-${b}`} className={cls}>
            <title>{fmt(b - a)}</title>
            {wall === 'north' || wall === 'south'
              ? <DimH x1={p[0]} x2={q[0]} y={p[1]} fs={small} label={label} />
              : <DimV y1={p[1]} y2={q[1]} x={p[0]} fs={small} label={label} />}
          </g>
        );
      })}
    </g>
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
