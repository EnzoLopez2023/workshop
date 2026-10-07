// Step-by-step build guide for a Drawer Builder unit, in the same shape as the
// Shelf Builder's guide (see buildGuide.ts) so it renders and prints the same way.

import { planSheetsByThickness, type BuildGuide, type GuidePart, type GuideStep } from './buildGuide.ts';
import {
  BOTTOM_GROOVE_DEPTH,
  BOTTOM_GROOVE_OFFSET,
  BOX_NOTCH_EXTRA,
  baseDescription,
  boxedDrawers,
  runSolids,
  deskSolids,
  drawerSolids,
  FINGER_ROOM,
  ALEX_TAPER,
  FOOT_SIZE,
  HANDHOLE_TOP,
  pullWidth,
  sheetParts,
  HINGE_PLATE_SETBACK,
  PULL_HOLE,
  PIN_DEPTH,
  PIN_HOLE,
  PIN_INSET,
  PIN_SPACING,
  SLIDE_CLEARANCE,
  supportPositions,
  type DrawerConfig,
  type DrawerPlan,
} from './drawerUnit.ts';
import { formatLength, type LengthUnit, type ShelfPart } from './shelving.ts';
import type { InsertLayout } from './drawerInserts.ts';
import { panelTop, TNUT_HOLE } from './drawerExport.ts';
import { HINGE_CUP_INSET } from './shelfExport.ts';
import { boxDetail, boxJointDetail, bottomGrooveWidth } from './drawerBoxDetail.ts';
import { bookcaseName, withValance } from './drawerBookcase.ts';
import { buildGuideSteps } from './buildGuide.ts';
import type { Solid } from './shelving.ts';

