// Step-by-step build guide generated from a Shelf Builder design. Each step
// carries its instructions plus a scene description (which parts are shown,
// which are highlighted, and from where) that the renderer turns into an image.

import { buildColorMap, optimizeCuts, type CutPiece, type SheetLayout } from './cutPlan.ts';
import { formatSag, hardwareList, quantityLabel, sagCheck, SHELF_LOADS } from './shelfEstimate.ts';
import {
  decimalString,
  formatLength,
  MM_PER_INCH,
  shelfSolids,
  type LengthUnit,
  type ShelfConfig,
  type ShelfPart,
  type ShelfPlan,
  type Solid,
} from './shelving.ts';

/** 'panels' lays the grooved panels flat, grooved face up, as they'd sit on a bench. */
export type GuideView = 'front' | 'back' | 'exploded' | 'panels';

export interface GuideScene {
  view: GuideView;
  /** Names of solids drawn normally (already built). */
  visible: string[];
  /** Names of solids drawn highlighted (added in this step). */
  highlight: string[];
}

export interface GuidePart {
  name: string;
  qty: number;
  size: string;
}

export interface GuideSheets {
  layouts: SheetLayout[];
  /** Part name → fill colour, consistent across sheets. */
  colors: Map<string, string>;
  /** e.g. 96" × 48" or 2440 mm × 1220 mm. */
  sheetSize: string;
  kerf: string;
  yieldPercent: number;
  /** Parts that fit no full sheet. */
  unplaced: string[];
}

export interface GuideStep {
  id: string;
  title: string;
  /** One-line purpose of the step. */
  summary: string;
  instructions: string[];
  parts: GuidePart[];
  tips: string[];
  /** Safety or accuracy notes that matter more than tips. */
  cautions: string[];
  /** 3D illustration, or null for steps illustrated another way (the sheet layout). */
  scene: GuideScene | null;
  sheets?: GuideSheets;
}

export interface BuildGuide {
  steps: GuideStep[];
  /** Every solid any scene refers to: the unit's parts plus dado grooves. */
  solids: Solid[];
}

/** Where each side and divider sits along x, by the names the guide uses. */
function panelXs(plan: ShelfPlan, t: number): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>([
    ['Left side', [0, t]],
    ['Right side', [plan.overallWidth - t, plan.overallWidth]],
  ]);
  plan.dividerXs.forEach((x, j) => map.set(`Divider ${j + 1}`, [x, x + t]));
  return map;
}

/**
 * Visual-only boxes marking what gets cut into the sides and dividers: dado
 * grooves on the inside faces and, for a rabbeted back, the back rabbets.
 */
export function dadoGrooves(plan: ShelfPlan, config: ShelfConfig): Solid[] {
  const t = config.thickness;
  const d = plan.dadoDepth;
  const D = config.shelfDepth;
  const W = plan.overallWidth;
  const H = plan.overallHeight;
  const lift = 0.02; // proud of the face so the groove colour shows
  const grooves: Solid[] = [];
  const groove = (name: string, on: string, face: 1 | -1, x0: number, x1: number, y0: number, y1: number, z0 = -lift, z1 = D + lift): void => {
    grooves.push({ name, kind: 'groove', shape: 'box', min: [x0, y0, z0], max: [x1, y1, z1], on, face });
  };
  const n = plan.bays.length;
  if (d > 0) {
    const sideYs = (ys: number[]) => {
      const list = [...ys];
      if (config.bottomPanel) list.push(plan.kick);
      if (config.topPanel) list.push(H - t);
      return list;
    };
    sideYs(plan.bays[0].shelfYs).forEach((y, i) => groove(`Groove left side ${i + 1}`, 'Left side', 1, t - d, t + lift, y, y + t));
    sideYs(plan.bays[n - 1].shelfYs).forEach((y, i) => groove(`Groove right side ${i + 1}`, 'Right side', -1, W - t - lift, W - t + d, y, y + t));
    plan.dividerXs.forEach((x, j) => {
      const on = `Divider ${j + 1}`;
      plan.bays[j].shelfYs.forEach((y, i) => groove(`Groove divider ${j + 1} left ${i + 1}`, on, -1, x - lift, x + d, y, y + t));
      plan.bays[j + 1].shelfYs.forEach((y, i) => groove(`Groove divider ${j + 1} right ${i + 1}`, on, 1, x + t - d, x + t + lift, y, y + t));
    });
  }
  const r = plan.backRabbet;
  if (r > 0) {
    // Full-length rabbet (or groove, with a cleat) along the back of each side's inside face.
    groove('Back rabbet left', 'Left side', 1, t - r, t + lift, 0, H, D, D + plan.backThickness);
    groove('Back rabbet right', 'Right side', -1, W - t - lift, W - t + r, 0, H, D, D + plan.backThickness);
  }
  return grooves;
}

/** Small boxes for every shelf-pin hole, on the face of the panel it's drilled into. */
export function pinHoleSolids(plan: ShelfPlan, config: ShelfConfig): Solid[] {
  const xs = panelXs(plan, config.thickness);
  // Drawn larger than life: a real 1/4" hole on a 6' panel would be a speck in the picture.
  const r = Math.max(plan.pinDiameter / 2, 0.4);
  const lift = 0.02;
  const solids: Solid[] = [];
  plan.pinHoles.forEach((run, k) => {
    const span = xs.get(run.panel);
    if (!span) return;
    const face: 1 | -1 = run.face === 'right' ? 1 : -1;
    const [x0, x1] = face === 1 ? [span[1] - plan.pinDepth, span[1] + lift] : [span[0] - lift, span[0] + plan.pinDepth];
    run.ys.forEach((y, i) => {
      for (const z of [run.frontInset, run.backInset]) {
        solids.push({
          name: `Pin hole ${k + 1}.${i + 1}.${z === run.frontInset ? 'f' : 'b'}`,
          kind: 'pinhole', shape: 'box', min: [x0, y - r, z - r], max: [x1, y + r, z + r], on: run.panel, face,
        });
      }
    });
  });
  return solids;
}

