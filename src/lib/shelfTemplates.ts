// Built-in starting points for the Shelf Builder library, plus a small front
// elevation used as a thumbnail for templates and saved designs.

import type { ShelfDesignFields, ShelfPlan } from './shelving.ts';

export interface ShelfTemplate {
  id: string;
  name: string;
  description: string;
  /** Inch values; anything left out comes from the builder's defaults. */
  fields: Partial<ShelfDesignFields>;
}

const sameWidths = (n: number, w: string) => Array.from({ length: n }, () => w);

export const SHELF_TEMPLATES: ShelfTemplate[] = [
  {
    id: 'bookcase',
    name: 'Bookcase',
    description: 'Two bays of dadoed shelves on a toe kick, sized for paperbacks and hardcovers.',
    fields: {
      thickness: '3/4', bayWidth: '17 1/2', shelfDepth: '11 1/4', heightMode: 'opening', openingHeight: '11', bays: 2,
      shelvesPerBay: [5, 5], bayWidthMode: 'same', bayWidths: sameWidths(2, '17 1/2'), adjustablePerBay: [0, 0],
      doorsPerBay: [false, false], joinery: 'dado', dadoDepth: '1/4', mounting: 'floor', toeKick: '3', backJoint: 'rabbet',
      shelfLoad: 'books', edgeBanding: true, bandingThickness: '0.5 mm',
    },
  },
  {
    id: 'garage-wall',
    name: 'Garage wall',
    description: 'Wide wall-hung shelving on a French cleat — easy to lift off and move.',
    fields: {
      thickness: '3/4', bayWidth: '22', shelfDepth: '11 1/4', heightMode: 'opening', openingHeight: '12', bays: 3,
      shelvesPerBay: [3, 3, 3], bayWidthMode: 'same', bayWidths: sameWidths(3, '22'), adjustablePerBay: [0, 0, 0],
      doorsPerBay: [false, false, false], joinery: 'dado', dadoDepth: '1/4', mounting: 'wall', frenchCleat: true, cleatHeight: '3',
      shelfLoad: 'heavy',
    },
  },
  {
    id: 'pantry',
    name: 'Pantry cabinet',
    description: 'Deep floor cabinet with doors and adjustable shelves for cans and jars.',
    fields: {
      thickness: '3/4', bayWidth: '17 1/2', shelfDepth: '15 1/4', heightMode: 'overall', height: '84', bays: 2,
      shelvesPerBay: [1, 1], bayWidthMode: 'same', bayWidths: sameWidths(2, '17 1/2'), adjustablePerBay: [3, 3],
      pinSystem: 'imperial', doorsPerBay: [true, true], joinery: 'dado', dadoDepth: '1/4', mounting: 'floor', toeKick: '4',
      backJoint: 'rabbet', faceFrame: true, stileWidth: '1 1/2', railWidth: '1 1/2', frameThickness: '3/4', shelfLoad: 'heavy',
    },
  },
  {
    id: 'cubbies',
    name: 'Closet cubbies',
    description: 'A grid of 12″ cubes for folded clothes, shoes, or bins.',
    fields: {
      thickness: '3/4', bayWidth: '12', shelfDepth: '11 1/4', heightMode: 'opening', openingHeight: '12', bays: 3,
      shelvesPerBay: [3, 3, 3], bayWidthMode: 'same', bayWidths: sameWidths(3, '12'), adjustablePerBay: [0, 0, 0],
      doorsPerBay: [false, false, false], joinery: 'dado', dadoDepth: '1/4', mounting: 'floor', toeKick: '0',
      shelfLoad: 'light', edgeBanding: true, bandingThickness: '0.5 mm',
    },
  },
  {
    id: 'media',
    name: 'Media console',
    description: 'Low console with a wide open middle bay and doors on the sides.',
    fields: {
      thickness: '3/4', bayWidth: '20', shelfDepth: '15 1/4', heightMode: 'overall', height: '24', bays: 3,
      // The middle bay is 28″, not 30″: at 30″ a 3/4″ shelf sags past the limit under AV gear.
      shelvesPerBay: [1, 0, 1], bayWidthMode: 'custom', bayWidths: ['20', '28', '20'], adjustablePerBay: [0, 0, 0],
      doorsPerBay: [true, false, true], joinery: 'dado', dadoDepth: '1/4', mounting: 'floor', toeKick: '3',
      backJoint: 'rabbet', shelfLoad: 'books', edgeBanding: true, bandingThickness: '1 mm',
    },
  },
  {
    id: 'upper-cabinet',
    name: 'Kitchen upper cabinet',
    description: 'Wall cabinet with a face frame, doors, and adjustable shelves, hung on a cleat.',
    fields: {
      thickness: '3/4', bayWidth: '14 1/2', shelfDepth: '11 1/4', heightMode: 'overall', height: '30', bays: 2,
      shelvesPerBay: [0, 0], bayWidthMode: 'same', bayWidths: sameWidths(2, '14 1/2'), adjustablePerBay: [2, 2],
      pinSystem: 'metric', doorsPerBay: [true, true], joinery: 'dado', dadoDepth: '1/4', mounting: 'wall', frenchCleat: true,
      cleatHeight: '3', backJoint: 'rabbet', faceFrame: true, stileWidth: '1 1/2', railWidth: '1 1/2', frameThickness: '3/4',
      shelfLoad: 'books',
    },
  },
  {
    id: 'floating-shelf',
    name: 'Small wall shelf',
    description: 'A light 1/2″ plywood shelf on a French cleat — two 6″ openings.',
    fields: {
      thickness: '1/2', bayWidth: '24', shelfDepth: '8 1/4', heightMode: 'opening', openingHeight: '6', bays: 1,
      shelvesPerBay: [1], bayWidthMode: 'same', bayWidths: ['24'], adjustablePerBay: [0], doorsPerBay: [false],
      joinery: 'dado', dadoDepth: '3/16', mounting: 'wall', frenchCleat: true, cleatHeight: '2', shelfLoad: 'light',
    },
  },
];

