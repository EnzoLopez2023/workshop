// A wall run of built-ins: copies of the drawer cabinet (mirrored where asked), desk
// gaps between them, and fillers scribed to the walls, under one continuous
// countertop, with the bookcase over each cabinet (and, if asked, over each desk gap)
// and one cap or crown across the top. Real built-ins are made this way: separate
// boxes, butted and screwed together, tied in by the top and the trim.

import { buildBookcase, type BookcaseConfig, type BookcasePlan, DEFAULT_BOOKCASE } from './drawerBookcase.ts';
import { fitsSheet, formatLength, type LengthUnit, type ShelfPart } from './shelving.ts';

export interface RunSection {
  kind: 'cabinet' | 'desk';
  /** A desk gap's width (knee space). */
  width?: number;
  /** A cabinet built as a mirror image (doors hinge the other way). */
  mirror?: boolean;
}

export interface RunConfig {
  enabled: boolean;
  /** Wall to wall; ignored when both ends are open. */
  wallWidth: number;
  sections: RunSection[];
  leftEnd: 'wall' | 'open';
  rightEnd: 'wall' | 'open';
  /** A bookcase over each desk gap too (otherwise the wall above the desk stays open). */
  deskUppers: boolean;
}

export const DEFAULT_RUN: RunConfig = {
  enabled: false,
  wallWidth: 120,
  sections: [{ kind: 'cabinet' }, { kind: 'desk', width: 48 }, { kind: 'cabinet', mirror: true }],
  leftEnd: 'wall',
  rightEnd: 'wall',
  deskUppers: true,
};

/** Fillers are cut this much wider and scribed to the wall. */
export const SCRIBE_ALLOWANCE = 1 / 2;
export const MIN_FILLER = 1 / 2;
export const MAX_FILLER = 6;
const MIN_KNEE = 20;
const COMFORT_KNEE = 24;
/** Plywood countertops longer than a sheet are made in pieces joined over a cabinet. */
const SHEET_LENGTH = 96;

export interface RunSectionPlan {
  kind: 'cabinet' | 'desk';
  /** Left edge from the left wall (or the run's left end). */
  x: number;
  width: number;
  mirror: boolean;
  /** 1-based number among cabinets or among desk gaps. */
  number: number;
  /** A desk gap's own bookcase (cabinets use the unit's). */
  upper: BookcasePlan | null;
}

export interface RunPlan {
  width: number;
  cabinetCount: number;
  sections: RunSectionPlan[];
  fillers: { x: number; width: number; side: 'left' | 'right' }[];
  countertop: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; pieces: number; material: 'plywood' | 'butcher'; layers: number };
  /** Bottom and top of the uppers (null without a bookcase). */
  uppers: { y0: number; topY: number } | null;
  cap: { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number; pieces: number } | null;
  crown: { height: number; projection: number; front: number; x0: number; x1: number; y0: number; returns: ('left' | 'right')[] } | null;
  totalHeight: number;
}

export interface RunContext {
  /** The cabinet: width, height (with its base), case depth and plywood. */
  W: number;
  H: number;
  cd: number;
  T: number;
  frontProjection: number;
  units: LengthUnit;
  bookcase: BookcasePlan | null;
  bookcaseConfig: BookcaseConfig | undefined;
  edgeBanding?: boolean;
  bandingThickness?: number;
}

/** Parts the unit's own bookcase brings that the run replaces with continuous ones. */
export const RUN_REPLACED = /^(Countertop|Countertop \(butcher block\)|Bookcase top cap|Bookcase crown nailer|Bookcase crown nailer, side|Crown molding, front|Crown molding, side)$/;

