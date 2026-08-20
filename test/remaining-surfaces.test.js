import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  convertMeasurement,
  FRAC_GROUPS,
  IN_TABLE,
  MM_TABLE,
  toFrac32,
} from '../src/lib/conversions.ts';
import {
  buildNotebookUpdate,
  canLeaveNotebook,
  formatRelativeTime,
  notebookHasUnsavedChanges,
} from '../src/lib/notebook.ts';
import { filterProjects, sortProjects } from '../src/lib/coreWorkflows.ts';
import { readSettingsValue } from '../src/lib/settingsPreferences.ts';
import { routeTitleForPath } from '../src/navigation.ts';

const readSource = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

const project = (overrides = {}) => ({
  id: 1,
  title: 'Bench',
  description: null,
  source_url: null,
  cut_plan_url: null,
  status: 'planning',
  difficulty: 'Intermediate',
  estimated_hours: 4,
  wood_types: [],
  tools_needed: [],
  parts_count: 0,
  total_cost: 0,
  hero_image_id: null,
  cut_list_names: null,
  material_names: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
  ...overrides,
});

test('conversion helpers preserve exact woodworking results and fixture coverage', () => {
  assert.deepEqual(convertMeasurement('25.4', 'mm'), {
    number: 25.4,
    millimeters: 25.4,
    inches: 1,
    fraction: '1"',
  });
  assert.equal(convertMeasurement('1', 'in').millimeters, 25.4);
  assert.equal(toFrac32(0.375), '3/8"');
  assert.equal(toFrac32(1.984375), '2"');
  assert.equal(toFrac32(Number.POSITIVE_INFINITY), '0"');
  assert.equal(MM_TABLE.length, 100);
  assert.equal(IN_TABLE.length, 96);
  assert.equal(FRAC_GROUPS.length, 48);
  assert.equal(FRAC_GROUPS.flat().length, 384);
  assert.deepEqual(FRAC_GROUPS[0][7], { label: '1"', millimeters: 25.4 });
});

test('Notebook dirty state, unload decision, timestamps, and overwrite payload remain stable', () => {
  const baseline = { title: 'Plan', body_md: '# Cut list' };
  assert.equal(notebookHasUnsavedChanges(baseline, 'Plan', '# Cut list'), false);
  assert.equal(notebookHasUnsavedChanges(baseline, 'Plan v2', '# Cut list'), true);
  assert.equal(canLeaveNotebook(false, () => false), true);
  assert.equal(canLeaveNotebook(true, () => false), false);
  assert.equal(canLeaveNotebook(true, () => true), true);
  assert.equal(formatRelativeTime('2026-08-19T20:00:00Z', Date.parse('2026-08-19T20:45:00Z')), '45m ago');

  const page = {
    id: 'page-1',
    title: 'Server title',
    snippet: null,
    edited_at: '2026-08-19T20:00:00',
    html: '',
    body_md: 'server',
  };
  assert.deepEqual(buildNotebookUpdate(page, '  My edit  ', 'local body'), {
    title: 'My edit',
    body_md: 'local body',
    expected_edited_at: page.edited_at,
  });
});

test('Settings migration keeps storage keys and restores retired accents safely', () => {
  assert.deepEqual(readSettingsValue(null), {
    accentColor: 'amber',
    fontSize: 'normal',
    defaultProjectStatus: 'idea',
    defaultDashboardSort: 'updated',
    showCompletedByDefault: false,
  });
  assert.equal(readSettingsValue('{"accentColor":"retired"}').accentColor, 'amber');
  assert.equal(readSettingsValue('{"fontSize":"large"}').fontSize, 'large');
  assert.equal(readSettingsValue('{bad json').defaultProjectStatus, 'idea');
});

