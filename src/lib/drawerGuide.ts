// Step-by-step build guide for a Drawer Builder unit, in the same shape as the
// Shelf Builder's guide (see buildGuide.ts) so it renders and prints the same way.

import { planSheetsByThickness, type BuildGuide, type GuidePart, type GuideStep } from './buildGuide.ts';
import {
  BOTTOM_GROOVE_DEPTH,
  BOTTOM_GROOVE_OFFSET,
  BOX_NOTCH_EXTRA,
  boxedDrawers,
  deskSolids,
  drawerSolids,
  FINGER_ROOM,
  ALEX_TAPER,
  FOOT_SIZE,
  HANDHOLE_TOP,
  pullWidth,
  SLIDE_CLEARANCE,
  supportPositions,
  type DrawerConfig,
  type DrawerPlan,
} from './drawerUnit.ts';
import { formatLength, type LengthUnit, type ShelfPart } from './shelving.ts';
import type { InsertLayout } from './drawerInserts.ts';
import { TNUT_HOLE } from './drawerExport.ts';

export function drawerGuideSteps(plan: DrawerPlan, config: DrawerConfig, units: LengthUnit): BuildGuide {
  const f = (inches: number) => formatLength(inches, units);
  const unitSolids = drawerSolids(plan, config);
  // The desk step shows every unit under the top, named apart from the single unit the other steps build.
  const desk = plan.desk ? deskSolids(plan, config, true) : [];
  const solids = [...unitSolids, ...desk];
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
  const caseNames = ['Left side', 'Right side', 'Top', 'Bottom', ...partitionNames];
  const back = ['Back'];
  const supports = names(name => name.startsWith('Foot') || name.startsWith('Caster'));
  const slides = names(name => name.endsWith(' slide'));
  const boxes = names(name => / box /.test(name));
  const fronts = unitSolids.filter(s => / front$/.test(s.name) && !s.name.includes(' box ')).map(s => s.name);
  const everything = unitSolids.map(s => s.name);
  const insertNames = names(name => / (divider|marker rib) \d+$/.test(name) || name.endsWith('Gridfinity baseplate') || name.endsWith('tool board'));

  const steps: GuideStep[] = [];

  // 1 ── Overview
  const baseText = config.base === 'feet' ? `on ${plan.supports} MROCO leveling feet` : config.base === 'casters' ? `on ${plan.supports} casters` : 'standing on the floor';
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
  for (const group of planSheetsByThickness(plan.parts, units)) {
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
      `All four box parts: a ${f(config.bottomThickness)} groove (just wider — test with an offcut of the bottom), ${f(BOTTOM_GROOVE_DEPTH)} deep, ${f(BOTTOM_GROOVE_OFFSET)} up from the bottom edge, on the inside face.`,
      'Dry-fit one box before cutting the rest.',
    ],
    parts: sized(partsWhere(['Side', 'Box side', 'Box front', 'Box back'])),
    tips: [
      'Cut the grooves on the table saw with the fence set once for every box part, so the bottoms all line up.',
      'Set the fence and blade height from the setup gauge (shop jigs): one step for each groove and rabbet size.',
    ],
    cautions: [],
    scene: { view: 'exploded', visible: [...caseNames, ...back], highlight: boxes },
    highlightCaption: 'Parts to machine',
  });

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

  // 7 ── Case
  steps.push({
    id: 'case',
    title: 'Assemble the case',
    summary: 'Glue and screw the top and bottom between the sides, front edges flush.',
    instructions: [
      'Lay a side inside face up; stand the top and bottom on it, flush at the front and set back from the rabbet.',
      'Glue, then drive four screws through the side into each panel. Repeat with the other side.',
      ...(cubbies.some(d => d.shelfY !== null) ? [
        `Fix the cubby shelves: ${cubbies.filter(d => d.shelfY !== null).map(d => `${d.label.toLowerCase()}’s, its top ${f(d.shelfY! + T - plan.baseHeight)} up from the bottom edge of the side`).join('; ')}. Glue and screw through the sides into their ends.`,
      ] : []),
      ...(plan.partitionXs.length ? [
        `Stand the partition${plan.partitionXs.length > 1 ? 's' : ''} between the top and bottom at ${plan.partitionXs.map(x => f(x - T)).join(' and ')} from the inside of the left side, front edges flush; glue and screw through the top and bottom into each.`,
      ] : []),
      'Measure both diagonals across the front; they must match before the glue sets.',
    ],
    parts: sized(partsWhere(['Side', 'Top', 'Bottom', 'Partition'])),
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
      `Mark the bottom edge of each slide on both sides of its opening, measured up from the bottom edge of the case side: ${boxed.map(d => `${d.label.toLowerCase()} at ${f(d.slideMark)}`).join(', ')}${plan.partitionXs.length ? ` (on a partition, ${f(T)} less — it starts on the bottom panel)` : ''}. The slide story stick from the shop jigs gives the same marks without measuring.`,
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

  // 11 ── Boxes
  steps.push({
    id: 'boxes',
    title: 'Build the drawer boxes',
    summary: `${n} boxes, ${[...new Set(boxed.map(d => f(d.box.width)))].join(' or ')} wide and ${[...new Set(boxed.map(d => f(d.box.depth)))].join(' or ')} deep.`,
    instructions: [
      'Glue the front and back into the side rabbets, slide the bottom into its groove, then add the second side.',
      'Brad each corner through the side (three per corner).',
      'Check both diagonals across the top; nudge until they match, then let it set.',
      `Each box must measure ${[...new Set(boxed.map(d => f(d.box.width)))].join(' or ')} across — exactly its opening less ${f(SLIDE_CLEARANCE * 2)}.`,
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
    scene: { view: 'front', visible: everything, highlight: [] },
  });

  // Rough working time per step, for the build tracker (a first build, unhurried).
  const u = plan.unitCount;
  const pieces = plan.parts.reduce((a, p) => a + p.qty, 0);
  const machined = (2 + n * 4) * u;
  const withInserts = plan.inserts.filter(Boolean).length * u;
  const minutes: Record<string, number> = {
    cut: 3 * pieces,
    joinery: 2 * machined,
    pulls: 15 * n * u,
    tnuts: 20 * u,
    case: (45 + 15 * plan.partitionXs.length + 10 * cubbies.length) * u,
    back: 20 * u,
    casters: 20 * u,
    slides: 15 * n * u,
    boxes: 20 * n * u,
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
