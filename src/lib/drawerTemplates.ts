// Built-in starting points for the Drawer Builder: the IKEA ALEX sizes (from
// IKEA's listings — approximate, so measure one if matching matters) plus a few
// custom shapes, and a small front elevation used as a thumbnail.

import { doorNotch, doorNotchCenter, frontNotch, handHole, notchedOutline, stadiumOutline, type DrawerDesignFields, type DrawerPlan, type FingerPull } from './drawerUnit.ts';
import { bookcaseToFields, DEFAULT_BOOKCASE } from './drawerBookcase.ts';
import { lengthToField } from './shelving.ts';
import { DEFAULT_RUN, runToFields, type RunConfig } from './drawerRun.ts';

export interface DrawerTemplate {
  id: string;
  name: string;
  description: string;
  /** Inch values; anything left out comes from the builder's defaults. */
  fields: Partial<DrawerDesignFields>;
}

const L = (inches: number) => lengthToField(inches, 'in');
/** Shaker fronts with bar pulls, the built-in look. */
const SHAKER: Partial<DrawerDesignFields> = {
  pullEnabled: false, hardwareKind: 'bar', hardwareSpacing: '3 3/4',
  profileStyle: 'shaker', profileMethod: 'pocket', profileRail: '2 1/4', profileDepth: '1/4',
};
const runFields = (run: Partial<RunConfig>) => runToFields({ ...DEFAULT_RUN, enabled: true, ...run }, L);

