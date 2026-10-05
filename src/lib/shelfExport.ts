// CNC / Shaper Origin export for Shelf Builder parts.
//
// Each machined face of each part is described in its own 2D frame:
//   u — along the part's length (from its bottom or left end)
//   v — across its width (from the front edge; for doors, from the hinge edge)
// looking at the face being machined. Features are pockets (dados, rabbets,
// hinge cups) and drilled holes (shelf pins), each with a depth.
//
// SVG files follow Shaper's colour convention (black fill = outside cut, grey
// fill = pocket, blue stroke = guide) and carry shaper:cutType / cutDepth
// attributes; they are sized in real units so they import at scale. DXF files
// put the cut type and depth in the layer name (OUTSIDE_0.750in, POCKET_0.250in,
// DRILL_0.375in) for CAM programs to map to toolpaths.

import type { SheetLayout } from './cutPlan.ts';
import { MM_PER_INCH, PIN_MARGIN, type LengthUnit, type ShelfConfig, type ShelfPlan } from './shelving.ts';
import { hingesPerDoor } from './shelfEstimate.ts';

export type Feature =
  | { kind: 'pocket'; label: string; u: number; v: number; length: number; width: number; depth: number }
  | { kind: 'hole'; label: string; u: number; v: number; radius: number; depth: number }
  /** A layout line that isn't cut (e.g. where a drawer slide goes): Shaper's guide, DXF layer GUIDE. */
  | { kind: 'guide'; label: string; points: [number, number][]; closed?: boolean }
  /** A closed hole cut right through (e.g. a hand hole): Shaper's inside cut, DXF layer INSIDE_<depth>. */
  | { kind: 'cutout'; label: string; points: [number, number][] }
  /** A shaped pocket (a tool's outline, with any islands as extra rings), cut to `depth`. */
  | { kind: 'pocketPath'; label: string; rings: [number, number][][]; depth: number };

export interface PartFace {
  /** Stable id, e.g. "divider-1-left". */
  id: string;
  /** Cut-list part this comes from. */
  part: string;
  /** Which physical piece, e.g. "Divider 1" or "Left side". */
  piece: string;
  /** Which face is machined, e.g. "left face". Empty for parts with nothing to machine. */
  face: string;
  length: number;
  width: number;
  thickness: number;
  features: Feature[];
  /** Where u and v start, in words, so the part goes on the machine the right way round. */
  orientation: string;
  material: 'plywood' | 'solid';
  /**
   * A shaped outside cut in (u, v), e.g. a drawer front with its finger-pull notch.
   * Without one the outline is the length × width rectangle.
   */
  outline?: [number, number][];
  /**
   * Whether (u, v, face normal) is right-handed. Drawings must honour this or the
   * face comes out mirrored — dados and holes on the wrong side of the panel.
   */
  rightHanded: boolean;
}

const HINGE_CUP_RADIUS = 35 / 2 / MM_PER_INCH;
/** Cup centre from the door edge: 17.5 mm radius + ~5 mm boring distance. */
const HINGE_CUP_INSET = 22.5 / MM_PER_INCH;
const HINGE_CUP_DEPTH = 13 / MM_PER_INCH;
const HINGE_END_OFFSET = 3;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Hinge-cup centres along a door's height: 3" from each end, the rest evenly between. */
export function hingePositions(height: number): number[] {
  const count = hingesPerDoor(height);
  const first = HINGE_END_OFFSET;
  const last = height - HINGE_END_OFFSET;
  return Array.from({ length: count }, (_, i) => first + (last - first) * i / (count - 1));
}

/**
 * Every face that needs machining (and every plain part, once), with its
 * features in the face's own frame.
 */
