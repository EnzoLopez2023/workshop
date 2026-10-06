// Close-up of one drawer box for the build guide: every box is made the same way,
// so the guide shows one of them, with the joinery the whole-unit model leaves out
// (end rabbets on the sides, the bottom groove on all four parts), as 3D scenes for
// cutting and gluing up, plus a dimensioned drawing of the joints.

import type { GuideDetail, GuideScene } from './buildGuide.ts';
import {
  BOTTOM_GROOVE_DEPTH,
  BOTTOM_GROOVE_OFFSET,
  BOTTOM_PLAY,
  boxedDrawers,
  boxNotchSpec,
  notchedOutline,
  type DrawerConfig,
  type DrawerLayout,
  type DrawerPlan,
} from './drawerUnit.ts';
import type { Solid } from './shelving.ts';

/** The groove is a hair wider than the bottom so it slides in (matches the CNC export). */
export const bottomGrooveWidth = (bottomThickness: number) => bottomThickness + 0.5 / 25.4;

export type BoxPartKey = 'left' | 'right' | 'front' | 'back' | 'bottom';

const PART_NAMES: Record<BoxPartKey, string> = {
  left: 'left side', right: 'right side', front: 'front', back: 'back', bottom: 'bottom',
};

type Face = '-x' | '+x' | '-y' | '+y' | '-z' | '+z';

interface BoxPart {
  key: BoxPartKey;
  /** The part with its joinery cut, in pieces (a profile can't hold a rabbet and a groove at once). */
  wood: Solid[];
  /** Red skins on the faces each cut leaves, shown where the guide asks for cuts. */
  cuts: Solid[];
}

export interface BoxDetail {
  /** The drawer shown; the others with the same box are built identically. */
  drawer: DrawerLayout;
  /** Labels of every drawer with this box, e.g. ["Drawer 1", "Drawer 2"]. */
  sameAs: string[];
  width: number;
  height: number;
  depth: number;
  solids: Solid[];
  scenes: {
    /** Parts unfolded around the bottom, inside faces up, the cuts in red. */
    cut: GuideScene;
    /** The front left corner up close: the side's rabbet and groove, the front pulled out of it. */
    corner: GuideScene;
    /** Front and back going into the left side's rabbets. */
    glue: GuideScene;
    /** The bottom sliding into its grooves. */
    bottom: GuideScene;
    /** The right side closing the box. */
    close: GuideScene;
  };
}

/** The box most drawers share (ties go to the top one), since that's the one most worth showing. */
export function detailDrawer(plan: Pick<DrawerPlan, 'drawers'>): { drawer: DrawerLayout; sameAs: string[] } | null {
  const boxed = boxedDrawers(plan);
  const key = (d: DrawerLayout) => [d.box.width, d.box.height, d.box.depth, d.boxNotchDepth].map(v => v.toFixed(3)).join('|');
  const groups = new Map<string, DrawerLayout[]>();
  for (const d of boxed) groups.set(key(d), [...(groups.get(key(d)) ?? []), d]);
  let best: DrawerLayout[] | null = null;
  for (const g of groups.values()) if (!best || g.length > best.length) best = g;
  return best ? { drawer: best[0], sameAs: best.map(d => d.label) } : null;
}

/**
 * The parts of one box at the origin: x across (0..width), y up (0..height),
 * z back from the box front (0..depth). Sides run the full depth with a
 * b × b/2 rabbet across each end; the front and back sit in those rabbets.
 */
