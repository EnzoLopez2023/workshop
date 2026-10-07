// CNC / Shaper Origin faces for Drawer Builder parts, in the same frame and
// file formats as the Shelf Builder export (see shelfExport.ts): u runs along
// the part's length, v across its width, looking at the face being machined.
//
// Drawer fronts and notched box fronts carry their finger-pull notch as the
// outline (a through cut). Case sides get the back rabbet as a pocket and each
// slide's bottom edge as a guide line; the bottom gets T-nut holes for the
// leveling feet or guide squares for the caster plates.

import {
  BOTTOM_GROOVE_DEPTH,
  BOTTOM_GROOVE_OFFSET,
  boxedDrawers,
  boxNotchSpec,
  frontNotch,
  handHole,
  notchedOutline,
  pullProfile,
  pullWidth,
  sheetParts,
  stadiumOutline,
  type NotchShape,
  supportPositions,
  FOOT_SIZE,
  SLIDE_HEIGHT,
  type DrawerConfig,
  type DrawerPlan,
} from './drawerUnit.ts';
import { MM_PER_INCH } from './shelving.ts';
import { pieceOutline } from './drawerInserts.ts';
import { partFaces, type Feature, type PartFace } from './shelfExport.ts';
import { bookcaseName } from './drawerBookcase.ts';