export function partFaces(plan: ShelfPlan, config: ShelfConfig): PartFace[] {
  const t = config.thickness;
  const D = config.shelfDepth;
  const d = plan.dadoDepth;
  const H = plan.overallHeight;
  const n = plan.bays.length;
  const faces: PartFace[] = [];
  const dividerBottom = config.bottomPanel ? plan.interiorBottom - d : 0;

  // Banded case parts are cut narrower; their features are measured from the plywood edge, not the banding.
  const front = plan.banding?.caseFronts ? plan.banding.thickness : 0;
  const dado = (label: string, at: number): Feature => ({ kind: 'pocket', label, u: at, v: 0, length: t, width: D - front, depth: d });
  const pins = (panel: string, face: 'left' | 'right', origin: number): Feature[] =>
    plan.pinHoles.filter(r => r.panel === panel && r.face === face).flatMap(run =>
      run.ys.flatMap(y => [run.frontInset, run.backInset].map(v => ({
        kind: 'hole' as const, label: 'Shelf pin', u: y - origin, v: v - front, radius: plan.pinDiameter / 2, depth: plan.pinDepth,
      }))));

  for (const part of plan.parts) {
    const base = { part: part.name, length: part.length, width: part.width, thickness: part.thickness, material: part.material ?? 'plywood' as const };
    if (part.name === 'Side') {
      // Left side inside face points +X: u = up, v = toward the back → left-handed. Right side mirrors it.
      for (const [piece, insideFace, rightHanded] of [['Left side', 'right', false], ['Right side', 'left', true]] as const) {
        const features: Feature[] = [];
        if (d > 0) {
          const bay = piece === 'Left side' ? plan.bays[0] : plan.bays[n - 1];
          bay.shelfYs.forEach((y, i) => features.push(dado(`Shelf dado ${i + 1}`, y)));
          if (config.bottomPanel) features.push(dado('Bottom dado', plan.kick));
          if (config.topPanel) features.push(dado('Top dado', H - t));
        }
        if (plan.backRabbet > 0) {
          features.push({ kind: 'pocket', label: plan.cleatGap > 0 ? 'Back groove' : 'Back rabbet', u: 0, v: D - front, length: H, width: plan.backThickness, depth: plan.backRabbet });
        }
        features.push(...pins(piece, insideFace, 0));
        faces.push({
          ...base, id: slug(`${piece} inside`), piece, face: features.length ? 'inside face' : '', features, rightHanded,
          orientation: describe('bottom end', rightHanded, 'inside face'),
        });
      }
      continue;
    }
    if (part.name === 'Divider') {
      for (let k = 1; k <= n - 1; k++) {
        const piece = `Divider ${k}`;
        for (const side of ['left', 'right'] as const) {
          const bay = side === 'left' ? plan.bays[k - 1] : plan.bays[k];
          const features: Feature[] = d > 0 ? bay.shelfYs.map((y, i) => dado(`Shelf dado ${i + 1}`, y - dividerBottom)) : [];
          features.push(...pins(piece, side, dividerBottom));
          if (features.length === 0 && side === 'right') continue; // a plain divider needs one file, not two
          const rightHanded = side === 'left'; // left face points −X, like the right side's inside face
          faces.push({
            ...base, id: slug(`${piece} ${side}`), piece, face: features.length ? `${side} face` : '', features, rightHanded,
            orientation: describe('bottom end', rightHanded, `${side} face`),
          });
        }
      }
      continue;
    }
    if (part.name === 'Top' || part.name === 'Bottom') {
      const features: Feature[] = d > 0 ? plan.dividerXs.map((x, j) => dado(`Divider ${j + 1} dado`, x - (t - d))) : [];
      const rightHanded = part.name === 'Bottom'; // the top's underside points −Y and comes out left-handed
      const faceName = part.name === 'Top' ? 'underside' : 'top face';
      faces.push({
        ...base, id: slug(part.name), piece: part.name, face: features.length ? faceName : '', features, rightHanded,
        orientation: describe('left end', rightHanded, faceName),
      });
      continue;
    }
    if (part.name.startsWith('Door')) {
      // Hinge positions are set from the finished (banded) edges; the file is the cut plywood.
      const band = plan.banding ? plan.banding.thickness : 0;
      const finished = part.length + 2 * band;
      const features: Feature[] = hingePositions(finished).map((u, i) => ({
        kind: 'hole', label: `Hinge cup ${i + 1}`, u: u - band, v: HINGE_CUP_INSET - band, radius: HINGE_CUP_RADIUS, depth: HINGE_CUP_DEPTH,
      }));
      faces.push({
        ...base, id: slug(part.name), piece: part.name, face: 'inside face', features, rightHanded: true,
        orientation: `${describe('bottom', true, 'inside face', 'hinge edge')} Hinges are on the left as seen from the front; mirror the file for doors hinged on the right.`,
      });
      continue;
    }
    faces.push({ ...base, id: slug(part.name), piece: part.name, face: '', features: [], rightHanded: true, orientation: 'Nothing to machine — just cut the outline.' });
  }
  return faces;
}

