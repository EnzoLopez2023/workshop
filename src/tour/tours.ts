// The tours: an app walkthrough, and hands-on tutorials for the Drawer Builder
// and Shelf Builder. Targets are CSS selectors; the first visible match is used.

export type TourId = 'app' | 'drawers' | 'shelves';

export interface TourStep {
  title: string;
  body: string[];
  /** What to spotlight. Without one, the card sits in the middle of the screen. */
  target?: string;
  /** The page this step is on; the tour goes there first. */
  route?: string;
  /** A hands-on step: clicking the target moves the tour on. */
  action?: 'click';
  actionHint?: string;
  /** How long to let the click land before moving on (ms). */
  advanceDelay?: number;
  /** When the target isn't on screen, why (e.g. "fix the highlighted measurements first"). */
  missingHint?: string;
  /** Buttons that hand over to another tour. */
  links?: { label: string; tour: TourId }[];
  /** Runs before the step looks for its target (e.g. open a panel). */
  before?: () => void;
}

export interface Tour {
  title: string;
  description: string;
  steps: TourStep[];
}

const head = 'main .page-head';
const section = (id: string) => `[aria-labelledby="${id}"]`;
const fieldset = (name: string) => `[data-tour="fs-${name}"]`;
const needsValid = 'the design has a problem to fix first (see the red message)';