/** A 5/16" hole takes the barrel of a 1/4"-20 T-nut. */
export const TNUT_HOLE = 5 / 16;
const CASTER_PLATE = 2.5;

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export function drawerPartFaces(plan: DrawerPlan, config: DrawerConfig): PartFace[] {
  const T = config.thickness;
  const b = config.boxThickness;
  const bt = config.bottomThickness;
  const band = plan.banding?.thickness ?? 0;
  const pull = config.pull.enabled ? config.pull : null;
  const faces: PartFace[] = [];
  // The bookcase's dados, pin holes and hinge cups come from the Shelf Builder, renamed to match its parts.
  const bk = plan.bookcase;
  const bookFaces: PartFace[] = bk
    ? partFaces(bk.shelfPlan, bk.shelfConfig).map(face => ({ ...face, id: `bookcase-${face.id}`, part: bookcaseName(face.part), piece: bookcaseName(face.piece) }))
    : [];

  for (const part of sheetParts(plan.parts)) {
    if (bookFaces.some(face => face.part === part.name)) continue;
    const base = { part: part.name, length: part.length, width: part.width, thickness: part.thickness, material: 'plywood' as const };

    if (part.name === 'Side') {
      // u = up from the bottom edge, v = back from the front edge. The left side's
      // inside face points +x, which makes (up, back, +x) left-handed; the right mirrors it.
      // Each side carries the slides of the column next to it.
      const lastColumn = plan.columns.length - 1;
      for (const [piece, rightHanded, column] of [['Left side', false, 0], ['Right side', true, lastColumn]] as const) {
        const features: Feature[] = [
          plan.cleatGap > 0
            ? { kind: 'pocket', label: 'Back groove', u: 0, v: part.width - plan.cleatGap - config.backThickness, length: part.length, width: config.backThickness, depth: T / 2 }
            : { kind: 'pocket', label: 'Back rabbet', u: 0, v: part.width - config.backThickness, length: part.length, width: config.backThickness, depth: T / 2 },
          ...slideLines(plan, column, 0),
        ];
        faces.push({
          ...base, id: slug(`${piece} inside`), piece, face: 'inside face', features, rightHanded, outline: plan.partOutlines.Side,
          orientation: `The bottom end is at the left and the front edge at the ${rightHanded ? 'bottom' : 'top'} of the drawing, inside face up.${plan.partOutlines.Side ? ' The toe-kick notch is part of the outline cut.' : ''} Blue lines mark each slide’s bottom edge (not cut).`,
        });
      }
      continue;
    }

    if (part.name.startsWith('Partition')) {
      // Slides on both faces: the left face holds the column to its left, the right face the one to its right.
      // u = up from the partition's bottom end (on the bottom panel), v = back from the front edge.
      const p = part.name === 'Partition' ? 0 : Number(part.name.split(' ')[1]) - 1;
      for (const [side, column, rightHanded] of [['left', p, true], ['right', p + 1, false]] as const) {
        faces.push({
          ...base, id: slug(`${part.name} ${side}`), piece: part.name, face: `${side} face`, features: slideLines(plan, column, panelTop(plan, T)), rightHanded,
          orientation: `The bottom end is at the left and the front edge at the ${rightHanded ? 'bottom' : 'top'} of the drawing, ${side} face up. Blue lines mark the slides (not cut).`,
        });
      }
      continue;
    }

    if (part.name === 'Bottom' && plan.supports > 0) {
      // u = from the left end, v = back from the front edge, looking at the underside.
      const features: Feature[] = supportPositions(plan, config).map(([x, z], i): Feature => {
        if (config.base === 'feet') {
          return { kind: 'hole', label: `T-nut ${i + 1}`, u: x - T + FOOT_SIZE / 2, v: z + FOOT_SIZE / 2 - band, radius: TNUT_HOLE / 2, depth: T };
        }
        const u0 = x - T;
        const v0 = z - band;
        return {
          kind: 'guide', label: `Caster ${i + 1} plate`, closed: true,
          points: [[u0, v0], [u0 + CASTER_PLATE, v0], [u0 + CASTER_PLATE, v0 + CASTER_PLATE], [u0, v0 + CASTER_PLATE]],
        };
      });
      faces.push({
        ...base, id: 'bottom-underside', piece: 'Bottom', face: 'underside', features, rightHanded: false,
        orientation: config.base === 'feet'
          ? 'Underside up, left end at the left, front edge at the top. Drill through and tap the T-nuts in from the top face.'
          : 'Underside up, left end at the left, front edge at the top. Blue squares mark the caster plates (not cut).',
      });
      continue;
    }

    if (part.name === 'Countertop' && bk?.grommet && bk.countertop) {
      // u = from the left end, v = back from the front edge, top face up.
      const g = bk.grommet;
      faces.push({
        ...base, id: 'countertop', piece: 'Countertop', face: 'top face', rightHanded: true,
        features: [{ kind: 'hole', label: 'Cord grommet', u: g.x - bk.countertop.x0, v: g.z - bk.countertop.z0, radius: g.diameter / 2, depth: part.thickness }],
        orientation: 'Top face up, front edge at the bottom of the drawing. Cut the grommet hole through every layer.',
      });
      continue;
    }

    if (part.name.startsWith('Drawer front')) {
      // u = left to right, v = up from the bottom edge, outside face up. The notch is cut
      // from the finished (banded) top edge, so it's that much shallower on the plywood.
      const finished = part.length + 2 * band;
      const notch = frontNotch(pull, finished);
      const hole = handHole(pull);
      const outline = notch
        ? notchedOutline(0, 0, part.length, part.width, { ...notch, depth: Math.max(notch.depth - band, 0.01) })
        : undefined;
      const features: Feature[] = hole
        ? [{ kind: 'cutout', label: 'Hand hole', points: stadiumOutline(part.length / 2, part.width + band - hole.top, hole.width, hole.height) }]
        : [];
      faces.push({
        ...base, id: slug(part.name), piece: part.name, face: pull ? 'outside face' : '', features, outline, rightHanded: true,
        orientation: pull ? `Outside face up, top edge (with the ${hole ? 'hand hole' : 'finger pull'}) at the top of the drawing.` : 'Nothing to machine — just cut the outline.',
      });
      continue;
    }

    if (part.name.startsWith('Box front') || part.name.startsWith('Box back')) {
      // u = along the piece, v = up from the bottom edge, inside face up.
      const features: Feature[] = [groove(part.length, bt)];
      let outline: [number, number][] | undefined;
      if (part.name.startsWith('Box front') && pull) {
        const drawer = plan.drawers[plan.partDrawers[part.name]?.[0] ?? -1];
        const spec = drawer ? boxNotchSpec(pull, drawer.front.width, drawer.boxNotchDepth) : null;
        if (spec) outline = notchedOutline(0, 0, part.length, part.width, spec);
      }
      faces.push({
        ...base, id: slug(part.name), piece: part.name, face: 'inside face', features, outline, rightHanded: true,
        orientation: 'Inside face up, top edge at the top of the drawing; the groove takes the bottom.',
      });
      continue;
    }

    if (part.name.startsWith('Box side')) {
      // Rabbets at each end for the front and back, and the bottom groove — the same
      // for the left and right sides, since everything is symmetric end to end.
      const features: Feature[] = [
        { kind: 'pocket', label: 'Front rabbet', u: 0, v: 0, length: b, width: part.width, depth: b / 2 },
        { kind: 'pocket', label: 'Back rabbet', u: part.length - b, v: 0, length: b, width: part.width, depth: b / 2 },
        groove(part.length, bt),
      ];
      faces.push({
        ...base, id: slug(part.name), piece: part.name, face: 'inside face', features, rightHanded: true,
        orientation: 'Inside face up, top edge at the top of the drawing. Cut two per drawer — they’re interchangeable.',
      });
      continue;
    }

    if (part.name.startsWith('Tool board')) {
      // u = across the drawer from the left, v = back from the front edge, top face up.
      const tb = plan.inserts[plan.partDrawers[part.name]?.[0] ?? -1]?.toolBoard;
      const features: Feature[] = [
        ...(tb?.placed ?? []).map((p): Feature => ({ kind: 'pocketPath', label: p.name, rings: p.rings, depth: tb!.pocketDepth })),
        ...(tb?.fingerHoles ?? []).map((h): Feature => ({ kind: 'hole', label: 'Finger hole', u: h.x, v: h.y, radius: h.r, depth: tb!.pocketDepth })),
      ];
      faces.push({
        ...base, id: slug(part.name), piece: part.name, face: 'top face', features, rightHanded: true,
        orientation: 'Top face up, front edge at the bottom of the drawing. Pockets and finger holes are cut to the same depth.',
      });
      continue;
    }

    const shaped = plan.partOutlines[part.name];
    if (shaped) {
      // Dividers and marker ribs: the slots and notches are part of the outline cut.
      faces.push({
        ...base, id: slug(part.name), piece: part.name, face: 'face up', features: [], outline: shaped, rightHanded: true,
        orientation: part.name.startsWith('Marker rib')
          ? 'Either face up; the notches are along the top edge.'
          : `Either face up; the slots open toward the ${part.name.startsWith('Lengthwise') ? 'top' : 'bottom'} edge, as drawn.`,
      });
      continue;
    }

    faces.push({ ...base, id: slug(part.name), piece: part.name, face: '', features: [], rightHanded: true, orientation: 'Nothing to machine — just cut the outline.' });
  }
  return [...faces, ...bookFaces];
}

// ── Shop jigs ───────────────────────────────────────────────────────────────

/** Jig plates are 1/2" MDF or plywood. */
export const JIG_STOCK = 1 / 2;
/** How far a pull template reaches past the top edge it hooks over. */
export const TEMPLATE_OVERHANG = 1.5;
/** Template stock below the bottom of the notch. */
const TEMPLATE_BELOW = 2.5;
/** Longest template that still registers on both ends of the front. */
const TEMPLATE_MAX_LENGTH = 36;

