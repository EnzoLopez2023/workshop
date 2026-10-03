// Step-by-step build guide generated from a Shelf Builder design. Each step
// carries its instructions plus a scene description (which parts are shown,
// which are highlighted, and from where) that the renderer turns into an image.

import {
  formatLength,
  shelfSolids,
  type LengthUnit,
  type ShelfConfig,
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
  scene: GuideScene;
}

export interface BuildGuide {
  steps: GuideStep[];
  /** Every solid any scene refers to: the unit's parts plus dado grooves. */
  solids: Solid[];
}

const SHEET_AREA_SQ_IN = 96 * 48;

/** Visual-only boxes marking dado grooves on the inside faces, for the dado step. */
export function dadoGrooves(plan: ShelfPlan, config: ShelfConfig): Solid[] {
  if (plan.dadoDepth <= 0) return [];
  const t = config.thickness;
  const d = plan.dadoDepth;
  const D = config.shelfDepth;
  const W = plan.overallWidth;
  const H = plan.overallHeight;
  const lift = 0.02; // proud of the face so the groove colour shows
  const grooves: Solid[] = [];
  const groove = (name: string, on: string, face: 1 | -1, x0: number, x1: number, y0: number, y1: number): void => {
    grooves.push({ name, kind: 'groove', shape: 'box', min: [x0, y0, -lift], max: [x1, y1, D + lift], on, face });
  };
  const n = plan.bays.length;
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
  return grooves;
}

function screwFor(thickness: number, units: LengthUnit): string {
  // About 2.2× the stock so it bites well into the mating edge.
  const inches = thickness < 0.6 ? 1.25 : 1.625;
  return units === 'mm' ? `${Math.round(inches * 25.4 / 5) * 5} mm` : formatLength(inches, 'in');
}