function boxParts(config: DrawerConfig, d: DrawerLayout, corner?: number): BoxPart[] {
  const b = config.boxThickness;
  const r = b / 2;
  const bt = config.bottomThickness;
  const gy = BOTTOM_GROOVE_OFFSET;
  const gd = Math.min(BOTTOM_GROOVE_DEPTH, b * 0.75);
  const gw = bottomGrooveWidth(bt);
  // A corner close-up cuts the side and front off short, with no back rabbet or notch.
  const W = corner ?? d.box.width;
  const H = corner ? Math.min(d.box.height, BOTTOM_GROOVE_OFFSET + bt + 2.5) : d.box.height;
  const D = corner ?? d.box.depth;
  const notch = corner ? null : boxNotchSpec(config.pull, d.front.width, d.boxNotchDepth);

  const box = (name: string, kind: Solid['kind'], min: [number, number, number], max: [number, number, number]): Solid =>
    ({ name, kind, shape: 'box', min, max });
  // A cut is drawn as thin red skins on the faces it leaves in the wood (its floor and
  // walls), so the notch itself stays open and readable. `faces` names the sides of the
  // removed volume that border wood.
  const SKIN = 0.04;
  const cut = (name: string, min: [number, number, number], max: [number, number, number], faces: Face[]): Solid[] =>
    faces.map(face => {
      const axis = 'xyz'.indexOf(face[1]);
      const lo = [...min] as [number, number, number];
      const hi = [...max] as [number, number, number];
      if (face[0] === '-') hi[axis] = Math.min(hi[axis], lo[axis] + SKIN);
      else lo[axis] = Math.max(lo[axis], hi[axis] - SKIN);
      return box(`${name} ${face}`, 'groove', lo, hi);
    });
  const rect = (z0: number, z1: number, y0: number, y1: number): [number, number][] => [[z0, y0], [z1, y0], [z1, y1], [z0, y1]];
  // Layers through the thickness, measured in from the inside face: each layer is
  // either inside the rabbet, inside the groove, both, or neither.
  const layers = [...new Set([0, r, gd, b].filter(s => s <= b))].sort((p, q) => p - q);
  const bands = layers.slice(0, -1).map((s0, i) => [s0, layers[i + 1]] as const);
  const yBands = (inGroove: boolean): [number, number][] => (inGroove ? [[0, gy], [gy + gw, H]] : [[0, H]]);

  const side = (key: 'left' | 'right'): BoxPart => {
    // Inside face at x = b (left) or W − b (right); s runs into the wood from it.
    const xAt = (s: number) => (key === 'left' ? b - s : W - b + s);
    const span = (s0: number, s1: number): [number, number] => {
      const [p, q] = [xAt(s0), xAt(s1)];
      return [Math.min(p, q), Math.max(p, q)];
    };
    const wood: Solid[] = [];
    for (const [s0, s1] of bands) {
      const mid = (s0 + s1) / 2;
      const [z0, z1] = mid < r ? [b, corner ? D : D - b] : [0, D];
      const [x0, x1] = span(s0, s1);
      for (const [y0, y1] of yBands(mid < gd)) {
        wood.push({ name: '', kind: 'drawer-box', shape: 'prism', x0, x1, profile: rect(z0, z1, y0, y1) });
      }
    }
    const [rx0, rx1] = span(0, r);
    const [gx0, gx1] = span(0, gd);
    const floor: Face = key === 'left' ? '-x' : '+x';
    const cuts = [
      ...cut('front rabbet', [rx0, 0, 0], [rx1, H, b], [floor, '+z']),
      ...(corner ? [] : cut('back rabbet', [rx0, 0, D - b], [rx1, H, D], [floor, '-z'])),
      ...cut('bottom groove', [gx0, gy, gd > r ? 0 : b], [gx1, gy + gw, gd > r || corner ? D : D - b], [floor, '-y', '+y']),
    ];
    return { key, wood, cuts };
  };

  const endPanel = (key: 'front' | 'back'): BoxPart => {
    // Inside face at z = b (front) or D − b (back).
    const zAt = (s: number) => (key === 'front' ? b - s : D - b + s);
    const top = (y0: number) => notchedOutline(r, y0, W - b, H - y0, key === 'front' ? notch : null);
    const wood: Solid[] = [];
    for (const [s0, s1] of [[0, gd], [gd, b]] as const) {
      const [z0, z1] = [Math.min(zAt(s0), zAt(s1)), Math.max(zAt(s0), zAt(s1))];
      const outlines = s0 < gd ? [notchedOutline(r, 0, W - b, gy, null), top(gy + gw)] : [top(0)];
      for (const outline of outlines) wood.push({ name: '', kind: 'drawer-box', shape: 'plate', z0, z1, outline });
    }
    const [z0, z1] = [Math.min(zAt(0), zAt(gd)), Math.max(zAt(0), zAt(gd))];
    return { key, wood, cuts: cut('bottom groove', [r, gy, z0], [W - r, gy + gw, z1], [key === 'front' ? '-z' : '+z', '-y', '+y']) };
  };

  const bw = W - 2 * b + 2 * gd - BOTTOM_PLAY;
  const bd = D - 2 * b + 2 * gd - BOTTOM_PLAY;
  const bottom: BoxPart = {
    key: 'bottom',
    wood: [box('', 'drawer-box', [(W - bw) / 2, gy, (D - bd) / 2], [(W + bw) / 2, gy + bt, (D + bd) / 2])],
    cuts: [],
  };
  return [side('left'), endPanel('front'), endPanel('back'), bottom, side('right')];
}