export type JigStage = 'layout' | 'setup' | 'case' | 'slides' | 'boxes' | 'fronts';

export interface DrawerJig {
  /** The jig, or its first piece. */
  face: PartFace;
  /** More pieces of the same jig (e.g. a spacer block for each opening). */
  extraFaces?: PartFace[];
  /** Heading for a jig of several pieces (otherwise its piece name). */
  title?: string;
  /** What to cut, e.g. "4 from 3/4\" offcuts". */
  make?: string;
  /** Which part of the build it's for, to group the list. */
  stage: JigStage;
  /** How to make and use it. */
  steps: string[];
}

export const JIG_STAGES: { stage: JigStage; title: string }[] = [
  { stage: 'setup', title: 'Machine setup' },
  { stage: 'layout', title: 'Pulls and layout' },
  { stage: 'case', title: 'Case assembly' },
  { stage: 'slides', title: 'Slides' },
  { stage: 'boxes', title: 'Drawer boxes' },
  { stage: 'fronts', title: 'Hanging the fronts' },
];

/**
 * A pattern-bit routing template for a finger pull: a plate as long as the part
 * (so its ends line up with the part's ends and centre the notch), with the
 * notch open through its top edge and a guide line where the fence goes.
 */
function pullTemplate(id: string, title: string, partLength: number, shape: NotchShape | 'handhole', width: number, depth: number, holeTop = 0): PartFace {
  const length = partLength <= TEMPLATE_MAX_LENGTH ? partLength : width + 8;
  const reach = shape === 'handhole' ? holeTop + depth : depth;
  const height = TEMPLATE_OVERHANG + reach + TEMPLATE_BELOW;
  const cx = length / 2;
  const edge = height - TEMPLATE_OVERHANG; // where the part's top edge sits
  const guides: Feature[] = [
    { kind: 'guide', label: 'Fence line — the part’s top edge', points: [[0, edge], [length, edge]] },
    { kind: 'guide', label: 'Centre line', points: [[cx, 0], [cx, edge - reach - 0.25]] },
  ];
  const face = { id, part: title, piece: title, face: 'face up', length, width: height, thickness: JIG_STOCK, material: 'plywood' as const, rightHanded: true };
  if (shape === 'handhole') {
    return {
      ...face,
      features: [{ kind: 'cutout', label: 'Hand hole', points: stadiumOutline(cx, edge - holeTop, width, depth) }, ...guides],
      orientation: 'Face up as drawn; the hole sits below the fence line.',
    };
  }
  const notch = pullProfile({ shape, width, depth }).map(([dx, dy]) => [cx + dx, edge + dy] as [number, number]).reverse();
  const outline: [number, number][] = [[0, 0], [length, 0], [length, height], [cx + width / 2, height], ...notch, [cx - width / 2, height], [0, height]];
  return {
    ...face,
    outline: outline.filter((pt, i) => i === 0 || Math.hypot(pt[0] - outline[i - 1][0], pt[1] - outline[i - 1][1]) > 1e-9),
    features: guides,
    orientation: 'Face up as drawn; the notch opens through the top edge.',
  };
}