/** Lays the parts out on full sheets of the design's plywood: 4×8 (or 2440×1220 in mm) and a typical kerf. */
export function planGuideSheets(plan: ShelfPlan, config: ShelfConfig, units: LengthUnit): GuideSheets {
  // Solid-wood parts (the face frame) are bought as boards, not cut from sheets.
  return planPartSheets(plan.parts.filter(part => part.material !== 'solid'), config.thickness, units);
}

/** Lays parts of one thickness out on full 4×8 (or 2440×1220) sheets with a typical kerf. */
export function planPartSheets(parts: ShelfPart[], thicknessInches: number, units: LengthUnit): GuideSheets {
  const metric = units === 'mm';
  const sheetLength = metric ? 2440 / MM_PER_INCH : 96;
  const sheetWidth = metric ? 1220 / MM_PER_INCH : 48;
  const kerf = metric ? 3.2 / MM_PER_INCH : 0.125;
  const thickness = decimalString(thicknessInches);
  const pieces: CutPiece[] = parts.flatMap(part => Array.from({ length: part.qty }, (_, i) => ({
    id: `${part.name}-${i}`,
    partName: part.name,
    length: part.length,
    width: part.width,
    material: 'plywood',
    thickness,
  })));
  const result = optimizeCuts(
    [{ id: 'sheet', length: sheetLength, width: sheetWidth, qty: 999, label: '', thickness }],
    pieces,
    kerf,
  );
  return {
    layouts: result.layouts,
    colors: buildColorMap(result.layouts),
    sheetSize: `${formatLength(sheetLength, units)} × ${formatLength(sheetWidth, units)}`,
    kerf: formatLength(kerf, units),
    yieldPercent: result.overallYieldPercent,
    unplaced: result.unplacedPieces,
  };
}

/** One sheet plan per plywood thickness, thickest first. */
export function planSheetsByThickness(parts: ShelfPart[], units: LengthUnit): { thickness: number; sheets: GuideSheets }[] {
  const thicknesses: number[] = [];
  for (const p of parts) if (!thicknesses.some(t => Math.abs(t - p.thickness) < 1e-6)) thicknesses.push(p.thickness);
  return thicknesses.sort((a, b) => b - a).map(thickness => ({
    thickness,
    sheets: planPartSheets(parts.filter(p => Math.abs(p.thickness - thickness) < 1e-6), thickness, units),
  }));
}