export const DRAWER_TEMPLATES: DrawerTemplate[] = [
  {
    id: 'display-wall',
    name: 'Display wall',
    description: 'Three shallow 16″ cabinets with wide flat drawers for stored work, an open lit band above the counter for a pegboard or leaning boards, and display shelves to the top.',
    fields: {
      ...SHAKER,
      width: '42', height: '30', depth: '16', heightMode: 'overall', drawers: 6, base: 'kick', kickHeight: '4', kickSetback: '3',
      columns: 2, columnWidthMode: 'equal', columnDrawers: [3, 3], columnFronts: [['8', '8', '8'], ['8', '8', '8']],
      bookcase: bookcaseToFields({
        ...DEFAULT_BOOKCASE, enabled: true, height: 66, depth: 10, bays: 2, shelvesPerBay: 1, adjustablePerBay: 1, openBelow: 24,
        countertop: { ...DEFAULT_BOOKCASE.countertop, layers: 2 }, top: { ...DEFAULT_BOOKCASE.top, style: 'cap' }, taskLight: true,
      }, L),
      run: runFields({ wallWidth: 126, leftEnd: 'open', rightEnd: 'open', sections: [{ kind: 'cabinet' }, { kind: 'cabinet' }, { kind: 'cabinet', mirror: true }] }),
    },
  },
  {
    id: 'hutch-run',
    name: 'Hutch run',
    description: 'Desk-height cabinets wall to wall (a drawer stack beside a door in each), one 30″ countertop, and a bookcase hutch with crown over an open band — the wall a peninsula desk tees off.',
    fields: {
      ...SHAKER,
      width: '36', height: '28 1/2', depth: '23 7/8', heightMode: 'overall', drawers: 4, base: 'kick', kickHeight: '4', kickSetback: '3',
      columns: 2, columnWidthMode: 'equal', columnDrawers: [3, 1], columnFronts: [['7', '7', '7'], ['21 3/4']],
      insertKinds: ['none', 'none', 'none', 'door'],
      doorHinges: ['auto', 'auto', 'auto', 'auto'], doorInside: ['shelves', 'shelves', 'shelves', 'shelves'], doorCounts: [1, 1, 1, 1],
      bookcase: bookcaseToFields({
        ...DEFAULT_BOOKCASE, enabled: true, height: 64, depth: 12, bays: 2, shelvesPerBay: 1, adjustablePerBay: 2, openBelow: 18,
        countertop: { ...DEFAULT_BOOKCASE.countertop, layers: 2 }, top: { ...DEFAULT_BOOKCASE.top, style: 'crown' }, taskLight: true,
      }, L),
      run: runFields({ wallWidth: 113, sections: [{ kind: 'cabinet' }, { kind: 'cabinet' }, { kind: 'cabinet', mirror: true }] }),
    },
  },
  {
    id: 'peninsula-desk',
    name: 'Peninsula desk',
    description: 'A 76″ × 30″ desk that tees off a hutch run: a drawer unit holds up the free end, and a ledger screwed to the hutch cabinet carries the end that butts into it. Same 30″ height as the hutch counter.',
    fields: {
      ...SHAKER,
      width: '18', height: '28 1/2', depth: '23 7/8', heightMode: 'overall', drawers: 3, base: 'none',
      desk: true, deskLayout: 'left', deskOpenEnd: 'ledger', deskWidth: '76', deskHeight: '30', deskDepth: '30', deskTopLayers: 2,
    },
  },
  {
    id: 'corner-desk',
    name: 'Corner desk',
    description: 'An L-shaped desk into a corner: a drawer cabinet at each open end, knee space along both walls that meets in the corner, under one countertop at 30″.',
    fields: {
      ...SHAKER,
      width: '18', height: '28 1/2', depth: '23 7/8', heightMode: 'overall', drawers: 3, base: 'kick', kickHeight: '4', kickSetback: '3',
      run: runFields({
        wallWidth: 72, leftEnd: 'open', rightEnd: 'wall', deskUppers: false,
        sections: [{ kind: 'cabinet' }, { kind: 'desk', width: 30 }],
        corner: { side: 'right', wallLength: 72, end: 'open', sections: [{ kind: 'desk', width: 30 }, { kind: 'cabinet', mirror: true }] },
      }),
    },
  },
  {
    id: 'corner-storage',
    name: 'Corner storage with top',
    description: 'Base cabinets that wrap a corner under one deep countertop at 32″ — room for printers on top, tool drawers and a cupboard below — with a blind corner cabinet using the corner and tall open shelving above for spools and dry boxes.',
    fields: {
      ...SHAKER,
      width: '30', height: '30 1/2', depth: '27', heightMode: 'overall', drawers: 6, base: 'kick', kickHeight: '4', kickSetback: '3',
      columns: 2, columnWidthMode: 'equal', columnDrawers: [4, 2], columnFronts: [['6', '6', '6', '6'], ['6', '18']],
      insertKinds: ['none', 'none', 'none', 'none', 'none', 'door'],
      doorHinges: ['auto', 'auto', 'auto', 'auto', 'auto', 'auto'], doorInside: ['shelves', 'shelves', 'shelves', 'shelves', 'shelves', 'shelves'], doorCounts: [1, 1, 1, 1, 1, 1],
      bookcase: bookcaseToFields({
        ...DEFAULT_BOOKCASE, enabled: true, height: 70, depth: 12, bays: 2, shelvesPerBay: 2, adjustablePerBay: 2, openBelow: 24,
        countertop: { ...DEFAULT_BOOKCASE.countertop, layers: 2 }, top: { ...DEFAULT_BOOKCASE.top, style: 'cap' },
      }, L),
      run: runFields({
        wallWidth: 90, leftEnd: 'open', rightEnd: 'wall',
        sections: [{ kind: 'cabinet', mirror: true }, { kind: 'cabinet' }],
        corner: { side: 'right', wallLength: 64, end: 'open', style: 'blind', sections: [{ kind: 'cabinet', mirror: true }] },
      }),
    },
  },
  {
    id: 'blind-corner-base',
    name: 'Blind corner base',
    description: 'A 45″ blind corner base cabinet: an 18″ opening with a drawer over a door, and the case running on 27″ into the corner behind the next run — reach in through the door to a long shelf.',
    fields: {
      ...SHAKER,
      width: '18', depth: '24', heightMode: 'fronts', drawers: 2, frontHeights: ['6', '23 3/4'], base: 'kick', kickHeight: '4', kickSetback: '3',
      insertKinds: ['none', 'door'], doorHinges: ['auto', 'auto'], doorInside: ['shelves', 'shelves'], doorCounts: [1, 1],
      blind: true, blindSide: 'right', blindWidth: '27',
    },
  },
  {
    id: 'upper-wall-cabinet',
    name: 'Upper wall cabinet',
    description: 'A 30″ × 30″ × 12″ cabinet on its own, hung on a French cleat 54″ off the floor, with a pair of doors over two adjustable shelves.',
    fields: {
      ...SHAKER,
      width: '30', height: '30', depth: '12', heightMode: 'overall', drawers: 1, base: 'none',
      mount: 'wall', mountHeight: '54', cleatHeight: '3',
      insertKinds: ['door'], doorHinges: ['auto'], doorInside: ['shelves'], doorCounts: [2],
    },
  },
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
  const bl = plan.blind;
  // A blind corner cabinet: the opening plus the blind side beside it.
  const W = bl ? bl.totalWidth : plan.overallWidth;
  const ox = bl?.side === 'left' ? bl.width : 0;
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
    + `<rect x="0" y="0" width="${W}" height="${H - plan.baseHeight}" fill="#d8b98c"/>${base}`
    + (bl ? `<rect x="${(bl.panel.x0 + ox).toFixed(3)}" y="${y(bl.panel.y1).toFixed(3)}" width="${(bl.panel.x1 - bl.panel.x0).toFixed(3)}" height="${(bl.panel.y1 - bl.panel.y0).toFixed(3)}" fill="#c9a979" stroke="#15332e" stroke-width="${(W / 90).toFixed(3)}"/>` : '')
    + `<g transform="translate(${ox} 0)">${fronts}</g></svg>`;
}

export function drawerThumbnailDataUrl(plan: DrawerPlan, pull: FingerPull, size = 120, frontColor?: string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(drawerThumbnailSvg(plan, pull, size, frontColor))}`;
}