export function drawerJigs(plan: DrawerPlan, config: DrawerConfig, f: (inches: number) => string): DrawerJig[] {
  const jigs: DrawerJig[] = [];
  const pull = config.pull.enabled ? config.pull : null;
  const frontPart = plan.parts.find(p => p.name.startsWith('Drawer front'));
  const fence = (length: number, width: number) => `Glue a ${f(3 / 4)} × ${f(3 / 4)} fence under the plate on the fence line, one piece each side of the notch (about ${f(Math.max((length - width) / 2 - 0.5, 1))} long each).`;

  // One template per front width (columns can differ).
  const widths: { width: number; length: number; columns: number[] }[] = [];
  for (const d of boxedDrawers(plan)) {
    const g = widths.find(w => Math.abs(w.width - d.front.width) < 1e-6);
    if (g) { if (!g.columns.includes(d.column + 1)) g.columns.push(d.column + 1); }
    else widths.push({ width: d.front.width, length: d.front.width - 2 * (plan.banding?.thickness ?? 0), columns: [d.column + 1] });
  }
  if (pull && frontPart) for (const [wi, w] of widths.entries()) {
    const frontWidth = w.width;
    const notch = frontNotch(pull, frontWidth);
    const hole = handHole(pull);
    const across = pullWidth(pull, frontWidth);
    const forColumns = widths.length > 1 ? ` (column${w.columns.length === 1 ? '' : 's'} ${w.columns.join(', ')})` : '';
    const id = wi === 0 ? 'pull-template' : `pull-template-${wi + 1}`;
    const face = notch
      ? pullTemplate(id, `Finger-pull template${forColumns}`, w.length, notch.shape, notch.width, notch.depth)
      : pullTemplate(id, `Hand-hole template${forColumns}`, w.length, 'handhole', hole!.width, hole!.height, hole!.top);
    const flush = w.length <= TEMPLATE_MAX_LENGTH;
    jigs.push({
      face,
      stage: 'layout',
      steps: [
        `Cut it from ${f(JIG_STOCK)} MDF or plywood. ${fence(face.length, across)}`,
        flush
          ? 'Lay it on the front’s outside face with the fence hooked over the top edge and the ends flush with the front’s ends — that centres the notch.'
          : 'Lay it on the front’s outside face with the fence hooked over the top edge and the centre line on the front’s centre mark.',
        hole
          ? `Clamp it, drill a starter hole and jigsaw out the waste inside the line, then rout with a ${f(1 / 2)} top-bearing pattern bit riding the template.`
          : `Clamp it, jigsaw out most of the waste, then rout with a ${f(1 / 2)} top-bearing pattern bit riding the template.`,
      ],
    });
    // Box fronts get a wider, deeper notch; one template per depth.
    const depths: { depth: number; drawers: string[]; boxFront: number }[] = [];
    for (const d of plan.drawers) {
      if (d.boxNotchDepth <= 0 || Math.abs(d.front.width - w.width) > 1e-6) continue;
      const g = depths.find(x => Math.abs(x.depth - d.boxNotchDepth) < 1 / 64);
      const short = d.label.replace(/^Drawer /, '').replace(/^Column (\d+) drawer (\d+)$/, '$1.$2');
      if (g) g.drawers.push(short); else depths.push({ depth: d.boxNotchDepth, drawers: [short], boxFront: d.box.width - config.boxThickness });
    }
    depths.forEach((g, i) => {
      const which = depths.length === 1 && widths.length === 1 ? '' : ` (drawer${g.drawers.length === 1 ? '' : 's'} ${g.drawers.join(', ')})`;
      const spec = boxNotchSpec(pull, frontWidth, g.depth)!;
      const face = pullTemplate(`box-template-${wi + 1}-${i + 1}`, `Box-front notch template${which}`, g.boxFront, spec.shape, spec.width, spec.depth);
      jigs.push({
        face,
        stage: 'layout',
        steps: [
          `${fence(face.length, spec.width)} Use it the same way on the box front’s inside face, before the box is glued up.`,
        ],
      });
    });
  }

  // Story stick: stands on the bottom panel inside the case, notched where each slide's bottom edge goes.
  // Columns with the same slide heights share one.
  const T = config.thickness;
  const stickLength = plan.caseHeight - 2 * T;
  const stickWidth = 2;
  const sticks: { marks: number[]; columns: number[] }[] = [];
  for (const column of plan.columns) {
    const marks = boxedDrawers(plan).filter(d => d.column === column.index).map(d => d.slideMark - panelTop(plan, T));
    const g = sticks.find(x => x.marks.length === marks.length && x.marks.every((m, i) => Math.abs(m - marks[i]) < 1e-6));
    if (g) g.columns.push(column.index + 1); else sticks.push({ marks, columns: [column.index + 1] });
  }
  sticks.forEach((stick, si) => {
    const forColumns = sticks.length > 1 ? ` (column${stick.columns.length === 1 ? '' : 's'} ${stick.columns.join(', ')})` : '';
    const cuts = stick.marks.map(m => ({ kind: 'slot' as const, center: m + 1 / 16, width: 1 / 8, depth: 3 / 8, from: 'top' as const }));
    jigs.push({
      face: {
        id: si === 0 ? 'story-stick' : `story-stick-${si + 1}`, part: `Slide story stick${forColumns}`, piece: `Slide story stick${forColumns}`,
        face: 'face up', length: stickLength, width: stickWidth, thickness: JIG_STOCK, material: 'plywood', rightHanded: true,
        outline: pieceOutline(stickLength, stickWidth, cuts),
        features: stick.marks.map((m, i) => ({ kind: 'guide' as const, label: `Drawer ${i + 1} slide`, points: [[m, 0], [m, stickWidth]] as [number, number][] })),
        orientation: 'The end at the left stands on the bottom panel; each notch’s lower edge is a slide’s bottom edge.',
      },
      stage: 'slides',
      steps: [
        `Stand it on the bottom panel inside the case, against the front edge of ${plan.columns.length > 1 ? 'a side or partition' : 'a side'}, and tick it at the bottom of each notch (${stick.marks.map(m => f(m)).join(', ')} up from the bottom panel).`,
        plan.columns.length > 1 ? 'Mark both faces of every opening in that column with the same stick, so the slides match exactly.' : 'Do the other side with the same stick, so both sides match exactly.',
      ],
    });
  });

  if (config.gap >= 1 / 16) {
    jigs.push({
      face: {
        id: 'gap-spacer', part: 'Front gap spacer', piece: 'Front gap spacer', face: '', length: 3, width: 1, thickness: config.gap,
        material: 'plywood', rightHanded: true, features: [], orientation: `Cut four from ${f(config.gap)} stock (hardboard or a thin offcut).`,
      },
      stage: 'fronts',
      steps: [
        `Four ${f(config.gap)} spacers set the gap between fronts; two ${f(config.gap / 2)} shims (half as thick) set the bottom reveal.`,
      ],
    });
  }
  jigs.push(...buildJigs(plan, config, f));
  const order = JIG_STAGES.map(x => x.stage);
  return jigs.sort((a, b2) => order.indexOf(a.stage) - order.indexOf(b2.stage));
}

// ── More shop jigs, each sized from the design ───────────────────────────────

const rect = (length: number, width: number): [number, number][] => [[0, 0], [length, 0], [length, width], [0, width]];
const jigFace = (id: string, piece: string, length: number, width: number, thickness: number, extra: Partial<PartFace> = {}): PartFace => ({
  id, part: piece, piece, face: 'face up', length, width, thickness, material: 'plywood', rightHanded: true, features: [],
  orientation: 'Either face up.', ...extra,
});
/** Round to the nearest 1/32" — jig sizes should be easy to cut and check. */
const r32 = (inches: number) => Math.round(inches * 32) / 32;

