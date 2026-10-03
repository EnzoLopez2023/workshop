import assert from 'node:assert/strict';
import { test } from 'node:test';
import { describeSave, saveCutListToProject } from '../src/lib/projectCutList.ts';

function fakeWriter({ failAddAt = -1, failRemove = [] } = {}) {
  const added = [];
  const removed = [];
  return {
    added,
    removed,
    add: async (projectId, item) => {
      if (added.length === failAddAt) throw new Error('Network error');
      added.push({ projectId, ...item });
    },
    remove: async id => {
      if (failRemove.includes(id)) throw new Error('nope');
      removed.push(id);
    },
  };
}

const items = [{ part_name: 'Side' }, { part_name: 'Shelf' }, { part_name: 'Back' }];
const existing = [{ id: 7, sort_order: 4 }, { id: 8, sort_order: 9 }];

test('append sorts new parts after the existing ones and keeps them', async () => {
  const w = fakeWriter();
  const r = await saveCutListToProject(w, 3, items, existing, 'append');
  assert.deepEqual(w.added.map(a => a.sort_order), [10, 11, 12]);
  assert.ok(w.added.every(a => a.projectId === 3));
  assert.deepEqual(w.removed, []);
  assert.equal(describeSave(r, 'Garage', 'append'), 'Added 3 parts to “Garage”.');
});

test('replace removes the old parts only after every new part saved', async () => {
  const w = fakeWriter();
  const r = await saveCutListToProject(w, 3, items, existing, 'replace');
  assert.deepEqual(w.added.map(a => a.sort_order), [1, 2, 3], 'never 0, which the server treats as unset');
  assert.deepEqual(w.removed, [7, 8]);
  assert.match(describeSave(r, 'Garage', 'replace'), /^Replaced the cut list in “Garage” with 3 parts\.$/);
});

test('a failed add stops, keeps the old parts, and says exactly what happened', async () => {
  const w = fakeWriter({ failAddAt: 1 });
  const r = await saveCutListToProject(w, 3, items, existing, 'replace');
  assert.equal(r.added, 1);
  assert.deepEqual(w.removed, []);
  const text = describeSave(r, 'Garage', 'replace');
  assert.match(text, /Only 1 of 3 parts were added/);
  assert.match(text, /Network error/);
  assert.match(text, /existing parts were left as they were/);

  const none = await saveCutListToProject(fakeWriter({ failAddAt: 0 }), 3, items, [], 'append');
  assert.match(describeSave(none, 'Garage', 'append'), /^Nothing was added to “Garage”: Network error$/);
});

test('old parts that cannot be removed are reported', async () => {
  const r = await saveCutListToProject(fakeWriter({ failRemove: [8] }), 3, items, existing, 'replace');
  assert.equal(r.removed, 1);
  assert.equal(r.removeFailed, 1);
  assert.match(describeSave(r, 'Garage', 'replace'), /1 part from the old list couldn’t be removed/);
});