export function drawerGuideSteps(plan: DrawerPlan, config: DrawerConfig, units: LengthUnit): BuildGuide {
  const f = (inches: number) => formatLength(inches, units);
  const unitSolids = drawerSolids(plan, config);
  // The desk step shows every unit under the top, named apart from the single unit the other steps build.
  const desk = plan.desk ? deskSolids(plan, config, true) : [];
  // One box up close, with its rabbets and grooves, for the joinery and glue-up steps.
  const detail = boxDetail(plan, config);
  // The bookcase is built on the bench first (its own Shelf Builder steps, drawn on their own), then set on the cabinet.
  const bk = plan.bookcase;
  const benchName = (name: string) => `On the bench · ${bookcaseName(name)}`;
  const bench = bk ? buildGuideSteps(bk.shelfPlan, bk.shelfConfig, units) : null;
  const benchSolids: Solid[] = bench
    ? withValance(bk!.config, bench.solids).map(s => ({ ...s, name: benchName(s.name), ...(s.shape === 'box' && s.on ? { on: benchName(s.on) } : {}) }))
    : [];
  const run = plan.run;
  const runAll = run ? runSolids(plan, config) : [];
  const solids = [...unitSolids, ...desk, ...(detail?.solids ?? []), ...benchSolids, ...runAll];
  const names = (match: (name: string) => boolean) => unitSolids.filter(s => match(s.name)).map(s => s.name);
  const T = config.thickness;
  const b = config.boxThickness;
  const boxed = boxedDrawers(plan);
  const cubbies = plan.drawers.filter(d => d.open);
  const n = boxed.length;
  const pull = config.pull.enabled ? config.pull : null;
  const sized = (parts: ShelfPart[]): GuidePart[] =>
    parts.map(p => ({ name: p.name, qty: p.qty, size: `${f(p.length)} × ${f(p.width)} × ${f(p.thickness)}` }));
  const partsWhere = (prefix: string[]) => plan.parts.filter(p => prefix.some(x => p.name.startsWith(x)));

  const partitionNames = names(name => name.startsWith('Partition'));
  // An integrated toe kick's board and nailer go in with the case.
  const kickNames = names(name => name === 'Toe kick' || name === 'Kick nailer');
  const caseNames = ['Left side', 'Right side', 'Top', 'Bottom', ...partitionNames, ...kickNames];
  const plinthNames = names(name => name.startsWith('Plinth'));
  const baseboardNames = names(name => name.startsWith('Baseboard'));
  const back = ['Back'];
  const supports = [...names(name => name.startsWith('Foot') || name.startsWith('Caster')), ...plinthNames];
  const slides = names(name => name.endsWith(' slide'));
  const boxes = names(name => / box /.test(name));
  // Drawer fronts with their Shaker panels or strips and their pulls.
  const fronts = unitSolids.filter(s => s.kind === 'drawer-front' || (s.kind === 'pin' && / front (knob|pull)/.test(s.name))).map(s => s.name);
  // Doors and what's behind them.
  const doorSlots = plan.drawers.filter(d => d.door);
  const doorLeaves = unitSolids.filter(s => s.kind === 'door' || (s.kind === 'pin' && / (knob|pull)( \d+)?$/.test(s.name) && !/ front /.test(s.name))).map(s => s.name);
  const trayNames = names(name => / tray \d+ /.test(name) || / (left|right) spacer$/.test(name));
  const everything = unitSolids.map(s => s.name);
  const insertNames = names(name => / (divider|marker rib) \d+$/.test(name) || name.endsWith('Gridfinity baseplate') || name.endsWith('tool board'));

  const steps: GuideStep[] = [];

  // 1 ── Overview
  const baseText = baseDescription(config, plan);
  steps.push({
    id: 'overview',
    title: 'What you’re building',
    summary: `A ${f(plan.overallWidth)} wide, ${f(plan.overallHeight)} tall, ${f(plan.overallDepth)} deep unit with ${n} drawer${n === 1 ? '' : 's'}, ${baseText}.`,
    instructions: [
      `The case is ${f(T)} plywood: full-height sides with the top and bottom fitted between them, and a ${f(config.backThickness)} back let into rabbets in the sides.`,
      `Each drawer is a ${f(b)} plywood box riding on a pair of ${f(plan.slideLength)} LONTAN soft-close slides, with a ${f(T)} ${plan.frontInset > 0 ? 'inset front (flush with the case, like the ALEX)' : 'full-overlay front'} screwed on from inside.`,
      !pull ? 'The fronts have no finger pull — add knobs or pulls of your choice.'
        : pull.shape === 'handhole'
          ? `Instead of handles, each front has a ${f(pull.width)} × ${f(pull.depth)} hand hole just below its top edge, and the box front behind it is notched so your fingers can hook the front.`
          : `Instead of handles, each front has a ${pull.shape === 'arc' ? 'shallow arc' : pull.shape === 'wide' ? 'long slot' : 'rounded slot'} cut into its top edge — ${f(pullWidth(pull, boxed[0]?.front.width ?? 0))} wide and ${f(pull.depth)} deep — and the box front behind it is notched so your fingers can hook the front.`,
      plan.columns.length > 1
        ? `${plan.columns.length} columns of drawers (openings ${plan.columns.map(c => f(c.width)).join(', ')}) with ${f(T)} partitions between them; ${plan.columns.map(c => `column ${c.index + 1} has ${c.drawers.length}`).join(', ')}.`
        : `Fronts are ${boxed.map(d => f(d.front.height)).join(', ')} tall (top to bottom), with ${f(config.gap)} gaps.`,
      ...(cubbies.length ? [`${cubbies.length === 1 ? 'One position is an open cubby' : `${cubbies.length} positions are open cubbies`} (${cubbies.map(d => d.label.toLowerCase()).join(', ')}), with a fixed shelf for a floor where it isn’t at the bottom.`] : []),
      ...(plan.desk ? [`${plan.unitCount === 2 ? 'Two units go' : 'The unit goes'} under a ${f(plan.desk.width)} × ${f(plan.desk.depth)} desk top, ${f(plan.desk.height)} off the floor.`] : []),
      ...(run ? [`A ${f(run.width)} wall run: build this cabinet ${run.cabinetCount} time${run.cabinetCount === 1 ? '' : 's'}${run.sections.some(x => x.mirror) ? ' (mirrored ones hinge their doors the other way)' : ''}${bk ? ', each with its bookcase' : ''}, then set them along the wall${run.sections.some(x => x.kind === 'desk') ? ' with desk gaps between' : ''} under one countertop. The steps below build one; repeat them for the rest.`] : []),
    ],
    parts: [],
    tips: [
      'Read every step before cutting: the T-nuts and slide lines are much easier to do on loose panels.',
      'Cut the shop jigs from the CNC section first — the pull templates and the slide story stick make every drawer match.',
    ],
    cautions: plan.unitCount > 1 ? ['The steps show one unit; the cut list has the parts for both. Build them side by side so they match.'] : [],
    scene: { view: 'front', visible: everything, highlight: [] },
  });

  // 2 ── Sheet layouts, one step per plywood thickness
  for (const group of planSheetsByThickness(sheetParts(plan.parts), units)) {
    const count = group.sheets.layouts.length;
    steps.push({
      id: `sheets-${group.thickness}`,
      title: `Lay out the ${f(group.thickness)} sheet${count === 1 ? '' : 's'}`,
      summary: `${count} sheet${count === 1 ? '' : 's'} of ${group.sheets.sheetSize} ${f(group.thickness)} plywood, ${group.sheets.kerf} kerf, about ${group.sheets.yieldPercent.toFixed(0)}% used.`,
      instructions: [
        'Mark each part on the sheet as shown before cutting, so a mistake costs a line of pencil and not a part.',
        'Keep the grain running the long way on fronts and sides so they look like one piece.',
      ],
      parts: [],
      tips: [],
      cautions: group.sheets.unplaced.length ? [`${group.sheets.unplaced.length} part(s) don’t fit a full sheet; check the cut list.`] : [],
      scene: null,
      sheets: group.sheets,
    });
  }

  // 3 ── Cut
  steps.push({
    id: 'cut',
    title: 'Cut every part to size',
    summary: `${plan.parts.reduce((s, p) => s + p.qty, 0)} pieces from the cut list.`,
    instructions: [
      'Rip to width first, then crosscut to length.',
      'Cut each group of identical parts with one fence setting so they match exactly — box sides especially.',
      'Label every piece in pencil with its drawer number and which face goes inside.',
      plan.banding ? `Banded parts are already ${f(plan.banding.thickness)} short on each banded edge, so they finish at size.` : 'All sizes are finished sizes.',
    ],
    parts: sized(plan.parts),
    tips: ['Cut the fronts from one strip, in order top to bottom, so the grain runs continuously across the face of the unit.'],
    cautions: ['Plywood is often thinner than its nominal size. Measure the sheets and enter the real thickness in the design.'],
    scene: { view: 'exploded', visible: everything, highlight: [] },
  });

  // 4 ── Rabbets and grooves
  steps.push({
    id: 'joinery',
    title: 'Cut the rabbets and grooves',
    summary: 'A rabbet for the case back, rabbets for each drawer’s front and back, and a groove for every drawer bottom.',
    instructions: [
      `Case sides: a ${f(config.backThickness)} wide, ${f(T / 2)} deep rabbet along the back inside edge of each side. Make a left and a right.`,
      `Box sides: a ${f(b)} wide, ${f(b / 2)} deep rabbet across the inside face at each end, for the box front and back.`,
      `All four box parts: a ${f(bottomGrooveWidth(config.bottomThickness))} groove (just wider than the ${f(config.bottomThickness)} bottom — test with an offcut), ${f(BOTTOM_GROOVE_DEPTH)} deep, ${f(BOTTOM_GROOVE_OFFSET)} up from the bottom edge, on the inside face. It runs the full length, through the rabbets on the sides.`,
      'Mark the inside face of every box part before you cut: the rabbets and the groove all go on that face, and the sides come out as mirror-image pairs.',
      'Dry-fit one box before cutting the rest.',
    ],
    parts: sized(partsWhere(['Side', 'Box side', 'Box front', 'Box back'])),
    tips: [
      'Cut the grooves on the table saw with the fence set once for every box part, so the bottoms all line up.',
      'Set the fence and blade height from the setup gauge (shop jigs): one step for each groove and rabbet size.',
    ],
    cautions: [],
    ...(detail
      ? {
        scene: detail.scenes.cut,
        highlightCaption: 'Rabbets and grooves',
        highlightSwatch: 'groove' as const,
      }
      : { scene: { view: 'exploded' as const, visible: [...caseNames, ...back], highlight: boxes }, highlightCaption: 'Parts to machine' }),
  });

  // 4b ── The box joints up close: set up on scrap and test before cutting the real parts
  if (detail) {
    steps.push({
      id: 'box-joints',
      title: 'Box joints up close',
      summary: `Every box corner is a rabbet: the side is cut ${f(b / 2)} into its inside face for ${f(b)} at each end, and the box front or back fills it.`,
      instructions: [
        `Rabbet: blade (or router bit) ${f(b / 2)} high, cutting ${f(b)} wide — exactly the thickness of the box stock, so the end of the front finishes flush with the outside of the side.`,
        `Groove: ${f(bottomGrooveWidth(config.bottomThickness))} wide, ${f(BOTTOM_GROOVE_DEPTH)} deep, its lower edge ${f(BOTTOM_GROOVE_OFFSET)} up from the bottom edge. Same fence setting for all four parts.`,
        'Cut both on scrap of the box plywood and fit them together: the front should press in by hand, flush on the outside and at the top, with the grooves lined up.',
        'Adjust and re-test until the scrap corner is right, then cut the real parts.',
      ],
      parts: [],
      tips: ['Keep the scrap corner: it’s a set-up gauge for the next batch of boxes.'],
      cautions: ['Cut the rabbets with the part flat on the saw and the end against the fence or a stop — never trap a short offcut between blade and fence.'],
      scene: detail.scenes.corner,
      highlightCaption: 'The cuts',
      highlightSwatch: 'groove',
      details: [boxJointDetail(config, f)],
    });
  }

  // 5 ── Finger pulls
  if (pull) {
    const across = pullWidth(pull, boxed[0]?.front.width ?? 0);
    const R = pull.shape === 'arc' ? (pull.width ** 2 / 4 + pull.depth ** 2) / (2 * pull.depth) : 0;
    const notched = plan.drawers.filter(d => d.boxNotchDepth > 0);
    steps.push({
      id: 'pulls',
      title: pull.shape === 'handhole' ? 'Cut the hand holes' : 'Cut the finger pulls',
      summary: pull.shape === 'handhole'
        ? `A ${f(across)} × ${f(pull.depth)} hand hole centred ${f(HANDHOLE_TOP)} below the top edge of every front.`
        : `A ${f(across)} × ${f(pull.depth)} ${pull.shape === 'arc' ? 'arc' : 'slot'} centred on the top edge of every front.`,
      instructions: [
        pull.shape === 'arc'
          ? `Lay out the arc: mark the centre of the top edge, ${f(pull.width / 2)} each side of it, and ${f(pull.depth)} down. That’s a circle of ${f(R)} radius.`
          : pull.shape === 'alex'
            ? `Lay out the ALEX notch: mark the centre of the top edge and ${f(pull.width / 2)} each side of it. The bottom is flat, ${f(pull.depth)} down, across the middle ${f(pull.width * (1 - ALEX_TAPER))}, then curves smoothly up to meet the top edge at each end — trace the finger-pull template rather than drawing the curves by hand.`
          : pull.shape === 'handhole'
            ? `Lay out the hole: ${f(across)} wide and ${f(pull.depth)} tall with round ends, its top ${f(HANDHOLE_TOP)} below the top edge.`
            : `Lay out the slot: ${f(across)} wide, ${f(pull.depth)} deep, with rounded inside corners.`,
        'Use the finger-pull template from the shop jigs: hook its fence over the front’s top edge, line its ends up with the front’s, and rout with a pattern bit so every front is identical.',
        notched.length
          ? `Notch the box fronts the same way, ${f(BOX_NOTCH_EXTRA / 2)} wider each side and ${f(FINGER_ROOM)} deeper than the pull, so your fingers reach behind the front.`
          : 'The box fronts sit low enough that they don’t need a notch.',
        'Round over the notch edges lightly and sand them smooth — this is the part you touch every day.',
      ],
      parts: sized(partsWhere(['Drawer front', 'Box front'])),
      tips: ['A 1/8″ round-over on the outside edge of the notch makes it far nicer to grab.'],
      cautions: ['Rout the curve with the bit cutting downhill on the grain to avoid tear-out at the ends.'],
      scene: { view: 'front', visible: [...caseNames, ...back, ...slides, ...boxes], highlight: fronts },
      highlightCaption: 'Fronts with the finger pull',
    });
  }

  // 6 ── T-nuts (feet), before the case goes together
  if (config.base === 'feet') {
    const spots = supportPositions(plan, config).map(([x, z]) => `${f(x - T + FOOT_SIZE / 2)} from the left end, ${f(z + FOOT_SIZE / 2)} from the front`);
    steps.push({
      id: 'tnuts',
      title: 'Fit the T-nuts for the leveling feet',
      summary: `${plan.supports} T-nuts in the bottom panel, before it goes into the case.`,
      instructions: [
        `Drill a ${f(TNUT_HOLE)} hole straight through the bottom at each spot: ${spots.join('; ')}.`,
        'Tap each T-nut in from the top face until its prongs bite flush, then thread a foot in from below to check.',
      ],
      parts: sized(partsWhere(['Bottom'])),
      tips: ['The T-nut drilling template (shop jigs) hooks on a corner of the bottom and flips for each corner; a drill press keeps the holes square.'],
      cautions: T < 0.6 ? [`Glue a ${f(3 / 4)} block under the bottom at each foot first — ${f(T)} is thin for a T-nut.`] : [],
      scene: { view: 'exploded', visible: [], highlight: ['Bottom'] },
    });
  }

  // 6b ── Shelf-pin holes behind doors, before the case goes together
  const pinned = doorSlots.filter(d => d.door!.pinYs.length);
  if (pinned.length) {
    steps.push({
      id: 'door-pins',
      title: 'Drill the shelf-pin holes',
      summary: `${f(PIN_HOLE)} holes, ${f(PIN_DEPTH)} deep, every ${f(PIN_SPACING)}, behind ${pinned.length === 1 ? 'the door' : `${pinned.length} doors`}.`,
      instructions: [
        ...pinned.map(d => `${d.label}: two columns (${f(plan.frontInset + PIN_INSET)} from the front edge and ${f(PIN_INSET)} from the back of the opening) on both sides of its opening, from ${f(d.door!.pinYs[0] - plan.sideBottom)} to ${f(d.door!.pinYs[d.door!.pinYs.length - 1] - plan.sideBottom)} up from the side’s bottom edge${plan.partitionXs.length ? ` (${f(panelTop(plan, T))} less on a partition)` : ''}.`),
        `Set a stop collar at ${f(PIN_DEPTH)} so no hole breaks through; on a partition drilled from both faces, shift one face’s holes half a step.`,
      ],
      parts: [],
      tips: ['A pegboard offcut or a shelf-pin jig keeps every row in line; the CNC files mark every hole.'],
      cautions: [],
      scene: { view: 'exploded', visible: [], highlight: ['Left side', 'Right side', ...partitionNames] },
      minutes: 20 * pinned.length,
    });
  }

  // 7 ── Case
  steps.push({
    id: 'case',
    title: 'Assemble the case',
    summary: 'Glue and screw the top and bottom between the sides, front edges flush.',
    instructions: [
      plan.base?.kind === 'kick'
        ? `Lay a side inside face up; stand the top on it at the top end and the bottom ${f(plan.baseHeight)} up from the bottom end (just above the notch), both flush at the front and set back from the rabbet.`
        : 'Lay a side inside face up; stand the top and bottom on it, flush at the front and set back from the rabbet.',
      'Glue, then drive four screws through the side into each panel. Repeat with the other side.',
      ...(cubbies.some(d => d.shelfY !== null) ? [
        `Fix the cubby shelves: ${cubbies.filter(d => d.shelfY !== null).map(d => `${d.label.toLowerCase()}’s, its top ${f(d.shelfY! + T - plan.sideBottom)} up from the bottom edge of the side`).join('; ')}. Glue and screw through the sides into their ends.`,
      ] : []),
      ...(plan.partitionXs.length ? [
        `Stand the partition${plan.partitionXs.length > 1 ? 's' : ''} between the top and bottom at ${plan.partitionXs.map(x => f(x - T)).join(' and ')} from the inside of the left side, front edges flush; glue and screw through the top and bottom into each.`,
      ] : []),
      ...(plan.base?.kind === 'kick' ? [
        `Under the bottom, glue and screw the toe kick between the sides ${f(plan.base.setback)} back from the front edge (its face lines up with the back of the notches), and the kick nailer at the back.`,
      ] : []),
      'Measure both diagonals across the front; they must match before the glue sets.',
    ],
    parts: sized(partsWhere(['Side', 'Top', 'Bottom', 'Partition', 'Toe kick', 'Kick nailer'])),
    tips: [
      'Clamp a clamping square (shop jigs) inside each corner to hold it at 90° while you screw.',
      ...(plan.partitionXs.length ? ['Stand the partition spacers between the side and each partition so every opening is its exact width.'] : []),
    ],
    cautions: [],
    scene: { view: 'front', visible: [], highlight: caseNames },
  });

  // 8 ── Back
  steps.push({
    id: 'back',
    title: 'Fit the back',
    summary: 'The back squares the case, so it goes on before the slides.',
    instructions: [
      'Lay the case face down. Check the diagonals once more.',
      'Glue the rabbets and the back edges of the top and bottom, drop the back in, and brad it every 6″.',
    ],
    parts: sized(partsWhere(['Back'])),
    tips: [],
    cautions: [],
    scene: { view: 'back', visible: caseNames, highlight: back },
  });

  // 8b ── Plinth: built, levelled in place, and the case set on it
  if (plan.base && plan.base.kind !== 'kick') {
    const bp = plan.base;
    const stretchers = bp.plinthXs.length - 2;
    steps.push({
      id: 'plinth',
      title: bp.kind === 'flush' ? 'Build the base and set the case on it' : 'Build the toe-kick plinth and set the case on it',
      summary: `A ${f(bp.height)} tall plywood frame${bp.setback > 0 ? `, its front ${f(bp.setback)} back from the case front` : ', flush with the case all round'}.`,
      instructions: [
        `Glue and screw the front and back rails to the ends${stretchers > 0 ? ` and ${stretchers} stretcher${stretchers === 1 ? '' : 's'} (evenly spaced)` : ''}: two screws through the rail into each.`,
        'Check the diagonals match, then let it set.',
        'Put it where the unit will stand and level it both ways with shims under the rails; snap off the shims flush.',
        `Lift the case on${bp.setback > 0 ? `, front edge ${f(bp.setback)} ahead of the plinth front` : ', flush at the front and sides'}${bp.sideSetbacks.some(x => x > 0) ? ` and ${f(bp.setback)} past the plinth on the ${bp.sideSetbacks[0] > 0 && bp.sideSetbacks[1] > 0 ? 'exposed ends' : bp.sideSetbacks[0] > 0 ? 'left' : 'right'}` : ''}. Screw down through the bottom into the rails, two per rail.`,
      ],
      parts: sized(partsWhere(['Plinth'])),
      tips: ['Level the plinth, not the cabinet: once it’s true the case sits square and the drawers run straight.'],
      cautions: ['Use screws shorter than the bottom plus the rail so they don’t come through.'],
      scene: { view: 'front', visible: [...caseNames, ...back], highlight: plinthNames },
    });
  }

  // 9 ── Casters, once the case is rigid
  if (config.base === 'casters') {
    steps.push({
      id: 'casters',
      title: 'Mount the casters',
      summary: `${plan.supports} plate casters under the bottom, ${f(1.5)} in from the edges.`,
      instructions: [
        'With the case on its back, place each caster plate square to the corner and mark the screw holes.',
        'Pre-drill and screw them on. Put the locking casters at the front.',
      ],
      parts: [],
      tips: [],
      cautions: [`Use screws shorter than ${f(T)} so they don’t come through the bottom.`],
      scene: { view: 'front', visible: [...caseNames, ...back], highlight: supports },
    });
  }

  // 10 ── Slides in the case
  steps.push({
    id: 'slides',
    title: 'Mount the slides in the case',
    summary: `${slideCounts(plan, f)}, ${plan.frontInset > 0 ? `front ends ${f(plan.frontInset)} back from the case front (room for the inset fronts)` : 'front ends flush with the front edge of the case'}.`,
    instructions: [
      'Pull each slide apart: extend it fully and press the release lever to take off the drawer member.',
      `Mark the bottom edge of each slide on both sides of its opening, measured up from the bottom edge of the case side: ${boxed.map(d => `${d.label.toLowerCase()} at ${f(d.slideMark)}`).join(', ')}${plan.partitionXs.length ? ` (on a partition, ${f(panelTop(plan, T))} less — it starts on the bottom panel)` : ''}. The slide story stick from the shop jigs gives the same marks without measuring.`,
      plan.frontInset > 0
        ? `Screw each cabinet member on with its bottom on the line and its front end ${f(plan.frontInset)} back from the case front — the slide setback block sets this.`
        : 'Screw each cabinet member on with its bottom on the line and its front end flush with the case front.',
    ],
    parts: [],
    tips: [
      'Faster still: the slide spacer blocks (shop jigs). Stand one on the bottom panel, rest the slide on it, screw, then stack the next block on that slide and repeat.',
      'Clamp the slide front stop across the front edge so every slide butts against it and ends up flush.',
      'The CNC files draw these lines on the sides as guides if you cut the case on a CNC.',
    ],
    cautions: [`Slides need exactly ${f(SLIDE_CLEARANCE)} each side; a box that’s too wide binds, too narrow and the slides won’t engage.`],
    scene: { view: 'front', visible: [...caseNames, ...back, ...supports], highlight: slides },
  });

  // 11 ── Boxes: the first one step by step, up close, then the rest the same way
  const total = n * plan.unitCount;
  const widths = [...new Set(boxed.map(d => f(d.box.width)))].join(' or ');
  if (detail) {
    const d = detail.drawer;
    const same = detail.sameAs.length === boxed.length ? 'every drawer' : detail.sameAs.join(', ');
    const notch = d.boxNotchDepth > 0 ? ' — the notched one goes at the front' : '';
    steps.push({
      id: 'box-glue',
      title: 'First box: front and back into a side',
      summary: `Shown up close: the ${f(d.box.width)} × ${f(d.box.height)} × ${f(d.box.depth)} box (${same}). Lay the left side inside face up.`,
      instructions: [
        `Glue the rabbets and the ends of the box front and back${notch}.`,
        'Stand the front and back in the side’s rabbets, grooves facing in and lined up with the side’s groove, top edges flush.',
        `Brad through the side into each end (three per corner), ${f(b / 2)} in from the end so the nails land in the middle of the front and back.`,
      ],
      parts: [],
      tips: ['Glue only the rabbets and the end grain — keep it out of the grooves or the bottom won’t slide in.'],
      cautions: [],
      scene: detail.scenes.glue,
      minutes: 8,
    });
    steps.push({
      id: 'box-bottom',
      title: 'First box: slide in the bottom',
      summary: 'The bottom slides in from the open side, riding in the grooves of the front, back and side.',
      instructions: [
        'Run a thin bead of glue in the grooves.',
        `Slide the bottom in until it bottoms out in the side’s groove. It’s ${f(1 / 32)} short of the groove floor each way, so it won’t hold the box open.`,
        'Check the box sits flat on the bench and the bottom is free of the groove at its open edge.',
      ],
      parts: [],
      tips: ['A square-cut bottom pulls the box square on its own; if it binds, the box is out of square, not the bottom too big.'],
      cautions: [],
      scene: detail.scenes.bottom,
      minutes: 4,
    });
    steps.push({
      id: 'box-close',
      title: 'First box: close it with the second side',
      summary: `Glue the right side on and square the box. It must measure exactly ${f(d.box.width)} across.`,
      instructions: [
        'Glue the right side’s rabbets and press it on over the front, back and bottom.',
        'Brad the two corners, three per corner.',
        'Measure both diagonals across the top; nudge the box until they match, then let it set.',
        `Check the width across the outside of the sides: ${f(d.box.width)} — its opening less ${f(SLIDE_CLEARANCE * 2)} for the slides.`,
      ],
      parts: [],
      tips: ['Glue it up around the box squaring frame (shop jigs): it can only close square and at its exact size.'],
      cautions: [],
      scene: detail.scenes.close,
      minutes: 8,
    });
  }
  steps.push({
    id: 'boxes',
    title: total > 1 ? 'Build the other drawer boxes' : 'Build the drawer box',
    summary: `${total} box${total === 1 ? '' : 'es'} in all, ${widths} wide and ${[...new Set(boxed.map(d => f(d.box.depth)))].join(' or ')} deep, every one built like the first.`,
    instructions: [
      ...(detail ? [] : ['Glue the front and back into the side rabbets, slide the bottom into its groove, then add the second side.', 'Brad each corner through the side (three per corner).']),
      'Check both diagonals across the top; nudge until they match, then let it set.',
      `Each box must measure ${widths} across — exactly its opening less ${f(SLIDE_CLEARANCE * 2)}.`,
      'Label each box with its drawer number inside the back as it comes off the frame.',
    ],
    parts: sized(partsWhere(['Box'])),
    tips: [
      'Glue each box up around its squaring frame (shop jigs): it can only close square and at its exact size.',
      'Glue the bottom in all round: a plywood bottom doesn’t move, and it makes the box much stiffer.',
    ],
    cautions: [],
    scene: { view: 'exploded', visible: [...caseNames, ...back, ...slides], highlight: boxes },
  });

  // 12 ── Box members and drawers in
  steps.push({
    id: 'drawers',
    title: 'Attach the drawer members and fit the drawers',
    summary: 'The other half of each slide goes on the box, then the boxes go in.',
    instructions: [
      ...boxed.map(d => `${d.label}: slide member’s bottom edge ${f(d.slideY - d.box.y)} up from the bottom of the box, front end flush with the box front.`),
      'Line the box members up with the case members and push each drawer in until it soft-closes.',
    ],
    parts: [],
    tips: [
      'Rest each member on the box slide block (shop jigs) with the box standing on the bench: no marking needed.',
      'Use the slide’s horizontal (slotted) screw holes first, so you can adjust in and out before adding the round-hole screws.',
    ],
    cautions: [],
    scene: { view: 'front', visible: [...caseNames, ...back, ...supports, ...slides], highlight: boxes },
  });

  // 12a ── Pull-out trays behind doors
  const withTrays = doorSlots.filter(d => d.door!.trays.length);
  if (withTrays.length) {
    const count = withTrays.reduce((a, d) => a + d.door!.trays.length, 0);
    const t = withTrays[0].door!.trays[0];
    steps.push({
      id: 'trays',
      title: 'Build and fit the pull-out trays',
      summary: `${count} tray${count === 1 ? '' : 's'}, ${f(t.width)} wide and ${f(t.height)} tall, on ${f(t.depth)} slides — built like the drawer boxes.`,
      instructions: [
        `Screw a spacer panel to each side of the opening behind the door${withTrays.length === 1 ? '' : 's'}: it holds the slides ${f(T)} in from the side, so the trays clear the hinges and the open door.`,
        `Build each tray like a drawer box: rabbets at the ends of the sides, the bottom in its groove ${f(BOTTOM_GROOVE_OFFSET)} up.`,
        ...withTrays.flatMap(d => d.door!.trays.map((tr, k) => `${d.label}, tray ${k + 1}: cabinet member’s bottom edge ${f(tr.slideY - d.door!.zoneBottom)} above the floor of the space behind the door.`)),
        'Fit the drawer members to the trays, flush with the tray front, and slide them in.',
      ],
      parts: sized(partsWhere(['Tray'])),
      tips: ['Mark the slide heights on a stick held against the spacer panel — it’s quicker than measuring each one.'],
      cautions: ['Open the door fully before pulling a tray out — on concealed hinges the door edge swings into the opening a little.'],
      scene: { view: 'front', visible: [...caseNames, ...back, ...supports], highlight: trayNames },
      minutes: 30 * count,
    });
  }

  // 12b ── Inserts
  const insertParts = plan.parts.filter(p => p.name.startsWith('Lengthwise') || p.name.startsWith('Crosswise') || p.name.startsWith('Marker rib') || p.name.startsWith('Tool board'));
  const toolBoards = plan.inserts.filter(x => x?.toolBoard && !x.error).length;
  const gridfinity = plan.inserts.map((x, i) => (x?.gridfinity && !x.error ? { drawer: plan.drawers[i].label, gf: x.gridfinity } : null)).filter(Boolean) as { drawer: string; gf: NonNullable<InsertLayout['gridfinity']> }[];
  if (insertParts.length || gridfinity.length) {
    const grids = plan.inserts.some(x => x?.cells && !x.gridfinity);
    const trays = plan.inserts.filter(x => x?.capacity).reduce((n, x) => n + (x?.capacity ?? 0), 0);
    steps.push({
      id: 'inserts',
      title: 'Fit the dividers and marker trays',
      summary: [grids ? 'Egg-crate divider grids' : '', trays ? `marker trays holding ${trays} markers per unit` : '', gridfinity.length ? 'Gridfinity baseplates' : '', toolBoards ? 'tool shadow boards' : ''].filter(Boolean).join(', ') + '.',
      instructions: [
        ...(grids ? [
          'Cut the lap slots: lengthwise dividers are slotted from the top, crosswise ones from the bottom, each half the divider’s height.',
          'Slide the grid together on the bench, check it drops into its drawer, then glue it only if it rattles.',
        ] : []),
        ...(trays ? [
          'Cut the half-round notches (the CNC rib files have them), sand them smooth so the markers don’t snag.',
          'Glue the ribs to the drawer bottom in pairs, a marker’s length apart, notches lined up — lay a row of markers in while the glue sets.',
        ] : []),
        ...(toolBoards ? [
          'Shadow boards: rout each tool pocket and finger hole to depth (the CNC file has them as pockets), ease the edges, then lay each tool in to check before finishing.',
          'Flock or paint the pockets a contrasting colour so an empty one stands out.',
        ] : []),
        ...gridfinity.map(({ drawer, gf }) =>
          `${drawer}: print the ${gf.columns} × ${gf.rows} baseplate (${gf.tiles.map(t => `${t.count} × ${t.columns}×${t.rows}`).join(' + ')} tiles) and drop it in, centred — about ${Math.round(gf.marginX)} mm spare each side and ${Math.round(gf.marginY)} mm front and back. Bins up to ${gf.maxUnitsWithLip}u with a stacking lip fit under the drawer above.`),
      ],
      parts: sized(insertParts),
      tips: ['Mark a whole set of dividers at once with its slot strip (shop jigs), or use the strip as an indexing fence on a sled.'],
      cautions: [],
      // From above, without the case, so you can see into the boxes.
      scene: { view: 'above', visible: boxes, highlight: insertNames },
    });
  }

  // 12c ── Shaker fronts and pull holes
  const profile = config.frontProfile;
  const shaker = profile?.style === 'shaker';
  const hw = config.hardware && config.hardware.kind !== 'none' ? config.hardware : null;
  if (shaker || hw) {
    const kindWord = hw?.kind === 'knob' ? 'knob' : 'pull';
    steps.push({
      id: 'front-details',
      title: shaker && hw ? 'Shape the Shaker fronts and drill the pull holes' : shaker ? 'Shape the Shaker fronts' : `Drill the ${kindWord} holes`,
      summary: [
        shaker ? (profile!.method === 'pocket'
          ? `A ${f(profile!.rail)} frame around a panel pocketed ${f(profile!.depth)} deep (narrower on small fronts).`
          : `${f(profile!.depth)} strips, ${f(profile!.rail)} wide, glued onto each slab front and door.`) : '',
        hw ? `${hw.kind === 'knob' ? 'One hole' : `Two holes ${f(hw.spacing)} apart`} per ${kindWord}, ${f(PULL_HOLE)} through.` : '',
      ].filter(Boolean).join(' '),
      instructions: [
        ...(shaker && profile!.method === 'pocket' ? [
          `Pocket the panel ${f(profile!.depth)} deep with a flat-bottomed bit, leaving the ${f(profile!.rail)} frame (the CNC files have every pocket); square the corners with a chisel if you want a crisp Shaker look.`,
        ] : []),
        ...(shaker && profile!.method === 'applied' ? [
          'Glue the stiles on first, flush with the edges, then fit the rails tight between them.',
          'Pin them with 23-gauge pins while the glue sets, then sand the outer edges flush.',
        ] : []),
        ...(hw ? [
          hw.kind === 'knob'
            ? 'Drawers: a knob centred across, in the middle of short fronts and 3″ from the top of tall ones (the top rail’s centre on Shaker fronts); two on fronts over 30″.'
            : `Drawers: the pull centred across at the same height; two on fronts over 30″. Doors: upright, near the opening edge, its top 3″ from the door’s top.`,
          'Drill with the pull drilling jig so every pull lands in the same place, and back the hole with scrap so the face doesn’t splinter.',
          'Once the fronts are hung, drill on through the box fronts from inside the drawer, through the same holes.',
        ] : []),
      ],
      parts: sized(partsWhere(['Shaker'])),
      tips: shaker ? ['Prime the panel pocket or the strip joints before painting so the end grain doesn’t telegraph through.'] : [],
      cautions: [],
      scene: { view: 'front', visible: [...caseNames, ...back, ...supports, ...slides, ...boxes], highlight: [...fronts, ...doorLeaves] },
      minutes: (shaker ? 10 : 0) * (n + doorSlots.length) + (hw ? 5 : 0) * (n + doorSlots.length),
    });
  }

  // 13 ── Fronts
  steps.push({
    id: 'fronts',
    title: 'Hang the fronts',
    summary: `${f(config.gap)} gaps between fronts, ${f(config.gap / 2)} at the top, bottom and sides.`,
    instructions: [
      plan.frontInset > 0
        ? `Start at the bottom: set the front into its opening on ${f(config.gap / 2)} shims, with ${f(config.gap / 2)} at each side, its face flush with the case edges, and stick it to the box with two pieces of double-sided tape.`
        : `Start at the bottom: stand the front on ${f(config.gap / 2)} shims, centred side to side, and stick it to the box with two pieces of double-sided tape.`,
      `Pull the drawer out and drive four ${f(Math.floor((b + T * 0.6) * 8) / 8)} screws through the box front into the front.`,
      `Work upward with ${f(config.gap)} spacers between fronts.`,
      'Drill the box-front holes oversize, so each front can shift slightly before you snug the screws.',
    ],
    parts: sized(partsWhere(['Drawer front'])),
    tips: [
      'Hang the front reveal gauges (shop jigs) on the front below and set the next front on their tongues — the gap is automatic.',
      'Drill the box fronts with the front screw template before the fronts go on, so every screw lands in the same place.',
    ],
    cautions: [],
    scene: { view: 'front', visible: [...caseNames, ...back, ...supports, ...slides, ...boxes], highlight: fronts },
  });

  // 13a ── Doors on concealed hinges
  if (doorSlots.length) {
    const leaves = doorSlots.reduce((a, d) => a + d.door!.leaves.length, 0);
    const types = [...new Set(doorSlots.flatMap(d => d.door!.leaves.map(l => l.hingeType)))];
    steps.push({
      id: 'doors',
      title: `Hang the door${leaves === 1 ? '' : 's'}`,
      summary: `${leaves} door${leaves === 1 ? '' : 's'} on 35 mm concealed hinges (${types.join(', ')}), with the same ${f(config.gap)} gaps as the drawer fronts.`,
      instructions: [
        `Bore the hinge cups in the back of each door with the hinge cup jig: 35 mm, ${f(1 / 2)} deep, centred ${f(HINGE_CUP_INSET)} from the hinge edge and ${f(3)} from the top and bottom (and one in the middle of doors over ${f(40)}).`,
        `Screw the mounting plates to the cabinet at the same heights, their centres ${f(plan.frontInset + HINGE_PLATE_SETBACK)} back from the front edge (the CNC files mark them).`,
        'Press the hinges into the cups, screw them down square to the edge, and clip the doors onto the plates.',
        `Use the hinges’ three adjustment screws to even the gaps to ${f(config.gap)} and bring each door flush${plan.frontInset > 0 ? ' with the case' : ''}.`,
        ...doorSlots.filter(d => d.door!.shelfYs.length).map(d => `${d.label}: set ${d.door!.shelfYs.length} shelf${d.door!.shelfYs.length === 1 ? '' : 'ves'} on pins where you want them.`),
      ],
      parts: sized(partsWhere(['Door'])),
      tips: ['Hang the doors before the finish goes on, then take them off to paint — the holes are already right.'],
      cautions: ['Bore the cups with a Forstner bit and a depth stop: a cup that breaks through ruins the door face.'],
      scene: { view: 'front', visible: everything.filter(n => !doorLeaves.includes(n)), highlight: doorLeaves },
      minutes: 25 * leaves,
    });
  }

  // 13a ── Bookcase: built on the bench, then the countertop, the bookcase on it, its trim and light
  if (bk && bench) {
    const isBookcase = (name: string) => name.startsWith('Bookcase ') || name === 'Countertop' || name.startsWith('Crown molding');
    const cabinet = everything.filter(name => !isBookcase(name));
    const placed = names(name => name.startsWith('Bookcase ') && !/ (door \d+|top cap|crown nailer(, side)?)$/.test(name));
    const keep = new Set(['dados', 'pins', 'banding', 'case', 'dividers', 'shelves', 'back']);
    const open = bk.config.openBelow > 0;
    const benchNames = new Set(benchSolids.map(x => x.name));
    const drawn = (list: string[]) => list.map(benchName).filter(name => benchNames.has(name));
    for (const step of bench.steps.filter(x => keep.has(x.id))) {
      // With open space below, the shelf model's toe kick is only the valance (or nothing).
      const instructions = open
        ? step.instructions.flatMap(line => (!line.startsWith('Fit the toe kick') ? [line]
          : bk.config.taskLight ? [`Fit the light valance between the sides under the bottom panel, flush at the front, ${f(bk.config.valanceHeight)} tall.`] : []))
        : step.instructions;
      steps.push({
        ...step,
        id: `bookcase-${step.id}`,
        title: `Bookcase: ${step.title.charAt(0).toLowerCase()}${step.title.slice(1)}`,
        instructions: step.id === 'case' && open
          ? [...instructions, `The sides run ${f(bk.config.openBelow)} below the bottom panel to the counter — that’s the open space. Keep the case square while the glue sets: tack a temporary brace across the bottom ends.`]
          : step.id === 'back' && open
            ? [...instructions, `The back runs the full ${f(bk.config.height)}, down past the bottom panel to the bottom ends of the sides — a backsplash behind the open space. Take the temporary brace off once it’s on.`]
            : instructions,
        parts: step.parts.filter(p => !(open && p.name === 'Toe kick' && !bk.config.taskLight)).map(p => ({ ...p, name: bookcaseName(p.name) })),
        scene: step.scene && { ...step.scene, visible: drawn(step.scene.visible), highlight: drawn(step.scene.highlight) },
        ...(step.id === 'dados' ? { highlightCaption: 'Dados to cut', highlightSwatch: 'groove' as const } : {}),
        ...(step.id === 'pins' ? { highlightCaption: 'Pin holes', highlightSwatch: 'groove' as const } : {}),
      });
    }
    const ct = bk.countertop;
    if (ct && !plan.run) {
      const butcher = ct.material === 'butcher';
      steps.push({
        id: 'countertop',
        title: 'Fit the countertop',
        summary: `${f(ct.x1 - ct.x0)} × ${f(ct.z1 - ct.z0)}, overhanging the fronts by ${f(bk.config.countertop.overhangFront)}${ct.x0 < 0 || ct.x1 > plan.overallWidth ? ` and the ends that show by ${f(bk.config.countertop.overhangSides)}` : ''}; its back flush with the cabinet’s.`,
        instructions: [
          ...(butcher
            ? ['Cut the butcher block to size, ease the edges, and seal both faces so it moves evenly.',
              'Chisel shallow recesses in the top edges of the case sides and screw in figure-8 fasteners, about every 12″.',
              'Set the top on, flush at the back, and screw up through the fasteners — they let the wood move.']
            : [
              ...(ct.layers === 2 ? ['Glue the two layers face to face and screw them together from the underside every 8″, then flush the edges.'] : []),
              'Band the front edge and any end that shows.',
              'Set it on the case, flush at the back, and screw up through the case top from inside (take the top drawer out), one every 6–8″.',
            ]),
          ...(bk.grommet ? [`Bore the ${f(bk.grommet.diameter)} cord grommet hole ${f(bk.grommet.x - ct.x0)} from the left end and ${f(bk.grommet.z - ct.z0)} back from the front edge.`] : []),
        ],
        parts: sized(partsWhere(['Countertop'])),
        tips: [butcher ? 'Seal the underside as well as the top, or the top cups.' : 'Pre-drill and countersink up through the case top so the screws pull the countertop down tight.'],
        cautions: [`Screws must be shorter than ${f(T)} plus the countertop, less ${f(1 / 4)}, so they never come through.`],
        scene: { view: 'front', visible: cabinet, highlight: ['Countertop'] },
        minutes: 40,
      });
    }
    const doorNames = names(name => /^Bookcase door \d+$/.test(name));
    if (!plan.run) steps.push({
      id: 'bookcase-set',
      title: 'Set the bookcase on',
      summary: `On the ${ct ? 'countertop' : 'case top'}, its back flush with the cabinet’s, ${f(bk.y0)} up from the floor.`,
      instructions: [
        `With a helper, stand the bookcase on the ${ct ? 'countertop' : 'case'} and slide it back until its back lines up with the cabinet’s back and its sides with the cabinet’s sides.`,
        `Screw down through the bookcase bottom into the ${ct ? 'countertop' : 'case top'}: two near each end and one per bay.`,
        'Screw an anti-tip strap from the bookcase top (or the back) into a wall stud.',
      ],
      parts: [],
      tips: ['Shim under the cabinet, not between the bookcase and the counter, if the floor makes it lean.'],
      cautions: ['A bookcase on a cabinet is top-heavy: anchor it to the wall before loading the shelves.'],
      scene: { view: 'front', visible: cabinet.concat(ct ? ['Countertop'] : []), highlight: placed },
      minutes: 30,
    });
    const benchDoors = bench.steps.find(x => x.id === 'doors');
    if (benchDoors && doorNames.length) {
      steps.push({
        ...benchDoors,
        id: 'bookcase-doors',
        title: `Bookcase: ${benchDoors.title.charAt(0).toLowerCase()}${benchDoors.title.slice(1)}`,
        parts: benchDoors.parts.map(p => ({ ...p, name: bookcaseName(p.name) })),
        scene: { view: 'front', visible: cabinet.concat(ct ? ['Countertop'] : [], placed), highlight: doorNames },
        minutes: 15 * doorNames.length,
      });
    }
    const trim = names(name => / (top cap|crown nailer|crown nailer, side)$/.test(name) || name.startsWith('Crown molding'));
    if ((bk.cap || bk.crown) && !plan.run) {
      steps.push({
        id: 'bookcase-top',
        title: bk.cap ? 'Fit the top cap' : 'Fit the crown molding',
        summary: bk.cap
          ? `A plywood cap overhanging the front${bk.cap.x0 < 0 || bk.cap.x1 > plan.overallWidth ? ' and the ends that show' : ''} by ${f(bk.config.top.capProjection)}.`
          : `${f(bk.crown!.height)} crown standing ${f(bk.crown!.projection)} out from the face, on a plywood nailer.`,
        instructions: bk.cap
          ? ['Band the front edge and any end that shows.', 'Set it on the bookcase, flush at the back, and screw up through the bookcase top from inside, every 8″.']
          : [
            'Screw the nailer strips to the bookcase top, flush with its front and the sides that show.',
            'Cut the front crown first — upside down and backwards in the mitre saw, against a stop — then mitre the returns to meet it and cut them square at the wall.',
            'Glue the mitres and nail the crown to the nailer and the case.',
          ],
        parts: sized(partsWhere(['Bookcase top cap', 'Bookcase crown nailer', 'Crown molding'])),
        tips: bk.crown ? ['Cut a short test piece and hold it in place to check the spring angle before cutting the real corners.'] : [],
        cautions: [],
        scene: { view: 'front', visible: everything.filter(name => !trim.includes(name)), highlight: trim },
        minutes: bk.cap ? 30 : 60,
      });
    }
    if (bk.config.taskLight) {
      const valance = names(name => name === 'Bookcase light valance');
      steps.push({
        id: 'light',
        title: 'Wire the task light',
        summary: 'An LED strip under the bookcase bottom, hidden by the valance, lights the counter.',
        instructions: [
          'Stick the LED strip to the underside of the bookcase bottom, just behind the valance, so it shines down and back.',
          bk.grommet ? 'Run the cord along the back corner and down through the grommet in the countertop, then fit the grommet cap.' : 'Run the cord along the back corner to the outlet.',
          'Clip the cord every 8″ so it stays out of sight.',
        ],
        parts: [],
        tips: ['A strip with a diffuser channel gives an even line of light with no dots.'],
        cautions: ['Use a plug-in, low-voltage strip; anything hard-wired needs an electrician.'],
        scene: { view: 'front', visible: everything.filter(name => !valance.includes(name)), highlight: valance },
        minutes: 30,
      });
    }
  }

  // 13b ── Desk top
  if (plan.desk) {
    const dk = plan.desk;
    const layers = config.desk?.topLayers ?? 1;
    steps.push({
      id: 'desk',
      title: 'Put the desk top on',
      summary: `${f(dk.width)} × ${f(dk.depth)}, ${f(dk.topThickness)} thick, ${f(dk.knee)} of knee space.`,
      instructions: [
        ...(layers === 2 ? ['Glue the two top layers face to face and screw them together every 8″ from underneath; let it set flat.'] : []),
        `Stand the unit${plan.unitCount === 2 ? 's' : ''} in place${plan.unitCount === 2 ? ` with their outside faces at the desk ends, ${f(dk.knee)} apart` : ''}, backs in line.`,
        'Lay the top on with its back edge flush with the units’ backs, then screw up through each unit’s top panel — 8 screws per unit, short enough not to come through.',
      ],
      parts: sized(plan.parts.filter(p => p.name === 'Desk top')),
      tips: [`The top overhangs the drawer fronts by ${f(dk.depth - plan.overallDepth)} — enough to keep knees off the pulls.`],
      cautions: [],
      scene: { view: 'front', visible: desk.filter(s => s.name !== 'Desk top').map(s => s.name), highlight: ['Desk top'] },
    });
  }

  // 13c ── Hanging it
  if (plan.mount === 'wall') {
    steps.push({
      id: 'install',
      title: 'Hang it on the French cleat',
      summary: `The wall cleat goes into the studs; the unit’s cleat hooks over it, ${f(plan.lift)} off the floor.`,
      instructions: [
        `Find the studs and mark a level line ${f(plan.lift + plan.overallHeight - config.thickness)} up the wall — the top edge of the cabinet cleat.`,
        `Screw the wall cleat into every stud it crosses, bevel up and facing the wall, its top edge ${f(config.cleatHeight ?? 3)} below that line.`,
        'Take the drawers out, lift the unit and lower it so its cleat drops onto the wall cleat. Then put the drawers back.',
      ],
      parts: sized(plan.parts.filter(p => /cleat|spacer/i.test(p.name))),
      tips: ['Screw the cabinet cleat to the back and up through the top before hanging — it carries everything.'],
      cautions: ['Loaded drawers are heavy: use 3″ structural screws into studs, never drywall anchors.'],
      scene: { view: 'back', visible: everything.filter(n => !/cleat|spacer/i.test(n)), highlight: names(n => /cleat|spacer/i.test(n)) },
    });
  } else if (plan.mount === 'under-desk') {
    steps.push({
      id: 'install',
      title: 'Hang it under the desk',
      summary: `Screwed up through its top into the desk, ${f(plan.lift)} off the floor.`,
      instructions: [
        'Take the drawers out. With a helper, hold the unit up under the desk where you want it (clamp a scrap across the desk front as a stop).',
        `Drive eight ${f(1.25)} screws up through the unit’s top into the desk, two near each corner — short enough not to come through the desk top.`,
        'Put the drawers back.',
      ],
      parts: [],
      tips: ['Pre-drill the top panel and countersink from inside the case.'],
      cautions: ['Check the desk top is solid wood or thick plywood; screws pull out of thin particleboard.'],
      scene: { view: 'front', visible: everything.filter(n => n !== 'Desk (existing)'), highlight: names(n => n === 'Desk (existing)') },
    });
  }

  // 13c ── The wall run: cabinets along the wall, fillers, desk ledgers, countertop, uppers and trim
  if (run) {
    const all = runAll.map(x => x.name);
    const cabinetsOnly = all.filter(n => n.startsWith('Cabinet ') && !/· Bookcase /.test(n));
    const fillerNames = all.filter(n => /^(Upper )?[Ff]iller /.test(n));
    const ledgerNames = all.filter(n => /^Desk \d+ · (ledger|left cleat|right cleat)$/.test(n));
    const upperNames = all.filter(n => /· Bookcase /.test(n) || (n.startsWith('Desk ') && !ledgerNames.includes(n)));
    const trimNames = all.filter(n => /^Run (top cap|crown)/.test(n));
    const lowerFillers = fillerNames.filter(n => !n.startsWith('Upper'));
    const desks = run.sections.filter(x => x.kind === 'desk');
    const place = run.sections.map(x => `${x.kind === 'cabinet' ? `cabinet ${x.number}${x.mirror ? ' (mirrored)' : ''}` : `a ${f(x.width)} desk gap`} at ${f(x.x)}`).join(', ');
    steps.push({
      id: 'run-cabinets',
      title: 'Set the cabinets along the wall',
      summary: `${run.cabinetCount} cabinet${run.cabinetCount === 1 ? '' : 's'} on a ${f(run.width)} wall, level and in line.`,
      instructions: [
        `Mark a level line on the wall at ${f(plan.overallHeight)} (the cabinet tops) and find the studs.`,
        `Mark the sections from the ${run.fillers.some(x => x.side === 'left') ? 'left wall' : 'left end'}: ${place}.`,
        'Set the first cabinet on its line, shim it level both ways under the base, and screw through the back into the studs.',
        'Bring each next one up to the line the same way; where two cabinets meet, clamp their faces flush and screw through one side into the other.',
      ],
      parts: [],
      tips: ['Work from the highest spot on the floor: shim the others up to it, never cut a cabinet down.'],
      cautions: ['Screw into studs, not drywall anchors — the drawers and the uppers hang their weight on these screws.'],
      scene: { view: 'front', visible: [], highlight: cabinetsOnly },
      minutes: 30 * run.cabinetCount,
    });
    if (run.fillers.length) {
      steps.push({
        id: 'run-fillers',
        title: 'Scribe the fillers to the walls',
        summary: `${run.fillers.length} filler${run.fillers.length === 1 ? '' : 's'}, ${f(run.fillers[0].width)} showing — cut ${f(run.fillers[0].width + 0.5)} and scribed.`,
        instructions: [
          'Glue each filler to its return at right angles, then hold it against the wall, flush with the cabinet face.',
          'Run a compass or a scribing tool down the wall to copy its wobble onto the filler, and cut or plane to the line.',
          'Screw through the cabinet side into the return; the filler closes the gap to the wall.',
        ],
        parts: sized(partsWhere(['Filler'])),
        tips: ['Back-bevel the scribed edge slightly so only its face edge touches the wall.'],
        cautions: [],
        scene: { view: 'front', visible: cabinetsOnly, highlight: lowerFillers },
        minutes: 30 * run.fillers.length,
      });
    }
    if (desks.length) {
      steps.push({
        id: 'run-desk',
        title: `Fit the desk ledger${desks.length === 1 ? '' : 's'}`,
        summary: 'A ledger into the studs at the back and a cleat on each cabinet side carry the countertop over the knee space.',
        instructions: [
          `Screw a ledger to the studs along the back of each desk gap, its top on the line at ${f(plan.overallHeight)}.`,
          'Screw a cleat to each cabinet side facing the gap, flush with the cabinet top.',
          ...desks.filter(x => x.width > 48).map(x => `Desk gap ${x.number} is ${f(x.width)} wide: glue a ${f(3 / 4)} × ${f(3)} stiffener on edge under the countertop’s front so it doesn’t sag.`),
        ],
        parts: sized(partsWhere(['Desk ledger', 'Desk side cleat'])),
        tips: [],
        cautions: [],
        scene: { view: 'front', visible: [...cabinetsOnly, ...lowerFillers], highlight: ledgerNames },
        minutes: 20 * desks.length,
      });
    }
    const ct = run.countertop;
    steps.push({
      id: 'run-countertop',
      title: 'Fit the countertop',
      summary: `${f(ct.x1 - ct.x0)} × ${f(ct.z1 - ct.z0)}${ct.pieces > 1 ? ` in ${ct.pieces} pieces` : ''}, across the whole run.`,
      instructions: [
        ...(ct.material === 'plywood'
          ? [
            ...(ct.pieces > 1 ? ['Make the joints land over a cabinet, and stagger them between the two layers.'] : []),
            ...(ct.layers === 2 ? ['Glue the layers together and screw them from underneath every 8″.'] : []),
            'Band the front edge and any open end.',
            'Screw up through the cabinet tops and down into the ledgers and cleats.',
          ]
          : [
            ...(ct.pieces > 1 ? ['Join the slabs with countertop bolts over a cabinet.'] : []),
            'Seal both faces, then fasten it down with figure-8 clips so it can move.',
          ]),
      ],
      parts: sized(partsWhere(['Run countertop'])),
      tips: ['Scribe the back edge to the wall if it isn’t flat, before banding the front.'],
      cautions: [],
      scene: { view: 'front', visible: [...cabinetsOnly, ...lowerFillers, ...ledgerNames], highlight: ['Run countertop'] },
      minutes: 45 + 15 * ct.pieces,
    });
    if (run.uppers) {
      steps.push({
        id: 'run-uppers',
        title: 'Set the uppers',
        summary: `A bookcase over each cabinet${run.sections.some(x => x.upper) ? ' and each desk gap' : ''}, butted together on the countertop, backs to the wall.`,
        instructions: [
          'Start at one end: stand the first upper on the countertop, back to the wall, and screw it into the studs through its back.',
          'Bring each next upper up against it, clamp the faces flush, and screw through one side into the other.',
          'Screw down through each upper’s bottom into the countertop.',
          ...(run.fillers.length ? ['Scribe and fit the upper fillers like the lower ones.'] : []),
        ],
        parts: sized(partsWhere(['Bookcase ', ...run.sections.filter(x => x.upper).map(x => `Desk ${x.number} upper `)])),
        tips: [],
        cautions: ['Anchor every upper to a stud before you load the shelves.'],
        scene: { view: 'front', visible: [...cabinetsOnly, ...lowerFillers, 'Run countertop'], highlight: [...upperNames, ...fillerNames.filter(n => n.startsWith('Upper'))] },
        minutes: 30 * (run.cabinetCount + run.sections.filter(x => x.upper).length),
      });
    }
    if (run.cap || run.crown) {
      steps.push({
        id: 'run-top',
        title: run.cap ? 'Fit the top cap' : 'Fit the crown across the run',
        summary: run.cap ? `One cap${run.cap.pieces > 1 ? ` in ${run.cap.pieces} pieces` : ''} across all the uppers.` : `${f(run.crown!.height)} crown across the whole wall${run.crown!.returns.length ? `, returning at the open end${run.crown!.returns.length > 1 ? 's' : ''}` : ''}.`,
        instructions: run.cap
          ? ['Join the pieces over an upper, then screw up through the uppers’ tops.']
          : [
            'Screw the nailer across the uppers’ tops, flush with their fronts.',
            'Cope or butt the crown into the walls; splice long lengths with a scarf joint over the nailer.',
            ...(run.crown!.returns.length ? ['Mitre the returns at the open ends.'] : []),
          ],
        parts: sized(partsWhere(['Run top cap', 'Run crown'])),
        tips: [],
        cautions: [],
        scene: { view: 'front', visible: all.filter(n => !trimNames.includes(n)), highlight: trimNames },
        minutes: run.cap ? 40 : 90,
      });
    }
  }

  // 13d ── Baseboard, once it's in place
  if (plan.base?.baseboard) {
    const bb = plan.base.baseboard;
    const wraps = bb.faces.filter(x => x !== 'front');
    steps.push({
      id: 'baseboard',
      title: 'Wrap the base in baseboard',
      summary: `${f(bb.height)} baseboard across the front${wraps.length ? ` and around ${wraps.length === 2 ? 'both ends' : `the ${wraps[0]} end`}` : ''}, once the unit is in its final place.`,
      instructions: [
        wraps.length
          ? 'Cut the front piece first, mitring the corners at 45° so its long points line up with the outside of the case sides plus the baseboard thickness.'
          : 'Cut the front piece to fit tight between the walls.',
        ...(wraps.length ? ['Mitre the front end of each side piece to meet it, then cut the back end square, tight to the wall.'] : []),
        `Glue the mitres and nail each piece to the plinth with ${f(1.25)} brads, its bottom on the floor and its top lapping ${f(Math.max(bb.height - plan.baseHeight, 0))} over the case.`,
        'Fill the nail holes and caulk the top edge where it meets the case.',
      ],
      parts: sized(partsWhere(['Baseboard'])),
      tips: ['If the floor isn’t flat, scribe the bottom of the baseboard to it rather than tilting the top.', 'Paint the baseboard with the room’s trim, or with the case.'],
      cautions: [],
      scene: { view: 'front', visible: everything.filter(name => !baseboardNames.includes(name)), highlight: baseboardNames },
    });
  }

  // 14 ── Finish
  steps.push({
    id: 'finish',
    title: 'Finish',
    summary: 'Paint for the ALEX look, or clear-coat to show the plywood.',
    instructions: [
      'Take the fronts and drawers out and finish them separately; mask the slides.',
      'Fill and sand the plywood edges before painting so they don’t show through.',
      config.base === 'feet' ? 'Stand the unit in place and screw the feet in or out until it’s level and the gaps run even.' : 'Check that the gaps run even; loosen the front screws to nudge any that don’t.',
    ],
    parts: [],
    tips: plan.overallHeight > 30 && config.base !== 'casters' ? ['Anchor the top to a wall stud — open drawers shift the weight forward.'] : [],
    cautions: [],
    scene: { view: 'front', visible: run ? runAll.map(x => x.name) : everything, highlight: [] },
  });

  // Rough working time per step, for the build tracker (a first build, unhurried).
  const u = plan.unitCount;
  const pieces = plan.parts.reduce((a, p) => a + p.qty, 0);
  const machined = (2 + n * 4) * u;
  const withInserts = plan.inserts.filter(Boolean).length * u;
  const minutes: Record<string, number> = {
    cut: 3 * pieces,
    joinery: 2 * machined,
    'box-joints': 15,
    'bookcase-dados': 40,
    'bookcase-pins': 30,
    'bookcase-banding': 30,
    'bookcase-case': 45,
    'bookcase-dividers': 20,
    'bookcase-shelves': 20,
    'bookcase-back': 20,
    pulls: 15 * n * u,
    tnuts: 20 * u,
    case: (45 + 15 * plan.partitionXs.length + 10 * cubbies.length) * u,
    back: 20 * u,
    casters: 20 * u,
    plinth: 40 * u,
    baseboard: 30 * u,
    slides: 15 * n * u,
    boxes: 20 * n * u - (detail ? 20 : 0),
    drawers: 8 * n * u,
    inserts: 30 * withInserts,
    fronts: 10 * n * u,
    desk: 45,
    install: 40,
    finish: 90 + 10 * n * u,
  };
  for (const step of steps) {
    if (step.id.startsWith('sheets-')) step.minutes = Math.round(10 * (step.sheets?.layouts.length ?? 1));
    else if (minutes[step.id]) step.minutes = minutes[step.id];
  }

  return { steps, solids };
}

/** "5 pairs of 20\" slides" or "4 pairs of 20\" and 1 pair of 12\" slides". */
function slideCounts(plan: DrawerPlan, f: (inches: number) => string): string {
  const boxed = boxedDrawers(plan);
  const lengths = [...new Set(boxed.map(d => d.box.depth))].sort((a, b) => b - a);
  const parts = lengths.map(l => {
    const n = boxed.filter(d => d.box.depth === l).length;
    return `${n} pair${n === 1 ? '' : 's'} of ${f(l)}`;
  });
  return `${parts.join(' and ')} slides`;
}