function buildJigs(plan: DrawerPlan, config: DrawerConfig, f: (inches: number) => string): DrawerJig[] {
  const jigs: DrawerJig[] = [];
  const T = config.thickness;
  const b = config.boxThickness;
  const columnName = (c: number) => (plan.columns.length > 1 ? `column ${c + 1} ` : '');

  // 1 ── Slide spacer blocks: stacked from the bottom panel, each slide rests on the block below it.
  for (const column of plan.columns) {
    const bottomUp = [...column.drawers].reverse().map(i => plan.drawers[i]);
    const faces: PartFace[] = [];
    let floor = panelTop(plan, T); // the bottom panel's top, measured like slide marks (from the side's bottom edge)
    bottomUp.forEach((d, k) => {
      // A cubby has no slide; the next block stands on its shelf (or the bottom panel).
      if (d.open) { floor = d.shelfY !== null ? d.shelfY + T - plan.sideBottom : floor; return; }
      const height = r32(d.slideMark - floor);
      floor = d.slideMark + SLIDE_HEIGHT;
      if (height <= 0.05) return;
      faces.push(jigFace(`slide-spacer-${column.index + 1}-${k + 1}`, `Slide spacer ${columnName(column.index)}${k === 0 ? '(bottom)' : `#${k + 1}`}`.replace('  ', ' '),
        3, height, T, { orientation: `${f(height)} tall — write “${d.label}” on it.` }));
    });
    if (!faces.length) continue;
    jigs.push({
      title: `Slide spacer blocks${plan.columns.length > 1 ? ` — column ${column.index + 1}` : ''}`, face: faces[0], extraFaces: faces.slice(1), stage: 'slides',
      make: `${faces.length} blocks from ${f(T)} offcuts, two of each (one per side of the opening)`,
      steps: [
        `Stand the first block on the bottom panel against the ${plan.columns.length > 1 ? 'side or partition' : 'side'}, rest the bottom drawer’s slide on it, and screw it on.`,
        'Then stand the next block on top of that slide, rest the next slide on it, and so on up the opening — no measuring.',
        `Blocks for ${column.drawers.map(i => plan.drawers[i]).filter(d => !d.open).map(d => d.label.toLowerCase()).reverse().join(', ')}, bottom to top: ${faces.map(x => f(x.width)).join(', ')}.`,
      ],
    });
    if (plan.columns.length > 1 && plan.columns.slice(column.index + 1).every(c => c.drawers.length === column.drawers.length)) {
      // Later columns with the same blocks would only repeat this set.
      const same = plan.columns.slice(column.index + 1).every(c => c.drawers.every((i, n) => Math.abs(plan.drawers[i].slideMark - plan.drawers[column.drawers[n]].slideMark) < 1e-6));
      if (same) { jigs[jigs.length - 1].make += ' — the same set does every column'; break; }
    }
  }

  // 2 ── Front stop: clamped across the case's front edge so each slide's front end butts against it.
  // With inset fronts the slides start a front's thickness back, so it's a setback block instead.
  if (plan.frontInset > 0) {
    jigs.push({
      face: jigFace('slide-front-stop', 'Slide setback block', plan.frontInset, 2.5, JIG_STOCK, {
        orientation: `Exactly ${f(plan.frontInset)} long — the thickness of the fronts.`,
      }),
      stage: 'slides', make: `2 from ${f(JIG_STOCK)} offcuts, cut exactly ${f(plan.frontInset)} long (a sliver of front plywood works)`,
      steps: [
        'Clamp one against the inside face of the side, flush with the case’s front edge.',
        `Push each slide forward against it before screwing: every slide starts ${f(plan.frontInset)} back, so the inset fronts close flush with the case.`,
      ],
    });
  } else jigs.push({
    face: jigFace('slide-front-stop', 'Slide front stop', 3, T + 1, T, {
      features: [{ kind: 'guide', label: 'Inside face of the side', points: [[0, T], [3, T]] }],
      orientation: 'The blue line lines up with the inside face of the side or partition.',
    }),
    stage: 'slides', make: `1 from a ${f(T)} offcut`,
    steps: [
      'Clamp it flat across the front edge of the side, with the blue line on the side’s inside face, so it sticks 1″ into the opening.',
      'Push each slide forward against it before screwing: every slide ends up flush with the case front.',
    ],
  });

  // 3 ── Box-side slide jig: a block the drawer member rests on, as tall as its offset above the box's bottom edge.
  const offsets: { offset: number; drawers: string[] }[] = [];
  for (const d of boxedDrawers(plan)) {
    const offset = r32(d.slideY - d.box.y);
    const g = offsets.find(x => Math.abs(x.offset - offset) < 1e-6);
    if (g) g.drawers.push(d.label.toLowerCase()); else offsets.push({ offset, drawers: [d.label.toLowerCase()] });
  }
  const offsetFaces = offsets.map((g, i) => jigFace(`box-slide-block-${i + 1}`, offsets.length === 1 ? 'Box slide block' : `Box slide block ${f(g.offset)}`, 6, g.offset, T, {
    orientation: `${f(g.offset)} tall, for ${g.drawers.join(', ')}.`,
  }));
  jigs.push({
    title: 'Box slide blocks', face: offsetFaces[0], extraFaces: offsetFaces.slice(1), stage: 'boxes',
    make: `${offsetFaces.length === 1 ? 'One block' : `${offsetFaces.length} blocks`} from ${f(T)} offcuts`,
    steps: [
      'Stand the box on its bottom edge on a flat bench, lay the block on the bench against the box side, and rest the drawer member on the block.',
      'Slide the member forward until it’s flush with the box front, then screw it on through the horizontal slots first.',
      ...offsets.map(g => `${f(g.offset)} block: ${g.drawers.join(', ')}.`),
    ],
  });

  // 4 ── Glue-up squaring frame: exactly the box's inside, corners clipped so squeeze-out can't glue it in.
  const insides: { w: number; d: number; drawers: string[] }[] = [];
  for (const d of boxedDrawers(plan)) {
    const w = d.box.width - 2 * b;
    const dd = d.box.depth - 2 * b;
    const g = insides.find(x => Math.abs(x.w - w) < 1e-6 && Math.abs(x.d - dd) < 1e-6);
    if (g) g.drawers.push(d.label.toLowerCase()); else insides.push({ w, d: dd, drawers: [d.label.toLowerCase()] });
  }
  const frameFaces = insides.map((g, i) => {
    const L = r32(g.w - 1 / 32);
    const Wd = r32(g.d - 1 / 32);
    const c = 3 / 8;
    const band = 1.5;
    const outline: [number, number][] = [[c, 0], [L - c, 0], [L, c], [L, Wd - c], [L - c, Wd], [c, Wd], [0, Wd - c], [0, c]];
    const hole: [number, number][] = [[band, band], [L - band, band], [L - band, Wd - band], [band, Wd - band]];
    return jigFace(`squaring-frame-${i + 1}`, insides.length === 1 ? 'Box squaring frame' : `Box squaring frame ${f(L)} × ${f(Wd)}`, L, Wd, T, {
      outline,
      features: L > 2 * band + 1 && Wd > 2 * band + 1 ? [{ kind: 'cutout', label: 'Centre (saves material and weight)', points: hole }] : [],
      orientation: `${f(L)} × ${f(Wd)} — the inside of ${g.drawers.join(', ')}, less ${f(1 / 32)} so it lifts out.`,
    });
  });
  jigs.push({
    title: 'Box squaring frame', face: frameFaces[0], extraFaces: frameFaces.slice(1), stage: 'boxes',
    make: `${frameFaces.length === 1 ? 'One frame' : `${frameFaces.length} frames`} from ${f(T)} plywood — check the corners with a square`,
    steps: [
      'Glue up each box around the frame laid on the bottom: the box can only close square and at its exact inside size.',
      'The clipped corners keep glue squeeze-out off the frame; lift it out once the clamps are on.',
    ],
  });

  // 5 ── Setup gauge: one stepped block for setting fences and blade or bit heights by touch.
  const settings = [
    { value: BOTTOM_GROOVE_DEPTH, what: 'groove depth' },
    { value: BOTTOM_GROOVE_OFFSET, what: 'groove up from the bottom edge' },
    { value: b / 2, what: 'box rabbet depth' },
    { value: b, what: 'box rabbet width' },
    { value: T / 2, what: 'back rabbet depth' },
    { value: config.backThickness, what: 'back rabbet width' },
  ];
  const steps: { value: number; what: string[] }[] = [];
  for (const x of settings) {
    const g = steps.find(y => Math.abs(y.value - x.value) < 1e-6);
    if (g) g.what.push(x.what); else steps.push({ value: x.value, what: [x.what] });
  }
  steps.sort((a, c) => a.value - c.value);
  const stepLength = 1.25;
  const gaugeOutline: [number, number][] = [[0, 0], [steps.length * stepLength, 0]];
  for (let i = steps.length - 1; i >= 0; i--) {
    gaugeOutline.push([(i + 1) * stepLength, steps[i].value], [i * stepLength, steps[i].value]);
  }
  jigs.push({
    face: jigFace('setup-gauge', 'Setup gauge', steps.length * stepLength, Math.max(...steps.map(x => x.value)), JIG_STOCK, {
      outline: gaugeOutline.filter((p, i) => i === 0 || p[0] !== gaugeOutline[i - 1][0] || p[1] !== gaugeOutline[i - 1][1]),
      orientation: `Steps, left to right: ${steps.map(x => f(x.value)).join(', ')}.`,
    }),
    stage: 'setup', make: `1 from a ${f(JIG_STOCK)} offcut; write each size on its step`,
    steps: steps.map(x => `${f(x.value)} step: ${x.what.join(', ')}.`),
  });

  // 6 ── Divider slot strips: one per slotted piece, notched at every slot, to mark or index a set at once.
  const slotted = plan.parts.filter(p => (p.name.startsWith('Lengthwise') || p.name.startsWith('Crosswise')) && plan.partOutlines[p.name]);
  const stripFaces = slotted.flatMap((p, i) => {
    const outline = plan.partOutlines[p.name];
    // Recover the slot centres and width from the piece's outline: its notches in the top or bottom edge.
    const slots = notchesOf(outline, p.width);
    if (!slots.length) return [];
    const cuts = slots.map(x => ({ kind: 'slot' as const, center: x.center, width: x.width, depth: 1 / 4, from: 'top' as const }));
    return [jigFace(`slot-strip-${i + 1}`, `Slot strip · ${p.name.replace(/ · .*/, '').toLowerCase()} ${p.name.split(' · ')[1] ?? ''}`.trim(), p.length, 1, JIG_STOCK, {
      outline: pieceOutline(p.length, 1, cuts),
      orientation: `As long as the ${p.name.toLowerCase()}; its notches sit over the slots.`,
    })];
  });
  if (stripFaces.length) {
    jigs.push({
      title: 'Divider slot strips', face: stripFaces[0], extraFaces: stripFaces.slice(1), stage: 'layout',
      make: `${stripFaces.length === 1 ? 'One strip' : `${stripFaces.length} strips`} from ${f(JIG_STOCK)} plywood`,
      steps: [
        'Clamp a set of dividers edge to edge, ends flush, and lay the strip across them: mark both sides of every notch on every piece at once.',
        'Or screw it to a crosscut sled as an indexing fence, with a pin in each notch, and cut the whole set slot by slot.',
      ],
    });
  }

  // 7 ── Partition spacers: hold each partition parallel while it's screwed in.
  if (plan.columns.length > 1) {
    const widths: { w: number; columns: number[] }[] = [];
    for (const c of plan.columns) {
      const g = widths.find(x => Math.abs(x.w - c.width) < 1e-6);
      if (g) g.columns.push(c.index + 1); else widths.push({ w: c.width, columns: [c.index + 1] });
    }
    const height = Math.min(12, plan.caseHeight - 2 * T);
    const spacerFaces = widths.map((g, i) => jigFace(`partition-spacer-${i + 1}`, widths.length === 1 ? 'Partition spacer' : `Partition spacer ${f(g.w)}`, r32(g.w), height, T, {
      orientation: `${f(r32(g.w))} wide — column${g.columns.length === 1 ? '' : 's'} ${g.columns.join(', ')}.`,
    }));
    jigs.push({
      title: 'Partition spacers', face: spacerFaces[0], extraFaces: spacerFaces.slice(1), stage: 'case',
      make: `Two of each from ${f(T)} plywood`,
      steps: [
        'Stand two spacers between the side (or the last partition) and the next partition, one at the front and one at the back, and screw the partition through the top and bottom.',
        'Move them across for each partition in turn: every opening comes out its exact width and the partitions stay parallel.',
      ],
    });
  }

  // 8 ── Clamping squares: right-angle brackets with the inside corner relieved and clamp slots.
  const leg = 6;
  const relief = 0.5;
  const arm = 1.75;
  jigs.push({
    face: jigFace('clamping-square', 'Clamping square', leg, leg, T, {
      outline: [[relief, 0], [leg, 0], [leg, arm], [arm, leg], [0, leg], [0, relief], [relief, relief]],
      features: [
        { kind: 'cutout', label: 'Clamp slot', points: rect(1, 0.75).map(([u, v]) => [u + 3.25, v + 0.5] as [number, number]) },
        { kind: 'cutout', label: 'Clamp slot', points: rect(0.75, 1).map(([u, v]) => [u + 0.5, v + 3.25] as [number, number]) },
      ],
      orientation: 'Either face up. The notch in the corner keeps glue off it.',
    }),
    stage: 'case', make: `4 from ${f(T)} plywood — check each with a square before you use it`,
    steps: [
      'Clamp one inside each corner where the top and bottom meet the sides, through the slots.',
      'They hold the case at 90° while you drive the screws, and keep it square until the back goes on.',
    ],
  });

  // 9 ── Bottom drilling template: a corner plate with the T-nut hole, registered on two edges.
  if (config.base === 'feet' && plan.supports > 0) {
    const [x0, z0] = supportPositions(plan, config)[0];
    const band = plan.banding?.thickness ?? 0;
    const u = x0 - T + FOOT_SIZE / 2;
    const v = z0 + FOOT_SIZE / 2 - band;
    const size = Math.ceil(Math.max(u, v) + 1.5);
    jigs.push({
      face: jigFace('tnut-template', 'T-nut drilling template', size, size, JIG_STOCK, {
        features: [
          { kind: 'hole', label: 'T-nut', u, v, radius: TNUT_HOLE / 2, depth: JIG_STOCK },
          { kind: 'guide', label: 'Fence: the bottom’s end', points: [[0, 0], [0, size]] },
          { kind: 'guide', label: 'Fence: the bottom’s front edge', points: [[0, 0], [size, 0]] },
        ],
        orientation: 'Glue fences along the two blue edges, underneath.',
      }),
      stage: 'case', make: `1 from ${f(JIG_STOCK)} plywood, with two ${f(3 / 4)} fences glued underneath along the blue edges`,
      steps: [
        `Hook the fences on a corner of the bottom panel and drill through the hole: ${f(u)} from the end and ${f(v)} from the front edge.`,
        'The positions are symmetrical, so flip the template for each of the four corners.',
        ...(plan.supports === 6 ? [`For the middle pair, mark ${f(plan.overallWidth / 2 - T)} from the end and use the template against the front and back edges only.`] : []),
      ],
    });
  }

  // 10 ── Front reveal gauge: hangs on the front below; its tongue sets the gap.
  if (config.gap > 0) {
    const plate = 1 / 2;
    const tongue = Math.min(T * 0.8, 0.5);
    const tall = 4;
    const mid = 2;
    jigs.push({
      face: jigFace('reveal-gauge', 'Front reveal gauge', plate + tongue, tall, JIG_STOCK, {
        outline: [[0, 0], [plate, 0], [plate, mid], [plate + tongue, mid], [plate + tongue, mid + config.gap], [plate, mid + config.gap], [plate, tall], [0, tall]],
        orientation: `A side view: the ${f(config.gap)} tongue sits between two fronts.`,
      }),
      stage: 'fronts', make: `2 from ${f(JIG_STOCK)} hardwood or MDF (plywood can split on the thin tongue)`,
      steps: [
        'Hang two gauges on the top edge of the front below, one near each end, the tongue resting on that front.',
        `Set the next front down onto the tongues: the gap is exactly ${f(config.gap)}. Line its ends up with the front below, tape it, and screw it from inside.`,
      ],
    });
  }

  // 11 ── Front screw template: hooks over the box front, drilling the oversize holes the screws pass through.
  const fronts: { length: number; height: number; notch: number; drawers: string[] }[] = [];
  for (const d of boxedDrawers(plan)) {
    const length = d.box.width - b;
    const g = fronts.find(x => Math.abs(x.length - length) < 1e-6 && Math.abs(x.height - d.box.height) < 1e-6 && Math.abs(x.notch - d.boxNotchDepth) < 1e-3);
    if (g) g.drawers.push(d.label.toLowerCase()); else fronts.push({ length, height: d.box.height, notch: d.boxNotchDepth, drawers: [d.label.toLowerCase()] });
  }
  const holeRadius = 3 / 16;
  const screwFaces = fronts.map((g, i) => {
    const low = BOTTOM_GROOVE_OFFSET + config.bottomThickness + 0.5;
    // Stay below the box-front notch: a wide pull's notch reaches nearly to the ends.
    const high = Math.min(g.height - 1, g.height - g.notch - 0.5);
    const rows = high - low >= 1.25 ? [low, high] : [(low + Math.max(high, low)) / 2];
    const us = [1.25, g.length - 1.25];
    return jigFace(`screw-template-${i + 1}`, fronts.length === 1 ? 'Front screw template' : `Front screw template ${f(g.length)} × ${f(g.height)}`, g.length, g.height, JIG_STOCK, {
      features: [
        ...us.flatMap(u => rows.map((v, k) => ({ kind: 'hole' as const, label: `Screw hole ${k + 1}`, u, v, radius: holeRadius, depth: JIG_STOCK }))),
        { kind: 'guide', label: 'Fence: the box front’s top edge', points: [[0, g.height], [g.length, g.height]] },
      ],
      orientation: `For ${g.drawers.join(', ')}. Glue a fence along the top (blue) edge.`,
    });
  });
  jigs.push({
    title: 'Front screw template', face: screwFaces[0], extraFaces: screwFaces.slice(1), stage: 'fronts',
    make: `${screwFaces.length === 1 ? 'One template' : `${screwFaces.length} templates`} from ${f(JIG_STOCK)} plywood, each with a fence along the top edge`,
    steps: [
      'Hook the fence over the box front’s top edge from inside, ends flush with the box front’s ends, and drill the holes through the box front.',
      `The ${f(holeRadius * 2)} holes are oversize, so each front can shift a little before you snug the screws. They’re near the ends, well clear of the pull.`,
    ],
  });

  return jigs;
}