export const TOURS: Record<TourId, Tour> = {
  app: {
    title: 'Workshop tour',
    description: 'A quick walk through every part of Workshop.',
    steps: [
      {
        title: 'Welcome to Workshop',
        body: [
          'Workshop is your plan table: projects and their cut lists, materials and build logs, plus builders that design shelving and drawer units down to the last cut.',
          'This tour takes about two minutes. Use the arrow keys or the buttons; Esc ends it any time.',
        ],
      },
      {
        title: 'Getting around',
        body: ['Every part of Workshop is one click away here — on a phone it’s the bar along the bottom.'],
        target: '[data-tour="nav"]',
      },
      {
        title: 'Projects',
        body: [
          'Your projects live here, with their status, cost and progress. Open one for its cut list, sheet layout, materials, photos, build log and — for builder designs — a 3D preview and build guide with a progress tracker.',
        ],
        route: '/',
        target: head,
      },
      {
        title: 'Start something new',
        body: ['Create a woodworking, Shaper or Bambu project — or import one from a web page and let Workshop fill in the details.'],
        route: '/',
        target: '[data-tour="new-project"]',
      },
      {
        title: 'Saved designs',
        body: ['Designs you save in the Shelf Builder and Drawer Builder show up on the Projects page, one click from editing.'],
        route: '/',
        target: section('shelf-designs-title'),
        missingHint: 'they appear once the page has loaded',
      },
      {
        title: 'Shopping List',
        body: ['Every unpurchased material across your projects, in one list to take to the store. Tick things off as you buy them.'],
        route: '/shopping-list',
        target: head,
      },
      {
        title: 'Shelf Builder',
        body: [
          'Design plywood shelving by the bay: dados, adjustable shelves, doors, face frames, French cleats. It gives you the cut list, sheet layout, CNC files, hardware, cost and an illustrated build guide.',
        ],
        route: '/shelves',
        target: head,
        links: [{ label: 'Shelf Builder tutorial', tour: 'shelves' }],
      },
      {
        title: 'Drawer Builder',
        body: [
          'ALEX-style drawer units with finger-pull fronts — any size, in columns, with dividers, Gridfinity, tool shadow boards, desk tops, shop jigs and a printable build packet.',
          'It has the most to explore, so it has its own hands-on tutorial.',
        ],
        route: '/drawers',
        target: head,
        links: [{ label: 'Drawer Builder tutorial', tour: 'drawers' }],
      },
      {
        title: 'Conversion tables',
        body: ['Fractions, millimetres, plywood and lumber sizes, drill and screw charts — the numbers you keep looking up.'],
        route: '/conversions',
        target: head,
      },
      {
        title: 'Notebook',
        body: ['Your Tabloom notebook pages, readable and editable right here.'],
        route: '/notebook',
        target: head,
        missingHint: 'it needs your Tabloom sign-in',
      },
      {
        title: 'Settings',
        body: ['Make Workshop yours: colour themes (Spruce, Blueprint, Graphite, Walnut, Slate), dark mode, units and annotation colours.'],
        route: '/settings',
        target: head,
      },
      {
        title: 'Search anything',
        body: ['Press ⌘K (Ctrl K on Windows) to jump to any project, page or tool — including these tours.'],
        target: '[data-tour="search"]',
      },
      {
        title: 'Tours, any time',
        body: ['This button brings the tours back whenever you want a refresher.'],
        target: '[data-tour="help"]',
      },
      {
        title: 'That’s Workshop',
        body: ['Happy building! Want a hands-on walk through one of the builders?'],
        links: [
          { label: 'Drawer Builder', tour: 'drawers' },
          { label: 'Shelf Builder', tour: 'shelves' },
        ],
      },
    ],
  },

  drawers: {
    title: 'Drawer Builder tutorial',
    description: 'Hands-on: design a drawer unit and see everything it makes.',
    steps: [
      {
        title: 'The Drawer Builder',
        body: [
          'Design a plywood drawer unit like the IKEA ALEX — but better built and any size — and get everything you need to make it.',
          'Some steps are hands-on: when you see “Try it”, do it and the tutorial moves on. Your design is kept in this browser as you go.',
        ],
        route: '/drawers',
        target: head,
      },
      {
        title: 'Start from a template',
        body: ['The ALEX sizes and a few custom designs are here, and your saved designs appear beside them.'],
        route: '/drawers',
        target: '.drawer-templates',
        action: 'click',
        actionHint: 'pick a template — ALEX 5-drawer is a good start',
      },
      {
        title: 'Name and save it',
        body: ['Save the design to your library to come back to it, or save new versions as you go. It shows when there are unsaved changes.'],
        route: '/drawers',
        target: '.shelf-design-bar',
      },
      {
        title: 'Work through the steps',
        body: ['The settings run in the order you’d design a cabinet: size and layout, fronts, base, built-ins, inside, then materials. Jump between them here; anything to fix shows at the top of the preview.'],
        route: '/drawers',
        target: '.builder-step-nav',
      },
      {
        title: 'Inches or millimetres',
        body: ['Switch units and every size converts. Any box also takes the other unit — type 18mm or 3/4".'],
        route: '/drawers',
        target: fieldset('units'),
      },
      {
        title: 'Size',
        body: ['Overall width and depth (fronts included). The hints tell you how wide the boxes come out and which slides fit.'],
        route: '/drawers',
        target: fieldset('size'),
      },
      {
        title: 'Drawers, doors and columns',
        body: [
          'Set the overall height and let the fronts share it, or type each front. Add columns for a wide dresser — each column gets its own drawers.',
          'Each position can be a drawer, a door (with shelves or pull-out trays behind it) or an open cubby.',
          '“Shallow top drawer” makes a pencil tray in one click; the load setting checks slides and bottoms against what you’ll store.',
        ],
        route: '/drawers',
        target: fieldset('drawers'),
      },
      {
        title: 'Fronts and pulls',
        body: ['Slab or Shaker fronts, and the ALEX cut-out pull (or a slot, wide notch or hand hole) — or knobs, bar pulls or cup pulls. The bookcase doors match.'],
        route: '/drawers',
        target: fieldset('finger-pull'),
      },
      {
        title: 'Finish colours',
        body: ['Colours for the fronts and the case, in the 3D view and the build guide.'],
        route: '/drawers',
        target: fieldset('finish'),
        action: 'click',
        actionHint: 'pick a colour',
      },
      {
        title: 'Base and mounting',
        body: [
          'Stand it on the floor (on MROCO leveling feet or casters), hang it on the wall on a French cleat, or hang it under a desk.',
          'For a built-in look, set it on a toe-kick plinth, run the sides down into an integrated toe kick, or use a flush base wrapped in baseboard.',
        ],
        route: '/drawers',
        target: fieldset('base-mounting'),
      },
      {
        title: 'A bookcase above',
        body: ['Turn a floor-standing unit into a built-in hutch: a bookcase on a countertop (or straight on the case) with bays, fixed and adjustable shelves, doors, a cap or crown, and a task light. It’s added to the cut list, CNC files, hardware and build guide.'],
        route: '/drawers',
        target: fieldset('bookcase'),
      },
      {
        title: 'A wall of built-ins',
        body: ['Line copies of this cabinet along a wall — mirrored where you like — with desk gaps between them and fillers scribed to the walls, under one countertop. The bookcase goes over each, with one crown across the top.'],
        route: '/drawers',
        target: fieldset('wall-run'),
      },
      {
        title: 'Desk top',
        body: ['Put one unit at each end (or one at one end) under a plywood desk top — the units are sized to fit under it and knee space is checked.'],
        route: '/drawers',
        target: fieldset('desk'),
      },
      {
        title: 'Inside the drawers',
        body: [
          'Per drawer: an egg-crate divider grid, a marker tray, a Gridfinity baseplate (with a bin planner and STLs), a tool shadow board from SVG/DXF outlines.',
        ],
        route: '/drawers',
        target: fieldset('inside-the-drawers'),
      },
      {
        title: 'Slides',
        body: ['LONTAN soft-close, full-extension slides: the longest that fits is picked for you. Shorter ones per drawer are an option.'],
        route: '/drawers',
        target: fieldset('slides'),
      },
      {
        title: 'Plywood',
        body: ['Last, the details: case and front plywood, drawer-box plywood, bottoms and the back. Use the real measured thickness — plywood is rarely nominal.'],
        route: '/drawers',
        target: fieldset('material'),
      },
      {
        title: 'See it in 3D',
        body: ['Drag to orbit, scroll or pinch to zoom, and hover to name a part. Switch to Drawing for a dimensioned elevation.'],
        route: '/drawers',
        target: '.shelf-viewer',
        missingHint: needsValid,
      },
      {
        title: 'Open it up',
        body: ['Click a drawer to slide it out, or open them all — and Explode pulls every part apart to show how it goes together.'],
        route: '/drawers',
        target: '.shelf-viewer-drawers',
        action: 'click',
        actionHint: 'press Open drawers or Explode',
        missingHint: needsValid,
      },
      {
        title: 'Cut list',
        body: ['Every part with its size and notes. Copy it, print it, or add it to a project — with the materials and costs, and the design for its 3D preview.'],
        route: '/drawers',
        target: section('drawer-cutlist-title'),
        missingHint: needsValid,
      },
      {
        title: 'Cutting order',
        body: ['The cut list as saw setups: everything at one fence setting, then one stop setting, before you move it.'],
        route: '/drawers',
        target: section('drawer-order-title'),
        missingHint: needsValid,
      },
      {
        title: 'CNC and Shaper files',
        body: ['SVG and DXF for whole sheets and every part — notches, rabbets, grooves and pockets included — plus Gridfinity STLs.'],
        route: '/drawers',
        target: section('drawer-export-title'),
        missingHint: needsValid,
      },
      {
        title: 'Shop jigs',
        body: ['Templates, story sticks, spacer blocks, squaring frames and more, sized from your design and grouped by build stage.'],
        route: '/drawers',
        target: '.drawer-jig-stage',
        missingHint: needsValid,
      },
      {
        title: 'Hardware and cost',
        body: ['Slides, feet, screws and finish counted from the design, with links to buy them and prices you can edit.'],
        route: '/drawers',
        target: section('drawer-hardware-title'),
        missingHint: needsValid,
      },
      {
        title: 'Build guide',
        body: [
          'An illustrated, step-by-step guide with this design’s measurements. Tick off steps as you build — with time to go — and “Print build packet” puts the cut list, jigs and guide in one printout.',
        ],
        route: '/drawers',
        target: section('drawer-guide-title'),
        missingHint: needsValid,
      },
      {
        title: 'Sheet layout',
        body: ['Add your sheets and generate a cutting plan — there’s a row for each plywood thickness.'],
        route: '/drawers',
        target: section('drawer-optimizer-title'),
        missingHint: needsValid,
      },
      {
        title: 'You’re ready to build',
        body: ['That’s the Drawer Builder. Start the tutorial again any time from the Tutorial button at the top of the page.'],
        links: [{ label: 'Workshop tour', tour: 'app' }],
      },
    ],
  },

  shelves: {
    title: 'Shelf Builder tutorial',
    description: 'Design a shelving unit by the bay.',
    steps: [
      {
        title: 'The Shelf Builder',
        body: ['Design a plywood shelving unit bay by bay and get the exact cut list, shelf positions, sheet layout and build guide.'],
        route: '/shelves',
        target: head,
      },
      {
        title: 'Templates and your library',
        body: ['Start from a bookcase, pantry, garage wall and more — or open a design you saved.'],
        route: '/shelves',
        target: '[aria-controls="shelf-library"]',
        action: 'click',
        actionHint: 'open the library',
      },
      {
        title: 'Work through the steps',
        body: ['The settings run in design order: size and bays, the case and joinery, face frame and doors, mounting, then materials. Jump between them here; anything to fix shows at the top of the preview.'],
        route: '/shelves',
        target: '.builder-step-nav',
      },
      {
        title: 'Units',
        body: ['Inches or millimetres; every size converts, and any box takes the other unit.'],
        route: '/shelves',
        target: fieldset('units'),
      },
      {
        title: 'Bays',
        body: ['Bay widths, shelf depth and height — by the clear opening or the overall height — and fixed and adjustable shelves per bay, with a sag check.'],
        route: '/shelves',
        target: fieldset('bays'),
      },
      {
        title: 'Case and joinery',
        body: ['Top, bottom and back panels, dadoed or butt joints, and a rabbeted back.'],
        route: '/shelves',
        target: fieldset('case'),
      },
      {
        title: 'Face frame, doors and edges',
        body: ['A solid-wood face frame, doors per bay (with hinges counted) and edge banding.'],
        route: '/shelves',
        target: fieldset('face-frame-doors-edges'),
      },
      {
        title: 'Mounting',
        body: ['A floor unit on a toe kick, or wall-hung on a French cleat.'],
        route: '/shelves',
        target: fieldset('mounting'),
      },
      {
        title: 'Preview',
        body: ['A 3D view you can orbit, or a dimensioned drawing.'],
        route: '/shelves',
        target: '.shelf-preview',
      },
      {
        title: 'Cut list and more',
        body: ['The cut list, CNC files (with a shelf-pin jig), hardware, cost, dado layout and a build guide — all below.'],
        route: '/shelves',
        target: section('shelf-cutlist-title'),
        missingHint: needsValid,
      },
      {
        title: 'Build guide',
        body: ['Illustrated steps with your measurements; tick them off as you build.'],
        route: '/shelves',
        target: section('shelf-guide-title'),
        missingHint: needsValid,
      },
      {
        title: 'Done',
        body: ['That’s the Shelf Builder. The Tutorial button at the top brings this back any time.'],
        links: [{ label: 'Drawer Builder tutorial', tour: 'drawers' }],
      },
    ],
  },
};