export function buildRun(run: RunConfig, ctx: RunContext): { plan: RunPlan; parts: ShelfPart[]; errors: string[]; warnings: string[] } {
  const f = (inches: number) => formatLength(inches, ctx.units);
  const errors: string[] = [];
  const warnings: string[] = [];
  const parts: ShelfPart[] = [];
  const { W, H, cd, T } = ctx;

  const sections = run.sections.length ? run.sections : DEFAULT_RUN.sections;
  const cabinets = sections.filter(s => s.kind === 'cabinet').length;
  if (cabinets === 0) errors.push('A wall run needs at least one cabinet.');
  if (sections.length > 8) errors.push('Keep a wall run to 8 sections or fewer.');
  sections.forEach((s, i) => {
    if (s.kind !== 'desk') return;
    const w = s.width ?? 0;
    if (w < MIN_KNEE) errors.push(`Desk gap ${i + 1} is ${f(w)} — knees need at least ${f(MIN_KNEE)}.`);
    else if (w < COMFORT_KNEE) warnings.push(`A ${f(w)} desk gap is tight; ${f(COMFORT_KNEE)} or more is comfortable.`);
    if (w > 60) warnings.push(`A ${f(w)} desk gap is a long span for the countertop — add a stiffener under it (an apron or a steel bar), or a leg.`);
    if (i > 0 && sections[i - 1].kind === 'desk') errors.push('Two desk gaps side by side would leave the countertop unsupported — put a cabinet between them.');
  });

  // Fillers take up whatever's left between the sections and each wall, scribed to fit.
  const sectionWidths = sections.map(s => (s.kind === 'cabinet' ? W : s.width ?? 0));
  const used = sectionWidths.reduce((a, w) => a + w, 0);
  const walls = (['left', 'right'] as const).filter(side => (side === 'left' ? run.leftEnd : run.rightEnd) === 'wall');
  const fillers: RunPlan['fillers'] = [];
  let left = 0;
  let width = used;
  if (walls.length) {
    const spare = run.wallWidth - used;
    const each = spare / walls.length;
    if (each < MIN_FILLER - 1e-6) {
      errors.push(`The sections add up to ${f(used)}, which leaves ${f(Math.max(spare, 0))} on a ${f(run.wallWidth)} wall — fillers need at least ${f(MIN_FILLER)} at each wall to scribe. Narrow a desk gap by ${f(MIN_FILLER * walls.length - spare)}.`);
    } else if (each > MAX_FILLER) {
      warnings.push(`Each filler would be ${f(each)} wide — that’s a lot of blank board. Widen a desk gap by ${f(spare - MAX_FILLER * walls.length)} or add a cabinet.`);
    }
    const fw = Math.max(each, 0);
    if (walls.includes('left')) { fillers.push({ x: 0, width: fw, side: 'left' }); left = fw; }
    width = run.wallWidth;
    if (walls.includes('right')) fillers.push({ x: run.wallWidth - fw, width: fw, side: 'right' });
  }

  // Sections left to right.
  let x = left;
  let cabNo = 0;
  let deskNo = 0;
  const bk = ctx.bookcase;
  const bkc = ctx.bookcaseConfig;
  const plans: RunSectionPlan[] = sections.map((s, i) => {
    const w = sectionWidths[i];
    const plan: RunSectionPlan = { kind: s.kind, x, width: w, mirror: s.kind === 'cabinet' && s.mirror === true, number: s.kind === 'cabinet' ? ++cabNo : ++deskNo, upper: null };
    x += w;
    if (s.kind === 'desk' && bk && bkc && run.deskUppers && w > 0) {
      // Bays about as wide as the cabinet's, no doors.
      const perBay = (W - T) / Math.max(bkc.bays, 1);
      const bays = Math.max(1, Math.round((w - T) / perBay));
      plan.upper = buildBookcase({ ...bkc, bays, doors: [] }, {
        width: w, cabinetHeight: H, caseDepth: cd, frontProjection: ctx.frontProjection, thickness: T,
        exposed: { left: false, right: false }, edgeBanding: ctx.edgeBanding, bandingThickness: ctx.bandingThickness, units: ctx.units, blockers: [],
      });
      errors.push(...plan.upper.errors.filter(e => !/countertop|ceiling/i.test(e)).map(e => `Over desk gap ${plan.number}: ${e}`));
    }
    return plan;
  });
  if (bkc?.seat === 'stacked') errors.push('In a wall run the uppers sit on the countertop — set the bookcase to “On a countertop”.');

  // One countertop across the whole run, overhanging the open ends.
  const c = bkc?.countertop ?? { ...DEFAULT_BOOKCASE.countertop, layers: 2 as const };
  const thickness = c.material === 'plywood' ? T * c.layers : c.thickness;
  const ctX0 = run.leftEnd === 'open' ? -c.overhangSides : 0;
  const ctX1 = width + (run.rightEnd === 'open' ? c.overhangSides : 0);
  const ctLength = ctX1 - ctX0;
  const ctDepth = cd - (-ctx.frontProjection - c.overhangFront);
  const pieces = c.material === 'plywood' ? Math.ceil(ctLength / SHEET_LENGTH) : Math.ceil(ctLength / 144);
  const countertop: RunPlan['countertop'] = { x0: ctX0, x1: ctX1, z0: -ctx.frontProjection - c.overhangFront, z1: cd, y0: H, y1: H + thickness, pieces, material: c.material, layers: c.material === 'plywood' ? c.layers : 1 };
  const pieceLength = ctLength / pieces;
  if (c.material === 'plywood') {
    parts.push({ name: 'Run countertop', qty: pieces * c.layers, length: pieceLength, width: ctDepth, thickness: T,
      note: `${pieces > 1 ? `${pieces} pieces end to end, joined over a cabinet (stagger the joints between layers); ` : ''}${c.layers === 2 ? 'two layers glued and screwed; ' : ''}band the front and open ends`, material: 'plywood' });
    if (!fitsSheet(pieceLength, ctDepth)) errors.push(`The ${f(ctDepth)} deep countertop is wider than a sheet — use butcher block.`);
  } else {
    parts.push({ name: 'Run countertop (butcher block)', qty: pieces, length: pieceLength, width: ctDepth, thickness: c.thickness,
      note: pieces > 1 ? `${pieces} slabs joined with countertop bolts over a cabinet` : 'One slab; fastened with figure-8 clips so it can move', material: 'solid' });
  }

  // Desk gaps: a ledger into the studs at the back and a cleat on each cabinet side carry the top.
  const desks = plans.filter(p => p.kind === 'desk');
  if (desks.length) {
    for (const d of desks) {
      parts.push({ name: `Desk ledger${desks.length > 1 ? ` ${d.number}` : ''}`, qty: 1, length: d.width, width: 3, thickness: T, note: 'Screwed into the studs at countertop height, under the top', material: 'plywood' });
    }
    parts.push({ name: 'Desk side cleat', qty: desks.length * 2, length: cd - 2, width: 3, thickness: T, note: 'Screwed to the cabinet sides facing the desk gap, flush with their tops', material: 'plywood' });
  }

  // Fillers: a face strip (cut wider to scribe) and a return behind it, for the cabinets and the uppers.
  const upperBk = bk && bkc ? bk : null;
  const upperY0 = H + thickness;
  if (fillers.length) {
    const fw = fillers[0].width;
    parts.push({ name: 'Filler, cabinet', qty: fillers.length, length: H, width: fw + SCRIBE_ALLOWANCE, thickness: T, note: `Cut ${f(SCRIBE_ALLOWANCE)} wide and scribed to the wall`, material: 'plywood' });
    parts.push({ name: 'Filler return', qty: fillers.length * (upperBk ? 2 : 1), length: upperBk ? Math.max(H, bkc!.height) : H, width: 3, thickness: T, note: 'Glued behind the filler at right angles; screwed to the cabinet side', material: 'plywood' });
    if (upperBk) parts.push({ name: 'Filler, upper', qty: fillers.length, length: bkc!.height, width: fw + SCRIBE_ALLOWANCE, thickness: T, note: `Cut ${f(SCRIBE_ALLOWANCE)} wide and scribed to the wall`, material: 'plywood' });
  }

  // Top trim across the whole run: one cap, or crown with returns only at open ends.
  let cap: RunPlan['cap'] = null;
  let crown: RunPlan['crown'] = null;
  let totalHeight = H + thickness;
  let uppers: RunPlan['uppers'] = null;
  if (upperBk && bkc) {
    const topY = upperY0 + bkc.height;
    uppers = { y0: upperY0, topY };
    totalHeight = topY;
    const front = cd - bkc.depth - upperBk.shelfPlan.frontDepth;
    const openEnds = (['left', 'right'] as const).filter(side => (side === 'left' ? run.leftEnd : run.rightEnd) === 'open');
    if (bkc.top.style === 'cap') {
      const p = bkc.top.capProjection;
      const x0 = run.leftEnd === 'open' ? -p : 0;
      const x1 = width + (run.rightEnd === 'open' ? p : 0);
      const n = Math.ceil((x1 - x0) / SHEET_LENGTH);
      cap = { x0, x1, z0: front - p, z1: cd, y0: topY, y1: topY + T, pieces: n };
      parts.push({ name: 'Run top cap', qty: n, length: (x1 - x0) / n, width: cd - front + p, thickness: T,
        note: `${n > 1 ? `${n} pieces joined over an upper; ` : ''}screwed down through the uppers’ tops`, material: 'plywood' });
      totalHeight = topY + T;
    } else if (bkc.top.style === 'crown') {
      const { crownHeight: h, crownProjection: p } = bkc.top;
      crown = { height: h, projection: p, front, x0: run.leftEnd === 'open' ? -p : 0, x1: width + (run.rightEnd === 'open' ? p : 0), y0: topY, returns: openEnds };
      parts.push({ name: 'Run crown nailer', qty: Math.ceil(width / SHEET_LENGTH), length: width / Math.ceil(width / SHEET_LENGTH), width: h, thickness: T, note: 'Across the uppers’ tops, flush with their fronts', material: 'plywood' });
      parts.push({ name: 'Run crown molding, front', qty: 1, length: crown.x1 - crown.x0, width: h, thickness: p,
        note: `${openEnds.length ? `45° mitre at the open end${openEnds.length > 1 ? 's' : ''}, ` : ''}square to the walls; splice long runs with a scarf joint over a nailer`, material: 'solid' });
      if (openEnds.length) parts.push({ name: 'Run crown molding, return', qty: openEnds.length, length: cd - front + p, width: h, thickness: p, note: 'Mitred at the front, square at the wall', material: 'solid' });
      totalHeight = topY + h;
    }
  }

  return { plan: { width, cabinetCount: cabinets, sections: plans, fillers, countertop, uppers, cap, crown, totalHeight }, parts, errors, warnings };
}