/** Slot centres and widths from a slotted piece's outline (its rectangular notches in the top or bottom edge). */
function notchesOf(outline: [number, number][], height: number): { center: number; width: number }[] {
  const found: { center: number; width: number }[] = [];
  for (let i = 0; i + 3 < outline.length; i++) {
    const [a, b, c, d] = [outline[i], outline[i + 1], outline[i + 2], outline[i + 3]];
    const onEdge = (p: [number, number]) => Math.abs(p[1]) < 1e-9 || Math.abs(p[1] - height) < 1e-9;
    if (onEdge(a) && onEdge(d) && Math.abs(a[1] - d[1]) < 1e-9 && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(c[0] - d[0]) < 1e-9 && Math.abs(b[1] - c[1]) < 1e-9 && !onEdge(b)) {
      const lo = Math.min(a[0], d[0]);
      const hi = Math.max(a[0], d[0]);
      found.push({ center: (lo + hi) / 2, width: hi - lo });
    }
  }
  return found.sort((x, y) => x.center - y.center);
}

/** A guide line at each slide's bottom edge for one column, measured from `from` above the side's bottom edge. */
/** The bottom panel's top face, measured like the slide marks (up from the sides' bottom edges). */
export const panelTop = (plan: Pick<DrawerPlan, 'baseHeight' | 'sideBottom'>, T: number) => plan.baseHeight + T - plan.sideBottom;

