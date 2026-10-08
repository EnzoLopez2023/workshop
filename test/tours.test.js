import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { TOURS } from '../src/tour/tours.ts';

const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const pages = {
  '/built-ins': source('src/pages/DrawerBuilder.tsx') + source('src/components/ShelfViewer3D.tsx') + source('src/components/DrawerExport.tsx') + source('src/components/DrawerBookcaseFields.tsx') + source('src/components/DrawerRunFields.tsx') + source('src/components/BuilderStepNav.tsx'),
  '/shelves': source('src/pages/ShelfBuilder.tsx') + source('src/components/BuilderStepNav.tsx'),
};
const shell = source('src/components/AppShell.tsx') + source('src/tour/TourLaunchers.tsx');

test('every tour step has a title and words, and hand-offs go to real tours', () => {
  for (const [id, tour] of Object.entries(TOURS)) {
    assert.ok(tour.steps.length > 3, id);
    for (const step of tour.steps) {
      assert.ok(step.title && step.body.length && step.body.every(Boolean), `${id}: ${step.title}`);
      for (const link of step.links ?? []) assert.ok(TOURS[link.tour], `${id} links to ${link.tour}`);
      if (step.action === 'click') assert.ok(step.target, `${id}: a hands-on step needs something to click`);
    }
  }
});

test('builder tour targets exist on their pages, so a renamed section can’t silently break a tour', () => {
  for (const id of ['drawers', 'shelves']) {
    for (const step of TOURS[id].steps) {
      if (!step.target || step.target === 'main .page-head') continue;
      const page = pages[step.route];
      assert.ok(page, `${id}: ${step.title} has no known page`);
      const mark = step.target.match(/data-tour="([^"]+)"/)?.[1]
        ?? step.target.match(/aria-labelledby="([^"]+)"/)?.[1]
        ?? step.target.match(/aria-controls="([^"]+)"/)?.[1]
        ?? step.target.replace(/^\./, '');
      assert.ok(page.includes(mark), `${id}: “${step.title}” targets ${step.target}, not found on ${step.route}`);
    }
  }
  for (const step of TOURS.app.steps) {
    const mark = step.target?.match(/data-tour="([^"]+)"/)?.[1];
    if (mark) assert.ok(shell.includes(`data-tour="${mark}"`), `app: ${step.title} targets ${mark}`);
  }
});