const escapeXml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One sheet as a standalone SVG: parts in their colours, labelled with name and size where they fit. */
export function sheetLayoutSvg(layout: SheetLayout, colors: Map<string, string>, formatDim: (inches: number) => string): string {
  const { sheetLength: L, sheetWidth: W } = layout;
  const font = '-apple-system, BlinkMacSystemFont, Segoe UI, system-ui, sans-serif';
  const pieces = layout.placed.map(p => {
    const fill = colors.get(p.partName) ?? '#D99724';
    const short = Math.min(p.length, p.width);
    const portrait = p.width > p.length;
    const cx = p.x + p.length / 2;
    const cy = p.y + p.width / 2;
    const rotate = portrait ? ` transform="rotate(-90 ${cx} ${cy})"` : '';
    const run = portrait ? p.width : p.length;
    const nameSize = Math.min(short * 0.28, 2.6);
    const dimSize = Math.min(short * 0.2, 1.9);
    const showName = short >= 2 && run >= 5;
    const showDims = short >= 4.5 && run >= 10;
    const maxChars = Math.max(3, Math.floor(run / (nameSize * 0.6)));
    const label = p.partName.length > maxChars ? `${p.partName.slice(0, maxChars - 1)}…` : p.partName;
    const offset = showDims ? nameSize * 0.6 : 0;
    return `<g>
      <rect x="${p.x}" y="${p.y}" width="${p.length}" height="${p.width}" fill="${fill}" fill-opacity="0.85" stroke="#15332E" stroke-width="0.15"/>
      ${showName ? `<text x="${cx}" y="${cy - offset}" font-size="${nameSize.toFixed(2)}" font-family="${font}" font-weight="700" fill="#15332E" text-anchor="middle" dominant-baseline="middle"${rotate}>${escapeXml(label)}</text>` : ''}
      ${showDims ? `<text x="${cx}" y="${cy + offset * 1.4}" font-size="${dimSize.toFixed(2)}" font-family="${font}" fill="#15332E" text-anchor="middle" dominant-baseline="middle"${rotate}>${escapeXml(`${formatDim(p.length)} × ${formatDim(p.width)}`)}</text>` : ''}
    </g>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-0.5 -0.5 ${L + 1} ${W + 1}" width="${(L + 1) * 10}" height="${(W + 1) * 10}">
    <rect x="0" y="0" width="${L}" height="${W}" fill="#F1E4CC" stroke="#15332E" stroke-width="0.3"/>
    ${pieces}
  </svg>`;
}

/** The SVG as an <img>-ready data URL. */
export function sheetLayoutDataUrl(layout: SheetLayout, colors: Map<string, string>, formatDim: (inches: number) => string): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(sheetLayoutSvg(layout, colors, formatDim))}`;
}

/** The shelf openings across all bays: one height if they match, otherwise the range. */
export function describeOpenings(plan: ShelfPlan, f: (inches: number) => string): { phrase: string; min: number; max: number; uniform: boolean } {
  const heights = plan.bays.map(b => b.openingHeight);
  const min = Math.min(...heights);
  const max = Math.max(...heights);
  const uniform = max - min < 1 / 64;
  const counts = plan.bays.map(b => b.shelfYs.length + 1);
  const sameCount = counts.every(c => c === counts[0]);
  const howMany = sameCount ? `${counts[0]} shelf opening${counts[0] === 1 ? '' : 's'}` : 'shelf openings';
  return {
    phrase: uniform ? `${howMany} ${f(min)} clear` : `${howMany} from ${f(min)} to ${f(max)} clear`,
    min,
    max,
    uniform,
  };
}

function screwFor(thickness: number, units: LengthUnit): string {
  // About 2.2× the stock so it bites well into the mating edge.
  const inches = thickness < 0.6 ? 1.25 : 1.625;
  return units === 'mm' ? `${Math.round(inches * 25.4 / 5) * 5} mm` : formatLength(inches, 'in');
}

export function buildGuideSteps(plan: ShelfPlan, config: ShelfConfig, units: LengthUnit): BuildGuide {
  const f = (inches: number) => formatLength(inches, units);
  const solids = [...shelfSolids(plan, config), ...dadoGrooves(plan, config), ...pinHoleSolids(plan, config)];
  const names = (pred: (s: Solid) => boolean) => solids.filter(pred).map(s => s.name);
  const isGroove = (s: Solid) => s.kind === 'groove' || s.kind === 'pinhole';

  const sides = names(s => s.name === 'Left side' || s.name === 'Right side');
  const panels = names(s => s.name === 'Top' || s.name === 'Bottom' || s.name === 'Toe kick');
  const dividers = names(s => s.name.startsWith('Divider'));
  const shelves = names(s => s.kind === 'shelf');
  const adjustable = names(s => s.kind === 'adjustable' || s.kind === 'pin');
  const frameSolids = names(s => s.kind === 'frame');
  const doorSolids = names(s => s.kind === 'door');
  const pinholes = names(s => s.kind === 'pinhole');
  const back = names(s => s.kind === 'back');
  const cabinetCleats = names(s => s.name === 'Cabinet cleat' || s.name === 'Bottom spacer');
  const wallCleat = names(s => s.name === 'Wall cleat');
  const grooves = names(s => s.kind === 'groove');
  const everything = names(s => !isGroove(s) && s.kind !== 'wall-cleat');

  const dado = plan.dadoDepth > 0;
  const cleat = plan.cleatGap > 0;
  const wall = config.mounting === 'wall';
  const n = plan.bays.length;
  const t = config.thickness;
  const part = (name: string) => plan.parts.find(p => p.name === name);
  const guidePart = (name: string): GuidePart[] => {
    const p = part(name);
    return p ? [{ name: p.name, qty: p.qty, size: `${f(p.length)} × ${f(p.width)}` }] : [];
  };
  const backParts = plan.parts.filter(p => p.name.startsWith('Back'));
  const sheets = planGuideSheets(plan, config, units);
  /** Clear height inside each bay: bottom panel's top face to the top panel's underside. */
  const bayHeight = plan.interiorTop - plan.interiorBottom;
  const widths = plan.bays.map(b => b.width);
  const sameWidth = widths.every(w => Math.abs(w - widths[0]) < 1e-6);
  const widthText = sameWidth ? f(widths[0]) : `${f(Math.min(...widths))} to ${f(Math.max(...widths))}`;
  const baySize = `${widthText} wide × ${f(bayHeight)} clear`;
  const hardware = hardwareList(plan, config, units);
  const rabbet = plan.backRabbet > 0;
  const metricPins = config.pinSystem === 'metric';
  const openings = describeOpenings(plan, f);
  const sheetCount = sheets.layouts.length;
  const screw = screwFor(t, units);
  const steps: GuideStep[] = [];

  // 1 ── Overview, materials and tools
  const tools = [
    'Table saw or track saw (a circular saw with a straightedge guide works)',
    dado ? `Router with a straight bit or a dado stack set to ${f(t)} wide — test it on scrap of this sheet` : null,
    rabbet && !dado ? `Router with a rabbeting bit, or a table saw, for the ${f(plan.backRabbet)} back rabbets` : null,
    plan.pinHoles.length ? `Shelf-pin jig and a ${metricPins ? '5 mm' : '1/4″'} bit with a stop collar` : null,
    plan.frame ? 'Pocket-hole jig for the face frame' : null,
    plan.doors.length && !plan.frame ? '35 mm Forstner bit (or a hinge-boring jig) for the hinge cups' : null,
    plan.banding ? (plan.banding.thickness <= 0.025 ? 'Household iron and an edge-banding trimmer' : 'Contact cement (or an edge bander) and a flush-trim router bit') : null,
    'Drill/driver, countersink bit, clamps, square, tape measure, pencil',
    wall ? 'Stud finder and a 4-foot level' : 'Level and shims',
  ].filter((x): x is string => x !== null);
  steps.push({
    id: 'overview',
    title: 'What you’re building',
    summary: `A ${n}-bay ${wall ? 'wall-mounted' : 'floor-standing'} unit, ${f(plan.overallWidth)} wide × ${f(plan.overallHeight)} tall × ${f(plan.sideDepth)} deep. Each bay is ${widthText} wide with ${openings.phrase}.`,
    instructions: [
      `Plywood: ${sheetCount} full sheet${sheetCount === 1 ? '' : 's'} of ${f(t)} (${sheets.sheetSize}), laid out in step 2. Buy one extra if you want room for a miscut.`,
      ...(plan.frame ? [`Solid wood for the face frame: ${f(plan.frame.thickness)} thick, ${f(plan.frame.stileWidth)} wide and up — see the cut list.`] : []),
      `Hardware: ${hardware.filter(h => !h.optional).map(h => `${quantityLabel(h.qty, h.unit)} × ${h.name.charAt(0).toLowerCase()}${h.name.slice(1)}`).join('; ')}.`,
      `Tools: ${tools.join('; ')}.`,
    ],
    parts: [],
    tips: ['Read every step before cutting — the order matters for squareness.'],
    cautions: [],
    scene: { view: 'front', visible: everything, highlight: [] },
  });

  // 2 ── Sheet layout
  steps.push({
    id: 'sheets',
    title: 'Lay out your sheets',
    summary: `${sheetCount} sheet${sheetCount === 1 ? '' : 's'} of ${sheets.sheetSize}, ${sheets.yieldPercent.toFixed(0)}% of the plywood used.`,
    instructions: [
      `Mark each part on its sheet as drawn below, leaving a ${sheets.kerf} saw kerf between cuts.`,
      'Make the long rip cuts first to break each sheet into strips, then crosscut the strips into parts.',
      'Keep each sheet’s offcuts until the build is done — they make good spacer blocks and test pieces.',
    ],
    parts: [],
    tips: ['Have the yard rip the sheets into strips if you don’t have room to handle full sheets.'],
    cautions: [
      ...(sheets.unplaced.length > 0 ? [`These parts are bigger than a full sheet and need a different plan: ${sheets.unplaced.join(', ')}.`] : []),
      'This assumes full, flat sheets. For your own offcuts or sheet sizes, use the Sheet layout tool.',
    ],
    scene: null,
    sheets,
  });

  // 3 ── Cut the parts
  steps.push({
    id: 'cut',
    title: 'Cut every part to size',
    summary: `${plan.parts.reduce((s, p) => s + p.qty, 0)} pieces from the cut list.`,
    instructions: [
      'Rip sheets to width first, then crosscut to length.',
      'Cut identical parts (sides, shelves, dividers) with one fence setting so they match exactly.',
      'Label each piece in pencil with its name and which face goes inside.',
      dado ? `Shelf, top and bottom lengths already include ${f(plan.dadoDepth)} at each end for the dados — don’t subtract it again.` : 'All lengths are finished sizes for butt joints.',
    ],
    parts: plan.parts.map(p => ({ name: p.name, qty: p.qty, size: `${f(p.length)} × ${f(p.width)}` })),
    tips: ['Put the best-looking face of each panel on the side that will show.'],
    cautions: ['Plywood is often thinner than its nominal size. Measure a sheet and use that thickness in the design.'],
    scene: { view: 'exploded', visible: everything, highlight: [] },
  });

  // 3 ── Dados and back rabbets
  if (dado || rabbet) {
    const markLines = plan.marks
      .filter(m => !m.part.startsWith('Top') && !m.part.startsWith('Bottom'))
      .map(m => `${m.part} (${m.reference}): ${m.positions.map(f).join(', ')}`);
    const panelLines = plan.marks
      .filter(m => m.part.startsWith('Top') || m.part.startsWith('Bottom'))
      .map(m => `${m.part} (${m.reference}): ${m.positions.map(f).join(', ')}`);
    const rabbetName = cleat ? 'groove' : 'rabbet';
    const rabbetLine = `Cut a ${f(plan.backRabbet)}-wide, ${f(plan.backThickness)}-deep ${rabbetName} along the back inside edge of each side, `
      + `${f(config.shelfDepth)} from the front edge${cleat ? ' (it stops short of the back edge so the sides can hide the cleat)' : ''}.`;
    steps.push({
      id: 'dados',
      title: dado && rabbet ? `Cut the dados and back ${rabbetName}s` : dado ? 'Lay out and cut the dados' : `Cut the back ${rabbetName}s`,
      summary: dado
        ? `${f(t)}-wide dados, ${f(plan.dadoDepth)} deep, measured to the bottom edge of each groove.${rabbet ? ` Plus a ${rabbetName} for the back in each side.` : ''}`
        : `A ${rabbetName} in each side holds the back.`,
      instructions: [
        ...(dado ? markLines : []),
        ...(dado ? panelLines : []),
        ...(rabbet ? [rabbetLine] : []),
        dado ? 'Clamp mirror-image parts together and mark across both at once so shelves come out level.' : null,
        dado ? 'Cut a test dado in scrap: the shelf should slide in with hand pressure, no hammering.' : null,
      ].filter((x): x is string => x !== null),
      parts: [],
      tips: ['A stop block on the router guide or saw fence makes repeated spacings exact.'],
      cautions: plan.warnings.filter(w => w.includes('dado')),
      scene: { view: 'panels', visible: [...sides, ...dividers], highlight: grooves },
    });
  }

  // 3b ── Shelf-pin holes (before assembly, while the panels lie flat)
  if (plan.pinHoles.length > 0) {
    const dividerBottom = config.bottomPanel ? plan.interiorBottom - plan.dadoDepth : 0;
    const fromEnd = (panel: string, y: number) => y - (panel.startsWith('Divider') ? dividerBottom : 0);
    const runLines = plan.pinHoles.map(run => {
      // Holes come in one group per opening; report where each group starts.
      const groups: number[][] = [];
      run.ys.forEach((y, i) => {
        if (i === 0 || y - run.ys[i - 1] > plan.pinSpacing * 1.5) groups.push([y]);
        else groups[groups.length - 1].push(y);
      });
      const starts = groups.map(g => f(fromEnd(run.panel, g[0])));
      const sizes = [...new Set(groups.map(g => g.length))];
      const perGroup = sizes.length === 1 ? `${sizes[0]} holes` : 'holes';
      return `${run.panel}, ${run.face} face (bay ${run.bay + 1}): ${groups.length === 1 ? `${perGroup} starting` : `${groups.length} groups of ${perGroup}, starting`} `
        + `${starts.join(', ')} above the bottom end${run.staggered ? ' — shifted half a step from the other face' : ''}.`;
    });
    const step = metricPins ? '32 mm' : '1″';
    steps.push({
      id: 'pins',
      title: 'Drill the shelf-pin holes',
      summary: `${metricPins ? '5 mm' : '1/4″'} holes, ${f(plan.pinDepth)} deep, every ${step}, in two columns ${f(plan.pinHoles[0].frontInset)} from the front and back of the shelf area.`,
      instructions: [
        ...runLines,
        `Set a stop collar on the bit at ${f(plan.pinDepth)} so no hole comes through the other face.`,
        'Drill every panel from the same end (bottom) with the jig against the front edge, so the holes line up across the bay.',
      ],
      parts: [],
      tips: [
        'Holes start 2″ clear of each fixed shelf, so the adjustable shelves never collide with them.',
        'The CNC & Shaper export includes a drilling jig: butt it on the shelf below each opening, edge flush with the front, and drill through. Turn it over for the opposite faces.',
      ],
      cautions: plan.pinHoles.some(r => r.staggered)
        ? ['Dividers drilled from both faces have the second face shifted half a step — otherwise the holes would meet in the middle.']
        : [],
      scene: { view: 'panels', visible: [...sides, ...dividers].filter(name => plan.pinHoles.some(r => r.panel === name)), highlight: pinholes },
    });
  }

  // 3c ── Edge banding (before assembly, while every edge is easy to reach)
  if (plan.banding && plan.banding.runs.length > 0) {
    const veneer = plan.banding.thickness <= 0.025;
    const bandedParts = new Set(plan.banding.runs.map(r => r.part));
    const highlight = names(s => {
      if (s.kind === 'door') return bandedParts.has('Door') || [...bandedParts].some(p => p.startsWith('Door'));
      if (!plan.banding!.caseFronts) return false;
      return ['case', 'shelf', 'adjustable'].includes(s.kind) && s.name !== 'Toe kick';
    });
    steps.push({
      id: 'banding',
      title: 'Band the edges',
      summary: `${Math.ceil(plan.banding.totalLength / 12)} ft of ${f(plan.banding.thickness)} ${veneer ? 'wood veneer' : 'PVC'} banding, before assembly.`,
      instructions: [
        ...plan.banding.runs.map(r => `${r.part}: ${r.edges}${r.qty > 1 ? ` on all ${r.qty}` : ''}.`),
        veneer
          ? 'Iron the banding on with a household iron on the cotton setting, then roll it down hard while it’s hot.'
          : 'Glue the banding with contact cement on both surfaces (or run it through an edge bander).',
        'Trim the overhang flush on both faces and ease the corners with fine sandpaper.',
        plan.banding.thickness > 0 ? `Every banded part was cut ${f(plan.banding.thickness)} smaller per banded edge, so it finishes at size once banded.` : null,
      ].filter((x): x is string => x !== null),
      parts: [],
      tips: ['Band the shelf fronts before installing them — it’s far easier than banding inside the case.'],
      cautions: [],
      scene: { view: 'exploded', visible: names(s => !isGroove(s) && s.kind !== 'wall-cleat' && !highlight.includes(s.name)), highlight },
    });
  }

  // 4 ── Case
  const caseParts = ['Side', 'Top', 'Bottom', 'Toe kick'].flatMap(guidePart);
  steps.push({
    id: 'case',
    title: 'Assemble the outer case',
    summary: `Join the two sides${config.topPanel || config.bottomPanel ? ' to the top and bottom' : ''}.`,
    instructions: [
      dado ? 'Glue the top and bottom dados, set the panels in, and clamp across the sides.' : `Glue the joints and drive three ${screw} screws through each side into the top and bottom (pre-drill and countersink).`,
      plan.kick > 0 ? `Fit the toe kick under the bottom, between the sides, ${f(plan.kick)} tall.` : null,
      config.topPanel && config.bottomPanel
        ? `Check the clear height between the bottom and the top is ${f(bayHeight)} at both sides — that is the bay height every divider has to fit.`
        : null,
      'Measure both diagonals; nudge the case until they match, then let the glue set.',
    ].filter((x): x is string => x !== null),
    parts: caseParts,
    tips: ['Assemble on a flat floor or bench, inside face up.'],
    cautions: [],
    scene: { view: 'front', visible: [], highlight: [...sides, ...panels] },
  });

  // 5 ── Dividers
  if (n > 1) {
    steps.push({
      id: 'dividers',
      title: `Install the ${n - 1} divider${n - 1 === 1 ? '' : 's'}`,
      summary: sameWidth ? `Each bay is ${f(widths[0])} clear.` : `Bays are ${widths.map(f).join(', ')} clear, left to right.`,
      instructions: [
        dado && (config.topPanel || config.bottomPanel)
          ? 'Glue and slide each divider into its top and bottom dados.'
          : `Set each divider and screw through the top and bottom into its edge with ${screw} screws.`,
        sameWidth
          ? `Cut a spacer block exactly ${f(widths[0])} long and use it to set every bay to the same width.`
          : `Cut a spacer block for each bay width (${[...new Set(widths.map(f))].join(', ')}) and set the dividers left to right.`,
        `Each bay should end up ${baySize}; measure every one before the glue sets.`,
      ],
      parts: guidePart('Divider'),
      tips: ['Check each divider is square to the bottom before the glue grabs.'],
      cautions: [],
      scene: { view: 'front', visible: [...sides, ...panels], highlight: dividers },
    });
  }

  // 6 ── Shelves
  const bayLines = plan.bays.map(b => {
    const count = b.shelfYs.length + 1;
    const shelvesText = `${b.shelfYs.length} shel${b.shelfYs.length === 1 ? 'f' : 'ves'}`;
    return `Bay ${b.index + 1}: ${count} opening${count === 1 ? '' : 's'}, ${f(b.openingHeight)} clear (${shelvesText})`;
  });
  const sagIssues = sagCheck(plan, config).filter(r => !r.ok);
  const loadName = SHELF_LOADS[config.shelfLoad ?? 'books'].label.split(' —')[0].toLowerCase();
  if (shelves.length > 0 || adjustable.length > 0) {
    steps.push({
      id: 'shelves',
      title: 'Install the shelves',
      summary: [
        shelves.length ? `${shelves.length} fixed shel${shelves.length === 1 ? 'f' : 'ves'}` : null,
        adjustable.length ? `${adjustable.length} adjustable` : null,
      ].filter(Boolean).join(' and ') + ` across ${n} bay${n === 1 ? '' : 's'}.`,
      instructions: [
        ...bayLines,
        shelves.length === 0 ? null : dado ? 'Glue the dados and slide each shelf in from the front, flush with the front edge.'
          : `Mark each shelf line on both faces, then glue and screw through the side or divider with ${screw} screws.`,
        shelves.length && !dado && n > 1 ? 'Where shelves meet a divider at the same height on both sides, offset the screws or use pocket screws from underneath.' : null,
        adjustable.length ? `Set each adjustable shelf on four ${metricPins ? '5 mm' : '1/4″'} shelf pins — they lift out, so put them in last.` : null,
      ].filter((x): x is string => x !== null),
      parts: plan.parts.filter(p => p.name.startsWith('Shelf') || p.name.startsWith('Adjustable shelf'))
        .map(p => ({ name: p.name, qty: p.qty, size: `${f(p.length)} × ${f(p.width)}` })),
      tips: [openings.uniform
        ? `Cut a spacer block exactly ${f(openings.min)} tall — the opening height — and stack each shelf on it from the bottom up.`
        : 'Cut a spacer block to each bay’s opening height and stack that bay’s shelves on it from the bottom up.'],
      cautions: sagIssues.map(r => `Bay ${r.bay + 1}: ${r.kind === 'adjustable' ? 'adjustable shelves' : 'shelves'} will sag about ${formatSag(r.sag, units)} under ${loadName}. `
        + `${r.thicknessNeeded ? `Use ${f(r.thicknessNeeded)} plywood or ` : ''}glue a 1 1/2″ solid-wood strip under the front edge.`),
      scene: { view: 'front', visible: [...sides, ...panels, ...dividers], highlight: [...shelves, ...adjustable] },
    });
  }

  // 7 ── Back
  if (back.length > 0) {
    steps.push({
      id: 'back',
      title: 'Fit the back',
      summary: cleat ? `Inset ${f(plan.cleatGap)} from the back edge of the sides to leave room for the cleat.` : 'Flush with the back edge of the sides.',
      instructions: [
        rabbet
          ? `Drop the back into the ${cleat ? 'grooves' : 'rabbets'} in the sides, tight against the back of every shelf and divider.`
          : `Set the back ${f(config.shelfDepth)} from the front edge, tight against the back of every shelf and divider.`,
        backParts.length > 1 ? `The back is ${backParts.length} pieces; their seams land on the middle of a divider so each edge has something to fasten to.` : rabbet ? 'One piece spans the sides, its edges hidden in the rabbets.' : 'One piece fits between the sides.',
        'Glue and fasten into every shelf, divider, top and bottom — this is what makes the unit rigid and square.',
      ],
      parts: backParts.map(p => ({ name: p.name, qty: p.qty, size: `${f(p.length)} × ${f(p.width)}` })),
      tips: ['Square the case again before the first fastener; the back will lock it that way.'],
      cautions: [],
      scene: { view: 'back', visible: [...sides, ...panels, ...dividers, ...shelves], highlight: back },
    });
  }

  // 7b ── Face frame
  if (plan.frame) {
    const fr = plan.frame;
    const frameParts = plan.parts.filter(p => p.material === 'solid');
    steps.push({
      id: 'frame',
      title: 'Build and attach the face frame',
      summary: `${f(fr.stileWidth)} stiles and ${f(Math.min(fr.topRail, fr.bottomRail))}+ rails in ${f(fr.thickness)} solid wood.`,
      instructions: [
        'Drill two pocket holes in each end of every rail and mullion, on the back face.',
        'Glue and screw the rails between the stiles, then the mullions between the rails. Check the diagonals match.',
        `The bottom rail is ${f(fr.bottomRail)} tall so it covers ${plan.kick > 0 ? 'the toe kick and ' : ''}the bottom panel's front edge.`,
        'Glue the frame to the case front with the outer stiles flush with the outside of the sides and each mullion centred on its divider; fix with brads or screws from inside.',
      ],
      parts: frameParts.map(p => ({ name: p.name, qty: p.qty, size: `${f(p.length)} × ${f(p.width)}` })),
      tips: ['Make the frame a hair proud of the sides and flush-trim it after the glue dries.'],
      cautions: [],
      scene: { view: 'front', visible: names(s => !isGroove(s) && s.kind !== 'wall-cleat' && s.kind !== 'frame' && s.kind !== 'door'), highlight: frameSolids },
    });
  }

  // 8 ── Mounting
  if (cleat) {
    const h = config.cleatHeight;
    const top = plan.overallHeight - (config.topPanel ? t : 0);
    const bevel = Math.min(plan.cleatGap, h / 2);
    const wallCleatTop = top - h + bevel; // highest point of the wall cleat, measured from the unit's bottom
    steps.push({
      id: 'cleat',
      title: 'Hang it on the French cleat',
      summary: 'Two 45° strips lock the unit to the wall.',
      instructions: [
        `Glue and screw the cabinet cleat behind the back, tight under ${config.topPanel ? 'the top' : 'the top edge'}, bevel facing down and toward the wall.`,
        'Fix the bottom spacer behind the back at the bottom so the unit hangs plumb.',
        `Find the studs. Mount the wall cleat level, bevel up and facing the wall, with its top point ${f(wallCleatTop)} above where the bottom of the unit should sit.`,
        'Lift the unit, hook the cleats together, and check level before loading it.',
      ],
      parts: ['Cabinet cleat', 'Wall cleat', 'Bottom spacer'].flatMap(guidePart),
      tips: ['Screw the wall cleat into at least two studs, more for a long unit.'],
      cautions: ['Fasten into studs or proper wall anchors rated for the load — never into drywall alone.'],
      scene: { view: 'back', visible: [...sides, ...panels, ...dividers, ...shelves, ...back], highlight: [...cabinetCleats, ...wallCleat] },
    });
  } else {
    steps.push({
      id: 'install',
      title: wall ? 'Mount it on the wall' : 'Set it in place',
      summary: wall ? 'Screw through the back into studs.' : 'Level it and anchor it against tipping.',
      instructions: wall
        ? ['Find the studs and mark them on the back.', 'Hold the unit level and drive screws through the back into at least two studs.']
        : ['Move the unit into position and level it with shims under the sides.', 'Fix an anti-tip strap or bracket from the top to a wall stud.'],
      parts: [],
      tips: [],
      cautions: !wall && plan.overallHeight > 30 ? ['A tall loaded shelf can tip forward. Always anchor it to the wall.'] : [],
      scene: { view: 'front', visible: everything, highlight: [] },
    });
  }

  // 8b ── Doors (once the unit is in place, so they hang true)
  if (plan.doors.length > 0) {
    const doorParts = plan.parts.filter(p => p.name.startsWith('Door'));
    const hinges = hardware.find(h => h.key === 'hinges');
    steps.push({
      id: 'doors',
      title: `Hang the door${plan.doors.length === 1 ? '' : 's'}`,
      summary: plan.frame
        ? `${plan.doors.length} door${plan.doors.length === 1 ? '' : 's'}, overlapping the face frame by ${f(1 / 2)} all round.`
        : `${plan.doors.length} full-overlay door${plan.doors.length === 1 ? '' : 's'} covering the case edges, ${f(1 / 8)} apart.`,
      instructions: [
        plan.frame
          ? `Use ${hinges?.name.toLowerCase() ?? '1/2″ overlay face-frame hinges'}; screw them to the doors first, then to the frame stiles.`
          : `Drill 35 mm hinge cups ${f(3)} from the top and bottom of each door (and one in the middle of doors over ${f(40)}), with the cup edge about ${f(1 / 8)} from the door edge.`,
        plan.frame ? null : 'Screw the mounting plates to the sides and dividers at the same heights, then clip the doors on.',
        `Adjust the hinge screws until every gap is an even ${f(1 / 8)}.`,
        'Add the knobs or pulls and stick two bumpers inside each door.',
      ].filter((x): x is string => x !== null),
      parts: doorParts.map(p => ({ name: p.name, qty: p.qty, size: `${f(p.length)} × ${f(p.width)}` })),
      tips: ['Mark the hinge positions with a story stick so every door matches.'],
      cautions: [],
      scene: { view: 'front', visible: names(s => !isGroove(s) && s.kind !== 'wall-cleat' && s.kind !== 'door'), highlight: doorSolids },
    });
  }

  // 9 ── Finish
  steps.push({
    id: 'finish',
    title: 'Finish',
    summary: 'Sand, cover the edges, and protect it.',
    instructions: [
      'Fill screw holes, then sand to 180–220 grit.',
      plan.frame
        ? 'Sand the face-frame joints flush and ease the outside corners.'
        : 'Cover exposed plywood edges with iron-on edge banding or solid-wood strips if you want a clean look.',
      'Apply your finish; let it cure before loading the shelves.',
    ],
    parts: [],
    tips: ['Finishing before hanging is easier, but keep finish off glue surfaces if you finish parts first.'],
    cautions: [],
    scene: { view: 'front', visible: everything, highlight: [] },
  });

  return { steps, solids };
}