/** A small front elevation (SVG markup) of a planned unit, for thumbnails. */
export function designThumbnailSvg(plan: ShelfPlan, thickness: number): string {
  const W = plan.overallWidth;
  const H = plan.overallHeight;
  const t = thickness;
  const pad = Math.max(W, H) * 0.04;
  const rect = (x: number, y: number, w: number, h: number, fill: string, extra = '') =>
    `<rect x="${x.toFixed(2)}" y="${(H - y - h).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" fill="${fill}"${extra}/>`;
  const ply = '#D8B98C';
  const shelf = '#C79F68';
  const parts: string[] = [];
  parts.push(rect(0, 0, W, H, '#F3EADB'));
  parts.push(rect(0, 0, t, H, ply), rect(W - t, 0, t, H, ply));
  plan.dividerXs.forEach(x => parts.push(rect(x, plan.interiorBottom, t, plan.interiorTop - plan.interiorBottom, ply)));
  if (plan.interiorTop < H) parts.push(rect(t, H - t, W - 2 * t, t, ply));
  if (plan.interiorBottom > 0) parts.push(rect(t, plan.kick, W - 2 * t, t, ply));
  if (plan.kick > 0) parts.push(rect(t, 0, W - 2 * t, plan.kick, '#B9A27E'));
  for (const bay of plan.bays) {
    bay.shelfYs.forEach(y => parts.push(rect(bay.x, y, bay.width, t, shelf)));
    bay.adjustableYs.forEach(y => parts.push(rect(bay.x, y, bay.width, t, shelf, ' opacity="0.6"')));
  }
  if (plan.frame) {
    const f = plan.frame;
    parts.push(rect(0, 0, f.stileWidth, H, '#A97A4C'), rect(W - f.stileWidth, 0, f.stileWidth, H, '#A97A4C'));
    parts.push(rect(0, H - f.topRail, W, f.topRail, '#A97A4C'), rect(0, 0, W, f.bottomRail, '#A97A4C'));
  }
  plan.doors.forEach(d => parts.push(rect(d.x, d.y, d.width, d.height, '#6FB0D4', ' opacity="0.45" stroke="#15332E" stroke-width="0.3"')));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}">${parts.join('')}`
    + `<rect x="0" y="0" width="${W}" height="${H}" fill="none" stroke="#15332E" stroke-width="${Math.max(W, H) * 0.008}"/></svg>`;
}

export const thumbnailDataUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
