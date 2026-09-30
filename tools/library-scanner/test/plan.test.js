import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { ScanCache, scanAll } from '../src/scan.js'
import { applyPlan, buildPlan } from '../src/plan.js'
import { listBatches, undoBatch } from '../src/fsops.js'
import { fixture } from './helpers.js'

function tree(dir, prefix = '') {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? tree(join(dir, e.name), `${prefix}${e.name}/`) : [`${prefix}${e.name}`],
  ).sort()
}

test('migration plan files everything, dedupes, and undo restores the original layout', () => {
  const { lib, dl, config } = fixture()
  const before = { lib: tree(lib), dl: tree(dl) }
  const cache = new ScanCache(config.cacheDir)
  const { records } = scanAll(config, { cache })
  const plan = buildPlan(config, records)
  const byTitle = Object.fromEntries(plan.models.map((m) => [m.title, m]))

  assert.equal(byTitle['Systainer Latch'].category, 'Festool', 'category guessed from name')
  assert.equal(byTitle['Systainer Latch'].status, 'printed')
  assert.equal(byTitle['Big Tray'].category, 'ShapePilot')
  assert.equal(byTitle['Old'].category, '_Archive')
  assert.equal(byTitle['AMS Riser'].category, 'X2D')
  assert.ok(plan.skipped.some((s) => s.path.endsWith('Mixed')), 'mixed folder is left alone')
  assert.ok(plan.skipped.some((s) => s.path.endsWith('Recent.stl')), 'unsettled download is left alone')
  assert.ok(!plan.models.some((m) => m.moves.some((mv) => mv.from.includes('Pictures for source generation'))))

  // Nothing moved yet.
  assert.deepEqual(tree(lib), before.lib)

  const result = applyPlan(config, plan)
  assert.ok(result.results.every((r) => r.ok), JSON.stringify(result.results))
  const after = tree(lib)
  for (const expected of [
    '_Inbox/foo bar/Foo Bar.3mf',
    '_Inbox/foo bar/model.json',
    'Festool/Systainer Latch/Systainer Latch.stl',
    'Festool/Sub Model/A.stl',
    'Festool/Sub Model/photo.jpg',
    'Festool/Sub Model/model.json',
    '_Archive/Old/Old.stl',
    'X2D/AMS Riser/AMS Thing.3mf',
    'ShapePilot/Big Tray/Tray.stl',
    '_Inbox/New Thing/New Thing.3mf',
    '_Inbox/Kit/A.stl',
    '_Inbox/Kit/readme.txt',
    'Pictures for source generation/ref.stl',
    'settings.pdf',
  ]) {
    assert.ok(after.includes(expected), `missing ${expected}\n${after.join('\n')}`)
  }
  assert.ok(!after.some((p) => p.startsWith('Review/') || p.startsWith('Printed/')), 'emptied legacy folders are removed')
  const latchJson = JSON.parse(readFileSync(join(lib, 'Festool/Systainer Latch/model.json'), 'utf8'))
  assert.equal(latchJson.status, 'printed')
  const fooJson = JSON.parse(readFileSync(join(lib, '_Inbox/foo bar/model.json'), 'utf8'))
  assert.equal(fooJson.source.site, 'makerworld')
  assert.equal(fooJson.designer, 'Maker')

  // Downloads: models gone (duplicates in Trash), personal files untouched.
  assert.deepEqual(tree(dl).sort(), ['Mixed/part.stl', 'Mixed/setup.exe', 'Recent.stl', 'Statements/march.pdf', 'lab.zip'])
  const trashed = readdirSync(config.trashDir)
  assert.ok(trashed.includes('Kit.zip'))
  assert.ok(trashed.includes('Systainer Latch (1).stl'))
  assert.ok(trashed.includes('foo+bar (2).3mf'))

  // A second plan finds nothing left to do.
  const again = buildPlan(config, scanAll(config, { cache }).records)
  assert.equal(again.models.length, 0, JSON.stringify(again.models.map((m) => m.title)))

  const [batch] = listBatches(lib)
  assert.equal(batch.batch, result.batch)
  undoBatch(lib, result.batch)
  assert.deepEqual(tree(lib).filter((p) => !p.startsWith('_Library/')), before.lib)
  assert.deepEqual(tree(dl), before.dl)
  assert.deepEqual(readdirSync(config.trashDir), [])
})

test('intake-only mode files downloads without touching legacy folders', () => {
  const { lib, config } = fixture()
  const cache = new ScanCache(config.cacheDir)
  const plan = buildPlan(config, scanAll(config, { cache }).records, { intakeOnly: true })
  assert.ok(plan.models.every((m) => m.origin === 'intake'))
  // The download duplicate of the library latch is trashed rather than filed.
  const latch = plan.models.find((m) => m.trash.some((t) => t.path.endsWith('Systainer Latch (1).stl')))
  assert.ok(latch)
  const result = applyPlan(config, plan, { kind: 'intake' })
  assert.ok(result.results.every((r) => r.ok))
  assert.ok(existsSync(join(lib, 'Review', 'foo+bar.3mf')), 'legacy folders untouched by intake')
  assert.ok(existsSync(join(lib, '_Inbox', 'New Thing', 'New Thing.3mf')))
})

test('dry run logs nothing and moves nothing', () => {
  const { lib, config } = fixture()
  const before = tree(lib)
  const plan = buildPlan(config, scanAll(config, { cache: new ScanCache(config.cacheDir) }).records)
  const result = applyPlan(config, plan, { dryRun: true })
  assert.ok(result.ops > 0)
  assert.deepEqual(tree(lib), before)
})