// ── Printable guide ───────────────────────────────────────────────────────────

function printSheetsStep(step: GuideStep, sheets: GuideSheets, index: number, formatDim: (inches: number) => string): string {
  const total = sheets.layouts.length;
  const figures = sheets.layouts.map((layout, i) => `
      <figure>
        <img src="${sheetLayoutDataUrl(layout, sheets.colors, formatDim)}" alt="Sheet ${i + 1} layout">
        <figcaption>Sheet ${i + 1} of ${total} · ${(100 - layout.wastePercent).toFixed(0)}% used</figcaption>
      </figure>`).join('');
  return `
    <section class="step sheets">
      <div class="body">
        <h2><span class="num">${index + 1}</span>${escapeHtml(step.title)}</h2>
        <p class="summary">${escapeHtml(step.summary)}</p>
        <ol>${step.instructions.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ol>
        ${step.cautions.map(c => `<p class="note caution">⚠ ${escapeHtml(c)}</p>`).join('')}
        ${step.tips.map(t => `<p class="note">Tip: ${escapeHtml(t)}</p>`).join('')}
        <div class="sheet-grid">${figures}</div>
      </div>
    </section>`;
}

const escapeHtml = (s: string) => s
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/**
 * A standalone page for printing or saving as PDF: one block per step with its
 * illustration (a data URL, if drawn), instructions, parts, and notes.
 */