/** Where the reference edges land in the (top-down) drawing. */
function describe(end: string, rightHanded: boolean, face: string, edge = 'front edge'): string {
  return `The ${end} is at the left and the ${edge} at the ${rightHanded ? 'bottom' : 'top'} of the drawing, ${face} up.`;
}

/** A face's own frame drawn top-down (y down, as SVG): honours handedness so nothing is mirrored. */
function localPoint(face: PartFace, u: number, v: number): [number, number] {
  return [u, face.rightHanded ? face.width - v : v];
}

/** Which face goes on each sheet piece ("Side-0" is the left side, "Divider-1" is divider 2, …). */
function faceForPiece(faces: PartFace[], pieceId: string): PartFace | undefined {
  const dash = pieceId.lastIndexOf('-');
  const part = pieceId.slice(0, dash);
  const index = Number(pieceId.slice(dash + 1));
  const own = faces.filter(f => f.part === part);
  if (part === 'Side') return own[index];
  if (part === 'Divider') {
    // The primary (left) face goes face-up on the sheet; the right face needs a flip.
    return own.find(f => f.piece === `Divider ${index + 1}`);
  }
  return own[0];
}

// ── Number formatting in file units ───────────────────────────────────────────

const toUnit = (inches: number, units: LengthUnit) => (units === 'mm' ? inches * MM_PER_INCH : inches);
const num = (inches: number, units: LengthUnit) => Number(toUnit(inches, units).toFixed(units === 'mm' ? 2 : 4)).toString();
// Nudge before rounding so 6.35 mm reads 6.4, not 6.3 (it's 6.3499… in binary).
const depthLabel = (inches: number, units: LengthUnit) =>
  units === 'mm' ? `${(Math.round(inches * MM_PER_INCH * 10 + 1e-6) / 10).toFixed(1)}mm` : `${(Math.round(inches * 1000 + 1e-6) / 1000).toFixed(3)}in`;
const unitSuffix = (units: LengthUnit) => (units === 'mm' ? 'mm' : 'in');
const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** A 2D placement: part frame (u, v) → drawing (x, y). */
type Place = (u: number, v: number) => [number, number];

function svgShapes(face: PartFace, place: Place, units: LengthUnit): string {
  const s = (inches: number) => num(inches, units);
  const rect = (u: number, v: number, lu: number, lv: number) => {
    const corners = [place(u, v), place(u + lu, v), place(u + lu, v + lv), place(u, v + lv)];
    return `M ${corners.map(([x, y]) => `${s(x)} ${s(y)}`).join(' L ')} Z`;
  };
  const path = (pts: [number, number][], closed = true) =>
    `M ${pts.map(([u, v]) => place(u, v)).map(([x, y]) => `${s(x)} ${s(y)}`).join(' L ')}${closed ? ' Z' : ''}`;
  const outline = `<path d="${face.outline ? path(face.outline) : rect(0, 0, face.length, face.width)}" fill="#000000" stroke="none" `
    + `shaper:cutType="outside" shaper:cutDepth="${depthLabel(face.thickness, units)}"><title>${escapeXml(face.piece)}</title></path>`;
  const features = face.features.map(f => {
    if (f.kind === 'pocket') {
      return `<path d="${rect(f.u, f.v, f.length, f.width)}" fill="#7F7F7F" stroke="none" `
        + `shaper:cutType="pocket" shaper:cutDepth="${depthLabel(f.depth, units)}"><title>${escapeXml(f.label)}</title></path>`;
    }
    if (f.kind === 'guide') {
      return `<path d="${path(f.points, f.closed)}" fill="none" stroke="#0000FF" stroke-width="${units === 'mm' ? 0.5 : 0.02}" `
        + `shaper:cutType="guide"><title>${escapeXml(f.label)}</title></path>`;
    }
    if (f.kind === 'pocketPath') {
      return `<path d="${f.rings.map(r => path(r)).join(' ')}" fill="#7F7F7F" fill-rule="evenodd" stroke="none" `
        + `shaper:cutType="pocket" shaper:cutDepth="${depthLabel(f.depth, units)}"><title>${escapeXml(f.label)}</title></path>`;
    }
    if (f.kind === 'cutout') {
      return `<path d="${path(f.points)}" fill="#FFFFFF" stroke="#000000" stroke-width="${units === 'mm' ? 0.2 : 0.008}" `
        + `shaper:cutType="inside" shaper:cutDepth="${depthLabel(face.thickness, units)}"><title>${escapeXml(f.label)}</title></path>`;
    }
    const [cx, cy] = place(f.u, f.v);
    return `<circle cx="${s(cx)}" cy="${s(cy)}" r="${s(f.radius)}" fill="#7F7F7F" stroke="none" `
      + `shaper:cutType="pocket" shaper:cutDepth="${depthLabel(f.depth, units)}"><title>${escapeXml(f.label)}</title></circle>`;
  }).join('\n    ');
  return `${outline}\n    ${features}`;
}