test('dashboard defaults hide completed work only from All and sort without mutating API data', () => {
  const projects = [
    project({ id: 1, title: 'Zulu', updated_at: '2026-01-02T00:00:00Z' }),
    project({ id: 2, title: 'Alpha', status: 'completed', updated_at: '2026-01-03T00:00:00Z' }),
    project({ id: 3, title: 'Maple', updated_at: '2026-01-04T00:00:00Z' }),
  ];
  assert.deepEqual(filterProjects(projects, 'all', '', false).map(item => item.id), [1, 3]);
  assert.deepEqual(filterProjects(projects, 'completed', '', false).map(item => item.id), [2]);
  assert.deepEqual(sortProjects(projects, 'title').map(item => item.title), ['Alpha', 'Maple', 'Zulu']);
  assert.deepEqual(projects.map(item => item.id), [1, 2, 3]);
});

test('remaining routes retain paths, titles, redirect behavior, and lazy failure/loading fallbacks', async () => {
  const [app, navigation, errorBoundary] = await Promise.all([
    readSource('src/App.tsx'),
    readSource('src/navigation.ts'),
    readSource('src/components/ErrorBoundary.tsx'),
  ]);
  assert.equal(routeTitleForPath('/notebook/new'), 'New Notebook Page · Workshop');
  assert.equal(routeTitleForPath('/projects/42/edit'), 'Edit Project · Workshop');
  assert.equal(routeTitleForPath('/unknown'), 'Workshop · Project Companion');
  assert.match(app, /const NotebookPage = lazy\(\(\) => import\('\.\/pages\/NotebookPage'\)\)/);
  assert.match(app, /<Suspense fallback=\{<RouteLoading \/>\}>/);
  assert.match(app, /<ErrorBoundary key=\{location\.pathname\}>/);
  assert.match(app, /<Route path="\*"[\s\S]*<Navigate to="\/" replace \/>/);
  assert.match(app, /document\.title = routeTitleForPath\(location\.pathname\)/);
  assert.match(navigation, /'\/notebook\/:id'/);
  assert.match(errorBoundary, /Workshop could not open this page/);
});

test('templates, inspiration, Settings account actions, auth errors, and global status surfaces stay wired', async () => {
  const [dashboard, settings, landing, notebook, projectForm, app, commandPalette] = await Promise.all([
    readSource('src/pages/Dashboard.tsx'),
    readSource('src/pages/Settings.tsx'),
    readSource('src/auth/LandingPage.tsx'),
    readSource('src/pages/NotebookPage.tsx'),
    readSource('src/pages/ProjectForm.tsx'),
    readSource('src/App.tsx'),
    readSource('src/components/CommandPalette.tsx'),
  ]);
  assert.match(dashboard, /await cloneTemplate\(id\)/);
  assert.match(dashboard, /await deleteTemplate\(id\)/);
  assert.match(dashboard, /DIY_SITES\.map/);
  assert.match(settings, /await deleteAccount\(\)/);
  assert.match(settings, /instance\.clearCache/);
  assert.match(settings, /logoutRedirect/);
  assert.match(settings, /__WORKSHOP_VERSION__/);
  assert.match(landing, /instance\.loginRedirect\(loginRequest\)/);
  assert.match(landing, /Microsoft sign-in could not start/);
  assert.match(landing, /enterDemoMode\(\)/);
  assert.match(notebook, /beforeunload/);
  assert.match(notebook, /useBlocker\(dirty\)/);
  assert.match(notebook, /if \(!savedRedirect \|\| dirty\) return/);
  assert.match(notebook, /persistPage\(conflict\.current\)/);
  assert.match(notebook, /DOMPurify\.sanitize/);
  assert.match(notebook, /aria-labelledby="notebook-preview-tab"/);
  assert.match(notebook, /event\.key === 'ArrowRight'/);
  assert.equal((notebook.match(/readOnly=\{saving\}/g) ?? []).length, 2);
  assert.match(projectForm, /className="upload-progress-panel" aria-live="polite"/);
  assert.match(app, /<Toaster[\s\S]*closeButton/);
  assert.match(commandPalette, /role="dialog"[\s\S]*aria-modal="true"/);
  assert.match(commandPalette, /returnFocusTo\.focus\(\)/);
});