export function guidePrintHtml(
  guide: BuildGuide,
  images: Map<string, string>,
  title: string,
  subtitle: string,
  formatDim: (inches: number) => string,
): string {
  const steps = guide.steps.map((step, i) => {
    if (step.sheets) return printSheetsStep(step, step.sheets, i, formatDim);
    const img = images.get(step.id);
    const legend = step.id === 'dados' ? 'Dados to cut are marked in red.'
      : step.scene && step.scene.highlight.length > 0 && step.id !== 'cut' ? 'Parts added in this step are shown in blue.' : '';
    const parts = step.parts.length === 0 ? '' : `
      <table><thead><tr><th>Part</th><th>Qty</th><th>Size</th></tr></thead><tbody>
        ${step.parts.map(p => `<tr><td>${escapeHtml(p.name)}</td><td>${p.qty}</td><td>${escapeHtml(p.size)}</td></tr>`).join('')}
      </tbody></table>`;
    const notes = [
      ...step.cautions.map(c => `<p class="note caution">⚠ ${escapeHtml(c)}</p>`),
      ...step.tips.map(t => `<p class="note">Tip: ${escapeHtml(t)}</p>`),
    ].join('');
    return `
    <section class="step">
      <div class="figure">
        ${img ? `<img src="${img}" alt="Step ${i + 1} illustration">` : '<div class="noimg">No illustration</div>'}
        ${legend ? `<p class="legend">${legend}</p>` : ''}
      </div>
      <div class="body">
        <h2><span class="num">${i + 1}</span>${escapeHtml(step.title)}</h2>
        <p class="summary">${escapeHtml(step.summary)}</p>
        ${step.instructions.length ? `<ol>${step.instructions.map(line => `<li>${escapeHtml(line)}</li>`).join('')}</ol>` : ''}
        ${parts}
        ${notes}
      </div>
    </section>`;
  }).join('');

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(title)} — Build guide</title>
<style>
  @page { margin: 0.5in; }
  * { box-sizing: border-box; }
  body { margin: 0; color: #15332E; font: 10.5pt/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  header { margin-bottom: 14pt; padding-bottom: 8pt; border-bottom: 1.5pt solid #15332E; }
  header h1 { margin: 0; font-size: 18pt; }
  header p { margin: 3pt 0 0; color: #58716B; }
  .step { display: grid; grid-template-columns: 46% 1fr; gap: 14pt; padding: 12pt 0; border-bottom: 0.75pt solid #C9DAD5; break-inside: avoid; }
  .figure img, .noimg { width: 100%; aspect-ratio: 4 / 3; object-fit: contain; border: 0.75pt solid #C9DAD5; border-radius: 6pt; background: #F4F8F6; }
  .noimg { display: grid; place-items: center; color: #58716B; }
  .legend { margin: 4pt 0 0; color: #58716B; font-size: 8.5pt; }
  h2 { display: flex; align-items: center; gap: 8pt; margin: 0 0 4pt; font-size: 13pt; }
  .num { display: inline-grid; width: 20pt; height: 20pt; place-items: center; border-radius: 50%; background: #125447; color: #fff; font-size: 10pt; }
  .summary { margin: 0 0 6pt; color: #58716B; }
  ol { margin: 0 0 6pt; padding-left: 16pt; }
  li { margin-bottom: 3pt; }
  table { width: 100%; margin: 4pt 0 6pt; border-collapse: collapse; font-size: 9pt; }
  th, td { padding: 3pt 5pt; border-bottom: 0.5pt solid #C9DAD5; text-align: left; }
  th { color: #58716B; font-size: 8pt; }
  .step.sheets { grid-template-columns: 1fr; }
  .sheet-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8pt; margin-top: 6pt; }
  .sheet-grid figure { margin: 0; break-inside: avoid; }
  .sheet-grid img { width: 100%; border: 0.75pt solid #C9DAD5; border-radius: 4pt; }
  .sheet-grid figcaption { color: #58716B; font-size: 8.5pt; }
  .note { margin: 4pt 0 0; padding: 4pt 6pt; border-radius: 4pt; background: #EEF4F2; font-size: 9pt; }
  .caution { background: #FBF0DC; }
  @media print { body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
</style></head><body>
<header><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p></header>
${steps}
<script>window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 300); });<\/script>
</body></html>`;
}