// ── Saved designs and the form ────────────────────────────────────────────────

export function readRun(raw: unknown): RunConfig | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const v = raw as Record<string, unknown>;
  const sections = Array.isArray(v.sections)
    ? (v.sections as unknown[]).slice(0, 8).flatMap((x): RunSection[] => {
      if (!x || typeof x !== 'object') return [];
      const s = x as Record<string, unknown>;
      if (s.kind === 'desk') return [{ kind: 'desk', width: typeof s.width === 'number' && s.width > 0 && s.width < 240 ? s.width : 48 }];
      if (s.kind === 'cabinet') return [{ kind: 'cabinet', mirror: s.mirror === true }];
      return [];
    })
    : DEFAULT_RUN.sections;
  return {
    enabled: v.enabled === true,
    wallWidth: typeof v.wallWidth === 'number' && v.wallWidth > 0 && v.wallWidth < 1200 ? v.wallWidth : DEFAULT_RUN.wallWidth,
    sections: sections.length ? sections : DEFAULT_RUN.sections,
    leftEnd: v.leftEnd === 'open' ? 'open' : 'wall',
    rightEnd: v.rightEnd === 'open' ? 'open' : 'wall',
    deskUppers: v.deskUppers !== false,
  };
}

export interface RunFields {
  enabled: boolean;
  wallWidth: string;
  /** Sections; desk widths as typed. */
  sections: { kind: 'cabinet' | 'desk'; width: string; mirror: boolean }[];
  leftEnd: 'wall' | 'open';
  rightEnd: 'wall' | 'open';
  deskUppers: boolean;
}

export function runToFields(run: RunConfig | undefined, L: (inches: number) => string): RunFields {
  const r = run ?? DEFAULT_RUN;
  return {
    enabled: run?.enabled === true,
    wallWidth: L(r.wallWidth),
    sections: r.sections.map(s => ({ kind: s.kind, width: L(s.width ?? 48), mirror: s.mirror === true })),
    leftEnd: r.leftEnd,
    rightEnd: r.rightEnd,
    deskUppers: r.deskUppers,
  };
}

export function runFromFields(fields: RunFields | undefined, num: (raw: string, key: string) => number): RunConfig | undefined {
  if (!fields?.enabled) return undefined;
  return {
    enabled: true,
    wallWidth: fields.leftEnd === 'wall' || fields.rightEnd === 'wall' ? num(fields.wallWidth, 'run.wallWidth') : 0,
    sections: fields.sections.map((s, i) => (s.kind === 'desk' ? { kind: 'desk', width: num(s.width, `run.sections.${i}`) } : { kind: 'cabinet', mirror: s.mirror })),
    leftEnd: fields.leftEnd,
    rightEnd: fields.rightEnd,
    deskUppers: fields.deskUppers,
  };
}
