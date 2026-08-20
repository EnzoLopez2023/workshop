import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import {
  APP_ROUTE_PATHS,
  PRIMARY_NAVIGATION,
  dashboardPageForPath,
  isNavigationItemCurrent,
  readDashboardPage,
} from '../src/navigation.ts';
import {
  readThemePreference,
  resolveThemePreference,
} from '../src/themePreferences.ts';

const readSource = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('every public route remains registered behind the existing application shell', async () => {
  const [app, main] = await Promise.all([
    readSource('src/App.tsx'),
    readSource('src/main.tsx'),
  ]);

  for (const path of APP_ROUTE_PATHS) {
    assert.match(app, new RegExp(`path="${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
  }

  assert.ok(main.indexOf('<AuthGuard>') < main.indexOf('<BrowserRouter>'));
  assert.ok(main.indexOf('<BrowserRouter>') < main.indexOf('<App />'));
  assert.match(app, /<ThemeProvider>/);
  assert.match(app, /<SettingsProvider>/);
  assert.match(app, /<AppShell>/);
});

test('primary navigation selects project and utility deep links without changing URLs', () => {
  const projects = PRIMARY_NAVIGATION.find(item => item.id === 'projects');
  const notebook = PRIMARY_NAVIGATION.find(item => item.id === 'notebook');

  assert.ok(projects);
  assert.ok(notebook);
  assert.equal(isNavigationItemCurrent(projects, '/'), true);
  assert.equal(isNavigationItemCurrent(projects, '/projects/42/edit'), true);
  assert.equal(isNavigationItemCurrent(projects, '/shaper/7'), true);
  assert.equal(isNavigationItemCurrent(notebook, '/notebook/new'), true);
  assert.equal(isNavigationItemCurrent(notebook, '/shopping-list'), false);
});

test('dashboard project-type preference is stable and follows deep-link context', () => {
  assert.equal(readDashboardPage(null), 'projects');
  assert.equal(readDashboardPage('retired-value'), 'projects');
  assert.equal(readDashboardPage('shaper'), 'shaper');
  assert.equal(dashboardPageForPath('/projects/42'), 'projects');
  assert.equal(dashboardPageForPath('/shaper/42/edit'), 'shaper');
  assert.equal(dashboardPageForPath('/shopping-list'), null);
});

test('theme preference preserves valid values and migrates unknown values to system', () => {
  assert.equal(readThemePreference('light'), 'light');
  assert.equal(readThemePreference('dark'), 'dark');
  assert.equal(readThemePreference('system'), 'system');
  assert.equal(readThemePreference('night'), 'system');
  assert.equal(readThemePreference(null), 'system');
  assert.equal(resolveThemePreference('system', true), 'dark');
  assert.equal(resolveThemePreference('system', false), 'light');
  assert.equal(resolveThemePreference('light', true), 'light');
});

test('shell CSS carries responsive, focus, touch, and accessibility contracts', async () => {
  const [css, landingCss] = await Promise.all([
    readSource('src/index.css'),
    readSource('src/styles/landing.css'),
  ]);

  assert.match(css, /button,\s*\[role="button"\]\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/s);
  assert.match(css, /:focus-visible\s*\{[^}]*outline:\s*3px solid/s);
  assert.match(css, /@media \(min-width: 768px\)[\s\S]*\.app-sidebar\s*\{[\s\S]*display:\s*flex;/);
  assert.match(css, /@container page \(min-width: 620px\)[\s\S]*\.dashboard-tools/);
  assert.match(css, /@container page \(min-width: 680px\)[\s\S]*\.active-project-layer/);
  assert.match(css, /\.app-mobile-nav\s*\{[\s\S]*position:\s*fixed;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /@media \(prefers-reduced-transparency: reduce\)/);
  assert.match(css, /@media \(forced-colors: active\)/);
  assert.match(css, /@media print/);
  assert.match(css, /background-size:\s*24px 24px;/);
  assert.match(css, /--color-steel:\s*var\(--color-action\);/);
  assert.match(
    landingCss,
    /\.paste-analyze\s*\{[^}]*background:\s*var\(--color-action\);[^}]*color:\s*var\(--color-on-action\);/s,
  );
});

test('shell uses semantic landmarks and current-page semantics', async () => {
  const [app, shell, palette] = await Promise.all([
    readSource('src/App.tsx'),
    readSource('src/components/AppShell.tsx'),
    readSource('src/components/CommandPalette.tsx'),
  ]);

  assert.match(shell, /<aside[^>]*aria-label="Workshop navigation"/);
  assert.match(shell, /<nav className="app-sidebar-nav" aria-label="Primary">/);
  assert.match(shell, /<main id="main-content"/);
  assert.match(shell, /aria-current=\{current \? 'page' : undefined\}/);
  assert.match(shell, /<nav className="app-mobile-nav" aria-label="Primary"[^>]*>/);
  assert.match(shell, /!demo && \(\s*<IconButton label="Sign out"/);
  assert.match(app, /paletteReturnFocusRef\.current = document\.activeElement/);
  assert.match(app, /returnFocusTo=\{paletteReturnFocusRef\.current\}/);
  assert.match(palette, /element\.inert = true/);
  assert.match(palette, /returnFocusTo\.focus\(\)/);
  assert.match(palette, /event\.key !== 'Tab'/);
});

test('successful template deletion updates local state without a fallible refresh', async () => {
  const dashboard = await readSource('src/pages/Dashboard.tsx');

  assert.match(
    dashboard,
    /await deleteTemplate\(id\);\s*setTemplates\(current => current\.filter\(template => template\.id !== id\)\);/,
  );
});