function svgDocument(width: number, height: number, units: LengthUnit, title: string, body: string): string {
  const u = unitSuffix(units);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:shaper="http://www.shapertools.com/namespaces/shaper"
     width="${num(width, units)}${u}" height="${num(height, units)}${u}" viewBox="0 0 ${num(width, units)} ${num(height, units)}">
  <title>${escapeXml(title)}</title>
  <g>
    ${body}
  </g>
</svg>
`;
}

/** One part face as an SVG at real size, for the Shaper Origin or any CNC. */
export function partSvg(face: PartFace, units: LengthUnit): string {
  const title = face.face ? `${face.piece} — ${face.face}` : face.piece;
  return svgDocument(face.length, face.width, units, title, svgShapes(face, (u, v) => localPoint(face, u, v), units));
}

/**
 * Placement of a sheet piece in the sheet's top-down frame (the same frame as the
 * on-screen sheet layout). A turned piece is rotated 90° — never mirrored.
 */
function piecePlacement(face: PartFace, placed: SheetLayout['placed'][number]): Place {
  const rotated = Math.abs(placed.length - face.length) > 1e-6 || Math.abs(placed.width - face.width) > 1e-6;
  return (u, v) => {
    const [x, y] = localPoint(face, u, v);
    return rotated ? [placed.x + y, placed.y + (face.length - x)] : [placed.x + x, placed.y + y];
  };
}

/** One full sheet with every part and its face-up joinery, for a CNC router. */
export function sheetSvg(layout: SheetLayout, faces: PartFace[], units: LengthUnit, title: string): string {
  const s = (inches: number) => num(inches, units);
  const border = `<rect x="0" y="0" width="${s(layout.sheetLength)}" height="${s(layout.sheetWidth)}" fill="none" stroke="#0000FF" stroke-width="${units === 'mm' ? 1 : 0.04}" shaper:cutType="guide"><title>Sheet</title></rect>`;
  const parts = layout.placed.map(p => {
    const face = faceForPiece(faces, p.pieceId);
    if (!face) return '';
    return svgShapes(face, piecePlacement(face, p), units);
  }).join('\n    ');
  return svgDocument(layout.sheetLength, layout.sheetWidth, units, title, `${border}\n    ${parts}`);
}

// ── DXF (R12, ASCII) ──────────────────────────────────────────────────────────

/** DXF is y-up; flipping the top-down drawing keeps it looking exactly like the SVG. */
function dxfEntities(face: PartFace, topDown: Place, docHeight: number, units: LengthUnit): string[] {
  const place: Place = (u, v) => { const [x, y] = topDown(u, v); return [x, docHeight - y]; };
  const s = (inches: number) => num(inches, units);
  const out: string[] = [];
  const polyline = (layer: string, pts: [number, number][], closed = true) => {
    out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', closed ? '1' : '0');
    for (const [x, y] of pts) out.push('0', 'VERTEX', '8', layer, '10', s(x), '20', s(y), '30', '0');
    out.push('0', 'SEQEND', '8', layer);
  };
  const rect = (u: number, v: number, lu: number, lv: number): [number, number][] =>
    [place(u, v), place(u + lu, v), place(u + lu, v + lv), place(u, v + lv)];
  polyline(`OUTSIDE_${depthLabel(face.thickness, units)}`, face.outline ? face.outline.map(([u, v]) => place(u, v)) : rect(0, 0, face.length, face.width));
  for (const f of face.features) {
    if (f.kind === 'guide') {
      polyline('GUIDE', f.points.map(([u, v]) => place(u, v)), f.closed ?? false);
    } else if (f.kind === 'pocketPath') {
      for (const ring of f.rings) polyline(`POCKET_${depthLabel(f.depth, units)}`, ring.map(([u, v]) => place(u, v)));
    } else if (f.kind === 'cutout') {
      polyline(`INSIDE_${depthLabel(face.thickness, units)}`, f.points.map(([u, v]) => place(u, v)));
    } else if (f.kind === 'pocket') {
      polyline(`POCKET_${depthLabel(f.depth, units)}`, rect(f.u, f.v, f.length, f.width));
    } else {
      const [cx, cy] = place(f.u, f.v);
      out.push('0', 'CIRCLE', '8', `${f.radius * 2 >= 1 ? 'POCKET' : 'DRILL'}_${depthLabel(f.depth, units)}`, '10', s(cx), '20', s(cy), '30', '0', '40', s(f.radius));
    }
  }
  return out;
}

function dxfDocument(units: LengthUnit, entities: string[]): string {
  const layers = [...new Set(entities.filter((_, i) => entities[i - 1] === '8'))];
  const header = ['0', 'SECTION', '2', 'HEADER', '9', '$ACADVER', '1', 'AC1009', '9', '$INSUNITS', '70', units === 'mm' ? '4' : '1', '0', 'ENDSEC'];
  const tables = ['0', 'SECTION', '2', 'TABLES', '0', 'TABLE', '2', 'LAYER', '70', String(layers.length)];
  layers.forEach((layer, i) => tables.push('0', 'LAYER', '2', layer, '70', '0', '62', String((i % 6) + 1), '6', 'CONTINUOUS'));
  tables.push('0', 'ENDTAB', '0', 'ENDSEC');
  return [...header, ...tables, '0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'].join('\n') + '\n';
}

export function partDxf(face: PartFace, units: LengthUnit): string {
  return dxfDocument(units, dxfEntities(face, (u, v) => localPoint(face, u, v), face.width, units));
}

export function sheetDxf(layout: SheetLayout, faces: PartFace[], units: LengthUnit): string {
  const entities = layout.placed.flatMap(p => {
    const face = faceForPiece(faces, p.pieceId);
    return face ? dxfEntities(face, piecePlacement(face, p), layout.sheetWidth, units) : [];
  });
  return dxfDocument(units, entities);
}

/** Faces whose joinery can't be cut face-up on the sheet (the second face of a divider). */
export function flipFaces(faces: PartFace[]): PartFace[] {
  return faces.filter(f => f.piece.startsWith('Divider') && f.face === 'right face');
}

export function fileName(base: string, ext: 'svg' | 'dxf'): string {
  return `${slug(base)}.${ext}`;
}

// ── Shelf-pin drilling jig ────────────────────────────────────────────────────

export interface PinJig {
  length: number;
  width: number;
  thickness: number;
  /** Hole centres: u along the jig from either end, v across from either long edge. */
  holes: { u: number; v: number }[];
  holesPerColumn: number;
  radius: number;
  spacing: number;
  /** Plywood-edge distances of the two columns (they mirror each other). */
  frontInset: number;
  backInset: number;
  staggered: boolean;
}

/** Jig plate thickness: thin enough to clamp flat, thick enough to guide the bit. */
export const JIG_THICKNESS = 0.5;

/**
 * A drilling jig for the shelf-pin holes, symmetric both ways so one jig does
 * every face: its width is front inset + back inset, so flipping it over gives
 * the same columns from the panel's front edge (left and right faces are mirror
 * images), and it has the same margin at both ends, so either end can sit on a
 * shelf. Null when the design has no adjustable shelves.
 */
export function pinJig(plan: ShelfPlan): PinJig | null {
  if (plan.pinHoles.length === 0) return null;
  const spacing = plan.pinSpacing;
  // The longest group of consecutive holes on any face sets the jig length.
  let longest = 1;
  for (const run of plan.pinHoles) {
    let count = 1;
    for (let i = 1; i < run.ys.length; i++) {
      count = run.ys[i] - run.ys[i - 1] <= spacing * 1.5 ? count + 1 : 1;
      longest = Math.max(longest, count);
    }
  }
  const band = plan.banding?.caseFronts ? plan.banding.thickness : 0;
  const run = plan.pinHoles[0];
  const frontInset = run.frontInset - band;
  const backInset = run.backInset - band;
  const width = frontInset + backInset;
  const length = 2 * PIN_MARGIN + (longest - 1) * spacing;
  const holes = Array.from({ length: longest }, (_, k) => PIN_MARGIN + k * spacing)
    .flatMap(u => [{ u, v: frontInset }, { u, v: backInset }]);
  return {
    length, width, thickness: JIG_THICKNESS, holes, holesPerColumn: longest, radius: plan.pinDiameter / 2,
    spacing, frontInset, backInset, staggered: plan.pinHoles.some(r => r.staggered),
  };
}

/** Counting ticks across the jig every 5 holes. */
function jigTicks(jig: PinJig): number[] {
  return Array.from({ length: Math.floor(jig.holesPerColumn / 5) }, (_, i) => PIN_MARGIN + (5 * (i + 1) - 1) * jig.spacing);
}

export function pinJigSvg(jig: PinJig, units: LengthUnit): string {
  const s = (inches: number) => num(inches, units);
  const depth = depthLabel(jig.thickness, units);
  const outline = `<rect x="0" y="0" width="${s(jig.length)}" height="${s(jig.width)}" fill="#000000" stroke="none" `
    + `shaper:cutType="outside" shaper:cutDepth="${depth}"><title>Shelf-pin jig</title></rect>`;
  // Through holes: Shaper's interior cut (white fill, black stroke).
  const holes = jig.holes.map(h => `<circle cx="${s(h.u)}" cy="${s(h.v)}" r="${s(jig.radius)}" fill="#FFFFFF" stroke="#000000" `
    + `stroke-width="${units === 'mm' ? 0.2 : 0.008}" shaper:cutType="inside" shaper:cutDepth="${depth}"><title>Pin hole</title></circle>`).join('\n    ');
  const ticks = jigTicks(jig).map(u => `<line x1="${s(u)}" y1="${s(jig.width * 0.35)}" x2="${s(u)}" y2="${s(jig.width * 0.65)}" stroke="#0000FF" `
    + `stroke-width="${units === 'mm' ? 0.5 : 0.02}" shaper:cutType="guide"><title>Every 5 holes</title></line>`).join('\n    ');
  return svgDocument(jig.length, jig.width, units, 'Shelf-pin drilling jig', `${outline}\n    ${holes}\n    ${ticks}`);
}

export function pinJigDxf(jig: PinJig, units: LengthUnit): string {
  const s = (inches: number) => num(inches, units);
  const depth = depthLabel(jig.thickness, units);
  const out: string[] = [];
  const layer = `OUTSIDE_${depth}`;
  out.push('0', 'POLYLINE', '8', layer, '66', '1', '70', '1');
  for (const [x, y] of [[0, 0], [jig.length, 0], [jig.length, jig.width], [0, jig.width]]) {
    out.push('0', 'VERTEX', '8', layer, '10', s(x), '20', s(y), '30', '0');
  }
  out.push('0', 'SEQEND', '8', layer);
  // Symmetric, so the DXF's y-up flip changes nothing.
  for (const h of jig.holes) out.push('0', 'CIRCLE', '8', `DRILL_${depth}`, '10', s(h.u), '20', s(h.v), '30', '0', '40', s(jig.radius));
  for (const u of jigTicks(jig)) {
    out.push('0', 'LINE', '8', 'GUIDE', '10', s(u), '20', s(jig.width * 0.35), '30', '0', '11', s(u), '21', s(jig.width * 0.65), '31', '0');
  }
  return dxfDocument(units, out);
}
