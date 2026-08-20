import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  buildProjectPayload,
  buildShaperProjectPayload,
  filterProjects,
  filterShaperProjects,
  groupShoppingItems,
  selectFocusProject,
  shoppingSummary,
} from '../src/lib/coreWorkflows.ts';
import { buildCutPieces, optimizeCuts, parseInches } from '../src/lib/cutPlan.ts';

const readSource = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const project = (overrides = {}) => ({
  id: 1,
  title: 'Walnut bench',
  description: 'Entry bench with shoe shelf',
  source_url: null,
  cut_plan_url: null,
  status: 'planning',
  difficulty: 'Intermediate',
  estimated_hours: 8,
  wood_types: ['Walnut'],
  tools_needed: ['Table saw'],
  parts_count: 4,
  total_cost: 120,
  hero_image_id: null,
  cut_list_names: 'Leg Shelf',
  material_names: 'Walnut screws',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

const shaperProject = (overrides = {}) => ({
  id: 10,
  title: 'CNC tray',
  shaper_url: 'https://hub.shapertools.com/shares/tray',
  description: 'Serving tray with curved handles',
  photo_url: null,
  materials: [{ name: 'Maple', qty: '1 board' }],
  instructions: null,
  hero_image_id: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
  ...overrides,
});

test('project and Shaper searches stay independent and project status applies only to projects', () => {
  const projects = [
    project(),
    project({
      id: 2,
      title: 'Oak stool',
      status: 'in_progress',
      wood_types: ['Oak'],
      cut_list_names: 'Seat stretcher',
      material_names: 'Oak glue',
    }),
  ];
  const shaperProjects = [
    shaperProject(),
    shaperProject({ id: 11, title: 'Plywood clock', materials: [{ name: 'Birch plywood', qty: '1 sheet' }] }),
  ];

  assert.deepEqual(filterProjects(projects, 'planning', '').map(item => item.id), [1]);
  assert.deepEqual(filterProjects(projects, 'all', 'oak').map(item => item.id), [2]);
  assert.deepEqual(filterProjects(projects, 'all', 'screws').map(item => item.id), [1]);
  assert.deepEqual(filterShaperProjects(shaperProjects, 'maple').map(item => item.id), [10]);
  assert.deepEqual(filterShaperProjects(shaperProjects, 'clock').map(item => item.id), [11]);
  assert.equal(selectFocusProject(projects)?.id, 2);
});

test('regular and Shaper payload builders preserve API field names and normalize editable input', () => {
  assert.deepEqual(buildProjectPayload({
    title: '  Workbench  ',
    description: 'Shop bench',
    source_url: 'https://example.com/plan',
    cut_plan_url: '',
    status: 'planning',
    difficulty: 'Advanced',
    estimated_hours: 20,
    wood_types: [],
    tools_needed: [],
  }, 'Fir, plywood, ', 'Track saw, Drill'), {
    title: 'Workbench',
    description: 'Shop bench',
    source_url: 'https://example.com/plan',
    cut_plan_url: '',
    status: 'planning',
    difficulty: 'Advanced',
    estimated_hours: 20,
    wood_types: ['Fir', 'plywood'],
    tools_needed: ['Track saw', 'Drill'],
  });

  assert.deepEqual(buildShaperProjectPayload({
    title: '  Tray ',
    shaperUrl: ' https://hub.shapertools.com/shares/tray ',
    description: ' ',
    photoUrl: ' https://example.com/tray.jpg ',
    materials: [{ name: ' Maple ', qty: ' 1 board ' }, { name: ' ', qty: '2' }],
    instructions: ' Cut handles first ',
  }), {
    title: 'Tray',
    shaper_url: 'https://hub.shapertools.com/shares/tray',
    description: null,
    photo_url: 'https://example.com/tray.jpg',
    materials: [{ name: 'Maple', qty: '1 board' }],
    instructions: 'Cut handles first',
  });
});

test('shopping grouping preserves item identity, project provenance, filtering, and totals', () => {
  const items = [
    { id: 1, project_id: 7, project_title: 'Bench', name: 'Walnut', qty_label: '2 boards', cost: 80, purchased: false, sort_order: 0 },
    { id: 2, project_id: 7, project_title: 'Bench', name: 'Screws', qty_label: '1 box', cost: 10, purchased: true, sort_order: 1 },
    { id: 3, project_id: 9, project_title: 'Clock', name: 'Plywood', qty_label: '1 sheet', cost: 32, purchased: false, sort_order: 0 },
  ];

  const outstanding = groupShoppingItems(items, '', false);
  assert.deepEqual(outstanding.map(group => [group.id, group.items.map(item => item.id)]), [
    [7, [1]],
    [9, [3]],
  ]);
  assert.deepEqual(groupShoppingItems(items, 'bench', true)[0].items.map(item => item.id), [1, 2]);
  assert.deepEqual(shoppingSummary(items), {
    outstandingCount: 2,
    purchasedCount: 1,
    outstandingCost: 112,
  });
});

test('cut-plan UI boundary preserves fraction parsing and exact optimizer layout ordering', () => {
  assert.equal(parseInches('1\' 11 3/4"'), 23.75);
  assert.equal(parseInches('27½"'), 27.5);
  assert.equal(parseInches('3/4'), 0.75);

  const cutList = [
    { id: 1, project_id: 1, part_name: 'Side', qty: 2, length: '24', width: '12', thickness: '3/4', material: 'Plywood', sort_order: 0 },
    { id: 2, project_id: 1, part_name: 'Shelf', qty: 2, length: '18', width: '10', thickness: '3/4', material: 'Plywood', sort_order: 1 },
    { id: 3, project_id: 1, part_name: 'Back', qty: 1, length: '36', width: '24', thickness: '1/4', material: 'Plywood', sort_order: 2 },
  ];
  const { pieces, skipped } = buildCutPieces(cutList);
  const result = optimizeCuts([
    { id: 'stock-34', length: 48, width: 24, qty: 2, label: 'plywood', thickness: '3/4' },
    { id: 'stock-14', length: 48, width: 24, qty: 1, label: 'plywood', thickness: '1/4' },
  ], pieces, 0.125);

  assert.deepEqual(skipped, []);
  assert.equal(result.totalSheets, 2);
  assert.equal(result.overallYieldPercent, 78.125);
  assert.equal(result.totalCuts, 5);
  assert.deepEqual(result.layouts.map(layout => ({
    stockId: layout.stockId,
    placed: layout.placed.map(piece => [
      piece.pieceId,
      piece.length,
      piece.width,
      piece.x,
      piece.y,
    ]),
  })), [
    { stockId: 'stock-14', placed: [['3-0', 36, 24, 0, 0]] },
    {
      stockId: 'stock-34',
      placed: [
        ['1-0', 12, 24, 0, 0],
        ['1-1', 12, 24, 12.125, 0],
        ['2-0', 18, 10, 24.25, 0],
        ['2-1', 18, 10, 24.25, 10.125],
      ],
    },
  ]);
});

test('create menus, route context, demo blocking, upload ownership, and state copy remain wired', async () => {
  const [workflows, shell, dashboard, projectForm, shaperForm, shopping, api] = await Promise.all([
    readSource('src/components/workflows.tsx'),
    readSource('src/components/AppShell.tsx'),
    readSource('src/pages/Dashboard.tsx'),
    readSource('src/pages/ProjectForm.tsx'),
    readSource('src/pages/ShaperProjectForm.tsx'),
    readSource('src/pages/ShoppingList.tsx'),
    readSource('src/services/api.ts'),
  ]);

  assert.match(workflows, /to="\/projects\/new"[\s\S]*selectProjectType\(event, 'projects'\)/);
  assert.match(workflows, /to="\/shaper\/new"[\s\S]*selectProjectType\(event, 'shaper'\)/);
  assert.match(workflows, /closest\('details'\)\?\.removeAttribute\('open'\)/);
  assert.match(shell, /<CreateProjectMenu \/>/);
  assert.match(shell, /<CreateProjectMenu align="end" compact \/>/);
  assert.match(dashboard, /No matching projects/);
  assert.match(dashboard, /No matching Shaper projects/);
  assert.match(projectForm, /Project could not be saved/);
  assert.match(shaperForm, /Shaper project needs attention/);
  assert.match(shopping, /No matching shopping items/);
  assert.match(api, /if \(demo && method !== 'GET'\) blockIfDemo\(\)/);
  assert.match(api, /\/projects\/\$\{projectId\}\/images/);
  assert.match(api, /\/shaper-projects\/\$\{shaperProjectId\}\/images/);
});
