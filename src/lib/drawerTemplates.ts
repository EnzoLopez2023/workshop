// Built-in starting points for the Drawer Builder: the IKEA ALEX sizes (from
// IKEA's listings — approximate, so measure one if matching matters) plus a few
// custom shapes, and a small front elevation used as a thumbnail.

import { doorNotch, doorNotchCenter, frontNotch, handHole, notchedOutline, stadiumOutline, type DrawerDesignFields, type DrawerPlan, type FingerPull } from './drawerUnit.ts';
import { bookcaseToFields, DEFAULT_BOOKCASE } from './drawerBookcase.ts';
import { lengthToField } from './shelving.ts';
import { DEFAULT_RUN, runToFields } from './drawerRun.ts';

export interface DrawerTemplate {
  id: string;
  name: string;
  description: string;
  /** Inch values; anything left out comes from the builder's defaults. */
  fields: Partial<DrawerDesignFields>;
}

export const DRAWER_TEMPLATES: DrawerTemplate[] = [
  {
    id: 'desk-wall',
    name: 'Built-in desk wall',
    description: 'A wall of built-ins: Shaker cabinets (drawers, and a drawer over a door) at each end of a 4′ desk, uppers with crown above, fillers scribed to a 10′ wall.',
    fields: {
      width: '30', height: '30', depth: '22 7/8', heightMode: 'fronts', drawers: 6, base: 'kick', kickHeight: '4', kickSetback: '3',
      columns: 2, columnWidthMode: 'equal', columnDrawers: [4, 2], columnFronts: [['6', '6', '6', '6'], ['6', '18 1/4']],
      frontHeights: ['6', '6', '6', '6', '6', '18 1/4'],
      insertKinds: ['none', 'none', 'none', 'none', 'none', 'door'],
      doorHinges: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto'],
      doorInside: ['shelves', 'shelves', 'shelves', 'shelves', 'shelves', 'shelves'],
      doorCounts: [1, 1, 1, 1, 1, 1],
      pullEnabled: false, hardwareKind: 'bar', hardwareSpacing: '3 3/4',
      profileStyle: 'shaker', profileMethod: 'pocket', profileRail: '2 1/4', profileDepth: '1/4',
      finishFront: '#2f4f46', finishCase: '#2f4f46',
      bookcase: bookcaseToFields({
        ...DEFAULT_BOOKCASE, enabled: true, height: 48, depth: 12, bays: 2, shelvesPerBay: 1, adjustablePerBay: 2,
        countertop: { ...DEFAULT_BOOKCASE.countertop, layers: 2 },
        top: { ...DEFAULT_BOOKCASE.top, style: 'crown' },
      }, inches => lengthToField(inches, 'in')),
      run: runToFields({ ...DEFAULT_RUN, enabled: true, wallWidth: 120 }, inches => lengthToField(inches, 'in')),
    },
  },
  {
    id: 'built-in-hutch',
    name: 'Built-in with bookcase',
    description: 'Two stacks of drawers on an integrated toe kick, a countertop, and a two-bay bookcase above open space, with crown and a task light.',
    fields: {
      width: '36', height: '30', depth: '22 7/8', heightMode: 'overall', drawers: 8, base: 'kick', kickHeight: '4', kickSetback: '3',
      columns: 2, columnWidthMode: 'equal', columnDrawers: [4, 4], columnFronts: [['6', '6', '6', '6'], ['6', '6', '6', '6']],
      bookcase: bookcaseToFields({
        ...DEFAULT_BOOKCASE, enabled: true, height: 54, depth: 12, bays: 2, shelvesPerBay: 1, adjustablePerBay: 2, openBelow: 16,
        countertop: { ...DEFAULT_BOOKCASE.countertop, layers: 2 },
        top: { ...DEFAULT_BOOKCASE.top, style: 'crown' }, taskLight: true,
      }, inches => lengthToField(inches, 'in')),
    },
  },
  {
    id: 'lagkapten-alex',
    name: 'Desk on two ALEX',
    description: 'Like IKEA’s LAGKAPTEN/ALEX desk: a 140 × 60 cm (55 1/8″ × 23 5/8″) top, 73 cm (28 3/4″) high, on an ALEX 5-drawer unit at each end with 27″ to sit in between.',
    fields: {
      width: '14 1/8', height: '27 1/4', depth: '22 7/8', heightMode: 'overall', drawers: 5, base: 'none',
      desk: true, deskLayout: 'both', deskWidth: '55 1/8', deskHeight: '28 3/4', deskDepth: '23 5/8', deskTopLayers: 2,
    },
  },
  {
    id: 'lagkapten-alex-legs',
    name: 'Desk on one ALEX',
    description: 'Like IKEA’s LAGKAPTEN/ALEX desk with legs: a 140 × 60 cm top, 73 cm high, on one ALEX 5-drawer unit at the left and two legs at the right.',
    fields: {
      width: '14 1/8', height: '27 1/4', depth: '22 7/8', heightMode: 'overall', drawers: 5, base: 'none',
      desk: true, deskLayout: 'left', deskOpenEnd: 'legs', deskWidth: '55 1/8', deskHeight: '28 3/4', deskDepth: '23 5/8', deskTopLayers: 2,
    },
  },
  {
    id: 'alex-5',
    name: 'ALEX 5-drawer',
    description: 'The classic desk pedestal: five equal drawers, 36 × 70 cm (14 1/8″ × 27 1/2″), 58 cm deep.',
    fields: { width: '14 1/8', height: '27 1/2', depth: '22 7/8', heightMode: 'overall', drawers: 5, base: 'none' },
  },
  {
    id: 'alex-9',
    name: 'ALEX 9-drawer',
    description: 'Tall and shallow, nine drawers for art supplies and small parts: 36 × 116 cm, 48 cm deep.',
    fields: { width: '14 1/8', height: '45 5/8', depth: '18 7/8', heightMode: 'overall', drawers: 9, base: 'none' },
  },
  {
    id: 'alex-casters',
    name: 'ALEX on casters',
    description: 'The narrow rolling pedestal that slides under a desk: five drawers, about 36 × 76 cm.',
    fields: { width: '14 1/8', height: '29 7/8', depth: '18 7/8', heightMode: 'overall', drawers: 5, base: 'casters', casterHeight: '2' },
  },
  {
    id: 'alex-wide',
    name: 'ALEX wide on casters',
    description: 'Six wide drawers on casters for paper and flat files: 67 × 66 cm, 48 cm deep.',
    fields: { width: '26 3/8', height: '26', depth: '18 7/8', heightMode: 'overall', drawers: 6, base: 'casters', casterHeight: '2' },
  },
  {
    id: 'dresser',
    name: 'Graduated dresser',
    description: 'Four drawers that get deeper toward the floor, on leveling feet.',
    fields: {
      width: '32', depth: '20', heightMode: 'fronts', drawers: 4,
      frontHeights: ['6', '7 1/4', '8 1/2', '10'], base: 'feet', footHeight: '1/2',
    },
  },
  {
    id: 'two-column',
    name: 'Two-column dresser',
    description: 'A wide dresser with two stacks of four drawers and a partition between them, on leveling feet.',
    fields: {
      width: '40', height: '34', depth: '20', heightMode: 'overall', drawers: 8, base: 'feet', footHeight: '1/2',
      columns: 2, columnWidthMode: 'equal', columnDrawers: [4, 4], columnFronts: [['8', '8', '8', '8'], ['8', '8', '8', '8']],
    },
  },
  {
    id: 'flat-files',
    name: 'Three-column flat files',
    description: 'Three columns of shallow drawers for paper, prints and art supplies.',
    fields: {
      width: '48', height: '30', depth: '24', heightMode: 'overall', drawers: 18, base: 'casters', casterHeight: '2',
      columns: 3, columnWidthMode: 'equal', columnDrawers: [6, 6, 6], columnFronts: [['4', '4', '4', '4', '4', '4'], ['4', '4', '4', '4', '4', '4'], ['4', '4', '4', '4', '4', '4']],
    },
  },
  {
    id: 'workbench',
    name: 'Under-bench parts drawers',
    description: 'Shallow, wide drawers for tools and hardware under a workbench, on leveling feet.',
    fields: { width: '30', height: '30', depth: '24', heightMode: 'overall', drawers: 6, base: 'feet', footHeight: '1/2' },
  },
];

