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
  BOX_NOTCH_EXTRA,
  notchedOutline,
  supportPositions,
  FOOT_SIZE,
  type DrawerConfig,
  type DrawerPlan,
} from './drawerUnit.ts';
import { MM_PER_INCH } from './shelving.ts';
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
      for (const [piece, rightHanded] of [['Left side', false], ['Right side', true]] as const) {
        const features: Feature[] = [
          { kind: 'pocket', label: 'Back rabbet', u: 0, v: part.width - config.backThickness, length: part.length, width: config.backThickness, depth: T / 2 },
          ...plan.drawers.map((d): Feature => ({
            kind: 'guide', label: `Drawer ${d.index + 1} slide, bottom edge`,
            points: [[d.slideMark, 0], [d.slideMark, plan.slideLength]],
          })),
        ];
        faces.push({
          ...base, id: slug(`${piece} inside`), piece, face: 'inside face', features, rightHanded,
          orientation: `The bottom end is at the left and the front edge at the ${rightHanded ? 'bottom' : 'top'} of the drawing, inside face up. Blue lines mark each slide’s bottom edge (not cut).`,
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
      const outline = pull
        ? notchedOutline(0, 0, part.length, part.width, { shape: pull.shape, width: pull.width, depth: Math.max(pull.depth - band, 0.01) })
        : undefined;
      faces.push({
        ...base, id: slug(part.name), piece: part.name, face: pull ? 'outside face' : '', features: [], outline, rightHanded: true,
        orientation: pull ? 'Outside face up, top edge (with the finger pull) at the top of the drawing.' : 'Nothing to machine — just cut the outline.',
      });
      continue;
    }

    if (part.name.startsWith('Box front') || part.name.startsWith('Box back')) {
      // u = along the piece, v = up from the bottom edge, inside face up.
      const features: Feature[] = [groove(part.length, bt)];
      let outline: [number, number][] | undefined;
      if (part.name.startsWith('Box front') && pull) {
        const drawer = plan.drawers[plan.partDrawers[part.name]?.[0] ?? -1];
        if (drawer && drawer.boxNotchDepth > 0) {
          outline = notchedOutline(0, 0, part.length, part.width, {
            shape: pull.shape, width: pull.width + BOX_NOTCH_EXTRA, depth: drawer.boxNotchDepth,
          });
        }
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

    faces.push({ ...base, id: slug(part.name), piece: part.name, face: '', features: [], rightHanded: true, orientation: 'Nothing to machine — just cut the outline.' });
  }
  return faces;
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
              : 'feature';
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  const bits = [...counts].map(([word, n]) => `${n} ${word}${n === 1 ? '' : 's'}`);
  if (face.outline) bits.unshift('finger-pull notch');
  return bits.length ? bits.join(', ') : 'Outline only';
}
