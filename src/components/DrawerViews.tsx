// Side and top views for the Built-in Studio drawing, beside the front elevation.
// Each view is a list of simple shapes in model inches (y up), framed and dimensioned
// generically, so desks, bookcases and wall runs all draw the same way.

import { DimH, DimV } from './builderControls';
import { DESK_LEG_INSET, DESK_LEG_SIZE, FOOT_SIZE, FOOT_INSET, type DrawerConfig, type DrawerPlan } from '../lib/drawerUnit';

type Shape =
  | { kind: 'rect'; x: number; y: number; w: number; h: number; cls: string }
  | { kind: 'poly'; pts: [number, number][]; cls: string }
  | { kind: 'circle'; cx: number; cy: number; r: number; cls: string }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; cls: string };

interface ViewProps { plan: DrawerPlan; config: DrawerConfig; fmt: (inches: number) => string }

const rect = (x0: number, y0: number, x1: number, y1: number, cls = 'shelf-ply'): Shape =>
  ({ kind: 'rect', x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0), cls });

/** Frames the shapes, flips y so up is up, and adds an overall width dimension and the given heights. */
function View({ shapes, label, caption, fmt, vertical, horizontal }: {
  shapes: Shape[]; label: string; caption: string; fmt: (inches: number) => string;
  /** Vertical dimensions (model y from–to) at the right. */
  vertical: [number, number][];
  /** The horizontal span to dimension (model x from–to); defaults to everything drawn. */
  horizontal?: [number, number];
}) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const s of shapes) {
    if (s.kind === 'rect') { xs.push(s.x, s.x + s.w); ys.push(s.y, s.y + s.h); }
    else if (s.kind === 'poly') for (const [x, y] of s.pts) { xs.push(x); ys.push(y); }
    else if (s.kind === 'circle') { xs.push(s.cx - s.r, s.cx + s.r); ys.push(s.cy - s.r, s.cy + s.r); }
    else { xs.push(s.x1, s.x2); ys.push(s.y1, s.y2); }
  }
  if (!xs.length) return null;
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const w = x1 - x0;
  const h = y1 - y0;
  const pad = Math.max(w, h) * 0.14;
  const fs = Math.max(w, h) * 0.035;
  const Y = (v: number) => y1 - v;
  const [hx0, hx1] = horizontal ?? [x0, x1];
  return (
    <figure className="shelf-drawing is-view">
      <svg viewBox={`${x0 - pad * 0.4} ${-pad * 0.5} ${w + pad * (0.8 + 0.55 * Math.max(vertical.length, 1))} ${h + pad * 1.4}`} role="img" aria-label={label}>
        {shapes.map((s, i) => {
          if (s.kind === 'rect') return <rect key={i} className={s.cls} x={s.x} y={Y(s.y + s.h)} width={s.w} height={s.h} />;
          if (s.kind === 'poly') return <polygon key={i} className={s.cls} points={s.pts.map(([x, y]) => `${x},${Y(y)}`).join(' ')} />;
          if (s.kind === 'circle') return <circle key={i} className={s.cls} cx={s.cx} cy={Y(s.cy)} r={s.r} />;
          return <line key={i} className={s.cls} x1={s.x1} y1={Y(s.y1)} x2={s.x2} y2={Y(s.y2)} />;
        })}
        <DimH x1={hx0} x2={hx1} y={Y(y0) + pad * 0.45} fs={fs} label={fmt(hx1 - hx0)} />
        {vertical.map(([a, b], i) => (
          <DimV key={i} y1={Y(b)} y2={Y(a)} x={x1 + pad * (0.3 + 0.5 * i)} fs={fs} label={fmt(b - a)} />
        ))}
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

/** From the right-hand side: front at the left, the case, base, fronts, and what's on top. */
export function SideView({ plan, config, fmt }: ViewProps) {
  const T = config.thickness;
  const H = plan.overallHeight;
  const B = plan.baseHeight;
  const cd = plan.caseDepth;
  const lift = plan.lift;
  const zf = plan.frontInset;
  const shapes: Shape[] = [];
  const at = (y: number) => y + lift;
  // The case side (notched at the bottom front for an integrated toe kick).
  const bp = plan.base;
  if (bp?.kind === 'kick') {
    shapes.push({ kind: 'poly', cls: 'shelf-ply', pts: [[0, B], [bp.setback, B], [bp.setback, 0], [cd, 0], [cd, H], [0, H]] });
  } else {
    shapes.push(rect(0, at(plan.sideBottom), cd, at(H)));
  }
  // Fronts, seen edge on: in front of the case (overlay) or flush in it (inset).
  for (const d of plan.drawers) {
    if (d.open && !d.door) continue;
    const [z0, z1] = zf > 0 ? [0, T] : [-T, 0];
    shapes.push(rect(z0, at(d.front.y), z1, at(d.front.y + d.front.height), 'drawer-front-shape'));
  }
  // The base.
  if (bp && bp.kind !== 'kick') shapes.push(rect(bp.setback, 0, cd, B, 'drawer-foot'));
  if (bp?.baseboard) {
    const bb = bp.baseboard;
    shapes.push(bb.faces.includes('right') ? rect(-bb.thickness, 0, cd, bb.height, 'shelf-ply drawer-baseboard') : rect(-bb.thickness, 0, 0, bb.height, 'shelf-ply drawer-baseboard'));
  }
  if (plan.supports > 0 && !bp && B > 0) {
    if (config.base === 'casters') for (const z of [2.5, cd - 2.5]) shapes.push({ kind: 'circle', cx: z, cy: B / 2, r: B / 2 * 0.9, cls: 'drawer-foot' });
    else for (const z of [FOOT_INSET, cd - FOOT_INSET - FOOT_SIZE]) shapes.push(rect(z, 0, z + FOOT_SIZE, B, 'drawer-foot'));
  }
  if (plan.mount === 'wall') shapes.push({ kind: 'line', x1: cd + 0.5, y1: 0, x2: cd + 0.5, y2: at(H) + 6, cls: 'drawer-door-swing' });
  if (plan.mount === 'under-desk') {
    const u = config.mountHeight ?? 28;
    shapes.push(rect(-2, u, cd + 2, u + 1.5, 'shelf-ply drawer-existing'));
  }
  // A desk top over the units, and a one-unit desk's legs or end panel (seen from the side).
  const dk = plan.desk;
  if (dk) {
    shapes.push(rect(cd - dk.depth, H, cd, H + dk.topThickness));
    if (dk.openEnd?.kind === 'legs') {
      for (const z of [cd - dk.depth + DESK_LEG_INSET, cd - DESK_LEG_INSET - DESK_LEG_SIZE]) shapes.push(rect(z, 0, z + DESK_LEG_SIZE, dk.openEnd.height, 'drawer-foot'));
    }
  }
  // The countertop and the bookcase (or the run's), with its top trim.
  const bk = plan.bookcase;
  const run = plan.run;
  const counter = run ? run.countertop : bk?.countertop;
  if (counter) shapes.push(rect(counter.z0, counter.y0, counter.z1, counter.y1));
  if (bk) {
    const y0 = run?.uppers ? run.uppers.y0 : bk.y0;
    const topY = run?.uppers ? run.uppers.topY : bk.topY;
    shapes.push(rect(bk.z0, y0, cd, topY));
    shapes.push(rect(bk.z0, y0 + bk.shelfPlan.kick, cd, y0 + bk.shelfPlan.kick + T));
    shapes.push(rect(bk.z0, topY - T, cd, topY));
    const cap = run ? run.cap : bk.cap;
    const crown = run ? run.crown : bk.crown;
    if (cap) shapes.push(rect(cap.z0, cap.y0, cap.z1, cap.y1));
    if (crown) shapes.push(rect(crown.front - crown.projection, topY, crown.front, topY + crown.height, 'shelf-ply drawer-baseboard'));
  }
  const top = Math.max(at(H), plan.totalHeight);
  const vertical: [number, number][] = [[0, at(H)]];
  if (top > at(H) + 1e-6) vertical.push([0, top]);
  return (
    <View shapes={shapes} fmt={fmt} vertical={vertical}
      label={`Side view: ${fmt(plan.overallDepth)} deep, ${fmt(top)} tall`}
      caption="Side view, from the right: front at the left" />
  );
}

/** From above: front at the bottom — each unit's footprint, the top, legs, fillers and uppers. */
export function TopView({ plan, config, fmt }: ViewProps) {
  const T = config.thickness;
  const W = plan.overallWidth;
  const cd = plan.caseDepth;
  const zf = plan.frontInset;
  const shapes: Shape[] = [];
  const run = plan.run;
  const dk = plan.desk;
  const unitXs = run ? run.sections.filter(s => s.kind === 'cabinet').map(s => s.x) : dk ? dk.unitXs : [0];
  for (const x of unitXs) {
    shapes.push(rect(x, 0, x + W, cd));
    // The sides and back, so each case reads as a box from above.
    shapes.push(rect(x, 0, x + T, cd, 'shelf-ply is-shelf'));
    shapes.push(rect(x + W - T, 0, x + W, cd, 'shelf-ply is-shelf'));
    if (zf === 0) shapes.push(rect(x, -T, x + W, 0, 'drawer-front-shape'));
    const bb = plan.base?.baseboard;
    if (bb && !run) {
      shapes.push(rect(x - (bb.faces.includes('left') ? bb.thickness : 0), -bb.thickness, x + W + (bb.faces.includes('right') ? bb.thickness : 0), 0, 'shelf-ply drawer-baseboard'));
    }
  }
  if (dk) {
    shapes.push(rect(0, cd - dk.depth, dk.width, cd, 'drawer-overhead'));
    if (dk.openEnd?.kind === 'legs') {
      const r = DESK_LEG_SIZE / 2;
      const cx = dk.openEnd.side === 'right' ? dk.width - DESK_LEG_INSET - r : DESK_LEG_INSET + r;
      for (const cz of [cd - dk.depth + DESK_LEG_INSET + r, cd - DESK_LEG_INSET - r]) shapes.push({ kind: 'circle', cx, cy: cz, r, cls: 'drawer-foot' });
    } else if (dk.openEnd?.kind === 'panel' || dk.openEnd?.kind === 'ledger') {
      const x0 = dk.openEnd.side === 'right' ? dk.width - T : 0;
      shapes.push(rect(x0, cd - dk.depth, x0 + T, cd, dk.openEnd.kind === 'ledger' ? 'drawer-foot' : 'shelf-ply'));
    }
  }
  if (run) {
    for (const f of run.fillers) shapes.push(rect(f.x, zf > 0 ? 0 : -T, f.x + f.width, (zf > 0 ? 0 : -T) + T));
    const c = run.countertop;
    shapes.push(rect(c.x0, c.z0, c.x1, c.z1, 'drawer-overhead'));
    if (run.uppers && plan.bookcase) {
      const bay = run.corner?.bay;
      const [u0, u1] = bay ? (run.corner!.side === 'right' ? [0, bay.x0] : [bay.x1, run.width]) : [0, run.width];
      shapes.push(rect(u0, plan.bookcase.z0, u1, cd, 'drawer-overhead is-upper'));
    }
    const cn = run.corner;
    if (cn) {
      // The return, seen from above: its x runs forward from the back wall (down the drawing).
      const right = cn.side === 'right';
      const X = (z: number) => (right ? run.width - cd + z : cd - z);
      const Z = (u: number) => cd - u;
      const along = (u0: number, u1: number, z0: number, z1: number, cls = 'shelf-ply') => rect(X(z0), Z(u0), X(z1), Z(u1), cls);
      for (const sec of cn.sections) {
        if (sec.kind !== 'cabinet') continue;
        shapes.push(along(sec.x, sec.x + W, 0, cd));
        shapes.push(along(sec.x, sec.x + T, 0, cd, 'shelf-ply is-shelf'));
        shapes.push(along(sec.x + W - T, sec.x + W, 0, cd, 'shelf-ply is-shelf'));
        if (zf === 0) shapes.push(along(sec.x, sec.x + W, -T, 0, 'drawer-front-shape'));
      }
      const fz: [number, number] = zf > 0 ? [0, T] : [-T, 0];
      shapes.push(along(cn.cornerFiller.x, cn.cornerFiller.x + cn.cornerFiller.width, fz[0], fz[1]));
      if (cn.filler && cn.filler.width > 0) shapes.push(along(cn.filler.x, cn.filler.x + cn.filler.width, fz[0], fz[1]));
      const ct = cn.countertop;
      shapes.push(along(ct.x0, ct.x1, ct.z0, ct.z1, 'drawer-overhead'));
      const cabs = cn.sections.filter(x => x.kind === 'cabinet');
      if (run.uppers && plan.bookcase && cabs.length) {
        const last = cabs[cabs.length - 1];
        shapes.push(along(cabs[0].x, last.x + last.width, plan.bookcase.z0, cd, 'drawer-overhead is-upper'));
      }
    }
  } else if (plan.bookcase) {
    const bk = plan.bookcase;
    if (bk.countertop) shapes.push(rect(bk.countertop.x0, bk.countertop.z0, bk.countertop.x1, bk.countertop.z1, 'drawer-overhead'));
    shapes.push(rect(0, bk.z0, W, cd, 'drawer-overhead is-upper'));
  }
  const allZ = shapes.flatMap(s => (s.kind === 'rect' ? [s.y, s.y + s.h] : s.kind === 'circle' ? [s.cy - s.r, s.cy + s.r] : []));
  const span: [number, number] = [Math.min(...allZ), Math.max(...allZ)];
  const width = run ? run.width : dk ? dk.width : W;
  return (
    <View shapes={shapes} fmt={fmt} vertical={[span]} horizontal={[0, width]}
      label={`Top view: ${fmt(width)} wide, ${fmt(span[1] - span[0])} deep`}
      caption="Top view: front at the bottom; dashed outlines are the tops above" />
  );
}