function slideLines(plan: DrawerPlan, column: number, from: number): Feature[] {
  return boxedDrawers(plan).filter(d => d.column === column).map((d): Feature => ({
    kind: 'guide', label: `${d.label} slide, bottom edge`,
    points: [[d.slideMark - from, plan.frontInset], [d.slideMark - from, plan.frontInset + d.box.depth]],
  }));
}

/** The bottom groove, a hair wider than the bottom so it slides in. */
function groove(length: number, bottomThickness: number): Feature {
  return {
    kind: 'pocket', label: 'Bottom groove', u: 0, v: BOTTOM_GROOVE_OFFSET, length,
    width: bottomThickness + 0.5 / MM_PER_INCH, depth: BOTTOM_GROOVE_DEPTH,
  };
}

/** "2 rabbets, 1 groove", "notched outline", "4 T-nut holes"… */
export function drawerFeatureSummary(face: PartFace): string {
  const counts = new Map<string, number>();
  for (const f of face.features) {
    const word = f.label.includes('rabbet') ? 'rabbet'
      : f.label.includes('groove') ? 'groove'
        : f.label.startsWith('T-nut') ? 'T-nut hole'
          : f.label.includes('slide') ? 'slide line'
            : f.label.startsWith('Caster') ? 'caster outline'
            : f.label === 'Hand hole' ? 'hand hole'
              : f.kind === 'pocketPath' ? 'tool pocket'
                : f.label === 'Finger hole' ? 'finger hole'
              : 'feature';
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const bits = [...counts].map(([word, n]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  if (face.outline && face.part.startsWith('Marker rib')) bits.unshift('notches for markers');
  else if (face.outline && /divider/.test(face.part)) bits.unshift('lap slots');
  else if (face.outline) bits.unshift('finger-pull notch');
  return bits.length ? bits.join(', ') : 'Outline only';
}