/** Everything the guide needs to show one box being cut and glued up. */
export function boxDetail(plan: DrawerPlan, config: DrawerConfig): BoxDetail | null {
  const picked = detailDrawer(plan);
  if (!picked || config.boxThickness <= 0) return null;
  const { drawer: d, sameAs } = picked;
  const parts = boxParts(config, d);
  const W = d.box.width;
  const H = d.box.height;
  const D = d.box.depth;
  const b = config.boxThickness;
  const solids: Solid[] = [];

  /** One copy of the given parts, renamed for a scene and moved into place. */
  const place = (variant: string, keys: BoxPartKey[], pose: (key: BoxPartKey) => Solid['pose'], withCuts = false, from = parts) => {
    const wood: string[] = [];
    const cuts: string[] = [];
    for (const part of from.filter(p => keys.includes(p.key))) {
      const base = `Box close-up (${variant}) · ${PART_NAMES[part.key]}`;
      part.wood.forEach((s, i) => {
        const name = part.wood.length === 1 ? base : `${base} ${i + 1}`;
        solids.push({ ...s, name, pose: pose(part.key) });
        wood.push(name);
      });
      if (withCuts) {
        for (const c of part.cuts) {
          const name = `${base} · ${c.name}`;
          solids.push({ ...c, name, pose: pose(part.key) });
          cuts.push(name);
        }
      }
    }
    return { wood, cuts };
  };

  // Cutting: unfold the box around its bottom so every inside face, with its cuts, points up.
  const gap = 1;
  const gy = BOTTOM_GROOVE_OFFSET;
  const quarter = Math.PI / 2;
  const unfolded = place('cut', ['left', 'right', 'front', 'back', 'bottom'], key => ({
    left: { rotate: [0, 0, quarter], offset: [-gap, 0, 0] },
    right: { rotate: [0, 0, -quarter], offset: [W + gap, W, 0] },
    front: { rotate: [quarter, 0, 0], offset: [0, 0, -gap] },
    back: { rotate: [-quarter, 0, 0], offset: [0, D, D + gap] },
    bottom: { offset: [0, -gy, 0] },
  } satisfies Record<BoxPartKey, Solid['pose']>)[key], true);

  // The corner: a short length of side and front, the front drawn out of its rabbet.
  const short = Math.max(2.5, 5 * b);
  const corner = place('corner', ['left', 'front'], key => (key === 'front' ? { offset: [short * 0.85, 0, short * 0.75] } : undefined), true,
    boxParts(config, d, short));

  // Glue-up, in order. Parts still to go in sit a little way off, where they come from.
  const away = Math.max(1.5, 3 * b);
  const still = () => undefined;
  const glueBase = place('glue', ['left'], still);
  const glueAdd = place('glue', ['front', 'back'], () => ({ offset: [away, 0, 0] }));
  const bottomBase = place('bottom', ['left', 'front', 'back'], still);
  const bottomAdd = place('bottom', ['bottom'], () => ({ offset: [W * 0.55, 0, 0] }));
  const closeBase = place('close', ['left', 'front', 'back', 'bottom'], still);
  const closeAdd = place('close', ['right'], () => ({ offset: [away, 0, 0] }));

  return {
    drawer: d,
    sameAs,
    width: W,
    height: H,
    depth: D,
    solids,
    scenes: {
      cut: { view: 'above', visible: unfolded.wood, highlight: unfolded.cuts },
      corner: { view: 'corner', visible: corner.wood, highlight: corner.cuts },
      glue: { view: 'detail', visible: glueBase.wood, highlight: glueAdd.wood },
      bottom: { view: 'detail', visible: bottomBase.wood, highlight: bottomAdd.wood },
      close: { view: 'detail', visible: closeBase.wood, highlight: closeAdd.wood },
    },
  };
}

// ── Dimensioned joint drawing ────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Two close-ups of the box joinery at full size or larger: the front corner seen
 * from above (the rabbet), and a section through a side at the bottom groove.
 */