/** A front elevation with the notched fronts, as a standalone SVG string. */
export function drawerThumbnailSvg(plan: DrawerPlan, pull: FingerPull, size = 120, frontColor = '#f4f1ea'): string {
  const W = plan.overallWidth;
  const H = plan.overallHeight;
  const pad = Math.max(W, H) * 0.06;
  const y = (v: number) => H - v;
  const poly = (pts: [number, number][], fill: string) =>
    `<polygon points="${pts.map(([px, py]) => `${px.toFixed(3)},${y(py).toFixed(3)}`).join(' ')}" fill="${fill}" stroke="#15332e" stroke-width="${(W / 90).toFixed(3)}"/>`;
  const hole = handHole(pull);
  const fronts = plan.drawers.map(d => {
    if (d.door) {
      const notch = doorNotch(pull);
      return d.door.leaves.map(l => poly(notchedOutline(l.x, d.front.y, l.width, d.front.height, notch, doorNotchCenter(l, notch)), frontColor)).join('');
    }
    if (d.open) {
      const pts: [number, number][] = [[d.front.x, d.front.y], [d.front.x + d.front.width, d.front.y], [d.front.x + d.front.width, d.front.y + d.front.height], [d.front.x, d.front.y + d.front.height]];
      return poly(pts, '#5b4a36');
    }
    const pts = notchedOutline(d.front.x, d.front.y, d.front.width, d.front.height, frontNotch(pull, d.front.width));
    const holePts = hole ? stadiumOutline(d.front.x + d.front.width / 2, d.front.y + d.front.height - hole.top, hole.width, hole.height) : null;
    return poly(pts, frontColor) + (holePts ? poly(holePts, '#3a3f44') : '');
  }).join('');
  const base = plan.baseHeight > 0
    ? `<rect x="${pad * 0.2}" y="${y(plan.baseHeight)}" width="${W - pad * 0.4}" height="${plan.baseHeight}" fill="#3a3f44" opacity="0.55"/>`
    : '';
  const scale = size / Math.max(W + 2 * pad, H + 2 * pad);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${((W + 2 * pad) * scale).toFixed(1)}" height="${((H + 2 * pad) * scale).toFixed(1)}" viewBox="${-pad} ${-pad} ${W + 2 * pad} ${H + 2 * pad}">`
    + `<rect x="0" y="0" width="${W}" height="${H - plan.baseHeight}" fill="#d8b98c"/>${base}${fronts}</svg>`;
}

export function drawerThumbnailDataUrl(plan: DrawerPlan, pull: FingerPull, size = 120, frontColor?: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawerThumbnailSvg(plan, pull, size, frontColor))}`;
}