export function buildGuideSteps(plan: ShelfPlan, config: ShelfConfig, units: LengthUnit): BuildGuide {
  const f = (inches: number) => formatLength(inches, units);
  const solids = [...shelfSolids(plan, config), ...dadoGrooves(plan, config)];
  const names = (pred: (s: Solid) => boolean) => solids.filter(pred).map(s => s.name);
  const isGroove = (s: Solid) => s.kind === 'groove';

  const sides = names(s => s.name === 'Left side' || s.name === 'Right side');
  const panels = names(s => s.name === 'Top' || s.name === 'Bottom' || s.name === 'Toe kick');
  const dividers = names(s => s.name.startsWith('Divider'));
  const shelves = names(s => s.kind === 'shelf');
  const back = names(s => s.kind === 'back');
  const cabinetCleats = names(s => s.name === 'Cabinet cleat' || s.name === 'Bottom spacer');
  const wallCleat = names(s => s.name === 'Wall cleat');
  const grooves = names(isGroove);
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
  const totalArea = plan.parts.reduce((sum, p) => sum + p.qty * p.length * p.width, 0);
  const minSheets = Math.ceil(totalArea / SHEET_AREA_SQ_IN);
  const screw = screwFor(t, units);
  const steps: GuideStep[] = [];

  // 1 ── Overview, materials and tools
  const tools = [
    'Table saw or track saw (a circular saw with a straightedge guide works)',
    dado ? `Router with a straight bit or a dado stack set to ${f(t)} wide — test it on scrap of this sheet` : null,
    'Drill/driver, countersink bit, clamps, square, tape measure, pencil',
    wall ? 'Stud finder and a 4-foot level' : 'Level and shims',
  ].filter((x): x is string => x !== null);
  steps.push({
    id: 'overview',
    title: 'What you’re building',
    summary: `A ${n}-bay ${wall ? 'wall-mounted' : 'floor-standing'} unit, ${f(plan.overallWidth)} wide × ${f(plan.overallHeight)} tall × ${f(plan.sideDepth)} deep.`,
    instructions: [
      `Plywood: ${f(t)} thick, at least ${minSheets} full sheet${minSheets === 1 ? '' : 's'} (4×8 / 1220×2440) before waste — run the Sheet layout below for the real count.`,
      `Fasteners: wood glue and ${screw} wood screws${backParts.length ? '; brad nails or short screws for the back' : ''}${cleat ? `; 3″ (75 mm) screws to fix the wall cleat into studs` : ''}.`,
      `Tools: ${tools.join('; ')}.`,
    ],
    parts: [],
    tips: ['Read every step before cutting — the order matters for squareness.'],
    cautions: [],
    scene: { view: 'front', visible: everything, highlight: [] },
  });

  // 2 ── Cut the parts
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

  // 3 ── Dados
  if (dado) {
    const markLines = plan.marks
      .filter(m => !m.part.startsWith('Top') && !m.part.startsWith('Bottom'))
      .map(m => `${m.part} (${m.reference}): ${m.positions.map(f).join(', ')}`);
    const panelLines = plan.marks
      .filter(m => m.part.startsWith('Top') || m.part.startsWith('Bottom'))
      .map(m => `${m.part} (${m.reference}): ${m.positions.map(f).join(', ')}`);
    steps.push({
      id: 'dados',
      title: 'Lay out and cut the dados',
      summary: `${f(t)}-wide dados, ${f(plan.dadoDepth)} deep, measured to the bottom edge of each groove.`,
      instructions: [
        ...markLines,
        ...panelLines,
        'Clamp mirror-image parts together and mark across both at once so shelves come out level.',
        'Cut a test dado in scrap: the shelf should slide in with hand pressure, no hammering.',
      ],
      parts: [],
      tips: ['A stop block on the router guide or saw fence makes repeated spacings exact.'],
      cautions: plan.warnings.filter(w => w.includes('dado')),
      scene: { view: 'panels', visible: [...sides, ...dividers], highlight: grooves },
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
      summary: `Each bay is ${f(config.bayWidth)} clear.`,
      instructions: [
        dado && (config.topPanel || config.bottomPanel)
          ? 'Glue and slide each divider into its top and bottom dados.'
          : `Set each divider and screw through the top and bottom into its edge with ${screw} screws.`,
        `Cut a spacer block exactly ${f(config.bayWidth)} long and use it to set every bay to the same width.`,
      ],
      parts: guidePart('Divider'),
      tips: ['Check each divider is square to the bottom before the glue grabs.'],
      cautions: [],
      scene: { view: 'front', visible: [...sides, ...panels], highlight: dividers },
    });
  }

  // 6 ── Shelves
  const bayLines = plan.bays.map(b => `Bay ${b.index + 1}: ${b.shelfYs.length} shelf${b.shelfYs.length === 1 ? '' : 'ves'}${b.shelfYs.length ? `, ${f(b.openingHeight)} openings` : ''}`);
  if (shelves.length > 0) {
    steps.push({
      id: 'shelves',
      title: 'Install the shelves',
      summary: `${shelves.length} fixed shelves across ${n} bay${n === 1 ? '' : 's'}.`,
      instructions: [
        ...bayLines,
        dado ? 'Glue the dados and slide each shelf in from the front, flush with the front edge.'
          : `Mark each shelf line on both faces, then glue and screw through the side or divider with ${screw} screws.`,
        !dado && n > 1 ? 'Where shelves meet a divider at the same height on both sides, offset the screws or use pocket screws from underneath.' : null,
      ].filter((x): x is string => x !== null),
      parts: guidePart('Shelf'),
      tips: ['Cut a spacer to the opening height and stack shelves on it from the bottom up.'],
      cautions: [],
      scene: { view: 'front', visible: [...sides, ...panels, ...dividers], highlight: shelves },
    });
  }

  // 7 ── Back
  if (back.length > 0) {
    steps.push({
      id: 'back',
      title: 'Fit the back',
      summary: cleat ? `Inset ${f(plan.cleatGap)} from the back edge of the sides to leave room for the cleat.` : 'Flush with the back edge of the sides.',
      instructions: [
        `Set the back ${f(config.shelfDepth)} from the front edge, tight against the back of every shelf and divider.`,
        backParts.length > 1 ? `The back is ${backParts.length} pieces; their seams land on the middle of a divider so each edge has something to fasten to.` : 'One piece fits between the sides.',
        'Glue and fasten into every shelf, divider, top and bottom — this is what makes the unit rigid and square.',
      ],
      parts: backParts.map(p => ({ name: p.name, qty: p.qty, size: `${f(p.length)} × ${f(p.width)}` })),
      tips: ['Square the case again before the first fastener; the back will lock it that way.'],
      cautions: [],
      scene: { view: 'back', visible: [...sides, ...panels, ...dividers, ...shelves], highlight: back },
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

  // 9 ── Finish
  steps.push({
    id: 'finish',
    title: 'Finish',
    summary: 'Sand, cover the edges, and protect it.',
    instructions: [
      'Fill screw holes, then sand to 180–220 grit.',
      'Cover exposed plywood edges with iron-on edge banding or solid-wood strips if you want a clean look.',
      'Apply your finish; let it cure before loading the shelves.',
    ],
    parts: [],
    tips: ['Finishing before hanging is easier, but keep finish off glue surfaces if you finish parts first.'],
    cautions: [],
    scene: { view: 'front', visible: everything, highlight: [] },
  });

  return { steps, solids };
}