export function boxJointDetail(config: DrawerConfig, f: (inches: number) => string): GuideDetail {
  const b = config.boxThickness;
  const r = b / 2;
  const bt = config.bottomThickness;
  const gy = BOTTOM_GROOVE_OFFSET;
  const gd = BOTTOM_GROOVE_DEPTH;
  const gw = bottomGrooveWidth(bt);
  const s = Math.min(170, Math.max(70, 64 / Math.max(b, 0.1))); // px per inch
  const reach = 1.6; // how far each part runs before the drawing stops, inches
  const ink = '#15332e';
  const wood = '#e8cfa4';
  const wood2 = '#d7b47f';
  const glue = '#2f7fb0';
  const cutRed = '#c0552f';
  const out: string[] = [];

  const poly = (pts: [number, number][], fill: string, extra = '') =>
    out.push(`<polygon points="${pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')}" fill="${fill}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"${extra}/>`);
  const line = (x1: number, y1: number, x2: number, y2: number, color = ink, width = 1, extra = '') =>
    out.push(`<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="${width}"${extra}/>`);
  const text = (x: number, y: number, label: string, anchor: 'start' | 'middle' | 'end' = 'middle', size = 13, weight = 400, color = ink) =>
    out.push(`<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" font-size="${size}" font-weight="${weight}" fill="${color}" stroke="#fff" stroke-width="3" paint-order="stroke">${esc(label)}</text>`);
  /** Dimension between two points on a horizontal or vertical line, label beside it. */
  const dim = (x1: number, y1: number, x2: number, y2: number, label: string, side: 'above' | 'below' | 'left' | 'right') => {
    line(x1, y1, x2, y2, ink, 1, ' marker-start="url(#arrow)" marker-end="url(#arrow)"');
    const vertical = Math.abs(x1 - x2) < 0.5;
    const tick = 5;
    if (vertical) { line(x1 - tick, y1, x1 + tick, y1); line(x2 - tick, y2, x2 + tick, y2); }
    else { line(x1, y1 - tick, x1, y1 + tick); line(x2, y2 - tick, x2, y2 + tick); }
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    if (side === 'above') text(mx, my - 8, label);
    else if (side === 'below') text(mx, my + 18, label);
    else if (side === 'left') text(mx - 9, my + 4, label, 'end');
    else text(mx + 9, my + 4, label, 'start');
  };
  /** A wavy break line where a part runs on past the drawing. */
  const breakLine = (x1: number, y1: number, x2: number, y2: number) => {
    const n = 4;
    const pts: string[] = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const wobble = (i % 2 ? 1 : -1) * (i === 0 || i === n ? 0 : 4);
      const vertical = Math.abs(x1 - x2) < 0.5;
      pts.push(`${(x1 + (x2 - x1) * t + (vertical ? wobble : 0)).toFixed(1)},${(y1 + (y2 - y1) * t + (vertical ? 0 : wobble)).toFixed(1)}`);
    }
    out.push(`<polyline points="${pts.join(' ')}" fill="none" stroke="${ink}" stroke-width="1" stroke-dasharray="3 2"/>`);
  };

  // ── Panel A: the front left corner from above ──
  // Plan coordinates: x across the box, z back from the box front; drawn with the front at the bottom.
  const marginL = 120;
  const top = 92;
  const L = b + reach;
  const ax = (x: number) => marginL + x * s;
  const az = (z: number) => top + (L - z) * s;
  text(marginL - 60, 30, 'Front corner, from above', 'start', 15, 600);
  // The side, with the rabbet out of its inside face, and the box front sitting in it.
  poly([[ax(0), az(0)], [ax(b - r), az(0)], [ax(b - r), az(b)], [ax(b), az(b)], [ax(b), az(L)], [ax(0), az(L)]], wood);
  poly([[ax(b - r), az(0)], [ax(L), az(0)], [ax(L), az(b)], [ax(b - r), az(b)]], wood2);
  breakLine(ax(0), az(L), ax(b), az(L));
  breakLine(ax(L), az(0), ax(L), az(b));
  // Glue faces of the joint.
  out.push(`<polyline points="${ax(b - r)},${az(0)} ${ax(b - r)},${az(b)} ${ax(b)},${az(b)}" fill="none" stroke="${glue}" stroke-width="4" stroke-linecap="round"/>`);
  text(ax(b / 2), az(L) + 0.45 * s, 'side', 'middle', 12, 600);
  text(ax(b + reach / 2 + 0.1), az(b / 2) + 4, 'box front', 'middle', 12, 600);
  dim(ax(0), az(L) - 18, ax(b), az(L) - 18, f(b), 'above');
  dim(ax(b - r), az(0) + 20, ax(b), az(0) + 20, `${f(r)} deep`, 'below');
  dim(ax(0) - 22, az(b), ax(0) - 22, az(0), `${f(b)} wide`, 'left');
  text(ax(L), az(0) + 40, 'front of the drawer ↓', 'end', 11, 400, '#58716b');
  const panelAWidth = ax(L) + 40;

  // ── Panel B: section through a side at the bottom groove ──
  const bx0 = panelAWidth + 150;
  const Hs = gy + gw + 0.9;
  const bxp = (x: number) => bx0 + x * s;
  const byp = (y: number) => top + 10 + (Hs - y) * s;
  text(bx0 - 120, 30, 'Bottom groove, in section', 'start', 15, 600);
  poly([[bxp(0), byp(0)], [bxp(b), byp(0)], [bxp(b), byp(gy)], [bxp(b - gd), byp(gy)], [bxp(b - gd), byp(gy + gw)], [bxp(b), byp(gy + gw)], [bxp(b), byp(Hs)], [bxp(0), byp(Hs)]], wood);
  breakLine(bxp(0), byp(Hs), bxp(b), byp(Hs));
  const bIn = b - gd + BOTTOM_PLAY / 2;
  const bEnd = b + reach;
  poly([[bxp(bIn), byp(gy)], [bxp(bEnd), byp(gy)], [bxp(bEnd), byp(gy + bt)], [bxp(bIn), byp(gy + bt)]], wood2);
  breakLine(bxp(bEnd), byp(gy), bxp(bEnd), byp(gy + bt));
  out.push(`<polyline points="${bxp(b)},${byp(gy + gw)} ${bxp(b - gd)},${byp(gy + gw)} ${bxp(b - gd)},${byp(gy)} ${bxp(b)},${byp(gy)}" fill="none" stroke="${cutRed}" stroke-width="2.5" stroke-dasharray="5 3"/>`);
  line(bxp(-0.5), byp(0), bxp(bEnd + 0.2), byp(0), '#8aa39d', 1, ' stroke-dasharray="2 3"');
  text(bxp(bEnd + 0.2), byp(0) + 16, 'bottom edge of the box', 'end', 11, 400, '#58716b');
  text(bxp(b / 2), byp(Hs) - 10, 'side, front or back', 'middle', 12, 600);
  text(bxp(b + reach * 0.6), byp(gy + bt) - 10, 'bottom', 'middle', 12, 600);
  dim(bxp(0) - 22, byp(0), bxp(0) - 22, byp(gy), `${f(gy)} up`, 'left');
  dim(bxp(0) - 22, byp(gy), bxp(0) - 22, byp(gy + gw), `${f(gw)} wide`, 'left');
  dim(bxp(b - gd), byp(gy + gw) - 0.32 * s, bxp(b), byp(gy + gw) - 0.32 * s, `${f(gd)} deep`, 'above');
  dim(bxp(bEnd) + 24, byp(gy + bt), bxp(bEnd) + 24, byp(gy), f(bt), 'right');

  const width = bxp(bEnd) + 110;
  const height = Math.max(az(0) + 84, byp(0) + 60);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${Math.ceil(width)} ${Math.ceil(height)}" width="${Math.ceil(width)}" height="${Math.ceil(height)}" font-family="-apple-system, 'Segoe UI', system-ui, sans-serif">`
    + `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,1 L9,5 L0,9 z" fill="${ink}"/></marker></defs>`
    + `<rect width="100%" height="100%" fill="#ffffff"/>`
    + out.join('')
    + `<text x="16" y="${Math.ceil(height) - 12}" font-size="11" fill="#58716b">Blue: glue faces. Red dashes: the groove. Not to scale between the two views.</text>`
    + '</svg>';
  return {
    title: `Box joints up close: ${f(b)} × ${f(r)} rabbets, ${f(gw)} groove ${f(gd)} deep, ${f(gy)} up`,
    svg,
    alt: `Two drawings. Left: the front corner of a box from above — the ${f(b)} side has a rabbet ${f(b)} wide and ${f(r)} deep across its end, and the box front sits in it. `
      + `Right: a section through a box side — the bottom groove is ${f(gw)} wide and ${f(gd)} deep, starting ${f(gy)} up from the bottom edge, holding the ${f(bt)} bottom.`,
  };
}
