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
  boxNotchSpec,
  frontNotch,
  handHole,
  notchedOutline,
  pullProfile,
  pullWidth,
  stadiumOutline,
  type NotchShape,
  supportPositions,
  FOOT_SIZE,
  type DrawerConfig,
  type DrawerPlan,
} from './drawerUnit.ts';
import { MM_PER_INCH } from './shelving.ts';
import { pieceOutline } from './drawerInserts.ts';
import type { Feature, PartFace } from './shelfExport.ts';

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

  for (const part of plan.parts) {
    const base = { part: part.name, length: part.length, width: part.width, thickness: part.thickness, material: 'plywood' as const };

    if (part.name === 'Side') {
      // u = up from the bottom edge, v = back from the front edge. The left side's
      // inside face points +x, which makes (up, back, +x) left-handed; the right mirrors it.
      // Each side carries the slides of the column next to it.
      const lastColumn = plan.columns.length - 1;
      for (const [piece, rightHanded, column] of [['Left side', false, 0], ['Right side', true, lastColumn]] as const) {
        const features: Feature[] = [
          { kind: 'pocket', label: 'Back rabbet', u: 0, v: part.width - config.backThickness, length: part.length, width: config.backThickness, depth: T / 2 },
          ...slideLines(plan, column, 0),
        ];
        faces.push({
          ...base, id: slug(`${piece} inside`), piece, face: 'inside face', features, rightHanded,
          orientation: `The bottom end is at the left and the front edge at the ${rightHanded ? 'bottom' : 'top'} of the drawing, inside face up. Blue lines mark each slide’s bottom edge (not cut).`,
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
          ...base, id: slug(`${part.name} ${side}`), piece: part.name, face: `${side} face`, features: slideLines(plan, column, T), rightHanded,
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
  return faces;
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

export interface DrawerJig {
  face: PartFace;
  /** How to make and use it. */
  steps: string[];
}

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
  for (const d of plan.drawers) {
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
    const marks = plan.drawers.filter(d => d.column === column.index).map(d => d.slideMark - T);
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
      steps: [
        `Four ${f(config.gap)} spacers set the gap between fronts; two ${f(config.gap / 2)} shims (half as thick) set the bottom reveal.`,
      ],
    });
  }
  return jigs;
}

/** A guide line at each slide's bottom edge for one column, measured from `from` above the side's bottom edge. */
function slideLines(plan: DrawerPlan, column: number, from: number): Feature[] {
  return plan.drawers.filter(d => d.column === column).map((d): Feature => ({
    kind: 'guide', label: `${d.label} slide, bottom edge`,
    points: [[d.slideMark - from, 0], [d.slideMark - from, d.box.depth]],
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
              : 'feature';
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const bits = [...counts].map(([word, n]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  if (face.outline && face.part.startsWith('Marker rib')) bits.unshift('notches for markers');
  else if (face.outline && /divider/.test(face.part)) bits.unshift('lap slots');
  else if (face.outline) bits.unshift('finger-pull notch');
  return bits.length ? bits.join(', ') : 'Outline only';
}
